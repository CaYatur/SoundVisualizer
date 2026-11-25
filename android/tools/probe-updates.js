#!/usr/bin/env node
/*
 * SoundVisualizer — CaYaDev Ses Görselleştirici
 * Copyright (c) 2026 Çağan Turgut (CaYatur) — CaYaDev, https://cayadev.com
 * https://github.com/CaYatur/SoundVisualizer
 * SPDX-License-Identifier: MIT
 */
'use strict';
/* YENİ SÜRÜM UYARISI UÇTAN UCA (docs/android/HOST.md, PLAN D13): emülatördeki geliştirme
   sürümünde. Gerçek bir Android sürümü henüz yok: GitHub yanıtı uygulamanın yalnız geliştirme
   sürümündeki kancasıyla (debugUpdateFeed) verilir; ağdaki gerçek istek ayrıca bir kez denenir
   (--no-net ile atlanır).

   Denetlenen: ilk durum, elle denetim ve "yeni sürüm var" (gezinmede nokta, bildirim, Ayarlar'da
   şerit, bölüm, sürüm notu, APK boyutu), yeniden açılışta kalıcılık ve bildirimin tekrarlanmaması,
   sürümü atlama ve daha yeni sürümde uyarının geri gelmesi, kip kapalıyken kendiliğinden denetimin
   ağa çıkmaması, "henüz Android sürümü yok", GitHub sınırı (403) ve önceki sonucun korunması,
   masaüstü sürümlerinin sayılmaması, sürüm sayfasının tarayıcıda açılması, İngilizce arayüz.
   Kullanım: node android/tools/probe-updates.js [--no-net] [--shots=<klasör>] */
const fs = require('fs');
const path = require('path');
const D = require('./lib/device.js');

