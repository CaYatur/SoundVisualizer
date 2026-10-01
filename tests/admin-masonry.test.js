'use strict';
/* Kart ızgarası yeniden çizimde doğal boyu ölçmeli. Masonry sınıfı açıkken
   ölçmek Linux'ta kartları 4 px sanıp üst üste bindiriyordu. */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const admin = fs.readFileSync(path.join(__dirname, '..', 'src', 'admin', 'admin.js'), 'utf8');
const css = fs.readFileSync(path.join(__dirname, '..', 'src', 'admin', 'admin.css'), 'utf8');

test('yeniden çizim masonry sınıfını kartlar doğmadan kapatır', () => {
  const i = admin.indexOf('function render()');
  assert.ok(i > 0);
  const body = admin.slice(i, i + 700);
  const off = body.indexOf("classList.remove('masonry')");
  const clear = body.indexOf('root.innerHTML');
  assert.ok(off > 0 && clear > off, 'masonry, kartlar silinmeden kapanmalı');
});

test('layoutCards boyu 4 px ızgara kapalıyken ölçer', () => {
  const i = admin.indexOf('function layoutCards');
  const end = admin.indexOf('function buildCard', i);
  assert.ok(i > 0 && end > i);
  const body = admin.slice(i, end);
  const off = body.indexOf("root.classList.remove('masonry')");
  const measure = body.indexOf('const heights = kids.map');
  const on = body.indexOf("root.classList.add('masonry')");
  assert.ok(off > 0 && measure > off && on > measure, 'ölçüm masonry açılmadan önce olmalı');
  assert.match(body.slice(measure, on), /getBoundingClientRect\(\)\.height/);
  /* Gözlemci span'i küçültmesin: 4 px'lik satır okuması kartları yeniden bindirir. */
  assert.match(body, /if \(next > cur\) c\.style\.gridRowEnd = s/);
});

test('kart içeriği satır ızgarasına göre büzülmez', () => {
  assert.match(css, /\.card\s*\{[^}]*height:\s*max-content/s);
});

test('üretici çifti geniş pencerede satırı paylaşır', () => {
  const fn = admin.indexOf('function placeGeneratorPair');
  assert.ok(fn > 0);
  const body = admin.slice(fn, fn + 700);
  assert.match(body, /data-card="scenegen"/);
  assert.match(body, /data-card="mdgen"/);
  assert.match(body, /Math\.ceil\(cols \/ 2\)/);
  assert.match(body, /\/ -1/);
  const layout = admin.slice(admin.indexOf('function layoutCards'), admin.indexOf('function buildCard'));
  const place = layout.indexOf('placeGeneratorPair(root)');
  const measure = layout.indexOf('const heights = kids.map');
  assert.ok(place > 0 && place < measure, 'pay, boy ölçülmeden önce verilmeli');
  assert.match(layout, /clientWidth/);
  assert.match(css, /\.sections\s*\{[^}]*overflow-x:\s*hidden/s);
  assert.match(css, /\.card\s*\{[^}]*min-width:\s*0/s);
});
