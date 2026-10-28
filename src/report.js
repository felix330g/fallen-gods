// 戰報：全部是從 BattleRecord 衍生的純函式。
import { SKILLS, STATUSES, BONDS, AFFIXES } from './data.js';

const nameOf = (rec, id) => rec.combatants.find((c) => c.actor_id === id)?.name ?? id;
export const skillLabel = (id) => SKILLS[id]?.name ?? STATUSES[id]?.name ?? (id === 'chain_followup' ? '連攜追擊' : id);
const skillName = skillLabel;
export const allEvents = (rec) => rec.turns.flatMap((t) => t.events);

/** 統計：每個數字都附上來源 event_id，方便點回詳細戰報 */
export function computeStats(rec) {
  const s = {};
  for (const c of rec.combatants) {
    s[c.actor_id] = { actor_id: c.actor_id, name: c.name, team: c.team,
      damage: 0, damage_src: [], shield_damage: 0, overkill: 0, taken: 0, taken_src: [], healing: 0, overheal: 0, heal_src: [],
      kills: 0, kill_src: [], actions: 0, skill_uses: {}, skill_src: {}, hits: 0, misses: 0, crits: 0, chain_opps: 0, chain_success: 0, chain_src: [], intercepts: 0, by_skill: {} };
  }
  const evs = allEvents(rec);
  const byId = Object.fromEntries(evs.map((e) => [e.event_id, e]));
  for (const e of evs) {
    const a = e.actor_id && s[e.actor_id];
    switch (e.event_type) {
      case 'action_declared': a.actions++; a.skill_uses[e.skill_id] = (a.skill_uses[e.skill_id] || 0) + 1; (a.skill_src[e.skill_id] ||= []).push(e.event_id); break;
      case 'hit_check': if (e.calculation.success) a.hits++; else a.misses++; break;
      case 'critical_check': if (e.calculation.success) a.crits++; break;
      case 'damage_applied': {
        const t = s[e.target_ids[0]];
        if (a) {
          a.damage += e.calculation.hp_damage; a.shield_damage += e.calculation.shield_absorbed; a.overkill += e.calculation.overkill;
          if (e.calculation.hp_damage) a.damage_src.push(e.event_id);
          a.by_skill[e.skill_id] = (a.by_skill[e.skill_id] || 0) + e.calculation.hp_damage;
        }
        t.taken += e.calculation.hp_damage; if (e.calculation.hp_damage) t.taken_src.push(e.event_id);
        if (e.flags?.intercepted_from) t.intercepts++;
        break;
      }
      case 'heal_applied': a.healing += e.calculation.effective; a.overheal += e.calculation.overheal; a.heal_src.push(e.event_id); break;
      case 'synergy_trigger_check': a.chain_opps++; if (e.calculation.success) { a.chain_success++; a.chain_src.push(e.event_id); } break;
      case 'actor_defeated': {
        const killer = byId[e.source_event_id]?.actor_id;
        if (killer && s[killer]) { s[killer].kills++; s[killer].kill_src.push(e.event_id); }
        break;
      }
      default: break;
    }
  }
  return s;
}

/** HP 曲線：每回合結束時的 HP */
export function hpCurve(rec) {
  const series = {};
  for (const c of rec.combatants) series[c.actor_id] = [c.hp_start];
  for (const t of rec.turns) for (const c of rec.combatants) series[c.actor_id].push(t.end_snapshot.actors[c.actor_id].hp);
  return series;
}

export function summary(rec, extra = {}) {
  const st = computeStats(rec);
  const party = Object.values(st).filter((x) => x.team === 'party');
  const highlights = [];
  for (const e of allEvents(rec)) {
    if (e.event_type === 'phase_changed') highlights.push({ event_id: e.event_id, text: `${nameOf(rec, e.actor_id)} 進入第二階段` });
    if (e.event_type === 'actor_defeated') highlights.push({ event_id: e.event_id, text: `${nameOf(rec, e.flags.killer_id)} 擊倒了 ${nameOf(rec, e.actor_id)}` });
    if (e.event_type === 'synergy_trigger_check' && e.calculation.success) highlights.push({ event_id: e.event_id, text: `${nameOf(rec, e.actor_id)} 接續 ${nameOf(rec, e.flags.partner_id)} 發動連攜追擊` });
    if (e.event_type === 'damage_applied' && e.flags?.intercepted_from && !e.flags.dot) highlights.push({ event_id: e.event_id, text: `${nameOf(rec, e.target_ids[0])} 替 ${nameOf(rec, e.flags.intercepted_from)} 擋下 ${nameOf(rec, e.actor_id)} 的攻擊` });
  }
  const outcomeText = { victory: '勝利', defeat: '全滅', retreat: '回合用盡・撤退' }[rec.result?.outcome] ?? '進行中';
  return { outcome: rec.result?.outcome, outcomeText, rounds: rec.result?.ended_turn ?? rec.turns.length, party, highlights: highlights.slice(0, 8), ...extra };
}

