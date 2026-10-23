# 設計依據（docs/design）

這個資料夾是 Claude 專案「ai 文字遊戲」裡設計文件的副本（2026-10-22 首次同步），給排程任務當作實作依據。

- **規劃排程**（每天 08:13）讀 Claude 專案的最新設計，必要時在任務單裡要求更新這個資料夾。
- **實作排程**（每天 08:43）只依這裡的內容與任務單實作，不自行更改設計。

## 狀態標記

| 標記 | 意思 | 實作排程可以做什麼 |
|---|---|---|
| 已定案 | 使用者明確決定 | 照做，不可違反 |
| 暫定 | 使用者偏好但未鎖定 | 可以照做，保留調整空間 |
| 提案 | 助理的想法 | 只能當測試用預設值，並在 release-plan 註明 |
| 待討論 | 存在分歧或未決 | 不要實作；列入 release-plan「待使用者決定」 |

**所有角色、數值、台詞都是測試用**，不是正式設定（正式角色由 P10 決定）。

## 檔案

| 檔案 | 內容 |
|---|---|
| [design-overview.md](design-overview.md) | 世界觀、核心體驗、AI 權限邊界、NPC、羈絆、戰鬥與戰報的總體共識 |
| [combat-report-spec.md](combat-report-spec.md) | 戰報系統規格：必須遵守的設計、實作流程、自我檢查 |
| [event-schema.md](event-schema.md) | 事件與資料契約、統計定義 |
| [narration-and-memory.md](narration-and-memory.md) | 短演出、記憶、AI 安全界線 |
| [pair-synergy-and-black-box.md](pair-synergy-and-black-box.md) | 雙人羈絆、黑盒子研究 |
| [roadmap-and-acceptance.md](roadmap-and-acceptance.md) | M0–M6 交付與驗收測試矩陣 |
| [project-roadmap.md](project-roadmap.md) | P00–P13 專案拆分（提案） |
| [decisions.md](decisions.md) | 決策日誌與待使用者決定 |
| [open-questions.md](open-questions.md) | Q1–Q12 待討論問題 |
| [combat-example.md](combat-example.md) | 戰鬥演出示範 |
| [examples/](examples/) | 戰鬥 fixture、AI 演出契約範例 |
