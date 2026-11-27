/*
 * SoundVisualizer — CaYaDev Ses Görselleştirici
 * Copyright (c) 2026 Çağan Turgut (CaYatur) — CaYaDev, https://cayadev.com
 * https://github.com/CaYatur/SoundVisualizer
 * SPDX-License-Identifier: MIT
 */
'use strict';
/* DIŞA AKTARMA ÇİZELGE SESİNİ KULLANIR (#1172): ses kaynağı kuralı, kilitli
   seçici ve geçersiz kılma, kuyruk işinin kendi kararı, MCP `audioFrom`,
   geçici karışımın temizlenmesi ve karışımın susturma/solo kuralına uyması. */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const A = require('../src/shared/timeline-audio.js');
const M = require('../src/main/timeline-audio-main.js');
const read = (p) => fs.readFileSync(path.join(__dirname, '..', p), 'utf8').replace(/\r\n/g, '\n');
const near = (a, b, eps, msg) => assert.ok(Math.abs(a - b) <= (eps || 1e-6), (msg || '') + ' ' + a + ' != ' + b);

test('kaynak kuralı: eski çağrılar aynı, çizelge sesi yalnız varsa, geçersiz değer reddedilir', () => {
  const S = A.exportAudioSource;
  // Çizelgede ses yok: önceki sürümle aynı (dosya gerekli)
  assert.deepStrictEqual(S({ audioPath: 'C:/a.wav', timeline: false }), { source: 'file' });
  assert.deepStrictEqual(S({ timeline: false }), { error: 'NO_FILE' });
  // audioPath veren eski çağrı çizelgede ses olsa da dosyayı kullanır
  assert.deepStrictEqual(S({ audioPath: 'C:/a.wav', timeline: true }), { source: 'file' });
  // Dosya verilmezse çizelge sesi
  assert.deepStrictEqual(S({ timeline: true }), { source: 'timeline' });
  assert.deepStrictEqual(S({ audioFrom: 'auto', timeline: true }), { source: 'timeline' });
  // Açık seçim
  assert.deepStrictEqual(S({ audioFrom: 'timeline', audioPath: 'C:/a.wav', timeline: true }), { source: 'timeline' });
  assert.deepStrictEqual(S({ audioFrom: 'timeline', timeline: false }), { error: 'NO_TIMELINE_AUDIO' });
  assert.deepStrictEqual(S({ audioFrom: 'file', timeline: true }), { error: 'NO_FILE' });
  assert.deepStrictEqual(S({ audioFrom: 'file', audioPath: 'C:/a.wav', timeline: true }), { source: 'file' });
  assert.deepStrictEqual(S({ audioFrom: 'mic', timeline: true }), { error: 'BAD_AUDIO_FROM' });
  assert.deepStrictEqual(A.AUDIO_FROM, ['timeline', 'file', 'none']);
  // Çizelge dahil, sesi yok, dosya yok: dosya istenmez, sessiz video
  assert.deepStrictEqual(S({ included: true, timeline: false }), { source: 'none' });
  assert.deepStrictEqual(S({ audioFrom: 'none', included: true }), { source: 'none' });
  assert.deepStrictEqual(S({ audioFrom: 'none', included: false }), { error: 'NO_TIMELINE' });
  // Dosya seçildiyse o kullanılır; çizelge sesi varsa sessizlik değil karışım
  assert.deepStrictEqual(S({ audioPath: 'C:/a.wav', included: true }), { source: 'file' });
  assert.deepStrictEqual(S({ included: true, timeline: true }), { source: 'timeline' });
});

test('özet: duyulur klip sayısı ve uzunluk; susturulan, solo dışı ve kaynaksız sayılmaz', () => {
  const tracks = [
    { id: 'a', clips: [{ src: 'a.mp3', start: 0, dur: 4 }, { src: 'b.mp3', start: 5, dur: 3, mute: true }] },
    { id: 'b', clips: [{ src: 'c.mp3', start: 2, dur: 10 }] },
    { id: 'c', mute: true, clips: [{ src: 'd.mp3', start: 0, dur: 60 }] },
  ];
  assert.deepStrictEqual(A.exportAudioSummary(tracks), { clips: 2, duration: 12 });
  tracks[0].solo = true;
  assert.deepStrictEqual(A.exportAudioSummary(tracks), { clips: 1, duration: 4 });
  assert.deepStrictEqual(A.exportAudioSummary(null), { clips: 0, duration: 0 });
});

