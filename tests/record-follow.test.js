'use strict';
/* İKİ KİP: GERÇEK ZAMANLI KAYIT ÇALMA KAFASINI İZLİYOR (#530).
 *
 * Çevrimdışı render (dışa aktarma kartı) ve gerçek zamanlı kayıt (kayıt
 * kartı) ayrı kalıyor. Gerçek zamanlı kayıt istenirse zaman çizelgesini
 * izliyor. Panelde ölçüldü: çal -> 2,5 sn sonra kayıt açık; duraklat -> kapalı.
 * 2 sn'lik çizelgede (döngü kapalı) kayıt 1. saniyede açık, sondan sonra
 * kapalı; taşıma çalmayı sürdürse de.
 */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const read = (p) => fs.readFileSync(path.join(__dirname, '..', p), 'utf8');

function loadPanel() {
  const saved = global.window;
  global.window = {};
  delete require.cache[require.resolve('../src/admin/record-panel.js')];
  require('../src/admin/record-panel.js');
  const api = global.window.SVRecordPanel;
  if (saved === undefined) delete global.window; else global.window = saved;
  return api;
}

test('karar: yalnız çalma başlarken açar, yalnız kendi açtığını kapatır', () => {
  const d = loadPanel().followDecision;
  const base = { enabled: true, playing: false, wasPlaying: false, atEnd: false, recording: false, busy: false, byFollow: false };
  const s = (o) => Object.assign({}, base, o);
  assert.strictEqual(d(s({ playing: true })), 'start', 'çalma başladı');
  assert.strictEqual(d(s({ playing: true, wasPlaying: true })), null, 'çalarken elle durdurulan kayıt yeniden açılmaz');
  assert.strictEqual(d(s({ playing: true, busy: true })), null, 'dosya yazılırken açılmaz');
  assert.strictEqual(d(s({ playing: true, atEnd: true })), null, 'sondayken açılmaz');
  assert.strictEqual(d(s({ recording: true, byFollow: true, playing: false })), 'stop', 'durdu');
  assert.strictEqual(d(s({ recording: true, byFollow: true, playing: true, wasPlaying: true, atEnd: true })), 'stop', 'çizelge bitti');
  assert.strictEqual(d(s({ recording: true, byFollow: false, playing: false })), null, 'elle başlatılan kayda dokunmaz');
  assert.strictEqual(d(s({ enabled: false, playing: true })), null, 'kapalıyken hiçbir şey');
  assert.strictEqual(d(null), null);
});

test('izleyici: başlatma sürerken bayrak düşmüyor, açılışta da çalışıyor', () => {
  const src = read('src/admin/record-panel.js');
  // start() asenkron (yüzey 1,5 sn'ye kadar bekleniyor); bu arada kayıt
  // "bitmiş" sayılırsa durmada kapanmazdı
  assert.match(src, /busy: busy \|\| saving \|\| followPending,/);
  assert.match(src, /Promise\.resolve\(start\(cfg\)\)\.finally\(\(\) => \{ followPending = false; \}\);/);
  assert.match(src, /\} else if \(!followPending && !\(R && R\.recording\)\) \{/);
  assert.match(read('src/admin/admin.js'), /if \(window\.SVRecordPanel && cfg\.recording && cfg\.recording\.followTimeline\) window\.SVRecordPanel\.ensureFollow\(true\);/);
  assert.match(read('src/shared/defaults.js'), /followTimeline: false,/, 'varsayılan kapalı');
});

test('iki kip açıkça adlandırılıyor ve çevriliyor', () => {
  const A = read('src/admin/admin.js');
  assert.match(A, /desc: 'Gerçek zamanlı kip: /);
  assert.match(A, /desc: 'Çevrimdışı kip: /);
  const I = read('src/shared/i18n.js');
  assert.ok(I.includes("'Zaman çizelgesini izle (çalınca başla, durunca bitir)': 'Follow the timeline (start on play, stop on stop)'"));
  assert.ok(I.includes("'Çevrimdışı kip: bir ses dosyası seçin"));
  assert.ok(I.includes("'Gerçek zamanlı kip: ekranda göründüğü gibi"));
});
