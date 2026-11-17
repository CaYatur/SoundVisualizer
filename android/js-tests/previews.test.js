/*
 * SoundVisualizer — CaYaDev Ses Görselleştirici
 * Copyright (c) 2026 Çağan Turgut (CaYatur) — CaYaDev, https://cayadev.com
 * https://github.com/CaYatur/SoundVisualizer
 * SPDX-License-Identifier: MIT
 */
'use strict';
/* ŞABLON VE MİLKDROP ÖNİZLEMELERİ (android/tools/previews.js).

   Her şablonun ve yerleşik MilkDrop presetinin resmi depoda ve güncel olmalı: şablon ya da
   preset değişip resim yeniden üretilmezse Kitaplık eski görüntüyü gösterirdi.
   Çözüm: node android/tools/gen-previews.js */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..', '..');
const P = require('../tools/previews.js');

test('her şablonun ve yerleşik MilkDrop presetinin güncel önizlemesi var', () => {
  const stale = P.stale(root).map((w) => w.kind + ':' + w.id);
  assert.deepStrictEqual(stale, [], 'önizlemeler eski: node android/tools/gen-previews.js');
  const all = P.wanted(root);
  assert.ok(all.filter((w) => w.kind === 'tpl').length >= 80, 'şablonlar okunamadı');
  assert.ok(all.filter((w) => w.kind === 'md').length >= 60, 'MilkDrop presetleri okunamadı');
});

test('dizinde ve klasörde artık kayıt yok; resimler WebP ve 240x135', () => {
  const live = new Set(P.wanted(root).map((w) => w.kind + ':' + w.id));
  const idx = P.readIndex(root);
  for (const k of P.KINDS) {
    for (const id of Object.keys(idx[k] || {})) assert.ok(live.has(k + ':' + id), 'artık kayıt: ' + k + ':' + id);
    for (const f of fs.readdirSync(path.join(root, P.DIR, k))) {
      assert.ok(f.endsWith('.webp') && live.has(k + ':' + f.slice(0, -5)), 'artık dosya: ' + k + '/' + f);
      const b = fs.readFileSync(path.join(root, P.DIR, k, f));
      assert.strictEqual(b.toString('latin1', 0, 4) + b.toString('latin1', 8, 12), 'RIFFWEBP', f);
    }
  }
  assert.deepStrictEqual([P.RECIPE.thumbW, P.RECIPE.thumbH], [240, 135]);
});

test('önizlemeler APK\'ya giriyor, PC paketine girmiyor; Kitaplık onları kullanıyor', () => {
  const gradle = fs.readFileSync(path.join(root, 'android/app/build.gradle.kts'), 'utf8');
  assert.ok(gradle.includes('include("previews/**")'));
  const files = require(path.join(root, 'package.json')).build.files;
  assert.ok(!files.some((f) => /^android/.test(f)), 'PC paketine android/ girmemeli');
  const lib = fs.readFileSync(path.join(root, 'src/mobile/shell-library.js'), 'utf8');
  assert.ok(lib.includes("fetch('../../previews/index.json')"));
  assert.ok(lib.includes("previewSrc('tpl', t.id)") && lib.includes("presetArt('md', p)") && lib.includes("presetArt('sh', p)"));
});
