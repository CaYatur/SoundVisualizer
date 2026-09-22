'use strict';
/* HAREKETİ AZALT (#581).
 *
 * İşletim sistemi hareketin azaltılmasını istediğinde
 * (`prefers-reduced-motion: reduce`; Windows'ta Erişilebilirlik › Görsel
 * efektler › Animasyon efektleri kapalı) flaş sınırlayıcı açık kalıyor,
 * sesin yükselişinde sert geçiş olmuyor ve geçişler uzun sürüyor. Panel
 * nedenini söylüyor; kullanıcı iki yönde de geçersiz kılabiliyor
 * (`milkdropControl.reduceMotion`: 'system' | 'on' | 'off').
 *
 * Motor sahte bir pencereyle kuruluyor (milkdrop-screens.test.js'teki gibi),
 * `matchMedia` sahte ve sonucu testin elinde. Panel de sahte bir DOM'la
 * gerçekten çiziliyor.
 */
global.window = global.window || {};
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
require('../src/shared/defaults.js');

const ROOT = path.join(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf-8');
const bare = (s) => s.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[^:])\/\/[^\n]*/g, '$1 ');
const SV = global.window.SV;
const QUERY = '(prefers-reduced-motion: reduce)';

const PRESETS = [
  { id: 'p1', name: 'Bir', kind: 'milkdrop', source: '[preset00]\nfDecay=0.98\nper_frame_1=zoom = 1.01;\n' },
  { id: 'p2', name: 'İki', kind: 'milkdrop', source: '[preset00]\nfDecay=0.95\nper_frame_1=rot = 0.02;\n' },
  { id: 'p3', name: 'Üç', kind: 'milkdrop', source: '[preset00]\nfDecay=0.90\nper_frame_1=warp = 0.5;\n' },
];

/* Sahte `matchMedia`: sorulanları kaydediyor; `matches` CANLI okunuyor,
   çünkü sistem ayarı uygulama açıkken de değişebilir. */
function fakeMedia(state) {
  const asked = [];
  const mql = { get matches() { return state.on; }, addEventListener() {}, removeEventListener() {} };
  return { asked, fn: (q) => { asked.push(q); return mql; } };
}

function engine(media) {
  const canvas = () => ({ width: 320, height: 240, getContext: (k) => (k === '2d' ? {} : null), addEventListener() {} });
  const ctx = { window: {}, document: { createElement: canvas }, console, performance };
  ctx.window.document = ctx.document;
  ctx.window.SVPresets = { byKind: (k) => PRESETS.filter((p) => p.kind === k) };
  if (media) ctx.window.matchMedia = media.fn;
  vm.createContext(ctx);
  for (const f of ['src/shared/milkdrop.js', 'src/shared/milkdrop-cycle.js', 'src/visualizer/modes/milkdrop.js']) {
    vm.runInContext(read(f), ctx, { filename: f });
  }
  const m = new ctx.window.SVModes.milkdrop(canvas());
  return { m, win: ctx.window };
}

const cfgFor = (p, extra, ctl) => ({
  milkdrop: Object.assign({ presetId: p.id, source: p.source, blendTime: 2, autoNext: 0, autoNextRand: 0 }, extra || {}),
  milkdropControl: ctl || {},
  milkdropLibrary: {},
});

// İzleyen: liderin mesajı `SVMdFollow` olarak geliyor (#585)
function follow(e, cfg, fields) {
  e.win.SVMdFollow = Object.assign({ at: performance.now(), base: e.m._manualKey }, fields);
  e.m._autoCycle(cfg, 1 / 60, {});
}

// ------------------------------------------------------------------ ayar

test('ayar: sistemi izle, her zaman, kapalı', () => {
  const st = { on: false };
  const media = fakeMedia(st);
  const { m } = engine(media);
  const rm = (ctl) => m._reducedMotion({ milkdropControl: ctl });
  assert.strictEqual(rm({ reduceMotion: 'system' }), false, 'sistem istemiyor');
  st.on = true;
  assert.strictEqual(rm({ reduceMotion: 'system' }), true, 'sistem istiyor: yeniden başlatmadan');
  assert.strictEqual(rm({}), true, 'eski ayar dosyası: sistemi izle');
  assert.strictEqual(m._reducedMotion({}), true, 'milkdropControl yoksa da');
  assert.strictEqual(rm({ reduceMotion: 'bilinmeyen' }), true, 'bilinmeyen değer sistemi izliyor');
  assert.strictEqual(rm({ reduceMotion: 'off' }), false, 'geçersiz kılma: sistem istese de azaltmıyor');
  st.on = false;
  assert.strictEqual(rm({ reduceMotion: 'on' }), true, 'sistem istemese de azaltıyor');
  assert.deepStrictEqual(media.asked, [QUERY], 'sorgu bir kez kuruluyor, sonra canlı okunuyor');
});

