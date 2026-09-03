'use strict';
/* Platforma göre paketleme ve arayüz korumalarının testleri.
 *
 * Buradaki denetimler kaynağa bakar, çünkü korudukları şeylerin çoğu ancak
 * O PLATFORMDA çalıştırılınca görünür ve bizde yalnız Windows var. Bir mac
 * ya da linux derlemesinin bozuk çıktığını CI'da fark etmek, kullanıcıdan
 * duymaktan iyidir.
 */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(root, p), 'utf-8');
const pkg = JSON.parse(read('package.json'));
const build = pkg.build;

test('ortak extraResources Windows dosyaları istemiyor', () => {
  /* Eskiden koşulsuzdu: mac/linux derlemesi olmayan node.exe ile
     dynamic_lighting.node istiyordu ve derleme daha başlamadan patlıyordu. */
  const shared = JSON.stringify(build.extraResources || []);
  assert.ok(!/node\.exe|dynamic_lighting|identity/.test(shared),
    'Windows dosyaları ortak extraResources içinde: ' + shared);
});

test('Windows kaynakları win altında', () => {
  const winRes = JSON.stringify(build.win.extraResources || []);
  assert.match(winRes, /dynamic_lighting\.node/);
  assert.match(winRes, /build\/identity/);
});

test('hiçbir platforma node ikilisi paketlenmiyor', () => {
  /* Electron zaten bir Node çalıştırıcısı (ELECTRON_RUN_AS_NODE). Ayrıca
     node.exe göndermek 93 MB'lık ölü ağırlıktı. */
  const all = JSON.stringify(build);
  assert.ok(!/node\.exe/.test(all), 'build yapılandırmasında hâlâ node.exe var');
  assert.ok(!/prepare-runtime/.test(JSON.stringify(pkg.scripts)),
    'dist betiği hâlâ node indiriyor');
});

test('üç platformun da hedefi tanımlı', () => {
  const names = (t) => (build[t].target || []).map((x) => (typeof x === 'string' ? x : x.target));
  assert.deepStrictEqual(names('win').sort(), ['nsis', 'portable']);
  assert.deepStrictEqual(names('mac').sort(), ['dmg', 'zip']);
  assert.deepStrictEqual(names('linux').sort(), ['AppImage', 'deb']);
});

test('macOS mikrofon izni açıklaması var', () => {
  /* BU OLMADAN macOS UYGULAMAYI SONLANDIRIR. audify bir giriş aygıtı açar
     (macOS'ta loopback de bir giriş aygıtı olarak görünür), ve işletim
     sistemi NSMicrophoneUsageDescription'ı olmayan uygulamayı anında
     öldürür. Eksikliği ancak gerçek bir Mac'te çökme olarak görülürdü. */
  const info = (build.mac && build.mac.extendInfo) || {};
  assert.ok(info.NSMicrophoneUsageDescription,
    'NSMicrophoneUsageDescription yok — mac derlemesi ses açılınca çöker');
  assert.ok(info.NSMicrophoneUsageDescription.length > 30,
    'Apple genel/boş açıklamaları reddeder');
});

test('her platformun ikonu üreteciyle eşleşiyor', () => {
  /* İkonlar build/ altında ÜRETİLİR ve depoya girmez, o yüzden burada
     "dosya var mı" diye sorulamaz — temiz bir çıkarımda hiçbiri yoktur.
     Korunması gereken şey zaten farklı: paketleme yapılandırmasının,
     üretecin gerçekten yazdığı dosyaları göstermesi. Biri diğerinden
     kopunca derleme ancak o platformda, paketleme anında patlar. */
  const gen = read('scripts/gen-icons.js');
  const icons = {
    win: build.win.icon,
    mac: build.mac.icon,
    linux: build.linux.icon,
  };
  for (const [platform, p] of Object.entries(icons)) {
    assert.ok(p, platform + ' için ikon belirtilmemiş');
    assert.match(p, /^build\//, platform + ' ikonu build/ altında olmalı: ' + p);
    const base = path.basename(p);
    assert.ok(gen.includes(base), platform + ' ikonunu (' + base + ') üreten yok');
  }
  /* Yerelde üretilmişse yolların doğruluğu ayrıca doğrulanır. */
  for (const p of Object.values(icons)) {
    const full = path.join(root, p);
    if (fs.existsSync(path.dirname(full))) {
      assert.ok(fs.existsSync(full), p + ' üretilmiş olmalıydı');
    }
  }
});

test('arayüze platform bilgisi veriliyor', () => {
  const pre = read('src/main/preload-admin.js');
  assert.match(pre, /SV_PLATFORM/, 'preload platformu bildirmiyor');
  for (const k of ['isWindows', 'isMac', 'isLinux']) {
    assert.ok(pre.includes(k), k + ' bildirilmemiş');
  }
});

test('Dynamic Lighting kartı yalnız Windows\'ta çiziliyor', () => {
  const admin = read('src/admin/admin.js');
  const i = admin.indexOf("title: 'Windows Dynamic Lighting'");
  assert.ok(i > 0, 'Dynamic Lighting bölümü bulunamadı');
  const before = admin.slice(Math.max(0, i - 700), i);
  assert.match(before, /show:\s*isWindows/,
    'bölümde platform koruması yok — mac/linux kullanıcısı çalışmayan bir kart görür');
});

test('gizli bölümler aramada çıkmıyor', () => {
  /* Kart gizlenip arama dizini güncellenmezse, mac kullanıcısı "lighting"
     araması yapınca sonucu bulur, tıklar ve hiçbir yere gitmez. */
  const admin = read('src/admin/admin.js');
  const i = admin.indexOf('function buildSearchIndex');
  assert.ok(i > 0);
  const body = admin.slice(i, i + 900);
  assert.match(body, /sec\.show\s*&&\s*!sec\.show\(\)/,
    'arama dizini bölümün show() korumasına bakmıyor');
});

test('Dynamic Lighting arka ucu her platformda güvenli', () => {
  const dl = read('src/main/dynamic-lighting.js');
  const guards = (dl.match(/process\.platform\s*!==\s*'win32'/g) || []).length;
  assert.ok(guards >= 5, 'beklenen platform koruması sayısı düştü: ' + guards);
});
