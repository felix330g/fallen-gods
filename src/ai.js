// AI 短演出（試驗，P05／M4）：只改寫「已由規則選出」的演出台詞。
// AI 只拿到最小事實包，輸出經驗證才顯示；不影響數值、不寫入記憶、不進存檔。失敗一律回退模板。
import { CHARACTERS, ENEMIES, SKILLS } from './data.js';
import { allEvents } from './report.js';

// 角色卡（測試用，非正式設定）。只寫說話方式與禁區；角色過去由作者文本解鎖，AI 不得自行揭露。
export const PERSONAS = {
  airin: { voice: '沉默寡言的弓手。話極少，多用動作代替說話；觀察敏銳，習慣計算距離和方向。', avoid: ['她的故鄉與過去'] },
  ade: { voice: '前神殿守衛，盾衛。嘴上嫌麻煩、愛抱怨，但總是第一個擋在隊友前面。語氣懶散、帶點粗魯的關心。', avoid: ['他守過的神殿與殘響騎士的關係'] },
  xiaomei: { voice: '剛從學院出來的見習術士，第一次下地城。緊張、容易驚慌，說話常結巴，但會努力鼓起勇氣；觀察同伴很仔細。', avoid: ['她離開學院的原因', '神格研究'] },
  rook: { voice: '只認金幣的傭兵劍士。冷淡、說話短、愛用「帳」「價錢」比喻；對「神」這個字反感。', avoid: ['他的故鄉與家人'] },
};

// 世界觀摘要：只放已在遊戲中公開的內容（見 docs/design/design-overview.md）。
const WORLD = '眾神已經殞落，地底出現了地下城。隊伍正在探索「灰燼地窖」：一座堆滿灰燼、殘留神殿痕跡的地窖。';

// 不得出現的詞：未在遊戲中公開或屬於主線的設定，AI 不能自行引入。
export const FORBIDDEN = ['神格', '位格', '聖杯', '世界之力', '神秘組織', '失格者'];
export const MAX_LINE_CHARS = 60;
export const MAX_TOTAL_CHARS = 90;

const nameOf = (rec, id) => rec.combatants.find((c) => c.actor_id === id)?.name ?? id;
const skillName = (id) => SKILLS[id]?.name ?? id;

// 這些演出不交給 AI：作者定稿文本、敵人心聲（劇情相關）
export const aiEligible = (m) => !m.author && m.kind !== 'enemy_voice';

/** 把一個事件轉成一句客觀事實（只用事件裡的資料，不含數字） */
function describe(e, rec, byId) {
  const a = nameOf(rec, e.actor_id), t = e.target_ids?.[0] && nameOf(rec, e.target_ids[0]);
  switch (e.event_type) {
    case 'actor_defeated': {
      const src = byId[e.source_event_id];
      return src ? `${a}被${nameOf(rec, src.actor_id)}的「${skillName(src.skill_id)}」擊倒` : `${a}倒下`;
    }
    case 'damage_applied':
      if (e.flags?.intercepted_from) return `${t}替${nameOf(rec, e.flags.intercepted_from)}擋下了${a}的「${skillName(e.skill_id)}」`;
      return `${a}用「${skillName(e.skill_id)}」擊中${t}`;
    case 'heal_applied': return `${a}用「${skillName(e.skill_id)}」治療了${t}`;
    case 'synergy_trigger_check': return `${a}緊跟著${nameOf(rec, e.flags.partner_id)}的攻擊出手，兩人連攜成功`;
    case 'battle_ended': return { victory: '隊伍打贏了這場戰鬥', defeat: '隊伍全滅', retreat: '戰鬥拖太久，隊伍撤退' }[rec.result.outcome] ?? '戰鬥結束';
    default: return null;
  }
}

const KIND_HINT = {
  first_kill: '這是講者生涯第一次擊倒敵人。',
  kill_veteran: '講者已經擊倒過敵人，這次比較熟練。',
  chain: '兩人的連攜，寫講者出手的瞬間。',
  near_death: '講者在戰鬥結束時只剩很少的生命，但還站著。',
  defeat: '沒有講者，用旁白寫全滅後地窖的景象。',
  retreat: '沒有講者，用旁白寫撤退的情景。',
};

