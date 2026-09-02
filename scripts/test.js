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

const args = ['--test'].concat(process.argv.slice(2)).concat(files);
const child = spawn(process.execPath, args, { stdio: 'inherit', cwd: root });
child.on('exit', (code, signal) => {
  if (signal) process.kill(process.pid, signal);
  else process.exit(code == null ? 1 : code);
});
