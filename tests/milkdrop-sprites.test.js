'use strict';
/* MILKDROP SPRITE'LARI (#577) — ini, yuvalar, kod ve dörtgen.
 *
 * Korpusta tek bir milk_img.ini yok (#560'ın 2. maddesi de bu yüzden
 * doğrulanamamıştı). Testler kendi yazdığımız ini'yle ve MilkDrop'un
 * kaynağından türetilmiş davranışla karşılaştırıyor: modülün saf kısmı —
 * ayrıştırma, yuva seçimi, kodun çalışma sırası, dörtgenin köşeleri ve
 * karışım kiplerinin rengi.
 */
global.window = global.window || {};
const test = require('node:test');
const assert = require('node:assert');
const M = require('../src/shared/milkdrop.js');
const S = require('../src/shared/milkdrop-sprites.js');

const close = (a, b, msg, eps = 1e-6) => assert.ok(Math.abs(a - b) < eps, (msg || '') + ': ' + a + ' / ' + b);
const INP = { time: 0, frame: 0, fps: 60, progress: 1, bass: 1, mid: 1, treb: 1, bass_att: 1, mid_att: 1, treb_att: 1 };
const at = (time, frame, o) => Object.assign({}, INP, { time, frame }, o || {});

const INI = [
  '\uFEFF/* uzun bir açıklama; ilk başlıktan önceki her şey yok sayılır',
  '   init_1=bu satır hiçbir bölüme ait değil */',
  '; noktalı virgül yorum',
  '[img07]',
  'desc="yavaş dönen logo"',
  'img=logo.png',
  'colorkey_lo=0x00FF00',
  'colorkey=0x0000FF',
  'init_1=blendmode = 2;  // yorum',
  'init_2=spin = 0.5; \\\\ eski usul yorum',
  'code_1=rot = time*spin;',
  'code_2=',
  'code_3=a = 0.5;',
  'code_5=a = 0.1;',
  'IMG=ikinci.png',
  '[IMG8]',
  'Img=resimler\\sekiz.jpg',
  'colorkey_lo=255',
  '[img100]',
  'img=gecersiz.png',
  '[img09]',
  'code_1=x = 0.2;',
].join('\r\n');

// ------------------------------------------------------------------ ini

test('ini: bölümler, anahtarlar ve kod satırları MilkDrop gibi okunuyor', () => {
  const { defs, errors } = S.parseImgIni(INI);
  assert.deepStrictEqual([...defs.keys()].sort(), ['07', '08', '09']);
  const d = defs.get('07');
  assert.strictEqual(d.img, 'logo.png', 'aynı anahtar iki kez: İLKİ geçerli');
  assert.strictEqual(d.desc, 'yavaş dönen logo', 'tırnak atılmalı');
  assert.strictEqual(d.colorkey, 0x0000FF, 'colorkey, colorkey_lo\'yu ezer');
  // Yorumlar atılıyor; `code_4` yok, `code_5` okunmuyor; boş `code_2` eksik sayılmıyor
  assert.strictEqual(d.init, 'blendmode = 2;  \nspin = 0.5; ');
  assert.strictEqual(d.code, 'rot = time*spin;\n\na = 0.5;');
  // Başlık harfi, tek haneli numara, onluk renk anahtarı
  assert.strictEqual(defs.get('08').img, 'resimler\\sekiz.jpg');
  assert.strictEqual(defs.get('08').colorkey, 255);
  assert.strictEqual(defs.get('09').img, '');
  assert.deepStrictEqual(errors, ['09: img yok']);
  assert.ok(!defs.has('100'), '99\'dan büyük numara yok');
});

test('ini: renk anahtarı yoksa siyah, okunamazsa varsayılan', () => {
  assert.strictEqual(S.parseImgIni('[img00]\nimg=a.png').defs.get('00').colorkey, 0);
  assert.strictEqual(S.iniInt('0xFFFFFF', 7), 0xFFFFFF);
  assert.strictEqual(S.iniInt(' 12abc', 7), 12, 'sayı bittiği yerde duruyor');
  assert.strictEqual(S.iniInt('abc', 7), 7);
  assert.strictEqual(S.iniInt(undefined, 7), 7);
  assert.strictEqual(S.spriteNum('7'), '07');
  assert.strictEqual(S.spriteNum(99), '99');
  assert.strictEqual(S.spriteNum('100'), null);
  assert.strictEqual(S.spriteNum('-1'), null);
});

// ---------------------------------------------------------------- yuvalar

