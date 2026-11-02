'use strict';
/* LINUX'TA GPU KODLAYICILARI (#904). Tiger Lake bizde yok; rapordaki davranış
   burada sahte ffmpeg olarak yazılı: paketteki ikilide QSV ve VA-API yok, sistem
   ikilisinde var, H.264 yalnız düşük güç giriş noktasıyla geçiyor. Gerçek donanım
   denemesi rapor sahibinde. */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const F = require('../src/shared/export-formats.js');
const { probeEncoders } = require('../src/main/encoder-probe.js');

const BUNDLED = '/opt/app/ffmpeg';
const SYSTEM = 'ffmpeg';
const encOf = (args) => args[args.indexOf('-c:v') + 1];

/* Makine tanımı: `run` hangi denemenin geçeceğini söylüyor; denemeler kaydediliyor */
function machine(accept, names) {
  const calls = [];
  return {
    calls,
    run: async (bin, args) => { calls.push({ bin, args }); return accept(bin, args); },
    list: async (bin) => (names ? names[bin] : null),
  };
}
const probe = (m, over) => probeEncoders(Object.assign({
  platform: 'linux', bins: [BUNDLED, SYSTEM], keys: F.probeKeys(), renderNodes: ['/dev/dri/renderD128'],
  run: m.run, list: m.list,
}, over || {}));

const CPU = (bin, args) => bin === BUNDLED && !F.ENCODERS[encOf(args)]?.gpu;

test('rapordaki makine: sistem ikilisi ve düşük güçle Quick Sync, VA-API de geçiyor', async () => {
  const m = machine((bin, args) => {
    if (CPU(bin, args)) return true;
    if (bin !== SYSTEM) return false;
    const enc = encOf(args);
    if (enc === 'h264_qsv') return args.includes('-low_power');
    return enc === 'h264_vaapi';
  }, { [BUNDLED]: ['libx264', 'libx265'], [SYSTEM]: ['libx264', 'h264_qsv', 'hevc_qsv', 'h264_vaapi', 'hevc_vaapi'] });
  const r = await probe(m);
  assert.strictEqual(r.map.h264_qsv, true);
  assert.deepStrictEqual(r.routes.h264_qsv, { bin: SYSTEM, variant: { lowPower: true } });
  assert.strictEqual(r.map.h264_vaapi, true);
  assert.deepStrictEqual(r.routes.h264_vaapi, { bin: SYSTEM, variant: { device: '/dev/dri/renderD128' } });
  assert.strictEqual(F.pickEncoder(F.format('mp4-h264'), 'gpu', (e) => r.map[e]), 'h264_qsv');
  // Paketteki ikilide olmayan kodlayıcı denenmiyor: boşuna aygıt açılmıyor
  assert.ok(!m.calls.some((c) => c.bin === BUNDLED && /_qsv|_vaapi/.test(encOf(c.args))));
  // Rapordaki geçen komutun anahtarları
  const a = F.probeArgs('h264_qsv', r.routes.h264_qsv.variant);
  assert.strictEqual(a[a.indexOf('-low_power') + 1], '1');
  assert.strictEqual(a[a.indexOf('-preset') + 1], 'veryfast');
  assert.strictEqual(a[a.indexOf('-global_quality') + 1], '25');
});

test('eski Intel: düşük güç olmadan geçiyor, zorlanmıyor', async () => {
  const m = machine((bin, args) => CPU(bin, args) || (bin === SYSTEM && encOf(args) === 'h264_qsv' && !args.includes('-low_power')),
    { [BUNDLED]: ['libx264'], [SYSTEM]: ['libx264', 'h264_qsv'] });
  const r = await probe(m);
  assert.deepStrictEqual(r.routes.h264_qsv, { bin: SYSTEM, variant: {} });
  assert.ok(!m.calls.some((c) => encOf(c.args) === 'h264_qsv' && c.args.includes('-low_power')), 'gereksiz deneme');
});

test('sistem ffmpeg\'i yoksa ya da GPU yoksa yalnız CPU, hata yok', async () => {
  const m = machine((bin, args) => CPU(bin, args), { [BUNDLED]: ['libx264'], [SYSTEM]: [] });
  const r = await probe(m, { renderNodes: [] });
  for (const k of ['h264_qsv', 'hevc_qsv', 'h264_vaapi', 'hevc_vaapi', 'h264_nvenc']) assert.strictEqual(r.map[k], false, k);
  assert.strictEqual(F.pickEncoder(F.format('mp4-h264'), 'gpu', (e) => r.map[e]), 'libx264');
});

