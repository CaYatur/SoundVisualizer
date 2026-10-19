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

test('paketleme yapılandırması electron-builder şemasına uyuyor', (t) => {
  /* Bu denetimin sebebi somut: linux.desktop yanlış biçimde yazılmıştı ve
     hata ancak CI'da, üç koşucu da paketleme adımına geldikten sonra ortaya
     çıktı. Şema doğrulaması yerelde milisaniyeler sürüyor; aynı sınıf hata
     bir daha tam bir CI turu harcamasın.

     Bağımlılıklar kurulu değilse atlanır: birim testi iş akışı bilerek
     kurulum yapmıyor (tests.yml'deki gerekçeye bakınız). */
  let Ajv, scheme;
  try {
    Ajv = require('ajv');
    scheme = require('../node_modules/app-builder-lib/scheme.json');
  } catch {
    t.skip('electron-builder şeması kurulu değil');
    return;
  }
  const ajv = new Ajv({ strict: false, allErrors: true, allowUnionTypes: true, validateFormats: false });
  const validate = ajv.compile(scheme);

  assert.ok(
    validate(build),
    'yapılandırma şemaya uymuyor: ' + JSON.stringify((validate.errors || []).slice(0, 4))
  );

  /* Doğrulayıcının gerçekten doğruladığını da göster: geçen ama hiçbir şeyi
     denetlemeyen bir denetim, denetim değildir. */
  const broken = JSON.parse(JSON.stringify(build));
  broken.linux.desktop = { Categories: 'AudioVideo;' };
  assert.ok(!validate(broken), 'şema doğrulayıcı bilinen bozuk değeri kabul etti');
});

test('.deb bakımcı adresi tanımlı', () => {
  /* electron-builder .deb üretirken bunu ŞART koşuyor ve yokluğunda derlemeyi
     durduruyor. Windows ve macOS derlemesi bundan etkilenmediği için, alan
     kaldırılırsa yalnız Linux sessizce kırılırdı. */
  const m = (build.deb && build.deb.maintainer) || '';
  const email = (pkg.author && pkg.author.email) || '';
  assert.ok(/@/.test(m) || /@/.test(email), 'ne deb.maintainer ne author.email var');
});

/* Ses yardımcısı asar'ın DIŞINDA çalışıyor: onu uygulamanın kendi ikilisi
   node kipinde başlatıyor ve harici bir süreç asar arşivinin içini okuyamıyor.
   Bu yüzden yardımcının require ettiği her yerel dosya asarUnpack'te olmak
   zorunda.
 
   Bu gerçekten yaşandı: uygulama başına ses yakalama eklendiğinde yardımcı
   iki yeni modül require etti, ikisi de asar içinde kaldı ve PAKETLENMİŞ
   derlemede yardımcı sessizce çöktü. Geliştirmede her şey çalışıyordu; tek
   belirti paketlenmiş öz testte "frames received from helper = 0" satırıydı. */
test('ses yardımcısının bağımlılıkları asar dışına çıkarılıyor', () => {
  const unpack = build.asarUnpack || [];
  const covered = (rel) => unpack.some((pat) => {
    const p = String(pat);
    if (p === rel) return true;
    const star = p.indexOf('/**');
    return star > 0 && rel.startsWith(p.slice(0, star + 1));
  });

  const seen = new Set();
  const eksik = [];
  (function walk(rel) {
    if (seen.has(rel)) return;
    seen.add(rel);
    if (!covered(rel)) eksik.push(rel);
    let src;
    try { src = read(rel); } catch { return; }
    const re = /require\(\s*'(\.[^']+)'\s*\)/g;
    let m;
    while ((m = re.exec(src))) {
      let next = path.posix.normalize(path.posix.join(path.posix.dirname(rel), m[1]));
      if (!/\.js$/.test(next)) next += '.js';
      if (fs.existsSync(path.join(root, next))) walk(next);
    }
  })('src/main/loopback-helper.js');

  assert.deepStrictEqual(eksik, [],
    'asarUnpack dışında kalan yardımcı bağımlılığı: ' + eksik.join(', '));
});

test('package description lists Linux alongside Windows and macOS', () => {
  /* Discovery/store text used to say Windows+macOS only while dist:linux
     targets existed — Linux users (and the box smoke report) treated that
     as the app not supporting the platform. */
  assert.match(pkg.description, /Windows/i);
  assert.match(pkg.description, /macOS/i);
  assert.match(pkg.description, /Linux/i);
});

/* Kurulu sürümde görev çubuğu ikonunun arkasında gri zemin vardı (dış
   görüş, 10.10). Kurulum bir paket kimliği kaydediyor; görev çubuğu o
   zaman paketin Square44x44Logo'sunu kullanıyor ve zeminsiz
   (altform-unplated) sürümü resources.pri ile buluyor. Kimliğin dış konumu
   kurulum klasörü; .pri dosyaları oraya kopyalanmıyordu. Pencere ikonu
   (build/icon.ico) da pakete girmiyordu: kurulu sürümde `icon` boş
   kalıyordu, `npm start` ile dolu. */
