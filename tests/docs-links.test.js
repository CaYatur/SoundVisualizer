'use strict';
/* Kılavuzların bağlantıları: göreli dosya var mı, başlık çapası gerçekten o dosyada mı.
 * Kılavuz arayüz adlarını alıntılıyor; ad değişirse kılavuz da güncellensin diye
 * birkaç tanesi burada sözlükle karşılaştırılıyor. */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const read = (rel) => fs.readFileSync(path.join(root, rel), 'utf8');

const GUIDES = ['docs/GUIDE.md', 'docs/GUIDE.tr.md', 'docs/SHADER-GUIDE.md', 'docs/MODULATION-COOKBOOK.md', 'SECURITY.md', 'CODE_OF_CONDUCT.md'];

// GitHub'ın başlık çapası: küçük harf, harf/rakam/boşluk/tire dışı atılır, boşluk tire olur
function slug(heading) {
  return heading.trim().toLowerCase()
    .replace(/[`*_]/g, '')
    .replace(/[^\p{L}\p{N}\s-]/gu, '')
    .replace(/\s/g, '-');
}
function anchorsOf(md) {
  const out = new Set();
  let fence = false;
  for (const line of md.split(/\r?\n/)) {
    if (/^```/.test(line)) { fence = !fence; continue; }
    if (fence) continue;
    const m = /^#{1,6}\s+(.+?)\s*$/.exec(line);
    if (m) out.add(slug(m[1]));
  }
  return out;
}
function linksOf(md) {
  const out = [];
  let fence = false;
  for (const line of md.split(/\r?\n/)) {
    if (/^```/.test(line)) { fence = !fence; continue; }
    if (fence) continue;
    const re = /\]\(([^)\s]+)\)/g;
    let m;
    while ((m = re.exec(line))) out.push(m[1]);
  }
  return out;
}

test('çapa üretimi GitHub kuralına uyuyor', () => {
  assert.strictEqual(slug('Show control: timeline, clip deck, Auto VJ, MIDI and OSC'), 'show-control-timeline-clip-deck-auto-vj-midi-and-osc');
  assert.strictEqual(slug('Ses yakalama ve çözümleme'), 'ses-yakalama-ve-çözümleme');
  assert.strictEqual(slug('Privacy and security'), 'privacy-and-security');
  assert.strictEqual(slug('Studio — write your own shader'), 'studio--write-your-own-shader');
});

for (const file of GUIDES) {
  test(file + ': göreli bağlantılar ve çapalar yerinde', () => {
    const md = read(file);
    const dir = path.dirname(file);
    const links = linksOf(md);
    assert.ok(links.length > 0, 'bağlantı yok');
    for (const href of links) {
      if (/^(https?:|mailto:)/.test(href)) continue;
      const [rel, hash] = href.split('#');
      const target = rel ? path.posix.normalize(path.posix.join(dir.replace(/\\/g, '/'), rel)) : file;
      assert.ok(fs.existsSync(path.join(root, target)), file + ': dosya yok: ' + href);
      if (hash && /\.md$/.test(target)) {
        const want = decodeURIComponent(hash);
        assert.ok(anchorsOf(read(target)).has(want), file + ': başlık yok: ' + href);
      }
    }
  });
}

test('kılavuzlar birbirine ve README\'ler kılavuza bağlanıyor', () => {
  assert.ok(read('docs/GUIDE.md').includes('(GUIDE.tr.md)'));
  assert.ok(read('docs/GUIDE.tr.md').includes('(GUIDE.md)'));
  assert.ok(read('README.md').includes('(docs/GUIDE.md)'));
  assert.ok(read('README.tr.md').includes('(docs/GUIDE.tr.md)'));
  assert.ok(read('README.md').includes('(docs/SHADER-GUIDE.md)'));
  assert.ok(read('README.md').includes('(docs/MODULATION-COOKBOOK.md)'));
});

test('kılavuzun alıntıladığı arayüz adları sözlükte aynı', () => {
  const i18n = read('src/shared/i18n.js');
  const pairs = [
    ['Ses Kaynakları', 'Audio Sources'], ['Uygulama Sesi', 'Application Audio'], ['Aygıtları Yenile', 'Refresh Devices'],
    ['Renk Teması', 'Color Theme'], ['Hazır Tema', 'Color Preset'], ['Şeffaf Arkaplan', 'Transparent Background'],
    ['Örnek sahneleri ekle', 'Add example scenes'], ['AL', 'TAKE'], ['Sırada', 'Next'], ['Anlık Efektler', 'Momentary Effects'],
    ['Efekt Zinciri', 'Effect Chain'], ['Gösteri Öncesi Denetim', 'Pre-show Check'], ['Kaza Koruması', 'Accidental-Close Protection'],
    ['Ayarları Yedekle / Geri Yükle', 'Back Up / Restore Settings'], ['Uyarlanır Çözünürlük', 'Adaptive Resolution'],
    ['Yayın Çıkışı (OBS / Web)', 'Streaming Output (OBS / Web)'], ['Kayıt ve Anlık Görüntü', 'Recording & Snapshot'],
    ['Video Dışa Aktar', 'Video Export'], ['MIDI Denetleyici', 'MIDI Controller'], ['Öğren', 'Learn'], ['Dosyaya', 'To a File'],
    ['Tam Yedek Al', 'Create Full Backup'], ['Tam Yedekten Geri Yükle', 'Restore from Full Backup'],
    ['Videoları Dahil Et', 'Include Videos'], ['Yalnız Ayarlar', 'Settings Only'],
  ];
  const flat = (rel) => read(rel).replace(/\s+/g, ' ');
  const en = flat('docs/GUIDE.md');
  const tr = flat('docs/GUIDE.tr.md');
  for (const [t, e] of pairs) {
    assert.ok(i18n.includes("'" + t + "': '" + e + "'"), 'sözlük değişmiş: ' + t + ' / ' + e);
    assert.ok(en.includes(e), 'İngilizce kılavuzda yok: ' + e);
    assert.ok(tr.includes(t), 'Türkçe kılavuzda yok: ' + t);
  }
});

test('shader kılavuzunun anlattığı adlar shader motorunda tanımlı', () => {
  const host = read('src/visualizer/modes/shaderhost.js');
  const guide = read('docs/SHADER-GUIDE.md');
  for (const name of ['sv_resolution', 'sv_time', 'sv_level', 'sv_bass', 'sv_mid', 'sv_treble', 'sv_beat', 'sv_spec', 'sv_waveAt', 'sv_col',
    'sv_hueRotate', 'sv_palette', 'sv_spectrum', 'sv_wave', 'sv_prev', 'sv_media', 'sv_bufA', 'sv_bufD', 'iTimeDelta', 'iFrame', 'iMouse']) {
    assert.ok(host.includes(name), 'motorda yok: ' + name);
    assert.ok(guide.includes('`' + name), 'kılavuzda yok: ' + name);
  }
  // Kanal sırası ve işaretler kodla aynı
  assert.match(host, /const CHANNEL_DEFAULT = \['spectrum', 'wave', 'prev', 'media'\];/);
  assert.ok(guide.includes('`spectrum, wave, prev, media`'));
  assert.match(host, /premultipliedAlpha: false/);
  for (const mark of ['//@common', '//@pass A', '//@pass image']) assert.ok(guide.includes(mark), mark);
  // ISF eşlemesi içe aktarıcıyla aynı
  const presets = read('src/shared/presets.js');
  for (const t of ['float', 'long', 'bool', 'color', 'point2D', 'image']) assert.ok(presets.includes("inp.TYPE === '" + t + "'"), t);
  for (const def of ['RENDERSIZE', 'isf_FragNormCoord', 'IMG_PIXEL']) { assert.ok(presets.includes('#define ' + def)); assert.ok(guide.includes(def)); }
});

