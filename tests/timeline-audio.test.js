/*
 * SoundVisualizer — CaYaDev Ses Görselleştirici
 * Copyright (c) 2026 Çağan Turgut (CaYatur) — CaYaDev, https://cayadev.com
 * https://github.com/CaYatur/SoundVisualizer
 * SPDX-License-Identifier: MIT
 */
'use strict';
/* ZAMAN ÇİZELGESİ SESİ (#1171, #1172, #1173): karışım tanımı (geçiş, kazanç,
   otomasyon, kısma, bölme), geriye uyum (ayrı audioTracks dizisi), dışa aktarma
   kuralı ve ffmpeg karışımının modelle aynı olması. */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const A = require('../src/shared/timeline-audio.js');
const T = require('../src/shared/timeline.js');
const TE = require('../src/shared/timeline-edit.js');
const read = (p) => fs.readFileSync(path.join(__dirname, '..', p), 'utf8').replace(/\r\n/g, '\n');
const near = (a, b, eps, msg) => assert.ok(Math.abs(a - b) <= (eps || 1e-6), (msg || '') + ' ' + a + ' != ' + b);

test('normalize: varsayılanlar, sınırlar ve geçişler süreye sığar', () => {
  const [t] = A.normalize([{ clips: [{ src: 'a.mp3', dur: 2, fadeIn: 5, fadeOut: 5, gain: 99, curve: 'x' }], pan: 4 }]);
  assert.strictEqual(t.pan, 1);
  const c = t.clips[0];
  assert.strictEqual(c.gain, A.MAX_DB);
  assert.strictEqual(c.fadeIn, 2);
  assert.strictEqual(c.fadeOut, 0);
  assert.strictEqual(c.curve, 'linear');
  assert.deepStrictEqual(A.normalize(null), []);
});

test('geçiş eğrileri modelle aynı; eşit güç çapraz geçişi sabit güç', () => {
  const c = A.makeClip({ src: 'a', dur: 4, fadeIn: 1, fadeOut: 1, curve: 'equal' });
  near(A.clipGainAt(c, 0), 0);
  near(A.clipGainAt(c, 0.5), Math.sin(Math.PI / 4));
  near(A.clipGainAt(c, 2), 1);
  near(A.clipGainAt(c, 4), 0);
  for (let x = 0; x <= 1; x += 0.125) {
    const inG = A.shape('equal', x);
    const outG = A.shape('equal', 1 - x);
    near(inG * inG + outG * outG, 1, 1e-9, 'güç');
  }
  near(A.clipGainAt(A.makeClip({ dur: 2, fadeIn: 1, curve: 'exp' }), 0.5), 0.25);
});

test('karışım tanımı: kazanç, otomasyon, sessiz/solo ve aralık', () => {
  const tracks = [
    { id: 'a', gain: -6, clips: [{ id: 'c1', src: 'x', start: 1, dur: 2 }], volume: [{ t: 1, db: 0 }, { t: 3, db: -20 }] },
    { id: 'b', mute: true, clips: [{ id: 'c2', src: 'y', start: 0, dur: 5 }] },
  ];
  const d = A.mixDescription(tracks);
  assert.strictEqual(d.sources.length, 1);
  const s = d.sources[0];
  assert.strictEqual(s.at, 1);
  near(A.gainAtPoints(s.points, 0), A.dbToGain(-6));
  near(A.gainAtPoints(s.points, 1), A.dbToGain(-6) * A.dbToGain(-10), 1e-5);
  // Solo: yalnız solo parça
  const solo = A.mixDescription([{ id: 'a', solo: true, clips: [{ src: 'x', dur: 1 }] }, { id: 'b', clips: [{ src: 'y', dur: 1 }] }]);
  assert.deepStrictEqual(solo.sources.map((q) => q.src), ['x']);
  // Aralık: from/to kaynağı keser, ofset kayar
  const r = A.mixDescription([{ clips: [{ src: 'x', start: 1, in: 2, dur: 4 }] }], { from: 2, to: 4 });
  assert.deepStrictEqual([r.sources[0].at, r.sources[0].offset, r.sources[0].dur, r.duration], [0, 3, 2, 2]);
  assert.strictEqual(A.hasAudio(tracks), true);
  assert.strictEqual(A.hasAudio([{ mute: true, clips: [{ src: 'x' }] }]), false);
});

