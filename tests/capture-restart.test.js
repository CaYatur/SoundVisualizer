'use strict';
/* Ses yakalama yardımcısı beklenmedik biçimde kapanınca yakalama yeniden
   kuruluyor (#695).

   Eskiden yardımcı çökünce (ya da seçili aygıt yokken) çıkış sessizce
   yutuluyordu: ana süreç kaynağı hâlâ yakalanıyor sanıyor, aynı kaynağı
   yeniden seçmek bile bir şey değiştirmiyordu ve panel "Yakalanıyor"
   demeye devam ediyordu. Canlıda yardımcı öldürülerek bulundu. */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { EventEmitter } = require('events');

const read = (p) => fs.readFileSync(path.join(__dirname, '..', p), 'utf8');

/* Gerçek yardımcıyı çalıştırmadan: spawn sahte bir alt süreç verir. */
function loadWithFakeSpawn() {
  const cp = require('child_process');
  const real = cp.spawn;
  const children = [];
  cp.spawn = () => {
    const c = new EventEmitter();
    c.stdout = new EventEmitter();
    c.stderr = new EventEmitter();
    c.stdin = { end() {} };
    c.kill = () => { setImmediate(() => c.emit('exit', null, 'SIGTERM')); };
    children.push(c);
    return c;
  };
  const id = require.resolve('../src/main/native-audio.js');
  delete require.cache[id];
  try {
    return { na: require(id), children };
  } finally {
    cp.spawn = real;
    delete require.cache[id];
  }
}

const tick = () => new Promise((r) => setImmediate(r));

test('yardımcı kendiliğinden kapanınca "exited" bildirilir', async () => {
  const { na, children } = loadWithFakeSpawn();
  const seen = [];
  na.startCapture(['default'], () => {}, (s) => seen.push(s));
  children[0].emit('exit', 3221225477, null);
  await tick();
  assert.deepStrictEqual(seen, [{ type: 'exited', code: 3221225477, signal: null }]);
});

test('kasıtlı durdurma ve kaynak değişimi "exited" bildirmez', async () => {
  const { na, children } = loadWithFakeSpawn();
  const seen = [];
  na.startCapture(['default'], () => {}, (s) => seen.push(s));
  // Kaynak değişti: eski yardımcı öldürülür, yenisi başlar
  na.startCapture(['Başka'], () => {}, (s) => seen.push(s));
  await tick();
  na.stopCapture();
  await tick();
  assert.strictEqual(children.length, 2);
  assert.deepStrictEqual(seen, []);
});

test('seçili aygıt yoksa nedeni söylenir', async () => {
  const { na, children } = loadWithFakeSpawn();
  const seen = [];
  na.startCapture(['Takılı değil'], () => {}, (s) => seen.push(s));
  children[0].stderr.emit('data', Buffer.from('NO-DEVICE'));
  children[0].emit('exit', 2, null);
  await tick();
  assert.strictEqual(seen[0].type, 'error');
  assert.strictEqual(seen[0].code, 'NO_DEVICE');
  assert.strictEqual(seen[1].type, 'exited');
  const I = read('src/shared/i18n.js');
  assert.ok(I.includes("'" + seen[0].message + "': '"), 'İngilizcesi yok');
});

test('ana süreç kapanan yakalamayı artan aralıkla yeniden kurar', () => {
  const M = read('src/main/main.js');
  assert.match(M, /if \(status && status\.type === 'exited'\) \{ disarmCaptureStable\(\); scheduleCaptureRestart\(\); \}/);
  assert.match(M, /if \(status && status\.type === 'started'\) armCaptureStable\(\);/);
  const at = M.indexOf('function scheduleCaptureRestart()');
  assert.ok(at > 0);
  const fn = M.slice(at, M.indexOf('function syncCapture()', at));
  // Kaynak unutulmalı, yoksa syncCapture "zaten yakalanıyor" der
  assert.match(fn, /lastCaptureSource = null;/);
  assert.match(fn, /if \(captureWanted\(\)\) syncCapture\(\);/);
  assert.match(fn, /\.unref\(\)/);
  assert.match(M, /const CAPTURE_RETRY_MS = \[1000, 2000, 5000, 10000\];/);
});

