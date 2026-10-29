// 戰鬥引擎：唯一權威。所有結果寫成 append-only 事件，戰報／演出／記憶都只讀事件。
import { rngInt } from './rng.js';
import { SKILLS, STATUSES, BONDS, RESISTS, RULES_VERSION, MAX_ROUNDS } from './data.js';

export const pairKey = (a, b) => [a, b].sort().join('|');
export const pairLevel = (xp) => Math.min(4, Math.floor((xp || 0) / 25));

const clone = (o) => JSON.parse(JSON.stringify(o));

/**
 * combatants: [{actor_id, name, team:'party'|'enemy', stats:{hp,atk,def,spd,crit}, skills, tactic?, hp_start?, boss?, rival?, type_id, phase2?}]
 * pairLevels: {pairKey: level}
 */
export function createBattle({ battleId, seed, combatants, pairLevels = {}, maxRounds = MAX_ROUNDS, encounterId = 'custom', intel = [], bonds = [] }) {
  const record = {
    battle_id: battleId, rules_version: RULES_VERSION, rng_seed: seed >>> 0, encounter_id: encounterId,
    combatants: combatants.map((c) => ({
      actor_id: c.actor_id, name: c.name, team: c.team, type_id: c.type_id || c.actor_id,
      stats: { ...c.stats }, hp_max: c.hp_max ?? c.stats.hp, hp_start: c.hp_start ?? c.stats.hp,
      skills: [...c.skills], tactic: c.tactic || 'balanced', boss: !!c.boss, rival: !!c.rival,
      ...(c.resist_ids?.length ? { resist_ids: [...c.resist_ids] } : {}),
      ...(c.phase2 ? { phase2: clone(c.phase2) } : {}),
    })),
    pair_levels: { ...pairLevels },
    max_rounds: maxRounds,
    turns: [],
    player_commands: {},
    result: null,
  };
  // v0.8：情報與已解鎖的「託付」羈絆（有才寫，舊紀錄不變）
  if (intel.length) record.intel = [...intel];
  if (bonds.length) record.bonds = [...bonds];
  const actors = {};
  for (const c of record.combatants) {
    actors[c.actor_id] = { hp: c.hp_start, shield: 0, alive: c.hp_start > 0, cooldowns: {}, statuses: [], phase: 1, atk_bonus: 0 };
  }
  return { record, actors, rng: seed >>> 0, seq: 0, round: 0, done: false };
}

export function snapshot(state) {
  return { actors: clone(state.actors) };
}

const info = (state, id) => state.record.combatants.find((c) => c.actor_id === id);
const alive = (state, team) => state.record.combatants.filter((c) => c.team === team && state.actors[c.actor_id].alive);
const foe = (team) => (team === 'party' ? 'enemy' : 'party');
/** 目前可用的技能清單（第二階段會換技能組） */
export const currentSkills = (state, id) => {
  const c = info(state, id);
  return state.actors[id].phase === 2 && c.phase2 ? c.phase2.skills : c.skills;
};

function emit(state, turn, type, fields = {}) {
  state.seq += 1;
  const ev = { event_id: `${state.record.battle_id}:e${state.seq}`, battle_id: state.record.battle_id, turn_number: turn.turn_number,
    sequence: state.seq, event_type: type, target_ids: [], ...fields };
  turn.events.push(ev);
  return ev;
}

function hasStatus(state, id, sid) {
  return state.actors[id].statuses.find((s) => s.status_id === sid);
}

function effAtk(state, id) {
  const base = info(state, id).stats.atk + (state.actors[id].atk_bonus || 0);
  return hasStatus(state, id, 'weaken') ? Math.floor((base * STATUSES.weaken.atkPct) / 100) : base;
}

function checkEnd(state, turn) {
  if (state.done) return true;
  const p = alive(state, 'party').length, e = alive(state, 'enemy').length;
  if (p && e) return false;
  const outcome = e === 0 ? 'victory' : 'defeat';
  state.done = true;
  state.record.result = { outcome, end_reason: e === 0 ? 'enemies_defeated' : 'party_defeated', winner_team: e === 0 ? 'party' : 'enemy', ended_turn: turn.turn_number };
  emit(state, turn, 'battle_ended', { reason_code: state.record.result.end_reason, flags: { outcome } });
  return true;
}

