// 遊戲狀態（純資料＋純函式，無 DOM）。UI 與測試都經由這裡操作。
import { CHARACTERS, ENEMIES, DUNGEON, ENCOUNTER_EVENTS, PARTY_SIZE, POTION_HEAL, POTION_PRICE, BONDS, AFFIXES, AFFIX_TABLE, RESISTS, SALVAGE_GOLD, itemDef, STARTERS, LEARNABLE, GACHA, GEMS, SKILLS, SKILL_SLOTS } from './data.js';
import { createBattle, stepRound, verifyRecord, pairKey, pairLevel, ORDER_RULES } from './engine.js';
import { hashSeed, rngInt } from './rng.js';
import { deriveMemories, verifyMemories } from './memory.js';
import { buildMoments, verifyMoments } from './narration.js';
import { allEvents } from './report.js';
import { validateTalk, talkLine, AFFINITY_MAX } from './talk.js';

export const SAVE_VERSION = 1;
const STEPS_PER_FLOOR = 3;

// 第一個技能是基本攻擊（永遠帶著）；其餘是可裝備的技能
const specials = (id) => CHARACTERS[id].skills.slice(1);
const defaultEquipped = (id) => specials(id).slice(0, SKILL_SLOTS);
const newMember = (id) => ({ level: 1, xp: 0, equip: { weapon: null, armor: null }, career_kills: 0, learned: [], equipped: defaultEquipped(id) });
/** 可以裝備的技能：角色專屬技能＋抽到的職業技能 */
export const ownedSkills = (game, id) => [...specials(id), ...(game.roster[id]?.learned || [])];
/** 已擁有（在名冊裡）的角色，依資料順序 */
export const ownedIds = (game) => Object.keys(CHARACTERS).filter((id) => game.roster[id]);
/** 戰鬥用技能：基本技能＋抽到的可學技能 */
export const battleSkills = (game, id) => [CHARACTERS[id].skills[0], ...(game.roster[id]?.equipped ?? defaultEquipped(id))];

/** 設定上陣技能（最多 SKILL_SLOTS 個，只能是已擁有的技能） */
export function setSkills(game, id, list) {
  if (!game.roster[id]) throw new Error('沒有這個角色');
  if (game.expedition) throw new Error('遠征中不能換技能');
  if (!Array.isArray(list) || list.length > SKILL_SLOTS || new Set(list).size !== list.length) throw new Error(`最多帶 ${SKILL_SLOTS} 個技能`);
  const owned = ownedSkills(game, id);
  if (list.some((s) => !owned.includes(s))) throw new Error('還沒學會這個技能');
  game.roster[id].equipped = [...list];
}

export function newGame(seed = Date.now() % 1e9) {
  const roster = {};
  for (const id of STARTERS) roster[id] = newMember(id);
  return {
    version: SAVE_VERSION, seed: seed >>> 0, day: 1, gold: 60, gems: 0, pulls: 0, pendingRecruit: null, orderBond: {}, entrusted: [], potions: 2, expeditions: 0, battles_fought: 0, clears: 0,
    roster, party: ['airin', 'ade', 'xiaomei'], tactics: { airin: 'balanced', ade: 'balanced', xiaomei: 'balanced', rook: 'balanced' },
    inventory: [], pairs: {}, discoveries: { guardian_trust: { status: 'undiscovered', observations: 0, test_with: false, test_control: false } },
    memories: [], history: [], reports: [], flags: {}, settings: { density: 3, mode: 'auto' },
    affinity: {}, talked: {},
    expedition: null, log: ['你在灰燼地窖外的營地醒來。'],
  };
}

export function effectiveStats(game, id) {
  const base = CHARACTERS[id].stats;
  const r = game.roster[id];
  const st = { ...base, hp: base.hp + (r.level - 1) * 6, atk: base.atk + (r.level - 1) };
  for (const slot of ['weapon', 'armor']) {
    const it = itemDef(r.equip[slot]);
    if (it) for (const [k, v] of Object.entries(it.mods)) st[k] = (st[k] || 0) + v;
  }
  return st;
}

/** 裝備詞綴帶來的抵抗（目前只有防具的耐火） */
export function resistIds(game, id) {
  const out = [];
  for (const slot of ['weapon', 'armor']) for (const a of itemDef(game.roster[id].equip[slot])?.affixes ?? []) if (RESISTS[a] && !out.includes(a)) out.push(a);
  return out;
}

export const pairXp = (game, a, b) => game.pairs[pairKey(a, b)]?.xp || 0;

function pairLevels(game, ids) {
  const out = {};
  for (let i = 0; i < ids.length; i++) for (let j = i + 1; j < ids.length; j++) out[pairKey(ids[i], ids[j])] = pairLevel(pairXp(game, ids[i], ids[j]));
  return out;
}

