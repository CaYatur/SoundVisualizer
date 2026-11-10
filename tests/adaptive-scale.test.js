'use strict';
/* Uyarlanır çözünürlük (#453): kare kaçınca düşer, sakinleşince temkinle yükselir. */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const A = require('../src/shared/adaptive-scale.js');
const read = (p) => fs.readFileSync(path.join(__dirname, '..', p), 'utf8').replace(/\r\n/g, '\n');

// ms süresince verilen aralıkla kare; değişimler döner
function run(a, ms, dt, slowEvery) {
  const out = [];
  let i = 0;
  for (let t = 0; t < ms;) {
    const d = slowEvery && (++i % slowEvery === 0) ? dt * 2 : dt;
    const r = a.tick(d);
    if (r != null) out.push(r);
    t += d;
  }
  return out;
}

test('yetişen sahnede ölçek 1 kalır', () => {
  const a = A.create();
  assert.deepStrictEqual(run(a, 60000, 1000 / 75), []);
  assert.strictEqual(a.scale(), 1);
  assert.ok(Math.abs(a.period() - 1000 / 75) < 0.5, 'yenileme süresi öğrenildi');
});

test('her üç karede biri kaçıyorsa basamak basamak düşer, tabanda durur', () => {
  const a = A.create();
  run(a, 2100, 1000 / 75); // yenileme süresi öğrenilsin
  const steps = run(a, 60000, 1000 / 75, 3);
  assert.deepStrictEqual(steps, [0.9, 0.8, 0.7, 0.6, 0.5]);
  assert.strictEqual(a.scale(), A.FLOOR);
});

test('düşüşten sonra bir pencere ölçülmez: yeniden boyutlandırmanın takılması sayılmaz', () => {
  const a = A.create();
  run(a, 2100, 1000 / 60);
  assert.deepStrictEqual(run(a, 2100, 1000 / 60, 3), [0.9]);
  // Hemen ardından iki saniye daha kötü kare: düşüş yok
  assert.deepStrictEqual(run(a, 2000, 1000 / 60, 3), []);
});

test('sakinleşince on saniye sonra yükselir; hemen ardından kare kaçarsa bekleme iki katına çıkar', () => {
  const a = A.create();
  run(a, 2100, 1000 / 75);
  run(a, 4200, 1000 / 75, 3);
  const low = a.scale();
  assert.ok(low < 1);
  const up = run(a, 16000, 1000 / 75);
  assert.deepStrictEqual(up, [Math.round((low + 0.1) * 100) / 100], 'bir basamak yukarı');
  assert.strictEqual(a.raiseAfter(), 5);
  // Yükseltilen basamak taşınmıyor
  run(a, 6500, 1000 / 75, 3);
  assert.strictEqual(a.raiseAfter(), 10, 'bir sonraki yükseltme yirmi saniye bekler');
  assert.ok(a.scale() <= low + 1e-9);
});

test('uzun aralık (gizli pencere) ve bozuk değer ölçülmez; reset başa döner', () => {
  const a = A.create();
  run(a, 2100, 1000 / 75);
  for (let i = 0; i < 50; i++) assert.strictEqual(a.tick(900), null);
  assert.strictEqual(a.tick(NaN), null);
  assert.strictEqual(a.tick(0), null);
  assert.strictEqual(a.scale(), 1);
  run(a, 4200, 1000 / 75, 3);
  assert.ok(a.scale() < 1);
  a.reset();
  assert.strictEqual(a.scale(), 1);
});

test('çıkış penceresi: ölçek kullanıcının ölçeğiyle çarpılır, kapatılınca 1e döner', () => {
  const v = read('src/visualizer/visualizer.js');
  assert.match(v, /const rs = clamp\(clamp\(cfg\.power\.renderScale, 0\.4, 1\) \* autoScale, 0\.4, 1\);/);
  assert.match(v, /if \(cfg\.power\.adaptiveScale === false\) \{\s*if \(autoScale !== 1\) \{ adaptive\.reset\(\); autoScale = 1; resize\(\); \}/);
  assert.match(v, /const next = adaptive\.tick\(rafDt\);\s*if \(next != null\) \{ autoScale = next; resize\(\); \}/);
  for (const page of ['src/visualizer/index.html', 'src/web/overlay.html']) {
    const html = read(page);
    assert.ok(html.indexOf('adaptive-scale.js') > 0 && html.indexOf('adaptive-scale.js') < html.lastIndexOf('visualizer.js'), page);
  }
  // Yalnız uygulamanın açtığı pencerede: öz test, ekran görüntüsü ve ölçüm araçlarında kapalı
  assert.match(v, /const adaptive = adaptiveHere && window\.SVAdaptiveScale \? window\.SVAdaptiveScale\.create\(\) : null;/);
  const main = read('src/main/main.js');
  assert.match(main, /const ADAPTIVE_QUERY = SMOKE \|\| SHOTS \? undefined : \{ query: \{ svAdaptive: '1' \} \};/);
  assert.strictEqual(main.split('win.loadFile(visualizerPage(), ADAPTIVE_QUERY);').length, 3);
  // Dışa aktarıcı yüklemiyor: video her zaman tam çözünürlükte
  assert.ok(!read('src/exporter/index.html').includes('adaptive-scale.js'));
  global.window = global.window || {};
  require('../src/shared/defaults.js');
  assert.strictEqual(global.window.SV.defaultConfig().power.adaptiveScale, true);
  assert.ok(read('src/shared/i18n.js').includes("'Uyarlanır Çözünürlük': 'Adaptive Resolution'"));
});