function defeat(state, turn, targetId, sourceEvent) {
  const a = state.actors[targetId];
  a.alive = false; a.statuses = []; a.shield = 0;
  emit(state, turn, 'actor_defeated', { actor_id: targetId, source_event_id: sourceEvent.event_id, flags: { killer_id: sourceEvent.actor_id } });
}

// Boss 第二階段：HP 首次降到門檻以下（且還活著）時觸發一次。只改攻擊加成與技能組，不改 HP。
function checkPhase(state, turn, id, sourceEv) {
  const c = info(state, id), a = state.actors[id];
  if (!c.phase2 || a.phase !== 1 || !a.alive) return;
  if (a.hp * 100 > c.hp_max * c.phase2.at_pct) return;
  a.phase = 2;
  a.atk_bonus += c.phase2.atk_bonus;
  a.cooldowns = {};
  const added = c.phase2.skills.filter((s) => !c.skills.includes(s));
  emit(state, turn, 'phase_changed', { actor_id: id, source_event_id: sourceEv.event_id,
    calculation: { hp: a.hp, hp_max: c.hp_max, threshold_pct: c.phase2.at_pct },
    after: { phase: 2, atk_bonus: c.phase2.atk_bonus, skills_added: added } });
}

// 有效 HP 傷害；護盾先吸收
function applyDamage(state, turn, srcId, tgtId, skillId, calc, flags = {}) {
  const t = state.actors[tgtId];
  const before = { hp: t.hp, shield: t.shield };
  const absorbed = Math.min(t.shield, calc.raw_damage);
  const rest = calc.raw_damage - absorbed;
  const hpDmg = Math.min(t.hp, rest);
  t.shield -= absorbed; t.hp -= hpDmg;
  const ev = emit(state, turn, 'damage_applied', { actor_id: srcId, target_ids: [tgtId], skill_id: skillId, before,
    calculation: { ...calc, shield_absorbed: absorbed, hp_damage: hpDmg, overkill: rest - hpDmg }, after: { hp: t.hp, shield: t.shield }, flags });
  if (t.hp <= 0) defeat(state, turn, tgtId, ev);
  else checkPhase(state, turn, tgtId, ev);
  return ev;
}

function applyStatus(state, turn, srcId, tgtId, app, sourceEv) {
  const def = STATUSES[app.status_id];
  const a = state.actors[tgtId];
  if (!a.alive) return;
  const ex = a.statuses.find((s) => s.status_id === app.status_id);
  if (ex) {
    ex.remaining_turns = app.turns;
    ex.stacks = Math.min(def.maxStacks, ex.stacks + 1);
    ex.source_id = srcId;
  } else {
    a.statuses.push({ status_id: app.status_id, stacks: 1, remaining_turns: app.turns, source_id: srcId, power: app.power || 0 });
  }
  emit(state, turn, 'status_applied', { actor_id: srcId, target_ids: [tgtId], skill_id: sourceEv?.skill_id, source_event_id: sourceEv?.event_id,
    after: { status_id: app.status_id, stacks: (ex || a.statuses.at(-1)).stacks, remaining_turns: app.turns } });
}

// 淨化：依固定優先順序移除負面狀態（灼燒 → 流血 → 虛弱），寫成 status_removed 事件
const CLEANSE_ORDER = ['burn', 'bleed', 'weaken'];
function cleanse(state, turn, srcId, tgtId, count, sourceEv) {
  const a = state.actors[tgtId];
  for (let n = 0; n < count; n++) {
    const s = CLEANSE_ORDER.map((sid) => a.statuses.find((x) => x.status_id === sid)).find(Boolean);
    if (!s) return;
    a.statuses = a.statuses.filter((x) => x !== s);
    emit(state, turn, 'status_removed', { actor_id: srcId, target_ids: [tgtId], skill_id: sourceEv.skill_id, source_event_id: sourceEv.event_id,
      before: { status_id: s.status_id, stacks: s.stacks, remaining_turns: s.remaining_turns }, after: { status_id: s.status_id } });
  }
}
const hasNegative = (state, id) => state.actors[id].statuses.some((s) => STATUSES[s.status_id].negative);

