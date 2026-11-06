/*
 * SoundVisualizer — CaYaDev Ses Görselleştirici
 * Copyright (c) 2026 Çağan Turgut (CaYatur) — CaYaDev, https://cayadev.com
 * SPDX-License-Identifier: MIT
 */
'use strict';
/* Asıl exporter sayfası/köprüsü/IPC: küçük sekiz kare, kullanıcı profili yok. */
const path=require('path'),fs=require('fs'),os=require('os');
if(!process.versions.electron){const env={...process.env};delete env.ELECTRON_RUN_AS_NODE;const p=require('child_process').spawn(require('electron'),[__filename,...process.argv.slice(2)],{stdio:'inherit',env});p.on('exit',c=>process.exit(c));return;}
const {app,BrowserWindow,ipcMain,nativeImage}=require('electron');
app.commandLine.appendSwitch('use-gl','angle');app.commandLine.appendSwitch('use-angle','swiftshader');app.commandLine.appendSwitch('enable-unsafe-swiftshader');
const profile=fs.mkdtempSync(path.join(os.tmpdir(),'sv-export-timeline-'));app.setPath('userData',profile);
const root=path.join(__dirname,'..'),out='/workspace/tl-export-shots';
const live=process.argv.includes('--live');
const active=process.argv.includes('--active'), off=process.argv.includes('--off'), yuv=process.argv.includes('--yuv');
const pcm=Buffer.alloc(44+8000*2);pcm.write('RIFF');pcm.writeUInt32LE(pcm.length-8,4);pcm.write('WAVEfmt ',8);pcm.writeUInt32LE(16,16);pcm.writeUInt16LE(1,20);pcm.writeUInt16LE(1,22);pcm.writeUInt32LE(8000,24);pcm.writeUInt32LE(16000,28);pcm.writeUInt16LE(2,32);pcm.writeUInt16LE(16,34);pcm.write('data',36);pcm.writeUInt32LE(pcm.length-44,40);
let win;const frames=[];const timer=setTimeout(()=>{console.error('export smoke timed out');app.exit(1);},30000);
ipcMain.handle('milkdrop:textures',()=>[]);ipcMain.handle('milkdrop:texture',()=>null);ipcMain.handle('export:cancel-requested',()=>false);
const raw=[];
ipcMain.handle('export:frame',(_e,data,index)=>{raw[index]=Buffer.from(new Uint8Array(data.buffer||data,data.byteOffset||0,data.byteLength||data.length));return {cancel:false};});
ipcMain.on('export:error',(_e,msg)=>{console.error(msg);clearTimeout(timer);app.exit(1);});
ipcMain.on('export:finish',()=>{
 try {
  const cp=require('child_process');fs.mkdirSync(out,{recursive:true});
  const name=off?'manual':active?'active':yuv?'selected-yuv':'selected',video=path.join(out,name+'.mp4');
  const enc=cp.spawnSync('ffmpeg',['-v','error','-f','rawvideo','-pixel_format',yuv?'yuv420p':'rgba','-video_size','160x90','-framerate','4','-i','pipe:0','-an','-c:v','libx264','-preset','ultrafast','-y',video],{input:Buffer.concat(raw),maxBuffer:2000000});
  if(enc.status!==0)throw Error(String(enc.stderr));
  const dec=cp.spawnSync('ffmpeg',['-v','error','-i',video,'-f','rawvideo','-pix_fmt','rgba','pipe:1'],{maxBuffer:2000000});if(dec.status!==0)throw Error(String(dec.stderr));
  for(let index=0;index<8;index++){const b=dec.stdout.subarray(index*160*90*4,(index+1)*160*90*4);let r=0,g=0,bl=0;for(let i=0;i<b.length;i+=4){r+=b[i];g+=b[i+1];bl+=b[i+2];}const n=160*90;frames.push({index,r:r/n,g:g/n,b:bl/n});if(index===3){const bgra=Buffer.from(b);for(let i=0;i<bgra.length;i+=4){bgra[i]=b[i+2];bgra[i+2]=b[i];}fs.writeFileSync(path.join(out,name+'-frame.png'),nativeImage.createFromBitmap(bgra,{width:160,height:90}).toPNG());}}
  console.log(JSON.stringify({active,off,yuv,video,frames}));
  const good=raw.length===8&&(off?frames.every(x=>x.b>200&&x.r<30&&x.g<30):frames.slice(1,6).every(x=>x.r>200&&x.g<30&&x.b<30)&&frames.filter(x=>[0,6,7].includes(x.index)).every(x=>x.r<5&&x.g<5&&x.b<5));
  clearTimeout(timer);console.log(good?'ui-export-timeline: OK':'ui-export-timeline: BLACK/WRONG BANK');app.exit(good?0:1);
 }catch(e){console.error(e);app.exit(1);}
});
app.whenReady().then(async()=>{win=new BrowserWindow({width:200,height:140,show:false,webPreferences:{preload:path.join(root,'src/main/preload-exporter.js'),contextIsolation:true,sandbox:true,backgroundThrottling:false}});await win.loadFile(path.join(root,'src/exporter/index.html'));
 const cfg=await win.webContents.executeJavaScript(`(()=>{const c=window.SV.defaultConfig();c.layerStack={enabled:true};c.layers=[{id:'manual',kind:'background',type:'solid',settings:{background:{type:'solid',solidColor:'#0000ff'}}}];const e={id:'bankE',name:'E',itemEnabled:true,tracks:[{id:'t',kind:'clip',clips:[{id:'red',type:'scene',ref:'',start:0.25,dur:1.25,transType:'cut',local:{from:{type:'scene',ref:''},data:{layerStack:{enabled:true},layers:[{id:'redLocal',kind:'background',type:'solid',settings:{background:{type:'solid',solidColor:'#ff0000'}}}]}}}]}],loop:{enabled:false,start:0,end:0},markers:[]};const a={id:'bankA',name:'A',itemEnabled:true,tracks:[],loop:{enabled:false,start:0,end:0},markers:[]};c.timeline=Object.assign({},c.timeline,${active?'e':'a'},{useTimeline:${live},bank:[${active?'a':'e'}]});c.export.includeTimeline=${!off};c.export.timelineId='bankE';return c;})()`);
 win.webContents.send('export:job',{cfg,audioBuffer:pcm,width:160,height:90,fps:4,durationSec:2,pix:yuv?'yuv420p':'rgba',platform:process.platform,presets:[]});
}).catch(e=>{console.error(e);app.exit(1);});
