'use strict';
/* MCP zaman çizelgesi araçları: tam okuma (kırpılmadan, "at" anı), parça / klip /
   anahtar / işaret / seçenek / banka düzenleme. Düzenleme `timeline` grubunda
   (sv_patch_config'in timeline.* yoluyla aynı izin: Tam kip). */
const test = require('node:test');
const assert = require('node:assert');
const mcp = require('../src/shared/mcp');

function cfgOf(mode) {
  return {
    mcp: { enabled: true, mode: mode || 'full' },
    scenes: [{ id: 's1', name: 'One', data: {} }, { id: 's2', name: 'Two', data: {} }],
    visualizer: { sensitivity: 1 },
    timeline: {
      id: 'tl1', name: 'A', itemEnabled: true, bank: [], enabled: true, useTimeline: false,
      tempo: [{ t: 0, bpm: 120, beatsPerBar: 4 }],
      tracks: [{ id: 'trk_1', name: 'Scenes', kind: 'clip', clips: [{ id: 'clip_1', type: 'scene', ref: 's1', start: 0, dur: 8 }] }],
      markers: [], loop: { enabled: false, start: 0, end: 0 }, snap: 'bar', fps: 60,
    },
  };
}
function ctx(cfg) {
  return {
    locale: () => 'en',
    getConfig: () => cfg,
    setConfig: (next) => { Object.keys(cfg).forEach((k) => { delete cfg[k]; }); Object.assign(cfg, next); },
    timeline: () => ({ ok: true }),
  };
}
const call = (cfg, name, args) => Promise.resolve(mcp.callTool(name, args || {}, ctx(cfg)));

test('yeni araçlar listede, açıklamaları iki dilde ve şemalı', () => {
  const names = mcp.tools().map((t) => t.name);
  for (const n of ['sv_timeline_inspect', 'sv_timeline_edit_track', 'sv_timeline_edit_clip', 'sv_timeline_set_keys', 'sv_timeline_edit_marker', 'sv_timeline_set_options', 'sv_timeline_bank']) {
    assert.ok(names.includes(n), n);
    const t = mcp.tools().find((x) => x.name === n);
    assert.ok(t.inputSchema && t.inputSchema.properties && Object.keys(t.inputSchema.properties).length, n + ' şeması');
  }
});

test('izin: inspect Okuma kipinde, düzenleme yalnız Tam kipte', async () => {
  const cfg = cfgOf('read');
  const r = await call(cfg, 'sv_timeline_inspect');
  assert.strictEqual(r.ok, true);
  for (const mode of ['read', 'apply', 'write']) {
    const c = cfgOf(mode);
    const w = await call(c, 'sv_timeline_edit_marker', { action: 'add', t: 1 });
    assert.strictEqual(w.ok, false, mode + ' kipinde düzenleme kapalı');
    assert.strictEqual(c.timeline.markers.length, 0);
  }
  const ok = await call(cfgOf('full'), 'sv_timeline_edit_marker', { action: 'add', t: 1 });
  assert.strictEqual(ok.ok, true, JSON.stringify(ok));
});

test('inspect: 40 öğe sınırı yok, at anında çalan klip ve otomasyon', async () => {
  const cfg = cfgOf();
  cfg.timeline.tracks[0].clips = Array.from({ length: 60 }, (_, i) => ({ id: 'clip_' + (i + 1), type: 'scene', ref: 's1', start: i * 2, dur: 2 }));
  cfg.timeline.tracks.push({ id: 'trk_2', kind: 'automation', target: 'visualizer.sensitivity', min: 0, max: 2, keys: [{ t: 0, v: 0 }, { t: 10, v: 1 }] });
  const r = await call(cfg, 'sv_timeline_inspect', { at: 5 });
  assert.strictEqual(r.tracks[0].clips.length, 60);
  assert.strictEqual(r.at.clips[0].clip.id, 'clip_3');
  assert.ok(Math.abs(r.at.automation['visualizer.sensitivity'] - 1) < 1e-6);
  assert.strictEqual(r.bank.length, 1);
  assert.strictEqual(r.bank[0].active, true);
});

