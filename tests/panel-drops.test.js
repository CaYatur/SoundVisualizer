'use strict';
/* ANLIK DÜŞÜŞLER (#905). Kullanıcı: preset ya da katman ayarı hızla değişirken, katmanlar arasında
   gezinirken anlık fps düşüşleri; zaman çizelgesinde MilkDrop geçişinde anlık "git gel".
   Ölçülen nedenler ve düzeltmeler (7 katmanlı gerçek sahne, panel ve çıkış aynı anda açık):
     - Her ayar değişiminde üst çubuktaki sayfa sekmeleri baştan kuruluyor, üst çubuk kendini
       altı düzeyde yeniden ölçüyordu; ayar işaretleri hiçbir şey değişmese de iki kez yerleşim
       okuyordu; önizleme kutusunu yeniden ölçüyordu. Kaydırıcı sürüklerken panel 33,6 → 59,6 fps,
       opaklık sürüklerken 37 → 74 fps.
     - Katman seçiminde alt raf (kitaplık) her seçimde baştan kuruluyordu: 52 → 64 fps.
     - Uyarlanır çözünürlük basamağında MilkDrop'un flaş sınırlayıcısı "önceki kare"yi siyah
       kuruyordu: basamaktan sonra parlaklık 68 → 10 → 20 → 31 → 51 → 62 → 75 (beş kare karanlık).
       Düşüş olunca basamak iniyordu, kullanıcının gördüğü "git gel" buydu. */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const read = (p) => fs.readFileSync(path.join(__dirname, '..', p), 'utf8').replace(/\r\n/g, '\n');

test('üst çubuk: şimdiki düzeyden aranıyor, fitLevel ile aynı sonuç, çok daha az ölçüm', () => {
  const FIT = require('../src/admin/topbar-fit.js');
  for (let need = 0; need <= 6; need++) {
    const collides = (lv) => lv < need;
    for (let cur = 0; cur <= 6; cur++) {
      let n = 0;
      const lv = FIT.fitFrom((x) => { n++; return collides(x); }, cur);
      assert.strictEqual(lv, FIT.fitLevel(collides), 'gerek ' + need + ', şimdiki ' + cur);
      if (cur === need) assert.ok(n <= 2, 'düzey değişmiyorsa en çok iki ölçüm: ' + n);
    }
  }
  const src = read('src/admin/topbar-fit.js');
  assert.match(src, /attributeFilter: \['hidden', 'class'\]/, '`disabled` genişliği değiştirmiyor, ölçüm tetiklemiyor');
});

test('ayar işaretleri: değişen yoksa yerleşim okunmuyor; rozet metni aynıysa yazılmıyor', () => {
  const a = read('src/admin/admin.js');
  const fn = a.slice(a.indexOf('  function refreshModifiedMarks() {'), a.indexOf('  function setAdvanced(on) {'));
  const early = fn.indexOf('if (!writes.length) return;');
  assert.ok(early > 0, 'erken dönüş');
  assert.ok(fn.indexOf('pinElement(root)') > early, 'sabitleme öğesi yalnız yazılacak bir şey varsa ölçülüyor');
  assert.ok(fn.indexOf('getBoundingClientRect') > early);
  assert.match(fn, /if \(chip\.textContent !== String\(n\)\) writes\.push/);
  assert.match(fn, /if \(node\.classList\.contains\('modified'\) !== mod\) writes\.push/);
});

