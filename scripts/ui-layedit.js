/*
 * SoundVisualizer — CaYaDev Ses Görselleştirici
 * Copyright (c) 2026 Çağan Turgut (CaYatur) — CaYaDev, https://cayadev.com
 * https://github.com/CaYatur/SoundVisualizer
 * SPDX-License-Identifier: MIT
 */
'use strict';
/* Düzen editörü canlı denetimi (#905). Gerçek fare ve klavye olaylarıyla:
   - sürükleme öğeyi taşıyor, bırakınca geri al adımı oluşuyor;
   - Ctrl+Z konumu geri alıyor ve önizleme sahnesi EDİTÖRDE kalıyor (eskiden arkadaki sayfaya
     dönüyor, editör simsiyah kalıyordu); Ctrl+Y yineliyor;
   - ok tuşu kendi adımını bırakıyor, sürüklemeyle birleşmiyor;
   - Shift ile tıklama seçime ekliyor, hizalama iki öğeye birden uygulanıyor;
   - Escape süren sürüklemeyi iptal ediyor, editörü kapatmıyor;
   - Alt+2 arkadaki sayfayı değiştirmiyor (tuşlar sızmıyor);
   - kapanınca sahne sayfadaki yerine dönüyor, konsol temiz.

   Kullanım: node scripts/ui-layedit.js [--port=9806] [--settings=<settings.json>]
   Linux'ta ekran yoksa: xvfb-run -a node scripts/ui-layedit.js */
const { sleep, startPanel } = require('./ui-lib');

const arg = (k, d) => { const m = process.argv.find((x) => x.startsWith('--' + k + '=')); return m ? m.slice(k.length + 3) : d; };