test('parça: ekle, güncelle, taşı, kilit, kaldır', async () => {
  const cfg = cfgOf();
  const a = await call(cfg, 'sv_timeline_edit_track', { action: 'add', name: 'FX' });
  assert.strictEqual(a.ok, true, JSON.stringify(a));
  assert.notStrictEqual(a.trackId, 'trk_1', 'kimlik çakışmadı');
  const auto = await call(cfg, 'sv_timeline_edit_track', { action: 'add', kind: 'automation', target: 'visualizer.sensitivity', min: 0, max: 3 });
  assert.strictEqual(auto.ok, true, JSON.stringify(auto));
  const badTarget = await call(cfg, 'sv_timeline_edit_track', { action: 'add', kind: 'automation', target: 'mcp.mode' });
  assert.strictEqual(badTarget.ok, false);
  const notNum = await call(cfg, 'sv_timeline_edit_track', { action: 'add', kind: 'automation', target: 'scenes' });
  assert.strictEqual(notNum.ok, false);
  const mv = await call(cfg, 'sv_timeline_edit_track', { action: 'move', trackId: a.trackId, index: 0 });
  assert.strictEqual(mv.ok, true);
  assert.strictEqual(cfg.timeline.tracks[0].id, a.trackId);
  await call(cfg, 'sv_timeline_edit_track', { action: 'update', trackId: a.trackId, locked: true });
  const blocked = await call(cfg, 'sv_timeline_edit_track', { action: 'update', trackId: a.trackId, name: 'X' });
  assert.match(blocked.error, /locked/);
  const rm = await call(cfg, 'sv_timeline_edit_track', { action: 'remove', trackId: a.trackId });
  assert.strictEqual(rm.ok, false, 'kilitli parça silinmez');
  const unlock = await call(cfg, 'sv_timeline_edit_track', { action: 'update', trackId: a.trackId, locked: false });
  assert.strictEqual(unlock.ok, true, 'kilit açılabilir');
  assert.strictEqual((await call(cfg, 'sv_timeline_edit_track', { action: 'remove', trackId: a.trackId })).ok, true);
});

test('klip: ekle, güncelle, böl, kaldır; sahne kaynağı ve tür denetimi', async () => {
  const cfg = cfgOf();
  const add = await call(cfg, 'sv_timeline_edit_clip', { action: 'add', trackId: 'trk_1', type: 'scene', ref: 's2', start: 8, dur: 4 });
  assert.strictEqual(add.ok, true, JSON.stringify(add));
  assert.notStrictEqual(add.clipId, 'clip_1');
  assert.match((await call(cfg, 'sv_timeline_edit_clip', { action: 'add', trackId: 'trk_1', type: 'scene', ref: 'nope' })).error, /Scene "nope" not found/);
  assert.match((await call(cfg, 'sv_timeline_edit_clip', { action: 'add', trackId: 'trk_1', type: 'bogus' })).error, /type must be one of/);
  const up = await call(cfg, 'sv_timeline_edit_clip', { action: 'update', trackId: 'trk_1', clipId: 'clip_1', dur: 6, fadeIn: 1 });
  assert.strictEqual(up.clip.dur, 6);
  assert.strictEqual(up.clip.ref, 's1', 'verilmeyen alan korunur');
  const sp = await call(cfg, 'sv_timeline_edit_clip', { action: 'split', trackId: 'trk_1', clipId: 'clip_1', at: 2 });
  assert.strictEqual(sp.ok, true, JSON.stringify(sp));
  assert.strictEqual(sp.left.dur, 2);
  assert.strictEqual(sp.right.start, 2);
  assert.strictEqual(sp.right.dur, 4);
  assert.strictEqual((await call(cfg, 'sv_timeline_edit_clip', { action: 'split', trackId: 'trk_1', clipId: 'clip_1', at: 50 })).ok, false);
  const clips = cfg.timeline.tracks[0].clips.map((c) => c.start);
  assert.deepStrictEqual(clips, clips.slice().sort((a, b) => a - b), 'sıralı');
  assert.strictEqual((await call(cfg, 'sv_timeline_edit_clip', { action: 'remove', trackId: 'trk_1', clipId: add.clipId })).ok, true);
  assert.match((await call(cfg, 'sv_timeline_edit_clip', { action: 'remove', trackId: 'trk_1', clipId: add.clipId })).error, /not found/);
});

