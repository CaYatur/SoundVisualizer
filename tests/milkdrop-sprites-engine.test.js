'use strict';
/* MilkDrop sprite'larının motordaki çizimi (#577).
 *
 * Motorun kendi `_drawSprites`, `_takeSpriteCommands`, `_spriteCommand` ve
 * `_releaseSpriteTex` gövdeleri sahte bir `this` ve kayıt tutan bir GL ile
 * ÇALIŞTIRILIYOR: hangi hedefe kaç kez çizildiği, hangi karışımın
 * kurulduğu ve durumun geri alınıp alınmadığı ölçülüyor.
 */
global.window = global.window || {};
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const M = require('../src/shared/milkdrop.js');
const S = require('../src/shared/milkdrop-sprites.js');

const SRC = fs.readFileSync(path.join(__dirname, '..', 'src', 'visualizer', 'modes', 'milkdrop.js'), 'utf-8')
  .replace(/\r\n/g, '\n');
function method(sig) {
  const i = SRC.indexOf('    ' + sig + ' {');
  assert.ok(i > 0, sig + ' bulunamadı');
  const end = SRC.indexOf('\n    }', i);
  return SRC.slice(i + sig.length + 6, end);
}
const fn = (args, sig) => new Function(...args, method(sig));

// Kayıt tutan GL: sabitler kendi adını veriyor, çağrılar sırayla yazılıyor
function fakeGL() {
  const log = [];
  const gl = new Proxy({}, {
    get(_, k) {
      if (k === 'log') return log;
      if (typeof k === 'string' && /^[A-Z_0-9]+$/.test(k)) return k;
      return (...a) => { log.push([k, ...a]); };
    },
  });
  return gl;
}

function engine(o) {
  const self = Object.assign({
    sprites: null,
    _spriteSeq: 0,
    _spriteWait: [],
    _spriteTex: new Map(),
    _spriteIn: { time: 2, frame: 120, fps: 60, progress: 1, bass: 1, mid: 1, treb: 1, bass_att: 1, mid_att: 1, treb_att: 1 },
    time: 1, frameNo: 60,
    spriteProg: 'PROG', spriteVao: 'VAO', spriteVbo: 'VBO',
    locSprite: { uTex: 'uTex', uCol: 'uCol', uTexAlpha: 'uTexAlpha' },
    _ensureSpriteGL: () => true,
    _spriteTexFor: () => ({ tex: 'TEX', w: 64, h: 64 }),
  }, o || {});
  const take = fn(['SPRITE_WAIT_MS'], '_takeSpriteCommands()');
  self._takeSpriteCommands = () => take.call(self, (o && o.waitMs) || 5000);
  self._spriteCommand = fn(['c'], '_spriteCommand(c)').bind(self);
  self._releaseSpriteTex = fn([], '_releaseSpriteTex()').bind(self);
  self._drawSprites = fn(['gl', 'dst', 'outFb', 'GW', 'GH'], '_drawSprites(gl, dst, outFb, GW, GH)').bind(self);
  return self;
}

const DEF = (init, code) => ({ num: '01', img: 'spr_a', colorkey: 0, init: init || '', code: code || '' });
const launch = (id, init, code, key) => ({ id, op: 'launch', num: '01', key: key || 'spr_a', seed: 7, def: DEF(init, code) });

function withQueue(cmds, f) {
  const saved = { q: window.SVMdSpriteQueue, sp: window.SVMilkdropSprites, md: window.SVMilkdrop };
  window.SVMdSpriteQueue = cmds;
  window.SVMilkdropSprites = S;
  window.SVMilkdrop = M;
  try { return f(); } finally {
    window.SVMdSpriteQueue = saved.q; window.SVMilkdropSprites = saved.sp; window.SVMilkdrop = saved.md;
  }
}

const calls = (gl, name) => gl.log.filter((c) => c[0] === name);
// Her çizimden önce bağlı hedef
function drawTargets(gl) {
  let fb = 'yok';
  const out = [];
  for (const c of gl.log) {
    if (c[0] === 'bindFramebuffer') fb = c[2];
    if (c[0] === 'drawArrays') out.push(fb);
  }
  return out;
}

test('burn açık (varsayılan): önce geri beslemeye, sonra görüntüye; alfa korunuyor', () => {
  withQueue([launch(1)], () => {
    const e = engine();
    const gl = fakeGL();
    e._drawSprites(gl, { fb: 'DST' }, 'OUT', 1920, 1080);
    assert.deepStrictEqual(drawTargets(gl), ['DST', 'OUT']);
    assert.deepStrictEqual(calls(gl, 'blendFunc')[0].slice(1), ['SRC_ALPHA', 'ONE_MINUS_SRC_ALPHA'], 'kip 0: alfa karışımı');
    const masks = calls(gl, 'colorMask').map((c) => c.slice(1));
    assert.deepStrictEqual(masks[0], [true, true, true, false], 'hedefin alfasına dokunulmamalı');
    assert.deepStrictEqual(masks[masks.length - 1], [true, true, true, true], 'maske geri alınmalı');
    // Son bağ görüntü hedefi: flaş sınırlayıcı orada devam ediyor
    const binds = calls(gl, 'bindFramebuffer');
    assert.strictEqual(binds[binds.length - 1][2], 'OUT');
    assert.deepStrictEqual(calls(gl, 'uniform1f')[0].slice(1), ['uTexAlpha', 0], 'kip 0 dokunun alfasını yok sayıyor');
    assert.strictEqual(calls(gl, 'bufferSubData').length, 1);
  });
});

