'use strict';
/* Zaman çizelgesi DÜZENLEYİCİSİ (#636): düzenleme işlemleri, renk ve solo,
 * klavye kısayolları.
 *
 * İşlemler shared/timeline-edit.js'te saf fonksiyonlar; burada tek tek
 * sınanıyor. Sonra panel sahte bir DOM ve tuvalle kuruluyor ve kısayollar
 * panelin kendi klavye tutucusuna veriliyor.
 */
const test = require('node:test');
const assert = require('node:assert');
global.window = global.window || {};
require('../src/shared/defaults.js');
const SV = global.window.SV;
const TL = require('../src/shared/timeline.js');
const TE = require('../src/shared/timeline-edit.js');
window.SVTimeline = TL;
window.SVTimelineEdit = TE;
window.SVClipDeck = require('../src/shared/clipdeck.js');

// ------------------------------------------------------------ geri al/yinele

test('geçmiş: adımlar, geri al, yinele; aynı görüntü iki kez girmiyor', () => {
  const h = new TE.History(10);
  h.reset('a');
  assert.strictEqual(h.canUndo(), false);
  assert.strictEqual(h.push('a'), false, 'aynı görüntü eklenmiyor');
  h.push('b');
  h.push('c');
  assert.strictEqual(h.undo(), 'b');
  assert.strictEqual(h.undo(), 'a');
  assert.strictEqual(h.undo(), null, 'tabanın ötesine gidilmiyor');
  assert.strictEqual(h.redo(), 'b');
  // Geri alındıktan sonra yeni bir adım ileri dalı siliyor
  h.push('x');
  assert.strictEqual(h.canRedo(), false);
  assert.strictEqual(h.undo(), 'b');
});

test('geçmiş: sınırda en eski adım düşüyor', () => {
  const h = new TE.History(3);
  h.reset('0');
  for (const s of ['1', '2', '3', '4']) h.push(s);
  assert.strictEqual(h.stack.length, 3);
  assert.deepStrictEqual(h.stack, ['2', '3', '4']);
});

/* Yapılandırma dışarıdan değişirse (sahne uygulandı, ayar yüklendi, deste
   kaydı parça ekledi) geçmiş yeni bir tabanla başlıyor. Başlamasaydı Ctrl+Z
   eski bir gösteriyi yeni işin üstüne yazardı. */
test('geçmiş: dışarıdan değişen yapılandırma yeni taban', () => {
  const h = new TE.History(10);
  h.reset('a');
  h.push('b');
  h.sync('b');
  assert.strictEqual(h.canUndo(), true, 'kendi yazdığımız: geçmiş duruyor');
  h.sync('dışarıdan');
  assert.strictEqual(h.canUndo(), false, 'geri alınacak eski bir şey yok');
  assert.strictEqual(h.current(), 'dışarıdan');
});

/* Tempo da geçmişe giriyor (#636): cetvelde düzenlendiği için düzenlemenin
   parçası. Önce "ayrı bir ayar" diye girmiyordu; o zaman tek bir BPM vardı. */
test('anlık görüntü: parçalar, işaretler, döngü ve tempo; geri yükleme', () => {
  const cfg = { tracks: [{ id: 't' }], markers: [{ t: 1 }], loop: { enabled: true, start: 1, end: 2 }, tempo: [{ t: 0, bpm: 99, beatsPerBar: 4 }] };
  const snap = TE.snapshot(cfg);
  const to = { tracks: [], markers: [], loop: null, tempo: [{ bpm: 120 }] };
  TE.restore(to, snap);
  assert.deepStrictEqual([to.tracks, to.markers, to.loop, to.tempo], [cfg.tracks, cfg.markers, cfg.loop, cfg.tempo]);
  // Tempo listesi olmayan eski anlık görüntü tempoya dokunmuyor
  const old = JSON.stringify({ tracks: [], markers: [], loop: null });
  const keep = { tempo: [{ bpm: 77 }] };
  TE.restore(keep, old);
  assert.deepStrictEqual(keep.tempo, [{ bpm: 77 }]);
});

// ------------------------------------------------------------ tempo değişimleri

