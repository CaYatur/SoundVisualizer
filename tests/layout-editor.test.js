'use strict';
/* Düzen editörü (#534): önizlemeyi taşır (ikinci çizici yok), yakalama ve
   klavye karşılıkları, erişilebilirlik ve çeviri. Canlı davranış öz testte
   ve elle doğrulandı; burada sözleşme korunuyor. */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(root, p), 'utf8');
const ED = read('src/admin/layout-editor.js');
const PAGES = read('src/admin/pages.css');

test('panel betikleri yükleniyor ve düğme adlandırılmış', () => {
  const html = read('src/admin/index.html');
  const a = html.indexOf('<script src="preview.js"></script>');
  const b = html.indexOf('<script src="../shared/layout.js"></script>');
  const c = html.indexOf('<script src="layout-editor.js"></script>');
  assert.ok(a > 0 && b > a && c > b, 'sıra: preview → layout → layout-editor');
  assert.match(html, /id="layoutEditBtn"[^>]*aria-label="Düzen Editörü"/);
  assert.match(read('src/admin/admin.js'), /SVLayoutEditor\.open\(layBtn\)/);
});

test('önizleme taşınıyor, yeniden çizilmiyor; kapanınca yerine dönüyor', () => {
  assert.match(ED, /stageWrap\.appendChild\(stage\)/);
  assert.doesNotMatch(ED, /new\s+window\.SVLayers|SVLayers\.LayerStack|createStack/, 'ikinci çizici yok');
  assert.match(ED, /s\.home\.insertBefore\(s\.stage, s\.next\)/);
  assert.match(ED, /stack\.layoutBounds\(\)/, 'kutular çiziciden');
});

