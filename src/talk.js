// 營地談話（P05／P08 受限意圖）：玩家只能從固定意圖選單選擇，不接受自由文字。
// 台詞只引用記憶簿（規則判定的事實）與戰報統計的真實數字；好感只影響可聽到的過去，不影響任何戰鬥數值。
import { CHARACTERS } from './data.js';
import { computeStats } from './report.js';

export const TALK_INTENTS = { recent: '聊聊最近的戰鬥', past: '問起過去', thanks: '道謝' };
export const AFFINITY_MAX = 10;
export const PAST_TIERS = [0, 3, 6];

// 作者定稿：依好感分段解鎖。AI 不得杜撰角色過去。
const PAST = {
  airin: [
    '艾琳搖搖頭。「沒什麼好說的。」她低頭繼續削箭桿。',
    '「我以前在北邊的城市當斥候。」艾琳停了一下。「那座城已經沒有了。」',
    '「神殞落那天，我在城牆上。我看見光從天上掉下來……然後我就只會往反方向跑。」艾琳把箭插回箭袋。「現在我想學會往前跑。」',
  ],
  ade: [
    '「過去？」阿德打了個呵欠。「過去我比較常睡覺。」',
    '「我守過神殿。不是這座，是城裡那座大的。」阿德摸了摸盾上被磨掉的紋章。「守到沒有神可守為止。」',
    '「殘響騎士……我可能認識他。」阿德的聲音很低。「如果是他，那他也是在守什麼東西，守到忘了為什麼。」',
  ],
  xiaomei: [
    '小梅眨眨眼。「我、我在學院的成績其實還不錯喔？」',
    '「老師說火焰術是神留下的最後一種語言。」小梅看著營火。「所以我想知道，祂們最後想說什麼。」',
    '「其實我是逃出學院的。」小梅抱著膝蓋。「他們要我們把神格的研究交出去，我不想。……你會告訴別人嗎？」',
  ],
  rook: [
    '「談錢可以，談過去要另外收費。」洛克咧嘴一笑。',
    '「我老家的人很虔誠。神死的那年，他們把最後一點糧食都拿去獻祭了。」洛克聳聳肩。「我拿去換了這把劍。」',
    '「我恨的不是神。」洛克看著火。「是那些到現在還跪著、等別人來救的人。……包括以前的我。」',
  ],
};

const RECENT_BY_MEMORY = {
  first_kill: {
    airin: '「那隻{victim}嗎？」艾琳想了想。「牠倒下的方向，跟我算的一樣。」',
    ade: '「第一個總是最難的。」阿德說。「之後就只是在數數。」',
    xiaomei: '「我到現在還記得{victim}倒下的聲音。」小梅小聲說。「……是不是不應該習慣？」',
    rook: '「第一筆帳。」洛克拍拍錢袋。「記得很清楚。」',
  },
  first_chain: '「那次和{partner}的配合？」{name}難得地笑了。「沒有說好，就是知道。」',
  guard_save: '「那時候{other}差點就倒了。」{name}沉默了一會兒。「下次不會讓事情走到那一步。」',
  heal_save: '「{other}那時候臉色白得嚇人。」{name}握了握拳。「幸好來得及。」',
  heal_saved: '「那時候要不是{other}……」{name}頓了頓。「欠一次人情。」',
  brink: '「那時候只剩一口氣。」{name}低頭看著自己的手。「現在還能站在這裡，已經算賺到。」',
  rival_defeated: '「殘響騎士。」{name}握緊手裡的東西。「他倒下前，好像想說什麼。」',
};

const THANKS = {
  airin: '艾琳愣了一下，別過臉。「……嗯。」',
  ade: '「謝什麼，盾本來就是拿來擋的。」阿德嘴上這麼說，腳步倒是輕快了點。',
  xiaomei: '「欸？是我該謝謝大家才對！」小梅的臉紅到耳根。',
  rook: '「道謝不能當飯吃。」洛克停了一下。「……不過我收下了。」',
};

const fill = (t, v) => t.replace(/\{(\w+)\}/g, (_, k) => v[k] ?? '');
const nm = (id) => CHARACTERS[id]?.name ?? id;

/** 受限意圖驗證：只接受固定的 {actor_id, intent}，其餘全部拒絕 */
export function validateTalk(game, input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return 'not_an_object';
  if (Object.keys(input).some((k) => k !== 'actor_id' && k !== 'intent')) return 'unknown_field';
  if (!CHARACTERS[input.actor_id]) return 'unknown_actor';
  if (!Object.prototype.hasOwnProperty.call(TALK_INTENTS, input.intent)) return 'unknown_intent';
  if (game.expedition) return 'on_expedition';
  if (game.talked?.[input.actor_id] === game.day) return 'already_talked_today';
  return null;
}

/** 純函式：產生台詞與它引用的事實（記憶 key 或戰報 id） */
export function talkLine(game, id, intent) {
  const name = nm(id);
  const aff = game.affinity?.[id] || 0;
  if (intent === 'past') {
    const tier = PAST_TIERS.filter((t) => aff >= t).length - 1;
    return { text: PAST[id][tier], refs: [], tier, nextAt: PAST_TIERS[tier + 1] ?? null };
  }
  const mems = (game.memories || []).filter((m) => m.actors.includes(id)).reverse();
  if (intent === 'thanks') {
    const save = mems.find((m) => m.type === 'guard_save' && m.actors[0] === id);
    if (save) return { text: `${THANKS[id]}（你提到了那次：${save.text}）`, refs: [save.key] };
    return { text: THANKS[id], refs: [] };
  }
  // recent
  const m = mems[0];
  if (m) {
    let t = RECENT_BY_MEMORY[m.type === 'heal_save' && m.actors[1] === id ? 'heal_saved' : m.type];
    if (typeof t === 'object') t = t[id];
    const victim = m.type === 'first_kill' ? (m.text.match(/（(.+)）/)?.[1] ?? '') : '';
    const partner = m.type === 'first_chain' ? nm(m.actors.find((a) => a !== id)) : '';
    const other = ['guard_save', 'heal_save'].includes(m.type) ? nm(m.actors.find((a) => a !== id)) : '';
    if (t) return { text: fill(t, { name, victim, partner, other }), refs: [m.key] };
  }
  const rep = [...(game.reports || [])].reverse().find((r) => r.record.combatants.some((c) => c.actor_id === id));
  if (rep) {
    const s = computeStats(rep.record)[id];
    return { text: `「上一場（${rep.record.battle_id}）我打出 ${s.damage} 點傷害，承受了 ${s.taken} 點。」${name}想了想。「${s.damage >= s.taken ? '還行。' : '下次得更小心。'}」`, refs: [rep.record.battle_id] };
  }
  return { text: `「我們還沒一起打過仗呢。」${name}說。`, refs: [] };
}