const def = (num, init, code) => ({ num, img: 'a.png', colorkey: 0, init: init || '', code: code || '', desc: '' });

test('başlatma: çıktılar varsayılanda, başlatma kodu bir kez ve kare girdisi görmeden', () => {
  const set = new S.SpriteSet(M);
  set.launch(def('01', 'seen_t = time; seen_x = x; seen_burn = burn; n = n + 1;', 'n = n + 1;'),
    { seed: 5, time: 10, frame: 600 });
  const P = set.slots[0].pool;
  assert.strictEqual(P.get('seen_t'), 0, 'başlatma kodu kare girdisini görmemeli');
  assert.strictEqual(P.get('seen_x'), 0.5, 'varsayılan x');
  assert.strictEqual(P.get('seen_burn'), 1, 'burn 1\'den başlıyor');
  assert.strictEqual(P.get('n'), 1);
  const [d] = set.step(at(12.5, 750));
  assert.strictEqual(P.get('time'), 2.5, 'time başlatmadan beri');
  assert.strictEqual(P.get('frame'), 150, 'frame başlatmadan beri');
  assert.strictEqual(P.get('n'), 2, 'başlatma kodu yeniden çalışmamalı');
  assert.strictEqual(d.x, 0.5); assert.strictEqual(d.sx, 1); assert.strictEqual(d.a, 1);
  assert.strictEqual(d.blendmode, 0); assert.strictEqual(d.burn, true); assert.strictEqual(d.done, false);
});

test('çıktılar kareden kareye kalıyor; done yazan sprite son kez çiziliyor ve gidiyor', () => {
  const set = new S.SpriteSet(M);
  set.launch(def('02', '', 'x = x + 0.1; done = above(frame, 1);'), { seed: 1, time: 0, frame: 0 });
  close(set.step(at(0, 0))[0].x, 0.6, 'ilk kare');
  close(set.step(at(0, 1))[0].x, 0.7, 'ikinci kare kalıcı değerden');
  const last = set.step(at(0, 2));
  assert.strictEqual(last.length, 1, 'done karesinde son kez çiziliyor');
  assert.strictEqual(last[0].done, true);
  assert.strictEqual(set.count(), 0, 'sonra atılıyor');
  assert.deepStrictEqual(set.step(at(0, 3)), []);
});

test('en fazla 16 sprite; dolunca EN ESKİ başlatılanın yerine', () => {
  const set = new S.SpriteSet(M);
  for (let i = 0; i < 16; i++) assert.strictEqual(set.launch(def(String(i).padStart(2, '0')), { frame: 100 + i }), i);
  // Başlama karesi en küçük olan (yuva 0) atılıyor
  assert.strictEqual(set.launch(def('50'), { frame: 200 }), 0);
  assert.strictEqual(set.slots[0].num, '50');
  // Şimdi en eski yuva 1
  assert.strictEqual(set.launch(def('51'), { frame: 201 }), 1);
  // Aynı karede başlatılanlardan düşük numaralı yuva
  const tie = new S.SpriteSet(M);
  for (let i = 0; i < 16; i++) tie.launch(def('01'), { frame: 5 });
  assert.strictEqual(tie.launch(def('02'), { frame: 5 }), 0);
  assert.strictEqual(new S.SpriteSet(M).launch({ num: '03', img: '' }, {}), -1, 'resimsiz tanım başlamamalı');
});

test('silme: numarayla hepsi, en yeni, en eski, hepsi', () => {
  const set = new S.SpriteSet(M);
  set.launch(def('05'), { frame: 1 });
  set.launch(def('06'), { frame: 2 });
  set.launch(def('05'), { frame: 3 });
  set.launch(def('07'), { frame: 4 });
  set.killNum('05');
  assert.deepStrictEqual(set.slots.filter(Boolean).map((s) => s.num), ['06', '07']);
  set.killNewest();
  assert.deepStrictEqual(set.slots.filter(Boolean).map((s) => s.num), ['06']);
  set.launch(def('08'), { frame: 5 });
  set.killOldest();
  assert.deepStrictEqual(set.slots.filter(Boolean).map((s) => s.num), ['08']);
  set.killAll();
  assert.strictEqual(set.count(), 0);
});

test('rand tohumdan: aynı tohum her ekranda aynı sayılar, başka tohum başka', () => {
  const run = (seed) => {
    const set = new S.SpriteSet(M);
    set.launch(def('10', 'v0 = rand(1000);', 'v = rand(1000);'), { seed });
    const P = set.slots[0].pool;
    const out = [P.get('v0')];
    for (let f = 0; f < 5; f++) { set.step(at(f / 60, f)); out.push(P.get('v')); }
    return out;
  };
  assert.deepStrictEqual(run(42), run(42));
  assert.notDeepStrictEqual(run(42), run(43));
});

