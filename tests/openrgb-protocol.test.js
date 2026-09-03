'use strict';
/* OpenRGB tel protokolünün testleri.
 *
 * Bu makinede OpenRGB sunucusu yok ve olsa bile sürücüsü olmayan aygıtları
 * taklit edemezdik. O yüzden aygıt tanımları burada BAYT BAYT kuruluyor ve
 * çözümleyiciye veriliyor. Sınanan şey, protokolü doğru okuyup yazdığımız.
 *
 * En sinsi iki hata burada yakalanıyor:
 *   - Renk bayt sırası. OpenRGB rengi 0x00BBGGRR tutar; ters yazmak kırmızı
 *     ile maviyi sessizce takas eder ve ancak gerçek bir aygıtta görülür.
 *   - Sürüme bağlı alanlar. Mod yapısı protokol 3'te iki alan büyüyor; yanlış
 *     sürümle okumak modların ötesindeki LED sayısını çöpe çevirir, ve o
 *     sayıyla gönderilen renk paketi aygıtı yanlış sürer.
 */
const test = require('node:test');
const assert = require('node:assert');

const P = require('../src/shared/openrgb-protocol.js');

// ------------------------------------------------------------ yardımcılar
function str(s) {
  const b = Buffer.from(s, 'utf8');
  const out = Buffer.alloc(2 + b.length + 1);
  out.writeUInt16LE(b.length + 1, 0);
  b.copy(out, 2);
  out.writeUInt8(0, 2 + b.length);
  return out;
}
const u16 = (v) => { const b = Buffer.alloc(2); b.writeUInt16LE(v, 0); return b; };
const u32 = (v) => { const b = Buffer.alloc(4); b.writeUInt32LE(v >>> 0, 0); return b; };
const i32 = (v) => { const b = Buffer.alloc(4); b.writeInt32LE(v, 0); return b; };

/* Gerçek sunucunun yolladığı biçimde bir aygıt tanımı kurar. */
function buildController(opts) {
  const o = Object.assign({ protocol: 4, name: 'Test Device', type: 5, modes: ['Direct', 'Static'], zones: [8], leds: 8 }, opts);
  const p = o.protocol;
  const parts = [];
  parts.push(u32(0));            // data_size — sonra düzeltilir
  parts.push(u32(o.type));
  parts.push(str(o.name));
  if (p >= 1) parts.push(str('Vendor'));
  parts.push(str('Bir aygıt'));
  parts.push(str('1.0'));
  parts.push(str('SN123'));
  parts.push(str('USB:1'));

  parts.push(u16(o.modes.length));
  parts.push(u32(0));            // active_mode
  for (const name of o.modes) {
    parts.push(str(name));
    parts.push(i32(0));          // value
    parts.push(u32(0));          // flags
    parts.push(u32(0));          // speed_min
    parts.push(u32(100));        // speed_max
    if (p >= 3) { parts.push(u32(0)); parts.push(u32(100)); } // brightness min/max
    parts.push(u32(0));          // colors_min
    parts.push(u32(0));          // colors_max
    parts.push(u32(50));         // speed
    if (p >= 3) parts.push(u32(100));                         // brightness
    parts.push(u32(0));          // direction
    parts.push(u32(0));          // color_mode
    parts.push(u16(0));          // num_colors
  }

  parts.push(u16(o.zones.length));
  for (const count of o.zones) {
    parts.push(str('Zone'));
    parts.push(u32(1));          // type
    parts.push(u32(0));          // leds_min
    parts.push(u32(count));      // leds_max
    parts.push(u32(count));      // leds_count
    parts.push(u16(0));          // matrix_len
    if (p >= 4) parts.push(u16(0));  // segment sayısı
  }

  parts.push(u16(o.leds));
  for (let i = 0; i < o.leds; i++) {
    parts.push(str('LED ' + i));
    parts.push(u32(0));
  }
  parts.push(u16(0));            // num_colors

  const buf = Buffer.concat(parts);
  buf.writeUInt32LE(buf.length, 0);
  return buf;
}

// ------------------------------------------------------------ başlık
test('başlık yazılıp geri okunuyor', () => {
  const h = P.header(3, P.CMD.UPDATE_LEDS, 42);
  assert.strictEqual(h.length, 16);
  assert.strictEqual(h.toString('ascii', 0, 4), 'ORGB');
  const p = P.parseHeader(h);
  assert.deepStrictEqual(p, { deviceId: 3, commandId: 1050, size: 42 });
});