function hiddenText(e, discoveries, showHidden) {
  const ids = e.calculation?.hidden_modifier_ids || [];
  if (!ids.length) return '';
  return ids.map((id) => {
    const known = showHidden || discoveries?.[id]?.status === 'confirmed';
    return known ? `【${BONDS[id].name}】防禦 +${e.calculation.hidden_def_bonus}` : `未解析效果 防禦 +${e.calculation.hidden_def_bonus}`;
  }).join('、');
}

const phaseText = (rec, e) => `${nameOf(rec, e.actor_id)} 進入第二階段：攻擊 +${e.after.atk_bonus}，解鎖 ${e.after.skills_added.map(skillName).join('、')}`;

/** 簡易戰報：每個角色每次行動一行 */
export function simpleLog(rec, discoveries = {}) {
  const lines = [];
  for (const t of rec.turns) {
    let cur = null;
    const flush = () => { if (cur) lines.push(cur); cur = null; };
    for (const e of t.events) {
      if (e.event_type === 'action_declared') {
        flush();
        cur = { turn: t.turn_number, event_id: e.event_id, actor: nameOf(rec, e.actor_id), team: rec.combatants.find((c) => c.actor_id === e.actor_id).team, skill: skillName(e.skill_id), parts: [] };
      } else if (e.event_type === 'action_invalid') {
        lines.push({ turn: t.turn_number, event_id: e.event_id, actor: nameOf(rec, e.actor_id), skill: '指令無效', parts: [`（${e.reason_code}，改用戰術）`] });
      } else if (e.event_type === 'phase_changed') {
        (cur || lines.at(-1))?.parts.push(phaseText(rec, e));
      } else if (cur && e.event_type === 'hit_check' && !e.calculation.success) {
        cur.parts.push(`${nameOf(rec, e.target_ids[0])} 閃避`);
      } else if (e.event_type === 'damage_applied') {
        const c = e.calculation;
        if (e.flags?.dot) { flush(); lines.push({ turn: t.turn_number, event_id: e.event_id, actor: nameOf(rec, e.target_ids[0]), skill: skillName(e.skill_id), parts: [`−${c.hp_damage}`] }); continue; }
        if (!cur) continue;
        let p = `${e.flags?.chain ? `↳ ${nameOf(rec, e.actor_id)} 連攜追擊 ` : ''}${nameOf(rec, e.target_ids[0])} −${c.hp_damage}`;
        if (c.shield_absorbed) p += `（護盾吸收 ${c.shield_absorbed}）`;
        if (c.critical) p += ' 暴擊';
        if (e.flags?.intercepted_from) p += `（替 ${nameOf(rec, e.flags.intercepted_from)} 擋下）`;
        const h = hiddenText(e, discoveries);
        if (h) p += `〔${h}〕`;
        cur.parts.push(p);
      } else if (cur && e.event_type === 'heal_applied') {
        cur.parts.push(`${nameOf(rec, e.target_ids[0])} +${e.calculation.effective}`);
      } else if (cur && e.event_type === 'shield_applied') {
        cur.parts.push(`${nameOf(rec, e.target_ids[0])} 護盾 +${e.calculation.amount}`);
      } else if (cur && e.event_type === 'status_removed') {
        cur.parts.push(`${nameOf(rec, e.target_ids[0])} 的${STATUSES[e.after.status_id].name}被淨化`);
      } else if (cur && e.event_type === 'status_applied' && e.after.status_id !== 'guarding') {
        cur.parts.push(`${nameOf(rec, e.target_ids[0])} ${STATUSES[e.after.status_id].name}`);
      } else if (e.event_type === 'actor_defeated') {
        (cur || lines.at(-1))?.parts.push(`${nameOf(rec, e.actor_id)} 倒下`);
      } else if (e.event_type === 'battle_ended') {
        flush();
      }
    }
    flush();
  }
  return lines.map((l) => ({ ...l, text: `${l.actor}：${l.skill}${l.parts.length ? ' → ' + l.parts.join('，') : ''}` }));
}

const TYPE_ZH = { turn_start: '回合開始', turn_end: '回合結束', action_declared: '宣告行動', action_invalid: '指令無效', cooldown_changed: '進入冷卻',
  hit_check: '命中判定', critical_check: '暴擊判定', damage_applied: '傷害', heal_applied: '治療', shield_applied: '護盾', status_applied: '狀態附加',
  status_expired: '狀態結束', status_removed: '淨化', actor_defeated: '倒下', battle_ended: '戰鬥結束', synergy_trigger_check: '羈絆判定', phase_changed: '階段轉換' };

