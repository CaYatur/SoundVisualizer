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

test('varsayılanlar: preset geçişi MilkDrop süresiyle açık', () => {
  /* Geçiş artık MilkDrop'un kendi çift boru hattı: eski preset donmuş bir
     kare değil, kendi denklemleri ve shader'larıyla koşmaya devam ediyor.
     Donmuş karenin kapalı tutulma sebebi bu yüzden ortadan kalktı.
     1,7 saniye MilkDrop'un `fBlendTimeUser` varsayılanı. */
  const d = (SV.defaultConfig ? SV.defaultConfig() : global.window.SV.defaultConfig());
  assert.strictEqual(d.milkdrop.blendTime, 1.7);
});

test('motor: geçiş süresi 5 saniyeyle sınırlanıyor', () => {
  /* MilkDrop'un varsayılanları 1,7 ve 2,7 sn; ini dosyasından daha uzunu
     da verilebiliyor. Sınır var, çünkü geçiş boyunca İKİ presetin
     denklemleri koşuyor. */
  assert.match(CODE, /const BLEND_MAX = 5;/);
  assert.match(CODE, /Math\.max\(0, Math\.min\(BLEND_MAX, \+c\.blendTime/);
});

test('motor: ilk yüklemede geçiş başlamıyor', () => {
  /* İlk yüklemede önceki preset diye bir şey yok. */
  assert.match(CODE, /if \(this\.presetKey && this\.preset && bt > 0\) \{/);
});

test('motor: eski presetin shader\'ları geçiş boyunca yaşıyor', () => {
  /* İki alan AYNI nesneyi gösteriyor. `_buildPresetShaders` ilk iş olarak
     `_releasePresetProgs()` çağırıp `this.warpPreset.prog`u siliyor, yani
     yeni yuva boşaltılmazsa eski presetin programları geçişin ta başında
     ölür. `useProgram` silinmiş programda INVALID_OPERATION verip hiçbir
     şey bağlamıyor: eski presetin çizimi o an bağlı olan başka bir
     programla yapılır ve ekranda görünen renk shader'dan değil geri
     besleme izinden gelir — yani gözle bakınca ÇALIŞIYOR görünür.

     Bu yüzden burada "eski yuvanın adı geçmiyor" değil, YENİ YUVANIN
     BOŞALTILDIĞI sınanıyor; ilki bu hatayı yakalamıyordu. */
  const branch = /if \(this\.presetKey && this\.preset && bt > 0\) \{[\s\S]*?\n      \}/.exec(CODE)[0];
  assert.match(branch, /this\.oldWarpPreset = this\.warpPreset;/);
  assert.match(branch, /this\.oldCompPreset = this\.compPreset;/);
  assert.match(branch, /this\.warpPreset = null;/, 'yeni yuva boşaltılmalı');
  assert.match(branch, /this\.compPreset = null;/, 'yeni yuva boşaltılmalı');
  const drop = /_dropOld\(\) \{[\s\S]*?\n    \}/.exec(CODE)[0];
  assert.match(drop, /deleteProgram\(this\.oldWarpPreset\.prog\)/);
  assert.match(drop, /deleteProgram\(this\.oldCompPreset\.prog\)/);
});

test('motor: donmuş kare eritmesi tümüyle kaldırıldı', () => {
  /* Eski geçiş önceki presetin SON KARESİNİ bir dokuya alıp üstüne
     soluyordu. Artık eski preset gerçekten koşuyor; anlık görüntü dokusu,
     onun programı ve kopyalama çağrısı geride kalmamalı. */
  for (const dead of ['snapTex', 'snapReady', 'fadeProg', 'FADE_FRAG']) {
    assert.ok(!CODE.includes(dead), dead + ' geride kalmış');
  }
  /* `copyTexSubImage2D` bu listede DEĞİL ve olmamalı: genel bir GL çağrısı,
     eski geçişe ait bir ad değil. Flaş sınırlayıcı gösterilen kareyi
     saklamak için onu kullanıyor. Yasaklamak, adı geçen mekanizmayı değil
     çağrının kendisini yasaklamak olurdu. Asıl güvence yukarıdaki dört ad;
     onlar durdukça donmuş kare yolu geri gelemez. */
  const kopya = (CODE.match(/copyTexSubImage2D/g) || []).length;
  assert.ok(kopya <= 1, 'copyTexSubImage2D yalnız flaş sınırlayıcıda olmalı');
  const fl = /_flashPass\(gl, fl, GW, GH\) \{[\s\S]*?\n    \}/.exec(CODE);
  assert.ok(fl && fl[0].includes('copyTexSubImage2D'),
    'tek kullanım flaş sınırlayıcıda değilse geçiş yolu geri gelmiş olabilir');
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
  assert.match(CODE, /P\.get\(bkey\[i\] \+ 'n'\)/);
});

test('göç: yeni anahtarları taşımayan eski ayar dosyası varsayılanları alıyor', () => {
  /* Mevcut kullanıcıların settings.json dosyasında mesh/renderScale/
     blendTime YOK — bu kural dışı değil, herkes için normal durum. Ayarlar
     varsayılanların üstüne birleştirilerek yükleniyor (admin.js), yani
     anahtarlar oradan geliyor. Birleştirme kaldırılırsa motora undefined
     ulaşır ve ayarlar ilk yükseltmede çalışmaz. */
  const SVw = global.window.SV;
  const eski = {
    milkdrop: { presetId: 'x', name: 'n', source: 's', autoNext: 0 },
    visualizer: { type: 'milkdrop' },
  };
  const merged = SVw.deepMerge(SVw.defaultConfig(), eski);
  assert.strictEqual(merged.milkdrop.mesh, 64);
  assert.strictEqual(merged.milkdrop.renderScale, 1);
  assert.strictEqual(merged.milkdrop.blendTime, 1.7);
  assert.strictEqual(merged.milkdrop.presetId, 'x', 'kullanıcının değeri korunmalı');
});
