/*
 * SoundVisualizer — CaYaDev Ses Görselleştirici
 * Copyright (c) 2026 Çağan Turgut (CaYatur) — CaYaDev, https://cayadev.com
 * https://github.com/CaYatur/SoundVisualizer
 * SPDX-License-Identifier: MIT
 */
'use strict';
/* PRESETLER VE İÇE AKTARMA (PLAN 2.2).

   Masaüstünün GERÇEK yedek yazıcısıyla (src/main/full-backup.js writeBackup) bir
   .svbackup üretilir; telefondaki doğrulama masaüstündeki openBackup/inspect ile
   aynı sonucu vermeli. Preset puanının deseni Kotlin'de de yazılı
   (PresetRating.kt): masaüstündekiyle karşılaştırılıyor. */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const vm = require('node:vm');

const root = path.join(__dirname, '..', '..');
const read = (p) => fs.readFileSync(path.join(root, p), 'utf8');
const PS = require('../../src/mobile/profile-store.js');
const FB = require('../../src/main/full-backup.js');
const ZipReader = require('../../src/main/zip-reader.js');

test('preset puanı deseni masaüstündekiyle aynı (PresetRating.kt)', () => {
  const src = read('src/shared/milkdrop-cycle.js');
  const js = /const RATING_RE = \/(.+)\/([a-z]*);/.exec(src);
  const kt = /const val PATTERN = "((?:[^"\\]|\\.)*)"/.exec(read('android/app/src/main/java/com/cayadev/visualizer/store/PresetRating.kt'));
  assert.ok(js && kt);
  assert.strictEqual(JSON.parse('"' + kt[1] + '"'), js[1]);
  assert.deepStrictEqual(js[2].split('').sort(), ['i', 'm']);
  const ktFile = read('android/app/src/main/java/com/cayadev/visualizer/store/PresetRating.kt');
  assert.ok(/RegexOption\.MULTILINE/.test(ktFile) && /RegexOption\.IGNORE_CASE/.test(ktFile));
  assert.ok(/DEFAULT = 3\.0/.test(ktFile) && /const RATING_DEFAULT = 3;/.test(src));
});

test('içe aktarma öncesi kopyaların adları iki tarafta aynı', () => {
  assert.deepStrictEqual(PS.BEFORE_IMPORT, ['settings.before-import.json', 'scenes.before-import.json', 'library.before-import.json']);
  const kt = read('android/app/src/main/java/com/cayadev/visualizer/store/ProfileNames.kt');
  assert.ok(kt.includes('CONFIG_FILES.map { it.replace(".json", ".before-import.json") }'));
});

async function makeBackup(extra) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sv-fb-'));
  const tex = path.join(dir, 'noise.png');
  fs.writeFileSync(tex, Buffer.from([0x89, 0x50, 0x4e, 0x47]));
  const settings = Object.assign({
    docVersion: 4, ui: { theme: 'neon' },
    scenes: [{ id: 's1', name: 'Bir', data: {} }, { id: 's2', name: 'İki', data: {} }],
    userPresets: [{ id: 'c1' }],
  }, extra || {});
  const presets = [
    { id: 'ps_a', kind: 'milkdrop', name: 'A', source: '[preset00]\nfRating=4\n', updatedAt: 2 },
    { id: 'ps_b', kind: 'shader', name: 'B', code: 'void main(){}', updatedAt: 1 },
    { id: 'ps_builtin', builtin: true },
  ];
  const file = path.join(dir, 'test.svbackup');
  await FB.writeBackup(file, {
    appVersion: '4.0.0', platform: 'win32', settings,
    eachPreset: async (fn) => { for (const p of presets) await fn(p); },
    textures: [{ name: 'noise.png', file: tex }],
  });
  return { dir, file, settings };
}

function metaText(file) {
  const zr = ZipReader.open(file);
  try {
    const e = zr.entries.find((x) => x.name === 'backup.json');
    return zr.read(e, 1 << 30).toString('utf8');
  } finally { zr.close(); }
}

