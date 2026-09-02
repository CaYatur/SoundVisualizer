'use strict';
/* Şarkı sözü zamanlaması testleri.
 *
 * Zamanlama tam olarak ölçülebilir bir şey: 12.34 saniyede hangi satır
 * görünmeli, hangi kelimeye kadar vurgu gelmeli. "Yaklaşık doğru" burada
 * işe yaramaz — yarım saniyelik kayma bile karaokede görünür.
 *
 * Ayrıştırıcının hoşgörüsü de test ediliyor: gerçek dosyalarda BOM, CRLF,
 * eksik milisaniye ve bozuk satır bulunur; katı bir ayrıştırıcı kullanıcının
 * elindeki dosyaların çoğunu reddederdi. */
const test = require('node:test');
const assert = require('node:assert');
const L = require('../src/shared/lyrics.js');

const close = (a, b, msg, eps) =>
  assert.ok(Math.abs(a - b) <= (eps || 1e-6), `${msg}: ${a} ≠ ${b}`);

// ===========================================================================
// LRC
// ===========================================================================
const LRC = [
  '[ti:Deneme Parçası]',
  '[ar:CAYADEV]',
  '[00:01.50]İlk satır',
  '[00:05.00]İkinci satır',
  '[00:09.25]Üçüncü satır',
].join('\n');

test('LRC: üst bilgi ve satırlar okunur', () => {
  const d = L.parseLRC(LRC);
  assert.strictEqual(d.format, 'lrc');
  assert.strictEqual(d.meta.ti, 'Deneme Parçası');
  assert.strictEqual(d.meta.ar, 'CAYADEV');
  assert.strictEqual(d.lines.length, 3);
  close(d.lines[0].start, 1.5, 'ilk satır başlangıcı');
  close(d.lines[1].start, 5, 'ikinci satır');
  close(d.lines[2].start, 9.25, 'üçüncü satır');
  assert.strictEqual(d.lines[0].text, 'İlk satır');
});

test('LRC: satır bir sonraki başlayana kadar sürer', () => {
  const d = L.parseLRC(LRC);
  close(d.lines[0].end, 5, 'ilk satır bitişi');
  close(d.lines[1].end, 9.25, 'ikinci satır bitişi');
  // Son satırın bitişi yok; makul bir süre verilmeli
  assert.ok(d.lines[2].end > d.lines[2].start, 'son satır süresi');
});

test('LRC: farklı zaman biçimleri', () => {
  const d = L.parseLRC([
    '[00:03]saniye',        // milisaniyesiz
    '[00:04.5]tek hane',    // tek haneli kesir
    '[00:05.250]üç hane',   // üç haneli
    '[00:06:75]iki nokta',  // ayırıcı olarak :
  ].join('\n'));
  assert.strictEqual(d.lines.length, 4);
  close(d.lines[0].start, 3, 'mm:ss');
  close(d.lines[1].start, 4.5, 'tek hane kesir');
  close(d.lines[2].start, 5.25, 'üç hane kesir');
  close(d.lines[3].start, 6.75, 'iki nokta ayırıcı');
});

test('LRC: aynı satırda birden çok zaman etiketi', () => {
  const d = L.parseLRC('[00:10.00][00:30.00][01:00.00]nakarat');
  assert.strictEqual(d.lines.length, 3);
  assert.ok(d.lines.every((l) => l.text === 'nakarat'));
  close(d.lines[2].start, 60, 'dakika hesabı');
});

test('LRC: gelişmiş biçimde kelime zamanları', () => {
  const d = L.parseLRC('[00:02.00]<00:02.00>Bu <00:02.50>bir <00:03.10>deneme');
  const line = d.lines[0];
  assert.strictEqual(line.text, 'Bu bir deneme');
  assert.strictEqual(line.words.length, 3);
  close(line.words[0].t, 2, 'kelime 1');
  close(line.words[1].t, 2.5, 'kelime 2');
  close(line.words[2].t, 3.1, 'kelime 3');
});

