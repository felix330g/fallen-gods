// 短演出（模板版）：只引用真實事件；不入記憶、不影響數值；可略過。
import { allEvents } from './report.js';
import { hashSeed } from './rng.js';

const nameOf = (rec, id) => rec.combatants.find((c) => c.actor_id === id)?.name ?? id;

const LINES = {
  first_kill: {
    xiaomei: ['小梅盯著倒下的{victim}，法杖還在發燙。「……我、我打倒了？」'],
    airin: ['艾琳收回弓，什麼也沒說，只是把箭羽理順。'],
    ade: ['阿德甩了甩盾上的灰。「第一個。別讓我數到太多。」'],
    rook: ['洛克擦掉劍上的血。「這一顆頭，記帳上。」'],
    talli: ['塔莉從{victim}身邊跳開，迅速在地圖上記了一筆。'],
    garn: ['葛恩把斧頭從{victim}身上拔出來，喘了一口氣。'],
    sera: ['瑟拉看著倒下的{victim}，下意識地伸手去摸藥箱。'],
    karo: ['卡蘿甩掉劍上的灰，火光照亮了她的笑。'],
  },
  kill_veteran: {
    xiaomei: ['小梅深吸一口氣，這次手沒有抖。', '「上次也撐過來了。」小梅低聲對自己說。'],
    airin: ['艾琳的箭比{victim}的慘叫更快。'],
    ade: ['阿德用盾緣把{victim}撞倒，順手扶正頭盔。'],
    rook: ['「下一個。」洛克頭也不回。'],
    talli: ['「這條路清乾淨了。」塔莉說。'],
    garn: ['葛恩一斧落下，{victim}沒再起來。'],
    sera: ['「沒救了。」瑟拉替{victim}下了診斷。'],
    karo: ['卡蘿的劍光一閃，{victim}身上燃起了小小的火。'],
  },
  chain: ['{partner}剛出手，{actor}就跟上了——像是早就說好的一樣。', '{actor}看準{partner}打開的空檔補上一擊。'],
  chain_again: ['又是{actor}和{partner}。兩人連看都沒看對方一眼。'],
  bystander: ['{watcher}望著{actor}與{partner}的配合，手心微微出汗。……他們好像在跳舞。'],
  bystander_seen: ['{watcher}已經不再驚訝了，只是默默記下兩人出手的節奏。'],
  guard: ['阿德的盾擋在{ally}身前。「別分心。」'],
  guard_again: ['「又分心？」阿德沒回頭，盾牌已經在{ally}前面了。'],
  guard_generic: ['{guard}擋在{ally}前面，硬吃下了{enemy}的攻擊。'],
  near_death: ['{actor}靠著牆喘氣，生命只剩一點點，但還站著。'],
  enemy_voice: {
    hollow_knight: ['殘響騎士的頭盔裡傳出空洞的聲音：「……神已經死了。你們在守護什麼？」'],
    ember_hound: ['餘燼犬的喉嚨裡滾著火星，牠聞的不是血，是你們身上的灰。'],
  },
  defeat: ['灰燼覆蓋了倒下的身影。地窖再次安靜下來。'],
  retreat: ['戰鬥拖得太久，隊伍決定先退一步。'],
};

// 作者定稿文本，永不交給 AI
export const AUTHOR_TEXT = {
  rival_defeated: '殘響騎士跪倒在熄滅的祭壇前，鎧甲裡的灰燼一點一點散去。最後留下的，只有一枚刻著神殿紋章的徽記。{killer}把它撿了起來，很久沒有說話。',
  rival_defeated_again: '殘響騎士再一次倒下。這一次，{killer}看見他的手指動了動，像是想把劍遞出來。',
  phase_changed: '{boss}的鎧甲從胸口裂開，裡面湧出的不是血，是還在燃燒的灰。「……還沒……結束……」',
};

function pick(arr, seed) { return arr[seed % arr.length]; }
function fill(t, v) { return t.replace(/\{(\w+)\}/g, (_, k) => v[k] ?? ''); }

/**
 * 產生短演出。
 * ctx: { memories (戰前已有), history (最近 3 場的演出種類，非事實), density: 1|3|6 }
 */
