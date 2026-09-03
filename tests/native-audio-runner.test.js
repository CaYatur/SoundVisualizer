'use strict';
/* Ses yardımcısını çalıştıran sürecin testleri.
 *
 * v3.1.1'den önce yardımcı SİSTEMDEKİ node ile çalışıyordu ve Windows
 * derlemesi bunun için 93 MB'lık bir node.exe taşıyordu. macOS ve Linux
 * derlemelerinde ise böyle bir şey yoktu: paketlenmiş uygulamada ses
 * hiç çalışmazdı.
 *
 * Artık çalıştırıcı uygulamanın KENDİ ikilisi: Electron ELECTRON_RUN_AS_NODE=1
 * ile node gibi davranır. Üç platformda da vardır, indirmeyi büyütmez ve
 * kullanıcıdan hiçbir kurulum istemez.
 *
 * Buradaki en önemli test sonuncusu: paketlenmiş bir uygulamada kullanıcıya
 * "Node.js kurun" demek ARTIK YANLIŞ TAVSİYE. Kurulum bozulmuşsa çare
 * yeniden kurmaktır, Node kurmak değil.
 */
const test = require('node:test');
const assert = require('node:assert');

const na = require('../src/main/native-audio.js');

test('kendi çalıştırıcımız uygulamanın ikilisidir', () => {
  const r = na.selfRunner();
  assert.strictEqual(r.kind, 'self');
  assert.strictEqual(r.exe, process.execPath, 'kendi ikilimizi kullanmalı');
  assert.strictEqual(r.env.ELECTRON_RUN_AS_NODE, '1', 'Electron node kipine alınmalı');
});

test('kendi çalıştırıcımız çağıranın ortamını bozmaz', () => {
  const before = process.env.ELECTRON_RUN_AS_NODE;
  na.selfRunner();
  assert.strictEqual(process.env.ELECTRON_RUN_AS_NODE, before,
    'process.env kopyalanmalı, yerinde değiştirilmemeli');
});

test('yedek çalıştırıcı node kipini DEVRALMAZ', () => {
  /* Aksi halde sistemdeki gerçek node, anlamadığı bir bayrakla çağrılırdı. */
  const r = na.externalRunner();
  assert.strictEqual(r.kind, 'external');
  assert.ok(!('ELECTRON_RUN_AS_NODE' in r.env), 'ELECTRON_RUN_AS_NODE silinmeli');
});

test('önce kendi ikilimiz denenir, sonra sistemdeki node', () => {
  const order = na.runnerOrder().map((r) => r.kind);
  assert.deepStrictEqual(order, ['self', 'external'],
    'kendi ikilimiz önce gelmezse harici Node bağımlılığı geri döner');
});

test('kendi ikilimiz başlatılamazsa hata "Node kurun" DEMEZ', () => {
  /* Bu testin varlık sebebi: paketlenmiş uygulamada Node hep vardır.
     Kullanıcıyı Node kurmaya yollamak onu çözümü olmayan bir işe sokar. */
  const e = na.classifyListError({
    helperExists: true,
    spawnError: { code: 'ENOENT', message: 'ENOENT' },
    runner: { kind: 'self' },
  });
  assert.strictEqual(e.code, 'RUNTIME_MISSING');
  assert.ok(!/install node/i.test(e.message), 'yanlış tavsiye: ' + e.message);
  assert.match(e.message, /reinstall/i, 'doğru çare yeniden kurmaktır');
});

test('yedek yolda node gerçekten yoksa eski tanı korunur', () => {
  const e = na.classifyListError({
    helperExists: true,
    spawnError: { code: 'ENOENT', message: 'ENOENT' },
    runner: { kind: 'external' },
  });
  assert.strictEqual(e.code, 'NODE_NOT_FOUND');
});

test('native ses motoru eksikse hata platformu adıyla söyler', () => {
  const e = na.classifyListError({
    helperExists: true,
    stderr: "Error: Cannot find module 'audify'",
    runner: { kind: 'self' },
  });
  assert.strictEqual(e.code, 'AUDIFY_MISSING');
  assert.ok(e.message.includes(process.platform + '-' + process.arch),
    'platform adı geçmeli, yoksa kullanıcı neyi bildireceğini bilemez: ' + e.message);
});

test('native ses motoru yüklenemiyorsa ayrı bir kod döner', () => {
  /* macOS .dylib / Linux .so arızaları "eksik" değildir: dosya vardır ama
     açılmaz. İkisini ayırmazsak kullanıcıya yanlış çözüm gösteririz. */
  for (const err of [
    'dlopen(/x/audify.node): image not found',
    'librtaudio.so.8: cannot open shared object file',
    'code signature not valid',
  ]) {
    const e = na.classifyListError({ helperExists: true, stderr: err, runner: { kind: 'self' } });
    assert.strictEqual(e.code, 'AUDIFY_LOAD_FAILED', 'şunda: ' + err);
    assert.ok(e.message.includes(process.platform), 'platform adı geçmeli');
  }
});

test('yardımcı dosyası yoksa çalıştırıcıdan bağımsız olarak bildirilir', () => {
  const e = na.classifyListError({ helperExists: false, runner: { kind: 'self' } });
  assert.strictEqual(e.code, 'HELPER_MISSING');
});
