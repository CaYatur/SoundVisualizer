'use strict';
/* Her kaynak dosyası ayrıştırılabiliyor mu?
 *
 * Tarayıcı tarafındaki dosyalar <script> etiketiyle yükleniyor: bir sözdizimi
 * hatası çalışma anında, üstelik çoğu zaman SESSİZCE ortaya çıkıyor — dosya
 * yüklenmiyor, eksik bir global kalıyor ve bunun tek izi konsolda tek bir
 * satır oluyor.
 *
 * Bu tam olarak yaşandı: i18n.js içine kaçırılmamış bir kesme işareti girdi
 * ("display's"), dosya tarayıcıda ayrıştırılamadı ve ARAYÜZÜN TAMAMI
 * çevrilmemiş kaldı. Öz test 698 çevrilmemiş metin bildirdi; sebep 698 eksik
 * çeviri değil, tek bir karakterdi.
 *
 * CI'da aynı denetim vardı ama yerelde yoktu, yani hata ancak bir CI turu
 * sonra görülüyordu. Saniyeler süren bir denetimin orada beklemesi için
 * sebep yok.
 */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');

function walk(dir, out) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, out);
    else if (e.name.endsWith('.js')) out.push(p);
  }
  return out;
}

test('src, tests ve scripts altındaki her .js ayrıştırılıyor', () => {
  const files = [];
  for (const d of ['src', 'tests', 'scripts']) walk(path.join(root, d), files);
  assert.ok(files.length > 40, 'beklenenden az dosya tarandı: ' + files.length);

  const bad = [];
  for (const f of files) {
    try {
      // eslint-disable-next-line no-new-func
      new Function(fs.readFileSync(f, 'utf8'));
    } catch (err) {
      bad.push(path.relative(root, f) + ' → ' + err.message);
    }
  }
  assert.deepStrictEqual(bad, [], 'ayrıştırılamayan dosya(lar):\n  ' + bad.join('\n  '));
});

test('çeviri sözlüğü küçülmedi', () => {
  /* i18n.js tarayıcıya özgü (localStorage ve document ister), o yüzden
     burada çalıştırılamıyor. Ama sözlüğün BOYUTU denetlenebilir: hatalı bir
     düzenleme tabloyu kırpsa arayüzün büyük kısmı sessizce çevrilmemiş
     kalırdı ve bunu ancak öz test görürdü. */
  const src = fs.readFileSync(path.join(root, 'src', 'shared', 'i18n.js'), 'utf8');
  const entries = (src.match(/^    '/gm) || []).length;
  assert.ok(entries > 900, 'çeviri girdisi beklenenden az: ' + entries);
});
