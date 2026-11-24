#!/usr/bin/env node
/*
 * SoundVisualizer — CaYaDev Ses Görselleştirici
 * Copyright (c) 2026 Çağan Turgut (CaYatur) — CaYaDev, https://cayadev.com
 * https://github.com/CaYatur/SoundVisualizer
 * SPDX-License-Identifier: MIT
 */
'use strict';
/* PC BAĞLANTISI UÇTAN UCA (docs/PHONE-LINK.md): emülatördeki uygulama ↔ aynı makinede açık
   masaüstü uygulaması. Emülatör bilgisayara 10.0.2.2'den ulaşır, masaüstü yalnız 127.0.0.1'i
   dinleyebilir (SV_LISTEN_LOOPBACK=1, güvenlik duvarı sormaz).

   Önce masaüstünü yalıtılmış profille aç (kullanıcının verisine dokunmaz):
     settings.json: {"phoneLink":{"enabled":true,"discoverable":false},"stream":{"enabled":false,"port":8741}}
     SV_LISTEN_LOOPBACK=1 node scripts/start.js --user-data-dir=<boş klasör> --remote-debugging-port=9341
   Sonra: node android/tools/probe-pclink.js --cdp=9341 --port=8741

   Denetlenen: kodla eşleşme ve iki ekranda aynı sayı, bilgisayardaki onay, şifreli istek
   (state.get), QR karesinin uygulamada çözülmesi ve QR ile eşleşme (onaylı), uygulama yeniden
   açılınca kendiliğinden bağlanma, bilgisayarda unutulan telefonun kaydını silmesi. */
const fs = require('fs');
const path = require('path');
const D = require('./lib/device.js');

