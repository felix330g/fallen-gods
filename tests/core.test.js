import test from 'node:test';
import assert from 'node:assert/strict';
import { createBattle, stepRound, runAuto, verifyRecord, replay, validateCommand, pairKey } from '../src/engine.js';
import { computeStats, simpleLog, detailedLog, allEvents } from '../src/report.js';
import { deriveMemories, verifyMemories } from '../src/memory.js';
import { buildMoments, verifyMoments } from '../src/narration.js';
import { CHARACTERS, ENEMIES, ENCOUNTER_EVENTS } from '../src/data.js';
import * as G from '../src/game.js';

const mk = (seed, opts = {}) => createBattle({
  battleId: 't' + seed, seed, pairLevels: opts.pairLevels || {},
  combatants: [
    ...(opts.party || ['airin', 'ade', 'xiaomei']).map((id) => ({ actor_id: id, name: CHARACTERS[id].name, team: 'party', stats: { ...CHARACTERS[id].stats }, skills: CHARACTERS[id].skills, tactic: opts.tactic })),
    ...(opts.enemies || ['goblin', 'slime']).map((id, i) => ({ actor_id: `${id}_${i + 1}`, type_id: id, name: ENEMIES[id].name, team: 'enemy', stats: { ...ENEMIES[id].stats }, skills: ENEMIES[id].skills, rival: ENEMIES[id].rival, boss: ENEMIES[id].boss, phase2: ENEMIES[id].phase2 })),
  ],
});

test('重播：同 seed 同輸入，事件完全一致', () => {
  for (let s = 1; s <= 30; s++) {
    const a = runAuto(mk(s)), b = runAuto(mk(s));
    assert.equal(JSON.stringify(a), JSON.stringify(b));
    assert.equal(JSON.stringify(replay(a)), JSON.stringify(a));
  }
});

test('重播：含玩家指令的戰鬥也能完整重現', () => {
  const st = mk(42);
  stepRound(st, { airin: { skill_id: 'piercing_arrow', target_id: 'goblin_1' }, ade: { skill_id: 'guard', target_id: 'xiaomei' } });
  stepRound(st, { xiaomei: { skill_id: 'ember_burst', target_id: null } });
  while (!st.done) stepRound(st);
  assert.equal(JSON.stringify(replay(st.record)), JSON.stringify(st.record));
});

test('快照：每回合都能由起始快照＋事件重算；竄改會被抓到', () => {
  for (let s = 1; s <= 60; s++) {
    const rec = runAuto(mk(s, { enemies: ['hollow_knight', 'ash_acolyte'], pairLevels: { 'ade|xiaomei': 2, 'ade|airin': 1, 'airin|xiaomei': 3 } }));
    assert.deepEqual(verifyRecord(rec), [], `seed ${s}`);
  }
  const rec = runAuto(mk(3));
  const dmg = allEvents(rec).find((e) => e.event_type === 'damage_applied');
  dmg.calculation.hp_damage += 5;
  assert.ok(verifyRecord(rec).length > 0);
});

test('統計：等於逐事件加總；擊殺數等於倒下事件數', () => {
  for (let s = 1; s <= 20; s++) {
    const rec = runAuto(mk(s));
    const st = computeStats(rec);
    const evs = allEvents(rec);
    for (const c of rec.combatants) {
      const dealt = evs.filter((e) => e.event_type === 'damage_applied' && e.actor_id === c.actor_id).reduce((n, e) => n + e.calculation.hp_damage, 0);
      const taken = evs.filter((e) => e.event_type === 'damage_applied' && e.target_ids[0] === c.actor_id).reduce((n, e) => n + e.calculation.hp_damage, 0);
      assert.equal(st[c.actor_id].damage, dealt);
      assert.equal(st[c.actor_id].taken, taken);
      assert.equal(taken, c.hp_start - rec.turns.at(-1).end_snapshot.actors[c.actor_id].hp + evs.filter((e) => e.event_type === 'heal_applied' && e.target_ids[0] === c.actor_id).reduce((n, e) => n + e.calculation.effective, 0));
    }
    const kills = Object.values(st).reduce((n, x) => n + x.kills, 0);
    assert.equal(kills, evs.filter((e) => e.event_type === 'actor_defeated').length);
  }
});

