'use strict';
/* macOS'ta uygulama başına ses yakalama — kaynak denetimleri (#517).
 *
 * Swift yardımcısı bizde çalıştırılamıyor; yalnız CI'daki macOS koşucusu
 * onu derliyor ve gerçek bir Mac'te hiç denenmedi. Burada derlenmeden
 * görülebilen sözleşme korunuyor: ana sürecin beklediği biçim, izin
 * penceresinin kendiliğinden açılmaması, paketleme ve CI adımı. */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(root, p), 'utf8');
const SWIFT = read('native/app-audio-helper-mac/AppAudioHelper.swift');
const pkg = JSON.parse(read('package.json'));

test('yardımcı gerçek donanımda doğrulanmadığını söylüyor', () => {
  assert.match(SWIFT, /GERÇEK DONANIMDA DOĞRULANMADI/);
  assert.match(SWIFT, /DOĞRULANACAKLAR/);
});

/* Windows yardımcısıyla aynı sözleşme: ana süreç farkı görmüyor. */
test('Windows yardımcısıyla aynı kipler ve biçim', () => {
  for (const flag of ['--list', '--check', '--request', '--capture']) {
    assert.ok(SWIFT.includes('"' + flag + '"'), 'kip yok: ' + flag);
  }
  assert.match(SWIFT, /let SAMPLE_RATE = 48000/);
  assert.match(SWIFT, /let CHANNELS = 2/);
  assert.match(SWIFT, /cfg\.capturesAudio = true/);
  assert.match(SWIFT, /cfg\.excludesCurrentProcessAudio = true/);
  assert.match(SWIFT, /cfg\.sampleRate = SAMPLE_RATE/);
  assert.match(SWIFT, /cfg\.channelCount = CHANNELS/);
  assert.match(SWIFT, /APP-CAPTURE-START/);
  // Dahil etme ve hariç tutma ayrı filtrelerle
  assert.match(SWIFT, /SCContentFilter\(display: display, including: \[target\]/);
  assert.match(SWIFT, /SCContentFilter\(display: display, excludingApplications:/);
});

/* Liste her açılışta isteniyor. İzin yokken SCShareableContent çağrılsaydı
   özelliği hiç kullanmayan herkese Ekran Kaydı sorulurdu. */
test('liste izin yokken sistem penceresi açmıyor', () => {
  const body = SWIFT.slice(SWIFT.indexOf('func listApps()'), SWIFT.indexOf('// MARK: - yakalama'));
  const pre = body.indexOf('CGPreflightScreenCaptureAccess()');
  const sc = body.indexOf('SCShareableContent.');
  assert.ok(pre > 0 && sc > pre, 'izin denetimi SCShareableContent çağrısından önce olmalı');
  assert.ok(!/CGRequestScreenCaptureAccess/.test(body), 'liste izin istememeli');
});

test('izin reddi ayrı bir koddan çıkıyor', () => {
  assert.match(SWIFT, /PERMISSION-DENIED/);
  assert.match(SWIFT, /userDeclined/);
});

test('boru kapanınca ve hedef kapanınca çıkıyor', () => {
  assert.match(SWIFT, /signal\(SIGPIPE, SIG_IGN\)/);
  assert.match(SWIFT, /TARGET-EXITED/);
});

test('mac paketi yardımcıyı resources/bin altına koyuyor', () => {
  const res = JSON.stringify(pkg.build.mac.extraResources || []);
  assert.match(res, /native\/app-audio-helper-mac\/build\/app-audio-helper/);
  assert.match(res, /"bin\/app-audio-helper"/);
  assert.match(pkg.scripts['dist:mac:arm64'], /prepare-app-audio-mac\.js/);
});

/* Ana süreç yardımcıyı geliştirmede derleme betiğinin çıktısında arıyor. */
test('ana süreç derleme çıktısının yolunu biliyor', () => {
  const cap = read('src/main/app-capture.js');
  assert.match(cap, /'native', 'app-audio-helper-mac', 'build', EXE/);
  const prep = read('scripts/prepare-app-audio-mac.js');
  assert.match(prep, /path\.join\(dir, 'build'\)/);
  assert.match(prep, /'app-audio-helper'\)/);
  assert.match(prep, /apple-macos13\.0/);
});

/* build.yml yalnız etiket ve elle tetiklemede koşuyor; derleme hatası
   ancak yayın günü görülürdü. Derleme ayrı bir iş akışında ve yalnız
   yardımcı ya da betiği değişince koşuyor: her PR'da macOS dakikası
   harcanmasın. */
test('CI yardımcıyı her değişiklikte derliyor', () => {
  const t = read('.github/workflows/mac-helper.yml');
  assert.match(t, /runs-on: macos-latest/);
  assert.match(t, /prepare-app-audio-mac\.js --strict/);
  for (const p of ["'native/app-audio-helper-mac/**'", "'scripts/prepare-app-audio-mac.js'"]) {
    assert.strictEqual(t.split(p).length - 1, 2, p + ' hem push hem PR süzgecinde');
  }
  assert.doesNotMatch(read('.github/workflows/test.yml'), /macos-latest/, 'birim iş akışı macOS koşmuyor');
  const b = read('.github/workflows/build.yml');
  assert.match(b, /prepare-app-audio-mac\.js --strict/);
});

test('izin isteme köprüsü panele bağlı', () => {
  assert.match(read('src/main/preload-admin.js'), /requestAppAudioPermission: \(\) => ipcRenderer\.invoke\('app-audio:request-permission'\)/);
  assert.match(read('src/main/main.js'), /ipcMain\.handle\('app-audio:request-permission'/);
  assert.match(read('src/admin/admin.js'), /status\.canRequest/);
});
