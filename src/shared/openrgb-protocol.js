'use strict';
/* OpenRGB SDK protokolü — saf kodlama/çözümleme.
 *
 * OpenRGB, RGB aygıtlarını tek bir yerden süren açık kaynaklı bir sunucu.
 * Windows Dynamic Lighting'in kapsamadığı çok daha fazla aygıtı destekliyor
 * ve üç işletim sisteminde de çalışıyor — mac ve linux'ta RGB'nin tek yolu,
 * Windows'ta ise Dynamic Lighting'in YANINDA ikinci bir seçenek.
 *
 * Ağ tarafı burada YOK. Sebebi: bu makinede OpenRGB sunucusu kurulu değil ve
 * kurulu olsa bile sürücüsü olmayan aygıtları taklit edemezdik. Protokolü saf
 * tutmak, cihazsız da sınanabilmesini sağlıyor — tıpkı çalıştıramadığımız
 * platformların ses kurallarını sınadığımız gibi.
 *
 * Tel biçimi (hepsi küçük-endian):
 *   başlık 16 bayt : "ORGB" | aygıt no u32 | komut u32 | veri boyu u32
 *   ardından veri.
 *
 * Renkler OpenRGB'de 0x00BBGGRR olarak saklanır, yani küçük-endian yazıldığında
 * bayt sırası R, G, B, 0 olur. Bunu ters çevirmek sessizce mavi-kırmızı takası
 * yapar ve ancak gerçek bir aygıtta fark edilir.
 */
