'use strict';
/* Panel erişilebilirliği (#777). Chromium'un erişilebilirlik ağacında 139
   denetimin adı boştu (etiket denetime bağlı değildi) ve Tab ile gelen 68
   öğede odak görünmüyordu (kaydırıcılar, satır içi kenarlıklı listeler,
   ışık seçimi). Asıl ölçüm öz testte; burada yapı korunuyor. */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(root, p), 'utf8');

test('ayar satırlarının etiketi denetime bağlanıyor', () => {
  const a = read('src/admin/admin.js');
  assert.match(a, /function linkLabels\(root\)/);
  assert.match(a, /x\.setAttribute\('aria-labelledby', t\.id\)/);
  // Ad etiketin yalnız metni: "varsayılana döndür" düğmesi adın parçası değil
  assert.match(a, /\/\^\(BUTTON\|INPUT\|SELECT\|TEXTAREA\)\$\//);
  // Gözlemci rAF'a bağlı değil (arka plandaki pencerede rAF çalışmıyor)
  const i = a.indexOf('function linkLabels(root)');
  const block = a.slice(i, i + 2500);
  assert.match(block, /new MutationObserver/);
  assert.doesNotMatch(block, /requestAnimationFrame\(/);
  const css = read('src/admin/admin.css');
  assert.match(css, /\.ctrl label\.lbl > \.lbl-t \{/);
});

test('klavye odağı görünüyor: kaydırıcı, liste, ışık seçimi', () => {
  const css = read('src/admin/admin.css');
  assert.match(css, /input\[type=range\]:focus-visible \{ outline: 2px solid var\(--accent\)/);
  assert.match(css, /\.lighting-select-wrap:focus-visible \{ outline: 2px solid var\(--accent\)/);
  assert.match(css, /\nselect:focus \{ border-color: var\(--accent\); \}/);
  // Satır içi stil odak kuralını eziyordu: panel betikleri kenarlık/outline yazmıyor
  const dir = path.join(root, 'src', 'admin');
  fs.readdirSync(dir).filter((f) => f.endsWith('.js')).forEach((f) => {
    const s = fs.readFileSync(path.join(dir, f), 'utf8');
    assert.doesNotMatch(s, /cssText[^;\n]*outline\s*:\s*none/, f + ': satır içi outline:none');
  });
});

test('araç çubuğundaki ve özel yerleşimli denetimlerin kendi adı var', () => {
  assert.match(read('src/admin/group-panel.js'), /class: 'xf-slider',[\s\S]{0,80}'aria-label': 'A\/B Çapraz Geçiş'/);
  assert.match(read('src/admin/analysis-panel.js'), /'data-path': 'audio\.humGuard',[\s\S]{0,80}'aria-label': 'Akıllı Sessizlik Filtresi'/);
  assert.match(read('src/admin/mcp-panel.js'), /'aria-label': tx\('mcp\.port\.label'\)/);
  const tl = read('src/admin/timeline-panel.js');
  assert.match(tl, /bpmIn\.setAttribute\('aria-label'/);
  assert.match(tl, /bpbIn\.setAttribute\('aria-label'/);
  const i18n = read('src/shared/i18n.js');
  ["'A/B Çapraz Geçiş': 'A/B Crossfade'", "'Oynatma kafasındaki tempo (BPM)':", "'Ölçüdeki vuruş sayısı':"].forEach((k) => assert.ok(i18n.includes(k), k));
});

test('öz test adsız denetimi ve görünmeyen odağı FAIL sayıyor', () => {
  const m = read('src/main/main.js');
  const i = m.indexOf('Erişilebilirlik (#777)');
  assert.ok(i > 0, 'öz test adımı');
  const step = m.slice(i, i + 7000);
  assert.match(step, /Accessibility\.getFullAXTree/);
  assert.match(step, /Input\.dispatchKeyEvent', \{ type: 'keyDown', key: 'Tab'/);
  assert.match(step, /control\(s\) without an accessible name/);
  assert.match(step, /without a visible focus change/);
  assert.match(step, /named < 500/);
  assert.match(step, /tabbed < 300/);
});
