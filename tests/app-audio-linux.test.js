'use strict';
/* Linux'ta uygulama başına ses yakalama — saf kuralların testleri (#514).
 *
 * Fikstürler GERÇEK çıktı: WSLg'de (PulseAudio 17.0, pactl 16.1) iki ayrı
 * süreç ton çalarken alınan `pactl list sink-inputs` ve
 * `pactl -f json list sink-inputs`. Makine kimliği, kullanıcı ve bilgisayar
 * adı değiştirildi; geri kalanı olduğu gibi.
 *
 * Fikstürdeki tuzak bilerek bırakıldı: paplay, pacat'e bağlantı olduğu için
 * kendini "application.process.binary = pacat" diye bildiriyor. Eşleşme adı
 * uygulamanın verdiği isim değil, çalıştırılabilir dosyanın adı.
 */

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const L = require('../src/shared/app-audio-linux.js');

const fx = (n) => fs.readFileSync(path.join(__dirname, 'fixtures', n), 'utf8');
const TEXT = fx('pactl-sink-inputs.txt');
const JSONOUT = fx('pactl-sink-inputs.json');

// ------------------------------------------------------------ ayrıştırma

test('metin çıktısı iki akışı ayrıştırır', () => {
  const s = L.parseSinkInputsText(TEXT);
  assert.strictEqual(s.length, 2);
  assert.deepStrictEqual(s.map((x) => x.index), [0, 1]);
  assert.strictEqual(s[0].pid, 553);
  assert.strictEqual(s[0].binary, 'pacat');
  assert.strictEqual(s[0].appName, 'toneA');
  assert.strictEqual(s[0].mediaName, '/home/user/sv-test/a440.wav');
  assert.strictEqual(s[0].corked, false);
  assert.strictEqual(s[0].mute, false);
  assert.strictEqual(s[0].sink, 1);
  assert.strictEqual(s[0].driver, 'protocol-native.c');
  assert.strictEqual(s[1].binary, 'othertone');
  assert.strictEqual(s[1].pid, 555);
});

/* pactl 16 ile gelen JSON ve eski metin aynı şeyi anlatmalı; hangisinin
   geldiği sürüme bağlı (Ubuntu 22.04'te JSON yok). */
test('JSON ve metin aynı sonucu verir', () => {
  const j = L.parseSinkInputsJson(JSONOUT);
  const t = L.parseSinkInputsText(TEXT);
  assert.deepStrictEqual(j, t);
});

test('biçim kendiliğinden seçilir', () => {
  assert.deepStrictEqual(L.parseSinkInputs(JSONOUT), L.parseSinkInputsText(TEXT));
  assert.deepStrictEqual(L.parseSinkInputs(TEXT), L.parseSinkInputsText(TEXT));
  assert.deepStrictEqual(L.parseSinkInputs(''), []);
  assert.deepStrictEqual(L.parseSinkInputs('[]'), []);
});

test('bozuk JSON metne düşer, çökmez', () => {
  assert.strictEqual(L.parseSinkInputsJson('{bozuk'), null);
  assert.strictEqual(L.parseSinkInputsJson('{"a":1}'), null);
  assert.deepStrictEqual(L.parseSinkInputs('[bozuk'), []);
  assert.deepStrictEqual(L.parseSinkInputsText(null), []);
});

test('Windows satır sonuyla da ayrıştırılır', () => {
  const crlf = TEXT.replace(/\r?\n/g, '\r\n');
  assert.deepStrictEqual(L.parseSinkInputsText(crlf), L.parseSinkInputsText(TEXT));
});

