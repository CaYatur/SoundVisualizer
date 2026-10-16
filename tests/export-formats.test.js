'use strict';
/* DIŞA AKTARMA BİÇİMLERİ (#521, #525, #529).
 *
 * Biçim listesi VERİ: panel, MCP şeması, yol denetimi ve ffmpeg argümanları
 * aynı tablodan türüyor. Buradaki testler tablonun kendi içinde tutarlı
 * olduğunu ve argümanların ölçülmüş doğru yolları kurduğunu sınıyor.
 * Kodlayıcıların bu makinede çalıştığını ana süreç deneme kodlamasıyla
 * ölçüyor; o ölçüm burada değil, öz testte.
 */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const F = require('../src/shared/export-formats.js');

const fmt = (id) => F.format(id);
const args = (id, enc, extra) => F.buildArgs(Object.assign({
  fmt: fmt(id), encoder: enc, w: 1920, h: 1080, fps: 60, quality: 'high', speed: 'balanced',
  audioPath: 'C:/a/song.wav', audioExt: '.wav', output: 'C:/out/x.' + fmt(id).ext,
}, extra || {}));
const after = (a, flag) => a[a.indexOf(flag) + 1];

test('her biçimin en az bir CPU kodlayıcısı ve deneme argümanı var', () => {
  for (const f of F.FORMATS) {
    const list = F.encodersFor(f);
    assert.ok(list.length, f.id + ' kodlayıcısız');
    assert.ok(list.some((e) => !F.ENCODERS[e].gpu), f.id + ' yalnız GPU ile kalamaz');
    for (const e of list) assert.ok(Array.isArray(F.probeArgs(e)), e + ' deneme argümanı yok');
  }
  assert.ok(F.format(F.DEFAULT_FORMAT), 'varsayılan biçim tabloda');
});

test('GPU istenip hiçbiri çalışmıyorsa CPU kodlayıcısına düşülüyor', () => {
  const h264 = fmt('mp4-h264');
  assert.strictEqual(F.pickEncoder(h264, 'gpu', () => true), 'h264_nvenc');
  assert.strictEqual(F.pickEncoder(h264, 'gpu', (e) => e === 'h264_amf' || e === 'libx264'), 'h264_amf');
  assert.strictEqual(F.pickEncoder(h264, 'gpu', (e) => e === 'libx264'), 'libx264');
  assert.strictEqual(F.pickEncoder(h264, 'cpu', () => true), 'libx264');
  assert.strictEqual(F.pickEncoder(h264, 'gpu', () => false), null);
  assert.strictEqual(F.available(fmt('mov-prores'), (e) => e !== 'prores_ks'), false);
});

/* Renk: ffmpeg etiketsiz HD'yi BT.601 ile çeviriyor, oynatıcılar BT.709
   sayıyor. Ölçüldü (testsrc2, x264 kayıpsız): eski yol ortalama 8,90 en çok
   45 sapma, BT.709 süzgeci + etiket ortalama 1,17. */
test('video biçimleri BT.709 ile çevrilip etiketleniyor', () => {
  for (const [id, enc] of [['mp4-h264', 'libx264'], ['mp4-h264', 'h264_nvenc'], ['mp4-hevc', 'libx265'],
    ['mov-prores', 'prores_ks'], ['mov-dnxhr', 'dnxhd'], ['webm-vp9', 'libvpx-vp9']]) {
    const a = args(id, enc);
    assert.match(after(a, '-vf'), /^scale=out_color_matrix=bt709:out_range=tv,format=/, id + ' ' + enc);
    assert.strictEqual(after(a, '-colorspace'), 'bt709');
    assert.strictEqual(after(a, '-color_range'), 'tv');
  }
});

test('alfa biçimleri alfalı piksel biçimi kuruyor (#525)', () => {
  assert.match(after(args('mov-prores4444', 'prores_ks'), '-vf'), /format=yuva444p10le$/);
  assert.strictEqual(after(args('mov-prores4444', 'prores_ks'), '-profile:v'), '4');
  assert.match(after(args('webm-vp9-alpha', 'libvpx-vp9'), '-vf'), /format=yuva420p$/);
  assert.match(after(args('webm-vp9', 'libvpx-vp9'), '-vf'), /format=yuv420p$/);
  assert.match(after(args('apng', 'apng'), '-vf'), /rgba/);
  for (const f of F.FORMATS) {
    if (!f.alpha) continue;
    assert.ok(['mov-prores4444', 'webm-vp9-alpha', 'apng', 'png-seq', 'exr-seq'].includes(f.id), f.id);
  }
});

