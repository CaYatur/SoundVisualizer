'use strict';
/* Tarayıcı tarafına yüklenen betiklerin sözleşmesi.
 *
 * Bu dosyalar <script> etiketiyle, KLASİK betik olarak yükleniyor: hepsi tek
 * bir genel kapsamı paylaşıyor ve modül yalıtımı yok. Üst düzeyde bir isim
 * tanımlamak, başka bir betiğin ya da preload'un aynı ismiyle çarpışır ve
 * dosya HİÇ yüklenmez — konsolda tek satır hata, arayüzde sessizce eksik bir
 * panel.
 *
 * Bu tam olarak yaşandı: lighting-render.js üst düzeyde `const api` tanımladı,
 * preload'un window.api'siyle çarpıştı ve "Identifier 'api' has already been
 * declared" ile yüklenmedi. Sonuç: OpenRGB paneli mod listesini bulamadı ve
 * sürülemeyecek modları gösterdi.
 */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const html = fs.readFileSync(path.join(root, 'src', 'admin', 'index.html'), 'utf-8');

/* index.html'in gerçekten yüklediği paylaşılan betikler. Listeyi elle
   yazmıyoruz: yeni bir betik eklenince bu testin de kapsaması gerekiyor. */
function loadedSharedScripts() {
  const out = [];
  const re = /<script\s+src="\.\.\/shared\/([a-z0-9-]+\.js)"/gi;
  let m;
  while ((m = re.exec(html))) out.push(m[1]);
  return out;
}

test('index.html paylaşılan betikleri gerçekten yüklüyor', () => {
  const list = loadedSharedScripts();
  assert.ok(list.length > 10, 'beklenenden az betik bulundu: ' + list.length);
});

test('yüklenen her betik kendi kapsamına sarılı', () => {
  for (const name of loadedSharedScripts()) {
    const src = fs.readFileSync(path.join(root, 'src', 'shared', name), 'utf-8');
    assert.match(src, /^\(function\s*\(\s*\)\s*\{/m,
      name + ' üst düzeyde çalışıyor — genel kapsamı kirletir ve çarpışabilir');
  }
});

test('hiçbir betik üst düzeyde çarpışabilir bir isim tanımlamıyor', () => {
  /* `api` özellikle tehlikeli: preload onu window.api olarak zaten koyuyor. */
  const risky = ['api', 'config', 'state', 'panel', 'el', 'cfg'];
  for (const name of loadedSharedScripts()) {
    const src = fs.readFileSync(path.join(root, 'src', 'shared', name), 'utf-8');
    for (const id of risky) {
      const re = new RegExp('^(const|let|var|class|function)\s+' + id + '\b', 'm');
      assert.ok(!re.test(src), name + ' üst düzeyde "' + id + '" tanımlıyor — çarpışır');
    }
  }
});

test('admin betikleri de kendi kapsamında', () => {
  const re = /<script\s+src="([a-z0-9-]+\.js)"/gi;
  let m;
  const seen = [];
  while ((m = re.exec(html))) seen.push(m[1]);
  assert.ok(seen.length > 3, 'admin betikleri bulunamadı');
  for (const name of seen) {
    const p = path.join(root, 'src', 'admin', name);
    if (!fs.existsSync(p)) continue;
    const src = fs.readFileSync(p, 'utf-8');
    for (const id of ['api', 'state', 'panel']) {
      const reId = new RegExp('^(const|let|var|class|function)\s+' + id + '\b', 'm');
      assert.ok(!reId.test(src), name + ' üst düzeyde "' + id + '" tanımlıyor — çarpışır');
    }
  }
});

test('OpenRGB paneli betik olarak yükleniyor', () => {
  /* Etiket unutulursa hata YALNIZCA paketlenmiş derlemede görünür: geliştirme
     sırasında dosya başka bir yoldan yüklenmiş olabilir. */
  assert.match(html, /<script\s+src="openrgb-panel\.js"><\/script>/);
  assert.match(html, /<script\s+src="\.\.\/shared\/lighting-render\.js"><\/script>/);
});