test('yabancı veri başlık sanılmıyor', () => {
  assert.strictEqual(P.parseHeader(Buffer.from('HTTP/1.1 200 OK...')), null);
  assert.strictEqual(P.parseHeader(Buffer.alloc(4)), null, 'kısa tampon');
  assert.strictEqual(P.parseHeader(null), null);
});

test('istemci adı NUL ile bitiyor', () => {
  /* Sonlandırıcı olmadan sunucu adı bitişik baytlarla birlikte okur. */
  const b = P.encodeClientName('CAYADEV Visualizer');
  const data = b.subarray(16);
  assert.strictEqual(data[data.length - 1], 0);
  assert.strictEqual(data.toString('utf8', 0, data.length - 1), 'CAYADEV Visualizer');
});

// ------------------------------------------------------------ renk
test('renk bayt sırası R,G,B,0 — kırmızı ve mavi TAKAS EDİLMİYOR', () => {
  /* OpenRGB rengi 0x00BBGGRR tutar. Ters yazmak hiçbir hata vermez, yalnızca
     bütün sahne renkleri yanlış çıkar. */
  const pkt = P.encodeUpdateLeds(0, [{ r: 255, g: 128, b: 7 }]);
  const d = pkt.subarray(16);
  assert.strictEqual(d.readUInt8(6), 255, 'ilk bayt KIRMIZI olmalı');
  assert.strictEqual(d.readUInt8(7), 128, 'ikinci bayt yeşil');
  assert.strictEqual(d.readUInt8(8), 7, 'üçüncü bayt MAVİ olmalı');
  assert.strictEqual(d.readUInt8(9), 0, 'dördüncü bayt kullanılmıyor');
  assert.strictEqual(d.readUInt32LE(6), 0x0007_80ff, '0x00BBGGRR olarak okunmalı');
});

test('renk her biçimden okunuyor', () => {
  const want = { r: 18, g: 52, b: 86 };
  assert.deepStrictEqual(P.normalizeColor({ r: 18, g: 52, b: 86 }), want);
  assert.deepStrictEqual(P.normalizeColor([18, 52, 86]), want);
  assert.deepStrictEqual(P.normalizeColor('#123456'), want);
  assert.deepStrictEqual(P.normalizeColor('123456'), want);
  assert.deepStrictEqual(P.normalizeColor(0x123456), want);
});

test('renk aralık dışına taşmıyor', () => {
  assert.deepStrictEqual(P.normalizeColor({ r: -5, g: 300, b: 12.6 }), { r: 0, g: 255, b: 13 });
  assert.deepStrictEqual(P.normalizeColor(null), { r: 0, g: 0, b: 0 });
  assert.deepStrictEqual(P.normalizeColor('yeşil'), { r: 0, g: 0, b: 0 });
});

test('LED paketi kendi boyunu doğru bildiriyor', () => {
  const pkt = P.encodeUpdateLeds(2, [[1, 2, 3], [4, 5, 6], [7, 8, 9]]);
  const head = P.parseHeader(pkt);
  const d = pkt.subarray(16);
  assert.strictEqual(head.deviceId, 2);
  assert.strictEqual(head.size, d.length, 'başlıktaki boy gövdeyle uyuşmalı');
  assert.strictEqual(d.readUInt32LE(0), d.length, 'gövde kendi boyunu taşır');
  assert.strictEqual(d.readUInt16LE(4), 3, 'renk adedi');
  assert.strictEqual(d.length, 4 + 2 + 3 * 4);
});

test('boş renk listesi geçerli bir paket üretiyor', () => {
  const d = P.encodeUpdateLeds(0, []).subarray(16);
  assert.strictEqual(d.readUInt16LE(4), 0);
  assert.strictEqual(d.length, 6);
});

// ------------------------------------------------------------ aygıt tanımı
for (const protocol of [0, 1, 2, 3, 4]) {
  test('aygıt tanımı protokol ' + protocol + ' ile doğru çözülüyor', () => {
    const buf = buildController({ protocol, leds: 12, zones: [12], name: 'Klavye' });
    const c = P.parseControllerData(buf, protocol);
    assert.strictEqual(c.name, 'Klavye');
    assert.strictEqual(c.ledCount, 12, 'LED sayısı yanlışsa aygıt yanlış sürülür');
    assert.strictEqual(c.leds.length, 12);
    assert.strictEqual(c.zones.length, 1);
    assert.strictEqual(c.zones[0].ledCount, 12);
    assert.deepStrictEqual(c.modes.map((m) => m.name), ['Direct', 'Static']);
    assert.strictEqual(c.dataSize, buf.length, 'bildirilen boy gerçek boyla uyuşmalı');
  });
}

