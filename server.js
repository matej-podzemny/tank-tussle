// Tank Tussle server: serves the static client and runs authoritative online rooms over WebSocket (/ws).
// Deploy anywhere that runs Node 18+ and supports WebSockets; listens on $PORT (default 8090).
const http = require('http'), fs = require('fs'), path = require('path'), crypto = require('crypto');
const { WebSocketServer } = require('ws');
const TT = require('./public/game.js');
const TTBots = require('./public/bots.js');

const PORT = +process.env.PORT || 8090;
const PUB = path.join(__dirname, 'public');
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css', '.png': 'image/png', '.svg': 'image/svg+xml', '.ico': 'image/x-icon', '.json': 'application/json', '.webmanifest': 'application/manifest+json' };
const TICK = 1 / 60, SEND_EVERY = 2;      // 60 Hz simulation, 30 Hz snapshots
const MAX_TANKS = 8, RECONNECT_GRACE_MS = 30000;
const LEVELS = ['easy', 'normal', 'hard'];

const server = http.createServer((req, res) => {
  const url = decodeURIComponent(req.url.split('?')[0]);
  res.setHeader('Access-Control-Allow-Origin', '*');
  if (url === '/health') { res.writeHead(200, { 'content-type': 'application/json' }); return res.end(JSON.stringify({ ok: true, rooms: rooms.size, uptime: Math.round(process.uptime()) })); }
  const file = path.normalize(path.join(PUB, url === '/' ? 'index.html' : url));
  if (!file.startsWith(PUB)) { res.writeHead(403); return res.end(); }
  fs.readFile(file, (err, data) => {
    if (err) { res.writeHead(404); return res.end('not found'); }
    res.writeHead(200, { 'content-type': TYPES[path.extname(file)] || 'application/octet-stream', 'cache-control': 'no-cache' });
    res.end(data);
  });
});

// WebSockets: any origin may connect (the static client can live on GitHub Pages)
const wss = new WebSocketServer({ server, path: '/ws', maxPayload: 16 * 1024 });
const rooms = new Map();
const keyRooms = new Map(); // Discord Activity instance id -> room code (everyone in the same voice-channel activity shares one room)
const ALPH = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
function newCode() { let c; do { c = Array.from({ length: 4 }, () => ALPH[crypto.randomInt(ALPH.length)]).join(''); } while (rooms.has(c)); return c; }
const send = (ws, m) => { if (ws && ws.readyState === 1) ws.send(typeof m === 'string' ? m : JSON.stringify(m)); };
function broadcast(room, m) { const s = JSON.stringify(m); for (const mb of room.members.values()) if (!mb.bot) send(mb.ws, s); }
const humans = room => [...room.members.values()].filter(m => !m.bot);
function freeColor(room) { const used = new Set([...room.members.values()].map(m => m.color)); let c = 0; while (used.has(c)) c++; return c; }

function lobbyMsg(room) {
  return { t: 'lobby', code: room.code, host: room.hostId, started: !!room.game, level: room.level, mode: room.mode, match: room.match, target: room.target, over: !!(room.game && room.game.phase === 'over'), teamScore: room.game ? room.game.teamScore : [0, 0],
    players: room.order.map(id => { const m = room.members.get(id); const p = room.game && room.game.players.find(p => p.id === id);
      return { id, name: m.name, color: m.color, team: m.team, score: p ? p.score : 0, bot: !!m.bot, online: m.bot || m.connected }; }) };
}
function mazeMsg(room) { const m = room.game.maze; return { t: 'maze', round: room.game.round, maze: { cols: m.cols, rows: m.rows, hw: m.hw, vw: m.vw } }; }

// Teams: newcomers join the smaller team (humans first in a tie-break so they spread out); the host can rebalance.
function smallerTeam(room) { const n = [0, 0]; for (const m of room.members.values()) n[m.team]++; return n[0] <= n[1] ? 0 : 1; }
function rebalance(room) { const list = room.order.map(id => room.members.get(id)), t = TT.balanceTeams(list); list.forEach((m, i) => (m.team = t[i])); }
function addMember(room, mb) {
  if (mb.team !== 0 && mb.team !== 1) mb.team = smallerTeam(room);
  room.members.set(mb.id, mb); room.order.push(mb.id);
  if (room.game) TT.addPlayer(room.game, { id: mb.id, name: mb.name, colorIndex: mb.color, team: mb.team }); // plays from the next round
}
function removeMember(room, id) {
  const mb = room.members.get(id); if (!mb) return;
  clearTimeout(mb.dropTimer);
  room.members.delete(id); room.order = room.order.filter(x => x !== id);
  if (room.game) TT.removePlayer(room.game, id);
  if (!humans(room).length) { stopGame(room); rooms.delete(room.code); if (room.key && keyRooms.get(room.key) === room.code) keyRooms.delete(room.key); return; }
  if (room.hostId === id) { const h = humans(room).find(h => h.connected) || humans(room)[0]; room.hostId = h.id; }
  broadcast(room, lobbyMsg(room));
}

