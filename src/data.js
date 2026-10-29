// 遊戲資料。所有角色與數值皆為「垂直切片測試用」，非正式設定。
export const RULES_VERSION = '0.8.0';

export const SKILLS = {
  arrow_shot: { id: 'arrow_shot', name: '射擊', kind: 'attack', target: 'enemy', mult: 100, cd: 0, desc: '基本攻擊（100% 攻擊）' },
  piercing_arrow: { id: 'piercing_arrow', name: '穿刺箭', kind: 'attack', target: 'enemy', mult: 160, cd: 2, pierce: true, desc: '160% 攻擊，無視一半防禦，冷卻 2' },
  shield_bash: { id: 'shield_bash', name: '盾擊', kind: 'attack', target: 'enemy', mult: 100, cd: 0, desc: '基本攻擊（100% 攻擊）' },
  guard: { id: 'guard', name: '守護', kind: 'guard', target: 'ally', cd: 2, desc: '替一名隊友承受攻擊，持續到下回合結束，冷卻 2' },
  war_cry: { id: 'war_cry', name: '鼓舞', kind: 'shield', target: 'all_allies', power: 8, cd: 4, desc: '全隊獲得 8 點護盾，冷卻 4' },
  spark: { id: 'spark', name: '火花', kind: 'attack', target: 'enemy', mult: 100, cd: 0, desc: '基本攻擊（100% 攻擊）' },
  mend: { id: 'mend', name: '治癒', kind: 'heal', target: 'ally', power: 16, mult: 60, cd: 2, cleanse: 1, desc: '恢復 16＋60% 攻擊的生命，並淨化 1 個負面狀態（灼燒／流血／虛弱），冷卻 2' },
  ember_burst: { id: 'ember_burst', name: '燼爆', kind: 'attack', target: 'all_enemies', mult: 70, cd: 3, applies: { status_id: 'burn', turns: 2, power: 3 }, desc: '對全體敵人 70% 攻擊並灼燒 2 回合，冷卻 3' },
  slash: { id: 'slash', name: '斬擊', kind: 'attack', target: 'enemy', mult: 100, cd: 0, desc: '基本攻擊（100% 攻擊）' },
  rending_cut: { id: 'rending_cut', name: '裂傷斬', kind: 'attack', target: 'enemy', mult: 90, cd: 2, applies: { status_id: 'bleed', turns: 3, power: 4 }, desc: '90% 攻擊並流血 3 回合（可疊 3 層），冷卻 2' },
  cleave: { id: 'cleave', name: '橫掃', kind: 'attack', target: 'all_enemies', mult: 75, cd: 3, desc: '對全體敵人 75% 攻擊，冷卻 3' },
  // 可招募夥伴與可學技能（v0.7，測試用）
  quick_stab: { id: 'quick_stab', name: '快刺', kind: 'attack', target: 'enemy', mult: 100, cd: 0, desc: '基本攻擊（100% 攻擊）' },
  axe_chop: { id: 'axe_chop', name: '劈砍', kind: 'attack', target: 'enemy', mult: 100, cd: 0, desc: '基本攻擊（100% 攻擊）' },
  herb_dart: { id: 'herb_dart', name: '藥鏢', kind: 'attack', target: 'enemy', mult: 100, cd: 0, desc: '基本攻擊（100% 攻擊）' },
  herbal_ward: { id: 'herbal_ward', name: '草藥膜', kind: 'shield', target: 'all_allies', power: 10, cd: 4, desc: '全隊獲得 10 點護盾，冷卻 4' },
  ember_edge: { id: 'ember_edge', name: '燼刃', kind: 'attack', target: 'enemy', mult: 130, cd: 2, applies: { status_id: 'burn', turns: 2, power: 4 }, desc: '130% 攻擊並灼燒 2 回合，冷卻 2' },
  volley: { id: 'volley', name: '齊射', kind: 'attack', target: 'all_enemies', mult: 65, cd: 3, desc: '對全體敵人 65% 攻擊，冷卻 3' },
  crushing_blow: { id: 'crushing_blow', name: '碎擊', kind: 'attack', target: 'enemy', mult: 110, cd: 3, applies: { status_id: 'weaken', turns: 2 }, desc: '110% 攻擊並使目標虛弱 2 回合，冷卻 3' },
  flame_lance: { id: 'flame_lance', name: '炎槍', kind: 'attack', target: 'enemy', mult: 150, cd: 3, desc: '150% 攻擊，冷卻 3' },
  aimed_shot: { id: 'aimed_shot', name: '瞄準射擊', kind: 'attack', target: 'enemy', mult: 140, cd: 3, desc: '140% 攻擊，冷卻 3' },
  rally: { id: 'rally', name: '集結', kind: 'shield', target: 'all_allies', power: 6, cd: 3, desc: '全隊獲得 6 點護盾，冷卻 3' },
  minor_heal: { id: 'minor_heal', name: '小治療', kind: 'heal', target: 'ally', power: 10, mult: 40, cd: 2, desc: '恢復 10＋40% 攻擊的生命，冷卻 2' },
  whirl: { id: 'whirl', name: '迴旋斬', kind: 'attack', target: 'all_enemies', mult: 70, cd: 3, desc: '對全體敵人 70% 攻擊，冷卻 3' },
  blood_rush: { id: 'blood_rush', name: '血衝', kind: 'attack', target: 'enemy', mult: 130, cd: 3, applies: { status_id: 'bleed', turns: 2, power: 4 }, desc: '130% 攻擊並流血 2 回合，冷卻 3' },
  // 敵人技能
  claw: { id: 'claw', name: '撕抓', kind: 'attack', target: 'enemy', mult: 100, cd: 0 },
  club_strike: { id: 'club_strike', name: '棍擊', kind: 'attack', target: 'enemy', mult: 100, cd: 0 },
  acid_spit: { id: 'acid_spit', name: '酸液', kind: 'attack', target: 'enemy', mult: 80, cd: 2, applies: { status_id: 'weaken', turns: 2 } },
  ash_curse: { id: 'ash_curse', name: '灰燼詛咒', kind: 'attack', target: 'enemy', mult: 90, cd: 2, applies: { status_id: 'burn', turns: 3, power: 4 } },
  heavy_slash: { id: 'heavy_slash', name: '重斬', kind: 'attack', target: 'enemy', mult: 150, cd: 2 },
  ash_wave: { id: 'ash_wave', name: '灰燼波', kind: 'attack', target: 'all_enemies', mult: 70, cd: 3 },
  ember_rage: { id: 'ember_rage', name: '餘燼狂怒', kind: 'attack', target: 'all_enemies', mult: 80, cd: 3, applies: { status_id: 'burn', turns: 2, power: 3 } },
  ember_bite: { id: 'ember_bite', name: '燼牙', kind: 'attack', target: 'enemy', mult: 90, cd: 2, applies: { status_id: 'burn', turns: 2, power: 3 } },
};

