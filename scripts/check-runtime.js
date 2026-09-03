'use strict';
/* Ses yardımcısı BU platformda gerçekten koşuyor mu?
 *
 * Tek soru şu: uygulamanın kendi ikilisi node kipinde çalışıyor mu ve
 * audify'ın native ikilisi orada yükleniyor mu? Ne GPU ne ses aygıtı
 * gerekir — CI'ın cevaplayabileceği, macOS ve Linux için de cevaplaması
 * ŞART olan soru budur. GPU öz testi (npm run smoke) yerel bir kapı olarak
 * kalır; yazılım rasterleştirici orada yanlış sonuç verir.
 *
 * Aygıt listesinin BOŞ olması sorun değil: CI makinesinde ses kartı
 * olmayabilir. Sorun, sürecin hiç başlamaması ya da JSON üretememesidir.
 */
const { spawnSync } = require('child_process');
const path = require('path');
const fs = require('fs');

const root = path.join(__dirname, '..');
const helper = path.join(root, 'src', 'main', 'loopback-helper.js');
const electron = require('electron'); // ikilinin yolunu verir

if (typeof electron !== 'string' || !fs.existsSync(electron)) {
  console.error('Electron ikilisi bulunamadı: ' + electron);
  process.exit(1);
}

console.log('platform : ' + process.platform + '-' + process.arch);
console.log('electron : ' + electron);

const res = spawnSync(electron, [helper, '--list'], {
  cwd: root,
  encoding: 'utf-8',
  timeout: 60000,
  env: Object.assign({}, process.env, { ELECTRON_RUN_AS_NODE: '1' }),
});

if (res.error) {
  console.error('Süreç başlatılamadı: ' + res.error.message);
  process.exit(1);
}
if (res.status !== 0) {
  console.error('Yardımcı ' + res.status + ' koduyla çıktı');
  console.error((res.stderr || '').slice(0, 2000));
  process.exit(1);
}

let devices;
try {
  devices = JSON.parse(res.stdout);
} catch (e) {
  console.error('Yardımcı geçerli JSON üretmedi: ' + e.message);
  console.error('stdout: ' + (res.stdout || '').slice(0, 500));
  console.error('stderr: ' + (res.stderr || '').slice(0, 2000));
  process.exit(1);
}
if (!Array.isArray(devices)) {
  console.error('Yardımcı dizi döndürmedi');
  process.exit(1);
}

/* stderr'de native yükleme arızası var mı? Süreç 0 ile çıkmış olabilir
   ama audify yüklenememişse liste boş gelir ve sebebi burada yazar. */
const err = (res.stderr || '').trim();
if (/Cannot find module|dlopen|\.dylib|\.so[.\d]*:|GLIBC/i.test(err)) {
  console.error('Native ses motoru yüklenemedi:');
  console.error(err.slice(0, 2000));
  process.exit(1);
}

const loopback = devices.filter((d) => d.loopback);
console.log('aygıt    : ' + devices.length + ' (sistem sesi verebilen: ' + loopback.length + ')');
devices.slice(0, 8).forEach((d) => {
  console.log('           ' + (d.loopback ? '*' : ' ') + ' ' + d.kind.padEnd(6) + ' ' + d.name);
});
if (err) console.log('stderr   : ' + err.slice(0, 400));

/* Ne doğrulandı, ne doğrulanmadı — AÇIKÇA söyle.
   Sıfır aygıt bir arıza değildir: koşucuda ses kartı olmayabilir. Ama o
   durumda aygıt sayımı da SINANMAMIŞ olur ve buna "her şey yolunda" demek
   yanıltıcıdır. Denetimin geçmesi tek bir şeyi kanıtlar: native ses motoru
   bu platformda yükleniyor ve uygulamanın kendi ikilisi node kipinde
   çalışıyor. Paket üretmek için gereken de budur. */
const backendFailed = /LIST-FAIL/.test(err);
console.log('');
console.log('doğrulandı      : native ses motoru yükleniyor · uygulama ikilisi node kipinde koşuyor');
if (backendFailed) {
  console.log('DOĞRULANMADI    : ses arka ucu bu makinede oluşturulamadı (ses sunucusu yok)');
  console.log('                  aygıt sayımı ve yakalama sınanmadı');
} else if (!devices.length) {
  console.log('DOĞRULANMADI    : aygıt bulunamadı — bu makinede ses donanımı yok');
  console.log('                  aygıt sayımı ve yakalama sınanmadı');
} else if (!loopback.length) {
  console.log('not             : sistem sesini veren aygıt yok. macOS için bu BEKLENEN');
  console.log('                  durumdur (sanal aygıt gerekir); diğer platformlarda değildir');
}
console.log('SONUÇ: ses çalışma zamanı bu platformda ayakta');
