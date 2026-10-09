/* 跨電腦同步兩台模擬（2026-10-09，設計計畫 §2・§5 步驟 1）：node scripts/sim-sync.mjs
 *
 * 把正式的 sync.js（核心）與正式的代理檔（../class-website/scripts/apps-script-proxy-v2.gs）
 * 一起載進 vm：代理的指令碼屬性換成記憶體假件，不連網、不碰 Notion、不碰真的 localStorage。
 * 只讀代理檔、不改它（代理是三站共用後台，老師 2026-10-09 裁定直接加動作）。
 */
import fs from 'node:fs';
import vm from 'node:vm';

const SYNC = fs.readFileSync(new URL('../assets/js/sync.js', import.meta.url), 'utf8');
const GAS_PATH = new URL('../../class-website/scripts/apps-script-proxy-v2.gs', import.meta.url);
const GAS = fs.readFileSync(GAS_PATH, 'utf8');
const EVENTS = fs.readFileSync(new URL('../assets/js/events.js', import.meta.url), 'utf8');

/* ── 假代理：真的 doPost＋記憶體指令碼屬性 ── */
function proxy() {
  const P = { PASSWORD: 'pw-test' };
  let n = 0, big = 0;
  const props = {
    getProperty: k => (k in P ? P[k] : null),
    setProperty: (k, v) => { if (String(v).length * 3 > 9000 && Buffer.byteLength(String(v)) > 9000) big++; P[k] = String(v); },
    setProperties: o => { for (const k of Object.keys(o)) props.setProperty(k, o[k]); },
    deleteProperty: k => { delete P[k]; },
    getProperties: () => ({ ...P }),
  };
  const ctx = {
    PropertiesService: { getScriptProperties: () => props },
    LockService: { getScriptLock: () => ({ waitLock() {}, releaseLock() {} }) },
    Utilities: { getUuid: () => 'uuid-' + (++n) + '-' + Math.random().toString(16).slice(2), formatDate: () => '' },
    ContentService: { MimeType: { JSON: 'json' }, createTextOutput: s => ({ setMimeType: () => s }) },
    Logger: { log() {} }, console, JSON, Math, Date,
  };
  vm.runInNewContext(GAS, ctx);
  const call = body => JSON.parse(ctx.doPost({ postData: { contents: JSON.stringify(body) } }));
  return { P, call, tooBig: () => big };
}

/* ── 一台電腦：記憶體 localStorage＋正式 sync 核心 ── */
function computer(name, px) {
  const mem = {};
  const ctx = { console, JSON, Math, Date, Promise, setTimeout, clearTimeout };
  ctx.globalThis = ctx;
  vm.runInNewContext(SYNC, ctx);
  const me = { name, mem, online: true, touched: true, answer: 'local', asked: [], reloads: 0, state: '', lostReply: false };
  const core = ctx.CMSync.create({
    get: k => (k in mem ? mem[k] : null),
    set: (k, v) => { mem[k] = String(v); },
    remove: k => { delete mem[k]; },
    post: (url, body) => {
      if (!me.online) return Promise.reject(new Error('Failed to fetch'));
      const res = px.call(body);
      if (me.lostReply) return Promise.reject(new Error('回應丟失'));
      return Promise.resolve(res);
    },
    interacted: () => me.touched,
    ask: list => { me.asked.push(list.map(x => x.key)); return Promise.resolve(me.answer); },
    reload: () => { me.reloads++; },
    status: s => { me.state = s; },
    timer: () => 0,                       // 不等 3 秒，模擬裡手動 push
  });
  me.core = core;
  /* 等同瀏覽器端攔截 localStorage.setItem */
  me.write = (k, v) => { const old = k in mem ? mem[k] : null; mem[k] = v; core.note(k, old, v); };
  me.pair = () => { const r = px.call({ action: 'sync_pair', pw: 'pw-test' }); return core.pair('https://proxy.test', r.secret); };
  return me;
}

const K = { ev: 'classManager.events.v1', hw: 'classManager.homework.v3', rt: 'classManager.routine.v2',
            seats: 'classManager.seats.v2', st: 'classManager.stats.v1' };
const checks = [];
const ok = (name, pass, extra) => { checks.push([name, !!pass, extra]); };

