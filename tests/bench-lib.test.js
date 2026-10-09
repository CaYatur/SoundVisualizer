'use strict';
/* Performans ölçümünün (scripts/bench.js) saf parçaları: istatistik,
   senaryo listesi, yama birleştirme, örnek ses ve rapor. */
const test = require('node:test');
const assert = require('node:assert');
const B = require('../scripts/bench-lib.js');
const DEMO = require('../src/shared/demo-audio.js');
const CATALOG = require('../src/shared/mode-catalog.js');

test('kare istatistiği: fps toplam süreden, yüzdelikler sıralı diziden', () => {
  // 9 kare 10 ms, 1 kare 100 ms: 10 kare / 0,19 sn
  const s = B.frameStats([10, 10, 10, 10, 10, 10, 10, 10, 10, 100]);
  assert.strictEqual(s.n, 10);
  assert.strictEqual(s.fps, 52.63);
  assert.strictEqual(s.avg, 19);
  assert.strictEqual(s.p50, 10);
  assert.strictEqual(s.p95, 100);
  assert.strictEqual(s.max, 100);
  assert.strictEqual(s.over33, 10);
  // Geçersiz değerler sayılmaz; boş giriş sıfır döner
  assert.strictEqual(B.frameStats([10, NaN, -1, 0, 10]).n, 2);
  assert.deepStrictEqual(B.frameStats([]), { n: 0, fps: 0, avg: 0, p50: 0, p95: 0, p99: 0, max: 0, over33: 0 });
});

test('senaryolar: katalogun tamamı, efektler ve süzgeç', () => {
  const all = B.scenarios(CATALOG, ['bloom', 'crt']);
  assert.strictEqual(all.filter((s) => s.group === 'visualizer').length, CATALOG.VISUALIZERS.length);
  assert.strictEqual(all.filter((s) => s.group === 'background').length, CATALOG.BACKGROUNDS.length);
  assert.deepStrictEqual(all.filter((s) => s.group === 'postfx').map((s) => s.id), ['bloom', 'crt']);
  // Her sahne katmansız ve kendi türünü veriyor
  const ink = all.find((s) => s.group === 'background' && s.id === 'ink');
  assert.deepStrictEqual(ink.patch, { layers: [], postfx: [], visualizer: { type: 'bars' }, background: { type: 'ink' } });
  // Süzgeç grup:kimlik üzerinde, büyük/küçük harf duyarsız
  const only = B.scenarios(CATALOG, ['bloom'], { only: 'POSTFX:BLO' });
  assert.deepStrictEqual(only.map((s) => s.group + ':' + s.id), ['postfx:bloom']);
});

test('yama birleştirme: nesneler iç içe, diziler değiştirilir', () => {
  const a = { power: { fpsCap: 0, renderScale: 1 }, layers: [1, 2], audio: { sensitivity: 0.6 } };
  const b = { power: { fpsCap: 60 }, layers: [], visualizer: { type: 'bars' } };
  assert.deepStrictEqual(B.mergePatch(a, b), {
    power: { fpsCap: 60, renderScale: 1 }, layers: [], audio: { sensitivity: 0.6 }, visualizer: { type: 'bars' },
  });
  // Girdiler değişmez
  assert.deepStrictEqual(a.power, { fpsCap: 0, renderScale: 1 });
});

test('örnek ses karesi deterministik ve dolu', () => {
  const f1 = B.demoFrame(1.25, DEMO);
  const f2 = B.demoFrame(1.25, DEMO);
  assert.strictEqual(f1.freq.length, 1024);
  assert.strictEqual(f1.time.length, 2048);
  assert.deepStrictEqual(Buffer.from(f1.freq), Buffer.from(f2.freq));
  assert.deepStrictEqual(Buffer.from(f1.left), Buffer.from(f2.left));
  assert.ok(f1.freq.some((v) => v > 100), 'tayf boş');
  assert.strictEqual(f1.sampleRate, DEMO.SR);
});

test('rapor makineyi, kilit durumunu ve tuval notunu yazıyor; en pahalı satır üstte', () => {
  const st = (fps, p95) => ({ n: 100, fps, avg: 1000 / fps, p50: 1000 / fps, p95, p99: p95, max: p95, over33: 0 });
  const md = B.markdown({
    title: 'npm run bench', date: '2026-10-09', commit: 'abc1234',
    machine: { cpu: 'CPU X', cores: 8, ramGb: 16, gpu: 'GPU Y', driver: '1.2', electron: '43.6.0', os: 'Windows', display: '1920×1080 @ 60 Hz' },
    uncapped: false, hz: 165, seconds: 3, warm: 1,
    resolutions: [{ name: '1920×1080', canvas: '1920×1032', note: 'requested 1920×1080', results: [
      { group: 'visualizer', id: 'bars', label: 'Bars', stats: st(500, 3) },
      { group: 'visualizer', id: 'milkdrop', label: 'MilkDrop', stats: st(200, 9) },
      { group: 'postfx', id: 'bloom', label: 'bloom', stats: st(400, 4), error: 'a|b' },
      { group: 'visualizer', id: 'custom', label: 'Custom', stats: st(75, 13.4) },
    ] }],
    soak: { minutes: 1, what: 'x', samples: [{ minute: 1, stats: st(300, 5), heapMb: 12.4 }] },
  });
  assert.match(md, /Commit: `abc1234`, Electron 43\.6\.0/);
  assert.match(md, /GPU: GPU Y, driver 1\.2/);
  assert.match(md, /Vsync \*\*on\*\*: a scene that keeps up reads the refresh rate \(165 Hz\)/);
  assert.match(md, /_requested 1920×1080\._/);
  assert.ok(md.indexOf('MilkDrop (`milkdrop`)') < md.indexOf('Bars (`bars`)'), 'pahalı sahne üstte değil');
  assert.match(md, /⚠ a\/b/);
  // İçerik istemeden boş çizen sahne işaretli
  assert.match(md, /Custom \(`custom`\) — draws nothing without user content/);
  assert.match(md, /\| 1 \| 300\.0 \| 5\.00 \| 12 \|/);
});
