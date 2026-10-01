'use strict';
/* Settings: Uygulama card (Dil/Pencere/Panel) + separate full-width Updates card.
 * Updates live only on the Settings full-width card (no footer modal). */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const admin = fs.readFileSync(path.join(__dirname, '..', 'src', 'admin', 'admin.js'), 'utf8');
const css = fs.readFileSync(path.join(__dirname, '..', 'src', 'admin', 'admin.css'), 'utf8');
const updatesPanel = fs.readFileSync(path.join(__dirname, '..', 'src', 'admin', 'updates-panel.js'), 'utf8');
const html = fs.readFileSync(path.join(__dirname, '..', 'src', 'admin', 'index.html'), 'utf8');
const settingsJs = fs.readFileSync(path.join(__dirname, '..', 'src', 'admin', 'settings.js'), 'utf8');

test('Settings: Uygulama card has Dil/Pencere/Panel; no nested Updates group', () => {
  assert.match(admin, /id:\s*'settings-main'/);
  assert.match(admin, /id:\s*'settings-main'[\s\S]{0,200}?wide:\s*true/);
  assert.match(admin, /id:\s*'settings-main'[\s\S]{0,120}?title:\s*'Uygulama'/);
  assert.match(admin, /group:\s*'Dil'/);
  assert.match(admin, /group:\s*'Pencere'/);
  assert.match(admin, /group:\s*'Panel'/);
  assert.doesNotMatch(admin, /group:\s*'Güncellemeler'/);
  assert.doesNotMatch(admin, /id:\s*'appprefs'/);
  const main = admin.slice(admin.indexOf("id: 'settings-main'"), admin.indexOf("id: 'settings-updates'"));
  assert.doesNotMatch(main, /updatespanel|updates\.mode/);
});

test('Settings: separate full-width Updates card', () => {
  assert.match(admin, /id:\s*'settings-updates'/);
  assert.match(admin, /id:\s*'settings-updates'[\s\S]{0,200}?wide:\s*true/);
  assert.match(admin, /id:\s*'settings-updates'[\s\S]{0,120}?category:\s*'settings'/);
  assert.match(admin, /id:\s*'settings-updates'[\s\S]{0,800}?type:\s*'updatespanel'/);
  assert.match(admin, /path:\s*'updates\.mode'/);
  assert.doesNotMatch(admin, /id:\s*'updates',\s*\n\s*category:\s*'library'/);
});

test('Updates footer modal removed; Settings card panel remains', () => {
  assert.doesNotMatch(html, /id="updatesBtn"/);
  assert.doesNotMatch(html, /id="updatesBackdrop"/);
  assert.doesNotMatch(html, /id="updatesModalBody"/);
  assert.doesNotMatch(updatesPanel, /function openModal/);
  assert.doesNotMatch(updatesPanel, /function closeModal/);
  assert.doesNotMatch(updatesPanel, /fillModalBody/);
  assert.doesNotMatch(updatesPanel, /updatesBtn/);
  assert.match(updatesPanel, /function buildPanel/);
  assert.match(updatesPanel, /function panel/);
  assert.doesNotMatch(css, /\.upd-backdrop/);
  assert.doesNotMatch(css, /#updatesBtn/);
});

test('Settings groups have distinct block styles with theme tokens', () => {
  assert.match(css, /data-card="settings-main"[\s\S]{0,120}\.group/);
  assert.match(css, /settings-main"[\s\S]{0,500}group-label::before/);
  assert.match(css, /settings-main"[\s\S]{0,400}color:\s*var\(--accent2\)/);
  assert.match(css, /settings-main"[\s\S]{0,900}studio-note\.dim-hint/);
  const start = css.indexOf('/* Settings card:');
  const end = css.indexOf('.card[data-card="settings-main"] .group select');
  assert.ok(start >= 0 && end > start);
  assert.doesNotMatch(css.slice(start, end), /#ff9aa3/);
});

test('Library user-presets lists have constrained height and overflow scroll', () => {
  assert.match(css, /\.user-presets\s*\{[^}]*max-height:\s*min\(360px,\s*45vh\)/s);
  assert.match(css, /\.user-presets\s*\{[^}]*overflow-y:\s*auto/s);
});

test('one Settings: top-right gear opens category; old settings modal removed', () => {
  assert.match(html, /id="settingsBtn"/);
  assert.doesNotMatch(html, /settingsBackdrop/);
  assert.match(admin, /openSettings:\s*\(\)\s*=>\s*setCategory\('settings'\)/);
  assert.match(settingsJs, /SVPanel\.openSettings/);
});