'use strict';
/* TEK YOL, EKSİK ALAN YOK (#905). Klasik arkaplan, görselleştirici, logo ve görsel nesneler
   kartları kalktı. Onlarda düzenlenen her alan katman düzenleyicisinde olmalı; bir alan yalnız
   orada kalırsa kimse ona ulaşamazdı. Karaoke ayarları böyle kaybolmuştu (#938). */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const panel = fs.readFileSync(path.join(__dirname, '..', 'src', 'admin', 'scene-panels.js'), 'utf-8');
const has = (key) => new RegExp('\\b' + key + '\\b').test(panel);

const FIELDS = {
  background: ['audioBrightness', 'audioHue', 'audioReactivity', 'brightness', 'colorMode', 'coverTaskbar', 'drift', 'grain', 'hideLines', 'orbit', 'scale', 'solidColor', 'speed', 'style', 'swirl', 'transparent', 'transparentKey', 'type', 'vignette', 'wander', 'warp'],
  visualizer: ['amplitude', 'attack', 'barCenterX', 'barCount', 'barDirection', 'barFill', 'barHeight', 'barRadius', 'barSpan', 'barStyle', 'baseline', 'cap', 'capColor', 'capColorMode', 'capFall', 'capHold', 'color', 'color2', 'colorBar', 'colorDim', 'colorHighlight', 'colorMode', 'coverAudioScale', 'coverFit', 'coverGap', 'coverOverlay', 'coverRadius', 'coverSide', 'coverSize', 'coverSource', 'floorDb', 'gap', 'glow', 'lineWidth', 'maxFreq', 'minFreq', 'mirror', 'position', 'reflection', 'reflectionLength', 'release', 'scale', 'segmentGap', 'segmentSize', 'sensitivity', 'smooth', 'spread', 'studioColorMode', 'thickness', 'tilt', 'trailHeight', 'type'],
  logo: ['audioBand', 'audioBrightness', 'audioHue', 'audioOpacity', 'audioSpeed', 'beatFlash', 'blend', 'brightness', 'cornerRadius', 'enabled', 'glow', 'hue', 'loop', 'opacity', 'pulse', 'reverse', 'saturate', 'scale', 'smooth', 'source', 'speed'],
  images: ['enabled'],
  text: ['karaokeFill', 'karaokeHold', 'karaokeHoldAmount', 'karaokeHoldMin', 'karaoke', 'offset', 'lyricsFollow'],
};

for (const [card, keys] of Object.entries(FIELDS)) {
  test(card + ' kartının alanları katman düzenleyicisinde', () => {
    const lost = keys.filter((k) => !has(k));
    assert.deepStrictEqual(lost, []);
  });
}

/* Genişletilmiş aralık: yanlış yazılan yol sessizce sabit sınıra düşerdi. */
test('katman kaydırıcılarının şema yolları var, genişletilmiş aralığa bağlı', () => {
  const Schema = require('../src/shared/schema.js');
  const src = fs.readFileSync(path.join(__dirname, '..', 'src', 'admin', 'scene-panels.js'), 'utf8');
  const paths = [...src.matchAll(/path: '([a-zA-Z.]*[a-zA-Z])'/g)].map((m) => m[1]);
  assert.ok(paths.length >= 40, String(paths.length));
  assert.deepStrictEqual(paths.filter((p) => !Schema.rangeFor(p)), []);
  assert.match(src, /P\(\)\.sliderMax\(\{ max: baseMax, noExtend: !!\(row && row\.noExtend\) \}\)/);
  for (const key of ['sensitivity', 'barCount', 'spectrum.tilt']) assert.ok(paths.includes('visualizer.' + key), key);
  for (const key of ['scale', 'x', 'speed']) assert.ok(paths.includes('logo.' + key), key);
});
