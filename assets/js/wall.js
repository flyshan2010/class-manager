/* class-manager 公布欄模式（電子公布欄）的「時段 → 這一刻該投影什麼」單一正本。
 *
 * 純計算，不碰 DOM：blackboard.html（正式）與 wall-demo.html（時段預覽）都呼叫這裡，
 * 兩邊才不會各養一份會漂的規則。
 *
 * 設計原則（2026-09-07 老師定案）：整頁只講一件事——
 * 一個大主字＋一行副標＋最多 3 行內容＋一行底部資訊帶。
 */
(function (global) {
  'use strict';

  /* 科任課要帶什麼（老師 2026-09-07 提供）。比對順序有意義：
     「本土語(布)」「英語」都含「語」，所以先比長詞、後比短詞。 */
  var BRING = [
    [/視覺藝術|美術/, '課本、美術用具'],
    [/音樂/, '課本、直笛、聯絡簿、鉛筆盒'],
    [/體育/, '水壺'],
    [/本土語|閩南|客語|原住民/, '課本、鉛筆盒'],
    [/英語|英文/, '課本、習作、聯絡簿、鉛筆盒'],
    [/自然|生活科技/, '課本、習作、聯絡簿、鉛筆盒']
  ];
  function bringOf(subject) {
    var s = String(subject || '');
    for (var i = 0; i < BRING.length; i++) if (BRING[i][0].test(s)) return BRING[i][1];
    return '';
  }

  /* 放學口訣（老師 2026-09-07 定稿，四句七言；每天一樣的固定流程，不必進 Notion）。 */
  var HOME_STEPS = ['書包座位整理好', '功課餐袋記得帶', '快速安靜排路隊', '平平安安放學去'];

  function pad(n) { return String(n).padStart(2, '0'); }
  function hhmm(m) { return pad(Math.floor(m / 60)) + ':' + pad(m % 60); }
  function span(text) {
    var m = String(text || '').match(/(\d{1,2})[:：](\d{2})\s*[-–—~～]\s*(\d{1,2})[:：](\d{2})/);
    return m ? { a: +m[1] * 60 + +m[2], b: +m[3] * 60 + +m[4] } : null;
  }
  function steps(sop) {
    return String(sop || '').split(/[➜➔→\/]/).map(function (x) { return x.replace(/\s+/g, ' ').trim(); }).filter(Boolean);
  }
  function lines(text) {
    return String(text || '').split('\n').map(function (x) { return x.trim(); }).filter(Boolean);
  }

  /* 老師自訂的公布欄訊息（設定面板那一格）。一行一則：
     「09:15-09:30 記得喝水」＝只在那段時間出現（會變成畫面上的大字公告）；
     沒寫時間的那幾行＝一直掛在底部資訊帶。 */
  function notices(text, t) {
    var timed = [], always = [];
    lines(text).forEach(function (ln) {
      var s = span(ln);
      if (s) { if (t >= s.a && t < s.b) timed.push(ln.replace(/^[^\s]+\s*/, '').trim()); }
      else always.push(ln);
    });
    return { timed: timed, always: always };
  }

  /* d＝{sched,rules,lessons,ml,book,notice}；t＝現在幾點（分鐘）；dow＝星期幾（0＝假日） */
  function view(d, t, dow) {
    d = d || {};
    var sched = d.sched || null, daily = (d.rules && d.rules.daily) || [];
    var nt = notices(d.notice, t);

    function periodNow() {
      if (!sched || !sched.periods || !dow) return null;
      var hit = null;
      sched.periods.forEach(function (p, i) {
        var s = span(p.time); if (!s || t < s.a || t >= s.b) return;
        var cell = ((sched.table || [])[i] || [])[dow - 1];
        hit = { name: p.name || '', time: p.time || '', start: s.a, end: s.b,
                subject: cell == null ? '' : String(typeof cell === 'object' ? (cell.subject || '') : cell),
                room: (cell && typeof cell === 'object' && cell.room) || '' };
      });
      return hit;
    }
    function nextPeriod() {
      if (!sched || !sched.periods || !dow) return null;
      var best = null;
      sched.periods.forEach(function (p, i) {
        var s = span(p.time); if (!s || s.a <= t) return;
        if (!best || s.a < best.at) {
          var cell = ((sched.table || [])[i] || [])[dow - 1];
          best = { at: s.a, name: p.name || '', time: p.time || '',
                   subject: cell == null ? '' : String(typeof cell === 'object' ? (cell.subject || '') : cell),
                   room: (cell && typeof cell === 'object' && cell.room) || '' };
        }
      });
      return best;
    }
    function segNow() {
      var hit = null;
      daily.forEach(function (seg) { var s = span(seg.label); if (s && t >= s.a && t < s.b) hit = seg; });
      return hit;
    }
    function lastEnd() {
      var e = 0;
      ((sched && sched.periods) || []).forEach(function (q) { var s = span(q.time); if (s && s.b > e) e = s.b; });
      return e;
    }
    function nextLine(nx) {
      if (!nx) return [];
      var b = bringOf(nx.subject);
      return ['下一節 ' + hhmm(nx.at) + '　' + nx.name + (nx.subject ? '　' + nx.subject : '') +
              (b ? '（帶' + b + '）' : '')];
    }
    function wrap(v) {
      v.notice = nt.timed;                       // 大字公告（有時間的那幾則）
      v.foot = (v.foot || []).concat(nt.always); // 常駐訊息掛底部
      return v;
    }

    var p = periodNow(), seg = segNow(), nx = nextPeriod();

    /* 1 上課中 */
    if (p && /節/.test(p.name) && p.subject) {
      var L = null;
      (d.lessons || []).forEach(function (x) {
        if (!x || String(x.subject || '') !== String(p.subject)) return;
        if (!L) L = x;
      });
      var own = (d.focus || '').trim();
      var body = own ? lines(own).slice(0, 3) : ((L && L.points) || []).slice(0, 3);
      var bring = bringOf(p.subject);
      if (!body.length && bring) body = ['要帶：' + bring];
      return wrap({
        kick: p.name + '　' + p.time + (p.room ? '　' + p.room : ''),
        title: p.subject,
        sub: own ? '本節重點' : (L ? L.title : (bring ? '' : '')),
        list: body,
        foot: nextLine(nx)
      });
    }
    /* 2 晨掃 */
    if (p && /晨掃/.test(p.name)) {
      return wrap({ kick: p.time, title: '晨掃', sub: seg && seg.expect ? String(seg.expect).split('；')[0] : '',
                    list: steps(seg && seg.sop).slice(0, 3), foot: nextLine(nx) });
    }
    /* 3 早自修／朝會 */
    if (p && /早自修|朝會|晨讀/.test(p.name)) {
      var ask = '';
      ((d.ml && d.ml.days) || []).forEach(function (x) {
        if (Number(x.dow) === dow && x.cards && x.cards[0] && !ask) ask = x.cards[0].ask || x.cards[0].title || '';
      });
      return wrap({ kick: p.name + '　' + p.time, title: ask ? 'Morning Launch' : '晨　讀',
                    sub: ask || '桌上只留一本書，安靜閱讀',
                    list: steps(seg && seg.sop).slice(0, 2), foot: nextLine(nx) });
    }
    /* 4 午休 */
    if (p && /午休/.test(p.name)) {
      return wrap({ kick: p.time, title: '午　休', sub: '趴好、不說話', list: [],
                    count: p.end - t, foot: nextLine(nx) });
    }
    /* 5 午餐／潔牙（節次表沒有這一段時走 Notion 班規時段） */
    if (seg && /午餐/.test(seg.name)) {
      return wrap({ kick: seg.label, title: '午餐時間', sub: seg.expect ? String(seg.expect).split('；')[0] : '',
                    list: steps(seg.sop).slice(0, 3), foot: ['值週生名單在上方'] });
    }
    if (seg && /潔牙/.test(seg.name)) {
      return wrap({ kick: seg.label, title: '潔　牙', sub: seg.expect ? String(seg.expect).split('；')[0] : '',
                    list: steps(seg.sop).slice(0, 2), foot: [] });
    }
    /* 6 早晨入班（上學前）
       2026-09-08 老師回報：要交的作業原本只放在**底部資訊帶、且只印第一項**，
       學生走進教室看不到 → 改成「今天要交」當大標，作業清單用黃色大字（與放學口訣同一級），
       晨間 SOP 退到底部。沒有作業時才回到原本的「早安＋SOP」版面。 */
    if (seg && /入班|上學/.test(seg.name)) {
      var b2 = d.book || null;
      var due = b2 && b2.homework ? lines(b2.homework).slice(0, 4) : [];
      if (due.length) {
        return wrap({ kick: seg.label + '　早安', title: '今天要交', sub: '和聯絡簿一起交到指定位置',
                      list: due, mark: true, foot: steps(seg.sop).slice(0, 2) });
      }
      return wrap({ kick: seg.label, title: '早　安', sub: '把聯絡簿和作業交到指定位置',
                    list: steps(seg.sop).slice(0, 3), foot: [] });
    }
    /* 7 放學（最後一節下課後一小時；此時 daily 的「整理放學」已被節次蓋過去） */
    var le = lastEnd();
    if (dow && le && t >= le && t < le + 60) {
      var b4 = d.book || null;
      return wrap({ kick: hhmm(le) + ' 放學', title: '放學囉', sub: '',
                    list: HOME_STEPS, mark: true,      /* 口訣用黃字，投影時最醒目 */
                    hw: b4 && b4.homework ? lines(b4.homework).slice(0, 4) : [],
                    foot: b4 && b4.bring ? ['明天要帶：' + lines(b4.bring).join('、')] : ['路上小心，明天見'] });
    }
    /* 8 課堂之間＝下課 */
    if (nx && dow) {
      var bn = bringOf(nx.subject);
      return wrap({ kick: '下　課', title: '下　課', sub: '準備下一節要用的東西', count: nx.at - t,
                    list: [(nx.name + '　' + (nx.subject || '')).trim()].concat(bn ? ['要帶：' + bn] : []),
                    foot: ['鐘響前回教室，安靜坐好'] });
    }
    /* 9 放學後、假日：大時鐘＋今天的回家功課 */
    var b3 = d.book || null;
    return wrap({ kick: dow ? '今天辛苦了' : '假　日', title: hhmm(t), clock: true, sub: '',
                  list: b3 && b3.homework ? lines(b3.homework).slice(0, 3) : [], foot: ['明天見'] });
  }

  global.Wall = { view: view, bringOf: bringOf, hhmm: hhmm, HOME_STEPS: HOME_STEPS };
})(window);