test('burn kapalı: yalnız görüntüye; kiplerin karışımı', () => {
  const run = (init) => withQueue([launch(1, init)], () => {
    const e = engine();
    const gl = fakeGL();
    e._drawSprites(gl, { fb: 'DST' }, 'OUT', 1280, 720);
    return gl;
  });
  const add = run('burn = 0; blendmode = 2;');
  assert.deepStrictEqual(drawTargets(add), ['OUT']);
  assert.deepStrictEqual(calls(add, 'blendFunc')[0].slice(1), ['ONE', 'ONE']);
  const decal = run('burn = 0; blendmode = 1;');
  const beforeDraw = decal.log.slice(0, decal.log.findIndex((c) => c[0] === 'drawArrays'));
  assert.ok(beforeDraw.some((c) => c[0] === 'disable' && c[1] === 'BLEND'), 'decal karışımsız');
  assert.ok(!beforeDraw.some((c) => c[0] === 'enable' && c[1] === 'BLEND'));
  const src = run('burn = 0; blendmode = 3;');
  assert.deepStrictEqual(calls(src, 'blendFunc')[0].slice(1), ['SRC_COLOR', 'ONE_MINUS_SRC_COLOR']);
  const key = run('burn = 0; blendmode = 4; r = 0.5;');
  assert.deepStrictEqual(calls(key, 'uniform1f')[0].slice(1), ['uTexAlpha', 1], 'kip 4 dokunun alfasını kullanıyor');
  const col = calls(key, 'uniform4f')[0];
  assert.ok(Math.abs(col[2] - Math.trunc(0.5 * 255) / 255) < 1e-9, 'renk 8 bite kesilerek');
});

/* Resmi elle yönetilen sahte `_spriteTexFor`: ilk istekte kayıt açıyor
   (bekliyor), test `ready`/`fail` ile sonucunu veriyor. */
function texCtl(e) {
  const state = new Map();
  e._spriteTexFor = (key) => {
    let t = e._spriteTex.get(key);
    if (!t) { t = { tex: null, w: 0, h: 0, failed: false }; e._spriteTex.set(key, t); }
    const s = state.get(key);
    if (s === 'ready') { t.tex = 'T_' + key; t.w = 64; t.h = 64; }
    if (s === 'fail') t.failed = true;
    return t.tex ? t : null;
  };
  return { ready: (k) => state.set(k, 'ready'), fail: (k) => state.set(k, 'fail') };
}

test('başlatma resim hazır olunca: o zamana kadar sprite yok, saati geldiği kareden', () => {
  /* Ölçüldü: sekiz karede ölen bir sprite resmi gelmeden bitiyor ve hiç
     görünmüyordu. MilkDrop resmi başlatırken eşzamanlı yüklüyor. */
  withQueue([launch(1, '', 'n = n + 1;')], () => {
    const e = engine();
    const tc = texCtl(e);
    const gl = fakeGL();
    e._drawSprites(gl, { fb: 'DST' }, 'OUT', 800, 600);
    e._drawSprites(gl, { fb: 'DST' }, 'OUT', 800, 600);
    assert.strictEqual(e.sprites, null, 'resim gelmeden sprite başlamamalı');
    assert.strictEqual(calls(gl, 'drawArrays').length, 0);
    assert.ok(e._spriteTex.has('spr_a'), 'beklenen resim bırakılmamalı');
    tc.ready('spr_a');
    e.frameNo = 100; e.time = 5;
    e._spriteIn = Object.assign({}, e._spriteIn, { frame: 103, time: 5.05 });
    e._drawSprites(gl, { fb: 'DST' }, 'OUT', 800, 600);
    const P = e.sprites.slots[0].pool;
    assert.strictEqual(P.get('n'), 1, 'kod ilk kez resim geldiği karede');
    assert.strictEqual(P.get('frame'), 3, 'saat başlatıldığı kareden');
    close(P.get('time'), 0.05);
    assert.strictEqual(calls(gl, 'drawArrays').length, 2, 'aynı karede çiziliyor (burn + görüntü)');
  });
});

function close(a, b) { assert.ok(Math.abs(a - b) < 1e-9, a + ' / ' + b); }