function resolveIntercept(state, turn, tgtId) {
  const prot = hasStatus(state, tgtId, 'protected');
  if (!prot) return { target: tgtId };
  const g = prot.source_id;
  if (!state.actors[g]?.alive || g === tgtId) return { target: tgtId };
  return { target: g, intercepted_from: tgtId };
}

// 單次攻擊：命中 → 暴擊 → 傷害（含攔截、隱藏修正）→ 附加狀態
function attack(state, turn, srcId, origTgt, skill, mult, extraFlags = {}) {
  const src = info(state, srcId);
  const { target: tgtId, intercepted_from } = resolveIntercept(state, turn, origTgt);
  const tgt = info(state, tgtId);
  const hitChance = Math.max(70, Math.min(99, 90 + (src.stats.spd - tgt.stats.spd) * 2));
  const hitRoll = rngInt(state, 100);
  const hit = hitRoll <= hitChance;
  const hitEv = emit(state, turn, 'hit_check', { actor_id: srcId, target_ids: [tgtId], skill_id: skill.id, calculation: { chance: hitChance, roll: hitRoll, success: hit }, flags: { ...extraFlags, intercepted_from } });
  if (!hit) return { hit: false, ev: hitEv };
  const critRoll = rngInt(state, 100);
  const crit = critRoll <= src.stats.crit;
  emit(state, turn, 'critical_check', { actor_id: srcId, target_ids: [tgtId], skill_id: skill.id, calculation: { chance: src.stats.crit, roll: critRoll, success: crit } });
  const atk = effAtk(state, srcId);
  let raw = Math.floor((atk * mult) / 100);
  if (crit) raw = Math.floor((raw * 150) / 100);
  let def = tgt.stats.def;
  const hidden = [];
  let hiddenDef = 0;
  if (intercepted_from) {
    const b = BONDS.guardian_trust;
    if (pairKey(tgtId, intercepted_from) === b.pair && (state.record.pair_levels[b.pair] || 0) >= 1) {
      hidden.push(b.id); hiddenDef = b.defBonus; def += hiddenDef;
    }
  }
  // 公開修正（v0.8）：情報命令與「託付」羈絆。數值寫進 calculation，戰報可回算
  const known = [];
  if (intercepted_from && (state.record.bonds || []).includes(pairKey(tgtId, intercepted_from))) { known.push('entrusted'); def += ORDER_RULES.entrustedDef; }
  if (tgt.team === 'party' && skill.target === 'all_enemies' && state.braceUntil >= state.round) { known.push('intel_brace'); def += ORDER_RULES.braceDef; }
  if (src.team === 'party' && tgt.boss && state.order?.type === 'exploit') { known.push('intel_exploit'); raw = Math.floor((raw * ORDER_RULES.exploitPct) / 100); }
  if (skill.pierce) def = Math.floor(def / 2);
  const dmg = Math.max(1, raw - def);
  const ev = applyDamage(state, turn, srcId, tgtId, skill.id, {
    attack: atk, multiplier: mult, critical: crit, base: raw, defense: def, hidden_modifier_ids: hidden, hidden_def_bonus: hiddenDef, raw_damage: dmg,
    ...(known.length ? { known_modifier_ids: known } : {}),
  }, { ...extraFlags, intercepted_from });
  if (skill.applies && state.actors[tgtId].alive && !extraFlags.chain) applyStatus(state, turn, srcId, tgtId, skill.applies, ev);
  return { hit: true, ev, tgtId };
}