(function () {
  const MAGIC = 'ORGB';
  const HEADER_SIZE = 16;

  /* Desteklenen en yüksek protokol sürümü. Sunucu daha düşükse onunkine
     inilir; aygıt verisinin biçimi sürüme göre değiştiği için bu şart. */
  const CLIENT_PROTOCOL = 4;

  const CMD = {
    REQUEST_CONTROLLER_COUNT: 0,
    REQUEST_CONTROLLER_DATA: 1,
    REQUEST_PROTOCOL_VERSION: 40,
    SET_CLIENT_NAME: 50,
    DEVICE_LIST_UPDATED: 100,
    UPDATE_LEDS: 1050,
    UPDATE_ZONE_LEDS: 1051,
    UPDATE_SINGLE_LED: 1052,
    SET_CUSTOM_MODE: 1100,
  };

  /* Aygıt türleri — arayüzde simge/gruplama için işe yarar. */
  const DEVICE_TYPE = [
    'motherboard', 'dram', 'gpu', 'cooler', 'ledstrip', 'keyboard', 'mouse',
    'mousemat', 'headset', 'headset_stand', 'gamepad', 'light', 'speaker',
    'virtual', 'storage', 'case', 'microphone', 'accessory', 'keypad',
    'unknown',
  ];

  // ---------------------------------------------------------------- yazma

  function header(deviceId, commandId, dataSize) {
    const b = Buffer.alloc(HEADER_SIZE);
    b.write(MAGIC, 0, 'ascii');
    b.writeUInt32LE(deviceId >>> 0, 4);
    b.writeUInt32LE(commandId >>> 0, 8);
    b.writeUInt32LE(dataSize >>> 0, 12);
    return b;
  }

  /* Başlık + (varsa) veri. */
  function encode(deviceId, commandId, data) {
    const body = data && data.length ? Buffer.from(data) : Buffer.alloc(0);
    return Buffer.concat([header(deviceId, commandId, body.length), body]);
  }

  /* İstemci adı: sonu NUL ile biten dizge. OpenRGB arayüzünde bu ad görünür,
     böylece kullanıcı ışıkları hangi uygulamanın sürdüğünü bilir. */
  function encodeClientName(name) {
    const s = Buffer.from(String(name || 'client'), 'utf8');
    return encode(0, CMD.SET_CLIENT_NAME, Buffer.concat([s, Buffer.from([0])]));
  }

  function encodeProtocolRequest(version) {
    const d = Buffer.alloc(4);
    d.writeUInt32LE((version === undefined ? CLIENT_PROTOCOL : version) >>> 0, 0);
    return encode(0, CMD.REQUEST_PROTOCOL_VERSION, d);
  }

  function encodeControllerCount() {
    return encode(0, CMD.REQUEST_CONTROLLER_COUNT, null);
  }

  /* Protokol 0'da bu istek verisizdi; 1'den itibaren istemci sürümünü taşıyor. */
  function encodeControllerData(deviceId, protocol) {
    if (!protocol) return encode(deviceId, CMD.REQUEST_CONTROLLER_DATA, null);
    const d = Buffer.alloc(4);
    d.writeUInt32LE(protocol >>> 0, 0);
    return encode(deviceId, CMD.REQUEST_CONTROLLER_DATA, d);
  }

  function encodeCustomMode(deviceId) {
    return encode(deviceId, CMD.SET_CUSTOM_MODE, null);
  }

  /* Bir aygıtın bütün LED'lerine renk yazar.
     colors: [{r,g,b}] ya da [[r,g,b]] ya da 0xRRGGBB sayıları. */
  function encodeUpdateLeds(deviceId, colors) {
    const list = colors || [];
    const n = list.length;
    const size = 4 + 2 + n * 4; // data_size + adet + renkler
    const d = Buffer.alloc(size);
    d.writeUInt32LE(size, 0);
    d.writeUInt16LE(n, 4);
    for (let i = 0; i < n; i++) {
      const { r, g, b } = normalizeColor(list[i]);
      const o = 6 + i * 4;
      d.writeUInt8(r, o);
      d.writeUInt8(g, o + 1);
      d.writeUInt8(b, o + 2);
      d.writeUInt8(0, o + 3);
    }
    return encode(deviceId, CMD.UPDATE_LEDS, d);
  }

  function clamp255(v) {
    v = Math.round(Number(v) || 0);
    return v < 0 ? 0 : v > 255 ? 255 : v;
  }

  /* Renk girdisini {r,g,b}'ye indirger. Kabul edilenler:
     {r,g,b} · [r,g,b] · '#rrggbb' · 0xRRGGBB sayısı. */
  function normalizeColor(c) {
    if (Array.isArray(c)) return { r: clamp255(c[0]), g: clamp255(c[1]), b: clamp255(c[2]) };
    if (typeof c === 'number') {
      return { r: clamp255((c >> 16) & 255), g: clamp255((c >> 8) & 255), b: clamp255(c & 255) };
    }
    if (typeof c === 'string') {
      const m = /^#?([0-9a-f]{6})$/i.exec(c.trim());
      if (!m) return { r: 0, g: 0, b: 0 };
      const v = parseInt(m[1], 16);
      return { r: (v >> 16) & 255, g: (v >> 8) & 255, b: v & 255 };
    }
    if (c && typeof c === 'object') return { r: clamp255(c.r), g: clamp255(c.g), b: clamp255(c.b) };
    return { r: 0, g: 0, b: 0 };
  }

  // ---------------------------------------------------------------- okuma

  /* Başlığı çözer. Eksik ya da geçersizse null döner — akıştan gelen veri
     parça parça geldiği için "henüz yeterli değil" normal bir durumdur. */
  function parseHeader(buf) {
    if (!buf || buf.length < HEADER_SIZE) return null;
    if (buf.toString('ascii', 0, 4) !== MAGIC) return null;
    return {
      deviceId: buf.readUInt32LE(4),
      commandId: buf.readUInt32LE(8),
      size: buf.readUInt32LE(12),
    };
  }

  /* Tampon içinde sınır denetimli gezinme. Aygıt verisi sürüme göre değişen
     uzunlukta olduğu için, taşma sessiz bir çöp okuma yerine hata olmalı. */
  class Reader {
    constructor(buf, offset) {
      this.buf = buf;
      this.at = offset || 0;
    }
    need(n) {
      if (this.at + n > this.buf.length) {
        throw new RangeError('OpenRGB verisi beklenenden kısa (' + this.at + '+' + n + ' > ' + this.buf.length + ')');
      }
    }
    u8() { this.need(1); return this.buf.readUInt8(this.at++); }
    u16() { this.need(2); const v = this.buf.readUInt16LE(this.at); this.at += 2; return v; }
    u32() { this.need(4); const v = this.buf.readUInt32LE(this.at); this.at += 4; return v; }
    i32() { this.need(4); const v = this.buf.readInt32LE(this.at); this.at += 4; return v; }
    skip(n) { this.need(n); this.at += n; }
    /* u16 uzunluk + baytlar. Uzunluk sondaki NUL'u da içerir. */
    str() {
      const n = this.u16();
      this.need(n);
      let end = this.at + n;
      if (n > 0 && this.buf[end - 1] === 0) end--;
      const s = this.buf.toString('utf8', this.at, end);
      this.at += n;
      return s;
    }
  }

  function readMode(r, protocol) {
    const m = { name: r.str() };
    m.value = r.i32();
    m.flags = r.u32();
    m.speedMin = r.u32();
    m.speedMax = r.u32();
    if (protocol >= 3) { m.brightnessMin = r.u32(); m.brightnessMax = r.u32(); }
    m.colorsMin = r.u32();
    m.colorsMax = r.u32();
    m.speed = r.u32();
    if (protocol >= 3) m.brightness = r.u32();
    m.direction = r.u32();
    m.colorMode = r.u32();
    const n = r.u16();
    r.skip(n * 4);
    return m;
  }

  function readZone(r, protocol) {
    const z = { name: r.str() };
    z.type = r.u32();
    z.ledsMin = r.u32();
    z.ledsMax = r.u32();
    z.ledCount = r.u32();
    const matrixLen = r.u16();
    if (matrixLen > 0) r.skip(matrixLen);
    if (protocol >= 4) {
      const segments = r.u16();
      for (let i = 0; i < segments; i++) {
        r.str();      // ad
        r.u32();      // tür
        r.u32();      // başlangıç
        r.u32();      // led sayısı
      }
    }
    return z;
  }

  /* Aygıt tanımını çözer. İhtiyacımız olan tek zorunlu sayı LED adedi — ama
     oraya ulaşmak için modların ve bölgelerin üzerinden doğru atlamak gerekiyor,
     ve o atlamaların uzunluğu protokol sürümüne bağlı. Yanlış sürümle okumak
     çöp bir LED sayısı verir; o yüzden sürüm tahmin edilmez, sunucuya sorulur. */
  function parseControllerData(buf, protocol) {
    const p = protocol || 0;
    const r = new Reader(buf, 0);
    const out = { protocol: p };
    out.dataSize = r.u32();
    out.type = r.u32();
    out.typeName = DEVICE_TYPE[out.type] || 'unknown';
    out.name = r.str();
    if (p >= 1) out.vendor = r.str();
    out.description = r.str();
    out.version = r.str();
    out.serial = r.str();
    out.location = r.str();

    const modeCount = r.u16();
    out.activeMode = r.u32();
    out.modes = [];
    for (let i = 0; i < modeCount; i++) out.modes.push(readMode(r, p));

    const zoneCount = r.u16();
    out.zones = [];
    for (let i = 0; i < zoneCount; i++) out.zones.push(readZone(r, p));

    const ledCount = r.u16();
    out.leds = [];
    for (let i = 0; i < ledCount; i++) {
      const name = r.str();
      const value = r.u32();
      out.leds.push({ name, value });
    }
    out.ledCount = ledCount;

    const colorCount = r.u16();
    r.skip(colorCount * 4);
    return out;
  }

  /* Aygıtın anlık renk yazmayı destekleyen bir modu var mı?
     "Direct" mod varsa renkler donanıma anında gider; yoksa SET_CUSTOM_MODE
     ile özel moda geçilir. İkisi de yoksa aygıt yalnızca kendi efektlerini
     oynatır ve müzikle sürülemez — bunu kullanıcıya söylemek gerekir. */
  function directModeIndex(controller) {
    const modes = (controller && controller.modes) || [];
    const i = modes.findIndex((m) => /^direct$/i.test(m.name || ''));
    return i >= 0 ? i : -1;
  }

  function canDrive(controller) {
    if (!controller || !controller.ledCount) return false;
    if (directModeIndex(controller) >= 0) return true;
    return (controller.modes || []).some((m) => /^(custom|static)$/i.test(m.name || ''));
  }

  const api = {
    MAGIC,
    HEADER_SIZE,
    CLIENT_PROTOCOL,
    CMD,
    DEVICE_TYPE,
    header,
    encode,
    encodeClientName,
    encodeProtocolRequest,
    encodeControllerCount,
    encodeControllerData,
    encodeCustomMode,
    encodeUpdateLeds,
    normalizeColor,
    parseHeader,
    parseControllerData,
    directModeIndex,
    canDrive,
    Reader,
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (typeof window !== 'undefined') window.SVOpenRGBProtocol = api;
})();