test('tempo listesi: sıralı, ilki 0\'da, sınırlar içinde; boşsa 120', () => {
  assert.deepStrictEqual(TE.tempoList([]), [{ t: 0, bpm: 120, beatsPerBar: 4 }]);
  const l = TE.tempoList([{ t: 8, bpm: 2000, beatsPerBar: 3 }, { t: 0.5, bpm: 100, beatsPerBar: 40 }]);
  assert.deepStrictEqual(l, [{ t: 0, bpm: 100, beatsPerBar: 16 }, { t: 8, bpm: 999, beatsPerBar: 3 }]);
  // Modelin çıktısı (beat0 taşıyan) da düz listeye iniyor
  const m = TL.makeTempoMap([{ t: 0, bpm: 120 }, { t: 4, bpm: 90 }]);
  assert.deepStrictEqual(TE.tempoList(m).map((e) => Object.keys(e).sort()), [['beatsPerBar', 'bpm', 't'], ['beatsPerBar', 'bpm', 't']]);
});

test('tempo değişimi ekle: o anki tempoyla; aynı yere ikinci kez eklenmiyor', () => {
  const base = [{ t: 0, bpm: 120, beatsPerBar: 4 }, { t: 10, bpm: 90, beatsPerBar: 3 }];
  const r = TE.addTempoChange(base, 4);
  assert.strictEqual(r.index, 1);
  assert.deepStrictEqual(r.list[1], { t: 4, bpm: 120, beatsPerBar: 4 });
  assert.strictEqual(r.list.length, 3);
  const r2 = TE.addTempoChange(base, 12, 140);
  assert.deepStrictEqual(r2.list[2], { t: 12, bpm: 140, beatsPerBar: 3 }, 'o anki ölçü, verilen BPM');
  const same = TE.addTempoChange(base, 10.01);
  assert.deepStrictEqual([same.index, same.list.length], [1, 2], 'var olanı seçiyor');
  assert.deepStrictEqual([TE.addTempoChange(base, 0).index, TE.addTempoChange(base, 0).list.length], [0, 2]);
  assert.deepStrictEqual(base.length, 2, 'girdi değişmiyor');
});

test('tempo değişimi taşı / sil / ayarla: ilk giriş sabit, komşuların arasında kalıyor', () => {
  const base = [{ t: 0, bpm: 120, beatsPerBar: 4 }, { t: 4, bpm: 100, beatsPerBar: 4 }, { t: 8, bpm: 80, beatsPerBar: 4 }];
  assert.strictEqual(TE.moveTempoChange(base, 1, 20)[1].t, 8 - TE.TEMPO_GAP, 'sonrakini geçmiyor');
  assert.strictEqual(TE.moveTempoChange(base, 1, -3)[1].t, TE.TEMPO_GAP, 'öncekini geçmiyor');
  assert.strictEqual(TE.moveTempoChange(base, 2, 30)[2].t, 30, 'sonuncunun üst sınırı yok');
  assert.strictEqual(TE.moveTempoChange(base, 0, 5)[0].t, 0, 'ilk giriş taşınmıyor');
  assert.deepStrictEqual(TE.removeTempoChange(base, 1).map((e) => e.t), [0, 8]);
  assert.strictEqual(TE.removeTempoChange(base, 0).length, 3, 'ilk giriş silinmiyor');
  assert.deepStrictEqual(TE.setTempo(base, 2, { bpm: 0, beatsPerBar: 7.6 })[2], { t: 8, bpm: 80, beatsPerBar: 8 }, 'geçersiz BPM eskisinde kalıyor');
  assert.strictEqual(TE.setTempo(base, 1, { bpm: 1500 })[1].bpm, 999);
  assert.strictEqual(TE.tempoIndexAt(base, 7.99), 1);
  assert.strictEqual(TE.tempoIndexAt(base, 8), 2);
});

// ------------------------------------------------------------ klip işlemleri

test('böl: sol parça kısalıyor, sağ parça yeni kimlikle, kırpma başı ilerliyor', () => {
  const c = TL.makeClip({ id: 'c', start: 2, dur: 4, inPoint: 1, speed: 2, type: 'video', ref: 'v', color: '#112233' });
  const r = TE.splitClip(c, 3);
  assert.strictEqual(c.dur, 1);
  assert.strictEqual(r.start, 3);
  assert.strictEqual(r.dur, 3);
  assert.notStrictEqual(r.id, c.id);
  assert.strictEqual(r.inPoint, 1 + 1 * 2, 'ikinci yarı kaldığı yerden (hız 2)');
  assert.deepStrictEqual([r.type, r.ref, r.color], ['video', 'v', '#112233']);
});