/* README, ROADMAP ve CHANGELOG: kullanım alanları kartları HTML (`href="#…"`), geri kalan
 * Markdown. Sürüm hazırlığında eklenen bölümler başka belgedeki bir başlığa da bağlanıyor
 * (README → ROADMAP.md#what-changed-since-v317); başlık değişirse burada yakalansın. */
const DOCS = ['README.md', 'README.tr.md', 'ROADMAP.md', 'CHANGELOG.md'];
function hrefsOf(md) {
  const out = linksOf(md);
  const re = /href="([^"]+)"/g;
  let m;
  while ((m = re.exec(md))) out.push(m[1]);
  return out;
}
for (const file of DOCS) {
  test(file + ': belge içi ve belgeler arası çapalar yerinde', () => {
    const md = read(file);
    let checked = 0;
    for (const href of hrefsOf(md)) {
      if (/^(https?:|mailto:)/.test(href)) continue;
      const [rel, hash] = href.split('#');
      // CHANGELOG geçmişi anlatıyor: o günkü yollar (ör. presets/cayadev) sonradan taşınmış olabilir
      if (rel && file !== 'CHANGELOG.md' && !fs.existsSync(path.join(root, rel))) assert.fail(file + ': dosya yok: ' + href);
      if (rel && !fs.existsSync(path.join(root, rel))) continue;
      const target = rel || file;
      if (hash && /\.md$/.test(target)) {
        checked += 1;
        assert.ok(anchorsOf(read(target)).has(decodeURIComponent(hash)), file + ': başlık yok: ' + href);
      }
    }
    if (file !== 'CHANGELOG.md') assert.ok(checked > 0, 'çapa bağlantısı yok');
  });
}

test('kullanım alanları iki dilde aynı sayıda ve README v4 bölümüne bağlanıyor', () => {
  const count = (rel) => (read(rel).match(/<td width="50%" valign="top"><b>/g) || []).length;
  assert.strictEqual(count('README.md'), 16);
  assert.strictEqual(count('README.tr.md'), 16);
  assert.ok(read('README.md').includes('## Use cases'));
  assert.ok(read('README.tr.md').includes('## Kullanım alanları'));
  assert.ok(read('ROADMAP.md').includes('## Use cases'));
});

test('ROADMAP durum tablosu: her satırda başlık kadar hücre, son sütun v4.0.0', () => {
  const lines = read('ROADMAP.md').split(/\r?\n/);
  const start = lines.findIndex((l) => l.startsWith('| Feature | v1.3.1 |'));
  assert.ok(start > 0);
  const cells = (l) => l.slice(1, -1).split('|').map((c) => c.trim());
  const head = cells(lines[start]);
  assert.strictEqual(head[head.length - 2], '**v4.0.0**');
  let rows = 0;
  for (let i = start + 1; lines[i].startsWith('|'); i++) {
    assert.strictEqual(cells(lines[i]).length, head.length, 'satır ' + (i + 1));
    rows += 1;
  }
  assert.ok(rows > 60);
});