function startGame(room) {
  stopGame(room);
  const g = room.game = TT.createGame(); TT.setMode(g, room.mode);
  TT.setMatch(g, room.match, { target: room.target });
  for (const id of room.order) { const m = room.members.get(id); TT.addPlayer(g, { id, name: m.name, colorIndex: m.color, team: m.team }); if (m.bot) m.brain = TTBots.newBrain(m.level); }
  TT.newRound(g); g.events.length = 0; debugArm(g);
  broadcast(room, lobbyMsg(room)); broadcast(room, mazeMsg(room));
  let tick = 0, round = g.round, phase = g.phase;
  room.loop = setInterval(() => {
    const inputs = {};
    for (const [id, m] of room.members) {
      if (m.bot) { if (!m.brain) m.brain = TTBots.newBrain(m.level); inputs[id] = TTBots.think(g, g.tanks[id], m.brain, TICK); }
      else inputs[id] = m.connected ? m.input : {};
    }
    TT.step(g, inputs, TICK);
    for (const m of room.members.values()) if (m.seq) m.ticks++;
    const ev = g.events.splice(0);
    for (const e of ev) { const br = TT.botReaction(e, id => { const x = room.members.get(id); return !!(x && x.bot); }); if (br) setTimeout(() => react(room, br.id, br.r), 500); }
    if (g.phase !== phase) { phase = g.phase; if (phase === 'over') broadcast(room, lobbyMsg(room)); } // deathmatch finished: final scores
    if (g.round !== round) { round = g.round; debugArm(g); broadcast(room, lobbyMsg(room)); broadcast(room, mazeMsg(room)); }
    if (++tick % SEND_EVERY === 0 || ev.some(e => e.type === 'die' || e.type === 'respawn' || e.type === 'over')) {
      const s = TT.snapshot(g); s.ev = ev.filter(e => e.type !== 'bounce' && e.type !== 'round');
      s.ak = [...room.members.values()].filter(m => m.seq).map(m => [m.id, m.seq, m.ticks]); // last input seq + ticks it has been applied (client prediction)
      broadcast(room, s);
    }
  }, 1000 * TICK);
}
// Test hook: TT_DEBUG_WEAPONS=1 hands every tank a weapon at round start (used by the online weapon test)
let debugN = 0;
function debugArm(g) { if (!process.env.TT_DEBUG_WEAPONS) return; for (const t of Object.values(g.tanks)) TT.giveWeapon(t, TT.WEAPONS[debugN++ % TT.WEAPONS.length]); }
// Emoji reactions: allowed list + per-player cooldown, then everyone in the room sees it (works while dead / in the lobby too)
function react(room, id, r) { if (!room.members.has(id)) return false; room.reactLast = room.reactLast || {}; if (!TT.tryReact(room.reactLast, id, r, Date.now() / 1000, TT.REACT_COOLDOWN - 0.3)) return false; broadcast(room, { t: 'react', id, r }); return true; }
function stopGame(room) { if (room.loop) clearInterval(room.loop); room.loop = null; room.game = null; }