test('ayar: matchMedia olmayan bir sayfada sistem "istemiyor" sayılıyor', () => {
  const { m } = engine(null);
  assert.strictEqual(m._reducedMotion({ milkdropControl: { reduceMotion: 'system' } }), false);
  assert.strictEqual(m._reducedMotion({ milkdropControl: { reduceMotion: 'on' } }), true);
});

test('dışa aktarım üreten makinenin ayarına bağlı değil; "Her zaman" orada da geçerli', () => {
  /* Aynı iş aynı videoyu vermeli: sistemin ayarı dışa aktarımda ve ölçüm
     betiklerinde (`SVMilkdropSync`) okunmuyor. Kullanıcının açık seçimi
     ('on') ise okunuyor. */
  const media = fakeMedia({ on: true });
  const { m, win } = engine(media);
  win.SVMilkdropSync = true;
  assert.strictEqual(m._reducedMotion({ milkdropControl: { reduceMotion: 'system' } }), false);
  assert.strictEqual(m._reducedMotion({ milkdropControl: { reduceMotion: 'on' } }), true);
  assert.deepStrictEqual(media.asked, [], 'sistem hiç sorulmuyor');
  assert.match(read('src/exporter/exporter.js'), /window\.SVMilkdropSync = true;/, 'dışa aktarıcı bayrağı koyuyor');
});

test('varsayılan "sistemi izle"; ayar gösterinin, sahnenin değil', () => {
  assert.strictEqual(SV.defaultConfig().milkdropControl.reduceMotion, 'system');
  // Sahne anahtarlarında milkdropControl yok: sahne değişince ayar kalıyor
  for (const f of ['src/main/main.js', 'src/admin/control.js', 'src/admin/admin.js']) {
    const m = /const SCENE_KEYS = \[([\s\S]*?)\];/.exec(read(f));
    assert.ok(m, f + ': SCENE_KEYS bulunamadı');
    assert.ok(m[1].includes("'milkdrop'") && !m[1].includes('milkdropControl'), f);
  }
});

// ---------------------------------------------------------------- flaş

const MODE = bare(read('src/visualizer/modes/milkdrop.js'));

test('flaş sınırlayıcı kapatılmış olsa da açık kalıyor', () => {
  const m = /this\._reduced = this\._reducedMotion\(cfg\);\s*this\._flashLimit = [^;]+;/.exec(MODE);
  assert.ok(m, 'karar satırları bulunamadı');
  const run = new Function('cfg', m[0]);
  const at = (reduced, md) => {
    const self = { _reducedMotion: () => reduced };
    run.call(self, { milkdrop: md });
    return [self._reduced, self._flashLimit];
  };
  assert.deepStrictEqual(at(true, { flashLimit: false }), [true, true], 'azaltılırken kapatılamıyor');
  assert.deepStrictEqual(at(false, { flashLimit: false }), [false, false], 'azaltılmıyorsa ayar geçerli');
  assert.deepStrictEqual(at(false, {}), [false, true], 'varsayılan açık');
  assert.deepStrictEqual(at(true, {}), [true, true]);
});

test('karar o karenin seçiminden ve yüklemesinden ÖNCE veriliyor', () => {
  const draw = /\n    draw\(audio, cfg, t, dt\) \{[\s\S]*?\n    \}/.exec(MODE);
  assert.ok(draw, 'draw bulunamadı');
  const d = draw[0];
  const r = d.indexOf('this._reduced = this._reducedMotion(cfg);');
  assert.ok(r > 0, 'karar draw içinde verilmiyor');
  assert.ok(d.indexOf('this._autoCycle(cfg, step, audio);') > r, 'döngü eski kararla çalışırdı');
  assert.ok(d.indexOf('this._ensurePreset(cfg);') > r, 'yükleme eski kararla çalışırdı');
});

