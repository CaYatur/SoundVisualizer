'use strict';
/* Telefon bağlantısı çekirdeği (src/main/phone-link.js): QR ve kodla eşleşme, sayı
 * karşılaştırması, yeniden bağlanma, yön başına anahtarlı şifreli zarf, yeniden oynatma,
 * yanlış kod sınırı, araya girme denemesi ve izin tablosu. Telefon tarafı burada aynı yapı
 * taşlarıyla taklit edilir (Android'deki Kotlin uygulaması aynı adımları izler). */
const test = require('node:test');
const assert = require('node:assert');
const crypto = require('crypto');
const L = require('../src/main/phone-link');

const send = (conn, obj) => conn.handle(JSON.stringify(obj));
const one = (out) => { assert.strictEqual(out.length, 1); return out[0]; };

function phone(name) {
  const id = L.newIdentity();
  return { id, name: name || 'Redmi Note 9 Pro', pub: L.b64u(id.pub) };
}
function clock(start) { let t = start || 1e12; return { now: () => t, add: (ms) => { t += ms; } }; }

function pairQr(host, ph, qr, approve) {
  const q = new URL(qr.replace('svlink://', 'http://x/'));
  const secret = L.unb64u(q.searchParams.get('s'));
  const np = crypto.randomBytes(16);
  const conn = host.connection({ address: '192.168.1.50' });
  const r = one(send(conn, { t: 'pair', kind: 'qr', v: 1, pub: ph.pub, np: L.b64u(np), name: ph.name, model: 'M2003J6B2G',
    mac: L.b64u(L.hmac(secret, 'sv-link-qr|phone|', ph.id.pub, np)) }));
  // QR yolunda da bilgisayarda onay gerekir
  const paired = r.t === 'pending' && approve !== false ? one(conn.confirm(true)) : null;
  return { conn, r, paired, np, secret, fp: q.searchParams.get('f') };
}
// Telefonun oturum anahtarları: aynı türetme
function phoneSession(devKey, np, nc) {
  const k = L.sessionKeys(devKey, np, nc);
  return { seal: L.sealer(k.c2p, 'c2p'), open: L.opener(k.p2c, 'p2c') };
}

test('QR ile eşleşme: parmak izi, iki yönlü kanıt, bilgisayarda onay, ortak anahtar ve şifreli ileti', () => {
  const events = [];
  const host = L.createHost({ pcName: 'Stüdyo-PC', onEvent: (e) => events.push(e) });
  host.openPairing();
  const qr = host.qrPayload(['192.168.1.24', '10.0.0.5'], 8722);
  assert.match(qr, /^svlink:\/\/1\?h=192\.168\.1\.24&h=10\.0\.0\.5&p=8722&id=/);
  const ph = phone();
  // Önce onaysız: kayıt yok, oturum yok
  const first = pairQr(host, ph, qr, false);
  assert.strictEqual(first.r.t, 'pending');
  assert.strictEqual(host.devices().length, 0, 'QR tek başına cihaz kaydetmez');
  assert.strictEqual(first.conn.encrypt({}), null);
  const sasEv = events.find((e) => e.type === 'sas');
  assert.strictEqual(sasEv.via, 'qr');
  assert.strictEqual(one(first.conn.confirm(false)).code, 'rejected');
  assert.strictEqual(host.devices().length, 0);
  events.length = 0;
  const { conn, r, paired, np, secret, fp } = pairQr(host, ph, qr);
  assert.strictEqual(r.t, 'pending');
  assert.strictEqual(paired.t, 'paired');
  assert.strictEqual(paired.level, 'full', 'yeni cihaz tam erişimle başlar (kullanıcı kararı)');
  const pcPub = L.unb64u(r.pc.pub);
  // Telefon: bilgisayar QR'daki parmak izine ve sırra uyuyor mu?
  assert.strictEqual(L.b64u(L.fingerprint(pcPub)), fp);
  const nc = L.unb64u(r.nc);
  assert.ok(L.hmac(secret, 'sv-link-qr|pc|', pcPub, nc, ph.id.pub).equals(L.unb64u(r.mac)));
  const devKey = L.deviceKey(L.sharedSecret(ph.id, pcPub), ph.id.pub, pcPub, np, nc);
  const s = phoneSession(devKey, np, nc);
  // Telefon → PC ve PC → telefon
  assert.deepStrictEqual(conn.decrypt(s.seal(Buffer.from(JSON.stringify({ op: 'state.get' })))), { op: 'state.get' });
  assert.deepStrictEqual(JSON.parse(s.open(conn.encrypt({ ok: true })).toString()), { ok: true });
  assert.deepStrictEqual(events.map((e) => e.type), ['sas', 'paired', 'session']);
  // Telefon de aynı sayıyı hesaplayabilir
  assert.strictEqual(events[0].digits, L.sasDigits(ph.id.pub, pcPub, np, nc));
  assert.strictEqual(host.pairingInfo(), null, 'QR tek kullanımlık');
  assert.strictEqual(host.devices()[0].name, 'Redmi Note 9 Pro');
  assert.strictEqual(host.devices()[0].online, true);
});

