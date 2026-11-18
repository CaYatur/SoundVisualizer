/*
 * SoundVisualizer — CaYaDev Ses Görselleştirici
 * Copyright (c) 2026 Çağan Turgut (CaYatur) — CaYaDev, https://cayadev.com
 * https://github.com/CaYatur/SoundVisualizer
 * SPDX-License-Identifier: MIT
 */
'use strict';
/* TELEFON GERİ BİLDİRİMİ YOKLAMASI: gerçek dokunuşlarla (adb) ve sınama medya oturumlarıyla
   (android/tonegen SessionReceiver).

   node android/tools/probe-feedback.js [sessions] [theme] [touch] [target] [strips] [layout] [nowplaying] [lyrics] [resets] [dynamic]
   Hiçbiri verilmezse hepsi koşar. Çıktı: her denetim için OK / FAIL, sonunda toplam. */
const D = require('./lib/device.js');

const want = process.argv.slice(2);
const on = (k) => !want.length || want.includes(k);
const results = [];
function check(name, ok, detail) {
  results.push({ name, ok: !!ok });
  console.log((ok ? 'OK   ' : 'FAIL ') + name + (detail !== undefined ? '  ' + JSON.stringify(detail) : ''));
}
const RECV = 'com.cayadev.visualizer.tonegen/.SessionReceiver';
function session(id, state, title, color) {
  const a = ['shell', 'am', 'broadcast', '-n', RECV, '-e', 'id', id, '-e', 'state', state];
  if (title) a.push('-e', 'title', "'" + title + "'");
  if (color) a.push('-e', 'color', "'" + color + "'");
  D.adb(a);
}
const tap = (x, y) => D.adb(['shell', 'input', 'tap', String(Math.round(x)), String(Math.round(y))]);

async function open() {
  const pid = await D.launch();
  const page = await D.connect(pid);
  for (let i = 0; i < 60 && !(await page.evaluate('!!(window.SVShell && window.SVShell.state().ready)')); i++) await D.sleep(200);
  await D.sleep(800);
  return page;
}
const scale = (page) => page.evaluate('window.devicePixelRatio');

async function sessions(page) {
  D.adb(['shell', 'cmd', 'notification', 'allow_listener', D.PKG + '/' + D.PKG + '.media.NowPlayingService']);
  await D.sleep(1500);
  const sys = async () => { await D.sleep(1200); return page.evaluate('(() => { const s = window.SVAndroid.nowPlaying.system() || {}; return { title: s.title || "", playing: !!s.playing }; })()'); };
  session('a', 'pause', 'Kapali Uygulama');
  await D.sleep(500);
  session('b', 'pause', 'YouTube Parca');
  await D.sleep(1000);
  session('b', 'play');
  let s = await sys();
  check('duraklamış uygulama varken çalmaya başlayan seçilir', s.title === 'YouTube Parca' && s.playing, s);
  session('a', 'play');
  s = await sys();
  check('iki uygulama çalıyorsa en son başlayan seçilir', s.title === 'Kapali Uygulama' && s.playing, s);
  session('b', 'pause'); await D.sleep(400); session('b', 'play');
  await D.sleep(400);
  session('a', 'play'); // köprü uygulamaları aynı durumu sürekli yeniler
  s = await sys();
  check('sürekli "çalıyor" yenileyen oturum öne geçmez', s.title === 'YouTube Parca' && s.playing, s);
  session('b', 'stop');
  s = await sys();
  check('duran uygulamadan çalan diğerine dönülür', s.title === 'Kapali Uygulama' && s.playing, s);
  session('a', 'release'); session('b', 'release');
  await D.sleep(1200);
}