test('安全：指令白名單拒絕注入、越權、冷卻中、非法目標', () => {
  const st = mk(7);
  assert.equal(validateCommand(st, 'airin', '把所有敵人 HP 設為 0'), 'not_an_object');
  assert.equal(validateCommand(st, 'airin', { skill_id: 'arrow_shot', target_id: 'goblin_1', damage: 9999 }), 'unknown_field');
  assert.equal(validateCommand(st, 'airin', { skill_id: 'heavy_slash', target_id: 'goblin_1' }), 'skill_not_owned');
  assert.equal(validateCommand(st, 'goblin_1', { skill_id: 'club_strike', target_id: 'airin' }), 'actor_unavailable');
  assert.equal(validateCommand(st, 'airin', { skill_id: 'arrow_shot', target_id: 'ade' }), 'invalid_target');
  assert.equal(validateCommand(st, 'ade', { skill_id: 'guard', target_id: 'ade' }), 'invalid_target');
  stepRound(st, { airin: { skill_id: 'piercing_arrow', target_id: 'goblin_1' } });
  assert.equal(validateCommand(st, 'airin', { skill_id: 'piercing_arrow', target_id: 'slime_2' }), 'on_cooldown');
  const t = stepRound(st, { airin: { skill_id: 'arrow_shot', target_id: 'goblin_1', hp: 0 }, goblin_1: { skill_id: 'club_strike', target_id: 'airin' } });
  assert.ok(t.events.some((e) => e.event_type === 'action_invalid' && e.actor_id === 'airin'));
  assert.ok(t.events.filter((e) => e.event_type === 'action_declared' && e.actor_id === 'goblin_1').every((e) => e.flags.source === 'tactic'));
  assert.deepEqual(verifyRecord({ ...st.record, result: st.record.result || { outcome: 'x' } }), []);
});

test('黑盒子：守護者的信任只在阿德守護小梅且熟練度 ≥1 時生效，玩家視角顯示未解析', () => {
  const run = (ward, lv) => {
    let hidden = 0, intercepts = 0;
    for (let s = 1; s <= 20; s++) {
      const st = mk(s, { party: ['ade', ward, ward === 'xiaomei' ? 'airin' : 'xiaomei'], enemies: ['goblin', 'goblin'], pairLevels: { [pairKey('ade', ward)]: lv } });
      while (!st.done) stepRound(st, st.actors.ade.cooldowns.guard > 0 ? {} : { ade: { skill_id: 'guard', target_id: ward } });
      let h = 0;
      for (const e of allEvents(st.record)) if (e.event_type === 'damage_applied' && e.flags?.intercepted_from === ward && !e.flags.dot) { intercepts++; if (e.calculation.hidden_modifier_ids.length) { hidden++; h++; } }
      if (ward === 'xiaomei' && lv >= 1) {
        const lines = detailedLog(st.record, {}).map((l) => l.text).join('\n');
        if (h) { assert.match(lines, /未解析效果/); assert.doesNotMatch(lines, /守護者的信任/); }
        const known = detailedLog(st.record, { guardian_trust: { status: 'confirmed' } }).map((l) => l.text).join('\n');
        if (h) assert.match(known, /守護者的信任/);
      }
    }
    return { hidden, intercepts };
  };
  const yes = run('xiaomei', 1);
  assert.ok(yes.intercepts > 0 && yes.hidden === yes.intercepts);
  assert.equal(run('xiaomei', 0).hidden, 0);
  const ctl = run('airin', 3);
  assert.ok(ctl.intercepts > 0); assert.equal(ctl.hidden, 0);
});

