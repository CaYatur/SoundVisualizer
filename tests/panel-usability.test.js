'use strict';
/* Panelin kullanım düzeltmeleri: ortak arama anahtarı, eş anlamlılar, gösteri kısayolları,
 * kısayol penceresi, Electron varsayılan menüsünün kaldırılması, boş durum notu. */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const read = (rel) => fs.readFileSync(path.join(root, rel), 'utf8');
const T = require('../src/shared/text-fold.js');
const HK = require('../src/shared/hotkeys.js');
const MENU = require('../src/main/app-menu.js');
const AL = require('../src/admin/search-aliases.js');

test('arama anahtarı: Türkçe I/ı, İ/i ve büyük harf fark etmez', () => {
  assert.strictEqual(T.fold('MIDI'), 'midi');
  assert.strictEqual(T.fold('midi'), 'midi');
  assert.strictEqual(T.fold('GIF'), 'gif');
  assert.strictEqual(T.fold('IŞIK'), T.fold('ışık'));
  assert.strictEqual(T.fold('İstanbul'), 'istanbul');
  assert.strictEqual(T.fold('Izgara'), T.fold('ızgara'));
  assert.strictEqual(T.fold('Izgara'), 'izgara');
  // Türkçe yerelin yaptığı hata burada yok
  assert.notStrictEqual('MIDI'.toLocaleLowerCase('tr'), 'midi');
});

test('arama anahtarı: aksan fark etmez, boşluk tekleşir, boş değer boş döner', () => {
  assert.strictEqual(T.fold('Şarkı Sözü'), 'sarki sozu');
  assert.strictEqual(T.fold('  Güç   /  Performans '), 'guc / performans');
  assert.strictEqual(T.fold('Çıktı'), 'cikti');
  assert.strictEqual(T.fold(null), '');
  assert.strictEqual(T.fold(undefined), '');
  assert.strictEqual(T.fold(42), '42');
  assert.strictEqual(T.match('Otomatik Söz Bulma', 'soz'), 9);
  assert.strictEqual(T.match('MIDI Denetleyici', 'midi'), 0);
  assert.strictEqual(T.match('Barlar', 'xyz'), -1);
});

test('sözcük başı: "ndi" Kendi içinde sayılmaz, "lut" LUT başında sayılır', () => {
  const kendi = T.fold('Studio — Kendi Görselleştiricin');
  const m1 = T.find(kendi, 'ndi');
  assert.ok(m1 && m1.start === false, 'yalnız sözcük ortasında');
  const lut = T.find(T.fold('3B LUT (.cube)'), 'lut');
  assert.ok(lut && lut.start === true);
  const bulut = T.find(T.fold('Bulutsu'), 'lut');
  assert.ok(bulut && bulut.start === false);
  // Hem ortada hem başta geçiyorsa baştaki seçilir
  const both = T.find(T.fold('Bulut ve LUT'), 'lut');
  assert.deepStrictEqual(both, { at: 9, start: true });
  assert.strictEqual(T.find('abc', ''), null);
  assert.strictEqual(T.find('abc', 'zz'), null);
  assert.strictEqual(T.wordStart('art-net', 4), true, 'tire sözcük ayırır');
});

test('gösteri kısayolları: Boşluk, Ctrl+S ve Ctrl+R; başka birleşim eşleşmez', () => {
  assert.strictEqual(HK.match({ key: ' ' }), 'blackout');
  assert.strictEqual(HK.match({ key: 'Space' }), 'blackout');
  assert.strictEqual(HK.match({ key: 's', control: true }), 'snapshot');
  assert.strictEqual(HK.match({ key: 'S', meta: true }), 'snapshot');
  assert.strictEqual(HK.match({ key: 'r', control: true }), 'record');
  assert.strictEqual(HK.match({ key: 'r' }), null);
  assert.strictEqual(HK.match({ key: 's' }), null);
  assert.strictEqual(HK.match({ key: ' ', control: true }), null);
  assert.strictEqual(HK.match({ key: ' ', shift: true }), null);
  assert.strictEqual(HK.match({ key: 'r', control: true, shift: true }), null, 'Ctrl+Shift+R başka');
  assert.strictEqual(HK.match({ key: 'r', control: true, alt: true }), null);
  assert.strictEqual(HK.match({ key: 'q', control: true, shift: true }), null, 'kurtarma kısayoluna dokunmaz');
  assert.strictEqual(HK.match({}), null);
  assert.strictEqual(HK.match(null), null);
  assert.deepStrictEqual(HK.fromEvent({ key: 'r', ctrlKey: true }), { key: 'r', control: true, meta: false, alt: false, shift: false });
});

