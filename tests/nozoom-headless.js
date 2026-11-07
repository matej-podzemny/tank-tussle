// No-zoom guard: viewport meta, touch-action styles, gesture + double-tap + pinch prevented, controls multi-touch untouched.
const puppeteer = require('puppeteer-core');
const FILE = 'file:///workspace/tank-trouble/tank-tussle.html';
let fail = 0; const ok = (c, m) => { console.log((c ? '  ok   ' : '  FAIL ') + m); if (!c) fail++; };
(async () => {
  const b = await puppeteer.launch({ executablePath: '/usr/bin/google-chrome', headless: 'new', args: ['--no-sandbox'] });
  const p = await b.newPage(); await p.setViewport({ width: 390, height: 844, isMobile: true, hasTouch: true });
  await p.goto(FILE); await new Promise(r => setTimeout(r, 300));
  const r = await p.evaluate(() => {
    const T = (type, target, n) => { const t = [...Array(n)].map((_, i) => new Touch({ identifier: i, target, clientX: 10 + i * 50, clientY: 10 })); const e = new TouchEvent(type, { bubbles: true, cancelable: true, touches: t, changedTouches: t }); target.dispatchEvent(e); return e.defaultPrevented; };
    const g = new Event('gesturestart', { bubbles: true, cancelable: true }); document.body.dispatchEvent(g);
    const ov = document.querySelector('.overlay') || document.body;
    T('touchend', ov, 1); const dbl = T('touchend', ov, 1);
    const pinch = T('touchmove', ov, 2);
    const joy = document.querySelector('.joy') || document.querySelector('canvas');
    const ctrlMulti = T('touchmove', joy, 2);
    const inp = document.getElementById('name');
    return { meta: document.querySelector('meta[name=viewport]').content, html: getComputedStyle(document.body).touchAction,
      canvas: getComputedStyle(document.querySelector('canvas')).touchAction, btn: getComputedStyle(document.querySelector('button')).touchAction,
      fs: parseFloat(getComputedStyle(inp).fontSize), code: parseFloat(getComputedStyle(document.getElementById('code')).fontSize),
      gesture: g.defaultPrevented, dbl, pinch, ctrlMulti };
  });
  for (const k of ['width=device-width', 'initial-scale=1', 'maximum-scale=1', 'user-scalable=no', 'viewport-fit=cover']) ok(r.meta.includes(k), 'viewport has ' + k);
  ok(r.html === 'none', 'body touch-action none'); ok(r.canvas === 'none', 'canvas touch-action none');
  ok(r.btn === 'manipulation', 'button touch-action manipulation');
  ok(r.fs >= 16 && r.code >= 16, `inputs >=16px (${r.fs}, ${r.code})`);
  ok(r.gesture, 'gesturestart prevented'); ok(r.dbl, 'double-tap touchend prevented');
  ok(r.pinch, 'pinch outside controls prevented'); ok(!r.ctrlMulti, 'multi-touch on controls NOT prevented');
  await b.close(); console.log(fail ? fail + ' FAILED' : 'ALL OK'); process.exit(fail ? 1 : 0);
})();
