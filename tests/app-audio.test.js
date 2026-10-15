'use strict';
/* Uygulama başına ses yakalama kurallarının testleri.
 *
 * Bu modül üç platformun kuralını taşıyor ama yalnızca birinde
 * çalıştırılabiliyor. macOS ve Linux davranışını sınamanın tek yolu kuralı
 * saf tutup platformu dışarıdan vermek — aygıt seçiminde olduğu gibi
 * (bkz. tests/audio-devices.test.js gerekçesi).
 *
 * Asıl incelik hedef eşlemede: kaydedilen şey SÜREÇ KİMLİĞİ olamaz. Kullanıcı
 * uygulamayı kapatıp açtığında kimlik değişir; kimliğe bağlanan bir kaynak
 * sessizce boşa düşer, görselleştirici de sessiz kalır ve sebebi görünmez.
 */

const test = require('node:test');
const assert = require('node:assert');
const A = require('../src/shared/app-audio.js');

// --------------------------------------------------------- platform desteği

/* Süreç loopback API'si Windows yapı 20348 ile geldi. */
test('Windows yapı 20348 altında desteklenmiyor', () => {
  const r = A.support('win32', '10.0.19045');
  assert.strictEqual(r.supported, false);
  assert.strictEqual(r.code, 'WIN_TOO_OLD');
  assert.match(r.message, /20348/);
});

test('Windows 11 destekliyor', () => {
  assert.strictEqual(A.support('win32', '10.0.22631').supported, true);
  assert.strictEqual(A.support('win32', '10.0.28020').supported, true);
});

test('tam yapı 20348 destekleniyor', () => {
  assert.strictEqual(A.support('win32', '10.0.20348').supported, true);
});

/* Darwin çekirdek sürümü macOS sürümü değil: Darwin 22 = macOS 13. */
test('Darwin sürümünden macOS sürümü çıkarılır', () => {
  assert.strictEqual(A.macMajorFromDarwin('22.6.0'), 13);
  assert.strictEqual(A.macMajorFromDarwin('21.6.0'), 12);
  assert.strictEqual(A.macMajorFromDarwin('24.0.0'), 15);
});

test('macOS 13 altında desteklenmiyor', () => {
  const r = A.support('darwin', '21.6.0'); // macOS 12
  assert.strictEqual(r.supported, false);
  assert.strictEqual(r.code, 'MAC_TOO_OLD');
});

test('macOS 13 ve üstü destekliyor', () => {
  assert.strictEqual(A.support('darwin', '22.6.0').supported, true);
  assert.strictEqual(A.support('darwin', '24.0.0').supported, true);
});

/* Linux'ta uygulama akışlarını gösteren bir ses sunucusu şart. */
test('Linux ses sunucusu olmadan desteklenmiyor', () => {
  const r = A.support('linux', '6.1.0', {});
  assert.strictEqual(r.supported, false);
  assert.strictEqual(r.code, 'NO_SOUND_SERVER');
});

/* Yakalama pactl ve parec ile yapılıyor (bkz. app-audio-linux.js). İkisi ve
   ulaşılabilir bir sunucu varsa destekleniyor — PipeWire'da da, çünkü
   pipewire-pulse aynı arayüzü veriyor. */
test('Linux pactl, parec ve sunucuyla destekliyor', () => {
  assert.strictEqual(A.support('linux', '6.1.0', { pactl: true, parec: true, server: true }).supported, true);
  assert.strictEqual(
    A.support('linux', '6.1.0', { pactl: true, parec: true, pipewire: true, server: true }).supported, true);
  // Sunucu ölçülmediyse engellemiyoruz; asıl karar yakalama anında
  assert.strictEqual(A.support('linux', '6.1.0', { pactl: true, parec: true }).supported, true);
});

/* Eskiden PipeWire'ın varlığı "destekleniyor" demeye yetiyordu ve özellik
   Linux'ta hiç yazılmamıştı. Yakalanacak araç yokken desteklenir demek,
   sessizce hiçbir şey yapmayan bir denetim göstermek olurdu (#517). */
test('yalnız PipeWire varken araç eksikliği söylenir', () => {
  const r = A.support('linux', '6.1.0', { pipewire: true });
  assert.strictEqual(r.supported, false);
  assert.strictEqual(r.code, 'LINUX_NO_TOOLS');
  assert.strictEqual(r.missing, 'pactl, parec');
  assert.match(r.message, /pulseaudio-utils/);
});

