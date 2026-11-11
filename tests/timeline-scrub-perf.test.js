'use strict';
/* Zaman çizelgesi kaydırma/oynatma akıcılığı ve ekran seçici / Çıkış
 * düzeni (#957 geri bildirimi).
 *
 * Kök nedenler: her klip tetiklemesi tüm Zaman sayfasını yeniden kuruyordu,
 * üst üste binen klipler her karede sahneyi iki kez uyguluyordu, tuval her
 * karede baştan çiziliyordu ve oynatma başı tuvale boyanıyordu. */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const TL = require('../src/shared/timeline.js');

const rd = (p) => fs.readFileSync(path.join(__dirname, '..', p), 'utf8').replace(/\r\n/g, '\n');

test('activeClipsAt: parça başına en fazla bir klip, en geç başlayan kazanır', () => {
  const tl = { tracks: [
    { kind: 'clip', clips: [{ start: 0, dur: 4 }, { start: 2, dur: 4 }] },
    { kind: 'clip', clips: [{ start: 1, dur: 1 }] },
  ] };
  const r = TL.activeClipsAt(tl, 3);
  assert.strictEqual(r.length, 1);
  assert.strictEqual(r[0].clip.start, 2);
  assert.strictEqual(TL.activeClipsAt(tl, 1.5).length, 2);
  assert.strictEqual(TL.activeClipsAt(tl, 1.5)[0].clip.start, 0);
});

test('zaman paneli: klip tetiklemesi hafif uygular, oynatma başı ayrı katman', () => {
  const s = rd('src/admin/timeline-panel.js');
  assert.match(s, /activeClipsAt/);
  assert.match(s, /light:\s*true/);
  assert.match(s, /tl-playhead/);
  assert.match(s, /translate3d/);
  assert.match(s, /setPointerCapture/);
  assert.match(s, /function scrubTo/);
  assert.match(s, /shiftKey/);
  assert.match(s, /viewKey/);
  const a = rd('src/admin/admin.js');
  assert.match(a, /opts\.light && activeCategory === 'time'/);
});

test('ekran seçici: düğmeye bağlı kompakt açılır kutu', () => {
  const css = rd('src/admin/shell.css');
  const m = css.match(/\.display-menu\s*\{[^}]*\}/g).join('\n');
  assert.match(m, /left:\s*auto/);
  assert.match(m, /width:\s*min\(360px/);
  assert.match(rd('src/admin/admin.js'), /function placeDisplayMenu/);
});

test('Çıkış: dar formda seçim kutusu etiketin altında (üst üste binmez)', () => {
  const css = rd('src/admin/pages.css');
  assert.match(css, /grid-row:\s*2/);
  assert.match(css, /grid-column:\s*1 \/ -1/);
});