// ----------------------------------------------------------- sert geçiş

test('döngünün gördüğü ayar: kopya yalnız gerektiğinde, ayar yerinde', () => {
  const { m } = engine(null);
  const cfg = cfgFor(PRESETS[0], { hardCut: 'md2', blendTime: 1.5 });
  m._reduced = false;
  assert.strictEqual(m._cycleMd(cfg), cfg.milkdrop, 'her kare kopya yok');
  m._reduced = true;
  const md = m._cycleMd(cfg);
  assert.notStrictEqual(md, cfg.milkdrop);
  assert.strictEqual(md.hardCut, 'off');
  assert.strictEqual(md.blendTime, 5);
  assert.strictEqual(md.presetId, 'p1', 'geri kalanı aynı');
  cfg.milkdropControl.locked = true;
  assert.strictEqual(m._cycleMd(cfg).locked, true, 'kilit de geçiyor');
  assert.deepStrictEqual([cfg.milkdrop.hardCut, cfg.milkdrop.blendTime, cfg.milkdrop.locked], ['md2', 1.5, undefined]);
});

test('sesin yükselişinde sert geçiş yok; ayar dosyası değişmiyor', () => {
  const run = (reduced) => {
    const e = engine(null);
    const cfg = cfgFor(PRESETS[0], { hardCut: 'md2' });
    e.m._ensurePreset(cfg);
    e.m._reduced = reduced;
    // Eşiğin (2 x 2,5) üç katından büyük bir patlama
    e.m._rel = { bass: 10, mid: 10, treb: 10 };
    e.m._autoCycle(cfg, 1 / 60, {});
    return { m: e.m, cfg };
  };
  const a = run(false);
  assert.ok(a.m.autoPick && a.m.autoPick.cut === true, 'normalde patlama sert geçiş');
  const b = run(true);
  assert.strictEqual(b.m.autoPick, null, 'azaltılırken patlama preset değiştirmiyor');
  assert.strictEqual(b.cfg.milkdrop.hardCut, 'md2', 'kullanıcının ayarı yerinde');
});

test('otomatik geçiş sürüyor; döngü motorun uzun geçişiyle planlıyor', () => {
  /* MilkDrop'ta presetin ömrü geçişle başlıyor: 2 sn geçiş + 1 sn aralık =
     3 sn. Motor geçişi 5 sn sürdürürken döngü 2 sn'lik planla koşsaydı
     preset ekranda hiç tam görünmeden bir sonrakine geçilirdi. */
  const run = (reduced) => {
    const e = engine(null);
    const cfg = cfgFor(PRESETS[0], { hardCut: 'md2', autoNext: 1, blendTime: 2 });
    e.m._ensurePreset(cfg);
    e.m._reduced = reduced;
    e.m._rel = { bass: 1, mid: 1, treb: 1 };
    let f = 0;
    let prog = 0;
    while (!e.m.autoPick && f < 600) {
      prog = e.m.cycle ? e.m.cycle.progress(e.m._cycleMd(cfg)) : 0;
      e.m._autoCycle(cfg, 1 / 60, {});
      f++;
    }
    return { e, cfg, f, prog };
  };
  const a = run(false);
  assert.ok(Math.abs(a.f - 180) <= 1, 'normalde 2 + 1 sn: ' + a.f + ' kare');
  const b = run(true);
  assert.ok(Math.abs(b.f - 360) <= 1, 'azaltılırken 5 + 1 sn: ' + b.f + ' kare');
  assert.ok(b.prog > 0.99 && b.prog <= 1, 'progress aynı planla geçişten hemen önce 1\'e varıyor: ' + b.prog);
  assert.strictEqual(b.e.m.autoPick.cut, false);
  b.e.m._ensurePreset(b.cfg);
  assert.ok(b.e.m.oldPreset, 'geçiş karışarak');
  assert.strictEqual(b.e.m.blendDur, 5);
  assert.strictEqual(b.cfg.milkdrop.blendTime, 2, 'kullanıcının ayarı yerinde');
});