test('eksik tek araç adıyla söylenir', () => {
  const r = A.support('linux', '6.1.0', { pactl: true, parec: false });
  assert.strictEqual(r.code, 'LINUX_NO_TOOLS');
  assert.strictEqual(r.missing, 'parec');
});

test('sunucuya ulaşılamıyorsa ayrı kod', () => {
  const r = A.support('linux', '6.1.0', { pactl: true, parec: true, server: false });
  assert.strictEqual(r.supported, false);
  assert.strictEqual(r.code, 'SOUND_SERVER_DOWN');
});

/* Ekran Kaydı izni yokken ScreenCaptureKit boş liste veriyor. Kullanıcı
   "çalan uygulama yok" sanmamalı: sebep ayrı bir kodla ve istenebilir
   olarak geliyor. */
test('macOS izin yoksa söylenir ve istenebilir', () => {
  const r = A.support('darwin', '23.0.0', { helper: true, permission: false });
  assert.strictEqual(r.supported, false);
  assert.strictEqual(r.code, 'MAC_NO_PERMISSION');
  assert.strictEqual(r.canRequest, true);
});

test('macOS yardımcı yoksa söylenir', () => {
  assert.strictEqual(A.support('darwin', '23.0.0', { helper: false }).code, 'NO_HELPER');
});

test('macOS eski sürüm izin sorusundan önce gelir', () => {
  assert.strictEqual(A.support('darwin', '21.6.0', { helper: true, permission: false }).code, 'MAC_TOO_OLD');
});

test('macOS izin ölçülemediyse engellenmez', () => {
  assert.strictEqual(A.support('darwin', '23.0.0', { helper: true }).supported, true);
  assert.strictEqual(A.support('darwin', '23.0.0', { helper: true, permission: true }).supported, true);
});

test('bilinmeyen platform desteklenmiyor', () => {
  assert.strictEqual(A.support('sunos', '5.11').code, 'UNSUPPORTED_PLATFORM');
});

test('sürüm okunamazsa desteklenmiş sayılır', () => {
  // Yapı numarası çıkmazsa engellemek yanlış olurdu; asıl karar yakalama anında
  assert.strictEqual(A.support('win32', '').supported, true);
  assert.strictEqual(A.support('darwin', '').supported, true);
});

// ------------------------------------------------------------- kaynak biçimi

test('aygıt adı ve uygulama hedefi ayırt edilir', () => {
  assert.strictEqual(A.isAppSource('default'), false);
  assert.strictEqual(A.isAppSource({ kind: 'app', match: 'a.exe' }), true);
  assert.strictEqual(A.isAppSource(null), false);
});

test('uygulama kaynağı normalleştirilir', () => {
  const a = A.normalizeApp({ kind: 'app', match: '  Spotify.exe ', mode: 'exclude', pid: 42 });
  assert.strictEqual(a.match, 'Spotify.exe');
  assert.strictEqual(a.mode, 'exclude');
  assert.strictEqual(a.pid, 42);
  assert.strictEqual(a.label, 'Spotify.exe');
});

test('geçersiz kip varsayılana düşer', () => {
  assert.strictEqual(A.normalizeApp({ kind: 'app', match: 'a.exe', mode: 'yok' }).mode, 'include');
  assert.strictEqual(A.normalizeApp({ kind: 'app', match: 'a.exe' }).mode, 'include');
});

test('eşleşme adı olmayan kaynak geçersiz', () => {
  assert.strictEqual(A.normalizeApp({ kind: 'app', match: '   ' }), null);
  assert.strictEqual(A.normalizeApp({ kind: 'app' }), null);
});

/* Eski yapılandırmalar yalnızca aygıt adı taşıyor; ikisi bir arada
   çalışmalı çünkü karışım zaten çoklu kaynak destekliyor. */
test('karışık liste aygıt ve uygulama olarak ayrılır', () => {
  const { devices, apps } = A.splitSources([
    'default',
    { kind: 'app', match: 'chrome.exe' },
    'Hoparlör (Realtek)',
    { kind: 'app', match: '' },
  ]);
  assert.deepStrictEqual(devices, ['default', 'Hoparlör (Realtek)']);
  assert.strictEqual(apps.length, 1);
  assert.strictEqual(apps[0].match, 'chrome.exe');
});

