'use strict';
/* GÖRSEL / ZEMİN KÜÇÜK RESİMLERİ (#957): anahtar içeriğe bağlı, uygulamayla gelen önbellek
   önce, yoksa çalışma anı kuyruğu (MilkDrop'unkiyle aynı ThumbQueue). Gerçek çizim
   `node scripts/gen-mode-thumbs.js`te (Electron + yazılım GL); burada saf mantık. */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const M = require('../src/main/mode-thumbs');

const ROOT = path.join(__dirname, '..');
const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'sv-mt-'));

function catalog() {
  global.window = global.window || {};
  require('../src/shared/mode-catalog.js');
  return global.window.SVModeCatalog;
}

test('sayfa listesi HTML\'den okunuyor ve katman motoruyla sürücüyü içeriyor', () => {
  const files = M.pageFiles(ROOT);
  assert.strictEqual(files[0], M.PAGE);
  for (const f of ['src/visualizer/layers.js', 'src/shared/demo-audio.js', 'src/thumbs/mode-thumbs.js']) assert.ok(files.includes(f), f);
  for (const f of files) assert.ok(fs.existsSync(path.join(ROOT, f)), f);
});

test('her katalog türünün sahibi bulunuyor (hiçbir şey çizmeyenler hariç)', () => {
  const C = catalog();
  const ctx = M.context(ROOT);
  const miss = [];
  for (const e of C.VISUALIZERS.concat(C.BACKGROUNDS)) if (!M.ownerOf(ctx.modeTexts, e.id)) miss.push(e.id);
  assert.deepStrictEqual(miss.sort(), ['none', 'solid']);
});

test('anahtar: kararlı, tür ve çeşide bağlı, yalnız sahibi değişince eskiyor', () => {
  const ctx = M.context(ROOT);
  const a = M.keyOf(ctx, 'vis', 'bars');
  assert.match(a, M.KEY_RE || /^[0-9a-f]{40}$/);
  assert.strictEqual(a, M.keyOf(M.context(ROOT), 'vis', 'bars'));
  assert.notStrictEqual(a, M.keyOf(ctx, 'bg', 'bars'));
  assert.notStrictEqual(a, M.keyOf(ctx, 'vis', 'wave'));
  assert.strictEqual(M.keyOf(ctx, 'xx', 'bars'), '');
  // Sahibin baytları değişince yalnız onun anahtarı değişiyor
  const owner = M.ownerOf(ctx.modeTexts, 'bars');
  const other = M.ownerOf(ctx.modeTexts, 'wave');
  assert.notStrictEqual(owner, other);
  const ctx2 = Object.assign({}, ctx, { modeHash: new Map(ctx.modeHash) });
  ctx2.modeHash.set(owner, 'degisti');
  assert.notStrictEqual(M.keyOf(ctx2, 'vis', 'bars'), a);
  assert.strictEqual(M.keyOf(ctx2, 'vis', 'wave'), M.keyOf(ctx, 'vis', 'wave'));
  // Ortak motor değişince hepsi
  assert.notStrictEqual(M.keyOf(Object.assign({}, ctx, { core: 'x' }), 'vis', 'wave'), M.keyOf(ctx, 'vis', 'wave'));
});

test('sv-thumb://m/ adresi yalnız 40 haneli anahtar, önce gelen klasör sonra kullanıcı verisi', () => {
  const shipped = tmp();
  const user = tmp();
  const k1 = 'a'.repeat(40);
  const k2 = 'b'.repeat(40);
  fs.writeFileSync(path.join(shipped, k1 + '.webp'), 'S');
  fs.writeFileSync(path.join(user, k1 + '.webp'), 'U');
  fs.writeFileSync(path.join(user, k2 + '.webp'), 'U');
  assert.strictEqual(M.fileForModeUrl(shipped, user, M.urlOf(k1)), path.join(shipped, k1 + '.webp'));
  assert.strictEqual(M.fileForModeUrl(shipped, user, M.urlOf(k2)), path.join(user, k2 + '.webp'));
  assert.strictEqual(M.fileForModeUrl(shipped, user, M.urlOf('c'.repeat(40))), null);
  assert.strictEqual(M.fileForModeUrl(shipped, user, 'sv-thumb://m/../x.webp'), null);
  assert.strictEqual(M.fileForModeUrl(shipped, user, 'sv-thumb://t/' + k1 + '.webp'), null);
});

