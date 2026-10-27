'use strict';
/* KUSURSUZ DÖNGÜ VE SPOTIFY CANVAS (#840).
 *
 * L + X saniye çiziliyor; ffmpeg çıktıyı X'inci kareden başlatıp son X
 * saniyeyi baştaki X saniyeyle karıştırıyor. Çıktı tam L saniye, ses yok.
 * Ölçüldü (720p30, 3 sn, 0,5 sn geçiş): 90 kare, yuv420p, iki koşu bayt bayt
 * aynı; son→ilk kare farkı 1,00, ardışık karelerinki ortalama 0,51, en çok
 * 1,22 (160×90 gri, 0–255).
 */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const F = require('../src/shared/export-formats.js');

const read = (rel) => fs.readFileSync(path.join(__dirname, '..', rel), 'utf-8');
const mp4 = F.format('mp4-h264');
const base = { fmt: mp4, encoder: 'libx264', w: 1080, h: 1920, fps: 30, quality: 'high', speed: 'balanced',
  audioPath: 'a.wav', audioExt: '.wav', audioSec: 20, output: 'o.mp4' };

test('plan: L saniye çıktı, L + X çizim; geçiş sınırlı', () => {
  const p = F.loopPlan({ seconds: 8, cross: 0.5 }, 30, mp4);
  assert.strictEqual(p.frames, 240);
  assert.strictEqual(p.cross, 0.5);
  assert.strictEqual(p.render, 8.5);
  assert.match(p.graph, /trim=start_frame=15,.*trim=end_frame=15,.*xfade=transition=fade:duration=0\.500000:offset=7\.500000$/);
  // En fazla L'nin yarısı ve 2 sn, en az bir kare
  assert.strictEqual(F.loopPlan({ seconds: 2, cross: 5 }, 30, mp4).cross, 1);
  assert.strictEqual(F.loopPlan({ seconds: 20, cross: 5 }, 30, mp4).cross, 2);
  assert.strictEqual(F.loopPlan({ seconds: 3, cross: 0.001 }, 30, mp4).cross, 1 / 30);
  // Kare dizisinde ve kısa/eksik değerde döngü yok
  assert.strictEqual(F.loopPlan({ seconds: 8 }, 30, F.format('png-seq')), null);
  assert.strictEqual(F.loopPlan({ seconds: 0.05 }, 30, mp4), null);
  assert.strictEqual(F.loopPlan(null, 30, mp4), null);
});

test('argümanlar: süzgeç zinciri, ses yok, bölüm kesimi yok, süre L', () => {
  const a = F.buildArgs(Object.assign({}, base, { durationSec: 8, loop: { seconds: 8, cross: 0.5 }, chapters: [3] })).join(' ');
  assert.match(a, /-filter_complex \[0:v\]split=2\[lpa\]\[lpb\];.*xfade=[^ ]*\[lp\];\[lp\]scale=[^ ]*format=yuv420p\[v\] -map \[v\]/);
  assert.ok(!/ -i a\.wav/.test(a) && / -an /.test(a), 'ses eklenmiyor');
  assert.ok(!/segment|force_key_frames/.test(a), 'döngüde bölüm kesimi yok');
  assert.match(a, / -t 8\.000000 /);
  // I420 girişte biçim yine yuv420p'ye sabit (ölçüldü: yoksa yuv444p)
  const y = F.buildArgs(Object.assign({}, base, { inputPix: 'yuv420p', durationSec: 8, loop: { seconds: 8, cross: 0.5 } })).join(' ');
  assert.match(y, /xfade=[^ ]*\[lp\];\[lp\]format=yuv420p\[v\]/);
  // GIF: palet zinciri döngünün arkasına
  const gif = F.format('gif');
  const g = F.buildArgs({ fmt: gif, encoder: F.pickEncoder(gif, 'cpu', () => true), w: 640, h: 360, fps: 24, quality: 'high',
    speed: 'balanced', durationSec: 2, output: 'o.gif', loop: { seconds: 2, cross: 0.4 } }).join(' ');
  assert.match(g, /xfade=[^ ]*\[lp\];\[lp\]split\[a\]\[b\];\[a\]palettegen/);
  // Döngü yokken eski komut aynen
  const plain = F.buildArgs(Object.assign({}, base, { durationSec: 8 })).join(' ');
  assert.ok(!/xfade|split=2/.test(plain) && / -i a\.wav /.test(plain));
});

test('Spotify Canvas profili; profil eşleme eski ayarlarla ve süreyle', () => {
  const c = F.profile('spotify-canvas');
  assert.deepStrictEqual(c.set, { format: 'mp4-h264', resolution: '1080x1920', fps: 30, quality: 'high', loop: true,
    duration: { mode: 'seconds', seconds: 8 } });
  for (const p of F.PROFILES) if (p.id !== 'spotify-canvas') assert.strictEqual(p.set.loop, false, p.id + ' döngüyü kapatıyor');
  // Döngü anahtarı olmayan eski ayar eski profiline uyuyor
  assert.strictEqual(F.matchProfile({ format: 'mp4-h264', resolution: '1080p', fps: 60, quality: 'high' }), 'youtube-1080p60');
  assert.strictEqual(F.matchProfile({ format: 'mp4-h264', resolution: '1080x1920', fps: 30, quality: 'high', loop: true,
    duration: { mode: 'seconds', seconds: 8, bars: 16, bpm: 0 } }), 'spotify-canvas');
  assert.strictEqual(F.matchProfile({ format: 'mp4-h264', resolution: '1080x1920', fps: 30, quality: 'high', loop: true,
    duration: { mode: 'seconds', seconds: 5 } }), 'custom', 'süre farklıysa özel');
  // Uygulama süre nesnesini birleştiriyor: ölçü ve BPM korunuyor
  const ap = F.applyProfile({ duration: { mode: 'audio', seconds: 30, bars: 12, bpm: 128 } }, 'spotify-canvas');
  assert.deepStrictEqual(ap.duration, { mode: 'seconds', seconds: 8, bars: 12, bpm: 128 });
});

test('ana süreç, panel, varsayılan, MCP ve çeviri', () => {
  const main = read('src/main/main.js');
  assert.match(main, /const loopSpec = opts\.loop === true && !wantChapters \?/);
  assert.match(main, /durationSec: loop \? loop\.frames \/ fps : durationSec, loop: loop \? loopSpec : null,/);
  assert.match(main, /durationSec: renderSec,/, 'çizici geçiş payıyla çiziyor');
  const admin = read('src/admin/admin.js');
  assert.match(admin, /path: 'export\.loop', label: 'Kusursuz döngü/);
  assert.match(admin, /path: 'export\.loopCrossfade', label: 'Döngü Geçişi'/);
  assert.strictEqual((admin.match(/loop: !!/g) || []).length, 2, 'kuyruk ve tekli dışa aktarma');
  const D = read('src/shared/defaults.js');
  assert.match(D, /loop: false, \/\/ kusursuz döngü/);
  assert.match(D, /loopCrossfade: 0\.5,/);
  const mcp = read('src/shared/mcp.js');
  assert.match(mcp, /loop: sp\('boolean'/);
  assert.match(mcp, /loopCrossfade: sp\('number'/);
  const i18n = read('src/shared/i18n.js');
  for (const k of ['Kusursuz döngü (sonu başa bağla, sessiz)', 'Döngü Geçişi']) assert.ok(i18n.includes("'" + k + "':"), k);
});
