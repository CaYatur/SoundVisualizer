'use strict';
/* Işık renk hesabının testleri.
 *
 * Bu kod v3.1.1'e kadar src/main/dynamic-lighting.js içindeydi, 703 satırdı
 * ve TEK BİR TESTİ YOKTU. OpenRGB aynı renkleri üretmek zorunda olduğu için
 * paylaşılan bir modüle taşındı — ve taşımanın hiçbir şeyi değiştirmediğini
 * kanıtlamak gerekti.
 *
 * fixtures-lighting.json, taşımadan ÖNCE çalışan koddan alınmış çıktıdır:
 * 10 mod × 12 kare × 5 konum. Buradaki ilk test onunla karşılaştırır. Bir
 * gün renk hesabında bilerek bir değişiklik yapılırsa bu test düşer; o
 * durumda anlık görüntü YENİDEN ÜRETİLMELİ, ama önce değişikliğin gerçekten
 * istendiğine bakılmalı. Testin işi budur: sessiz kaymayı gürültülü hale
 * getirmek.
 */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const R = require('../src/shared/lighting-render.js');
const FIXTURE = require('./fixtures-lighting.json');

/* Anlık görüntüyü üreten kurulum. Değiştirilirse karşılaştırma anlamını
   yitirir, o yüzden burada sabit. */
function setup() {
  const r = R.createRenderer();
  const lighting = r.normalizeLighting({
    enabled: true, intensity: 0.8, brightness: 0.9, smoothing: 0.4, spread: 1.3,
    baseLevel: 0.15, colorSource: 'palette', color: '#ff3366', color2: '#33aaff',
    bandResponse: 'smooth', layout: 'global', speed: 1.2, threshold: 0.4, hardness: 0.5,
  });
  const visual = {
    visualizer: { color: '#22cc88', color2: '#8822cc', rainbow: false },
    background: { type: 'gradient', gradient: { from: '#101020', to: '#403060' } },
  };
  const frames = [];
  for (let i = 0; i < 12; i++) {
    frames.push({
      level: 0.2 + 0.7 * Math.abs(Math.sin(i * 1.1)),
      bass: 0.1 + 0.8 * Math.abs(Math.cos(i * 0.7)),
      mid: 0.3 + 0.5 * Math.abs(Math.sin(i * 0.5 + 1)),
      treble: 0.05 + 0.9 * Math.abs(Math.cos(i * 1.7)),
      bars: [0.2, 0.5, 0.9, 0.4, 0.1],
    });
  }
  return { r, lighting, visual, frames };
}

function renderMode(ctx, mode) {
  const { r, lighting, visual, frames } = ctx;
  r.resetAnimation(mode);
  const rows = [];
  let now = 1000;
  for (const f of frames) {
    now += 40;
    const state = r.updateAnimation(f, lighting, visual, now);
    rows.push([0, 0.25, 0.5, 0.75, 1]
      .map((p) => r.renderPixel(mode, p, f.bars, lighting, visual, state))
      .join(' '));
  }
  return rows;
}

test('renk hesabı taşınmadan önceki çıktısını birebir koruyor', () => {
  const ctx = setup();
  for (const mode of R.DYNAMIC_MODES) {
    assert.deepStrictEqual(renderMode(ctx, mode), FIXTURE[mode],
      mode + ' modunun çıktısı değişti — renk hesabı bozulmuş olabilir');
  }
});

test('anlık görüntü bütün dinamik modları kapsıyor', () => {
  /* Yeni bir mod eklenip anlık görüntüye girmezse bu test onu hatırlatır;
     aksi halde mod hiç sınanmadan yaşar. */
  assert.deepStrictEqual(
    Object.keys(FIXTURE).sort(),
    [...R.DYNAMIC_MODES].sort(),
    'mod listesiyle anlık görüntü uyuşmuyor'
  );
});

test('her tüketici KENDİ animasyon durumunu alıyor', () => {
  /* Ortak bir durum olsaydı Dynamic Lighting ile OpenRGB aynı karede
     zamanlayıcıyı iki kez ilerletir, dalga ve parlama hızları ikiye
     katlanırdı — ve bu ancak gerçek bir aygıtta fark edilirdi. */
  const a = R.createRenderer();
  const b = R.createRenderer();
  assert.notStrictEqual(a.animation, b.animation);
  a.animation.phase = 42;
  assert.notStrictEqual(b.animation.phase, 42);
});

test('iki tüketici aynı girdiye aynı rengi veriyor', () => {
  /* Paylaşılan modülün varlık sebebi bu. İki ayrı uygulama olsaydı zamanla
     kayarlar ve aynı sahnede iki farklı renk üretirlerdi. */
  const one = setup();
  const two = setup();
  for (const mode of ['visualizer-sync', 'ripple', 'rainbow']) {
    assert.deepStrictEqual(renderMode(one, mode), renderMode(two, mode), mode);
  }
});

test('üretilen renkler geçerli onaltılık kod', () => {
  const ctx = setup();
  for (const mode of R.DYNAMIC_MODES) {
    for (const row of renderMode(ctx, mode)) {
      for (const hex of row.split(' ')) {
        assert.match(hex, /^#[0-9a-f]{6}$/, mode + ' geçersiz renk üretti: ' + hex);
      }
    }
  }
});

test('ses gelmediğinde de renk üretiliyor', () => {
  /* Sessizlikte çökmek yerine taban seviyesine düşmeli. */
  const { r, lighting, visual } = setup();
  for (const mode of R.DYNAMIC_MODES) {
    r.resetAnimation(mode);
    const state = r.updateAnimation({}, lighting, visual, 1000);
    const hex = r.renderPixel(mode, 0.5, null, lighting, visual, state);
    assert.match(hex, /^#[0-9a-f]{6}$/, mode + ' sessizlikte bozuk renk verdi: ' + hex);
  }
});

test('dynamic-lighting artık kendi kopyasını taşımıyor', () => {
  /* İki kopya kalırsa biri düzeltilip diğeri unutulur. */
  const src = fs.readFileSync(path.join(__dirname, '..', 'src', 'main', 'dynamic-lighting.js'), 'utf-8');
  assert.match(src, /require\('\.\.\/shared\/lighting-render\.js'\)/,
    'paylaşılan modül kullanılmıyor');
  assert.ok(!/^function renderPixel\(/m.test(src),
    'renderPixel hâlâ dynamic-lighting.js içinde — iki kopya var');
  assert.ok(!/^function updateAnimation\(/m.test(src),
    'updateAnimation hâlâ dynamic-lighting.js içinde');
});
