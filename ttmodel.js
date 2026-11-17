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
      ck.forEach(function (c) {
        (g.subjects || []).forEach(function (s) {
          out.push({ id: 'D|' + c.key + '|' + s.name, kind: '지정', grade: g.grade, classKeys: [c.key], name: s.name, hours: s.hours, group: s.group,
            teachers: assign[c.key + '|' + s.name] ? [assign[c.key + '|' + s.name]] : [] });
        });
      });
      if (g.plan) g.plan.blocks.forEach(function (b) {
        var secs = g.plan.sections.filter(function (x) { return x.block === b.id; });
        var ts = [], rs = [];
        secs.forEach(function (x) { if (x.teacherId && ts.indexOf(x.teacherId) < 0) ts.push(x.teacherId); if (x.room && rs.indexOf(x.room) < 0) rs.push(x.room); });
        out.push({ id: 'B|' + g.grade + '|' + b.id, kind: '블록', grade: g.grade, classKeys: ck.map(function (c) { return c.key; }), name: b.id + ' 블록', block: b.id,
          hours: Number(b.credit), teachers: ts, rooms: rs, planId: g.plan.id, sections: secs.length });
      });
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
        rows.push({ grade: c.grade, cls: c.cls, day: p.day, period: p.period, kind: l.kind, target: l.kind === '블록' ? l.block : l.name,
          teacherId: l.kind === '블록' ? '' : (l.teachers[0] || ''), room: l.kind === '블록' ? '' : c.room, planId: l.planId || '' });
      });
    });
    return rows;
  }
  function placementFromRows(d, set, rows) {
    var lmap = {}; lessonsFrom(d, set).forEach(function (l) { lmap[l.id] = l; });
    var out = [], seen = {};
    (rows || []).forEach(function (r) {
      var key = r.학년 + '-' + r.반, id;
      if (r.종류 === '블록') { id = 'B|' + r.학년 + '|' + r.대상; var k = id + '|' + r.요일 + '|' + r.교시; if (seen[k]) return; seen[k] = 1; }
      else if (r.종류 === '지정') id = 'D|' + key + '|' + r.대상;
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
    d.grades.forEach(function (g) { if (g.plan) g.plan.sections.forEach(function (x) { if (x.teacherId) load[x.teacherId] = (load[x.teacherId] || 0) + (Number(x.credit) || 0); }); });
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
