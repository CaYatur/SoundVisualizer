'use strict';
/* MILKDROP KÜÇÜK RESİMLERİ (#575).

   Liste yalnız adlardı; yüzlerce presetin içinden birini görünüşüyle bulmak
   olanaksızdı. Her preset bir kez, küçük, gizli bir pencerede çiziliyor ve
   kullanıcı verisinde saklanıyor (`milkdrop-thumbs/<anahtar>.webp`). Bu
   modül Electron'a bağlı değil: çizici bir parametre, testler gerçek
   klasörlerle koşuyor.

   REÇETE (ölçüldü, korpustan tohumlu 200 preset):
     - SİYAH TAMPONDAN başlanıyor. Sabit bir tohum görüntüsüyle başlamak
       (yerleşik bir preset 45 kare, sonra sert geçiş) siyah küçük resimleri
       yalnız 20'den 18'e indirdi — dördünü düzeltip ikisini bozarak — ve işi
       %45 uzattı; daha kötüsü, tohumun renkleri kendi başına bambaşka çizen
       presetlerin küçük resmine giriyordu. Küçük resim presetin KENDİ
       ürettiğini göstermeli.
     - 60 KARE, kare başı 1/30 sn (örnek sesin iki saniyesi). 90 kare siyahı
       18'den 20'ye, 150 kare 22'ye çıkardı (bazı presetler zamanla sönüyor);
       süre 259 → 350 → 538 ms (ortanca).
     - 640x360 ÇİZİLİP 256x144'e küçültülüyor. 320x180'e göre süre neredeyse
       aynı (ortanca 250 ms / 259 ms: iş kare başına JS'te, pikselde değil),
       ama genişliğe bağlı ayrıntılar (ince dalgalar, şekiller) gerçek
       boyuttaki gibi. WebP ~3,6 KB.
   Her iş YENİ bir motor örneğinde (bağlamı `dispose` bırakıyor): önceki
   işten hiçbir durum taşınmıyor, aynı preset hangi presetten sonra çizilirse
   çizilsin aynı baytlar (ölçüldü: 8/8).

   ANAHTAR içeriğe bağlı: reçetenin özeti + presetin kaynağı + istediği
   dokuların imzası. Reçetenin özeti çizim sayfasının yüklediği DOSYALARIN
   baytlarından: motor değişince (#580, #567 gibi) eski küçük resimler
   kendiliğinden geçersiz — elle artırılan bir sürüm numarası unutulurdu.
   Preset değişince anahtarı değişiyor ve yeniden çiziliyor; aynı içerikteki
   iki preset tek küçük resmi paylaşıyor. */
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const tex = require('./milkdrop-textures');

const RECIPE = Object.freeze({
  renderW: 640,
  renderH: 360,
  frames: 60,
  fps: 30,
  thumbW: 256,
  thumbH: 144,
  quality: 0.8,
  // Doku bu sürede gelmezse iş başarısız: görüntü diskin hızına kalmasın
  textureWaitMs: 8000,
});

/* Çizim sayfasının yüklediği dosyalar, sırasıyla. `src/thumbs/index.html`
   aynı betikleri aynı sırayla yüklüyor (test eşitliği denetliyor). */
const PAGE_FILES = Object.freeze([
  'src/thumbs/index.html',
  'src/shared/milkdrop.js',
  'src/shared/milkdrop-audio.js',
  'src/shared/milkdrop-hlsl.js',
  'src/shared/milkdrop-shader.js',
  'src/visualizer/modes/milkdrop.js',
  'src/shared/demo-audio.js',
  'src/thumbs/thumbs.js',
]);

const KEY_RE = /^[0-9a-f]{40}$/;
const sha1 = (s) => crypto.createHash('sha1').update(s).digest('hex');

/* Reçetenin özeti: sabitler + sayfanın dosyaları. Paketlenmiş uygulamada
   dosyalar asar'ın içinde; Electron'un `fs`i onları da okuyor. */
