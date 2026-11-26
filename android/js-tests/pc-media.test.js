/*
 * SoundVisualizer — CaYaDev Ses Görselleştirici
 * Copyright (c) 2026 Çağan Turgut (CaYatur) — CaYaDev, https://cayadev.com
 * https://github.com/CaYatur/SoundVisualizer
 * SPDX-License-Identifier: MIT
 */
'use strict';
/* PC ↔ TELEFON VİDEO (docs/PHONE-LINK.md "Videos"). Hedef PC'yken PC'nin video adresi telefonun
   motoruna kendi adresiyle gider; karşılığı yoksa indirilecekler listesine girer. Telefonda seçilen
   video önce PC'nin kitaplığına yollanır, katman PC'deki kimlikle yazılır. */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..', '..');
const read = (p) => fs.readFileSync(path.join(root, p), 'utf8').replace(/\r\n/g, '\n'); // Windows'ta satır sonu CRLF
const R = require('../../src/mobile/pc-remote.js');

const PC_FILE = 'sv-media://local/C%3A%5Cvids%5Cclip.mp4';
const PHONE = 'https://appassets.androidplatform.net/files/lib-media/pc-v1.mp4';
const cfg = () => ({
  layers: [
    { id: 'm1', kind: 'media', settings: { media: { source: 'file', file: PC_FILE, fileName: 'clip.mp4', libraryId: 'v1' } } },
    { id: 'm2', kind: 'media', settings: { media: { source: 'file', file: 'sv-media://local/D%3A%5Cother.webm', fileName: 'other.webm', libraryId: '' } } },
    { id: 'm3', kind: 'media', settings: { media: { source: 'webcam', file: '', deviceId: 'x' } } },
  ],
  timeline: { tracks: [{ clips: [{ type: 'video', ref: PC_FILE, libraryId: 'v1' }, { type: 'image', ref: 'sv-media://local/x.png' }] }] },
});

test('motorun kopyasında PC adresi telefonun adresine; kaynak ayar değişmez', () => {
  const c = cfg();
  const before = JSON.stringify(c);
  const out = R.localizeMedia(c, { byId: { v1: PHONE }, byRef: {} });
  assert.strictEqual(JSON.stringify(c), before, 'yerinde değiştirmez');
  assert.strictEqual(out.layers[0].settings.media.file, PHONE);
  assert.strictEqual(out.layers[0].settings.media.libraryId, 'v1');
  assert.strictEqual(out.timeline.tracks[0].clips[0].ref, PHONE);
  assert.strictEqual(out.timeline.tracks[0].clips[1].ref, 'sv-media://local/x.png', 'görsel klibe dokunulmaz');
  assert.strictEqual(out.layers[1], c.layers[1], 'karşılığı olmayan aynı nesne kalır');
  assert.strictEqual(out.layers[2], c.layers[2]);
});

test('kimliksiz başvuru adresiyle eşlenir; telefonun kendi adresi olduğu gibi', () => {
  const c = cfg();
  c.layers.push({ id: 'm4', kind: 'media', settings: { media: { source: 'file', file: PHONE, fileName: 'p.mp4' } } });
  const out = R.localizeMedia(c, { byId: {}, byRef: { 'sv-media://local/D%3A%5Cother.webm': 'https://appassets.androidplatform.net/files/link-cache/pc-ab.webm' } });
  assert.match(out.layers[1].settings.media.file, /link-cache/);
  assert.strictEqual(out.layers[3].settings.media.file, PHONE);
  assert.strictEqual(out.layers[0].settings.media.file, PC_FILE, 'karşılık yoksa PC adresi kalır');
});

test('eksik videolar: kimlikle ya da adresle, tekrarsız; telefon adresi ve kamera eksik sayılmaz', () => {
  const miss = R.missingMedia(cfg(), { byId: {}, byRef: {} });
  assert.deepStrictEqual(miss, [
    { id: 'v1', file: PC_FILE },
    { id: '', file: 'sv-media://local/D%3A%5Cother.webm' },
  ]);
  assert.deepStrictEqual(R.missingMedia(cfg(), { byId: { v1: PHONE }, byRef: { 'sv-media://local/D%3A%5Cother.webm': 'x' } }), []);
});

test('ev sahibi: motor kopyası ve yamalar telefon adresinden geçer, sahne listesi indirilmez', () => {
  const host = read('src/mobile/android-host.js');
  assert.match(host, /const engineOf = \(c\) => engineView\(pc\.on && PR\(\) \? localMedia\(PR\(\)\.engine\(c, config\)\) : c\);/);
  assert.doesNotMatch(host, /engineView\(PR\(\)\.enginePatch\(/, 'her yama pcEnginePatch ile');
  assert.match(host, /Object\.assign\(\{\}, pc\.cfg, \{ scenes: null \}\)/);
  assert.match(host, /request\('linkMediaFetch', \{ id: m\.id, file: m\.file \}\)/);
  assert.match(host, /sendVideo: \(file\) => sendVideo\(file\)/);
  assert.match(host, /onUploadDone\(v\);\s*\n\s*ev\.pcUpload\.emit\(v\);/);
});

test('katman: hedef PC\'yken video önce PC\'ye yollanır, kimlikle yazılır', () => {
  const s = read('src/mobile/shell-layers.js');
  const fn = s.slice(s.indexOf('function videoPicked'), s.indexOf('function mediaControls'));
  assert.match(fn, /A\(\)\.pc\.sendVideo\(f\)\.then\(\(id\) => \{\s*setMany\(\{ enabled: true, source: 'file', file: f\.url, fileName: f\.name \|\| '', libraryId: id \}\)/);
  assert.strictEqual((s.match(/filePick\('video', \(f\) => videoPicked\(f, setMany, ctx\)\)/g) || []).length, 2);
  assert.match(read('android/app/src/main/java/com/cayadev/visualizer/media/MediaPick.kt'), /\.put\("uri", uri\.toString\(\)\)/, 'gönderim içerik adresi ister');
});

test('uygulama: indirme yalnız kimlik ya da özetle adlandırılır, kitaplığa kimlikle girer', () => {
  const k = read('android/app/src/main/java/com/cayadev/visualizer/link/LinkDownload.kt');
  assert.match(k, /SAFE_ID = Regex\("\^\[A-Za-z0-9_-\]\{1,80\}\$"\)/);
  assert.match(k, /\(if \(id\.isNotEmpty\(\)\) "pc-\$id" else "pc-" \+ hash\(file\)\) \+ ext\(name\)/, 'ad PC\'den alınmaz');
  assert.match(k, /PcLink\.request\("media\.fetch"/);
  assert.match(k, /LibraryRestore\.upsertManifest\(dir/);
  assert.match(k, /File\(dir, "\$fname\.part"\)/, 'yarım dosya asıl adla görünmez');
  const req = read('android/app/src/main/java/com/cayadev/visualizer/AppRequests.kt');
  assert.match(req, /"linkMediaFetch" -> com\.cayadev\.visualizer\.link\.LinkDownload\.start\(app, args\.optString\("id"\), args\.optString\("file"\)\)/);
});
