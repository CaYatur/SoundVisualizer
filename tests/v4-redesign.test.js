'use strict';
/* v4 yeniden tasarımının kırılınca sessizce geri gelecek kararları (#905).
 *
 * Görünümün kendisini `npm run ui-layout` ve `npm run ui-walk` ölçüyor; burada yapısal olanlar var:
 * aç-kapa anahtarının dönmemesi, ağacın katlanması, panel güncellemesinin ucuz kalması. */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const read = (p) => fs.readFileSync(path.join(__dirname, '..', p), 'utf8').replace(/\r\n/g, '\n');
const admin = read('src/admin/admin.js');
const shell = read('src/admin/scene-shell.js');
const pages = read('src/admin/pages.css');
const i18n = read('src/shared/i18n.js');

test('servis modülleri aç-kapa anahtarı yerine durum ve eylem başlığı kullanıyor', () => {
  for (const [file, gone] of [
    ['src/admin/control.js', 'MIDI Etkin'],
    ['src/admin/mapping-panel.js', 'Haritalama Etkin'],
    ['src/admin/aspect-panel.js', 'Basıklık Düzeltme Etkin'],
    ['src/admin/clipdeck-panel.js', 'Klip Destesini Etkinleştir'],
    ['src/admin/timeline-panel.js', 'Zaman Çizelgesini Etkinleştir'],
    ['src/admin/stream.js', 'Yayın Sunucusunu Aç'],
  ]) {
    assert.ok(!read(file).includes(gone), file + ': ' + gone);
  }
  for (const file of ['stream', 'control', 'mapping-panel', 'aspect-panel', 'clipdeck-panel', 'openrgb-panel', 'mcp-panel', 'texture-panel']) {
    assert.ok(read('src/admin/' + file + '.js').includes('moduleHead('), file);
  }
  assert.match(admin, /moduleHead\(o\) \{[\s\S]*?'aria-pressed'/);
});

test('yayın ayarları sunucu kapalıyken de görünüyor', () => {
  const src = read('src/admin/stream.js');
  const onlyWhenOn = src.indexOf('if (s.enabled) {\n      // --- adresler');
  const settings = src.indexOf('// --- ayarlar');
  assert.ok(onlyWhenOn > 0 && settings > onlyWhenOn);
  // Adres ve kurulum bloğu ayarlardan önce kapanıyor
  assert.match(src.slice(onlyWhenOn, settings), /\n {4}\}\n\s*$/);
});

test('Kurulum ağacı yalnız açık kategorinin bölümlerini gösteriyor, kategori sıfırlama ağaçta', () => {
  assert.match(admin, /if \(!open && !\(window\.api && window\.api\.allSections\)\) return;/);
  assert.match(admin, /if \(total > 0\) rail\.appendChild\(categoryResetRow\(cat\.id\)\)/);
  assert.match(admin, /nodes\.push\(categoryResetRow\('output'\)\)/);
  // Başlıktaki düğme tek bölümlü sayfada bölümü sıfırlıyor, kategoriyi değil
  assert.match(admin, /\$\('catResetBtn'\)\.classList\.toggle\('hidden', !resettable \|\| !!single\)/);
});

test('tek bölümlü sayfada sıfırlama rozeti başlıkta ve sayaç oradan güncelleniyor', () => {
  assert.ok(read('src/admin/index.html').includes('id="svHeadActs"'));
  assert.match(admin, /headActs\.appendChild\(acts\)/);
  assert.match(admin, /\$\('svHeadActs'\)\.querySelector\('\.ch-actions'\)/);
});

test('üreticilerde önizleme ortada', () => {
  assert.match(admin, /GEN_SECTIONS = \['scenegen', 'mdgen'\]/);
  assert.match(shell, /page === 'studio' && document\.body\.hasAttribute\('data-gen'\)/);
  assert.match(pages, /body\[data-page='studio'\]\[data-gen\] \.sv-out-center/);
});

test('panel güncellemesi: değişmeyen katman listesi kurulmuyor, işaretler iki kez taranmıyor', () => {
  // Satırlar katman nesnesine bağlı: nesne yenilendiyse imza aynı olsa da kurulmalı
  assert.match(shell, /sig === layersPainted && host\.firstChild && list\.length === layersBound\.length && list\.every\(\(l, i\) => l === layersBound\[i\]\)/);
  assert.match(admin, /if \(!marksFresh\) refreshModifiedMarks\(\);/);
  assert.match(admin, /marksFresh = true;\n\s*try \{ push\(true\); \} finally \{ marksFresh = false; \}/);
});

