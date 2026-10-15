'use strict';
/* Uygulama seçicisindeki canlı ölçerler (#516).
 *
 * Yardımcı (native/app-audio-helper --meters) her oturumun tepe seviyesini
 * satır satır JSON olarak akıtıyor. Burada sınananlar platformdan bağımsız
 * parçalar: borudan yarım gelen satırlar, bozuk girişler, aynı uygulamanın
 * birden çok süreci, panel çubuğunun ölçeği ve balistiği — ve ana süreçteki
 * akışın yaşam döngüsü (yalnız istenirken çalışır, kapatınca stdin kapanır,
 * eski ikilide vazgeçer). Gerçek yardımcı CI'da (Ubuntu) yok; akış sahte bir
 * çocuk süreçle sınanıyor.
 */

const test = require('node:test');
const assert = require('node:assert');
const { EventEmitter } = require('events');
const A = require('../src/shared/app-audio.js');
const appCapture = require('../src/main/app-capture.js');

// ------------------------------------------------------------ satır bölme

test('borudan yarım gelen satır bir sonraki parçayla birleşir', () => {
  let r = A.splitMeterChunk('', '[[1,"a.exe",0.5]]\n[[1,"a.ex');
  assert.deepStrictEqual(r.lines, ['[[1,"a.exe",0.5]]']);
  assert.strictEqual(r.carry, '[[1,"a.ex');
  r = A.splitMeterChunk(r.carry, 'e",0.25]]\n');
  assert.deepStrictEqual(r.lines, ['[[1,"a.exe",0.25]]']);
  assert.strictEqual(r.carry, '');
});

test('Windows satır sonu ve boş satırlar ayıklanır', () => {
  const r = A.splitMeterChunk('', '[]\r\n\r\n[[2,"b.exe",0]]\r\n');
  assert.deepStrictEqual(r.lines, ['[]', '[[2,"b.exe",0]]']);
});

test('sonu gelmeyen satır sınırsız büyümez', () => {
  const r = A.splitMeterChunk('', 'x'.repeat(A.METER_CARRY_MAX + 10));
  assert.strictEqual(r.carry, '');
});

// ------------------------------------------------------------ ayrıştırma

test('geçerli satır ayrıştırılır', () => {
  assert.deepStrictEqual(A.parseMeterLine('[[120,"chrome.exe",0.25],[44,"Spotify.exe",0]]'), [
    { pid: 120, name: 'chrome.exe', peak: 0.25 },
    { pid: 44, name: 'Spotify.exe', peak: 0 },
  ]);
  assert.deepStrictEqual(A.parseMeterLine('[]'), []);
});

test('bozuk satır yok sayılır', () => {
  assert.strictEqual(A.parseMeterLine('APP-METERS-START'), null);
  assert.strictEqual(A.parseMeterLine('{"pid":1}'), null);
  assert.strictEqual(A.parseMeterLine(''), null);
  /* Türkçe sistemde ondalık virgül JSON'u bozmaz ama değeri yanlış okutur
     (0,5 -> 0): yardımcı bu yüzden sayıyı değişmez kültürle yazıyor. */
  assert.strictEqual(A.parseMeterLine('[[1,"a.exe",0,5]]')[0].peak, 0);
});

test('bozuk tek giriş satırın geri kalanını düşürmez', () => {
  const rows = A.parseMeterLine('[[0,"x.exe",1],[5,"",1],"çöp",[7,"ok.exe",0.5]]');
  assert.deepStrictEqual(rows, [{ pid: 7, name: 'ok.exe', peak: 0.5 }]);
});

test('tepe 0..1 aralığına kırpılır, sayı olmayan sıfır olur', () => {
  const rows = A.parseMeterLine('[[1,"a.exe",1.7],[2,"b.exe",-0.2],[3,"c.exe","x"],[4,"d.exe",null]]');
  assert.deepStrictEqual(rows.map((r) => r.peak), [1, 0, 0, 0]);
});

// ------------------------------------------------------------ birleştirme

test('aynı uygulamanın süreçlerinden EN YÜKSEĞİ gösterilir, ad büyük/küçük harf duyarsız', () => {
  const levels = A.meterLevels([
    { pid: 1, name: 'msedge.exe', peak: 0.1 },
    { pid: 2, name: 'MSEdge.exe', peak: 0.6 },
    { pid: 3, name: 'msedge.exe', peak: 0.3 },
    { pid: 4, name: 'Spotify.exe', peak: 0 },
  ]);
  assert.deepStrictEqual(levels, { 'msedge.exe': 0.6, 'spotify.exe': 0 });
});

