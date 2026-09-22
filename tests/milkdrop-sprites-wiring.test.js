'use strict';
/* MilkDrop sprite'larının bağlantıları (#577): ana süreç, ön yüklemeler,
 * web çıkışı, sayfalar ve denetleyici.
 *
 * Bir halkası kopuk kalsa sprite o yüzeyde sessizce görünmezdi — bir
 * pencerede var, web çıkışında yok. Bu testler her yüzeyin komutu aldığını,
 * resmi YOLLA değil kimlikle istediğini ve dışa aktarımın komut almadığını
 * kaynaktan doğruluyor.
 */
global.window = global.window || {};
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(root, p), 'utf-8').replace(/\r\n/g, '\n');

test('ana süreç: dört IPC, komut her motora, sayfaya yol gitmiyor', () => {
  const M = read('src/main/main.js');
  for (const ch of ['milkdrop:pick-sprites', 'milkdrop:sprites', 'milkdrop:sprite', 'milkdrop:sprite-image']) {
    assert.ok(M.includes("ipcMain.handle('" + ch + "'"), ch + ' yok');
  }
  const send = /function sendSpriteCommand\(c\) \{([\s\S]*?)\n\}/.exec(M)[1];
  assert.match(send, /for \(const win of openWindows\(\)\) win\.webContents\.send\('md-sprite', cmd\);/);
  assert.match(send, /textureShare\.window\(\)/, 'Spout/Syphon');
  assert.match(send, /adminWin\.webContents\.send\('md-sprite', cmd\)/, 'panel önizlemesi');
  assert.match(send, /streamServer\.broadcast\(\{ type: 'md-sprite', cmd \}, 'overlay'\)/, 'web çıkışı');
  // Sayfaya giden tanımda `img` resmin kimliği, dosya yolu değil
  assert.match(M, /def: \{ num, img: key, colorkey: def\.colorkey, init: def\.init, code: def\.code \}/);
  // ini her başlatmada yeniden okunuyor (MilkDrop: "never cached")
  const cmd = /function spriteCommand\(req\) \{([\s\S]*?)\n\}/.exec(M)[1];
  assert.match(cmd, /const r = readSprites\(\);/);
  // Resim kimlikle; yalnız başlatılmış resimler, yeniden doğrulanarak
  assert.match(M, /function spriteImageFile\(key\) \{\s*const file = mdSpriteImages\.get\(String\(key \|\| ''\)\);/);
  assert.match(M, /mdSpriteFile: \(key\) => spriteImageFile\(key\),/, 'yayın sunucusu kancası');
});

test('yayın sunucusu: sprite resmi jetonun ARKASINDA, kimlikle', () => {
  const S = read('src/main/stream-server.js');
  const token = S.indexOf('if (state.requireToken) {');
  const route = S.indexOf("if (p === '/milkdrop/sprite') { serveSprite(res, url.searchParams.get('key') || ''); return; }");
  assert.ok(token > 0 && route > token, 'yol jeton denetiminden sonra olmalı');
  assert.match(S, /function serveSprite\(res, key\) \{\s*const t = typeof hooks\.mdSpriteFile === 'function' \? hooks\.mdSpriteFile\(key\) : null;/);
});

test('ön yüklemeler ve web kabuğu komutu ve resmi veriyor', () => {
  const V = read('src/main/preload-visualizer.js');
  const A = read('src/main/preload-admin.js');
  for (const src of [V, A]) {
    assert.match(src, /onMdSprite: \(cb\) => ipcRenderer\.on\('md-sprite', \(e, c\) => cb\(c\)\),/);
    assert.match(src, /milkdropSpriteImage: \(key\) => ipcRenderer\.invoke\('milkdrop:sprite-image', key\),/);
    assert.match(src, /milkdropSprite: \(req\) => ipcRenderer\.invoke\('milkdrop:sprite', req\),/);
  }
  assert.match(A, /pickMilkdropSprites: \(\) => ipcRenderer\.invoke\('milkdrop:pick-sprites'\),/);
  assert.match(A, /milkdropSprites: \(\) => ipcRenderer\.invoke\('milkdrop:sprites'\),/);
  const W = read('src/web/web-shim.js');
  assert.match(W, /msg\.type === 'md-sprite'[\s\S]{0,120}handlers\.mdSprite\.forEach\(\(h\) => h\(msg\.cmd \|\| null\)\);/);
  assert.match(W, /onMdSprite: \(cb\) => handlers\.mdSprite\.push\(cb\),/);
  assert.match(W, /url: '\/milkdrop\/sprite\?key=' \+ encodeURIComponent\(String\(key \|\| ''\)\)\s*\+ \(token \? '&token=' \+ encodeURIComponent\(token\) : ''\),/);
  // Web çıkışında tuşlar yok: komut gönderme çağrısı kabukta tanımlı değil
  assert.ok(!/milkdropSprite:/.test(W));
});

test('sayfalar modülü motordan önce yüklüyor ve dinliyor; dışa aktarım dinlemiyor', () => {
  for (const [f, pre] of [['src/visualizer/index.html', '../shared/'], ['src/admin/index.html', '../shared/'],
    ['src/web/overlay.html', '/app/shared/']]) {
    const H = read(f);
    const a = H.indexOf('<script src="' + pre + 'milkdrop-sprites.js"></script>');
    const b = H.indexOf('modes/milkdrop.js"></script>');
    assert.ok(a > 0 && a < b, f + ': modül motordan önce yüklenmeli');
  }
  const V = read('src/visualizer/visualizer.js');
  assert.match(V, /window\.SVMilkdropSprites\.listen\(window\.api\);\s*if \(window\.api\.milkdropSprite\) spriteKeys\(\);/);
  assert.match(read('src/admin/preview.js'), /window\.SVMilkdropSprites\.listen\(window\.api\);/);
  assert.ok(!/SVMilkdropSprites|md-sprite|onMdSprite/.test(read('src/exporter/exporter.js')),
    'dışa aktarım canlı sprite komutu almamalı');
});

test('ayar sahne dışında; panel ve denetleyici eylemleri aynı yoldan', () => {
  require('../src/shared/defaults.js');
  const SV = global.window.SV;
  assert.strictEqual(SV.defaultConfig().milkdropControl.spriteFile, '');
  assert.strictEqual(SV.defaultConfig().milkdrop.spriteFile, undefined, 'sahnenin `milkdrop` bloğunda değil');
  const P = read('src/admin/milkdrop-panel.js');
  assert.match(P, /if \(name === 'SpriteNewest'\) spriteCmd\(\{ op: 'newest' \}\);/);
  assert.match(P, /else if \(name\.indexOf\('Sprite:'\) === 0\) spriteCmd\(\{ op: 'launch', num: name\.slice\(7\) \}\);/);
  // Sprite eylemleri preset listesi boşken de çalışmalı: kontrol ondan önce
  const act = /function act\(name\) \{([\s\S]*?)\n  \}/.exec(P)[1];
  assert.ok(act.indexOf("name.indexOf('Sprite') === 0") < act.indexOf('if (!presets.length) return false;'));
  const C = read('src/admin/control.js');
  assert.match(C, /return TARGETS\.concat\(deckTargets\(\), spriteTargets\(\)\);/);
  // Liste isteği ayar gönderiminden SONRA (apply önce çiziyor, sonra yolluyor)
  assert.match(P, /sprFor = file;\s*setTimeout\(\(\) => \{\s*window\.api\.milkdropSprites\(\)/);
});