test('yakalama Alt ile kapanıyor; ok tuşları ve sayısal alanlar sürüklemenin karşılığı', () => {
  assert.match(ED, /if \(st\.snap && !m\.altKey\)/);
  assert.match(ED, /LY\(\)\.snapBox\(box, d\.guides, SNAP_PX \/ d\.rect\.width, SNAP_PX \/ d\.rect\.height\)/);
  // Taşınan öğeler birbirine yakalanmasın: kılavuzlar yalnız seçili olmayanlardan
  assert.match(ED, /elements\(\)\.filter\(\(x\) => !st\.picked\.has\(x\.id\) && !x\.hidden && x\.drawn\)/);
  // Birikme hatası yok: her harekette başlangıçtan toplam kayma
  assert.match(ED, /Object\.keys\(it\.startVals\)\.forEach\(\(k\) => LY\(\)\.setField/);
  assert.match(ED, /ArrowLeft: \[-1, 0\], ArrowRight: \[1, 0\], ArrowUp: \[0, -1\], ArrowDown: \[0, 1\]/);
  assert.match(ED, /ev\.shiftKey \? NUDGE \* 10 : NUDGE/);
  assert.match(ED, /type: 'number', class: 'num'/);
});

test('kipli pencere: adlar, odak tuzağı, Escape; kullanıcı içeriği çevrilmiyor', () => {
  assert.match(ED, /role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': 'layTitle'/);
  assert.match(ED, /'aria-label': e\.name \+ ' — ' \+ tr\('ok tuşlarıyla taşıyın'\)/);
  assert.match(ED, /if \(e\.key === 'Tab'\)/);
  // Escape önce süren sürüklemeyi iptal eder, sonra kısayol listesini, en son editörü kapatır
  assert.match(ED, /if \(e\.key === 'Escape'\) \{\s*e\.preventDefault\(\);\s*if \(st\.drag\) st\.drag\.cancel\(\);\s*else if \(!st\.keys\.hidden\) toggleKeys\(false\);\s*else close\(\);/);
  assert.match(ED, /class: 'lay-tag', text: e\.name, 'data-user-text': ''/);
  // Kılavuzlar yalnız sürüklerken
  assert.match(ED, /gx\.hidden = true;\s*\n\s*gy\.hidden = true;/);
  assert.match(PAGES, /\.lay-box:focus-visible \{ outline: 2px solid var\(--accent\)/);
  const i18n = read('src/shared/i18n.js');
  ["'Düzen Editörü': 'Layout Editor'", "'Güvenli alanlar': 'Safe areas'", "'ok tuşlarıyla taşıyın':", "'Yatay Merkez':", "'Yazı Boyu':", "'En Büyük Genişlik':"]
    .forEach((k) => assert.ok(i18n.includes(k), k));
});

test('dışa aktarım: varsayılan dosya adı ve katman adı arayüz diline uyuyor', () => {
  assert.match(ED, /exportJson\(tr\('duzen\.json'\), data\)/);
  assert.match(ED, /el\.layer\.name = tr\(el\.layer\.name\)/);
  const i18n = read('src/shared/i18n.js');
  assert.ok(i18n.includes("'duzen.json': 'layout.json'"));
  assert.ok(i18n.includes("'Görselleştirici': 'Visualizer'"));
});

test('tema kartları: yeniden çizimden sonra odak yeni karta dönüyor, tıklama odak veriyor', () => {
  const admin = read('src/admin/admin.js');
  assert.match(admin, /classList\.contains\('ui-theme-opt'\) \? aeTheme\.dataset\.theme : null/);
  assert.match(admin, /if \(themeFocus\) \{[\s\S]{0,200}\.ui-theme-opt[\s\S]{0,200}back\.focus/);
  assert.match(admin, /o\.focus\(\{ preventScroll: true \}\);\s*\n\s*pick\(c\.id\)/);
});

test('boyutlandırma tutamacı: köşeden sürükleme ve +/− tuşları, yalnız boyutlanabilir öğelerde', () => {
  assert.match(ED, /LY\(\)\.canResize\(e\.layer\)/);
  assert.match(ED, /class: 'lay-handle'/);
  // Tutamaçtan başlayan sürükleme kutunun taşıma sürüklemesini tetiklemesin
  assert.match(ED, /h\.addEventListener\('pointerdown', \(ev\) => \{ if \(ev\.button != null && ev\.button !== 0\) return; ev\.stopPropagation\(\); startResize\(ev, e\.id, b\); \}\)/);
  // Katman her yazımda kimliğiyle bulunur (sürükleme sırasında liste yeniden kurulmuş olabilir)
  assert.match(ED, /LY\(\)\.resizeBy\(now\.layer, P\(\)\.cfg\(\), startBox, startVals, k\)/);
  assert.match(ED, /ev\.key === '\+' \|\| ev\.key === '='/);
  assert.match(ED, /if \(resizeKey\(e, boxId\)\) return;/);
  assert.match(PAGES, /\.lay-handle \{[^}]*cursor: nwse-resize/);
  const i18n = read('src/shared/i18n.js');
  ["'+ ve − ile boyutlandırın':", "'Boyutlandırmak için sürükleyin':", "'Boyut: kutunun sağ alt köşesinden"]
    .forEach((k) => assert.ok(i18n.includes(k), k));
});

test('geri al sahneyi editörden çıkarmıyor: kabuk editör açıkken sahneyi taşımaz', () => {
  const shell = read('src/admin/scene-shell.js');
  const place = shell.slice(shell.indexOf('function placeStage'), shell.indexOf('function paint()'));
  const guard = place.indexOf('if (window.SVLayoutEditor && window.SVLayoutEditor.isOpen()) return;');
  const move = place.indexOf('host.insertBefore(stage, host.firstChild)');
  assert.ok(guard > 0 && move > guard, 'koruma, sahneyi taşıyan satırdan önce');
  // Editör tek geçmişi kullanır; ardından seçimini ve yan panelini yeniler
  assert.match(ED, /function history\(dir\) \{[\s\S]{0,200}if \(dir === 'redo'\) h\.redo\(\); else h\.undo\(\);\s*refresh\(\);/);
  assert.match(ED, /window\.SVLayoutEditor = \{ open, close, isOpen: \(\) => !!st,/);
});

test('tuşlar tek yerde ve arkadaki panele sızmıyor; geri al, yinele, tümünü seç', () => {
  const key = ED.slice(ED.indexOf('function onKey(e)'), ED.indexOf('function toggleKeys'));
  // Üstteki onay penceresi tuşları alır; onun dışında hiçbir tuş panelin kısayoluna ulaşmaz
  const ask = key.indexOf(".ask-backdrop:not(.lay-backdrop)");
  const stop = key.indexOf('e.stopPropagation();');
  assert.ok(ask > 0 && stop > ask);
  assert.match(ED, /document\.addEventListener\('keydown', st\.onKey, true\)/);
  assert.match(key, /if \(typing \|\| st\.drag\) return;/, 'yazı kutusunun kendi geri alması bozulmuyor');
  assert.match(key, /history\(k === 'y' \|\| e\.shiftKey \? 'redo' : 'undo'\)/);
  assert.match(key, /k === 'a'\) \{ e\.preventDefault\(\); selectAll\(\); return; \}/);
  // Tek harfli kısayollar yalnız kutu odaktayken (WCAG 2.1.4)
  assert.match(key, /const boxId = t && t\.classList && t\.classList\.contains\('lay-box'\) \? t\.dataset\.id : null;\s*if \(!boxId\) return;/);
});

test('ok tuşu ve hizalama geri al adımı bırakıyor; sürükleme kare başına bir kez yazıyor', () => {
  assert.match(ED, /function commit\(full\) \{\s*P\(\)\.push\(!!full\);\s*noteUndo\(\);\s*\}/);
  const nudge = ED.slice(ED.indexOf('function nudge'), ED.indexOf('function arrange'));
  assert.match(nudge, /commit\(false\);/);
  const drag = ED.slice(ED.indexOf('function startDrag'), ED.indexOf('function startResize'));
  assert.match(drag, /if \(!d\.pending\) d\.pending = requestAnimationFrame\(flush\);/);
  assert.match(drag, /if \(!d\.moved && Math\.hypot\(m\.clientX - d\.x0, m\.clientY - d\.y0\) < DRAG_START_PX\) return;/, 'tıklama sürükleme sayılmıyor');
  // Bırakınca son konum yazılır, iptalde başlangıca dönülür
  assert.match(drag, /if \(cancel\) \{ if \(d\.moved\) applyMove\(d\.items, 0, 0\); \} else if \(d\.moved\) flush\(\);/);
  // Kutu konumu yalnız değişince DOM'a yazılır
  assert.match(ED, /if \(box && \(box\.x !== g\.x \|\| box\.y !== g\.y \|\| box\.w !== g\.w \|\| box\.h !== g\.h\)\)/);
});

test('çoklu seçim, hizalama ve dağıtma; göster ve kilitle katmanın kendi alanlarına', () => {
  assert.match(ED, /if \(ev\.shiftKey \|\| ev\.ctrlKey \|\| ev\.metaKey\) \{ select\(id, true\); return; \}/);
  assert.match(ED, /LY\(\)\.distributeDeltas\(boxes, mode === 'dist-y' \? 'y' : 'x'\) : LY\(\)\.alignDeltas\(boxes, mode\)/);
  assert.match(ED, /if \(e\.hidden\) \{ e\.layer\.enabled = true; e\.layer\.muted = false; \} else e\.layer\.enabled = false;/);
  assert.match(ED, /else if \(key === 'locked'\) e\.layer\.locked = !e\.layer\.locked;/);
  // Kılavuz anahtarları işaret kutusu değil, basılı kalan düğme
  assert.doesNotMatch(ED, /type: 'checkbox'/);
  assert.match(ED, /class: 'lay-chip' \+ \(on \? ' active' : ''\), icon, text: label, 'aria-pressed'/);
  const icons = read('src/shared/icons.js');
  ['align-left', 'align-hcenter', 'align-right', 'align-top', 'align-vcenter', 'align-bottom', 'dist-h', 'dist-v']
    .forEach((n) => assert.ok(icons.includes("'" + n + "': ["), n));
  const i18n = read('src/shared/i18n.js');
  ["'Sola Hizala': 'Align Left'", "'Yatayda Eşit Dağıt': 'Distribute Horizontally'", "'Tümünü Seç': 'Select All'", "'öğe seçili': 'elements selected'"]
    .forEach((k) => assert.ok(i18n.includes(k), k));
});