test('panelde Boşluk odak bir denetimdeyken karartmaz; Ctrl+S yalnız yazı alanında bırakılır', () => {
  const el = (tagName, extra) => Object.assign({ tagName, getAttribute: () => null, closest: () => null }, extra || {});
  assert.strictEqual(HK.panelAllows('blackout', el('BODY')), true);
  assert.strictEqual(HK.panelAllows('blackout', el('DIV')), true);
  for (const tag of ['INPUT', 'TEXTAREA', 'SELECT', 'BUTTON', 'A', 'SUMMARY']) {
    assert.strictEqual(HK.panelAllows('blackout', el(tag)), false, tag);
  }
  assert.strictEqual(HK.panelAllows('blackout', el('DIV', { isContentEditable: true })), false);
  assert.strictEqual(HK.panelAllows('blackout', el('DIV', { getAttribute: (k) => (k === 'role' ? 'button' : null) })), false);
  assert.strictEqual(HK.panelAllows('blackout', el('SPAN', { closest: () => ({}) })), false, 'odaklanabilir bir öğenin içinde');
  assert.strictEqual(HK.panelAllows('record', el('BUTTON')), true);
  assert.strictEqual(HK.panelAllows('snapshot', el('INPUT', { type: 'range' })), true, 'kaydırıcı yazı alanı değil');
  assert.strictEqual(HK.panelAllows('snapshot', el('INPUT', { type: 'text' })), false);
  assert.strictEqual(HK.panelAllows('record', el('TEXTAREA')), false);
  assert.strictEqual(HK.panelAllows('blackout', null), true);
});

test('kısayol listesi dolu ve her metin çevrilmiş', () => {
  const i18n = read('src/shared/i18n.js');
  const same = new Set(['Panel', 'Ctrl', 'Alt', 'Shift', 'Enter', 'Esc', 'F11', 'S', 'R', 'K', 'Z', 'Y', 'Q', '?', '1…5', 'F1…F12', '0…9', '+ / −']);
  assert.ok(HK.GROUPS.length >= 4);
  let rows = 0;
  for (const g of HK.GROUPS) {
    if (!same.has(g.title)) assert.ok(i18n.includes("'" + g.title + "':"), 'başlık çevirisi yok: ' + g.title);
    for (const r of g.keys) {
      rows++;
      assert.ok(Array.isArray(r.keys) && r.keys.length, 'tuş yok');
      assert.ok(i18n.includes("'" + r.text + "':"), 'çevirisi yok: ' + r.text);
      for (const k of r.keys) if (!same.has(k)) assert.ok(i18n.includes("'" + k + "':"), 'tuş adı çevirisi yok: ' + k);
    }
  }
  assert.ok(rows >= 15, 'satır sayısı: ' + rows);
  assert.ok(i18n.includes("'" + HK.MORE + "':"));
  // Listedeki üç gösteri kısayolu match ile aynı tuşlar
  const all = HK.GROUPS[0].keys.map((r) => r.keys.join('+'));
  assert.deepStrictEqual(all, ['Boşluk Tuşu', 'Ctrl+S', 'Ctrl+R']);
});

