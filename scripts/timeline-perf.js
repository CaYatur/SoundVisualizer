/*
 * SoundVisualizer — CaYaDev Ses Görselleştirici
 * Copyright (c) 2026 Çağan Turgut (CaYatur) — CaYaDev, https://cayadev.com
 * https://github.com/CaYatur/SoundVisualizer
 * SPDX-License-Identifier: MIT
 */
/* Zaman çizelgesi başarım yoklaması: panel penceresinde çalıştırılacak ifade.
   Oynatma + kaydırma sırasında panel yeniden kurulumu, sahne uygulaması ve
   tuval çizimi sayılarını döndürür (beklenen: yeniden kurulum 0). */
(async()=>{
const P=window.SVPanel; P.setCategory('time'); await new Promise(r=>setTimeout(r,800));
P.cfg().scenes=[{id:'s1',name:'A',data:{}},{id:'s2',name:'B',data:{}}];const scenes=P.cfg().scenes;
const stats={canvasNew:0,panelNew:0,muts:0,longFrames:0,maxFrame:0,blank:0};
const mo=new MutationObserver(ms=>{for(const m of ms){stats.muts++;for(const n of m.addedNodes){if(n.nodeType!==1)continue;if(n.matches('.tl-canvas')||n.querySelector('.tl-canvas'))stats.canvasNew++;if(n.matches('.tl-panel')||n.querySelector('.tl-panel'))stats.panelNew++;}}});
mo.observe(document.body,{childList:true,subtree:true});
const T=window.SVTimelinePanel; for(let k=0;k<4;k++){T.seek(k*1.5);T.addSceneAtHead(scenes[k%Math.max(1,scenes.length)]?scenes[k%scenes.length].id:'x'+k);await new Promise(r=>setTimeout(r,200));} T.seek(0);
await new Promise(r=>setTimeout(r,500));
const base={...stats};const p0=T._perf();stats.p0=p0;const A=window.SVPanel.actions();const oa=A.applyScene;stats.apply=0;A.applyScene=(...a)=>{stats.apply++;return oa(...a)};const orr=window.SVPanel.rerender;
let last=performance.now(),stop=false;
(function f(){if(stop)return;const n=performance.now();const d=n-last;last=n;if(d>50)stats.longFrames++;stats.maxFrame=Math.max(stats.maxFrame,d);const c=document.querySelector('.tl-canvas');if(!c||!c.isConnected||c.clientHeight===0)stats.blank++;requestAnimationFrame(f)})();
T.play(); await new Promise(r=>setTimeout(r,3000)); T.pause();
const cv=document.querySelector('.tl-canvas');const r=cv.getBoundingClientRect();
cv.dispatchEvent(new MouseEvent('mousedown',{bubbles:true,clientX:r.left+50,clientY:r.top+8,button:0}));
for(let i=0;i<60;i++){window.dispatchEvent(new MouseEvent('mousemove',{clientX:r.left+50+i*5,clientY:r.top+8}));await new Promise(r=>requestAnimationFrame(r));}
window.dispatchEvent(new MouseEvent('mouseup',{clientX:r.left+350,clientY:r.top+8}));
await new Promise(r=>setTimeout(r,300));stop=true;
stats.perf=T._perf();return JSON.stringify({scenes:scenes.length,tracks:T.transport().tl.tracks.length,base,stats});
})()
