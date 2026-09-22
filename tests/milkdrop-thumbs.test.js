'use strict';
/* MILKDROP KÜÇÜK RESİMLERİ (#575). Her preset bir kez, gizli bir pencerede
 * küçük çiziliyor ve kullanıcı verisinde saklanıyor; panelde ızgara.
 *
 * Reçete ölçüldü (korpustan tohumlu 200 preset, bkz. src/main/milkdrop-thumbs.js):
 * siyah tampondan 60 kare, 640x360 çizilip 256x144 WebP. Aynı preset hangi
 * presetten sonra çizilirse çizilsin aynı baytlar (8/8).
 */
global.window = global.window || {};
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const vm = require('vm');
const T = require('../src/main/milkdrop-thumbs.js');
const TEX = require('../src/main/milkdrop-textures.js');
require('../src/shared/defaults.js');
const L = require('../src/shared/milkdrop-library.js');

const ROOT = path.join(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf-8');
const bare = (s) => s.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[^:])\/\/[^\n]*/g, '$1 ');
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
/* Koşul gerçekleşene kadar yokla. Sabit bir bekleme panelin 80 ms'lik
   toplama zamanlayıcısıyla yarışırdı: Windows'ta zamanlayıcı ~15,6 ms'de
   bir işliyor, yüklü bir CI makinesinde daha da geç. */
async function until(fn, ms) {
  const end = Date.now() + (ms || 3000);
  for (;;) {
    const v = fn();
    if (v || Date.now() > end) return v;
    await wait(10);
  }
}

const made = [];
test.after(() => { for (const d of made) fs.rmSync(d, { recursive: true, force: true }); });
function tmpDir() {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'sv-thumb-'));
  made.push(d);
  return d;
}
const K = (c) => c.repeat(40).slice(0, 40); // geçerli biçimde anahtar

// ---------------------------------------------------------------- reçete

test('reçete: ölçülen değerler; sayfa betikleri listedekiyle aynı sırada', () => {
  assert.deepStrictEqual(
    [T.RECIPE.renderW, T.RECIPE.renderH, T.RECIPE.frames, T.RECIPE.fps, T.RECIPE.thumbW, T.RECIPE.thumbH],
    [640, 360, 60, 30, 256, 144]);
  const html = read('src/thumbs/index.html');
  const scripts = Array.from(html.matchAll(/<script src="([^"]+)"><\/script>/g))
    .map((m) => path.posix.join('src/thumbs', m[1]));
  assert.deepStrictEqual(['src/thumbs/index.html'].concat(scripts), T.PAGE_FILES.slice(),
    'reçetenin özeti sayfanın GERÇEKTEN yüklediği dosyalardan olmalı');
});

test('reçetenin özeti sayfanın dosyalarından: motor değişince bütün anahtarlar değişiyor', () => {
  const root = tmpDir();
  for (const rel of T.PAGE_FILES) {
    fs.mkdirSync(path.dirname(path.join(root, rel)), { recursive: true });
    fs.copyFileSync(path.join(ROOT, rel), path.join(root, rel));
  }
  const a = T.recipeHash(root);
  assert.match(a, /^[0-9a-f]{40}$/);
  assert.strictEqual(T.recipeHash(root), a, 'aynı dosyalar aynı özet');
  fs.appendFileSync(path.join(root, 'src/visualizer/modes/milkdrop.js'), '\n// motor değişti\n');
  const b = T.recipeHash(root);
  assert.notStrictEqual(b, a);
  assert.notStrictEqual(T.keyOf(b, 'X', ''), T.keyOf(a, 'X', ''));
});

// ------------------------------------------------------------- anahtar

test('anahtar: kaynağa, reçeteye ve doku imzasına bağlı; içerik aynıysa aynı', () => {
  const k = T.keyOf('r1', 'SRC', '');
  assert.match(k, T.KEY_RE);
  assert.strictEqual(T.keyOf('r1', 'SRC', ''), k);
  assert.notStrictEqual(T.keyOf('r1', 'SRC2', ''), k);
  assert.notStrictEqual(T.keyOf('r2', 'SRC', ''), k);
  assert.notStrictEqual(T.keyOf('r1', 'SRC', 'worms=worms.jpg@1:2'), k);
});

test('presetin istediği dokular: ön ek soyuluyor, motorun örnekleyicileri dosya değil', () => {
  const src = [
    'sampler_worms', 'sampler_fw_Clouds', 'sampler_pc_clouds', 'sampler_pw_stars2',
    'sampler_main', 'sampler_fc_main', 'sampler_blur2', 'sampler_noise_lq_lite', 'sampler_pw_noisevol_hq',
    'sampler_rand04', 'sampler_rand00_smalltiled',
  ].join(' ');
  const u = TEX.userSamplers(src);
  assert.deepStrictEqual(Array.from(u.names).sort(), ['clouds', 'stars2', 'worms']);
  assert.strictEqual(u.rand, true);
  assert.deepStrictEqual([...TEX.userSamplers('sampler_main sampler_blur1').names], []);
  assert.strictEqual(TEX.userSamplers('sampler_main').rand, false);
  // İçe aktarıcı da aynı yardımcıyı kullanıyor: ön ekli istek yanındaki dokuyu getiriyor
  const I = require('../src/main/milkdrop-import.js');
  assert.deepStrictEqual([...I.samplerNames('sampler_fw_worms')], ['worms']);
});