test('böl: kenara çok yakın ya da dışarıda bölmüyor', () => {
  const c = TL.makeClip({ start: 2, dur: 4 });
  assert.strictEqual(TE.splitClip(c, 2), null);
  assert.strictEqual(TE.splitClip(c, 2.01), null, 'en kısa süreden kısa parça');
  assert.strictEqual(TE.splitClip(c, 5.99), null);
  assert.strictEqual(TE.splitClip(c, 7), null);
  assert.strictEqual(c.dur, 4, 'bölünmeyen klip değişmiyor');
});

test('çoğalt ve yapıştır: yeni kimlik, aslının ardına ya da verilen ana', () => {
  const c = TL.makeClip({ id: 'c', start: 2, dur: 3, name: 'A', color: '#abcdef' });
  const d = TE.duplicateClip(c);
  assert.deepStrictEqual([d.start, d.dur, d.name, d.color], [5, 3, 'A', '#abcdef']);
  assert.notStrictEqual(d.id, 'c');
  const p = TE.pasteClip(c, 10);
  assert.strictEqual(p.start, 10);
  assert.notStrictEqual(p.id, d.id);
});

test('ızgara adımı: tempoya ve yakalama kipine göre', () => {
  const map = TL.makeTempoMap([{ t: 0, bpm: 120, beatsPerBar: 4 }]);
  assert.strictEqual(TE.gridStep(map, 'beat', 60, 0), 0.5);
  assert.strictEqual(TE.gridStep(map, 'bar', 60, 0), 2);
  assert.strictEqual(TE.gridStep(map, 'quarter', 60, 0), 0.125);
  assert.strictEqual(TE.gridStep(map, 'frame', 50, 0), 0.02);
  assert.strictEqual(TE.gridStep(map, 'off', 60, 0), 0.1);
  // Tempo değişince ölçü uzunluğu da değişiyor (8 sn'den sonra 60 BPM, 3/4)
  const map2 = TL.makeTempoMap([{ t: 0, bpm: 120, beatsPerBar: 4 }, { t: 8, bpm: 60, beatsPerBar: 3 }]);
  assert.strictEqual(TE.gridStep(map2, 'bar', 60, 10), 3);
});

test('sığdır: çizelge görünür genişliğe; boş çizelge sonsuza yakınlaşmıyor', () => {
  const v = TE.fitView(100, 1000, 4, 400);
  assert.ok(Math.abs(v.zoom - 1000 / 105) < 1e-9);
  assert.strictEqual(v.scroll, 0);
  assert.strictEqual(TE.fitView(0, 800, 4, 400).zoom, 100, 'boşta 8 saniye');
});

test('renk: klibin, yoksa parçanın, yoksa türün', () => {
  assert.strictEqual(TE.clipColor({ type: 'palette', color: '#010203' }, { color: '#aaaaaa' }), '#010203');
  assert.strictEqual(TE.clipColor({ type: 'palette', color: '' }, { color: '#aaaaaa' }), '#aaaaaa');
  assert.strictEqual(TE.clipColor({ type: 'palette' }, {}), TE.TYPE_COLORS.palette);
  assert.strictEqual(TE.clipColor({ type: 'scene', color: 'red' }, {}), TE.TYPE_COLORS.scene, 'geçersiz renk yok sayılıyor');
});

// ------------------------------------------------------------ model: renk ve solo

/* Model her panel çiziminde yapılandırmadan yeniden kuruluyor. Yeni bir
   alan `makeClip`/`makeTrack`te taşınmazsa ilk çizimde sessizce silinirdi. */