test('uygulama menüsü: Windows ve Linux\'ta yok, macOS\'ta Görünüm menüsü yok', () => {
  assert.strictEqual(MENU.template('win32', false), null);
  assert.strictEqual(MENU.template('linux', false), null);
  const mac = MENU.template('darwin', false);
  assert.deepStrictEqual(mac.map((m) => m.role), ['appMenu', 'editMenu', 'windowMenu']);
  const flat = JSON.stringify([mac, MENU.template('win32', false)]);
  assert.ok(!/reload|toggleDevTools|viewMenu/i.test(flat), 'yeniden yükleme ve geliştirici araçları yok');
  // Geliştirme kipinde F5 ve F12; Ctrl+R hiçbir zaman menüde değil
  const dev = MENU.template('win32', true);
  assert.strictEqual(dev.length, 1);
  assert.deepStrictEqual(dev[0].submenu.map((s) => s.accelerator), ['F5', 'F12']);
  assert.ok(!/CmdOrCtrl\+R|Control\+R|Ctrl\+R/i.test(JSON.stringify(MENU.template('darwin', true))));
  let got = 'çağrılmadı';
  MENU.install({ setApplicationMenu: (m) => { got = m; }, buildFromTemplate: (t) => ({ built: t }) }, 'win32', false);
  assert.strictEqual(got, null);
  MENU.install({ setApplicationMenu: (m) => { got = m; }, buildFromTemplate: (t) => ({ built: t }) }, 'darwin', false);
  assert.strictEqual(got.built.length, 3);
});

