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

test('Linux PipeWire ya da PulseAudio ile destekliyor', () => {
  assert.strictEqual(A.support('linux', '6.1.0', { pipewire: true }).supported, true);
  assert.strictEqual(A.support('linux', '6.1.0', { pulse: true }).supported, true);
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