// 連攜追擊：資格機會 → 擲骰 → 成功才追擊
function tryChain(state, turn, srcId, tgtId) {
  if (!state.actors[tgtId]?.alive) return;
  const team = info(state, srcId).team;
  if (team !== 'party') return;
  for (const p of alive(state, 'party')) {
    if (p.actor_id === srcId) continue;
    const key = pairKey(srcId, p.actor_id);
    const lv = state.record.pair_levels[key] || 0;
    if (lv < 1) continue;
    const chance = 10 + 5 * lv;
    const roll = rngInt(state, 100);
    const ok = roll <= chance;
    emit(state, turn, 'synergy_trigger_check', { actor_id: p.actor_id, target_ids: [tgtId], skill_id: 'chain_followup',
      calculation: { pair_id: key, level: lv, chance, roll, success: ok }, flags: { partner_id: srcId, bond_id: 'chain_followup' } });
    if (ok) {
      const basic = SKILLS[info(state, p.actor_id).skills[0]];
      attack(state, turn, p.actor_id, tgtId, basic, 50, { chain: true, partner_id: srcId });
      return;
    }
  }
}

const ready = (state, id, sid) => !(state.actors[id].cooldowns[sid] > 0);
const hpPct = (state, id) => (state.actors[id].hp * 100) / info(state, id).hp_max;

// 戰術 AI（我方）與敵方 AI
export function chooseAction(state, id) {
  const me = info(state, id);
  const allies = alive(state, me.team);
  const foes = alive(state, foe(me.team));
  const skills = currentSkills(state, id).map((s) => SKILLS[s]);
  if (me.team === 'enemy') {
    const sk = skills.find((s) => ready(state, id, s.id) && s.cd > 0) || skills.find((s) => s.cd === 0);
    const tgt = foes[rngInt(state, foes.length) - 1];
    return { skill_id: sk.id, target_id: sk.target === 'all_enemies' ? null : tgt.actor_id };
  }
  const ord = state.order;
  const tactic = ord?.type === 'tactic' ? ord.value : (me.tactic || 'balanced');
  const live = (tid) => state.actors[tid]?.alive;
  // 玩家命令（已由 validateOrder 驗證）：保護 → 爆發 → 集火，其餘照戰術
  if (ord?.type === 'protect' && live(ord.target_id)) {
    const T = ord.target_id;
    const h = skills.find((s) => s.kind === 'heal' && ready(state, id, s.id));
    if (h && hpPct(state, T) < 90) return { skill_id: h.id, target_id: T, source: 'order' };
    const gd = skills.find((s) => s.kind === 'guard' && ready(state, id, s.id));
    if (gd && T !== id && !hasStatus(state, T, 'protected')) return { skill_id: gd.id, target_id: T, source: 'order' };
  }
  const focus = (ord?.type === 'focus' || ord?.type === 'exploit') && live(ord.target_id) ? ord.target_id : null;
  if (state.burstRound === state.round) {
    const top = skills.filter((s) => s.kind === 'attack' && ready(state, id, s.id)).sort((a, b) => b.mult - a.mult)[0];
    const low = [...foes].sort((a, b) => state.actors[a.actor_id].hp - state.actors[b.actor_id].hp)[0];
    if (top) return { skill_id: top.id, target_id: top.target === 'all_enemies' ? null : (focus ?? low.actor_id), source: 'order' };
  }
  const healTh = { protect: 70, balanced: 50, aggressive: 35 }[tactic] ?? 50;
  const heal = skills.find((s) => s.kind === 'heal' && ready(state, id, s.id));
  if (heal) {
    const low = allies.filter((a) => hpPct(state, a.actor_id) < healTh).sort((a, b) => hpPct(state, a.actor_id) - hpPct(state, b.actor_id))[0];
    if (low) return { skill_id: heal.id, target_id: low.actor_id };
    if (heal.cleanse && tactic !== 'aggressive') {
      const dirty = allies.filter((a) => hasNegative(state, a.actor_id) && hpPct(state, a.actor_id) < 85).sort((a, b) => hpPct(state, a.actor_id) - hpPct(state, b.actor_id))[0];
      if (dirty) return { skill_id: heal.id, target_id: dirty.actor_id };
    }
  }
  const guard = skills.find((s) => s.kind === 'guard' && ready(state, id, s.id));
  if (guard && tactic !== 'aggressive') {
    const th = tactic === 'protect' ? 85 : 60;
    const low = allies.filter((a) => a.actor_id !== id && hpPct(state, a.actor_id) < th && !hasStatus(state, a.actor_id, 'protected'))
      .sort((a, b) => hpPct(state, a.actor_id) - hpPct(state, b.actor_id))[0];
    if (low) return { skill_id: guard.id, target_id: low.actor_id };
  }
  const shield = skills.find((s) => s.kind === 'shield' && ready(state, id, s.id));
  if (shield && tactic !== 'aggressive' && allies.some((a) => hpPct(state, a.actor_id) < 75)) return { skill_id: shield.id, target_id: null };
  const atks = skills.filter((s) => s.kind === 'attack' && ready(state, id, s.id));
  if (focus) {
    const single = atks.filter((s) => s.target === 'enemy').sort((a, b) => b.mult - a.mult)[0];
    if (single) return { skill_id: single.id, target_id: focus, source: 'order' };
  }
  const aoe = atks.find((s) => s.target === 'all_enemies');
  if (aoe && foes.length >= 2) return { skill_id: aoe.id, target_id: null };
  const best = atks.filter((s) => s.target === 'enemy').sort((a, b) => b.mult - a.mult)[0];
  const sorted = [...foes].sort((a, b) => tactic === 'protect'
    ? b.stats.atk - a.stats.atk || state.actors[a.actor_id].hp - state.actors[b.actor_id].hp
    : state.actors[a.actor_id].hp - state.actors[b.actor_id].hp);
  return { skill_id: best.id, target_id: sorted[0].actor_id };
}