// ── 地城狀態（P06：地城隨世界事件變化）──────────────
export const dungeonState = (game) => (game.flags.boss_defeated ? 'ember_return' : 'normal');
export function floorData(game, idx) {
  const f = DUNGEON.floors[idx];
  return dungeonState(game) === 'ember_return' && f.after_boss ? { ...f, ...f.after_boss } : f;
}

// ── 城鎮 ──────────────────────────────────────────
export function setParty(game, ids) {
  if (game.expedition) throw new Error('遠征中不能換隊');
  const uniq = [...new Set(ids)];
  if (uniq.length !== PARTY_SIZE || uniq.some((id) => !CHARACTERS[id] || !game.roster[id])) throw new Error(`隊伍需要 ${PARTY_SIZE} 名不同角色`);
  game.party = uniq;
}
export function setTactic(game, id, tactic) {
  if (!['aggressive', 'balanced', 'protect'].includes(tactic)) throw new Error('未知戰術');
  game.tactics[id] = tactic;
}
export function equip(game, id, itemId) {
  const it = itemDef(itemId);
  const idx = game.inventory.indexOf(itemId);
  if (!it || idx < 0) throw new Error('背包沒有這件裝備');
  const r = game.roster[id];
  game.inventory.splice(idx, 1);
  if (r.equip[it.slot]) game.inventory.push(r.equip[it.slot]);
  r.equip[it.slot] = itemId;
}
export function unequip(game, id, slot) {
  const r = game.roster[id];
  if (r.equip[slot]) { game.inventory.push(r.equip[slot]); r.equip[slot] = null; }
}
/** 分解背包中的裝備換金幣（依稀有度）。回傳獲得的金幣。 */
export function salvage(game, idx) {
  if (game.expedition) throw new Error('遠征中不能分解');
  const id = game.inventory[idx];
  const it = itemDef(id);
  if (!it) throw new Error('背包沒有這件裝備');
  game.inventory.splice(idx, 1);
  const gold = SALVAGE_GOLD[it.rarity];
  game.gold += gold;
  game.log.push(`分解 ${it.name}，得到 ${gold} 金幣。`);
  return gold;
}
export function buyPotion(game) {
  if (game.gold < POTION_PRICE) throw new Error('金幣不足');
  game.gold -= POTION_PRICE; game.potions += 1;
}

const TALK_ERR = { not_an_object: '無效的談話', unknown_field: '無效的談話', unknown_actor: '沒有這個人', unknown_intent: '不能這樣問', on_expedition: '遠征中沒空閒聊', already_talked_today: '今天已經聊過了' };
/** 營地談話：input 只能是 {actor_id, intent}。每人每天一次，好感 +1（上限 10），不影響戰鬥數值。 */
export function talk(game, input) {
  const err = validateTalk(game, input);
  if (err) throw new Error(TALK_ERR[err]);
  const { actor_id: id, intent } = input;
  const line = talkLine(game, id, intent);
  game.affinity[id] = Math.min(AFFINITY_MAX, (game.affinity[id] || 0) + 1);
  game.talked[id] = game.day;
  return { ...line, actor_id: id, intent, affinity: game.affinity[id] };
}

// ── 遠征 ──────────────────────────────────────────
export function startExpedition(game) {
  if (game.expedition) throw new Error('已在遠征中');
  if (game.party.length !== PARTY_SIZE) throw new Error('隊伍人數不足');
  game.expeditions += 1;
  const hp = {};
  for (const id of game.party) hp[id] = effectiveStats(game, id).hp;
  game.expedition = { id: game.expeditions, floor: 0, step: 0, hp, loot: [], gold: 0, pending: null, choices: [] };
  game.expedition.choices = genChoices(game);
  game.log.push(`第 ${game.day} 天：隊伍（${game.party.map((i) => CHARACTERS[i].name).join('、')}）進入${DUNGEON.name}。`);
}

const encLabel = (enc) => `戰鬥：${enc.map((e) => ENEMIES[e].name).join('、')}`;
function genChoices(game) {
  const ex = game.expedition;
  const floor = floorData(game, ex.floor);
  if (ex.floor === DUNGEON.floors.length - 1 && ex.step === STEPS_PER_FLOOR - 1) return [{ type: 'boss', enemies: floor.boss, label: '踏入祭壇（Boss）' }];
  const r = { rng: hashSeed(game.seed, 'route', ex.id, ex.floor, ex.step) };
  const opts = [];
  const enc = floor.encounters[rngInt(r, floor.encounters.length) - 1];
  opts.push({ type: 'battle', enemies: enc, label: encLabel(enc) });
  const pool = ['event', 'event', 'rest', 'treasure', 'battle'];
  const t = pool[rngInt(r, pool.length) - 1];
  if (t === 'battle') {
    const enc2 = floor.encounters[rngInt(r, floor.encounters.length) - 1];
    opts.push({ type: 'battle', enemies: enc2, label: encLabel(enc2), bonusLoot: true });
  } else if (t === 'event') {
    const state = dungeonState(game);
    const keys = Object.keys(ENCOUNTER_EVENTS).filter((k) => !ENCOUNTER_EVENTS[k].dungeonState || ENCOUNTER_EVENTS[k].dungeonState === state);
    const ev = keys[rngInt(r, keys.length) - 1];
    opts.push({ type: 'event', event_id: ev, label: `奇遇：${ENCOUNTER_EVENTS[ev].title}` });
  } else if (t === 'rest') opts.push({ type: 'rest', label: '安全的角落（休息，恢復 30% 生命）' });
  else opts.push({ type: 'treasure', label: '散落的行囊（拾取物品）' });
  return opts;
}