/** 為每個可交給 AI 的演出建立事實包 */
export function buildFacts(moments, rec) {
  const evs = allEvents(rec);
  const byId = Object.fromEntries(evs.map((e) => [e.event_id, e]));
  const present = rec.combatants.map((c) => c.actor_id);
  return moments.map((m, i) => ({ m, i })).filter(({ m }) => aiEligible(m)).map(({ m, i }) => {
    const kind = m.kind.split(':')[0];
    const speaker = m.speaker && present.includes(m.speaker) ? m.speaker : null;
    const facts = m.event_ids.map((id) => byId[id] && describe(byId[id], rec, byId)).filter(Boolean);
    let hint = KIND_HINT[kind] ?? '';
    if (kind === 'bystander') hint = '講者在旁邊看著另外兩人連攜。只能寫講者看得到的動作和自己的感受，不能知道別人在想什麼；旁觀不會讓任何人變強。';
    if (kind === 'guard') hint = '講者替隊友擋下了攻擊。';
    return { index: i, kind, speaker, speaker_name: speaker ? nameOf(rec, speaker) : null, facts, hint, template: m.text };
  });
}

/** 組出送給 Claude 的完整提示詞（Claude 每次呼叫都沒有記憶，所以規則、資料、格式全部放在這裡） */
export function buildPrompt(moments, rec) {
  const items = buildFacts(moments, rec);
  const party = rec.combatants.filter((c) => c.team === 'party').map((c) => c.actor_id);
  const cards = party.map((id) => `- ${CHARACTERS[id].name}（${CHARACTERS[id].role}）：${PERSONAS[id]?.voice ?? ''}${PERSONAS[id]?.avoid?.length ? `不可提及：${PERSONAS[id].avoid.join('、')}。` : ''}`).join('\n');
  const enemies = [...new Set(rec.combatants.filter((c) => c.team === 'enemy').map((c) => c.name))].join('、');
  const list = items.map((it) => `#${it.index}｜講者：${it.speaker_name ?? '旁白'}｜${it.hint}\n  事實：${it.facts.join('；') || '（無）'}\n  模板參考：${it.template}`).join('\n');
  const prompt = `你是文字冒險 RPG《眾神殞落》的演出寫手。把下面每一段戰鬥演出改寫成更有臨場感、更像角色本人的短句。

世界：${WORLD}
這場戰鬥的隊員：
${cards}
敵人：${enemies}

寫作規則：
1. 每段 1 到 2 句，每句不超過 ${MAX_LINE_CHARS} 字，兩句合計不超過 ${MAX_TOTAL_CHARS} 字。繁體中文。
2. 只能寫「事實」裡發生的事。不得新增攻擊、傷害、勝負、技能或道具，不得改變誰打倒了誰。
3. 不要寫任何數字（包括 HP、傷害、回合數）。
4. 只能出現這場戰鬥裡的角色名字，不得提到其他人物。
5. 不得提及：${FORBIDDEN.join('、')}（上面列出的敵人正式名稱除外）。不得替角色編造過去、身世、承諾或秘密。
6. 有講者時，用講者的視角：可以寫講者的動作、短台詞（用「」）、心聲；不能讀別人的心。
7. 語氣要符合角色卡。寧可簡短有味道，也不要華麗堆砌。同一場的幾段不要重複用詞。

要改寫的演出：
${list}

只回覆 JSON，格式：{"moments":[{"index":段落編號,"lines":["第一句","第二句"]}]}，每段都要有。`;
  return { prompt, items };
}

/** 驗證 AI 輸出：回傳 { index: {lines} } 只含通過的段落，以及每段被拒的原因 */
export function validateAI(out, items, rec) {
  const ok = {}, rejected = {};
  const present = new Set(rec.combatants.map((c) => c.name));
  const allNames = [...Object.values(CHARACTERS).map((c) => c.name), ...Object.values(ENEMIES).map((c) => c.name), '殘響騎士'];
  const arr = Array.isArray(out?.moments) ? out.moments : [];
  for (const it of items) {
    const got = arr.find((x) => x && Number(x.index) === it.index);
    const lines = got?.lines;
    let why = null;
    if (!Array.isArray(lines) || lines.length < 1 || lines.length > 2 || !lines.every((l) => typeof l === 'string' && l.trim())) why = '格式不符';
    else if (lines.some((l) => [...l].length > MAX_LINE_CHARS) || lines.join('').length > MAX_TOTAL_CHARS) why = '超過字數';
    else if (lines.some((l) => /[0-9０-９]/.test(l))) why = '含數字';
    else if (lines.some((l) => { const bare = [...present].reduce((s, n) => s.split(n).join(''), l); return FORBIDDEN.some((w) => bare.includes(w)); })) why = '提到未公開設定';
    else if (lines.some((l) => allNames.some((n) => l.includes(n) && !present.has(n) && ![...present].some((p) => p.includes(n))))) why = '出現不在場的角色';
    if (why) rejected[it.index] = why; else ok[it.index] = { lines: lines.map((l) => l.trim()) };
  }
  return { ok, rejected };
}
