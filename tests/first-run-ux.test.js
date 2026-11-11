'use strict';
/* İlk kullanım turu (#905): yeni bir kullanıcının ilk dakikalarında takıldığı yerler.

   - Canlı sayfası sahnesiz geliyordu: ızgara, AL, T-bar ve Otomatik VJ kullanıcı
     sahne kaydedene dek boştu. Boş durumda "Örnek sahneleri ekle".
   - Tek ekranlı bilgisayarda "Görselleştirmeyi Aç" paneli örtüyor; ESC ipucu da
     panelin altında kalıyordu. Aynı ekrandaysa kısa bir not.
   - 1280×720'de ayar etiketleri tek satırda kesiliyordu; artık iki satıra iniyor.
   - Uygulama sesi listesinde bazı süreçler tam yoluyla görünüyordu.
   - Kitaplık'taki renk şablonu notu artık var olmayan "aşağıdaki renklere" yolluyordu. */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');

test('ESC notu yalnız çıkış panelle aynı ekrandayken, kilitsiz ve otomasyon dışında', () => {
  const H = require('../src/main/exit-hint.js');
  const h = H.create({ everyMs: 60000 });
  assert.strictEqual(h.wanted(1, 2, 0, {}), false, 'farklı ekran: projektörde seyirci görmesin');
  assert.strictEqual(h.wanted(1, 1, 0, { automation: true }), false, 'öz test ve ekran görüntüsü');
  assert.strictEqual(h.wanted(1, 1, 0, { escLocked: true }), false, 'ESC kilitliyken var olmayan yolu söylemesin');
  assert.strictEqual(h.wanted(null, 1, 0, {}), false, 'ekran bilinmiyor');
  assert.strictEqual(h.wanted(1, 1, 1000, {}), true);
  assert.strictEqual(h.wanted(1, 1, 30000, {}), false, 'pencere yeniden kurulunca tekrar çıkmasın');
  assert.strictEqual(h.wanted(2, 2, 30000, {}), true, 'başka ekranın sayacı ayrı');
  assert.strictEqual(h.wanted(1, 1, 61001, {}), true, 'süre dolunca yine');
});