test('tek kaynak da dizi gibi işlenir', () => {
  assert.deepStrictEqual(A.splitSources('default').devices, ['default']);
  assert.deepStrictEqual(A.splitSources([]).devices, []);
});

/* Hariç tutma tek uygulamayla sınırlı: işletim sistemi arayüzü tek bir
   süreç kimliği alıyor. İki hariç-tutma akışı açsaydık her biri ötekinin
   sesini taşır, karıştırınca o ses iki kez sayılırdı. */
test('hariç tutma kipinde tek uygulama kalır', () => {
  const { apps } = A.splitSources([
    { kind: 'app', match: 'a.exe', mode: 'exclude' },
    { kind: 'app', match: 'b.exe', mode: 'exclude' },
  ]);
  assert.strictEqual(apps.length, 1);
  assert.strictEqual(apps[0].match, 'a.exe');
});

test('hariç tutma varsa dahil etmeler de düşer', () => {
  const { apps } = A.splitSources([
    { kind: 'app', match: 'a.exe', mode: 'include' },
    { kind: 'app', match: 'b.exe', mode: 'exclude' },
  ]);
  assert.strictEqual(apps.length, 1);
  assert.strictEqual(apps[0].mode, 'exclude');
});

test('dahil etme kipinde sınır yok', () => {
  const { apps } = A.splitSources([
    { kind: 'app', match: 'a.exe' },
    { kind: 'app', match: 'b.exe' },
    { kind: 'app', match: 'c.exe' },
  ]);
  assert.strictEqual(apps.length, 3);
});

// ------------------------------------------------------------- hedef eşleme

const procs = [
  { pid: 100, name: 'msedge.exe', audible: false },
  { pid: 200, name: 'msedge.exe', audible: true },
  { pid: 300, name: 'Spotify.exe', audible: true },
];

test('kaydedilmiş kimlik hâlâ aynı uygulamaya aitse kullanılır', () => {
  const r = A.resolveTarget({ kind: 'app', match: 'msedge.exe', pid: 100 }, procs);
  assert.strictEqual(r.pid, 100);
  assert.strictEqual(r.matched, 'pid');
});

/* Uygulama kapatılıp açıldığında kimlik değişiyor. Ada göre yeniden
   bulunamazsa kaynak sessizce ölürdü. */
test('kimlik değiştiyse ada göre yeniden bulunur', () => {
  const r = A.resolveTarget({ kind: 'app', match: 'msedge.exe', pid: 999 }, procs);
  assert.ok(r, 'hedef bulunamadı');
  assert.strictEqual(r.name, 'msedge.exe');
  assert.strictEqual(r.matched, 'audible');
});

/* Kimlik geri dönüştürülmüş olabilir: aynı numara başka bir uygulamada. */
test('kimlik başka bir uygulamaya aitse güvenilmez', () => {
  const r = A.resolveTarget({ kind: 'app', match: 'Spotify.exe', pid: 200 }, procs);
  assert.strictEqual(r.pid, 300);
  assert.strictEqual(r.name, 'Spotify.exe');
});

test('ses çıkaran süreç tercih edilir', () => {
  const r = A.resolveTarget({ kind: 'app', match: 'msedge.exe' }, procs);
  assert.strictEqual(r.pid, 200);
});

test('hiçbiri ses çıkarmıyorsa en eski süreç seçilir', () => {
  const sessiz = [
    { pid: 500, name: 'chrome.exe', audible: false },
    { pid: 400, name: 'chrome.exe', audible: false },
  ];
  const r = A.resolveTarget({ kind: 'app', match: 'chrome.exe' }, sessiz);
  assert.strictEqual(r.pid, 400);
  assert.strictEqual(r.matched, 'name');
});

test('uygulama çalışmıyorsa hedef bulunamaz', () => {
  assert.strictEqual(A.resolveTarget({ kind: 'app', match: 'yok.exe' }, procs), null);
  assert.strictEqual(A.resolveTarget({ kind: 'app', match: 'a.exe' }, []), null);
});

/* Linux'ta liste yalnız çalan akışlar; hariç tutulan uygulama susunca
   listeden düşüyor. Hedef bulunamadı diye hiçbir şey yakalamamak, "şu
   hariç her şey" isteğinin tam tersi olurdu. */