test('kod hatası sprite\'ı durdurmuyor, uyarı olarak kalıyor', () => {
  const set = new S.SpriteSet(M);
  assert.strictEqual(set.launch(def('11', 'x = ;', 'y = 0.3;'), { seed: 1 }), 0);
  assert.ok(set.slots[0].warn, 'uyarı kaydedilmeli');
  close(set.step(at(0, 0))[0].y, 0.3, 'kodun geri kalanı çalışmalı');
});

test('çıktılar MilkDrop\'un sınırlarıyla kenetleniyor', () => {
  const set = new S.SpriteSet(M);
  set.launch(def('12', '', 'x = 5000; sx = -5000; repeatx = 0; repeaty = 500; r = 2; g = -1; a = 1.5; blendmode = 3.9; flipx = 0.01;'), {});
  const [d] = set.step(at(0, 0));
  assert.strictEqual(d.x, 1000); assert.strictEqual(d.sx, -1000);
  assert.strictEqual(d.repeatx, 0.01); assert.strictEqual(d.repeaty, 100);
  assert.strictEqual(d.r, 1); assert.strictEqual(d.g, 0); assert.strictEqual(d.a, 1);
  assert.strictEqual(d.blendmode, 3, 'kip kesiliyor, yuvarlanmıyor');
  assert.strictEqual(d.flipx, true, 'sıfır dışı her değer açık');
  set.launch(def('13', '', 'blendmode = 9;'), {});
  assert.strictEqual(set.step(at(0, 0))[1].blendmode, 4);
});

// ---------------------------------------------------------------- dörtgen

const D = (o) => Object.assign({ x: 0.5, y: 0.5, sx: 1, sy: 1, rot: 0, flipx: false, flipy: false, repeatx: 1, repeaty: 1 }, o || {});
const corner = (q, k) => [q[k * 4], q[k * 4 + 1], q[k * 4 + 2], q[k * 4 + 3]];

test('dörtgen: kare resim geniş ekranda genişliğe göre, pikselde kare', () => {
  const q = S.spriteQuad(D(), 256, 256, 1920, 1080);
  const A = 1920 / 1080;
  // sol üst: x -1, y +A (GL'de yukarı), doku (0,0): resmin üst satırı üstte
  assert.deepStrictEqual(corner(q, 0).map((v) => +v.toFixed(5)), [-1, +A.toFixed(5), 0, 0]);
  assert.deepStrictEqual(corner(q, 3).map((v) => +v.toFixed(5)), [1, -(+A.toFixed(5)), 1, 1]);
  // Piksel ölçüsünde genişlik = yükseklik
  const wPx = (corner(q, 1)[0] - corner(q, 0)[0]) / 2 * 1920;
  const hPx = (corner(q, 0)[1] - corner(q, 2)[1]) / 2 * 1080;
  close(wPx, hPx, 'kare kalmalı', 1e-3);
});

test('dörtgen: y 0 ÜSTTE, x 0 SOLDA; geniş ve uzun resim en-boyunu koruyor', () => {
  const top = S.spriteQuad(D({ x: 0.25, y: 0.1, sx: 0.1, sy: 0.1 }), 100, 100, 1000, 1000);
  const cy = (top[1] + top[9]) / 2, cx = (top[0] + top[4]) / 2;
  close(cy, 0.8, 'y=0,1 üstte (GL +0,8)');
  close(cx, -0.5, 'x=0,25 solda');
  // 2:1 resim kare ekranda: yükseklik yarı
  const wide = S.spriteQuad(D(), 200, 100, 800, 800);
  close(wide[1], 0.5, 'geniş resim: y ±0,5'); close(wide[0], -1, 'x ±1');
  // 1:2 resim: genişlik yarı
  const tall = S.spriteQuad(D(), 100, 200, 800, 800);
  close(tall[0], -0.5, 'uzun resim: x ±0,5'); close(tall[1], 1, 'y ±1');
  // Dar ekran (dikey): x'ler W/H'ye bölünüyor
  const port = S.spriteQuad(D(), 100, 100, 1080, 1920);
  close(port[0], -1920 / 1080, 'dikey ekranda x genişliyor'); close(port[1], 1);
});

