'use strict';
/* MilkDrop 3 çift preseti (.milk2, #567).
 *
 * Biçim gerçek MilkDrop 3.x dosyalarından okundu (depoda değiller; kaynak
 * ve lisans notu proje belleğinde). Buradaki örnek aynı yapıda, küçük.
 * Motor tarafı tarayıcı ister; yol kaynak düzeyinde korunuyor, davranışı
 * perf-tools/milk2probe.js uygulamada ölçüyor (2. aşama 3. karede, geçiş
 * dosyanın noktasında donuk, desen dosyadan). */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
global.window = global.window || {};
const M = require('../src/shared/milkdrop.js');

const P1 = 'NAME=Birinci\nMILKDROP_PRESET_VERSION=201\n[preset00]\nfDecay=0.98\nper_frame_1=zoom = 1.01;\n';
const P2 = 'NAME=İkinci\nMILKDROP_PRESET_VERSION=201\n[preset00]\nfDecay=0.95\nper_frame_1=rot = 0.02;\n';
const DOUBLE = 'Created with MILKDROP 3.33\n\nsprite=1\nblending_pattern=side\nblending_progress=0.55\nblending_direction=-1\n' +
  'random_1=0.25\nrandom_2=0.5\nrandom_3=0.75\nrandom_4=1\nrandom_5=0\n\n' +
  '[PRESET1_BEGIN]\n' + P1 + '[PRESET1_END]\n\n[PRESET2_BEGIN]\n' + P2 + '[PRESET2_END]\n\n' +
  '[SPRITE1_BEGIN]\nSpriteName=sprites\\a.png\n[SPRITE1_END]\n';

test('ayrıştırma: desen, nokta, yön, rastgele sayılar, iki preset ve adları', () => {
  const d = M.parseMilk2(DOUBLE);
  assert.strictEqual(d.pattern, 'side');
  assert.strictEqual(d.progress, 0.55);
  assert.strictEqual(d.direction, -1);
  assert.deepStrictEqual(d.random, [0.25, 0.5, 0.75, 1, 0]);
  assert.deepStrictEqual(d.names, ['Birinci', 'İkinci']);
  assert.strictEqual(d.sprites, 1);
  assert.ok(d.presets[0].startsWith('NAME=Birinci'));
  assert.ok(!/PRESET\d_(BEGIN|END)/.test(d.presets.join('')), 'bölüm işaretleri presete sızmıyor');
  // İki iç preset motorun kendi okuyuşuyla hatasız
  for (const src of d.presets) assert.deepStrictEqual(new M.Preset(src, { seed: 1, accurate: true }).errors, []);
});

test('ayrıştırma: sınırlar ve varsayılanlar; çift olmayan kaynak null', () => {
  const d = M.parseMilk2(DOUBLE.replace('blending_progress=0.55', 'blending_progress=7').replace(/random_2=0\.5\n/, '').replace('blending_pattern=side\n', ''));
  assert.strictEqual(d.progress, 1, 'nokta 0..1');
  assert.strictEqual(d.random[1], 0.5, 'eksik rastgele sayı 0,5');
  assert.strictEqual(d.pattern, 'plasma', 'desen yoksa plazma');
  assert.strictEqual(M.parseMilk2(P1), null, 'olağan preset');
  assert.strictEqual(M.parseMilk2(DOUBLE.replace('[PRESET2_END]', '')), null, 'yarım dosya');
  assert.strictEqual(M.parseMilk2(''), null);
});

const MODE = fs.readFileSync(path.join(__dirname, '..', 'src', 'visualizer', 'modes', 'milkdrop.js'), 'utf8').replace(/\r\n/g, '\n');

test('motor: iki aşamalı yükleme — birinci sert, ikinci geçişle ve donuk', () => {
  const fn = /_ensurePreset\(cfg\) \{[\s\S]*?\n    \}\n/.exec(MODE)[0];
  assert.match(fn, /const dbl = MD && MD\.parseMilk2 \? MD\.parseMilk2\(rawSrc\) : null;/);
  // 2. aşama ancak 1. aşama gerçekten yüklenip derlendiğinde
  assert.match(fn, /d\.stage === 1 && this\.presetKey === baseKey \+ '#1' && this\.preset && !this\._pending\) d\.stage = 2;/);
  assert.match(fn, /const bt = stage === 1 \? 0 : stage === 2 \? 1/);
  assert.match(fn, /const src = stage \? this\._double\.info\.presets\[stage - 1\] : rawSrc;/);
  assert.match(fn, /if \(stage === 2 && this\.oldPreset\) \{\s*this\.blendFrozen = this\._double\.info\.progress;/);
  // Olağan preset gelince donmuş karışım ve zorunlu desen kalkıyor
  assert.match(fn, /\} else if \(stage !== 2\) \{\s*this\.blendFrozen = null;\s*this\._blendForced = null;/);
});

test('motor: donmuşken geçiş ilerlemiyor; desen dosyadan', () => {
  assert.match(MODE, /if \(this\.blendFrozen != null\) this\.blendProg = this\.blendFrozen;\s*else this\.blendProg \+= step \/ Math\.max\(1e-3, this\.blendDur\);/);
  const bp = /_ensureBlendPattern\(\) \{[\s\S]*?\n    \}\n/.exec(MODE)[0];
  assert.match(bp, /const FORCED = \{ side: 1, wipe: 1, plasma: 2, radial: 3, circle: 3, zoom: 3 \};/);
  assert.match(bp, /const type = F \? \(FORCED\[F\.pattern\] \|\| 2\) : 1 \+ Math\.floor\(R\(\) \* 3\);/);
  assert.match(bp, /const dir = F \? F\.direction : \(R\(\) < 0\.5 \? -1 : 1\);/);
});

test('içe aktarma .milk2 dosyasını preset olarak alıyor', () => {
  const I = require('../src/main/milkdrop-import.js');
  const src = fs.readFileSync(path.join(__dirname, '..', 'src', 'main', 'milkdrop-import.js'), 'utf8');
  assert.match(src, /if \(ext === '\.milk2'\) return \{ type: 'preset', name: stem\(name\), dirs, size \};/);
  assert.ok(I, 'modül yükleniyor');
});
