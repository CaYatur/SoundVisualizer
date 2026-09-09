'use strict';
/* MILKDROP'UN KENDİ TAYFI.
 *
 * `spectrum = 1` yazan bir özel dalga MilkDrop'ta `0,15 * scaling *
 * wave_scale` ile çarpılan bir tayf değeri görüyor. O değerin BÜYÜKLÜĞÜ
 * MilkDrop'un kendi FFT'sinden geliyor; motorun kullandığı 0..1'e
 * normalleştirilmiş dizi ise bambaşka bir ölçekte. Kaynak doğru olsa bile
 * ölçek yanlış olunca dalga doğru biçimde yanlış büyüklükte çiziliyor.
 *
 * Burada ölçeğin kendisi sınanıyor, "kod yazılmış mı" değil: pencere ve
 * eşitleyici katsayıları kaynaktaki formüllerden yeniden hesaplanıp
 * karşılaştırılıyor, dönüşümün normalleştirilmemiş olduğu Parseval ile
 * doğrulanıyor, ve genliğin doğrusal olduğu ölçülüyor.
 *
 * Zincir (pluginshell.cpp AnalyzeNewSound + fft.cpp):
 *   ±128 örnek -> iki katsayılı yumuşatma -> 576'lık Hann penceresi ->
 *   1024 noktalı FFT (576'dan sonrası sıfır, 1/N YOK) -> 512 göz * eşitleyici
 */
const test = require('node:test');
const assert = require('node:assert');
const A = require('../src/shared/milkdrop-audio.js');

const IN = A.SPEC_IN;   // 576
const N = A.SPEC_N;     // 1024
const OUT = A.SPEC_OUT; // 512

const bytes = (fn) => {
  const tb = new Uint8Array(2048);
  for (let i = 0; i < tb.length; i++) {
    tb[i] = Math.max(0, Math.min(255, Math.round(128 + fn(i))));
  }
  return tb;
};

test('boyutlar MilkDrop\'un sabitleri', () => {
  /* FFT m_fftobj{NUM_AUDIO_BUFFER_SAMPLES, NUM_FREQUENCIES} = FFT(576, 512),
     yani m_numFrequencies = 512*2 = 1024 ve çıkış 512 göz. */
  assert.strictEqual(IN, 576);
  assert.strictEqual(N, 1024);
  assert.strictEqual(OUT, 512);
});

test('pencere: 576 örneklik Hann (envelopePower = 1)', () => {
  const s = new A.MilkdropSpectrum();
  for (const i of [0, 1, 143, 288, 575]) {
    const want = 0.5 + 0.5 * Math.sin(i * (2 * Math.PI / IN) - Math.PI / 2);
    assert.ok(Math.abs(s._env[i] - want) < 1e-6, 'env[' + i + ']');
  }
  assert.ok(s._env[0] < 1e-6, 'pencere sıfırdan başlıyor');
  assert.ok(Math.abs(s._env[288] - 1) < 1e-6, 'ortada 1');
});

test('eşitleyici: -0,02 * ln((512 - i) / 512)', () => {
  const s = new A.MilkdropSpectrum();
  for (const i of [0, 1, 256, 400, 511]) {
    const want = -0.02 * Math.log((OUT - i) / OUT);
    // Tablo Float32Array: MilkDrop da float tutuyor, bu yüzden tolerans 1e-7
    assert.ok(Math.abs(s._eq[i] - want) < 1e-7, 'eq[' + i + ']');
  }
  /* eq[0] TAM OLARAK sıfır: ln(1) = 0. Yani her tayf dalgasının ilk
     örneği sıfırdır. Hata değil, eşitleyicinin tanımından çıkıyor —
     bunu sonradan "bug" sanıp düzeltmeye kalkmamak için yazılı. */
  // eq[0] işaretli sıfır (-0.02 * 0), bu yüzden Math.abs ile karşılaştırılıyor
  assert.ok(Math.abs(s._eq[0]) === 0);
  assert.ok(Math.abs(s._eq[511] - 0.124766) < 1e-5, 'en üst göz ~0,1248');
});

test('ilk göz her zaman sıfır', () => {
  const s = new A.MilkdropSpectrum();
  const o = s.update(bytes((i) => 100 * Math.sin(i * 0.3)));
  assert.ok(Math.abs(o[0]) === 0);
});

test('sessizlik sıfır tayf veriyor', () => {
  const s = new A.MilkdropSpectrum();
  const tb = new Uint8Array(2048).fill(128);
  const o = s.update(tb);
  for (let i = 0; i < OUT; i++) assert.ok(Math.abs(o[i]) === 0, 'göz ' + i);
});

test('kısa/boş girdi çökmüyor', () => {
  const s = new A.MilkdropSpectrum();
  for (const bad of [null, undefined, new Uint8Array(0), new Uint8Array(4)]) {
    const o = s.update(bad);
    assert.strictEqual(o.length, OUT);
    for (let i = 0; i < OUT; i++) assert.ok(Math.abs(o[i]) === 0, 'göz ' + i);
  }
});