test('anahtarlar yalnız otomasyon parçasına; işaret ekle/taşı/sil', async () => {
  const cfg = cfgOf();
  const auto = await call(cfg, 'sv_timeline_edit_track', { action: 'add', kind: 'automation', target: 'visualizer.sensitivity' });
  const k = await call(cfg, 'sv_timeline_set_keys', { trackId: auto.trackId, keys: [{ t: 4, v: 2 }, { t: 0, v: 0.5 }] });
  assert.strictEqual(k.ok, true, JSON.stringify(k));
  const keys = cfg.timeline.tracks.find((t) => t.id === auto.trackId).keys;
  assert.deepStrictEqual(keys.map((x) => [x.t, x.v]), [[0, 0.5], [4, 1]], 'sıralı ve 0..1');
  assert.match((await call(cfg, 'sv_timeline_set_keys', { trackId: 'trk_1', keys: [] })).error, /clip track/);
  assert.strictEqual((await call(cfg, 'sv_timeline_set_keys', { trackId: auto.trackId, keys: [{ t: -1, v: 0 }] })).ok, false);
  const m = await call(cfg, 'sv_timeline_edit_marker', { action: 'add', t: 12, name: 'Drop' });
  await call(cfg, 'sv_timeline_edit_marker', { action: 'add', t: 4, name: 'Intro' });
  assert.deepStrictEqual(cfg.timeline.markers.map((x) => x.name), ['Intro', 'Drop']);
  await call(cfg, 'sv_timeline_edit_marker', { action: 'update', markerId: m.markerId, t: 1 });
  assert.deepStrictEqual(cfg.timeline.markers.map((x) => x.name), ['Drop', 'Intro']);
  assert.strictEqual((await call(cfg, 'sv_timeline_edit_marker', { action: 'remove', markerId: m.markerId })).ok, true);
});

test('seçenekler: tempo, döngü, yakalama, Timeline kullan; geçersiz değer reddedilir', async () => {
  const cfg = cfgOf();
  const r = await call(cfg, 'sv_timeline_set_options', { bpm: 128, beatsPerBar: 3, loop: { enabled: true, start: 4, end: 12 }, snap: 'beat', useTimeline: true });
  assert.strictEqual(r.ok, true, JSON.stringify(r));
  assert.strictEqual(cfg.timeline.tempo[0].bpm, 128);
  assert.strictEqual(cfg.timeline.tempo[0].beatsPerBar, 3);
  assert.deepStrictEqual(cfg.timeline.loop, { enabled: true, start: 4, end: 12 });
  assert.strictEqual(cfg.timeline.useTimeline, true);
  assert.strictEqual((await call(cfg, 'sv_timeline_set_options', { snap: 'weird' })).ok, false);
  assert.strictEqual((await call(cfg, 'sv_timeline_set_options', { loop: { enabled: true, start: 5, end: 2 } })).ok, false);
  assert.strictEqual((await call(cfg, 'sv_timeline_set_options', {})).ok, false);
});

test('banka: ekle, geç, yeniden adlandır, kapat, taşı, kaldır', async () => {
  const cfg = cfgOf();
  const add = await call(cfg, 'sv_timeline_bank', { action: 'add', name: 'Encore' });
  assert.strictEqual(add.ok, true, JSON.stringify(add));
  assert.strictEqual(add.bank.length, 2);
  const newId = add.active;
  assert.notStrictEqual(newId, 'tl1');
  assert.strictEqual(cfg.timeline.tracks.length, 0, 'yeni çizelge boş');
  const back = await call(cfg, 'sv_timeline_bank', { action: 'switch', id: 'tl1' });
  assert.strictEqual(back.active, 'tl1');
  assert.strictEqual(cfg.timeline.tracks[0].clips[0].id, 'clip_1', 'eski çizelge geri geldi');
  await call(cfg, 'sv_timeline_bank', { action: 'rename', id: newId, name: 'Bis' });
  await call(cfg, 'sv_timeline_bank', { action: 'disable', id: newId });
  const r = await call(cfg, 'sv_timeline_inspect');
  const other = r.bank.find((b) => b.id === newId);
  assert.strictEqual(other.name, 'Bis');
  assert.strictEqual(other.enabled, false);
  await call(cfg, 'sv_timeline_bank', { action: 'move', id: newId, index: 0 });
  assert.strictEqual(cfg.timeline.order[0], newId);
  assert.match((await call(cfg, 'sv_timeline_bank', { action: 'switch', id: 'zzz' })).error, /not found/);
  assert.strictEqual((await call(cfg, 'sv_timeline_bank', { action: 'remove', id: newId })).bank.length, 1);
});