test('記憶：只記規則事實、可回溯事件、去重、只有站著的人記得', () => {
  const rec = runAuto(mk(5, { enemies: ['hollow_knight'], pairLevels: { 'ade|airin': 4, 'airin|xiaomei': 4, 'ade|xiaomei': 4 } }));
  const m1 = deriveMemories(rec, { careerKills: {}, existingKeys: new Set(), day: 1 });
  assert.deepEqual(verifyMemories(m1, rec), []);
  const keys = m1.map((m) => m.key);
  assert.equal(new Set(keys).size, keys.length);
  const m2 = deriveMemories(rec, { careerKills: {}, existingKeys: new Set(keys), day: 1 });
  assert.equal(m2.length, 0, '同一場重看不會重複寫入');
  const standing = Object.entries(rec.turns.at(-1).end_snapshot.actors).filter(([, a]) => a.alive).map(([id]) => id);
  for (const m of m1) for (const w of m.witnesses) assert.ok(standing.includes(w));
  const fake = [{ key: 'x', battle_id: rec.battle_id, event_ids: ['nope'] }];
  assert.equal(verifyMemories(fake, rec).length, 1);
});

test('演出：擊殺歸屬正確、引用真實事件；捏造會被驗證器擋下', () => {
  for (let s = 1; s <= 20; s++) {
    const rec = runAuto(mk(s, { pairLevels: { 'ade|airin': 3, 'airin|xiaomei': 3 } }));
    const ms = buildMoments(rec, { density: 6 });
    assert.deepEqual(verifyMoments(ms, rec), []);
    assert.ok(ms.length <= 6);
  }
  const rec = runAuto(mk(1));
  const kill = allEvents(rec).find((e) => e.event_type === 'actor_defeated');
  const wrong = rec.combatants.find((c) => c.team === 'party' && c.actor_id !== allEvents(rec).find((e) => e.event_id === kill.source_event_id).actor_id);
  assert.equal(verifyMoments([{ kind: 'first_kill', speaker: wrong.actor_id, event_ids: [kill.event_id], text: '' }], rec).length, 1);
});

function playExpedition(g) {
  G.startExpedition(g);
  let guard = 0;
  while (g.expedition && guard++ < 40) {
    const ex = g.expedition;
    for (const id of g.party) if (g.potions > 0 && ex.hp[id] < G.effectiveStats(g, id).hp * 0.4) G.usePotion(g, id);
    let idx = ex.choices.findIndex((c) => c.type !== 'battle'); if (idx < 0) idx = 0;
    const r = G.chooseRoute(g, idx);
    if (r === 'battle') G.autoBattle(g);
    else if (r === 'event') G.resolveEvent(g, ENCOUNTER_EVENTS[g.expedition.pending.event_id].choices.find((c) => G.eventChoiceAllowed(g, c)).id);
  }
  return g.lastExpeditionResult;
}

test('遊戲流程：完整遠征可跑完，結果決定性', () => {
  const a = G.newGame(123), b = G.newGame(123);
  const ra = playExpedition(a), rb = playExpedition(b);
  assert.ok(['cleared', 'defeat', 'retreat'].includes(ra));
  assert.equal(ra, rb);
  assert.equal(G.serialize(a), G.serialize(b));
  assert.equal(a.day, 2);
});

test('羈絆：換第三人不影響既有搭檔的熟練度', () => {
  const g = G.newGame(9);
  g.pairs[pairKey('ade', 'airin')] = { xp: 40 };
  G.setParty(g, ['ade', 'airin', 'rook']);
  playExpedition(g);
  const after1 = g.pairs[pairKey('ade', 'airin')].xp;
  assert.ok(after1 >= 40, '老搭檔不會因新人掉熟練度');
  assert.equal(g.pairs[pairKey('ade', 'xiaomei')], undefined, '不在隊伍的組合不變');
  assert.ok(!Object.keys(g.pairs).some((k) => k.split('|').length !== 2), '沒有三人或整隊數值');
});

