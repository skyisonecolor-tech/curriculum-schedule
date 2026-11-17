/* 일과 알리미 — 3단계: 블록 편성 · 교실 배치 · 출력 · 교원소요 */
(function () {
  'use strict';
  const A = window.APP, R = window.RULES, BK = window.BLOCK;
  if (!A || !R || !BK || !A.SEL) return;
  const { api, esc, toast, run, modal, saveBlob } = A;
  const VIEWS = A.VIEWS, SEL = A.SEL;
  const semShort = SEL.semShort;
  const loading = (v) => { v.innerHTML = '<div class="card"><div class="empty">불러오는 중…</div></div>'; };
  const failed = (v, e) => { v.innerHTML = '<div class="note err">' + esc(e.message) + '</div>'; };
  const PALETTE = ['#1D4ED8', '#047857', '#B45309', '#7C3AED', '#BE185D', '#0E7490', '#C2410C', '#4D7C0F', '#9333EA', '#0F766E', '#A16207', '#475569'];
  function colorOf(k) { let h = 0; for (const ch of String(k || '')) h = (h * 31 + ch.charCodeAt(0)) >>> 0; return PALETTE[h % PALETTE.length]; }
  const fileSafe = (s) => String(s).replace(/[\\/:*?"<>|]/g, '').trim();

  /* ---------- ZIP (압축 없이 묶기) ---------- */
  const CRC = (() => { const t = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })();
  function crc32(u8) { let c = 0xFFFFFFFF; for (let i = 0; i < u8.length; i++) c = CRC[(c ^ u8[i]) & 0xFF] ^ (c >>> 8); return (c ^ 0xFFFFFFFF) >>> 0; }
  function makeZip(files) {
    const enc = new TextEncoder(), parts = [], central = [];
    let offset = 0;
    files.forEach((f) => {
      const name = enc.encode(f.name), data = f.data, crc = crc32(data);
      const lh = new DataView(new ArrayBuffer(30));
      [[0, 0x04034b50, 4], [4, 20, 2], [6, 0x0800, 2], [8, 0, 2], [10, 0, 2], [12, 0x21, 2], [14, crc, 4], [18, data.length, 4], [22, data.length, 4], [26, name.length, 2], [28, 0, 2]]
        .forEach(([o, v, n]) => (n === 4 ? lh.setUint32(o, v, true) : lh.setUint16(o, v, true)));
      parts.push(new Uint8Array(lh.buffer), name, data);
      const ch = new DataView(new ArrayBuffer(46));
      [[0, 0x02014b50, 4], [4, 20, 2], [6, 20, 2], [8, 0x0800, 2], [10, 0, 2], [12, 0, 2], [14, 0x21, 2], [16, crc, 4], [20, data.length, 4], [24, data.length, 4], [28, name.length, 2],
        [30, 0, 2], [32, 0, 2], [34, 0, 2], [36, 0, 2], [38, 0, 4], [42, offset, 4]].forEach(([o, v, n]) => (n === 4 ? ch.setUint32(o, v, true) : ch.setUint16(o, v, true)));
      central.push(new Uint8Array(ch.buffer), name);
      offset += 30 + name.length + data.length;
    });
    const cSize = central.reduce((a, x) => a + x.length, 0);
    const end = new DataView(new ArrayBuffer(22));
    end.setUint32(0, 0x06054b50, true); end.setUint16(8, files.length, true); end.setUint16(10, files.length, true); end.setUint32(12, cSize, true); end.setUint32(16, offset, true);
    return new Blob(parts.concat(central, [new Uint8Array(end.buffer)]), { type: 'application/zip' });
  }
  function bookBytes(sheets) {
    const wb = window.XLSX.utils.book_new();
    sheets.forEach((sh) => { const ws = window.XLSX.utils.aoa_to_sheet(sh.aoa); ws['!cols'] = (sh.cols || sh.aoa[0].map(() => 12)).map((w) => ({ wch: w })); window.XLSX.utils.book_append_sheet(wb, ws, sh.name); });
    return new Uint8Array(window.XLSX.write(wb, { type: 'array', bookType: 'xlsx' }));
  }
  const xlsxBlob = (u8) => new Blob([u8], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });

  /* ---------- 작업자 실행 ---------- */
  function runWorker(msg, onProgress) {
    return new Promise((resolve, reject) => {
      let w;
      try { w = new Worker('block-worker.js'); } catch (e) { // 작업자를 못 쓰는 환경: 화면에서 바로 계산
        setTimeout(() => { try { resolve(msg.mode === 'assign' ? BK.assignOnly(msg.input, msg.layout) : BK.solve(msg.input, msg.opts)); } catch (err) { reject(err); } }, 30);
        return;
      }
      w.onmessage = (e) => {
        if (e.data.progress) { if (onProgress) onProgress(e.data.progress); return; }
        w.terminate();
        if (e.data.error) reject(new Error(e.data.error)); else resolve(e.data.result);
      };
      w.onerror = (e) => { w.terminate(); reject(new Error(e.message || '계산 중 오류가 났습니다.')); };
      w.postMessage(msg);
    });
  }

  /* =========================================================
     블록 편성
     ========================================================= */
  let BS = null; // 화면 상태 (메뉴를 옮겨도 유지)
  const STATUS_INCLUDE = ['제출', '임시', '확인필요'];

  VIEWS.blocks = async function (v) {
    loading(v);
    let rounds, plans;
    try { [rounds, plans] = await Promise.all([api('selRounds', {}), api('blockList', {})]); } catch (e) { failed(v, e); return; }
    if (!rounds.length) { v.innerHTML = '<div class="card"><h2>블록 편성</h2><div class="empty">먼저 [신청 회차]를 만들고 학생 신청을 받아 주세요.</div></div>'; return; }
    const ui = A.ui;
    if (!ui.bkRound || !rounds.some((r) => r.id === ui.bkRound)) ui.bkRound = rounds[0].id;
    const rd = rounds.find((r) => r.id === ui.bkRound);
    if (!ui.bkSem || !rd.sems.includes(ui.bkSem)) ui.bkSem = rd.sems[0];
    const year = ui.bkYear || String((Number(ui.year) || new Date().getFullYear()) + 1);
    v.innerHTML = '<div class="card tight"><div class="row"><h2>블록 편성</h2>'
      + '<select id="bkr" class="input sm" aria-label="신청 회차">' + rounds.map((r) => '<option value="' + esc(r.id) + '"' + (r.id === ui.bkRound ? ' selected' : '') + '>' + esc(r.name) + '</option>').join('') + '</select>'
      + '<select id="bks" class="input sm" aria-label="학기">' + rd.sems.map((s) => '<option value="' + s + '"' + (s === ui.bkSem ? ' selected' : '') + '>' + semShort(s) + '</option>').join('') + '</select>'
      + '<label class="row small">편성 학년도 <input id="bky" class="input sm w4" inputmode="numeric" value="' + esc(year) + '"></label>'
      + '<span style="margin-left:auto"></span>' + (plans.length ? '<span class="muted small">저장된 편성: ' + plans.map((p) => esc(semShort(p.sem)) + (p.status === '확정' ? '(확정)' : '')).join(', ') + '</span>' : '') + '</div></div><div id="bkbody"></div>';
    const reload = () => { ui.bkRound = v.querySelector('#bkr').value; const r2 = rounds.find((r) => r.id === ui.bkRound); if (!r2.sems.includes(v.querySelector('#bks').value)) ui.bkSem = r2.sems[0]; else ui.bkSem = v.querySelector('#bks').value; ui.bkYear = v.querySelector('#bky').value; BS = null; VIEWS.blocks(v); };
    v.querySelector('#bkr').onchange = reload; v.querySelector('#bks').onchange = reload; v.querySelector('#bky').onchange = reload;
    const body = v.querySelector('#bkbody');
    if (!BS || BS.roundId !== ui.bkRound || BS.sem !== ui.bkSem) {
      loading(body);
      let d;
      try { d = await api('blockData', { roundId: ui.bkRound, sem: ui.bkSem, year }); } catch (e) { failed(body, e); return; }
      BS = initState(d, year);
    }
    draw(body);
  };

  function initState(d, year) {
    const st = { d, roundId: d.round.id, sem: d.sem, year: (d.plan && d.plan.year) || year, tab: 'set', result: null, dirty: false, status: d.plan ? d.plan.status : '',
      neis: { 과정: '주간', 계열: '일반계', 학과: '일반학과' } };
    const set = d.plan ? d.plan.settings || {} : {};
    const tcount = {};
    d.teachers.forEach((t) => { if (t.subject) tcount[t.subject] = (tcount[t.subject] || 0) + 1; });
    st.include = set.include || STATUS_INCLUDE.slice();
    st.subjects = d.subjects.filter((o) => o.구분 === '선택').map((o) => {
      const prev = (set.subjects || {})[o.과목] || {};
      return { name: o.과목, credit: Number(o.학점), group: prev.group != null ? prev.group : (o.정원과목 || ''), min: prev.min != null ? prev.min : 10, max: prev.max != null ? prev.max : 35, sections: prev.sections || '' };
    });
    const groups = Array.from(new Set(st.subjects.map((s) => s.group).filter(Boolean)));
    st.caps = {};
    groups.forEach((g) => { st.caps[g] = set.caps && set.caps[g] != null ? set.caps[g] : (tcount[g] || ''); });
    st.tcount = tcount;
    const defRooms = d.classes.rooms.length ? d.classes.rooms : Array.from({ length: d.classes.count || 0 }, (_, i) => String(Number(d.grade) * 100 + i + 1));
    st.rooms = set.rooms || defRooms;
    if (d.plan && d.plan.sections.length) {
      st.result = { blocks: set.blocks || deriveBlocks(d.plan.sections), sections: d.plan.sections.map((x) => Object.assign({}, x)), issues: set.lastIssues || [] };
    }
    if (set.neis) st.neis = set.neis;
    return st;
  }
  function deriveBlocks(sections) {
    const m = {}; sections.forEach((s) => { m[s.block] = s.credit; });
    return Object.keys(m).sort().map((id) => ({ id, credit: m[id] }));
  }
  function included() { return BS.d.students.filter((s) => s.picks.length && BS.include.includes(s.selStatus)); }
  function counts() { const c = {}; included().forEach((s) => s.picks.forEach((p) => { c[p] = (c[p] || 0) + 1; })); return c; }
  function engineInput() {
    const caps = {}; Object.keys(BS.caps).forEach((g) => { if (Number(BS.caps[g]) > 0) caps[g] = Number(BS.caps[g]); });
    return {
      subjects: BS.subjects.map((s) => ({ name: s.name, credit: s.credit, group: s.group, min: Number(s.min) || 0, max: Number(s.max) || 35, sections: Number(s.sections) || 0 })),
      students: included().map((s) => ({ id: s.id, cls: s.classNo, no: s.number, picks: s.picks })),
      roomCount: BS.rooms.length, rooms: BS.rooms, teacherCap: caps,
      blocks: BS.result ? BS.result.blocks : null,
    };
  }
  const stuById = () => { const m = {}; BS.d.students.forEach((s) => { m[s.id] = s; }); return m; };
  const teacherName = (id) => { const t = BS.d.teachers.find((x) => x.id === id); return t ? t.name : ''; };

  /** 지금 상태 점검 (손으로 고친 뒤에도) */
  function check() {
    const out = [];
    if (!BS.result) return out;
    const secs = BS.result.sections, rooms = BS.rooms;
    BS.result.blocks.forEach((b) => {
      const inB = secs.filter((s) => s.block === b.id);
      if (inB.length > rooms.length) out.push({ level: 'error', text: b.id + ' 블록 분반 ' + inB.length + '개 > 교실 ' + rooms.length + '개' });
      const rm = {}, tc = {}, gc = {};
      inB.forEach((s) => {
        if (s.room) { if (rm[s.room]) out.push({ level: 'error', text: b.id + ' 블록에서 ' + s.room + ' 교실을 두 분반이 씁니다.' }); rm[s.room] = 1; }
        if (s.teacherId) { if (tc[s.teacherId]) out.push({ level: 'error', text: b.id + ' 블록에서 ' + teacherName(s.teacherId) + ' 선생님이 두 분반을 맡습니다.' }); tc[s.teacherId] = 1; }
        if (s.group) gc[s.group] = (gc[s.group] || 0) + 1;
      });
      Object.keys(gc).forEach((g) => { const cap = Number(BS.caps[g]); if (cap > 0 && gc[g] > cap) out.push({ level: 'error', text: b.id + ' 블록 ' + g + ' 분반 ' + gc[g] + '개 > 교사 ' + cap + '명' }); });
    });
    secs.forEach((s) => {
      const n = s.students.length;
      if (s.max && n > s.max) out.push({ level: 'error', text: s.subject + ' ' + s.label + ' ' + n + '명 (최대 ' + s.max + ')' });
      else if (s.min && n < s.min) out.push({ level: 'warn', text: s.subject + ' ' + s.label + ' ' + n + '명 (최소 ' + s.min + ')' });
    });
    const noRoom = secs.filter((s) => !s.room).length;
    if (noRoom) out.push({ level: 'warn', text: '교실이 정해지지 않은 분반 ' + noRoom + '개' });
    const where = {};
    secs.forEach((s) => s.students.forEach((id) => { (where[id] = where[id] || []).push(s); }));
    let missing = 0, clash = 0;
    included().forEach((st) => {
      const w = where[st.id] || [];
      if (st.picks.some((p) => !w.some((x) => x.subject === p))) missing++;
      if (new Set(w.map((x) => x.block)).size !== w.length) clash++;
    });
    if (missing) out.push({ level: 'error', text: '과목이 배정되지 않은 학생 ' + missing + '명 (학생별 확인 탭)' });
    if (clash) out.push({ level: 'error', text: '한 블록에 두 과목이 겹친 학생 ' + clash + '명' });
    return out;
  }

  function draw(body) {
    const tabs = [['set', '1. 설정'], ['grid', '2. 편성·교실'], ['stu', '3. 학생별 확인'], ['out', '4. 출력']];
    const inc = included().length, total = BS.d.students.length;
    const st = BS.status ? '<span class="pill ' + (BS.status === '확정' ? 'ok' : 'warn') + '">' + esc(BS.status) + '</span>' : '<span class="pill">저장 전</span>';
    body.innerHTML = '<div class="row"><div class="seg3" role="tablist">' + tabs.map((t) => '<button type="button" data-bt="' + t[0] + '" class="' + (BS.tab === t[0] ? 'on' : '') + '">' + t[1] + '</button>').join('') + '</div>'
      + '<span class="muted">' + esc(BS.year) + '학년도 ' + esc(semShort(BS.sem)) + ' · 대상 ' + inc + '명 / ' + total + '명</span>' + st + (BS.dirty ? '<span class="pill warn">저장 안 됨</span>' : '')
      + '<span style="margin-left:auto"></span>' + (BS.result ? '<button class="btn sm" id="bsave">저장</button><button class="btn sm pri" id="bfix">' + (BS.status === '확정' ? '확정 유지 저장' : '확정') + '</button>' : '') + '</div><div id="btab"></div>';
    body.querySelectorAll('[data-bt]').forEach((b) => { b.onclick = () => { BS.tab = b.dataset.bt; draw(body); }; });
    const save = (status, btn) => run(btn, async () => {
      const set = { include: BS.include, rooms: BS.rooms, caps: BS.caps, blocks: BS.result.blocks, neis: BS.neis, lastIssues: (BS.result.issues || []).slice(0, 30),
        subjects: Object.fromEntries(BS.subjects.map((s) => [s.name, { group: s.group, min: s.min, max: s.max, sections: s.sections }])) };
      const r = await api('blockSave', { roundId: BS.roundId, sem: BS.sem, year: BS.year, name: BS.d.round.name + ' ' + semShort(BS.sem), settings: set, sections: BS.result.sections, status });
      BS.status = r.status; BS.dirty = false; toast(status === '확정' ? '확정해 저장했습니다.' : '저장했습니다.'); draw(body);
    });
    const sb = body.querySelector('#bsave'); if (sb) sb.onclick = () => save(BS.status === '확정' ? '확정' : '작업 중', sb);
    const fb = body.querySelector('#bfix'); if (fb) fb.onclick = () => {
      const errs = check().filter((x) => x.level === 'error');
      if (errs.length && !confirm('아직 오류 ' + errs.length + '건이 있습니다. 그래도 확정할까요?')) return;
      save('확정', fb);
    };
    const t = body.querySelector('#btab');
    ({ set: drawSet, grid: drawGrid, stu: drawStu, out: drawOut })[BS.tab](t, body);
  }

  /* ---------- 1. 설정 ---------- */
  function drawSet(t, body) {
    const c = counts();
    const groups = Array.from(new Set(BS.subjects.map((s) => s.group).filter(Boolean)));
    groups.forEach((g) => { if (!(g in BS.caps)) BS.caps[g] = BS.tcount[g] || ''; });
    const byCredit = {};
    included().forEach((s) => { const m = {}; s.picks.forEach((p) => { const o = BS.subjects.find((x) => x.name === p); if (o) m[o.credit] = (m[o.credit] || 0) + 1; }); Object.keys(m).forEach((k) => { byCredit[k] = Math.max(byCredit[k] || 0, m[k]); }); });
    const autoSec = (s) => Math.max(c[s.name] ? 1 : 0, Math.ceil((c[s.name] || 0) / (Number(s.max) || 35)));
    const totalSec = {};
    BS.subjects.forEach((s) => { totalSec[s.credit] = (totalSec[s.credit] || 0) + (Number(s.sections) || autoSec(s)); });
    const stCount = {}; BS.d.students.forEach((s) => { const k = s.picks.length ? s.selStatus : '선택 없음'; stCount[k] = (stCount[k] || 0) + 1; });
    t.innerHTML = '<div class="grid-blk">'
      + '<div class="card tight"><h3>대상 학생</h3><div class="row">' + STATUS_INCLUDE.map((k) => '<label class="ck"><input type="checkbox" data-inc="' + k + '"' + (BS.include.includes(k) ? ' checked' : '') + '> ' + (k === '확인필요' ? '확인 필요' : k === '임시' ? '임시 저장' : '제출 완료') + ' ' + (stCount[k] || 0) + '명</label>').join('')
      + '</div><p class="hint">이 학기 선택이 없는 학생 ' + ((stCount['선택 없음'] || 0)) + '명은 빠집니다.</p>'
      + '<h3>블록</h3><div class="row">' + Object.keys(byCredit).sort((a, b) => b - a).map((k) => '<span class="pill pri">' + k + '학점 블록 ' + byCredit[k] + '개</span><span class="muted small">분반 ' + (totalSec[k] || 0) + '개 / 자리 ' + byCredit[k] * BS.rooms.length + '</span>').join(' ') + '</div>'
      + '<p class="hint">학생마다 그 학점 과목을 고른 수만큼 블록을 만듭니다. 블록마다 열 수 있는 분반은 교실 수까지입니다.</p>'
      + '<h3>교실 (' + BS.rooms.length + '개)</h3><textarea id="brooms" class="input" rows="2">' + esc(BS.rooms.join(', ')) + '</textarea>'
      + '<p class="hint">기본값은 [관리 → 학급 설정]의 ' + esc(BS.d.grade) + '학년 교실입니다. 특별실을 쓰려면 쉼표로 더 넣으세요. (예: 과학실1, 음악실)</p>'
      + '<h3>동시에 수업할 수 있는 교사 수 (정원과목별)</h3><table class="mini edit"><thead><tr><th>정원과목</th><th>교사 계정</th><th>동시 가능</th></tr></thead><tbody>'
      + groups.map((g) => '<tr><td>' + esc(g) + '</td><td class="num">' + (BS.tcount[g] || 0) + '</td><td><input class="input sm w4" data-cap="' + esc(g) + '" inputmode="numeric" value="' + esc(BS.caps[g]) + '" placeholder="제한 없음"></td></tr>').join('')
      + '</tbody></table><p class="hint">한 블록 안에서 같은 정원과목 분반이 이 수를 넘지 않게 합니다. 비우면 제한하지 않습니다. 교사 계정의 「교과」를 정원과목 이름으로 넣어 두면 자동으로 셉니다.</p></div>'
      + '<div class="card tight"><div class="row"><h3>과목별 분반 기준</h3><span style="margin-left:auto"></span><label class="row small">모두 최소 <input id="ballmin" class="input sm w4" value="10"></label><label class="row small">최대 <input id="ballmax" class="input sm w4" value="35"></label><button class="btn sm" id="ball">적용</button></div>'
      + '<div class="tbl-wrap"><table class="tbl edit"><thead><tr><th>과목</th><th>학점</th><th>신청</th><th>정원과목</th><th>최소</th><th>최대</th><th>분반 수</th></tr></thead><tbody>'
      + BS.subjects.map((s, i) => '<tr' + (c[s.name] ? '' : ' class="dim"') + '><td>' + esc(s.name) + '</td><td class="num">' + s.credit + '</td><td class="num"><b>' + (c[s.name] || 0) + '</b></td>'
        + '<td><input class="input sm w8" list="teachl2" data-sj="' + i + '" data-k="group" value="' + esc(s.group) + '"></td>'
        + '<td><input class="input sm w4" data-sj="' + i + '" data-k="min" inputmode="numeric" value="' + esc(s.min) + '"></td><td><input class="input sm w4" data-sj="' + i + '" data-k="max" inputmode="numeric" value="' + esc(s.max) + '"></td>'
        + '<td><input class="input sm w4" data-sj="' + i + '" data-k="sections" inputmode="numeric" value="' + esc(s.sections) + '" placeholder="' + autoSec(s) + '"></td></tr>').join('')
      + '</tbody></table></div><datalist id="teachl2">' + (BS.d.teachList || []).map((x) => '<option value="' + esc(x) + '">').join('') + '</datalist>'
      + '<p class="hint">분반 수를 비우면 신청 인원 ÷ 최대 인원으로 정합니다. 학생을 모두 배정하기 어려우면 빈 교실에 분반을 스스로 더 엽니다.</p>'
      + '<div class="row" style="justify-content:flex-end"><span class="muted small" id="bprog"></span><button class="btn pri" id="bsolve">' + (BS.result ? '다시 자동 편성' : '자동 편성') + '</button></div></div></div>';
    const later = (fn) => setTimeout(fn, 0);
    t.querySelectorAll('[data-inc]').forEach((el) => { el.onchange = () => { BS.include = STATUS_INCLUDE.filter((k) => t.querySelector('[data-inc="' + k + '"]').checked); BS.dirty = true; later(() => draw(body)); }; });
    t.querySelector('#brooms').onchange = (e) => { BS.rooms = e.target.value.split(/[,\n]+/).map((x) => x.trim()).filter(Boolean); BS.dirty = true; later(() => drawSet(t, body)); };
    t.querySelectorAll('[data-cap]').forEach((el) => { el.onchange = () => { BS.caps[el.dataset.cap] = el.value.trim(); BS.dirty = true; }; });
    t.querySelectorAll('[data-sj]').forEach((el) => { el.onchange = () => { BS.subjects[Number(el.dataset.sj)][el.dataset.k] = el.value.trim(); BS.dirty = true; if (el.dataset.k !== 'group') later(() => drawSet(t, body)); }; });
    t.querySelector('#ball').onclick = () => { const mn = t.querySelector('#ballmin').value, mx = t.querySelector('#ballmax').value; BS.subjects.forEach((s) => { s.min = mn; s.max = mx; }); BS.dirty = true; drawSet(t, body); };
    const sv = t.querySelector('#bsolve');
    sv.onclick = () => {
      if (!included().length) { toast('대상 학생이 없습니다.', true); return; }
      if (!BS.rooms.length) { toast('교실을 넣어 주세요.', true); return; }
      if (BS.result && !confirm('지금 편성(교실·교사 포함)을 새로 만든 편성으로 바꿀까요?')) return;
      const prog = t.querySelector('#bprog');
      run(sv, async () => {
        prog.textContent = '계산 중…';
        const inp = engineInput(); inp.blocks = null;
        const r = await runWorker({ mode: 'solve', input: inp, opts: { iters: 4000, timeLimit: 25000 } }, (p) => { prog.textContent = (p.stage ? p.stage + ' · ' : '') + Math.round(100 * p.it / p.iters) + '%'; });
        BK.assignRooms(r.sections, BS.rooms, false);
        BS.result = r; BS.dirty = true; BS.tab = 'grid';
        toast(r.ok ? '편성했습니다.' : '편성했지만 확인할 문제가 있습니다.', !r.ok);
        draw(body);
      });
    };
  }

  /* ---------- 2. 편성·교실 ---------- */
  function drawGrid(t, body) {
    if (!BS.result) { t.innerHTML = '<div class="card"><div class="empty">[1. 설정]에서 자동 편성을 먼저 해 주세요.</div></div>'; return; }
    const res = BS.result, rooms = BS.rooms.slice();
    const extraRooms = Array.from(new Set(res.sections.map((s) => s.room).filter((r) => r && !rooms.includes(r))));
    const cols = rooms.concat(extraRooms);
    const hasNone = res.sections.some((s) => !s.room);
    const issues = (res.issues || []).filter((x) => x.level === 'info').concat(check());
    const sizes = res.sections.map((s) => s.students.length);
    t.innerHTML = '<div class="card tight"><div class="row"><h3>점검</h3>' + (issues.some((x) => x.level === 'error') ? '' : '<span class="pill ok">오류 없음</span>')
      + '<span class="muted small">분반 ' + res.sections.length + '개 · 인원 ' + (sizes.length ? Math.min(...sizes) + '~' + Math.max(...sizes) : '-') + '명</span><span style="margin-left:auto"></span>'
      + '<button class="btn sm" id="brm">교실 다시 배치</button><button class="btn sm" id="btc">교사 자동 배정</button><button class="btn sm" id="bre">학생 다시 배정</button></div>'
      + (issues.length ? '<ul class="msgs">' + issues.map((x) => '<li class="' + (x.level === 'info' ? 'tip' : x.level) + '">' + esc(x.text) + '</li>').join('') + '</ul>' : '') + '</div>'
      + '<div class="card tight"><div class="tbl-wrap bgrid-wrap"><table class="bgrid"><thead><tr><th>블록</th>' + cols.map((r) => '<th>' + esc(r) + (extraRooms.includes(r) ? ' <span class="no">?</span>' : '') + '</th>').join('') + (hasNone ? '<th>교실 미정</th>' : '') + '</tr></thead><tbody>'
      + res.blocks.map((b) => {
        const inB = res.sections.map((s, i) => [s, i]).filter((x) => x[0].block === b.id);
        const cell = (list) => list.map(([s, i]) => '<button type="button" class="sec" data-sec="' + i + '" style="border-left-color:' + colorOf(s.group || s.subject) + '"><b>' + esc(s.subject) + '</b><small>' + esc(s.label) + ' · ' + s.students.length + '명' + (s.teacherId ? ' · ' + esc(teacherName(s.teacherId)) : '') + '</small></button>').join('');
        return '<tr><th><b>' + esc(b.id) + '</b><br><span class="muted small">' + b.credit + '학점 · ' + inB.length + '반</span></th>'
          + cols.map((r) => '<td>' + cell(inB.filter((x) => x[0].room === r)) + '</td>').join('') + (hasNone ? '<td>' + cell(inB.filter((x) => !x[0].room)) + '</td>' : '') + '</tr>';
      }).join('') + '</tbody></table></div><p class="hint">분반을 누르면 블록·교실·교사를 바꿀 수 있습니다. 블록을 옮기면 학생을 다시 배정합니다. 같은 색은 같은 정원과목입니다.</p></div>';
    t.querySelector('#brm').onclick = () => { BK.assignRooms(res.sections, BS.rooms, false); BS.dirty = true; draw(body); };
    t.querySelector('#btc').onclick = () => {
      const by = {}; BS.d.teachers.forEach((x) => { if (x.subject) (by[x.subject] = by[x.subject] || []).push(x); });
      const before = res.sections.filter((s) => s.teacherId).length;
      BK.assignTeachers(res.sections, by, before > 0 && confirm('이미 정한 교사는 그대로 두고 빈 분반만 채울까요? (취소하면 모두 새로 배정)'));
      BS.dirty = true; draw(body);
      const none = res.sections.filter((s) => !s.teacherId).length;
      toast(none ? '교사를 정하지 못한 분반 ' + none + '개 (그 정원과목 교사 계정이 없거나 부족)' : '교사를 배정했습니다.', !!none);
    };
    const reb = t.querySelector('#bre'); reb.onclick = () => reassign(reb, body);
    t.querySelectorAll('[data-sec]').forEach((b) => { b.onclick = () => editSection(Number(b.dataset.sec), body); });
  }
  function reassign(btn, body) {
    return run(btn, async () => {
      const res = BS.result;
      const old = res.sections;
      const r = await runWorker({ mode: 'assign', input: engineInput(), layout: old.map((s) => ({ subject: s.subject, block: s.block })) });
      // 교실·교사는 같은 과목·블록·순서끼리 이어받기
      const key = (s) => s.subject + '|' + s.block + '|' + s.no;
      const prev = {}; old.forEach((s) => { prev[key(s)] = s; });
      r.sections.forEach((s) => { const p = prev[key(s)]; if (p) { s.room = p.room; s.teacherId = p.teacherId; } });
      BK.assignRooms(r.sections, BS.rooms, true);
      r.blocks = res.blocks;
      BS.result = r; BS.dirty = true;
      toast(r.unassigned.length ? '배정하지 못한 학생 ' + r.unassigned.length + '명이 있습니다.' : '학생을 다시 배정했습니다.', !!r.unassigned.length);
      draw(body);
    });
  }
  function editSection(i, body) {
    const res = BS.result, s = res.sections[i];
    const blocks = res.blocks.filter((b) => b.credit === s.credit);
    const usedRooms = {}; res.sections.forEach((x, k) => { if (k !== i && x.block === s.block && x.room) usedRooms[x.room] = x; });
    const ts = BS.d.teachers.slice().sort((a, b) => (b.subject === s.group) - (a.subject === s.group) || (a.name < b.name ? -1 : 1));
    const busy = {}; res.sections.forEach((x, k) => { if (k !== i && x.block === s.block && x.teacherId) busy[x.teacherId] = 1; });
    const sm = stuById();
    modal('<h2>' + esc(s.subject) + ' ' + esc(s.label) + '</h2><p class="muted">' + s.credit + '학점 · ' + s.students.length + '명 · 정원과목 ' + esc(s.group || '-') + '</p>'
      + '<div class="grid2 tight2"><div class="field"><label for="es1">블록</label><select id="es1" class="input">' + blocks.map((b) => '<option' + (b.id === s.block ? ' selected' : '') + '>' + esc(b.id) + '</option>').join('') + '</select></div>'
      + '<div class="field"><label for="es2">교실</label><select id="es2" class="input"><option value="">(미정)</option>' + BS.rooms.map((r) => '<option value="' + esc(r) + '"' + (r === s.room ? ' selected' : '') + '>' + esc(r) + (usedRooms[r] ? ' — ' + esc(usedRooms[r].subject) + ' ' + esc(usedRooms[r].label) + '와 바꾸기' : '') + '</option>').join('') + '</select></div></div>'
      + '<div class="field"><label for="es3">교사</label><select id="es3" class="input"><option value="">(미정)</option>' + ts.map((x) => '<option value="' + esc(x.id) + '"' + (x.id === s.teacherId ? ' selected' : '') + (busy[x.id] ? ' disabled' : '') + '>' + esc(x.name) + (x.subject ? ' · ' + esc(x.subject) : '') + (busy[x.id] ? ' (이 블록 수업 있음)' : '') + '</option>').join('') + '</select></div>'
      + '<details><summary>학생 ' + s.students.length + '명</summary><div class="small">' + s.students.map((id) => sm[id] ? esc(sm[id].grade + '-' + sm[id].classNo + ' ' + sm[id].name) : esc(id)).join(', ') + '</div></details>'
      + '<p class="hint">블록을 바꾸면 이 과목을 고른 학생들이 다시 배정됩니다.</p>'
      + '<div class="row" style="justify-content:flex-end"><button class="btn" id="esadd">같은 블록에 이 과목 분반 추가</button><span style="flex:1"></span><button class="btn" data-close>취소</button><button class="btn pri" id="esok">적용</button></div>', (bg, close) => {
      bg.querySelector('#esadd').onclick = () => {
        res.sections.push({ subject: s.subject, credit: s.credit, group: s.group, block: s.block, no: 99, label: s.block, students: [], min: s.min, max: s.max, room: '', teacherId: '' });
        close(); reassign(null, body);
      };
      bg.querySelector('#esok').onclick = () => {
        const nb = bg.querySelector('#es1').value, nr = bg.querySelector('#es2').value, nt = bg.querySelector('#es3').value;
        s.teacherId = nt;
        if (nr !== s.room) { const other = usedRooms[nr]; if (other) other.room = s.room; s.room = nr; }
        BS.dirty = true; close();
        if (nb !== s.block) { s.block = nb; s.room = ''; reassign(null, body); } else draw(body);
      };
    });
  }

  /* ---------- 3. 학생별 확인 ---------- */
  function drawStu(t) {
    if (!BS.result) { t.innerHTML = '<div class="card"><div class="empty">편성 뒤에 볼 수 있습니다.</div></div>'; return; }
    const res = BS.result, where = {};
    res.sections.forEach((s) => s.students.forEach((id) => { (where[id] = where[id] || {})[s.block] = s; }));
    const list = included().slice().sort((a, b) => Number(a.classNo) - Number(b.classNo) || Number(a.number) - Number(b.number));
    const bad = (s) => { const w = where[s.id] || {}; const got = Object.values(w).map((x) => x.subject); return s.picks.some((p) => !got.includes(p)); };
    const ui = A.ui;
    const classes = Array.from(new Set(list.map((s) => s.classNo))).sort((a, b) => a - b);
    t.innerHTML = '<div class="card tight"><div class="row"><input id="bsq" class="input sm" placeholder="이름·학번 찾기" value="' + esc(ui.bsq || '') + '"><select id="bsc" class="input sm"><option value="">모든 반</option><option value="bad"' + (ui.bsc === 'bad' ? ' selected' : '') + '>문제 있는 학생</option>'
      + classes.map((c) => '<option value="' + esc(c) + '"' + (String(ui.bsc) === String(c) ? ' selected' : '') + '>' + esc(c) + '반</option>').join('') + '</select><span class="muted small" id="bsn"></span></div>'
      + '<div class="tbl-wrap"><table class="tbl"><thead><tr><th>반</th><th>번호</th><th>이름</th>' + res.blocks.map((b) => '<th>' + esc(b.id) + '</th>').join('') + '<th></th></tr></thead><tbody id="bstb"></tbody></table></div></div>';
    const fill = () => {
      const q = t.querySelector('#bsq').value.trim(), c = t.querySelector('#bsc').value;
      ui.bsq = q; ui.bsc = c;
      const rows = list.filter((s) => (!q || s.name.includes(q) || String(s.studentNo).includes(q)) && (!c || (c === 'bad' ? bad(s) : String(s.classNo) === c)));
      t.querySelector('#bsn').textContent = rows.length + '명';
      t.querySelector('#bstb').innerHTML = rows.slice(0, 400).map((s) => {
        const w = where[s.id] || {}, b0 = bad(s);
        return '<tr' + (b0 ? ' class="badrow"' : '') + '><td>' + esc(s.classNo) + '</td><td>' + esc(s.number) + '</td><td>' + esc(s.name) + '</td>'
          + res.blocks.map((b) => '<td class="small">' + (w[b.id] ? esc(w[b.id].subject) + ' <span class="muted">' + esc(w[b.id].label) + (w[b.id].room ? ' · ' + esc(w[b.id].room) : '') + '</span>' : '') + '</td>').join('')
          + '<td class="small">' + (b0 ? '<span class="no">미배정: ' + esc(s.picks.filter((p) => !Object.values(w).some((x) => x.subject === p)).join(', ')) + '</span>' : '') + '</td></tr>';
      }).join('');
    };
    t.querySelector('#bsq').oninput = fill; t.querySelector('#bsc').onchange = fill; fill();
  }

  /* ---------- 4. 출력 ---------- */
  function drawOut(t) {
    if (!BS.result) { t.innerHTML = '<div class="card"><div class="empty">편성 뒤에 내려받을 수 있습니다.</div></div>'; return; }
    t.innerHTML = '<div class="grid2">'
      + '<div class="card tight"><h3>교육과정편성 (응시현황 생성기용)</h3><p class="hint">학생마다 고른 과목 칸에 블록·분반(A1, B, C2 …)을 적은 배정내역 파일입니다. 응시현황 생성기에 그대로 넣을 수 있습니다.</p><div class="row"><button class="btn" id="o1">내려받기</button></div></div>'
      + '<div class="card tight"><h3>분반별 수강생 명렬 (ZIP)</h3><p class="hint">분반마다 나이스 양식(학년도·과정·계열·학년·학과·반·번호·성명) 엑셀 1개씩, 압축 파일 하나로 받습니다. 반·번호는 지금 명렬 기준이며, 학년도 전환 뒤 다시 받으면 새 반·번호로 나옵니다.</p>'
      + '<div class="row">' + ['과정', '계열', '학과'].map((k) => '<label class="row small">' + k + ' <input class="input sm w8" data-neis="' + k + '" value="' + esc(BS.neis[k]) + '"></label>').join('') + '</div><div class="row"><button class="btn" id="o2">ZIP 내려받기</button></div></div>'
      + '<div class="card tight"><h3>블록·교실 배치표</h3><p class="hint">블록 × 교실 표와 분반 목록(교사·인원)입니다.</p><div class="row"><button class="btn" id="o3">내려받기</button></div></div>'
      + '<div class="card tight"><h3>교육과정 통계</h3><p class="hint">이 회차의 모든 학기 신청을 학생 × 과목 표로 정리하고, 맨 위에 과목별 합계를 붙입니다.</p><div class="row"><button class="btn" id="o4">내려받기</button></div></div></div>';
    t.querySelectorAll('[data-neis]').forEach((el) => { el.onchange = () => { BS.neis[el.dataset.neis] = el.value.trim(); BS.dirty = true; }; });
    t.querySelector('#o1').onclick = () => saveBlob(xlsxBlob(bookBytes(examSheets())), fileSafe(BS.year + '학년도 ' + semShort(BS.sem) + ' 교육과정편성(배정내역).xlsx'));
    t.querySelector('#o2').onclick = (e) => run(e.target, async () => { saveBlob(rosterZip(), fileSafe(BS.year + '학년도 ' + semShort(BS.sem) + ' 분반별 명렬.zip')); });
    t.querySelector('#o3').onclick = () => saveBlob(xlsxBlob(bookBytes(gridSheets())), fileSafe(BS.year + '학년도 ' + semShort(BS.sem) + ' 블록 배치표.xlsx'));
    t.querySelector('#o4').onclick = (e) => run(e.target, async () => { statsBook(await api('selExport', { roundId: BS.roundId })); });
  }
  function sortedStudents() { return included().slice().sort((a, b) => Number(a.classNo) - Number(b.classNo) || Number(a.number) - Number(b.number)); }
  function examSheets() {
    const res = BS.result, d = BS.d;
    const term = BS.sem.split('-')[1];
    const ix = R.index({ subjects: d.subjects.map((o) => Object.assign({}, o, { 학기: BS.sem })), groups: [] });
    const elect = ix.by[BS.sem].electives;
    const grpPick = {};
    included().forEach((s) => { const m = {}; s.picks.forEach((p) => { const o = elect.find((x) => x.name === p); if (o) m[o.group] = (m[o.group] || 0) + 1; }); Object.keys(m).forEach((g) => { grpPick[g] = Math.max(grpPick[g] || 0, m[g]); }); });
    const where = {};
    res.sections.forEach((s) => s.students.forEach((id) => { (where[id] = where[id] || {})[s.subject] = s.label; }));
    const h1 = ['순번', '학번', '이름', '성별', '반', '번호'], h2 = ['', '', '', '', '', ''];
    let lastG = null;
    elect.forEach((o) => { h1.push(o.group !== lastG ? term + '학기[택' + (grpPick[o.group] || 1) + ']' : ''); h2.push(o.name); lastG = o.group; });
    const rows = sortedStudents().map((s, i) => [i + 1, s.studentNo, s.name, s.sex || '', s.classNo, String(s.number).padStart(2, '0')].concat(elect.map((o) => (where[s.id] || {})[o.name] || '')));
    const cnt = [['블록', '표시', '과목', '정원과목', '교실', '교사', '인원']].concat(res.sections.slice().sort((a, b) => (a.block < b.block ? -1 : a.block > b.block ? 1 : a.subject < b.subject ? -1 : 1))
      .map((s) => [s.block, s.label, s.subject, s.group || '', s.room || '', teacherName(s.teacherId), s.students.length]));
    return [{ name: '배정내역', aoa: [h1, h2].concat(rows), cols: [5, 8, 10, 5, 4, 5].concat(elect.map(() => 7)) }, { name: '분반별 인원', aoa: cnt, cols: [6, 6, 22, 12, 8, 10, 6] }];
  }
  function rosterZip() {
    const sm = stuById(), grade = BS.sem.split('-')[0];
    const secs = BS.result.sections.slice().sort((a, b) => (a.block < b.block ? -1 : a.block > b.block ? 1 : a.subject < b.subject ? -1 : 1));
    const files = secs.map((s, i) => {
      const studs = s.students.map((id) => sm[id]).filter(Boolean).sort((a, b) => Number(a.classNo) - Number(b.classNo) || Number(a.number) - Number(b.number));
      const aoa = [['학년도', '과정', '계열', '학년', '학과', '반', '번호', '성명']].concat(studs.map((x) => [Number(BS.year), BS.neis.과정, BS.neis.계열, Number(grade), BS.neis.학과, Number(x.classNo), Number(x.number), x.name]));
      return { name: String(i + 1).padStart(2, '0') + '_' + fileSafe(s.subject) + '_' + s.label + '_' + fileSafe(s.room || '교실미정') + '_(' + studs.length + '명).xlsx', data: bookBytes([{ name: 'sheet1', aoa, cols: [8, 6, 8, 5, 10, 4, 5, 12] }]) };
    });
    return makeZip(files);
  }
  function gridSheets() {
    const res = BS.result, cols = BS.rooms;
    const grid = [['블록', '학점'].concat(cols)].concat(res.blocks.map((b) => [b.id, b.credit].concat(cols.map((r) => {
      const s = res.sections.find((x) => x.block === b.id && x.room === r);
      return s ? s.subject + ' ' + s.label + ' (' + s.students.length + '명)' + (s.teacherId ? ' ' + teacherName(s.teacherId) : '') : '';
    }))));
    const none = res.sections.filter((s) => !s.room);
    if (none.length) grid.push([], ['교실 미정'].concat(none.map((s) => s.block + ' ' + s.subject + ' ' + s.label)));
    const list = [['블록', '표시', '과목', '학점', '정원과목', '교실', '교사', '인원', '최소', '최대']].concat(res.sections.map((s) => [s.block, s.label, s.subject, s.credit, s.group || '', s.room || '', teacherName(s.teacherId), s.students.length, s.min || '', s.max || '']));
    return [{ name: '블록 배치표', aoa: grid, cols: [6, 5].concat(cols.map(() => 22)) }, { name: '분반 목록', aoa: list, cols: [6, 6, 22, 5, 12, 8, 10, 6, 6, 6] }];
  }
  function statsBook(d) {
    const ix = R.index(d.cur);
    const sems = d.round.sems;
    const cols = []; sems.forEach((s) => ix.by[s].electives.forEach((o) => cols.push({ s, o })));
    const h1 = ['순번', '학번', '이름', '성별', '반', '번호', '상태', '과목수'], h2 = h1.map(() => '');
    let last = '';
    cols.forEach((c) => { const g = ix.groups[c.s][c.o.group] || {}; const k = c.s + c.o.group; h1.push(k !== last ? semShort(c.s) + ' ' + (g.name || '') + ' [택' + (g.pick || 1) + ']' : ''); h2.push(c.o.name); last = k; });
    const has = (st, c) => (st.picks[c.s] || []).some((x) => R.norm(x) === c.o.key);
    const studs = d.students.filter((x) => x.selStatus !== '미신청');
    const total = ['합계', '', '', '', '', '', '', studs.reduce((a, st) => a + sems.reduce((b, s) => b + (st.picks[s] || []).length, 0), 0)].concat(cols.map((c) => studs.filter((st) => has(st, c)).length));
    const rows = studs.map((st, i) => [i + 1, st.studentNo, st.name, st.sex || '', st.classNo, st.number, st.selStatus, sems.reduce((b, s) => b + (st.picks[s] || []).length, 0)].concat(cols.map((c) => (has(st, c) ? 1 : ''))));
    const bySub = [['학기', '그룹', '과목', '교과군', '학점', '정원과목', '신청 인원']].concat(cols.map((c) => [semShort(c.s), (ix.groups[c.s][c.o.group] || {}).name || c.o.group, c.o.name, c.o.area, c.o.credit,
      (d.cur.subjects.find((x) => x.학기 === c.s && x.과목 === c.o.name) || {}).정원과목 || '', studs.filter((st) => has(st, c)).length]));
    saveBlob(xlsxBlob(bookBytes([{ name: '수강신청내역', aoa: [h1, h2, total].concat(rows), cols: [5, 8, 10, 5, 4, 5, 8, 6].concat(cols.map(() => 7)) }, { name: '과목별 인원', aoa: bySub, cols: [12, 14, 22, 18, 5, 12, 8] }])),
      fileSafe(d.round.name + ' 교육과정 통계.xlsx'));
  }

  /* =========================================================
     교원소요 배당표
     ========================================================= */
  VIEWS.demand = async function (v, yearArg) {
    loading(v);
    const ui = A.ui;
    const year = yearArg || ui.dmYear || String((Number(ui.year) || new Date().getFullYear()) + 1);
    let d;
    try { d = await api('demandData', { year }); } catch (e) { failed(v, e); return; }
    ui.dmYear = d.year;
    const classes = {}; d.grades.forEach((g) => { classes[g.grade] = ui['dmC' + g.grade] != null ? ui['dmC' + g.grade] : g.classes; });
    let est = ui.dmEst || 35;
    const draw = () => {
      const rows = demandRows(d, classes, est);
      const sum = {};
      rows.forEach((r) => { const k = r[2] || '(미정)'; sum[k] = (sum[k] || 0) + r[7]; });
      const tcount = {}; d.teachers.forEach((x) => { if (x.subject) tcount[x.subject] = (tcount[x.subject] || 0) + 1; });
      v.innerHTML = '<div class="card tight"><div class="row"><h2>교원소요 배당표</h2><label class="row small">학년도 <input id="dmy" class="input sm w4" value="' + esc(d.year) + '"></label><span style="margin-left:auto"></span><button class="btn pri sm" id="dmx">엑셀 내려받기</button></div>'
        + '<table class="mini edit"><thead><tr><th>학년</th><th>입학년도</th><th>학급 수</th><th>교육과정</th><th>선택 과목 분반 수</th></tr></thead><tbody>'
        + d.grades.map((g) => {
          const ps = d.plans.filter((p) => String(p.grade) === String(g.grade));
          return '<tr><td>' + g.grade + '학년</td><td>' + esc(g.cohort) + '</td><td><input class="input sm w4" data-cl="' + g.grade + '" value="' + esc(classes[g.grade]) + '"> <span class="muted small">' + esc(g.from || '') + '</span></td>'
            + '<td>' + (g.hasCur ? '<span class="okk">✓</span>' : '<span class="no">없음</span>') + '</td><td class="small">' + ([1, 2].map((tm) => { const p = ps.find((x) => String(x.sem) === String(tm)); return tm + '학기: ' + (p ? '블록 편성(' + esc(p.status) + ')' : '신청 인원으로 어림'); }).join(' · ')) + '</td></tr>';
        }).join('') + '</tbody></table>'
        + ((d.surveyOnly || []).length ? '<div class="note">아직 신청이 없는 학기는 참고조사(수요조사) 인원으로 어림했습니다: ' + esc(d.surveyOnly.map((k) => { const [y, sm] = k.split('|'); return y + ' 입학 ' + sm.replace('-', '학년 ') + '학기'; }).join(', ')) + '</div>' : '')
        + '<div class="row"><label class="row small">편성 전 과목은 신청 인원 ÷ <input id="dmest" class="input sm w4" value="' + esc(est) + '">명으로 분반 수를 어림합니다.</label></div>'
        + '<p class="hint">교육청 양식(교육과정편제 및 단위시간 배당표)의 왼쪽 표와 같은 열 순서입니다. 내려받은 표를 양식에 붙여 넣으면 정원과목별 소요가 계산됩니다. 창의적 체험활동·진로 같은 과목은 양식에서 직접 더하세요.</p></div>'
        + '<div class="grid-dm"><div class="card tight"><div class="tbl-wrap"><table class="tbl"><thead><tr><th>연번</th><th>과목</th><th>정원과목</th><th>학년</th><th>학기</th><th>학점</th><th>학급수</th><th>연환산</th><th>근거</th></tr></thead><tbody>'
        + rows.map((r) => '<tr><td>' + r[0] + '</td><td>' + esc(r[1]) + '</td><td>' + (r[2] ? esc(r[2]) : '<span class="muted">-</span>') + '</td><td>' + r[3] + '</td><td>' + r[4] + '</td><td class="num">' + r[5] + '</td><td class="num">' + r[6] + '</td><td class="num">' + r[7] + '</td><td class="muted small">' + esc(r[8]) + '</td></tr>').join('')
        + '</tbody></table></div></div><div class="card tight"><h3>정원과목별 시수 합계</h3><table class="mini"><thead><tr><th>정원과목</th><th>시수 계</th><th>교사 계정</th></tr></thead><tbody>'
        + Object.keys(sum).sort().map((k) => '<tr><td>' + esc(k) + '</td><td class="num">' + Math.round(sum[k] * 10) / 10 + '</td><td class="num">' + (tcount[k] || '') + '</td></tr>').join('') + '</tbody></table></div></div>';
      v.querySelector('#dmy').onchange = (e) => { ui.dmYear = e.target.value; VIEWS.demand(v, e.target.value); };
      v.querySelectorAll('[data-cl]').forEach((el) => { el.onchange = () => { classes[el.dataset.cl] = Number(el.value) || 0; ui['dmC' + el.dataset.cl] = classes[el.dataset.cl]; setTimeout(draw, 0); }; });
      v.querySelector('#dmest').onchange = (e) => { est = Number(e.target.value) || 35; ui.dmEst = est; setTimeout(draw, 0); };
      v.querySelector('#dmx').onclick = () => {
        const head = ['연번', '과목', '수업교사 정원(임용)과목', '학년', '수업학기', '주당시수(학점)', '학급수', '연환산 주당시수(학점)계', '근거'];
        const tot = [['정원(임용)과목', '시수(학점) 총계', '교사 계정 수']].concat(Object.keys(sum).sort().map((k) => [k, Math.round(sum[k] * 10) / 10, tcount[k] || '']));
        saveBlob(xlsxBlob(bookBytes([{ name: '배당표', aoa: [head].concat(rows), cols: [5, 24, 14, 5, 7, 8, 6, 10, 22] }, { name: '정원과목별 합계', aoa: tot, cols: [16, 12, 10] }])), fileSafe(d.year + '학년도 교원소요 배당표.xlsx'));
      };
    };
    draw();
  };
  function demandRows(d, classes, est) {
    const out = [];
    let n = 0;
    const push = (name, group, grade, term, credit, cls, why) => {
      if (!cls) return;
      const annual = term === '연' ? credit * cls : credit * cls / 2;
      out.push([++n, name, group, grade, term, credit, cls, Math.round(annual * 10) / 10, why]);
    };
    d.grades.forEach((g) => {
      const subs = d.curs[g.cohort] || [];
      if (!subs.length) return;
      const C = Number(classes[g.grade]) || 0;
      const s1 = g.grade + '-1', s2 = g.grade + '-2';
      const des1 = subs.filter((o) => o.학기 === s1 && o.구분 === '지정'), des2 = subs.filter((o) => o.학기 === s2 && o.구분 === '지정');
      const base = (x) => x.replace(/\s*[12]$/, '');
      const usedYear = {};
      des1.forEach((o) => {
        const pair = des2.find((p) => base(p.과목) === base(o.과목) && p.학점 === o.학점 && (p.정원과목 || '') === (o.정원과목 || '') && base(o.과목) !== o.과목);
        if (pair) { usedYear[pair.과목] = 1; push(base(o.과목), o.정원과목 || '', g.grade, '연', Number(o.학점), C, '지정 (1·2학기)'); }
      });
      [[1, des1], [2, des2]].forEach(([tm, list]) => list.forEach((o) => {
        if (tm === 1 && des2.some((p) => usedYear[p.과목] && base(p.과목) === base(o.과목))) return;
        if (usedYear[o.과목]) return;
        const m = o.과목.match(/^(.+?)\s*↔\s*(.+)$/);
        if (m) { push(m[1], m[1], g.grade, tm, Number(o.학점), Math.floor(C / 2), '지정 (나눠 운영)'); push(m[2], m[2], g.grade, tm, Number(o.학점), C - Math.floor(C / 2), '지정 (나눠 운영)'); return; }
        push(o.과목, o.정원과목 || '', g.grade, tm, Number(o.학점), C, '지정');
      }));
      [1, 2].forEach((tm) => {
        const sem = g.grade + '-' + tm;
        const plan = d.plans.find((p) => String(p.grade) === String(g.grade) && String(p.sem) === String(tm));
        subs.filter((o) => o.학기 === sem && o.구분 === '선택').forEach((o) => {
          let cls = 0, why = '';
          if (plan) { cls = plan.counts[o.과목] || 0; why = '블록 편성'; }
          else {
            const k = d.selCount[g.cohort + '|' + sem + '|' + o.과목] || 0;
            const sv = (d.surveyOnly || []).includes(g.cohort + '|' + sem);
            cls = k ? Math.max(1, Math.ceil(k / est)) : 0; why = k ? (sv ? '참고조사 ' : '신청 ') + k + '명 어림' : '';
          }
          push(o.과목, (plan && plan.groups[o.과목]) || o.정원과목 || '', g.grade, tm, Number(o.학점), cls, why);
        });
      });
    });
    return out;
  }
})();
