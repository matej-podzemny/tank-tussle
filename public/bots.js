// Tank Tussle AI bots. Pure input generator: think(game, tank, brain, dt) -> {u,d,l,r,f}
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./game.js'));
  else root.TTBots = factory(root.TT);
})(typeof self !== 'undefined' ? self : this, function (TT) {
  'use strict';
  const { C, W } = TT;
  const LEVELS = {
    easy:   { react: 0.42, aimErr: 0.22, dodge: 0.25, bounces: 0, fireGap: 0.9, rayLen: 420 },
    normal: { react: 0.24, aimErr: 0.10, dodge: 0.65, bounces: 1, fireGap: 0.55, rayLen: 520 },
    hard:   { react: 0.12, aimErr: 0.04, dodge: 0.95, bounces: 2, fireGap: 0.35, rayLen: 620 },
  };
  const wrap = a => { while (a > Math.PI) a -= 2 * Math.PI; while (a < -Math.PI) a += 2 * Math.PI; return a; };
  const cellOf = (g, x, y) => [Math.max(0, Math.min(g.maze.cols - 1, Math.floor(x / C.CELL))), Math.max(0, Math.min(g.maze.rows - 1, Math.floor(y / C.CELL)))];

  function neighbours(m, c, r) {
    const nb = [];
    if (c > 0 && !m.vw[r][c]) nb.push([c - 1, r]); if (c < m.cols - 1 && !m.vw[r][c + 1]) nb.push([c + 1, r]);
    if (r > 0 && !m.hw[r][c]) nb.push([c, r - 1]); if (r < m.rows - 1 && !m.hw[r + 1][c]) nb.push([c, r + 1]);
    return nb;
  }
  // BFS distance field + parent pointers from (c,r)
  function bfs(m, c0, r0) {
    const N = m.cols * m.rows, dist = new Int16Array(N).fill(-1), par = new Int32Array(N).fill(-1), q = [r0 * m.cols + c0];
    dist[q[0]] = 0;
    for (let i = 0; i < q.length; i++) {
      const k = q[i], c = k % m.cols, r = (k / m.cols) | 0;
      for (const [nc, nr] of neighbours(m, c, r)) { const nk = nr * m.cols + nc; if (dist[nk] < 0) { dist[nk] = dist[k] + 1; par[nk] = k; q.push(nk); } }
    }
    return { dist, par };
  }
  function firstStep(m, field, startK, goalK) {
    let k = goalK, prev = goalK;
    while (k !== startK && k >= 0) { prev = k; k = field.par[k]; }
    return prev;
  }
  // Simulate a ray from the barrel: who does it hit first? (respects bounce budget; self counts after it leaves the barrel)
  function rayVerdict(g, t, a, len, maxBounces, ignoreSelf) {
    const ray = TT.traceRay(g.rects, t.x + Math.cos(a) * 8, t.y + Math.sin(a) * 8, a, len, 4);
    let bounces = 0, bi = 1, hitEnemy = false;
    for (const [x, y, d] of ray.samples) {
      while (bi < ray.pts.length - 1 && ray.pts[bi][2] <= d) { bounces++; bi++; }
      if (bounces > maxBounces && !hitEnemy) return null;
      for (const o of Object.values(g.tanks)) {
        if (!o.alive) continue;
        if (o.id === t.id) { if (ignoreSelf || d < C.TANK_R + 10) continue; if (Math.hypot(o.x - x, o.y - y) < C.TANK_R + 6) return hitEnemy ? 'risky' : 'self'; continue; }
        if (!hitEnemy && Math.hypot(o.x - x, o.y - y) < C.TANK_R + 2) {
          if (!isEnemy(g, t, o)) { if (TT.FRIENDLY_FIRE) return 'mate'; continue; } // a teammate is in the way: hold fire
          hitEnemy = true; // keep scanning: if we miss, does it come back at us?
        }
      }
    }
    return hitEnemy ? 'enemy' : null;
  }
  // Team mode: teammates are never targets or threats; friendly fire only matters for "don't shoot them".
  const isEnemy = (g, t, o) => o.alive && o.id !== t.id && !(TT.sameTeam && TT.sameTeam(g, t.id, o.id));
  function clearLine(g, x0, y0, x1, y1) {
    const d = Math.hypot(x1 - x0, y1 - y0), n = Math.ceil(d / 6);
    for (let i = 1; i < n; i++) { const x = x0 + (x1 - x0) * i / n, y = y0 + (y1 - y0) * i / n; if (g.rects.some(q => TT.circleHitsRect(x, y, 2, q))) return false; }
    return true;
  }
  // Is a projectile about to hit me? Returns the threatening bullet's velocity or null.
  function threat(g, t) {
    for (const b of g.bullets) {
      if (b.stuck || Math.hypot(b.x - t.x, b.y - t.y) > 170) continue;
      if (b.owner === t.id && b.age < 0.25) continue;
      if (!TT.FRIENDLY_FIRE && TT.sameTeam(g, t.id, b.owner)) continue; // teammates' shots pass through us
      const p = { x: b.x, y: b.y, vx: b.vx, vy: b.vy, r: b.r };
      for (let s = 0; s < 8; s++) {
        TT.moveBullet(p, Math.hypot(p.vx, p.vy) * 0.08, g.rects);
        if (Math.hypot(p.x - t.x, p.y - t.y) < C.TANK_R + p.r + 7) return p;
      }
    }
    // booby traps are invisible once armed: only avoid ones we can see (arming) or laid ourselves
    for (const m of g.mines) if (!m.revealed && m.age > 0.3 && (m.owner === t.id || m.age < W.MINE_ARM) && Math.hypot(m.x - t.x, m.y - t.y) < 60) return { vx: t.x - m.x, vy: t.y - m.y, mine: m };
    return null;
  }

  function newBrain(level) { return { L: LEVELS[level] || LEVELS.normal, next: 0, lastF: false, cool: 0, aimOff: 0, plan: null, stuckT: 0, lastPos: null, reverseT: 0, hold: 0 }; }

  function think(g, t, br, dt) {
    const k = { u: false, d: false, l: false, r: false, f: false };
    if (!t || !t.alive || !g.maze) return k;
    const L = br.L;
    br.next -= dt; br.cool -= dt; br.reverseT -= dt; br.hold -= dt;
    const rc = t.rcId && g.bullets.find(b => b.id === t.rcId);
    if (rc) { // our tank is frozen: steer the RC missile through the maze towards the nearest enemy
      br.lastPos = [t.x, t.y]; br.stuckT = 0;
      let tgt = null, bd = 1e9;
      for (const o of Object.values(g.tanks)) if (isEnemy(g, t, o)) { const d = Math.hypot(o.x - rc.x, o.y - rc.y); if (d < bd) { bd = d; tgt = o; } }
      if (tgt) {
        const [wx, wy] = TT.nextWaypoint(g, rc.x, rc.y, tgt.x, tgt.y), d = wrap(Math.atan2(wy - rc.y, wx - rc.x) - Math.atan2(rc.vy, rc.vx));
        const s = Math.max(-1, Math.min(1, d / 0.35));
        if (s > 0.02) k.r = s; else if (s < -0.02) k.l = -s;
      }
      return finish();
    }
    // stuck detection
    if (br.lastPos) { const mv = Math.hypot(t.x - br.lastPos[0], t.y - br.lastPos[1]); br.stuckT = br.plan && br.plan.move && mv < 0.4 ? br.stuckT + dt : 0; }
    br.lastPos = [t.x, t.y];
    if (br.stuckT > 0.7) { br.reverseT = 0.35; br.stuckT = 0; br.turnDir = Math.random() < 0.5 ? -1 : 1; }

    if (br.next <= 0) { // ---- decision tick (reaction time) ----
      br.next = L.react * (0.7 + Math.random() * 0.6);
      const m = g.maze, [c0, r0] = cellOf(g, t.x, t.y), startK = r0 * m.cols + c0, field = bfs(m, c0, r0);
      const enemies = Object.values(g.tanks).filter(o => isEnemy(g, t, o));
      const mates = Object.values(g.tanks).filter(o => o.alive && o.id !== t.id && !isEnemy(g, t, o));
      let target = null, td = 1e9;
      for (const o of enemies) { const [c, r] = cellOf(g, o.x, o.y), d = field.dist[r * m.cols + c]; const dd = (d < 0 ? 99 : d) + Math.hypot(o.x - t.x, o.y - t.y) / 1000; if (dd < td) { td = dd; target = o; } }
      // crate if we have no weapon and one is reasonably close
      let goal = target, goalD = td;
      if (!t.weapon) for (const cr of g.crates) { const [c, r] = cellOf(g, cr.x, cr.y), d = field.dist[r * m.cols + c]; if (d >= 0 && d < goalD * 0.8 + 1 && d < 7) { goal = cr; goalD = d; } }
      const plan = { move: true, aim: null, fire: false, dodge: null, goal };
      // dodge
      const th = Math.random() < L.dodge ? threat(g, t) : null;
      if (th) {
        const away = Math.atan2(-th.vy, -th.vx), perp1 = wrap(away + Math.PI / 2), perp2 = wrap(away - Math.PI / 2);
        const pick = th.mine ? Math.atan2(t.y - th.mine.y, t.x - th.mine.x) : (Math.abs(wrap(perp1 - t.a)) < Math.abs(wrap(perp2 - t.a)) ? perp1 : perp2);
        const fwd = Math.abs(wrap(pick - t.a)) < Math.PI / 2;
        plan.dodge = { angle: fwd ? pick : wrap(pick + Math.PI), back: !fwd };
      }
      // aim at visible target
      if (target) {
        const vis = clearLine(g, t.x, t.y, target.x, target.y);
        const dist = Math.hypot(target.x - t.x, target.y - t.y);
        if (vis) {
          if (Math.abs(br.aimOff) < 1e-6 || Math.random() < 0.3) br.aimOff = (Math.random() * 2 - 1) * L.aimErr;
          plan.aim = Math.atan2(target.y - t.y, target.x - t.x) + br.aimOff;
          plan.move = dist > 170 && t.weapon !== 'deathray';
        }
        // firing decision by weapon
        const w = t.weapon;
        const now = w === 'deathray' ? (h => h.some(id => mates.some(o => o.id === id)) ? 'mate' : h.length ? 'enemy' : null)(TT.deathRayPath(g, t, t.a).hits)
          : rayVerdict(g, t, t.a, w === 'laser' ? W.LASER_LEN : L.rayLen, w === 'laser' ? 9 : L.bounces, false);
        if (br.cool <= 0) {
          if (!w || w === 'gatling') plan.fire = now === 'enemy' || (now === 'risky' && Math.random() < 0.2);
          else if (w === 'laser' || w === 'deathray') plan.fire = now === 'enemy' || now === 'risky';
          else if (w === 'shotgun') plan.fire = vis && dist < 220 && now !== 'self' && now !== 'mate';
          else if (w === 'frag') {
            const bomb = t.bombId && g.bullets.find(b => b.id === t.bombId);
            const mateNear = bomb && mates.some(o => Math.hypot(o.x - bomb.x, o.y - bomb.y) < 90);
            if (bomb) plan.fire = !mateNear && (enemies.some(o => Math.hypot(o.x - bomb.x, o.y - bomb.y) < 55) && Math.hypot(t.x - bomb.x, t.y - bomb.y) > 70 || (bomb.age > 1.8 && Math.hypot(t.x - bomb.x, t.y - bomb.y) > 90));
            else plan.fire = vis && dist < 260 && dist > 90 && now !== 'self' && now !== 'mate';
          }
          else if (w === 'missile') plan.fire = vis && dist < 250 && now !== 'self' && now !== 'mate' && rayVerdict(g, t, t.a, 40, 0, false) !== 'self' && clearLine(g, t.x, t.y, t.x + Math.cos(t.a) * 30, t.y + Math.sin(t.a) * 30);
          else if (w === 'rc') plan.fire = !t.rcId && td < 8 && clearLine(g, t.x, t.y, t.x + Math.cos(t.a) * 30, t.y + Math.sin(t.a) * 30);
          else if (w === 'mine') plan.fire = td < 4 && Math.random() < 0.5 && !mates.some(o => Math.hypot(o.x - t.x, o.y - t.y) < 90);
        }
        if (w === 'deathray' && t.charge > 0) plan.move = false;
      }
      br.plan = plan;
    }

    const plan = br.plan; if (!plan) return k;
    // ---- continuous steering ----
    let wantA = null, drive = 0;
    if (br.reverseT > 0) { k.d = true; (br.turnDir > 0 ? (k.r = true) : (k.l = true)); br.thr = 0; return finish(); }
    if (plan.dodge) { wantA = plan.dodge.angle; drive = plan.dodge.back ? -1 : 1; }
    else if (plan.aim != null) { wantA = plan.aim; drive = plan.move ? 1 : 0; }
    else if (plan.goal) {
      const m = g.maze, [c0, r0] = cellOf(g, t.x, t.y), [gc, gr] = cellOf(g, plan.goal.x, plan.goal.y);
      let wx = plan.goal.x, wy = plan.goal.y;
      if (c0 !== gc || r0 !== gr) {
        if (!br.field || br.fieldCell !== r0 * m.cols + c0 || br.fieldRound !== g.round) { br.field = bfs(m, c0, r0); br.fieldCell = r0 * m.cols + c0; br.fieldRound = g.round; }
        const nk = firstStep(m, br.field, r0 * m.cols + c0, gr * m.cols + gc), nc = nk % m.cols, nr = (nk / m.cols) | 0;
        const ncx = (nc + 0.5) * C.CELL, ncy = (nr + 0.5) * C.CELL, LOOK = 38;
        // pure pursuit: chase a point sliding along the corridor centre line -> smooth arcs through gaps
        if (nc !== c0) { wy = ncy; wx = nc > c0 ? Math.min(ncx, t.x + LOOK) : Math.max(ncx, t.x - LOOK); }
        else { wx = ncx; wy = nr > r0 ? Math.min(ncy, t.y + LOOK) : Math.max(ncy, t.y - LOOK); }
      }
      wantA = Math.atan2(wy - t.y, wx - t.x); drive = 1;
    }
    let thr = 0;
    if (wantA != null) {
      const d = wrap(wantA - t.a), s = Math.max(-1, Math.min(1, d / 0.3)); // proportional turn: eases in, no left/right jitter
      if (s > 0.01) k.r = s; else if (s < -0.01) k.l = -s;
      thr = drive * Math.max(0, Math.cos(Math.min(Math.PI / 2, Math.abs(d) * 1.4))); // slow down while turning instead of stop/go
    }
    br.thr = (br.thr || 0) + (thr - (br.thr || 0)) * Math.min(1, dt * 10);
    if (br.thr > 0.02) k.u = br.thr; else if (br.thr < -0.02) k.d = -br.thr;
    // fire (needs a fresh press each time, except gatling which is held — and must stay held once it spins up, or it's lost)
    if (t.weapon === 'gatling' && (t.charge > 0 || t.firing)) k.f = true;
    else if (plan.fire && br.cool <= 0) {
      if (t.weapon === 'gatling') k.f = true;
      else if (!br.lastF) { k.f = true; br.cool = t.weapon ? 0.3 : L.fireGap * (0.7 + Math.random() * 0.6); plan.fire = false; }
    }
    return finish();
    function finish() {
      if (g.mines.some(m => m.revealed && Math.hypot(m.x - t.x, m.y - t.y) < W.MINE_NEAR + 4)) k.u = k.d = false; // sit still on a revealed trap
      br.lastF = k.f; return k;
    }
  }
  return { LEVELS, newBrain, think };
});
