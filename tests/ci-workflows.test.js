'use strict';
/* CI iş akışları en az yetkiyle çalışır (#777). Hiçbiri depoya yazmıyor ya
   da sürüm açmıyor; kurulum dosyaları Actions artefaktı olarak yükleniyor.
   Yeni bir iş akışı izin bildirmezse deponun varsayılan (yazabilen) jetonunu
   alır — bu test onu yakalar. */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const dir = path.join(__dirname, '..', '.github', 'workflows');
const files = fs.readdirSync(dir).filter((f) => /\.ya?ml$/.test(f));

test('her iş akışı üst düzeyde yalnız okuma izni bildiriyor', () => {
  assert.ok(files.length >= 3, 'iş akışları: ' + files.join(', '));
  files.forEach((f) => {
    const s = fs.readFileSync(path.join(dir, f), 'utf8').replace(/\r\n/g, '\n');
    const top = /^permissions:\s*\n((?:[ \t]+.*\n)+)/m.exec(s);
    assert.ok(top, f + ': üst düzey permissions yok');
    assert.match(top[1], /^\s+contents:\s*read\s*$/m, f);
    assert.doesNotMatch(s, /:\s*write\b/, f + ': yazma izni');
    assert.doesNotMatch(s, /write-all/, f);
  });
});