test('ölçer anahtarı seçicideki satır anahtarıyla aynı', () => {
  const rows = A.candidates([{ pid: 9, name: 'Discord.exe', label: 'Discord', audible: true }]);
  const levels = A.meterLevels([{ pid: 9, name: 'Discord.exe', peak: 0.4 }]);
  assert.strictEqual(levels[A.baseName(rows[0].match)], 0.4);
});

// ------------------------------------------------------------ çubuk ölçeği

test('doluluk dB ölçeğinde', () => {
  assert.strictEqual(A.meterFraction(0), 0);
  assert.strictEqual(A.meterFraction(1), 1);
  assert.strictEqual(A.meterFraction(2), 1);
  assert.strictEqual(A.meterFraction(NaN), 0);
  assert.strictEqual(A.METER_FLOOR_DB, -48);
  // taban (-48 dB) ve altı boş
  assert.strictEqual(A.meterFraction(Math.pow(10, -48 / 20)), 0);
  assert.strictEqual(A.meterFraction(0.001), 0);
  // -20 dB (0,1) doğrusal ölçekte onda bir olurdu; burada yarıdan fazla
  assert.ok(Math.abs(A.meterFraction(0.1) - 28 / 48) < 1e-9);
  // -6 dB
  assert.ok(Math.abs(A.meterFraction(0.5) - (1 - 6.0206 / 48)) < 1e-4);
});

test('yükseliş anında, düşüş zamanla', () => {
  assert.strictEqual(A.meterBallistics(0.2, 0.9, 66), 0.9);
  const down = A.meterBallistics(1, 0, 100);
  assert.ok(Math.abs(down - (1 - A.METER_RELEASE_PER_SEC * 0.1)) < 1e-9);
  // hedefin altına inmez
  assert.strictEqual(A.meterBallistics(0.5, 0.45, 1000), 0.45);
  // zaman geçmediyse yerinde kalır
  assert.strictEqual(A.meterBallistics(0.5, 0, 0), 0.5);
  // tam düşüş ≈ 1 / hız saniye
  let v = 1;
  for (let t = 0; t < 1000 / A.METER_RELEASE_PER_SEC + 70; t += 66) v = A.meterBallistics(v, 0, 66);
  assert.strictEqual(v, 0);
});

// ------------------------------------------------------- ana süreç akışı

function fakeChild() {
  const c = new EventEmitter();
  c.stdout = new EventEmitter();
  c.stderr = new EventEmitter();
  c.stdin = new EventEmitter();
  c.stdinEnded = false;
  c.killed = false;
  c.stdin.end = () => { c.stdinEnded = true; };
  c.kill = () => { c.killed = true; };
  return c;
}

/* Elle ilerleyen saat: zamanlayıcılar ancak tick() ile çalışır. */
function fakeClock() {
  let t = 1000;
  let seq = 0;
  const timers = new Map();
  return {
    now: () => t,
    setTimeout: (fn, ms) => {
      const id = { id: ++seq, at: t + ms, fn };
      timers.set(id.id, id);
      return id;
    },
    clearTimeout: (h) => { if (h) timers.delete(h.id); },
    tick(ms) {
      t += ms;
      for (const h of Array.from(timers.values()).sort((a, b) => a.at - b.at)) {
        if (h.at <= t && timers.has(h.id)) { timers.delete(h.id); h.fn(); }
      }
    },
    pending: () => timers.size,
  };
}

function setup(opts) {
  const clock = fakeClock();
  const spawned = [];
  const sent = [];
  const o = Object.assign({
    helperPath: () => 'C:\\fake\\app-audio-helper.exe',
    spawn: (exe, args, so) => {
      const c = fakeChild();
      c.args = args;
      c.stdio = so.stdio;
      spawned.push(c);
      return c;
    },
    send: (p) => sent.push(p),
    now: clock.now,
    setTimeout: clock.setTimeout,
    clearTimeout: clock.clearTimeout,
  }, opts || {});
  return { stream: appCapture.createMeterStream(o), clock, spawned, sent };
}

test('akış istenmeden yardımcı başlamaz', () => {
  const { stream, spawned } = setup();
  assert.strictEqual(spawned.length, 0);
  stream.setWanted(false);
  assert.strictEqual(spawned.length, 0);
});

