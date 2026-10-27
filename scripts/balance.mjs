// 批次平衡模擬：node scripts/balance.mjs [種子數]
// 每個種子連跑 5 次遠征：前幾次是「灰燼瀰漫」，擊敗 Boss 後世界轉為「餘燼回流」。
import * as G from '../src/game.js';
import { ENCOUNTER_EVENTS } from '../src/data.js';
import { lootStats } from './lootstats.mjs';
const N = +(process.argv[2] || 200);
const RUNS = 5;
const res = {};
for (let r = 1; r <= RUNS; r++) res['run' + r] = { cleared: 0, defeat: 0, retreat: 0 };
const ember = { cleared: 0, defeat: 0, retreat: 0 };
const defeatFloor = [0, 0, 0];
const lootSamples = [];
let battles = 0, rounds = 0, phase2 = 0, bossFights = 0;
for (let s = 1; s <= N; s++) {
  const g = G.newGame(s * 7919);
  for (let run = 1; run <= RUNS; run++) {
    const wasEmber = G.dungeonState(g) === 'ember_return';
    G.startExpedition(g);
    const lootRef = g.expedition.loot; // 同一個陣列會一路累積到遠征結束
    let floorAt = 0;
    while (g.expedition) {
      const ex = g.expedition; floorAt = ex.floor;
      for (const id of g.party) if (g.potions > 0 && ex.hp[id] < G.effectiveStats(g, id).hp * 0.4) G.usePotion(g, id);
      let idx = ex.choices.findIndex((c) => c.type !== 'battle'); if (idx < 0) idx = 0;
      const boss = ex.choices[idx].type === 'boss';
      const r = G.chooseRoute(g, idx);
      if (r === 'battle') {
        const rep = G.autoBattle(g); battles++; rounds += rep.record.result.ended_turn;
        if (boss) { bossFights++; if (rep.record.turns.some((t) => t.events.some((e) => e.event_type === 'phase_changed'))) phase2++; }
      } else if (r === 'event') { const ch = ENCOUNTER_EVENTS[g.expedition.pending.event_id].choices.find((c) => G.eventChoiceAllowed(g, c)); G.resolveEvent(g, ch.id); }
    }
    lootSamples.push({ group: '第' + run + '次', loot: lootRef });
    if (wasEmber) lootSamples.push({ group: '餘燼回流', loot: lootRef });
    res['run' + run][g.lastExpeditionResult]++;
    if (wasEmber) ember[g.lastExpeditionResult]++;
    if (g.lastExpeditionResult === 'defeat') defeatFloor[floorAt]++;
    // 回城：裝備最好的、買藥
    for (const it of [...g.inventory]) for (const id of g.party) { try { G.equip(g, id, it); break; } catch {} }
    while (g.gold >= 20 && g.potions < 3) G.buyPotion(g);
  }
}
const pct = (o) => `${Math.round((o.cleared * 100) / (o.cleared + o.defeat + o.retreat || 1))}%`;
console.log(JSON.stringify({ N, ...res, clearRate: Object.fromEntries(Object.entries(res).map(([k, v]) => [k, pct(v)])), emberReturn: { ...ember, rate: pct(ember) }, defeatFloor, avgRounds: (rounds / battles).toFixed(1), bossPhase2Rate: `${Math.round((phase2 * 100) / (bossFights || 1))}%` }));

console.log('詞綴掉落統計（每次遠征取得，含全滅遺失者）：');
console.log(JSON.stringify(lootStats(lootSamples)));
