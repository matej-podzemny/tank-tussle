// Shared game logic for Tank Tussle (runs in the browser for local play and in Node on the server).
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.TT = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';
  const C = {
    CELL: 64, WALL: 4, TANK_R: 13, BULLET_R: 3.2,
    BULLET_SPEED: 150, BULLET_LIFE: 10, MAX_BULLETS: 5,
    TANK_SPEED: 105, TANK_ROT: 3.4, ROUND_END_DELAY: 3,
    OWNER_GRACE: 0.05,
  };
  // Team mode: two teams, Red (0) and Blue (1). Friendly fire is ON like the original; flip to false to make
  // teammates' shots (bullets, lasers, frags, mines...) pass through you. Your own shots can always hit you.
  const FRIENDLY_FIRE = true;
  const TEAM_COLORS = ['#d8342c', '#2f6fd6'], TEAM_NAMES = ['Red', 'Blue'];
  const COLORS = ['#d8342c', '#3fa33a', '#2f6fd6', '#e0a800', '#f07a1a', '#8e44ad', '#17a2b8', '#e75480'];
  const COLOR_NAMES = ['Red', 'Green', 'Blue', 'Yellow', 'Orange', 'Purple', 'Cyan', 'Pink'];

  // Emoji reactions (shown as a bubble over the tank, or over its score when dead). Index = wire id.
  const REACTIONS = ['😂', '😡', '😭', '😎', '💀', '👍'];
  const REACTION_NAMES = ['Laugh', 'Mad', 'Cry', 'Cool', 'Dead', 'GG'];
  const REACT_COOLDOWN = 1.5, REACT_SHOW = 2; // seconds
  // Allowed reaction + per-player cooldown. `last` maps player id -> time of the last accepted one (seconds).
  function tryReact(last, id, r, now, cooldown = REACT_COOLDOWN) {
    if (!Number.isInteger(r) || r < 0 || r >= REACTIONS.length) return false;
    if (last[id] != null && now - last[id] < cooldown) return false;
    last[id] = now; return true;
  }
  // Bots sometimes react to a kill: the killer laughs / looks cool, a killed bot sometimes cries or rages.
  function botReaction(ev, isBot, rnd = Math.random) {
    if (!ev || ev.type !== 'die') return null;
    if (ev.by != null && ev.by !== ev.id && isBot(ev.by) && rnd() < 0.45) return { id: ev.by, r: rnd() < 0.7 ? 0 : 3 };
    if (isBot(ev.id) && rnd() < 0.2) return { id: ev.id, r: rnd() < 0.5 ? 2 : (ev.by === ev.id ? 4 : 1) };
    return null;
  }

  // Deathmatch: no rounds. A dead tank respawns after RESPAWN s at a safe spot, blinking (can't be hit) for PROTECT s
  // (firing ends it early). Score = kills; a self-kill or a team kill costs 1. The match ends at the kill target
  // (a player's kills, or a team's total in Teams) or when the time runs out, whichever comes first.
  const DM = { RESPAWN: 3, PROTECT: 1.5, TARGETS: [10, 15, 25], TARGET: 15, TIME: 300 };

  const rand = (a, b) => a + Math.random() * (b - a);
  const randi = (a, b) => Math.floor(rand(a, b + 1));

  // ---------- Maze ----------
  // hw[r][c] = wall on the top edge of cell (c,r), r in 0..rows ; vw[r][c] = wall on the left edge, c in 0..cols
  function genMaze(cols, rows) {
    const hw = [], vw = [];
    for (let r = 0; r <= rows; r++) hw.push(new Array(cols).fill(1));
    for (let r = 0; r < rows; r++) vw.push(new Array(cols + 1).fill(1));
    const seen = rows && Array.from({ length: rows }, () => new Array(cols).fill(false));
    const stack = [[randi(0, cols - 1), randi(0, rows - 1)]];
    seen[stack[0][1]][stack[0][0]] = true;
    while (stack.length) {
      const [c, r] = stack[stack.length - 1];
      const nb = [];
      if (c > 0 && !seen[r][c - 1]) nb.push([c - 1, r, 'L']);
      if (c < cols - 1 && !seen[r][c + 1]) nb.push([c + 1, r, 'R']);
      if (r > 0 && !seen[r - 1][c]) nb.push([c, r - 1, 'U']);
      if (r < rows - 1 && !seen[r + 1][c]) nb.push([c, r + 1, 'D']);
      if (!nb.length) { stack.pop(); continue; }
      const [nc, nr, d] = nb[randi(0, nb.length - 1)];
      if (d === 'L') vw[r][c] = 0; else if (d === 'R') vw[r][c + 1] = 0;
      else if (d === 'U') hw[r][c] = 0; else hw[r + 1][c] = 0;
      seen[nr][nc] = true; stack.push([nc, nr]);
    }
    // Knock out only a small fraction (~6-12%) of the remaining interior walls for a few loops.
    // Starting from a perfect (fully connected) maze, removing walls can never isolate a cell.
    const interior = [];
    for (let r = 1; r < rows; r++) for (let c = 0; c < cols; c++) if (hw[r][c]) interior.push(['h', r, c]);
    for (let r = 0; r < rows; r++) for (let c = 1; c < cols; c++) if (vw[r][c]) interior.push(['v', r, c]);
    const extra = Math.round(interior.length * rand(0.06, 0.12));
    for (let i = 0; i < extra && interior.length; i++) {
      const [k, r, c] = interior.splice(randi(0, interior.length - 1), 1)[0];
      if (k === 'h') hw[r][c] = 0; else vw[r][c] = 0;
    }
    return { cols, rows, hw, vw };
  }

  // Merge wall edges into axis-aligned rectangles {x,y,w,h}
  function mazeRects(m) {
    const { CELL, WALL } = C, h = WALL / 2, rects = [];
    for (let r = 0; r <= m.rows; r++) {
      let c = 0;
      while (c < m.cols) {
        if (!m.hw[r][c]) { c++; continue; }
        let e = c; while (e < m.cols && m.hw[r][e]) e++;
        rects.push({ x: c * CELL - h, y: r * CELL - h, w: (e - c) * CELL + WALL, h: WALL });
        c = e;
      }
    }
    for (let c = 0; c <= m.cols; c++) {
      let r = 0;
      while (r < m.rows) {
        if (!m.vw[r][c]) { r++; continue; }
        let e = r; while (e < m.rows && m.vw[e][c]) e++;
        rects.push({ x: c * CELL - h, y: r * CELL - h, w: WALL, h: (e - r) * CELL + WALL });
        r = e;
      }
    }
    return rects;
  }

  // ---------- Collision helpers ----------
  function circleHitsRect(x, y, r, q) {
    const nx = Math.max(q.x, Math.min(x, q.x + q.w)), ny = Math.max(q.y, Math.min(y, q.y + q.h));
    const dx = x - nx, dy = y - ny;
    return dx * dx + dy * dy < r * r;
  }
  function pushCircleOut(o, r, rects) {
    for (let it = 0; it < 4; it++) {
      let moved = false;
      for (const q of rects) {
        const nx = Math.max(q.x, Math.min(o.x, q.x + q.w)), ny = Math.max(q.y, Math.min(o.y, q.y + q.h));
        let dx = o.x - nx, dy = o.y - ny; const d2 = dx * dx + dy * dy;
        if (d2 >= r * r) continue;
        if (d2 > 1e-9) { const d = Math.sqrt(d2), p = r - d; o.x += dx / d * p; o.y += dy / d * p; }
        else { // centre inside rect: push along smallest axis
          const l = o.x - q.x, rr = q.x + q.w - o.x, t = o.y - q.y, b = q.y + q.h - o.y, mn = Math.min(l, rr, t, b);
          if (mn === l) o.x = q.x - r; else if (mn === rr) o.x = q.x + q.w + r; else if (mn === t) o.y = q.y - r; else o.y = q.y + q.h + r;
        }
        moved = true;
      }
      if (!moved) break;
    }
  }

  // ---------- Weapons ----------
  const WEAPONS = ['gatling', 'laser', 'frag', 'deathray', 'missile', 'mine', 'rc', 'shotgun'];
  const WEAPON_NAMES = { gatling: 'Gatling gun', laser: 'Laser', frag: 'Frag bomb', deathray: 'Death ray', missile: 'Homing missile', mine: 'Booby trap', rc: 'RC missile', shotgun: 'Shotgun' };
  const W = {
    CRATE_MIN: 8, CRATE_MAX: 12, CRATE_FIRST_MIN: 3, CRATE_FIRST_MAX: 6, MAX_CRATES: 3, CRATE_R: 10,
    GATLING_AMMO: 24, GATLING_SPIN: 1.0, GATLING_RATE: 0.07, GATLING_SPEED: 200, GATLING_LIFE: 3.5, GATLING_SPREAD: 0.13,
    LASER_LEN: 1100, LASER_GUIDE: 500,
    FRAG_SPEED: 120, FRAG_FUSE: 3, FRAG_PIECES: 26, FRAG_PIECE_SPEED: 210,
    RAY_CHARGE: 2.0, RAY_LEN: 2200, RAY_TURN: 0.003, RAY_CONE: 0.9, RAY_LOCK: 0.7,
    MISSILE_SPEED: 125, MISSILE_TURN: 3.0, MISSILE_LIFE: 9, MISSILE_SEEK_AFTER: 2.0,
    RC_SPEED: 130, RC_TURN: 3.4, RC_LIFE: 7,
    MINE_ARM: 1.0, MINE_TRIGGER: 13, MINE_NEAR: 25, MINE_DELAY: 0.25,
    SHOTGUN_PELLETS: 14, SHOTGUN_SPREAD: 0.3, SHOTGUN_SPEED: 190, SHOTGUN_LIFE_MIN: 2, SHOTGUN_LIFE_MAX: 3,
  };
  const KIND_R = { b: C.BULLET_R, g: 2.2, frag: 2, bomb: 5, missile: 4, rc: 4 };
  const wrapA = a => { while (a > Math.PI) a -= 2 * Math.PI; while (a < -Math.PI) a += 2 * Math.PI; return a; };
  // 0 = arming (visible), 1 = armed (invisible), 2 = revealed by a tank driving over it
  const mineState = m => m.revealed ? 2 : m.age >= W.MINE_ARM ? 1 : 0;

  // March a ray through the maze with the same bounce rules as bullets. Returns bounce points + dense samples.
  function traceRay(rects, x, y, a, len, stepLen = 2) {
    const o = { x, y, vx: Math.cos(a), vy: Math.sin(a) }, pts = [[x, y, 0]], samples = [];
    for (let d = 0; d < len; d += stepLen) {
      let bounced = false;
      o.x += o.vx * stepLen;
      if (rects.some(q => circleHitsRect(o.x, o.y, 1, q))) { o.x -= o.vx * stepLen; o.vx = -o.vx; bounced = true; }
      o.y += o.vy * stepLen;
      if (rects.some(q => circleHitsRect(o.x, o.y, 1, q))) { o.y -= o.vy * stepLen; o.vy = -o.vy; bounced = true; }
      if (bounced) pts.push([o.x, o.y, d]);
      samples.push([o.x, o.y, d]);
    }
    pts.push([o.x, o.y, len]);
    return { pts, samples };
  }

  // ---------- Game ----------
  function createGame() {
    return { players: [], tanks: {}, bullets: [], crates: [], mines: [], beams: [], nextId: 1, round: 0, phase: 'play', endTimer: 0, time: 0, crateTimer: 0, maze: null, rects: [], events: [], mode: 'ffa', teamScore: [0, 0],
      match: 'rounds', dmTarget: DM.TARGET, dmTime: DM.TIME, dmLeft: DM.TIME, winner: null };
  }
  // match = 'rounds' (last tank / team standing scores) or 'dm' (deathmatch). opts: { target (kills), time (s) }
  function setMatch(g, match, opts = {}) {
    g.match = match === 'dm' ? 'dm' : 'rounds';
    g.dmTarget = DM.TARGETS.includes(+opts.target) ? +opts.target : (opts.anyTarget && +opts.target > 0 ? +opts.target : DM.TARGET);
    g.dmTime = +opts.time > 0 ? +opts.time : DM.TIME; g.dmLeft = g.dmTime; g.winner = null;
  }
  const isDM = g => g.match === 'dm';
  // ---------- teams ----------
  const teamOf = (g, id) => { const p = g.players.find(p => p.id === id); return p ? p.team : -1; };
  // true when a and b are different tanks on the same team (only in team mode)
  const sameTeam = (g, a, b) => g.mode === 'teams' && a !== b && teamOf(g, a) >= 0 && teamOf(g, a) === teamOf(g, b);
  // Balance: humans alternate Red/Blue, then each bot joins the smaller team. `list` = [{bot}], returns team per entry.
  function balanceTeams(list) {
    const out = [], n = [0, 0]; let h = 0;
    list.forEach((x, i) => { if (!x.bot) { out[i] = h++ % 2; n[out[i]]++; } });
    list.forEach((x, i) => { if (x.bot) { out[i] = n[0] <= n[1] ? 0 : 1; n[out[i]]++; } });
    return out;
  }
  function setMode(g, mode) { g.mode = mode === 'teams' ? 'teams' : 'ffa'; }
  function setTeam(g, id, team) { const p = g.players.find(p => p.id === id); if (p) p.team = team ? 1 : 0; }
  function addPlayer(g, p) {
    const used = new Set(g.players.map(q => q.color));
    let ci = p.colorIndex;
    if (ci == null || used.has(ci)) { ci = 0; while (used.has(ci)) ci++; }
    let team = p.team;
    if (team !== 0 && team !== 1) { const n = [0, 1].map(k => g.players.filter(q => q.team === k).length); team = n[0] <= n[1] ? 0 : 1; }
    const pl = { id: p.id, name: p.name || COLOR_NAMES[ci], color: ci, score: 0, team, shots: 0 };
    g.players.push(pl);
    return pl;
  }
  function removePlayer(g, id) {
    g.players = g.players.filter(p => p.id !== id);
    delete g.tanks[id];
  }
  function mazeSizeFor(n) {
    if (n <= 2) return [randi(5, 8), randi(4, 6)];
    if (n === 3) return [randi(7, 9), randi(5, 7)];
    if (n === 4) return [randi(8, 10), randi(6, 7)];
    if (n <= 6) return [randi(10, 12), randi(7, 8)];
    return [randi(12, 13), randi(8, 9)];
  }
  function newRound(g) {
    const n = Math.max(1, g.players.length);
    const [cols, rows] = mazeSizeFor(n);
    g.maze = genMaze(cols, rows);
    g.rects = mazeRects(g.maze);
    g.bullets = []; g.crates = []; g.mines = []; g.beams = []; g.tanks = {}; g.round++; g.phase = 'play'; g.endTimer = 0;
    g.crateTimer = rand(W.CRATE_FIRST_MIN, W.CRATE_FIRST_MAX);
    const chosen = [];
    for (const p of g.players) {
      let best = null, bestD = -1;
      for (let k = 0; k < 40; k++) {
        const c = randi(0, cols - 1), r = randi(0, rows - 1);
        if (chosen.some(q => q[0] === c && q[1] === r)) continue;
        const d = chosen.length ? Math.min(...chosen.map(q => Math.abs(q[0] - c) + Math.abs(q[1] - r))) + Math.random() * 0.5 : Math.random();
        if (d > bestD) { bestD = d; best = [c, r]; }
      }
      if (!best) { // unlucky random picks: take the free cell farthest from the others (never share a cell)
        for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
          if (chosen.some(q => q[0] === c && q[1] === r)) continue;
          const d = chosen.length ? Math.min(...chosen.map(q => Math.abs(q[0] - c) + Math.abs(q[1] - r))) : 0;
          if (d > bestD) { bestD = d; best = [c, r]; }
        }
        if (!best) best = [0, 0];
      }
      chosen.push(best);
      g.tanks[p.id] = newTank(p.id, best);
      if (isDM(g)) g.tanks[p.id].prot = DM.PROTECT;
    }
    g.events.push({ type: 'round', round: g.round });
  }

  function newTank(id, cell) {
    return { id, x: (cell[0] + 0.5) * C.CELL, y: (cell[1] + 0.5) * C.CELL,
      a: randi(0, 3) * Math.PI / 2 + rand(-0.3, 0.3), alive: true, fireHeld: false,
      weapon: null, ammo: 0, cool: 0, charge: 0, bombId: 0, rcId: 0, firing: false, lock: 0, respawn: 0, prot: 0 };
  }
  // Deathmatch respawn spot: the cell farthest from enemy tanks, with nothing dangerous (bullets, mines, beams) nearby
  // and never on top of another tank. A little randomness among equally good cells.
  function safeSpawnCell(g, id) {
    const { cols, rows } = g.maze, CS = C.CELL;
    const others = Object.values(g.tanks).filter(o => o.alive && o.id !== id);
    let best = [0, 0], bestS = -1e9;
    for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
      const x = (c + 0.5) * CS, y = (r + 0.5) * CS;
      let s = 0, near = 1e9;
      for (const o of others) {
        const d = Math.hypot(o.x - x, o.y - y);
        if (d < CS) s -= 1e6;                                   // occupied
        if (!sameTeam(g, id, o.id)) near = Math.min(near, d);  // enemies: farther is better
      }
      s += Math.min(near, 12 * CS);
      for (const b of g.bullets) { const d = Math.hypot(b.x - x, b.y - y); if (d < 2.5 * CS) s -= (2.5 * CS - d) * 40; }
      for (const m of g.mines) if (Math.hypot(m.x - x, m.y - y) < 1.5 * CS) s -= 1e5;
      for (const bm of g.beams) if (bm.pts.some(p => Math.hypot(p[0] - x, p[1] - y) < CS)) s -= 1e5;
      s += Math.random() * 0.4 * CS;
      if (s > bestS) { bestS = s; best = [c, r]; }
    }
    return best;
  }
  function respawn(g, id) {
    const t = newTank(id, safeSpawnCell(g, id)); t.prot = DM.PROTECT;
    g.tanks[id] = t; g.events.push({ type: 'respawn', id, x: t.x, y: t.y });
    return t;
  }
  // Deathmatch scoring + match end. by = killer id (the projectile owner).
  function dmScore(g, victim, by) {
    const pv = g.players.find(p => p.id === victim), pk = g.players.find(p => p.id === by);
    const bad = by === victim || sameTeam(g, victim, by), who = bad ? (by === victim ? pv : pk) : pk;
    if (!who) return;
    const d = bad ? -1 : 1; who.score += d;
    if (g.mode === 'teams' && (who.team === 0 || who.team === 1)) g.teamScore[who.team] += d;
  }
  function dmWinner(g, reason) {
    if (g.mode === 'teams') { const [a, b] = g.teamScore; return { reason, team: a === b ? -1 : a > b ? 0 : 1 }; }
    const top = Math.max(...g.players.map(p => p.score)), lead = g.players.filter(p => p.score === top);
    return { reason, id: lead.length === 1 ? lead[0].id : 0 };
  }
  function dmCheckEnd(g) {
    const reached = g.mode === 'teams' ? Math.max(...g.teamScore) >= g.dmTarget : g.players.some(p => p.score >= g.dmTarget);
    if (reached || g.dmLeft <= 0) {
      g.phase = 'over'; g.dmLeft = Math.max(0, g.dmLeft); g.winner = dmWinner(g, reached ? 'target' : 'time');
      g.events.push(Object.assign({ type: 'over' }, g.winner));
    }
  }

  function spawnCrate(g, type, x, y) {
    if (x == null) {
      const { cols, rows } = g.maze;
      for (let k = 0; k < 30; k++) {
        const cx = (randi(0, cols - 1) + 0.5) * C.CELL, cy = (randi(0, rows - 1) + 0.5) * C.CELL;
        const busy = Object.values(g.tanks).some(t => t.alive && Math.hypot(t.x - cx, t.y - cy) < 48) || g.crates.some(c => c.x === cx && c.y === cy);
        if (!busy) { x = cx; y = cy; break; }
      }
      if (x == null) return null;
    }
    const c = { id: g.nextId++, x, y, type: type || WEAPONS[randi(0, WEAPONS.length - 1)] };
    g.crates.push(c);
    return c;
  }
  function giveWeapon(t, type) {
    t.weapon = type; t.cool = 0; t.charge = 0; t.bombId = 0; t.rcId = 0; t.firing = false;
    t.ammo = type === 'gatling' ? W.GATLING_AMMO : 1;
  }

  function moveBullet(b, dist, rects) {
    const r = b.r || C.BULLET_R;
    const steps = Math.max(1, Math.ceil(dist / 1.5)), sp = Math.hypot(b.vx, b.vy) || 1, f = dist / sp / steps;
    let bounced = false;
    for (let s = 0; s < steps; s++) {
      b.x += b.vx * f;
      if (rects.some(q => circleHitsRect(b.x, b.y, r, q))) { b.x -= b.vx * f; b.vx = -b.vx; bounced = true; }
      b.y += b.vy * f;
      if (rects.some(q => circleHitsRect(b.x, b.y, r, q))) { b.y -= b.vy * f; b.vy = -b.vy; bounced = true; }
    }
    return bounced;
  }

  function kill(g, t, by, cause) {
    if (!t.alive || t.prot > 0 || g.phase === 'over') return false;
    if (!FRIENDLY_FIRE && sameTeam(g, t.id, by)) return false;
    t.alive = false;
    g.events.push({ type: 'die', id: t.id, x: t.x, y: t.y, by, cause });
    if (isDM(g)) { t.respawn = DM.RESPAWN; dmScore(g, t.id, by); }
    return true;
  }
  function spawnProjectile(g, t, kind, speed, extra) {
    const a = t.a + (extra && extra.spread ? rand(-extra.spread, extra.spread) : 0);
    const b = Object.assign({ id: g.nextId++, owner: t.id, kind, r: KIND_R[kind], x: t.x, y: t.y, vx: Math.cos(a) * speed, vy: Math.sin(a) * speed, age: 0, a }, extra || {});
    moveBullet(b, C.TANK_R + b.r + 3, g.rects); // emerge from the barrel (may bounce straight back — like the original)
    g.bullets.push(b);
    return b;
  }
  function burstFrag(g, b) {
    for (let i = 0; i < W.FRAG_PIECES; i++) {
      const a = Math.random() * Math.PI * 2, s = W.FRAG_PIECE_SPEED * rand(0.6, 1.1);
      g.bullets.push({ id: g.nextId++, owner: b.owner, kind: 'frag', r: KIND_R.frag, x: b.x, y: b.y, vx: Math.cos(a) * s, vy: Math.sin(a) * s, age: 0, life: rand(0.5, 1.0), grace: 0 });
    }
    g.events.push({ type: 'burst', x: b.x, y: b.y });
  }
  // Death ray: ignores inner walls, bends slightly towards tanks ahead of it, ends at the outer wall. Never hits its owner.
  function deathRayPath(g, t, a) {
    const Wd = g.maze.cols * C.CELL, Hd = g.maze.rows * C.CELL, step = 2;
    let x = t.x + Math.cos(a) * 8, y = t.y + Math.sin(a) * 8;
    const pts = [[x, y]], hits = [], foes = Object.values(g.tanks).filter(o => o.alive && o.id !== t.id && (FRIENDLY_FIRE || !sameTeam(g, o.id, t.id)));
    const bendTo = foes.filter(o => !sameTeam(g, o.id, t.id)); // the ray only bends towards enemies
    for (let d = 0; d < W.RAY_LEN; d += step) {
      let best = null, bd = 1e9;
      for (const o of bendTo) {
        if (hits.includes(o.id)) continue;
        const dist = Math.hypot(o.x - x, o.y - y), off = wrapA(Math.atan2(o.y - y, o.x - x) - a);
        if (Math.abs(off) < W.RAY_CONE && dist < bd) { bd = dist; best = off; }
      }
      if (best !== null) a += Math.max(-W.RAY_TURN * step, Math.min(W.RAY_TURN * step, best));
      x += Math.cos(a) * step; y += Math.sin(a) * step;
      if (x < 0 || y < 0 || x > Wd || y > Hd) { x = Math.max(0, Math.min(Wd, x)); y = Math.max(0, Math.min(Hd, y)); break; }
      for (const o of foes) if (!hits.includes(o.id) && Math.hypot(o.x - x, o.y - y) < C.TANK_R) hits.push(o.id);
      if (d % 8 === 0) pts.push([x, y]);
    }
    pts.push([x, y]);
    return { pts, hits };
  }
  function fireBeam(g, t, kind) {
    let cut;
    if (kind === 'deathray') {
      const p = deathRayPath(g, t, t.a); cut = p.pts;
      for (const id of p.hits) kill(g, g.tanks[id], t.id, kind);
      t.lock = W.RAY_LOCK;
    } else {
      const ray = traceRay(g.rects, t.x + Math.cos(t.a) * 8, t.y + Math.sin(t.a) * 8, t.a, W.LASER_LEN);
      cut = ray.pts;
      for (const [x, y, d] of ray.samples) {
        let hitAny = false;
        for (const o of Object.values(g.tanks)) {
          if (!o.alive || (o.id === t.id && d < 30)) continue;
          if (Math.hypot(o.x - x, o.y - y) < C.TANK_R && kill(g, o, t.id, kind)) hitAny = true;
        }
        if (hitAny) { // laser stops at first victim
          cut = ray.pts.filter(p => p[2] < d); cut.push([x, y]); break;
        }
      }
    }
    g.beams.push({ id: g.nextId++, kind, owner: t.id, pts: cut, life: kind === 'laser' ? 0.35 : W.RAY_LOCK });
    g.events.push({ type: kind, id: t.id });
  }

  function useWeapon(g, t, k, pressed, dt) {
    switch (t.weapon) {
      case 'gatling': // one press: barrels spin up, then the whole belt sprays out
        if (t.charge > 0) { t.charge -= dt; if (t.charge <= 0) { t.charge = 0; t.firing = true; } }
        else if (!t.firing && pressed) { t.charge = W.GATLING_SPIN; g.events.push({ type: 'spin', id: t.id }); }
        if (t.firing && t.cool <= 0) {
          spawnProjectile(g, t, 'g', W.GATLING_SPEED, { spread: W.GATLING_SPREAD, life: W.GATLING_LIFE });
          t.cool = W.GATLING_RATE; t.ammo--; g.events.push({ type: 'gat', id: t.id });
          if (t.ammo <= 0) { t.weapon = null; t.firing = false; }
        }
        break;
      case 'laser': if (pressed) { fireBeam(g, t, 'laser'); t.weapon = null; } break;
      case 'frag': {
        const bomb = t.bombId && g.bullets.find(b => b.id === t.bombId);
        if (pressed) {
          if (bomb) { burstFrag(g, bomb); g.bullets = g.bullets.filter(b => b !== bomb); t.weapon = null; t.bombId = 0; }
          else if (!t.bombId) { t.bombId = spawnProjectile(g, t, 'bomb', W.FRAG_SPEED, { life: W.FRAG_FUSE, fuse: true }).id; g.events.push({ type: 'fire', id: t.id }); }
        }
        if (t.bombId && !bomb && !pressed) { t.weapon = null; t.bombId = 0; } // auto-burst already happened
        break;
      }
      case 'deathray':
        if (t.charge > 0) { t.charge -= dt; if (t.charge <= 0) { t.charge = 0; fireBeam(g, t, 'deathray'); t.weapon = null; } }
        else if (pressed) { t.charge = W.RAY_CHARGE; g.events.push({ type: 'charge', id: t.id }); }
        break;
      case 'missile':
        if (pressed) { spawnProjectile(g, t, 'missile', W.MISSILE_SPEED, { life: W.MISSILE_LIFE, grace: 0.5 }); t.weapon = null; g.events.push({ type: 'missile', id: t.id }); }
        break;
      case 'rc': // tank is frozen while its missile flies; left/right steer the missile
        if (!t.rcId) { if (pressed) { t.rcId = spawnProjectile(g, t, 'rc', W.RC_SPEED, { life: W.RC_LIFE, grace: 0.5, steer: 0 }).id; g.events.push({ type: 'missile', id: t.id }); } }
        else if (!g.bullets.some(b => b.id === t.rcId)) { t.weapon = null; t.rcId = 0; }
        break;
      case 'mine':
        if (pressed) {
          const m = { id: g.nextId++, owner: t.id, x: t.x - Math.cos(t.a) * (C.TANK_R + 6), y: t.y - Math.sin(t.a) * (C.TANK_R + 6), age: 0, revealed: false, rt: 0 };
          pushCircleOut(m, 5, g.rects); g.mines.push(m);
          g.events.push({ type: 'mine', id: t.id });
          t.weapon = null;
        }
        break;
      case 'shotgun':
        if (pressed) {
          for (let i = 0; i < W.SHOTGUN_PELLETS; i++) spawnProjectile(g, t, 'g', W.SHOTGUN_SPEED * rand(0.85, 1.15), { spread: W.SHOTGUN_SPREAD, life: rand(W.SHOTGUN_LIFE_MIN, W.SHOTGUN_LIFE_MAX) });
          t.weapon = null; g.events.push({ type: 'shotgun', id: t.id });
        }
        break;
    }
  }

  // next waypoint for a homing missile: BFS through the maze towards the target's cell
  function cellOf(g, x, y) { return [Math.max(0, Math.min(g.maze.cols - 1, Math.floor(x / C.CELL))), Math.max(0, Math.min(g.maze.rows - 1, Math.floor(y / C.CELL)))]; }
  function nextWaypoint(g, x, y, tx, ty) {
    const m = g.maze, [sc, sr] = cellOf(g, x, y), [ec, er] = cellOf(g, tx, ty);
    if (sc === ec && sr === er) return [tx, ty];
    const prev = new Map(), key = (c, r) => r * m.cols + c, q = [[ec, er]]; prev.set(key(ec, er), null);
    while (q.length) { // search from target back to missile so the first step is easy to read
      const [c, r] = q.shift();
      if (c === sc && r === sr) break;
      const nb = [];
      if (c > 0 && !m.vw[r][c]) nb.push([c - 1, r]); if (c < m.cols - 1 && !m.vw[r][c + 1]) nb.push([c + 1, r]);
      if (r > 0 && !m.hw[r][c]) nb.push([c, r - 1]); if (r < m.rows - 1 && !m.hw[r + 1][c]) nb.push([c, r + 1]);
      for (const n of nb) { const kk = key(n[0], n[1]); if (!prev.has(kk)) { prev.set(kk, [c, r]); q.push(n); } }
    }
    const nx = prev.get(key(sc, sr));
    if (!nx) return [tx, ty];
    return [(nx[0] + 0.5) * C.CELL, (nx[1] + 0.5) * C.CELL];
  }

  function moveTank(t, rot, mv, dt, rects) {
    t.a += rot * C.TANK_ROT * dt;
    if (t.a > Math.PI) t.a -= 2 * Math.PI; else if (t.a < -Math.PI) t.a += 2 * Math.PI;
    const sp = mv > 0 ? C.TANK_SPEED : C.TANK_SPEED * 0.7;
    t.x += Math.cos(t.a) * mv * sp * dt; t.y += Math.sin(t.a) * mv * sp * dt;
    pushCircleOut(t, C.TANK_R, rects);
  }

  // Phone stick -> the same keys as the keyboard, tank-relative: up = forward (u), down = reverse (d),
  // left/right = rotate (l/r); diagonals combine them (up-left = forward + turn left).
  // dx, dy = stick offset as a fraction of its radius (screen axes, dy < 0 = up). Inside the dead zone: nothing.
  const STICK_AXIS = 0.38, STICK_DEAD = 0.25;
  function stickKeys(dx, dy, axis = STICK_AXIS) {
    const k = { u: false, d: false, l: false, r: false };
    if (Math.hypot(dx, dy) <= STICK_DEAD) return k;
    k.u = dy < -axis; k.d = dy > axis; k.l = dx < -axis; k.r = dx > axis;
    return k;
  }
  // 'Point' stick mode: the tank turns toward screen angle `target` the short way and drives forward once it is
  // roughly facing it (within POINT_DRIVE). It stops turning within `step` (one frame of rotation), so no jitter.
  // Screen angles = world angles (y points down, -PI/2 = up).
  const POINT_DRIVE = 40 * Math.PI / 180;
  function pointKeys(a, target, step = C.TANK_ROT / 60) {
    const d = wrapA(target - a), k = { u: false, d: false, l: false, r: false };
    if (Math.abs(d) > step) { if (d > 0) k.r = true; else k.l = true; }
    if (Math.abs(d) <= POINT_DRIVE) k.u = true;
    return k;
  }

  // keys are booleans (humans) or 0..1 analog values (bots)
  const axis = v => v === true ? 1 : v > 0 ? Math.min(1, +v) : 0;
  // inputs: { [playerId]: {u,d,l,r,f} }
  // Shots fired this game (every trigger pull that actually shoots: cannon, gatling, laser, mine…).
  const SHOT_EVENTS = new Set(['fire', 'gat', 'shotgun', 'laser', 'deathray', 'missile', 'mine']);
  function step(g, inputs, dt) {
    const n0 = g.events.length;
    stepSim(g, inputs, dt);
    for (let i = n0; i < g.events.length; i++) {
      const e = g.events[i]; if (!SHOT_EVENTS.has(e.type)) continue;
      const p = g.players.find(p => p.id === e.id); if (p) p.shots = (p.shots || 0) + 1;
    }
  }
  function stepSim(g, inputs, dt) {
    g.time += dt;
    if (g.phase === 'over') return; // deathmatch finished: frozen on the result until a new game starts
    if (isDM(g)) {
      for (const p of g.players) if (!g.tanks[p.id]) g.tanks[p.id] = Object.assign(newTank(p.id, [0, 0]), { alive: false, respawn: 1 }); // joined mid-match
      for (const t of Object.values(g.tanks)) {
        if (!t.alive && t.respawn > 0) { t.respawn -= dt; if (t.respawn <= 0) respawn(g, t.id); }
        else if (t.prot > 0) t.prot = Math.max(0, t.prot - dt);
      }
    }
    const tanks = Object.values(g.tanks);
    for (const t of tanks) {
      if (!t.alive) continue;
      const k = inputs[t.id] || {};
      let rot = axis(k.r) - axis(k.l), mv = axis(k.u) - axis(k.d);
      const rc = t.rcId && g.bullets.find(b => b.id === t.rcId);
      if (rc) { rc.steer = rot; rot = 0; mv = 0; }
      if (t.lock > 0) { t.lock -= dt; rot = 0; mv = 0; }
      if (t.weapon === 'deathray' && t.charge > 0) mv = 0; // locked in place while charging (can still aim)
      t.px = t.x; t.py = t.y;
      moveTank(t, rot, mv, dt, g.rects);
      t.cool -= dt;
      const pressed = k.f && !t.fireHeld;
      if (pressed && t.prot > 0) t.prot = 0; // shooting ends spawn protection
      if (t.weapon) useWeapon(g, t, k, pressed, dt);
      else if (pressed) fire(g, t);
      t.fireHeld = !!k.f;
      // crate pickup (only with an empty slot)
      if (!t.weapon) for (let i = 0; i < g.crates.length; i++) {
        const c = g.crates[i];
        if (Math.hypot(c.x - t.x, c.y - t.y) < C.TANK_R + W.CRATE_R) { giveWeapon(t, c.type); g.crates.splice(i, 1); g.events.push({ type: 'pickup', id: t.id, weapon: c.type }); break; }
      }
    }
    // tank vs tank
    for (let i = 0; i < tanks.length; i++) for (let j = i + 1; j < tanks.length; j++) {
      const a = tanks[i], b = tanks[j]; if (!a.alive || !b.alive) continue;
      const dx = b.x - a.x, dy = b.y - a.y, d = Math.hypot(dx, dy), m = 2 * C.TANK_R;
      if (d < m && d > 1e-6) { const p = (m - d) / 2; a.x -= dx / d * p; a.y -= dy / d * p; b.x += dx / d * p; b.y += dy / d * p; pushCircleOut(a, C.TANK_R, g.rects); pushCircleOut(b, C.TANK_R, g.rects); }
    }
    for (const t of tanks) t.moved = t.alive && t.px != null && Math.hypot(t.x - t.px, t.y - t.py) > 0.05;
    // projectiles
    const keep = [], born = [];
    const all = g.bullets; g.bullets = born; // bursts during this loop land in `born`
    for (const b of all) {
      b.age += dt;
      const life = b.life != null ? b.life : C.BULLET_LIFE;
      if (b.age > life) { if (b.kind === 'bomb') burstFrag(g, b); continue; }
      if (b.kind === 'missile' && b.age > W.MISSILE_SEEK_AFTER) {
        let tgt = null, bd = 1e9;
        for (const t of tanks) if (t.alive) { const d = Math.hypot(t.x - b.x, t.y - b.y); if (d < bd) { bd = d; tgt = t; } } // nearest tank — may be you
        b.tgt = tgt ? tgt.id : 0;
        if (tgt) {
          const [wx, wy] = nextWaypoint(g, b.x, b.y, tgt.x, tgt.y);
          let want = Math.atan2(wy - b.y, wx - b.x), cur = Math.atan2(b.vy, b.vx), d = want - cur;
          while (d > Math.PI) d -= 2 * Math.PI; while (d < -Math.PI) d += 2 * Math.PI;
          cur += Math.max(-W.MISSILE_TURN * dt, Math.min(W.MISSILE_TURN * dt, d));
          b.vx = Math.cos(cur) * W.MISSILE_SPEED; b.vy = Math.sin(cur) * W.MISSILE_SPEED;
        }
      }
      if (b.kind === 'rc' && b.steer) {
        const cur = Math.atan2(b.vy, b.vx) + b.steer * W.RC_TURN * dt;
        b.vx = Math.cos(cur) * W.RC_SPEED; b.vy = Math.sin(cur) * W.RC_SPEED; b.steer = 0;
      }
      if (moveBullet(b, Math.hypot(b.vx, b.vy) * dt, g.rects)) g.events.push({ type: 'bounce' });
      b.a = Math.atan2(b.vy, b.vx);
      let hit = false;
      for (const t of tanks) {
        if (!t.alive || t.prot > 0) continue; // spawn-protected tanks: shots pass through
        if (t.id === b.owner && b.age < (b.grace != null ? b.grace : C.OWNER_GRACE)) continue;
        const dx = t.x - b.x, dy = t.y - b.y, r = C.TANK_R + b.r - 1;
        if (dx * dx + dy * dy < r * r && (FRIENDLY_FIRE || !sameTeam(g, t.id, b.owner))) { kill(g, t, b.owner, b.kind); hit = true; break; }
      }
      if (hit && b.kind === 'bomb') burstFrag(g, b);
      if (!hit) keep.push(b);
    }
    g.bullets = keep.concat(born);
    // mines
    for (const m of g.mines) m.age += dt;
    // booby traps: only tanks driving over them reveal them; after that, any movement nearby sets them off
    g.mines = g.mines.filter(m => {
      if (m.age < W.MINE_ARM) return true;
      if (!m.revealed) {
        if (tanks.some(t => t.alive && Math.hypot(t.x - m.x, t.y - m.y) < W.MINE_TRIGGER)) { m.revealed = true; m.rt = 0; g.events.push({ type: 'reveal', x: m.x, y: m.y }); }
        return true;
      }
      m.rt += dt;
      if (m.rt < W.MINE_DELAY || !tanks.some(t => t.moved && Math.hypot(t.x - m.x, t.y - m.y) < W.MINE_NEAR)) return true;
      burstFrag(g, m);
      return false;
    });
    // beams fade
    for (const bm of g.beams) bm.life -= dt;
    g.beams = g.beams.filter(bm => bm.life > 0);
    // crates
    g.crateTimer -= dt;
    if (g.crateTimer <= 0 && g.phase === 'play') { if (g.crates.length < W.MAX_CRATES) spawnCrate(g); g.crateTimer = rand(W.CRATE_MIN, W.CRATE_MAX); }
    // deathmatch: no rounds, just the clock and the kill target
    if (isDM(g)) { g.dmLeft -= dt; dmCheckEnd(g); return; }
    // round flow
    const alive = tanks.filter(t => t.alive);
    if (g.phase === 'play') {
      let over;
      if (g.mode === 'teams') { // over when only one team has tanks left (or nobody, if only one team is playing)
        const playing = new Set(tanks.map(t => teamOf(g, t.id))), left = new Set(alive.map(t => teamOf(g, t.id)));
        over = playing.size >= 2 ? left.size <= 1 : alive.length === 0;
      } else over = g.players.length >= 2 ? alive.length <= 1 : alive.length === 0;
      if (over && tanks.length) { g.phase = 'ending'; g.endTimer = C.ROUND_END_DELAY; }
    } else if (g.phase === 'ending') {
      g.endTimer -= dt;
      if (g.endTimer <= 0) {
        const still = Object.values(g.tanks).filter(t => t.alive);
        if (g.mode === 'teams') {
          const left = [...new Set(still.map(t => teamOf(g, t.id)))], playing = new Set(Object.keys(g.tanks).map(id => teamOf(g, +id)));
          if (left.length === 1 && left[0] >= 0 && playing.size >= 2) { g.teamScore[left[0]]++; g.events.push({ type: 'point', team: left[0] }); }
        } else if (still.length === 1 && g.players.length >= 2) {
          const p = g.players.find(p => p.id === still[0].id); if (p) { p.score++; g.events.push({ type: 'point', id: p.id }); }
        }
        newRound(g);
      }
    }
  }

  function fire(g, t) {
    const own = g.bullets.reduce((n, b) => n + (b.owner === t.id && b.kind === 'b' ? 1 : 0), 0);
    if (own >= C.MAX_BULLETS) return;
    spawnProjectile(g, t, 'b', C.BULLET_SPEED);
    g.events.push({ type: 'fire', id: t.id });
  }

  const r1 = v => Math.round(v * 10) / 10;
  const KINDS = ['b', 'g', 'frag', 'bomb', 'missile', 'rc'];
  function snapshot(g) {
    return {
      t: 's', time: Math.round(g.time * 1000), round: g.round, phase: g.phase,
      tk: Object.values(g.tanks).map(t => [t.id, r1(t.x), r1(t.y), Math.round(t.a * 1000) / 1000, t.alive ? 1 : 0, t.weapon ? WEAPONS.indexOf(t.weapon) : -1, t.ammo, Math.round((t.firing ? 1 : t.charge) * 100) / 100, t.lock > 0 || (t.rcId && g.bullets.some(b => b.id === t.rcId)) ? 1 : 0, !t.alive && t.respawn > 0 ? Math.ceil(t.respawn * 10) / 10 : 0, t.prot > 0 ? 1 : 0]),
      b: g.bullets.map(b => [b.id, r1(b.x), r1(b.y), KINDS.indexOf(b.kind), Math.round(b.a * 100) / 100, b.tgt || 0]),
      cr: g.crates.map(c => [c.id, c.x, c.y, WEAPONS.indexOf(c.type)]),
      mn: g.mines.map(m => [m.id, r1(m.x), r1(m.y), mineState(m), m.owner]),
      bm: g.beams.map(b => [b.id, b.kind === 'laser' ? 0 : 1, b.owner, Math.round(b.life * 100) / 100, b.pts.map(p => [r1(p[0]), r1(p[1])])]),
      sc: g.players.map(p => [p.id, p.score, p.team]),
      md: g.mode === 'teams' ? 1 : 0, ts: g.teamScore,
      dm: isDM(g) ? [Math.max(0, Math.round(g.dmLeft * 10) / 10), g.dmTarget] : 0, win: g.winner,
    };
  }

  return { SHOT_EVENTS, DM, setMatch, isDM, safeSpawnCell, respawn, kill, C, W, REACTIONS, REACTION_NAMES, REACT_COOLDOWN, REACT_SHOW, tryReact, botReaction, FRIENDLY_FIRE, TEAM_COLORS, TEAM_NAMES, teamOf, sameTeam, balanceTeams, setMode, setTeam, COLORS, COLOR_NAMES, WEAPONS, WEAPON_NAMES, KINDS, KIND_R, genMaze, mazeRects, traceRay, deathRayPath, nextWaypoint, mineState, moveBullet, moveTank, stickKeys, STICK_AXIS, STICK_DEAD, pointKeys, POINT_DRIVE, wrapA, circleHitsRect, createGame, addPlayer, removePlayer, newRound, step, snapshot, spawnCrate, giveWeapon };
});
