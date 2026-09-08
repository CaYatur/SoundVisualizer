'use strict';
/* MilkDrop KULLANICI DOKULARI (#560 madde 2).
 *
 * Presetler kendi görsellerini ada göre istiyor: `sampler_worms` yazan bir
 * preset doku klasöründe `worms.jpg` arıyor. Preset paketleri bu görselleri
 * GETİRMİYOR — ölçüm korpusunda (10.332 preset) tek bir resim dosyası yok.
 * Ölçülen talep:
 *   - %16,9'u (1.748 preset) en az bir kullanıcı dokusu istiyor
 *   - 66 ayrı doku adı; en çok isteneni `worms` (544 preset)
 *   - 242 preset `rand00..15` rastgele yuvalarını kullanıyor
 *
 * Klasör gösterilmediğinde gürültüye düşmek KASITLI: sert başarısızlık,
 * bugün yanlış-ama-çalışan 1.748 preseti siyah ekrana çevirirdi.
 */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const T = require('../src/shared/milkdrop-shader.js');
const TEX = require('../src/main/milkdrop-textures.js');

const CODE = fs.readFileSync(
  path.join(__dirname, '..', 'src', 'visualizer', 'modes', 'milkdrop.js'), 'utf-8')
  .replace(/\/\*[\s\S]*?\*\//g, ' ')
  .replace(/(^|[^:])\/\/[^\n]*/g, '$1 ');

// ------------------------------------------------------- yol kapsamı

/* Ad renderer'dan geliyor ve PRESET METNİNDEN türüyor — kullanıcının
   yazmadığı bir dize. Kapsam denetimi bu yüzden var. */
const DIR = path.join(os.tmpdir(), 'sv-tex-test');

test('doku yolu: klasördeki düz dosya kabul ediliyor', () => {
  assert.strictEqual(TEX.resolveTexture(DIR, 'worms.png'), path.join(DIR, 'worms.png'));
  assert.strictEqual(TEX.resolveTexture(DIR, 'Clouds.JPG'), path.join(DIR, 'Clouds.JPG'));
});

test('doku yolu: klasörden çıkan her ad reddediliyor', () => {
  for (const bad of [
    '../gizli.png',
    '..\\gizli.png',
    'alt/klasor.png',
    'alt\\klasor.png',
    '/etc/passwd.png',
    'C:\\Windows\\win.png',
    'C:win.png',
    '.',
    '..',
    '',
  ]) {
    assert.strictEqual(TEX.resolveTexture(DIR, bad), '', bad + ' reddedilmeliydi');
  }
});

test('doku yolu: görsel olmayan uzantı reddediliyor', () => {
  for (const bad of ['ayarlar.json', 'preset.milk', 'gizli', 'a.exe', 'b.txt']) {
    assert.strictEqual(TEX.resolveTexture(DIR, bad), '', bad + ' reddedilmeliydi');
  }
});

test('doku yolu: klasör ayarlanmamışsa hiçbir şey çözülmüyor', () => {
  assert.strictEqual(TEX.resolveTexture('', 'worms.png'), '');
  assert.strictEqual(TEX.resolveTexture(null, 'worms.png'), '');
});

test('doku yolu: MIME yalnız bilinen biçimler için', () => {
  assert.strictEqual(TEX.mimeFor('a.png'), 'image/png');
  assert.strictEqual(TEX.mimeFor('a.JPEG'), 'image/jpeg');
  assert.strictEqual(TEX.mimeFor('a.exe'), '');
});

/* Gerçek dosya sistemiyle bir kez: `path.relative` Windows'ta büyük/küçük
   harf ve kısa ad gibi ayrıntılar taşıyor, saf dize testleri yetmez. */
test('doku yolu: gerçek dosyada uçtan uca', () => {
  fs.mkdirSync(DIR, { recursive: true });
  const f = path.join(DIR, 'worms.png');
  fs.writeFileSync(f, Buffer.from([0x89, 0x50, 0x4e, 0x47]));
  try {
    const got = TEX.resolveTexture(DIR, 'worms.png');
    assert.ok(fs.existsSync(got));
    assert.strictEqual(path.resolve(got), path.resolve(f));
  } finally {
    fs.rmSync(f, { force: true });
  }
});

// ------------------------------------------------- texsize_<ad> uniform'u

/* MilkDrop presetin kendi satırını bağlıyor ve presetler tam olarak böyle
   yazıyor — gerçek koddan:
     `float4 texsize_lichen;  // auto-binds; .xy = (w,h); .zw = (1/w,1/h)`
   Bizde bu sıradan bir global kalıyordu, yani SIFIR. Sıfırla bölen bir
   preset hata vermiyor, sessizce yanlış çiziyor; derleme ölçümü de
   göremiyor, çünkü bildirim geçerli GLSL. */
test('çeviri: kullanıcı dokusunun boyutu uniform oluyor', () => {
  const r = T.translate(
    'float4 texsize_worms;\nshader_body { ret = tex2D(sampler_worms, uv * texsize_worms.zw); }');
  assert.deepStrictEqual(r.texSizeNames, ['texsize_worms']);
  assert.match(r.glsl, /uniform vec4 texsize_worms;/);
});

test('çeviri: presetin kendi texsize bildirimi siliniyor', () => {
  const r = T.translate(
    'float4 texsize_worms;\nshader_body { ret = tex2D(sampler_worms, uv * texsize_worms.zw); }');
  /* Kalsaydı uniform'u gölgeleyen, sıfır kalan bir global olurdu — hata
     vermeden yanlış çizen tam olarak o durum. */
  assert.doesNotMatch(r.glsl, /^\s*vec4 texsize_worms;/m);
  assert.strictEqual((r.glsl.match(/texsize_worms;/g) || []).length, 1);
});

test('çeviri: yerleşik dokunun boyutu listeye girmiyor', () => {
  // texsize_noise_lq PREAMBLE'da zaten uniform; ikinci kez bildirmek hata olurdu
  const r = T.translate('shader_body { ret = tex2D(sampler_noise_lq, uv * texsize_noise_lq.zw); }');
  assert.deepStrictEqual(r.texSizeNames, []);
});

test('çeviri: okunmayan texsize için uniform açılmıyor', () => {
  const r = T.translate('shader_body { ret = tex2D(sampler_worms, uv); }');
  assert.deepStrictEqual(r.texSizeNames, []);
  assert.doesNotMatch(r.glsl, /texsize_worms/);
});

// ----------------------------------------------------------- motor

/* Yükleme asenkron ve çizim döngüsü bekleyemez. Doku gelene kadar gürültü
   bağlı kalmalı; sert başarısızlık 1.748 preseti siyaha çevirirdi. */
test('motor: doku yoksa gürültüye düşülüyor', () => {
  assert.match(CODE, /const u = this\._userTexture\(canon\);\s*return u \? u\.tex : this\.noise\.lq\.tex;/);
});

/* İstek bir kez gönderiliyor: önbellekte `null` "istendi, gelmedi" demek.
   Ayırt edilmezse her kare yeni bir IPC isteği açılırdı. */
test('motor: bekleyen istek her karede tekrarlanmıyor', () => {
  assert.match(CODE, /const hit = this\.userTex\[base\];\s*if \(hit !== undefined\) return hit;/);
  assert.match(CODE, /this\.userTex\[base\] = null;/);
});

/* Liste asenkron geliyor. Liste gelmeden çizilen kareler "dosya yok" diye
   null yazmış olabilir; temizlenmezse klasör seçili olmasına rağmen preset
   sonsuza kadar gürültüde kalırdı. */
test('motor: doku listesi gelince önbellek tazeleniyor', () => {
  assert.match(CODE,
    /this\._texNames = \(r && Array\.isArray\(r\.names\)\) \? r\.names : \[\];\s*this\._dropUserTextures\(\);/);
});

/* Klasör değişince uçuştaki istekler geçersiz. Jeton denetlenmezse eski
   klasörden gelen bir görsel yenisinin üstüne yerleşirdi. */
test('motor: klasör değişince uçuştaki istekler geçersizleşiyor', () => {
  assert.match(CODE, /const token = \(this\._texToken = \(this\._texToken \|\| 0\) \+ 1\);/);
  assert.match(CODE, /if \(token !== this\._texToken\) return;/);
});

/* rand00..15 seçimi preset ve yuva başına belirlenmeli, kare başına değil:
   kare başına seçmek her karede başka bir görsel demek olurdu. */
test('motor: rastgele doku yuvası preset başına sabit', () => {
  assert.match(CODE, /const key = \(this\.presetKey \|\| ''\) \+ '\|' \+ slot;/);
  // rand00..15 yuvası tanınıyor mu (desen düz metin olarak aranıyor)
  assert.ok(CODE.indexOf('^rand(\\d\\d)') >= 0, 'rand yuva deseni bulunmalı');
});

/* MilkDrop'ta `rand00_smalltiled`, yalnız `smalltiled` ile başlayan
   dokulardan seçer. Süzgeç uygulanmazsa preset yazarının kastettiğinden
   bambaşka bir görsel gelir. */
test('motor: rastgele yuvanın ad süzgeci uygulanıyor', () => {
  assert.match(CODE, /pool = pref\s*\?\s*names\.filter\(\(f\) => f\.toLowerCase\(\)\.startsWith\(pref\)\)/);
});

/* Bağlı olan doku hangisiyse ONUN boyutu verilmeli. Gürültüye düşülmüşken
   görselin boyutunu vermek, presetin var olmayan tekselleri adreslemesine
   yol açardı. */
test('motor: texsize gerçekten bağlı olan dokunun boyutunu veriyor', () => {
  assert.match(CODE, /const w = \(u && u\.w\) \? u\.w : this\.noise\.lq\.size;/);
});
