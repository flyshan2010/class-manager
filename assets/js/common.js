/* class-manager 共用底層
 * 名單只存在這台電腦的 localStorage，永遠不進 repo、不上傳。
 */
(function (global) {
  'use strict';

  var KEY = 'classManager.roster.v1';

  /* 解析老師貼上的名單。支援：
   *   1 王小明        （座號 空白 姓名）
   *   1.王小明 / 1、王小明 / 1號 王小明
   *   王小明          （沒有座號時，補進最小的空號，不會佔用別人已寫的座號）
   * 回傳 { students, duplicates }；duplicates 是被略過的重複座號，呼叫端要顯示出來，
   * 不可無聲丟掉——名單少一個人在課堂上不會報錯，只會抽不到那位學生。
   */
  function parseRoster(text) {
    var rows = [];
    String(text || '').split(/\r?\n/).forEach(function (raw) {
      var line = raw.trim();
      if (!line) return;
      var m = line.match(/^(\d{1,3})\s*(?:號|\.|、|,|:|：|-)?\s*(.+)$/);
      if (m && m[2].trim()) {
        rows.push({ seat: parseInt(m[1], 10), name: m[2].trim() });
      } else {
        rows.push({ seat: null, name: line });
      }
    });

    // 第一輪：先放有寫座號的，重複的記下來但不丟進名單
    var used = {};
    var students = [];
    var duplicates = [];
    rows.forEach(function (r) {
      if (r.seat === null) return;
      if (used[r.seat]) { duplicates.push(r.seat + ' ' + r.name); return; }
      used[r.seat] = true;
      students.push({ seat: r.seat, name: r.name });
    });

    // 第二輪：沒寫座號的補進最小空號，不會覆蓋上面已占用的號碼
    var next = 1;
    rows.forEach(function (r) {
      if (r.seat !== null) return;
      while (used[next]) next++;
      used[next] = true;
      students.push({ seat: next, name: r.name });
    });

    students.sort(function (a, b) { return a.seat - b.seat; });
    return { students: students, duplicates: duplicates };
  }

  function save(students, className) {
    var payload = {
      className: className || '',
      students: students,
      savedAt: new Date().toISOString()
    };
    try {
      localStorage.setItem(KEY, JSON.stringify(payload));
      return true;
    } catch (e) {
      return false;
    }
  }

  function load() {
    try {
      var raw = localStorage.getItem(KEY);
      if (!raw) return null;
      var data = JSON.parse(raw);
      if (!data || !Array.isArray(data.students) || !data.students.length) return null;
      return data;
    } catch (e) {
      return null;
    }
  }

  function clear() {
    try { localStorage.removeItem(KEY); return true; } catch (e) { return false; }
  }

  /* 各工具頁一律用這支取名單；沒有名單時回 null，由呼叫端顯示「請先回工作台載入名單」。 */
  function requireRoster() {
    return load();
  }

  function toText(data) {
    if (!data) return '';
    return data.students.map(function (s) { return s.seat + ' ' + s.name; }).join('\n');
  }

  global.ClassManager = {
    KEY: KEY,
    parseRoster: parseRoster,
    save: save,
    load: load,
    clear: clear,
    requireRoster: requireRoster,
    toText: toText
  };
})(window);