test('dörtgen: pozitif açı ekranda saat yönünde (kaynak), çevirme köşeleri takas ediyor', () => {
  /* Sağ üst köşenin konumunu izle: saat yönünde çeyrek turda sağ alta
     gidiyor. GL'de y yukarı: sağ alt (+x, -y). */
  const q = S.spriteQuad(D({ rot: Math.PI / 2, sx: 0.5, sy: 0.5 }), 64, 64, 1000, 1000);
  const tr = corner(q, 1);
  close(tr[0], 0.5); close(tr[1], -0.5, 'sağ üst köşe sağ alta dönmeli');
  const fx = S.spriteQuad(D({ flipx: true }), 64, 64, 1000, 1000);
  close(fx[0], 1, 'flipx: sol üst köşe sağda'); assert.strictEqual(fx[2], 0, 'doku köşeye bağlı kalıyor');
  const fy = S.spriteQuad(D({ flipy: true }), 64, 64, 1000, 1000);
  close(fy[1], -1, 'flipy: üst köşe altta'); assert.strictEqual(fy[3], 0);
});

test('dörtgen: geniş ekranda y KONUMU da en-boyla ölçekleniyor', () => {
  /* MilkDrop ekran genişliğine normalleştirmeyi ötelemeden SONRA yapıyor.
     Ölçüldü: 1920x1080'de y = 0,25'e konan küçük bir sprite ekranın
     yüzde 25'inde değil, üst kenara yakın (%5,6) çıktı. */
  const A = 1920 / 1080;
  const q = S.spriteQuad(D({ x: 0.25, y: 0.25, sx: 0.01, sy: 0.01 }), 64, 64, 1920, 1080);
  close((q[1] + q[9]) / 2, -(2 * 0.25 - 1) * A, 'y merkezi W/H ile ölçekli');
  close((q[0] + q[4]) / 2, -0.5, 'x ölçeklenmiyor');
  // Görünen dikey aralık 0,5 ± 0,5·H/W
  const top = S.spriteQuad(D({ y: 0.5 - 0.5 / A, sx: 0.001, sy: 0.001 }), 64, 64, 1920, 1080);
  close((top[1] + top[9]) / 2, 1, 'görünen üst kenar', 1e-4);
});

test('dörtgen: tekrar merkezden büyüyor', () => {
  const q = S.spriteQuad(D({ repeatx: 3, repeaty: 0.5 }), 64, 64, 1000, 1000);
  assert.deepStrictEqual([q[2], q[3], q[14], q[15]], [-1, 0.25, 2, 0.75]);
});

// ------------------------------------------------------------- karışım

test('karışım kipleri: köşe rengi, doku alfası ve karışım', () => {
  const c = (o) => S.spriteColor(Object.assign({ r: 1, g: 0.5, b: 0.25, a: 0.5, blendmode: 0 }, o), M);
  const q = (v) => Math.trunc(v * 255) / 255;
  assert.deepStrictEqual(c({}), { mode: 0, color: [1, q(0.5), q(0.25), q(0.5)], blend: 'alpha', texAlpha: false });
  assert.deepStrictEqual(c({ blendmode: 1 }), { mode: 1, color: [q(0.5), q(0.25), q(0.125), 1], blend: null, texAlpha: false });
  assert.deepStrictEqual(c({ blendmode: 2 }).color, [q(0.5), q(0.25), q(0.125), 1]);
  assert.strictEqual(c({ blendmode: 2 }).blend, 'add');
  assert.deepStrictEqual(c({ blendmode: 3 }), { mode: 3, color: [1, 1, 1, 1], blend: 'srccolor', texAlpha: false });
  assert.deepStrictEqual(c({ blendmode: 4 }), { mode: 4, color: [1, q(0.5), q(0.25), q(0.5)], blend: 'alpha', texAlpha: true });
});

// ------------------------------------------------------------ tuşlar

