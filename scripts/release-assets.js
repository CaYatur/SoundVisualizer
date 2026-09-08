'use strict';
/* Kurulum dosyalarını sürüme YÜKLER ve her birine açıklama etiketini yazar.
 *
 * Neden bir betik: GitHub'ın varlık listesinde dosya adının yanında görünen
 * "(Windows — installer)" gibi açıklamalar `gh release upload dosya#etiket`
 * biçimiyle veriliyor ve bunu elle yazmak gerekiyordu. v3.1.3'te tam olarak
 * bu unutuldu — altı varlık da etiketsiz yayımlandı ve kullanıcı fark etti.
 * Elle yapılan bir adım er ya da geç atlanır; tablo artık burada duruyor.
 *
 * Ayrıca EKSİK yüklemeye karşı korur: altı dosyanın hepsi bulunamazsa hiçbir
 * şey yüklemez. Yarım bir sürüm, indirme tablosunda ölü bağlantı demektir.
 *
 * Kullanım:
 *   node scripts/release-assets.js v3.1.3
 *   node scripts/release-assets.js v3.1.3 --dir=<CI çıktıları>   (mac/linux)
 *   node scripts/release-assets.js v3.1.3 --check                (yalnız denetle)
 *   node scripts/release-assets.js v3.1.3 --partial              (eksiğe izin ver)
 *
 * Windows dosyaları yerelde dist/ altında üretilir; macOS ve Linux dosyaları
 * CI'dan indirilir (gh run download), o yüzden --dir birden çok kez verilebilir.
 */
const { spawnSync } = require('child_process');
const path = require('path');
const fs = require('fs');

const root = path.join(__dirname, '..');
const version = require(path.join(root, 'package.json')).version;

/* Sürümde bulunması BEKLENEN dosyalar ve etiket açıklamaları.
   Ayırıcı uzun tire (—); v3.1.2'den beri kullanılan biçim bu ve varlık
   listesinde sürümler arası tutarlı görünmesi için aynen korunuyor. */
const ASSETS = [
  { file: 'CAYADEV-Visualizer-' + version + '-windows-setup.exe', desc: 'Windows — installer' },
  { file: 'CAYADEV-Visualizer-' + version + '-windows-portable.exe', desc: 'Windows — portable, no install' },
  { file: 'CAYADEV-Visualizer-' + version + '-macos-arm64.dmg', desc: 'macOS — Apple Silicon' },
  { file: 'CAYADEV-Visualizer-' + version + '-macos-arm64.zip', desc: 'macOS — Apple Silicon, zip' },
  { file: 'CAYADEV-Visualizer-' + version + '-linux-x86_64.AppImage', desc: 'Linux — x64, runs anywhere' },
  { file: 'CAYADEV-Visualizer-' + version + '-linux-amd64.deb', desc: 'Linux — Debian / Ubuntu' },
];

const labelOf = (a) => a.file + ' (' + a.desc + ')';

// ---------------------------------------------------------------------------

const args = process.argv.slice(2);
const tag = args.find((a) => !a.startsWith('--'));
const CHECK = args.includes('--check');
const PARTIAL = args.includes('--partial');
/* Yüklemeden önce ne yükleneceğini görmek için. Dosyalar yüzlerce megabayt;
   yanlış klasörü fark etmenin ucuz yolu bu. */
const DRY = args.includes('--dry-run');
const dirs = args.filter((a) => a.startsWith('--dir=')).map((a) => a.slice(6));

if (!tag) {
  console.error('Etiket verilmedi.\n' +
    '  node scripts/release-assets.js v' + version + ' [--dir=<klasör>] [--check] [--partial]');
  process.exit(2);
}

function gh(cmdArgs) {
  const r = spawnSync('gh', cmdArgs, { cwd: root, encoding: 'utf-8', maxBuffer: 32 * 1024 * 1024 });
  if (r.error) {
    console.error("'gh' çalıştırılamadı: " + r.error.message);
    process.exit(1);
  }
  return r;
}

