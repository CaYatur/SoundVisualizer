/*
 * SoundVisualizer — CaYaDev Ses Görselleştirici
 * Copyright (c) 2026 Çağan Turgut (CaYatur) — CaYaDev, https://cayadev.com
 * https://github.com/CaYatur/SoundVisualizer
 * SPDX-License-Identifier: MIT
 */
'use strict';
/* T-bar ve sahne geçişi: kullanıcı kaydında bulunan üç hata.
   1. Varış sahnesinin efekt zinciri (CRT, renk sapması) karışımın TAMAMINA uygulanıyordu:
      T-bar %0'dayken bile giden sahne büküklüyordu; geri alınca efekt bir karede kalkıyordu.
   2. Sahne küçük resmi geçişin ortasından çekiliyordu; T-bar geri alınınca bile geri alınan
      sahnenin resmi olarak eski sahnenin karesi kaydediliyor, Sıradaki monitörü onu gösteriyordu.
   3. Söz katmanı olmayan sahneye geçerken otomatik bulunan söz siliniyordu: giden sahne
      ekrandayken yazısı boşalıyor, geri dönünce bir an sonra geliyordu.
   Yalıtılmış uygulamada ölçüldü (CDP): tutulan T-bar'da önizlemenin zinciri bloom,crt,chroma idi
   ve giden sahneye de uygulanıyordu; geri alınan sahnenin resmi değişiyordu. */
global.window = global.window || {};
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const made = [];
class FakeFX {
  constructor() { this.chain = []; this.disposed = false; made.push(this); }
  setChain(list) { this.chain = list.map((f) => f.type); }
  hasWork() { return this.chain.length > 0; }
  dispose() { this.disposed = true; }
}
window.SVPostFX = { PostFX: FakeFX };
const { LayerStack } = require('../src/visualizer/layers.js');
const read = (f) => fs.readFileSync(path.join(__dirname, '..', 'src', f), 'utf8');

const FX = (type) => ({ type, enabled: true, params: {} });
function inTransition() {
  const s = new LayerStack(null);
  s.setPostFX([FX('vignette')]);
  const old = s.postfx;
  // Sıra uygulamadakiyle aynı: setConfig geçişi başlatıyor, ardından setPostFX varışın zinciri
  s.beginTransition({}, { duration: 1, type: 'crossfade' });
  s.setPostFX([FX('crt'), FX('chroma')]);
  return { s, old };
}

test('geçişte her sahne kendi efekt zincirini taşıyor', () => {
  const { s, old } = inTransition();
  assert.strictEqual(s.trans.stack.postfx, old, 'giden sahne eski örneği aldı');
  assert.deepStrictEqual(old.chain, ['vignette']);
  assert.notStrictEqual(s.postfx, old);
  assert.deepStrictEqual(s.postfx.chain, ['crt', 'chroma'], 'varış zinciri yalnız varış sahnesinde');
});

test('geri alınca giden sahnenin örneği geri geliyor, varışınki kapanıyor', () => {
  const { s, old } = inTransition();
  const incoming = s.postfx;
  s.cancelTransition();
  assert.strictEqual(s.postfx, old);
  assert.deepStrictEqual(s.postfx.chain, ['vignette']);
  assert.strictEqual(incoming.disposed, true);
  assert.strictEqual(old.disposed, false);
});

test('bitince giden sahnenin örneği kapanıyor', () => {
  const { s, old } = inTransition();
  const incoming = s.postfx;
  s.endTransition();
  assert.strictEqual(old.disposed, true);
  assert.strictEqual(s.postfx, incoming);
  assert.strictEqual(incoming.disposed, false);
});

test('anlık efekt geçiş sürerken iki sahneye de gidiyor', () => {
  const { s } = inTransition();
  s.setMomentary([FX('glitch')]);
  assert.deepStrictEqual(s.trans.stack.postfx.chain, ['vignette', 'glitch']);
  assert.deepStrictEqual(s.postfx.chain, ['crt', 'chroma', 'glitch']);
});

test('çizimde efekt karışımdan önce, sahne başına', () => {
  const src = read('visualizer/layers.js');
  const draw = src.slice(src.indexOf('    draw(audio, cfg, t, dt) {'), src.indexOf('    /* Maskeyi katmanın kendi tuvaline uygular.'));
  assert.match(draw, /outFx\.render\(this\.transOut, audio, t, dt, seeThrough\(tr\.cfg\)\)/);
  assert.match(draw, /this\.postfx\.render\(this\.compCanvas, audio, t, dt, seeThrough\(cfg\)\)/);
  assert.match(draw, /this\.compositor\.compose\(this\.transCtx, outSrc, inSrc,/);
  // Karışımın üstüne ikinci kez efekt yok: geçiş dalı karışımı doğrudan yüzeye veriyor
  assert.match(draw, /this\._setSurface\(this\.transSurface\);\s*return;/);
  assert.ok(!/render\(this\.transSurface/.test(draw));
});

test('küçük resim yalnız sahne etkinken ve geçiş bitince', () => {
  const admin = read('admin/admin.js');
  const fn = admin.slice(admin.indexOf('function grabSceneThumb(id, tries)'), admin.indexOf('function sceneThumbShot(id)'));
  assert.match(fn, /if \(activeSceneId !== id\) return;/);
  assert.match(fn, /if \(st && st\.trans\) \{/);
  // Kare çekilirken de hâlâ aynı sahne
  assert.ok(fn.split('if (activeSceneId !== id) return;').length - 1 >= 2);
});

test('söz katmanı olmayan sahne otomatik sözü silmiyor; arama kapanınca siliniyor', () => {
  const main = read('main/main.js');
  const code = main.slice(main.indexOf("let lyricsLookupCfgSig = '';"), main.indexOf('function publishLyricsLib()'));
  const ctx = {
    currentConfig: null, lyricsAutoItem: null, lyricsAutoSig: 'x', published: 0, looked: 0,
    follows: true,
    configFollowsLyrics() { return ctx.follows; },
    publishLyricsLib() { ctx.published++; },
    shownNowPlaying() { return { title: 'Parça', artist: 'Sanatçı' }; },
    lookupLiveLyrics() { ctx.looked++; },
  };
  // eslint-disable-next-line no-new-func
  const sync = new Function('ctx', 'with (ctx) {' + code + '; return syncLyricsLookup; }')(ctx);
  ctx.currentConfig = { lyricsLookup: { enabled: true } };
  sync();
  assert.strictEqual(ctx.looked, 1, 'sözü izleyen sahnede aranıyor');
  ctx.lyricsAutoItem = { text: '[00:01.00] satır' };
  // Söz katmanı olmayan sahne (T-bar'ın tuttuğu varış sahnesi)
  ctx.follows = false;
  ctx.currentConfig = { lyricsLookup: { enabled: true } };
  sync();
  assert.ok(ctx.lyricsAutoItem, 'bulunan söz kalıyor');
  assert.strictEqual(ctx.published, 0, 'ekranlara boş kitaplık gitmiyor');
  assert.strictEqual(ctx.looked, 1, 'o sahnede arama yok');
  // Geri dönünce: aynı parça için yeniden aranmaz (lookupLiveLyrics içi), çağrı ucuz
  ctx.follows = true;
  sync();
  assert.strictEqual(ctx.looked, 2);
  // Arama kapatılınca söz kalkıyor
  ctx.currentConfig = { lyricsLookup: { enabled: false } };
  sync();
  assert.strictEqual(ctx.lyricsAutoItem, null);
  assert.strictEqual(ctx.published, 1);
});