test('doku imzası: motor gibi çözülüyor; randNN bütün listeye bağlı', () => {
  const stamps = { 'worms.jpg': '10:1', 'worms.png': '11:1', 'Clouds.PNG': '12:1', 'z.jpg': '13:1' };
  const lib = { names: ['Clouds.PNG', 'worms.jpg', 'worms.png', 'z.jpg'], stamp: (n) => stamps[n] || '-' };
  assert.strictEqual(T.textureSig('sampler_main; per_frame_1=zoom=1;', lib), '', 'doku istemeyen presetin imzası boş');
  // Listedeki İLK eşleşen (motorun `_texFileFor`u), uzantısız ve harf ayırmadan
  assert.strictEqual(T.textureSig('sampler_Worms sampler_fw_clouds', lib), 'clouds=Clouds.PNG@12:1;worms=worms.jpg@10:1');
  assert.strictEqual(T.textureSig('sampler_yok', lib), 'yok=-', 'bulunamayan da imzada: sonradan gelirse anahtar değişir');
  assert.strictEqual(T.textureSig('sampler_rand03', lib), '*=Clouds.PNG@12:1,worms.jpg@10:1,worms.png@11:1,z.jpg@13:1');
  // Dosya değişince (boyut/zaman) imza da
  const lib2 = { names: lib.names, stamp: (n) => (n === 'worms.jpg' ? '99:9' : stamps[n]) };
  assert.notStrictEqual(T.textureSig('sampler_worms', lib2), T.textureSig('sampler_worms', lib));
  assert.strictEqual(T.textureSig('sampler_clouds', lib2), T.textureSig('sampler_clouds', lib), 'ilgisiz doku etkilemiyor');
});

test('doku listesi sıralı: rand yuvası her makinede aynı dokuyu seçsin', () => {
  const a = tmpDir();
  const b = tmpDir();
  for (const n of ['b.png', 'a.png', 'B2.png']) fs.writeFileSync(path.join(a, n), 'x');
  fs.writeFileSync(path.join(b, 'A0.jpg'), 'x');
  const names = TEX.listTexturesIn([a, b]).names;
  // Varsayılan sıralama (ölçüm betiğindeki gibi): büyük harf küçükten önce
  assert.deepStrictEqual(names, ['A0.jpg', 'B2.png', 'a.png', 'b.png']);
});

// -------------------------------------------------------------- kuyruk

function queueWith(render, max) {
  const dir = tmpDir();
  const events = [];
  const q = new T.ThumbQueue({ dir, max, render, onReady: (id, key, ok, stale) => events.push({ id, key, ok, stale: !!stale }) });
  const drain = async () => { for (let i = 0; i < 50 && q.pending(); i++) await wait(5); await wait(5); };
  return { q, dir, events, drain };
}

test('kuyruk: önbellekteki hemen; aynı anahtar bir kez; dosya yarım kalmadan yazılıyor', async () => {
  const rendered = [];
  const t = queueWith(async (job) => { rendered.push(job.key); return Buffer.from('WEBP:' + job.key); });
  fs.writeFileSync(path.join(t.dir, K('a') + '.webp'), 'eski');
  const ready = t.q.request([
    { id: 'p1', key: K('a'), source: 'A' },
    { id: 'p2', key: K('b'), source: 'B' },
    { id: 'p3', key: K('b'), source: 'B' }, // aynı içerik, başka kimlik
    { id: 'bad', key: 'yol/../x', source: 'X' },
  ]);
  assert.deepStrictEqual(ready, { p1: K('a') });
  await t.drain();
  assert.deepStrictEqual(rendered, [K('b')], 'aynı anahtar bir kez çizildi');
  assert.deepStrictEqual(t.events.map((e) => e.id + ':' + e.ok).sort(), ['p2:true', 'p3:true']);
  assert.strictEqual(fs.readFileSync(path.join(t.dir, K('b') + '.webp'), 'utf8'), 'WEBP:' + K('b'));
  assert.deepStrictEqual(fs.readdirSync(t.dir).filter((n) => n.endsWith('.tmp')), [], 'geçici dosya kalmadı');
  assert.deepStrictEqual(t.q.request([{ id: 'p2', key: K('b'), source: 'B' }]), { p2: K('b') });
});

