/* 靜態資源版本號：把每個 *.html 裡的 assets/** 引用都蓋上 ?v=<YYYYMMDD-N>（零相依，Node 18+）
 *
 * 與 class-website/scripts/bump-assets.mjs 是同一支（2026-09-09 移植）。**兩邊都要改時各改各的**——
 * 三站互相不改對方的檔案（class-manager/CLAUDE.md 硬規則 1），所以寧可兩份也不共用。
 *
 * 為什麼一定要有：沒有版本號時，瀏覽器會拿**快取的舊 JS** 配**新的 HTML**，
 * 函式簽名對不起來 → 按鈕按下去什麼都不發生、畫面空白，而**主控台以外看不到任何錯誤**。
 * 老師只會覺得「這個網站壞了」，而重新整理一次不一定救得回來（要強制重新整理）。
 * 這在教室現場最貴：投影到一半按鈕沒反應，當下沒有時間 debug。
 *
 * 用法：改完 assets/ 底下任何 css／js 就跑一次
 *     node scripts/bump-assets.mjs
 * 同一天多次改動會自動往後遞增（20260909-1 → -2 → …），指定版本用
 *     node scripts/bump-assets.mjs 20260909-7
 *
 * ⚠️ `?v=` 只換得掉 JS／CSS，**HTML 本身仍會被瀏覽器與 GitHub Pages 快取**——
 * 線上驗證時網址一律另外加 `?t=<時間戳>`，不要只看 bump 完就以為驗到新版（U49）。
 */
import { readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

const ROOT = process.cwd();
const REF = /((?:href|src)=")(assets\/[^"?]+)(?:\?v=[^"]*)?(")/g;
const STAMP = /\?v=(\d{8})-(\d+)/g;

const files = (await readdir(ROOT)).filter(f => f.endsWith(".html")).sort();
const bodies = new Map();
for (const f of files) bodies.set(f, await readFile(path.join(ROOT, f), "utf8"));

/* 版本號：參數優先；否則今天日期，同一天已用過就往後遞增。 */
let stamp = process.argv[2];
if (!stamp) {
  const d = new Date();
  const today = `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, "0")}${String(d.getDate()).padStart(2, "0")}`;
  let seq = 0;
  for (const body of bodies.values())
    for (const m of body.matchAll(STAMP)) if (m[1] === today) seq = Math.max(seq, Number(m[2]));
  stamp = `${today}-${seq + 1}`;
}
if (!/^\d{8}-\d+$/.test(stamp)) {
  console.error(`❌ 版本號格式要是 YYYYMMDD-N，收到「${stamp}」`);
  process.exit(1);
}

let touched = 0, refs = 0;
for (const [f, body] of bodies) {
  let n = 0;
  const out = body.replace(REF, (_, a, p, z) => { n++; return `${a}${p}?v=${stamp}${z}`; });
  refs += n;
  if (out !== body) { await writeFile(path.join(ROOT, f), out, "utf8"); touched++; }
}
console.log(`✅ 版本號 ${stamp}：${refs} 處引用，改了 ${touched} 個檔（共 ${files.length} 個 html）`);
