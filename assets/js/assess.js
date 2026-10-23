/* class-manager 全班作答（CG 線 P2b，2026-10-22）
 *
 * 規格：教學簡報/_工具/改版提案_單節課簡報/SPEC_單節課簡報v4.md §4（三站介面約定：§4.3 事件、§4.4 計分）。
 * 電子白板作答面板每「確認本題」一次就存進本機 classManager.assess.v1；
 * 「結束課程」或「收起簡報」時 flush()：clearTool('assess') 後依暫存整批重 push（比照座位板重新結算），
 * 同節後來改題也會正確反映到待送。每生每節 1 筆、金幣 0。
 *
 * ⚠️ 計分正本＝class-website/scripts/classos/lib/cm-events.mjs 的 assessKind（R18／f35 入庫時重算核對，
 *    不一致整筆 E07）。這裡的 kindOf 是前端副本（只給收班預覽顯示、填 kind），三站互不改對方檔案，
 *    比照 HW_PREFIX 兩份各改各的；改門檻先改 SPEC §4.4，兩邊一起改，改完跑 `node scripts/assess-check.mjs`。
 *
 * 只存座號與對錯，不存姓名（硬規則 2）；只在這台電腦（不進跨電腦同步 KEYS）。
 */
(function (global) {
  'use strict';

  var KEY = 'classManager.assess.v1';   // { '2026-10-22': { '國L7-2': { subj, sent, items:{ Q3:{kind,type,src,kp,marks,absent,at,open,sec} } } } }
  var KEEP_DAYS = 7;
  var ORDER = ['Q1', 'Q2', 'Q3', 'Q4', 'Q5', 'C1', 'C2', 'C3'];
  var CODE = { ok: 'O', ng: 'X', na: 'N' };
  var SUBJ = { '國': '國語', '數': '數學', '社': '社會' };
  var LESSON_RE = /^(國|數|社)[LR]\d+-\d+$/;
  var ACT = '課堂作答';
  var LOW = 0.6;                        // 本題答對率（答對÷(答對＋答錯)）低於這個就提示重講（§4.1）

  /* §4.4 計分（與 cm-events.mjs assessKind 同一套；整數比，不用浮點）。
     對＝O 題數，記＝O＋X＋N 題數（未答算分母、不算對，老師裁定 §9-1）。記 ≤ 0 → null（不產事件）。 */
  function kindOf(right, rec) {
    var o = Number(right), n = Number(rec);
    if (!isInt(o) || !isInt(n) || n <= 0 || o < 0 || o > n) return null;
    if (o * 10 >= n * 8) return 'good';
    if (o * 2 <= n) return 'bad';
    return 'neutral';
  }
  function isInt(x) { return typeof x === 'number' && isFinite(x) && Math.floor(x) === x; }

  function subjOf(lesson) { return LESSON_RE.test(String(lesson || '')) ? SUBJ[String(lesson)[0]] : ''; }
  function validLesson(lesson) { return LESSON_RE.test(String(lesson || '')); }
  function validCp(cp) { return ORDER.indexOf(String(cp || '')) >= 0; }

  function today() {
    var d = new Date();
    return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
  }

  /* 保留 7 天：sent:true 且超過 7 天的整天刪除（有任何一節還沒送就整天留著，fail-closed）。 */
  function prune(db) {
    var cut = new Date(); cut.setDate(cut.getDate() - KEEP_DAYS);
    var cutKey = cut.getFullYear() + '-' + String(cut.getMonth() + 1).padStart(2, '0') + '-' + String(cut.getDate()).padStart(2, '0');
    Object.keys(db).forEach(function (d) {
      if (d >= cutKey) return;
      var ls = db[d] || {};
      if (Object.keys(ls).every(function (l) { return ls[l] && ls[l].sent; })) delete db[d];
    });
    return db;
  }
  function read() {
    try { var raw = localStorage.getItem(KEY); var db = raw ? JSON.parse(raw) : {}; return (db && typeof db === 'object') ? db : {}; }
    catch (e) { return {}; }
  }
  function write(db) { try { localStorage.setItem(KEY, JSON.stringify(prune(db))); return true; } catch (e) { return false; } }

  function lessonRec(date, lesson) { var d = read()[date || today()] || {}; return d[lesson] || null; }
  function isSent(date, lesson) { var r = lessonRec(date, lesson); return !!(r && r.sent); }

  /* 確認一題：marks 必須已無未標（呼叫端 fail-closed 擋過；這裡再擋一次）。
     marks＝{ 座號: 'ok'|'ng'|'na' } 明列所有在場座號；absent＝[缺席座號]。已送出的節次一律拒收。 */
  function saveItem(o) {
    var date = o.date || today();
    if (!validLesson(o.lesson) || !validCp(o.cp)) return { ok: false, why: '節次或題號格式不對（' + o.lesson + '／' + o.cp + '）' };
    var db = read(), day = db[date] = db[date] || {};
    var L = day[o.lesson] = day[o.lesson] || { subj: subjOf(o.lesson), sent: false, items: {} };
    if (L.sent) return { ok: false, why: '本節已送出' };
    var marks = {};
    Object.keys(o.marks || {}).forEach(function (s) { if (CODE[o.marks[s]]) marks[String(Number(s))] = o.marks[s]; });
    var seats = (o.seats || []).map(Number), absent = (o.absent || []).map(Number);
    var un = seats.filter(function (s) { return absent.indexOf(s) < 0 && !marks[s]; });
    if (un.length) return { ok: false, why: '還有 ' + un.length + ' 人沒標' };
    L.items[o.cp] = { kind: o.kind || '', type: o.type || '', src: o.src || '', kp: String(o.kp || ''),
      marks: marks, absent: absent.slice().sort(function (a, b) { return a - b; }),
      at: o.at || new Date().toTimeString().slice(0, 5) };
    /* 計時（老師 2026-10-23 裁定，P3 量「小考實際用時」「每題記錄秒數」）：open＝開面板時刻（HH:MM:SS），
       sec＝開面板到按確認的秒數。只存在本機暫存，不進事件包、不進 Notion。同一題重開修改＝以最後一次為準。 */
    if (o.open) L.items[o.cp].open = String(o.open);
    if (typeof o.sec === 'number' && o.sec >= 0) L.items[o.cp].sec = Math.round(o.sec);
    write(db);
    return { ok: true, stat: itemStat(L.items[o.cp]) };
  }

  /* 一題的人數（給簡報 cp-saved／cp-state，只有人數不帶座號）與本題答對率。 */
  function itemStat(it) {
    var s = { ok: 0, ng: 0, na: 0 };
    Object.keys((it && it.marks) || {}).forEach(function (k) { s[it.marks[k]]++; });
    var ans = s.ok + s.ng;
    s.rate = ans ? s.ok / ans : 0;
    s.low = ans > 0 && s.rate < LOW;
    return s;
  }
  function lessonStats(date, lesson) {
    var L = lessonRec(date, lesson), out = {};
    if (!L) return out;
    Object.keys(L.items).forEach(function (cp) { var s = itemStat(L.items[cp]); out[cp] = { ok: s.ok, ng: s.ng, na: s.na }; });
    return out;
  }

  /* 一節 → 每生 1 筆事件（§4.3）。r＝該生在場的已確認題目，依 Q1…Q5、C1…C3 排序；該題缺席不列；
     一題都不在場＝不產事件（缺席不算 0 分）。kp 若含 r 的分隔字元（: ,）就整節不產、回 why（fail-closed）。 */
  function lessonEvents(date, lesson, L) {
    var out = [], why = '';
    if (!L || !validLesson(lesson)) return { events: out, why: '節次格式不對' };
    var cps = ORDER.filter(function (cp) { return L.items[cp]; });
    cps.forEach(function (cp) { if (!L.items[cp].kp || /[:,]/.test(L.items[cp].kp)) why = cp + ' 的知識點不合格式（' + L.items[cp].kp + '）'; });
    if (why) return { events: [], why: why };
    var seatSet = {};
    cps.forEach(function (cp) { Object.keys(L.items[cp].marks).forEach(function (s) { seatSet[s] = 1; }); });
    Object.keys(seatSet).map(Number).sort(function (a, b) { return a - b; }).forEach(function (seat) {
      var segs = [], right = 0;
      cps.forEach(function (cp) {
        var m = L.items[cp].marks[seat];
        if (!m) return;                                   // 該題缺席：不列
        if (m === 'ok') right++;
        segs.push(cp + ':' + L.items[cp].kp + ':' + CODE[m]);
      });
      if (!segs.length) return;
      out.push({ tool: 'assess', date: date, seat: seat, src: 'assess', kind: kindOf(right, segs.length),
        act: ACT, subj: L.subj || subjOf(lesson), lesson: lesson, r: segs.join(','), dedupe: 'day' });
    });
    return { events: out, why: '' };
  }

  /* 依暫存整批重 push（§4.3）：先清掉當天還沒送出的 assess 事件，再把「還沒送出」的節次全部重算一次。
     回傳 { pushed, lessons:[{lesson,n}], skipped:[{lesson,why}] }。 */
  function flush(E, date) {
    date = date || today();
    var res = { pushed: 0, lessons: [], skipped: [] };
    if (!E) return res;
    var day = read()[date] || {};
    E.clearTool('assess', date);
    Object.keys(day).forEach(function (lesson) {
      var L = day[lesson];
      if (!L || L.sent) return;
      var x = lessonEvents(date, lesson, L);
      if (x.why) { res.skipped.push({ lesson: lesson, why: x.why }); return; }
      x.events.forEach(function (ev) { E.push(ev); res.pushed++; });
      if (x.events.length) res.lessons.push({ lesson: lesson, n: x.events.length });
    });
    return res;
  }

  /* 保留期內每一天有還沒送出的節次都重 push（昨天忘了收的不會因為換日就漏掉）。結果併成一份。 */
  function flushAll(E) {
    var db = read(), res = { pushed: 0, lessons: [], skipped: [] };
    Object.keys(db).forEach(function (d) {
      var ls = db[d] || {};
      if (d !== today() && Object.keys(ls).every(function (l) { return ls[l] && ls[l].sent; })) return;
      var r = flush(E, d);
      res.pushed += r.pushed; res.lessons = res.lessons.concat(r.lessons); res.skipped = res.skipped.concat(r.skipped);
    });
    return res;
  }

  /* 送出成功後（CMEvents.markSent）標 sent:true → 該節鎖住（§4.3：id 狀態式，送出後同節再補記會被 f35 略過）。 */
  function markSent(pairs) {
    if (!pairs || !pairs.length) return false;
    var db = read();
    pairs.forEach(function (p) { var L = db[p.date] && db[p.date][p.lesson]; if (L) L.sent = true; });
    return write(db);
  }

  /* 收班預覽一行白話（§4.3）：「📋 課堂作答 國L7-2 · 25 人：正向 14、中性 8、負向 3」。rows＝merged() 的 assess 列。 */
  function previewLines(rows) {
    var by = {}, order = [];
    (rows || []).forEach(function (r) {
      if (r.tool !== 'assess') return;
      var k = r.lesson || '?';
      if (!by[k]) { by[k] = { n: 0, good: 0, neutral: 0, bad: 0 }; order.push(k); }
      by[k].n++; by[k][r.kind] = (by[k][r.kind] || 0) + 1;
    });
    return order.map(function (k) {
      var b = by[k];
      return '📋 課堂作答 ' + k + ' · ' + b.n + ' 人：正向 ' + b.good + '、中性 ' + b.neutral + '、負向 ' + b.bad;
    });
  }

  global.CMAssess = {
    KEY: KEY, ORDER: ORDER, LOW: LOW, ACT: ACT,
    kindOf: kindOf, subjOf: subjOf, validLesson: validLesson, validCp: validCp,
    read: read, lessonRec: lessonRec, isSent: isSent, saveItem: saveItem,
    itemStat: itemStat, lessonStats: lessonStats, lessonEvents: lessonEvents,
    flush: flush, flushAll: flushAll, markSent: markSent, previewLines: previewLines
  };
})(typeof window !== 'undefined' ? window : globalThis);
