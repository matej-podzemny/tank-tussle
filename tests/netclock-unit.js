// Online render clock (pure Node): with jittery snapshot delivery the render time never runs backwards, rarely runs so
// far past the newest snapshot that the client's short extrapolation (120 ms) runs out (= a visible freeze), and stays
// close to the server (not tuned for the worst spike), and plays at exactly real speed nearly all the time (speed
// changes are what makes constant-speed bullets look uneven); a new game resets it.
let seed = (+process.env.SEED || 7) >>> 0; // deterministic (SEED=n to try others)
Math.random = () => { seed = (seed + 0x6D2B79F5) >>> 0; let t = seed; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
const TT = require('../public/game.js');
let fail = 0; const ok = (c, m) => { console.log((c ? '  ok   ' : '  FAIL ') + m); if (!c) fail++; };

// server sends a snapshot every 33 ms; delivery delay = 40 ms + jitter (+ a 150-250 ms spike now and then)
function run(jit, spikes, render) {
  const arrivals = [];
  for (let st = 0, last = 0; st < 60000; st += 1000 / 30) {
    const d = 40 + Math.random() * jit + (Math.random() < spikes ? 150 + Math.random() * 100 : 0);
    last = Math.max(last, 5000 + st + d); arrivals.push([last, st]); // TCP: in order
  }
  let i = 0, newest = -1, prev = -Infinity, back = 0, past = 0, frozen = 0, lag = 0, adj = 0, frames = 0;
  for (let now = 5000; now < 65000; now += 1000 / 60) {
    while (i < arrivals.length && arrivals[i][0] <= now) { render.sample(arrivals[i][1] - arrivals[i][0], arrivals[i][0]); newest = arrivals[i][1]; i++; }
    const rt = render.at(now, 1000 / 60); if (rt == null) continue;
    if (now < 9000) { prev = rt; continue; } // settle
    frames++; if (rt < prev - 0.01) back++; if (rt > newest) past++; if (rt > newest + 120) frozen++; lag += now - 5000 - rt; if (Math.abs(rt - prev - 1000 / 60) > 0.01) adj++; prev = rt;
  }
  return { back: back / frames, past: past / frames, frozen: frozen / frames, lag: lag / frames, adj: adj / frames };
}
const fresh = () => { const c = {}; return { sample: (e, n) => TT.clockSample(c, e, n), at: (n, dt) => TT.clockRender(c, n, dt) }; };
const old = () => { let off = null; return { sample: e => { off = off == null || e < off ? e : off * 0.98 + e * 0.02; }, at: n => off == null ? null : n + off - 60 }; };
const pct = x => (x * 100).toFixed(1) + '%';
for (const [name, jit, sp] of [['steady', 5, 0], ['jitter 0-40 ms', 40, 0], ['jitter + spikes', 40, 0.02], ['bad wifi', 100, 0.05]]) {
  const n = run(jit, sp, fresh()), o = run(jit, sp, old());
  ok(n.back === 0 && n.frozen < 0.015 && n.adj < 0.2 && n.lag < o.lag + 10, `${name}: never runs backwards, frozen ${pct(n.frozen)} of frames (extrapolating ${pct(n.past)}), speed changes ${pct(n.adj)}, shown ${n.lag.toFixed(0)} ms behind the server (old clock: backwards ${pct(o.back)}, frozen ${pct(o.frozen)}, speed changes ${pct(o.adj)}, ${o.lag.toFixed(0)} ms)`);
}
{ const c = {}; TT.clockSample(c, 100000, 1000); const a = TT.clockRender(c, 1000, 16);
  TT.clockSample(c, -900, 1100); const b = TT.clockRender(c, 1100, 16);
  ok(Math.abs(a - (101000 - c.delay)) < 1 && Math.abs(b - (200 - c.delay)) < 1, 'new game (server time restarts) resets the clock at once'); }
console.log(fail ? `\n${fail} FAILED` : '\nall ok'); process.exit(fail ? 1 : 0);
