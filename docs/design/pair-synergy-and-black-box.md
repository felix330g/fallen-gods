# 配將、雙人羈絆與黑盒子

## 已確定
- 任意兩人可以累積通用合作熟練度；有少數作者設計的專屬羈絆。
- 不存在全隊默契數值或新人加入削弱老搭檔的規則。
- 人物好感與戰鬥默契不是同一數字：互相討厭也可能作戰熟練；相親相愛也可能戰術不合。
- 第三人旁觀兩人配合可觸發短演出，但旁觀不自動產生三人加成。

## 建議資料結構
```text
PairRelation: pair_id=sort(actor_a,actor_b), familiarity_xp, cooperation_level,
  trust?, respect?, rivalry?, relationship_flags[], bond_ids[], memory_refs[]
BondRule: bond_id, pair_id/eligible_pair_type, trigger_expression,
  modifiers[], limits, precedence, discovery_rule, display_policy
Modifier: source_id, stat, operation(add/multiply/override), amount,
  stack_group, cap, apply_phase
Discovery: undiscovered → suspected → confirmed
```
**未定案**：各數值範圍、升級斜率、情緒維度、具體加成。只能當示例，不擅自定死。

## 配將平衡
- 多數效果設計成情境優勢或不同技能鏈，而非無條件巨量攻擊加成。
- 有戰術取捨與各種敵人剋制，不要求所有組合同強，但避免單一固定隊伍在所有地城稱霸。
- 學到新羈絆不該因數值懲罰而阻止人物自然成長。
- 防止低階刷怪快速灌滿默契，可用有效合作行為＋收益遞減（具體規則待確認）。

## 可驗證的黑盒子
範例：艾琳與小梅建立特定信任後，小梅 HP <30% 時，艾琳掩護射擊發動率從 30% 變 45%。這些都是**假設數字**，不可當正式平衡參數。
- 規則事先存在，透過固定 seed 與 modifier source ID 在引擎判定，AI 不得產生或更動。
- 詳細戰報展示觸發機會、是否成功、實際結算；未發現條件時可以顯示「未知來源修正」而非偽稱只有 30%。
- 統計比較必須使用**符合觸發資格的機會**作分母，不能只比戰鬥次數。
- 研究工具提供同樣對手、相同裝備、不同角色組合的對照測試；記錄假說與已確認效果。一次偶然觸發不能宣稱已證實。
- 當 discovery=confirmed，玩家可查看真實條件、計算方式與限制。
