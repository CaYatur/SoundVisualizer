'use strict';
/* İŞARETÇİLERDEN BÖLÜMLER (#527).
 *
 * Tek render; işaretçi anlarında zorunlu anahtar kare ve ffmpeg'in segment
 * yazıcısıyla kesim. Ayrı ayrı çizmek MilkDrop gibi geri beslemeli katmanları
 * her bölümün başında soğuk başlatırdı.
 *
 * Ölçüldü (5 sn, işaretçiler 2,0 ve 3,5'te, 30 fps): x264, NVENC, x265, VP9
 * ve ProRes'te bölümler 60/45/45 kare, her biri anahtar kareyle başlıyor.
 * AMF zorunlu anahtar kareyi yok sayıyor (tek dosya), bölümlemede seçilmiyor.
 */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const F = require('../src/shared/export-formats.js');

const read = (p) => fs.readFileSync(path.join(__dirname, '..', p), 'utf8');
const after = (a, flag) => a[a.indexOf(flag) + 1];

test('bölüm planı: kare sınırı, tekleme, 0 ve sondaki işaretçi', () => {
  const p = F.chapterPlan([
    { t: 4, name: 'B' }, { t: 0, name: 'Intro' }, { t: 4.01, name: 'aynı kare' },
    { t: 9, name: '' }, { t: 12, name: 'sonda' }, { t: 20, name: 'dışarıda' },
  ], 12, 30, 'Start');
  assert.deepStrictEqual(p.cuts, [4, 9]);
  assert.deepStrictEqual(p.names, ['Intro', 'B', '']);
  assert.strictEqual(p.names.length, p.cuts.length + 1);
  // 0'da işaretçi yoksa ilk bölüm yedek adı alıyor
  assert.deepStrictEqual(F.chapterPlan([{ t: 2.5, name: 'X' }], 6, 30, 'Start').names, ['Start', 'X']);
  // Kesim kare sınırına yuvarlanıyor (30 fps: 2,51 -> 75. kare = 2,5)
  assert.deepStrictEqual(F.chapterPlan([{ t: 2.51, name: 'X' }], 6, 30, '').cuts, [2.5]);
  assert.deepStrictEqual(F.chapterPlan([], 6, 30, '').cuts, []);
});

test('bölüm dosya adı: sıra, temizlenmiş ad, adsıza yedek', () => {
  assert.strictEqual(F.chapterFileName(0, 'Nakarat: 1', 'mp4', 'Bölüm'), '01 - Nakarat 1.mp4');
  assert.strictEqual(F.chapterFileName(2, '', 'webm', 'Bölüm'), '03 - Bölüm 3.webm');
  assert.strictEqual(F.chapterFileName(9, 'CON', 'mov', 'Chapter'), '10 - Chapter 10.mov');
});

test('argümanlar: anahtar kare tam zamanda, kesim yarım kare önce, faststart segmentte', () => {
  const a = F.buildArgs({
    fmt: F.format('mp4-h264'), encoder: 'h264_nvenc', w: 64, h: 64, fps: 30, quality: 'high', speed: 'fast',
    output: 'D:/o/%03d.mp4', chapters: [2, 3.5],
  });
  assert.strictEqual(after(a, '-force_key_frames'), '2.000000,3.500000');
  assert.strictEqual(after(a, '-forced-idr'), '1', 'NVENC anahtar kareyi IDR yapmalı');
  assert.strictEqual(after(a, '-segment_times'), '1.983333,3.483333');
  assert.strictEqual(a[a.lastIndexOf('-f') + 1], 'segment');
  assert.strictEqual(after(a, '-segment_format'), 'mp4');
  assert.strictEqual(after(a, '-segment_format_options'), 'movflags=+faststart');
  assert.ok(!a.includes('-movflags'), 'faststart segmentin içinde');
  // Bölüm yalnız video biçimlerinde
  const g = F.buildArgs({ fmt: F.format('gif'), encoder: 'gif', w: 64, h: 64, fps: 24, quality: 'high', speed: 'fast', output: 'x.gif', chapters: [2] });
  assert.ok(!g.includes('segment') && !g.includes('-force_key_frames'));
});

test('bölümlemede AMF seçilmiyor, sıradaki uygun kodlayıcı', () => {
  const f = F.format('mp4-h264');
  const noNvenc = (e) => e !== 'h264_nvenc';
  assert.strictEqual(F.pickEncoder(f, 'gpu', noNvenc), 'h264_amf');
  assert.strictEqual(F.pickEncoder(f, 'gpu', (e) => e === 'h264_amf' || e === 'libx264', { forcedKeys: true }), 'libx264');
  assert.strictEqual(F.pickEncoder(F.format('mp4-hevc'), 'gpu', (e) => e === 'hevc_amf' || e === 'libx265', { forcedKeys: true }), 'libx265');
  for (const e of ['h264_amf', 'hevc_amf']) assert.strictEqual(F.ENCODERS[e].noForcedKeys, true, e);
});

test('ana süreç: tek render, klasör, işaretçi adları, sayı tutmazsa hata', () => {
  const M = read('src/main/main.js');
  assert.match(M, /const wantChapters = opts\.chapters === true && fmt\.kind === 'video';/);
  assert.match(M, /\{ forcedKeys: wantChapters \}/);
  assert.match(M, /chapters = exportFormats\.chapterPlan\(markers, dur\.seconds, fps,/);
  assert.match(M, /chapters: chapters \? chapters\.cuts : null,/);
  const nc = M.slice(M.indexOf('function nameChapters('), M.indexOf('function promotePartial('));
  assert.match(nc, /if \(files\.length !== names\.length\)/, 'eksik bölüm sessizce geçmez');
  const fin = M.slice(M.indexOf('function finalizeExport('), M.indexOf("notifyAdmin('export-done'"));
  assert.ok(fin.indexOf('nameChapters(') < fin.indexOf('promotePartial('), 'önce ad, sonra taşıma');
});

test('ölçüm sürücüsü panel güncellemelerini bekletiyor', () => {
  /* Panel açılırken update-config ile yapılandırmayı değiştiriyordu: ilk
     iş panelin ayarıyla çiziliyordu (bölümleme ilk işte işaretçi göremedi). */
  const M = read('src/main/main.js');
  const b = M.slice(M.indexOf('async function runExportBench('), M.indexOf('async function runExportBench(') + 5000);
  assert.ok(b.indexOf('smokeHoldStart();') > 0 && b.indexOf('smokeHoldStart();') < b.indexOf('for (const job of'));
  assert.match(b, /smokeHoldEnd\(\);/);
});

test('panel ve MCP', () => {
  const A = read('src/admin/admin.js');
  assert.match(A, /type: 'toggle', path: 'export\.chapters', label: 'İşaretçilerden bölümlere ayır'/);
  assert.match(A, /chapters: !!\(cfg\.export && cfg\.export\.chapters\) && \(!fmt \|\| fmt\.kind === 'video'\),/);
  assert.ok(read('src/shared/i18n.js').includes("'İşaretçilerden bölümlere ayır': 'Split into chapters at the markers'"));
  const mcp = require('../src/shared/mcp.js');
  assert.strictEqual(mcp.tools('en').find((t) => t.name === 'sv_start_export').inputSchema.properties.chapters.type, 'boolean');
});
