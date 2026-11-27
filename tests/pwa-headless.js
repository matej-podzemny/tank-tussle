// PWA checks in headless Chrome: manifest parses, the page is installable (Chrome's installability checks),
// the service worker registers and serves the app shell offline, and it never intercepts the game server.
// URLS: comma-separated pages to test. Default: server.js.
const puppeteer = require('puppeteer-core');
const URLS = (process.env.URLS || 'http://localhost:8097/').split(',');
const sleep = ms => new Promise(r => setTimeout(r, ms));
let fail = 0; const ok = (c, m) => { console.log((c ? '  ok   ' : '  FAIL ') + m); if (!c) fail++; };
(async () => {
  for (const url of URLS) {
    console.log(url);
    const b = await puppeteer.launch({ executablePath: '/usr/bin/google-chrome', headless: 'new', args: ['--no-sandbox'] });
    const p = await b.newPage(), cdp = await p.target().createCDPSession(); const errs = []; p.on('pageerror', e => errs.push(e.message));
    await p.setViewport({ width: 390, height: 844, isMobile: true, hasTouch: true, deviceScaleFactor: 3 });
    await p.goto(url, { waitUntil: 'load' });
    const man = await cdp.send('Page.getAppManifest');
    ok(man.url.endsWith('manifest.webmanifest') && !man.errors.length, `manifest parses (${man.url}) ${JSON.stringify(man.errors)}`);
    const m = JSON.parse(man.data);
    ok(m.name === 'Tank Tussle' && m.start_url === './' && m.scope === './' && ['fullscreen', 'standalone'].includes(m.display) && m.orientation === 'any', 'name, start_url/scope ./, display, orientation');
    const sizes = m.icons.map(i => i.sizes + ':' + i.purpose); ok(sizes.includes('192x192:any') && sizes.includes('512x512:any') && sizes.includes('512x512:maskable'), 'icons 192, 512 and maskable 512');
    for (const ic of m.icons) { const r = await p.evaluate(async u => { const x = await fetch(u); return x.ok && x.headers.get('content-type'); }, new URL(ic.src, man.url).href); ok(!!r, `icon ${ic.src} loads (${r})`); }
    const apple = await p.$eval('link[rel="apple-touch-icon"]', l => l.href), am = await p.$$eval('meta[name^="apple-mobile-web-app"]', ms => ms.map(x => x.name + '=' + x.content));
    ok(await p.evaluate(async u => (await fetch(u)).ok, apple) && am.length === 3, 'apple-touch-icon + iOS meta: ' + am.join(', '));
    const swReady = await p.evaluate(() => Promise.race([navigator.serviceWorker.ready.then(r => r.active && r.active.scriptURL), new Promise(r => setTimeout(() => r(null), 8000))]));
    ok(!!swReady, 'service worker registered + active: ' + swReady);
    await sleep(500);
    const inst = await cdp.send('Page.getInstallabilityErrors');
    ok(!inst.installabilityErrors.length, 'Chrome installability: ' + (inst.installabilityErrors.map(e => e.errorId).join(', ') || 'no errors'));
    // reload offline: the app shell comes from the cache and a local game starts
    await p.reload({ waitUntil: 'load' }); await sleep(300);
    await p.setOfflineMode(true);
    await p.reload({ waitUntil: 'load' }).catch(e => errs.push('offline reload: ' + e.message));
    const off = await p.evaluate(() => { try { __tt.startLocal(1, 1); return !!__tt.game && !!document.querySelector('canvas'); } catch (e) { return 'err ' + e.message; } });
    ok(off === true, 'works offline (cached shell, local game starts)');
    await p.setOfflineMode(false);
    // never intercepted: /health (server API) and the WebSocket go straight to the network
    const ctl = await p.evaluate(() => !!navigator.serviceWorker.controller);
    ok(ctl, 'page is controlled by the service worker');
    const swSrc = await p.evaluate(async () => (await fetch('sw.js')).text());
    ok(/\(ws\|health\)/.test(swSrc) && /url\.origin !== location\.origin/.test(swSrc) && !/VERSION = 'dev'/.test(swSrc), 'sw skips /ws, /health and other origins; VERSION stamped (' + (swSrc.match(/VERSION = '([^']+)'/) || [])[1] + ')');
    if (url.includes(':8097')) { // online still works through the SW-controlled page
      await p.reload({ waitUntil: 'load' }); await p.evaluate(() => document.querySelector('.tabs button[data-tab="online"]').click());
      await p.type('#name', 'Pwa'); await p.click('#create');
      const code = await p.waitForFunction(() => __tt.net && __tt.net.code, { timeout: 10000 }).then(() => true, () => false);
      ok(code, 'online room created over /ws with the service worker active');
    }
    ok(!errs.length, 'no page errors ' + errs.join('; '));
    await b.close();
  }
  console.log(fail ? `${fail} FAILURES` : 'pwa-headless: all passed'); process.exit(fail ? 1 : 0);
})().catch(e => { console.error('FAIL', e); process.exit(1); });
