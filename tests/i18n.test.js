'use strict';
/* Çeviri sözlüğünün sözleşmesi.
 *
 * SORUN: sözlük düz bir JavaScript nesne değişmezi. Aynı anahtar iki kez
 * yazılırsa JS SESSİZCE sonuncuyu tutar; önceki çeviri ölür. Hata yok,
 * uyarı yok — yalnızca arayüzde yanlış İngilizce kelime. Bu gerçekten oldu:
 * sözlükte 664 yinelenen giriş vardı ve 183'ünde iki farklı karşılık
 * yazılmıştı.
 *
 * Daha ince ikinci katman: arama `normalize()` ile yapılıyor (boşluklar
 * kırpılıp sadeleşiyor). Yani 'Satır ' ve 'Satır' AYNI kovaya düşüyor ve
 * yine sonuncu kazanıyor. 'Satır ': 'Line ' girdisi tam bunu yapıp
 * 'Satır': 'Row' çevirisini öldürüyordu; Klip Destesi satırları İngilizce
 * arayüzde "Line  1" olarak çıkıyordu — yanlış kelime, üstelik çift boşlukla.
 *
 * Bu yüzden test ÇALIŞMA ANINA değil KAYNAĞA bakıyor: çakışma nesne
 * kurulurken gerçekleşiyor, EN_NORMALIZED'a ulaşıldığında kanıt çoktan yok
 * olmuş oluyor.
 */

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const FILE = path.join(__dirname, '..', 'src', 'shared', 'i18n.js');
const src = fs.readFileSync(FILE, 'utf-8');

// EN sözlüğünün kaynaktaki sınırları
const start = src.indexOf('const EN = {');
const end = src.indexOf('const EN_NORMALIZED');
const body = src.slice(start, end);

const normalize = (v) => String(v).replace(/\s+/g, ' ').trim();

/* Kaynaktan 'anahtar': 'değer' çiftlerini çıkarır. Girişler çok satırlı
   olabiliyor (anahtar bir satırda, değeri sonrakinde), o yüzden `\s`
   satır sonunu da geçiyor. */
function entries() {
  const STR = "'((?:[^'\\\\]|\\\\.)*)'";
  const re = new RegExp(STR + '\\s*:\\s*' + STR, 'g');
  const out = [];
  let m;
  while ((m = re.exec(body))) {
    out.push({
      key: m[1],
      val: m[2],
      line: src.slice(0, start + m.index).split('\n').length,
    });
  }
  return out;
}

test('sözlük ayrıştırılabiliyor ve boş değil', () => {
  assert.ok(start >= 0 && end > start, 'EN bloğu bulunamadı');
  assert.ok(entries().length > 1500, 'beklenenden az giriş: ' + entries().length);
});

/* Asıl bekçi: aynı anahtar iki farklı karşılıkla tanımlanamaz. */
test('hiçbir anahtar iki farklı karşılıkla tanımlanmamış', () => {
  const groups = new Map();
  for (const e of entries()) {
    const n = normalize(e.key);
    if (!groups.has(n)) groups.set(n, []);
    groups.get(n).push(e);
  }
  const bad = [];
  for (const [n, list] of groups) {
    const vals = new Set(list.map((e) => e.val));
    if (vals.size > 1) {
      bad.push('  ' + JSON.stringify(n) + '\n'
        + list.map((e) => '      satır ' + e.line + ': ' + JSON.stringify(e.val)).join('\n'));
    }
  }
  assert.strictEqual(bad.length, 0,
    bad.length + ' anahtar birden çok karşılıkla tanımlanmış '
    + '(JS sonuncuyu tutar, öncekiler ölür):\n' + bad.join('\n'));
});

/* Aynı karşılıkla da olsa yineleme gürültü: sonraki düzenlemede biri
   değiştirilip diğeri unutulursa yukarıdaki hata sınıfı geri döner. */
test('hiçbir anahtar birden çok kez yazılmamış', () => {
  const seen = new Map();
  const dup = [];
  for (const e of entries()) {
    const n = normalize(e.key);
    if (seen.has(n)) dup.push(JSON.stringify(n) + ' (satır ' + seen.get(n) + ' ve ' + e.line + ')');
    else seen.set(n, e.line);
  }
  assert.strictEqual(dup.length, 0, dup.length + ' yinelenen anahtar:\n  ' + dup.slice(0, 20).join('\n  '));
});