test('tuşlar: K + iki hane başlatıyor, SHIFT+K + iki hane siliyor', () => {
  const keys = (list) => {
    let st = null;
    const cmds = [];
    for (const k of list) {
      const r = S.spriteKey(st, typeof k === 'string' ? { key: k } : k);
      st = r.st;
      if (r.cmd) cmds.push(r.cmd);
    }
    return { st, cmds };
  };
  assert.deepStrictEqual(keys(['k', '0', '7']).cmds, [{ op: 'launch', num: '07' }]);
  assert.deepStrictEqual(keys([{ key: 'K', shift: true }, '1', '2']).cmds, [{ op: 'kill', num: '12' }]);
  // İki haneden sonra kip kapanıyor: üçüncü rakam bir şey yapmıyor
  const after = keys(['k', '0', '7', '3']);
  assert.deepStrictEqual(after.cmds, [{ op: 'launch', num: '07' }]);
  assert.strictEqual(after.st.mode, '');
  // * haneleri temizliyor, ESC kipten çıkarıyor
  assert.deepStrictEqual(keys(['k', '0', '*', '4', '5']).cmds, [{ op: 'launch', num: '45' }]);
  assert.deepStrictEqual(keys(['k', '0', 'Escape', '4', '5']).cmds, []);
  // Kip dışında rakam ve DELETE hiçbir şey yapmıyor ve tüketilmiyor
  const idle = S.spriteKey(null, { key: '5' });
  assert.strictEqual(idle.cmd, null); assert.strictEqual(idle.used, false);
  assert.strictEqual(S.spriteKey(null, { key: 'Delete' }).used, false);
  assert.strictEqual(S.spriteKey(null, { key: 'Delete' }).cmd, null, 'kip dışında DELETE silmemeli');
  assert.strictEqual(S.spriteKey(null, { key: 'Escape' }).used, false, 'kip dışında ESC pencerenin');
});

test('tuşlar: sprite kipinde DELETE en yeni, SHIFT en eski, CTRL+SHIFT hepsi; CTRL+K hepsi', () => {
  const inMode = S.spriteKey(null, { key: 'k' }).st;
  assert.deepStrictEqual(S.spriteKey(inMode, { key: 'Delete' }).cmd, { op: 'newest' });
  assert.deepStrictEqual(S.spriteKey(inMode, { key: 'Delete', shift: true }).cmd, { op: 'oldest' });
  assert.deepStrictEqual(S.spriteKey(inMode, { key: 'Delete', shift: true, ctrl: true }).cmd, { op: 'all' });
  assert.strictEqual(S.spriteKey(inMode, { key: 'Delete' }).st.mode, 'launch', 'kipte kalıyor');
  // Silme kipinde DELETE yok (MilkDrop'ta da sprite kipine ait)
  const killMode = S.spriteKey(null, { key: 'K', shift: true }).st;
  assert.strictEqual(S.spriteKey(killMode, { key: 'Delete' }).cmd, null);
  assert.deepStrictEqual(S.spriteKey(null, { key: 'k', ctrl: true }).cmd, { op: 'all' });
});

test('kuyruk: sıralı, kısa, yinelenen ya da eski komutu almıyor', () => {
  const saved = { q: window.SVMdSpriteQueue, s: window.SVMdSpriteSeq, l: window.__svMdSpriteListen };
  try {
    window.SVMdSpriteQueue = [];
    window.SVMdSpriteSeq = 0;
    window.__svMdSpriteListen = false;
    let cb = null;
    assert.strictEqual(S.listen({ onMdSprite: (f) => { cb = f; } }), true);
    assert.strictEqual(S.listen({ onMdSprite: () => { throw new Error('ikinci kez dinlememeli'); } }), true);
    cb({ id: 1, op: 'all' });
    cb({ id: 1, op: 'all' });
    cb({ id: 0, op: 'all' });
    cb(null);
    assert.deepStrictEqual(window.SVMdSpriteQueue.map((c) => c.id), [1]);
    for (let i = 2; i <= 100; i++) cb({ id: i, op: 'all' });
    assert.strictEqual(window.SVMdSpriteQueue.length, S.QUEUE_MAX);
    assert.strictEqual(window.SVMdSpriteQueue[0].id, 100 - S.QUEUE_MAX + 1);
    assert.strictEqual(window.SVMdSpriteSeq, 100);
    assert.strictEqual(S.listen({}), false, 'köprüsü olmayan sayfa');
  } finally {
    window.SVMdSpriteQueue = saved.q; window.SVMdSpriteSeq = saved.s; window.__svMdSpriteListen = saved.l;
  }
});

test('renk anahtarı yalnız TAM eşit pikselleri saydam siyah yapıyor', () => {
  const px = new Uint8Array([
    0, 0, 255, 255, // anahtar
    0, 0, 254, 255, // bir birim yakın: kalıyor
    10, 20, 30, 128, // resmin kendi alfası kalıyor
    0, 0, 255, 7, // anahtar, alfası ne olursa olsun
  ]);
  assert.strictEqual(S.applyColorKey(px, 0x0000FF), 2);
  assert.deepStrictEqual(Array.from(px), [0, 0, 0, 0, 0, 0, 254, 255, 10, 20, 30, 128, 0, 0, 0, 0]);
});
