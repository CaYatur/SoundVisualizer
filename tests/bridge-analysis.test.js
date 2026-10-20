'use strict';
/* SES KÖPRÜSÜ: KÖPRÜNÜN ÇÖZÜMLEMESİ, DAMGALAR VE YEDEK GİRİŞ (#813).
 * Köprü bantları, seviyeyi, vuruşu, BPM'i ve başlangıçları kendi saatiyle
 * damgalayıp yolluyor; alıcı damgayı kendi saatine çeviriyor. Köprü
 * kesilince yedek giriş olağan giriş ya da ayrı bir aygıt (mikser split).
 */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const A = require('../src/main/bridge-analysis');
const B = require('../src/main/audio-bridge');
const F = require('../src/main/audio-frame');

const read = (f) => fs.readFileSync(path.join(__dirname, '..', f), 'utf8').replace(/\r\n/g, '\n');
const SECRET = 'bridge-secret-0123456789';
const until = async (fn, ms) => {
  const end = Date.now() + (ms || 4000);
  while (Date.now() < end) { const v = fn(); if (v) return v; await new Promise((r) => setTimeout(r, 10)); }
  return fn();
};

// Yapay kare: `kick` açıkken bas bölgesi dolu, zaman alanında genlik
function frame(kick, sr) {
  const freq = new Uint8Array(F.BINS);
  const time = new Uint8Array(F.FFT_SIZE).fill(128);
  const rate = sr || 48000;
  for (let i = 0; i < F.BINS; i++) {
    const hz = i / F.BINS * rate / 2;
    freq[i] = kick && hz < 200 ? 230 : hz > 4000 ? 40 : 70;
  }
  if (kick) for (let i = 0; i < time.length; i++) time[i] = 128 + Math.round(100 * Math.sin(i / 8));
  return { sampleRate: rate, freq, time, left: time, right: time };
}

test('çözümleme: bantlar ve seviye kareden', () => {
  const an = A.createAnalyser();
  const loud = an.push(frame(true), 1000);
  assert.ok(loud.bands.bass > 0.7 && loud.bands.bass > loud.bands.mid * 2, JSON.stringify(loud.bands));
  assert.ok(loud.bands.treble < 0.2);
  assert.ok(loud.level > 0.5 && loud.peak > 0.7);
  const quiet = A.createAnalyser().push(frame(false), 1000);
  assert.strictEqual(quiet.level, 0);
  assert.strictEqual(quiet.t, 1000, 'köprünün saatiyle damgalı');
  assert.strictEqual(A.createAnalyser().push(null, 0), null);
});

test('çözümleme: 120 BPM vuruş dizisi — vuruşlar ve BPM görselleştiricinin motoruyla', () => {
  const an = A.createAnalyser();
  let beats = 0;
  let last = null;
  // 60 kare/sn, her 0,5 sn'de bir vuruş karesi (2 kare)
  for (let k = 0; k < 60 * 12; k++) {
    const t = k * (1000 / 60);
    const kick = (k % 30) < 2;
    last = an.push(frame(kick), t);
    if (last.beat) beats++;
  }
  assert.ok(beats >= 20 && beats <= 26, 'vuruş sayısı ' + beats);
  assert.ok(Math.abs(last.bpm - 120) < 3, 'BPM ' + last.bpm);
  assert.ok(last.confidence > 0);
  assert.strictEqual(last.onsets, beats);
});

test('TCP: çözümleme ve meta köprünün saatiyle geliyor, alıcı kendi saatine çeviriyor', async () => {
  let skew = 5000; // köprünün saati 5 sn ileri
  const sender = B.createSender({ port: 0, host: '127.0.0.1', secret: SECRET, now: () => Date.now() + skew });
  const st = await sender.start();
  const got = [];
  let meta = null;
  const rx = B.createReceiver({ host: '127.0.0.1', port: st.port, secret: SECRET, onAnalysis: (a) => got.push(a), onMeta: (m) => { meta = m; } });
  rx.start();
  try {
    await until(() => sender.peerCount() === 1 && rx.status().offsetMs != null);
    const t = Date.now() + skew;
    sender.analysis({ t, bpm: 128, beat: true, level: 0.5 });
    sender.meta({ has: true, title: 'Parça' });
    await until(() => got.length && meta);
    assert.strictEqual(got[0].bpm, 128);
    assert.ok(Math.abs(rx.status().offsetMs - 5000) < 50, 'saat farkı ' + rx.status().offsetMs);
    assert.ok(Math.abs(got[0].localT - (t - 5000)) < 50, 'damga yerel saate çevrildi');
    assert.ok(Math.abs(meta.localT - Date.now()) < 500 && Math.abs(meta.bridgeT - (Date.now() + 5000)) < 500);
    assert.strictEqual(rx.status().analysis.bpm, 128);
  } finally {
    rx.stop();
    await sender.stop();
  }
});