test('masaüstünün yazdığı yedek telefonda aynı kurallarla okunuyor', async () => {
  const b = await makeBackup();
  try {
    const r = PS.readBackup(metaText(b.file));
    assert.ok(!r.error, r.error);
    assert.deepStrictEqual(r.settings, b.settings);
    assert.deepStrictEqual(r.presetIds, ['ps_a', 'ps_b'], 'yerleşik preset yedekte yok');
    const desk = FB.inspect(b.file);
    for (const k of Object.keys(r.summary)) assert.deepStrictEqual(r.summary[k], desk[k], k);
    assert.strictEqual(r.summary.textures, 1);
  } finally { fs.rmSync(b.dir, { recursive: true, force: true }); }
});

test('yedek olmayan ya da daha yeni biçimli dosya reddediliyor (masaüstündeki hata kodları)', () => {
  assert.deepStrictEqual(PS.readBackup('{bozuk'), { error: 'NOT_BACKUP' });
  assert.deepStrictEqual(PS.readBackup(JSON.stringify({ type: 'x', format: 1, settings: {} })), { error: 'NOT_BACKUP' });
  assert.deepStrictEqual(PS.readBackup(JSON.stringify({ type: PS.BACKUP_TYPE, format: 2, settings: {} })), { error: 'FORMAT' });
  assert.deepStrictEqual(PS.readBackup(JSON.stringify({ type: PS.BACKUP_TYPE, format: 1, settings: [] })), { error: 'NOT_BACKUP' });
  assert.strictEqual(PS.BACKUP_TYPE, FB.TYPE);
  assert.strictEqual(PS.BACKUP_FORMAT, FB.FORMAT);
  // Yol taşıyan preset adları kimlik listesine girmez
  const r = PS.readBackup(JSON.stringify({ type: PS.BACKUP_TYPE, format: 1, settings: {}, presets: ['presets/ok.json', 'presets/../x.json', 'presets/a/b.json', 'presets/ok.json'] }));
  assert.deepStrictEqual(r.presetIds, ['ok']);
});

/* Sunucu, sahte uygulama kanalıyla: içe aktarma akışı. */
function host(disk, importReply) {
  const sent = [];
  const native = {
    postMessage(m) {
      const msg = JSON.parse(m);
      sent.push(msg);
      if (msg.t !== 'req') return;
      let v = null;
      const a = msg.a;
      if (msg.op === 'storeRead') { v = {}; for (const n of a.names) v[n] = disk.has(n) ? disk.get(n) : null; }
      else if (msg.op === 'storeWrite') { for (const [n, t] of Object.entries(a.files)) disk.set(n, t); v = {}; }
      else if (msg.op === 'storeCopy') { if (disk.has(a.from)) disk.set(a.to, disk.get(a.from)); else if (a.overwrite) disk.delete(a.to); v = {}; }
      else if (msg.op === 'importOpen' || msg.op === 'importPick') v = importReply;
      else if (msg.op === 'importCommit') v = { presets: a.ids.length, skipped: 0, gen: 2 };
      else if (msg.op === 'importDiscard') v = {};
      else if (msg.op === 'presetsList') v = [{ id: 'ps_a', kind: 'milkdrop', lazy: true, fRating: 4 }];
      Promise.resolve().then(() => native.onmessage({ data: JSON.stringify({ t: 'res', id: msg.id, ok: true, v }) }));
    },
  };
  const window = { __SV_ANDROID: { debug: true, page: 'test' }, SVNative: native, SVProfileStore: PS };
  const ctx = { window, console, performance: { now: () => 0 }, setTimeout, clearTimeout, setInterval: () => 0, Promise, JSON, Map, Object, Uint8Array, Array, Error, Date };
  vm.createContext(ctx);
  vm.runInContext(read('src/mobile/android-host.js'), ctx, { filename: 'android-host.js' });
  return { window, sent };
}

