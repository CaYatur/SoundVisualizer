'use strict';
/* Uygulama başına ses yakalama — yardımcı süreci bulur ve çalıştırır.
 *
 * Yakalamanın kendisi ayrı bir ikilide (bkz. native/app-audio-helper):
 * WASAPI'nin süreç loopback'i COM üzerinden geliyor ve Node'dan
 * çağrılamıyor. Burada yalnızca "ikili nerede, hangi süreci hedefleyeceğiz,
 * nasıl başlatacağız" var.
 *
 * Kural kısmı ayrı ve saf tutuldu (src/shared/app-audio.js) ki
 * çalıştıramadığımız platformlar da sınanabilsin.
 */

const fs = require('fs');
const path = require('path');
const os = require('os');
const { spawn, spawnSync } = require('child_process');
const appAudio = require('../shared/app-audio.js');

const EXE = 'app-audio-helper.exe';

/* Paketlenmiş uygulamada ikili resources/bin altında; geliştirmede dotnet'in
   yayımladığı klasörde. Sıra önemli: paketlenmiş yol önce gelmeli, yoksa
   geliştirme makinesinde eski bir derleme gölgeler. */
function helperPath() {
  if (process.platform !== 'win32') return null;
  const candidates = [];
  if (process.resourcesPath) candidates.push(path.join(process.resourcesPath, 'bin', EXE));
  // __dirname paketlenmişken .../resources/app.asar.unpacked/src/main
  candidates.push(path.join(__dirname, '..', '..', '..', 'bin', EXE));
  candidates.push(path.join(
    __dirname, '..', '..', 'native', 'app-audio-helper',
    'bin', 'Release', 'net8.0-windows10.0.19041.0', 'win-x64', 'publish', EXE
  ));
  for (const c of candidates) {
    try { if (c && fs.existsSync(c)) return c; } catch { /* erişilemeyen yol */ }
  }
  return null;
}

/* Özellik bu makinede kullanılabilir mi? İki ayrı sebep var ve kullanıcıya
   hangisi olduğu söylenmeli: işletim sistemi desteklemiyor mu, yoksa
   yardımcı ikili mi yok (dotnet olmadan derlenmiş bir paket). */
function availability() {
  const sup = appAudio.support(process.platform, os.release(), linuxServers());
  if (!sup.supported) return { available: false, code: sup.code, message: sup.message };
  if (process.platform !== 'win32') {
    return {
      available: false,
      code: 'NOT_IMPLEMENTED',
      message: 'Uygulama başına ses yakalama şimdilik yalnızca Windows üzerinde çalışıyor.',
    };
  }
  if (!helperPath()) {
    return {
      available: false,
      code: 'NO_HELPER',
      message: 'Ses yakalama yardımcısı bulunamadı; bu paket .NET olmadan derlenmiş olabilir.',
    };
  }
  return { available: true, code: 'OK', message: '' };
}

/* Linux'ta hangi ses sunucusu var? Karar kuralı saf modülde, tespit burada. */
function linuxServers() {
  if (process.platform !== 'linux') return {};
  const has = (cmd) => {
    try {
      return spawnSync('sh', ['-c', 'command -v ' + cmd], { encoding: 'utf-8' }).status === 0;
    } catch { return false; }
  };
  return { pipewire: has('pw-cli'), pulse: has('pactl') };
}

/* Şu anda ses oturumu olan uygulamalar. Ham süreç listesi değil: kullanıcı
   yüzlerce arka plan süreci arasından seçmemeli. */
function list() {
  const exe = helperPath();
  if (!exe) return [];
  try {
    const r = spawnSync(exe, ['--list'], {
      encoding: 'utf-8', windowsHide: true, timeout: 5000,
    });
    if (r.status !== 0 || !r.stdout) return [];
    const parsed = JSON.parse(r.stdout.trim() || '[]');
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

/* Kaydedilmiş hedefi o anki süreçler arasında bulur. Kimlik her açılışta
   değiştiği için eşleşme ADA göre yapılıyor (bkz. app-audio.resolveTarget). */
function resolve(app) {
  return appAudio.resolveTarget(app, list());
}

function spawnCapture(pid, mode) {
  const exe = helperPath();
  if (!exe || !(pid > 0)) return null;
  return spawn(exe, ['--capture', String(pid), mode === 'exclude' ? 'exclude' : 'include'], {
    windowsHide: true,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
}

module.exports = {
  helperPath, availability, list, resolve, spawn: spawnCapture, linuxServers,
};