async function theme(page) {
  const keep = await page.evaluate('(window.SVAndroid.config.get().ui || {}).theme || "system"');
  await page.evaluate(`(() => { const c = window.SVAndroid.config.get(); window.SVAndroid.config.patch({ ui: Object.assign({}, c.ui, { theme: 'system' }) }); return 1; })()`);
  for (const [mode, id] of [['yes', 'dark'], ['no', 'light'], ['yes', 'dark']]) {
    D.adb(['shell', 'cmd', 'uimode', 'night', mode]);
    await D.sleep(2500);
    const got = await page.evaluate("document.documentElement.getAttribute('data-ui-theme')");
    check('cihaz gece kipi ' + mode + ' → ' + id + ' (yeniden başlatmadan)', got === id, got);
  }
  await page.evaluate(`(() => { const c = window.SVAndroid.config.get(); window.SVAndroid.config.patch({ ui: Object.assign({}, c.ui, { theme: ${JSON.stringify(keep)} }) }); return 1; })()`);
}

async function touch(page) {
  const keep = await page.evaluate('JSON.stringify({ timeline: window.SVAndroid.config.get().timeline || null })');
  await page.evaluate(`(() => {
    const TL = window.SVTimeline;
    const t1 = TL.makeTrack({ id: 'trk_fb', kind: 'clip', name: 'Sahneler', clips: [TL.makeClip({ id: 'clip_fb', type: 'color', start: 0, dur: 8 })] });
    window.SVAndroid.config.patch({ timeline: { id: 'tl_fb', name: 'Probe', tempo: [{ t: 0, bpm: 120, beatsPerBar: 4 }], tracks: [t1], markers: [], loop: { enabled: false, start: 0, end: 4 }, snap: 'bar', enabled: true } });
    window.SVShell.openPage(window.SVShellTimeline.page());
    return 1; })()`);
  await D.sleep(1800);
  const dpr = await scale(page);
  const c = await page.evaluate("window.SVShellTimeline._layout().clips.find((x) => x.id === 'clip_fb')");
  const before = await page.evaluate("JSON.stringify(window.SVAndroid.config.get().timeline)");
  // Koruma süresi sayfanın içinde ölçülür (CDP gidiş-dönüşü emülatörde ~300 ms)
  await page.evaluate(`(() => { const sheet = document.querySelector('#sv-shell .sheet'); window.__guard = []; new MutationObserver(() => window.__guard.push([sheet.classList.contains('tap-guard'), performance.now()])).observe(sheet, { attributes: true, attributeFilter: ['class'] }); return 1; })()`);
  // Gerçek dokunuş hattı (CSS px); dört olay beklemeden art arda, tarayıcı ikinci dokunuştan tıklama da üretir
  const pt = [{ x: c.x + Math.min(c.w, 120) / 2, y: c.y + c.h * 0.7, id: 1 }];
  const ev = (type, touchPoints) => page.call('Input.dispatchTouchEvent', { type, touchPoints });
  await Promise.all([ev('touchStart', pt), ev('touchEnd', []), ev('touchStart', pt), ev('touchEnd', [])]);
  await D.sleep(1500);
  const g = await page.evaluate('window.__guard');
  const on = g.find((x) => x[0]), off = g.find((x) => !x[0] && on && x[1] > on[1]);
  const ms = on && off ? Math.round(off[1] - on[1]) : null;
  check('açılınca ayarlar yarım saniye dokunuş almaz', ms !== null && ms >= 350 && ms <= 900, ms);
  const st = await page.evaluate(`(() => { const b = document.querySelector('#sv-shell .sheet-body'); const s = getComputedStyle(b); return { depth: window.SVShell.state().depth, cls: b.className, ov: s.overflowY, sh: b.scrollHeight, ch: b.clientHeight, title: document.querySelector('#sv-shell .sheet-head h2').textContent }; })()`);
  check('çift dokunuş düzenleme sayfasını açar', st.depth === 2, st);
  check('düzenleme sayfası kayabilir', st.ov === 'auto' && st.cls === 'sheet-body', st);
  const after = await page.evaluate("JSON.stringify(window.SVAndroid.config.get().timeline)");
  const clipOf = (j) => JSON.stringify(JSON.parse(j).tracks[0].clips[0]);
  check('açılırken hiçbir ayar değişmez', clipOf(before) === clipOf(after));
  // Gerçek parmak kaydırması sayfanın sonuna ulaşır
  const r = await page.evaluate("(() => { const r = document.querySelector('#sv-shell .sheet-body').getBoundingClientRect(); return { x: r.left + r.width - 12, top: r.top, bottom: r.bottom }; })()");
  for (let i = 0; i < 8; i++) {
    D.adb(['shell', 'input', 'swipe', String(Math.round(r.x * dpr)), String(Math.round((r.bottom - 30) * dpr)), String(Math.round(r.x * dpr)), String(Math.round((r.top + 30) * dpr)), '250']);
    await D.sleep(350);
  }
  const end = await page.evaluate("(() => { const b = document.querySelector('#sv-shell .sheet-body'); return { top: b.scrollTop, max: b.scrollHeight - b.clientHeight }; })()");
  check('parmakla sayfanın sonuna inilir', end.max <= 0 || end.top >= end.max - 2, end);
  // Yarım saniye sonra ayarlar yine dokunuş alır
  const guard = await page.evaluate("document.querySelector('#sv-shell .sheet').classList.contains('tap-guard')");
  check('koruma süresi sonunda kalkar', !guard);
  await page.evaluate(`(() => { window.SVShell.close(); window.SVAndroid.config.patch(${keep}); return 1; })()`);
  await D.sleep(600);
}

