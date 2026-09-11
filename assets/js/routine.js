/* 工作檢核台（Phase 3-2）：一天的時序收成一頁，五站。
 *
 *   1 到校簽到 → 2 打掃工作（分三區）→ 3 作業清點 → 4 午餐工作 → 5 潔牙
 *
 * 設計計畫 docs/設計計畫_課堂資料採集Phase2.md §4 ＋ docs/設計藍圖與路線圖.md §3-2。
 * 三條鐵則照做：
 *  1. **例外管理**：預設全班達成，老師只點例外（多數時段 0 動作）。
 *  2. **點完當場投影修復方式**——`fix` 文字來自 Notion 班規，程式沒有發揮空間。
 *  3. **不排名、不做排行榜**（通用鐵則 6）。
 *
 * 五站各佔一個 tool 名，不共用：每站的「結算」都是**整批重算**（clearTool 後重 push），
 * 共用 tool 名會讓 A 站的重新結算把 B 站的結果一起清掉。
 *
 * 前端一律不算錢：班規事件的 coin／level 原封轉抄 class-rules.json；
 * 其餘一律 src:'tally'（不入帳，只記次數，供 class-bank 週結公式用）。
 * 本站送得出的 tally：打掃未達標／打掃缺席／打掃支援／作業完成／午餐支援／午餐缺席／常規未達成。
 *
 * 缺席依原因分（2026-09-11 計分口徑定案，討論紀錄 §六 A）：
 *   打掃 ✗ 請假／🎫 免打掃券／⛔ 無故；午餐 ✗ 請假／⛔ 無故（午餐沒有免工作特權）。
 *   三種都送原 act「打掃缺席／午餐缺席」（週結撈取鍵不變）、kind 一律 'neutral'、原因寫 note；
 *   只有「無故」另送一筆班規⑦「答應的工作或幹部職務擺爛」（幣值照抄 class-rules.json）。
 *
 * ⚠️ 原「上午課堂」分頁在 3-2 移除：電子白板的座位板長按（右鍵）就是同一套班規選單，
 *    而且白板才是上課中投影的那一頁。留兩個入口只會讓同一件事有兩個正本。
 */
