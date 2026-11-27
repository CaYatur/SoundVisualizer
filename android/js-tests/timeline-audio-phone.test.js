/*
 * SoundVisualizer — CaYaDev Ses Görselleştirici
 * Copyright (c) 2026 Çağan Turgut (CaYatur) — CaYaDev, https://cayadev.com
 * https://github.com/CaYatur/SoundVisualizer
 * SPDX-License-Identifier: MIT
 */
'use strict';
/* Telefonda çizelge ses şeritleri (#1172, src/mobile/shell-timeline-audio.js): ulaşılabilirlik
   ve yeniden bağlama, karışımın Web Audio'ya kurulması (masaüstündeki mixDescription ile aynı
   kaynaklar), canlı çalmanın çizelge saatini izlemesi, WAV ve parça parça yazma; uygulama tarafı
   (içe aktarma, karışım dosyası, dışa aktarma işi) ve betik sırası. */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const root = path.join(__dirname, '..', '..');
const read = (p) => fs.readFileSync(path.join(root, p), 'utf8').replace(/\r\n/g, '\n');
const TA = require(path.join(root, 'src/shared/timeline-audio.js'));

// Web Audio'nun kayıt tutan sahtesi: kurulan kaynaklar, başlangıçları ve kazanç noktaları
function fakeAudio(log) {
  const param = (o) => ({ value: 1, setValueAtTime: (v, t) => o.push(['set', v, t]), linearRampToValueAtTime: (v, t) => o.push(['ramp', v, t]) });
  const node = () => ({ connect() {}, disconnect() {} });
  class Ctx {
    constructor(ch, len, rate) { this.currentTime = 0; this.state = 'running'; this.dims = [ch, len, rate]; this.destination = node(); log.ctxs.push(this); }
    createBufferSource() { const n = Object.assign(node(), { start: (...a) => { n.started = a; }, stop: () => { n.stopped = true; } }); log.sources.push(n); return n; }
    createGain() { const pts = []; const g = Object.assign(node(), { gain: param(pts), pts }); log.gains.push(g); return g; }
    createChannelSplitter() { return node(); }
    createChannelMerger() { return node(); }
    decodeAudioData(ab, ok) { const sec = new Uint8Array(ab)[0]; ok(buffer(sec, 1000)); }
    resume() {}
    startRendering() { return Promise.resolve(buffer(this.dims[1] / this.dims[2], this.dims[2], this.dims[0])); }
  }
  return Ctx;
}
function buffer(sec, rate, ch) {
  const n = Math.round(sec * rate);
  const chans = Array.from({ length: ch || 1 }, (x, k) => Float32Array.from({ length: n }, (y, i) => (k ? -0.5 : 0.5) * (i % 2 ? 1 : -1)));
  return { duration: sec, sampleRate: rate, length: n, numberOfChannels: chans.length, getChannelData: (c) => chans[c] };
}

function load(over) {
  const log = { ctxs: [], sources: [], gains: [], writes: [], intervals: [] };
  const Ctx = fakeAudio(log);
  const files = Object.assign({ '/files/a.wav': 10, '/files/b.wav': 4 }, (over && over.files) || {});
  const window = {
    SVTimelineAudioCore: TA,
    AudioContext: Ctx,
    OfflineAudioContext: Ctx,
    SVAndroid: {
      media: { pick: () => Promise.resolve({ uri: 'content://x/new.mp3', name: 'new.mp3' }) },
      timelineAudio: {
        import: (uri) => { files['/files/tla-1-new.mp3'] = 7; return Promise.resolve({ url: '/files/tla-1-new.mp3', name: 'new.mp3', from: uri }); },
        write: (name, data, first) => { log.writes.push({ name, data, first }); return Promise.resolve({}); },
      },
    },
  };
  const ctx = {
    window, console, Promise, Math, JSON, Map, Set, Array, Object, Number, String, Error, Float32Array, Uint8Array, DataView, ArrayBuffer,
    btoa: (s) => Buffer.from(s, 'latin1').toString('base64'),
    fetch: (u) => Promise.resolve(files[u] != null ? { ok: true, arrayBuffer: () => Promise.resolve(Uint8Array.from([files[u]]).buffer) } : { ok: false, status: 404 }),
    setInterval: (f) => { log.intervals.push(f); return 1; },
  };
  vm.createContext(ctx);
  vm.runInContext(read('src/mobile/shell-timeline-audio.js'), ctx, { filename: 'shell-timeline-audio.js' });
  return { M: window.SVShellTimelineAudio, window, log, files };
}
const tick = () => new Promise((r) => setImmediate(r));