/* Kırpılmamış anahtar normalize sonrası kırpılmışın üstüne biner ve
   çeviriye kaçak boşluk sızdırır. */
test('anahtarların başında ve sonunda boşluk yok', () => {
  const bad = entries()
    .filter((e) => e.key !== e.key.trim() && e.key.trim() !== '')
    .map((e) => JSON.stringify(e.key) + ' (satır ' + e.line + ')');
  assert.strictEqual(bad.length, 0, 'kırpılmamış anahtar:\n  ' + bad.join('\n  '));
});

// ------------------------------------------------------- çalışma anı davranışı

/* Sözlüğü sahte bir tarayıcıda yükler. i18n.js `navigator`, `localStorage`
   ve `document` bekliyor; testte hiçbiri yok. */
function loadEnglish() {
  const doc = {
    documentElement: { lang: '' }, readyState: 'complete', title: '', body: {},
    addEventListener: () => {},
  };
  const win = {
    navigator: { languages: ['en-US'], language: 'en-US' },
    localStorage: { getItem: () => 'en', setItem: () => {} },
    alert: () => {}, confirm: () => {}, document: doc,
    MutationObserver: function () { this.observe = () => {}; },
    Node: { TEXT_NODE: 3, ELEMENT_NODE: 1 },
  };
  win.window = win;
  vm.runInContext(src, vm.createContext(win), { filename: 'i18n.js' });
  return win.SVI18n;
}

test('İngilizce sözlük yüklenir', () => {
  const i18n = loadEnglish();
  assert.strictEqual(i18n.locale, 'en');
  assert.strictEqual(i18n.t('Ayarlar'), 'Settings');
});

test('Türkçe seçiliyken metin olduğu gibi kalır', () => {
  const doc = {
    documentElement: { lang: '' }, readyState: 'complete', title: '', body: {},
    addEventListener: () => {},
  };
  const win = {
    navigator: { languages: ['tr-TR'], language: 'tr-TR' },
    localStorage: { getItem: () => 'tr', setItem: () => {} },
    alert: () => {}, confirm: () => {}, document: doc,
    MutationObserver: function () { this.observe = () => {}; },
    Node: { TEXT_NODE: 3, ELEMENT_NODE: 1 },
  };
  win.window = win;
  vm.runInContext(src, vm.createContext(win), { filename: 'i18n.js' });
  assert.strictEqual(win.SVI18n.t('Ayarlar'), 'Ayarlar');
});

/* 'Satır ': 'Line ' girdisinin öldürdüğü çeviriler. */
test('kırpılmış anahtarların karşılığı geçerli', () => {
  const t = loadEnglish().t;
  assert.strictEqual(t('Satır'), 'Row');
  assert.strictEqual(t('Yuva'), 'Slot');
  assert.strictEqual(t('Sahne'), 'Scene');
});

/* Yinelenen anahtarlar temizlenirken hangi karşılığın kalacağına karar
   verildi. Bunlar kullanım yerine bakılarak seçildi — sözlükte kazanan
   karşılık birkaçında yanlıştı:
     'Tür'      background.type / visualizer.type / geçiş türü → "Genre" değil
     'Karışım'  katman ve post-FX karışım modları → "Mix" değil
     'Kapalı'   açma/kapama durumları → "Closed" değil
     'Genel'    Bas/Orta/Tiz/Genel bant seçicisi → "Master" değil
     'Sönüm'    formüllerdeki sönümleme; 'Sönme' ile ikisi de "Decay" idi */
test('bağlama göre seçilen terimler', () => {
  const t = loadEnglish().t;
  const beklenen = {
    'Tür': 'Type',
    'Karışım': 'Blend',
    'Kapalı': 'Off',
    'Genel': 'Overall',
    'Sönüm': 'Damping',
    'Sönme': 'Decay',
    'Dairesel Dalga': 'Radial Wave',
    'Renk Düzeltme': 'Color Correction',
    'Çalan Parça': 'Now Playing',
    'Hazır Şablonlar': 'Built-in Presets',
    /* Durum noktasının on/off sınıflarıyla eşleşen çift. 'Açık' iki yerde
       geçiyor — görselleştirici durumu ve zaman çizelgesindeki sustur
       düğmesi (Sessiz/Açık) — ve "Open" ikincisinde yanlıştı. */
    'Açık': 'On',
  };
  for (const [tr, en] of Object.entries(beklenen)) {
    assert.strictEqual(t(tr), en, JSON.stringify(tr) + ' yanlış çevriliyor');
  }
});

