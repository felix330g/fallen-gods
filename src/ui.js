// 介面層：只讀寫 game.js 的 API，不直接改數值。
import { CHARACTERS, SKILLS, STATUSES, DUNGEON, ENCOUNTER_EVENTS, BONDS, ENEMIES, POTION_PRICE, RULES_VERSION, SALVAGE_GOLD, itemDef, statDiffText, inventoryOrder, GACHA, LEARNABLE } from './data.js';
import { stepRound, chooseAction, currentSkills, pairKey, pairLevel } from './engine.js';
import * as G from './game.js';
import { summary, simpleLog, detailedLog, filterDetailedLog, filterOptions, computeStats, hpCurve, skillLabel } from './report.js';
import { TALK_INTENTS, PAST_TIERS, AFFINITY_MAX, TOPICS, followLine, talkLine } from './talk.js';
import { buildPrompt, validateAI, aiEligible, MEET_TEMPLATES, buildMeetPrompt, validateMeet, CHAT_AFFINITY, CHAT_INPUT_MAX, buildChatTurns, validateChat } from './ai.js';

const SAVE_KEY = 'fallen-gods-save-v1';
const ui = { confirm: null, exportText: null, view: 'title', tab: 'camp', game: null, battle: null, cmds: {}, reportIdx: -1, rtab: 'summary', detailed: false, actorFilter: '', lf: { skill: '', type: '', status: '', turn: '' }, idFilter: null, hl: null, msg: null, err: null, exp: null, invSort: 'default', fromExpedition: false, talk: null, sample: null, ai: {}, aiCtl: null, testMode: false, gacha: null, meet: null, dlg: null, chatDraft: '' };
const root = () => document.getElementById('app');
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const TACTIC = { aggressive: '進攻', balanced: '均衡', protect: '守護' };
const RARITY_CLASS = { 普通: 'c', 精良: 'u', 稀有: 'r', 史詩: 'e' };
const SERIES = ['var(--s1)', 'var(--s2)', 'var(--s3)', 'var(--s4)', 'var(--s5)', 'var(--bad)', 'var(--warn)'];

function save() { try { localStorage.setItem(SAVE_KEY, G.serialize(ui.game)); } catch { /* 無法存檔時仍可遊玩 */ } }
function loadSaved() { try { const t = localStorage.getItem(SAVE_KEY); return t ? G.deserialize(t) : null; } catch { return null; } }
function hasSave() { try { return !!localStorage.getItem(SAVE_KEY); } catch { return false; } }

function routeFromGame() {
  const ex = ui.game.expedition;
  if (!ex) { ui.view = 'camp'; return; }
  if (ex.pending?.type === 'event') ui.view = 'event';
  else if (ex.pending) startBattleView();
  else ui.view = 'map';
}

function startBattleView() {
  ui.battle = G.beginBattle(ui.game);
  ui.cmds = {};
  ui.view = 'battle';
}

// ── 小元件 ──────────────────────────────────────────
function hpBar(hp, max, shield = 0) {
  const pct = Math.max(0, Math.min(100, (hp * 100) / max));
  return `<div class="bar" title="${hp}/${max}"><i class="${pct < 30 ? 'low' : ''}" style="width:${pct}%"></i></div>
    <div class="small muted">${hp}/${max}${shield ? ` <span style="color:var(--shield)">＋護盾 ${shield}</span>` : ''}</div>`;
}
function topbar() {
  const g = ui.game;
  return `<div class="topbar"><h1>眾神殞落</h1><div class="stats"><span>第 <b>${g.day}</b> 天</span><span>金幣 <b>${g.gold}</b></span><span>寶石 <b>${ui.testMode ? '∞' : g.gems}</b></span><span>藥水 <b>${g.potions}</b></span><span>攻略 <b>${g.clears}</b></span></div></div>`;
}
function messages() {
  return (ui.err ? `<div class="notice err">${esc(ui.err)}</div>` : '') + (ui.msg ? `<div class="notice">${esc(ui.msg)}</div>` : '');
}
function itemText(id) {
  const it = itemDef(id);
  const mods = Object.entries(it.mods).map(([k, v]) => `${{ atk: '攻', def: '防', hp: '命', spd: '速', crit: '暴' }[k]}+${v}`).join(' ');
  return `<span class="rar-${RARITY_CLASS[it.rarity]}">${esc(it.name)}</span> <span class="chip">${it.rarity}</span><span class="small muted">${mods}</span>`;
}

// ── 標題 ──────────────────────────────────────────
function viewTitle() {
  return `<div class="title-screen"><h1>眾神殞落</h1><p class="muted">灰燼地窖・垂直切片</p>
  <p>${esc(DUNGEON.intro)}</p>
  <div class="row"><button class="primary" data-act="new">新遊戲</button>${hasSave() ? '<button data-act="continue">繼續</button>' : ''}
  <label><button data-act="importPick">匯入存檔</button></label></div>
  ${messages()}
  <p class="small muted" style="margin-top:24px">回合制・數值透明・角色會記得他們真正經歷過的事。</p></div>`;
}

