'use strict';
/* Tam yedek: ZIP yazıcı okuyucuyla gidiş-dönüş (ZIP64 dahil), arşivin
 * içeriği, başka bir makineye geri yükleme (kimlikler, videoların yeni
 * yolları, yerel öğelerin korunması) ve güvenilmez arşiv. */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const ZipWriter = require('../src/main/zip-writer');
const ZipReader = require('../src/main/zip-reader');
const Backup = require('../src/main/full-backup');
const mediaUrl = require('../src/shared/media-url');

function tmpdir() { return fs.mkdtempSync(path.join(os.tmpdir(), 'sv-fb-')); }
function put(file, data) { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, data); return file; }

for (const forceZip64 of [false, true]) {
  test('ZIP yazıcı → okuyucu: deflate, saklanmış, akışla dosya' + (forceZip64 ? ' (ZIP64)' : ''), async () => {
    const dir = tmpdir();
    try {
      const big = Buffer.alloc(3 * 1024 * 1024 + 17);
      for (let i = 0; i < big.length; i++) big[i] = (i * 31 + 7) & 0xff;
      const src = put(path.join(dir, 'video.bin'), big);
      const zf = path.join(dir, 'a.zip');
      const w = ZipWriter.createWriter(zf, { forceZip64 });
      w.addBuffer('backup.json', JSON.stringify({ a: 'ğüşıöç' }));
      w.addBuffer('raw/x.txt', 'saklanmış', { deflate: false });
      await w.addFile('libs/media/vid_1.mp4', src);
      w.close();
      const r = ZipReader.open(zf);
      try {
        const by = new Map(r.entries.map((e) => [e.name, e]));
        assert.deepStrictEqual(Array.from(by.keys()), ['backup.json', 'raw/x.txt', 'libs/media/vid_1.mp4']);
        assert.strictEqual(JSON.parse(r.read(by.get('backup.json')).toString('utf8')).a, 'ğüşıöç');
        assert.strictEqual(r.read(by.get('raw/x.txt')).toString('utf8'), 'saklanmış');
        const out = path.join(dir, 'out.bin');
        let seen = 0;
        await r.copyTo(by.get('libs/media/vid_1.mp4'), out, undefined, (n) => { seen += n; });
        assert.ok(fs.readFileSync(out).equals(big));
        assert.strictEqual(seen, big.length);
      } finally {
        r.close();
      }
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
}

test('parça parça CRC: yerel zlib ve eski Node yedeği aynı sonucu veriyor', () => {
  const zlib = require('zlib');
  const buf = Buffer.from('SoundVisualizer tam yedek ğüşıöç '.repeat(1000));
  const whole = ZipReader.crc32(buf);
  const chunked = (fn) => fn(buf.subarray(5000), fn(buf.subarray(0, 5000), 0));
  assert.strictEqual(chunked(ZipReader.crc32Update), whole);
  const native = zlib.crc32;
  try {
    zlib.crc32 = undefined;
    assert.strictEqual(chunked(ZipReader.crc32Update), whole);
  } finally {
    zlib.crc32 = native;
  }
});

test('ZIP yazıcı: güvensiz ve yinelenen ad reddediliyor', () => {
  const dir = tmpdir();
  try {
    const w = ZipWriter.createWriter(path.join(dir, 'b.zip'));
    for (const bad of ['../x', '/abs', 'a\\b', 'a/../b', '']) assert.throws(() => w.addBuffer(bad, 'x'), /BAD_NAME/);
    w.addBuffer('ok.txt', 'x');
    assert.throws(() => w.addBuffer('ok.txt', 'y'), /DUPLICATE_NAME/);
    w.close();
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('okuyucu copyTo: bozulmuş veri CRC ile yakalanıyor, yarım dosya kalmıyor', async () => {
  const dir = tmpdir();
  try {
    const src = put(path.join(dir, 's.bin'), Buffer.alloc(200000, 7));
    const zf = path.join(dir, 'c.zip');
    const w = ZipWriter.createWriter(zf);
    await w.addFile('v.bin', src);
    w.close();
    const raw = fs.readFileSync(zf);
    raw[30 + 'v.bin'.length + 1000] ^= 0xff;
    fs.writeFileSync(zf, raw);
    const r = ZipReader.open(zf);
    const out = path.join(dir, 'o.bin');
    await assert.rejects(r.copyTo(r.entries[0], out), /CRC/);
    assert.ok(!fs.existsSync(out));
    r.close();
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

// Bir "makine": userData benzeri klasör, kitaplıklar ve sahne
function machine(root, opts) {
  const o = opts || {};
  const m = {
    root,
    logos: path.join(root, 'logo-library'),
    media: path.join(root, 'media-library'),
    lyrics: path.join(root, 'lyrics-library'),
    textures: path.join(root, 'milkdrop-textures'),
    restored: path.join(root, 'restored-media'),
    saved: [],
  };
  if (o.content) {
    put(path.join(m.logos, 'logo_a.png'), 'PNGDATA');
    put(path.join(m.logos, 'manifest.json'), JSON.stringify({ items: [{ id: 'logo_a', name: 'Logo A', file: 'logo_a.png', size: 7 }] }));
    put(path.join(m.media, 'vid_a.mp4'), Buffer.alloc(4096, 1));
    put(path.join(m.media, 'manifest.json'), JSON.stringify({ items: [{ id: 'vid_a', name: 'Klip', file: 'vid_a.mp4', size: 4096 }] }));
    put(path.join(m.lyrics, 'lyr_a.lrc'), '[00:01.00]merhaba');
    put(path.join(m.lyrics, 'manifest.json'), JSON.stringify({ items: [{ id: 'lyr_a', name: 'Söz', file: 'lyr_a.lrc', size: 17 }] }));
    put(path.join(m.textures, 'Worms.jpg'), 'JPGDATA');
    m.external = put(path.join(root, 'Videolar', 'Sahne Klibi.mp4'), Buffer.alloc(2048, 2));
  }
  return m;
}
const libItems = (dir) => JSON.parse(fs.readFileSync(path.join(dir, 'manifest.json'), 'utf8')).items;

function sourceOf(a, includeVideos) {
  const libVideo = path.join(a.media, 'vid_a.mp4');
  const settings = {
    milkdrop: { textureDir: path.join(a.root, 'yok-klasor') },
    layers: [
      { kind: 'media', settings: { media: { source: 'file', file: mediaUrl.toMediaUrl(libVideo), libraryId: 'vid_a' } } },
      { kind: 'media', enabled: false, settings: { media: { source: 'file', file: mediaUrl.toMediaUrl(a.external) } } },
      { kind: 'logo', settings: { logo: { libraryId: 'logo_a' } } },
    ],
    scenes: [{ name: 'Açılış', data: { layers: [{ kind: 'media', settings: { media: { source: 'file', file: a.external } } }] } }],
    userPresets: [{ name: 'Mavi' }],
  };
  const lib = (key, dir) => ({ key, dir, items: libItems(dir) });
  return {
    appVersion: '4.0.0-test', platform: 'win32', settings,
    eachPreset: async (fn) => {
      await fn({ id: 'usr_md_1', name: 'Kurtlar', kind: 'milkdrop', source: 'sampler_worms' });
      await fn({ id: 'builtin_x', builtin: true });
      await fn({ id: '../kaçak', name: 'kötü' });
    },
    libraries: [lib('logos', a.logos), lib('media', a.media), lib('lyrics', a.lyrics)],
    textures: [{ name: 'Worms.jpg', file: path.join(a.textures, 'Worms.jpg') }],
    media: [libVideo, a.external, a.external],
    includeVideos,
    caseInsensitive: process.platform === 'win32',
  };
}

function targetOf(b) {
  const lib = (dir) => ({ dir, lib: { invalidateCache: () => {}, isFile: (n) => /\.(png|jpe?g|gif|webp|bmp|mp4|webm|mov|m4v|mkv|avi|lrc|srt|txt)$/i.test(n) } });
  return {
    savePresets: async (list) => { b.saved.push(...list); return list; },
    libraries: { logos: lib(b.logos), media: lib(b.media), lyrics: lib(b.lyrics) },
    textureDir: b.textures,
    restoredMediaDir: b.restored,
    caseInsensitive: process.platform === 'win32',
  };
}

test('tam yedek: başka makineye geri yükleme her şeyi getiriyor, videolar yeni yere eşleniyor', async () => {
  const dir = tmpdir();
  try {
    const a = machine(path.join(dir, 'A'), { content: true });
    const b = machine(path.join(dir, 'B'));
    // B'nin kendi logosu: geri yükleme silmemeli
    put(path.join(b.logos, 'logo_b.png'), 'B');
    put(path.join(b.logos, 'manifest.json'), JSON.stringify({ items: [{ id: 'logo_b', name: 'B', file: 'logo_b.png', size: 1 }] }));
    const file = path.join(dir, 'yedek' + Backup.EXT);
    const res = await Backup.writeBackup(file, sourceOf(a, true));
    assert.deepStrictEqual(
      { presets: res.presets, scenes: res.scenes, logos: res.logos, lyrics: res.lyrics, videos: res.videos, textures: res.textures, left: res.videosLeftOut },
      { presets: 1, scenes: 1, logos: 1, lyrics: 1, videos: 2, textures: 1, left: 0 });
    assert.ok(!fs.existsSync(file + '.part'));

    const sum = Backup.inspect(file);
    assert.strictEqual(sum.appVersion, '4.0.0-test');
    assert.strictEqual(sum.videos, 2);
    assert.strictEqual(sum.videoBytes, 4096 + 2048);
    assert.strictEqual(sum.colorPresets, 1);

    // A'nın klasörleri "başka makinede" yok
    const exists = (p) => !String(p).startsWith(a.root) && fs.existsSync(p);
    const out = await Backup.restore(file, Object.assign(targetOf(b), { exists }));
    assert.deepStrictEqual(b.saved.map((p) => p.id), ['usr_md_1']);
    assert.deepStrictEqual(libItems(b.logos).map((x) => x.id).sort(), ['logo_a', 'logo_b']);
    assert.strictEqual(fs.readFileSync(path.join(b.logos, 'logo_a.png'), 'utf8'), 'PNGDATA');
    assert.ok(!libItems(b.logos).some((x) => 'ref' in x || 'path' in x));
    assert.deepStrictEqual(libItems(b.media).map((x) => x.id), ['vid_a']);
    assert.strictEqual(fs.readFileSync(path.join(b.lyrics, 'lyr_a.lrc'), 'utf8'), '[00:01.00]merhaba');
    assert.strictEqual(fs.readFileSync(path.join(b.textures, 'Worms.jpg'), 'utf8'), 'JPGDATA');

    const s = out.settings;
    assert.strictEqual(mediaUrl.fromMediaUrl(s.layers[0].settings.media.file), path.join(b.media, 'vid_a.mp4'));
    const ext = mediaUrl.fromMediaUrl(s.layers[1].settings.media.file);
    assert.ok(ext.startsWith(b.restored) && ext.endsWith('Sahne Klibi.mp4'), ext);
    assert.ok(fs.readFileSync(ext).equals(Buffer.alloc(2048, 2)));
    // Düz yol düz kalır, adres adres
    assert.strictEqual(s.scenes[0].data.layers[0].settings.media.file, ext);
    assert.ok(s.layers[0].settings.media.file.startsWith(mediaUrl.PREFIX));
    assert.strictEqual(s.milkdrop.textureDir, '');
    assert.deepStrictEqual(s.userPresets, [{ name: 'Mavi' }]);
    assert.deepStrictEqual(out.counts, { presets: 1, logos: 1, media: 1, lyrics: 1, textures: 1, videos: 2, skipped: 0 });

    // Aynı kimlik, aynı boyut, farklı içerik: yedekteki geçerli
    fs.writeFileSync(path.join(b.logos, 'logo_a.png'), 'XXXXXXX');
    // İkinci kez: aynı dosyalar yeniden yazılmıyor, sonuç aynı
    const again = await Backup.restore(file, Object.assign(targetOf(b), { exists }));
    assert.strictEqual(mediaUrl.fromMediaUrl(again.settings.layers[1].settings.media.file), ext);
    assert.strictEqual(libItems(b.logos).length, 2);
    assert.strictEqual(fs.readFileSync(path.join(b.logos, 'logo_a.png'), 'utf8'), 'PNGDATA');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('aynı bilgisayarda geri yükleme: özgün yollar varsa dokunulmuyor', async () => {
  const dir = tmpdir();
  try {
    const a = machine(path.join(dir, 'A'), { content: true });
    const file = path.join(dir, 'y' + Backup.EXT);
    const src = sourceOf(a, true);
    await Backup.writeBackup(file, src);
    const out = await Backup.restore(file, targetOf(machine(path.join(dir, 'A2'))));
    assert.strictEqual(out.settings.layers[1].settings.media.file, src.settings.layers[1].settings.media.file);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('videosuz yedek: videolar arşive girmiyor, kaç tanesinin bırakıldığı yazıyor', async () => {
  const dir = tmpdir();
  try {
    const a = machine(path.join(dir, 'A'), { content: true });
    const file = path.join(dir, 'v' + Backup.EXT);
    const p = await Backup.plan(sourceOf(a, false));
    assert.strictEqual(p.videos, 2);
    assert.strictEqual(p.videoBytes, 4096 + 2048);
    const res = await Backup.writeBackup(file, sourceOf(a, false));
    assert.strictEqual(res.videos, 0);
    assert.strictEqual(res.videosLeftOut, 2);
    const names = ZipReader.open(file);
    assert.ok(!names.entries.some((e) => /^media\/|^libs\/media\//.test(e.name)));
    names.close();
    assert.strictEqual(Backup.inspect(file).videosLeftOut, 2);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('güvenilmez arşiv: başka ZIP reddediliyor, kaçan adlar yazılmıyor', async () => {
  const dir = tmpdir();
  try {
    const plain = path.join(dir, 'p.zip');
    const w = ZipWriter.createWriter(plain);
    w.addBuffer('a.txt', 'x');
    w.close();
    assert.throws(() => Backup.inspect(plain), (e) => e.code === 'NOT_BACKUP');
    fs.writeFileSync(path.join(dir, 'n.svbackup'), 'zip değil');
    assert.throws(() => Backup.inspect(path.join(dir, 'n.svbackup')), (e) => e.code === 'NOT_BACKUP');

    const evil = path.join(dir, 'e.svbackup');
    const z = ZipWriter.createWriter(evil);
    z.addBuffer('libs/logos/x.png', 'X');
    z.addBuffer('textures/0-a.png', 'T');
    z.addBuffer('media/0-a.mp4', 'M');
    z.addBuffer('presets/usr_1.json', JSON.stringify({ id: 'usr_baska' }));
    z.addBuffer('backup.json', JSON.stringify({
      type: Backup.TYPE, format: Backup.FORMAT, settings: {},
      presets: ['presets/usr_1.json', 'presets/../x.json'],
      libraries: { logos: { items: [{ id: '../x', file: 'x.png', path: 'libs/logos/x.png' }, { id: 'ok', file: '../x.png', path: 'libs/logos/x.png' }] } },
      textures: [{ name: '../../a.png', path: 'textures/0-a.png' }],
      media: [{ ref: 'C:/v.mp4', name: '../../a.mp4', path: 'media/0-../../a.mp4' }],
    }));
    z.close();
    const b = machine(path.join(dir, 'B'));
    const out = await Backup.restore(evil, targetOf(b));
    assert.strictEqual(out.counts.skipped, 6);
    assert.deepStrictEqual(b.saved, []);
    assert.ok(!fs.existsSync(path.join(dir, 'x.png')) && !fs.existsSync(path.join(dir, 'a.png')));
    assert.ok(!fs.existsSync(b.logos));

    const future = path.join(dir, 'f.svbackup');
    const f = ZipWriter.createWriter(future);
    f.addBuffer('backup.json', JSON.stringify({ type: Backup.TYPE, format: 99, settings: {} }));
    f.close();
    assert.throws(() => Backup.inspect(future), (e) => e.code === 'FORMAT');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('taşınabilir ad: Windows\'un reddettiği adlar ayırt ediliyor', () => {
  for (const ok of ['Sahne Klibi.mp4', 'worms.jpg', 'a.b.c.png', 'Kurtlar (2).mp4']) assert.ok(Backup.portableName(ok), ok);
  for (const bad of ['a?b.mp4', 'a*b.png', 'a<b>.png', 'x|y.mp4', 'q"q.mp4', 'nokta.', 'boşluk ', 'CON', 'con.png', 'NUL.mp4', 'com1.jpg', 'LPT9.txt', 'a\tb.png', '../x.png', 'a:b.mp4']) {
    assert.ok(!Backup.portableName(bad), bad);
  }
  assert.ok(Backup.portableName('console.png'), 'yalnız tam ayrılmış ad');
});

test('geri yükleme bir öğede takılınca durmuyor: ad yerine ASCII ad, doku atlanıyor, ayarlar geliyor', async () => {
  const dir = tmpdir();
  try {
    const file = path.join(dir, 'm' + Backup.EXT);
    const z = ZipWriter.createWriter(file);
    z.addBuffer('media/0-a-b.mp4', 'VIDEO');
    z.addBuffer('textures/0-x.png', 'TEX');
    z.addBuffer('textures/1-ok.png', 'TEX2');
    z.addBuffer('presets/usr_1.json', JSON.stringify({ id: 'usr_1' }));
    const ref = '/Users/mac/Movies/a?b.mp4';
    z.addBuffer('backup.json', JSON.stringify({
      type: Backup.TYPE, format: Backup.FORMAT,
      settings: { layers: [{ kind: 'media', settings: { media: { source: 'file', file: ref } } }] },
      presets: ['presets/usr_1.json'],
      textures: [{ name: 'x?.png', path: 'textures/0-x.png' }, { name: 'ok.png', path: 'textures/1-ok.png' }],
      media: [{ ref, name: 'a?b.mp4', path: 'media/0-a-b.mp4', size: 5 }],
    }));
    z.close();
    const b = machine(path.join(dir, 'B'));
    const t = targetOf(b);
    t.savePresets = async () => { throw new Error('disk dolu'); };
    const out = await Backup.restore(file, t);
    const dest = path.join(b.restored, '0-a-b.mp4');
    assert.strictEqual(fs.readFileSync(dest, 'utf8'), 'VIDEO');
    assert.strictEqual(out.settings.layers[0].settings.media.file, dest);
    assert.ok(!fs.existsSync(path.join(b.textures, 'x?.png')));
    assert.strictEqual(fs.readFileSync(path.join(b.textures, 'ok.png'), 'utf8'), 'TEX2');
    assert.deepStrictEqual({ presets: out.counts.presets, textures: out.counts.textures, videos: out.counts.videos, skipped: out.counts.skipped },
      { presets: 0, textures: 1, videos: 1, skipped: 2 });
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('ana süreç: yol panele gitmiyor, tahmin hafif, yedek rolünde geri yükleme yok', () => {
  const main = fs.readFileSync(path.join(__dirname, '..', 'src', 'main', 'main.js'), 'utf8');
  // Panel arşivi jetonla anar; yol ana süreçte kalır
  assert.match(main, /backupOpened\.set\(token, r\.filePaths\[0\]\)/);
  assert.match(main, /const file = backupOpened\.get\(String\(token \|\| ''\)\);/);
  // Kart her çizildiğinde: doku seçimi (bütün presetler) yok
  assert.match(main, /fullBackup\.plan\(await backupSource\(true, true\)\)/);
  assert.match(main, /textures: light \? \[\] : await showTextureFiles\(\)/);
  assert.match(main, /if \(red\.isolated\) return \{ ok: false, error: 'REDUNDANCY_ROLE' \};/);
  // Yedek rolünde birincilin kopyası değil, bu makinenin gösterisi yedeklenir
  assert.match(main, /function backupConfig\(\) \{[\s\S]{0,200}redSpace\(\)\.forDisk\(cfg\)/);
});