test('訓練場：對照實驗確認隱藏羈絆，且不給經驗／熟練度／記憶', () => {
  const g = G.newGame(1);
  g.pairs[pairKey('ade', 'xiaomei')] = { xp: 30 };
  const before = JSON.stringify({ r: g.roster, p: g.pairs, m: g.memories });
  const ctl = G.runExperiment(g, 'airin');
  assert.equal(ctl.anomaly, false);
  assert.equal(g.discoveries.guardian_trust.status, 'undiscovered');
  const res = G.runExperiment(g, 'xiaomei');
  assert.ok(res.anomaly && res.unexplained === 3);
  assert.equal(g.discoveries.guardian_trust.status, 'confirmed');
  assert.equal(JSON.stringify({ r: g.roster, p: g.pairs, m: g.memories }), before);
  const g2 = G.newGame(1);
  G.runExperiment(g2, 'airin'); G.runExperiment(g2, 'xiaomei');
  assert.notEqual(g2.discoveries.guardian_trust.status, 'confirmed', '熟練度不足時沒有差異，不能確認');
});

test('存檔：來回一致；壞檔與竄改的戰鬥紀錄被拒絕；驗證失敗不寫入', () => {
  const g = G.newGame(77);
  playExpedition(g);
  const g2 = G.deserialize(G.serialize(g));
  assert.equal(G.serialize(g2), G.serialize(g));
  assert.throws(() => G.deserialize('{bad'));
  assert.throws(() => G.deserialize(JSON.stringify({ ...g, version: 99 })));
  const t = JSON.parse(G.serialize(g));
  if (t.reports.length) {
    t.reports[0].record.turns[0].end_snapshot.actors[t.party[0]].hp = 9999;
    assert.throws(() => G.deserialize(JSON.stringify(t)));
  }
  const h = G.newGame(5);
  G.startExpedition(h);
  const idx = h.expedition.choices.findIndex((c) => c.type === 'battle');
  G.chooseRoute(h, idx);
  const st = G.beginBattle(h);
  while (!st.done) stepRound(st);
  st.record.turns[0].events.find((e) => e.event_type === 'damage_applied').calculation.hp_damage = 0;
  const snap = G.serialize(h);
  assert.throws(() => G.finishBattle(h, st.record));
  assert.equal(G.serialize(h), snap);
});

test('簡易戰報：每次行動一行，敵我皆有', () => {
  const rec = runAuto(mk(11));
  const lines = simpleLog(rec);
  const actions = allEvents(rec).filter((e) => e.event_type === 'action_declared').length;
  const dots = allEvents(rec).filter((e) => e.event_type === 'damage_applied' && e.flags?.dot).length;
  assert.equal(lines.length, actions + dots);
});

// ── v0.4 ──────────────────────────────────────────
const bossFight = (s) => runAuto(mk(s, { party: ['airin', 'ade', 'rook'], enemies: ['hollow_knight'], pairLevels: { 'ade|airin': 2, 'airin|rook': 2, 'ade|rook': 2 } }));

test('Boss 第二階段：HP 首次 ≤50% 觸發一次，有來源事件，換技能組，可重播', () => {
  let seen = 0;
  for (let s = 1; s <= 40; s++) {
    const rec = bossFight(s);
    const evs = allEvents(rec);
    const ph = evs.filter((e) => e.event_type === 'phase_changed');
    assert.ok(ph.length <= 1, '只觸發一次');
    assert.deepEqual(verifyRecord(rec), []);
    assert.equal(JSON.stringify(replay(rec)), JSON.stringify(rec));
    if (!ph.length) continue;
    seen++;
    const e = ph[0];
    const src = evs.find((x) => x.event_id === e.source_event_id);
    assert.equal(src.event_type, 'damage_applied');
    assert.ok(src.after.hp * 100 <= 250 * 50 && src.before.hp * 100 > 250 * 50, '剛好跨過門檻');
    const after = evs.filter((x) => x.sequence > e.sequence && x.event_type === 'action_declared' && x.actor_id === 'hollow_knight_1');
    assert.ok(after.every((x) => ['ember_rage', 'heavy_slash', 'club_strike'].includes(x.skill_id)));
    assert.ok(after.length === 0 || after.some((x) => x.skill_id === 'ember_rage'), '第二階段會用餘燼狂怒');
    const atkAfter = evs.find((x) => x.sequence > e.sequence && x.event_type === 'damage_applied' && x.actor_id === 'hollow_knight_1' && !x.flags?.dot);
    if (atkAfter) assert.equal(atkAfter.calculation.attack, ENEMIES.hollow_knight.stats.atk + 3);
    assert.match(detailedLog(rec).map((l) => l.text).join('\n'), /進入第二階段/);
    const ms = buildMoments(rec, { density: 6 });
    assert.deepEqual(verifyMoments(ms, rec), []);
  }
  assert.ok(seen >= 20, `大多數 Boss 戰會進入第二階段（${seen}/40）`);
});