test('protokol 3 modları büyütür ve yanlış sürümle okumak LED sayısını bozar', () => {
  /* Bu testin amacı sürüm pazarlığının neden şart olduğunu göstermek. */
  const buf = buildController({ protocol: 3, leds: 12 });
  const dogru = P.parseControllerData(buf, 3);
  assert.strictEqual(dogru.ledCount, 12);

  let yanlisSonuc = null;
  try {
    yanlisSonuc = P.parseControllerData(buf, 0).ledCount;
  } catch {
    yanlisSonuc = 'hata';
  }
  assert.notStrictEqual(yanlisSonuc, 12,
    'yanlış sürümle okumak 12 vermemeli — verirse bu test bir şey kanıtlamıyor demektir');
});

test('çok bölgeli aygıtın toplam LED sayısı okunuyor', () => {
  const c = P.parseControllerData(buildController({ zones: [4, 6, 8], leds: 18 }), 4);
  assert.strictEqual(c.ledCount, 18);
  assert.deepStrictEqual(c.zones.map((z) => z.ledCount), [4, 6, 8]);
});

test('kesilmiş veri sessizce çöp okumuyor', () => {
  /* Sınır denetimi olmasaydı yarım bir tampon rastgele bir LED sayısı verir,
     o sayıyla renk paketi kurulur ve aygıt beklenmedik davranırdı. */
  const buf = buildController({ leds: 8 });
  assert.throws(() => P.parseControllerData(buf.subarray(0, buf.length - 10), 4), RangeError);
  assert.throws(() => P.parseControllerData(Buffer.alloc(3), 4), RangeError);
});

test('LED matrisi olan bölge atlanabiliyor', () => {
  /* Matris haritası değişken uzunlukta; yanlış atlamak sonraki her alanı kaydırır. */
  const parts = [
    u32(0), u32(5), str('Matrisli'), str('V'), str('d'), str('1'), str('s'), str('l'),
    u16(1), u32(0),
    str('Direct'), i32(0), u32(0), u32(0), u32(100), u32(0), u32(100), u32(0), u32(0), u32(50), u32(100), u32(0), u32(0), u16(0),
    u16(1),
    str('Matris'), u32(1), u32(0), u32(6), u32(6), u16(8 + 6 * 4), Buffer.alloc(8 + 6 * 4), u16(0),
    u16(6),
  ];
  for (let i = 0; i < 6; i++) { parts.push(str('L' + i)); parts.push(u32(0)); }
  parts.push(u16(0));
  const buf = Buffer.concat(parts);
  buf.writeUInt32LE(buf.length, 0);
  const c = P.parseControllerData(buf, 4);
  assert.strictEqual(c.ledCount, 6);
  assert.strictEqual(c.zones[0].name, 'Matris');
});

// ------------------------------------------------------------ sürülebilirlik
test('Direct modu olan aygıt sürülebilir', () => {
  const c = P.parseControllerData(buildController({ modes: ['Direct', 'Rainbow'] }), 4);
  assert.strictEqual(P.directModeIndex(c), 0);
  assert.strictEqual(P.canDrive(c), true);
});

test('Direct yoksa Custom da kabul edilir', () => {
  const c = P.parseControllerData(buildController({ modes: ['Rainbow', 'Custom'] }), 4);
  assert.strictEqual(P.directModeIndex(c), -1);
  assert.strictEqual(P.canDrive(c), true);
});

test('yalnız kendi efektlerini oynatan aygıt sürülemez', () => {
  /* Böyle bir aygıta renk yollamak sessizce hiçbir şey yapmaz; kullanıcıya
     bunun neden olmadığını söyleyebilmek için ayırt etmek gerekiyor. */
  const c = P.parseControllerData(buildController({ modes: ['Rainbow', 'Breathing'] }), 4);
  assert.strictEqual(P.canDrive(c), false);
});

test('LED\'i olmayan aygıt sürülemez', () => {
  const c = P.parseControllerData(buildController({ leds: 0, zones: [] }), 4);
  assert.strictEqual(c.ledCount, 0);
  assert.strictEqual(P.canDrive(c), false);
});

test('aygıt türü ada çevriliyor', () => {
  assert.strictEqual(P.parseControllerData(buildController({ type: 5 }), 4).typeName, 'keyboard');
  assert.strictEqual(P.parseControllerData(buildController({ type: 2 }), 4).typeName, 'gpu');
  assert.strictEqual(P.parseControllerData(buildController({ type: 99 }), 4).typeName, 'unknown');
});
