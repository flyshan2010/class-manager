/* class-manager 投影工具共用底層 —— 抽籤／計時／抽籤問答／作業播放表／小組計分共用。
   只做每支工具都要的雜事：座號守門、HUD 自動隱藏、全螢幕、提示音、localStorage、日期。
   個別工具的邏輯不寫在這裡。零外部相依、斷網可用。 */
(function (global) {
  'use strict';

  function $(id) { return document.getElementById(id); }

  function todayKey(d) {
    d = d || new Date();
    return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') +
           '-' + String(d.getDate()).padStart(2, '0');
  }

  /* 取座號；沒有就把 stage 換成「請先回工作台設定」，回傳 null。 */
  function requireSeats(stageEl) {
    var seats = (global.ClassManager && ClassManager.requireSeats()) || null;
    if (!seats && stageEl) {
      stageEl.innerHTML =
        '<div class="empty"><span class="big">🎒</span>還沒設定班級座號。<br>' +
        '課堂工具要用座號指認學生。<br>請先回 <a href="index.html">教師工作台</a> 設定人數，再回來。</div>';
    }
    return seats;
  }

  /* 存取本工具的 localStorage（自動 JSON 化，讀寫失敗都不讓頁面掛掉）。 */
  function store(key) {
    return {
      get: function (def) {
        try { var r = localStorage.getItem(key); return r ? JSON.parse(r) : def; }
        catch (e) { return def; }
      },
      set: function (v) {
        try { localStorage.setItem(key, JSON.stringify(v)); return true; } catch (e) { return false; }
      },
      clear: function () { try { localStorage.removeItem(key); } catch (e) {} }
    };
  }

  /* 提示音現場合成，不載外部檔（斷網照響）。 */
  var _ac = null;
  function beep(times, freq) {
    times = times || 1; freq = freq || 660;
    try {
      var AC = global.AudioContext || global.webkitAudioContext;
      if (!AC) return;
      _ac = _ac || new AC();
      for (var i = 0; i < times; i++) {
        var o = _ac.createOscillator(), g = _ac.createGain();
        var t0 = _ac.currentTime + i * 0.28;
        o.frequency.value = freq; o.type = 'sine';
        g.gain.setValueAtTime(0.0001, t0);
        g.gain.exponentialRampToValueAtTime(0.18, t0 + 0.02);
        g.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.22);
        o.connect(g); g.connect(_ac.destination);
        o.start(t0); o.stop(t0 + 0.24);
      }
    } catch (e) {}
  }

  function fullscreen() {
    if (document.fullscreenElement) document.exitFullscreen();
    else document.documentElement.requestFullscreen && document.documentElement.requestFullscreen();
  }

  /* HUD 滑鼠停 3 秒自動淡出；面板開著時不隱藏。 */
  function autoHideHud(hudEl, isBlockedFn) {
    var hideAt = 0;
    function poke() { hudEl.classList.remove('hidden'); hideAt = Date.now() + 3000; }
    document.addEventListener('mousemove', poke);
    document.addEventListener('keydown', poke);
    document.addEventListener('touchstart', poke, { passive: true });
    hudEl.addEventListener('mouseenter', function () { hideAt = Infinity; });
    hudEl.addEventListener('mouseleave', poke);
    setInterval(function () {
      if (hideAt && Date.now() > hideAt && !(isBlockedFn && isBlockedFn())) hudEl.classList.add('hidden');
    }, 250);
    poke();
  }

  /* 側邊面板開關 */
  function panel(panelEl, scrimEl) {
    function set(open) { panelEl.classList.toggle('open', open); scrimEl.classList.toggle('open', open); }
    scrimEl.addEventListener('click', function () { set(false); });
    return { open: function () { set(true); }, close: function () { set(false); },
             toggle: function () { set(!panelEl.classList.contains('open')); },
             isOpen: function () { return panelEl.classList.contains('open'); } };
  }

  /* Fisher–Yates 洗牌（回新陣列，不動原陣列）。 */
  function shuffle(arr) {
    var a = arr.slice();
    for (var i = a.length - 1; i > 0; i--) { var j = Math.floor(Math.random() * (i + 1)); var t = a[i]; a[i] = a[j]; a[j] = t; }
    return a;
  }

  global.Tool = {
    $: $, todayKey: todayKey, requireSeats: requireSeats, store: store,
    beep: beep, fullscreen: fullscreen, autoHideHud: autoHideHud, panel: panel, shuffle: shuffle
  };
})(window);