/* Otomasyon hedefi: arama boş bırakılınca bütün ayarlar listelenir, yazılınca süzülür, Vazgeç kapatır. */
async function target(page) {
  const keep = await page.evaluate('JSON.stringify({ timeline: window.SVAndroid.config.get().timeline || null })');
  await page.evaluate(`(() => {
    const TL = window.SVTimeline;
    const t = TL.makeTrack({ id: 'trk_auto', kind: 'automation', name: 'Otomasyon' });
    window.SVAndroid.config.patch({ timeline: { id: 'tl_fb', name: 'Probe', tempo: [{ t: 0, bpm: 120, beatsPerBar: 4 }], tracks: [t], markers: [], loop: { enabled: false, start: 0, end: 4 }, snap: 'bar', enabled: true } });
    window.SVShell.openPage(window.SVShellTimeline.page());
    return 1; })()`);
  await D.sleep(1500);
  await page.evaluate(`(() => { const c = window.SVShellTimeline._core; c.setSelection({ kind: 'track', trackId: 'trk_auto' }); c.openInspector(); return 1; })()`);
  await D.sleep(1200);
  const openSearch = `(() => { const b = [...document.querySelectorAll('#sv-shell .sheet-body button')].find((x) => x.querySelector('.svi') && /Hedef|target/i.test(x.textContent)); b.click(); return 1; })()`;
  const answer = (text, ok) => `(() => { const box = document.querySelector('#sv-shell .dialog-scrim'); const i = box.querySelector('input'); i.value = ${JSON.stringify(text)}; box.querySelector('${ok ? '.btn.primary' : '.btn.ghost'}').click(); return 1; })()`;
  const count = "document.querySelectorAll('#sv-shell .choice-list .choice').length";
  await page.evaluate(openSearch); await D.sleep(500);
  const t0 = Date.now();
  await page.evaluate(answer('', true));
  await D.sleep(1500);
  const all = await page.evaluate(count);
  check('boş aramada bütün ayarlar listelenir', all > 50, { all, ms: Date.now() - t0 - 1500 });
  await page.evaluate('window.SVShell.back(); 1'); await D.sleep(500);
  await page.evaluate(openSearch); await D.sleep(500);
  await page.evaluate(answer('glow', true));
  await D.sleep(1200);
  const some = await page.evaluate(count);
  check('yazınca süzülür', some > 0 && some < all, { some, all });
  await page.evaluate('window.SVShell.back(); 1'); await D.sleep(500);
  await page.evaluate(openSearch); await D.sleep(500);
  await page.evaluate(answer('', false));
  await D.sleep(800);
  check('Vazgeç listeyi açmaz', (await page.evaluate(count)) === 0);
  await page.evaluate(`(() => { window.SVShell.close(); window.SVAndroid.config.patch(${keep}); return 1; })()`);
  await D.sleep(600);
}