test('LRC: offset İŞARETİ TERS uygulanır', () => {
  /* LRC belirtiminde pozitif offset sözü ERKENE alır. Ters uygulamak,
     senkronu iki katı bozar; bu yüzden ayrı test edilir. */
  const d = L.parseLRC('[offset:+500]\n[00:10.00]satır');
  close(d.lines[0].start, 9.5, 'pozitif offset erkene almalı');
  const d2 = L.parseLRC('[offset:-500]\n[00:10.00]satır');
  close(d2.lines[0].start, 10.5, 'negatif offset geciktirmeli');
});

test('LRC: BOM, CRLF ve boş satırlar sorun çıkarmaz', () => {
  const d = L.parseLRC('﻿[00:01.00]bir\r\n\r\n[00:02.00]iki\r\n');
  assert.strictEqual(d.lines.length, 2);
  assert.strictEqual(d.lines[0].text, 'bir');
});

test('LRC: sıralanmamış dosya sıraya konur', () => {
  const d = L.parseLRC('[00:09.00]üç\n[00:01.00]bir\n[00:05.00]iki');
  assert.deepStrictEqual(d.lines.map((l) => l.text), ['bir', 'iki', 'üç']);
  close(d.lines[0].end, 5, 'sıralama sonrası bitiş');
});

// ===========================================================================
// SRT
// ===========================================================================
const SRT = [
  '1',
  '00:00:01,000 --> 00:00:04,000',
  'İlk altyazı',
  '',
  '2',
  '00:00:06,500 --> 00:00:09,000',
  'İkinci altyazı',
  'ikinci satırı',
  '',
].join('\n');

test('SRT: zaman aralıkları ve çok satırlı metin', () => {
  const d = L.parseSRT(SRT);
  assert.strictEqual(d.format, 'srt');
  assert.strictEqual(d.lines.length, 2);
  close(d.lines[0].start, 1, 'başlangıç');
  close(d.lines[0].end, 4, 'bitiş');
  close(d.lines[1].start, 6.5, 'ikinci başlangıç');
  assert.strictEqual(d.lines[1].text, 'İkinci altyazı ikinci satırı');
});

test('SRT: nokta ayırıcı ve sıra numarasız bloklar', () => {
  const d = L.parseSRT('00:00:02.250 --> 00:00:03.500\nmetin');
  assert.strictEqual(d.lines.length, 1);
  close(d.lines[0].start, 2.25, 'nokta ayırıcı');
});

test('SRT: biçimlendirme etiketleri temizlenir', () => {
  const d = L.parseSRT('1\n00:00:01,000 --> 00:00:02,000\n<i>eğik</i> {\\an8}metin');
  assert.strictEqual(d.lines[0].text, 'eğik metin');
});

test('SRT: SRT aralarında BOŞLUK bırakabilir', () => {
  // LRC'den farklı olarak SRT'de bitiş açıktır; 5. saniyede söz olmamalı
  const d = L.parseSRT(SRT);
  assert.strictEqual(L.at(d, 5).index, -1, '5. saniyede söz olmamalı');
  assert.strictEqual(L.at(d, 2).index, 0, '2. saniyede ilk satır');
});

// ===========================================================================
// Biçim tanıma
// ===========================================================================
test('biçim İÇERİKTEN anlaşılır, uzantıdan değil', () => {
  assert.strictEqual(L.parse(SRT).format, 'srt');
  assert.strictEqual(L.parse(LRC).format, 'lrc');
  assert.strictEqual(L.parse('sadece\ndüz\nmetin').format, 'plain');
});

test('düz metin de zamanlanır', () => {
  const d = L.parse('bir\niki\nüç');
  assert.strictEqual(d.lines.length, 3);
  assert.ok(d.lines[1].start > d.lines[0].start, 'sıralı zaman verilmedi');
});

// ===========================================================================
// Arama
// ===========================================================================
test('at(): doğru satırı ve ilerlemeyi verir', () => {
  const d = L.parseLRC(LRC);
  assert.strictEqual(L.at(d, 0).index, -1, 'ilk satırdan önce');
  assert.strictEqual(L.at(d, 1.5).index, 0, 'tam başlangıçta');
  assert.strictEqual(L.at(d, 3).index, 0, 'satır ortasında');
  assert.strictEqual(L.at(d, 5).index, 1, 'sonraki satırın başında');
  assert.strictEqual(L.at(d, 100).index, -1, 'dosyanın sonundan sonra');
  // İlerleme: 1.5 ile 5 arasında, 3.25 tam ortası
  close(L.at(d, 3.25).progress, 0.5, 'ilerleme', 1e-6);
});

