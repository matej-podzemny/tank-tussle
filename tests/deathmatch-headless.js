// Deathmatch in the browser: start-screen picker (fits phones, no scroll), local phone game (respawn countdown,
// HUD timer + kills, blinking spawn protection, end screen + play again), two players sharing a phone, and online:
// host picks Deathmatch in the lobby, the server runs respawns / scores / match end. BASE = temp server started with
//   TT_DEBUG_DM=1 PORT=8098 node server.js     (debug hooks: kill a tank the normal way, set the clock)
// Screenshots go to OUT (default /workspace/deathmatch-shots/, outside the repo).
const puppeteer = require('puppeteer-core');
const FILE = 'file:///workspace/tank-trouble/tank-tussle.html', BASE = process.env.BASE || 'http://localhost:8098', OUT = process.env.OUT || '/workspace/deathmatch-shots/';
const sleep = ms => new Promise(r => setTimeout(r, ms));
let fail = 0; const ok = (c, m) => { console.log((c ? '  ok   ' : '  FAIL ') + m); if (!c) fail++; };
const PHONE = { width: 390, height: 844, isMobile: true, hasTouch: true, deviceScaleFactor: 2 };
const SMALL = { width: 360, height: 640, isMobile: true, hasTouch: true, deviceScaleFactor: 2 };
const LAND = { width: 844, height: 390, isMobile: true, hasTouch: true, isLandscape: true, deviceScaleFactor: 2 };
const tapEl = async (p, sel) => { const r = await p.$eval(sel, e => { const b = e.getBoundingClientRect(); return [b.x + b.width / 2, b.y + b.height / 2]; }); await p.touchscreen.tap(r[0], r[1]); };
const noScroll = p => p.evaluate(() => document.scrollingElement.scrollHeight <= innerHeight + 1 && document.scrollingElement.scrollWidth <= innerWidth + 1);
const fits = (p, sel) => p.evaluate(sel => { const b = document.querySelector(sel).getBoundingClientRect(); return b.top >= -1 && b.left >= -1 && b.bottom <= innerHeight + 1 && b.right <= innerWidth + 1; }, sel);
const shot = async (p, name) => { await p.screenshot({ path: OUT + name }); console.log('  screenshot ' + OUT + name); };
// local: put a bullet from `by` right on top of tank `id` (the real kill path, protection off)
const localKill = (p, id, by) => p.evaluate((id, by) => { const g = __tt.game, t = g.tanks[id]; t.prot = 0; g.bullets.push({ id: g.nextId++, owner: by, kind: 'b', r: 3.2, x: t.x, y: t.y, vx: 0.01, vy: 0, age: 1, a: 0 }); }, id, by);
// Online part needs a server with TT_DEBUG_DM=1 (debugKill/debugClock); without it the time-limit step hangs.
// If BASE isn't given, start our own debug server on 8098 so the test can't silently run against a non-debug one.
let child = null;
async function ensureServer() {
  if (process.env.BASE) return;
  try { await fetch(BASE + '/health'); console.log('(using existing server at ' + BASE + ' - must run with TT_DEBUG_DM=1)'); return; } catch {}
  child = require('child_process').spawn('node', [__dirname + '/../server.js'], { env: { ...process.env, TT_DEBUG_DM: '1', PORT: '8098' }, stdio: 'ignore' });
  for (let i = 0; i < 50; i++) { try { await fetch(BASE + '/health'); return; } catch { await new Promise(r => setTimeout(r, 100)); } }
  throw new Error('debug server did not start on 8098');
}
process.on('exit', () => child && child.kill());
(async () => {
  await ensureServer();
  const B = await puppeteer.launch({ executablePath: '/usr/bin/google-chrome', headless: 'new', args: ['--no-sandbox'] });
  const errs = [];
  for (const [vp, tag] of [[PHONE, 'portrait'], [SMALL, 'small'], [LAND, 'landscape']]) { console.log('menu ' + tag);
    const p = await B.newPage(); await p.setViewport(vp); p.on('pageerror', e => errs.push(e.message));
    await p.goto(FILE, { waitUntil: 'load' }); await p.evaluate(() => localStorage.clear()); await p.reload({ waitUntil: 'load' });
    ok(await p.$eval('#targetSel', e => e.classList.contains('hidden')), 'kill target hidden in Rounds');
    await tapEl(p, '#matchSel button[data-g="dm"]'); await sleep(150);
    ok(await p.$eval('#targetSel', e => !e.classList.contains('hidden')) && await p.$eval('#targetSel button.sel', e => e.dataset.k) === '15', 'Deathmatch shows the kill target (15 default)');
    await tapEl(p, '#modeSel button[data-m="teams"]'); await sleep(150);
    ok(await noScroll(p) && await fits(p, '#menu .panel'), 'menu with Deathmatch + Teams fits, no scroll');
    const oneLine = await p.$$eval('#matchSel > button', bs => new Set(bs.map(b => Math.round(b.getBoundingClientRect().top))).size === 1); ok(oneLine, 'Rounds / Deathmatch on one line');
    if (tag === 'portrait') await shot(p, 'dm-menu-phone.png');
    await p.close(); }
  { console.log('local phone deathmatch');
    const p = await B.newPage(); await p.setViewport(PHONE); p.on('pageerror', e => errs.push(e.message));
    await p.goto(FILE, { waitUntil: 'load' });
    await tapEl(p, '#modeSel button[data-m="ffa"]'); await tapEl(p, '#matchSel button[data-g="dm"]'); await tapEl(p, '#targetSel button[data-k="10"]');
    await tapEl(p, '#nSel button[data-n="1"]'); while (await p.$eval('#botN', e => +e.textContent) < 3) await tapEl(p, '#botPlus');
    await p.reload({ waitUntil: 'load' }); ok(await p.$eval('#matchSel button.sel', e => e.dataset.g) === 'dm' && await p.$eval('#targetSel button.sel', e => e.dataset.k) === '10', 'choice remembered after reload');
    await tapEl(p, '#nSel button[data-n="1"]'); while (await p.$eval('#botN', e => +e.textContent) < 3) await tapEl(p, '#botPlus');
    await tapEl(p, '#playLocal'); await sleep(300);
    const st = await p.evaluate(() => ({ m: __tt.game.match, k: __tt.game.dmTarget, left: __tt.game.dmLeft, prot: __tt.game.tanks[1].prot }));
    ok(st.m === 'dm' && st.k === 10 && st.left > 295, 'local game is Deathmatch to 10, 5:00 clock');
    ok(st.prot > 0, 'spawn protection at the start');
    await sleep(1600); await p.evaluate(() => { const g = __tt.game; g.crates = []; g.crateTimer = 1e9; TT.giveWeapon(g.tanks[1], 'laser'); }); await localKill(p, 1, 2); await sleep(700);
    const d = await p.evaluate(() => ({ alive: __tt.game.tanks[1].alive, rs: __tt.game.tanks[1].respawn, sc: __tt.game.players[1].score, round: __tt.game.round }));
    ok(!d.alive && d.rs > 1.8 && d.rs < 2.6, 'P1 dead, countdown running: ' + d.rs.toFixed(2)); ok(d.sc >= 1, 'bot that shot P1 got a kill');
    await shot(p, 'dm-respawn-countdown-phone.png');
    await sleep(2500);
    const r = await p.evaluate(() => ({ alive: __tt.game.tanks[1].alive, w: __tt.game.tanks[1].weapon, round: __tt.game.round }));
    ok(r.alive && !r.w && r.round === d.round, 'P1 (had a laser) back after 3 s with the default cannon, same round');
    await sleep(400); await shot(p, 'dm-spawn-protection-phone.png');
    await p.evaluate(() => { const g = __tt.game; g.players.forEach((p, i) => (p.score = [7, 4, 6, 2][i])); g.dmLeft = 83; });
    await sleep(400); await shot(p, 'dm-hud-phone.png');
    await p.evaluate(() => { __tt.game.players[0].score = 9; }); await localKill(p, await p.evaluate(() => Object.values(__tt.game.tanks).find(t => t.id !== 1 && t.alive).id), 1); await sleep(400);
    ok(await p.$eval('#over', e => !e.classList.contains('hidden')), 'P1 hits 10 kills -> end screen');
    const o = await p.evaluate(() => ({ t: document.getElementById('overTitle').textContent, s: document.getElementById('overSub').textContent, n: document.querySelectorAll('#overList li').length, w: __tt.game.winner }));
    ok(/P1 wins/.test(o.t) && /10 kills/.test(o.s) && o.n === 4, `end screen: "${o.t}" · ${o.s} · ${o.n} rows`);
    ok(await noScroll(p) && await fits(p, '#over .panel'), 'end screen fits the phone, no scroll');
    await shot(p, 'dm-end-screen-phone.png');
    await tapEl(p, '#again'); await sleep(300);
    const ag = await p.evaluate(() => ({ over: !document.getElementById('over').classList.contains('hidden'), ph: __tt.game.phase, sc: __tt.game.players.map(p => p.score).join(''), m: __tt.game.match }));
    ok(!ag.over && ag.ph === 'play' && ag.sc === '0000' && ag.m === 'dm', 'Play again: fresh Deathmatch, scores 0');
    await p.evaluate(() => { __tt.game.dmLeft = 0.3; }); await sleep(600);
    ok(/Time's up/.test(await p.$eval('#overSub', e => e.textContent)), 'time limit ends the match ("Time\'s up")');
    await tapEl(p, '#overQuit'); await sleep(200); ok(await p.$eval('#menu', e => !e.classList.contains('hidden')), 'Quit to title');
    await p.close(); }
  { console.log('two on one phone + teams');
    const p = await B.newPage(); await p.setViewport(LAND); p.on('pageerror', e => errs.push(e.message));
    await p.goto(FILE, { waitUntil: 'load' }); await tapEl(p, '#matchSel button[data-g="dm"]'); await tapEl(p, '#modeSel button[data-m="teams"]');
    await tapEl(p, '#nSel button[data-n="2"]'); while (await p.$eval('#botN', e => +e.textContent) < 2) await tapEl(p, '#botPlus');
    await tapEl(p, '#playLocal'); await sleep(1700);
    const tm = await p.evaluate(() => __tt.game.players.map(p => p.team).join('')); ok(__tt => true, 'teams ' + tm);
    const foe = await p.evaluate(() => __tt.game.players.find(p => p.team !== __tt.game.players[0].team && p.bot).id);
    await localKill(p, 1, foe); await localKill(p, 2, 1); await sleep(800);
    const s = await p.evaluate(() => ({ a: __tt.game.tanks[1].alive, b: __tt.game.tanks[2].alive, ts: __tt.game.teamScore.slice(), t1: __tt.game.players[0].team, t2: __tt.game.players[1].team }));
    ok(!s.a && !s.b, 'both local players dead, both counting down');
    await shot(p, 'dm-two-players-countdown-landscape.png');
    await sleep(2600); ok(await p.evaluate(() => __tt.game.tanks[1].alive && __tt.game.tanks[2].alive), 'both respawned');
    ok(await noScroll(p), 'no scroll in game');
    await p.close(); }
  { console.log('online deathmatch');
    const B2 = await puppeteer.launch({ executablePath: '/usr/bin/google-chrome', headless: 'new', args: ['--no-sandbox'] }); const H = await B.newPage(), G = await B2.newPage(); await H.setViewport(PHONE); await G.setViewport(PHONE);
    H.on('pageerror', e => errs.push('host: ' + e.message)); G.on('pageerror', e => errs.push('guest: ' + e.message));
    await H.goto(BASE, { waitUntil: 'load' }); await tapEl(H, '.tabs button[data-tab="online"]'); await H.$eval('#name', e => (e.value = '')); await H.type('#name', 'Matej'); await tapEl(H, '#create');
    await H.waitForFunction(() => __tt.net && __tt.net.code); const link = await H.$eval('#link', e => e.value);
    await G.goto(link, { waitUntil: 'load' }); await tapEl(G, '.tabs button[data-tab="online"]'); await G.$eval('#name', e => (e.value = '')); await G.type('#name', 'Peter'); await tapEl(G, '#join');
    await H.waitForFunction(() => __tt.net.players.length === 2);
    ok(await G.$eval('#matchRow button[data-g="dm"]', b => b.disabled), 'guest cannot pick the game type');
    await G.evaluate(() => __tt.net.send({ t: 'setMatch', match: 'dm', target: 10 })); await sleep(300);
    ok(await H.evaluate(() => __tt.net.match) === 'rounds', 'server ignores a guest setMatch');
    await tapEl(H, '#matchRow button[data-g="dm"]'); await G.waitForFunction(() => __tt.net.match === 'dm'); await H.waitForFunction(() => !document.getElementById('targetBtn').classList.contains('hidden'));
    ok(await G.$eval('#targetBtn', e => !e.classList.contains('hidden') && e.disabled && e.textContent === '15 kills'), 'guest sees Deathmatch + "15 kills" (read-only)');
    await tapEl(H, '#targetBtn'); await G.waitForFunction(() => __tt.net.target === 25); await H.waitForFunction(() => __tt.net.target === 25);
    await tapEl(H, '#targetBtn'); await G.waitForFunction(() => __tt.net.target === 10);
    ok(await G.$eval('#targetBtn', e => e.textContent) === '10 kills', 'host taps the target: 15 -> 25 -> 10 kills');
    await tapEl(H, '#lbPlus'); await sleep(200);
    ok(await noScroll(H) && await fits(H, '#lobby .panel'), 'phone lobby with the Deathmatch rows fits');
    await shot(H, 'dm-lobby-phone.png');
    await tapEl(H, '#start'); await G.waitForFunction(() => __tt.net.snaps.length > 5 && __tt.net.dm, { timeout: 8000 });
    const ids = await H.evaluate(() => [__tt.net.you, __tt.net.players.find(p => !p.you && p.id !== __tt.net.you && !p.bot).id]); const [hid, gid] = ids;
    ok(await G.evaluate(() => __tt.net.dm.target === 10 && __tt.net.dm.left > 10), 'snapshots carry the Deathmatch clock + target');
    await sleep(1600); // past spawn protection
    await H.evaluate((gid, hid) => __tt.net.send({ t: 'debugKill', id: gid, by: hid }), gid, hid); await sleep(600);
    const g1 = await G.evaluate(gid => { const s = __tt.net.snaps[__tt.net.snaps.length - 1].tanks.get(gid); return { alive: s.alive, rs: s.respawn }; }, gid);
    ok(!g1.alive && g1.rs > 1.8 && g1.rs <= 3, 'guest dead, server countdown ' + g1.rs);
    ok(await G.evaluate(hid => __tt.net.players.find(p => p.id === hid).score, hid) === 1, 'host +1 kill (server score)');
    await shot(G, 'dm-online-countdown-phone.png');
    await sleep(2800);
    const g2 = await G.evaluate(gid => { const s = __tt.net.snaps[__tt.net.snaps.length - 1].tanks.get(gid); return { alive: s.alive, prot: s.prot }; }, gid);
    ok(g2.alive && g2.prot, 'server respawned the guest with spawn protection');
    await H.evaluate(gid => __tt.net.send({ t: 'debugKill', id: gid, by: gid }), gid); await sleep(400);
    ok(await H.evaluate(gid => __tt.net.players.find(p => p.id === gid).score, gid) === 0, 'self-kill blocked by spawn protection (still 0)');
    await H.waitForFunction(gid => { const t = __tt.net.snaps[__tt.net.snaps.length - 1].tanks.get(gid); return t && t.alive && !t.prot; }, { timeout: 10000 }, gid); // (a bot may have shot the guest meanwhile)
    await H.evaluate(gid => __tt.net.send({ t: 'debugKill', id: gid, by: gid }), gid); await sleep(400);
    ok(await H.evaluate(gid => __tt.net.players.find(p => p.id === gid).score, gid) === -1, 'self-kill = -1 on the server');
    // time limit: wind the server clock to 2 s and wait for the end
    await H.evaluate(() => __tt.net.send({ t: 'debugClock', left: 2 }));
    await G.waitForFunction(() => !document.getElementById('over').classList.contains('hidden'), { timeout: 20000 }).catch(e => { throw new Error('match did not end after debugClock - is the server running with TT_DEBUG_DM=1? ' + e.message); });
    const ov = await G.evaluate(() => ({ t: document.getElementById('overTitle').textContent, s: document.getElementById('overSub').textContent, wait: !document.getElementById('overWait').classList.contains('hidden'), again: !document.getElementById('again').parentElement.classList.contains('hidden') }));
    // bots play too, so the leader isn't fixed: the title must match the server's final scores
    const sc = await G.evaluate(() => __tt.net.players.map(p => [p.name, p.score, p.you]));
    const top = Math.max(...sc.map(x => x[1])), lead = sc.filter(x => x[1] === top), want = lead.length > 1 ? /draw/ : new RegExp(lead[0][0] + ' wins');
    ok(want.test(ov.t) && /Time/.test(ov.s), `guest end screen: "${ov.t}" · ${ov.s} (scores ${sc.map(x => x[0] + ' ' + x[1]).join(', ')})`); ok(ov.wait && !ov.again, 'guest waits for the host (no Play again)');
    const hw = lead.length === 1 && lead[0][0] === 'Matej' ? /You win/ : want;
    ok(await H.evaluate(re => new RegExp(re).test(document.getElementById('overTitle').textContent) && !document.getElementById('again').parentElement.classList.contains('hidden'), hw.source), 'host: matching title + Play again');
    await shot(G, 'dm-online-end-guest-phone.png');
    // play again, then win by kill target
    await tapEl(H, '#again'); await G.waitForFunction(() => document.getElementById('over').classList.contains('hidden') && __tt.net.snaps.length > 3, { timeout: 8000 });
    ok(await G.evaluate(() => __tt.net.players.every(p => p.score === 0)), 'Play again: new match, scores reset');
    await sleep(1600);
    // kill whichever other tank is alive and unprotected (guest + bot), as the host, until 10 kills
    for (let i = 0; i < 80 && !(await G.evaluate(() => __tt.net.phase === 'over')); i++) {
      await H.evaluate(hid => { const s = __tt.net.snaps[__tt.net.snaps.length - 1]; const v = [...s.tanks.values()].find(t => t.id !== hid && t.alive && !t.prot); if (v) __tt.net.send({ t: 'debugKill', id: v.id, by: hid }); }, hid); await sleep(500); }
    await G.waitForFunction(() => !document.getElementById('over').classList.contains('hidden'), { timeout: 10000 }).catch(() => {});
    ok(await G.evaluate(() => /10 kills/.test(document.getElementById('overSub').textContent)), 'first to 10 kills ends the online match');
    await tapEl(H, '#overLobby'); await G.waitForFunction(() => !document.getElementById('lobby').classList.contains('hidden') && document.getElementById('over').classList.contains('hidden'), { timeout: 5000 });
    ok(true, 'host: Back to lobby -> everyone in the lobby'); ok(await G.evaluate(() => __tt.net.match === 'dm'), 'lobby keeps Deathmatch selected');
    await H.close(); await B2.close(); }
  ok(!errs.length, 'no page errors' + (errs.length ? ': ' + errs.join(' | ') : ''));
  await B.close(); console.log(fail ? `${fail} FAILED` : 'all passed'); process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