let nextId = 1;
wss.on('connection', ws => {
  let room = null, me = null;
  ws.isAlive = true; ws.on('pong', () => (ws.isAlive = true));
  function attach(r, mb) {
    room = r; me = mb; mb.ws = ws; mb.connected = true; clearTimeout(mb.dropTimer);
    send(ws, { t: 'joined', code: r.code, you: mb.id, token: mb.token });
    broadcast(r, lobbyMsg(r));
    if (r.game) send(ws, mazeMsg(r));
  }
  function join(r, name) {
    if (r.members.size >= MAX_TANKS) return send(ws, { t: 'error', msg: `Room is full (max ${MAX_TANKS} tanks).` });
    const color = freeColor(r);
    const mb = { id: nextId++, name: String(name || '').trim().slice(0, 14) || TT.COLOR_NAMES[color], color, input: {}, token: crypto.randomBytes(12).toString('hex'), connected: true };
    addMember(r, mb);
    if (!r.hostId) r.hostId = mb.id;
    attach(r, mb);
  }
  const isHost = () => room && me && room.hostId === me.id;
  ws.on('message', raw => {
    let m; try { m = JSON.parse(raw); } catch { return; }
    if (m.t === 'input') { if (me) { const k = m.k || {}; me.input = { u: !!k.u, d: !!k.d, l: !!k.l, r: !!k.r, f: !!k.f }; if (m.s) { me.seq = m.s >>> 0; me.ticks = 0; } } return; }
    const newRoom = () => { const r = { code: newCode(), members: new Map(), order: [], hostId: null, game: null, loop: null, level: 'normal', mode: 'ffa', match: 'rounds', target: TT.DM.TARGET }; rooms.set(r.code, r); return r; };
    if (m.t === 'create' && !room) join(newRoom(), m.name);
    else if (m.t === 'joinOrCreate' && !room) { // Discord Activity: the room belongs to the activity instance (voice channel)
      const key = String(m.key || '').slice(0, 64); if (!key) return send(ws, { t: 'error', msg: 'Missing activity id.' });
      let r = rooms.get(keyRooms.get(key));
      if (!r) { r = newRoom(); r.key = key; keyRooms.set(key, r.code); }
      join(r, m.name);
    }
    else if (m.t === 'join' && !room) { const r = rooms.get(String(m.code || '').toUpperCase().trim()); if (!r) return send(ws, { t: 'error', msg: 'Room not found.' }); join(r, m.name); }
    else if (m.t === 'rejoin' && !room) {
      const r = rooms.get(String(m.code || '').toUpperCase().trim()), mb = r && [...r.members.values()].find(x => !x.bot && x.token === m.token);
      if (!mb) return send(ws, { t: 'error', msg: 'Could not rejoin — the room has ended.' });
      if (mb.ws && mb.ws !== ws) try { mb.ws.close(); } catch {}
      attach(r, mb);
    }
    else if (m.t === 'start' && isHost()) { if (room.members.size >= 1) startGame(room); }
    else if (m.t === 'stop' && isHost()) { stopGame(room); broadcast(room, lobbyMsg(room)); }
    else if (m.t === 'addBot' && isHost()) {
      if (room.members.size >= MAX_TANKS) return send(ws, { t: 'error', msg: `Max ${MAX_TANKS} tanks.`, soft: true });
      const level = LEVELS.includes(m.level) ? m.level : room.level, color = freeColor(room), n = [...room.members.values()].filter(x => x.bot).length + 1;
      addMember(room, { id: nextId++, name: `Bot ${n}`, color, bot: true, level, brain: TTBots.newBrain(level) });
      broadcast(room, lobbyMsg(room));
    }
    else if (m.t === 'removeBot' && isHost()) { const bots = room.order.filter(id => room.members.get(id).bot); if (bots.length) removeMember(room, bots[bots.length - 1]); }
    else if (m.t === 'setLevel' && isHost() && LEVELS.includes(m.level)) {
      room.level = m.level; for (const x of room.members.values()) if (x.bot) { x.level = m.level; x.brain = TTBots.newBrain(m.level); }
      broadcast(room, lobbyMsg(room));
    }
    else if (m.t === 'setMode' && isHost() && !room.game && (m.mode === 'ffa' || m.mode === 'teams')) {
      if (m.mode === 'teams' && room.mode !== 'teams') rebalance(room);
      room.mode = m.mode; broadcast(room, lobbyMsg(room));
    }
    else if (m.t === 'setMatch' && isHost() && !room.game && (m.match === 'rounds' || m.match === 'dm')) { // Rounds / Deathmatch + kill target
      room.match = m.match; if (TT.DM.TARGETS.includes(+m.target)) room.target = +m.target;
      broadcast(room, lobbyMsg(room));
    }
    else if (m.t === 'setTeam' && room && !room.game) { // anyone can switch themselves; the host can move anyone (e.g. bots)
      const id = m.id == null ? me.id : m.id >>> 0, x = room.members.get(id);
      if (x && (id === me.id || isHost())) { x.team = m.team === 0 || m.team === 1 ? m.team : 1 - x.team; broadcast(room, lobbyMsg(room)); }
    }
    else if (m.t === 'leave' && room) { const r = room, id = me.id; room = null; me = null; removeMember(r, id); }
    else if (m.t === 'react' && room && me) react(room, me.id, m.r);
    else if (m.t === 'debugKill' && process.env.TT_DEBUG_DM && room && room.game) { const t = room.game.tanks[m.id >>> 0]; if (t) TT.kill(room.game, t, m.by >>> 0, 'b'); } // test hooks only
    else if (m.t === 'debugClock' && process.env.TT_DEBUG_DM && room && room.game) room.game.dmLeft = +m.left || 0;
    else if (m.t === 'ping') send(ws, { t: 'pong', c: m.c });
  });
  ws.on('close', () => {
    if (!room || !me || me.ws !== ws) return;
    const r = room, mb = me;
    mb.connected = false; mb.input = {}; mb.ws = null;
    broadcast(r, lobbyMsg(r));
    mb.dropTimer = setTimeout(() => removeMember(r, mb.id), RECONNECT_GRACE_MS); // keep the slot for a reconnect
  });
});
setInterval(() => { for (const ws of wss.clients) { if (!ws.isAlive) { ws.terminate(); continue; } ws.isAlive = false; ws.ping(); } }, 20000);

server.listen(PORT, () => console.log(`Tank Tussle server on http://localhost:${PORT} (WebSocket path /ws)`));