test('at(): karaoke kelime dizini', () => {
  const d = L.parseLRC('[00:02.00]<00:02.00>Bu <00:02.50>bir <00:03.10>deneme\n[00:06.00]son');
  assert.strictEqual(L.at(d, 2.0).wordIndex, 0, 'ilk kelime');
  assert.strictEqual(L.at(d, 2.7).wordIndex, 1, 'ikinci kelime');
  assert.strictEqual(L.at(d, 3.5).wordIndex, 2, 'üçüncü kelime');
});

test('at(): dengeli arama büyük dosyada da doğru', () => {
  // 2000 satırlık dosya: ikili arama doğrusal taramayla aynı sonucu vermeli
  const src = [];
  for (let i = 0; i < 2000; i++) src.push('[' + String(Math.floor(i / 60)).padStart(2, '0') + ':' + String(i % 60).padStart(2, '0') + '.00]satır ' + i);
  const d = L.parseLRC(src.join('\n'));
  for (const t of [0.5, 10.2, 999.9, 1500.4, 1999.5]) {
    const found = L.at(d, t);
    let expect = -1;
    for (let i = 0; i < d.lines.length; i++) if (d.lines[i].start <= t) expect = i;
    if (expect >= 0 && t > d.lines[expect].end) expect = -1;
    assert.strictEqual(found.index, expect, 't=' + t);
  }
});

test('at(): offset argümanı zamanı kaydırır', () => {
  const d = L.parseLRC(LRC);
  assert.strictEqual(L.at(d, 0.5, 1.5).index, 0, 'offset ile erken açılmalı');
  assert.strictEqual(L.at(d, 1.5, -1.5).index, -1, 'offset ile gecikmeli');
});

test('at(): boş belge çökmez', () => {
  assert.strictEqual(L.at(null, 1).index, -1);
  assert.strictEqual(L.at({ lines: [] }, 1).index, -1);
});

// ===========================================================================
// Kaydırma ve geri yazma
// ===========================================================================
test('shift() tüm zamanlamayı kaydırır', () => {
  const d = L.parseLRC('[00:02.00]<00:02.00>bir <00:02.50>iki');
  L.shift(d, 1);
  close(d.lines[0].start, 3, 'satır');
  close(d.lines[0].words[0].t, 3, 'kelime');
  close(d.lines[0].words[1].t, 3.5, 'kelime 2');
});

test('toLRC() geri yazar ve yeniden okunabilir', () => {
  const d = L.parseLRC(LRC);
  const out = L.toLRC(d);
  const again = L.parseLRC(out);
  assert.strictEqual(again.lines.length, d.lines.length);
  for (let i = 0; i < d.lines.length; i++) {
    close(again.lines[i].start, d.lines[i].start, 'satır ' + i, 0.02);
    assert.strictEqual(again.lines[i].text, d.lines[i].text);
  }
});

// ===========================================================================
// Dayanıklılık
// ===========================================================================
test('bozuk ve boş girdide çökmez', () => {
  for (const bad of ['', null, undefined, '[[[', '00:00 -->', '\x00\x01', '[99:99.99]x']) {
    assert.doesNotThrow(() => {
      const d = L.parse(bad);
      L.at(d, 5);
      L.toLRC(d);
    }, 'girdi: ' + String(bad));
  }
});

test('zamanlar her zaman sonlu', () => {
  const d = L.parse('[00:01.00]a\n[bozuk]b\n[00:03.00]c');
  for (const l of d.lines) {
    assert.ok(isFinite(l.start) && isFinite(l.end), 'sonsuz zaman: ' + JSON.stringify(l));
    assert.ok(l.end >= l.start, 'bitiş başlangıçtan önce');
  }
});