test('model: renk ve solo yeniden kurulumdan sağ çıkıyor', () => {
  const tl = TL.makeTimeline({ tracks: [
    { kind: 'clip', color: '#ABCDEF', solo: true, clips: [{ start: 1, dur: 2, color: '#123456' }] },
    { kind: 'automation', color: '#654321', target: 'x' },
  ] });
  const again = TL.makeTimeline(JSON.parse(JSON.stringify(tl)));
  assert.strictEqual(again.tracks[0].color, '#abcdef');
  assert.strictEqual(again.tracks[0].solo, true);
  assert.strictEqual(again.tracks[0].clips[0].color, '#123456');
  assert.strictEqual(again.tracks[1].color, '#654321');
  assert.strictEqual(TL.makeClip({ color: 'javascript:alert(1)' }).color, '', 'yalnız #rrggbb');
});

/* Hızı yazılmamış klip 1 hızında. Önce `clamp(undefined)` alt sınırı
   döndürüyordu: her yeni klip 0,05 hızındaydı ve bölünen bir video klibinin
   ikinci yarısı yanlış yerden başlardı. */
test('model: hız verilmemişse 1, sınır dışı değer kenetleniyor', () => {
  assert.strictEqual(TL.makeClip({}).speed, 1);
  assert.strictEqual(TL.makeClip({ speed: 2 }).speed, 2);
  assert.strictEqual(TL.makeClip({ speed: 0 }).speed, 0.05);
  assert.strictEqual(TL.makeClip({ speed: 99 }).speed, 20);
  const c = TL.makeClip({ start: 0, dur: 4 });
  assert.strictEqual(TE.splitClip(c, 1).inPoint, 1, 'bölünen klibin ikinci yarısı 1 sn ileriden');
});

test('model: solo parça varken yalnız solo parçalar çalıyor; susturulan solo da çalmıyor', () => {
  const tl = TL.makeTimeline({ tracks: [
    { id: 'a', kind: 'clip', clips: [{ id: 'ca', start: 0, dur: 10 }] },
    { id: 'b', kind: 'clip', solo: true, clips: [{ id: 'cb', start: 0, dur: 10 }] },
    { id: 'x', kind: 'automation', target: 'p.x', keys: [{ t: 0, v: 1 }] },
    { id: 'y', kind: 'automation', target: 'p.y', solo: true, keys: [{ t: 0, v: 1 }] },
  ] });
  assert.deepStrictEqual(TL.clipsAt(tl, 1).map((e) => e.clip.id), ['cb']);
  assert.deepStrictEqual(Object.keys(TL.automationAt(tl, 1)), ['p.y']);
  tl.tracks[1].muted = true;
  assert.deepStrictEqual(TL.clipsAt(tl, 1).map((e) => e.clip.id), [], 'solo ama susturulmuş');
  // Solo kalkınca hepsi
  for (const t of tl.tracks) { t.solo = false; t.muted = false; }
  assert.deepStrictEqual(TL.clipsAt(tl, 1).map((e) => e.clip.id), ['ca', 'cb']);
});

// ------------------------------------------------------------ panel: kısayollar

function el(tag, props, kids) {
  const n = { tag, props: props || {}, kids: [], on: {}, attrs: {}, style: {}, parent: null, isConnected: true };
  n.className = (props && props.class) || '';
  n.text = (props && props.text) || '';
  n.value = (props && props.value) || '';
  n.appendChild = (c) => { if (c) { c.parent = n; n.kids.push(c); } return c; };
  n.insertBefore = (c, ref) => { c.parent = n; n.kids.splice(Math.max(0, n.kids.indexOf(ref)), 0, c); return c; };
  n.replaceWith = (m) => { const p = n.parent; if (!p) return; m.parent = p; p.kids[p.kids.indexOf(n)] = m; n.isConnected = false; };
  n.addEventListener = (ev, f) => { (n.on[ev] = n.on[ev] || []).push(f); };
  n.setAttribute = (k, v) => { n.attrs[k] = String(v); };
  n.getAttribute = (k) => n.attrs[k];
  n.classList = { toggle() {}, add() {}, remove() {}, contains: () => false };
  Object.defineProperty(n, 'textContent', { get: () => n.text, set: (v) => { n.text = v; } });
  if (tag === 'canvas') {
    n.clientWidth = 800;
    n.getBoundingClientRect = () => ({ left: 0, top: 0, width: 800, height: 200 });
    n.getContext = () => new Proxy({}, { get: (o, k) => (k in o ? o[k] : () => {}), set: (o, k, v) => { o[k] = v; return true; } });
  }
  (kids || []).forEach((c) => c && n.appendChild(c));
  return n;
}
const walk = (n, f) => { if (!n || typeof n !== 'object') return; f(n); (n.kids || []).forEach((k) => walk(k, f)); if (n.node) walk(n.node, f); };
const find = (root, pred) => { let r = null; walk(root, (n) => { if (!r && pred(n)) r = n; }); return r; };