// ── 營地 ──────────────────────────────────────────
const CAMP_TABS = [['camp', '營地'], ['party', '隊伍'], ['gacha', '招募'], ['gear', '裝備'], ['research', '研究室'], ['memory', '記憶簿'], ['archive', '戰報檔案'], ['settings', '設定']];
function viewCamp() {
  const body = { camp: tabCamp, party: tabParty, gacha: tabGacha, gear: tabGear, research: tabResearch, memory: tabMemory, archive: tabArchive, settings: tabSettings }[ui.tab]();
  return `${topbar()}<div class="tabs">${CAMP_TABS.map(([k, n]) => `<button class="${ui.tab === k ? 'on' : ''}" data-act="tab" data-arg="${k}">${n}</button>`).join('')}</div>${messages()}${body}`;
}
function campfire() {
  const g = ui.game;
  const rows = G.ownedIds(g).map((id) => {
    const c = CHARACTERS[id], aff = g.affinity[id] || 0, done = g.talked[id] === g.day;
    return `<div class="talkrow"><div><b>${esc(c.name)}</b> <span class="small muted">好感 ${aff}/${AFFINITY_MAX}${done ? '・今天聊過了' : ''}</span></div>
      <button class="small ${ui.dlg?.id === id ? 'primary' : ''}" data-act="openDlg" data-arg="${id}">交談</button></div>`;
  }).join('');
  return `<div class="panel"><h3>營火旁</h3><p class="small muted">選一個人交談。每人每天第一個話題會增加好感；追問不會。他們只會提起真正發生過的事。好感只決定他們願意說多少，不影響戰鬥數值。</p>
    ${ui.dlg ? dialogBox() : ''}<div class="talklist">${rows}</div></div>`;
}
function dialogBox() {
  const g = ui.game, d = ui.dlg, id = d.id, c = CHARACTERS[id];
  const aff = g.affinity[id] || 0, done = g.talked[id] === g.day;
  const nextTier = PAST_TIERS.find((t) => t > aff);
  const lines = d.lines.map((l, i) => `<div class="dl ${l.who === 'you' ? 'you' : ''} ${l.ai ? 'ai' : ''}" ${i === d.lines.length - 1 && l.who !== 'you' ? 'id="talkResult"' : ''}>${l.who === 'you' ? '<b>你</b>' : `<b>${esc(c.name)}</b>`}<span>${esc(l.text)}</span>${l.ai ? '<span class="chip">AI</span>' : ''}${l.note ? `<span class="small muted">${esc(l.note)}</span>` : ''}</div>`).join('');
  const opts = [...Object.entries(TALK_INTENTS).map(([k, n]) => [k, n]), ...(TOPICS[id] || []).map((t) => [t.id, t.label])]
    .map(([k, n]) => `<button class="small" data-act="talk" data-arg="${id}:${k}" ${done ? 'disabled' : ''}>${esc(n)}</button>`).join('');
  const follows = (d.follow || []).map((f) => `<button class="small" data-act="follow" data-arg="${id}:${d.topic}:${f.id}">${esc(f.label)}</button>`).join('');
  let chat;
  if (aff < CHAT_AFFINITY) chat = `<p class="small muted">好感 ${CHAT_AFFINITY} 以後，可以自己打字和${esc(c.name)}聊天。</p>`;
  else if (!ui.sample) chat = '<p class="small muted">自由聊天由 AI 扮演角色，只在 claude.ai 版本提供。</p>';
  else chat = `<div class="row chatrow"><input id="chatInput" maxlength="${CHAT_INPUT_MAX}" placeholder="對${esc(c.name)}說……" value="${esc(ui.chatDraft)}" ${d.busy ? 'disabled' : ''}>
      ${d.busy ? '<button class="small" data-act="chatStop">停止</button>' : '<button class="small primary" data-act="chatSend">說</button>'}</div>
      <p class="small muted">AI 扮演${esc(c.name)}回話，用你的 Claude 額度。聊天內容不會改變好感、記憶或任何數值，也不會存檔。</p>`;
  return `<div class="dialog" id="dialogBox"><div class="row"><b>和${esc(c.name)}交談</b><span class="small muted">好感 ${aff}/${AFFINITY_MAX}${nextTier !== undefined ? `・好感 ${nextTier} 時會說更多過去` : ''}</span><button class="link" data-act="closeDlg">離開</button></div>
    <div class="dlines">${lines || `<div class="dl"><span class="muted">${esc(c.name)}在火邊坐著。</span></div>`}${d.busy ? '<div class="dl"><span class="muted">……</span></div>' : ''}</div>
    ${follows ? `<div class="row">${follows}</div>` : ''}
    <div class="row">${opts}</div>${done ? '<p class="small muted">今天的話題已經聊過了，明天再來。</p>' : ''}
    ${chat}</div>`;
}
const CHAT_FALLBACK = (name) => `（${name}看著火，沒有回答。）`;
async function chatSend() {
  const g = ui.game, d = ui.dlg, id = d.id, c = CHARACTERS[id];
  const msg = (document.getElementById('chatInput')?.value || ui.chatDraft || '').trim().slice(0, CHAT_INPUT_MAX);
  if (!msg || d.busy || !ui.sample) return;
  ui.chatDraft = '';
  d.lines.push({ who: 'you', text: msg });
  d.turns.push({ role: 'user', content: msg });
  const aff = g.affinity[id] || 0;
  const knownPast = PAST_TIERS.filter((t) => aff >= t).map((_, i) => talkLine({ ...g, affinity: { [id]: PAST_TIERS[i] } }, id, 'past').text);
  const memories = g.memories.filter((m) => m.actors.includes(id)).slice(-8).map((m) => m.text);
  const ctx = { knownPast, memories, partyNames: G.ownedIds(g).filter((x) => x !== id).map((x) => CHARACTERS[x].name) };
  const ctl = d.ctl = new AbortController();
  d.busy = true; render();
  let reply, ai = false, note;
  try {
    const { text } = await ui.sample(buildChatTurns(id, ctx, d.turns), { signal: ctl.signal, cache: false, modelTier: 'quick' });
    const v = validateChat(text, id, [...knownPast, ...memories]);
    if (v.text) { reply = v.text; ai = true; } else { reply = CHAT_FALLBACK(c.name); note = `AI 回覆未通過：${v.why}`; }
  } catch (e) {
    if (['not_granted', 'sampling_disabled', 'not_declared', 'capability_disabled', 'capability_removed'].includes(e?.code)) ui.sample = null;
    reply = CHAT_FALLBACK(c.name); note = e?.code === 'cancelled' ? '已停止' : (AI_ERRORS[e?.code] ?? 'AI 暫時無法使用。');
  }
  if (ui.dlg !== d) return;
  d.busy = false; d.ctl = null;
  d.lines.push({ who: id, text: reply, ai, note });
  if (ai) d.turns.push({ role: 'assistant', content: reply }); else d.turns.pop();
  render();
  document.getElementById('chatInput')?.focus();
}
function tabGacha() {
  const g = ui.game;
  if (g.pendingRecruit) return meetPanel();
  const cost = GACHA.cost, free = ui.testMode;
  const can = (n) => free || g.gems >= n;
  const pool = G.skillPool(g);
  const res = ui.gacha ? `<div class="moment" id="gachaResult">${esc(ui.gacha)}</div>` : '';
  const fresh = Object.values(CHARACTERS).filter((c) => c.recruit && !g.roster[c.id]);
  return `<div class="panel"><h2>招募</h2>${free ? '<p class="notice">測試模式：寶石無限，抽卡不扣寶石。</p>' : ''}
    <p class="small muted">寶石是稀有貨幣：地城裡打贏戰鬥有小機率掉落，第一次擊敗殘響騎士會得到較多。所有角色與機率皆為測試用。</p>${res}
    <div class="grid">
      <div class="unit"><div class="name"><b>招募夥伴</b><span class="small muted">${cost.recruit} 寶石</span></div>
        <p class="small">機率：${GACHA.rates.map(([r, p]) => `${r} ${p}%`).join('・')}。抽到的人會先和你相遇，再加入隊伍。已有的稀有度全員到齊時退回 ${GACHA.duplicateRefund} 寶石。</p>
        <p class="small muted">尚未遇見：${fresh.map((c) => `${c.name}（${c.rarity}）`).join('、') || '全員到齊'}</p>
        <button class="primary" data-act="pull" data-arg="recruit" ${can(cost.recruit) ? '' : 'disabled'}>招募一次</button></div>
      <div class="unit"><div class="name"><b>領悟技能</b><span class="small muted">${cost.skill} 寶石</span></div>
        <p class="small">只有目前上陣的三人的技能會被抽到。換人出陣，卡池就跟著換。</p>
        <p class="small muted">${pool.length ? `卡池：${pool.map((p) => `${CHARACTERS[p.actor_id].name}「${SKILLS[p.skill_id].name}」`).join('、')}` : '上陣角色已經學會所有可學技能。'}</p>
        <button class="primary" data-act="pull" data-arg="skill" ${can(cost.skill) && pool.length ? '' : 'disabled'}>領悟一次</button></div>
    </div></div>`;
}
function meetPanel() {
  const g = ui.game, p = g.pendingRecruit, c = CHARACTERS[p.id];
  const m = ui.meet?.id === p.id ? ui.meet : null;
  const text = m?.story ?? MEET_TEMPLATES[p.id];
  return `<div class="panel" id="meetPanel"><h2>相遇・${esc(c.name)} <span class="chip rar-${c.rarity}">${c.rarity}</span></h2>
    <p class="small muted">${esc(c.role)}・${esc(c.bio)}</p>
    <div class="moment meet">${m?.status === 'loading' ? '<span class="muted">Claude 正在寫你們相遇的那天……</span>' : esc(text)}</div>
    <p class="small muted">${m?.story ? 'AI 生成的相遇故事：只是一段回憶，不代表正式設定，也不影響任何數值。' : m?.why ? `AI 故事未通過（${esc(m.why)}），改用模板。` : '模板故事（測試用）。'}</p>
    <div class="row"><button class="primary" data-act="join" ${m?.status === 'loading' ? 'disabled' : ''}>邀請${esc(c.name)}入隊</button>
    ${ui.sample && m?.status !== 'loading' ? '<button class="small" data-act="meetAI">用 AI 重寫相遇故事</button>' : ''}</div></div>`;
}
async function meetAI() {
  const g = ui.game, id = g.pendingRecruit?.id;
  if (!id || !ui.sample) return;
  ui.meet = { id, status: 'loading' }; render();
  try {
    const out = await ui.sample.json(buildMeetPrompt(g, id), { cache: false });
    const v = validateMeet(out, g, id);
    ui.meet = v.story ? { id, status: 'done', story: v.story } : { id, status: 'done', why: v.why };
  } catch (e) {
    if (['not_granted', 'sampling_disabled', 'not_declared', 'capability_disabled', 'capability_removed'].includes(e?.code)) ui.sample = null;
    ui.meet = { id, status: 'done', why: AI_ERRORS[e?.code] ?? 'AI 暫時無法使用' };
  }
  render();
}
function tabCamp() {
  const g = ui.game;
  const last = g.lastExpeditionResult ? { cleared: '上次遠征：攻略完成', retreat: '上次遠征：撤退', defeat: '上次遠征：全滅' }[g.lastExpeditionResult] : '';
  const ds = DUNGEON.states[G.dungeonState(g)];
  return `<div class="panel"><h2>${esc(DUNGEON.name)} <span class="chip ${G.dungeonState(g) === 'normal' ? '' : 'warn'}">${esc(ds.name)}</span></h2><p>${esc(ds.desc)}</p>
    <p class="small muted">三層，每層三步。第三層盡頭是失格者・殘響騎士（HP 降到一半會進入第二階段）。全滅會失去本次遠征的所有收穫；撤退可以保留。</p>
    <p>出發隊伍：${g.party.map((id) => `<span class="chip">${esc(CHARACTERS[id].name)}・${TACTIC[g.tactics[id]]}</span>`).join('')} <button class="link" data-act="tab" data-arg="party">調整</button></p>
    <div class="row"><button class="primary" data-act="depart">出發遠征</button><button data-act="buyPotion" ${g.gold < POTION_PRICE ? 'disabled' : ''}>買藥水（${POTION_PRICE} 金幣）</button>${last ? `<span class="muted small">${last}</span>` : ''}</div></div>
    ${campfire()}
    <div class="panel"><h3>營地紀錄</h3><div class="log">${g.log.slice(-12).reverse().map((l) => `<div class="ln">${esc(l)}</div>`).join('')}</div></div>`;
}
function tabParty() {
  const g = ui.game;
  const cards = G.ownedIds(g).map((id) => CHARACTERS[id]).map((c) => {
    const st = G.effectiveStats(g, c.id), r = g.roster[c.id], inParty = g.party.includes(c.id);
    return `<div class="unit"><div class="name"><span>${esc(c.name)} ${c.rarity ? `<span class="chip rar-${c.rarity}">${c.rarity}</span>` : ''}<span class="small muted">${c.role}・Lv${r.level}</span></span>
      <button data-act="toggleParty" data-arg="${c.id}" class="${inParty ? 'primary' : ''}">${inParty ? '在隊伍中' : '加入'}</button></div>
      <p class="small muted">${esc(c.bio)}</p>
      <div class="small">命 ${st.hp}・攻 ${st.atk}・防 ${st.def}・速 ${st.spd}・暴 ${st.crit}%　經驗 ${r.xp}/${r.level * 60}</div>
      <div class="small">${c.skills.map((s) => `<span class="chip" title="${esc(SKILLS[s].desc)}">${SKILLS[s].name}</span>`).join('')}${r.learned.map((s) => `<span class="chip warn" title="${esc(SKILLS[s].desc)}">領悟・${SKILLS[s].name}</span>`).join('')}</div>
      ${r.meet?.text ? `<details class="small"><summary>相遇的那天</summary><p>${esc(r.meet.text)}</p><p class="muted">${r.meet.ai ? 'AI 生成的相遇故事，只是回憶，不代表正式設定。' : '模板故事（測試用）。'}</p></details>` : ''}
      <div class="row small" style="margin-top:6px">戰術 <select data-change="tactic" data-arg="${c.id}">${Object.entries(TACTIC).map(([k, n]) => `<option value="${k}" ${g.tactics[c.id] === k ? 'selected' : ''}>${n}</option>`).join('')}</select></div></div>`;
  }).join('');
  const ids = G.ownedIds(g);
  let pairs = '';
  for (let i = 0; i < ids.length; i++) for (let j = i + 1; j < ids.length; j++) {
    const xp = G.pairXp(g, ids[i], ids[j]);
    pairs += `<tr><td>${CHARACTERS[ids[i]].name} × ${CHARACTERS[ids[j]].name}</td><td>Lv${pairLevel(xp)}</td><td>${xp}/100</td></tr>`;
  }
  return `<div class="panel"><h2>隊伍編成</h2><p class="small muted">選三人出發。戰術決定自動戰鬥時的行為：進攻＝集火、少用支援；均衡；守護＝提早治療與守護、優先打攻擊力高的敵人。</p>
    <p>目前：${g.party.map((id) => CHARACTERS[id].name).join('、')}（${g.party.length}/3）</p><div class="grid">${cards}</div></div>
    <div class="panel"><h2>雙人合作熟練度</h2><p class="small muted">只計算兩人之間。換掉第三人不會影響其他搭檔。熟練度 Lv1 起可觸發連攜追擊。</p>
    <div class="tablewrap"><table><tr><th>搭檔</th><th>等級</th><th>熟練度</th></tr>${pairs}</table></div></div>`;
}
function tabGear() {
  const g = ui.game;
  const rows = G.ownedIds(g).map((id) => CHARACTERS[id]).map((c) => {
    const r = g.roster[c.id];
    return `<tr><td>${esc(c.name)}</td>${['weapon', 'armor'].map((s) => `<td style="text-align:left">${r.equip[s] ? `${itemText(r.equip[s])} <button class="link" data-act="unequip" data-arg="${c.id}:${s}">卸下</button>` : '<span class="muted">—</span>'}</td>`).join('')}</tr>`;
  }).join('');
  const equipOpts = (it) => G.ownedIds(g).map((id) => CHARACTERS[id]).map((c) => {
    const cur = g.roster[c.id].equip[itemDef(it).slot];
    return `<option value="${c.id}">${c.name}（${statDiffText(it, cur)}）</option>`;
  }).join('');
  const SORTS = { default: '取得順序', rarity: '稀有度', slot: '部位' };
  const sortSel = `<div class="row small">排序 <select data-change="invSort">${Object.entries(SORTS).map(([k, n]) => `<option value="${k}" ${ui.invSort === k ? 'selected' : ''}>${n}</option>`).join('')}</select></div>`;
  const inv = g.inventory.length ? sortSel + inventoryOrder(g.inventory, ui.invSort).map((i) => { const it = g.inventory[i]; return `<div class="row invrow"><span class="invname">${itemText(it)}</span>
      <select data-change="equip" data-arg="${i}"><option value="">裝備給…</option>${equipOpts(it)}</select>
      ${ui.confirm === `salvage:${i}` ? `<span class="confirm"><b>分解換 ${SALVAGE_GOLD[itemDef(it).rarity]} 金幣？</b><button data-act="salvageYes" data-arg="${i}">分解</button><button data-act="cancelConfirm">取消</button></span>` : `<button class="small" data-act="salvage" data-arg="${i}">分解</button>`}</div>`; }).join('')
    : '<p class="muted">背包是空的。遠征中撿到的物品只有平安回來才會入袋。</p>';
  return `<div class="panel"><h2>裝備</h2><div class="tablewrap"><table><tr><th>角色</th><th style="text-align:left">武器</th><th style="text-align:left">防具</th></tr>${rows}</table></div></div>
    <div class="panel"><h3>背包</h3><p class="small muted">越深的樓層越容易掉落帶詞綴的裝備；每多一個詞綴，稀有度提升一級（普通→精良→稀有→史詩）。用不到的可以分解換金幣。</p>${inv}</div>`;
}
function tabResearch() {
  const g = ui.game;
  const d = g.discoveries.guardian_trust;
  let hidden = '';
  if (d.status === 'confirmed') hidden = `<p><b>${BONDS.guardian_trust.name}</b> <span class="chip good">已確認</span></p><p>${esc(BONDS.guardian_trust.desc)}</p>`;
  else if (d.status === 'suspected') hidden = `<p><b>未知效果</b> <span class="chip warn">疑似</span></p><p>戰報中出現 ${d.observations} 次「未解析效果」：阿德替小梅擋下攻擊時，防禦比面板高。</p>`;
  else hidden = `<p><b>？？？</b> <span class="chip">未發現</span></p><p class="muted">${d.observations ? `戰報中出現過 ${d.observations} 次「未解析效果」。` : '尚無線索。留意詳細戰報裡的「未解析效果」。'}</p>`;
  const exp = ui.exp ? `<div class="panel"><h3>實驗結果：阿德守護${CHARACTERS[ui.exp.ward].name}</h3>
    <p>試驗 ${ui.exp.trials} 場，阿德代為承受 ${ui.exp.intercepts} 次攻擊。面板防禦 ${ui.exp.baseDef}，實際平均防禦 ${ui.exp.avgDef}。
    ${ui.exp.anomaly ? `<b>發現未解析修正 +${ui.exp.unexplained}</b>` : '沒有偏差。'}（阿德×${CHARACTERS[ui.exp.ward].name} 熟練度 Lv${ui.exp.pairLevel}）</p>
    ${ui.exp.confirmedNow ? '<p class="chip good">對照實驗成立，效果已確認！</p>' : ''}</div>` : '';
  return `<div class="panel"><h2>羈絆研究</h2><p class="small muted">效果的實際數值一定真實地出現在戰報裡；只是來源可能還不知道。一次偶然不能算證實。</p>
    <h3>${BONDS.chain_followup.name} <span class="chip good">公開</span></h3><p>${esc(BONDS.chain_followup.desc)}</p><hr style="border:none;border-top:1px solid var(--line)">${hidden}</div>
    <div class="panel"><h2>訓練場</h2><p class="small muted">同樣的木樁、同樣的亂數種子，只換被守護的人，做對照實驗。訓練場不給經驗、熟練度，也不寫入記憶。</p>
    <div class="row"><span>阿德守護：</span>${['xiaomei', 'airin', 'rook'].map((w) => `<button data-act="experiment" data-arg="${w}">${CHARACTERS[w].name}</button>`).join('')}</div>
    <p class="small muted" style="margin-top:8px">對照組：${d.test_control ? '✔ 已完成' : '未完成'}　實驗組：${d.test_with ? '✔ 發現差異' : '未完成'}</p></div>${exp}`;
}
function tabMemory() {
  const g = ui.game;
  if (!g.memories.length) return '<div class="panel"><h2>記憶簿</h2><p class="muted">還沒有任何記憶。只有規則判定的重大事件（第一次擊殺、第一次連攜、守護瀕死的隊友、首次觀察到未解析的羈絆效果、研究確認羈絆效果、擊敗宿敵）會被記住，閒聊與台詞不會。</p></div>';
  return `<div class="panel"><h2>記憶簿</h2><p class="small muted">每一筆都能回溯到戰鬥事件。台詞、演出與營火閒聊不會寫進這裡。</p>
    ${g.memories.map((m) => `<div class="moment"><div>${esc(m.text)}</div><div class="small muted">第 ${m.day} 天・${m.battle_id ? `戰鬥 ${m.battle_id}` : '研究室'}・記得的人：${m.witnesses.map((w) => CHARACTERS[w]?.name).join('、')}</div></div>`).join('')}</div>`;
}
function tabArchive() {
  const g = ui.game;
  if (!g.reports.length) return '<div class="panel"><h2>戰報檔案</h2><p class="muted">還沒有戰鬥紀錄。</p></div>';
  return `<div class="panel"><h2>戰報檔案（最近 5 場）</h2>${g.reports.map((r, i) => {
    const s = summary(r.record);
    return `<div class="row" style="justify-content:space-between;border-bottom:1px solid var(--line);padding:6px 0"><span>${r.record.battle_id}・第 ${r.day} 天・${r.record.combatants.filter((c) => c.team === 'enemy').map((c) => esc(c.name)).join('、')}</span><span><span class="chip ${s.outcome === 'victory' ? 'good' : 'bad'}">${s.outcomeText}</span> <button data-act="openReport" data-arg="${i}">查看</button></span></div>`;
  }).reverse().join('')}</div>`;
}
function tabSettings() {
  const g = ui.game;
  return `<div class="panel"><h2>設定</h2>
    <div class="row" style="margin-bottom:8px">每場演出量 <select data-change="density">${[[1, '精簡（1 段）'], [3, '標準（3 段）'], [6, '豐富（6 段）']].map(([v, n]) => `<option value="${v}" ${g.settings.density === v ? 'selected' : ''}>${n}</option>`).join('')}</select></div>
    <div class="row" style="margin-bottom:8px">戰鬥模式 <select data-change="mode"><option value="auto" ${g.settings.mode === 'auto' ? 'selected' : ''}>依戰術自動</option><option value="manual" ${g.settings.mode === 'manual' ? 'selected' : ''}>逐回合指揮</option></select></div>
    <div class="row" style="margin-bottom:8px">外觀 <select data-change="theme">${[['', '跟隨系統'], ['light', '淺色'], ['dark', '深色']].map(([v, n]) => `<option value="${v}" ${(document.documentElement.dataset.theme || '') === v ? 'selected' : ''}>${n}</option>`).join('')}</select></div></div>
    <div class="panel"><h3>存檔</h3><p class="small muted">進度自動存在這個瀏覽器。換裝置時可以匯出／匯入。</p>
    <div class="row"><button data-act="export">匯出存檔</button><button data-act="importPick">匯入存檔</button>${ui.confirm === 'reset' ? '<span class="confirm"><b class="err">確定刪除？</b><button data-act="resetYes">刪除</button><button data-act="cancelConfirm">取消</button></span>' : '<button data-act="reset">刪除存檔並重來</button>'}</div>
    ${ui.exportText ? `<p class="small muted" style="margin-top:10px">如果下載沒有反應，複製下面的文字存成 .json 檔，或貼到另一台裝置的「貼上存檔」。</p><textarea id="exportText" readonly>${esc(ui.exportText)}</textarea><div class="row"><button data-act="copyExport">複製</button></div>` : ''}
    <details style="margin-top:10px"><summary>貼上存檔</summary><textarea id="pasteSave" placeholder="把匯出的存檔文字貼在這裡"></textarea><button data-act="pasteImport">匯入貼上的存檔</button></details></div>
    <div class="panel"><h3>回報問題</h3><p class="small muted">遇到錯誤時，把下面這行版本資訊和發生的情況一起告訴開發者。</p><code class="small">v${RULES_VERSION}・seed ${g.seed}・第 ${g.day} 天・戰鬥 ${g.battles_fought} 場・地城 ${G.dungeonState(g)}</code></div>`;
}

