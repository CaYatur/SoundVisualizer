'use strict';
/* Müzik videosu kartları ve müzik arka planı şablonları (10.10).

   Kullanıcı geri bildirimi: kart şablonlarında zemin grenli ve kötü
   görünüyordu; kapak, parça adı ve görselleştirici güzel ama hizalama ve
   boyutlar zayıftı. Kartlar artık tek bir "Çalan Parça" katmanıyla
   kuruluyor (kapak yazının yanına motor tarafından yerleşir), zeminde gren
   yok, kenar boşlukları barlarla aynı. Yeni üç kart ve müzik çalarken
   arkada sade bir görselleştirici gösteren altı şablon eklendi.

   Ölçüldü (yalıtılmış kopya, panel önizlemesi 1280×720, 540×960, 720×720):
   kapak ile yazı arası her oranda aynı; uzun Türkçe başlık kendi alanında
   kayıyor; kapaksız parçada yazı kenara yaslanıyor. */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8').replace(/\r\n/g, '\n');

global.window = global.window || {};
require('../src/shared/defaults.js');
const SV = global.window.SV;
const T = require('../src/shared/templates.js');
const env = { defaultConfig: SV.defaultConfig, deepMerge: SV.deepMerge, clone: SV.clone };

const CARDS = ['bc-label', 'bc-artwork', 'bc-line', 'bc-amber', 'bc-minimal', 'bc-quiet', 'bc-corner', 'bc-center', 'bc-wave', 'bc-ring', 'bc-stage'];
const BACKDROPS = ['np-aurora', 'np-flow', 'np-nebula', 'np-milkdrop', 'np-galaxy', 'np-glow'];
const tpl = (id) => T.TEMPLATES.find((x) => x.id === id);
const applied = (id) => T.apply(SV.defaultConfig(), tpl(id), env);
const cardOf = (cfg) => (cfg.layers || []).filter((l) => l && l.kind === 'nowplaying');

test('kart ve arka plan şablonları var; eski kimlikler korunuyor', () => {
  for (const id of CARDS) assert.strictEqual(tpl(id) && tpl(id).group, 'Müzik Videosu', id);
  for (const id of BACKDROPS) assert.strictEqual(tpl(id) && tpl(id).group, 'Müzik Arka Planı', id);
  assert.strictEqual(new Set(T.TEMPLATES.map((t) => t.id)).size, T.TEMPLATES.length, 'kimlikler tekil');
  assert.strictEqual(T.TEMPLATES.length, 81);
});

test('kartlarda ve arka planlarda gren yok', () => {
  for (const id of CARDS.concat(BACKDROPS)) {
    const cfg = applied(id);
    assert.strictEqual(cfg.background.gradient.grain || 0, 0, id + ' zemin greni');
    assert.ok(!(cfg.postfx || []).some((f) => f.type === 'grain' || f.type === 'vhs'), id + ' gren efekti');
  }
});