test('duraklatılmış ve sessize alınmış akış ayırt edilir', () => {
  const t = TEXT
    .replace(/(Sink Input #0[\s\S]*?)Corked: no/, '$1Corked: yes')
    .replace(/(Sink Input #1[\s\S]*?)Mute: no/, '$1Mute: yes');
  const s = L.parseSinkInputsText(t);
  assert.strictEqual(s[0].corked, true);
  assert.strictEqual(s[1].mute, true);
  const p = L.toProcesses(s);
  assert.strictEqual(p[0].audible, false);
  assert.strictEqual(p[1].audible, false);
});

test('özellik değerindeki kaçışlı tırnak çözülür', () => {
  const t = 'Sink Input #7\n\tDriver: x\n\tProperties:\n\t\tapplication.name = "Bir \\"Şarkı\\""\n'
    + '\t\tapplication.process.binary = "mpv"\n';
  const s = L.parseSinkInputsText(t);
  assert.strictEqual(s[0].appName, 'Bir "Şarkı"');
  assert.strictEqual(s[0].binary, 'mpv');
});

// ------------------------------------------------------------ süreç listesi

test('liste Windows yardımcısıyla aynı biçimde', () => {
  const p = L.toProcesses(L.parseSinkInputs(JSONOUT));
  assert.deepStrictEqual(p, [
    { pid: 553, name: 'pacat', label: 'toneA', audible: true },
    { pid: 555, name: 'othertone', label: 'othertone', audible: true },
  ]);
});

/* İki sekmede çalan tarayıcı iki akış açar ama tek süreçtir; arayüzdeki
   "N süreç" sayısı akışları saymamalı. */
test('aynı sürecin akışları tek satır', () => {
  const s = [
    { index: 1, pid: 10, binary: 'firefox', appName: 'Firefox', corked: true, mute: false },
    { index: 2, pid: 10, binary: 'firefox', appName: 'Firefox', corked: false, mute: false },
    { index: 3, pid: 11, binary: 'firefox', appName: 'Firefox', corked: true, mute: false },
  ];
  const p = L.toProcesses(s);
  assert.strictEqual(p.length, 2);
  assert.strictEqual(p[0].audible, true, 'çalan akış süreci sesli saymalı');
});

test('adı olmayan akış listeye girmez', () => {
  const p = L.toProcesses([{ index: 4, pid: 0, binary: '', appName: '' }]);
  assert.deepStrictEqual(p, []);
});

test('ikili adı yoksa uygulama adı kullanılır', () => {
  const p = L.toProcesses([{ index: 4, pid: 0, binary: '', appName: 'Loopback' }]);
  assert.strictEqual(p[0].name, 'Loopback');
});

// ------------------------------------------------------------ hedef seçme

const STREAMS = L.parseSinkInputs(JSONOUT);

test('dahil etme yalnız hedefin akışını seçer', () => {
  assert.deepStrictEqual(L.selectStreams(STREAMS, { pid: 553, match: 'pacat' }, 'include'), [0]);
});

test('hariç tutma hedef DIŞINDAKİLERİ seçer', () => {
  assert.deepStrictEqual(L.selectStreams(STREAMS, { pid: 553, match: 'pacat' }, 'exclude'), [1]);
});

/* Uygulama kapanıp açılınca kimlik değişir; ad aynı kalır. */
test('kimlik değişse de ada göre bulunur', () => {
  assert.deepStrictEqual(L.selectStreams(STREAMS, { pid: 99999, match: 'othertone' }, 'include'), [1]);
});

/* Eşleşme uygulamanın kendine verdiği ad değil, çalıştırılabilir dosya. */
test('uygulama adıyla değil ikili adıyla eşleşir', () => {
  assert.deepStrictEqual(L.selectStreams(STREAMS, { match: 'toneA' }, 'include'), []);
});

test('ad verilmemişse kimlikle eşleşir', () => {
  assert.deepStrictEqual(L.selectStreams(STREAMS, { pid: 555 }, 'include'), [1]);
});

test('bir uygulamanın bütün akışları seçilir', () => {
  const s = [
    { index: 5, pid: 20, binary: 'chrome' },
    { index: 6, pid: 21, binary: 'chrome' },
    { index: 7, pid: 22, binary: 'spotify' },
  ];
  assert.deepStrictEqual(L.selectStreams(s, { match: 'chrome' }, 'include'), [5, 6]);
  assert.deepStrictEqual(L.selectStreams(s, { match: 'chrome' }, 'exclude'), [7]);
});

test('hedef akış yoksa dahil etme boş, hariç tutma hepsi', () => {
  assert.deepStrictEqual(L.selectStreams(STREAMS, { match: 'spotify' }, 'include'), []);
  assert.deepStrictEqual(L.selectStreams(STREAMS, { match: 'spotify' }, 'exclude'), [0, 1]);
});

test('eşleşme büyük/küçük harfe duyarsız ve yolu yok sayar', () => {
  assert.deepStrictEqual(L.selectStreams(STREAMS, { match: '/usr/bin/PACAT' }, 'include'), [0]);
});

// ------------------------------------------------------------ komut satırı

test('parec Windows yardımcısıyla aynı biçimi istiyor', () => {
  const a = L.parecArgs(12);
  assert.ok(a.includes('--monitor-stream=12'));
  assert.ok(a.includes('--format=float32le'));
  assert.ok(a.includes('--rate=48000'));
  assert.ok(a.includes('--channels=2'));
  assert.ok(a.includes('--raw'));
  assert.strictEqual(L.SAMPLE_RATE, 48000);
  assert.strictEqual(L.BYTES_PER_FRAME, 8);
});

test('dizin sayıya çevrilir (kabuk enjeksiyonu yok)', () => {
  assert.ok(L.parecArgs('3; rm -rf ~').includes('--monitor-stream=NaN'));
});

/* Ayrıştırıcı yalnız C yerelini tanıyor; pactl Türkçe sistemde başlıkları
   çeviriyor. */
test('pactl C yereliyle çağrılıyor', () => {
  assert.strictEqual(L.C_LOCALE_ENV.LC_ALL, 'C');
});

test('pactl subscribe satırı ayrıştırılır', () => {
  assert.deepStrictEqual(L.parseSubscribeLine("Event 'new' on sink-input #12"),
    { event: 'new', facility: 'sink-input', index: 12 });
  assert.deepStrictEqual(L.parseSubscribeLine("Event 'remove' on source-output #3\n"),
    { event: 'remove', facility: 'source-output', index: 3 });
  assert.strictEqual(L.parseSubscribeLine('çöp'), null);
});

// -------------------------------------------------------------- karıştırma

function pcm(frames, l, r) {
  const b = Buffer.alloc(frames * 8);
  for (let i = 0; i < frames; i++) { b.writeFloatLE(l, i * 8); b.writeFloatLE(r, i * 8 + 4); }
  return b;
}
const at = (buf, frame, ch) => buf.readFloatLE(frame * 8 + ch * 4);

test('akış yokken sessizlik akar', () => {
  const m = new L.PcmMixer();
  const out = m.pull(480);
  assert.strictEqual(out.length, 480 * 8);
  assert.ok(out.every((x) => x === 0));
});

/* Gelen baytları ard arda yazmak akışları TOPLAMAZ, sıraya dizer. */
test('iki akış örnek örnek toplanır', () => {
  const m = new L.PcmMixer({ prebuffer: 100 });
  m.add(1); m.add(2);
  m.push(1, pcm(200, 0.25, -0.5));
  m.push(2, pcm(200, 0.5, 0.25));
  const out = m.pull(100);
  assert.strictEqual(at(out, 0, 0), 0.75);
  assert.strictEqual(at(out, 99, 1), -0.25);
});

test('ön tampon dolmadan akış karışıma girmez', () => {
  const m = new L.PcmMixer({ prebuffer: 100 });
  m.add(1);
  m.push(1, pcm(50, 1, 1));
  assert.strictEqual(at(m.pull(10), 0, 0), 0, 'ön tampon dolmadan çaldı');
  m.push(1, pcm(60, 1, 1));
  assert.strictEqual(at(m.pull(10), 0, 0), 1);
});

test('kuyruk boşalınca yeniden dolmayı bekler', () => {
  const m = new L.PcmMixer({ prebuffer: 100 });
  m.add(1);
  m.push(1, pcm(100, 1, 1));
  const a = m.pull(150);
  assert.strictEqual(at(a, 99, 0), 1);
  assert.strictEqual(at(a, 100, 0), 0, 'eksik kısım sıfırla dolmalı');
  m.push(1, pcm(50, 1, 1));
  assert.strictEqual(at(m.pull(10), 0, 0), 0, 'boşaldıktan sonra ön tamponsuz çaldı');
});

test('kare sınırında bölünmüş parça kaymaz', () => {
  const m = new L.PcmMixer({ prebuffer: 1 });
  m.add(1);
  const b = pcm(10, 0.5, -0.5);
  m.push(1, b.subarray(0, 13));   // 1 kare + 5 bayt
  m.push(1, b.subarray(13));
  const out = m.pull(10);
  for (let i = 0; i < 10; i++) {
    assert.strictEqual(at(out, i, 0), 0.5);
    assert.strictEqual(at(out, i, 1), -0.5);
  }
});

test('kuyruk sınırı gecikmeyi sınırlar', () => {
  const m = new L.PcmMixer({ prebuffer: 10, maxQueue: 100 });
  m.add(1);
  for (let i = 0; i < 20; i++) m.push(1, pcm(50, i / 100, 0));
  // En eski parçalar atıldı: ilk çekilen değer en yenilerden biri
  assert.ok(at(m.pull(1), 0, 0) >= 0.17);
});

test('kaldırılan akış karışımdan çıkar', () => {
  const m = new L.PcmMixer({ prebuffer: 1 });
  m.add(1);
  m.push(1, pcm(100, 1, 1));
  m.remove(1);
  assert.strictEqual(at(m.pull(10), 0, 0), 0);
  m.push(1, pcm(10, 1, 1)); // kaldırılmış akışa yazmak çökmez
  assert.strictEqual(m.has(1), false);
});