/* 1 A 有資料先配對 → 上傳；B 新電腦配對 → 自動帶入 */
{
  const px = proxy(), A = computer('A', px), B = computer('B', px);
  A.mem[K.seats] = '{"seats":[1,2,3]}'; A.mem[K.rt] = '{"date":"2026-10-09","sv":8,"arrive":{"1":1}}';
  await A.pair();
  await B.pair();
  ok('1 新電腦配對後自動帶入、內容一致、沒有跳出詢問',
     B.mem[K.seats] === A.mem[K.seats] && B.mem[K.rt] === A.mem[K.rt] && B.asked.length === 0 && B.reloads === 1 && A.reloads === 0);

  /* 2 A 送出（待送清空、批次號前進）→ B 開頁接續：不會重送 */
  A.write(K.ev, '{"pending":[{"id":"e1"}],"batch":{"2026-10-09":1}}'); await A.core.push();
  await B.core.pull('open');
  const bHad = JSON.parse(B.mem[K.ev]).pending.length;
  A.write(K.ev, '{"pending":[],"batch":{"2026-10-09":2},"sent":[]}'); await A.core.push();
  await B.core.pull('open');
  const b = JSON.parse(B.mem[K.ev]);
  ok('2 A 送出後 B 接續：待送 0 筆、批次號同步', bHad === 1 && b.pending.length === 0 && b.batch['2026-10-09'] === 2 && B.asked.length === 0);

  /* 3 兩台同時改 → 後傳者被拒、不自動覆蓋；選「這台」才上傳 */
  A.write(K.rt, '{"date":"2026-10-09","sv":8,"arrive":{"1":1,"2":1}}');
  B.write(K.rt, '{"date":"2026-10-09","sv":8,"arrive":{"1":1,"3":2}}');
  await A.core.push();
  const cloudBefore = px.call({ action: 'state_get', secret: px.P.SYNC_SECRET }).items[K.rt].v;
  B.answer = 'local'; await B.core.push();
  const cloudAfter = px.call({ action: 'state_get', secret: px.P.SYNC_SECRET }).items[K.rt].v;
  ok('3a 兩台都改：先問老師（1 次）、選「這台」後雲端才換成 B 的', B.asked.length === 1 && B.asked[0][0] === K.rt &&
     cloudBefore === A.mem[K.rt] && cloudAfter === B.mem[K.rt]);
  await A.core.pull('open');
  ok('3b A 之後沒再改 → 自動接續 B 的、不詢問', A.mem[K.rt] === B.mem[K.rt] && A.asked.length === 0);

  A.write(K.hw, '{"carry":{"a":1}}'); await A.core.push();
  await B.core.pull('open');
  A.write(K.hw, '{"carry":{"a":1,"b":1}}'); B.write(K.hw, '{"carry":{"c":1}}');
  await A.core.push();
  B.answer = 'cloud'; B.asked = []; const r0 = B.reloads; await B.core.push();
  ok('3c 選「另一台」→ 這台換成雲端那份並重新載入', B.asked.length === 1 && B.mem[K.hw] === A.mem[K.hw] && B.reloads === r0 + 1 && !B.core.dirty());

  /* 4 斷網：本機照常、標未同步；恢復後補傳 */
  B.online = false;
  B.write(K.st, '{"days":{"2026-10-09":{"x":1}}}');
  await B.core.push();
  const offState = B.state, stillDirty = B.core.dirty();
  B.online = true; await B.core.pull('later');
  await A.core.pull('open');
  ok('4 斷網時留在本機並標未同步，恢復後補傳、另一台接得到', offState === 'offline' && stillDirty && !B.core.dirty() && A.mem[K.st] === B.mem[K.st]);

  /* 5 離開頁面那次上傳其實成功、但回應沒收到 → 下次開頁不誤判成衝突 */
  B.asked = []; B.lostReply = true;
  B.write(K.st, '{"days":{"2026-10-09":{"x":2}}}'); await B.core.push();
  B.lostReply = false; await B.core.pull('open');
  ok('5 上傳成功但回應丟失：下次開頁不詢問、不重複', B.asked.length === 0 && !B.core.dirty());

  /* 6 開頁自動換日（老師還沒動手）不算改動 → 雲端較新時直接帶入 */
  A.write(K.rt, '{"date":"2026-10-12","sv":8,"arrive":{"5":1}}'); await A.core.push();
  B.touched = false; B.asked = [];
  B.write(K.rt, '{"date":"2026-10-12","sv":8,"arrive":{}}');   // B 開頁自己換日存檔
  await B.core.pull('open');
  ok('6 開頁自動換日不算改動：直接接續另一台、不詢問', B.asked.length === 0 && B.mem[K.rt] === A.mem[K.rt]);
  B.touched = true;

  /* 6b 開著沒關的那台：之後才發現另一台較新 → 只提示，點了才帶入 */
  A.write(K.rt, '{"date":"2026-10-12","sv":8,"arrive":{"5":1,"6":1}}'); await A.core.push();
  const before = B.mem[K.rt], r1 = B.reloads;
  await B.core.pull('later');
  const heldOk = B.mem[K.rt] === before && B.state === 'newer' && B.reloads === r1;
  await B.core.resume();
  ok('6b 上課中才發現另一台較新：只提示不打斷，點了才帶入', heldOk && B.mem[K.rt] === A.mem[K.rt] && B.reloads === r1 + 1);

  /* 7 憑證的權限：錯的憑證被拒；白名單以外的鍵被拒；憑證不能當口令用 */
  const bad = px.call({ action: 'state_get', secret: 'nope' });
  const other = px.call({ action: 'state_put', secret: px.P.SYNC_SECRET, items: [{ k: 'PASSWORD', v: 'x', base: 0 }, { k: 'GH_TOKEN', v: 'x', base: 0 }] });
  const asPw = px.call({ action: 'submit_task', pw: px.P.SYNC_SECRET, text: 'x' });
  const noPw = px.call({ action: 'sync_pair', pw: 'wrong' });
  ok('7 錯憑證被拒、白名單外的鍵寫不進、憑證不能送任務、口令錯不給憑證',
     bad.ok === false && bad.unpaired === true && other.results.PASSWORD.ok === false && px.P.PASSWORD === 'pw-test' &&
     !('GH_TOKEN' in px.P) && asPw.ok === false && asPw.error === '口令錯誤' && noPw.ok === false && !noPw.secret);

  /* 8 分片：含中文的大值來回一致、每片不超過 9KB；變短後舊分片清掉 */
  const bigV = JSON.stringify({ log: Array.from({ length: 900 }, (_, i) => '第' + i + '節本節重點：分數的加減與應用題練習') });
  A.write('classManager.board.v1', bigV); await A.core.push();
  await B.core.pull('open');
  const chunks = () => Object.keys(px.P).filter(k => k.startsWith('CMS_V_board_v1_')).length;
  const c1 = chunks();
  const maxBytes = Math.max(...Object.keys(px.P).filter(k => k.startsWith('CMS_')).map(k => Buffer.byteLength(px.P[k])));
  A.write('classManager.board.v1', '{"log":[]}'); await A.core.push();
  ok('8 大值分片來回一致（' + c1 + ' 片、最大 ' + maxBytes + ' bytes）、變短後舊分片清掉',
     B.mem['classManager.board.v1'] === bigV && c1 > 5 && maxBytes < 9000 && chunks() === 1);

  /* 9 超過上限：拒收、不影響其他鍵 */
  const huge = px.call({ action: 'state_put', secret: px.P.SYNC_SECRET, dev: 'x', items: [{ k: K.st, v: 'x'.repeat(120001), base: 999 }] });
  ok('9 超過單鍵上限拒收', huge.results[K.st].ok === false && !huge.results[K.st].conflict);

  /* 10 刪掉 SYNC_SECRET → 舊憑證全部失效、這台停止同步並提示重新配對 */
  delete px.P.SYNC_SECRET;
  A.write(K.seats, '{"seats":[1,2,3,4]}'); await A.core.push();
  ok('10 撤銷憑證後停止同步、提示重新配對', A.state === 'unpaired' && !A.core.paired());

  /* 11 「這台停止同步」之後的改動不再上傳 */
  const before11 = px.call({ action: 'sync_pair', pw: 'pw-test' }).secret;
  B.core.stop();
  B.write(K.seats, '{"seats":[9]}'); await B.core.push();
  const cloudSeats = px.call({ action: 'state_get', secret: before11 }).items[K.seats];
  ok('11 按「這台停止同步」後不再上傳', !B.core.paired() && B.core.stopped() && (!cloudSeats || cloudSeats.v !== '{"seats":[9]}'));
}

