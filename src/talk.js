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
  // v0.7 可招募夥伴（測試用文本）
  talli: [
    '「過去？我只記路，不記事。」塔莉把地圖捲起來。',
    '「我畫的第一張地圖，是我家那條街。」塔莉笑了笑。「現在那條街在地底下了。」',
    '「我在找一條路。」塔莉的手指停在地圖的空白處。「一條能回到地面上那條街的路。我知道它不存在。」',
  ],
  garn: [
    '葛恩搖搖頭，繼續磨斧頭。',
    '「我砍了一輩子的樹。」葛恩說。「神死以後，樹一碰就燒成灰。」',
    '「有人說地窖最深的地方有一棵不會燒的樹。」葛恩看著火。「我不相信。可是我總得砍點什麼。」',
  ],
  sera: [
    '「病歷是保密的。我的也是。」瑟拉推了推眼鏡。',
    '「我在很多城市治過傷。」瑟拉清點著藥瓶。「傷口都一樣，人不一樣。」',
    '「我治不好的第一個病人，是我老師。」瑟拉把繃帶捲得很緊。「他說灰燼會從裡面燒起來。我還在找解藥。」',
  ],
  karo: [
    '卡蘿笑了一聲，沒有回答。',
    '「這把劍上的火，從我拿到它那天就沒熄過。」卡蘿看著刀刃。「我也不知道它在燒什麼。」',
    '「我欠一個人一條命。」卡蘿收起笑容。「他把劍交給我的時候，說『往下走』。所以我在往下走。」',
  ],
};

const RECENT_BY_MEMORY = {
  first_kill: {
    airin: '「那隻{victim}嗎？」艾琳想了想。「牠倒下的方向，跟我算的一樣。」',
    ade: '「第一個總是最難的。」阿德說。「之後就只是在數數。」',
    xiaomei: '「我到現在還記得{victim}倒下的聲音。」小梅小聲說。「……是不是不應該習慣？」',
    rook: '「第一筆帳。」洛克拍拍錢袋。「記得很清楚。」',
    talli: '「{victim}啊。」塔莉在地圖上畫了個叉。「這裡以後安全了。」',
    garn: '「{victim}。」葛恩點點頭，就這樣。',
    sera: '「{victim}的傷口我看過了。」瑟拉說。「很乾淨。」',
    karo: '「第一個？」卡蘿挑眉。「在這裡是第一個。」',
  },
  first_chain: '「那次和{partner}的配合？」{name}難得地笑了。「沒有說好，就是知道。」',
  guard_save: '「那時候{other}差點就倒了。」{name}沉默了一會兒。「下次不會讓事情走到那一步。」',
  heal_save: '「{other}那時候臉色白得嚇人。」{name}握了握拳。「幸好來得及。」',
  heal_saved: '「那時候要不是{other}……」{name}頓了頓。「欠一次人情。」',
  bond_oddity: '「替{other}擋那一下……」{name}摸了摸護具。「感覺不太一樣，可我說不上來。」',
  bond_confirmed: {
    ade: '「原來那股力量是真的。」阿德看著自己的盾。「替小梅擋的時候，我不是在作夢。」',
    xiaomei: '「阿德先生的盾……是因為我嗎？」小梅按著胸口，聲音很輕。「那我更不能拖後腿了。」',
  },
  brink: '「那時候只剩一口氣。」{name}低頭看著自己的手。「現在還能站在這裡，已經算賺到。」',
  rival_defeated: '「殘響騎士。」{name}握緊手裡的東西。「他倒下前，好像想說什麼。」',
  entrusted: '「你說要我守住{other}，我就守住了。」{name}停了一下。「下次也一樣。」',
};

const THANKS = {
  airin: '艾琳愣了一下，別過臉。「……嗯。」',
  ade: '「謝什麼，盾本來就是拿來擋的。」阿德嘴上這麼說，腳步倒是輕快了點。',
  xiaomei: '「欸？是我該謝謝大家才對！」小梅的臉紅到耳根。',
  rook: '「道謝不能當飯吃。」洛克停了一下。「……不過我收下了。」',
  talli: '「那下次地圖算你便宜一點。」塔莉眨眨眼。',
  garn: '葛恩低聲嗯了一聲，把一塊烤好的肉推到你面前。',
  sera: '「不用謝，記得按時換藥。」瑟拉頭也不抬。',
  karo: '「別急著謝，路還長。」卡蘿笑著揮揮手。',
};