test('ESC notu sayfa katmanında: tuvale çizilmiyor, açılışta yollanıyor', () => {
  const main = read('src/main/main.js');
  assert.match(main, /require\('\.\/exit-hint'\)\.create\(\)/);
  assert.match(main, /maybeExitHint\(win\);\r?\n  \}\);/, 'çıkış penceresinin did-finish-load sonunda');
  assert.match(main, /'exit-hint', \{ text: trUi\('Panele dönmek için ESC', 'Press ESC to return to the panel'\)/);
  const pre = read('src/main/preload-visualizer.js');
  assert.match(pre, /onExitHint: \(cb\) => ipcRenderer\.on\('exit-hint'/);
  const vis = read('src/visualizer/visualizer.js');
  const block = vis.slice(vis.indexOf('window.api.onExitHint'), vis.indexOf('window.api.onExitHint') + 900);
  assert.match(block, /document\.createElement\('div'\)/);
  assert.doesNotMatch(block, /getContext|fillText|drawImage/, 'not tuvale çizilirse Spout ve dışa aktarıma girer');
  const css = read('src/visualizer/visualizer.css');
  assert.match(css, /#svExitHint \{[^}]*pointer-events: none/);
});

test('örnek sahneler: sekiz farklı ve var olan şablon, boş durumlarda düğme', () => {
  const T = require('../src/shared/templates.js');
  const admin = read('src/admin/admin.js');
  const m = /const STARTER_SCENES = \[([^\]]+)\]/.exec(admin);
  assert.ok(m, 'liste');
  const ids = m[1].split(',').map((s) => s.trim().replace(/^'|'$/g, ''));
  assert.strictEqual(ids.length, 8, 'ilk bank (F1–F8)');
  assert.strictEqual(new Set(ids).size, 8);
  for (const id of ids) assert.ok(T.TEMPLATES.some((t) => t.id === id), 'şablon yok: ' + id);
  // Kullanıcının kendi metnine ya da logosuna bağlı şablon olmamalı: ilk açılışta boş görünür
  for (const id of ids) {
    const t = T.TEMPLATES.find((x) => x.id === id);
    assert.ok(!/^(bc|str|evt)-/.test(id), 'kart/yayın şablonu ilk izlenim için uygun değil: ' + id);
    assert.ok(t.name, id);
  }
  // Kullanıcının şablonu uygulayıp kaydetmesiyle aynı yol
  assert.match(admin, /const next = T\.apply\(cfg, tpl, env\);/);
  assert.match(admin, /addStarterScenes: \(\) => actions\.addStarterScenes\(\)/);
  // Üç boş durum da düğmeyi gösteriyor: Zaman listesi, Kitaplık › Sahneler ve Canlı ızgarası
  assert.match(admin, /el\('div', \{ class: 'scene-empty' \}, \[[\s\S]{0,200}starterButton\(\)/);
  assert.match(admin, /cfg\.scenes\.length \? null : starterButton\(\),/);
  const live = read('src/admin/live-shell.js');
  assert.match(live, /P\(\)\.starterButton \? P\(\)\.starterButton\(\) : null/);
});

test('yeni ve değişen metinlerin İngilizcesi var', () => {
  global.window = global.window || {};
  require('../src/shared/i18n.js');
  const I = global.window.SVI18n || global.window.SV_I18N;
  const src = read('src/shared/i18n.js');
  for (const k of [
    'Örnek sahneleri ekle',
    'Hazır şablonlardan sekiz sahne kurar; canlı görüntü değişmez.',
    '{n} örnek sahne eklendi. Canlı sayfasında F1–F8 ile seçip AL ya da T-bar ile geçin.',
    'Henüz şablon yok. Sahne sayfasında arkaplanın renklerini ayarlayın, sonra burada “Mevcut Renkleri Kaydet”e basın.',
  ]) {
    assert.ok(src.includes("'" + k + "':"), 'çeviri yok: ' + k);
  }
  assert.ok(!src.includes('Aşağıdaki renkleri ayarlayıp'), 'eski not kalmamalı');
  assert.ok(!read('src/admin/admin.js').includes('Aşağıdaki renkleri ayarlayıp'));
  assert.ok(I === undefined || typeof I === 'object');
});

test('ayar etiketi sığmazsa iki satıra iniyor, tek satırda kesilmiyor', () => {
  const css = read('src/admin/pages.css');
  const rule = /\.ctrl label\.lbl > \.lbl-t \{([^}]+)\}/.exec(css);
  assert.ok(rule, 'kural');
  assert.match(rule[1], /-webkit-line-clamp: 2/);
  assert.match(rule[1], /white-space: normal/);
  assert.doesNotMatch(rule[1], /white-space: nowrap/);
});

test('uygulama sesi listesinde tam yol değil dosya adı görünür; eşleşme anahtarı değişmez', () => {
  const A = require('../src/shared/app-audio.js');
  const rows = A.candidates([
    { pid: 4, name: 'C:\\Windows\\System32\\cmd.exe', label: 'C:\\Windows\\System32\\cmd.exe', audible: false },
    { pid: 9, name: 'Discord.exe', label: 'Discord', audible: true },
    { pid: 11, name: '/usr/bin/mpv', label: '', audible: true },
  ]);
  const cmd = rows.find((r) => /cmd\.exe$/i.test(r.match));
  assert.strictEqual(cmd.label, 'cmd.exe');
  assert.strictEqual(cmd.match, 'C:\\Windows\\System32\\cmd.exe');
  assert.strictEqual(rows.find((r) => r.match === 'Discord.exe').label, 'Discord');
  assert.strictEqual(rows.find((r) => r.match === '/usr/bin/mpv').label, 'mpv');
});
