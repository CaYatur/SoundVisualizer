'use strict';
/* BAŞLIK PARAMETRESİ → DENKLEM DEĞİŞKENİ eşlemesi.
 *
 * `.milk` dosyasındaki ad ile denklem dilindeki ad çoğu yerde AYNI değil:
 * dosya `fZoomExponent` yazar, denklemler `zoomexp` okur. Eşleme satırı
 * yoksa değer havuza yalnız dosya adıyla girer, motor onu hiç bulamaz ve
 * kendi varsayılanına düşer. Hata görünmez: derleme geçer, kare çizilir,
 * yalnızca YANLIŞ çizilir.
 *
 * Bu dosya eşlemeyi tek tek sabitliyor, çünkü kaybolan bir satır ancak
 * ekrana bakarak fark edilebiliyordu. Sayılar 10.347 presetlik korpustan.
 */
global.window = global.window || {};
const test = require('node:test');
const assert = require('node:assert');
const MD = require('../src/shared/milkdrop.js');

const P = (src) => new MD.Preset(src, { seed: 1 });

/* 3.826 preset (%37,0) varsayılandan farklı bir üs yazıyor ve bunların
   çoğu denklemlerinde `zoomexp`e hiç dokunmuyor — yani değer yalnızca
   başlıktan gelebilir. Ulaşmadığında motor 1 kullanıyordu: zum merkezden
   kenara doğru hiç değişmiyor, presetin tüneli düz bir yakınlaştırmaya
   iniyordu. */
test('zoomexp: fZoomExponent başlıktan geliyor', () => {
  assert.strictEqual(P('fZoomExponent=2.500\n').get('zoomexp'), 2.5);
});

test('zoomexp: denklem başlığın üstüne yazabiliyor', () => {
  const p = P('fZoomExponent=2.500\nper_frame_1=zoomexp = 0.5;\n');
  p.frame({});
  assert.strictEqual(p.get('zoomexp'), 0.5);
});

/* wave_mystery motor tarafından ZATEN okunuyordu; eksik olan tek şey
   dosyadaki değerin ona bağlanmasıydı. 1/2/3/5. dalga biçimlerinde bu
   sayı biçimin kendisini değiştiriyor. 3.484 preset (%33,7) sıfırdan
   farklı yazıyor. */
test('wave_mystery: fWaveParam başlıktan geliyor', () => {
  assert.strictEqual(P('fWaveParam=-0.400\n').get('wave_mystery'), -0.4);
});

/* Negatif ve sıfır GEÇERLİ değerler. `|| varsayılan` biçiminde bir yedek
   sıfırı "belirtilmemiş" sanıp eziyordu; aynı hata renk kanalında bir kez
   yapıldı ve sarı presetler beyaz çıktı. */
test('eşleme: sıfır değer korunuyor, varsayılana düşmüyor', () => {
  assert.strictEqual(P('fWaveParam=0.000\n').get('wave_mystery'), 0);
  assert.strictEqual(P('fZoomExponent=0.000\n').get('zoomexp'), 0);
});

/* Eşleme tablosunun tamamı tek testte: bir satırın silinmesi ya da
   yanlış hedefe bağlanması burada görünür. */
test('eşleme: bilinen tüm başlık adları hedefine ulaşıyor', () => {
  const cases = [
    ['fDecay=0.910', 'decay', 0.91],
    ['bTexWrap=0', 'wrap', 0],
    ['fGammaAdj=1.700', 'gamma', 1.7],
    ['fVideoEchoAlpha=0.250', 'echo_alpha', 0.25],
    ['fVideoEchoZoom=1.040', 'echo_zoom', 1.04],
    ['nVideoEchoOrientation=2', 'echo_orient', 2],
    ['bDarkenCenter=1', 'darken_center', 1],
    ['bBrighten=1', 'brighten', 1],
    ['bDarken=1', 'darken', 1],
    ['bSolarize=1', 'solarize', 1],
    ['bInvert=1', 'invert', 1],
    ['fWarpAnimSpeed=1.300', 'warpanimspeed', 1.3],
    ['fWarpScale=0.700', 'warpscale', 0.7],
    ['fZoomExponent=2.500', 'zoomexp', 2.5],
    ['nWaveMode=6', 'wave_mode', 6],
    ['bWaveDots=1', 'wave_usedots', 1],
    ['bWaveThick=1', 'wave_thick', 1],
    ['bAdditiveWaves=1', 'wave_additive', 1],
    ['bMaximizeWaveColor=1', 'wave_brighten', 1],
    ['fWaveAlpha=0.600', 'wave_a', 0.6],
    ['fWaveScale=1.900', 'wave_scale', 1.9],
    ['fWaveSmoothing=0.750', 'wave_smoothing', 0.75],
    ['fWaveParam=-0.400', 'wave_mystery', -0.4],
    ['bModWaveAlphaByVolume=1', 'wave_modalpha', 1],
    ['fModWaveAlphaStart=0.750', 'wave_modalpha_start', 0.75],
    ['fModWaveAlphaEnd=0.950', 'wave_modalpha_end', 0.95],
    ['nMotionVectorsX=24', 'mv_x', 24],
    ['nMotionVectorsY=18', 'mv_y', 18],
  ];
  for (const [line, name, want] of cases) {
    assert.strictEqual(P(line + '\n').get(name), want, line + ' -> ' + name);
  }
});