test('gelen resim varsa çizilmiyor; yoksa tek tek çiziliyor, başarısız bir daha denenmiyor', async () => {
  const shipped = tmp();
  const user = tmp();
  const ctx = M.context(ROOT);
  fs.writeFileSync(path.join(shipped, M.keyOf(ctx, 'vis', 'bars') + '.webp'), 'S');
  const calls = [];
  let live = 0;
  let maxLive = 0;
  const got = [];
  const q = new M.ModeThumbs({
    root: ROOT, shippedDir: shipped, dir: user,
    render: async (meta) => {
      live++; maxLive = Math.max(maxLive, live);
      calls.push(meta.kind + ':' + meta.type);
      assert.deepStrictEqual(meta.recipe, M.RECIPE);
      await new Promise((r) => setTimeout(r, 5));
      live--;
      return meta.type === 'wave' ? null : Buffer.from('W');
    },
    onReady: (id, url) => got.push([id, url]),
  });
  const r = q.request([
    { id: 'vis:bars', kind: 'vis', type: 'bars' },
    { id: 'vis:wave', kind: 'vis', type: 'wave' },
    { id: 'bg:ink', kind: 'bg', type: 'ink' },
    { id: 'x', kind: 'nope', type: 'bars' },
  ]);
  assert.strictEqual(r['vis:bars'], M.urlOf(M.keyOf(ctx, 'vis', 'bars')));
  assert.strictEqual(r.x, '');
  while (q.queue.pending()) await new Promise((res) => setTimeout(res, 5));
  assert.deepStrictEqual(calls.sort(), ['bg:ink', 'vis:wave']);
  assert.strictEqual(maxLive, 1);
  const inkUrl = M.urlOf(M.keyOf(ctx, 'bg', 'ink'));
  assert.ok(got.some(([id, url]) => id === 'bg:ink' && url === inkUrl));
  assert.ok(got.some(([id, url]) => id === 'vis:wave' && url === ''));
  // İkinci istek: ink kullanıcı verisinden hazır, wave başarısız kümesinde
  const r2 = q.request([{ id: 'bg:ink', kind: 'bg', type: 'ink' }, { id: 'vis:wave', kind: 'vis', type: 'wave' }]);
  assert.strictEqual(r2['bg:ink'], inkUrl);
  assert.strictEqual(r2['vis:wave'], '');
  assert.strictEqual(calls.length, 2);
});

test('gelen önbellek güncel: her katalog türünün resmi assets/mode-thumbs içinde', () => {
  const { wanted } = require('../scripts/gen-mode-thumbs');
  const dir = path.join(ROOT, M.SHIPPED_DIR);
  // 'solid' düz renk: kendi modu yok, çizilmiyor; simge kalıyor
  const miss = wanted().filter((w) => w.type !== 'solid' && !fs.existsSync(path.join(dir, w.key + '.webp')));
  /* Eskimiş resim hata değil (çalışma anında çiziliyor); ama gelen önbellek çoğunlukla güncel
     olmalı. Eksik varsa: node scripts/gen-mode-thumbs.js */
  const all = wanted().length;
  if (miss.length) console.log('[mode-thumbs] eskimiş: ' + miss.map((w) => w.kind + ':' + w.type).join(' '));
  assert.ok(miss.length <= all * 0.5, miss.length + '/' + all + ' eksik: node scripts/gen-mode-thumbs.js');
});

test('panel galeriye resmi boşta istiyor, ana süreç protokol ve IPC ile veriyor', () => {
  const shell = fs.readFileSync(path.join(ROOT, 'src/admin/scene-shell.js'), 'utf8');
  const main = fs.readFileSync(path.join(ROOT, 'src/main/main.js'), 'utf8');
  const pre = fs.readFileSync(path.join(ROOT, 'src/main/preload-admin.js'), 'utf8');
  assert.match(shell, /requestIdleCallback/);
  assert.match(shell, /api\.modeThumbs\(items\)/);
  assert.match(main, /ipcMain\.handle\('modes:thumbs'/);
  assert.match(main, /modeThumbsLib\.fileForModeUrl\(/);
  assert.match(main, /async function renderModeThumb\(meta\) \{\r?\n  await thumbTurn\(\);/);
  assert.match(pre, /modeThumbs: \(items\) => ipcRenderer\.invoke\('modes:thumbs'/);
});

test('çeviri sözlüğü anahtara girmiyor: arayüz metni eklemek resimleri eskitmiyor', () => {
  // Sayfa sözlüğü yüklüyor (modlar hata ve varsayılan metni çeviriyor) ama resim ona bağlı değil
  assert.ok(M.pageFiles(ROOT).includes('src/shared/i18n.js'));
  assert.deepStrictEqual(Array.from(M.KEY_SKIP), ['src/shared/i18n.js']);
  const os = require('os');
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'sv-thumbkey-'));
  try {
    for (const rel of M.pageFiles(ROOT)) {
      const to = path.join(tmp, rel);
      fs.mkdirSync(path.dirname(to), { recursive: true });
      fs.copyFileSync(path.join(ROOT, rel), to);
    }
    const before = M.keyOf(M.context(tmp), 'vis', 'wave');
    assert.strictEqual(before, M.keyOf(M.context(ROOT), 'vis', 'wave'), 'kopya depo aynı anahtarı veriyor');
    fs.appendFileSync(path.join(tmp, 'src/shared/i18n.js'), '\n// yeni arayüz metni\n');
    assert.strictEqual(M.keyOf(M.context(tmp), 'vis', 'wave'), before, 'sözlük değişti, anahtar aynı');
    // Motor dosyası değişince anahtar değişmeye devam ediyor
    fs.appendFileSync(path.join(tmp, 'src/visualizer/layers.js'), '\n// motor değişti\n');
    assert.notStrictEqual(M.keyOf(M.context(tmp), 'vis', 'wave'), before);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});
