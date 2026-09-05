# class-manager 專屬規則

> 只在本資料夾樹底下工作時載入（資料夾層 CLAUDE.md 由 Claude Code 自動疊加）。
> 上位規則：`Project/AGENTS.md`（通用鐵則）、`班級事務/CLAUDE.md`（班級鐵則）。

## 這個 repo 是什麼

教師支援系統的第二站：**班級管理系統**。老師在教室裡投影使用的課堂工具。
班網（`class-website/`）與自學星圖（`study-orbit/`）是另外兩個獨立 repo。

## 四條硬規則

1. **不碰班網。** 本 repo 的任何工作都不得修改 `class-website/` 底下的檔案。
   需要班網的資料時，走後台（Notion）取得，不跨 repo 讀寫。
2. **本系統不存學生姓名，只用座號。**
   投影在教室前方時座號就足以指認學生；少了姓名，這個 public repo、任何截圖與
   任何投影畫面都不可能外洩個資。**姓名、查詢碼、性別、職務、家長聯絡資訊
   一個字都不寫進任何檔案，也不寫進 localStorage。**
   座號由老師在工作台設定（`ClassManager.requireSeats()` 取用），存 localStorage。
   工具頁拿不到座號時要顯示「請先回工作台設定座號」，**不要自己假設人數**。
3. **每頁必加 `<meta name="robots" content="noindex">`**，且不從班網連過來。
4. **純靜態、零相依。** 無 build step、無 npm 套件、無外部 CDN 與外部字型——
   教室網路會斷，斷網時全部工具必須照常可用。

## 連網讀取 Notion 資料：允許，但只走「漸進增強」（2026-09-03 投影黑板起）

硬規則 4 的「零相依／斷網可用」**不禁止連網讀取自己的資料**，禁的是「非連上外部資源就不能用」。
老師的需求是「在家改、到校免重打」，這需要跨裝置的共享資料，做法定死如下：

- **資料來源＝班網已產出的公開 JSON**（例：聯絡簿讀 `class-website/data/contactbook.json`）。
  兩站同域名 `flyshan2010.github.io` ＝**同源**，`fetch` 不會有 CORS 問題，
  **也不改班網任何檔案**（不違反硬規則 1，只是 HTTP 讀公開檔）。**不需要 token。**
- **正本在 Notion**，老師在家用 Notion／class-admin 改「📒 聯絡簿」，班網 sync 產出 JSON，
  class-manager 只**單向讀取**。Phase 1 不做「從 class-manager 寫回 Notion」（那要 token／Action，屬 Phase 2）。
- **一律漸進增強，違反即算 bug**：①先畫上次存下的 localStorage 內容（離線也立刻有東西、不閃白）
  ②再非強制 `fetch` 雲端，成功才帶入並快取 ③fetch 失敗／離線 → 維持上次快取、標記離線，
  **絕不讓斷網把整頁弄壞**。④當天老師「就地手改」過的內容，雲端不自動覆蓋（臨時加一項用），
  只提示「有雲端版」讓老師自己按鈕換。
- 破快取：fetch 帶 `?t=<時間戳>` + `cache:'no-store'`，確保拿到最新（班網 sync 每天三次）。

## 視覺基準：智慧教室儀表板 2.0 風＋全站 RWD（2026-09-04）

全站視覺參照 apaulliao.github.io/schooltool（近黑星空底、玻璃圓角卡片、彩色膠囊工具列），
正本在 `assets/css/projection.css`（投影工具外殼）與 `assets/css/style.css`（工作台）的 `:root` 色票與 `body::before` 星空。
改配色改這兩處即可，六支工具用同一組 CSS 變數（--duty/--mark/--ok/--warn/--pink/--blue/--purple/--lime/--board*/--chalk*），不要在個別工具硬寫色。
**全站 RWD**：每頁都有 `@media (max-width:900px/560px)` 斷點；投影仍是主場景（1600×900），但平板／手機開也不得橫向捲動（改版後一律在 390 寬回讀 `scrollWidth<=innerWidth`）。星空是內嵌 SVG data-URI，非外部資源，不違反離線硬規則。

## 課堂工具共用資產（2026-09-03 Phase 1 六支上線）

六支工具（blackboard／draw／timer／quiz／homework／groups）共用兩個同源資產，改它們＝改全部工具，改完把版本號往前推、逐支回讀：
- `assets/css/projection.css`：投影外殼（板面底色、HUD 底列、側邊面板、按鈕、空狀態）。
- `assets/js/tool.js`：共用底層 `Tool.*`（座號守門 `requireSeats`、HUD 自動隱藏、全螢幕、提示音、localStorage、洗牌）。個別工具的邏輯不寫這裡。
座號一律 `Tool.requireSeats(stageEl)`，回 null 就換成「請先回工作台設定」（計時不需座號，例外）。

## 靜態資源一律帶版本號（2026-09-03 活體驗收踩到）

`index.html` 引用 `assets/**` 時**必須加 `?v=<日期>-<序>`**，改動 JS／CSS 就把版本號往前推。

沒有版本號會出現最惡劣的一種壞法：瀏覽器拿**快取的舊 JS** 配**新的 HTML**，
函式簽名對不起來 → 按鈕按下去什麼都不發生、狀態列空白、**主控台以外看不到任何錯誤**。
老師只會覺得「這個網站壞了」，而重新整理一次不一定救得回來（強制重新整理才會）。

班網 `class-website` 用的是同一招（`?v=20260903-...`），照做即可。

## 寫入分級（設計書 §03）

- **L1 即時**：加分、抽籤結果、抽問答對錯、小組競賽分、計時紀錄
  → **只寫 localStorage**，下課按「收班」才批次送出。這一階段完全不碰網路。
- **L2 事件**：出勤打卡、作業訂正完成 → 即時送出，去重鍵＝（對象 × 事件 × 日期）。
- Phase 1 只做 L1，**不新增任何寫入路徑**。

## 投影版面

- 基準 **1600×900**，改完要實測不溢出。
  量測＝就地把容器設 `height:auto` 再讀 `scrollHeight`，量完還原；直接量恆回 900。
- 教室後排看得到：投影用字級不得低於 32px，主要內容不得低於 40px。
- 深色底、高對比；避免大面積純白（投影機會過曝）。

## 完工定義

- push 後 `curl -s -o /dev/null -w '%{http_code}'` 確認 200，未 200 不得宣稱上線。
  ⚠️ **單發 curl 會誤判**（U46）：GitHub Pages 首次啟用 404→200 約 1 分鐘、後續部署約 45–90 秒。
  一律**輪詢到 200／到指紋字串出現為止**：`until curl -s <url> | grep -q <指紋>; do sleep 10; done`。
- 新增功能同步更新 `docs/老師操作手冊.md`（班級鐵則 8）。