test('kuyruk: en son istenen parti öne geçiyor; sınır aşılınca en eskisi düşüyor', async () => {
  const order = [];
  let release = null;
  const gate = new Promise((r) => { release = r; });
  const t = queueWith(async (job) => {
    order.push(job.source);
    if (job.source === 'A') await gate;
    return Buffer.from('x');
  }, 3);
  t.q.request([{ id: 'a', key: K('a'), source: 'A' }, { id: 'b', key: K('b'), source: 'B' }]);
  // A çizilirken panel kaydırıldı: yeni görünenler önce
  t.q.request([{ id: 'c', key: K('c'), source: 'C' }, { id: 'd', key: K('d'), source: 'D' }, { id: 'e', key: K('e'), source: 'E' }]);
  assert.strictEqual(t.q.queue.length, 3, 'sınır 3: en eski (B) düştü');
  release();
  await t.drain();
  assert.deepStrictEqual(order, ['A', 'C', 'D', 'E']);
  // Düşen yeniden istenince çiziliyor
  t.q.request([{ id: 'b', key: K('b'), source: 'B' }]);
  await t.drain();
  assert.deepStrictEqual(order, ['A', 'C', 'D', 'E', 'B']);
});

test('kuyruk: başarısız bu oturumda bir daha denenmiyor; eskiyen başarısız sayılmıyor', async () => {
  const calls = [];
  const t = queueWith(async (job) => {
    calls.push(job.source);
    if (job.source === 'KÖTÜ') return null;
    if (job.source === 'PATLAR') throw new Error('çizici çöktü');
    if (job.source === 'ESKİ' && calls.filter((c) => c === 'ESKİ').length === 1) return { stale: true };
    return Buffer.from('ok');
  });
  t.q.request([{ id: 'k', key: K('1'), source: 'KÖTÜ' }, { id: 'p', key: K('2'), source: 'PATLAR' }, { id: 's', key: K('3'), source: 'ESKİ' }]);
  await t.drain();
  const by = Object.fromEntries(t.events.map((e) => [e.id, e]));
  assert.deepStrictEqual([by.k.ok, by.k.key, by.k.stale], [false, '', false]);
  assert.deepStrictEqual([by.p.ok, by.p.stale], [false, false]);
  assert.deepStrictEqual([by.s.ok, by.s.stale], [false, true], 'eskidi: panele yeniden iste deniyor');
  // Başarısızlar hemen '' ile dönüyor, çizilmiyor; eskiyen yeniden çiziliyor
  const again = t.q.request([{ id: 'k', key: K('1'), source: 'KÖTÜ' }, { id: 's', key: K('3'), source: 'ESKİ' }]);
  assert.deepStrictEqual(again, { k: '' });
  await t.drain();
  assert.deepStrictEqual(calls, ['KÖTÜ', 'PATLAR', 'ESKİ', 'ESKİ']);
  assert.ok(fs.existsSync(path.join(t.dir, K('3') + '.webp')));
});

test('kuyruk: panel kapanınca bekleyenler bırakılıyor', async () => {
  let release = null;
  const gate = new Promise((r) => { release = r; });
  const order = [];
  const t = queueWith(async (job) => { order.push(job.source); await gate; return Buffer.from('x'); });
  t.q.request([{ id: 'a', key: K('a'), source: 'A' }, { id: 'b', key: K('b'), source: 'B' }]);
  t.q.clear();
  release();
  await t.drain();
  assert.deepStrictEqual(order, ['A'], 'yalnız süren iş bitti');
  assert.strictEqual(t.q.pending(), 0);
});

// ------------------------------------------------- temizlik ve protokol

test('artık temizliği: yalnız bugünkü presetlerin anahtarları ve yeni yazılanlar kalıyor', () => {
  const dir = tmpDir();
  const old = Date.now() - 60000;
  const put = (n, when) => { fs.writeFileSync(path.join(dir, n), 'x'); if (when) fs.utimesSync(path.join(dir, n), when / 1000, when / 1000); };
  put(K('a') + '.webp', old);
  put(K('b') + '.webp', old);
  put(K('c') + '.webp'); // temizlik başladıktan sonra yazıldı
  put(K('d') + '.webp.123.abcd.tmp', old);
  put('okubeni.txt', old);
  const started = Date.now() - 1000;
  const r = T.prune(dir, new Set([K('a')]), started);
  assert.deepStrictEqual(fs.readdirSync(dir).sort(), [K('a') + '.webp', K('c') + '.webp', 'okubeni.txt']);
  assert.strictEqual(r.removed, 2);
});

test('protokol: yalnız anahtar ve yalnız o klasör', () => {
  const dir = path.join(os.tmpdir(), 'thumbs');
  const inside = path.join(dir, K('a') + '.webp');
  assert.strictEqual(T.fileForUrl(dir, 'sv-thumb://t/' + K('a') + '.webp'), inside);
  for (const bad of [
    'sv-thumb://t/' + K('A') + '.webp', // büyük harf: sha1 küçük harfli
    'sv-thumb://t/' + K('a'),
    'sv-thumb://t/' + K('a') + '.webp/../x',
    'sv-thumb://t/%2e%2e%2f' + K('a') + '.webp',
    'sv-thumb://t/sub/' + K('a') + '.webp',
    'sv-logo://t/' + K('a') + '.webp',
    'file:///C:/x.webp',
    'bozuk',
  ]) assert.strictEqual(T.fileForUrl(dir, bad), null, bad);
  /* Nokta bölümlerini adres ayrıştırıcısı zaten çözüyor: `t/../<anahtar>`
     aynı dosyaya varıyor — klasörün dışına çıkan bir yol yok, dosya adı
     yalnız anahtardan kuruluyor. */
  assert.strictEqual(T.fileForUrl(dir, 'sv-thumb://t/../' + K('a') + '.webp'), inside);
});

