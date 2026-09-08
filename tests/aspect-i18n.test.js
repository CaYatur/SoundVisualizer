'use strict';
/* Basıklık düzeltme panelinin çevrilmemiş metni kalmasın.
 *
 * Duman testi bunu zaten yakalıyor ama ancak uygulamanın tamamı ayağa
 * kalkıp arayüz İngilizceye çevrildikten sonra — yani en pahalı yerde.
 * Buradaki denetim kaynağa bakıyor ve saniyenin altında çalışıyor: panele
 * yeni bir Türkçe metin eklenip sözlüğe yazılmazsa birim testinde düşer.
 *
 * Neden yalnız bu panel: kural bütün arayüz için geçerli, ama tek dosyayı
 * güvenilir biçimde taramak tüm arayüzü taramaktan çok daha az yanlış
 * pozitif üretiyor (kaynakta Türkçe geçen her dize arayüze çıkmıyor).
 */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(root, p), 'utf-8');

const TR = /[çğıöşüÇĞİÖŞÜ]/;
const norm = (v) => String(v).replace(/\s+/g, ' ').trim();

/* i18n sözlüğünü KAYNAKTAN çıkarır — tests/i18n.test.js ile aynı gerekçe:
   i18n.js tarayıcıya bağlı (localStorage, document, window.alert) ve Node'da
   require edilemiyor. */
function dictionary() {
  const src = read('src/shared/i18n.js');
  const start = src.indexOf('const EN = {');
  const end = src.indexOf('const EN_NORMALIZED');
  assert.ok(start > 0 && end > start, 'EN sözlüğü kaynakta bulunamadı');
  const body = src.slice(start, end);

  const STR = "'((?:[^'\\\\]|\\\\.)*)'";
  const re = new RegExp(STR + '\\s*:\\s*' + STR, 'g');
  const map = new Map();
  let m;
  while ((m = re.exec(body))) map.set(norm(m[1]), m[2]);
  return map;
}

/* Panelden kullanıcıya görünen dizeleri toplar. Yorumlar ayıklanıyor:
   bu projede yorumlar Türkçe ve hepsi yanlış pozitif olurdu. */
function uiStrings(file) {
  let src = read(file);
  src = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/[^\n]*/g, '$1');
  const out = new Set();
  const re = /'((?:[^'\\]|\\.)*)'/g;
  let m;
  while ((m = re.exec(src))) {
    const s = m[1];
    if (TR.test(s)) out.add(s);
  }
  return Array.from(out);
}

test('sözlük ayrıştırılabiliyor', () => {
  const d = dictionary();
  assert.ok(d.size > 1000, 'sözlük beklenenden küçük: ' + d.size);
});

/* Kalıp olarak çevrilen parçalar. İçlerinde sayı olduğu için sözlük anahtarı
   olamıyorlar; i18n.js'te düzenli ifade kuralıyla çevriliyorlar ve bunu
   aşağıdaki 'maliyet satırı kalıbı' testi ayrıca doğruluyor.
   Liste bilerek DAR: yeni bir metin buraya eklenmeden istisna kazanamaz. */
const PATTERN_PARTS = [' · çizim ', ' ölçü'];

/* Denetlenen paneller. Kural bütün arayüz için geçerli ama tek tek dosya
   taramak tüm kaynağı taramaktan çok daha az yanlış pozitif üretiyor. */
const PANELS = ['src/admin/aspect-panel.js', 'src/admin/autovj.js'];

for (const file of PANELS) {
  const name = file.split('/').pop();

  test(name + ' içindeki her Türkçe metin sözlükte var', () => {
    const dict = dictionary();
    const missing = [];
    for (const s of uiStrings(file)) {
      if (PATTERN_PARTS.indexOf(s) >= 0) continue;
      if (!dict.has(norm(s))) missing.push(s);
    }
    assert.deepStrictEqual(missing, [],
      'sözlüğe eklenmemiş metin:\n  ' + missing.join('\n  '));
  });

  test(name + ' çevirilerinde Türkçe kalmamış', () => {
    const dict = dictionary();
    const bad = [];
    for (const s of uiStrings(file)) {
      const v = dict.get(norm(s));
      if (v && TR.test(v)) bad.push(s + ' -> ' + v);
    }
    assert.deepStrictEqual(bad, [], 'çevirisi hâlâ Türkçe: ' + bad.join(', '));
  });
}