// 掉落：先決定基礎物品，再依樓層與世界狀態擲詞綴（P07 稀有度掉落表）
function lootRoll(game, salt) {
  const fi = game.expedition.floor;
  const floor = floorData(game, fi);
  const r = { rng: hashSeed(game.seed, 'loot', game.expedition.id, fi, game.expedition.step, salt) };
  const base = floor.loot[rngInt(r, floor.loot.length) - 1];
  return rollAffixes(base, fi, dungeonState(game) === 'ember_return', r);
}
export function rollAffixes(base, floorIdx, ember, r) {
  const slot = itemDef(base).slot;
  const pool = Object.keys(AFFIXES).filter((a) => AFFIXES[a].slots.includes(slot));
  const t = AFFIX_TABLE;
  const p1 = t.first[floorIdx] + (ember ? t.emberBonus.first : 0);
  const p2 = t.second[floorIdx] + (ember ? t.emberBonus.second : 0);
  const out = [];
  if (rngInt(r, 100) <= p1) {
    out.push(pool[rngInt(r, pool.length) - 1]);
    if (rngInt(r, 100) <= p2) { const rest = pool.filter((a) => !out.includes(a)); out.push(rest[rngInt(r, rest.length) - 1]); }
  }
  return [base, ...out].join('~');
}

function advance(game) {
  const ex = game.expedition;
  ex.pending = null;
  ex.step += 1;
  if (ex.step >= STEPS_PER_FLOOR) { ex.step = 0; ex.floor += 1; }
  if (ex.floor >= DUNGEON.floors.length) return endExpedition(game, 'cleared');
  ex.choices = genChoices(game);
}

export function chooseRoute(game, idx) {
  const ex = game.expedition;
  if (!ex || ex.pending) throw new Error('現在不能選路');
  const c = ex.choices[idx];
  if (!c) throw new Error('無效選項');
  if (c.type === 'battle' || c.type === 'boss') { ex.pending = { ...c }; return 'battle'; }
  if (c.type === 'event') { ex.pending = { ...c }; return 'event'; }
  if (c.type === 'rest') {
    for (const id of game.party) { const max = effectiveStats(game, id).hp; ex.hp[id] = Math.min(max, ex.hp[id] + Math.max(1, Math.floor(max * 0.3))); }
    game.log.push('隊伍在角落稍作休息。');
  } else if (c.type === 'treasure') {
    const it = lootRoll(game, 'treasure');
    ex.loot.push(it); ex.gold += 10;
    game.log.push(`拾得 ${itemDef(it).name} 與 10 金幣。`);
  }
  advance(game);
  return 'map';
}

export function resolveEvent(game, choiceId) {
  const ex = game.expedition;
  if (!ex?.pending || ex.pending.type !== 'event') throw new Error('沒有進行中的奇遇');
  const ev = ENCOUNTER_EVENTS[ex.pending.event_id];
  const ch = ev.choices.find((c) => c.id === choiceId);
  if (!ch) throw new Error('無效選項');
  if (!eventChoiceAllowed(game, ch)) throw new Error('條件不足');
  const f = ch.effect;
  const msgs = [];
  if (f.hpAll) for (const id of game.party) ex.hp[id] = Math.max(1, ex.hp[id] + f.hpAll);
  if (f.healPct) for (const id of game.party) { const max = effectiveStats(game, id).hp; ex.hp[id] = Math.min(max, ex.hp[id] + Math.floor((max * f.healPct) / 100)); }
  if (f.gold) { ex.gold += f.gold; msgs.push(`+${f.gold} 金幣`); }
  if (f.potions) { game.potions += f.potions; msgs.push(`藥水 ${f.potions > 0 ? '+' : ''}${f.potions}`); }
  if (f.flag) { game.flags[f.flag] = true; msgs.push('獲得情報'); }
  let loot = f.loot ? 1 : 0;
  if (f.lootChance) { const r = { rng: hashSeed(game.seed, 'kick', ex.id, ex.floor, ex.step) }; if (rngInt(r, 100) <= f.lootChance) loot = 1; else msgs.push('箱子紋絲不動'); }
  if (loot) { const it = lootRoll(game, 'chest'); ex.loot.push(it); msgs.push(`獲得 ${itemDef(it).name}`); }
  game.log.push(`${ev.title}：${ch.label.split('（')[0]}${msgs.length ? '（' + msgs.join('，') + '）' : ''}`);
  advance(game);
  return msgs;
}

