'use strict';
/* Web overlay'i ile masaüstü görselleştiricisi AYNI motoru koşuyor.
 *
 * Neden bu test var: overlay.html, modes/milkdrop.js'i yüklüyordu ama onun
 * bağımlılıklarını (milkdrop-audio, milkdrop-hlsl, milkdrop-shader)
 * yüklemiyordu. Sonuç sessiz bir çökme oldu — mod her karede
 * `new window.SVMilkdropAudio.MilkdropAudio()` satırında istisna atıyor,
 * kullanıcı yalnız "MilkDrop web'de çalışmıyor" görüyordu. Hiçbir test bunu
 * yakalamıyordu, çünkü iki HTML dosyası elle güncelleniyor ve ayrışmaları
 * kimseye görünmüyor.
 *
 * Kural: masaüstünün yüklediği her betik web overlay'inde de yüklenmeli.
 * Web'e ÖZGÜ betikler (web-shim gibi) tersi yönde serbest. */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const desktopHtml = fs.readFileSync(path.join(root, 'src', 'visualizer', 'index.html'), 'utf-8');
const webHtml = fs.readFileSync(path.join(root, 'src', 'web', 'overlay.html'), 'utf-8');

/* Betik yollarını DEPO KÖKÜNE göre çözer. İki dosya farklı biçim kullanıyor
   (`../shared/x.js`, `audio.js`, `/app/shared/x.js`) ve yalnız dosya adına
   bakmak yetmiyor: `shared/milkdrop.js` ile `visualizer/modes/milkdrop.js`
   ayrı dosyalar ve ikisi de gerekli. */
function scripts(html, baseDir) {
  const out = [];
  const re = /<script\s+src="([^"]+)"/g;
  let m;
  while ((m = re.exec(html)) !== null) {
    const src = m[1];
    const rel = src.charAt(0) === '/'
      ? src.replace(/^\/app\//, 'src/')            // web: /app/... -> src/...
      : path.posix.join(baseDir, src);             // masaüstü: HTML'e göreli
    out.push(path.posix.normalize(rel));
  }
  return out;
}

const desktop = scripts(desktopHtml, 'src/visualizer');
const web = scripts(webHtml, 'src/web');

test('web overlay: masaüstündeki her betiği yüklüyor', () => {
  const missing = desktop.filter((s) => web.indexOf(s) < 0);
  assert.deepStrictEqual(missing, [],
    'web overlay bu betikleri yüklemiyor: ' + missing.join(', '));
});

test('web overlay: MilkDrop\'un dört parçası da yükleniyor', () => {
  /* Dördü birlikte gerekiyor: milkdrop.js preset DİLİNİ, milkdrop-audio
     bant normalizasyonunu, milkdrop-hlsl + milkdrop-shader ise preset
     SHADER'LARININ GLSL'e çevrilmesini yapıyor. Eksik olan sessizce
     bozuyor: shader çevirici yoksa mod sabit yola düşüp bambaşka bir
     görüntü veriyor, audio yoksa doğrudan istisna atıyor. */
  for (const need of ['src/shared/milkdrop.js', 'src/shared/milkdrop-audio.js',
    'src/shared/milkdrop-hlsl.js', 'src/shared/milkdrop-shader.js',
    'src/visualizer/modes/milkdrop.js']) {
    assert.ok(web.indexOf(need) >= 0, need + ' web overlay\'inde yüklenmiyor');
  }
});

test('web overlay: bağımlılıklar modu KULLANAN betikten önce geliyor', () => {
  /* Betikler sırayla koşuyor ve hepsi window global'lerine yazıyor:
     modes/milkdrop.js yüklenirken SVMilkdropShader tanımlı olmalı. */
  const at = (n) => web.indexOf(n);
  for (const dep of ['src/shared/milkdrop.js', 'src/shared/milkdrop-audio.js',
    'src/shared/milkdrop-hlsl.js', 'src/shared/milkdrop-shader.js']) {
    assert.ok(at(dep) < at('src/visualizer/modes/milkdrop.js'),
      dep + ', modes/milkdrop.js\'ten SONRA yükleniyor');
  }
  assert.ok(at('src/shared/milkdrop-hlsl.js') < at('src/shared/milkdrop-shader.js'),
    'milkdrop-shader, milkdrop-hlsl\'e bakıyor; sonra yüklenmeli');
});