// 玩家指令白名單驗證：只接受結構化 {skill_id, target_id}，任何其他欄位或自由文字都被拒絕
export function validateCommand(state, id, cmd) {
  if (!cmd || typeof cmd !== 'object' || Array.isArray(cmd)) return 'not_an_object';
  const keys = Object.keys(cmd);
  if (keys.some((k) => k !== 'skill_id' && k !== 'target_id')) return 'unknown_field';
  const me = info(state, id);
  if (!me || me.team !== 'party' || !state.actors[id].alive) return 'actor_unavailable';
  if (typeof cmd.skill_id !== 'string' || !currentSkills(state, id).includes(cmd.skill_id)) return 'skill_not_owned';
  const sk = SKILLS[cmd.skill_id];
  if (!ready(state, id, sk.id)) return 'on_cooldown';
  if (sk.target === 'enemy' || sk.target === 'ally') {
    const t = info(state, cmd.target_id);
    const wantTeam = sk.target === 'enemy' ? 'enemy' : 'party';
    if (!t || t.team !== wantTeam || !state.actors[t.actor_id].alive) return 'invalid_target';
    if (sk.kind === 'guard' && t.actor_id === id) return 'invalid_target';
  }
  return null;
}

function execute(state, turn, id, act) {
  const sk = SKILLS[act.skill_id];
  const me = info(state, id);
  emit(state, turn, 'action_declared', { actor_id: id, target_ids: act.target_id ? [act.target_id] : [], skill_id: sk.id, flags: { source: act.source } });
  if (sk.cd > 0) {
    state.actors[id].cooldowns[sk.id] = sk.cd + 1; // 本回合結束會減 1
    emit(state, turn, 'cooldown_changed', { actor_id: id, skill_id: sk.id, after: { cooldown: sk.cd } });
  }
  if (sk.kind === 'attack') {
    const targets = sk.target === 'all_enemies' ? alive(state, foe(me.team)).map((c) => c.actor_id) : [act.target_id];
    for (const t of targets) {
      if (!state.actors[t]?.alive) continue;
      const r = attack(state, turn, id, t, sk, sk.mult);
      if (r.hit && sk.target === 'enemy') tryChain(state, turn, id, r.tgtId);
      if (checkEnd(state, turn)) return;
    }
  } else if (sk.kind === 'heal') {
    const t = state.actors[act.target_id];
    const amount = sk.power + Math.floor((effAtk(state, id) * sk.mult) / 100);
    const eff = Math.min(amount, info(state, act.target_id).hp_max - t.hp);
    const before = { hp: t.hp };
    t.hp += eff;
    const healEv = emit(state, turn, 'heal_applied', { actor_id: id, target_ids: [act.target_id], skill_id: sk.id, before, after: { hp: t.hp },
      calculation: { amount, effective: eff, overheal: amount - eff } });
    if (sk.cleanse) cleanse(state, turn, id, act.target_id, sk.cleanse, healEv);
  } else if (sk.kind === 'guard') {
    applyStatus(state, turn, id, id, { status_id: 'guarding', turns: 2 }, { skill_id: sk.id });
    applyStatus(state, turn, id, act.target_id, { status_id: 'protected', turns: 2 }, { skill_id: sk.id });
  } else if (sk.kind === 'shield') {
    for (const a of alive(state, me.team)) {
      const s = state.actors[a.actor_id];
      const before = { shield: s.shield };
      s.shield += sk.power;
      emit(state, turn, 'shield_applied', { actor_id: id, target_ids: [a.actor_id], skill_id: sk.id, before, after: { shield: s.shield }, calculation: { amount: sk.power } });
    }
  }
}

