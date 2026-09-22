'use strict';
/* MİLKDROP KİTAPLIĞI (#576): favoriler, etiketler, yazar araması, otomatik
 * geçişin havuzu ve paketle taşınmaları.
 *
 * Favori ve etiketler #569'un puanları gibi AYARLARDA, preset kimliğine
 * bağlı (`milkdropLibrary`). Paket kimlik eşlemi değil, her presetin kendi
 * `library` kaydını taşıyor: içe aktarım presetlere yeni kimlik veriyor ve
 * kayıt o kimliğe katlanıyor. Yazar dosyada yok; "Yazar - Başlık" adından
 * arama sırasında türetiliyor.
 *
 * Motor ve panel sahte bir pencereyle gerçekten çalıştırılıyor.
 */
global.window = global.window || {};
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
require('../src/shared/defaults.js');
require('../src/shared/presets.js');
const L = require('../src/shared/milkdrop-library.js');

const ROOT = path.join(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf-8');
const SV = global.window.SV;
const PR = global.window.SVPresets;

// ------------------------------------------------------------------ yazar

test('yazar: "Yazar - Başlık" adından; birden çok yazar ayrılıyor', () => {
  const a = (name, author) => L.authorsOf({ name, author });
  assert.deepStrictEqual(a('Geiss - Cauldron'), ['Geiss']);
  assert.deepStrictEqual(a('Flexi, martin + geiss - dedicated to the sherwin maxawow'), ['Flexi', 'martin', 'geiss']);
  assert.deepStrictEqual(a('Rovastar & Idiot24-7 - Balk Acid'), ['Rovastar', 'Idiot24-7'], 'boşluksuz tire yazarın parçası');
  assert.deepStrictEqual(a('yin - 191 - Temporal singularities'), ['yin'], 'ilk " - " ayırıyor');
  assert.deepStrictEqual(a('$$$ Royal - Mashup (220)'), ['$$$ Royal']);
  assert.deepStrictEqual(a('Geiss + GEISS - Twice'), ['Geiss'], 'aynı yazar bir kez');
  assert.deepStrictEqual(a('001 - test'), [], 'harf taşımayan parça yazar değil');
  assert.deepStrictEqual(a('_Mig_049'), [], 'tire yoksa yazar yok');
  assert.deepStrictEqual(a('Kutup Işığı', 'CAYADEV'), ['CAYADEV'], 'kaydın kendi alanı önce');
  assert.deepStrictEqual(L.authorsOf(null), []);
});

test('katlama: büyük/küçük harf ve Türkçe I/ı, İ/i farkı yok', () => {
  assert.strictEqual(L.fold('IŞIK'), L.fold('ışık'));
  assert.strictEqual(L.fold('İSTANBUL'), 'istanbul');
  assert.strictEqual(L.fold('INFINITY'), 'infinity');
  assert.strictEqual(L.fold('  Çok   boşluk '), 'çok boşluk');
});

// ---------------------------------------------------------------- etiket

test('etiket girişi: virgül, # ve tekrar temizleniyor; sınırlar', () => {
  assert.deepStrictEqual(L.normTags(' #Dans, sakin ,DANS,, ışık ; IŞIK '), ['Dans', 'sakin', 'ışık']);
  assert.deepStrictEqual(L.normTags(['a', 5, null, {}, ' #b ']), ['a', '5', 'b']);
  const many = Array.from({ length: 30 }, (_, i) => 't' + i);
  assert.strictEqual(L.normTags(many).length, L.MAX_TAGS);
  assert.strictEqual(L.normTags(['x'.repeat(80)])[0].length, L.MAX_TAG_LEN);
  assert.deepStrictEqual(L.normTags(''), []);
});

test('favori ve etiket yazımı yeni eşlem döndürüyor; silinen presetin izi gidiyor', () => {
  const lib = { ratings: { a: 4 }, favorites: {}, tags: {} };
  const fav = L.withFavorite(lib, 'a', true);
  assert.notStrictEqual(fav, lib.favorites, 'yerinde değişmemeli');
  assert.deepStrictEqual(fav, { a: true });
  assert.deepStrictEqual(L.withFavorite({ favorites: fav }, 'a', false), {});
  const tags = L.withTags(lib, 'a', 'sakin, #dans');
  assert.deepStrictEqual(tags, { a: ['sakin', 'dans'] });
  assert.deepStrictEqual(L.withTags({ tags }, 'a', '  '), {}, 'boş giriş etiketleri siliyor');
  const gone = L.forget({ ratings: lib.ratings, favorites: fav, tags }, 'a');
  assert.deepStrictEqual(gone, { ratings: {}, favorites: {}, tags: {} });
  // Nesnenin kendi alanlarına denk gelen anahtar yazılmıyor
  assert.deepStrictEqual(L.withFavorite({}, '__proto__', true), {});
  assert.strictEqual({}.a, undefined);
});

// ----------------------------------------------------------------- arama

const LIST = [
  { id: 'a', name: 'Geiss - Cauldron' },
  { id: 'b', name: 'Martin - Liquid' },
  { id: 'c', name: 'Flexi + Geiss - Martin Tribute' },
  { id: 'd', name: 'Rovastar - Altars' },
  { id: 'e', name: 'Kutup Işığı', author: 'CAYADEV' },
];
const LIB = { favorites: { a: true, d: true }, tags: { a: ['Sakin'], b: ['sakin', 'dans'], c: ['Dans'] }, ratings: { b: 3 } };
const ids = (arr) => arr.map((p) => p.id);

test('arama: adda, yazarda ve etiketlerde; bütün sözcükler uymalı', () => {
  const f = (q, extra) => ids(L.filter(LIST, Object.assign({ query: q }, extra), LIB));
  assert.deepStrictEqual(f(''), ['a', 'b', 'c', 'd', 'e']);
  assert.deepStrictEqual(f('geiss'), ['a', 'c']);
  assert.deepStrictEqual(f('#dans'), ['b', 'c'], 'yalnız etiket');
  assert.deepStrictEqual(f('#DA'), ['b', 'c'], 'yazarken daralıyor');
  assert.deepStrictEqual(f('sakin'), ['a', 'b'], 'düz sözcük etiketlerde de');
  assert.deepStrictEqual(f('yazar:martin'), ['b'], 'başlıktaki "Martin" yazar değil');
  assert.deepStrictEqual(f('author:MARTIN'), ['b']);
  assert.deepStrictEqual(f('etiket:#sakin'), ['a', 'b']);
  assert.deepStrictEqual(f('tag:dans geiss'), ['c'], 'iki koşul birlikte');
  assert.deepStrictEqual(f('cayadev'), ['e'], 'kaydın yazarı');
  assert.deepStrictEqual(f('ışığ'), ['e']);
  assert.deepStrictEqual(f('IŞIĞ'), ['e'], 'Türkçe büyük harf');
  // Görünen ad (çevrilen yerleşik) da aranıyor
  assert.deepStrictEqual(ids(L.filter(LIST, { query: 'aurora', nameOf: (n) => (n === 'Kutup Işığı' ? 'Aurora' : n) }, LIB)), ['e']);
});

test('süzgeç: favoriler, bir etiket, bir yazar — aramayla birlikte', () => {
  const f = (o) => ids(L.filter(LIST, o, LIB));
  assert.deepStrictEqual(f({ show: 'fav' }), ['a', 'd']);
  assert.deepStrictEqual(f({ show: 'tag', tag: 'SAKIN' }), ['a', 'b'], 'etiket katlanarak eşleşiyor');
  assert.deepStrictEqual(f({ show: 'tag', tag: 'sak' }), [], 'süzgeçte etiket TAM eşleşme');
  assert.deepStrictEqual(f({ author: 'geiss' }), ['a', 'c']);
  assert.deepStrictEqual(f({ author: 'martin' }), ['b'], 'yazar seçimi başlığa bakmıyor');
  assert.deepStrictEqual(f({ show: 'fav', author: 'geiss' }), ['a']);
  assert.deepStrictEqual(f({ show: 'tag', tag: 'dans', query: 'flexi' }), ['c']);
});

test('sayımlar: katlanmış anahtara göre, en sık yazılışla, alfabetik', () => {
  // Eşit sıklıkta listede ilk görülen yazılış: "dans" (b), "Sakin" (a)
  assert.deepStrictEqual(L.tagCounts(LIST, LIB).map((t) => [t.name, t.count]), [['dans', 2], ['Sakin', 2]]);
  const au = L.authorCounts(LIST);
  assert.deepStrictEqual(au.map((a) => [a.key, a.count]), [['cayadev', 1], ['flexi', 1], ['geiss', 2], ['martin', 1], ['rovastar', 1]]);
  const mixed = L.authorCounts([{ name: 'geiss - x' }, { name: 'Geiss - y' }, { name: 'Geiss - z' }]);
  assert.deepStrictEqual(mixed.map((a) => a.name), ['Geiss']);
});

// ------------------------------------------------------------------ havuz

test('havuz: hepsi, favoriler, bir etiket; sıra listeninki', () => {
  assert.strictEqual(L.pool(LIST, {}, LIB), LIST, 'varsayılan: liste olduğu gibi');
  assert.deepStrictEqual(ids(L.pool(LIST, { autoFrom: 'favorites' }, LIB)), ['a', 'd']);
  assert.deepStrictEqual(ids(L.pool(LIST, { autoFrom: 'tag', autoTag: 'DANS' }, LIB)), ['b', 'c']);
  assert.deepStrictEqual(L.pool(LIST, { autoFrom: 'tag', autoTag: '' }, LIB), [], 'etiketsiz etiket havuzu boş');
  assert.deepStrictEqual(L.pool(LIST, { autoFrom: 'favorites' }, {}), [], 'kitaplık yoksa favori yok');
  assert.deepStrictEqual(L.poolOf({ autoFrom: 'bilinmeyen' }), { from: 'all', tag: '' });
  assert.deepStrictEqual(L.poolOf({ autoFrom: 'favorites', autoTag: 'x' }), { from: 'favorites', tag: '' });
});

// ------------------------------------------------------------------ paket

test('paket kaydı: yalnız verilenler; içe aktarımda doğrulanıyor', () => {
  assert.deepStrictEqual(L.packEntry(LIB, 'a'), { favorite: true, tags: ['Sakin'] });
  assert.deepStrictEqual(L.packEntry(LIB, 'b'), { tags: ['sakin', 'dans'], rating: 3 });
  assert.strictEqual(L.packEntry(LIB, 'e'), null, 'verilmiş bir şey yoksa kayıt yok');
  // Dosyadan gelen JSON: `__proto__` burada nesnenin KENDİ anahtarı
  const entries = JSON.parse('{"n1":{"favorite":true,"tags":["#Yeni","yeni"],"rating":9},' +
    '"n2":{"favorite":"evet","tags":"dizi değil","rating":"4"},"n3":null,' +
    '"__proto__":{"favorite":true,"tags":["kirli"],"rating":2}}');
  assert.ok(Object.keys(entries).includes('__proto__'));
  const m = L.mergeEntries({ ratings: { x: 1 } }, entries);
  assert.deepStrictEqual(m.favorites, { n1: true });
  assert.deepStrictEqual(m.tags, { n1: ['Yeni'] }, 'eşlemin prototipi de değişmemiş olmalı');
  assert.deepStrictEqual(m.ratings, { x: 1, n1: 5 }, 'puan 0..5, metin puan değil');
  assert.strictEqual(m.count, 1);
  assert.strictEqual({}.favorite, undefined, 'prototip kirlenmedi');
});

test('paket gidiş-dönüş: favori, etiket ve puan yeni kimliklerle geri geliyor', () => {
  const mine = [
    { id: 'md_bir', kind: 'milkdrop', name: 'Geiss - Bir', source: '[preset00]\n' },
    { id: 'md_iki', kind: 'milkdrop', name: 'Martin - İki', source: '[preset00]\n', library: { favorite: true } },
    // Kaydı olmayan presette bayat alan: pakete sızmamalı
    { id: 'md_uc', kind: 'milkdrop', name: 'Üç', source: '[preset00]\n', library: { favorite: true, tags: ['bayat'] } },
  ];
  const lib = { favorites: { md_bir: true }, tags: { md_iki: ['dans'] }, ratings: { md_bir: 2, md_iki: 0 } };
  const pack = JSON.parse(JSON.stringify(PR.makePack(mine, { name: 'x' }, (p) => L.packEntry(lib, p.id))));
  assert.deepStrictEqual(pack.presets.map((p) => p.library || null), [
    { favorite: true, rating: 2 },
    { tags: ['dans'], rating: 0 },
    null,
  ], 'kaynaktaki bayat `library` alanı pakete sızmıyor');
  const r = PR.readImported(pack);
  assert.ok(r.ok);
  assert.strictEqual(r.presets.length, 3);
  for (const p of r.presets) {
    assert.ok(!['md_bir', 'md_iki', 'md_uc'].includes(p.id), 'yeni kimlik');
    assert.strictEqual(p.library, undefined, 'kayıt preset dosyasına yazılmıyor');
  }
  const [n1, n2, n3] = r.presets.map((p) => p.id);
  assert.deepStrictEqual(Object.keys(r.library).sort(), [n1, n2].sort());
  // Yalnız kaydedilenler: üçüncü kaydedilemedi say
  const target = { ratings: { eski: 4 }, favorites: {}, tags: {} };
  const n = L.adopt(target, r.library, [r.presets[0], r.presets[1]]);
  assert.strictEqual(n, 2);
  assert.deepStrictEqual(target.favorites, { [n1]: true });
  assert.deepStrictEqual(target.tags, { [n2]: ['dans'] });
  assert.deepStrictEqual(target.ratings, { eski: 4, [n1]: 2, [n2]: 0 });
  assert.ok(!Object.prototype.hasOwnProperty.call(target.favorites, n3));
  // Kaydedilmeyenin kaydı alınmıyor
  const t2 = { ratings: {}, favorites: {}, tags: {} };
  assert.strictEqual(L.adopt(t2, r.library, []), 0);
  assert.deepStrictEqual(t2.favorites, {});
});

test('eski paketler ve tek preset: kayıt yoksa boş eşlem', () => {
  const r = PR.readImported({ format: 'svpack', presets: [{ name: 'eski', kind: 'milkdrop', source: '' }] });
  assert.ok(r.ok);
  assert.deepStrictEqual(r.library, {});
  const one = PR.readImported({ format: 'svpreset', name: 'tek', library: { favorite: true } });
  assert.ok(one.ok);
  assert.deepStrictEqual(one.library, { [one.presets[0].id]: { favorite: true } });
  assert.strictEqual(one.presets[0].library, undefined);
  const odd = PR.readImported({ format: 'svpack', presets: [{ name: 'x', library: ['dizi'] }, { name: 'y', library: 'metin' }] });
  assert.deepStrictEqual(odd.library, {}, 'nesne olmayan kayıt yok sayılıyor');
});

// ------------------------------------------------------------------ motor

const PRESETS = ['p1', 'p2', 'p3', 'p4', 'p5'].map((id, i) => ({
  id, name: 'Yazar - ' + id, kind: 'milkdrop', source: '[preset00]\nfDecay=0.9' + i + '\n',
}));

function engine() {
  const canvas = () => ({ width: 320, height: 240, getContext: (k) => (k === '2d' ? {} : null), addEventListener() {} });
  const ctx = { window: {}, document: { createElement: canvas }, console, performance };
  ctx.window.document = ctx.document;
  ctx.window.SVPresets = { byKind: (k) => PRESETS.filter((p) => p.kind === k) };
  vm.createContext(ctx);
  for (const f of ['src/shared/milkdrop.js', 'src/shared/milkdrop-cycle.js', 'src/shared/milkdrop-library.js', 'src/visualizer/modes/milkdrop.js']) {
    vm.runInContext(read(f), ctx, { filename: f });
  }
  return { m: new ctx.window.SVModes.milkdrop(canvas()), win: ctx.window };
}

const cfgFor = (md, lib) => ({
  milkdrop: Object.assign({ presetId: 'p1', source: PRESETS[0].source, blendTime: 0, autoNext: 1, autoNextRand: 0, autoOrder: 'sequential' }, md),
  milkdropControl: {},
  milkdropLibrary: lib || {},
});

// Zamanlayıcıyla art arda seçimler (her seçim yüklenip bir sonrakine geçiliyor)
function picks(e, cfg, n) {
  const out = [];
  e.m._ensurePreset(cfg);
  for (let f = 0; f < 60 * 4 * n && out.length < n; f++) {
    e.m._autoCycle(cfg, 1 / 60, {});
    if (e.m.autoPick && e.m.autoPick.id !== out[out.length - 1]) out.push(e.m.autoPick.id);
  }
  return out;
}

test('motor: zamanlayıcı yalnız havuzdan, sırayla', () => {
  const lib = { favorites: { p2: true, p4: true }, tags: { p3: ['sakin'], p5: ['SAKIN'] } };
  assert.deepStrictEqual(picks(engine(), cfgFor({}, lib), 5), ['p2', 'p3', 'p4', 'p5', 'p1'], 'havuzsuz: bütün liste');
  assert.deepStrictEqual(picks(engine(), cfgFor({ autoFrom: 'favorites' }, lib), 4), ['p2', 'p4', 'p2', 'p4']);
  assert.deepStrictEqual(picks(engine(), cfgFor({ autoFrom: 'tag', autoTag: 'Sakin' }, lib), 3), ['p3', 'p5', 'p3']);
});

test('motor: havuz boşsa ya da tek presetse geçmiyor ve nedenini söylüyor', () => {
  const run = (md, lib) => {
    const e = engine();
    const cfg = cfgFor(md, lib);
    e.m._ensurePreset(cfg);
    for (let f = 0; f < 300; f++) e.m._autoCycle(cfg, 1 / 60, {});
    return { pick: e.m.autoPick, reason: e.m.cycle.reason };
  };
  assert.deepStrictEqual(run({ autoFrom: 'favorites' }, {}), { pick: null, reason: 'EMPTY' });
  assert.deepStrictEqual(run({ autoFrom: 'favorites' }, { favorites: { p3: true } }), { pick: null, reason: 'ALONE' });
  assert.deepStrictEqual(run({ autoFrom: 'tag', autoTag: 'yok' }, { tags: { p2: ['var'] } }), { pick: null, reason: 'EMPTY' });
});

test('motor: sert geçiş ve parça değişimi de havuzdan', () => {
  const lib = { favorites: { p4: true, p5: true } };
  const e = engine();
  const cfg = cfgFor({ autoNext: 0, hardCut: 'md2', autoFrom: 'favorites' }, lib);
  e.m._ensurePreset(cfg);
  e.m._rel = { bass: 10, mid: 10, treb: 10 };
  e.m._autoCycle(cfg, 1 / 60, {});
  assert.ok(e.m.autoPick && e.m.autoPick.cut, 'sert geçiş oldu');
  assert.ok(['p4', 'p5'].includes(e.m.autoPick.id), 'havuzdan: ' + e.m.autoPick.id);
  const t = engine();
  const cfg2 = cfgFor({ autoNext: 0, trackAdvance: true, autoFrom: 'favorites' }, lib);
  t.m._ensurePreset(cfg2);
  t.win.SVNowLive = { state: { has: true, title: 'bir', artist: 'x', album: '' } };
  t.m._autoCycle(cfg2, 1 / 60, {});
  t.win.SVNowLive = { state: { has: true, title: 'iki', artist: 'x', album: '' } };
  t.m._autoCycle(cfg2, 1 / 60, {});
  assert.strictEqual(t.m.autoPick && t.m.autoPick.id, 'p4', 'parça değişince havuzun sıradakisi');
});

test('motor: izleyen havuzu süzmüyor — liderin seçimi zaten havuzdan', () => {
  const e = engine();
  const cfg = cfgFor({ autoFrom: 'favorites' }, { favorites: { p2: true } });
  e.m._ensurePreset(cfg);
  // Liderin havuzu başka (başka bir sahne ya da ayar): seçimi yine izleniyor
  e.win.SVMdFollow = { at: performance.now(), base: e.m._manualKey, id: 'p5', seed: 1, cut: false, blend: null };
  e.m._autoCycle(cfg, 1 / 60, {});
  assert.strictEqual(e.m.autoPick && e.m.autoPick.id, 'p5');
});

test('motor kaynağı: süzgeç listenin kurulduğu yerde, izleme dalında değil', () => {
  const MODE = read('src/visualizer/modes/milkdrop.js');
  const fn = /_autoCycle\(cfg, step, audio\) \{[\s\S]*?\n    \}/.exec(MODE)[0];
  const follow = fn.indexOf('if (F && F.base ===');
  const pool = fn.indexOf('LB.pool(listOf(), md, lib)');
  assert.ok(follow > 0 && pool > follow, 'havuz izleme dalından SONRA');
  assert.match(fn, /const list = o\.seconds > 0 \|\| o\.bars > 0 \|\| o\.hardCut !== 'off' \? poolList\(\) : \[\];/);
  assert.match(fn, /this\.cycle\.onTrack\(md, list\.length \? list : poolList\(\), cur, lib\.ratings\)/);
});

// ------------------------------------------------------------ sayfalar

test('motoru çalıştıran her sayfa kitaplığı döngüden sonra yüklüyor', () => {
  for (const [f, pre] of [
    ['src/visualizer/index.html', '../shared/'],
    ['src/admin/index.html', '../shared/'],
    ['src/exporter/index.html', '../shared/'],
    ['src/web/overlay.html', '/app/shared/'],
  ]) {
    const H = read(f);
    const c = H.indexOf('<script src="' + pre + 'milkdrop-cycle.js"></script>');
    const l = H.indexOf('<script src="' + pre + 'milkdrop-library.js"></script>');
    const m = H.indexOf('modes/milkdrop.js');
    assert.ok(c > 0 && l > c, f + ': kitaplık döngüden sonra');
    assert.ok(m < 0 || l < m, f + ': kitaplık motordan önce');
  }
});

test('varsayılanlar: havuz "hepsi"; favori ve etiketler kitaplıkta, sahnenin dışında', () => {
  const d = SV.defaultConfig();
  assert.strictEqual(d.milkdrop.autoFrom, 'all');
  assert.strictEqual(d.milkdrop.autoTag, '');
  assert.deepStrictEqual(d.milkdropLibrary, { ratings: {}, favorites: {}, tags: {} });
  for (const f of ['src/main/main.js', 'src/admin/control.js', 'src/admin/admin.js']) {
    const m = /const SCENE_KEYS = \[([\s\S]*?)\];/.exec(read(f));
    assert.ok(m && !m[1].includes('milkdropLibrary'), f);
  }
});

// ------------------------------------------------------------------ panel

function el(tag, props, kids) {
  const n = { tag, props: props || {}, text: (props && props.text) || '', kids: [], on: {}, value: (props && props.value) || '', attrs: {} };
  n.className = (props && props.class) || '';
  n.appendChild = (c) => { n.kids.push(c); return c; };
  n.addEventListener = (ev, f) => { n.on[ev] = f; };
  n.setAttribute = (k, v) => { n.attrs[k] = v; };
  n.getAttribute = (k) => n.attrs[k];
  n.removeAttribute = () => {};
  n.contains = () => false;
  Object.defineProperty(n, 'textContent', { get: () => n.text, set: (v) => { n.text = v; n.kids = []; } });
  for (const k of Object.keys(n.props)) if (k.indexOf('on') === 0 && typeof n.props[k] === 'function') n.on[k.slice(2)] = n.props[k];
  (kids || []).forEach((c) => c && n.kids.push(c));
  return n;
}
const walk = (n, f) => { if (!n || typeof n !== 'object') return; f(n); (n.kids || []).forEach((k) => walk(k, f)); if (n.node) walk(n.node, f); };

const MY = Array.from({ length: 8 }, (_, i) => ({
  id: 'u' + i, kind: 'milkdrop', name: (i % 2 ? 'Geiss' : 'Martin') + ' - Preset ' + i, source: '[preset00]\n',
}));

async function panelWith(setup) {
  const key = require.resolve('../src/admin/milkdrop-panel.js');
  delete require.cache[key];
  const cfg = SV.defaultConfig();
  cfg.milkdrop.presetId = 'u1';
  if (setup) setup(cfg);
  const calls = { apply: 0, rerender: 0, deleted: [] };
  global.document = { querySelector: () => null, getElementById: () => null, activeElement: null };
  window.SVMilkdropCycle = require('../src/shared/milkdrop-cycle.js');
  window.SVMilkdropLibrary = L;
  window.api = {
    listPresets: () => Promise.resolve(MY),
    deletePreset: (id) => { calls.deleted.push(id); return Promise.resolve({ ok: true }); },
  };
  window.SVPanel = {
    cfg: () => cfg, apply() { calls.apply++; }, rerender() { calls.rerender++; }, el,
    row: (label, node) => ({ label, node }), confirm: () => Promise.resolve(true), toast() {},
  };
  window.SVScenePanels = { miniSlider: (label) => ({ label, kids: [] }) };
  window.SVMdFollow = null;
  const M = require('../src/admin/milkdrop-panel.js');
  M.init();
  await new Promise((r) => setImmediate(r));
  const root = M.panel();
  const row = (label) => root.kids.find((n) => n && n.label === label);
  return { M, cfg, root, row, calls, render: () => M.panel() };
}

test('panel: ekrandaki presetin favorisi ve etiketleri', async () => {
  const p = await panelWith();
  const fav = p.row('Favori').node;
  assert.strictEqual(fav.text, '☆ Favorilere Ekle');
  fav.on.click();
  assert.deepStrictEqual(p.cfg.milkdropLibrary.favorites, { u1: true }, 'ekrandaki preset favori');
  assert.ok(p.calls.apply > 0, 'yapılandırma gönderildi');
  const again = p.render();
  const fav2 = again.kids.find((n) => n.label === 'Favori').node;
  assert.strictEqual(fav2.text, '★ Favori');
  /* Etiket kutusu KUTUNUN presetine yazıyor: yazarken otomatik geçiş
     ekrandakini değiştirse de (izlenen seçim u3) etiket u1'e gidiyor. */
  const box = again.kids.find((n) => n.label === 'Etiketler').node;
  assert.strictEqual(box.attrs['data-for'], 'u1');
  const input = box.kids.find((k) => k.tag === 'input');
  window.SVMdFollow = { id: 'u3', base: 'u1|0', at: performance.now() };
  input.on.change({ target: { value: 'sakin, #Dans, sakin' } });
  window.SVMdFollow = null;
  assert.deepStrictEqual(p.cfg.milkdropLibrary.tags, { u1: ['sakin', 'Dans'] });
  // Var olan etiketler tek tıkla: çıkar
  const box2 = p.render().kids.find((n) => n.label === 'Etiketler').node;
  const chips = box2.kids.find((k) => k.className === 'md-tagchips');
  assert.deepStrictEqual(chips.kids.map((c) => [c.text, c.className.includes(' on')]), [['#Dans', true], ['#sakin', true]]);
  chips.kids[0].on.click();
  assert.deepStrictEqual(p.cfg.milkdropLibrary.tags, { u1: ['sakin'] });
});

test('panel: arama, süzgeç ve yazar seçicisi listeyi daraltıyor', async () => {
  const p = await panelWith((cfg) => {
    cfg.milkdropLibrary.favorites = { u2: true, u3: true };
    cfg.milkdropLibrary.tags = { u3: ['sakin'], u4: ['Sakin'] };
  });
  const names = (root) => {
    const list = root.kids.find((n) => n && n.className === 'md-list');
    return list.kids.map((it) => it.kids.find((k) => k.className === 'md-name').text);
  };
  assert.strictEqual(names(p.root).length, 8);
  const show = p.row('Süz').node;
  assert.deepStrictEqual(show.kids.map((o) => o.props.value), ['all', 'fav', 'tag:sakin']);
  assert.deepStrictEqual(show.kids.map((o) => o.text), ['Tümü (8)', '★ Favoriler (2)', '#sakin (2)']);
  show.value = 'fav';
  show.on.change();
  assert.strictEqual(p.calls.apply, 0, 'görünüm süzgeci yapılandırma göndermiyor');
  assert.deepStrictEqual(names(p.render()), ['Martin - Preset 2', 'Geiss - Preset 3']);
  const author = p.render().kids.find((n) => n.label === 'Yazar').node;
  assert.deepStrictEqual(author.kids.map((o) => o.text), ['Tüm yazarlar', 'Geiss (4)', 'Martin (4)']);
  author.value = 'geiss';
  author.on.change();
  assert.deepStrictEqual(names(p.render()), ['Geiss - Preset 3']);
  // Arama kutusu: etiket sözcüğü
  const r3 = p.render();
  const search = r3.kids.find((n) => n.label === 'Ara').node;
  assert.strictEqual(search.props.placeholder, 'ad, yazar ya da #etiket');
});

test('panel: az presette gizlenen süzgeç listeyi daraltmaya devam etmiyor', async () => {
  const p = await panelWith((cfg) => { cfg.milkdropLibrary.favorites = { u2: true }; });
  const show = p.row('Süz').node;
  show.value = 'fav';
  show.on.change();
  const count = (root) => root.kids.find((n) => n && n.className === 'md-list').kids.length;
  assert.strictEqual(count(p.render()), 1);
  // Presetler silindi, 5 kaldı: arama ve süzgeç satırları yok, liste tam
  window.api.listPresets = () => Promise.resolve(MY.slice(0, 5));
  await new Promise((r) => p.M.refresh(r));
  const r = p.render();
  assert.ok(!r.kids.some((n) => n && n.label === 'Süz'), 'süzgeç satırı gizli');
  assert.strictEqual(count(r), 5, 'görünmeyen süzgeç uygulanmıyor');
});

test('panel: listede yıldız ve etiketler; silinen presetin kaydı gidiyor', async () => {
  const p = await panelWith((cfg) => {
    cfg.milkdropLibrary.tags = { u5: ['dans'] };
    cfg.milkdropLibrary.ratings = { u5: 4 };
  });
  const list = p.root.kids.find((n) => n && n.className === 'md-list');
  const item = list.kids[5];
  const star = item.kids[0];
  assert.strictEqual(star.className, 'md-fav');
  assert.strictEqual(item.kids.find((k) => k.className === 'md-tagline').text, '#dans');
  star.on.click();
  assert.deepStrictEqual(p.cfg.milkdropLibrary.favorites, { u5: true });
  const del = item.kids[item.kids.length - 1];
  await del.on.click();
  assert.deepStrictEqual(p.calls.deleted, ['u5']);
  assert.deepStrictEqual([p.cfg.milkdropLibrary.favorites, p.cfg.milkdropLibrary.tags, p.cfg.milkdropLibrary.ratings], [{}, {}, {}]);
});

test('panel: havuz seçimi sahneye yazılıyor; boş havuz söyleniyor', async () => {
  const p = await panelWith((cfg) => { cfg.milkdropLibrary.tags = { u3: ['Sakin'], u6: ['sakin'] }; });
  const pool = p.row('Havuz').node;
  assert.deepStrictEqual(pool.kids.map((o) => o.props.value), ['all', 'favorites', 'tag:Sakin']);
  pool.value = 'tag:Sakin';
  pool.on.change();
  assert.deepStrictEqual([p.cfg.milkdrop.autoFrom, p.cfg.milkdrop.autoTag], ['tag', 'Sakin']);
  const notes = (root) => root.kids.filter((n) => n && /studio-note/.test(n.className)).map((n) => n.text);
  let r = p.render();
  assert.ok(notes(r).some((t) => /^Havuz yalnız otomatik geçişi sınırlar/.test(t)));
  assert.ok(!notes(r).some((t) => /^Havuzda/.test(t)), 'iki preset: bekleme notu yok');
  pool.value = 'favorites';
  pool.on.change();
  r = p.render();
  assert.ok(notes(r).some((t) => /^Havuzda preset yok/.test(t)));
  // Hiçbir presette kalmayan etiket seçili görünmeye devam ediyor
  p.cfg.milkdrop.autoFrom = 'tag';
  p.cfg.milkdrop.autoTag = 'eski';
  const pool2 = p.render().kids.find((n) => n.label === 'Havuz').node;
  const sel = pool2.kids.find((o) => o.selected);
  assert.deepStrictEqual([sel.props.value, sel.text], ['tag:eski', '#eski (0)']);
});

test('panel: denetleyiciden favori ekrandakine', async () => {
  const p = await panelWith();
  assert.strictEqual(p.M.act('Favorite'), true);
  assert.deepStrictEqual(p.cfg.milkdropLibrary.favorites, { u1: true });
  p.M.act('Favorite');
  assert.deepStrictEqual(p.cfg.milkdropLibrary.favorites, {});
  const CT = read('src/admin/control.js');
  assert.match(CT, /\{ action: 'mdFavorite', label: '★ MilkDrop · Favori \(aç\/kapa\)' \}/);
});

test('Studio paketi de kayıtları taşıyor', () => {
  const S = read('src/admin/studio.js');
  assert.match(S, /IS\(\)\.makePack\(list, \{ name: 'CAYADEV Preset Paketi' \}, libraryOf\)/);
  assert.match(S, /const libraryOf = ML \? \(p\) => ML\.packEntry\(lib, p\.id\) : null;/);
  assert.match(S, /if \(ML\.adopt\(lib, read\.library, \(saved && saved\.saved\) \|\| \[\]\)\) P\(\)\.push\(true\);/);
});

test('metinlerin İngilizcesi var', () => {
  const I = read('src/shared/i18n.js');
  const PANEL = read('src/admin/milkdrop-panel.js');
  for (const k of [
    'Favori', '★ Favori', '☆ Favorilere Ekle', 'Etiketler', 'virgülle ayırın: sakin, dans', 'Bu presetten çıkar',
    'Bu presete ekle', 'ad, yazar ya da #etiket', 'Süz', 'Tümü', '★ Favoriler', 'Yazar', 'Tüm yazarlar',
    'Favorilerden çıkar', 'Favorilere ekle', 'Havuz', 'Tüm presetler', '📦 Görünenleri Paketle', '📥 Paket İçe Aktar',
    'Dışa aktarma kullanılamıyor.', 'Listede dışa aktarılacak kendi presetiniz yok.', 'preset pakete yazıldı.',
    'Paket okunamadı (.svpack ya da .svpreset bekleniyordu).', 'preset içe aktarıldı.',
    'Listede görünen kendi presetlerinizi favori, etiket ve puanlarıyla tek dosyaya yazar',
    'Bir .svpack paketini favori, etiket ve puanlarıyla ekler',
  ]) {
    assert.ok(PANEL.includes("'" + k + "'"), k + ' panelde yok');
    assert.ok(I.includes("'" + k + "':"), k + ' sözlükte yok');
  }
  for (const re of [/text: '(Havuz yalnız otomatik[^']*)'/, /\? '(Havuzda tek preset[^']*)'/, /: '(Havuzda preset yok[^']*)'/]) {
    const m = re.exec(PANEL);
    assert.ok(m, re + ' panelde yok');
    assert.ok(I.includes("'" + m[1] + "':"), m[1].slice(0, 30) + '… sözlükte yok');
  }
  assert.ok(I.includes("'★ MilkDrop · Favori (aç/kapa)':"));
});
