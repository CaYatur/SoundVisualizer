/*
 * SoundVisualizer — CaYaDev Ses Görselleştirici
 * Copyright (c) 2026 Çağan Turgut (CaYatur) — CaYaDev, https://cayadev.com
 * https://github.com/CaYatur/SoundVisualizer
 * SPDX-License-Identifier: MIT
 */
'use strict';
/* PAKETLİ ÖZ TEST (#466).

   Her yayından önce elle yapılan iş: paketlenmiş uygulamayı (asar içindeki
   tek paket sayfalarla) boş, geçici bir profille `--smoke` kipinde açmak ve
   sonucunu okumak. Paketli yol kaynaktan çalışmaktan farklı: sayfalar
   `index.gen.html` paketlerinden yükleniyor, yerel modüller asar.unpacked'den,
   ffmpeg pakettekinden. Öz test PASS demeden bir paket yayına gitmemeli.

   Kullanıcının kendi ayarlarına dokunmaz: her koşu yeni bir geçici klasörde
   (`--user-data-dir`), koşu sonunda silinir. Paketli exe profilsiz
   çalıştırılmaz.

   Kullanım:
     npm run pack:dir            (önce paket)
     npm run smoke:packaged
     npm run smoke:packaged -- --exe=<yol> --keep --timeout=1200

   Çıkış kodu: öz test PASS ise 0, değilse 1, paket yoksa 2. */
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');

const ROOT = path.join(__dirname, '..');

/* Platformun paketsiz derleme klasöründeki çalıştırılabilir dosya. */
function packagedExe(root, platform, productName, linuxName) {
  const dist = path.join(root, 'dist');
  if (platform === 'win32') return path.join(dist, 'win-unpacked', productName + '.exe');
  if (platform === 'darwin') {
    for (const dir of ['mac-arm64', 'mac', 'mac-universal']) {
      const exe = path.join(dist, dir, productName + '.app', 'Contents', 'MacOS', productName);
      if (fs.existsSync(exe)) return exe;
    }
    return path.join(dist, 'mac-arm64', productName + '.app', 'Contents', 'MacOS', productName);
  }
  return path.join(dist, 'linux-unpacked', linuxName);
}

/* Paketin kaynakları arşivin içinde mi (#466): `resources/app.asar` var, açık bir
   `resources/app` klasörü yok (varsa sayfalar arşivden değil oradan yüklenir ve paket
   denetimi anlamsızlaşır). macOS'ta kaynak klasörü `.app/Contents/Resources`. */
function archiveCheck(exe, platform) {
  const res = platform === 'darwin'
    ? path.join(path.dirname(path.dirname(exe)), 'Resources')
    : path.join(path.dirname(exe), 'resources');
  const problems = [];
  if (!fs.existsSync(path.join(res, 'app.asar'))) problems.push('app.asar yok: ' + res);
  if (fs.existsSync(path.join(res, 'app'))) problems.push('açık resources/app klasörü var: sayfalar arşivden yüklenmez');
  return { res, ok: !problems.length, problems };
}

/* Öz testin çıktısından sonuç: { pass, errors: [satır], result: satır }. */
function readResult(text) {
  const lines = String(text || '').split(/\r?\n/);
  const resLine = lines.filter((l) => /\[SMOKE\] RESULT:/.test(l)).pop() || '';
  const errors = lines.filter((l) => /^\[SMOKE\]\s+!\s/.test(l)).map((l) => l.replace(/^\[SMOKE\]\s+!\s*/, ''));
  return { pass: /RESULT:\s*PASS\b/.test(resLine), result: resLine.replace(/^.*\[SMOKE\]\s*/, ''), errors };
}

function arg(name, def) {
  const a = process.argv.find((x) => x.startsWith('--' + name + '='));
  if (a) return a.slice(name.length + 3);
  return process.argv.includes('--' + name) ? true : def;
}

async function main() {
  const pkg = require(path.join(ROOT, 'package.json'));
  const productName = (pkg.build && pkg.build.productName) || pkg.productName || pkg.name;
  const exe = arg('exe', '') || packagedExe(ROOT, process.platform, productName, pkg.name);
  if (!fs.existsSync(exe)) {
    console.error('Paket yok: ' + exe + '\nÖnce: npm run pack:dir');
    process.exit(2);
  }
  const arc = archiveCheck(exe, process.platform);
  if (!arc.ok) {
    console.error('Paket arşivi denetimi başarısız:\n  ' + arc.problems.join('\n  '));
    process.exit(1);
  }
  const work = fs.mkdtempSync(path.join(os.tmpdir(), 'sv-pkg-smoke-'));
  /* v4.0.0'da öz test yaklaşık 9 dakika sürüyor; 600 sn sınırı yayın günü ilk koşuyu
     MilkDrop adımından hemen sonra kesti (takılma değil, aynı paket 1200 sn ile geçti). */
  const timeoutS = Number(arg('timeout', 1200)) || 1200;
  console.log('Paket: ' + exe);
  console.log('Geçici profil: ' + work);
  const child = spawn(exe, ['--user-data-dir=' + work, '--smoke', '--smoke-export'], { stdio: ['ignore', 'pipe', 'pipe'] });
  let out = '';
  child.stdout.on('data', (d) => { out += d; });
  child.stderr.on('data', (d) => { out += d; });
  const timer = setTimeout(() => { out += '\n[SMOKE] RESULT: FAIL (zaman aşımı ' + timeoutS + ' sn)\n'; try { child.kill(); } catch { /* bitti */ } }, timeoutS * 1000);
  const code = await new Promise((r) => child.on('close', r));
  clearTimeout(timer);
  const r = readResult(out);
  fs.writeFileSync(path.join(ROOT, 'packaged-smoke.log'), out);
  console.log(r.result || '[sonuç satırı yok]');
  for (const e of r.errors) console.log('  ! ' + e);
  console.log('Çıkış kodu ' + code + '; tam çıktı packaged-smoke.log');
  if (!arg('keep', false)) { try { fs.rmSync(work, { recursive: true, force: true }); } catch { /* süreç tutuyor */ } }
  process.exit(r.pass && code === 0 ? 0 : 1);
}

if (require.main === module) main().catch((e) => { console.error(e); process.exit(1); });

module.exports = { packagedExe, readResult, archiveCheck };