test('panel yeniden bağlanmayı gösterir, aynı hatayla başlığı yeniden açmaz', () => {
  const A = read('src/admin/admin.js');
  const at = A.indexOf("} else if (s.type === 'exited') {");
  assert.ok(at > 0, 'exited dalı');
  assert.match(A.slice(at, at + 600), /setAudioState\('Ses yakalama durdu, yeniden bağlanıyor…', 'warn', 'warning'\);/);
  assert.match(A, /if \(msg !== audioErrShown\) \{/);
  assert.match(read('src/admin/admin.css'), /\.audio-state\.warn \{/);
  assert.ok(read('src/shared/i18n.js').includes("'Ses yakalama durdu, yeniden bağlanıyor…': 'Audio capture stopped, reconnecting…',"));
});

/* Yardımcı canlı ama kare kesildi (uykudan dönüş, askıya alınmış süreç).
   Canlıda süreç askıya alınarak bulundu: kareler 0'a düştü, panel
   "Yakalanıyor" dedi ve hiçbir şey yeniden kurulmadı. */
function frame() { return Buffer.alloc(16); }

test('kare kesilirse yardımcı öldürülür ve yeniden kurulur', async (t) => {
  t.mock.timers.enable({ apis: ['setInterval', 'Date'], now: 1000000 });
  const { na, children } = loadWithFakeSpawn();
  const seen = [];
  na.startCapture(['default'], () => {}, (s) => seen.push(s.type));
  const c = children[0];
  let killed = 0;
  const kill = c.kill;
  c.kill = () => { killed++; kill(); };
  for (let i = 0; i < 5; i++) { c.stdout.emit('data', frame()); t.mock.timers.tick(1000); }
  assert.strictEqual(killed, 0, 'kare akarken öldürülmemeli');
  for (let i = 0; i < 4; i++) t.mock.timers.tick(1000);
  assert.strictEqual(killed, 1, 'kare 3 sn kesilince öldürülmeli');
  await tick();
  assert.deepStrictEqual(seen, ['exited']);
});

test('ilk kare gelmeden bekçi bir şey yapmaz', (t) => {
  t.mock.timers.enable({ apis: ['setInterval', 'Date'], now: 1000000 });
  const { na, children } = loadWithFakeSpawn();
  na.startCapture(['default'], () => {}, () => {});
  let killed = 0;
  children[0].kill = () => { killed++; };
  for (let i = 0; i < 20; i++) t.mock.timers.tick(1000);
  assert.strictEqual(killed, 0);
  na.stopCapture();
});

test('olay döngüsü tıkalıyken geçen süre kesinti sayılmaz', (t) => {
  t.mock.timers.enable({ apis: ['setInterval', 'Date'], now: 1000000 });
  const { na, children } = loadWithFakeSpawn();
  na.startCapture(['default'], () => {}, () => {});
  const c = children[0];
  let killed = 0;
  c.kill = () => { killed++; };
  c.stdout.emit('data', frame());
  // Ana süreç 10 sn tıkandı ya da sistem uyudu: tik geç geliyor
  t.mock.timers.setTime(Date.now() + 10000);
  t.mock.timers.tick(1000);
  assert.strictEqual(killed, 0, 'geç gelen tik kesinti sayılmamalı');
  c.stdout.emit('data', frame());
  t.mock.timers.tick(1000);
  assert.strictEqual(killed, 0);
  na.stopCapture();
});

/* Bekleme 'started' gelir gelmez sıfırlanıyordu: sürekli düşüp kalkan bir
   aygıt (bekçi 3 sn + 1 sn) her ~4 sn'de bir yeniden kuruluyor, bekleme hiç
   uzamıyordu. Artık yakalama 15 sn ayakta kalınca sıfırlanır. */
test('düşüp kalkan aygıtta bekleme uzar, kararlı yakalamada sıfırlanır', (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const M = read('src/main/main.js');
  const a = M.indexOf('const CAPTURE_RETRY_MS');
  const b = M.indexOf('// Yakalamayı istenen duruma getir', a);
  const vm = require('vm');
  const ctx = { setTimeout, clearTimeout, lastCaptureSource: null, starts: 0 };
  ctx.captureWanted = () => true;
  ctx.syncCapture = () => { ctx.starts += 1; };
  vm.createContext(ctx);
  vm.runInContext(M.slice(a, b) + '\nthis.api = { scheduleCaptureRestart, armCaptureStable, disarmCaptureStable, retry: () => captureRetry };', ctx);
  const api = ctx.api;
  const waits = [];
  // Her turda: başla, 3 sn sonra kesil, beklemeyi ölç
  for (let i = 0; i < 5; i++) {
    api.armCaptureStable();
    t.mock.timers.tick(3000);
    api.disarmCaptureStable();
    const before = ctx.starts;
    api.scheduleCaptureRestart();
    let w = 0;
    while (ctx.starts === before && w < 20000) { t.mock.timers.tick(500); w += 500; }
    waits.push(w);
  }
  assert.deepStrictEqual(waits, [1000, 2000, 5000, 10000, 10000], 'bekleme uzamalı');
  // 15 sn ayakta kalan yakalama beklemeyi sıfırlar
  api.armCaptureStable();
  t.mock.timers.tick(15000);
  assert.strictEqual(api.retry(), 0);
});