test('Boss 第二階段：偽造的階段事件會被驗證器擋下', () => {
  const rec = bossFight(4);
  const t = rec.turns[0];
  t.events.push({ event_id: 'fake', event_type: 'phase_changed', actor_id: 'hollow_knight_1', source_event_id: t.events[0].event_id, target_ids: [], after: { atk_bonus: 3, skills_added: [] }, calculation: {} });
  assert.ok(verifyRecord(rec).some((x) => x.includes('階段轉換')));
  const rec2 = runAuto(mk(4));
  assert.ok(verifyMoments([{ kind: 'phase', speaker: 'goblin_1', event_ids: [allEvents(rec2)[0].event_id], text: '' }], rec2).length === 1);
});

test('世界改變：擊敗 Boss 後地窖進入餘燼回流，遭遇與奇遇隨之改變', () => {
  const g = G.newGame(31);
  assert.equal(G.dungeonState(g), 'normal');
  const normalEnemies = new Set(G.floorData(g, 0).encounters.flat());
  assert.ok(!normalEnemies.has('ember_hound'));
  g.flags.boss_defeated = true;
  assert.equal(G.dungeonState(g), 'ember_return');
  assert.ok(G.floorData(g, 0).encounters.flat().includes('ember_hound'));
  assert.equal(G.floorData(g, 0).name, '第一層・崩塌的儲藏室', '地名不變');
  // 餘燼回流專屬奇遇只在對應狀態出現
  const seen = new Set();
  for (let s = 1; s <= 60; s++) {
    for (const flag of [false, true]) {
      const h = G.newGame(s); if (flag) h.flags.boss_defeated = true;
      G.startExpedition(h);
      for (const c of h.expedition.choices) if (c.type === 'event') seen.add(`${flag}:${c.event_id}`);
    }
  }
  assert.ok(!seen.has('false:ember_vent'));
});

test('世界改變：玩到第一次擊敗 Boss 時寫入旗標與紀錄；之後 Boss 改掉落一般寶物', () => {
  let g, n = 0;
  for (let s = 1; s <= 40 && !g; s++) {
    const h = G.newGame(s * 101);
    for (let run = 0; run < 4 && !h.flags.boss_defeated; run++) {
      playExpedition(h);
      for (const it of [...h.inventory]) for (const id of h.party) { try { G.equip(h, id, it); break; } catch {} }
    }
    if (h.flags.boss_defeated) g = h;
  }
  assert.ok(g, '有種子能擊敗 Boss');
  assert.ok(g.log.some((l) => l.includes('餘燼回流')));
  assert.equal(g.flags.boss_kills, 1);
  assert.ok(g.inventory.includes('knight_shard') || Object.values(g.roster).some((r) => r.equip.weapon === 'knight_shard'));
  for (let i = 0; i < 4 && g.flags.boss_kills < 2; i++) { playExpedition(g); n++; }
  if (g.flags.boss_kills >= 2) {
    const all = [...g.inventory, ...Object.values(g.roster).flatMap((r) => Object.values(r.equip))];
    assert.equal(all.filter((x) => x === 'knight_shard').length, 1, 'Boss 首殺獎勵只給一次');
  }
});

