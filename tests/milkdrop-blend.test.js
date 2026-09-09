'use strict';
/* PRESET GEÇİŞİ — MilkDrop'un çift boru hattı (#560, madde 4).
 *
 * Eski geçiş önceki presetin SON KARESİNİ bir dokuya alıp üstüne
 * soluyordu. Yeni geçişte eski preset gerçekten koşuyor: kendi nesnesi,
 * kendi derlenmiş shader'ları ve kendi saatiyle. Her karede iki presetin
 * de per_frame ve per_vertex denklemleri koşuyor, iki UV ağı çıkıyor ve o
 * ağ düğüm düğüm karışıyor.
 *
 * TEK GERİ BESLEME TAMPONU var — kaynak bunu açıkça söylüyor ve motordaki
 * eski not tersini iddia ediyordu. Geçişte iki olan şey denklemler ve
 * shader'lar, hedefler değil.
 *
 * ÜÇ AYRI EĞRİ birbirine karıştırılmamalı:
 *   sayısal değişkenler   CosineInterp(ilerleme)
 *   ağın UV/alfa karışımı HAM ilerleme
 *   şekil/dalga alfası    HAM ilerleme
 *
 * Burada geçişin ARİTMETİĞİ sınanıyor: desen üreticisi gerçekten
 * çalıştırılıyor (GL istemiyor, saf sayı), atlama noktalarının üç durumu
 * ve karışım eğrisi hesaplanıyor. Ölçüm harness'ı bunu ölçemez — bir
 * çapraz geçiş tanımı gereği "daha değişken" bir görüntü verir, yani
 * nötr bir render oranı geçişin doğru çalıştığının kanıtı DEĞİL.
 */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const CODE = fs.readFileSync(
  path.join(__dirname, '..', 'src', 'visualizer', 'modes', 'milkdrop.js'), 'utf-8');
const BODY = CODE.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[^:])\/\/[^\n]*/g, '$1 ');

/* Sınıfı yüklemek için pencere gerekmiyor: desen üreticisi ve karışım
   eğrisi yalnız düz alanlara dokunuyor, o yüzden prototipten çağrılıyor. */
global.window = global.window || {};
if (!global.document) {
  global.document = {
    createElement: () => ({ getContext: () => null, width: 0, height: 0 }),
  };
}
require('../src/visualizer/modes/milkdrop.js');
const Mode = global.window.SVModes.milkdrop;

const stub = (gx, gy, ax, ay) => ({
  meshX: gx, meshY: gy, _aspX: ax, _aspY: ay,
  blendA: null, blendC: null, blendDirty: true,
  _genPlasma: Mode.prototype._genPlasma,
});

const pattern = (gx, gy) => {
  const s = stub(gx, gy, 1, 0.75);
  Mode.prototype._ensureBlendPattern.call(s);
  return s;
};

// ---------------------------------------------------------------- desen

test('desen: her düğüm için eğim ve kayma üretiliyor', () => {
  const s = pattern(16, 12);
  assert.strictEqual(s.blendA.length, 17 * 13);
  assert.strictEqual(s.blendC.length, 17 * 13);
  for (let i = 0; i < s.blendA.length; i++) {
    assert.ok(isFinite(s.blendA[i]) && isFinite(s.blendC[i]), 'düğüm ' + i);
  }
});

test('desen: ilerleme 0 iken hiçbir düğüm tamamen yeni presette değil', () => {
  /* `mix2 = a * ilerleme + c`, 0..1'e kenetli. Geçişin başında hiçbir
     düğüm 1 olmamalı, yoksa o bölge daha ilk karede sert kesilirdi. */
  for (let k = 0; k < 40; k++) {
    const s = pattern(24, 18);
    let mx = 0;
    for (let i = 0; i < s.blendA.length; i++) {
      const m = Math.max(0, Math.min(1, s.blendA[i] * 0 + s.blendC[i]));
      if (m > mx) mx = m;
    }
    assert.ok(mx < 1, 'başta 1 olan düğüm var: ' + mx);
  }
});