// ── 遠征地圖 ──────────────────────────────────────────
function partyPanel(withPotion) {
  const g = ui.game, ex = g.expedition;
  return `<div class="side">${g.party.map((id) => {
    const max = G.effectiveStats(g, id).hp;
    return `<div class="unit ${ex.hp[id] <= 0 ? 'dead' : ''}"><div class="name"><span>${esc(CHARACTERS[id].name)}</span><span class="small muted">${TACTIC[g.tactics[id]]}</span></div>${hpBar(ex.hp[id], max)}
    ${withPotion ? `<button class="small" data-act="potion" data-arg="${id}" ${g.potions < 1 || ex.hp[id] >= max ? 'disabled' : ''}>喝藥水 +30</button>` : ''}</div>`;
  }).join('')}</div>`;
}
function viewMap() {
  const g = ui.game, ex = g.expedition;
  const floor = DUNGEON.floors[ex.floor];
  const ember = G.dungeonState(g) === 'ember_return' ? ' <span class="chip warn">餘燼回流</span>' : '';
  return `${topbar()}${messages()}<div class="panel"><h2>${esc(floor.name)}${ember}</h2><p class="muted small">第 ${ex.floor + 1}/3 層・第 ${ex.step + 1}/3 步　本次收穫：${ex.loot.length} 件物品、${ex.gold} 金幣</p>
    ${partyPanel(true)}</div>
    <div class="panel"><h3>前方的路</h3>${ex.choices.map((c, i) => `<button class="choice" data-act="route" data-arg="${i}">${esc(c.label)}${c.bonusLoot ? ' <span class="chip warn">有寶物的氣息</span>' : ''}</button>`).join('')}
    <div class="row">${ui.confirm === 'retreat' ? '<span class="confirm"><b>確定撤退？目前的收穫會保留。</b><button class="primary" data-act="retreatYes">撤退</button><button data-act="cancelConfirm">繼續探索</button></span>' : '<button data-act="retreat">撤退回營地（保留收穫）</button>'}</div></div>`;
}
function viewEvent() {
  const g = ui.game, ex = g.expedition;
  const ev = ENCOUNTER_EVENTS[ex.pending.event_id];
  return `${topbar()}${messages()}<div class="panel"><h2>${esc(ev.title)}</h2><p>${esc(ev.text)}</p>
    ${ev.choices.map((c) => `<button class="choice" data-act="eventChoice" data-arg="${c.id}" ${G.eventChoiceAllowed(g, c) ? '' : 'disabled'}>${esc(c.label)}</button>`).join('')}</div>
    <div class="panel">${partyPanel(false)}</div>`;
}

