'use strict';
/* DİĞER WEBGL YÜZEYLERİ DE BAĞLAM KAYBINDAN DÖNÜYOR (#594).
 *
 * #572 MilkDrop'a kaybolan bağlamdan dönüş yolu verdi. Sürücü sıfırlanınca
 * ya da GPU süreci çökünce ise bütün bağlamlar birden gidiyor: gradyan
 * arkaplan, 3B geometri, shader modları, efekt zincirleri ve projeksiyon
 * haritalaması siyah kalıyordu — MilkDrop altta yeniden çizse bile.
 *
 * Bunların hiçbiri geri besleme ya da birikmiş durum taşımıyor; aynı
 * ayarlarla yeni bir örnek kurmak yetiyor. Her yüzey `contextLost()` ile
 * söylüyor, sahibi (katman yığını ya da görselleştirici) yeniden kuruyor.
 */
global.window = global.window || {};
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
require('../src/shared/defaults.js');
const L = require('../src/visualizer/layers.js');

const ROOT = path.join(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf-8');
const bare = (s) => s.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[^:])\/\/[^\n]*/g, '$1 ');

test('her WebGL yüzeyi bağlamının kaybolduğunu söylüyor', () => {
  const ask = /contextLost\(\) \{\s*return !!\(this\.gl && this\.gl\.isContextLost && this\.gl\.isContextLost\(\)\);/;
  for (const f of ['src/visualizer/modes/gradient.js', 'src/visualizer/modes/geometry3d.js',
    'src/visualizer/modes/shaderhost.js', 'src/visualizer/postfx.js', 'src/visualizer/mapper.js']) {
    assert.match(bare(read(f)), ask, f + ' sormuyor');
  }
  /* Shader modlarının üç sarmalayıcısı da kendi motorlarına soruyor; biri
     unutulsa o mod sessizce siyah kalırdı. */
  const sh = bare(read('src/visualizer/modes/shaderhost.js'));
  const wrappers = (sh.match(/dispose\(\) \{ this\.host\.dispose\(\); \}/g) || []).length;
  const asks = (sh.match(/contextLost\(\) \{ return this\.host\.contextLost\(\); \}/g) || []).length;
  assert.ok(wrappers >= 3, 'sarmalayıcılar bulunamadı');
  assert.strictEqual(asks, wrappers, 'her sarmalayıcı sormalı');
});

test('MilkDrop sorulmuyor: kendini geri kuruyor ve durumunu koruyor', () => {
  /* Katmanı baştan kurmak MilkDrop'un presetini ve denklem durumunu
     atardı; #572 onu yerinde kuruyor. */
  assert.ok(!/contextLost\(\) \{/.test(bare(read('src/visualizer/modes/milkdrop.js'))));
  const stack = new L.LayerStack(null, {});
  assert.strictEqual(stack._lostNow({}, null, {}), false);
});

test('kaybolan yüzey bir kez yeniden kuruluyor, sonra iki saniye bekleniyor', () => {
  /* Kaybolan bağlam kendiliğinden dönmüyor: soru her karede "evet" der.
     GPU süreci daha kalkmadıysa yeni bağlam da hemen kaybolur; her karede
     yeniden kurmak saniyede altmış tuval demekti. */
  const stack = new L.LayerStack(null, {});
  let lost = false;
  const surf = { contextLost: () => lost };
  const holder = {};
  assert.strictEqual(stack._lostNow(surf, null, holder), false, 'sağlam yüzey kurulmamalı');
  lost = true;
  assert.strictEqual(stack._lostNow(surf, null, holder), true);
  assert.strictEqual(stack._lostNow(surf, null, holder), false, 'hemen ikinci kez kuruldu');
  holder._revivedAt -= 2001;
  assert.strictEqual(stack._lostNow(surf, null, holder), true, 'süre dolunca yeniden denenmeli');
  assert.match(bare(read('src/visualizer/layers.js')), /const REVIVE_MS = 2000;/);
});

test('katman YERİNDE yeniden kuruluyor: aynı yer, aynı stil, eski motor atılıyor', () => {
  const stack = new L.LayerStack(null, {});
  const kids = [];
  const parent = {
    insertBefore(n, ref) { kids.splice(kids.indexOf(ref), 0, n); n.parentNode = parent; },
    removeChild(n) { kids.splice(kids.indexOf(n), 1); n.parentNode = null; },
  };
  const canvas = (name) => ({ name, style: { cssText: '' }, className: '', parentNode: null });
  const below = canvas('alttaki'), old = canvas('eski'), above = canvas('üstteki');
  for (const c of [below, old, above]) { kids.push(c); c.parentNode = parent; }
  old.style.cssText = 'position: absolute; z-index: 2; mix-blend-mode: screen; opacity: 0.5;';
  old.className = 'sv-bg sv-bgkey';
  let disposed = 0;
  const e = { layer: { kind: 'background', type: 'gradient' }, key: 'k', canvas: old, ctx: null,
    mode: { dispose() { disposed++; } }, gl: true };
  const freshMode = { dispose() {} };
  stack._create = () => ({ layer: e.layer, key: 'k', canvas: canvas('yeni'), ctx: null, mode: freshMode, gl: true });
  stack._sizeEntry = () => {};
  const same = e;
  stack._revive(e, {});
  assert.strictEqual(e, same, 'giriş nesnesi aynı kalmalı');
  assert.strictEqual(e.mode, freshMode, 'yeni motor');
  assert.strictEqual(disposed, 1, 'eski motor atılmadı');
  assert.deepStrictEqual(kids.map((k) => k.name), ['alttaki', 'yeni', 'üstteki'], 'yeri değişti');
  assert.strictEqual(e.canvas.style.cssText, old.style.cssText, 'stil (z-sırası, karışım) taşınmadı');
  assert.strictEqual(e.canvas.className, 'sv-bg sv-bgkey');
  assert.strictEqual(stack.revived, 1);
});

test('çizim önce soruyor; efekt zincirleri ve haritalama da yeniden kuruluyor', () => {
  const Ls = bare(read('src/visualizer/layers.js'));
  const draw = /_drawEntry\(e, audio, cfg, t, dt, live\) \{[\s\S]*?\n    \}/.exec(Ls)[0];
  const ask = draw.indexOf('if (e.mode && this._lostNow(e.mode, null, e)) this._revive(e, cfg);');
  const raw = draw.indexOf('this._drawEntryRaw(');
  assert.ok(ask > 0 && ask < raw, 'kayıp çizimden ÖNCE sorulmalı');
  // Genel zincir aynı zincirle; katman efekti paylaşılan örnekle
  assert.match(Ls, /const chain = this\.postfx\.chain;[\s\S]{0,160}this\.postfx = new window\.SVPostFX\.PostFX\(\);\s*this\.postfx\.setChain\(chain\);/);
  assert.match(Ls, /if \(this\.layerFx && this\._lostNow\(this\.layerFx, '_layerFxRevivedAt'\)\)/);
  const V = bare(read('src/visualizer/visualizer.js'));
  assert.match(V, /let mapper = new window\.SVMapper\.Mapper\(\);/);
  assert.match(V, /if \(mapper\.contextLost && mapper\.contextLost\(\) && performance\.now\(\) - mapRevivedAt > 2000\)/);
});

test('öz test gradyanın ve efekt zincirinin bağlamını gerçekten kaybettiriyor', () => {
  const M = read('src/main/main.js');
  assert.match(M, /const surfaceProbe = async \(\) => \{/);
  assert.match(M, /context loss \(surfaces\): the gradient background did not come back/);
  assert.match(M, /context loss \(surfaces\): the effect chain did not come back/);
  /* Örnek karenin hemen ardından: bu yüzeylerin çizim tamponu korunmuyor,
     kare gösterildikten sonra okunsa boş görünürdü ve ölçüm yanlış yerden
     düşerdi. */
  assert.match(M, /new Promise\(function \(done\) \{\s*requestAnimationFrame\(function \(\) \{/);
  assert.match(bare(read('src/visualizer/layers.js')), /this\.postfx\.setChain\(chain\);\s*this\.revived = \(this\.revived \|\| 0\) \+ 1;/);
});
