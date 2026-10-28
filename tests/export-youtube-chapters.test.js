'use strict';
/* YOUTUBE BÖLÜM LİSTESİ (#837).
 *
 * Zaman çizelgesi işaretçileri video açıklamasına yapıştırılacak "0:00 Ad"
 * satırlarına. YouTube listeyi yalnız ilk satır 0:00 iken, en az üç bölüm
 * varken ve her bölüm en az 10 saniye sürerken bölüm sayıyor; liste yine
 * üretiliyor ama tutmayan kural koduyla dönüyor.
 */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const FX = require('../src/shared/export-formats.js');

const W = { first: 'Start', chapter: 'Chapter' };
const read = (rel) => fs.readFileSync(path.join(__dirname, '..', rel), 'utf-8');

test('zaman damgası: dakika:saniye, saat varsa saat:dk:sn, aşağı yuvarlanıyor', () => {
  assert.strictEqual(FX.chapterStamp(0, false), '0:00');
  assert.strictEqual(FX.chapterStamp(83.9, false), '1:23');
  assert.strictEqual(FX.chapterStamp(725, false), '12:05');
  assert.strictEqual(FX.chapterStamp(3723, true), '1:02:03');
  assert.strictEqual(FX.chapterStamp(65, true), '0:01:05');
});

test('0\'da işaretçi yoksa başlangıç satırı ekleniyor; adsız işaretçi numaralanıyor', () => {
  const r = FX.youtubeChapters([{ t: 30, name: 'Drop' }, { t: 75.5, name: '' }], 120, W);
  assert.strictEqual(r.text, '0:00 Start\n0:30 Drop\n1:15 Chapter 3');
  assert.deepStrictEqual(r.problems, []);
});

test('0\'daki işaretçi ilk bölümün adını veriyor; aynı saniyedekiler tekleniyor', () => {
  const r = FX.youtubeChapters([{ t: 0.4, name: 'Intro' }, { t: 20, name: '' }, { t: 20.7, name: 'Verse' }, { t: 40, name: 'Chorus' }], 60, W);
  assert.deepStrictEqual(r.rows.map((x) => x.name), ['Intro', 'Verse', 'Chorus']);
  assert.strictEqual(r.rows[0].t, 0);
});

test('YouTube kuralları: üçten az bölüm ve 10 saniyeden kısa bölüm bildiriliyor', () => {
  assert.deepStrictEqual(FX.youtubeChapters([{ t: 30, name: 'A' }], 60, W).problems, ['FEW']);
  const r = FX.youtubeChapters([{ t: 15, name: 'A' }, { t: 20, name: 'B' }, { t: 40, name: 'C' }], 45, W);
  assert.deepStrictEqual(r.problems, ['SHORT']);
  assert.deepStrictEqual(r.short, [1, 3], 'A 5 sn, son bölüm C de 5 sn');
});

test('videonun süresinden sonraki işaretçiler atlanıyor; uzun videoda saat biçimi', () => {
  const r = FX.youtubeChapters([{ t: 100, name: 'A' }, { t: 500, name: 'Late' }], 300, W);
  assert.ok(!/Late/.test(r.text));
  const long = FX.youtubeChapters([{ t: 1800, name: 'Half' }, { t: 3700, name: 'Hour' }], 4000, W);
  assert.strictEqual(long.text, '0:00:00 Start\n0:30:00 Half\n1:01:40 Hour');
});

test('ana süreç: liste başarıda videonun yanına, işaretçi yoksa dosya yok', () => {
  const main = read('src/main/main.js');
  assert.match(main, /\(opts\.chapterList === true \|\| wantChapters\) && fmt\.kind === 'video'/);
  assert.match(main, /if \(markers\.length\) \{\s+chapterListText = exportFormats\.youtubeChapters\(markers, dur\.seconds,/);
  assert.match(main, /if \(status === 'done' && chapterListText && finalOut\)/);
  assert.match(main, /' - YouTube chapters\.txt'/);
});

test('panel, varsayılan, MCP ve çeviri', () => {
  const admin = read('src/admin/admin.js');
  assert.match(admin, /path: 'export\.chapterList'/);
  assert.strictEqual((admin.match(/chapterList: !!/g) || []).length, 2, 'kuyruk ve tekli dışa aktarma');
  const D = read('src/shared/defaults.js');
  assert.match(D, /chapterList: false,/);
  assert.match(read('src/shared/mcp.js'), /chapterList: sp\('boolean'/);
  const tlp = read('src/admin/timeline-panel.js');
  assert.match(tlp, /FX\.youtubeChapters\(tl\.markers, TL\(\)\.timelineLength\(tl\)/);
  const i18n = read('src/shared/i18n.js');
  for (const k of ['YouTube Bölümlerini Kopyala', 'YouTube bölüm listesini yanına yaz (.txt)',
    'Kopyalandı; YouTube en az üç bölüm istiyor.', 'Önce zaman çizelgesine işaret ekleyin.']) {
    assert.ok(i18n.includes("'" + k + "':"), 'çevirisi yok: ' + k);
  }
  assert.match(i18n, /\(\\d\+\) bölüm kopyalandı/);
});

test('bölümlere ayrılan iş listeyi ayrı seçenek olmadan da klasörüne yazıyor; tek dosyada seçenek şart', () => {
  const main = read('src/main/main.js');
  // Liste metni bölümleme ya da seçenekle hazırlanıyor; yazılış yolu klasör/yan dosya ayrımını koruyor
  const at = main.indexOf("(opts.chapterList === true || wantChapters)");
  assert.ok(at > 0 && at > main.indexOf('const wantChapters ='), 'wantChapters önce tanımlı');
  assert.match(main, /const listPath = seqDir \? path\.join\(finalOut, 'YouTube chapters\.txt'\)/);
  assert.match(read('src/shared/mcp.js'), /a split export writes it even when this is off/);
});