test('yalnız sert geçiş açıkken liste her karede kurulmuyor', () => {
  let built = 0;
  const e = engine(null);
  const byKind = e.win.SVPresets.byKind;
  e.win.SVPresets.byKind = (k) => { built++; return byKind(k); };
  const cfg = cfgFor(PRESETS[0], { hardCut: 'md2' });
  e.m._ensurePreset(cfg);
  e.m._reduced = true;
  e.m._rel = { bass: 1, mid: 1, treb: 1 };
  for (let i = 0; i < 10; i++) e.m._autoCycle(cfg, 1 / 60, {});
  assert.strictEqual(built, 0);
  e.m._reduced = false;
  e.m._autoCycle(cfg, 1 / 60, {});
  assert.strictEqual(built, 1, 'azaltılmıyorsa sert geçiş için kuruluyor');
});

// -------------------------------------------------------------- geçiş

test('geçişler uzun: motorun sınırı, 0 saniyelik ayarda da', () => {
  for (const bt of [0, 1, 2.5, 5]) {
    const { m } = engine(null);
    m._ensurePreset(cfgFor(PRESETS[0], { blendTime: bt }));
    m._reduced = true;
    m._ensurePreset(cfgFor(PRESETS[1], { blendTime: bt }));
    assert.ok(m.oldPreset, bt + ' sn: geçiş başlamalı');
    assert.strictEqual(m.blendDur, 5, bt + ' sn');
  }
  const { m } = engine(null);
  m._ensurePreset(cfgFor(PRESETS[0], { blendTime: 1 }));
  m._ensurePreset(cfgFor(PRESETS[1], { blendTime: 1 }));
  assert.strictEqual(m.blendDur, 1, 'azaltılmıyorsa ayardaki süre');
});

test('ölçü kipinde vuruşa yuvarlanan süre de uzun', () => {
  const { m } = engine(null);
  const cfg = cfgFor(PRESETS[0]);
  m._ensurePreset(cfg);
  m._reduced = true;
  m.autoPick = { id: 'p2', name: 'İki', source: PRESETS[1].source, cut: false, blend: 1.5, seed: 7 };
  m._ensurePreset(cfg);
  assert.strictEqual(m.blendDur, 5);
});

test('elle "şimdi kes" yine kesiyor: açık bir komut', () => {
  const { m } = engine(null);
  m._ensurePreset(cfgFor(PRESETS[0]));
  m._reduced = true;
  m._ensurePreset(cfgFor(PRESETS[1], {}, { cutTo: 'p2' }));
  assert.ok(!m.oldPreset, 'karışmadan yüklenmeli');
  assert.strictEqual(m.presetKey, 'p2|' + PRESETS[1].source.length);
});

test('izleyen: liderin sert geçişi hareketi azaltan ekranda karışarak', () => {
  /* Lider başka bir makinede olabilir (web çıkışı); azaltma izleyenin
     kendi ekranının ayarı. */
  for (const [reduced, blends] of [[false, false], [true, true]]) {
    const B = engine(null);
    const cfg = cfgFor(PRESETS[0]);
    B.m._ensurePreset(cfg);
    B.m._reduced = reduced;
    follow(B, cfg, { id: 'p2', cut: true, blend: null, seed: 5 });
    assert.strictEqual(B.m.autoPick.cut, true, 'liderin sözü olduğu gibi alınıyor');
    B.m._ensurePreset(cfg);
    assert.strictEqual(!!B.m.oldPreset, blends, reduced ? 'karışarak' : 'kesilerek');
    if (blends) assert.strictEqual(B.m.blendDur, 5);
  }
});

// -------------------------------------------------------------- panel

/* Sahte DOM: admin.js'in `el`i gibi (tag, props, kids). */
function el(tag, props, kids) {
  const n = { tag, props: props || {}, text: (props && props.text) || '', kids: [], on: {}, value: '' };
  n.className = (props && props.class) || '';
  n.appendChild = (c) => { n.kids.push(c); return c; };
  n.addEventListener = (ev, f) => { n.on[ev] = f; };
  n.setAttribute = () => {};
  n.removeAttribute = () => {};
  (kids || []).forEach((c) => c && n.kids.push(c));
  return n;
}

