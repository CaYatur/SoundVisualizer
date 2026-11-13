/*
 * SoundVisualizer — CaYaDev Ses Görselleştirici
 * Copyright (c) 2026 Çağan Turgut (CaYatur) — CaYaDev, https://cayadev.com
 * https://github.com/CaYatur/SoundVisualizer
 * SPDX-License-Identifier: MIT
 */
'use strict';
/* ANDROID SUNUCUSUNUN SÖZLEŞMESİ (docs/android/HOST.md).

   Masaüstündeki önyükleme betiği motorun gördüğü yüzeyin TEK kaynağı. Oraya
   yeni bir yöntem eklenince Android sunucusu ve HOST.md güncellenene kadar bu
   test düşer; motor Android'de tanımsız bir yöntemle karşılaşmaz.

   Bu testler `npm test`'e değil Android CI'ına bağlı (android/js-tests):
   dev/android yalnız dosya ekliyor ve masaüstündeki test sayısı satırlarına
   dokunmuyor (PLAN D14). */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.join(__dirname, '..', '..');
const read = (p) => fs.readFileSync(path.join(root, p), 'utf8');

/* exposeInMainWorld('<ad>', { ... }) bloğundaki üst düzey anahtarlar. */
function exposedKeys(src, name) {
  const start = src.indexOf("exposeInMainWorld('" + name + "', {");
  assert.ok(start >= 0, name + ' bloğu bulunamadı');
  let depth = 0;
  let i = src.indexOf('{', start);
  const from = i;
  for (; i < src.length; i++) {
    if (src[i] === '{') depth++;
    else if (src[i] === '}') { depth--; if (depth === 0) break; }
  }
  const body = src.slice(from + 1, i);
  const keys = [];
  let d = 0;
  for (const line of body.split('\n')) {
    if (d === 0) {
      const m = /^\s{2}([A-Za-z_$][\w$]*)\s*:/.exec(line);
      if (m) keys.push(m[1]);
    }
    for (const ch of line) { if (ch === '{' || ch === '(' || ch === '[') d++; else if (ch === '}' || ch === ')' || ch === ']') d--; }
  }
  return keys;
}

function loadHost(extra) {
  const window = Object.assign({ __SV_ANDROID: { debug: true, page: 'test' } }, extra || {});
  const ctx = { window, console, performance: { now: () => 0 }, Promise, JSON, Map, Object, Uint8Array, Array, Error };
  vm.createContext(ctx);
  vm.runInContext(read('src/mobile/android-host.js'), ctx, { filename: 'android-host.js' });
  return window;
}

const desktopApi = exposedKeys(read('src/main/preload-visualizer.js'), 'api');

test('masaüstündeki görselleştirici yüzeyi okunuyor', () => {
  assert.ok(desktopApi.length >= 40, 'beklenenden az yöntem: ' + desktopApi.length);
  assert.ok(desktopApi.includes('onNativeAudio'));
  assert.ok(desktopApi.includes('requestConfig'));
});

test('Android sunucusu masaüstündeki her yöntemi tanımlıyor', () => {
  const w = loadHost();
  const mine = Object.keys(w.api);
  const missing = desktopApi.filter((k) => !mine.includes(k));
  assert.deepStrictEqual(missing, [], 'Android sunucusunda eksik: ' + missing.join(', '));
  for (const k of desktopApi) assert.strictEqual(typeof w.api[k], 'function', k + ' işlev değil');
});

test('Android sunucusunda masaüstünde olmayan yöntem yok', () => {
  const w = loadHost();
  const extra = Object.keys(w.api).filter((k) => !desktopApi.includes(k));
  assert.deepStrictEqual(extra, [], 'masaüstünde karşılığı yok: ' + extra.join(', '));
});

test('HOST.md tablosu her yöntemi bir kez sayıyor', () => {
  const md = read('docs/android/HOST.md');
  const section = md.slice(md.indexOf('## Engine surface'), md.indexOf('## Export surface'));
  const rows = [...section.matchAll(/^\| `([A-Za-z]+)` \|/gm)].map((m) => m[1]);
  assert.deepStrictEqual([...rows].sort(), [...desktopApi].sort());
});

test('platform ve masaüstüne özgü küreseller Android değerleriyle kuruluyor', () => {
  const w = loadHost();
  assert.strictEqual(w.SV_PLATFORM.os, 'android');
  assert.strictEqual(w.SV_PLATFORM.isAndroid, true);
  assert.strictEqual(w.SV_PLATFORM.isWindows, false);
  assert.strictEqual(w.SV_DISPLAY_ID, null);
  assert.strictEqual(w.SV_SHARED_EPOCH, null);
  assert.strictEqual(w.SV_FLOATING, false);
});

test('boş yöntemler sözleşmedeki değeri döndürüyor', async () => {
  const w = loadHost();
  assert.strictEqual(await w.api.getSharedClock(), null);
  assert.deepStrictEqual(Array.from(await w.api.screenSources()), []);
  assert.strictEqual(await w.api.claimCamRelay('x'), false);
  // vm bağlamının nesneleri başka bir Object.prototype taşıyor: JSON ile karşılaştır
  assert.deepStrictEqual(JSON.parse(JSON.stringify(await w.api.getPowerSource())), { onBattery: false });
  // Hiç tetiklenmeyenler kayıt sırasında atmıyor
  assert.doesNotThrow(() => { w.api.onTbar(() => {}); w.api.onMomentaryFx(() => {}); w.api.onMdFollow(() => {}); });
});

test('masaüstü yüzeyi zaten varsa sunucu üzerine yazmıyor', () => {
  const own = { requestConfig() {} };
  const w = loadHost({ api: own });
  assert.strictEqual(w.api, own);
});

test('kanal yoksa istek reddediliyor, varsa hello ile başlıyor', async () => {
  const w = loadHost();
  await assert.rejects(w.__svHost.request('x'), /native-missing/);
  const sent = [];
  const native = { postMessage: (m) => sent.push(m) };
  loadHost({ SVNative: native });
  assert.strictEqual(JSON.parse(sent[0]).t, 'hello');
});
