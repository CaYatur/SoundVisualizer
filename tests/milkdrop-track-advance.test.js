'use strict';
/* PARÇA DEĞİŞİNCE SIRADAKİ PRESET (#582).
 *
 * Şimdi Çalıyor parçanın değiştiğini zaten biliyor. Otomatik geçişin yanında
 * ayrı bir ayar: yeni parça başlayınca sıradaki preset, Geçiş Sırası'na göre.
 * Seçimi yalnız LİDER motor yapıyor (#585): her ekran kendi başına geçseydi
 * rastgele sırada ekranlar ayrışırdı. Kilit bunu da durduruyor.
 */
global.window = global.window || {};
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
require('../src/shared/defaults.js');
const C = require('../src/shared/milkdrop-cycle.js');

const SRC = fs.readFileSync(path.join(__dirname, '..', 'src', 'visualizer', 'modes', 'milkdrop.js'), 'utf-8')
  .replace(/\r\n/g, '\n');
function method(sig) {
  const i = SRC.indexOf('    ' + sig + ' {');
  assert.ok(i > 0, sig + ' bulunamadı');
  const end = SRC.indexOf('\n    }', i);
  return SRC.slice(i + sig.length + 6, end);
}

const LIST = ['a', 'b', 'c', 'd'].map((id) => ({ id, name: id, source: '' }));
const MD = (o) => Object.assign({ autoNext: 0, autoOrder: 'sequential', trackAdvance: true }, o || {});

// ---------------------------------------------------------------- döngü

test('döngü: ayar kapalıyken hiçbir şey; açıkken sırayla sıradaki', () => {
  const cy = new C.Cycle(() => 0.5);
  assert.strictEqual(cy.onTrack(MD({ trackAdvance: false }), LIST, 'a', null), null);
  assert.strictEqual(cy.onTrack(MD(), LIST, 'a', null).id, 'b');
  assert.strictEqual(cy.onTrack(MD(), LIST, 'd', null).id, 'a', 'sonda başa dönüyor');
  assert.strictEqual(cy.reason, 'TRACK');
  assert.strictEqual(cy.cut, false, 'kesmiyor, ayardaki süreyle karışıyor');
});

test('döngü: kilit, boş liste ve tek preset geçirmiyor', () => {
  const cy = new C.Cycle(() => 0.5);
  assert.strictEqual(cy.onTrack(MD({ locked: true }), LIST, 'a', null), null);
  assert.strictEqual(cy.reason, 'LOCKED');
  assert.strictEqual(cy.onTrack(MD(), [], 'a', null), null);
  assert.strictEqual(cy.onTrack(MD(), [LIST[0]], 'a', null), null);
});

test('döngü: geçince presetin ömrü baştan; önceden yapılmış seçim kullanılıyor', () => {
  const cy = new C.Cycle(() => 0.5);
  const md = MD({ autoNext: 30 });
  cy.step(10, md, LIST, 'a', null, null, null);
  assert.ok(cy.elapsed > 9);
  // Zamanlayıcı sıradakini önceden seçtiyse (#573) parça değişimi de onu alıyor
  const u = cy.upcoming(md, LIST, 'a', null);
  assert.strictEqual(cy.onTrack(md, LIST, 'a', null).id, u.id);
  assert.strictEqual(cy.elapsed, 0, 'zamanlayıcı baştan saymalı');
  assert.strictEqual(C.normalize(MD()).onTrack, true);
  assert.strictEqual(C.normalize({}).onTrack, false);
});

// ---------------------------------------------------------------- motor

test('parça kimliği: ilk görülen, aynı parça ve aradaki boşluk değişim sayılmıyor', () => {
  const changed = new Function(method('_trackChanged()'));
  const self = {};
  const at = (st) => { window.SVNowLive = { state: st }; return changed.call(self); };
  const T = (title, artist) => ({ has: true, title, artist: artist || 'X', album: 'Y' });
  try {
    assert.strictEqual(at(T('bir')), false, 'açılışta çalan parça değişim değil');
    assert.strictEqual(at(T('bir')), false);
    assert.strictEqual(at({ has: false }), false, 'boşluk');
    assert.strictEqual(at(T('bir')), false, 'boşluktan sonra aynı parça');
    assert.strictEqual(at(T('iki')), true, 'yeni parça');
    assert.strictEqual(at(T('iki')), false);
    assert.strictEqual(at(T('iki', 'başka')), true, 'sanatçı da kimliğin parçası');
    assert.strictEqual(at({ has: true, title: '' }), false, 'başlıksız durum yok sayılıyor');
    assert.strictEqual(at(null), false);
  } finally {
    delete window.SVNowLive;
  }
});