test('ayar: yedek giriş aygıtı; ana süreç köprü kesilince onu yakalıyor', () => {
  assert.strictEqual(B.normalize({}).fallbackSource, '');
  assert.strictEqual(B.normalize({ fallbackSource: 'Mixer Split (USB)' }).fallbackSource, 'Mixer Split (USB)');
  assert.strictEqual(B.normalize({ fallbackSource: 5 }).fallbackSource, '');
  const MAIN = read('src/main/main.js');
  assert.match(MAIN, /if \(bridge\.input && !bridge\.input\.useBridge && bc && typeof bc\.fallbackSource === 'string' && bc\.fallbackSource\) return \[bc\.fallbackSource\];/);
  // Çözümleme yalnız alıcı varken, iki karede bir ya da vuruşta
  assert.match(MAIN, /if \(peers > 0 && a && \(a\.beat \|\| \(\+\+bridge\.analysisN & 1\) === 0\)\) bridge\.sender\.analysis\(a\);/);
  const P = require('../src/main/preshow');
  assert.strictEqual(typeof P.evaluate, 'function');
  const r = P.evaluate({ bridge: { receive: true, state: 'fallback', fallback: true, fallbackSource: 'Mixer Split' } });
  const row = (r.items || r.checks || r).find ? (r.items || r.checks || r).find((x) => x.id === 'bridge') : null;
  assert.ok(row, JSON.stringify(r).slice(0, 300));
  assert.strictEqual(row.text, 'Ses köprüsü sessiz: yedek giriş');
  assert.deepStrictEqual(row.parts, ['Mixer Split']);
});

test('köprü kipi: tek kopya, öz test, Windows görevi ve kısayol', () => {
  const MAIN = read('src/main/main.js');
  assert.match(MAIN, /if \(BRIDGE_ONLY && !SMOKE && !process\.argv\.includes\('--bridge-multi'\)\) \{\n  if \(!app\.requestSingleInstanceLock\(\)\) \{/);
  assert.match(MAIN, /app\.on\('second-instance', \(ev, argv\) => \{\n      if \(!app\.isReady\(\)\) return;\n      openBridgeWindow\(\);\n      if \(Array\.isArray\(argv\) && argv\.includes\('--panel'\)\) openPanelFromBridge\(\);/);
  assert.match(MAIN, /if \(BRIDGE_ONLY\) return runBridgeSmoke\(\);/);
  assert.match(MAIN, /app\.setUserTasks\(\[\{ program: exe, arguments: '--bridge'/);
  const nsh = read('scripts/installer.nsh');
  assert.match(nsh, /CreateShortCut "\$SMPROGRAMS\\CAYADEV Visualizer Audio Bridge\.lnk" "\$INSTDIR\\\$\{APP_EXECUTABLE_FILENAME\}" "--bridge"/);
  assert.match(nsh, /Delete "\$SMPROGRAMS\\CAYADEV Visualizer Audio Bridge\.lnk"/);
  assert.match(read('package.json'), /"smoke:bridge": "node scripts\/start\.js --smoke --bridge"/);
  // Linux deb: masaüstü girdisinde "Ses Köprüsü" eylemi
  const deb = JSON.parse(read('package.json')).build.deb.desktop;
  assert.strictEqual(deb.entry.Actions, 'bridge;');
  assert.strictEqual(deb.desktopActions.bridge.Exec, '"/opt/CAYADEV Visualizer/soundvisualizer" --bridge');
  assert.strictEqual(deb.desktopActions.bridge['Name[tr]'], 'Ses Köprüsü');
});
