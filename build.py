# Build outputs from public/ (the source, also what server.js serves):
#  1. public/sw.js gets a fresh cache VERSION (hash of the app shell) so installed PWAs pick up updates
#  2. tank-tussle.html: single-file game (works by double-click, file://) - no manifest/service worker, icons inlined
#  3. docs/: GitHub Pages copy (PWA: manifest, service worker, icons). docs/config.js is kept as is.
import base64, hashlib, os, re, shutil

SHELL = ['index.html', 'game.js', 'bots.js', 'client.js', 'manifest.webmanifest', 'config.js']
ICONS = sorted(f for f in os.listdir('public/icons') if f.endswith(('.png', '.svg')) and f != 'icon-48.png')

def stamp_sw(sw_src, extra=b''):
    h = hashlib.sha256(extra)
    for f in SHELL: h.update(open('public/' + f, 'rb').read())
    for f in ICONS: h.update(open('public/icons/' + f, 'rb').read())
    v = h.hexdigest()[:10]
    return re.sub(r"const VERSION = '[^']*';", f"const VERSION = '{v}';", sw_src), v

# 1. service worker version for public/ (server.js)
sw = open('public/sw.js').read()
sw_pub, v = stamp_sw(sw)
open('public/sw.js', 'w').write(sw_pub)
print('public/sw.js VERSION', v)

# 2. single file
s = open('public/index.html').read()
for f in ['config.js', 'game.js', 'bots.js']:
    s = s.replace(f'<script src="{f}"></script>', '<script>\n' + open('public/' + f).read() + '\n</script>')
s = s.replace('<script src="client.js"></script>', '<script>\nwindow.TT_SINGLE = true;\n' + open('public/client.js').read() + '\n</script>')
s = re.sub(r'<link rel="manifest"[^>]*>\n?', '', s)
s = re.sub(r'<link rel="icon" type="image/svg\+xml"[^>]*>\n?', '', s)
fav = 'data:image/png;base64,' + base64.b64encode(open('public/icons/favicon-32.png', 'rb').read()).decode()
s = s.replace('href="icons/favicon-32.png"', f'href="{fav}"')
apple = 'data:image/png;base64,' + base64.b64encode(open('public/icons/apple-touch-icon.png', 'rb').read()).decode()
s = s.replace('href="icons/apple-touch-icon.png"', f'href="{apple}"')
open('tank-tussle.html', 'w').write(s)
print('built tank-tussle.html', len(s))

# 3. GitHub Pages copy of the static client (docs/). config.js there points at the separately hosted server.
os.makedirs('docs/icons', exist_ok=True)
for f in ['index.html', 'game.js', 'bots.js', 'client.js', 'manifest.webmanifest', 'discord-sdk.js']:
    shutil.copy('public/' + f, 'docs/' + f)
for f in ICONS: shutil.copy('public/icons/' + f, 'docs/icons/' + f)
if not os.path.exists('docs/config.js'):
    open('docs/config.js', 'w').write("""// GitHub Pages build: the page is static, so online play needs the separately hosted server.
// Set this to the server's public URL (https:// -> the client uses wss://), e.g. 'https://tank.example.com'.
// Players can also override it with ?server=https://... in the URL. Local (same keyboard) mode never needs it.
window.TT_STATIC = true;
window.TT_SERVER_URL = '';
""")
sw_docs, vd = stamp_sw(sw, open('docs/config.js', 'rb').read())  # docs differ only by config.js
open('docs/sw.js', 'w').write(sw_docs)
shutil.copy('tank-tussle.html', 'docs/tank-tussle.html')
open('docs/.nojekyll', 'w').close()
print('synced docs/ (sw VERSION', vd + ')')
