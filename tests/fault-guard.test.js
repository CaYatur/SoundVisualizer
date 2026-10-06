'use strict';
/* Ana süreçte yakalanmamış hata uygulamayı dondurmaz (#695).

   Electron'un varsayılanı modal bir kutu; kutu kapanana dek ana iş
   parçacığı durur, ses kareleri ve panel donar. Canlıda yayın sunucusunun
   reddettiği bir istemci bağlantıyı sert kesince oldu. Artık hata kaydedilir,
   panel kısa bir uyarı gösterir; panel yoksa eski kutu gösterilir. */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { createFaultGuard, appendCapped } = require('../src/main/fault-guard.js');

function rig(over) {
  let t = 1000;
  const calls = { log: [], notify: [], fallback: [] };
  const g = createFaultGuard(Object.assign({
    now: () => t,
    notifyEveryMs: 30000,
    log: (key, stack, count) => calls.log.push(count),
    hasWindow: () => true,
    notify: (key, count) => calls.notify.push([key, count]),
    fallback: (key) => calls.fallback.push(key),
  }, over || {}));
  return { g, calls, advance: (ms) => { t += ms; } };
}

test('aynı hata sık gelirse uyarı bir kez verilir, kayıt her seferinde', () => {
  const { g, calls, advance } = rig();
  for (let i = 0; i < 100; i++) g.handle(new Error('ses yolunda hata'), 'uncaughtException');
  assert.strictEqual(calls.log.length, 100);
  assert.strictEqual(calls.log[99], 100, 'sayaç');
  assert.deepStrictEqual(calls.notify, [['Error: ses yolunda hata', 1]]);
  g.handle(new TypeError('başka hata'));
  assert.strictEqual(calls.notify.length, 2, 'farklı ileti ayrıca bildirilir');
  advance(30000);
  g.handle(new Error('ses yolunda hata'));
  assert.deepStrictEqual(calls.notify[2], ['Error: ses yolunda hata', 101]);
});

test('panel yokken eski kutu gösterilir', () => {
  const { g, calls } = rig({ hasWindow: () => false });
  assert.strictEqual(g.handle(new Error('açılışta')), 'fallback');
  assert.deepStrictEqual(calls.fallback, ['Error: açılışta']);
  assert.strictEqual(calls.notify.length, 0);
});

test('işleyici hiçbir koşulda hata atmaz', () => {
  const boom = () => { throw new Error('içeride'); };
  const g = createFaultGuard({ log: boom, hasWindow: boom, notify: boom, fallback: boom, now: boom });
  assert.doesNotThrow(() => g.handle(new Error('a')));
  assert.doesNotThrow(() => g.handle('dize'));
  assert.doesNotThrow(() => g.handle(undefined));
  assert.doesNotThrow(() => g.handle(null));
  const g2 = createFaultGuard({ hasWindow: () => true, notify: boom });
  assert.strictEqual(g2.handle(new Error('b')), 'notified');
});

test('öz test için hatalar kaydedilir, sınırlı', () => {
  const { g } = rig();
  for (let i = 0; i < 300; i++) g.handle(new Error('h' + i));
  const e = g.errors();
  assert.strictEqual(e.length, 100);
  assert.strictEqual(e[0], 'Error: h0');
});

test('kayıt dosyası sınırı aşınca .old olur', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'svfault-'));
  try {
    const f = path.join(dir, 'main-errors.log');
    appendCapped(fs, f, 'a'.repeat(60), 100);
    appendCapped(fs, f, 'b'.repeat(60), 100);
    assert.strictEqual(fs.readFileSync(f, 'utf8'), 'b'.repeat(60));
    assert.strictEqual(fs.readFileSync(f + '.old', 'utf8'), 'a'.repeat(60));
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('ana süreç işleyiciyi kurar ve öz test hatayı sayar', () => {
  const M = fs.readFileSync(path.join(__dirname, '..', 'src', 'main', 'main.js'), 'utf8');
  assert.match(M, /process\.on\('uncaughtException', \(err, origin\) => faultGuard\.handle\(err, origin\)\);/);
  assert.match(M, /for \(const k of faultGuard\.errors\(\)\) errors\.push\('main process: uncaught ' \+ k\);/);
  // Öz testte kullanıcı verisine yazılmaz
  assert.match(M, /if \(SMOKE\) return;\s*const line = /);
  const A = fs.readFileSync(path.join(__dirname, '..', 'src', 'admin', 'admin.js'), 'utf8');
  assert.match(A, /window\.api\.onMainFault\(/);
  const I = fs.readFileSync(path.join(__dirname, '..', 'src', 'shared', 'i18n.js'), 'utf8');
  assert.ok(I.includes("'Beklenmedik bir hata oldu; uygulama çalışmaya devam ediyor.': '"));
});
