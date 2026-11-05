'use strict';
/* Durmuş zaman çizelgesi canlı çıkışı sürmesin: oynatma kafası bir
 * klibin üzerinde dursa bile, çıpa playing değilken otomasyon/sahne
 * uygulaması açık ekranı ve önizlemeyi ezmemeli. Kullanıcı Sahne/Şablon
 * değiştirebilmeli. */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const read = (rel) => fs.readFileSync(path.join(root, rel), 'utf8').replace(/\r\n/g, '\n');
const VIS = read('src/visualizer/visualizer.js');
const PREV = read('src/admin/preview.js');
const TL = read('src/admin/timeline-panel.js');

test('görselleştirici otomasyonu yalnız playing çıpasında uygulanır', () => {
  assert.match(VIS, /const tlDriving = !!\(showAnchor && showAnchor\.playing\)/);
  assert.match(VIS, /tlDriving && cfg\.timeline && cfg\.timeline\.enabled/);
  assert.match(VIS, /SVTimeline\.applyAutomation/);
});

test('önizleme otomasyonu yalnız playing çıpasında uygulanır', () => {
  assert.match(PREV, /if \(showAnchor && showAnchor\.playing\)/);
  assert.match(PREV, /SVTimeline\.applyAutomation/);
});

test('panel döngüsü dururken applyClipsAt çağırmaz', () => {
  const at = TL.indexOf('function loopBody()');
  assert.ok(at > 0);
  const body = TL.slice(at, at + 1200);
  assert.match(body, /if \(tr\.playing && tlOn && !held\) applyClipsAt\(tr\.time\)/);
  assert.doesNotMatch(body, /if \(tlOn && !held\) applyClipsAt/);
});

test('sekme yeniden adlandırma satır içi (prompt yok)', () => {
  assert.match(TL, /function startTabRename\(/);
  assert.match(TL, /class: 'txt tl-tab-rename'/);
  assert.match(TL, /addEventListener\('dblclick'/);
  assert.doesNotMatch(TL, /window\.prompt\(tt\('Çizelge adı'/);
});