test('Linux hariç tutmada hedef çalmıyorsa yine de başlar', () => {
  const r = A.resolveTarget({ kind: 'app', match: 'spotify', mode: 'exclude' }, [], 'linux');
  assert.deepStrictEqual(r, { pid: 0, name: 'spotify', matched: 'absent' });
});

test('Linux dahil etmede hedef yoksa beklenir', () => {
  assert.strictEqual(A.resolveTarget({ kind: 'app', match: 'spotify', mode: 'include' }, [], 'linux'), null);
});

test('Windows hariç tutmada süreç kimliği şart', () => {
  // Windows yardımcısı hariç tutulacak süreci kimlikle istiyor
  assert.strictEqual(A.resolveTarget({ kind: 'app', match: 'a.exe', mode: 'exclude' }, [], 'win32'), null);
});

test('yol içeren ad yalnızca dosya adıyla eşleşir', () => {
  const r = A.resolveTarget({ kind: 'app', match: 'C:\\Program Files\\Spotify\\Spotify.exe' }, procs);
  assert.strictEqual(r.pid, 300);
});

test('eşleşme büyük/küçük harfe duyarsız', () => {
  assert.ok(A.resolveTarget({ kind: 'app', match: 'SPOTIFY.EXE' }, procs));
});

test('geçersiz hedef çökmez', () => {
  assert.strictEqual(A.resolveTarget(null, procs), null);
  assert.strictEqual(A.resolveTarget({ kind: 'app', match: 'a.exe' }, null), null);
});

// -------------------------------------------------------------- aday listesi

/* Tarayıcılar onlarca alt süreç açıyor; listede tek satır görünmeliler. */
test('aynı uygulamanın süreçleri tek satıra iner', () => {
  const c = A.candidates(procs);
  assert.strictEqual(c.length, 2);
  const edge = c.find((x) => x.match === 'msedge.exe');
  assert.strictEqual(edge.count, 2);
});

test('ses çıkaran uygulamalar listenin başında', () => {
  const c = A.candidates([
    { pid: 1, name: 'zzz.exe', audible: false },
    { pid: 2, name: 'aaa.exe', audible: true },
  ]);
  assert.strictEqual(c[0].match, 'aaa.exe');
});

test('ses çıkaran süreç grubu temsil eder', () => {
  const c = A.candidates(procs);
  const edge = c.find((x) => x.match === 'msedge.exe');
  assert.strictEqual(edge.pid, 200);
  assert.strictEqual(edge.audible, true);
});

test('bozuk giriş çökmez', () => {
  assert.deepStrictEqual(A.candidates(null), []);
  assert.deepStrictEqual(A.candidates([null, {}, { pid: 1 }]), []);
});

// ------------------------------------------------------ yapılandırma turu

/* Uygulama hedefi ayar dosyasında bir NESNE olarak duruyor, aygıt adları ise
   metin. Aynı dizide taşınıyorlar; birleştirme ya da JSON turu bunlardan
   birini bozarsa kullanıcı seçimini sessizce kaybeder. */
test('uygulama kaynağı ayar dosyası turundan sağ çıkar', () => {
  global.window = global.window || {};
  require('../src/shared/defaults.js');
  const SV = global.window.SV;

  const kaydedilmis = {
    audio: {
      sources: ['default', { kind: 'app', match: 'Spotify.exe', mode: 'include', label: 'Spotify' }],
    },
  };
  const merged = SV.deepMerge(SV.defaultConfig(), kaydedilmis);
  const turlanmis = JSON.parse(JSON.stringify(merged.audio.sources));

  const { devices, apps } = A.splitSources(turlanmis);
  assert.deepStrictEqual(devices, ['default']);
  assert.strictEqual(apps.length, 1);
  assert.strictEqual(apps[0].match, 'Spotify.exe');
  assert.strictEqual(apps[0].label, 'Spotify');
});

/* Varsayılan yapılandırma yalnızca aygıt taşıyor; uygulama yakalama
   eklendiğinde eski dosyaların bozulmadığı burada sabitleniyor. */
test('varsayılan kaynak listesi hâlâ aygıt', () => {
  global.window = global.window || {};
  require('../src/shared/defaults.js');
  const SV = global.window.SV;
  const { devices, apps } = A.splitSources(SV.defaultConfig().audio.sources);
  assert.deepStrictEqual(devices, ['default']);
  assert.strictEqual(apps.length, 0);
});