// ----------------------------------------------------- yerleşik presetler

test('yerleşik presetler Node\'da da okunuyor; sayfada kayıt bir kez', () => {
  const code = read('src/shared/presets-milkdrop.js');
  // Ana süreç: pencere yok — liste dönüyor, hiçbir genel ad yazılmıyor
  const m1 = { exports: {} };
  new Function('module', 'window', code)(m1, undefined);
  assert.strictEqual(m1.exports.length, 5);
  assert.ok(m1.exports.every((p) => p.kind === 'milkdrop' && p.builtin && typeof p.source === 'string'));
  // Sayfa ama SVPresets yok: kayıt yok, nöbetçi de kurulmuyor
  const w = {};
  new Function('module', 'window', code)({ exports: {} }, w);
  assert.deepStrictEqual(Object.keys(w), []);
  // Sayfa: bir kez kayıt; ikinci değerlendirme kaydı büyütmüyor
  let registered = 0;
  const page = { SVPresets: { registerBuiltin: (list) => { registered += list.length; } } };
  new Function('module', 'window', code)(undefined, page);
  new Function('module', 'window', code)(undefined, page);
  assert.strictEqual(registered, 5);
  assert.strictEqual(page.SVMilkdropBuiltins.length, 5);
});

// ------------------------------------------------------- çizim sayfası

function driver(opts) {
  const o = opts || {};
  const log = { modes: 0, disposed: 0, draws: [], randoms: [], done: [], drawn: null };
  const jobs = [];
  function Canvas() {
    const c = {
      width: 0, height: 0,
      getContext: () => ({ imageSmoothingEnabled: false, imageSmoothingQuality: 'low', drawImage: (src, x, y, w, h) => { log.drawn = { from: [src.width, src.height], to: [w, h] }; } }),
      toBlob: (cb, type, q) => { log.blob = { type, q }; cb({ arrayBuffer: () => Promise.resolve(new Uint8Array([1, 2, 3]).buffer) }); },
    };
    return c;
  }
  const main = Canvas();
  // Sayfanın kendi Math'i: sürücü onu tohumluyor, sahte motor da onu okumalı
  const pageMath = Object.create(Math);
  class FakeMode {
    constructor(canvas) {
      log.modes++;
      this.canvas = canvas;
      this.pending = 0;
      this.waiters = [];
      // Motor gibi: bağlam ilk çizimde, sayaç yalnız gerçekten çizilen karede
      this.gl = null;
      this.preset = null;
      this.frameNo = 0;
      log.randoms.push([pageMath.random(), pageMath.random()]);
    }
    draw(audio, cfg, t, dt) {
      if (!o.noContext && !this.gl) this.gl = { isContextLost: () => !!o.lostAt && log.draws.length >= o.lostAt };
      if (this.gl && !this.gl.isContextLost()) {
        this.preset = this.preset || {};
        if (!(o.skipFrame && log.draws.length === o.skipFrame)) this.frameNo++;
      }
      log.draws.push({ t, dt, id: cfg.milkdrop.presetId, cut: cfg.milkdrop.blendTime, rev: cfg.milkdropLibrary.textureRev, w: this.canvas.width, h: this.canvas.height, time: audio.timeBytes.length });
      if (o.textureAt === log.draws.length - 1) {
        this.pending = 1;
        if (!o.neverArrives) setTimeout(() => { this.pending = 0; this.waiters.splice(0).forEach((f) => f()); }, 5);
      }
    }
    texturesPending() { return this.pending; }
    whenTexturesSettled() { return this.pending ? new Promise((r) => this.waiters.push(r)) : Promise.resolve(); }
    dispose() { log.disposed++; }
  }
  const ctx = {
    window: {},
    document: { getElementById: () => main, createElement: () => Canvas() },
    setTimeout, clearTimeout, Promise, Uint8Array, Float32Array, Math: pageMath,
  };
  ctx.window.SVModes = { milkdrop: FakeMode };
  ctx.window.SVDemoAudio = require('../src/shared/demo-audio.js');
  ctx.window.thumbs = {
    onJob: (cb) => jobs.push(cb),
    done: (key, r) => log.done.push({ key, r }),
    ready: () => { log.ready = true; },
  };
  vm.createContext(ctx);
  vm.runInContext(read('src/thumbs/thumbs.js'), ctx, { filename: 'thumbs.js' });
  const run = async (job) => {
    const before = log.done.length;
    jobs[0](job);
    for (let i = 0; i < 400 && log.done.length === before; i++) await wait(2);
    return log.done[log.done.length - 1];
  };
  return { log, run, ctx };
}

