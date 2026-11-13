/*
 * SoundVisualizer — CaYaDev Ses Görselleştirici
 * Copyright (c) 2026 Çağan Turgut (CaYatur) — CaYaDev, https://cayadev.com
 * https://github.com/CaYatur/SoundVisualizer
 * SPDX-License-Identifier: MIT
 */
'use strict';
/* T-bar %0'da bırakılınca çıkışlarda (pencere, yayın katmanı, Spout) sıradaki sahne bir kare
   tam görünüyordu; panel önizlemesinde görünmüyordu. Çıkış `cancel`'ı ve eski yapılandırmayı
   ayrı iletilerle alıyor; arada çizilen karede yığın eski sahnenin örneklerine dönmüş, çağıran
   ise hâlâ varış sahnesinin yapılandırmasını veriyordu. Kimliği iki sahnede aynı olan katmanlar
   (`_live`) varışın ayarlarıyla çiziliyordu. Yalıtılmış uygulamada screencast ile ölçüldü:
   önce bırakmadan +21 ve +39 ms'deki kareler varış sahnesiydi; sonra hiçbiri. */
global.window = global.window || {};
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
require('../src/shared/defaults.js');
const { LayerStack } = require('../src/visualizer/layers.js');

test('geri alınan geçişin yapılandırması yenisi gelene dek tutuluyor', () => {
  const s = new LayerStack(null);
  const old = { layers: [], layerStack: { enabled: true } };
  s.beginTransition(old, { duration: 1, type: 'crossfade' });
  s.trans.manual = true;
  s.cancelTransition();
  assert.strictEqual(s._heldCfg, old);
  s.setConfig(Object.assign(window.SV.defaultConfig(), { layers: [], layerStack: { enabled: true } }));
  assert.strictEqual(s._heldCfg, null, 'yeni yapılandırma tutmayı bırakıyor');
});

test('çizim tutulan yapılandırmayı kullanıyor', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'src', 'visualizer', 'layers.js'), 'utf8');
  const draw = src.slice(src.indexOf('    draw(audio, cfg, t, dt) {'));
  // İlk satır: çağıranın verdiği varış yapılandırması yerine geri alınan sahneninki
  assert.match(draw.split('\n')[1], /if \(this\._heldCfg\) cfg = this\._heldCfg;/);
  // Bitiş (çubuk sona varınca) tutmaz: o anda örnekler de yapılandırma da varışın
  const end = src.slice(src.indexOf('    endTransition() {'), src.indexOf('    /* T-BAR (#905).'));
  assert.ok(!/_heldCfg/.test(end));
});
