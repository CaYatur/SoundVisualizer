'use strict';
/* MILKDROP KÜTÜPHANESİ İÇE AKTARIMI (#574, kısım 2). ZIP paketi, klasör ve
 * makinede bulunan kütüphaneler; iki aşama: tarama özet veriyor, onaylanınca
 * kopyalanıyor. Klasörler ve arşivler burada gerçekten kuruluyor.
 *
 * Gerçek veriyle ölçüldü (korpus, yalıtılmış depo): Cream of the Crop
 * klasörü 1,1 sn'de tarandı (9.795 preset, 11 kategori etiketi), 6,2 sn'de
 * içe aktarıldı; aynı paket ikinci kez 1,2 sn'de hepsi tekrar diye atlandı.
 * Orijinal paketin ZIP'i 6 ms'de tarandı; içe aktarımda 14 preset Cream'de
 * aynı ad ve içerikle zaten vardı.
 */
global.window = global.window || {};
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const vm = require('vm');
const zlib = require('zlib');
const I = require('../src/main/milkdrop-import.js');
const Z = require('../src/main/zip-reader.js');
const TEX = require('../src/main/milkdrop-textures.js');
require('../src/shared/defaults.js');
const L = require('../src/shared/milkdrop-library.js');

const ROOT = path.join(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf-8');
const bare = (s) => s.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[^:])\/\/[^\n]*/g, '$1 ');

const made = [];
test.after(() => { for (const d of made) fs.rmSync(d, { recursive: true, force: true }); });
function tmpDir() {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'sv-imp-'));
  made.push(d);
  return d;
}
const put = (base, rel, data) => {
  const f = path.join(base, ...rel.split('/'));
  fs.mkdirSync(path.dirname(f), { recursive: true });
  fs.writeFileSync(f, data);
};

const MILK_A = '[preset00]\nfDecay=0.98\nwarp_1=`ret = tex2D(sampler_worms, uv).xyz + tex2D(sampler_noise_lq, uv).xyz;\n';
const MILK_B = '[preset00]\nfDecay=0.95\nper_frame_1=zoom = 1.01;\n';
const MILK_C = '[preset00]\nfDecay=0.90\ncomp_1=`ret = tex2D(sampler_main, uv).xyz;\n';
// Paketin yapısı: kategoriler, doku klasörleri, gevşek görseller
const LAYOUT = {
  'Fraktal/Geiss - A.milk': MILK_A,
  'Fraktal/Martin - B.milk': MILK_B,
  'Dans/Flexi - C.milk': MILK_C,
  'Dans/Flexi - C.jpg': 'ÖNİZLEME', // gevşek, hiçbir preset istemiyor: doku değil
  'Dans/worms.jpg': 'SOLUCAN', // gevşek, A istiyor: doku
  'textures/clouds.png': 'BULUT', // doku klasörü: hep
  'sprites/logo.png': 'LOGO', // MilkDrop 3'te sprites da doku klasörü
  'cift.milk2': 'MD3',
  'buyuk.milk': 'x'.repeat(I.PRESET_MAX_BYTES + 1),
  'node_modules/gizli.milk': MILK_B,
  'okubeni.txt': 'metin',
};
function packFolder() {
  const d = tmpDir();
  for (const [rel, data] of Object.entries(LAYOUT)) put(d, 'Paket/' + rel, data);
  return path.join(d, 'Paket');
}

// Elle ZIP (tests/zip-reader.test.js'teki yazıcının kısası): deflate, UTF-8 ad
function makeZip(files) {
  const locals = [];
  const central = [];
  let offset = 0;
  for (const f of files) {
    const data = Buffer.from(f.data);
    const method = f.method == null ? 8 : f.method;
    const comp = method === 8 ? zlib.deflateRawSync(data) : data;
    const name = Buffer.from(f.name, 'utf8');
    const flags = 0x800 | (f.flags || 0);
    const lh = Buffer.alloc(30);
    lh.writeUInt32LE(0x04034b50, 0);
    lh.writeUInt16LE(flags, 6);
    lh.writeUInt16LE(method, 8);
    lh.writeUInt32LE(Z.crc32(data), 14);
    lh.writeUInt32LE(comp.length, 18);
    lh.writeUInt32LE(data.length, 22);
    lh.writeUInt16LE(name.length, 26);
    const cd = Buffer.alloc(46);
    cd.writeUInt32LE(0x02014b50, 0);
    cd.writeUInt16LE(flags, 8);
    cd.writeUInt16LE(method, 10);
    cd.writeUInt32LE(Z.crc32(data), 16);
    cd.writeUInt32LE(comp.length, 20);
    cd.writeUInt32LE(data.length, 24);
    cd.writeUInt16LE(name.length, 28);
    cd.writeUInt32LE(offset, 42);
    locals.push(lh, name, comp);
    central.push(cd, name);
    offset += 30 + name.length + comp.length;
  }
  const cdBuf = Buffer.concat(central);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(files.length, 8);
  eocd.writeUInt16LE(files.length, 10);
  eocd.writeUInt32LE(cdBuf.length, 12);
  eocd.writeUInt32LE(offset, 16);
  return Buffer.concat(locals.concat([cdBuf, eocd]));
}
function packZip(extra) {
  const files = Object.entries(LAYOUT).map(([rel, data]) => ({ name: 'Paket/' + rel, data }));
  const d = tmpDir();
  const f = path.join(d, 'paket.zip');
  fs.writeFileSync(f, makeZip(files.concat(extra || [])));
  return f;
}