// ── 戰鬥 ──────────────────────────────────────────
function unitCard(st, c) {
  const a = st.actors[c.actor_id];
  return `<div class="unit ${a.alive ? '' : 'dead'}" data-unit="${c.actor_id}"><div class="name"><span>${esc(c.name)}</span>${a.alive ? (a.phase === 2 ? '<span class="chip bad">第二階段</span>' : '') : '<span class="chip bad">倒下</span>'}</div>${hpBar(a.hp, c.hp_max, a.shield)}
    <div>${a.statuses.map((s) => `<span class="chip">${STATUSES[s.status_id].name}${s.stacks > 1 ? '×' + s.stacks : ''}・${s.remaining_turns}</span>`).join('')}</div></div>`;
}
function manualPanel(st) {
  const party = st.record.combatants.filter((c) => c.team === 'party' && st.actors[c.actor_id].alive);
  return party.map((c) => {
    if (!ui.cmds[c.actor_id]) ui.cmds[c.actor_id] = chooseAction(st, c.actor_id);
    const cmd = ui.cmds[c.actor_id];
    const sk = SKILLS[cmd.skill_id];
    const skills = currentSkills(st, c.actor_id).map((s) => { const cd = st.actors[c.actor_id].cooldowns[s] || 0; return `<option value="${s}" ${s === cmd.skill_id ? 'selected' : ''} ${cd > 0 ? 'disabled' : ''}>${SKILLS[s].name}${cd > 0 ? `（冷卻 ${cd}）` : ''}</option>`; }).join('');
    let targets = '<span class="small muted">全體</span>';
    if (sk.target === 'enemy' || sk.target === 'ally') {
      const team = sk.target === 'enemy' ? 'enemy' : 'party';
      const opts = st.record.combatants.filter((x) => x.team === team && st.actors[x.actor_id].alive && !(sk.kind === 'guard' && x.actor_id === c.actor_id));
      if (!opts.some((o) => o.actor_id === cmd.target_id)) cmd.target_id = opts[0]?.actor_id;
      targets = `<select data-change="cmdTarget" data-arg="${c.actor_id}">${opts.map((o) => `<option value="${o.actor_id}" ${o.actor_id === cmd.target_id ? 'selected' : ''}>${esc(o.name)}（${st.actors[o.actor_id].hp}）</option>`).join('')}</select>`;
    } else cmd.target_id = null;
    return `<div class="cmd"><b>${esc(c.name)}</b><select data-change="cmdSkill" data-arg="${c.actor_id}">${skills}</select>${targets}</div>`;
  }).join('');
}
function viewBattle() {
  const st = ui.battle, g = ui.game, ex = g.expedition;
  const party = st.record.combatants.filter((c) => c.team === 'party');
  const enemies = st.record.combatants.filter((c) => c.team === 'enemy');
  const lines = simpleLog(st.record, g.discoveries).slice(-14);
  const manual = g.settings.mode === 'manual';
  const intelTexts = [];
  if (ex.pending.type === 'boss' && g.flags.intel_boss) intelTexts.push('殘響騎士會用「灰燼波」攻擊全體。');
  if (ex.pending.type === 'boss' && g.flags.intel_phase2) intelTexts.push('HP 降到一半後，殘響騎士會用「餘燼狂怒」灼燒全體。');
  const intel = intelTexts.length ? `<div class="notice">情報：${intelTexts.join('')}</div>` : '';
  const controls = st.done
    ? `<button class="primary" data-act="finishBattle">查看戰報</button>`
    : `${manual ? `<div style="margin-bottom:8px">${manualPanel(st)}</div><div class="row"><button class="primary" data-act="round">執行第 ${st.round + 1} 回合</button><button data-act="autoAll">剩下交給戰術</button></div>`
      : `<div class="row"><button class="primary" data-act="round">下一回合（${st.round + 1}）</button><button data-act="autoAll">自動打完</button></div>`}`;
  return `${topbar()}${messages()}${intel}<div class="panel"><h3>敵人</h3><div class="side">${enemies.map((c) => unitCard(st, c)).join('')}</div></div>
    <div class="panel"><h3>我方</h3><div class="side">${party.map((c) => unitCard(st, c)).join('')}</div></div>
    <div class="panel"><div class="row" style="justify-content:space-between"><h3>戰況</h3><span class="small muted">第 ${st.round} 回合${st.done ? '・結束' : ''}</span></div>
    <div class="log" id="battlelog">${lines.length ? lines.map((l) => `<div class="ln ${l.team === 'enemy' ? 'enemy' : ''}"><span class="t">R${l.turn}</span>${esc(l.text)}</div>`).join('') : '<div class="ln muted">戰鬥開始。</div>'}</div></div>
    <div class="panel">${controls}</div>`;
}