test('arama efekt ve mod adlarını da buluyor, sonuç rafı açıyor', () => {
  assert.match(admin, /out\.concat\(layerSearchEntries\(\), shelfSearchEntries\(\)\)/);
  assert.match(admin, /FX\.EFFECT_IDS\.forEach/);
  assert.match(admin, /window\.SVSceneShell\.setShelf\(entry\.shelf, entry\.filter/);
});

test('MilkDrop katmanı Ortak ya da Bağımsız', () => {
  const src = read('src/admin/scene-panels.js');
  assert.match(src, /miniSegment\('Preset', \[\['shared', 'Ortak'\], \['own', 'Bağımsız'\]\]/);
  assert.match(src, /MP\.setLayerOwn\(cfg, l, v === 'own'\)/);
});

test('shader listesi küçük resmi koda bağlı ve yalnız boştayken çiziliyor', () => {
  const src = read('src/admin/studio.js');
  assert.match(src, /v\.h === sourceHash\(p\.shader\)/);
  assert.match(src, /typeof requestIdleCallback === 'function' && window\.SVShaderHost/);
  // Saklama kimliğe göre: kod değişince üstüne yazılıyor, eski resim birikmiyor
  assert.match(src, /localStorage\.setItem\('sv-shader-thumb:' \+ job\.p\.id/);
});

test('satır kuralının özgüllüğü düşük: denetçideki yerleşim kuralları onu ezebiliyor', () => {
  assert.match(read('src/admin/shell.css'), /\.sv-insp \.ctrl > :where\(:not\(\.row\)/);
});

test('sayfa stili tek kenar değeri kullanıyor, bölümler sayfa başına tek', () => {
  assert.match(pages, /--sv-inset: 12px;/);
  const heads = pages.match(/-{20,} \d+\. [^*]+\*\//g) || [];
  assert.strictEqual(heads.length, 14);
  const names = heads.map((h) => h.replace(/-+ /, '').trim());
  assert.strictEqual(new Set(names).size, names.length);
});

test('yeni arayüz metinleri çevrilmiş', () => {
  for (const s of ['Devamı', 'Kısalt', 'Ortak', 'Bağımsız', 'Bir ruh hali yazın', 'karanlık sinematik uzay', 'enerjik neon techno', 'sakin orman sabahı',
    'En Az', 'En Çok', 'Uniform', 'Parametreyi Kaldır', 'Tanımı Düzenle', 'Yeni Şerit', 'Oynatma kafasına ekle', 'Renk Teması', 'Albüm Kapağından Renk']) {
    assert.ok(i18n.includes("'" + s + "':"), s);
  }
});

test('çeviri çağrısına verilen sabit cümleler sözlükte, koşullu ifadelerin içindekiler dahil', () => {
  const norm = (x) => x.replace(/\\(.)/g, '$1').replace(/\s+/g, ' ').trim();
  const keys = new Set();
  for (const m of i18n.matchAll(/'((?:[^'\\\n]|\\.)*)'\s*:/g)) keys.add(norm(m[1]));
  const dir = path.join(__dirname, '..', 'src/admin');
  const missing = [];
  for (const f of fs.readdirSync(dir).filter((x) => x.endsWith('.js'))) {
    const src = read('src/admin/' + f);
    for (const m of src.matchAll(/\b(?:tr|tt|T|trStudio)\(/g)) {
      let i = m.index + m[0].length;
      const start = i;
      let depth = 1;
      let q = null;
      while (i < src.length && depth > 0 && i - start < 400) {
        const c = src[i];
        if (q) { if (c === '\\') i++; else if (c === q) q = null; } else if (c === "'" || c === '"' || c === '`') q = c;
        else if (c === '(') depth++;
        else if (c === ')') depth--;
        i++;
      }
      for (const lit of src.slice(start, i - 1).matchAll(/'((?:[^'\\\n]|\\.)*)'/g)) {
        const t = norm(lit[1]);
        // Tek sözcüklü ASCII dizeler koddaki kimlikler (wave, auto): cümle ve Türkçe harf aranıyor
        if ((/ /.test(t) || /[çğıöşüÇĞİÖŞÜ]/.test(t)) && /\p{L}{2}/u.test(t) && !keys.has(t)) missing.push(f + ': ' + t.slice(0, 80));
      }
    }
  }
  assert.deepStrictEqual(missing, []);
});

test('arayüz araçları sessizce takılmıyor', () => {
  const lib = read('scripts/ui-lib.js');
  assert.match(lib, /EV_LIMIT/);
  assert.match(lib, /process\.on\('exit'/);
  assert.match(lib, /\/json\/version/);
  assert.match(read('scripts/ui-audit.js'), /setTimeout\(go, 400\)/);
});

test('yerleşim denetimi komutu duruyor', () => {
  const pkg = JSON.parse(read('package.json'));
  assert.strictEqual(pkg.scripts['ui-layout'], 'node scripts/ui-layout.js');
});
