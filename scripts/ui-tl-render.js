/*
 * SoundVisualizer — CaYaDev Ses Görselleştirici
 * Copyright (c) 2026 Çağan Turgut (CaYatur) — CaYaDev, https://cayadev.com
 * SPDX-License-Identifier: MIT
 */
'use strict';
/* Gerçek Canvas/LayerStack: canlı draw ve dışa aktarım composeTo piksel
   eşitliği. TÜM geçiş türleri gerçek Compositor sonucuyla karşılaştırılır;
   iki sahnenin ayrı efekt zinciri ve süre sonu temizliği de ölçülür. */
const { startPanel, sleep } = require('./ui-lib');
const fs = require('fs');
(async () => {
  const s = await startPanel({ port: 9854, lang: 'en-US', electronArgs: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  try {
    await sleep(1200);
    const result = await s.a.ev(`(${function run() {
      const W = 48, H = 32;
      const canvas = () => { const c = document.createElement('canvas'); c.width = W; c.height = H; return c; };
      const pixel = (c) => Array.from(c.getContext('2d').getImageData(0, 0, W, H).data);
      const equals = (a, b) => a.length === b.length && a.every((v, i) => Math.abs(v - b[i]) <= 1);
      const fills = (color) => { const c = canvas(); c.getContext('2d').fillStyle = color; c.getContext('2d').fillRect(0, 0, W, H); return c; };
      const cfg = window.SV.defaultConfig(); cfg.modulation.enabled = false;
      const scene = (color, fx) => ({ layerStack: { enabled: true }, modulation: { enabled: false }, postfx: fx || [], transition: { enabled: false },
        background: { type: 'solid', solidColor: color }, layers: [{ id: 'bg', kind: 'background', type: 'solid', enabled: true, opacity: 1 }] });
      cfg.scenes = [{ id: 'red', data: scene('#ff0000') }, { id: 'blue', data: scene('#0000ff') }];
      const audio = { level: 0, bass: 0, mid: 0, high: 0, treble: 0, peak: 0, freq: new Uint8Array(512), time: new Uint8Array(512), getBand: () => 0 };
      const live = new window.SVLayers.LayerStack(document.createElement('div'));
      const exp = new window.SVLayers.LayerStack(null); live.resize(W, H); exp.resize(W, H);
      const want = canvas(), output = canvas(); const compositor = new window.SVTransition.Compositor();
      const failures = [], rows = [];
      for (const type of window.SVTransition.TRANSITION_IDS.filter((x) => x !== 'cut')) {
        const tl = window.SVTimeline.makeTimeline({ tracks: [
          { id: 'top', clips: [{ id: 't', type: 'scene', ref: 'blue', start: 1, dur: 2, fade: 1, transType: type, transEase: 'linear' }] },
          { id: 'bot', clips: [{ id: 'b', type: 'scene', ref: 'red', start: 0, dur: 5, transType: 'cut' }] },
        ] });
        for (const time of [1, 1.25, 1.5, 1.75, 2, 1.5]) {
          const base = window.SVTimelineCompose.composeAt(cfg, tl, time).cfg;
          live.setConfig(base); exp.setConfig(base);
          live.draw(audio, base, time, 0); exp.composeTo(output.getContext('2d'), audio, base, time, 0);
          const actual = pixel(output);
          const liveImage = live.compCanvas;
          if (!liveImage || !equals(actual, pixel(liveImage))) failures.push('live/export ' + type + '@' + time);
          compositor.compose(want.getContext('2d'), fills('#ff0000'), fills('#0000ff'), W, H, type, Math.min(1, time - 1), {});
          if (!equals(actual, pixel(want))) failures.push('real compositor ' + type + '@' + time + ': ' + actual.slice(0,4) + ' expected ' + pixel(want).slice(0,4));
        }
        rows.push(type);
      }
      // Çakışan sahnelerin bağımsız efektleri: üst sahnenin grade efekti
      // alttakini silemez. Gerçek GPU efekti içeren sonuç iki bağımsız yığının
      // aynı sırada çizilip opaklıkla birleştirilmesiyle piksel karşılaştırılır.
      const fx = [{ type: 'grade', enabled: true, params: { exposure: -0.75, contrast: 1, saturation: 0.5, hue: 0.25 } }];
      cfg.scenes[0].data.postfx = fx;
      cfg.scenes[1].data.postfx = [{ type: 'vignette', enabled: true, params: { amount: 0.9, softness: 0.5 } }];
      const tl = window.SVTimeline.makeTimeline({ tracks: [
        { id: 'top', clips: [{ id: 't', type: 'scene', ref: 'blue', start: 0, dur: 3, transType: 'cut', opacity: 0.5 }] },
        { id: 'bot', clips: [{ id: 'b', type: 'scene', ref: 'red', start: 0, dur: 5, transType: 'cut' }] },
      ] });
      const base = window.SVTimelineCompose.composeAt(cfg, tl, 2).cfg;
      exp.setConfig(base); exp.composeTo(output.getContext('2d'), audio, base, 2, 0);
      const children = exp.timelineRenderer.children;
      if (children.get('b').stack.postfx.chain[0].type !== 'grade' || children.get('t').stack.postfx.chain[0].type !== 'vignette') failures.push('per scene FX lost');
      const expected = fills('#000000'), ectx = expected.getContext('2d');
      for (const id of ['b', 't']) {
        const child = children.get(id).stack;
        ectx.globalAlpha = id === 'b' ? 1 : 0.5; ectx.drawImage(child.postfx.canvas, 0, 0);
      }
      if (!children.get('b').stack.postfx.hasWork() || !children.get('t').stack.postfx.hasWork()) failures.push('WebGL2 effects unavailable');
      if (!equals(pixel(output), pixel(expected))) failures.push('FX composite pixels: ' + pixel(output).slice(0,4) + ' expected ' + pixel(expected).slice(0,4));
      const processed = pixel(output);
      cfg.scenes[0].data.postfx = [];
      const unprocessed = window.SVTimelineCompose.composeAt(cfg, tl, 2).cfg;
      exp.setConfig(unprocessed); exp.composeTo(output.getContext('2d'), audio, unprocessed, 2, 0);
      if (equals(processed, pixel(output))) failures.push('lower scene FX has no visible contribution');
      // Son sınırda üst klip ve kaynakları temizlenir; tamamı bitince siyah.
      const end = window.SVTimelineCompose.composeAt(cfg, tl, 3).cfg;
      exp.setConfig(end); exp.composeTo(output.getContext('2d'), audio, end, 3, 0);
      if (exp.timelineRenderer.children.has('t')) failures.push('ended child not disposed');
      const black = window.SVTimelineCompose.composeAt(cfg, tl, 5).cfg;
      exp.setConfig(black); exp.composeTo(output.getContext('2d'), audio, black, 5, 0);
      if (!equals(pixel(output), pixel(fills('#000000')))) failures.push('end black');
      if (exp.timelineRenderer.children.size) failures.push('gap resources retained');
      const shot = expected.toDataURL(); live.dispose(); exp.dispose();
      return { failures, transitionTypes: rows, samples: rows.length * 6, shot };
    }.toString()})()`);
    if (result.shot) { fs.mkdirSync('/workspace/tl-review-shots', { recursive: true }); fs.writeFileSync('/workspace/tl-review-shots/render-overlap-effects.png', Buffer.from(result.shot.split(',')[1], 'base64')); delete result.shot; }
    console.log(JSON.stringify(result, null, 2));
    if (result.failures.length) process.exitCode = 1;
    else console.log('ui-tl-render: OK');
  } finally { await s.stop(); }
})().catch((e) => { console.error(e); process.exitCode = 1; });