test('sunucu: tam yedek içe aktarılıyor; önceki hâl kenarda, presetler motora gidiyor', async () => {
  const b = await makeBackup();
  try {
    const old = { ui: { theme: 'cayadev' }, scenes: [{ id: 'eski' }] };
    const disk = new Map(Object.entries(PS.createSaver({ write: async () => {} }).serialize(old)));
    const h = host(disk, { kind: 'svbackup', meta: metaText(b.file), staged: ['ps_a', 'ps_b'], skipped: 0, later: { libs: 0, textures: 1, media: 0 } });
    let engine = null;
    let presets = null;
    h.window.api.onConfig((c) => { engine = c; });
    h.window.api.onPresets((l) => { presets = l; });
    const r = await h.window.SVAndroid.importProfile({ media: 'test.svbackup' });
    assert.strictEqual(r.kind, 'svbackup');
    assert.strictEqual(r.scenes, 2);
    assert.strictEqual(r.presets, 2);
    assert.deepStrictEqual(JSON.parse(JSON.stringify(r.later)), { libs: 0, textures: 1, media: 0 });
    assert.strictEqual(r.summary.appVersion, '4.0.0');
    // Önceki hâl kopyalandı, yeni ayar masaüstü düzeninde yazıldı
    assert.deepStrictEqual(JSON.parse(disk.get('scenes.before-import.json')), [{ id: 'eski' }]);
    assert.strictEqual(JSON.parse(disk.get('settings.before-import.json')).ui.theme, 'cayadev');
    assert.strictEqual(JSON.parse(disk.get('settings.json')).ui.theme, 'neon');
    assert.deepStrictEqual(JSON.parse(disk.get('scenes.json')).map((s) => s.id), ['s1', 's2']);
    assert.strictEqual(engine.ui.theme, 'neon');
    assert.strictEqual(presets.length, 1);
    const commit = h.sent.find((m) => m.op === 'importCommit');
    assert.deepStrictEqual(commit.a.ids, ['ps_a', 'ps_b']);
  } finally { fs.rmSync(b.dir, { recursive: true, force: true }); }
});

test('sunucu: yedek olmayan arşiv reddediliyor, geçici klasör siliniyor, ayara dokunulmuyor', async () => {
  const disk = new Map([['settings.json', JSON.stringify({ ui: { theme: 'cayadev' } })]]);
  const h = host(disk, { kind: 'svbackup', meta: JSON.stringify({ type: 'baska' }), staged: [], skipped: 0, later: {} });
  await assert.rejects(h.window.SVAndroid.importProfile({ media: 'x.zip' }), /NOT_BACKUP/);
  assert.ok(h.sent.some((m) => m.op === 'importDiscard'));
  assert.ok(!h.sent.some((m) => m.op === 'storeWrite' || m.op === 'storeCopy'));
  assert.strictEqual(JSON.parse(disk.get('settings.json')).ui.theme, 'cayadev');
});

test('sunucu: düz settings.json da içe aktarılıyor (BOM ve eski ses kaynağı dahil)', async () => {
  const disk = new Map();
  const h = host(disk, { kind: 'settings', settings: '﻿' + JSON.stringify({ ui: { theme: 'gece' }, audio: { source: 'mic' } }) });
  const r = await h.window.SVAndroid.importProfile({ media: 'settings.json' });
  assert.strictEqual(r.kind, 'settings');
  const onDisk = JSON.parse(disk.get('settings.json'));
  assert.strictEqual(onDisk.ui.theme, 'gece');
  assert.deepStrictEqual(onDisk.audio.sources, ['mic']);
  await assert.rejects(host(new Map(), { kind: 'settings', settings: '[1]' }).window.SVAndroid.importProfile({ media: 'a.json' }), /NOT_SETTINGS/);
});

test('sunucu: preset istekleri uygulamaya gidiyor (masaüstündeki yanıt biçimleri)', async () => {
  const h = host(new Map(), null);
  const list = await h.window.api.getPresets();
  assert.strictEqual(list[0].lazy, true);
  const reqs = () => h.sent.filter((m) => m.t === 'req').map((m) => m.op);
  assert.ok(reqs().includes('presetsList'));
});
