/*
 * SoundVisualizer — CaYaDev Ses Görselleştirici
 * Copyright (c) 2026 Çağan Turgut (CaYatur) — CaYaDev, https://cayadev.com
 * https://github.com/CaYatur/SoundVisualizer
 * SPDX-License-Identifier: MIT
 */
'use strict';
/* TELEFON YEDEĞİ YOKLAMASI: node android/tools/probe-backup.js
   Yedek emülatörde yazılır, masaüstünün gerçek modülüyle (src/main/full-backup.js) açılır;
   telefonda seçerek geri yükleme ve sistemin kaydetme ekranı da denenir. */
const fs = require('fs'), path = require('path'), cp = require('child_process');
const root = path.join(__dirname, '..', '..');
const work = fs.mkdtempSync(path.join(require('node:os').tmpdir(), 'sv-backup-'));
const D = require('./lib/device.js');
const FB = require('../../src/main/full-backup.js');
let bad = 0;
const check = (n, ok, d) => { if (!ok) bad++; console.log((ok ? 'OK   ' : 'FAIL ') + n + (d !== undefined ? '  ' + JSON.stringify(d).slice(0, 300) : '')); };
const PKG = D.PKG;
const asApp = (cmd) => D.adb(['shell', 'run-as ' + PKG + ' sh -c "' + cmd + '"']);
const pull = (rel, dest) => fs.writeFileSync(dest, cp.execFileSync(D.adbPath(), ['exec-out', 'run-as', PKG, 'cat', rel], { maxBuffer: 1 << 29 }));
function pushApp(rel, buf) {
  const tmp = path.join(work, 'up.bin'); fs.writeFileSync(tmp, buf);
  D.adb(['push', tmp, '/data/local/tmp/sv-up.bin']);
  D.adb(['shell', 'chmod 644 /data/local/tmp/sv-up.bin']);
  asApp('mkdir -p $(dirname ' + rel + ') && cp /data/local/tmp/sv-up.bin ' + rel);
}
(async () => {
  // Telefonda veri: preset, logo, doku, kitaplık videosu
  pushApp('files/profile/presets/p_e2e.json', Buffer.from(JSON.stringify({ id: 'p_e2e', kind: 'milkdrop', name: 'E2E', source: 'fRating=3', updatedAt: 1 })));
  const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64');
  pushApp('files/logo-library/logo-e2e.png', png);
  pushApp('files/logo-library/manifest.json', Buffer.from(JSON.stringify({ items: [{ id: 'lg_e2e', name: 'Logo', file: 'logo-e2e.png', kind: 'image', mime: 'image/png', size: png.length }] })));
  pushApp('files/textures/duman.png', png);
  pushApp('files/media/lib-media/klip-e2e.mp4', Buffer.alloc(4096, 7));
  pushApp('files/media/lib-media/manifest.json', Buffer.from(JSON.stringify({ items: [{ id: 'vd_e2e', name: 'Klip', file: 'klip-e2e.mp4', size: 4096 }] })));
  pushApp('files/media/restored/0-disari.mp4', Buffer.alloc(2048, 3));
  const pid = await D.launch();
  const page = await D.connect(pid);
  const ev = (js) => page.evaluate(js);
  for (let i = 0; i < 80 && !(await ev('!!(window.SVShell && window.SVShell.state().ready)')); i++) await D.sleep(200);
  await D.sleep(800);
  await ev(`window.SVAndroid.lyrics.add({ name: 'e2e', title: 'E2E', artist: 'Yedek', text: '[00:01.00]Satir' }).catch(() => 0)`);
  const ORIGIN = 'https://appassets.androidplatform.net';
  await ev(`(async () => {
    const c = window.SVAndroid.config.get();
    const L = (c.layers || []).filter((l) => l.id !== 'vd_a' && l.id !== 'vd_b').concat([
      { id: 'vd_a', kind: 'media', type: 'media', enabled: false, opacity: 1, blend: 'normal', settings: { media: { enabled: true, source: 'file', file: '${ORIGIN}/files/lib-media/klip-e2e.mp4' } } },
      { id: 'vd_b', kind: 'media', type: 'media', enabled: false, opacity: 1, blend: 'normal', settings: { media: { enabled: true, source: 'file', file: '${ORIGIN}/files/restored/0-disari.mp4' } } }]);
    window.SVAndroid.config.patch({ layers: L, scenes: [{ id: 'sc_e1', name: 'Bir', data: {} }, { id: 'sc_e2', name: 'Iki', data: {} }], userPresets: [{ id: 'up_e', name: 'Renk', colors: ['#112233'] }],
      timeline: { id: 'tl_e', name: 'Cizelge', tempo: [{ t: 0, bpm: 120, beatsPerBar: 4 }], tracks: [], markers: [], enabled: true }, ui: Object.assign({}, c.ui, { theme: 'neon' }) });
    localStorage.setItem('sv-export', '{"orient":"portrait","v":2}');
    await window.SVAndroid.config.flush(); return 1; })()`);
  const plan = await ev('window.SVAndroid.backup.plan()');
  check('plan bölümleri sayar', plan.presets.count >= 1 && plan.logos.count === 1 && plan.lyrics.count >= 1 && plan.videos.count === 2 && plan.textures.count >= 1, plan);

  // ---- Tam yedek ----
  const ALL = ['settings', 'scenes', 'colors', 'timeline', 'presets', 'logos', 'lyrics', 'videos', 'textures'];
  const r = await ev(`window.SVAndroid.backup.exportTo(${JSON.stringify(ALL)}, { debugMedia: 'e2e-full.svbackup' })`);
  check('tam yedek yazıldı', r.presets >= 1 && r.videos === 2 && r.logos === 1, r);
  const full = path.join(work, 'e2e-full.svbackup');
  pull('files/media/e2e-full.svbackup', full);
  const sum = FB.inspect(full);
  check('masaüstü arşivi tanıyor', sum.platform === 'android' && sum.scenes === 2 && sum.presets >= 1 && sum.logos === 1 && sum.videos === 2 && sum.textures >= 1 && sum.lyrics >= 1, sum);
  const dst = path.join(work, 'pc'); fs.rmSync(dst, { recursive: true, force: true }); fs.mkdirSync(dst, { recursive: true });
  const saved = [];
  const res = await FB.restore(full, {
    savePresets: async (l) => { saved.push(...l); return l; },
    libraries: { logos: { dir: path.join(dst, 'logos') }, media: { dir: path.join(dst, 'media') }, lyrics: { dir: path.join(dst, 'lyrics') } },
    textureDir: path.join(dst, 'tex'), restoredMediaDir: path.join(dst, 'restored'), caseInsensitive: true, exists: (p) => fs.existsSync(p),
  });
  check('masaüstü geri yüklüyor', res.counts.skipped === 0 && res.counts.presets >= 1 && res.counts.logos === 1 && res.counts.videos === 2 && res.counts.textures >= 1, res.counts);
  check('dosyalar bozulmadan açılıyor', fs.readFileSync(path.join(dst, 'logos', 'logo-e2e.png')).equals(png) && fs.statSync(path.join(dst, 'media', 'klip-e2e.mp4')).size === 4096);
  const vids = res.settings.layers.filter((l) => /^vd_/.test(l.id)).map((l) => l.settings.media.file);
  check('sahne videoları bilgisayardaki yola eşleniyor', vids.length === 2 && vids.every((v) => !v.startsWith('https://')), vids);

  // ---- Parça yedek ----
  const p = await ev(`window.SVAndroid.backup.exportTo(['colors', 'lyrics'], { debugMedia: 'e2e-part.svbackup' })`);
  const part = path.join(work, 'e2e-part.svbackup');
  pull('files/media/e2e-part.svbackup', part);
  const s2 = FB.inspect(part);
  check('parça yedekte yalnız seçilenler', s2.colorPresets === 1 && s2.lyrics >= 1 && s2.scenes === 0 && s2.presets === 0 && s2.logos === 0 && s2.videos === 0, s2);

  // ---- Telefonda seçerek geri yükleme ----
  await ev(`(async () => { const c = window.SVAndroid.config.get(); window.SVAndroid.config.patch({ scenes: [{ id: 'sc_yerel', name: 'Yerel', data: {} }], userPresets: [], ui: Object.assign({}, c.ui, { theme: 'light' }) }); localStorage.setItem('sv-export', '{}'); await window.SVAndroid.config.flush(); return 1; })()`);
  const info = await ev(`window.SVAndroid.backup.open({ media: 'e2e-full.svbackup' })`);
  check('yedekteki bölümler listeleniyor', ALL.every((k) => info.available[k]), info.available);
  await ev(`window.SVAndroid.backup.apply(['colors'])`);
  await D.sleep(500);
  let st = await ev(`(() => { const c = window.SVAndroid.config.get(); return { scenes: c.scenes.map((s) => s.id), colors: (c.userPresets || []).map((x) => x.id), theme: c.ui.theme, ex: localStorage.getItem('sv-export') }; })()`);
  check('yalnız seçilen bölüm değişti', st.colors[0] === 'up_e' && st.scenes[0] === 'sc_yerel' && st.theme === 'light' && st.ex === '{}', st);
  await ev(`window.SVAndroid.backup.open({ media: 'e2e-full.svbackup' }).then(() => window.SVAndroid.backup.apply(['scenes', 'settings']))`);
  await D.sleep(700);
  st = await ev(`(() => { const c = window.SVAndroid.config.get(); return { scenes: c.scenes.map((s) => s.id), theme: c.ui.theme, ex: localStorage.getItem('sv-export') }; })()`);
  check('sahneler, ayarlar ve yerel tercihler geri geldi', st.scenes.length === 2 && st.scenes[0] === 'sc_e1' && st.theme === 'neon' && /portrait/.test(st.ex), st);
  await ev(`window.SVAndroid.backup.open({ media: 'e2e-part.svbackup' })`).then((i) => check('parça yedekte yalnız içindekiler sunuluyor', Object.keys(i.available).sort().join() === 'colors,lyrics', i.available));
  await ev('window.SVAndroid.backup.discard()');

  // ---- Arayüz: gerçek kaydetme ekranı ----
  await ev(`(() => { const c = window.SVAndroid.config.get(); window.SVAndroid.config.patch({ ui: Object.assign({}, c.ui, { theme: 'system' }), layers: c.layers.filter((l) => !/^vd_/.test(l.id)) }); window.SVShell.open('settings'); return 1; })()`);
  await D.sleep(900);
  await ev(`[...document.querySelectorAll('#sv-shell .nav-row')].find((b) => /Yedek Al|Create Backup/.test(b.textContent)).click(); 1`);
  await D.sleep(1800);
  fs.writeFileSync(path.join(work, 'backup-page.png'), cp.execFileSync(D.adbPath(), ['exec-out', 'screencap', '-p'], { maxBuffer: 1 << 27 }));
  const rows = await ev(`[...document.querySelectorAll('#sv-shell .sheet-body .toggle')].map((t) => [t.dataset.section, t.getAttribute('aria-checked')])`);
  check('dokuz bölüm, videolar kapalı', rows.length === 9 && rows.find((x) => x[0] === 'videos')[1] === 'false', rows);
  await ev(`document.querySelector('#sv-shell .sheet-body .toggle[data-section="presets"]').click(); document.querySelector('#sv-shell .sheet-foot .btn').click(); 1`);
  await D.sleep(3500);
  const dump = () => { D.adb(['shell', 'uiautomator', 'dump', '/sdcard/ui.xml']); return D.adb(['shell', 'cat', '/sdcard/ui.xml']); };
  let xml = dump();
  const m = /text="(SAVE|Save|KAYDET|Kaydet)"[^>]*bounds="\[(\d+),(\d+)\]\[(\d+),(\d+)\]"/.exec(xml);
  check('sistemin kaydetme ekranı açıldı', !!m && /soundvisualizer-telefon-yedek-/.test(xml));
  if (m) D.adb(['shell', 'input', 'tap', String((+m[2] + +m[4]) >> 1), String((+m[3] + +m[5]) >> 1)]);
  await D.sleep(4000);
  xml = dump();
  const re = /text="(REPLACE|Replace|OK|DEĞİŞTİR)"[^>]*bounds="\[(\d+),(\d+)\]\[(\d+),(\d+)\]"/.exec(xml);
  if (re) { D.adb(['shell', 'input', 'tap', String((+re[2] + +re[4]) >> 1), String((+re[3] + +re[5]) >> 1)]); await D.sleep(3000); }
  await D.sleep(4000);
  const note = await ev(`(document.querySelector('#sv-shell .sheet-body .banner.ok') || {}).textContent || ''`);
  check('kaydedildi bildirimi', /Yedek kaydedildi|Backup saved/.test(note), note);
  const ls = D.adb(['shell', 'ls -l /sdcard/Download/ | grep soundvisualizer-telefon || true']);
  check('dosya İndirilenler klasöründe', /soundvisualizer-telefon-yedek-.*svbackup/.test(ls), ls);
  await ev('window.SVShell.close(); 1');
  asApp('rm -f files/media/e2e-full.svbackup files/media/e2e-part.svbackup');
  page.close();
  console.log(bad ? 'BASARISIZ: ' + bad : 'hepsi gecti');
  process.exit(bad ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(2); });
