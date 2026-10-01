'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

test('SVRoundImage draws rounded silhouette before glow', () => {
  const ri = fs.readFileSync(path.join(__dirname, '..', 'src', 'visualizer', 'modes', 'round-image.js'), 'utf8');
  assert.match(ri, /function drawImage/);
  assert.match(ri, /shadowBlur/);
  // Radius path: clip on scratch (s.clip), then draw scratch to ctx with shadowBlur
  const clipAt = ri.indexOf('s.clip()');
  assert.ok(clipAt > 0, 'scratch clip');
  const afterClip = ri.slice(clipAt);
  const glowAt = afterClip.indexOf('ctx.shadowBlur = glow');
  assert.ok(glowAt > 0, 'destination glow after scratch clip');
});

test('logo sprites nowplaying use SVRoundImage', () => {
  const root = path.join(__dirname, '..', 'src', 'visualizer');
  for (const rel of ['layers.js', 'modes/sprites.js', 'modes/nowplaying.js']) {
    const src = fs.readFileSync(path.join(root, rel), 'utf8');
    assert.match(src, /SVRoundImage/, rel);
  }
  const adminHtml = fs.readFileSync(path.join(__dirname, '..', 'src', 'admin', 'index.html'), 'utf8');
  assert.match(adminHtml, /round-image\.js/);
});

test('SVRoundImage supports fit cover/contain via drawFitted', () => {
  const ri = fs.readFileSync(path.join(__dirname, '..', 'src', 'visualizer', 'modes', 'round-image.js'), 'utf8');
  assert.match(ri, /function drawFitted/);
  assert.match(ri, /o\.fit \|\| 'stretch'/);
  assert.match(ri, /drawFitted\(s, source/);
});
