'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const npSrc = fs.readFileSync(path.join(__dirname, '..', 'src', 'visualizer', 'modes', 'nowplaying.js'), 'utf8');
const panelSrc = fs.readFileSync(path.join(__dirname, '..', 'src', 'admin', 'nowplaying-panel.js'), 'utf8');
const adminSrc = fs.readFileSync(path.join(__dirname, '..', 'src', 'admin', 'admin.js'), 'utf8');
const defaultsSrc = fs.readFileSync(path.join(__dirname, '..', 'src', 'shared', 'defaults.js'), 'utf8');

test('defaults: coverOverlay varsayilan kapali', () => {
  assert.match(defaultsSrc, /coverOverlay:\s*false/);
  assert.match(defaultsSrc, /coverSize:/);
  assert.match(defaultsSrc, /coverGap:/);
  assert.match(defaultsSrc, /coverSide:\s*'auto'/);
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