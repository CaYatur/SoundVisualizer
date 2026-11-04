'use strict';
/* Renk kipleri birbirine bağlı olmasın (#695).

   Yığın kapalıyken Sahne › Metin ve Şarkı Sözü ile Çalan Parça kartlarının
   "Renk Modu" görselleştiricinin kipini (visualizer.colorMode) yazıyordu.
   Yazı Barlar'ın üstünde bindirme olarak çizildiği için yazıya Gökkuşağı
   seçmek Barlar'ı da gökkuşağı yapıyordu; Barlar'ın kipini değiştirmek de
   yazının rengini değiştiriyordu. Çizici (modes/text.js, nowplaying.js)
   önce yazının kendi kipini okur; kartlar artık onu yazar. */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const read = (p) => fs.readFileSync(path.join(__dirname, '..', p), 'utf8');

function body(src, start) {
  const at = src.indexOf(start);
  assert.ok(at >= 0, start);
  let i = src.indexOf('{', at);
  let depth = 0;
  for (; i < src.length; i++) {
    if (src[i] === '{') depth++;
    else if (src[i] === '}') { depth--; if (depth === 0) return src.slice(at, i + 1); }
  }
  throw new Error('son ' + start);
}

/* Kartın setMode'unu sahte cfg ile çalıştırır. */
function runSetMode(file, own) {
  const fn = body(read(file), 'const setMode = (m) =>');
  const make = new Function(own, 'cfg', 'sync', fn + '\nreturn setMode;');
  return (ownObj, cfg) => make(ownObj, cfg, () => {});
}


test('çiziciler önce yazının kendi kipini okur', () => {
  assert.match(read('src/visualizer/modes/text.js'), /const colorMode = T\.colorMode\s*\|\| \(T\.useCustomColor \? 'custom' : null\)/);
  assert.match(read('src/visualizer/modes/nowplaying.js'), /const colorMode = c\.colorMode\s*\|\| \(c\.useCustomColor \? 'custom' : null\)/);
});

test('görselleştirici kartı metin ya da çalan parçanın kendi kipini de yazar', () => {
  const A = read('src/admin/admin.js');
  assert.match(A, /cfg\.visualizer\.type === 'nowplaying'\) \{\s*cfg\.nowplaying\.useCustomColor = \(o\.value === 'custom'\);\s*cfg\.nowplaying\.colorMode = o\.value;/);
  assert.match(A, /cfg\.visualizer\.type === 'text'\) \{\s*cfg\.text\.useCustomColor = \(o\.value === 'custom'\);\s*cfg\.text\.colorMode = o\.value;/);
});
