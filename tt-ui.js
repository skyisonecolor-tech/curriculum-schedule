/* 일과 알리미 — 4단계: 주간 시간표(보기·편성·출력)와 알림 */
(function () {
  'use strict';
  const A = window.APP, TT = window.TT, TTM = window.TTM;
  if (!A || !TT || !TTM) return;
  const { api, esc, toast, run, modal, saveBlob } = A;
  const VIEWS = A.VIEWS, CFG = A.CFG || {};
  const ALLDAYS = ['월', '화', '수', '목', '금', '토'];
  const loading = (v) => { v.innerHTML = '<div class="card"><div class="empty">불러오는 중…</div></div>'; };
  const failed = (v, e) => { v.innerHTML = '<div class="note err">' + esc(e.message) + '</div>'; };
  const pad = (n) => String(n).padStart(2, '0');
  const todayStr = () => { const d = new Date(); return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()); };
  const addDays = (s, n) => { const p = s.split('-').map(Number); const d = new Date(p[0], p[1] - 1, p[2] + n); return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()); };
  const KIND_CLASS = { 지정: 'k-d', 블록: 'k-b', 고정: 'k-f' };

  /* =========================================================
     주간 표 그리기 (알리미 보기·편성·출력 공용)
     ========================================================= */
  function weekTable(view, opts) {
    opts = opts || {};
    const days = view.days || [], per = view.periods || {}, times = view.times || [];
    const maxP = Math.max(0, ...days.map((d) => Number(per[d]) || 0));
    const today = todayStr();
    const now = new Date(), hm = pad(now.getHours()) + ':' + pad(now.getMinutes());
    const wk = {}; (view.week || []).forEach((w) => { wk[w.day] = w.date; });
    const cellHtml = (list, key) => (list || []).map((c) => '<div class="tc ' + (KIND_CLASS[c.kind] || '') + (c.bad ? ' bad' : '') + (c.changed ? ' chg' : '') + (c.ghost ? ' ghost' : '') + (opts.pick === key ? ' pick' : '') + '"' + (c.note ? ' title="' + esc(c.note) + '"' : '') + '><b>' + esc(c.title) + '</b>'
      + (c.sub ? '<small>' + esc(c.sub) + '</small>' : '') + ((c.room || c.teacher) ? '<small>' + esc([c.room, c.teacher].filter(Boolean).join(' · ')) + '</small>' : '') + (c.note ? '<em>' + esc(c.note) + '</em>' : '') + '</div>').join('');
    let h = '<table class="wkt' + (opts.small ? ' small' : '') + '"><thead><tr><th class="pc"></th>' + days.map((d) => '<th class="' + (wk[d] === today ? 'today' : '') + '">' + d + (wk[d] ? '<br><small>' + wk[d].slice(5).replace('-', '/') + '</small>' : '') + '</th>').join('') + '</tr></thead><tbody>';
    for (let p = 1; p <= maxP; p++) {
      const t = times[p - 1] || '';
      h += '<tr><th class="pc">' + p + '<small>' + esc(t) + '</small></th>';
      days.forEach((d) => {
        if (p > (Number(per[d]) || 0)) { h += '<td class="off"></td>'; return; }
        const key = d + '|' + p;
        const isNow = wk[d] === today && t && t.split('-')[0] <= hm && hm <= (t.split('-')[1] || '');
        h += '<td class="' + (isNow ? 'now ' : '') + (wk[d] === today ? 'todaycol' : '') + '"' + (opts.click ? ' data-cell="' + key + '"' : '') + '>' + cellHtml(view.cells[key], key) + '</td>';
      });
      h += '</tr>';
    }
    return h + '</tbody></table>';
  }
  function dayList(view, day) {
    const per = view.periods || {}, times = view.times || [];
    let h = '<ul class="dayl">';
    for (let p = 1; p <= (Number(per[day]) || 0); p++) {
      const list = view.cells[day + '|' + p] || [];
      h += '<li><span class="pn">' + p + '<small>' + esc(times[p - 1] || '') + '</small></span><div>' + (list.length ? list.map((c) => '<div class="tc ' + (KIND_CLASS[c.kind] || '') + (c.changed ? ' chg' : '') + (c.ghost ? ' ghost' : '') + '"><b>' + esc(c.title) + '</b><small>' + esc([c.sub, c.room, c.teacher].filter(Boolean).join(' · ')) + '</small>' + (c.note ? '<em>' + esc(c.note) + '</em>' : '') + '</div>').join('') : '<span class="muted">-</span>') + '</div></li>';
    }
    return h + '</ul>';
  }

  /* =========================================================
     알리미: 이번 주 시간표
     ========================================================= */
  VIEWS.tt = async function (v) {
    const ui = A.ui, u = A.S.user || {};
    clearInterval(ui.ttTimer);
    if (!ui.ttDate) ui.ttDate = todayStr();
    const isT = u.kind === 'teacher';
    const draw = async () => {
      let d;
      try { d = await api('ttView', { date: ui.ttDate, kind: isT ? (ui.ttKind || 'me') : 'me', id: ui.ttId || '' }); } catch (e) { failed(v, e); return; }
      const L = d.lists || { classes: [], teachers: [], rooms: [] };
      const pick = isT ? '<select id="tk" class="input sm" aria-label="보기">' + [['me', '내 시간표'], ['class', '학급'], ['teacher', '교사'], ['room', '교실']].map((k) => '<option value="' + k[0] + '"' + ((ui.ttKind || 'me') === k[0] ? ' selected' : '') + '>' + k[1] + '</option>').join('') + '</select>'
        + (ui.ttKind && ui.ttKind !== 'me' ? '<select id="ti" class="input sm" aria-label="대상"><option value="">고르기</option>' + (ui.ttKind === 'class' ? L.classes.map((c) => '<option value="' + c + '"' + (c === ui.ttId ? ' selected' : '') + '>' + c.replace('-', '학년 ') + '반</option>')
          : ui.ttKind === 'teacher' ? L.teachers.map((t) => '<option value="' + esc(t.id) + '"' + (t.id === ui.ttId ? ' selected' : '') + '>' + esc(t.name) + '</option>') : L.rooms.map((r) => '<option' + (r === ui.ttId ? ' selected' : '') + '>' + esc(r) + '</option>')).join('') + '</select>' : '') : '';
      const days = d.days || [];
      if (!ui.ttDay || !days.includes(ui.ttDay)) { const w = (d.week || []).find((x) => x.date === todayStr()); ui.ttDay = w ? w.day : days[0]; }
      v.innerHTML = '<div class="card tight"><div class="row"><h2>' + esc(d.title || '시간표') + '</h2>' + pick + '<span style="margin-left:auto"></span>'
        + '<button class="btn sm" id="tp" aria-label="지난주">◀</button><input type="date" id="td" class="input sm" value="' + esc(ui.ttDate) + '"><button class="btn sm" id="tn" aria-label="다음 주">▶</button><button class="btn sm" id="tt0">오늘</button></div>'
        + (d.version ? '<div class="wk-desk">' + weekTable(d) + '</div><div class="wk-mob"><div class="row daychips">' + days.map((x) => '<button class="btn sm' + (x === ui.ttDay ? ' pri' : '') + '" data-day="' + x + '">' + x + ((d.week.find((w) => w.day === x) || {}).date === todayStr() ? ' (오늘)' : '') + '</button>').join('') + '</div>' + dayList(d, ui.ttDay) + '</div>'
          + '<p class="hint">' + esc(d.year + '학년도 ' + d.term + '학기 시간표') + (d.changes ? ' · <b class="chg-t">이번 주 바뀐 수업 ' + d.changes + '개</b> (주황색)' : '') + ' · 바뀐 수업은 자동으로 다시 불러옵니다.</p>'
          : '<div class="empty">' + esc(d.message || '시간표가 없습니다.') + '</div>') + '</div>';
      const go = (dt) => { ui.ttDate = dt; draw(); };
      v.querySelector('#tp').onclick = () => go(addDays(ui.ttDate, -7));
      v.querySelector('#tn').onclick = () => go(addDays(ui.ttDate, 7));
      v.querySelector('#tt0').onclick = () => { ui.ttDay = null; go(todayStr()); };
      v.querySelector('#td').onchange = (e) => go(e.target.value || todayStr());
      v.querySelectorAll('[data-day]').forEach((b) => { b.onclick = () => { ui.ttDay = b.dataset.day; draw(); }; });
      const tk = v.querySelector('#tk'); if (tk) tk.onchange = () => { ui.ttKind = tk.value; ui.ttId = ''; draw(); };
      const ti = v.querySelector('#ti'); if (ti) ti.onchange = () => { ui.ttId = ti.value; draw(); };
    };
    loading(v);
    await draw();
    ui.ttTimer = setInterval(() => { if (document.visibilityState === 'visible' && document.body.contains(v) && A.ui.tab === 'tt') draw(); else if (!document.body.contains(v)) clearInterval(ui.ttTimer); }, 5 * 60 * 1000);
  };

  /* =========================================================
     관리자: 시간표 편성
     ========================================================= */
  let TB = null;
  function runTT(input, opts, onProgress) {
    return new Promise((resolve, reject) => {
      let w;
      try { w = new Worker('tt-worker.js'); } catch (e) { setTimeout(() => { try { resolve(TT.solve(input, opts)); } catch (err) { reject(err); } }, 30); return; }
      w.onmessage = (e) => { if (e.data.progress) { if (onProgress) onProgress(e.data.progress); return; } w.terminate(); if (e.data.error) reject(new Error(e.data.error)); else resolve(e.data.result); };
      w.onerror = (e) => { w.terminate(); reject(new Error(e.message || '계산 중 오류')); };
      w.postMessage({ input, opts });
    });
  }
  const tName = (id) => { const t = TB && TB.d.teachers.find((x) => x.id === id); return t ? t.name : ''; };
  function evaluate() { TB.res = TT.evaluate(TTM.engineInput(TB.d, TB.set), TB.placement); }

  VIEWS.ttbuild = async function (v) {
    const ui = A.ui;
    const year = ui.tbYear || String((Number(ui.year) || new Date().getFullYear()) + 1), term = ui.tbTerm || '1';
    if (!TB || TB.d.year !== year || TB.d.term !== term) {
      loading(v);
      let d;
      try { d = await api('ttData', { year, term }); } catch (e) { failed(v, e); return; }
      TB = { d, set: Object.assign({}, d.settings), placement: [], res: null, tab: 'base', dirty: false, view: { kind: 'class', id: '' }, pick: null, start: d.start, end: d.end, status: d.status };
      if (!TB.set.assign) TB.set.assign = {};
      if (d.rows.length) { TB.placement = TTM.placementFromRows(d, TB.set, d.rows); evaluate(); TB.tab = 'gen'; }
    }
    drawTB(v);
  };
  function drawTB(v) {
    const ui = A.ui, d = TB.d;
    const tabs = [['base', '1. 기본 설정'], ['assign', '2. 담당 교사'], ['unav', '3. 불가 시간'], ['gen', '4. 생성·수정'], ['pub', '5. 저장·게시']];
    v.innerHTML = '<div class="card tight"><div class="row"><h2>시간표 편성</h2><label class="row small">학년도 <input id="tby" class="input sm w4" value="' + esc(d.year) + '"></label>'
      + '<select id="tbt" class="input sm"><option value="1"' + (d.term === '1' ? ' selected' : '') + '>1학기</option><option value="2"' + (d.term === '2' ? ' selected' : '') + '>2학기</option></select>'
      + (TB.status ? '<span class="pill ' + (TB.status === '게시' ? 'ok' : 'warn') + '">' + esc(TB.status) + '</span>' : '<span class="pill">저장 전</span>') + (TB.dirty ? '<span class="pill warn dirtyp">저장 안 됨</span>' : '')
      + '<span style="margin-left:auto"></span><button class="btn sm" id="tbsave">저장</button></div>'
      + '<div class="seg3" role="tablist">' + tabs.map((t) => '<button type="button" data-tb="' + t[0] + '" class="' + (TB.tab === t[0] ? 'on' : '') + '">' + t[1] + '</button>').join('') + '</div></div><div id="tbb"></div>';
    const reload = () => {
      if (!TB) return;
      if (TB.dirty && !confirm('저장하지 않은 변경을 버릴까요?')) { v.querySelector('#tby').value = d.year; v.querySelector('#tbt').value = d.term; return; }
      ui.tbYear = v.querySelector('#tby').value; ui.tbTerm = v.querySelector('#tbt').value; TB = null; VIEWS.ttbuild(v);
    };
    v.querySelector('#tby').onchange = reload; v.querySelector('#tbt').onchange = reload;
    v.querySelectorAll('[data-tb]').forEach((b) => { b.onclick = () => { TB.tab = b.dataset.tb; drawTB(v); }; });
    v.querySelector('#tbsave').onclick = (e) => saveTB(v, TB.status === '게시' ? '게시' : '작업 중', e.target);
    const b = v.querySelector('#tbb');
    ({ base: tbBase, assign: tbAssign, unav: tbUnav, gen: tbGen, pub: tbPub })[TB.tab](b, v);
  }
  function saveTB(v, status, btn) {
    return run(btn, async () => {
      const rows = TTM.rowsFrom(TB.d, TB.set, TB.placement);
      const r = await api('ttSave', { year: TB.d.year, term: TB.d.term, settings: TB.set, rows, unavailable: TB.d.unavailable, status, start: TB.start || '', end: TB.end || '' });
      TB.status = r.status; TB.dirty = false;
      toast(status === '게시' ? '게시했습니다. 학생·교사 알리미에 바로 보입니다.' : '저장했습니다.');
      drawTB(v);
    });
  }
  const dirty = (v) => { if (!TB) return; TB.dirty = true; const p = v.querySelector('.card .row'); if (p && !p.querySelector('.dirtyp')) { const s = document.createElement('span'); s.className = 'pill warn dirtyp'; s.textContent = '저장 안 됨'; p.insertBefore(s, p.querySelector('#tbsave').previousSibling); } };
  function slotCount() { return TB.set.days.reduce((a, d) => a + (Number(TB.set.periods[d]) || 0), 0); }

  function tbBase(b, v) {
    const set = TB.set, d = TB.d;
    const fixedH = (g) => (set.fixed || []).filter((f) => (f.grades || []).map(String).includes(String(g))).reduce((a, f) => a + (Number(f.hours) || 0), 0);
    b.innerHTML = '<div class="grid2"><div class="card tight"><h3>요일·교시</h3><table class="mini edit"><thead><tr><th>요일</th><th>수업</th><th>교시 수</th></tr></thead><tbody>'
      + ALLDAYS.map((x) => '<tr><td>' + x + '</td><td><input type="checkbox" data-day="' + x + '"' + (set.days.includes(x) ? ' checked' : '') + '></td><td><input class="input sm w4" data-per="' + x + '" inputmode="numeric" value="' + esc(set.periods[x] || '') + '"' + (set.days.includes(x) ? '' : ' disabled') + '></td></tr>').join('')
      + '</tbody></table><p class="hint">한 주 칸 수: <b>' + slotCount() + '</b>칸</p>'
      + '<h3>교시 시간</h3><div class="row">' + Array.from({ length: 9 }, (_, i) => '<label class="field small">' + (i + 1) + '교시<input class="input sm w8" data-time="' + i + '" value="' + esc((set.times || [])[i] || '') + '" placeholder="08:40-09:30"></label>').join('') + '</div></div>'
      + '<div class="card tight"><h3>학년별 시수</h3><table class="mini"><thead><tr><th>학년</th><th>입학년도</th><th>학급</th><th>지정</th><th>블록</th><th>고정</th><th>합계</th></tr></thead><tbody>'
      + d.grades.map((g) => {
        const des = g.subjects.reduce((a, s) => a + s.hours, 0), blk = g.plan ? g.plan.blocks.reduce((a, x) => a + Number(x.credit), 0) : 0, fx = fixedH(g.grade), tot = des + blk + fx;
        return '<tr><td>' + g.grade + '학년</td><td>' + esc(g.cohort) + '</td><td>' + g.classes + '</td><td class="num">' + des + '</td><td class="num">' + blk + (g.plan ? ' <span class="muted small">' + esc(g.plan.status) + '</span>' : (g.classes ? ' <span class="no small">편성 없음</span>' : '')) + '</td><td class="num">' + fx + '</td><td class="num ' + (tot > slotCount() ? 'no' : '') + '"><b>' + tot + '</b></td></tr>';
      }).join('') + '</tbody></table><p class="hint">지정: 교육과정의 지정 과목(학급 단위). 블록: [블록 편성]에서 저장한 학년 전체 선택 과목. 학급 수와 교실은 [관리 → 학급 설정] 기준입니다.</p>'
      + '<div class="row"><h3>고정 수업</h3><span style="margin-left:auto"></span><button class="btn sm" id="fxadd">추가</button></div>'
      + '<table class="mini edit"><thead><tr><th>이름</th><th>학년</th><th>시수</th><th>고정 시간 (예: 금6, 금7)</th><th></th></tr></thead><tbody>'
      + (set.fixed || []).map((f, i) => '<tr><td><input class="input sm w8" data-fx="' + i + '" data-k="name" value="' + esc(f.name) + '"></td><td>' + ['1', '2', '3'].map((g) => '<label class="ck sm"><input type="checkbox" data-fxg="' + i + '" value="' + g + '"' + ((f.grades || []).map(String).includes(g) ? ' checked' : '') + '>' + g + '</label>').join('') + '</td>'
        + '<td><input class="input sm w4" data-fx="' + i + '" data-k="hours" value="' + esc(f.hours) + '"></td><td><input class="input sm w8" data-fxs="' + i + '" value="' + esc((f.slots || []).map((s) => s.day + s.period).join(', ')) + '" placeholder="비우면 자동"></td><td><button class="btn sm dan" data-fxdel="' + i + '" aria-label="삭제">✕</button></td></tr>').join('')
      + '</tbody></table><p class="hint">창의적 체험활동처럼 학급마다 들어가는 수업입니다. 고정 시간을 적으면 그 시간에 넣고, 비우면 자동으로 넣습니다.</p></div></div>';
    const later = (fn) => setTimeout(fn, 0);
    b.querySelectorAll('[data-day]').forEach((el) => { el.onchange = () => { set.days = ALLDAYS.filter((x) => b.querySelector('[data-day="' + x + '"]').checked); if (el.checked && !set.periods[el.dataset.day]) set.periods[el.dataset.day] = 7; dirty(v); later(() => tbBase(b, v)); }; });
    b.querySelectorAll('[data-per]').forEach((el) => { el.onchange = () => { set.periods[el.dataset.per] = Math.max(0, Math.min(10, Number(el.value) || 0)); dirty(v); later(() => tbBase(b, v)); }; });
    b.querySelectorAll('[data-time]').forEach((el) => { el.onchange = () => { set.times = set.times || []; set.times[Number(el.dataset.time)] = el.value.trim(); dirty(v); }; });
    b.querySelectorAll('[data-fx]').forEach((el) => { el.onchange = () => { set.fixed[Number(el.dataset.fx)][el.dataset.k] = el.dataset.k === 'hours' ? Number(el.value) || 0 : el.value; dirty(v); later(() => tbBase(b, v)); }; });
    b.querySelectorAll('[data-fxg]').forEach((el) => { el.onchange = () => { const i = Number(el.dataset.fxg); set.fixed[i].grades = Array.from(b.querySelectorAll('[data-fxg="' + i + '"]:checked')).map((x) => x.value); dirty(v); later(() => tbBase(b, v)); }; });
    b.querySelectorAll('[data-fxs]').forEach((el) => {
      el.onchange = () => {
        const slots = el.value.split(/[,\s]+/).filter(Boolean).map((t) => { const m = t.match(/^([월화수목금토])\s*(\d+)/); return m ? { day: m[1], period: Number(m[2]) } : null; }).filter(Boolean);
        set.fixed[Number(el.dataset.fxs)].slots = slots; dirty(v); later(() => tbBase(b, v));
      };
    });
    b.querySelectorAll('[data-fxdel]').forEach((el) => { el.onclick = () => { set.fixed.splice(Number(el.dataset.fxdel), 1); dirty(v); tbBase(b, v); }; });
    b.querySelector('#fxadd').onclick = () => { (set.fixed = set.fixed || []).push({ name: '', grades: ['1', '2', '3'], hours: 1, slots: [] }); dirty(v); tbBase(b, v); };
  }

  function tbAssign(b, v) {
    const d = TB.d, set = TB.set, classes = TTM.classesFrom(d);
    const loads = TTM.loads(d, set);
    const opt = (group, cur) => {
      const gs = String(group || '').split(/[·,]/).filter(Boolean);
      const mine = d.teachers.filter((t) => gs.includes(t.subject)), rest = d.teachers.filter((t) => !gs.includes(t.subject));
      return '<option value="">-</option>' + mine.concat(rest).map((t) => '<option value="' + esc(t.id) + '"' + (t.id === cur ? ' selected' : '') + '>' + esc(t.name) + (gs.includes(t.subject) ? '' : ' (' + esc(t.subject || '교과 없음') + ')') + '</option>').join('');
    };
    const empties = d.grades.reduce((a, g) => a + classes.filter((c) => c.grade === g.grade).length * g.subjects.length, 0) - Object.keys(set.assign).filter((k) => set.assign[k]).length;
    b.innerHTML = '<div class="card tight"><div class="row"><h3>지정 과목 담당 교사</h3><span class="muted small">빈 칸 ' + empties + '개</span><span style="margin-left:auto"></span><button class="btn sm" id="aa1">빈 칸 자동 배정</button><button class="btn sm" id="aa2">모두 다시 자동 배정</button></div>'
      + '<p class="hint">정원과목이 같은 교사(교사 계정의 「교과」)에게 이어진 반을 고르게 나눕니다. 블록 편성에서 맡은 분반 시수도 함께 셉니다.</p></div>'
      + '<div class="grid-tb"><div>' + d.grades.filter((g) => g.subjects.length && g.classes).map((g) => {
        const ck = classes.filter((c) => c.grade === g.grade);
        return '<div class="card tight"><h3>' + g.grade + '학년</h3><div class="tbl-wrap"><table class="tbl edit"><thead><tr><th>과목</th>' + ck.map((c) => '<th>' + c.cls + '반</th>').join('') + '</tr></thead><tbody>'
          + g.subjects.map((s) => '<tr><td><b>' + esc(s.name) + '</b><br><span class="muted small">' + s.hours + '시간 · ' + esc(s.group || '-') + '</span></td>'
            + ck.map((c) => '<td><select class="input sm asel" data-as="' + esc(c.key + '|' + s.name) + '">' + opt(s.group, set.assign[c.key + '|' + s.name]) + '</select></td>').join('') + '</tr>').join('')
          + '</tbody></table></div></div>';
      }).join('') + '</div><div class="card tight"><h3>교사별 시수</h3><table class="mini"><thead><tr><th>교사</th><th>교과</th><th>시수</th></tr></thead><tbody>'
      + d.teachers.filter((t) => loads[t.id]).sort((x, y) => loads[y.id] - loads[x.id]).map((t) => '<tr><td>' + esc(t.name) + '</td><td>' + esc(t.subject || '') + '</td><td class="num ' + (loads[t.id] > 20 ? 'no' : '') + '">' + loads[t.id] + '</td></tr>').join('')
      + '</tbody></table></div></div>';
    b.querySelectorAll('[data-as]').forEach((el) => { el.onchange = () => { set.assign[el.dataset.as] = el.value; dirty(v); setTimeout(() => tbAssign(b, v), 0); }; });
    const auto = (keep) => {
      const r = TTM.autoAssign(d, set, keep);
      set.assign = r.assign; dirty(v); tbAssign(b, v);
      toast(r.missing.length ? '교과가 맞는 교사가 없는 과목: ' + r.missing.join(', ') : '배정했습니다.', !!r.missing.length);
    };
    b.querySelector('#aa1').onclick = () => auto(true);
    b.querySelector('#aa2').onclick = () => { if (confirm('지금 배정을 모두 지우고 새로 배정할까요?')) auto(false); };
  }

  function tbUnav(b, v) {
    const d = TB.d, ui = A.ui;
    const cnt = {}; d.unavailable.forEach((u) => { cnt[u.교사ID] = (cnt[u.교사ID] || 0) + 1; });
    if (!ui.unT) ui.unT = (d.teachers[0] || {}).id;
    const set = TB.set, maxP = Math.max(...set.days.map((x) => Number(set.periods[x]) || 0));
    const has = (day, p) => d.unavailable.some((u) => u.교사ID === ui.unT && u.요일 === day && Number(u.교시) === p);
    b.innerHTML = '<div class="grid-tb"><div class="card tight"><div class="row"><h3>교사 불가 시간</h3><select id="unt" class="input sm">' + d.teachers.map((t) => '<option value="' + esc(t.id) + '"' + (t.id === ui.unT ? ' selected' : '') + '>' + esc(t.name) + (cnt[t.id] ? ' (' + cnt[t.id] + ')' : '') + '</option>').join('') + '</select></div>'
      + '<table class="wkt small unav"><thead><tr><th class="pc"></th>' + set.days.map((x) => '<th>' + x + '</th>').join('') + '</tr></thead><tbody>'
      + Array.from({ length: maxP }, (_, i) => '<tr><th class="pc">' + (i + 1) + '</th>' + set.days.map((x) => i + 1 > (Number(set.periods[x]) || 0) ? '<td class="off"></td>' : '<td><button type="button" class="ub' + (has(x, i + 1) ? ' on' : '') + '" data-u="' + x + '|' + (i + 1) + '">' + (has(x, i + 1) ? '불가' : '') + '</button></td>').join('') + '</tr>').join('')
      + '</tbody></table><p class="hint">칸을 누르면 불가/가능이 바뀝니다. 시간표를 만들 때 이 시간에는 그 교사 수업을 넣지 않습니다.</p></div>'
      + '<div class="card tight"><h3>불가 시간이 있는 교사</h3><table class="mini"><tbody>' + d.teachers.filter((t) => cnt[t.id]).map((t) => '<tr><td>' + esc(t.name) + '</td><td class="small">' + d.unavailable.filter((u) => u.교사ID === t.id).map((u) => u.요일 + u.교시).join(', ') + '</td></tr>').join('') + '</tbody></table></div></div>';
    b.querySelector('#unt').onchange = (e) => { ui.unT = e.target.value; tbUnav(b, v); };
    b.querySelectorAll('[data-u]').forEach((el) => {
      el.onclick = () => {
        const [day, p] = el.dataset.u.split('|');
        const i = d.unavailable.findIndex((u) => u.교사ID === ui.unT && u.요일 === day && Number(u.교시) === Number(p));
        if (i >= 0) d.unavailable.splice(i, 1); else d.unavailable.push({ 교사ID: ui.unT, 요일: day, 교시: p, 구분: '불가', 메모: '' });
        dirty(v); if (TB.placement.length) evaluate(); tbUnav(b, v);
      };
    });
  }

  /** 편성 화면용 칸 내용 */
  function genView(kind, id) {
    const d = TB.d, set = TB.set;
    const lessons = {}; TTM.lessonsFrom(d, set).forEach((l) => { lessons[l.id] = l; });
    const clashT = {}, clashR = {}, un = {};
    (TB.res ? TB.res.tClash : []).forEach((x) => { clashT[x.teacherId + '|' + x.day + '|' + x.period] = 1; });
    (TB.res ? TB.res.unav : []).forEach((x) => { un[x.teacherId + '|' + x.day + '|' + x.period] = 1; });
    (TB.res ? TB.res.rClash : []).forEach((x) => { clashR[x.room + '|' + x.day + '|' + x.period] = 1; });
    const cells = {};
    const add = (k, c) => { (cells[k] = cells[k] || []).push(c); };
    TB.placement.forEach((p) => {
      const l = lessons[p.lessonId]; if (!l) return;
      const k = p.day + '|' + p.period;
      const bad = l.teachers.some((t) => clashT[t + '|' + k] || un[t + '|' + k]) || (l.rooms || []).some((r) => clashR[r + '|' + k]);
      if (kind === 'class') {
        if (!l.classKeys.includes(id)) return;
        add(k, { kind: l.kind, title: l.name, sub: l.kind === '블록' ? l.sections + '개 분반' : '', teacher: l.kind === '지정' ? tName(l.teachers[0]) : '', bad });
      } else if (kind === 'teacher') {
        if (!l.teachers.includes(id)) return;
        add(k, { kind: l.kind, title: l.kind === '블록' ? l.grade + '학년 ' + l.name : l.name, sub: l.kind === '블록' ? '' : l.classKeys[0], bad: clashT[id + '|' + k] || un[id + '|' + k] });
      }
    });
    return { days: set.days, periods: set.periods, times: set.times, cells, week: [] };
  }
  function tbGen(b, v) {
    const ui = A.ui, d = TB.d, classes = TTM.classesFrom(d);
    if (!TB.view.id) TB.view.id = (classes[0] || {}).key || '';
    const res = TB.res;
    const tn = (x) => tName(x.teacherId);
    const issues = res ? res.issues : [];
    const opts = TB.view.kind === 'class' ? classes.map((c) => '<option value="' + c.key + '"' + (c.key === TB.view.id ? ' selected' : '') + '>' + c.grade + '학년 ' + c.cls + '반</option>').join('')
      : d.teachers.map((t) => '<option value="' + esc(t.id) + '"' + (t.id === TB.view.id ? ' selected' : '') + '>' + esc(t.name) + '</option>').join('');
    b.innerHTML = '<div class="card tight"><div class="row"><button class="btn pri" id="tgo">' + (TB.placement.length ? '다시 자동 생성' : '자동 생성') + '</button><span class="muted small" id="tgp"></span>'
      + (res ? (res.ok ? '<span class="pill ok">겹침 없음</span>' : '') : '') + '<span style="margin-left:auto"></span>'
      + '<select id="tvk" class="input sm"><option value="class"' + (TB.view.kind === 'class' ? ' selected' : '') + '>학급별</option><option value="teacher"' + (TB.view.kind === 'teacher' ? ' selected' : '') + '>교사별</option></select><select id="tvi" class="input sm">' + opts + '</select></div>'
      + (issues.length ? '<ul class="msgs">' + issues.map((x) => '<li class="' + x.level + '">' + esc(x.text) + '</li>').join('') + '</ul>' : '')
      + (res && res.tClash.length ? '<details class="small"><summary>교사 겹침 자세히</summary>' + res.tClash.slice(0, 40).map((x) => esc(tn(x) + ' ' + x.day + x.period)).join(', ') + '</details>' : '')
      + (res && res.unav.length ? '<details class="small"><summary>불가 시간 수업 자세히</summary>' + res.unav.slice(0, 40).map((x) => esc(tn(x) + ' ' + x.day + x.period)).join(', ') + '</details>' : '')
      + '</div>'
      + (TB.placement.length ? '<div class="card tight"><div class="tbl-wrap wk-wrap">' + weekTable(genView(TB.view.kind, TB.view.id), { click: TB.view.kind === 'class', pick: TB.pick }) + '</div>'
        + '<p class="hint">' + (TB.view.kind === 'class' ? '두 칸을 차례로 누르면 서로 바꿉니다. 블록이 들어 있는 칸을 바꾸면 그 학년 모든 반이 함께 바뀝니다. 빨간 칸은 교사·교실이 겹치거나 불가 시간인 수업입니다.' : '교사별 보기입니다. 고치려면 학급별 보기에서 바꾸세요.') + '</p></div>'
        : '<div class="card"><div class="empty">[자동 생성]을 누르면 시간표를 만듭니다. 그 전에 담당 교사와 불가 시간을 정해 두세요.</div></div>');
    b.querySelector('#tvk').onchange = (e) => { TB.view = { kind: e.target.value, id: '' }; TB.pick = null; tbGen(b, v); };
    b.querySelector('#tvi').onchange = (e) => { TB.view.id = e.target.value; TB.pick = null; tbGen(b, v); };
    const go = b.querySelector('#tgo');
    go.onclick = () => {
      if (TB.placement.length && !confirm('지금 시간표를 새로 만든 시간표로 바꿀까요?')) return;
      const inp = TTM.engineInput(d, TB.set);
      if (!inp.lessons.length) { toast('넣을 수업이 없습니다. 교육과정·학급 수를 확인해 주세요.', true); return; }
      const p = b.querySelector('#tgp');
      run(go, async () => {
        p.textContent = '계산 중…';
        const r = await runTT(inp, { iters: 250000, timeLimit: 30000 }, (x) => { p.textContent = Math.round(100 * x.it / x.iters) + '%'; });
        TB.placement = r.placement; TB.res = r; dirty(v);
        toast(r.ok ? '시간표를 만들었습니다.' : '만들었지만 확인할 문제가 있습니다.', !r.ok);
        tbGen(b, v);
      });
    };
    b.querySelectorAll('[data-cell]').forEach((td) => {
      td.onclick = () => {
        const key = td.dataset.cell;
        if (!TB.pick) { TB.pick = key; tbGen(b, v); return; }
        if (TB.pick === key) { TB.pick = null; tbGen(b, v); return; }
        swapCells(TB.view.id, TB.pick, key);
        TB.pick = null; evaluate(); dirty(v); tbGen(b, v);
      };
    });
  }
  function swapCells(classKey, k1, k2) {
    const lessons = {}; TTM.lessonsFrom(TB.d, TB.set).forEach((l) => { lessons[l.id] = l; });
    const [d1, p1] = k1.split('|'), [d2, p2] = k2.split('|');
    const at = (key, day, per) => TB.placement.filter((p) => p.day === day && String(p.period) === String(per) && lessons[p.lessonId] && lessons[p.lessonId].classKeys.includes(key));
    const a = at(classKey, d1, p1), bb = at(classKey, d2, p2);
    const wide = a.concat(bb).some((p) => lessons[p.lessonId].kind === '블록');
    let move;
    if (wide) {
      const grade = classKey.split('-')[0];
      const keys = TTM.classesFrom(TB.d).filter((c) => c.grade === grade).map((c) => c.key);
      const set = new Set();
      keys.forEach((k) => { at(k, d1, p1).concat(at(k, d2, p2)).forEach((p) => set.add(p)); });
      move = Array.from(set);
      if (!confirm('블록이 들어 있어 ' + grade + '학년 모든 반의 ' + d1 + p1 + '·' + d2 + p2 + ' 시간을 함께 바꿉니다.')) return;
    } else move = a.concat(bb);
    move.forEach((p) => {
      if (p.day === d1 && String(p.period) === String(p1)) { p.day = d2; p.period = Number(p2); } else { p.day = d1; p.period = Number(p1); }
    });
  }
  function tbPub(b, v) {
    const res = TB.res;
    b.innerHTML = '<div class="card tight" style="max-width:640px"><h3>저장·게시</h3>'
      + (res ? (res.ok ? '<div class="note ok">교사·교실 겹침과 불가 시간 문제가 없습니다.</div>' : '<div class="note err">아직 해결하지 않은 문제가 있습니다: ' + esc(res.issues.filter((x) => x.level === 'error').map((x) => x.text).join(', ')) + '</div>') : '<div class="note warn">아직 시간표를 만들지 않았습니다.</div>')
      + '<div class="grid2 tight2"><div class="field"><label for="pst">적용 시작일</label><input type="date" id="pst" class="input" value="' + esc(TB.start || '') + '"></div><div class="field"><label for="pen">적용 끝 (선택)</label><input type="date" id="pen" class="input" value="' + esc(TB.end || '') + '"></div></div>'
      + '<p class="hint">「게시」하면 적용 시작일부터 학생·교사 알리미의 시간표에 나타납니다. 다음 학기 시간표를 미리 게시해 두어도, 시작일 전에는 지금 시간표가 보입니다. 게시한 뒤에 고쳐서 저장해도 바로 반영됩니다.</p>'
      + '<label class="ck"><input type="checkbox" id="pnot"> 게시하면서 학생·교사 모두에게 알림 보내기</label>'
      + '<div class="row" style="justify-content:flex-end"><button class="btn" id="psave">작업 중으로 저장</button><button class="btn pri" id="ppub">게시</button></div></div>';
    b.querySelector('#pst').onchange = (e) => { TB.start = e.target.value; dirty(v); };
    b.querySelector('#pen').onchange = (e) => { TB.end = e.target.value; dirty(v); };
    b.querySelector('#psave').onclick = (e) => saveTB(v, '작업 중', e.target);
    b.querySelector('#ppub').onclick = (e) => {
      if (!TB.start) { toast('적용 시작일을 넣어 주세요.', true); return; }
      if (res && !res.ok && !confirm('해결하지 않은 문제가 있습니다. 그래도 게시할까요?')) return;
      const notify = b.querySelector('#pnot').checked;
      saveTB(v, '게시', e.target).then(() => {
        if (notify && TB && TB.status === '게시') api('noticeSend', { target: { kind: 'all' }, title: '시간표 안내', body: TB.d.year + '학년도 ' + TB.d.term + '학기 시간표가 ' + TB.start + '부터 적용됩니다.' }).then(() => toast('알림도 보냈습니다.')).catch((err) => toast(err.message, true));
      });
    };
  }

  /* =========================================================
     출력: 학급·교사·교실·학생·일람표
     ========================================================= */
  function cellsFrom(P, kind, id) {
    const tn = (x) => (P.teachers[x] || {}).name || '';
    const secs = (pid, block) => P.sections.filter((x) => x.편성ID === pid && x.블록 === block);
    const cells = {}, add = (k, c) => { (cells[k] = cells[k] || []).push(c); };
    const seen = {};
    P.rows.forEach((r) => {
      const k = r.요일 + '|' + r.교시;
      if (kind === 'class') {
        if (r.학년 + '-' + r.반 !== id) return;
        add(k, r.종류 === '블록' ? { kind: '블록', title: r.대상 + ' 블록', sub: secs(r.편성ID, r.대상).map((x) => x.과목).filter((x, i, a) => a.indexOf(x) === i).slice(0, 3).join('·') + '…' } : { kind: r.종류, title: r.대상, teacher: tn(r.교사ID), room: r.교실 });
      } else if (kind === 'student') {
        const s = id;
        if (r.학년 !== s.grade || r.반 !== s.classNo) return;
        if (r.종류 === '블록') {
          const x = secs(r.편성ID, r.대상).find((q) => (P.assign[q.분반ID] || []).includes(s.id));
          add(k, x ? { kind: '블록', title: x.과목, room: x.교실, teacher: tn(x.교사ID) } : { kind: '블록', title: r.대상 + ' 블록' });
        } else add(k, { kind: r.종류, title: r.대상, teacher: tn(r.교사ID), room: r.교실 });
      } else {
        if (r.종류 === '블록') {
          const bk = r.학년 + '|' + r.대상 + '|' + k; if (seen[bk]) return; seen[bk] = 1;
          secs(r.편성ID, r.대상).forEach((x) => {
            if ((kind === 'teacher' && x.교사ID === id) || (kind === 'room' && x.교실 === id)) add(k, { kind: '블록', title: x.과목, sub: r.학년 + '학년 ' + x.표시, room: kind === 'teacher' ? x.교실 : '', teacher: kind === 'room' ? tn(x.교사ID) : '' });
          });
        } else if ((kind === 'teacher' && r.교사ID === id) || (kind === 'room' && r.교실 === id)) add(k, { kind: r.종류, title: r.대상, sub: r.학년 + '-' + r.반, room: kind === 'teacher' ? r.교실 : '', teacher: kind === 'room' ? tn(r.교사ID) : '' });
      }
    });
    return { days: P.settings.days, periods: P.settings.periods, times: P.settings.times, cells, week: [] };
  }
  function targets(P) {
    const classes = {}, rooms = {}, tids = {};
    P.rows.forEach((r) => { classes[r.학년 + '-' + r.반] = 1; if (r.교실) rooms[r.교실] = 1; if (r.교사ID) tids[r.교사ID] = 1; });
    P.sections.forEach((x) => { if (x.교실) rooms[x.교실] = 1; if (x.교사ID) tids[x.교사ID] = 1; });
    return {
      classes: Object.keys(classes).sort((a, b) => { const x = a.split('-'), y = b.split('-'); return x[0] - y[0] || x[1] - y[1]; }),
      teachers: Object.keys(tids).map((t) => ({ id: t, name: (P.teachers[t] || {}).name || t })).sort((a, b) => (a.name < b.name ? -1 : 1)),
      rooms: Object.keys(rooms).sort(),
    };
  }
  function printPages(pages, land) {
    const school = A.ui.school || CFG.SCHOOL_NAME || '';
    document.getElementById('print-area').innerHTML = pages.map((p) => '<section class="ttp' + (land ? ' land' : '') + '"><div class="ttph"><b>' + esc(p.title) + '</b><span>' + esc(school + ' · ' + p.caption) + '</span></div>' + p.html + '</section>').join('');
    setTimeout(() => window.print(), 60);
  }
  VIEWS.ttprint = async function (v) {
    loading(v);
    const ui = A.ui;
    let vers;
    try { vers = await api('ttVersions', {}); } catch (e) { failed(v, e); return; }
    if (!vers.length) { v.innerHTML = '<div class="card"><h2>출력</h2><div class="empty">저장된 시간표가 없습니다.</div></div>'; return; }
    if (!ui.prVer || !vers.some((x) => x.version === ui.prVer)) ui.prVer = (vers.find((x) => x.status === '게시') || vers[0]).version;
    let P;
    try { P = await api('ttPrint', { version: ui.prVer }); } catch (e) { failed(v, e); return; }
    const T = targets(P);
    const cap = P.year + '학년도 ' + P.term + '학기 시간표' + (P.start ? ' (' + P.start + '부터)' : '');
    v.innerHTML = '<div class="card tight"><div class="row"><h2>시간표 출력</h2><select id="pv" class="input sm">' + vers.map((x) => '<option value="' + esc(x.version) + '"' + (x.version === ui.prVer ? ' selected' : '') + '>' + esc(x.year + '학년도 ' + x.term + '학기 · ' + x.status) + '</option>').join('') + '</select></div></div>'
      + '<div class="grid2">'
      + '<div class="card tight"><h3>학급별</h3><p class="hint">학급 ' + T.classes.length + '개, 한 장에 한 반</p><div class="row"><button class="btn" id="p1">모두 인쇄</button><select id="p1s" class="input sm"><option value="">한 반만…</option>' + T.classes.map((c) => '<option>' + c + '</option>').join('') + '</select></div></div>'
      + '<div class="card tight"><h3>교사별</h3><p class="hint">교사 ' + T.teachers.length + '명, 한 장에 두 명</p><div class="row"><button class="btn" id="p2">모두 인쇄</button><select id="p2s" class="input sm"><option value="">한 명만…</option>' + T.teachers.map((t) => '<option value="' + esc(t.id) + '">' + esc(t.name) + '</option>').join('') + '</select></div></div>'
      + '<div class="card tight"><h3>교실별</h3><p class="hint">교실 ' + T.rooms.length + '개 (특별실 포함)</p><div class="row"><button class="btn" id="p3">모두 인쇄</button></div></div>'
      + '<div class="card tight"><h3>학생별</h3><p class="hint">반을 고르면 학생마다 자기 선택 과목·교실이 들어간 시간표를 한 장에 두 명씩 인쇄합니다.</p><div class="row"><select id="p4s" class="input sm">' + T.classes.map((c) => '<option>' + c + '</option>').join('') + '</select><button class="btn" id="p4">인쇄</button></div></div>'
      + '<div class="card tight" style="grid-column:1/-1"><h3>일람표</h3><p class="hint">교사(또는 학급) × 요일·교시 한눈에 보기. 가로 A4로 인쇄하거나 엑셀로 받습니다.</p><div class="row"><button class="btn" id="p5">교사 일람표 인쇄</button><button class="btn" id="p6">학급 일람표 인쇄</button><button class="btn" id="p7">일람표 엑셀</button></div></div></div>';
    v.querySelector('#pv').onchange = (e) => { ui.prVer = e.target.value; VIEWS.ttprint(v); };
    const one = (kind, id, title) => ({ title, caption: cap, html: weekTable(cellsFrom(P, kind, id), { small: true }) });
    v.querySelector('#p1').onclick = () => printPages(T.classes.map((c) => one('class', c, c.replace('-', '학년 ') + '반')), true);
    v.querySelector('#p1s').onchange = (e) => { if (e.target.value) printPages([one('class', e.target.value, e.target.value.replace('-', '학년 ') + '반')], true); e.target.value = ''; };
    v.querySelector('#p2').onclick = () => printPages(T.teachers.map((t) => one('teacher', t.id, t.name + ' 선생님')), false);
    v.querySelector('#p2s').onchange = (e) => { const t = T.teachers.find((x) => x.id === e.target.value); if (t) printPages([one('teacher', t.id, t.name + ' 선생님')], true); e.target.value = ''; };
    v.querySelector('#p3').onclick = () => printPages(T.rooms.map((r) => one('room', r, r + ' 교실')), false);
    v.querySelector('#p4').onclick = (e) => run(e.target, async () => {
      const full = await api('ttPrint', { version: ui.prVer, students: true });
      const [g, c] = v.querySelector('#p4s').value.split('-');
      const studs = full.students.filter((s) => s.grade === g && s.classNo === c).sort((a, b) => Number(a.number) - Number(b.number));
      if (!studs.length) { toast('그 반 학생이 명렬에 없습니다. (학년도 전환 전이면 학년이 다를 수 있습니다)', true); return; }
      printPages(studs.map((s) => ({ title: s.grade + '학년 ' + s.classNo + '반 ' + s.number + '번 ' + s.name, caption: cap, html: weekTable(cellsFrom(full, 'student', s), { small: true }) })), false);
    });
    const slotsOf = () => { const out = []; P.settings.days.forEach((d) => { for (let p = 1; p <= (Number(P.settings.periods[d]) || 0); p++) out.push(d + '|' + p); }); return out; };
    const matrix = (kind) => {
      const slots = slotsOf();
      const list = kind === 'teacher' ? T.teachers.map((t) => [t.name, t.id]) : T.classes.map((c) => [c, c]);
      return { slots, rows: list.map(([label, id]) => { const cv = cellsFrom(P, kind, id).cells; return [label].concat(slots.map((k) => (cv[k] || []).map((x) => kind === 'teacher' ? (x.sub ? x.sub + ' ' : '') + x.title : x.title).join('/'))); }) };
    };
    const matrixHtml = (kind) => {
      const m = matrix(kind);
      return '<table class="ilr"><thead><tr><th></th>' + P.settings.days.map((d) => '<th colspan="' + P.settings.periods[d] + '">' + d + '</th>').join('') + '</tr><tr><th></th>' + m.slots.map((k) => '<th>' + k.split('|')[1] + '</th>').join('') + '</tr></thead><tbody>'
        + m.rows.map((r) => '<tr><th>' + esc(r[0]) + '</th>' + r.slice(1).map((x) => '<td>' + esc(x) + '</td>').join('') + '</tr>').join('') + '</tbody></table>';
    };
    v.querySelector('#p5').onclick = () => printPages([{ title: '교사 시간표 일람표', caption: cap, html: matrixHtml('teacher') }], true);
    v.querySelector('#p6').onclick = () => printPages([{ title: '학급 시간표 일람표', caption: cap, html: matrixHtml('class') }], true);
    v.querySelector('#p7').onclick = () => {
      const wb = window.XLSX.utils.book_new();
      ['teacher', 'class'].forEach((kind) => {
        const m = matrix(kind);
        const h1 = [''].concat(m.slots.map((k) => k.split('|')[0])), h2 = [kind === 'teacher' ? '교사' : '학급'].concat(m.slots.map((k) => k.split('|')[1] + '교시'));
        const ws = window.XLSX.utils.aoa_to_sheet([h1, h2].concat(m.rows));
        ws['!cols'] = [{ wch: 10 }].concat(m.slots.map(() => ({ wch: 9 })));
        window.XLSX.utils.book_append_sheet(wb, ws, kind === 'teacher' ? '교사 일람표' : '학급 일람표');
      });
      saveBlob(new Blob([window.XLSX.write(wb, { type: 'array', bookType: 'xlsx' })], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }), P.year + '학년도 ' + P.term + '학기 시간표 일람표.xlsx');
    };
  };

  /* =========================================================
     알림: 받은 알림 · 이 기기 푸시 · 보내기
     ========================================================= */
  const PUSH_KEY = 'alimi:push:' + A.MODE;
  function loadScript(src) { return new Promise((res, rej) => { if (document.querySelector('script[src="' + src + '"]')) { res(); return; } const s = document.createElement('script'); s.src = src; s.onload = res; s.onerror = () => rej(new Error(src + '를 불러오지 못했습니다.')); document.head.appendChild(s); }); }
  async function pushToken() {
    const F = CFG.FIREBASE || {};
    if (!F.apiKey || !F.vapidKey || !F.appId) throw new Error('config.js에 Firebase 설정(apiKey·appId·vapidKey)이 아직 없습니다. 관리자에게 알려 주세요.');
    if (!('serviceWorker' in navigator) || !('Notification' in window)) throw new Error('이 브라우저는 알림을 지원하지 않습니다. (아이폰은 홈 화면에 추가한 앱에서만 됩니다)');
    const perm = await Notification.requestPermission();
    if (perm !== 'granted') throw new Error('알림 권한이 꺼져 있습니다. 브라우저 주소창 왼쪽 자물쇠 → 알림 → 허용으로 바꿔 주세요.');
    await loadScript('lib/firebase-app-compat.js'); await loadScript('lib/firebase-messaging-compat.js');
    if (!window.firebase.apps.length) window.firebase.initializeApp({ apiKey: F.apiKey, authDomain: F.authDomain, projectId: F.projectId, messagingSenderId: F.messagingSenderId, appId: F.appId });
    const reg = await navigator.serviceWorker.ready;
    const messaging = window.firebase.messaging();
    messaging.onMessage((p) => { const m = Object.assign({}, p.notification || {}, p.data || {}); toast((m.title || '알림') + (m.body ? ' — ' + m.body : '')); });
    return messaging.getToken({ vapidKey: F.vapidKey, serviceWorkerRegistration: reg });
  }
  VIEWS.notice = async function (v) {
    loading(v);
    const u = A.S.user || {};
    let list, cfg;
    try { [list, cfg] = await Promise.all([api('noticeList', {}), api('pushConfig', {})]); } catch (e) { failed(v, e); return; }
    const canAll = u.kind === 'teacher' && ['최종관리자', '일과담당'].includes(u.role);
    const canClass = u.kind === 'teacher' && u.homeroom;
    const tok = (() => { try { return localStorage.getItem(PUSH_KEY) || ''; } catch (e) { return ''; } })();
    const perm = 'Notification' in window ? Notification.permission : 'unsupported';
    const ready = cfg.enabled && CFG.FIREBASE && CFG.FIREBASE.apiKey;
    v.innerHTML = '<div class="grid-nt"><div class="card tight"><h2>받은 알림</h2>' + (list.length ? '<ul class="nlist">' + list.map((n) => '<li><div class="row"><b>' + esc(n.title) + '</b><span class="muted small" style="margin-left:auto">' + esc(n.time.slice(5, 16)) + ' · ' + esc(n.from) + '</span></div>' + (n.body ? '<div class="small">' + esc(n.body) + '</div>' : '') + '</li>').join('') + '</ul>' : '<div class="empty">아직 받은 알림이 없습니다.</div>') + '</div>'
      + '<div class="side-nt"><div class="card tight"><h3>이 기기에서 알림 받기</h3>'
      + (ready ? '<div class="row"><span class="pill ' + (tok && perm === 'granted' ? 'ok' : '') + '">' + (tok && perm === 'granted' ? '켜짐' : '꺼짐') + '</span><span style="margin-left:auto"></span>' + (tok ? '<button class="btn sm" id="pt">시험 알림</button><button class="btn sm" id="poff">끄기</button>' : '<button class="btn pri sm" id="pon">알림 켜기</button>') + '</div>'
        + '<p class="hint">시간표가 바뀌거나 공지가 오면 알려 줍니다. PC는 Edge·Chrome, 휴대폰은 「홈 화면에 추가」한 앱에서 켜 주세요. 아이폰은 iOS 16.4 이상, 홈 화면 앱에서만 됩니다.</p>'
        : '<div class="note warn">푸시 알림은 아직 준비 중입니다. 관리자가 Firebase 설정을 마치면 켤 수 있습니다. 그 전에도 이 화면에서 알림을 볼 수 있습니다.</div>') + '</div>'
      + ((canAll || canClass) ? '<div class="card tight"><h3>알림 보내기</h3><div class="field"><label for="nk">받는 사람</label><select id="nk" class="input">'
        + (canAll ? '<option value="all">전체 (학생·교사)</option><option value="students">학생 전체</option><option value="teachers">교사 전체</option>' + [1, 2, 3].map((g) => '<option value="grade:' + g + '">' + g + '학년 학생</option>').join('') : '')
        + (canClass ? '<option value="class:' + u.homeroom.grade + '-' + u.homeroom.classNo + '">우리 반 (' + u.homeroom.grade + '-' + u.homeroom.classNo + ')</option>' : '')
        + (canAll ? '<option value="class:">반 고르기…</option>' : '') + '</select></div><div class="field" id="ncw" hidden><label for="nc">반 (예: 2-3)</label><input id="nc" class="input" placeholder="2-3"></div>'
        + '<div class="field"><label for="nt">제목</label><input id="nt" class="input" maxlength="60"></div><div class="field"><label for="nb">내용</label><textarea id="nb" class="input" rows="3" maxlength="400"></textarea></div>'
        + '<div class="row" style="justify-content:flex-end"><button class="btn pri" id="ns">보내기</button></div></div>' : '') + '</div></div>';
    const pon = v.querySelector('#pon');
    if (pon) pon.onclick = () => run(pon, async () => { const t = await pushToken(); await api('pushRegister', { token: t, platform: navigator.userAgent.slice(0, 60) }); try { localStorage.setItem(PUSH_KEY, t); } catch (e) { /* */ } toast('알림을 켰습니다.'); VIEWS.notice(v); });
    const pt = v.querySelector('#pt');
    if (pt) pt.onclick = () => run(pt, async () => { const r = await api('pushTest', {}); toast(r.sent ? '시험 알림을 보냈습니다.' : '보낼 기기가 없습니다. 알림을 다시 켜 주세요.', !r.sent); });
    const poff = v.querySelector('#poff');
    if (poff) poff.onclick = () => run(poff, async () => { await api('pushUnregister', { token: tok }); try { localStorage.removeItem(PUSH_KEY); } catch (e) { /* */ } toast('이 기기 알림을 껐습니다.'); VIEWS.notice(v); });
    const nk = v.querySelector('#nk');
    if (nk) nk.onchange = () => { v.querySelector('#ncw').hidden = nk.value !== 'class:'; };
    const ns = v.querySelector('#ns');
    if (ns) ns.onclick = () => run(ns, async () => {
      let [kind, val] = nk.value.split(':');
      if (kind === 'class' && !val) val = v.querySelector('#nc').value.trim();
      const target = kind === 'grade' ? { kind, grade: val } : kind === 'class' ? { kind, grade: (val || '').split('-')[0], classNo: (val || '').split('-')[1] } : { kind };
      if (kind === 'class' && !target.classNo) { toast('반을 2-3처럼 넣어 주세요.', true); return; }
      const r = await api('noticeSend', { target, title: v.querySelector('#nt').value, body: v.querySelector('#nb').value });
      toast(r.target + '에게 보냈습니다.' + (r.enabled ? ' (기기 ' + r.sent + '대)' : ' (푸시 설정 전이라 알림 목록에만 올라감)'));
      VIEWS.notice(v);
    });
  };
})();