test('ulaşılabilirlik: yalnız uygulamanın medya klasörü; bilgisayar yolları bulunamadı (kaynak başına satır)', async () => {
  const { M } = load();
  assert.strictEqual(M.reachable('/files/a.wav'), true);
  assert.strictEqual(M.reachable('C:\\\\Music\\\\a.mp3'), false);
  assert.strictEqual(M.reachable('/Users/me/a.mp3'), false);
  assert.strictEqual(M.reachable('/files/../secret'), false);
  const tracks = [{ id: 't1', clips: [
    { id: 'c1', src: 'C:\\Music\\song.mp3', name: 'song.mp3', start: 0, dur: 5 },
    { id: 'c2', src: 'C:\\Music\\song.mp3', start: 6, dur: 2 },
    { id: 'c3', src: '/files/a.wav', start: 0, dur: 3 },
    { id: 'c4', src: '/files/gone.wav', start: 9, dur: 1 },
  ] }];
  const lost = await M.check(tracks);
  assert.deepStrictEqual(lost.map((k) => [k.src, k.clips]), [['C:\\Music\\song.mp3', 2], ['/files/gone.wav', 1]]);
  assert.strictEqual(lost[0].name, 'song.mp3');
  assert.strictEqual(M.status('/files/a.wav'), 'ok');
});

test('yeniden bağla: seçilen dosya kopyalanır ve aynı kaynağı kullanan bütün kliplere bağlanır (tek geri al adımı)', async () => {
  const { M, window } = load();
  let list = TA.normalize([{ id: 't1', clips: [{ id: 'c1', src: 'D:\\x.mp3', start: 0, dur: 5 }, { id: 'c2', src: 'D:\\x.mp3', start: 6, dur: 2, name: 'kept' }, { id: 'c3', src: '/files/a.wav', start: 9, dur: 1 }] }]);
  let writes = 0;
  window.SVShellTimeline = { writeAudio: (mut) => { writes++; mut(list); list = TA.normalize(list); } };
  const f = await M.relink('D:\\x.mp3');
  assert.strictEqual(f.src, '/files/tla-1-new.mp3');
  assert.strictEqual(f.srcDur, 7);
  assert.strictEqual(writes, 1);
  assert.deepStrictEqual(list[0].clips.map((c) => c.src), ['/files/tla-1-new.mp3', '/files/tla-1-new.mp3', '/files/a.wav']);
  assert.deepStrictEqual(list[0].clips.map((c) => c.name), ['new.mp3', 'kept', '']);
  assert.strictEqual(list[0].clips[0].srcDur, 7);
});

test('karışım: mixDescription kaynakları çevrimdışı bağlama (44,1 kHz stereo), başlangıç/ofset/süre ve kazanç noktaları aynı', async () => {
  const { M, log } = load();
  const tracks = [
    { id: 't1', gain: -6, clips: [{ id: 'c1', src: '/files/a.wav', start: 1, in: 2, dur: 4, fadeIn: 1 }] },
    { id: 't2', pan: 0.5, clips: [{ id: 'c2', src: '/files/b.wav', start: 0, dur: 3 }] },
    { id: 't3', mute: true, clips: [{ id: 'c3', src: '/files/a.wav', start: 0, dur: 9 }] },
  ];
  const buf = await M.renderMix(tracks, { from: 0, to: 8 });
  const oc = log.ctxs[log.ctxs.length - 1];
  assert.deepStrictEqual(oc.dims, [2, 8 * 44100, 44100]);
  assert.strictEqual(buf.duration, 8);
  const d = TA.mixDescription(tracks, { from: 0, to: 8 });
  const started = log.sources.filter((n) => n.started).map((n) => n.started);
  assert.deepStrictEqual(started, d.sources.map((s) => [s.at, s.offset, s.dur]));
  // İlk kaynağın kazancı: noktalar kaynağın başına göre (gainAtPoints ile aynı)
  const g = log.gains.find((x) => x.pts.length > 3);
  const s0 = d.sources[0];
  assert.deepStrictEqual(g.pts[0], ['set', s0.points[0][1], s0.at]);
  assert.deepStrictEqual(g.pts.slice(1).map((p) => [p[1], +(p[2] - s0.at).toFixed(6)]), s0.points.map((p) => [p[1], p[0]]));
});

