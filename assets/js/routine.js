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
    clean: [{ m: '', l: '未檢核', t: 'idle' }, { m: '✓', l: '到位達標', t: 'ok' },
            { m: '△', l: '到位未達標', t: 'warn' },
            { m: '✗', l: '未到', t: 'pink' }, { m: '＋', l: '臨時支援', t: 'blue' }],
    lunch: [{ m: '', l: '未檢核', t: 'idle' }, { m: '✓', l: '到位', t: 'ok' },
            { m: '✗', l: '未到', t: 'pink' }, { m: '＋', l: '臨時支援', t: 'blue' }],
    teeth: [{ m: '', l: '未點', t: 'idle' }, { m: '✓', l: '已潔牙', t: 'ok' }, { m: '✗', l: '沒潔牙', t: 'pink' }],
    /* 含氟漱口水：一週只有一次，由老師當天自己開（2026-09-07 老師要求），狀態與潔牙同三態。 */
    fluoride: [{ m: '', l: '未點', t: 'idle' }, { m: '✓', l: '已漱口', t: 'ok' }, { m: '✗', l: '沒漱口', t: 'pink' }]
  };

  var TAB_TITLE = {
    arrive: '點座號簽到：未點名 → ✓ 出席 → ⏰ 遲到 → ✗ 未到（請假）',
    clean: '點座號檢核：未檢核 → ✓ 到位達標 → △ 未達標 → ✗ 未到 → ＋ 支援',
    hw: '未交 → 已交 → 要訂正 → 完成；右上可切「🪑 座位表／🔢 座號清單」',
    lunch: '點座號檢核：未檢核 → ✓ 到位 → ✗ 未到 → ＋ 臨時支援',
    teeth: '點座號檢核：未點 → ✓ 已潔牙 → ✗ 沒潔牙（不扣幣、不記班規）'
  };

  /* 五站的狀態存一起，一天一份；week 留每天的打掃快照供「本週總覽」。 */
  var sdb = Tool.store('classManager.routine.v2');
  var st = sdb.get(null);
  /* 狀態編號版本：v3 起到校／打掃多了第 0 態「未點」，舊號碼的語意整個位移，
     照舊資料畫會變成「昨天的出席今天顯示成遲到」。版本不合就重來，不硬搬。 */
  if (st && st.sv !== 4) st = null;
  if (!st || st.date !== Tool.todayKey()) {
    st = { date: Tool.todayKey(), sv: 4, arrive: {}, clean: {}, lunch: {}, teeth: {},
           fluoride: {}, fluorideOn: false, week: (st && st.week) || {} };
  }
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

  /* ── 狀態存取（四個狀態式站共用）──────────────────────────── */
  function stateOf(kind, seat) { return st[kind][seat] || 0; }
  function setState(kind, seat, v) {
    if (v === 0) delete st[kind][seat]; else st[kind][seat] = v;
    if (kind === 'clean') st.week[st.date] = st.clean;
    sdb.set(st);
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
      el.appendChild(ppl);
      if (c.info) el.addEventListener('dblclick', function () { openPanel(c.info); });
      box.appendChild(el);
    });
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
      if (v === 3) flashFix(who + '打掃缺席', '週結薪水會少算一次出勤（不扣幣）');
      if (v === 4) flashFix(who + '臨時支援', '這次支援會記進週結（加一次支援）');
    } else if (kind === 'lunch') {
      if (v === 2) flashFix(who + '午餐工作未到', '週結午餐薪水會少算一次（不扣幣）');
      if (v === 3) flashFix(who + '午餐臨時支援', '這次支援會記進週結（加一次支援）');
    } else if (kind === 'fluoride') {
      if (v === 2) flashFix(who + '今天沒做含氟漱口水',
        '不扣幣、不記班規；和沒潔牙一樣，今天的班級常規獎勵 +1 不給');
    } else if (kind === 'teeth') {
      if (v === 2) flashFix(who + '今天沒潔牙',
        '不扣幣、不記班規；週結時今天的班級常規獎勵 +1 不給，全勤獎也就沒有');
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
          people: g.seats.concat(g.support || []).map(function (s) {
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
    $('legend').innerHTML = '<span>△ 未達標與 ✗ 未到都<b>只記次數</b>，不當場扣幣</span>';
    var cards = cleanCards();
    var seen = {}, list = [];
    // 同一個座號可能同時出現在本組與支援名單，計數要去重，否則「已點 x/30」對不上 27 人
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
      h.innerHTML = '<h2>' + seat + ' 號的作業</h2><p class="hint">點右邊的狀態鈕循環：未交 → 已交 → 要訂正 → 完成。</p>';
      body.appendChild(h);
      hw.items.forEach(function (it) {
        var v = hwState(it.key, seat);
        var r = document.createElement('div'); r.className = 'seatrow' + (v === 3 ? ' done' : '');
        r.innerHTML = '<span class="nm">' + (hw.carry[it.key] ? '⏳ ' : '') + esc(it.name) +
          '<span class="dy">' + esc(String(it.due || '').slice(5)) + ' 派</span></span>';
        var b = document.createElement('button');
        b.type = 'button'; b.className = 'stbtn t-' + HW_TONE[v]; b.textContent = HW_MARK[v];
        b.addEventListener('click', function () {
          hwSet(it.key, seat, (hwState(it.key, seat) + 1) % 4);
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
    var shown = seats.filter(function (s) { return showDone || hwState(it.key, s) !== 3; });
    if (!shown.length) {
      var d = document.createElement('div'); d.className = 'rowclear';
      d.innerHTML = '全部完成 🎉<span class="sub">按「顯示已完成」可回頭改</span>';
      row.appendChild(d); return row;
    }
    var chips = document.createElement('div'); chips.className = 'chips';
    shown.forEach(function (s) {
      var v = hwState(it.key, s);
      var ch = document.createElement('div'); ch.className = 'chip s' + v; ch.textContent = s;
      ch.title = HW_STATES[v];
      ch.addEventListener('click', function () {
        var nv = (hwState(it.key, s) + 1) % 4;
        hwSet(it.key, s, nv); Tool.beep(1, nv === 3 ? 720 : 520); paintHw(); paintPend();
      });
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
      cell.addEventListener('click', function () {
        var nv = (hwState(it.key, s) + 1) % 4;
        hwSet(it.key, s, nv); Tool.beep(1, nv === 3 ? 720 : 520); paintHw(); paintPend();
      });
      return cell;
    }));
    box.appendChild(row);
  }

  function paintHw() {
    var box = $('view-hw'); box.innerHTML = '';
    $('legend').innerHTML = '<span>未交 → 已交 → 要訂正 → <b style="color:var(--ok)">完成</b></span>' +
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
        hdb.set(hw);
      })
      .catch(function () {
        if (!hw.items.length) {
          var t = Tool.todayKey();
          hw.items = [{ key: t + '|聯絡簿', name: '聯絡簿', due: t }];
          hdb.set(hw);
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
    $('legend').innerHTML = '<span>✗ 未到與 ＋ 支援都<b>只記次數</b>，不當場加減幣</span>';
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
    var ok = seats.filter(function (s) { return stateOf(kind, s) === 1; });
    var miss = seats.filter(function (s) { return stateOf(kind, s) === 2; });
    var left = seats.length - ok.length - miss.length;
    var row = document.createElement('div');
    row.className = 'itemrow' + (miss.length ? '' : ' clear');
    var head = document.createElement('div'); head.className = 'rowhead';
    head.innerHTML = '<span class="name">' + esc(title) + '</span>' +
      '<span class="cnt"><span class="d">' + states[1].l + ' <b>' + ok.length + '</b></span>　' +
      '<span class="c">' + states[2].l + ' <b>' + miss.length + '</b></span>　' +
      '<span class="u">還沒點 <b>' + left + '</b></span></span><span class="grow"></span>';
    var all = document.createElement('button'); all.className = 'reset';
    all.textContent = allLabel + (left ? '（' + left + '）' : '');
    all.disabled = !left;
    all.addEventListener('click', function () {
      seats.forEach(function (s) { if (stateOf(kind, s) === 0) setState(kind, s, 1); });
      Tool.beep(2, 760); paintTeeth(); paintPend();
    });
    head.appendChild(all);
    var clr = document.createElement('button'); clr.className = 'reset';
    clr.textContent = '↺ 全部重來'; clr.disabled = (ok.length + miss.length) === 0;
    clr.addEventListener('click', function () {
      if (!confirm('把「' + title + '」全部改回「還沒點」嗎？')) return;
      st[kind] = {}; sdb.set(st); paintTeeth(); paintPend();
    });
    head.appendChild(clr);
    row.appendChild(head);
    var chips = document.createElement('div'); chips.className = 'chips';
    seats.forEach(function (s) {
      var v = stateOf(kind, s);
      var ch = document.createElement('div');
      ch.className = 'chip' + (v === 2 ? ' bad' : (v === 1 ? ' s3' : '')); ch.textContent = s;
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
    $('legend').innerHTML = '<span>沒做＝那天常規未達成：不扣幣、不記班規</span>';
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
        var seat = Number(k), v = st.clean[k], act = '';
        // △ 到位未達標＝**只計次，不扣幣**（2026-09-06 老師裁示）：既有制度是
        // 「1～2 次沒做到不扣幣只補做、3 次以上才 −5」，當場記班規③ −5 等於第一次犯就重罰。
        // 累計判斷交給週結（本系統只收資料，加減點一律在任務處理端算）。
        if (v === 2) act = '打掃未達標'; else if (v === 3) act = '打掃缺席'; else if (v === 4) act = '打掃支援';
        if (!act) return;                              // 0 未檢核、1 到位達標都不產生事件
        out.push({ tool: TOOL.clean, date: st.date, seat: seat, src: 'tally', dedupe: 'day',
                   kind: v === 4 ? 'good' : 'bad', act: act, period: '環境晨掃' });
      });
      return out;
    }
    if (kind === 'lunch') {
      Object.keys(st.lunch).forEach(function (k) {
        var seat = Number(k), v = st.lunch[k];
        if (v !== 2 && v !== 3) return;                // 0 未檢核、1 到位都不產生事件
        out.push({ tool: TOOL.lunch, date: st.date, seat: seat, src: 'tally', dedupe: 'day',
                   kind: v === 2 ? 'bad' : 'good', act: v === 2 ? '午餐缺席' : '午餐支援',
                   period: '午餐工作' });
      });
      return out;
    }
    if (kind === 'teeth') {
      Object.keys(st.teeth).forEach(function (k) {
        if (st.teeth[k] !== 2) return;                 // 2＝✗ 沒潔牙（1＝已潔牙不送出）
        out.push({ tool: TOOL.teeth, date: st.date, seat: Number(k), src: 'tally', dedupe: 'day',
                   kind: 'bad', act: '常規未達成', period: '午餐潔牙', note: '沒潔牙' });
      });
      /* 含氟漱口水沿用同一個 act「常規未達成」——排程端（R18）與週結都不必新增規則；
         同一位學生兩項都沒做時會合併成一列（次數 2、備註兩項都留），金幣一樣是 0。 */
      if (st.fluorideOn) {
        Object.keys(st.fluoride).forEach(function (k) {
          if (st.fluoride[k] !== 2) return;
          out.push({ tool: TOOL.teeth, date: st.date, seat: Number(k), src: 'tally', dedupe: 'day',
                     kind: 'bad', act: '常規未達成', period: '含氟漱口水', note: '沒做含氟漱口水' });
        });
      }
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
    if (kind === 'clean') {
      return '把打掃結果結算到「待送」嗎？（這三種都只記次數，不會當場加減幣）\n\n' +
        '　△ 到位未達標　' + c('打掃未達標') + ' 人　→ 週結累計：1～2 次不扣幣只補做，3 次以上才 −5\n' +
        '　✗ 未到　　　　' + c('打掃缺席') + ' 人　→ 週結少算一次出勤（那次沒薪水）\n' +
        '　＋ 臨時支援　　' + c('打掃支援') + ' 人　→ 週結加一次支援\n\n再按一次是重新結算，不會疊加。';
    }
    if (kind === 'lunch') {
      return '把午餐工作結算到「待送」嗎？（只記次數，不會當場加減幣）\n\n' +
        '　✗ 未到　　　　' + c('午餐缺席') + ' 人　→ 週結少算一次午餐出勤\n' +
        '　＋ 臨時支援　　' + c('午餐支援') + ' 人　→ 週結加一次支援\n\n再按一次是重新結算，不會疊加。';
    }
    if (kind === 'teeth') {
      return '把潔牙檢核結算到「待送」嗎？\n\n' +
        '　✗ 沒做（潔牙／含氟漱口水）　' + evs.length + ' 筆　→ 各記一筆「常規未達成」\n' +
        '　（同一人兩項都沒做會合併成一列，次數 2、備註兩項都留）\n\n' +
        '不扣幣、不記班規；週結時這天的班級常規獎勵 +1 不給，全勤獎也就沒有。\n' +
        '再按一次是重新結算，不會疊加。';
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
    var evs = collect(tab);
    if (!evs.length) {
      alert(tab === 'clean' ? '打掃全部達標，沒有要送的事件（這是好事，✓ 不產生任何紀錄）。'
        : tab === 'teeth' ? '全班都潔牙了，沒有要送的事件。'
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
      '空白＝✓ 到位達標。</p><table class="week"><tr><th>座號</th>' +
      days.map(function (d) { return '<th>' + d.slice(5) + '</th>'; }).join('') + '</tr>';
    seats.forEach(function (s) {
      html += '<tr><td>' + s + '</td>' + days.map(function (d) {
        var v = (st.week[d] || {})[s] || 0;
        return '<td>' + (v ? ST.clean[v].m : '') + '</td>';
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
  $('btn-week').addEventListener('click', weekOverview);
  $('btn-reload').addEventListener('click', function () { reload(true); });
  $('btn-full').addEventListener('click', Tool.fullscreen);
  document.addEventListener('keydown', function (e) {
    if (e.key.toLowerCase() === 'f') Tool.fullscreen();
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
