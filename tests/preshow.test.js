'use strict';
/* GÖSTERİ ÖNCESİ DENETİM (#545): her denetimin hâli ve genel sonuç;
 * sahnenin başvurduğu öğeler; bağlantılar ve çeviriler. */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const S = require('../src/main/preshow.js');

const root = path.join(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(root, p), 'utf8').replace(/\r\n/g, '\n');
const GOOD = {
  displays: [{ id: 1 }, { id: 2 }], wantedDisplays: [2],
  outputs: [{ displayId: 2, fps: 59.5, target: 60 }],
  audio: { wanted: true, ageMs: 30, level: 0.3 },
  missing: { media: [], logos: [], presets: [] },
  redundancy: { role: 'primary', peers: 1, show: { differences: 0 } },
  disks: [{ label: 'userData', free: 50e9 }],
};
const by = (r, id) => r.checks.find((c) => c.id === id);
const withOver = (o) => Object.assign({}, GOOD, o);

test('her şey yerindeyse düzen hazır', () => {
  const r = S.evaluate(GOOD);
  assert.strictEqual(r.overall, 'ok');
  assert.ok(r.checks.every((c) => c.state === 'ok'), JSON.stringify(r.checks));
});

test('seçili ekran yok, ses yok, dosya eksik, yedek yok: hazır değil', () => {
  assert.strictEqual(by(S.evaluate(withOver({ wantedDisplays: [3] })), 'displays').state, 'fail');
  const silent = S.evaluate(withOver({ audio: { wanted: true, ageMs: 5000 } }));
  assert.strictEqual(by(silent, 'audio').state, 'fail');
  assert.strictEqual(silent.overall, 'fail');
  assert.strictEqual(by(S.evaluate(withOver({ audio: { wanted: true, ageMs: 10, level: 0 } })), 'audio').state, 'warn');
  assert.strictEqual(by(S.evaluate(withOver({ audio: { wanted: false } })), 'audio').state, 'info');
  const files = by(S.evaluate(withOver({ missing: { media: ['bg.mp4'], logos: [], presets: ['usr_1'] } })), 'files');
  assert.strictEqual(files.state, 'fail');
  assert.deepStrictEqual(files.parts, ['2', 'bg.mp4', 'usr_1']);
  assert.strictEqual(by(S.evaluate(withOver({ redundancy: { role: 'primary', peers: 0 } })), 'redundancy').state, 'fail');
  assert.strictEqual(by(S.evaluate(withOver({ redundancy: { role: 'primary', peers: 1, show: { differences: 3 } } })), 'redundancy').state, 'warn');
  assert.strictEqual(by(S.evaluate(withOver({ redundancy: { role: 'backup', state: 'connecting' } })), 'redundancy').state, 'fail');
  assert.strictEqual(by(S.evaluate(withOver({ redundancy: { role: 'off' } })), 'redundancy').state, 'info');
});

test('kare hızı: hedefin %90\'ı altında uyarı; sessizlikte duraklatılan çıkış sayılmaz', () => {
  const slow = by(S.evaluate(withOver({ outputs: [{ displayId: 2, fps: 40, target: 60 }] })), 'outputs');
  assert.strictEqual(slow.state, 'warn');
  assert.deepStrictEqual(slow.parts, ['40 / 60 fps']);
  assert.strictEqual(by(S.evaluate(withOver({ outputs: [{ displayId: 2, fps: 55, target: 60 }] })), 'outputs').state, 'ok');
  assert.strictEqual(by(S.evaluate(withOver({ outputs: [{ displayId: 2, fps: 0, paused: true, target: 60 }] })), 'outputs').state, 'info');
  assert.strictEqual(by(S.evaluate(withOver({ outputs: [] })), 'outputs').state, 'warn', 'ekran seçili ama pencere yok');
});

test('disk 2 GB altında uyarı', () => {
  const d = by(S.evaluate(withOver({ disks: [{ label: 'export', free: 1.2e9 }] })), 'disk');
  assert.strictEqual(d.state, 'warn');
  assert.deepStrictEqual(d.parts, ['export: 1.2 GB']);
});

test('sahnenin başvurduğu logo ve kullanıcı presetleri, kayıtlı sahneler dahil; yerleşik presetler sayılmaz', () => {
  const cfg = {
    logo: { libraryId: 'img_a', swap: { items: ['img_b'] } },
    custom: { visualizerId: 'usr_v', backgroundId: 'builtin_bg' },
    layers: [{ presetId: 'usr_l', settings: { logo: { libraryId: 'img_c' } } }],
    scenes: [{ data: { custom: { visualizerId: 'usr_s' }, logo: { libraryId: 'img_d' } } }],
  };
  const r = S.references(cfg);
  assert.deepStrictEqual(r.logos.sort(), ['img_a', 'img_b', 'img_c', 'img_d']);
  assert.deepStrictEqual(r.presets.sort(), ['usr_l', 'usr_s', 'usr_v']);
});

test('bağlantılar ve çeviriler', () => {
  const main = read('src/main/main.js');
  assert.match(main, /ipcMain\.handle\('preshow:check', \(\) => preshowCheck\(\)\);/);
  assert.match(main, /outputFps\.set\(e\.sender\.id, \{ fps: Number\(data\.fps\) \|\| 0, measuring:/, 'ilk pencere süzgecinden önce');
  assert.ok(main.indexOf('outputFps.set(e.sender.id') < main.indexOf('const primary = meterWindow();'), 'ilk pencere süzgecinden önce');
  assert.match(main, /lastAudioFrameAt = Date\.now\(\); \/\/ gösteri öncesi denetim/);
  assert.match(read('src/visualizer/visualizer.js'), /\n        fps: fpsMeasured \? drawFps : null,\n        paused: lastSilent,/);
  assert.match(read('src/admin/index.html'), /<script src="preshow-panel\.js"><\/script>/);
  assert.match(read('src/admin/admin.js'), /case 'preshowpanel':/);
  const i18n = read('src/shared/i18n.js');
  const src = read('src/main/preshow.js') + read('src/admin/preshow-panel.js');
  // Panelde ve denetimde görünen her sabit Türkçe cümlenin İngilizcesi var
  const texts = [...src.matchAll(/add\('[a-z]+', '[a-z]+', '([^']+)'/g)].map((m) => m[1])
    .concat(Object.values({ a: 'Düzen hazır', b: 'Düzen hazır değil', c: 'Şimdi Denetle', d: 'Gösteri Öncesi Denetim' }));
  assert.ok(texts.length >= 20);
  texts.forEach((t) => assert.ok(i18n.includes("'" + t + "':"), 'çeviri yok: ' + t));
});