const intervals = [];
const realSetInterval = global.setInterval;
global.setInterval = (f, ms) => { const id = realSetInterval(f, ms); intervals.push(id); return id; };
test.after(() => intervals.forEach((id) => clearInterval(id)));
window.addEventListener = () => {};
global.getComputedStyle = () => ({ getPropertyValue: () => '' });
global.requestAnimationFrame = () => 0;
global.cancelAnimationFrame = () => {};
global.document = { documentElement: {}, querySelector: () => null };

function showCfg() {
  const cfg = SV.defaultConfig();
  cfg.scenes = [{ id: 'sA', name: 'Sahne A', data: {} }];
  Object.assign(cfg.timeline, {
    enabled: true, snap: 'beat', zoom: 60, scroll: 0,
    tempo: [{ t: 0, bpm: 120, beatsPerBar: 4 }],
    tracks: [{ id: 'tr1', kind: 'clip', name: 'P1', clips: [{ id: 'cA', type: 'scene', ref: 'sA', name: 'A', start: 1, dur: 4 }] }],
    markers: [], loop: { enabled: false, start: 0, end: 0 },
  });
  return cfg;
}

let TP = null;
async function mount(cfg) {
  const calls = { rerender: 0, push: 0 };
  window.SVPanel = {
    cfg: () => cfg, el,
    row: (label, node) => el('div', { class: 'row' }, [el('label', { text: label }), node]),
    push() { calls.push++; }, apply() {}, rerender() { calls.rerender++; },
    confirm: () => Promise.resolve(true), toast() {}, actions: () => ({ applyScene() {} }),
  };
  if (!TP) {
    require('../src/admin/timeline-panel.js');
    TP = window.SVTimelinePanel;
  }
  const host = el('div');
  host.appendChild(TP.panel());
  await new Promise((r) => setTimeout(r, 5));
  return { host, calls };
}
const key = (k, extra) => {
  let prevented = false;
  TP._key(Object.assign({ key: k, target: { tagName: 'DIV' }, preventDefault() { prevented = true; }, stopPropagation() {} }, extra || {}));
  return prevented;
};
const clips = (cfg) => cfg.timeline.tracks[0].clips.map((c) => [+c.start.toFixed(3), +c.dur.toFixed(3)]);

test('kısayollar: çoğalt, böl, sil, geri al ve yinele aynı geçmişte', async () => {
  const cfg = showCfg();
  await mount(cfg);
  TP._select({ kind: 'clip', trackId: 'tr1', clipId: 'cA' });
  assert.ok(key('d', { ctrlKey: true }));
  assert.deepStrictEqual(clips(cfg), [[1, 4], [5, 4]], 'Ctrl+D ardına kopya');
  TP.seek(6);
  assert.ok(key('s'));
  assert.deepStrictEqual(clips(cfg), [[1, 4], [5, 1], [6, 3]], 'S kopyayı kafada böldü');
  assert.ok(key('Delete'));
  assert.deepStrictEqual(clips(cfg), [[1, 4], [5, 1]], 'Del sağ parçayı sildi');
  key('z', { ctrlKey: true });
  assert.deepStrictEqual(clips(cfg), [[1, 4], [5, 1], [6, 3]]);
  await mount(cfg); // geri alma paneli yeniden çiziyor; geçmiş aynı kalmalı
  key('z', { ctrlKey: true });
  assert.deepStrictEqual(clips(cfg), [[1, 4], [5, 4]]);
  await mount(cfg);
  key('z', { ctrlKey: true });
  assert.deepStrictEqual(clips(cfg), [[1, 4]]);
  await mount(cfg);
  key('y', { ctrlKey: true });
  assert.deepStrictEqual(clips(cfg), [[1, 4], [5, 4]], 'Ctrl+Y yineledi');
});