const arg = (k, d) => { const a = process.argv.find((x) => x.startsWith('--' + k + '=')); return a ? a.split('=')[1] : d; };
const CDP = arg('cdp', '9341');
const PORT = arg('port', '8741');
const root = path.join(__dirname, '..', '..');
let bad = 0;
const check = (n, ok, d) => { if (!ok) bad++; console.log((ok ? 'OK   ' : 'FAIL ') + n + '  ' + JSON.stringify(d === undefined ? '' : d).slice(0, 300)); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
// Soğuk emülatörde açılış 10 sn'yi geçebiliyor (SwiftShader): soket gelene kadar bekle
async function open() {
  try { return await D.connect(await D.launch()); } catch (e) {
    for (let i = 0; i < 60; i++) { await sleep(500); try { return await D.connect(); } catch { /* henüz yok */ } }
    throw e;
  }
}

// Masaüstü paneli (CDP)
async function desktop() {
  const list = await (await fetch('http://127.0.0.1:' + CDP + '/json/list')).json();
  const t = list.find((x) => /admin\/index\.html/.test(x.url));
  const ws = new WebSocket(t.webSocketDebuggerUrl);
  await new Promise((r) => ws.addEventListener('open', r));
  let id = 0;
  const ev = (expr) => new Promise((res) => {
    const my = ++id;
    const on = (e) => { const m = JSON.parse(e.data); if (m.id === my) { ws.removeEventListener('message', on); res(m.result && m.result.result ? m.result.result.value : null); } };
    ws.addEventListener('message', on);
    ws.send(JSON.stringify({ id: my, method: 'Runtime.evaluate', params: { expression: expr, awaitPromise: true, returnByValue: true } }));
  });
  return { ev, close: () => ws.close() };
}

(async () => {
  const pc = await desktop();
  const newCode = () => pc.ev('window.api.phoneLinkNewCode().then((s) => ({ code: s.pairing.code, qr: s.pairing.qr }))');
  const pcStatus = () => pc.ev('window.api.phoneLinkStatus()');
  // Önceki koşudan kalan cihazlar
  await pc.ev('window.api.phoneLinkForgetAll()');

  D.adb(['shell', 'pm', 'clear', D.PKG]);
  for (const p of ['android.permission.CAMERA', 'android.permission.RECORD_AUDIO', 'android.permission.POST_NOTIFICATIONS']) D.adb(['shell', 'pm', 'grant', D.PKG, p]);
  let page = await open();
  let ev = (js) => page.evaluate(js);
  const ready = async () => { for (let i = 0; i < 100 && !(await ev('!!(window.SVShell && window.SVShell.state().ready)')); i++) await sleep(200); await sleep(600); };
  await ready();
  const linkState = () => ev('window.SVAndroid.link.status()');
  const waitState = async (want, ms) => {
    let s = null;
    for (let i = 0; i < (ms || 20000) / 250; i++) { s = await linkState(); if (want.indexOf(s.state) >= 0) return s; await sleep(250); }
    return s;
  };

  // ---- Kodla eşleşme, arayüzden
  const { code } = await newCode();
  await ev(`(() => { window.SVShell.open('settings'); return 1; })()`);
  await sleep(700);
  const T = (s) => ev(`window.SVI18n.t(${JSON.stringify(s)})`);
  const clickText = async (s) => ev(`(() => { const t = ${JSON.stringify(await T(s))}; const b = [...document.querySelectorAll('#sv-shell button')].find((x) => x.textContent.trim().indexOf(t) >= 0); if (!b) return false; b.click(); return true; })()`);
  check('Ayarlar → PC\'ye Bağlan satırı', await clickText("PC'ye Bağlan"));
  await sleep(700);
  check('Adres ve Kodla', await clickText('Adres ve Kodla'));
  await sleep(500);
  await ev(`(() => { const ins = [...document.querySelectorAll('#sv-shell .sheet-body input.field')]; const set = (i, v) => { ins[i].value = v; ins[i].dispatchEvent(new Event('input', { bubbles: true })); }; set(0, '10.0.2.2'); set(1, ${JSON.stringify(PORT)}); set(2, ${JSON.stringify(code.slice(0, 3) + ' ' + code.slice(3))}); return ins.length; })()`);
  check('Bağlan', await clickText('Bağlan'));
  const s1 = await waitState(['sas', 'error'], 15000);
  check('telefon sayı karşılaştırmasında', s1.state === 'sas' && /^\d{6}$/.test(s1.digits || ''), s1);
  await sleep(600);
  const phoneDigits = await ev(`(document.querySelector('#sv-shell .link-digits') || {}).textContent || ''`);
  const pend = (await pcStatus()).pending;
  check('iki ekranda aynı sayı', pend.length === 1 && pend[0].digits === s1.digits && phoneDigits.replace(/\s/g, '') === s1.digits, { phone: phoneDigits, pc: pend[0] && pend[0].digits });
  check('bilgisayar telefonun adını görüyor', pend[0] && !!pend[0].name, pend[0]);
  await pc.ev(`window.api.phoneLinkConfirm(${pend[0].no}, true)`);
  const s2 = await waitState(['connected', 'error'], 15000);
  check('onaydan sonra bağlı, tam erişim', s2.state === 'connected' && s2.level === 'full', s2);
  const r = await ev(`window.SVAndroid.link.request('state.get', {})`);
  check('şifreli istek yanıtı (state.get)', r && r.ok === true && Array.isArray(r.result.scenes), r);
  const denied = await ev(`window.SVAndroid.link.request('file.read', {})`);
  check('izinsiz işlem reddedilir', denied && denied.ok === false && denied.error === 'not-allowed', denied);
  await sleep(800);
  const banner = await ev(`(document.querySelector('#sv-shell .banner.ok') || {}).textContent || ''`);
  check('sayfada bağlı bilgisi', banner.indexOf(await T('Bağlı')) >= 0, banner);
  const devs = (await pcStatus()).devices;
  check('bilgisayarda cihaz çevrimiçi', devs.length === 1 && devs[0].online && devs[0].level === 'full', devs);

  // ---- Uygulama yeniden açılınca kendiliğinden bağlanır
  page.close();
  D.adb(['shell', 'am', 'force-stop', D.PKG]);
  await sleep(800);
  page = await open();
  ev = (js) => page.evaluate(js);
  await ready();
  const s3 = await waitState(['connected'], 20000);
  check('yeniden açılışta kendiliğinden bağlandı', s3.state === 'connected', s3);

  // ---- QR: kare uygulamada çözülür, eşleşme yine onay ister
  await ev(`window.SVAndroid.link.disconnect()`);
  const { qr } = await newCode();
  await ev(fs.readFileSync(path.join(root, 'src/shared/qr.js'), 'utf8') + ';1');
  const decoded = await ev(`(() => {
    const q = window.SVQr.encode(${JSON.stringify(qr)}, { ecc: 'L' });
    const s = 5, quiet = 6, n = (q.size + quiet * 2) * s;
    const g = new Uint8Array(n * n).fill(235);
    for (let y = 0; y < q.size; y++) for (let x = 0; x < q.size; x++) if (q.modules[y][x])
      for (let dy = 0; dy < s; dy++) for (let dx = 0; dx < s; dx++) g[((y + quiet) * s + dy) * n + (x + quiet) * s + dx] = 25;
    let bin = ''; for (let i = 0; i < g.length; i += 0x8000) bin += String.fromCharCode.apply(null, g.subarray(i, i + 0x8000));
    return window.SVAndroid.link.qrFrame(n, n, btoa(bin));
  })()`);
  check('QR karesi uygulamada çözüldü', decoded === qr, (decoded || '').slice(0, 60));
  const qrBefore = (await pcStatus()).devices.length;
  /* QR bilgisayarın gerçek ağ adreslerini taşır; sınamada masaüstü yalnız 127.0.0.1'i dinliyor,
     emülatör ona 10.0.2.2'den ulaşır. Eşleşmede adres buna çevrilir (sır ve parmak izi aynı). */
  const emuQr = decoded.replace(/h=[^&]*&/g, '').replace('svlink://1?', 'svlink://1?h=10.0.2.2&');
  await ev(`window.SVAndroid.link.pairQr(${JSON.stringify(emuQr)})`);
  const s4 = await waitState(['approve', 'error'], 15000);
  const pend2 = (await pcStatus()).pending;
  check('QR: telefon bilgisayarı doğruladı, onay bekliyor', s4.state === 'approve' && pend2.length === 1 && pend2[0].digits === s4.digits, { s4, pend2 });
  check('QR: onaydan önce yeni kayıt yok', (await pcStatus()).devices.length === qrBefore);
  await pc.ev(`window.api.phoneLinkConfirm(${pend2[0].no}, true)`);
  const s5 = await waitState(['connected', 'error'], 15000);
  check('QR: onaydan sonra bağlı', s5.state === 'connected', s5);

  // ---- Bilgisayarda unutulan telefon kaydını siler
  await pc.ev(`window.api.phoneLinkForgetAll()`);
  const s6 = await waitState(['error', 'idle'], 30000);
  check('unutulunca telefon kaydı silindi', (s6.saved || []).length === 0 && (s6.error === 'unknown-device' || s6.state === 'idle'), s6);

  page.close();
  pc.close();
  console.log(bad ? 'SONUÇ: ' + bad + ' hata' : 'SONUÇ: hepsi geçti');
  process.exit(bad ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(2); });