/* Yatay kayan sıralar: dokununca yerinde kalır (dar ekranda sıra taşsın diye 360 dp). */
async function strips(page) {
  D.adb(['shell', 'wm', 'size', '945x2100']);
  await D.sleep(3000);
  await page.evaluate("window.SVShell.open('library'); 1");
  await D.sleep(1200);
  const tapLast = (sel) => `(() => { const el = document.querySelector('#sv-shell .sheet-body ${sel}'); el.scrollLeft = el.scrollWidth; const left = el.scrollLeft; el.lastElementChild.click(); return left; })()`;
  const leftOf = (sel) => `document.querySelector('#sv-shell .sheet-body ${sel}').scrollLeft`;
  const a = await page.evaluate(tapLast('.tabs'));
  await D.sleep(900);
  const b = await page.evaluate(leftOf('.tabs'));
  check('Kitaplık sekmeleri dokununca yerinde kalır', a > 0 && Math.abs(a - b) <= 1, { a, b });
  await page.evaluate("document.querySelector('#sv-shell .sheet-body .tabs button').click(); 1");
  await D.sleep(900);
  const hasPills = await page.evaluate("(() => { const p = document.querySelector('#sv-shell .sheet-body .pills'); return !!p && p.scrollWidth > p.clientWidth; })()");
  if (hasPills) {
    const c = await page.evaluate(tapLast('.pills'));
    await D.sleep(900);
    const d = await page.evaluate(leftOf('.pills'));
    check('şablon grupları dokununca yerinde kalır', c > 0 && Math.abs(c - d) <= 1, { c, d });
  }
  await page.evaluate('window.SVShell.close(); 1');
  await D.sleep(500);
  const keep = await page.evaluate('JSON.stringify({ scenes: window.SVAndroid.config.get().scenes || [] })');
  await page.evaluate(`(() => { const scenes = []; for (let i = 0; i < 12; i++) scenes.push({ id: 'sc_s' + i, name: 'Sahne ' + i, data: {} }); window.SVAndroid.config.patch({ scenes }); return 1; })()`);
  await D.sleep(1200);
  const e = await page.evaluate(`(() => { const el = document.querySelector('#sv-shell .scenes'); el.scrollLeft = el.scrollWidth; const left = el.scrollLeft; el.lastElementChild.click(); return left; })()`);
  await D.sleep(1500);
  const f = await page.evaluate("document.querySelector('#sv-shell .scenes').scrollLeft");
  check('sahne şeridi dokununca yerinde kalır', e > 0 && Math.abs(e - f) <= 1, { e, f });
  await page.evaluate(`(() => { window.SVAndroid.config.patch(${keep}); return 1; })()`);
  D.adb(['shell', 'wm', 'size', 'reset']);
  await D.sleep(2500);
}

const LAYOUT = `(() => {
  const vis = (el) => { if (!el) return false; const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0 && r.left >= -1 && r.top >= -1 && r.right <= innerWidth + 1 && r.bottom <= innerHeight + 1 && getComputedStyle(el).visibility !== 'hidden'; };
  const q = (s) => document.querySelector('#sv-shell ' + s);
  const hud = q('.hud');
  const clipped = [...hud.querySelectorAll('.chip')].filter((c) => !c.hidden).filter((c) => c.scrollWidth > c.clientWidth + 1 || [...c.querySelectorAll('.label')].some((l) => getComputedStyle(l).display !== 'none' && l.scrollWidth > l.clientWidth + 1)).map((c) => c.className);
  const kids = [...hud.children].filter((c) => !c.hidden && c.getBoundingClientRect().width > 0).map((c) => c.getBoundingClientRect());
  let overlap = false; for (let i = 1; i < kids.length; i++) if (kids[i].left < kids[i - 1].right - 1) overlap = true;
  const card = q('.scene-card'), strip = q('.scenes'), nav = q('.nav');
  const hit = (a, b) => { const x = a.getBoundingClientRect(), y = b.getBoundingClientRect(); return x.left < y.right - 1 && y.left < x.right - 1 && x.top < y.bottom - 1 && y.top < x.bottom - 1; };
  return { w: innerWidth, h: innerHeight, clipped, overlap, export: vis(q('.scene-card [aria-label="Dışa Aktar"]') || q('.scene-card .iconbtn:last-child')), timeline: vis(q('.scene-card .iconbtn')), vj: vis(q('.vj-pill')), sceneOpen: vis(q('.scene-open')), cardStrip: hit(card, strip), cardNav: hit(card, nav) };
})()`;

