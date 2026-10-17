'use strict';
/* STUDIO'DA YENİ PRESET VARSAYILANLARI ARAYÜZ DİLİNDE.
 *
 * İngilizce arayüzde "+ Shader" yeni görselleştiriciyi "Yeni Görselleştirici"
 * adıyla açıyordu; değişiklikleri at onayı da bu adı gösteriyordu. Ad, etiket
 * ve şablonun başlık yorumu kullanıcının kendi düzenlenebilir metni oluyor
 * ve editör onu çevirmiyor; bu yüzden oluşturulurken çevriliyorlar (#759 gibi).
 */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const read = (p) => fs.readFileSync(path.join(__dirname, '..', p), 'utf8').replace(/\r\n/g, '\n');
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

const studio = read('src/admin/studio.js');
const fnBody = (name) => {
  const i = studio.indexOf('function ' + name + '(');
  assert.ok(i >= 0, name + ' bulunamadı');
  return studio.slice(i, studio.indexOf('\n  }\n', i));
};

test('yeni shader ve varyasyon adları ile etiketi çevrilerek yazılıyor', () => {
  const d = dictionary();
  const shader = fnBody('newShader');
  const variation = fnBody('newVariation');
  assert.match(shader, /name: trStudio\(kind === 'background' \? 'Yeni Arkaplan' : 'Yeni Görselleştirici'\)/);
  assert.match(shader, /label: trStudio\('Miktar'\)/);
  assert.match(shader, /shader: starterShader\(\)/);
  assert.match(variation, /name: trStudio\(kind === 'background' \? 'Arkaplan Varyasyonum' : 'Görselleştiricim'\)/);
  for (const k of ['Yeni Arkaplan', 'Yeni Görselleştirici', 'Miktar', 'Arkaplan Varyasyonum', 'Görselleştiricim']) {
    assert.ok(d.has(k), 'çevirisi yok: ' + k);
  }
});

test('şablon başlık yorumunun Türkçe her satırının İngilizcesi var', () => {
  const d = dictionary();
  const m = /const STARTER_HEADER = \[([\s\S]*?)\];/.exec(studio);
  assert.ok(m, 'STARTER_HEADER bulunamadı');
  const lines = [...m[1].matchAll(/'((?:[^'\\]|\\.)*)'/g)].map((x) => x[1]);
  assert.ok(lines.length >= 6);
  for (const l of lines) {
    assert.ok(l.startsWith('//'), 'yorum değil: ' + l);
    if (!/[^\x00-\x7f]|[a-z]+ [a-z]+ [a-z]/i.test(l.replace(/sv_\w+(\(x\))?,?/g, ''))) continue;
    const en = d.get(norm(l));
    assert.ok(en, 'çevirisi yok: ' + l);
    assert.ok(en.startsWith('//'), 'çeviri yorum olarak kalmalı: ' + en);
    // Hizalı kolonlar korunsun: "->" aynı sütunda
    if (l.includes('->')) assert.strictEqual(en.indexOf('->'), l.indexOf('->'), en);
  }
  assert.ok(!/STARTER_SHADER/.test(studio), 'eski sabit şablon kalmamalı');
});

test('i18n sözlüğünde yinelenen anahtar yok (yeni satırlar)', () => {
  const src = read('src/shared/i18n.js');
  for (const k of ['// Kendi görselleştiricin.', '// Kullanabileceklerin:', 'Yeni Görselleştirici']) {
    const n = src.split("'" + k + "':").length - 1;
    assert.strictEqual(n, 1, k + ' ' + n + ' kez');
  }
});

/* Öz testin "çevrilmemiş metin" taraması kullanıcının kendi adlarını
   (ör. kaydedilmiş "A Yeni Görselleştirici") işaretliyordu. Kullanıcı içeriği
   genel bir öznitelikle hariç tutulur; tek tek metin istisnası yok. */
test('öz test çeviri taraması kullanıcı içeriği özniteliklerini atlıyor', () => {
  const main = read('src/main/main.js');
  const i = main.indexOf("untranslated string(s) in English UI");
  const scan = main.slice(main.lastIndexOf('createTreeWalker(document.getElementById', i) - 1500, i);
  assert.match(scan, /closest\('\[data-user-attr\],\[data-user-text\]'\)\) continue;/);
  assert.match(scan, /hasAttribute\('data-user-text'\)\) skipIt = true;/);
  assert.doesNotMatch(scan, /Yeni Görselleştirici/, 'metne özel istisna olmamalı');
});

test('Studio listesi kendi preset adlarını kullanıcı içeriği olarak işaretliyor', () => {
  assert.match(studio, /class: 'si-name', text: p\.builtin \? trStudio\(p\.name\) : p\.name, \.\.\.\(p\.builtin \? \{\} : \{ 'data-user-text': '' \}\)/);
  assert.match(studio, /\.\.\.\(p\.builtin \? \{\} : \{ 'data-user-attr': '' \}\)/);
});

test('dokunulmamış yeni taslak atılırken onay sorulmuyor', () => {
  const body = fnBody('startDraft');
  assert.match(body, /dirty = false;/);
  assert.doesNotMatch(body, /dirty = true/);
  const confirm = fnBody('confirmDiscard');
  assert.match(confirm, /if \(!dirty \|\| !draft\) return true;/);
  // Kaydedilmemiş yeni taslakta Kaydet yine vurgulu
  assert.match(studio, /class: 'btn ' \+ \(dirty \|\| !selectedId \? 'primary' : ''\)/);
});
