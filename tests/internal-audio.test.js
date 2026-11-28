'use strict';
/* Uygulamanın kendi sesi (#1213): zaman çizelgesi sesinin iç çözümlemesi,
 * seçili kaynakla karışım kuralı, kendi sürecimizi hariç tutma planı ve
 * kare kesilince donmak yerine sessizliğe süzülme. */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const IA = require('../src/shared/internal-audio.js');

const ROOT = path.join(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');

function sine(hz, amp, sr) {
  const a = new Float32Array(IA.FFT_SIZE);
  for (let i = 0; i < a.length; i++) a[i] = amp * Math.sin((2 * Math.PI * hz * i) / sr);
  return a;
}
const peakBin = (f) => { let m = -1, at = 0; for (let i = 0; i < f.length; i++) if (f[i] > m) { m = f[i]; at = i; } return at; };

test('buildFrame: yardımcının biçimi ve dB ölçeği', () => {
  const build = IA.createFrameBuilder();
  const f = build(sine(1000, 0.5, 48000), null, 48000);
  assert.strictEqual(f.freq.length, IA.BINS);
  assert.strictEqual(f.time.length, IA.FFT_SIZE);
  assert.strictEqual(f.left.length, IA.FFT_SIZE);
  assert.strictEqual(f.right.length, IA.FFT_SIZE);
  assert.strictEqual(f.sampleRate, 48000);
  const at = peakBin(f.freq);
  assert.ok(Math.abs(at * 48000 / IA.FFT_SIZE - 1000) < 48000 / IA.FFT_SIZE * 1.5, 'tepe 1 kHz kutusunda');
  assert.ok(f.freq[at] > 200);
  // Sessiz giriş: tayf 0, zaman 128
  const z = build(new Float32Array(IA.FFT_SIZE), new Float32Array(IA.FFT_SIZE), 44100);
  assert.ok(z.freq.every((v) => v === 0));
  assert.ok(z.time.every((v) => v === 128));
  assert.strictEqual(z.sampleRate, 44100);
});

test('buildFrame: sol ve sağ kanal ayrı taşınır, mono ortalama', () => {
  const build = IA.createFrameBuilder();
  const L = new Float32Array(IA.FFT_SIZE).fill(0.5);
  const R = new Float32Array(IA.FFT_SIZE).fill(-0.5);
  const f = build(L, R, 48000);
  assert.ok(f.left[10] > 128 && f.right[10] < 128);
  assert.strictEqual(f.time[10], 128);
});

test('mixFrames: tayf güçte toplanır, zaman alanı toplanır, sessiz taraf seviyeyi değiştirmez', () => {
  const build = IA.createFrameBuilder();
  const a = build(sine(500, 0.01, 48000), null, 48000);
  const silent = build(new Float32Array(IA.FFT_SIZE), null, 48000);
  const m = IA.mixFrames(a, silent);
  assert.deepStrictEqual(Array.from(m.freq), Array.from(a.freq));
  assert.deepStrictEqual(Array.from(m.time), Array.from(a.time));
  // Aynı kare iki kez: güç iki katı (+3 dB) — bayt olarak ~+10,6
  const twice = IA.mixFrames(a, a);
  const at = peakBin(a.freq);
  const lift = twice.freq[at] - a.freq[at];
  assert.ok(lift >= 9 && lift <= 12, 'güç toplamı +3 dB: ' + lift);
  // İki sessiz kare sessiz kalır
  assert.ok(IA.mixFrames(silent, silent).freq.every((v) => v === 0));
  // Biri yoksa öbürü aynen döner
  assert.strictEqual(IA.mixFrames(null, a), a);
  assert.strictEqual(IA.mixFrames(a, null), a);
  // Zaman alanı kırpılır
  const loud = build(new Float32Array(IA.FFT_SIZE).fill(0.9), null, 48000);
  const sum = IA.mixFrames(loud, loud);
  assert.strictEqual(sum.time[0], 255);
});

test('captureCarriesSelf: varsayılan sistem çıkışı ve varsayılan aygıtta çalma', () => {
  assert.strictEqual(IA.captureCarriesSelf({ sources: ['default'], sinkDefault: true }), true);
  assert.strictEqual(IA.captureCarriesSelf({ sources: ['default'], sinkDefault: true, selfExcluded: true }), false);
  // Zaman çizelgesi başka bir aygıtta çalıyor: varsayılan çıkışın loopback'inde yok
  assert.strictEqual(IA.captureCarriesSelf({ sources: ['default'], sinkDefault: false }), false);
  // Mikrofon ya da adıyla seçilmiş aygıt; kaynak yok
  assert.strictEqual(IA.captureCarriesSelf({ sources: ['Mikrofon (USB)'], sinkDefault: true }), false);
  assert.strictEqual(IA.captureCarriesSelf({ sources: [], sinkDefault: true }), false);
  assert.strictEqual(IA.captureCarriesSelf({ sources: ['demo'] }), false);
});

test('planSelfExclusion: yalnız Windows, destek ve zaman çizelgesi sesi varken', () => {
  const base = { platform: 'win32', available: true, helper: true, hasTimelineAudio: true, selfPid: 1234, selfMatch: 'SoundVisualizer.exe' };
  const p = IA.planSelfExclusion(['default', 'Mikrofon'], base);
  assert.strictEqual(p.applied, true);
  assert.deepStrictEqual(p.sources[0], { kind: 'app', mode: 'exclude', self: true, match: 'SoundVisualizer.exe', pid: 1234, label: 'System audio (without this app)' });
  assert.strictEqual(p.sources[1], 'Mikrofon');
  for (const o of [
    { platform: 'linux' }, { platform: 'darwin' }, { available: false }, { helper: false },
    { hasTimelineAudio: false }, { enabled: false }, { selfPid: 0 },
  ]) {
    const r = IA.planSelfExclusion(['default'], Object.assign({}, base, o));
    assert.strictEqual(r.applied, false, JSON.stringify(o));
    assert.deepStrictEqual(r.sources, ['default']);
  }
  // Sistem çıkışı seçili değil
  assert.strictEqual(IA.planSelfExclusion(['Mikrofon'], base).applied, false);
  // Kullanıcının kendi hariç tutma kaynağı varsa ikincisi açılmaz
  const user = { kind: 'app', match: 'spotify.exe', mode: 'exclude' };
  assert.strictEqual(IA.planSelfExclusion(['default', user], base).applied, false);
});

test('hasTimelineAudio: klibi olan bir ses parçası', () => {
  assert.strictEqual(IA.hasTimelineAudio(null), false);
  assert.strictEqual(IA.hasTimelineAudio({ timeline: { audioTracks: [{ clips: [] }] } }), false);
  assert.strictEqual(IA.hasTimelineAudio({ timeline: { audioTracks: [{ clips: [{ id: 'a' }] }] } }), true);
});

test('createInternalFeed: karışım seçimi ve tek başına gönderme', () => {
  const feed = IA.createInternalFeed();
  const build = IA.createFrameBuilder();
  const ext = build(sine(200, 0.3, 48000), null, 48000);
  const own = build(sine(3000, 0.3, 48000), null, 48000);
  // Panel karesi yokken dış kare aynen
  assert.strictEqual(feed.combine(ext, 1000, false), ext);
  assert.strictEqual(feed.deliverAlone(1000), false);
  // Dış kaynak akmıyor: panel karesi tek başına gider
  feed.push(own, 1000, '');
  assert.strictEqual(feed.active(1000), true);
  assert.strictEqual(feed.deliverAlone(1000), true);
  // Dış kaynak akıyor: karışır, tek başına gitmez
  feed.noteExternal(1010);
  assert.strictEqual(feed.deliverAlone(1020), false);
  const m = feed.combine(ext, 1020, false);
  assert.ok(m.freq[peakBin(ext.freq)] >= ext.freq[peakBin(ext.freq)]);
  assert.ok(m.freq[peakBin(own.freq)] >= own.freq[peakBin(own.freq)] - 1, 'iki kaynak da karışımda');
  // Yakalama kendi sesimizi zaten taşıyor: iki kez sayılmaz
  assert.strictEqual(feed.combine(ext, 1020, true), ext);
  // Panel karesi bayatladı (çalma durdu): artık karışmaz
  assert.strictEqual(feed.combine(ext, 1000 + IA.FRESH_MS + 1, false), ext);
  // Dış kaynak durdu: panel karesi yine tek başına
  assert.strictEqual(feed.deliverAlone(1010 + IA.EXTERNAL_MS + 1), true);
  // Çıkış aygıtı bilgisi
  assert.strictEqual(feed.sinkDefault(), true);
  feed.push(own, 2000, 'usb-headset');
  assert.strictEqual(feed.sinkDefault(), false);
});

test('decaySilence: son kare donmaz, yumuşakça sıfıra iner', () => {
  const freq = new Uint8Array(IA.BINS).fill(200);
  const time = new Uint8Array(IA.FFT_SIZE).fill(250);
  const left = new Uint8Array(IA.FFT_SIZE).fill(10);
  const right = new Uint8Array(IA.FFT_SIZE).fill(128);
  const arrs = { freq, time, left, right };
  const done1 = IA.decaySilence(arrs, 1 / 60);
  assert.strictEqual(done1, false);
  // Tek karede sert düşmez (yumuşak), ama azalır
  assert.ok(freq[0] < 200 && freq[0] > 150, 'yumuşak iniş: ' + freq[0]);
  assert.ok(time[0] < 250 && time[0] > 128);
  assert.ok(left[0] > 10 && left[0] < 128);
  let n = 0;
  let done = false;
  while (!done && n < 600) { done = IA.decaySilence(arrs, 1 / 60); n++; }
  assert.strictEqual(done, true);
  assert.ok(n / 60 < 2, 'iki saniyeden kısa sürede sessiz: ' + (n / 60).toFixed(2));
  assert.ok(freq.every((v) => v === 0));
  assert.ok(time.every((v) => v === 128) && left.every((v) => v === 128) && right.every((v) => v === 128));
});

test('bağlantılar: panel dokunusu, ana süreç karışımı, görselleştirici sönümü', () => {
  const tl = read('src/admin/timeline-audio.js');
  assert.match(tl, /SVTimelineAudioTap\.attach\(ctx, master/);
  const tap = read('src/admin/timeline-audio-tap.js');
  assert.match(tap, /timelineAudioFrame/);
  // Çıkış aygıtına giden yol değişmez (yayın yazılımları sesi duymaya devam eder)
  assert.doesNotMatch(tap, /disconnect\(/);
  assert.match(read('src/main/preload-admin.js'), /timelineAudioFrame: \(frame\) => ipcRenderer\.send\('timeline-audio:frame'/);
  assert.match(tap, /timelineAudioPcm/);
  const main = read('src/main/main.js');
  assert.match(main, /fromTimeline\) timelinePcmAt = Date\.now\(\)/);
  assert.match(main, /function captureLabelOwned\(\)/);
  assert.match(main, /lastCaptureSource\.length > 0/);
  assert.match(main, /timelinePcmAt && Date\.now\(\) - timelinePcmAt < 250\) return/);
  assert.match(main, /ipcMain\.on\('timeline-audio:frame'/);
  assert.match(main, /internalFeed\.combine\(frame, now, captureCarriesSelf\(\)\)/);
  assert.match(main, /selfExclusionPlan\(real\)/);
  const admin = read('src/admin/index.html');
  assert.ok(admin.indexOf('../shared/internal-audio.js') >= 0);
  assert.ok(admin.indexOf('timeline-audio-tap.js') < admin.indexOf('"timeline-audio.js"'));
  for (const p of ['src/visualizer/index.html', 'src/web/overlay.html']) {
    const h = read(p);
    const at = h.indexOf('internal-audio.js');
    assert.ok(at >= 0 && at < h.indexOf('audio.js"', at + 20), p);
  }
  assert.match(read('src/visualizer/audio.js'), /decaySilence/);
  // Kendi sürecimiz süreç listesinde aranmaz, bekçi onu "kapandı" saymaz
  const helper = read('src/main/loopback-helper.js');
  assert.match(helper, /app\.self && app\.pid > 0/);
  assert.match(helper, /wantedApps\[i\]\.self/);
  const AA = require('../src/shared/app-audio.js');
  assert.strictEqual(AA.splitSources([{ kind: 'app', match: 'x.exe', mode: 'exclude', self: true, pid: 5 }]).apps[0].self, true);
  assert.strictEqual(AA.splitSources([{ kind: 'app', match: 'x.exe' }]).apps[0].self, undefined);
});

test('selfExclusionEnabled: varsayılan açık, yalnız false kapatır', () => {
  assert.strictEqual(IA.selfExclusionEnabled(null), true);
  assert.strictEqual(IA.selfExclusionEnabled({ audio: {} }), true);
  assert.strictEqual(IA.selfExclusionEnabled({ audio: { excludeSelf: false } }), false);
});
