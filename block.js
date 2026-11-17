/* ===== 블록 편성 엔진 (화면 워커·시험 공용) =====
 * 한 학기 선택 과목을 블록(같은 시간 묶음)에 분반 단위로 놓고, 학생마다 고른 과목이 서로 다른 블록에 들어가게 배정합니다.
 * 지키는 조건: 블록마다 분반 수 ≤ 교실 수, 블록마다 교과별 분반 수 ≤ 그 교과 교사 수, 분반 인원 최소~최대
 */
var BLOCK = (function () {
  var LETTERS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
  var BIG = 1e6, HARD = 1e5, OVER = 1000, UNDER = 300;

  function rng(seed) { var x = (seed >>> 0) || 1; return function () { x ^= x << 13; x >>>= 0; x ^= x >>> 17; x ^= x << 5; x >>>= 0; return x / 4294967296; }; }

  /** 입력 정리: 과목·학생·블록 */
  function prepare(input) {
    var subs = [], byName = {};
    (input.subjects || []).forEach(function (s) {
      var o = { name: String(s.name), credit: Number(s.credit) || 0, group: String(s.group || ''), min: Math.max(0, Number(s.min) || 0),
        max: Math.max(1, Number(s.max) || 35), sections: Number(s.sections) || 0, count: 0, locked: s.locked || null };
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
    if (input.blocks && input.blocks.length === blocks.length && input.blocks.every(function (b, i) { return Number(b.credit) === blocks[i].credit; }))
      blocks = input.blocks.map(function (b) { return { id: String(b.id), credit: Number(b.credit) }; });
    var R = Math.max(1, Number(input.rooms && input.rooms.length || input.roomCount) || 1);
    subs.forEach(function (s) {
      if (!s.sections) s.sections = Math.max(1, Math.ceil(s.count / s.max));
      if (!s.count) s.sections = 0;
      if (s.count && s.min && s.count < s.min) issues.push({ level: 'warn', text: s.name + ': 신청 ' + s.count + '명으로 최소 인원(' + s.min + '명)보다 적습니다.' });
      if (s.count > s.sections * s.max) issues.push({ level: 'warn', text: s.name + ': 분반 ' + s.sections + '개로는 ' + s.count + '명을 모두 받을 수 없습니다(최대 ' + s.max + '명).' });
    });
    var cap0 = {}; Object.keys(input.teacherCap || {}).forEach(function (g) { var n = Number(input.teacherCap[g]); if (g && n > 0) cap0[g] = n; });
    credits.forEach(function (cr) {
      var nb = blocks.filter(function (b) { return b.credit === cr; }).length;
      var ns = subs.filter(function (s) { return s.credit === cr; }).reduce(function (a, s) { return a + s.sections; }, 0);
      if (ns > nb * R) {
        var hint = subs.filter(function (s) { return s.credit === cr && s.count && Math.ceil(s.count / (s.max + 3)) < Math.ceil(s.count / s.max); })
          .map(function (s) { return s.name + ' ' + s.count + '명(최대 ' + Math.ceil(s.count / (Math.ceil(s.count / s.max) - 1)) + '명으로 올리면 분반 1개 줄어듦)'; });
        issues.push({ level: 'error', text: cr + '학점 과목의 분반이 ' + ns + '개인데 블록 ' + nb + '개 × 교실 ' + R + '개 = ' + nb * R + '자리뿐입니다. 최대 인원을 늘리거나 교실을 추가해 주세요.' + (hint.length ? ' 도움말: ' + hint.join(', ') : '') });
      }
      var byG = {};
      subs.forEach(function (s) { if (s.credit === cr && s.group) byG[s.group] = (byG[s.group] || 0) + s.sections; });
      Object.keys(byG).forEach(function (g) {
        if (cap0[g] && byG[g] > cap0[g] * nb) issues.push({ level: 'error', text: g + ' 분반이 ' + byG[g] + '개인데 ' + g + ' 교사 ' + cap0[g] + '명 × ' + cr + '학점 블록 ' + nb + '개 = ' + cap0[g] * nb + '개까지만 동시에 열 수 있습니다. 교사 수를 늘리거나 최대 인원을 늘려 주세요.' });
      });
    });
    var bOf = {}; blocks.forEach(function (b, i) { (bOf[b.credit] = bOf[b.credit] || []).push(i); });
    var cap = {}; Object.keys(input.teacherCap || {}).forEach(function (g) { var n = Number(input.teacherCap[g]); if (g && n > 0) cap[g] = n; });
    return { subs: subs, students: students, blocks: blocks, bOf: bOf, R: R, cap: cap, issues: issues, byName: byName };
  }

  /** 상태: cnt[j][b] = 과목 j의 블록 b 분반 수, place[s][k] = 학생 s의 k번째 과목 블록 */
  function State(M) {
    var J = M.subs.length, B = M.blocks.length;
    this.M = M;
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
    if (!x) return L ? BIG * L : 0;
    var p = 0, cap = x * s.max, mn = x * s.min;
    if (L > cap) p += OVER * (L - cap);
    if (L < mn) p += UNDER * (mn - L);
    var d = L / x - this.target[j];
    p += d * d * x * 0.5;
    return p;
  };
  State.prototype.layoutCost = function () {
    var M = this.M, c = 0, B = M.blocks.length;
    for (var b = 0; b < B; b++) {
      var n = 0, g = {};
      for (var j = 0; j < M.subs.length; j++) {
        var x = this.cnt[j][b];
        if (!x) continue;
        n += x;
        var gr = M.subs[j].group;
        if (gr && M.cap[gr]) g[gr] = (g[gr] || 0) + x;
      }
      if (n > M.R) c += HARD * (n - M.R);
      for (var k in g) if (g[k] > M.cap[k]) c += HARD * (g[k] - M.cap[k]);
    }
    return c;
  };
  State.prototype.total = function () {
    var c = this.layoutCost(), M = this.M;
    for (var j = 0; j < M.subs.length; j++) for (var b = 0; b < M.blocks.length; b++) c += this.pen(j, b, this.load[j][b]);
    for (var s = 0; s < this.place.length; s++) if (!this.place[s]) c += BIG;
    return c;
  };
  /** 학생 한 명 배치 (가장 비용이 적은 서로 다른 블록 조합) */
  State.prototype.placeStudent = function (si) {
    var M = this.M, st = M.students[si], self = this;
    var opts = st.picks.map(function (j) {
      var o = [];
      (M.bOf[M.subs[j].credit] || []).forEach(function (b) { if (self.cnt[j][b] > 0) o.push(b); });
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
    M.students[si].picks.forEach(function (j) { var n = 0; (M.bOf[M.subs[j].credit] || []).forEach(function (b) { if (self.cnt[j][b]) n++; }); d *= Math.max(1, n); });
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
    var secIn = new Array(M.blocks.length).fill(0), grpIn = M.blocks.map(function () { return {}; });
    order.forEach(function (j) {
      var s = M.subs[j];
      if (s.locked) { Object.keys(s.locked).forEach(function (b) { var bi = Number(b); St.cnt[j][bi] = s.locked[b]; secIn[bi] += s.locked[b]; if (s.group) grpIn[bi][s.group] = (grpIn[bi][s.group] || 0) + s.locked[b]; }); return; }
      for (var k = 0; k < s.sections; k++) {
        var best = -1, bc = Infinity;
        (M.bOf[s.credit] || []).forEach(function (b) {
          var c = 0;
          if (secIn[b] >= M.R) c += HARD;
          if (s.group && M.cap[s.group] && (grpIn[b][s.group] || 0) >= M.cap[s.group]) c += HARD;
          c += secIn[b] * 3 + St.cnt[j][b] * 40;
          for (var o = 0; o < J; o++) if (o !== j && St.cnt[o][b] && M.subs[o].sections) c += co[j][o] * St.cnt[o][b] / M.subs[o].sections;
          c += rnd() * 2;
          if (c < bc) { bc = c; best = b; }
        });
        if (best < 0) continue;
        St.cnt[j][best]++; secIn[best]++;
        if (s.group) grpIn[best][s.group] = (grpIn[best][s.group] || 0) + 1;
      }
    });
  }

  /** 담금질: 분반을 다른 블록으로 옮기거나 두 분반을 맞바꾸며 비용을 줄임 */
  function anneal(St, rnd, iters, opts, t0) {
    var M = St.M;
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
    St.cnt = best.cnt.map(function (r) { return r.slice(); });
    St.placeAll(2);
    return St.total();
  }

  /** 자동 편성: 담금질 → 배정 못 한 학생이 있으면 빈 교실에 분반을 하나씩 더 열고 다시 */
  function solve(input, opts) {
    opts = opts || {};
    var M = prepare(input);
    var rnd = rng(opts.seed || 20261117);
    var St = new State(M);
    var t0 = Date.now();
    initial(St, rnd);
    var iters = opts.iters || 4000;
    anneal(St, rnd, iters, opts, t0);
    var added = [];
    for (var round = 0; round < 40; round++) {
      var un = []; St.place.forEach(function (p, si) { if (!p) un.push(si); });
      if (!un.length || Date.now() - t0 > (opts.timeLimit || 20000)) break;
      var need = {};
      un.forEach(function (si) { M.students[si].picks.forEach(function (j) { need[j] = (need[j] || 0) + 1; }); });
      var used = {};
      M.blocks.forEach(function (bb, b) { for (var j = 0; j < M.subs.length; j++) used[b] = (used[b] || 0) + St.cnt[j][b]; });
      var pick = -1, score = -1;
      Object.keys(need).forEach(function (js) {
        var j = Number(js), sb = M.subs[j];
        if (sb.locked) return;
        var free = (M.bOf[sb.credit] || []).some(function (b) { return !St.cnt[j][b] && used[b] < M.R && !(sb.group && M.cap[sb.group] && groupIn(St, b, sb.group) >= M.cap[sb.group]); });
        if (!free) return;
        var sc = need[js] * 10 + (sb.count >= (sb.sections + 1) * sb.min ? 5 : 0) - sb.sections;
        if (sc > score) { score = sc; pick = j; }
      });
      if (pick < 0) break;
      var sbj = M.subs[pick], bestB = -1, bestC = Infinity;
      sbj.sections++;
      St.target[pick] = sbj.count / sbj.sections;
      (M.bOf[sbj.credit] || []).forEach(function (b) {
        if (St.cnt[pick][b] || used[b] >= M.R) return;
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
    }
    var res = result(M, St);
    if (added.length) {
      var cnt = {}; added.forEach(function (n) { cnt[n] = (cnt[n] || 0) + 1; });
      res.issues.unshift({ level: 'info', text: '학생을 모두 배정하려고 분반을 늘렸습니다: ' + Object.keys(cnt).map(function (n) { return n + ' +' + cnt[n]; }).join(', ') });
    }
    res.added = added;
    return res;
  }
  function groupIn(St, b, g) {
    var n = 0; St.M.subs.forEach(function (s, j) { if (s.group === g) n += St.cnt[j][b]; }); return n;
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
          sections.push({ subject: sub.name, credit: sub.credit, group: sub.group, block: bl.id, no: i + 1, label: bl.id + (x > 1 ? String(i + 1) : ''),
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
    M.blocks.forEach(function (bl) {
      var inB = sections.filter(function (s) { return s.block === bl.id; });
      if (inB.length > M.R) issues.push({ level: 'error', text: bl.id + ' 블록 분반이 ' + inB.length + '개로 교실 ' + M.R + '개보다 많습니다.' });
      var g = {};
      inB.forEach(function (s) { if (s.group && M.cap[s.group]) g[s.group] = (g[s.group] || 0) + 1; });
      Object.keys(g).forEach(function (k) { if (g[k] > M.cap[k]) issues.push({ level: 'error', text: bl.id + ' 블록에 ' + k + ' 분반이 ' + g[k] + '개로 ' + k + ' 교사 ' + M.cap[k] + '명보다 많습니다.' }); });
    });
    return { blocks: M.blocks, sections: sections, unassigned: unassigned, issues: issues, roomCount: M.R,
      ok: !issues.some(function (x) { return x.level === 'error'; }), students: M.students.length };
  }

  /** 교실 배치: 같은 과목·같은 교사는 블록이 달라도 같은 교실을 쓰도록 */
  function assignRooms(sections, rooms, keep) {
    var used = {}, pref = {};
    sections.forEach(function (s) {
      if (keep && s.room && rooms.indexOf(s.room) >= 0 && !(used[s.block] && used[s.block][s.room])) {
        (used[s.block] = used[s.block] || {})[s.room] = 1;
        var k = s.teacherId || s.subject; (pref[k] = pref[k] || {})[s.room] = (pref[k][s.room] || 0) + 1;
      } else s.room = keep ? s.room : '';
    });
    var todo = sections.filter(function (s) { return !s.room || rooms.indexOf(s.room) < 0; })
      .sort(function (a, b) { return a.subject < b.subject ? -1 : a.subject > b.subject ? 1 : a.no - b.no; });
    todo.forEach(function (s) {
      var u = used[s.block] = used[s.block] || {};
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
  function assignTeachers(sections, teachersByGroup, keep) {
    var busy = {}, load = {};
    sections.forEach(function (s) {
      if (keep && s.teacherId) { (busy[s.block] = busy[s.block] || {})[s.teacherId] = 1; load[s.teacherId] = (load[s.teacherId] || 0) + (s.credit || 1); }
      else if (!keep) s.teacherId = '';
    });
    sections.filter(function (s) { return !s.teacherId; }).sort(function (a, b) { return a.subject < b.subject ? -1 : 1; }).forEach(function (s) {
      var list = (teachersByGroup[s.group] || []).filter(function (t) { return !(busy[s.block] && busy[s.block][t.id]); });
      if (!list.length) return;
      list.sort(function (a, b) { return (load[a.id] || 0) - (load[b.id] || 0); });
      s.teacherId = list[0].id;
      (busy[s.block] = busy[s.block] || {})[s.teacherId] = 1;
      load[s.teacherId] = (load[s.teacherId] || 0) + (s.credit || 1);
    });
    return sections;
  }

  return { solve: solve, assignOnly: assignOnly, assignRooms: assignRooms, assignTeachers: assignTeachers, prepare: prepare, LETTERS: LETTERS };
})();
if (typeof module !== 'undefined') module.exports = BLOCK;
