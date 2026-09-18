'use strict';
/* MilkDrop 2'NİN ZAMANLAMASI (#568): rastgele pay, kilit, sert geçiş ve
 * `progress`.
 *
 * Kurallar Nullsoft'un kendi kaynağından (jecassis/foo_vis_milk2 5b44cea):
 *   milkdropfs.cpp:765-769  sonraki geçiş = geçiş + aralık + 0..pay
 *   milkdropfs.cpp:771-778  kilit başlangıcı ve bitişi birlikte öteliyor
 *   milkdropfs.cpp:882-906  sert geçiş: eşik, ikiye katlama, sönme
 *   milkdropfs.cpp:476      progress = (şimdi − başlangıç) / (bitiş − başlangıç)
 *
 * Testler kuralları DAVRANIŞIYLA sınıyor; motorun, panelin ve ayarların onlara
 * bağlandığı yerler kaynak üzerinden sabitleniyor. */
global.window = global.window || {};
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const C = require('../src/shared/milkdrop-cycle.js');
const A = require('../src/shared/milkdrop-audio.js');
const D = require('../src/shared/demo-audio.js');

const ROOT = path.join(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf-8');
const bare = (s) => s
  .replace(/\/\*[\s\S]*?\*\//g, ' ')
  .replace(/(^|[^:])\/\/[^\n]*/g, '$1 ');

const L3 = [{ id: 'a', name: 'A' }, { id: 'b', name: 'B' }, { id: 'c', name: 'C' }];
const QUIET = { bass: 1, mid: 1, treb: 1 };
const LOUD = { bass: 9, mid: 9, treb: 9 };

// Kare kare ilerletir; her geçişin kimliğini, zamanını ve sert olup olmadığını toplar
function run(cy, md, list, seconds, dt, startId, relAt) {
  let cur = startId;
  const out = [];
  const frames = Math.round(seconds / dt);
  for (let f = 1; f <= frames; f++) {
    const p = cy.step(dt, md, list, cur, relAt ? relAt(f) : QUIET);
    if (p) { out.push({ id: p.id, t: f * dt, f, cut: cy.cut }); cur = p.id; }
  }
  return out;
}

// Tohumlu üreteç: aynı tohum aynı diziyi verir
function lcg(seed) {
  let s = seed >>> 0;
  return () => { s = (Math.imul(s, 1103515245) + 12345) >>> 0; return s / 4294967296; };
}

// ------------------------------------------------------------ plan

test('geçiş süresi plana giriyor: aralık geçiş bittikten sonra sayılıyor', () => {
  const dt = 1 / 60;
  const g = run(new C.Cycle(), { autoNext: 2, blendTime: 1 }, L3, 12.2, dt, 'a');
  assert.strictEqual(g.length, 4, g.map((x) => x.t.toFixed(3)).join(', '));
  let prev = 0;
  for (const x of g) {
    const aralik = x.t - prev;
    assert.ok(aralik >= 3 - 1e-9 && aralik <= 3 + dt + 1e-9, 'aralık ' + aralik.toFixed(4));
    prev = x.t;
  }
});

test('rastgele pay: her aralık [aralık, aralık + pay] içinde ve dağılıyor', () => {
  const dt = 1 / 60;
  const g = run(new C.Cycle(lcg(7)), { autoNext: 2, autoNextRand: 4 }, L3, 400, dt, 'a');
  assert.ok(g.length > 60, 'yeterince geçiş yok: ' + g.length);
  let prev = 0;
  let lo = Infinity, hi = -Infinity;
  for (const x of g) {
    const aralik = x.t - prev;
    assert.ok(aralik >= 2 - 1e-9 && aralik <= 6 + dt + 1e-9, 'aralık ' + aralik.toFixed(4));
    lo = Math.min(lo, aralik); hi = Math.max(hi, aralik);
    prev = x.t;
  }
  // Pay gerçekten kullanılıyor: aralıklar 4 saniyelik bandın iki ucuna da yaklaşıyor
  assert.ok(lo < 2.5 && hi > 5.5, 'dağılım dar: ' + lo.toFixed(2) + '..' + hi.toFixed(2));
});

test('pay preset başına BİR KEZ çekiliyor: kalan süre titremiyor', () => {
  let calls = 0;
  const rnd = () => { calls++; return 0.75; };
  const cy = new C.Cycle(rnd);
  const md = { autoNext: 10, autoNextRand: 8 };
  const r0 = cy.remaining(md);
  for (let i = 0; i < 120; i++) cy.step(1 / 60, md, L3, 'a', QUIET);
  const r1 = cy.remaining(md);
  assert.strictEqual(calls, 1, 'üreteç her kare çağrılmamalı');
  assert.ok(Math.abs(r0 - 16) < 1e-9, 'plan 10 + 0,75 × 8 = 16: ' + r0);
  assert.ok(Math.abs((r0 - r1) - 2) < 1e-6, 'kalan süre düzgün azalmalı: ' + r0 + ' → ' + r1);
});

test('pay yokken üreteç hiç çağrılmıyor: eski kurulumların sırası aynı', () => {
  let calls = 0;
  const cy = new C.Cycle(() => { calls++; return 0.5; });
  run(cy, { autoNext: 1 }, L3, 5.05, 1 / 60, 'a');
  assert.strictEqual(calls, 0, 'sırayla geçişte pay yokken rastgele sayı çekilmemeli');
});

// ------------------------------------------------------------ kilit

test('kilit: otomatik geçiş duruyor, açılınca kalan süre kaldığı yerden sayıyor', () => {
  const dt = 1 / 60;
  const cy = new C.Cycle();
  const md = { autoNext: 4 };
  run(cy, md, L3, 1, dt, 'a');
  const once = cy.remaining(md);
  const kilitli = Object.assign({}, md, { locked: true });
  assert.deepStrictEqual(run(cy, kilitli, L3, 30, dt, 'a'), []);
  assert.strictEqual(cy.reason, 'LOCKED');
  assert.ok(Math.abs(cy.remaining(md) - once) < 1e-9, 'kilitte kalan süre donmalı');
  const g = run(cy, md, L3, 3.1, dt, 'a');
  assert.strictEqual(g.length, 1, 'kilit açılınca ~3 sn sonra geçmeli');
  assert.ok(Math.abs(g[0].t - 3) <= dt + 1e-9, 'geçiş ' + g[0].t);
});

test('kilit sert geçişi de durduruyor, eşiğe dokunmuyor', () => {
  const cy = new C.Cycle();
  const md = { hardCut: 'md2' };
  cy.step(1 / 60, md, L3, 'a', QUIET);
  const esik = cy.thresh;
  const g = run(cy, Object.assign({ locked: true }, md), L3, 5, 1 / 60, 'a', () => LOUD);
  assert.deepStrictEqual(g, []);
  assert.strictEqual(cy.thresh, esik, 'kilitte eşik sönmemeli de, katlanmamalı da');
});

// ------------------------------------------------------------ progress

test('progress: kapalıyken 0, açıkken planın oranı, geçişte sıfır', () => {
  const dt = 1 / 60;
  const cy = new C.Cycle();
  run(cy, { autoNext: 0 }, L3, 5, dt, 'a');
  assert.strictEqual(cy.progress({ autoNext: 0 }), 0, 'planlanmış geçiş yokken 0');
  const md = { autoNext: 3, blendTime: 1 };
  run(cy, md, L3, 2, dt, 'a');
  assert.ok(Math.abs(cy.progress(md) - 0.5) < 0.01, 'plan 4 sn, 2 sn geçti: ' + cy.progress(md));
  // Geçişten hemen önce 0,99'u aşıyor — "son %1'de söndür" yazan presetler bunu bekliyor
  let enYuksek = 0;
  for (let i = 0; i < 200; i++) {
    const p = cy.step(dt, md, L3, 'a', QUIET);
    if (p) break;
    enYuksek = Math.max(enYuksek, cy.progress(md));
  }
  assert.ok(enYuksek > 0.99, 'geçişten önce son %1: ' + enYuksek);
  assert.ok(cy.progress(md) < 0.01, 'geçişten sonra baştan: ' + cy.progress(md));
});

test('progress kilitte donuyor', () => {
  const cy = new C.Cycle();
  const md = { autoNext: 10 };
  run(cy, md, L3, 4, 1 / 60, 'a');
  const p0 = cy.progress(md);
  run(cy, Object.assign({ locked: true }, md), L3, 20, 1 / 60, 'a');
  assert.strictEqual(cy.progress(md), p0);
});

// ------------------------------------------------------------ sert geçiş

test('sert geçiş: ilk eşik tabanın iki katı, koşul toplam > 3 × eşik', () => {
  const cy = new C.Cycle();
  const md = { hardCut: 'md2', hardCutThreshold: 2 };
  // 3 × (2 × 2) = 12: tam 12 kesmiyor, 12'nin üstü kesiyor
  assert.strictEqual(cy.step(1 / 60, md, L3, 'a', { bass: 4, mid: 4, treb: 4 }), null);
  assert.ok(cy.thresh < 4 && cy.thresh > 3.99, 'kesmeyen karede eşik sönüyor: ' + cy.thresh);
  const cy2 = new C.Cycle();
  const p = cy2.step(1 / 60, md, L3, 'a', { bass: 4.1, mid: 4, treb: 4 });
  assert.ok(p && p.id === 'b', 'eşiği aşan kare kesmeli');
  assert.strictEqual(cy2.cut, true);
  assert.strictEqual(cy2.reason, 'CUT');
  assert.strictEqual(cy2.thresh, 8, 'kesimde eşik ikiye katlanıyor');
});

test('sert geçiş: eşik MilkDrop\'un katsayısıyla sönüyor — fazlalık H/2 saniyede yarıya', () => {
  const dt = 1 / 60;
  const H = 60;
  const cy = new C.Cycle();
  const md = { hardCut: 'md2', hardCutThreshold: 2.5, hardCutHalfLife: H };
  cy.step(dt, md, L3, 'a', LOUD); // ilk kare: eşik 5, 27 > 15 → kesim, eşik 10
  assert.strictEqual(cy.thresh, 10);
  const fazla0 = cy.thresh - 2.5;
  for (let i = 0; i < (H / 2) / dt; i++) cy.step(dt, md, L3, 'a', QUIET);
  assert.ok(Math.abs((cy.thresh - 2.5) / fazla0 - 0.5) < 1e-6, 'oran ' + (cy.thresh - 2.5) / fazla0);
  for (let i = 0; i < (H / 2) / dt; i++) cy.step(dt, md, L3, 'a', QUIET);
  assert.ok(Math.abs((cy.thresh - 2.5) / fazla0 - 0.25) < 1e-6, 'H saniyede dörtte bir');
});

test('sert geçiş: arka arkaya patlama arka arkaya kesim yapmıyor', () => {
  const g = run(new C.Cycle(), { hardCut: 'md2' }, L3, 2, 1 / 60, 'a', () => LOUD);
  // 27 > 15 kesiyor (eşik 10), 27 < 30 artık kesmiyor
  assert.strictEqual(g.length, 1, 'kesimler: ' + g.map((x) => x.f).join(','));
  assert.strictEqual(g[0].cut, true);
});

test('sert geçiş zamanlayıcı kapalıyken de çalışıyor', () => {
  const cy = new C.Cycle();
  assert.strictEqual(cy.step(1 / 60, { hardCut: 'md2' }, L3, 'a', QUIET), null);
  assert.strictEqual(cy.reason, 'ARMED');
  const p = cy.step(1 / 60, { hardCut: 'md2' }, L3, 'a', LOUD);
  assert.ok(p && cy.cut);
});

test('sert geçiş saniyede birden az karede bakmıyor (MilkDrop: GetFps() > 1)', () => {
  const cy = new C.Cycle();
  assert.strictEqual(cy.step(1, { hardCut: 'md2' }, L3, 'a', LOUD), null);
  assert.strictEqual(cy.step(0, { hardCut: 'md2' }, L3, 'a', LOUD), null);
});

test('sert geçiş: bant yoksa ya da bozuksa kesmiyor', () => {
  const cy = new C.Cycle();
  assert.strictEqual(cy.step(1 / 60, { hardCut: 'md2' }, L3, 'a', undefined), null);
  assert.strictEqual(cy.step(1 / 60, { hardCut: 'md2' }, L3, 'a', { bass: NaN, mid: 9, treb: 9 }), null);
});

test('zamanlayıcı ile sert geçiş aynı karede: zamanlayıcı seçiyor, eşik yine katlanıyor', () => {
  const cy = new C.Cycle();
  const md = { autoNext: 1, hardCut: 'md2' };
  run(cy, md, L3, 1 - 1 / 60 - 1e-9, 1 / 60, 'a');
  const esik = cy.thresh;
  const p = cy.step(1 / 60, md, L3, 'a', LOUD);
  assert.ok(p);
  assert.strictEqual(cy.cut, false, 'zamanlayıcının seçimi karışarak yüklenir');
  assert.strictEqual(cy.reason, 'OK');
  assert.strictEqual(cy.thresh, esik * 2, 'MilkDrop o karede de eşiği katlıyor (889-892)');
});

test('sert geçiş kapatılınca eşik unutuluyor, açılınca yine iki kat', () => {
  const cy = new C.Cycle();
  cy.step(1 / 60, { hardCut: 'md2' }, L3, 'a', LOUD);
  assert.strictEqual(cy.thresh, 10);
  cy.step(1 / 60, { hardCut: 'off' }, L3, 'a', QUIET);
  assert.strictEqual(cy.thresh, null);
  cy.step(1 / 60, { hardCut: 'md2' }, L3, 'a', QUIET);
  assert.ok(cy.thresh > 4.99 && cy.thresh <= 5);
});

test('sert geçiş tek presetle ya da sırayla da seçim kuralına uyuyor', () => {
  assert.strictEqual(new C.Cycle().step(1 / 60, { hardCut: 'md2' }, [L3[0]], 'a', LOUD), null);
  const p = new C.Cycle().step(1 / 60, { hardCut: 'md2', autoOrder: 'sequential' }, L3, 'b', LOUD);
  assert.strictEqual(p.id, 'c');
});

/* Belirlenimcilik: sert geçiş sese bağlı, yani şansla geçen bir test
   değersiz. Demo sinyali MilkDrop'un kendi bant zincirinden geçiyor ve aynı
   ses iki kez AYNI karelerde kesmeli. Varsayılan eşikle 60 saniyede kesim
   de olmalı — yoksa test hiçbir şeyi sınamıyor olurdu. */
test('aynı ses iki kez aynı karelerde kesiyor (demo sinyali, MilkDrop bantları)', () => {
  const fps = 30;
  const dt = 1 / fps;
  const once = (md) => {
    const bands = new A.MilkdropBands();
    const cy = new C.Cycle(lcg(3));
    const tb = new Uint8Array(2048);
    let cur = 'a';
    const cuts = [];
    for (let f = 0; f < 60 * fps; f++) {
      D.fill(Math.floor((1 + f * dt) * D.SR), tb);
      const r = bands.update(dt, tb);
      const p = cy.step(dt, md, L3, cur, { bass: r.bass, mid: r.mid, treb: r.treb });
      if (p) { cuts.push(f + ':' + p.id); cur = p.id; }
    }
    return cuts;
  };
  const md = { hardCut: 'md2', autoOrder: 'random' };
  const a = once(md);
  const b = once(md);
  assert.ok(a.length >= 1, 'varsayılan eşikle 60 sn demo seste kesim yok');
  assert.deepStrictEqual(b, a);
  assert.deepStrictEqual(once(Object.assign({ locked: true }, md)), []);
});

// ------------------------------------------------------------ motor

const MODE = bare(read('src/visualizer/modes/milkdrop.js'));

test('motor: sert geçiş karışmadan yükleniyor', () => {
  const fn = /_ensurePreset\(cfg\) \{[\s\S]*?\n    \}/.exec(MODE)[0];
  assert.match(fn, /const cutNow = a \? a\.cut : \(!!cutTo && cutTo === c\.presetId\);/);
  assert.match(fn, /const bt = cutNow \? 0 : Math\.max\(0, Math\.min\(BLEND_MAX, \+c\.blendTime \|\| 0\)\);/);
  const ac = /_autoCycle\(cfg, step\) \{[\s\S]*?\n    \}/.exec(MODE)[0];
  assert.match(ac, /cut: this\.cycle\.cut \}/);
  assert.match(ac, /cut: !!F\.cut \}/, 'önizleme de karışmadan izlemeli');
  assert.match(MODE, /livePreset\(\) \{[\s\S]*?cut: !!\(a && a\.cut\)/);
});

test('motor: sert geçiş duyarlılıktan ÖNCEKİ bantlara bakıyor', () => {
  const rel = MODE.indexOf('this._rel = { bass: a.bass, mid: a.mid, treb: a.treb };');
  const sens = MODE.indexOf('const sens = (cfg.visualizer && cfg.visualizer.sensitivity) || 1;');
  assert.ok(rel > 0, '_rel yazılmıyor');
  assert.ok(sens > rel, 'bantlar duyarlılık kazancından önce alınmalı');
});

test('motor: progress planın oranı; uyum kapalıyken eski yer tutucu', () => {
  assert.match(MODE, /const progress = accProg\s*\? \(this\.cycle \? this\.cycle\.progress\(cfg\.milkdrop\) : 0\)\s*: \(this\.presetTime \* 0\.1\) % 1;/);
  assert.doesNotMatch(MODE, /progress: \(this\.presetTime \* 0\.1\) % 1/, 'yer tutucu yalnız uyum kapalıyken');
  // Geçişte eski preset de aynı değeri görüyor (MilkDrop tek başlangıç/bitiş çifti tutuyor)
  const eski = MODE.match(/progress: accProg \? progress : \(this\.oldPresetTime \* 0\.1\) % 1,/g) || [];
  assert.strictEqual(eski.length, 2, 'eski preset: denklem ve shader girdisi');
});

// ------------------------------------------------------------ ayarlar, panel

test('ayarlar: MilkDrop 2 varsayılanları, sert geçiş kapalı', () => {
  require('../src/shared/defaults.js');
  const md = global.window.SV.defaultConfig().milkdrop;
  assert.strictEqual(md.hardCut, 'off');
  assert.strictEqual(md.hardCutThreshold, 2.5);
  assert.strictEqual(md.hardCutHalfLife, 60);
  assert.strictEqual(md.autoNextRand, 0);
  // Kilit sahnenin değil gösterinin: milkdrop bloğunda değil
  assert.strictEqual(md.locked, undefined);
  assert.strictEqual(global.window.SV.defaultConfig().milkdropControl.locked, false);
});

test('panel: kilit, pay ve sert geçiş denetimleri ayarı yazıyor', () => {
  const PANEL = bare(read('src/admin/milkdrop-panel.js'));
  assert.match(PANEL, /onclick: \(\) => \{ control\(cfg\)\.locked = !locked; rerender\(\); \}/);
  assert.match(PANEL, /'aria-pressed': locked \? 'true' : 'false'/);
  assert.match(PANEL, /miniSlider\('Rastgele Pay'[\s\S]*?md\.autoNextRand = Math\.round\(v\)/);
  assert.match(PANEL, /P\(\)\.row\('Sert Geçiş', selOf\(/);
  assert.match(PANEL, /md\.hardCut = String\(v\)/);
  assert.match(PANEL, /md\.hardCutThreshold = /);
  assert.match(PANEL, /md\.hardCutHalfLife = /);
});

test('yeni arayüz metinlerinin İngilizcesi var', () => {
  const I = read('src/shared/i18n.js');
  const PANEL = read('src/admin/milkdrop-panel.js');
  const keys = [
    '🔒 Kilitli', '🔓 Kilitle', 'Otomatik geçişi ve sert geçişi durdurur; elle seçim çalışır',
    'Rastgele Pay', 'Sert Geçiş', 'MilkDrop 2 (ses yükselişi)', 'Sert Geçiş Eşiği',
    'Eşik Toparlanması', 'yok',
  ];
  for (const k of keys) assert.ok(I.includes("'" + k + "':"), 'çevirisi yok: ' + k);
  // Uzun notlar panelde nasıl yazıldıysa sözlükte de öyle olmalı
  // Kaçışlı tırnak (\') içeren JS dizgesini bütün olarak yakalar
  const lits = PANEL.match(/text: '(?:[^'\\]|\\.)*'/g) || [];
  const notes = lits.map((n) => n.slice('text: '.length))
    .filter((k) => k.startsWith("'Bas, orta ve tiz") || k.startsWith("'Zamanlama MilkDrop 2"));
  assert.strictEqual(notes.length, 2, 'iki açıklama notu bulunamadı');
  for (const key of notes) {
    assert.ok(I.includes(key + ':'), 'notun çevirisi yok: ' + key.slice(0, 50));
  }
});
