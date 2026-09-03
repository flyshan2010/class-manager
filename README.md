# class-manager｜班級管理系統

教師支援系統三站之一。**只給老師在教室裡用**：投影黑板、抽籤、計時、抽籤問答、作業播放表、小組計分。

| | |
|---|---|
| 網址 | https://flyshan2010.github.io/class-manager/ |
| 使用者 | 只有老師（含代課、科任） |
| 場景 | 教室、投影機、上課當下 |
| 對後台 | 讀名冊 · 寫課堂事件（Phase 2 才開） |
| 曝光 | `noindex`，不從班網連過來 |

## 與另外兩站的關係

```
班級事務/
├── class-website/   班網 —— 家長與學生的資訊面（唯讀・公開）
├── class-manager/   ← 本 repo
└── study-orbit/     自學星圖 —— 學生複習自學
```

三個獨立 repo、三個獨立 GitHub Pages，**不共用 CI、健檢與 commit 歷史**。
本 repo 永遠不改班網的任何檔案，也不改 Notion 的名冊與題庫。

設計書：`班級事務/ClassOS_v3.5_藍圖/` 與《三站一後台設計書》。

## 學生名單怎麼來

**本 repo 是 public，所以名單不進 repo。**
老師第一次使用時在工作台貼上一次名單，存在瀏覽器 localStorage，只留在老師這台電腦。
`data/roster.sample.json` 只是格式範例，裡面沒有真人。

## 開發

純靜態、無 build step、無 CDN 相依。直接開 `index.html` 即可。
