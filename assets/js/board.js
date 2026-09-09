/* class-manager 電子白板核心（Phase 3-1・2026-09-06）
 *
 * 這支把原本分散的四支工具收進電子白板：抽籤問答（併掉獨立「抽籤」）、小組計分、
 * 座位加分板（設計計畫 2-4），外加「重點板」「白板畫記」「依日課表自動換內容」。
 *
 * 四條不可違反的規矩（承 CLAUDE.md 與設計計畫 §3）：
 *  1. 只用座號，永不寫姓名。
 *  2. 前端不算錢：src:'rule' 的幣值原封轉抄 class-rules.json；src:'tally' 一律金幣 0 只記次數。
 *  3. 本頁只 push 事件到 CMEvents，**不含送出程式碼、不持有口令**（投影時全班看得到畫面）。
 *  4. 漸進增強：先畫上次快取，再非強制 fetch；斷網一律照常可用。
 *
 * 座位計次的制度依據（§6 金幣通膨）：輕點只計次不動錢，結束課程時整節結成
 * 「每生每科每天一筆、次數加總」的 tally；要動錢一律長按開班規選單走 src:'rule'。
 */
(function (global) {
  'use strict';

  var $ = Tool.$;
  var BASE = 'https://flyshan2010.github.io/class-website/data/';
  var TOOL = 'board';

  /* §4.3 上午課堂用得到的班規卡（與 routine.js 同一組，改一邊要改兩邊時以設計計畫為準）。 */
  var CLASS_CARDS = [5, 9, 1, 4, 2, 8, 6, 10];
  /* 「本分」項＝週薪已支付，只記次數不加幣（③打掃 good[0]、⑦幹部職務 good[1]）。 */
  var DUTY_PAID = { '3': [0], '7': [1] };
  var ACS = ['--duty', '--pink', '--blue', '--lime', '--mark', '--purple', '--ok', '--warn'];

  var cache = Tool.store('classManager.board.cache');
  var data = cache.get({ rules: null, lessons: null, ml: null, seating: null });

  var sdb = Tool.store('classManager.board.v1');
  var st = sdb.get(null);
  if (!st || st.date !== Tool.todayKey()) {
    /* 開頁預設＝公布欄（2026-09-07 老師拍板：白板定位是班級電子公布欄）。
       當天切到別的模式會記住，隔天開頁再回到公布欄。 */
    st = { date: Tool.todayKey(), mode: 'wall', seat: {}, quiz: {}, focus: {}, log: (st && st.log) || [], curPeriod: '' };
  }
  /* 一次性遷移：舊資料的今天那筆 mode 還是 auto，補推到 wall（只做一次，之後尊重老師當天的選擇）。 */
  if (!st.wallDefault) { st.wallDefault = 1; st.mode = 'wall'; }
  if (!st.seat) st.seat = {}; if (!st.quiz) st.quiz = {}; if (!st.focus) st.focus = {}; if (!st.log) st.log = [];

  /* 顯示開關（哪些資訊要出現在投影上）——分心來源可以一鍵關掉。 */
  var vdb = Tool.store('classManager.board.view.v1');
  var view = vdb.get(null) || { moon: 1, fest: 1, lunch: 1, duty: 1, sched: 1, clock: 1, rules: 1 };

  var seats = [], sched = null, hooks = {};
  var mode = st.mode || 'wall';
  var pressTimer = null, pressed = false;

  function save() { st.mode = mode; sdb.set(st); }
  function saveView() { vdb.set(view); }
  function esc(s) { return String(s == null ? '' : s).replace(/[<>&]/g, function (c) { return { '<': '&lt;', '>': '&gt;', '&': '&amp;' }[c]; }); }
  function nowMin() { var d = new Date(); return d.getHours() * 60 + d.getMinutes(); }
  function span(text) {
    var m = String(text || '').match(/(\d{1,2})[:：](\d{2})\s*[-–—~～]\s*(\d{1,2})[:：](\d{2})/);
    return m ? { a: +m[1] * 60 + +m[2], b: +m[3] * 60 + +m[4] } : null;
  }
  function steps(sop) {
    return String(sop || '').split(/[➜➔→]/).map(function (x) { return x.replace(/\s+/g, ' ').trim(); }).filter(Boolean);
  }

  /* ── 雲端資料（先快取後更新，失敗安靜略過）────────────────────────── */
  function pull(name, key, pick) {
    return fetch(BASE + name + '?t=' + Date.now(), { cache: 'no-store' })
      .then(function (r) { if (!r.ok) throw 0; return r.json(); })
      .then(function (j) { var v = pick ? pick(j) : j; if (v) { data[key] = v; cache.set(data); render(); } })
      .catch(function () {});
  }
  /* class-rules.json 是物件（cards／daily／flows），班規卡在 cards 底下——
     直接對整包 filter 會丟例外，整個 render 中斷、白板一片空白（第一次實測抓到）。 */
  function cardOf(n) { return (((data.rules && data.rules.cards) || []).filter(function (c) { return Number(c.n) === Number(n); })[0]) || null; }

  /* ── 現在是哪一節、哪個時段 ─────────────────────────────────── */
  function periodNow() {
    if (!sched || !sched.periods || !sched.table) return null;
    var day = new Date().getDay(); if (day === 0 || day === 6) return null;
    var t = nowMin(), hit = null;
    sched.periods.forEach(function (p, i) {
      var s = span(p.time); if (!s || t < s.a || t >= s.b) return;
      var cell = (sched.table[i] || [])[day - 1];
      hit = {
        i: i, name: p.name || '', time: p.time || '',
        subject: cell == null ? '' : String(typeof cell === 'object' ? (cell.subject || '') : cell),
        teacher: (cell && typeof cell === 'object' && cell.teacher) || '',
        a: s.a, b: s.b
      };
    });
    return hit;
  }
  function segNow() {
    var list = (data.rules && data.rules.daily) || [];
    var t = nowMin(), hit = null;
    list.forEach(function (seg) { var s = span(seg.label); if (s && t >= s.a && t < s.b) hit = seg; });
    return hit;
  }
  /* 這一節的識別鍵（座位計次與重點都跟著它走；跨節自動重置）。 */
  function periodKey() {
    var p = periodNow();
    if (p) return p.name + (p.subject ? '·' + p.subject : '');
    var seg = segNow();
    return seg ? seg.name : '課間';
  }
  function isHomeroom() { var p = periodNow(); return !!(p && p.teacher === '導師'); }

  /* ── 自動情境：這個時段該投影什麼 ────────────────────────────── */
  function autoModule() {
    var p = periodNow(), seg = segNow();
    if (p && /節/.test(p.name)) return 'lesson';
    if (p && /早自修|朝會/.test(p.name)) return 'ml';
    if (p && /晨掃/.test(p.name)) return 'sop';
    if (p && /午休/.test(p.name)) return 'sop';
    if (seg && /入班/.test(seg.name)) return 'notes';
    if (seg && /(午餐|潔牙|午休|放學|晨掃)/.test(seg.name)) return 'sop';
    if (seg && /(課堂)/.test(seg.name)) return 'break';   // 在課堂時段但不在任何一節裡＝下課
    return 'notes';                                        // 上學前、放學後：聯絡簿
  }

  /* 今天接下來的第一個時段（公布欄倒數用）。 */
  function nextPeriod() {
    if (!sched || !sched.periods) return null;
    var day = new Date().getDay(); if (day === 0 || day === 6) return null;
    var t = nowMin(), best = null;
    sched.periods.forEach(function (q, i) {
      var s2 = span(q.time); if (!s2 || s2.a <= t) return;
      if (!best || s2.a < best.at) {
        var cell = (sched.table[i] || [])[day - 1];
        best = { at: s2.a, name: q.name || '', time: q.time || '',
                 subject: cell == null ? '' : String(typeof cell === 'object' ? (cell.subject || '') : cell) };
      }
    });
    return best;
  }

  /* 今天這一科的進度重點：老師就地改的優先，其次抓班網 lessons.json 的單元重點。 */
  function lessonOf(subject) {
    if (!subject || !data.lessons) return null;
    var today = Tool.todayKey(), best = null;
    data.lessons.forEach(function (L) {
      if (!L || String(L.subject || '') !== String(subject)) return;
      var a = String(L.date || '').slice(0, 10), b = String(L.dateEnd || L.date || '').slice(0, 10);
      if (!a) return;
      if (today >= a && today <= (b || a)) { if (!best || a > String(best.date || '')) best = L; }
    });
    return best;
  }

  /* ── 主區描繪 ───────────────────────────────────────────── */
  function render() {
    var m = mode === 'auto' ? autoModule() : mode;
    var dyn = $('slot-dyn'), notes = $('notes'), aside = $('slot-rules');
    if (!dyn) return;
    /* 公布欄模式：整頁只留一件事，其餘（課表 chips、模式列、常規側欄）都收起來。 */
    document.body.classList.toggle('wall', mode === 'wall');
    if (mode === 'wall') {
      notes.hidden = true; aside.hidden = true; dyn.hidden = false;
      dyn.className = 'dyn dyn-wall';
      paintWall(dyn); paintModeChips('wall'); paintCaption();
      return;
    }
    var showNotes = (m === 'notes');
    notes.hidden = !showNotes;
    dyn.hidden = showNotes;
    if (showNotes && hooks.onNotes) hooks.onNotes();
    aside.hidden = !(mode === 'auto' && view.rules);
    if (!aside.hidden) paintRules();

    paintModeChips(m);
    if (showNotes) { paintCaption(); return; }
    dyn.className = 'dyn dyn-' + m;
    // 座位／小組／抽問都要座號才成立；沒設定就說清楚，不要自己假設人數（硬規則 2）。
    if (!seats.length && (m === 'seat' || m === 'group' || m === 'quiz')) {
      dyn.innerHTML = '<div class="lesson"><h2>還沒設定班級座號</h2>' +
        '<p class="rnone">這三個功能要用座號指認學生。請先回 <a href="index.html">教師工作台</a> 設定人數，再回來。</p></div>';
      paintCaption(); return;
    }
    if (m === 'lesson') paintLesson(dyn);
    else if (m === 'ml') paintML(dyn);
    else if (m === 'sop') paintSop(dyn);
    else if (m === 'break') paintBreak(dyn);
    else if (m === 'focus') paintFocus(dyn);
    else if (m === 'seat') paintSeat(dyn);
    else if (m === 'group') paintGroup(dyn);
    else if (m === 'quiz') paintQuiz(dyn);
    else dyn.innerHTML = '';
    paintCaption();
  }

  /* ── 公布欄模式：整頁只講一件事（規則正本在 assets/js/wall.js）───────── */
  function paintWall(box) {
    var d = new Date(), dow = (d.getDay() === 0 || d.getDay() === 6) ? 0 : d.getDay();
    var v = (global.Wall ? Wall.view({
      sched: sched, rules: data.rules, lessons: data.lessons, ml: data.ml,
      book: hooks.book ? hooks.book() : null,
      focus: st.focus[periodKey()] || '',
      notice: hooks.notice ? hooks.notice() : ''
    }, nowMin(), dow) : null);
    if (!v) { box.innerHTML = '<div class="wall-main"><div class="wtitle">公布欄</div></div>'; return; }

    var html = '<div class="wall-main">';
    if (v.kick) html += '<div class="wkick">' + esc(v.kick) + '</div>';
    html += '<div class="wtitle' + (v.clock ? ' clock' : '') + '">' + esc(v.title || '') + '</div>';
    if (v.sub) html += '<div class="wsub">' + esc(v.sub) + '</div>';
    if (v.count != null && v.count >= 0) html += '<div class="wcount">還有 ' + v.count + ' 分鐘</div>';
    (v.notice || []).forEach(function (x) { html += '<div class="wnotice">📢 ' + esc(x) + '</div>'; });
    if ((v.list || []).length) {
      html += '<ul class="wlist' + (v.list.length > 2 ? ' small' : '') + (v.mark ? ' mark' : '') + '">';
      v.list.forEach(function (x) { html += '<li>' + esc(x) + '</li>'; });
      html += '</ul>';
    }
    if ((v.hw || []).length) {
      html += '<div class="whw"><span class="wl">今天的回家功課</span>';
      v.hw.forEach(function (x) { html += '<span class="wi">' + esc(x) + '</span>'; });
      html += '</div>';
    }
    html += '</div>';
    if ((v.foot || []).length) {
      html += '<div class="wall-foot">';
      v.foot.forEach(function (x) { html += '<span class="tag">' + esc(x) + '</span>'; });
      html += '</div>';
    }
    box.innerHTML = html;
  }

  function paintCaption() {
    var el = $('board-cap'); if (!el) return;
    var p = periodNow(), seg = segNow();
    var main = p ? (p.name + (p.subject ? '　' + p.subject : '')) : (seg ? seg.name : '課後');
    var extra = mode === 'auto' ? '自動跟著課表' : '手動固定';
    el.innerHTML = '<b>' + esc(main) + '</b><span>' + esc(extra) + '</span>';
  }

  /* 模式選項：七顆 chip 一字排開會把版面右上角吃掉大半（2026-09-09 老師回報
     「右邊的畫面占比過高」），改成一顆「☰ 目前模式」按鈕＋下拉。
     下拉是絕對定位，展開不會把版面推開；點畫面別處自動收起。 */
  var modePopOpen = false;
  function paintModeChips(active) {
    var box = $('mode-chips'); if (!box) return;
    var list = [['wall', '📢 公布欄'], ['auto', '自動'], ['notes', '聯絡簿'], ['focus', '重點板'], ['seat', '座位加分'], ['group', '小組計分'], ['quiz', '抽籤問答']];
    var cur = '';
    list.forEach(function (it) { if (mode === it[0]) cur = it[1]; });
    box.innerHTML = '';

    var tgl = document.createElement('button');
    tgl.type = 'button'; tgl.className = 'mchip mode-toggle';
    tgl.textContent = '☰ ' + (cur || '模式');
    tgl.title = '切換白板模式';

    var pop = document.createElement('div');
    pop.className = 'mode-pop'; pop.hidden = !modePopOpen;
    list.forEach(function (it) {
      var b = document.createElement('button');
      b.type = 'button';
      b.className = 'mchip' + (mode === it[0] ? ' on' : '');
      b.textContent = it[1];
      b.addEventListener('click', function (e) {
        e.stopPropagation(); modePopOpen = false; setMode(it[0]);
      });
      pop.appendChild(b);
    });
    tgl.addEventListener('click', function (e) {
      e.stopPropagation(); modePopOpen = !modePopOpen; pop.hidden = !modePopOpen;
    });
    box.appendChild(tgl); box.appendChild(pop);

    /* 聯絡簿的直式／橫式切換鈕只在聯絡簿模式露出（blackboard.html 掛的行為）。 */
    var nl = $('notes-layout'); if (nl) nl.hidden = (mode !== 'notes');
  }
  document.addEventListener('click', function () {
    if (!modePopOpen) return;
    modePopOpen = false;
    var pop = document.querySelector('.mode-pop'); if (pop) pop.hidden = true;
  });

  /* 常規側欄：文案全部取自 Notion（class-rules.json），不寫死在程式裡。 */
  function paintRules() {
    var seg = segNow(), box = $('slot-rules');
    if (!seg) { box.innerHTML = '<h2>常規</h2><p class="rnone">這個時間沒有對應的常規時段。</p>'; return; }
    var html = '<h2>' + esc(seg.name) + '　<span class="rlabel">' + esc(seg.label) + '</span></h2><ol class="rsop">';
    steps(seg.sop).forEach(function (s) { html += '<li>' + esc(s) + '</li>'; });
    html += '</ol>';
    if (seg.expect) html += '<div class="rexp"><b>做到這樣</b>' + esc(seg.expect) + '</div>';
    box.innerHTML = html;
  }

  function paintLesson(box) {
    var p = periodNow(), subj = p ? p.subject : '';
    var key = periodKey(), own = st.focus[key];
    var L = lessonOf(subj);
    var title = own ? (subj ? subj + ' 本節重點' : '本節重點') : (L ? L.title : (subj ? subj + ' 本節重點' : '本節重點'));
    var lines = own ? String(own).split(/\n+/).filter(Boolean) : ((L && L.points) || []).slice(0, 5);
    var html = '<div class="lesson"><h2>' + esc(title) + '</h2>';
    if (!lines.length) {
      html += '<p class="rnone">這一節還沒有寫重點。按下方「重點板」就可以直接打字，' +
              '或到 Notion 的教學單元填「重點」讓它自動帶入。</p>';
    } else {
      html += '<ul class="lpoints">';
      lines.forEach(function (t) { html += '<li>' + esc(t) + '</li>'; });
      html += '</ul>';
    }
    if (!own && L) html += '<p class="lfrom">來源：教學單元「' + esc(L.title) + '」</p>';
    html += '</div>';
    box.innerHTML = html;
  }

  function paintFocus(box) {
    var key = periodKey(), own = st.focus[key] || '';
    var html = '<div class="lesson"><h2>本節重點　<span class="rlabel">' + esc(key) + '</span></h2>';
    if (!own.trim()) html += '<p class="rnone">按 HUD 的「寫重點」開始打字，寫什麼投影就出什麼。</p>';
    else {
      html += '<ul class="lpoints">';
      own.split(/\n+/).filter(Boolean).forEach(function (t) { html += '<li>' + esc(t) + '</li>'; });
      html += '</ul>';
    }
    html += '</div>';
    box.innerHTML = html;
  }

  function paintSop(box) {
    var seg = segNow();
    if (!seg) { box.innerHTML = '<div class="lesson"><p class="rnone">這個時間沒有對應的時段。</p></div>'; return; }
    var html = '<div class="lesson"><h2>' + esc(seg.name) + '</h2><ul class="lpoints big">';
    steps(seg.sop).forEach(function (s) { html += '<li>' + esc(s) + '</li>'; });
    html += '</ul>';
    if (seg.expect) html += '<p class="lfrom">做到這樣：' + esc(seg.expect) + '</p>';
    box.innerHTML = html + '</div>';
  }

  /* 下課：投影「進教室」流程＋兩張最相關的班規卡（文案同樣來自 Notion）。 */
  function paintBreak(box) {
    var flow = ((data.rules && data.rules.flows) || []).filter(function (f) { return /進教室/.test(f.name || ''); })[0];
    var c1 = cardOf(1), c6 = cardOf(6);
    var html = '<div class="lesson"><h2>下課時間</h2><div class="brules">';
    [c1, c6].forEach(function (c) { if (c) html += '<span class="brule">' + esc(c.rule) + '</span>'; });
    html += '</div>';
    if (flow) {
      html += '<h3 class="bsub">' + esc(flow.label + ' ' + flow.name) + '</h3><ul class="lpoints big">';
      steps(flow.sop).forEach(function (s) { html += '<li>' + esc(s) + '</li>'; });
      html += '</ul>';
      if (flow.redo) html += '<p class="lfrom">沒做到：' + esc(flow.redo) + '</p>';
    }
    box.innerHTML = html + '</div>';
  }

  function paintML(box) {
    var ml = data.ml;
    if (!ml) { box.innerHTML = '<div class="lesson"><h2>Morning Launch</h2><p class="rnone">還讀不到晨間啟動站的內容（連上網後自動帶入）。</p></div>'; return; }
    var dow = new Date().getDay();
    var day = (ml.days || []).filter(function (d) { return Number(d.dow) === dow; })[0];
    var html = '<div class="mlwrap"><h2>' + esc((ml.meta && ml.meta.title) || 'Morning Launch') +
      (day ? '　<span class="rlabel">' + esc((day.emoji || '') + ' ' + (day.theme || '')) + '</span>' : '') + '</h2>';
    var cards = (day && day.cards) || [];
    if (!cards.length) {
      html += '<ul class="lpoints big">';
      (ml.steps || []).forEach(function (s) { html += '<li>' + esc(s.icon + ' ' + s.name + '：' + s.ask) + '</li>'; });
      html += '</ul>';
    } else {
      html += '<div class="mlcards">';
      cards.forEach(function (c) {
        var step = (ml.steps || []).filter(function (s) { return Number(s.no) === Number(c.step); })[0];
        html += '<div class="mlc"><div class="mlh">' + esc((step && step.icon) || '•') + ' ' + esc(c.title || '') + '</div>' +
          '<div class="mlq">' + esc(c.prompt || '') + '</div>';
        if (c.options && c.options.length) {
          html += '<div class="mlo">';
          c.options.forEach(function (o) { html += '<span>' + esc((o.icon || '') + ' ' + (o.label || '')) + '</span>'; });
          html += '</div>';
        }
        html += '</div>';
      });
      html += '</div>';
    }
    box.innerHTML = html + '</div>';
  }

  /* ── 座位加分板（設計計畫 2-4）───────────────────────────────
     輕點＝當節計次（不動錢）；長按＝班規選單（動錢，走 src:'rule'）。
     只有導師課能計次：科任課老師不在場，點了也不會準。 */
  function seatCounts() { var k = periodKey(); return (st.seat[k] = st.seat[k] || {}); }
  function paintSeat(box) {
    var grid = (data.seating && data.seating.grid) || null;
    var rows = grid || chunk(seats, 6);
    var cnt = seatCounts(), home = isHomeroom(), p = periodNow();
    var total = 0; Object.keys(cnt).forEach(function (k) { total += cnt[k]; });
    var html = '<div class="seatwrap"><div class="seathead"><b>' + esc(periodKey()) + '</b>' +
      '<span>' + (home ? '輕點＝記一次發表　·　長按＝班規加減分' : '科任課不計次，長按仍可記班規') + '</span>' +
      '<span class="stot">本節共 ' + total + ' 次</span></div>';
    html += '<div class="seatgrid"><div class="podium">講　台</div>';
    rows.forEach(function (row) {
      html += '<div class="srow">';
      row.forEach(function (s) {
        if (s == null) { html += '<div class="scell gap"></div>'; return; }
        var n = cnt[s] || 0;
        html += '<div class="scell' + (n ? ' hit' : '') + '" data-seat="' + s + '">' + s +
          (n ? '<span class="badge">·' + n + '</span>' : '') + '</div>';
      });
      html += '</div>';
    });
    html += '</div>';
    if (!grid) html += '<p class="lfrom">（還讀不到座位表，暫時依座號排列）</p>';
    box.innerHTML = html + '</div>';
    Array.prototype.forEach.call(box.querySelectorAll('.scell[data-seat]'), function (el) {
      var seat = Number(el.dataset.seat);
      el.addEventListener('pointerdown', function () {
        pressed = false;
        pressTimer = setTimeout(function () { pressed = true; openRules(seat); }, 550);
      });
      el.addEventListener('pointerup', function () {
        clearTimeout(pressTimer);
        if (pressed) { pressed = false; return; }
        tapSeat(seat);
      });
      el.addEventListener('pointerleave', function () { clearTimeout(pressTimer); });
      el.addEventListener('contextmenu', function (e) { e.preventDefault(); openRules(seat); });
    });
  }
  function chunk(arr, n) { var out = []; for (var i = 0; i < arr.length; i += n) out.push(arr.slice(i, i + n)); return out; }

  function tapSeat(seat) {
    if (!isHomeroom()) { hooks.subtitle && hooks.subtitle('科任課不計次', 'say', '這一節不是導師課，只有長按記班規才會留紀錄'); return; }
    var cnt = seatCounts();
    cnt[seat] = (cnt[seat] || 0) + 1;
    save(); Tool.beep(1, 760); render();
  }

  /* ── 班規選單（與 routine.js 同一套判準；幣值一律抄班規）──────────── */
  function openRules(seat) {
    if (!data.rules) { hooks.panel('<h2>座號 ' + seat + '</h2><p class="hint">還讀不到班規（連上網後會自動帶入）。幣值一律抄班規，讀不到就不記。</p>'); return; }
    var html = '<h2>座號 ' + seat + '</h2><p class="hint">點一項就記一筆，並當場投影修復方式。</p>';
    CLASS_CARDS.forEach(function (n) {
      var c = cardOf(n); if (!c) return;
      html += '<h3>' + esc(c.rule) + '</h3>';
      ['good', 'bad'].forEach(function (kind) {
        (c[kind] || []).forEach(function (a, i) {
          if (Number(n) === 1 && (kind === 'good' || String(a.act).indexOf('上課') < 0)) return;
          var paid = kind === 'good' && (DUTY_PAID[String(n)] || []).indexOf(i) >= 0;
          var meta = paid ? '本分・週薪已支付 → 只記次數不加幣'
                          : esc(a.coin) + ' 幣' + (a.fix ? '　·　修復：' + esc(a.fix) : '');
          if (Number(n) === 5 && kind === 'bad' && String(a.act).indexOf('被記') >= 0) {
            meta += '　·　同一行為第 3 次才用（第 1 次改過不扣、第 2 次 −5）';
          }
          html += '<div class="rule ' + kind + '" data-n="' + n + '" data-k="' + kind + '" data-i="' + i + '">' +
            '<div class="ract">' + esc(a.act) + '</div><div class="rmeta">' + meta + '</div></div>';
        });
      });
    });
    hooks.panel(html);
    Array.prototype.forEach.call(document.querySelectorAll('#panel-body .rule'), function (el) {
      el.addEventListener('click', function () { recordRule(seat, Number(el.dataset.n), el.dataset.k, Number(el.dataset.i)); });
    });
  }

  function recordRule(seat, n, kind, i) {
    var c = cardOf(n), a = c && (c[kind] || [])[i];
    if (!a) return;
    if (Math.abs(Number(String(a.coin).replace('−', '-'))) >= 10) {
      if (!confirm('這一項是 ' + a.coin + ' 幣（重手處分）：\n\n座號 ' + seat + ' · ' + a.act + '\n\n確定要記嗎？')) return;
    }
    var p = periodNow(), periodName = periodKey();
    var paid = kind === 'good' && (DUTY_PAID[String(n)] || []).indexOf(i) >= 0;
    if (paid) {
      CMEvents.push({ tool: TOOL, date: st.date, seat: seat, src: 'tally', dedupe: 'day',
        kind: 'good', act: a.act, period: periodName, subj: (p && p.subject) || '' });
      Tool.beep(2, 720); hooks.closePanel();
      flashFix(seat + ' 號 · ' + c.rule + '－' + a.act, '這是本分，週薪已經在付了，所以只記錄不加幣', '');
      render(); return;
    }
    var note = '';
    if (String(a.act).indexOf('遲到') >= 0) {
      var m = prompt('遲到幾分鐘？（下課靜坐同樣分鐘數；直接按確定＝不記分鐘）', '');
      if (m === null) return;
      m = String(m).replace(/[^0-9]/g, '');
      if (m) note = '遲到 ' + m + ' 分鐘';
    }
    CMEvents.push({ tool: TOOL, date: st.date, seat: seat, src: 'rule',
      rule_n: n, kind: kind, act_i: i, act: a.act, coin: a.coin, level: a.level,
      period: periodName, subj: (p && p.subject) || '', note: note });
    Tool.beep(kind === 'good' ? 2 : 1, kind === 'good' ? 720 : 460);
    hooks.closePanel();
    flashFix(seat + ' 號 · ' + c.rule + '－' + a.act + (note ? '（' + note + '）' : ''),
             a.fix || (kind === 'good' ? '記下來了，繼續保持' : ''), a.coin);
    render();
  }

  function flashFix(who, fix, coin) {
    var bar = $('fixbar'); if (!bar) return;
    bar.innerHTML = '<div class="who">' + esc(who) + (coin ? '<span class="coin">' + esc(coin) + ' 幣</span>' : '') + '</div>' +
      (fix ? '<div class="fix">' + esc(fix) + '</div>' : '');
    bar.classList.add('show');
    clearTimeout(flashFix._t);
    flashFix._t = setTimeout(function () { bar.classList.remove('show'); }, 9000);
  }

  /* ── 小組計分（沿用原 groups.html 的設定與分數，換頁不會歸零）──────── */
  var gdb = Tool.store('classManager.groups.v1');
  var gst = gdb.get(null);
  function splitSeats(n, mode2, manual) {
    var groups = [];
    if (mode2 === 'manual') {
      String(manual || '').split(/\n+/).forEach(function (line) {
        var ss = line.split(/[^0-9]+/).filter(Boolean).map(Number).filter(function (x) { return seats.indexOf(x) >= 0; });
        if (ss.length) groups.push(ss);
      });
      if (groups.length) return groups;
      mode2 = 'serial';
    }
    for (var i = 0; i < n; i++) groups.push([]);
    if (mode2 === 'snake') {
      var dir = 1, g = 0;
      seats.forEach(function (s) {
        groups[g].push(s);
        if (dir > 0 && g === n - 1) dir = -1; else if (dir < 0 && g === 0) dir = 1; else g += dir;
      });
    } else {
      var per = Math.ceil(seats.length / n);
      seats.forEach(function (s, i2) { groups[Math.min(n - 1, Math.floor(i2 / per))].push(s); });
    }
    return groups.filter(function (x) { return x.length; });
  }
  function ensureGroups(rebuild, keepScores) {
    if (!gst || !gst.config) gst = { config: { n: 4, mode: 'serial', manual: '', names: '' }, groups: null };
    if (!gst.groups || rebuild) {
      var sets = splitSeats(gst.config.n, gst.config.mode, gst.config.manual);
      var names = String(gst.config.names || '').split(/\n+/).map(function (s) { return s.trim(); });
      var old = {};
      if (keepScores && gst.groups) gst.groups.forEach(function (g, i) { old[i] = g.score; });
      gst.groups = sets.map(function (ss, i) {
        return { name: names[i] || ('第 ' + (i + 1) + ' 組'), seats: ss, score: keepScores ? (old[i] || 0) : 0 };
      });
      gdb.set(gst);
    }
    return gst;
  }
  function paintGroup(box) {
    ensureGroups(false, true);
    var top = Math.max.apply(null, gst.groups.map(function (g) { return g.score; }));
    var html = '<div class="gcards">';
    gst.groups.forEach(function (g, i) {
      var lead = g.score === top && g.score !== 0;
      html += '<div class="gcard' + (lead ? ' lead' : '') + '" style="--ac:var(' + ACS[i % ACS.length] + ')">' +
        '<div class="gname">' + (lead ? '👑 ' : '') + esc(g.name) + '</div>' +
        '<div class="gmem">座號 ' + g.seats.join('、') + '</div>' +
        '<div class="gscore">' + g.score + '</div>' +
        '<div class="gbtns"><button type="button" data-i="' + i + '" data-d="-1">−1</button>' +
        '<button type="button" data-i="' + i + '" data-d="1">＋1</button>' +
        '<button type="button" data-i="' + i + '" data-d="5">＋5</button></div></div>';
    });
    box.innerHTML = html + '</div>';
    Array.prototype.forEach.call(box.querySelectorAll('.gbtns button'), function (b) {
      b.addEventListener('click', function () {
        var i = +b.dataset.i, d = +b.dataset.d;
        gst.groups[i].score = Math.max(-99, gst.groups[i].score + d);
        gdb.set(gst); Tool.beep(1, d > 0 ? 720 : 320); render();
      });
    });
  }

  /* ── 抽籤問答（併掉原本的獨立「抽籤」：抽人本身就是抽籤）─────────── */
  function quizState() {
    var k = periodKey();
    return (st.quiz[k] = st.quiz[k] || { stats: {}, last: null, current: null });
  }
  var rolling = false;
  function paintQuiz(box) {
    var q = quizState();
    var arr = seats.map(function (n) { var s = q.stats[n] || { c: 0, w: 0 }; return { n: n, c: s.c, w: s.w }; })
      .filter(function (x) { return x.c || x.w; }).sort(function (a, b) { return b.c - a.c || a.n - b.n; });
    var html = '<div class="quizwrap"><div class="qmain">' +
      '<div class="qnum' + (q.current == null ? ' idle' : '') + '" id="qnum">' + (q.current == null ? '按「抽一位」' : q.current) + '</div>' +
      '<div class="qans"' + (q.current == null ? ' hidden' : '') + '>' +
      '<button type="button" class="yes" id="q-yes">答對 ✓</button>' +
      '<button type="button" class="no" id="q-no">答錯 ✗</button></div></div>' +
      '<div class="qboard"><h3>本節記分（答對次數）</h3><div class="qrows">';
    if (!arr.length) html += '<p class="rnone">還沒有紀錄。抽一位、答對或答錯就會累積。<br>下課按「結束課程」才送進待送。</p>';
    else arr.forEach(function (x) {
      html += '<div class="qrk"><span class="s">' + x.n + '</span><span class="c">✓ ' + x.c + '</span>' +
        (x.w ? '<span class="w">✗' + x.w + '</span>' : '') + '</div>';
    });
    box.innerHTML = html + '</div></div></div>';
    var y = $('q-yes'), n2 = $('q-no');
    if (y) y.addEventListener('click', function () { markQuiz(true); });
    if (n2) n2.addEventListener('click', function () { markQuiz(false); });
  }
  function drawQuiz() {
    if (rolling || !seats.length) return;
    if (mode !== 'quiz') setMode('quiz');
    var q = quizState();
    rolling = true;
    function stat(n) { return q.stats[n] || (q.stats[n] = { c: 0, w: 0, d: 0 }); }
    var minD = Math.min.apply(null, seats.map(function (n) { return stat(n).d; }));
    var pool = seats.filter(function (n) { return stat(n).d === minD; });
    if (pool.length === 1 && seats.length > 1 && pool[0] === q.last) {
      pool = seats.filter(function (n) { return stat(n).d <= minD + 1; });
    }
    var ticks = 0, max = 12 + Math.floor(Math.random() * 5);
    var el = $('qnum');
    var iv = setInterval(function () {
      if (el) { el.textContent = seats[Math.floor(Math.random() * seats.length)]; el.className = 'qnum rolling'; }
      Tool.beep(1, 900);
      if (++ticks >= max) {
        clearInterval(iv);
        var pick = pool[Math.floor(Math.random() * pool.length)];
        stat(pick).d++; q.last = pick; q.current = pick; save();
        rolling = false; Tool.beep(2, 680); render();
        // 重畫之後再寫一次抽中的號碼：滾動中的灰字與重畫有機會擦身而過，
        // 學生會看到「停在灰色」以為還沒抽完（實測抓到）。
        var done = $('qnum'); if (done) { done.textContent = pick; done.className = 'qnum'; }
      }
    }, 70);
  }
  function markQuiz(ok) {
    var q = quizState();
    if (q.current == null) return;
    var s = q.stats[q.current] || (q.stats[q.current] = { c: 0, w: 0, d: 0 });
    if (ok) { s.c++; Tool.beep(2, 760); } else { s.w++; Tool.beep(1, 300); }
    q.current = null; save(); render();
  }

  /* ── 結束課程：把這一節的計次結成事件（金幣 0，只記次數）＋留一筆活動紀錄 ── */
  function settle(key, silent) {
    var cnt = st.seat[key] || {}, q = (st.quiz[key] || { stats: {} }).stats || {};
    var subj = '', p = periodNow();
    if (p && key.indexOf(p.name) === 0) subj = p.subject || '';
    if (!subj) { var mm = key.split('·'); subj = mm[1] || ''; }
    var pushed = 0, seatTotal = 0, qc = 0, qw = 0;
    Object.keys(cnt).forEach(function (seat) {
      var n = cnt[seat]; seatTotal += n;
      for (var i = 0; i < n; i++) {
        CMEvents.push({ tool: TOOL, date: st.date, seat: Number(seat), src: 'tally',
          kind: 'good', act: '舉手回答', subj: subj, period: key });
        pushed++;
      }
    });
    Object.keys(q).forEach(function (seat) {
      var s = q[seat] || {}; qc += s.c || 0; qw += s.w || 0;
      for (var i = 0; i < (s.c || 0); i++) {
        CMEvents.push({ tool: TOOL, date: st.date, seat: Number(seat), src: 'tally',
          kind: 'good', act: '抽問答對', subj: subj, period: key });
        pushed++;
      }
      for (var j = 0; j < (s.w || 0); j++) {
        CMEvents.push({ tool: TOOL, date: st.date, seat: Number(seat), src: 'tally',
          kind: 'bad', act: '抽問答錯', subj: subj, period: key });
        pushed++;
      }
    });
    if (seatTotal || qc || qw || (st.focus[key] || '').trim()) {
      st.log.unshift({ date: st.date, at: new Date().toTimeString().slice(0, 5), period: key, subj: subj,
        seatTotal: seatTotal, seats: cnt, quizC: qc, quizW: qw, focus: st.focus[key] || '' });
      st.log = st.log.slice(0, 60);
    }
    delete st.seat[key]; delete st.quiz[key];
    save(); render();
    if (!silent) {
      hooks.subtitle && hooks.subtitle('這一節結束', 'say',
        pushed ? ('已把 ' + pushed + ' 筆課堂紀錄放進待送　·　下課回工作台按「收班送出」')
               : '這一節沒有要送出的紀錄');
    }
    return pushed;
  }
  function endPeriod() {
    var key = periodKey();
    var cnt = st.seat[key] || {}, q = (st.quiz[key] || { stats: {} }).stats || {};
    if (!Object.keys(cnt).length && !Object.keys(q).length) {
      hooks.subtitle && hooks.subtitle('這一節沒有紀錄', 'say', '沒有計次也沒有抽問，不必結算');
      return;
    }
    if (!confirm('結束「' + key + '」並把紀錄放進待送嗎？\n\n（只記次數不加減幣；要動錢的班規在長按時就已經記過了）')) return;
    settle(key, false);
  }

  /* 老師忘了按「結束課程」就換節：自動結算上一節，紀錄不會被下一節洗掉。 */
  function watchPeriod() {
    var k = periodKey();
    if (st.curPeriod && st.curPeriod !== k) {
      var prev = st.curPeriod;
      var cnt = st.seat[prev] || {}, q = (st.quiz[prev] || { stats: {} }).stats || {};
      if (Object.keys(cnt).length || Object.keys(q).length) settle(prev, true);
    }
    if (st.curPeriod !== k) { st.curPeriod = k; save(); render(); }
  }

  /* ── 顯示開關 ─────────────────────────────────────────── */
  function applyView() {
    var map = { moon: 'moon', fest: 'fest', lunch: 'lunch', duty: 'duty-wrap', sched: 'sched', clock: 'clock' };
    Object.keys(map).forEach(function (k) {
      var el = $(map[k]); if (!el) return;
      el.style.display = view[k] ? '' : 'none';
    });
    var aside = $('slot-rules'); if (aside) aside.hidden = !(mode === 'auto' && view.rules);
    Object.keys(view).forEach(function (k) {
      var cb = $('vw-' + k); if (cb) cb.checked = !!view[k];
    });
    var b = $('btn-quiet'); if (b) b.classList.toggle('on', isQuiet());
  }
  function isQuiet() { return !view.moon && !view.fest && !view.lunch && !view.duty && !view.sched; }
  function toggleQuiet() {
    var quiet = isQuiet(), v = quiet ? 1 : 0;
    view.moon = view.fest = view.lunch = view.duty = view.sched = v;
    saveView(); applyView(); render();
    hooks.onResize && hooks.onResize();
  }
  function setViewFlag(k, on) { view[k] = on ? 1 : 0; saveView(); applyView(); render(); hooks.onResize && hooks.onResize(); }

  /* ── 白板畫記（覆蓋在主區上的一層 canvas）───────────────────── */
  var dr = { on: false, drawing: false, color: '#f4f6fb', size: 6, erase: false };
  function canvasEl() { return $('doodle'); }
  function fitCanvas() {
    var c = canvasEl(); if (!c) return;
    var box = $('board-main'); if (!box) return;
    var w = box.clientWidth, h = box.clientHeight;
    if (!w || !h) return;
    var img = null;
    try { if (c.width && c.height) img = c.toDataURL(); } catch (e) {}
    c.width = w; c.height = h;
    if (img) { var im = new Image(); im.onload = function () { c.getContext('2d').drawImage(im, 0, 0); }; im.src = img; }
  }
  function drawStart(e) {
    if (!dr.on) return;
    dr.drawing = true; var c = canvasEl(), r = c.getBoundingClientRect(), ctx = c.getContext('2d');
    ctx.beginPath(); ctx.moveTo(e.clientX - r.left, e.clientY - r.top);
    c.setPointerCapture && c.setPointerCapture(e.pointerId);
  }
  function drawMove(e) {
    if (!dr.on || !dr.drawing) return;
    var c = canvasEl(), r = c.getBoundingClientRect(), ctx = c.getContext('2d');
    ctx.lineCap = ctx.lineJoin = 'round';
    ctx.globalCompositeOperation = dr.erase ? 'destination-out' : 'source-over';
    ctx.strokeStyle = dr.color; ctx.lineWidth = dr.erase ? dr.size * 4 : dr.size;
    ctx.lineTo(e.clientX - r.left, e.clientY - r.top); ctx.stroke();
  }
  function drawEnd() { dr.drawing = false; }
  function setDraw(on) {
    dr.on = on;
    var c = canvasEl(); if (c) c.classList.toggle('on', on);
    var bar = $('drawbar'); if (bar) bar.hidden = !on;
    var b = $('btn-draw'); if (b) b.classList.toggle('on', on);
    var say = $('saybar'); if (on && say) say.hidden = true;   /* 兩條浮動列一次只開一條，不再互相蓋住 */
    if (on) fitCanvas();
    hooks.onDraw && hooks.onDraw(on);                          /* 進畫記自動收起底部 HUD，畫下緣不會誤按 */
  }
  function clearDraw() { var c = canvasEl(); if (c) c.getContext('2d').clearRect(0, 0, c.width, c.height); }

  /* ── 對外 ─────────────────────────────────────────────── */
  function setMode(m) { mode = m; save(); render(); }

  function init(opts) {
    seats = opts.seats || [];
    hooks = opts.hooks || {};
    applyView();
    render();
    pull('class-rules.json', 'rules');
    pull('lessons.json', 'lessons');
    pull('morning-launch.json', 'ml');
    pull('seating-seats.json', 'seating');
    setInterval(watchPeriod, 5000);
    setInterval(function () { if (mode === 'wall') render(); }, 20000);   /* 公布欄：倒數與時段自動更新 */
    watchPeriod();
    var c = canvasEl();
    if (c) {
      c.addEventListener('pointerdown', drawStart);
      c.addEventListener('pointermove', drawMove);
      c.addEventListener('pointerup', drawEnd);
      c.addEventListener('pointerleave', drawEnd);
    }
    window.addEventListener('resize', function () { fitCanvas(); });
  }

  global.Board = {
    init: init, setMode: setMode, mode: function () { return mode; }, render: render,
    setSchedule: function (d) { sched = d; render(); },
    focusText: function (v) {
      var k = periodKey();
      if (v === undefined) return st.focus[k] || '';
      st.focus[k] = v; save(); render(); return v;
    },
    focusKey: periodKey,
    lessonPoints: function () {
      var p = periodNow(), L = p ? lessonOf(p.subject) : null;
      return L ? { title: L.title, points: (L.points || []).slice(0, 6) } : null;
    },
    drawQuiz: drawQuiz, endPeriod: endPeriod, log: function () { return st.log; },
    setDraw: setDraw, isDraw: function () { return dr.on; }, clearDraw: clearDraw,
    setPen: function (color, size, erase) { dr.color = color || dr.color; dr.size = size || dr.size; dr.erase = !!erase; },
    toggleQuiet: toggleQuiet, setViewFlag: setViewFlag, view: view,
    groupsConfig: function (cfg) {
      if (cfg) { gst = gst || { config: {}, groups: null }; gst.config = cfg; ensureGroups(true, true); render(); }
      return (gst && gst.config) || { n: 4, mode: 'serial', manual: '', names: '' };
    },
    groupsReset: function () { ensureGroups(false, true); gst.groups.forEach(function (g) { g.score = 0; }); gdb.set(gst); render(); }
  };
})(window);
