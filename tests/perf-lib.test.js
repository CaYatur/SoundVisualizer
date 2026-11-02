'use strict';
/* Gerçek sahne ölçümünün saf parçaları (#910). */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const L = require('../scripts/perf-lib');

test('ayar kopyasında dışarıya yollayan bloklar kapanıyor, gerisi kalıyor', () => {
  const s = L.sanitizeSettings({ lighting: { enabled: true, mode: 'x' }, stream: { enabled: true, port: 1 }, mcp: { enabled: true }, visualizer: { type: 'bars' }, power: { keepAwake: true, fpsCap: 30 } });
  assert.strictEqual(s.lighting.enabled, false);
  assert.strictEqual(s.lighting.mode, 'x');
  assert.strictEqual(s.stream.enabled, false);
  assert.strictEqual(s.mcp.enabled, false);
  assert.strictEqual(s.visualizer.type, 'bars');
  assert.strictEqual(s.power.keepAwake, false);
  assert.strictEqual(s.power.fpsCap, 30);
  assert.strictEqual(s.power.alwaysOnTop, true);
});

test('özgün ayar nesnesi değişmiyor', () => {
  const o = { lighting: { enabled: true } };
  L.sanitizeSettings(o);
  assert.strictEqual(o.lighting.enabled, true);
});

test('Spout yalnız istenince açılıyor', () => {
  assert.strictEqual(L.sanitizeSettings({ textureShare: { enabled: true } }).textureShare.enabled, false);
  assert.strictEqual(L.sanitizeSettings({ textureShare: { enabled: false } }, { spout: true }).textureShare.enabled, true);
});

test('kare özeti: fps süreden, boşluklar eşiğe göre', () => {
  const f = L.frameSummary([10, 10, 10, 10, 110]);
  assert.strictEqual(f.frames, 5);
  assert.strictEqual(f.fps, 33.3);
  assert.strictEqual(f.max, 110);
  assert.strictEqual(f.over100, 1);
  assert.deepStrictEqual(L.frameSummary([]).frames, 0);
});

test('süreç toplamı bir çekirdeğin yüzdesine çeviriyor', () => {
  const t = L.processTotals([{ cpu: 1, wsMB: 100, privMB: 50 }, { cpu: 0.5, wsMB: 20, privMB: 10 }], 32);
  assert.deepStrictEqual(t, { cpuCore: 48, wsMB: 120, privMB: 60 });
});

test('karşılaştırma: küçük iyi olan ölçütte düşüş iyi, fps artışı iyi', () => {
  const now = { steady: { totals: { wsMB: 1000 }, frames: { fps: 75 } } };
  const was = { steady: { totals: { wsMB: 3000 }, frames: { fps: 70 } } };
  const rows = L.compareRuns(now, was);
  const mem = rows.find((r) => r.path === 'steady.totals.wsMB');
  const fps = rows.find((r) => r.path === 'steady.frames.fps');
  assert.strictEqual(mem.deltaPct, -67);
  assert.strictEqual(mem.better, true);
  assert.strictEqual(fps.better, true);
  assert.ok(L.formatReport(rows).includes('Toplam bellek'));
});

test('npm run perf bağlı; betik kullanıcı verisine değil geçici profile yazıyor', () => {
  const root = path.join(__dirname, '..');
  const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
  assert.strictEqual(pkg.scripts.perf, 'node scripts/perf.js');
  const src = fs.readFileSync(path.join(root, 'scripts/perf.js'), 'utf8');
  assert.match(src, /--user-data-dir=/);
  assert.match(src, /mkdtempSync/);
  assert.doesNotMatch(src, /process\.env\.APPDATA/);
});
