// 詞綴掉落統計（純函式，只量測不改數值）。
// samples: [{ group: '第1次', loot: ['sword~keen', ...] }]（loot 為該次遠征取得的物品 ID）
import { itemDef } from '../src/data.js';

export function lootStats(samples) {
  const groups = {};
  for (const s of samples) {
    const g = (groups[s.group] ||= { expeditions: 0, items: 0, affixed: 0, affixCounts: {}, fireproofRuns: 0 });
    g.expeditions += 1;
    let fire = false;
    for (const id of s.loot) {
      const def = itemDef(id);
      const ids = id.split('~').slice(1);
      g.items += 1;
      if (ids.length) g.affixed += 1;
      for (const a of ids) g.affixCounts[a] = (g.affixCounts[a] || 0) + 1;
      if (def.slot === 'armor' && ids.includes('fireproof')) fire = true;
    }
    if (fire) g.fireproofRuns += 1;
  }
  return Object.fromEntries(Object.entries(groups).map(([k, g]) => [k, {
    expeditions: g.expeditions,
    avgItems: +(g.items / g.expeditions).toFixed(2),
    affixedRate: g.items ? Math.round((g.affixed * 100) / g.items) : 0,
    affixCounts: g.affixCounts,
    fireproofRate: Math.round((g.fireproofRuns * 100) / g.expeditions),
  }]));
}
