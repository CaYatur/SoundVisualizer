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

// ------------------------------------------------ arkaplanların kendi ayarları

/* Otuz arkaplanın yirmi ikisinin ayarı motorda vardı ama panelde yoktu;
   katman panelindeki kopya da Yıldız Alanı'nın üç ayarını motorun
   okumadığı anahtarlara yazıyordu. Liste artık katalogda; burada motorun
   gerçekten okuduğu anahtarlarla ve varsayılanlarla karşılaştırılıyor. */
function msetFallbacks() {
  const out = {};
  for (const f of fs.readdirSync(MODES_DIR)) {
    if (!f.startsWith('backgrounds')) continue;
    const src = fs.readFileSync(path.join(MODES_DIR, f), 'utf8');
    for (const m of src.matchAll(/mset\(cfg, '([a-z]+)', (\{[\s\S]*?\})\)/g)) {
      out[m[1]] = Function('return (' + m[2] + ');')();
    }
  }
  return out;
}

test('her 2D arkaplanın ayarları katalogda; anahtarlar motorun okuduklarıyla aynı', () => {
  const fb = msetFallbacks();
  assert.ok(Object.keys(fb).length >= 30, 'mset okunamadı: ' + Object.keys(fb).length);
  for (const id of MC.ids('background')) {
    const set = MC.settingsOf('background', id);
    if (['gradient', 'solid', 'custom'].indexOf(id) >= 0) { assert.strictEqual(set.length, 0, id); continue; }
    assert.ok(set.length, id + ': panelde ayarı yok');
    assert.deepStrictEqual(set.map((r) => r[0]).sort(), Object.keys(fb[id] || {}).sort(), id + ': anahtarlar motorla aynı değil');
  }
});

test('ayarların varsayılanı defaults.js\'te, motorun yedeğiyle aynı ve aralığın içinde', () => {
  global.window = global.window || {};
  require('../src/shared/defaults.js');
  const def = global.window.SV.defaultConfig().background;
  const fb = msetFallbacks();
  for (const m of MC.BACKGROUNDS) {
    for (const [key, label, min, max, step] of (m.settings || [])) {
      const d = def[m.id] && def[m.id][key];
      assert.strictEqual(d, fb[m.id][key], m.id + '.' + key + ': varsayılan motorun yedeğinden farklı');
      assert.ok(d >= min && d <= max, m.id + '.' + key + ' aralık dışında: ' + d);
      assert.ok(step > 0 && min < max && label, m.id + '.' + key + ': bozuk satır');
    }
  }
});

test('panel ve katman paneli arkaplan ayarlarını katalogdan okuyor', () => {
  const SRC = path.join(__dirname, '..', 'src', 'admin');
  const admin = fs.readFileSync(path.join(SRC, 'admin.js'), 'utf8');
  const layers = fs.readFileSync(path.join(SRC, 'scene-panels.js'), 'utf8');
  assert.ok(!/BG_MODE_CONTROLS/.test(admin) && !/BG_MODE_CONTROLS/.test(layers), 'elle tutulan ayar listesi geri geldi');
  assert.match(admin, /settingsOf\('background', mode\)/);
  assert.match(layers, /settingsOf\('background', l\.type\)/);
});

// ------------------------------------------------ sayfalar mod dosyalarını yüklüyor mu

/* Mod dosyası bir sayfada yüklenmezse o sayfada mod boş çizer ve hiçbir şey
   bunu söylemez: kayıt testi kaynağı okuyor, öz test yalnız görselleştirici
   penceresini dolaşıyor. Görüntü üreten dört sayfa her katalog modunu
   yüklemeli; bilinen istisnalar gerekçesiyle burada. */
const PAGES = {
  'src/visualizer/index.html': [],
  'src/web/overlay.html': [],
  // Çalan Parça canlı sistem medya bilgisinden (SMTC) besleniyor; çevrimdışı
  // dışa aktarımda ve yönetim önizlemesinde o bilgi yok
  'src/exporter/index.html': ['nowplaying.js'],
  'src/admin/index.html': ['nowplaying.js'],
};

function fileRegistry() {
  const out = {};
  const cat = new Set(MC.ids('visualizer').concat(MC.ids('background')));
  for (const f of fs.readdirSync(MODES_DIR)) {
    if (!f.endsWith('.js')) continue;
    const src = fs.readFileSync(path.join(MODES_DIR, f), 'utf8');
    const ids = new Set();
    for (const m of src.matchAll(/window\.SV(?:Modes|Backgrounds)\.([A-Za-z0-9]+)\s*=\s*[A-Z]/g)) ids.add(m[1]);
    for (const m of src.matchAll(/(?:Object\.assign\(window\.SV(?:Modes|Backgrounds),\s*|window\.SVBackgrounds\s*=\s*)\{([^}]*)\}/g)) {
      for (const k of m[1].matchAll(/([A-Za-z0-9]+)\s*:/g)) ids.add(k[1]);
    }
    const inCat = [...ids].filter((id) => cat.has(id));
    if (inCat.length) out[f] = inCat;
  }
  return out;
}

test('görüntü üreten her sayfa her katalog modunun dosyasını doğru sırayla yüklüyor', () => {
  const reg = fileRegistry();
  assert.ok(reg['generative2.js'] && reg['backgrounds-gen2.js'], 'yeni dosyalar kayıt okumasında yok');
  for (const [page, skip] of Object.entries(PAGES)) {
    const html = fs.readFileSync(path.join(__dirname, '..', page), 'utf8');
    const loaded = [...html.matchAll(/modes\/([a-z0-9-]+\.js)/g)].map((m) => m[1]);
    const missing = Object.keys(reg).filter((f) => loaded.indexOf(f) < 0 && skip.indexOf(f) < 0);
    assert.deepStrictEqual(missing, [], page + ': yüklenmeyen mod dosyası');
    // Yardımcılarını başka dosyadan alanlar ondan sonra gelmeli
    const at = (f) => loaded.indexOf(f);
    assert.ok(at('generative2.js') > at('generative.js'), page + ': generative2.js, SVGenUtil tanımlanmadan yükleniyor');
    for (const f of loaded.filter((x) => /^backgrounds-/.test(x))) {
      assert.ok(at(f) > at('backgrounds.js'), page + ': ' + f + ', SVBgUtil tanımlanmadan yükleniyor');
    }
  }
});
