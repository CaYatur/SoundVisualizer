'use strict';
/* Updates lives under Settings (not Library); Library scene/preset lists scroll;
 * top-right gear opens the same Settings category (no modal). */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const admin = fs.readFileSync(path.join(__dirname, '..', 'src', 'admin', 'admin.js'), 'utf8');
const css = fs.readFileSync(path.join(__dirname, '..', 'src', 'admin', 'admin.css'), 'utf8');
const i18n = fs.readFileSync(path.join(__dirname, '..', 'src', 'shared', 'i18n.js'), 'utf8');
const updatesPanel = fs.readFileSync(path.join(__dirname, '..', 'src', 'admin', 'updates-panel.js'), 'utf8');
const html = fs.readFileSync(path.join(__dirname, '..', 'src', 'admin', 'index.html'), 'utf8');
const settingsJs = fs.readFileSync(path.join(__dirname, '..', 'src', 'admin', 'settings.js'), 'utf8');

test('Settings category exists; Updates section is under settings not library', () => {
  assert.match(admin, /id:\s*'settings'[\s\S]{0,120}title:\s*'Ayarlar'/);
  assert.match(admin, /id:\s*'updates',\s*\n\s*category:\s*'settings'/);
  assert.doesNotMatch(admin, /id:\s*'updates',\s*\n\s*category:\s*'library'/);
  assert.match(admin, /id:\s*'appprefs',\s*\n\s*category:\s*'settings'/);
});

test('update toast and i18n point to Settings › Updates', () => {
  assert.match(updatesPanel, /Ayarlar › Güncellemeler/);
  assert.doesNotMatch(updatesPanel, /Kitaplık › Güncellemeler/);
  assert.match(i18n, /'Ayarlar › Güncellemeler':\s*'Settings › Updates'/);
});

test('Library user-presets lists have constrained height and overflow scroll', () => {
  assert.match(css, /\.user-presets\s*\{[^}]*max-height:\s*min\(360px,\s*45vh\)/s);
  assert.match(css, /\.user-presets\s*\{[^}]*overflow-y:\s*auto/s);
  const scenesIdx = admin.indexOf('function scenesCtrl');
  const presetsIdx = admin.indexOf('function userPresetsCtrl');
  assert.ok(scenesIdx > 0 && presetsIdx > 0);
  assert.match(admin.slice(scenesIdx, scenesIdx + 400), /class:\s*'user-presets'/);
  assert.match(admin.slice(presetsIdx, presetsIdx + 400), /class:\s*'user-presets'/);
});

test('one Settings: top-right gear opens category; modal removed', () => {
  assert.match(html, /id="settingsBtn"/);
  assert.doesNotMatch(html, /settingsBackdrop/);
  assert.doesNotMatch(html, /alwaysOnTopToggle|extendedRangeToggle|protectToggle/);
  assert.match(admin, /openSettings:\s*\(\)\s*=>\s*setCategory\('settings'\)/);
  assert.match(admin, /settingsBtn[\s\S]{0,120}setCategory\('settings'\)/);
  assert.match(settingsJs, /SVPanel\.openSettings/);
  assert.doesNotMatch(settingsJs, /settingsBackdrop\.classList|function closeSettings/);
  assert.match(settingsJs, /openUnifiedSettings/);
  assert.doesNotMatch(css, /\.settings-backdrop|\.settings-panel\s*\{/);
  assert.match(admin, /function languageCtrl/);
  assert.match(admin, /function extendedRangeCtrl/);
  assert.match(admin, /path:\s*'power\.alwaysOnTop'/);
  assert.match(admin, /path:\s*'power\.protect'/);
  assert.match(admin, /path:\s*'power\.confirmClose'/);
});