test('karışım: bulunamayan kaynakta dışa aktarma düşmez, hangi dosyaların bağlanacağı söylenir', async () => {
  const { M } = load();
  await assert.rejects(M.renderMix([{ id: 't', clips: [{ id: 'c', src: 'C:\\a.mp3', start: 0, dur: 2 }, { id: 'd', src: '/files/a.wav', start: 0, dur: 2 }] }], {}),
    (e) => e.message === 'missing' && e.missing.length === 1 && e.missing[0] === 'C:\\a.mp3');
});

test('WAV: 16 bit PCM başlığı ve örnekler; medya klasörüne 768 KB parçalarla, yalnız ilki baştan', async () => {
  const { M, log } = load();
  const wav = M.encodeWav(buffer(1, 44100, 2));
  const v = new DataView(wav.buffer);
  const tag = (o) => String.fromCharCode(...wav.subarray(o, o + 4));
  assert.deepStrictEqual([tag(0), tag(8), tag(12), tag(36)], ['RIFF', 'WAVE', 'fmt ', 'data']);
  assert.deepStrictEqual([v.getUint16(22, true), v.getUint32(24, true), v.getUint16(34, true), v.getUint32(40, true)], [2, 44100, 16, 44100 * 4]);
  assert.strictEqual(v.getInt16(44, true), -16384);
  assert.strictEqual(v.getInt16(46, true), 16383);
  const name = await M.writeMix(wav);
  assert.strictEqual(name, 'tla-mix-export.wav');
  assert.strictEqual(log.writes.length, Math.ceil(wav.length / (768 * 1024)));
  assert.deepStrictEqual(log.writes.map((w) => w.first), log.writes.map((w, i) => i === 0));
  const back = Buffer.concat(log.writes.map((w) => Buffer.from(w.data, 'base64')));
  assert.ok(back.equals(Buffer.from(wav)));
});

test('canlı çalma çizelge saatini izler: oynarken kurulur, kayınca yeniden kurulur, durunca ve PC hedefinde susar', async () => {
  const { M, window, log } = load();
  const tracks = [{ id: 't1', clips: [{ id: 'c1', src: '/files/a.wav', start: 0, dur: 6 }] }];
  await M.check(tracks);
  const st = { time: 2, playing: true, pc: false, tracks, ref: {} };
  window.SVShellTimeline = { audioState: () => st };
  assert.strictEqual(log.intervals.length, 1);
  M._tick();
  assert.strictEqual(M._live().nodes, 1);
  const first = log.sources[log.sources.length - 1];
  assert.deepStrictEqual(first.started.slice(1), [2, 4]);
  // Kayma yok: yeniden kurulmaz
  M._tick();
  assert.strictEqual(log.sources.length, 1);
  // Atlama (döngü sarması, elle konum): yeniden kurulur
  st.time = 4;
  M._tick();
  assert.strictEqual(first.stopped, true);
  assert.deepStrictEqual(log.sources[1].started.slice(1), [4, 2]);
  // Düzenleme (çizelge nesnesi değişti): yeniden kurulur
  st.ref = {};
  st.time = 0.03;
  log.ctxs[0].currentTime = 0;
  M._tick();
  assert.strictEqual(log.sources.length, 3);
  st.playing = false;
  M._tick();
  assert.strictEqual(M._live().nodes, 0);
  st.playing = true;
  st.pc = true;
  M._tick();
  assert.strictEqual(M._live().nodes, 0);
});

