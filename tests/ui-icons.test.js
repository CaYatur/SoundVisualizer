'use strict';
/* ARAYÜZ İKONLARI (#665).
 *
 * Arayüz emoji ve Unicode resim karakterleri yerine kendi ikon setini
 * (src/shared/icons.js) kullanıyor. Emoji işletim sisteminin renkli yazı
 * tipiyle çiziliyordu: panelin renklerine uymuyor, sisteme göre değişiyor
 * ve düğmenin satır yüksekliğini büyütüyordu.
 *
 * Bu test iki şeyi koruyor:
 *   - arayüz kodunda (yorumlar dışında) yeniden emoji yazılmıyor;
 *   - kodda adı geçen her ikon sette var (bilinmeyen ad sessizce nokta
 *     çizerdi).
 * Cümle içindeki oklar (→ ← ↑ ↓) ve nota/ölçü gösterimi (♩ ▮) ile ×
 * bilerek YAZI olarak kalıyor. */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');
const I = require('../src/shared/icons.js');

const PICTO = /[\p{Extended_Pictographic}\u{1F100}-\u{1F1FF}\u{2190}-\u{21FF}\u{2300}-\u{23FF}\u{25A0}-\u{25FF}\u{2600}-\u{27BF}\u{27F0}-\u{27FF}\u{2800}-\u{28FF}\u{2900}-\u{29FF}\u{2B00}-\u{2BFF}\u{3030}\u{FF0B}\u{FE0F}\u{2139}]/u;
const KEEP = /[→←↑↓♩▮×]/gu;

function uiFiles() {
  const out = [];
  const dir = (d, re) => fs.readdirSync(path.join(ROOT, d)).filter((f) => re.test(f)).forEach((f) => out.push(d + '/' + f));
  dir('src/admin', /\.(js|html|css)$/);
  dir('src/web', /\.(js|html)$/);
  out.push('src/visualizer/visualizer.js', 'src/visualizer/visualizer.css', 'src/visualizer/index.html',
    'src/shared/mode-catalog.js', 'src/shared/i18n.js', 'src/shared/icons.js');
  return out;
}

/* Yorumları atıp kod satırlarını verir (/* *\/, //, <!-- -->). Kaba ama bu
   dosyalarda yeterli: dize içinde yorum işareti geçen satır yok sayılmaz,
   yalnız yorum SANILIP atlanabilir; bu da testi gevşetir, sıkılaştırmaz. */