test('ana süreç menüyü kurar ve çıkış penceresindeki kısayolu panele yollar', () => {
  const main = read('src/main/main.js');
  assert.match(main, /appMenu\.install\(require\('electron'\)\.Menu, process\.platform, process\.argv\.includes\('--dev'\)\)/);
  assert.match(main, /const hot = hotkeys\.match\(input\);\s*if \(hot\) \{\s*event\.preventDefault\(\);\s*if \(!input\.isAutoRepeat\) notifyAdmin\('hotkey', hot\);/);
  // Kurtarma kısayolu gösteri kısayolundan ÖNCE denetlenir
  assert.ok(main.indexOf('if (isRescue) {') < main.indexOf('const hot = hotkeys.match(input);'));
  assert.ok(read('src/main/preload-admin.js').includes("onHotkey: (cb) => ipcRenderer.on('hotkey', (e, action) => cb(action)),"));
  const admin = read('src/admin/admin.js');
  assert.match(admin, /if \(window\.api\.onHotkey\) window\.api\.onHotkey\(runHotkey\);/);
  assert.match(admin, /if \(action === 'blackout' && \(activeCategory === 'time' \|\| activeCategory === 'studio'\)\) return;/, 'Zaman sayfasında Boşluk oynat tuşu');
  assert.match(admin, /if \(!e\.repeat\) runHotkey\(action\);/);
  assert.ok(read('src/admin/record-panel.js').includes('snap: snap,'));
});

test('eş anlamlılar: her bölüm kimliği ve katman etiketi gerçekten var', () => {
  const admin = read('src/admin/admin.js');
  for (const id of Object.keys(AL.sections)) {
    assert.ok(admin.includes("id: '" + id + "',"), 'bölüm yok: ' + id);
    assert.ok(AL.sections[id].length > 0, id);
  }
  const panels = read('src/admin/scene-panels.js');
  for (const label of Object.keys(AL.labels)) assert.ok(panels.includes("'" + label + "'"), 'etiket yok: ' + label);
  const i18n = read('src/shared/i18n.js');
  for (const a of AL.actions) {
    assert.ok(admin.includes("'" + a.run + "'"), 'eylem işlenmiyor: ' + a.run);
    for (const s of [a.label, a.section, a.category]) assert.ok(i18n.includes("'" + s + "':"), 'çevirisi yok: ' + s);
  }
  assert.ok(Object.keys(AL.sections).length >= 50);
});

test('eş anlamlılar aranan sözcükleri doğru bölüme götürür', () => {
  const hit = (word) => {
    const q = T.fold(word);
    const out = [];
    for (const [id, words] of Object.entries(AL.sections)) if (words.some((w) => { const m = T.find(T.fold(w), q); return m && m.start; })) out.push(id);
    for (const [label, words] of Object.entries(AL.labels)) if (words.some((w) => { const m = T.find(T.fold(w), q); return m && m.start; })) out.push(label);
    for (const a of AL.actions) if (a.keywords.some((w) => { const m = T.find(T.fold(w), q); return m && m.start; })) out.push(a.run);
    return out;
  };
  assert.ok(hit('mikrofon').includes('sources'));
  assert.ok(hit('microphone').includes('sources'));
  assert.ok(hit('telefon').includes('stream'));
  assert.ok(hit('phone').includes('stream'));
  assert.ok(hit('midi').includes('midi'));
  assert.ok(hit('midi saati').includes('tempoSync'));
  assert.ok(hit('yeşil perde').includes('Renk Anahtarı'));
  assert.ok(hit('green screen').includes('Renk Anahtarı'));
  assert.ok(hit('webcam').includes('Medya Kaynağı'));
  assert.ok(hit('kısayol').includes('shortcuts'));
  assert.ok(hit('shortcut').includes('shortcuts'));
  assert.ok(hit('export').includes('export'));
  assert.ok(hit('dil').includes('settings-main'));
  assert.ok(hit('language').includes('settings-main'));
  assert.ok(hit('projektör').includes('mapping'));
});

test('panel araması ortak anahtarı kullanır; kısa sorgu yalnız sözcük başında', () => {
  const admin = read('src/admin/admin.js');
  assert.ok(!/\.toLocaleLowerCase\('tr'\)\.indexOf/.test(admin), 'Türkçe yerelle küçültme kalmadı');
  assert.match(admin, /const q = T\.fold\(query\);/);
  assert.match(admin, /const strict = q\.length <= 3;/);
  assert.match(admin, /if \(!m \|\| \(strict && !m\.start\)\) return;/);
  assert.match(admin, /keywords: \(sec\.keywords \|\| \[\]\)\.concat\(ALIASES\.sections\[sec\.id\] \|\| \[\]\)/);
  assert.match(admin, /keywords: ALIASES\.labels\[f\.label\] \|\| \[\]/);
  assert.match(admin, /if \(entry\.run\) \{ runSearchAction\(entry\.run\); return; \}/);
  // Aramadan bulunan düğmeye basılmaz, yalnız gösterilir
  const act = admin.slice(admin.indexOf('function runSearchAction'), admin.indexOf('function runSearchAction') + 700);
  assert.ok(!/\.click\(\)/.test(act), 'arama sonucu karartmayı ya da çıkışı kendisi tetiklemez');
});

test('öteki arama kutuları da ortak anahtarı kullanır', () => {
  for (const f of ['src/admin/template-panel.js', 'src/admin/logo-lib-ui.js', 'src/admin/milkdrop-panel.js', 'src/admin/scene-shell.js']) {
    assert.ok(read(f).includes('window.SVText.fold'), f);
  }
  const remote = read('src/web/remote.js');
  assert.ok(remote.includes('window.SVText.fold(s)'));
  assert.ok(!/toLocaleLowerCase\(\)\.indexOf\(q\)/.test(remote));
  // Şablon araması görünen (çevrilmiş) adı da arar
  assert.match(read('src/admin/template-panel.js'), /tt\(t\.name\) \+ ' ' \+ tt\(t\.desc\) \+ ' ' \+ tt\(t\.group\)/);
});

test('sayfalar yeni betikleri panel kodundan önce yükler', () => {
  const html = read('src/admin/index.html');
  const at = (s) => { const i = html.indexOf('<script src="' + s + '"></script>'); assert.ok(i > 0, 'betik yok: ' + s); return i; };
  const admin = at('admin.js');
  for (const s of ['../shared/text-fold.js', '../shared/hotkeys.js', 'search-aliases.js', 'shortcuts-help.js']) assert.ok(at(s) < admin, s);
  assert.ok(at('../shared/text-fold.js') < at('scene-shell.js'));
  assert.ok(html.includes('id="keysBtn"'));
  const remote = read('src/web/remote.html');
  assert.ok(remote.indexOf('/app/shared/text-fold.js') > 0 && remote.indexOf('/app/shared/text-fold.js') < remote.indexOf('/app/web/remote.js'));
  for (const f of ['src/shared/text-fold.js', 'src/shared/hotkeys.js', 'src/admin/search-aliases.js', 'src/admin/shortcuts-help.js', 'src/main/app-menu.js']) {
    assert.match(read(f), /^\s*(\/\*[\s\S]*?\*\/\s*)*'use strict';/, 'use strict yok: ' + f);
  }
});

test('boş durum notu başlığın altında kalır, başka etiketin ipucuna katlanmaz', () => {
  const admin = read('src/admin/admin.js');
  assert.match(admin, /const prev = n\.previousElementSibling;\s*if \(prev && prev !== lbl && prev\.matches && prev\.matches\('label\.lbl'\)\) return;/);
});

test('README kısayol tablosu uygulamadaki listeyle aynı tuşları yazar', () => {
  for (const f of ['README.md', 'README.tr.md']) {
    const md = read(f);
    for (const k of ['`Ctrl` + `S`', '`Ctrl` + `R`', '`Ctrl` + `K`', '`Alt` + `1`–`5`', '`F1`–`F12`', '`?`']) assert.ok(md.includes(k), f + ': ' + k);
  }
});

test('zaman çizelgesinin kısayol penceresi panelin ortak pencere kabuğunda', () => {
  const tl = read('src/admin/timeline-panel.js');
  assert.match(tl, /class: 'tl-keys-dlg ask-backdrop', role: 'dialog', 'aria-modal': 'true'/);
  assert.match(tl, /class: 'tl-keys-card ask-panel keys-help'/);
  const css = read('src/admin/admin.css');
  assert.match(css, /\.ask-backdrop \{\s*position: fixed;/);
  assert.ok(!/\.tl-keys-dlg \{ max-width/.test(css), 'kabuğu daraltan eski kural kalmadı');
  assert.match(read('src/admin/pages.css'), /\.keys-help \{[^}]*max-height: calc\(100vh - 40px\)/);
});

test('depo kökünde güvenlik politikası ve davranış kuralları var', () => {
  const sec = read('SECURITY.md');
  assert.match(sec, /Report a vulnerability/);
  assert.match(sec, /github\.com\/CaYatur\/SoundVisualizer\/security/);
  assert.match(sec, /README\.md#privacy-and-security/);
  assert.ok(read('README.md').includes('### Privacy and security'), 'bağlanan başlık duruyor');
  const coc = read('CODE_OF_CONDUCT.md');
  assert.match(coc, /SECURITY\.md/);
  assert.match(coc, /contact@cayadev\.com/);
  assert.ok(read('package.json').includes('contact@cayadev.com'), 'adres paket bilgisindekiyle aynı');
});

test('İngilizce arayüzde raf sekmeleri ve şablon grubu bağlamına göre adlanır', () => {
  const shell = read('src/admin/scene-shell.js');
  assert.match(shell, /\{ id: 'vis', label: 'Görsel', en: 'Visualizer' \}/);
  assert.match(shell, /\{ id: 'bg', label: 'Zemin', en: 'Background' \}/);
  assert.match(shell, /text: tabText\(t\)/);
  const tpl = read('src/admin/template-panel.js');
  assert.match(tpl, /const GROUP_EN = \{ 'Tür': 'Genre' \};/);
  assert.strictEqual((tpl.match(/groupText\(/g) || []).length, 2, 'iki kullanım');
  const i18n = read('src/shared/i18n.js');
  assert.ok(i18n.includes("'Üretken Zeminler': 'Generative Backgrounds',"));
  assert.ok(!/Generative Grounds|plain dark ground|A ground falling/.test(i18n));
  // Arama yolu da aynı adları kullanır
  const admin = read('src/admin/admin.js');
  assert.match(admin, /entry\(m\.label, 'Görselleştirici', 'vis', m\.label\)/);
  assert.match(admin, /entry\(m\.label, 'Arkaplan', 'bg', m\.label\)/);
});
