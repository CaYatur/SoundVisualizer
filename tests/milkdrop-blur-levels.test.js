'use strict';
/* KAÇ BULANIK KOPYA ÜRETİLECEK.
 *
 * MilkDrop üç kademenin altı geçişini her karede koşmuyor; yalnızca o
 * karede bir shader'ın bağladığı en yüksek kademeye kadar gidiyor:
 *
 *     int passes = std::min(NUM_BLUR_TEX, m_nHighestBlurTexUsedThisFrame * 2);
 *
 * (milkdropfs.cpp:1410; kademe başına iki geçiş var, `*2` oradan. Sayaç
 * shader blur dokusu bağladığında yükseliyor (3695), `BlurPasses()`
 * sonunda sıfırlanıyor (1568).)
 *
 * Korpusun %28,7'si hiç `GetBlur` okumuyor — onlarda altı geçişin altısı
 * da boşa gidiyordu. Toplamda 62.082 geçişin 29.168'i (%47,0) gereksizdi.
 * Görüntü değişmiyor: üretilmeyen kademeyi hiçbir shader okumuyor.
 */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const CODE = fs.readFileSync(
  path.join(__dirname, '..', 'src', 'visualizer', 'modes', 'milkdrop.js'), 'utf-8');
const BARE = CODE
  .replace(/\/\*[\s\S]*?\*\//g, ' ')
  .replace(/(^|[^:])\/\/[^\n]*/g, '$1 ');

const RE = /const BLUR_REF = [^;]*;/.exec(BARE);
const FN = /function blurLevelOf\(text\) \{[\s\S]*?\n  \}/.exec(BARE);
assert.ok(RE && FN, 'blurLevelOf kaynaktan çıkarılamadı');
const blurLevelOf = new Function(RE[0] + FN[0] + '\nreturn blurLevelOf;')();

// ------------------------------------------------------------------ tarama

test('GetBlur yazmayan shader hiç kademe istemiyor', () => {
  assert.strictEqual(blurLevelOf('shader_body { ret = tex2D(sampler_main, uv).xyz; }'), 0);
  assert.strictEqual(blurLevelOf(''), 0);
  assert.strictEqual(blurLevelOf(null), 0);
});

test('en YÜKSEK kademe dönüyor — kademeler kaskat', () => {
  /* 3'ü okuyan preset 1 ve 2'yi de üretmek zorunda: her kademe bir
     öncekinden türüyor. MilkDrop'un `highest * 2`si de bunu söylüyor. */
  assert.strictEqual(blurLevelOf('ret = GetBlur1(uv);'), 1);
  assert.strictEqual(blurLevelOf('ret = GetBlur2(uv);'), 2);
  assert.strictEqual(blurLevelOf('ret = GetBlur3(uv);'), 3);
  assert.strictEqual(blurLevelOf('ret = GetBlur1(uv) + GetBlur3(uv);'), 3);
  assert.strictEqual(blurLevelOf('ret = GetBlur3(uv) + GetBlur1(uv);'), 3,
    'sıra fark etmemeli');
});

test('dokuyu doğrudan örnekleyen preset de sayılıyor', () => {
  /* `GetBlurN` bir kolaylık; preset dokuyu adıyla da okuyabiliyor. */
  assert.strictEqual(blurLevelOf('ret = tex2D(sampler_blur2, uv).xyz;'), 2);
});

test('ön ekli sampler adı da sayılıyor', () => {
  /* `sampler_pw_blur3` çeviride kanonik `sampler_blur3`e iniyor, yani doku
     gerçekten okunuyor. Korpusta örneği yok ama kaçırmanın bedeli
     üretilmemiş bir kademeyi örneklemek — siyah, ve sessiz. */
  for (const on of ['fw', 'pw', 'fc', 'pc']) {
    assert.strictEqual(blurLevelOf('tex2D(sampler_' + on + '_blur3, uv)'), 3,
      on + ' ön eki kaçtı');
  }
  assert.strictEqual(blurLevelOf('tex2D(sampler_pw_blur1, uv)'), 1);
});

test('büyük-küçük harf ayrımı yok', () => {
  assert.strictEqual(blurLevelOf('ret = getblur2(uv);'), 2);
  assert.strictEqual(blurLevelOf('ret = GETBLUR3(uv);'), 3);
});

test('art arda çağrılar birbirini etkilemiyor', () => {
  /* Düzenli ifade `g` bayraklı ve modül düzeyinde duruyor: `lastIndex`
     sıfırlanmazsa ikinci çağrı ilkinin kaldığı yerden arardı ve sessizce
     0 dönerdi. */
  assert.strictEqual(blurLevelOf('GetBlur3(uv)'), 3);
  assert.strictEqual(blurLevelOf('GetBlur3(uv)'), 3);
  assert.strictEqual(blurLevelOf('GetBlur1(uv)'), 1);
  assert.strictEqual(blurLevelOf('GetBlur1(uv)'), 1);
});

test('GetBlur0 kademe istemiyor — o sampler_main', () => {
  assert.strictEqual(blurLevelOf('ret = GetBlur0(uv);'), 0);
});

// ------------------------------------------------------------- bağlanışı

test('tarama presetin KENDİ metninde, çevrilmiş GLSL\'de değil', () => {
  /* `GetBlur1..3` yardımcıları her zaman ön hazırlıkta duruyor, yani
     çıktıda `sampler_blur1` her preset için görünür — GLSL'i taramak
     elemeyi tamamen etkisiz kılardı. */
  assert.match(BARE, /blurLevel: blurLevelOf\(text\)/,
    'blurLevelOf çeviriden ÖNCEKİ metinle çağrılmalı');
  assert.doesNotMatch(BARE, /blurLevelOf\(r\.glsl\)/);
});

test('geçişte eski presetin aşamaları da sayılıyor', () => {
  /* Geçiş sırasında dört aşama birden çiziyor. Yalnızca yeni presete
     bakmak, eski presetin okuduğu kademeyi üretilmemiş bırakır ve geçiş
     boyunca o preset bulanığını kaybeder. */
  const need = BARE.slice(BARE.indexOf('_blurNeed()'));
  assert.match(need, /lv\(this\.warpPreset\)/);
  assert.match(need, /lv\(this\.compPreset\)/);
  assert.match(need, /lv\(this\.oldWarpPreset\)/);
  assert.match(need, /lv\(this\.oldCompPreset\)/);
});

test('döngü ve mipmap üretimi aynı sınıra bağlı', () => {
  /* Mipmapı sınırlamayı unutmak, üretilmeyen kademede sürücüye boşuna
     iş verirdi — görüntü doğru, kazanç yarım kalırdı. */
  const fn = BARE.slice(BARE.indexOf('_buildBlur(srcTex, need)'));
  assert.match(fn, /for \(let i = 0; i < levels; i\+\+\) \{\s*const b = this\.blur\[i\]/);
  assert.match(fn, /for \(let i = 0; i < levels; i\+\+\) \{\s*gl\.bindTexture\(gl\.TEXTURE_2D, this\.blur\[i\]\.out\.tex\)/);
});

test('sınır blur dizisinin boyuna kenetleniyor, need yoksa hepsi', () => {
  /* MilkDrop da `std::min(NUM_BLUR_TEX, ...)` diyor. `need` verilmemesi
     eski maliyet demek, yanlış görüntü değil — çağıranı unutmanın bedeli
     sessiz bir hata olmamalı. */
  const fn = BARE.slice(BARE.indexOf('_buildBlur(srcTex, need)'));
  assert.match(fn, /Math\.max\(0, Math\.min\(this\.blur\.length, need\)\)/);
  assert.match(fn, /: this\.blur\.length;/);
  assert.match(fn, /if \(levels === 0\) return;/);
});
