/* class-manager 跨電腦同步（2026-10-09，設計計畫 docs/設計計畫_跨電腦同步與每週統計.md §2）
 *
 * localStorage 仍是工作正本（斷網照常用，硬規則 4）；雲端（老師自己的 Apps Script 代理，
 * 指令碼屬性）只是「跟著走的副本」。沒配對時本檔完全不動作。只同步座號與狀態，沒有姓名。
 *
 * 每個鍵各自判斷三種情況：
 *   1 本機沒改、雲端較新 → 開頁時自動帶入並重新載入（之後才發現的只提示，點了才帶入，不打斷上課）
 *   2 本機有改、雲端沒變 → 上傳（改動後 3 秒、離開頁面時）
 *   3 兩邊都改過         → 代理拒收（版次不合），跳出「用哪一份？」**不自動覆蓋**
 *
 * 「本機有改」只算老師動過手之後的寫入：各頁開頁時會自己換日、補欄位再存一次，
 * 那種寫入兩台都會做、內容由舊資料決定，算進去會讓第二台每天早上都跳衝突。
 *
 * 動錢安全（護欄 §1）：同步的只是待送清單，入帳仍只有「老師按送出 → R18 依事件 id 去重」一條路。
 * 裝置憑證只能讀寫下面 KEYS 這幾個鍵（代理端白名單），不能加扣幣、不能送任務；口令照舊不落地。
 *
 * 核心（create）不碰 DOM，可在 node 裡接假代理跑兩台模擬：node scripts/sim-sync.mjs
 */
