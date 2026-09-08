'use strict';
/* MilkDrop kalite ayarları: ağ sıklığı, iç çözünürlük ve fare girdisi
 * (#560 maddeleri 7, 1 ve 5).
 *
 * Üçü de sessizce kaybolabilecek türden: ayar arayüzde durur, motora hiç
 * ulaşmaz ve hiçbir hata çıkmaz — kullanıcı yalnızca "değişmiyor" görür.
 * Panelden preset seçmenin sahneyi değiştirmemesi tam olarak böyle bir
 * hataydı. Bu yüzden zincirin her halkası ayrı sabitleniyor. */
global.window = global.window || {};
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const SV = require('../src/shared/defaults.js');
const MD = require('../src/shared/milkdrop.js');

const CODE = fs.readFileSync(
  path.join(__dirname, '..', 'src', 'visualizer', 'modes', 'milkdrop.js'), 'utf-8')
  .replace(/\/\*[\s\S]*?\*\//g, ' ')
  .replace(/(^|[^:])\/\/[^\n]*/g, '$1 ');

test('varsayılanlar: ağ sıklığı ve iç çözünürlük tanımlı', () => {
  const d = (SV.defaultConfig ? SV.defaultConfig() : global.window.SV.defaultConfig());
  assert.strictEqual(d.milkdrop.mesh, 64);
  assert.strictEqual(d.milkdrop.renderScale, 1);
});

test('motor: ağ sıklığı ayardan okunuyor ve 4:3 oranı korunuyor', () => {
  /* MilkDrop'un kendi listesi de böyle: en-boy sabit, yalnız yoğunluk
     değişiyor. Y'yi bağımsız bırakmak preset koordinatlarını bozardı. */
  assert.match(CODE, /cfg\.milkdrop\.mesh/);
  assert.match(CODE, /Math\.round\(mx \* 0\.75\)/);
});

test('motor: ağ değişince tamponlar yeniden kuruluyor', () => {
  /* Köşe dizisi, indis tamponu ve vertex dizisinin boyutu ağ sayısından
     türüyor; eskisini kullanmaya devam etmek diziyi taşırırdı. */
  const i = CODE.indexOf('_applyMesh(cfg)');
  assert.ok(i > 0, '_applyMesh çağrılmalı');
  assert.match(CODE, /deleteVertexArray\(this\.vao\)[\s\S]{0,200}_buildMesh\(\)/);
});

test('motor: ağ yalnızca bilinen adımlara ayarlanabiliyor', () => {
  /* Ayar dosyası elle düzenlenebiliyor. 4000 gibi bir sayı yazılırsa
     düğüm başına preset denklemi koşan motor donardı. */
  assert.match(CODE, /MESH_STEPS/);
  assert.match(CODE, /MESH_STEPS\.indexOf/);
});

test('motor: iç çözünürlük çarpanı sınırlanıyor', () => {
  /* Maliyet çarpanın KARESİ kadar; sınırsız bırakmak makineyi kilitler. */
  assert.match(CODE, /Math\.max\(0\.5, Math\.min\(2,[^)]*renderScale/);
});

test('motor: iç çözünürlük üst sınırı (maxSize) hâlâ kesiyor', () => {
  /* Çarpan büyük bir ekranda sınırı aşarsa ölçek geri kısmalı; yoksa
     4K ekranda 2x, 8K render demek olurdu. */
  assert.match(CODE, /const sc = Math\.min\(1, cap \/ Math\.max\(1, Math\.max\(RW, RH\)\)\)/);
});

test('fare: değişkenler kare girdilerine giriyor', () => {
  assert.match(CODE, /mouse_x: this\.mouse\.x/);
  assert.match(CODE, /mouse_down: this\.mouse\.down/);
});

test('fare: alt bloklara da paylaşılıyor', () => {
  /* Kare geneli değişkenler custom dalga ve şekil havuzlarına taşınıyor;
     taşınmayan bir ad orada sessizce sıfır kalır. */
  const p = new MD.Preset(
    'wavecode_0_enabled=1\nwavecode_0_per_point1=x = mouse_x;\n', { seed: 1 });
  p.frame({ time: 0, frame: 1, fps: 30, mouse_x: 0.25, mouse_y: 0.75, mouse_down: 1 });
  assert.strictEqual(p.get('mouse_x'), 0.25);
  assert.strictEqual(p.get('mouse_down'), 1);
  const w = p.waves[0];
  assert.ok(w, 'dalga ayrıştırılmalı');
  p.waveFrame(w);
  assert.strictEqual(w.pool.get('mouse_x'), 0.25,
    'fare durumu dalga havuzuna taşınmalı');
});

test('fare: dinleyiciler tuvale bağlanıyor, pencereye değil', () => {
  /* Görselleştirici tuvali bir katman içinde de olabiliyor; pencere
     koordinatı o durumda yanlış olurdu. */
  assert.match(CODE, /c\.addEventListener\('mousemove'/);
  assert.match(CODE, /getBoundingClientRect/);
});

/* --- Preset geçişi (#560, madde 4) ------------------------------------- */

test('varsayılanlar: preset geçişi kapalı başlıyor', () => {
  /* Geçiş, eski görüntüyü DONMUŞ bir kare olarak eritiyor; MilkDrop'un iki
     preseti birden koşturan geçişi değil. Varsayılan kapalı, çünkü uzun
     geçişlerde bu fark görünür. */
  const d = (SV.defaultConfig ? SV.defaultConfig() : global.window.SV.defaultConfig());
  assert.strictEqual(d.milkdrop.blendTime, 0);
});

test('motor: geçiş süresi 3 saniyeyle sınırlanıyor', () => {
  assert.match(CODE, /Math\.max\(0, Math\.min\(3, \+[^)]*blendTime/);
});

test('motor: ilk yüklemede geçiş başlamıyor', () => {
  /* Önceki kare yokken donmuş siyah bir kareyi karıştırmak açılışı
     karartırdı. */
  assert.match(CODE, /if \(this\.presetKey && this\.preset && bt > 0 && this\.snapReady\)/);
});

test('motor: anlık görüntü yalnız geçiş açıkken alınıyor', () => {
  /* Her karede tam ekran bir doku kopyası, özelliği kullanmayan kullanıcıya
     bedava olmayan bir maliyet olurdu. */
  assert.match(CODE, /if \(bt <= 0\) \{ this\.snapReady = false;/);
});

test('motor: anlık görüntü dokusu RGB8 — varsayılan tamponla aynı biçim', () => {
  /* Tuval `alpha: false` ile açılıyor, yani varsayılan tamponda alfa kanalı
     yok. RGBA8 bir hedefe kopyalamak INVALID_OPERATION veriyor ve hata
     SESSİZ: doku boş kalıyor, geçiş ekranı karartıyordu. */
  assert.match(CODE, /gl\.RGB8, GW, GH, 0,\s*\n?\s*gl\.RGB, gl\.UNSIGNED_BYTE, null/);
  assert.match(CODE, /copyTexSubImage2D/);
  assert.ok(!/copyTexImage2D\(/.test(CODE), 'biçimsiz kopya kullanılmamalı');
});

test('motor: geçiş dokusu ve programı serbest bırakılıyor', () => {
  assert.match(CODE, /deleteTexture\(this\.snapTex\)/);
  assert.match(CODE, /deleteProgram\(this\.fadeProg\)/);
});

test('blur: min/max presetten okunuyor, yoksa MilkDrop varsayılanı', () => {
  /* Preset `b1n`/`b1x` yazıp shader'ında `blur1_min`/`blur1_max` diye geri
     okuyabiliyor. Sabit 0/1 vermek ona kendi yazdığından başka bir sayı
     döndürüyordu. Havuzun doğal başlangıcı ise ikisi için de 0 ve
     `b1x = 0` "bulanık kopyayı sıfırla çarp" demek: GetBlur okuyan her
     satır siyaha düşerdi. */
  const w = new MD.Preset('b1n=0.400\nb1x=0.700\n', { seed: 1 });
  assert.strictEqual(w.get('b1n'), 0.4);
  assert.strictEqual(w.get('b1x'), 0.7);
  const d = new MD.Preset('fDecay=0.9\n', { seed: 1 });
  assert.strictEqual(d.get('b1n'), 0);
  assert.strictEqual(d.get('b1x'), 1);
  assert.strictEqual(d.get('b3x'), 1);
  assert.match(CODE, /this\.preset\.get\(bkey\[i\] \+ 'n'\)/);
});