// ── 戰報 ──────────────────────────────────────────
function viewReport() {
  const g = ui.game;
  const rep = g.reports[ui.reportIdx];
  const rec = rep.record;
  const tabs = [['summary', '結算'], ['log', '戰報'], ['stats', '統計與狀態'], ['moments', '隊伍演出']];
  const body = { summary: repSummary, log: repLog, stats: repStats, moments: repMoments }[ui.rtab](rep, rec);
  const back = ui.fromExpedition ? `<button class="primary" data-act="afterReport">${g.expedition ? '繼續探索' : '返回營地'}</button>` : '<button data-act="backCamp">返回</button>';
  return `${topbar()}${messages()}<div class="row" style="justify-content:space-between;margin-bottom:8px"><h2 style="margin:0">戰報 ${rec.battle_id}</h2>${back}</div>
    <div class="tabs">${tabs.map(([k, n]) => `<button class="${ui.rtab === k ? 'on' : ''}" data-act="rtab" data-arg="${k}">${n}</button>`).join('')}</div>${body}`;
}
function repSummary(rep, rec) {
  const s = summary(rec);
  const rows = s.party.map((p) => `<tr><td>${esc(p.name)}</td><td>${p.damage}</td><td>${p.taken}</td><td>${p.healing}</td><td>${p.kills}</td></tr>`).join('');
  const rewards = [];
  if (rep.gold) rewards.push(`金幣 +${rep.gold}`);
  if (rep.gems) rewards.push(`寶石 +${rep.gems}`);
  for (const it of rep.loot) rewards.push(itemDef(it).name);
  for (const id of rep.levelUps) rewards.push(`${CHARACTERS[id].name} 升級`);
  for (const [k, v] of Object.entries(rep.pairGain)) if (v) rewards.push(`${k.split('|').map((x) => CHARACTERS[x].name).join('×')} 熟練度 +${v}`);
  const mems = rep.newMemories.map((k) => g().memories.find((m) => m.key === k)).filter(Boolean);
  return `<div class="panel"><h2><span class="chip ${s.outcome === 'victory' ? 'good' : 'bad'}" style="font-size:16px">${s.outcomeText}</span> ${s.rounds} 回合</h2>
    <div class="tablewrap"><table><tr><th>角色</th><th>有效傷害</th><th>承傷</th><th>有效治療</th><th>擊倒</th></tr>${rows}</table></div></div>
    <div class="panel"><h3>重要事件</h3>${s.highlights.length ? s.highlights.map((h) => `<div><button class="link" data-act="jump" data-arg="${h.event_id}">${esc(h.text)}</button></div>`).join('') : '<p class="muted">沒有特別的事。</p>'}</div>
    <div class="panel"><h3>收穫</h3><p>${rewards.length ? rewards.map((r) => `<span class="chip">${esc(r)}</span>`).join('') : '<span class="muted">無</span>'}</p>
    ${mems.length ? `<h3>新的記憶</h3>${mems.map((m) => `<div class="moment">${esc(m.text)}</div>`).join('')}` : ''}</div>`;
}
const g = () => ui.game;
function repLog(rep, rec) {
  const disc = g().discoveries;
  const actors = rec.combatants;
  const filterSel = `<select data-change="actorFilter"><option value="">全部角色</option>${actors.map((c) => `<option value="${c.actor_id}" ${ui.actorFilter === c.actor_id ? 'selected' : ''}>${esc(c.name)}</option>`).join('')}</select>`;
  let lines, opts = null;
  if (ui.detailed) {
    lines = detailedLog(rec, disc);
    if (ui.idFilter) lines = lines.filter((l) => ui.idFilter.includes(l.event_id));
    else { opts = filterOptions(lines, rec); lines = filterDetailedLog(lines, rec, { actor: ui.actorFilter, ...ui.lf }); }
  } else {
    lines = simpleLog(rec, disc);
    if (ui.actorFilter) { const n = actors.find((c) => c.actor_id === ui.actorFilter).name; lines = lines.filter((l) => l.text.includes(n)); }
  }
  const banner = ui.idFilter ? `<div class="notice">只顯示 ${ui.idFilter.length} 個來源事件 <button class="link" data-act="clearIdFilter">顯示全部</button></div>` : '';
  const lsel = (key, label, list) => `<select data-change="logFilter" data-arg="${key}" aria-label="${label}"><option value="">${label}</option>${list.map((o) => `<option value="${esc(o.id)}" ${ui.lf[key] === o.id ? 'selected' : ''}>${esc(o.name)}</option>`).join('')}</select>`;
  const extra = opts && !ui.idFilter ? `${lsel('skill', '全部技能', opts.skills)}${lsel('type', '全部事件類型', opts.types)}${lsel('status', '全部狀態', opts.statuses)}${lsel('turn', '全部回合', opts.turns)}<button class="link" data-act="clearFilters">清除篩選</button>` : '';
  return `<div class="panel"><div class="row" style="margin-bottom:8px"><button data-act="toggleDetail">${ui.detailed ? '切換到簡易' : '切換到詳細'}</button>${filterSel}${extra}</div>${banner}
    <div class="log" style="max-height:560px">${lines.map((l) => `<div class="ln ${ui.hl === l.event_id ? 'hl' : ''}" id="ev-${esc(l.event_id.replace(':', '-'))}"><span class="t">R${l.turn}${ui.detailed ? '・' + esc(l.type) : ''}</span>${esc(l.text)}</div>`).join('') || '<div class="ln muted">沒有符合的事件</div>'}</div></div>`;
}
function srcBtn(n, ids) { return ids.length ? `<button class="link" data-act="src" data-arg="${ids.join(',')}">${n}</button>` : String(n); }
function repStats(rep, rec) {
  const st = computeStats(rec);
  const rows = Object.values(st).map((s) => `<tr><td>${esc(s.name)}</td><td>${srcBtn(s.damage, s.damage_src)}</td><td>${s.shield_damage}</td><td>${s.overkill}</td><td>${srcBtn(s.taken, s.taken_src)}</td><td>${srcBtn(s.healing, s.heal_src)}</td><td>${srcBtn(s.kills, s.kill_src)}</td>
    <td>${s.hits + s.misses ? Math.round((s.hits * 100) / (s.hits + s.misses)) + '%' : '—'}</td><td>${s.crits}</td><td>${s.chain_opps ? `${srcBtn(s.chain_success, s.chain_src)}/${s.chain_opps}` : '—'}</td></tr>`).join('');
  const skillRows = Object.values(st).flatMap((s) => [...new Set([...Object.keys(s.skill_uses), ...Object.keys(s.by_skill)])].map((k) => `<tr data-skillrow><td>${esc(s.name)}</td><td style="text-align:left">${esc(skillLabel(k))}</td><td>${srcBtn(s.skill_uses[k] || 0, s.skill_src[k] || [])}</td><td>${s.by_skill[k] || 0}</td></tr>`)).join('');
  const curve = hpCurve(rec);
  const W = 640, H = 200, P = 28;
  const n = rec.turns.length;
  const maxHp = Math.max(...rec.combatants.map((c) => c.hp_max));
  const x = (i) => P + ((W - P * 2) * i) / Math.max(1, n);
  const y = (v) => H - P - ((H - P * 2) * v) / maxHp;
  const paths = rec.combatants.map((c, i) => `<polyline fill="none" stroke="${SERIES[i % SERIES.length]}" stroke-width="2" ${c.team === 'enemy' ? 'stroke-dasharray="4 3"' : ''} points="${curve[c.actor_id].map((v, k) => `${x(k).toFixed(1)},${y(v).toFixed(1)}`).join(' ')}"><title>${esc(c.name)}</title></polyline>`).join('');
  const axis = `<line x1="${P}" y1="${H - P}" x2="${W - P}" y2="${H - P}" stroke="var(--line)"/>${Array.from({ length: n + 1 }, (_, k) => `<text x="${x(k)}" y="${H - 10}" text-anchor="middle">${k}</text>`).join('')}<text x="4" y="${P}">HP</text>`;
  const legend = rec.combatants.map((c, i) => `<span><i style="background:${SERIES[i % SERIES.length]}"></i>${esc(c.name)}</span>`).join('');
  return `<div class="panel"><h3>統計</h3><p class="small muted">點擊數字可以看到構成它的每一個事件。連攜欄的分母是「符合觸發資格的機會」。</p>
    <div class="tablewrap"><table><tr><th>角色</th><th>有效傷害</th><th>打護盾</th><th>超殺</th><th>承傷</th><th>有效治療</th><th>擊倒</th><th>命中</th><th>暴擊</th><th>連攜</th></tr>${rows}</table></div></div>
    <div class="panel"><h3>技能使用</h3><p class="small muted">次數以宣告行動計（無效指令不算）；傷害為有效傷害，含持續傷害與連攜追擊。</p>
    <div class="tablewrap"><table id="skillTable"><tr><th>角色</th><th style="text-align:left">技能</th><th>次數</th><th>傷害</th></tr>${skillRows}</table></div></div>
    <div class="panel"><h3>HP 曲線（每回合結束）</h3><svg viewBox="0 0 ${W} ${H}" width="100%" role="img" aria-label="HP 曲線">${axis}${paths}</svg><div class="legend">${legend}</div></div>`;
}
function repMoments(rep) {
  if (!rep.moments.length) return '<div class="panel"><p class="muted">這場沒有演出。</p></div>';
  const st = ui.ai[ui.reportIdx];
  const canAI = ui.sample && rep.moments.some(aiEligible);
  const aiBar = !canAI ? '' : `<div class="panel" id="aiPanel"><div class="row"><b>AI 演出（試驗）</b>
      ${st?.status === 'loading' ? '<span class="muted">Claude 正在寫……</span><button class="small" data-act="aiStop">停止</button>'
        : `<button class="small" data-act="aiRewrite">${st?.results ? '重新產生' : '用 AI 改寫這場的演出'}</button>`}</div>
      <p class="small muted">用你的 Claude 額度改寫下方台詞。AI 只拿到這場真實發生的事件，寫出的內容經驗證才顯示，不影響數值、不寫入記憶、不存檔；沒通過驗證的段落保留模板。作者文本與敵人台詞不交給 AI。</p>
      ${st?.error ? `<div class="notice err">${esc(st.error)}</div>` : ''}
      ${st?.prompt ? `<details><summary class="small">看送出的提示詞</summary><pre class="aiprompt">${esc(st.prompt)}</pre></details>` : ''}</div>`;
  return `${aiBar}<div class="panel"><p class="small muted">演出只引用真實發生的事件，不影響任何數值，也不寫入記憶。</p>
    ${rep.moments.map((m, i) => {
      const ai = st?.results?.[i], why = st?.rejected?.[i];
      const body = ai ? `${ai.lines.map(esc).join('<br>')}<div class="small muted">模板：${esc(m.text)}</div>` : esc(m.text);
      const chip = m.author ? ' <span class="chip warn">作者文本</span>' : ai ? ' <span class="chip">AI</span>' : why ? ` <span class="chip warn">AI 未通過：${esc(why)}，使用模板</span>` : '';
      return `<div class="moment ${m.author ? 'author' : ''}">${body}<div class="small"><button class="link" data-act="jump" data-arg="${m.event_ids[0]}">對應事件</button>${chip}</div></div>`;
    }).join('')}</div>`;
}

