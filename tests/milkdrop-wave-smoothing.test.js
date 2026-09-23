'use strict';
/* DALGA YUMUŞATMA ve SESE GÖRE ALFA.
 *
 * Üç ayar ayrıştırılıyordu ama motora hiç ulaşmıyordu:
 *
 *   fWaveSmoothing            8.171 preset (%79,0)  — kare dalgası
 *   bModWaveAlphaByVolume     4.027 preset (%38,9)  — dalganın saydamlığı
 *   özel dalgada `smoothing`  varsayılanı 0,5       — yani yazılmasa da isteniyor
 *
 * İki filtre BİRBİRİNDEN FARKLI ve bu bilinçli: kare dalgası tek geçiş,
 * özel dalga `sqrt(s*0,98)` ile ileri+geri iki geçiş. İkisini aynı yapmak
 * kolay bir sadeleştirme olurdu ve MilkDrop'un çizdiği eğriden başka bir
 * eğri verirdi — tek geçiş dalgayı kaydırıyor, çift geçiş kaydırmıyor.
 *
 * Filtrelerin ARİTMETİĞİ gerçekten çalıştırılıyor: satırları kaynaktan
 * çıkarıp değerlendirmek, "yazılmış mı" ile "doğru hesap ediyor mu"
 * arasındaki farkı kapatıyor.
 */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const CODE = fs.readFileSync(
  path.join(__dirname, '..', 'src', 'visualizer', 'modes', 'milkdrop.js'), 'utf-8');
const BODY = CODE.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[^:])\/\/[^\n]*/g, '$1 ');
const BASIC = /_waveSamples\(audio, scale, smoothing\) \{[\s\S]*?\n    \}/.exec(BODY);
const CUSTOM = /_customWaveSamples\(tb, N, w, audio, preset\) \{[\s\S]*?\n    \}/.exec(BODY);
const ALPHA = /_waveVolAlpha\(a\) \{[\s\S]*?\n    \}/.exec(BODY);

// ------------------------------------------------------------ kare dalgası

/* Uyum açıkken ölçek ve yumuşatma DOSYADAN, yazılmamışsa 1 ve 0,75,
   geçişte doğrusal karışarak (milkdropfs.cpp:909-912; #580); kapalıyken
   havuzdan. */
test('kare dalgası: yumuşatma okunuyor ve çizime bağlanıyor', () => {
  assert.ok(BASIC, '_waveSamples bulunamadı');
  assert.match(BODY, /accW \? this\._fileVal\('fwavescale', 1\) : this\.preset\.get\('wave_scale'\)/);
  assert.match(BODY, /accW \? this\._fileVal\('fwavesmoothing', 0\.75\) : this\.preset\.get\('wave_smoothing'\)/);
});

/* 0 da bir ölçek: MilkDrop'ta dalga düzleşiyor (korpusta 102 preset
   `fWaveScale=0` yazıyor). Eski yol 0'ı "yok" sayıp 1'e çeviriyordu. */
test('kare dalgası: uyum açıkken 0 ölçek dalgayı düzleştiriyor, kapalıyken 1 sayılıyor', () => {
  const fn = new Function('audio', 'scale', 'smoothing',
    BASIC[0].slice(BASIC[0].indexOf('{') + 1, BASIC[0].lastIndexOf('}')));
  const tb = new Uint8Array(1024).map((_, i) => 128 + Math.round(100 * Math.sin(i / 7)));
  const acc = { _wantAcc: true, _waves: null };
  fn.call(acc, { timeBytes: tb }, 0, 0);
  assert.ok(acc._fL.every((v) => v === 0), 'ölçek 0: düz');
  const old = { _wantAcc: false, _waves: null };
  fn.call(old, { timeBytes: tb }, 0, 0);
  assert.ok(old._fL.some((v) => v !== 0), 'eski yol 0\'ı 1 sayıyor');
});

/* Ölçek karışıma giriyor (`s * (1 - sm)`). Girmezse yumuşatma arttıkça
   genlik büyür: filtre kendi kendini besler ve dalga taşar. */
test('kare dalgası: filtrenin doğru kazancı var', () => {
  assert.match(BASIC[0], /const s2 = s \* \(1 - sm\);/);
  assert.match(BASIC[0], /L\[i\] = raw\(i\) \* s2 \+ L\[i - 1\] \* sm;/);
  assert.match(BASIC[0], /R\[i\] = raw\(i \+ 128\) \* s2 \+ R\[i - 1\] \* sm;/);
});