export function eventChoiceAllowed(game, ch) {
  const req = ch.require;
  if (!req) return true;
  if (req.potions && game.potions < req.potions) return false;
  if (req.anyOf && !req.anyOf.some((id) => game.party.includes(id))) return false;
  return true;
}

export function usePotion(game, id) {
  const ex = game.expedition;
  if (!ex || ex.pending) throw new Error('只能在探索時使用');
  if (game.potions < 1) throw new Error('沒有藥水');
  const max = effectiveStats(game, id).hp;
  if (ex.hp[id] >= max) throw new Error('生命已滿');
  game.potions -= 1;
  ex.hp[id] = Math.min(max, ex.hp[id] + POTION_HEAL);
}

export function retreat(game) {
  if (!game.expedition || game.expedition.pending) throw new Error('現在不能撤退');
  endExpedition(game, 'retreat');
}

function endExpedition(game, how) {
  const ex = game.expedition;
  if (how === 'defeat') {
    game.log.push(`隊伍在 ${DUNGEON.floors[ex.floor].name} 全滅，被路過的巡守救回營地。遠征所得全數遺失。`);
  } else {
    game.inventory.push(...ex.loot);
    game.gold += ex.gold;
    game.gems += ex.gems || 0;
    if (how === 'cleared') { game.clears += 1; game.log.push(`${DUNGEON.name} 攻略完成！帶回 ${ex.loot.length} 件物品與 ${ex.gold} 金幣。`); }
    else game.log.push(`隊伍撤退回營地，帶回 ${ex.loot.length} 件物品與 ${ex.gold} 金幣。`);
  }
  game.expedition = null;
  game.day += 1;
  game.lastExpeditionResult = how;
}

// ── 戰鬥 ──────────────────────────────────────────
export function beginBattle(game) {
  const ex = game.expedition;
  if (!ex?.pending || !['battle', 'boss'].includes(ex.pending.type)) throw new Error('沒有待開始的戰鬥');
  const n = game.battles_fought + 1;
  const combatants = game.party.map((id) => ({
    actor_id: id, name: CHARACTERS[id].name, team: 'party', stats: effectiveStats(game, id), skills: battleSkills(game, id), tactic: game.tactics[id], hp_start: ex.hp[id],
    resist_ids: resistIds(game, id),
  }));
  const counts = {};
  for (const eid of ex.pending.enemies) {
    counts[eid] = (counts[eid] || 0) + 1;
    const e = ENEMIES[eid];
    const dup = ex.pending.enemies.filter((x) => x === eid).length > 1;
    const sc = dungeonState(game) === 'ember_return' ? DUNGEON.emberScale : { hp: 100, atk: 100 };
    const stats = { ...e.stats, hp: Math.round((e.stats.hp * sc.hp) / 100), atk: Math.round((e.stats.atk * sc.atk) / 100) };
    combatants.push({ actor_id: `${eid}_${counts[eid]}`, type_id: eid, name: dup ? `${e.name} ${'ABC'[counts[eid] - 1]}` : e.name, team: 'enemy',
      stats, skills: e.skills, boss: e.boss, rival: e.rival, phase2: e.phase2 });
  }
  // 情報只對 Boss 戰有用；「託付」只帶入這次上陣的兩人
  const intel = ex.pending.type === 'boss' ? ['intel_boss', 'intel_phase2'].filter((f) => game.flags[f]) : [];
  const bonds = (game.entrusted || []).filter((p) => p.split('|').every((x) => game.party.includes(x)));
  return createBattle({ battleId: `b${n}`, seed: hashSeed(game.seed, 'battle', n), combatants, pairLevels: pairLevels(game, game.party), encounterId: `${DUNGEON.id}:${ex.floor}:${ex.step}`, intel, bonds });
}