test('her kart tek bir Çalan Parça katmanı taşıyor; yer tutucu yalnız panelde', () => {
  for (const id of CARDS.concat(BACKDROPS)) {
    const np = cardOf(applied(id));
    assert.strictEqual(np.length, 1, id);
    const c = np[0].settings.nowplaying;
    assert.strictEqual(c.source, 'system', id);
    assert.strictEqual(c.placeholder, true, id);
    assert.strictEqual(c.audioScale, 0, id + ' yazı sese göre büyümüyor');
    assert.deepStrictEqual(Object.keys(c.show).filter((k) => c.show[k]).sort(), ['artist', 'title'], id);
    if (c.coverOverlay && c.coverSide === 'left') assert.strictEqual(c.anchor, 'group', id + ' x kapağın kenarı');
    // Kapak haleyi genel parlamadan almıyor
    assert.strictEqual(np[0].settings.visualizer.glow, 0, id);
  }
  const src = read('src/visualizer/modes/nowplaying.js');
  assert.match(src, /if \(!st\.has && c\.placeholder\) \{/);
  assert.match(src, /else if \(typeof window !== 'undefined' && window\.SVPanel && !rec\) \{/, 'yer tutucu kayda girmez');
  assert.match(src, /window\.SVRecordPanel\.isRecording\(\)/);
  assert.match(src, /if \(m\.title \|\| m\.artist\) \{/, 'elle yazılan parçaya düşer');
  assert.match(src, /title: tr\('PARÇA ADI'\), artist: tr\('SANATÇI ADI'\)/);
  assert.match(src, /if \(side === 'left' && align === 'left'\) groupShift = coverW \+ coverGapPx;/);
  assert.match(src, /ctx\.translate\(ax \+ ox, cy \+ oy\);/);
  const d = SV.defaultConfig().nowplaying;
  assert.strictEqual(d.anchor, 'text', 'varsayılan eski davranış');
  assert.strictEqual(d.placeholder, false);
});

/* Yan yana düzenlerde yazının kaydığı alan barlara değmez: 16:9, 9:16 ve
   1:1'de. Konum genişliğe, kapak ve yazı ölçüsü kısa kenara oranlı. */
test('yan yana düzenlerde yazı alanı barlara değmiyor', () => {
  for (const [w, h] of [[1920, 1080], [1080, 1920], [1080, 1080]]) {
    const minDim = Math.min(w, h);
    for (const id of CARDS) {
      const cfg = applied(id);
      const c = cardOf(cfg)[0].settings.nowplaying;
      const bars = (cfg.layers || []).find((l) => l.type === 'bars');
      if (!bars || c.align !== 'left') continue;
      const v = bars.settings.visualizer;
      const barTop = v.baseline - v.barHeight;
      const barLeft = v.barCenterX - v.barSpan / 2;
      // Kartın dikey aralığı (kapak kartın ortasında)
      const half = Math.max(c.coverSize * minDim / h, c.size * 2.2 * minDim / h) / 2;
      const overlapY = c.y + half > barTop && c.y - half < v.baseline;
      if (!overlapY) continue;
      const shift = c.anchor === 'group' && c.coverSide === 'left' ? c.coverSize * minDim * (1 + c.coverGap) / w : 0;
      const textEnd = c.x + shift + c.maxWidth;
      assert.ok(textEnd <= barLeft + 1e-9, id + ' ' + w + 'x' + h + ': yazı ' + textEnd.toFixed(3) + ' bar ' + barLeft.toFixed(3));
    }
  }
});

test('kenar boşluğu: barlar ile kartın sol kenarı aynı çizgide', () => {
  for (const id of ['bc-label', 'bc-artwork', 'bc-line', 'bc-amber', 'bc-minimal']) {
    const cfg = applied(id);
    const c = cardOf(cfg)[0].settings.nowplaying;
    const v = (cfg.layers || []).find((l) => l.type === 'bars').settings.visualizer;
    assert.ok(Math.abs((v.barCenterX - v.barSpan / 2) - c.x) < 1e-9, id);
    assert.ok(Math.abs((v.barCenterX + v.barSpan / 2) - (1 - c.x)) < 1e-9, id + ' sağ kenar');
  }
});

/* Halka: yuvarlak kapak halkanın iç yarıçapında kalır. Dairesel mod iç
   yarıçapı kısa kenarın 0,18'i (circular.js); kapak yarıçapı ölçeğin
   yarısı. Kapak ve halka aynı merkezde. */
test('Cover Ring kapağı halkanın içinde ve aynı merkezde', () => {
  const cfg = applied('bc-ring');
  const ring = cfg.layers.find((l) => l.type === 'circular');
  const cover = cfg.layers.find((l) => l.kind === 'logo');
  assert.match(read('src/visualizer/modes/circular.js'), /const baseR = minDim \* 0\.18 \*/);
  assert.ok(cover.settings.logo.scale / 2 < 0.18, 'kapak yarıçapı');
  assert.strictEqual(cover.settings.logo.cornerRadius, 0.5, 'yuvarlak kapak');
  assert.ok(Math.abs(0.5 + ring.transform.y - cover.settings.logo.y) < 1e-9, 'dikey merkez');
  assert.strictEqual(ring.transform.x, 0);
  assert.strictEqual(cover.settings.logo.x, 0.5);
});

test('arka plan şablonlarında görselleştirici kısık, kart okunur', () => {
  for (const id of BACKDROPS) {
    const cfg = applied(id);
    const vis = (cfg.layers || []).filter((l) => l.kind === 'visualizer');
    for (const l of vis) assert.ok(l.opacity <= 1 && l.opacity > 0.3, id + ' ' + l.name);
    const c = cardOf(cfg)[0].settings.nowplaying;
    assert.ok(c.shadow >= 0.4, id + ' yazı gölgesi');
  }
});

test('yeni metinlerin İngilizcesi var', () => {
  const src = read('src/shared/i18n.js');
  const has = (k) => src.indexOf("'" + k + "':") >= 0 || src.indexOf('"' + k + '":') >= 0;
  for (const id of CARDS.concat(BACKDROPS)) {
    const t = tpl(id);
    for (const k of [t.name, t.desc, t.group]) assert.ok(has(k), id + ': ' + k);
    for (const l of t.patch.layers || []) assert.ok(has(l.name), id + ' katman: ' + l.name);
  }
});