test('ses kuralı kaba göre: mp4 kopya/AAC, mov PCM, webm Opus, kısa döngü ve dizi sessiz (#524)', () => {
  const mp4 = fmt('mp4-h264');
  assert.deepStrictEqual(F.audioArgs(mp4, '.mp3'), ['-c:a', 'copy']);
  assert.deepStrictEqual(F.audioArgs(mp4, 'm4a'), ['-c:a', 'copy']);
  assert.deepStrictEqual(F.audioArgs(mp4, '.flac'), ['-c:a', 'aac', '-b:a', '320k']);
  assert.deepStrictEqual(F.audioArgs(fmt('mov-prores'), '.mp3'), ['-c:a', 'pcm_s24le']);
  assert.deepStrictEqual(F.audioArgs(fmt('webm-vp9'), '.wav'), ['-c:a', 'libopus', '-b:a', '256k']);
  for (const id of ['gif', 'apng', 'png-seq', 'exr-seq']) {
    const a = args(id, F.encodersFor(fmt(id))[0]);
    assert.ok(a.includes('-an'), id + ' sessiz olmalı');
    assert.ok(!a.includes('C:/a/song.wav'), id + ' sesi girdi olarak açmamalı');
    assert.ok(!a.includes('-shortest'), id);
  }
  const v = args('mp4-h264', 'libx264');
  assert.deepStrictEqual([after(v, '-map'), v[v.lastIndexOf('-map') + 1]], ['0:v:0', '1:a:0']);
  assert.ok(v.includes('-shortest'));
});

test('GIF iki aşamalı paletle, tek süzgeç grafiğinde', () => {
  const a = args('gif', 'gif');
  assert.match(after(a, '-filter_complex'), /^\[0:v\]split\[a\]\[b\];\[a\]palettegen.*\[b\]\[p\]paletteuse.*\[v\]$/);
  assert.strictEqual(after(a, '-map'), '[v]');
  assert.ok(!a.includes('-vf'));
  assert.ok(!a.includes('-colorspace'), 'paletli GIF YUV etiketi almaz');
});

/* EXR: renk ve alfa ayrı yoldan. zscale tek başına alfayı sınırlı aralık
   sanıyor (0,091 sapma); swscale kayan noktaya çevirirken renkte 0,0042
   sapıyor. Ayrı yollar ölçüldü: renk 0,00013, alfa 0. */
test('EXR doğrusal ışık, alfa ayrı yoldan (#529)', () => {
  const g = after(args('exr-seq', 'exr'), '-filter_complex');
  assert.match(g, /\[c\]zscale=tin=iec61966-2-1:t=linear/);
  assert.match(g, /\[a\]alphaextract,format=grayf32le\[al\]/);
  assert.match(g, /mergeplanes=0x00010210:gbrapf32le\[v\]$/);
  assert.strictEqual(after(args('exr-seq', 'exr'), '-format'), 'half');
});

test('kare dizisi: image2 deseni, yoldaki % ikileniyor (#529)', () => {
  assert.strictEqual(F.sequencePattern('C:/out/50% mix', 'kare', 'png'), 'C:/out/50%% mix/kare_%06d.png');
  const a = args('png-seq', 'png', { output: F.sequencePattern('C:/o', 'f', 'png') });
  assert.strictEqual(a[a.length - 1], 'C:/o/f_%06d.png');
  assert.strictEqual(after(a, '-f'), 'rawvideo', 'girdi ham kare');
  assert.strictEqual(a[a.lastIndexOf('-f') + 1], 'image2');
  assert.strictEqual(after(a, '-start_number'), '1');
});

test('meta veri satır sonu taşımıyor, kare dizisinde yazılmıyor (#528)', () => {
  const a = args('mp4-h264', 'libx264', { meta: { title: 'Bir\nİki', artist: 'CaYa' } });
  assert.ok(a.includes('title=Bir İki'));
  assert.ok(a.includes('artist=CaYa'));
  assert.ok(!args('png-seq', 'png', { meta: { title: 'x' } }).includes('-metadata'));
});

test('HEVC hvc1 etiketiyle yazılıyor (Apple oynatıcıları hev1 açmıyor)', () => {
  for (const enc of ['libx265', 'hevc_nvenc', 'hevc_amf', 'hevc_qsv']) {
    assert.strictEqual(after(args('mp4-hevc', enc), '-tag:v'), 'hvc1', enc);
  }
});