test('komut sırası korunuyor: bekleyen başlatmanın arkasındaki silme bekliyor', () => {
  withQueue([launch(1), { id: 2, op: 'all' }, launch(3, '', '', 'spr_b')], () => {
    const e = engine();
    const tc = texCtl(e);
    tc.ready('spr_b');
    e._takeSpriteCommands();
    assert.strictEqual(e.sprites, null, '1 bekliyor; 2 ve 3 onun arkasında');
    assert.strictEqual(e._spriteWait.length, 3);
    tc.ready('spr_a');
    e._takeSpriteCommands();
    assert.deepStrictEqual(e.sprites.slots.filter(Boolean).map((s) => s.key), ['spr_b'],
      'sıra: 1 başladı, 2 hepsini sildi, 3 başladı');
  });
});

test('yüklenemeyen ya da süresi dolan başlatma düşüyor, arkası yürüyor', () => {
  withQueue([launch(1), launch(2, '', '', 'spr_b')], () => {
    const e = engine();
    const tc = texCtl(e);
    tc.fail('spr_a');
    tc.ready('spr_b');
    e._takeSpriteCommands();
    assert.deepStrictEqual(e.sprites.slots.filter(Boolean).map((s) => s.key), ['spr_b']);
    assert.strictEqual(e._spriteWait.length, 0);
  });
  withQueue([launch(1)], () => {
    const e = engine({ waitMs: 1 });
    texCtl(e);
    e._takeSpriteCommands();
    assert.strictEqual(e._spriteWait.length, 1, 'ilk bakışta bekliyor');
    const until = Date.now() + 5;
    while (Date.now() < until) { /* süre dolsun */ }
    e._takeSpriteCommands();
    assert.strictEqual(e._spriteWait.length, 0, 'süre dolunca düşmeli');
    assert.strictEqual(e.sprites, null);
  });
});

test('komutlar bir kez uygulanıyor; sonradan kurulan motor eskileri oynatmıyor', () => {
  withQueue([launch(1), launch(2), { id: 3, op: 'kill', num: '01' }, launch(4)], () => {
    const e = engine();
    e._takeSpriteCommands();
    assert.strictEqual(e.sprites.count(), 1, 'iki başlatma, numarayla silme, bir başlatma');
    e._takeSpriteCommands();
    assert.strictEqual(e.sprites.count(), 1, 'ikinci okuma aynı komutları yeniden uygulamamalı');
    const late = engine({ _spriteSeq: 4 });
    late._takeSpriteCommands();
    assert.strictEqual(late.sprites, null, 'kurulmadan önceki komutlar oynatılmamalı');
    window.SVMdSpriteQueue.push({ id: 5, op: 'all' });
    e._takeSpriteCommands();
    assert.strictEqual(e.sprites.count(), 0);
  });
});

test('hiçbir sprite\'ın kullanmadığı doku hemen bırakılıyor', () => {
  withQueue([launch(1, '', '', 'spr_a'), launch(2, '', 'done = 1;', 'spr_b')], () => {
    const gl = fakeGL();
    const e = engine({ gl });
    e._spriteTex.set('spr_a', { tex: 'TA', w: 1, h: 1 });
    e._spriteTex.set('spr_b', { tex: 'TB', w: 1, h: 1 });
    e._spriteTex.set('spr_eski', { tex: 'TC', w: 1, h: 1 });
    e._drawSprites(gl, { fb: 'DST' }, 'OUT', 800, 600);
    assert.deepStrictEqual([...e._spriteTex.keys()], ['spr_a'], 'done yazan ve kimsenin kullanmadığı gitmeli');
    assert.deepStrictEqual(calls(gl, 'deleteTexture').map((c) => c[1]).sort(), ['TB', 'TC']);
  });
});

test('çizim yerinde: birleştirmeden sonra, flaş sınırlayıcıdan önce; bağlam kaybı ve atma', () => {
  const d = SRC.indexOf('this._drawSprites(gl, dst, fl ? fl.raw.fb : null, GW, GH);');
  const comp = SRC.lastIndexOf('this._drawCompPass(gl, dst, this.compPreset, ctx);', d);
  const flash = SRC.indexOf('if (fl) this._flashPass(gl, fl, GW, GH, step);', d);
  assert.ok(d > 0 && comp > 0 && comp < d && flash > d, 'sıra: birleştirme → sprite → flaş');
  const names = /const GL_NAMES = \[([\s\S]*?)\];/.exec(SRC)[1];
  for (const n of ['spriteVao', 'spriteVbo', 'spriteProg']) assert.ok(names.includes("'" + n + "'"), n + ' envanterde yok');
  const forget = method('_forgetGL()');
  assert.match(forget, /this\._spriteTex = new Map\(\);/);
  // Bekleyen başlatmalar yeni bağlamda baştan bekliyor
  assert.match(forget, /if \(this\._spriteWait\) for \(const w of this\._spriteWait\) w\.at = 0;/);
  const disp = method('dispose()');
  assert.match(disp, /gl\.deleteProgram\(this\.spriteProg\)/);
  assert.match(disp, /for \(const t of this\._spriteTex\.values\(\)\) if \(t\.tex\) gl\.deleteTexture\(t\.tex\);/);
  // Sprite'ın `progress`i harmanın ilerlemesi, presetin ömrü değil
  assert.match(SRC, /progress: this\.oldPreset \? this\.blendProg : 1,/);
});
