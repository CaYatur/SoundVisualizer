/*
 * SoundVisualizer — CaYaDev Ses Görselleştirici
 * Copyright (c) 2026 Çağan Turgut (CaYatur) — CaYaDev, https://cayadev.com
 * https://github.com/CaYatur/SoundVisualizer
 * SPDX-License-Identifier: MIT
 */
'use strict';
/* Telefonda dışa aktarma ses kuralı (#1172): çizelgeyle dışa aktarılırken şarkı istenmez
   (sessiz, çizelge uzunluğunda); seçilen şarkı geçersiz kılar; telefonda karıştırılamayan
   çizelge sesi için not. */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const root = path.join(__dirname, '..', '..');
const read = (p) => fs.readFileSync(path.join(root, p), 'utf8').replace(/\r\n/g, '\n');

test('sayfa: kaynak kuralı, düğme şarkısız da açık, sessizde süre çizelgenin uzunluğu', () => {
  const s = read('src/mobile/shell-export.js');
  assert.match(s, /function audioFrom\(\) \{ return song \? 'file' : timelineOn\(\) \? 'none' : ''; \}/);
  assert.match(s, /if \(!audioFrom\(\) \|\| busy\) return;/);
  assert.match(s, /disabled: !audioFrom\(\) \|\| busy \? true : null,/);
  assert.match(s, /const len = prefs\.length === 'all' \? \(silent \? Math\.ceil\(\(TLi && TLi\.length\) \|\| 0\) : 0\) : \+prefs\.length;/);
  assert.match(s, /durationSec: len, audioFrom: silent \? 'none' : 'file',\n      audioUri: silent \? '' : song\.uri,/);
  assert.match(s, /\['all', audioFrom\(\) === 'none' \? 'Çizelgenin tamamı' : 'Tamamı'\]/);
  assert.match(s, /if \(timelineOn\(\) && TLn\.audioClips > 0 && !song\) \{/);
  const i = read('src/shared/i18n.js');
  for (const k of ['Çizelgenin tamamı', 'Şarkı seçilmedi: video çizelgenin uzunluğunda ve sessiz çıkar.',
    'Bu çizelgenin ses klipleri bilgisayardaki dosyalara bağlı; telefonda karıştırılamaz. Bir şarkı seçin ya da video sessiz çıksın.']) {
    assert.ok(i.includes("'" + k + "': '"), k);
  }
});

test('çizelge bilgisi: uzunluk ve duyulur ses klibi sayısı (sessiz/solo kuralı)', () => {
  const s = read('src/mobile/shell-timeline.js');
  assert.match(s, /return \{ id: c\.id \|\| '', clips, enabled: c\.itemEnabled !== false, name: c\.name \|\| '', length, audioClips \};/);
  assert.match(s, /if \(!t\.mute && \(!solo \|\| t\.solo\)\) audioClips \+= t\.clips\.filter\(\(k\) => k && !k\.mute && k\.src\)\.length;/);
});

test('uygulama: sessiz iş dosya kopyalamaz; sayfa sessiz WAV üretir, videoya ses izi girmez', () => {
  const kt = read('android/app/src/main/java/com/cayadev/visualizer/export/ExportFlow.kt');
  assert.match(kt, /if \(args\.optString\("audioFrom"\) == "none" && args\.optString\("audioUri"\)\.isEmpty\(\)\) \{/);
  assert.match(kt, /put\("audioName", ""\)/);
  const host = read('src/mobile/android-host.js');
  assert.match(host, /const silent = !!\(j && j\.audioFrom === 'none' && !j\.audioUrl\);/);
  assert.match(host, /if \(silent\) ab = silentWav\(Number\(j\.durationSec\) \|\| 0\);/);
  // silentWav: geçerli RIFF/WAVE başlığı ve süre
  const src = host.slice(host.indexOf('const silentWav = (sec) => {'), host.indexOf('    /* ÜRÜN AKIŞI'));
  const silentWav = vm.runInNewContext(src + '; silentWav');
  const buf = silentWav(2.5);
  const v = new DataView(buf);
  const tag = (o) => String.fromCharCode(v.getUint8(o), v.getUint8(o + 1), v.getUint8(o + 2), v.getUint8(o + 3));
  assert.deepStrictEqual([tag(0), tag(8), tag(12), tag(36)], ['RIFF', 'WAVE', 'fmt ', 'data']);
  assert.strictEqual(v.getUint32(24, true), 8000);
  assert.strictEqual(v.getUint32(40, true) / 2 / 8000, 2.5);
  assert.strictEqual(buf.byteLength, 44 + 2.5 * 8000 * 2);
  assert.ok(new Uint8Array(buf, 44).every((b) => b === 0));
});
