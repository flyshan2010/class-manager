/* class-manager 課堂事件佇列（T0 管線・前端側）
 *
 * 設計書：docs/設計計畫_課堂資料採集Phase2.md §3。四條不可違反的規矩：
 *  1. 工具頁只 push／list，**不含任何送出程式碼、不持有口令**（§3.4，投影全班看得到畫面）。
 *  2. 前端不算錢。src:"rule" 的 coin／level 一律原封轉抄 class-rules.json，
 *     由排程 Agent（R18）回讀班規核對後才入帳；src:"tally" 一律不入帳（coin 0）。
 *  3. 事件 id 是防重複鍵，必須「按兩次收班、重送、隔天補送都不會重複發錢」（U44）。
 *     id = 工具-日期-批次-座號-特徵；批次號只在**送出成功後**才往前推，
 *     所以斷網重試會產生同樣的 id（R18 去重），而同一天送第二次是新批次（次數不會互相蓋掉）。
 *  4. 送出成功才清；失敗一律留在本機（§3.2）。
 *
 * payload 只帶座號，永不帶姓名（硬規則 2）。
 */
(function (global) {
  'use strict';

  var KEY = 'classManager.events.v1';   // { pending:[...], batch:{ '2026-09-08':2 } }
  var MAX_TEXT = 1800;                  // 代理 submit_task 上限 2000 字，留 200 字餘裕

  function today() {
    var d = new Date();
    return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') +
           '-' + String(d.getDate()).padStart(2, '0');
  }

  function read() {
    try {
      var raw = localStorage.getItem(KEY);
      var db = raw ? JSON.parse(raw) : null;
      if (!db || !Array.isArray(db.pending)) return { pending: [], batch: {} };
      if (!db.batch) db.batch = {};
      return db;
    } catch (e) { return { pending: [], batch: {} }; }
  }

  function write(db) {
    try { localStorage.setItem(KEY, JSON.stringify(db)); return true; } catch (e) { return false; }
  }

  /* 合併特徵：同一學生×同一天×同一工具×同一類 合併成一列（§3.3）。 */
  function sig(ev) {
    // 「kind」必須進特徵：班規卡的 good 與 bad 各自從 0 編號，不分就會把
    // 「作業未交(bad0,−5)」和「訂正完成(good0,+5)」合併成同一列（2-1 實作時抓到）。
    if (ev.src === 'rule') return 'r' + ev.rule_n + (ev.kind === 'good' ? 'g' : 'b') + '.' + (ev.act_i == null ? 0 : ev.act_i);
    // tally：同科目同行為才合併（「座號N 在○○課舉手回答」）
    return 't' + (ev.subj || '') + '.' + (ev.act || '');
  }

  /* 工具頁呼叫這支累積事件。必填 tool／seat／src／kind／act；
     src:'rule' 另需 rule_n／act_i／coin／level（原封轉抄班規），src:'tally' 不帶錢。 */
  function push(ev) {
    if (!ev || !ev.tool || !ev.seat || !ev.src) return false;
    var db = read();
    var rec = {
      tool: ev.tool, date: ev.date || today(), seat: Number(ev.seat), src: ev.src,
      kind: ev.kind || 'good', act: ev.act || '', at: ev.at || new Date().toTimeString().slice(0, 5)
    };
    ['rule_n', 'act_i', 'coin', 'level', 'period', 'subj', 'note', 'fix', 'dedupe'].forEach(function (k) {
      if (ev[k] !== undefined && ev[k] !== '') rec[k] = ev[k];
    });
    db.pending.push(rec);
    return write(db);
  }

  /* 工具頁「重新結算」：清掉本工具當天**還沒送出**的事件，再由工具頁整批重 push。
     沒有這支，老師按第二次結算就會把同一批再疊一次（次數變兩倍）。 */
  function clearTool(tool, date) {
    var db = read(), d = date || today();
    db.pending = db.pending.filter(function (ev) { return !(ev.tool === tool && ev.date === d); });
    return write(db);
  }

  function list() { return read().pending; }
  function count() { return read().pending.length; }

  function clearAll() { var db = read(); db.pending = []; db.sent = []; return write(db); }

  /* 已送成功的包（2026-09-23 老師回報收件匣同一包出現 3～4 次）：
     分包逐包送、第 3 包失敗時整批留在本機，老師再按一次送出會把**已成功的**第 1、2 包也重送。
     排程端雖靠事件 id 去重、沒有重複入帳，但收件匣會長出重複列、排程白跑。
     所以每包送成功就記下指紋，重送時跳過；markSent（全部成功）時清空。
     指紋用包的全文：待送內容一改（重新結算、多記一筆），包文就變、會照常重送——那也無妨，id 相同照樣去重。 */
  function packHash(text) {
    var h = 5381;
    for (var i = 0; i < text.length; i++) h = ((h << 5) + h + text.charCodeAt(i)) | 0;
    return text.length + ':' + (h >>> 0).toString(36);
  }
  function isPackSent(text) { return (read().sent || []).indexOf(packHash(text)) >= 0; }
  function markPackSent(text) {
    var db = read();
    db.sent = db.sent || [];
    var h = packHash(text);
    if (db.sent.indexOf(h) < 0) db.sent.push(h);
    return write(db);
  }

  /* 送出失敗紀錄（送出韌性 階段 2，2026-09-24）：
     9/23 失敗真因無法取證——錯誤只顯示在那台電腦畫面、沒留紀錄。
     每次失敗記一筆 {t 時間, p 第幾包, e 錯誤}，最多留 6 筆；下一次有包送成功時由 CMSender
     附在那包首行摘要尾端上雲，送成功才清。markSent／clearAll 都不清它（診斷用，與待送事件無關）。 */
  var FAIL_MAX = 6;
  function logFail(x) {
    var db = read();
    db.faillog = (db.faillog || []).concat([x]).slice(-FAIL_MAX);
    return write(db);
  }
  function failLog() { return read().faillog || []; }
  function clearFailLog(n) {            // 只清「已附上雲」的前 n 筆，之後新記的留著
    var db = read();
    db.faillog = (db.faillog || []).slice(n);
    return write(db);
  }

  /* 把失敗紀錄併進包的**首行摘要尾端**：「⚠ 前次送出失敗 2 次：09/24 12:55:03 第2/3包 連線逾時…；…」。
     JSON 一個字都不動——R18 取第一個 { 之後全部解析，首行只是給老師看的摘要（2026-09-07b 起就這樣用，排程照常命中）；
     放末行會讓 JSON 解析失敗（E06），放進 JSON 當新欄位則可能被排程當成「手冊沒寫的情況」標失敗。
     首行不得出現 {（錯誤訊息已在 CMSender 去掉大括號）；紀錄段最多 300 字、整包不超過代理 2000 字上限，
     超過就從最舊的紀錄丟起，丟光就原包照送。 */
  function withSendLog(text, log) {
    var i = text.indexOf('\n');
    if (i < 0) return text;
    var lines = log.map(function (x) { return x.t + ' 第' + x.p + '包 ' + x.e; });
    while (lines.length) {
      var tail = ' · ⚠ 前次送出失敗 ' + lines.length + ' 次：' + lines.join('；');
      var out = text.slice(0, i) + tail + text.slice(i);
      if (tail.length <= 300 && out.length <= 1990) return out;
      lines = lines.slice(1);
    }
    return text;
  }

  /* 刪一筆逐筆原始紀錄（工作台面板的「移除」）。index 取自 list() 的順序。 */
  function removeAt(i) {
    var db = read();
    if (i < 0 || i >= db.pending.length) return false;
    db.pending.splice(i, 1);
    return write(db);
  }

  /* 依 §3.3 合併，回傳「送出用」事件列（含 id、次數）。同時保留 rawIdx 供面板對照。 */
  function merged() {
    var db = read();
    var byKey = {};
    var out = [];
    db.pending.forEach(function (ev, i) {
      var batch = (db.batch[ev.date] || 0) + 1;
      var key = ev.tool + '|' + ev.date + '|' + ev.seat + '|' + sig(ev);
      if (byKey[key]) {
        byKey[key].count += 1;
        byKey[key].rawIdx.push(i);
        // note 是「哪幾份／哪一項」，合併時全部留下（去重、以「、」串接），
        // 只取第一筆會讓老師在紀錄庫看到「未交 3 次」卻不知道是哪三份。
        // 用「、」包起來整串比對，不用 split——作業名稱本身就可能含頓號（「乙本 L2、預習國 L2」）。
        if (ev.note && ('、' + (byKey[key].note || '') + '、').indexOf('、' + ev.note + '、') < 0) {
          byKey[key].note = (byKey[key].note ? byKey[key].note + '、' : '') + ev.note;
        }
        return;
      }
      // id ＝ 防重複鍵（U44）。判準是「這個事件一天只該有一列嗎」，**不是 src**：
      //  · 狀態式（一天一態，可以改來改去再重新結算）→ **不帶批次號**，重送同 id → R18 去重。
      //    包含 src:'rule' 的全部，以及晨掃那種帶 dedupe:'day' 的 tally。
      //  · 計次式（同一天分兩批收班要各記各的次數，例如抽問／座位板）→ **帶批次號**（§6 拍板 #10）。
      // 2026-09-06 模擬驗收抓到：晨掃的「打掃缺席」是 tally 卻是狀態式，
      // 只看 src 會讓同一天結算兩次變成兩列，週結薪水**多扣一次出勤**。
      var perDay = ev.src === 'rule' || ev.dedupe === 'day';
      var stamp = ev.date.replace(/-/g, '') + (perDay ? '' : '-b' + batch);
      var m = {
        id: ev.tool + '-' + stamp + '-s' + ev.seat + '-' + sig(ev),
        tool: ev.tool, date: ev.date, seat: ev.seat, src: ev.src, kind: ev.kind,
        act: ev.act, count: 1, rawIdx: [i]
      };
      ['rule_n', 'act_i', 'coin', 'level', 'period', 'subj', 'note', 'at'].forEach(function (k) {
        if (ev[k] !== undefined) m[k] = ev[k];
      });
      byKey[key] = m;
      out.push(m);
    });
    return out;
  }

  /* 工具中文名（任務標題與預覽共用，宣告在 buildPacks 之前才拿得到）。 */
  var TOOL_NAMES = { board: '電子白板', arrive: '到校簽到', cleanup: '打掃工作',
                     homework: '作業清點', lunch: '午餐工作', teeth: '潔牙',
                     routine: '常規檢核（舊）' };

  /* 產生要 POST 的任務原文；超過長度就切成多包（part i/n），每包都是完整可解析的 JSON。 */
  function buildPacks() {
    var rows = merged();
    if (!rows.length) return [];
    var db = read();
    var dates = {};
    rows.forEach(function (r) { dates[r.date] = true; });

    function pack(chunk, part, parts) {
      var body = {
        tool: chunk[0].tool, date: chunk[0].date,
        batch: chunk[0].date.replace(/-/g, '') + '-b' + ((db.batch[chunk[0].date] || 0) + 1),
        part: part, parts: parts,
        events: chunk.map(function (r) {
          var e = {};
          Object.keys(r).forEach(function (k) {
            if (k === 'rawIdx') return;
            if (k === 'tool' || k === 'date') return;   // 外層 envelope 已帶，逐筆不重複（省字數）
            if (k === 'count' && r.count === 1) return;
            e[k] = r[k];
          });
          return e;
        })
      };
      /* 第一行＝機器指紋 `#CM-EVENTS v1` ＋一句白話摘要，第二行起才是 JSON。
         摘要放在指紋後面而不是前面，是為了**不動排程端 R18 的命中條件**（首行以 #CM-EVENTS 開頭）；
         老師在 Notion 收件匣看到的標題因此變成
         「#CM-EVENTS v1 · 📋 作業清點 09/07 · 27 筆：作業完成×24」——每一列都讀得懂。
         （2026-09-07 老師要求：Notion 標題本身就要清楚，不要靠班網另外翻譯。） */
      return '#CM-EVENTS v1 · ' + headline(body) + '\n' + JSON.stringify(body);
    }

    /* 摘要用的短行為名：班規名稱常是「A、B」的情境列舉（例④ bad0＝
       「作業缺交、複習卷沒交」），整串照抄進標題會讓老師以為今天真的有複習卷
       （2026-09-09 老師回報）。摘要只取第一個情境，完整行為名仍原封留在 JSON
       明細與寫進紀錄庫的欄位裡，週結比對不受影響。 */
    /* 2026-09-17 改：原本「取第一個、之前」會把「衝突動口（罵人、挑釁）」切成「衝突動口（罵人」。
       改成作業清點依狀態對固定短名，其他工具保留原名（與班網 teacher.js cmAct 同口徑）。 */
    var HW_ACT = { 0: '作業缺交', 1: '作業潦草／未訂正' };
    function shortAct(e, tool) {
      if (!e.act) return '';
      if (tool === 'homework' && e.src === 'rule' && e.rule_n === 4 && HW_ACT[e.act_i]) return HW_ACT[e.act_i];
      return String(e.act).trim();
    }

    /* 一行摘要：📋 作業清點 09/07 · 27 筆：作業完成×24、未帶課本×3（第1/3包） */
    function headline(body) {
      var evs = body.events || [];
      var by = {};
      evs.forEach(function (e) { var k = shortAct(e, body.tool) || '（未填行為）'; by[k] = (by[k] || 0) + 1; });
      var acts = Object.keys(by).sort(function (a, b) { return by[b] - by[a]; });
      var brief = acts.slice(0, 3).map(function (a) { return a + '×' + by[a]; }).join('、') +
                  (acts.length > 3 ? ' 等' + acts.length + '種' : '');
      return '📋 ' + (TOOL_NAMES[body.tool] || body.tool || '課堂工具') +
             ' ' + String(body.date || '').slice(5).replace('-', '/') +
             ' · ' + evs.length + ' 筆：' + brief +
             (body.parts > 1 ? '（第' + body.part + '/' + body.parts + '包）' : '');
    }

    // 先切成「同一天同一工具」一組，再依長度切包
    var groups = {};
    rows.forEach(function (r) {
      var g = r.tool + '|' + r.date;
      (groups[g] = groups[g] || []).push(r);
    });

    var payloads = [];
    Object.keys(groups).forEach(function (g) {
      var rest = groups[g].slice();
      var chunks = [];
      while (rest.length) {
        var take = rest.length;
        while (take > 1 && pack(rest.slice(0, take), 1, 1).length > MAX_TEXT) take--;
        chunks.push(rest.slice(0, take));
        rest = rest.slice(take);
      }
      chunks.forEach(function (c, i) {
        payloads.push({ text: pack(c, i + 1, chunks.length), rows: c, part: i + 1, parts: chunks.length });
      });
    });
    return payloads;
  }

  /* 對外仍回「字串陣列」，送出端不受影響。 */
  function buildPayloads() { return buildPacks().map(function (p) { return p.text; }); }

  /* 預覽用：把同一批包翻成老師看得懂的任務說明（2026-09-06 老師回饋：原本直接倒 JSON 看不懂）。
     這裡只負責描述，送出去的仍是 pack() 產生的 #CM-EVENTS 原文。 */

  var CIRCLED = ['⓪', '①', '②', '③', '④', '⑤', '⑥', '⑦', '⑧', '⑨', '⑩'];

  function describeRow(r, i) {
    var head = ' ' + (i + 1) + '. 座號 ' + r.seat;
    var what = r.src === 'rule'
      ? '班規' + (CIRCLED[r.rule_n] || ('第' + r.rule_n + '條')) + '「' + (r.act || '') + '」'
      : (r.act || '');
    var tail = [];
    // period 常常已經含科目（「第一節·數學」），再列一次科目會變「數學・第一節·數學」
    if (r.subj && String(r.period || '').indexOf(r.subj) < 0) tail.push(r.subj);
    if (r.period) tail.push(r.period);
    if (r.count > 1) tail.push(r.count + ' 次');
    var c = parseFloat(String(r.coin === undefined ? '' : r.coin).replace('−', '-'));
    var coin = (isNaN(c) || c === 0) ? '只記次數，不動金幣' : (c > 0 ? '+' : '') + c + ' 幣';
    return head + '　' + what + (tail.length ? '（' + tail.join('・') + '）' : '') + '　' + coin;
  }

  function describePayloads() {
    var packs = buildPacks();
    if (!packs.length) return '';
    var total = packs.reduce(function (a, p) { return a + p.rows.length; }, 0);
    var out = ['這次會送出 ' + packs.length + ' 個任務包，共 ' + total + ' 筆紀錄。',
               '送出後進「📥 任務收件匣」，排程每小時整點處理；處理完下方「任務狀態」會變成「已完成」。'];
    packs.forEach(function (p, pi) {
      var sum = 0, tally = 0;
      p.rows.forEach(function (r) {
        var c = parseFloat(String(r.coin === undefined ? '' : r.coin).replace('−', '-'));
        if (isNaN(c) || c === 0) tally++; else sum += c;
      });
      var money = (tally === p.rows.length)
        ? '這包不動金幣（' + tally + ' 筆只記次數）'
        : '金幣合計：' + (sum > 0 ? '+' : '') + sum + ' 幣' +
          (tally ? '（另有 ' + tally + ' 筆只記次數、不動金幣）' : '');
      out.push('');
      out.push('── 任務包 ' + (pi + 1) + '／' + packs.length + ' ' + Array(20).join('─'));
      out.push('來源：' + (TOOL_NAMES[p.rows[0].tool] || p.rows[0].tool) +
               '　日期：' + p.rows[0].date +
               '　' + p.rows.length + ' 筆　' + money +
               (p.parts > 1 ? '　（本組第 ' + p.part + '／' + p.parts + ' 段）' : ''));
      out.push('');
      p.rows.forEach(function (r, i) { out.push(describeRow(r, i)); });
      out.push('');
      out.push('（送出的任務標題就是這一行：' + p.text.split('\n')[0] + '）');
    });
    return out.join('\n');
  }

  /* 除錯用：還是拿得到原始封包 */
  function rawPayloads() { return buildPayloads().join('\n\n'); }

  /* 送出全部成功後才呼叫：清空待送、把當天批次號往前推一格。 */
  function markSent() {
    var db = read();
    var dates = {};
    db.pending.forEach(function (ev) { dates[ev.date] = true; });
    Object.keys(dates).forEach(function (d) { db.batch[d] = (db.batch[d] || 0) + 1; });
    db.pending = [];
    db.sent = [];
    return write(db);
  }

  /* ── 四點提醒（2026-09-06）─────────────────────────────
     全自動送出做不到也不該做：待送事件在這台電腦的 localStorage，排程讀不到；
     而口令依 §3.4 永不落地（投影時全班看得到畫面）。所以只提醒，送出仍是老師按的那一下。
     16:00 之後、還有待送、今天沒按過「不再提醒」→ due。 */
  /* 放學時間依星期不同（2026-09-06 老師定）：週三、五 12:40 放學，週一、二、四 16:00。
     週六日沒有放學時間，沿用 16:00（週末還留著待送就是該送了）。改時間改這張表就好。 */
  var REMIND_AT = {            // 0=週日 … 6=週六，值＝當天幾點幾分開始提醒（分鐘）
    0: 16 * 60, 1: 16 * 60, 2: 16 * 60, 3: 12 * 60 + 40,
    4: 16 * 60, 5: 12 * 60 + 40, 6: 16 * 60
  };
  var DISMISS_KEY = 'classManager.events.remindOff';

  /* 今天幾點開始提醒，回 "16:00" 這種字串供畫面顯示。 */
  function remindAtText(d) {
    var m = REMIND_AT[(d || new Date()).getDay()];
    return String(Math.floor(m / 60)).padStart(2, '0') + ':' + String(m % 60).padStart(2, '0');
  }

  function remindDue() {
    var n = merged().length;
    if (!n) return { due: false, n: 0, at: remindAtText() };
    var now = new Date();
    if (now.getHours() * 60 + now.getMinutes() < REMIND_AT[now.getDay()]) {
      return { due: false, n: n, at: remindAtText(now) };
    }
    var off = null;
    try { off = localStorage.getItem(DISMISS_KEY); } catch (e) {}
    return { due: off !== today(), n: n, at: remindAtText(now) };
  }

  function dismissRemind() {
    try { localStorage.setItem(DISMISS_KEY, today()); return true; } catch (e) { return false; }
  }

  global.CMEvents = {
    REMIND_AT: REMIND_AT, remindAtText: remindAtText, remindDue: remindDue, dismissRemind: dismissRemind,
    KEY: KEY, today: today, push: push, list: list, count: count, clearTool: clearTool,
    merged: merged, buildPayloads: buildPayloads,
    describePayloads: describePayloads, rawPayloads: rawPayloads,
    markSent: markSent, isPackSent: isPackSent, markPackSent: markPackSent,
    logFail: logFail, failLog: failLog, clearFailLog: clearFailLog, withSendLog: withSendLog,
    removeAt: removeAt, clearAll: clearAll
  };
})(window);
