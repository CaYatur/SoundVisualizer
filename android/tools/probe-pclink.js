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
   açılınca kendiliğinden bağlanma; hedef PC: düzenleyicinin PC ayarını görmesi, Canlı sekmesinden
   karartma, sahne, anlık efekt ve T-bar'ın PC'deki ETKİSİ, telefondan ayar yazımı ve PC'deki
   değişikliğin telefona gelmesi, telefonun kendi ayarının değişmemesi, hedefin telefona dönmesi;
   bilgisayarda unutulan telefonun kaydını silmesi. */
const fs = require('fs');
const path = require('path');
const D = require('./lib/device.js');

const arg = (k, d) => { const a = process.argv.find((x) => x.startsWith('--' + k + '=')); return a ? a.split('=')[1] : d; };
const CDP = arg('cdp', '9341');
const PORT = arg('port', '8741');
// --soak=600: PC hedefi, akıcı önizleme ve Canlı sekmesi açıkken N saniye dayanıklılık turu
const SOAK = Number(arg('soak', '0'));
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

  // ---- Hedef PC (B2/B3): düzenleyici PC'nin ayarını görür, Canlı sekmesi PC'yi sürer
  const pcUntil = async (expr, want, ms) => {
    let v;
    for (let i = 0; i < (ms || 5000) / 150; i++) { v = await pc.ev(expr); if (JSON.stringify(v) === JSON.stringify(want)) return v; await sleep(150); }
    return v;
  };
  await pc.ev('(async () => { if (!window.SVPanel.scenes().length) await window.SVPanel.addStarterScenes(); return true; })()');
  await sleep(1000);
  const pcScenes = await pc.ev('window.SVPanel.scenes().map((s) => s.id)');
  const phoneMaster0 = await ev('(window.SVAndroid.config.local() || {}).master');
  const tg = await ev(`window.SVAndroid.target.set('pc')`);
  check('hedef PC', tg && tg.target === 'pc', tg);
  check('düzenleyici PC ayarını görüyor', JSON.stringify(await ev('window.SVAndroid.config.get().scenes.map((s) => s.id)')) === JSON.stringify(pcScenes), pcScenes.length);
  await sleep(600);
  check('hedef çipi PC adını gösteriyor', /\S/.test(await ev(`(document.querySelector('#sv-shell .target-chip .label') || {}).textContent || ''`)) && await ev(`!document.querySelector('#sv-shell .target-chip').hidden`));
  check('Canlı sekmesi görünüyor', await ev(`(() => { const b = document.querySelector('#sv-shell .nav [data-tab="live"]'); return !!b && !b.hidden; })()`));
  await ev(`(() => { document.querySelector('#sv-shell .nav [data-tab="live"]').click(); return 1; })()`);
  await sleep(900);
  check('Canlı: karartma düğmesi', await clickText('Karartma'));
  check('Canlı: PC karardı', (await pcUntil('window.SVPanel.isBlackedOut()', true)) === true);
  await sleep(500);
  check('Canlı: düğme PC\'nin durumunu gösteriyor', (await ev(`(document.querySelector('#sv-shell .blk') || {}).getAttribute('aria-pressed')`)) === 'true');
  await clickText('Karartma');
  check('Canlı: karartma kalktı', (await pcUntil('window.SVPanel.isBlackedOut()', false)) === false);
  // Sahneye dokun: hemen geç
  await ev(`(() => { localStorage.setItem('sv-live-tap', 'cut'); return 1; })()`);
  const target = pcScenes[2] || pcScenes[1];
  await ev(`(() => { document.querySelector('#sv-shell .lv-scene[data-id=' + JSON.stringify(${JSON.stringify(target)}) + ']').click(); return 1; })()`);
  check('Canlı: sahneye dokununca PC\'de canlı', (await pcUntil('window.SVPanel.activeSceneId()', target)) === target);
  // Sıraya al + Geç
  await ev(`(() => { localStorage.setItem('sv-live-tap', 'cue'); return 1; })()`);
  await ev(`(() => { document.querySelector('#sv-shell .lv-scene[data-id=' + JSON.stringify(${JSON.stringify(pcScenes[0])}) + ']').click(); return 1; })()`);
  check('Canlı: sıraya alındı', (await pcUntil('window.SVLiveShell.cue()', pcScenes[0])) === pcScenes[0]);
  check('Canlı: Geç', await clickText('Geç'));
  check('Canlı: sıradaki canlıya geçti', (await pcUntil('window.SVPanel.activeSceneId()', pcScenes[0])) === pcScenes[0]);
  // ÖLÇÜM: istek gecikmesi (telefon → PC → telefon), sayfa ↔ uygulama ve önizleme kapalıyken
  const rtts = await ev(`(async () => { const out = []; for (let i = 0; i < 8; i++) { const t = performance.now(); await window.SVAndroid.pc.request('state.get'); out.push(Math.round(performance.now() - t)); await new Promise((r) => setTimeout(r, 250)); } return out; })()`);
  console.log('     tanı rtt (akıcı):', JSON.stringify(rtts));
  const local = await ev(`(async () => { const out = []; for (let i = 0; i < 8; i++) { const t = performance.now(); await window.SVAndroid.link.status(); out.push(Math.round(performance.now() - t)); await new Promise((r) => setTimeout(r, 250)); } return out; })()`);
  console.log('     tanı sayfa↔uygulama:', JSON.stringify(local));
  await ev(`window.SVAndroid.pc.preview('off')`);
  await sleep(500);
  const rttOff = await ev(`(async () => { const out = []; for (let i = 0; i < 8; i++) { const t = performance.now(); await window.SVAndroid.pc.request('state.get'); out.push(Math.round(performance.now() - t)); await new Promise((r) => setTimeout(r, 250)); } return out; })()`);
  console.log('     tanı rtt (önizleme kapalı):', JSON.stringify(rttOff));
  await ev(`window.SVAndroid.pc.preview('smooth')`);
  // Anlık efekt basılı tut / bırak
  await ev(`(() => { const b = document.querySelector('#sv-shell .lv-fx [data-fx="strobe"]'); b.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, pointerId: 7 })); return 1; })()`);
  check('Canlı: basılı efekt PC çıkışında', JSON.stringify(await pcUntil('window.SVLiveShell.heldList()', ['strobe'])) === '["strobe"]');
  // Basılıyken PC'deki liste 2,2 sn boyunca hiç boşalmamalı (kira 1,5 sn; telefon 0,5 sn'de bir yeniler)
  const samples = [];
  for (let i = 0; i < 11; i++) { await sleep(200); samples.push(JSON.stringify(await pc.ev('window.SVLiveShell.heldList()'))); }
  check('Canlı: basılıyken kira yenileniyor (efekt düşmedi)', samples.every((x) => x === '["strobe"]'), samples);
  await ev(`(() => { const b = document.querySelector('#sv-shell .lv-fx [data-fx="strobe"]'); b.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, pointerId: 7 })); return 1; })()`);
  check('Canlı: bırakınca kalktı', JSON.stringify(await pcUntil('window.SVLiveShell.heldList()', [])) === '[]');
  // Düzenleme: telefonun yazımı PC'ye, PC'nin değişikliği telefona
  await ev(`(() => { const c = window.SVAndroid.config.get(); window.SVAndroid.config.set(Object.assign({}, c, { master: 0.6 })); return 1; })()`);
  check('düzenleme: telefondan yazılan PC\'de', (await pcUntil('window.SVPanel.cfg().master', 0.6)) === 0.6);
  check('düzenleme: telefonun kendi ayarı değişmedi', (await ev('(window.SVAndroid.config.local() || {}).master')) === phoneMaster0);
  await pc.ev('(() => { window.SVPanel.cfg().master = 0.35; window.SVPanel.push(true); return 1; })()');
  let mm = null;
  for (let i = 0; i < 30 && mm !== 0.35; i++) { mm = await ev('window.SVAndroid.config.get().master'); if (mm !== 0.35) await sleep(150); }
  check('düzenleme: PC\'deki değişiklik telefona geldi', mm === 0.35, mm);
  if (mm !== 0.35) console.log('     tanı:', JSON.stringify(await ev('window.SVAndroid.pc.debug()')));
  await pc.ev('(() => { window.SVPanel.cfg().master = 1; window.SVPanel.push(true); return 1; })()');
  // ---- Ses ve önizleme (B4/B5)
  // Akıcı önizleme (varsayılan): sayfa PC'nin sesini alır
  await ev(`window.SVAndroid.pc.preview('smooth')`);
  let src = null;
  for (let i = 0; i < 30 && src !== 'pc'; i++) { await sleep(200); src = await ev('(window.__svHost.audioStats() || {}).source'); }
  check('akıcı önizleme: sayfanın sesi PC\'den', src === 'pc', src);
  // Gerçek görüntü: PC'nin karesi sahnenin üstünde
  await ev(`window.SVAndroid.pc.preview('image')`);
  let shot = false;
  for (let i = 0; i < 40 && !shot; i++) { await sleep(250); shot = await ev(`(() => { const im = document.querySelector('#sv-shell .pc-shot'); return !!im && !im.hidden && (im.src || '').startsWith('data:image/jpeg'); })()`); }
  check('gerçek görüntü: PC karesi gösteriliyor', shot);
  await ev(`window.SVAndroid.pc.preview('smooth')`);
  check('akıcıya dönünce kare kalktı', await ev(`document.querySelector('#sv-shell .pc-shot').hidden`));
  // PC'ye gönder: telefonun mikrofonu PC'nin girişi; akıcı kip telefonun kendi sesine döner
  await ev(`window.SVAndroid.audio.start ? window.SVAndroid.audio.start('mic') : window.__svHost.audioStart('mic')`);
  await ev(`window.SVAndroid.pc.audioSend(true)`);
  const pcIn = async () => ((await pcStatus()).audioIn || {});
  let ai = {};
  for (let i = 0; i < 40 && ai.state !== 'bridge'; i++) { await sleep(250); ai = await pcIn(); }
  check('PC\'ye gönder: PC girişi telefonda', ai.state === 'bridge' && ai.stats && ai.stats.frames > 3, ai);
  src = await ev('(window.__svHost.audioStats() || {}).source');
  check('gönderirken sayfa telefonun kendi sesini kullanıyor', src === 'mic', src);
  await ev(`window.SVAndroid.pc.audioSend(false)`);
  for (let i = 0; i < 20 && ai.enabled; i++) { await sleep(250); ai = await pcIn(); }
  check('PC\'ye gönder kapandı', ai.enabled === false, ai);
  await ev(`window.SVAndroid.audio.stop ? window.SVAndroid.audio.stop() : window.__svHost.audioStop()`);

  // ---- Dayanıklılık (--soak): sürekli canlı işlem, PC'de ayar değişikliği; bellek, WebGL bağlamı,
  // bağlantı ve olay sırası düzenli örneklenir. Sızıntı ya da kopma olursa hata.
  if (SOAK > 0) {
    await ev(`window.SVAndroid.target.set('pc')`);
    await ev(`window.SVAndroid.pc.preview('smooth')`);
    await ev(`(() => { document.querySelector('#sv-shell .nav [data-tab="live"]').click(); return 1; })()`);
    const memOf = () => {
      try {
        const out = D.adb(['shell', 'dumpsys', 'meminfo', D.PKG]).toString();
        const m = /TOTAL PSS:\s*(\d+)/.exec(out) || /TOTAL\s+(\d+)/.exec(out);
        return m ? Math.round(Number(m[1]) / 1024) : 0;
      } catch (e) { return 0; }
    };
    const sample = async () => Object.assign(await ev(`(() => ({ heap: performance.memory ? Math.round(performance.memory.usedJSHeapSize / 1048576) : 0, gl: (window.__svHost.glContexts() || {}).active, link: window.SVAndroid.target.get().state, rev: window.SVAndroid.pc.debug().rev, dom: document.getElementsByTagName('*').length }))()`), { pssMB: memOf() });
    const series = [await sample()];
    const t0 = Date.now();
    let ops = 0;
    let errs = 0;
    const scenesNow = await pc.ev('window.SVPanel.scenes().map((s) => s.id)');
    while (Date.now() - t0 < SOAK * 1000) {
      const k = ops % 6;
      const r = await ev(`(async () => { const P = window.SVAndroid.pc; const k = ${k}; const ids = ${JSON.stringify(scenesNow)};
        if (k === 0) return P.request('scene.apply', { id: ids[Math.floor(Math.random() * ids.length)] });
        if (k === 1) return P.request('tbar', { v: Math.random() });
        if (k === 2) { await P.hold(['flash']); await new Promise((x) => setTimeout(x, 300)); return P.hold([]); }
        if (k === 3) return P.request('macro.set', { i: 0, v: Math.random() });
        if (k === 4) return P.request('blackout', { on: false });
        const c = window.SVAndroid.config.get(); window.SVAndroid.config.set(Object.assign({}, c, { master: 0.5 + Math.random() / 2 })); return { ok: true };
      })()`);
      if (r && r.ok === false && r.error !== 'rate') errs++;
      ops++;
      if (ops % 25 === 0) await pc.ev(`(() => { const c = window.SVPanel.cfg(); c.master = 1; window.SVPanel.push(true); return 1; })()`);
      if (ops % 60 === 0) series.push(await sample());
      await sleep(250);
    }
    series.push(await sample());
    console.log('     dayanıklılık:', SOAK + ' sn, ' + ops + ' işlem, ' + errs + ' hata;', JSON.stringify(series));
    const first = series[1] || series[0];
    const last = series[series.length - 1];
    check('dayanıklılık: bağlantı koptu mu', series.every((x) => x.link === 'connected'), series.map((x) => x.link));
    check('dayanıklılık: işlem hatası yok', errs === 0, errs);
    check('dayanıklılık: WebGL bağlamı birikmiyor', last.gl <= first.gl + 1, series.map((x) => x.gl));
    check('dayanıklılık: JS yığını büyümüyor (+%50 altı)', !first.heap || last.heap <= first.heap * 1.5 + 8, series.map((x) => x.heap));
    check('dayanıklılık: DOM öğesi birikmiyor', last.dom <= first.dom * 1.2 + 50, series.map((x) => x.dom));
    check('dayanıklılık: uygulama belleği büyümüyor (+%40 altı)', !first.pssMB || last.pssMB <= first.pssMB * 1.4, series.map((x) => x.pssMB));
    await ev('window.SVShell.close && window.SVShell.close()');
  }

  // ---- Plan §4.4: telefon PC'nin tanımadığı ve masaüstüne özgü katmanlarına dokunmaz
  await pc.ev(`(() => { const c = window.SVPanel.cfg();
    c.layers = (c.layers || []).concat([
      { id: 'l_probe_web', kind: 'web', name: 'Web', enabled: true, opacity: 1, settings: { web: { url: 'https://example.org/', zoom: 1 } } },
      { id: 'l_probe_in', kind: 'input', name: 'Giriş', enabled: true, opacity: 0.8, settings: { input: { source: 'spout', name: 'Resolume' } } },
      { id: 'l_probe_new', kind: 'gelecek', name: 'Yeni tür', enabled: true, opacity: 1, settings: { gelecek: { a: [1, 2, { b: 'c' }] } }, extra: { x: 1 } },
    ]);
    window.SVPanel.push(true); return 1; })()`);
  await sleep(900);
  const special = (c) => JSON.stringify((c.layers || []).filter((l) => /^l_probe_/.test(l.id)));
  const before = await pc.ev('(' + special.toString() + ')(window.SVPanel.cfg())');
  check('PC\'de özel katmanlar kuruldu', before.indexOf('l_probe_new') >= 0 && before.indexOf('l_probe_web') >= 0, before.length);
  await ev(`window.SVAndroid.target.set('pc')`);
  await sleep(800);
  await ev(`(() => { window.SVShell.open('layers'); return 1; })()`);
  await sleep(1200);
  // Telefonun gerçek katman düzenleyicisi: bir görselleştirici katmanını gizle (göz düğmesi)
  // Telefonda gerçekten satırı olan (grup içinde olmayan) bir görselleştirici katmanı seç
  const rowIds = await ev(`[...document.querySelectorAll('#sv-shell .row[data-id]')].map((r) => r.dataset.id)`);
  const visId = await pc.ev(`(window.SVPanel.cfg().layers.find((l) => l.kind === 'visualizer' && !/^l_probe_/.test(l.id) && !l.locked && ${JSON.stringify(rowIds)}.indexOf(l.id) >= 0) || {}).id || ''`);
  const was = await pc.ev(`(window.SVPanel.cfg().layers.find((l) => l.id === ${JSON.stringify(visId)}) || {}).enabled !== false`);
  const clicked = await ev(`(() => { const row = document.querySelector('#sv-shell .row[data-id=' + JSON.stringify(${JSON.stringify(visId)}) + ']'); const b = row && row.querySelector('.iconbtn'); if (!b) return false; b.click(); return true; })()`);
  check('katman düzenleyicisi PC katmanını gösteriyor ve göz düğmesi çalışıyor', clicked, visId);
  const now = await pcUntil(`(window.SVPanel.cfg().layers.find((l) => l.id === ${JSON.stringify(visId)}) || {}).enabled !== false`, !was, 6000);
  check('PC\'de katman gizlendi', now === !was, { was, now });
  const after = await pc.ev('(' + special.toString() + ')(window.SVPanel.cfg())');
  check('tanınmayan ve masaüstüne özgü katmanlar bayt bayt aynı', after === before, { before: before.length, after: after.length });
  await ev(`(() => { const row = document.querySelector('#sv-shell .row[data-id=' + JSON.stringify(${JSON.stringify(visId)}) + ']'); const b = row && row.querySelector('.iconbtn'); if (b) b.click(); return 1; })()`);
  await sleep(800);
  await ev('window.SVShell.close && window.SVShell.close()');
  await pc.ev(`(() => { const c = window.SVPanel.cfg(); c.layers = c.layers.filter((l) => !/^l_probe_/.test(l.id)); window.SVPanel.push(true); return 1; })()`);

  // ---- PC Ayarları sayfası: ekran listesi, MilkDrop araması, ses aygıtları
  await ev(`(() => { window.SVShell.openPage(window.SVShellPcManage.page()); return 1; })()`);
  let pm = '';
  for (let i = 0; i < 30; i++) { await sleep(300); pm = await ev(`(document.querySelector('#sv-shell .sheet-body') || {}).textContent || ''`); if (pm.indexOf(await T('Yüzen pencere')) >= 0 && pm.indexOf(await T('Sistem sesi (varsayılan)')) >= 0) break; }
  check('PC Ayarları: çıkışlar ve ses girişi yüklendi', pm.indexOf(await T('Yüzen pencere')) >= 0 && pm.indexOf(await T('Sistem sesi (varsayılan)')) >= 0, pm.slice(0, 120));
  await ev('window.SVShell.close && window.SVShell.close()');

  // ---- Telefon hedefindeyken PC sesini kullan
  await ev(`window.SVAndroid.target.set('phone')`);
  await ev(`window.SVAndroid.pc.usePcAudio(true)`);
  let src2 = null;
  for (let i = 0; i < 30 && src2 !== 'pc'; i++) { await sleep(200); src2 = await ev('(window.__svHost.audioStats() || {}).source'); }
  check('telefon hedefinde "PC\'nin sesini kullan"', src2 === 'pc', src2);
  await ev(`window.SVAndroid.pc.usePcAudio(false)`);
  await ev(`window.SVAndroid.target.set('pc')`);

  const back = await ev(`window.SVAndroid.target.set('phone')`);
  check('hedef telefona döndü, telefonun ayarı', back.target === 'phone' && (await ev('window.SVAndroid.config.get().master')) === phoneMaster0 && await ev(`document.querySelector('#sv-shell .nav [data-tab="live"]').hidden`));
  await ev('window.SVShell.close && window.SVShell.close()');

  // ---- Bilgisayarda unutulan telefon kaydını siler
  await pc.ev(`window.api.phoneLinkForgetAll()`);
  const s6 = await waitState(['error', 'idle'], 30000);
  check('unutulunca telefon kaydı silindi', (s6.saved || []).length === 0 && (s6.error === 'unknown-device' || s6.state === 'idle'), s6);

  page.close();
  pc.close();
  console.log(bad ? 'SONUÇ: ' + bad + ' hata' : 'SONUÇ: hepsi geçti');
  process.exit(bad ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(2); });
