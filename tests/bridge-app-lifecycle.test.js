'use strict';
/* Uygulama kaynağının yaşam döngüsü (#813): seçili uygulama kapanınca satır
   ~2 sn içinde "kapandı" olur, bayat yakalama yardımcısı durur; uygulama
   yeniden açılınca ADIYLA yeni pid'e kendiliğinden bağlanılır. */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const read = (f) => fs.readFileSync(path.join(__dirname, '..', f), 'utf8').replace(/\r\n/g, '\n');
const AC = require('../src/main/app-capture.js');
const AA = require('../src/shared/app-audio.js');

test('pid yaşıyor mu: yok (ESRCH) ölü, yetki yok (EPERM) canlı', () => {
  assert.strictEqual(AA.pidAlive(process.pid), true);
  assert.strictEqual(AA.pidAlive(0), false);
  const esrch = () => { const e = new Error('x'); e.code = 'ESRCH'; throw e; };
  const eperm = () => { const e = new Error('x'); e.code = 'EPERM'; throw e; };
  assert.strictEqual(AA.pidAlive(1234, esrch), false);
  assert.strictEqual(AA.pidAlive(1234, eperm), true);
  assert.strictEqual(AA.pidAlive(1234, () => true), true);
});

test('bekçi: kapanan süreç, yeniden açılan uygulama, yalnız susan uygulama', () => {
  const w = { pid: 100, lastData: 0, attachedAt: 0, lastCheck: 0 };
  let asked = 0;
  const pidIs = (p) => () => { asked++; return p; };
  // Süreç öldü: liste sorulmadan hemen karar
  assert.strictEqual(AC.staleVerdict(w, 500, false, pidIs(100)), 'pid-gone');
  assert.strictEqual(asked, 0);
  // Veri akıyor: dokunma
  assert.strictEqual(AC.staleVerdict({ pid: 100, lastData: 9000, attachedAt: 0, lastCheck: 0 }, 10000, true, pidIs(200)), 'ok');
  // Yeni bağlandı: ilk 2 sn dokunma
  assert.strictEqual(AC.staleVerdict({ pid: 100, lastData: 0, attachedAt: 9000, lastCheck: 0 }, 10000, true, pidIs(200)), 'ok');
  // 2 sn veri yok, uygulama başka pid'de: yeniden açılmış
  assert.strictEqual(AC.staleVerdict({ pid: 100, lastData: 7000, attachedAt: 0, lastCheck: 0 }, 10000, true, pidIs(200)), 'restarted');
  // Listede hiç yok
  assert.strictEqual(AC.staleVerdict({ pid: 100, lastData: 7000, attachedAt: 0, lastCheck: 0 }, 10000, true, pidIs(0)), 'gone');
  // Aynı pid, yalnız susmuş (duraklatıldı): dokunma
  assert.strictEqual(AC.staleVerdict({ pid: 100, lastData: 7000, attachedAt: 0, lastCheck: 0 }, 10000, true, pidIs(100)), 'ok');
  // Liste pahalı: 3 sn içinde yeniden sorulmaz
  asked = 0;
  assert.strictEqual(AC.staleVerdict({ pid: 100, lastData: 7000, attachedAt: 0, lastCheck: 8000 }, 10000, true, pidIs(200)), 'ok');
  assert.strictEqual(asked, 0);
  assert.strictEqual(AC.staleVerdict(null, 0, true, pidIs(1)), 'ok');
});

test('yardımcı: bekçi saniyede bir, bayat yardımcıyı durdurup adla yeniden bağlıyor; Linux akış sayısından durum', () => {
  const H = read('src/main/loopback-helper.js');
  assert.match(H, /const watchTimer = wantedApps\.length && \(process\.platform !== 'linux' \|\| process\.env\.SV_APP_WATCH === '1'\) \? setInterval\(\(\) => \{/);
  assert.match(H, /appCapture\.staleVerdict\(w, now, appAudio\.pidAlive\(w\.pid\), \(\) => \{/);
  assert.match(H, /try \{ child\.kill\(\); \} catch \{ \/\* zaten öldü \*\/ \}\n\s+srcState\(wantedApps\[i\], 'closed'\);\n\s+attachApp\(wantedApps\[i\], i\);/);
  assert.match(H, /\}, 1000\) : null;\nif \(watchTimer && watchTimer\.unref\) watchTimer\.unref\(\);/);
  assert.match(H, /if \(watchTimer\) clearInterval\(watchTimer\);/);
  // Bekleyen uygulama sık aranıyor
  assert.match(H, /if \(!appProcs\[i\]\) attachApp\(wantedApps\[i\], i\);\n  \}\n\}, 2000\) : null;/);
  // Yardımcı çıkınca da "kapandı"
  assert.match(H, /process\.stderr\.write\('APP-DETACHED ' \+ app\.match \+ '\\n'\);\n\s+srcState\(app, 'closed'\);/);
  // Linux: oturum adla izliyor; akış yoksa satır kapandı
  assert.match(H, /if \(m && app\.mode !== 'exclude' && appProcs\[index\] === child\) srcState\(app, Number\(m\[1\]\) > 0 \? 'ok' : 'closed'\);/);
  assert.match(read('src/main/app-capture-linux.js'), /log\('APP-STREAMS ' \+ want\.size/);
});

test('pencere: kapandı durumu satırda ve altta TR/EN; çalan parça her değişimde çiziliyor', () => {
  const S = read('src/bridge-status/status.js');
  assert.match(S, /closed: 'kapandı; yeniden açılınca kendiliğinden bağlanır',/);
  assert.match(S, /stateOf: \(key\) =>/);
  assert.match(read('src/admin/audio-sources.js'), /const stNote = host\.stateOf \? host\.stateOf\(keyOf\(entry\)\) : '';/);
  const I = read('src/shared/i18n.js');
  for (const k of ['kapandı; yeniden açılınca kendiliğinden bağlanır', 'kapandı, bekleniyor', 'bekleniyor']) assert.ok(I.includes("'" + k + "':"), k);
  const M = read('src/main/main.js');
  const sub = M.slice(M.indexOf('mediaSession.subscribe((st) => {'));
  assert.ok(sub.indexOf('if (bridgeWinVisible()) notifyBridgeWindow();') > 0 && sub.indexOf('if (bridgeWinVisible()) notifyBridgeWindow();') < sub.indexOf("if (bridge.input && bridge.input.useBridge && bridge.meta) return;"), 'erken dönüşten önce');
  // Pencere en son durumu imzasına katıyor
  assert.match(S, /st\.nowPlaying, st\.appFallback/);
});