(function (global) {
  'use strict';

  /* 與代理 SYNC_KEYS 一致；改這裡兩邊都要改 */
  var KEYS = ['classManager.events.v1', 'classManager.homework.v3', 'classManager.routine.v2',
              'classManager.seats.v2', 'classManager.groups.v1', 'classManager.board.v1', 'classManager.stats.v1'];
  var LABEL = {
    'classManager.events.v1': '待送事件', 'classManager.homework.v3': '作業清點',
    'classManager.routine.v2': '當天五站檢核', 'classManager.seats.v2': '座號設定',
    'classManager.groups.v1': '小組計分', 'classManager.board.v1': '白板紀錄', 'classManager.stats.v1': '每週統計'
  };
  var META = 'classManager.sync.v1';   // { secret, url, dev, off, k:{ 鍵:{ rev 上次看到的版次, dirty, at 本機改動時間 } } }
  var DELAY = 3000;

  /* env：
   *   get(key)／set(key, v)／remove(key) → 直接讀寫 localStorage（不經過改動偵測）
   *   post(url, body, keepalive) → Promise<代理回應物件>
   *   interacted() → 老師在這一頁動過手了嗎
   *   ask(conflicts) → Promise<'local'|'cloud'>；reload(msg)；status(state, text)
   *   now()、timer(fn, ms) → 可替換（模擬用）
   */
  function create(env) {
    var now = env.now || function () { return new Date(); };
    var timer = env.timer || function (fn, ms) { return setTimeout(fn, ms); };
    var status = env.status || function () {};
    var busy = null, again = false, pushTimer = null, held = '';   // held＝另一台較新、等老師點了才帶入（存那份的時間）

    function cfg() {
      try { var c = JSON.parse(env.get(META) || 'null'); if (c && typeof c === 'object') { if (!c.k) c.k = {}; return c; } } catch (e) {}
      return { k: {} };
    }
    function save(c) { try { env.set(META, JSON.stringify(c)); } catch (e) {} }
    function paired() { var c = cfg(); return !!(c.secret && c.url && !c.off); }
    function stopped() { return !!cfg().off; }
    function anyDirty(c) { return KEYS.some(function (k) { return c.k[k] && c.k[k].dirty; }); }

    function pair(url, secret) {
      var c = cfg();
      if (c.secret !== secret) c.k = {};          // 換了憑證＝雲端可能整份重來，版次不可沿用
      c.url = url; c.secret = secret; c.off = false;
      if (!c.dev) c.dev = Math.random().toString(36).slice(2, 8);
      save(c);
      return pull('open');
    }

    function stop() {
      var c = cfg();
      save({ off: true, dev: c.dev, k: {} });
      status('off', '');
    }

    /* 某個鍵被寫了（瀏覽器端由 localStorage 攔截呼叫）。值沒變、或老師還沒動過手，都不算改動。 */
    function note(key, oldV, newV) {
      if (KEYS.indexOf(key) < 0 || oldV === newV || !paired()) return;
      if (!env.interacted()) return;
      var c = cfg();
      var m = c.k[key] || (c.k[key] = {});
      m.dirty = true; m.at = now().toISOString();
      save(c);
      status('pending', '');
      if (pushTimer) clearTimeout(pushTimer);
      pushTimer = timer(function () { pushTimer = null; push(); }, DELAY);
    }

    function serial(fn) {
      if (busy) { again = true; return busy; }
      busy = Promise.resolve().then(fn).then(function (v) { busy = null; return v; }, function (e) { busy = null; throw e; });
      return busy;
    }

    function fail(err) {
      status('offline', err && err.message ? err.message : '');
      return false;
    }

    function call(action, extra, keepalive) {
      var c = cfg();
      var body = { action: action, secret: c.secret, dev: c.dev };
      Object.keys(extra).forEach(function (k) { body[k] = extra[k]; });
      return env.post(c.url, body, keepalive).then(function (res) {
        if (res && res.ok) return res;
        if (res && res.unpaired) {               // 憑證被撤銷：停止同步，等老師回教師專區重新配對
          var c2 = cfg(); delete c2.secret; c2.k = {}; save(c2);
          status('unpaired', '');
          var e = new Error('unpaired'); e.unpaired = true; throw e;
        }
        throw new Error((res && res.error) || '後台回應失敗');
      });
    }

    function adopt(c, key, item) {
      if (item.v === '') env.remove(key); else env.set(key, item.v);
      c.k[key] = { rev: item.rev };
    }

    /* mode：'open'＝開頁（可自動帶入）；其餘＝之後的檢查（有較新的只提示，點了才帶入） */
    function pull(mode) {
      if (!paired()) return Promise.resolve(false);
      return serial(function () { return pullCore(mode); });
    }

    function pullCore(mode) {
      {
        var c = cfg(), have = {};
        KEYS.forEach(function (k) { if (c.k[k] && c.k[k].rev !== undefined) have[k] = c.k[k].rev; });
        return call('state_get', { have: have }).then(function (res) {
          c = cfg();
          var take = [], clash = [];
          KEYS.forEach(function (key) {
            var it = res.items[key], m = c.k[key] || (c.k[key] = {}), local = env.get(key);
            if (!it) { if (local != null) m.dirty = true; delete m.rev; return; }   // 雲端沒有這份 → 上傳
            if (it.rev === m.rev) return;
            if ((it.v === '' ? null : it.v) === local) { c.k[key] = { rev: it.rev }; return; }   // 內容相同（例：離開頁面時那次上傳其實成功了）
            if (!m.dirty && (m.rev !== undefined || local == null)) take.push({ key: key, it: it });
            else clash.push({ key: key, it: it, label: LABEL[key], cloudAt: it.at, localAt: m.at || '' });
          });
          save(c);
          if (mode !== 'open' && (take.length || clash.length) && !clash.some(function (x) { return (c.k[x.key] || {}).dirty; })) {
            held = take.concat(clash)[0].it.at || ' ';
            status('newer', held);
            return false;
          }
          held = '';
          var chosen = clash.length ? env.ask(clash) : Promise.resolve('cloud');
          return chosen.then(function (pick) {
            c = cfg();
            take.forEach(function (x) { adopt(c, x.key, x.it); });
            clash.forEach(function (x) {
              if (pick === 'cloud') adopt(c, x.key, x.it);
              else c.k[x.key] = { rev: x.it.rev, dirty: true, at: (c.k[x.key] || {}).at || now().toISOString() };
            });
            save(c);
            var changed = take.length + (pick === 'cloud' ? clash.length : 0);
            if (changed) {
              var at = take.concat(clash)[0].it.at;
              env.reload(at);
              return true;
            }
            return false;
          });
        }).then(function (reloading) {
          if (reloading) return true;
          if (anyDirty(cfg())) return doPush(false);
          if (!held) status('ok', '');
          return false;
        }, function (err) { if (err && err.unpaired) return false; return fail(err); });
      }
    }

    function doPush(keepalive) {
      var c = cfg(), sent = {};
      var items = KEYS.filter(function (k) { return c.k[k] && c.k[k].dirty; }).map(function (k) {
        var v = env.get(k); sent[k] = v == null ? '' : v;
        return { k: k, v: sent[k], base: c.k[k].rev || 0 };
      });
      if (!items.length) { if (!held) status('ok', ''); return Promise.resolve(false); }
      return call('state_put', { items: items }, keepalive).then(function (res) {
        var c2 = cfg(), clash = false;
        items.forEach(function (x) {
          var r = res.results[x.k] || {}, m = c2.k[x.k] || (c2.k[x.k] = {});
          if (r.ok) {
            m.rev = r.rev;
            var cur = env.get(x.k);
            if ((cur == null ? '' : cur) === sent[x.k]) { delete m.dirty; delete m.at; }   // 傳的途中又改了就留著下次傳
          } else if (r.conflict) clash = true;
          else { delete m.dirty; m.err = r.error || '沒有同步'; }
        });
        save(c2);
        if (clash) return pullCore('open');         // 這台改的那份雲端也變了 → 問老師用哪一份
        if (held) status('newer', held); else status(anyDirty(c2) ? 'pending' : 'ok', '');
        return false;
      });
    }

    function push(keepalive) {
      if (!paired()) return Promise.resolve(false);
      return serial(function () {
        return doPush(keepalive).then(null, function (err) { if (err && err.unpaired) return false; return fail(err); });
      }).then(function (v) {
        if (again) { again = false; return push(); }
        return v;
      });
    }

    function resume() { held = ''; return pull('open'); }   // 老師點了「另一台有新紀錄」

    return { pair: pair, stop: stop, paired: paired, stopped: stopped, note: note, pull: pull, push: push,
             resume: resume, dirty: function () { return anyDirty(cfg()); }, config: cfg };
  }

  var api = { KEYS: KEYS, LABEL: LABEL, META: META, create: create };
  global.CMSync = api;
  if (typeof document === 'undefined') return;

  /* ── 以下只在瀏覽器執行：攔截 localStorage 寫入、角落狀態、衝突對話框 ───────── */
  var proto = Storage.prototype, rawSet = proto.setItem, rawRemove = proto.removeItem;
  var touched = false, core = null, chip = null, FLASH = 'cm.syncFlash', lastPull = 0;

  function lsGet(k) { try { return localStorage.getItem(k); } catch (e) { return null; } }
  ['pointerdown', 'keydown', 'touchstart'].forEach(function (t) {
    document.addEventListener(t, function () { touched = true; }, true);
  });

  function hhmm(iso) {
    if (!iso) return '時間不明';
    var d = new Date(iso), n = new Date();
    if (isNaN(d)) return '時間不明';
    var t = String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0');
    return d.toDateString() === n.toDateString() ? t : (d.getMonth() + 1) + '/' + d.getDate() + ' ' + t;
  }

  function paint(state, text) {
    api.state = state;
    if (api.onStatus) { try { api.onStatus(state, text); } catch (e) {} }
    if (!chip) return;
    var say = { ok: '', pending: '☁ 同步中…', offline: '☁ 未同步', unpaired: '☁ 同步已停止，請到教師專區重新配對',
                newer: '☁ 另一台 ' + hhmm(text) + ' 有新紀錄，點這裡接續', off: '' }[state] || '';
    if (state === 'flash') say = '☁ 已接續另一台 ' + hhmm(text) + ' 的紀錄';
    chip.textContent = say;
    chip.hidden = !say;
    chip.style.cursor = state === 'newer' ? 'pointer' : 'default';
    chip.style.pointerEvents = state === 'newer' ? 'auto' : 'none';
    chip.style.opacity = state === 'newer' || state === 'flash' || state === 'unpaired' ? '1' : '.6';
  }

  function ask(list) {
    return new Promise(function (resolve) {
      var wrap = document.createElement('div');
      wrap.setAttribute('role', 'dialog');
      wrap.style.cssText = 'position:fixed;inset:0;z-index:2147483000;background:rgba(5,8,16,.72);display:flex;' +
        'align-items:center;justify-content:center;padding:16px;font-family:inherit';
      var box = document.createElement('div');
      box.style.cssText = 'max-width:560px;width:100%;background:#1b2334;color:#eef2fb;border:1px solid rgba(255,255,255,.18);' +
        'border-radius:18px;padding:22px 24px;box-shadow:0 20px 60px rgba(0,0,0,.5);font-size:18px;line-height:1.6';
      var h = document.createElement('div');
      h.style.cssText = 'font-size:22px;font-weight:700;margin-bottom:8px';
      h.textContent = '☁ 兩台電腦的紀錄不一樣，用哪一份？';
      var p = document.createElement('div');
      p.style.cssText = 'opacity:.85;margin-bottom:10px';
      p.textContent = '下面這些紀錄，這台電腦和另一台都有、內容不同。選了才會動，不會自動覆蓋。';
      var ul = document.createElement('ul');
      ul.style.cssText = 'margin:0 0 16px;padding-left:22px';
      list.forEach(function (x) {
        var li = document.createElement('li');
        li.textContent = x.label + '：這台 ' + hhmm(x.localAt) + '／另一台 ' + hhmm(x.cloudAt);
        ul.appendChild(li);
      });
      var row = document.createElement('div');
      row.style.cssText = 'display:flex;gap:12px;flex-wrap:wrap';
      function btn(text, pick, bg) {
        var b = document.createElement('button');
        b.type = 'button'; b.textContent = text;
        b.style.cssText = 'flex:1 1 200px;padding:12px 14px;border-radius:12px;border:1px solid rgba(255,255,255,.25);' +
          'background:' + bg + ';color:#fff;font-size:18px;font-weight:700;cursor:pointer;font-family:inherit';
        b.addEventListener('click', function () { wrap.remove(); resolve(pick); });
        row.appendChild(b);
      }
      btn('用這台電腦的', 'local', '#2f6fdb');
      btn('用另一台的（這台的會被換掉）', 'cloud', '#3a4358');
      box.appendChild(h); box.appendChild(p); box.appendChild(ul); box.appendChild(row);
      wrap.appendChild(box); document.body.appendChild(wrap);
    });
  }

  function post(url, body, keepalive) {
    var text = JSON.stringify(body);
    return fetch(url, {
      method: 'POST', headers: { 'Content-Type': 'text/plain;charset=utf-8' }, body: text,
      keepalive: !!keepalive && text.length < 60000      // keepalive 上限 64KB
    }).then(function (r) { if (!r.ok) throw new Error('後台回應 HTTP ' + r.status); return r.json(); });
  }

  core = create({
    get: lsGet,
    set: function (k, v) { rawSet.call(localStorage, k, v); },
    remove: function (k) { rawRemove.call(localStorage, k); },
    post: post, ask: ask, status: paint,
    interacted: function () { return touched; },
    reload: function (at) { try { sessionStorage.setItem(FLASH, at || ''); } catch (e) {} location.reload(); }
  });

  proto.setItem = function (k, v) {
    var mine = this === localStorage && KEYS.indexOf(k) >= 0, old = mine ? lsGet(k) : null;
    rawSet.call(this, k, v);
    if (mine) core.note(k, old, String(v));
  };
  proto.removeItem = function (k) {
    var mine = this === localStorage && KEYS.indexOf(k) >= 0, old = mine ? lsGet(k) : null;
    rawRemove.call(this, k);
    if (mine) core.note(k, old, null);
  };

  function check(mode) { lastPull = Date.now(); return core.pull(mode); }

  function boot() {
    chip = document.createElement('div');
    chip.id = 'cm-sync-chip';
    chip.hidden = true;
    chip.style.cssText = 'position:fixed;left:10px;bottom:8px;z-index:2147482000;padding:4px 12px;border-radius:999px;' +
      'background:rgba(20,27,42,.88);color:#dfe7f7;border:1px solid rgba(255,255,255,.2);font-size:14px;line-height:1.5;' +
      'max-width:calc(100vw - 20px);pointer-events:none';
    chip.addEventListener('click', function () { if (api.state === 'newer') core.resume(); });
    document.body.appendChild(chip);
    var flash = null;
    try { flash = sessionStorage.getItem(FLASH); sessionStorage.removeItem(FLASH); } catch (e) {}
    if (!core.paired()) return;
    check('open').then(function () {
      if (flash !== null && api.state === 'ok') { paint('flash', flash); setTimeout(function () { if (api.state === 'flash') paint('ok', ''); }, 8000); }
    });
    document.addEventListener('visibilitychange', function () {
      if (document.visibilityState === 'hidden') { if (core.dirty()) core.push(true); }
      else if (Date.now() - lastPull > 60000) check('later');
    });
    window.addEventListener('pagehide', function () { if (core.dirty()) core.push(true); });
    window.addEventListener('online', function () { check('later'); });
    setInterval(function () { if (document.visibilityState === 'visible') check('later'); }, 5 * 60000);
  }
  if (document.body) boot(); else document.addEventListener('DOMContentLoaded', boot);

  api.pair = function (url, secret) { lastPull = Date.now(); return core.pair(url, secret); };
  api.stop = core.stop; api.paired = core.paired; api.stopped = core.stopped;
  api.dirty = core.dirty; api.config = core.config;
  api.pullNow = function () { return check('open'); };
})(typeof window !== 'undefined' ? window : globalThis);
