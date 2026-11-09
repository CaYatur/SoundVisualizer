'use strict';
/* 3B LUT (.cube) okuyucu testleri.
 *
 * Asıl güvence kimlik LUT'u: okunup paketlenip tekrar örneklendiğinde
 * giriş rengi değişmeden çıkmalı (8 bit yuvarlamanın yarım adımı kadar
 * sapma). Bilinen bir dönüşüm (ters çevirme) ve 65 → 33 indirgeme de
 * ölçülür; bozuk dosyalar hata atmadan bir kodla reddedilir. */
const test = require('node:test');
const assert = require('node:assert');
const L = require('../src/shared/lut.js');

function cube(n, fn, header) {
  const rows = [];
  for (let b = 0; b < n; b++) for (let g = 0; g < n; g++) for (let r = 0; r < n; r++) {
    const o = fn(r / (n - 1), g / (n - 1), b / (n - 1));
    rows.push(o.map((v) => v.toFixed(6)).join(' '));
  }
  return (header || '') + 'TITLE "Test"\n# yorum\nLUT_3D_SIZE ' + n + '\n\n' + rows.join('\n') + '\n';
}

const unpack = (p) => {
  const bytes = L.fromBase64(p.data);
  const t = new Float32Array(bytes.length);
  for (let i = 0; i < bytes.length; i++) t[i] = bytes[i] / 255;
  return t;
};

test('lut: identity .cube round-trips colors unchanged', () => {
  const r = L.parseCube(cube(17, (r, g, b) => [r, g, b]));
  assert.ok(r.ok, r.error);
  assert.strictEqual(r.size, 17);
  assert.strictEqual(r.title, 'Test');
  const p = L.pack(r, 'id');
  assert.ok(L.validPacked(p));
  const t = unpack(p);
  for (const c of [[0, 0, 0], [1, 1, 1], [0.2, 0.5, 0.8], [0.73, 0.11, 0.42], [0.5, 0.5, 0.5]]) {
    const o = L.sampleTable(t, p.size, c[0], c[1], c[2]);
    for (let k = 0; k < 3; k++) assert.ok(Math.abs(o[k] - c[k]) <= 0.5 / 255 + 1e-6, `${c} -> ${o}`);
  }
});

test('lut: a known transform (invert) is applied, with R as the fastest axis', () => {
  const r = L.parseCube(cube(9, (r, g, b) => [1 - r, 1 - g, 1 - b]));
  const p = L.pack(r);
  const t = unpack(p);
  const o = L.sampleTable(t, p.size, 0.25, 0.6, 0.9);
  assert.ok(Math.abs(o[0] - 0.75) < 0.01 && Math.abs(o[1] - 0.4) < 0.01 && Math.abs(o[2] - 0.1) < 0.01, String(o));
  // Kanal sırası: yalnız kırmızıyı sabitleyen LUT yalnız kırmızıyı değiştirir
  const red = L.pack(L.parseCube(cube(5, (r, g, b) => [1, g, b])));
  const o2 = L.sampleTable(unpack(red), 5, 0, 0.5, 0.25);
  assert.ok(Math.abs(o2[0] - 1) < 0.01 && Math.abs(o2[1] - 0.5) < 0.01 && Math.abs(o2[2] - 0.25) < 0.01, String(o2));
});

test('lut: 65-point tables are resampled to 33 and stay accurate', () => {
  const f = (r, g, b) => [r * r, Math.sqrt(g), (r + b) / 2];
  const r = L.parseCube(cube(65, f));
  assert.ok(r.ok);
  const p = L.pack(r);
  assert.strictEqual(p.size, L.MAX_SIZE);
  assert.ok(p.data.length < 150 * 1024, 'packed size stays small: ' + p.data.length);
  const t = unpack(p);
  for (const c of [[0.3, 0.3, 0.3], [0.9, 0.1, 0.5]]) {
    const o = L.sampleTable(t, p.size, c[0], c[1], c[2]);
    const want = f(c[0], c[1], c[2]);
    for (let k = 0; k < 3; k++) assert.ok(Math.abs(o[k] - want[k]) < 0.02, `${c}: ${o} vs ${want}`);
  }
});

test('lut: out-of-range output values are clamped when packed', () => {
  const p = L.pack(L.parseCube(cube(2, (r, g, b) => [r * 2 - 0.5, g, b])));
  const t = unpack(p);
  assert.strictEqual(t[0], 0);
  assert.strictEqual(t[3], 1);
});

test('lut: malformed files are rejected with a code, never thrown', () => {
  const bad = (txt, code) => {
    const r = L.parseCube(txt);
    assert.strictEqual(r.ok, false);
    assert.strictEqual(r.error, code, String(txt).slice(0, 40));
  };
  bad('', 'empty');
  bad('0 0 0\n', 'noSize');
  bad('LUT_1D_SIZE 1024\n0 0 0\n', 'lut1d');
  bad('LUT_3D_SIZE 1\n0 0 0\n', 'badSize');
  bad('LUT_3D_SIZE 2\n0 0 0\n1 1 1\n', 'tooFewRows');
  bad('LUT_3D_SIZE 2\n' + '0 0 0\n'.repeat(9), 'tooManyRows');
  bad('LUT_3D_SIZE 2\n0 0 x\n', 'badRow');
  bad(cube(2, (r, g, b) => [r, g, b], 'DOMAIN_MIN 0 0 0\nDOMAIN_MAX 2 2 2\n'), 'domain');
  bad(null, 'empty');
  assert.ok(L.parseCube(cube(2, (r, g, b) => [r, g, b], 'DOMAIN_MIN 0 0 0\nDOMAIN_MAX 1 1 1\nLUT_IN_VIDEO_RANGE\n')).ok);
  assert.strictEqual(L.validPacked({ size: 4, data: 'AAAA' }), false);
  assert.strictEqual(L.validPacked(null), false);
});


test('lut: reject oversized declarations and malformed packed base64', () => {
  assert.strictEqual(L.parseCube('LUT_3D_SIZE 256\n').error, 'badSize');
  assert.strictEqual(L.validPacked({ size: 2, data: '!'.repeat(32) }), false);
});

test('lut: removed and disabled LUT textures are released on chain changes', () => {
  const fs = require('node:fs');
  const vm = require('node:vm');
  const window = {};
  const ctx = vm.createContext({ window, Set, Uint8Array, atob, console });
  for (const file of ['postfx.js', 'postfx-extra.js']) {
    vm.runInContext(fs.readFileSync(require.resolve('../src/visualizer/' + file), 'utf8'), ctx);
  }
  const P = window.SVPostFX;
  const deleted = [];
  const owner = Object.create(P.PostFX.prototype);
  owner.gl = { deleteTexture: (t) => deleted.push(t) };
  owner._lutTex = Object.assign(Object.create(null), { a: { tex: 'a' }, b: { tex: 'b' } });
  owner.setChain([{ id: 'a', type: 'lut3d', lut: { size: 2 } }]);
  assert.deepStrictEqual(deleted, ['b']);
  owner.setChain([{ id: 'a', type: 'lut3d', enabled: false, lut: { size: 2 } }]);
  assert.deepStrictEqual(deleted, ['b', 'a']);
  assert.strictEqual(Object.keys(owner._lutTex).length, 0);
});