test('kimliğin .pri dosyaları kurulum köküne, pencere ikonu pakete giriyor', () => {
  const extra = build.win.extraFiles || [];
  const pri = extra.find((e) => e.from === 'build/identity/package');
  assert.ok(pri, 'build/identity/package extraFiles içinde değil');
  assert.strictEqual(pri.to, '.');
  assert.deepStrictEqual(pri.filter, ['resources*.pri']);
  assert.ok(build.files.indexOf('build/icon.ico') >= 0, 'build/icon.ico files listesinde değil');
  assert.match(read('src/main/main.js'), /path\.join\(__dirname, '\.\.', '\.\.', 'build', 'icon\.ico'\)/);
  // Kimliğin logosu kurulum klasörüne göre çözülüyor: png'ler resources/identity'de
  assert.match(read('scripts/prepare-identity.js'), /Square44x44Logo="resources\\\\identity\\\\Square44x44Logo\.png"/);
  assert.match(JSON.stringify(build.win.extraResources), /"to":"identity"/);
  // Eski sürümün önbellekteki ikonu kurulumda tazelenir
  assert.match(read('scripts/installer.nsh'), /ie4uinit\.exe" -show/);
});

/* Paket yalnız çalışma anında yüklenen node_modules'u taşır (#777). Kurulum
   araçları (cmake-js, prebuild-install, tar, axios, ffmpeg indiricisi…) eskiden
   app.asar'a giriyordu: ~120 paket, bir kısmı bilinen açıklarla, hiç
   çağrılmadan. Kaynak yeni bir modül isterse buradaki liste de büyümeli. */
const RUNTIME_MODULES = ['audify', 'bindings', 'file-uri-to-path', 'ffmpeg-static', '@napolab'];
const DEV_ONLY = ['sharp']; // yalnız README görüntüleri (SHOTS), try/catch içinde

function srcFiles(dir, out = []) {
  for (const e of fs.readdirSync(path.join(root, dir), { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) srcFiles(p, out);
    else if (e.name.endsWith('.js')) out.push(p);
  }
  return out;
}

test('paket node_modules olarak yalnız çalışma anı modüllerini alıyor', () => {
  const files = build.files;
  assert.ok(files.includes('!node_modules/**/*'), 'önce bütün node_modules dışarıda');
  RUNTIME_MODULES.forEach((m) => assert.ok(files.includes('node_modules/' + m + '/**/*'), m));
  // Kaynağın istediği her üçüncü taraf modül listede
  const builtin = new Set(require('module').builtinModules);
  const used = new Set();
  srcFiles('src').forEach((f) => {
    const re = /require\(\s*['"]([^'"./][^'"]*)['"]\s*\)/g;
    let m;
    const s = read(f);
    while ((m = re.exec(s))) {
      const name = m[1].replace(/^node:/, '');
      const top = name.startsWith('@') ? name.split('/')[0] : name.split('/')[0];
      if (!builtin.has(name) && !builtin.has(top) && top !== 'electron') used.add(top);
    }
  });
  const missing = [...used].filter((m) => !RUNTIME_MODULES.includes(m) && !DEV_ONLY.includes(m));
  assert.deepStrictEqual(missing, [], 'pakete girmeyen modül isteniyor');
  /* Çalışma anı modüllerinin kendi bağımlılıkları da listede. test.yml
     bağımlılık kurmuyor; tam kurulumla koşan build.yml denetimi bunu da ölçer. */
  ['audify', 'bindings'].forEach((m) => {
    const pj = path.join(root, 'node_modules', m, 'package.json');
    if (!fs.existsSync(pj)) return;
    const main = read(path.join('node_modules', m, require(pj).main || 'index.js'));
    (main.match(/require\(['"]([^'"./][^'"]*)['"]\)/g) || []).map((r) => /['"](.+)['"]/.exec(r)[1])
      .filter((n) => !builtin.has(n))
      .forEach((n) => assert.ok(RUNTIME_MODULES.includes(n), m + ' → ' + n));
  });
  // audify'ın kaynakları çıkıyor, bağlanan kütüphanelerin lisansları kalıyor
  assert.ok(files.includes('!node_modules/audify/{src,vendor}/**/*'));
  assert.ok(files.some((f) => /audify\/vendor\/opus\/\{COPYING/.test(f)));
  assert.ok(files.includes('node_modules/audify/vendor/rtaudio/LICENSE'));
});

test('npm 12: ikili indiren kurulum betiklerine izin var; paketleme ikililer eksikse duruyor', () => {
  /* npm 12 bağımlılık kurulum betiklerini allowScripts dışında sessizce
     atlıyor; ffmpeg-static ikilisi inmiyor, paket ffmpeg'siz çıkıyordu. */
  assert.strictEqual(pkg.allowScripts['ffmpeg-static'], true);
  assert.strictEqual(pkg.allowScripts.audify, true);
  const after = require('../scripts/after-pack.js');
  const list = (p) => after.requiredFiles(p).map((f) => f.split(path.sep).join('/'));
  assert.ok(list('win32').includes('app.asar.unpacked/node_modules/ffmpeg-static/ffmpeg.exe'));
  assert.ok(list('win32').includes('app.asar.unpacked/node_modules/audify/build/Release/audify.node'));
  assert.ok(list('linux').includes('app.asar.unpacked/node_modules/ffmpeg-static/ffmpeg'));
  assert.ok(list('darwin').includes('app.asar.unpacked/node_modules/ffmpeg-static/ffmpeg'));
  assert.match(read('scripts/after-pack.js'), /checkRuntimeFiles\(context\);\s*\n\s*if \(context\.electronPlatformName !== 'win32'\) return;/);
});