export const STATUSES = {
  burn: { id: 'burn', name: '灼燒', dot: true, negative: true, maxStacks: 1 },
  bleed: { id: 'bleed', name: '流血', dot: true, negative: true, maxStacks: 3 },
  weaken: { id: 'weaken', name: '虛弱', atkPct: 70, negative: true, maxStacks: 1 },
  guarding: { id: 'guarding', name: '守護中', maxStacks: 1 },
  protected: { id: 'protected', name: '受守護', maxStacks: 1 },
};

export const CHARACTERS = {
  airin: { id: 'airin', cls: 'archer', name: '艾琳', role: '弓手', stats: { hp: 70, atk: 14, def: 3, spd: 12, crit: 15 }, skills: ['arrow_shot', 'piercing_arrow'],
    bio: '沉默的獵人，據說曾在一座已毀的城市擔任斥候。' },
  ade: { id: 'ade', cls: 'guardian', name: '阿德', role: '盾衛', stats: { hp: 104, atk: 9, def: 7, spd: 7, crit: 5 }, skills: ['shield_bash', 'guard', 'war_cry'],
    bio: '前神殿守衛。嘴上嫌麻煩，盾牌總比人先動。' },
  xiaomei: { id: 'xiaomei', cls: 'caster', name: '小梅', role: '見習術士', stats: { hp: 56, atk: 11, def: 2, spd: 10, crit: 10 }, skills: ['spark', 'mend', 'ember_burst'],
    bio: '剛從學院出來的術士，第一次下地城。' },
  rook: { id: 'rook', cls: 'blade', name: '洛克', role: '傭兵劍士', stats: { hp: 86, atk: 12, def: 5, spd: 9, crit: 10 }, skills: ['slash', 'rending_cut', 'cleave'],
    bio: '只認金幣的傭兵。對「神」這個字特別反感。' },
  // 可招募夥伴（v0.7 抽卡，測試用；正式角色由 P10 決定）
  talli: { id: 'talli', cls: 'archer', name: '塔莉', role: '斥候', rarity: 'R', recruit: true, stats: { hp: 64, atk: 13, def: 2, spd: 14, crit: 15 }, skills: ['quick_stab', 'rending_cut'],
    bio: '在地窖入口賣地圖的少女，自稱走過每一條岔路。' },
  garn: { id: 'garn', cls: 'guardian', name: '葛恩', role: '重斧手', rarity: 'R', recruit: true, stats: { hp: 112, atk: 12, def: 6, spd: 5, crit: 5 }, skills: ['axe_chop', 'cleave'],
    bio: '沉默的樵夫，說是來地窖找一棵不會燒起來的樹。' },
  sera: { id: 'sera', cls: 'caster', name: '瑟拉', role: '藥師', rarity: 'SR', recruit: true, stats: { hp: 62, atk: 10, def: 3, spd: 9, crit: 5 }, skills: ['herb_dart', 'mend', 'herbal_ward'],
    bio: '揹著藥箱的旅行藥師，對傷口比對人有興趣。' },
  karo: { id: 'karo', cls: 'blade', name: '卡蘿', role: '燼刃劍士', rarity: 'SSR', recruit: true, stats: { hp: 92, atk: 16, def: 5, spd: 11, crit: 15 }, skills: ['slash', 'ember_edge', 'cleave'],
    bio: '劍上永遠帶著餘燼的流浪劍士，從不說自己從哪裡來。' },
};
export const STARTERS = ['airin', 'ade', 'xiaomei', 'rook'];

