'use strict';
/* Uygulama kapanınca GERÇEKTEN kapansın.
 *
 * v3.1.3'te bildirilen hata: kurulum yapılıp uygulama açılıp kapatıldığında
 * süreç arka planda yaşamaya devam ediyordu ve Görev Yöneticisi'nden
 * sonlandırmak gerekiyordu.
 *
 * Nedeni: Electron'un 'window-all-closed' olayı GİZLİ pencereleri de sayar.
 * Spout/Syphon paylaşımı açıksa gizli bir BrowserWindow AÇILIŞTA oluşuyor
 * (syncTextureShare), panel kapandığında da yerinde kalıyordu. Olay hiç
 * tetiklenmediği için app.quit() çağrılmıyor, before-quit temizliği
 * çalışmıyor ve uygulama görünür penceresi olmadan ayakta kalıyordu.
 * Ampirik olarak doğrulandı: gizli pencere yokken olay tetikleniyor, tek bir
 * gizli pencere varken tetiklenmiyor.
 *
 * Bu testler kaynağa bakıyor. Sebebi i18n testleriyle aynı: main.js Electron'a
 * bağlı, Node'da require edilemiyor. Asıl davranış duman testinde ölçülüyor;
 * buradaki denetim saniyenin altında çalışıp aynı hata sınıfını erken yakalar.
 */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(root, p), 'utf-8');

/* Yorumları ayıklar. Bu şart: yorum bırakılırsa devre dışı bırakılmış bir
   çağrı ("// closeHelperWindows();") metinde görünmeye devam eder ve denetim
   sessizce geçer. İlk yazımda tam olarak böyle olmuştu — çağrıyı yorum satırı
   yapıp testi çalıştırdım ve test hâlâ geçiyordu. */
const stripComments = (s) =>
  s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/[^\n]*/g, '$1');

const main = () => stripComments(read('src/main/main.js'));

/* Gizli pencere açan HER yer burada kayıtlı olmalı ve karşısındaki temizlik
   çağrısı closeHelperWindows() içinde bulunmalı.

   Liste bilerek elle tutuluyor: yeni bir gizli pencere ekleyen kişi buraya da
   yazmak zorunda kalsın, yani "kapanışta ne olacak?" sorusunu atlayamasın. */
const HIDDEN_WINDOW_SITES = [
  { file: 'src/main/texture-share.js', teardown: 'textureShare.stop()' },
  { file: 'src/main/main.js', teardown: "finalizeExport('cancelled')" },
];

