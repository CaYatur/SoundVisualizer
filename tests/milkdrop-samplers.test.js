'use strict';
/* MilkDrop'un SÜZME/SARMA TÜREVLERİ (sampler_fw_ / _pw_ / _fc_ / _pc_).
 *
 * MilkDrop aynı dokuyu farklı süzme ve sarma ayarlarıyla ayrı adlarla
 * sunuyor: ilk harf süzme (p=noktasal, f=süzülmüş), ikincisi sarma
 * (w=tekrarlı, c=kenetli). Çevirici bu ön eki SOYUYORDU, yani
 * `sampler_pw_main` ile `sampler_main` aynı uniform'a düşüp aynı
 * örneklemeyi alıyordu.
 *
 * Ölçüm (10.332 presetlik korpus):
 *   - %38,3'ü en az bir ön ekli sampler kullanıyor
 *   - %22,7'si AYNI dokuyu FARKLI ön eklerle okuyor — iki ayrı sonuç
 *     bekleyip tek sonuç alıyordu
 *   - tek başına `sampler_pw_main` 6.310 yerde geçiyor
 *
 * Bu, derleme ölçümünde HİÇ GÖRÜNMÜYORDU: shader'lar hatasız derleniyordu,
 * yalnızca yanlış dokudan okuyorlardı.
 *
 * Birim bütçesi de ölçüldü: bir preset en fazla ALTI ayrı birim istiyor
 * (10.332 içinde üç tane). 0–9 yerleşiklere ayrılı, 10–15 türevlere
 * kalıyor ve WebGL2'nin asgari garantisi olan 16'ya tam oturuyor.
 */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const T = require('../src/shared/milkdrop-shader.js');

const CODE = fs.readFileSync(
  path.join(__dirname, '..', 'src', 'visualizer', 'modes', 'milkdrop.js'), 'utf-8')
  .replace(/\/\*[\s\S]*?\*\//g, ' ')
  .replace(/(^|[^:])\/\/[^\n]*/g, '$1 ');

// --------------------------------------------------------------- çeviri

test('çeviri: dört ön ek kombinasyonu da doğru çözülüyor', () => {
  const plan = (s) => T.translate('shader_body { ret = tex2D(' + s + ', uv); }').samplerPlan[0];
  assert.deepStrictEqual(
    ['fw', 'pw', 'fc', 'pc'].map((p) => {
      const e = plan('sampler_' + p + '_main');
      return e.filter + '/' + e.wrap;
    }),
    ['linear/repeat', 'nearest/repeat', 'linear/clamp', 'nearest/clamp']);
});

test('çeviri: türev kendi uniform adıyla bildiriliyor', () => {
  const r = T.translate('shader_body { ret = tex2D(sampler_pc_noise_lq, uv); }');
  assert.match(r.glsl, /uniform sampler2D sampler_pc_noise_lq;/);
  // Gövdedeki çağrı da türev adını korumalı; soyulsa uniform kullanılmazdı
  assert.match(r.glsl, /tex2D\(sampler_pc_noise_lq, uv\)/);
});

/* Türev, dokunun KENDİSİNİ değiştirmiyor — yalnızca nasıl okunduğunu.
   `canon` yanlış olursa preset bambaşka bir dokudan okur. */
test('çeviri: türevin kanonik dokusu doğru', () => {
  const r = T.translate(
    'shader_body { ret = tex2D(sampler_fc_noisevol_hq, uv) + tex2D(sampler_pw_blur2, uv); }');
  const byName = {};
  for (const p of r.samplerPlan) byName[p.name] = p.canon;
  assert.deepStrictEqual(byName, {
    sampler_fc_noisevol_hq: 'sampler_noisevol_hq',
    sampler_pw_blur2: 'sampler_blur2',
  });
});

// ------------------------------------------------------------ motor bağlama

/* En yıkıcı sessiz hata: bir yazımın uniform konumu ayarlanıp dokusu
   bağlanmamak (ya da tersi). Bağlanmamış bir sampler 0. birimi —
   `sampler_main`'i — okur, shader derlenir, ekranda makul bir şey çıkar ve
   hiçbir yerde hata görünmez. Bu yüzden iki döngü de AYNI listeyi
   (`L._plan`) gezmek zorunda. */
test('motor: uniform ayarı ve doku bağlama aynı listeyi geziyor', () => {
  const uni = /for \(const e of L\._plan\) if \(e\.loc\) gl\.uniform1i\(e\.loc, e\.p\.unit\)/;
  assert.match(CODE, uni, 'uniform1i döngüsü L._plan üzerinde olmalı');
  const bindBlock = /_bindTextures\(mainTex, L\)[\s\S]*?const plan = \(L && L\._plan\) \|\| \[\][\s\S]*?for \(const e of plan\)/;
  assert.match(CODE, bindBlock, 'bağlama döngüsü de L._plan üzerinde olmalı');
});

/* Sampler NESNESİ birime bağlanınca o birimde dokunun kendi
   parametrelerini EZER. 0. birimde `_bindMain` sarmayı presetin `wrap`
   ayarından kuruyor; oraya sampler nesnesi bağlanırsa o mantık sessizce
   ölür ve `wrap=0` yazan presetler kenardan sarmaya devam eder. */
test('motor: yerleşik birimlere sampler nesnesi bağlanmıyor', () => {
  assert.match(CODE,
    /if \(e\.p\.unit < SAMPLER_UNITS\.length\) continue;/,
    'kanonik birime düşen girdi atlanmalı');
});

/* Sampler nesnesi bağlı kaldığı sürece o birimdeki HER dokuyu etkiliyor.
   Önceki presetten kalan bağ, yeni presetin aynı birimi başka bir ayarla
   kullanmasında sessizce yanlış örnekleme verirdi. */
test('motor: ayrılabilir aralık her bağlamada temizleniyor', () => {
  assert.match(CODE,
    /for \(let unit = SAMPLER_UNITS\.length; unit < \(this\.unitMax \|\| 16\); unit\+\+\) \{\s*gl\.bindSampler\(unit, null\);/,
    'kullanılmayan birimlerdeki sampler bağları temizlenmeli');
});

/* Birim biterse bağlanmamış bırakmak değil, KANONİK birime düşmek gerekiyor:
   doku doğru kalır, yalnız süzme yaklaşık olur — yani eski davranış. */
test('motor: birim bütçesi bitince kanonik birime düşülüyor', () => {
  assert.match(CODE, /if \(next < max\) unit = next\+\+;/);
  assert.match(CODE, /unit = canonUnit\[p\.canon\] !== undefined \? canonUnit\[p\.canon\] : 4;/);
});

/* Sınır sürücüden sorulmalı. Sabit 16 yazmak, daha fazlasını veren bir
   sürücüde gereksiz yere kanonik birime düşürürdü. */
test('motor: doku birimi sınırı sürücüden okunuyor', () => {
  assert.match(CODE, /gl\.getParameter\(gl\.MAX_TEXTURE_IMAGE_UNITS\)/);
});

test('motor: dört süzme/sarma kombinasyonu için sampler nesnesi var', () => {
  for (const k of ["'linear|repeat'", "'linear|clamp'", "'nearest|repeat'", "'nearest|clamp'"]) {
    assert.ok(CODE.indexOf(k) >= 0, k + ' sampler nesnesi tanımlı olmalı');
  }
});
