/* 送出韌性模擬（2026-09-24，階段 1＋2 驗收）：node scripts/sim-send.mjs
 *
 * 把正式的 events.js＋sender.js 載進 vm，換掉代理成假代理，不連網、不碰 Notion。
 * 時間縮成毫秒（逾時 25ms、退避 2/5/10ms），邏輯與線上完全相同。
 *
 * 情境 A（驗收表原文）：每次連線 40% 失敗（一半連不上、一半卡住到逾時），請求沒到代理。
 *   期望：20 輪全部送完、收件匣 0 重複列、紀錄庫 0 重複入帳、每列都過 R18 解析。
 * 情境 B（已知殘餘）：另加 10%「代理已寫入收件匣但回應丟失」。
 *   期望：收件匣可能多列（藍圖已記為殘餘），但紀錄庫仍 0 重複入帳（R18 事件 id 去重兜底）。
 * 情境 C（對照組）：同 A 但關掉自動重試（delays=[]），證明 A 的「一次按送出就送完」是重試帶來的。
 * 階段 2：有失敗過的輪次，必須有一列收件匣首行帶「⚠ 前次送出失敗」，且該列 R18 解析正常、首行不含 {、JSON 沒多欄位。
 */
import fs from 'node:fs';
import vm from 'node:vm';

const js = f => fs.readFileSync(new URL('../assets/js/' + f, import.meta.url), 'utf8');
const SRC = js('events.js') + '\n' + js('sender.js');

function world() {
  const mem = {};
  const ctx = {
    localStorage: { getItem: k => (k in mem ? mem[k] : null), setItem: (k, v) => { mem[k] = String(v); }, removeItem: k => { delete mem[k]; } },
    setTimeout, clearTimeout, AbortController, Promise, Date, JSON, Math, console,
  };
  ctx.window = ctx;
  vm.runInNewContext(SRC, ctx);
  return ctx;
}

/* 假 R18：取第一個 { 之後全部 → JSON.parse；事件 id 已存在就跳過 */
function r18(text, ledger) {
  const head = text.slice(0, text.indexOf('{'));
  if (!head.startsWith('#CM-EVENTS')) throw new Error('R18 未命中');
  const body = JSON.parse(text.slice(text.indexOf('{')));   // 解析失敗＝E06，直接丟錯讓模擬失敗
  if (!Array.isArray(body.events)) throw new Error('E06 缺 events');
  let dup = 0;
  for (const e of body.events) { if (ledger.has(e.id)) dup++; else ledger.add(e.id); }
  return { body, dup };
}

let seed = 20260924;
const rnd = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);

async function round(mode) {
  const w = world();
  const E = w.CMEvents;
  // 造 3 包以上：到校 30 人＋作業清點 30 人×2 項
  for (let s = 1; s <= 30; s++) {
    E.push({ tool: 'arrive', date: '2026-09-24', seat: s, src: 'tally', kind: 'good', act: '準時到校簽到完成', note: '第' + s + '位到校' });
    E.push({ tool: 'homework', date: '2026-09-24', seat: s, src: 'rule', kind: 'good', act: '作業完成', rule_n: 4, act_i: 0, coin: 1, level: 1 });
    E.push({ tool: 'homework', date: '2026-09-24', seat: s, src: 'rule', kind: 'bad', act: '作業未交', rule_n: 4, act_i: 1, coin: -5, level: 1, note: '數習P.' + s });
  }
  const expectIds = new Set(E.merged().map(r => r.id));
  const inbox = [];
  let calls = 0, fails = 0;
  const post = (text) => {
    calls++;
    const r = rnd();
    if (r < 0.2) { fails++; return Promise.reject(new Error('Failed to fetch')); }
    if (r < 0.4) { fails++; return new Promise(() => {}); }                       // 卡住 → 逾時
    if (mode === 'B' && r < 0.5) { inbox.push(text); fails++; return new Promise(() => {}); } // 已寫入、回應丟失
    inbox.push(text);
    return Promise.resolve({ ok: true });
  };
  const S = w.CMSender.create({
    post, store: E, timeout: 25, sleep: ms => new Promise(r => setTimeout(r, ms)),
    delays: mode === 'C' ? [] : [2, 5, 10],
  });
  let presses = 0;
  while (E.count() && presses < 30) {           // 老師（或 online 補送）再按一次
    presses++;
    const packs = E.buildPayloads();
    try { await S.send(packs); E.markSent(); } catch (e) { /* 留在本機，下一輪再按 */ }
  }
  // 驗收
  const ledger = new Set();
  let r18Skipped = 0, withLog = 0, headBrace = 0;
  const keys = inbox.map(t => {
    const { body, dup } = r18(t, ledger);
    r18Skipped += dup;
    const first = t.split('\n')[0];
    if (first.includes('⚠ 前次送出失敗')) { withLog++; if (first.includes('{')) headBrace++; }
    if ('sendlog' in body) headBrace++;   // JSON 不得多欄位
    return body.batch + '#' + body.tool + '#' + body.part;
  });
  const inboxDup = keys.length - new Set(keys).size;
  const missing = [...expectIds].filter(id => !ledger.has(id)).length;
  return { presses, calls, fails, packs: new Set(keys).size, inboxDup, r18Skipped, missing, withLog, headBrace,
           leftLog: E.failLog().length, done: E.count() === 0 };
}

