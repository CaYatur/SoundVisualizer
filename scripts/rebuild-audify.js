'use strict';
/* Kaynaktan `npm install` sonrası audify native ikilisini Electron ABI'sine
   göre derler. Yapılmazsa loopback-helper stdout'ta geçerli JSON üretemez
   ve Admin `INVALID_HELPER_OUTPUT` gösterir (ZIP + npm start senaryosu).

   Sürüm (.exe) paketleri bunu paketleme sırasında zaten alır; bu betik
   yalnız geliştirme kurulumuna yöneliktir. */
const { spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const cli = path.join(root, 'node_modules', '@electron', 'rebuild', 'lib', 'cli.js');

let electronPath = null;
try {
  electronPath = require('electron');
} catch {
  electronPath = null;
}

if (typeof electronPath !== 'string' || !fs.existsSync(electronPath)) {
  console.warn('[rebuild-audify] Electron henüz yok; atlanıyor.');
  process.exit(0);
}

if (!fs.existsSync(cli)) {
  console.warn('[rebuild-audify] @electron/rebuild bulunamadı; atlanıyor.');
  process.exit(0);
}

console.log('[rebuild-audify] audify → Electron native rebuild…');
const result = spawnSync(process.execPath, [cli, '-f', '-w', 'audify'], {
  cwd: root,
  stdio: 'inherit',
  windowsHide: true,
  env: process.env,
});

if (result.error) {
  console.error('[rebuild-audify] başarısız:', result.error.message);
  console.error('Elle deneyin: npm run rebuild:audio');
  process.exit(0);
}
if (result.status !== 0) {
  console.error('[rebuild-audify] çıkış kodu ' + (result.status || 1));
  console.error('Elle deneyin: npm run rebuild:audio  (Windows: Visual Studio Build Tools gerekebilir)');
  /* postinstall'ı tamamen düşürme: katkıcılar sadece UI bakabilsin.
     Ses için check:runtime / rebuild:audio yeterli sinyal. */
  process.exit(0);
}

const built = path.join(root, 'node_modules', 'audify', 'build', 'Release', 'audify.node');
if (fs.existsSync(built)) {
  console.log('[rebuild-audify] tamam: ' + built);
} else {
  console.warn('[rebuild-audify] bitti ama audify.node bulunamadı; npm run check:runtime ile doğrulayın.');
}
