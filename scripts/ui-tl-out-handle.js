/*
 * SoundVisualizer — CaYaDev Ses Görselleştirici
 * Copyright (c) 2026 Çağan Turgut (CaYatur) — CaYaDev, https://cayadev.com
 * SPDX-License-Identifier: MIT
 */
'use strict';
/* Gerçek fare: sıfır çıkış tutamacı komşu klibin girişine/kırpmaya dönüşmemeli. */
const { startPanel, sleep } = require('./ui-lib');
const fs=require('fs');
const repro=process.argv.includes('--repro');
(async()=>{
 const s=await startPanel({port:9864,lang:'en-US'}),q=(x)=>s.a.ev(x),failures=[];
 try {
  await q(`(()=>{const P=window.SVPanel,c=P.cfg();c.scenes=[{id:'s',name:'Handle scene',data:{layerStack:{enabled:true},layers:[{id:'bg',kind:'background',type:'solid'}]}}];
   Object.assign(c.timeline,{useTimeline:false,snap:'off',zoom:90,scroll:0,loop:{enabled:false,start:0,end:0},tracks:[{id:'t',kind:'clip',clips:[
    {id:'a',type:'scene',ref:'s',start:1,dur:4,fade:0,fadeIn:0,fadeOut:0,transType:'wipe',transEase:'easeInOut'},
    {id:'b',type:'scene',ref:'s',start:5,dur:2}]}]});P.push(true);P.setCategory('time');window.SVTimelinePanel.useTimeline(true);return 1;})()`);
  await sleep(300);await q(`window.SVTimelinePanel._select({kind:'clip',trackId:'t',clipId:'a'});window.SVTimelinePanel._followTarget();window.SVPanel.rerender();1`);await sleep(250);
  const p=JSON.parse(await q(`JSON.stringify((()=>{const T=window.SVTimelinePanel,c=window.SVPanel.cfg().timeline,p=T._clipPoint(0,0);return {x:p.x+2*c.zoom,y:p.y-(c.laneHeight||40)/2+5,zoom:c.zoom};})())`));
  const shot=async(name)=>{const r=await s.a.call('Page.captureScreenshot',{format:'png'});fs.mkdirSync('/workspace/tl-out-handle-shots',{recursive:true});fs.writeFileSync('/workspace/tl-out-handle-shots/'+name+'.png',Buffer.from(r.result.data,'base64'));};
  await shot(repro?'before':'both-zero');
  await q('window.__fadeSourceBefore=JSON.stringify(window.SVPanel.cfg().scenes);window.__fadeManualBefore=JSON.stringify(window.SVTimelineTarget.persistent(window.SVPanel.cfg()).layers);1');

  const mouse=async(type,x,button,buttons)=>s.a.call('Input.dispatchMouseEvent',{type,x,y:p.y,button:button||'none',buttons:buttons||0,clickCount:type==='mousePressed'||type==='mouseReleased'?1:0});
  await mouse('mouseMoved',p.x-1);await mouse('mousePressed',p.x-1,'left',1);
  await mouse('mouseMoved',p.x-p.zoom,'left',1);await mouse('mouseReleased',p.x-p.zoom,'left');await sleep(250);
  const result=JSON.parse(await q(`JSON.stringify((()=>{const c=window.SVPanel.cfg().timeline.tracks[0].clips[0];return {fadeOut:c.fadeOut,dur:c.dur,start:c.start};})())`));
  if(result.fadeOut!==1||result.dur!==4||result.start!==1)failures.push('right handle changed wrong property: '+JSON.stringify(result));
  if(!repro && !failures.length){
   const data=JSON.parse(await q(`JSON.stringify((()=>{const c=window.SVPanel.cfg(),C=window.SVTimelineCompose,T=window.SVTimeline;
    const tl=T.makeTimeline({tracks:[{id:'t',clips:[c.timeline.tracks[0].clips[0]]}]});
    return {out:C.composeAt(c,tl,4.5).cfg.timelineComposition.units[0].transition,black:C.composeAt(c,tl,5).black};})())`));
   if(!data.out.out||data.out.type!=='wipe'||Math.abs(data.out.p-0.5)>1e-8||!data.black)failures.push('native exit/boundary failed');
   await q('window.SVTimelinePanel.undo();1');if(await q('window.SVPanel.cfg().timeline.tracks[0].clips[0].fadeOut')!==0)failures.push('undo');
   await q('window.SVTimelinePanel.redo();1');if(await q('window.SVPanel.cfg().timeline.tracks[0].clips[0].fadeOut')!==1)failures.push('redo');
   if(!await q('JSON.stringify(window.SVPanel.cfg().scenes)===window.__fadeSourceBefore && JSON.stringify(window.SVTimelineTarget.persistent(window.SVPanel.cfg()).layers)===window.__fadeManualBefore')) failures.push('source/manual isolation');
   await sleep(500);const disk=JSON.parse(fs.readFileSync(s.work+'/ud/settings.json','utf8'));
   if(disk.timeline.tracks[0].clips[0].fadeOut!==1)failures.push('disk persistence');await shot('after-drag');
  }
  console.log(JSON.stringify({result,failures}));if(failures.length)process.exitCode=1;else console.log('ui-tl-out-handle: OK');
 }finally{await s.stop();}
})().catch(e=>{console.error(e);process.exitCode=1;});
