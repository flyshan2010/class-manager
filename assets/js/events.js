/* class-manager 課堂事件佇列（T0 管線・前端側）
 *
 * 設計書：docs/設計計畫_課堂資料採集Phase2.md §3。四條不可違反的規矩：
 *  1. 工具頁只 push／list，**不含任何送出程式碼、不持有口令**（§3.4，投影全班看得到畫面）。
 *  2. 前端不算錢。src:"rule" 的 coin／level 一律原封轉抄 class-rules.json，
 *     由排程 Agent（R18）回讀班規核對後才入帳；src:"tally" 一律不入帳（coin 0）。
 *  3. 事件 id 是防重複鍵，必須「按兩次收班、重送、隔天補送都不會重複發錢」（U44）。
 *     id = 工具-日期-批次-座號-特徵；批次號只在**送出成功後**才往前推，
 *     所以斷網重試會產生同樣的 id（R18 去重），而同一天送第二次是新批次（次數不會互相蓋掉）。
 *  4. 送出成功才清；失敗一律留在本機（§3.2）。
 *
 * payload 只帶座號，永不帶姓名（硬規則 2）。
 */
(function (global) {
  'use strict';

  var KEY = 'classManager.events.v1';   // { pending:[...], batch:{ '2026-09-08':2 } }
  var MAX_TEXT = 1800;                  // 代理 submit_task 上限 2000 字，留 200 字餘裕

  function today() {
    var d = new Date();
    return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') +
           '-' + String(d.getDate()).padStart(2, '0');
  }

  function read() {
    try {
      var raw = localStorage.getItem(KEY);
      var db = raw ? JSON.parse(raw) : null;
      if (!db || !Array.isArray(db.pending)) return { pending: [], batch: {} };
      if (!db.batch) db.batch = {};
      return db;
    } catch (e) { return { pending: [], batch: {} }; }
  }

  function write(db) {
    try { localStorage.setItem(KEY, JSON.stringify(db)); return true; } catch (e) { return false; }
  }

  /* 合併特徵：同一學生×同一天×同一工具×同一類 合併成一列（§3.3）。 */
  function sig(ev) {
    if (ev.src === 'rule') return 'r' + ev.rule_n + '.' + (ev.act_i == null ? 0 : ev.act_i);
    // tally：同科目同行為才合併（「座號N 在○○課舉手回答」）
    return 't' + (ev.subj || '') + '.' + (ev.act || '');
  }

  /* 工具頁呼叫這支累積事件。必填 tool／seat／src／kind／act；
     src:'rule' 另需 rule_n／act_i／coin／level（原封轉抄班規），src:'tally' 不帶錢。 */
  function push(ev) {
    if (!ev || !ev.tool || !ev.seat || !ev.src) return false;
    var db = read();
    var rec = {
      tool: ev.tool, date: ev.date || today(), seat: Number(ev.seat), src: ev.src,
      kind: ev.kind || 'good', act: ev.act || '', at: ev.at || new Date().toTimeString().slice(0, 5)
    };
    ['rule_n', 'act_i', 'coin', 'level', 'period', 'subj', 'note', 'fix'].forEach(function (k) {
      if (ev[k] !== undefined && ev[k] !== '') rec[k] = ev[k];
    });
    db.pending.push(rec);
    return write(db);
  }

  function list() { return read().pending; }
  function count() { return read().pending.length; }

  function clearAll() { var db = read(); db.pending = []; return write(db); }

  /* 刪一筆逐筆原始紀錄（工作台面板的「移除」）。index 取自 list() 的順序。 */
  function removeAt(i) {
    var db = read();
    if (i < 0 || i >= db.pending.length) return false;
    db.pending.splice(i, 1);
    return write(db);
  }

  /* 依 §3.3 合併，回傳「送出用」事件列（含 id、次數）。同時保留 rawIdx 供面板對照。 */
  function merged() {
    var db = read();
    var byKey = {};
    var out = [];
    db.pending.forEach(function (ev, i) {
      var batch = (db.batch[ev.date] || 0) + 1;
      var key = ev.tool + '|' + ev.date + '|' + ev.seat + '|' + sig(ev);
      if (byKey[key]) {
        byKey[key].count += 1;
        byKey[key].rawIdx.push(i);
        return;
      }
      var m = {
        id: ev.tool + '-' + ev.date.replace(/-/g, '') + '-b' + batch + '-s' + ev.seat + '-' + sig(ev),
        tool: ev.tool, date: ev.date, seat: ev.seat, src: ev.src, kind: ev.kind,
        act: ev.act, count: 1, rawIdx: [i]
      };
      ['rule_n', 'act_i', 'coin', 'level', 'period', 'subj', 'note', 'at'].forEach(function (k) {
        if (ev[k] !== undefined) m[k] = ev[k];
      });
      byKey[key] = m;
      out.push(m);
    });
    return out;
  }

  /* 產生要 POST 的任務原文；超過長度就切成多包（part i/n），每包都是完整可解析的 JSON。 */
  function buildPayloads() {
    var rows = merged();
    if (!rows.length) return [];
    var db = read();
    var dates = {};
    rows.forEach(function (r) { dates[r.date] = true; });

    function pack(chunk, part, parts) {
      var body = {
        tool: chunk[0].tool, date: chunk[0].date,
        batch: chunk[0].date.replace(/-/g, '') + '-b' + ((db.batch[chunk[0].date] || 0) + 1),
        part: part, parts: parts,
        events: chunk.map(function (r) {
          var e = {};
          Object.keys(r).forEach(function (k) {
            if (k === 'rawIdx') return;
            if (k === 'tool' || k === 'date') return;   // 外層 envelope 已帶，逐筆不重複（省字數）
            if (k === 'count' && r.count === 1) return;
            e[k] = r[k];
          });
          return e;
        })
      };
      return '#CM-EVENTS v1\n' + JSON.stringify(body);
    }

    // 先切成「同一天同一工具」一組，再依長度切包
    var groups = {};
    rows.forEach(function (r) {
      var g = r.tool + '|' + r.date;
      (groups[g] = groups[g] || []).push(r);
    });

    var payloads = [];
    Object.keys(groups).forEach(function (g) {
      var rest = groups[g].slice();
      var chunks = [];
      while (rest.length) {
        var take = rest.length;
        while (take > 1 && pack(rest.slice(0, take), 1, 1).length > MAX_TEXT) take--;
        chunks.push(rest.slice(0, take));
        rest = rest.slice(take);
      }
      chunks.forEach(function (c, i) { payloads.push(pack(c, i + 1, chunks.length)); });
    });
    return payloads;
  }

  /* 送出全部成功後才呼叫：清空待送、把當天批次號往前推一格。 */
  function markSent() {
    var db = read();
    var dates = {};
    db.pending.forEach(function (ev) { dates[ev.date] = true; });
    Object.keys(dates).forEach(function (d) { db.batch[d] = (db.batch[d] || 0) + 1; });
    db.pending = [];
    return write(db);
  }

  global.CMEvents = {
    KEY: KEY, today: today, push: push, list: list, count: count,
    merged: merged, buildPayloads: buildPayloads, markSent: markSent,
    removeAt: removeAt, clearAll: clearAll
  };
})(window);