// Sahte depo: kaydedileni tutuyor, toplu kaydı ilerlemeyle bildiriyor
function fakeStore(existing) {
  const all = (existing || []).slice();
  let n = 0;
  return {
    all,
    existing: () => all,
    saveManyAsync: async (items, onProgress) => {
      const saved = items.map((p) => Object.assign({}, p, { id: p.id || 'md_t' + (n++) }));
      all.push(...saved);
      if (onProgress) onProgress(saved.length, items.length);
      return saved;
    },
  };
}

// --------------------------------------------------------------- tarama

test('klasör taraması: presetler, dokular, atlananlar, kategori etiketleri', async () => {
  const plan = await I.scanFolder(packFolder());
  const s = I.summary(plan);
  assert.deepStrictEqual([s.kind, s.label, s.presets, s.textures, s.loose, s.complete, s.searchCut], ['folder', 'Paket', 3, 2, 2, true, false]);
  // Boyut: presetler ve doku klasörü; yanlardaki görseller ayrı (yalnız istenirse kopyalanıyor)
  const size = (list) => list.reduce((n, x) => n + x.size, 0);
  assert.strictEqual(s.bytes, size(plan.presets) + size(plan.textures));
  assert.strictEqual(plan.looseBytes, size(plan.loose));
  assert.deepStrictEqual(s.skipped, { milk2: 1, tooLarge: 1, encrypted: 0, unsupported: 0, textureTooLarge: 0 });
  assert.strictEqual(s.tags, 2);
  const byName = Object.fromEntries(plan.presets.map((p) => [p.name, p.tag]));
  assert.deepStrictEqual(byName, { 'Geiss - A': 'Fraktal', 'Martin - B': 'Fraktal', 'Flexi - C': 'Dans' }, 'node_modules atlandı');
  assert.deepStrictEqual(plan.textures.map((t) => t.name).sort(), ['clouds.png', 'logo.png']);
  assert.deepStrictEqual(plan.loose.map((t) => t.name).sort(), ['Flexi - C.jpg', 'worms.jpg']);
  assert.strictEqual(s.where, undefined, 'özette yol yok');
});

test('ZIP taraması aynı planı veriyor; şifreli ve desteklenmeyen girdi sayılıyor', () => {
  const f = packZip([
    { name: 'Paket/Dans/sifreli.milk', data: 'x', flags: 1 },
    // macOS'un ZIP'e koyduğu AppleDouble kalıntıları: preset değil
    { name: '__MACOSX/Paket/Fraktal/._Geiss - A.milk', data: 'ikili' },
    { name: '__MACOSX/Paket/Fraktal/meta.milk', data: 'ikili' },
    { name: 'Paket/Dans/._Flexi - C.milk', data: 'ikili' },
    { name: 'Paket/.git/eski.milk', data: MILK_B },
  ]);
  const s = I.summary(I.scanZip(f));
  assert.deepStrictEqual([s.kind, s.label, s.presets, s.textures, s.loose, s.tags], ['zip', 'paket', 3, 2, 2, 2]);
  assert.strictEqual(s.skipped.encrypted, 1);
  assert.strictEqual(s.skipped.milk2, 1);
});

test('etiket: ortak ön ek atılıyor, genel klasör adları etiket değil', () => {
  const P = (dirs) => ({ dirs, tag: '' });
  const a = [P(['cream-master', 'Fractal', 'Nested']), P(['cream-master', 'Dancer']), P(['cream-master'])];
  I.assignTags(a);
  assert.deepStrictEqual(a.map((p) => p.tag), ['Fractal', 'Dancer', '']);
  const b = [P(['Milkdrop2', 'presets', 'Geiss']), P(['Milkdrop2', 'presets', 'Martin'])];
  I.assignTags(b);
  assert.deepStrictEqual(b.map((p) => p.tag), ['Geiss', 'Martin']);
  const c = [P(['tek'])];
  I.assignTags(c);
  assert.deepStrictEqual(c.map((p) => p.tag), [''], 'tek klasörlü paket etiketsiz');
  const d = [P(['x', 'presets']), P(['x', 'resources'])];
  I.assignTags(d);
  assert.deepStrictEqual(d.map((p) => p.tag), ['', ''], 'genel adlar');
});

// ------------------------------------------------------------ çalıştırma

