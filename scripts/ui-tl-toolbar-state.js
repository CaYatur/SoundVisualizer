/*
 * SoundVisualizer — CaYaDev Ses Görselleştirici
 * Copyright (c) 2026 Çağan Turgut (CaYatur) — CaYaDev, https://cayadev.com
 * SPDX-License-Identifier: MIT
 */
'use strict';
/* Gerçek Electron DOM'u: sekmeden dönünce düğme görünümü ve erişilebilir
   durumlar modelle uyuşmalı. --repro düzeltme öncesi kanıtı da saklar. */
const { startPanel, sleep } = require('./ui-lib');
const fs = require('fs');
const lang = process.argv.includes('--tr') ? 'tr-TR' : 'en-US';
const repro = process.argv.includes('--repro');
const out = process.argv.find((x) => x.startsWith('--out='));
const dir = out ? out.slice(6) : '/workspace/tl-toolbar-shots';
(async () => {
  const s = await startPanel({ port: 9862, lang });
  const q = (x) => s.a.ev(x);
  const rows = [], failures = [];
  const shot = async (name) => {
    fs.mkdirSync(dir, { recursive: true });
    const r = await s.a.call('Page.captureScreenshot', { format: 'png' });
    fs.writeFileSync(dir + '/' + name + '-' + lang.slice(0, 2) + '.png', Buffer.from(r.result.data, 'base64'));
  };
  const check = async (name) => {
    await sleep(350);
    const r = JSON.parse(await q(`JSON.stringify((() => {
      const T = window.SVTimelinePanel, c = window.SVPanel.cfg().timeline, tr = T.transport();
      const all = [...document.querySelectorAll('.tl-toolbar button')];
      const spec = [['loop', tr.tl.loop.enabled], ['follow', c.followPlayhead !== false],
        [tr.playing ? 'pause' : 'play', tr.playing], ['broadcast', c.useTimeline === true], ['fullscreen', T._full()]];
      const buttons = spec.map(([icon, want]) => { const b=all.find((n) => n._ico===icon); if(!b)return {icon,missing:true};
        const cs=getComputedStyle(b); return {icon,want:!!want,on:b.classList.contains('on'),
          aria:b.getAttribute(icon==='broadcast'?'aria-checked':'aria-pressed'),bg:cs.backgroundColor,color:cs.color}; });
      const snap = document.querySelector('.tl-toolbar select');
      return {buttons, snap:snap && snap.value, wantSnap:c.snap, zoom:c.zoom, playing:tr.playing, time:tr.time};
    })())`));
    rows.push({ name, ...r });
    for (const b of r.buttons) {
      if (b.missing || b.on !== b.want || b.aria !== String(b.want)) failures.push(name + ':' + b.icon + ':' + JSON.stringify(b));
      if (b.want && (!b.bg || b.bg === 'rgba(0, 0, 0, 0)' || b.bg === 'transparent')) failures.push(name + ':' + b.icon + ':no visible pressed background');
    }
    if (r.snap !== r.wantSnap) failures.push(name + ':snap');
    return r;
  };
  const navigate = async () => { await q('window.SVPanel.setCategory("scene"); 1'); await sleep(180); await q('window.SVPanel.setCategory("time"); 1'); };
  try {
    await q(`(() => { const P=window.SVPanel,c=P.cfg();
      c.scenes=[{id:'toolbarScene',name:'Toolbar scene',data:{layerStack:{enabled:true},layers:[]}}];
      Object.assign(c.timeline,{useTimeline:false,followPlayhead:true,snap:'quarter',zoom:73,
        loop:{enabled:true,start:0,end:12},tracks:[{id:'t',kind:'clip',clips:[
          {id:'a',type:'scene',ref:'toolbarScene',start:0,dur:12},
          {id:'b',type:'scene',ref:'toolbarScene',start:12,dur:4}]}]});
      P.push(true); P.setCategory('time'); window.SVTimelinePanel.useTimeline(true); window.SVTimelinePanel.seek(8); return 1;
    })()`);
    await navigate(); await check('on-stopped-return');
    await shot(repro ? 'before-return' : 'after-return');
    if (!repro) {
      await q('window.SVTimelinePanel.play(); 1'); await navigate(); await check('on-playing-return');
      await q('window.SVTimelinePanel.pause(); window.SVTimelinePanel._select({kind:"clip",trackId:"t",clipId:"a"}); window.SVTimelinePanel._followTarget(); 1');
      await navigate(); await check('selected-clip-return');
      await q(`(() => { const T=window.SVTimelinePanel,P=window.SVPanel;
        T._select(null); T._followTarget(); P.cfg().timeline.tracks=[{id:'blank',kind:'clip',clips:[]}];
        T.invalidate(); P.setCategory('time'); P.rerender(); return 1; })()`);
      await sleep(200);
      await q('window.SVTimelinePanel._menu(200,58); 1');
      const added=await q(`(() => { const b=[...document.querySelectorAll('.sv-menu button')].find((n)=>/Add clip here|Buraya klip ekle/.test(n.textContent)); if(!b)return false;b.click();return true;})()`);
      if(!added) failures.push('Add clip here menu missing');
      await sleep(300);
      if(!await q('!!window.SVPanel.cfg().timeline.editTarget && window.SVPanel.cfg().timeline.tracks[0].clips[0].ref === ""')) failures.push('blank scene not editable');
      await q('window.SVPanel.setCategory("scene"); 1'); await sleep(200);
      await q(`(() => { const b=[...document.querySelectorAll('.sv-chead button')].find((x)=>x.offsetParent && /^(Ekle|Add)$/.test(x.textContent.trim())); if(!b)throw Error('Add layer missing');b.click();return 1;})()`);
      await q(`(() => { const b=document.querySelector('.sv-menu.sv-add button');if(!b)throw Error('Add layer menu missing');b.click();return 1;})()`);
      await sleep(250);
      if(!await q('window.SVPanel.cfg().timeline.tracks[0].clips[0].local.data.layers.length === 1 && window.SVPanel.cfg().scenes[0].data.layers.length === 0')) failures.push('blank child did not stay local');
      await shot('blank-clip-child');
      await q('window.SVPanel.setCategory("time"); 1'); await sleep(200);
      const renamed = await q(`(() => { const P=window.SVPanel,T=window.SVTimelineTarget;
        const i=document.querySelector('.tl-inspector input.txt'); if(!i)return false;
        const manual=JSON.stringify(T.persistent(P.cfg()).layers), target=JSON.stringify(P.cfg().timeline.editTarget);
        i.focus();i.value='name1';i.setSelectionRange(3,3);i.dispatchEvent(new Event('input',{bubbles:true}));
        return document.activeElement===i && i.selectionStart===3 && i.isConnected &&
          document.querySelector('#tlEditBanner .tl-eb-name').textContent==='name1' &&
          document.querySelector('.tl-clip-title').textContent==='name1' &&
          /Clip content|Klip içeriği/.test(document.querySelector('.tl-content-status').textContent) &&
          /Clip content|Klip içeriği/.test(document.querySelector('#tlEditBanner .tl-eb-meta').textContent) &&
          JSON.stringify(P.cfg().timeline.editTarget)===target && JSON.stringify(T.persistent(P.cfg()).layers)===manual;
      })()`);
      if(!renamed) failures.push('immediate name/content labels or input focus changed');
      await shot('local-content-renamed');

    }
    console.log(JSON.stringify({ lang, rows, failures }, null, 2));
    if (failures.length) process.exitCode=1; else console.log('ui-tl-toolbar-state: OK');
  } finally { await s.stop(); }
})().catch((e) => { console.error(e); process.exitCode=1; });
