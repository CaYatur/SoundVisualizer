'use strict';
/* DIŞA AKTARMA İŞİ: süre, ses, meta veri, yarım dosya (#523, #524, #528, #532).
 *
 * Uçtan uca ölçüldü (uygulamada, 5 sn ses):
 *   8 sn sabit      240 kare, video 8,000 / ses 8,000 (AAC, 5. saniyeden sonrası -inf dB)
 *   3 sn, mp3       90 kare, ses KOPYALANDI, 3,005 (paket sınırı)
 *   8 ölçü @120     480 kare, 16,000 / 16,000, açıklamada "BPM: 120"
 *   zaman çizelgesi 6 sn işaretle 180 kare
 *   iptal ve işin ortasında kapanış: asıl yolda da .partial'da da dosya yok,
 *   arkada ffmpeg kalmıyor
 */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const F = require('../src/shared/export-formats.js');

const read = (p) => fs.readFileSync(path.join(__dirname, '..', p), 'utf8');
const after = (a, flag) => a[a.indexOf(flag) + 1];
const args = (extra) => F.buildArgs(Object.assign({
  fmt: F.format('mp4-h264'), encoder: 'libx264', w: 64, h: 64, fps: 30, quality: 'high', speed: 'fast',
  audioPath: 'C:/a/s.mp3', audioExt: '.mp3', audioSec: 10, output: 'C:/o/x.partial.mp4',
}, extra || {}));

test('süre kaynakları', () => {
  const ctx = { audioSec: 200, timelineSec: 95.5, barsToSeconds: (n) => n * 2 };
  assert.deepStrictEqual(F.resolveDuration({ mode: 'audio' }, ctx), { ok: true, mode: 'audio', seconds: 200 });
  assert.strictEqual(F.resolveDuration({ mode: 'seconds', seconds: 42 }, ctx).seconds, 42);
  assert.strictEqual(F.resolveDuration({ mode: 'timeline' }, ctx).seconds, 95.5);
  assert.strictEqual(F.resolveDuration({ mode: 'bars', bars: 16 }, ctx).seconds, 32);
  assert.strictEqual(F.resolveDuration({ mode: 'bilinmeyen' }, ctx).mode, 'audio', 'bilinmeyen kip ses');
  assert.strictEqual(F.resolveDuration({ mode: 'seconds', seconds: 1e9 }, ctx).seconds, F.MAX_SECONDS);
  assert.deepStrictEqual(F.resolveDuration({ mode: 'timeline' }, { timelineSec: 0 }), { ok: false, code: 'TIMELINE_EMPTY' });
  assert.strictEqual(F.resolveDuration({ mode: 'bars', bars: 0 }, ctx).code, 'BAD_BARS');
  assert.strictEqual(F.resolveDuration({ mode: 'seconds', seconds: 0 }, ctx).code, 'NO_DURATION');
  assert.strictEqual(F.resolveDuration({ mode: 'audio' }, { audioSec: 0 }).code, 'NO_DURATION');
});

test('ses: süre verilmezse -shortest, kısaysa apad ve kodlama, uzunsa kopya ve kesme', () => {
  const plain = args();
  assert.ok(plain.includes('-shortest') && !plain.includes('-t'));
  assert.strictEqual(after(plain, '-c:a'), 'copy');

  const longer = args({ durationSec: 20 });
  assert.strictEqual(after(longer, '-af'), 'apad');
  assert.strictEqual(after(longer, '-c:a'), 'aac', 'doldurulan ses kopyalanamaz');
  assert.strictEqual(after(longer, '-t'), '20.000000');
  assert.ok(!longer.includes('-shortest'));

  const shorter = args({ durationSec: 3 });
  assert.ok(!shorter.includes('-af'));
  assert.strictEqual(after(shorter, '-c:a'), 'copy');
  assert.strictEqual(after(shorter, '-t'), '3.000000');
  assert.ok(shorter.indexOf('-t') < shorter.length - 1, '-t çıktıdan önce');
});

test('meta veri: sahne ve BPM açıklamada, satır sonu yok', () => {
  const a = args({ meta: { title: 'Parça', scene: 'Kulüp\nGece', bpm: 127.996 } });
  assert.ok(a.includes('title=Parça'));
  assert.ok(a.includes('comment=Scene: Kulüp Gece · BPM: 128'), a.join(' '));
  assert.ok(!args({ meta: { title: 'x' } }).some((v) => /^comment=/.test(v)), 'boş açıklama yazılmaz');
});

