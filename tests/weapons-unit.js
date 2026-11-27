// Weapons (pure Node): death ray freezes the tank while charging; armed traps never appear in snapshots; frag shards fly to the walls and stick there; no shooting while a homing missile flies; gatling only fires while held.
const TT = require('../public/game.js');
let fail = 0; const ok = (c, m) => { console.log((c ? '  ok   ' : '  FAIL ') + m); if (!c) fail++; };
const DT = 1 / 60;
function mk() { const g = TT.createGame(); for (let i = 1; i <= 2; i++) TT.addPlayer(g, { id: i, colorIndex: i - 1 }); TT.newRound(g); g.crateTimer = 1e9; return g; }

console.log('death ray');
{ const g = mk(), t = g.tanks[1]; TT.giveWeapon(t, 'deathray');
  TT.step(g, { 1: { f: true } }, DT); ok(t.charge > 0, 'fire starts the charge');
  const x = t.x, y = t.y, a = t.a;
  for (let i = 0; i < 30; i++) TT.step(g, { 1: { u: true, r: true } }, DT);
  ok(t.x === x && t.y === y, 'cannot drive while charging'); ok(t.a === a, 'cannot turn while charging');
  for (let i = 0; i < 200 && t.weapon; i++) TT.step(g, {}, DT);
  ok(!t.weapon, 'beam fired'); }

console.log('snapshot');
{ const g = mk(), t = g.tanks[1]; TT.giveWeapon(t, 'mine'); TT.step(g, { 1: { f: true } }, DT);
  ok(TT.snapshot(g).mn.length === 1, 'arming trap is visible');
  for (let i = 0; i < 90; i++) TT.step(g, {}, DT);
  ok(TT.mineState(g.mines[0]) === 1 && TT.snapshot(g).mn.length === 0, 'armed (invisible) trap is not sent to clients'); }

console.log('frag bomb');
{ const g = mk(), t = g.tanks[1]; g.tanks[2].prot = 1e9; TT.giveWeapon(t, 'frag');
  TT.step(g, { 1: { f: true } }, DT); TT.step(g, {}, DT); TT.step(g, { 1: { f: true } }, DT); t.prot = 1e9; // firing ends spawn protection
  const shards = g.bullets.filter(b => b.kind === 'frag');
  ok(shards.length === TT.W.FRAG_PIECES && !t.weapon, 'second press bursts the bomb into shards');
  const v0 = shards.map(b => Math.hypot(b.vx, b.vy));
  for (let i = 0; i < 15; i++) TT.step(g, {}, DT);
  ok(shards.every((b, i) => b.stuck ? b.vx === 0 && b.vy === 0 : Math.abs(Math.hypot(b.vx, b.vy) - v0[i]) < 1e-9), 'shards fly at full speed (no slowing down) and stop dead in a wall');
  for (let i = 0; i < 400; i++) TT.step(g, {}, DT);
  ok(shards.every(b => b.stuck), 'every shard flies all the way to a wall');
  ok(shards.every(b => !g.bullets.includes(b)), 'stuck shards vanish shortly after');
  const o = g.tanks[2], s = { ...shards[0], age: 0, life: 9 }; g.bullets = [s]; o.prot = 0; o.x = s.x; o.y = s.y; TT.step(g, {}, DT);
  ok(o.alive, 'a stuck shard is harmless'); }

console.log('gatling');
{ const g = mk(), t = g.tanks[1]; g.tanks[2].prot = 1e9; TT.giveWeapon(t, 'gatling');
  const spin = Math.ceil(TT.W.GATLING_SPIN / DT);
  for (let i = 0; i < spin - 5; i++) TT.step(g, { 1: { f: true } }, DT);
  t.prot = 1e9; TT.step(g, {}, DT);
  ok(!t.weapon && g.bullets.length === 0, 'letting go during spin-up loses the gun without a shot');
  TT.giveWeapon(t, 'gatling'); g.bullets = [];
  for (let i = 0; i < spin + 20; i++) { TT.step(g, { 1: { f: true } }, DT); t.prot = 1e9; } // don't die to your own spray
  const gats = () => g.events.filter(e => e.type === 'gat').length, n = gats();
  ok(n > 0 && t.weapon === 'gatling', 'holding fire spins up and then sprays');
  for (let i = 0; i < 10; i++) TT.step(g, {}, DT);
  ok(!t.weapon && gats() === n, 'letting go stops firing and the rest of the belt is gone'); }

console.log('homing missile');
{ const g = mk(), t = g.tanks[1]; g.tanks[2].prot = 1e9; TT.giveWeapon(t, 'missile');
  TT.step(g, { 1: { f: true } }, DT); t.prot = 1e9;
  const m = g.bullets.find(b => b.kind === 'missile');
  ok(m && t.weapon === 'missile', 'missile launched, launcher stays until it is gone');
  TT.step(g, {}, DT); TT.step(g, { 1: { f: true } }, DT); TT.step(g, {}, DT); TT.step(g, { 1: { f: true } }, DT);
  ok(g.bullets.length === 1 && g.bullets[0] === m, 'cannot fire anything while the missile flies');
  g.bullets = []; TT.step(g, {}, DT);
  ok(!t.weapon, 'normal gun is back once the missile is gone'); }

console.log(fail ? `\n${fail} FAILED` : '\nall ok'); process.exit(fail ? 1 : 0);