/* Set ortasında aygıt değişimi.

   Kaynak seçicisinin göründüğünden çok durumu var ve bunlardan biri canlı
   gösteride gerçekten oluyor: seçili çıkış aygıtı kayboluyor (kablo çıkıyor,
   arayüz uykuya dalıyor, Windows varsayılanı değiştiriyor). Uygulama
   kaynağının bundan ETKİLENMEMESİ gerekir — o aygıta değil sürece bağlı. */
test('aygıt kaybolunca uygulama kaynağı ayakta kalır', () => {
  const sources = ['Kaybolan Arayüz', { kind: 'app', match: 'spotify.exe', mode: 'include' }];
  const before = A.splitSources(sources);
  assert.deepStrictEqual(before.devices, ['Kaybolan Arayüz']);
  assert.strictEqual(before.apps.length, 1);

  /* Aygıt listeden düştü; kaynak listesi aynı kaldı. Uygulama hedefi hâlâ
     çözülebilmeli, çünkü aygıtla ilgisi yok. */
  const after = A.splitSources(sources.filter((s) => typeof s !== 'string'));
  assert.deepStrictEqual(after.devices, []);
  assert.strictEqual(after.apps.length, 1);
  assert.strictEqual(after.apps[0].match, 'spotify.exe');

  const target = A.resolveTarget(after.apps[0], [
    { pid: 900, name: 'spotify.exe', audible: true },
  ]);
  assert.strictEqual(target.pid, 900, 'aygıt değişimi uygulama hedefini düşürdü');
});

test('aygıt değişiminde yeni varsayılan seçilebiliyor', () => {
  /* Seçicinin öteki yarısı: aygıt gidince yerine geçecek olanı bulmak.
     İkisi birlikte "set ortasında aygıt değişti" durumunu kapatıyor. */
  const devices = require('../src/shared/audio-devices.js');
  const before = devices.pickDefault(
    [{ name: 'Kaybolan Arayüz', isDefault: true }, { name: 'Hoparlör' }], 'win32'
  );
  assert.ok(before, 'başlangıçta aygıt seçilemedi');

  const after = devices.pickDefault([{ name: 'Hoparlör' }], 'win32');
  assert.ok(after, 'aygıt kaybolunca yerine geçecek bulunamadı');
  assert.notStrictEqual(after.name, 'Kaybolan Arayüz');
});

// ------------------------------------------------------ İngilizce iletiler

/* Durum iletisi ana süreçten Türkçe geliyor ve panelde sözlükten geçiyor.
   Her kodun iletisinin İngilizcesi olmalı; yoksa İngilizce arayüzde Türkçe
   bir hata satırı görünür. */
test('her durum iletisinin İngilizcesi var', () => {
  const fs = require('fs');
  const path = require('path');
  const vm = require('vm');
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
  const src = fs.readFileSync(path.join(__dirname, '..', 'src', 'shared', 'i18n.js'), 'utf8');
  vm.runInContext(src, vm.createContext(win), { filename: 'i18n.js' });
  const t = win.SVI18n.t;
  const TR = /[çğıöşüÇĞİÖŞÜ]/;

  const cases = [
    A.support('win32', '10.0.19045'),
    A.support('darwin', '21.6.0'),
    A.support('darwin', '23.0.0', { helper: false }),
    A.support('darwin', '23.0.0', { helper: true, permission: false }),
    A.support('linux', '6.1.0', {}),
    A.support('linux', '6.1.0', { pipewire: true }),
    A.support('linux', '6.1.0', { pactl: true }),
    A.support('linux', '6.1.0', { pactl: true, parec: true, server: false }),
    A.support('sunos', '5.11'),
  ];
  for (const c of cases) {
    const en = t(c.message);
    assert.notStrictEqual(en, c.message, 'çevrilmedi: ' + c.message);
    assert.ok(!TR.test(en), 'çeviride Türkçe harf: ' + en);
  }
  assert.strictEqual(t(A.support('linux', '6.1.0', { pactl: true }).message),
    'Per-application audio capture needs parec; install the pulseaudio-utils package.');
  assert.strictEqual(t('Ekran Kaydı İzni İste'), 'Request Screen Recording Permission');
});
