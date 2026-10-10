'use strict';
/* Dış gözden geçirme raporlarında (10.10, 68ca436) bulunan hatalar (#695). */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');

function walk(dir, out) {
  for (const name of fs.readdirSync(dir)) {
    const full = path.join(dir, name);
    const st = fs.statSync(full);
    if (st.isDirectory()) walk(full, out);
    else if (/\.(js|html|css|json)$/.test(name)) out.push(full);
  }
  return out;
}

/* Studio'da ve şarkı imzasında ayırıcı düz NUL baytıydı; git ve grep
   dosyayı ikili sayıp farkı gizliyordu. */
test('kaynak dosyalarda düz NUL baytı yok', () => {
  const bad = walk(path.join(ROOT, 'src'), []).filter((f) => fs.readFileSync(f).includes(0));
  assert.deepStrictEqual(bad.map((f) => path.relative(ROOT, f)), []);
});
