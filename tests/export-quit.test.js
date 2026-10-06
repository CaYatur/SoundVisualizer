'use strict';
/* Dışa aktarım sürerken uygulama kapanınca yarım dosya silinir (#695).

   Panel kapatılınca dışa aktarım iptal ediliyor ve ffmpeg öldürülüyordu,
   ama yarım dosya tek bir 200 ms'lik zamanlayıcıyla siliniyordu. Uygulama
   ondan önce kapandığı için oynatılamayan yarım MP4 (canlıda 4,7 MB)
   kullanıcının klasöründe kalıyordu. */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { EventEmitter } = require('events');

const M = fs.readFileSync(path.join(__dirname, '..', 'src', 'main', 'main.js'), 'utf8');

function loadBlock(fakeFs) {
  const a = M.indexOf('const pendingPartials = new Set();');
  const b = M.indexOf('\n}', M.indexOf('function flushPartialsSync(budgetMs)')) + 2;
  assert.ok(a > 0 && b > a, 'blok bulunamadı');
  const ctx = { fs: fakeFs, setTimeout, Date, Atomics, SharedArrayBuffer, Int32Array, Array, Set };
  vm.createContext(ctx);
  vm.runInContext(M.slice(a, b) + '\nthis.api = { pendingPartials, removePartial, flushPartialsSync };', ctx);
  return ctx.api;
}

/* Dosya tutamacı birkaç deneme boyunca açık kalan sahte fs */
function busyFs(busyTimes) {
  const files = new Set(['yarim.mp4']);
  let left = busyTimes;
  return {
    files,
    existsSync: (f) => files.has(f),
    unlinkSync: (f) => {
      if (left-- > 0) { const e = new Error('EBUSY'); e.code = 'EBUSY'; throw e; }
      files.delete(f);
    },
  };
}

test('kapanışta yarım dosya, tutamaç bırakılana dek beklenip silinir', () => {
  const ffs = busyFs(3);
  const api = loadBlock(ffs);
  const proc = new EventEmitter();
  proc.exitCode = null;
  proc.signalCode = null;
  api.removePartial('yarim.mp4', proc);
  assert.strictEqual(api.pendingPartials.size, 1);
  // Zamanlayıcı çalışmadan uygulama kapanıyor: will-quit eşzamanlı siler
  api.flushPartialsSync(1500);
  assert.ok(!ffs.files.has('yarim.mp4'), 'yarım dosya kaldı');
  assert.strictEqual(api.pendingPartials.size, 0);
});

test('uygulama açıkken süreç kapanınca silinir', async () => {
  const ffs = busyFs(1);
  const api = loadBlock(ffs);
  const proc = new EventEmitter();
  proc.exitCode = null;
  proc.signalCode = null;
  api.removePartial('yarim.mp4', proc);
  proc.emit('close', null, 'SIGTERM');
  await new Promise((r) => setTimeout(r, 500));
  assert.ok(!ffs.files.has('yarim.mp4'));
});

test('silinemeyen dosya kapanışı en çok verilen süre kadar bekletir', () => {
  const ffs = busyFs(Infinity);
  const api = loadBlock(ffs);
  api.removePartial('yarim.mp4', null);
  const t0 = Date.now();
  api.flushPartialsSync(300);
  const took = Date.now() - t0;
  assert.ok(took >= 250 && took < 1500, 'süre ' + took);
  assert.ok(ffs.files.has('yarim.mp4'));
});

test('dışa aktarım sonu ve will-quit yeni silme yolunu kullanır', () => {
  const fin = M.slice(M.indexOf('function finalizeExport('), M.indexOf("notifyAdmin('export-done'"));
  assert.match(fin, /removePartial\(out, proc\);/);
  assert.ok(!/setTimeout\(\(\) => \{ try \{ fs\.existsSync\(out\)/.test(fin), 'eski tek seferlik zamanlayıcı');
  const wq = M.slice(M.indexOf("app.on('will-quit', () => {"), M.indexOf('if (pendingExitCode) app.exit(pendingExitCode);'));
  assert.match(wq, /flushPartialsSync\(1500\);/, 'app.exit öncesinde silinmeli');
});
