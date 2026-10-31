// 寶石收入統計（純函式，只量測不改數值）。
// samples: [{ seed, run, gems, bossFirst }]（gems 為該次遠征實際帶回的寶石；全滅遺失者為 0；bossFirst 為該次首次擊敗 Boss）
// cost: { recruit, skill }（GACHA.cost）
export function gemStats(samples, cost) {
  const runs = {};
  const seeds = {};
  for (const s of samples) {
    const r = (runs[s.run] ||= { expeditions: 0, gems: 0, bossFirst: 0 });
    r.expeditions += 1;
    r.gems += s.gems;
    if (s.bossFirst) r.bossFirst += 1;
    (seeds[s.seed] ||= {})[s.run] = s.gems;
  }
  const seedList = Object.values(seeds);
  const out = {};
  let cum = 0;
  for (const k of Object.keys(runs).map(Number).sort((a, b) => a - b)) {
    const r = runs[k];
    // 累計：每個種子到第 k 次為止帶回的寶石平均
    const total = seedList.reduce((a, o) => a + Object.entries(o).filter(([run]) => +run <= k).reduce((b, [, g]) => b + g, 0), 0);
    cum = total / seedList.length;
    out['第' + k + '次'] = {
      expeditions: r.expeditions,
      avgGems: +(r.gems / r.expeditions).toFixed(2),
      bossFirstRate: Math.round((r.bossFirst * 100) / r.expeditions),
      cumGems: +cum.toFixed(2),
      cumRecruit: +(cum / cost.recruit).toFixed(2),
      cumSkill: +(cum / cost.skill).toFixed(2),
    };
  }
  return out;
}
