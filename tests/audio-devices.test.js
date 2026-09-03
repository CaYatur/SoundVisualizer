'use strict';
/* Sistem sesini hangi aygıtın verdiğinin testleri.
 *
 * Bu testlerin varlık sebebi: kural üç platformda üç farklı ve bizde yalnız
 * Windows var. macOS ile Linux davranışını başka türlü sınayamayız — hata
 * ancak o platformdaki kullanıcıda, hem de sessizce ortaya çıkardı.
 *
 * En önemli iki test:
 *   - Linux'ta hoparlörün değil MONITOR kaynağının seçilmesi (eski kod
 *     hoparlörü seçip girişmiş gibi açmaya çalışıyordu),
 *   - macOS'ta sanal aygıt yokken MİKROFONA DÜŞÜLMEMESİ (kullanıcının
 *     saatlerce yanlış kaynağı dinlemesi demek olurdu).
 */
const test = require('node:test');
const assert = require('node:assert');

const D = require('../src/shared/audio-devices.js');

const dev = (name, kind, isDefault) => ({ id: name, name, kind, isDefault: !!isDefault, channels: 2 });

// ---------------------------------------------------------------- Windows
const WIN = [
  dev('Hoparlör (Realtek Audio)', 'output', true),
  dev('Kulaklık (USB)', 'output', false),
  dev('Mikrofon (Realtek Audio)', 'input', true),
];

test('Windows: çıkış aygıtları sistem sesini verir', () => {
  assert.strictEqual(D.isLoopbackDevice(WIN[0], 'win32'), true);
  assert.strictEqual(D.isLoopbackDevice(WIN[1], 'win32'), true);
});

test('Windows: mikrofon sistem sesi değildir', () => {
  assert.strictEqual(D.isLoopbackDevice(WIN[2], 'win32'), false);
});

test('Windows: varsayılan çıkış seçilir', () => {
  assert.strictEqual(D.pickDefault(WIN, 'win32').name, 'Hoparlör (Realtek Audio)');
});

test('Windows: varsayılan işaretli yoksa ilk çıkış seçilir', () => {
  const none = WIN.map((d) => Object.assign({}, d, { isDefault: false }));
  assert.strictEqual(D.pickDefault(none, 'win32').kind, 'output');
});

// ---------------------------------------------------------------- Linux
const LINUX = [
  dev('Built-in Audio Analog Stereo', 'output', true),
  dev('Monitor of Built-in Audio Analog Stereo', 'input', false),
  dev('Built-in Audio Analog Stereo Microphone', 'input', true),
];

test('Linux: monitor kaynağı sistem sesini verir', () => {
  assert.strictEqual(D.isLoopbackDevice(LINUX[1], 'linux'), true);
});

test('Linux: hoparlör çıkışı sistem sesi DEĞİLDİR', () => {
  /* Eski kodun hatası tam buydu: çıkış aygıtını seçip yakalamaya açmaya
     çalışıyordu. PulseAudio bunu yapmaz. */
  assert.strictEqual(D.isLoopbackDevice(LINUX[0], 'linux'), false);
});

test('Linux: mikrofon sistem sesi değildir', () => {
  assert.strictEqual(D.isLoopbackDevice(LINUX[2], 'linux'), false);
});

test('Linux: hoparlör değil MONITOR seçilir', () => {
  const picked = D.pickDefault(LINUX, 'linux');
  assert.strictEqual(picked.name, 'Monitor of Built-in Audio Analog Stereo');
  assert.strictEqual(picked.kind, 'input', 'monitor bir giriş aygıtıdır');
});

test('Linux: .monitor son ekli PipeWire adları da tanınır', () => {
  const d = dev('alsa_output.pci-0000_00_1f.3.analog-stereo.monitor', 'input', false);
  assert.strictEqual(D.isLoopbackDevice(d, 'linux'), true);
});

test('Linux: monitor yoksa nedeni söylenir', () => {
  const a = D.loopbackAdvice([LINUX[0], LINUX[2]], 'linux');
  assert.strictEqual(a.code, 'NO_LOOPBACK_LINUX');
  assert.match(a.message, /PipeWire|PulseAudio/);
});

// ---------------------------------------------------------------- macOS
const MAC_BARE = [
  dev('MacBook Pro Speakers', 'output', true),
  dev('MacBook Pro Microphone', 'input', true),
];
const MAC_BH = MAC_BARE.concat([dev('BlackHole 2ch', 'input', false)]);

test('macOS: çıplak sistemde sistem sesi yakalanamaz', () => {
  /* CoreAudio loopback vermez. Bu bir eksiklik değil, platformun kendisi. */
  assert.strictEqual(D.isLoopbackDevice(MAC_BARE[0], 'darwin'), false);
  assert.strictEqual(D.loopbackAdvice(MAC_BARE, 'darwin').code, 'NO_LOOPBACK_DARWIN');
});

test('macOS: eksiklik BlackHole kurmayı ADIYLA önerir', () => {
  const a = D.loopbackAdvice(MAC_BARE, 'darwin');
  assert.match(a.message, /BlackHole/, 'kullanıcıya ne yapacağı söylenmeli');
});

test('macOS: sanal aygıt varsa o seçilir', () => {
  assert.strictEqual(D.isLoopbackDevice(MAC_BH[2], 'darwin'), true);
  assert.strictEqual(D.pickDefault(MAC_BH, 'darwin').name, 'BlackHole 2ch');
  assert.strictEqual(D.loopbackAdvice(MAC_BH, 'darwin'), null);
});

test('macOS: sanal aygıt yokken MİKROFONA DÜŞÜLMEZ', () => {
  /* Sessizce mikrofonu dinlemek, kullanıcının hiç fark etmeden yanlış
     kaynağı görselleştirmesi demektir. Hoparlöre düşülür, açılış başarısız
     olur ve yukarıdaki uyarı gösterilir. */
  const picked = D.pickDefault(MAC_BARE, 'darwin');
  assert.notStrictEqual(picked.name, 'MacBook Pro Microphone');
  assert.strictEqual(picked.kind, 'output');
});

test('macOS: diğer yaygın sanal aygıtlar da tanınır', () => {
  for (const n of ['Soundflower (2ch)', 'Loopback Audio', 'VB-Cable', 'Existential Audio BlackHole 16ch']) {
    assert.strictEqual(D.isLoopbackDevice(dev(n, 'input'), 'darwin'), true, n);
  }
});

// ---------------------------------------------------------------- genel
test('markLoopback girdiyi değiştirmez', () => {
  const src = [dev('Hoparlör', 'output', true)];
  D.markLoopback(src, 'win32');
  assert.ok(!('loopback' in src[0]), 'kaynak dizi kirletilmemeli');
});

test('adsız/bozuk aygıt çökertmez', () => {
  assert.strictEqual(D.isLoopbackDevice(null, 'linux'), false);
  assert.strictEqual(D.isLoopbackDevice({}, 'linux'), false);
  assert.strictEqual(D.pickDefault([], 'linux'), null);
});

test('"monitor" kelimesi ada gömülü geçince yanlış eşleşmez', () => {
  /* "Monitörlü" gibi bir adın kelime sınırı olmadan eşleşmesi, Linux'ta
     yanlış aygıtın seçilmesine yol açardı. */
  assert.strictEqual(D.isLoopbackDevice(dev('Monitoring Headset', 'input'), 'linux'), false);
});
