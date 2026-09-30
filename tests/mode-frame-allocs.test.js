'use strict';
/* Modların draw() gövdesinde her karede yeni dizi ayrılmıyor.

   Kısa ömürlü diziler sızıntı değil ama uzun oturumda çöp toplayıcıyı
   sürekli çalıştırıyor ve karelere takılma olarak yansıyor ("zamanla
   kasıyor" şikâyeti). Tampon ya nesnede tutulmalı (`this.x = new ...`,
   `(this.x = new ...)`) ya da düşen eski satırın dizisi yeniden kullanılmalı.
   Bilinçli istisnalar gerekçesiyle aşağıda. */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const DIR = path.join(__dirname, '..', 'src', 'visualizer', 'modes');
// Dosya adı -> gerekçe
const ALLOWED = {
  'milkdrop.js': 'kendi bütçesi ve ölçümleri var (#560); ayrı denetleniyor',
  'tunnel.js': 'dizi yeni halkada ayrılıyor ve halkanın ömrü boyunca tutuluyor (saniyede birkaç kez)',
  'geometry3d.js': '15 sayılık palet; ihmal edilebilir',
};

function drawBodies(src) {
  const lines = src.split(/\r?\n/);
  const out = [];
  let inDraw = false;
  lines.forEach((l, i) => {
    if (/^\s+draw\(/.test(l)) inDraw = true;
    else if (/^\s{4}\}$/.test(l)) inDraw = false;
    else if (inDraw) out.push([i + 1, l]);
  });
  return out;
}

test('draw() içinde önbelleğe alınmamış dizi ayırma yok', () => {
  const bad = [];
  for (const f of fs.readdirSync(DIR)) {
    if (!f.endsWith('.js') || ALLOWED[f]) continue;
    for (const [n, l] of drawBodies(fs.readFileSync(path.join(DIR, f), 'utf8'))) {
      if (!/new (Float32Array|Uint8Array|Float64Array|Int32Array)\(/.test(l)) continue;
      // İzinli biçimler: nesnede tutma ya da düşen dizinin yeniden kullanımı
      if (/this\.\w+ = new|\(this\.\w+ = new|it\._\w+ = new|\? (old|last) : new/.test(l)) continue;
      bad.push(f + ':' + n + ' ' + l.trim());
    }
  }
  assert.deepStrictEqual(bad, []);
});
