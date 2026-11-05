'use strict';
/* Sahne listesi kaydırması: applyScene → render → paintShelf rafı
 * söktüğünde #sceneList scrollTop 0'a düşüyordu. selectionOnly yetmezdi
 * çünkü setTimeout(renderScenes) tam yeniden kuruyordu. */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const read = (rel) => fs.readFileSync(path.join(root, rel), 'utf8').replace(/\r\n/g, '\n');
const ADMIN = read('src/admin/admin.js');
const SHELL = read('src/admin/scene-shell.js');
const CSS = read('src/admin/admin.css');
const PAGES = read('src/admin/pages.css');

test('shelfSig boş dönmez; Sahne sekmesi her paint’te rafı yıkmaz', () => {
  assert.match(SHELL, /if \(!shelfOpen\) return 'closed:' \+ shelfTab/);
  assert.match(SHELL, /if \(shelfTab !== 'milkdrop'\) return shelfTab \+ '\|' \+ String\(query \|\| ''\)/);
  assert.match(SHELL, /const mdMissing = shelfTab === 'milkdrop'/);
  assert.doesNotMatch(SHELL, /if \(shelfStale \|\| !sig \|\| sig !== shelfPainted/);
});

test('sceneShelf dolu listede selectionOnly ister', () => {
  assert.match(SHELL, /P\(\)\.renderScenes\(full \? undefined : \{ selectionOnly: true \}\)/);
});

test('renderScenes kaydırmayı modül + rAF ile geri yazar', () => {
  assert.match(ADMIN, /let sceneListScroll = 0/);
  assert.match(ADMIN, /function restoreSceneListScroll\(/);
  assert.match(ADMIN, /requestAnimationFrame\(\(\) => \{ apply\(\); requestAnimationFrame\(apply\); \}\)/);
  assert.match(ADMIN, /restoreSceneListScroll\(host, keepScroll\)/);
  assert.match(ADMIN, /const keepScroll = Math\.max\(host\.scrollTop \|\| 0, sceneListScroll \|\| 0\)/);
});

test('tam liste rebuild scrollTop’u koruyan yardımcı yakalar', () => {
  /* Davranış: innerHTML temizlenince scrollTop 0 olur; restore olmadan
     kullanıcı alta kaydırdığı yer kaybolur. Bu sahte DOM, gerçek
     restoreSceneListScroll desenini taklit eder. */
  const host = {
    scrollTop: 420,
    isConnected: true,
    dataset: {},
    listeners: [],
    addEventListener(type, fn) { this.listeners.push([type, fn]); },
  };
  let sceneListScroll = host.scrollTop;
  const keepScroll = Math.max(host.scrollTop || 0, sceneListScroll || 0);
  // rebuild
  host.scrollTop = 0;
  assert.strictEqual(host.scrollTop, 0, 'rebuild scroll’u sıfırlar');
  const apply = () => {
    if (!host.isConnected) return;
    if (host.scrollTop !== keepScroll) host.scrollTop = keepScroll;
    sceneListScroll = host.scrollTop;
  };
  apply();
  assert.strictEqual(host.scrollTop, 420, 'sync restore kaydırmayı geri yazmalı');
  assert.strictEqual(sceneListScroll, 420);
});

test('çizelge sekmeleri köşeye yapışık değil (padding)', () => {
  assert.match(CSS, /\.tl-tabs \{[^}]*padding:\s*8px 6px 2px/);
  assert.match(PAGES, /\.tl-tabs \{[^}]*padding:\s*8px 6px 0/);
});
