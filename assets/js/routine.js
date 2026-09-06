/* 常規檢核台（Phase 2-3）：環境晨掃＋上午課堂兩個分頁。
 *
 * 設計計畫 docs/設計計畫_課堂資料採集Phase2.md §4。三條鐵則照做：
 *  1. **例外管理**：預設全班達成，老師只點例外（多數時段 0 動作）。
 *  2. **點完當場投影修復方式**——這是這支工具最大的教育價值，`fix` 文字來自
 *     Notion 班規，AI 與程式都沒有發揮空間。
 *  3. **不排名、不做排行榜**（通用鐵則 6）。
 *
 * 兩個分頁用**兩個 tool 名**，不是一個：
 *  - 晨掃 `cleanup`：狀態式（✓△✗＋支援可以改來改去），按「結算」時整批重算，
 *    重算要能清掉自己上一次的結果 → 必須獨佔一個 tool 名，否則 clearTool 會連課堂那些也清掉。
 *  - 課堂 `routine`：事件式（點下去就是發生過的一件事），即時進佇列，點錯用「復原上一筆」。
 *
 * 前端一律不算錢：班規事件的 coin／level 原封轉抄 class-rules.json，
 * 打掃缺席／支援是 src:'tally'（不入帳，只記次數，供 class-bank 週結的薪水公式用）。
 */