test('kalıp istisnaları gerçekten kullanılıyor', () => {
  /* Ölü bir istisna, ileride gerçek bir metni sessizce affedebilir. */
  const src = PANELS.map(read).join('\n');
  for (const s of PATTERN_PARTS) {
    assert.ok(src.indexOf("'" + s + "'") >= 0,
      'hiçbir panelde geçmeyen istisna: ' + s);
  }
});

test('basıklık bölümünün başlık ve açıklaması sözlükte var', () => {
  /* Bölüm tanımı admin.js'te; panelden ayrı yerde durduğu için ayrı
     denetleniyor. */
  const dict = dictionary();
  const src = read('src/admin/admin.js');
  const i = src.indexOf("id: 'aspect',");
  assert.ok(i > 0, 'basıklık bölümü admin.js içinde bulunamadı');
  const block = src.slice(i, i + 900);

  const title = /title: '((?:[^'\\]|\\.)*)'/.exec(block);
  const desc = /desc: '((?:[^'\\]|\\.)*)'/.exec(block);
  assert.ok(title && desc, 'başlık/açıklama okunamadı');
  for (const s of [title[1], desc[1]]) {
    assert.ok(dict.has(norm(s)), 'sözlükte yok: ' + s.slice(0, 60));
  }
});


test('maliyet satırı PARÇA PARÇA çevriliyor', () => {
  /* Satırdaki sayılar değişken olduğu için sözlük anahtarı olamıyor;
     i18n.js'te düzenli ifade kuralları var.

     KURALLAR NEDEN PARÇA BAŞINA: translate() içinde, kural zincirinden ÖNCE
     çalışan bir ayırıcı var — ' · ' gören her metni bölüp parçaları ayrı ayrı
     kendine geri veriyor. Bu yüzden satırın tamamını eşleyen bir desen asla
     denenmez. Önce tek büyük kural yazılmıştı ve tam olarak böyle sessizce
     ölmüştü; hatayı yalnızca duman testi gösterdi. Bu test onu birim
     düzeyinde yakalar. */
  const src = read('src/shared/i18n.js');
  const wholeLine = /\.replace\(\/\^ekran [^/]*·[^/]*\/g/.test(src);
  assert.ok(!wholeLine,
    'satırın tamamını eşleyen kural geri gelmiş — ayırıcı yüzünden hiç çalışmaz');

  /* Panelin ürettiği parçaların HER BİRİ bir kuralla karşılanmalı. Parçalar
     panelin gerçek biçiminden türetiliyor ki biçim değişince test düşsün. */
  const panel = read('src/admin/aspect-panel.js');
  assert.match(panel, /'ekran ' \+/, 'panel maliyet satırını beklenen biçimde kurmuyor');
  assert.match(panel, /' · çizim ' \+/);
  assert.match(panel, /' kat piksel'/);

  const segments = ['ekran 1920×1080', 'çizim 3227×1080', '1.68 kat piksel'];
  const rules = [
    [/^ekran (\d+)×(\d+)$/, 'screen $1×$2'],
    [/^çizim (\d+)×(\d+)$/, 'drawing $1×$2'],
    [/^([\d.]+) kat piksel$/, '$1× the pixels'],
  ];
  // Kuralların kaynakta gerçekten bulunduğunu doğrula
  for (const [re] of rules) {
    const body = re.source.replace(/\\/g, '\\\\');
    assert.ok(src.indexOf(re.source) >= 0,
      'kural i18n.js içinde yok: ' + body);
  }
  // ve her parçayı Türkçesiz hale getirdiklerini
  for (const seg of segments) {
    let out = seg;
    for (const [re, to] of rules) out = out.replace(re, to);
    assert.ok(!TR.test(out), 'parça çevrilmedi: ' + seg + ' -> ' + out);
    assert.notStrictEqual(out, seg, 'parçaya hiçbir kural değmedi: ' + seg);
  }
});
