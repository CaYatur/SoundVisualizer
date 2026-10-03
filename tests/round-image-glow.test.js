'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

test('SVRoundImage draws rounded silhouette before glow', () => {
  const riPath = path.join(__dirname, '..', 'src', 'visualizer', 'modes', 'round-image.js');
  const ri = fs.readFileSync(riPath, 'utf8');
  assert.match(ri, /function drawImage/);
  assert.match(ri, /shadowBlur/);
  // Radius path: clip on scratch (s.clip), then draw scratch to ctx with shadowBlur
  const clipAt = ri.indexOf('s.clip()');
  assert.ok(clipAt > 0, 'scratch clip');
  const afterClip = ri.slice(clipAt);
  const glowAt = afterClip.indexOf('ctx.shadowBlur = glow');
  assert.ok(glowAt > 0, 'destination glow after scratch clip');

  // ~32% logo glow is an edge halo: blur the silhouette, punch out the
  // opaque core, add the fringe, then paint the sharp sprite on top.
  const api = require(riPath);
  const plan = api.edgeBloomLayout(0.32 * 40);
  const full = api.edgeBloomLayout(40);
  assert.equal(plan.knockout, 'destination-out');
  assert.equal(plan.composite, 'lighter');
  assert.equal(full.composite, 'lighter');
  assert.ok(plan.glow > 12.8, 'low glow still blooms, wider than the old shadow radius');
  assert.equal(full.glow, 120);
  assert.equal(full.strength, 3);
  assert.equal(api.edgeBloomLayout(0).glow, 0);
  assert.equal(api.edgeBloomLayout(0).strength, 0);
  let prevStep = api.edgeBloomLayout(0);
  for (let step = 1; step <= 40; step++) {
    const cur = api.edgeBloomLayout(step);
    const dg = cur.glow - prevStep.glow;
    const ds = cur.strength - prevStep.strength;
    assert.ok(dg > 0 && dg < 6, 'radius step ' + step);
    assert.ok(ds > 0 && ds < 0.2, 'strength step ' + step);
    prevStep = cur;
  }
  assert.ok(full.glow > plan.glow * 4, '100% is clearly stronger than a modest setting');
  assert.ok(plan.pad >= plan.glow * 2, 'padding keeps the blur from clipping into a flat veil');
  assert.ok(full.pad >= full.glow * 2);
  const bloomStart = ri.indexOf('function drawEdgeBloom');
  const bloomEnd = ri.indexOf('function drawImage');
  assert.ok(bloomStart > 0 && bloomEnd > bloomStart);
  const bloom = ri.slice(bloomStart, bloomEnd);
  assert.equal(/shadowColor\s*=/.test(bloom), false);
  const blurAt = bloom.indexOf("b.filter = 'blur(");
  const knockAt = bloom.indexOf('layout.knockout');
  const lightAt = bloom.indexOf('layout.composite');
  assert.ok(bloom.includes('layout.strength'), 'halo intensity follows the slider');
  assert.equal(bloom.includes('layout.passes'), false);
  assert.equal(/Math\.round/.test(ri.slice(ri.indexOf('function edgeBloomLayout'), ri.indexOf('function drawFitted'))), false);
  const haloAt = bloom.indexOf('drawImage(bc.canvas');
  const sharpAt = bloom.lastIndexOf('drawImage(sc.canvas');
  assert.ok(blurAt > 0 && blurAt < knockAt && knockAt < lightAt && lightAt < haloAt && haloAt < sharpAt,
    'blur, knock out core, add halo, then sharp sprite');
});

test('logo sprites nowplaying use SVRoundImage', () => {
  const root = path.join(__dirname, '..', 'src', 'visualizer');
  for (const rel of ['layers.js', 'modes/sprites.js', 'modes/nowplaying.js']) {
    const src = fs.readFileSync(path.join(root, rel), 'utf8');
    assert.match(src, /SVRoundImage/, rel);
  }
  const layers = fs.readFileSync(path.join(root, 'layers.js'), 'utf8');
  const paintStart = layers.indexOf('_paintLogo');
  const paintEnd = layers.indexOf('_drawLogoToCanvas');
  const paint = layers.slice(paintStart, paintEnd);
  const callStart = paint.indexOf('SVRoundImage.drawImage');
  const callEnd = paint.indexOf('} else');
  const call = paint.slice(callStart, callEnd);
  assert.match(call, /edgeBloom:\s*true/);
  assert.equal(call.includes('255,255,255'), false, 'logo glow must not be a white shadow');
  const adminHtml = fs.readFileSync(path.join(__dirname, '..', 'src', 'admin', 'index.html'), 'utf8');
  assert.match(adminHtml, /round-image\.js/);
});

test('SVRoundImage supports fit cover/contain via drawFitted', () => {
  const ri = fs.readFileSync(path.join(__dirname, '..', 'src', 'visualizer', 'modes', 'round-image.js'), 'utf8');
  assert.match(ri, /function drawFitted/);
  assert.match(ri, /o\.fit \|\| 'stretch'/);
  assert.match(ri, /drawFitted\(s, source/);
});
