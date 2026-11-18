/* 일과 알리미 — 5단계: 일과 운영(보강·교체·자습), 일일 변경표, 학년도 전환, 개인정보 보관 기준 */
(function () {
  'use strict';
  const A = window.APP;
  if (!A) return;
  const { api, esc, toast, run, modal } = A;
  const VIEWS = A.VIEWS, CFG = A.CFG || {};
  const pad = (n) => String(n).padStart(2, '0');
  const todayStr = () => { const d = new Date(); return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()); };
  const addDays = (s, n) => { const p = s.split('-').map(Number); const d = new Date(p[0], p[1] - 1, p[2] + n); return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()); };
  const dname = (s) => '일월화수목금토'[new Date(s + 'T00:00:00').getDay()];
  const md = (s) => Number(s.slice(5, 7)) + '/' + Number(s.slice(8, 10)) + '(' + dname(s) + ')';
  const loading = (v) => { v.innerHTML = '<div class="card"><div class="empty">불러오는 중…</div></div>'; };
  const failed = (v, e) => { v.innerHTML = '<div class="note err">' + esc(e.message) + '</div>'; };
  const STATUS = { 요청: 'warn', 승인: 'ok', 반려: 'err', 취소: '' };
  const isApprover = () => { const u = A.S.user || {}; return u.kind === 'teacher' && ['최종관리자', '일과담당'].includes(u.role); };

  /* =========================================================
     일과 운영
     ========================================================= */
  VIEWS.ops = async function (v) {
    const ui = A.ui;
    if (!ui.opsDate) ui.opsDate = todayStr();
    loading(v);
    const appr = isApprover();
    let day, pend, today, mine;
    try {
      [day, pend, today, mine] = await Promise.all([
        api('opsDay', { date: ui.opsDate }),
        appr ? api('opsList', { status: '요청' }) : Promise.resolve([]),
        api('opsList', { from: ui.opsDate, to: ui.opsDate, status: ['승인'] }),
        appr ? Promise.resolve([]) : api('opsList', { from: addDays(todayStr(), -30), to: '9999' }),
      ]);
    } catch (e) { failed(v, e); return; }
    const teachers = {};
    day.lessons.forEach((l) => { if (l.teacherId) teachers[l.teacherId] = l.teacher; });
    const tlist = Object.keys(teachers).sort((a, b) => (teachers[a] < teachers[b] ? -1 : 1));
    if (appr && ui.opsT && !teachers[ui.opsT]) ui.opsT = '';
    const shown = day.lessons.filter((l) => !appr || !ui.opsT || l.teacherId === ui.opsT || l.origTeacherId === ui.opsT).filter((l) => !ui.opsQ || (l.where + l.subject + l.teacher).includes(ui.opsQ));
    const lessonRow = (l, i) => '<tr' + (l.changed ? ' class="chgrow"' : '') + '><td class="num">' + l.period + '</td><td>' + esc(l.where) + '</td><td>' + esc(l.subject) + '</td><td>' + esc(l.teacher || '-') + '</td><td>' + esc(l.room || '') + '</td>'
      + '<td>' + (l.changed ? '<span class="pill warn">' + esc(l.changed) + '</span>' : '<button class="btn sm" data-ch="' + i + '">바꾸기</button>') + '</td></tr>';
    const idx = new Map(day.lessons.map((l, i) => [l, i]));
    v.innerHTML = '<div class="card tight"><div class="row"><h2>일과 운영</h2><button class="btn sm" id="odp" aria-label="전날">◀</button><input type="date" id="od" class="input sm" value="' + esc(ui.opsDate) + '"><button class="btn sm" id="odn" aria-label="다음 날">▶</button><button class="btn sm" id="od0">오늘</button>'
      + '<span class="muted">' + esc(md(ui.opsDate)) + '</span><span style="margin-left:auto"></span><button class="btn sm" id="opr">일일 변경표 인쇄</button></div>'
      + '<p class="hint">' + (appr ? '결근·출장 선생님을 고르면 그날 수업이 나옵니다. [바꾸기]로 보강·교체·자습을 정하면 바로 반영되고, 해당 학생·선생님께 알림이 갑니다.' : '내 수업을 [바꾸기]로 보강·교체·자습 요청을 올립니다. 일과담당 선생님이 승인하면 시간표에 반영되고 알림이 갑니다.') + '</p></div>'
      + '<div class="grid-ops"><div class="card tight"><div class="row"><h3>' + (appr ? '그날 수업' : '내 수업') + '</h3>'
      + (appr ? '<select id="ot" class="input sm"><option value="">모든 선생님</option>' + tlist.map((t) => '<option value="' + esc(t) + '"' + (t === ui.opsT ? ' selected' : '') + '>' + esc(teachers[t]) + '</option>').join('') + '</select><input id="oq" class="input sm" placeholder="반·과목 찾기" value="' + esc(ui.opsQ || '') + '">' : '')
      + '<span class="muted small">' + shown.length + '개</span></div>'
      + (day.lessons.length || !appr ? '<div class="tbl-wrap"><table class="tbl"><thead><tr><th>교시</th><th>학급·분반</th><th>과목</th><th>선생님</th><th>교실</th><th></th></tr></thead><tbody>'
        + (shown.length ? shown.map((l) => lessonRow(l, idx.get(l))).join('') : '<tr><td colspan="6" class="empty">' + (day.version ? '수업이 없습니다.' : '이 날짜에 적용되는 시간표가 없습니다.') + '</td></tr>') + '</tbody></table></div>'
        : '<div class="empty">이 날짜에 적용되는 시간표가 없습니다.</div>') + '</div>'
      + '<div class="side-ops">'
      + (appr ? '<div class="card tight"><h3>승인 대기 <span class="pill ' + (pend.length ? 'warn' : '') + '">' + pend.length + '</span></h3>' + (pend.length ? '<ul class="olist">' + pend.map((x) => '<li><div><b>' + esc(x.type) + '</b> ' + esc(x.label) + '</div><div class="muted small">' + esc(x.requesterName) + ' · ' + esc(x.requestedAt.slice(5, 16)) + (x.reason ? ' · ' + esc(x.reason) : '') + '</div>'
        + '<div class="row"><button class="btn sm pri" data-ok="' + esc(x.id) + '">승인</button><button class="btn sm" data-no="' + esc(x.id) + '">반려</button></div></li>').join('') + '</ul>' : '<div class="muted small">대기 중인 요청이 없습니다.</div>') + '</div>' : '')
      + '<div class="card tight"><h3>' + esc(md(ui.opsDate)) + ' 바뀐 수업 ' + today.length + '건</h3>' + (today.length ? '<ul class="olist">' + today.map((x) => '<li><div><b>' + esc(x.type) + '</b> ' + esc(x.label) + '</div>' + (x.reason ? '<div class="muted small">' + esc(x.reason) + '</div>' : '')
        + (appr ? '<div class="row"><button class="btn sm dan" data-cx="' + esc(x.id) + '">취소</button></div>' : '') + '</li>').join('') + '</ul>' : '<div class="muted small">없습니다.</div>') + '</div>'
      + (!appr ? '<div class="card tight"><h3>내 요청·관련 변경</h3>' + (mine.length ? '<ul class="olist">' + mine.slice(-20).reverse().map((x) => '<li><div><span class="pill ' + (STATUS[x.status] || '') + '">' + esc(x.status) + '</span> ' + esc(x.label) + '</div>'
        + (x.status === '요청' && x.requester === A.S.user.id ? '<div class="row"><button class="btn sm" data-cx="' + esc(x.id) + '">요청 취소</button></div>' : '') + '</li>').join('') + '</ul>' : '<div class="muted small">없습니다.</div>') + '</div>' : '')
      + '</div></div>';
    const go = (d) => { ui.opsDate = d; VIEWS.ops(v); };
    v.querySelector('#odp').onclick = () => go(addDays(ui.opsDate, -1));
    v.querySelector('#odn').onclick = () => go(addDays(ui.opsDate, 1));
    v.querySelector('#od0').onclick = () => go(todayStr());
    v.querySelector('#od').onchange = (e) => go(e.target.value || todayStr());
    const ot = v.querySelector('#ot'); if (ot) ot.onchange = () => { ui.opsT = ot.value; VIEWS.ops(v); };
    const oq = v.querySelector('#oq'); if (oq) oq.onchange = () => { ui.opsQ = oq.value.trim(); VIEWS.ops(v); };
    v.querySelector('#opr').onclick = (e) => run(e.target, async () => printSheet(await api('opsSheet', { date: ui.opsDate })));
    v.querySelectorAll('[data-ch]').forEach((b) => { b.onclick = () => changeDialog(day, day.lessons[Number(b.dataset.ch)], () => VIEWS.ops(v)); });
    v.querySelectorAll('[data-ok]').forEach((b) => { b.onclick = () => run(b, async () => { const r = await api('opsDecide', { id: b.dataset.ok, decision: '승인' }); toast('승인했습니다.' + (r.sent ? ' (알림 ' + r.sent + '대)' : '')); VIEWS.ops(v); }); });
    v.querySelectorAll('[data-no]').forEach((b) => { b.onclick = () => { const memo = prompt('반려 사유 (선택)', ''); if (memo === null) return; run(b, async () => { await api('opsDecide', { id: b.dataset.no, decision: '반려', memo }); toast('반려했습니다.'); VIEWS.ops(v); }); }; });
    v.querySelectorAll('[data-cx]').forEach((b) => { b.onclick = () => { if (!confirm('이 변경을 취소할까요? 시간표가 원래대로 돌아갑니다.')) return; run(b, async () => { await api('opsCancel', { id: b.dataset.cx }); toast('취소했습니다.'); VIEWS.ops(v); }); }; });
  };

  function changeDialog(day, l, done) {
    const appr = isApprover();
    const types = ['보강', '자습'].concat(l.target.kind === 'class' ? ['교체'] : []);
    let type = '보강';
    modal('<h2>' + esc(md(day.date) + ' ' + l.period + '교시 · ' + l.where + ' ' + l.subject) + '</h2><p class="muted">' + esc(l.teacher || '') + (l.room ? ' · ' + esc(l.room) : '') + '</p>'
      + '<div class="seg3" role="tablist">' + types.map((t) => '<button type="button" data-ty="' + t + '" class="' + (t === type ? 'on' : '') + '">' + t + '</button>').join('') + '</div><div id="cdb"></div>'
      + '<div class="field"><label for="crs">사유 (선택)</label><input id="crs" class="input" maxlength="100" placeholder="예: 출장, 병가, 학년 행사"></div>'
      + '<div class="row" style="justify-content:flex-end"><button class="btn" data-close>취소</button><button class="btn pri" id="cok">' + (appr ? '바로 반영' : '요청 올리기') + '</button></div>', (bg, close) => {
      const body = bg.querySelector('#cdb');
      let pickT = '', swap = null;
      const freeList = async (label, allowNone) => {
        body.innerHTML = '<div class="empty">빈 선생님 찾는 중…</div>';
        let list;
        try { list = await api('opsFree', { date: day.date, period: l.period, group: l.group || '' }); } catch (e) { body.innerHTML = '<div class="note err">' + esc(e.message) + '</div>'; return; }
        body.innerHTML = '<p class="hint">' + esc(label) + ' 같은 교과·이번 주 보강이 적은 순서입니다. (오늘 수업 수 · 이번 주 수업 수)</p><div class="cands">'
          + (allowNone ? '<label class="cand"><input type="radio" name="cs" value="" checked> <span>감독 없음</span></label>' : '')
          + list.map((t, i) => '<label class="cand' + (t.unavailable ? ' dim' : '') + '"><input type="radio" name="cs" value="' + esc(t.id) + '"' + (!allowNone && i === 0 ? ' checked' : '') + '> <span><b>' + esc(t.name) + '</b>' + (t.same ? ' ★' : '') + ' <span class="muted small">' + esc(t.subject || '') + ' · 오늘 ' + t.day + ' · 주 ' + t.week + (t.subs ? ' · 보강 ' + t.subs : '') + (t.unavailable ? ' · 불가 시간' : '') + '</span></span></label>').join('')
          + '</div>';
        const sel = () => { const r = body.querySelector('input[name=cs]:checked'); pickT = r ? r.value : ''; };
        body.querySelectorAll('input[name=cs]').forEach((r) => { r.onchange = sel; }); sel();
      };
      const swapUI = () => {
        body.innerHTML = '<p class="hint">같은 반의 다른 시간 수업과 맞바꿉니다. 두 선생님 모두 바뀐 시간에 다른 수업이 없어야 합니다.</p><div class="row"><label class="row small">바꿀 날짜 <input type="date" id="cd2" class="input sm" value="' + esc(day.date) + '"></label></div><div id="cdl"></div>';
        const load = async () => {
          const d2 = body.querySelector('#cd2').value; swap = null;
          const box = body.querySelector('#cdl'); box.innerHTML = '<div class="empty">불러오는 중…</div>';
          let w;
          try { w = await api('ttView', { date: d2, kind: 'class', id: l.target.grade + '-' + l.target.cls }); } catch (e) { box.innerHTML = '<div class="note err">' + esc(e.message) + '</div>'; return; }
          const dn = dname(d2);
          const ps = Array.from({ length: Number((w.periods || {})[dn]) || 0 }, (_, i) => i + 1).filter((p) => !(d2 === day.date && p === l.period));
          box.innerHTML = ps.length ? '<div class="cands">' + ps.map((p) => { const c = (w.cells[dn + '|' + p] || [])[0]; const can = c && c.kind !== '블록' && !c.changed; return '<label class="cand' + (can ? '' : ' dim') + '"><input type="radio" name="sw" value="' + p + '"' + (can ? '' : ' disabled') + '> <span><b>' + p + '교시</b> ' + esc(c ? c.title : '빈 시간') + ' <span class="muted small">' + esc(c ? c.teacher || '' : '') + '</span></span></label>'; }).join('') + '</div>' : '<div class="muted">그날 수업이 없습니다.</div>';
          box.querySelectorAll('input[name=sw]').forEach((r) => { r.onchange = () => { swap = { date: d2, period: Number(r.value) }; }; });
        };
        body.querySelector('#cd2').onchange = load; load();
      };
      const draw = () => {
        bg.querySelectorAll('[data-ty]').forEach((b) => b.classList.toggle('on', b.dataset.ty === type));
        if (type === '보강') freeList('그 시간 수업이 없는 선생님입니다.', false);
        else if (type === '자습') freeList('자습 감독이 필요하면 고르세요.', true);
        else swapUI();
      };
      bg.querySelectorAll('[data-ty]').forEach((b) => { b.onclick = () => { type = b.dataset.ty; draw(); }; });
      draw();
      const ok = bg.querySelector('#cok');
      ok.onclick = () => run(ok, async () => {
        const p = { type, date: day.date, period: l.period, target: l.target, reason: bg.querySelector('#crs').value.trim() };
        if (type === '보강') { if (!pickT) { toast('보강할 선생님을 골라 주세요.', true); return; } p.teacherId = pickT; }
        if (type === '자습') p.teacherId = pickT;
        if (type === '교체') { if (!swap) { toast('바꿀 시간을 골라 주세요.', true); return; } p.swap = swap; }
        const r = await api('opsRequest', p);
        close();
        toast(r.status === '승인' ? '반영했습니다. ' + (r.sent ? '(알림 ' + r.sent + '대)' : '') : '요청을 올렸습니다. 일과담당 선생님이 승인하면 반영됩니다.');
        done();
      });
    }, { wide: true });
  }

  function printSheet(d) {
    const rows = d.list.slice().sort((a, b) => a.period - b.period || (a.where < b.where ? -1 : 1));
    const byT = {};
    rows.forEach((x) => { if (x.type === '보강' && x.toTeacher) (byT[x.toTeacher] = byT[x.toTeacher] || []).push(x.period + '교시 ' + x.where); if (x.type === '교체') { (byT[x.origTeacher] = byT[x.origTeacher] || []).push('교체 ' + x.where); } });
    const html = '<section class="ttp"><div class="ttph"><b>일일 변경표 · ' + esc(d.date + ' (' + d.day + ')') + '</b><span>' + esc(d.school || CFG.SCHOOL_NAME || '') + ' · 출력 ' + esc(new Date().toLocaleString('ko-KR')) + '</span></div>'
      + (rows.length ? '<table class="ilr wide"><thead><tr><th>교시</th><th>학급·분반</th><th>과목</th><th>원래 선생님</th><th>변경</th><th>바뀐 선생님 / 내용</th><th>사유</th></tr></thead><tbody>'
        + rows.map((x) => '<tr><td>' + x.period + '</td><td>' + esc(x.where) + '</td><td>' + esc(x.subject) + '</td><td>' + esc(x.origTeacher) + '</td><td><b>' + esc(x.type) + '</b></td><td>'
          + (x.type === '보강' ? esc(x.toTeacher) : x.type === '자습' ? '자습' + (x.toTeacher ? ' (감독 ' + esc(x.toTeacher) + ')' : '') : esc(md(x.swap.date) + ' ' + x.swap.period + '교시 ' + x.swap.subject + ' (' + x.swap.teacher + ')와 교체')) + '</td><td>' + esc(x.reason || '') + '</td></tr>').join('')
        + '</tbody></table>' : '<p>바뀐 수업이 없습니다.</p>')
      + (Object.keys(byT).length ? '<h3 style="margin-top:6mm">선생님별</h3><table class="ilr wide"><tbody>' + Object.keys(byT).sort().map((t) => '<tr><th>' + esc(t) + '</th><td style="text-align:left">' + esc(byT[t].join(', ')) + '</td></tr>').join('') + '</tbody></table>' : '')
      + '</section>';
    document.getElementById('print-area').innerHTML = html;
    setTimeout(() => window.print(), 60);
  }

  /* =========================================================
     학년도 전환 마법사
     ========================================================= */
  VIEWS.year = async function (v) {
    const ui = A.ui;
    const cur = Number(ui.year) || new Date().getFullYear();
    if (!ui.yrTo) ui.yrTo = String(cur + 1);
    loading(v);
    let p;
    try { p = await api('yearPreview', { year: ui.yrTo, rows: ui.yrRows || [] }); } catch (e) { failed(v, e); return; }
    ui.yrClasses = ui.yrClasses && ui.yrClasses.forYear === ui.yrTo ? ui.yrClasses : { forYear: ui.yrTo, list: p.classes.map((c) => ({ grade: c.grade, classes: c.classes, rooms: (c.rooms || []).join(',') })) };
    const cls = ui.yrClasses.list;
    v.innerHTML = '<div class="card tight"><div class="row"><h2>학년도 전환</h2><span class="muted">지금 ' + p.from + '학년도 → </span><input id="yto" class="input sm w4" value="' + esc(ui.yrTo) + '"><span class="muted">학년도</span></div>'
      + '<p class="hint">새 학년도가 시작될 때 한 번 합니다. 입학년도로 학년을 다시 계산해 진급·졸업 처리하고, 학년도 설정과 학급 설정을 바꿉니다. 실행 직전에 자동으로 백업합니다.</p></div>'
      + '<div class="grid2"><div class="card tight"><h3>1. 바뀌는 내용</h3><table class="mini"><tbody>'
      + '<tr><td>졸업 처리</td><td class="num"><b>' + p.graduate + '</b>명</td></tr>'
      + [1, 2, 3].map((g) => '<tr><td>' + p.to + '학년도 ' + g + '학년</td><td class="num">' + (p.grades[g] || 0) + '명</td></tr>').join('')
      + '<tr><td>이름이 아직 없는 신입생 자리</td><td class="num">' + p.placeholders + '</td></tr>'
      + '<tr><td>그대로 (졸업·전출 기록)</td><td class="num">' + p.untouched + '</td></tr></tbody></table>'
      + (p.errors.length ? '<div class="note err">' + esc(p.errors.slice(0, 5).join(' / ')) + '</div>' : '')
      + (p.placeholders ? '<div class="note warn">신입생 이름 명렬을 아직 올리지 않았습니다. 전환한 뒤에 [학생 → 신입생]에서 올려도 됩니다.</div>' : '')
      + '<h3>준비 상태</h3><ul class="small"><li>' + p.to + '학년도 시간표: ' + (p.timetables.length ? p.timetables.map((t) => esc(t.term + '학기 ' + t.status)).join(', ') : '<span class="no">없음</span>') + '</li><li>' + p.to + '학년도 블록 편성: ' + p.blockPlans + '개</li></ul></div>'
      + '<div class="card tight"><h3>2. 새 반 배정 (선택)</h3><p class="hint">반 편성 결과가 있으면 올리세요. 열: <b>학번</b>(지금 학번)·성명·<b>새반</b>·<b>새번호</b>·새학번(비우면 자동). 올리지 않으면 반·번호는 그대로 두고 학번 앞자리(학년)만 바꿉니다.</p>'
      + '<div class="row"><button class="btn sm" id="ytpl">양식</button><input type="file" id="yfile" accept=".xlsx,.xls,.csv" class="input sm"></div>'
      + (p.classUpload ? '<div class="note ' + (p.matched === p.classUpload ? 'ok' : 'warn') + '">올린 ' + p.classUpload + '명 중 ' + p.matched + '명 일치' + (p.matched < p.classUpload ? ' — 학번을 확인해 주세요.' : '') + '</div>' : '')
      + '<h3>3. ' + p.to + '학년도 학급</h3><table class="mini edit"><thead><tr><th>학년</th><th>학급 수</th><th>교실 (쉼표)</th></tr></thead><tbody>'
      + cls.map((c, i) => '<tr><td>' + c.grade + '학년</td><td><input class="input sm w4" data-yc="' + i + '" value="' + esc(c.classes) + '"></td><td><input class="input sm wide" data-yr="' + i + '" value="' + esc(c.rooms) + '"></td></tr>').join('') + '</tbody></table>'
      + '<label class="ck"><input type="checkbox" id="yhr" checked> 교사 담임 지정 지우기 (새 담임은 [교사 계정]에서 지정)</label>'
      + (p.timetables.some((t) => String(t.term) === '1') ? '<label class="ck"><input type="checkbox" id="ytt" checked> ' + p.to + '학년도 1학기 시간표(수강신청·블록 편성으로 만든 시간표)를 <b>올해 시간표</b>로 게시 — 적용 시작일이 없으면 오늘부터</label>'
        : '<div class="note warn small">' + p.to + '학년도 시간표가 아직 없습니다. 전환 뒤 [시간표 → 시간표 편성]에서 만들어 게시하면 올해 시간표가 됩니다.</div>')
      + '<div class="row" style="justify-content:flex-end"><button class="btn pri" id="ygo"' + (p.errors.length ? ' disabled' : '') + '>' + p.to + '학년도로 전환</button></div></div></div>';
    v.querySelector('#yto').onchange = (e) => { ui.yrTo = e.target.value; ui.yrRows = []; VIEWS.year(v); };
    v.querySelectorAll('[data-yc]').forEach((el) => { el.onchange = () => { cls[Number(el.dataset.yc)].classes = Number(el.value) || 0; }; });
    v.querySelectorAll('[data-yr]').forEach((el) => { el.onchange = () => { cls[Number(el.dataset.yr)].rooms = el.value; }; });
    v.querySelector('#ytpl').onclick = () => A.SEL.writeBook([{ name: '반배정', aoa: [['학번', '성명', '새반', '새번호', '새학번'], ['10101', '홍길동', '3', '7', '']], cols: [8, 10, 6, 6, 8] }], '새학년도_반배정_양식.xlsx');
    v.querySelector('#yfile').onchange = async (e) => {
      const f = e.target.files[0]; if (!f) return;
      try {
        const { aoa } = await A.SEL.readAoa(f);
        const hi = aoa.findIndex((r) => r.some((c) => String(c).replace(/\s/g, '') === '학번'));
        if (hi < 0) throw new Error('학번 열을 찾지 못했습니다.');
        const H = aoa[hi].map((h) => String(h).replace(/\s/g, ''));
        const col = (names) => H.findIndex((h) => names.includes(h));
        const cNo = col(['학번', '현학번', '구학번']), cNm = col(['성명', '이름']), cC = col(['새반', '반']), cN = col(['새번호', '번호']), cS = col(['새학번']);
        ui.yrRows = aoa.slice(hi + 1).filter((r) => String(r[cNo] || '').trim()).map((r) => ({ 학번: String(r[cNo]).trim(), 성명: cNm >= 0 ? String(r[cNm]).trim() : '', 새반: cC >= 0 ? String(r[cC]).trim() : '', 새번호: cN >= 0 ? String(r[cN]).trim() : '', 새학번: cS >= 0 ? String(r[cS]).trim() : '' }));
        VIEWS.year(v);
      } catch (err) { toast(err.message, true); }
    };
    v.querySelector('#ygo').onclick = (e) => {
      if (!confirm(p.from + '학년도 → ' + p.to + '학년도로 전환합니다.\n졸업 ' + p.graduate + '명, 진급·신입 ' + (p.promote + p.freshmen) + '명.\n실행 전에 자동으로 백업합니다. 계속할까요?')) return;
      run(e.target, async () => {
        const r = await api('yearApply', { year: ui.yrTo, rows: ui.yrRows || [], classes: cls.map((c) => ({ grade: c.grade, classes: c.classes, rooms: String(c.rooms).split(/[,\s]+/).filter(Boolean) })), clearHomeroom: v.querySelector('#yhr').checked, publishTimetable: !!(v.querySelector('#ytt') && v.querySelector('#ytt').checked) });
        ui.year = String(r.to); ui.yrRows = []; ui.yrClasses = null; ui.yrTo = String(r.to + 1);
        modal('<h2>' + r.to + '학년도로 전환했습니다</h2><ul><li>졸업 ' + r.graduate + '명</li><li>진급 ' + r.promote + '명 · 신입 ' + r.freshmen + '명</li><li>새 반 배정 ' + r.matched + '명</li>' + (r.timetable ? '<li>올해 시간표: ' + esc(r.timetable) + '</li>' : '') + '</ul>'
          + '<h3>이어서 할 일</h3><ol class="small"><li>[학생 → 명렬]에서 학년별 명렬을 확인합니다. 새 반 배정을 안 올렸다면 지금 학년 단위 교체로 올립니다.</li><li>[관리 → 교사 계정]에서 새 담임을 지정합니다.</li><li>[학생 → 신입생]에서 신입생 이름 명렬을 올리고 개별 코드 쪽지를 출력합니다.</li><li>[시간표 → 시간표 편성]에서 새 학년도 시간표가 게시되어 있는지 확인합니다.</li></ol>'
          + '<div class="row" style="justify-content:flex-end"><button class="btn pri" data-close>확인</button></div>');
        A.renderHome();
      });
    };
  };

  /* =========================================================
     데이터 화면에 개인정보 보관 기준 붙이기
     ========================================================= */
  const baseData = VIEWS.data;
  VIEWS.data = async function (v) {
    await baseData(v);
    if (!A.isAdmin()) return;
    const box = document.createElement('div');
    box.className = 'card';
    box.style.marginTop = '12px';
    box.innerHTML = '<div class="empty">보관 기준 불러오는 중…</div>';
    v.appendChild(box);
    const draw = async () => {
      let r;
      try { r = await api('retentionGet', {}); } catch (e) { box.innerHTML = '<div class="note err">' + esc(e.message) + '</div>'; return; }
      const L = { 졸업: '졸업생 정보', 전출: '전출·자퇴생 정보', 이력: '변경 이력', 알림: '알림 기록', 변경: '보강·교체 기록' };
      const due = { 졸업: r.students, 전출: '', 이력: r.logs, 알림: r.notices, 변경: r.changes };
      box.innerHTML = '<div class="row"><h2>개인정보 보관 기준</h2><span style="margin-left:auto"></span><button class="btn sm" id="rtsave">저장</button><button class="btn sm dan" id="rtrun">지금 정리</button></div>'
        + '<table class="mini edit"><thead><tr><th>자료</th><th>보관 기간</th><th>지금 지울 대상</th></tr></thead><tbody>'
        + Object.keys(L).map((k) => '<tr><td>' + L[k] + '</td><td><input class="input sm w4" data-rt="' + k + '" value="' + r.rules[k] + '"> 일</td><td class="num">' + (k === '졸업' ? r.students + '명 (졸업·전출·자퇴 합계)' : k === '전출' ? '' : (due[k] || 0) + '건') + '</td></tr>').join('')
        + '</tbody></table><p class="hint">졸업·전출·자퇴 처리한 날부터 기간이 지나면 그 학생의 계정·신청·이수 이력·분반 배정을 지웁니다. 매일 새벽 2시 백업 뒤에 자동으로 정리하며, [지금 정리]는 바로 실행합니다(실행 전 백업). 학교 개인정보 처리 방침에 맞게 기간을 정하세요.</p>';
      box.querySelector('#rtsave').onclick = (e) => run(e.target, async () => {
        const p = {}; box.querySelectorAll('[data-rt]').forEach((el) => { p[el.dataset.rt] = Number(el.value); });
        await api('retentionSave', p); toast('보관 기준을 저장했습니다.'); draw();
      });
      box.querySelector('#rtrun').onclick = (e) => {
        if (!confirm('보관 기간이 지난 자료를 지금 지울까요? (학생 ' + r.students + '명, 기록 ' + (r.logs + r.notices + r.changes) + '건)')) return;
        run(e.target, async () => { const x = await api('retentionRun', {}); toast('정리했습니다. 학생 ' + x.students + '명, 기록 ' + (x.logs + x.notices + x.changes) + '건'); draw(); });
      };
    };
    draw();
  };
})();