(function () {
  'use strict';
  var $ = Tool.$;
  var seats = Tool.requireSeats($('stage'));
  if (!seats) { $('hud').style.display = 'none'; return; }

  var BASE = 'https://flyshan2010.github.io/class-website/data/';
  var TOOL_CLEAN = 'cleanup', TOOL_CLASS = 'routine';

  /* 晨掃四態。✓ 不產生事件（走週結的固定基準，零筆最省）。 */
  var STATES = [
    { key: 0, mark: '✓', label: '到位達標' },
    { key: 1, mark: '△', label: '到位未達標' },
    { key: 2, mark: '✗', label: '未到' },
    { key: 3, mark: '＋', label: '臨時支援' }
  ];

  /* §4.3 時段→班規對照表（老師已確認）。上午課堂：①上課遲到、⑤、⑨、④、②、⑧，
     加上「任何時段都可叫出」的⑥⑩。卡 ① 在課堂只出「上課遲到」那一項（§4.4）。 */
  var CLASS_CARDS = [5, 9, 1, 4, 2, 8, 6, 10];

  var sdb = Tool.store('classManager.routine.v1');
  var st = sdb.get({ date: '', clean: {}, week: {} });
  if (st.date !== Tool.todayKey()) st = { date: Tool.todayKey(), clean: {}, week: st.week || {} };

  var cache = Tool.store('classManager.routine.cache');
  var data = cache.get({ rules: null, duties: null, seating: null });
  var tab = 'clean', zoneFilter = 'all';

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

  /* ── 晨掃 ─────────────────────────────────────────────── */
  function groupsOf() {
    var d = data.duties;
    if (!d || !d.zones) return null;
    var out = [];
    d.zones.forEach(function (z) {
      z.groups.forEach(function (g) {
        if (zoneFilter !== 'all' && String(g.supervisor) !== zoneFilter) return;
        out.push({ zone: z.zone, emoji: z.emoji, g: g });
      });
    });
    return out;
  }

  function stateOf(seat) { return st.clean[seat] || 0; }
  function setState(seat, v) {
    if (v === 0) delete st.clean[seat]; else st.clean[seat] = v;
    st.week[st.date] = st.clean;              // 本週總覽用（每天一份快照）
    sdb.set(st);
  }

  function paintClean() {
    var box = $('view-clean'); box.innerHTML = '';
    $('legend').innerHTML = STATES.map(function (s) {
      return '<span><b>' + s.mark + '</b> ' + s.label + '</span>';
    }).join('');
    var gs = groupsOf();
    if (!gs) {
      box.innerHTML = '<div class="empty"><span class="big">🧹</span>還讀不到掃區分配' +
        '<br><span style="font-size:.55em">連上網後會自動帶入班網的「🧹 班級工作分配」；' +
        '先用下面的一般座號檢核也可以</span></div>';
      paintFallbackSeats(box);
      return;
    }
    if (!gs.length) { box.innerHTML = '<div class="empty">這個範圍沒有分配到的小組</div>'; return; }
    gs.forEach(function (item) {
      var g = item.g;
      var card = document.createElement('div'); card.className = 'zcard';
      var head = document.createElement('div'); head.className = 'zhead';
      head.innerHTML = '<span class="zname">' + esc(item.emoji + ' ' + g.group) + '</span>' +
        '<span class="zsub">' + esc(g.title || '') + (g.standard ? '　·　驗收：' + esc(g.standard) : '') + '</span>' +
        (g.supervisor ? '<span class="zsup">監督 ' + g.supervisor + ' 號</span>' : '');
      card.appendChild(head);
      var ppl = document.createElement('div'); ppl.className = 'people';
      g.seats.concat(g.support || []).forEach(function (s) { ppl.appendChild(personCard(s, g)); });
      card.appendChild(ppl);
      card.addEventListener('dblclick', function () { showGroupInfo(item); });
      box.appendChild(card);
    });
  }

  /* 拿不到掃區資料時的退路：一般座號網格照樣可以檢核（§4.6 明訂要有這條退路）。 */
  function paintFallbackSeats(box) {
    var card = document.createElement('div'); card.className = 'zcard';
    card.innerHTML = '<div class="zhead"><span class="zname">全班座號</span>' +
      '<span class="zsub">尚未帶入掃區分組與個人責任範圍</span></div>';
    var ppl = document.createElement('div'); ppl.className = 'people';
    seats.forEach(function (s) { ppl.appendChild(personCard(s, { personal: {} })); });
    card.appendChild(ppl); box.appendChild(card);
  }

  function personCard(seat, g) {
    var v = stateOf(seat);
    var el = document.createElement('div'); el.className = 'pcard s' + v;
    var duty = (g.personal || {})[seat] || (g.personal || {})[String(seat)] || '';
    el.innerHTML = '<div class="pn">' + seat + '</div>' +
      (duty ? '<div class="pm">' + esc(duty) + '</div>' : '') +
      '<div class="ps">' + STATES[v].mark + ' ' + STATES[v].label + '</div>';
    el.addEventListener('click', function () {
      var nv = (stateOf(seat) + 1) % 4;
      setState(seat, nv);
      Tool.beep(1, nv === 0 ? 720 : 520);
      paintClean(); paintPend();
      if (nv === 1) flashFix(seat + ' 號 · 打掃未達標（這次不扣幣）',
                            fixOf(3, 'bad', 0) + '　·　同一週第 3 次起才會扣 5 幣', '');
      if (nv === 2) flashFix(seat + ' 號 · 打掃缺席', '週結薪水會少算一次出勤（不扣幣）', '');
      if (nv === 3) flashFix(seat + ' 號 · 臨時支援', '這次支援會記進週結（加一次支援）', '');
    });
    return el;
  }

  function showGroupInfo(item) {
    var g = item.g;
    openPanel('<h2>' + esc(item.emoji + ' ' + g.group) + '</h2>' +
      '<p class="hint">' + esc(item.zone) + (g.supervisor ? '　·　監督 ' + g.supervisor + ' 號' : '') + '</p>' +
      section('工作職稱', g.title) + section('要做的事', g.work) +
      section('能管的事', g.authority) + section('做好的標準', g.standard) +
      section('配置掃具', (g.tools || []).join('、')));
  }
  function section(t, v) { return v ? '<h3>' + t + '</h3><div style="font-size:14.5px;line-height:1.75">' + esc(v) + '</div>' : ''; }

  /* ── 上午課堂 ─────────────────────────────────────────── */
  function paintClass() {
    var box = $('view-class'); box.innerHTML = '';
    $('legend').innerHTML = '<span>點座號 → 選班規 → 當場投影修復方式</span>';
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
        var n = hitsOf(s);
        c.className = 'scell' + (n ? ' hit' : '');
        c.innerHTML = s + (n ? '<span class="badge">·' + n + '</span>' : '');
        c.addEventListener('click', function () { openRules(s); });
        r.appendChild(c);
      });
      wrap.appendChild(r);
    });
    box.appendChild(wrap);
    if (!grid) {
      var tip = document.createElement('div'); tip.className = 'zsub';
      tip.style.cssText = 'text-align:center;color:var(--chalk-3);font-size:clamp(13px,1.7vh,19px)';
      tip.textContent = '（還讀不到座位表，暫時依座號排列）';
      box.appendChild(tip);
    }
  }

  function hitsOf(seat) {
    return CMEvents.list().filter(function (e) {
      return e.tool === TOOL_CLASS && e.date === st.date && Number(e.seat) === Number(seat);
    }).length;
  }

  function openRules(seat) {
    if (!data.rules) { openPanel('<h2>座號 ' + seat + '</h2><p class="hint">還讀不到班規（連上網後會自動帶入）。' +
      '幣值一律抄班規，讀不到就不記——避免用到過期的數字。</p>'); return; }
    var html = '<h2>座號 ' + seat + '</h2><p class="hint">上午課堂・點一項就記一筆，並當場投影修復方式。</p>';
    CLASS_CARDS.forEach(function (n) {
      var c = cardOf(n); if (!c) return;
      html += '<h3>' + esc(c.rule) + '</h3>';
      ['good', 'bad'].forEach(function (kind) {
        (c[kind] || []).forEach(function (a, i) {
          // 卡①在課堂只出「上課遲到」一項：「上學遲到」與兩個正向項（準時到校／整週沒遲到）
          // 講的都是「到校」，屬晨間報到板的範圍（§4.4），放在課堂分頁點不出道理。
          if (Number(n) === 1 && (kind === 'good' || String(a.act).indexOf('上課') < 0)) return;
          html += '<div class="rule ' + kind + '" data-n="' + n + '" data-k="' + kind + '" data-i="' + i + '">' +
            '<div class="ract">' + esc(a.act) + '</div>' +
            '<div class="rmeta">' + esc(a.coin) + ' 幣' + (a.fix ? '　·　修復：' + esc(a.fix) : '') + '</div></div>';
        });
      });
    });
    openPanel(html);
    Array.prototype.forEach.call($('panel-body').querySelectorAll('.rule'), function (el) {
      el.addEventListener('click', function () {
        recordRule(seat, Number(el.dataset.n), el.dataset.k, Number(el.dataset.i));
      });
    });
  }

  function recordRule(seat, n, kind, i) {
    var c = cardOf(n), a = c && (c[kind] || [])[i];
    if (!a) return;
    // 幣值 ≥ 10 的重手處分要二次確認：⑩重大安全事件是 −200，
    // 卻和「打斷同學發言 −5」並排在同一個清單裡，投影時手指滑一下就是 −200（模擬驗收抓到）。
    if (Math.abs(Number(String(a.coin).replace('−', '-'))) >= 10) {
      if (!confirm('這一項是 ' + a.coin + ' 幣（重手處分）：\n\n座號 ' + seat + ' · ' + a.act +
                   '\n\n確定要記嗎？')) return;
    }
    var note = '';
    if (String(a.act).indexOf('遲到') >= 0) {
      var m = prompt('遲到幾分鐘？（下課靜坐同樣分鐘數；直接按確定＝不記分鐘）', '');
      if (m === null) return;
      m = String(m).replace(/[^0-9]/g, '');
      if (m) note = '遲到 ' + m + ' 分鐘';
    }
    CMEvents.push({
      tool: TOOL_CLASS, date: st.date, seat: seat, src: 'rule',
      rule_n: n, kind: kind, act_i: i, act: a.act,
      coin: a.coin, level: a.level, period: '上午課堂', note: note
    });
    Tool.beep(kind === 'good' ? 2 : 1, kind === 'good' ? 720 : 460);
    closePanel(); paintClass(); paintPend();
    // 投影給全班看，班規名稱寫全（只留「①」看不出是哪一條）
    flashFix(seat + ' 號 · ' + c.rule + '－' + a.act + (note ? '（' + note + '）' : ''),
             a.fix || (kind === 'good' ? '記下來了，繼續保持' : ''), a.coin,
             note ? '　下課靜坐 ' + note.replace(/[^0-9]/g, '') + ' 分鐘' : '');
  }

  /* ── 結算（晨掃專用；課堂是即時記錄，不需要結算）──────────────────── */
  function collectClean() {
    var out = [];
    Object.keys(st.clean).forEach(function (k) {
      var seat = Number(k), v = st.clean[k];
      if (v === 1) {
        // △ 到位未達標＝**只計次，不扣幣**（2026-09-06 老師裁示）。
        // 既有制度（班經中心使用說明第 11 條）是「1～2 次沒做到不扣幣只補做、3 次以上才 −5」，
        // 當場記班規③ −5 等於第一次犯就重罰，與制度牴觸。
        // 累計判斷交給週結（本系統只收資料，加減點一律在任務處理端算）。
        out.push({ tool: TOOL_CLEAN, date: st.date, seat: seat, src: 'tally', dedupe: 'day',
                   kind: 'bad', act: '打掃未達標', period: '環境晨掃' });
      } else if (v === 2) {
        // 缺席不是班規項：走 tally（金幣 0），週結薪水的「−缺席次數」用它。
        // dedupe:'day' ＝一天一列（狀態式）：同一天重新結算再送一次要是**同一個 id**，
        // 否則紀錄庫會出現兩列「打掃缺席」，週結就多扣一次出勤（2026-09-06 模擬抓到）。
        out.push({ tool: TOOL_CLEAN, date: st.date, seat: seat, src: 'tally', dedupe: 'day',
                   kind: 'bad', act: '打掃缺席', period: '環境晨掃' });
      } else if (v === 3) {
        out.push({ tool: TOOL_CLEAN, date: st.date, seat: seat, src: 'tally', dedupe: 'day',
                   kind: 'good', act: '打掃支援', period: '環境晨掃' });
      }
    });
    return out;
  }

  function settle() {
    var evs = collectClean();
    if (!evs.length) { alert('晨掃全部達標，沒有要送的事件（這是好事，✓ 不產生任何紀錄）。'); return; }
    var t = { bad: 0, miss: 0, help: 0 };
    evs.forEach(function (e) {
      t[e.act === '打掃未達標' ? 'bad' : (e.act === '打掃缺席' ? 'miss' : 'help')]++;
    });
    // 三種例外**全部只計次、都不動錢**，扣不扣由週結累計判斷（老師 2026-09-06 裁示）
    if (!confirm('把晨掃結果結算到「待送」嗎？（這三種都只記次數，不會當場加減幣）\n\n' +
      '　△ 到位未達標　' + t.bad + ' 人　→ 週結累計：1～2 次不扣幣只補做，3 次以上才 −5\n' +
      '　✗ 未到　　　　' + t.miss + ' 人　→ 週結少算一次出勤（那次沒薪水）\n' +
      '　＋ 臨時支援　　' + t.help + ' 人　→ 週結加一次支援\n\n' +
      '再按一次是重新結算，不會疊加。送出仍在工作台按。')) return;
    CMEvents.clearTool(TOOL_CLEAN, st.date);
    evs.forEach(function (e) { CMEvents.push(e); });
    Tool.beep(2, 720); paintPend();
  }

  /* ── 共用 ─────────────────────────────────────────────── */
  function paintPend() {
    var all = CMEvents.list().filter(function (e) { return e.date === st.date; });
    $('pend').textContent = CMEvents.merged().length;
    var n = all.filter(function (e) { return e.tool === TOOL_CLEAN; }).length;
    $('settled').textContent = n ? '晨掃已結算 ' + n + ' 筆' : '';
  }

  var fixTimer = null;
  function flashFix(who, fix, coin, extra) {
    $('fix-who').textContent = who + (coin ? '　' + coin + ' 幣' : '');
    $('fix-text').textContent = (fix || '') + (extra || '');
    var bar = $('fixbar'); bar.classList.add('show');
    clearTimeout(fixTimer);
    fixTimer = setTimeout(function () { bar.classList.remove('show'); }, 9000);
  }
  $('fixbar').addEventListener('click', function () { this.classList.remove('show'); });

  var pnl = Tool.panel($('panel'), $('scrim'));
  function openPanel(html) { $('panel-body').innerHTML = html; pnl.open(); }
  function closePanel() { pnl.close(); }

  function weekOverview() {
    var days = Object.keys(st.week).sort().slice(-5);
    if (!days.length) { openPanel('<h2>本週總覽</h2><p class="hint">這週還沒有任何晨掃紀錄。</p>'); return; }
    var html = '<h2>本週總覽</h2><p class="hint">對照紙本「個人打掃檢核表」那張表，投影就不必列印。' +
      '空白＝✓ 到位達標。</p><table class="week"><tr><th>座號</th>' +
      days.map(function (d) { return '<th>' + d.slice(5) + '</th>'; }).join('') + '</tr>';
    seats.forEach(function (s) {
      html += '<tr><td>' + s + '</td>' + days.map(function (d) {
        var v = (st.week[d] || {})[s] || 0;
        return '<td class="v' + v + '">' + (v ? STATES[v].mark : '') + '</td>';
      }).join('') + '</tr>';
    });
    openPanel(html + '</table>');
  }

  function undo() {
    var list = CMEvents.list();
    for (var i = list.length - 1; i >= 0; i--) {
      if (list[i].tool === TOOL_CLASS && list[i].date === st.date) {
        var e = list[i];
        CMEvents.removeAt(i);
        Tool.beep(1, 380); paintClass(); paintPend();
        flashFix('已復原：' + e.seat + ' 號 · ' + e.act, '這筆不會送出', '');
        return;
      }
    }
    alert('今天還沒有課堂紀錄可以復原。（晨掃請直接點卡片改回 ✓，再按一次結算）');
  }

  function shortAct(n, kind, i) { var c = cardOf(n); return c ? c[kind][i].act : ''; }
  function fixOf(n, kind, i) { var c = cardOf(n); return c ? (c[kind][i].fix || '') : ''; }
  function coinOf(n, kind, i) { var c = cardOf(n); return c ? c[kind][i].coin : ''; }
  function esc(s) { return String(s == null ? '' : s).replace(/[<>&]/g, ''); }
  function chunk(a, n) { var o = []; for (var i = 0; i < a.length; i += n) o.push(a.slice(i, i + n)); return o; }

  function setTab(t) {
    tab = t;
    $('tab-clean').classList.toggle('on', t === 'clean');
    $('tab-class').classList.toggle('on', t === 'class');
    $('view-clean').hidden = t !== 'clean';
    $('view-class').hidden = t !== 'class';
    $('zonesel').style.display = t === 'clean' ? '' : 'none';
    $('btn-settle').style.display = t === 'clean' ? '' : 'none';
    $('btn-undo').style.display = t === 'class' ? '' : 'none';
    $('btn-week').style.display = t === 'clean' ? '' : 'none';
    $('subtitle').textContent = t === 'clean'
      ? '預設全班達成，只點例外（✓→△→✗→＋支援）'
      : '點座號選班規，當場投影修復方式';
    if (t === 'clean') paintClean(); else paintClass();
  }

  function paintZoneSel() {
    var sel = $('zonesel'), sup = (data.duties && data.duties.supervisors) || {};
    var keys = Object.keys(sup);
    sel.innerHTML = '<option value="all">全部（老師檢核）</option>' +
      keys.map(function (k) { return '<option value="' + k + '">我是 ' + k + ' 號監督（' + sup[k].length + ' 組）</option>'; }).join('');
    sel.value = zoneFilter;
    sel.style.visibility = keys.length ? '' : 'hidden';
  }

  $('tab-clean').addEventListener('click', function () { setTab('clean'); });
  $('tab-class').addEventListener('click', function () { setTab('class'); });
  $('zonesel').addEventListener('change', function () { zoneFilter = this.value; paintClean(); });
  $('btn-settle').addEventListener('click', settle);
  $('btn-undo').addEventListener('click', undo);
  $('btn-week').addEventListener('click', weekOverview);
  $('btn-full').addEventListener('click', Tool.fullscreen);
  document.addEventListener('keydown', function (e) {
    if (e.key.toLowerCase() === 'f') Tool.fullscreen();
    if (e.key === 'Escape') closePanel();
  });
  Tool.autoHideHud($('hud'));

  setTab('clean'); paintZoneSel(); paintPend();
  Promise.all([
    pull('class-rules.json', 'rules', function (j) { return j && j.cards; }),
    pull('duties-seats.json', 'duties'),
    pull('seating-seats.json', 'seating')
  ]).then(function () { paintZoneSel(); if (tab === 'clean') paintClean(); else paintClass(); });
})();