async function layout(page) {
  const force = `(() => { const c = document.querySelector('#sv-shell .bpm-chip'); c.hidden = false; c.firstChild.textContent = '128'; const t = document.querySelector('#sv-shell .tl-mode-chip'); t.hidden = false; document.querySelector('#sv-shell .hud').classList.add('tl-on'); return 1; })()`;
  // 945 px, 420 dpi'de 360 dp: en dar yaygın telefon
  const sizes = [['dik telefon 360', '945x2100', 0, 0], ['yatay telefon 360', '945x2100', 0, 1], ['dik telefon', '1080x2400', 0, 0], ['yatay telefon', '1080x2400', 0, 1], ['tablet', '2560x1600', 320, 0]];
  for (const [name, size, density, rot] of sizes) {
    D.adb(['shell', 'wm', 'size', size]);
    if (density) D.adb(['shell', 'wm', 'density', String(density)]); else D.adb(['shell', 'wm', 'density', 'reset']);
    D.adb(['shell', 'settings', 'put', 'system', 'accelerometer_rotation', '0']);
    D.adb(['shell', 'settings', 'put', 'system', 'user_rotation', String(rot)]);
    await D.sleep(3000);
    await page.evaluate('window.SVShell.close(); 1');
    await page.evaluate(force);
    await D.sleep(700);
    const a = await page.evaluate(LAYOUT);
    check(name + ': sahne kartı düğmeleri görünür', a.export && a.timeline && a.vj && a.sceneOpen && !a.cardStrip && !a.cardNav, a);
    check(name + ': üst bilgide kesilen ya da taşan yazı yok', !a.clipped.length && !a.overlap, a.clipped);
    await page.evaluate("window.SVShell.open('settings'); 1");
    await page.evaluate(force);
    await D.sleep(700);
    const b = await page.evaluate(LAYOUT);
    check(name + ': sayfa açıkken de üst bilgi taşmıyor', !b.clipped.length && !b.overlap, b.clipped);
    D.adb(['shell', 'screencap', '-p', '/sdcard/fb.png']);
    await page.evaluate('window.SVShell.close(); 1');
  }
  D.adb(['shell', 'wm', 'size', 'reset']); D.adb(['shell', 'wm', 'density', 'reset']); D.adb(['shell', 'settings', 'put', 'system', 'user_rotation', '0']);
  await D.sleep(2500);
  // Dışa aktar: eski kayıt 30 sn olsa da varsayılan tamamı
  await page.evaluate(`(() => { localStorage.setItem('sv-export', JSON.stringify({ length: '30', orient: 'portrait' })); window.SVShell.openPage(window.SVShellExport.page()); return 1; })()`);
  await D.sleep(700);
  const e = await page.evaluate(`(() => { const s = [...document.querySelectorAll('#sv-shell .seg')].find((x) => x.getAttribute('aria-label') === 'Süre' || x.getAttribute('aria-label') === 'Duration'); return { on: s && s.querySelector('button.on').dataset.v, kept: JSON.parse(localStorage.getItem('sv-export')).orient }; })()`);
  check('dışa aktarma süresi varsayılan olarak tamamı', e.on === 'all' && e.kept === 'portrait', e);
  await page.evaluate("window.SVShell.close(); localStorage.removeItem('sv-export'); 1");
}