/* 'Sarmal' hem spiral arkaplanına hem helix moduna verilmişti; İngilizcede
   helix modu "Spiral" okunuyordu. Düz sözlük ikisini ayıramaz, o yüzden
   helix modunun Türkçe adı 'Helis' yapıldı. Aynı şekilde 'Kutup' hem soğuk
   renk şablonunun adı hem uzaktan kumandada aurora arkaplanıydı. */
test('aynı adı paylaşan iki ayrı öge kaynağında ayrıldı', () => {
  const t = loadEnglish().t;
  assert.strictEqual(t('Sarmal'), 'Spiral');
  assert.strictEqual(t('Helis'), 'Helix');
  assert.strictEqual(t('Kutup'), 'Polar');
  assert.strictEqual(t('Kutup Işıkları'), 'Northern Lights');

  const root = path.join(__dirname, '..', 'src');
  const read = (p) => fs.readFileSync(path.join(root, p), 'utf-8');
  for (const f of ['admin/admin.js', 'admin/scene-panels.js', 'admin/scenegen.js', 'web/remote.js', 'shared/mode-catalog.js']) {
    const txt = read(f);
    assert.ok(!/helix['"]?\s*[:,]\s*['"]Sarmal['"]/.test(txt) && !/\['helix', 'Sarmal'\]/.test(txt),
      f + ' hâlâ helix için Sarmal kullanıyor');
  }
});

/* Klip Destesi etiketleri kullanıcının verdiği adla BİRLEŞTİRİLİYOR, o
   yüzden tam dize olarak sözlükte bulunamıyorlar. control.js sabit kelimeyi
   önce çevirip birleştiriyor; sonuçta Türkçe kelime kalmamalı. */
test('birleşik deste etiketlerinde Türkçe kelime kalmıyor', () => {
  const t = loadEnglish().t;
  const labels = [
    'Deste · ' + t('Yuva') + ' (1×1)',
    'Deste · ' + t('Satır') + ' 1',
    'Deste · ' + t('Satır') + ' Intro',
  ];
  for (const l of labels) {
    const out = t(l);
    assert.ok(!/Deste|Satır|Yuva/.test(out), 'Türkçe kaldı: ' + JSON.stringify(out));
    assert.ok(!/ {2}/.test(out), 'çift boşluk: ' + JSON.stringify(out));
  }
});

/* Kullanıcının verdiği ad çevrilmemeli — sözlükte rastlantısal bir
   eşleşme olsa bile parça adı olduğu gibi kalmalı. */
test('kullanıcının verdiği ad olduğu gibi kalır', () => {
  const t = loadEnglish().t;
  assert.match(t('\u{1F39B} Deste · Davul (2×3)'), /Davul/);
});

/* ÇALAN PARÇANIN ADI bir çeviri yüzeyi değil.

   İngilizce arayüz taraması (smoke) Türkçe metin arıyor ve canlı şarkı
   başlığını da okuyordu: Türkçe adlı bir parça çalarken sürüm kapısı
   düşüyordu. Kapının sonucu o an ne dinlendiğine bağlı olamaz. Aynı
   ayrım kaynak adı, sahne adı ve URL alanı için zaten yapılmıştı; canlı
   parça başlığı listede yoktu. */
test('canlı parça başlığı i18n taramasının dışında', () => {
  const fs = require('fs');
  const path = require('path');
  const read = (p) => fs.readFileSync(path.join(__dirname, '..', p), 'utf-8');
  const main = read('src/main/main.js');
  const admin = read('src/admin/admin.js');
  const skip = /var skip = '([^']+)'\.split\(','\)/.exec(main);
  assert.ok(skip, 'tarama atlama listesi bulunamadı');
  assert.ok(skip[1].split(',').indexOf('np-live') >= 0,
    'np-live atlama listesinde değil: ' + skip[1]);
  // Sınıf gerçekten canlı başlığa veriliyor mu
  assert.match(admin, /class: 'np-live'[^}]*\$\{live\.title\}/);
});

