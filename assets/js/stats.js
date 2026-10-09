/* 每週統計：每日摘要（stats.v1）的存取與彙整（設計計畫_跨電腦同步與每週統計.md §3・§7・§9）
 *
 * 只存座號與狀態，不存姓名；存在這台電腦的 localStorage（開啟跨電腦同步後另存一份在老師自己的後台），不進版控、不進班網公開 JSON。
 * 「例外」的定義一律＝檢核台結算時會送出的那一筆（與紀錄庫一致，回填與即時資料才能接在同一條線上）：
 *   到校＝遲到｜晨掃＝未達標、無故｜作業＝未交、要訂正（結轉列不重算）｜午餐＝無故｜潔牙＝沒做也沒補做
 *   請假（含免打掃券）不算例外、也不算應到；「未點」比照結算不產生事件＝不算例外。
 *   作業補交完成 → 把原本那一筆例外消掉（§9：補交算做到），明細仍留「補 n」。
 *
 * 資料形狀：
 *   { v:1, term:'YYYY-MM-DD'（本學期第 1 週任一天，算週次用）,
 *     days: { 'YYYY-MM-DD': { src:'live'|'fill', st: { arrive|clean|lunch|teeth: { x:[座號], lv:[座號], su:{座號:次數} },
 *                                                       hw: { x:{座號:[作業名]}, lv:[座號] } } } },
 *     made: { '座號|作業名': '補交日' } }
 *   某站那天沒有鍵＝那天這一站沒做檢核，不算應到（達成率不計）。
 */
