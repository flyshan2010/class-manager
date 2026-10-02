/* 作業科目兩份對照表一致性檢查（2026-10-02）
 *
 * 正本：class-website/scripts/classos/lib/cm-events.mjs 的 hwSubjectsOf（R18 入庫時真的寫進紀錄庫）。
 * 副本：本站 assets/js/events.js 的 CMEvents.hwSubjects（只供「今日待送」送出前顯示）。
 * 三站互不改對方檔案，所以表有兩份；這支用同一批作業名逐題比對，兩份判得不一樣就紅。
 * 題目＝固定樣本＋班網 data/contactbook.json 整學期每一行作業（順便預告哪幾天會出現「科目判不出」）。
 *
 * 用法（在 class-manager/）：node scripts/hw-subject-check.mjs
 * 需要同一台電腦上有 class-website（Drive 上兩站並排，路徑 ../class-website）。
 */
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const SITE = path.join(ROOT, '..', 'class-website');
const { hwSubjectsOf } = await import(pathToFileURL(path.join(SITE, 'scripts/classos/lib/cm-events.mjs')).href);

const sandbox = { window: {}, localStorage: { getItem: () => null, setItem() {} } };
vm.runInNewContext(readFileSync(path.join(ROOT, 'assets/js/events.js'), 'utf8'), sandbox);
const cm = sandbox.window.CMEvents;

const samples = ['', '聯絡簿', '數練 3-1 認識量角器 P.13（10-01 派）、國習 L5 P.30-31（09-29 派）', '乙本 L2 P.3-13、預習國 L2',
  '社習P2-3', '統整園地(4) P.46-47', '考自然U1', '國語複習卷 1 張、社會 複習卷 1 張、數卷 1 張', '【定期評量】', '國習 L5、P.32'];
const book = JSON.parse(readFileSync(path.join(SITE, 'data/contactbook.json'), 'utf8'));
const lines = [...new Set(book.flatMap((r) => String(r.homework || '').split(/\n+/).map((s) => s.trim()).filter(Boolean)))];

let diff = 0;
const manual = new Map();
for (const name of [...samples, ...lines]) {
  const a = hwSubjectsOf(name).join('、'), b = cm.hwSubjects(name).subjects.join('、');
  if (a !== b) { diff++; console.log(`❌ 不一致「${name}」：R18＝${a}／class-manager＝${b}`); }
  if (lines.includes(name) && a.includes('需人工')) manual.set(name, book.filter((r) => String(r.homework || '').includes(name)).map((r) => r.date.slice(5)).join(' '));
}
console.log(`比對 ${samples.length + lines.length} 題（聯絡簿作業 ${lines.length} 行）／不一致 ${diff} 題`);
if (manual.size) {
  console.log('聯絡簿裡會被標「科目判不出」的作業名（送出前會出現 ⚠，要改寫法或補縮寫）：');
  for (const [n, d] of manual) console.log(`   ${n}　（${d}）`);
}
process.exitCode = diff ? 1 : 0;