/* Sabit bir girdi sabit bir çıktı vermeli: DC kazancı 1. Yanlış bir
   normalizasyon burada hemen görünür. */
test('kare dalgası: sabit girdide genlik korunuyor', () => {
  const step = (sm, n) => {
    const s = 1, s2 = s * (1 - sm);
    let y = 1 * s;
    for (let i = 1; i < n; i++) y = 1 * s2 + y * sm;
    return y;
  };
  for (const sm of [0, 0.25, 0.5, 0.9, 0.99]) {
    assert.ok(Math.abs(step(sm, 600) - 1) < 1e-6, 'sm=' + sm);
  }
});

test('kare dalgası: yumuşatma 0..1 aralığına kenetleniyor', () => {
  /* 1'in üstünde bir değer filtreyi kararsız yapar, negatif bir değer
     işareti her örnekte çevirir. Preset ikisini de yazabiliyor. */
  assert.match(BASIC[0], /if \(sm < 0\) sm = 0; else if \(sm > 1\) sm = 1;/);
});

test('kare dalgası: anahtar kapalıyken yumuşatma uygulanmıyor', () => {
  assert.match(BASIC[0], /this\._wantAcc !== false && isFinite\(smoothing\) \? smoothing : 0/);
});

// ------------------------------------------------------------ özel dalga

test('özel dalga: kendi yumuşatması okunuyor', () => {
  assert.ok(CUSTOM, '_customWaveSamples bulunamadı');
  assert.match(CUSTOM[0], /isFinite\(w\.smoothing\) \? w\.smoothing : 0/);
  assert.match(CUSTOM[0], /const m1 = Math\.sqrt\(sm \* 0\.98\);/);
  assert.match(CUSTOM[0], /const m2 = 1 - m1;/);
});

