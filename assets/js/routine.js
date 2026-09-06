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
    arrive: [{ m: '✓', l: '到校', t: 'ok' }, { m: '⏰', l: '遲到', t: 'warn' }, { m: '✗', l: '未到', t: 'pink' }],
    clean: [{ m: '✓', l: '到位達標', t: 'ok' }, { m: '△', l: '到位未達標', t: 'warn' },
            { m: '✗', l: '未到', t: 'pink' }, { m: '＋', l: '臨時支援', t: 'blue' }],
    lunch: [{ m: '✓', l: '到位', t: 'ok' }, { m: '✗', l: '未到', t: 'pink' }, { m: '＋', l: '臨時支援', t: 'blue' }],
    teeth: [{ m: '✓', l: '已潔牙', t: 'ok' }, { m: '✗', l: '沒潔牙', t: 'pink' }]
  };

  var TAB_TITLE = {
    arrive: '座位表輕點：✓ 到校 → ⏰ 遲到 → ✗ 未到（請假）',
    clean: '預設全班達成，只點例外（✓→△→✗→＋支援）',
    hw: '清點前一天派的作業，點一下往下一個狀態，完成就消失',
    lunch: '午餐工作只有三態（✓ 到位 → ✗ 未到 → ＋ 臨時支援）',
    teeth: '預設全班都潔牙，只點沒潔牙的（不扣幣、不記班規）'
  };

  /* 五站的狀態存一起，一天一份；week 留每天的打掃快照供「本週總覽」。 */
  var sdb = Tool.store('classManager.routine.v2');
  var st = sdb.get(null);
  if (!st || st.date !== Tool.todayKey()) {
    st = { date: Tool.todayKey(), arrive: {}, clean: {}, lunch: {}, teeth: {}, week: (st && st.week) || {} };
  }
  ['arrive', 'clean', 'lunch', 'teeth'].forEach(function (k) { if (!st[k]) st[k] = {}; });
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

  /* 作業清點沿用 v2 舊 store：併頁不該讓老師今天已經點過的清點歸零。 */
  var hdb = Tool.store('classManager.homework.v2');
  var hw = hdb.get({ date: '', srcDate: '', items: [], status: {} });
  if (hw.date !== Tool.todayKey()) {
    hw = { date: Tool.todayKey(), srcDate: hw.srcDate || '', items: hw.items || [], status: hw.status || {} };
  }
  var HW_STATES = ['未交', '已交', '要訂正', '完成'];
  var showDone = false;

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
      if (v === 1) flashFix(who + '打掃未達標（這次不扣幣）',
        (actOf(3, 'bad', 0) || {}).fix + '　·　同一週第 3 次起才會扣 5 幣');
      if (v === 2) flashFix(who + '打掃缺席', '週結薪水會少算一次出勤（不扣幣）');
      if (v === 3) flashFix(who + '臨時支援', '這次支援會記進週結（加一次支援）');
    } else if (kind === 'lunch') {
      if (v === 1) flashFix(who + '午餐工作未到', '週結午餐薪水會少算一次（不扣幣）');
      if (v === 2) flashFix(who + '午餐臨時支援', '這次支援會記進週結（加一次支援）');
    } else if (kind === 'teeth') {
      if (v === 1) flashFix(who + '今天沒潔牙',
        '不扣幣、不記班規；週結時今天的班級常規獎勵 +1 不給，全勤獎也就沒有');
    } else if (kind === 'arrive') {
      if (v === 1) flashFix(who + '上學遲到', (actOf(1, 'bad', 0) || {}).fix || '結算時會照班規①記一筆');
      if (v === 2) flashFix(who + '今天未到（請假／缺席）', '只留在這台電腦提醒老師，不會送出任何紀錄');
    }
  }

  /* ── 1 到校簽到：座位表輕點（與電子白板同一套手勢）──────────────── */
  function paintArrive() {
    var box = $('view-arrive'); box.innerHTML = '';
    $('legend').innerHTML = ST.arrive.map(function (s) {
      return '<span><b>' + s.m + '</b> ' + s.l + '</span>';
    }).join('') + '<span>✗ 未到不送出，只有 ⏰ 遲到會照班規①記一筆</span>';
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
        c.innerHTML = s + (v ? '<span class="mk">' + ST.arrive[v].m + ' ' + ST.arrive[v].l + '</span>' : '');
        c.addEventListener('click', function () {
          var nv = (stateOf('arrive', s) + 1) % ST.arrive.length;
          setState('arrive', s, nv);
          Tool.beep(1, nv === 0 ? 720 : 520);
          paintArrive(); paintPend(); explain('arrive', s, nv);
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
    $('legend').innerHTML = ST.clean.map(function (s) {
      return '<span><b>' + s.m + '</b> ' + s.l + '</span>';
    }).join('');
    renderCards($('view-clean'), 'clean', cleanCards(),
      '<div class="empty"><span class="big">🧹</span>還讀不到掃區分配' +
      '<br><span style="font-size:.55em">連上網後會自動帶入班網的「🧹 班級工作分配」；' +
      '先用下面的一般座號檢核也可以</span></div>');
  }

  /* ── 3 作業清點（原 homework.html，3-2 併成分頁）────────────────── */
  function hwState(item, seat) { return (hw.status[item] && hw.status[item][seat]) || 0; }
  function hwSet(item, seat, v) {
    if (!hw.status[item]) hw.status[item] = {};
    if (v === 0) delete hw.status[item][seat]; else hw.status[item][seat] = v;
    hdb.set(hw);
  }
  function hwCounts(item) { var c = [0, 0, 0, 0]; seats.forEach(function (s) { c[hwState(item, s)]++; }); return c; }

  function paintHw() {
    var box = $('view-hw'); box.innerHTML = '';
    $('legend').innerHTML = '<span><b>未交</b> → <b>已交</b> → <b>要訂正</b> → <b style="color:var(--ok)">完成</b>（完成就消失）</span>' +
      '<span>' + (hw.srcDate ? '清點 ' + hw.srcDate.slice(5) + ' 派的' : '雲端讀不到前一天作業') + '</span>';
    if (!hw.items.length) {
      box.innerHTML = '<div class="itemrow"><div class="rowclear">沒有可清點的項目' +
        '<span class="sub">按「☁ 重讀雲端資料」，或到 Notion 聯絡簿填前一天的作業</span></div></div>';
      return;
    }
    var items = document.createElement('div'); items.className = 'items';
    hw.items.forEach(function (item) {
      var c = hwCounts(item), rem = c[0] + c[1] + c[2];
      var row = document.createElement('div'); row.className = 'itemrow' + (rem === 0 ? ' clear' : '');
      var head = document.createElement('div'); head.className = 'rowhead';
      head.innerHTML = '<span class="name">' + esc(item) + '</span>' +
        '<span class="cnt"><span class="u">未交 <b>' + c[0] + '</b></span>　<span class="a">已交 <b>' + c[1] +
        '</b></span>　<span class="c">要訂正 <b>' + c[2] + '</b></span>　<span class="d">完成 <b>' + c[3] +
        '</b></span></span><span class="grow"></span>';
      var reset = document.createElement('button'); reset.className = 'reset'; reset.textContent = '全設未交';
      reset.addEventListener('click', function () {
        if (confirm('把「' + item + '」全班設回未交？')) { delete hw.status[item]; hdb.set(hw); paintHw(); }
      });
      head.appendChild(reset); row.appendChild(head);

      var shown = seats.filter(function (s) { return showDone || hwState(item, s) !== 3; });
      if (!shown.length) {
        var d = document.createElement('div'); d.className = 'rowclear';
        d.innerHTML = '全部完成 🎉<span class="sub">按「顯示已完成」可回頭改</span>';
        row.appendChild(d);
      } else {
        var chips = document.createElement('div'); chips.className = 'chips';
        shown.forEach(function (s) {
          var v = hwState(item, s);
          var ch = document.createElement('div'); ch.className = 'chip s' + v; ch.textContent = s;
          ch.title = HW_STATES[v];
          ch.addEventListener('click', function () {
            var nv = (v + 1) % 4;
            hwSet(item, s, nv); Tool.beep(1, nv === 3 ? 720 : 520); paintHw(); paintPend();
          });
          chips.appendChild(ch);
        });
        row.appendChild(chips);
      }
      items.appendChild(row);
    });
    box.appendChild(items);
  }

  function loadHw() {
    return fetch(BASE + 'contactbook.json?t=' + Date.now(), { cache: 'no-store' })
      .then(function (r) { if (!r.ok) throw 0; return r.json(); })
      .then(function (rows) {
        var today = Tool.todayKey();
        var past = (rows || []).filter(function (x) {
          return x && String(x.date || '').slice(0, 10) < today && String(x.homework || '').trim();
        }).sort(function (a, b) { return b.date.localeCompare(a.date); });
        var row = past[0], items = [];
        if (row) String(row.homework).split(/\n+/).map(function (s) { return s.trim(); })
          .filter(Boolean).forEach(function (l) { items.push(l); });
        items.push('聯絡簿');
        var ns = {}; items.forEach(function (it) { if (hw.status[it]) ns[it] = hw.status[it]; });
        hw.items = items; hw.status = ns; hw.srcDate = row ? row.date.slice(0, 10) : '';
        hdb.set(hw);
      })
      .catch(function () { if (!hw.items.length) { hw.items = ['聯絡簿']; hdb.set(hw); } });
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
    $('legend').innerHTML = ST.lunch.map(function (s) {
      return '<span><b>' + s.m + '</b> ' + s.l + '</span>';
    }).join('') + '<span>午餐工作當場看得到成果，不做「未達標」累計</span>';
    renderCards($('view-lunch'), 'lunch', lunchCards(),
      '<div class="empty"><span class="big">🍚</span>還讀不到午餐工作分配' +
      '<br><span style="font-size:.55em">連上網後會自動帶入班網的「🧹 班級工作分配－午餐」；' +
      '先用下面的一般座號檢核也可以</span></div>');
  }

  /* ── 5 潔牙 ───────────────────────────────────────────── */
  function paintTeeth() {
    $('legend').innerHTML = '<span><b>✓</b> 已潔牙（預設）　<b>✗</b> 沒潔牙</span>' +
      '<span>沒潔牙＝那天常規未達成：不扣幣、不記班規</span>';
    var box = $('view-teeth'); box.innerHTML = '';
    var miss = seats.filter(function (s) { return stateOf('teeth', s) === 1; });
    var items = document.createElement('div'); items.className = 'items';
    var row = document.createElement('div'); row.className = 'itemrow' + (miss.length ? '' : ' clear');
    var head = document.createElement('div'); head.className = 'rowhead';
    head.innerHTML = '<span class="name">🦷 午餐後潔牙</span>' +
      '<span class="cnt"><span class="d">已潔牙 <b>' + (seats.length - miss.length) + '</b></span>　' +
      '<span class="c">沒潔牙 <b>' + miss.length + '</b></span></span><span class="grow"></span>';
    var reset = document.createElement('button'); reset.className = 'reset'; reset.textContent = '全設已潔牙';
    reset.addEventListener('click', function () {
      if (confirm('把全班設回「已潔牙」？')) { st.teeth = {}; sdb.set(st); paintTeeth(); paintPend(); }
    });
    head.appendChild(reset); row.appendChild(head);
    var chips = document.createElement('div'); chips.className = 'chips';
    seats.forEach(function (s) {
      var v = stateOf('teeth', s);
      var ch = document.createElement('div');
      ch.className = 'chip' + (v ? ' bad' : ' s3'); ch.textContent = s;
      ch.title = ST.teeth[v].l;
      ch.addEventListener('click', function () {
        var nv = v ? 0 : 1;
        setState('teeth', s, nv); Tool.beep(1, nv ? 460 : 720);
        paintTeeth(); paintPend(); explain('teeth', s, nv);
      });
      chips.appendChild(ch);
    });
    row.appendChild(chips); items.appendChild(row); box.appendChild(items);
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
        if (st.arrive[k] !== 1) return;
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
        if (v === 1) act = '打掃未達標'; else if (v === 2) act = '打掃缺席'; else if (v === 3) act = '打掃支援';
        if (!act) return;
        out.push({ tool: TOOL.clean, date: st.date, seat: seat, src: 'tally', dedupe: 'day',
                   kind: v === 3 ? 'good' : 'bad', act: act, period: '環境晨掃' });
      });
      return out;
    }
    if (kind === 'lunch') {
      Object.keys(st.lunch).forEach(function (k) {
        var seat = Number(k), v = st.lunch[k];
        if (!v) return;
        out.push({ tool: TOOL.lunch, date: st.date, seat: seat, src: 'tally', dedupe: 'day',
                   kind: v === 1 ? 'bad' : 'good', act: v === 1 ? '午餐缺席' : '午餐支援',
                   period: '午餐工作' });
      });
      return out;
    }
    if (kind === 'teeth') {
      Object.keys(st.teeth).forEach(function (k) {
        if (st.teeth[k] !== 1) return;
        out.push({ tool: TOOL.teeth, date: st.date, seat: Number(k), src: 'tally', dedupe: 'day',
                   kind: 'bad', act: '常規未達成', period: '午餐潔牙', note: '沒潔牙' });
      });
      return out;
    }
    if (kind === 'hw') {
      var c4 = cardOf(4);
      if (!c4) return out;
      var MAP = { 0: ['bad', 0], 2: ['bad', 1] };
      hw.items.forEach(function (item) {
        seats.forEach(function (s) {
          var v = hwState(item, s);
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
        '　✗ 沒潔牙　' + evs.length + ' 人　→ 記一筆「常規未達成」\n\n' +
        '不扣幣、不記班規；週結時這天的班級常規獎勵 +1 不給，全勤獎也就沒有。\n' +
        '再按一次是重新結算，不會疊加。';
    }
    var c4 = cardOf(4) || { bad: [{}, {}] };
    return '要把作業清點結果結算到「待送」嗎？\n\n' +
      '　未交（' + (c4.bad[0] || {}).coin + '）　　' + c((c4.bad[0] || {}).act) + ' 人次\n' +
      '　要訂正（' + (c4.bad[1] || {}).coin + '）　' + c((c4.bad[1] || {}).act) + ' 人次\n' +
      '　完成（只記次數，不當場加幣）　' + c('作業完成') + ' 人次\n\n' +
      '同一人同一天多份會合併成一列並記次數（金幣算一次）。\n' +
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
    $('btn-show').hidden = t !== 'hw';
    $('subtitle').textContent = TAB_TITLE[t];
    paint(); paintPend();
  }

  TABS.forEach(function (k) {
    $('tab-' + k).addEventListener('click', function () { setTab(k); });
  });
  $('btn-settle').addEventListener('click', settle);
  $('btn-week').addEventListener('click', weekOverview);
  $('btn-show').addEventListener('click', function () {
    showDone = !showDone;
    $('btn-show').textContent = showDone ? '隱藏已完成' : '顯示已完成';
    $('btn-show').classList.toggle('primary', showDone);
    paintHw();
  });
  $('btn-reload').addEventListener('click', function () { reload(true); });
  $('btn-full').addEventListener('click', Tool.fullscreen);
  document.addEventListener('keydown', function (e) {
    if (e.key.toLowerCase() === 'f') Tool.fullscreen();
    if (e.key === 'Escape') pnl.close();
  });
  Tool.autoHideHud($('hud'));

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