/* Yayımdaki varlıkları okur: ad -> etiket. */
function published() {
  const r = gh(['api', 'repos/{owner}/{repo}/releases/tags/' + tag,
    '--jq', '.assets[] | .name + "\\t" + (.label // "")']);
  if (r.status !== 0) {
    console.error('Sürüm okunamadı (' + tag + '):\n' + (r.stderr || '').trim());
    process.exit(1);
  }
  const map = new Map();
  for (const line of r.stdout.split('\n')) {
    if (!line.trim()) continue;
    const i = line.indexOf('\t');
    map.set(line.slice(0, i), line.slice(i + 1));
  }
  return map;
}

/* Dosyayı dist/ ve --dir ile verilen klasörlerde arar (alt klasörler dahil:
   gh run download her yapıyı kendi adıyla bir alt klasöre koyuyor). */
function locate(name) {
  const roots = [path.join(root, 'dist')].concat(dirs);
  for (const base of roots) {
    if (!fs.existsSync(base)) continue;
    const direct = path.join(base, name);
    if (fs.existsSync(direct)) return direct;
    for (const entry of fs.readdirSync(base, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      const nested = path.join(base, entry.name, name);
      if (fs.existsSync(nested)) return nested;
    }
  }
  return null;
}

// --- denetim -----------------------------------------------------------------

if (CHECK) {
  const live = published();
  let bad = 0;
  for (const a of ASSETS) {
    const label = live.get(a.file);
    if (label === undefined) { console.log('EKSİK   ' + a.file); bad++; }
    else if (label !== labelOf(a)) {
      console.log('ETİKET  ' + a.file + '\n          beklenen: ' + labelOf(a) + '\n          olan    : ' + (label || '(boş)'));
      bad++;
    } else console.log('tamam   ' + a.file);
  }
  const extra = Array.from(live.keys()).filter((n) => !ASSETS.some((a) => a.file === n));
  for (const n of extra) console.log('FAZLA   ' + n);
  if (bad || extra.length) {
    console.log('\n' + tag + ': ' + bad + ' sorun, ' + extra.length + ' beklenmeyen dosya');
    process.exit(1);
  }
  console.log('\n' + tag + ': altı varlık da yerinde ve etiketli');
  process.exit(0);
}

// --- yükleme -----------------------------------------------------------------

const found = [];
const missing = [];
for (const a of ASSETS) {
  const p = locate(a.file);
  if (p) found.push({ asset: a, path: p });
  else missing.push(a.file);
}

for (const m of missing) console.log('bulunamadı  ' + m);
for (const f of found) console.log('bulundu     ' + path.relative(root, f.path));

if (missing.length && !PARTIAL) {
  console.error('\n' + missing.length + ' dosya eksik, hiçbiri yüklenmedi.\n' +
    '  Windows: npm run dist:win\n' +
    '  macOS/Linux: gh run download <run-id> -D <klasör>, sonra --dir=<klasör>\n' +
    '  Bilerek eksik yüklüyorsanız --partial ekleyin.');
  process.exit(1);
}
if (!found.length) {
  console.error('\nYüklenecek dosya yok.');
  process.exit(1);
}

const uploadArgs = ['release', 'upload', tag];
for (const f of found) uploadArgs.push(f.path + '#' + labelOf(f.asset));
uploadArgs.push('--clobber');

if (DRY) {
  console.log('\nkuru çalıştırma — ' + tag + ' için yüklenecek olan:');
  for (const f of found) {
    const mb = (fs.statSync(f.path).size / 1048576).toFixed(0);
    console.log('  ' + mb.padStart(4) + ' MB  ' + labelOf(f.asset));
    console.log('            ' + f.path);
  }
  process.exit(0);
}

console.log('\n' + found.length + ' dosya yükleniyor -> ' + tag);
const up = gh(uploadArgs);
if (up.stdout.trim()) console.log(up.stdout.trim());
if (up.status !== 0) {
  console.error('Yükleme başarısız:\n' + (up.stderr || '').trim());
  process.exit(1);
}

/* Yüklemeden sonra HEMEN denetle: --clobber etiketi sessizce düşürseydi
   bunu ancak kullanıcı fark ederdi. */
const live = published();
let bad = 0;
for (const f of found) {
  const label = live.get(f.asset.file);
  if (label !== labelOf(f.asset)) {
    console.error('etiket yazılamadı: ' + f.asset.file + ' -> ' + (label || '(boş)'));
    bad++;
  }
}
if (bad) process.exit(1);
console.log('Tamam: ' + found.length + ' dosya yüklendi, etiketleri doğrulandı.');