/* ÜRETİLEN VE KARIŞIM PRESETLERİNİN ADI (#579) çeviriden olduğu gibi
   geçmeli: bir presetin adı onun kendi adı. Çeviri " · " gördüğü metni
   bölüp parçaları ayrı ayrı çeviriyor; adın bir parçası sözlükte anahtar
   olunca İngilizce arayüzde başka bir şey okunuyor. İki kez böyle oldu:
   "Karışım · …" → "Blend · …" (katman karışımı), ve üretilen
   "Dingin Halkalar" yerleşik bir presetin adıydı → "Still Rings". */
test('üretilen ve karışım adları çeviriden olduğu gibi geçiyor', () => {
  const t = loadEnglish().t;
  const G = require('../src/shared/milkdrop-generator.js');
  const X = require('../src/shared/milkdrop-mashup.js');
  const B = require('../src/shared/presets-milkdrop.js');
  const W = G._test.NAME_WORDS;
  const builtin = new Set(B.map((p) => p.name).concat(B.map((p) => t(p.name))));
  let pairs = 0;
  for (const lang of ['tr', 'en']) {
    const adjs = [].concat(...W[lang].tone, ...W[lang].mood);
    for (const a of adjs) {
      for (const nouns of Object.values(W[lang].noun)) {
        for (const n of nouns) {
          const name = a + ' ' + n + ' · k3x9ab';
          assert.strictEqual(t(name), name, lang + ': ' + name);
          assert.ok(!builtin.has(a + ' ' + n), 'yerleşik presetin adı: ' + a + ' ' + n);
          pairs++;
        }
      }
    }
  }
  assert.ok(pairs > 500, 'çift sayısı ' + pairs);
  // Karışım adı, parçaları veren presetlerin adları sözlükte olsa da bütün kalıyor
  for (const lang of ['tr', 'en']) {
    const n = X.nameFor({ look: 'a', motion: 'b', waves: 'a', shapes: 'a', warp: '', comp: '' },
      (id) => ({ a: 'Tünel', b: 'Girdap' })[id], lang);
    assert.strictEqual(t(n), n, n);
  }
});

/* Kamera, video ve dışa aktarma hataları ya tuvale ya da "Hata:" gövdesine
   yazılıyor. Sözlükteki tam cümle yetmez; ön ek ve çıkış kodu da İngilizce
   olmalı. Kaynak metin Türkçe kalır, çeviri yalnızca İngilizce arayüzde. */
test('kamera ve dışa aktarma hataları İngilizceye çevriliyor', () => {
  const t = loadEnglish().t;
  assert.strictEqual(t('Bu kamera başka bir uygulama tarafından kullanılıyor.'),
    'This camera is in use by another application.');
  assert.strictEqual(t('Kamera izni verilmedi. Sistem ayarlarından izin verin.'),
    'Camera permission was denied. Allow it in system settings.');
  assert.strictEqual(t('Seçilen kamera bulunamadı. Listeden başka bir kamera seçin.'),
    'The selected camera was not found. Choose another camera from the list.');
  assert.strictEqual(t('Kamera açılışı yarıda kesildi. Yeniden deneyin.'),
    'The camera start was interrupted. Try again.');
  assert.strictEqual(t('Kamera açılamadı.'), 'The camera could not be opened.');
  assert.strictEqual(t('Kamera erişimi bu ortamda kullanılamıyor.'),
    'Camera access is not available in this environment.');
  assert.strictEqual(t('Kayıtlı kamera'), 'Saved camera');
  assert.strictEqual(t('Video açılamadı: NotSupportedError'),
    'Could not open the video: NotSupportedError');
  assert.strictEqual(t('Kamera açılamadı: Could not start video source'),
    'Could not open the camera: Could not start video source');
  assert.strictEqual(t('Kodlayıcı borusu kapandı. Dışa aktarma durduruldu.'),
    'The encoder pipe closed. Export was stopped.');
  assert.strictEqual(t('Hata: Kodlayıcı borusu kapandı. Dışa aktarma durduruldu.'),
    'Error: The encoder pipe closed. Export was stopped.');
  assert.strictEqual(t('Hata: ffmpeg çıkış kodu 1\nboom'),
    'Error: ffmpeg exit code 1\nboom');
  assert.strictEqual(t('Hata: bilinmeyen hata'), 'Error: unknown error');
  assert.strictEqual(t('Kamera görüntüsü uygulamadan bekleniyor.'),
    'Waiting for the camera picture from the application.');
});
