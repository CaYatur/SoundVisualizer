'use strict';
/* README EKRAN GÖRÜNTÜSÜ ÜRETİCİSİ (`--shots`).
 *
 * Geliştirme aracı ama ürettiği şey README'de yayınlanıyor. Görüntüler
 * ortak demo sesine geçirilip yeniden üretilirken (#560) üç kusur çıktı:
 *   - dört yayın sahnesi logosuz çıkıyordu: logo şablonun logo katmanına
 *     ulaşmıyordu;
 *   - metin sahnesinde bir önceki sahnenin başlığı soluk duruyordu:
 *     şablonun 2,5 sn'lik geçişi bitmeden çekiliyordu;
 *   - tam koşu, ayrıca üretilmiş iki MilkDrop görselini ezerdi.
 * Ses tarafı demo-audio.test.js'te.
 */
global.window = global.window || {};
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
require('../src/shared/defaults.js');
const SV = global.window.SV;
const T = require('../src/shared/templates.js');

const SRC = fs.readFileSync(path.join(__dirname, '..', 'src', 'main', 'main.js'), 'utf-8').replace(/\r\n/g, '\n');
const env = { defaultConfig: SV.defaultConfig, deepMerge: SV.deepMerge, clone: SV.clone };
const tpl = (id) => T.TEMPLATES.find((x) => x.id === id);
const logoLayers = (cfg) => (cfg.layers || []).filter((l) => l && l.kind === 'logo');
const LOGO = 'data:image/svg+xml;base64,QUJD';

test('yayın kartı parçayı ve kapağı Çalan Parça katmanından çiziyor; üretici onu elle besliyor', () => {
  /* Kart şablonları (10.10) logo ve iki metin katmanı yerine tek bir
     "Çalan Parça" katmanı taşıyor: kapak yazının yanına motor tarafından
     yerleşiyor. Katman sistemden okuyor; README üretiminde çalan parça yok,
     üretici katmanı elle yazılan parçaya ve kapağa çeviriyor. */
  for (const id of ['bc-label', 'bc-line', 'bc-minimal', 'bc-amber']) {
    assert.ok(tpl(id), id + ' yok');
    const cfg = T.apply(SV.defaultConfig(), tpl(id), env);
    const np = (cfg.layers || []).filter((l) => l && l.kind === 'nowplaying');
    assert.strictEqual(np.length, 1, id + ' tek kart katmanı taşımalı');
    const c = np[0].settings.nowplaying;
    assert.strictEqual(c.coverOverlay, true, id);
    assert.strictEqual(c.source, 'system', id);
  }
  assert.match(SRC, /const NP_POST = '\(cfg\.layers\|\|\[\]\)\.forEach\(function\(l\)\{' \+/);
  assert.match(SRC, /'l\.settings\.nowplaying\.source="manual";' \+/);
  assert.match(SRC, /artwork: SHOT_LOGO \}\)/);
  assert.match(SRC, /if \(!\(await applyTemplate\(id, over, postFor\(over\)\)\)\) continue;/);
  assert.strictEqual((SRC.match(/applyTemplate\(id, over, postFor\(over\)\)/g) || []).length, 2, 'sahneler ve vitrin klibi');
});

test('üretici logoyu tabandan veriyor ve sahne geçişini kapatıyor', () => {
  const a = SRC.indexOf('  const applyTemplate = async (id, over, post) => {');
  const b = SRC.indexOf('\n  };', a);
  assert.ok(a > 0 && b > a, 'applyTemplate bulunamadı');
  const body = SRC.slice(a, b);
  assert.match(body, /const from = over && over\.logo && over\.logo\.src\s*\? Object\.assign\(\{\}, base, \{ logo: Object\.assign\(\{\}, base\.logo, \{ src: over\.logo\.src \}\) \}\)\s*: base;/);
  assert.match(body, /'var base=' \+ JSON\.stringify\(from\) \+ ';'/, 'şablona taban yerine başka bir şey veriliyor');
  /* Geçiş kapalı: `amb-aurora` 2,5 sn'lik geçiş kuruyor, metin sahnesi 2 sn
     sonra çekiliyordu — önceki sahne hâlâ ~%10 görünüyordu. */
  assert.match(body, /'cfg\.transition=Object\.assign\(\{\},cfg\.transition,\{enabled:false\}\);'/);
  const aurora = T.apply(SV.defaultConfig(), tpl('amb-aurora'), env);
  assert.ok(aurora.transition.duration > 2, 'dayanak: şablon uzun geçiş kuruyor (' + aurora.transition.duration + ')');
});

test('tam koşu özenle üretilmiş iki MilkDrop görselini ezmiyor', () => {
  /* README'nin MilkDrop fotoğrafı ve GIF'i kendi presetlerimizden ayrıca
     üretildi (GIF Sonsuz Tünel'den, 11 fps, iki geçişli palet); şablon yolu
     onları başka ayarlarla ezerdi. Adıyla istenince yine üretiliyor. */
  const line = (re) => { const m = re.exec(SRC); assert.ok(m, re + ' yok'); return m[0]; };
  const defs = [/const want = \(name\) => [^\n]+/, /const CURATED = new Set\([^\n]+/,
    /const wantShot = \(name\) => [^\n]+/].map(line).join('\n');
  const wantShot = (only) => new Function('SHOTS_ONLY', defs + '\nreturn wantShot;')(only);
  assert.strictEqual(wantShot('')('scene-milkdrop.png'), false, 'tam koşu fotoğrafı ezdi');
  assert.strictEqual(wantShot('')('demo-milkdrop.gif'), false, 'tam koşu GIF\'i ezdi');
  assert.strictEqual(wantShot('')('scene-tunnel.png'), true);
  // `--only=scene-` de fotoğrafla eşleşiyor; yalnız açıkça "milkdrop" deyince
  assert.strictEqual(wantShot('scene-')('scene-milkdrop.png'), false, 'geniş süzgeç ezdi');
  assert.strictEqual(wantShot('scene-')('scene-tunnel.png'), true);
  assert.strictEqual(wantShot('milkdrop')('scene-milkdrop.png'), true, 'açıkça istenince üretilmeli');
  assert.strictEqual(wantShot('milkdrop')('demo-milkdrop.gif'), true);
  assert.strictEqual(wantShot('milkdrop')('scene-tunnel.png'), false);
  assert.match(SRC, /for \(const \[id, name, settle, over\] of SCENES\) \{\s*if \(!wantShot\(name\)\) continue;/);
  assert.match(SRC, /for \(const \[id, name, frames, delay, width\] of GIFS\) \{\s*if \(!wantShot\(name\)\) continue;/);
});