test('bölme boşluksuz, birleştirme geri getirir; kırpma kaynağın dışına taşmaz', () => {
  const c = A.makeClip({ id: 'c', src: 'x', start: 2, in: 1, dur: 4, fadeIn: 0.5, fadeOut: 0.5 });
  const [a, b] = A.splitClip(c, 3.25);
  near(a.start + a.dur, b.start);
  near(a.in + a.dur, b.in);
  assert.strictEqual(a.fadeOut, 0);
  assert.strictEqual(b.fadeIn, 0);
  const d = A.mixDescription([{ clips: [a, b] }]);
  near(d.sources[0].at + d.sources[0].dur, d.sources[1].at);
  near(d.sources[0].offset + d.sources[0].dur, d.sources[1].offset);
  const j = A.joinClips(a, b);
  assert.deepStrictEqual([j.start, j.in, j.dur, j.fadeIn, j.fadeOut], [2, 1, 4, 0.5, 0.5]);
  assert.strictEqual(A.splitClip(c, 2), null);
  const l = A.trimStart(c, 0);
  assert.deepStrictEqual([l.start, l.in], [1, 0]);
  const r = A.trimEnd(A.makeClip({ start: 0, in: 1, dur: 1, srcDur: 3 }), 10);
  assert.strictEqual(r.dur, 2);
});

test('kısma: anahtar çalınca hedef saldırı süresinde iner, bırakmada döner', () => {
  const rate = 100;
  const env = new Float32Array(400);
  for (let i = 100; i < 200; i++) env[i] = 0.8;
  const g = A.duckCurve(env, rate, { key: 'k', amount: -12, attack: 0.05, release: 0.3, hold: 0, threshold: 0.1 });
  const low = A.dbToGain(-12);
  near(g[90], 1, 1e-6);
  assert.ok(g[100 + 5] < low * 1.2, 'saldırı ' + g[105]);
  assert.ok(g[199] < low * 1.05);
  assert.ok(g[200 + 30] > 0.9 * 1, 'bırakma ' + g[230]);
  const d = A.mixDescription([
    { id: 'm', clips: [{ src: 'music', start: 0, dur: 4 }], duck: { key: 'v', amount: -12 } },
    { id: 'v', clips: [{ src: 'voice', start: 1, dur: 1 }] },
  ], { peaksOf: (s) => (s === 'voice' ? { rate: 100, data: new Float32Array(100).fill(0.5) } : null) });
  const m = d.sources.find((q) => q.src === 'music');
  near(A.gainAtPoints(m.points, 0.5), 1, 1e-3);
  assert.ok(A.gainAtPoints(m.points, 1.6) < low * 1.2);
});