/** 戰後結算。一致性驗證不通過就丟出錯誤，不寫入存檔。 */
export function finishBattle(game, record) {
  const errs = verifyRecord(record);
  if (errs.length) throw new Error('戰鬥紀錄驗證失敗：' + errs[0]);
  const ex = game.expedition;
  const evs = allEvents(record);
  const preMemories = [...game.memories];
  // 記憶（規則判定）
  const newMem = deriveMemories(record, { careerKills: Object.fromEntries(Object.entries(game.roster).map(([k, v]) => [k, v.career_kills])), existingKeys: new Set(game.memories.map((m) => m.key)), day: game.day });
  const memErrs = verifyMemories(newMem, record);
  if (memErrs.length) throw new Error(memErrs[0]);
  // 短演出（用戰前記憶產生變體；不入記憶）
  const moments = buildMoments(record, { memories: preMemories, history: game.history, density: game.settings.density });
  const momErrs = verifyMoments(moments, record);
  const safeMoments = momErrs.length ? [] : moments;

  // ── 以下開始寫入 ──
  game.battles_fought += 1;
  game.memories.push(...newMem);
  game.history.push({ battle_id: record.battle_id, kinds: safeMoments.map((m) => m.kind) });
  game.history = game.history.slice(-3);
  const last = record.turns.at(-1).end_snapshot.actors;
  const outcome = record.result.outcome;
  for (const id of game.party) {
    ex.hp[id] = last[id].alive ? last[id].hp : (outcome === 'victory' ? 1 : 0);
  }
  // 擊殺與經驗
  const byId = Object.fromEntries(evs.map((e) => [e.event_id, e]));
  for (const e of evs) if (e.event_type === 'actor_defeated') {
    const k = byId[e.source_event_id]?.actor_id;
    if (game.roster[k] && record.combatants.find((c) => c.actor_id === e.actor_id).team === 'enemy') game.roster[k].career_kills += 1;
  }
  const levelUps = [];
  if (outcome === 'victory') {
    const xp = record.combatants.filter((c) => c.team === 'enemy').reduce((s, c) => s + Math.ceil(c.hp_max / 2), 0);
    for (const id of game.party) {
      const r = game.roster[id];
      r.xp += xp;
      while (r.xp >= r.level * 60) { r.xp -= r.level * 60; r.level += 1; levelUps.push(id); ex.hp[id] += 6; }
    }
  }
  // 雙人熟練度：只算一對一；合作行為才加，收益遞減
  const pairGain = {};
  for (let i = 0; i < game.party.length; i++) for (let j = i + 1; j < game.party.length; j++) {
    const a = game.party[i], b = game.party[j];
    let acts = 0;
    for (const e of evs) {
      if (e.event_type === 'synergy_trigger_check' && e.calculation.success && e.calculation.pair_id === pairKey(a, b)) acts += 2;
      if (e.event_type === 'damage_applied' && e.flags?.intercepted_from && !e.flags.dot && pairKey(e.target_ids[0], e.flags.intercepted_from) === pairKey(a, b)) acts += 1;
      if (e.event_type === 'heal_applied' && pairKey(e.actor_id, e.target_ids[0]) === pairKey(a, b) && e.actor_id !== e.target_ids[0]) acts += 1;
    }
    const bothStood = last[a].alive && last[b].alive;
    if (outcome !== 'victory' && !bothStood) continue;
    const key = pairKey(a, b);
    const cur = game.pairs[key]?.xp || 0;
    const raw = (bothStood ? 3 : 1) + Math.min(6, acts);
    const gain = cur >= 100 ? 0 : Math.max(1, Math.round((raw * (100 - cur)) / 100));
    game.pairs[key] = { xp: Math.min(100, cur + gain) };
    pairGain[key] = gain;
  }
  // 命令獎勵（v0.8，測試數值）：只算命令裡配合的兩人
  const orderRewards = orderOutcome(record);
  for (const [key, n] of Object.entries(orderRewards.pairs)) {
    const cur = game.pairs[key]?.xp || 0;
    const add = Math.min(100 - cur, ORDER_REWARD.pairXp * n);
    if (add > 0) { game.pairs[key] = { xp: cur + add }; pairGain[key] = (pairGain[key] || 0) + add; }
    game.orderBond[key] = (game.orderBond[key] || 0) + n;
    if (game.orderBond[key] >= ORDER_REWARD.entrustAfter && !game.entrusted.includes(key)) {
      game.entrusted.push(key);
      orderRewards.unlocked.push(key);
      const [a, b] = key.split('|');
      game.log.push(`羈絆解鎖：${CHARACTERS[a].name}與${CHARACTERS[b].name}之間的【託付】。`);
      game.memories.push({ key: `entrusted:${key}`, type: 'entrusted', actors: [a, b], event_ids: orderRewards.events[key], ref_keys: [], witnesses: [a, b], battle_id: record.battle_id, day: game.day,
        text: `${CHARACTERS[a].name}與${CHARACTERS[b].name}照著你的命令一次次守住彼此，兩人之間有了【託付】（守護對方時防禦 +${ORDER_REWARD.entrustedDef}）。` });
    }
  }
  for (const id of Object.keys(orderRewards.affinity)) game.affinity[id] = Math.min(AFFINITY_MAX, (game.affinity[id] || 0) + 1);
  // 黑盒子觀測
  const d = game.discoveries.guardian_trust;
  const hiddenHits = evs.filter((e) => e.calculation?.hidden_modifier_ids?.includes('guardian_trust')).length;
  if (hiddenHits) {
    d.observations += hiddenHits;
    if (d.status === 'undiscovered' && d.observations >= 3) { d.status = 'suspected'; game.log.push('研究筆記：阿德守護小梅時，傷害似乎比預期少。'); }
  }
  // 戰利品
  let gold = 0, gems = 0;
  const loot = [];
  if (outcome === 'victory') {
    gold = record.combatants.filter((c) => c.team === 'enemy').length * 6;
    if (ex.pending.type === 'boss') {
      if (!game.flags.boss_defeated) {
        loot.push(...DUNGEON.bossLoot);
        game.flags.boss_defeated = true;
        game.flags.boss_defeated_day = game.day;
        game.log.push(`世界改變了：${DUNGEON.name}進入「${DUNGEON.states.ember_return.name}」。`);
      } else { loot.push(lootRoll(game, 'boss')); gold += 30; }
      game.flags.boss_kills = (game.flags.boss_kills || 0) + 1;
    } else if (ex.pending.bonusLoot) loot.push(lootRoll(game, 'bonus'));
    ex.gold += gold;
    ex.loot.push(...loot);
    gems = gemRoll(game, ex.pending.type === 'boss' && game.flags.boss_kills === 1, ex.pending.type === 'boss');
    ex.gems = (ex.gems || 0) + gems;
  }
  const report = { record, moments: safeMoments, moment_errors: momErrs, newMemories: newMem.map((m) => m.key), levelUps, pairGain, gold, gems, loot, orderRewards, day: game.day };
  game.reports.push(report);
  game.reports = game.reports.slice(-5);
  if (outcome === 'defeat') endExpedition(game, 'defeat');
  else if (outcome === 'retreat') endExpedition(game, 'retreat');
  else advance(game);
  return report;
}

