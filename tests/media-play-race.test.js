'use strict';
/* Video oynatma yarışı ve zaman çizelgesi oynatması (src/visualizer/modes/media.js).

   play() sözü çözülmeden pause() gelince Chromium sözü AbortError ile reddeder. Eskiden bu
   ret "Video açılamadı: The play() request was interrupted by a call to pause()" diye
   önizlemeye yazılıyordu. Zaman çizelgesi de videoyu her karede duraklatıp sarıyordu:
   çizelge oynarken video oynamıyor, yalnız donmuş tek kare görünüyordu. */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const read = (p) => fs.readFileSync(path.join(__dirname, '..', p), 'utf8');

function load() {
  const videos = [];
  const el = (tag) => {
    const v = {
      tag, paused: true, readyState: 0, duration: NaN, currentTime: 0, playbackRate: 1, seeking: false,
      loop: true, error: null, onerror: null, onloadeddata: null, plays: 0, pauses: 0,
      removeAttribute() {}, load() {}, getContext: () => ({}),
      play() {
        v.plays++;
        return new Promise((resolve, reject) => { v._resolve = () => { v.paused = false; resolve(); }; v._reject = reject; });
      },
      pause() {
        v.pauses++;
        // Gerçek tarayıcı gibi: bekleyen play() sözü AbortError ile reddedilir
        if (v._reject) { const r = v._reject; v._reject = null; v._resolve = null; r(Object.assign(new Error('The play() request was interrupted by a call to pause(). https://goo.gl/LdLk22'), { name: 'AbortError' })); }
        v.paused = true;
      },
    };
    if (tag === 'video') videos.push(v);
    return v;
  };
  const ctx = {
    document: { createElement: el }, location: { protocol: 'file:', search: '' }, navigator: {},
    setTimeout, clearTimeout, setInterval, clearInterval, URLSearchParams, Promise,
    fetch: () => Promise.resolve({ status: 200 }),
  };
  ctx.window = ctx;
  vm.createContext(ctx);
  vm.runInContext(read('src/visualizer/modes/media.js'), ctx);
  return { ctx, videos };
}
const flush = () => new Promise((r) => setImmediate(r));

test('play() sözü sürerken duraklatma: AbortError olmaz, video söz çözülünce durur', async () => {
  const env = load();
  const m = new env.ctx.SVMedia();
  m.apply({ enabled: true, source: 'file', file: 'sv-media://local/a.mp4', loop: true });
  const v = env.videos[0];
  assert.strictEqual(v.autoplay, false, 'tarayıcının kendi play() çağrısı yok');
  assert.strictEqual(v.plays, 1);
  Object.assign(v, { duration: 10, readyState: 4 });
  const before = v.pauses;
  m.seekTimeline(2, false, 1);
  assert.strictEqual(v.pauses, before, 'bekleyen söz kesilmedi');
  v._resolve();
  await flush();
  assert.strictEqual(v.paused, true, 'söz çözülünce istenen duraklatma uygulandı');
  assert.strictEqual(m.error, null);
});

test('yarıda kesilen play() kullanıcıya hata olarak yazılmaz', async () => {
  const env = load();
  const m = new env.ctx.SVMedia();
  m.apply({ enabled: true, source: 'file', file: 'sv-media://local/a.mp4', loop: true });
  env.videos[0].pause(); // dışarıdan kesilen söz
  await flush();
  assert.strictEqual(m.error, null);
  // Gerçek bir oynatma hatası yine yazılır
  const m2 = new env.ctx.SVMedia();
  m2.apply({ enabled: true, source: 'file', file: 'sv-media://local/b.mp4', loop: true });
  env.videos[1]._reject(Object.assign(new Error('decode'), { name: 'Error' }));
  await flush();
  assert.match(String(m2.error), /Video açılamadı: decode/);
});

test('hazırlık ilk karenin çözülmesiyle gelir (duraklatılmış videoda da kare var)', () => {
  const env = load();
  const m = new env.ctx.SVMedia();
  m.apply({ enabled: true, source: 'file', file: 'sv-media://local/a.mp4', loop: true });
  assert.strictEqual(m.ready, false);
  env.videos[0].onloadeddata();
  assert.strictEqual(m.ready, true);
});

test('çizelge oynarken video kendi hızında oynar; yalnız büyük kaymada sarılır', async () => {
  const env = load();
  const m = new env.ctx.SVMedia();
  m.apply({ enabled: true, source: 'file', file: 'sv-media://local/a.mp4', loop: true });
  const v = env.videos[0];
  v._resolve(); await flush();
  Object.assign(v, { duration: 10, readyState: 4, currentTime: 1.0 });
  m.seekTimeline(1.1, true, 1);
  assert.strictEqual(v.currentTime, 1.0, '0,1 sn kayma için sarma yok (her karede sarmak videoyu donduruyordu)');
  assert.strictEqual(v.paused, false);
  m.seekTimeline(5, true, 2);
  assert.strictEqual(v.currentTime, 5, 'büyük kaymada (sarma, döngü başı) konum düzeltilir');
  assert.strictEqual(v.playbackRate, 2, 'klip hızı oynatma hızına yazılır');
  // Durunca: duraklar ve kafanın karesine tam sarılır
  m.seekTimeline(5.5, false, 2);
  assert.strictEqual(v.paused, true);
  assert.strictEqual(v.currentTime, 5.5);
  // Serbest oynatıcı yolu çizelgenin videosunu yeniden oynatmaz / hızını 1'e çekmez
  m.draw(null, { media: { enabled: true } }, 800, 600, 0);
  assert.strictEqual(v.paused, true);
  assert.strictEqual(v.playbackRate, 2);
});

test('timeline render oynama durumunu ve klip hızını videoya geçirir', () => {
  assert.match(read('src/shared/timeline-compose.js'), /rate: c\.speed > 0 \? c\.speed : 1/);
  assert.match(read('src/visualizer/visualizer.js'), /base\.timelineComposition\.playing = tlDriving;/);
  assert.match(read('src/admin/preview.js'), /base\.timelineComposition\.playing = !!\(a && a\.playing\);/);
});

test('Renderer: oynarken/dururken, taşıma hızı ve geri oynatma videoya doğru gider', () => {
  global.window = global.window || {};
  const { Renderer } = require('../src/visualizer/timeline-render.js');
  const seen = [];
  const media = { offline: false, seekTimeline: (...a) => seen.push(a) };
  const stack = () => ({
    _mediaPool: new Map([['f', media]]), setConfig() {}, setPostFX() {}, syncMedia() {}, resize() {}, _ensureComp() {},
    compCanvas: { width: 0, height: 0 }, compCtx: {}, drawTo() {}, dispose() {},
  });
  const canvas = () => ({ width: 0, height: 0, getContext: () => ({}) });
  const r = new Renderer({ canvas, stack, compositor: () => ({ compose() {} }) });
  const ctx = { save() {}, restore() {}, setTransform() {}, clearRect() {}, fillRect() {}, drawImage() {}, canvas: {} };
  const unit = { id: 'v', opacity: 1, localTime: 2, rate: 1.5, cfg: {}, layers: [] };
  r.draw(ctx, { units: [unit], time: 2, playing: true, rate: 2 }, null, 0, 0.016, 10, 10);
  r.draw(ctx, { units: [unit], time: 2, playing: false }, null, 0, 0.016, 10, 10);
  r.draw(ctx, { units: [unit], time: 2, playing: true, rate: -1 }, null, 0, 0.016, 10, 10);
  assert.deepStrictEqual(seen, [[2, true, 3], [2, false, 1.5], [2, false, 1.5]]);
});