function codeLines(src) {
  const out = [];
  let inBlock = false;
  src.split(/\r?\n/).forEach((l, i) => {
    let code = l;
    if (inBlock) {
      const e = code.indexOf('*/');
      if (e < 0) return;
      code = code.slice(e + 2);
      inBlock = false;
    }
    code = code.replace(/\/\*.*?\*\//g, '').replace(/<!--.*?-->/g, '');
    const s = code.indexOf('/*');
    if (s >= 0) { inBlock = true; code = code.slice(0, s); }
    code = code.replace(/(^|[^:'"`\\])\/\/.*$/, '$1');
    out.push([i + 1, code]);
  });
  return out;
}

test('arayüz kodunda emoji ya da resim karakteri yok', () => {
  const bad = [];
  for (const f of uiFiles()) {
    for (const [n, code] of codeLines(read(f))) {
      if (PICTO.test(code.replace(KEEP, ''))) bad.push(f + ':' + n + ': ' + code.trim().slice(0, 90));
    }
  }
  assert.deepStrictEqual(bad, [], 'emoji kaldı:\n' + bad.join('\n'));
});

/* Koddaki ikon adları: `icon: …` ifadesi, data-icon, SVIcons.set/el/draw,
   yardımcıların ['ad', 'yazı'] dizileri ve *_ICONS tabloları. */
function usedNames() {
  const names = new Map();
  const add = (name, where) => { if (name) names.set(name, where); };
  // Karşılaştırmanın sağ yanı (x === 'clip') ve sınıf adları (svi-…) ikon adı değil
  const quoted = (s) => [...s.matchAll(/(?<![=!]==\s*)'([a-z][a-z0-9-]*)'/g)].map((m) => m[1])
    .filter((q) => !/^svi(-|$)/.test(q));
  const files = uiFiles().filter((f) => !/i18n\.js$|icons\.js$/.test(f));
  for (const f of files) {
    const src = read(f);
    for (const m of src.matchAll(/\bicon:\s*([^,}\n]+)/g)) quoted(m[1]).forEach((q) => add(q, f));
    for (const m of src.matchAll(/data-icon="([a-z0-9-]+)"/g)) add(m[1], f);
    for (const m of src.matchAll(/SVIcons\.(?:set|el|draw)\(([^;\n]+)/g)) quoted(m[1]).forEach((q) => add(q, f));
    for (const m of src.matchAll(/\bsetIcon\(([^;\n]+)/g)) quoted(m[1]).forEach((q) => add(q, f));
    // Düğme yardımcıları ([ikon, yazı]), üçlü seçimleri ve kayıt durumu
    for (const m of src.matchAll(/\b(?:act|btn|tact|addBtn|tog|deckAct)\(([^\n]*)/g)) {
      for (const a of m[1].matchAll(/\['([a-z][a-z0-9-]*)'/g)) add(a[1], f);
    }
    for (const m of src.matchAll(/status = \['([a-z][a-z0-9-]*)'/g)) add(m[1], f);
    for (const m of src.matchAll(/_ICONS = \{([^}]*)\}/g)) {
      for (const v of m[1].matchAll(/:\s*'([a-z][a-z0-9-]*)'/g)) add(v[1], f);
    }
    for (const m of src.matchAll(/\bico\('([a-z][a-z0-9-]*)'/g)) add(m[1], f);
  }
  return names;
}

test('kodda adı geçen her ikon sette var', () => {
  const have = new Set(I.names());
  const used = usedNames();
  assert.ok(used.size > 60, 'beklenenden az ikon adı bulundu: ' + used.size);
  const missing = [...used].filter(([n]) => !have.has(n)).map(([n, f]) => n + ' (' + f + ')');
  assert.deepStrictEqual(missing, [], 'sette olmayan ikon: ' + missing.join(', '));
});

test('ikon tanımları: her ikonun en az bir yolu var, yollar yalnız SVG yol komutu', () => {
  for (const name of I.names()) {
    const def = I.ICONS[name];
    assert.ok(Array.isArray(def) && def.length, name + ' boş');
    for (const [d, mode] of def) {
      assert.match(d, /^M[-0-9.,\s MLHVCSQTAZmlhvcsqtaz]+$/, name + ': ' + d);
      assert.ok(mode === undefined || mode === 'f', name + ': bilinmeyen kip ' + mode);
    }
    const svg = I.markup(name, '#fff');
    assert.match(svg, /^<svg xmlns="http:\/\/www\.w3\.org\/2000\/svg" viewBox="0 0 24 24">/);
  }
});

test('ikonlar her sayfada yükleniyor; kumanda ve katman sayfası da', () => {
  assert.match(read('src/admin/index.html'), /<script src="\.\.\/shared\/icons\.js"><\/script>/);
  assert.match(read('src/visualizer/index.html'), /<script src="\.\.\/shared\/icons\.js"><\/script>/);
  assert.match(read('src/web/remote.html'), /<script src="\/app\/shared\/icons\.js"><\/script>/);
  assert.match(read('src/web/overlay.html'), /<script src="\/app\/shared\/icons\.js"><\/script>/);
  // Durağan HTML'deki [data-icon] öğeleri açılışta doldruluyor
  assert.match(read('src/admin/admin.js'), /window\.SVIcons\.hydrate\(document\)/);
  assert.match(read('src/web/remote.js'), /window\.SVIcons\.hydrate\(document\)/);
});

/* el() ikonu yazıdan ÖNCE ve AYRI bir öğe olarak koyuyor: çeviri metin
   düğümünü tam metin olarak eşlediği için ikon metnin içinde olamaz. */
test('panelin el() yardımcısı ikonu yazıdan önce ayrı öğe olarak ekliyor', () => {
  const A = read('src/admin/admin.js');
  assert.match(A, /else if \(k === 'icon'\) continue;/);
  assert.match(A, /e\.insertBefore\(window\.SVIcons\.el\(props\.icon, txt \? 'svi-lead' : ''\), e\.firstChild\);/);
});

test('sözlükte yinelenen anahtar yok', () => {
  const s = read('src/shared/i18n.js').replace(/\r\n/g, '\n');
  const a = s.indexOf('const EN = {');
  const body = s.slice(a, s.indexOf('\n  };', a));
  const seen = new Map();
  for (const m of body.matchAll(/(?:^|[,{]\s*|\n\s*)('(?:[^'\\]|\\.)*'|"(?:[^"\\]|\\.)*")\s*:/g)) {
    const k = m[1].slice(1, -1);
    seen.set(k, (seen.get(k) || 0) + 1);
  }
  const dup = [...seen].filter(([, n]) => n > 1).map(([k]) => k);
  assert.deepStrictEqual(dup, [], 'yinelenen anahtar (sonuncusu öncekini sessizce ezer)');
});
