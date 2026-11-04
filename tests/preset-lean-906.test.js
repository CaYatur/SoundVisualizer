'use strict';
/* PENCERELERE METİNSİZ PRESET LİSTESİ (#906). 10.392 presette liste 128 MB'tı
   ve her pencerede ayrı bir kopya duruyordu; 1,66 GB bellek ve 11,5 saniyede bir
   216-239 ms çöp toplama. Ölçümler `npm run perf` ile. */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { leanPreset, leanPresets } = require('../src/shared/preset-lean');
const Cycle = require('../src/shared/milkdrop-cycle');

const root = path.join(__dirname, '..');
const read = (rel) => fs.readFileSync(path.join(root, rel), 'utf-8').replace(/\r\n/g, '\n');

test('MilkDrop presetinden metin kalkıyor, işaret ve puan geliyor', () => {
  const p = { id: 'a', kind: 'milkdrop', name: 'A', source: '[preset00]\nfRating=4.5\nzoom=1\n', updatedAt: 7 };
  const c = leanPreset(p);
  assert.strictEqual(c.source, undefined);
  assert.strictEqual(c.lazy, true);
  assert.strictEqual(c.fRating, 4.5);
  assert.strictEqual(c.name, 'A');
  assert.strictEqual(c.updatedAt, 7);
  assert.strictEqual(p.source.length > 0, true, 'özgün kayıt değişmiyor');
});

test('Studio presetleri ve zaten metinsiz kayıt olduğu gibi kalıyor', () => {
  const s = { id: 's', kind: 'visualizer', shader: 'void main(){}' };
  assert.strictEqual(leanPreset(s), s);
  const l = { id: 'b', kind: 'milkdrop', lazy: true, fRating: 2 };
  assert.strictEqual(leanPreset(l), l);
  assert.deepStrictEqual(leanPresets(null), []);
});

test('rastgele seçim metin olmadan dosyadaki puanı görüyor; kullanıcı puanı önde', () => {
  const lean = leanPreset({ id: 'a', kind: 'milkdrop', source: 'fRating=1\n' });
  assert.strictEqual(Cycle.ratingOf(lean, {}), 1);
  assert.strictEqual(Cycle.ratingOf(lean, { a: 5 }), 5);
  assert.strictEqual(Cycle.ratingOf({ id: 'x', kind: 'milkdrop', lazy: true }, {}), Cycle.RATING_DEFAULT);
});

test('ana süreç: liste ve değişiklik yayını metinsiz, metin kimlikle isteniyor', () => {
  const M = read('src/main/main.js');
  assert.match(M, /return leanPresets\(withOverlayPresets\(list\)\);/);
  assert.match(M, /ipcMain\.handle\('presets:source', async \(e, id\) => \{\s*const p = \(await presetsStore\.getAsync\(String\(id \|\| ''\)\)\) \|\| isolatedPreset\(String\(id \|\| ''\)\);/);
  assert.match(M, /const delta = \{ upsert: lean, remove: rm, gen: presetGen \};/);
  assert.match(M, /upsert: bulk \? \[\] : lean/);
  // Etkin presetin metni değiştiyse ayar yine güncelleniyor: ham liste ile
  assert.match(M, /followActivePreset\(up\);/);
  for (const f of ['src/main/preload-admin.js', 'src/main/preload-visualizer.js']) {
    assert.match(read(f), /milkdropPresetSource: \(id\) => ipcRenderer\.invoke\('presets:source', id\),/);
  }
});

test('panel: seçilen presetin metni ayara yazılmadan önce isteniyor; son seçim kazanıyor', () => {
  const P = read('src/admin/milkdrop-panel.js');
  const fn = P.slice(P.indexOf('function loadWithText(cfg, p, then)'), P.indexOf('const byId = '));
  assert.match(fn, /if \(!needsSource\(p\)\)/);
  assert.match(fn, /if \(seq !== goSeq\) return;/);
  assert.match(fn, /put\(now, Object\.assign\(\{\}, p, \{ source: s, lazy: false \}\)\)/);
  assert.match(fn, /function go\(cfg, p, cut\) \{\s*if \(!p\) return;\s*loadWithText\(/);
  assert.match(P, /presetSource: sourceOf/);
  // Liste satırı ve ızgara hücresi metinsiz kaydı doğrudan yüklemiyor
  assert.doesNotMatch(P, /keepScroll\(\); load\(cfg, p\)/);
  assert.strictEqual(P.split('keepScroll(); loadWithText(cfg, p,').length - 1, 2);
});

test('düzenleyici ve karıştırıcı metni kendileri istiyor', () => {
  assert.match(read('src/admin/milkdrop-editor.js'), /panel\.presetSource\(p\)\.then/);
  const G = read('src/admin/milkdrop-gen.js');
  assert.match(G, /fetchDonors\(missing,/);
  assert.match(G, /fetchDonors\(\[p\], fromScreen\)/);
});

test('zar metinsiz listeyi değil, metni getirilmiş örneği çekiyor', () => {
  const G = read('src/admin/milkdrop-gen.js');
  const fn = G.slice(G.indexOf('function rollAll()'), G.indexOf('function fromScreen()'));
  assert.match(fn, /poolOf\(list, POOL, \(pool\) =>/);
  assert.match(fn, /draw\(pool, 'look', null\)/);
  assert.match(fn, /draw\(pool, slot, mix\[slot\]\)/);
  assert.doesNotMatch(fn, /draw\(list,/);
  // `pick` metni olmayan kaydı aday saymıyor: metinsiz liste sonuç vermez
  const Mix = require('../src/shared/milkdrop-mashup');
  assert.strictEqual(Mix.pick([{ id: 'a', lazy: true }], 'look', () => 0, null), null);
  assert.strictEqual(Mix.pick([{ id: 'a', source: 'x' }], 'look', () => 0, null).id, 'a');
});

test('OSC ile çağrılan presetin metni de geliyor', () => {
  const C = read('src/admin/control.js');
  assert.match(C, /if \(hit\.lazy && mp\.go\) mp\.go\(cfg, hit\);/);
});

test('motor: metin listeye yazılmıyor, önbellek küçük kalıyor', () => {
  const E = read('src/visualizer/modes/milkdrop.js');
  const fn = E.slice(E.indexOf('_lazySource(id) {'), E.indexOf('_prefetch(p) {'));
  assert.doesNotMatch(fn, /p\.source = /);
  assert.match(fn, /if \(box\.size > 6\) box\.delete/);
  assert.match(fn, /p\.updatedAt/, 'kaydedilen preset yeniden isteniyor');
});

test('hata metni çevrilmiş', () => {
  assert.match(read('src/shared/i18n.js'), /'Preset dosyası okunamadı\.': 'Could not read the preset file\.'/);
});