const AI_ERRORS = { not_granted: '你沒有允許這個頁面使用 Claude，AI 演出已關閉。', sampling_disabled: '這個帳號不能使用 Claude。', rate_limited: '呼叫太頻繁或額度用完，請稍後再試。', session_expired: '請重新登入 claude.ai。', refused: 'Claude 拒絕了這次請求，保留模板。', invalid_json: 'AI 回覆格式錯誤，保留模板。可以再試一次。' };
async function aiRewrite() {
  const idx = ui.reportIdx, rep = ui.game.reports[idx];
  const { prompt, items } = buildPrompt(rep.moments, rep.record);
  ui.aiCtl?.abort();
  const ctl = ui.aiCtl = new AbortController();
  ui.ai[idx] = { status: 'loading', prompt };
  render();
  try {
    const out = await ui.sample.json(prompt, { signal: ctl.signal, cache: false });
    const { ok, rejected } = validateAI(out, items, rep.record);
    ui.ai[idx] = { status: 'done', prompt, results: ok, rejected };
  } catch (e) {
    if (['not_granted', 'sampling_disabled', 'not_declared', 'capability_disabled', 'capability_removed'].includes(e?.code)) ui.sample = null;
    ui.ai[idx] = { status: 'error', prompt, error: e?.code === 'cancelled' ? null : (AI_ERRORS[e?.code] ?? 'AI 暫時無法使用，保留模板。') };
  }
  if (ui.aiCtl === ctl) ui.aiCtl = null;
  render();
}