async function nowplaying(page) {
  const keep = await page.evaluate('JSON.stringify({ layers: window.SVAndroid.config.get().layers })');
  await page.evaluate(`(() => { const c = window.SVAndroid.config.get(); const l = window.SVLayers.makeNowPlayingLayer({ name: 'NP' }); l.id = 'np_fb'; window.SVAndroid.config.patch({ layers: (c.layers || []).concat([l]) }); window.SVShell.open('layers'); return 1; })()`);
  await D.sleep(900);
  await page.evaluate(`document.querySelector('#sv-shell .row[data-id="np_fb"] .row-main').click(); 1`);
  await D.sleep(900);
  const tabs = await page.evaluate(`[...document.querySelectorAll('#sv-shell .edit-pane .tabs button')].map((b) => b.dataset.id)`);
  check('Çalan Parça katmanında beş ayar sekmesi var', ['content', 'type', 'bar', 'cover', 'motion'].every((k) => tabs.includes(k)), tabs);
  await page.evaluate(`document.querySelector('#sv-shell .edit-pane .tabs button[data-id="bar"]').click(); 1`);
  await D.sleep(500);
  const n = await page.evaluate(`document.querySelectorAll('#sv-shell .edit-pane .edit-pane input[type=range]').length`);
  check('çubuk ayarları görünür', n === 5, n);
  await page.evaluate(`document.querySelector('#sv-shell .edit-pane .edit-pane .toggle').click(); 1`);
  await D.sleep(500);
  const bar = await page.evaluate(`window.SVAndroid.config.get().layers.find((x) => x.id === 'np_fb').settings.nowplaying.show.bar`);
  check('ilerleme çubuğu anahtarı katmana yazılır', bar === false, bar);
  await page.evaluate(`(() => { window.SVShell.close(); window.SVAndroid.config.patch(${keep}); return 1; })()`);
  await D.sleep(600);
}

/* Şarkı sözü katmanı: renk modları ve sabit renkte iki renk, karaoke ayarları, yazı ve yerleşim. */
async function lyricsLayer(page) {
  const keep = await page.evaluate('JSON.stringify({ layers: window.SVAndroid.config.get().layers })');
  await page.evaluate(`(() => { const c = window.SVAndroid.config.get(); const l = { id: 'tx_fb', kind: 'visualizer', type: 'text', enabled: true, opacity: 1, blend: 'normal', name: 'Soz', settings: { text: { enabled: true, source: 'lyrics', lyricsFollow: true, karaoke: true } } }; window.SVAndroid.config.patch({ layers: (c.layers || []).concat([l]) }); window.SVShell.open('layers'); return 1; })()`);
  await D.sleep(900);
  await page.evaluate(`document.querySelector('#sv-shell .row[data-id="tx_fb"] .row-main').click(); 1`);
  await D.sleep(900);
  const tabs = await page.evaluate(`[...document.querySelectorAll('#sv-shell .edit-pane .tabs button')].map((b) => b.dataset.id)`);
  check('söz katmanında dört ayar sekmesi var', ['content', 'style', 'place', 'motion'].every((k) => tabs.includes(k)), tabs);
  const inner = (s) => `#sv-shell .edit-pane .edit-pane ${s}`;
  const karaoke = await page.evaluate(`[...document.querySelectorAll('${inner('.ctl-label')}')].map((x) => x.textContent)`);
  check('karaoke dolumu ve esnetme görünür', karaoke.some((t) => /Karaoke (Dolumu|Fill)/i.test(t)) || karaoke.length >= 5, karaoke.length);
  await page.evaluate(`document.querySelector('#sv-shell .edit-pane .tabs button[data-id="style"]').click(); 1`);
  await D.sleep(500);
  const seg = await page.evaluate(`[...document.querySelectorAll('${inner('.seg button')}')].map((b) => b.dataset.v)`);
  check('renk modları: sabit, tema, gökkuşağı', ['custom', 'theme', 'rainbow'].every((k) => seg.includes(k)), seg);
  await page.evaluate(`document.querySelector('${inner('.seg button[data-v="custom"]')}').click(); 1`);
  await D.sleep(600);
  const swatches = await page.evaluate(`document.querySelectorAll('${inner('.swatch')}').length`);
  check('sabit renkte metin ve vurgu rengi görünür', swatches === 2, swatches);
  const t = await page.evaluate(`window.SVAndroid.config.get().layers.find((x) => x.id === 'tx_fb').settings.text`);
  check('renk modu katmana yazılır', t.colorMode === 'custom' && t.useCustomColor === true, { m: t.colorMode });
  await page.evaluate(`document.querySelector('#sv-shell .edit-pane .tabs button[data-id="content"]').click(); 1`);
  await page.evaluate(`(() => { window.SVShell.close(); window.SVAndroid.config.patch(${keep}); return 1; })()`);
  await D.sleep(600);
}