test('istenince --meters ile ve stdin BORU olarak başlar', () => {
  const { stream, spawned } = setup();
  stream.setWanted(true);
  stream.setWanted(true); // ikinci istek ikinci süreç açmaz
  assert.strictEqual(spawned.length, 1);
  assert.strictEqual(spawned[0].args[0], '--meters');
  assert.deepStrictEqual(spawned[0].stdio, ['pipe', 'pipe', 'pipe']);
});

test('seviyeler uygulama başına birleştirilip seyreltilerek gönderilir', () => {
  const { stream, spawned, sent, clock } = setup();
  stream.setWanted(true);
  const c = spawned[0];
  c.stdout.emit('data', Buffer.from('[[1,"a.exe",0.1],[2,"A.exe",0.4]]\n'));
  clock.tick(0);
  assert.deepStrictEqual(sent, [{ available: true, levels: { 'a.exe': 0.4 } }]);
  // Seyreltme penceresinde gelen satırlardan yalnız sonuncusu gider
  c.stdout.emit('data', Buffer.from('[[1,"a.exe",0.2]]\n'));
  c.stdout.emit('data', Buffer.from('[[1,"a.exe",0.3]]\n[[1,"a.ex'));
  clock.tick(10);
  assert.strictEqual(sent.length, 1);
  clock.tick(appCapture.METER_SEND_MS);
  assert.strictEqual(sent.length, 2);
  assert.deepStrictEqual(sent[1].levels, { 'a.exe': 0.3 });
});

test('bırakınca stdin kapanır, çıkmazsa süre sonunda öldürülür', () => {
  const { stream, spawned, clock } = setup();
  stream.setWanted(true);
  const c = spawned[0];
  stream.setWanted(false);
  assert.strictEqual(c.stdinEnded, true);
  assert.strictEqual(c.killed, false);
  clock.tick(appCapture.METER_STOP_GRACE_MS);
  assert.strictEqual(c.killed, true);
  assert.strictEqual(stream.running(), false);
});

test('kendiliğinden çıkan yardımcı öldürülmez ve yeniden başlatılmaz', () => {
  const { stream, spawned, clock } = setup();
  stream.setWanted(true);
  const c = spawned[0];
  stream.setWanted(false);
  c.emit('exit', 0);
  clock.tick(appCapture.METER_STOP_GRACE_MS * 2);
  assert.strictEqual(c.killed, false);
  assert.strictEqual(spawned.length, 1);
});

test('bırakıldıktan sonra gelen satır panele gitmez', () => {
  const { stream, spawned, sent, clock } = setup();
  stream.setWanted(true);
  stream.setWanted(false);
  spawned[0].stdout.emit('data', Buffer.from('[[1,"a.exe",0.5]]\n'));
  clock.tick(1000);
  assert.strictEqual(sent.length, 0);
});

test('--meters bilmeyen eski yardımcıda hemen vazgeçilir', () => {
  const { stream, spawned, sent, clock } = setup();
  stream.setWanted(true);
  spawned[0].emit('exit', 2);
  clock.tick(60000);
  assert.strictEqual(spawned.length, 1);
  assert.deepStrictEqual(sent, [{ available: false }]);
  // sonraki abonelik de süreç açmaz, yalnız durumu yineler
  stream.setWanted(false);
  stream.setWanted(true);
  assert.strictEqual(spawned.length, 1);
  assert.deepStrictEqual(sent[sent.length - 1], { available: false });
});

test('yardımcı yoksa süreç açılmadan vazgeçilir', () => {
  const { stream, spawned, sent } = setup({ helperPath: () => null });
  stream.setWanted(true);
  assert.strictEqual(spawned.length, 0);
  assert.deepStrictEqual(sent, [{ available: false }]);
});

test('çöken yardımcı sınırlı sayıda yeniden denenir', () => {
  const { stream, spawned, sent, clock } = setup();
  stream.setWanted(true);
  for (let i = 0; i < 10; i++) {
    const c = spawned[spawned.length - 1];
    c.emit('exit', 1);
    clock.tick(5000);
  }
  assert.strictEqual(spawned.length, appCapture.METER_MAX_FAILURES);
  assert.deepStrictEqual(sent[sent.length - 1], { available: false });
});

test('uzun süre çalışmış yardımcının ölümü sayacı sıfırlar', () => {
  const { stream, spawned, clock } = setup();
  stream.setWanted(true);
  for (let i = 0; i < 6; i++) {
    clock.tick(20000); // sağlıklı çalıştı
    spawned[spawned.length - 1].emit('exit', 1);
    clock.tick(5000);
  }
  assert.strictEqual(spawned.length, 7);
  assert.strictEqual(stream.running(), true);
});