// ── 主繪製與事件 ──────────────────────────────────────────
export function render() {
  const v = ui.view;
  const html = v === 'title' ? viewTitle() : v === 'camp' ? viewCamp() : v === 'map' ? viewMap() : v === 'event' ? viewEvent() : v === 'battle' ? viewBattle() : viewReport();
  root().innerHTML = html + `<footer>眾神殞落・垂直切片 v${RULES_VERSION}　所有角色與數值皆為測試用</footer>`;
  const bl = document.getElementById('battlelog');
  if (bl) bl.scrollTop = bl.scrollHeight;
  if (ui.hl) document.getElementById('ev-' + ui.hl.replace(':', '-'))?.scrollIntoView({ block: 'center' });
}

function act(name, arg) {
  const game = ui.game;
  ui.err = null; ui.msg = null; ui.confirm = null;
  if (name !== 'talk') ui.talk = null;
  if (name === 'tab') ui.gacha = null;
  switch (name) {
    case 'new': ui.game = G.newGame(); save(); ui.view = 'camp'; ui.tab = 'camp'; break;
    case 'continue': { const s = loadSaved(); if (!s) { ui.err = '讀取存檔失敗'; break; } ui.game = s; routeFromGame(); break; }
    case 'tab': ui.tab = arg; break;
    case 'toggleParty': {
      const p = [...game.party];
      if (p.includes(arg)) { if (p.length <= 1) break; p.splice(p.indexOf(arg), 1); game.party = p; }
      else if (p.length < 3) game.party = [...p, arg];
      else ui.err = '隊伍最多三人，請先移出一人。';
      save(); break;
    }
    case 'depart':
      if (game.party.length !== 3) { ui.err = '需要三名隊員才能出發。'; break; }
      G.startExpedition(game); save(); ui.view = 'map'; break;
    case 'buyPotion': G.buyPotion(game); save(); break;
    case 'salvage': ui.confirm = `salvage:${arg}`; break;
    case 'salvageYes': ui.msg = `分解完成，得到 ${G.salvage(game, +arg)} 金幣`; save(); break;
    case 'talk': {
      const [id, intent] = arg.split(':');
      const r = G.talk(game, { actor_id: id, intent }); save();
      if (ui.dlg?.id !== id) ui.dlg = { id, lines: [], turns: [], follow: [] };
      const label = TALK_INTENTS[intent] ?? TOPICS[id].find((t) => t.id === intent).label;
      ui.dlg.lines.push({ who: 'you', text: label }, { who: id, text: r.text, note: `好感 ${r.affinity}${r.refs.length ? `・依據：${r.refs.join('、')}` : ''}` });
      ui.dlg.follow = r.follow || []; ui.dlg.topic = intent;
      break;
    }
    case 'follow': {
      const [id, topic, fid] = arg.split(':');
      const f = TOPICS[id].find((t) => t.id === topic).follow.find((x) => x.id === fid);
      ui.dlg.lines.push({ who: 'you', text: f.label }, { who: id, text: followLine(id, topic, fid).text });
      ui.dlg.follow = ui.dlg.follow.filter((x) => x.id !== fid);
      break;
    }
    case 'openDlg': ui.dlg?.ctl?.abort(); ui.dlg = ui.dlg?.id === arg ? null : { id: arg, lines: [], turns: [], follow: [] }; ui.chatDraft = ''; break;
    case 'closeDlg': ui.dlg?.ctl?.abort(); ui.dlg = null; ui.chatDraft = ''; break;
    case 'chatSend': chatSend(); break;
    case 'chatStop': ui.dlg?.ctl?.abort(); break;
    case 'pull': {
      const r = G.pull(game, arg, { free: ui.testMode }); save();
      ui.gacha = r.pool === 'skill' ? `${CHARACTERS[r.actor_id].name}領悟了「${SKILLS[r.skill_id].name}」！` : r.duplicate ? `抽到 ${r.rarity}，但這個稀有度的夥伴都已經在隊上了。退回 ${r.refund} 寶石。` : null;
      ui.meet = null;
      if (r.actor_id && r.pool === 'recruit' && ui.sample) meetAI();
      break;
    }
    case 'meetAI': meetAI(); break;
    case 'join': {
      const id = game.pendingRecruit.id, m = ui.meet?.id === id ? ui.meet : null;
      G.joinRecruit(game, m?.story ? { text: m.story, ai: true } : { text: MEET_TEMPLATES[id], ai: false }); save();
      ui.gacha = `${CHARACTERS[id].name}加入了隊伍！到「隊伍」分頁可以讓${CHARACTERS[id].name}上陣。`; ui.meet = null;
      break;
    }
    case 'unequip': { const [id, slot] = arg.split(':'); G.unequip(game, id, slot); save(); break; }
    case 'experiment': ui.exp = G.runExperiment(game, arg); save(); break;
    case 'openReport': ui.reportIdx = +arg; ui.rtab = 'summary'; ui.fromExpedition = false; ui.view = 'report'; resetLogView(); break;
    case 'backCamp': ui.view = 'camp'; break;
    case 'export': exportSave(); break;
    case 'importPick': document.getElementById('importFile').click(); break;
    case 'reset': ui.confirm = 'reset'; break;
    case 'resetYes': try { localStorage.removeItem(SAVE_KEY); } catch { /* ignore */ } ui.game = null; ui.view = 'title'; ui.exportText = null; break;
    case 'cancelConfirm': break;
    case 'copyExport': { const ta = document.getElementById('exportText'); navigator.clipboard?.writeText(ui.exportText).then(() => {}, () => { ta.select(); }); ui.msg = '已複製存檔文字'; break; }
    case 'pasteImport': { const t = document.getElementById('pasteSave').value.trim(); ui.game = G.deserialize(t); save(); ui.msg = '存檔已匯入'; routeFromGame(); break; }
    case 'potion': G.usePotion(game, arg); save(); break;
    case 'retreat': ui.confirm = 'retreat'; break;
    case 'retreatYes': G.retreat(game); save(); ui.view = 'camp'; ui.tab = 'camp'; break;
    case 'route': { const r = G.chooseRoute(game, +arg); save(); if (r === 'battle') startBattleView(); else if (r === 'event') ui.view = 'event'; else routeFromGame(); break; }
    case 'eventChoice': { const m = G.resolveEvent(game, arg); save(); ui.msg = m.length ? m.join('，') : null; routeFromGame(); break; }
    case 'round': stepRound(ui.battle, game.settings.mode === 'manual' ? ui.cmds : {}); ui.cmds = {}; break;
    case 'autoAll': while (!ui.battle.done) stepRound(ui.battle); break;
    case 'finishBattle': {
      G.finishBattle(game, ui.battle.record); save();
      ui.battle = null; ui.reportIdx = game.reports.length - 1; ui.rtab = 'summary'; ui.fromExpedition = true; ui.view = 'report'; resetLogView();
      break;
    }
    case 'afterReport': if (game.expedition) routeFromGame(); else { ui.view = 'camp'; ui.tab = 'camp'; } break;
    case 'rtab': ui.rtab = arg; ui.hl = null; break;
    case 'aiRewrite': aiRewrite(); break;
    case 'aiStop': ui.aiCtl?.abort(); break;
    case 'toggleDetail': ui.detailed = !ui.detailed; ui.idFilter = null; break;
    case 'jump': ui.rtab = 'log'; ui.detailed = true; ui.idFilter = null; ui.actorFilter = ''; ui.lf = { skill: '', type: '', status: '', turn: '' }; ui.hl = arg; break;
    case 'src': ui.rtab = 'log'; ui.detailed = true; ui.idFilter = arg.split(','); ui.hl = null; break;
    case 'clearIdFilter': ui.idFilter = null; break;
    case 'clearFilters': ui.actorFilter = ''; ui.lf = { skill: '', type: '', status: '', turn: '' }; break;
    default: break;
  }
}
function resetLogView() { ui.detailed = false; ui.idFilter = null; ui.actorFilter = ''; ui.lf = { skill: '', type: '', status: '', turn: '' }; ui.hl = null; }

