/*
 * SoundVisualizer — CaYaDev Ses Görselleştirici
 * Copyright (c) 2026 Çağan Turgut (CaYatur) — CaYaDev, https://cayadev.com
 * https://github.com/CaYatur/SoundVisualizer
 * SPDX-License-Identifier: MIT
 */
'use strict';
// Çizelge opaklığı (#957): iki parçada üst üste binen iki sahne klibi. Üst klibin opaklığı
// düşünce alttaki görünmeli; panelin canlı önizlemesinin (görselleştiriciyle aynı katman motoru) ekran görüntüsüyle sınanır.
// Ayrıca 'Tut' eğrili otomasyon noktası anlık sıçramalı.
// Kullanım: xvfb-run -a node scripts/ui-opacity.js
const { sleep, startPanel } = require('./ui-lib');
const sharp = require('sharp');
(async () => {
  const s = await startPanel({ port: 9800 });
  const { a } = s; await sleep(2500);
  const q = (x) => a.ev(x);
  // Ekran görüntüsünü küçültüp panelde piksellere çevir (16x9 ızgara, RGB)
  const shot = async () => {
    await sleep(900);
    const b = JSON.parse(await q("JSON.stringify((()=>{const e=document.getElementById('pvStage')||document.getElementById('previewStage');const r=e.getBoundingClientRect();return {x:r.left,y:r.top,width:r.width,height:r.height,scale:1}})())"));
    if (!(b.width > 20 && b.height > 20)) throw new Error('önizleme görünmüyor ' + JSON.stringify(b));
    const r = await a.call('Page.captureScreenshot', { format: 'png', clip: b });
    // sharp (geliştirme bağımlılığı) ile 16x9'a küçült, ham RGB
    const px = await sharp(Buffer.from(r.result.data, 'base64')).removeAlpha().resize(16, 9, { fit: 'fill' }).raw().toBuffer();
    return [...px];
  };
  const diff = (p, r) => p.reduce((s2, x, i) => s2 + Math.abs(x - r[i]), 0) / p.length;
  // İki sahne: A (geçerli katmanlar), B (aynı katmanlar ters çevrilmiş ve küçültülmüş)
  await q(`(()=>{const P=window.SVPanel,cfg=P.cfg(),T=window.SVTimeline;
    const ls=(cfg.layers||[]).map(l=>window.SV.clone(l));
    const B=ls.map(l=>Object.assign(window.SV.clone(l),{transform:Object.assign({},l.transform||{},{flipY:true,scale:0.45,x:0.25})}));
    cfg.scenes=[{id:'scA',name:'A',data:{layers:ls}},{id:'scB',name:'B',data:{layers:B}}];
    cfg.timeline=cfg.timeline||{};cfg.timeline.enabled=true;
    cfg.timeline.tracks=[T.makeTrack({id:'tTop',clips:[{id:'cA',type:'scene',ref:'scA',start:0,dur:20,transType:'cut'}]}),
      T.makeTrack({id:'tLow',clips:[{id:'cB',type:'scene',ref:'scB',start:0,dur:20,transType:'cut'}]}),
      T.makeTrack({id:'tAu',kind:'automation',target:'tl.clip.cA.opacity',min:0,max:1,keys:[{t:0,v:1,curve:'hold'},{t:10,v:0.3,curve:'linear'},{t:15,v:0.3}]})];
    P.rerender&&P.rerender();return 1})()`); await sleep(800);
  const at = async (t) => { await q(`(window.SVTimelinePanel.seek(${t}),window.SVTimelinePanel._applyAt(${t}),1)`); return shot(); };
  const setOp = (o) => q(`(()=>{const c=window.SVTimelinePanel.transport().tl.tracks[0].clips[0];c.opacity=${o};return 1})()`);
  const res = {};
  // Otomasyonu sustur: sabit klip opaklığını sına
  await q("(window.SVTimelinePanel.transport().tl.tracks[2].muted=true,1)");
  await setOp(1); const full = await at(2);
  await setOp(0.3); const low = await at(2.5);
  await setOp(0); const none = await at(3);
  res.sabit = { dim: +diff(full, low).toFixed(1), alt: +diff(full, none).toFixed(1) };
  // Otomasyon: 9.9 sn'de hâlâ 1 (Tut), 10'da 0,3
  await setOp(1); await q("(window.SVTimelinePanel.transport().tl.tracks[2].muted=false,1)");
  const h1 = await at(9.9); const h2 = await at(10.05);
  res.oto = { once: +diff(full, h1).toFixed(1), sonra: +diff(low, h2).toFixed(1), sicrama: +diff(h1, h2).toFixed(1) };
  res.model = JSON.parse(await q("JSON.stringify((()=>{const T=window.SVTimeline,tl=window.SVTimelinePanel.transport().tl,k=tl.tracks[0],c=k.clips[0];return [9.9,10,12.5].map(t=>+T.entryOpacity(tl,k,c,t).toFixed(2))})())"));
  console.log(JSON.stringify(res));
  const ok = res.sabit.dim > 8 && res.sabit.alt > 8 && res.oto.once < res.oto.sicrama && res.oto.sonra < res.oto.sicrama && res.model.join() === '1,0.3,0.3';
  console.log(ok ? 'tamam' : 'HATA');
  s.stop(); process.exit(ok ? 0 : 1);
})().catch((e) => { console.error(e); process.exit(1); });
