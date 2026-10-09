/* 每週統計彙整的自我檢查（零相依，Node 18+）：node scripts/stats-check.mjs
 * 用假資料（座號 1–4）驗 stats.js 的規則：請假不算應到、補交算做到、沒檢核的站不計、週次與月份分組。
 * 真實座號資料不進這個 public repo。 */
import { createRequire } from "node:module";
const S = createRequire(import.meta.url)("../assets/js/stats.js");

const db = {
  v: 1, term: "2026-08-31", made: { "2|數習 P.1（09-07 派）": "2026-09-09" },
  days: {
    "2026-09-07": { src: "fill", st: {
      arrive: { x: [1], lv: [4] },
      hw: { x: { 2: ["數習 P.1（09-07 派）"], 3: ["國習（09-07 派）", "數習 P.1（09-07 派）"] }, lv: [] },
      clean: { x: [], lv: [4], su: { 3: 2 } } } },
    "2026-09-08": { src: "fill", st: { arrive: { x: [1, 4], lv: [] }, teeth: { x: [1, 2, 3], lv: [3] } } },
    "2026-09-14": { src: "live", st: { arrive: { x: [], lv: [] } } },
    "2026-10-05": { src: "live", st: { arrive: { x: [2], lv: [] } } },
  },
};
const seats = [1, 2, 3, 4];
const M = S.model(db, seats);
let fail = 0;
const eq = (name, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (!ok) { fail++; console.log(`✗ ${name}\n   得到 ${JSON.stringify(got)}\n   應為 ${JSON.stringify(want)}`); }
};
eq("週分組", M.weeks.map(w => [w.label, w.dates.length]), [["第 2 週", 2], ["第 3 週", 1], ["第 6 週", 1]]);
eq("月分組", M.months.map(m => [m.label, m.dates.length]), [["9月", 3], ["10月", 1]]);
eq("回填天數", M.fill.length, 2);
const w2 = M.weeks[0].dates;
const a = M.stationAgg(w2, 0);             // 到校：9/7 應到 3（4 請假）遲到 1；9/8 應到 4 遲到 2
eq("到校 例外／應到", [a.exc, a.den], [3, 7]);
eq("到校 例外座號", a.who, ["1×2", "4"]);
const h = M.stationAgg(w2, 2);             // 作業：只有 9/7 檢核；座號 2 已補→不算；座號 3 還有一份沒補→算
eq("作業 例外／應到", [h.exc, h.den], [1, 4]);
eq("作業 補交次數", M.seatAgg(w2, 2, 2).made, 1);
const t = M.stationAgg(w2, 4);             // 潔牙：座號 3 請假優先於沒做
eq("潔牙 例外／應到", [t.exc, t.den], [2, 3]);
eq("午餐 沒檢核＝不計", M.stationAgg(w2, 3).rate, null);
eq("晨掃 支援", M.seatAgg(w2, 1, 3).su, 2);
eq("晨掃 請假不算應到", M.stationAgg(w2, 1).den, 3);
eq("達成率", Math.round(a.rate * 10) / 10, 57.1);
console.log(fail ? `\n${fail} 項不符` : "stats-check：12 項全數通過");
process.exit(fail ? 1 : 0);