const JOB = (key, extra) => Object.assign({ key, source: 'SRC', textureDir: '', textureRev: 3, recipe: Object.assign({}, T.RECIPE, { frames: 6 }) }, extra);

test('çizim sayfası: her iş yeni motor, reçetedeki boyut ve kare sayısı, WebP', async () => {
  const d = driver();
  assert.strictEqual(d.log.ready, true, 'sayfa hazır dedi');
  const r = await d.run(JOB(K('a')));
  assert.deepStrictEqual([r.key, r.r.ok, Array.from(r.r.bytes)], [K('a'), true, [1, 2, 3]]);
  assert.strictEqual(d.log.draws.length, 6);
  assert.ok(d.log.draws.every((x, i) => Math.abs(x.t - i / 30) < 1e-9 && Math.abs(x.dt - 1 / 30) < 1e-9), 'kare saati indisten');
  assert.ok(d.log.draws.every((x) => x.id === 'thumb:' + K('a') && x.cut === 0 && x.rev === 3 && x.w === 640 && x.h === 360 && x.time === 2048));
  assert.deepStrictEqual(d.log.drawn.to, [256, 144], '256x144 küçültülüyor');
  assert.deepStrictEqual(d.log.blob, { type: 'image/webp', q: 0.8 });
  await d.run(JOB(K('b')));
  assert.deepStrictEqual([d.log.modes, d.log.disposed], [2, 2], 'iş başına yeni örnek, hepsi bırakıldı');
});

test('çizim sayfası: rastgelelik anahtardan — aynı iş aynı sayıları görüyor, öncülü ne olursa olsun', async () => {
  const d = driver();
  await d.run(JOB(K('a')));
  await d.run(JOB(K('b')));
  await d.run(JOB(K('a')));
  const [a1, b, a2] = d.log.randoms;
  assert.deepStrictEqual(a1, a2);
  assert.notDeepStrictEqual(a1, b);
});

test('çizim sayfası: doku istendiği karenin ardından bekleniyor; gelmezse iş başarısız', async () => {
  const d = driver({ textureAt: 0 });
  const r = await d.run(JOB(K('a')));
  assert.strictEqual(r.r.ok, true);
  assert.strictEqual(d.log.draws.length, 6);
  const late = driver({ textureAt: 1, neverArrives: true });
  const r2 = await late.run(JOB(K('b'), { recipe: Object.assign({}, T.RECIPE, { frames: 6, textureWaitMs: 20 }) }));
  // Sonuç sayfanın dünyasında kuruldu: alan alan karşılaştırılıyor
  assert.deepStrictEqual([r2.r.ok, r2.r.error, r2.r.bytes], [false, 'TEXTURE_TIMEOUT', undefined], 'görüntü diskin hızına kalmasın: yazılmıyor');
  assert.strictEqual(late.log.draws.length, 2, 'beklemeden sonraki kareler çizilmedi');
  assert.strictEqual(late.log.disposed, 1, 'başarısız işin motoru da bırakıldı');
});

test('çizim sayfası: bağlam yoksa, kaybolduysa ya da bir kare çizilmediyse yazılmıyor', async () => {
  // Bağlam hiç alınamadı: motor yedek görüntü çiziyor
  const none = await driver({ noContext: true }).run(JOB(K('a')));
  assert.deepStrictEqual([none.r.ok, none.r.error], [false, 'NO_CONTEXT']);
  // Üçüncü karede kayboldu: motor son kareyi bırakıyor
  const lost = await driver({ lostAt: 3 }).run(JOB(K('b')));
  assert.deepStrictEqual([lost.r.ok, lost.r.error], [false, 'NO_CONTEXT']);
  // Bir kare çizilmedi (sayaç eksik)
  const short = await driver({ skipFrame: 2 }).run(JOB(K('c')));
  assert.deepStrictEqual([short.r.ok, short.r.error], [false, 'NO_CONTEXT']);
  // Hepsi canlı bağlamda: yazılıyor
  const ok = await driver().run(JOB(K('d')));
  assert.strictEqual(ok.r.ok, true);
});

// ------------------------------------------------------------ ana süreç