function recipeHash(root) {
  const h = crypto.createHash('sha1');
  h.update(JSON.stringify(RECIPE));
  for (const rel of PAGE_FILES) {
    h.update('\n' + rel + '\n');
    h.update(fs.readFileSync(path.join(root, rel)));
  }
  return h.digest('hex');
}

/* Presetin görüntüsünü etkileyen dokuların imzası. `lib`: istek başına bir
   kez hazırlanan { names (sıralı, motorun gördüğü liste), stamp(ad) →
   "boyut:değişme" ya da "-" }. Adla istenen doku motordaki gibi çözülüyor
   (uzantısız, büyük/küçük harf ayırmadan, listedeki İLK eşleşen);
   `randNN` yuvası bütün listeden seçtiği için onu kullanan presetin imzası
   bütün listeyi taşıyor. Doku istemeyen presetin imzası boş. */
function textureSig(source, lib) {
  const want = tex.userSamplers(source);
  const names = (lib && Array.isArray(lib.names)) ? lib.names : [];
  const stamp = (n) => (lib && typeof lib.stamp === 'function' ? lib.stamp(n) : '-');
  const stemOf = (f) => { const d = f.lastIndexOf('.'); return (d < 0 ? f : f.slice(0, d)).toLowerCase(); };
  const parts = [];
  for (const base of Array.from(want.names).sort()) {
    const f = names.find((x) => stemOf(x) === base) || '';
    parts.push(base + '=' + (f ? f + '@' + stamp(f) : '-'));
  }
  if (want.rand) parts.push('*=' + names.map((f) => f + '@' + stamp(f)).join(','));
  return parts.join(';');
}

function keyOf(recipe, source, texSig) {
  return sha1(String(recipe || '') + '\n' + String(texSig || '') + '\n' + String(source || ''));
}

const fileOf = (dir, key) => path.join(dir, key + '.webp');

/* Yarım dosya kalmasın: önce geçici ad, sonra yeniden adlandırma. */
function writeAtomic(file, buf) {
  const tmp = file + '.' + process.pid + '.' + crypto.randomBytes(4).toString('hex') + '.tmp';
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(tmp, buf);
  try {
    fs.renameSync(tmp, file);
  } catch (e) {
    try { fs.unlinkSync(tmp); } catch { /* yoksa zaten yok */ }
    throw e;
  }
}

/* `sv-thumb://t/<anahtar>.webp` → dosya. Yalnız 40 haneli onaltılık bir
   anahtar ve yalnız bu klasör: adres bir yol değil, sayfaya dosya sistemi
   açmıyor. */
function fileForUrl(dir, url) {
  let u;
  try { u = new URL(String(url || '')); } catch { return null; }
  if (u.protocol !== 'sv-thumb:') return null;
  const m = /^\/([0-9a-f]{40})\.webp$/.exec(u.pathname || '');
  if (!m) return null;
  return fileOf(dir, m[1]);
}

/* KUYRUK. Bir seferde tek iş; en son istenen parti öne geçiyor (panelde
   görünen hücreler önce), aynı anahtar bir kez çiziliyor ve bekleyen her
   kimliğe bildiriliyor. Kuyruk sınırı aşılınca en eski istekler düşüyor
   (panel görünenleri yeniden istiyor). Başarısız anahtar bu oturumda bir
   daha denenmiyor.
     render(job) → Promise<Buffer|null|{ stale: true }>
       `stale`: iş beklerken anahtarı eskidi (ör. dokular değişti) — başarısız
       sayılmıyor, bekleyenlere "yeniden iste" deniyor.
     onReady(id, key, ok, stale) */
class ThumbQueue {
  constructor(opts) {
    const o = opts || {};
    this.dir = o.dir;
    this.render = o.render;
    this.onReady = typeof o.onReady === 'function' ? o.onReady : () => {};
    this.max = o.max || 800;
    this.queue = [];
    this.byKey = new Map();
    this.failed = new Set();
    this.running = null;
    this.rendered = 0;
  }