// 抽卡（v0.7，數值皆為測試用）：只有上陣角色的可學技能會進技能池
// 職業（v0.8，測試用）：每個職業有通用技能，同職業的角色都能學
export const CLASSES = { archer: '射手', guardian: '守衛', caster: '術士', blade: '劍士' };
export const CLASS_SKILLS = { archer: ['volley', 'aimed_shot'], guardian: ['crushing_blow', 'rally'], caster: ['flame_lance', 'minor_heal'], blade: ['blood_rush', 'whirl'] };
export const LEARNABLE = Object.fromEntries(Object.values(CHARACTERS).map((c) => [c.id, CLASS_SKILLS[c.cls]]));
// 技能裝備：基本攻擊之外，每人最多帶 2 個技能上陣
export const SKILL_SLOTS = 2;
export const GACHA = {
  cost: { recruit: 5, skill: 3 },
  rates: [['SSR', 5], ['SR', 25], ['R', 70]],
  duplicateRefund: 2,
};
export const GEMS = { battleChance: 8, bossFirst: 5, bossRepeat: 2 };

export const ENEMIES = {
  bone_rat: { id: 'bone_rat', name: '骨鼠', stats: { hp: 28, atk: 10, def: 0, spd: 13, crit: 5 }, skills: ['claw'] },
  goblin: { id: 'goblin', name: '哥布林', stats: { hp: 48, atk: 13, def: 2, spd: 8, crit: 5 }, skills: ['club_strike'] },
  slime: { id: 'slime', name: '腐蝕史萊姆', stats: { hp: 70, atk: 12, def: 1, spd: 5, crit: 0 }, skills: ['acid_spit', 'claw'] },
  ash_acolyte: { id: 'ash_acolyte', name: '灰燼侍祭', stats: { hp: 60, atk: 14, def: 3, spd: 9, crit: 5 }, skills: ['ash_curse', 'claw'] },
  ember_hound: { id: 'ember_hound', name: '餘燼犬', stats: { hp: 44, atk: 13, def: 1, spd: 14, crit: 10 }, skills: ['ember_bite', 'claw'] },
  hollow_knight: { id: 'hollow_knight', name: '失格者・殘響騎士', boss: true, rival: true, stats: { hp: 250, atk: 18, def: 6, spd: 8, crit: 10 }, skills: ['heavy_slash', 'ash_wave', 'club_strike'],
    phase2: { at_pct: 50, atk_bonus: 3, skills: ['ember_rage', 'heavy_slash', 'club_strike'] } },
};

