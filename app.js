/* 일과 알리미 — 1단계(기반) 앱 */
(function () {
  'use strict';
  const CFG = window.APP_CONFIG || {};
  const MODE = new URLSearchParams(location.search).get('mode') === 'practice' ? 'practice' : 'real';
  const KEY = 'alimi:' + MODE;
  const ROLES = ['최종관리자', '일과담당', '수정', '조회', '교사'];
  const $app = document.getElementById('app');
  let S = load();
  let ui = { tab: null, loginTab: 'student', classNeed: null, school: '', year: '' };

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
  async function api(action, payload) {
    if (!CFG.API_URL || CFG.API_URL.indexOf('http') !== 0) throw new Error('config.js에 서버 주소(API_URL)를 먼저 넣어 주세요.');
    let res;
    try {
      res = await fetch(apiUrl(), { method: 'POST', headers: { 'Content-Type': 'text/plain;charset=utf-8' },
        body: JSON.stringify({ action, payload: payload || {}, token: S.token || '', mode: MODE }) });
    } catch (e) { const x = new Error('서버에 연결할 수 없습니다.'); x.code = 'NET'; throw x; }
    let j;
    try { j = await res.json(); } catch (e) { const x = new Error('서버 응답을 읽을 수 없습니다.'); x.code = 'NET'; throw x; }
    if (!j.ok) {
      const e = new Error(j.message || '오류가 발생했습니다.'); e.code = j.error;
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
    bg.addEventListener('click', (e) => { if (e.target === bg || e.target.closest('[data-close]')) close(); });
    if (onReady) onReady(bg, close);
    const f = bg.querySelector('button, input'); if (f) f.focus();
    return close;
  }

  /* ---------- 쪽지 인쇄 ---------- */
  function printSlips(list, title) {
    const school = ui.school || CFG.SCHOOL_NAME || '';
    const url = appUrl();
    let qr = '';
    try { const q = window.qrcode(0, 'M'); q.addData(url); q.make(); qr = q.createSvgTag(3, 0); } catch (e) { qr = ''; }
    const cards = list.map((x) => {
      const who = x.loginId ? ('선생님 · 아이디 ' + esc(x.loginId)) : (esc(x.grade) + '학년 ' + esc(x.classNo) + '반 ' + esc(x.number) + '번');
      return '<div class="slip"><div class="qr">' + qr + '</div><div><div class="s">' + esc(school) + ' · 일과 알리미' + (MODE === 'practice' ? ' (연습)' : '') + '</div>'
        + '<div><strong>' + esc(x.name) + '</strong> · ' + who + '</div><div class="s">개별 코드</div><div class="c">' + esc(x.code) + '</div>'
        + '<div class="s">' + esc(url) + '<br>처음 로그인할 때 이름(아이디)과 이 코드를 넣고, 바로 나만의 비밀번호를 정합니다. 남에게 보여주지 마세요.</div></div></div>';
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
    다른이름: '다른이름', '다른이름(영문·원어)': '다른이름', 영문이름: '다른이름', 원어이름: '다른이름', 성별: '성별', 구분: '구분' };
  function readSheet(file) {
    return new Promise((resolve, reject) => {
      if (!window.XLSX) { reject(new Error('엑셀 읽기 도구를 불러오지 못했습니다. 인터넷 연결을 확인해 주세요.')); return; }
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
    status: { file: '전출_휴학_복학_양식.xlsx', head: ['학번', '성명', '구분'], ex: [['20105', '홍길동', '전출'], ['20211', '김하늘', '휴학']] },
    freshman: { file: '신입생_명렬_양식.xlsx', head: ['반', '번호', '성명', '다른이름(영문·원어)', '성별', '학번'],
      ex: [['1', '1', '홍길동', '', '남', ''], ['1', '2', '김하늘', '', '여', '']] },
  };
  function downloadTemplate(k) {
    if (!window.XLSX) { toast('엑셀 도구를 불러오는 중입니다. 잠시 후 다시 눌러 주세요.', true); return; }
    const t = TEMPLATES[k];
    const ws = window.XLSX.utils.aoa_to_sheet([t.head].concat(t.ex));
    ws['!cols'] = t.head.map(() => ({ wch: 14 }));
    const wb = window.XLSX.utils.book_new();
    window.XLSX.utils.book_append_sheet(wb, ws, '명렬');
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
  function banner() { return MODE === 'practice' ? '<div class="practice">연습 모드 — 실제 데이터가 아닙니다</div>' : ''; }

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
        : '<div class="field"><label for="ln">아이디</label><input id="ln" class="input" autocomplete="username" required placeholder="아이디"></div>')
      + '<div class="field"><label for="lp">비밀번호</label><input id="lp" class="input" type="password" autocomplete="current-password" required placeholder="처음에는 받은 개별 코드"></div>'
      + (cls ? '<div class="field"><label for="lc">학년·반 선택</label><select id="lc" class="input">' + cls.map((o, i) => '<option value="' + i + '">' + esc(o.grade) + '학년 ' + esc(o.classNo) + '반</option>').join('') + '</select><span class="hint">같은 이름의 학생이 있어 학년·반을 한 번 더 확인합니다.</span></div>' : '')
      + '<button class="btn pri big" type="submit">로그인</button></form>'
      + '<p class="hint">한 번 로그인하면 이 기기에서 계속 유지됩니다. 로그인이 안 되면 ' + (st ? '담임 선생님께' : '관리 담당 선생님께') + ' 문의하세요.</p>'
      + '<button type="button" class="btn sm" id="dgb" style="align-self:flex-start">서버 연결 점검</button>'
      + '</div></div>';
    $app.querySelectorAll('[data-lt]').forEach((b) => { b.onclick = () => { ui.loginTab = b.dataset.lt; ui.classNeed = null; renderLogin(); }; });
    document.getElementById('dgb').onclick = showDiagnosis;
    const f = document.getElementById('lf');
    if (ui.lastName) document.getElementById('ln').value = ui.lastName;
    f.onsubmit = (e) => {
      e.preventDefault();
      const name = document.getElementById('ln').value.trim();
      const secret = document.getElementById('lp').value;
      ui.lastName = name;
      run(f.querySelector('button[type=submit]'), async () => {
        let d;
        if (st) {
          const payload = { name, secret };
          if (cls) { const o = cls[Number(document.getElementById('lc').value)]; payload.grade = o.grade; payload.classNo = o.classNo; }
          d = await api('studentLogin', payload);
          if (d.need === 'class') { ui.classNeed = d.options; renderLogin(); document.getElementById('lp').value = secret; toast('학년·반을 골라 주세요.'); return; }
        } else {
          d = await api('teacherLogin', { loginId: name, secret });
        }
        S = { token: d.token, user: d.user, must: !!d.mustChangePassword }; save();
        ui.classNeed = null; ui.tab = null; ui.lastName = '';
        if (!S.must) await loadRounds();
        render();
      });
    };
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
        + '<div>' + esc(u.name) + (u.kind === 'student' ? ' · ' + esc(u.grade) + '학년 ' + esc(u.classNo) + '반 ' + esc(u.number) + '번 (학번 ' + esc(u.studentNo) + ')' : ' · 아이디 ' + esc(u.loginId)) + '</div>'
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

  async function classAccounts(v, grade, classNo, own) {
    v.innerHTML = '<div class="card"><div class="empty">불러오는 중…</div></div>';
    let d;
    try { d = await api('studentList', { grade, classNo }); } catch (e) { v.innerHTML = '<div class="note err">' + esc(e.message) + '</div>'; return; }
    const pend = d.students.filter((s) => s.pending).length;
    v.innerHTML = '<div class="card"><div class="row"><h2>' + esc(grade) + '학년 ' + esc(classNo) + '반' + (own ? ' (우리 반)' : '') + '</h2>'
      + '<span class="pill">' + d.students.length + '명</span><span class="pill ' + (pend ? 'warn' : 'ok') + '">비밀번호 미설정 ' + pend + '명</span>'
      + '<span style="margin-left:auto"></span>' + (d.canReset && pend ? '<button class="btn sm" id="sl">미설정 학생 쪽지 출력</button>' : '') + '</div>'
      + '<div class="tbl-wrap"><table class="tbl"><thead><tr><th>번호</th><th>이름</th><th>상태</th><th>비밀번호</th><th>마지막 접속</th>' + (d.canReset ? '<th></th>' : '') + '</tr></thead><tbody>'
      + (d.students.length ? d.students.map((s) => '<tr><td>' + esc(s.number) + '</td><td>' + esc(s.name || '(이름 미정)') + (s.altName ? ' <span class="muted">' + esc(s.altName) + '</span>' : '') + '</td>'
        + '<td>' + esc(s.status) + '</td><td>' + (s.pending ? '<span class="pill warn">코드 대기</span>' : '<span class="pill ok">설정 완료</span>') + '</td>'
        + '<td class="muted">' + esc(s.lastSeen || '-') + '</td>'
        + (d.canReset ? '<td>' + (s.status === '미정' ? '' : '<button class="btn sm dan" data-reset="' + esc(s.id) + '" data-name="' + esc(s.name) + '">초기화</button>') + '</td>' : '') + '</tr>').join('')
        : '<tr><td colspan="6" class="empty">학생이 없습니다.</td></tr>')
      + '</tbody></table></div><p class="hint">초기화하면 그 학생의 비밀번호가 지워지고 새 개별 코드가 발급됩니다. 기존 로그인도 끊깁니다.</p></div>';
    const sl = document.getElementById('sl');
    if (sl) sl.onclick = () => run(sl, async () => { const list = await api('slips', { grade, classNo }); printSlips(list, grade + '학년 ' + classNo + '반 개별 코드'); });
    v.querySelectorAll('[data-reset]').forEach((b) => {
      b.onclick = () => {
        if (!confirm(b.dataset.name + ' 학생의 비밀번호를 초기화할까요?')) return;
        run(b, async () => {
          const r = await api('studentReset', { studentId: b.dataset.reset });
          const s = r.student;
          showCode('새 개별 코드', s.grade + '학년 ' + s.classNo + '반 ' + s.number + '번 ' + s.name, r.code, Object.assign({}, s, { code: r.code }));
          classAccounts(v, grade, classNo, own);
        });
      };
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
      + '<label class="row"><input type="radio" name="rm" value="status"> <b>상태 변경</b> 전출·휴학·복학·졸업</label></div></div>'
      + '<div class="card" id="rbox"><h2>3. 파일 올리기 → 미리보기 → 적용</h2><input type="file" data-file accept=".xlsx,.xls,.csv" class="input"><div data-out></div></div>';
    v.querySelectorAll('[data-t]').forEach((b) => { b.onclick = () => downloadTemplate(b.dataset.t); });
    uploadFlow(document.getElementById('rbox'), (rows) => {
      const mode = v.querySelector('input[name=rm]:checked').value;
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
      + '<input type="file" data-file accept=".xlsx,.xls,.csv" class="input"><div data-out></div></div></div>';
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
    v.innerHTML = '<div class="card"><div class="row"><h2>교사 계정</h2><span class="pill">' + list.length + '명</span><span style="margin-left:auto"></span><button class="btn pri sm" id="tn">계정 추가</button></div>'
      + '<div class="tbl-wrap"><table class="tbl"><thead><tr><th>이름</th><th>아이디</th><th>권한</th><th>담임</th><th>교과</th><th>상태</th><th>비밀번호</th><th>마지막 접속</th><th></th></tr></thead><tbody>'
      + list.map((t) => '<tr><td>' + esc(t.name) + '</td><td>' + esc(t.loginId) + '</td><td>' + esc(t.role) + '</td><td>' + (t.homeroomGrade ? esc(t.homeroomGrade) + '-' + esc(t.homeroomClass) : '') + '</td>'
        + '<td>' + esc(t.subject) + '</td><td>' + esc(t.status) + '</td><td>' + (t.pending ? '<span class="pill warn">코드 대기</span>' : '<span class="pill ok">설정 완료</span>') + '</td>'
        + '<td class="muted">' + esc(t.lastSeen || '-') + '</td><td class="row"><button class="btn sm" data-edit="' + esc(t.id) + '">수정</button><button class="btn sm dan" data-treset="' + esc(t.id) + '">초기화</button></td></tr>').join('')
      + '</tbody></table></div><p class="hint">권한: 최종관리자(모든 기능) · 일과담당(보강·교체 승인) · 수정(학생 선택 수정) · 조회(조회만) · 교사(본인 시간표). 담임을 지정하면 그 반 학생 비밀번호를 초기화할 수 있습니다.</p></div>';
    document.getElementById('tn').onclick = () => teacherForm(null, v);
    v.querySelectorAll('[data-edit]').forEach((b) => { b.onclick = () => teacherForm(list.find((t) => t.id === b.dataset.edit), v); });
    v.querySelectorAll('[data-treset]').forEach((b) => {
      b.onclick = () => {
        const t = list.find((x) => x.id === b.dataset.treset);
        if (!confirm(t.name + ' 선생님의 비밀번호를 초기화할까요?')) return;
        run(b, async () => {
          const r = await api('teacherReset', { id: t.id });
          showCode('새 개별 코드', r.name + ' 선생님 · 아이디 ' + r.loginId, r.code, { name: r.name, loginId: r.loginId, code: r.code });
          teachersView(v);
        });
      };
    });
  }
  function teacherForm(t, v) {
    t = t || {};
    modal('<h2>' + (t.id ? '교사 계정 수정' : '교사 계정 추가') + '</h2>'
      + '<div class="field"><label for="tf1">이름</label><input id="tf1" class="input" value="' + esc(t.name) + '"></div>'
      + '<div class="field"><label for="tf2">아이디 (영문 소문자·숫자)</label><input id="tf2" class="input" value="' + esc(t.loginId) + '" ' + (t.loginId === 'admin' ? 'readonly' : '') + '></div>'
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
        const payload = { id: t.id, name: bg.querySelector('#tf1').value.trim(), loginId: bg.querySelector('#tf2').value.trim(), role: bg.querySelector('#tf3').value,
          homeroomGrade: bg.querySelector('#tf4').value.trim(), homeroomClass: bg.querySelector('#tf5').value.trim(), subject: bg.querySelector('#tf6').value.trim(), status: st ? st.value : '' };
        const r = await api('teacherSave', payload);
        close();
        if (r.code) showCode('교사 계정을 만들었습니다', payload.name + ' 선생님 · 아이디 ' + payload.loginId, r.code, { name: payload.name, loginId: payload.loginId, code: r.code });
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
        ? '<p class="hint">실제 데이터와 완전히 분리된 연습용 공간입니다. 선생님 연수나 시범 운영에 쓰세요. 화면 위에 주황색 띠가 표시됩니다.</p><div class="row"><a class="btn" href="' + esc(practiceUrl) + '" target="_blank" rel="noopener">연습 모드 열기</a></div><p class="hint">연습 모드의 관리자 계정은 따로입니다. 아이디 admin, 처음 비밀번호는 설치할 때 정한 ADMIN_INIT_CODE입니다.</p>'
        : '<div class="row"><label class="field small">학년별 반 수<input id="pc1" class="input sm" style="width:70px" value="11"></label><label class="field small">반별 인원<input id="pc2" class="input sm" style="width:70px" value="30"></label>'
          + '<button class="btn pri" id="pg" style="align-self:flex-end">연습 데이터 만들기</button></div><p class="hint">가상 학생(1·2학년)과 연습 교사 10명(teacher01~10)을 만들고, 기존 연습 데이터는 지웁니다. 쪽지는 교사 계정·학생 계정 화면에서 출력하세요.</p>')
      + '</div>'
      + '<div class="card" style="grid-column:1/-1"><div class="row"><h2>변경 이력</h2><button class="btn sm" id="al">불러오기</button></div><div id="alog"></div></div></div>';
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
  window.APP = { api, esc, toast, run, modal, saveBlob, render, renderHome, VIEWS, isAdmin, canViewAll, CFG,
    get S() { return S; }, get ui() { return ui; }, MODE };
  async function loadRounds() {
    if (!S.user || S.user.kind !== 'student') return;
    try { S.rounds = await api('selHome', {}); save(); } catch (e) { /* 무시 */ }
  }
  APP.loadRounds = loadRounds;

  /* ---------- 시작 ---------- */
  async function boot() {
    render();
    if ('serviceWorker' in navigator && location.protocol === 'https:') navigator.serviceWorker.register('sw.js').catch(() => {});
    try {
      const p = await api('ping', {});
      ui.school = p.schoolName || ''; ui.year = p.year || '';
      if (!S.token) renderLogin();
    } catch (e) { /* 서버 연결 실패는 로그인 시 안내 */ }
    if (S.token) { try { const m = await api('me', {}); S.user = m.user; S.must = m.mustChangePassword; save(); if (!S.must) await loadRounds(); render(); } catch (e) { /* 처리됨 */ } }
  }
  boot();
})();