function endOfRound(state, turn) {
  for (const c of state.record.combatants) {
    const a = state.actors[c.actor_id];
    if (!a.alive) continue;
    for (const s of [...a.statuses]) {
      const def = STATUSES[s.status_id];
      if (def.dot && a.alive) {
        const full = s.power * s.stacks;
        const resist_ids = (c.resist_ids || []).filter((r) => RESISTS[r] === s.status_id);
        const dmg = resist_ids.length ? Math.max(1, Math.floor(full / 2)) : full;
        const calc = { raw_damage: dmg, dot: true, stacks: s.stacks, power: s.power };
        if (resist_ids.length) { calc.resist_ids = resist_ids; calc.resisted = full - dmg; }
        const ev = applyDamage(state, turn, s.source_id, c.actor_id, s.status_id, calc, { dot: true });
        ev.event_type = 'damage_applied';
        ev.reason_code = 'status_tick';
        if (checkEnd(state, turn)) return;
      }
      if (!a.alive) break;
      s.remaining_turns -= 1;
      if (s.remaining_turns <= 0) {
        a.statuses = a.statuses.filter((x) => x !== s);
        emit(state, turn, 'status_expired', { target_ids: [c.actor_id], after: { status_id: s.status_id } });
      }
    }
    for (const k of Object.keys(a.cooldowns)) a.cooldowns[k] = Math.max(0, a.cooldowns[k] - 1);
  }
}

// ── 玩家命令（v0.8）：只接受白名單結構，由引擎驗證後才影響行動 ──────────
export const ORDER_RULES = { braceDef: 3, exploitPct: 120, entrustedDef: 2 };
const ORDER_FIELDS = { focus: ['target_id'], protect: ['target_id'], tactic: ['value'], burst: [], retreat: [], brace: [], exploit: ['target_id'] };
export const ORDER_TYPES = Object.keys(ORDER_FIELDS);
export function validateOrder(state, order) {
  if (!order || typeof order !== 'object' || Array.isArray(order)) return 'not_an_object';
  if (!ORDER_FIELDS[order.type]) return 'unknown_type';
  if (Object.keys(order).some((k) => k !== 'type' && !ORDER_FIELDS[order.type].includes(k))) return 'unknown_field';
  const t = order.target_id !== undefined ? info(state, order.target_id) : null;
  const intel = state.record.intel || [];
  switch (order.type) {
    case 'focus': if (!t || t.team !== 'enemy' || !state.actors[t.actor_id].alive) return 'invalid_target'; break;
    case 'protect': if (!t || t.team !== 'party' || !state.actors[t.actor_id].alive) return 'invalid_target'; break;
    case 'tactic': if (!['aggressive', 'balanced', 'protect'].includes(order.value)) return 'invalid_value'; break;
    case 'brace':
      if (!intel.length) return 'needs_intel';
      if (!alive(state, 'enemy').some((c) => c.boss)) return 'no_boss';
      break;
    case 'exploit':
      if (!intel.includes('intel_phase2')) return 'needs_intel';
      if (!t || !t.boss || !state.actors[t.actor_id].alive) return 'invalid_target';
      if (state.actors[t.actor_id].phase !== 2) return 'not_yet';
      break;
  }
  return null;
}
function applyOrder(state, turn, order) {
  if (order === undefined || order === null) return;
  state.record.player_orders ||= {};
  state.record.player_orders[state.round] = clone(order);
  const err = validateOrder(state, order);
  if (err) { emit(state, turn, 'order_invalid', { reason_code: err, flags: { order: clone(order) } }); return; }
  emit(state, turn, 'order_given', { target_ids: order.target_id ? [order.target_id] : [], flags: { order: clone(order) } });
  if (order.type === 'burst') state.burstRound = state.round;
  else if (order.type === 'brace') state.braceUntil = state.round + 1;
  else if (order.type === 'retreat') state.retreatAt = state.round;
  else state.order = clone(order);
}

