/*
 * SoundVisualizer — CaYaDev Ses Görselleştirici
 * Copyright (c) 2026 Çağan Turgut (CaYatur) — CaYaDev, https://cayadev.com
 * https://github.com/CaYatur/SoundVisualizer
 * SPDX-License-Identifier: MIT
 */
'use strict';
/* ERKEN KAPANIŞ (#813, Windows'ta görüldü). Köprünün ikinci kopyası modül
   yüklenirken app.quit() çağırıyordu; Electron will-quit'i eşzamanlı
   tetikledi ve işleyici henüz tanımlanmamış `let instanceTimer`a eriştı:
   "ReferenceError: Cannot access 'instanceTimer' before initialization".
   Kapanış işleyicisinin dokunduğu her üst düzey `let`/`const`, işleyici
   modül sonuna kadar yüklenmeden çalışmamalı. */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const main = fs.readFileSync(path.join(__dirname, '..', 'src', 'main', 'main.js'), 'utf8').replace(/\r\n/g, '\n');

function handlerBody(event) {
  const at = main.indexOf("app.on('" + event + "', () => {");
  assert.ok(at >= 0, event + ' işleyicisi yok');
  const end = main.indexOf('\n});', at);
  return { at, body: main.slice(at, end) };
}

test('will-quit: modül yüklenmeden temizlik yapılmıyor', () => {
  const { at, body } = handlerBody('will-quit');
  const decl = main.indexOf('let mainLoaded = false;');
  assert.ok(decl >= 0 && decl < at, 'bayrak işleyiciden önce tanımlı');
  const guard = body.indexOf('if (!mainLoaded) {');
  assert.ok(guard > 0, 'işleyici bayrağa bakıyor');
  for (const call of ['stopInstanceRegistry()', 'flushPartialsSync(']) {
    const i = body.indexOf(call);
    assert.ok(i > guard, call + ' bayraktan sonra');
  }
  // Bayrak modülün en sonunda açılıyor
  assert.match(main.trimEnd(), /\nmainLoaded = true;$/);
});

test('will-quit işleyicisinin çağırdığı işlevlerin üst düzey durumu işleyiciden sonra tanımlı (bayrak şart)', () => {
  const { at } = handlerBody('will-quit');
  // Bu durumlar işleyiciden SONRA tanımlı: bayrak olmadan erken kapanış TDZ verir
  for (const name of ['instanceTimer', 'pendingPartials']) {
    const m = new RegExp('^(let|const) ' + name + '\\b', 'm').exec(main);
    assert.ok(m, name + ' tanımı');
    assert.ok(m.index > at, name + ' işleyiciden sonra (kural değişirse test güncellenmeli)');
  }
});

test('köprünün ikinci kopyası yüklenirken app.quit() değil app.exit(0)', () => {
  const at = main.indexOf('if (!app.requestSingleInstanceLock()) {');
  assert.ok(at >= 0);
  const block = main.slice(at, main.indexOf('} else {', at)).replace(/\/\*[\s\S]*?\*\//g, '');
  assert.match(block, /app\.exit\(0\);/);
  assert.doesNotMatch(block, /app\.quit\(\)/);
});
