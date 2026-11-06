# Tank Tussle — a Tank Trouble (2015) style remake

Top-down maze tank battles: small random mazes, slow round bullets that bounce off walls
for 10 s (you can shoot yourself), one hit kills, last tank standing scores a point, new maze every round — or play **Deathmatch**: respawn after 3 s, first to 15 kills (or most kills in 5 min) wins.
All art is simple drawn shapes — no original assets.

## Run it

**Quickest: just open `tank-tussle.html` in Chrome (double-click) — local 2–4 player mode works with no server, no npm.**

Online mode requires Node.js 18+:

```bash
npm install
npm start            # serves on http://localhost:8090  (change with PORT=3000 npm start)
```

Open http://localhost:8090 in a browser.

## Modes

**Same keyboard (2–4 players)** — pick 2/3/4 on the title screen:

| Player | Colour | Move (fwd / left / back / right) | Fire |
|---|---|---|---|
| P1 | Red    | E / S / D / F | Q |
| P2 | Green  | ↑ / ← / ↓ / → | M (or /) |
| P3 | Blue   | I / J / K / L | U |
| P4 | Yellow | Numpad 8 / 4 / 5 / 6 | Numpad 0 |

On a phone/tablet pick a **Stick** mode on the start screen (per player when two share a phone; remembered):
- **Tank** (default): like the keys, relative to the tank: up = forward, down = reverse, left/right = turn, diagonals combine.
- **Point**: the tank turns to face where you point and drives; hold **REVERSE** (next to FIRE) to back up while the stick still steers.
Both modes send the same keys as the keyboard, so online play needs nothing extra. Sticks use plain screen axes (up on the screen = forward). Two players can share the screen: Red = left stick + FIRE, Green = right stick + FIRE.
(Local mode also works by just opening `public/index.html` from disk.)

**Online (each player on their own PC/phone)** — needs the server (see *Server setup* below):
1. Enter a name and click **Create room** → you get a 4-letter code and a share link (`?room=CODE`).
2. Friends open the link (or enter the code) and click **Join room**.
3. Up to **8 tanks per room** (players + bots, 8 colours; Teams balance 4 v 4). The host can add bots (− / +, skill Easy/Normal/Hard) and clicks **Start game**. With 5–8 tanks the scoreboard uses two rows on phones.
4. Everyone drives with arrows (or WASD) and fires with Space / M; phones get an on-screen stick + FIRE.
If a connection drops, the client reconnects automatically and gets its tank back (slot is kept for 30 s).

Esc / ☰ opens the menu (the host can end the game and return everyone to the lobby).

**Emoji reactions** — 😂 Laugh · 😡 Mad · 😭 Cry · 😎 Cool · 💀 Dead · 👍 GG. A bubble pops up over your tank for 2 s
(over your score if you're dead — that's the point: get killed, laugh or rage). 1.5 s cooldown per player.

| Who | Keys (😂 😡 😭 😎 💀 👍) |
|---|---|
| P1 (and everyone online) | 1 2 3 4 5 6 |
| P2 | 7 8 9 0 - = |
| P3 | Z X C V B N |
| P4 | Numpad 7 9 1 2 3 . |

On a phone tap the small 😀 button at the top (top right; with two players on one phone P1's is next to ☰ and P2's top right) and pick one.
Online the server checks the reaction (allowed list + cooldown) and sends it to everyone in the room. Bots sometimes laugh when they get a kill.
(Online reactions need the updated server / Docker image; an older server just ignores them.)

**Free-for-all or Teams** — pick the mode on the title screen (local) or in the lobby (online, host only).
- *Free-for-all* (default): last tank standing scores a point.
- *Teams*: **Red vs Blue**. Humans are spread across both teams first, then bots fill up the smaller team.
  Switch someone's team by tapping their team badge on the title screen (local), or with **Switch my team** in the lobby (online; the host can tap anyone's badge, e.g. to move bots).
  Every tank keeps its own colour and gets a ring in its team colour. The top bar shows the team score, and the round ends when only one team has tanks left; that team scores a point.