/** 推進一回合。commands: {actor_id: {skill_id, target_id}}（僅限我方，可省略＝自動）；order：玩家命令（可省略） */
export function stepRound(state, commands = {}, order = null) {
  if (state.done) return null;
  state.round += 1;
  const turn = { turn_number: state.round, start_snapshot: snapshot(state), events: [], end_snapshot: null };
  state.record.turns.push(turn);
  if (Object.keys(commands).length) state.record.player_commands[state.round] = clone(commands);
  emit(state, turn, 'turn_start');
  applyOrder(state, turn, order);
  const queue = state.record.combatants.map((c, i) => ({ c, i })).filter(({ c }) => state.actors[c.actor_id].alive)
    .sort((x, y) => y.c.stats.spd - x.c.stats.spd || (x.c.team === y.c.team ? 0 : x.c.team === 'party' ? -1 : 1) || x.i - y.i)
    .map(({ c }) => c.actor_id);
  for (const id of queue) {
    if (state.done) break;
    if (!state.actors[id].alive) continue;
    let act = null;
    const cmd = commands[id];
    if (cmd !== undefined && info(state, id).team === 'party') {
      const err = validateCommand(state, id, cmd);
      if (err) emit(state, turn, 'action_invalid', { actor_id: id, reason_code: err });
      else act = { ...cmd, source: 'player' };
    }
    if (!act) act = { source: 'tactic', ...chooseAction(state, id) };
    execute(state, turn, id, act);
    if (checkEnd(state, turn)) break;
  }
  if (!state.done) endOfRound(state, turn);
  if (!state.done && state.retreatAt === state.round) {
    state.done = true;
    state.record.result = { outcome: 'retreat', end_reason: 'player_order', winner_team: null, ended_turn: turn.turn_number };
    emit(state, turn, 'battle_ended', { reason_code: 'player_order', flags: { outcome: 'retreat' } });
  }
  if (!state.done && state.round >= state.record.max_rounds) {
    state.done = true;
    state.record.result = { outcome: 'retreat', end_reason: 'round_limit', winner_team: null, ended_turn: turn.turn_number };
    emit(state, turn, 'battle_ended', { reason_code: 'round_limit', flags: { outcome: 'retreat' } });
  }
  emit(state, turn, 'turn_end');
  turn.end_snapshot = snapshot(state);
  return turn;
}

export function runAuto(state) {
  while (!state.done) stepRound(state);
  return state.record;
}

