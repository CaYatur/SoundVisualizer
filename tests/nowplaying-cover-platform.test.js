'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const npSrc = fs.readFileSync(path.join(__dirname, '..', 'src', 'visualizer', 'modes', 'nowplaying.js'), 'utf8');
const panelSrc = fs.readFileSync(path.join(__dirname, '..', 'src', 'admin', 'nowplaying-panel.js'), 'utf8');
const adminSrc = fs.readFileSync(path.join(__dirname, '..', 'src', 'admin', 'admin.js'), 'utf8');
const sceneSrc = fs.readFileSync(path.join(__dirname, '..', 'src', 'admin', 'scene-panels.js'), 'utf8');
const defaultsSrc = fs.readFileSync(path.join(__dirname, '..', 'src', 'shared', 'defaults.js'), 'utf8');

test('defaults: coverOverlay varsayilan kapali', () => {
  assert.match(defaultsSrc, /coverOverlay:\s*false/);
  assert.match(defaultsSrc, /coverSize:/);
  assert.match(defaultsSrc, /coverGap:/);
  assert.match(defaultsSrc, /coverSide:\s*'auto'/);
  assert.match(defaultsSrc, /coverFit:\s*'natural'/);
  assert.match(defaultsSrc, /coverAudioScale:\s*0/);
});

test('kaynak: NP cover overlay cizer', () => {
  assert.match(npSrc, /!!c\.coverOverlay/);
  assert.match(npSrc, /_coverImage\s*\(/);
  assert.match(npSrc, /drawImage\s*\(\s*coverImg/);
});

test('kaynak: NP panel cover ayarlari', () => {
  assert.match(panelSrc, /coverOverlay/);
  assert.match(panelSrc, /coverSize/);
  assert.match(panelSrc, /Albüm Kapağı|coverSide/);
});

test('kaynak: dynamicTheme karti Windows-only', () => {
  assert.match(adminSrc, /id:\s*'dynamicTheme'[\s\S]{0,400}SV_PLATFORM\.isWindows/);
  assert.match(adminSrc, /applyDynamicThemeNow[\s\S]{0,300}isWindows/);
});

test('kaynak: NP sistem kaynagi non-Windows manuel', () => {
  assert.match(panelSrc, /isWin/);
  assert.match(panelSrc, /C\.source\s*=\s*'manual'/);
});
test('UI: NP panel cover toggle is always visible (not only inside foldable)', () => {
  const toggleAt = panelSrc.indexOf("miniToggle('Kapağı Göster'");
  const foldAt = panelSrc.indexOf("foldable('Albüm Kapağı (Bindirme)'");
  assert.ok(toggleAt > 0, 'Kapağı Göster toggle missing');
  assert.ok(foldAt > 0, 'Albüm Kapağı foldable missing');
  assert.ok(toggleAt < foldAt, 'toggle should come before foldable');
});

test('UI: Visualizer card exposes coverOverlay when type is nowplaying', () => {
  assert.match(adminSrc, /path:\s*'nowplaying\.coverOverlay'/);
  assert.match(adminSrc, /path:\s*'nowplaying\.coverSize'/);
  assert.match(adminSrc, /path:\s*'nowplaying\.coverSide'/);
  assert.match(adminSrc, /coverOverlay'[\s\S]{0,160}rebuild:\s*true/);
});

test('UI: Layers panel exposes coverOverlay for nowplaying layers', () => {
  assert.match(sceneSrc, /l\.type\s*===\s*'nowplaying'[\s\S]{0,900}coverOverlay/);
  assert.match(sceneSrc, /setCover\('coverOverlay'/);
  assert.match(sceneSrc, /Kapak Boyutu|coverSize/);
  assert.match(sceneSrc, /Kapak Konumu|coverSide/);
});

test('defaults: coverSide includes top; coverSize is display-relative', () => {
  assert.match(defaultsSrc, /coverSide:\s*'auto'/);
  assert.match(defaultsSrc, /'auto' \(= top\) \| 'left' \| 'right' \| 'top'/);
  assert.match(defaultsSrc, /coverSize:\s*0\.14/);
  assert.match(defaultsSrc, /cornerRadius:\s*0/);
});

test('kaynak: NP cover anchors to bar\/text; supports top; display size', () => {
  assert.match(npSrc, /side === 'top'/);
  assert.match(npSrc, /blockLeft/);
  assert.match(npSrc, /textCenterY/);
  assert.match(npSrc, /minDim \* coverSizeVal|coverSizeVal > 1/);
  assert.doesNotMatch(npSrc, /pairShift/);
});

test('UI: coverSide offers top; logo\/images cornerRadius exposed', () => {
  assert.match(panelSrc, /\['top'/);
  assert.match(adminSrc, /value:\s*'top'/);
  assert.match(adminSrc, /logo\.cornerRadius/);
  assert.match(adminSrc, /cornerRadius/);
  assert.match(sceneSrc, /\['top'/);
  assert.match(sceneSrc, /cornerRadius/);
});

test('kaynak: auto coverSide resolves to top', () => {
  assert.match(npSrc, /side === 'auto'[\s\S]{0,80}side = 'top'/);
});

test('defaults+UI: coverFit natural default; square option; separate coverAudioScale', () => {
  assert.match(defaultsSrc, /coverFit:\s*'natural'/);
  assert.match(defaultsSrc, /coverAudioScale:\s*0/);
  assert.match(npSrc, /coverFit === 'natural'/);
  assert.match(npSrc, /coverAudioScale/);
  assert.match(npSrc, /1 \/ pulse/); // undo text pulse for cover
  assert.match(panelSrc, /coverFit/);
  assert.match(panelSrc, /Kapak Sığdırma|natural/);
  assert.match(panelSrc, /square/);
  assert.match(panelSrc, /coverAudioScale/);
  assert.match(adminSrc, /path:\s*'nowplaying\.coverFit'/);
  assert.match(adminSrc, /path:\s*'nowplaying\.coverAudioScale'/);
  assert.match(sceneSrc, /setCover\('coverFit'/);
  assert.match(sceneSrc, /setCover\('coverAudioScale'/);
});

test('kaynak: natural fit uses aspect coverW/coverH not forced square', () => {
  assert.match(npSrc, /coverW = coverPx; coverH = coverPx \* \(ih \/ iw\)/);
  assert.match(npSrc, /fit:\s*drawFit/);
});
