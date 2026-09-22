'use strict';
/* OTOMASYON FİZİKSEL IŞIKLARI SÜRMEZ (#575'te bulundu).
 *
 * Öz test (`--smoke`) ve ekran görüntüsü üreticisi (`--shots`) gerçek
 * kullanıcı klasörüyle koşuyor. Kullanıcının ayarında Dynamic Lighting
 * açıksa uygulama açılışta cihazları sürüyordu — öz testin kendisi de;
 * öz testin adımları panelde OpenRGB'yi açıyor, bilgisayarda OpenRGB
 * çalışıyorsa onun cihazlarını, Art-Net açıksa ağdaki sahne ışıklarını
 * sürerdi. Kamera için kural zaten vardı (otomasyonda hiç açılmıyor).
 *
 * Burada kaynak denetleniyor, shutdown.test.js gibi: donanıma giden her yol
 * tek bir bayraktan geçmeli; yeni bir yol eklenip geçmezse test düşer.
 */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(root, p), 'utf-8');
const stripComments = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/[^\n]*/g, '$1');
const M = stripComments(read('src/main/main.js'));

function functionBody(src, name) {
  const start = src.indexOf('function ' + name + '(');
  assert.ok(start >= 0, name + '() kaynakta bulunamadı');
  const open = src.indexOf('{', start);
  let depth = 0;
  for (let i = open; i < src.length; i++) {
    if (src[i] === '{') depth++;
    else if (src[i] === '}') {
      depth--;
      if (depth === 0) return src.slice(open, i + 1);
    }
  }
  assert.fail(name + '() gövdesi kapanmıyor');
}

test('bayrak: öz test ve ekran görüntüleri, tanılama değil', () => {
  assert.match(M, /const HW_OFF = SMOKE \|\| SHOTS;/);
  // Tanılama ışıkları gerçekten sınamak için var: bayrağa girmemeli
  assert.doesNotMatch(M, /const HW_OFF = [^;]*--diag/);
});

test('Dynamic Lighting: her ayar tek yoldan, otomasyonda kapalı', () => {
  const direct = M.match(/dynamicLighting\.setConfig\(/g) || [];
  assert.strictEqual(direct.length, 1, 'dynamicLighting.setConfig yalnız lightingSet içinde çağrılmalı');
  const body = functionBody(M, 'lightingSet');
  assert.match(body, /dynamicLighting\.setConfig\(HW_OFF \? Object\.assign\(\{\}, lighting, \{ enabled: false \}\) : lighting\)/);
  // Tarama cihazlara bir anlığına el koyuyor: otomasyonda hiç yapılmıyor
  assert.match(M, /ipcMain\.handle\('lighting:scan', \(\) => \(HW_OFF\s*\? \{ ok: true, supported: false, devices: \[\], automation: true \}\s*: dynamicLighting\.scan\(\)\)\);/);
  assert.strictEqual((M.match(/dynamicLighting\.scan\(\)/g) || []).length, 1, 'başka bir tarama yolu yok');
  assert.match(M, /ipcMain\.handle\('lighting:apply', \(e, lighting\) => lightingSet\(lighting\)\);/);
});

test('OpenRGB ve Art-Net: otomasyonda hiç başlatılmıyor', () => {
  assert.match(functionBody(M, 'syncArtnet'), /if \(!a\.enabled \|\| HW_OFF\) return artnet\.stop\(\)/);
  assert.match(functionBody(M, 'syncOpenRgb'), /if \(!o\.enabled \|\| HW_OFF\) return openrgb\.stop\(\)/);
  // Başlatma yalnız bu iki işlevde
  assert.strictEqual((M.match(/artnet\.start\(/g) || []).length, 1);
  assert.strictEqual((M.match(/openrgb\.start\(/g) || []).length, 1);
  assert.match(M, /ipcMain\.handle\('openrgb:rescan', \(\) => \(HW_OFF \? openrgb\.status\(\) : openrgb\.rescan\(\)\)\);/);
  /* Ses karesiyle giden gönderimler başlatılmamış bir bağlantıda hiçbir şey
     yapmıyor: başlatılmayınca paket de yok. */
  assert.match(stripComments(read('src/main/artnet.js')), /function send\(cfg, frame\) \{\s*if \(!socket \|\| !state\.running/);
  assert.match(stripComments(read('src/main/openrgb.js')), /function send\(cfg, rawLighting, frame, visualConfig\) \{\s*if \(!cfg \|\| !cfg\.enabled \|\| !state\.connected \|\| !socket/);
});