// 營火對話框（v0.7）：每人兩個寫死的話題，選了之後可以接著追問。只接受白名單 id。
export const TOPICS = {
  airin: [
    { id: 'bow', label: '問問她的弓', reply: '艾琳把弓遞過來讓你看。弓臂上刻著一排細小的記號。', follow: [
      { id: 'marks', label: '這些記號是什麼？', reply: '「風向。」她說。「每一次射偏，我都記下來。」' },
      { id: 'leave', label: '把弓還給她', reply: '她接過弓，點了點頭。這大概是謝謝的意思。' }] },
    { id: 'quiet', label: '一起安靜地坐著', reply: '你們誰也沒說話。過了很久，艾琳把一塊乾糧分成兩半，遞了一半給你。', follow: [] },
  ],
  ade: [
    { id: 'shield', label: '問問盾上的刮痕', reply: '「這道是骨鼠，這道是哥布林。」阿德一道一道指過去。「這道……是我自己摔的。」', follow: [
      { id: 'fall', label: '怎麼摔的？', reply: '「值夜睡著了。」阿德面不改色。「下一題。」' }] },
    { id: 'sleep', label: '叫他早點休息', reply: '「你比我媽還囉嗦。」阿德嘴上抱怨，還是把毯子拉了過去。', follow: [] },
  ],
  xiaomei: [
    { id: 'magic', label: '請她示範火焰術', reply: '小梅在掌心點起一小團火，火苗晃了兩下，變成一隻歪歪扭扭的小鳥。', follow: [
      { id: 'praise', label: '稱讚她', reply: '「真、真的嗎？」小鳥的火焰一下子亮了起來。' },
      { id: 'tease', label: '說它看起來像雞', reply: '「是鳥啦！」小梅氣鼓鼓地把火捏熄了，耳朵卻是紅的。' }] },
    { id: 'scared', label: '問她怕不怕', reply: '「怕。」小梅老實地說。「可是大家都在，好像就沒那麼怕了。」', follow: [] },
  ],
  rook: [
    { id: 'coin', label: '問他存了多少錢', reply: '「秘密。」洛克把錢袋往懷裡收了收。「反正不夠。」', follow: [
      { id: 'enough', label: '多少才夠？', reply: '洛克想了很久。「夠買一塊地。不用跪著求雨的那種。」' }] },
    { id: 'sword', label: '問他的劍', reply: '「用糧食換的。」洛克說。「所以每一劍都得值回票價。」', follow: [] },
  ],
  talli: [
    { id: 'map', label: '看她的地圖', reply: '塔莉攤開一張畫滿岔路的地圖，有些路被她用紅墨水劃掉了。', follow: [
      { id: 'red', label: '紅色的是什麼？', reply: '「死路。」塔莉說。「也可能是我還不敢走的路。」' }] },
    { id: 'price', label: '問地圖怎麼賣', reply: '「對隊友打八折。」塔莉想了想。「對你打七折。」', follow: [] },
  ],
  garn: [
    { id: 'axe', label: '問問他的斧頭', reply: '葛恩把斧頭橫放在膝上，用拇指試了試刃口。「還能用。」', follow: [
      { id: 'tree', label: '最後砍的是什麼樹？', reply: '「橡樹。」葛恩停了一下。「它倒下之前就燒起來了。」' }] },
    { id: 'food', label: '誇他烤的肉', reply: '葛恩沒說話，又往你盤子裡放了一塊。', follow: [] },
  ],
  sera: [
    { id: 'herb', label: '問她在調什麼藥', reply: '「止血的。」瑟拉把草葉搗碎。「你們太會受傷了，我得多做一點。」', follow: [
      { id: 'teach', label: '請她教你', reply: '「先學會不要受傷。」瑟拉說。「這比較難。」' }] },
    { id: 'rest', label: '請她也休息一下', reply: '瑟拉愣了一下，好像第一次有人這樣說。「……十分鐘。」', follow: [] },
  ],
  karo: [
    { id: 'blade', label: '問劍上的火', reply: '卡蘿把劍舉到你面前。火很安靜，不燙，卻一直在燒。', follow: [
      { id: 'touch', label: '伸手去碰', reply: '卡蘿把劍收回去。「別。它不認識你。」' }] },
    { id: 'where', label: '問她從哪裡來', reply: '「上面。」卡蘿指了指地窖的天花板。「大家不都是嗎？」', follow: [] },
  ],
};

const fill = (t, v) => t.replace(/\{(\w+)\}/g, (_, k) => v[k] ?? '');
const nm = (id) => CHARACTERS[id]?.name ?? id;

/** 受限意圖驗證：只接受固定的 {actor_id, intent}，其餘全部拒絕 */
export function validateTalk(game, input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return 'not_an_object';
  if (Object.keys(input).some((k) => k !== 'actor_id' && k !== 'intent')) return 'unknown_field';
  if (!CHARACTERS[input.actor_id]) return 'unknown_actor';
  if (game.roster && !game.roster[input.actor_id]) return 'unknown_actor';
  if (!Object.prototype.hasOwnProperty.call(TALK_INTENTS, input.intent) && !(TOPICS[input.actor_id] || []).some((t) => t.id === input.intent)) return 'unknown_intent';
  if (game.expedition) return 'on_expedition';
  if (game.talked?.[input.actor_id] === game.day) return 'already_talked_today';
  return null;
}

/** 純函式：產生台詞與它引用的事實（記憶 key 或戰報 id） */
export function talkLine(game, id, intent) {
  const name = nm(id);
  const aff = game.affinity?.[id] || 0;
  const topic = (TOPICS[id] || []).find((t) => t.id === intent);
  if (topic) return { text: topic.reply, refs: [], follow: topic.follow.map(({ id: fid, label }) => ({ id: fid, label })) };
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
    const other = ['guard_save', 'heal_save', 'bond_oddity', 'bond_confirmed', 'entrusted'].includes(m.type) ? nm(m.actors.find((a) => a !== id)) : '';
    if (t) return { text: fill(t, { name, victim, partner, other }), refs: [m.key] };
  }
  const rep = [...(game.reports || [])].reverse().find((r) => r.record.combatants.some((c) => c.actor_id === id));
  if (rep) {
    const s = computeStats(rep.record)[id];
    return { text: `「上一場（${rep.record.battle_id}）我打出 ${s.damage} 點傷害，承受了 ${s.taken} 點。」${name}想了想。「${s.damage >= s.taken ? '還行。' : '下次得更小心。'}」`, refs: [rep.record.battle_id] };
  }
  return { text: `「我們還沒一起打過仗呢。」${name}說。`, refs: [] };
}

/** 追問：只回傳寫死的台詞，不改任何狀態（不加好感、不算今天的談話） */
export function followLine(id, topicId, followId) {
  const f = (TOPICS[id] || []).find((t) => t.id === topicId)?.follow.find((x) => x.id === followId);
  if (!f) throw new Error('不能這樣問');
  return { text: f.reply };
}