test('sayfa sekmeleri ve kurulum ağacı yalnız içerikleri değişince kuruluyor', () => {
  const a = read('src/admin/admin.js');
  assert.match(a, /if \(tabs && \(tabsSig !== navTabsSig \|\| tabs\.childElementCount !== tabCats\.length\)\) \{\s*navTabsSig = tabsSig;\s*tabs\.replaceChildren/);
  assert.match(a, /if \(railSig === navRailSig && rail\.childElementCount\) return;/);
});

test('önizleme: her ayar değişiminde kutu yeniden ölçülmüyor', () => {
  const p = read('src/admin/preview.js');
  const set = p.slice(p.indexOf('  function setConfig(next) {'), p.indexOf('  function ingest(f) {'));
  assert.doesNotMatch(set, /resize\(true\)/, 'setConfig bilinen boyutu kullanıyor');
  assert.match(set, /resize\(true, true\);\s*drawOnce\(\);/);
  assert.match(p, /if \(known && lastW > 0 && lastH > 0\) \{\s*w = lastW;\s*h = lastH;/);
});

test('raf: kilit imzada değil, kart ve kap yerinde takılıp çıkarılıyor', () => {
  const s = read('src/admin/scene-shell.js');
  assert.match(s, /const lockSig = '';/);
  assert.match(s, /function applyLock\(body, lock\) \{/);
  assert.match(s, /body\._svLockKey = '';\s*applyLock\(body, shelfLock\(\)\);/, 'raf kurulunca');
  assert.match(s, /applyLock\(host\.querySelector\('\[data-shelf-body\]'\), shelfLock\(\)\);/, 'her eşitlemede');
  assert.match(s, /const x = selected\(\);\s*if \(!x \|\| x\.locked\) return;/, 'düğme tıklandığı anda seçili katmanı okuyor');
});

test('MilkDrop: flaş sınırlayıcının önceki karesi boyut değişiminde taşınıyor', () => {
  const m = read('src/visualizer/modes/milkdrop.js');
  assert.match(m, /this\._flashCarry = this\.flash\.prev;\s*this\.flash\.prev = null;/);
  assert.match(m, /if \(this\._flashCarry\) \{\s*this\._carryTarget\(this\._flashCarry, this\.flash\.prev\);\s*this\._flashCarry = null;/);
  // Taşıma mipmap üretiminden ÖNCE: ortalama taşınan kareden hesaplanıyor
  const ens = m.slice(m.indexOf('    _ensureFlash(W, H) {'));
  assert.ok(ens.indexOf('this._carryTarget(this._flashCarry') < ens.indexOf('gl.generateMipmap(gl.TEXTURE_2D);'));
});

test('ekran efektleri: iz geçmişi boyut değişiminde taşınıyor', () => {
  const p = read('src/visualizer/postfx.js');
  const rs = p.slice(p.indexOf('    resize(w, h) {'), p.indexOf('    _makeTarget(W, H) {'));
  assert.match(rs, /const old = gl && this\.prevFbo && this\.fbo\[0\]/);
  assert.match(rs, /gl\.blitFramebuffer\(0, 0, old\.w, old\.h, 0, 0, W, H, gl\.COLOR_BUFFER_BIT, gl\.LINEAR\);/);
  assert.ok(rs.indexOf('this._allocate();') < rs.indexOf('blitFramebuffer'), 'yeni hedefe kopyalanıyor');
});

test('zaman çizelgesi: geçişsiz klip tek çizimle basılıyor (dört tam ekran kopya yok)', () => {
  const { Renderer } = require('../src/visualizer/timeline-render.js');
  const calls = [];
  let seq = 0;
  const canvas = () => {
    const c = { id: ++seq, width: 0, height: 0 };
    const ctx = { canvas: c, save() {}, restore() {}, setTransform() {}, clearRect() {}, fillRect() {}, drawImage(img) { calls.push([c.id, img.id, this.globalAlpha]); } };
    c.getContext = () => ctx;
    return c;
  };
  const r = new Renderer({
    canvas,
    compositor: () => ({ compose() { calls.push(['compose']); } }),
    stack: () => ({ width: 0, height: 0, setConfig() {}, setPostFX() {}, syncMedia() {}, resize(w, h) { this.width = w; this.height = h; },
      _ensureComp() { if (!this.compCanvas) { this.compCanvas = canvas(); this.compCtx = this.compCanvas.getContext(); } }, drawTo() {}, dispose() {} }),
  });
  const out = canvas().getContext();
  const u = (id, op, tr) => ({ id, opacity: op, localTime: 0, cfg: { layers: [], postfx: [] }, transition: tr || null });
  r.draw(out, { units: [u('a', 1), u('b', 0.4)], time: 1 }, {}, 0, 0.016, 64, 32);
  assert.deepStrictEqual(calls.map((c) => c[0] === 'compose' ? 'compose' : (c[0] === out.canvas.id ? 'out' : 'kopya')), ['out', 'out'], 'iki klip, iki çizim');
  assert.deepStrictEqual(calls.map((c) => c[2]), [1, 0.4], 'klip saydamlığıyla');
  calls.length = 0;
  r.draw(out, { units: [u('a', 1), u('b', 1, { type: 'crossfade', p: 0.5, params: {} })], time: 1 }, {}, 0, 0.016, 64, 32);
  assert.ok(calls.some((c) => c[0] === 'compose'), 'geçişte birleştirici yine çalışıyor');
});

test('geçişin sonunda giden sahne kareden sonra atılıyor (kapsayıcılı yığında)', () => {
  const l = read('src/visualizer/layers.js');
  const end = l.slice(l.indexOf('    endTransition() {'), l.indexOf('    tbar(m) {'));
  assert.match(end, /if \(this\.container && gone\.length && typeof setTimeout === 'function'\)/);
  assert.match(end, /\} else \{\s*for \(const e of gone\) out\._disposeEntry\(e\);/, 'kapsayıcısız (dışa aktarım, test) hemen');
});