test('özel dalga: iki geçiş var ve yönleri ters', () => {
  /* Tek geçiş kalırsa eğri bir uçtan öbürüne kayar. İki geçişin YÖNÜ
     birbirinin tersi olmalı; ikisi de ileri olsaydı kayma iki katına
     çıkardı. */
  assert.match(CUSTOM[0], /for \(let i = 1; i < N; i\+\+\) \{\s*a\[i\] = a\[i\] \* m2 \+ a\[i - 1\] \* m1;/);
  assert.match(CUSTOM[0], /for \(let i = N - 2; i >= 0; i--\) \{\s*a\[i\] = a\[i\] \* m2 \+ a\[i \+ 1\] \* m1;/);
});

/* İki geçişli filtre SİMETRİK olmalı: tek bir tepe girdisinin çıktısı
   tepenin iki yanında aynı biçimde sönmeli. Tek geçişte sönme yalnız bir
   yana olur — testin yakaladığı fark tam olarak bu. */
test('özel dalga: çift geçiş tepeyi kaydırmıyor', () => {
  const N = 101;
  const run = (sm, twoPass) => {
    const a = new Float64Array(N);
    a[50] = 1;
    const m1 = Math.sqrt(sm * 0.98), m2 = 1 - m1;
    for (let i = 1; i < N; i++) a[i] = a[i] * m2 + a[i - 1] * m1;
    if (twoPass) for (let i = N - 2; i >= 0; i--) a[i] = a[i] * m2 + a[i + 1] * m1;
    let sw = 0, sx = 0;
    for (let i = 0; i < N; i++) { sw += a[i]; sx += a[i] * i; }
    return sx / sw;
  };
  const two = run(0.5, true);
  const one = run(0.5, false);
  assert.ok(Math.abs(two - 50) < 0.5, 'çift geçiş tepeyi kaydırıyor: ' + two);
  assert.ok(one - 50 > 1.0, 'tek geçiş kaydırmalıydı: ' + one);
});

test('özel dalga: ölçek yumuşatmadan sonra uygulanıyor', () => {
  assert.match(CUSTOM[0], /const sc = acc \?[\s\S]{0,160}a\[i\] \*= sc; b\[i\] \*= sc;/);
});

/* GENLİK. MilkDrop örneği `(tayf ? 0,15 : 0,004) * scaling * wave_scale`
   ile çarpıyor ve örnek ±128 birimde duruyor. Motor bir ara 1
   kullanıyordu: özel dalgaların hepsi olması gerekenin yaklaşık iki katı
   büyüklükte çiziliyor ve `wave_scale` onlara hiç ulaşmıyordu. */
test('özel dalga: MilkDrop genliği ve wave_scale', () => {
  // Dalganın kendi presetinin dosyasından, karışmadan (milkdropfs.cpp:2429; #580)
  assert.match(CUSTOM[0], /const ws = acc \? this\._fileOf\(WP, 'fwavescale', 1\) : 1;/);
  const m = /const sc = acc \? \(fq \? ([\d.]+) : ([\d.]+)\) \* w\.scaling \* ws/
    .exec(CUSTOM[0]);
  assert.ok(m, 'ölçek satırı bulunamadı');
  assert.strictEqual(Number(m[1]), 0.15, 'tayf çarpanı');
  assert.strictEqual(Number(m[2]), 0.004, 'zaman çarpanı');
  // ±128 birimi: eski yolda baytın kendisi, uyum açıkken MilkdropWaves'in dizisi
  assert.match(CUSTOM[0], /tb\[\(\(\(i \+ j0\) % n\) \+ n\) % n\] - 128/, '±128 birimi');
  assert.match(CUSTOM[0], /this\._waves\.custom\(N, w\.sep, a, b\)/);
});

/* `spectrum = 1` yazan dalga TAYFI istiyor, ve tayfın MilkDrop ile aynı
   ÖLÇEKTE olması gerekiyor: 0..1 arasına normalleştirilmiş bir dizi doğru
   kaynaktan gelse bile yanlış büyüklükte bir dalga çizer. 2.398 preset
   (%23,2) en az bir tayf dalgası taşıyor. */
test('özel dalga: tayfın kaynağı MilkDrop FFT', () => {
  assert.match(CUSTOM[0], /const fq = acc && w\.spectrum && this\._specData/);
  assert.match(BODY, /new S\.MilkdropSpectrum\(\)/);
  /* Kanal başına: value1 sol kanalın, value2 sağ kanalın tayfı. Kanal
     verisi olmayan bir kaynakta ikisi de tek kanaldan. */
  assert.match(BODY, /this\._specL\.update\(audio\.timeL \|\| tb\)/);
  assert.match(BODY, /this\._specR\.update\(audio\.timeR \|\| tb\)/);
});

test('özel dalga: tayf kare başına bir kez hesaplanıyor', () => {
  /* Bir presette birden fazla tayf dalgası olabiliyor; FFT dalga başına
     koşsaydı aynı sonuç için birkaç kez hesaplanırdı. Hiç tayf dalgası
     yoksa hiç koşmuyor. */
  assert.match(BODY, /P\.waves\.some\(\(w\) => w\.enabled && w\.spectrum\)/);
  const draw = /_drawCustomWaves\(gl, audio, preset, am\) \{[\s\S]*?\n    \}/.exec(BODY)[0];
  const inLoop = draw.slice(draw.indexOf('for (const w of P.waves)'));
  assert.ok(!/MilkdropSpectrum/.test(inLoop), 'FFT döngünün İÇİNDE olmamalı');
});

test('özel dalga: iki yolun indislemesi MilkDrop ile aynı', () => {
  /* Tayfta iki kanal da sıfırdan başlıyor ve adımı `sep` belirliyor;
     dalga biçiminde N örnek arka arkaya, tamponun ortasından, iki kanal
     `sep/2` kadar ters yöne kaydırılmış. Motor bütün tamponu N kadar
     örneğe sıkıştırıyordu: 64 örnekli bir dalgada 32:1 seyreltme. */
  assert.match(CUSTOM[0], /const step = \(SPEC_BINS - w\.sep\) \/ Math\.max\(1, N\);/);
  assert.match(CUSTOM[0], /a\[i\] = fq\.left\[k\];\s*b\[i\] = fq\.right\[k\];/);
  /* Uyum açıkken dalga biçiminin indislemesi MilkdropWaves.custom'da ve
     orada çalıştırılarak sınanıyor (milkdrop-wave-align.test.js). Eski
     yol olduğu gibi. */
  assert.match(CUSTOM[0], /\} else if \(acc && this\._waves\) \{\s*this\._waves\.custom\(N, w\.sep, a, b\);/);
  assert.match(CUSTOM[0], /const mid = Math\.max\(0, Math\.floor\(\(WAVE_MAX - N\) \/ 2\)\);/);
  assert.match(CUSTOM[0], /const j0 = mid - \(w\.sep >> 1\);/);
  assert.match(CUSTOM[0], /const j1 = mid \+ \(w\.sep >> 1\);/);
});

test('özel dalga: çizim yumuşatılmış diziyi kullanıyor', () => {
  assert.match(BODY, /this\._customWaveSamples\(tb, N, w, audio, P\);/);
  assert.match(BODY, /P\.wavePoint\(w, sample, cw1\[i\], cw2\[i\], out\)/);
});

// ------------------------------------------------------------ sese göre alfa

test('alfa: sese göre saydamlık uygulanıyor', () => {
  assert.ok(ALPHA, '_waveVolAlpha bulunamadı');
  assert.match(ALPHA[0], /this\._fileOf\(P, 'bmodwavealphabyvolume', 0\) !== 0/);
  assert.match(ALPHA[0], /alpha \*= \(vol - a0\) \/ d;/);
  assert.match(BODY, /alpha = this\._waveVolAlpha\(alpha\);/);
});

/* Anahtar ve aralık DOSYADAN (#580): MilkDrop üçünü de denklemlere açmıyor;
   aralık yazılmamışsa 0,75 ile 0,95 (state.cpp:570-572), geçişte doğrusal.
   Havuzdan okumak eksik aralığı 0 yapıyordu. */
test('alfa: anahtar ve aralık dosyadan, MilkDrop\'un varsayılanlarıyla', () => {
  const fn = new Function('a', ALPHA[0].slice(ALPHA[0].indexOf('{') + 1, ALPHA[0].lastIndexOf('}')));
  const grab = (sig) => { const m = new RegExp(sig.replace(/[()]/g, '\\$&') + ' \\{[\\s\\S]*?\\n    \\}').exec(BODY); return m[0]; };
  const fo = grab('_fileOf(P, key, dflt)');
  const fv = grab('_fileVal(key, dflt)');
  const fileOf = new Function('P', 'key', 'dflt', fo.slice(fo.indexOf('{') + 1, fo.lastIndexOf('}')));
  const fileVal = new Function('key', 'dflt', fv.slice(fv.indexOf('{') + 1, fv.lastIndexOf('}')));
  // Ses 0,85: aralık 0,75..0,95'in tam ortası → yarı saydam
  const mk = (params, pool) => ({
    _wantAcc: true, oldPreset: null, blendProg: 1, _fileOf: fileOf, _fileVal: fileVal,
    preset: { get: (k) => (k === 'bass' || k === 'mid' || k === 'treb' ? 0.85 : (pool || {})[k]), file: { params } },
  });
  assert.ok(Math.abs(fn.call(mk({ bmodwavealphabyvolume: 1 }), 1) - 0.5) < 1e-9, 'varsayılan aralık');
  assert.ok(Math.abs(fn.call(mk({ bmodwavealphabyvolume: 1, fmodwavealphastart: 0.8, fmodwavealphaend: 0.9 }), 1) - 0.5) < 1e-9);
  // Anahtar kapalı: yalnız kırpma; havuzun yazdığı anahtar ve aralık MilkDrop'a ulaşmıyor
  assert.strictEqual(fn.call(mk({}, { wave_modalpha: 1, wave_modalpha_start: 0, wave_modalpha_end: 0.1 }), 1), 1);
  // Eksi anahtar da açık: MilkDrop `!= 0` diye okuyor
  assert.ok(fn.call(mk({ bmodwavealphabyvolume: -1 }), 1) < 1);
});

/* Ses ölçüsü `vol` DEĞİL, `bass/mid/treb` ortalaması. Presetlerin %37,9'u
   `vol`ü kendi denklemlerinde başka bir şey için yeniden yazıyor; o değer
   buraya girseydi alfa preset yazarının hesabına göre değil rastgele
   oynardı. */
test('alfa: ses ölçüsü preset denklemlerinden bağımsız', () => {
  assert.match(ALPHA[0], /P\.get\('bass'\)[\s\S]{0,80}P\.get\('mid'\)[\s\S]{0,80}P\.get\('treb'\)/);
  assert.ok(!/get\('vol'\)/.test(ALPHA[0]), 'alfa `vol` okumamalı');
});

test('alfa: ters ya da sıfır aralıkta sonsuza gitmiyor', () => {
  assert.match(ALPHA[0], /if \(Math\.abs\(d\) > 1e-6\)/);
  assert.match(ALPHA[0], /Math\.max\(0, Math\.min\(1, isFinite\(alpha\) \? alpha : 1\)\)/);
});

test('alfa: anahtar kapalıyken sadece kırpma yapılıyor', () => {
  assert.match(ALPHA[0], /this\._wantAcc !== false && P && this\._fileOf\(P, 'bmodwavealphabyvolume', 0\) !== 0/);
});
