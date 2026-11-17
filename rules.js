/* ===== 이수 기준 검증 엔진 (서버·화면 공용) — 이 파일을 고친 뒤 build.js로 Code.gs에 다시 넣습니다 ===== */
var RULES = (function () {
  var SEMS = ['1-1', '1-2', '2-1', '2-2', '3-1', '3-2'];
  var AREAS = ['국어', '수학', '영어', '사회', '과학', '체육', '예술', '제2외·한문·정보·교양'];

  function norm(s) {
    return String(s == null ? '' : s).replace(/Ⅰ/g, 'I').replace(/Ⅱ/g, 'II').replace(/Ⅲ/g, 'III')
      .replace(/[\s·・•\-_.,()（）]/g, '').toUpperCase();
  }
  function semIdx(s) { return SEMS.indexOf(String(s)); }
  function semLabel(s) { var p = String(s).split('-'); return p.length === 2 ? p[0] + '학년 ' + p[1] + '학기' : String(s); }
  function q(s) { return '「' + s + '」'; }
  function num(v, d) { var n = Number(v); return isFinite(n) && String(v) !== '' ? n : d; }

  /** 교육과정 정리: 학기별 지정·선택 과목과 그룹 */
  function index(cur) {
    var by = {}, groups = {}, any = {};
    SEMS.forEach(function (s) { by[s] = { list: [], map: {}, designated: [], electives: [] }; groups[s] = {}; });
    (cur.subjects || []).forEach(function (r) {
      var s = String(r.학기); if (!by[s]) return;
      var o = { sem: s, name: String(r.과목), key: norm(r.과목), credit: num(r.학점, 0), kind: r.구분 === '지정' ? '지정' : '선택',
        group: String(r.그룹 || ''), area: String(r.교과군 || ''), order: num(r.순서, 0) };
      by[s].list.push(o); by[s].map[o.key] = o;
      (o.kind === '지정' ? by[s].designated : by[s].electives).push(o);
      if (!any[o.key]) any[o.key] = o;
    });
    (cur.groups || []).forEach(function (g) {
      var s = String(g.학기); if (!groups[s]) return;
      groups[s][String(g.그룹)] = { sem: s, id: String(g.그룹), name: String(g.이름 || ''), pick: num(g.택수, 1) };
    });
    SEMS.forEach(function (s) {
      by[s].electives.forEach(function (o) {
        if (o.group && !groups[s][o.group]) groups[s][o.group] = { sem: s, id: o.group, name: '', pick: 1 };
      });
    });
    var rules = (cur.rules || []).map(function (r) {
      return { kind: String(r.종류), target: String(r.대상 || ''), value: num(r.값, 0), name: String(r.이름 || '') };
    });
    return { by: by, groups: groups, any: any, rules: rules, links: cur.links || [] };
  }

  function semTarget(ix) {
    var r = ix.rules.filter(function (x) { return x.kind === '학기학점'; })[0];
    return r ? r.value : 0;
  }

  /**
   * plan = { picks: {학기:[과목명]}, roundSems:[], refSems:[], fixed: {학기: [{과목, 학점?, 교과군?}] }, fixedSource: {학기:'이수 이력'|'이전 신청'} }
   * opts = { strict: 제출 검사 여부 }
   */
  function validate(cur, plan, opts) {
    opts = opts || {};
    var ix = cur && cur.by ? cur : index(cur || {});
    var round = (plan.roundSems || []).map(String);
    var picks = plan.picks || {};
    var fixed = plan.fixed || {};
    var msgs = [];
    var add = function (level, sem, text, extra) { var m = { level: level, sem: sem || '', text: text }; if (extra) for (var k in extra) m[k] = extra[k]; msgs.push(m); };
    var taken = [];          // {sem, name, key, credit, area, kind, from}
    var unknownSems = [];
    var groupStatus = {};
    var complete = true;

    SEMS.forEach(function (s) {
      var B = ix.by[s];
      B.designated.forEach(function (o) { taken.push({ sem: s, name: o.name, key: o.key, credit: o.credit, area: o.area, kind: '지정', from: '편제' }); });
      if (round.indexOf(s) >= 0) {
        groupStatus[s] = {};
        Object.keys(ix.groups[s]).forEach(function (g) { groupStatus[s][g] = { need: ix.groups[s][g].pick, have: 0, name: ix.groups[s][g].name }; });
        var seen = {};
        (picks[s] || []).forEach(function (nm) {
          var k = norm(nm), o = B.map[k];
          if (seen[k]) return; seen[k] = 1;
          if (!o) { add('error', s, semLabel(s) + '에 개설되지 않은 과목입니다: ' + q(nm), { code: 'NOT_OFFERED', subj: nm }); return; }
          if (o.kind === '지정') return;
          taken.push({ sem: s, name: o.name, key: o.key, credit: o.credit, area: o.area, kind: '선택', group: o.group, from: '선택' });
          if (groupStatus[s][o.group]) groupStatus[s][o.group].have++;
        });
        Object.keys(groupStatus[s]).forEach(function (g) {
          var st = groupStatus[s][g];
          if (st.have > st.need) add('error', s, semLabel(s) + ' ' + (st.name || '선택') + ': ' + st.need + '과목만 고를 수 있는데 ' + st.have + '과목을 골랐습니다.', { code: 'OVER', group: g });
          else if (st.have < st.need) {
            complete = false;
            if (opts.strict) add('error', s, semLabel(s) + ' ' + (st.name || '선택') + ': ' + (st.need - st.have) + '과목을 더 골라야 합니다.', { code: 'UNDER', group: g });
          }
        });
      } else if (fixed[s] && fixed[s].length) {
        var seenF = {};
        fixed[s].forEach(function (h) {
          var k = norm(h.과목); if (!k || seenF[k]) return; seenF[k] = 1;
          var o = B.map[k] || ix.any[k];
          if (o && o.kind === '지정' && B.map[k]) return; // 지정 과목은 이미 포함
          var credit = num(h.학점, o ? o.credit : 0);
          var area = h.교과군 || (o ? o.area : '');
          if (!area) add('warn', s, semLabel(s) + ' ' + q(h.과목) + '의 교과군을 알 수 없어 교과군 학점 계산에서 빠졌습니다. 교육과정에 과목을 추가하거나 이력에 교과군을 넣어 주세요.', { code: 'NO_AREA', subj: h.과목 });
          taken.push({ sem: s, name: h.과목, key: k, credit: credit, area: area, kind: '선택', from: (plan.fixedSource && plan.fixedSource[s]) || '이수 이력' });
        });
      } else if (B.electives.length) {
        unknownSems.push(s);
      }
    });

    // 같은 과목 중복
    var byKey = {};
    taken.forEach(function (t) { (byKey[t.key] = byKey[t.key] || []).push(t); });
    Object.keys(byKey).forEach(function (k) {
      var arr = byKey[k];
      if (arr.length > 1) {
        var inRound = arr.some(function (t) { return round.indexOf(t.sem) >= 0 && t.from === '선택'; });
        add(inRound ? 'error' : 'warn', arr[arr.length - 1].sem, q(arr[0].name) + ' 과목을 두 번 들을 수 없습니다. (' + arr.map(function (t) { return semLabel(t.sem); }).join(', ') + ')', { code: 'DUP', subj: arr[0].name });
      }
    });

    // 학기별 학점
    var target = semTarget(ix);
    var semTotals = {};
    SEMS.forEach(function (s) {
      var sum = 0; taken.forEach(function (t) { if (t.sem === s) sum += t.credit; });
      var known = unknownSems.indexOf(s) < 0;
      var semComplete = round.indexOf(s) < 0 || Object.keys(groupStatus[s] || {}).every(function (g) { return groupStatus[s][g].have >= groupStatus[s][g].need; });
      semTotals[s] = { credits: sum, target: target, known: known, inRound: round.indexOf(s) >= 0 };
      if (target && known && semComplete && sum !== target) {
        var inR = round.indexOf(s) >= 0;
        add(inR ? 'error' : 'warn', s, semLabel(s) + ' 학점 합계가 ' + sum + '학점입니다. ' + target + '학점이어야 합니다.', { code: 'SEM_TOTAL' });
      }
    });

    // 교과군 합계
    var areaTotals = {};
    AREAS.forEach(function (a) { areaTotals[a] = 0; });
    taken.forEach(function (t) { if (t.area) areaTotals[t.area] = (areaTotals[t.area] || 0) + t.credit; });
    var allKnown = !unknownSems.length;
    var takenKeys = {}; taken.forEach(function (t) { takenKeys[t.key] = 1; });

    // 남은 선택으로 더 얻을 수 있는 최대 학점 (교과군 집합별)
    function maxAddable(areaSet) {
      var total = 0;
      round.forEach(function (s) {
        Object.keys(groupStatus[s] || {}).forEach(function (g) {
          var st = groupStatus[s][g], left = st.need - st.have;
          if (left <= 0) return;
          var cands = ix.by[s].electives.filter(function (o) { return o.group === g && !takenKeys[o.key] && areaSet.indexOf(o.area) >= 0; })
            .map(function (o) { return o.credit; }).sort(function (a, b) { return b - a; });
          for (var i = 0; i < left && i < cands.length; i++) total += cands[i];
        });
      });
      return total;
    }

    var ruleStatus = [];
    ix.rules.forEach(function (r) {
      if (r.kind !== '최대' && r.kind !== '최소') return;
      var set = r.target.split('+').map(function (x) { return x.trim(); }).filter(Boolean);
      var cur2 = 0; set.forEach(function (a) { cur2 += areaTotals[a] || 0; });
      var label = r.name || set.join('·');
      var st = { name: label, kind: r.kind, value: r.value, current: cur2, ok: true, final: complete && allKnown };
      if (r.kind === '최대') {
        if (cur2 > r.value) { st.ok = false; add('error', '', label + ' 학점이 ' + cur2 + '학점입니다. ' + r.value + '학점 이하여야 합니다.', { code: 'MAX', rule: label }); }
      } else if (cur2 < r.value) {
        st.ok = false;
        if (complete && allKnown) add('error', '', label + ' 학점이 ' + cur2 + '학점으로 부족합니다. ' + r.value + '학점 이상이어야 합니다.', { code: 'MIN', rule: label });
        else if (!complete) {
          var possible = cur2 + maxAddable(set);
          if (possible < r.value) add('error', '', label + ' 학점이 부족합니다. 남은 선택을 모두 써도 ' + possible + '학점이라 ' + r.value + '학점을 채울 수 없습니다. 고른 과목을 바꿔 주세요.', { code: 'MIN_IMPOSSIBLE', rule: label });
          else add('tip', '', label + ': 지금 ' + cur2 + '학점, ' + r.value + '학점 이상 필요 — ' + label + ' 과목을 ' + (r.value - cur2) + '학점 더 골라야 합니다.', { code: 'MIN_LEFT', rule: label });
        }
      }
      ruleStatus.push(st);
    });
    if (unknownSems.length && round.length) {
      add('warn', '', unknownSems.map(semLabel).join(', ') + ' 선택 과목 기록이 없어 교과군 최소 학점과 연계 과목 일부는 확인하지 못했습니다. 관리자에게 이수 이력 업로드를 요청하세요.', { code: 'UNKNOWN_SEM' });
    }

    // 연계
    var firstSem = {};
    taken.forEach(function (t) { if (firstSem[t.key] == null || semIdx(t.sem) < semIdx(firstSem[t.key])) firstSem[t.key] = t.sem; });
    (ix.links || []).forEach(function (l) {
      if (String(l.사용 || 'Y').toUpperCase() === 'N') return;
      var kind = String(l.종류 || '주의'), A = String(l.앞과목 || ''), Bn = String(l.뒤과목 || '');
      var a = norm(A), b = norm(Bn);
      if (!a || !b) return;
      var aSem = firstSem[a], bSem = firstSem[b];
      var custom = String(l.문구 || '').trim();
      if (bSem && (kind === '필수' || kind === '주의')) {
        var okOrder = aSem && semIdx(aSem) <= semIdx(bSem);
        if (!okOrder) {
          var unsure = !aSem && unknownSems.some(function (s) { return semIdx(s) <= semIdx(bSem); });
          var text = custom || (kind === '필수'
            ? q(Bn) + ' 과목을 들으려면 ' + q(A) + ' 과목을 먼저(또는 같은 학기에) 들어야 합니다.'
            : q(Bn) + ' 과목은 ' + q(A) + ' 과목을 먼저 들으면 이해하기 쉽습니다.');
          if (unsure) add('warn', bSem, text + ' (이전 학기 기록이 없어 확인이 필요합니다)', { code: 'LINK_UNSURE', subj: Bn });
          else add(kind === '필수' ? 'error' : 'warn', bSem, text, { code: kind === '필수' ? 'LINK_REQ' : 'LINK_WARN', subj: Bn });
        }
      }
      if (aSem && !bSem) {
        var offered = round.filter(function (s) { return semIdx(s) >= semIdx(aSem) && ix.by[s].map[b] && ix.by[s].map[b].kind === '선택'; });
        if (offered.length) {
          var t2 = (kind === '추천' && custom) ? custom
            : q(A) + ' 과목을 골랐다면 ' + semLabel(offered[0]) + '의 ' + q(Bn) + ' 과목으로 이어서 공부하는 것을 추천합니다.';
          add('tip', offered[0], t2, { code: 'LINK_TIP', subj: Bn, from: A });
        }
      }
    });

    var errors = msgs.filter(function (m) { return m.level === 'error'; }).length;
    return {
      ok: errors === 0 && (!opts.strict || complete),
      complete: complete, errors: errors,
      messages: msgs, groupStatus: groupStatus, semTotals: semTotals, areaTotals: areaTotals,
      ruleStatus: ruleStatus, unknownSems: unknownSems, taken: taken,
    };
  }

  /** 연계 문구 자동 생성 (관리자 화면 미리보기용) */
  function linkText(l) {
    var A = l.앞과목, B = l.뒤과목;
    if (String(l.문구 || '').trim()) return l.문구;
    if (l.종류 === '필수') return q(B) + ' 과목을 들으려면 ' + q(A) + ' 과목을 먼저(또는 같은 학기에) 들어야 합니다.';
    if (l.종류 === '추천') return q(A) + ' 과목을 골랐다면 ' + q(B) + ' 과목으로 이어서 공부하는 것을 추천합니다.';
    return q(B) + ' 과목은 ' + q(A) + ' 과목을 먼저 들으면 이해하기 쉽습니다.';
  }

  return { SEMS: SEMS, AREAS: AREAS, norm: norm, index: index, validate: validate, semLabel: semLabel, linkText: linkText };
})();
if (typeof module !== 'undefined') module.exports = RULES;