test('kısa döngülerde kare hızı sınırı var', () => {
  assert.strictEqual(fmt('gif').fpsMax, 30);
  assert.strictEqual(fmt('apng').fpsMax, 30);
  assert.ok(!fmt('mp4-h264').fpsMax);
});

test('uzantı listesi tekrarsız ve her biçimi kapsıyor', () => {
  const ext = F.extensions();
  assert.strictEqual(new Set(ext).size, ext.length);
  for (const f of F.FORMATS) assert.ok(ext.includes(f.ext), f.id);
});

test('biçim etiketlerinin İngilizcesi sözlükle aynı', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'src', 'shared', 'i18n.js'), 'utf8');
  for (const f of F.FORMATS) {
    const line = "'" + f.label[0] + "': '" + f.label[1] + "'";
    assert.ok(src.includes(line), f.id + ' çevirisi eksik ya da farklı');
  }
});

test('MCP şeması aynı tablodan: biçim, çözünürlük, kare hızı', () => {
  const mcp = require('../src/shared/mcp.js');
  const p = mcp.tools('en').find((t) => t.name === 'sv_start_export').inputSchema.properties;
  assert.deepStrictEqual(p.format.enum, F.FORMATS.map((f) => f.id));
  assert.deepStrictEqual(p.resolution.enum, Object.keys(F.RESOLUTIONS));
  assert.deepStrictEqual(p.fps.enum, F.FPS);
});

test('MCP: çıktı uzantısı seçilen biçiminki olmalı', async () => {
  const mcp = require('../src/shared/mcp.js');
  let started = null;
  const cfg = { mcp: { enabled: true, mode: 'write' } };
  const ctx = { locale: () => 'en', getConfig: () => cfg, startExport: (a) => { started = a; return { ok: true }; } };
  const call = (a) => mcp.callTool('sv_start_export', a, ctx);
  const bad = await call({ audioPath: 'C:/a.wav', outputPath: 'C:/v/x.mp4', format: 'mov-prores' });
  assert.strictEqual(bad.ok, false);
  assert.strictEqual(started, null);
  const unk = await call({ audioPath: 'C:/a.wav', outputPath: 'C:/v/x.mp4', format: 'avi' });
  assert.strictEqual(unk.ok, false);
  const good = await call({ audioPath: 'C:/a.wav', outputPath: 'C:/v/x.mov', format: 'mov-prores' });
  assert.strictEqual(good.ok, true, JSON.stringify(good));
});

// ------------------------------------------------------------ hız (#531)

/* GPU I420: yalnız 8 bit 4:2:0 hedefler. Ölçüldü (720p, 150 kare, aynı
   RGBA karelerden ffmpeg'in BT.709 dönüşümüne karşı): Y'nin %99,3–99,97'si
   aynı, en çok 1; U/V'nin %87–96'sı aynı, kalanın neredeyse tamamı ±1. */
test('GPU I420 yalnız 4:2:0 biçimlerde', () => {
  const yes = [['mp4-h264', 'libx264'], ['mp4-h264', 'h264_nvenc'], ['mp4-h264', 'h264_amf'], ['mp4-h264', 'h264_qsv'],
    ['mp4-hevc', 'libx265'], ['mp4-hevc', 'hevc_nvenc'], ['webm-vp9', 'libvpx-vp9']];
  for (const [f, e] of yes) assert.strictEqual(F.takesYuv420(fmt(f), e), true, f + ' ' + e);
  const no = [['webm-vp9-alpha', 'libvpx-vp9'], ['mov-prores', 'prores_ks'], ['mov-prores4444', 'prores_ks'],
    ['mov-dnxhr', 'dnxhd'], ['gif', 'gif'], ['apng', 'apng'], ['png-seq', 'png'], ['exr-seq', 'exr']];
  for (const [f, e] of no) assert.strictEqual(F.takesYuv420(fmt(f), e), false, f + ' ' + e);
});

test('I420 girdide ffmpeg dönüşüm yapmıyor, etiketler duruyor', () => {
  const a = args('mp4-h264', 'h264_nvenc', { inputPix: 'yuv420p' });
  assert.strictEqual(after(a, '-pixel_format'), 'yuv420p');
  assert.ok(!a.includes('-vf'), 'renk dönüşümü GPU yaptı');
  assert.strictEqual(after(a, '-colorspace'), 'bt709');
  // QSV nv12 sırası istiyor: kayıpsız yer değiştirme, dönüşüm değil
  assert.strictEqual(after(args('mp4-h264', 'h264_qsv', { inputPix: 'yuv420p' }), '-vf'), 'format=nv12');
  // Alfa biçimi I420 istese de RGBA kalır
  const p = args('mov-prores4444', 'prores_ks', { inputPix: 'yuv420p' });
  assert.strictEqual(after(p, '-pixel_format'), 'rgba');
  assert.match(after(p, '-vf'), /yuva444p10le$/);
});