(function (global) {
  'use strict';

  var KEY = 'classManager.stats.v1';
  var ORDER = ['arrive', 'clean', 'hw', 'lunch', 'teeth'];
  var NAMES = ['到校簽到', '晨掃工作', '作業', '午餐工作', '潔牙'];

  function blank() { return { v: 1, term: '', days: {}, made: {} }; }
  function norm(db) {
    if (!db || db.v !== 1) return blank();
    if (!db.days) db.days = {};
    if (!db.made) db.made = {};
    return db;
  }
  function load() {
    try { return norm(JSON.parse(localStorage.getItem(KEY) || 'null')); } catch (e) { return blank(); }
  }
  function save(db) {
    try { localStorage.setItem(KEY, JSON.stringify(db)); return true; } catch (e) { return false; }
  }

  /* 檢核台當天的即時摘要：整天覆蓋（最後一次存下的＝當天最終狀態）。
     made＝目前仍成立的補交 { '座號|作業名': 日期 }；unmade＝這次確定不成立的鍵（老師把完成改回去）。 */
  function put(date, st, opt) {
    var db = load();
    opt = opt || {};
    if (opt.term) db.term = opt.term;
    if (st && Object.keys(st).length) db.days[date] = { src: 'live', st: st };
    else if (db.days[date] && db.days[date].src === 'live') delete db.days[date];
    Object.keys(opt.made || {}).forEach(function (k) { db.made[k] = opt.made[k]; });
    (opt.unmade || []).forEach(function (k) { delete db.made[k]; });
    return save(db);
  }

  /* 匯入回填檔：只補「這台沒有即時紀錄」的日子，不蓋掉檢核台自己記的。 */
  function importFill(obj) {
    var src = norm(obj), db = load(), added = 0, kept = 0;
    Object.keys(src.days).forEach(function (d) {
      if (!/^\d{4}-\d\d-\d\d$/.test(d)) return;
      if (db.days[d] && db.days[d].src === 'live') { kept++; return; }
      db.days[d] = { src: 'fill', st: src.days[d].st || {} };
      added++;
    });
    Object.keys(src.made).forEach(function (k) { if (!db.made[k]) db.made[k] = src.made[k]; });
    if (!db.term && src.term) db.term = src.term;
    return { ok: save(db), added: added, kept: kept };
  }

  /* ── 彙整（純函式，Node 也跑得動：scripts/stats-check.mjs）──────────── */
  function pd(s) { var a = s.split('-'); return new Date(Number(a[0]), Number(a[1]) - 1, Number(a[2])); }
  function fd(d) {
    return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
  }
  function monday(s) { var d = pd(s); d.setDate(d.getDate() - ((d.getDay() + 6) % 7)); return fd(d); }
  function has(arr, seat) { return !!arr && arr.indexOf(seat) >= 0; }

  /* 一格＝（日期 × 站 × 座號）。ran＝那天這站有檢核；x＝沒做到且沒補（0／1）；lv＝請假；su＝支援次數。 */
  function cell(db, date, s, seat) {
    var day = db.days[date], o = day && day.st && day.st[ORDER[s]];
    if (!o) return { ran: 0, x: 0, lv: 0, su: 0 };
    var x = 0;
    if (ORDER[s] === 'hw') {
      var notes = (o.x && (o.x[seat] || o.x[String(seat)])) || [];
      x = notes.some(function (n) { return !db.made[seat + '|' + n]; }) ? 1 : 0;
    } else x = has(o.x, seat) ? 1 : 0;
    var lv = has(o.lv, seat) ? 1 : 0;
    return { ran: 1, x: lv ? 0 : x, lv: lv, su: (o.su && Number(o.su[seat] || o.su[String(seat)])) || 0 };
  }

  function model(db, seats) {
    db = norm(db);
    var dates = Object.keys(db.days).sort();
    var termMon = db.term ? monday(db.term) : '';
    var weeks = [], months = [], wi = {}, mi = {};
    dates.forEach(function (d) {
      var m = monday(d), ym = d.slice(0, 7);
      if (wi[m] === undefined) {
        var no = termMon ? Math.round((pd(m) - pd(termMon)) / 6048e5) + 1 : 0;
        var md = Number(m.slice(5, 7)) + '/' + Number(m.slice(8));
        wi[m] = weeks.length;
        weeks.push({ key: m, label: no > 0 ? '第 ' + no + ' 週' : md + ' 那週', short: no > 0 ? String(no) : md, dates: [] });
      }
      weeks[wi[m]].dates.push(d);
      if (mi[ym] === undefined) {
        mi[ym] = months.length;
        months.push({ key: ym, label: Number(ym.slice(5)) + '月', short: Number(ym.slice(5)) + '月', dates: [] });
      }
      months[mi[ym]].dates.push(d);
    });
    /* 補交次數（明細「補 n」）：依補交那天歸期 */
    var madeBy = {};
    Object.keys(db.made).forEach(function (k) {
      var seat = k.slice(0, k.indexOf('|'));
      (madeBy[seat] = madeBy[seat] || []).push(db.made[k]);
    });

    function seatAgg(ds, s, seat) {
      var r = { x: 0, lv: 0, su: 0, ran: 0, made: 0 };
      ds.forEach(function (d) {
        var c = cell(db, d, s, seat);
        r.x += c.x; r.lv += c.lv; r.su += c.su; r.ran += c.ran;
      });
      if (ORDER[s] === 'hw' && ds.length) {
        /* 期間＝該期第一天那週的週一～最後一天那週的週日（期內沒檢核作業的日子補交也歸得到期） */
        var lo = monday(ds[0]), e = pd(monday(ds[ds.length - 1])); e.setDate(e.getDate() + 6);
        var hi = fd(e);
        (madeBy[seat] || []).forEach(function (md) { if (md >= lo && md <= hi) r.made++; });
      }
      return r;
    }
    function stationAgg(ds, s) {
      var exc = 0, den = 0, ranDays = 0, who = [];
      ds.forEach(function (d) { if (cell(db, d, s, seats[0]).ran) ranDays++; });
      seats.forEach(function (seat) {
        var a = seatAgg(ds, s, seat);
        exc += a.x; den += a.ran - a.lv;
        if (a.x) who.push(seat + (a.x > 1 ? '×' + a.x : ''));
      });
      return { exc: exc, den: den, ranDays: ranDays, who: who,
               rate: den > 0 ? 100 * (1 - exc / den) : null };
    }
    return {
      dates: dates, weeks: weeks, months: months, term: db.term,
      fill: dates.filter(function (d) { return db.days[d].src === 'fill'; }),
      seatAgg: seatAgg, stationAgg: stationAgg
    };
  }

  var api = { KEY: KEY, ORDER: ORDER, NAMES: NAMES, load: load, save: save, put: put,
              importFill: importFill, model: model, cell: cell, blank: blank };
  global.CMStats = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
