/* class-manager 收班送出引擎（送出韌性 階段 1＋2，2026-09-24）
 *
 * 設計書：docs/設計藍圖與路線圖.md「送出韌性改善」。起因：9/23 在網路不穩的電腦收班，
 * 每包連線 7～11 秒、連按 4 次送出才送完。本檔只管「怎麼把包送到代理」，不碰 DOM，
 * 所以可以在 node 裡用假代理跑模擬（scripts/sim-send.mjs）。
 *
 *  A 單包失敗自動重試：等 2／5／10 秒各再試一次（共 4 次機會）。
 *  B 每次連線 25 秒逾時：卡住的連線直接放棄、算一次失敗，交給 A 重試。
 *  D 失敗紀錄：每次失敗記進本機（CMEvents.logFail），下一次有包送成功時
 *    附在那包首行摘要尾端一起上雲，老師換電腦也查得到；JSON 不動（理由見 events.js withSendLog）。
 *
 * 不重試的錯（重試也不會好）：口令錯誤、內容太長／空白、代理未設定。
 * 只有「連不上／逾時／HTTP 錯／回應讀不懂／Notion 回應錯誤碼」才重試。
 */
(function (global) {
  'use strict';

  var DELAYS = [2000, 5000, 10000];   // 第 1～3 次重試前的等待
  var TIMEOUT = 25000;                // 單次連線上限

  /* 代理明確回的 ok:false 裡，只有 Notion 端暫時性錯誤值得重試 */
  function retryableServer(msg) { return /Notion 回應|忙碌|稍後/.test(String(msg || '')); }

  function short(msg) { return String(msg || '未知錯誤').replace(/[{}]/g, '').slice(0, 40); }

  function stamp(d) {
    return String(d.getMonth() + 1).padStart(2, '0') + '/' + String(d.getDate()).padStart(2, '0') + ' ' +
           String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0') + ':' +
           String(d.getSeconds()).padStart(2, '0');
  }

  /* opts：
   *   post(text, signal) → Promise<代理回應物件>（fetch 失敗就 reject）
   *   store             → CMEvents（isPackSent／markPackSent／logFail／failLog／clearFailLog／withSendLog）
   *   sleep(ms)、now()  → 可替換（模擬用）
   *   timeout、delays   → 可替換（模擬用）
   *   onProgress({part, parts, retry, wait}) → 畫面顯示「第 n/N 包・重試第 k 次」
   */
  function create(opts) {
    var store = opts.store;
    var sleep = opts.sleep || function (ms) { return new Promise(function (r) { setTimeout(r, ms); }); };
    var now = opts.now || function () { return new Date(); };
    var timeout = opts.timeout || TIMEOUT;
    var delays = opts.delays || DELAYS;
    var progress = opts.onProgress || function () {};

    /* 一次連線：逾時就 abort 並當成失敗 */
    function attempt(text) {
      var ctl = (typeof AbortController !== 'undefined') ? new AbortController() : null;
      var timer;
      var guard = new Promise(function (_, reject) {
        timer = setTimeout(function () {
          if (ctl) ctl.abort();
          var e = new Error('連線逾時（' + Math.round(timeout / 1000) + ' 秒）'); e.retry = true; reject(e);
        }, timeout);
      });
      var call = Promise.resolve().then(function () { return opts.post(text, ctl && ctl.signal); })
        .then(function (res) {
          if (res && res.ok) return res;
          var msg = res && res.error ? res.error : '代理回應失敗';
          var e = new Error(msg); e.retry = !res || retryableServer(msg); throw e;
        }, function (err) {
          var e = new Error(err && err.message ? err.message : '連不上代理'); e.retry = true; throw e;
        });
      return Promise.race([call, guard]).then(
        function (v) { clearTimeout(timer); return v; },
        function (e) { clearTimeout(timer); throw e; });
    }

    /* 一包：最多 1＋delays.length 次 */
    function sendOne(base, part, parts) {
      var k = 0;
      function loop() {
        // 每次重試都重新附一次失敗紀錄（前一次失敗剛寫進去，這次就帶得到）
        var log = store.failLog();
        var text = log.length ? store.withSendLog(base, log) : base;
        progress({ part: part, parts: parts, retry: k });
        return attempt(text).then(function () {
          store.markPackSent(base);                 // 指紋一律用「不含紀錄」的原包，重送判斷才穩
          if (text !== base) store.clearFailLog(log.length);
        }, function (err) {
          store.logFail({ t: stamp(now()), p: part + '/' + parts, e: short(err.message) });
          if (!err.retry || k >= delays.length) throw err;
          var wait = delays[k++];
          progress({ part: part, parts: parts, retry: k, wait: wait, error: err.message });
          return sleep(wait).then(loop);
        });
      }
      return loop();
    }

    /* 整批：逐包依序；已成功過的包跳過；任一包用盡重試就整批留在本機（§3.2） */
    function send(packs) {
      var done = 0;
      return packs.reduce(function (chain, text, i) {
        return chain.then(function () {
          if (store.isPackSent(text)) { done++; return; }
          return sendOne(text, i + 1, packs.length).then(function () { done++; });
        });
      }, Promise.resolve()).then(function () { return done; });
    }

    return { send: send };
  }

  global.CMSender = { create: create, DELAYS: DELAYS, TIMEOUT: TIMEOUT };
})(typeof window !== 'undefined' ? window : globalThis);