// 一致性驗證：每回合從起始快照＋事件重算 HP／護盾，必須等於結束快照；階段轉換必須有真實來源且符合門檻
export function verifyRecord(record) {
  const errors = [];
  let prev = null;
  const byId = Object.fromEntries(record.turns.flatMap((t) => t.events.map((e) => [e.event_id, e])));
  const ids = new Set(Object.keys(byId));
  for (const t of record.turns) {
    if (prev && JSON.stringify(prev) !== JSON.stringify(t.start_snapshot)) errors.push(`回合 ${t.turn_number} 起始快照不連續`);
    const hp = {}, sh = {};
    for (const [id, a] of Object.entries(t.start_snapshot.actors)) { hp[id] = a.hp; sh[id] = a.shield; }
    for (const e of t.events) {
      if (e.event_type === 'damage_applied') {
        const id = e.target_ids[0];
        if (hp[id] !== e.before.hp || sh[id] !== e.before.shield) errors.push(`${e.event_id} before 不符`);
        sh[id] -= e.calculation.shield_absorbed; hp[id] -= e.calculation.hp_damage;
        if (e.calculation.dot) {
          const c = record.combatants.find((x) => x.actor_id === id);
          const full = e.calculation.power * e.calculation.stacks;
          const want = (c.resist_ids || []).filter((r) => RESISTS[r] === e.skill_id);
          const got = e.calculation.resist_ids || [];
          const expect = want.length ? Math.max(1, Math.floor(full / 2)) : full;
          if (JSON.stringify(want) !== JSON.stringify(got) || e.calculation.raw_damage !== expect || (e.calculation.resisted || 0) !== full - expect) errors.push(`${e.event_id} 持續傷害減免對不上`);
        }
        if (e.calculation.shield_absorbed + e.calculation.hp_damage + e.calculation.overkill !== e.calculation.raw_damage) errors.push(`${e.event_id} 傷害拆分不平衡`);
        for (const m of e.calculation.known_modifier_ids || []) {
          const ok = m === 'entrusted' ? !!e.flags?.intercepted_from && (record.bonds || []).includes(pairKey(id, e.flags.intercepted_from))
            : m === 'intel_brace' ? (record.intel || []).length > 0 && [t.turn_number, t.turn_number - 1].some((n) => record.player_orders?.[n]?.type === 'brace')
            : m === 'intel_exploit' ? (record.intel || []).includes('intel_phase2') && Object.entries(record.player_orders || {}).some(([n, o]) => o?.type === 'exploit' && +n <= t.turn_number)
            : false;
          if (!ok) errors.push(`${e.event_id} 修正 ${m} 沒有對應的命令、情報或羈絆`);
        }
      } else if (e.event_type === 'heal_applied') {
        hp[e.target_ids[0]] += e.calculation.effective;
      } else if (e.event_type === 'shield_applied') {
        sh[e.target_ids[0]] += e.calculation.amount;
      } else if (e.event_type === 'actor_defeated') {
        sh[e.actor_id] = 0;
      } else if (e.event_type === 'status_removed') {
        if (!ids.has(e.source_event_id) || byId[e.source_event_id].event_type !== 'heal_applied' || byId[e.source_event_id].target_ids[0] !== e.target_ids[0]) errors.push(`${e.event_id} 淨化沒有對應的治療事件`);
      } else if (e.event_type === 'phase_changed') {
        const c = record.combatants.find((x) => x.actor_id === e.actor_id);
        if (!c?.phase2 || !ids.has(e.source_event_id) || hp[e.actor_id] * 100 > c.hp_max * c.phase2.at_pct) errors.push(`${e.event_id} 階段轉換不合規則`);
      }
    }
    for (const [id, a] of Object.entries(t.end_snapshot.actors)) {
      if (a.hp !== hp[id]) errors.push(`回合 ${t.turn_number} ${id} HP 重算 ${hp[id]} ≠ 快照 ${a.hp}`);
      if (a.shield !== sh[id]) errors.push(`回合 ${t.turn_number} ${id} 護盾重算 ${sh[id]} ≠ 快照 ${a.shield}`);
    }
    prev = t.end_snapshot;
  }
  if (!record.result) errors.push('戰鬥沒有結果');
  return errors;
}

/** 以紀錄中的設定與玩家指令重播，檢查是否完全一致 */
export function replay(record, commandsByTurn = record.player_commands || {}, ordersByTurn = record.player_orders || {}) {
  const st = createBattle({ battleId: record.battle_id, seed: record.rng_seed, encounterId: record.encounter_id, maxRounds: record.max_rounds,
    pairLevels: record.pair_levels, intel: record.intel || [], bonds: record.bonds || [],
    combatants: record.combatants.map((c) => ({ ...c, stats: { ...c.stats } })) });
  while (!st.done) stepRound(st, commandsByTurn[st.round + 1] || {}, ordersByTurn[st.round + 1] ?? null);
  return st.record;
}