/** 便利函式：自動打完一場（測試與「快速戰鬥」用） */
export function autoBattle(game, commandsFn = null) {
  const st = beginBattle(game);
  while (!st.done) stepRound(st, commandsFn ? commandsFn(st) : {});
  return finishBattle(game, st.record);
}

// ── 訓練場（研究黑盒子）：不給經驗、不給熟練度、不寫記憶 ─────────────
export function runExperiment(game, ward, trials = 6) {
  if (!['xiaomei', 'airin', 'rook'].includes(ward)) throw new Error('無效對象');
  const third = ['airin', 'rook', 'xiaomei'].find((x) => x !== ward);
  let intercepts = 0, hiddenCount = 0, defSum = 0;
  const baseDef = effectiveStats(game, 'ade').def;
  for (let t = 0; t < trials; t++) {
    const st = createBattle({
      battleId: `train_${ward}_${t}`, seed: hashSeed('training', t), encounterId: 'training',
      maxRounds: 6,
      pairLevels: pairLevels(game, ['ade', ward, third]),
      combatants: [
        { actor_id: 'ade', name: '阿德', team: 'party', stats: effectiveStats(game, 'ade'), skills: CHARACTERS.ade.skills, tactic: 'protect' },
        { actor_id: ward, name: CHARACTERS[ward].name, team: 'party', stats: { ...effectiveStats(game, ward), spd: 1 }, skills: CHARACTERS[ward].skills.slice(0, 1) },
        { actor_id: third, name: CHARACTERS[third].name, team: 'party', stats: { ...effectiveStats(game, third), atk: 1 }, skills: CHARACTERS[third].skills.slice(0, 1) },
        { actor_id: 'dummy', name: '訓練木樁', team: 'enemy', stats: { hp: 999, atk: 14, def: 0, spd: 20, crit: 0 }, skills: ['claw'] },
      ],
    });
    while (!st.done) {
      const cmd = {};
      if (!(st.actors.ade.cooldowns.guard > 0)) cmd.ade = { skill_id: 'guard', target_id: ward };
      stepRound(st, cmd);
    }
    for (const e of allEvents(st.record)) if (e.event_type === 'damage_applied' && e.flags?.intercepted_from === ward && !e.flags.dot) {
      intercepts += 1; defSum += e.calculation.defense; if (e.calculation.hidden_modifier_ids.length) hiddenCount += 1;
    }
  }
  const avgDef = intercepts ? defSum / intercepts : 0;
  const d = game.discoveries.guardian_trust;
  const anomaly = intercepts > 0 && avgDef > baseDef;
  if (ward === 'xiaomei' && anomaly && hiddenCount === intercepts) d.test_with = true;
  if (ward !== 'xiaomei' && intercepts > 0 && !anomaly) d.test_control = true;
  let confirmedNow = false;
  if (d.test_with && d.test_control && d.status !== 'confirmed') { d.status = 'confirmed'; confirmedNow = true; game.log.push(`研究確認：【${BONDS.guardian_trust.name}】`); }
  const result = { ward, trials, intercepts, baseDef, avgDef: Math.round(avgDef * 10) / 10, anomaly, unexplained: anomaly ? Math.round((avgDef - baseDef) * 10) / 10 : 0, confirmedNow, pairLevel: pairLevel(pairXp(game, 'ade', ward)) };
  if (confirmedNow) recordBondConfirmed(game, result);
  return result;
}