test('MCP: audioFrom belgeli, audioPath artık zorunlu değil, eski çağrı değişmeden geçer', async () => {
  const mcp = require('../src/shared/mcp.js');
  const tool = mcp.tools('en').find((t) => t.name === 'sv_start_export');
  const p = tool.inputSchema.properties;
  assert.deepStrictEqual(p.audioFrom.enum, ['timeline', 'file', 'none']);
  assert.match(p.audioFrom.description, /mixdown/);
  assert.strictEqual(p.includeTimeline.type, 'boolean');
  assert.strictEqual(p.timelineId.type, 'string');
  assert.deepStrictEqual(tool.inputSchema.required, ['outputPath']);
  assert.match(tool.description, /audioFrom/);
  let got = null;
  const cfg = { mcp: { enabled: true, mode: 'write' } };
  const ctx = { locale: () => 'en', getConfig: () => cfg, startExport: (a) => { got = a; return { ok: true, audioFrom: a.audioFrom || 'file' }; } };
  const call = (a) => mcp.callTool('sv_start_export', a, ctx);
  // Eski çağrı: argümanlar aynen
  let r = await call({ audioPath: 'C:/a.wav', outputPath: 'C:/v/x.mp4' });
  assert.strictEqual(r.ok, true, JSON.stringify(r));
  assert.deepStrictEqual(got, { audioPath: 'C:/a.wav', outputPath: 'C:/v/x.mp4' });
  // Çizelge sesi: dosya yolu gerekmez
  got = null;
  r = await call({ audioFrom: 'timeline', includeTimeline: true, outputPath: 'C:/v/y.mp4' });
  assert.strictEqual(r.ok, true, JSON.stringify(r));
  assert.strictEqual(got.audioFrom, 'timeline');
  // Geçersiz değer ve dosyasız 'file' iş başlatmaz
  got = null;
  assert.strictEqual((await call({ audioFrom: 'mic', outputPath: 'C:/v/z.mp4' })).ok, false);
  assert.strictEqual((await call({ audioFrom: 'file', outputPath: 'C:/v/z.mp4' })).ok, false);
  assert.strictEqual(got, null);
  const i18n = read('src/shared/i18n.js');
  assert.match(i18n, /"en": "Start an offline video export\. Requires outputPath, plus audioPath unless audioFrom is timeline/);
});

test('ana süreç: kural, karışım, okunur hatalar ve geçici dosyanın temizliği', () => {
  const main = read('src/main/main.js');
  const start = main.indexOf('async function startExportJobInner(opts');
  const body = main.slice(start, main.indexOf('\n}\n', start));
  assert.match(body, /const tlAudio = exportJobTimelineAudio\(jobCfg\);/);
  assert.match(body, /exportAudioSource\(\{ audioFrom: opts\.audioFrom, audioPath: opts\.audioPath, timeline: !!tlAudio, included: tlIncluded \}\)/);
  assert.match(body, /\? await timelineAudio\.silence\(ff, tlLen\)/);
  assert.match(body, /await timelineAudio\.mixdown\(ff, tlAudio, \{ srcPath: /);
  assert.match(body, /mix\.error === 'missing'/);
  assert.match(body, /mix\.error === 'disk'/);
  // Analiz ve ses izi aynı dosyadan: karışım audioPath olur
  assert.match(body, /audioPath = mix\.file;/);
  assert.ok(body.indexOf('audioPath = mix.file;') < body.indexOf('audioBuf = fs.readFileSync(audioPath);'));
  assert.match(body, /timelineMix: useTimelineAudio/);
  // Başlamayan iş karışımı siler; süren başka işinkine dokunmaz
  assert.match(main, /if \(\(!r \|\| !r\.ok\) && !exportState\) timelineAudio\.cleanup\(\);/);
  // Bitiş, iptal ve hata: finalizeExport
  const fin = main.slice(main.indexOf('function finalizeExport('), main.indexOf('function finalizeExport(') + 400);
  assert.match(fin, /if \(exportState\.timelineMix\) timelineAudio\.cleanup\(\);/);
  // Kapanış
  assert.match(main, /flushPartialsSync\(1500\);\n  \/\/ Çizelge sesinin geçici karışımı \(#1172\)\n  try \{ require\('\.\/timeline-audio-main'\)\.cleanup\(\); \}/);
  // Seçilen çizelgenin sesi: exportJobConfig zaten işe taşıyor
  assert.match(main, /function exportJobTimelineAudio\(jobCfg\) \{/);
});

test('kuyruk: her iş kendi ses kararını saklar; çizelge işi dosya yolu taşımaz', () => {
  const main = read('src/main/main.js');
  assert.match(main, /const fromTimeline = want === 'timeline' \|\| want === 'none';/);
  assert.match(main, /opts\.audioFrom = fromTimeline \? want : 'file';/);
  assert.match(main, /audioPath: fromTimeline \? null : r\.audioPath,/);
  assert.match(main, /audioName: it\.audioPath \? path\.basename\(it\.audioPath\) : trUi\('Zaman çizelgesi sesi', 'Timeline audio'\),/);
  const admin = read('src/admin/admin.js');
  assert.match(admin, /if \(exportAudioFrom\(\) !== 'file'\) \{ await queueAddFiles\(\[TIMELINE_AUDIO\]\); return; \}/);
  assert.match(admin, /opts: Object\.assign\(queueItemOpts\(\), \{ audioFrom: from \}\),/);
  assert.match(admin, /includeTimeline: e\.includeTimeline === true,\n      timelineId: /);
});

test('panel: çizelge sesi varken seçici kilitli, geçersiz kılma dosyayı açar, iş kaynağı açıkça gönderilir', () => {
  const admin = read('src/admin/admin.js');
  assert.match(admin, /function exportTimelineAudio\(\) \{/);
  assert.match(admin, /if \(exportTimelineAudio\(\) && !exportAudioOverride\) return 'timeline';/);
  assert.match(admin, /if \(inc && !exportAudioOverride && !exportAudioPath\) return 'none';/);
  assert.match(admin, /const locked = !!tla && !exportAudioOverride;/);
  assert.match(admin, /if \(exporting \|\| exportAudioFrom\(\) === 'timeline'\) return;/);
  assert.match(admin, /box\.addEventListener\('change', \(\) => \{ exportAudioOverride = box\.checked; paint\(true\); \}\);/);
  assert.match(admin, /audioFrom,\n      audioPath: audioFrom === 'file' \? exportAudioPath : undefined,/);
  // Çizelgede ses yoksa eski davranış: dosya yoksa uyarı
  assert.match(admin, /if \(audioFrom === 'file' && !exportAudioPath\) \{\n      setExportStatus\('Önce bir ses dosyası seçin\.', 'err'\);/);
  const i18n = read('src/shared/i18n.js');
  for (const k of ['Zaman çizelgesi sesi kullanılıyor: {n} klip, {d}', 'Başka ses dosyası kullan', 'Zaman çizelgesi sesi karıştırılıyor…', 'Zaman çizelgesi sesi']) {
    assert.ok(i18n.includes("'" + k + "': '"), k);
  }
  assert.match(read('src/admin/admin.css'), /\.filebtn\.disabled, \.filebtn\.disabled:hover \{/);
});

test('geçici karışım: eski oturumların klasörleri silinir, disk dolu iletisi tanınır', () => {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'sv-tla-sweep-'));
  try {
    fs.mkdirSync(path.join(base, M.TEMP_PREFIX + 'old1'));
    fs.writeFileSync(path.join(base, M.TEMP_PREFIX + 'old1', 'timeline-mix.wav'), 'x');
    fs.mkdirSync(path.join(base, 'other-dir'));
    assert.strictEqual(M.sweepStale(base), 1);
    assert.ok(!fs.existsSync(path.join(base, M.TEMP_PREFIX + 'old1')));
    assert.ok(fs.existsSync(path.join(base, 'other-dir')));
    assert.strictEqual(M.sweepStale(path.join(base, 'yok')), 0);
  } finally { fs.rmSync(base, { recursive: true, force: true }); }
  assert.ok(M.isDiskFull('av_interleaved_write_frame(): No space left on device'));
  assert.ok(M.isDiskFull('ENOSPC: no space left'));
  assert.ok(M.isDiskFull('There is not enough space on the disk.'));
  assert.ok(!M.isDiskFull('Invalid data found when processing input'));
});

test('karışım: eksik dosya iş başlamadan okunur hata verir', async () => {
  const r = await M.mixdown('ffmpeg-yok', [{ id: 'a', clips: [{ src: path.join(os.tmpdir(), 'sv-yok-' + Date.now() + '.wav'), start: 0, dur: 2 }] }]);
  assert.strictEqual(r.ok, false);
  assert.strictEqual(r.error, 'missing');
  assert.strictEqual(r.missing.length, 1);
  // Duyulur klip yoksa (hepsi susturulmuş) dosya aranmaz bile
  const e = await M.mixdown('ffmpeg-yok', [{ id: 'a', mute: true, clips: [{ src: 'x.wav', start: 0, dur: 2 }] }]);
  assert.strictEqual(e.ok, false);
});

test('karışım susturma ve solo kuralına uyar (ffmpeg varsa)', async (t) => {
  let ff = null;
  try { ff = require('ffmpeg-static'); } catch {}
  if (!ff || !fs.existsSync(ff)) { t.skip('ffmpeg yok'); return; }
  const { execFileSync } = require('node:child_process');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sv-tla-ms-'));
  try {
    const a = path.join(dir, 'a.wav');
    const b = path.join(dir, 'b.wav');
    execFileSync(ff, ['-v', 'error', '-y', '-f', 'lavfi', '-i', 'aevalsrc=0.25|0.25:s=48000:d=2', '-c:a', 'pcm_s16le', a]);
    execFileSync(ff, ['-v', 'error', '-y', '-f', 'lavfi', '-i', 'aevalsrc=0.5|0.5:s=48000:d=2', '-c:a', 'pcm_s16le', b]);
    const level = async (tracks) => {
      const r = await M.mixdown(ff, tracks, { to: 2 });
      assert.ok(r.ok, r.error);
      const buf = fs.readFileSync(r.file);
      const data = buf.indexOf('data') + 8;
      const v = buf.readInt16LE(data + Math.round(1 * 48000) * 4) / 32768;
      M.cleanup();
      return v;
    };
    const ta = { id: 'a', clips: [{ src: a, start: 0, dur: 2 }] };
    const tb = { id: 'b', clips: [{ src: b, start: 0, dur: 2 }] };
    const [l] = A.panGains(0);
    near(await level([ta, tb]), (0.25 + 0.5) * l, 3e-3, 'ikisi');
    near(await level([ta, Object.assign({}, tb, { mute: true })]), 0.25 * l, 3e-3, 'b susturuldu');
    near(await level([ta, Object.assign({}, tb, { solo: true })]), 0.5 * l, 3e-3, 'b solo');
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('panel: çizelge seçimi, dahil anahtarı ve ses düzenlemesi kilidi beklemeden günceller; varsayılan etkin çizelge', () => {
  const admin = read('src/admin/admin.js');
  // Her push (ses klibi düzenlemesi dahil) kilidi eşzamanlı yeniden değerlendirir
  assert.match(admin, /function push\(immediate\) \{\n    \/\/ Dışa aktarma ses kilidi \(#1172\): ses klibi düzenlemesi de etiketi hemen günceller\n    if \(typeof refreshExportAudio === 'function'\) refreshExportAudio\(\);/);
  assert.match(admin, /exportAudioPaint = paint;/);
  // Seçim değişince kart yeniden çizilir; '' = etkin çizelge (varsayılan)
  assert.match(admin, /label: 'Dışa aktarılacak çizelge', rebuild: true,/);
  assert.match(admin, /value: \(\) => \(cfg\.export && cfg\.export\.timelineId\) \|\| '',/);
  assert.match(admin, /items\.unshift\(\{ value: '', label: tr\('Etkin çizelge'\)/);
  assert.match(admin, /label: 'Zaman çizelgesini dahil et', rebuild: true,/);
  // Süre adı kaynağa göre
  assert.match(admin, /exportAudioFrom\(\) === 'timeline' \? 'Çizelge sesinin süresi' : exportAudioFrom\(\) === 'none' \? 'Zaman çizelgesinin uzunluğu \(sessiz\)' : 'Ses dosyasının süresi'/);
  // Sessiz durumda dosya istenmez, not gösterilir
  assert.match(admin, /if \(from === 'none'\) \{\n        name\.textContent = tr\('Ses dosyası gerekmiyor: video çizelgenin uzunluğunda, sessiz çıkar\.'\);/);
  const i18n = read('src/shared/i18n.js');
  for (const k of ['Ses dosyası gerekmiyor: video çizelgenin uzunluğunda, sessiz çıkar.', 'Çizelge sesinin süresi', 'Zaman çizelgesinin uzunluğu (sessiz)', 'Etkin çizelge']) {
    assert.ok(i18n.includes("'" + k + "': '"), k);
  }
});

test('çizelge sekmeleri: ses parçaları kendi çizelgesinde; seçilen çizelgenin sesi işe gider', () => {
  const TC = require('../src/shared/timeline-compose.js');
  const project = (timelineId) => ({
    layerStack: { enabled: true },
    layers: [{ id: 'manual', kind: 'background', type: 'solid', enabled: false }],
    scenes: [{ id: 's1', name: 'Red', data: { layerStack: { enabled: true }, layers: [{ id: 'red', kind: 'background', type: 'solid' }] } }],
    export: { includeTimeline: true, timelineId },
    timeline: {
      id: 'H', name: 'H', itemEnabled: true, markers: [], loop: { enabled: false, start: 0, end: 0 },
      tracks: [{ id: 't', kind: 'clip', clips: [{ id: 'c1', type: 'scene', ref: 's1', start: 0, dur: 4, transType: 'cut' }] }],
      audioTracks: [{ id: 'au', clips: [{ id: 'ac', src: 'sv-media://x/a.mp3', start: 0, dur: 3 }] }],
      bank: [{ id: 'D', name: 'D', itemEnabled: true, markers: [], loop: { enabled: false, start: 0, end: 0 },
        tracks: [{ id: 't', kind: 'clip', clips: [{ id: 'c2', type: 'scene', ref: 's1', start: 0, dur: 2, transType: 'cut' }] }] }],
    },
  });
  // Etkin çizelge (boş kimlik): H'nin sesi işe gider
  const h = TC.exportJobConfig(project(''), {});
  assert.strictEqual(h.timeline.id, 'H');
  assert.ok(A.hasAudio(h.timeline.audioTracks));
  // D seçiliyse D'nin sesi yok: H'nin sesi sızmaz, kural sessiz videoya düşer (dosya istenmez)
  const d = TC.exportJobConfig(project('D'), {});
  assert.strictEqual(d.timeline.id, 'D');
  assert.ok(!A.hasAudio(d.timeline.audioTracks));
  assert.deepStrictEqual(A.exportAudioSource({ timeline: false, included: true }), { source: 'none' });
});

test('sessiz WAV: çizelgenin uzunluğunda (ffmpeg varsa)', async (t) => {
  let ff = null;
  try { ff = require('ffmpeg-static'); } catch {}
  if (!ff || !fs.existsSync(ff)) { t.skip('ffmpeg yok'); return; }
  const r = await M.silence(ff, 2.5);
  assert.ok(r.ok, r.error);
  const buf = fs.readFileSync(r.file);
  const data = buf.indexOf('data') + 8;
  near((buf.length - data) / 4 / 48000, 2.5, 0.01, 'süre');
  assert.strictEqual(buf.readInt16LE(data + 48000 * 4), 0);
  M.cleanup();
  assert.ok(!fs.existsSync(r.file));
  assert.strictEqual((await M.silence(ff, 0)).ok, false);
});