test('içe aktarım: presetler kaydediliyor, dokular yalnız gerekenler, etiketler dönüyor', async () => {
  const plan = await I.scanFolder(packFolder());
  const store = fakeStore();
  const texDir = path.join(tmpDir(), 'dokular');
  const phases = new Set();
  const r = await I.runImport(plan, { existing: store.existing, saveManyAsync: store.saveManyAsync, textureDir: texDir, onProgress: (ph) => phases.add(ph) });
  assert.strictEqual(r.ok, true);
  assert.deepStrictEqual([r.added, r.duplicates, r.failed], [3, 0, 0]);
  assert.deepStrictEqual(fs.readdirSync(texDir).sort(), ['clouds.png', 'logo.png', 'worms.jpg'], 'önizleme görüntüsü doku değil');
  assert.strictEqual(fs.readFileSync(path.join(texDir, 'worms.jpg'), 'utf8'), 'SOLUCAN');
  assert.deepStrictEqual(r.textures, { copied: 3, same: 0, conflicts: 0, failed: 0 });
  assert.deepStrictEqual(r.saved.map((x) => x.tag).sort(), ['Dans', 'Fraktal', 'Fraktal']);
  assert.ok(r.presets.length === 3 && r.presets.every((p) => p.kind === 'milkdrop' && p.source), 'ana süreç yayın için alıyor');
  assert.deepStrictEqual([...phases].sort(), ['read', 'save', 'textures']);
  assert.deepStrictEqual(r.skipped.milk2, 1);
  // İkinci kez: hepsi tekrar, dokular zaten var
  const r2 = await I.runImport(plan, { existing: store.existing, saveManyAsync: store.saveManyAsync, textureDir: texDir });
  assert.deepStrictEqual([r2.added, r2.duplicates], [0, 3]);
  assert.deepStrictEqual(r2.textures, { copied: 0, same: 3, conflicts: 0, failed: 0 });
});

test('içe aktarım: aynı ad başka içerik tekrar değil; var olan dokunun üstüne yazılmıyor', async () => {
  const plan = await I.scanFolder(packFolder());
  const store = fakeStore([{ id: 'x', kind: 'milkdrop', name: 'Geiss - A', source: 'BAŞKA' }, { id: 'y', kind: 'milkdrop', name: 'Martin - B', source: MILK_B }]);
  const texDir = path.join(tmpDir(), 'dokular');
  put(texDir, 'clouds.png', 'KULLANICININ');
  const r = await I.runImport(plan, { existing: store.existing, saveManyAsync: store.saveManyAsync, textureDir: texDir });
  assert.deepStrictEqual([r.added, r.duplicates], [2, 1], 'yalnız Martin - B aynı');
  assert.strictEqual(r.textures.conflicts, 1);
  assert.strictEqual(fs.readFileSync(path.join(texDir, 'clouds.png'), 'utf8'), 'KULLANICININ', 'var olan kaldı');
});

test('ZIP içe aktarımı; ad yol dışına çıkamıyor (zip-slip)', async () => {
  const f = packZip([
    { name: '../../kacak/Kacak - D.milk', data: MILK_B + ';kaçak' },
    { name: 'Paket/../../../textures/kacak.png', data: 'KAÇAK' },
  ]);
  const plan = I.scanZip(f);
  const store = fakeStore();
  const base = tmpDir();
  const texDir = path.join(base, 'a', 'b', 'dokular');
  const r = await I.runImport(plan, { existing: store.existing, saveManyAsync: store.saveManyAsync, textureDir: texDir });
  assert.strictEqual(r.added, 4);
  assert.ok(store.all.some((p) => p.name === 'Kacak - D'), 'yalnız dosya adı alındı');
  assert.deepStrictEqual(fs.readdirSync(texDir).sort(), ['clouds.png', 'kacak.png', 'logo.png', 'worms.jpg']);
  assert.ok(!fs.existsSync(path.join(base, 'kacak')) && !fs.existsSync(path.join(base, 'a', 'kacak.png')), 'klasör dışına yazılmadı');
});

test('metin çözümü ve örnekleyici adları', () => {
  assert.strictEqual(I.decodeText(Buffer.from('ğüş', 'utf8')), 'ğüş');
  assert.strictEqual(I.decodeText(Buffer.from([0x63, 0x61, 0x66, 0xe9])), 'café', 'geçersiz UTF-8: Latin-1');
  assert.deepStrictEqual([...I.samplerNames(MILK_A + 'sampler_blur2 sampler_rand03 sampler_rand00_smalltiled sampler_Clouds2 sampler_fw_main')].sort(), ['clouds2', 'worms']);
});

// ----------------------------------------------------------- makinede arama

test('makinede arama: bilinen yer, kullanıcı klasörleri, ZIP; boş olan listelenmiyor', async () => {
  const home = tmpDir();
  put(home, '.projectM/presets/Geiss - P.milk', MILK_B);
  put(home, 'Downloads/cream-master/Fractal/X - Y.milk', MILK_A);
  put(home, 'Downloads/cream-master/textures/worms.jpg', 'W');
  put(home, 'Documents/Adobe/Presets/ayar.txt', 'değil');
  // Bulunan ama alınacak preseti olmayan (tek preseti sınırı aşıyor): listelenmiyor
  put(home, 'Desktop/dev/buyuk.milk', 'x'.repeat(I.PRESET_MAX_BYTES + 1));
  fs.writeFileSync(path.join(home, 'Downloads', 'paket.zip'), makeZip([{ name: 'p/a.milk', data: MILK_C }]));
  fs.writeFileSync(path.join(home, 'Downloads', 'bozuk.zip'), 'ZIP değil');
  const r = await I.discover({ platform: 'linux', home });
  assert.strictEqual(r.complete, true, 'bütün adaylara bakıldı');
  // Yalnız bu testin ev klasörü: CI makinesinde projectM kurulu olsa da sonuç değişmesin
  const rows = r.libraries.filter((p) => path.resolve(p.source).indexOf(path.resolve(home)) === 0)
    .map((p) => [p.label, p.kind, p.presets.length, !!p.searchCut]);
  assert.deepStrictEqual(rows.sort(), [['cream-master', 'folder', 1, false], ['paket.zip', 'zip', 1, false], ['projectM', 'folder', 1, false]]);
  // Bütçe biterse yarıda kalıyor ve bunu söylüyor
  const cut = await I.scanFolder(path.join(home, 'Downloads'), { budget: { files: 2, deadline: Infinity } });
  assert.strictEqual(cut.complete, false);
});

