'use strict';
/* ÖLÇÜYE BAĞLI GEÇİŞ (#571).
 *
 * Otomatik geçiş saniye yerine ölçüyle: N ölçü başında bir, ilk vuruşun
 * üstünde; geçiş süresi tam vuruşa yuvarlanıyor ve bir vuruşun üstünde
 * bitiyor. Tempo yoksa Otomatik VJ'nin kuralıyla zamana düşülüyor ve bu
 * NOTEMPO diye söyleniyor. Tempo görselleştiricinin kendi sesinden
 * kestiriliyor; kilit Otomatik VJ'nin BPM kilidi. */
global.window = global.window || {};
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const C = require('../src/shared/milkdrop-cycle.js');
const T = require('../src/shared/tempo.js');

const ROOT = path.join(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf-8');
const bare = (s) => s
  .replace(/\/\*[\s\S]*?\*\//g, ' ')
  .replace(/(^|[^:])\/\/[^\n]*/g, '$1 ');

const L3 = [{ id: 'a' }, { id: 'b' }, { id: 'c' }];
const BARS = (n, extra) => Object.assign({ autoNextUnit: 'bars', autoNextBars: n }, extra);

/* Kusursuz bir vuruş akışı: `bpm`de, `bpb` vuruşluk ölçü; her karede o
   karede bir ölçü başı olup olmadığı. */
function beats(bpm, bpb, fps) {
  const period = 60 / bpm;
  let last = -1;
  return (f) => {
    const i = Math.floor((f / fps) / period);
    let onBar = false;
    if (i !== last) { last = i; onBar = i % bpb === 0; }
    return { bpm, onBar, beatsPerBar: bpb };
  };
}

function run(md, seconds, fps, beatAt) {
  const cy = new C.Cycle(() => 0.5);
  let cur = 'a';
  const out = [];
  for (let f = 1; f <= Math.round(seconds * fps); f++) {
    const p = cy.step(1 / fps, md, L3, cur, null, null, beatAt ? beatAt(f) : null);
    if (p) { out.push({ t: f / fps, id: p.id, blend: cy.blend, reason: cy.reason }); cur = p.id; }
  }
  return { cy, out };
}

// ------------------------------------------------------------ ayar

test('birim: ölçüde autoNextBars, saniyede autoNext; seçilmeyenin alanı 0', () => {
  const s = C.normalize({ autoNext: 8, autoNextBars: 4 });
  assert.deepStrictEqual([s.unit, s.seconds, s.bars], ['seconds', 8, 0]);
  const b = C.normalize(BARS(4, { autoNext: 8 }));
  assert.deepStrictEqual([b.unit, b.seconds, b.bars], ['bars', 0, 4], 'birim değişince 8 sn 8 ölçü olmamalı');
  assert.strictEqual(C.normalize(BARS(0)).bars, 0, '0 = kapalı');
  assert.strictEqual(C.normalize(BARS(1e6)).bars, C.MAX_BARS);
  assert.strictEqual(C.normalize({ autoNextUnit: 'haftalar' }).unit, 'seconds');
});

test('varsayılan: saniye; ölçüye geçilince 8 ölçü', () => {
  require('../src/shared/defaults.js');
  const md = global.window.SV.defaultConfig().milkdrop;
  assert.strictEqual(md.autoNextUnit, 'seconds');
  assert.strictEqual(md.autoNextBars, 8);
});

// ------------------------------------------------------------ sayım

test('N ölçüde bir, ölçü başının tam karesinde', () => {
  const fps = 60;
  const { out } = run(BARS(2), 20, fps, beats(120, 4, fps));
  // 120 BPM, 4/4: ölçü 2 sn; 2 ölçü = 4 sn. İlk ölçü başı t≈0'da sayılıyor.
  assert.deepStrictEqual(out.map((x) => +x.t.toFixed(3)), [2, 6, 10, 14, 18]);
  for (const x of out) assert.strictEqual(x.reason, 'OK');
});

test('ölçüdeki vuruş sayısı Otomatik VJ ayarından: 3/4\'te ölçü kısalıyor', () => {
  const fps = 60;
  const { out } = run(BARS(2), 12, fps, beats(120, 3, fps));
  // 3/4'te ölçü 1,5 sn; 2 ölçü = 3 sn
  assert.deepStrictEqual(out.map((x) => +x.t.toFixed(3)), [1.5, 4.5, 7.5, 10.5]);
});

test('geçiş süresi tam vuruşa yuvarlanıyor ve 5 sn sınırında kalıyor', () => {
  assert.strictEqual(C.beatBlend(1.7, 120), 1.5, '1,7 sn ≈ 3,4 vuruş → 3 vuruş');
  assert.strictEqual(C.beatBlend(0.1, 120), 0.5, 'en az bir vuruş');
  assert.strictEqual(C.beatBlend(0, 120), 0, 'sert kesme olduğu gibi');
  const b = C.beatBlend(4.9, 70);
  assert.ok(b <= 5 && Math.abs(b / (60 / 70) - Math.round(b / (60 / 70))) < 1e-9, 'tam vuruş ve ≤5: ' + b);
  assert.strictEqual(C.beatBlend(2, 0), 2, 'tempo yoksa ayardaki süre');
  const { out } = run(BARS(1, { blendTime: 1.7 }), 5, 60, beats(120, 4, 60));
  assert.ok(out.length && out.every((x) => x.blend === 1.5), JSON.stringify(out));
});

test('tempo yoksa NOTEMPO ve Otomatik VJ\'nin yedek kuralı: 2N sn, en az 4', () => {
  const noTempo = () => ({ bpm: 0, onBar: false, beatsPerBar: 4 });
  const r1 = run(BARS(1), 10, 60, noTempo);
  assert.deepStrictEqual(r1.out.map((x) => Math.round(x.t)), [4, 8], 'en az 4 sn');
  assert.ok(r1.out.every((x) => x.reason === 'NOTEMPO' && x.blend === null));
  assert.strictEqual(r1.cy.reason, 'NOTEMPO', 'beklerken de söylüyor');
  const r5 = run(BARS(5), 25, 60, noTempo);
  assert.deepStrictEqual(r5.out.map((x) => Math.round(x.t)), [10, 20], '2 × 5 sn');
});

test('kilit ölçü kipini de durduruyor; sert geçiş ölçü sayacını sıfırlıyor', () => {
  const fps = 60;
  const { out } = run(BARS(1, { locked: true }), 10, fps, beats(120, 4, fps));
  assert.deepStrictEqual(out, []);
  const cy = new C.Cycle(() => 0.5);
  const b = beats(120, 4, fps);
  const md = BARS(4, { hardCut: 'md2' });
  let f = 1;
  for (; f <= 5 * fps; f++) cy.step(1 / fps, md, L3, 'a', { bass: 1, mid: 1, treb: 1 }, null, b(f));
  assert.ok(cy.barCount >= 2, 'ölçüler sayılıyor: ' + cy.barCount);
  const p = cy.step(1 / fps, md, L3, 'a', { bass: 9, mid: 9, treb: 9 }, null, b(f));
  assert.ok(p && cy.cut, 'sert geçiş');
  assert.strictEqual(cy.barCount, 0, 'kesimden sonra sayım baştan');
});

test('progress ölçü kipinde de planın oranı', () => {
  const fps = 60;
  const b = beats(120, 4, fps);
  const cy = new C.Cycle(() => 0.5);
  const md = BARS(2);
  let prog = 0;
  for (let f = 1; f <= 3.9 * fps; f++) {
    const p = cy.step(1 / fps, md, L3, 'a', null, null, b(f));
    if (p) break;
    prog = cy.progress(md);
  }
  // İlk geçiş t=2'de; sonrasında 4 sn'lik planın ~%47'si geçti
  assert.ok(prog > 0.4 && prog < 0.55, 'progress ' + prog);
});

/* Gerçek tempo kestiricisi: bilinen tempolu sentetik bir ses (tempo
   testlerindeki desen), aynı ses iki kez AYNI karelerde geçmeli ve geçişler
   ölçü süresinin katlarına düşmeli. */
function kickAudio(bpm) {
  const period = 60 / bpm;
  const n = 96;
  const bars = new Float32Array(n);
  return {
    ready: true,
    t: 0,
    getBars() {
      const phase = (this.t % period) / period;
      const kick = Math.pow(Math.max(0, 1 - phase * 14), 2);
      for (let i = 0; i < n; i++) {
        const f = i / n;
        bars[i] = 0.05 + 0.05 * Math.sin(this.t * 2 + i) + kick * Math.exp(-f * 5) * 0.9;
      }
      return bars;
    },
  };
}

function runTempo(seconds, fps) {
  const tp = new T.Tempo();
  const au = kickAudio(120);
  const cy = new C.Cycle(() => 0.5);
  let cur = 'a';
  const out = [];
  for (let f = 1; f <= Math.round(seconds * fps); f++) {
    au.t = f / fps;
    tp.update(au, au.t, 1 / fps);
    const beat = { bpm: tp.bpm, onBar: tp.onBar(), beatsPerBar: 4 };
    const p = cy.step(1 / fps, BARS(2), L3, cur, null, null, beat);
    if (p) { out.push({ f, reason: cy.reason, bpm: Math.round(tp.bpm) }); cur = p.id; }
  }
  return out;
}

test('gerçek tempo kestiricisiyle: aynı ses aynı karelerde, geçişler 2 ölçüde bir', () => {
  const a = runTempo(40, 60);
  const b = runTempo(40, 60);
  assert.deepStrictEqual(b, a, 'belirlenimci olmalı');
  const withTempo = a.filter((x) => x.reason === 'OK');
  assert.ok(withTempo.length >= 5, 'tempo bulunduktan sonra geçişler: ' + JSON.stringify(a));
  for (const x of withTempo) assert.ok(Math.abs(x.bpm - 120) <= 2, 'BPM ' + x.bpm);
  // Tempo oturduktan sonra ardışık geçişler arası 2 ölçü = 4 sn (± bir kare)
  for (let i = 1; i < withTempo.length; i++) {
    const gap = (withTempo[i].f - withTempo[i - 1].f) / 60;
    if (withTempo[i - 1].bpm && i > 1) assert.ok(Math.abs(gap - 4) <= 1 / 60 + 1e-9, 'aralık ' + gap);
  }
});

// ------------------------------------------------------------ motor ve sayfalar

const MODE = bare(read('src/visualizer/modes/milkdrop.js'));

test('motor: tempo yalnız ölçü kipinde, görselleştiricinin kendi sesinden', () => {
  const fn = /_beat\(audio, cfg, step\) \{[\s\S]*?\n    \}/.exec(MODE);
  assert.ok(fn, '_beat yok');
  assert.match(fn[0], /md\.autoNextUnit !== 'bars'[\s\S]*?this\._tempo = null; return null;/);
  assert.match(fn[0], /tp\.update\(audio, this\._tempoT, step\);/);
  // Tek BPM kilidi ve ölçü uzunluğu Otomatik VJ'nin ayarı
  assert.match(fn[0], /const av = cfg\.autovj \|\| \{\};/);
  assert.match(fn[0], /av\.bpmLock/);
  assert.match(fn[0], /av\.beatsPerBar/);
  const ac = /_autoCycle\(cfg, step, audio\) \{[\s\S]*?\n    \}/.exec(MODE)[0];
  // İzlerken tempo koşmuyor: izleme dalı `_beat`ten önce dönüyor
  assert.ok(ac.indexOf('const beat = this._beat(audio, cfg, step);') > ac.indexOf('F.base === (this._manualKey'));
  assert.match(ac, /o\.seconds > 0 \|\| o\.bars > 0 \|\| o\.hardCut !== 'off'/);
  assert.match(ac, /blend: this\.cycle\.blend,/);
});

test('motor: vuruşa yuvarlanmış süre o seçimde ayardakinin yerine geçiyor', () => {
  const fn = /_ensurePreset\(cfg\) \{[\s\S]*?\n    \}/.exec(MODE)[0];
  assert.match(fn, /const want = a && typeof a\.blend === 'number' \? a\.blend : \+c\.blendTime \|\| 0;/);
  assert.match(MODE, /livePreset\(\) \{[\s\S]*?bars: tp && this\.cycle \? \{[\s\S]*?noTempo: this\.cycle\.reason === 'NOTEMPO'/);
});

test('tempo modülü MilkDrop çizen her sayfada', () => {
  for (const [page, ref] of [
    ['src/visualizer/index.html', '../shared/tempo.js'],
    ['src/exporter/index.html', '../shared/tempo.js'],
    ['src/web/overlay.html', '/app/shared/tempo.js'],
    ['src/admin/index.html', '../shared/tempo.js'],
  ]) {
    assert.ok(read(page).includes('<script src="' + ref + '"></script>'), page + ' tempo.js yüklemiyor');
  }
});

test('panel: birim seçici, ölçü kaydırıcısı ve görselleştiriciden gelen durum', () => {
  const PANEL = bare(read('src/admin/milkdrop-panel.js'));
  assert.match(PANEL, /P\(\)\.row\('Aralık Birimi', selOf\(/);
  assert.match(PANEL, /md\.autoNextUnit = String\(v\)/);
  assert.match(PANEL, /md\.autoNextBars = Math\.round\(v\)/);
  assert.match(PANEL, /id: 'mdBarStatus'/);
  const fn = /function noteLive\(mp\) \{[\s\S]*?\n  \}/.exec(PANEL)[0];
  assert.match(fn, /const bars = mp && mp\.bars \? mp\.bars : null;/);
  assert.match(fn, /fillBarStatus\(bs, lastBars\)/);
  // Pay ölçü kipinde gösterilmiyor
  assert.match(PANEL, /if \(!bars && \(md\.autoNext \|\| 0\) > 0\) \{/);
});

test('yeni arayüz metinlerinin İngilizcesi var', () => {
  const I = read('src/shared/i18n.js');
  for (const k of ['Aralık Birimi', 'Saniye', 'Ölçü', 'ölçü',
    'Ölçü sayacı görselleştirici açıkken burada görünür.',
    'Tempo bulunamadı: ölçüler sayılamıyor, geçiş zamana düştü.']) {
    assert.ok(I.includes("'" + k + "':"), 'çevirisi yok: ' + k);
  }
  const lits = read('src/admin/milkdrop-panel.js').match(/text: '(?:[^'\\]|\\.)*'/g) || [];
  const note = lits.map((n) => n.slice('text: '.length)).find((k) => k.startsWith("'Ölçü kipinde tempo"));
  assert.ok(note, 'ölçü notu bulunamadı');
  assert.ok(I.includes(note + ':'), 'ölçü notunun çevirisi yok');
});
