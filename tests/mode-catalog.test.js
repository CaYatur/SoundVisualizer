'use strict';
/* Mod kataloğu (#638): panelin, katman listesinin, Otomatik VJ'nin, kısayol
 * döngüsünün, telefon kumandasının ve sahne üreticisinin okuduğu TEK liste.
 *
 * Katalog motorun gerçek kayıtlarıyla (window.SVModes / window.SVBackgrounds)
 * karşılaştırılıyor: katalogda olup motorda olmayan bir mod seçildiğinde boş
 * ekran verir, motorda olup katalogda olmayan bir mod hiçbir yerde görünmez.
 * İkisi de sessizdir. Kayıtlar mod dosyalarından okunuyor; dosyalar tarayıcı
 * ortamı istediği için çalıştırılmıyor.
 */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const MC = require('../src/shared/mode-catalog.js');

const MODES_DIR = path.join(__dirname, '..', 'src', 'visualizer', 'modes');

function registered(globalName) {
  const out = new Set();
  for (const f of fs.readdirSync(MODES_DIR)) {
    if (!f.endsWith('.js')) continue;
    const src = fs.readFileSync(path.join(MODES_DIR, f), 'utf8');
    // window.SVModes.ad = Sınıf;
    const one = new RegExp('window\\.' + globalName + '\\.([A-Za-z0-9]+)\\s*=\\s*[A-Z]', 'g');
    let m;
    while ((m = one.exec(src))) out.add(m[1]);
    // Object.assign(window.SVModes, { ad: Sınıf, ... }) ya da window.SVBackgrounds = { ... }
    const block = new RegExp('(?:Object\\.assign\\(window\\.' + globalName + ',\\s*|window\\.' + globalName + '\\s*=\\s*)\\{([^}]*)\\}', 'g');
    while ((m = block.exec(src))) {
      for (const k of m[1].matchAll(/([A-Za-z0-9]+)\s*:/g)) out.add(k[1]);
    }
  }
  return out;
}

test('katalogdaki her görselleştirici motorda kayıtlı, kayıtlı her mod katalogda', () => {
  const reg = registered('SVModes');
  assert.ok(reg.size > 40, 'kayıt okunamadı: ' + reg.size);
  // 'none' çizim yapmıyor; 'gradient' ön mod değil, arkaplan motoru
  const ids = MC.ids('visualizer').filter((id) => id !== 'none');
  assert.deepStrictEqual(ids.filter((id) => !reg.has(id)), [], 'katalogda var, motorda yok');
  const extra = [...reg].filter((id) => id !== 'gradient' && MC.ids('visualizer').indexOf(id) < 0);
  assert.deepStrictEqual(extra, [], 'motorda var, katalogda yok');
});

test('katalogdaki her arkaplan motorda kayıtlı, kayıtlı her arkaplan katalogda', () => {
  const reg = registered('SVBackgrounds');
  assert.ok(reg.size > 25, 'kayıt okunamadı: ' + reg.size);
  // gradient kendi motoru, düz renk çizim gerektirmiyor, Studio bir preset seçer
  const SPECIAL = ['gradient', 'solid', 'custom'];
  const ids = MC.ids('background').filter((id) => SPECIAL.indexOf(id) < 0);
  assert.deepStrictEqual(ids.filter((id) => !reg.has(id)), [], 'katalogda var, motorda yok');
  const extra = [...reg].filter((id) => MC.ids('background').indexOf(id) < 0);
  assert.deepStrictEqual(extra, [], 'motorda var, katalogda yok');
});

test('kimlikler benzersiz, her kaydın adı ve grubu var, gruplar dağılmıyor', () => {
  for (const kind of ['visualizer', 'background']) {
    const list = kind === 'visualizer' ? MC.VISUALIZERS : MC.BACKGROUNDS;
    const ids = list.map((m) => m.id);
    assert.strictEqual(new Set(ids).size, ids.length, kind + ': yinelenen kimlik');
    for (const m of list) assert.ok(m.label && m.group, kind + '/' + m.id + ': ad ya da grup yok');
    // Aynı grup seçicide tek başlık altında toplanmalı
    const heads = MC.options(kind).filter((o) => o.group).map((o) => o.group);
    assert.strictEqual(new Set(heads).size, heads.length, kind + ': grup bölünmüş: ' + heads.join(', '));
  }
});

test('yardımcılar: bayraklar, etiket, dolaşım ve katman listesi', () => {
  assert.ok(MC.is('visualizer', 'bars', 'bands') && MC.is('visualizer', 'bars', 'gap'));
  assert.ok(!MC.is('visualizer', 'wave', 'bands') && MC.is('visualizer', 'wave', 'wave'));
  assert.ok(!MC.is('visualizer', 'yok-böyle', 'bands'));
  assert.strictEqual(MC.label('visualizer', 'galaxy'), 'Galaksi');
  assert.strictEqual(MC.label('visualizer', 'bilinmeyen'), 'bilinmeyen', 'bilinmeyen kimlik olduğu gibi');
  assert.ok(MC.cycleIds('visualizer').indexOf('none') < 0 && MC.cycleIds('visualizer').indexOf('milkdrop') >= 0);
  assert.ok(MC.cycleIds('background').indexOf('custom') < 0 && MC.cycleIds('background').indexOf('solid') >= 0);
  const layer = MC.layerPairs('visualizer').map((p) => p[0]);
  assert.ok(layer.indexOf('none') < 0 && layer.indexOf('nowplaying') >= 0);
});

/* Etiketlerin İngilizcesi: panel DOM'u sözlükten çeviriyor, eksik bir girdi
   İngilizce arayüzde Türkçe mod adı bırakır. */
test('her mod adının İngilizcesi sözlükte', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'src', 'shared', 'i18n.js'), 'utf8');
  const labels = MC.VISUALIZERS.concat(MC.BACKGROUNDS).map((m) => m.label);
  const groups = MC.VISUALIZERS.concat(MC.BACKGROUNDS).map((m) => m.group);
  const missing = [...new Set(labels.concat(groups))].filter((s) => !src.includes("'" + s + "':"));
  assert.deepStrictEqual(missing, []);
});

/* Eski kopyalar geri gelmesin: listeyi elle tutan dosya yine sessizce
   eskir. Kaynak dosyalarda mod kimliklerinden oluşan uzun dizi kalmamalı. */
test('panel, kumanda ve kısayol dosyalarında elle tutulan mod listesi yok', () => {
  const SRC = path.join(__dirname, '..', 'src');
  const files = ['admin/admin.js', 'admin/scene-panels.js', 'admin/control.js', 'web/remote.js', 'shared/autovj.js'];
  const ids = MC.ids('visualizer').concat(MC.ids('background')).filter((id) => id.length > 4);
  for (const f of files) {
    const src = fs.readFileSync(path.join(SRC, f), 'utf8');
    for (const line of src.split(/\r?\n/)) {
      // Yapılandırma anahtarları da mod adlarıyla çakışabiliyor ('text',
      // 'milkdrop'); satırın dizelerinin çoğu mod kimliği olmalı
      const quoted = (line.match(/'[^']*'/g) || []).length;
      const hits = ids.filter((id) => line.includes("'" + id + "'")).length;
      assert.ok(hits < 5 || hits < quoted * 0.7, f + ': mod listesi gibi görünen satır: ' + line.trim().slice(0, 100));
    }
  }
});