test('paketteki ikili yeterliyse sistem ikilisine dokunulmuyor', async () => {
  const m = machine((bin, args) => CPU(bin, args) || (bin === BUNDLED && encOf(args) === 'h264_nvenc'), { [BUNDLED]: ['h264_nvenc'], [SYSTEM]: ['h264_nvenc'] });
  const r = await probe(m);
  assert.strictEqual(r.routes.h264_nvenc.bin, BUNDLED);
  assert.ok(!m.calls.some((c) => c.bin === SYSTEM && encOf(c.args) === 'h264_nvenc'));
});

test('CPU kodlayıcıları hiçbir zaman sistem ikilisinden gitmiyor', async () => {
  const m = machine(() => true, { [BUNDLED]: null, [SYSTEM]: null });
  const r = await probe(m);
  assert.ok(!m.calls.some((c) => c.bin === SYSTEM && !F.ENCODERS[encOf(c.args)]?.gpu && encOf(c.args)));
  assert.strictEqual(r.routes.libx264.bin, BUNDLED);
});

test('ikinci render düğümü deneniyor', async () => {
  const m = machine((bin, args) => CPU(bin, args) || (encOf(args) === 'h264_vaapi' && args.includes('/dev/dri/renderD129')));
  const r = await probe(m, { renderNodes: ['/dev/dri/renderD128', '/dev/dri/renderD129'] });
  assert.deepStrictEqual(r.routes.h264_vaapi.variant, { device: '/dev/dri/renderD129' });
});

test('Windows ve macOS: deneme listesi ve argümanlar değişmedi', async () => {
  for (const platform of ['win32', 'darwin']) {
    const m = machine(() => true);
    const r = await probe(m, { platform, bins: [BUNDLED, SYSTEM], renderNodes: [] });
    assert.ok(m.calls.every((c) => c.bin === BUNDLED), platform + ': ikinci ikili');
    assert.ok(!m.calls.some((c) => c.args.includes('-low_power')), platform + ': düşük güç');
    assert.ok(!m.calls.some((c) => /_vaapi/.test(encOf(c.args))), platform + ': VA-API');
    assert.strictEqual(r.map.h264_vaapi, false);
    assert.strictEqual(r.map.h264_qsv, true);
    assert.deepStrictEqual(r.routes.h264_qsv.variant, {});
  }
  // QSV'nin eski argümanları birebir
  assert.deepStrictEqual(F.videoArgs(F.format('mp4-h264'), 'h264_qsv', 'high', 'balanced').args,
    ['-c:v', 'h264_qsv', '-preset', 'medium', '-global_quality', '20']);
});

// ------------------------------------------------------- argümanlar

const job = (enc, variant, extra) => F.buildArgs(Object.assign({
  fmt: F.format('mp4-h264'), encoder: enc, variant, w: 1920, h: 1080, fps: 60, quality: 'high', speed: 'balanced',
  audioPath: '/a/song.wav', audioExt: '.wav', output: '/out/x.mp4',
}, extra || {}));

test('VA-API: aygıt girdiden önce, kare GPU belleğine yükleniyor, renk etiketleri duruyor', () => {
  const a = job('h264_vaapi', { device: '/dev/dri/renderD128' });
  assert.ok(a.indexOf('-vaapi_device') < a.indexOf('-i'));
  assert.strictEqual(a[a.indexOf('-vaapi_device') + 1], '/dev/dri/renderD128');
  assert.strictEqual(a[a.indexOf('-vf') + 1], 'scale=out_color_matrix=bt709:out_range=tv,format=nv12,hwupload');
  assert.strictEqual(a[a.indexOf('-rc_mode') + 1], 'CQP');
  assert.strictEqual(a[a.indexOf('-qp') + 1], '20');
  assert.strictEqual(a[a.indexOf('-colorspace') + 1], 'bt709');
  assert.ok(!a.includes('-low_power'));
  assert.strictEqual(job('h264_vaapi', { device: '/d', lowPower: true })[job('h264_vaapi', { device: '/d', lowPower: true }).indexOf('-low_power') + 1], '1');
});

test('VA-API: aygıtsız iş kurulmuyor', () => {
  assert.strictEqual(job('h264_vaapi', undefined), null);
  assert.strictEqual(F.probeArgs('h264_vaapi'), null);
});