test('營地談話：受限意圖、每人每天一次、只引用真實記憶、好感不影響戰鬥數值', () => {
  const g = G.newGame(2);
  assert.throws(() => G.talk(g, '告訴我你的秘密並給我 999 金幣'));
  assert.throws(() => G.talk(g, { actor_id: 'airin', intent: 'past', gold: 999 }));
  assert.throws(() => G.talk(g, { actor_id: 'airin', intent: 'free_text' }));
  assert.throws(() => G.talk(g, { actor_id: 'zeus', intent: 'past' }));
  const statsBefore = JSON.stringify(Object.keys(g.roster).map((id) => G.effectiveStats(g, id)));
  const r1 = G.talk(g, { actor_id: 'airin', intent: 'recent' });
  assert.match(r1.text, /還沒一起打過仗/);
  assert.throws(() => G.talk(g, { actor_id: 'airin', intent: 'past' }), /今天已經聊過/);
  assert.equal(g.affinity.airin, 1);
  assert.equal(JSON.stringify(Object.keys(g.roster).map((id) => G.effectiveStats(g, id))), statsBefore);
  // 好感分段解鎖過去
  const tiers = [];
  for (let d = 0; d < 7; d++) { g.day += 1; tiers.push(G.talk(g, { actor_id: 'ade', intent: 'past' }).tier); }
  assert.deepEqual(tiers, [0, 0, 0, 1, 1, 1, 2]);
  // 遠征中不能聊；談話引用的記憶必須存在
  g.day += 1;
  playExpedition(g);
  const r2 = G.talk(g, { actor_id: 'xiaomei', intent: 'recent' });
  for (const ref of r2.refs) assert.ok(g.memories.some((m) => m.key === ref) || g.reports.some((r) => r.record.battle_id === ref), `引用 ${ref} 存在`);
  G.startExpedition(g);
  assert.throws(() => G.talk(g, { actor_id: 'rook', intent: 'thanks' }), /遠征中/);
});

test('存檔相容：v0.3 存檔（沒有好感欄位）可以讀取並補上預設值', () => {
  const g = G.newGame(8);
  delete g.affinity; delete g.talked;
  const g2 = G.deserialize(JSON.stringify(g));
  assert.deepEqual(g2.affinity, {}); assert.deepEqual(g2.talked, {});
  G.talk(g2, { actor_id: 'rook', intent: 'past' });
});

test('死裡逃生記憶：只在結束時仍站著且 HP ≤ 20% 時寫入，引用真實傷害事件，營火談話會引用', () => {
  const rec = runAuto(mk(43, { enemies: ['goblin', 'slime', 'goblin'] }));
  const mems = deriveMemories(rec, { careerKills: {}, existingKeys: new Set(), day: 1 }).filter((m) => m.type === 'brink');
  assert.ok(mems.length >= 1);
  assert.deepEqual(verifyMemories(mems, rec), []);
  const last = rec.turns.at(-1).end_snapshot.actors;
  for (const m of mems) {
    const a = last[m.actors[0]], c = rec.combatants.find((x) => x.actor_id === m.actors[0]);
    assert.ok(a.alive && a.hp * 100 <= c.hp_max * 20, '結束時仍站著且 ≤20% HP');
    assert.match(m.text, new RegExp(`僅剩 ${a.hp} 點`), '數字等於結束快照');
  }
  const again = deriveMemories(rec, { careerKills: {}, existingKeys: new Set(mems.map((m) => m.key)), day: 1 });
  assert.equal(again.filter((m) => m.type === 'brink').length, 0, '去重');
  const g = G.newGame(3);
  g.memories = [{ ...mems[0], key: mems[0].key }];
  const id = mems[0].actors[0];
  const line = G.talk(g, { actor_id: id, intent: 'recent' });
  assert.match(line.text, /只剩一口氣/);
  assert.deepEqual(line.refs, [mems[0].key]);
});