  file(key) { return fileOf(this.dir, key); }

  has(key) {
    try { return fs.statSync(this.file(key)).isFile(); } catch { return false; }
  }

  /* items: [{ id, key, source }]. Dönüş: hazır olanlar { id: anahtar } —
     başarısızlar '' ile. Gerisi `onReady`le gelecek. */
  request(items) {
    const ready = {};
    const batch = [];
    const inBatch = new Set();
    for (const it of Array.isArray(items) ? items : []) {
      if (!it || typeof it.id !== 'string' || !KEY_RE.test(String(it.key || ''))) continue;
      if (this.has(it.key)) { ready[it.id] = it.key; continue; }
      if (this.failed.has(it.key)) { ready[it.id] = ''; continue; }
      let job = this.byKey.get(it.key);
      if (!job) {
        job = { key: it.key, source: String(it.source || ''), ids: new Set() };
        this.byKey.set(it.key, job);
      }
      job.ids.add(it.id);
      if (job !== this.running && !inBatch.has(job)) { inBatch.add(job); batch.push(job); }
    }
    this.queue = batch.concat(this.queue.filter((j) => !inBatch.has(j)));
    while (this.queue.length > this.max) this.byKey.delete(this.queue.pop().key);
    this._pump();
    return ready;
  }

  pending() { return this.queue.length + (this.running ? 1 : 0); }

  // Bekleyen işler bırakılıyor (panel kapandı); süren iş kendi sonucunu alıyor
  clear() {
    for (const j of this.queue) this.byKey.delete(j.key);
    this.queue = [];
  }

  async _pump() {
    if (this.running || !this.queue.length) return;
    const job = this.queue.shift();
    this.running = job;
    let res = null;
    try { res = await this.render(job); } catch { res = null; }
    const stale = !!(res && res.stale === true);
    let ok = false;
    if (!stale && res && res.length) {
      try { writeAtomic(this.file(job.key), res); ok = true; } catch { ok = false; }
    }
    if (ok) this.rendered++;
    else if (!stale) this.failed.add(job.key);
    this.byKey.delete(job.key);
    this.running = null;
    for (const id of job.ids) {
      try { this.onReady(id, ok ? job.key : '', ok, stale); } catch { /* dinleyici hatası kuyruğu durdurmasın */ }
    }
    this._pump();
  }
}

/* ARTIK TEMİZLİĞİ. Bugünkü hiçbir presetin anahtarı olmayan dosyalar
   (silinmiş ya da değişmiş presetler, eski reçete) ve yarım kalmış geçici
   dosyalar siliniyor. Oturum başına bir kez, arka planda. `before`: yalnız
   bu andan önce yazılmış dosyalar — anahtarlar hesaplanırken eklenen bir
   presetin yeni küçük resmi listede yok ama artık değil. */
function prune(dir, liveKeys, before) {
  let names;
  try { names = fs.readdirSync(dir); } catch { return { removed: 0, kept: 0 }; }
  const limit = typeof before === 'number' ? before : Infinity;
  let removed = 0;
  let kept = 0;
  for (const n of names) {
    const m = /^([0-9a-f]{40})\.webp$/.exec(n);
    if (m && liveKeys.has(m[1])) { kept++; continue; }
    if (!m && !/\.tmp$/.test(n)) continue; // bizim olmayan dosyaya dokunulmuyor
    const file = path.join(dir, n);
    try {
      if (fs.statSync(file).mtimeMs >= limit) { kept++; continue; }
      fs.unlinkSync(file);
      removed++;
    } catch { /* kilitli ya da gitmiş: sonraki oturum */ }
  }
  return { removed, kept };
}

module.exports = {
  RECIPE, PAGE_FILES, KEY_RE, recipeHash, textureSig, keyOf, writeAtomic, fileForUrl, ThumbQueue, prune,
};