(function () {
  'use strict';
  var $ = Tool.$;
  var seats = Tool.requireSeats($('stage'));
  if (!seats) { $('hud').style.display = 'none'; return; }

  var BASE = 'https://flyshan2010.github.io/class-website/data/';
  var TOOL = { arrive: 'arrive', clean: 'cleanup', hw: 'homework', lunch: 'lunch', teeth: 'teeth' };

  /* 各站的狀態表。tone 是語意色，不綁序號——各站的「第 2 態」不是同一件事
     （打掃 △ 到位未達標是橘、午餐 ✗ 未到是粉）。第 0 態一律＝達成，不產生事件。 */
  var ST = {
    /* 到校與打掃改成「未點擊起跳」（2026-09-07 老師指定）：點一下才變出席／到位，
       學生看得到自己被點名的那一下，老師也一眼看得出哪幾個還沒點到。
       第 0 態＝還沒點，一樣不產生事件。 */
    arrive: [{ m: '', l: '未點名', t: 'idle' }, { m: '✓', l: '出席', t: 'ok' },
             { m: '⏰', l: '遲到', t: 'warn' }, { m: '✗', l: '未到', t: 'pink' }],
    /* 打掃的「＋ 支援」不再是成員的第 5 態（2026-09-10 老師：實際沒有固定支援）——
       改由各組卡片上的「＋ 加支援」當天指派任何人，存在 st.cleanSup，有支援才多發那一次薪水。 */
    /* 缺席拆原因（2026-09-11，sv 4→5）：請假、免打掃券是出勤不是行為（紫・中性）；
       無故＝班規⑦（粉）。順序＝出現頻率，請假最常見排最前。 */
    clean: [{ m: '', l: '未檢核', t: 'idle' }, { m: '✓', l: '到位達標', t: 'ok' },
            { m: '△', l: '到位未達標', t: 'warn' },
            { m: '✗', l: '請假', t: 'purple' }, { m: '🎫', l: '免打掃券', t: 'purple' },
            { m: '⛔', l: '無故未到', t: 'pink' }],
    /* 午餐支援比照打掃改浮動（2026-09-11 老師：午餐有人請假要能指派別人補位）——
       不再是成員的第 5 態，改由各崗位卡片「＋ 加支援」選人，存在 st.lunchSup（sv 5→6）。 */
    lunch: [{ m: '', l: '未檢核', t: 'idle' }, { m: '✓', l: '到位', t: 'ok' },
            { m: '✗', l: '請假', t: 'purple' }, { m: '⛔', l: '無故未到', t: 'pink' }],
    /* 潔牙／含氟（2026-09-11 老師定案，sv 6→7）：沒點＝沒做；「↻ 補做完成」＝當作做到。
       結算時仍沒做＝不肯重做 → 常規未達成＋班規⑦。 */
    teeth: [{ m: '', l: '沒做', t: 'pink' }, { m: '✓', l: '已潔牙', t: 'ok' }, { m: '↻', l: '補做完成', t: 'blue' }],
    /* 含氟漱口水：一週只有一次，由老師當天自己開（2026-09-07 老師要求），狀態與潔牙同三態。 */
    fluoride: [{ m: '', l: '沒做', t: 'pink' }, { m: '✓', l: '已漱口', t: 'ok' }, { m: '↻', l: '補做完成', t: 'blue' }]
  };

  var TAB_TITLE = {
    arrive: '點座號簽到：未點名 → ✓ 出席 → ⏰ 遲到 → ✗ 未到（請假）',
    clean: '點座號檢核：未檢核 → ✓ 達標 → △ 未達標 → ✗ 請假 → 🎫 免打掃券 → ⛔ 無故；支援按各組「＋ 加支援」',
    hw: '未交 → 已交 → 要訂正 → 完成；右上可切「🪑 座位表／🔢 座號清單」',
    lunch: '點座號檢核：未檢核 → ✓ 到位 → ✗ 請假 → ⛔ 無故；有人補位按各崗位「＋ 加支援」',
    teeth: '沒點＝沒做：點一下 ✓ 已潔牙 → 再點 ↻ 補做完成；結算時仍沒做的記常規未達成＋班規⑦'
  };

  /* 五站的狀態存一起，一天一份；week 留每天的打掃快照供「本週總覽」。 */
  var sdb = Tool.store('classManager.routine.v2');
  var st = sdb.get(null);
  /* 狀態編號版本：v3 起到校／打掃多了第 0 態「未點」，舊號碼的語意整個位移，
     照舊資料畫會變成「昨天的出席今天顯示成遲到」。版本不合就重來，不硬搬。
     v5（2026-09-11）：打掃／午餐缺席拆原因，午餐 3 由「＋支援」變「無故」——舊值不可沿用。
     v6（2026-09-11）：午餐第 4 態「＋支援」移除，改浮動指派（st.lunchSup）。
     v7（2026-09-11）：潔牙／含氟第 2 態由「✗ 沒做」改為「↻ 補做完成」（沒點才是沒做）。 */
  if (st && st.sv !== 7) st = null;
  if (!st || st.date !== Tool.todayKey()) {
    st = { date: Tool.todayKey(), sv: 7, arrive: {}, clean: {}, lunch: {}, teeth: {},
           fluoride: {}, fluorideOn: false, week: (st && st.week) || {}, weekSup: (st && st.weekSup) || {} };
  }
  /* 今天的浮動支援：{ 組別名: [座號…] }。
     ⚠️ 原本這裡會刪掉打掃狀態 4（sv4 以前的「＋支援」）；sv5 起 4＝🎫 免打掃券，
     舊資料已由上面的版本檢查整份重來，那行刪除碼留著會把免打掃券靜默吃掉（2026-09-11 實測抓到）。 */
  if (!st.cleanSup) st.cleanSup = {};
  if (!st.lunchSup) st.lunchSup = {};
  if (!st.weekSup) st.weekSup = {};
  ['arrive', 'clean', 'lunch', 'teeth', 'fluoride'].forEach(function (k) { if (!st[k]) st[k] = {}; });
  if (!st.week) st.week = {};
  // v1 → v2：只搬「今天的打掃狀態」與週總覽，其餘讓它重來（跨版本硬搬容易搬出假資料）
  (function migrate() {
    if (Object.keys(st.clean).length || Object.keys(st.week).length) return;
    var old = Tool.store('classManager.routine.v1').get(null);
    if (!old) return;
    st.week = old.week || {};
    if (old.date === st.date && old.clean) st.clean = old.clean;
    sdb.set(st);
  })();

  /* 作業清點 v3（2026-09-08 老師要求）：每一筆作業的鍵＝「派出日期｜名稱」。
     v2 用純名稱當鍵，「聯絡簿」天天同名——昨天點完的完成狀態今天照樣讀得到，
     老師得先把整列設回未交才能清點。加上日期後，每天自然長出新的一列，
     沒交完的舊項目也因為鍵帶日期，一眼看得出是哪一天欠的。
     不從 v2 搬資料：舊鍵沒有日期，硬搬會把昨天的完成狀態掛到今天那列（正是要修的 bug）。 */
  var hdb = Tool.store('classManager.homework.v3');
  var hw = hdb.get({ date: '', srcDate: '', items: [], status: {}, carry: {} });
  if (!Array.isArray(hw.items)) hw.items = [];
  if (!hw.status) hw.status = {};
  if (!hw.carry) hw.carry = {};
  hw.date = Tool.todayKey();          // 跨日不清空狀態：沒交完的要結轉，清空就沒得追
  var HW_STATES = ['未交', '已交', '要訂正', '完成'];
  var HW_MARK = ['未交', '已交', '訂正', '完成'];
  var HW_TONE = ['pink', 'blue', 'warn', 'ok'];   // 未交＝粉紅，投影時一眼看得出誰還沒交
  var hwView = 'all';   // 'all'＝一張表掛全部作業；其餘＝單一份作業的 key
  /* 版面兩種，各有各的場合（老師 2026-09-08）：
     seat＝座位表，看得出「誰」還沒交；list＝座號清單，一列一份作業、座號由小到大，登記最快。
     選擇記在 localStorage，隔天開頁維持上次用的那一種。 */
  var ldb = Tool.store('classManager.homework.layout');
  var layout = ldb.get('seat') === 'list' ? 'list' : 'seat';
  var showDone = false;         // 清單版面：完成的座號預設消失，這顆可以叫回來改

  /* ↶ 復原上一步（2026-09-12 老師：學生誤按「全部」蓋掉紀錄、作業清點按過頭）。
     每次存檔前的狀態進堆疊；同一個點擊（同一輪事件）裡的多次存檔併成一步。最多 30 步，只留在這次開頁。
     做法是包住 sdb／hdb 的 set，所以**所有**會改狀態的按鈕自動納入，不必逐顆記得加。 */
  var UNDO_MAX = 30, undoStack = [], undoBatch = false;
  var saved = { st: JSON.stringify(st), hw: JSON.stringify(hw) };
  var rawSet = { st: sdb.set, hw: hdb.set };
  function remember(which, v) {
    if (!undoBatch) {
      undoStack.push({ st: saved.st, hw: saved.hw });
      if (undoStack.length > UNDO_MAX) undoStack.shift();
      undoBatch = true;
      setTimeout(function () { undoBatch = false; }, 0);
    }
    saved[which] = JSON.stringify(v);
    return rawSet[which](v);
  }
  sdb.set = function (v) { return remember('st', v); };
  hdb.set = function (v) { return remember('hw', v); };
  // 雲端帶入作業等「不是老師點的」變動：更新基準但不進復原，免得按復原把剛讀進來的作業退掉
  function quietSet(which, v) { saved[which] = JSON.stringify(v); return rawSet[which](v); }
  function undoLast() {
    var u = undoStack.pop();
    if (!u) { flashFix('沒有可以復原的動作', '這次開頁以來的點選都已經退回去了'); return; }
    st = JSON.parse(u.st); hw = JSON.parse(u.hw);
    quietSet('st', st); quietSet('hw', hw);
    if (pnl) pnl.close();
    Tool.beep(1, 600); paint(); paintPend();
    flashFix('↶ 已復原上一步', '還可以再按，一次退一步（這次開頁最多 ' + UNDO_MAX + ' 步）');
  }

  /* 點一下＝下一個狀態；長按（或右鍵）＝退回上一個狀態——按過頭不必再繞一整圈（2026-09-12 老師）。 */
  function cycleTap(el, step) {
    var timer = null, longDone = false;
    el.addEventListener('pointerdown', function (e) {
      if (e.button !== 0) return;
      longDone = false; clearTimeout(timer);
      timer = setTimeout(function () { longDone = true; step(-1); }, 550);
    });
    ['pointerup', 'pointerleave', 'pointercancel'].forEach(function (t) {
      el.addEventListener(t, function () { clearTimeout(timer); });
    });
    el.addEventListener('click', function () { if (longDone) { longDone = false; return; } step(1); });
    el.addEventListener('contextmenu', function (e) {
      e.preventDefault(); clearTimeout(timer);
      if (!longDone) step(-1);
      longDone = false;
    });
  }
  /* 清單版面點到「完成」不立刻消失：留 4 秒讓老師看得到、按過頭來得及退回 */
  var recentDone = {};
  function hwStep(it, seat, dir) {
    var nv = (hwState(it.key, seat) + dir + 4) % 4, k = it.key + '|' + seat;
    hwSet(it.key, seat, nv);
    if (nv === 3) {
      recentDone[k] = true;
      setTimeout(function () { delete recentDone[k]; if (tab === 'hw') paintHw(); }, 4000);
    }
    Tool.beep(1, nv === 3 ? 720 : 520); paintHw(); paintPend();
    flashFix(seat + ' 號 · ' + it.name + ' → ' + HW_STATES[nv],
      dir > 0 ? '按過頭了？長按（或右鍵）這格退一格，或按下方「↶ 復原」' : '已退回一格');
  }

  var cache = Tool.store('classManager.routine.cache');
  var data = cache.get({ rules: null, duties: null, seating: null, lunch: null, weeks: null });
  var tab = 'arrive', zoneFilter = 'all';

  /* ── 雲端資料：先畫快取、再非強制更新（斷網照常可用）───────────────── */
  function pull(name, key, pick) {
    return fetch(BASE + name + '?t=' + Date.now(), { cache: 'no-store' })
      .then(function (r) { if (!r.ok) throw 0; return r.json(); })
      .then(function (j) { var v = pick ? pick(j) : j; if (v) { data[key] = v; cache.set(data); } })
      .catch(function () {});
  }

  function cardOf(n) {
    return ((data.rules || []).filter(function (c) { return Number(c.n) === Number(n); })[0]) || null;
  }
  function actOf(n, kind, i) { var c = cardOf(n); return c && (c[kind] || [])[i] ? c[kind][i] : null; }

  /* 缺席原因（寫進 note）與「無故」的狀態號。無故另記班規⑦——用行為名稱找 act_i，
     不寫死序號：班規卡增刪一行，序號就位移，排程端核對幣值會整批 E07。 */
  var ABSENT = { clean: { 3: '請假', 4: '免打掃券', 5: '無故' }, lunch: { 2: '請假', 3: '無故' } };
  var NOSHOW = { clean: 5, lunch: 3 };
  var NOSHOW_ACT = '答應的工作或幹部職務擺爛';
  function noShowRule() {
    var bad = (cardOf(7) || {}).bad || [];
    for (var i = 0; i < bad.length; i++) if (bad[i].act === NOSHOW_ACT) return { i: i, a: bad[i] };
    return null;
  }
  /* 常規沒做到、也不肯重做 → 班規⑦（2026-09-11 老師定案，Notion 📋 班規與獎懲 新增這一行） */
  var ROUTINE_ACT = '常規沒做到、也不肯重做';
  function routineRule() {
    var bad = (cardOf(7) || {}).bad || [];
    for (var i = 0; i < bad.length; i++) if (bad[i].act === ROUTINE_ACT) return { i: i, a: bad[i] };
    return null;
  }
  function noShowFix() {
    var r = noShowRule();
    return r ? '那次沒薪水，另記班規⑦「' + NOSHOW_ACT + '」' + r.a.coin + '　·　' + (r.a.fix || '')
             : '結算時會照班規⑦記一筆（目前讀不到班規，請先按「☁ 重讀雲端資料」）';
  }
  function absentEvents(kind, seat, v, period) {
    var why = ABSENT[kind][v];
    if (!why) return [];
    var tool = TOOL[kind], evs = [{ tool: tool, date: st.date, seat: seat, src: 'tally', dedupe: 'day',
      kind: 'neutral', act: kind === 'clean' ? '打掃缺席' : '午餐缺席', period: period, note: why }];
    var r = v === NOSHOW[kind] && noShowRule();
    if (r) evs.push({ tool: tool, date: st.date, seat: seat, src: 'rule', rule_n: 7, kind: 'bad',
      act_i: r.i, act: r.a.act, coin: r.a.coin, level: r.a.level, period: period });
    return evs;
  }

  /* ── 狀態存取（四個狀態式站共用）──────────────────────────── */
  function stateOf(kind, seat) { return st[kind][seat] || 0; }
  function setState(kind, seat, v) {
    if (v === 0) delete st[kind][seat]; else st[kind][seat] = v;
    if (kind === 'clean') st.week[st.date] = st.clean;
    sdb.set(st);
  }
  /* 浮動支援：打掃存 st.cleanSup、午餐存 st.lunchSup，格式同為 { 組別／崗位名: [座號…] }。
     本週總覽（weekSup）只有打掃用。 */
  var SUP = { clean: { key: 'cleanSup', pay: '打掃薪水' }, lunch: { key: 'lunchSup', pay: '午餐工作薪水' } };
  function supportOf(kind, group) { return st[SUP[kind].key][group] || []; }
  function toggleSupport(kind, group, seat) {
    var box = st[SUP[kind].key], list = supportOf(kind, group).slice(), i = list.indexOf(seat);
    if (i >= 0) list.splice(i, 1); else list.push(seat);
    if (list.length) box[group] = list.sort(function (a, b) { return a - b; });
    else delete box[group];
    if (kind === 'clean') st.weekSup[st.date] = st.cleanSup;
    sdb.set(st);
    return i < 0;
  }

  /* 進度＋一鍵列（到校、打掃用）：老師一眼看得出「還有幾個沒點」，
     「全部○○」只填**還沒點**的，已標遲到／未達標的不會被蓋掉（2026-09-07）。 */
  function actionBar(kind, list, allLabel, allValue) {
    var bar = document.createElement('div'); bar.className = 'statbar';
    var done = list.filter(function (s) { return stateOf(kind, s) !== 0; }).length;
    var left = list.length - done;
    var info = document.createElement('span'); info.className = 'sb-n';
    info.innerHTML = '已點 <b>' + done + '</b> / ' + list.length +
      (left ? '　<span class="sb-left">還有 ' + left + ' 個沒點</span>' : '　<span class="sb-ok">全部點完了</span>');
    bar.appendChild(info);
    var all = document.createElement('button');
    all.type = 'button'; all.className = 'sb-all'; all.disabled = !left;
    all.textContent = allLabel + (left ? '（' + left + '）' : '');
    all.addEventListener('click', function () {
      // 學生經過投影幕誤按過（2026-09-12 老師回報），一鍵改全班一律先確認
      if (!confirm('把還沒點的 ' + left + ' 位全部設成「' + ST[kind][allValue].l + '」嗎？\n\n' +
                   '已經點好的不會被蓋掉；按錯可以按下方「↶ 復原」。')) return;
      list.forEach(function (s) { if (stateOf(kind, s) === 0) setState(kind, s, allValue); });
      Tool.beep(2, 760); paint(); paintPend();
    });
    bar.appendChild(all);
    var clr = document.createElement('button');
    clr.type = 'button'; clr.className = 'sb-clear'; clr.disabled = !done;
    clr.textContent = '↺ 全部重來';
    clr.addEventListener('click', function () {
      if (!confirm('把這一站全部改回「還沒點」嗎？')) return;
      list.forEach(function (s) { setState(kind, s, 0); });
      paint(); paintPend();
    });
    bar.appendChild(clr);
    return bar;
  }

  /* ── 共用元件：一張檢核卡（打掃、午餐都用這個）──────────────────── */
  function renderCards(box, kind, cards, emptyHtml) {
    box.innerHTML = '';
    if (!cards) { box.innerHTML = emptyHtml; fallbackCard(box, kind); return; }
    if (!cards.length) { box.innerHTML = '<div class="empty">這個範圍沒有分配到的小組</div>'; return; }
    cards.forEach(function (c) {
      var el = document.createElement('div'); el.className = 'zcard';
      var head = document.createElement('div'); head.className = 'zhead';
      head.innerHTML = '<span class="zname">' + esc(c.name) + '</span>' +
        (c.sub ? '<span class="zsub">' + esc(c.sub) + '</span>' : '') +
        (c.right ? '<span class="zsup">' + esc(c.right) + '</span>' : '');
      el.appendChild(head);
      var ppl = document.createElement('div'); ppl.className = 'people';
      c.people.forEach(function (p) { ppl.appendChild(personCard(kind, p.seat, p.duty)); });
      if (c.supGroup) {
        supportOf(kind, c.supGroup).forEach(function (s) { ppl.appendChild(supportCard(kind, c.supGroup, s)); });
        ppl.appendChild(addSupportCard(kind, c.supGroup, c.people));
      }
      el.appendChild(ppl);
      if (c.info) el.addEventListener('dblclick', function () { openPanel(c.info); });
      box.appendChild(el);
    });
  }

  /* 浮動支援（2026-09-10）：卡片上是藍色「＋ 支援」，點一下取消；最後一格「＋ 加支援」開選人面板。 */
  function supportCard(kind, group, seat) {
    var el = document.createElement('div'); el.className = 'pcard t-blue';
    el.innerHTML = '<div class="pn">' + seat + '</div><div class="ps">＋ 支援</div>';
    el.title = '點一下取消這位的支援';
    el.addEventListener('click', function () {
      toggleSupport(kind, group, seat); Tool.beep(1, 640); paint(); paintPend();
      flashFix(seat + ' 號 · 取消支援「' + group + '」', '這次不算支援，週結不會多發');
    });
    return el;
  }
  function addSupportCard(kind, group, people) {
    var el = document.createElement('div'); el.className = 'pcard t-idle addsup';
    el.innerHTML = '<div class="pn">＋</div><div class="ps">加支援</div>';
    el.addEventListener('click', function () { openSupportPicker(kind, group, people); });
    return el;
  }
  function openSupportPicker(kind, group, people) {
    var own = people.map(function (p) { return p.seat; });
    function draw() {
      var on = supportOf(kind, group);
      openPanel('<h2>＋ 今天誰來支援？</h2><p class="hint">' + esc(group) +
        '　·　點座號加入，再點一次取消。有支援才多發這一次' + SUP[kind].pay + '；本' + (kind === 'lunch' ? '崗位' : '組') + '成員不列出。</p>' +
        '<div class="supgrid">' + seats.filter(function (s) { return own.indexOf(s) < 0; }).map(function (s) {
          return '<button type="button" class="stbtn' + (on.indexOf(s) >= 0 ? ' t-blue' : '') +
            '" data-s="' + s + '">' + s + (on.indexOf(s) >= 0 ? ' ＋' : '') + '</button>';
        }).join('') + '</div>');
      Array.prototype.forEach.call($('panel-body').querySelectorAll('.supgrid button'), function (b) {
        b.addEventListener('click', function () {
          var s = Number(b.dataset.s), added = toggleSupport(kind, group, s);
          Tool.beep(1, added ? 760 : 640); draw(); paint(); paintPend();
          if (added) flashFix(s + ' 號 · 臨時支援「' + group + '」', '週結多發這一次' + SUP[kind].pay + '（不當場加幣）');
        });
      });
    }
    draw();
  }

  /* 拿不到分配資料時的退路：一般座號網格照樣可以檢核（§4.6 明訂要有這條退路）。 */
  function fallbackCard(box, kind) {
    var card = document.createElement('div'); card.className = 'zcard';
    card.innerHTML = '<div class="zhead"><span class="zname">全班座號</span>' +
      '<span class="zsub">尚未帶入分組與個人責任範圍</span></div>';
    var ppl = document.createElement('div'); ppl.className = 'people';
    seats.forEach(function (s) { ppl.appendChild(personCard(kind, s, '')); });
    card.appendChild(ppl); box.appendChild(card);
  }

  function personCard(kind, seat, duty) {
    var states = ST[kind], v = stateOf(kind, seat) % states.length;
    var el = document.createElement('div'); el.className = 'pcard t-' + states[v].t;
    el.innerHTML = '<div class="pn">' + seat + '</div>' +
      (duty ? '<div class="pm">' + esc(duty) + '</div>' : '') +
      '<div class="ps">' + states[v].m + ' ' + states[v].l + '</div>';
    el.addEventListener('click', function () {
      var nv = (stateOf(kind, seat) + 1) % states.length;
      setState(kind, seat, nv);
      Tool.beep(1, nv === 0 ? 720 : 520);
      paint(); paintPend();
      explain(kind, seat, nv);
    });
    return el;
  }

  /* 點下去當場投影「這代表什麼、會怎麼處理」——老師與學生都不必記規則。 */
  function explain(kind, seat, v) {
    if (!v) return;
    var who = seat + ' 號 · ';
    if (kind === 'clean') {
      if (v === 2) flashFix(who + '打掃未達標（這次不扣幣）',
        (actOf(3, 'bad', 0) || {}).fix + '　·　同一週第 3 次起才會扣 5 幣');
      if (v === 3) flashFix(who + '打掃請假（不是行為問題）', '週結薪水少算這一次出勤，不扣幣、不記班規');
      if (v === 4) flashFix(who + '使用免打掃一次券', '這次沒有打掃薪水，不扣幣、不記班規（兌換紀錄已扣過就不重扣）');
      if (v === 5) flashFix(who + '無故沒去打掃', noShowFix());
    } else if (kind === 'lunch') {
      if (v === 2) flashFix(who + '午餐工作請假（不是行為問題）', '週結午餐薪水少算一次，不扣幣、不記班規');
      if (v === 3) flashFix(who + '無故沒做午餐工作', noShowFix());
    } else if (kind === 'fluoride' || kind === 'teeth') {
      if (v === 2) flashFix(who + (kind === 'teeth' ? '潔牙' : '含氟漱口水') + '補做完成',
        '當作做到：不記任何紀錄，今天的班級常規獎勵 +1 照給');
    } else if (kind === 'arrive') {
      if (v === 2) flashFix(who + '上學遲到', (actOf(1, 'bad', 0) || {}).fix || '結算時會照班規①記一筆');
      if (v === 3) flashFix(who + '今天未到（請假／缺席）', '只留在這台電腦提醒老師，不會送出任何紀錄');
    }
  }

  /* ── 1 到校簽到：座位表輕點（與電子白板同一套手勢）──────────────── */
  function paintArrive() {
    var box = $('view-arrive'); box.innerHTML = '';
    $('legend').innerHTML = '<span>只有 <b>⏰ 遲到</b> 會照班規①記一筆，✗ 未到不送出</span>';
    box.appendChild(actionBar('arrive', seats, '✅ 全部出席', 1));
    var wrap = document.createElement('div'); wrap.className = 'seatgrid';
    var podium = document.createElement('div'); podium.className = 'podium'; podium.textContent = '講　台';
    wrap.appendChild(podium);
    var grid = (data.seating && data.seating.grid) || null;
    var rows = grid || chunk(seats, 6);
    rows.forEach(function (row) {
      var r = document.createElement('div'); r.className = 'srow';
      row.forEach(function (s) {
        var c = document.createElement('div');
        if (s == null) { c.className = 'scell gap'; r.appendChild(c); return; }
        var v = stateOf('arrive', s);
        c.className = 'scell t-' + ST.arrive[v].t;
        c.dataset.seat = s;
        c.innerHTML = s + (v ? '<span class="mk">' + ST.arrive[v].m + ' ' + ST.arrive[v].l + '</span>' : '');
        c.addEventListener('click', function () {
          var nv = (stateOf('arrive', s) + 1) % ST.arrive.length;
          setState('arrive', s, nv);
          Tool.beep(1, nv === 1 ? 760 : (nv === 0 ? 640 : 520));
          paintArrive(); paintPend(); explain('arrive', s, nv);
          /* 簽到感：重畫後把同一格找回來播一次點名動畫（學生看得到自己被點到的那一下） */
          var again = $('view-arrive').querySelector('[data-seat="' + s + '"]');
          if (again) { again.classList.add('pop'); setTimeout(function () { again.classList.remove('pop'); }, 420); }
        });
        r.appendChild(c);
      });
      wrap.appendChild(r);
    });
    box.appendChild(wrap);
    if (!grid) {
      var tip = document.createElement('div');
      tip.style.cssText = 'text-align:center;color:var(--chalk-3);font-size:clamp(13px,1.7vh,19px)';
      tip.textContent = '（還讀不到座位表，暫時依座號排列）';
      box.appendChild(tip);
    }
  }

  /* ── 2 打掃工作 ────────────────────────────────────────── */
  function cleanCards() {
    var d = data.duties;
    if (!d || !d.zones) return null;
    var out = [];
    d.zones.forEach(function (z) {
      z.groups.forEach(function (g) {
        if (zoneFilter !== 'all' && String(g.supervisor) !== zoneFilter) return;
        out.push({
          name: z.emoji + ' ' + g.group,
          sub: (g.title || '') + (g.standard ? '　·　驗收：' + g.standard : ''),
          right: g.supervisor ? '監督 ' + g.supervisor + ' 號' : '',
          supGroup: g.group,
          people: g.seats.map(function (s) {
            return { seat: s, duty: (g.personal || {})[s] || (g.personal || {})[String(s)] || '' };
          }),
          info: '<h2>' + esc(z.emoji + ' ' + g.group) + '</h2>' +
            '<p class="hint">' + esc(z.zone) + (g.supervisor ? '　·　監督 ' + g.supervisor + ' 號' : '') + '</p>' +
            section('工作職稱', g.title) + section('要做的事', g.work) +
            section('能管的事', g.authority) + section('做好的標準', g.standard) +
            section('配置掃具', (g.tools || []).join('、'))
        });
      });
    });
    return out;
  }

  function paintClean() {
    $('legend').innerHTML = '<span>△ 未達標與 ✗ 未到都<b>只記次數</b>，不當場扣幣；支援按各組「＋ 加支援」，有支援才多發那一次薪水</span>';
    var cards = cleanCards();
    var seen = {}, list = [];
    // 只數各組成員（支援者另外指派，不在「還有幾個沒點」裡）；同一座號出現在兩組時去重
    (cards || []).forEach(function (c) {
      c.people.forEach(function (p) { if (!seen[p.seat]) { seen[p.seat] = 1; list.push(p.seat); } });
    });
    if (!list.length) list = seats.slice();
    renderCards($('view-clean'), 'clean', cards,
      '<div class="empty"><span class="big">🧹</span>還讀不到掃區分配' +
      '<br><span style="font-size:.55em">連上網後會自動帶入班網的「🧹 班級工作分配」；' +
      '先用下面的一般座號檢核也可以</span></div>');
    var box = $('view-clean');
    box.insertBefore(actionBar('clean', list, '✅ 全部到位達標', 1), box.firstChild);
  }

  /* ── 3 作業清點（座位表模式，2026-09-08 老師拍板）──────────────────
     每筆作業＝{key,name,due}，key＝派出日期｜名稱。「聯絡簿」掛當天日期，隔天自動長出新的一列，
     不必再手動把昨天的還原成未交（v2 用純名稱當鍵，正是天天要還原的原因）。

     預設是「一張座位表掛全部作業」：一格＝一位學生，格子裡列出他**還沒完成**的作業短碼，
     交完一項就少一個徽章，全部交齊整格自動變暗——老師掃一眼就知道還要追誰、追什麼。
     要一項一項收（例如「數習交上來」）時，點上方的作業膠囊切成單項模式，一點一格最快。

     結轉列（前幾天派、還沒交完）只提醒，不進 collect()——同一份作業天天結算就會天天扣一次 −5。 */
  var CARRY_WARN_DAYS = 14;     // 追蹤超過這麼多天就提醒老師處理；**不自動下架**（靜默丟掉欠交比殘留更糟）
  function hwState(key, seat) { return (hw.status[key] && hw.status[key][seat]) || 0; }
  function hwSet(key, seat, v) {
    if (!hw.status[key]) hw.status[key] = {};
    if (v === 0) delete hw.status[key][seat]; else hw.status[key][seat] = v;
    hdb.set(hw);
  }
  function hwCounts(key) { var c = [0, 0, 0, 0]; seats.forEach(function (s) { c[hwState(key, s)]++; }); return c; }
  function hwUndone(key) { return seats.filter(function (s) { return hwState(key, s) !== 3; }); }
  function hwItem(key) { return hw.items.filter(function (x) { return x.key === key; })[0] || null; }
  /* 徽章短碼：取第一個空白／括號前的字，最多 4 字（「國習 L2 P.10–11」→ 國習）。 */
  function shortName(n) { return String(n || '').split(/[\s　（(]/)[0].slice(0, 4) || String(n).slice(0, 4); }
  function daysBetween(a, b) { return Math.round((new Date(b) - new Date(a)) / 86400000); }

  /* 座位表網格：makeCell(seat) 回傳一格，null＝走道留白。讀不到座位表就退回每列 6 個。 */
  function seatGrid(extraCls, makeCell) {
    var wrap = document.createElement('div'); wrap.className = 'seatgrid' + (extraCls ? ' ' + extraCls : '');
    var podium = document.createElement('div'); podium.className = 'podium'; podium.textContent = '講　台';
    wrap.appendChild(podium);
    var grid = (data.seating && data.seating.grid) || null;
    (grid || chunk(seats, 6)).forEach(function (row) {
      var r = document.createElement('div'); r.className = 'srow';
      row.forEach(function (s) {
        if (s == null) { var g = document.createElement('div'); g.className = 'scell gap'; r.appendChild(g); return; }
        r.appendChild(makeCell(s));
      });
      wrap.appendChild(r);
    });
    if (!grid) {
      var tip = document.createElement('div'); tip.className = 'gridtip';
      tip.textContent = '（還讀不到座位表，暫時依座號排列）';
      wrap.appendChild(tip);
    }
    return wrap;
  }

  /* 模式膠囊：👥 全部（依學生）＋ 每一份作業各一顆 */
  function hwPills(list) {
    var box = document.createElement('div'); box.className = 'hwpills';
    function pill(key, label, sub, cls) {
      var b = document.createElement('button');
      b.type = 'button'; b.className = 'hp' + (hwView === key ? ' on' : '') + (cls ? ' ' + cls : '');
      b.innerHTML = esc(label) + (sub ? '<span class="n">' + esc(sub) + '</span>' : '');
      b.addEventListener('click', function () { hwView = key; paintHw(); });
      box.appendChild(b);
    }
    pill('all', layout === 'list' ? '📋 全部作業' : '👥 全部（依學生）', '', '');
    list.forEach(function (it) {
      var left = hwUndone(it.key).length;
      pill(it.key, (hw.carry[it.key] ? '⏳ ' : '') + shortName(it.name), left ? left + ' 人未完成' : '交齊',
           left ? '' : 'ok');
    });
    var grow = document.createElement('span'); grow.className = 'pgrow'; box.appendChild(grow);
    var sw = document.createElement('div'); sw.className = 'layoutsw';
    [['seat', '🪑 座位表'], ['list', '🔢 座號清單']].forEach(function (o) {
      var b = document.createElement('button');
      b.type = 'button'; b.className = 'lw' + (layout === o[0] ? ' on' : '');
      b.textContent = o[1];
      b.title = o[0] === 'seat' ? '照座位排，一眼看出「誰」還沒交' : '一列一份作業、座號由小到大，登記最快';
      b.addEventListener('click', function () { layout = o[0]; ldb.set(layout); paintHw(); });
      sw.appendChild(b);
    });
    box.appendChild(sw);
    if (layout === 'list') {
      var sd = document.createElement('button');
      sd.type = 'button'; sd.className = 'lw solo' + (showDone ? ' on' : '');
      sd.textContent = showDone ? '隱藏已完成' : '顯示已完成';
      sd.addEventListener('click', function () { showDone = !showDone; paintHw(); });
      box.appendChild(sd);
    }
    return box;
  }

  /* 一位學生還沒完成的項目（含結轉），供聚合格與側面板共用 */
  function pendingOf(seat) {
    return hw.items.filter(function (it) { return hwState(it.key, seat) !== 3; });
  }

  /* 點格子 → 側面板逐項改狀態（格子太小塞不下四態循環，硬塞會點錯人） */
  function openSeatPanel(seat) {
    function draw() {
      var body = $('panel-body'); body.innerHTML = '';
      var h = document.createElement('div');
      h.innerHTML = '<h2>' + seat + ' 號的作業</h2><p class="hint">點右邊的狀態鈕循環：未交 → 已交 → 要訂正 → 完成；長按（或右鍵）退一格。</p>';
      body.appendChild(h);
      hw.items.forEach(function (it) {
        var v = hwState(it.key, seat);
        var r = document.createElement('div'); r.className = 'seatrow' + (v === 3 ? ' done' : '');
        r.innerHTML = '<span class="nm">' + (hw.carry[it.key] ? '⏳ ' : '') + esc(it.name) +
          '<span class="dy">' + esc(String(it.due || '').slice(5)) + ' 派</span></span>';
        var b = document.createElement('button');
        b.type = 'button'; b.className = 'stbtn t-' + HW_TONE[v]; b.textContent = HW_MARK[v];
        cycleTap(b, function (dir) {
          hwSet(it.key, seat, (hwState(it.key, seat) + dir + 4) % 4);
          Tool.beep(1, 520); draw(); paintHw(); paintPend();
        });
        r.appendChild(b); body.appendChild(r);
      });
      var row = document.createElement('div'); row.className = 'row';
      var all = document.createElement('button'); all.type = 'button'; all.textContent = '✅ 這位全部完成';
      all.addEventListener('click', function () {
        hw.items.forEach(function (it) { hwSet(it.key, seat, 3); });
        Tool.beep(2, 760); draw(); paintHw(); paintPend();
      });
      var none = document.createElement('button'); none.type = 'button'; none.className = 'ghost';
      none.textContent = '↺ 全設未交';
      none.addEventListener('click', function () {
        hw.items.forEach(function (it) { hwSet(it.key, seat, 0); });
        draw(); paintHw(); paintPend();
      });
      row.appendChild(all); row.appendChild(none); body.appendChild(row);
    }
    draw(); pnl.open();
  }

  /* 模式 A：一張座位表掛全部作業 */
  function paintHwAll(box, today, old) {
    var full = seats.filter(function (s) { return !pendingOf(s).length; }).length;
    var bar = document.createElement('div'); bar.className = 'statbar';
    var info = document.createElement('span'); info.className = 'sb-n';
    info.innerHTML = '全部交齊 <b>' + full + '</b> / ' + seats.length +
      (full === seats.length ? '　<span class="sb-ok">全班都交齊了</span>'
                             : '　<span class="sb-left">還有 ' + (seats.length - full) + ' 人有沒交完的</span>');
    bar.appendChild(info);
    var allb = document.createElement('button');
    allb.type = 'button'; allb.className = 'sb-all'; allb.disabled = full === seats.length;
    allb.textContent = '✅ 全班全部交齊';
    allb.addEventListener('click', function () {
      if (!confirm('把全班所有作業都設成「完成」嗎？\n\n（含 ⏳ 過去未完成的追蹤項，設完那些列會自動消失）')) return;
      hw.items.forEach(function (it) { seats.forEach(function (s) { hwSet(it.key, s, 3); }); });
      Tool.beep(2, 760); paintHw(); paintPend();
    });
    bar.appendChild(allb);
    box.appendChild(bar);

    var lg = document.createElement('div'); lg.className = 'hwlegend';
    lg.innerHTML = today.map(function (it) {
      var left = hwUndone(it.key).length;
      return '<span class="li"><b>' + esc(shortName(it.name)) + '</b>' + esc(it.name.slice(shortName(it.name).length)) +
             '<i>' + (left ? left + ' 人未完成' : '交齊 ✓') + '</i></span>';
    }).join('') || '<span class="li">今天沒有要清點的作業</span>';
    box.appendChild(lg);

    box.appendChild(seatGrid('agggrid', function (s) {
      var pend = pendingOf(s);
      var cell = document.createElement('div');
      cell.className = 'scell agg' + (pend.length ? '' : ' alldone');
      var bd = pend.map(function (it) {
        var v = hwState(it.key, s);
        return '<span class="b s' + v + (hw.carry[it.key] ? ' old' : '') + '">' +
               (hw.carry[it.key] ? '⏳' : '') + esc(shortName(it.name)) + '</span>';
      }).join('');
      cell.innerHTML = '<span class="sn">' + s + '</span>' +
        '<span class="bd">' + (pend.length ? bd : '<span class="ok">✓ 交齊</span>') + '</span>';
      cell.addEventListener('click', function () { openSeatPanel(s); });
      return cell;
    }));

    if (old.length) {
      var sec = document.createElement('div'); sec.className = 'hwsec';
      var h = document.createElement('div'); h.className = 'hwsec-h';
      h.innerHTML = '<span class="t">⏳ 過去未完成（補交追蹤）</span><span class="s">只提醒，不再結算、不重複扣分</span>';
      sec.appendChild(h);
      old.forEach(function (it) { sec.appendChild(oldLine(it)); });
      box.appendChild(sec);
    }
  }

  function oldLine(it) {
    var d = document.createElement('div'); d.className = 'oldline';
    var age = it.due ? daysBetween(it.due, Tool.todayKey()) : 0;
    d.innerHTML = '<span class="dy">' + esc(String(it.due || '').slice(5) || '之前') + ' 派</span>' +
      '<span class="nm">' + esc(it.name) + '</span>' +
      '<span class="who">還沒交完：' + hwUndone(it.key).join('、') + '</span>' +
      (age >= CARRY_WARN_DAYS ? '<span class="aged">已追蹤 ' + age + ' 天，該處理了</span>' : '');
    var b = document.createElement('button'); b.className = 'reset'; b.textContent = '✕ 不再追蹤';
    b.addEventListener('click', function () {
      if (!confirm('「' + it.name + '」不再追蹤？\n\n這一列會從清單消失（不影響已結算的紀錄）。')) return;
      delete hw.carry[it.key]; delete hw.status[it.key];
      hw.items = hw.items.filter(function (x) { return x.key !== it.key; });
      hdb.set(hw); paintHw();
    });
    d.appendChild(b);
    return d;
  }

  /* 一份作業的列首：名稱＋派出日期＋四態計數＋兩顆整列按鈕（兩種版面共用） */
  function hwHead(it) {
    var isCarry = !!hw.carry[it.key];
    var c = hwCounts(it.key);
    var head = document.createElement('div'); head.className = 'rowhead';
    var day = String(it.due || '').slice(5);
    head.innerHTML = '<span class="name">' + esc(it.name) + '</span>' +
      '<span class="' + (isCarry ? 'tagold' : 'tagday') + '">' +
        (isCarry ? '⏳ ' + esc(day || '之前') + ' 派・還沒交完' : '📅 ' + esc(day || '今天') + ' 派') + '</span>' +
      '<span class="cnt"><span class="u">未交 <b>' + c[0] + '</b></span>　<span class="a">已交 <b>' + c[1] +
      '</b></span>　<span class="c">要訂正 <b>' + c[2] + '</b></span>　<span class="d">完成 <b>' + c[3] +
      '</b></span></span><span class="grow"></span>';
    var done = document.createElement('button'); done.className = 'reset'; done.textContent = '✅ 全班完成';
    done.addEventListener('click', function () {
      if (!confirm('把「' + it.name + '」全班設成完成？')) return;
      seats.forEach(function (s) { hwSet(it.key, s, 3); });
      Tool.beep(2, 760); paintHw(); paintPend();
    });
    var reset = document.createElement('button'); reset.className = 'reset';
    reset.textContent = isCarry ? '✕ 不再追蹤' : '全設未交';
    reset.addEventListener('click', function () {
      if (isCarry) {
        if (!confirm('「' + it.name + '」不再追蹤？\n\n這一列會從清單消失（不影響已結算的紀錄）。')) return;
        delete hw.carry[it.key]; delete hw.status[it.key];
        hw.items = hw.items.filter(function (x) { return x.key !== it.key; });
        hdb.set(hw); paintHw(); return;
      }
      if (confirm('把「' + it.name + '」全班設回未交？')) { delete hw.status[it.key]; hdb.set(hw); paintHw(); }
    });
    head.appendChild(done); head.appendChild(reset);
    return head;
  }

  /* 版面 B：座號清單（登記最快——一列一份作業、座號由小到大，點到「完成」就消失）。
     2026-09-08 老師要兩種版面併存：清單版登記快，座位表版看得出「誰」還沒交。 */
  function listRow(it) {
    var isCarry = !!hw.carry[it.key];
    var c = hwCounts(it.key), rem = c[0] + c[1] + c[2];
    var row = document.createElement('div');
    row.className = 'itemrow' + (rem === 0 ? ' clear' : '') + (isCarry ? ' carry' : '');
    row.appendChild(hwHead(it));
    if (isCarry) {
      var line = document.createElement('div'); line.className = 'carryline';
      line.textContent = '還沒交完：' + hwUndone(it.key).join('、') +
        '　·　補交追蹤中，這一列不會再送出紀錄（不重複扣分）';
      row.appendChild(line);
    }
    var shown = seats.filter(function (s) { return showDone || hwState(it.key, s) !== 3 || recentDone[it.key + '|' + s]; });
    if (!shown.length) {
      var d = document.createElement('div'); d.className = 'rowclear';
      d.innerHTML = '全部完成 🎉<span class="sub">按「顯示已完成」可回頭改</span>';
      row.appendChild(d); return row;
    }
    var chips = document.createElement('div'); chips.className = 'chips';
    shown.forEach(function (s) {
      var v = hwState(it.key, s);
      var ch = document.createElement('div'); ch.className = 'chip s' + v; ch.textContent = s;
      ch.title = HW_STATES[v] + '（點一下下一格、長按或右鍵退一格）';
      cycleTap(ch, function (dir) { hwStep(it, s, dir); });
      chips.appendChild(ch);
    });
    row.appendChild(chips);
    return row;
  }

  function paintHwList(box, today, old) {
    var sec = document.createElement('div'); sec.className = 'items';
    today.forEach(function (it) { sec.appendChild(listRow(it)); });
    if (!today.length) {
      var e = document.createElement('div'); e.className = 'itemrow';
      e.innerHTML = '<div class="rowclear">今天沒有要清點的作業<span class="sub">按「☁ 重讀雲端資料」或到 Notion 聯絡簿補填</span></div>';
      sec.appendChild(e);
    }
    box.appendChild(sec);
    if (old.length) {
      var os = document.createElement('div'); os.className = 'hwsec';
      var h = document.createElement('div'); h.className = 'hwsec-h';
      h.innerHTML = '<span class="t">⏳ 過去未完成（補交追蹤）</span><span class="s">只提醒，不再結算、不重複扣分</span>';
      os.appendChild(h);
      var items = document.createElement('div'); items.className = 'items';
      old.forEach(function (it) { items.appendChild(listRow(it)); });
      os.appendChild(items); box.appendChild(os);
    }
  }

  /* 模式 B：單一份作業一張座位表（收單科最快，一點一格） */
  function paintHwOne(box, it) {
    var isCarry = !!hw.carry[it.key];
    var c = hwCounts(it.key), rem = c[0] + c[1] + c[2];
    var row = document.createElement('div');
    row.className = 'itemrow' + (rem === 0 ? ' clear' : '') + (isCarry ? ' carry' : '');
    row.appendChild(hwHead(it));
    if (isCarry) {
      var line = document.createElement('div'); line.className = 'carryline';
      line.textContent = '這是前幾天派的，補交追蹤中：這一列不會再送出紀錄（不重複扣分）';
      row.appendChild(line);
    }
    row.appendChild(seatGrid('hwgrid', function (s) {
      var v = hwState(it.key, s);
      var cell = document.createElement('div');
      cell.className = 'scell hwcell t-' + HW_TONE[v];
      cell.innerHTML = s + '<span class="mk">' + HW_MARK[v] + '</span>';
      cycleTap(cell, function (dir) { hwStep(it, s, dir); });
      return cell;
    }));
    box.appendChild(row);
  }

  function paintHw() {
    var box = $('view-hw'); box.innerHTML = '';
    $('legend').innerHTML = '<span>未交 → 已交 → 要訂正 → <b style="color:var(--ok)">完成</b>　·　按過頭：<b>長按／右鍵退一格</b>或「↶ 復原」</span>' +
      '<span>' + (hw.srcDate ? '清點 ' + hw.srcDate.slice(5) + ' 派的' : '雲端讀不到前一天作業') + '</span>';
    if (!hw.items.length) {
      box.innerHTML = '<div class="itemrow"><div class="rowclear">沒有可清點的項目' +
        '<span class="sub">按「☁ 重讀雲端資料」，或到 Notion 聯絡簿填前一天的作業</span></div></div>';
      return;
    }
    var today = [], old = [];
    hw.items.forEach(function (it) { (hw.carry[it.key] ? old : today).push(it); });
    if (hwView !== 'all' && !hwItem(hwView)) hwView = 'all';
    box.appendChild(hwPills(today.concat(old)));
    if (layout === 'list') {
      if (hwView === 'all') paintHwList(box, today, old);
      else { var w = document.createElement('div'); w.className = 'items';
             w.appendChild(listRow(hwItem(hwView))); box.appendChild(w); }
    } else if (hwView === 'all') paintHwAll(box, today, old);
    else paintHwOne(box, hwItem(hwView));
  }

  function loadHw() {
    return fetch(BASE + 'contactbook.json?t=' + Date.now(), { cache: 'no-store' })
      .then(function (r) { if (!r.ok) throw 0; return r.json(); })
      .then(function (rows) {
        var today = Tool.todayKey();
        var past = (rows || []).filter(function (x) {
          return x && String(x.date || '').slice(0, 10) < today && String(x.homework || '').trim();
        }).sort(function (a, b) { return b.date.localeCompare(a.date); });
        var row = past[0], src = row ? row.date.slice(0, 10) : '';
        var items = [];
        if (row) String(row.homework).split(/\n+/).map(function (s) { return s.trim(); })
          .filter(Boolean).forEach(function (l) { items.push({ key: src + '|' + l, name: l, due: src }); });
        /* 聯絡簿每天都要收，收的是「今天這一輪」——鍵掛今天的日期，隔天自動長出全新一列。 */
        items.push({ key: today + '|聯絡簿', name: '聯絡簿', due: today });
        var isToday = {}; items.forEach(function (it) { isToday[it.key] = 1; });
        /* 欠交結轉：先前留下、還有人沒到「完成」的項目照樣掛著（鍵帶日期，看得出是哪天的）。 */
        var carry = {}, keep = items.slice();
        hw.items.forEach(function (o) {
          if (!o || !o.key || isToday[o.key]) return;
          if (!hwUndone(o.key).length) return;      // 全班都完成 → 自然消失
          carry[o.key] = 1; keep.push(o);
        });
        var ns = {}; keep.forEach(function (it) { if (hw.status[it.key]) ns[it.key] = hw.status[it.key]; });
        hw.items = keep; hw.status = ns; hw.carry = carry; hw.srcDate = src;
        quietSet('hw', hw);
      })
      .catch(function () {
        if (!hw.items.length) {
          var t = Tool.todayKey();
          hw.items = [{ key: t + '|聯絡簿', name: '聯絡簿', due: t }];
          quietSet('hw', hw);
        }
      });
  }

  /* ── 4 午餐工作 ────────────────────────────────────────── */
  /* 本週輪到第幾輪：((本學期週次-1) % 完整輪替週數)+1，與班網 about.js 同一條公式。
     模數一定要讀 完整輪替週數，不可寫死——轉學一個人就會變。 */
  function lunchRound() {
    var L = data.lunch, W = data.weeks;
    if (!L || !L.rotation || !L.rotation.length) return null;
    var cycle = Number(L.完整輪替週數) || L.rotation.length;
    var today = st.date, wk = null;
    ((W && W.學期) || []).forEach(function (t) {
      (t.週 || []).forEach(function (w) {
        if (String(w.起) <= today && today <= String(w.迄)) wk = w;
      });
    });
    if (!wk) return null;
    return { round: ((wk.週次 - 1) % cycle) + 1, week: wk };
  }

  function lunchCards() {
    var L = data.lunch;
    if (!L) return null;
    var out = [];
    (L.fixed || []).forEach(function (f) {
      out.push({
        name: '🍚 ' + f.post,
        sub: (f.title || '') + (f.standard ? '　·　驗收：' + f.standard : ''),
        right: '固定崗',
        supGroup: f.post,
        people: (f.seats || []).map(function (s) { return { seat: s, duty: '' }; }),
        info: '<h2>' + esc('🍚 ' + f.post) + '</h2>' + section('工作職稱', f.title) +
          section('要做的事', f.work) + section('能管的事', f.authority) + section('做好的標準', f.standard)
      });
    });
    var r = lunchRound();
    if (r) {
      var specs = {};
      (L.posts || []).forEach(function (p) { specs[p.post] = p; });
      out.push({
        name: '🍚 午餐值週生',
        sub: '第 ' + r.round + ' 輪　·　' + (r.week.標籤 || ''),
        right: '輪值崗（每週換）',
        supGroup: '午餐值週生',
        people: ((L.rotation.filter(function (w) { return Number(w.week) === r.round; })[0]
                  || { assign: [] }).assign || []).map(function (a) {
          return { seat: a.seat, duty: a.slot };
        }),
        info: '<h2>🍚 午餐值週生</h2><p class="hint">' + esc('第 ' + r.round + ' 輪　·　' + (r.week.標籤 || '')) +
          '</p>' + ((L.規則 || []).length ? '<h3>規則</h3><div style="font-size:14.5px;line-height:1.75">' +
          esc((L.規則 || []).join('\n')) + '</div>' : '') +
          Object.keys(specs).map(function (k) {
            return section(k, specs[k].work);
          }).join('')
      });
    } else if ((L.rotation || []).length) {
      out.push({ name: '🍚 午餐值週生', sub: '今天不在學期區間內（假期），沒有本週輪值', right: '', people: [] });
    }
    return out;
  }

  function paintLunch() {
    $('legend').innerHTML = '<span>✗ 請假與支援都<b>只記次數</b>，不當場加減幣；有人補位按各崗位「＋ 加支援」</span>';
    var cards = lunchCards();
    var seen = {}, list = [];
    (cards || []).forEach(function (c) {
      c.people.forEach(function (p) { if (!seen[p.seat]) { seen[p.seat] = 1; list.push(p.seat); } });
    });
    if (!list.length) list = seats.slice();
    renderCards($('view-lunch'), 'lunch', cards,
      '<div class="empty"><span class="big">🍚</span>還讀不到午餐工作分配' +
      '<br><span style="font-size:.55em">連上網後會自動帶入班網的「🧹 班級工作分配－午餐」；' +
      '先用下面的一般座號檢核也可以</span></div>');
    var box = $('view-lunch');
    box.insertBefore(actionBar('lunch', list, '✅ 全部到位', 1), box.firstChild);
  }

  /* ── 5 潔牙 ───────────────────────────────────────────── */
  /* 潔牙站：固定「午餐後潔牙」＋（老師當天自己開的）「含氟漱口水」兩張卡。
     含氟漱口水一週只有一次，所以不預設顯示，由本站上方的按鈕開關（只影響今天）。 */
  function teethCard(kind, title, allLabel) {
    var states = ST[kind];
    /* 沒點＝沒做（2026-09-11 老師：潔牙不要預設全班做到）——所以拿掉「✅ 全部已潔牙」，一格一格點。 */
    var ok = seats.filter(function (s) { return stateOf(kind, s) === 1; });
    var redo = seats.filter(function (s) { return stateOf(kind, s) === 2; });
    var miss = seats.length - ok.length - redo.length;
    var row = document.createElement('div');
    row.className = 'itemrow' + (miss ? '' : ' clear');
    var head = document.createElement('div'); head.className = 'rowhead';
    head.innerHTML = '<span class="name">' + esc(title) + '</span>' +
      '<span class="cnt"><span class="d">' + states[1].l + ' <b>' + ok.length + '</b></span>　' +
      '<span class="a">' + states[2].l + ' <b>' + redo.length + '</b></span>　' +
      '<span class="c">沒做 <b>' + miss + '</b></span></span><span class="grow"></span>';
    var clr = document.createElement('button'); clr.className = 'reset';
    clr.textContent = '↺ 全部重來'; clr.disabled = (ok.length + redo.length) === 0;
    clr.addEventListener('click', function () {
      if (!confirm('把「' + title + '」全部改回「沒做」嗎？')) return;
      st[kind] = {}; sdb.set(st); paintTeeth(); paintPend();
    });
    head.appendChild(clr);
    row.appendChild(head);
    var chips = document.createElement('div'); chips.className = 'chips';
    seats.forEach(function (s) {
      var v = stateOf(kind, s);
      var ch = document.createElement('div');
      ch.className = 'chip' + (v === 0 ? ' bad' : (v === 1 ? ' s3' : ' s1')); ch.textContent = s;
      ch.title = states[v].l;
      ch.addEventListener('click', function () {
        /* 現讀狀態再 +1，不要用畫這一格時的舊值——重畫後同一顆按鈕若被再點到會算錯格。 */
        var nv = (stateOf(kind, s) + 1) % states.length;
        setState(kind, s, nv); Tool.beep(1, nv === 2 ? 460 : 720);
        paintTeeth(); paintPend(); explain(kind, s, nv);
      });
      chips.appendChild(ch);
    });
    row.appendChild(chips);
    return row;
  }

  function paintTeeth() {
    $('legend').innerHTML = '<span>沒點＝沒做；有補做就點到 <b>↻ 補做完成</b>（當作做到）。結算時仍沒做＝常規未達成＋班規⑦</span>';
    var box = $('view-teeth'); box.innerHTML = '';

    var bar = document.createElement('div'); bar.className = 'statbar';
    var info = document.createElement('span'); info.className = 'sb-n';
    info.innerHTML = '🦷 午餐後潔牙每天做；💧 <b>含氟漱口水一週一次</b>，' +
      (st.fluorideOn ? '<span class="sb-ok">今天有</span>' : '<span class="sb-left">今天沒有</span>');
    bar.appendChild(info);
    var tog = document.createElement('button');
    tog.className = st.fluorideOn ? 'sb-clear' : 'sb-all';
    tog.style.marginLeft = 'auto';
    tog.textContent = st.fluorideOn ? '✕ 今天沒有含氟漱口水' : '💧 今天有含氟漱口水';
    tog.addEventListener('click', function () {
      if (st.fluorideOn && Object.keys(st.fluoride).length &&
          !confirm('關掉含氟漱口水？已經點好的那一列會一起清掉，也不會結算。')) return;
      st.fluorideOn = !st.fluorideOn;
      if (!st.fluorideOn) st.fluoride = {};
      sdb.set(st); paintTeeth(); paintPend();
    });
    bar.appendChild(tog);
    box.appendChild(bar);

    var items = document.createElement('div'); items.className = 'items';
    items.appendChild(teethCard('teeth', '🦷 午餐後潔牙', '✅ 全部已潔牙'));
    if (st.fluorideOn) items.appendChild(teethCard('fluoride', '💧 含氟漱口水', '✅ 全部已漱口'));
    box.appendChild(items);
  }

  /* ── 結算：每站各自整批重算（重按＝重算，不疊加）──────────────────── */
  function collect(kind) {
    var out = [];
    if (kind === 'arrive') {
      // ⏰ 遲到照班規①bad[0] 記；✗ 未到（請假／缺席）**不產生任何事件**——
      // 請假不是偏差行為，也不是週結公式的輸入，送出去只會在紀錄庫留一列沒人要的資料。
      var a = actOf(1, 'bad', 0);
      if (!a) return out;
      Object.keys(st.arrive).forEach(function (k) {
        if (st.arrive[k] !== 2) return;               // 2＝⏰ 遲到（1＝出席、3＝未到都不送出）
        out.push({ tool: TOOL.arrive, date: st.date, seat: Number(k), src: 'rule',
                   rule_n: 1, kind: 'bad', act_i: 0, act: a.act, coin: a.coin, level: a.level,
                   period: '到校簽到' });
      });
      return out;
    }
    if (kind === 'clean') {
      Object.keys(st.clean).forEach(function (k) {
        var seat = Number(k), v = st.clean[k];
        // △ 到位未達標＝**只計次，不扣幣**（2026-09-06 老師裁示）：既有制度是
        // 「1～2 次沒做到不扣幣只補做、3 次以上才 −5」，當場記班規③ −5 等於第一次犯就重罰。
        // 累計判斷交給週結（本系統只收資料，加減點一律在任務處理端算）。
        if (v === 2) {
          out.push({ tool: TOOL.clean, date: st.date, seat: seat, src: 'tally', dedupe: 'day',
                     kind: 'bad', act: '打掃未達標', period: '環境晨掃' });
          return;
        }
        absentEvents('clean', seat, v, '環境晨掃').forEach(function (e) { out.push(e); });   // 0／1 不產生事件
      });
      // 浮動支援：一組一筆；同一人一天支援兩組會在 CMEvents 合併成一列、次數 2、備註兩組都留
      Object.keys(st.cleanSup).forEach(function (g) {
        supportOf('clean', g).forEach(function (seat) {
          out.push({ tool: TOOL.clean, date: st.date, seat: seat, src: 'tally', dedupe: 'day',
                     kind: 'good', act: '打掃支援', period: '環境晨掃', note: g });
        });
      });
      return out;
    }
    if (kind === 'lunch') {
      Object.keys(st.lunch).forEach(function (k) {
        absentEvents('lunch', Number(k), st.lunch[k], '午餐工作').forEach(function (e) { out.push(e); });   // 0／1 不產生事件
      });
      // 浮動支援：一崗一筆，備註＝支援哪一崗；同一人一天補兩崗會在 CMEvents 合併成一列、次數 2
      Object.keys(st.lunchSup).forEach(function (g) {
        supportOf('lunch', g).forEach(function (seat) {
          out.push({ tool: TOOL.lunch, date: st.date, seat: seat, src: 'tally', dedupe: 'day',
                     kind: 'good', act: '午餐支援', period: '午餐工作', note: g });
        });
      });
      return out;
    }
    if (kind === 'teeth') {
      /* 2026-09-11 老師定案：常規沒做但有重做＝不熟（常規層，不記、+1 照給）；
         沒重做＝當無故（班規層）。所以結算時「仍是沒做」的座號送兩筆：
         ①「常規未達成」tally → 週結那天常規獎勵不給 ② 班規⑦「常規沒做到、也不肯重做」→ 扣幣。
         含氟漱口水沿用同一個 act；同一人兩項都沒做會合併成一列（次數 2），⑦ 金幣算一次。 */
      var rr = routineRule();
      var items = [['teeth', '午餐潔牙', '沒潔牙']];
      if (st.fluorideOn) items.push(['fluoride', '含氟漱口水', '沒做含氟漱口水']);
      items.forEach(function (it) {
        seats.forEach(function (s) {
          if (stateOf(it[0], s) !== 0) return;         // 1 已做、2 補做完成都不送
          out.push({ tool: TOOL.teeth, date: st.date, seat: s, src: 'tally', dedupe: 'day',
                     kind: 'bad', act: '常規未達成', period: it[1], note: it[2] + '，未補做' });
          if (rr) out.push({ tool: TOOL.teeth, date: st.date, seat: s, src: 'rule', rule_n: 7, kind: 'bad',
                             act_i: rr.i, act: rr.a.act, coin: rr.a.coin, level: rr.a.level, period: it[1] });
        });
      });
      return out;
    }
    if (kind === 'hw') {
      var c4 = cardOf(4);
      if (!c4) return out;
      var MAP = { 0: ['bad', 0], 2: ['bad', 1] };
      hw.items.forEach(function (it) {
        if (hw.carry[it.key]) return;       // 結轉的欠交列只提醒，不再結算（避免同一份作業天天扣分）
        /* 備註帶派出日期：週結／家長看紀錄時才知道是哪一天的作業（2026-09-08）。 */
        var item = it.name + (it.due ? '（' + String(it.due).slice(5) + ' 派）' : '');
        seats.forEach(function (s) {
          var v = hwState(it.key, s);
          if (v === 1) return;                  // 已交：不產生事件
          if (v === 3) {                        // 完成：只計次，週結才給幣（避免每天 +5 的通膨）
            out.push({ tool: TOOL.hw, date: st.date, seat: s, src: 'tally', dedupe: 'day',
                       kind: 'good', act: '作業完成', note: item });
            return;
          }
          var m = MAP[v]; if (!m) return;
          var a = (c4[m[0]] || [])[m[1]]; if (!a) return;
          out.push({ tool: TOOL.hw, date: st.date, seat: s, src: 'rule', rule_n: 4,
                     kind: m[0], act_i: m[1], act: a.act, coin: a.coin, level: a.level, note: item });
        });
      });
      return out;
    }
    return out;
  }

  /* 每站的確認文案：老師按下去之前要看得懂「這批會怎麼算」。 */
  function settleMsg(kind, evs) {
    var n = {};
    evs.forEach(function (e) { n[e.act] = (n[e.act] || 0) + 1; });
    function c(a) { return n[a] || 0; }
    if (kind === 'arrive') {
      var a = actOf(1, 'bad', 0) || {};
      return '把到校簽到結算到「待送」嗎？\n\n' +
        '　⏰ 上學遲到（' + (a.coin || '') + '）　' + evs.length + ' 人\n' +
        '　✗ 未到（請假／缺席）不送出，只留在這台電腦\n\n再按一次是重新結算，不會疊加。';
    }
    var ns = (noShowRule() || { a: {} }).a.coin || '';
    if (kind === 'clean') {
      return '把打掃結果結算到「待送」嗎？\n\n' +
        '　△ 到位未達標　' + c('打掃未達標') + ' 人　→ 只記次數；週結累計 1～2 次不扣幣只補做，3 次以上才 −5\n' +
        '　✗ 請假／🎫 免打掃券　' + (c('打掃缺席') - c(NOSHOW_ACT)) + ' 人　→ 中性紀錄，那次沒薪水，不扣幣\n' +
        '　⛔ 無故未到　　' + c(NOSHOW_ACT) + ' 人　→ 那次沒薪水，另記班規⑦ ' + ns + '\n' +
        '　＋ 臨時支援　　' + c('打掃支援') + ' 人次　→ 週結每支援一次多發一次打掃薪水\n\n再按一次是重新結算，不會疊加。';
    }
    if (kind === 'lunch') {
      return '把午餐工作結算到「待送」嗎？\n\n' +
        '　✗ 請假　　　　' + (c('午餐缺席') - c(NOSHOW_ACT)) + ' 人　→ 中性紀錄，週結少算一次午餐出勤，不扣幣\n' +
        '　⛔ 無故未到　　' + c(NOSHOW_ACT) + ' 人　→ 週結少算一次，另記班規⑦ ' + ns + '\n' +
        '　＋ 臨時支援　　' + c('午餐支援') + ' 人次　→ 週結每補位一次多發一次午餐工作薪水\n\n再按一次是重新結算，不會疊加。';
    }
    if (kind === 'teeth') {
      var rc = (routineRule() || { a: {} }).a.coin || '';
      return '把潔牙檢核結算到「待送」嗎？\n\n' +
        '　沒做、也沒補做（潔牙／含氟漱口水）　' + c('常規未達成') + ' 人次\n' +
        '　　→ 記「常規未達成」：今天的班級常規獎勵 +1 不給（全勤獎也就沒有）\n' +
        '　　→ 另記班規⑦「' + ROUTINE_ACT + '」' + rc + '\n' +
        '　↻ 補做完成＝當作做到：不記任何紀錄，+1 照給\n\n' +
        '⚠️ 沒點＝沒做。請等補做時間過了再結算——送出到 Notion 後就收不回來。\n' +
        '同一人兩項都沒做會合併成一列（次數 2）。再按一次是重新結算，不會疊加。';
    }
    var c4 = cardOf(4) || { bad: [{}, {}] };
    return '要把作業清點結果結算到「待送」嗎？\n\n' +
      '　未交（' + (c4.bad[0] || {}).coin + '）　　' + c((c4.bad[0] || {}).act) + ' 人次\n' +
      '　要訂正（' + (c4.bad[1] || {}).coin + '）　' + c((c4.bad[1] || {}).act) + ' 人次\n' +
      '　完成（只記次數，不當場加幣）　' + c('作業完成') + ' 人次\n\n' +
      '同一人同一天多份會合併成一列並記次數（金幣算一次）。\n' +
      '⏳ 標「還沒交完」的舊作業只留著提醒，不算進這次結算。\n' +
      '「完成」由週結看全週表現一次給，平日不逐天發幣。\n再按一次會重新結算，不會疊加。';
  }

  var NEED_RULE = { arrive: 1, hw: 4 };          // 這兩站要班規幣值，讀不到就不准結算
  function settle() {
    if (NEED_RULE[tab] && !cardOf(NEED_RULE[tab])) {
      alert('還讀不到班規，不能結算這一站。\n\n幣值一律抄班規，讀不到就不記——避免用到過期的數字。\n' +
            '連上網後按「☁ 重讀雲端資料」再試一次。');
      return;
    }
    /* 打掃／午餐有人點「⛔ 無故」卻讀不到班規⑦：只送缺席不送⑦會讓無故看起來跟請假一樣，擋下來。 */
    if (NOSHOW[tab] && !noShowRule() &&
        seats.some(function (s2) { return stateOf(tab, s2) === NOSHOW[tab]; })) {
      alert('還讀不到班規⑦，有「⛔ 無故未到」的這一站不能結算。\n\n' +
            '無故要另記班規⑦，幣值一律抄班規。連上網後按「☁ 重讀雲端資料」再試一次。');
      return;
    }
    /* 潔牙／含氟漱口水：沒點＝沒做（2026-09-11 起），沒做要另記班規⑦——讀不到那一行就擋下來，
       不然只送常規未達成、漏掉⑦，「不肯重做」看起來會跟「不熟」一樣。 */
    if (tab === 'teeth' && !routineRule() && seats.some(function (s2) {
      return stateOf('teeth', s2) === 0 || (st.fluorideOn && stateOf('fluoride', s2) === 0);
    })) {
      alert('還讀不到班規⑦「' + ROUTINE_ACT + '」，潔牙站不能結算。\n\n' +
            '沒做也沒補做的要另記班規⑦，幣值一律抄班規。連上網後按「☁ 重讀雲端資料」再試一次。');
      return;
    }
    var evs = collect(tab);
    if (!evs.length) {
      alert(tab === 'clean' ? '打掃全部達標，沒有要送的事件（這是好事，✓ 不產生任何紀錄）。'
        : tab === 'teeth' ? '全班都有做或已補做，沒有要送的事件。'
        : tab === 'hw' ? '沒有可結算的項目（全部都是「已交」，或還沒清點）。'
        : '沒有例外要送（這是好事，✓ 不產生任何紀錄）。');
      return;
    }
    if (!confirm(settleMsg(tab, evs))) return;
    CMEvents.clearTool(TOOL[tab], st.date);        // 重按＝重算，不疊加
    evs.forEach(function (e) { CMEvents.push(e); });
    Tool.beep(2, 720); paintPend();
  }

  /* ── 共用 ─────────────────────────────────────────────── */
  function paintPend() {
    $('pend').textContent = CMEvents.merged().length;
    var n = CMEvents.list().filter(function (e) {
      return e.tool === TOOL[tab] && e.date === st.date;
    }).length;
    $('settled').textContent = n ? '本站已結算 ' + n + ' 筆（回工作台收班送出）' : '';
  }

  var fixTimer = null;
  function flashFix(who, fix) {
    $('fix-who').textContent = who;
    $('fix-text').textContent = fix || '';
    var bar = $('fixbar'); bar.classList.add('show');
    clearTimeout(fixTimer);
    fixTimer = setTimeout(function () { bar.classList.remove('show'); }, 9000);
  }
  $('fixbar').addEventListener('click', function () { this.classList.remove('show'); });

  var pnl = Tool.panel($('panel'), $('scrim'));
  function openPanel(html) { $('panel-body').innerHTML = html; pnl.open(); }

  function weekOverview() {
    var days = Object.keys(st.week).sort().slice(-5);
    if (!days.length) { openPanel('<h2>本週總覽</h2><p class="hint">這週還沒有任何打掃紀錄。</p>'); return; }
    var html = '<h2>本週總覽</h2><p class="hint">對照紙本「個人打掃檢核表」那張表，投影就不必列印。' +
      '空白＝✓ 到位達標；✗ 請假、🎫 免打掃券、⛔ 無故；＋＝當天去支援（有支援才多發那一次薪水）。</p><table class="week"><tr><th>座號</th>' +
      days.map(function (d) { return '<th>' + d.slice(5) + '</th>'; }).join('') + '</tr>';
    seats.forEach(function (s) {
      html += '<tr><td>' + s + '</td>' + days.map(function (d) {
        var v = (st.week[d] || {})[s] || 0, sup = st.weekSup[d] || {};
        var n = Object.keys(sup).filter(function (g) { return sup[g].indexOf(s) >= 0; }).length;
        return '<td>' + (v && ST.clean[v] ? ST.clean[v].m : '') + (n ? '＋' + (n > 1 ? n : '') : '') + '</td>';
      }).join('') + '</tr>';
    });
    openPanel(html + '</table>');
  }

  function section(t, v) {
    return v ? '<h3>' + esc(t) + '</h3><div style="font-size:14.5px;line-height:1.75;white-space:pre-wrap">' +
      esc(v) + '</div>' : '';
  }
  function esc(s) { return String(s == null ? '' : s).replace(/[<>&]/g, ''); }
  function chunk(a, n) { var o = []; for (var i = 0; i < a.length; i += n) o.push(a.slice(i, i + n)); return o; }

  /* 一個掃區一頁（老師 2026-09-06 指定）。頁籤名不寫死——寫死了換掃區時它不會跟著改，
     就變成一份會說謊的第二正本。做法：取該監督負責的所有組別名裡**共同出現的字**。 */
  function commonTag(names) {
    if (names.length < 2) return '';
    var first = names[0], best = '';
    for (var i = 0; i < first.length; i++) {
      for (var j = i + 2; j <= first.length; j++) {
        var sub = first.slice(i, j);
        if (/[（）()・\-–]/.test(sub)) continue;
        if (names.every(function (n) { return n.indexOf(sub) >= 0; }) && sub.length > best.length) best = sub;
      }
    }
    return best;
  }

  function zoneTabs() {
    var sup = (data.duties && data.duties.supervisors) || {};
    return Object.keys(sup).map(function (k) {
      var zones = [], names = [];
      sup[k].forEach(function (full) {
        var p = String(full).split('・');
        zones.push(p[0]); names.push(p.slice(1).join('・'));
      });
      var zone = zones[0], tag = commonTag(names);
      var same = Object.keys(sup).filter(function (o) {
        return String(sup[o][0]).split('・')[0] === zone;
      }).length;
      return { key: k, label: zone + (same > 1 && tag ? '・' + tag : ''), n: sup[k].length };
    });
  }

  function paintZoneTabs() {
    var box = $('zonetabs'), tabs = zoneTabs();
    if (!tabs.length) { box.innerHTML = ''; return; }
    box.innerHTML = '<button type="button" data-z="all"' + (zoneFilter === 'all' ? ' class="on"' : '') + '>全部</button>' +
      tabs.map(function (t) {
        return '<button type="button" data-z="' + t.key + '"' + (zoneFilter === t.key ? ' class="on"' : '') + '>' +
               esc(t.label) + '<span class="n">' + t.key + '號</span></button>';
      }).join('');
    Array.prototype.forEach.call(box.querySelectorAll('button'), function (b) {
      b.addEventListener('click', function () { zoneFilter = b.dataset.z; paintZoneTabs(); paintClean(); });
    });
  }

  var TABS = ['arrive', 'clean', 'hw', 'lunch', 'teeth'];
  function paint() {
    if (tab === 'arrive') paintArrive();
    else if (tab === 'clean') paintClean();
    else if (tab === 'hw') paintHw();
    else if (tab === 'lunch') paintLunch();
    else paintTeeth();
  }

  function setTab(t) {
    tab = t;
    TABS.forEach(function (k) {
      $('tab-' + k).classList.toggle('on', k === t);
      $('view-' + k).hidden = k !== t;
    });
    $('zonetabs').style.display = t === 'clean' ? '' : 'none';
    $('btn-week').hidden = t !== 'clean';
    $('subtitle').textContent = TAB_TITLE[t];
    paint(); paintPend();
  }

  TABS.forEach(function (k) {
    $('tab-' + k).addEventListener('click', function () { setTab(k); });
  });
  $('btn-settle').addEventListener('click', settle);
  $('btn-undo').addEventListener('click', undoLast);
  $('btn-week').addEventListener('click', weekOverview);
  $('btn-reload').addEventListener('click', function () { reload(true); });
  $('btn-full').addEventListener('click', Tool.fullscreen);
  document.addEventListener('keydown', function (e) {
    if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'z') { e.preventDefault(); undoLast(); return; }
    if (e.key.toLowerCase() === 'f' && !e.metaKey && !e.ctrlKey) Tool.fullscreen();
    if (e.key === 'Escape') pnl.close();
  });
  Tool.autoHideHud($('hud'));
  Tool.foldHud($('hud'), 'classManager.routine.hudFolded');   /* 底部工具列可整條收起，不擋投影內容 */

  function reload(manual) {
    if (manual) $('btn-reload').textContent = '☁ 讀取中…';
    return Promise.all([
      pull('class-rules.json', 'rules', function (j) { return j && j.cards; }),
      pull('duties-seats.json', 'duties'),
      pull('seating-seats.json', 'seating'),
      pull('lunch-seats.json', 'lunch'),
      pull('weeks.json', 'weeks'),
      loadHw()
    ]).then(function () {
      if (manual) $('btn-reload').textContent = '☁ 重讀雲端資料';
      paintZoneTabs(); paint(); paintPend();
    });
  }

  setTab('arrive'); paintZoneTabs(); paintPend();
  reload(false);
})();
