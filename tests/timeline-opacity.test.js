/*
 * SoundVisualizer — CaYaDev Ses Görselleştirici
 * Copyright (c) 2026 Çağan Turgut (CaYatur) — CaYaDev, https://cayadev.com
 * https://github.com/CaYatur/SoundVisualizer
 * SPDX-License-Identifier: MIT
 */
'use strict';
// Çizelge opaklığı (#957): parça/klip opaklığı, otomasyon hedefi, Tut eğrisi, giriş/çıkış solması
const test = require('node:test');
const assert = require('node:assert');
const TL = require('../src/shared/timeline.js');

function build(keys, clip) {
  return {
    tracks: [
      TL.makeTrack({ id: 'a', opacity: 0.5, clips: [Object.assign({ id: 'c', start: 0, dur: 10 }, clip || {})] }),
      TL.makeTrack({ kind: 'automation', target: 'tl.clip.c.opacity', keys: keys || [] }),
    ],
  };
}
const op = (tl, t) => TL.entryOpacity(tl, tl.tracks[0], tl.tracks[0].clips[0], t);

test('parça × klip opaklığı çarpılır', () => {
  const tl = build([], { opacity: 0.5 });
  assert.strictEqual(op(tl, 1), 0.25);
});
test('Tut eğrisi bir sonraki noktada anlık sıçrar, doğrusal rampa arada', () => {
  const tl = build([{ t: 0, v: 1, curve: 'hold' }, { t: 4, v: 0, curve: 'linear' }, { t: 6, v: 1 }]);
  assert.strictEqual(op(tl, 3.99), 0.5);
  assert.strictEqual(op(tl, 4), 0);
  assert.ok(Math.abs(op(tl, 5) - 0.25) < 1e-9);
});
test('giriş ve çıkış solması', () => {
  const tl = build([], { fadeIn: 2, fadeOut: 2 });
  assert.strictEqual(op(tl, 1), 0.25);
  assert.strictEqual(op(tl, 5), 0.5);
  assert.strictEqual(op(tl, 9), 0.25);
});
test('çizelge hedefleri yapılandırmaya yazılmaz; susturulmuş otomasyon okunmaz', () => {
  const tl = build([{ t: 0, v: 0 }]);
  assert.deepStrictEqual(TL.automationAt(tl, 1), {});
  assert.ok(TL.isTimelineTarget('tl.track.a.opacity'));
  tl.tracks[1].muted = true;
  assert.strictEqual(op(tl, 1), 0.5);
});

test('yinelenen klip kimlikleri yüklemede tekilleşir, yeni kimlik çakışmaz (#957)', () => {
  const tl = TL.makeTimeline({ tracks: [
    { id: 'trk_1', kind: 'clip', clips: [{ id: 'clip_7', type: 'scene', ref: 'a', start: 0, dur: 2 }] },
    { id: 'trk_2', kind: 'clip', clips: [{ id: 'clip_7', type: 'scene', ref: 'b', start: 1, dur: 2 }] },
  ] });
  const ids = tl.tracks.flatMap((t) => t.clips.map((c) => c.id));
  assert.strictEqual(new Set(ids).size, 2);
  assert.strictEqual(tl.tracks[0].clips[0].id, 'clip_7');
  assert.ok(!ids.includes(TL.makeClip({ type: 'scene', ref: 'c' }).id));
});