// 雙人羈絆規則。public=玩家一開始就知道；hidden=黑盒子，需研究
export const BONDS = {
  chain_followup: { id: 'chain_followup', name: '連攜追擊', visibility: 'public',
    desc: '任意兩人合作熟練度達 Lv1 後，一人攻擊命中時，另一人有 (10%＋5%×等級) 機率追擊 50% 攻擊。' },
  guardian_trust: { id: 'guardian_trust', name: '守護者的信任', visibility: 'hidden', pair: 'ade|xiaomei', defBonus: 3,
    desc: '阿德守護小梅時，若兩人熟練度 ≥ Lv1，阿德承受該次攻擊的防禦 +3。（測試用隱藏羈絆）' },
};

export const ITEMS = {
  rusty_blade: { id: 'rusty_blade', name: '生鏽短劍', slot: 'weapon', rarity: '普通', mods: { atk: 2 } },
  hunter_bow: { id: 'hunter_bow', name: '獵人長弓', slot: 'weapon', rarity: '精良', mods: { atk: 3, spd: 1 } },
  ember_staff: { id: 'ember_staff', name: '餘燼法杖', slot: 'weapon', rarity: '精良', mods: { atk: 3, crit: 5 } },
  knight_shard: { id: 'knight_shard', name: '殘響之刃碎片', slot: 'weapon', rarity: '稀有', mods: { atk: 5, crit: 5 } },
  hound_fang: { id: 'hound_fang', name: '燼犬牙刃', slot: 'weapon', rarity: '稀有', mods: { atk: 4, spd: 2 } },
  leather_vest: { id: 'leather_vest', name: '皮背心', slot: 'armor', rarity: '普通', mods: { def: 1, hp: 6 } },
  temple_mail: { id: 'temple_mail', name: '神殿鏈甲', slot: 'armor', rarity: '精良', mods: { def: 2, hp: 10 } },
  ash_cloak: { id: 'ash_cloak', name: '灰燼斗篷', slot: 'armor', rarity: '稀有', mods: { def: 2, spd: 2, hp: 8 } },
  ember_mail: { id: 'ember_mail', name: '回燼胸甲', slot: 'armor', rarity: '稀有', mods: { def: 3, hp: 14 } },
};

// ── 詞綴與稀有度（P07）──────────────────────────────
// 物品 ID 格式：base 或 base~affix1~affix2（字串，存檔相容；舊存檔的物品就是沒有詞綴的 base）
export const RARITIES = ['普通', '精良', '稀有', '史詩'];
export const AFFIXES = {
  keen: { id: 'keen', name: '鋒利', slots: ['weapon'], mods: { atk: 1 } },
  precise: { id: 'precise', name: '精準', slots: ['weapon'], mods: { crit: 4 } },
  swift: { id: 'swift', name: '迅捷', slots: ['weapon', 'armor'], mods: { spd: 1 } },
  sturdy: { id: 'sturdy', name: '堅固', slots: ['armor'], mods: { def: 1 } },
  vital: { id: 'vital', name: '強韌', slots: ['armor'], mods: { hp: 8 } },
  // 抵抗類詞綴：沒有屬性加成，效果由引擎處理（見 RESISTS）
  fireproof: { id: 'fireproof', name: '耐火', slots: ['armor'], mods: {} },
};
// 抵抗詞綴 → 抵抗的持續傷害狀態。受到該狀態的 status_tick 傷害時減半（無條件捨去，最少 1）
export const RESISTS = { fireproof: 'burn' };
// 掉落詞綴機率（百分比），依樓層；餘燼回流時另外加成
export const AFFIX_TABLE = { first: [20, 35, 50], second: [0, 10, 20], emberBonus: { first: 15, second: 10 } };
export const SALVAGE_GOLD = { 普通: 5, 精良: 10, 稀有: 20, 史詩: 35 };

