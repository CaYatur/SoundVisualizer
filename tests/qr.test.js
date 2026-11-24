'use strict';
/* QR kodlayıcı (src/shared/qr.js). Altın özetler, kodlayıcının çıktısı OpenCV'nin iki çözücüsüyle
 * (QRCodeDetector, QRCodeDetectorAruco) okunup doğrulandıktan sonra alındı: sürüm 1–14, L ve M,
 * çok bloklu ve sürüm bilgili örnekler. Burada çıktı sabit kalıyor mu ve yapısal kurallar
 * (bulucu desenleri, zamanlama, biçim bitleri, koyu modül) tutuyor mu denetlenir. */
const test = require('node:test');
const assert = require('node:assert');
const crypto = require('crypto');
const Q = require('../src/shared/qr.js');

const LINK = 'svlink://1?h=192.168.1.24&h=10.0.0.5&p=8722&id=Ab3dE6gH9jKl&f=Qm9vYmFyQmF6UXV4Rm9vYg&s=c2VjcmV0c2VjcmV0c2VjcmV0c2VjcmV0c2VjcmV0MDA&n=St%C3%BCdyo-PC';
const digest = (q) => crypto.createHash('sha256').update(q.modules.map((r) => r.map((b) => (b ? 1 : 0)).join('')).join('\n')).digest('hex');

test('QR: çözücüyle doğrulanmış çıktılar değişmez', () => {
  const cases = [
    [LINK, 'L', 7, 2, '1882af11a5e51647f52bb7d38464e310c3cf22ef9671e870f373c5b2418934dd'],
    [LINK, 'M', 8, 2, '79f575b16b9657535b70b25010f00e9f4e77699f9e11822510924f3556d7fab3'],
    ['Merhaba dünya', 'M', 1, 3, 'fdf183bdd446ac293f72b3d61a9b8a3cc3b8edd399911bfb4363390d0fc192c7'],
  ];
  for (const [t, e, ver, mask, hex] of cases) {
    const q = Q.encode(t, { ecc: e });
    assert.deepStrictEqual([q.version, q.mask, digest(q)], [ver, mask, hex], e + ' ' + t.slice(0, 12));
  }
});

test('QR: bulucu, zamanlama, koyu modül ve biçim bitleri kurala uyuyor', () => {
  for (const [t, e] of [[LINK, 'L'], ['x', 'M'], ['a'.repeat(300), 'L']]) {
    const q = Q.encode(t, { ecc: e });
    const m = q.modules, n = q.size;
    assert.strictEqual(n, q.version * 4 + 17);
    for (const [cx, cy] of [[3, 3], [n - 4, 3], [3, n - 4]]) {
      for (let d = -3; d <= 3; d++) {
        // Dış halka koyu, onun içindeki halka açık
        assert.strictEqual(m[cy - 3][cx + d], true); assert.strictEqual(m[cy + d][cx - 3], true);
        if (d > -3 && d < 3) assert.strictEqual(m[cy - 2][cx + d], false);
      }
      assert.strictEqual(m[cy][cx], true, 'bulucu çekirdeği');
      assert.strictEqual(m[cy - 2][cx], false, 'bulucu iç halkası');
    }
    for (let i = 8; i < n - 8; i++) { assert.strictEqual(m[6][i], i % 2 === 0); assert.strictEqual(m[i][6], i % 2 === 0); }
    assert.strictEqual(m[n - 8][8], true, 'koyu modül');
    // Biçim bitleri: iki kopya aynı, BCH maskesi çözülünce hata düzeltme ve maske okunur
    let a = 0, b = 0;
    for (let i = 0; i <= 5; i++) a |= (m[i][8] ? 1 : 0) << i;
    a |= (m[7][8] ? 1 : 0) << 6; a |= (m[8][8] ? 1 : 0) << 7; a |= (m[8][7] ? 1 : 0) << 8;
    for (let i = 9; i < 15; i++) a |= (m[8][14 - i] ? 1 : 0) << i;
    for (let i = 0; i < 8; i++) b |= (m[8][n - 1 - i] ? 1 : 0) << i;
    for (let i = 8; i < 15; i++) b |= (m[n - 15 + i][8] ? 1 : 0) << i;
    assert.strictEqual(a, b, 'iki biçim kopyası');
    const data = (a ^ 0x5412) >>> 10;
    assert.strictEqual(data & 7, q.mask);
    assert.strictEqual(data >>> 3, e === 'L' ? 1 : 0);
  }
});

test('QR: sürüm seçimi, sığmayan metin ve SVG', () => {
  assert.strictEqual(Q.encode('A').version, 1);
  assert.ok(Q.encode('a'.repeat(400)).version <= Q.MAX_VER);
  assert.strictEqual(Q.encode('a'.repeat(900)), null);
  const s = Q.svg('svlink://1?x', { label: '<x>' });
  assert.match(s, /^<svg [^>]*viewBox="0 0 29 29"/);
  assert.ok(s.indexOf('<x>') < 0, 'etiket kaçışlı');
  assert.strictEqual(Q.svg('a'.repeat(900)), '');
});
