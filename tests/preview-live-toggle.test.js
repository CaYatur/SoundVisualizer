'use strict';
/* Önizleme rozeti (Canlı / Demo). Rozet gelen sesi gösteriyor, tıklama ise gizli bir tercihi
   çeviriyordu: görselleştirici açıkken kareler zaten geldiği için "Canlı"ya tıklamak Demo'ya
   geçmiyordu; "Demo"ya tıklamak bazen tercihi kapatıyordu, rozet yine Demo kalıyordu.
   Şimdi rozet seçimi gösterir, tıklama her zaman geçer; Canlı'ya geçip hiç ses bağlantısı
   yoksa uyarı verilir, bağlı ama sessizse verilmez. */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const read = (p) => fs.readFileSync(path.join(__dirname, '..', p), 'utf8').replace(/\r\n/g, '\n'); // Windows'ta satır sonu CRLF

test('rozet seçimi gösterir ve tıklama her zaman geçirir', () => {
  const a = read('src/admin/admin.js');
  assert.match(a, /pill\.addEventListener\('click', \(\) => setPreviewLive\(!previewWantsLive, true\)\);/);
  assert.match(a, /pill\.textContent = previewWantsLive \? 'Canlı' : 'Demo';/, 'metin seçimden, gelen sesten değil');
  const fn = a.slice(a.indexOf('function setPreviewLive'), a.indexOf('function setPreviewLive') + 1200);
  assert.match(fn, /window\.SVPreview\.setDemo\(!previewWantsLive\)/);
  assert.match(fn, /syncPreviewSubscription\(\);/);
  assert.match(fn, /if \(!previewWantsLive \|\| !warn\) return;/, 'Demo\'ya geçerken ve kaynak seçiminde uyarı yok');
  assert.match(fn, /SP\.hasConnection\(PREVIEW_LIVE_WAIT\)\) return;/, 'bağlı (sessiz de olsa) ise uyarı yok');
  assert.match(fn, /svToast\('Canlı ses bağlantısı yok/);
  assert.match(a, /function wantPreviewLive\(\) \{\n\s+if \(previewWantsLive\) return;\n\s+setPreviewLive\(true, false\);/);
});

/* preview.js'in ses yolu: Demo seçiliyken gerçek kareler motora girmez ama bağlantı sayılır. */
function previewApi() {
  const src = read('src/admin/preview.js');
  const ingest = src.slice(src.indexOf('  function ingest(f) {'), src.indexOf('  function setPaused'));
  const api = src.slice(src.indexOf('    setDemo:'), src.indexOf('    hasConnection:'));
  const fn = new Function('performance', `
    let demoForced = false, lastAnyFrame = 0, lastRealFrame = 0;
    const got = [];
    const audio = { ingestFrame: (f) => got.push(f) };
    ${ingest}
    return { ingest, got, ${api} hasConnection: (ms) => performance.now() - lastAnyFrame < (ms || 1500), real: () => lastRealFrame };
  `);
  return fn;
}

test('Demo seçiliyken gerçek kareler önizlemeye girmez, bağlantı yine izlenir', () => {
  const clock = { t: 1000 };
  const P = previewApi()({ now: () => clock.t });
  P.setDemo(true);
  P.ingest({ freq: [1] });
  assert.strictEqual(P.got.length, 0, 'Demo: görselleştirici açıkken gelen kare motora girmez');
  assert.strictEqual(P.real(), 0, 'Demo: önizleme canlı sayılmaz');
  assert.strictEqual(P.hasConnection(1500), true, 'bağlantı var: Canlı\'ya dönünce uyarı yok');
  P.setDemo(false);
  P.ingest({ freq: [1] });
  assert.strictEqual(P.got.length, 1);
  clock.t += 5000;
  assert.strictEqual(P.hasConnection(1500), false, 'kare gelmiyor: uyarı verilir');
});

test('Demo seçiliyken ses uyarısı yok, kaynak kapalıysa da örnek sinyal çalar', () => {
  const s = read('src/admin/preview.js');
  assert.match(s, /if \(demoForced \|\| live \|\| now - lastRealFrame < 1500\) return '';/);
  assert.match(s, /if \(sourcesOff\(\) && !demoForced\) \{/);
});