/* framemd5 ile ölçüldü: tek ve sekiz iş parçacığı yuv420p, yuv422p10le ve
   yuva444p10le'de birebir aynı kareleri veriyor. */
test('süzgeç iş parçacıkları girdiden önce, tek çekirdekte yok', () => {
  const a = args('mp4-h264', 'libx264', { threads: 8 });
  assert.strictEqual(after(a, '-filter_threads'), '8');
  assert.ok(a.indexOf('-filter_threads') < a.indexOf('-i'));
  assert.ok(!args('mp4-h264', 'libx264', { threads: 1 }).includes('-filter_threads'));
});

test('GPU dönüştürücüsü: BT.709 sınırlı aralık, 2x2 renk, kendi hedefine çiziyor', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'src', 'exporter', 'yuv-readout.js'), 'utf8');
  assert.match(src, /16\.0 \+ 219\.0 \* dot\(c, vec3\(0\.2126, 0\.7152, 0\.0722\)\)/);
  assert.match(src, /128\.0 \+ 224\.0 \* \(c\.b - y\) \/ 1\.8556/);
  assert.match(src, /128\.0 \+ 224\.0 \* \(c\.r - y\) \/ 1\.5748/);
  assert.match(src, /\(px\(x, y\) \+ px\(x \+ 1, y\) \+ px\(x, y \+ 1\) \+ px\(x \+ 1, y \+ 1\)\) \* 0\.25/);
  // Varsayılan çerçeve tamponu alfasız: her dördüncü bayt 255 dönerdi
  assert.match(src, /framebufferTexture2D\(gl\.FRAMEBUFFER, gl\.COLOR_ATTACHMENT0/);
  assert.match(src, /UNPACK_PREMULTIPLY_ALPHA_WEBGL, false/);
  const html = fs.readFileSync(path.join(__dirname, '..', 'src', 'exporter', 'index.html'), 'utf8');
  assert.ok(html.indexOf('yuv-readout.js') > 0 && html.indexOf('yuv-readout.js') < html.indexOf('exporter.js'));
});

test('I420 yalnız uygun boyutta; dönüştürücü kurulamazsa iş açıkça duruyor', () => {
  const main = fs.readFileSync(path.join(__dirname, '..', 'src', 'main', 'main.js'), 'utf8');
  assert.match(main, /w % 4 === 0 && h % 2 === 0 \? 'yuv420p' : 'rgba'/);
  const ex = fs.readFileSync(path.join(__dirname, '..', 'src', 'exporter', 'exporter.js'), 'utf8');
  assert.match(ex, /if \(!yuv\) throw new Error\(/);
  assert.match(ex, /const data = yuv \? yuv\.read\(comp\) : compCtx\.getImageData\(0, 0, width, height\)\.data;/);
});

/* Ölçüm seçenekleri (kare dökümü dosyaya YAZIYOR) panelden ya da MCP'den
   açılamamalı: ayrı bir parametrede ve yalnız ölçüm sürücüsü veriyor. */
test('ölçüm seçenekleri MCP ve panelden açılamıyor', () => {
  const main = fs.readFileSync(path.join(__dirname, '..', 'src', 'main', 'main.js'), 'utf8');
  assert.match(main, /async function startExportJob\(opts, bench, extra\)/);
  // Panelin tek işi yalnız opts veriyor; kuyruk koşarken reddediliyor (#526)
  const h = main.slice(main.indexOf("ipcMain.handle('export:start'"), main.indexOf("ipcMain.handle('export:start'") + 400);
  assert.match(h, /return startExportJob\(opts\);/);
  assert.match(h, /if \(exportQueue\.running\) return \{ ok: false/);
  // Kuyruk işi yalnız sahne kopyasını veriyor, ölçüm parametresi null
  assert.match(main, /startExportJob\(Object\.assign\(\{\}, item\.opts, \{ audioPath: item\.audioPath, outputPath: item\.outputPath \}\), null, \{ cfg: item\.cfg \}\)/);
  assert.match(main, /startExport: \(opts\) => startExportJob\(opts\),/);
  assert.ok(!/opts\.(profile|dumpRaw|_rgba)/.test(main), 'opts ölçüm seçeneği taşımıyor');
  assert.match(main, /dump: bench\.dumpRaw \?/);
});
