/* ===== 블록 편성 엔진 (화면 워커·시험 공용) =====
 * 한 학기 선택 과목을 블록(같은 시간 묶음)에 분반 단위로 놓고, 학생마다 고른 과목이 서로 다른 블록에 들어가게 배정합니다.
 * 지키는 조건: 시간마다 분반 수 ≤ 교실 수, 시간마다 교과별 분반 수 ≤ 그 교과 교사 수, 분반 인원 최소~최대
 *
 * 교차 묶음(교사가 모자랄 때): 학급을 두 무리(앞무리·뒷무리)로 나누고 두 시간(①·②)을 엇갈려 씁니다.
 *  - 공통+선택: ① 앞무리=공통과목(학급별) · 뒷무리=선택 블록X  /  ② 앞무리=X · 뒷무리=공통과목
 *  - 선택+선택: ① 앞무리=X · 뒷무리=Y  /  ② 앞무리=Y · 뒷무리=X
 *  같은 과목 분반이 두 시간에 나뉘어 열리므로 한 시간에 필요한 교사 수가 줄어듭니다.
 *  엔진 안에서는 X를 'X①'(한 무리, ① 시간)과 'X②'(다른 무리, ② 시간) 두 블록으로 나누고, 자원(교실·교사)은 '시간(slot)' 단위로 셉니다.
 */