function change(name, arg, value) {
  const game = ui.game;
  ui.err = null;
  switch (name) {
    case 'tactic': G.setTactic(game, arg, value); save(); break;
    case 'equip': if (value) { G.equip(game, value, game.inventory[+arg]); save(); } break;
    case 'invSort': ui.invSort = value; break;
    case 'density': game.settings.density = +value; save(); break;
    case 'mode': game.settings.mode = value; save(); break;
    case 'theme': if (value) document.documentElement.dataset.theme = value; else delete document.documentElement.dataset.theme; try { localStorage.setItem('fallen-gods-theme', value); } catch { /* ignore */ } break;
    case 'cmdSkill': ui.cmds[arg] = { skill_id: value, target_id: ui.cmds[arg]?.target_id }; break;
    case 'cmdTarget': ui.cmds[arg].target_id = value; break;
    case 'actorFilter': ui.actorFilter = value; ui.idFilter = null; break;
    case 'logFilter': ui.lf[arg] = value; ui.idFilter = null; break;
    default: break;
  }
}

function exportSave() {
  ui.exportText = G.serialize(ui.game);
  const filename = `fallen-gods-day${ui.game.day}.json`;
  // claude.ai 託管頁面：透過 downloads 能力存檔（檢視者會看到確認視窗）；其他環境用一般下載連結
  if (window.claude?.use) {
    const text = ui.exportText;
    window.claude.use('downloads').then((dl) => {
      if (!dl) { ui.msg = '這個檢視環境不能直接下載，請複製下方文字。'; render(); return; }
      return dl.save({ filename, data: text }).then(() => { ui.msg = '存檔已下載'; render(); },
        (e) => { if (e?.code !== 'declined') { ui.msg = '無法下載，請複製下方文字。'; render(); } });
    }).catch(() => {});
    return;
  }
  const blob = new Blob([G.serialize(ui.game)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  try { a.click(); } catch { /* 沙盒環境可能擋下載，改用文字框 */ }
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

export function boot() {
  try { const t = localStorage.getItem('fallen-gods-theme'); if (t) document.documentElement.dataset.theme = t; } catch { /* ignore */ }
  const file = document.createElement('input');
  file.type = 'file'; file.accept = 'application/json,.json'; file.id = 'importFile'; file.hidden = true;
  document.body.appendChild(file);
  file.addEventListener('change', async () => {
    const f = file.files[0]; if (!f) return;
    try { ui.game = G.deserialize(await f.text()); save(); ui.err = null; ui.msg = '存檔已匯入'; routeFromGame(); }
    catch (e) { ui.err = '匯入失敗：' + e.message; }
    file.value = ''; render();
  });
  document.addEventListener('click', (e) => {
    const b = e.target.closest('[data-act]');
    if (!b || b.disabled) return;
    try { act(b.dataset.act, b.dataset.arg); } catch (err) { ui.err = err.message; }
    render();
  });
  document.addEventListener('change', (e) => {
    const s = e.target.closest('[data-change]');
    if (!s) return;
    try { change(s.dataset.change, s.dataset.arg, s.value); } catch (err) { ui.err = err.message; }
    render();
  });
  // claude.ai 託管頁是測試版：寶石無限
  ui.testMode = !!window.claude;
  render();
  // claude.ai 託管頁面：可以請 Claude 改寫演出、相遇故事、營火聊天（其他環境沒有 window.claude，功能隱藏）
  window.claude?.use?.('sample').then((s) => { if (s) { ui.sample = s; render(); } }, () => {});
  document.addEventListener('input', (e) => { if (e.target.id === 'chatInput') ui.chatDraft = e.target.value; });
  document.addEventListener('keydown', (e) => { if (e.target.id === 'chatInput' && e.key === 'Enter' && !e.isComposing) { e.preventDefault(); chatSend(); } });
}

// 給測試用的唯讀窗口
export const _debug = { ui, pairKey, ENEMIES };
