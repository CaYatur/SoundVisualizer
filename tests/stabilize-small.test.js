'use strict';
/* v3.1.5 öncesi stabilizasyon: küçük, kesin hatalar.

   - MCP'nin dosya yazan üç aracı yalnız kendi türünde, yerel ve mutlak
     bir yola yazar. Uzantı serbest olunca "yazma" kipindeki bir istemci
     .bat ya da başlangıç betiği bırakabiliyordu; ffmpeg ise çıktıyı
     tcp:// gibi bir adrese de gönderebiliyordu.
   - Katmanın Yatay/Dikey Aynala anahtarları seçenekleri yanlış sırada
     veriyordu: her tıklama "onAfter is not a function" atıyordu.
   - Katman paneli boş (null) yığın bayrağını çizerken false'a çeviriyordu;
     yeni kurulumda bile "1 değişiklik" rozeti çıkıyordu.
   - "Basla Nabız" yazım hatası. */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const mcp = require('../src/shared/mcp');

const ROOT = path.join(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');

function ctx(written) {
  const cfg = { mcp: { enabled: true, mode: 'write' }, scenes: [] };
  return {
    locale: () => 'en',
    getConfig: () => cfg,
    setConfig: () => {},
    writeText: (file) => { written.push(file); return true; },
    writeBinary: (file) => { written.push(file); return true; },
    capturePreview: () => ({ dataUrl: 'data:image/jpeg;base64,AAAA', width: 8, height: 8 }),
    startExport: (o) => { written.push(o.outputPath); return { ok: true }; },
  };
}

const WIN = process.platform === 'win32';
const abs = (name) => (WIN ? 'C:\\Users\\me\\' : '/home/me/') + name;

test('MCP dosya araçları: uzantısı uyan mutlak yerel yol kabul edilir', async () => {
  const written = [];
  const c = ctx(written);
  assert.strictEqual((await mcp.callTool('sv_export_json', { path: abs('show.json') }, c)).ok, true);
  assert.strictEqual((await mcp.callTool('sv_save_snapshot', { path: abs('shot.JPG') }, c)).ok, true);
  assert.strictEqual((await mcp.callTool('sv_start_export', { audioPath: abs('a.mp3'), outputPath: abs('out.mp4') }, c)).ok, true);
  assert.strictEqual(written.length, 3);
});

test('MCP dosya araçları: başka uzantı, göreli yol, ağ yolu ve protokol reddedilir', async () => {
  const written = [];
  const c = ctx(written);
  const bad = [
    ['sv_export_json', { path: abs('run.bat') }],
    ['sv_export_json', { path: 'show.json' }],
    ['sv_export_json', { path: '\\\\server\\share\\show.json' }],
    ['sv_export_json', { path: abs('noext') }],
    ['sv_save_snapshot', { path: abs('shot.png') }],
    ['sv_save_snapshot', { path: abs('x.jpg\0.exe') }],
    ['sv_start_export', { audioPath: abs('a.mp3'), outputPath: 'tcp://10.0.0.1:9000/out.mp4' }],
    ['sv_start_export', { audioPath: abs('a.mp3'), outputPath: 'pipe:1' }],
    ['sv_start_export', { audioPath: abs('a.mp3'), outputPath: abs('out.mkv') }],
    ['sv_start_export', { audioPath: abs('a.mp3') }],
  ];
  for (const [name, args] of bad) {
    const r = await mcp.callTool(name, args, c);
    assert.strictEqual(r.ok, false, name + ' ' + JSON.stringify(args) + ' kabul edildi');
  }
  assert.deepStrictEqual(written, [], 'reddedilen çağrı yine de yazdı');
});

test('katman Aynala anahtarları seçenekleri beşinci argümanda veriyor', () => {
  const s = read('src/admin/scene-panels.js');
  for (const label of ['Yatay Aynala', 'Dikey Aynala']) {
    const line = s.split(/\r?\n/).find((l) => l.includes("miniToggle('" + label + "'"));
    assert.ok(line, label + ' bulunamadı');
    assert.match(line, /\}, null, \{ def: false \}\)/, label + ': ' + line.trim());
  }
  // Aynı hata başka bir anahtarda da olmasın: 4. argüman nesne sabiti değil
  const wrong = s.split(/\r?\n/).filter((l) => /miniToggle\(/.test(l) && /\(v\) => \{[^}]*\}, \{ ?(def|disabled|badge|title)/.test(l));
  assert.deepStrictEqual(wrong, []);
});

test('katman paneli boş yığın bayrağını çizerken yazmıyor', () => {
  const s = read('src/admin/scene-panels.js');
  assert.doesNotMatch(s, /cfg\.layerStack = \{ enabled: !!list\.length \}/);
  assert.match(s, /window\.SVLayers\.stackOn\(cfg\)/);
});

test('"Basla Nabız" yazım hatası kalmadı, çevirisi "Bas Nabzı" anahtarında', () => {
  for (const f of ['src/admin/scene-panels.js', 'src/admin/nowplaying-panel.js', 'src/admin/text-panel.js', 'src/shared/i18n.js']) {
    assert.ok(!read(f).includes('Basla Nabız'), f);
  }
  assert.match(read('src/shared/i18n.js'), /'Bas Nabzı': 'Bass Pulse'/);
});
