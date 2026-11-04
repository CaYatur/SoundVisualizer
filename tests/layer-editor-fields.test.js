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
