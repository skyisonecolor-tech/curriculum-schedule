/* ===== 시간표 자료 변환 (화면·시험 공용): 서버 자료 ↔ 엔진 입력 ↔ 저장 행 ===== */
var TTM = (function () {
  function classesFrom(d) {
    var out = [];
    d.grades.forEach(function (g) {
      for (var c = 1; c <= (Number(g.classes) || 0); c++) out.push({ key: g.grade + '-' + c, grade: String(g.grade), cls: String(c), room: (g.rooms || [])[c - 1] || '' });
    });
    return out;
  }
  function lessonsFrom(d, set) {
    var classes = classesFrom(d), out = [];
    var assign = set.assign || {};
    d.grades.forEach(function (g) {
      var ck = classes.filter(function (c) { return c.grade === String(g.grade); });
      // 교차 묶음: 공통과목 시수 중 묶음 시간에 들어간 만큼은 학급별 지정 수업에서 뺌
      var pairs = (g.plan && g.plan.pairs) || [];
      var minus = {};
      pairs.forEach(function (p) {
        if (!p.common) return;
        p.halves.forEach(function (h) { h.forEach(function (cls) { var k = g.grade + '-' + cls + '|' + p.common.name; minus[k] = (minus[k] || 0) + Number(p.credit); }); });
      });
      // 과목 묶음에 들어간 공통과목(예: 스포츠 문화)은 블록 안에서 들으므로 학급별 시수에서 뺌(같은 공통과목은 한 번만)
      var bc = {};
      ((g.plan && g.plan.bundles) || []).forEach(function (b) { (b.items || []).forEach(function (it) { if (it.kind === 'common') bc[it.name] = Number(it.credit) || 0; }); });
      Object.keys(bc).forEach(function (n) { ck.forEach(function (c) { var k = c.key + '|' + n; minus[k] = (minus[k] || 0) + bc[n]; }); });
      ck.forEach(function (c) {
        (g.subjects || []).forEach(function (s) {
          var hrs = Number(s.hours) - (minus[c.key + '|' + s.name] || 0);
          if (hrs <= 0) return;
          out.push({ id: 'D|' + c.key + '|' + s.name, kind: '지정', grade: g.grade, classKeys: [c.key], name: s.name, hours: hrs, group: s.group,
            teachers: assign[c.key + '|' + s.name] ? [assign[c.key + '|' + s.name]] : [] });
        });
      });
      // 블록 수업: 같은 시간(slot)에 열리는 블록을 한 덩어리로
      if (g.plan) {
        var slotOrder = [], bySlot = {};
        g.plan.blocks.forEach(function (b) { var sl = b.slot || b.id; if (!bySlot[sl]) { bySlot[sl] = []; slotOrder.push(sl); } bySlot[sl].push(b); });
        slotOrder.forEach(function (sl) {
          var bl = bySlot[sl], ids = bl.map(function (b) { return b.id; });
          var secs = g.plan.sections.filter(function (x) { return ids.indexOf(x.block) >= 0; });
          var ts = [], rs = [];
          secs.forEach(function (x) { [x.teacherId, x.teacherId2].forEach(function (t) { if (t && ts.indexOf(t) < 0) ts.push(t); }); if (x.room && rs.indexOf(x.room) < 0) rs.push(x.room); });
          var perClass = null, label = sl + ' 블록';
          pairs.forEach(function (p) {
            p.slots.forEach(function (s) {
              if (s.id !== sl) return;
              perClass = {};
              label = (s.label || sl) + (p.common ? ' (' + p.common.name + ' 교차)' : ' (교차)');
              ck.forEach(function (c) {
                var h = p.halves[0].indexOf(Number(c.cls)) >= 0 ? 0 : 1;
                if (s.commonHalf === h && p.common) {
                  var tid = assign[c.key + '|' + p.common.name] || '';
                  perClass[c.key] = { kind: '지정', target: p.common.name, teacherId: tid };
                  if (tid && ts.indexOf(tid) < 0) ts.push(tid);
                } else perClass[c.key] = { kind: '블록', target: s.byHalf[h] };
              });
            });
          });
          out.push({ id: 'B|' + g.grade + '|' + sl, kind: '블록', grade: g.grade, classKeys: ck.map(function (c) { return c.key; }), name: label, block: sl,
            hours: Number(bl[0].credit), teachers: ts, rooms: rs, planId: g.plan.id, sections: secs.length, perClass: perClass });
        });
      }
      (set.fixed || []).forEach(function (f, fi) {
        if ((f.grades || []).map(String).indexOf(String(g.grade)) < 0) return;
        ck.forEach(function (c) {
          out.push({ id: 'F' + fi + '|' + c.key, kind: '고정', grade: g.grade, classKeys: [c.key], name: f.name, hours: Number(f.hours) || 0, teachers: [], fixed: f.slots || [] });
        });
      });
    });
    return out;
  }
  function engineInput(d, set) {
    var unav = {};
    (d.unavailable || []).forEach(function (u) { (unav[u.교사ID] = unav[u.교사ID] || []).push({ day: u.요일, period: Number(u.교시) }); });
    return { days: set.days, periods: set.periods, classes: classesFrom(d), lessons: lessonsFrom(d, set), unavailable: unav };
  }
  function rowsFrom(d, set, placement) {
    var classes = classesFrom(d), cmap = {}; classes.forEach(function (c) { cmap[c.key] = c; });
    var lmap = {}; lessonsFrom(d, set).forEach(function (l) { lmap[l.id] = l; });
    var rows = [];
    (placement || []).forEach(function (p) {
      var l = lmap[p.lessonId]; if (!l) return;
      l.classKeys.forEach(function (k) {
        var c = cmap[k];
        var pc = l.perClass && l.perClass[k];
        if (pc && pc.kind === '지정') { rows.push({ grade: c.grade, cls: c.cls, day: p.day, period: p.period, kind: '지정', target: pc.target, teacherId: pc.teacherId || '', room: c.room, planId: l.planId || '' }); return; }
        rows.push({ grade: c.grade, cls: c.cls, day: p.day, period: p.period, kind: l.kind, target: l.kind === '블록' ? (pc ? pc.target : l.block) : l.name,
          teacherId: l.kind === '블록' ? '' : (l.teachers[0] || ''), room: l.kind === '블록' ? '' : c.room, planId: l.planId || '' });
      });
    });
    return rows;
  }
  function placementFromRows(d, set, rows) {
    var lmap = {}; lessonsFrom(d, set).forEach(function (l) { lmap[l.id] = l; });
    // 묶음 블록(예: C①)은 그 시간(slot) 덩어리로
    var slotOf = {}, pairCommon = {};
    d.grades.forEach(function (g) {
      if (!g.plan) return;
      g.plan.blocks.forEach(function (b) { slotOf[g.grade + '|' + b.id] = b.slot || b.id; });
    });
    Object.keys(lmap).forEach(function (id) { var l = lmap[id]; if (l.perClass) Object.keys(l.perClass).forEach(function (k) { if (l.perClass[k].kind === '지정') (pairCommon[l.grade] = pairCommon[l.grade] || []).push({ key: k, name: l.perClass[k].target, lesson: id }); }); });
    var out = [], seen = {}, blockAt = {};
    (rows || []).forEach(function (r) {
      if (r.종류 !== '블록') return;
      var sl = slotOf[r.학년 + '|' + r.대상] || r.대상;
      blockAt[r.학년 + '|' + r.요일 + '|' + r.교시] = 'B|' + r.학년 + '|' + sl;
    });
    (rows || []).forEach(function (r) {
      var key = r.학년 + '-' + r.반, id;
      if (r.종류 === '블록') { id = 'B|' + r.학년 + '|' + (slotOf[r.학년 + '|' + r.대상] || r.대상); var k = id + '|' + r.요일 + '|' + r.교시; if (seen[k]) return; seen[k] = 1; }
      else if (r.종류 === '지정') {
        // 묶음 시간에 들어간 공통과목 칸은 블록 덩어리의 일부
        var at = blockAt[r.학년 + '|' + r.요일 + '|' + r.교시];
        if (at && (pairCommon[r.학년] || []).some(function (x) { return x.key === key && x.name === r.대상 && x.lesson === at; })) return;
        id = 'D|' + key + '|' + r.대상;
      }
      else { id = Object.keys(lmap).filter(function (x) { return lmap[x].kind === '고정' && lmap[x].classKeys[0] === key && lmap[x].name === r.대상; })[0]; }
      if (id && lmap[id]) out.push({ lessonId: id, day: r.요일, period: Number(r.교시) });
    });
    return out;
  }
  /** 지정 과목 담당 교사 자동 배정: 정원과목이 같은 교사에게 학급을 고르게 (블록 수업 시수도 고려) */
  function autoAssign(d, set, keep) {
    var assign = keep ? Object.assign({}, set.assign || {}) : {};
    var load = {};
    d.teachers.forEach(function (t) { load[t.id] = 0; });
    d.grades.forEach(function (g) { if (g.plan) g.plan.sections.forEach(function (x) { if (x.teacherId) load[x.teacherId] = (load[x.teacherId] || 0) + (Number(x.credit) || 0); if (x.teacherId2) load[x.teacherId2] = (load[x.teacherId2] || 0) + 1; }); });
    var classes = classesFrom(d);
    Object.keys(assign).forEach(function (k) {
      var g = k.split('-')[0], name = k.split('|')[1];
      var s = (d.grades.filter(function (x) { return String(x.grade) === g; })[0] || { subjects: [] }).subjects.filter(function (x) { return x.name === name; })[0];
      if (s && assign[k]) load[assign[k]] = (load[assign[k]] || 0) + s.hours;
    });
    var missing = [];
    d.grades.forEach(function (g) {
      var ck = classes.filter(function (c) { return c.grade === String(g.grade); });
      (g.subjects || []).forEach(function (s) {
        var groups = String(s.group || '').split(/[·,]/).filter(Boolean);
        var pool = d.teachers.filter(function (t) { return t.subject && groups.indexOf(t.subject) >= 0; });
        var todo = ck.filter(function (c) { return !assign[c.key + '|' + s.name]; });
        if (!todo.length) return;
        if (!pool.length) { missing.push(g.grade + '학년 ' + s.name + (s.group ? ' (' + s.group + ')' : '')); return; }
        // 한 교사가 이어진 반을 맡도록: 부하가 가장 적은 교사에게 몇 반씩
        var per = Math.ceil(todo.length / pool.length);
        var i = 0;
        while (i < todo.length) {
          pool.sort(function (a, b) { return load[a.id] - load[b.id]; });
          var t = pool[0];
          for (var k = 0; k < per && i < todo.length; k++, i++) { assign[todo[i].key + '|' + s.name] = t.id; load[t.id] += s.hours; }
        }
      });
    });
    return { assign: assign, load: load, missing: missing };
  }
  function loads(d, set) {
    var load = {};
    d.grades.forEach(function (g) { if (g.plan) g.plan.sections.forEach(function (x) { if (x.teacherId) load[x.teacherId] = (load[x.teacherId] || 0) + (Number(x.credit) || 0); }); });
    var a = set.assign || {};
    Object.keys(a).forEach(function (k) {
      if (!a[k]) return;
      var g = k.split('-')[0], name = k.split('|')[1];
      var s = (d.grades.filter(function (x) { return String(x.grade) === g; })[0] || { subjects: [] }).subjects.filter(function (x) { return x.name === name; })[0];
      if (s) load[a[k]] = (load[a[k]] || 0) + s.hours;
    });
    return load;
  }
  return { classesFrom: classesFrom, lessonsFrom: lessonsFrom, engineInput: engineInput, rowsFrom: rowsFrom, placementFromRows: placementFromRows, autoAssign: autoAssign, loads: loads };
})();
if (typeof module !== 'undefined') module.exports = TTM;