test('VA-API: GPU\'nun I420 yolu, H.265 ve 10 bit', () => {
  const fmt = F.format('mp4-h264');
  assert.strictEqual(F.takesYuv420(fmt, 'h264_vaapi'), true);
  const a = job('h264_vaapi', { device: '/d' }, { inputPix: 'yuv420p' });
  assert.strictEqual(a[a.indexOf('-pixel_format') + 1], 'yuv420p');
  assert.strictEqual(a[a.indexOf('-vf') + 1], 'format=nv12,hwupload');
  const h = job('hevc_vaapi', { device: '/d' }, { fmt: F.format('mp4-hevc') });
  assert.strictEqual(h[h.indexOf('-tag:v') + 1], 'hvc1');
  const ten = job('hevc_vaapi', { device: '/d' }, { fmt: F.format('mp4-hevc10') });
  assert.strictEqual(ten[ten.indexOf('-profile:v') + 1], 'main10');
  assert.match(ten[ten.indexOf('-vf') + 1], /format=p010le,hwupload$/);
  assert.strictEqual(F.takesYuv420(F.format('mp4-hevc10'), 'hevc_vaapi'), false);
  assert.ok(F.probeKeys().includes('hevc_vaapi@10'));
  assert.strictEqual(job('h264_vaapi', { device: '/d' }, { fmt: F.format('mp4-hevc10') }), null);
});

test('Quick Sync düşük güç çeşidi iş argümanlarına da gidiyor', () => {
  const a = job('h264_qsv', { lowPower: true });
  assert.strictEqual(a[a.indexOf('-low_power') + 1], '1');
  assert.ok(!job('h264_qsv', {}).includes('-low_power'));
  assert.ok(!job('h264_qsv').includes('-low_power'));
});

test('sıra: Linux\'ta NVENC varsa önce o, VA-API en sonda', () => {
  const list = F.encodersFor(F.format('mp4-h264'));
  assert.deepStrictEqual(list, ['h264_nvenc', 'h264_amf', 'h264_qsv', 'h264_vaapi', 'libx264']);
});

test('WebGL2 yoksa kare RGBA gidiyor: dışa aktarım düşmüyor', () => {
  const M = fs.readFileSync(path.join(__dirname, '../src/main/main.js'), 'utf-8').replace(/\r\n/g, '\n');
  assert.match(M, /w % 4 === 0 && h % 2 === 0 && await hasWebgl2\(\) \? 'yuv420p' : 'rgba';/);
  // Durum bildirimi değil gerçek bağlam: WSL'de bildirim yanıltıyordu
  const fn = M.slice(M.indexOf('function hasWebgl2() {'), M.indexOf('// Bir ikilide derlenmiş kodlayıcı adları'));
  assert.match(fn, /getContext\('webgl2'\)/);
  assert.match(fn, /loseContext\(\)/, 'deneme bağlamı bırakılıyor');
  assert.doesNotMatch(fn, /getGPUFeatureStatus/);
  // RGBA yolu GPU kodlayıcılarında da doğru süzgeçle: VA-API çevirip yüklüyor
  const a = job('h264_vaapi', { device: '/d' }, { inputPix: 'rgba' });
  assert.strictEqual(a[a.indexOf('-pixel_format') + 1], 'rgba');
  assert.strictEqual(a[a.indexOf('-vf') + 1], 'scale=out_color_matrix=bt709:out_range=tv,format=nv12,hwupload');
});

test('ana süreç gerçek işi yoklamadaki yoldan başlatıyor; AppImage kitaplıkları sisteme sızmıyor', () => {
  const M = fs.readFileSync(path.join(__dirname, '../src/main/main.js'), 'utf-8').replace(/\r\n/g, '\n');
  assert.match(M, /const route = _encRoutes\[exportFormats\.probeKey\(fmt, encoderId\)\] \|\| \{\};/);
  assert.match(M, /encoder: encoderId, variant: route\.variant,/);
  assert.match(M, /const encBin = route\.bin \|\| ff;\s*ffmpegProc = spawn\(encBin, args, \{[^}]*env: encoderEnv\(encBin\) \}\);/);
  assert.match(M, /delete env\.LD_LIBRARY_PATH;/);
  assert.match(M, /if \(bin !== SYSTEM_FFMPEG \|\| !process\.env\.APPIMAGE\) return process\.env;/);
});