test('ana süreç: protokol, istek, eskime, pencere ve yerleşikler', () => {
  const raw = read('src/main/main.js');
  const M = bare(raw);
  assert.match(M, /\{ scheme: 'sv-thumb', privileges: \{ standard: true, secure: true, supportFetchAPI: true, bypassCSP: false \} \}/);
  const proto = /protocol\.handle\('sv-thumb', async \(request\) => \{[\s\S]*?\n {2}\}\);/.exec(M);
  assert.ok(proto, 'protokol işleyicisi yok');
  assert.match(proto[0], /const file = mdThumbs\.fileForUrl\(thumbDir\(\), request\.url\);\s*if \(!file\) return new Response\('not found', \{ status: 404 \}\);/);
  assert.match(proto[0], /'Content-Type': 'image\/webp'/);
  const h = /ipcMain\.handle\('milkdrop:thumbs', async \(e, ids\) => \{[\s\S]*?\n\}\);/.exec(M);
  assert.ok(h, 'istek işleyicisi yok');
  assert.match(h[0], /await presetsStore\.warm\(\);/);
  assert.match(h[0], /\.slice\(0, 200\)/);
  assert.match(h[0], /items\.push\(\{ id, source, key: thumbKeyOf\(source, lib\) \}\)/);
  assert.match(h[0], /const ready = thumbQueue\(\)\.request\(items\);/);
  assert.match(M, /if \(thumbKeyOf\(job\.source, thumbTextureLib\(\)\) !== job\.key\) return \{ stale: true \};/);
  assert.match(M, /preload: path\.join\(__dirname, 'preload-thumbs\.js'\)/);
  assert.match(M, /win\.loadFile\(path\.join\(__dirname, '\.\.', 'thumbs', 'index\.html'\)\)/);
  assert.match(M, /mdBuiltins = require\('\.\.\/shared\/presets-milkdrop\.js'\);/);
  assert.match(M, /mdThumbs\.prune\(thumbDir\(\), live, started\);/);
  // Pencere yalnız kendi iletisine yanıt veriyor
  assert.match(M, /e\.sender !== thumbWin\.webContents \|\| j\.key !== key\) return;/);
  // Çizim süreci çökerse pencere yok ediliyor (kapanış olayı gelmezdi)
  assert.match(M, /win\.webContents\.on\('render-process-gone', \(\) => \{\s*try \{ win\.destroy\(\); \}/);
  /* Öz test: zincirin tamamı (asar'daki reçete dosyaları, gizli pencere,
     protokol, CSP) sürüm kapısında sınanıyor; klasörü geçici, kullanıcının
     verisine küçük resim yazılmıyor. */
  assert.match(M, /if \(SMOKE\) \{\s*if \(!smokeThumbDir\) smokeThumbDir = fs\.mkdtempSync\(/);
  assert.match(M, /console\.log\('\[SMOKE\] küçük resim: ' \+ JSON\.stringify\(th\)\);\s*if \(th\.hata\) errors\.push\('thumbnail: ' \+ th\.hata\);/);
  assert.match(M, /th\.img\.w !== mdThumbs\.RECIPE\.thumbW \|\| th\.img\.h !== mdThumbs\.RECIPE\.thumbH/);
  // Sayfa CSP'si ve köprüler
  assert.match(read('src/admin/index.html'), /img-src 'self' data: blob: sv-logo: sv-thumb:;/);
  const A = read('src/main/preload-admin.js');
  for (const k of ['milkdropThumbs', 'onMilkdropThumb']) assert.ok(A.includes(k + ':'), k);
  const PT = read('src/main/preload-thumbs.js');
  for (const k of ["'milkdrop:textures'", "'milkdrop:texture'", "'thumbs:job'", "'thumbs:done'", "'thumbs:ready'"]) assert.ok(PT.includes(k), k);
});

// ----------------------------------------------------------------- panel

/* Sahte DOM: gerçek `el` gibi öznitelikleri yazıyor; ızgaranın kullandığı
   querySelector(All), classList ve öznitelik işlemleri var. */
function mkNode(tag, props, kids) {
  const n = { tag, attrs: {}, kids: [], on: {}, text: '', className: '' };
  for (const [k, v] of Object.entries(props || {})) {
    if (k === 'class') n.className = v;
    else if (k === 'text') n.text = v;
    else if (k.indexOf('on') === 0 && typeof v === 'function') n.on[k.slice(2)] = v;
    else if (v !== false && v != null) n.attrs[k] = String(v);
  }
  n.appendChild = (c) => { n.kids.push(c); return c; };
  n.addEventListener = (ev, f) => { n.on[ev] = f; };
  n.getAttribute = (k) => (k in n.attrs ? n.attrs[k] : null);
  n.setAttribute = (k, v) => { n.attrs[k] = String(v); };
  n.removeAttribute = (k) => { delete n.attrs[k]; };
  n.classList = {
    add: (...c) => { const s = new Set(n.className.split(/\s+/).filter(Boolean)); c.forEach((x) => s.add(x)); n.className = [...s].join(' '); },
    remove: (...c) => { n.className = n.className.split(/\s+/).filter((x) => x && c.indexOf(x) < 0).join(' '); },
    contains: (c) => n.className.split(/\s+/).indexOf(c) >= 0,
  };
  const match = (x, sel) => (sel[0] === '.' ? x.className && x.className.split(/\s+/).indexOf(sel.slice(1)) >= 0 : x.tag === sel);
  n.querySelectorAll = (sel) => { const out = []; walk(n, (x) => { if (x !== n && match(x, sel)) out.push(x); }); return out; };
  n.querySelector = (sel) => n.querySelectorAll(sel)[0] || null;
  Object.defineProperty(n, 'textContent', { get: () => n.text, set: (v) => { n.text = v; n.kids = []; } });
  (kids || []).forEach((c) => c && n.kids.push(c));
  return n;
}
function walk(n, f) {
  if (!n || typeof n !== 'object') return;
  f(n);
  (n.kids || []).forEach((k) => walk(k, f));
  if (n.node) walk(n.node, f);
}

async function gridPanel(api, setup) {
  /* Önceki testin panelinin toplama zamanlayıcısı hâlâ sürüyor olabilir:
     köprü değişmeden önce kendi köprüsüne boşalsın, yoksa bu testin
     sayacına karışır. */
  await wait(200);
  const key = require.resolve('../src/admin/milkdrop-panel.js');
  delete require.cache[key];
  const cfg = global.window.SV.defaultConfig();
  if (setup) setup(cfg);
  const root = mkNode('div', { id: 'sections' });
  const store = {};
  const calls = { confirms: [], applied: 0 };
  global.localStorage = { getItem: (k) => (k in store ? store[k] : null), setItem: (k, v) => { store[k] = String(v); } };
  global.document = {
    querySelector: (sel) => root.querySelector(sel),
    getElementById: (id) => (id === 'sections' ? root : null),
    activeElement: null,
  };
  window.SVMilkdropCycle = require('../src/shared/milkdrop-cycle.js');
  window.SVMilkdropLibrary = L;
  window.SVPresets = undefined;
  window.SVMilkdropBuiltins = [
    { id: 'md_caya_a', name: 'A', source: 'a', kind: 'milkdrop', builtin: true },
    { id: 'md_caya_b', name: 'B', source: 'b', kind: 'milkdrop', builtin: true },
  ];
  const listeners = {};
  window.api = Object.assign({
    listPresets: () => Promise.resolve([{ id: 'md_u1', name: 'Kullanıcı', kind: 'milkdrop', source: 'u' }]),
    onMilkdropThumb: (cb) => { listeners.thumb = cb; },
    onPresetsDelta: (cb) => { listeners.delta = cb; },
    deletePreset: () => Promise.resolve({ ok: true }),
  }, api);
  window.SVPanel = {
    cfg: () => cfg, apply() { calls.applied++; }, rerender() {}, el: mkNode,
    row: (label, node) => ({ label, node, kids: [] }),
    confirm: (m) => { calls.confirms.push(m); return Promise.resolve(true); },
    toast() {},
  };
  window.SVScenePanels = { miniSlider: (label) => ({ label, kids: [] }) };
  const M = require('../src/admin/milkdrop-panel.js');
  M.init();
  await wait(5);
  const render = () => { root.kids = [M.panel()]; return root; };
  return { M, cfg, root, store, calls, listeners, render };
}
const cellsOf = (root) => root.querySelectorAll('.md-thumb-box');
const layoutRow = (root) => { let r = null; walk(root, (n) => { if (!r && n.label === 'Düzen') r = n; }); return r; };

test('panel: düzen ızgaraya geçince görünenler isteniyor; hazırlar görselle, bekleyen ve çizilemeyen ayrı', async () => {
  const asked = [];
  const p = await gridPanel({
    milkdropThumbs: (ids) => { asked.push(ids.slice()); return Promise.resolve({ ok: true, ready: { md_caya_a: K('a'), md_u1: '' } }); },
  });
  let root = p.render();
  const row = layoutRow(root);
  assert.ok(row, 'Düzen satırı yok');
  assert.deepStrictEqual(row.node.kids.map((o) => o.attrs.value), ['list', 'grid']);
  assert.strictEqual(root.querySelectorAll('.md-grid').length, 0, 'varsayılan liste');
  row.node.value = 'grid';
  row.node.on.change();
  assert.strictEqual(p.store['sv-md-view'], 'grid', 'tercih bu görüntüleyicinin deposunda');
  root = p.render();
  assert.strictEqual(root.querySelectorAll('.md-grid').length, 1);
  assert.strictEqual(cellsOf(root).length, 3);
  assert.ok(cellsOf(root).every((b) => b.classList.contains('pending')), 'ilk çizimde hepsi bekliyor');
  const box = (id) => cellsOf(root).find((b) => b.getAttribute('data-id') === id);
  // Gözlemci yok: ilk hücreler toplanıp tek istekte isteniyor
  await until(() => box('md_caya_a').querySelector('img').getAttribute('src'));
  assert.deepStrictEqual(asked, [['md_caya_a', 'md_caya_b', 'md_u1']]);
  assert.strictEqual(box('md_caya_a').querySelector('img').getAttribute('src'), 'sv-thumb://t/' + K('a') + '.webp');
  assert.ok(!box('md_caya_a').classList.contains('pending'));
  assert.ok(box('md_u1').classList.contains('failed'), 'çizilemeyen kesikli');
  assert.ok(box('md_caya_b').classList.contains('pending'), 'hazırlanan çizgili');
  assert.strictEqual(box('md_caya_b').getAttribute('title'), 'Küçük resim hazırlanıyor…');
  // Çizilince olay geliyor: panel baştan çizilmeden hücre güncelleniyor
  p.listeners.thumb({ id: 'md_caya_b', key: K('b'), ok: true });
  assert.strictEqual(box('md_caya_b').querySelector('img').getAttribute('src'), 'sv-thumb://t/' + K('b') + '.webp');
  // Sonraki çizim bilinen anahtarı hemen gösteriyor
  root = p.render();
  assert.strictEqual(box('md_caya_b').querySelector('img').getAttribute('src'), 'sv-thumb://t/' + K('b') + '.webp');
});

test('panel: preset değişince ve dokular değişince eski küçük resim gösterilmiyor', async () => {
  const asked = [];
  const again = await gridPanel({
    milkdropThumbs: (ids) => { asked.push(ids.slice()); return Promise.resolve({ ok: true, ready: { md_caya_a: K('a'), md_caya_b: K('b') } }); },
  });
  let root = again.render();
  layoutRow(root).node.value = 'grid';
  layoutRow(root).node.on.change();
  root = again.render();
  const box = (id) => cellsOf(root).find((b) => b.getAttribute('data-id') === id);
  const src = (id) => box(id).querySelector('img').getAttribute('src');
  assert.ok(await until(() => asked.length >= 1 && src('md_caya_a') && src('md_caya_b')));
  // Değişiklik yayını: preset değişti — kaydı düşüyor
  again.listeners.delta({ upsert: [{ id: 'md_caya_a' }], remove: [] });
  root = again.render();
  assert.ok(box('md_caya_a').classList.contains('pending'), 'değişen preset yeniden bekliyor');
  assert.ok(box('md_caya_b').querySelector('img').getAttribute('src'), 'ötekiler kalıyor');
  // Dokular değişti (içe aktarım sayacı): hepsi
  again.cfg.milkdropLibrary.textureRev = 7;
  const before = asked.length;
  root = again.render();
  assert.ok(cellsOf(root).every((b) => b.classList.contains('pending')));
  /* Eskiyen iş: yeniden isteniyor. Çizimin tetiklediği istek önce yanıtını
     alsın — sayılan istek yalnız olayın yol açtığı olsun. */
  assert.ok(await until(() => asked.length > before && box('md_caya_b').querySelector('img').getAttribute('src')));
  const n = asked.length;
  again.listeners.thumb({ id: 'md_caya_b', key: '', ok: false, stale: true });
  assert.ok(box('md_caya_b').classList.contains('pending'), 'eskiyen hücre yeniden bekliyor');
  await until(() => asked.length > n);
  await wait(30);
  assert.strictEqual(asked.length, n + 1, 'eskiyen için tek bir istek');
  assert.deepStrictEqual(asked[n], ['md_caya_b'], 'eskiyen yeniden istendi');
});

test('panel: ızgarada yıldız, seçim ve silme', async () => {
  const deleted = [];
  const p = await gridPanel({
    milkdropThumbs: () => Promise.resolve({ ok: true, ready: {} }),
    deletePreset: (id) => { deleted.push(id); return Promise.resolve({ ok: true }); },
  });
  let root = p.render();
  layoutRow(root).node.value = 'grid';
  layoutRow(root).node.on.change();
  root = p.render();
  const cells = root.querySelectorAll('.md-cell');
  const cell = (name) => cells.find((c) => c.querySelector('.md-cell-name').text === name);
  // Yerleşikte silme yok
  assert.strictEqual(cell('A').querySelector('.md-cell-del'), null);
  cell('A').querySelector('.md-fav').on.click();
  assert.strictEqual(L.isFavorite(p.cfg.milkdropLibrary, 'md_caya_a'), true);
  cell('B').querySelector('.md-cell-main').on.click();
  assert.strictEqual(p.cfg.milkdrop.presetId, 'md_caya_b');
  await cell('Kullanıcı').querySelector('.md-cell-del').on.click();
  assert.deepStrictEqual(deleted, ['md_u1']);
  assert.strictEqual(p.calls.confirms.length, 1, 'sormadan silinmiyor');
});

test('metinlerin İngilizcesi var', () => {
  const I18N = read('src/shared/i18n.js');
  const PANEL = read('src/admin/milkdrop-panel.js');
  for (const k of [
    'Düzen', 'Liste', 'Izgara', 'Küçük resim hazırlanıyor…', 'Küçük resim çizilemedi',
    'Küçük resim, presetin ilk iki saniyesi: örnek sesle, siyah bir ekrandan başlanarak çiziliyor. Her preset bir kez çiziliyor ve saklanıyor; preset değişince yeniden çiziliyor.',
  ]) {
    assert.ok(PANEL.includes("'" + k + "'"), k + ' panelde yok');
    assert.ok(I18N.includes("'" + k + "':"), k + ' sözlükte yok');
  }
  // "Görünüm" başka bir yerde "Appearance": düzen satırı onu kullanmamalı
  assert.ok(!/P\(\)\.row\('Görünüm', viewSel\)/.test(PANEL));
});
