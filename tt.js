/* ===== 주간 시간표 엔진 (화면 워커·시험 공용) =====
 * 학급마다 시간을 빈틈없이 채운 뒤, 학급 안 두 시간 맞바꾸기와 학년 전체 두 시간 맞바꾸기(블록 포함)만으로
 * 교사·교실 겹침, 교사 불가 시간, 같은 과목 하루 몰림을 줄입니다. (학급 겹침은 처음부터 생기지 않음)
 */
var TT = (function () {
  var HARD = 1000, SOFT_DAY = 40, SOFT_LOAD = 3, SOFT_GAP = 2;
  function rng(seed) { var x = (seed >>> 0) || 1; return function () { x ^= x << 13; x >>>= 0; x ^= x >>> 17; x ^= x << 5; x >>>= 0; return x / 4294967296; }; }

  /**
   * input = { days:['월',...], periods:{월:7,...},
   *   classes:[{key:'2-1', grade:'2', room:'201'}],
   *   lessons:[{id, kind:'지정'|'블록'|'고정', grade, classKeys:[...], name, hours, teachers:[id], rooms:[...], maxPerDay, fixed:[{day,period}]}],
   *   unavailable:{teacherId:[{day,period}]}, keep: [{lessonId, slots:[{day,period}]}] (이전 결과 유지) }
   */
  function build(input) {
    var days = input.days, slots = [];
    days.forEach(function (d, di) { for (var p = 1; p <= (Number(input.periods[d]) || 0); p++) slots.push({ day: d, di: di, period: p, last: p === Number(input.periods[d]) }); });
    var sIdx = {}; slots.forEach(function (s, i) { sIdx[s.day + '|' + s.period] = i; });
    var classes = input.classes.map(function (c, i) { return { key: c.key, grade: String(c.grade), room: c.room || '', i: i }; });
    var cIdx = {}; classes.forEach(function (c) { cIdx[c.key] = c.i; });
    var lessons = [], pieces = [], issues = [];
    (input.lessons || []).forEach(function (l) {
      var cls = (l.classKeys || []).map(function (k) { return cIdx[k]; }).filter(function (x) { return x != null; });
      if (!cls.length || !(l.hours > 0)) return;
      var L = { id: l.id, kind: l.kind, grade: String(l.grade), name: l.name, hours: Number(l.hours), classes: cls, teachers: (l.teachers || []).filter(Boolean),
        rooms: (l.rooms || []).filter(Boolean), maxPerDay: Number(l.maxPerDay) || (l.kind === '고정' ? 99 : Number(l.hours) > days.length ? 2 : 1), wide: cls.length > 1, li: lessons.length };
      lessons.push(L);
      var fixed = (l.fixed || []).map(function (f) { return sIdx[f.day + '|' + f.period]; }).filter(function (x) { return x != null; });
      for (var h = 0; h < L.hours; h++) pieces.push({ lesson: L.li, slot: -1, pinned: h < fixed.length, pinSlot: h < fixed.length ? fixed[h] : -1 });
    });
    var unav = {};
    Object.keys(input.unavailable || {}).forEach(function (t) {
      unav[t] = {}; (input.unavailable[t] || []).forEach(function (f) { var s = sIdx[f.day + '|' + f.period]; if (s != null) unav[t][s] = 1; });
    });
    // 학급마다 시수 합계 점검
    classes.forEach(function (c) {
      var h = 0; lessons.forEach(function (L) { if (L.classes.indexOf(c.i) >= 0) h += L.hours; });
      c.hours = h;
      if (h > slots.length) issues.push({ level: 'error', text: c.key + '반 수업이 ' + h + '시간인데 시간표 칸은 ' + slots.length + '칸뿐입니다.' });
    });
    var dayLen = days.map(function (d) { return Number(input.periods[d]) || 0; });
    return { days: days, slots: slots, sIdx: sIdx, classes: classes, lessons: lessons, pieces: pieces, unav: unav, issues: issues, dayLen: dayLen };
  }

  function State(M) {
    var S = M.slots.length, C = M.classes.length;
    this.M = M;
    this.grid = []; for (var c = 0; c < C; c++) this.grid.push(new Array(S).fill(-1));
    this.tOcc = {}; this.rOcc = {}; this.ldCnt = {}; this.tDay = {};
  }
  State.prototype.add = function (pi, sign) {
    var M = this.M, P = M.pieces[pi], L = M.lessons[P.lesson], s = P.slot, sl = M.slots[s];
    var self = this;
    L.teachers.forEach(function (t) {
      var k = t + '|' + s; self.tOcc[k] = (self.tOcc[k] || 0) + sign;
      var kd = t + '|' + sl.di; self.tDay[kd] = (self.tDay[kd] || 0) + sign;
    });
    var rooms = L.rooms.length ? L.rooms : (L.wide ? [] : L.classes.map(function (ci) { return M.classes[ci].room; }).filter(Boolean));
    rooms.forEach(function (r) { var k = r + '|' + s; self.rOcc[k] = (self.rOcc[k] || 0) + sign; });
    var kl = L.li + '|' + sl.di; this.ldCnt[kl] = (this.ldCnt[kl] || 0) + sign;
  };
  State.prototype.keysOf = function (pi, acc) {
    var M = this.M, P = M.pieces[pi], L = M.lessons[P.lesson], s = P.slot, di = M.slots[s].di;
    L.teachers.forEach(function (t) { acc.t[t + '|' + s] = t; acc.td[t + '|' + di] = 1; });
    var rooms = L.rooms.length ? L.rooms : (L.wide ? [] : L.classes.map(function (ci) { return M.classes[ci].room; }).filter(Boolean));
    rooms.forEach(function (r) { acc.r[r + '|' + s] = 1; });
    acc.l[L.li + '|' + di] = L.li;
  };
  State.prototype.penKeys = function (acc) {
    var M = this.M, p = 0, self = this;
    Object.keys(acc.t).forEach(function (k) {
      var n = self.tOcc[k] || 0; if (n > 1) p += HARD * (n - 1);
      var t = acc.t[k], s = Number(k.slice(k.lastIndexOf('|') + 1));
      if (n > 0 && M.unav[t] && M.unav[t][s]) p += HARD * n;
    });
    Object.keys(acc.r).forEach(function (k) { var n = self.rOcc[k] || 0; if (n > 1) p += HARD * (n - 1); });
    Object.keys(acc.l).forEach(function (k) { var n = self.ldCnt[k] || 0, L = M.lessons[acc.l[k]]; if (n > L.maxPerDay) p += SOFT_DAY * (n - L.maxPerDay); });
    Object.keys(acc.td).forEach(function (k) { var n = self.tDay[k] || 0; if (n > 5) p += SOFT_LOAD * (n - 5); });
    return p;
  };
  State.prototype.gapPen = function (c, s) {
    var sl = this.M.slots[s];
    return this.grid[c][s] < 0 && !sl.last ? SOFT_GAP * (this.M.dayLen[sl.di] - sl.period) : 0;
  };
  State.prototype.total = function () {
    var acc = { t: {}, r: {}, l: {}, td: {} }, self = this, M = this.M;
    M.pieces.forEach(function (P, pi) { if (P.slot >= 0) self.keysOf(pi, acc); });
    var p = this.penKeys(acc);
    for (var c = 0; c < M.classes.length; c++) for (var s = 0; s < M.slots.length; s++) p += this.gapPen(c, s);
    return p;
  };

  /** 처음 배치: 고정 → 학년 블록(요일 고르게) → 학급 지정 과목(요일 고르게) */
  function initial(St, rnd, keep) {
    var M = St.M, S = M.slots.length;
    var keepMap = {};
    (keep || []).forEach(function (k) { keepMap[k.lessonId] = (k.slots || []).map(function (f) { return M.sIdx[f.day + '|' + f.period]; }).filter(function (x) { return x != null; }); });
    var byLesson = {}; M.pieces.forEach(function (P, pi) { (byLesson[P.lesson] = byLesson[P.lesson] || []).push(pi); });
    function free(L, s) { return L.classes.every(function (ci) { return St.grid[ci][s] < 0; }); }
    function put(pi, s) { var P = M.pieces[pi], L = M.lessons[P.lesson]; P.slot = s; L.classes.forEach(function (ci) { St.grid[ci][s] = pi; }); St.add(pi, 1); }
    var order = M.lessons.slice().sort(function (a, b) { return (b.wide - a.wide) || (b.classes.length - a.classes.length) || (b.hours - a.hours) || rnd() - 0.5; });
    // 고정 먼저
    M.pieces.forEach(function (P, pi) { if (P.pinned && P.slot < 0 && free(M.lessons[P.lesson], P.pinSlot)) put(pi, P.pinSlot); });
    order.forEach(function (L) {
      var list = (byLesson[L.li] || []).filter(function (pi) { return M.pieces[pi].slot < 0; });
      var ks = (keepMap[L.id] || []).slice();
      list.forEach(function (pi) {
        while (ks.length) { var s0 = ks.shift(); if (free(L, s0)) { put(pi, s0); return; } }
        var best = -1, bc = Infinity;
        for (var s = 0; s < S; s++) {
          if (!free(L, s)) continue;
          var di = M.slots[s].di, c = (St.ldCnt[L.li + '|' + di] || 0) * 50 + rnd() * 5;
          L.teachers.forEach(function (t) { c += (St.tOcc[t + '|' + s] || 0) * 200 + (M.unav[t] && M.unav[t][s] ? 200 : 0); });
          c += M.slots[s].period * 0.3;
          if (c < bc) { bc = c; best = s; }
        }
        if (best >= 0) put(pi, best);
      });
    });
    var miss = M.pieces.filter(function (P) { return P.slot < 0; }).length;
    return miss;
  }

  function solve(input, opts) {
    opts = opts || {};
    var M = build(input);
    var rnd = rng(opts.seed || 7);
    var St = new State(M);
    var miss = initial(St, rnd, input.keep);
    if (miss) M.issues.push({ level: 'error', text: '시간표 칸이 모자라 ' + miss + '시간을 넣지 못했습니다. 요일별 교시 수나 시수를 확인해 주세요.' });
    var cur = St.total(), S = M.slots.length, C = M.classes.length;
    var grades = {}; M.classes.forEach(function (c) { (grades[c.grade] = grades[c.grade] || []).push(c.i); });
    var gList = Object.keys(grades);
    var iters = opts.iters || 200000, T0 = opts.t0 || 60, T1 = 0.05, t0 = Date.now(), limit = opts.timeLimit || 20000;
    var best = cur, bestGrid = St.grid.map(function (r) { return r.slice(); }), bestSlots = M.pieces.map(function (P) { return P.slot; });
    function movable(pi) { return pi < 0 || !M.pieces[pi].pinned; }
    for (var it = 0; it < iters; it++) {
      if (best === 0) break;
      var T = T0 * Math.pow(T1 / T0, it / iters);
      var s1 = Math.floor(rnd() * S), s2 = Math.floor(rnd() * S);
      if (s1 === s2) continue;
      var cls, wideMove = rnd() < 0.2;
      if (wideMove) { cls = grades[gList[Math.floor(rnd() * gList.length)]]; }
      else {
        var ci = Math.floor(rnd() * C), a = St.grid[ci][s1], b = St.grid[ci][s2];
        if ((a >= 0 && M.lessons[M.pieces[a].lesson].wide) || (b >= 0 && M.lessons[M.pieces[b].lesson].wide) || (a < 0 && b < 0)) continue;
        cls = [ci];
      }
      // 맞바꿀 조각 모으기 (학년 전체일 때는 그 학년 안에서만 쓰는 블록이어야 함)
      var set = {}, ok = true;
      cls.forEach(function (ci2) { [St.grid[ci2][s1], St.grid[ci2][s2]].forEach(function (pi) { if (pi >= 0) set[pi] = 1; }); });
      var ps = Object.keys(set).map(Number);
      ps.forEach(function (pi) {
        if (!movable(pi)) ok = false;
        if (wideMove) { var L = M.lessons[M.pieces[pi].lesson]; if (L.classes.some(function (x) { return cls.indexOf(x) < 0; })) ok = false; }
      });
      if (!ok) continue;
      var acc = { t: {}, r: {}, l: {}, td: {} };
      ps.forEach(function (pi) { St.keysOf(pi, acc); });
      var gp0 = 0; cls.forEach(function (ci2) { gp0 += St.gapPen(ci2, s1) + St.gapPen(ci2, s2); });
      // 다른 시간 쪽 키도 미리
      ps.forEach(function (pi) { var P = M.pieces[pi], o = P.slot; P.slot = o === s1 ? s2 : s1; St.keysOf(pi, acc); P.slot = o; });
      var before = St.penKeys(acc) + gp0;
      ps.forEach(function (pi) { St.add(pi, -1); var P = M.pieces[pi]; P.slot = P.slot === s1 ? s2 : s1; St.add(pi, 1); });
      cls.forEach(function (ci2) { var x = St.grid[ci2][s1]; St.grid[ci2][s1] = St.grid[ci2][s2]; St.grid[ci2][s2] = x; });
      var gp1 = 0; cls.forEach(function (ci2) { gp1 += St.gapPen(ci2, s1) + St.gapPen(ci2, s2); });
      var after = St.penKeys(acc) + gp1;
      var dlt = after - before;
      if (dlt <= 0 || rnd() < Math.exp(-dlt / T)) {
        cur += dlt;
        if (cur < best) { best = cur; bestGrid = St.grid.map(function (r) { return r.slice(); }); bestSlots = M.pieces.map(function (P) { return P.slot; }); }
      } else {
        ps.forEach(function (pi) { St.add(pi, -1); var P = M.pieces[pi]; P.slot = P.slot === s1 ? s2 : s1; St.add(pi, 1); });
        cls.forEach(function (ci2) { var x = St.grid[ci2][s1]; St.grid[ci2][s1] = St.grid[ci2][s2]; St.grid[ci2][s2] = x; });
      }
      if (it % 5000 === 4999) {
        if (opts.onProgress) opts.onProgress({ it: it + 1, iters: iters, cost: best });
        if (Date.now() - t0 > limit) break;
      }
    }
    M.pieces.forEach(function (P, i) { P.slot = bestSlots[i]; });
    St.grid = bestGrid;
    return result(M, St);
  }

  /** 정해진 배치를 점검만 (손으로 고친 뒤) */
  function evaluate(input, placement) {
    var M = build(input), St = new State(M);
    var byLesson = {}; M.pieces.forEach(function (P, pi) { (byLesson[M.lessons[P.lesson].id] = byLesson[M.lessons[P.lesson].id] || []).push(pi); });
    (placement || []).forEach(function (x) {
      var list = byLesson[x.lessonId] || [], s = M.sIdx[x.day + '|' + x.period];
      var pi = list.filter(function (q) { return M.pieces[q].slot < 0; })[0];
      if (pi == null || s == null) return;
      M.pieces[pi].slot = s; St.add(pi, 1);
      M.lessons[M.pieces[pi].lesson].classes.forEach(function (ci) { if (St.grid[ci][s] >= 0) St.clash = (St.clash || 0) + 1; St.grid[ci][s] = pi; });
    });
    var res = result(M, St);
    if (St.clash) res.issues.unshift({ level: 'error', text: '한 학급에 같은 시간 수업이 겹친 곳이 ' + St.clash + '곳 있습니다.' });
    return res;
  }

  function result(M, St) {
    var issues = M.issues.slice();
    var placement = M.pieces.filter(function (P) { return P.slot >= 0; }).map(function (P) {
      var s = M.slots[P.slot]; return { lessonId: M.lessons[P.lesson].id, day: s.day, period: s.period };
    });
    var notPlaced = M.pieces.filter(function (P) { return P.slot < 0; }).length;
    if (notPlaced && !issues.some(function (x) { return /넣지 못했습니다/.test(x.text); })) issues.push({ level: 'error', text: '배치하지 못한 수업 ' + notPlaced + '시간' });
    var tClash = [], rClash = [], unav = [], spread = [];
    Object.keys(St.tOcc).forEach(function (k) {
      var n = St.tOcc[k]; if (n <= 0) return;
      var t = k.slice(0, k.lastIndexOf('|')), s = Number(k.slice(k.lastIndexOf('|') + 1));
      if (n > 1) tClash.push({ teacherId: t, day: M.slots[s].day, period: M.slots[s].period });
      if (M.unav[t] && M.unav[t][s]) unav.push({ teacherId: t, day: M.slots[s].day, period: M.slots[s].period });
    });
    Object.keys(St.rOcc).forEach(function (k) { if (St.rOcc[k] > 1) { var s = Number(k.slice(k.lastIndexOf('|') + 1)); rClash.push({ room: k.slice(0, k.lastIndexOf('|')), day: M.slots[s].day, period: M.slots[s].period }); } });
    Object.keys(St.ldCnt).forEach(function (k) {
      var L = M.lessons[Number(k.split('|')[0])], n = St.ldCnt[k];
      if (n > L.maxPerDay) spread.push({ lessonId: L.id, name: L.name, classKeys: L.classes.map(function (ci) { return M.classes[ci].key; }), day: M.days[Number(k.split('|')[1])], count: n });
    });
    var gaps = 0;
    for (var c = 0; c < M.classes.length; c++) for (var s = 0; s < M.slots.length; s++) if (St.grid[c][s] < 0 && !M.slots[s].last) {
      var later = false; for (var s2 = s + 1; s2 < M.slots.length && M.slots[s2].di === M.slots[s].di; s2++) if (St.grid[c][s2] >= 0) later = true;
      if (later) gaps++;
    }
    if (tClash.length) issues.push({ level: 'error', text: '교사 시간 겹침 ' + tClash.length + '곳' });
    if (rClash.length) issues.push({ level: 'error', text: '교실 겹침 ' + rClash.length + '곳' });
    if (unav.length) issues.push({ level: 'error', text: '교사 불가 시간에 들어간 수업 ' + unav.length + '시간' });
    if (spread.length) issues.push({ level: 'warn', text: '같은 과목이 하루에 몰린 곳 ' + spread.length + '곳' });
    if (gaps) issues.push({ level: 'warn', text: '중간에 빈 시간이 있는 학급 칸 ' + gaps + '곳' });
    return { placement: placement, issues: issues, tClash: tClash, rClash: rClash, unav: unav, spread: spread, ok: !issues.some(function (x) { return x.level === 'error'; }) };
  }

  return { solve: solve, evaluate: evaluate, build: build };
})();
if (typeof module !== 'undefined') module.exports = TT;
