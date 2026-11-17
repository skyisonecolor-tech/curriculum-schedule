/* 일과 알리미 — 1단계(기반) 앱 */
(function () {
  'use strict';
  const CFG = window.APP_CONFIG || {};
  const MODE = new URLSearchParams(location.search).get('mode') === 'practice' ? 'practice' : 'real';
  const KEY = 'alimi:' + MODE;
  const ROLES = ['최종관리자', '일과담당', '수정', '조회', '교사'];
  const $app = document.getElementById('app');
  let S = load();
  let ui = { tab: null, loginTab: 'student', classNeed: null, deptNeed: null, school: '', year: '' };

  /* ---------- 공통 ---------- */
  function load() { try { return JSON.parse(localStorage.getItem(KEY) || '{}'); } catch (e) { return {}; } }
  function save() { try { localStorage.setItem(KEY, JSON.stringify(S)); } catch (e) { /* 저장 불가 환경 */ } }
  function clearSession() { S = {}; save(); }
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }
  function toast(msg, isErr) {
    const t = document.getElementById('toast');
    t.textContent = msg; t.className = 'show' + (isErr ? ' err' : '');
    clearTimeout(toast._t); toast._t = setTimeout(() => { t.className = ''; }, 3200);
  }
  function appUrl() { return location.origin + location.pathname + (MODE === 'practice' ? '?mode=practice' : ''); }
  function isAdmin() { return S.user && S.user.kind === 'teacher' && S.user.role === '최종관리자'; }
  function canViewAll() { return S.user && S.user.kind === 'teacher' && ['최종관리자', '수정', '조회', '일과담당'].includes(S.user.role); }

  // 학교(Workspace) 계정 주소 /a/macros/도메인/s/… 는 로그인을 요구하므로 일반 주소로 바꿔 씁니다.
  function apiUrl() { return String(CFG.API_URL || '').trim().replace(/\/a\/macros\/[^/]+\/s\//, '/macros/s/'); }
  const WEB_VERSION = '0.5.6';
  /* 같은 화면을 오가며 같은 자료를 다시 부를 때 30초 동안은 저장본을 씀. 무언가를 저장·변경하면 저장본을 모두 비움 */
  const READ_CACHE = new Set(['settingsGet', 'studentList', 'teacherList', 'selRounds', 'curGet', 'selStatus', 'blockList', 'blockData', 'demandData',
    'ttVersions', 'ttView', 'ttData', 'noticeList', 'pushConfig', 'opsDay', 'opsList', 'retentionGet', 'dataCounts', 'selHome']);
  const NO_CLEAR = new Set(['ping', 'me', 'auditList', 'backupList', 'rosterDupes', 'opsFree', 'slips', 'teacherSlips', 'rosterPreview', 'teacherUploadPreview',
    'selUploadPreview', 'histUploadPreview', 'surveyUploadPreview', 'yearPreview', 'selGet', 'selExport']);
  const rcache = new Map(), inflight = new Map();
  const READ_TTL = 30000;
  function clearReadCache() { rcache.clear(); }
  async function api(action, payload) {
    if (READ_CACHE.has(action)) {
      const key = MODE + '|' + action + '|' + JSON.stringify(payload || {});
      const hit = rcache.get(key);
      if (hit && Date.now() - hit.t < READ_TTL) return JSON.parse(hit.v);
      if (inflight.has(key)) return JSON.parse(await inflight.get(key));
      const p = apiRaw(action, payload).then((d) => JSON.stringify(d));
      inflight.set(key, p);
      try { const v = await p; rcache.set(key, { t: Date.now(), v }); return JSON.parse(v); } finally { inflight.delete(key); }
    }
    if (!NO_CLEAR.has(action)) clearReadCache();
    try { return await apiRaw(action, payload); } finally { if (!NO_CLEAR.has(action)) clearReadCache(); }
  }
  async function apiRaw(action, payload) {
    if (!CFG.API_URL || CFG.API_URL.indexOf('http') !== 0) throw new Error('config.js에 서버 주소(API_URL)를 먼저 넣어 주세요.');
    let res;
    try {
      res = await fetch(apiUrl(), { method: 'POST', headers: { 'Content-Type': 'text/plain;charset=utf-8' },
        body: JSON.stringify({ action, payload: payload || {}, token: S.token || '', mode: MODE }) });
    } catch (e) { const x = new Error('서버에 연결할 수 없습니다.'); x.code = 'NET'; throw x; }
    let j;
    try { j = await res.json(); } catch (e) { const x = new Error('서버 응답을 읽을 수 없습니다.'); x.code = 'NET'; throw x; }
    if (!j.ok) {
      const e = new Error(j.error === 'NO_ACTION'
        ? '서버(Code.gs)가 화면보다 예전 버전이라 이 기능을 모릅니다. 관리자는 Apps Script에서 Code.gs를 새 것으로 바꾸고 [배포 → 배포 관리 → 연필 → 버전: 새 버전 → 배포]를 해 주세요.'
        : (j.message || '오류가 발생했습니다.')); e.code = j.error;
      if (j.error === 'AUTH') { clearSession(); setTimeout(render, 0); }
      if (j.error === 'MUST_CHANGE') { S.must = true; save(); setTimeout(render, 0); }
      throw e;
    }
    return j.data;
  }

  /* 연결 점검: 주소 형식 → 서버까지 닿는지 → 응답을 읽을 수 있는지 차례로 확인 */
  async function diagnose() {
    const url = apiUrl();
    const items = [];
    const bad = (t) => items.push('<li class="bad">✗ ' + t + '</li>');
    const good = (t) => items.push('<li class="good">✓ ' + t + '</li>');
    if (/\/dev(\?|$)/.test(url)) bad('주소가 <b>…/dev</b>로 끝납니다. 이 주소는 만든 사람만 열 수 있는 시험용입니다. <b>배포 → 배포 관리</b>에 있는 <b>…/exec</b> 주소를 config.js에 넣어 주세요.');
    if (/\/dev(\?|$)/.test(url)) return '<ul class="diag">' + items.join('') + '</ul>';
    else if (!/^https:\/\/script\.google\.com\/macros\/s\/[\w-]+\/exec$/.test(url)) bad('주소 모양이 웹 앱 주소(https://script.google.com/macros/s/…/exec)와 다릅니다. config.js의 주소를 다시 복사해 주세요. 앞뒤 공백이나 따옴표가 빠지지 않았는지도 확인하세요.<br><span class="muted">지금 주소: ' + esc(url) + '</span>');
    else good('주소 형식이 맞습니다.');
    let reach = false;
    try { await fetch(url, { mode: 'no-cors', cache: 'no-store' }); reach = true; } catch (e) { reach = false; }
    if (!reach) {
      bad('script.google.com에 닿지 않습니다. 인터넷 연결을 확인하고, 학교망에서 막혀 있다면 휴대폰 데이터로 한 번 시험해 보세요.');
    } else {
      good('구글 서버까지는 닿습니다.');
      let ok = false;
      try { const r = await fetch(url, { cache: 'no-store' }); const j = await r.json(); ok = j && j.ok; } catch (e) { ok = false; }
      if (ok) good('서버 응답을 정상으로 받았습니다. 다시 로그인해 보세요.');
      else bad('서버가 로그인 화면을 돌려주고 있습니다. 거의 항상 <b>웹 앱 액세스 권한</b> 문제입니다.'
        + '<ol><li>Apps Script에서 <b>배포 → 배포 관리 → 연필(수정)</b>을 누릅니다.</li>'
        + '<li><b>액세스 권한</b>을 <b>모든 사용자</b>로 바꿉니다. (「Google 계정이 있는 모든 사용자」나 「도메인 내 사용자」가 아닙니다.)</li>'
        + '<li><b>버전: 새 버전</b>을 고르고 <b>배포</b>를 누릅니다.</li></ol>'
        + '「모든 사용자」가 목록에 없으면 학교 구글 관리자가 막아 둔 것입니다. 관리자에게 허용을 요청하거나, 업무용 개인 Gmail 계정으로 서버를 다시 만드세요.');
    }
    return '<ul class="diag">' + items.join('') + '</ul>';
  }
  async function showDiagnosis() {
    const close = modal('<h2>서버 연결 점검</h2><div id="dg"><div class="empty">점검 중…</div></div><div class="row" style="justify-content:flex-end"><button class="btn pri" data-close>닫기</button></div>');
    const html = await diagnose();
    const box = document.getElementById('dg'); if (box) box.innerHTML = html;
    return close;
  }
  async function run(btn, fn) {
    if (btn) { btn.disabled = true; btn.dataset.label = btn.textContent; btn.textContent = '처리 중…'; }
    try { return await fn(); } catch (e) { if (e.code === 'NET') showDiagnosis(); else toast(e.message, true); return undefined; }
    finally { if (btn) { btn.disabled = false; btn.textContent = btn.dataset.label; } }
  }
  function modal(html, onReady, opts) {
    const bg = document.createElement('div');
    bg.className = 'modal-bg';
    bg.innerHTML = '<div class="modal' + (opts && opts.wide ? ' wide' : '') + '" role="dialog" aria-modal="true">' + html + '</div>';
    document.body.appendChild(bg);
    const close = () => bg.remove();
    bg.addEventListener('click', (e) => { if (bg.dataset.busy) return; if (e.target === bg || e.target.closest('[data-close]')) close(); });
    if (onReady) onReady(bg, close);
    const f = bg.querySelector('button, input'); if (f) f.focus();
    return close;
  }

  /* ---------- 필요할 때만 불러오는 도구(엑셀 880KB·QR) ---------- */
  const libs = {};
  function loadLib(src) {
    if (!libs[src]) {
      libs[src] = new Promise((res, rej) => {
        const s = document.createElement('script'); s.src = src; s.async = true;
        s.onload = () => res(); s.onerror = () => { delete libs[src]; rej(new Error('도구(' + src.split('/').pop() + ')를 불러오지 못했습니다. 인터넷 연결을 확인해 주세요.')); };
        document.head.appendChild(s);
      });
    }
    return libs[src];
  }
  const needXLSX = () => (window.XLSX ? Promise.resolve() : loadLib('lib/xlsx.full.min.js'));
  const needQR = () => (window.qrcode ? Promise.resolve() : loadLib('lib/qrcode.js'));

  /* ---------- 쪽지 인쇄 ---------- */
  async function printSlips(list, title) {
    try { await needQR(); } catch (e) { /* QR 없이 인쇄 */ }
    const school = ui.school || CFG.SCHOOL_NAME || '';
    const url = appUrl();
    let qr = '';
    try { const q = window.qrcode(0, 'M'); q.addData(url); q.make(); qr = q.createSvgTag(3, 0); } catch (e) { qr = ''; }
    const cards = list.map((x) => {
      const who = (x.teacher || x.loginId != null) ? ('선생님' + (x.dept ? ' · ' + esc(x.dept) : '') + (x.loginId ? ' · 로그인 이름 ' + esc(x.loginId) : '')) : (esc(x.grade) + '학년 ' + esc(x.classNo) + '반 ' + esc(x.number) + '번');
      return '<div class="slip"><div class="qr">' + qr + '</div><div><div class="s">' + esc(school) + ' · 일과 알리미' + (MODE === 'practice' ? ' (연습)' : '') + '</div>'
        + '<div><strong>' + esc(x.name) + '</strong> · ' + who + '</div><div class="s">개별 코드</div><div class="c">' + esc(x.code) + '</div>'
        + '<div class="s">' + esc(url) + '<br>처음 로그인할 때 이름과 이 코드를 넣고, 바로 나만의 비밀번호를 정합니다. 남에게 보여주지 마세요.</div></div></div>';
    }).join('');
    document.getElementById('print-area').innerHTML = '<h2 style="font-size:13pt">' + esc(title || '개별 코드 안내') + '</h2><div class="slips">' + cards + '</div>';
    setTimeout(() => window.print(), 50);
  }
  function showCode(title, who, code, slip) {
    modal('<h2>' + esc(title) + '</h2><p class="muted">' + esc(who) + '</p><div class="code">' + esc(code) + '</div>'
      + '<p class="hint">이 코드는 처음 로그인할 때 한 번 씁니다. 로그인하면 바로 새 비밀번호를 정하게 됩니다.</p>'
      + '<div class="row" style="justify-content:flex-end"><button class="btn" data-print>쪽지 출력</button><button class="btn pri" data-close>확인</button></div>',
    (bg) => { bg.querySelector('[data-print]').onclick = () => printSlips([slip], title); });
  }

  /* ---------- 엑셀 ---------- */
  const ALIAS = { 입학년도: '입학년도', 학년: '학년', 반: '반', 번호: '번호', 학번: '학번', 성명: '성명', 이름: '성명', 학생이름: '성명',
    다른이름: '다른이름', '다른이름(영문·원어)': '다른이름', 영문이름: '다른이름', 원어이름: '다른이름', 성별: '성별', 구분: '구분',
    부서: '부서', 부서명: '부서', 교과: '교과', 과목: '교과', 담당교과: '교과', 권한: '권한', 담임학년: '담임학년', 담임반: '담임반' };
  async function readSheet(file) {
    await needXLSX();
    return new Promise((resolve, reject) => {
      const fr = new FileReader();
      fr.onload = () => {
        try {
          const wb = window.XLSX.read(new Uint8Array(fr.result), { type: 'array' });
          const aoa = window.XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { header: 1, defval: '', raw: false });
          let hi = aoa.findIndex((r) => r.some((c) => ['성명', '이름', '학번'].includes(String(c).replace(/\s/g, ''))));
          if (hi < 0) throw new Error('첫 줄(머리글)에서 성명 또는 학번 열을 찾지 못했습니다. 내려받은 양식을 써 주세요.');
          const head = aoa[hi].map((h) => ALIAS[String(h).replace(/\s/g, '')] || '');
          const rows = aoa.slice(hi + 1).filter((r) => r.some((c) => String(c).trim())).map((r) => {
            const o = {}; head.forEach((h, i) => { if (h) o[h] = String(r[i] == null ? '' : r[i]).trim(); }); return o;
          });
          resolve(rows);
        } catch (e) { reject(e); }
      };
      fr.onerror = () => reject(new Error('파일을 읽지 못했습니다.'));
      fr.readAsArrayBuffer(file);
    });
  }
  const TEMPLATES = {
    roster: { file: '명렬_업로드_양식.xlsx', head: ['입학년도', '학년', '반', '번호', '학번', '성명', '다른이름(영문·원어)', '성별'],
      ex: [['2025', '2', '1', '1', '20101', '홍길동', '', '남'], ['2025', '2', '1', '2', '20102', '박해림', 'PIAOHAILIN', '여']] },
    status: { file: '전출_휴학_복학_양식.xlsx', head: ['학번', '성명', '구분'], ex: [['20105', '홍길동', '전출'], ['20211', '김하늘', '휴학'], ['20307', '이바다', '자퇴']] },
    freshman: { file: '신입생_명렬_양식.xlsx', head: ['반', '번호', '성명', '다른이름(영문·원어)', '성별', '학번'],
      ex: [['1', '1', '홍길동', '', '남', ''], ['1', '2', '김하늘', '', '여', '']] },
    teachers: { file: '교사_명단_양식.xlsx', sheet: '교사명단', head: ['성명', '부서', '교과', '권한', '담임학년', '담임반'],
      ex: [['김민준', '교무부', '수학', '교사', '2', '3'], ['이서연', '연구부', '국어', '일과담당', '', ''], ['김민준', '3학년부', '영어', '교사', '3', '1']] },
  };
  async function downloadTemplate(k) {
    try { await needXLSX(); } catch (e) { toast(e.message, true); return; }
    const t = TEMPLATES[k];
    const ws = window.XLSX.utils.aoa_to_sheet([t.head].concat(t.ex));
    ws['!cols'] = t.head.map(() => ({ wch: 14 }));
    const wb = window.XLSX.utils.book_new();
    window.XLSX.utils.book_append_sheet(wb, ws, t.sheet || '명렬');
    saveBlob(new Blob([window.XLSX.write(wb, { type: 'array', bookType: 'xlsx' })], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }), t.file);
  }
  function saveBlob(blob, name) {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob); a.download = name; a.style.display = 'none';
    document.body.appendChild(a); a.click();
    setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
  }

  /* ---------- 화면 ---------- */
  function render() {
    if (!CFG.API_URL || CFG.API_URL.indexOf('http') !== 0) { renderNoConfig(); return; }
    if (!S.token) { renderLogin(); return; }
    if (S.must) { renderPassword(true); return; }
    renderHome();
  }
  function banner() {
    let b = MODE === 'practice' ? '<div class="practice">연습 모드 — 실제 데이터가 아닙니다</div>' : '';
    if (ui.serverVersion && ui.serverVersion !== WEB_VERSION && S.user && S.user.role === '최종관리자') {
      b += '<div class="practice" style="background:#fdecea;color:#8a1c1c">서버 버전(' + esc(ui.serverVersion) + ')과 화면 버전(' + WEB_VERSION + ')이 다릅니다. Apps Script의 Code.gs를 새 것으로 바꾸고 <b>배포 관리 → 새 버전</b>으로 배포해 주세요. 그 전에는 일부 기능에서 「알 수 없는 요청」이 나옵니다.</div>';
    }
    return b;
  }

  function renderNoConfig() {
    $app.innerHTML = '<div class="center"><div class="login"><h1>일과 알리미</h1><div class="note warn">설치가 덜 끝났습니다. <b>config.js</b>의 <b>API_URL</b>에 Apps Script 웹 앱 주소를 넣어 주세요.</div></div></div>';
  }

  function renderLogin() {
    const st = ui.loginTab === 'student';
    const cls = ui.classNeed;
    $app.innerHTML = banner() + '<div class="center"><div class="login">'
      + '<div><div class="muted">' + esc(ui.school || CFG.SCHOOL_NAME || '') + '</div><h1>일과 알리미</h1><p class="muted" style="margin:4px 0 0">내 시간표 · 알림 · 수강신청(신청 기간에만 열림)</p></div>'
      + '<div class="seg" role="tablist"><button type="button" role="tab" data-lt="student" class="' + (st ? 'on' : '') + '" aria-selected="' + st + '">학생</button>'
      + '<button type="button" role="tab" data-lt="teacher" class="' + (!st ? 'on' : '') + '" aria-selected="' + !st + '">선생님</button></div>'
      + '<form id="lf" class="card" autocomplete="on">'
      + (st
        ? '<div class="field"><label for="ln">이름</label><input id="ln" class="input" autocomplete="name" required placeholder="홍길동"><span class="hint">외국 국적 학생은 한글 이름, 영문·원어 이름 중 어느 쪽이든 됩니다.</span></div>'
        : '<div class="field"><label for="ln">이름</label><input id="ln" class="input" autocomplete="username" required placeholder="홍길동"><span class="hint">선생님 성함을 그대로 넣습니다.</span></div>')
      + '<div class="field"><label for="lp">비밀번호</label><input id="lp" class="input" type="password" autocomplete="current-password" required placeholder="처음에는 받은 개별 코드"></div>'
      + (cls ? '<div class="field"><label for="lc">학년·반 선택</label><select id="lc" class="input">' + cls.map((o, i) => '<option value="' + i + '">' + esc(o.grade) + '학년 ' + esc(o.classNo) + '반</option>').join('') + '</select><span class="hint">같은 이름의 학생이 있어 학년·반을 한 번 더 확인합니다.</span></div>' : '')
      + (ui.deptNeed && !st ? '<div class="field"><label for="ld">부서 선택</label><select id="ld" class="input">' + ui.deptNeed.map((o) => '<option value="' + esc(o) + '"' + (o === loadDept(ui.lastName) ? ' selected' : '') + '>' + esc(o || '(부서 없음)') + '</option>').join('') + '</select><span class="hint">같은 이름의 선생님이 있어 부서를 한 번 더 확인합니다.</span></div>' : '')
      + '<button class="btn pri big" type="submit">로그인</button></form>'
      + '<p class="hint">한 번 로그인하면 이 기기에서 계속 유지됩니다. 로그인이 안 되면 ' + (st ? '담임 선생님께' : '관리 담당 선생님께') + ' 문의하세요.</p>'
      + '<button type="button" class="btn sm" id="dgb" style="align-self:flex-start">서버 연결 점검</button>'
      + '</div></div>';
    $app.querySelectorAll('[data-lt]').forEach((b) => { b.onclick = () => { ui.loginTab = b.dataset.lt; ui.classNeed = null; ui.deptNeed = null; renderLogin(); }; });
    document.getElementById('dgb').onclick = showDiagnosis;
    const f = document.getElementById('lf');
    if (ui.lastName) document.getElementById('ln').value = ui.lastName;
    f.onsubmit = (e) => {
      e.preventDefault();
      const name = document.getElementById('ln').value.trim();
      const secret = document.getElementById('lp').value;
      if (ui.lastName !== name) ui.deptNeed = null;
      ui.lastName = name;
      run(f.querySelector('button[type=submit]'), async () => {
        let d;
        if (st) {
          const payload = { name, secret };
          if (cls) { const o = cls[Number(document.getElementById('lc').value)]; payload.grade = o.grade; payload.classNo = o.classNo; }
          d = await api('studentLogin', payload);
          if (d.need === 'class') { ui.classNeed = d.options; renderLogin(); document.getElementById('lp').value = secret; toast('학년·반을 골라 주세요.'); return; }
        } else {
          const payload = { name, secret };
          const ld = document.getElementById('ld');
          if (ui.deptNeed && ld) { payload.dept = ld.value; payload.deptPicked = true; }
          d = await api('teacherLogin', payload);
          if (d.need === 'dept') {
            ui.deptNeed = d.options; renderLogin(); document.getElementById('lp').value = secret;
            toast('같은 이름의 선생님이 있습니다. 부서를 골라 주세요.'); return;
          }
          if (payload.deptPicked) saveDept(name, payload.dept);
        }
        S = { token: d.token, user: d.user, must: !!d.mustChangePassword }; save();
        if (d.user && d.user.kind === 'teacher') setTimeout(() => { needXLSX().catch(() => {}); needQR().catch(() => {}); }, 1500);
        ui.classNeed = null; ui.deptNeed = null; ui.tab = null; ui.lastName = '';
        if (!S.must) await loadRounds();
        render();
      });
    };
  }

  function loadDept(name) { try { return (JSON.parse(localStorage.getItem('alimi_tdept') || '{}'))[name]; } catch (e) { return undefined; } }
  function saveDept(name, dept) {
    try { const m = JSON.parse(localStorage.getItem('alimi_tdept') || '{}'); m[name] = dept; localStorage.setItem('alimi_tdept', JSON.stringify(m)); } catch (e) { /* 저장 못 해도 됨 */ }
  }

  function renderPassword(forced) {
    $app.innerHTML = banner() + '<div class="center"><div class="login"><h1>' + (forced ? '나만의 비밀번호 정하기' : '비밀번호 바꾸기') + '</h1>'
      + (forced ? '<div class="note">처음 로그인했습니다. 앞으로 쓸 비밀번호를 정해 주세요. 정해야 다음으로 넘어갑니다.</div>' : '')
      + '<form id="pf" class="card">'
      + (forced ? '' : '<div class="field"><label for="pc">지금 비밀번호</label><input id="pc" class="input" type="password" autocomplete="current-password" required></div>')
      + '<div class="field"><label for="p1">새 비밀번호</label><input id="p1" class="input" type="password" autocomplete="new-password" required minlength="6"></div>'
      + '<div class="field"><label for="p2">새 비밀번호 확인</label><input id="p2" class="input" type="password" autocomplete="new-password" required minlength="6"></div>'
      + '<ul class="hint" style="margin:0;padding-left:18px"><li>6자 이상 (숫자만 써도 됩니다)</li><li>같은 숫자 반복(111111)이나 연속(123456)은 안 됩니다</li><li>받은 개별 코드와 달라야 합니다</li></ul>'
      + '<button class="btn pri big" type="submit">저장</button>'
      + (forced ? '<button class="btn" type="button" id="po">로그아웃</button>' : '<button class="btn" type="button" id="pb">취소</button>')
      + '</form></div></div>';
    const f = document.getElementById('pf');
    f.onsubmit = (e) => {
      e.preventDefault();
      const p1 = document.getElementById('p1').value, p2 = document.getElementById('p2').value;
      if (p1 !== p2) { toast('새 비밀번호 두 칸이 서로 다릅니다.', true); return; }
      run(f.querySelector('button[type=submit]'), async () => {
        const payload = { newPassword: p1 };
        if (!forced) payload.currentPassword = document.getElementById('pc').value;
        const d = await api('setPassword', payload);
        S.token = d.token; S.must = false; save();
        toast('비밀번호를 저장했습니다.');
        await loadRounds();
        render();
      });
    };
    const po = document.getElementById('po'); if (po) po.onclick = logout;
    const pb = document.getElementById('pb'); if (pb) pb.onclick = () => render();
  }

  async function logout() { try { await api('logout', {}); } catch (e) { /* 무시 */ } clearSession(); ui.tab = null; render(); }

  /* 메뉴: 큰 메뉴(그룹) → 작은 메뉴 */
  function navFor() {
    const u = S.user || {};
    const G = [];
    if (u.kind === 'student') {
      G.push({ id: 'tt', label: '시간표', subs: [['tt', '시간표']] });
      if ((S.rounds || []).length) G.push({ id: 'sel', label: '수강신청', subs: [['sel', '수강신청']] });
      G.push({ id: 'noti', label: '알림', subs: [['notice', '알림']] });
      G.push({ id: 'me', label: '내 정보', subs: [['me', '내 정보']] });
      return G;
    }
    const tt = [['tt', '시간표'], ['ops', '일과 운영'], ['ttprint', '출력']];
    if (isAdmin()) tt.push(['ttbuild', '시간표 편성']);
    G.push({ id: 'ttg', label: '시간표', subs: tt });
    G.push({ id: 'noti', label: '알림', subs: [['notice', '알림']] });
    const sel = [];
    if (canViewAll() || u.homeroom) sel.push(['selstatus', '신청 현황']);
    if (isAdmin()) sel.push(['rounds', '신청 회차'], ['curriculum', '교육과정'], ['upload', '업로드'], ['blocks', '블록 편성'], ['demand', '교원소요']);
    if (sel.length) G.push({ id: 'selg', label: '수강신청', subs: sel });
    const people = [];
    if (u.homeroom) people.push(['myclass', '우리 반']);
    if (canViewAll()) people.push(['accounts', '학생 계정']);
    if (isAdmin()) people.push(['roster', '명렬'], ['freshman', '신입생']);
    if (people.length) G.push({ id: 'people', label: '학생', subs: people });
    if (isAdmin()) G.push({ id: 'admin', label: '관리', subs: [['settings', '학급 설정'], ['teachers', '교사 계정'], ['data', '데이터'], ['year', '학년도 전환']] });
    G.push({ id: 'me', label: '내 정보', subs: [['me', '내 정보']] });
    return G;
  }

  function renderHome() {
    const groups = navFor();
    const all = [];
    groups.forEach((g) => g.subs.forEach((x) => all.push([x[0], g.id])));
    if (!ui.tab || !all.some((t) => t[0] === ui.tab)) ui.tab = all[0][0];
    const grp = groups.find((g) => g.subs.some((x) => x[0] === ui.tab));
    const u = S.user || {};
    const who = u.kind === 'student' ? (esc(u.name) + ' · ' + esc(u.grade) + '학년 ' + esc(u.classNo) + '반 ' + esc(u.number) + '번')
      : (esc(u.name) + ' 선생님' + (u.role && u.role !== '교사' ? ' · ' + esc(u.role) : '') + (u.homeroom ? ' · ' + esc(u.homeroom.grade) + '-' + esc(u.homeroom.classNo) + ' 담임' : ''));
    const top = groups.map((g) => '<button type="button" data-grp="' + g.id + '"' + (g.subs.length === 1 ? ' data-tab="' + g.subs[0][0] + '"' : '')
      + ' class="' + (g === grp ? 'on' : '') + '">' + g.label + '</button>').join('');
    const sub = grp.subs.length > 1 ? '<nav class="subtabs" aria-label="' + esc(grp.label) + ' 메뉴">' + grp.subs.map((x) => '<button type="button" data-tab="' + x[0] + '" class="' + (ui.tab === x[0] ? 'on' : '') + '">' + x[1] + '</button>').join('') + '</nav>' : '';
    $app.innerHTML = banner() + '<header class="top"><span class="brand">일과 알리미</span><nav class="tabs" aria-label="메뉴">' + top
      + '</nav><div class="who"><span>' + who + '</span><button class="btn sm" id="lo">로그아웃</button></div></header>' + sub + '<main class="main" id="view"></main>';
    $app.querySelectorAll('[data-grp]').forEach((b) => {
      b.onclick = () => { const g = groups.find((x) => x.id === b.dataset.grp); ui.tab = (g.subs.find((x) => x[0] === ui.lastSub && ui.lastSub) || g.subs[0])[0]; renderHome(); };
    });
    $app.querySelectorAll('.subtabs [data-tab]').forEach((b) => { b.onclick = () => { ui.tab = b.dataset.tab; ui.lastSub = b.dataset.tab; renderHome(); }; });
    document.getElementById('lo').onclick = logout;
    const v = document.getElementById('view');
    const fn = VIEWS[ui.tab];
    if (fn) fn(v);
  }

  /* ---------- 각 화면 ---------- */
  const VIEWS = {
    tt(v) {
      v.innerHTML = '<div class="card"><h2>시간표</h2><div class="empty">시간표는 다음 단계(블록 편성·시간표)를 마치면 이곳에 표시됩니다.<br>바뀐 수업은 알림으로도 알려 드립니다.</div></div>';
    },
    me(v) {
      const u = S.user || {};
      v.innerHTML = '<div class="card" style="max-width:520px"><h2>내 정보</h2>'
        + '<div>' + esc(u.name) + (u.kind === 'student' ? ' · ' + esc(u.grade) + '학년 ' + esc(u.classNo) + '반 ' + esc(u.number) + '번 (학번 ' + esc(u.studentNo) + ')' : (u.dept ? ' · ' + esc(u.dept) : '') + ' 선생님' + (u.loginId ? ' (로그인 이름 ' + esc(u.loginId) + ')' : '')) + '</div>'
        + '<div class="row"><button class="btn" id="cp">비밀번호 바꾸기</button></div>'
        + '<p class="hint">비밀번호를 잊으면 ' + (u.kind === 'student' ? '담임 선생님께' : '관리 담당 선생님께') + ' 초기화를 요청하세요. 새 개별 코드를 받습니다.</p></div>';
      document.getElementById('cp').onclick = () => renderPassword(false);
    },
    myclass(v) { classAccounts(v, S.user.homeroom.grade, S.user.homeroom.classNo, true); },
    accounts(v) {
      v.innerHTML = '<div class="card"><div class="row"><h2>학생 계정</h2>'
        + '<label class="row small">학년 <select id="ag" class="input sm">' + [1, 2, 3].map((g) => '<option>' + g + '</option>').join('') + '</select></label>'
        + '<label class="row small">반 <select id="ac" class="input sm">' + Array.from({ length: 15 }, (_, i) => '<option>' + (i + 1) + '</option>').join('') + '</select></label>'
        + '<button class="btn pri sm" id="ab">보기</button></div></div><div id="alist"></div>';
      document.getElementById('ab').onclick = () => classAccounts(document.getElementById('alist'), document.getElementById('ag').value, document.getElementById('ac').value, false);
    },
    settings: settingsView,
    roster: rosterView,
    freshman: freshmanView,
    teachers: teachersView,
    data: dataView,
  };

  const LEFT = ['전출', '자퇴', '퇴학'];
  const ST_PILL = { 재학: 'ok', 휴학: 'warn', 미정: '', 전출: 'err', 자퇴: 'err', 퇴학: 'err' };
  function stActs(st) {
    if (st === '재학') return ['전출', '휴학', '자퇴', '퇴학'];
    if (st === '휴학') return ['복학', '전출', '자퇴', '퇴학'];
    if (LEFT.includes(st)) return ['재입학'];
    return [];
  }
  const today = () => { const d = new Date(); return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); };
  async function classAccounts(v, grade, classNo, own) {
    v.innerHTML = '<div class="card"><div class="empty">불러오는 중…</div></div>';
    let d;
    try { d = await api('studentList', { grade, classNo }); } catch (e) { v.innerHTML = '<div class="note err">' + esc(e.message) + '</div>'; return; }
    const cur = d.students.filter((s) => !LEFT.includes(s.status));
    const left = d.students.filter((s) => LEFT.includes(s.status));
    const showLeft = !!ui.showLeft;
    const shown = showLeft ? d.students : cur;
    const pend = cur.filter((s) => s.pending && s.status !== '미정').length;
    const sel = d.canReset || d.canManage;
    const cols = 5 + (d.canReset ? 1 : 0) + (d.canManage ? 1 : 0) + (sel ? 1 : 0);
    v.innerHTML = '<div class="card"><div class="row"><h2>' + esc(grade) + '학년 ' + esc(classNo) + '반' + (own ? ' (우리 반)' : '') + '</h2>'
      + '<span class="pill">' + cur.length + '명</span>' + (cur.some((s) => s.status === '휴학') ? '<span class="pill warn">휴학 ' + cur.filter((s) => s.status === '휴학').length + '</span>' : '')
      + '<span class="pill ' + (pend ? 'warn' : 'ok') + '">비밀번호 미설정 ' + pend + '명</span>'
      + (left.length ? '<label class="row small"><input type="checkbox" id="slf"' + (showLeft ? ' checked' : '') + '> 전출·자퇴 ' + left.length + '명 보기</label>' : '')
      + '<span style="margin-left:auto"></span>' + (d.canReset && pend ? '<button class="btn sm" id="sl">미설정 학생 쪽지 출력</button>' : '')
      + (d.canManage ? '<button class="btn pri sm" id="tin">전입 학생 추가</button>' : '') + '</div>'
      + (sel ? '<div class="row bulkbar"><span class="muted" id="scnt">학생을 골라 일괄 작업을 할 수 있습니다.</span><span style="margin-left:auto"></span>'
        + '<button class="btn sm" data-sb="reset" disabled>비밀번호 초기화</button>' + (d.canManage ? '<button class="btn sm dan" data-sb="delete" disabled>삭제</button>' : '') + '</div>' : '')
      + '<div class="tbl-wrap"><table class="tbl"><thead><tr>' + (sel ? '<th style="width:32px"><input type="checkbox" id="sall" aria-label="모두 선택"></th>' : '') + '<th>번호</th><th>이름</th><th>상태</th><th>비밀번호</th><th>마지막 접속</th>' + (d.canManage ? '<th>학적 처리</th>' : '') + (d.canReset ? '<th></th>' : '') + '</tr></thead><tbody>'
      + (shown.length ? shown.map((s) => {
        const gone = LEFT.includes(s.status);
        const acts = stActs(s.status);
        return '<tr' + (gone ? ' class="muted"' : '') + '>' + (sel ? '<td><input type="checkbox" data-ss="' + esc(s.id) + '" aria-label="' + esc(s.name || s.number) + ' 선택"></td>' : '')
          + '<td>' + esc(s.number) + '</td><td>' + (d.canManage ? '<button type="button" class="linkbtn" data-edit="' + esc(s.id) + '" title="정보 고치기">' + esc(s.name || '(이름 미정)') + ' ✎</button>' : esc(s.name || '(이름 미정)')) + (s.altName ? ' <span class="muted">' + esc(s.altName) + '</span>' : '') + '</td>'
          + '<td><span class="pill ' + (ST_PILL[s.status] || '') + '">' + esc(s.status) + '</span>' + (s.status !== '재학' && s.changedAt ? ' <span class="muted small">' + esc(String(s.changedAt).slice(0, 10)) + '</span>' : '') + '</td>'
          + '<td>' + (gone || s.status === '미정' ? '-' : s.pending ? '<span class="pill warn">코드 대기</span>' : '<span class="pill ok">설정 완료</span>') + '</td>'
          + '<td class="muted">' + esc(s.lastSeen || '-') + '</td>'
          + (d.canManage ? '<td>' + (acts.length ? '<select class="input sm" data-st="' + esc(s.id) + '" aria-label="' + esc(s.name) + ' 학적 처리"><option value="">처리…</option>' + acts.map((x) => '<option>' + x + '</option>').join('') + '</select>' : '') + '</td>' : '')
          + (d.canReset ? '<td>' + (s.status === '미정' || gone ? '' : '<button class="btn sm dan" data-reset="' + esc(s.id) + '" data-name="' + esc(s.name) + '">초기화</button>') + '</td>' : '') + '</tr>';
      }).join('') : '<tr><td colspan="' + cols + '" class="empty">학생이 없습니다.</td></tr>')
      + '</tbody></table></div><p class="hint">초기화하면 그 학생의 비밀번호가 지워지고 새 개별 코드가 발급됩니다. 기존 로그인도 끊깁니다.'
      + (d.canManage ? '<br>이름을 누르면 이름·학번·반·번호 등을 고칠 수 있습니다. 삭제는 그 학생의 신청·이수 이력·분반 배정까지 지웁니다(삭제 전 자동 백업). 학교를 떠난 학생은 삭제 대신 학적 처리(전출·자퇴)를 쓰세요.' : '')
      + (d.canManage ? '<br>학적 처리: 전출·자퇴·퇴학은 로그인이 막히고 수강신청·블록 편성 대상에서 빠집니다(기록은 보관 기간까지 남음). 휴학은 로그인은 되며, 복학하면 재학으로 돌아옵니다.' : '') + '</p></div>';
    const reload = () => classAccounts(v, grade, classNo, own);
    const slf = document.getElementById('slf'); if (slf) slf.onchange = () => { ui.showLeft = slf.checked; reload(); };
    const sl = document.getElementById('sl');
    if (sl) sl.onclick = () => run(sl, async () => { const list = await api('slips', { grade, classNo }); printSlips(list, grade + '학년 ' + classNo + '반 개별 코드'); });
    const tin = document.getElementById('tin'); if (tin) tin.onclick = () => transferInForm(grade, classNo, cur, reload);
    v.querySelectorAll('[data-edit]').forEach((b) => { b.onclick = () => studentEditForm(d.students.find((x) => x.id === b.dataset.edit), grade, reload); });
    if (sel) {
      const boxes = Array.from(v.querySelectorAll('[data-ss]')), all = document.getElementById('sall');
      const picked = () => boxes.filter((b) => b.checked).map((b) => b.dataset.ss);
      const sync = () => {
        const n = picked().length;
        document.getElementById('scnt').textContent = n ? '선택 ' + n + '명' : '학생을 골라 일괄 작업을 할 수 있습니다.';
        v.querySelectorAll('[data-sb]').forEach((b) => { b.disabled = !n; });
        all.checked = n > 0 && n === boxes.length; all.indeterminate = n > 0 && n < boxes.length;
      };
      boxes.forEach((b) => { b.onchange = sync; });
      all.onchange = () => { boxes.forEach((b) => { b.checked = all.checked; }); sync(); };
      v.querySelectorAll('[data-sb]').forEach((b) => {
        b.onclick = () => {
          const ids = picked();
          if (b.dataset.sb === 'reset') {
            if (!confirm(ids.length + '명의 비밀번호를 초기화하고 새 개별 코드를 발급할까요?')) return;
            run(b, async () => {
              const r = await api('studentBulkReset', { ids });
              await reload();
              modal('<h2>비밀번호 초기화 ' + r.issued.length + '명</h2>' + (r.skipped.length ? '<p class="hint">건너뜀: ' + esc(r.skipped.join(', ')) + '</p>' : '')
                + '<div class="row" style="justify-content:flex-end"><button class="btn" data-close>닫기</button>' + (r.issued.length ? '<button class="btn pri" data-print>코드 쪽지 출력</button>' : '') + '</div>',
              (bg) => { const pb = bg.querySelector('[data-print]'); if (pb) pb.onclick = () => printSlips(r.issued, grade + '학년 ' + classNo + '반 개별 코드'); });
            });
          } else {
            const nm = ids.map((id) => (d.students.find((x) => x.id === id) || {}).name || '(미정)');
            confirmTyped(ids.length + '명 삭제', '<p>' + esc(nm.slice(0, 30).join(', ')) + (nm.length > 30 ? ' 외' : '') + '</p><p class="hint">학생 정보와 신청·이수 이력·분반 배정·로그인을 모두 지웁니다. 지우기 전에 자동으로 백업합니다.</p>', async () => {
              const r = await api('studentDelete', { ids }); toast(r.deleted + '명을 삭제했습니다.'); reload();
            });
          }
        };
      });
    }
    v.querySelectorAll('[data-st]').forEach((sel) => {
      sel.onchange = () => {
        const act = sel.value; if (!act) return; sel.value = '';
        const s = d.students.find((x) => x.id === sel.dataset.st);
        statusForm(s, act, grade, classNo, reload);
      };
    });
    v.querySelectorAll('[data-reset]').forEach((b) => {
      b.onclick = () => {
        if (!confirm(b.dataset.name + ' 학생의 비밀번호를 초기화할까요?')) return;
        run(b, async () => {
          const r = await api('studentReset', { studentId: b.dataset.reset });
          const s = r.student;
          showCode('새 개별 코드', s.grade + '학년 ' + s.classNo + '반 ' + s.number + '번 ' + s.name, r.code, Object.assign({}, s, { code: r.code }));
          reload();
        });
      };
    });
  }
  /* 지우기처럼 되돌리기 어려운 작업: 「삭제」를 직접 입력해야 진행 */
  function confirmTyped(title, bodyHtml, onOk) {
    modal('<h2>' + esc(title) + '</h2>' + bodyHtml
      + '<div class="field"><label for="cty">확인을 위해 <b>삭제</b>라고 입력하세요</label><input id="cty" class="input" autocomplete="off"></div>'
      + '<div class="row" style="justify-content:flex-end"><button class="btn" data-close>취소</button><button class="btn dan" id="cto" disabled>삭제</button></div>',
    (bg, close) => {
      const inp = bg.querySelector('#cty'), ob = bg.querySelector('#cto');
      const check = () => { ob.disabled = inp.value.replace(/\s/g, '') !== '삭제'; };
      inp.oninput = check; inp.addEventListener('compositionend', check); inp.addEventListener('keyup', check);
      inp.onkeydown = (e) => { if (e.key === 'Enter' && !ob.disabled) ob.click(); };
      ob.onclick = () => {
        const note = document.createElement('div');
        note.className = 'note'; note.textContent = '지우는 중입니다. 먼저 백업을 만들기 때문에 30초~1분쯤 걸릴 수 있습니다. 창을 닫지 마세요.';
        ob.parentNode.before(note);
        bg.querySelectorAll('[data-close]').forEach((x) => { x.disabled = true; }); bg.dataset.busy = '1';
        return run(ob, async () => { await onOk(); close(); }).finally(() => { note.remove(); delete bg.dataset.busy; bg.querySelectorAll('[data-close]').forEach((x) => { x.disabled = false; }); });
      };
    });
  }
  /* 탭별 초기화 버튼: target·scope는 서버 dataReset 대상 */
  function resetData(label, target, scope, after, extra) {
    confirmTyped(label + ' 초기화', '<p>' + esc(label) + '을(를) 모두 지웁니다. 지우기 전에 자동으로 백업하며, 관리 → 데이터의 복원으로 되돌릴 수 있습니다.</p>', async () => {
      const r = await api('dataReset', Object.assign({ target, scope, confirm: '삭제' }, extra || {}));
      toast(label + ' ' + r.removed + '건을 지웠습니다.');
      if (after) after(r);
    });
  }
  function studentEditForm(s, grade, reload) {
    modal('<h2>학생 정보 고치기</h2>'
      + '<div class="row"><label class="field" style="flex:1">이름<input id="se1" class="input" value="' + esc(s.name) + '"></label>'
      + '<label class="field">성별<select id="se3" class="input sm"><option value="">-</option><option' + (s.sex === '남' ? ' selected' : '') + '>남</option><option' + (s.sex === '여' ? ' selected' : '') + '>여</option></select></label></div>'
      + '<div class="field"><label for="se2">다른 이름 (영문·원어)</label><input id="se2" class="input" value="' + esc(s.altName) + '"></div>'
      + '<div class="row"><label class="field">학년<input id="se4" class="input sm w4" inputmode="numeric" value="' + esc(grade) + '"></label>'
      + '<label class="field">반<input id="se5" class="input sm w4" inputmode="numeric" value="' + esc(s.classNo || '') + '"></label>'
      + '<label class="field">번호<input id="se6" class="input sm w4" inputmode="numeric" value="' + esc(s.number) + '"></label>'
      + '<label class="field">학번<input id="se7" class="input sm" inputmode="numeric" value="' + esc(s.studentNo) + '"></label></div>'
      + '<p class="hint">학년·반을 바꾸면 그 반으로 옮겨집니다. 비밀번호와 신청 내용은 그대로입니다.</p>'
      + '<div class="row" style="justify-content:flex-end"><button class="btn" data-close>취소</button><button class="btn pri" id="seo">저장</button></div>',
    (bg, close) => {
      const ob = bg.querySelector('#seo');
      ob.onclick = () => run(ob, async () => {
        const r = await api('studentEdit', { studentId: s.id, name: bg.querySelector('#se1').value, altName: bg.querySelector('#se2').value, sex: bg.querySelector('#se3').value,
          grade: bg.querySelector('#se4').value, classNo: bg.querySelector('#se5').value, number: bg.querySelector('#se6').value, studentNo: bg.querySelector('#se7').value });
        close(); toast(r.changed ? '고쳤습니다.' : '바뀐 내용이 없습니다.'); reload();
      });
    });
  }
  function statusForm(s, act, grade, classNo, reload) {
    const what = { 전출: '다른 학교로 전출', 휴학: '휴학', 자퇴: '자퇴', 퇴학: '퇴학', 복학: '복학 (재학으로)', 재입학: '재입학 (재학으로)' }[act];
    const out = ['전출', '자퇴', '퇴학'].includes(act);
    modal('<h2>' + esc(grade + '학년 ' + classNo + '반 ' + s.number + '번 ' + s.name) + '</h2><p><b>' + esc(what) + '</b> 처리합니다. (지금: ' + esc(s.status) + ')</p>'
      + '<div class="row"><label class="field">처리일<input id="sfd" type="date" class="input sm" value="' + today() + '"></label>'
      + '<label class="field" style="flex:1">메모 (선택)<input id="sfm" class="input" maxlength="100" placeholder="예: OO고로 전출"></label></div>'
      + (out ? '<div class="note warn">로그인이 바로 막히고, 수강신청 현황·블록 편성 대상에서 빠집니다. 잘못 처리했으면 [재입학]으로 되돌릴 수 있습니다.</div>' : '')
      + '<div class="row" style="justify-content:flex-end"><button class="btn" data-close>취소</button><button class="btn pri" id="sfo">' + esc(act) + ' 처리</button></div>',
    (bg, close) => {
      const ob = bg.querySelector('#sfo');
      ob.onclick = () => run(ob, async () => {
        await api('studentStatus', { studentId: s.id, act, date: bg.querySelector('#sfd').value, memo: bg.querySelector('#sfm').value.trim() });
        close(); toast(s.name + ' 학생을 ' + act + ' 처리했습니다.'); reload();
      });
    });
  }
  function transferInForm(grade, classNo, cur, reload) {
    const nextNo = cur.reduce((m, s) => Math.max(m, Number(s.number) || 0), 0) + 1;
    modal('<h2>' + esc(grade + '학년 ' + classNo + '반') + ' 전입 학생 추가</h2>'
      + '<div class="row"><label class="field" style="flex:1">이름<input id="ti1" class="input" autocomplete="off"></label>'
      + '<label class="field">성별<select id="ti3" class="input sm"><option value="">-</option><option>남</option><option>여</option></select></label></div>'
      + '<div class="field"><label for="ti2">다른 이름 (외국 국적이면 영문·원어, 선택)</label><input id="ti2" class="input"></div>'
      + '<div class="row"><label class="field">번호<input id="ti4" class="input sm" inputmode="numeric" placeholder="' + nextNo + '"></label>'
      + '<label class="field">학번<input id="ti5" class="input sm" inputmode="numeric" placeholder="' + esc(grade + String(classNo).padStart(2, '0') + String(nextNo).padStart(2, '0')) + '"></label>'
      + '<label class="field">전입일<input id="ti6" type="date" class="input sm" value="' + today() + '"></label></div>'
      + '<div class="field"><label for="ti7">메모 (선택)</label><input id="ti7" class="input" maxlength="100" placeholder="예: OO고에서 전입"></div>'
      + '<p class="hint">번호를 비우면 이 반 마지막 번호 다음(' + nextNo + '번), 학번을 비우면 학년·반·번호로 만듭니다. 저장하면 개별 코드가 바로 나옵니다. 수강신청·분반 배정은 해당 화면에서 이어서 해 주세요.</p>'
      + '<div class="row" style="justify-content:flex-end"><button class="btn" data-close>취소</button><button class="btn pri" id="tis">전입 처리</button></div>',
    (bg, close) => {
      const sb = bg.querySelector('#tis');
      sb.onclick = () => run(sb, async () => {
        const r = await api('studentTransferIn', { grade, classNo, name: bg.querySelector('#ti1').value.trim(), altName: bg.querySelector('#ti2').value.trim(),
          sex: bg.querySelector('#ti3').value, number: bg.querySelector('#ti4').value.trim(), studentNo: bg.querySelector('#ti5').value.trim(),
          date: bg.querySelector('#ti6').value, memo: bg.querySelector('#ti7').value.trim() });
        close(); reload();
        const s = r.student;
        showCode('전입 처리했습니다', s.grade + '학년 ' + s.classNo + '반 ' + s.number + '번 ' + s.name + ' (학번 ' + s.studentNo + ')', r.code, Object.assign({}, s, { code: r.code }));
      });
    });
  }

  async function settingsView(v) {
    v.innerHTML = '<div class="card"><div class="empty">불러오는 중…</div></div>';
    let d;
    try { d = await api('settingsGet', {}); } catch (e) { v.innerHTML = '<div class="note err">' + esc(e.message) + '</div>'; return; }
    ui.school = d.schoolName; ui.year = d.year;
    const g = (n) => d.grades.find((x) => String(x.학년) === String(n)) || {};
    v.innerHTML = '<div class="card" style="max-width:760px"><h2>학년·학급 설정</h2>'
      + '<div class="grid2"><div class="field"><label for="sn">학교 이름</label><input id="sn" class="input" value="' + esc(d.schoolName) + '"></div>'
      + '<div class="field"><label for="sy">학년도</label><input id="sy" class="input" inputmode="numeric" value="' + esc(d.year) + '"></div></div>'
      + '<div class="tbl-wrap"><table class="tbl"><thead><tr><th>학년</th><th>학급 수 (= 블록당 교실 수)</th><th>교실 (쉼표로 구분)</th></tr></thead><tbody>'
      + [1, 2, 3].map((n) => '<tr><td>' + n + '학년</td><td><input class="input sm" style="width:80px" data-gn="' + n + '" inputmode="numeric" value="' + esc(g(n).학급수 || 11) + '"></td>'
        + '<td><input class="input sm" style="width:100%" data-gr="' + n + '" value="' + esc(g(n).교실 || Array.from({ length: Number(g(n).학급수 || 11) }, (_, i) => n * 100 + i + 1).join(',')) + '"></td></tr>').join('')
      + '</tbody></table></div><p class="hint">학급 수는 블록을 만들 때 블록당 최대 분반 수가 됩니다. 10·11·12개 반 등 상황에 맞게 바꾸세요.</p>'
      + '<div class="row" style="justify-content:flex-end"><button class="btn pri" id="ss">저장</button></div></div>';
    const b = document.getElementById('ss');
    b.onclick = () => run(b, async () => {
      const grades = [1, 2, 3].map((n) => ({ 학년: n, 학급수: v.querySelector('[data-gn="' + n + '"]').value, 교실: v.querySelector('[data-gr="' + n + '"]').value }));
      await api('settingsSave', { schoolName: document.getElementById('sn').value, year: document.getElementById('sy').value, grades });
      ui.school = document.getElementById('sn').value;
      toast('저장했습니다.');
    });
  }

  function previewHtml(d, withDecisions) {
    const pills = '<div class="row"><span class="pill pri">신규 ' + d.added.length + '</span><span class="pill warn">변경 ' + d.changed.length + '</span>'
      + '<span class="pill err">빠짐 ' + d.missing.length + '</span><span class="pill">동일 ' + d.same + '</span></div>';
    const errs = d.errors.length ? '<div class="note err"><b>고쳐야 할 오류 ' + d.errors.length + '건</b><br>' + d.errors.slice(0, 20).map(esc).join('<br>') + '</div>' : '';
    const warns = (d.warnings || []).map((w) => '<div class="note warn">' + esc(w) + '</div>').join('');
    const rows = [];
    d.added.forEach((r) => rows.push('<tr><td><span class="pill pri">신규</span></td><td>' + esc(r.학번) + '</td><td>' + esc(r.성명) + (r.다른이름 ? ' (' + esc(r.다른이름) + ')' : '') + '</td><td>' + esc(r.반) + '-' + esc(r.번호) + '</td><td>개별 코드 발급</td></tr>'));
    d.changed.forEach((c) => rows.push('<tr><td><span class="pill warn">변경</span></td><td>' + esc(c.before.학번) + '</td><td>' + esc(c.before.성명) + '</td><td></td><td>' + c.diffs.map(esc).join('<br>') + '</td></tr>'));
    d.missing.forEach((m) => rows.push('<tr><td><span class="pill err">빠짐</span></td><td>' + esc(m.학번) + '</td><td>' + esc(m.성명) + '</td><td>' + esc(m.반) + '-' + esc(m.번호) + '</td><td>'
      + (withDecisions ? '<select class="input sm" data-dec="' + esc(m.id) + '"><option value="전출">전출 처리 (기록 보존)</option><option value="유지">그대로 두기</option><option value="삭제">삭제</option></select>' : '새 명렬에 없음') + '</td></tr>'));
    const cc = d.classCounts ? '<div class="tbl-wrap" style="max-height:220px"><table class="tbl"><thead><tr><th>반</th><th>설정 인원</th><th>명렬 인원</th></tr></thead><tbody>'
      + d.classCounts.map((x) => '<tr><td>' + esc(x.classNo) + '반</td><td>' + x.planned + '</td><td>' + x.actual + (x.planned !== x.actual ? ' <span class="pill warn">조정</span>' : '') + '</td></tr>').join('') + '</tbody></table></div>' : '';
    return pills + errs + warns + cc + (rows.length ? '<div class="tbl-wrap"><table class="tbl"><thead><tr><th>구분</th><th>학번</th><th>성명</th><th>반-번호</th><th>내용 · 처리</th></tr></thead><tbody>' + rows.join('') + '</tbody></table></div>' : '');
  }

  function uploadFlow(box, makePayload, onDone) {
    box.querySelector('[data-file]').onchange = async (e) => {
      const file = e.target.files[0]; if (!file) return;
      const out = box.querySelector('[data-out]');
      out.innerHTML = '<div class="empty">파일을 읽는 중…</div>';
      let rows;
      try { rows = await readSheet(file); } catch (err) { out.innerHTML = '<div class="note err">' + esc(err.message) + '</div>'; return; }
      const payload = makePayload(rows);
      let d;
      try { d = await api('rosterPreview', payload); } catch (err) { out.innerHTML = '<div class="note err">' + esc(err.message) + '</div>'; return; }
      out.innerHTML = '<div class="muted">' + esc(file.name) + ' · ' + rows.length + '행</div>' + previewHtml(d, true)
        + '<div class="row" style="justify-content:flex-end"><span class="hint" style="margin-right:auto">적용하기 전에 자동으로 백업합니다.</span><button class="btn pri" data-apply ' + (d.errors.length ? 'disabled' : '') + '>적용</button></div>';
      const ab = out.querySelector('[data-apply]');
      ab.onclick = () => run(ab, async () => {
        const decisions = {};
        out.querySelectorAll('[data-dec]').forEach((s) => { decisions[s.dataset.dec] = s.value; });
        const r = await api('rosterApply', Object.assign({}, payload, { decisions }));
        out.innerHTML = '<div class="note ok">적용했습니다. 신규 ' + r.summary.added + ' · 변경 ' + r.summary.changed + ' · 빠짐 ' + r.summary.missing + ' · 동일 ' + r.summary.same + '</div>'
          + (r.issued.length ? '<div class="row"><span class="muted">새로 개별 코드를 받은 학생 ' + r.issued.length + '명</span><button class="btn" data-ps>쪽지 출력</button></div>' : '');
        const ps = out.querySelector('[data-ps]'); if (ps) ps.onclick = () => printSlips(r.issued, '개별 코드 안내');
        if (onDone) onDone(r);
      });
    };
  }

  function rosterView(v) {
    v.innerHTML = '<div class="grid2">'
      + '<div class="card"><h2>1. 양식 내려받기</h2><div class="row"><button class="btn" data-t="roster">명렬 업로드 양식</button><button class="btn" data-t="status">전출·휴학·복학 양식</button></div>'
      + '<p class="hint">명렬 열: 입학년도·학년·반·번호·학번·성명·다른 이름·성별. 진급 처리는 학년도 전환 단계에서 제공합니다.</p></div>'
      + '<div class="card"><h2>2. 반영 방식</h2>'
      + '<label class="row"><input type="radio" name="rm" value="replaceGrade" checked> <b>학년 단위 교체</b> <select id="rg" class="input sm"><option>1</option><option selected>2</option><option>3</option></select>학년 명렬을 새로 반영</label>'
      + '<label class="row"><input type="radio" name="rm" value="add"> <b>추가(전입)</b> 기존 명렬에 학생 추가</label>'
      + '<label class="row"><input type="radio" name="rm" value="status"> <b>상태 변경</b> 전출·휴학·복학·자퇴·퇴학·졸업</label></div></div>'
      + '<div class="card" id="rbox"><h2>3. 파일 올리기 → 미리보기 → 적용</h2><input type="file" data-file accept=".xlsx,.xls,.csv" class="input"><div data-out></div></div>'
      + '<div class="grid2"><div class="card" id="dupbox"><div class="row"><h2>이중 등록 확인·정리</h2><button class="btn sm" id="dupf">찾기</button></div><p class="hint">학번이 같거나, 같은 반·번호이거나, 같은 반에 같은 이름인 재학생을 찾습니다. 지울 쪽을 골라 삭제하세요(먼저 등록된 학생이 위에 나옵니다).</p><div id="dupl"></div></div>'
      + '<div class="card"><h2>명렬 초기화</h2><p class="hint">한 학년 학생을 모두 지우고 다시 올릴 때 씁니다. 그 학생들의 신청·이수 이력·분반 배정도 함께 지워집니다(자동 백업).</p>'
      + '<div class="row"><select id="rzg" class="input sm"><option value="1">1학년</option><option value="2">2학년</option><option value="3">3학년</option><option value="all">전체 학년</option></select><button class="btn sm dan" id="rzb">이 학년 명렬 초기화</button></div>'
      + '<p class="hint">학생 한두 명은 <b>학생 → 학생 계정</b>에서 반을 열고 고치거나 지울 수 있습니다.</p></div></div>';
    document.getElementById('rzb').onclick = () => { const g = document.getElementById('rzg').value; resetData(g === 'all' ? '전체 학생 명렬' : g + '학년 명렬', 'students', g); };
    const dupf = document.getElementById('dupf');
    const loadDupes = async () => {
      const groups = await api('rosterDupes', {});
      const box = document.getElementById('dupl');
      if (!groups.length) { box.innerHTML = '<div class="note ok">이중 등록된 학생이 없습니다.</div>'; return; }
      box.innerHTML = '<div class="note warn">' + groups.length + '묶음을 찾았습니다.</div><div class="tbl-wrap" style="max-height:340px"><table class="tbl"><thead><tr><th></th><th>이유</th><th>학년-반-번호</th><th>학번</th><th>이름</th><th>비밀번호</th><th>등록·수정</th></tr></thead><tbody>'
        + groups.map((g) => g.students.map((s, i) => '<tr><td><input type="checkbox" data-dd="' + esc(s.id) + '"' + (i > 0 ? ' checked' : '') + '></td><td class="small">' + (i === 0 ? esc(g.why) : '') + '</td><td>' + esc(s.grade + '-' + s.classNo + '-' + s.number) + '</td><td>' + esc(s.studentNo) + '</td><td>' + esc(s.name) + '</td><td>' + (s.pending ? '코드 대기' : '설정 완료') + '</td><td class="muted small">' + esc(s.changedAt || '') + '</td></tr>').join('')).join('')
        + '</tbody></table></div><div class="row" style="justify-content:flex-end"><button class="btn dan" id="ddb">고른 학생 삭제</button></div>';
      document.getElementById('ddb').onclick = () => {
        const ids = Array.from(new Set(Array.from(box.querySelectorAll('[data-dd]:checked')).map((x) => x.dataset.dd)));
        if (!ids.length) { toast('지울 학생을 골라 주세요.', true); return; }
        confirmTyped(ids.length + '명 삭제', '<p class="hint">고른 학생과 그 학생의 신청·이수 이력·분반 배정을 지웁니다(자동 백업). 비밀번호를 이미 정한 쪽(설정 완료)은 남기는 것이 좋습니다.</p>', async () => {
          const r = await api('studentDelete', { ids }); toast(r.deleted + '명을 삭제했습니다.'); loadDupes();
        });
      };
    };
    dupf.onclick = () => run(dupf, loadDupes);
    v.querySelectorAll('[data-t]').forEach((b) => { b.onclick = () => downloadTemplate(b.dataset.t); });
    uploadFlow(document.getElementById('rbox'), (rows) => {
      const mode = v.querySelector('input[name=rm]:checked').value;
      const gs = Array.from(new Set(rows.map((r) => String(r.학년 || '').replace(/\D/g, '')).filter(Boolean)));
      if (mode === 'replaceGrade' && gs.length === 1 && document.getElementById('rg').value !== gs[0]) {
        document.getElementById('rg').value = gs[0];
        toast('파일의 학년에 맞춰 ' + gs[0] + '학년으로 바꿨습니다.');
      }
      return { mode, grade: document.getElementById('rg').value, rows };
    });
  }

  function freshmanView(v) {
    const ny = String((Number(ui.year) || new Date().getFullYear()) + 1);
    v.innerHTML = '<div class="grid2">'
      + '<div class="card"><h2>1. 명렬을 모를 때: 인원만 입력</h2>'
      + '<div class="row"><label class="field">입학년도<input id="fy" class="input sm" inputmode="numeric" value="' + ny + '"></label>'
      + '<label class="field">전체 인원<input id="ft" class="input sm" inputmode="numeric" placeholder="330"></label>'
      + '<label class="field">학급 수<input id="fc" class="input sm" inputmode="numeric" value="11"></label>'
      + '<button class="btn" id="fs" style="align-self:flex-end">반별로 나누기</button></div><div id="fp"></div>'
      + '<p class="hint">반별 자리(이름 미정)를 먼저 만들어 교원소요와 1학년 시간표를 준비할 수 있습니다.</p></div>'
      + '<div class="card" id="fbox"><h2>2. 명렬이 나오면: 신입생 명렬 올리기</h2><div class="row"><button class="btn" data-t="freshman">신입생 명렬 양식</button></div>'
      + '<p class="hint">학번이 비어 있으면 반·번호로 자동 생성합니다(예: 1반 7번 → 10107). 반별 인원과 학급 수는 올린 명렬에 맞춰 자동으로 조정됩니다.</p>'
      + '<input type="file" data-file accept=".xlsx,.xls,.csv" class="input"><div data-out></div></div></div>'
      + '<div class="card"><div class="row"><h2>신입생 초기화</h2><span class="hint">입학년도(위 칸)의 1학년 자리·명렬을 모두 지웁니다(자동 백업).</span><span style="margin-left:auto"></span><button class="btn sm dan" id="fz">신입생 초기화</button></div></div>';
    document.getElementById('fz').onclick = () => { const y = document.getElementById('fy').value.trim(); resetData(y + ' 입학 신입생', 'freshmen', y); };
    v.querySelector('[data-t]').onclick = () => downloadTemplate('freshman');
    document.getElementById('fs').onclick = () => {
      const total = Number(document.getElementById('ft').value), n = Number(document.getElementById('fc').value);
      if (!(total > 0 && n > 0)) { toast('전체 인원과 학급 수를 넣어 주세요.', true); return; }
      const base = Math.floor(total / n), extra = total % n;
      const per = Array.from({ length: n }, (_, i) => base + (i < extra ? 1 : 0));
      const fp = document.getElementById('fp');
      fp.innerHTML = '<div class="row">' + per.map((x, i) => '<label class="field small">' + (i + 1) + '반<input class="input sm" style="width:64px" data-pc value="' + x + '" inputmode="numeric"></label>').join('') + '</div>'
        + '<div class="row" style="justify-content:flex-end"><span class="muted" id="fsum"></span><button class="btn pri" id="fsave">저장</button></div>';
      const sum = () => { document.getElementById('fsum').textContent = '합계 ' + Array.from(fp.querySelectorAll('[data-pc]')).reduce((a, i) => a + Number(i.value || 0), 0) + '명'; };
      fp.querySelectorAll('[data-pc]').forEach((i) => { i.oninput = sum; }); sum();
      const sb = document.getElementById('fsave');
      sb.onclick = () => run(sb, async () => {
        const perClass = Array.from(fp.querySelectorAll('[data-pc]')).map((i) => Number(i.value));
        const r = await api('freshmanSetup', { entranceYear: document.getElementById('fy').value, perClass });
        toast(r.classes + '개 반, ' + r.total + '명 자리를 만들었습니다.');
      });
    };
    uploadFlow(document.getElementById('fbox'), (rows) => ({ mode: 'freshman', entranceYear: document.getElementById('fy').value, rows }));
  }

  async function teachersView(v) {
    v.innerHTML = '<div class="card"><div class="empty">불러오는 중…</div></div>';
    let list;
    try { list = await api('teacherList', {}); } catch (e) { v.innerHTML = '<div class="note err">' + esc(e.message) + '</div>'; return; }
    const pend = list.filter((t) => t.pending && t.status === '재직' && t.loginId !== 'admin');
    v.innerHTML = '<div class="card"><div class="row"><h2>교사 계정</h2><span class="pill">' + list.length + '명</span><span style="margin-left:auto"></span>'
      + (pend.length ? '<button class="btn sm" id="tps" title="아직 처음 로그인하지 않은 선생님의 개별 코드 쪽지를 부서 순으로 출력">코드 대기 ' + pend.length + '명 쪽지</button>' : '')
      + '<button class="btn sm" id="tup">명단 엑셀로 올리기</button><button class="btn pri sm" id="tn">계정 추가</button></div>'
      + '<div id="tubox" class="card" hidden></div>'
      + '<div class="row bulkbar" id="tbar"><span class="muted" id="tcnt">선생님을 골라 일괄 작업을 할 수 있습니다.</span><span style="margin-left:auto"></span>'
      + '<button class="btn sm" data-bulk="reset" disabled>비밀번호 초기화</button><button class="btn sm" data-bulk="전출" disabled>전출 처리</button><button class="btn sm" data-bulk="재직" disabled>재직으로</button><button class="btn sm dan" data-bulk="delete" disabled>삭제</button></div>'
      + '<div class="tbl-wrap"><table class="tbl"><thead><tr><th style="width:32px"><input type="checkbox" id="tall" aria-label="모두 선택"></th><th>이름 (로그인)</th><th>부서</th><th>권한</th><th>담임</th><th>교과</th><th>상태</th><th>비밀번호</th><th>마지막 접속</th><th></th></tr></thead><tbody>'
      + list.map((t) => '<tr><td>' + (t.loginId === 'admin' || t.id === (S.user || {}).id ? '' : '<input type="checkbox" data-sel="' + esc(t.id) + '" aria-label="' + esc(t.name) + ' 선택">') + '</td><td>' + esc(t.name) + (t.loginId ? ' <span class="muted small">· ' + esc(t.loginId) + '</span>' : '') + (t.sameName ? ' <span class="pill warn" title="같은 이름의 선생님이 있어 로그인할 때 부서를 고릅니다">동명이인</span>' : '') + '</td>'
        + '<td>' + esc(t.dept) + '</td><td>' + esc(t.role) + '</td><td>' + (t.homeroomGrade ? esc(t.homeroomGrade) + '-' + esc(t.homeroomClass) : '') + '</td>'
        + '<td>' + esc(t.subject) + '</td><td>' + esc(t.status) + '</td><td>' + (t.pending ? '<span class="pill warn">코드 대기</span>' : '<span class="pill ok">설정 완료</span>') + '</td>'
        + '<td class="muted">' + esc(t.lastSeen || '-') + '</td><td class="row"><button class="btn sm" data-edit="' + esc(t.id) + '">수정</button><button class="btn sm dan" data-treset="' + esc(t.id) + '">초기화</button></td></tr>').join('')
      + '</tbody></table></div><p class="hint">선생님은 <b>이름</b>과 비밀번호로 로그인합니다. 같은 이름의 선생님이 있으면 부서를 서로 다르게 넣어 주세요(로그인할 때 부서를 고릅니다).<br>'
      + '권한: 최종관리자(모든 기능) · 일과담당(보강·교체 승인) · 수정(학생 선택 수정) · 조회(조회만) · 교사(본인 시간표). 담임을 지정하면 그 반 학생 비밀번호를 초기화할 수 있습니다.</p></div>';
    document.getElementById('tn').onclick = () => teacherForm(null, v);
    const tps = document.getElementById('tps');
    if (tps) tps.onclick = () => run(tps, async () => { const r = await api('teacherSlips', {}); printSlips(r, '선생님 개별 코드 안내'); });
    teacherBulk(v, list);
    document.getElementById('tup').onclick = () => { const bx = document.getElementById('tubox'); bx.hidden = !bx.hidden; if (!bx.hidden) teacherUpload(bx, v); };
    v.querySelectorAll('[data-edit]').forEach((b) => { b.onclick = () => teacherForm(list.find((t) => t.id === b.dataset.edit), v); });
    v.querySelectorAll('[data-treset]').forEach((b) => {
      b.onclick = () => {
        const t = list.find((x) => x.id === b.dataset.treset);
        if (!confirm(t.name + ' 선생님의 비밀번호를 초기화할까요?')) return;
        run(b, async () => {
          const r = await api('teacherReset', { id: t.id });
          showCode('새 개별 코드', r.name + ' 선생님' + (r.dept ? ' · ' + r.dept : ''), r.code, { name: r.name, dept: r.dept, loginId: r.loginId, teacher: true, code: r.code });
          teachersView(v);
        });
      };
    });
  }
  function teacherBulk(v, list) {
    const boxes = Array.from(v.querySelectorAll('[data-sel]'));
    const all = document.getElementById('tall');
    const picked = () => boxes.filter((b) => b.checked).map((b) => b.dataset.sel);
    const sync = () => {
      const n = picked().length;
      document.getElementById('tcnt').textContent = n ? '선택 ' + n + '명' : '선생님을 골라 일괄 작업을 할 수 있습니다.';
      v.querySelectorAll('[data-bulk]').forEach((b) => { b.disabled = !n; });
      all.checked = n > 0 && n === boxes.length; all.indeterminate = n > 0 && n < boxes.length;
    };
    boxes.forEach((b) => { b.onchange = sync; });
    all.onchange = () => { boxes.forEach((b) => { b.checked = all.checked; }); sync(); };
    const names = (ids) => ids.map((id) => (list.find((t) => t.id === id) || {}).name).join(', ');
    const skippedHtml = (sk) => (sk && sk.length ? '<p class="hint">건너뜀: ' + sk.map((x) => esc(x.name) + '(' + esc(x.why) + ')').join(', ') + '</p>' : '');
    v.querySelectorAll('[data-bulk]').forEach((b) => {
      b.onclick = () => {
        const ids = picked(); const k = b.dataset.bulk;
        if (k === 'reset') {
          if (!confirm(ids.length + '명의 비밀번호를 초기화하고 새 개별 코드를 발급할까요?\n' + names(ids) + '\n\n지금 쓰는 비밀번호는 바로 쓸 수 없게 됩니다.')) return;
          run(b, async () => {
            const r = await api('teacherBulkReset', { ids });
            await teachersView(v);
            modal('<h2>비밀번호 초기화 ' + r.issued.length + '명</h2><p class="muted">새 개별 코드를 발급했습니다. 쪽지를 출력해 전달해 주세요.</p>' + skippedHtml(r.skipped)
              + '<div class="row" style="justify-content:flex-end"><button class="btn" data-close>닫기</button>' + (r.issued.length ? '<button class="btn pri" data-print>코드 쪽지 출력</button>' : '') + '</div>',
            (bg) => { const pb = bg.querySelector('[data-print]'); if (pb) pb.onclick = () => printSlips(r.issued, '선생님 개별 코드 안내'); });
          });
        } else if (k === 'delete') {
          if (!confirm(ids.length + '명의 계정을 삭제할까요?\n' + names(ids) + '\n\n시간표·블록 편성·보강 기록에 들어 있는 분은 기록 보호를 위해 삭제하지 않습니다(전출 처리를 권합니다). 삭제 전에 자동으로 백업합니다.')) return;
          run(b, async () => {
            const r = await api('teacherBulkDelete', { ids });
            await teachersView(v);
            const inUse = (r.skipped || []).filter((x) => x.inUse);
            modal('<h2>교사 계정 삭제</h2><p>' + (r.deleted.length ? esc(r.deleted.length + '명을 삭제했습니다: ' + r.deleted.join(', ')) : '삭제한 계정이 없습니다.') + '</p>' + skippedHtml(r.skipped)
              + (inUse.length ? '<div class="note warn">기록에 들어 있는 ' + inUse.length + '명은 <b>전출</b>로 바꾸면 로그인과 목록 선택에서 빠지고, 지난 시간표·보강 기록은 그대로 남습니다.</div>' : '')
              + '<div class="row" style="justify-content:flex-end"><button class="btn" data-close>닫기</button>' + (inUse.length ? '<button class="btn pri" data-out>' + inUse.length + '명 전출 처리</button>' : '') + '</div>',
            (bg, close) => { const ob = bg.querySelector('[data-out]'); if (ob) ob.onclick = () => run(ob, async () => { await api('teacherBulkStatus', { ids: inUse.map((x) => x.id), status: '전출' }); close(); toast('전출로 바꿨습니다.'); teachersView(v); }); });
          });
        } else {
          if (!confirm(ids.length + '명을 ' + k + (k === '재직' ? '으로' : '로') + ' 바꿀까요?\n' + names(ids))) return;
          run(b, async () => {
            const r = await api('teacherBulkStatus', { ids, status: k });
            await teachersView(v);
            if (r.skipped.length) modal('<h2>' + r.changed + '명 변경</h2>' + skippedHtml(r.skipped) + '<div class="row" style="justify-content:flex-end"><button class="btn pri" data-close>확인</button></div>');
            else toast(r.changed + '명을 ' + k + (k === '재직' ? '으로' : '로') + ' 바꿨습니다.');
          });
        }
      };
    });
  }
  function teacherUpload(bx, v) {
    bx.innerHTML = '<h2>교사 명단 올리기</h2><div class="row"><button class="btn" data-t="teachers">교사 명단 양식</button>'
      + '<span class="hint">열: 성명 · 부서 · 교과 · 권한(비우면 교사) · 담임학년 · 담임반. 같은 이름이면 부서를 다르게 적습니다.</span></div>'
      + '<input type="file" data-file accept=".xlsx,.xls,.csv" class="input"><div data-out></div>';
    bx.querySelector('[data-t]').onclick = () => downloadTemplate('teachers');
    bx.querySelector('[data-file]').onchange = async (e) => {
      const file = e.target.files[0]; if (!file) return;
      const out = bx.querySelector('[data-out]');
      out.innerHTML = '<div class="empty">파일을 읽는 중…</div>';
      let rows, d;
      try { rows = await readSheet(file); d = await api('teacherUploadPreview', { rows }); } catch (err) { out.innerHTML = '<div class="note err">' + esc(err.message) + '</div>'; return; }
      const sm = d.summary;
      const label = { add: '<span class="pill ok">추가</span>', change: '<span class="pill warn">변경</span>' };
      out.innerHTML = '<div class="muted">' + esc(file.name) + ' · ' + rows.length + '행 → 추가 ' + sm.added + ' · 변경 ' + sm.changed + ' · 같음 ' + sm.same + ' · 명단에 없음 ' + sm.missing + '</div>'
        + (d.errors.length ? '<div class="note err"><b>고칠 곳</b><ul style="margin:4px 0 0;padding-left:18px">' + d.errors.slice(0, 30).map((x) => '<li>' + esc(x) + '</li>').join('') + '</ul></div>' : '')
        + (d.items.length ? '<div class="tbl-wrap" style="max-height:280px"><table class="tbl"><thead><tr><th></th><th>이름</th><th>부서</th><th>교과</th><th>권한</th><th>담임</th><th>바뀌는 항목</th></tr></thead><tbody>'
          + d.items.map((x) => '<tr><td>' + label[x.kind] + '</td><td>' + esc(x.name) + '</td><td>' + esc(x.dept) + '</td><td>' + esc(x.subject) + '</td><td>' + esc(x.role) + '</td><td>' + esc(x.homeroom) + '</td><td class="muted">' + esc(x.diff.join(', ')) + '</td></tr>').join('')
          + '</tbody></table></div>' : '')
        + (d.missing.length ? '<p class="hint">명단에 없는 재직 교사 ' + d.missing.length + '명(' + esc(d.missing.slice(0, 8).map((x) => x.name).join(', ')) + (d.missing.length > 8 ? ' 등' : '') + ')은 그대로 둡니다. 전출한 분은 계정 [수정]에서 상태를 바꿔 주세요.</p>' : '')
        + '<div class="row" style="justify-content:flex-end"><span class="hint" style="margin-right:auto">새로 추가된 선생님은 개별 코드를 받습니다.</span><button class="btn pri" data-apply ' + (d.errors.length || !(sm.added + sm.changed) ? 'disabled' : '') + '>적용</button></div>';
      const ab = out.querySelector('[data-apply]');
      ab.onclick = () => run(ab, async () => {
        const r = await api('teacherUploadApply', { rows });
        await teachersView(v);
        const nb = document.getElementById('tubox'); nb.hidden = false;
        nb.innerHTML = '<div class="note ok">적용했습니다. 추가 ' + r.summary.added + ' · 변경 ' + r.summary.changed + '</div>'
          + (r.issued.length ? '<div class="row"><span class="muted">새로 개별 코드를 받은 선생님 ' + r.issued.length + '명 — 나중에 [코드 대기 쪽지]로 다시 출력할 수 있습니다.</span><button class="btn pri" data-ps>코드 쪽지 출력</button></div>' : '');
        const ps = nb.querySelector('[data-ps]'); if (ps) ps.onclick = () => printSlips(r.issued, '선생님 개별 코드 안내');
      });
    };
  }
  function teacherForm(t, v) {
    t = t || {};
    const isAdmin = t.loginId === 'admin';
    modal('<h2>' + (t.id ? '교사 계정 수정' : '교사 계정 추가') + '</h2>'
      + '<div class="field"><label for="tf1">이름 (로그인할 때 쓰는 이름)</label><input id="tf1" class="input" value="' + esc(t.name) + '"></div>'
      + '<div class="field"><label for="tf8">부서</label><input id="tf8" class="input" value="' + esc(t.dept) + '" placeholder="예: 교무부, 3학년부"><span class="hint">같은 이름의 선생님이 있으면 꼭 넣어 주세요. 로그인할 때 이 부서를 고릅니다.</span></div>'
      + (isAdmin ? '<p class="hint">기본 관리자 계정은 이름 대신 <b>admin</b>으로도 로그인할 수 있습니다.</p>' : '')
      + '<div class="field"><label for="tf3">권한</label><select id="tf3" class="input">' + ROLES.map((r) => '<option ' + (r === (t.role || '교사') ? 'selected' : '') + '>' + r + '</option>').join('') + '</select></div>'
      + '<div class="row"><label class="field">담임 학년<input id="tf4" class="input sm" style="width:70px" value="' + esc(t.homeroomGrade) + '"></label>'
      + '<label class="field">담임 반<input id="tf5" class="input sm" style="width:70px" value="' + esc(t.homeroomClass) + '"></label>'
      + '<label class="field">교과<input id="tf6" class="input sm" style="width:120px" value="' + esc(t.subject) + '"></label></div>'
      + (t.id ? '<div class="field"><label for="tf7">상태</label><select id="tf7" class="input"><option ' + (t.status === '재직' ? 'selected' : '') + '>재직</option><option ' + (t.status === '전출' ? 'selected' : '') + '>전출</option><option ' + (t.status === '휴직' ? 'selected' : '') + '>휴직</option></select></div>' : '')
      + '<div class="row" style="justify-content:flex-end"><button class="btn" data-close>취소</button><button class="btn pri" id="tfs">저장</button></div>',
    (bg, close) => {
      const sb = bg.querySelector('#tfs');
      sb.onclick = () => run(sb, async () => {
        const st = bg.querySelector('#tf7');
        const payload = { id: t.id, name: bg.querySelector('#tf1').value.trim(), dept: bg.querySelector('#tf8').value.trim(), role: bg.querySelector('#tf3').value,
          homeroomGrade: bg.querySelector('#tf4').value.trim(), homeroomClass: bg.querySelector('#tf5').value.trim(), subject: bg.querySelector('#tf6').value.trim(), status: st ? st.value : '' };
        const r = await api('teacherSave', payload);
        close();
        if (r.code) showCode('교사 계정을 만들었습니다', payload.name + ' 선생님' + (payload.dept ? ' · ' + payload.dept : ''), r.code, { name: payload.name, dept: payload.dept, teacher: true, code: r.code });
        else toast('저장했습니다.');
        teachersView(v);
      });
    });
  }

  async function dataView(v) {
    const practiceUrl = location.origin + location.pathname + '?mode=practice';
    v.innerHTML = '<div class="grid2">'
      + '<div class="card" id="bk"><div class="row"><h2>백업·복원</h2><span style="margin-left:auto"></span>' + (MODE === 'real' ? '<button class="btn pri sm" id="bn">지금 백업</button>' : '') + '</div>'
      + (MODE === 'real' ? '<p class="hint">매일 새벽 2시와 명렬 적용 직전에 자동으로 백업합니다. 보관: 매일 30일 · 주간 12주 · 월말 12개월 · 작업 전 90일.</p><div id="bl"><div class="empty">불러오는 중…</div></div>'
        : '<div class="note">백업·복원은 실제 모드에서 사용합니다.</div>') + '</div>'
      + '<div class="card"><h2>연습 모드</h2>'
      + (MODE === 'real'
        ? '<p class="hint">실제 데이터와 완전히 분리된 연습용 공간입니다. 선생님 연수나 시범 운영에 쓰세요. 화면 위에 주황색 띠가 표시됩니다.</p><div class="row"><a class="btn" href="' + esc(practiceUrl) + '" target="_blank" rel="noopener">연습 모드 열기</a></div><p class="hint">연습 모드의 관리자 계정은 따로입니다. 이름 칸에 admin, 처음 비밀번호는 설치할 때 정한 ADMIN_INIT_CODE입니다.</p>'
        : '<div class="row"><label class="field small">학년별 반 수<input id="pc1" class="input sm" style="width:70px" value="11"></label><label class="field small">반별 인원<input id="pc2" class="input sm" style="width:70px" value="30"></label>'
          + '<button class="btn pri" id="pg" style="align-self:flex-end">연습 데이터 만들기</button></div><p class="hint">가상 학생(1·2학년)과 연습 교사 10명(teacher01~10)을 만들고, 기존 연습 데이터는 지웁니다. 쪽지는 교사 계정·학생 계정 화면에서 출력하세요.</p>')
      + '</div>'
      + '<div class="card" style="grid-column:1/-1" id="rsbox"><div class="row"><h2>데이터 초기화</h2><button class="btn sm" id="rsl">불러오기</button><span style="margin-left:auto"></span><button class="btn sm" id="ccl" title="구글 시트를 직접 고친 뒤 바로 반영할 때">캐시 비우기</button><button class="btn sm dan" id="zall">전체 초기화</button></div><p class="hint">항목별로 지웁니다. 지우기 전에 자동으로 백업하며, 위의 복원으로 되돌릴 수 있습니다. 교사 계정은 교사 계정 화면에서 골라 지웁니다.</p><div id="rst"></div></div>'
      + '<div class="card" style="grid-column:1/-1"><div class="row"><h2>변경 이력</h2><button class="btn sm" id="al">불러오기</button></div><div id="alog"></div></div></div>';
    const rsl = document.getElementById('rsl');
    const loadReset = async () => {
      const n = await api('dataCounts', {});
      const rows = [];
      Object.keys(n.students.byGrade).sort().forEach((g) => rows.push([g + '학년 학생 (모든 상태)', n.students.byGrade[g], 'students', g]));
      rows.push(['학생 전체', n.students.all, 'students', 'all']);
      Object.keys(n.freshmen).sort().forEach((y) => rows.push([y + ' 입학 1학년 (신입생·자리 포함)', n.freshmen[y], 'freshmen', y]));
      n.selections.forEach((r) => rows.push([(r.kind === '참고조사' ? '참고조사: ' : '수강신청: ') + r.name, r.count, 'selections', r.id]));
      Object.keys(n.history.byYear).sort().forEach((y) => rows.push(['이수 이력: ' + y + ' 입학생', n.history.byYear[y], 'history', y]));
      rows.push(['이수 이력 전체', n.history.all, 'history', 'all']);
      rows.push(['블록 편성 (모든 편성·분반·배정)', n.blocks, 'blocks', '']);
      rows.push(['시간표 (모든 버전)', n.timetable, 'timetable', '']);
      rows.push(['교사 불가 시간', n.unavailable, 'unavailable', '']);
      rows.push(['보강·교체·자습 기록', n.changes, 'changes', '']);
      rows.push(['알림', n.notices, 'notices', '']);
      document.getElementById('rst').innerHTML = '<div class="tbl-wrap" style="max-height:360px"><table class="tbl"><thead><tr><th>항목</th><th class="num">건수</th><th></th></tr></thead><tbody>'
        + rows.map((r, i) => '<tr><td>' + esc(r[0]) + '</td><td class="num">' + esc(r[1]) + '</td><td><button class="btn sm dan" data-rx="' + i + '"' + (r[1] ? '' : ' disabled') + '>초기화</button></td></tr>').join('') + '</tbody></table></div>';
      document.querySelectorAll('[data-rx]').forEach((b) => { const r = rows[Number(b.dataset.rx)]; b.onclick = () => resetData(r[0], r[2], r[3], loadReset); });
    };
    rsl.onclick = () => run(rsl, loadReset);
    document.getElementById('zall').onclick = () => confirmTyped(MODE === 'practice' ? '연습 모드 전체 초기화' : '전체 초기화',
      '<p>학생 명렬·계정, 수강신청·참고조사 내용, 이수 이력, 블록 편성, 시간표, 교사 불가 시간, 보강·교체 기록, 알림을 모두 지웁니다.</p>'
      + '<label class="row"><input type="checkbox" id="zt"> 교사 계정도 지우기 (본인과 admin 계정은 남김)</label>'
      + '<label class="row"><input type="checkbox" id="zs"> 교육과정·신청 회차·일과 시간도 지우기</label>'
      + '<p class="hint">학교 이름·학년도·학급 설정은 남습니다. ' + (MODE === 'real' ? '지우기 전에 자동으로 백업하며, 위의 복원으로 되돌릴 수 있습니다.' : '연습 모드는 백업하지 않습니다.') + '</p>',
      async () => {
        const r = await api('dataReset', { target: 'all', scope: '', confirm: '삭제', withTeachers: document.getElementById('zt').checked, withSetup: document.getElementById('zs').checked });
        toast('전체 초기화했습니다. (' + r.removed + '건)'); loadReset();
      });
    const ccl = document.getElementById('ccl');
    ccl.onclick = () => run(ccl, async () => { await api('cacheClear', {}); clearReadCache(); toast('캐시를 비웠습니다. 시트에서 직접 고친 내용이 바로 반영됩니다.'); });
    const al = document.getElementById('al');
    al.onclick = () => run(al, async () => {
      const list = await api('auditList', {});
      document.getElementById('alog').innerHTML = '<div class="tbl-wrap"><table class="tbl"><thead><tr><th>시각</th><th>사용자</th><th>작업</th><th>대상</th><th>내용</th></tr></thead><tbody>'
        + list.map((x) => '<tr><td class="muted">' + esc(x.시각) + '</td><td>' + esc(x.사용자) + '</td><td>' + esc(x.작업) + '</td><td>' + esc(x.대상) + '</td><td class="small">' + esc(x.내용) + '</td></tr>').join('') + '</tbody></table></div>';
    });
    const pg = document.getElementById('pg');
    if (pg) pg.onclick = () => {
      if (!confirm('연습 데이터를 새로 만들까요? 기존 연습 데이터는 지워집니다.')) return;
      run(pg, async () => { const r = await api('practiceGenerate', { classes: document.getElementById('pc1').value, perClass: document.getElementById('pc2').value }); toast('학생 ' + r.students + '명, 교사 ' + r.teachers + '명을 만들었습니다.'); });
    };
    if (MODE !== 'real') return;
    const bn = document.getElementById('bn');
    const loadList = async () => {
      let list;
      try { list = await api('backupList', {}); } catch (e) { document.getElementById('bl').innerHTML = '<div class="note err">' + esc(e.message) + '</div>'; return; }
      document.getElementById('bl').innerHTML = '<div class="tbl-wrap" style="max-height:340px"><table class="tbl"><thead><tr><th>백업</th><th></th></tr></thead><tbody>'
        + (list.length ? list.map((b) => '<tr><td>' + esc(b.name) + '</td><td><button class="btn sm" data-rs="' + esc(b.id) + '" data-nm="' + esc(b.name) + '">복원</button></td></tr>').join('') : '<tr><td colspan="2" class="empty">아직 백업이 없습니다.</td></tr>')
        + '</tbody></table></div>';
      document.querySelectorAll('[data-rs]').forEach((b) => {
        b.onclick = () => modal('<h2>복원</h2><p class="muted">' + esc(b.dataset.nm) + '</p>'
          + '<label class="row"><input type="checkbox" value="core" checked> 기본 DB (명렬·계정·설정)</label><label class="row"><input type="checkbox" value="sel" checked> 신청 DB</label><label class="row"><input type="checkbox" value="tt" checked> 시간표 DB</label>'
          + '<div class="note warn">복원하기 직전의 현재 상태를 자동으로 백업하므로 되돌릴 수 있습니다. 로그인 정보는 유지됩니다.</div>'
          + '<div class="row" style="justify-content:flex-end"><button class="btn" data-close>취소</button><button class="btn pri" id="rsok">복원</button></div>',
        (bg, close) => {
          const ok = bg.querySelector('#rsok');
          ok.onclick = () => run(ok, async () => {
            const kinds = Array.from(bg.querySelectorAll('input[type=checkbox]:checked')).map((i) => i.value);
            if (!kinds.length) { toast('복원할 DB를 골라 주세요.', true); return; }
            const r = await api('restore', { folderId: b.dataset.rs, kinds });
            close(); toast('복원했습니다. (복원 전 백업: ' + r.safety + ')'); loadList();
          });
        });
      });
    };
    bn.onclick = () => run(bn, async () => { const r = await api('backupNow', {}); toast('백업했습니다: ' + r.name); loadList(); });
    loadList();
  }

  /* ---------- 다른 파일(sel.js)과 함께 쓰는 도구 ---------- */
  window.APP = { api, esc, toast, run, modal, saveBlob, render, renderHome, VIEWS, isAdmin, canViewAll, CFG, resetData, confirmTyped, needXLSX, clearReadCache,
    get S() { return S; }, get ui() { return ui; }, MODE };
  async function loadRounds() {
    if (!S.user || S.user.kind !== 'student') return;
    try { S.rounds = await api('selHome', {}); save(); } catch (e) { /* 무시 */ }
  }
  APP.loadRounds = loadRounds;

  /* ---------- 시작 ---------- */
  async function boot() {
    render();
    if ('serviceWorker' in navigator && location.protocol === 'https:') {
      // 새 버전 화면 파일이 설치되면 한 번 새로고침해 바로 새 화면으로
      const had = !!navigator.serviceWorker.controller;
      let reloaded = false;
      navigator.serviceWorker.addEventListener('controllerchange', () => { if (had && !reloaded) { reloaded = true; location.reload(); } });
      navigator.serviceWorker.register('sw.js').catch(() => {});
    }
    // 서버 확인과 내 정보 확인을 동시에
    const pingP = api('ping', {}).then((p) => { ui.school = p.schoolName || ''; ui.year = p.year || ''; ui.serverVersion = p.version || ''; }).catch(() => {});
    const meP = S.token ? api('me', {}).then((m) => { S.user = m.user; S.must = m.mustChangePassword; save(); }).catch(() => {}) : Promise.resolve();
    await Promise.all([pingP, meP]);
    if (S.token && !S.must) await loadRounds();
    render();
    if (S.user && S.user.kind === 'teacher') setTimeout(() => { needXLSX().catch(() => {}); needQR().catch(() => {}); }, 1500);
  }
  boot();
})();