async function run(mode, n) {
  const rs = [];
  for (let i = 0; i < n; i++) rs.push(await round(mode));
  const sum = k => rs.reduce((a, r) => a + r[k], 0);
  const failedRounds = rs.filter(r => r.fails > 0);
  return {
    mode, rounds: n, allDone: rs.every(r => r.done), missingIds: sum('missing'),
    onePress: rs.filter(r => r.presses === 1).length, maxPresses: Math.max(...rs.map(r => r.presses)),
    calls: sum('calls'), fails: sum('fails'), inboxDup: sum('inboxDup'), r18Skipped: sum('r18Skipped'),
    failedRounds: failedRounds.length, roundsWithSendlog: failedRounds.filter(r => r.withLog > 0).length,
    headBrace: sum('headBrace'), leftLog: sum('leftLog'), packsPerRound: rs[0].packs,
  };
}

/* 情境 D：口令錯誤不該重試（重試也不會好，只會讓老師多等 17 秒） */
async function wrongPw() {
  const w = world(); const E = w.CMEvents;
  E.push({ tool: 'arrive', date: '2026-09-24', seat: 1, src: 'tally', kind: 'good', act: '到校' });
  let calls = 0;
  const S = w.CMSender.create({ post: () => { calls++; return Promise.resolve({ ok: false, error: '口令錯誤' }); },
    store: E, timeout: 25, delays: [2, 5, 10] });
  let msg = '';
  try { await S.send(E.buildPayloads()); } catch (e) { msg = e.message; }
  return { calls, msg, pending: E.count() };
}
const D = await wrongPw();
console.log(JSON.stringify(D));

const A = await run('A', 20), B = await run('B', 20), C = await run('C', 20);
for (const r of [A, B, C]) console.log(JSON.stringify(r));

const ok = [
  ['A 全部送完', A.allDone && A.missingIds === 0],
  ['A 收件匣 0 重複', A.inboxDup === 0],
  ['A 0 重複入帳（R18 連去重都用不到）', A.r18Skipped === 0],
  ['A 有失敗的輪次都帶上失敗紀錄', A.failedRounds > 0 && A.roundsWithSendlog === A.failedRounds],
  ['A 首行不含 {、JSON 沒多欄位', A.headBrace === 0],
  ['B 全部送完且 0 重複入帳（收件匣重複＝已知殘餘）', B.allDone && B.missingIds === 0],
  ['D 口令錯誤只打 1 次、不重試、事件留在本機', D.calls === 1 && D.msg === '口令錯誤' && D.pending === 1],
  ['C 對照組：無重試時需要按更多次', C.maxPresses > A.maxPresses || C.onePress < A.onePress],
];
let bad = 0;
for (const [name, pass] of ok) { console.log((pass ? '✅ ' : '❌ ') + name); if (!pass) bad++; }
console.log(`總計 ${ok.length} 項／失敗 ${bad} 項`);
process.exit(bad ? 1 : 0);