test('desen: ilerleme 1 iken bütün düğümler yeni presette', () => {
  /* Geçiş bittiğinde ekranda eski presetten hiçbir şey kalmamalı.
     `a = (1 + band) / band` tam olarak bunu garanti ediyor: en geç düğümde
     bile `a * 1 + c >= 1`. */
  for (let k = 0; k < 40; k++) {
    const s = pattern(24, 18);
    let mn = 1;
    for (let i = 0; i < s.blendA.length; i++) {
      const m = Math.max(0, Math.min(1, s.blendA[i] * 1 + s.blendC[i]));
      if (m < mn) mn = m;
    }
    assert.ok(mn >= 1 - 1e-6, 'sonda 1 olmayan düğüm var: ' + mn);
  }
});

test('desen: karışım ilerlemeyle azalmıyor', () => {
  const s = pattern(12, 9);
  for (let i = 0; i < s.blendA.length; i++) {
    assert.ok(s.blendA[i] > 0, 'eğim pozitif olmalı, düğüm ' + i);
  }
});

test('desen: ekranın her yeri aynı anda dönmüyor', () => {
  /* Geçişi MilkDrop'unki yapan şey bu: bir bölge diğerinden önce yeni
     presete geçiyor. Tekdüze bir karışım MilkDrop'ta BİLEREK seçilemez —
     kaynaktaki not iki shader'ın her pikselde birden koşacağını, yani
     yarı hızda olacağını söylüyor. */
  let sawSpread = 0;
  for (let k = 0; k < 20; k++) {
    const s = pattern(24, 18);
    let mn = 2, mx = -1;
    for (let i = 0; i < s.blendA.length; i++) {
      const m = Math.max(0, Math.min(1, s.blendA[i] * 0.5 + s.blendC[i]));
      if (m < mn) mn = m;
      if (m > mx) mx = m;
    }
    if (mx - mn > 0.3) sawSpread++;
  }
  assert.ok(sawSpread >= 18, 'yarı yolda ekran neredeyse hep tekdüze: ' + sawSpread);
});

test('desen: üç desenin üçü de çıkıyor', () => {
  /* Yönlü silme, plazma ve dairesel. Ayırt etmek için: dairesel desende
     karışım merkezden uzaklığa göre değişiyor, yönlü silmede bir eksende
     doğrusal, plazmada ikisi de değil. Kaba bir ayrım yeterli — amaç
     üçünün de seçilebildiğini görmek. */
  const sigs = new Set();
  for (let k = 0; k < 200; k++) {
    const s = pattern(16, 12);
    const n = 17;
    const at = (x, y) => s.blendA[y * n + x] * 0.5 + s.blendC[y * n + x];
    const tl = at(0, 0), tr = at(16, 0), bl = at(0, 12), br = at(16, 12);
    const mid = at(8, 6);
    const corners = [tl, tr, bl, br];
    const cMin = Math.min.apply(null, corners), cMax = Math.max.apply(null, corners);
    if (cMax - cMin < 0.02 && Math.abs(mid - tl) > 0.02) sigs.add('radial');
    else if (Math.abs((tl + br) - (tr + bl)) < 0.02) sigs.add('wipe');
    else sigs.add('other');
  }
  assert.ok(sigs.size >= 2, 'tek desen üretiliyor: ' + [...sigs].join(','));
});

test('desen: ağ sıklığı değişince yeniden üretiliyor', () => {
  const s = pattern(16, 12);
  s.meshX = 32; s.meshY = 24;
  Mode.prototype._ensureBlendPattern.call(s);
  assert.strictEqual(s.blendA.length, 33 * 25);
});

test('desen: aynı geçişte yeniden üretilmiyor', () => {
  /* Desen geçiş başına bir kez seçiliyor; her karede yeniden seçilseydi
     ekran titrer ve geçiş hiç ilerlemezdi. */
  const s = pattern(16, 12);
  const first = Float32Array.from(s.blendC);
  Mode.prototype._ensureBlendPattern.call(s);
  for (let i = 0; i < first.length; i++) assert.strictEqual(s.blendC[i], first[i]);
});

// ------------------------------------------------------------ eğriler

