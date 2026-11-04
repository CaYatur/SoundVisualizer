/*
 * SoundVisualizer — CaYaDev Ses Görselleştirici
 * Copyright (c) 2026 Çağan Turgut (CaYatur) — CaYaDev, https://cayadev.com
 * https://github.com/CaYatur/SoundVisualizer
 * SPDX-License-Identifier: MIT
 */
'use strict';
// Otomasyon şeridini GERÇEK Electron girişiyle sınar (#957): R (Öğren) ile
// hedef öğrenme, oynarken kayıt, hedef çipindeki × ve seçicide yeniden tıklayıp kaldırma.
// Kullanım: xvfb-run -a node scripts/ui-automation.js [--as-windows]
const { sleep, startPanel } = require('./ui-lib');
(async () => {
  const s = await startPanel({ port: 9796, asWindows: process.argv.includes('--as-windows') });
  const { a } = s; await sleep(1500);
  const q = (x) => a.ev(x);
  const J = async (x) => JSON.parse(await q('JSON.stringify((()=>{' + x + '})())'));
  const click = async (x, y) => { for (const type of ['mousePressed', 'mouseReleased']) await a.call('Input.dispatchMouseEvent', { type, x, y, button: 'left', clickCount: 1, buttons: 1 }); };
  const key = async (k, code, vk) => { await a.call('Input.dispatchKeyEvent', { type: 'keyDown', key: k, code, windowsVirtualKeyCode: vk }); await a.call('Input.dispatchKeyEvent', { type: 'keyUp', key: k, code, windowsVirtualKeyCode: vk }); };
  const centre = (sel) => J("const e=document.querySelector(" + JSON.stringify(sel) + ");if(!e)return null;e.scrollIntoView({block:'center'});const r=e.getBoundingClientRect();return [r.left+r.width/2,r.top+r.height/2]");
  const clickSel = async (sel) => { const c = await centre(sel); if (!c) throw new Error('yok: ' + sel); await click(c[0], c[1]); await sleep(350); };
  const trk = () => J("const t=(window.SVTimelinePanel.transport().tl.tracks||[]).find(t=>t.kind==='automation');return t?{id:t.id,target:t.target,keys:(t.keys||[]).length}:null");
  const res = {};
  // Otomasyon parçası ekle (çizelge sayfası)
  await q("window.SVPanel.setCategory('time'); 1"); await sleep(600);
  await q("(()=>{const cfg=window.SVPanel.cfg();cfg.timeline=cfg.timeline||{};cfg.timeline.enabled=true;cfg.timeline.tracks=(cfg.timeline.tracks||[]).concat([window.SVTimeline.makeTrack({kind:'automation',name:'Otomasyon 9'})]);window.SVPanel.rerender&&window.SVPanel.rerender();return 1})()"); await sleep(600);
  res.t0 = await trk();
  // 1) Hedefsiz R: öğrenme (kırmızı, yanıp söner)
  await clickSel('.tl-head.auto .tl-tog.rec');
  res.learnCls = await J("const b=document.querySelector('.tl-head.auto .tl-tog.rec');return b&&b.className");
  res.learnBg = await J("const b=document.querySelector('.tl-head.auto .tl-tog.rec');return b&&getComputedStyle(b).animationName");
  // Sahne sayfasında herhangi bir sayısal ayarı oynat
  await q("window.SVPanel.setCategory('scene'); 1"); await sleep(600);
  const rng = await J("const r=[...document.querySelectorAll('.ctrl input[type=range]')].find(i=>i.offsetParent&&!i.disabled&&Number(i.value)<Number(i.max));if(!r)return null;r.id=r.id||'learnRng';return {id:r.id,lab:(r.closest('.ctrl').querySelector('.lbl-t, label')||{}).textContent||''}");
  res.rng = rng;
  const L0 = await q("window.SVTimelinePanel._learning()");
  const v0 = await q("document.getElementById('learnRng').value");
  await clickSel('#' + rng.id); await key('ArrowRight', 'ArrowRight', 39); await sleep(400);
  res.t1 = await trk(); rng.path = res.t1 && res.t1.target;
  res.recOn = await J("return window.SVTimelinePanel._recording()");
  // 2) Kayıt: oynarken ayarı oynat → noktalar
  await q("window.SVPanel.setCategory('time'); 1"); await sleep(500);
  await clickSel('.tl-play'); await sleep(300);
  res.play0 = await J("const t=window.SVTimelinePanel.transport();return [t.playing,t.time]");
  await q("window.SVPanel.setCategory('scene'); 1"); await sleep(500);
  const pickR = () => q("(()=>{const r=[...document.querySelectorAll('.ctrl input[type=range]')].find(i=>i.offsetParent&&((i.closest('.ctrl').querySelector('.lbl-t, label')||{}).textContent||'')===" + JSON.stringify(rng.lab) + ");if(r)r.id='learnRng';return 1})()");
  for (let i = 0; i < 6; i++) { await pickR(); await clickSel('#learnRng'); await key('ArrowRight', 'ArrowRight', 39); await sleep(250); }
  await q("window.SVPanel.setCategory('time'); 1"); await sleep(400);
  res.t2pre = await trk(); res.dur = await q("window.SVPanel.cfg().transition.duration"); res.rec2 = await J("return window.SVTimelinePanel._recording()"); res.play = await J("const t=window.SVTimelinePanel.transport();return [t.playing,t.time]");
  await clickSel('.tl-play'); await sleep(300);
  res.t2 = await trk(); res.saved = await J("const t=(window.SVPanel.cfg().timeline.tracks||[]).find(t=>t.kind==='automation');return t?(t.keys||[]).length:-1");
  // R kaydı durdurur
  await clickSel('.tl-head.auto .tl-tog.rec');
  res.recOff = await J("return window.SVTimelinePanel._recording()");
  // 3) Çipteki × ile kaldır
  { const r = await J("const r=document.querySelector('.tl-head.auto').getBoundingClientRect();return [r.left+2,r.top+r.height/2]"); await click(r[0], r[1]); await sleep(400); } res.insp = await J("return [document.querySelectorAll('.tl-insp-head').length, document.querySelectorAll('.tl-target-pick').length, document.querySelectorAll('.tl-tog.pick').length, document.querySelectorAll('.tl-head.auto').length, document.querySelector('.tl-head.auto').getBoundingClientRect().toJSON()]");
  res.xBtn = !!(await centre('.tl-target-x'));
  if (res.xBtn) await clickSel('.tl-target-x');
  res.t3 = await trk();
  // 4) Seçicide seçili hedefe yeniden tıklama kaldırır; "Hedefi Kaldır" görünür
  const cpath = await q("window.SVTimelinePanel._catalog()[0].path"); await q("window.SVTimelinePanel._setTarget(" + JSON.stringify(res.t0.id) + "," + JSON.stringify(cpath) + "); window.SVPanel.rerender&&window.SVPanel.rerender(); 1"); await sleep(400);
  { const c = await centre('.tl-head.auto .tl-tog.pick'); res.efp = await q("(()=>{const e=document.elementFromPoint(" + c[0] + "," + c[1] + ");return e&&(e.className+'|'+e.tagName)})()"); }
  await clickSel('.tl-head.auto .tl-tog.pick'); res.menuN = await q("document.querySelectorAll('.tl-target-menu').length");
  res.clearItem = !!(await centre('.tl-target-menu .tl-target-clear'));
  await q("(()=>{const i=document.querySelector('.tl-target-menu input');i.value=" + JSON.stringify(cpath) + ";i.dispatchEvent(new Event('input'));return 1})()"); await sleep(200);
  res.onItem = !!(await centre('.tl-target-menu .tl-target-list button.on'));
  if (res.onItem) await clickSel('.tl-target-menu .tl-target-list button.on');
  res.t4 = await trk();
  const ok = res.t0 && !res.t0.target && /learn/.test(res.learnCls || '') && !!res.t1.target && res.recOn.includes(res.t0.id)
    && res.t2.keys > 0 && !res.recOff.length && res.xBtn && res.t3.target === '' && res.t3.keys === res.t2.keys
    && res.clearItem && res.onItem && res.t4.target === '' && !s.errors.length;
  console.log(JSON.stringify(res), s.errors.slice(0, 3), ok ? 'tamam' : 'HATA');
  await s.stop(); process.exit(ok ? 0 : 1);
})().catch((e) => { console.error(e); process.exit(1); });