test('makinede arama: genişlik öncelikli — dev bir komşu küçük paketi gizlemiyor; açıkça verilen kök önce', async () => {
  const home = tmpDir();
  /* İndirilenler'de dev bir klasör: dar başlıyor, dipte geniş. Derinlik
     öncelikli tarama bütçeyi burada bitirip yanındaki pakete varamıyordu
     (Windows'ta klasörler ada göre sıralı geliyor, "aaa" önce). */
  for (let i = 0; i < 150; i++) put(home, 'Downloads/aaa-dev/d/d/d/k' + i + '/x.txt', 'x');
  put(home, 'Downloads/zzz-paket/Kategori/A - B.milk', MILK_B);
  const extra = tmpDir();
  put(extra, 'deneme/C - D.milk', MILK_C);
  /* Sistem klasörü adayı yok (Program Files verilmedi): CI makinesinde
     projectM kurulu olsa bile bütçeden yemesin, sonuç makineye bağlı olmasın */
  const r = await I.discover({ platform: 'win32', home }, { maxFiles: 100, roots: [extra] });
  const labels = r.libraries.map((p) => p.label);
  assert.deepStrictEqual(labels, ['deneme', 'zzz-paket'], 'açıkça verilen kök önce, komşusunun dibine inilmeden bulundu');
  assert.strictEqual(r.complete, false, 'bütçe bitti: bazı klasörlere bakılamadığı söyleniyor');
  const pack = r.libraries[1];
  assert.deepStrictEqual([pack.presets.length, pack.complete, !!pack.searchCut], [1, true, false], 'bulunan baştan sona sayıldı');
});

test('makinede arama: süresi yetmeyen kütüphane sayılmadan listeleniyor; baştan tarama tamamını sayıyor', async () => {
  const dir = packFolder();
  const [cut] = await I.countLibraries([{ label: 'Paket', dir }], Date.now() - 1);
  assert.deepStrictEqual([cut.presets.length, cut.complete, cut.searchCut], [0, false, true], 'bulunan listeden düşmedi');
  assert.strictEqual(I.summary(cut).searchCut, true);
  const full = I.summary(await I.rescan(cut));
  assert.deepStrictEqual([full.presets, full.textures, full.loose, full.complete, full.searchCut], [3, 2, 2, true, false]);
  // Süre varsa sayılıyor; ZIP'in planı bulunurken hazır, yeniden sayılmıyor
  const zipPlan = I.scanZip(packZip());
  const both = await I.countLibraries([{ label: 'Paket', dir }, { label: 'paket.zip', dir: zipPlan.source, plan: zipPlan }], Date.now() + 60000);
  assert.deepStrictEqual(both.map((p) => [p.kind, p.presets.length, !!p.searchCut]), [['folder', 3, false], ['zip', 3, false]]);
  assert.strictEqual(both[1], zipPlan);
});

test('makinede arama: kullanıcı klasörünün kendisindeki presetler ayrı kütüphane, alt klasörlerine inilmeden', async () => {
  const home = tmpDir();
  // Sistemin verdiği yerel adlı klasör (Linux: ~/İndirilenler)
  const dl = path.join(home, 'İndirilenler');
  put(dl, 'Tek - Bir.milk', MILK_B);
  put(dl, '._Tek - Bir.milk', 'ikili'); // AppleDouble: preset değil
  put(dl, 'paket/Kat/Iki - Uc.milk', MILK_C);
  const r = await I.discover({ platform: 'linux', home, downloads: dl });
  const rows = r.libraries.filter((p) => path.resolve(p.source).indexOf(path.resolve(home)) === 0)
    .map((p) => [p.label, p.presets.map((x) => x.name).join(',')]);
  assert.deepStrictEqual(rows.sort(), [['paket', 'Iki - Uc'], ['İndirilenler', 'Tek - Bir']]);
  const own = r.libraries.find((p) => p.label === 'İndirilenler');
  assert.strictEqual(own.shallow, true);
  assert.deepStrictEqual((await I.rescan(own)).presets.map((x) => x.name), ['Tek - Bir'], 'baştan tarama da alt klasörlere inmiyor');
});

test('kullanıcı klasörleri: sistemin verdiği yer önce; sıra İndirilenler → Masaüstü → Müzik → Belgeler', () => {
  const n = (list) => list.map((d) => d.replace(/\\/g, '/'));
  assert.deepStrictEqual(n(I.homeRoots({ home: '/h' })), ['/h/Downloads', '/h/Desktop', '/h/Music', '/h/Documents']);
  // Linux'ta yerel adlar, Windows'ta OneDrive'a taşınmış Belgeler
  assert.deepStrictEqual(n(I.homeRoots({ home: '/h', downloads: '/h/İndirilenler', documents: '/h/OneDrive/Belgeler' })),
    ['/h/İndirilenler', '/h/Desktop', '/h/Music', '/h/OneDrive/Belgeler']);
  assert.deepStrictEqual(I.homeRoots({}), []);
});

