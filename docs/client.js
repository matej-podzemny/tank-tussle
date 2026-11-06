'use strict';
(() => {
const { C, COLORS } = TT;
const $ = id => document.getElementById(id);
const cv = $('c'), ctx = cv.getContext('2d');
const isTouch = matchMedia('(pointer: coarse)').matches || 'ontouchstart' in window;

// ---------- key sets ----------
const LOCAL = [
  { name: 'Red',    keys: { u: 'KeyE', l: 'KeyS', d: 'KeyD', r: 'KeyF', f: 'KeyQ' }, label: ['E', 'S', 'D', 'F', 'Q'] },
  { name: 'Green',  keys: { u: 'ArrowUp', l: 'ArrowLeft', d: 'ArrowDown', r: 'ArrowRight', f: ['KeyM', 'Slash'] }, label: ['↑', '←', '↓', '→', 'M'] },
  { name: 'Blue',   keys: { u: 'KeyI', l: 'KeyJ', d: 'KeyK', r: 'KeyL', f: 'KeyU' }, label: ['I', 'J', 'K', 'L', 'U'] },
  { name: 'Yellow', keys: { u: 'Numpad8', l: 'Numpad4', d: 'Numpad5', r: 'Numpad6', f: 'Numpad0' }, label: ['Num8', 'Num4', 'Num5', 'Num6', 'Num0'] },
];
const ONLINE_KEYS = { u: ['ArrowUp', 'KeyW'], l: ['ArrowLeft', 'KeyA'], d: ['ArrowDown', 'KeyS'], r: ['ArrowRight', 'KeyD'], f: ['Space', 'KeyM', 'Enter'] };
// Emoji reactions (TT.REACTIONS order: 😂 😡 😭 😎 💀 👍). One row of 6 keys per local player; online = P1's (1-6).
const REACT_KEYS = [
  ['Digit1', 'Digit2', 'Digit3', 'Digit4', 'Digit5', 'Digit6'],
  ['Digit7', 'Digit8', 'Digit9', 'Digit0', 'Minus', 'Equal'],
  ['KeyZ', 'KeyX', 'KeyC', 'KeyV', 'KeyB', 'KeyN'],
  ['Numpad7', 'Numpad9', 'Numpad1', 'Numpad2', 'Numpad3', 'NumpadDecimal'],
];
const REACT_LABELS = ['1–6', '7 8 9 0 - =', 'Z X C V B N', 'Num 7 9 1 2 3 .'];
const SOLO = { name: 'Red', keys: ONLINE_KEYS, label: ['↑', '←', '↓', '→', 'Space'] };
const keySets = n => n === 1 ? [SOLO] : LOCAL;
const GAME_CODES = new Set([...LOCAL.map(s => Object.values(s.keys)), ...Object.values(ONLINE_KEYS)].flat(2));

const down = new Set(), tapped = new Set();
addEventListener('keydown', e => {
  if (e.code === 'Escape') { if (mode) togglePause(); return; }
  if (!mode || inOverlay()) return;
  if (reactKey(e.code)) { e.preventDefault(); if (!e.repeat) audioInit(); return; }
  if (GAME_CODES.has(e.code)) e.preventDefault();
  down.add(e.code); tapped.add(e.code); audioInit();
  if (mode === 'online' && net) onlineInput();
});
addEventListener('keyup', e => { down.delete(e.code); if (mode === 'online' && net) onlineInput(); });
addEventListener('blur', () => down.clear());
const pressed = c => Array.isArray(c) ? c.some(x => down.has(x) || tapped.has(x)) : (down.has(c) || tapped.has(c));
const readKeys = ks => ({ u: pressed(ks.u), d: pressed(ks.d), l: pressed(ks.l), r: pressed(ks.r), f: pressed(ks.f) });
const merge = (a, b) => ({ u: a.u || b.u, d: a.d || b.d, l: a.l || b.l, r: a.r || b.r, f: a.f || b.f });

// ---------- menu ----------
let nLocal = isTouch ? 1 : 2, nBots = isTouch ? 1 : 0, botLevel = 'normal';
let localMode = 'ffa', localTeams = [], teamsFor = '';  // Teams: localTeams[i] = 0 Red / 1 Blue for tank i (humans then bots)
const TEAM_COLORS = TT.TEAM_COLORS, TEAM_NAMES = TT.TEAM_NAMES;
function teamBadges() {
  const key = nLocal + '/' + nBots;
  if (teamsFor !== key) { localTeams = TT.balanceTeams([...Array(nLocal).fill({ bot: false }), ...Array(nBots).fill({ bot: true })]); teamsFor = key; }
  return localTeams.map((t, i) => `<button class="team" data-i="${i}" title="Tap to switch team" style="border-color:${TEAM_COLORS[t]}"><span class="dot" style="background:${COLORS[i]}"></span>${i < nLocal ? 'P' + (i + 1) : 'Bot ' + (i - nLocal + 1)} <b style="color:${TEAM_COLORS[t]}">${TEAM_NAMES[t]}</b></button>`).join('');
}
const MAX_TANKS = 8;
// Rounds (last tank standing) or Deathmatch (respawn after 3 s, first to N kills or 5 min). Saved on this device.
let localMatch = 'rounds', dmTarget = TT.DM.TARGET;
try { const v = JSON.parse(localStorage.getItem('tt-match')); if (v && (v.m === 'rounds' || v.m === 'dm')) localMatch = v.m; if (v && TT.DM.TARGETS.includes(v.k)) dmTarget = v.k; } catch {}
const saveMatch = () => { try { localStorage.setItem('tt-match', JSON.stringify({ m: localMatch, k: dmTarget })); } catch {} };
const fmtTime = s => { s = Math.max(0, Math.ceil(s)); return Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0'); };
const STICK_MODES = ['tank', 'point'];
let stickModes = (() => { try { const v = JSON.parse(localStorage.getItem('tt-stick')); if (Array.isArray(v)) return [0, 1].map(i => STICK_MODES.includes(v[i]) ? v[i] : 'tank'); } catch {} return ['tank', 'tank']; })();
const saveStickModes = () => { try { localStorage.setItem('tt-stick', JSON.stringify(stickModes)); } catch {} };
function keysHtml(n) {
  return keySets(n).slice(0, n).map((s, i) => `<div><span class="dot" style="background:${COLORS[i]}"></span><b>P${i + 1} ${s.name}</b>: ${s.label.slice(0, 4).map(k => `<kbd>${k}</kbd>`).join('')} move · <kbd>${s.label[4]}</kbd> fire</div>`).join('')
    + (n ? `<div>Reactions ${TT.REACTIONS.join('')}: ${REACT_LABELS.slice(0, n).map((l, i) => `${n > 1 ? 'P' + (i + 1) + ' ' : ''}<kbd>${l}</kbd>`).join(' · ')}</div>` : '')
    + (n >= 4 ? '<div class="muted">P4 needs a numeric keypad (Num Lock on or off both work).</div>' : '')
    + (nBots ? `<div><span class="dot" style="background:${COLORS[n]}"></span><b>${nBots} bot${nBots > 1 ? 's' : ''}</b> (${botLevel}) — colours ${COLOR_NAMES_FOR(n, nBots)}</div>` : '')
    + (n + nBots < 2 ? '<div class="err">Need at least 2 tanks — add a player or a bot.</div>' : '');
}
const COLOR_NAMES_FOR = (from, k) => TT.COLOR_NAMES.slice(from, from + k).join(', ');
function refreshMenu() {
  nBots = Math.max(0, Math.min(nBots, MAX_TANKS - nLocal));
  document.querySelectorAll('#nSel button[data-n]').forEach(b => b.classList.toggle('sel', +b.dataset.n === nLocal));
  document.querySelectorAll('#lvlSel button[data-l]').forEach(b => b.classList.toggle('sel', b.dataset.l === botLevel));
  $('botN').textContent = nBots;
  document.querySelectorAll('#modeSel button[data-m]').forEach(b => b.classList.toggle('sel', b.dataset.m === localMode));
  document.querySelectorAll('#matchSel button[data-g]').forEach(b => b.classList.toggle('sel', b.dataset.g === localMatch));
  document.querySelectorAll('#targetSel button[data-k]').forEach(b => b.classList.toggle('sel', +b.dataset.k === dmTarget));
  show('targetSel', localMatch === 'dm');
  show('teamPick', localMode === 'teams');
  if (localMode === 'teams') { $('teamPick').innerHTML = '<span class="muted">Tap to switch team:</span> ' + teamBadges();
    $('teamPick').querySelectorAll('button.team').forEach(b => b.onclick = () => { localTeams[+b.dataset.i] ^= 1; refreshMenu(); }); }
  $('keysLocal').innerHTML = keysHtml(nLocal);
  $('playLocal').disabled = nLocal + nBots < 2;
  renderStickSel();
  $('touchNote').textContent = isTouch ? 'On a phone/tablet: P1 (Red) gets a stick + FIRE; with 2 humans Red uses the left side, Green the right.' : '';
}
document.querySelectorAll('#nSel button[data-n]').forEach(b => b.onclick = () => { nLocal = +b.dataset.n; refreshMenu(); });
document.querySelectorAll('#lvlSel button[data-l]').forEach(b => b.onclick = () => { botLevel = b.dataset.l; refreshMenu(); });
document.querySelectorAll('#modeSel button[data-m]').forEach(b => b.onclick = () => { localMode = b.dataset.m; refreshMenu(); });
document.querySelectorAll('#matchSel button[data-g]').forEach(b => b.onclick = () => { localMatch = b.dataset.g; saveMatch(); refreshMenu(); });
document.querySelectorAll('#targetSel button[data-k]').forEach(b => b.onclick = () => { dmTarget = +b.dataset.k; saveMatch(); refreshMenu(); });
$('botMinus').onclick = () => { nBots = Math.max(0, nBots - 1); refreshMenu(); };
$('botPlus').onclick = () => { nBots = Math.min(MAX_TANKS - nLocal, nBots + 1); refreshMenu(); };
// Touch stick mode per player (only the humans on this phone: P1, and P2 when 2+ players share it)
function renderStickSel() {
  const n = isTouch ? Math.min(2, Math.max(1, nLocal)) : 0;
  show('stickRow', n > 0); if (!n) return;
  $('stickSel').innerHTML = [...Array(n)].map((_, i) => `<span class="sg">${n > 1 ? `<i style="color:${COLORS[i]}">P${i + 1}</i>` : ''}${STICK_MODES.map(m => `<button data-p="${i}" data-s="${m}" class="${stickModes[i] === m ? 'sel' : ''}" title="${m === 'tank' ? 'Up = forward, down = reverse, left/right = turn' : 'Point where to go; REVERSE button backs up'}">${m === 'tank' ? 'Tank' : 'Point'}</button>`).join('')}</span>`).join('');
  $('stickSel').querySelectorAll('button').forEach(b => b.onclick = () => { stickModes[+b.dataset.p] = b.dataset.s; saveStickModes(); renderStickSel(); fitPanels(); });
}
// Tabs (shown by CSS on narrow/short screens): one column at a time
document.querySelectorAll('.tabs button[data-tab]').forEach(b => b.onclick = () => {
  document.querySelectorAll('.tabs button[data-tab]').forEach(x => x.classList.toggle('sel', x === b));
  document.querySelectorAll('.cols .col').forEach(c => c.classList.toggle('active', c.dataset.col === b.dataset.tab));
  fitPanels();
});
// Never scroll: if a card is still taller/wider than the screen, shrink it (visually) until it fits.
function fitPanels() {
  for (const ov of document.querySelectorAll('.overlay')) {
    if (ov.classList.contains('hidden')) continue;
    const pn = ov.querySelector('.panel'); if (!pn) continue;
    pn.style.transform = ''; pn.style.marginBottom = ''; pn.style.marginTop = '';
    const cs = getComputedStyle(ov), padV = parseFloat(cs.paddingTop) + parseFloat(cs.paddingBottom), padH = parseFloat(cs.paddingLeft) + parseFloat(cs.paddingRight);
    const h = pn.offsetHeight + 6, w = pn.offsetWidth, availH = ov.clientHeight - padV, availW = ov.clientWidth - padH;
    const k = Math.min(1, availH / h, availW / w);
    if (k < 1) { pn.style.transform = `scale(${k})`; pn.style.marginTop = '0'; pn.style.marginBottom = `${-(h * (1 - k))}px`; }
  }
}
addEventListener('resize', () => requestAnimationFrame(fitPanels));
if (window.ResizeObserver) { const ro = new ResizeObserver(() => fitPanels()); document.querySelectorAll('.overlay .panel').forEach(p => ro.observe(p)); }
new MutationObserver(() => requestAnimationFrame(fitPanels)).observe(document.body, { subtree: true, attributes: true, attributeFilter: ['class'] });
refreshMenu();
const qs = new URLSearchParams(location.search);
// ---------- Discord Activity ----------
// Inside Discord the page runs at https://<client id>.discordsays.com/ (behind Discord's proxy, which forwards to server.js)
// with frame_id / instance_id in the URL. Everyone who opens the activity in the same voice channel shares one room.
const DISCORD = /\.discordsays\.com$/.test(location.hostname) && qs.has('frame_id') ? { instance: qs.get('instance_id') || '', sdk: null } : null;
if (DISCORD) {
  document.documentElement.classList.add('discord');
  $('create').textContent = 'Play in this channel ▶';
  $('code').parentElement.classList.add('hidden');
  $('link').parentElement.classList.add('hidden');
  const h = document.querySelector('[data-col="online"] h2'); if (h) h.textContent = 'Discord voice channel';
  const sc = document.createElement('script'); sc.src = 'discord-sdk.js';
  sc.onload = () => {
    try {
      DISCORD.sdk = new window.DiscordSDK(location.hostname.split('.')[0]); // the client id is the subdomain
      DISCORD.sdk.ready().then(() => { if (DISCORD.sdk.instanceId) DISCORD.instance = DISCORD.sdk.instanceId; }, e => console.warn('Discord SDK', e));
    } catch (e) { console.warn('Discord SDK', e); }
  };
  document.head.appendChild(sc);
}
$('name').value = localStorage.getItem('tt-name') || '';
if (qs.get('room')) { $('code').value = qs.get('room').toUpperCase(); setTimeout(() => $('name').focus(), 50); }

const inOverlay = () => !$('pause').classList.contains('hidden') || !$('over').classList.contains('hidden') || !$('lobby').classList.contains('hidden') || !$('menu').classList.contains('hidden');
function show(id, on) { $(id).classList.toggle('hidden', !on); }
let msgTimer;
function flash(t, ms = 2500) { $('msg').textContent = t; show('msg', true); clearTimeout(msgTimer); msgTimer = setTimeout(() => show('msg', false), ms); }

// ---------- state ----------
let mode = null;           // 'local' | 'online'
let game = null;           // local game
let paused = false;
let net = null;            // online state
const particles = [];

$('playLocal').onclick = () => startLocal(nLocal, nBots, botLevel, localMode === 'teams' ? localTeams.slice() : null, localMatch === 'dm' ? dmTarget : 0);
$('create').onclick = () => connect(DISCORD ? { t: 'joinOrCreate', key: DISCORD.instance } : { t: 'create' });
$('join').onclick = () => { const c = $('code').value.trim().toUpperCase(); if (c.length < 4) return ($('err').textContent = 'Enter the 4-letter room code.'); connect({ t: 'join', code: c }); };
$('code').onkeydown = e => { if (e.key === 'Enter') $('join').click(); };
$('resume').onclick = () => togglePause(false);
$('quit').onclick = () => quit();
$('toLobby').onclick = () => { net && net.send({ t: 'stop' }); togglePause(false); };
$('menuBtn').onclick = () => togglePause(true);
$('leave').onclick = () => quit();
$('copy').onclick = () => { const l = $('link'); l.select(); (navigator.clipboard ? navigator.clipboard.writeText(l.value) : Promise.reject()).then(() => flash('Link copied'), () => document.execCommand('copy')); };
$('start').onclick = () => net && net.send({ t: 'start' });
$('lbPlus').onclick = () => net && net.send({ t: 'addBot' });
$('lbMinus').onclick = () => net && net.send({ t: 'removeBot' });
document.querySelectorAll('#modeRow button[data-m]').forEach(b => b.onclick = () => net && net.send({ t: 'setMode', mode: b.dataset.m }));
$('switchTeam').onclick = () => net && net.send({ t: 'setTeam' });
$('plist').addEventListener('click', e => { const b = e.target.closest('[data-team-id]'); if (b && net) net.send({ t: 'setTeam', id: +b.dataset.teamId }); });
document.querySelectorAll('#lvlRow button[data-l]').forEach(b => b.onclick = () => net && net.send({ t: 'setLevel', level: b.dataset.l }));
document.querySelectorAll('#matchRow button[data-g]').forEach(b => b.onclick = () => net && net.send({ t: 'setMatch', match: b.dataset.g, target: net.target }));
$('targetBtn').onclick = () => { if (!net) return; const T = TT.DM.TARGETS; net.send({ t: 'setMatch', match: 'dm', target: T[(T.indexOf(net.target) + 1) % T.length] }); }; // 10 -> 15 -> 25 -> 10
// Deathmatch end screen: local = play again / quit; online host = play again / lobby / leave; guests wait for the host
$('again').onclick = () => { if (mode === 'local' && lastLocal) startLocal(...lastLocal); else if (net) net.send({ t: 'start' }); };
$('overLobby').onclick = () => net && net.send({ t: 'stop' });
$('overQuit').onclick = () => quit();
let overShown = false;
function showOver(players, teams, teamScore, win, target) {
  overShown = true;
  const name = id => { const p = players.find(p => p.id === id); return p ? p.name : '?'; };
  let title;
  if (teams) title = win.team < 0 ? "It's a draw!" : `${TEAM_NAMES[win.team]} team wins!`;
  else title = !win.id ? "It's a draw!" : (mode === 'online' && net && win.id === net.you ? 'You win!' : `${esc(name(win.id))} wins!`);
  $('overTitle').innerHTML = title;
  $('overSub').textContent = win.reason === 'time' ? "Time's up" : `First to ${target} kills`;
  const rows = players.slice().sort((a, b) => b.score - a.score);
  $('overList').innerHTML = (teams ? [0, 1].map(t => `<li class="tm" style="color:${TEAM_COLORS[t]}"><b>${TEAM_NAMES[t]} team</b><b>${teamScore[t]}</b></li>`).join('') : '')
    + rows.map(p => `<li><span class="dot" style="background:${COLORS[p.color]}"></span>${teams ? `<i style="color:${TEAM_COLORS[p.team || 0]}">${TEAM_NAMES[p.team || 0][0]}</i>` : ''}<span class="nm">${esc(p.name)}${mode === 'online' && net && p.id === net.you ? ' (you)' : ''}</span><b>${p.score}</b></li>`).join('');
  const host = mode === 'local' || (net && net.you === net.host);
  const row = (id, on) => $(id).parentElement.classList.toggle('hidden', !on);
  row('again', host); row('overLobby', mode === 'online' && host); show('overWait', !host);
  $('overQuit').textContent = mode === 'online' ? 'Leave room' : 'Quit to title';
  show('pause', false); show('over', true); beep(660, 0.12, 'triangle', 0.06, 1.5); setTimeout(() => beep(990, 0.25, 'triangle', 0.06, 1.2), 140);
}
function hideOver() { overShown = false; show('over', false); }

function togglePause(on) {
  if (on === undefined) on = $('pause').classList.contains('hidden');
  if (!$('lobby').classList.contains('hidden') || !$('over').classList.contains('hidden')) return;
  paused = on && mode === 'local';
  show('toLobbyRow', mode === 'online' && net && net.you === net.host);
  show('pause', on);
}
function quit(keepErr) {
  if (net) { net.closed = true; try { net.send({ t: 'leave' }); net.ws.close(); } catch {} net = null; }
  mode = null; game = null; paused = false; particles.length = 0; bubbles.clear(); setupReact(null);
  ['pause', 'lobby', 'over', 'menuBtn', 'padL', 'padR'].forEach(id => show(id, false)); overShown = false;
  show('menu', true); refreshMenu();
  if (!DISCORD) history.replaceState(null, '', location.pathname);
}

// ---------- local game ----------
let brains = {}, lastLocal = null;
// teams: null = free-for-all, true = auto-balanced teams, or an array of 0/1 per tank (humans first, then bots)
// dm: 0 = rounds, otherwise Deathmatch to that many kills (5-minute limit)
function startLocal(n, bots = 0, level = 'normal', teams = null, dm = 0) {
  audioInit(); lastLocal = [n, bots, level, Array.isArray(teams) ? teams.slice() : teams, dm]; hideOver();
  mode = 'local'; game = TT.createGame(); paused = false; brains = {};
  if (dm) TT.setMatch(game, 'dm', { target: dm });
  if (teams) { TT.setMode(game, 'teams'); if (!Array.isArray(teams)) teams = TT.balanceTeams([...Array(n).fill({ bot: false }), ...Array(bots).fill({ bot: true })]); }
  const team = i => (teams ? teams[i] : undefined);
  for (let i = 0; i < n; i++) TT.addPlayer(game, { id: i + 1, name: `P${i + 1}`, colorIndex: i, team: team(i) });
  for (let j = 0; j < bots && n + j < MAX_TANKS; j++) {
    const id = n + j + 1; TT.addPlayer(game, { id, name: `Bot ${j + 1}`, colorIndex: n + j, team: team(n + j) });
    game.players[game.players.length - 1].bot = true; brains[id] = TTBots.newBrain(level);
  }
  TT.newRound(game); game.events.length = 0;
  show('menu', false); show('menuBtn', true);
  setupTouch(isTouch ? (n >= 2 ? 'local2' : n === 1 ? 'local1' : null) : null);
  bubbles.clear(); setupReact(isTouch ? (n >= 2 ? 'local2' : n === 1 ? 'local1' : null) : null);
  if (dm) flash(`Deathmatch · first to ${game.dmTarget} kills`, 2500); else
  flash(teams ? 'Teams: Red vs Blue — last team standing scores!' : n === 2 && !bots ? 'Red: E S D F + Q   ·   Green: arrows + M' : 'Last tank standing scores!');
}
let acc = 0;
function localTick(dt) {
  if (paused) return;
  acc = Math.min(acc + dt, 0.25);
  while (acc >= 1 / 60) {
    const inputs = {}, sets = keySets(game.players.filter(p => !p.bot).length);
    game.players.forEach((p, i) => {
      if (p.bot) { inputs[p.id] = TTBots.think(game, game.tanks[p.id], brains[p.id], 1 / 60); return; }
      let k = readKeys(sets[i].keys); if (touchIn[i]) k = merge(k, stickInput(touchIn[i], game.tanks[p.id] && game.tanks[p.id].a, 1 / 60)); inputs[p.id] = k;
    });
    TT.step(game, inputs, 1 / 60); tapped.clear();
    handleEvents(game.events.splice(0), id => game.tanks[id]);
    acc -= 1 / 60;
  }
  if (game.phase === 'over' && !overShown) showOver(game.players, game.mode === 'teams', game.teamScore, game.winner, game.dmTarget);
}

// ---------- online ----------
// Server: window.TT_SERVER_URL (config.js), else same origin (when served by server.js)
function serverBase() {
  if (DISCORD) return location.origin + location.pathname.replace(/\/[^/]*$/, ''); // same origin, through Discord's proxy
  let s = window.TT_SERVER_URL || '';
  if (!s && /^https?:$/.test(location.protocol) && !window.TT_STATIC) s = location.origin;
  if (s && !/^(https?|wss?):\/\//.test(s)) s = 'https://' + s;
  return s.replace(/\/+$/, '');
}
const wsUrlOf = base => (/^wss?:/.test(base) ? base : base.replace(/^http/, 'ws')).replace(/\/ws$/, '') + '/ws';
function shareLink(code) {
  const base = serverBase();
  if (/^https?:$/.test(location.protocol)) return location.origin + location.pathname + '?room=' + code;
  return base.replace(/^ws/, 'http') + '/?room=' + code; // standalone file: link to the client the server hosts
}
function connect(first) {
  const base = serverBase();
  if (!base) return ($('err').textContent = 'No game server set. Run "npm start" and open http://localhost:8090, or set TT_SERVER_URL in config.js.');
  audioInit();
  const name = $('name').value.trim(); localStorage.setItem('tt-name', name);
  $('err').textContent = 'Connecting…';
  net = { base, you: null, host: null, code: null, token: null, players: [], started: false, maze: null, rects: null, round: 0, snaps: [], offset: null, lastSent: '', lastSentAt: 0, pendingEv: [], closed: false, retries: 0, ws: null, seq: 0, sent: [], pb: null, err: { x: 0, y: 0, a: 0 },
    send(m) { this.ws && this.ws.readyState === 1 && this.ws.send(JSON.stringify(m)); } };
  openSocket(net, Object.assign({ name }, first));
}
function openSocket(me, firstMsg) {
  let ws;
  try { ws = new WebSocket(wsUrlOf(me.base)); } catch (e) { $('err').textContent = 'Bad server URL.'; return; }
  me.ws = ws;
  ws.onopen = () => { me.retries = 0; ws.send(JSON.stringify(firstMsg)); };
  ws.onerror = () => { if (!me.code) $('err').textContent = 'Could not connect to the server (' + me.base + '). Free servers can take ~1 min to wake up — try again.'; };
  ws.onclose = () => {
    if (me.closed || net !== me || me.ws !== ws) return;
    if (me.token && me.retries < 12) { // try to get our slot back
      me.retries++; flash('Connection lost — reconnecting… (' + me.retries + ')', 2000);
      setTimeout(() => { if (net === me && !me.closed) openSocket(me, { t: 'rejoin', code: me.code, token: me.token }); }, 1200);
      return;
    }
    quit(); $('err').textContent = 'Disconnected from the server.';
  };
  ws.onmessage = ev => {
    const m = JSON.parse(ev.data);
    if (m.t === 'error') {
      if (m.soft) { flash(m.msg); return; }
      $('err').textContent = m.msg; me.closed = true; ws.close(); if (net === me) quit(true); $('err').textContent = m.msg; return;
    }
    if (m.t === 'joined') {
      const re = !!me.token;
      me.you = m.you; me.code = m.code; me.token = m.token; mode = 'online'; $('err').textContent = '';
      if (!DISCORD) history.replaceState(null, '', '?room=' + m.code);
      show('menu', false); show('menuBtn', true); if (!re) { setupTouch(isTouch ? 'online' : null); bubbles.clear(); setupReact('online'); } else flash('Reconnected!');
    } else if (m.t === 'lobby') {
      me.players = m.players; me.host = m.host; me.code = m.code; me.level = m.level; me.mode = m.mode || 'ffa'; if (m.teamScore) me.teamScore = m.teamScore;
      me.match = m.match === 'dm' ? 'dm' : 'rounds'; if (m.target) me.target = m.target;
      if (m.started) for (const q of m.players) { const p = me.players.find(p => p.id === q.id); if (p) p.score = q.score; }
      if (me.started && !m.started) { me.maze = null; me.snaps = []; me.pb = null; me.win = null; hideOver(); }
      me.started = m.started; renderLobby();
    } else if (m.t === 'react') {
      if (Number.isInteger(m.r) && TT.REACTIONS[m.r]) showBubble(m.id, m.r);
    } else if (m.t === 'maze') {
      me.maze = m.maze; me.rects = TT.mazeRects(m.maze); me.round = m.round; me.snaps = []; me.pendingEv = []; me.pb = null; me.err = { x: 0, y: 0, a: 0 }; me.win = null; me.dm = null; hideOver();
    } else if (m.t === 's') {
      if (m.round !== me.round) return;
      const now = performance.now(), est = m.time - now;
      me.offset = me.offset == null || est < me.offset ? est : me.offset * 0.98 + est * 0.02; // track the fastest path
      const snap = { time: m.time, phase: m.phase, tanks: new Map(m.tk.map(t => [t[0], { id: t[0], x: t[1], y: t[2], a: t[3], alive: !!t[4], weapon: t[5] >= 0 ? TT.WEAPONS[t[5]] : null, ammo: t[6], charge: t[7], frozen: !!t[8], respawn: t[9] || 0, prot: !!t[10] }])), bullets: new Map(m.b.map(b => [b[0], { x: b[1], y: b[2], kind: TT.KINDS[b[3]], a: b[4], tgt: b[5] }])),
        crates: (m.cr || []).map(c => ({ id: c[0], x: c[1], y: c[2], type: TT.WEAPONS[c[3]] })), mines: (m.mn || []).map(x => ({ x: x[1], y: x[2], state: x[3] })), beams: (m.bm || []).map(x => ({ kind: x[1] ? 'deathray' : 'laser', owner: x[2], life: x[3], pts: x[4] })) };
      me.snaps.push(snap); if (me.snaps.length > 40) me.snaps.shift();
      reconcile(me, m.ak, snap.tanks.get(me.you), now);
      for (const [id, sc, tm] of m.sc) { const p = me.players.find(p => p.id === id); if (p) { p.score = sc; if (tm != null) p.team = tm; } }
      if (m.md != null) me.mode = m.md ? 'teams' : 'ffa'; if (m.ts) me.teamScore = m.ts;
      if (m.ev) for (const e of m.ev) me.pendingEv.push(Object.assign({ at: m.time }, e));
      me.dm = m.dm ? { left: m.dm[0], target: m.dm[1] } : null; me.phase = m.phase;
      if (m.phase === 'over' && m.win && !overShown) { me.win = m.win; showOver(me.players, me.mode === 'teams', me.teamScore || [0, 0], m.win, me.dm ? me.dm.target : me.target); }
    }
  };
}
function renderLobby() {
  if (!net) return;
  $('roomCode').textContent = net.code;
  $('link').value = shareLink(net.code);
  const host = net.you === net.host, teams = net.mode === 'teams';
  $('plist').innerHTML = net.players.map(p => `<li><span class="dot" style="display:inline-block;width:14px;height:14px;border-radius:3px;background:${COLORS[p.color]}"></span>${teams ? `<button class="team"${p.id === net.you || host ? ` data-team-id="${p.id}" title="Switch team"` : ' disabled'} style="border-color:${TEAM_COLORS[p.team]};color:${TEAM_COLORS[p.team]}">${TEAM_NAMES[p.team]}</button>` : ''}${esc(p.name)}${p.bot ? ` <span class="muted">🤖 ${esc(net.level || '')}</span>` : ''}${p.id === net.you ? ' <span class="muted">(you)</span>' : ''}${p.id === net.host ? ' <span class="muted">· host</span>' : ''}${p.online === false ? ' <span class="err">offline…</span>' : ''}</li>`).join('')
    + (net.players.length < 2 ? (DISCORD ? '<li class="muted">Others in this voice channel join by opening the activity — or add bots (up to 8 tanks)…</li>' : '<li class="muted">Share the code or link, or add bots (up to 8 tanks)…</li>') : '');
  show('modeRow', true); document.querySelectorAll('#modeRow button[data-m]').forEach(b => { b.classList.toggle('sel', b.dataset.m === net.mode); b.disabled = !host; });
  show('switchTeam', teams);
  show('matchRow', true); document.querySelectorAll('#matchRow button[data-g]').forEach(b => { b.classList.toggle('sel', b.dataset.g === net.match); b.disabled = !host; });
  show('targetBtn', net.match === 'dm'); $('targetBtn').textContent = `${net.target || TT.DM.TARGET} kills`; $('targetBtn').disabled = !host;
  show('start', host); show('waitHost', !host); show('botRow', host); show('lvlRow', host);
  $('lobbyBots').textContent = net.players.filter(p => p.bot).length;
  document.querySelectorAll('#lvlRow button[data-l]').forEach(b => b.classList.toggle('sel', b.dataset.l === net.level));
  $('start').disabled = net.players.length < 1;
  show('lobby', !net.started);
}
const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
function onlineInput() {
  let k = inOverlay() ? { u: 0, d: 0, l: 0, r: 0, f: 0 } : readKeys(ONLINE_KEYS);
  const now = performance.now();
  if (touchIn[0] && !inOverlay()) k = merge(k, stickInput(touchIn[0], myAngle(now), net.frameDt || 1 / 60));
  const s = JSON.stringify(k);
  tapped.clear();
  if (s !== net.lastSent || now - net.lastSentAt > 250) {
    net.send({ t: 'input', k, s: ++net.seq }); net.lastSent = s; net.lastSentAt = now;
    net.sent.push({ s: net.seq, at: now, k }); if (net.sent.length > 200) net.sent.shift();
  }
}
// Own-tank prediction: the server's last state for us, plus our inputs it hasn't applied yet, replayed locally.
// Our tank's angle as we predict it right now (what the player sees), falling back to the latest snapshot.
function myAngle(now) {
  if (net.pb) return predictAt(net.pb, now).a;
  const sn = net.snaps[net.snaps.length - 1], t = sn && sn.tanks.get(net.you);
  return t ? t.a : null;
}
function predictAt(b, to) {
  const p = { x: b.x, y: b.y, a: b.a }, S = net.sent;
  if (b.frozen) return p;
  for (let i = S.findIndex(e => e.s === b.s); i >= 0 && i < S.length; i++) {
    const k = S[i].k, rot = (k.r ? 1 : 0) - (k.l ? 1 : 0), mv = b.charging ? 0 : (k.u ? 1 : 0) - (k.d ? 1 : 0);
    if (!rot && !mv) continue;
    let t = Math.max(S[i].at, b.at);
    const end = i + 1 < S.length ? Math.min(to, S[i + 1].at) : to;
    while (t < end) { const d = Math.min(1000 / 60, end - t); TT.moveTank(p, rot, mv, d / 1000, net.rects); t += d; }
  }
  return p;
}
function reconcile(me, ak, mine, now) {
  const a = ak && ak.find(x => x[0] === me.you);
  if (!a || !mine || net !== me) return;
  if (!mine.alive) { if (me.pb) me.pb.frozen = true; return; }
  const i = me.sent.findIndex(e => e.s === a[1]);
  if (i < 0) return;
  const old = me.pb && predictAt(me.pb, now);
  me.sent.splice(0, i);
  me.pb = { x: mine.x, y: mine.y, a: mine.a, frozen: mine.frozen, charging: mine.weapon === 'deathray' && mine.charge > 0, s: a[1], at: Math.min(now, me.sent[0].at + a[2] * 1000 / 60) };
  const p = predictAt(me.pb, now), e = me.err;
  if (!old) return;
  e.x += old.x - p.x; e.y += old.y - p.y; e.a = TT.wrapA(e.a + old.a - p.a); // shown offset that fades out, so corrections don't jump
  if (Math.hypot(e.x, e.y) > 48) e.x = e.y = e.a = 0;
}
const INTERP_DELAY = 60;
function lerpAngle(a, b, t) { let d = b - a; while (d > Math.PI) d -= 2 * Math.PI; while (d < -Math.PI) d += 2 * Math.PI; return a + d * t; }
function onlineView(dt) {
  if (!net.maze || !net.snaps.length) return null;
  const rt = performance.now() + net.offset - INTERP_DELAY, S = net.snaps;
  let a = S[0], b = S[0];
  if (rt >= S[S.length - 1].time) a = b = S[S.length - 1];
  else for (let i = 0; i < S.length - 1; i++) if (S[i].time <= rt && S[i + 1].time >= rt) { a = S[i]; b = S[i + 1]; break; }
  const t = b.time > a.time ? Math.min(1, Math.max(0, (rt - a.time) / (b.time - a.time))) : 1;
  const tanks = [];
  for (const [id, tb] of b.tanks) {
    const ta = a.tanks.get(id) || tb;
    const k = ta.alive === tb.alive ? t : 1; // a respawn jumps, it doesn't slide across the maze
    tanks.push({ id, x: ta.x + (tb.x - ta.x) * k, y: ta.y + (tb.y - ta.y) * k, a: lerpAngle(ta.a, tb.a, k), alive: tb.alive && (t > 0.5 || ta.alive), weapon: tb.weapon, ammo: tb.ammo, charge: tb.charge, respawn: tb.respawn, prot: tb.prot });
  }
  const mine = net.pb && tanks.find(x => x.id === net.you);
  if (mine && mine.alive) {
    const p = predictAt(net.pb, performance.now()), e = net.err, f = Math.exp(-dt * 10);
    mine.x = p.x + e.x; mine.y = p.y + e.y; mine.a = p.a + e.a;
    e.x *= f; e.y *= f; e.a *= f;
  }
  const bullets = [];
  for (const [id, bb] of b.bullets) { const ba = a.bullets.get(id); if (ba) bullets.push({ x: ba.x + (bb.x - ba.x) * t, y: ba.y + (bb.y - ba.y) * t, kind: bb.kind, a: bb.a, tgt: bb.tgt }); else if (t > 0.5) bullets.push(bb); }
  const due = net.pendingEv.filter(e => e.at <= rt + 20); net.pendingEv = net.pendingEv.filter(e => e.at > rt + 20);
  handleEvents(due, id => tanks.find(x => x.id === id));
  return { maze: net.maze, tanks, bullets, crates: b.crates, mines: b.mines, beams: b.beams, players: net.players.map(p => ({ id: p.id, name: p.name, color: p.color, score: p.score, team: p.team, bot: p.bot, you: p.id === net.you })),
    teams: net.mode === 'teams', teamScore: net.teamScore || [0, 0], dm: net.dm, phase: b.phase };
}

// ---------- effects & sound ----------
let actx = null;
function audioInit() { if (actx) { actx.state === 'suspended' && actx.resume(); return; } try { actx = new (window.AudioContext || window.webkitAudioContext)(); } catch {} }
function beep(freq, dur, type = 'square', vol = 0.05, slide = 0) {
  if (!actx) return; const o = actx.createOscillator(), g = actx.createGain(), t = actx.currentTime;
  o.type = type; o.frequency.setValueAtTime(freq, t); if (slide) o.frequency.exponentialRampToValueAtTime(Math.max(30, freq * slide), t + dur);
  g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(0.0001, t + dur); o.connect(g).connect(actx.destination); o.start(t); o.stop(t + dur);
}
function boom() {
  if (!actx) return; const len = actx.sampleRate * 0.5, buf = actx.createBuffer(1, len, actx.sampleRate), d = buf.getChannelData(0);
  for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 2);
  const s = actx.createBufferSource(), g = actx.createGain(); g.gain.value = 0.25; s.buffer = buf; s.connect(g).connect(actx.destination); s.start();
}
function handleEvents(evs, tankOf) {
  for (const e of evs) {
    if (e.type === 'point' && e.team != null) { flash(`${TT.TEAM_NAMES[e.team]} team scores!`, 1800); beep(880, 0.15, 'triangle', 0.06, 1.3); }
    if (e.type === 'fire') beep(520, 0.07, 'square', 0.03, 0.5);
    else if (e.type === 'gat') beep(760, 0.04, 'square', 0.02, 0.6);
    else if (e.type === 'spin') beep(180, TT.W.GATLING_SPIN, 'sawtooth', 0.03, 4);
    else if (e.type === 'shotgun') { beep(160, 0.18, 'square', 0.07, 0.4); beep(420, 0.08, 'sawtooth', 0.04, 0.5); }
    else if (e.type === 'laser') beep(1500, 0.25, 'sawtooth', 0.03, 0.3);
    else if (e.type === 'charge') beep(140, TT.W.RAY_CHARGE, 'sine', 0.05, 6);
    else if (e.type === 'deathray') beep(900, 0.6, 'sawtooth', 0.05, 0.2);
    else if (e.type === 'missile') beep(300, 0.35, 'triangle', 0.06, 0.5);
    else if (e.type === 'mine') beep(220, 0.08, 'square', 0.03);
    else if (e.type === 'reveal') beep(1250, 0.12, 'square', 0.05, 0.9);
    else if (e.type === 'pickup') { beep(660, 0.08, 'triangle', 0.06, 1.5); }
    else if (e.type === 'respawn') beep(440, 0.12, 'sine', 0.05, 2);
    else if (e.type === 'burst') {
      boom();
      for (let i = 0; i < 16; i++) { const a = Math.random() * 6.283, s = 20 + Math.random() * 70; particles.push({ x: e.x, y: e.y, vx: Math.cos(a) * s, vy: Math.sin(a) * s, life: 0.3 + Math.random() * 0.4, col: i % 2 ? '#777' : '#f7b733', r: 1.5 + Math.random() * 2.5 }); }
    }
    else if (e.type === 'die') {
      boom();
      if (mode === 'local' && game) { // bots sometimes laugh at their kill (or cry about being hit)
        const br = TT.botReaction(e, id => { const q = game.players.find(q => q.id === id); return !!(q && q.bot); });
        if (br) { const g0 = game; setTimeout(() => game === g0 && reactAs(br.id, br.r), 500); }
      }
      const p = (mode === 'local' ? game.players : net.players).find(p => p.id === e.id);
      const col = p ? COLORS[p.color] : '#888';
      for (let i = 0; i < 34; i++) { const a = Math.random() * 6.283, s = 20 + Math.random() * 120; particles.push({ x: e.x, y: e.y, vx: Math.cos(a) * s, vy: Math.sin(a) * s, life: 0.5 + Math.random() * 0.6, max: 1.1, col: i % 3 ? col : (i % 2 ? '#555' : '#f7b733'), r: 1.5 + Math.random() * 3 }); }
    }
  }
}

// ---------- touch controls ----------
// Two stick modes (chosen per player on the start screen, saved in localStorage):
//  'tank'  (default) like the keyboard, relative to the tank: up = forward, down = reverse, left/right = turn.
//  'point' the tank turns to face where the stick points and drives once facing it; REVERSE (held) backs up
//          while the stick keeps steering the facing.
// Either way stickInput() turns the stick into the same u/d/l/r keys the keyboard sends, so local play, the
// server and online prediction all run identical key-driven movement (no server change needed).
// Sticks always use plain screen axes: up on the screen = up for every player (players sit side by side).
const touchIn = [null, null];
const blankPad = (mode = 'tank') => ({ u: false, d: false, l: false, r: false, f: false, on: false, dx: 0, dy: 0, rev: false, mode });
const NOKEYS = () => ({ u: false, d: false, l: false, r: false });
// tankAngle: this player's tank angle now (needed by 'point'); dt: frame time (rotation step for the no-jitter stop)
function stickInput(s, tankAngle, dt = 1 / 60) {
  let k = NOKEYS();
  if (s.mode === 'point') {
    if (s.on && tankAngle != null) k = TT.pointKeys(tankAngle, Math.atan2(s.dy, s.dx), C.TANK_ROT * Math.max(1 / 60, dt));
    if (s.rev) { k.u = false; k.d = true; }
  } else if (s.on) k = TT.stickKeys(s.dx, s.dy);
  return Object.assign(k, { f: s.f });
}
const sticks = [];
function joystick(idx) {
  const el = document.createElement('div'); el.className = 'joy'; el.innerHTML = '<div class="knob"></div>';
  const knob = el.firstChild; let pid = null, downAt = 0;
  const upd = e => {
    // Measured fresh every move, in the same viewport (screen) pixels the canvas is drawn in, so the centre and
    // size are right after any resize or rotation. Up on screen is always up in the maze.
    const r = el.getBoundingClientRect(), cx = r.left + r.width / 2, cy = r.top + r.height / 2, R = r.width / 2 || 1;
    let dx = (e.clientX - cx) / R, dy = (e.clientY - cy) / R; const m = Math.hypot(dx, dy); if (m > 1) { dx /= m; dy /= m; }
    knob.style.transform = `translate(${dx * R * 0.6}px,${dy * R * 0.6}px)`;
    const s = touchIn[idx]; if (!s) return;
    s.on = m > TT.STICK_DEAD; s.dx = dx; s.dy = dy;
  };
  const reset = (before = Infinity) => { if (pid != null && downAt > before) return; pid = null; knob.style.transform = ''; const s = touchIn[idx]; if (s) { s.on = false; s.dx = s.dy = 0; } };
  el.addEventListener('pointerdown', e => { e.preventDefault(); audioInit(); pid = e.pointerId; downAt = performance.now(); try { el.setPointerCapture(pid); } catch {} upd(e); });
  el.addEventListener('pointermove', e => { if (e.pointerId === pid) upd(e); });
  const end = e => { if (e.pointerId === pid) reset(); };
  el.addEventListener('pointerup', end); el.addEventListener('pointercancel', end); el.addEventListener('lostpointercapture', end);
  sticks.push(reset);
  return el;
}
// Rotating the phone (or any resize) can swallow the finger's pointerup; drop stale touches so nothing stays stuck.
// `before`: only drop touches that started before this time (a late resize must not kill a fresh touch).
function resetTouch(before = Infinity) {
  sticks.forEach(f => f(before)); if (before !== Infinity) return;
  touchIn.forEach(s => s && Object.assign(s, blankPad(s.mode)));
  document.querySelectorAll('.fire.on').forEach(e => e.classList.remove('on'));
}
let lastOrient = null;
function onViewport() {
  const o = innerWidth >= innerHeight ? 'land' : 'port';
  document.body.classList.toggle('portrait', o === 'port');
  if (o !== lastOrient) { if (lastOrient) resetTouch(performance.now() - 250); lastOrient = o; }
}
addEventListener('resize', onViewport); addEventListener('orientationchange', () => { resetTouch(); onViewport(); });
if (screen.orientation) screen.orientation.addEventListener('change', () => { resetTouch(); onViewport(); });
addEventListener('blur', resetTouch); document.addEventListener('visibilitychange', () => document.hidden && resetTouch());
onViewport();
function holdBtn(idx, cls, label, key, color) {
  const el = document.createElement('div'); el.className = cls; el.textContent = label; if (color) el.style.background = color;
  el.addEventListener('pointerdown', e => { e.preventDefault(); audioInit(); try { el.setPointerCapture(e.pointerId); } catch {} if (touchIn[idx]) touchIn[idx][key] = true; el.classList.add('on'); });
  const end = () => { if (touchIn[idx]) touchIn[idx][key] = false; el.classList.remove('on'); };
  el.addEventListener('pointerup', end); el.addEventListener('pointercancel', end); el.addEventListener('lostpointercapture', end);
  return el;
}
const fireBtn = (idx, color) => holdBtn(idx, 'fire', 'FIRE', 'f', color);
const revBtn = idx => holdBtn(idx, 'fire rev', 'REVERSE', 'rev');
// FIRE (+ REVERSE in point mode) as one group
function buttons(idx, color) {
  const g = document.createElement('div'); g.className = 'btns'; const f = fireBtn(idx, color); g.append(f);
  if (stickModes[idx] === 'point') g.append(revBtn(idx));
  g.fire = f; return g;
}
let padMode = null;
function setupTouch(m) {
  padMode = m; const L = $('padL'), R = $('padR'); L.innerHTML = R.innerHTML = ''; touchIn[0] = touchIn[1] = null; sticks.length = 0;
  if (!m) { show('padL', false); show('padR', false); return; }
  touchIn[0] = blankPad(stickModes[0]);
  document.body.classList.toggle('two', m === 'local2');
  if (m === 'local2') { // Red on the left half, Green on the right half; each: stick on the outside, buttons inside
    touchIn[1] = blankPad(stickModes[1]);
    L.append(joystick(0), buttons(0, COLORS[0])); R.append(buttons(1, COLORS[1]), joystick(1));
  } else if (m === 'local1') {
    L.append(joystick(0)); R.append(buttons(0, COLORS[0]));
  } else { // online: stick left, fire right
    const me = () => (net && net.players.find(p => p.id === net.you)) || { color: 0 };
    L.append(joystick(0)); const g = buttons(0, COLORS[me().color]); R.append(g); setTimeout(() => (g.fire.style.background = COLORS[me().color]), 1500);
  }
  show('padL', true); show('padR', true);
}

// ---------- reactions ----------
// A bubble with the emoji floats over the player's tank (over their score while dead) for TT.REACT_SHOW s.
// Cooldown TT.REACT_COOLDOWN s per player. Local: checked here. Online: the server checks and broadcasts it.
const bubbles = new Map(), reactLast = {};
function showBubble(id, r) { bubbles.set(id, { r, at: performance.now() }); beep(r === 1 || r === 4 ? 300 : 700, 0.06, 'triangle', 0.04, 1.4); }
function reactAs(id, r) { if (TT.tryReact(reactLast, id, r, performance.now() / 1000)) { showBubble(id, r); return true; } return false; }
// slot = local human index (0..3), or 0 = you online
function doReact(slot, r) {
  let ok = false;
  if (mode === 'local' && game) { const p = game.players[slot]; ok = !!(p && !p.bot && reactAs(p.id, r)); }
  else if (mode === 'online' && net && net.you) { ok = TT.tryReact(reactLast, 'me', r, performance.now() / 1000); if (ok) net.send({ t: 'react', r }); }
  const w = reactEls[slot]; if (ok && w) { w.btn.classList.add('cool'); clearTimeout(w.cd); w.cd = setTimeout(() => w.btn.classList.remove('cool'), TT.REACT_COOLDOWN * 1000); }
  return ok;
}
function reactKey(code) {
  if (mode === 'local' && game) {
    for (let i = 0; i < REACT_KEYS.length; i++) { const r = REACT_KEYS[i].indexOf(code); if (r >= 0) { if (game.players[i] && !game.players[i].bot) doReact(i, r); return true; } }
  } else if (mode === 'online') { const r = REACT_KEYS[0].indexOf(code); if (r >= 0) { doReact(0, r); return true; } }
  return false;
}
// On-screen: a small 😀 button at the top (P1 next to ☰ when two share a phone, otherwise top right) that opens a 3×2 picker.
let reactEls = [];
function reactUI(slot, side) {
  const w = document.createElement('div'); w.className = 'react ' + side;
  const b = document.createElement('button'); b.className = 'rbtn'; b.textContent = '😀'; b.title = 'Reactions' + (mode === 'online' ? ' (keys 1–6)' : '');
  const pick = document.createElement('div'); pick.className = 'rpick hidden';
  TT.REACTIONS.forEach((e, i) => { const x = document.createElement('button'); x.textContent = e; x.title = TT.REACTION_NAMES[i]; x.dataset.r = i; pick.append(x); });
  const close = () => { pick.classList.add('hidden'); clearTimeout(w.t); };
  b.addEventListener('pointerdown', e => { e.preventDefault(); e.stopPropagation(); audioInit(); clearTimeout(w.t); if (!pick.classList.toggle('hidden')) w.t = setTimeout(close, 4000); });
  pick.addEventListener('pointerdown', e => { e.preventDefault(); e.stopPropagation(); const x = e.target.closest('button[data-r]'); if (!x) return; doReact(slot, +x.dataset.r); close(); });
  w.append(b, pick); document.body.append(w); Object.assign(w, { btn: b, pick, close }); return w;
}
function setupReact(m) {
  reactEls.forEach(w => w && w.remove()); reactEls = [];
  if (m === 'local2') reactEls = [reactUI(0, 'left'), reactUI(1, 'right')];
  else if (m === 'local1' || m === 'online') reactEls = [reactUI(0, 'right')];
}
addEventListener('pointerdown', e => { for (const w of reactEls) if (w && !w.contains(e.target)) w.close(); }, true);
function drawBubble(x, y, r, age) {
  const life = TT.REACT_SHOW, pop = Math.min(1, age / 0.14), k = pop < 1 ? pop * 1.15 : 1 + 0.15 * Math.max(0, 1 - (age - 0.14) / 0.12);
  const a = Math.min(1, (life - age) / 0.4); y -= age * 8; y = Math.max(26, y);
  ctx.save(); ctx.globalAlpha = Math.max(0, a); ctx.translate(x, y); ctx.scale(k, k);
  ctx.fillStyle = '#fff'; ctx.strokeStyle = '#555'; ctx.lineWidth = 2;
  ctx.beginPath(); ctx.arc(0, 0, 19, 0, 6.283); ctx.moveTo(-6, 17); ctx.lineTo(0, 27); ctx.lineTo(6, 17); ctx.fill(); ctx.stroke();
  ctx.beginPath(); ctx.arc(0, 0, 17.5, 0, 6.283); ctx.fill(); // hide the tail's join line
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillStyle = '#000';
  ctx.font = '22px "Apple Color Emoji","Segoe UI Emoji","Noto Color Emoji",sans-serif'; ctx.fillText(TT.REACTIONS[r], 0, 1.5);
  ctx.restore();
}

// ---------- rendering ----------
let teamBar = false; // team mode / deathmatch: a score + timer strip across the top
function layout(maze, n = 2) {
  const W = innerWidth, H = innerHeight, top = teamBar ? 34 : 0;
  const port = H > W; // portrait: controls sit in a strip under the maze instead of at the sides
  const side = padMode && !port ? Math.min(180, Math.max(120, W * 0.19)) : 10;
  // scoreboard: one row, or two rows when 5-8 players would get too squeezed (phones)
  const rows = n > 4 && (W - (padMode ? side * 2 : 20)) / n < 95 ? 2 : 1;
  const hud = rows === 2 ? Math.max(76, Math.min(110, H * 0.17)) : Math.max(44, Math.min(70, H * 0.12)), bot = padMode && port ? 160 : 0;
  const mw = maze.cols * C.CELL + 8, mh = maze.rows * C.CELL + 8;
  const s = Math.min((W - side * 2) / mw, (H - hud - bot - top - 16) / mh);
  return { s, ox: (W - maze.cols * C.CELL * s) / 2, oy: top + Math.max(8, (H - hud - bot - top - maze.rows * C.CELL * s) / 2), hud, side, bot, top, rows };
}
// Turret ("head") per weapon, drawn in tank-local coords facing +x. Each weapon has its own silhouette.
function drawTurret(w, color, charge = 0) {
  const OUT = 'rgba(0,0,0,.6)', DARK = '#333', T = performance.now() / 1000;
  ctx.strokeStyle = OUT; ctx.lineWidth = 1.2;
  const disc = (x, y, r) => { ctx.fillStyle = color; ctx.beginPath(); ctx.arc(x, y, r, 0, 6.283); ctx.fill(); ctx.stroke(); };
  const box = (x, y, w2, h, fill = color) => { ctx.fillStyle = fill; ctx.beginPath(); ctx.rect(x, y, w2, h); ctx.fill(); ctx.stroke(); };
  switch (w) {
    case 'gatling': { // three-barrel rotary gun with a collar; the lit barrel cycles while it spins
      const lit = charge > 0 ? Math.floor(T * 30) % 3 : -1;
      [-4.6, -1, 2.6].forEach((y, i) => box(2, y, 16, 2, i === lit ? '#888' : DARK));
      box(9, -6, 3.5, 12);
      disc(-1, 0, 6.5);
      ctx.fillStyle = DARK; ctx.beginPath(); ctx.arc(-1, 0, 2, 0, 6.283); ctx.fill();
      break;
    }
    case 'laser': // thin, long, glowing barrel on a small angular head
      ctx.save(); ctx.shadowColor = color; ctx.shadowBlur = 8;
      box(0, -1.3, 23, 2.6);
      ctx.fillStyle = '#fff'; ctx.beginPath(); ctx.arc(23, 0, 2.2, 0, 6.283); ctx.fill();
      ctx.restore();
      ctx.save(); ctx.translate(-1, 0); ctx.rotate(Math.PI / 4); box(-5, -5, 10, 10); ctx.restore();
      break;
    case 'frag': // stubby, wide mortar
      disc(-3, 0, 5.5);
      box(1, -7, 12, 14);
      ctx.fillStyle = DARK; ctx.fillRect(10, -5, 3, 10);
      ctx.fillStyle = 'rgba(0,0,0,.25)'; ctx.fillRect(4, -7, 2, 14);
      break;
    case 'deathray': { // emitter rod + dish
      box(2, -1.6, 9, 3.2, DARK);
      ctx.lineWidth = 3.4; ctx.strokeStyle = OUT; ctx.beginPath(); ctx.arc(19, 0, 9, Math.PI * 0.68, Math.PI * 1.32); ctx.stroke();
      ctx.lineWidth = 2.2; ctx.strokeStyle = color; ctx.beginPath(); ctx.arc(19, 0, 9, Math.PI * 0.68, Math.PI * 1.32); ctx.stroke();
      ctx.save(); ctx.shadowColor = '#7df'; ctx.shadowBlur = charge > 0 ? 14 : 5;
      ctx.fillStyle = charge > 0 ? (Math.sin(T * 40) > 0 ? '#fff' : '#7df') : '#9ef'; ctx.beginPath(); ctx.arc(13, 0, charge > 0 ? 3 : 2, 0, 6.283); ctx.fill(); ctx.restore();
      ctx.strokeStyle = OUT; ctx.lineWidth = 1.2;
      disc(-1, 0, 6);
      break;
    }
    case 'missile': // launcher tube with the missile nose poking out
      ctx.fillStyle = '#ddd'; ctx.beginPath(); ctx.moveTo(15, -2.6); ctx.lineTo(21, 0); ctx.lineTo(15, 2.6); ctx.closePath(); ctx.fill(); ctx.stroke();
      box(-3, -4.5, 18, 9);
      ctx.fillStyle = DARK; ctx.fillRect(12.5, -3, 2.5, 6);
      ctx.fillStyle = 'rgba(0,0,0,.25)'; ctx.fillRect(-3, 1.5, 18, 1.5);
      break;
    case 'mine': // flat box, no barrel, hazard stripes
      box(-8, -7.5, 15, 15);
      ctx.save(); ctx.beginPath(); ctx.rect(-8, -7.5, 15, 15); ctx.clip(); ctx.strokeStyle = 'rgba(0,0,0,.45)'; ctx.lineWidth = 2;
      for (let k = -16; k < 16; k += 5) { ctx.beginPath(); ctx.moveTo(k - 8, 8); ctx.lineTo(k + 8, -8); ctx.stroke(); }
      ctx.restore(); ctx.strokeStyle = OUT; ctx.lineWidth = 1.2;
      ctx.fillStyle = DARK; ctx.beginPath(); ctx.arc(-0.5, 0, 2.5, 0, 6.283); ctx.fill();
      break;
    case 'rc': // white-nosed launcher with a remote-control antenna
      ctx.fillStyle = '#fff'; ctx.beginPath(); ctx.moveTo(15, -2.6); ctx.lineTo(21, 0); ctx.lineTo(15, 2.6); ctx.closePath(); ctx.fill(); ctx.stroke();
      box(-3, -4.5, 18, 9);
      ctx.fillStyle = '#e33'; ctx.fillRect(10, -4.5, 2.5, 9);
      ctx.strokeStyle = DARK; ctx.lineWidth = 1.3; ctx.beginPath(); ctx.moveTo(-3, 3); ctx.lineTo(-10, 9); ctx.stroke();
      ctx.fillStyle = '#e33'; ctx.beginPath(); ctx.arc(-10, 9, 1.8, 0, 6.283); ctx.fill();
      ctx.strokeStyle = OUT; ctx.lineWidth = 1.2;
      break;
    case 'shotgun': // short double barrel with a wide muzzle
      box(2, -4.6, 12, 3.6, DARK); box(2, 1, 12, 3.6, DARK);
      box(13, -6, 3, 12, DARK);
      disc(-1, 0, 6);
      break;
    default: // standard cannon
      box(1, -2, 15, 4, DARK);
      disc(-1, 0, 6);
  }
}
function drawTank(x, y, a, color, s = 1, weapon = null, charge = 0) {
  ctx.save(); ctx.translate(x, y); ctx.rotate(a); ctx.scale(s, s);
  ctx.fillStyle = '#3b3b3b'; ctx.fillRect(-13, -12, 25, 6); ctx.fillRect(-13, 6, 25, 6);           // treads
  ctx.fillStyle = color; ctx.strokeStyle = 'rgba(0,0,0,.55)'; ctx.lineWidth = 1.2;
  ctx.beginPath(); ctx.rect(-11, -8, 21, 16); ctx.fill(); ctx.stroke();                              // hull
  drawTurret(weapon, color, charge);
  ctx.restore();
}
// Grey bevelled power-up tile with a dark symbol (Tank Trouble style), 22 units wide, centred on the origin.
function drawWeaponIcon(w) {
  const g1 = ctx.createLinearGradient(-11, -11, 11, 11); g1.addColorStop(0, '#9a9a9a'); g1.addColorStop(1, '#4e4e4e');
  ctx.fillStyle = g1; ctx.strokeStyle = '#3a3a3a'; ctx.lineWidth = 1.2;
  ctx.beginPath(); ctx.rect(-11, -11, 22, 22); ctx.fill(); ctx.stroke();
  const g2 = ctx.createLinearGradient(-8, -8, 8, 8); g2.addColorStop(0, '#7c7c7c'); g2.addColorStop(1, '#a4a4a4');
  ctx.fillStyle = g2; ctx.fillRect(-8, -8, 16, 16);
  ctx.fillStyle = ctx.strokeStyle = '#262626'; ctx.lineCap = 'round'; ctx.lineJoin = 'round';
  const dot = (x, y, r) => { ctx.beginPath(); ctx.arc(x, y, r, 0, 6.283); ctx.fill(); };
  switch (w) {
    case 'gatling':
      dot(0, 0, 1.3); for (let i = 0; i < 6; i++) dot(Math.cos(i * 1.047) * 4.2, Math.sin(i * 1.047) * 4.2, 1.3);
      break;
    case 'laser':
      ctx.lineWidth = 1.8; ctx.beginPath(); ctx.moveTo(2.5, -6); ctx.lineTo(-2.5, -2); ctx.lineTo(2.5, 2); ctx.lineTo(-2.5, 6); ctx.stroke();
      break;
    case 'frag':
      ctx.beginPath(); for (let i = 0; i < 16; i++) { const r = i % 2 ? 2.3 : 6, a = i * Math.PI / 8 - Math.PI / 2; ctx.lineTo(Math.cos(a) * r, Math.sin(a) * r); } ctx.closePath(); ctx.fill();
      break;
    case 'deathray':
      for (const y of [-4.6, -0.9, 2.8]) ctx.fillRect(-5, y, 10, 1.8);
      break;
    case 'missile':
      ctx.beginPath(); ctx.moveTo(0, -7); ctx.lineTo(1.8, 2.5); ctx.lineTo(4, 6); ctx.lineTo(0, 4.5); ctx.lineTo(-4, 6); ctx.lineTo(-1.8, 2.5); ctx.closePath(); ctx.fill();
      break;
    case 'rc':
      dot(0, 4.5, 1.5); ctx.lineWidth = 1.7;
      for (const r of [4, 7, 10]) { ctx.beginPath(); ctx.arc(0, 4.5, r, -Math.PI * 0.75, -Math.PI * 0.25); ctx.stroke(); }
      break;
    case 'mine':
      ctx.beginPath(); ctx.moveTo(0, 5.5); ctx.quadraticCurveTo(-6, 2, -5.5, -3.5); ctx.lineTo(-2, -4.8); ctx.lineTo(0, -3.6);
      ctx.lineTo(2, -4.8); ctx.lineTo(5.5, -3.5); ctx.quadraticCurveTo(6, 2, 0, 5.5); ctx.fill();
      break;
    case 'shotgun':
      dot(0, 5.5, 1.4);
      for (const [r, n] of [[5, 3], [9.5, 5]]) for (let i = 0; i < n; i++) { const a = -Math.PI / 2 + (i - (n - 1) / 2) * (0.9 / (n - 1)); dot(Math.cos(a) * r, 5.5 + Math.sin(a) * r, 1.2); }
      break;
  }
  ctx.lineCap = 'butt'; ctx.lineJoin = 'miter';
}
function drawCrate(c) {
  ctx.save(); ctx.translate(c.x, c.y); ctx.rotate(((c.id * 37) % 41 - 20) * Math.PI / 180); ctx.scale(0.75, 0.75);
  drawWeaponIcon(c.type);
  ctx.restore();
}
function drawProjectile(b, colorOf) {
  const k = b.kind || 'b';
  if (k === 'missile' || k === 'rc') {
    ctx.save(); ctx.translate(b.x, b.y); ctx.rotate(b.a || 0);
    // homing missile smoke takes the colour of the tank it is chasing
    ctx.fillStyle = k === 'missile' && b.tgt ? colorOf(b.tgt) : '#aaa'; ctx.globalAlpha = 0.6;
    for (const [px, pr] of [[-15, 2.8], [-21, 2]]) { ctx.beginPath(); ctx.arc(px, Math.random() - 0.5, pr, 0, 6.283); ctx.fill(); }
    ctx.globalAlpha = 1;
    ctx.fillStyle = Math.random() < 0.5 ? '#f7b733' : '#e8572a'; ctx.beginPath(); ctx.moveTo(-6, -2); ctx.lineTo(-11 - Math.random() * 3, 0); ctx.lineTo(-6, 2); ctx.fill();
    ctx.fillStyle = k === 'rc' ? '#eee' : '#555'; ctx.fillRect(-6, -2.5, 9, 5);
    if (k === 'rc') { ctx.fillStyle = '#e33'; ctx.fillRect(-2, -2.5, 2, 5); }
    ctx.fillStyle = '#222'; ctx.beginPath(); ctx.moveTo(3, -2.5); ctx.lineTo(7, 0); ctx.lineTo(3, 2.5); ctx.fill();
    ctx.restore(); return;
  }
  ctx.fillStyle = k === 'frag' ? '#444' : '#222';
  ctx.beginPath(); ctx.arc(b.x, b.y, TT.KIND_R[k] || C.BULLET_R, 0, 6.283); ctx.fill();
  if (k === 'bomb') { ctx.fillStyle = Math.sin(performance.now() / 70) > 0 ? '#f33' : '#600'; ctx.beginPath(); ctx.arc(b.x, b.y, 1.8, 0, 6.283); ctx.fill(); }
}
function render(view, dt) {
  const dpr = devicePixelRatio || 1;
  if (cv.width !== Math.round(innerWidth * dpr) || cv.height !== Math.round(innerHeight * dpr)) { cv.width = Math.round(innerWidth * dpr); cv.height = Math.round(innerHeight * dpr); cv.style.width = innerWidth + 'px'; cv.style.height = innerHeight + 'px'; }
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.fillStyle = '#cfcfcf'; ctx.fillRect(0, 0, innerWidth, innerHeight);
  if (!view) { ctx.fillStyle = '#666'; ctx.font = '16px Verdana'; ctx.textAlign = 'center'; ctx.fillText(mode ? 'Waiting for the round…' : '', innerWidth / 2, innerHeight / 2); return; }
  teamBar = !!(view.teams || view.dm);
  const teamOfId = id => { const p = view.players.find(p => p.id === id); return p && p.team != null ? p.team : 0; };
  const m = view.maze, L = layout(m, view.players.length), CS = C.CELL, rects = view.rects || TT.mazeRects(m);
  const colorOf = id => { const p = view.players.find(p => p.id === id); return COLORS[p ? p.color : 0]; };
  ctx.save(); ctx.translate(L.ox, L.oy); ctx.scale(L.s, L.s);
  // floor + faint cell grid
  ctx.fillStyle = '#ececec'; ctx.fillRect(0, 0, m.cols * CS, m.rows * CS);
  ctx.strokeStyle = '#e0e0e0'; ctx.lineWidth = 1; ctx.beginPath();
  for (let c = 1; c < m.cols; c++) { ctx.moveTo(c * CS, 0); ctx.lineTo(c * CS, m.rows * CS); }
  for (let r = 1; r < m.rows; r++) { ctx.moveTo(0, r * CS); ctx.lineTo(m.cols * CS, r * CS); }
  ctx.stroke();
  // booby traps: visible while arming, invisible once armed, flashing once a tank drives over one
  for (const mn of view.mines || []) {
    if (mn.state === 1) continue;
    const rev = mn.state === 2, blink = Math.sin(performance.now() / (rev ? 40 : 90)) > 0;
    if (rev) { ctx.strokeStyle = blink ? '#f33' : '#900'; ctx.lineWidth = 2; ctx.beginPath(); ctx.arc(mn.x, mn.y, 9, 0, 6.283); ctx.stroke(); }
    ctx.fillStyle = '#555'; ctx.beginPath(); ctx.arc(mn.x, mn.y, 5.5, 0, 6.283); ctx.fill();
    ctx.fillStyle = blink ? '#f33' : '#900'; ctx.beginPath(); ctx.arc(mn.x, mn.y, rev ? 2.8 : 2, 0, 6.283); ctx.fill();
  }
  // crates
  for (const c of view.crates || []) drawCrate(c);
  // walls
  ctx.fillStyle = '#4d4d4d';
  for (const q of rects) ctx.fillRect(q.x, q.y, q.w, q.h);
  // laser aim guides
  for (const t of view.tanks) if (t.alive && t.weapon === 'laser') {
    const ray = TT.traceRay(rects, t.x + Math.cos(t.a) * 8, t.y + Math.sin(t.a) * 8, t.a, TT.W.LASER_GUIDE, 4);
    ctx.save(); ctx.strokeStyle = colorOf(t.id); ctx.globalAlpha = 0.55; ctx.lineWidth = 1.5; ctx.setLineDash([5, 5]); ctx.lineDashOffset = -performance.now() / 40;
    ctx.beginPath(); ray.pts.forEach((p, i) => (i ? ctx.lineTo(p[0], p[1]) : ctx.moveTo(p[0], p[1]))); ctx.stroke(); ctx.restore();
  }
  // tanks
  for (const t of view.tanks) if (t.alive) {
    if (t.weapon === 'deathray' && t.charge > 0) { // death ray charging glow
      const k = 1 - t.charge / TT.W.RAY_CHARGE;
      ctx.save(); ctx.strokeStyle = '#7df'; ctx.shadowColor = '#7df'; ctx.shadowBlur = 12; ctx.lineWidth = 2 + 2 * k; ctx.globalAlpha = 0.5 + 0.5 * Math.abs(Math.sin(performance.now() / 60));
      ctx.beginPath(); ctx.arc(t.x, t.y, 24 - 8 * k, 0, 6.283); ctx.stroke(); ctx.restore();
    }
    const blink = t.prot && Math.sin(performance.now() / 55) > 0; // spawn protection: blinking, shots pass through
    if (blink) { ctx.save(); ctx.globalAlpha = 0.3; }
    if (view.teams) teamRing(t.x, t.y, TEAM_COLORS[teamOfId(t.id)], 1);
    drawTank(t.x, t.y, t.a, colorOf(t.id), 1, t.weapon, t.charge);
    if (blink) ctx.restore();
  }
  // projectiles
  for (const b of view.bullets) drawProjectile(b, colorOf);
  // beams
  for (const bm of view.beams || []) {
    const col = colorOf(bm.owner), ray = bm.kind === 'deathray';
    ctx.save(); ctx.globalAlpha = Math.min(1, bm.life / 0.25); ctx.lineJoin = 'round'; ctx.lineCap = 'round';
    ctx.shadowColor = ray ? '#7df' : col; ctx.shadowBlur = 12;
    const path = () => { ctx.beginPath(); bm.pts.forEach((p, i) => (i ? ctx.lineTo(p[0], p[1]) : ctx.moveTo(p[0], p[1]))); ctx.stroke(); };
    ctx.strokeStyle = ray ? '#5cf' : col; ctx.lineWidth = ray ? 7 : 3; path();
    ctx.strokeStyle = '#fff'; ctx.lineWidth = ray ? 2.5 : 1; path();
    ctx.restore();
  }
  // particles
  for (let i = particles.length - 1; i >= 0; i--) {
    const p = particles[i]; p.life -= dt; if (p.life <= 0) { particles.splice(i, 1); continue; }
    p.x += p.vx * dt; p.y += p.vy * dt; p.vx *= 0.93; p.vy *= 0.93;
    ctx.globalAlpha = Math.min(1, p.life / 0.4); ctx.fillStyle = p.col; ctx.beginPath(); ctx.arc(p.x, p.y, p.r, 0, 6.283); ctx.fill();
  }
  ctx.globalAlpha = 1; ctx.restore();
  if (view.dm) drawDmBar(view); else if (view.teams) drawTeamBar(view);
  // HUD: scores + current weapon at the bottom
  const ps = view.players, n = ps.length, rows = L.rows, per = Math.ceil(n / rows), rowH = L.hud / rows;
  const slot = Math.min(220, (innerWidth - (padMode ? L.side * 2 : 20)) / Math.max(1, per));
  const hudAt = {};
  ctx.textBaseline = 'middle';
  ps.forEach((p, i) => {
    const row = Math.floor(i / per), col = i % per, inRow = row === rows - 1 ? n - per * (rows - 1) : per;
    const hy = innerHeight - L.bot - L.hud + rowH * (row + 0.5) - 4;
    const cx = innerWidth / 2 + (col - (inRow - 1) / 2) * slot - 14, sc = Math.min(1.3, rowH / 50, slot / 120);
    hudAt[p.id] = { x: cx - 26 * sc, y: hy - 16 * sc };
    const t = view.tanks.find(t => t.id === p.id), w = t && t.alive ? t.weapon : null, wait = view.dm && t && !t.alive && t.respawn > 0;
    if (view.teams) teamRing(cx - 26 * sc, hy, TEAM_COLORS[p.team || 0], sc);
    if (wait) ctx.globalAlpha = 0.3;
    drawTank(cx - 26 * sc, hy, -Math.PI / 2, COLORS[p.color], sc, w);
    ctx.globalAlpha = 1;
    if (wait) { ctx.fillStyle = '#222'; ctx.textAlign = 'center'; ctx.font = `bold ${Math.round(18 * sc)}px Verdana, sans-serif`; ctx.fillText(Math.ceil(t.respawn), cx - 26 * sc, hy + 1); }
    ctx.fillStyle = '#333'; ctx.textAlign = 'left';
    ctx.font = `bold ${Math.round(24 * sc)}px Verdana, sans-serif`;
    if (view.dm) { ctx.fillStyle = view.teams ? TEAM_COLORS[p.team || 0] : '#333'; ctx.fillText(p.score, cx - 6 * sc, hy - 5 * sc); } // deathmatch: kills
    else if (view.teams) { ctx.fillStyle = TEAM_COLORS[p.team || 0]; ctx.font = `bold ${Math.round(13 * sc)}px Verdana, sans-serif`; ctx.fillText(TEAM_NAMES[p.team || 0].toUpperCase(), cx - 6 * sc, hy - 5 * sc); }
    else ctx.fillText(p.score, cx - 6 * sc, hy - 5 * sc);
    // weapon icon box next to the score
    const ix = cx + (view.teams ? 44 : 30) * sc, iy = hy - 6 * sc, bs = 20 * sc;
    ctx.fillStyle = 'rgba(255,255,255,.35)'; ctx.strokeStyle = '#aaa'; ctx.lineWidth = 1.5;
    if (!w) { ctx.beginPath(); ctx.rect(ix - bs / 2, iy - bs / 2, bs, bs); ctx.fill(); ctx.stroke(); }
    if (w) {
      ctx.save(); ctx.translate(ix, iy); ctx.scale(bs / 22, bs / 22); drawWeaponIcon(w); ctx.restore();
      if (w === 'gatling') { ctx.fillStyle = '#333'; ctx.font = `bold ${Math.round(9 * sc)}px Verdana, sans-serif`; ctx.fillText('×' + t.ammo, ix + bs / 2 + 2, iy); }
    }
    ctx.font = `${Math.round(10 * sc)}px Verdana, sans-serif`; ctx.fillStyle = '#555';
    const sub = view.legend && view.legend[i] ? view.legend[i] : (p.name + (p.you ? ' (you)' : ''));
    ctx.fillText(w && !p.bot ? TT.WEAPON_NAMES[w] : sub, cx - 6 * sc, hy + 13 * sc);
  });
  if (view.dm && view.phase !== 'over') drawRespawnBanner(view, L);
  // reaction bubbles: over the tank while alive, over the player's score while dead
  const now = performance.now();
  for (const [id, bb] of bubbles) {
    const age = (now - bb.at) / 1000; if (age >= TT.REACT_SHOW) { bubbles.delete(id); continue; }
    const t = view.tanks.find(t => t.id === id);
    if (t && t.alive) drawBubble(L.ox + t.x * L.s, L.oy + t.y * L.s - Math.max(14, (C.TANK_R + 4) * L.s) - 27, bb.r, age);
    else if (hudAt[id]) drawBubble(hudAt[id].x, hudAt[id].y - 27, bb.r, age);
  }
}
// Team colour ring under a tank (team mode): each tank keeps its own colour, the ring shows its team.
function teamRing(x, y, col, s) {
  ctx.save(); ctx.strokeStyle = col; ctx.lineWidth = 3.5 * s; ctx.globalAlpha = 0.9;
  ctx.beginPath(); ctx.arc(x, y, (C.TANK_R + 6) * s, 0, 6.283); ctx.stroke();
  ctx.globalAlpha = 0.18; ctx.fillStyle = col; ctx.fill(); ctx.restore();
}
function drawTeamBar(view) {
  const ts = view.teamScore || [0, 0], y = 20, cx = innerWidth / 2;
  const bw = Math.max(110, Math.min(240, innerWidth - 216)), fs = Math.max(12, Math.round(20 * bw / 240)); // leaves the ☰ / 😀 corners free
  ctx.save(); ctx.textBaseline = 'middle'; ctx.font = `bold ${fs}px Verdana, sans-serif`;
  ctx.fillStyle = 'rgba(255,255,255,.7)'; ctx.fillRect(cx - bw / 2, y - 15, bw, 30);
  ctx.textAlign = 'right'; ctx.fillStyle = TEAM_COLORS[0]; ctx.fillText(`RED ${ts[0]}`, cx - 12, y);
  ctx.textAlign = 'center'; ctx.fillStyle = '#555'; ctx.fillText(':', cx, y);
  ctx.textAlign = 'left'; ctx.fillStyle = TEAM_COLORS[1]; ctx.fillText(`${ts[1]} BLUE`, cx + 12, y);
  ctx.restore();
}
// Deathmatch strip: time left in the middle; FFA shows the kill target, Teams the two team totals.
function drawDmBar(view) {
  const y = 20, cx = innerWidth / 2, ts = view.teamScore || [0, 0], dm = view.dm;
  const bw = Math.max(130, Math.min(260, innerWidth - 216)), fs = Math.max(12, Math.round(18 * bw / 260));
  ctx.save(); ctx.textBaseline = 'middle'; ctx.font = `bold ${fs}px Verdana, sans-serif`;
  ctx.fillStyle = 'rgba(255,255,255,.75)'; ctx.fillRect(cx - bw / 2, y - 15, bw, 30);
  const low = dm.left <= 30 && view.phase !== 'over';
  if (view.teams) {
    ctx.textAlign = 'right'; ctx.fillStyle = TEAM_COLORS[0]; ctx.fillText(`RED ${ts[0]}`, cx - bw * 0.14, y);
    ctx.textAlign = 'left'; ctx.fillStyle = TEAM_COLORS[1]; ctx.fillText(`${ts[1]} BLUE`, cx + bw * 0.14, y);
    ctx.textAlign = 'center'; ctx.fillStyle = low ? '#c22' : '#555'; ctx.font = `bold ${Math.round(fs * 0.8)}px Verdana, sans-serif`; ctx.fillText(fmtTime(dm.left), cx, y);
  } else {
    ctx.textAlign = 'center'; ctx.fillStyle = low ? '#c22' : '#444'; ctx.fillText(`⏱ ${fmtTime(dm.left)}`, cx - bw * 0.2, y);
    ctx.fillStyle = '#666'; ctx.font = `bold ${Math.round(fs * 0.75)}px Verdana, sans-serif`; ctx.fillText(`first to ${dm.target}`, cx + bw * 0.22, y);
  }
  ctx.restore();
}
// "Respawning in 3…" for the humans on this screen who are waiting (you online; every local player sharing the device)
function drawRespawnBanner(view, L) {
  const mine = view.players.filter(p => (mode === 'online' ? p.you : !p.bot)).map(p => [p, view.tanks.find(t => t.id === p.id)]).filter(([, t]) => t && !t.alive && t.respawn > 0);
  if (!mine.length) return;
  const solo = mine.length === 1 && view.players.filter(p => (mode === 'online' ? p.you : !p.bot)).length === 1;
  const parts = mine.map(([p, t]) => [solo ? `Respawning in ${Math.ceil(t.respawn)}…` : `${p.name} ${Math.ceil(t.respawn)}…`, COLORS[p.color]]);
  const mh = view.maze.rows * C.CELL * L.s, y = L.oy + mh * 0.5, fs = Math.round(Math.max(16, Math.min(30, innerWidth / 22)));
  ctx.save(); ctx.font = `bold ${fs}px Verdana, sans-serif`; ctx.textBaseline = 'middle'; ctx.textAlign = 'left';
  const gap = fs, ws = parts.map(([s]) => ctx.measureText(s).width + fs * 1.1), total = ws.reduce((a, b) => a + b, 0) + gap * (parts.length - 1) + fs;
  let x = innerWidth / 2 - total / 2;
  ctx.fillStyle = 'rgba(40,40,40,.78)'; ctx.beginPath(); ctx.roundRect ? ctx.roundRect(x, y - fs, total, fs * 2, fs) : ctx.rect(x, y - fs, total, fs * 2); ctx.fill();
  x += fs / 2;
  parts.forEach(([s, col], i) => {
    ctx.fillStyle = col; ctx.beginPath(); ctx.arc(x + fs * 0.35, y, fs * 0.32, 0, 6.283); ctx.fill();
    ctx.fillStyle = '#fff'; ctx.fillText(s, x + fs * 0.9, y + 1); x += ws[i] + gap;
  });
  ctx.restore();
}
function localView() {
  return { maze: game.maze, rects: game.rects, tanks: Object.values(game.tanks), bullets: game.bullets, players: game.players,
    crates: game.crates, beams: game.beams, mines: game.mines.map(m => ({ x: m.x, y: m.y, state: TT.mineState(m) })),
    teams: game.mode === 'teams', teamScore: game.teamScore, phase: game.phase,
    dm: TT.isDM(game) ? { left: game.dmLeft, target: game.dmTarget } : null,
    legend: game.players.map((p, i, a, s = keySets(a.filter(x => !x.bot).length)[i]) => p.bot ? p.name : `${s.label.slice(0, 4).join(' ')} + ${s.label[4]}`) };
}

// ---------- main loop ----------
let last = performance.now();
function frame(now) {
  const dt = Math.min(0.05, (now - last) / 1000); last = now;
  let view = null;
  if (mode === 'local' && game) { localTick(dt); view = localView(); }
  else if (mode === 'online' && net) { net.frameDt = dt; onlineInput(); view = onlineView(dt); if (view) view.rects = net.rects; }
  render(view, dt);
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
// PWA: offline app shell (served pages only; the single-file tank-tussle.html skips it)
if ('serviceWorker' in navigator && /^https?:$/.test(location.protocol) && !window.TT_SINGLE && !DISCORD) addEventListener('load', () => navigator.serviceWorker.register('sw.js').catch(() => {}));
window.__tt = { get game() { return game; }, get net() { return net; }, startLocal, bubbles, doReact, down, drawTank, ctx, get paused() { return paused; }, set paused(v) { paused = v; } };
})();
