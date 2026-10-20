'use strict';
/* AÇILIŞ ANİMASYONU (#537): öğeler videonun başında tek tek gelir.
 *
 * Saf hesap (shared/reveal.js), ayarın yeri (katman / katmansız bölüm),
 * düzen dosyası ve çizici: gerçek `LayerStack` sahte tuvallerle, dışa
 * aktarıcının kare döngüsü gibi (t = kare / fps) birleştiriliyor.
 */
global.window = global.window || {};
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
require('../src/shared/defaults.js');
const R = require('../src/shared/reveal.js');
const LY = require('../src/shared/layout.js');
const L = require('../src/visualizer/layers.js');

const ROOT = path.join(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf-8');
const close = (a, b, eps = 1e-6) => Math.abs(a - b) < eps;

test('gecikmede gizli, süre bitince dokunulmamış; tür yoksa hiç', () => {
  const spec = { type: 'fade', duration: 1, delay: 0.5, ease: 'linear' };
  assert.strictEqual(R.frame(spec, 0, null, 16 / 9).alpha, 0);
  assert.strictEqual(R.frame(spec, 0.5, null, 16 / 9).alpha, 0);
  assert.ok(close(R.frame(spec, 1, null, 16 / 9).alpha, 0.5));
  const end = R.frame(spec, 1.5, null, 16 / 9);
  assert.strictEqual(end.done, true);
  assert.strictEqual(end.alpha, 1);
  assert.strictEqual(R.frame({ type: 'none' }, 0, null, 1).done, true);
  assert.strictEqual(R.active({ type: 'bogus' }), false);
  assert.strictEqual(R.normalize({ type: 'bogus', delay: -3, duration: 99 }).type, 'none');
  assert.strictEqual(R.normalize({ delay: -3 }).delay, 0);
  assert.strictEqual(R.normalize({ duration: 99 }).duration, 10);
});

test('kayma yönü ve mesafesi karenin yüksekliği cinsinden; büyüme kutunun merkezinde; silme kutu boyunca', () => {
  const at0 = (type) => R.frame({ type, duration: 1, delay: 0, distance: 0.1, ease: 'linear' }, 0, null, 2);
  assert.ok(close(at0('slideUp').dy, 0.1), 'aşağıdan gelir');
  assert.ok(close(at0('slideDown').dy, -0.1), 'yukarıdan gelir');
  assert.ok(close(at0('slideLeft').dx, 0.05), 'sağdan gelir, yatayda yükseklik cinsinden');
  assert.ok(close(at0('slideRight').dx, -0.05));
  const box = { x: 0.6, y: 0.7, w: 0.2, h: 0.1 };
  const sc = R.frame({ type: 'scale', duration: 1, ease: 'linear' }, 0.5, box, 16 / 9);
  assert.ok(close(sc.cx, 0.7) && close(sc.cy, 0.75));
  assert.ok(sc.scale > 0.85 && sc.scale < 1);
  const w0 = R.frame({ type: 'wipe', duration: 1, ease: 'linear' }, 0, box, 16 / 9);
  assert.strictEqual(w0.alpha, 0, 'başlamadan görünmez');
  const wm = R.frame({ type: 'wipe', duration: 1, ease: 'linear' }, 0.5, box, 16 / 9);
  assert.ok(close(wm.clip.x1, 0.7), 'kutunun yarısı');
  assert.strictEqual(wm.alpha, 1);
  // Esneyerek: hedefi aşar, saydamlık 1'de kalır
  const bk = R.frame({ type: 'slideUp', duration: 1, ease: 'back', distance: 0.1 }, 0.8, null, 16 / 9);
  assert.ok(bk.dy < 0, 'hedefi aşmalı');
  assert.ok(bk.alpha <= 1);
});

test('sırayla: listedeki sırayla artan gecikme, animasyonu olmayana yukarı kayma', () => {
  const a = {};
  const b = { reveal: { type: 'fade', duration: 2 } };
  const c = {};
  R.stagger([a, b, c], 0.3, 'slideUp');
  assert.strictEqual(a.reveal.delay, 0);
  assert.strictEqual(a.reveal.type, 'slideUp');
  assert.strictEqual(b.reveal.type, 'fade', 'mevcut tür korunur');
  assert.strictEqual(b.reveal.duration, 2);
  assert.ok(close(b.reveal.delay, 0.3));
  assert.ok(close(c.reveal.delay, 0.6));
});

test('ayarın yeri: yığında katman, katmansız kipte sentezlenen katmanın bölümü', () => {
  const stackCfg = { layerStack: { enabled: true }, layers: [{ id: 'a', kind: 'visualizer', type: 'text', reveal: { type: 'fade' } }] };
  assert.strictEqual(LY.revealOf(stackCfg.layers[0], stackCfg).type, 'fade');
  assert.strictEqual(LY.revealHolder(stackCfg.layers[0], stackCfg), stackCfg.layers[0]);
  const classic = { layerStack: { enabled: false }, text: { enabled: true } };
  const synth = { id: 'ly_text', kind: 'visualizer', type: 'text' };
  LY.revealHolder(synth, classic).reveal = { type: 'wipe' };
  assert.strictEqual(classic.text.reveal.type, 'wipe');
  assert.strictEqual(synth.reveal, undefined, 'sentezlenen katmana yazılmaz');
  assert.strictEqual(LY.revealOf(synth, classic).type, 'wipe');
  // Bilinmeyen sentez kimliği: yer yok
  assert.strictEqual(R.holderOf({ id: 'ly_x' }, classic, false, true), null);
});

test('katmansız kipte logo genel logoya yazılır (sentezlenen kopyaya değil)', () => {
  const cfg = { layerStack: { enabled: false }, logo: { src: 'x.png', x: 0.5, y: 0.5 } };
  const synth = { id: 'ly_logo', kind: 'logo', settings: { logo: { src: 'x.png', x: 0.5, y: 0.5 } } };
  LY.moveBy(synth, cfg, 0.1, 0);
  assert.ok(close(cfg.logo.x, 0.6), 'sürüklenen logo geri zıplamasın');
  assert.strictEqual(synth.settings.logo.x, 0.5);
});

test('düzen dosyası açılışı taşır; eski dosya hedefinkini korur, "none" temizler', () => {
  const cfg = { layerStack: { enabled: true }, layers: [{ id: 'a', kind: 'visualizer', type: 'text', reveal: { type: 'slideLeft', delay: 0.4 }, settings: { text: { x: 0.5 } } }] };
  const data = LY.exportLayout(cfg.layers, cfg, {});
  assert.strictEqual(data.elements[0].reveal.type, 'slideLeft');
  assert.strictEqual(data.elements[0].params.reveal, undefined, 'bölüme sızmaz');
  const target = { layerStack: { enabled: true }, layers: [{ id: 'b', kind: 'visualizer', type: 'text', settings: {} }] };
  LY.importLayout(target, data, (s) => s);
  assert.strictEqual(target.layers[0].reveal.type, 'slideLeft');
  assert.ok(close(target.layers[0].reveal.delay, 0.4));
  // Eski (alansız) dosya
  const old = JSON.parse(JSON.stringify(data));
  delete old.elements[0].reveal;
  LY.importLayout(target, old, (s) => s);
  assert.strictEqual(target.layers[0].reveal.type, 'slideLeft');
  // 'none' temizler
  const none = JSON.parse(JSON.stringify(data));
  none.elements[0].reveal = { type: 'none' };
  LY.importLayout(target, none, (s) => s);
  assert.strictEqual(target.layers[0].reveal, undefined);
  // Katmansız kipte bölümdeki açılış dışa aktarımda öğenin alanı
  const classic = { layerStack: { enabled: false }, text: { enabled: true, reveal: { type: 'fade' } } };
  const d2 = LY.exportLayout([{ id: 'ly_text', kind: 'visualizer', type: 'text' }], classic, {});
  assert.strictEqual(d2.elements[0].reveal.type, 'fade');
  assert.strictEqual(d2.elements[0].params.reveal, undefined);
});

/* Çizici: sahte tuvallerle gerçek LayerStack. */
function ctx2d() {
  const c = { drawn: [], globalAlpha: 1, clips: [], clearRect() {}, fillRect() {}, save() {}, restore() {}, setTransform() {},
    translate() {}, rotate() {}, scale() {}, beginPath() {}, rect(x, y, w, h) { c.clips.push([x, y, w, h]); }, clip() {},
    drawImage(src) { c.drawn.push({ name: src.name, alpha: c.globalAlpha }); } };
  return c;
}
function canvas(name) { return { name, width: 320, height: 180, style: { visibility: '' }, classList: { toggle() {} } }; }
const AUDIO = { ready: true, level: 0.5, bass: 0.5, mid: 0.5, treble: 0.5 };

function scene(reveal, opts = {}) {
  const layers = [
    { id: 'bg', kind: 'background', type: 'gradient' },
    Object.assign({ id: 'txt', kind: 'visualizer', type: 'text' }, reveal ? { reveal } : {}),
  ];
  const cfg = { layerStack: { enabled: true }, layers };
  const stack = new L.LayerStack(null, {});
  if (opts.container) stack.container = opts.container;
  stack.width = 320;
  stack.height = 180;
  const mk = (l, name, mode) => ({ layer: L.normalizeLayer(l), key: name, canvas: canvas(name), ctx: ctx2d(), mode, gl: false });
  const txtMode = { draw() {}, layoutBounds: { x: 0.25, y: 0.8, w: 0.5, h: 0.1 }, covers() { return true; } };
  stack.entries = [mk(layers[0], 'bg', { draw() {} }), mk(layers[1], 'txt', txtMode)];
  return { stack, cfg };
}

// Dışa aktarıcının kare döngüsü: t = i / fps, aynı yığın
function exportAlphas(stack, cfg, frames, fps) {
  const out = [];
  for (let i = 0; i < frames; i++) {
    const ctx = ctx2d();
    stack.drawTo(ctx, AUDIO, cfg, i / fps, 1 / fps, null);
    const d = ctx.drawn.find((x) => x.name === 'txt');
    out.push(d ? d.alpha : 0);
  }
  return out;
}

test('dışa aktarım: ilk karede gecikme varsa öğe yok, gecikme + süre sonunda tam', () => {
  const s = scene({ type: 'fade', delay: 0.5, duration: 0.5, ease: 'linear' });
  const a = exportAlphas(s.stack, s.cfg, 40, 30);
  assert.strictEqual(a[0], 0, 'kare 0');
  assert.strictEqual(a[14], 0, 'gecikme içinde (0,47 sn)');
  assert.ok(a[22] > 0 && a[22] < 1, 'yarı yolda (0,73 sn): ' + a[22]);
  assert.strictEqual(a[30], 1, 'bitti (1,0 sn)');
  assert.strictEqual(a[39], 1);
  // Aynı iş iki kez: aynı kareler (yeni yığın)
  const s2 = scene({ type: 'fade', delay: 0.5, duration: 0.5, ease: 'linear' });
  assert.deepStrictEqual(exportAlphas(s2.stack, s2.cfg, 40, 30), a);
});

test('açılışı yoksa çizim aynı yoldan, değişmeden', () => {
  const s = scene(null);
  assert.deepStrictEqual(exportAlphas(s.stack, s.cfg, 3, 30), [1, 1, 1]);
});

test('silme kutu boyunca kırpar; bitince kırpma yok', () => {
  const s = scene({ type: 'wipe', duration: 1, ease: 'linear' });
  const ctx0 = ctx2d();
  s.stack.drawTo(ctx0, AUDIO, s.cfg, 0, 1 / 30, null);
  // İlk karede kutu henüz bildirilmeden de görünmez
  assert.ok(!ctx0.drawn.some((d) => d.name === 'txt'));
  const mid = ctx2d();
  s.stack.drawTo(mid, AUDIO, s.cfg, 0.5, 1 / 30, null);
  assert.strictEqual(mid.clips.length, 1);
  assert.ok(close(mid.clips[0][2], (0.25 + 0.25) * 320), 'kutunun yarısına kadar: ' + mid.clips[0][2]);
  const end = ctx2d();
  s.stack.drawTo(end, AUDIO, s.cfg, 1.2, 1 / 30, null);
  assert.strictEqual(end.clips.length, 0);
});

test('açılışı süren katman altını örtmez; ayar değişince ve "Açılışı Oynat" ile baştan', () => {
  const s = scene({ type: 'fade', duration: 0.5 });
  assert.strictEqual(s.stack._coverFloor(AUDIO, s.cfg), -1, 'ilk karede örtmez');
  exportAlphas(s.stack, s.cfg, 1, 30);
  s.stack.drawTo(ctx2d(), AUDIO, s.cfg, 1, 1 / 30, null);
  assert.strictEqual(s.stack._coverFloor(AUDIO, s.cfg), 1, 'bitince örter');
  // Ayar değişti: aynı karede örtme kalkar, çizim baştan
  s.cfg.layers[1].reveal = { type: 'fade', duration: 0.6 };
  assert.strictEqual(s.stack._coverFloor(AUDIO, s.cfg), -1);
  let ctx = ctx2d();
  s.stack.drawTo(ctx, AUDIO, s.cfg, 2, 1 / 30, null);
  assert.ok(!ctx.drawn.some((d) => d.name === 'txt'), 'baştan: görünmez');
  s.stack.drawTo(ctx2d(), AUDIO, s.cfg, 3, 1 / 30, null);
  s.cfg.revealReplay = 1;
  ctx = ctx2d();
  s.stack.drawTo(ctx, AUDIO, s.cfg, 3.1, 1 / 30, null);
  assert.ok(!ctx.drawn.some((d) => d.name === 'txt'), 'Açılışı Oynat');
});

test('canlı (CSS) yolu: saydamlık, dönüşüm ve kırpma aynı hesaptan; bitince temizlenir', () => {
  const s = scene({ type: 'scale', duration: 1, ease: 'linear' }, { container: { appendChild() {} } });
  const txt = s.stack.entries[1];
  s.stack.draw(AUDIO, s.cfg, 0, 1 / 60);
  assert.strictEqual(txt.canvas.style.opacity, '0.000');
  s.stack.draw(AUDIO, s.cfg, 0.5, 1 / 60);
  assert.strictEqual(txt.canvas.style.opacity, '0.500');
  // Kutunun merkezi (0.5, 0.85): ötelemeyle tuval ortasından taşınır
  assert.strictEqual(txt.canvas.style.transform, 'translate(0%, 35%) scale(0.925) translate(0%, -35%)');
  s.stack.draw(AUDIO, s.cfg, 1.5, 1 / 60);
  assert.strictEqual(txt.canvas.style.opacity, '');
  assert.strictEqual(txt.canvas.style.transform, '');
  const w = scene({ type: 'wipe', duration: 1, ease: 'linear' }, { container: { appendChild() {} } });
  const we = w.stack.entries[1];
  w.stack.draw(AUDIO, w.cfg, 0, 1 / 60);
  w.stack.draw(AUDIO, w.cfg, 0.5, 1 / 60);
  assert.match(we.canvas.style.clipPath, /^inset\(0% 50% 0% 0%\)$/);
  w.stack.draw(AUDIO, w.cfg, 2, 1 / 60);
  assert.strictEqual(we.canvas.style.clipPath, '');
});

test('bağlantılar: sayfalar modülü yüklüyor, düzen editörü ayarı yazıyor', () => {
  ['src/admin/index.html', 'src/exporter/index.html', 'src/visualizer/index.html'].forEach((f) => {
    const h = read(f);
    assert.ok(h.indexOf('shared/reveal.js') > 0 && h.indexOf('shared/reveal.js') < h.indexOf('layers.js', h.indexOf('logo-runtime.js')), f);
  });
  assert.match(read('src/web/overlay.html'), /\/app\/shared\/reveal\.js/);
  const ed = read('src/admin/layout-editor.js');
  assert.match(ed, /renderReveal\(side, cur\);/);
  assert.match(ed, /cfg\.revealReplay = /);
  // Kayıtlı ayarın yenilenmesi: önbellekteki katman da açılışı görür
  assert.match(read('src/visualizer/layers.js'), /e\._liveCache\.reveal = src\.reveal;/);
});
