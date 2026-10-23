# 事件與資料契約

## 原則
先產生唯一的戰鬥事實紀錄 `BattleRecord`，再用純函式衍生四個視圖。`BattleEvent` append-only；不可由 AI 編輯。記錄 `rules_version`、`rng_seed`、隊伍配置與裝備快照，用於重播及版本遷移。用穩定 actor/skill/status ID 而非顯示名稱作關聯。

## 最低資料結構
```text
BattleRecord:
  battle_id, rules_version, rng_seed, encounter_id, started_at_game_tick
  combatants: [{actor_id, team, level, stats, hp_max, hp_start, shield_start,
                skills, equipment_ids, pair_relation_refs}]
  turns: [{turn_number, start_snapshot, events[], end_snapshot}]
  result: {outcome, end_reason, winner_team, rewards, ended_turn}

BattleEvent:
  event_id, battle_id, turn_number, sequence, event_type
  actor_id?, target_ids[], skill_id?, source_event_id?
  before?, after?, calculation?, flags?, reason_code?, visibility?

Snapshot:
  actors: {actor_id: {hp, shield, resource, alive, cooldowns,
                     statuses: [{status_id, stacks, remaining_turns, source_id}]}}
```

## 必備事件類型
`turn_start`, `turn_end`, `action_declared`, `action_invalid`, `cost_paid`, `cooldown_changed`, `skill_trigger_check`, `hit_check`, `critical_check`, `damage_applied`, `heal_applied`, `shield_applied`, `status_applied`, `status_resisted`, `status_tick`, `status_expired`, `actor_defeated`, `battle_ended`, `reward_granted`, `synergy_trigger_check`。

### 傷害 breakdown（示例）
```json
{
  "event_id":"evt-0007", "turn_number":2, "sequence":7,
  "event_type":"damage_applied", "actor_id":"ally_a",
  "target_ids":["enemy_1"], "skill_id":"piercing_arrow",
  "before":{"hp":90,"shield":5},
  "calculation":{"base":30,"attack_multiplier":1.2,"critical":false,
    "defense_reduction":8,"element_modifier":1.0,"hidden_modifier_ids":[],
    "raw_damage":28,"shield_absorbed":5,"hp_damage":23,"overkill":0},
  "after":{"hp":67,"shield":0},"reason_code":"skill_hit"
}
```
這是示範模式，不是固定公式。要另行定義四捨五入時機、整數溢位、同時傷害、反擊時序、狀態回合結束計數。正式版一律用整數或具明確規則的定點數，避免浮點漂移。

## 統計定義
- **有效傷害**：真正減少 HP 的量；另記護盾吸收與 overkill，避免超殺灌水。
- **承傷**：角色 HP 真正被減少的量；護盾承受單獨統計。
- **有效治療**：`min(治療量, hp_max-hp_before)`；溢補另列。
- **擊殺**：由 `actor_defeated` 關聯導致致死的事件；DOT 擊殺需追蹤來源。
- **發動率**：分母是符合觸發資格的機會，不是所有回合；試圖施放、技能觸發成功、實際命中要分開。
- **狀態時間**：清楚定義施加當回合是否倒數、重疊時刷新／疊層、抵抗與免疫如何計算。
- **戰報一致性**：統計為事件聚合，回合快照必須可由起始快照＋事件重算得出。

## 結構化視圖
- 結算：勝負、回合、團隊及個人貢獻、掉落與經驗、重要事件列表。
- 詳情：準備階段與逐回合列表；每項行動可展開完整 calculation／判定記錄；可依 actor_id、skill_id、event_type、status_id 篩選。
- 統計：同一戰鬥資料產生 HP 曲線、技能效率、狀態來源、傷害構成；允許點選數值跳回事件。
- 短演出：每段引用一組有效 event_id；不改寫這些事件。