test('Yanlış denemeler: QR sırrı pencereyi yakmaz; kod adres başına sınırlı, başka adres etkilenmez', () => {
  let burned = 0;
  const host = L.createHost({ onEvent: (e) => { if (e.type === 'code-burned') burned++; } });
  const { code } = host.openPairing();
  const qr = host.qrPayload(['h'], 1);
  // Ağdaki biri yanlış sırla durmadan denese de kullanıcının QR'ı değişmez
  for (let i = 0; i < 40; i++) {
    const ph = phone();
    const np = crypto.randomBytes(16);
    const out = one(send(host.connection({ address: '192.168.1.66' }), { t: 'pair', kind: 'qr', v: 1, pub: ph.pub, np: L.b64u(np),
      mac: L.b64u(L.hmac(crypto.randomBytes(32), 'sv-link-qr|phone|', ph.id.pub, np)) }));
    assert.deepStrictEqual(out, { t: 'error', code: 'bad-secret' });
  }
  assert.strictEqual(burned, 0);
  assert.strictEqual(host.qrPayload(['h'], 1), qr);
  // Kod: aynı adresten beş yanlış o adresi kapatır
  const ph = phone();
  const wrong = String((+code + 1) % 1000000).padStart(6, '0');
  const tryCode = (addr, c) => one(send(host.connection({ address: addr }), { t: 'pair', kind: 'code', v: 1, pub: ph.pub, proof: L.b64u(L.hmac(Buffer.from(c), 'sv-link-code|', ph.id.pub)) }));
  for (let i = 0; i < L.MAX_CODE_FAILS; i++) assert.strictEqual(tryCode('192.168.1.66', wrong).code, 'bad-code');
  assert.strictEqual(tryCode('192.168.1.66', code).code, 'too-many', 'kapanan adres doğru kodla da giremez');
  assert.strictEqual(tryCode('192.168.1.50', code).t, 'commit', 'gerçek telefon etkilenmez');
  assert.strictEqual(host.qrPayload(['h'], 1), qr);
  // Çok sayıda adresten yanlış: pencere sonunda yenilenir
  for (let i = 0; i < L.MAX_TOTAL_FAILS; i++) tryCode('10.0.' + i + '.1', wrong);
  assert.strictEqual(burned, 1);
  assert.notStrictEqual(host.qrPayload(['h'], 1), qr);
  const old = pairQr(host, phone(), qr);
  assert.strictEqual(old.r.code, 'bad-secret', 'eski QR işe yaramaz');
  assert.strictEqual(host.devices().length, 0);
});

test('Kodla eşleşme: taahhüt, açıklama, iki ekranda aynı sayı, onayla kayıt', () => {
  const ev = [];
  const host = L.createHost({ onEvent: (e) => ev.push(e) });
  const { code } = host.openPairing();
  const ph = phone('Galaxy Tab S9');
  const conn = host.connection();
  const c1 = one(send(conn, { t: 'pair', kind: 'code', v: 1, pub: ph.pub, name: ph.name, proof: L.b64u(L.hmac(Buffer.from(code), 'sv-link-code|', ph.id.pub)) }));
  assert.strictEqual(c1.t, 'commit');
  const np = crypto.randomBytes(16);
  const c2 = one(send(conn, { t: 'reveal', np: L.b64u(np) }));
  const pcPub = L.unb64u(c1.pub);
  const nc = L.unb64u(c2.nc);
  // Telefon taahhüdü doğrular: bilgisayar değerini sonradan değiştiremez
  assert.ok(L.hmac(nc, 'sv-link-commit|', pcPub, ph.id.pub).equals(L.unb64u(c1.commit)));
  const sas = ev.find((e) => e.type === 'sas');
  assert.strictEqual(sas.name, 'Galaxy Tab S9');
  assert.strictEqual(sas.digits, L.sasDigits(ph.id.pub, pcPub, np, nc), 'iki ekranda aynı altı rakam');
  assert.match(sas.digits, /^\d{6}$/);
  assert.strictEqual(host.devices().length, 0, 'onaydan önce kayıt yok');
  const done = one(conn.confirm(true));
  assert.strictEqual(done.t, 'paired');
  const devKey = L.deviceKey(L.sharedSecret(ph.id, pcPub), ph.id.pub, pcPub, np, nc);
  const s = phoneSession(devKey, np, nc);
  assert.deepStrictEqual(conn.decrypt(s.seal(Buffer.from('{"op":"blackout"}'))), { op: 'blackout' });
  assert.strictEqual(host.devices().length, 1);
});