/** 研究確認後的記憶：實驗戰鬥不存檔，所以不引用 event_id；改引用前一筆 bond_oddity 記憶與實驗回傳值。確認前不會寫入，名稱與數字只在確認後出現。 */
function recordBondConfirmed(game, r) {
  const pair = pairKey('ade', 'xiaomei');
  const key = `bond_confirmed:${pair}`;
  if (game.memories.some((m) => m.key === key)) return;
  const odd = game.memories.find((m) => m.key === `bond_oddity:${pair}`);
  game.memories.push({
    key, type: 'bond_confirmed', actors: ['ade', 'xiaomei'], event_ids: [], ref_keys: odd ? [odd.key] : [],
    witnesses: ['ade', 'xiaomei'], battle_id: null, day: game.day,
    text: `研究室的對照實驗確認了阿德與小梅之間的【${BONDS.guardian_trust.name}】。最後一次實驗（阿德守護${CHARACTERS[r.ward].name}）：${r.trials} 場試驗中阿德代為承受 ${r.intercepts} 次攻擊，面板防禦 ${r.baseDef}，實際平均防禦 ${r.avgDef}。`,
  });
}

// ── 命令獎勵（v0.8，測試數值）──────────────────────────
export const ORDER_REWARD = { pairXp: 5, entrustAfter: 3, entrustedDef: ORDER_RULES.entrustedDef };
/**
 * 從事件判定命令成果（純函式）：
 * - 依命令守護／治療隊友，且對方撐到戰鬥結束 → 這兩人熟練度上升、雙方好感 +1
 * - 擊倒集火目標 → 擊倒者好感 +1
 */
export function orderOutcome(record) {
  const evs = allEvents(record);
  const last = record.turns.at(-1).end_snapshot.actors;
  const res = { pairs: {}, affinity: {}, events: {}, unlocked: [] };
  const seen = new Set();
  for (const e of evs) {
    if (e.event_type !== 'action_declared' || e.flags?.source !== 'order') continue;
    const sk = SKILLS[e.skill_id], T = e.target_ids[0];
    if (!['guard', 'heal'].includes(sk.kind) || !T || T === e.actor_id || !last[T]?.alive) continue;
    const key = pairKey(e.actor_id, T);
    if (seen.has(key)) continue;
    seen.add(key);
    res.pairs[key] = 1; res.events[key] = [e.event_id];
    res.affinity[e.actor_id] = 1; res.affinity[T] = 1;
  }
  const byId = Object.fromEntries(evs.map((e) => [e.event_id, e]));
  const focused = evs.filter((e) => e.event_type === 'order_given' && ['focus', 'exploit'].includes(e.flags.order.type));
  for (const e of evs) {
    if (e.event_type !== 'actor_defeated') continue;
    const killer = byId[e.source_event_id]?.actor_id;
    if (focused.some((o) => o.flags.order.target_id === e.actor_id && o.sequence < e.sequence) && record.combatants.find((c) => c.actor_id === killer)?.team === 'party') res.affinity[killer] = 1;
  }
  return res;
}

// ── 寶石與抽卡（v0.7，數值皆為測試用）──────────────────
// 寶石掉落用獨立亂數（salt 'gem'），不影響戰鬥與既有掉落結果
function gemRoll(game, bossFirst, boss) {
  if (bossFirst) return GEMS.bossFirst;
  if (boss) return GEMS.bossRepeat;
  const ex = game.expedition;
  const r = { rng: hashSeed(game.seed, 'gem', ex.id, ex.floor, ex.step) };
  return rngInt(r, 100) <= GEMS.battleChance ? 1 : 0;
}

/** 技能池：只有上陣角色、尚未學會的可學技能 */
export function skillPool(game) {
  return game.party.flatMap((id) => (LEARNABLE[id] || []).filter((s) => !game.roster[id].learned.includes(s)).map((skill_id) => ({ actor_id: id, skill_id })));
}

/**
 * 抽卡。pool：'recruit'（招募夥伴）或 'skill'（領悟技能）。opts.free：測試模式不扣寶石。
 * 結果由種子＋抽卡次數決定；招募到新夥伴時先進入 pendingRecruit，看完相遇故事才入隊。
 */