test('genlik doğrusal: girdiyi iki katlamak çıktıyı iki katlıyor', () => {
  /* Eşik tepe değere göre: bayta yuvarlama küçük gözlerde nicemleme
     gürültüsü bırakıyor ve o gürültü genlikle doğrusal ölçeklenmiyor. */
  const s = new A.MilkdropSpectrum();
  const a = Float32Array.from(s.update(bytes((i) => 30 * Math.sin(i * 0.21))));
  const b = s.update(bytes((i) => 60 * Math.sin(i * 0.21)));
  let mx = 0;
  for (let i = 1; i < OUT; i++) if (a[i] > mx) mx = a[i];
  let checked = 0;
  for (let i = 1; i < OUT; i++) {
    if (a[i] < mx * 0.05) continue;
    assert.ok(Math.abs(b[i] / a[i] - 2) < 0.05, 'göz ' + i + ': ' + (b[i] / a[i]));
    checked++;
  }
  assert.ok(checked >= 3, 'yeterince göz sınandı: ' + checked);
});

test('dönüşüm NORMALLEŞTİRİLMEMİŞ — Parseval 1/N olmadan tutuyor', () => {
  /* MilkDrop'un FFT'si 1/N ile bölmüyor ve 0,15 çarpanı tam da bu ölçeğe
     göre seçilmiş. Bölseydik tayf dalgaları 1024 kat küçük çizilirdi.
     Parseval: sum|X[k]|^2 = N * sum|x[n]|^2 (pencereli girdi üzerinden). */
  const s = new A.MilkdropSpectrum();
  s.update(bytes((i) => 50 * Math.sin(i * 0.37) + 20 * Math.sin(i * 1.1)));
  let spec = 0;
  for (let k = 0; k < N; k++) spec += s._re[k] * s._re[k] + s._im[k] * s._im[k];
  let time = 0;
  for (let i = 0; i < IN; i++) {
    const v = s._w[i] * s._env[i];
    time += v * v;
  }
  assert.ok(time > 0, 'girdi enerjisi sıfır olamaz');
  assert.ok(Math.abs(spec / (N * time) - 1) < 1e-3,
    'oran ' + (spec / (N * time)).toFixed(6));
});

test('tepe gözü sinyalin frekansında', () => {
  const s = new A.MilkdropSpectrum();
  // ornek basina 0,1 cevrim -> 1024 noktali donusumde 102. goz
  const o = s.update(bytes((i) => 100 * Math.sin(2 * Math.PI * 0.1 * i)));
  let mx = 0, at = 0;
  for (let i = 1; i < OUT; i++) if (o[i] > mx) { mx = o[i]; at = i; }
  assert.ok(Math.abs(at - 102) <= 2, 'tepe göz ' + at);
});

test('büyüklük ±128 biriminde — pencere toplamına göre', () => {
  /* Tek frekanslı bir sinüste tepe |X| ~ A * sum(env) / 2. Hann için
     sum(env) = 576/2 = 288, yani tepe ~ A * 144, eşitleyiciyle çarpılmış.
     Bu bağ ±128 biriminin korunduğunun kanıtı: örnekler 0..1'e
     indirgenseydi sonuç 128 kat küçük olurdu. */
  const s = new A.MilkdropSpectrum();
  const amp = 100;
  const o = s.update(bytes((i) => amp * Math.sin(2 * Math.PI * 0.1 * i)));
  let mx = 0, at = 0;
  for (let i = 1; i < OUT; i++) if (o[i] > mx) { mx = o[i]; at = i; }
  const bound = amp * 144 * s._eq[at];
  assert.ok(mx > bound * 0.75 && mx < bound * 1.05,
    'tepe ' + mx.toFixed(2) + ' beklenen ~' + bound.toFixed(2));
});

test('iki katsayılı yumuşatma: ilk örnek kendisiyle ortalanıyor', () => {
  /* MilkDrop old_i'yi sıfırdan başlatıyor, yani w[0] değişmeden geçiyor. */
  const s = new A.MilkdropSpectrum();
  const tb = new Uint8Array(2048).fill(128);
  tb[0] = 228; tb[1] = 128;
  s.update(tb);
  assert.strictEqual(s._w[0], 100, 'ilk örnek 0,5*(100+100)');
  assert.strictEqual(s._w[1], 50, 'ikinci örnek 0,5*(0+100)');
});

test('çıkış tamponu yeniden kullanılıyor', () => {
  /* Kare başına 512 elemanlık bir dizi ayırmak 60 fps\'te bedava değil. */
  const s = new A.MilkdropSpectrum();
  const a = s.update(bytes((i) => 10 * Math.sin(i)));
  const b = s.update(bytes((i) => 20 * Math.sin(i)));
  assert.strictEqual(a, b);
});