test('çizelge: ses düzenlemesi tek geri al adımı, PC hedefinde yazılmaz; çalma için saat ve parçalar', () => {
  const s = read('src/mobile/shell-timeline.js');
  assert.match(s, /function writeAudio\(mut\) \{\n    if \(pcOn\(\)\) return;/);
  assert.match(s, /c\.audioTracks = TAC\(\)\.normalize\(list\);\n    \}\);\n    history\(\)\.push\(TE\(\)\.snapshot\(tlCfg\(\)\)\);/);
  assert.match(s, /return \{ time: t\.time, playing: !!t\.playing, pc: pcOn\(\), tracks, ref: c \};/);
  assert.match(s, /painted: \(\) => \{ syncHeads\(\); if \(ui\.audio\) ui\.audio\.draw\(\); \},/);
  assert.match(s, /ui\.audio = AUD\(\) && TAC\(\) \? AUD\(\)\.strip\(refs\.audio, \{/);
  assert.match(s, /    writeAudio,\n    audioState,\n/);
  // Anlık görüntü ses parçalarını taşır (geri al ses düzenlemesini de geri alır)
  assert.match(read('src/shared/timeline-edit.js'), /if \(Array\.isArray\(c\.audioTracks\)\) s\.audioTracks = c\.audioTracks;/);
});

test('uygulama: içe aktarma medya klasörüne, karışım yalnız sabit adla ve klasör içinde, dışa aktarma işi karışımı ses yapar', () => {
  const f = read('android/app/src/main/java/com/cayadev/visualizer/export/TimelineAudioFiles.kt');
  assert.ok(f.includes('private val MIX = Regex("tla-mix-[A-Za-z0-9_-]{1,40}\\\\.wav")'));
  assert.match(f, /val f = File\(ExportHub\.mediaDir\(app\), "tla-" \+ System\.currentTimeMillis\(\) \+ "-" \+ safe\)/);
  assert.match(f, /return JSONObject\(\)\.put\("url", "\/files\/" \+ f\.name\)/);
  assert.match(f, /FileOutputStream\(f, !first\)\.use \{ it\.write\(bytes\) \}/);
  const name = /Regex\("(tla-mix-[^"]+)"\)/.exec(f)[1].replace(/\\\\/g, '\\');
  const re = new RegExp('^' + name + '$');
  assert.ok(re.test('tla-mix-export.wav'));
  assert.ok(!re.test('../tla-mix-export.wav') && !re.test('tla-mix-a/b.wav') && !re.test('song.mp3'));
  const r = read('android/app/src/main/java/com/cayadev/visualizer/AppRequests.kt');
  assert.match(r, /"timelineAudioImport" -> \{/);
  assert.match(r, /"mediaAppend" -> try \{/);
  const kt = read('android/app/src/main/java/com/cayadev/visualizer/export/ExportFlow.kt');
  assert.match(kt, /if \(args\.optString\("audioFrom"\) == "timeline"\) \{\n            val mix = TimelineAudioFiles\.mixFile\(app, args\.optString\("audioFile"\)\)\n            cleanup\(\)\n            tempAudio = mix/);
  const host = read('src/mobile/android-host.js');
  assert.match(host, /import: \(uri\) => request\('timelineAudioImport', \{ uri \}\),/);
  assert.match(host, /write: \(name, data, first\) => request\('mediaAppend', \{ name, data, first: !!first \}\),/);
  assert.match(host, /if \(j\.timelineAudioTags && typeof j\.timelineAudioTags === 'object'\) job\.timelineAudioTags = j\.timelineAudioTags;/);
  const shell = read('android/app/src/main/java/com/cayadev/visualizer/web/WebShell.kt');
  const order = ['web/src/shared/timeline-audio.js', 'web/src/mobile/shell-timeline-audio.js', 'web/src/mobile/shell-timeline.js', 'web/src/mobile/shell-export.js'].map((p) => shell.indexOf('"' + p + '"'));
  assert.ok(order.every((i) => i > 0) && order[0] < order[1] && order[1] < order[2], 'sıra: ' + order);
  assert.ok(read('docs/android/HOST.md').includes('timelineAudio.import'));
});