/** 解析物品 ID → 完整定義（名稱、稀有度、合計屬性）。未知 ID 回傳 null。 */
export function itemDef(id) {
  if (typeof id !== 'string') return null;
  const [baseId, ...affixIds] = id.split('~');
  const base = ITEMS[baseId];
  if (!base || affixIds.length > 2 || new Set(affixIds).size !== affixIds.length) return null;
  const affixes = affixIds.map((a) => AFFIXES[a]);
  if (affixes.some((a) => !a || !a.slots.includes(base.slot))) return null;
  const mods = { ...base.mods };
  for (const a of affixes) for (const [k, v] of Object.entries(a.mods)) mods[k] = (mods[k] || 0) + v;
  const rarity = RARITIES[Math.min(RARITIES.length - 1, RARITIES.indexOf(base.rarity) + affixes.length)];
  const name = affixes.length ? `${affixes.map((a) => a.name).join('・')}的${base.name}` : base.name;
  return { id, base: baseId, slot: base.slot, name, rarity, mods, affixes: affixIds };
}

const STAT_LABEL = { hp: '生命', atk: '攻', def: '防', spd: '速', crit: '暴' };
/** 換裝屬性差文字：newId 相對 oldId（可為空＝該部位沒裝備）。無差異回傳「相同」。 */
export function statDiffText(newId, oldId) {
  const a = itemDef(newId)?.mods ?? {}, b = itemDef(oldId)?.mods ?? {};
  const parts = Object.keys(STAT_LABEL).map((k) => [k, (a[k] || 0) - (b[k] || 0)]).filter(([, d]) => d !== 0)
    .map(([k, d]) => `${STAT_LABEL[k]} ${d > 0 ? '+' : '−'}${Math.abs(d)}`);
  return parts.length ? parts.join('、') : '相同';
}
/** 背包顯示順序（原始索引陣列）。只影響顯示，不改 inventory。mode: default／rarity（高→低）／slot（武器→防具）。 */
export function inventoryOrder(inventory, mode) {
  const idx = inventory.map((_, i) => i);
  const key = { rarity: (i) => -RARITIES.indexOf(itemDef(inventory[i]).rarity), slot: (i) => ['weapon', 'armor'].indexOf(itemDef(inventory[i]).slot) }[mode];
  return key ? idx.sort((x, y) => key(x) - key(y) || x - y) : idx;
}

