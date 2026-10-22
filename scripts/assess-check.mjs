/* 課堂作答計分兩份一致性檢查（CG 線 P2b，2026-10-22）
 *
 * 正本：class-website/scripts/classos/lib/cm-events.mjs 的 assessKind（f35 入庫時重算核對，不一致 E07）。
 * 副本：本站 assets/js/assess.js 的 CMAssess.kindOf（電子白板填 kind、收班預覽顯示）。
 * 三站互不改對方檔案（比照 hw-subject-check.mjs），所以表有兩份；這支逐題比對，判得不一樣就紅。
 *
 * 題目＝ SPEC §4.4 寫死的邊界答案（8/10、5/10、0 記…）＋ 記 1–8 題的全部組合（一節最多 Q1–Q5＋C1–C3＝8 題）。
 * 正本還沒有 assessKind（P2c 未上線）時：只比對寫死的邊界答案，並印「待 P2c 上線後再跑一次真比對」，結束碼照樣看邊界答案。
 *
 * 用法（在 class-manager/）：node scripts/assess-check.mjs
 */
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const SITE = path.join(ROOT, '..', 'class-website');

const sandbox = { window: {}, localStorage: { getItem: () => null, setItem() {} } };
vm.runInNewContext(readFileSync(path.join(ROOT, 'assets/js/assess.js'), 'utf8'), sandbox);
const kindOf = sandbox.window.CMAssess.kindOf;

let assessKind = null, checkAssess = null;
try {
  const m = await import(pathToFileURL(path.join(SITE, 'scripts/classos/lib/cm-events.mjs')).href);
  if (typeof m.assessKind === 'function') assessKind = m.assessKind;
  if (typeof m.checkAssess === 'function') checkAssess = m.checkAssess;
} catch (e) { /* 讀不到班網 repo：只比寫死的答案 */ }

/* SPEC §4.4 寫死的答案：對×10 ≥ 記×8 → good；對×2 ≤ 記 → bad；其餘 neutral；記 0（一題都不在場）→ 不產事件。 */
const FIXED = [
  [8, 10, 'good'], [7, 10, 'neutral'], [6, 10, 'neutral'], [5, 10, 'bad'], [0, 10, 'bad'],
  [4, 5, 'good'], [3, 5, 'neutral'], [2, 5, 'bad'], [7, 7, 'good'], [6, 7, 'good'], [5, 7, 'neutral'],
  [4, 7, 'neutral'], [3, 7, 'bad'], [0, 7, 'bad'], [1, 1, 'good'], [0, 1, 'bad'], [1, 2, 'bad'],
  [2, 3, 'neutral'], [0, 0, null], [3, 2, null], [-1, 3, null], [1.5, 3, null]
];

let bad = 0, n = 0;
for (const [o, rec, want] of FIXED) {
  n++;
  const got = kindOf(o, rec);
  if (got !== want) { bad++; console.log(`❌ SPEC 邊界 對${o}／記${rec}：SPEC＝${want}／class-manager＝${got}`); }
  if (assessKind) {
    const real = assessKind(o, rec) ?? null;
    if (real !== got) { bad++; console.log(`❌ 不一致 對${o}／記${rec}：R18＝${real}／class-manager＝${got}`); }
  }
}
let full = 0;
if (assessKind) {
  for (let rec = 0; rec <= 8; rec++) for (let o = 0; o <= rec; o++) {
    full++;
    const a = assessKind(o, rec) ?? null, b = kindOf(o, rec);
    if (a !== b) { bad++; console.log(`❌ 不一致 對${o}／記${rec}：R18＝${a}／class-manager＝${b}`); }
  }
}
/* 端到端：本站 lessonEvents 產的事件丟給 R18 的 checkAssess（格式關 E06、正負向核對 E07），全部要過。
   樣本＝一節 8 題（Q1–Q5、C1–C3）每位學生對錯／未答／缺席各種組合。 */
let e2e = 0;
if (checkAssess) {
  const KP = ['字形', '推論', '大意', '提取', '成語', '修辭', '句型', '結構'];
  const CPS = ['Q1', 'Q2', 'Q3', 'Q4', 'Q5', 'C1', 'C2', 'C3'];
  const items = {}, codes = ['ok', 'ng', 'na', null];
  CPS.forEach((cp, i) => {
    const marks = {};
    for (let s = 1; s <= 64; s++) { const c = codes[Math.floor(s / 4 ** (i % 3)) % 4]; if (c) marks[s] = c; }
    items[cp] = { kp: KP[i], marks, absent: [] };
  });
  const evs = sandbox.window.CMAssess.lessonEvents('2026-10-22', '國L7-2', { subj: '國語', items }).events;
  for (const ev of evs) {
    e2e++;
    const r = checkAssess(ev);
    if (!r.ok) { bad++; console.log(`❌ R18 checkAssess 不收 座號${ev.seat}：${r.code} ${r.why}`); }
  }
}
console.log(`SPEC 邊界答案 ${n} 題` + (assessKind ? `＋與 R18 assessKind 逐題比對 ${full} 組` : '') + (checkAssess ? `＋R18 checkAssess 端到端 ${e2e} 筆` : '') + `／不一致 ${bad} 題`);
if (!assessKind) console.log('⚠ 班網 cm-events.mjs 還沒有 assessKind（P2c 未上線）：只比了 SPEC 寫死的答案——待 P2c 上線後再跑一次真比對。');
process.exitCode = bad ? 1 : 0;
