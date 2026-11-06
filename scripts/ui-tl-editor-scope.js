/*
 * SoundVisualizer — CaYaDev Ses Görselleştirici
 * Copyright (c) 2026 Çağan Turgut (CaYatur) — CaYaDev, https://cayadev.com
 * SPDX-License-Identifier: MIT
 */
'use strict';
/* Gerçek normal paneller + uzak model olayının aynı işleyicisi: seçili klip
   korunur; uzaktan/AutoVJ değişikliği elle motoru hedefler, diske editör
   kökleri yazılmaz. Palet hedefi ve hedef yok koruması da gerçek DOM'da. */
const { startPanel, sleep } = require('./ui-lib');
const fs = require('fs');
const lang = process.argv.includes('--tr') ? 'tr-TR' : 'en-US';
(async () => {
  const s = await startPanel({ port: 9855, lang });
  const q = (x) => s.a.ev(x);
  const failures = [];
  try {
    await sleep(1200);
    await q(`(() => {
      const P = window.SVPanel, c = P.cfg(); c.layerStack = { enabled: true };
      c.layers = [window.SVLayers.normalizeLayer({ id: 'manual', kind: 'visualizer', type: 'bars' })];
      c.scenes = [{ id: 'one', name: 'One', data: { layerStack: { enabled: true }, layers: [window.SVLayers.normalizeLayer({ id: 'clipBg', kind: 'background', type: 'solid' })] } }];
      c.timeline.useTimeline = false; c.timeline.tracks = [{ id: 't', kind: 'clip', clips: [
        { id: 'a', type: 'scene', ref: 'one', start: 0, dur: 3 },
        { id: 'b', type: 'palette', ref: 'Orman', start: 4, dur: 2 },
        { id: 'act', type: 'action', ref: 'nextScene', start: 7, dur: 1 },
      ] }]; P.push(true); P.setCategory('time'); return 1;
    })()`); await sleep(500);
    await q('window.SVTimelinePanel.useTimeline(true); window.SVTimelinePanel._select(null); window.SVTimelinePanel._followTarget(); window.SVPanel.setCategory("scene"); 1'); await sleep(500);
    if (!await q("document.getElementById('svLayers').inert && document.getElementById('svInspector').inert && document.getElementById('tlEditBanner').textContent.length > 20")) failures.push('no target: panels not protected');
    await q("window.SVTimelinePanel._select({kind:'clip',trackId:'t',clipId:'a'}); window.SVTimelinePanel._followTarget(); 1"); await sleep(300);
    await q(`(() => { const c = window.SVPanel.cfg();
      window.__clipBefore = JSON.stringify(c.timeline.tracks[0].clips[0].local);
      const incoming = JSON.parse(JSON.stringify(window.SVTimelineTarget.persistent(c)));
      incoming.layers[0].type = 'tunnel';
      window.SVPanel._acceptExternalConfig(incoming);
      return 1;
    })()`); await sleep(400);
    if (!await q("window.SVPanel.cfg().layers[0].id === 'clipBg' && JSON.stringify(window.SVPanel.cfg().timeline.tracks[0].clips[0].local) === window.__clipBefore")) failures.push('remote settings contaminated clip');
    if (!await q("window.SVTimelineTarget.persistent(window.SVPanel.cfg()).layers[0].type === 'tunnel'")) failures.push('remote intent lost');
    await q("window.SVTimelineTarget.withManual(() => { window.SVPanel.cfg().layers[0].type = 'wave'; window.SVPanel.push(true); }); 1"); await sleep(400);
    if (!await q("JSON.stringify(window.SVPanel.cfg().timeline.tracks[0].clips[0].local) === window.__clipBefore")) failures.push('manual writer contaminated clip');
    // normal panel still targets local copy; root canonical is manual (wave)
    const result = await q(`JSON.stringify((() => { const c = window.SVPanel.cfg(), p = window.SVTimelineTarget.persistent(c); return { target: c.timeline.editTarget, editor: c.layers.map((l) => l.id), savedManual: p.layers.map((l) => l.type), transient: !!(p.timeline.editTarget || p.timeline.manualBaseline) }; })())`);
    console.log(result);
    await q("window.SVTimelinePanel._select({kind:'clip',trackId:'t',clipId:'b'}); window.SVTimelinePanel._followTarget(); 1"); await sleep(500);
    const paletteInput = await q("(() => { const e=document.querySelector('#tlEditBanner input[type=color]'); if(!e) return false; e.value='#123456'; e.dispatchEvent(new Event('input',{bubbles:true})); return true; })()");
    if (!paletteInput) failures.push('palette editor missing');
    if (!await q("window.SVPanel.cfg().timeline.tracks[0].clips[1].local.data.background.gradient.colors[0] === '#123456'")) failures.push('palette local edit failed');
    const shot = await s.a.call('Page.captureScreenshot', { format: 'png' });
    fs.mkdirSync('/workspace/tl-review-shots', { recursive: true });
    fs.writeFileSync('/workspace/tl-review-shots/palette-scope-' + lang.slice(0, 2) + '.png', Buffer.from(shot.result.data, 'base64'));
    await q("window.SVTimelinePanel._select({kind:'clip',trackId:'t',clipId:'act'}); window.SVTimelinePanel._followTarget(); 1"); await sleep(250);
    if (await q('!!window.SVPanel.cfg().timeline.editTarget')) failures.push('action pretend visual target');
    await q('window.SVTimelinePanel.useTimeline(false); 1'); await sleep(1000);
    if (!await q("window.SVPanel.cfg().layers[0].id === 'manual' && window.SVPanel.cfg().layers[0].type === 'wave'")) failures.push('OFF lost deliberate manual change');
    const disk = JSON.parse(fs.readFileSync(s.work + '/ud/settings.json', 'utf8'));
    if (disk.timeline.editTarget || disk.timeline.manualBaseline || disk.layers[0].id !== 'manual' || disk.layers[0].type !== 'wave') failures.push('disk contaminated by editor session');
    if (disk.timeline.tracks[0].clips[1].local.data.background.gradient.colors[0] !== '#123456') failures.push('palette not saved');
    console.log(JSON.stringify({ failures }));
    if (failures.length) process.exitCode = 1; else console.log('ui-tl-editor-scope: OK');
  } finally { await s.stop(); }
})().catch((e) => { console.error(e); process.exitCode = 1; });