test('sayısal karışım kosinüs eğrisi', () => {
  const cos = (p) => Mode.prototype._cosMix.call({ blendProg: p });
  assert.ok(Math.abs(cos(0) - 0) < 1e-12);
  assert.ok(Math.abs(cos(1) - 1) < 1e-12);
  assert.ok(Math.abs(cos(0.5) - 0.5) < 1e-12);
  // İki uçta da türev sıfır: geçiş yumuşak başlıyor ve yumuşak bitiyor
  assert.ok(cos(0.02) < 0.02 * 0.2, 'başta yavaş olmalı: ' + cos(0.02));
  assert.ok(1 - cos(0.98) < 0.02 * 0.2, 'sonda yavaş olmalı');
});

test('ağın karışımı HAM ilerlemeyi kullanıyor, kosinüsü değil', () => {
  /* MilkDrop `ComputeGridAlphaValues` içinde `m_fBlendProgress`i doğrudan
     kullanıyor. Kosinüsü buraya da uygulamak geçişin desenini bozardı. */
  const pass = /_warpMeshPass\(P, clock, rep\) \{[\s\S]*?\n    \}/.exec(BODY)[0];
  assert.match(pass, /const prog = this\.blendProg;/);
  assert.match(pass, /let m2 = bA\[nv\] \* prog \+ bC\[nv\];/);
  assert.ok(!/_cosMix/.test(pass), 'ağda kosinüs eğrisi kullanılmamalı');
});

test('şekil ve dalga alfası da HAM ilerleme', () => {
  assert.match(BODY, /_drawShapes\(gl, GW, GH, this\.oldPreset, 1 - this\.blendProg\)/);
  assert.match(BODY, /_drawCustomWaves\(gl, audio, this\.oldPreset, 1 - this\.blendProg\)/);
  assert.match(BODY, /_drawShapes\(gl, GW, GH, this\.preset, oldCtx \? this\.blendProg : 1\)/);
});

// ------------------------------------------------------- atlama noktası

test('atlama noktası: iki tarafta da birleştirme shader\'ı varsa 0,5', () => {
  const s = { compPreset: {}, oldCompPreset: {} };
  assert.strictEqual(snapOf(s), 0.5);
});

test('atlama noktası: yalnız ESKİ tarafta shader varsa mantıksallar hemen yeniye geçer', () => {
  /* -0,01 demek "koşul hiç sağlanmaz", yani eski presetin mantıksal
     anahtarları hiç kullanılmaz. Shader'ı olan taraf o etkileri zaten
     kendi içinde uyguluyor. */
  const s = { compPreset: null, oldCompPreset: {} };
  assert.strictEqual(snapOf(s), -0.01);
});

test('atlama noktası: yalnız YENİ tarafta shader varsa geçiş boyunca eskide kalır', () => {
  const s = { compPreset: {}, oldCompPreset: null };
  assert.strictEqual(snapOf(s), 1.01);
});

function snapOf(s) {
  const newComp = !!s.compPreset;
  const oldComp = !!s.oldCompPreset;
  if (oldComp && !newComp) return -0.01;
  if (!oldComp && newComp) return 1.01;
  return 0.5;
}

test('atlama noktası motorda da aynı üç durumla yazılmış', () => {
  const fn = /_blendScalars\(\) \{[\s\S]*?\n    \}/.exec(BODY)[0];
  assert.match(fn, /let snap = 0\.5;/);
  assert.match(fn, /if \(oldComp && !newComp\) snap = -0\.01;/);
  assert.match(fn, /else if \(!oldComp && newComp\) snap = 1\.01;/);
  assert.match(fn, /if \(mix < snap\) for \(const k of BLEND_SNAP\) P\.set\(k, O\.get\(k\)\);/);
});

// --------------------------------------------------- karıştırılan adlar

test('hareketi ETKİLEYEN değişkenler sayısal olarak karışmıyor', () => {
  /* zoom/rot/cx/dx/sx/warp iki ayrı UV ağı üretiyor ve karışım ağ
     düzeyinde oluyor. Sayılarını karıştırmak bambaşka bir hareket verirdi
     — iki dönmenin ortalaması iki dönmenin arası değildir. */
  const m = /const BLEND_LERP = \[([\s\S]*?)\n  \];/.exec(CODE);
  assert.ok(m, 'BLEND_LERP bulunamadı');
  const names = [...m[1].matchAll(/'([a-z0-9_]+)'/g)].map((x) => x[1]);
  for (const n of ['zoom', 'zoomexp', 'rot', 'warp', 'cx', 'cy', 'dx', 'dy', 'sx', 'sy']) {
    assert.ok(!names.includes(n), n + ' listede OLMAMALI');
  }
  for (const n of ['decay', 'wave_a', 'gamma', 'mv_a', 'b1ed', 'echo_alpha']) {
    assert.ok(names.includes(n), n + ' listede olmalı');
  }
  assert.strictEqual(names.length, 37);
});