test('dosya adı: yasak karakter, ayrılmış ad, sondaki nokta', () => {
  assert.strictEqual(F.sanitizeFileName('a<b>:c"d/e\\f|g?h*i. '), 'a b c d e f g h i');
  assert.strictEqual(F.sanitizeFileName('CON'), 'export');
  assert.strictEqual(F.sanitizeFileName('lpt1', 'yedek'), 'yedek');
  assert.strictEqual(F.sanitizeFileName('  '), 'export');
  assert.strictEqual(F.sanitizeFileName('x'.repeat(400)).length, 150);
  assert.strictEqual(F.outputName({ title: 'Song', scene: 'Club', bpm: 128 }, 'mp4'), 'Song - Club - 128 BPM.mp4');
  assert.strictEqual(F.outputName({ title: 'Song' }, 'mov'), 'Song.mov');
  assert.strictEqual(F.outputName({ title: 'A:B', scene: '' }, 'gif'), 'A B.gif');
});

test('geçici ad: uzantı sonda kalıyor', () => {
  assert.strictEqual(F.partialPath('C:\\v\\a.mp4'), 'C:\\v\\a.partial.mp4');
  assert.strictEqual(F.partialPath('/v/x.y/clip'), '/v/x.y/clip.partial');
  assert.strictEqual(F.partialPath('/v/a.b.webm'), '/v/a.b.partial.webm');
});

test('kalan süre ilk saniyeden sonra', () => {
  assert.strictEqual(F.progressStats(10, 100, 500).eta, null);
  assert.deepStrictEqual(F.progressStats(300, 1200, 5000), { pct: 25, fps: 60, eta: 15 });
  assert.strictEqual(F.progressStats(5, 0, 0).pct, 100);
});

test('ana süreç: geçici çıktı, başarıda taşıma, iptalde silme, kapanışta durdurma', () => {
  const M = read('src/main/main.js');
  const job = M.slice(M.indexOf('async function startExportJob('), M.indexOf("ipcMain.handle('export:start'"));
  assert.match(job, /target = exportFormats\.partialPath\(outputPath\);/);
  assert.match(job, /workDir = seqDir \+ '\.partial';/);
  assert.match(job, /audioSec, output: target,\s+durationSec: loop \? loop\.frames \/ fps : durationSec,/);
  const fin = M.slice(M.indexOf('function finalizeExport('), M.indexOf("notifyAdmin('export-done'"));
  // Taşınamazsa iş hataya dönüyor (taşımadan SONRAKİ ilk hata ataması)
  assert.ok(fin.indexOf('promotePartial(') > 0 && fin.indexOf("status = 'error';", fin.indexOf('promotePartial(')) > 0);
  assert.match(fin, /else if \(status !== 'done' && partial && !\(opts && opts\.keep\)\)/);
  assert.match(M, /function shutdownCleanup\(\) \{[\s\S]{0,400}if \(exportState\) finalizeExport\('cancelled'\);/);
  // Dışa aktarıcı süreyi işten alıyor
  assert.match(read('src/exporter/exporter.js'), /const renderSec = Number\(job\.durationSec\) > 0 \? Number\(job\.durationSec\) : duration;/);
});

test('MCP: süre ve sahne adı şemada', () => {
  const mcp = require('../src/shared/mcp.js');
  const p = mcp.tools('en').find((t) => t.name === 'sv_start_export').inputSchema.properties;
  assert.strictEqual(p.duration.type, 'object');
  assert.strictEqual(p.sceneName.type, 'string');
});

test('panel: süre kaynağı, kalan süre ve çevirileri', () => {
  const A = read('src/admin/admin.js');
  assert.match(A, /type: 'select', path: 'export\.duration\.mode'/);
  assert.match(A, /show: \(\) => exportDuration\(\)\.mode === 'seconds'/);
  assert.match(A, /if \(d\.eta != null\) line \+= ' · kalan ' \+ fmtClock\(d\.eta\);/);
  const I = read('src/shared/i18n.js');
  for (const k of ['Ses dosyasının süresi', 'Sabit süre', 'Zaman çizelgesinin uzunluğu', 'Süre (saniye)']) {
    assert.ok(I.includes("'" + k + "':"), k);
  }
  assert.match(I, /\.replace\(\/\^kalan \(\\d\+\(\?::\\d\\d\)\{1,2\}\)\$\/, '\$1 left'\)/);
});