test('bilinen yerler: Windows, macOS ve Linux kurulum klasörleri', () => {
  const w = I.candidates({ platform: 'win32', home: 'C:/U', appData: 'C:/U/AppData/Roaming', programFiles: 'C:/PF', programFilesX86: 'C:/PF86' });
  const ws = w.map((c) => c.dir.replace(/\\/g, '/'));
  assert.ok(ws.includes('C:/PF86/Winamp/Plugins/Milkdrop2'));
  assert.ok(ws.includes('C:/U/AppData/Roaming/foobar2000-v2/milkdrop2'));
  assert.ok(I.candidates({ platform: 'linux', home: '/h' }).some((c) => c.dir.replace(/\\/g, '/') === '/usr/share/projectM/presets'));
  assert.ok(I.candidates({ platform: 'darwin', home: '/h' }).some((c) => /projectM\.app/.test(c.dir)));
});

// --------------------------------------------------------------- dokular

test('dokular iki klasörden: önce kullanıcınınki, ad bir kez', () => {
  const a = tmpDir();
  const b = tmpDir();
  put(a, 'clouds.png', 'KULLANICI');
  put(b, 'Clouds.png', 'PAKET');
  put(b, 'worms.jpg', 'SOLUCAN');
  const names = TEX.listTexturesIn([a, b]).names;
  assert.deepStrictEqual(names.sort(), ['clouds.png', 'worms.jpg']);
  assert.strictEqual(fs.readFileSync(TEX.textureFileInfoIn([a, b], 'clouds.png', 1024).file, 'utf8'), 'KULLANICI');
  assert.strictEqual(fs.readFileSync(TEX.textureFileInfoIn(['', b], 'worms.jpg', 1024).file, 'utf8'), 'SOLUCAN', 'klasör seçilmemişse de');
  assert.strictEqual(TEX.textureFileInfoIn([a, b], '../x.png', 1024), null);
});

test('motor: içe aktarılan dokular için liste yeniden isteniyor, klasör seçilmemişse de', () => {
  let asked = 0;
  const canvas = () => ({ width: 64, height: 64, getContext: (k) => (k === '2d' ? {} : null), addEventListener() {} });
  const ctx = { window: {}, document: { createElement: canvas }, console, performance };
  ctx.window.document = ctx.document;
  ctx.window.api = { milkdropTextures: () => { asked++; return Promise.resolve({ names: [] }); } };
  vm.createContext(ctx);
  for (const f of ['src/shared/milkdrop.js', 'src/shared/milkdrop-cycle.js', 'src/visualizer/modes/milkdrop.js']) {
    vm.runInContext(read(f), ctx, { filename: f });
  }
  const m = new ctx.window.SVModes.milkdrop(canvas());
  const at = (dir, rev) => m._ensureTextureLib({ milkdrop: { textureDir: dir }, milkdropLibrary: { textureRev: rev } });
  at('', 0);
  assert.strictEqual(asked, 0, 'hiçbir şey yokken istek yok');
  at('', 1);
  assert.strictEqual(asked, 1, 'içe aktarımdan sonra');
  at('', 1);
  assert.strictEqual(asked, 1);
  at('', 2);
  assert.strictEqual(asked, 2, 'her içe aktarım yeniden');
  at('C:/dokular', 2);
  assert.strictEqual(asked, 3);
});

// ------------------------------------------------------------ ana süreç