export function buildMoments(rec, ctx = {}) {
  const { memories = [], history = [], density = 3 } = ctx;
  const has = (key) => memories.some((m) => m.key === key);
  const seenKind = (k) => history.some((h) => h.kinds.includes(k));
  const evs = allEvents(rec);
  const byId = Object.fromEntries(evs.map((e) => [e.event_id, e]));
  const party = rec.combatants.filter((c) => c.team === 'party').map((c) => c.actor_id);
  const out = [];
  const seed = hashSeed(rec.battle_id);
  const push = (m) => { if (!out.some((x) => x.kind === m.kind && x.speaker === m.speaker)) out.push(m); };
  // 敵人心聲（同類只演一次）
  const voiced = new Set();
  for (const c of rec.combatants) if (LINES.enemy_voice[c.type_id] && !voiced.has(c.type_id)) { voiced.add(c.type_id); push({ kind: 'enemy_voice', speaker: c.actor_id, event_ids: [evs[0].event_id], text: LINES.enemy_voice[c.type_id][0], priority: c.boss ? 2 : 5 }); }
  for (const e of evs) {
    if (e.event_type === 'phase_changed') {
      push({ kind: 'phase', speaker: e.actor_id, event_ids: [e.event_id], text: fill(AUTHOR_TEXT.phase_changed, { boss: nameOf(rec, e.actor_id) }), author: true, priority: 1 });
    }
    if (e.event_type === 'actor_defeated') {
      const killer = byId[e.source_event_id]?.actor_id;
      const victim = rec.combatants.find((c) => c.actor_id === e.actor_id);
      if (!party.includes(killer) || victim.team !== 'enemy') continue;
      if (victim.rival) {
        const again = has(`rival:${victim.type_id}`);
        push({ kind: 'rival', speaker: killer, event_ids: [e.event_id], text: fill(again ? AUTHOR_TEXT.rival_defeated_again : AUTHOR_TEXT.rival_defeated, { killer: nameOf(rec, killer) }), author: true, priority: 0 });
        continue;
      }
      const veteran = has(`first_kill:${killer}`);
      const pool = (veteran ? LINES.kill_veteran : LINES.first_kill)[killer];
      if (pool) push({ kind: veteran ? 'kill_veteran' : 'first_kill', speaker: killer, event_ids: [e.event_id], text: fill(pick(pool, seed + e.sequence), { victim: victim.name }), priority: veteran ? 4 : 1 });
    }
    if (e.event_type === 'synergy_trigger_check' && e.calculation.success) {
      const v = { actor: nameOf(rec, e.actor_id), partner: nameOf(rec, e.flags.partner_id) };
      const again = has(`first_chain:${e.calculation.pair_id}`);
      push({ kind: 'chain', speaker: e.actor_id, event_ids: [e.event_id], text: fill(pick(again ? LINES.chain_again : LINES.chain, seed + e.sequence), v), priority: 2 });
      // 旁觀者：不在這一對裡、且站著的隊友。只是演出，不產生任何數值。
      const watcher = party.find((p) => p !== e.actor_id && p !== e.flags.partner_id && rec.turns[e.turn_number - 1].end_snapshot.actors[p].alive);
      if (watcher) {
        const seen = seenKind(`bystander:${watcher}`);
        push({ kind: `bystander:${watcher}`, speaker: watcher, event_ids: [e.event_id], text: fill(pick(seen ? LINES.bystander_seen : LINES.bystander, 0), { ...v, watcher: nameOf(rec, watcher) }), priority: 3 });
      }
    }
    if (e.event_type === 'damage_applied' && e.flags?.intercepted_from && !e.flags.dot) {
      const g = e.target_ids[0], ally = e.flags.intercepted_from;
      const v = { guard: nameOf(rec, g), ally: nameOf(rec, ally), enemy: nameOf(rec, e.actor_id) };
      let text;
      if (g === 'ade') text = pick(seenKind('guard:ade') ? LINES.guard_again : LINES.guard, 0);
      else text = LINES.guard_generic[0];
      push({ kind: `guard:${g}`, speaker: g, event_ids: [e.event_id], text: fill(text, v), priority: 2 });
    }
  }
  const last = rec.turns.at(-1).end_snapshot.actors;
  for (const p of party) {
    const c = rec.combatants.find((x) => x.actor_id === p);
    if (last[p].alive && last[p].hp * 100 < c.hp_max * 25) push({ kind: 'near_death', speaker: p, event_ids: [rec.turns.at(-1).events.at(-1).event_id], text: fill(LINES.near_death[0], { actor: c.name }), priority: 3 });
  }
  const endEv = evs.find((e) => e.event_type === 'battle_ended');
  if (rec.result.outcome === 'defeat') push({ kind: 'defeat', speaker: null, event_ids: [endEv.event_id], text: LINES.defeat[0], priority: 0 });
  if (rec.result.outcome === 'retreat') push({ kind: 'retreat', speaker: null, event_ids: [endEv.event_id], text: LINES.retreat[0], priority: 0 });
  return out.sort((a, b) => a.priority - b.priority).slice(0, density);
}

/** 演出驗證：每段都要引用真實事件；擊殺演出的講者必須是真正的擊殺者；階段演出必須對應階段事件 */
export function verifyMoments(moments, rec) {
  const evs = allEvents(rec);
  const byId = Object.fromEntries(evs.map((e) => [e.event_id, e]));
  const errs = [];
  for (const m of moments) {
    for (const id of m.event_ids) if (!byId[id]) errs.push(`演出引用不存在的事件 ${id}`);
    if (['first_kill', 'kill_veteran', 'rival'].includes(m.kind)) {
      const d = byId[m.event_ids[0]];
      if (byId[d?.source_event_id]?.actor_id !== m.speaker) errs.push(`擊殺歸屬錯誤：${m.speaker}`);
    }
    if (m.kind === 'phase' && byId[m.event_ids[0]]?.event_type !== 'phase_changed') errs.push('階段演出沒有對應的階段事件');
  }
  return errs;
}
