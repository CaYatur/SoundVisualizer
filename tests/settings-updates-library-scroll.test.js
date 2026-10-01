'use strict';
/* Settings card: Dil / Pencere / Panel with distinct groups.
 * Updates open from the footer download button as a modal. */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const admin = fs.readFileSync(path.join(__dirname, '..', 'src', 'admin', 'admin.js'), 'utf8');
const css = fs.readFileSync(path.join(__dirname, '..', 'src', 'admin', 'admin.css'), 'utf8');
const updatesPanel = fs.readFileSync(path.join(__dirname, '..', 'src', 'admin', 'updates-panel.js'), 'utf8');
const html = fs.readFileSync(path.join(__dirname, '..', 'src', 'admin', 'index.html'), 'utf8');
const settingsJs = fs.readFileSync(path.join(__dirname, '..', 'src', 'admin', 'settings.js'), 'utf8');

test('Settings category: one wide card Dil/Pencere/Panel; Updates not inline', () => {
  assert.match(admin, /id:\s*'settings'[\s\S]{0,120}title:\s*'Ayarlar'/);
  assert.match(admin, /id:\s*'settings-main'/);
  assert.match(admin, /id:\s*'settings-main'[\s\S]{0,200}?wide:\s*true/);
  assert.match(admin, /group:\s*'Dil'/);
  assert.match(admin, /group:\s*'Pencere'/);
  assert.match(admin, /group:\s*'Panel'/);
  assert.doesNotMatch(admin, /type:\s*'updatespanel'/);
  assert.doesNotMatch(admin, /group:\s*'Güncellemeler'/);
  assert.doesNotMatch(admin, /id:\s*'appprefs'/);
});

test('Updates modal from footer download button', () => {
  assert.match(html, /id="updatesBtn"/);
  assert.match(html, /id="updatesBackdrop"/);
  assert.match(html, /id="updatesModalBody"/);
  assert.match(updatesPanel, /function openModal/);
  assert.match(updatesPanel, /function closeModal/);
  assert.match(updatesPanel, /updatesBtn/);
  assert.match(updatesPanel, /fillModalBody/);
  assert.match(css, /\.upd-backdrop/);
  assert.match(css, /\.upd-modal/);
  assert.match(updatesPanel, /tt\('Güncellemeler'\)/);
  assert.doesNotMatch(updatesPanel, /Ayarlar › Güncellemeler|Kitaplık › Güncellemeler/);
});

test('Settings groups have distinct block styles', () => {
  assert.match(css, /data-card="settings-main"[\s\S]{0,120}\.group/);
  assert.match(css, /settings-main"[\s\S]{0,500}group-label::before/);
  assert.match(css, /settings-main"[\s\S]{0,900}studio-note\.dim-hint/);
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
  assert.match(admin, /openSettings:\s*\(\)\s*=>\s*setCategory\('settings'\)/);
  assert.match(settingsJs, /SVPanel\.openSettings/);
  assert.match(admin, /function languageCtrl/);
  assert.match(admin, /function extendedRangeCtrl/);
});