test('kısayollar: ok tuşu seçili klibi bir vuruş kaydırıyor, Alt bir kare', async () => {
  const cfg = showCfg();
  await mount(cfg);
  TP._select({ kind: 'clip', trackId: 'tr1', clipId: 'cA' });
  key('ArrowRight');
  assert.deepStrictEqual(clips(cfg), [[1.5, 4]], '120 BPM: bir vuruş 0,5 sn');
  key('ArrowLeft', { altKey: true });
  assert.deepStrictEqual(clips(cfg), [[1.483, 4]], 'bir kare (60 kare/sn)');
});

test('kısayollar: metin alanına yazarken çalışmıyor', async () => {
  const cfg = showCfg();
  await mount(cfg);
  TP._select({ kind: 'clip', trackId: 'tr1', clipId: 'cA' });
  const prevented = key('Delete', { target: { tagName: 'INPUT' } });
  assert.strictEqual(prevented, false);
  assert.strictEqual(cfg.timeline.tracks[0].clips.length, 1, 'klip silinmedi');
  key(' ', { target: { tagName: 'TEXTAREA' } });
  assert.strictEqual(TP.transport().playing, false, 'Boşluk oynatmadı');
});

test('kısayollar: Boşluk oynatıp duraklatıyor; L döngüyü kafadan dört ölçü açıyor', async () => {
  const cfg = showCfg();
  await mount(cfg);
  TP._select(null);
  TP.seek(0);
  key(' ');
  assert.strictEqual(TP.transport().playing, true);
  key(' ');
  assert.strictEqual(TP.transport().playing, false);
  TP.seek(2);
  key('l');
  assert.deepStrictEqual(cfg.timeline.loop, { enabled: true, start: 2, end: 10 }, '120 BPM 4/4: dört ölçü 8 sn');
  key('l');
  assert.strictEqual(cfg.timeline.loop.enabled, false, 'ikinci basış kapatıyor, bölge kalıyor');
  assert.strictEqual(cfg.timeline.loop.end, 10);
});

test('panel: dışarıdan değişen yapılandırmada geri alma eski gösteriyi getirmiyor', async () => {
  const cfg = showCfg();
  await mount(cfg);
  TP._select({ kind: 'clip', trackId: 'tr1', clipId: 'cA' });
  key('d', { ctrlKey: true });
  // Başka bir yol (ör. deste kaydı) çizelgeye parça ekledi
  cfg.timeline.tracks = cfg.timeline.tracks.concat([{ id: 'rec', kind: 'clip', name: 'Kayıt', clips: [] }]);
  await mount(cfg);
  key('z', { ctrlKey: true });
  assert.strictEqual(cfg.timeline.tracks.length, 2, 'kayıt parçası yerinde');
  assert.strictEqual(cfg.timeline.tracks[0].clips.length, 2, 'eski adım geri alınmadı');
});

test('metinlerin İngilizcesi var', () => {
  const src = require('fs').readFileSync(require('path').join(__dirname, '..', 'src', 'admin', 'timeline-panel.js'), 'utf8');
  global.window.SVI18n = null;
  const dictSrc = require('fs').readFileSync(require('path').join(__dirname, '..', 'src', 'shared', 'i18n.js'), 'utf8');
  const need = [
    'Bir klip, anahtar kare ya da parça seçin. Kısayollar için düzenleyiciye tıklayın.',
    'Klavye kısayolları', 'Döngü, işaretler ve cetvel', '＋ Kafada Klip', '＋ Kafada İşaret', 'Parçalar',
    'Oynat / duraklat (Boşluk)', 'Hepsini sığdır (0)', 'Geri al (Ctrl+Z)', 'Yinele (Ctrl+Y)',
    'Solo: yalnız solo parçalar çalar', 'Parçanın Adı', 'Hedef Ayar', '✂ Böl', '⧉ Çoğalt', '🗑 Parçayı Sil',
  ];
  for (const s of need) {
    assert.ok(src.includes(s), 'panelde yok: ' + s);
    const esc = s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/'/g, "\\\\'");
    assert.ok(new RegExp("'" + esc + "':").test(dictSrc), 'sözlükte yok: ' + s);
  }
});
