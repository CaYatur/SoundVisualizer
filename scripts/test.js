'use strict';
/* Test koşucusu.
 *
 * `node --test "tests/**\/*.test.js"` yalnızca Node 22 ve üstünde çalışıyor:
 * glob desteği oraya geldi. Node 20'de aynı komut deseni dosya adı sanıp
 * "module not found" veriyor, `node --test tests/` ise Node 24'te klasörü
 * modül sanıyor. Aradaki tek taşınabilir yol dosyaları burada listeleyip
 * tek tek geçirmek.
 *
 * CI iki Node sürümünde koştuğu için bu fark gerçek bir sorun; yerelde
 * çalışan komutun CI'da kırılması tam olarak testlerin önlemesi gereken şey.
 */
const fs = require('fs');
const path = require('path');
const os = require('os');
const { spawn } = require('child_process');

const root = path.join(__dirname, '..');
const dir = path.join(root, 'tests');

function collect(d) {
  const out = [];
  for (const e of fs.readdirSync(d, { withFileTypes: true })) {
    const p = path.join(d, e.name);
    if (e.isDirectory()) out.push(...collect(p));
    else if (e.name.endsWith('.test.js')) out.push(p);
  }
  return out.sort();
}

const files = fs.existsSync(dir) ? collect(dir) : [];
if (!files.length) {
  console.error('tests/ altında test dosyası yok');
  process.exit(1);
}

/* Belgelerdeki test sayısı iddiaları.
 *
 * Bu sayı üç kez yanlış yazıldı: bir kez commit iletisinde, bir kez ROADMAP'in
 * "yayınlandı" hücresinde ve bir kez de rozetlerde. Hiçbiri testleri kırmadığı
 * için hiçbiri yakalanmadı — okuyan biri fark edene kadar yanlış duruyorlar.
 *
 * Gerçek sayıyı bilen tek yer koşunun kendisi; o yüzden denetim burada.
 * ROADMAP'in durum tablosundaki 703, v3.1.0'ın YAYINLANDIĞI andaki sayı ve
 * bilerek sabit — desenler yalnızca "şu an main'de" diyen cümleleri tutuyor. */
const CLAIMS = [
  ['README.md', /tests-(\d+)%20passing/, 'test rozeti'],
  ['README.md', /\*\*(\d+) unit tests, all passing\.\*\*/, 'Tests bölümü'],
  ['README.tr.md', /test-(\d+)%20geçiyor/, 'test rozeti'],
  ['README.tr.md', /\*\*(\d+) birim testi, hepsi geçiyor\.\*\*/, 'Testler bölümü'],
  ['ROADMAP.md', /\*\*(\d+) unit tests, all passing\*\* on `main`/, 'Verifiability'],
];

function checkClaims(total) {
  const bad = [];
  for (const [file, re, where] of CLAIMS) {
    const p = path.join(root, file);
    let text;
    try { text = fs.readFileSync(p, 'utf8'); } catch { continue; }
    const m = text.match(re);
    if (!m) bad.push(file + ' -> ' + where + ': iddia bulunamadı (desen değişmiş olabilir)');
    else if (Number(m[1]) !== total) bad.push(file + ' -> ' + where + ': ' + m[1] + ', gerçek ' + total);
  }
  if (!bad.length) return true;
  console.error('');
  console.error('Belgelerdeki test sayısı gerçekle uyuşmuyor:');
  for (const b of bad) console.error('  ' + b);
  console.error('Gerçek sayı: ' + total);
  console.error('');
  return false;
}

/* Tam koşu değilse (süzgeç verilmişse) sayı zaten eksik olur; denetlemeyiz. */
const extra = process.argv.slice(2);
const tap = extra.length ? null : path.join(os.tmpdir(), 'sv-test-' + process.pid + '.tap');

const args = ['--test'].concat(extra);
if (tap) {
  args.push('--test-reporter=' + (process.stdout.isTTY ? 'spec' : 'tap'), '--test-reporter-destination=stdout',
            '--test-reporter=tap', '--test-reporter-destination=' + tap);
}
args.push(...files);

const child = spawn(process.execPath, args, { stdio: 'inherit', cwd: root });
child.on('exit', (code, signal) => {
  if (signal) process.kill(process.pid, signal);
  let exit = code == null ? 1 : code;
  if (tap) {
    let total = null;
    try {
      const m = fs.readFileSync(tap, 'utf8').match(/^# tests (\d+)$/m);
      if (m) total = Number(m[1]);
    } catch {}
    try { fs.unlinkSync(tap); } catch {}
    /* Testler zaten kırmızıysa sayı anlamsız; üstüne ikinci bir hata basmayız. */
    if (exit === 0) {
      /* Sayı okunamadıysa denetim HİÇ çalışmamıştır. Bunu sessizce geçmek,
         korumayı olmayan bir korumaya çevirir: yeşil görünür, hiçbir şey
         bakmaz. Node sürümleri arasında çift raportör desteği değişebildiği
         için bu gerçek bir olasılık, o yüzden bağırıyor. */
      if (total === null) {
        console.error('');
        console.error('Test sayısı okunamadı; belgelerdeki iddialar DENETLENMEDİ.');
        console.error('');
        exit = 1;
      } else if (!checkClaims(total)) {
        exit = 1;
      }
    }
  }
  process.exit(exit);
});
