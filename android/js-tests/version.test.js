/*
 * SoundVisualizer — CaYaDev Ses Görselleştirici
 * Copyright (c) 2026 Çağan Turgut (CaYatur) — CaYaDev, https://cayadev.com
 * https://github.com/CaYatur/SoundVisualizer
 * SPDX-License-Identifier: MIT
 */
'use strict';
/* ANDROID SÜRÜMÜ (PLAN K9/D9, §2.6, R11): kendi çizgisi, etiketi android-v<sürüm>;
   masaüstünün yayın betiği Android etiketini kabul etmez, "Latest" masaüstünde kalır. */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const root = path.join(__dirname, '..', '..');
const R = require('../tools/release-apk.js');

test('sürüm tek yerden: version.properties, gradle versionCode ondan', () => {
  const v = R.appVersion(root);
  assert.match(v, /^\d+\.\d+\.\d+$/);
  const gradle = fs.readFileSync(path.join(root, 'android/app/build.gradle.kts'), 'utf8');
  assert.ok(gradle.includes('versionCode = appVersionCode') && gradle.includes('versionName = appVersion'));
  assert.ok(/a \* 10000 \+ b \* 100 \+ c/.test(gradle));
  assert.ok(gradle.includes('versionNameSuffix = "-dev"'));
});

test('etiket android-v<sürüm> olmalı ve sürümle aynı', () => {
  assert.strictEqual(R.checkTag('android-v1.2.3', '1.2.3').ok, true);
  assert.strictEqual(R.checkTag('v1.2.3', '1.2.3').ok, false);
  assert.strictEqual(R.checkTag('android-v1.2.4', '1.2.3').ok, false);
  assert.strictEqual(R.checkTag('android-v1.2', '1.2').ok, false);
});

test('masaüstünün yayın betiği Android etiketini reddeder (masaüstü dosyaları oraya gitmez)', () => {
  const r = spawnSync(process.execPath, [path.join(root, 'scripts/release-assets.js'), 'android-v1.0.0', '--check'], { encoding: 'utf8' });
  assert.strictEqual(r.status, 2);
  assert.match(r.stderr, /android\/tools\/release-apk\.js/);
});

test('APK betiği Latest\'i masaüstünde bırakır, Release açmaz', () => {
  const src = fs.readFileSync(path.join(root, 'android/tools/release-apk.js'), 'utf8');
  assert.ok(src.includes("'--latest=false'"));
  assert.ok(!/release', 'create'/.test(src), 'Release açmak ayrı onay');
  assert.ok(src.includes('CN=Android Debug'), 'geliştirme imzalı APK yayımlanmaz');
});
