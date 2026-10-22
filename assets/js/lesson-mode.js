/* 電子白板「上課模式」（CG 線 P2b，2026-10-22）
 *
 * 畫面正本＝教學簡報/_工具/改版提案_單節課簡報/電子白板範本_上課模式.html（九輪定版），照範本移植；
 * 規格＝同資料夾 SPEC_單節課簡報v4.md §3.3（訊息協定 v1）、§4（全班作答）、§7（上課模式）。
 *
 *  1. 導師課的上課節次自動進上課模式（body.cm-focus）；下課、午餐、晨間維持原版面。
 *  2. 「▶ 開本節簡報」：讀「📅 每日課程進度」當節掛的單元 → lessons.json 的教學網站（1.teach.html），讀不到不顯示。預設滿版。
 *  3. 全班作答面板：簡報按「📋 記錄本題」→ 點格循環、其餘全對、fail-closed、缺席來自晨間報到；確認後立刻收起。
 *     暫存 classManager.assess.v1（assets/js/assess.js）；結束課程／收起簡報／換節時整批重 push 進待送。
 *  4. 浮動工具（工具列、畫記、加分板、作答面板、計時卡）：拖曳、貼齊、收成圓鈕，「已收起」記在 body class。
 *
 * 訊息協定 v1（§3.3）：雙方都驗 e.origin === location.origin；送出一律以 location.origin 當 targetOrigin。
 * **白板→簡報只送人數（cp-saved／cp-state），不送座號**——簡報是公開頁，不經手任何學生層資料。
 */