/* Ana süreçte gizli pencere açan dosyaları kaynaktan bulur. */
function filesCreatingHiddenWindows() {
  const dir = path.join(root, 'src', 'main');
  const out = [];
  for (const name of fs.readdirSync(dir)) {
    if (!name.endsWith('.js')) continue;
    const rel = 'src/main/' + name;
    const src = read(rel);
    // Yorumları ayıkla: örnek/açıklama metni yanlış pozitif üretmesin.
    const code = stripComments(src);
    if (/new BrowserWindow\(\{[\s\S]{0,600}?show:\s*false/.test(code)) out.push(rel);
  }
  return out.sort();
}

/* Bir fonksiyonun gövdesini kaynaktan çıkarır (süslü parantez sayarak). */
function functionBody(src, name) {
  const start = src.indexOf('function ' + name + '(');
  assert.ok(start >= 0, name + '() kaynakta bulunamadı');
  const open = src.indexOf('{', start);
  let depth = 0;
  for (let i = open; i < src.length; i++) {
    if (src[i] === '{') depth++;
    else if (src[i] === '}') {
      depth--;
      if (depth === 0) return src.slice(open, i + 1);
    }
  }
  assert.fail(name + '() gövdesi kapanmıyor');
}

test('gizli pencere açan her dosya kayıtlı', () => {
  /* Yeni bir gizli pencere eklenip listeye yazılmazsa burada düşer —
     asıl korunan şey bu: hatanın sınıfı, tek tek örnekleri değil. */
  const found = filesCreatingHiddenWindows();
  const known = HIDDEN_WINDOW_SITES.map((s) => s.file).sort();
  assert.deepStrictEqual(found, known,
    'gizli pencere açan dosyalar değişmiş.\n' +
    '  bulunan: ' + found.join(', ') + '\n' +
    '  kayıtlı: ' + known.join(', ') + '\n' +
    '  Yeni bir gizli pencere eklediyseniz closeHelperWindows() içinde\n' +
    '  kapatın ve HIDDEN_WINDOW_SITES listesine ekleyin; aksi halde\n' +
    "  'window-all-closed' tetiklenmez ve uygulama arka planda asılı kalır.");
});

test('closeHelperWindows() her gizli pencereyi kapatıyor', () => {
  const body = functionBody(main(), 'closeHelperWindows');
  for (const site of HIDDEN_WINDOW_SITES) {
    assert.ok(body.indexOf(site.teardown) >= 0,
      site.file + ' için temizlik çağrısı yok: ' + site.teardown);
  }
});

test('panel kapanınca yardımcı pencereler de kapatılıyor', () => {
  /* Temizlik fonksiyonunun var olması yetmez, çağrılması da gerekir. */
  const src = main();
  const i = src.indexOf("adminWin.on('closed'");
  assert.ok(i > 0, "adminWin.on('closed') bulunamadı");
  const handler = src.slice(i, src.indexOf('\n  });', i));
  assert.ok(handler.indexOf('closeHelperWindows()') >= 0,
    'panel kapanış işleyicisi closeHelperWindows() çağırmıyor — ' +
    'gizli pencereler kalır ve uygulama kapanmaz');
});

test('kapanış temizliği tek yerde ve eksiksiz', () => {
  /* before-quit iki daldan da aynı temizliği çalıştırmalı. Liste kopyalandığı
     sürece sürükleniyordu: textureShare ile openrgb her iki dalda da eksikti
     ve Spout göndericisi uygulama kapandıktan sonra kayıtlı kalıyordu. */
  const src = main();
  const body = functionBody(src, 'shutdownCleanup');
  const required = [
    'streamServer.stop()',
    'oscServer.stop()',
    'artnet.stop()',
    'dynamicLighting.stop()',
    'openrgb.stop()',
    'textureShare.stop()',
    'mediaSession.stop()',
    'nativeAudio.stopCapture()',
  ];
  const missing = required.filter((r) => body.indexOf(r) < 0);
  assert.deepStrictEqual(missing, [], 'kapanış temizliğinde eksik: ' + missing.join(', '));

  /* before-quit kendi listesini TAŞIMAMALI; yoksa dallar yeniden ayrışır. */
  const q = src.indexOf("app.on('before-quit'");
  assert.ok(q > 0, 'before-quit bulunamadı');
  const handler = src.slice(q, src.indexOf('\napp.on(', q + 10));
  assert.ok(handler.indexOf('streamServer.stop()') < 0,
    'before-quit temizlik listesini yeniden kopyalamış — shutdownCleanup() kullanın');
  assert.ok(handler.indexOf('shutdownCleanup()') >= 0,
    'before-quit shutdownCleanup() çağırmıyor');
});

test('Windows ve Linux tüm pencereler kapanınca çıkıyor', () => {
  /* macOS'ta uygulamanın pencere olmadan yaşaması normaldir; diğerlerinde
     değil. Bu koşul kaldırılırsa uygulama her platformda asılı kalır. */
  const src = main();
  const i = src.indexOf("app.on('window-all-closed'");
  assert.ok(i > 0, 'window-all-closed bulunamadı');
  const handler = src.slice(i, i + 200);
  assert.match(handler, /platform\s*!==\s*'darwin'/);
  assert.match(handler, /app\.quit\(\)/);
});