export function pull(game, pool, opts = {}) {
  if (!['recruit', 'skill'].includes(pool)) throw new Error('沒有這個卡池');
  if (game.expedition) throw new Error('遠征中不能抽卡');
  if (game.pendingRecruit) throw new Error('先完成和新夥伴的相遇');
  const cost = GACHA.cost[pool];
  if (!opts.free && game.gems < cost) throw new Error('寶石不足');
  const candidates = pool === 'skill' ? skillPool(game) : null;
  if (pool === 'skill' && !candidates.length) throw new Error('上陣角色沒有可領悟的技能了');
  const r = { rng: hashSeed(game.seed, 'gacha', game.pulls) };
  game.pulls += 1;
  if (!opts.free) game.gems -= cost;
  if (pool === 'skill') {
    const pick = candidates[rngInt(r, candidates.length) - 1];
    const mem = game.roster[pick.actor_id];
    mem.learned.push(pick.skill_id);
    if (mem.equipped.length < SKILL_SLOTS) mem.equipped.push(pick.skill_id);
    game.log.push(`${CHARACTERS[pick.actor_id].name}領悟了「${SKILLS[pick.skill_id].name}」。`);
    return { pool, ...pick };
  }
  const roll = rngInt(r, 100);
  let acc = 0;
  const rarity = GACHA.rates.find(([, p]) => (acc += p) >= roll)[0];
  const fresh = Object.values(CHARACTERS).filter((c) => c.recruit && c.rarity === rarity && !game.roster[c.id]);
  if (!fresh.length) {
    const refund = GACHA.duplicateRefund;
    if (!opts.free) game.gems += refund;
    game.log.push(`招募：${rarity} 的夥伴都已經在隊上了，退回 ${refund} 寶石。`);
    return { pool, rarity, duplicate: true, refund };
  }
  const c = fresh[rngInt(r, fresh.length) - 1];
  game.pendingRecruit = { id: c.id, rarity };
  return { pool, rarity, actor_id: c.id };
}

/** 相遇故事看完後入隊。story 只供重讀（標記是否為 AI），不會成為事實。 */
export function joinRecruit(game, story) {
  const p = game.pendingRecruit;
  if (!p) throw new Error('沒有等待入隊的夥伴');
  const text = typeof story?.text === 'string' ? story.text.slice(0, 600) : '';
  game.roster[p.id] = { ...newMember(p.id), meet: { text, ai: !!story?.ai, day: game.day } };
  game.tactics[p.id] = 'balanced';
  game.pendingRecruit = null;
  game.log.push(`${CHARACTERS[p.id].name}（${p.rarity}）加入了隊伍。`);
  return p.id;
}

// ── 存讀檔 ──────────────────────────────────────────
export function serialize(game) { return JSON.stringify(game); }

export function deserialize(text) {
  let g;
  try { g = JSON.parse(text); } catch { throw new Error('存檔不是有效的 JSON'); }
  if (!g || g.version !== SAVE_VERSION || typeof g.seed !== 'number' || !g.roster || !Array.isArray(g.party)) throw new Error('存檔格式不符');
  for (const id of STARTERS) if (!g.roster[id]) throw new Error('存檔缺少角色資料');
  if (Object.keys(g.roster).some((id) => !CHARACTERS[id])) throw new Error('存檔中有未知角色');
  if (g.party.some((id) => !g.roster[id])) throw new Error('存檔中有未知角色');
  // v0.7 相容：寶石、抽卡、可學技能
  g.gems ??= 0; g.pulls ??= 0; g.pendingRecruit ??= null; g.orderBond ??= {}; g.entrusted ??= [];
  if (!Array.isArray(g.entrusted) || g.entrusted.some((p) => typeof p !== 'string' || p.split('|').length !== 2 || p.split('|').some((x) => !CHARACTERS[x]) || (g.orderBond[p] || 0) < ORDER_REWARD.entrustAfter)) throw new Error('存檔中的羈絆資料不合法');
  for (const [id, r] of Object.entries(g.roster)) {
    r.learned ||= [];
    if (r.learned.some((s) => !(LEARNABLE[id] || []).includes(s))) throw new Error('存檔中有不合法的技能');
    r.equipped ||= defaultEquipped(id);
    const own = [...specials(id), ...r.learned];
    if (r.equipped.length > SKILL_SLOTS || r.equipped.some((s) => !own.includes(s))) throw new Error('存檔中有不合法的技能');
  }
  if (g.pendingRecruit && (!CHARACTERS[g.pendingRecruit.id]?.recruit || g.roster[g.pendingRecruit.id])) throw new Error('存檔中的招募資料不合法');
  if (typeof g.gems !== 'number' || g.gems < 0) throw new Error('存檔中的寶石數量不合法');
  for (const r of g.reports || []) if (verifyRecord(r.record).length) throw new Error('存檔中的戰鬥紀錄驗證失敗');
  // v0.3 → v0.4 相容：補上新欄位
  g.affinity ||= {}; g.talked ||= {}; g.flags ||= {};
  // 物品 ID 必須能解析（v0.5 詞綴格式向下相容）
  const allItems = [...(g.inventory || []), ...Object.values(g.roster).flatMap((r) => Object.values(r.equip || {}).filter(Boolean)), ...(g.expedition?.loot || [])];
  if (allItems.some((id) => !itemDef(id))) throw new Error('存檔中有未知物品');
  return g;
}
