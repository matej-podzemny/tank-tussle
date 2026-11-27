// Shots-fired counter: each player tracks how many times they actually shot (cannon + weapons),
// kept across rounds of the same game. (The HUD only shows your own count; that's in the client / server send path.)
const TT = require('../public/game.js');
let fail = 0; const ok = (c, m) => { console.log((c ? '  ok   ' : '  FAIL ') + m); if (!c) fail++; };
const DT = 1 / 60;
function mk() {
  const g = TT.createGame(); TT.addPlayer(g, { id: 1 }); TT.addPlayer(g, { id: 2 }); TT.newRound(g); return g;
}
{ const g = mk(); ok(g.players.every(p => p.shots === 0), 'starts at 0');
  for (let i = 0; i < 6; i++) TT.step(g, { 1: { f: i % 2 === 0 } }, DT);
  ok(g.players[0].shots === 3 && g.players[1].shots === 0, 'each press counts one shot for that player only');
  TT.giveWeapon(g.tanks[2], 'laser'); TT.step(g, { 2: { f: true } }, DT); ok(g.players[1].shots === 1, 'weapons count too');
  TT.newRound(g); ok(g.players[0].shots === 3, 'kept across rounds (per game)');
  const snap = TT.snapshot(g); ok(!JSON.stringify(snap).includes('"shots"') && snap.sc.every(r => r.length === 3), 'shared snapshot does not include shot counts'); }
console.log(fail ? `\n${fail} FAILED` : '\nall ok'); process.exit(fail ? 1 : 0);
