// 結構化記憶：只有規則判定的重大事實才寫入；台詞、AI 輸出一律不入記憶。
import { pairKey } from './engine.js';
import { allEvents } from './report.js';

// 「瀕死」門檻（最大 HP 的百分比）：守護救援與治療救援共用
export const NEAR_DEATH_PCT = 30;

const nameOf = (rec, id) => rec.combatants.find((c) => c.actor_id === id)?.name ?? id;

/**
 * 依戰鬥紀錄判定新的記憶。
 * ctx: { careerKills: {actor_id: n}, existingKeys: Set, day }
 */
export function deriveMemories(rec, ctx) {
  const out = [];
  const keys = new Set(ctx.existingKeys);
  const party = rec.combatants.filter((c) => c.team === 'party');
  const last = rec.turns.at(-1)?.end_snapshot.actors || {};
  const witnesses = party.filter((c) => last[c.actor_id]?.alive).map((c) => c.actor_id);
  const evs = allEvents(rec);
  const byId = Object.fromEntries(evs.map((e) => [e.event_id, e]));
  const add = (key, type, actors, event_ids, text) => {
    if (keys.has(key) || !witnesses.length) return;
    keys.add(key);
    out.push({ key, type, actors, event_ids, witnesses, battle_id: rec.battle_id, day: ctx.day, text });
  };
  // 追蹤即時 HP，用來判定「瀕死」
  const hp = {};
  for (const c of rec.combatants) hp[c.actor_id] = c.hp_start;
  for (const t of rec.turns) {
    for (const [id, a] of Object.entries(t.start_snapshot.actors)) hp[id] = a.hp;
    for (const e of t.events) {
      if (e.event_type === 'damage_applied') {
        const tgt = e.target_ids[0];
        const from = e.flags?.intercepted_from;
        if (from && !e.flags.dot) {
          const ally = rec.combatants.find((c) => c.actor_id === from);
          if (ally.team === 'party' && hp[from] * 100 < ally.hp_max * NEAR_DEATH_PCT) {
            add(`guard_save:${pairKey(tgt, from)}`, 'guard_save', [tgt, from], [e.event_id],
              `${nameOf(rec, tgt)} 在 ${nameOf(rec, from)} 瀕死時替她擋下了致命一擊。`);
          }
          // 首次觀察到黑盒子效果：只記事實（傷害數字取自事件），不揭露效果名稱與數值
          if (ally.team === 'party' && e.calculation.hidden_modifier_ids?.length) {
            add(`bond_oddity:${pairKey(tgt, from)}`, 'bond_oddity', [tgt, from], [e.event_id],
              `${nameOf(rec, tgt)} 替 ${nameOf(rec, from)} 擋下攻擊，只受到 ${e.calculation.raw_damage} 點傷害——戰報裡有一項未解析的效果。`);
          }
        }
        hp[tgt] = e.after.hp;
      } else if (e.event_type === 'heal_applied') {
        const tgt = e.target_ids[0], healer = e.actor_id;
        const ally = rec.combatants.find((c) => c.actor_id === tgt);
        if (healer !== tgt && ally.team === 'party' && e.before.hp * 100 < ally.hp_max * NEAR_DEATH_PCT) {
          add(`heal_save:${pairKey(healer, tgt)}`, 'heal_save', [healer, tgt], [e.event_id],
            `${nameOf(rec, healer)} 在 ${nameOf(rec, tgt)} 瀕死（HP ${e.before.hp}/${ally.hp_max}）時治療了 ${nameOf(rec, tgt)}，恢復 ${e.calculation.effective} 點。`);
        }
        hp[tgt] = e.after.hp;
      } else if (e.event_type === 'actor_defeated') {
        const src = byId[e.source_event_id];
        const killer = src?.actor_id;
        const victim = rec.combatants.find((c) => c.actor_id === e.actor_id);
        const kc = rec.combatants.find((c) => c.actor_id === killer);
        if (kc?.team === 'party' && victim.team === 'enemy') {
          if (!(ctx.careerKills[killer] > 0)) add(`first_kill:${killer}`, 'first_kill', [killer], [e.event_id], `${nameOf(rec, killer)} 第一次親手擊倒敵人（${victim.name}）。`);
          if (victim.rival) add(`rival:${victim.type_id}`, 'rival_defeated', [killer], [e.event_id], `${nameOf(rec, killer)} 擊倒了宿敵 ${victim.name}。`);
        }
      } else if (e.event_type === 'synergy_trigger_check' && e.calculation.success) {
        const pid = e.calculation.pair_id;
        add(`first_chain:${pid}`, 'first_chain', pid.split('|'), [e.event_id], `${nameOf(rec, e.flags.partner_id)} 與 ${nameOf(rec, e.actor_id)} 第一次完成連攜追擊。`);
      }
    }
  }
  // 死裡逃生：戰鬥結束仍站著、且 HP ≤ 20% 最大值（由結束快照判定，引用最後一次降低其 HP 的傷害事件）
  for (const c of party) {
    const a = last[c.actor_id];
    if (!a?.alive || a.hp * 100 > c.hp_max * 20) continue;
    const hit = [...evs].reverse().find((e) => e.event_type === 'damage_applied' && e.target_ids[0] === c.actor_id);
    if (hit) add(`brink:${c.actor_id}`, 'brink', [c.actor_id], [hit.event_id], `${c.name} 帶著僅剩 ${a.hp} 點 HP 撐過了一場戰鬥。`);
  }
  return out;
}

/** 記憶驗證：每筆記憶引用的事件都必須真的存在於戰鬥紀錄 */
export function verifyMemories(memories, rec) {
  const ids = new Set(allEvents(rec).map((e) => e.event_id));
  return memories.filter((m) => m.battle_id === rec.battle_id).flatMap((m) => m.event_ids.filter((id) => !ids.has(id)).map((id) => `記憶 ${m.key} 引用不存在的事件 ${id}`));
}
