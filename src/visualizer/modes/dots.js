/*
 * SoundVisualizer — CaYaDev Ses Görselleştirici
 * Copyright (c) 2026 Çağan Turgut (CaYatur) — CaYaDev, https://cayadev.com
 * https://github.com/CaYatur/SoundVisualizer
 * SPDX-License-Identifier: MIT
 */
'use strict';
/* Nokta Matris: sütun başına bir frekans bandı, satırlar seviye kademesi.
   Yanan noktalar dolu ve parlak, sönükler soluk bir ızgara bırakır. */
(function () {
  const OFF = 'rgba(255,255,255,0.06)';

  class DotsMode {
    constructor(canvas) {
      this.canvas = canvas;
      this.ctx = canvas.getContext('2d');
      this.glow = new window.SVGlow();
      this.peaks = null;
    }
    resize() {}

    /* Tema renginde her (sütun, satır) noktasının rengi sabit: sütun ve satır sayısı ya da
       tema değişmedikçe aynı dizeler tekrar kullanılır (bkz. blocks.js). */
    _themeColors(cfg, cols, rows) {
      const list = window.SV.resolveBackgroundColors(cfg).join(',');
      const key = cols + '|' + rows + '|' + list;
      if (this._palKey === key) return this._pal;
      const out = [];
      for (let i = 0; i < cols; i++) {
        for (let s = 0; s < rows; s++) out.push(window.SV.sampleThemeColor(cfg, (i / cols) * 0.7 + (s / (rows - 1)) * 0.3));
      }
      this._palKey = key;
      this._pal = out;
      return out;
    }

    draw(audio, cfg, t) {
      const ctx = this.ctx;
      const W = this.canvas.width;
      const H = this.canvas.height;
      const v = cfg.visualizer;
      const cols = Math.max(8, v.barCount | 0);
      const bars = audio.getBars(cols, v.minFreq, v.maxFreq, v.spectrum);
      if (!this.peaks || this.peaks.length !== cols) this.peaks = new Float32Array(cols);
      ctx.clearRect(0, 0, W, H);

      const rows = Math.max(5, Math.min(48, Math.round(H / 30)));
      const slotX = W / cols;
      const slotY = (H * 0.94) / rows;
      const r = Math.max(1, Math.min(slotX, slotY) * 0.5 * (1 - Math.min(0.8, v.gap)));
      const baseY = H * 0.97;

      /* Renk dizeleri hücre başına baştan kurulmuyor: tema renkleri önbellekte, gökkuşağının
         sönük rengi sütun başına bir kez. Çizim sırası ve renkler eskisiyle aynı. */
      const colorMode = v.colorMode || (v.rainbow ? 'rainbow' : 'custom');
      const pal = colorMode === 'theme' ? this._themeColors(cfg, cols, rows) : null;

      ctx.save();
      for (let i = 0; i < cols; i++) {
        const val = Math.min(1, bars[i] * (v.sensitivity || 1));
        const lit = val * rows;
        const cx = i * slotX + slotX / 2;
        const hue = colorMode === 'rainbow' ? ((i / cols) * 300 + t * 14) % 360 : 0;
        const dim = colorMode === 'rainbow' ? `hsla(${hue}, 40%, 30%, 0.16)` : OFF;
        const row = i * rows;

        for (let s = 0; s < rows; s++) {
          const on = s < lit;
          const cy = baseY - (s + 0.5) * slotY;
          if (!on) ctx.fillStyle = dim;
          else if (colorMode === 'theme') ctx.fillStyle = pal[row + s];
          else if (colorMode === 'rainbow') ctx.fillStyle = `hsl(${hue}, 90%, ${52 + (s / (rows - 1)) * 14}%)`;
          else ctx.fillStyle = v.color;
          ctx.beginPath();
          ctx.arc(cx, cy, r, 0, Math.PI * 2);
          ctx.fill();
        }

        // tepe noktası
        if (lit >= this.peaks[i]) this.peaks[i] = lit;
        else this.peaks[i] = Math.max(0, this.peaks[i] - 0.14);
        const ps = Math.min(rows - 1, Math.max(0, Math.floor(this.peaks[i])));
        if (this.peaks[i] > 0.5) {
          ctx.fillStyle = '#ffffff';
          ctx.beginPath();
          ctx.arc(cx, baseY - (ps + 0.5) * slotY, r * 0.45, 0, Math.PI * 2);
          ctx.fill();
        }
      }
      ctx.restore();

      this.glow.apply(this.canvas, v.glow, 0.9);
    }
    dispose() {}
  }

  window.SVModes = window.SVModes || {};
  window.SVModes.dots = DotsMode;
})();
