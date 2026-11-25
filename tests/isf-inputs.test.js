/*
 * SoundVisualizer — CaYaDev Ses Görselleştirici
 * Copyright (c) 2026 Çağan Turgut (CaYatur) — CaYaDev, https://cayadev.com
 * https://github.com/CaYatur/SoundVisualizer
 * SPDX-License-Identifier: MIT
 */
'use strict';
/* ISF girdileri (#404): VALUES/LABELS olan long açılır menü olur, audio ve audioFFT girdileri
   uygulamanın dalga formu ve spektrum dokusuna bağlanır. Diğer girdiler eskisi gibi. */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const read = (p) => fs.readFileSync(path.join(__dirname, '..', p), 'utf8');
global.window = global.window || {};
require('../src/shared/presets.js');
const P = global.window.SVPresets;

const isf = (inputs) => '/*{"ISFVSN":"2","INPUTS":' + JSON.stringify(inputs) + '}*/\nvoid main(){ gl_FragColor = vec4(1.0); }';
const ctl = (r, name) => r.preset.controls.find((c) => c.name === name);

test('VALUES/LABELS olan long: seçenekler, varsayılan, sınırlar; tür yine kaydırıcı', () => {
  const r = P.fromISF(isf([{ NAME: 'mode', TYPE: 'long', VALUES: [0, 1, 2], LABELS: ['Kare', 'Daire', 'Yıldız'], DEFAULT: 1 }]), 'x');
  assert.ok(r.ok);
  const c = ctl(r, 'mode');
  assert.strictEqual(c.type, 'slider');
  assert.deepStrictEqual(c.options, [{ value: 0, label: 'Kare' }, { value: 1, label: 'Daire' }, { value: 2, label: 'Yıldız' }]);
  assert.strictEqual(c.default, 1);
  assert.strictEqual(c.min, 0);
  assert.strictEqual(c.max, 2);
  assert.strictEqual(c.step, 1);
});

test('etiket listesi tutmazsa değerler etiket olur; varsayılan listede yoksa ilk değer', () => {
  const r = P.fromISF(isf([{ NAME: 'm', TYPE: 'long', VALUES: [3, 7], LABELS: ['tek'], DEFAULT: 5 }]), 'x');
  const c = ctl(r, 'm');
  assert.deepStrictEqual(c.options.map((o) => o.label), ['3', '7']);
  assert.strictEqual(c.default, 3);
});

test('VALUES olmayan ya da bozuk long eskisi gibi kaydırıcı, seçenek yok', () => {
  for (const inp of [
    { NAME: 'a', TYPE: 'long', MIN: 0, MAX: 4, DEFAULT: 2 },
    { NAME: 'a', TYPE: 'long', VALUES: [], MIN: 0, MAX: 4, DEFAULT: 2 },
    { NAME: 'a', TYPE: 'long', VALUES: ['x', 1], MIN: 0, MAX: 4, DEFAULT: 2 },
    { NAME: 'a', TYPE: 'long', VALUES: 'abc', MIN: 0, MAX: 4, DEFAULT: 2 },
  ]) {
    const c = ctl(P.fromISF(isf([inp]), 'x'), 'a');
    assert.deepStrictEqual(c, { name: 'a', label: 'a', type: 'slider', min: 0, max: 4, step: 1, default: 2 });
  }
  const f = ctl(P.fromISF(isf([{ NAME: 'f', TYPE: 'float', VALUES: [1, 2] }]), 'x'), 'f');
  assert.ok(!('options' in f), 'float seçenek almaz');
});

test('audio ve audioFFT: dokuya bağlanıyor, denetim üretmiyor, not çevriliyor', () => {
  const r = P.fromISF(isf([{ NAME: 'waveIn', TYPE: 'audio' }, { NAME: 'fftIn', TYPE: 'audioFFT' }, { NAME: 'bad name', TYPE: 'audio' }]), 'x');
  assert.ok(r.ok);
  assert.strictEqual(r.preset.controls.length, 0);
  assert.ok(r.preset.shader.includes('#define waveIn sv_wave'));
  assert.ok(r.preset.shader.includes('#define fftIn sv_spectrum'));
  assert.ok(!r.preset.shader.includes('bad name'));
  // Tanımlar gövdeden önce
  assert.ok(r.preset.shader.indexOf('#define fftIn') < r.preset.shader.indexOf('void isf_main()'));
  assert.strictEqual(r.notes.length, 2);
  const i18n = read('src/shared/i18n.js');
  for (const [note, kind] of [[r.notes[0], 'waveform'], [r.notes[1], 'spectrum']]) {
    const m = new RegExp("\\.replace\\((/\\^\"\\(\\.\\+\\)\" (?:dalga formu|spektrum) girişi[^/]*/), '(\"\\$1\" " + kind + "[^']*(?:\\\\'[^']*)*)'\\)").exec(i18n);
    assert.ok(m, kind + ' kuralı yok');
    const re = eval(m[1]); // eslint-disable-line no-eval
    const en = note.replace(re, m[2].replace(/\\'/g, "'"));
    assert.notStrictEqual(en, note, 'çevrilmedi: ' + note);
    assert.ok(en.startsWith('"' + (kind === 'waveform' ? 'waveIn' : 'fftIn') + '" ' + kind + ' input'), en);
  }
});

test('Studio canlı denetimi seçenekleri açılır menüde gösteriyor; bilmeyen arayüz kaydırıcıda kalıyor', () => {
  const studio = read('src/admin/studio.js');
  assert.ok(studio.includes("} else if (Array.isArray(c.options) && c.options.length) {"));
  assert.ok(studio.includes('store[c.name] = Number(e.target.value)'));
  // Gölgelendirici sunucusu türü bilmeden float uniform tanımlıyor (değişmedi)
  const host = read('src/visualizer/modes/shaderhost.js');
  assert.ok(!host.includes('options'));
});
