#!/usr/bin/env node
/*
 * SoundVisualizer — CaYaDev Ses Görselleştirici
 * Copyright (c) 2026 Çağan Turgut (CaYatur) — CaYaDev, https://cayadev.com
 * https://github.com/CaYatur/SoundVisualizer
 * SPDX-License-Identifier: MIT
 */
'use strict';
/* PC bağlantısı eşlik örnekleri: masaüstünün kendi kodu (src/main/phone-link.js) sabit
   anahtar ve rastgele değerlerle çalıştırılır, sonuç Kotlin birim testine yazılır
   (android/app/src/test/resources/link-vectors.json). Kotlin aynı girdiden aynı baytları
   bulmalı. Yeniden üretmek: node android/tools/link-vectors.js */
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const L = require('../../src/main/phone-link.js');

const hex = (b) => Buffer.from(b).toString('hex');
const fixed = (seed) => crypto.createHash('sha256').update(seed).digest();
function ident(seed) {
  const k = fixed(seed); k[0] &= 0x7f;
  const e = crypto.createECDH('prime256v1');
  e.setPrivateKey(k);
  return { priv: e.getPrivateKey(), pub: e.getPublicKey() };
}

const pc = ident('sv-link-vector-pc');
const ph = ident('sv-link-vector-phone');
const np = fixed('np').subarray(0, 16);
const nc = fixed('nc').subarray(0, 16);
const secret = fixed('qr-secret');
const code = '583104';
const shared = L.sharedSecret(ph, pc.pub);
const devKey = L.deviceKey(shared, ph.pub, pc.pub, np, nc);
const k = L.sessionKeys(devKey, np, nc);
const c2p = L.sealer(k.c2p, 'c2p');
const p2c = L.sealer(k.p2c, 'p2c');
const plain = Buffer.from(JSON.stringify({ id: 1, op: 'state.get' }));
c2p(Buffer.from('ilk')); // sayaç 2'den sınansın
const out = {
  pcPriv: hex(pc.priv), pcPub: hex(pc.pub), phPriv: hex(ph.priv), phPub: hex(ph.pub),
  np: hex(np), nc: hex(nc), secret: hex(secret), code,
  shared: hex(shared),
  fingerprint: L.b64u(L.fingerprint(pc.pub)),
  sas: L.sasDigits(ph.pub, pc.pub, np, nc),
  devKey: hex(devKey), c2p: hex(k.c2p), p2c: hex(k.p2c),
  qrPhoneMac: hex(L.hmac(secret, 'sv-link-qr|phone|', ph.pub, np)),
  qrPcMac: hex(L.hmac(secret, 'sv-link-qr|pc|', pc.pub, nc, ph.pub)),
  codeProof: hex(L.hmac(Buffer.from(code), 'sv-link-code|', ph.pub)),
  commit: hex(L.hmac(nc, 'sv-link-commit|', pc.pub, ph.pub)),
  resumeProof: hex(L.hmac(devKey, 'sv-link-resume|phone|', np)),
  welcomeProof: hex(L.hmac(devKey, 'sv-link-resume|pc|', np, nc)),
  plain: plain.toString(),
  sealedC2pCtr2: hex(c2p(plain)),
  sealedP2cCtr1: hex(p2c(Buffer.from('{"re":"1","ok":true}'))),
  hkdfLong: hex(Buffer.from(crypto.hkdfSync('sha256', devKey, np, Buffer.from('uzun'), 80))),
};
const file = path.join(__dirname, '..', 'app', 'src', 'test', 'resources', 'link-vectors.json');
fs.mkdirSync(path.dirname(file), { recursive: true });
fs.writeFileSync(file, JSON.stringify(out, null, 2) + '\n');
console.log('yazıldı:', path.relative(process.cwd(), file));
