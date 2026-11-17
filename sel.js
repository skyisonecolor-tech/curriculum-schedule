/* 일과 알리미 — 2단계: 수강신청 (학생 신청 · 교사 현황 · 관리자 교육과정/회차/업로드) */
(function () {
  'use strict';
  const A = window.APP, R = window.RULES;
  if (!A || !R) return;
  const { api, esc, toast, run, modal, saveBlob } = A;
  const VIEWS = A.VIEWS;
  const AREA_COLOR = { 국어: '#C2410C', 수학: '#1D4ED8', 영어: '#7C3AED', 사회: '#B45309', 과학: '#047857', 체육: '#0E7490', 예술: '#BE185D', '제2외·한문·정보·교양': '#475569' };
  const AREA_SHORT = { '제2외·한문·정보·교양': '제2외·정보·교양' };
  const STATUS = { 제출: 'ok', 임시: 'warn', 확인필요: 'err', 미신청: '' };
  const STATUS_LABEL = { 제출: '제출 완료', 임시: '임시 저장', 확인필요: '확인 필요', 참고: '참고조사', 미신청: '미신청', '': '미신청' };
  const clone = (o) => JSON.parse(JSON.stringify(o));
  const pill = (st) => '<span class="pill ' + (STATUS[st || '미신청'] || '') + '">' + esc(STATUS_LABEL[st || ''] || st) + '</span>';
  const areaDot = (a) => '<i class="adot" style="background:' + (AREA_COLOR[a] || '#94A3B8') + '"></i>';
  function curGrade(year) { const y = Number(A.ui.year) || new Date().getFullYear(); return y - Number(year) + 1; }
  function cohortLabel(year) { const g = curGrade(year); return year + '학년도 입학생' + (g >= 1 && g <= 3 ? ' (현 ' + g + '학년)' : g < 1 ? ' (입학 예정)' : ''); }
  function semShort(s) { const p = String(s).split('-'); return p[0] + '학년 ' + p[1] + '학기'; }

  function readAoa(file) {
    return new Promise((resolve, reject) => {
      if (!window.XLSX) { reject(new Error('엑셀 도구를 불러오지 못했습니다.')); return; }
      const fr = new FileReader();
      fr.onload = () => {
        try {
          const wb = window.XLSX.read(new Uint8Array(fr.result), { type: 'array' });
          resolve({ wb, aoa: window.XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { header: 1, defval: '', raw: false }) });
        } catch (e) { reject(new Error('엑셀 파일을 읽지 못했습니다: ' + e.message)); }
      };
      fr.onerror = () => reject(new Error('파일을 읽지 못했습니다.'));
      fr.readAsArrayBuffer(file);
    });
  }
  function writeBook(sheets, file) {
    const wb = window.XLSX.utils.book_new();
    sheets.forEach((sh) => {
      const ws = window.XLSX.utils.aoa_to_sheet(sh.aoa);
      ws['!cols'] = (sh.cols || sh.aoa[0].map(() => 12)).map((w) => ({ wch: w }));
      if (sh.freeze) ws['!freeze'] = sh.freeze;
      window.XLSX.utils.book_append_sheet(wb, ws, sh.name);
    });
    saveBlob(new Blob([window.XLSX.write(wb, { type: 'array', bookType: 'xlsx' })], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }), file);
  }
  const loading = (v) => { v.innerHTML = '<div class="card"><div class="empty">불러오는 중…</div></div>'; };
  const failed = (v, e) => { v.innerHTML = '<div class="note err">' + esc(e.message) + '</div>'; };

  /* =========================================================
     선택 계획 편집기 (학생 신청 화면 = 교사 수정 화면)
     ========================================================= */
  function planEditor(box, d, opts) {
    opts = opts || {};
    const ix = R.index(d.cur);
    const sems = d.round.sems;
    const refSems = d.round.refSems || [];
    let picks = {}; sems.forEach((s) => { picks[s] = (d.picks[s] || []).slice(); });
    let sem = opts.sem && sems.includes(opts.sem) ? opts.sem : sems[0];
    let dirty = !!d.prefill;
    let strictRes = null;
    const editable = !!d.canEdit;
    const plan = () => ({ picks, roundSems: sems, fixed: d.fixed || {}, fixedSource: d.fixedSource || {} });

    function semBadge(res, s) {
      const gs = res.groupStatus[s] || {};
      let have = 0, need = 0;
      Object.keys(gs).forEach((g) => { have += Math.min(gs[g].have, gs[g].need); need += gs[g].need; });
      const bad = res.messages.some((m) => m.level === 'error' && m.sem === s);
      return need && have >= need && !bad ? '<span class="sb ok">✓</span>' : '<span class="sb' + (bad ? ' err' : '') + '">' + have + '/' + need + '</span>';
    }

    function draw() {
      const res = R.validate(ix, plan(), {});
      const shown = strictRes || res;
      const takenElsewhere = {};
      res.taken.forEach((t) => { if (t.sem !== sem) (takenElsewhere[t.key] = takenElsewhere[t.key] || []).push(t.sem); });
      const B = ix.by[sem];
      const head = '<div class="plan-head">'
        + '<div class="row"><h2>' + esc(d.round.name) + '</h2>' + pill(d.status) + (d.round.open ? '<span class="pill pri">신청 기간</span>' : '<span class="pill">' + esc(d.round.state) + '</span>') + '</div>'
        + '<div class="muted">' + [opts.teacher ? esc(d.student.grade + '학년 ' + d.student.classNo + '반 ' + d.student.number + '번 ' + d.student.name) : '',
          d.round.end && d.round.manual === '자동' ? '마감 ' + esc(d.round.end) : '',
          d.updatedAt ? '마지막 저장 ' + esc(d.updatedAt) + (d.updatedBy && d.updatedBy !== '학생' ? ' (' + esc(d.updatedBy) + ')' : '') : ''].filter(Boolean).join(' · ') + '</div>'
        + (d.round.notice ? '<div class="note">' + esc(d.round.notice) + '</div>' : '')
        + (d.prefill ? '<div class="note warn">「' + esc(d.prefill) + '」에서 고른 과목을 미리 채웠습니다. 확인하고 저장·제출해야 반영됩니다.</div>' : '')
        + (d.status === '확인필요' ? '<div class="note err">선생님이 올린 선택에 확인할 내용이 있습니다. 아래 안내를 보고 고친 뒤 제출해 주세요.</div>' : '')
        + '</div>';
      const tabs = '<div class="semtabs" role="tablist">' + sems.map((s) => '<button type="button" role="tab" data-sem="' + s + '" class="' + (s === sem ? 'on' : '') + '" aria-selected="' + (s === sem) + '">'
        + semShort(s) + (refSems.includes(s) ? ' <small>참고</small>' : '') + semBadge(res, s) + '</button>').join('') + '</div>';
      const dsum = B.designated.reduce((a, o) => a + o.credit, 0);
      const desig = '<div class="desig"><span class="lbl">정해진 과목 ' + dsum + '학점</span>' + B.designated.map((o) => '<span class="chip fixed" title="' + esc(o.area) + '">' + areaDot(o.area) + esc(o.name) + ' <b>' + o.credit + '</b></span>').join('') + '</div>';
      const groups = Object.keys(ix.groups[sem]).sort().map((g) => {
        const G = ix.groups[sem][g];
        const list = B.electives.filter((o) => o.group === g);
        const st = (res.groupStatus[sem] || {})[g] || { have: 0, need: G.pick };
        const full = st.have >= st.need;
        const credit = list.length ? list[0].credit : 0;
        return '<section class="grp' + (st.have > st.need ? ' over' : full ? ' full' : '') + '"><div class="grp-h"><b>' + esc(G.name || ('선택 ' + g)) + '</b>'
          + '<span class="muted">' + G.pick + '과목 선택 · 과목당 ' + credit + '학점</span><span class="cnt">' + st.have + ' / ' + st.need + '</span></div><div class="chips">'
          + list.map((o) => {
            const on = picks[sem].some((x) => R.norm(x) === o.key);
            const other = takenElsewhere[o.key];
            const dis = !editable || (!on && (full || !!other));
            return '<button type="button" class="chip' + (on ? ' on' : '') + (other && !on ? ' taken' : '') + '" data-pick="' + esc(o.name) + '" aria-pressed="' + on + '"' + (dis ? ' disabled' : '')
              + ' title="' + esc(o.area + (other ? ' · ' + other.map(semShort).join(', ') + '에 이미 있음' : '')) + '">' + areaDot(o.area) + '<span>' + esc(o.name) + '</span>'
              + (other && !on ? '<em>' + esc(other.map((x) => x.replace('-', '·')).join(',')) + '</em>' : '') + '</button>';
          }).join('') + '</div></section>';
      }).join('');
      // 오른쪽: 학점·기준·안내
      const semRows = R.SEMS.map((s) => {
        const t = res.semTotals[s];
        const inR = sems.includes(s);
        const src = !inR && d.fixedSource && d.fixedSource[s] ? d.fixedSource[s] : '';
        const val = !t.known ? '<span class="muted">기록 없음</span>' : (t.credits + (t.target ? ' / ' + t.target : ''));
        const okk = t.known && (!t.target || t.credits === t.target);
        return '<tr class="' + (s === sem ? 'cur' : '') + '"><td>' + semShort(s) + (inR ? ' <span class="pill pri sm">신청</span>' : '') + '</td><td class="num">' + val + '</td><td>' + (t.known ? (okk ? '<span class="okk">✓</span>' : '<span class="no">!</span>') : '') + '</td>'
          + '<td class="muted small">' + esc(src) + '</td></tr>';
      }).join('');
      const ruleRows = res.ruleStatus.map((r) => {
        const icon = r.ok ? '<span class="okk">✓</span>' : (r.kind === '최소' && !r.final ? '<span class="wait">…</span>' : '<span class="no">✕</span>');
        return '<tr><td>' + esc(r.name) + '</td><td class="num">' + r.current + ' ' + (r.kind === '최대' ? '≤' : '≥') + ' ' + r.value + '</td><td>' + icon + '</td></tr>';
      }).join('');
      const order = { error: 0, warn: 1, tip: 2 };
      const msgs = shown.messages.slice().sort((a, b) => order[a.level] - order[b.level]);
      const tips = msgs.filter((m) => m.level === 'tip').slice(0, 6);
      const list = msgs.filter((m) => m.level !== 'tip').concat(tips);
      const msgHtml = list.length ? '<ul class="msgs">' + list.map((m) => '<li class="' + m.level + '">' + (m.level === 'error' ? '✕ ' : m.level === 'warn' ? '! ' : '→ ') + esc(m.text) + '</li>').join('') + '</ul>'
        : '<div class="note ok">기준을 모두 지키고 있습니다.</div>';
      const side = '<aside class="plan-side"><div class="card tight"><h3>안내 <span class="muted">' + (shown.errors ? '오류 ' + shown.errors : '') + '</span></h3>' + msgHtml + '</div>'
        + '<div class="card tight"><h3>학기별 학점</h3><table class="mini">' + semRows + '</table>'
        + '<h3>이수 기준</h3><table class="mini">' + ruleRows + '</table></div></aside>';
      const bar = editable ? '<div class="plan-bar"><span class="hint">' + (dirty ? '<b class="warn-t">저장하지 않은 변경이 있습니다.</b> ' : '') + (opts.teacher ? '이수 기준을 지켜야 제출됩니다.' : '제출한 뒤에도 마감 전까지 고칠 수 있습니다.') + '</span>'
        + '<button class="btn" data-save>임시 저장</button><button class="btn pri" data-submit>제출</button></div>'
        : '<div class="plan-bar"><span class="hint">' + (opts.teacher ? '보기만 할 수 있습니다. (수정은 최종관리자·수정 권한)' : '신청 기간이 아니어서 볼 수만 있습니다.') + '</span></div>';
      box.innerHTML = '<div class="plan">' + head + tabs + '<div class="plan-grid"><section class="plan-main">' + desig + groups + '</section>' + side + '</div>' + bar + '</div>';

      box.querySelectorAll('[data-sem]').forEach((b) => { b.onclick = () => { sem = b.dataset.sem; draw(); }; });
      box.querySelectorAll('[data-pick]').forEach((b) => {
        b.onclick = () => {
          const name = b.dataset.pick, k = R.norm(name);
          const i = picks[sem].findIndex((x) => R.norm(x) === k);
          if (i >= 0) picks[sem].splice(i, 1); else picks[sem].push(name);
          dirty = true; strictRes = null; draw();
          const nb = box.querySelector('[data-pick="' + CSS.escape(name) + '"]'); if (nb) nb.focus();
        };
      });
      const sv = box.querySelector('[data-save]'), sb = box.querySelector('[data-submit]');
      if (sv) sv.onclick = () => save(false, sv);
      if (sb) sb.onclick = () => {
        strictRes = R.validate(ix, plan(), { strict: true });
        if (!strictRes.ok) {
          draw();
          const first = strictRes.messages.find((m) => m.level === 'error');
          if (first && first.sem && first.sem !== sem && sems.includes(first.sem)) { sem = first.sem; draw(); }
          toast('아직 제출할 수 없습니다. 오른쪽 안내의 ✕ 항목을 고쳐 주세요.', true);
          const ms = box.querySelector('.msgs'); if (ms) ms.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
          return;
        }
        save(true, box.querySelector('[data-submit]'));
      };
    }
    function save(submit, btn) {
      run(btn, async () => {
        const payload = { roundId: d.round.id, picks, submit };
        if (opts.teacher) payload.studentId = d.student.id;
        const r = await api('selSave', payload);
        d.status = r.status; d.updatedAt = r.updatedAt; d.prefill = ''; dirty = false;
        if (opts.teacher) d.updatedBy = A.S.user.name;
        toast(submit ? '제출했습니다.' : '임시 저장했습니다.');
        draw();
        if (opts.onSaved) opts.onSaved(r);
      });
    }
    draw();
    return { isDirty: () => dirty };
  }

  /* =========================================================
     학생: 수강신청
     ========================================================= */
  VIEWS.sel = async function (v) {
    loading(v);
    await A.loadRounds();
    const rounds = A.S.rounds || [];
    if (!rounds.length) { v.innerHTML = '<div class="card"><h2>수강신청</h2><div class="empty">지금은 신청 기간이 아닙니다.</div></div>'; return; }
    const ui = A.ui;
    if (!ui.selRound || !rounds.some((r) => r.id === ui.selRound)) ui.selRound = (rounds.find((r) => r.open) || rounds[0]).id;
    const pick = rounds.length > 1 ? '<div class="row">' + rounds.map((r) => '<button class="btn sm' + (r.id === ui.selRound ? ' pri' : '') + '" data-r="' + esc(r.id) + '">' + esc(r.name) + '</button>').join('') + '</div>' : '';
    v.innerHTML = pick + '<div id="pe"></div>';
    v.querySelectorAll('[data-r]').forEach((b) => { b.onclick = () => { ui.selRound = b.dataset.r; VIEWS.sel(v); }; });
    const pe = document.getElementById('pe');
    try { const d = await api('selGet', { roundId: ui.selRound }); planEditor(pe, d, { onSaved: () => A.loadRounds() }); } catch (e) { failed(pe, e); }
  };

  /* =========================================================
     교사: 신청 현황
     ========================================================= */
  VIEWS.selstatus = async function (v) {
    loading(v);
    const ui = A.ui;
    let rounds;
    try { rounds = await api('selRounds', {}); } catch (e) { failed(v, e); return; }
    if (!rounds.length) { v.innerHTML = '<div class="card"><h2>신청 현황</h2><div class="empty">아직 만든 신청 회차가 없습니다.' + (A.isAdmin() ? '<br>[신청 회차]에서 먼저 만들어 주세요.' : '') + '</div></div>'; return; }
    if (!ui.stRound || !rounds.some((r) => r.id === ui.stRound)) ui.stRound = (rounds.find((r) => r.open) || rounds[0]).id;
    const u = A.S.user;
    const viewAll = A.canViewAll();
    if (!viewAll && u.homeroom) ui.stClass = String(u.homeroom.classNo);
    v.innerHTML = '<div class="card tight"><div class="row"><select id="sr" class="input sm" aria-label="신청 회차">' + rounds.map((r) => '<option value="' + esc(r.id) + '"' + (r.id === ui.stRound ? ' selected' : '') + '>' + esc(r.name) + ' · ' + esc(r.kind === '참고조사' ? '참고조사' : r.state) + '</option>').join('') + '</select>'
      + '<span style="margin-left:auto"></span>' + (viewAll ? '<button class="btn sm" id="sx">엑셀 내려받기</button>' : '') + '<button class="btn sm" id="sw" hidden>1:1 교환</button></div><div id="sum"></div></div><div id="slist"></div>';
    document.getElementById('sr').onchange = (e) => { ui.stRound = e.target.value; if (viewAll) ui.stClass = ''; VIEWS.selstatus(v); };
    const sx = document.getElementById('sx');
    if (sx) sx.onclick = () => run(sx, async () => exportRound(await api('selExport', { roundId: ui.stRound })));
    loadStatus();

    async function loadStatus() {
      const sum = document.getElementById('sum'), list = document.getElementById('slist');
      let d;
      try { d = await api('selStatus', { roundId: ui.stRound, classNo: ui.stClass || '' }); } catch (e) { failed(sum, e); return; }
      const sw = document.getElementById('sw');
      if (d.canEdit) { sw.hidden = false; sw.onclick = () => swapDialog(d.round, loadStatus); }
      const tot = d.classes.reduce((a, c) => { ['total', '제출', '임시', '확인필요', '미신청'].forEach((k) => { a[k] = (a[k] || 0) + (c[k] || 0); }); return a; }, {});
      sum.innerHTML = '<div class="row"><span class="muted">' + esc(cohortLabel(d.round.year)) + ' · ' + esc(d.round.sems.map(semShort).join(', ')) + '</span>'
        + '<span class="pill ok">제출 ' + (tot['제출'] || 0) + '</span><span class="pill warn">임시 ' + (tot['임시'] || 0) + '</span><span class="pill err">확인 필요 ' + (tot['확인필요'] || 0) + '</span><span class="pill">미신청 ' + (tot['미신청'] || 0) + '</span><span class="muted">/ ' + (tot.total || 0) + '명</span></div>'
        + '<div class="classbar">' + d.classes.map((c) => {
          const pct = c.total ? Math.round(100 * (c['제출'] || 0) / c.total) : 0;
          return '<button type="button" class="cls' + (String(c.classNo) === String(ui.stClass) ? ' on' : '') + '" data-cls="' + esc(c.classNo) + '"><b>' + esc(c.classNo) + '반</b><span class="bar"><i style="width:' + pct + '%"></i></span><small>' + (c['제출'] || 0) + '/' + c.total + (c['확인필요'] ? ' · <em>확인 ' + c['확인필요'] + '</em>' : '') + '</small></button>';
        }).join('') + '</div>';
      sum.querySelectorAll('[data-cls]').forEach((b) => { b.onclick = () => { if (!viewAll) return; ui.stClass = b.dataset.cls; loadStatus(); }; });
      if (!ui.stClass) { list.innerHTML = '<div class="card"><div class="empty">반을 고르면 학생별 신청 내용을 볼 수 있습니다.</div></div>'; return; }
      list.innerHTML = '<div class="card"><div class="row"><h2>' + esc(d.students[0] ? d.students[0].grade : '') + '학년 ' + esc(ui.stClass) + '반</h2><span class="muted">' + d.students.length + '명</span></div>'
        + '<div class="tbl-wrap"><table class="tbl"><thead><tr><th>번호</th><th>이름</th><th>상태</th><th>안내</th><th>' + d.round.sems.map(semShort).join(' / ') + '</th><th>마지막 저장</th><th></th></tr></thead><tbody>'
        + d.students.map((s) => '<tr><td>' + esc(s.number) + '</td><td>' + esc(s.name) + '</td><td>' + pill(s.selStatus) + '</td><td>' + (s.errors ? '<span class="pill err">오류 ' + s.errors + '</span>' : '') + '</td>'
          + '<td class="small picks">' + d.round.sems.map((x) => (s.picks[x] || []).length).join(' / ') + '</td><td class="muted small">' + esc(s.updatedAt || '') + (s.source && s.source !== '학생' ? ' · ' + esc(s.source) : '') + '</td>'
          + '<td><button class="btn sm" data-open="' + esc(s.id) + '">' + (d.canEdit ? '보기·수정' : '보기') + '</button></td></tr>').join('')
        + '</tbody></table></div><p class="hint">숫자는 학기별로 고른 과목 수입니다.</p></div>';
      list.querySelectorAll('[data-open]').forEach((b) => {
        b.onclick = () => run(b, async () => {
          const pd = await api('selGet', { roundId: ui.stRound, studentId: b.dataset.open });
          let ed;
          modal('<div class="row"><span style="margin-left:auto"></span><button class="btn sm" data-close>닫기</button></div><div id="pm"></div>', (bg) => {
            ed = planEditor(bg.querySelector('#pm'), pd, { teacher: true, onSaved: loadStatus });
          }, { wide: true });
        });
      });
    }
  };

  function swapDialog(round, after) {
    const ui = A.ui;
    run(null, async () => {
      const d = await api('selStatus', { roundId: round.id });
      const studs = d.students.filter((s) => s.selStatus !== '미신청');
      const opt = studs.map((s) => '<option value="' + esc(s.studentNo + ' ' + s.name) + '">').join('');
      modal('<h2>과목 1:1 교환</h2><p class="hint">같은 학기에 두 학생이 고른 과목을 서로 바꿉니다. 바꾼 뒤에도 두 학생 모두 이수 기준을 지켜야 합니다.</p>'
        + '<div class="field"><label for="ws">학기</label><select id="ws" class="input">' + round.sems.map((s) => '<option value="' + s + '">' + semShort(s) + '</option>').join('') + '</select></div>'
        + '<datalist id="wl">' + opt + '</datalist>'
        + ['a', 'b'].map((k) => '<div class="grid2 tight2"><div class="field"><label for="w' + k + '">학생 ' + (k === 'a' ? 'A' : 'B') + ' (학번 또는 이름)</label><input id="w' + k + '" class="input" list="wl" autocomplete="off"></div>'
          + '<div class="field"><label for="w' + k + 's">내놓을 과목</label><select id="w' + k + 's" class="input"></select></div></div>').join('')
        + '<div class="row" style="justify-content:flex-end"><button class="btn" data-close>취소</button><button class="btn pri" id="wok">교환</button></div>', (bg, close) => {
        const find = (val) => { const v = String(val || '').trim(); return studs.find((s) => (s.studentNo + ' ' + s.name) === v) || studs.find((s) => s.studentNo === v) || (studs.filter((s) => s.name === v).length === 1 ? studs.find((s) => s.name === v) : null); };
        const fill = (k) => {
          const s = find(bg.querySelector('#w' + k).value), sem = bg.querySelector('#ws').value;
          bg.querySelector('#w' + k + 's').innerHTML = s ? (s.picks[sem] || []).map((x) => '<option>' + esc(x) + '</option>').join('') : '<option value="">학생을 먼저 고르세요</option>';
        };
        ['a', 'b'].forEach((k) => { bg.querySelector('#w' + k).oninput = () => fill(k); fill(k); });
        bg.querySelector('#ws').onchange = () => { fill('a'); fill('b'); };
        const ok = bg.querySelector('#wok');
        ok.onclick = () => run(ok, async () => {
          const sa = find(bg.querySelector('#wa').value), sb = find(bg.querySelector('#wb').value);
          if (!sa || !sb) { toast('두 학생을 목록에서 골라 주세요.', true); return; }
          const r = await api('selSwap', { roundId: round.id, sem: bg.querySelector('#ws').value, a: { studentId: sa.id, subject: bg.querySelector('#was').value }, b: { studentId: sb.id, subject: bg.querySelector('#wbs').value } });
          close(); toast(r.a + ' ↔ ' + r.b + ' 교환했습니다.'); after();
        });
      }, { wide: true });
    });
    void ui;
  }

  function exportRound(d) {
    const ix = R.index(d.cur);
    const sems = d.round.sems;
    const cols = [];
    sems.forEach((s) => ix.by[s].electives.forEach((o) => cols.push({ sem: s, o })));
    const h1 = ['학번', '이름', '성별', '학년', '반', '번호', '상태', '오류'], h2 = h1.map(() => '');
    let lastSem = '';
    cols.forEach((c) => { h1.push(c.sem !== lastSem ? semShort(c.sem) + (d.round.refSems.includes(c.sem) ? '(참고)' : '') : ''); h2.push(c.o.name); lastSem = c.sem; });
    const rows = d.students.map((s) => {
      const base = [s.studentNo, s.name, s.sex || '', s.grade, s.classNo, s.number, STATUS_LABEL[s.selStatus] || s.selStatus, s.errors || ''];
      cols.forEach((c) => base.push((s.picks[c.sem] || []).some((x) => R.norm(x) === c.o.key) ? 1 : ''));
      return base;
    });
    const count = [['학기', '그룹', '과목', '교과군', '학점', '전체 신청', '제출 완료']];
    cols.forEach((c) => {
      const all = d.students.filter((s) => (s.picks[c.sem] || []).some((x) => R.norm(x) === c.o.key));
      count.push([semShort(c.sem), (ix.groups[c.sem][c.o.group] || {}).name || c.o.group, c.o.name, c.o.area, c.o.credit, all.length, all.filter((s) => s.selStatus === '제출').length]);
    });
    const byStu = [['학번', '이름', '반', '번호', '상태'].concat(sems.map(semShort))].concat(d.students.map((s) => [s.studentNo, s.name, s.classNo, s.number, STATUS_LABEL[s.selStatus] || s.selStatus].concat(sems.map((x) => (s.picks[x] || []).join(', ')))));
    const todo = [['학번', '이름', '반', '번호', '상태', '오류 수', '마지막 저장']].concat(d.students.filter((s) => s.selStatus !== '제출').map((s) => [s.studentNo, s.name, s.classNo, s.number, STATUS_LABEL[s.selStatus] || s.selStatus, s.errors || '', s.updatedAt || '']));
    writeBook([
      { name: '신청 내역', aoa: [h1, h2].concat(rows), cols: [8, 9, 5, 5, 4, 5, 9, 5].concat(cols.map(() => 6)) },
      { name: '과목별 인원', aoa: count, cols: [12, 16, 22, 18, 6, 10, 10] },
      { name: '학생별 목록', aoa: byStu, cols: [8, 9, 4, 5, 9].concat(sems.map(() => 50)) },
      { name: '미제출·확인 필요', aoa: todo, cols: [8, 9, 4, 5, 10, 8, 18] },
    ], d.round.name.replace(/[\\/:*?"<>|]/g, '') + '_신청내역.xlsx');
  }

  /* =========================================================
     관리자: 신청 회차
     ========================================================= */
  VIEWS.rounds = async function (v) {
    loading(v);
    let rounds, cg;
    try { [rounds, cg] = await Promise.all([api('selRounds', {}), api('curGet', {})]); } catch (e) { failed(v, e); return; }
    v.innerHTML = '<div class="card"><div class="row"><h2>신청 회차</h2><span class="muted">학생에게 수강신청 메뉴가 열리는 기간입니다.</span><span style="margin-left:auto"></span><button class="btn pri sm" id="rn">새 회차</button></div>'
      + (rounds.length ? '<div class="tbl-wrap"><table class="tbl"><thead><tr><th>이름</th><th>대상</th><th>신청 학기</th><th>기간</th><th>상태</th><th>신청·제출</th><th></th></tr></thead><tbody>'
        + rounds.map((r) => '<tr><td><b>' + esc(r.name) + '</b>' + (r.kind === '참고조사' ? ' <span class="pill warn">참고조사</span>' : '') + '</td><td>' + esc(cohortLabel(r.year)) + '</td><td class="small">' + esc(r.sems.map(semShort).join(', ')) + (r.refSems.length ? '<br><span class="muted">참고: ' + esc(r.refSems.map(semShort).join(', ')) + '</span>' : '') + '</td>'
          + '<td class="small">' + (r.manual === '자동' ? esc(r.start) + ' ~<br>' + esc(r.end) : '수동 ' + esc(r.manual)) + '</td><td><span class="pill ' + (r.open ? 'ok' : r.state === '예정' ? 'pri' : '') + '">' + esc(r.state) + '</span></td>'
          + '<td>' + r.count + ' / ' + r.submitted + '</td><td class="row"><button class="btn sm" data-ed="' + esc(r.id) + '">수정</button><button class="btn sm dan" data-del="' + esc(r.id) + '">삭제</button></td></tr>').join('')
        + '</tbody></table></div>' : '<div class="empty">아직 회차가 없습니다. [새 회차]로 만들어 주세요.' + (cg.years.length ? '' : '<br>먼저 [교육과정]에서 입학년도별 교육과정을 등록해야 합니다.') + '</div>')
      + '<p class="hint">자동: 시작~마감 사이에만 학생 메뉴가 열립니다. 수동 열기/닫기는 기간과 관계없이 바로 적용됩니다. 1학년의 3학년 선택처럼 수요 조사용 학기는 「참고」로 표시해 두면, 다음 해 같은 학생들의 회차에서 미리 채워집니다.</p></div>';
    document.getElementById('rn').onclick = () => roundForm(null, cg, v);
    v.querySelectorAll('[data-ed]').forEach((b) => { b.onclick = () => roundForm(rounds.find((r) => r.id === b.dataset.ed), cg, v); });
    v.querySelectorAll('[data-del]').forEach((b) => {
      b.onclick = () => {
        const r = rounds.find((x) => x.id === b.dataset.del);
        if (!confirm('「' + r.name + '」 회차와 학생 신청 ' + r.count + '건을 지울까요? (실제 모드에서는 지우기 전에 백업합니다)')) return;
        run(b, async () => { await api('roundDelete', { id: r.id }); toast('삭제했습니다.'); VIEWS.rounds(v); });
      };
    });
  };
  function roundForm(r, cg, v) {
    r = r || { sems: [], refSems: [], manual: '자동' };
    if (!cg.years.length) { toast('먼저 [교육과정]에서 교육과정을 등록해 주세요.', true); return; }
    const toLocal = (s) => String(s || '').replace(' ', 'T').slice(0, 16);
    const sc = (name, list) => R.SEMS.map((s) => '<label class="ck"><input type="checkbox" name="' + name + '" value="' + s + '"' + (list.includes(s) ? ' checked' : '') + '> ' + s + '</label>').join('');
    modal('<h2>' + (r.id ? '회차 수정' : '새 신청 회차') + '</h2>'
      + '<div class="field"><label for="f1">이름</label><input id="f1" class="input" value="' + esc(r.name || '') + '" placeholder="예: 2027학년도 선택과목 (현 1학년)"></div>'
      + '<div class="field"><label for="f2">대상 학생</label><select id="f2" class="input">' + cg.years.map((y) => '<option value="' + y + '"' + (y === r.year ? ' selected' : '') + '>' + esc(cohortLabel(y)) + '</option>').join('') + '</select></div>'
      + '<div class="field"><span class="lbl">신청할 학기</span><div class="row">' + sc('fs', r.sems) + '</div></div>'
      + '<div class="field"><span class="lbl">참고(수요 조사) 학기</span><div class="row">' + sc('fr', r.refSems) + '</div><span class="hint">참고 학기도 이수 기준 검증은 똑같이 합니다.</span></div>'
      + '<div class="field"><span class="lbl">열고 닫기</span><div class="row">' + [['자동', '기간에 맞춰 자동'], ['열기', '지금 열기'], ['닫기', '닫아 두기']].map((m) => '<label class="ck"><input type="radio" name="fm" value="' + m[0] + '"' + ((r.manual || '자동') === m[0] ? ' checked' : '') + '> ' + m[1] + '</label>').join('') + '</div></div>'
      + '<div class="grid2 tight2"><div class="field"><label for="f3">시작</label><input id="f3" type="datetime-local" class="input" value="' + esc(toLocal(r.start)) + '"></div><div class="field"><label for="f4">마감</label><input id="f4" type="datetime-local" class="input" value="' + esc(toLocal(r.end)) + '"></div></div>'
      + '<div class="field"><label for="f5">학생에게 보일 안내 (선택)</label><textarea id="f5" class="input" rows="2">' + esc(r.notice || '') + '</textarea></div>'
      + '<div class="row" style="justify-content:flex-end"><button class="btn" data-close>취소</button><button class="btn pri" id="fok">저장</button></div>', (bg, close) => {
      const ok = bg.querySelector('#fok');
      ok.onclick = () => run(ok, async () => {
        const vals = (n) => Array.from(bg.querySelectorAll('input[name=' + n + ']:checked')).map((i) => i.value);
        const manual = bg.querySelector('input[name=fm]:checked').value;
        await api('roundSave', { id: r.id, name: bg.querySelector('#f1').value, year: bg.querySelector('#f2').value, sems: vals('fs'), refSems: vals('fr'),
          manual: manual === '자동' ? '' : manual, start: bg.querySelector('#f3').value.replace('T', ' '), end: bg.querySelector('#f4').value.replace('T', ' '), notice: bg.querySelector('#f5').value });
        close(); toast('저장했습니다.'); VIEWS.rounds(v);
      });
    }, { wide: true });
  }

  /* =========================================================
     관리자: 교육과정
     ========================================================= */
  VIEWS.curriculum = async function (v, yearArg) {
    loading(v);
    const ui = A.ui;
    let g;
    try { g = await api('curGet', { year: yearArg || ui.curYear || '' }); } catch (e) { failed(v, e); return; }
    if (!g.year) {
      const ys = g.years.concat(g.presetYears).sort();
      const want = ys.find((y) => curGrade(y) === 1) || ys[ys.length - 1];
      if (want) { ui.curYear = want; return VIEWS.curriculum(v, want); }
    }
    ui.curYear = g.year;
    const st = { cur: g.cur ? clone(g.cur) : { subjects: [], groups: [], rules: [], links: [] }, dirty: false, sem: ui.curSem || '2-1', tab: ui.curTab || '편제' };
    const years = Array.from(new Set(g.years.concat(g.presetYears))).sort();
    function totals() {
      const ix = R.index(st.cur);
      return R.SEMS.map((s) => {
        let sum = ix.by[s].designated.reduce((a, o) => a + o.credit, 0), unsure = false;
        Object.keys(ix.groups[s]).forEach((k) => {
          const cr = ix.by[s].electives.filter((o) => o.group === k).map((o) => o.credit);
          if (new Set(cr).size > 1) unsure = true;
          sum += (cr[0] || 0) * ix.groups[s][k].pick;
        });
        return { s, sum, unsure };
      });
    }
    function overview() {
      const t = totals(), target = (st.cur.rules.find((r) => r.종류 === '학기학점') || {}).값;
      return t.map((x) => '<button type="button" data-cs="' + x.s + '" class="ov' + (x.s === st.sem ? ' on' : '') + '"><b>' + semShort(x.s) + '</b><span class="' + (target && Number(target) !== x.sum ? 'no' : 'okk') + '">' + x.sum + (x.unsure ? '?' : '') + '학점</span></button>').join('');
    }
    function draw() {
      const yr = g.year;
      const head = '<div class="card tight"><div class="row"><h2>교육과정</h2><select id="cy" class="input sm" aria-label="입학년도">' + (years.length ? '' : '<option value="">-</option>') + years.map((y) => '<option value="' + y + '"' + (y === yr ? ' selected' : '') + '>' + esc(cohortLabel(y)) + (g.years.includes(y) ? '' : ' · 미등록') + '</option>').join('') + '</select>'
        + '<button class="btn sm" id="cnew">다른 입학년도</button>'
        + (g.presetYears.includes(yr) ? '<button class="btn sm" id="cpre">학교 편제표로 채우기</button>' : '')
        + '<span style="margin-left:auto"></span><button class="btn sm" id="cxd">엑셀로 내려받기</button><label class="btn sm">엑셀 올리기<input type="file" id="cxu" accept=".xlsx,.xls" hidden></label>'
        + '<button class="btn pri sm" id="csv"' + (st.dirty ? '' : ' disabled') + '>저장</button></div>'
        + (g.cur && g.cur.subjects.length ? '' : '<div class="note warn">' + esc(yr || '') + ' 입학생 교육과정이 아직 없습니다. ' + (g.presetYears.includes(yr) ? '[학교 편제표로 채우기]를 누르면 편제표 내용으로 바로 채워집니다.' : '엑셀 양식으로 올리거나 아래에서 직접 입력하세요.') + '</div>')
        + '<div class="seg3" role="tablist">' + ['편제', '기준', '연계'].map((t) => '<button type="button" data-ct="' + t + '" class="' + (st.tab === t ? 'on' : '') + '">' + (t === '편제' ? '편제(과목·그룹)' : t === '기준' ? '이수 기준' : '연계 안내') + '</button>').join('') + '</div></div>'
        + '<div id="cbody"></div>';
      v.innerHTML = head;
      v.querySelector('#cy').onchange = (e) => { if (st.dirty && !confirm('저장하지 않은 변경을 버릴까요?')) { e.target.value = yr; return; } ui.curYear = e.target.value; VIEWS.curriculum(v, e.target.value); };
      v.querySelector('#cnew').onclick = () => { const y = prompt('입학년도(4자리)를 입력하세요. 예: 2028'); if (y && /^\d{4}$/.test(y)) { ui.curYear = y; VIEWS.curriculum(v, y); } };
      const pre = v.querySelector('#cpre');
      if (pre) pre.onclick = () => {
        if (g.cur && g.cur.subjects.length && !confirm(yr + ' 입학생 교육과정을 학교 편제표 내용으로 덮어쓸까요? (지금 내용은 사라집니다)')) return;
        run(pre, async () => { await api('curPreset', { year: yr }); toast('편제표 내용으로 채웠습니다.'); VIEWS.curriculum(v, yr); });
      };
      v.querySelector('#csv').onclick = (e) => run(e.target, async () => {
        const r = await api('curSave', Object.assign({ year: yr }, st.cur));
        g.cur = r.cur; g.years = r.years; st.cur = clone(r.cur); st.dirty = false; toast('저장했습니다.'); draw();
      });
      v.querySelector('#cxd').onclick = () => curToExcel(yr, st.cur);
      v.querySelector('#cxu').onchange = async (e) => {
        const f = e.target.files[0]; if (!f) return;
        try { const { wb } = await readAoa(f); st.cur = curFromExcel(wb); st.dirty = true; toast('불러왔습니다. 확인한 뒤 [저장]을 누르세요.'); draw(); } catch (err) { toast(err.message, true); }
      };
      v.querySelectorAll('[data-ct]').forEach((b) => { b.onclick = () => { st.tab = ui.curTab = b.dataset.ct; draw(); }; });
      const body = v.querySelector('#cbody');
      if (st.tab === '편제') drawPlan(body); else if (st.tab === '기준') drawRules(body); else drawLinks(body);
    }
    const mark = () => { st.dirty = true; const b = v.querySelector('#csv'); if (b) b.disabled = false; const o = v.querySelector('#ov'); if (o) { o.innerHTML = overview(); bindOv(); } };
    function bindOv() { v.querySelectorAll('[data-cs]').forEach((b) => { b.onclick = () => { st.sem = ui.curSem = b.dataset.cs; draw(); }; }); }
    function drawPlan(body) {
      const s = st.sem;
      const subj = st.cur.subjects.map((o, i) => [o, i]).filter((x) => x[0].학기 === s);
      const grps = st.cur.groups.map((o, i) => [o, i]).filter((x) => x[0].학기 === s);
      const gopts = (cur) => '<option value=""></option>' + grps.map((x) => '<option' + (x[0].그룹 === cur ? ' selected' : '') + '>' + esc(x[0].그룹) + '</option>').join('');
      body.innerHTML = '<div class="ovs" id="ov">' + overview() + '</div>'
        + '<div class="grid-cur"><div class="card tight"><div class="row"><h3>' + semShort(s) + ' 선택 그룹</h3><span style="margin-left:auto"></span><button class="btn sm" id="gadd">그룹 추가</button></div>'
        + (grps.length ? '<table class="mini edit"><thead><tr><th>그룹</th><th>이름</th><th>택</th><th>과목</th><th></th></tr></thead><tbody>' + grps.map(([o, i]) => '<tr><td><b>' + esc(o.그룹) + '</b></td><td><input class="input sm" data-g="' + i + '" data-k="이름" value="' + esc(o.이름) + '"></td>'
          + '<td><input class="input sm w4" data-g="' + i + '" data-k="택수" inputmode="numeric" value="' + esc(o.택수) + '"></td><td>' + subj.filter((x) => x[0].그룹 === o.그룹).length + '</td><td><button class="btn sm dan" data-gdel="' + i + '" aria-label="그룹 삭제">✕</button></td></tr>').join('') + '</tbody></table>'
          : '<div class="muted">이 학기에는 선택 그룹이 없습니다. (모두 지정 과목)</div>')
        + '<p class="hint">택: 이 그룹에서 학생이 골라야 하는 과목 수. 같은 그룹의 과목은 학점이 같아야 학기 합계가 정확히 계산됩니다.</p></div>'
        + '<div class="card tight"><div class="row"><h3>' + semShort(s) + ' 과목 ' + subj.length + '개</h3><span style="margin-left:auto"></span><button class="btn sm" id="sadd">과목 추가</button></div>'
        + '<datalist id="teachl">' + (g.teachList || []).map((t) => '<option value="' + esc(t) + '">').join('') + '</datalist>'
        + '<div class="tbl-wrap"><table class="tbl edit"><thead><tr><th>과목</th><th>학점</th><th>구분</th><th>그룹</th><th>교과군</th><th>정원과목<span class="muted small"> (수업 교사)</span></th><th></th></tr></thead><tbody>'
        + subj.map(([o, i]) => '<tr><td><input class="input sm wide" data-s="' + i + '" data-k="과목" value="' + esc(o.과목) + '"></td><td><input class="input sm w4" data-s="' + i + '" data-k="학점" inputmode="numeric" value="' + esc(o.학점) + '"></td>'
          + '<td><select class="input sm" data-s="' + i + '" data-k="구분"><option' + (o.구분 === '지정' ? ' selected' : '') + '>지정</option><option' + (o.구분 !== '지정' ? ' selected' : '') + '>선택</option></select></td>'
          + '<td><select class="input sm" data-s="' + i + '" data-k="그룹"' + (o.구분 === '지정' ? ' disabled' : '') + '>' + gopts(o.그룹) + '</select></td>'
          + '<td><select class="input sm" data-s="' + i + '" data-k="교과군"><option value=""></option>' + R.AREAS.map((a) => '<option' + (a === o.교과군 ? ' selected' : '') + '>' + esc(a) + '</option>').join('') + '</select></td>'
          + '<td><input class="input sm w8" list="teachl" data-s="' + i + '" data-k="정원과목" value="' + esc(o.정원과목 || '') + '"></td>'
          + '<td><button class="btn sm dan" data-sdel="' + i + '" aria-label="과목 삭제">✕</button></td></tr>').join('')
        + '</tbody></table></div></div></div>';
      bindOv();
      body.querySelectorAll('[data-s]').forEach((el) => {
        el.onchange = () => {
          const o = st.cur.subjects[Number(el.dataset.s)];
          o[el.dataset.k] = el.value;
          if (el.dataset.k === '구분') { if (el.value === '지정') o.그룹 = ''; mark(); drawPlan(body); return; }
          mark();
        };
      });
      body.querySelectorAll('[data-g]').forEach((el) => { el.onchange = () => { st.cur.groups[Number(el.dataset.g)][el.dataset.k] = el.value; mark(); }; });
      body.querySelectorAll('[data-sdel]').forEach((b) => { b.onclick = () => { st.cur.subjects.splice(Number(b.dataset.sdel), 1); mark(); drawPlan(body); }; });
      body.querySelectorAll('[data-gdel]').forEach((b) => {
        b.onclick = () => {
          const gr = st.cur.groups[Number(b.dataset.gdel)];
          if (st.cur.subjects.some((o) => o.학기 === gr.학기 && o.그룹 === gr.그룹) && !confirm('이 그룹의 과목들도 함께 지울까요?')) return;
          st.cur.subjects = st.cur.subjects.filter((o) => !(o.학기 === gr.학기 && o.그룹 === gr.그룹));
          st.cur.groups.splice(Number(b.dataset.gdel), 1); mark(); drawPlan(body);
        };
      });
      body.querySelector('#gadd').onclick = () => {
        const used = grps.map((x) => x[0].그룹);
        const id = 'ABCDEFGHIJ'.split('').find((c) => !used.includes(c)) || ('G' + (used.length + 1));
        st.cur.groups.push({ 학기: s, 그룹: id, 이름: '', 택수: '1' }); mark(); drawPlan(body);
      };
      body.querySelector('#sadd').onclick = () => {
        const last = subj.length ? subj[subj.length - 1][1] + 1 : st.cur.subjects.length;
        st.cur.subjects.splice(last, 0, { 학기: s, 과목: '', 학점: '3', 구분: grps.length ? '선택' : '지정', 그룹: grps.length ? grps[grps.length - 1][0].그룹 : '', 교과군: '', 정원과목: '' });
        mark(); drawPlan(body);
        const ins = body.querySelectorAll('input[data-k=과목]'); const t = Array.from(ins).find((x) => !x.value); if (t) t.focus();
      };
    }
    function drawRules(body) {
      body.innerHTML = '<div class="card tight"><div class="row"><h3>이수 기준</h3><span style="margin-left:auto"></span><button class="btn sm" id="radd">기준 추가</button></div>'
        + '<div class="tbl-wrap"><table class="tbl edit"><thead><tr><th>종류</th><th>교과군 (여러 개면 합계)</th><th>학점</th><th>표시 이름</th><th></th></tr></thead><tbody>'
        + st.cur.rules.map((r, i) => '<tr><td><select class="input sm" data-r="' + i + '" data-k="종류">' + ['학기학점', '최대', '최소'].map((k) => '<option' + (k === r.종류 ? ' selected' : '') + ' value="' + k + '">' + (k === '학기학점' ? '학기별 합계' : k === '최대' ? '최대(이하)' : '최소(이상)') + '</option>').join('') + '</select></td>'
          + '<td>' + (r.종류 === '학기학점' ? '<span class="muted">모든 학기</span>' : '<div class="row">' + R.AREAS.map((a) => '<label class="ck sm"><input type="checkbox" data-ra="' + i + '" value="' + esc(a) + '"' + (String(r.대상).split('+').includes(a) ? ' checked' : '') + '> ' + esc(AREA_SHORT[a] || a) + '</label>').join('') + '</div>') + '</td>'
          + '<td><input class="input sm w4" data-r="' + i + '" data-k="값" inputmode="numeric" value="' + esc(r.값) + '"></td><td><input class="input sm" data-r="' + i + '" data-k="이름" value="' + esc(r.이름) + '"></td>'
          + '<td><button class="btn sm dan" data-rdel="' + i + '" aria-label="기준 삭제">✕</button></td></tr>').join('')
        + '</tbody></table></div><p class="hint">학생이 1~3학년 동안 듣는 전체(지정+선택+이수 이력)로 계산합니다. 최소 기준은 모든 학기 선택이 끝났을 때 오류로 처리하고, 고르는 중에는 남은 선택으로 채울 수 있는지 미리 알려 줍니다.</p></div>';
      body.querySelectorAll('[data-r]').forEach((el) => { el.onchange = () => { st.cur.rules[Number(el.dataset.r)][el.dataset.k] = el.value; mark(); if (el.dataset.k === '종류') drawRules(body); }; });
      body.querySelectorAll('[data-ra]').forEach((el) => {
        el.onchange = () => { const i = Number(el.dataset.ra); st.cur.rules[i].대상 = Array.from(body.querySelectorAll('[data-ra="' + i + '"]:checked')).map((x) => x.value).join('+'); mark(); };
      });
      body.querySelectorAll('[data-rdel]').forEach((b) => { b.onclick = () => { st.cur.rules.splice(Number(b.dataset.rdel), 1); mark(); drawRules(body); }; });
      body.querySelector('#radd').onclick = () => { st.cur.rules.push({ 종류: '최소', 대상: '', 값: '', 이름: '' }); mark(); drawRules(body); };
    }
    function drawLinks(body) {
      const names = Array.from(new Set(st.cur.subjects.map((o) => o.과목))).sort();
      const known = new Set(names.map(R.norm));
      body.innerHTML = '<div class="card tight"><div class="row"><h3>연계 안내</h3><span class="muted">' + st.cur.links.length + '개</span><span style="margin-left:auto"></span><button class="btn sm" id="ladd">연계 추가</button></div>'
        + '<datalist id="subjl">' + names.map((n) => '<option value="' + esc(n) + '">').join('') + '</datalist>'
        + '<div class="tbl-wrap"><table class="tbl edit"><thead><tr><th>사용</th><th>종류</th><th>앞 과목</th><th>뒤 과목</th><th>학생에게 보일 문구 (비우면 자동)</th><th></th></tr></thead><tbody>'
        + st.cur.links.map((l, i) => '<tr><td><input type="checkbox" data-lu="' + i + '"' + (l.사용 !== 'N' ? ' checked' : '') + ' aria-label="사용"></td>'
          + '<td><select class="input sm" data-l="' + i + '" data-k="종류">' + ['추천', '주의', '필수'].map((k) => '<option' + (k === l.종류 ? ' selected' : '') + '>' + k + '</option>').join('') + '</select></td>'
          + ['앞과목', '뒤과목'].map((k) => '<td><input class="input sm' + (l[k] && !known.has(R.norm(l[k])) ? ' bad' : '') + '" list="subjl" data-l="' + i + '" data-k="' + k + '" value="' + esc(l[k]) + '"></td>').join('')
          + '<td><input class="input sm wide" data-l="' + i + '" data-k="문구" value="' + esc(l.문구) + '" placeholder="' + esc(R.linkText(Object.assign({}, l, { 문구: '' }))) + '"></td>'
          + '<td><button class="btn sm dan" data-ldel="' + i + '" aria-label="연계 삭제">✕</button></td></tr>').join('')
        + '</tbody></table></div><p class="hint"><b>추천</b>: 앞 과목을 고르면 뒤 과목을 권합니다. <b>주의</b>: 앞 과목 없이 뒤 과목을 고르면 주의 문구를 보이지만 제출은 됩니다. <b>필수</b>: 앞 과목을 먼저(또는 같은 학기에) 듣지 않으면 제출할 수 없습니다. 주의·필수 연계도 앞 과목을 고른 학생에게는 뒤 과목을 추천합니다.</p></div>';
      body.querySelectorAll('[data-l]').forEach((el) => { el.onchange = () => { st.cur.links[Number(el.dataset.l)][el.dataset.k] = el.value; mark(); if (el.dataset.k !== '문구') drawLinks(body); }; });
      body.querySelectorAll('[data-lu]').forEach((el) => { el.onchange = () => { st.cur.links[Number(el.dataset.lu)].사용 = el.checked ? 'Y' : 'N'; mark(); }; });
      body.querySelectorAll('[data-ldel]').forEach((b) => { b.onclick = () => { st.cur.links.splice(Number(b.dataset.ldel), 1); mark(); drawLinks(body); }; });
      body.querySelector('#ladd').onclick = () => { st.cur.links.push({ 종류: '추천', 앞과목: '', 뒤과목: '', 문구: '', 사용: 'Y' }); mark(); drawLinks(body); };
    }
    draw();
  };
  function curToExcel(year, cur) {
    writeBook([
      { name: '편제', aoa: [['학기', '과목', '학점', '구분', '그룹', '교과군', '정원과목']].concat(cur.subjects.map((o) => [o.학기, o.과목, Number(o.학점) || o.학점, o.구분, o.그룹, o.교과군, o.정원과목 || ''])), cols: [6, 24, 6, 6, 6, 22, 12] },
      { name: '그룹', aoa: [['학기', '그룹', '이름', '택수']].concat(cur.groups.map((o) => [o.학기, o.그룹, o.이름, Number(o.택수) || o.택수])), cols: [6, 6, 20, 6] },
      { name: '기준', aoa: [['종류', '대상', '값', '이름']].concat(cur.rules.map((o) => [o.종류, o.대상, Number(o.값), o.이름])), cols: [10, 30, 6, 30] },
      { name: '연계', aoa: [['종류', '앞과목', '뒤과목', '문구', '사용']].concat(cur.links.map((o) => [o.종류, o.앞과목, o.뒤과목, o.문구, o.사용])), cols: [6, 20, 20, 50, 5] },
      { name: '안내', aoa: [['작성 방법'], ['학기: 1-1, 1-2, 2-1, 2-2, 3-1, 3-2'], ['구분: 지정 또는 선택 (선택 과목은 그룹을 꼭 넣습니다)'], ['교과군: ' + R.AREAS.join(', ')], ['기준 종류: 학기학점(학기별 합계), 최대, 최소 / 대상은 교과군을 + 로 이어 씁니다 (예: 국어+수학+영어)'], ['연계 종류: 추천, 주의, 필수 / 사용: Y 또는 N']], cols: [90] },
    ], year + '학년도_입학생_교육과정.xlsx');
  }
  function curFromExcel(wb) {
    const rows = (name) => {
      const ws = wb.Sheets[name];
      if (!ws) throw new Error('「' + name + '」 시트가 없습니다. 내려받은 양식을 써 주세요.');
      return window.XLSX.utils.sheet_to_json(ws, { defval: '', raw: false }).map((o) => { const r = {}; Object.keys(o).forEach((k) => { r[String(k).trim()] = String(o[k]).trim(); }); return r; });
    };
    const semFix = (x) => { const m = String(x).match(/([123])\D*([12])/); return m ? m[1] + '-' + m[2] : String(x); };
    return {
      subjects: rows('편제').filter((r) => r.과목).map((r) => ({ 학기: semFix(r.학기), 과목: r.과목, 학점: r.학점, 구분: r.구분 === '지정' ? '지정' : '선택', 그룹: r.그룹, 교과군: r.교과군, 정원과목: r.정원과목 || '' })),
      groups: rows('그룹').filter((r) => r.그룹).map((r) => ({ 학기: semFix(r.학기), 그룹: r.그룹, 이름: r.이름, 택수: r.택수 })),
      rules: wb.Sheets['기준'] ? rows('기준').filter((r) => r.종류).map((r) => ({ 종류: r.종류, 대상: r.대상, 값: r.값, 이름: r.이름 })) : [],
      links: wb.Sheets['연계'] ? rows('연계').filter((r) => r.앞과목 && r.뒤과목).map((r) => ({ 종류: r.종류, 앞과목: r.앞과목, 뒤과목: r.뒤과목, 문구: r.문구, 사용: r.사용 || 'Y' })) : [],
    };
  }

  /* =========================================================
     관리자: 업로드 (이미 받은 선택 · 이수 이력)
     ========================================================= */
  const EMPTY_MARK = new Set(['', '.', '0', '-', 'X', 'N', '·', 'FALSE']);
  function normSemText(v) {
    const t = String(v || '');
    let m = t.match(/([123])\s*(?:-|학년)\s*([12])/); if (m) return m[1] + '-' + m[2];
    return '';
  }
  /** 엑셀 표를 [{학번, 성명, 학기, 과목, 학점, 교과군}] 로 바꿈. 가로형(과목 열에 표시)·세로형 모두 */
  function parseSelection(aoa, cur, candSems) {
    const ix = R.index(cur);
    const info = { format: '', mapped: [], skipped: [], ambiguous: [], unknownCols: [], rows: [] };
    const top = aoa.slice(0, 10);
    const norm = (x) => R.norm(x);
    // 세로형?
    for (let i = 0; i < Math.min(top.length, 6); i++) {
      const h = top[i].map(norm);
      const ci = h.indexOf('과목');
      if (ci >= 0 && (h.includes('학번') || h.includes('성명') || h.includes('이름'))) {
        info.format = '세로형 (한 줄에 과목 하나)';
        const col = (names) => h.findIndex((x) => names.includes(x));
        const cNo = col(['학번', '신학번']), cNm = col(['성명', '이름']), cSem = col(['학기']), cCr = col(['학점']), cAr = col(['교과군']), cYr = col(['학년도']);
        aoa.slice(i + 1).forEach((r) => {
          const subj = String(r[ci] || '').trim();
          if (!subj) return;
          let sem = cSem >= 0 ? normSemText(r[cSem]) : '';
          if (!sem) {
            const c = candSems.filter((s) => ix.by[s].map[norm(subj)]);
            sem = c.length === 1 ? c[0] : (candSems.length === 1 ? candSems[0] : '');
          }
          info.rows.push({ 학번: cNo >= 0 ? String(r[cNo]).trim() : '', 성명: cNm >= 0 ? String(r[cNm]).trim() : '', 학기: sem, 과목: subj,
            학점: cCr >= 0 ? String(r[cCr]).trim() : '', 교과군: cAr >= 0 ? String(r[cAr]).trim() : '', 학년도: cYr >= 0 ? String(r[cYr]).trim() : '' });
        });
        return info;
      }
    }
    // 가로형: 과목 이름이 가장 많이 있는 줄을 머리글로
    const allNames = {};
    R.SEMS.forEach((s) => ix.by[s].list.forEach((o) => { (allNames[o.key] = allNames[o.key] || []).push(o); }));
    let hi = -1, best = 0;
    top.forEach((r, i) => { const n = r.filter((c) => allNames[norm(c)]).length; if (n > best) { best = n; hi = i; } });
    if (hi < 0 || best < 2) throw new Error('과목 이름이 있는 머리글 줄을 찾지 못했습니다. 세로형 양식(학번·성명·학기·과목)을 쓰거나 과목 이름을 교육과정과 같게 맞춰 주세요.');
    info.format = '가로형 (과목 열에 표시)';
    const width = Math.max.apply(null, aoa.slice(0, hi + 3).map((r) => r.length));
    const labelAt = (j) => { for (let k = hi; k >= Math.max(0, hi - 2); k--) { const t = String((aoa[k] || [])[j] || '').trim(); if (t) return t; } return ''; };
    const groupLabel = (j) => { // 위 줄의 병합 머리글(예: 1학기[택4])을 왼쪽에서 이어받기
      for (let k = hi - 1; k >= Math.max(0, hi - 2); k--) { for (let x = j; x >= 0; x--) { const t = String((aoa[k] || [])[x] || '').trim(); if (t) { if (/학기|학년|\d-\d/.test(t)) return t; break; } } }
      return '';
    };
    let cNo = -1, cNm = -1;
    for (let j = 0; j < width; j++) {
      const l = norm(labelAt(j));
      if ((l === '신학번' || (l === '학번' && cNo < 0)) && l !== '구학번') cNo = j;
      if ((l === '성명' || l === '이름') && cNm < 0) cNm = j;
    }
    if (cNo < 0 && cNm < 0) throw new Error('학번이나 이름 열을 찾지 못했습니다.');
    const cols = [];
    const META = new Set(['순번', '번호', '성별', '반', '반배정', '학년', '과정', '메모', '과목수', '교사', '교실', '그룹', '성적', '과학', '구학번', '신학번', '학번', '이름', '성명', '합계', '비고'].map(norm));
    for (let j = 0; j < width; j++) {
      if (j === cNo || j === cNm) continue;
      const head = String((aoa[hi] || [])[j] || '').trim();
      if (!head) continue;
      const k = norm(head);
      const objs = allNames[k];
      if (!objs) { if (!META.has(k)) info.unknownCols.push(head); continue; }
      let cand = objs.filter((o) => candSems.includes(o.sem));
      if (!cand.length) { info.skipped.push(head + ' (대상 학기에 없음)'); continue; }
      if (cand.every((o) => o.kind === '지정')) { info.skipped.push(head + ' (정해진 과목)'); continue; }
      cand = cand.filter((o) => o.kind === '선택');
      let pickO = cand.length === 1 ? cand[0] : null;
      if (cand.length > 1) {
        const gl = groupLabel(j);
        const sm = normSemText(gl), sn = (gl.match(/([12])\s*학기/) || [])[1];
        const f = cand.filter((o) => (sm && o.sem === sm) || (!sm && sn && o.sem.endsWith('-' + sn)));
        if (f.length === 1) pickO = f[0]; else if (f.length > 1) cand = f;
      }
      cols.push({ j, o: pickO, cand, head });
    }
    // 학기를 못 정한 열: 다른 열들이 가장 많이 속한 학기로
    const semCount = {};
    cols.forEach((c) => { if (c.o) semCount[c.o.sem] = (semCount[c.o.sem] || 0) + 1; });
    cols.forEach((c) => {
      if (c.o) return;
      const best = c.cand.slice().sort((a, b) => (semCount[b.sem] || 0) - (semCount[a.sem] || 0));
      if ((semCount[best[0].sem] || 0) > (semCount[(best[1] || {}).sem] || 0)) c.o = best[0];
      else { c.o = best[0]; info.ambiguous.push(c.head + ' → ' + semShort(best[0].sem) + '로 넣음'); }
    });
    cols.forEach((c) => info.mapped.push(semShort(c.o.sem) + ' ' + c.o.name));
    aoa.slice(hi + 1).forEach((r) => {
      const no = cNo >= 0 ? String(r[cNo] || '').trim() : '', nm = cNm >= 0 ? String(r[cNm] || '').trim() : '';
      if (!no && !nm) return;
      if (/합계|계$/.test(no + nm) && !/\d/.test(no)) return;
      cols.forEach((c) => {
        const val = String(r[c.j] == null ? '' : r[c.j]).trim().toUpperCase();
        if (!EMPTY_MARK.has(val)) info.rows.push({ 학번: no, 성명: nm, 학기: c.o.sem, 과목: c.o.name });
      });
    });
    return info;
  }
  function parseInfoHtml(info) {
    const students = new Set(info.rows.map((r) => r.학번 + '|' + r.성명)).size;
    return '<div class="note">읽은 형식: <b>' + esc(info.format) + '</b> · 학생 ' + students + '명 · 과목 표시 ' + info.rows.length + '건'
      + (info.mapped.length ? '<details class="small"><summary>과목 열 ' + info.mapped.length + '개 (펼쳐 보기)</summary>' + esc(info.mapped.join(', ')) + '</details>' : '') + '</div>'
      + (info.ambiguous.length ? '<div class="note warn">학기를 정하지 못한 열: ' + esc(info.ambiguous.join(', ')) + '<br>위의 「학기」를 직접 고른 뒤 파일을 다시 올려 주세요.</div>' : '')
      + (info.unknownCols.length ? '<div class="note warn">교육과정에 없어 건너뛴 열: ' + esc(info.unknownCols.join(', ')) + '</div>' : '')
      + (info.skipped.length ? '<div class="muted small">건너뛴 열: ' + esc(info.skipped.join(', ')) + '</div>' : '');
  }
  function unmatchedHtml(r) {
    return (r.unmatchedCount ? '<details class="note err"><summary>명렬에서 찾지 못한 줄 ' + r.unmatchedCount + '건</summary><div class="tbl-wrap" style="max-height:200px"><table class="tbl"><tbody>'
      + r.unmatched.map((x) => '<tr><td>' + esc(x.학번) + '</td><td>' + esc(x.성명) + '</td><td>' + esc(x.reason) + '</td></tr>').join('') + '</tbody></table></div></details>' : '');
  }

  VIEWS.upload = async function (v) {
    loading(v);
    let rounds, cg, allRounds;
    try { [allRounds, cg] = await Promise.all([api('selRounds', {}), api('curGet', {})]); } catch (e) { failed(v, e); return; }
    rounds = allRounds.filter((r) => r.kind !== '참고조사');
    const surveys = allRounds.filter((r) => r.kind === '참고조사');
    v.innerHTML = '<div class="grid2">'
      + '<div class="card" id="u1"><h2>이미 받은 선택 올리기</h2><p class="hint">구글 설문·엑셀로 이미 받은 다음 학년도 선택을 신청 회차에 넣습니다. 기준을 지키면 「제출 완료」, 아니면 「확인 필요」가 되어 학생이 앱에서 고칠 수 있습니다.</p>'
      + '<div class="field"><label for="u1r">신청 회차</label><select id="u1r" class="input">' + (rounds.length ? rounds.map((r) => '<option value="' + esc(r.id) + '">' + esc(r.name) + ' · ' + esc(cohortLabel(r.year)) + '</option>').join('') : '<option value="">먼저 신청 회차를 만들어 주세요</option>') + '</select></div>'
      + '<div class="field"><label for="u1s">파일의 학기</label><select id="u1s" class="input"><option value="">자동 (머리글·교육과정으로 판단)</option></select></div>'
      + '<div class="row"><input type="file" id="u1f" accept=".xlsx,.xls,.csv" class="input"></div><div data-out></div>'
      + '<div class="row small" style="margin-top:6px"><span class="muted">이 회차에 들어간 신청 내용을 모두 지우려면</span><button class="btn sm dan" id="u1z">회차 신청 초기화</button></div></div>'
      + '<div class="card" id="u2"><h2>이수 이력 올리기</h2><p class="hint">지난 학기에 실제로 들은 선택 과목(배정 내역)을 올립니다. 2학년의 3학년 선택을 검증할 때 1·2학년 이수 과목으로 쓰고, 같은 과목 중복과 교과군 학점을 계산합니다.</p>'
      + '<div class="field"><label for="u2y">대상 학생</label><select id="u2y" class="input">' + cg.years.map((y) => '<option value="' + y + '"' + (curGrade(y) === 2 ? ' selected' : '') + '>' + esc(cohortLabel(y)) + '</option>').join('') + '</select></div>'
      + '<div class="field"><label for="u2s">파일의 학기</label><select id="u2s" class="input"><option value="">자동 (머리글·교육과정으로 판단)</option>' + R.SEMS.map((s) => '<option value="' + s + '">' + semShort(s) + '</option>').join('') + '</select></div>'
      + '<div class="row"><input type="file" id="u2f" accept=".xlsx,.xls,.csv" class="input"></div><div data-out></div>'
      + '<div class="row small" style="margin-top:6px"><span class="muted">위 대상 학생의 이수 이력을 모두 지우려면</span><button class="btn sm dan" id="u2z">이수 이력 초기화</button></div></div>'
      + '<div class="card" id="u3" style="grid-column:1/-1"><h2>참고조사(수요조사) 올리기</h2>'
      + '<p class="hint">작년에 1학년이 미리 고른 3학년 과목처럼, 확정 신청이 아닌 <b>수요 조사</b> 결과를 올립니다. 학생 메뉴에는 나오지 않고, ① 같은 학생들의 다음 신청 회차에서 미리 채워지며 ② 교원소요에서 아직 신청이 없는 학기의 인원으로 쓰이고 ③ 신청 현황에서 「참고조사」 회차로 볼 수 있습니다.</p>'
      + '<div class="row"><label class="field">대상 학생<select id="u3y" class="input">' + cg.years.map((y) => '<option value="' + y + '"' + (curGrade(y) === 2 ? ' selected' : '') + '>' + esc(cohortLabel(y)) + '</option>').join('') + '</select></label>'
      + '<label class="field">올릴 곳<select id="u3r" class="input"></select></label>'
      + '<label class="field" style="flex:1">조사 이름<input id="u3n" class="input" placeholder="예: 2025 1학년 3학년 과목 수요조사"></label></div>'
      + '<div class="field" id="u3sw"><span class="lbl">조사한 학기</span><div class="row" id="u3s"></div></div>'
      + '<div class="row"><input type="file" id="u3f" accept=".xlsx,.xls,.csv" class="input"></div><div data-out></div>'
      + '<div id="u3list"></div></div>'
      + '<div class="card" style="grid-column:1/-1"><h2>양식</h2><div class="row"><button class="btn sm" id="t1">세로형 양식 (학번·성명·학기·과목)</button><button class="btn sm" id="t2">이수 이력 양식 (학점·교과군 포함)</button></div>'
      + '<p class="hint">학교에서 쓰던 가로형 파일(첫 줄에 과목 이름, 학생 줄에 1·A·B 같은 표시)도 그대로 올릴 수 있습니다. 「.」 「0」 빈칸은 선택하지 않은 것으로 봅니다. 띄어쓰기·로마 숫자(Ⅰ/I) 차이는 자동으로 맞춥니다.</p></div></div>';
    v.querySelector('#t1').onclick = () => writeBook([{ name: '선택', aoa: [['학번', '성명', '학기', '과목'], ['10101', '홍길동', '2-1', '물리학'], ['10101', '홍길동', '2-1', '화학']], cols: [8, 10, 6, 20] }], '선택_업로드_양식.xlsx');
    v.querySelector('#t2').onclick = () => writeBook([{ name: '이수이력', aoa: [['학번', '성명', '학기', '과목', '학점', '교과군'], ['20101', '홍길동', '2-1', '일본어', '3', ''], ['20101', '홍길동', '2-1', '전학 전 학교 과목', '3', '사회']], cols: [8, 10, 6, 20, 6, 22] }], '이수이력_양식.xlsx');
    const semSel = v.querySelector('#u1s'), rSel = v.querySelector('#u1r');
    const fillSems = () => { const r = rounds.find((x) => x.id === rSel.value); semSel.innerHTML = '<option value="">자동 (머리글·교육과정으로 판단)</option>' + (r ? r.sems.map((s) => '<option value="' + s + '">' + semShort(s) + '</option>').join('') : ''); };
    rSel.onchange = fillSems; fillSems();
    const curCache = {};
    const getCur = async (year) => { if (!curCache[year]) curCache[year] = (await api('curGet', { year })).cur; return curCache[year]; };
    v.querySelector('#u1z').onclick = () => { const r = rounds.find((x) => x.id === rSel.value); if (!r) return; A.resetData('「' + r.name + '」 신청 내용', 'selections', r.id); };
    v.querySelector('#u2z').onclick = () => { const y = v.querySelector('#u2y').value; A.resetData(y + ' 입학생 이수 이력', 'history', y); };
    // 참고조사
    const u3y = v.querySelector('#u3y'), u3r = v.querySelector('#u3r'), u3s = v.querySelector('#u3s'), u3n = v.querySelector('#u3n');
    const fillSurvey = () => {
      const y = u3y.value, mine = surveys.filter((r) => r.year === y);
      u3r.innerHTML = '<option value="">새 참고조사로</option>' + mine.map((r) => '<option value="' + esc(r.id) + '">기존: ' + esc(r.name) + ' (덮어쓰기)</option>').join('');
      const g = curGrade(y);
      u3s.innerHTML = R.SEMS.map((x) => '<label class="row small"><input type="checkbox" value="' + x + '"' + (x[0] === '3' ? ' checked' : '') + '> ' + semShort(x) + '</label>').join('');
      u3n.value = y + ' 입학생 수요조사';
      v.querySelector('#u3sw').hidden = !!u3r.value;
      u3n.disabled = !!u3r.value;
      v.querySelector('#u3list').innerHTML = mine.length ? '<div class="tbl-wrap"><table class="tbl"><thead><tr><th>이 학생들의 참고조사</th><th>학기</th><th>학생 수</th><th></th></tr></thead><tbody>'
        + mine.map((r) => '<tr><td>' + esc(r.name) + '</td><td class="small">' + esc(r.sems.map(semShort).join(', ')) + '</td><td>' + r.count + '</td><td><button class="btn sm dan" data-sz="' + esc(r.id) + '">삭제</button></td></tr>').join('') + '</tbody></table></div>' : '';
      v.querySelectorAll('[data-sz]').forEach((b) => { const r = mine.find((x) => x.id === b.dataset.sz); b.onclick = () => A.resetData('참고조사 「' + r.name + '」', 'selections', r.id, () => VIEWS.upload(v), { dropRound: true }); });
    };
    u3y.onchange = fillSurvey; u3r.onchange = () => { v.querySelector('#u3sw').hidden = !!u3r.value; u3n.disabled = !!u3r.value; };
    fillSurvey();
    v.querySelector('#u3f').onchange = async (e) => {
      const out = v.querySelector('#u3 [data-out]'), f = e.target.files[0]; e.target.value = '';
      if (!f) return;
      const year = u3y.value, roundId = u3r.value;
      const sv = surveys.find((r) => r.id === roundId);
      const sems = sv ? sv.sems : Array.from(u3s.querySelectorAll('input:checked')).map((x) => x.value);
      if (!sems.length) { toast('조사한 학기를 골라 주세요.', true); return; }
      out.innerHTML = '<div class="empty">읽는 중…</div>';
      let info, prev;
      const payload = () => ({ roundId, year, sems, name: u3n.value.trim(), rows: info.rows });
      try {
        const { aoa } = await readAoa(f);
        const cur = await getCur(year);
        if (!cur || !cur.subjects.length) throw new Error(year + ' 입학생 교육과정을 먼저 등록해 주세요.');
        info = parseSelection(aoa, cur, sems);
        if (sems.length === 1) info.rows.forEach((x) => { if (!x.학기) x.학기 = sems[0]; });
        prev = await api('surveyUploadPreview', payload());
      } catch (err) { out.innerHTML = '<div class="note err">' + esc(err.message) + '</div>'; return; }
      out.innerHTML = '<div class="muted">' + esc(f.name) + '</div>' + parseInfoHtml(info)
        + '<div class="row"><span class="pill pri">학생 ' + prev.students + '명</span>' + (prev.replaced ? '<span class="pill warn">기존 조사 덮어씀 ' + prev.replaced + '</span>' : '') + '<span class="pill">기준 확인 필요 ' + prev.check + ' (참고용이라 그대로 저장)</span></div>'
        + (prev.unknown.length ? '<div class="note warn">교육과정에 없는 과목: ' + esc(prev.unknown.join(', ')) + '</div>' : '')
        + (prev.ignoredSems.length ? '<div class="muted small">고르지 않은 학기라 건너뜀: ' + esc(prev.ignoredSems.join(', ')) + '</div>' : '')
        + unmatchedHtml(prev)
        + '<div class="row" style="justify-content:flex-end"><span class="hint" style="margin-right:auto">적용 전에 자동 백업합니다.</span><button class="btn pri" data-apply' + (prev.students ? '' : ' disabled') + '>적용</button></div>';
      const ab = out.querySelector('[data-apply]');
      ab.onclick = () => run(ab, async () => { const res = await api('surveyUploadApply', payload()); toast('참고조사 「' + res.name + '」에 학생 ' + res.students + '명을 올렸습니다.'); VIEWS.upload(v); });
    };

    v.querySelector('#u1f').onchange = async (e) => {
      const out = v.querySelector('#u1 [data-out]'), f = e.target.files[0]; e.target.value = '';
      if (!f) return;
      const r = rounds.find((x) => x.id === rSel.value);
      if (!r) { toast('신청 회차를 먼저 만들어 주세요.', true); return; }
      out.innerHTML = '<div class="empty">읽는 중…</div>';
      let info, prev;
      try {
        const { aoa } = await readAoa(f);
        info = parseSelection(aoa, await getCur(r.year), semSel.value ? [semSel.value] : r.sems);
        prev = await api('selUploadPreview', { roundId: r.id, rows: info.rows });
      } catch (err) { out.innerHTML = '<div class="note err">' + esc(err.message) + '</div>'; return; }
      out.innerHTML = '<div class="muted">' + esc(f.name) + '</div>' + parseInfoHtml(info)
        + '<div class="row"><span class="pill pri">학생 ' + prev.students + '명</span><span class="pill ok">바로 제출 ' + prev.ok + '</span><span class="pill err">확인 필요 ' + prev.check + '</span>' + (prev.replaced ? '<span class="pill warn">기존 신청 덮어씀 ' + prev.replaced + '</span>' : '') + '</div>'
        + (prev.unknown.length ? '<div class="note warn">학기에 개설되지 않은 과목: ' + esc(prev.unknown.join(', ')) + '</div>' : '')
        + (prev.ignoredSems.length ? '<div class="muted small">회차에 없는 학기라 건너뜀: ' + esc(prev.ignoredSems.join(', ')) + '</div>' : '')
        + (prev.samples.length ? '<details class="note warn"><summary>확인 필요 학생 (일부)</summary><div class="tbl-wrap" style="max-height:220px"><table class="tbl"><tbody>' + prev.samples.map((x) => '<tr><td>' + esc(x.학번) + '</td><td>' + esc(x.성명) + '</td><td class="small">' + esc(x.내용) + '</td></tr>').join('') + '</tbody></table></div></details>' : '')
        + unmatchedHtml(prev)
        + '<div class="row" style="justify-content:flex-end"><span class="hint" style="margin-right:auto">파일에 있는 학기만 바꾸고, 다른 학기 선택은 그대로 둡니다. 적용 전에 자동 백업합니다.</span><button class="btn pri" data-apply' + (prev.students ? '' : ' disabled') + '>적용</button></div>';
      const ab = out.querySelector('[data-apply]');
      ab.onclick = () => run(ab, async () => { const res = await api('selUploadApply', { roundId: r.id, rows: info.rows }); out.innerHTML = '<div class="note ok">적용했습니다. 학생 ' + res.students + '명 (제출 ' + res.ok + ' · 확인 필요 ' + res.check + ')</div>'; });
    };
    v.querySelector('#u2f').onchange = async (e) => {
      const out = v.querySelector('#u2 [data-out]'), f = e.target.files[0]; e.target.value = '';
      if (!f) return;
      const year = v.querySelector('#u2y').value, sem = v.querySelector('#u2s').value;
      out.innerHTML = '<div class="empty">읽는 중…</div>';
      let info, prev;
      try {
        const { aoa } = await readAoa(f);
        const cur = await getCur(year);
        if (!cur || !cur.subjects.length) throw new Error(year + ' 입학생 교육과정을 먼저 등록해 주세요.');
        info = parseSelection(aoa, cur, sem ? [sem] : R.SEMS);
        if (sem) info.rows.forEach((x) => { x.학기 = sem; });
        prev = await api('histUploadPreview', { rows: info.rows });
      } catch (err) { out.innerHTML = '<div class="note err">' + esc(err.message) + '</div>'; return; }
      out.innerHTML = '<div class="muted">' + esc(f.name) + '</div>' + parseInfoHtml(info)
        + '<div class="row"><span class="pill pri">학생 ' + prev.students + '명</span><span class="pill">과목 ' + prev.rows + '건</span></div>'
        + (prev.noArea.length ? '<div class="note warn">교과군을 알 수 없는 과목: ' + esc(prev.noArea.join(', ')) + ' — 교과군 학점 계산에서 빠집니다. 양식의 「교과군」 열에 넣어 다시 올리면 반영됩니다.</div>' : '')
        + unmatchedHtml(prev)
        + '<div class="row" style="justify-content:flex-end"><span class="hint" style="margin-right:auto">같은 학생·같은 학기의 기존 이력은 새 파일 내용으로 바뀝니다.</span><button class="btn pri" data-apply' + (prev.students ? '' : ' disabled') + '>적용</button></div>';
      const ab = out.querySelector('[data-apply]');
      ab.onclick = () => run(ab, async () => { const res = await api('histUploadApply', { rows: info.rows }); out.innerHTML = '<div class="note ok">적용했습니다. 학생 ' + res.students + '명 · ' + res.rows + '건</div>'; });
    };
  };

  A.SEL = { parseSelection, planEditor, readAoa, writeBook, semShort, cohortLabel, curGrade, exportRound };
})();