var BLOCK = (function () {
  var LETTERS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
  var BIG = 1e6, HARD = 1e5, OVER = 1000, UNDER = 300;

  function rng(seed) { var x = (seed >>> 0) || 1; return function () { x ^= x << 13; x >>>= 0; x ^= x >>> 17; x ^= x << 5; x >>>= 0; return x / 4294967296; }; }

  /** 입력 정리: 과목·학생·블록 */
  function prepare(input) {
    var subs = [], byName = {};
    (input.subjects || []).forEach(function (s) {
      // groups: 과목 묶음(예: 스포츠 문화 1 + 미술 창작 2)은 한 분반에 여러 정원과목 교사가 들어가므로 정원과목 여러 개
      var gs = (s.groups && s.groups.length ? s.groups : [s.group]).map(String).filter(Boolean).filter(function (g, i, a) { return a.indexOf(g) === i; });
      var o = { name: String(s.name), credit: Number(s.credit) || 0, group: String(s.group || gs[0] || ''), groups: gs, min: Math.max(0, Number(s.min) || 0),
        max: Math.max(1, Number(s.max) || 35), sections: Number(s.sections) || 0, count: 0, locked: s.locked || null, partCredits: s.partCredits || null };
      byName[o.name] = subs.length; subs.push(o);
    });
    var students = [], issues = [];
    (input.students || []).forEach(function (st) {
      var p = [];
      (st.picks || []).forEach(function (n) { if (byName[n] != null && p.indexOf(byName[n]) < 0) p.push(byName[n]); });
      if (!p.length) return;
      p.forEach(function (j) { subs[j].count++; });
      students.push({ id: st.id, cls: Number(st.cls) || 0, no: Number(st.no) || 0, picks: p });
    });
    // 학점별 블록 수 = 학생 한 명이 그 학점 과목을 가장 많이 고른 수
    var need = {};
    students.forEach(function (s) {
      var c = {}; s.picks.forEach(function (j) { c[subs[j].credit] = (c[subs[j].credit] || 0) + 1; });
      Object.keys(c).forEach(function (k) { need[k] = Math.max(need[k] || 0, c[k]); });
    });
    var extra = input.extraBlocks || {};
    var credits = Object.keys(need).map(Number).sort(function (a, b) { return b - a; });
    var blocks = [];
    credits.forEach(function (cr) {
      var n = need[cr] + (Number(extra[cr]) || 0);
      for (var i = 0; i < n; i++) blocks.push({ id: LETTERS[blocks.length] || ('Z' + blocks.length), credit: cr });
    });
    if (!(input.pairs && input.pairs.length) && input.blocks && input.blocks.length === blocks.length && input.blocks.every(function (b, i) { return Number(b.credit) === blocks[i].credit; }))
      blocks = input.blocks.map(function (b) { return { id: String(b.id), credit: Number(b.credit) }; });
    var R = Math.max(1, Number(input.rooms && input.rooms.length || input.roomCount) || 1);
    var PP = applyPairs(blocks, input.pairs || [], issues);
    blocks = PP.blocks;
    // 학생별: 묶음마다 어느 무리인지 → 쓸 수 있는 블록
    students.forEach(function (st) {
      st.allow = blocks.map(function (b) { return b.pair < 0 || PP.halfOf(b.pair, st.cls) === b.half; });
    });
    subs.forEach(function (s) {
      if (!s.sections) s.sections = Math.max(1, Math.ceil(s.count / s.max));
      if (!s.count) s.sections = 0;
      if (s.count && s.min && s.count < s.min) issues.push({ level: 'warn', text: s.name + ': 신청 ' + s.count + '명으로 최소 인원(' + s.min + '명)보다 적습니다.' });
      if (s.count > s.sections * s.max) issues.push({ level: 'warn', text: s.name + ': 분반 ' + s.sections + '개로는 ' + s.count + '명을 모두 받을 수 없습니다(최대 ' + s.max + '명).' });
    });
    var cap0 = {}; Object.keys(input.teacherCap || {}).forEach(function (g) { var n = Number(input.teacherCap[g]); if (g && n > 0) cap0[g] = n; });
    credits.forEach(function (cr) {
      var crSlots = {}; blocks.forEach(function (b) { if (b.credit === cr) crSlots[b.slot] = 1; });
      var slotList = Object.keys(crSlots);
      var nb = blocks.filter(function (b) { return b.credit === cr && b.half !== 1; }).length;
      var seats = slotList.reduce(function (a, sl) { return a + Math.max(0, R - ((PP.occ[sl] || {}).rooms || 0)); }, 0);
      var ns = subs.filter(function (s) { return s.credit === cr; }).reduce(function (a, s) { return a + s.sections; }, 0);
      if (ns > seats) {
        var hint = subs.filter(function (s) { return s.credit === cr && s.count && Math.ceil(s.count / (s.max + 3)) < Math.ceil(s.count / s.max); })
          .map(function (s) { return s.name + ' ' + s.count + '명(최대 ' + Math.ceil(s.count / (Math.ceil(s.count / s.max) - 1)) + '명으로 올리면 분반 1개 줄어듦)'; });
        issues.push({ level: 'error', text: cr + '학점 과목의 분반이 ' + ns + '개인데 ' + (slotList.length !== nb ? '시간 ' + slotList.length + '개의 빈 교실' : '블록 ' + nb + '개 × 교실 ' + R + '개') + ' = ' + seats + '자리뿐입니다. 최대 인원을 늘리거나 교실을 추가해 주세요.' + (hint.length ? ' 도움말: ' + hint.join(', ') : '') });
      }
      var byG = {};
      subs.forEach(function (s) { if (s.credit === cr) s.groups.forEach(function (g) { byG[g] = (byG[g] || 0) + s.sections; }); });
      Object.keys(byG).forEach(function (g) {
        var room = slotList.reduce(function (a, sl) { return a + Math.max(0, (cap0[g] || 0) - (((PP.occ[sl] || {}).groups || {})[g] || 0)); }, 0);
        if (cap0[g] && byG[g] > room) issues.push({ level: 'error', short: { group: g, credit: cr, need: byG[g], room: room }, text: g + ' 분반이 ' + byG[g] + '개인데 ' + g + ' 교사 ' + cap0[g] + '명 × ' + cr + '학점 ' + (slotList.length !== nb ? '시간 ' + slotList.length + '개' : '블록 ' + nb + '개') + '로는 ' + room + '개까지만 열 수 있습니다. 교사 수·최대 인원을 늘리거나 [교차 묶음]을 써 보세요.' });
      });
    });
    var bOf = {}; blocks.forEach(function (b, i) { (bOf[b.credit] = bOf[b.credit] || []).push(i); });
    var cap = {}; Object.keys(input.teacherCap || {}).forEach(function (g) { var n = Number(input.teacherCap[g]); if (g && n > 0) cap[g] = n; });
    // 시간(slot) 목록과 블록 → 시간 번호, 시간마다 공통과목이 이미 쓰는 교실·교사
    var slots = [], slotIx = {};
    blocks.forEach(function (b) { if (slotIx[b.slot] == null) { slotIx[b.slot] = slots.length; slots.push(b.slot); } });
    var sOf = blocks.map(function (b) { return slotIx[b.slot]; });
    var occR = slots.map(function (sl) { return (PP.occ[sl] || {}).rooms || 0; });
    var occG = slots.map(function (sl) { return Object.assign({}, (PP.occ[sl] || {}).groups || {}); });
    return { subs: subs, students: students, blocks: blocks, bOf: bOf, R: R, cap: cap, issues: issues, byName: byName,
      slots: slots, sOf: sOf, occR: occR, occG: occG, pairs: PP.pairs };
  }

  /** 교차 묶음 적용: 학점이 같은 뒤쪽 블록부터 씀 */
  function applyPairs(blocks, pairs, issues) {
    var out = blocks.map(function (b) { return { id: b.id, credit: b.credit, slot: b.id, half: -1, pair: -1 }; });
    var occ = {}, done = [], halfMaps = [];
    pairs.forEach(function (p) {
      var cr = Number(p.credit), type = p.type === 'elective' ? 'elective' : 'common';
      var halves = [(p.halves && p.halves[0]) || [], (p.halves && p.halves[1]) || []].map(function (h) { return h.map(Number).filter(function (x) { return x > 0; }); });
      if (!halves[0].length || !halves[1].length) { issues.push({ level: 'error', text: '교차 묶음: 학급을 두 무리로 나눠 주세요.' }); return; }
      var free = out.filter(function (b) { return b.credit === cr && b.pair < 0; });
      var needB = type === 'elective' ? 2 : 1;
      if (free.length < needB) { issues.push({ level: 'error', text: '교차 묶음(' + (type === 'elective' ? '선택+선택' : '공통+선택 ' + (p.common && p.common.name || '')) + '): ' + cr + '학점 블록이 ' + needB + '개 필요한데 남은 블록이 ' + free.length + '개입니다.' }); return; }
      var pi = done.length;
      var hm = {}; halves[0].forEach(function (c) { hm[c] = 0; }); halves[1].forEach(function (c) { hm[c] = 1; });
      halfMaps.push(hm);
      var label = function (h) { return h.length ? (h.length > 2 && h[h.length - 1] - h[0] === h.length - 1 ? h[0] + '~' + h[h.length - 1] : h.join(',')) + '반' : ''; };
      var info = { type: type, credit: cr, halves: halves, halfLabels: [label(halves[0]), label(halves[1])], common: null, slots: [] };
      var X = free[free.length - needB], Y = needB === 2 ? free[free.length - 1] : null;
      var ix = out.indexOf(X);
      var news;
      if (type === 'common') {
        var cm = { name: String(p.common && p.common.name || ''), group: String(p.common && p.common.group || '') };
        info.common = cm;
        var s1 = X.id + '①', s2 = X.id + '②';
        // ① 앞무리(0)=공통, 뒷무리(1)=X  /  ② 앞무리=X, 뒷무리=공통
        news = [{ id: X.id + '①', credit: cr, slot: s1, half: 1, pair: pi, logical: X.id }, { id: X.id + '②', credit: cr, slot: s2, half: 0, pair: pi, logical: X.id }];
        occ[s1] = { rooms: halves[0].length, groups: {} }; occ[s2] = { rooms: halves[1].length, groups: {} };
        if (cm.group) { occ[s1].groups[cm.group] = halves[0].length; occ[s2].groups[cm.group] = halves[1].length; }
        info.slots = [{ id: s1, label: s1, byHalf: [null, X.id + '①'], commonHalf: 0 }, { id: s2, label: s2, byHalf: [X.id + '②', null], commonHalf: 1 }];
        out.splice(ix, 1, news[0], news[1]);
      } else {
        var t1 = X.id + '·' + Y.id + '①', t2 = X.id + '·' + Y.id + '②';
        // ① 앞무리=X · 뒷무리=Y  /  ② 앞무리=Y · 뒷무리=X
        news = [{ id: X.id + '①', credit: cr, slot: t1, half: 0, pair: pi, logical: X.id }, { id: Y.id + '①', credit: cr, slot: t1, half: 1, pair: pi, logical: Y.id },
          { id: X.id + '②', credit: cr, slot: t2, half: 1, pair: pi, logical: X.id }, { id: Y.id + '②', credit: cr, slot: t2, half: 0, pair: pi, logical: Y.id }];
        info.slots = [{ id: t1, label: X.id + '·' + Y.id + '①', byHalf: [X.id + '①', Y.id + '①'], commonHalf: -1 }, { id: t2, label: X.id + '·' + Y.id + '②', byHalf: [Y.id + '②', X.id + '②'], commonHalf: -1 }];
        out.splice(out.indexOf(Y), 1);
        out.splice(out.indexOf(X), 1, news[0], news[1], news[2], news[3]);
      }
      done.push(info);
    });
    return { blocks: out, occ: occ, pairs: done, halfOf: function (pi, cls) { var h = halfMaps[pi][Number(cls)]; return h == null ? 0 : h; } };
  }

  /** 상태: cnt[j][b] = 과목 j의 블록 b 분반 수, place[s][k] = 학생 s의 k번째 과목 블록 */
  function State(M) {
    var J = M.subs.length, B = M.blocks.length;
    this.M = M;
    this.W = { big: BIG, hard: HARD };
    this.cnt = []; this.load = [];
    for (var j = 0; j < J; j++) { this.cnt.push(new Array(B).fill(0)); this.load.push(new Array(B).fill(0)); }
    this.place = M.students.map(function (s) { return null; });
    this.target = M.subs.map(function (s) { return s.sections ? s.count / s.sections : 0; });
    this.byStu = [];
    var self = this;
    M.subs.forEach(function () { self.byStu.push([]); });
    M.students.forEach(function (s, i) { s.picks.forEach(function (j) { self.byStu[j].push(i); }); });
  }
  State.prototype.pen = function (j, b, L) {
    var x = this.cnt[j][b], s = this.M.subs[j];
    if (!x) return L ? this.W.big * L : 0;
    var p = 0, cap = x * s.max, mn = x * s.min;
    if (L > cap) p += OVER * (L - cap);
    if (L < mn) p += UNDER * (mn - L);
    var d = L / x - this.target[j];
    p += d * d * x * 0.5;
    return p;
  };
  State.prototype.layoutCost = function () {
    var M = this.M, c = 0, B = M.blocks.length, S = M.slots.length;
    var n = M.occR.slice(), g = M.occG.map(function (o) { return Object.assign({}, o); });
    for (var b = 0; b < B; b++) {
      var sl = M.sOf[b];
      for (var j = 0; j < M.subs.length; j++) {
        var x = this.cnt[j][b];
        if (!x) continue;
        n[sl] += x;
        M.subs[j].groups.forEach(function (gr) { if (M.cap[gr]) g[sl][gr] = (g[sl][gr] || 0) + x; });
      }
    }
    for (var s = 0; s < S; s++) {
      if (n[s] > M.R) c += this.W.hard * (n[s] - M.R);
      for (var k in g[s]) if (M.cap[k] && g[s][k] > M.cap[k]) c += this.W.hard * (g[s][k] - M.cap[k]);
    }
    return c;
  };
  State.prototype.total = function () {
    var c = this.layoutCost(), M = this.M;
    for (var j = 0; j < M.subs.length; j++) for (var b = 0; b < M.blocks.length; b++) c += this.pen(j, b, this.load[j][b]);
    for (var s = 0; s < this.place.length; s++) if (!this.place[s]) c += this.W.big;
    return c;
  };
  /** 학생 한 명 배치 (가장 비용이 적은 서로 다른 블록 조합) */
  State.prototype.placeStudent = function (si) {
    var M = this.M, st = M.students[si], self = this;
    var opts = st.picks.map(function (j) {
      var o = [];
      (M.bOf[M.subs[j].credit] || []).forEach(function (b) { if (self.cnt[j][b] > 0 && st.allow[b]) o.push(b); });
      return { j: j, o: o };
    });
    var order = opts.map(function (x, i) { return i; }).sort(function (a, b) { return opts[a].o.length - opts[b].o.length; });
    var best = null, bestC = Infinity, cur = new Array(opts.length), used = {};
    (function dfs(k, acc) {
      if (acc >= bestC) return;
      if (k === order.length) { bestC = acc; best = cur.slice(); return; }
      var i = order[k], j = opts[i].j;
      for (var t = 0; t < opts[i].o.length; t++) {
        var b = opts[i].o[t];
        if (used[b]) continue;
        var L = self.load[j][b];
        var inc = self.pen(j, b, L + 1) - self.pen(j, b, L);
        used[b] = 1; cur[i] = b;
        dfs(k + 1, acc + inc);
        used[b] = 0;
      }
    })(0, 0);
    if (!best) { this.place[si] = null; return false; }
    this.place[si] = best;
    for (var i2 = 0; i2 < best.length; i2++) this.load[opts[i2].j][best[i2]]++;
    return true;
  };
  State.prototype.unplace = function (si) {
    var p = this.place[si]; if (!p) return;
    var st = this.M.students[si];
    for (var i = 0; i < p.length; i++) this.load[st.picks[i]][p[i]]--;
    this.place[si] = null;
  };
  State.prototype.difficulty = function (si) {
    var M = this.M, self = this, d = 1;
    var al = M.students[si].allow;
    M.students[si].picks.forEach(function (j) { var n = 0; (M.bOf[M.subs[j].credit] || []).forEach(function (b) { if (self.cnt[j][b] && al[b]) n++; }); d *= Math.max(1, n); });
    return d;
  };
  State.prototype.placeList = function (list) {
    var self = this;
    list.sort(function (a, b) { return self.difficulty(a) - self.difficulty(b); }).forEach(function (si) { self.placeStudent(si); });
  };
  State.prototype.placeAll = function (passes) {
    var all = this.M.students.map(function (s, i) { return i; });
    for (var i = 0; i < all.length; i++) this.unplace(all[i]);
    this.placeList(all.slice());
    for (var p = 0; p < (passes || 1); p++) for (var k = 0; k < all.length; k++) { this.unplace(all[k]); this.placeStudent(all[k]); }
  };

  /** 처음 배치: 많이 겹치는 과목끼리 같은 블록을 피하고 블록마다 고르게 */
  function initial(St, rnd) {
    var M = St.M, J = M.subs.length;
    var co = []; for (var a = 0; a < J; a++) co.push(new Array(J).fill(0));
    M.students.forEach(function (s) { for (var x = 0; x < s.picks.length; x++) for (var y = 0; y < s.picks.length; y++) if (x !== y) co[s.picks[x]][s.picks[y]]++; });
    var order = M.subs.map(function (s, j) { return j; }).filter(function (j) { return M.subs[j].sections > 0; })
      .sort(function (a, b) { return (M.subs[b].count / M.subs[b].sections) - (M.subs[a].count / M.subs[a].sections) || rnd() - 0.5; });
    var secIn = M.occR.slice(), grpIn = M.occG.map(function (o) { return Object.assign({}, o); });
    // 묶음 블록은 그 무리 학생만 쓰므로, 과목을 고른 학생이 많은 무리 쪽에 먼저
    var halfDemand = M.blocks.map(function (bb, b) { return M.subs.map(function (s, j) { var n = 0; St.byStu[j].forEach(function (si) { if (M.students[si].allow[b]) n++; }); return n; }); });
    order.forEach(function (j) {
      var s = M.subs[j];
      if (s.locked) { Object.keys(s.locked).forEach(function (b) { var bi = Number(b), sl = M.sOf[bi]; St.cnt[j][bi] = s.locked[b]; secIn[sl] += s.locked[b]; s.groups.forEach(function (g) { grpIn[sl][g] = (grpIn[sl][g] || 0) + s.locked[b]; }); }); return; }
      for (var k = 0; k < s.sections; k++) {
        var best = -1, bc = Infinity;
        (M.bOf[s.credit] || []).forEach(function (b) {
          var c = 0, sl = M.sOf[b];
          if (!halfDemand[b][j]) c += HARD / 10;
          if (secIn[sl] >= M.R) c += HARD;
          s.groups.forEach(function (g) { if (M.cap[g] && (grpIn[sl][g] || 0) >= M.cap[g]) c += HARD; });
          c += secIn[sl] * 3 + St.cnt[j][b] * 40;
          for (var o = 0; o < J; o++) if (o !== j && St.cnt[o][b] && M.subs[o].sections) c += co[j][o] * St.cnt[o][b] / M.subs[o].sections;
          c += rnd() * 2;
          if (c < bc) { bc = c; best = b; }
        });
        if (best < 0) continue;
        St.cnt[j][best]++; secIn[M.sOf[best]]++;
        s.groups.forEach(function (g) { grpIn[M.sOf[best]][g] = (grpIn[M.sOf[best]][g] || 0) + 1; });
      }
    });
  }

  /** 담금질: 분반을 다른 블록으로 옮기거나 두 분반을 맞바꾸며 비용을 줄임 */
  function anneal(St, rnd, iters, opts, t0) {
    var M = St.M;
    // 찾는 동안은 벌점을 낮춰(학생 못 넣음·한도 초과도 잠깐 허용) 더 넓게 찾고, 마지막에 원래 벌점으로 비교
    var hardW = St.W;
    St.W = { big: 6000, hard: 9000 };
    St.placeAll(1);
    var cur = St.total();
    var best = { cost: cur, cnt: St.cnt.map(function (r) { return r.slice(); }) };
    var movable = M.subs.map(function (s, j) { return j; }).filter(function (j) { return M.subs[j].sections > 0 && !M.subs[j].locked && (M.bOf[M.subs[j].credit] || []).length > 1; });
    var T0 = opts.t0 || 400, T1 = 0.3, limit = opts.timeLimit || 20000;
    for (var it = 0; it < iters && movable.length; it++) {
      if (cur < 1 && it > 200) break;
      var T = T0 * Math.pow(T1 / T0, it / iters);
      var j = movable[Math.floor(rnd() * movable.length)];
      var bl = M.bOf[M.subs[j].credit];
      var from = [], to;
      bl.forEach(function (b) { if (St.cnt[j][b]) from.push(b); });
      var b1 = from[Math.floor(rnd() * from.length)];
      do { to = bl[Math.floor(rnd() * bl.length)]; } while (to === b1);
      var k = -1;
      if (rnd() < 0.5) {
        var cands = movable.filter(function (x) { return x !== j && M.subs[x].credit === M.subs[j].credit && St.cnt[x][to] > 0; });
        if (cands.length) k = cands[Math.floor(rnd() * cands.length)];
      }
      var aff = St.byStu[j].slice(); if (k >= 0) St.byStu[k].forEach(function (s) { if (aff.indexOf(s) < 0) aff.push(s); });
      St.place.forEach(function (p, si) { if (!p && aff.indexOf(si) < 0) aff.push(si); });
      var saved = aff.map(function (s) { return St.place[s] ? St.place[s].slice() : null; });
      aff.forEach(function (s) { St.unplace(s); });
      St.cnt[j][b1]--; St.cnt[j][to]++;
      if (k >= 0) { St.cnt[k][to]--; St.cnt[k][b1]++; }
      St.placeList(aff.slice());
      var nc = St.total();
      if (nc <= cur || rnd() < Math.exp((cur - nc) / T)) {
        cur = nc;
        if (nc < best.cost) best = { cost: nc, cnt: St.cnt.map(function (r) { return r.slice(); }) };
      } else {
        aff.forEach(function (s) { St.unplace(s); });
        St.cnt[j][b1]++; St.cnt[j][to]--;
        if (k >= 0) { St.cnt[k][to]++; St.cnt[k][b1]--; }
        aff.forEach(function (s, i) {
          var p = saved[i]; St.place[s] = p;
          if (p) for (var q = 0; q < p.length; q++) St.load[M.students[s].picks[q]][p[q]]++;
        });
      }
      if (it % 300 === 299) {
        St.placeAll(1); cur = St.total();
        if (cur < best.cost) best = { cost: cur, cnt: St.cnt.map(function (r) { return r.slice(); }) };
        if (opts.onProgress) opts.onProgress({ stage: opts.stage || '', it: it + 1, iters: iters, cost: best.cost });
        if (Date.now() - t0 > limit) break;
      }
    }
    St.W = hardW;
    var keep = St.cnt.map(function (r) { return r.slice(); });
    St.placeAll(2);
    var lastCost = St.total();
    St.cnt = best.cnt.map(function (r) { return r.slice(); });
    St.placeAll(2);
    var bestCost = St.total();
    if (lastCost < bestCost) { St.cnt = keep; St.placeAll(2); return lastCost; }
    return bestCost;
  }

  /** 다듬기: 교실·교사 한도를 넘는 시간이 남으면, 그 시간의 분반을 다른 블록으로 옮기거나 다른 과목 분반과 맞바꿔 봄(전체 다시 배정해 비교) */
  function repair(St, t0, limit) {
    var M = St.M;
    var overs = function () {
      var out = [], n = M.occR.slice(), g = M.occG.map(function (o) { return Object.assign({}, o); });
      M.blocks.forEach(function (bb, b) { var sl = M.sOf[b]; M.subs.forEach(function (s, j) { var x = St.cnt[j][b]; if (!x) return; n[sl] += x; s.groups.forEach(function (gg) { if (M.cap[gg]) g[sl][gg] = (g[sl][gg] || 0) + x; }); }); });
      M.slots.forEach(function (x, sl) { if (n[sl] > M.R) out.push({ sl: sl, g: null }); Object.keys(g[sl]).forEach(function (k) { if (M.cap[k] && g[sl][k] > M.cap[k]) out.push({ sl: sl, g: k }); }); });
      return out;
    };
    var cur = St.total();
    for (var round = 0; round < 30; round++) {
      var ov = overs();
      if (!ov.length || Date.now() - t0 > limit) break;
      var improved = false;
      for (var oi = 0; oi < ov.length && !improved; oi++) {
        var o = ov[oi];
        var cands = [];
        M.blocks.forEach(function (bb, b) {
          if (M.sOf[b] !== o.sl) return;
          M.subs.forEach(function (s, j) { if (St.cnt[j][b] && !s.locked && (!o.g || s.groups.indexOf(o.g) >= 0)) cands.push([j, b]); });
        });
        for (var ci = 0; ci < cands.length && !improved; ci++) {
          var j = cands[ci][0], b1 = cands[ci][1];
          var targets = (M.bOf[M.subs[j].credit] || []).filter(function (b2) { return M.sOf[b2] !== o.sl; });
          for (var ti = 0; ti < targets.length && !improved; ti++) {
            var b2 = targets[ti];
            // 옮기기, 또는 같은 학점 다른 정원과목 분반과 맞바꾸기
            var swaps = [-1];
            M.subs.forEach(function (s, k) { if (k !== j && !s.locked && s.credit === M.subs[j].credit && St.cnt[k][b2] && !s.groups.some(function (g) { return M.subs[j].groups.indexOf(g) >= 0; })) swaps.push(k); });
            for (var si = 0; si < swaps.length && !improved; si++) {
              var k = swaps[si];
              St.cnt[j][b1]--; St.cnt[j][b2]++;
              if (k >= 0) { St.cnt[k][b2]--; St.cnt[k][b1]++; }
              St.placeAll(1);
              var nc = St.total();
              if (nc < cur - 0.5) { cur = nc; improved = true; }
              else { St.cnt[j][b1]++; St.cnt[j][b2]--; if (k >= 0) { St.cnt[k][b2]++; St.cnt[k][b1]--; } }
            }
          }
        }
      }
      if (!improved) break;
    }
    St.placeAll(2);
    return St.total();
  }

  /** 자동 편성: 담금질 → 배정 못 한 학생이 있으면 빈 교실에 분반을 하나씩 더 열고 다시 */
  /** 결과 점수(작을수록 좋음): 못 넣은 학생 > 오류 > 늘린 분반 */
  function score(res) {
    return res.unassigned.length * 1000 + res.issues.filter(function (x) { return x.level === 'error'; }).length * 100 + (res.added || []).length;
  }
  /** 여러 번(씨앗을 바꿔) 풀어 가장 좋은 결과. 시간 한도 안에서, 오류가 없으면 바로 멈춤 */
  function solve(input, opts) {
    opts = opts || {};
    var t0 = Date.now(), limit = opts.timeLimit || 20000, tries = opts.tries || 5;
    var best = null;
    for (var k = 0; k < tries; k++) {
      var o = Object.assign({}, opts, { seed: (opts.seed || 20261117) + k * 7919, timeLimit: Math.max(1500, limit - (Date.now() - t0)) });
      var r = solveOnce(input, o);
      r.score = score(r);
      if (!best || r.score < best.score) best = r;
      if (best.ok || Date.now() - t0 > limit * 0.5) break;
    }
    return best;
  }
  function solveOnce(input, opts) {
    opts = opts || {};
    var M = prepare(input);
    var rnd = rng(opts.seed || 20261117);
    var St = new State(M);
    var t0 = Date.now();
    initial(St, rnd);
    var iters = opts.iters || 4000;
    anneal(St, rnd, iters, opts, t0);
    repair(St, t0, (opts.timeLimit || 20000) * 1.2);
    var added = [];
    for (var round = 0; round < 40; round++) {
      var un = []; St.place.forEach(function (p, si) { if (!p) un.push(si); });
      if (!un.length || Date.now() - t0 > (opts.timeLimit || 20000)) break;
      var need = {};
      un.forEach(function (si) { M.students[si].picks.forEach(function (j) { need[j] = (need[j] || 0) + 1; }); });
      var usedS = M.occR.slice();
      M.blocks.forEach(function (bb, b) { for (var j = 0; j < M.subs.length; j++) usedS[M.sOf[b]] += St.cnt[j][b]; });
      var used = M.blocks.map(function (bb, b) { return usedS[M.sOf[b]]; });
      var needAt = {};
      un.forEach(function (si) { M.blocks.forEach(function (bb, b) { if (M.students[si].allow[b]) needAt[b] = 1; }); });
      var pick = -1, score = -1;
      Object.keys(need).forEach(function (js) {
        var j = Number(js), sb = M.subs[j];
        if (sb.locked) return;
        var free = (M.bOf[sb.credit] || []).some(function (b) { return !St.cnt[j][b] && needAt[b] && used[b] < M.R && !sb.groups.some(function (g) { return M.cap[g] && groupIn(St, b, g) >= M.cap[g]; }); });
        if (!free) return;
        var sc = need[js] * 10 + (sb.count >= (sb.sections + 1) * sb.min ? 5 : 0) - sb.sections;
        if (sc > score) { score = sc; pick = j; }
      });
      if (pick < 0) break;
      var sbj = M.subs[pick], bestB = -1, bestC = Infinity;
      sbj.sections++;
      St.target[pick] = sbj.count / sbj.sections;
      (M.bOf[sbj.credit] || []).forEach(function (b) {
        if (St.cnt[pick][b] || used[b] >= M.R || !needAt[b]) return;
        St.cnt[pick][b]++; St.placeAll(1);
        var cst = St.total();
        St.cnt[pick][b]--;
        if (cst < bestC) { bestC = cst; bestB = b; }
      });
      if (bestB < 0) { sbj.sections--; St.target[pick] = sbj.count / sbj.sections; break; }
      St.cnt[pick][bestB]++;
      added.push(sbj.name);
      opts.stage = '분반 추가: ' + sbj.name;
      anneal(St, rnd, Math.ceil(iters / 4), opts, t0);
      repair(St, t0, (opts.timeLimit || 20000) * 1.2);
    }
    var res = result(M, St);
    if (added.length) {
      var cnt = {}; added.forEach(function (n) { cnt[n] = (cnt[n] || 0) + 1; });
      res.issues.unshift({ level: 'info', text: '학생을 모두 배정하려고 분반을 늘렸습니다: ' + Object.keys(cnt).map(function (n) { return n + ' +' + cnt[n]; }).join(', ') });
    }
    res.added = added;
    return res;
  }
  // 그 블록과 같은 시간에 열리는 정원과목 g 분반 수(공통과목 학급 포함)
  function groupIn(St, b, g) {
    var M = St.M, sl = M.sOf[b], n = M.occG[sl][g] || 0;
    M.blocks.forEach(function (bb, b2) { if (M.sOf[b2] === sl) M.subs.forEach(function (s, j) { if (s.groups.indexOf(g) >= 0) n += St.cnt[j][b2]; }); });
    return n;
  }

  /** 정해진 배치(분반 위치)로 학생만 다시 배정 */
  function assignOnly(input, layout) {
    var M = prepare(input);
    var St = new State(M);
    (layout || []).forEach(function (x) {
      var j = M.byName[x.subject], b = M.blocks.map(function (bb) { return bb.id; }).indexOf(x.block);
      if (j != null && b >= 0) St.cnt[j][b]++;
    });
    M.subs.forEach(function (s, j) { s.sections = St.cnt[j].reduce(function (a, v) { return a + v; }, 0); });
    St.target = M.subs.map(function (s) { return s.sections ? s.count / s.sections : 0; });
    St.placeAll(2);
    return result(M, St);
  }

  function result(M, St) {
    var sections = [], issues = M.issues.slice();
    var stuByJB = {};
    M.students.forEach(function (s, si) {
      var p = St.place[si]; if (!p) return;
      p.forEach(function (b, k) { var key = s.picks[k] + '|' + b; (stuByJB[key] = stuByJB[key] || []).push(s); });
    });
    M.subs.forEach(function (sub, j) {
      M.blocks.forEach(function (bl, b) {
        var x = St.cnt[j][b]; if (!x) return;
        var list = (stuByJB[j + '|' + b] || []).slice().sort(function (a, c) { return a.cls - c.cls || a.no - c.no; });
        var base = Math.floor(list.length / x), extra = list.length % x, pos = 0;
        for (var i = 0; i < x; i++) {
          var size = base + (i < extra ? 1 : 0);
          sections.push({ subject: sub.name, credit: sub.credit, group: sub.group, groups: sub.groups.length > 1 ? sub.groups.slice() : undefined, partCredits: sub.partCredits || undefined, block: bl.id, no: i + 1, label: bl.id + (x > 1 ? String(i + 1) : ''),
            students: list.slice(pos, pos + size).map(function (z) { return z.id; }), min: sub.min, max: sub.max });
          pos += size;
        }
      });
    });
    var unassigned = [];
    M.students.forEach(function (s, si) { if (!St.place[si]) unassigned.push(s.id); });
    if (unassigned.length) issues.push({ level: 'error', text: '서로 다른 블록에 넣을 수 없는 학생 ' + unassigned.length + '명이 있습니다. 해당 과목의 분반을 다른 블록에도 두거나 분반을 늘려 주세요.' });
    sections.forEach(function (s) {
      var n = s.students.length;
      if (n > s.max) issues.push({ level: 'error', text: s.subject + ' ' + s.label + ': ' + n + '명으로 최대 ' + s.max + '명을 넘습니다.' });
      else if (s.min && n < s.min) issues.push({ level: 'warn', text: s.subject + ' ' + s.label + ': ' + n + '명으로 최소 ' + s.min + '명보다 적습니다.' });
    });
    M.slots.forEach(function (sl, si) {
      var ids = M.blocks.filter(function (b, k) { return M.sOf[k] === si; }).map(function (b) { return b.id; });
      var inB = sections.filter(function (s) { return ids.indexOf(s.block) >= 0; });
      var name = ids.length > 1 || ids[0] !== sl ? sl + ' 시간' : sl + ' 블록';
      var rooms = inB.length + M.occR[si];
      if (rooms > M.R) issues.push({ level: 'error', text: name + ' 분반이 ' + inB.length + '개' + (M.occR[si] ? '(공통과목 학급 ' + M.occR[si] + '개 별도)' : '') + '로 교실 ' + M.R + '개보다 많습니다.' });
      var g = Object.assign({}, M.occG[si]);
      inB.forEach(function (s) { (s.groups || [s.group]).forEach(function (gg) { if (gg && M.cap[gg]) g[gg] = (g[gg] || 0) + 1; }); });
      Object.keys(g).forEach(function (k) { if (M.cap[k] && g[k] > M.cap[k]) issues.push({ level: 'error', short: { group: k, slot: sl, n: g[k], cap: M.cap[k] }, text: name + '에 ' + k + ' 수업이 ' + g[k] + '개로 ' + k + ' 교사 ' + M.cap[k] + '명보다 많습니다.' }); });
    });
    return { blocks: M.blocks.map(function (b) { return { id: b.id, credit: b.credit, slot: b.slot, half: b.half, pair: b.pair, logical: b.logical || b.id }; }),
      pairs: M.pairs, sections: sections, unassigned: unassigned, issues: issues, roomCount: M.R,
      ok: !issues.some(function (x) { return x.level === 'error'; }), students: M.students.length };
  }

  /** 교실 배치: 같은 과목·같은 교사는 블록이 달라도 같은 교실을 쓰도록.
   *  blocks(선택): 묶음 정보가 든 블록 목록 → 같은 시간(slot)끼리 교실이 겹치지 않게. busyRooms(선택): {slot: [공통과목 학급이 쓰는 교실]} */
  function assignRooms(sections, rooms, keep, blocks, busyRooms) {
    var slotOf = {}; (blocks || []).forEach(function (b) { slotOf[b.id] = b.slot || b.id; });
    var sk = function (s) { return slotOf[s.block] || s.block; };
    var used = {}, pref = {};
    Object.keys(busyRooms || {}).forEach(function (sl) { (busyRooms[sl] || []).forEach(function (r) { (used[sl] = used[sl] || {})[r] = 1; }); });
    sections.forEach(function (s) {
      var k0 = sk(s);
      if (keep && s.room && rooms.indexOf(s.room) >= 0 && !(used[k0] && used[k0][s.room])) {
        (used[k0] = used[k0] || {})[s.room] = 1;
        var k = s.teacherId || s.subject; (pref[k] = pref[k] || {})[s.room] = (pref[k][s.room] || 0) + 1;
      } else s.room = keep ? s.room : '';
    });
    var todo = sections.filter(function (s) { return !s.room || rooms.indexOf(s.room) < 0; })
      .sort(function (a, b) { return a.subject < b.subject ? -1 : a.subject > b.subject ? 1 : a.no - b.no; });
    todo.forEach(function (s) {
      var u = used[sk(s)] = used[sk(s)] || {};
      var k = s.teacherId || s.subject, p = pref[k] || {};
      var free = rooms.filter(function (r) { return !u[r]; });
      if (!free.length) { s.room = ''; return; }
      free.sort(function (a, b) { return (p[b] || 0) - (p[a] || 0); });
      s.room = free[0]; u[s.room] = 1;
      (pref[k] = pref[k] || {})[s.room] = (p[s.room] || 0) + 1;
    });
    return sections;
  }

  /** 교사 배정: 교과 교사들을 고르게, 한 교사가 같은 블록에 두 분반을 맡지 않게 */
  function assignTeachers(sections, teachersByGroup, keep, blocks) {
    var slotOf = {}; (blocks || []).forEach(function (b) { slotOf[b.id] = b.slot || b.id; });
    var sk = function (s) { return slotOf[s.block] || s.block; };
    var busy = {}, load = {};
    // 과목 묶음 분반: 첫 정원과목 교사 = teacherId, 둘째 = teacherId2 (partCredits가 있으면 그 시수로 부담 셈)
    var part = function (s, k) { return s.partCredits ? Number(s.partCredits[k]) || 1 : (s.credit || 1); };
    sections.forEach(function (s) {
      if (keep && s.teacherId) { (busy[sk(s)] = busy[sk(s)] || {})[s.teacherId] = 1; load[s.teacherId] = (load[s.teacherId] || 0) + part(s, 0); }
      else if (!keep) s.teacherId = '';
      if (keep && s.teacherId2) { (busy[sk(s)] = busy[sk(s)] || {})[s.teacherId2] = 1; load[s.teacherId2] = (load[s.teacherId2] || 0) + part(s, 1); }
      else if (!keep) s.teacherId2 = '';
    });
    var pickT = function (s, g, k) {
      var list = (teachersByGroup[g] || []).filter(function (t) { return !(busy[sk(s)] && busy[sk(s)][t.id]); });
      if (!list.length) return '';
      list.sort(function (a, b) { return (load[a.id] || 0) - (load[b.id] || 0); });
      var id = list[0].id;
      (busy[sk(s)] = busy[sk(s)] || {})[id] = 1;
      load[id] = (load[id] || 0) + part(s, k);
      return id;
    };
    sections.filter(function (s) { return s.groups && s.groups.length > 1 && !s.teacherId2; }).forEach(function (s) { s.teacherId2 = pickT(s, s.groups[1], 1); });
    sections.filter(function (s) { return !s.teacherId; }).sort(function (a, b) { return a.subject < b.subject ? -1 : 1; }).forEach(function (s) {
      var id = pickT(s, s.group, 0);
      if (!id) return;
      s.teacherId = id;
    });
    return sections;
  }

  /* ===== 과목 묶음: 학점이 작은 과목끼리 묶어(예: 스포츠 문화 1 + 미술 창작 2 = 3) 큰 학점 블록에 함께 놓기 =====
   * subjects: [{name, credit, group, kind:'common'|'elective', curGroup, min, max, sections}]  (common = 학교 지정·공통, 모든 학생이 들음)
   * bundles: [{parts:[과목 이름…]}]
   * 학생이 묶음의 선택 과목을 모두 골랐으면 그 과목들 대신 묶음 하나를 고른 것으로 바꿈. 공통과목은 모든 학생이 묶음으로 들어야 함 */
  function applyBundles(subjects, students, bundles) {
    var byName = {}; subjects.forEach(function (s) { byName[s.name] = s; });
    var info = [], issues = [];
    (bundles || []).forEach(function (b) {
      var parts = (b.parts || []).map(String).filter(function (n, i, a) { return n && a.indexOf(n) === i; });
      var miss = parts.filter(function (n) { return !byName[n]; });
      if (miss.length) { issues.push({ level: 'error', text: '과목 묶음 「' + parts.join('+') + '」: 이번 학기에 없는 과목 ' + miss.join(', ') }); return; }
      if (parts.length < 2) { issues.push({ level: 'error', text: '과목 묶음에는 과목이 두 개 이상 필요합니다.' }); return; }
      var ps = parts.map(function (n) { return byName[n]; });
      var el = ps.filter(function (x) { return x.kind !== 'common'; });
      if (!el.length) { issues.push({ level: 'error', text: '과목 묶음 「' + parts.join('+') + '」: 선택 과목이 하나는 있어야 합니다(공통과목끼리는 학급별로 운영).' }); return; }
      // 대표(교사·인원 기준) = 학점이 가장 큰 선택 과목
      var main = el.slice().sort(function (a, c) { return c.credit - a.credit; })[0];
      var order = [main].concat(ps.filter(function (x) { return x !== main; }));
      var groups = [], pc = [];
      order.forEach(function (x) { var g = x.group || ''; var k = groups.indexOf(g); if (k < 0) { groups.push(g); pc.push(x.credit); } else pc[k] += x.credit; });
      info.push({ name: parts.join('+'), parts: parts, items: ps.map(function (x) { return { name: x.name, credit: x.credit, kind: x.kind || 'elective' }; }), electives: el.map(function (x) { return x.name; }), commons: ps.filter(function (x) { return x.kind === 'common'; }).map(function (x) { return x.name; }),
        credit: ps.reduce(function (a, x) { return a + x.credit; }, 0), group: main.group || '', groups: groups.filter(Boolean), partCredits: pc, main: main, count: 0 });
    });
    var used = {}, cover = {};
    info.forEach(function (b) { b.electives.forEach(function (n) { used[n] = 1; }); b.commons.forEach(function (n) { cover[n] = { covered: 0, missing: {} }; }); });
    var out = students.map(function (st) {
      var picks = st.picks.slice(), got = {};
      info.forEach(function (b) {
        if (!b.electives.every(function (n) { return picks.indexOf(n) >= 0; })) return;
        if (b.commons.some(function (n) { return got[n]; })) return;
        picks = picks.filter(function (n) { return b.electives.indexOf(n) < 0; }).concat([b.name]);
        b.count++;
        b.commons.forEach(function (n) { got[n] = 1; });
      });
      Object.keys(cover).forEach(function (n) {
        if (got[n]) cover[n].covered++;
        else {
          // 이 공통과목과 묶인 선택 과목과 같은 학점의 과목 중 학생이 고른 것
          var crs = {}; info.forEach(function (b) { if (b.commons.indexOf(n) >= 0) b.electives.forEach(function (e) { crs[byName[e].credit] = 1; }); });
          var k = st.picks.filter(function (p) { return byName[p] && byName[p].kind !== 'common' && crs[byName[p].credit]; }).join('·') || '해당 학점 과목 없음';
          cover[n].missing[k] = (cover[n].missing[k] || 0) + 1;
        }
      });
      return Object.assign({}, st, { picks: picks, rawPicks: st.picks });
    });
    Object.keys(cover).forEach(function (n) {
      var miss = students.length - cover[n].covered;
      if (miss > 0) issues.push({ level: 'error', text: n + '(공통)을 묶음으로 듣지 못하는 학생 ' + miss + '명 — 고른 과목: ' + Object.keys(cover[n].missing).map(function (k) { return k + ' ' + cover[n].missing[k] + '명'; }).slice(0, 4).join(', ') + '. 이 과목들과의 묶음도 만들어 주세요.' });
    });
    info.forEach(function (b) { if (!b.count) issues.push({ level: 'warn', text: '과목 묶음 「' + b.name + '」을 고른 학생이 없습니다.' }); });
    var subs = subjects.filter(function (x) { return x.kind !== 'common'; }).map(function (x) { return { name: x.name, credit: x.credit, group: x.group, min: x.min, max: x.max, sections: x.sections }; });
    info.forEach(function (b) {
      subs.push({ name: b.name, credit: b.credit, group: b.group, groups: b.groups, partCredits: b.partCredits, min: b.main.min, max: b.main.max, sections: b.main.sections, bundle: true });
    });
    return { subjects: subs, students: out, bundles: info.map(function (b) { var o = Object.assign({}, b); delete o.main; return o; }), issues: issues };
  }
  /** 과목 묶음 추천: 공통과목(k학점) + 한 과목군에서 하나씩 고르는 선택 과목(m학점) → k+m 학점 블록이 이미 있으면 */
  function suggestBundles(subjects, students) {
    var el = subjects.filter(function (x) { return x.kind !== 'common'; }), cm = subjects.filter(function (x) { return x.kind === 'common'; });
    var credits = {}; el.forEach(function (x) { credits[x.credit] = 1; });
    var N = students.length || 1, out = [];
    // 학생마다 정확히 하나씩 고르는 선택 과목 묶음(같은 학점·같은 과목군)
    var sets = {};
    el.forEach(function (x) { var k = x.credit + '|' + (x.curGroup || x.group || ''); (sets[k] = sets[k] || []).push(x); });
    Object.keys(sets).forEach(function (k) {
      var set = sets[k], names = set.map(function (x) { return x.name; });
      var exactly = students.filter(function (st) { return st.picks.filter(function (p) { return names.indexOf(p) >= 0; }).length === 1; }).length;
      if (exactly / N < 0.9) return;
      cm.forEach(function (c) {
        var T = c.credit + set[0].credit;
        if (!credits[T] || T === set[0].credit) return;
        out.push({ common: c.name, credit: T, from: set[0].credit, parts: names, coverage: exactly / N,
          bundles: names.map(function (n) { return { parts: [c.name, n] }; }),
          text: c.name + '(' + c.credit + ') + ' + names.join('/') + '(' + set[0].credit + ') → ' + T + '학점 블록' });
      });
    });
    return out.sort(function (a, b) { return b.coverage - a.coverage; });
  }

  /** 교차 편성 추천: 지금 상태와 후보들을 짧게 풀어 보고, 오류가 가장 많이 줄어드는 순서로 */
  function recommend(input, opts) {
    opts = opts || {};
    var t0 = Date.now(), budget = opts.timeLimit || 30000;
    var quick = function (inp, ms) { return solve(inp, { iters: 1800, timeLimit: ms, tries: 2, seed: 777 }); };
    var summary = function (r) {
      var errs = r.issues.filter(function (x) { return x.level === 'error'; });
      var shortN = 0;
      errs.forEach(function (x) { if (x.short && x.short.n) shortN += x.short.n - x.short.cap; });
      return { ok: r.ok, errors: errs.length, unassigned: r.unassigned.length, over: shortN, added: (r.added || []).length, score: score(r), texts: errs.slice(0, 4).map(function (x) { return x.text; }) };
    };
    if (opts.onProgress) opts.onProgress({ stage: '지금 상태 확인', it: 0, iters: 1 });
    var base = quick(input, Math.min(6000, budget / 5));
    var B = summary(base);
    var M0 = prepare(input);
    // 부족한 정원과목·학점
    var shortG = {}, shortCr = {};
    base.issues.forEach(function (x) { if (x.short && x.short.group) { shortG[x.short.group] = 1; if (x.short.credit) shortCr[x.short.credit] = 1; } });
    M0.issues.forEach(function (x) { if (x.short) { shortG[x.short.group] = 1; shortCr[x.short.credit] = 1; } });
    base.blocks.forEach(function (b) {
      var secs = base.sections.filter(function (s) { return s.block === b.id; });
      secs.forEach(function (s) { if (shortG[s.group]) shortCr[b.credit] = 1; });
    });
    if (!Object.keys(shortCr).length) M0.blocks.forEach(function (b) { shortCr[b.credit] = 1; });
    // 학급을 두 무리로: 앞뒤(학생 수 고르게), 홀짝
    var cls = []; M0.students.forEach(function (s) { if (cls.indexOf(s.cls) < 0) cls.push(s.cls); }); cls.sort(function (a, b) { return a - b; });
    var cnt = {}; M0.students.forEach(function (s) { cnt[s.cls] = (cnt[s.cls] || 0) + 1; });
    var tot = M0.students.length, acc = 0, cut = 0;
    for (var i = 0; i < cls.length - 1; i++) { acc += cnt[cls[i]]; if (Math.abs(tot / 2 - acc) <= Math.abs(tot / 2 - (acc + cnt[cls[i + 1]]))) { cut = i + 1; break; } cut = i + 1; }
    var variants = [{ name: '앞뒤', halves: [cls.slice(0, cut), cls.slice(cut)] }, { name: '홀짝', halves: [cls.filter(function (c, i) { return i % 2 === 0; }), cls.filter(function (c, i) { return i % 2 === 1; })] }];
    var cap = M0.cap, used = {};
    (input.pairs || []).forEach(function (p) { used[p.credit] = (used[p.credit] || 0) + (p.type === 'elective' ? 2 : 1); });
    var freeOf = function (cr) { return M0.blocks.filter(function (b) { return b.credit === Number(cr) && b.pair < 0; }).length; };
    var cands = [];
    Object.keys(shortCr).forEach(function (cr) {
      cr = Number(cr);
      (input.commons || []).forEach(function (c) {
        if (Number(c.credit) < cr || freeOf(cr) < 1) return;
        variants.forEach(function (v, vi) {
          var half = Math.max(v.halves[0].length, v.halves[1].length);
          var pre = (shortG[c.group] ? 50 : 0) + (cap[c.group] && cap[c.group] < half ? 30 : 0) + vi * 5;
          cands.push({ pre: pre, pair: { type: 'common', credit: cr, common: { name: c.name, group: c.group || '' }, halves: v.halves, split: v.name } });
        });
      });
      if (freeOf(cr) >= 2) cands.push({ pre: 20, pair: { type: 'elective', credit: cr, halves: variants[0].halves, split: variants[0].name } });
    });
    cands.sort(function (a, b) { return a.pre - b.pre; });
    var maxN = opts.maxCandidates || 6;
    cands = cands.slice(0, maxN);
    var options = [];
    cands.forEach(function (c, i) {
      var left = budget - (Date.now() - t0);
      if (left < 1500) return;
      if (opts.onProgress) opts.onProgress({ stage: '후보 ' + (i + 1) + '/' + cands.length + ' 시험 편성', it: i + 1, iters: cands.length + 1 });
      var inp = Object.assign({}, input, { pairs: (input.pairs || []).concat([c.pair]) });
      var r = quick(inp, Math.min(6000, left / (cands.length - i)));
      var S = summary(r);
      options.push({ pair: c.pair, result: S, better: S.score < B.score, slots: r.pairs && r.pairs[r.pairs.length - 1] ? r.pairs[r.pairs.length - 1].slots.map(function (x) { return x.label; }) : [] });
    });
    options.sort(function (a, b) { return a.result.score - b.result.score || a.result.over - b.result.over; });
    return { base: B, options: options, shortGroups: Object.keys(shortG), ms: Date.now() - t0 };
  }

  return { solve: solve, recommend: recommend, applyBundles: applyBundles, suggestBundles: suggestBundles, assignOnly: assignOnly, assignRooms: assignRooms, assignTeachers: assignTeachers, prepare: prepare, LETTERS: LETTERS };
})();
if (typeof module !== 'undefined') module.exports = BLOCK;