// 地城：每層 3 步，每步兩個選擇；第 3 層最後一步固定是 Boss
// after_boss：擊敗殘響騎士後，世界改變 → 地窖進入「餘燼回流」，遭遇與掉落改變（P06 地城隨世界事件變化）
export const DUNGEON = {
  id: 'ash_cellar', name: '灰燼地窖',
  intro: '眾神殞落後第十二年。城外的神殿地窖開始冒出灰燼，進去的人很少回來。',
  floors: [
    { name: '第一層・崩塌的儲藏室', encounters: [['bone_rat', 'bone_rat'], ['goblin'], ['goblin', 'bone_rat']], loot: ['rusty_blade', 'leather_vest'],
      after_boss: { encounters: [['ember_hound'], ['ember_hound', 'bone_rat'], ['goblin', 'bone_rat']], loot: ['leather_vest', 'hunter_bow'] } },
    { name: '第二層・積水的禮拜堂', encounters: [['slime', 'goblin'], ['ash_acolyte', 'bone_rat'], ['goblin', 'goblin', 'bone_rat']], loot: ['hunter_bow', 'ember_staff', 'temple_mail'],
      after_boss: { encounters: [['ember_hound', 'slime'], ['ash_acolyte', 'ember_hound'], ['goblin', 'goblin', 'bone_rat']], loot: ['ember_staff', 'temple_mail', 'hound_fang'] } },
    { name: '第三層・熄滅的祭壇', encounters: [['ash_acolyte', 'slime'], ['ash_acolyte', 'goblin', 'bone_rat']], loot: ['ash_cloak', 'temple_mail'], boss: ['hollow_knight', 'bone_rat'],
      after_boss: { encounters: [['ash_acolyte', 'ember_hound'], ['ember_hound', 'ember_hound', 'bone_rat']], loot: ['ash_cloak', 'ember_mail'], boss: ['hollow_knight', 'ember_hound'] } },
  ],
  bossLoot: ['knight_shard'],
  // 餘燼回流時敵人強化（百分比）
  emberScale: { hp: 130, atk: 120 },
  states: {
    normal: { name: '灰燼瀰漫', desc: '地窖深處有東西在燃燒。巡守說，最深處的祭壇前站著一名不肯倒下的騎士。' },
    ember_return: { name: '餘燼回流', desc: '殘響騎士倒下後，祭壇的灰燼沒有熄滅，反而沿著水道倒流回上層。餘燼犬開始在各層出沒，而騎士的殘響……又站了起來。' },
  },
};

// 預設奇遇：結果全部由資料決定，AI 不得杜撰
export const ENCOUNTER_EVENTS = {
  altar: { id: 'altar', title: '殘破的小祭壇', text: '牆角有座被砸碎一半的祭壇，上面的神像沒有臉。灰燼在供盤裡緩緩旋轉。',
    choices: [
      { id: 'offer', label: '以血供奉（全隊 −8 生命，獲得 40 金幣）', effect: { hpAll: -8, gold: 40 } },
      { id: 'leave', label: '不去碰它', effect: {} },
    ] },
  wounded: { id: 'wounded', title: '受傷的冒險者', text: '一名冒險者靠牆坐著，腿上的傷口泛著灰。他說他的隊伍在下面全滅了。',
    choices: [
      { id: 'give', label: '給他一瓶藥水（藥水 −1，獲得情報：Boss 會使用灰燼波）', effect: { potions: -1, flag: 'intel_boss' }, require: { potions: 1 } },
      { id: 'ask', label: '只問路（獲得 15 金幣的地圖）', effect: { gold: 15 } },
    ] },
  chest: { id: 'chest', title: '上鎖的鐵箱', text: '一只沉重的鐵箱，鎖頭鏽死了。',
    choices: [
      { id: 'force', label: '硬撬（需阿德或洛克在隊；獲得裝備）', effect: { loot: 1 }, require: { anyOf: ['ade', 'rook'] } },
      { id: 'kick', label: '用力踹（全隊 −4 生命，50% 機率打開）', effect: { hpAll: -4, lootChance: 50 } },
    ] },
  spring: { id: 'spring', title: '清澈的泉水', text: '在灰燼之中，竟有一汪沒被污染的泉水。',
    choices: [
      { id: 'drink', label: '休息飲水（全隊恢復 25% 生命）', effect: { healPct: 25 } },
      { id: 'fill', label: '裝瓶帶走（藥水 +1）', effect: { potions: 1 } },
    ] },
  ember_vent: { id: 'ember_vent', title: '倒流的灰燼', text: '牆縫裡的灰燼像水一樣往上流。靠近時，可以聽見很遠的地方有人在念禱詞。', dungeonState: 'ember_return',
    choices: [
      { id: 'listen', label: '貼近聆聽（全隊 −6 生命，獲得情報：騎士第二階段會用餘燼狂怒）', effect: { hpAll: -6, flag: 'intel_phase2' } },
      { id: 'seal', label: '用碎石堵住（獲得 20 金幣的殘渣）', effect: { gold: 20 } },
    ] },
};

export const PARTY_SIZE = 3;
export const MAX_ROUNDS = 20;
export const POTION_HEAL = 30;
export const POTION_PRICE = 20;
