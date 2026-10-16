'use strict';
/* STUDIO İÇE AKTARMA METİNLERİ ARAYÜZ DİLİNDE (#759).
 *
 * İçe aktarıcılar (presets.js: fromMilk, fromShadertoy, fromISF) dil
 * bilmiyor ve Türkçe kaynak metin üretiyor. Açıklama, kayıttan sonra
 * kullanıcının kendi düzenlenebilir metni oluyor ve editör onu çevirmeden
 * gösteriyor: İngilizce arayüzde Türkçe kalıyordu. Notlar da Türkçe bir
 * bildirime birleştiriliyordu; birleşik cümle sözlükte hiç eşleşmez.
 */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const read = (p) => fs.readFileSync(path.join(__dirname, '..', p), 'utf8');
const norm = (v) => String(v).replace(/\s+/g, ' ').trim();

function dictionary() {
  const src = read('src/shared/i18n.js');
  const body = src.slice(src.indexOf('const EN = {'), src.indexOf('const EN_NORMALIZED'));
  const STR = "'((?:[^'\\\\]|\\\\.)*)'";
  const re = new RegExp(STR + '\\s*:\\s*' + STR, 'g');
  const unesc = (s) => s.replace(/\\(.)/g, '$1');
  const map = new Map();
  let m;
  while ((m = re.exec(body))) map.set(norm(unesc(m[1])), unesc(m[2]));
  return map;
}

function importers() {
  const saved = global.window;
  global.window = {};
  delete require.cache[require.resolve('../src/shared/presets.js')];
  require('../src/shared/presets.js');
  const S = global.window.SVPresets;
  if (saved === undefined) delete global.window; else global.window = saved;
  return S;
}

test('içe aktarıcıların ürettiği açıklama ve notların İngilizcesi var', () => {
  const S = importers();
  const d = dictionary();
  const milk = S.fromMilk('fZoom=1.01\nnWaveMode=2', 'x');
  const toy = S.fromShadertoy('void mainImage(out vec4 o, in vec2 f){ o = texture(iChannel0, f) + texture(iChannel2, f); }', 'y');
  const isf = S.fromISF('/*{"ISFVSN":"2","INPUTS":[],"PASSES":[{},{}]}*/ void main(){ gl_FragColor = vec4(1.0); }', 'z');
  const texts = [];
  for (const r of [milk, toy, isf]) {
    assert.ok(r.ok, JSON.stringify(r));
    texts.push(r.preset.description);
    texts.push(...(r.notes || []));
  }
  assert.ok(texts.length >= 5, 'notlar üretilmeli: ' + texts.length);
  for (const t of texts) assert.ok(d.has(norm(t)), 'çevirisi yok: ' + t);
});

test('ISF giriş adı taşıyan not desenle çevriliyor', () => {
  const src = read('src/shared/i18n.js');
  const m = /\.replace\((\/\^"\(\.\+\)" görsel girişi medya katmanına bağlandı\\\.\$\/), '([^']+)'\)/.exec(src);
  assert.ok(m, 'desen kuralı bulunamadı');
  const re = new RegExp('^"(.+)" görsel girişi medya katmanına bağlandı\\.$');
  assert.strictEqual('"inputImage" görsel girişi medya katmanına bağlandı.'.replace(re, m[2]),
    '"inputImage" image input is bound to the media layer.');
  // Üretilen not desene uyuyor
  const S = importers();
  const isf = S.fromISF('/*{"ISFVSN":"2","INPUTS":[{"NAME":"inputImage","TYPE":"image"}]}*/ void main(){ gl_FragColor = IMG_NORM_PIXEL(inputImage, isf_FragNormCoord); }', 'z');
  assert.ok((isf.notes || []).some((n) => re.test(n)), JSON.stringify(isf.notes));
});

test('Studio açıklamayı kayıttan ÖNCE çeviriyor, notları parça parça', () => {
  const src = read('src/admin/studio.js');
  const i = src.indexOf("result.preset.description = trStudio(result.preset.description || '');");
  assert.ok(i > 0, 'açıklama çevrilmeli');
  assert.ok(i < src.indexOf('const saveRes = await window.api.savePreset(result.preset);'), 'kayıttan önce');
  assert.match(src, /const note = \(result\.notes \|\| \[\]\)\.map\(trStudio\)\.join\(' '\);/);
  assert.match(src, /P\(\)\.toast\(trStudio\('İçe aktarıldı\.'\) \+ \(note \? ' ' \+ note : ''\), 'ok'\);/);
  assert.match(src, /P\(\)\.toast\(trStudio\('İçe aktarıldı, ama shader derlenmiyor\. Hata editörde gösteriliyor\.'\)/);
});