/* 12 第二台本來就有自己的紀錄（沒同步過）→ 配對時先問，不默默蓋掉任何一邊 */
{
  const px = proxy(), A = computer('A', px), B = computer('B', px);
  A.mem[K.hw] = '{"carry":{"a":1}}'; await A.pair();
  B.mem[K.hw] = '{"carry":{"z":9}}'; B.answer = 'local';
  await B.pair();
  const cloud = px.call({ action: 'state_get', secret: px.P.SYNC_SECRET }).items[K.hw].v;
  ok('12 第二台原本就有不同紀錄：配對時先問，選這台才上傳', B.asked.length === 1 && cloud === '{"carry":{"z":9}}');
}

/* 13 動錢安全：兩台各送一次同一批規則類事件 → R18 依事件 id 只入帳一次（用正式 events.js 產生 id） */
{
  const px = proxy(), A = computer('A', px), B = computer('B', px);
  const lsOf = m => ({ getItem: k => (k in m.mem ? m.mem[k] : null), setItem: (k, v) => m.write(k, String(v)), removeItem: k => { delete m.mem[k]; } });
  const load = m => { const c = { localStorage: lsOf(m), Date, JSON, Math, console }; c.window = c; vm.runInNewContext(EVENTS, c); return c.CMEvents; };
  await A.pair(); await B.pair();
  const EA = load(A);
  for (let s = 1; s <= 5; s++) EA.push({ tool: 'homework', date: '2026-10-09', seat: s, src: 'rule', kind: 'bad', act: '作業未交', rule_n: 4, act_i: 1, coin: -5, level: 1 });
  await A.core.push(); await B.core.pull('open');
  const EB = load(B);
  const ids = packs => packs.flatMap(t => JSON.parse(t.slice(t.indexOf('{'))).events.map(e => e.id));
  const sentA = ids(EA.buildPayloads()), sentB = ids(EB.buildPayloads());   // 兩台都按了送出（B 還沒接到 A 已送出）
  const ledger = new Set([...sentA, ...sentB]);
  ok('13 兩台各送一次同一批扣幣事件：事件 id 相同、只入帳一次', sentA.length === 5 && sentB.length === 5 && ledger.size === 5);
}

let bad = 0;
for (const [name, pass] of checks) { console.log((pass ? '✅ ' : '❌ ') + name); if (!pass) bad++; }
console.log(`總計 ${checks.length} 項／失敗 ${bad} 項`);
process.exit(bad ? 1 : 0);