/* Motorun kendi `_autoCycle`ı, sahte bir çevreyle. */
function engine() {
  const fn = new Function('cfg', 'step', 'audio', 'PREFETCH_S', method('_autoCycle(cfg, step, audio)'));
  const self = {
    cycle: null, autoPick: null, _manualKey: 'a|0', _rel: null,
    _trackChanged: new Function(method('_trackChanged()')),
    // Döngünün gördüğü ayar (kilit, hareketi azaltma #581) motorun kendi yöntemiyle
    _cycleMd: new Function('BLEND_MAX', 'return function (cfg) {' + method('_cycleMd(cfg)') + '};')(5),
    _beat: () => null, _compileAsync: () => false, _prefetch: () => {},
  };
  self.run = (cfg) => fn.call(self, cfg, 1 / 60, null, 1);
  return self;
}
function withEnv(f) {
  const saved = { c: window.SVMilkdropCycle, p: window.SVPresets, n: window.SVNowLive, f: window.SVMdFollow };
  window.SVMilkdropCycle = C;
  window.SVPresets = { byKind: () => LIST };
  try { return f(); } finally {
    window.SVMilkdropCycle = saved.c; window.SVPresets = saved.p; window.SVNowLive = saved.n; window.SVMdFollow = saved.f;
  }
}
const cfgOf = (md, ctl) => ({ milkdrop: Object.assign({ presetId: 'a', source: '' }, MD(md)), milkdropControl: ctl || {} });
const track = (title) => { window.SVNowLive = { state: { has: true, title, artist: 'X', album: '' } }; };

test('motor: lider parça değişince sırayla sıradakine geçiyor, zamanlayıcı kapalıyken de', () => {
  withEnv(() => {
    const e = engine();
    track('bir');
    e.run(cfgOf());
    assert.strictEqual(e.autoPick, null, 'açılışta geçmemeli');
    track('iki');
    e.run(cfgOf());
    assert.strictEqual(e.autoPick && e.autoPick.id, 'b');
    assert.ok(Number.isInteger(e.autoPick.seed), 'seçim izleyenlere tohumuyla gidiyor (#585)');
    track('üç');
    e.run(cfgOf());
    assert.strictEqual(e.autoPick.id, 'c', 'ekrandaki presetten devam');
    // Ayar kapalı ya da kilitli: geçmiyor
    track('dört');
    e.run(cfgOf({ trackAdvance: false }));
    assert.strictEqual(e.autoPick.id, 'c');
    track('beş');
    e.run(cfgOf({}, { locked: true }));
    assert.strictEqual(e.autoPick.id, 'c', 'kilit bunu da durdurmalı');
  });
});

test('motor: izleyen kendi başına geçmiyor; lider olunca eski değişimi tetiklemiyor', () => {
  withEnv(() => {
    const e = engine();
    track('bir');
    e.run(cfgOf());
    // Liderin seçimi geliyor: bu motor izleyen
    window.SVMdFollow = { id: null, base: 'a|0', at: performance.now() };
    track('iki');
    e.run(cfgOf());
    assert.strictEqual(e.autoPick, null, 'izleyen parça değişiminde kendi seçmemeli');
    // Lider sustu: bu motor lider oldu. Parça değişimi İZLERKEN oldu, tetiklememeli
    window.SVMdFollow = null;
    e.run(cfgOf());
    assert.strictEqual(e.autoPick, null, 'izlerken geçmiş değişim sonradan tetiklenmemeli');
    track('üç');
    e.run(cfgOf());
    assert.strictEqual(e.autoPick && e.autoPick.id, 'b', 'lider olarak yeni değişimde geçmeli');
  });
});

test('ayar, panel ve çeviri', () => {
  assert.strictEqual(global.window.SV.defaultConfig().milkdrop.trackAdvance, false, 'varsayılan kapalı');
  const P = fs.readFileSync(path.join(__dirname, '..', 'src', 'admin', 'milkdrop-panel.js'), 'utf-8');
  assert.match(P, /P\(\)\.row\('Parça Değişince', selOf\(\[\s*\[0, 'Bir şey yapma'\],\s*\[1, 'Sıradaki presete geç'\],/);
  const I = fs.readFileSync(path.join(__dirname, '..', 'src', 'shared', 'i18n.js'), 'utf-8');
  for (const k of ['Parça Değişince', 'Bir şey yapma', 'Sıradaki presete geç']) assert.ok(I.includes("'" + k + "':"), k);
});