const flag = (k) => process.argv.includes('--' + k);
const arg = (k, d) => { const a = process.argv.find((x) => x.startsWith('--' + k + '=')); return a ? a.split('=')[1] : d; };
const SHOTS = arg('shots', '');
let bad = 0;
const check = (n, ok, d) => { if (!ok) bad++; console.log((ok ? 'OK   ' : 'FAIL ') + n + '  ' + JSON.stringify(d === undefined ? '' : d).slice(0, 300)); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function open() {
  try { return await D.connect(await D.launch()); } catch (e) {
    for (let i = 0; i < 60; i++) { await sleep(500); try { return await D.connect(); } catch { /* henüz yok */ } }
    throw e;
  }
}
const rel = (tag, o) => Object.assign({
  tag_name: tag, name: 'SoundVisualizer ' + tag, draft: false, prerelease: false, published_at: '2026-12-01T10:00:00Z',
  html_url: 'https://github.com/CaYatur/SoundVisualizer/releases/tag/' + tag, body: '', assets: [],
}, o || {});
const FEED_91 = JSON.stringify([
  rel('v9.9.9'),
  rel('android-v9.2.0', { draft: true }),
  rel('android-v9.1.0', { body: '## Yenilikler\n\n- **PC bağlantısı** QR ile\n- Güncelleme uyarısı', assets: [{ name: 'SoundVisualizer-android-9.1.0.apk', size: 19237558 }] }),
  rel('android-v1.0.0'),
]);
const FEED_92 = JSON.stringify([rel('android-v9.2.0', { body: 'Düzeltmeler' }), rel('android-v9.1.0')]);
const FEED_DESKTOP = JSON.stringify([rel('v4.0.0'), rel('v3.1.7')]);

(async () => {
  D.adb(['shell', 'pm', 'clear', D.PKG]);
  for (const p of ['android.permission.RECORD_AUDIO', 'android.permission.POST_NOTIFICATIONS']) D.adb(['shell', 'pm', 'grant', D.PKG, p]);
  let page = await open();
  let ev = (js) => page.evaluate(js);
  const feed = (o) => ev(`window.__svHost.request('debugUpdateFeed', ${JSON.stringify(o)})`);
  // Kendiliğinden denetim açılıştan 15 sn sonra: sahte yanıt ondan önce kurulur
  await feed({ reset: true, code: 200, body: FEED_91 });
  const ready = async () => { for (let i = 0; i < 100 && !(await ev('!!(window.SVShell && window.SVShell.state().ready)')); i++) await sleep(200); await sleep(600); };
  await ready();
  const T = (s) => ev(`window.SVI18n.t(${JSON.stringify(s)})`);
  const shellText = () => ev(`document.querySelector('#sv-shell').innerText`);
  const dot = () => ev(`!!document.querySelector('#sv-shell .nav [data-tab="settings"].has-dot')`);
  const toastText = () => ev(`(() => { const t = document.querySelector('#sv-shell .toast'); return t && !t.hidden ? t.textContent : ''; })()`);
  const clickText = async (s) => ev(`(() => { const t = ${JSON.stringify(await T(s))}; const b = [...document.querySelectorAll('#sv-shell button')].find((x) => x.textContent.trim().indexOf(t) >= 0); if (!b) return false; b.click(); return true; })()`);
  const openSettings = async () => { await ev(`(() => { window.SVShell.close(); window.SVShell.open('settings'); return 1; })()`); await sleep(800); };
  const shot = (n) => { if (SHOTS) { fs.mkdirSync(SHOTS, { recursive: true }); fs.writeFileSync(path.join(SHOTS, n + '.png'), D.screencap()); } };
  const st = () => ev('window.SVAndroid.updates.state()');

  // ---- İlk durum
  let s = await st();
  check('ilk durum: denetlenmedi, kip bildir', s.status === 'idle' && s.mode === 'notify' && /-dev$/.test(s.current), s);
  await openSettings();
  // Bölüm başlıkları CSS ile büyük harf (innerText dönüşümü uygular)
  const low = (await shellText()).toLowerCase();
  check('Ayarlar → Güncellemeler bölümü', low.indexOf((await T('Güncellemeler')).toLowerCase()) >= 0 && low.indexOf((await T('Henüz denetlenmedi')).toLowerCase()) >= 0);
  check('ilk durumda nokta yok', !(await dot()));

  // ---- Elle denetim: yeni sürüm
  check('Şimdi Denetle düğmesi', await clickText('Şimdi Denetle'));
  for (let i = 0; i < 40 && (await st()).status !== 'available'; i++) await sleep(250);
  await sleep(400);
  s = await st();
  check('yeni sürüm: en yüksek android-v (taslak ve masaüstü sayılmadı)', s.status === 'available' && s.latest === '9.1.0' && s.skipped === false, s);
  check('sürüm notu düz metin', s.notes === 'Yenilikler\n\n• PC bağlantısı QR ile\n• Güncelleme uyarısı', s.notes);
  check('sürüm sayfası adresi github.com', s.url === 'https://github.com/CaYatur/SoundVisualizer/releases/tag/android-v9.1.0', s.url);
  check('Ayarlar düğmesinde nokta', await dot());
  const toast1 = await toastText();
  check('bir kez bildirim (sürümle)', toast1.indexOf('9.1.0') >= 0, toast1);
  let text = await shellText();
  check('üstte şerit ve bölümde yeni sürüm', text.indexOf(await T('Aşağıda, Güncellemeler bölümünde')) >= 0 && text.indexOf(await T('Yeni sürüm var')) >= 0 && text.indexOf('9.1.0') >= 0, '');
  check('bölümde sürüm notu ve APK boyutu', text.indexOf('Güncelleme uyarısı') >= 0 && /18,3 MB|18\.3 MB/.test(text), '');
  check('Sürüm Sayfasını Aç ve Bu Sürümü Atla düğmeleri', text.indexOf(await T('Sürüm Sayfasını Aç')) >= 0 && text.indexOf(await T('Bu Sürümü Atla')) >= 0);
  shot('1-available');
  // Art arda elle denetim GitHub sınırına harcanmaz (20 sn)
  const g0 = (await feed({ code: 200, body: FEED_91 })).gets;
  await ev('window.SVAndroid.updates.check()');
  check('art arda elle denetim ağa çıkmıyor', (await feed({ code: 200, body: FEED_91 })).gets === g0, g0);

  // ---- Yeniden açılış: durum kalıcı, bildirim tekrarlanmaz
  page = await open();
  ev = (js) => page.evaluate(js);
  await ready();
  await sleep(800);
  s = await st();
  check('yeniden açılışta durum kalıcı', s.status === 'available' && s.latest === '9.1.0' && s.checkedAt > 0, s);
  check('yeniden açılışta nokta', await dot());
  check('bildirim sürüm başına bir kez', (await toastText()).indexOf('9.1.0') < 0, await toastText());

  // ---- Sürümü atla
  await openSettings();
  check('Bu Sürümü Atla', await clickText('Bu Sürümü Atla'));
  await sleep(600);
  s = await st();
  check('atlandı: uyarı susar', s.skipped === true && !(await dot()) && (await shellText()).indexOf(await T('Aşağıda, Güncellemeler bölümünde')) < 0, s);
  check('atlanan sürüm bölümde işaretli', (await shellText()).indexOf(await T('Atlandı')) >= 0);

  // ---- Daha yeni sürüm: atlama geçersiz, uyarı geri gelir (elle denetim 20 sn sınırı)
  await feed({ code: 200, body: FEED_92 });
  await sleep(21000);
  await ev('window.SVAndroid.updates.check()');
  await sleep(600);
  s = await st();
  check('daha yeni sürüm uyarıyı geri getirir', s.status === 'available' && s.latest === '9.2.0' && s.skipped === false && (await dot()), s);
  check('yeni sürüm için yeniden bildirim', (await toastText()).indexOf('9.2.0') >= 0, await toastText());

  // ---- GitHub sınırı: önceki sonuç kalır, hata eklenir
  await feed({ code: 403 });
  await sleep(21000);
  await ev('window.SVAndroid.updates.check()');
  await sleep(600);
  s = await st();
  check('403: önceki "yeni sürüm" kalır, hata adı rate', s.status === 'available' && s.latest === '9.2.0' && s.error === 'rate', s);
  await openSettings();
  check('bölümde "son deneme olmadı"', (await shellText()).indexOf(await T('Son deneme olmadı')) >= 0);

  // ---- Kip kapalı: kendiliğinden denetim ağa çıkmaz
  await ev(`window.SVAndroid.updates.setMode('off')`);
  await feed({ reset: true, code: 200, body: FEED_91 });
  await ev(`window.SVAndroid.updates.setMode('off')`);
  const g1 = (await feed({ code: 200, body: FEED_91 })).gets;
  await ev('window.SVAndroid.updates.auto()');
  await sleep(500);
  s = await st();
  check('kip kapalı: kendiliğinden denetim yok', s.mode === 'off' && s.status === 'idle' && (await feed({ code: 200, body: FEED_91 })).gets === g1, s);
  await openSettings();
  const sw = await ev(`(() => { const t = ${JSON.stringify(await T('Yeni sürümü bildir'))}; const r = [...document.querySelectorAll('#sv-shell .ctl-row')].find((x) => x.textContent.indexOf(t) >= 0); const b = r && r.querySelector('[role="switch"]'); return b ? b.getAttribute('aria-checked') : null; })()`);
  check('anahtar kapalı görünüyor', sw === 'false', sw);
  await ev(`window.SVAndroid.updates.setMode('notify')`);
  await ev('window.SVAndroid.updates.auto()');
  await sleep(800);
  check('kip açılınca kendiliğinden denetim', (await st()).status === 'available', await st());

  // ---- Yalnız masaüstü sürümleri: "henüz Android sürümü yok", hata değil
  await feed({ reset: true, code: 200, body: FEED_DESKTOP });
  await ev('window.SVAndroid.updates.check()');
  await sleep(600);
  s = await st();
  check('yalnız masaüstü sürümleri: none', s.status === 'none' && !s.error && !(await dot()), s);
  await openSettings();
  check('bölümde "Henüz yayımlanmış Android sürümü yok"', (await shellText()).indexOf(await T('Henüz yayımlanmış Android sürümü yok')) >= 0);
  shot('2-none');

  // ---- Sürüm sayfasını aç (tarayıcı)
  await feed({ reset: true, code: 200, body: FEED_91 });
  await ev('window.SVAndroid.updates.check()');
  await sleep(600);
  const o = await ev('window.SVAndroid.updates.open().then((r) => r, (e) => ({ error: String(e.message) }))');
  await sleep(2500);
  const top = D.adb(['shell', 'dumpsys', 'activity', 'activities']).toString();
  const resumed = ((/(?:topResumedActivity|mResumedActivity)[=:][^\n]*?(\S+\/\S+)/.exec(top) || [])[1] || '').replace(/\}$/, '');
  check('sürüm sayfası tarayıcıda (ya da tarayıcı yoksa anlaşılır hata)', (o && o.url === 'https://github.com/CaYatur/SoundVisualizer/releases/tag/android-v9.1.0' && !!resumed && resumed.indexOf(D.PKG + '/') < 0) || (o && o.error === 'no-browser'), { o, resumed });
  shot('3-browser');

  // ---- İngilizce arayüz
  page = await open();
  ev = (js) => page.evaluate(js);
  await ready();
  await ev(`(() => { localStorage.setItem('sv-language', 'en'); location.reload(); return 1; })()`).catch(() => {});
  await sleep(2500);
  page = await D.connect();
  ev = (js) => page.evaluate(js);
  await ready();
  await openSettings();
  text = await shellText();
  check('İngilizce: Updates, New version available, Open the Release Page', text.indexOf('Updates') >= 0 && text.indexOf('New version available') >= 0 && text.indexOf('Open the Release Page') >= 0, text.slice(text.indexOf('Updates'), text.indexOf('Updates') + 200));
  shot('4-en');
  await ev(`(() => { localStorage.removeItem('sv-language'); return 1; })()`);

  // ---- Gerçek ağ: GitHub'ın sürüm listesi (Android sürümü yayımlanana dek none)
  if (!flag('no-net')) {
    await feed({ reset: true });
    page = await open();
    ev = (js) => page.evaluate(js);
    await ready();
    await ev('window.SVAndroid.updates.check()');
    for (let i = 0; i < 80 && (await st()).checking; i++) await sleep(250);
    s = await st();
    check('gerçek GitHub yanıtı okunuyor (none, latest ya da available; ağ yoksa offline)', ['none', 'latest', 'available'].indexOf(s.status) >= 0 || (s.status === 'error' && ['offline', 'timeout', 'rate'].indexOf(s.error) >= 0), s);
  }
  await feed({ reset: true });
  console.log('SONUÇ: ' + (bad ? bad + ' hata' : 'hepsi geçti'));
  process.exit(bad ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(2); });
