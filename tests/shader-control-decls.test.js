'use strict';
/* ShaderHost denetim değişkenlerini kendisi bildiriyor (_paramDecls):
   `uniform float <ad>;` her denetim için önsözle kaynağın arasına giriyor.
   Kaynak aynı adı ayrıca bildirirse GLSL "redefinition" der ve program hiç
   derlenmez. Geri Besleme motoru bu yüzden eklendiğinden beri boş çiziyordu
   (README'nin mod kolajında bulundu); öz test bunu kaçırdı, çünkü boşluğu
   arka planla birlikte ölçüyor. Burada GPU'suz, kaynağın kendisine bakılıyor. */
global.window = global.window || {};
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const HOST = fs.readFileSync(path.join(__dirname, '..', 'src', 'visualizer', 'modes', 'shaderhost.js'), 'utf8');

function declared(src, name) {
  return new RegExp('uniform\\s+\\w+\\s+' + name + '\\s*[;\\[]').test(src);
}

function feedback() {
  const a = HOST.indexOf('const FEEDBACK_SHADER = `');
  const b = HOST.indexOf('`;', a);
  const c = HOST.indexOf('const FEEDBACK_CONTROLS = [');
  const d = HOST.indexOf('];', c);
  assert.ok(a > 0 && b > a && c > 0 && d > c, 'geri besleme kaynağı bulunamadı');
  const shader = HOST.slice(a, b);
  const names = [...HOST.slice(c, d).matchAll(/name: '(\w+)'/g)].map((m) => m[1]);
  return { shader, names };
}

test('geri besleme shader\'ı denetim değişkenlerini ikinci kez bildirmiyor', () => {
  const { shader, names } = feedback();
  assert.ok(names.length >= 10, 'denetim listesi okunamadı');
  for (const n of names) {
    assert.ok(!declared(shader, n), n + ' kaynakta yeniden bildiriliyor');
    assert.ok(new RegExp('\\b' + n + '\\b').test(shader), n + ' shader\'da kullanılmıyor');
  }
});

test('yerleşik Studio shader\'ları da kendi denetimlerini bildirmiyor', () => {
  require('../src/shared/presets.js');
  require('../src/shared/presets-shaders.js');
  const list = window.SVPresets.BUILTIN.filter((p) => p.shader && Array.isArray(p.controls) && p.controls.length);
  assert.ok(list.length > 20, 'yerleşik shader listesi okunamadı');
  for (const p of list) {
    for (const c of p.controls) assert.ok(!declared(p.shader, c.name), p.id + ': ' + c.name + ' yeniden bildiriliyor');
  }
});
