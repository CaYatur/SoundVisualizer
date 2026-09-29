'use strict';
/* İz bırakan görselleştiriciler arkaplanı örtmemeli.

   Akış Alanı, Osiloskop, Gonyometre ve Çekici Alanı iz tamponlarını her
   karede yarı saydam SİYAHLA boyayarak soldurduğu için tampon birkaç
   saniyede opaklaşıyordu. Görselleştirici tuvalinin alfa ortalaması
   249-253/255'e çıkıyor ve arkaplan tamamen kayboluyordu (yalıtılmış
   profilde ölçüldü). Soldurma artık yalnız alfayı eritiyor.

   Çizim tarayıcı tuvali istediği için burada kaynak düzeyinde korunuyor;
   davranış perf-tools/trailcheck.js ile ölçülüyor. */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const MODES_DIR = path.join(__dirname, '..', 'src', 'visualizer', 'modes');

test('görselleştirici modları iz tamponunu siyahla soldurmuyor', () => {
  for (const f of fs.readdirSync(MODES_DIR)) {
    // Arkaplanlar zemin; opak olmaları beklenen durum
    if (!f.endsWith('.js') || f.startsWith('backgrounds')) continue;
    const src = fs.readFileSync(path.join(MODES_DIR, f), 'utf8');
    // Siyah boya ancak source-over ile basılırsa perde olur; fadeTrail aynı
    // siyahı destination-out ile kullanıyor
    const lines = src.split(/\r?\n/);
    const bad = lines.filter((l, k) => /\btc\.fillStyle\s*=\s*'rgba\(0,\s*0,\s*0,/.test(l) &&
      /'source-over'/.test(lines.slice(Math.max(0, k - 3), k).join(' ')));
    assert.deepStrictEqual(bad, [], f + ': iz tamponu siyahla boyanıyor');
  }
});

test('fadeTrail alfayı eritiyor ve kalıntıyı düzenli temizliyor', () => {
  const src = fs.readFileSync(path.join(MODES_DIR, 'generative.js'), 'utf8');
  const i = src.indexOf('function fadeTrail(');
  assert.ok(i > 0, 'fadeTrail yok');
  const body = src.slice(i, i + 900);
  assert.match(body, /globalCompositeOperation = 'destination-out'/);
  assert.match(body, /CLEAN_EVERY/);
  // Dört mod da ortak yardımcıyı kullanıyor
  assert.strictEqual((src.match(/^\s+fadeTrail\(tc, W, H,/gm) || []).length, 4);
});
