/* class-manager 共用底層
 * 名單只存在這台電腦的 localStorage，永遠不進 repo、不上傳。
 */
(function (global) {
  'use strict';

  var KEY = 'classManager.roster.v1';

  /* 解析老師貼上的名單。支援：
   *   1 王小明        （座號 空白 姓名）
   *   1.王小明 / 1、王小明 / 1號 王小明
   *   王小明          （沒有座號時，依行序自動編號）
   */
  function parseRoster(text) {
    var students = [];
    var seen = {};
    String(text || '').split(/\r?\n/).forEach(function (raw) {
      var line = raw.trim();
      if (!line) return;
      var m = line.match(/^(\d{1,3})\s*(?:號|\.|、|,|:|：|-)?\s*(.+)$/);
      var seat, name;
      if (m) {
        seat = parseInt(m[1], 10);
        name = m[2].trim();
      } else {
        seat = students.length + 1;
        name = line;
      }
      if (!name || seen[seat]) return;
      seen[seat] = true;
      students.push({ seat: seat, name: name });
    });
    students.sort(function (a, b) { return a.seat - b.seat; });
    return students;
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