test('ana süreç: tarama planı burada, sayfaya özet; içe aktarım tek yayın', () => {
  const M = bare(read('src/main/main.js'));
  assert.match(M, /function managedTextureDir\(\) \{\s*return path\.join\(app\.getPath\('userData'\), 'milkdrop-textures'\);/);
  const imp = /ipcMain\.handle\('milkdrop:library-import', async \(e, token\) => \{[\s\S]*?\n\}\);/.exec(M);
  assert.ok(imp, 'içe aktarım işleyicisi yok');
  assert.match(imp[0], /textureDir: managedTextureDir\(\),/);
  assert.match(imp[0], /sender\.send\('milkdrop:library-progress', \{ phase, done, total \}\)/);
  assert.match(imp[0], /if \(r\.presets && r\.presets\.length\) broadcastPresetDelta\(r\.presets, \[\]\);\s*delete r\.presets;/);
  assert.match(M, /return Object\.assign\(\{ token, where: plan\.source \}, mdImport\.summary\(plan\)\);/);
  assert.match(M, /ipcMain\.handle\('milkdrop:library-pick', async \(e, kind\) => \{/);
  // Arama: kullanıcı klasörlerinin gerçek yeri sistemden, sonuç bütün adaylara bakılıp bakılmadığını taşıyor
  const disc = /ipcMain\.handle\('milkdrop:library-discover', async \(\) => \{[\s\S]*?\n\}\);/.exec(M);
  assert.ok(disc, 'arama işleyicisi yok');
  for (const k of ['downloads', 'desktop', 'music', 'documents']) assert.ok(disc[0].includes(k + ": knownFolder('" + k + "'),"), k);
  assert.match(disc[0], /return \{ ok: true, complete: r\.complete, libraries: r\.libraries\.map\(keepPlan\) \};/);
  // Eksik sayılan: baştan taranıp eski planın yerine
  const re = /ipcMain\.handle\('milkdrop:library-rescan', async \(e, token\) => \{[\s\S]*?\n\}\);/.exec(M);
  assert.ok(re, 'baştan tarama işleyicisi yok');
  assert.match(re[0], /const plan = await mdImport\.rescan\(old\);\s*libraryPlans\.delete\(key\);\s*return Object\.assign\(\{ ok: true \}, keepPlan\(plan\)\);/);
  const A = read('src/main/preload-admin.js');
  for (const k of ['pickMilkdropLibrary', 'discoverMilkdropLibraries', 'rescanMilkdropLibrary', 'importMilkdropLibrary', 'onMilkdropLibraryProgress']) assert.ok(A.includes(k + ':'), k);
});

// ----------------------------------------------------------------- panel

function el(tag, props, kids) {
  const n = { tag, props: props || {}, text: (props && props.text) || '', kids: [], on: {}, value: '', attrs: {} };
  n.className = (props && props.class) || '';
  n.appendChild = (c) => { n.kids.push(c); return c; };
  n.addEventListener = (ev, f) => { n.on[ev] = f; };
  n.setAttribute = (k, v) => { n.attrs[k] = v; };
  n.getAttribute = (k) => n.attrs[k];
  n.removeAttribute = () => {};
  Object.defineProperty(n, 'textContent', { get: () => n.text, set: (v) => { n.text = v; n.kids = []; } });
  for (const k of Object.keys(n.props)) if (k.indexOf('on') === 0 && typeof n.props[k] === 'function') n.on[k.slice(2)] = n.props[k];
  (kids || []).forEach((c) => c && n.kids.push(c));
  return n;
}
const walk = (n, f) => { if (!n || typeof n !== 'object') return; f(n); (n.kids || []).forEach((k) => walk(k, f)); if (n.node) walk(n.node, f); };
const find = (root, text) => { let b = null; walk(root, (n) => { if (!b && n.props && n.props.text === text) b = n; }); return b; };

async function panelWith(api, setup) {
  const key = require.resolve('../src/admin/milkdrop-panel.js');
  delete require.cache[key];
  const cfg = global.window.SV.defaultConfig();
  if (setup) setup(cfg);
  const calls = { apply: 0, confirms: [], toasts: [] };
  global.document = { querySelector: () => null, getElementById: () => null, activeElement: null };
  window.SVMilkdropCycle = require('../src/shared/milkdrop-cycle.js');
  window.SVMilkdropLibrary = L;
  window.SVPresets = undefined;
  window.api = Object.assign({ listPresets: () => Promise.resolve([]) }, api);
  window.SVPanel = {
    cfg: () => cfg, apply() { calls.apply++; }, rerender() {}, el,
    row: (label, node) => ({ label, node }), confirm: (m) => { calls.confirms.push(m); return Promise.resolve(true); },
    toast: (m) => calls.toasts.push(m),
  };
  window.SVScenePanels = { miniSlider: (label) => ({ label, kids: [] }) };
  const M = require('../src/admin/milkdrop-panel.js');
  M.init();
  await new Promise((r) => setImmediate(r));
  return { M, cfg, calls, render: () => M.panel() };
}

const SUMMARY = { ok: true, token: 'lib_1', where: 'C:/x', kind: 'zip', label: 'cream', presets: 3, textures: 2, bytes: 3 * 1048576, complete: true, tooBig: false, skipped: { milk2: 1, tooLarge: 0, encrypted: 0, unsupported: 0, textureTooLarge: 0 }, tags: 2 };
const RESULT = { ok: true, added: 3, duplicates: 1, failed: 0, textures: { copied: 2, same: 0, conflicts: 1, failed: 0 }, skipped: { milk2: 1 }, saved: [{ id: 'n1', tag: 'Fraktal' }, { id: 'n2', tag: 'Fraktal' }, { id: 'n3', tag: '' }] };

test('panel: ZIP seçimi → özet onayı → içe aktarım → etiketler ve doku sayacı', async () => {
  let imported = null;
  const p = await panelWith({
    pickMilkdropLibrary: (kind) => Promise.resolve(Object.assign({ kind }, SUMMARY)),
    importMilkdropLibrary: (token) => { imported = token; return Promise.resolve(RESULT); },
  });
  await find(p.render(), '🗜 ZIP Paketinden İçe Aktar').on.click();
  assert.strictEqual(imported, 'lib_1');
  assert.strictEqual(p.calls.confirms.length, 1, 'kopyalamadan önce soruluyor');
  const msg = p.calls.confirms[0];
  for (const part of ['“cream”: 3 preset, 2 doku, 3 MB.', '1 .milk2 dosyası', '2 klasör adı etiket olacak.', 'Devam edilsin mi?']) {
    assert.ok(msg.includes(part), 'özet: ' + part + ' — ' + msg);
  }
  const lib = p.cfg.milkdropLibrary;
  assert.deepStrictEqual(lib.tags, { n1: ['Fraktal'], n2: ['Fraktal'] });
  assert.strictEqual(lib.textureRev, 1, 'dokular kopyalandı: motorlar listeyi yeniden istesin');
  assert.ok(p.calls.apply > 0);
  const note = [];
  walk(p.render(), (n) => { if (/md-ok/.test(n.className || '') && n.text) note.push(n.text); });
  assert.ok(note.some((t) => t.startsWith('3 preset eklendi, 1 tekrar atlandı.') && t.includes('2 doku kopyalandı.') && t.includes('1 doku adı')), note.join(' | '));
});

test('panel: onay verilmezse içe aktarım yok; klasör adları kapalıysa etiket yok', async () => {
  let imported = 0;
  const p = await panelWith({
    pickMilkdropLibrary: () => Promise.resolve(SUMMARY),
    importMilkdropLibrary: () => { imported++; return Promise.resolve(RESULT); },
  }, (cfg) => { cfg.milkdropControl.importFolderTags = false; });
  window.SVPanel.confirm = () => Promise.resolve(false);
  await find(p.render(), '📁 Klasörden İçe Aktar').on.click();
  assert.strictEqual(imported, 0, 'sormadan kopya yok');
  window.SVPanel.confirm = () => Promise.resolve(true);
  await find(p.render(), '📁 Klasörden İçe Aktar').on.click();
  assert.strictEqual(imported, 1);
  assert.deepStrictEqual(p.cfg.milkdropLibrary.tags, {}, 'etiket yapılmadı');
});

test('panel: makinede arama listesi ve hata metinleri', async () => {
  const p = await panelWith({
    discoverMilkdropLibraries: () => Promise.resolve({ ok: true, libraries: [SUMMARY, Object.assign({}, SUMMARY, { token: 'lib_2', label: 'Winamp (MilkDrop 2)', presets: 552, textures: 0, bytes: 4777905 })] }),
    importMilkdropLibrary: () => Promise.resolve({ ok: false, error: 'NO_PLAN' }),
    pickMilkdropLibrary: () => Promise.resolve({ ok: false, error: 'NOT_ZIP' }),
  });
  await find(p.render(), '🔎 Makinede Ara').on.click();
  const r = p.render();
  const row = r.kids.find((n) => n && n.label === 'Bulunan Kütüphaneler');
  assert.ok(row, 'liste yok');
  assert.deepStrictEqual(row.node.kids.map((it) => it.kids[1].text), ['3 preset · 2 doku · 3 MB', '552 preset · 0 doku · 4,6 MB']);
  await row.node.kids[1].kids[2].on.click();
  assert.ok(p.calls.toasts.includes('Bu tarama artık geçerli değil; yeniden tarayın.'));
  await find(p.render(), '🗜 ZIP Paketinden İçe Aktar').on.click();
  assert.ok(p.calls.toasts.includes('ZIP okunamadı: bozuk ya da ZIP değil.'));
  // Boş arama sonucu söyleniyor
  window.api.discoverMilkdropLibraries = () => Promise.resolve({ ok: true, libraries: [] });
  await find(p.render(), '🔎 Makinede Ara').on.click();
  const texts = [];
  walk(p.render(), (n) => { if (n.text) texts.push(n.text); });
  assert.ok(texts.some((t) => t.startsWith('Bilinen kurulum klasörlerinde')));
});

test('panel: süresi yetmeyen kütüphane "+" ile listeleniyor, onaydan önce tamamı taranıyor', async () => {
  const rescans = [];
  let imported = null;
  const CUT = Object.assign({}, SUMMARY, { token: 'lib_c', kind: 'folder', presets: 120, complete: false, searchCut: true });
  const NONE = Object.assign({}, SUMMARY, { token: 'lib_n', kind: 'folder', label: 'Winamp (MilkDrop 2)', presets: 0, textures: 0, bytes: 0, complete: false, searchCut: true });
  const FULL = Object.assign({}, SUMMARY, { token: 'lib_f', kind: 'folder', presets: 9795, textures: 4, loose: 12, bytes: 60 * 1048576 });
  const p = await panelWith({
    discoverMilkdropLibraries: () => Promise.resolve({ ok: true, complete: false, libraries: [CUT, NONE] }),
    rescanMilkdropLibrary: (token) => { rescans.push(token); return Promise.resolve(Object.assign({ ok: true }, FULL)); },
    importMilkdropLibrary: (token) => { imported = token; return Promise.resolve(RESULT); },
  });
  await find(p.render(), '🔎 Makinede Ara').on.click();
  const rows = () => p.render().kids.find((n) => n && n.label === 'Bulunan Kütüphaneler').node.kids;
  assert.deepStrictEqual(rows().map((it) => it.kids[1].text), ['120+ preset · 2+ doku · 3+ MB', 'sayılmadı']);
  const texts = [];
  walk(p.render(), (n) => { if (n.text) texts.push(n.text); });
  assert.ok(texts.some((t) => t.startsWith('Aramanın süresi bazı kütüphaneleri')), 'eksik sayım açıklanıyor');
  assert.ok(texts.some((t) => t.startsWith('Arama süre sınırına ulaştı')), 'bakılamayan klasörler söyleniyor');
  await rows()[0].kids[2].on.click();
  assert.deepStrictEqual(rescans, ['lib_c'], 'onaydan önce baştan tarandı');
  assert.strictEqual(imported, 'lib_f', 'eksik plan içe aktarılmadı');
  const msg = p.calls.confirms[0];
  assert.ok(msg.includes('“cream”: 9.795 preset, 4 doku, 60 MB.'), msg + ' — sayı Türkçe ayrılıyor');
  assert.ok(msg.includes('Presetlerin yanındaki 12 görselden yalnız presetlerin istediği kopyalanır.'), msg);
  assert.ok(!msg.includes('Tarama yarıda kesildi'), 'tam sayıldı: yarıda uyarısı yok');
  // Baştan tarama da sınıra takılırsa (çok büyük klasör) olağan onay; ikinci kez taranmıyor
  window.api.rescanMilkdropLibrary = (token) => { rescans.push(token); return Promise.resolve(Object.assign({ ok: true }, FULL, { token: 'lib_g', complete: false, searchCut: false })); };
  await rows()[0].kids[2].on.click();
  assert.deepStrictEqual(rescans, ['lib_c', 'lib_n']);
  assert.strictEqual(imported, 'lib_g');
  assert.ok(p.calls.confirms[1].includes('Tarama yarıda kesildi'), p.calls.confirms[1]);
  // Baştan tarama başarısızsa içe aktarım yok
  imported = null;
  window.api.discoverMilkdropLibraries = () => Promise.resolve({ ok: true, complete: true, libraries: [CUT] });
  window.api.rescanMilkdropLibrary = () => Promise.resolve({ ok: false, error: 'NO_PLAN' });
  await find(p.render(), '🔎 Makinede Ara').on.click();
  await rows()[0].kids[2].on.click();
  assert.strictEqual(imported, null);
  assert.strictEqual(p.calls.confirms.length, 2, 'sorulmadı bile');
  assert.ok(p.calls.toasts.includes('Bu tarama artık geçerli değil; yeniden tarayın.'));
  const after = [];
  walk(p.render(), (n) => { if (n.text) after.push(n.text); });
  assert.ok(!after.some((t) => t.startsWith('Arama süre sınırına ulaştı')), 'tam aramada o not yok');
});

test('toplu etiket: eşlem bir kez kopyalanıyor, var olan etiketler kalıyor', () => {
  const lib = { tags: { a: ['Sakin'] } };
  const out = L.addTags(lib, [{ id: 'a', tag: 'Fraktal' }, { id: 'b', tag: 'Dans' }, { id: 'c', tag: '' }, { id: '__proto__', tag: 'x' }]);
  assert.deepStrictEqual(out, { a: ['Sakin', 'Fraktal'], b: ['Dans'] });
  assert.notStrictEqual(out, lib.tags);
});

test('metinlerin İngilizcesi var', () => {
  const I18N = read('src/shared/i18n.js');
  const PANEL = read('src/admin/milkdrop-panel.js');
  for (const k of [
    '🗜 ZIP Paketinden İçe Aktar', '📁 Klasörden İçe Aktar', '🔎 Makinede Ara', 'Klasör Adları', 'Etiket yap', 'Etiket yapma',
    'Bulunan Kütüphaneler', 'İçe Aktar', 'Taranıyor…', 'Makinede aranıyor…', 'İçe aktarılıyor…',
    'Okunuyor: {a}/{b}', 'Kaydediliyor: {a}/{b}', 'Dokular: {a}/{b}', '“{label}”: {p} preset, {t} doku, {mb} MB.',
    '{a} preset eklendi, {d} tekrar atlandı.', '{c} doku kopyalandı.', '{p} preset · {t} doku · {mb} MB',
    'Bu kaynakta MilkDrop preseti yok.', 'ZIP okunamadı: bozuk ya da ZIP değil.', 'İçe aktarılamadı.',
    '{p}+ preset · {t}+ doku · {mb}+ MB', 'sayılmadı', 'Presetlerin yanındaki {n} görselden yalnız presetlerin istediği kopyalanır.',
    'Aramanın süresi bazı kütüphaneleri saymaya yetmedi (+ ya da “sayılmadı”); içe aktarmadan önce tamamı taranır.',
    'Arama süre sınırına ulaştı, bazı klasörlere bakılamadı. Kütüphaneniz listede yoksa 📁 Klasörden İçe Aktar ile seçin.',
  ]) {
    assert.ok(PANEL.includes("'" + k + "'"), k + ' panelde yok');
    assert.ok(I18N.includes("'" + k + "':"), k + ' sözlükte yok');
  }
  // Şablonların İngilizcesi aynı yer tutucuları taşıyor
  for (const [tr, en] of [
    ['“{label}”: {p} preset, {t} doku, {mb} MB.', '{label}{p}{t}{mb}'], ['{p} preset · {t} doku · {mb} MB', '{p}{t}{mb}'],
    ['{p}+ preset · {t}+ doku · {mb}+ MB', '{p}{t}{mb}'], ['Presetlerin yanındaki {n} görselden yalnız presetlerin istediği kopyalanır.', '{n}'],
  ]) {
    const m = new RegExp("'" + tr.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + "': '([^']*)'").exec(I18N);
    assert.ok(m, tr);
    assert.deepStrictEqual((m[1].match(/\{\w+\}/g) || []).join(''), en);
  }
});