test('Kodla eşleşme: yanlış kod, reddedilen sayı ve sırasız ileti kayıt açmaz', () => {
  const host = L.createHost({});
  const { code } = host.openPairing();
  const ph = phone();
  const wrong = String((+code + 1) % 1000000).padStart(6, '0');
  assert.strictEqual(one(send(host.connection(), { t: 'pair', kind: 'code', v: 1, pub: ph.pub, proof: L.b64u(L.hmac(Buffer.from(wrong), 'sv-link-code|', ph.id.pub)) })).code, 'bad-code');
  const conn = host.connection();
  send(conn, { t: 'pair', kind: 'code', v: 1, pub: ph.pub, proof: L.b64u(L.hmac(Buffer.from(code), 'sv-link-code|', ph.id.pub)) });
  send(conn, { t: 'reveal', np: L.b64u(crypto.randomBytes(16)) });
  assert.strictEqual(one(conn.confirm(false)).code, 'rejected');
  assert.strictEqual(host.devices().length, 0);
  // Taahhütten önce açıklama
  assert.strictEqual(one(send(host.connection(), { t: 'reveal', np: L.b64u(crypto.randomBytes(16)) })).code, 'bad-message');
  // Eğri dışı anahtar
  const bad = Buffer.alloc(65, 1); bad[0] = 4;
  assert.strictEqual(one(send(host.connection(), { t: 'pair', kind: 'code', v: 1, pub: L.b64u(bad), proof: 'AA' })).code, 'bad-message');
  // Sürüm farkı
  assert.strictEqual(one(send(host.connection(), { t: 'pair', kind: 'code', v: 2, pub: ph.pub, proof: 'AA' })).code, 'protocol');
});

test('Araya girme: saldırgan iki tarafla ayrı anahtar değişiminde aynı sayıyı tutturamaz', () => {
  /* Saldırgan telefonla bilgisayar arasında. Bilgisayara kendi anahtarıyla bağlanır (kodu
     telefondan dinleyerek öğrendiğini varsay) ve bilgisayarın sayısını öğrenir. Telefona da
     sahte bilgisayar olarak görünür; ama telefona kendi değerini, telefonun değerini görmeden
     önce taahhüt etmek zorunda. 2000 denemede tutan olmamalı (beklenen ~0,002). */
  let hits = 0;
  for (let i = 0; i < 2000; i++) {
    const realPc = L.newIdentity(), fakePc = L.newIdentity(), atkPhone = L.newIdentity();
    const ph = L.newIdentity();
    const npA = crypto.randomBytes(16), ncReal = crypto.randomBytes(16);
    const pcSees = L.sasDigits(atkPhone.pub, realPc.pub, npA, ncReal);
    const ncFake = crypto.randomBytes(16); // telefona taahhüt edildi
    const np = crypto.randomBytes(16);    // telefon ancak şimdi açıklar
    const phoneSees = L.sasDigits(ph.pub, fakePc.pub, np, ncFake);
    if (pcSees === phoneSees) hits++;
  }
  assert.ok(hits <= 2, 'tutan: ' + hits);
});

