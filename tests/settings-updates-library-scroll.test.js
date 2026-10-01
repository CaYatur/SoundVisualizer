'use strict';
/* Updates lives under Settings (not Library); Library scene/preset lists scroll. */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const admin = fs.readFileSync(path.join(__dirname, '..', 'src', 'admin', 'admin.js'), 'utf8');
const css = fs.readFileSync(path.join(__dirname, '..', 'src', 'admin', 'admin.css'), 'utf8');
const i18n = fs.readFileSync(path.join(__dirname, '..', 'src', 'shared', 'i18n.js'), 'utf8');
const updatesPanel = fs.readFileSync(path.join(__dirname, '..', 'src', 'admin', 'updates-panel.js'), 'utf8');

test('Settings category exists; Updates section is under settings not library', () => {
  assert.match(admin, /id:\s*'settings'[\s\S]{0,80}title:\s*'Ayarlar'/);
  assert.match(admin, /id:\s*'updates',\s*\n\s*category:\s*'settings'/);
  assert.doesNotMatch(admin, /id:\s*'updates',\s*\n\s*category:\s*'library'/);
});

test('update toast and i18n point to Settings › Updates', () => {
  assert.match(updatesPanel, /Ayarlar › Güncellemeler/);
  assert.doesNotMatch(updatesPanel, /Kitaplık › Güncellemeler/);
  assert.match(i18n, /'Ayarlar › Güncellemeler':\s*'Settings › Updates'/);
  assert.match(i18n, /'Uygulama sürümü, güncelleme denetimi ve kurulum türü\.'/);
});

test('Library user-presets lists have constrained height and overflow scroll', () => {
  assert.match(css, /\.user-presets\s*\{[^}]*max-height:\s*min\(360px,\s*45vh\)/s);
  assert.match(css, /\.user-presets\s*\{[^}]*overflow-y:\s*auto/s);
  // Both Scenes and My Color Presets use .user-presets for the item list
  const scenesIdx = admin.indexOf('function scenesCtrl');
  const presetsIdx = admin.indexOf('function userPresetsCtrl');
  assert.ok(scenesIdx > 0 && presetsIdx > 0);
  assert.match(admin.slice(scenesIdx, scenesIdx + 400), /class:\s*'user-presets'/);
  assert.match(admin.slice(presetsIdx, presetsIdx + 400), /class:\s*'user-presets'/);
});