/* Varsayılana döndür düğmesi: dokununca kaybolur. Bütün ayar sayfaları ve sekmeleri taranır. */
async function resets(page) {
  const keep = await page.evaluate('JSON.stringify((() => { const c = window.SVAndroid.config.get(); return { layers: c.layers, transition: c.transition, postfx: c.postfx, power: c.power, background: c.background }; })())');
  // Görünen her sıfırlama düğmesine basar; kalanların etiketini döndürür
  const sweep = `(async () => {
    const stuck = [];
    const wait = (ms) => new Promise((r) => setTimeout(r, ms));
    for (let round = 0; round < 40; round++) {
      const b = [...document.querySelectorAll('#sv-shell .sheet-body .ctl-reset')].find((x) => !x.hidden && !x.dataset.tried);
      if (!b) break;
      b.dataset.tried = '1';
      const row = b.closest('.ctl-row');
      const label = (row.querySelector('.ctl-label') || {}).textContent || '?';
      b.click();
      await wait(60);
      if (b.isConnected && !b.hidden) stuck.push(label);
    }
    return stuck;
  })()`;
  // Dokunmadan açılan sayfada görünen düğme: varsayılandaki ayar "değişmiş" sayılıyor demek
  const fresh = `[...document.querySelectorAll('#sv-shell .sheet-body .ctl-reset')].filter((x) => !x.hidden).map((b) => (b.closest('.ctl-row').querySelector('.ctl-label') || {}).textContent || '?')`;
  const bad = {}, idle = {};
  const visit = async (name) => {
    await D.sleep(450);
    const f = await page.evaluate(fresh);
    if (f.length) idle[name] = f;
    const s = await page.evaluate(sweep);
    if (s.length) bad[name] = s;
  };
  const tabsOf = (sel) => page.evaluate(`[...document.querySelectorAll('${sel} button')].map((b) => b.dataset.id)`);
  const clickTab = (sel, id) => page.evaluate(`document.querySelector('${sel} button[data-id="${id}"]').click(); 1`);
  await page.evaluate(`(() => {
    const np = window.SVLayers.makeNowPlayingLayer({ name: 'NP' }); np.id = 'np_r';
    np.settings = { nowplaying: { coverOverlay: true, mode: 'onChange', oneLine: true } };
    const tx = { id: 'tx_r', kind: 'visualizer', type: 'text', enabled: true, opacity: 1, blend: 'normal', name: 'Soz', settings: { text: { enabled: true, source: 'lyrics', lyricsFollow: true, karaoke: true, karaokeHold: true, colorMode: 'custom', useCustomColor: true, perCharacter: true } } };
    const c = window.SVAndroid.config.get();
    window.SVAndroid.config.patch({ layers: (c.layers || []).concat([np, tx]) });
    window.SVShell.open('layers'); return 1; })()`);
  await D.sleep(900);
  const ids = await page.evaluate("[...document.querySelectorAll('#sv-shell .row[data-id]')].map((r) => r.dataset.id)");
  for (const id of ids) {
    await page.evaluate("window.SVShell.close(); window.SVShell.open('layers'); 1");
    await D.sleep(500);
    await page.evaluate(`document.querySelector('#sv-shell .row[data-id="${id}"] .row-main').click(); 1`);
    await D.sleep(700);
    const outer = '#sv-shell .sheet-body > .tabs';
    for (const t of await tabsOf(outer)) {
      await clickTab(outer, t);
      await visit(id + '/' + t);
      const inner = '#sv-shell .edit-pane > .tabs';
      for (const i of (t === 'source' ? await tabsOf(inner) : [])) { await clickTab(inner, i); await visit(id + '/' + t + '/' + i); }
    }
  }
  await page.evaluate("window.SVShell.close(); window.SVShell.openPage(window.SVShellScene.page()); 1");
  await D.sleep(700);
  for (const t of await tabsOf('#sv-shell .sheet-body > .tabs')) { await clickTab('#sv-shell .sheet-body > .tabs', t); await visit('sahne/' + t); }
  await page.evaluate("window.SVShell.close(); window.SVShell.open('settings'); 1");
  await visit('ayarlar');
  await page.evaluate("window.SVShell.close(); window.SVShell.openPage(window.SVShellDisplay.page()); 1");
  await visit('goruntuleme');
  await page.evaluate(`(() => { window.SVShell.close(); window.SVAndroid.config.patch(${keep}); return 1; })()`);
  await D.sleep(600);
  check('varsayılana döndürülen ayarda düğme kaybolur', !Object.keys(bad).length, bad);
  // Yoklamanın bilerek açtığı anahtarlar ve önceki koşulardan kalan katmanlar sayılmaz
  const preset = /Stretch Held|Per-Character|Uzatılan Hece|Harf Harf/;
  const wrong = Object.keys(idle).filter((k) => /^(np_r|tx_r)/.test(k)).flatMap((k) => idle[k].filter((x) => !preset.test(x)));
  check('dokunulmamış varsayılan ayarda düğme görünmez', !wrong.length, wrong);
}

