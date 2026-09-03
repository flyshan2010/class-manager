/* class-manager 共用底層
 *
 * 名單「只有座號」，沒有姓名——投影在教室前方時，座號就足以指認學生，
 * 而少了姓名，這個 public repo 與任何截圖、任何投影畫面都不可能外洩個資。
 * 座號設定存在這台電腦的 localStorage，不進版控、不上傳。
 */
(function (global) {
  'use strict';

  var KEY = 'classManager.seats.v2';
  var LEGACY_KEYS = ['classManager.roster.v1']; // 舊版曾存過姓名，載入時一律清掉

  /* 解析老師輸入的座號設定。支援兩種寫法：
   *   27              → 1 到 27
   *   1-12,14-28      → 逐段展開，可跳過轉學生留下的空號
   * 回傳 { seats, error }；error 不為 null 時 seats 一定是空陣列。
   */
  function parseSeats(text) {
    var raw = String(text || '').trim();
    if (!raw) return { seats: [], error: '請輸入班級人數，或用「1-12,14-28」指定座號。' };

    if (/^\d{1,3}$/.test(raw)) {
      var n = parseInt(raw, 10);
      if (n < 1 || n > 100) return { seats: [], error: '人數請填 1 到 100 之間。' };
      var all = [];
      for (var i = 1; i <= n; i++) all.push(i);
      return { seats: all, error: null };
    }

    var seats = [];
    var seen = {};
    var bad = null;
    raw.split(/[,，、\s]+/).forEach(function (part) {
      if (!part || bad) return;
      var m = part.match(/^(\d{1,3})(?:\s*[-–~至]\s*(\d{1,3}))?$/);
      if (!m) { bad = part; return; }
      var from = parseInt(m[1], 10);
      var to = m[2] === undefined ? from : parseInt(m[2], 10);
      if (from < 1 || to > 100 || from > to) { bad = part; return; }
      for (var s = from; s <= to; s++) {
        if (seen[s]) continue;
        seen[s] = true;
        seats.push(s);
      }
    });

    if (bad) return { seats: [], error: '「' + bad + '」看不懂，請用「27」或「1-12,14-28」的寫法。' };
    if (!seats.length) return { seats: [], error: '沒有讀到任何座號。' };
    seats.sort(function (a, b) { return a - b; });
    return { seats: seats, error: null };
  }

  /* 把座號陣列壓回最短的區間寫法，供輸入框回填：[1..12,14..28] → "1-12,14-28" */
  function toText(seats) {
    if (!seats || !seats.length) return '';
    var parts = [];
    var start = seats[0];
    var prev = seats[0];
    for (var i = 1; i <= seats.length; i++) {
      var cur = seats[i];
      if (cur === prev + 1) { prev = cur; continue; }
      parts.push(start === prev ? String(start) : start + '-' + prev);
      start = prev = cur;
    }
    return parts.join(',');
  }

  function save(seats) {
    try {
      localStorage.setItem(KEY, JSON.stringify({ seats: seats, savedAt: new Date().toISOString() }));
      return true;
    } catch (e) {
      return false;
    }
  }

  function load() {
    try {
      LEGACY_KEYS.forEach(function (k) { localStorage.removeItem(k); });
      var raw = localStorage.getItem(KEY);
      if (!raw) return null;
      var data = JSON.parse(raw);
      if (!data || !Array.isArray(data.seats) || !data.seats.length) return null;
      return data;
    } catch (e) {
      return null;
    }
  }

  function clear() {
    try { localStorage.removeItem(KEY); return true; } catch (e) { return false; }
  }

  /* 各工具頁一律用這支取座號；回 null 時要顯示「請先回工作台設定座號」，不要自己假設人數。 */
  function requireSeats() {
    var data = load();
    return data ? data.seats : null;
  }

  global.ClassManager = {
    KEY: KEY,
    parseSeats: parseSeats,
    toText: toText,
    save: save,
    load: load,
    clear: clear,
    requireSeats: requireSeats
  };
})(window);
