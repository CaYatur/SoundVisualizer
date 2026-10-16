'use strict';
/* DIŞA AKTARMA PROFİLLERİ (#522).
 *
 * Bir profil biçimi, çözünürlüğü, kare hızını ve kaliteyi sabitliyor.
 * Ayrı bir alanı yok: panel seçimi ayarların kendisinden türetiyor, bu yüzden
 * bir alan elle değişince profil kendiliğinden "Özel"e dönüyor.
 */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const F = require('../src/shared/export-formats.js');

const read = (p) => fs.readFileSync(path.join(__dirname, '..', p), 'utf8');

test('her profil geçerli değerlerden oluşuyor', () => {
  const ids = new Set();
  for (const p of F.PROFILES) {
    assert.ok(!ids.has(p.id), 'tekrarlı kimlik ' + p.id);
    ids.add(p.id);
    const fmt = F.format(p.set.format);
    assert.ok(fmt, p.id + ' biçimi');
    assert.ok(F.RESOLUTIONS[p.set.resolution], p.id + ' çözünürlüğü');
    assert.ok(F.FPS.includes(p.set.fps), p.id + ' kare hızı');
    assert.ok(!fmt.fpsMax || p.set.fps <= fmt.fpsMax, p.id + ' biçimin sınırını aşmıyor');
    assert.ok(F.QUALITIES.includes(p.set.quality), p.id + ' kalitesi');
  }
  // Konudaki dört profil var
  for (const id of ['youtube-1080p60', 'reels-shorts', 'twitch-overlay', 'master-4k']) assert.ok(F.profile(id), id);
  assert.strictEqual(F.profile('twitch-overlay').set.format, 'webm-vp9-alpha', 'bindirme alfalı');
  assert.deepStrictEqual(F.RESOLUTIONS[F.profile('reels-shorts').set.resolution], [1080, 1920]);
});

test('profil ayarlardan türüyor; bir alan değişince Özel', () => {
  const base = { format: 'mp4-hevc', resolution: '720p', fps: 25, quality: 'balanced', encoder: 'gpu', speed: 'fast' };
  assert.strictEqual(F.matchProfile(base), 'custom');
  const yt = F.applyProfile(base, 'youtube-1080p60');
  assert.strictEqual(F.matchProfile(yt), 'youtube-1080p60');
  assert.strictEqual(yt.encoder, 'gpu', 'kodlayıcı tercihi korunur');
  assert.strictEqual(yt.speed, 'fast', 'hız dengesi korunur');
  assert.strictEqual(F.matchProfile(Object.assign({}, yt, { fps: 30 })), 'custom');
  assert.deepStrictEqual(F.applyProfile(base, 'yok'), base);
  // Kayıttan gelen sayı dize olsa da eşleşir
  assert.strictEqual(F.matchProfile(Object.assign({}, yt, { fps: '60' })), 'youtube-1080p60');
});

test('Türkçe profil adlarının İngilizcesi sözlükte', () => {
  const src = read('src/shared/i18n.js');
  for (const p of F.PROFILES) {
    if (p.label[0] === p.label[1]) continue;
    assert.ok(src.includes("'" + p.label[0] + "': '" + p.label[1] + "'"), p.id);
  }
  assert.ok(src.includes("'Hazır Profil': 'Preset Profile'"));
});

test('MCP: profil varsayılan, açık argüman üstte, bilinmeyen reddedilir', async () => {
  const mcp = require('../src/shared/mcp.js');
  let got = null;
  const cfg = { mcp: { enabled: true, mode: 'write' } };
  const ctx = { locale: () => 'en', getConfig: () => cfg, startExport: (a) => { got = a; return { ok: true }; } };
  const call = (a) => mcp.callTool('sv_start_export', a, ctx);
  let r = await call({ audioPath: 'C:/a.wav', outputPath: 'C:/v/x.mp4', profile: 'reels-shorts' });
  assert.strictEqual(r.ok, true, JSON.stringify(r));
  assert.strictEqual(got.resolution, '1080x1920');
  assert.strictEqual(got.format, 'mp4-h264');
  assert.ok(!('profile' in got), 'profil ana sürece gitmiyor');
  r = await call({ audioPath: 'C:/a.wav', outputPath: 'C:/v/x.mp4', profile: 'reels-shorts', fps: 60 });
  assert.strictEqual(got.fps, 60, 'açık argüman kazanır');
  // Profilin biçimi uzantıyı belirliyor
  r = await call({ audioPath: 'C:/a.wav', outputPath: 'C:/v/x.mp4', profile: 'master-4k' });
  assert.strictEqual(r.ok, false, 'ProRes profili .mp4 yolunu kabul etmez');
  r = await call({ audioPath: 'C:/a.wav', outputPath: 'C:/v/x.mp4', profile: 'yok' });
  assert.strictEqual(r.ok, false);
  const p = mcp.tools('en').find((t) => t.name === 'sv_start_export').inputSchema.properties;
  assert.deepStrictEqual(p.profile.enum, F.PROFILES.map((x) => x.id));
});

test('panel: profil seçimi ayardan türüyor, alanları dolduruyor', () => {
  const A = read('src/admin/admin.js');
  assert.match(A, /value: \(\) => \(window\.SVExportFormats \? window\.SVExportFormats\.matchProfile\(cfg\.export\) : 'custom'\)/);
  assert.match(A, /cfg\.export = FX\.applyProfile\(cfg\.export, id\);/);
  // Genel seçim kutusu kancaları
  assert.match(A, /const cur = typeof def\.value === 'function' \? def\.value\(\) : getPath\(cfg, def\.path\);/);
  assert.match(A, /if \(typeof def\.onChange === 'function'\) def\.onChange\(v\);\s*else setPath\(cfg, def\.path, v\);/);
});

/* Panelde ölçüldü: kare hızı elle değişince profil kutusu eski profili
   göstermeye devam ediyordu — ayar doğruydu, kart yeniden çizilmiyordu. */
test('profili etkileyen her alan kartı yeniden çiziyor', () => {
  const A = read('src/admin/admin.js');
  for (const p of ['export.format', 'export.resolution', 'export.fps', 'export.quality']) {
    const i = A.indexOf("path: '" + p + "'");
    assert.ok(i > 0, p);
    assert.match(A.slice(i, A.indexOf('\n', i)), /rebuild: true/, p);
  }
});