async function dynamic(page) {
  D.adb(['shell', 'cmd', 'notification', 'allow_listener', D.PKG + '/' + D.PKG + '.media.NowPlayingService']);
  const keep = await page.evaluate('JSON.stringify({ background: window.SVAndroid.config.get().background, visualizer: window.SVAndroid.config.get().visualizer, layers: window.SVAndroid.config.get().layers, dynamicTheme: window.SVAndroid.config.get().dynamicTheme })');
  const cols = () => page.evaluate('JSON.stringify(window.SVAndroid.config.get().background.gradient.colors)');
  const before = await cols();
  session('c', 'play', 'Kirmizi Kapak', '#e01020');
  await D.sleep(2500);
  check('varsayılan kapalıyken renkler değişmez', (await cols()) === before);
  await page.evaluate(`window.SVAndroid.config.patch({ dynamicTheme: Object.assign({}, window.SVAndroid.config.get().dynamicTheme, { enabled: true, mode: 'artwork' }) }); 1`);
  session('c', 'play', 'Mavi Kapak', '#1030e0');
  await D.sleep(3000);
  const blue = await cols();
  session('c', 'play', 'Kirmizi Yeni', '#e01020');
  await D.sleep(3000);
  const red = await cols();
  check('parça değişince renkler kapaktan gelir', blue !== before && red !== blue, { blue, red });
  session('c', 'release');
  await page.evaluate(`(() => { window.SVAndroid.config.patch(${keep}); return 1; })()`);
  await D.sleep(600);
}

(async () => {
  // Erişim uygulama açılmadan verilir: uygulama izlemeye açılışta ve ön plana dönünce başlar
  D.adb(['shell', 'cmd', 'notification', 'allow_listener', D.PKG + '/' + D.PKG + '.media.NowPlayingService']);
  const page = await open();
  try {
    if (on('sessions')) await sessions(page);
    if (on('theme')) await theme(page);
    if (on('touch')) await touch(page);
    if (on('target')) await target(page);
    if (on('strips')) await strips(page);
    if (on('layout')) await layout(page);
    if (on('nowplaying')) await nowplaying(page);
    if (on('lyrics')) await lyricsLayer(page);
    if (on('resets')) await resets(page);
    if (on('dynamic')) await dynamic(page);
  } finally { page.close(); }
  const bad = results.filter((r) => !r.ok);
  console.log(`\n${results.length - bad.length}/${results.length} geçti`);
  process.exit(bad.length ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(2); });
