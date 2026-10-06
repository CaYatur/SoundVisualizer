'use strict';
/* OpenRGB bağlantısı her ayar gönderiminde yeniden kurulmaz (#695).

   applyIncomingConfig her gönderimde syncOpenRgb'yi çağırıyor. Eskiden bu
   her seferinde openrgb.start → connect → soketi kapat, yeniden bağlan,
   bütün aygıtları yeniden listele demekti. Sahte bir OpenRGB sunucusuyla
   ölçüldü: 3 sn kaydırıcı sürüklemede 42 yeni bağlantı, her tıklamada bir
   tane; ışıklara o arada renk gitmiyordu. */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const MAIN = fs.readFileSync(path.join(__dirname, '..', 'src', 'main', 'main.js'), 'utf8');

function slice(src, startText, endText) {
  const a = src.indexOf(startText);
  assert.ok(a >= 0, startText);
  const b = src.indexOf(endText, a);
  assert.ok(b > a, endText);
  return src.slice(a, b);
}

/* syncOpenRgb ve durumunu sahte modülle kurar. */
function harness() {
  const code = slice(MAIN, 'let openRgbKey = null;', '\nfunction syncOscServer(');
  const calls = { start: 0, stop: 0 };
  let state = { running: false, connected: false };
  let resolveStart = null;
  const openrgb = {
    status: () => Object.assign({}, state),
    start: () => {
      calls.start++;
      state = { running: true, connected: false };
      return new Promise((res) => { resolveStart = (connected) => { state = { running: true, connected }; res(Object.assign({}, state)); }; });
    },
    stop: () => { calls.stop++; state = { running: false, connected: false }; return Promise.resolve(); },
  };
  const env = { cfg: { openrgb: { enabled: true, host: '127.0.0.1', port: 6742 } }, hwOff: false };
  const fn = new Function('openrgb', 'env', 'notifyAdmin', `
    let currentConfig = env.cfg;
    const HW_OFF = env.hwOff;
    ${code}
    return { sync: syncOpenRgb, setCfg: (c) => { currentConfig = c; } };
  `)(openrgb, env, () => {});
  return { sync: fn.sync, setCfg: fn.setCfg, calls, finish: (c) => resolveStart(c), state: () => state };
}

test('aynı adres ve portta her gönderim yeniden bağlanmaz', async () => {
  const h = harness();
  h.sync();
  h.finish(true);
  await Promise.resolve();
  for (let i = 0; i < 20; i++) await h.sync();
  assert.strictEqual(h.calls.start, 1, 'tek bağlantı');
});

test('adres ya da port değişince yeniden bağlanır, kapatınca durur', async () => {
  const h = harness();
  h.sync();
  h.finish(true);
  h.setCfg({ openrgb: { enabled: true, host: '127.0.0.1', port: 6743 } });
  h.sync();
  assert.strictEqual(h.calls.start, 2);
  h.setCfg({ openrgb: { enabled: false, host: '127.0.0.1', port: 6743 } });
  await h.sync();
  await h.sync();
  assert.strictEqual(h.calls.stop, 1, 'kapalıyken her gönderimde durdurmaz');
  h.setCfg({ openrgb: { enabled: true, host: '127.0.0.1', port: 6743 } });
  h.sync();
  assert.strictEqual(h.calls.start, 3, 'yeniden açınca bağlanır');
});

test('panelden istek: bağlanırken bekler, kopukken hemen yeniden dener', async () => {
  const h = harness();
  const first = h.sync();
  const asked = h.sync({ retry: true });
  assert.strictEqual(asked, first, 'süren bağlantıyı beklemeli');
  assert.strictEqual(h.calls.start, 1);
  h.finish(false);
  await first;
  // Bağlanamadı: ayar gönderimi beklemez, panel isteği hemen dener
  await h.sync();
  assert.strictEqual(h.calls.start, 1);
  h.sync({ retry: true });
  assert.strictEqual(h.calls.start, 2);
  h.finish(true);
  await Promise.resolve();
  await h.sync({ retry: true });
  assert.strictEqual(h.calls.start, 2, 'bağlıyken yeniden bağlanmaz');
});

test('Aygıtları Yenile bağlı değilken bağlanmayı yeniden dener', () => {
  const h = slice(MAIN, "ipcMain.handle('openrgb:rescan'", '\n});');
  assert.match(h, /if \(!openrgb\.status\(\)\.connected\) return syncOpenRgb\(\{ retry: true \}\);/);
  assert.match(MAIN, /ipcMain\.handle\('openrgb:sync', \(\) => syncOpenRgb\(\{ retry: true \}\)\);/);
});

test('start bekleyen yeniden denemeyi iptal ediyor', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'src', 'main', 'openrgb.js'), 'utf8');
  const s = slice(src, 'async function start(cfg)', 'await connect(c);');
  assert.match(s, /if \(retryTimer\) \{ clearTimeout\(retryTimer\); retryTimer = null; \}/);
});
