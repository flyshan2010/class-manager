/* 教師專區（Phase 3-2）：今日待送、當節活動紀錄、班級座號。
 *
 * 為什麼從工作台搬出來（老師 2026-09-06 拍板）：工作台是上課中會投影的那一頁，
 * 學生走過去按一下「全部丟棄」或改掉座號，資料就沒了。送出、丟棄、座號設定
 * 全部收進這一頁，首頁只留一個小入口。
 *
 * 口令**永不寫進 localStorage**（設計書 §3.4）。2026-09-07 起改成整頁口令閘
 * （比照班網教師專區）：進頁面就要驗證，通過才顯示內容，口令只存 sessionStorage
 * （這個分頁專用、關掉即消失），送出時直接取用，不必再打第二次。
 */
(function () {
  'use strict';
  var $ = function (id) { return document.getElementById(id); };
  var CFG_URL = 'https://flyshan2010.github.io/class-website/data/site-config.json';
  var proxyUrl = null;
  var PW_KEY = 'cm.teacherPw';        /* sessionStorage：關掉分頁就沒了 */
  var LOCK_KEY = 'cm.teacherLock';    /* localStorage：錯 3 次前端鎖 10 分鐘 */

  function pw() { try { return sessionStorage.getItem(PW_KEY) || ''; } catch (e) { return ''; } }

  function getProxy() {
    if (proxyUrl) return Promise.resolve(proxyUrl);
    return fetch(CFG_URL + '?t=' + Date.now(), { cache: 'no-store' })
      .then(function (r) { if (!r.ok) throw new Error('讀不到代理網址'); return r.json(); })
      .then(function (j) {
        if (!j.updateProxyUrl) throw new Error('讀不到代理網址');
        proxyUrl = j.updateProxyUrl; return proxyUrl;
      });
  }

  function callProxy(action, params) {
    return getProxy().then(function (url) {
      var body = { action: action, pw: pw() };
      Object.keys(params || {}).forEach(function (k) { body[k] = params[k]; });
      return fetch(url, {
        method: 'POST', headers: { 'Content-Type': 'text/plain;charset=utf-8' },
        body: JSON.stringify(body)
      }).then(function (r) { return r.json(); });
    });
  }

  /* ── 口令閘（真正的把關在代理端；前端只負責不把後台按鈕露給學生）───── */
  (function gate() {
    var box = $('gate'), main = $('tmain'), msg = $('gate-msg'), inp = $('gate-pw');
    function lockInfo() { try { return JSON.parse(localStorage.getItem(LOCK_KEY)) || {}; } catch (e) { return {}; } }
    function locked() { return (lockInfo().until || 0) > Date.now(); }
    function recordFail() {
      var i = lockInfo();
      i.fails = (i.fails || 0) + 1;
      if (i.fails >= 3) { i.until = Date.now() + 10 * 60 * 1000; i.fails = 0; }
      try { localStorage.setItem(LOCK_KEY, JSON.stringify(i)); } catch (e) {}
    }
    function unlock() { box.hidden = true; main.hidden = false; }
    function tryLogin() {
      if (locked()) {
        msg.textContent = '嘗試次數過多，請 ' + Math.ceil((lockInfo().until - Date.now()) / 60000) + ' 分鐘後再試。';
        return;
      }
      var v = inp.value.trim();
      if (!v) return;
      msg.textContent = '驗證中…';
      try { sessionStorage.setItem(PW_KEY, v); } catch (e) {}
      callProxy('list_tasks', { limit: 1 })
        .then(function (res) {
          if (res && res.ok) { try { localStorage.removeItem(LOCK_KEY); } catch (e) {} unlock(); return; }
          try { sessionStorage.removeItem(PW_KEY); } catch (e) {}
          if (((res && res.error) || '').indexOf('口令') >= 0) recordFail();
          msg.textContent = (res && res.error) || '口令不對，請再試一次。';
        })
        .catch(function () {
          /* 連不到代理（教室斷網）時不要把老師鎖在外面：口令留著，之後送出仍會被代理端驗。 */
          msg.textContent = '連不到後台（可能斷網），已先讓你進入；送出時才會真正驗證口令。';
          setTimeout(unlock, 900);
        });
    }
    $('gate-btn').addEventListener('click', tryLogin);
    inp.addEventListener('keydown', function (e) { if (e.key === 'Enter') tryLogin(); });
    if (pw()) unlock(); else inp.focus();      /* 同一分頁內重整不必再打 */
    $('btn-lock').addEventListener('click', function () {
      try { sessionStorage.removeItem(PW_KEY); } catch (e) {}
      location.href = 'index.html';
    });
  })();
  var input = $('seat-input');
  var status = $('seat-status');
  var summary = $('seat-summary');
  var preview = $('seat-preview');

  $('today').textContent = new Date().toLocaleDateString('zh-TW', {
    year: 'numeric', month: '2-digit', day: '2-digit', weekday: 'long'
  });

  /* ── 班級座號 ─────────────────────────────────────────── */
  function refresh() {
    var data = ClassManager.load();
    if (data) {
      var seats = data.seats;
      summary.textContent = '已設定 ' + seats.length + ' 個座號';
      input.value = ClassManager.toText(seats);
      preview.textContent = '目前座號：' + seats.join('、');
    } else {
      summary.textContent = '尚未設定座號';
      preview.textContent = '';
    }
  }

  $('btn-save').addEventListener('click', function () {
    var parsed = ClassManager.parseSeats(input.value);
    if (parsed.error) { status.className = 'status warn'; status.textContent = parsed.error; return; }
    if (!ClassManager.save(parsed.seats)) {
      status.className = 'status warn';
      status.textContent = '瀏覽器不允許儲存，請關閉無痕模式後再試一次。';
      return;
    }
    status.className = 'status ok';
    status.textContent = '已儲存 ' + parsed.seats.length + ' 個座號。';
    refresh();
  });

  $('btn-clear').addEventListener('click', function () {
    ClassManager.clear();
    input.value = '';
    status.className = 'status';
    status.textContent = '座號設定已清除。';
    refresh();
  });

  input.addEventListener('keydown', function (e) {
    if (e.key === 'Enter') { e.preventDefault(); $('btn-save').click(); }
  });

  refresh();

  /* ── 今日待送（T0 管線・設計書 §3）───────────────────────── */
  var TOOL_LABEL = { board: '電子白板', arrive: '到校簽到', cleanup: '打掃檢核',
                     homework: '作業清點', lunch: '午餐檢核', teeth: '潔牙檢核',
                     routine: '常規檢核（舊）' };

  function fmtRow(r) {
    // coin 是 class-rules.json 的原文（已含 + 或 −），不要再補符號——
    // 補了會變「++5 幣」（"+5" > 0 在 JS 是 true）。2-1 線上實測抓到。
    var coin = r.coin === undefined || r.coin === '' ? '' : String(r.coin) + ' 幣';
    var bits = ['座號 ' + r.seat, r.act || '(未填行為)'];
    if (r.subj && String(r.period || '').indexOf(r.subj) < 0) bits.push(r.subj);
    if (r.period) bits.push(r.period);
    if (r.count > 1) bits.push(r.count + ' 次');
    if (coin) bits.push(coin);
    return bits.join('　·　');
  }

  function refreshSend() {
    var rows = CMEvents.merged();
    var badge = $('send-badge');
    var list = $('send-list');
    badge.textContent = rows.length + ' 筆';
    badge.className = 'badge' + (rows.length ? ' soon' : '');
    if (!rows.length) {
      list.innerHTML = '<p class="hint" style="margin:0">目前沒有待送事件。課堂工具記下的加減分會出現在這裡。</p>';
      refreshRemind();
      return;
    }
    var byDate = {};
    rows.forEach(function (r) { (byDate[r.date] = byDate[r.date] || []).push(r); });
    var html = '';
    Object.keys(byDate).sort().forEach(function (d) {
      html += '<div class="sendday"><b>' + d + '</b>';
      byDate[d].forEach(function (r) {
        html += '<div class="senditem"><span class="tag ' + (r.kind === 'bad' || r.kind === 'neutral' ? r.kind : 'good') + '">' +
                (TOOL_LABEL[r.tool] || r.tool || '') + '</span>' + fmtRow(r) + '</div>';
      });
      html += '</div>';
    });
    list.innerHTML = html;
    refreshRemind();
  }

  function post(text) { return callProxy('submit_task', { text: text }); }

  /* 預覽＝老師看得懂的任務說明（2026-09-06 改；原本直接倒 #CM-EVENTS JSON，老師反映看不懂）。 */
  var rawOn = false;
  function renderPreview() {
    var pre = $('send-preview'), btn = $('btn-raw');
    var desc = CMEvents.describePayloads();
    if (!desc) { pre.hidden = true; btn.hidden = true; return; }
    pre.hidden = false; btn.hidden = false;
    pre.textContent = rawOn ? CMEvents.rawPayloads() : desc;
    btn.textContent = rawOn ? '改看任務說明' : '顯示原始封包';
  }
  $('btn-preview').addEventListener('click', function () {
    var pre = $('send-preview');
    if (!pre.hidden) { pre.hidden = true; $('btn-raw').hidden = true; return; }
    rawOn = false; renderPreview();
  });
  $('btn-raw').addEventListener('click', function () { rawOn = !rawOn; renderPreview(); });

  $('btn-drop').addEventListener('click', function () {
    if (!CMEvents.count()) return;
    if (!confirm('要丟棄全部待送事件嗎？丟掉就不會入帳，也救不回來。')) return;
    CMEvents.clearAll();
    refreshSend();
    $('send-status').className = 'status warn';
    $('send-status').textContent = '待送事件已全部丟棄。';
  });

  $('btn-send').addEventListener('click', function () {
    var st = $('send-status');
    var packs = CMEvents.buildPayloads();
    if (!packs.length) { st.className = 'status'; st.textContent = '沒有待送事件。'; return; }
    if (!pw()) { st.className = 'status warn'; st.textContent = '口令不見了（分頁被關過？）請重整本頁重新登入。'; return; }
    st.className = 'status'; st.textContent = '送出中…';
    $('btn-send').disabled = true;

    getProxy().then(function () {
      // 逐包依序送出；任何一包失敗就整批留在本機（§3.2 失敗即保留）
      var done = 0;
      return packs.reduce(function (chain, text) {
        return chain.then(function () {
          return post(text).then(function (res) {
            if (!res || !res.ok) throw new Error(res && res.error ? res.error : '代理回應失敗');
            done++;
          });
        });
      }, Promise.resolve()).then(function () { return done; });
    }).then(function (done) {
      CMEvents.markSent();       // 成功才清、批次號才往前推
      refreshSend();
      st.className = 'status ok';
      st.textContent = '已送出 ' + done + ' 包，進了收件匣，排程 Agent 會入帳。';
    }).catch(function (err) {
      st.className = 'status warn';
      st.textContent = '沒送出去（' + (err && err.message ? err.message : '網路或口令有問題') +
                       '）。待送 ' + CMEvents.merged().length + ' 筆仍留在這台電腦，稍後再按一次即可。';
    }).then(function () { $('btn-send').disabled = false; });
  });

  /* 放學提醒：只提醒不代送——口令依 §3.4 永不落地，送出仍是老師按的那一下。 */
  function refreshRemind() {
    var r = CMEvents.remindDue();
    var box = $('send-remind');
    box.hidden = !r.due;
    if (r.due) { $('remind-n').textContent = r.n; $('remind-at').textContent = r.at; }
  }

  $('btn-remind-go').addEventListener('click', function () {
    $('btn-send').scrollIntoView({ block: 'center' });
    $('btn-send').focus();
  });

  $('btn-remind-off').addEventListener('click', function () {
    CMEvents.dismissRemind();
    refreshRemind();
  });

  refreshSend();
  setInterval(refreshRemind, 60000);   // 每分鐘看一次，跨過放學時間就跳出來

  /* ── 當節活動紀錄（電子白板 Board.log 寫的那份）───────────────── */
  function esc(s) { return String(s == null ? '' : s).replace(/[<>&]/g, ''); }
  function paintLog() {
    var box = $('loglist'), log = [];
    try {
      var raw = localStorage.getItem('classManager.board.v1');
      log = (raw ? (JSON.parse(raw) || {}).log : null) || [];
    } catch (e) { log = []; }
    if (!log.length) {
      box.innerHTML = '<p class="hint" style="margin:0">還沒有活動紀錄。' +
        '電子白板按「結束課程」（或換節自動結算）就會留一列。</p>';
      return;
    }
    box.innerHTML = log.map(function (x) {
      var seatBits = Object.keys(x.seats || {}).map(function (s) { return s + '號×' + x.seats[s]; });
      return '<div class="logitem"><div class="lh">' +
        '<span class="lp">' + esc(x.period || '') + '</span>' +
        '<span class="lt">' + esc(x.date || '') + ' ' + esc(x.at || '') + '</span>' +
        '<span class="ln">發表 ' + (x.seatTotal || 0) + ' 次　·　抽問 ✓' + (x.quizC || 0) +
        ' ✗' + (x.quizW || 0) + '</span></div>' +
        (seatBits.length ? '<div class="ln">' + esc(seatBits.join('、')) + '</div>' : '') +
        (x.focus ? '<div class="lf">本節重點：' + esc(x.focus) + '</div>' : '') +
        '</div>';
    }).join('');
  }
  paintLog();
})();
