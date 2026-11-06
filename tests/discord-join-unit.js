// Discord Activity joinOrCreate (pure Node + ws): same key shares a room, different keys get
// different rooms, empty key errors, key capped at 64, empty room cleans keyRooms, room-full
// refuses a 9th player, and Deathmatch / Teams / reactions still work through the same path.
const { spawn } = require('child_process');
const WebSocket = require('ws');
const PORT = +(process.env.PORT || 8099);
const URL = `ws://127.0.0.1:${PORT}/ws`;
let fail = 0;
const ok = (c, m) => { console.log((c ? '  ok   ' : '  FAIL ') + m); if (!c) fail++; };
const sleep = ms => new Promise(r => setTimeout(r, ms));

function waitMsg(ws, pred, ms = 5000) {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => { cleanup(); reject(new Error('timeout waiting for ' + pred)); }, ms);
    const on = raw => {
      let m; try { m = JSON.parse(raw); } catch { return; }
      if (pred(m)) { cleanup(); resolve(m); }
    };
    const cleanup = () => { clearTimeout(t); ws.off('message', on); };
    ws.on('message', on);
  });
}
function connect() {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(URL);
    ws.once('open', () => resolve(ws));
    ws.once('error', reject);
  });
}
async function joinOrCreate(ws, name, key) {
  const p = waitMsg(ws, m => m.t === 'joined' || m.t === 'error');
  ws.send(JSON.stringify({ t: 'joinOrCreate', name, key }));
  return p;
}

(async () => {
  const child = spawn('node', ['server.js'], { cwd: __dirname + '/..', env: { ...process.env, PORT: String(PORT) }, stdio: ['ignore', 'pipe', 'pipe'] });
  let booted = false;
  child.stdout.on('data', d => { if (String(d).includes('listening') || String(d).includes(String(PORT))) booted = true; });
  child.stderr.on('data', d => process.stderr.write(d));
  // wait for /health
  for (let i = 0; i < 50 && !booted; i++) {
    try {
      const r = await fetch(`http://127.0.0.1:${PORT}/health`);
      if (r.ok) { booted = true; break; }
    } catch {}
    await sleep(100);
  }
  ok(booted, `server up on ${PORT}`);
  if (!booted) { child.kill(); process.exit(1); }

  console.log('joinOrCreate');
  {
    const a = await connect(), b = await connect();
    const ja = await joinOrCreate(a, 'A', 'inst-same');
    const jb = await joinOrCreate(b, 'B', 'inst-same');
    ok(ja.t === 'joined' && jb.t === 'joined' && ja.code === jb.code, `same key -> same room (${ja.code})`);
    const lobby = await waitMsg(a, m => m.t === 'lobby' && m.players.length === 2);
    ok(lobby.players.map(p => p.name).sort().join() === 'A,B', 'both in lobby');
    a.close(); b.close();
    await sleep(50);
  }
  {
    const a = await connect(), b = await connect();
    const ja = await joinOrCreate(a, 'C', 'key-one');
    const jb = await joinOrCreate(b, 'D', 'key-two');
    ok(ja.t === 'joined' && jb.t === 'joined' && ja.code !== jb.code, `different keys -> different rooms (${ja.code} vs ${jb.code})`);
    a.close(); b.close();
  }
  {
    const a = await connect();
    const j = await joinOrCreate(a, 'E', '');
    ok(j.t === 'error' && /Missing activity id/i.test(j.msg), 'empty key -> error: ' + (j.msg || ''));
    a.close();
  }
  {
    const a = await connect();
    const long = 'x'.repeat(80);
    const j = await joinOrCreate(a, 'F', long);
    ok(j.t === 'joined', 'key longer than 64 is accepted (truncated)');
    // a second client with the truncated key must land in the same room
    const b = await connect();
    const jb = await joinOrCreate(b, 'G', long.slice(0, 64));
    ok(jb.t === 'joined' && jb.code === j.code, '64-char truncation matches');
    a.close(); b.close();
  }
  {
    // cleanup: leave until empty, then same key creates a fresh room
    const a = await connect();
    const ja = await joinOrCreate(a, 'H', 'cleanup-key');
    const code1 = ja.code;
    a.send(JSON.stringify({ t: 'leave' }));
    await sleep(200);
    const b = await connect();
    const jb = await joinOrCreate(b, 'I', 'cleanup-key');
    ok(jb.t === 'joined' && jb.code !== code1, `empty room cleaned; same key gets a new code (${code1} -> ${jb.code})`);
    b.close();
  }
  {
    // room full: fill to 8, 9th gets error
    const sockets = [];
    let code = null;
    for (let i = 0; i < 8; i++) {
      const ws = await connect();
      const j = await joinOrCreate(ws, 'P' + i, 'full-room');
      ok(j.t === 'joined', `seat ${i + 1}/8 joined`);
      code = j.code; sockets.push(ws);
    }
    const ninth = await connect();
    const j9 = await joinOrCreate(ninth, 'P8', 'full-room');
    ok(j9.t === 'error' && /full/i.test(j9.msg), '9th player: room full — ' + (j9.msg || ''));
    // server still healthy
    const health = await (await fetch(`http://127.0.0.1:${PORT}/health`)).json();
    ok(health.ok, 'server still healthy after full-room refuse');
    ninth.close();
    for (const ws of sockets) ws.close();
    await sleep(100);
  }
  {
    // Deathmatch + Teams + reaction through a joinOrCreate room
    const host = await connect(), guest = await connect();
    const hostLobby2 = waitMsg(host, m => m.t === 'lobby' && m.players.length === 2);
    await joinOrCreate(host, 'Host', 'modes-key');
    await joinOrCreate(guest, 'Guest', 'modes-key');
    await hostLobby2;
    const modeP = waitMsg(host, m => m.t === 'lobby' && m.mode === 'teams');
    host.send(JSON.stringify({ t: 'setMode', mode: 'teams' }));
    let lobby = await modeP;
    ok(lobby.mode === 'teams', 'Teams via joinOrCreate room');
    const dmP = waitMsg(host, m => m.t === 'lobby' && m.match === 'dm');
    host.send(JSON.stringify({ t: 'setMatch', match: 'dm', target: 10 }));
    lobby = await dmP;
    ok(lobby.match === 'dm' && lobby.target === 10, 'Deathmatch target 10 via joinOrCreate room');
    const reactP = waitMsg(guest, m => m.t === 'react');
    host.send(JSON.stringify({ t: 'react', r: 0 }));
    const react = await reactP;
    ok(react.t === 'react' && react.r === 0, 'reaction broadcasts in joinOrCreate room');
    host.close(); guest.close();
  }

  // normal create/join still works (web path unchanged)
  {
    const a = await connect(), b = await connect();
    const p = waitMsg(a, m => m.t === 'joined');
    a.send(JSON.stringify({ t: 'create', name: 'Web' }));
    const ja = await p;
    ok(ja.t === 'joined' && ja.code && ja.code.length === 4, 'normal create still works: ' + ja.code);
    const p2 = waitMsg(b, m => m.t === 'joined' || m.t === 'error');
    b.send(JSON.stringify({ t: 'join', name: 'Web2', code: ja.code }));
    const jb = await p2;
    ok(jb.t === 'joined' && jb.code === ja.code, 'normal join still works');
    a.close(); b.close();
  }

  child.kill('SIGTERM');
  await sleep(200);
  try { child.kill('SIGKILL'); } catch {}
  console.log(fail ? `${fail} FAILED` : 'discord-join-unit: all passed');
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error('FAIL', e); process.exit(1); });
