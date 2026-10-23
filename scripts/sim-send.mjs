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
 * 情境 E（CG 線 P2b，2026-10-22・課堂作答只讀演練）：一節 7 題（Q1–Q5、C1、C2），含請假、中途到校、中途離開、全未答、
 *   答錯與未答混合的學生；flush → 打包 → 用假 R18 拆包，逐生比對「手算答案表」（r 字串、正負向），**不送出**。
 *   另驗：重按 flush 不疊加、改題後重 flush 反映新結果、送出後該節鎖住（saveItem 拒收、flush 0 筆）、預覽一行白話。
 */
import fs from 'node:fs';
import vm from 'node:vm';

const js = f => fs.readFileSync(new URL('../assets/js/' + f, import.meta.url), 'utf8');
const SRC = js('events.js') + '\n' + js('sender.js') + '\n' + js('assess.js');

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

/* 情境 E：課堂作答（只讀演練，不送出）。手算答案表＝依 SPEC §4.3／§4.4 人工逐生算好、寫死在這裡，不用程式產生。 */
function assessDrill() {
  const w = world(), E = w.CMEvents, AS = w.CMAssess, D = '2026-10-22', L = '國L7-2';
  const SEATS = Array.from({ length: 26 }, (_, i) => i + 1);
  // 每題：kp、缺席（8 號全天請假；3 號第三題才到校；20 號第五題起離校）、答錯、未答；其餘在場者＝答對
  const Q = [
    ['Q1', '小考', '字形', [8, 3], [12], [26]],
    ['Q2', '小考', '字形', [8, 3], [12], [26]],
    ['Q3', '小考', '推論', [8], [5, 12], [26]],
    ['Q4', '小考', '成語', [8], [12], [26]],
    ['Q5', '小考', '大意', [8, 20], [], [26]],
    ['C1', '課中', '提取', [8, 20], [], [26]],
    ['C2', '課中', '推論', [8, 20], [], [5, 26]],
  ];
  const save = ([cp, kind, kp, abs, ng, na], over = {}) => {
    const marks = {};
    SEATS.forEach((s) => { if (!abs.includes(s)) marks[s] = ng.includes(s) ? 'ng' : na.includes(s) ? 'na' : 'ok'; });
    Object.assign(marks, over);
    return AS.saveItem({ date: D, lesson: L, cp, kind, type: '選擇', src: kind === '小考' ? '國L7-1' : L, kp, marks, seats: SEATS, absent: abs,
      open: '08:4' + cp.slice(1) + ':05', sec: 30 + Number(cp.slice(1)) + 0.4 });   // 計時（老師 10-23 裁定）
  };
  // fail-closed：還有未標就不收
  const unmarked = AS.saveItem({ date: D, lesson: L, cp: 'Q1', kp: '字形', marks: { 1: 'ok' }, seats: SEATS, absent: [8] });
  Q.forEach((q) => save(q));
  const ALL = 'Q1:字形:O,Q2:字形:O,Q3:推論:O,Q4:成語:O,Q5:大意:O,C1:提取:O,C2:推論:O';
  const EXPECT = {};
  SEATS.forEach((s) => { EXPECT[s] = ['good', ALL]; });
  delete EXPECT[8];                                                                   // 全天請假：不產事件
  EXPECT[3] = ['good', 'Q3:推論:O,Q4:成語:O,Q5:大意:O,C1:提取:O,C2:推論:O'];          // 5/5
  EXPECT[5] = ['neutral', 'Q1:字形:O,Q2:字形:O,Q3:推論:X,Q4:成語:O,Q5:大意:O,C1:提取:O,C2:推論:N']; // 5/7：50<56、10>7
  EXPECT[12] = ['bad', 'Q1:字形:X,Q2:字形:X,Q3:推論:X,Q4:成語:X,Q5:大意:O,C1:提取:O,C2:推論:O'];   // 3/7：6≤7
  EXPECT[20] = ['good', 'Q1:字形:O,Q2:字形:O,Q3:推論:O,Q4:成語:O'];                   // 4/4
  EXPECT[26] = ['bad', 'Q1:字形:N,Q2:字形:N,Q3:推論:N,Q4:成語:N,Q5:大意:N,C1:提取:N,C2:推論:N']; // 0/7（未答算分母）

  const timing = AS.lessonRec(D, L).items.Q2;                                        // 計時存進暫存：open 原樣、sec 四捨五入到秒
  const f1 = AS.flush(E, D);
  const unpack = () => {                                                              // 假 R18：拆每一包
    const evs = [];
    for (const t of E.buildPayloads()) { const { body } = r18(t, new Set()); body.events.forEach((e) => evs.push({ ...e, _tool: body.tool })); }
    return evs;
  };
  const evs = unpack();
  let wrong = [];
  for (const e of evs) {
    const x = EXPECT[e.seat];
    if (!x || e.kind !== x[0] || e.r !== x[1]) wrong.push(`座號${e.seat}：得 ${e.kind} ${e.r}／手算 ${x ? x.join(' ') : '不該有'}`);
    if (e.id !== `assess-20261022-s${e.seat}-a${L}`) wrong.push(`座號${e.seat} id 不對：${e.id}`);
    if (e.src !== 'assess' || e._tool !== 'assess' || e.subj !== '國語' || e.lesson !== L || e.act !== '課堂作答' || 'coin' in e || 'open' in e || 'sec' in e) wrong.push(`座號${e.seat} 欄位不對：${JSON.stringify(e)}`);
  }
  const missing = Object.keys(EXPECT).filter((s) => !evs.some((e) => e.seat === Number(s)));
  const packs = E.buildPayloads();
  const preview = E.describePayloads().split('\n').find((l) => l.startsWith('📋 課堂作答')) || '';

  const f2 = AS.flush(E, D);                                                         // 再按一次「結束課程」：不疊加
  const again = E.merged().length;
  save(Q[2], { 5: 'ok' });                                                           // 改題：Q3 改成 5 號答對 → 6/7 good
  AS.flush(E, D);
  const s5 = E.merged().find((r) => r.seat === 5);
  E.markSent();                                                                      // 模擬送出成功
  const locked = AS.isSent(D, L), resave = save(Q[0]), f3 = AS.flush(E, D);
  return { unmarked, f1, evs: evs.length, wrong, missing, packs: packs.length, maxLen: Math.max(...packs.map((t) => t.length)),
    sample: packs[0], preview, again, f2, s5, locked, resave, f3, left: E.count(), timing };
}
const EA = assessDrill();
console.log('── 情境 E：課堂作答只讀演練（不送出）');
console.log('第 1 包原文：\n' + EA.sample);
console.log('預覽：' + EA.preview);
console.log(JSON.stringify({ events: EA.evs, packs: EA.packs, maxLen: EA.maxLen, wrong: EA.wrong, missing: EA.missing,
  again: EA.again, s5: EA.s5 && [EA.s5.kind, EA.s5.r], locked: EA.locked, resave: EA.resave, f3: EA.f3.pushed, left: EA.left }));

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
  ['E 未標完不收（fail-closed）', EA.unmarked.ok === false],
  ['E 25 生（26 人扣全天請假 1 人）事件與手算逐生一致', EA.evs === 25 && EA.wrong.length === 0 && EA.missing.length === 0],
  ['E 每包都過 R18 解析且不超過 2000 字', EA.packs >= 2 && EA.maxLen <= 2000],
  ['E 預覽一行白話（整節人數）', EA.preview === '📋 課堂作答 國L7-2 · 25 人：正向 22、中性 1、負向 2'],
  ['E 重按 flush 不疊加', EA.again === 25 && EA.f2.pushed === 25],
  ['E 改題後重 flush 反映新結果（5 號 6/7→正向）', EA.s5 && EA.s5.kind === 'good' && EA.s5.r.includes('Q3:推論:O')],
  ['E 計時存本機暫存（open／sec），事件包不帶', EA.timing && EA.timing.open === '08:42:05' && EA.timing.sec === 32 && EA.wrong.length === 0],
  ['E 送出後該節鎖住（拒收、flush 0 筆、待送清空）', EA.locked && EA.resave.ok === false && EA.f3.pushed === 0 && EA.left === 0],
];
let bad = 0;
for (const [name, pass] of ok) { console.log((pass ? '✅ ' : '❌ ') + name); if (!pass) bad++; }
console.log(`總計 ${ok.length} 項／失敗 ${bad} 項`);
process.exit(bad ? 1 : 0);