test('Yeniden bağlanma: kayıtlı cihaz yeni oturum anahtarı alır, bilinmeyen ve sahte kanıt reddedilir', () => {
  const saved = [];
  const host = L.createHost({ onChange: (d) => saved.push(d) });
  host.openPairing();
  const ph = phone();
  const { r, paired, np } = pairQr(host, ph, host.qrPayload(['h'], 1));
  r.device = paired.device;
  const pcPub = L.unb64u(r.pc.pub);
  const devKey = L.deviceKey(L.sharedSecret(ph.id, pcPub), ph.id.pub, pcPub, np, L.unb64u(r.nc));
  // Kayıt deposuna anahtar gidiyor (ana süreç onu şifreleyip yazar)
  assert.ok(saved.length && Buffer.isBuffer(saved[saved.length - 1][0].key));
  // Uygulama yeniden açıldı: depodan
  const host2 = L.createHost({ identity: host.identity, devices: saved[saved.length - 1] });
  const np2 = crypto.randomBytes(16);
  const conn = host2.connection();
  const w = one(send(conn, { t: 'resume', v: 1, device: r.device, np: L.b64u(np2), proof: L.b64u(L.hmac(devKey, 'sv-link-resume|phone|', np2)) }));
  assert.strictEqual(w.t, 'welcome');
  const nc2 = L.unb64u(w.nc);
  assert.ok(L.hmac(devKey, 'sv-link-resume|pc|', np2, nc2).equals(L.unb64u(w.proof)), 'telefon bilgisayarı doğrular');
  const s = phoneSession(devKey, np2, nc2);
  assert.deepStrictEqual(conn.decrypt(s.seal(Buffer.from('{"a":1}'))), { a: 1 });
  // Sahte kanıt, bilinmeyen cihaz
  assert.strictEqual(one(send(host2.connection(), { t: 'resume', v: 1, device: r.device, np: L.b64u(np2), proof: L.b64u(crypto.randomBytes(32)) })).code, 'unknown-device');
  assert.strictEqual(one(send(host2.connection(), { t: 'resume', v: 1, device: 'yok', np: L.b64u(np2), proof: 'AA' })).code, 'unknown-device');
  // Unutulan cihaz bağlanamaz, açık bağlantısı geri döner (kapatılsın diye)
  assert.strictEqual(host2.forget(r.device).length, 1);
  const np3 = crypto.randomBytes(16);
  assert.strictEqual(one(send(host2.connection(), { t: 'resume', v: 1, device: r.device, np: L.b64u(np3), proof: L.b64u(L.hmac(devKey, 'sv-link-resume|phone|', np3)) })).code, 'unknown-device');
});

test('Şifreli zarf: yeniden oynatma, değiştirilmiş kare, yanlış yön ve oturumsuz ileti atılır', () => {
  const key = crypto.randomBytes(32);
  const seal = L.sealer(key, 'c2p');
  const open = L.opener(key, 'c2p');
  const a = seal(Buffer.from('bir')), b = seal(Buffer.from('iki'));
  assert.strictEqual(open(b).toString(), 'iki');
  assert.strictEqual(open(a), null, 'eski sayaç');
  assert.strictEqual(open(b), null, 'aynı kare ikinci kez');
  const c = seal(Buffer.from('üç'));
  const t = Buffer.from(c); t[10] ^= 1;
  assert.strictEqual(open(t), null, 'değiştirilmiş');
  assert.strictEqual(open(c).toString(), 'üç', 'bozuk kare sayacı ilerletmez');
  // Aynı anahtar öbür yön için kullanılsa bile nonce öneki farklı: açılmaz
  assert.strictEqual(L.opener(key, 'p2c')(seal(Buffer.from('x'))), null);
  const host = L.createHost({});
  const conn = host.connection();
  assert.strictEqual(conn.decrypt(c), null);
  assert.strictEqual(conn.encrypt({}), null);
});

test('Zaman aşımı ve kapanma: el sıkışma süresi, kod süresi, kapanan bağlantı', () => {
  const ck = clock();
  const host = L.createHost({ now: ck.now });
  host.openPairing();
  const conn = host.connection();
  // Boşta bekleyen bağlantı da süresi dolunca düşürülür (hizmet expired'ı sorar)
  assert.strictEqual(host.expired(conn), false);
  ck.add(16000);
  assert.strictEqual(host.expired(conn), true);
  assert.strictEqual(one(send(conn, { t: 'resume', v: 1 })).code, 'timeout');
  ck.add(L.CODE_TTL_MS);
  assert.strictEqual(host.pairingInfo(), null);
  assert.strictEqual(host.qrPayload(['h'], 1), '');
  const c2 = host.connection();
  c2.close();
  assert.deepStrictEqual(send(c2, { t: 'resume', v: 1 }), []);
  assert.strictEqual(host.connections().length, 1);
});

test('İzin tablosu: düzeyler sıralı, bilinmeyen işlem ve güvenlik sınırı her düzeyde yok', () => {
  assert.ok(L.allowed('view', 'state.get'));
  assert.ok(!L.allowed('view', 'blackout'));
  assert.ok(L.allowed('control', 'timeline.transport'));
  assert.ok(!L.allowed('control', 'config.patch'));
  assert.ok(L.allowed('edit', 'config.patch'));
  assert.ok(!L.allowed('edit', 'output.open'));
  assert.ok(L.allowed('full', 'updates') && L.needsConfirm('updates'));
  for (const lv of L.LEVELS) {
    for (const op of ['file.read', 'token.get', 'link.settings', '__proto__', 'constructor', '']) assert.ok(!L.allowed(lv, op), lv + ' ' + op);
  }
  // Her işlemin düzeyi geçerli
  for (const [op, lv] of Object.entries(L.OPS)) assert.ok(L.LEVELS.indexOf(lv) >= 0, op);
  const host = L.createHost({});
  assert.strictEqual(host.setLevel('yok', 'full'), false);
});