test('ffmpeg ses ifadesi kazanç noktalarıyla aynı değeri verir', () => {
  const d = A.mixDescription([{ clips: [{ src: 'x', start: 0, dur: 3, fadeIn: 1, fadeOut: 1, curve: 'equal' }], volume: [{ t: 0, db: 0 }, { t: 3, db: -12 }] }]);
  const pts = d.sources[0].points;
  const expr = A.volumeExpr(pts);
  const evalAt = (t) => Function('t', 'lt', 'gte', 'return ' + expr)(t, (a, b) => (a < b ? 1 : 0), (a, b) => (a >= b ? 1 : 0));
  for (let t = 0; t <= 3.0001; t += 0.07) near(evalAt(t), A.gainAtPoints(pts, t), 1e-5, 't=' + t);
  assert.ok(!/if\(/.test(expr), 'iç içe if yok');
  const fc = A.ffmpegFilter(d, () => 0);
  assert.match(fc, /amix=inputs=1:normalize=0/);
  assert.match(fc, /apad,atrim=duration=3\.000000\[mix\]$/);
});

test('geriye uyum: audioTracks ayrı dizi, eski anlık görüntü aynı, sekme değişince taşınır', () => {
  const old = { tracks: [], markers: [], loop: null, tempo: null };
  assert.strictEqual(TE.snapshot(old), JSON.stringify({ tracks: [], markers: [], loop: null, tempo: null }));
  const cfgTl = { tracks: [], markers: [], audioTracks: [{ id: 'a', clips: [] }] };
  const snap = TE.snapshot(cfgTl);
  const back = TE.restore({ tracks: [], markers: [] }, snap);
  assert.deepStrictEqual(back.audioTracks, [{ id: 'a', clips: [] }]);
  assert.strictEqual('audioTracks' in TE.restore({ audioTracks: [1] }, TE.snapshot(old)), false);
  // Model ses parçasını sahne parçasına çevirmez: tracks dizisine hiç girmez
  const tl = T.makeTimeline(cfgTl);
  assert.strictEqual(tl.tracks.length, 0);
  // Sekme: A'nın sesi B'ye geçmez
  const live = { id: 'A', name: 'A', tracks: [], markers: [], audioTracks: [{ id: 'x', clips: [] }] };
  T.ensureTimelineBank(live);
  live.bank.push({ id: 'B', name: 'B', tracks: [], markers: [] });
  live.order.push('B');
  T.switchTimeline(live, 'B');
  assert.strictEqual('audioTracks' in live, false);
  T.switchTimeline(live, 'A');
  assert.deepStrictEqual(live.audioTracks, [{ id: 'x', clips: [] }]);
});

test('dışa aktarma kuralı: kaynak denetimleri', () => {
  const main = read('src/main/main.js');
  // audioPath veren eski çağrı dosyayı kullanır; yalnız audioFrom 'timeline' ya da dosyasız + çizelge sesi karışımı seçer
  assert.match(main, /opts\.audioFrom === 'timeline' \|\| \(opts\.audioFrom !== 'file' && !audioPath && TA\.hasAudio\(jobAudio\)\)/);
  assert.match(main, /timelineAudio\.mixdown\(/);
  assert.match(main, /if \(!exportState\) return; \/\/ tek sefer\n  cleanupExportMedia\(\);\n  timelineAudio\.cleanup\(\);/);
  const M = require('../src/shared/mcp.js');
  const tools = M.tools ? M.tools() : [];
  const exp = tools.find((t) => t.name === 'sv_start_export');
  if (exp && exp.inputSchema) {
    assert.deepStrictEqual(exp.inputSchema.required, ['outputPath']);
    assert.deepStrictEqual(exp.inputSchema.properties.audioFrom.enum, ['file', 'timeline']);
  }
  const admin = read('src/admin/admin.js');
  assert.match(admin, /audioFrom: tlAudio \? 'timeline' : 'file'/);
  // Seçilen çizelgenin sesi yoksa etkin sekmenin sesi işe karışmaz
  const C = require('../src/shared/timeline-compose.js');
  assert.match(read('src/shared/timeline-compose.js'), /if \(!Array\.isArray\(selected\.audioTracks\)\) delete out\.timeline\.audioTracks;/);
  assert.ok(C.exportJobConfig);
});

test('ses dosyaları sv-media ile yalnız yapılandırmada/seçilmişse sunulur', () => {
  const MF = require('../src/main/media-file.js');
  assert.strictEqual(MF.MEDIA_MIME['.mp3'], 'audio/mpeg');
  assert.strictEqual(MF.MEDIA_MIME['.flac'], 'audio/flac');
  const paths = MF.configuredMediaPaths({ timeline: { audioTracks: [{ clips: [{ src: '/a/b.wav' }, null] }] } });
  assert.deepStrictEqual(paths, ['/a/b.wav']);
  assert.match(read('src/main/main.js'), /timelineAudioPicked\.has\(path\.resolve\(raw\)\)/);
  // Ses yalnız yönetim sürecinde: görselleştirici ses bölümünü yüklemez
  assert.ok(!/timeline-audio\.js/.test(read('src/visualizer/index.html')));
  assert.match(read('src/admin/index.html'), /<script src="timeline-audio\.js"><\/script>/);
});

test('ffmpeg karışımı modelin kazancıyla aynı (ffmpeg varsa)', async (t) => {
  let ff = null;
  try { ff = require('ffmpeg-static'); } catch {}
  if (!ff || !fs.existsSync(ff)) { t.skip('ffmpeg yok'); return; }
  const os = require('node:os');
  const { execFileSync } = require('node:child_process');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sv-tla-'));
  try {
    const src = path.join(dir, 'tone.wav');
    // Sabit genlikli DC benzeri sinyal: 0.5 tam ölçek (kare dalga yerine sabit), 48 kHz stereo
    execFileSync(ff, ['-v', 'error', '-y', '-f', 'lavfi', '-i', 'aevalsrc=0.5|0.5:s=48000:d=4', '-c:a', 'pcm_s16le', src]);
    const M = require('../src/main/timeline-audio-main.js');
    const tracks = [{ id: 'a', pan: -0.5, clips: [{ src, start: 0.5, dur: 2, fadeIn: 1, curve: 'linear' }], volume: [{ t: 0, db: 0 }, { t: 3, db: -6 }] }];
    const r = await M.mixdown(ff, tracks, { to: 3 });
    assert.ok(r.ok, r.error);
    const buf = fs.readFileSync(r.file);
    const data = buf.indexOf('data') + 8;
    const sampleAt = (sec, ch) => buf.readInt16LE(data + (Math.round(sec * 48000) * 2 + ch) * 2) / 32768;
    const d = A.mixDescription(tracks, { to: 3 });
    for (const sec of [0.75, 1.0, 1.25, 2.0, 2.4]) {
      const g = A.gainAtPoints(d.sources[0].points, sec - 0.5) * 0.5;
      const [l, rr] = A.panGains(-0.5);
      near(sampleAt(sec, 0), g * l, 2e-3, 'L@' + sec);
      near(sampleAt(sec, 1), g * rr, 2e-3, 'R@' + sec);
    }
    near(sampleAt(0.25, 0), 0, 1e-4, 'başlangıç sessiz');
    near(sampleAt(2.6, 0), 0, 1e-4, 'klipten sonra sessiz');
    near((buf.length - data) / 4 / 48000, 3, 0.01, 'süre');
    M.cleanup();
    assert.ok(!fs.existsSync(r.file), 'geçici dosya silindi');
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});