(async () => {
  const s = await startPanel({ port: Number(arg('port', 9806)), settings: arg('settings', '') || undefined });
  const { a } = s;
  const q = (x) => a.ev(x);
  const fails = [];
  const ok = (cond, msg) => { console.log((cond ? 'GEÇTİ ' : 'KALDI ') + msg); if (!cond) fails.push(msg); };
  const key = async (k, code, vk, mods) => {
    await a.call('Input.dispatchKeyEvent', { type: 'rawKeyDown', key: k, code, windowsVirtualKeyCode: vk, modifiers: mods || 0 });
    await a.call('Input.dispatchKeyEvent', { type: 'keyUp', key: k, code, windowsVirtualKeyCode: vk, modifiers: mods || 0 });
    await sleep(120);
  };
  const mouse = (type, x, y, extra) => a.call('Input.dispatchMouseEvent', Object.assign({ type, x, y, button: 'left', buttons: type === 'mouseReleased' ? 0 : 1, clickCount: 1 }, extra || {}));
  await sleep(1200);
  await q("document.querySelector('#pageTabs [data-cat=\"scene\"]').click(); 1");
  await sleep(900);
  /* Kendi sahnesi: iki yerleştirilebilir öğe (metin ve çalan parça kartı). Kullanıcı ayarı
     verilmişse onun sahnesi kullanılır; en az iki öğe yoksa bu ikisi eklenir. */
  await q(`(()=>{const P=window.SVPanel,c=P.cfg(),L=window.SVLayers;if(L&&L.enableStack)L.enableStack(c);
    const have=(c.layers||[]).filter(l=>window.SVLayout.kindOf(l));
    const add=(spec)=>c.layers.push(L.normalizeLayer(spec));
    if(have.length<2){add({kind:'visualizer',type:'text',name:'Deneme Metni',settings:{text:{content:'DENEME',x:0.3,y:0.3}}});add({kind:'visualizer',type:'text',name:'İkinci Metin',settings:{text:{content:'IKINCI',x:0.7,y:0.7}}});}
    if(L&&L.syncStackState)L.syncStackState(c);P.apply();return 1})()`);
  await sleep(1500);
  await q("document.getElementById('layoutEditBtn').click(); 1");
  await sleep(1500);
  const state = () => q(`JSON.stringify((()=>{const st=document.getElementById('previewStage'),w=document.querySelector('.lay-stage-wrap');
    return {open:window.SVLayoutEditor.isOpen(),inEditor:!!(w&&w.contains(st)),boxes:[...document.querySelectorAll('.lay-box')].map(b=>b.dataset.id),picked:[...document.querySelectorAll('.lay-box.sel')].map(b=>b.dataset.id),page:document.body.getAttribute('data-page'),canvases:st.querySelectorAll('canvas').length}})())`).then(JSON.parse);
  const pos = (id) => q(`JSON.stringify((()=>{const b=document.querySelector('.lay-box[data-id="${id}"]');if(!b)return null;return [parseFloat(b.style.left),parseFloat(b.style.top)]})())`).then(JSON.parse);
  const point = (id) => q(`JSON.stringify((()=>{const b=document.querySelector('.lay-box[data-id="${id}"]');const r=b.getBoundingClientRect();return {x:r.left+Math.min(r.width/2,30),y:r.top+Math.min(r.height/2,12)}})())`).then(JSON.parse);
  const near = (p, r, eps) => !!(p && r && Math.abs(p[0] - r[0]) <= (eps || 0.2) && Math.abs(p[1] - r[1]) <= (eps || 0.2));
  let v = await state();
  ok(v.open && v.inEditor && v.boxes.length >= 2, 'editör açıldı, sahne editörde, en az iki öğe (' + v.boxes.length + ')');
  const ids = await q(`JSON.stringify(window.SVLayoutEditor._elements().filter(e=>!e.locked&&!e.hidden&&e.drawn).map(e=>e.id))`).then(JSON.parse);
  const A = ids[0];
  const B = ids[1];
  if (!A || !B) { ok(false, 'iki kilitsiz, görünür öğe bulunamadı'); await s.stop(); process.exit(1); }

  // 1) Sürükleme ve geri alma
  const a0 = await pos(A);
  const drag = async (id, dx, dy, opts) => {
    const c = await point(id);
    await mouse('mousePressed', c.x, c.y);
    for (let i = 1; i <= 8; i++) { await mouse('mouseMoved', c.x + dx * i / 8, c.y + dy * i / 8); await sleep(25); }
    if (opts && opts.before) await opts.before();
    await mouse('mouseReleased', c.x + dx, c.y + dy);
    await sleep(900);
  };
  await drag(A, 90, 40);
  const a1 = await pos(A);
  ok(!near(a1, a0, 0.5), 'sürükleme öğeyi taşıdı (' + JSON.stringify(a0) + ' → ' + JSON.stringify(a1) + ')');
  ok(await q("!document.querySelector('.lay-editor [aria-label=\"Geri al\"], .lay-editor [aria-label=\"Undo\"]').disabled"), 'editördeki geri al düğmesi açıldı');
  await key('z', 'KeyZ', 90, 2);
  await sleep(700);
  v = await state();
  ok(v.inEditor && v.open, 'Ctrl+Z sonrası sahne editörde kaldı');
  ok(v.canvases > 0, 'tuvaller duruyor (' + v.canvases + ')');
  ok(near(await pos(A), a0), 'Ctrl+Z konumu geri aldı');
  await key('y', 'KeyY', 89, 2);
  await sleep(700);
  ok(near(await pos(A), a1), 'Ctrl+Y yineledi');
  ok((await state()).inEditor, 'Ctrl+Y sonrası sahne editörde');

  // 2) Ok tuşu kendi adımı: iki kez geri alınca önce ok, sonra sürükleme gider
  await q(`document.querySelector('.lay-box[data-id="${A}"]').focus({preventScroll:true}); 1`);
  await key('ArrowDown', 'ArrowDown', 40);
  await key('ArrowDown', 'ArrowDown', 40);
  await sleep(200);
  const a2 = await pos(A);
  ok(a2[1] > a1[1] + 0.5, 'ok tuşu aşağı kaydırdı');
  await key('z', 'KeyZ', 90, 2); // bekleme süresi dolmadan: ok tuşu yine de ayrı adım
  await sleep(600);
  ok(near(await pos(A), a1), 'ilk Ctrl+Z yalnız ok tuşunu geri aldı');
  await key('z', 'KeyZ', 90, 2);
  await sleep(600);
  ok(near(await pos(A), a0), 'ikinci Ctrl+Z sürüklemeyi geri aldı');

  // 3) Çoklu seçim ve hizalama
  const cb = await point(B);
  await mouse('mousePressed', cb.x, cb.y, { modifiers: 8 });
  await mouse('mouseReleased', cb.x, cb.y, { modifiers: 8 });
  await sleep(300);
  v = await state();
  ok(v.picked.length === 2 && v.picked.includes(A) && v.picked.includes(B), 'Shift ile tıklama seçime ekledi (' + v.picked.length + ')');
  const before = [await pos(A), await pos(B)];
  await q(`(()=>{const b=document.querySelector('.lay-tools [aria-label="Sola Hizala"], .lay-tools [aria-label="Align Left"]');b.click();return 1})()`);
  await sleep(900);
  const after = [await pos(A), await pos(B)];
  const left = Math.min(before[0][0], before[1][0]);
  ok(Math.abs(after[0][0] - left) < 0.6 && Math.abs(after[1][0] - left) < 0.6, 'sola hizalama iki öğeyi aynı kenara getirdi (' + after[0][0].toFixed(1) + ', ' + after[1][0].toFixed(1) + ')');
  await key('z', 'KeyZ', 90, 2);
  await sleep(600);
  ok(near(await pos(A), before[0]) && near(await pos(B), before[1]), 'hizalama tek adımda geri alındı');

  // 4) Escape süren sürüklemeyi iptal ediyor, editör açık kalıyor
  await q(`document.querySelector('.lay-stage-wrap').dispatchEvent(new PointerEvent('pointerdown',{bubbles:true,button:0})); 1`);
  await sleep(200);
  const c0 = await pos(A);
  await drag(A, 70, 30, { before: () => key('Escape', 'Escape', 27) });
  v = await state();
  ok(v.open, 'sürüklerken Escape editörü kapatmadı');
  ok(near(await pos(A), c0), 'sürüklerken Escape başlangıç konumuna döndürdü');

  // 5) Tuşlar arkadaki panele sızmıyor: Alt+2 sayfayı değiştirmez, Ctrl+A hepsini seçer
  await key('2', 'Digit2', 50, 1);
  await sleep(400);
  v = await state();
  ok(v.page === 'scene' && v.open, 'Alt+2 arkadaki sayfayı değiştirmedi');
  await key('a', 'KeyA', 65, 2);
  await sleep(300);
  v = await state();
  ok(v.picked.length === v.boxes.length, 'Ctrl+A bütün öğeleri seçti (' + v.picked.length + '/' + v.boxes.length + ')');

  // 6) Kapanış
  await key('Escape', 'Escape', 27);
  await sleep(1200);
  const end = await q(`JSON.stringify((()=>{const st=document.getElementById('previewStage');return {open:window.SVLayoutEditor.isOpen(),home:st.parentNode&&st.parentNode.id,back:!document.querySelector('.lay-backdrop'),canvases:st.querySelectorAll('canvas').length}})())`).then(JSON.parse);
  ok(!end.open && end.back && end.home === 'svFrame' && end.canvases > 0, 'Escape kapattı, sahne sayfadaki yerinde (' + end.home + ')');
  ok(!s.errors.length, 'konsol temiz (' + s.errors.join(' | ').slice(0, 200) + ')');
  await s.stop();
  console.log(fails.length ? 'KALDI (' + fails.length + ')\n' + fails.join('\n') : 'ui-layedit: HEPSİ GEÇTİ');
  process.exit(fails.length ? 1 : 0);
})().catch((e) => { console.error('HATA', e); process.exit(2); });