- Friendly fire is **on** (Tank Trouble style: your own and your teammates' bullets can kill you). To turn it off, set `FRIENDLY_FIRE = false` in `public/game.js` and run `python3 build.py`.
- Bots never target teammates, hold fire when a teammate is in the line of fire (or near a frag bomb or mine), and don't treat teammates as enemies.
- Online, the server decides the mode and teams (only the host can change the mode, only before the game starts). The lobby and snapshot messages carry each player's team and the team score.

**Rounds or Deathmatch** — pick the *Game* on the title screen (local) or in the lobby (online, host only). Works with Free-for-all and Teams.
- *Rounds* (default): the classic: one hit and you're out, last tank (or team) standing scores a point, then a new maze.
- *Deathmatch*: no rounds. When you die you respawn **3 s** later at a safe spot (far from enemies, away from bullets, mines and beams),
  blinking for 1.5 s while shots pass through you (firing ends the protection early). You come back with the normal cannon.
  A "Respawning in 3…" banner shows the countdown (for every player sharing the screen), and your scoreboard tank shows it too.
  Score = **kills**; killing yourself or a teammate costs 1. In Teams the team total counts.
  The match ends when someone (or a team) reaches the kill target — **10, 15 (default) or 25**, picked under *Win at* — or after **5 minutes**
  (most kills wins; equal = draw). The top bar shows the clock and the target (or both team totals). The end screen ranks everyone; *Play again* starts a new match
  (online: the host; guests wait, the host can also go *Back to lobby*). Bots respawn and play on too.
- Online, the server runs it all (respawn timer, spawn spot, protection, scores, clock and match end); players who join mid-match drop in after 1 s.
  Deathmatch online needs the updated server / Docker image.

## Code layout

- `public/game.js` – shared game logic (maze generation, movement, collisions, bouncing bullets, rounds/scores, deathmatch respawns + match end). Used by the browser (local mode) and by the server (online mode).
- `public/client.js` – rendering, keyboard/touch input, local loop, online client (interpolates server snapshots).
- `public/index.html` – UI/menus.
- `server.js` – static file server + WebSocket rooms (`/ws`); authoritative 60 Hz simulation, 30 Hz snapshots.

## Weapons (crates)

A crate appears every 8–12 s (first one 3–6 s into a round, max 3 on the map). Drive over it with an empty slot to pick it up.
The tank's turret changes shape so everyone can see what you carry, and the icon shows next to your score.

| Weapon | Turret look | How it works |
|---|---|---|
| Gatling gun | three thin barrels + collar | fire once: barrels spin up for ~1 s, then 24 tiny bullets spray out in a wobbly stream |
| Laser | long thin glowing barrel | dashed aim guide (about half the range); fire = instant bouncing beam, stops at the first tank hit |
| Frag bomb | stubby wide mortar | fire launches a bigger bullet; fire again (or hit a tank) to burst into shrapnel (auto-bursts after 3 s) |
| Death ray | dish emitter | fire = 2 s charge (tank can't drive, can aim), then a beam that goes **through walls**, bends slightly towards tanks ahead and kills every other tank it touches until the outer wall |
| RC missile | white-nosed launcher + antenna | fire a missile you steer with left/right; your tank is frozen until it hits something or times out (7 s) |
| Homing missile | launcher tube | bounces around for 2 s, then its smoke turns the colour of the nearest tank (can be you!) and it chases that tank through the maze |
| Booby trap | flat striped box, no barrel | drops a mine behind you; armed after 1 s and fully invisible. A tank driving over it reveals it — stop at once and it stays quiet, move and it bursts into shrapnel. Bullets don't trigger it |
| Shotgun | short double barrel | one blast of 14 tiny pellets in a cone; they bounce and vanish after 2–3 s |

## Bots

On the title screen pick 0–4 human players, then add bots with **Bots − / +** (up to 8 tanks in total, at least 2) and choose **Easy / Normal / Hard**.
Tanks 5–8 are Orange, Purple, Cyan and Pink; bots are labelled *Bot 1, Bot 2…*. Mazes get bigger with more tanks (up to 13×9).
Bots path-find through the maze (BFS) to the nearest enemy, fire when their aim line hits a tank (Normal/Hard also use 1–2 wall bounces),
dodge incoming bullets and visible mines, grab crates and use each weapon (burst frags near enemies, laser/death ray only when the beam will hit, steer RC missiles through the maze, freeze on a revealed booby trap, etc.),
and skip shots that would bounce straight back at them. Skill changes reaction time, aim error, dodge rate and bounce shots.
With 0 humans you can watch an all-bot match. On a phone, 1 human + bots works with the on-screen stick + FIRE.


## Server setup (for the developer hosting online play)

The server (`server.js`) is a small Node.js app: it serves the client from `public/` and runs every online room
authoritatively (60 Hz simulation, 30 Hz state snapshots over WebSocket at path **`/ws`**; clients interpolate, and predict their own tank so it reacts instantly).
It shares `public/game.js` (rules, weapons) and `public/bots.js` (AI) with the browser. No database, rooms live in memory.

**Requirements:** Node.js **18+** (tested on 22), one dependency (`ws`). ~1 small CPU core is plenty for many rooms.

```bash
npm install          # or: npm ci --omit=dev
npm start            # listens on $PORT, default 8090
PORT=3000 npm start  # custom port
curl localhost:8090/health   # {"ok":true,"rooms":0,...}
```

Open `http://<host>:8090/` — the same server also hosts a full copy of the client, so it is playable without GitHub Pages.

### Behind a reverse proxy with TLS (wss://)

The browser connects to `wss://<your-domain>/ws` when the server URL is `https://…`. The proxy must pass WebSocket upgrades:

```nginx
server {
    listen 443 ssl http2;
    server_name tank.example.com;
    ssl_certificate     /etc/letsencrypt/live/tank.example.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/tank.example.com/privkey.pem;

    location / {
        proxy_pass http://127.0.0.1:8090;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $host;
        proxy_read_timeout 3600s;   # keep idle game sockets open (server also pings every 20 s)
    }
}
```

Run it permanently with systemd, pm2 (`pm2 start server.js --name tank-tussle`) or Docker.
Any PaaS that supports WebSockets and sets `$PORT` works too (start command `npm start`).

### Docker

A ready-made image (linux/amd64 + arm64) is built by GitHub Actions on every push to `master` and is public, no login needed:

```bash
docker run -d --restart unless-stopped -p 8090:8090 --name tank-tussle ghcr.io/matej-podzemny/tank-tussle:latest
curl localhost:8090/health   # {"ok":true,...}
```

- The container listens on port **8090** (WebSocket path `/ws`). Map it as `-p <host-port>:8090`, or change it with `-e PORT=...`.
- Update: `docker pull ghcr.io/matej-podzemny/tank-tussle:latest`, then remove and re-run the container.
- The GitHub Pages site is served over https, so browsers can only connect to a **`wss://`** server. Put the container
  behind a reverse proxy with TLS (nginx example above, or Caddy/Traefik) and set `docs/config.js` to the `https://` address.
- Build it yourself instead: `docker build -t tank-tussle . && docker run -d -p 8090:8090 tank-tussle`.

### Discord Activity (play inside a Discord voice channel)

The same server also works as a [Discord Activity](https://docs.discord.com/developers/activities/overview). Nothing changes for the normal web version:
the client switches to Discord mode only when it runs on `<client id>.discordsays.com` (Discord's proxy).
In Discord mode the online box shows **Play in this channel ▶**. Everyone who opens the activity in the same voice channel lands in the same room
(the room is keyed by the activity instance id, message `joinOrCreate`), the first one in is the host. No codes or links are needed.
The client talks to the server through Discord's proxy on the same origin (`/ws`), and the service worker is off inside Discord.
`public/discord-sdk.js` is `@discord/embedded-app-sdk` bundled as one file (`window.DiscordSDK`), loaded only inside Discord.

1. The server must be reachable over **https** (the Docker setup above with TLS). For a quick test from your PC: `npm start`, then
   `cloudflared tunnel --url http://localhost:8090` and use the `*.trycloudflare.com` address it prints (it changes on every run).
2. <https://discord.com/developers/applications> → **New Application**.
3. **Activities → Settings**: turn on **Enable Activities**.
4. **Activities → URL Mappings**: prefix `/` → target = your server's host name without `https://` (e.g. `tank.example.com`). Save.
5. **Installation**: keep *Guild Install*, open the install link and add the app to your server.
6. In Discord, join a voice channel → 🚀 (Activities) → pick the app → **Play in this channel ▶**.
   While the app is not published only you (and people you add to the app's team / testers) see it in the list.

### Pointing the GitHub Pages client at the server

`docs/` is the static GitHub Pages site (same client, plus `tank-tussle.html`). Edit **`docs/config.js`**:

```js
window.TT_STATIC = true;
window.TT_SERVER_URL = 'https://tank.example.com';   // https -> client uses wss://<host>/ws
```

Commit and push; Pages serves it.
CORS: WebSockets accept any origin and `/health` sends `Access-Control-Allow-Origin: *`, so the Pages origin can connect.
Note: an `https://` Pages site cannot talk to a plain `ws://` server (mixed content) — the server needs TLS (`wss://`).

### Install as an app (PWA)
The site is installable ("Add to Home Screen"): `manifest.webmanifest`, icons in `public/icons/`, and a service worker (`sw.js`) that caches the app so local play works offline. It never touches the game server (WebSocket `/ws`, `/health`, other origins).
Icon (minimal flat gold tank on navy) source: `python3 tools/make_icon.py` (SVG) → `node tools/render_icons.js` (PNGs) → `node tools/icon_preview.js` (preview sheet).

### Rebuilding the client copies

`public/` is the source. After editing it run `python3 build.py` — it rebuilds the single-file `tank-tussle.html`
(all JS inlined; works by double-click; online works there too if `TT_SERVER_URL` is set in `public/config.js`) and syncs `docs/` (keeps `docs/config.js`).

### Tests (optional, need Chrome + puppeteer-core)

`tests/` holds the headless scripts used during development (weapons, bots, online sync/reconnect, phone joystick, teams).
- `node tests/stick-unit.js`, `node tests/teams-unit.js`, `node tests/reactions-unit.js`, `node tests/deathmatch-unit.js` and `node tests/discord-join-unit.js` (starts its own server on PORT=8099) are pure Node (no browser).
- `TT_DEBUG_DM=1 PORT=8098 npm start`, then `BASE=http://localhost:8098 node tests/deathmatch-headless.js`: Deathmatch picker on phones, local respawn countdown / HUD / end screen / play again, two players on one phone, and an online match (host picks it, server respawns + scores, time limit + kill target, back to lobby). `TT_DEBUG_DM=1` enables two test-only messages (kill a tank, set the clock). Screenshots go to `/workspace/deathmatch-shots/` (`OUT=` to change).
- `BASE=http://localhost:8097 node tests/reactions-headless.js`: reactions (keys, phone picker, online broadcast + server checks) and an 8-player online room (9th refused, 4 v 4 teams, no overlapping spawns).
- `tests/joystick-headless.js`, `tests/teams-headless.js` and `tests/responsive-headless.js` (menu/lobby/game fit without scrolling, 320 px → desktop) and `tests/pwa-headless.js` use Chrome. Their online part needs a server: `PORT=8097 npm start`, then `BASE=http://localhost:8097 node tests/teams-headless.js`.
`TT_DEBUG_WEAPONS=1 npm start` hands every tank a weapon at round start (used by the online weapon test).