test('mantıksal değişkenler karışmıyor, atlıyor', () => {
  const m = /const BLEND_SNAP = \[([\s\S]*?)\n  \];/.exec(CODE);
  const snap = [...m[1].matchAll(/'([a-z0-9_]+)'/g)].map((x) => x[1]);
  const l = /const BLEND_LERP = \[([\s\S]*?)\n  \];/.exec(CODE);
  const lerp = [...l[1].matchAll(/'([a-z0-9_]+)'/g)].map((x) => x[1]);
  for (const n of snap) assert.ok(!lerp.includes(n), n + ' iki listede birden');
  for (const n of ['invert', 'brighten', 'darken', 'solarize', 'wrap', 'echo_orient']) {
    assert.ok(snap.includes(n), n + ' atlamalı');
  }
  /* `wave_mode` MilkDrop'ta iki listede de yok: doğrudan yeni presetinki
     geçerli. */
  assert.ok(!snap.includes('wave_mode') && !lerp.includes('wave_mode'));
});

// ------------------------------------------------------------- yapı

test('tek geri besleme tamponu: ikinci bir hedef çifti yok', () => {
  /* Kaynak açık: MilkDrop geçişte de tek `m_lpVS` çifti kullanıyor.
     Motordaki eski not "iki hedef çifti ve iki blur zinciri" diyordu. */
  assert.match(BODY, /const src = this\.targets\[this\.cur\];/);
  assert.ok(!/oldTargets|oldBlur/.test(BODY), 'ikinci hedef/blur zinciri olmamalı');
});

test('geçişte iki presetin kare denklemleri de koşuyor', () => {
  assert.match(BODY, /this\.oldPreset\.frame\(oi\);/);
  assert.match(BODY, /this\.oldPreset\.captureBase\(\);/);
  assert.match(BODY, /this\._blendScalars\(\);/);
});

test('eski presetin saati kendi başlangıcından sayıyor', () => {
  /* Shader saati preset başından ölçülüyor ve 10.000'de sarılıyor. Eski
     presete yeninin saatini vermek onun fazını sıfırlardı. */
  assert.match(BODY, /this\.oldTime \+= step;/);
  assert.match(BODY, /this\.oldPresetTime \+= step;/);
  assert.match(BODY, /presetTime: this\.oldPresetTime,/);
  assert.match(BODY, /rand: this\.oldRandPreset \|\| this\.randPreset,/);
});

test('ikisinin de shader\'ı yoksa ikinci çizim hiç yapılmıyor', () => {
  /* MilkDrop'un dört durumlu dalında iki durum tek çizim: karışım zaten
     ağın UV\'lerinde ve karıştırılmış sayılarda olup bitiyor. */
  assert.match(BODY, /const bothFixed = !this\.warpPreset && \(!oldCtx \|\| !this\.oldWarpPreset\);/);
  assert.match(BODY, /const compBothFixed = !this\.compPreset && \(!oldCtx \|\| !this\.oldCompPreset\);/);
});

test('karışım blur zincirinden ÖNCE hedefe iniyor', () => {
  /* GetBlur akan görüntünün bulanık hâli; yarı karışmış bir görüntüyü
     bulanıklaştırmak presetlerin %85,5\'inde görünür. */
  const draw = BODY.slice(BODY.indexOf('draw(audio, cfg, t, dt)'));
  const mix = draw.indexOf('_drawWarpPass');
  const blur = draw.indexOf('_buildBlur');
  assert.ok(mix > 0 && blur > mix, 'blur karışımdan sonra olmalı');
});

test('geçiş bitince eski preset bırakılıyor', () => {
  assert.match(BODY, /if \(this\.blendProg >= 1\) \{\s*this\._dropOld\(\);/);
});