async function panelWith(osOn, mode) {
  const key = require.resolve('../src/admin/milkdrop-panel.js');
  delete require.cache[key];
  const cfg = SV.defaultConfig();
  if (mode !== undefined) cfg.milkdropControl.reduceMotion = mode;
  const asked = [];
  window.matchMedia = (q) => { asked.push(q); return { matches: osOn, addEventListener() {} }; };
  window.api = { listPresets: () => Promise.resolve([]) };
  window.SVPanel = { cfg: () => cfg, apply() {}, rerender() {}, el, row: (label, node) => ({ label, node }) };
  window.SVMdFollow = null;
  const M = require('../src/admin/milkdrop-panel.js');
  M.init();
  await new Promise((r) => setImmediate(r));
  const root = M.panel();
  const i = root.kids.findIndex((n) => n && n.label === 'Hareketi Azalt');
  assert.ok(i >= 0, 'Hareketi Azalt satırı yok');
  const status = root.kids[i + 1];
  assert.strictEqual(status.label, 'Durum');
  const next = root.kids[i + 2];
  return {
    cfg, asked,
    sel: root.kids[i].node,
    status: status.node.kids[0].text,
    statusOn: status.node.className === 'md-ok',
    note: next && !next.label && /studio-note/.test(next.className) && /5 saniye/.test(next.text) ? next.text : null,
  };
}

test('panel: nedeni söylüyor', async () => {
  let p = await panelWith(true, 'system');
  assert.strictEqual(p.status, 'Açık — işletim sistemi hareketin azaltılmasını istiyor');
  assert.ok(p.statusOn && p.note, 'açıkken ne değiştiği anlatılıyor');
  assert.deepStrictEqual([...new Set(p.asked)], [QUERY]);
  p = await panelWith(false, 'system');
  assert.strictEqual(p.status, 'Kapalı — işletim sistemi istemiyor');
  assert.ok(!p.statusOn && !p.note);
  p = await panelWith(false, 'on');
  assert.strictEqual(p.status, 'Açık — bu ayarla');
  assert.ok(p.statusOn && p.note);
  p = await panelWith(true, 'off');
  assert.strictEqual(p.status, 'Kapalı — sistem istiyor ama geçersiz kılındı');
  assert.ok(!p.statusOn && !p.note);
  p = await panelWith(false, 'off');
  assert.strictEqual(p.status, 'Kapalı');
});

test('panel: seçenekler motorun değerleri; seçim ayara yazılıyor', async () => {
  const p = await panelWith(false, undefined);
  assert.deepStrictEqual(p.sel.kids.map((o) => o.props.value), ['system', 'on', 'off']);
  assert.strictEqual(p.sel.kids.find((o) => o.selected).props.value, 'system');
  p.sel.value = 'off';
  p.sel.on.change();
  assert.strictEqual(p.cfg.milkdropControl.reduceMotion, 'off');
  assert.strictEqual(p.cfg.milkdrop.flashLimit, true, 'sahne bloğuna dokunulmuyor');
  const q = await panelWith(true, 'bozuk');
  assert.strictEqual(q.sel.kids.find((o) => o.selected).props.value, 'system', 'bilinmeyen değer sistemi izliyor');
  assert.strictEqual(q.status, 'Açık — işletim sistemi hareketin azaltılmasını istiyor', 'motorla aynı yorum');
});

test('panel: metinlerin İngilizcesi var', () => {
  const I18N = read('src/shared/i18n.js');
  const PANEL = read('src/admin/milkdrop-panel.js');
  for (const k of [
    'Hareketi Azalt', 'Sistemi izle', 'Her zaman', 'Kapalı (sistem istese de)',
    'Açık — bu ayarla', 'Açık — işletim sistemi hareketin azaltılmasını istiyor',
    'Kapalı — sistem istiyor ama geçersiz kılındı', 'Kapalı — işletim sistemi istemiyor',
  ]) {
    assert.ok(PANEL.includes("'" + k + "'"), k + ' panelde yok');
    assert.ok(I18N.includes("'" + k + "':"), k + ' sözlükte yok');
  }
  const note = /text: '(Flaş sınırlayıcı açık kalıyor[^\n]*?)',\r?\n/.exec(PANEL);
  assert.ok(note, 'not panelde bulunamadı');
  assert.ok(I18N.includes("'" + note[1] + "':"), 'notun İngilizcesi yok ya da metin uyuşmuyor');
});
