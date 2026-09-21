'use strict';
const test = require('node:test');
const assert = require('node:assert');
const G = require('../src/shared/gif-anim.js');

test('GIF kaynağı data URL ve uzantıdan tanınır', () => {
  assert.strictEqual(G.isGifSrc('data:image/gif;base64,AAA'), true);
  assert.strictEqual(G.isGifSrc('foo.gif'), true);
  assert.strictEqual(G.isGifSrc('sv-logo://lib/img_1.gif'), true);
  assert.strictEqual(G.isGifSrc('data:image/png;base64,AAA'), false);
  assert.strictEqual(G.isGifSrc('logo.png'), false);
  assert.strictEqual(G.isGifSrc(''), false);
});

test('kind:gif kitaplık URL\'si olmasa da animasyon sayılır', () => {
  assert.strictEqual(G.isAnimatedLogo({ kind: 'gif', libraryId: 'img_1' }), true);
  assert.strictEqual(G.isAnimatedLogo({ kind: 'image', src: 'a.png' }), false);
});

test('kitaplık URL\'si kimliği taşır', () => {
  const u = G.libraryUrl('img_ab');
  assert.ok(u.indexOf('img_ab') >= 0);
  assert.strictEqual(G.logoFileSrc({ libraryId: 'img_ab' }).indexOf('img_ab') >= 0, true);
  assert.strictEqual(G.logoFileSrc({ src: 'data:image/png;base64,x' }), 'data:image/png;base64,x');
  assert.strictEqual(G.logoFileSrc(null), null);
});

test('kare seçimi döngüseldir', () => {
  const dur = [60, 60, 60, 60];
  assert.strictEqual(G.frameIndexAt(dur, 0), 0);
  assert.strictEqual(G.frameIndexAt(dur, 70), 1);
  assert.strictEqual(G.frameIndexAt(dur, 240), 0);
  assert.strictEqual(G.frameIndexAt(dur, 250), 0);
  assert.strictEqual(G.frameIndexAt(dur, -10), 3);
});

test('kare seçimi bir kez ve gidiş-dönüş', () => {
  const dur = [100, 100, 100];
  assert.strictEqual(G.frameIndexAt(dur, 500, 'once'), 2);
  assert.strictEqual(G.frameIndexAt(dur, 50, 'pingpong'), 0);
  assert.strictEqual(G.frameIndexAt(dur, 250, 'pingpong'), 2);
  assert.strictEqual(G.frameIndexAt(dur, 350, 'pingpong'), 2);
  assert.strictEqual(G.frameIndexAt(dur, 550, 'pingpong'), 0);
});

test('ters oynatma sondan başlar', () => {
  const dur = [50, 50, 50];
  assert.strictEqual(G.frameIndexAt(dur, 0, 'loop', true), 2);
  assert.strictEqual(G.frameIndexAt(dur, 60, 'loop', true), 1);
});