/** 詳細戰報：每個事件一行，含判定與計算 */
export function detailedLog(rec, discoveries = {}) {
  return allEvents(rec).filter((e) => e.event_type !== 'turn_start' && e.event_type !== 'turn_end').map((e) => {
    const c = e.calculation || {};
    let d = '';
    const tgt = e.target_ids.map((id) => nameOf(rec, id)).join('、');
    switch (e.event_type) {
      case 'action_declared': d = `${nameOf(rec, e.actor_id)} 使用 ${skillName(e.skill_id)}${tgt ? ' → ' + tgt : ''}（${e.flags?.source === 'player' ? '玩家指令' : '戰術'}）`; break;
      case 'action_invalid': d = `${nameOf(rec, e.actor_id)} 的指令被拒絕：${e.reason_code}`; break;
      case 'cooldown_changed': d = `${skillName(e.skill_id)} 冷卻 ${e.after.cooldown} 回合`; break;
      case 'hit_check': d = `命中率 ${c.chance}% 擲 ${c.roll} → ${c.success ? '命中' : '未命中'}`; break;
      case 'critical_check': d = `暴擊率 ${c.chance}% 擲 ${c.roll} → ${c.success ? '暴擊' : '否'}`; break;
      case 'damage_applied': {
        if (c.dot) d = `${skillName(e.skill_id)} ${c.power}×${c.stacks} 層${c.resist_ids ? `，${c.resist_ids.map((r) => AFFIXES[r]?.name ?? r).join('・')}減免 ${c.resisted}` : ''} = ${c.raw_damage}`;
        else {
          const h = hiddenText(e, discoveries);
          d = `攻擊 ${c.attack}×${c.multiplier}%${c.critical ? '×150%' : ''} = ${c.base}，防禦 ${c.defense}${h ? `（含${h}）` : ''} → ${c.raw_damage}`;
        }
        d += `；護盾 ${c.shield_absorbed}，HP ${e.before.hp}→${e.after.hp}${c.overkill ? `，超殺 ${c.overkill}` : ''}`;
        break;
      }
      case 'heal_applied': d = `${tgt} 治療 ${c.amount}，有效 ${c.effective}，溢補 ${c.overheal}；HP ${e.before.hp}→${e.after.hp}`; break;
      case 'shield_applied': d = `${tgt} 護盾 ${e.before.shield}→${e.after.shield}`; break;
      case 'status_applied': d = `${tgt} ${STATUSES[e.after.status_id].name}（${e.after.stacks} 層，${e.after.remaining_turns} 回合）`; break;
      case 'status_removed': d = `${tgt} 的 ${STATUSES[e.after.status_id].name}（${e.before.stacks} 層，剩 ${e.before.remaining_turns} 回合）被淨化（來源 ${e.source_event_id.split(':').pop()}）`; break;
      case 'status_expired': d = `${tgt} 的 ${STATUSES[e.after.status_id].name} 結束`; break;
      case 'actor_defeated': d = `${nameOf(rec, e.actor_id)} 倒下（來源 ${e.source_event_id.split(':').pop()}）`; break;
      case 'synergy_trigger_check': d = `${nameOf(rec, e.actor_id)}×${nameOf(rec, e.flags.partner_id)} 連攜 Lv${c.level}：機率 ${c.chance}% 擲 ${c.roll} → ${c.success ? '發動' : '未發動'}`; break;
      case 'phase_changed': d = `${phaseText(rec, e)}（HP ${c.hp}/${c.hp_max} ≤ ${c.threshold_pct}%，來源 ${e.source_event_id.split(':').pop()}）`; break;
      case 'battle_ended': d = `戰鬥結束：${e.reason_code}`; break;
      default: d = e.event_type;
    }
    return { event_id: e.event_id, turn: e.turn_number, type: TYPE_ZH[e.event_type] || e.event_type, raw_type: e.event_type, actor_id: e.actor_id, skill_id: e.skill_id, text: d };
  });
}

const eventStatus = (e) => (['status_applied', 'status_expired', 'status_removed'].includes(e.event_type) ? e.after?.status_id : (e.event_type === 'damage_applied' && e.calculation?.dot ? e.skill_id : null));

/** 詳細戰報篩選：條件 AND，空值＝不限。actor 比對行動者或目標 */
export function filterDetailedLog(lines, rec, { actor = '', skill = '', type = '', status = '', turn = '' } = {}) {
  const byId = Object.fromEntries(allEvents(rec).map((e) => [e.event_id, e]));
  return lines.filter((l) => {
    const e = byId[l.event_id];
    if (actor && l.actor_id !== actor && !e.target_ids.includes(actor)) return false;
    if (skill && l.skill_id !== skill) return false;
    if (type && l.raw_type !== type) return false;
    if (turn !== '' && turn != null && l.turn !== Number(turn)) return false;
    if (status && eventStatus(e) !== status) return false;
    return true;
  });
}

/** 篩選選項：只列本場紀錄實際出現的值 */
export function filterOptions(lines, rec) {
  const byId = Object.fromEntries(allEvents(rec).map((e) => [e.event_id, e]));
  const skills = new Set(), types = new Set(), statuses = new Set(), turns = new Set();
  for (const l of lines) {
    if (l.skill_id) skills.add(l.skill_id);
    types.add(l.raw_type); turns.add(l.turn);
    const st = eventStatus(byId[l.event_id]); if (st) statuses.add(st);
  }
  return {
    skills: [...skills].map((id) => ({ id, name: skillName(id) })),
    types: [...types].map((id) => ({ id, name: TYPE_ZH[id] || id })),
    statuses: [...statuses].map((id) => ({ id, name: STATUSES[id]?.name ?? id })),
    turns: [...turns].sort((a, b) => a - b).map((n) => ({ id: String(n), name: `第 ${n} 回合` })),
  };
}