(function () {
  'use strict';
  if (!window.Board || !window.CMAssess || !window.CMEvents) return;
  var A = window.CMAssess;
  var body = document.body;
  var $ = function (id) { return document.getElementById(id); };
  var wrap = $('deck-wrap'), frame = $('deck-frame');

  function today() { return CMEvents.today(); }
  function esc(s) { return String(s == null ? '' : s).replace(/[<>&]/g, function (c) { return { '<': '&lt;', '>': '&gt;', '&': '&amp;' }[c]; }); }

  /* ── 0. 上課模式開關（每秒對一次課表）──────────────────────────── */
  var offKey = null, lastKey = null, deckLesson = null;
  function inLesson(i) { return !!(i.p && /節/.test(i.p.name) && i.home); }
  function tick() {
    var i = Board.periodInfo();
    if (lastKey !== null && lastKey !== i.key) onPeriodChange();
    lastKey = i.key;
    var on = inLesson(i);
    body.classList.toggle('cm-lesson', on);
    body.classList.toggle('cm-focus', on && offKey !== i.key);
    syncStrip(i);
    addButton(i);
    if (body.classList.contains('cm-seat')) seatPaint();
  }
  /* 老師忘了按「結束課程」就換節：作答照樣整批放進待送（同 Board 的 watchPeriod 自動結算），加分板的復原紀錄歸零。 */
  function onPeriodChange() { flush(); hist = []; offKey = null; }

  /* 頂部細條：這一節、下一節、時鐘（直接讀課表，不刮畫面文字） */
  function hhmm(m) { return ('0' + Math.floor(m / 60)).slice(-2) + ':' + ('0' + (m % 60)).slice(-2); }
  function syncStrip(i) {
    $('cm-subj').textContent = i.p ? (i.p.subject || '') : '';
    $('cm-period').textContent = i.p ? (i.p.name + ' ' + i.p.time) : '';
    $('cm-next').textContent = i.next ? ('下一節 ' + hhmm(i.next.at) + '　' + i.next.name + (i.next.subject ? '　' + i.next.subject : '')) : '';
    var d = new Date(); $('cm-clk').textContent = ('0' + d.getHours()).slice(-2) + ':' + ('0' + d.getMinutes()).slice(-2);
    /* 本節重點收成一顆小膠囊，要講時再展開 */
    var list = document.querySelector('#slot-dyn .wlist') || document.querySelector('#slot-dyn .lpoints');
    if (list && !document.querySelector('#slot-dyn .cm-pts')) {
      var b = document.createElement('button'); b.type = 'button'; b.className = 'cm-pts';
      var label = function () { return list.classList.contains('cm-open') ? '📌 收起重點 ▴' : '📌 本節重點 ' + list.children.length + ' 條 ▾'; };
      b.textContent = label();
      b.onclick = function () { list.classList.toggle('cm-open'); b.textContent = label(); };
      list.parentNode.insertBefore(b, list);
    }
  }

  /* ── 1. 「▶ 開本節簡報」────────────────────────────────────── */
  /* 教學網站要和白板同源才能互傳訊息：正式站兩者都在 flyshan2010.github.io，用路徑開（本機預覽也就走同源）。
     只認 1.teach.html；其他網域、其他檔名一律不顯示按鈕（駕駛艙連結當備援）。 */
  function deckUrl(i) {
    var s = i && i.lesson && i.lesson.site; if (!s) return '';
    var u; try { u = new URL(s, location.href); } catch (e) { return ''; }
    if (!/\/1\.teach\.html$/.test(u.pathname)) return '';
    if (u.origin !== location.origin && u.hostname !== 'flyshan2010.github.io') return '';
    return u.pathname;
  }
  function addButton(i) {
    var url = inLesson(i) ? deckUrl(i) : '';
    var box = document.querySelector('#slot-dyn .wall-main') || document.querySelector('#slot-dyn .lesson');
    var old = document.querySelector('#slot-dyn .od-wrap');
    if (!url || !box) { if (old) old.remove(); return; }
    if (old && old.dataset.url === url) return;
    if (old) old.remove();
    var w = document.createElement('div'); w.className = 'od-wrap'; w.dataset.url = url;
    w.innerHTML = '<button type="button" class="od-btn">▶ 開本節簡報</button>' +
      '<span class="od-sub">' + esc((i.lesson.title || i.lesson.unit || '').split(/\s/)[0]) + '</span>';
    box.appendChild(w);
    w.querySelector('.od-btn').addEventListener('click', function () { openDeck(url); });
  }
  new MutationObserver(function () { addButton(Board.periodInfo()); }).observe($('slot-dyn'), { childList: true });

  /* ── 2. 簡報嵌在白板中間（預設滿版）──────────────────────────── */
  function place() {
    if (wrap.classList.contains('full')) { wrap.style.cssText = ''; return; }
    var m = $('board-main').getBoundingClientRect();
    wrap.style.left = m.left + 'px'; wrap.style.top = m.top + 'px';
    wrap.style.width = m.width + 'px'; wrap.style.height = m.height + 'px';
  }
  function openDeck(url) {
    if (frame.dataset.src !== url) { deckLesson = null; frame.dataset.src = url; frame.src = url; }
    capPaint();
    wrap.classList.add('on', 'full'); $('cap-full').textContent = '⊡ 回白板版面'; place(); frame.focus();
  }
  addEventListener('resize', place);
  $('cap-close').onclick = function () {
    wrap.classList.remove('on', 'rec', 'full');
    $('cap-full').textContent = '⛶ 簡報滿版';
    var r = flush(), L = deckLesson && A.lessonRec(today(), deckLesson), n = L ? Object.keys(L.items).length : 0;
    if (r.skipped.length) toast('⚠ ' + r.skipped.map(function (x) { return x.lesson + '：' + x.why; }).join('；') + '——這一節沒有放進待送');
    else if (n) toast('本節 ' + n + ' 題作答已加入「今日待送」——下課照常收班送出');
  };
  $('cap-full').onclick = function () {
    wrap.classList.toggle('full');
    this.textContent = wrap.classList.contains('full') ? '⊡ 回白板版面' : '⛶ 簡報滿版';
    place();
  };

  /* ── 3. 訊息協定 v1（§3.3）──────────────────────────────────── */
  function post(msg) { try { frame.contentWindow.postMessage(msg, location.origin); } catch (e) {} }
  addEventListener('message', function (e) {
    if (e.origin !== location.origin || e.source !== frame.contentWindow) return;
    var d = e.data;
    if (!d || typeof d !== 'object' || d.v !== 1) return;
    if (d.type === 'deck-ready') {
      deckLesson = A.validLesson(d.lesson) ? d.lesson : null;
      if (deckLesson) post({ type: 'cp-state', v: 1, saved: A.lessonStats(today(), deckLesson) });   // 重新整理不丟小考結果
      capPaint();
    } else if (d.type === 'slide-change') {
      clearInk();
    } else if (d.type === 'cp-open') {
      openCp(d);
    }
  });

  /* ── 4. 全班作答面板（§4.1）──────────────────────────────────── */
  var cur = null, marks = {}, absent = {}, lastLong = 0, lastLongSeat = null, locked = false;
  function seatsAll() { return Board.seats(); }
  /* 當天面板內的出缺席異動（PROPOSAL §2.7：中途到校「當天之後各題都視為在場」；中途離開同理，回來再點一下恢復）。
     只影響作答記錄，不回寫晨間報到；換日自動作廢。 */
  var PKEY = 'classManager.assess.presence.v1';
  function presence() {
    try { var p = JSON.parse(localStorage.getItem(PKEY) || 'null'); if (p && p.date === today()) return p; } catch (e) {}
    return { date: today(), in: [], out: [] };
  }
  function markPresence(s, here) {
    var p = presence(), n = Number(s);
    p.in = p.in.filter(function (x) { return x !== n; }); p.out = p.out.filter(function (x) { return x !== n; });
    (here ? p.in : p.out).push(n);
    try { localStorage.setItem(PKEY, JSON.stringify(p)); } catch (e) {}
  }
  function defaultAbsent() {
    var p = presence(), a = {};
    Board.leaveToday().forEach(function (s) { a[s] = 1; });
    p.out.forEach(function (s) { a[s] = 1; });
    p.in.forEach(function (s) { delete a[s]; });
    return a;
  }
  function openCp(d) {
    var m = (d.meta && typeof d.meta === 'object') ? d.meta : d;   // 平放（協定 v1）為主；包在 meta 裡也收
    var lesson = m.lesson || deckLesson;
    if (!A.validLesson(lesson) || !A.validCp(m.cp)) { toast('讀不到這一題的節次或題號（' + esc(lesson) + '／' + esc(m.cp) + '），不記錄'); return; }
    if (!seatsAll().length) { toast('請先回工作台設定座號'); return; }
    cur = { lesson: lesson, cp: m.cp, kind: m.kind || '', type: m.qtype || (m !== d ? m.type : '') || '', src: m.src || '', kp: m.kp || '' };
    locked = A.isSent(today(), lesson);
    var L = A.lessonRec(today(), lesson), it = L && L.items[cur.cp];
    marks = {}; absent = {};
    if (it) {                                                 // 同一題重開：帶回上次確認的結果，確認後覆蓋
      Object.keys(it.marks).forEach(function (s) { marks[s] = it.marks[s]; });
      it.absent.forEach(function (s) { absent[s] = 1; });
    } else {
      absent = defaultAbsent();   // 預設缺席＝晨間報到請假名單，再套用今天面板裡的中途到校／離開
    }
    wrap.classList.add('rec');
    body.classList.remove('cm-seat'); $('cm-b-seat').classList.remove('on');
    if (isMin('cp-panel')) setTimeout(function () { restore('cp-panel'); }, 0);
    draw();
  }
  function stat() {
    var ok = 0, ans = 0, un = 0;
    seatsAll().forEach(function (s) { if (absent[s]) return; var v = marks[s];
      if (!v) un++; else if (v === 'ok') { ok++; ans++; } else if (v === 'ng') ans++; });
    return { ok: ok, ans: ans, un: un, rate: ans ? ok / ans : 0 };
  }
  function setAbsent(s) { lastLong = Date.now(); lastLongSeat = s; absent[s] = 1; delete marks[s]; markPresence(s, false); draw(); }
  function draw() {
    var panel = $('cp-panel');
    $('cp-title').textContent = cur.cp + ' ' + cur.type;
    panel.classList.toggle('locked', locked);
    $('cp-arrive').hidden = Board.arriveDone();               // 沒做晨間報到：不擅自當全員到
    var box = $('cp-seats'); box.innerHTML = '';
    seatsAll().forEach(function (s) {
      var b = document.createElement('button'); b.type = 'button'; b.className = 'seat';
      var v = marks[s];
      b.textContent = s;                                       // 只用顏色區分，不在格子裡疊記號（老師 10/21）
      if (absent[s]) { b.classList.add('absent'); b.title = '缺席（點一下＝已到校，可以標記）'; }
      else { if (v) b.classList.add(v); b.title = '長按＝改成缺席'; }
      /* 長按（或右鍵）＝改成缺席：本來到校、中途請假或離校的同學（老師 10/21）；不列入統計，只影響作答記錄 */
      var lp = null, longed = false;
      b.addEventListener('pointerdown', function () {
        longed = false;
        lp = setTimeout(function () { longed = true; setAbsent(s); }, 550);
      });
      ['pointerup', 'pointerleave', 'pointercancel'].forEach(function (t) { b.addEventListener(t, function () { clearTimeout(lp); }); });
      b.addEventListener('contextmenu', function (e) { e.preventDefault(); setAbsent(s); });
      b.onclick = function () {
        if (longed || (lastLongSeat === s && Date.now() - lastLong < 800)) { longed = false; return; }   // 長按放開時同一格不要再算一次點擊（只擋同一格，別格照常）
        if (absent[s]) { delete absent[s]; markPresence(s, true); draw(); return; }   // 缺席的同學中途到校：點一下就改成在場，之後各題沿用
        /* 點一下的循環：未標 → 答錯 → 未答 → 答對 → 答錯…（三種狀態都點得到，老師 10/21） */
        var NEXT = { ng: 'na', na: 'ok', ok: 'ng' };
        marks[s] = marks[s] ? NEXT[marks[s]] : 'ng';
        draw();
      };
      box.appendChild(b);
    });
    var st = stat(), cnt = { ok: 0, ng: 0, na: 0 };
    seatsAll().forEach(function (s) { if (!absent[s] && marks[s]) cnt[marks[s]]++; });
    /* 統計行兼圖例：色塊＝格子的顏色 */
    $('cp-stat').innerHTML =
      '<span class="lg ok"></span>答對 ' + cnt.ok + '　<span class="lg ng"></span>答錯 ' + cnt.ng +
      '　<span class="lg na"></span>未答 ' + cnt.na + (st.un ? '　<span class="lg un"></span>未標 ' + st.un : '');
    $('cp-msg').textContent = locked ? '本節已送出，不能再改——要補請到紀錄庫手改' : '';
  }
  $('cp-rest').onclick = function () {
    if (locked) return;
    seatsAll().forEach(function (s) { if (!absent[s] && !marks[s]) marks[s] = 'ok'; }); draw();
  };
  $('cp-cancel').onclick = function () { wrap.classList.remove('rec'); };
  $('cp-save').onclick = function () {
    if (locked) { $('cp-msg').textContent = '本節已送出，不能再改——要補請到紀錄庫手改'; return; }
    var st = stat();
    if (st.un > 0) { $('cp-msg').textContent = '還有 ' + st.un + ' 人沒確認——標完錯的人後按「其餘全對」'; return; }   // fail-closed（U41）
    if (!cur.kp || /[:,]/.test(cur.kp)) { $('cp-msg').textContent = '這一題沒有知識點（簡報少了 data-cp-kp），不能記錄'; return; }
    var present = {};
    seatsAll().forEach(function (s) { if (!absent[s]) present[s] = marks[s]; });
    var res = A.saveItem({ date: today(), lesson: cur.lesson, cp: cur.cp, kind: cur.kind, type: cur.type, src: cur.src, kp: cur.kp,
      marks: present, seats: seatsAll(), absent: Object.keys(absent).map(Number).filter(function (s) { return seatsAll().indexOf(s) >= 0; }) });
    if (!res.ok) { $('cp-msg').textContent = res.why; return; }
    post({ type: 'cp-saved', v: 1, cp: cur.cp, ok: res.stat.ok, ng: res.stat.ng, na: res.stat.na });   // 只送人數
    wrap.classList.remove('rec');                              // 確認後立刻收起，不在投影上留誰對誰錯
    marks = {}; absent = {};
    $('cp-seats').innerHTML = '';
    capPaint(cur.cp, res.stat);
    frame.focus();
  };
  /* 膠囊：「📋 已記 N 題・Q3 答對率 45%　⚠ 建議重講」（此率＝答對÷(答對＋答錯)，教學決策用，§9-1） */
  function capPaint(cp, s) {
    var cap = $('cap-count'), L = deckLesson && A.lessonRec(today(), deckLesson), n = L ? Object.keys(L.items).length : 0;
    var sent = !!(L && L.sent);
    cap.textContent = sent ? '📋 本節已送出' : ('📋 已記 ' + n + ' 題' + (cp ? '・' + cp + ' 答對率 ' + Math.round(s.rate * 100) + '%' + (s.low ? '　⚠ 建議重講' : '') : ''));
    cap.classList.toggle('warn', !!(cp && s.low));
  }

  /* 依暫存整批重 push（§4.3）。回傳 CMAssess.flush 的結果。 */
  function flush() { return A.flushAll(CMEvents); }

  /* ── 5. 底部工具列 ─────────────────────────────────────────── */
  /* 簡報開著時，底部工具列不擋簡報的上一步／下一步 */
  new MutationObserver(function () { body.classList.toggle('cm-deck', wrap.classList.contains('on')); })
    .observe(wrap, { attributes: true, attributeFilter: ['class'] });

  $('cm-b-timer').onclick = function (e) {
    e.stopPropagation();                                       // 擋冒泡：不然 document 的點擊會把剛打開的計時設定窗又關掉
    if (isMin('timer')) { restore('timer'); return; }
    var pop = $('timer-pop'), r = $('cm-dock').getBoundingClientRect();
    $('btn-timer').click();                                    // 沿用白板原本的計時設定窗
    if (pop.hidden) return;
    /* 放在工具列旁邊、不超出畫面：工具列直排（貼左右側）就放側邊，橫排就放上方 */
    pop.style.transform = 'none'; pop.style.bottom = 'auto';
    var pw = pop.offsetWidth, ph = pop.offsetHeight, x, y;
    if ($('cm-dock').classList.contains('v')) {
      x = r.left > innerWidth / 2 ? r.left - pw - 12 : r.right + 12; y = r.top;
    } else {
      x = r.left + r.width / 2 - pw / 2; y = r.top - ph - 12; if (y < 12) y = r.bottom + 12;
    }
    pop.style.left = Math.max(12, Math.min(x, innerWidth - pw - 12)) + 'px';
    pop.style.top = Math.max(12, Math.min(y, innerHeight - ph - 12)) + 'px';
  };
  /* 結束課程：先把作答整批放進待送，再走白板原本的結束課程（座位計次、抽問、小組分結算） */
  $('cm-b-end').onclick = function () { var r = flush(); Board.endPeriod(r.pushed); };
  /* 原版面的 HUD「結束課程」也要先收作答（捕獲階段先跑，Board.endPeriod 照舊） */
  $('btn-end').addEventListener('click', function () { flush(); }, true);
  $('cm-b-more').onclick = function (e) {
    var m = $('cm-more'), r = e.currentTarget.getBoundingClientRect();
    m.classList.toggle('show'); m.style.left = Math.max(8, r.left - 60) + 'px'; m.style.bottom = (innerHeight - r.top + 8) + 'px';
  };
  [].forEach.call(document.querySelectorAll('#cm-more [data-click]'), function (b) {
    b.onclick = function () { $('cm-more').classList.remove('show'); var t = $(b.dataset.click); t && t.click(); };
  });
  /* 切回原版面（只限這一節；換節自動恢復）／回上課模式 */
  $('cm-off').onclick = function () { $('cm-more').classList.remove('show'); offKey = Board.periodInfo().key; tick(); dispatchEvent(new Event('resize')); };
  $('cm-toggle').onclick = function () { offKey = null; tick(); dispatchEvent(new Event('resize')); };

  /* ── 6. 畫記：一層全畫面畫布（簡報開著也畫得上去）；每一筆存成物件，才能復原、縮放後重畫 ── */
  var cv = $('cm-canvas'), ctx = cv.getContext('2d');
  var COLORS = ['#ff4d4d', '#f4f6fb', '#ffd84d', '#4da3ff'], ci = 0;   // 預設紅：深色白板、淺色簡報都看得到
  var tool = 'off', items = [], ink = null;
  function fit() { cv.width = innerWidth; cv.height = innerHeight; redraw(); }
  function drawItem(it) {
    ctx.save(); ctx.strokeStyle = ctx.fillStyle = it.c; ctx.lineCap = 'round'; ctx.lineJoin = 'round';
    ctx.lineWidth = it.t === 'hl' ? 26 : 5; if (it.t === 'hl') ctx.globalAlpha = .38;
    ctx.beginPath();
    if (it.t === 'pen' || it.t === 'hl') { it.p.forEach(function (q, k) { k ? ctx.lineTo(q[0], q[1]) : ctx.moveTo(q[0], q[1]); }); ctx.stroke(); }
    else if (it.t === 'line' || it.t === 'arrow') {
      ctx.moveTo(it.x0, it.y0); ctx.lineTo(it.x1, it.y1); ctx.stroke();
      if (it.t === 'arrow') { var a = Math.atan2(it.y1 - it.y0, it.x1 - it.x0), L = 22; ctx.beginPath();
        ctx.moveTo(it.x1, it.y1); ctx.lineTo(it.x1 - L * Math.cos(a - .45), it.y1 - L * Math.sin(a - .45));
        ctx.moveTo(it.x1, it.y1); ctx.lineTo(it.x1 - L * Math.cos(a + .45), it.y1 - L * Math.sin(a + .45)); ctx.stroke(); }
    }
    else if (it.t === 'rect') ctx.strokeRect(Math.min(it.x0, it.x1), Math.min(it.y0, it.y1), Math.abs(it.x1 - it.x0), Math.abs(it.y1 - it.y0));
    else if (it.t === 'ellipse') { ctx.ellipse((it.x0 + it.x1) / 2, (it.y0 + it.y1) / 2, Math.abs(it.x1 - it.x0) / 2 || 1, Math.abs(it.y1 - it.y0) / 2 || 1, 0, 0, Math.PI * 2); ctx.stroke(); }
    else if (it.t === 'text') { ctx.font = '700 34px system-ui, sans-serif'; ctx.textBaseline = 'top'; ctx.fillText(it.s, it.x0, it.y0); }
    ctx.restore();
  }
  function redraw() { ctx.clearRect(0, 0, cv.width, cv.height); items.forEach(drawItem); if (ink) drawItem(ink); }
  /* 簡報換頁就清掉畫記（沒開簡報時保留） */
  function clearInk() { items = []; ink = null; redraw(); }
  addEventListener('resize', fit); fit();
  function setTool(t) {
    tool = t;
    cv.classList.toggle('live', t !== 'off');
    cv.style.cursor = t === 'text' ? 'text' : '';
    [].forEach.call(document.querySelectorAll('#cm-draw [data-t]'), function (b) { b.classList.toggle('on', b.dataset.t === t); });
  }
  function paintDot() { $('cm-color-dot').style.background = COLORS[ci]; }
  paintDot();
  function openDraw(on) {
    $('cm-draw').classList.toggle('show', on); $('cm-b-draw').classList.toggle('on', on); setTool(on ? 'pen' : 'off');
  }
  [].forEach.call(document.querySelectorAll('#cm-draw [data-t]'), function (b) {
    b.onclick = function () {
      var t = b.dataset.t;
      if (t === 'color') { ci = (ci + 1) % COLORS.length; paintDot(); return; }
      if (t === 'undo') { items.pop(); redraw(); return; }
      if (t === 'clear') { clearInk(); return; }
      if (t === 'close') { openDraw(false); return; }
      setTool(t);
    };
  });
  function addText(x, y) {
    var inp = document.createElement('input'); inp.className = 'cm-text-in';
    inp.style.left = x + 'px'; inp.style.top = y + 'px'; inp.style.color = COLORS[ci];
    document.body.appendChild(inp); setTimeout(function () { inp.focus(); }, 0);
    var done = false;
    function commit() { if (done) return; done = true; if (inp.value.trim()) { items.push({ t: 'text', c: COLORS[ci], x0: x, y0: y, s: inp.value.trim() }); redraw(); } inp.remove(); }
    inp.addEventListener('keydown', function (e) { if (e.key === 'Enter') commit(); if (e.key === 'Escape') { done = true; inp.remove(); } e.stopPropagation(); });
    inp.addEventListener('blur', commit);
  }
  cv.addEventListener('pointerdown', function (e) {
    if (tool === 'off') return;
    if (tool === 'text') { e.preventDefault(); addText(e.clientX, e.clientY); return; }
    try { cv.setPointerCapture(e.pointerId); } catch (x) {}
    var c = tool === 'hl' ? '#ffd84d' : COLORS[ci];
    ink = (tool === 'pen' || tool === 'hl') ? { t: tool, c: c, p: [[e.clientX, e.clientY]] }
        : { t: tool, c: c, x0: e.clientX, y0: e.clientY, x1: e.clientX, y1: e.clientY };
  });
  cv.addEventListener('pointermove', function (e) {
    if (!ink) return;
    if (ink.p) ink.p.push([e.clientX, e.clientY]); else { ink.x1 = e.clientX; ink.y1 = e.clientY; }
    redraw();
  });
  addEventListener('pointerup', function () { if (ink) { items.push(ink); ink = null; redraw(); } });

  /* ── 7. 加分板：沿用白板既有的座位加分（輕點＝當節發表計次、長按＝班規選單；計幣規則不變）── */
  var hist = [], gridSig = '', pressT = null, pressed = false;
  function seatPaint() {
    var grid = Board.seatGrid(), sig = JSON.stringify(grid);
    if (sig !== gridSig) {
      gridSig = sig;
      var g = $('cm-seat-grid'); g.innerHTML = '';
      if (!grid.length) g.innerHTML = '<span class="hint">請先回工作台設定座號</span>';
      grid.forEach(function (row) {
        var r = document.createElement('div'); r.className = 'row';
        (row || []).forEach(function (s) {
          var b = document.createElement('button'); b.type = 'button'; b.className = 'sc';
          if (s == null) { b.classList.add('gap'); r.appendChild(b); return; }
          b.dataset.s = s; r.appendChild(b);
          b.addEventListener('pointerdown', function () { pressed = false; pressT = setTimeout(function () { pressed = true; Board.openRules(Number(s)); }, 550); });
          b.addEventListener('pointerup', function () { clearTimeout(pressT); if (pressed) return; tap(Number(s)); });
          b.addEventListener('pointerleave', function () { clearTimeout(pressT); });
          b.addEventListener('contextmenu', function (e) { e.preventDefault(); Board.openRules(Number(s)); });
        });
        g.appendChild(r);
      });
    }
    var cnt = Board.seatCounts(), tot = 0;
    [].forEach.call(document.querySelectorAll('#cm-seat .sc[data-s]'), function (b) {
      var n = cnt[b.dataset.s] || 0; tot += n;
      b.classList.toggle('hit', n > 0);
      b.innerHTML = '<span class="num">' + b.dataset.s + '</span><span class="n">' + (n ? n : '') + '</span>';
    });
    $('cm-seat-tot').textContent = '本節 ' + tot + ' 次';
  }
  function tap(s) { if (!Board.tapSeat(s)) return; hist.push(s); seatPaint(); toast('座號 ' + s + ' 發表 +1'); }
  $('cm-seat-undo').onclick = function () {
    var s = hist.pop(); if (s == null) return;
    if (Board.untapSeat(s)) toast('已復原：座號 ' + s + ' −1');
    seatPaint();
  };
  function seatOpen(on) {
    body.classList.toggle('cm-seat', on); $('cm-b-seat').classList.toggle('on', on);
    if (on) { wrap.classList.remove('rec'); seatPaint(); }   // 與作答面板同一個位置：互斥
  }
  $('cm-seat-x').onclick = function () { seatOpen(false); hideBub('cm-seat'); };
  var tt2;
  function toast(t) { var el = $('cm-toast'); el.textContent = t; el.style.display = 'block'; clearTimeout(tt2); tt2 = setTimeout(function () { el.style.display = 'none'; }, t.length > 20 ? 5000 : 1200); }

  /* 作答面板打開時收起加分板（兩個面板同一個位置）；簡報滿版時頂部細條讓位 */
  new MutationObserver(function () {
    body.classList.toggle('cm-deckfull', wrap.classList.contains('on') && wrap.classList.contains('full'));
    if (wrap.classList.contains('rec')) { body.classList.remove('cm-seat'); $('cm-b-seat').classList.remove('on'); }
  }).observe(wrap, { attributes: true, attributeFilter: ['class'] });

  /* ── 8. 浮動工具：抓把手拖曳、放開時靠近四邊（48px 內）自動貼齊；貼左右兩側的工具列自動轉直排。
     每個浮動視窗都能按「–」收成小圓鈕（圓鈕也能拖、也會貼齊，點一下展開）。位置記在該台電腦。 ── */
  var POS_KEY = 'cm-float-pos-v2', pos = {}, M = 12, SNAP = 48;
  try { pos = JSON.parse(localStorage.getItem(POS_KEY) || '{}') || {}; } catch (e) { pos = {}; }
  function savePos() { try { localStorage.setItem(POS_KEY, JSON.stringify(pos)); } catch (e) {} }
  var VERT = { 'cm-dock': 1, 'cm-draw': 1 };                 // 這兩條貼左右側時轉直排
  function topMin() { return getComputedStyle($('cm-strip')).display === 'none' ? M : 56 + M; }
  function placeEl(el, x, y) {
    var w = el.offsetWidth || 52, h = el.offsetHeight || 52;
    x = Math.max(M, Math.min(x, innerWidth - w - M)); y = Math.max(topMin(), Math.min(y, innerHeight - h - M));
    el.style.left = x + 'px'; el.style.top = y + 'px'; el.style.right = 'auto'; el.style.bottom = 'auto'; el.style.transform = 'none';
    return [x, y];
  }
  function snap(el) {
    var r = el.getBoundingClientRect(), x = r.left, y = r.top, side = '';
    if (r.left < SNAP) { x = M; side = 'L'; } else if (innerWidth - r.right < SNAP) { x = innerWidth; side = 'R'; }
    if (r.top < topMin() + SNAP) y = topMin(); else if (innerHeight - r.bottom < SNAP) y = innerHeight;
    if (VERT[el.id]) {
      var wasV = el.classList.contains('v');
      el.classList.toggle('v', side !== '');
      if (wasV !== el.classList.contains('v') && side === '') { y = r.top; }   // 轉回橫排：保留高度位置
    }
    el.classList.add('snapping');
    var xy = placeEl(el, x, y); setTimeout(function () { el.classList.remove('snapping'); }, 200);
    pos[el.id] = [xy[0], xy[1], el.classList.contains('v') ? 1 : 0]; savePos();
  }
  function applyPos(el) {
    var q = pos[el.id]; if (!q) return;
    if (VERT[el.id]) el.classList.toggle('v', !!q[2]);
    placeEl(el, q[0], q[1]);
  }
  function draggable(el, handle, onClick) {
    var sx, sy, ox, oy, moved = false, on = false;
    handle.style.cursor = 'grab'; handle.style.touchAction = 'none';
    handle.addEventListener('pointerdown', function (e) {
      var btn = e.target.closest('button'); if (btn && btn !== handle) return;   // 把手裡的按鈕照常點
      var r = el.getBoundingClientRect(); sx = e.clientX; sy = e.clientY; ox = r.left; oy = r.top; moved = false; on = true;
      try { handle.setPointerCapture(e.pointerId); } catch (x) {}
    });
    handle.addEventListener('pointermove', function (e) {
      if (!on) return;
      var dx = e.clientX - sx, dy = e.clientY - sy;
      if (!moved && Math.abs(dx) + Math.abs(dy) < 5) return;
      moved = true; placeEl(el, ox + dx, oy + dy);
    });
    handle.addEventListener('pointerup', function () { if (!on) return; on = false; if (moved) snap(el); else if (onClick) onClick(); });
    applyPos(el);
  }

  /* 收成小圓鈕 */
  var BUB = { 'cm-dock': '🧰', 'cm-draw': '✏️', 'cm-seat': '🪑', 'cp-panel': '📋', 'timer': '⏱' }, bubs = {};
  Object.keys(BUB).forEach(function (id) {
    var b = document.createElement('button'); b.type = 'button'; b.className = 'cm-bub'; b.id = id + '-bub';
    b.innerHTML = BUB[id] + '<span class="badge"></span>'; b.title = '點一下展開；可拖曳';
    document.body.appendChild(b); bubs[id] = b;
    draggable(b, b, function () { restore(id); });
  });
  /* 「已收起」記在 body（cm-min--<id>），不記在元件本身：白板原本的計時程式會重設 #timer 的 class，
     記在元件上會被洗掉，造成計時卡和圓鈕同時出現（老師 10/21 回報；範本第六輪）。 */
  function isMin(id) { return body.classList.contains('cm-min--' + id); }
  function setMin(id, on) { body.classList.toggle('cm-min--' + id, on); }
  function badge(id) {
    var t = '';
    if (id === 'cm-seat') t = ($('cm-seat-tot').textContent.match(/\d+/) || [''])[0];
    if (id === 'cp-panel') t = ($('cp-title').textContent.split(' ')[0] || '');
    if (id === 'timer') t = $('timer-t').textContent;
    bubs[id].querySelector('.badge').textContent = t === '0' ? '' : t;
  }
  function minimize(id) {
    var el = $(id), r = el.getBoundingClientRect(), b = bubs[id];
    if (id === 'cm-draw') setTool('off');                      // 收起時畫面恢復可點，畫記保留
    setMin(id, true); b.classList.add('show'); badge(id);
    var x = r.right > innerWidth - SNAP ? innerWidth : r.left;  // 原本貼右側就收到右側
    placeEl(b, x, r.top); snap(b);
  }
  function restore(id) {
    var el = $(id), b = bubs[id], r = b.getBoundingClientRect();
    b.classList.remove('show'); setMin(id, false);
    if (id === 'cm-draw') setTool('pen');
    placeEl(el, r.right > innerWidth - SNAP ? innerWidth : r.left, r.top); snap(el);
  }
  function hideBub(id) { bubs[id].classList.remove('show'); setMin(id, false); }
  $('cm-b-min').onclick = function () { minimize('cm-dock'); };
  $('cm-draw-min').onclick = function () { minimize('cm-draw'); };
  $('cm-seat-min').onclick = function () { minimize('cm-seat'); };
  $('cp-min').onclick = function () { minimize('cp-panel'); };
  /* 從工具列再按一次加分／畫記：若已收成圓鈕就展開，不是關掉 */
  $('cm-b-seat').onclick = function () { if (isMin('cm-seat')) return restore('cm-seat'); seatOpen(!body.classList.contains('cm-seat')); };
  $('cm-b-draw').onclick = function () { if (isMin('cm-draw')) return restore('cm-draw'); openDraw(!$('cm-draw').classList.contains('show')); };
  setInterval(function () {
    if (isMin('cm-seat')) badge('cm-seat');
    var tm = $('timer');
    if (tm.classList.contains('idle')) { hideBub('timer'); return; }          // 計時結束：圓鈕一起收掉
    if (isMin('timer')) { if (tm.classList.contains('over')) restore('timer'); else badge('timer'); }   // 時間到自動展開給全班看
  }, 500);
  /* 計時卡：加「–」收成圓鈕，卡片本身可拖曳 */
  (function () {
    var b = document.createElement('button'); b.type = 'button'; b.className = 'cm-minbtn'; b.id = 'cm-timer-min'; b.title = '收成小圓鈕'; b.textContent = '–';
    $('timer').querySelector('.tbtns').appendChild(b);
    b.addEventListener('click', function (e) { e.stopPropagation(); minimize('timer'); });
  })();
  new MutationObserver(function () { if (!wrap.classList.contains('rec')) hideBub('cp-panel'); })
    .observe(wrap, { attributes: true, attributeFilter: ['class'] });

  draggable($('cm-dock'), $('cm-dock').querySelector('.grip'));
  draggable($('cm-draw'), $('cm-draw').querySelector('.grip'));
  draggable($('cm-seat'), $('cm-seat').querySelector('h3'));
  draggable($('cp-panel'), $('cp-panel').querySelector('h3'));
  draggable($('timer'), $('timer').querySelector('.tcard'));
  $('cm-reset-pos').onclick = function () {
    $('cm-more').classList.remove('show'); pos = {}; savePos();
    ['cm-dock', 'cm-draw', 'cm-seat', 'cp-panel', 'timer'].forEach(function (id) {
      var el = $(id); el.classList.remove('v'); el.style.left = el.style.top = el.style.right = el.style.bottom = el.style.transform = '';
    });
  };
  addEventListener('resize', function () { Object.keys(BUB).forEach(function (id) { applyPos($(id)); applyPos(bubs[id]); }); });

  setInterval(tick, 1000); tick();
})();
