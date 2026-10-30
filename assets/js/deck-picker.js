/* 電子白板「選簡報」（2026-10-31）：老師自己選要開哪份簡報，不限當節進度。
 *
 * 清單＝班網 lessons.json（Board 開頁就讀、有快取）＋下面的 EXTRAS；開啟走 lesson-mode.js 的 CMDeck.open。
 * 「今天」＝每日課程進度當天掛的單元（Board.todayLessons）；「最近」只記在這台電腦，不進跨電腦同步。
 * 開啟前先試連，連不上就留在選單提示，不開空白頁（漸進增強）。
 */
(function () {
  'use strict';
  if (!window.Board || !window.CMDeck) return;
  var $ = function (id) { return document.getElementById(id); };
  var box = $('deck-pick');

  /* 不在 lessons.json 的教材（放公開教材庫 lessons/），新增就加一列 */
  var EXTRAS = [
    { title: '四季臺灣 3D 地圖', sub: '社會・平時卷複習', path: '/lessons/平時卷複習/四季臺灣3D地圖範本.html' },
    { title: '平時卷複習目錄', sub: '三科平時卷總複習入口', path: '/lessons/平時卷複習/index.html' }
  ];
  var STAGES = [['site', '教學'], ['pretest', '前測'], ['differentiated', '練習'], ['review', '複習'], ['exam', '評量']];
  var FILE = /\/(0\.pretest|1\.teach|2\.practice|3\.review|4\.exam)\.html$/;
  var SUBJECTS = ['國語', '數學', '社會'], OTHER = '其他';
  var RECENT_KEY = 'classManager.deckRecent.v1', RECENT_MAX = 5;
  var subj = null, grp = null;

  function esc(s) { return String(s == null ? '' : s).replace(/[<>&"]/g, function (c) { return { '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;' }[c]; }); }
  function code(L) { return String(L.title || '').split(/\s/)[0]; }
  function name(L) { return String(L.title || '').replace(/^\S+\s*/, ''); }
  /* 國L1-2→L1、數R1-3→R1、社1-1→1；對不上就整段當課次，不丟掉 */
  function groupOf(L) { var m = code(L).match(/^[^A-Z0-9]*([A-Z]?\d+)/); return m ? m[1] : code(L); }
  function groupLabel(g) { return /^\d/.test(g) ? '單元' + g : g; }
  function groupSort(a, b) {
    var rank = function (g) { return /^P/.test(g) ? 2 : /^R/.test(g) ? 3 : 1; }, n = function (g) { return parseInt(g.replace(/^\D+/, ''), 10) || 0; };
    return rank(a) - rank(b) || n(a) - n(b);
  }
  function md(d) { var p = String(d || '').split('-'); return p.length === 3 ? (+p[1]) + '/' + (+p[2]) : ''; }
  /* 只開公開教材庫的頁面，其他網域一律不開 */
  function deckPath(s) {
    var u; try { u = new URL(s, location.href); } catch (e) { return ''; }
    if (u.origin !== location.origin && u.hostname !== 'flyshan2010.github.io') return '';
    return FILE.test(u.pathname) && u.pathname.indexOf('/lessons/') === 0 ? u.pathname : '';
  }
  function lessons() { return Board.lessons(); }
  function ofSubject(s) { return lessons().filter(function (L) { return L.subject === s; }); }
  function groups(s) { var o = []; ofSubject(s).forEach(function (L) { var g = groupOf(L); if (o.indexOf(g) < 0) o.push(g); }); return o.sort(groupSort); }
  function todayCodes() { return Board.todayLessons().map(code); }

  function recent() { try { var a = JSON.parse(localStorage.getItem(RECENT_KEY) || '[]'); return Array.isArray(a) ? a : []; } catch (e) { return []; } }
  function remember(path, label) {
    var a = recent().filter(function (x) { return x.path !== path; });
    a.unshift({ path: path, label: label });
    try { localStorage.setItem(RECENT_KEY, JSON.stringify(a.slice(0, RECENT_MAX))); } catch (e) {}
  }

  /* 預設落在現在進度：當節 → 今天第一筆 → 日期最近且已開始的單元 */
  function pickDefault() {
    var i = Board.periodInfo(), unit = i && i.lesson && i.lesson.unit, L = null, list = lessons(), now = Tool.todayKey();
    if (unit) L = list.filter(function (x) { return code(x) === unit; })[0];
    if (!L) L = Board.todayLessons()[0];
    if (!L) list.forEach(function (x) { if (x.date && x.date <= now && (!L || x.date > L.date)) L = x; });
    if (L) { subj = L.subject; grp = groupOf(L); } else { subj = SUBJECTS[0]; grp = null; }
  }

  function paint() {
    var tabs = SUBJECTS.concat(OTHER).map(function (s) {
      return '<button type="button" class="dp-tab' + (s === subj ? ' on' : '') + '" data-s="' + esc(s) + '" data-c="' + SUBJECTS.indexOf(s) + '">' + esc(s) + '</button>';
    }).join('');
    var quick = Board.todayLessons().map(function (L) {
      var p = deckPath(L.links && L.links.site) || deckPath(L.links && L.links.review);
      return p ? '<button type="button" class="dp-q" data-open="' + esc(p) + '" data-label="' + esc(code(L) + ' 教學') + '">' + esc(code(L)) + '</button>' : '';
    }).join('');
    var rec = recent().slice(0, 3).map(function (x) {
      return '<button type="button" class="dp-q rec" data-open="' + esc(x.path) + '" data-label="' + esc(x.label) + '">' + esc(x.label) + '</button>';
    }).join('');
    var isOther = subj === OTHER, left = '', rows = '';
    if (isOther) {
      rows = EXTRAS.map(function (x) {
        return '<div class="dp-row"><div class="dp-rt"><b>' + esc(x.title) + '</b><span>' + esc(x.sub) + '</span></div><div class="dp-acts"><button type="button" class="dp-a main" data-open="' + esc(encodeURI(x.path)) + '" data-label="' + esc(x.title) + '">▶ 開啟</button></div></div>';
      }).join('');
    } else {
      var gs = groups(subj), cur = todayCodes();
      if (gs.indexOf(grp) < 0) grp = gs[0] || null;
      left = gs.map(function (g) {
        var on = ofSubject(subj).some(function (L) { return groupOf(L) === g && cur.indexOf(code(L)) >= 0; });
        return '<button type="button" class="dp-g' + (g === grp ? ' on' : '') + (on ? ' cur' : '') + '" data-g="' + esc(g) + '" data-c="' + SUBJECTS.indexOf(subj) + '">' + esc(groupLabel(g)) + '</button>';
      }).join('');
      rows = ofSubject(subj).filter(function (L) { return groupOf(L) === grp; })
        .sort(function (a, b) { return code(a).localeCompare(code(b), 'zh-Hant', { numeric: true }); })
        .map(function (L) {
          var c = code(L), now = cur.indexOf(c) >= 0, k = 0;
          var acts = STAGES.map(function (s) {
            var p = deckPath(L.links && L.links[s[0]]); if (!p) return '';
            var main = k++ === 0;
            return '<button type="button" class="dp-a' + (main ? ' main' : '') + '" data-open="' + esc(p) + '" data-label="' + esc(c + ' ' + s[1]) + '">' + (main ? '▶ ' : '') + s[1] + '</button>';
          }).join('');
          return '<div class="dp-row' + (now ? ' cur' : '') + '"><div class="dp-rt"><b>' + esc(c) + '</b><span>' + esc(name(L)) + '</span><em>' + (now ? '今天' : esc(md(L.date))) + '</em></div><div class="dp-acts">' + acts + '</div></div>';
        }).join('');
      if (!rows) rows = '<div class="dp-empty">還沒讀到單元清單。請確認網路後重新開一次白板；「其他」仍可使用。</div>';
    }
    box.innerHTML =
      '<div class="dp-top"><b>選簡報</b><span class="dp-tabs">' + tabs + '</span><button type="button" class="dp-close" data-close="1">✕ 關閉</button></div>' +
      '<div class="dp-quick">' + (quick ? '<i>今天</i>' + quick : '') + (rec ? '<i class="dim">最近</i>' + rec : '') + '</div>' +
      '<div class="dp-msg" id="dp-msg" hidden></div>' +
      '<div class="dp-body' + (isOther ? ' wide' : '') + '">' + (isOther ? '' : '<div class="dp-gs">' + left + '</div>') + '<div class="dp-rows">' + rows + '</div></div>';
  }

  function open(path, label) {
    var msg = $('dp-msg');
    fetch(path, { method: 'HEAD', cache: 'no-store' }).then(function (r) {
      if (!r.ok) throw 0;
      remember(path, label);
      box.hidden = true;
      CMDeck.open(path);
    }).catch(function () {
      msg.textContent = '連不上教材庫，這份簡報開不了。請確認網路後再按一次。';
      msg.hidden = false;
    });
  }

  function show() { if (!subj) pickDefault(); paint(); box.hidden = false; }
  box.addEventListener('click', function (e) {
    var b = e.target.closest('button'); if (!b) return;
    if (b.dataset.close) box.hidden = true;
    else if (b.dataset.s) { subj = b.dataset.s; grp = null; var t = Board.todayLessons().filter(function (L) { return L.subject === subj; })[0]; if (t) grp = groupOf(t); paint(); }
    else if (b.dataset.g) { grp = b.dataset.g; paint(); }
    else if (b.dataset.open) open(b.dataset.open, b.dataset.label);
  });
  addEventListener('keydown', function (e) { if (e.key === 'Escape' && !box.hidden) box.hidden = true; });
  ['btn-pick', 'cm-b-pick', 'cap-pick'].forEach(function (id) { var b = $(id); if (b) b.onclick = show; });
})();
