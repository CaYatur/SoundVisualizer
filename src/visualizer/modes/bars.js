/*
 * SoundVisualizer — CaYaDev Ses Görselleştirici
 * Copyright (c) 2026 Çağan Turgut (CaYatur) — CaYaDev, https://cayadev.com
 * https://github.com/CaYatur/SoundVisualizer
 * SPDX-License-Identifier: MIT
 */
'use strict';
/* Frekans spektrumu barları (2D canvas).
   Her bar = logaritmik bir frekans bandı. Rainbow / tek renk, ayna, tepe noktaları. */
(function () {
  const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);
  const PEAK_ACCEL = 0.0009 * 3600; // kadran yüksekliği / s²

  class BarsMode {
    constructor(canvas) {
      this.canvas = canvas;
      this.ctx = canvas.getContext('2d');
      this.peaks = null;
      this.peakVel = null;
      this.glow = new window.SVGlow();
    }

    resize() {}

    _ensure(n) {
      if (!this.peaks || this.peaks.length !== n) {
        this.peaks = new Float32Array(n);
        this.peakVel = new Float32Array(n);
        this.peakHold = new Float32Array(n);
      }
    }

    draw(audio, cfg, t) {
      const ctx = this.ctx;
      const W = this.canvas.width;
      const H = this.canvas.height;
      const v = cfg.visualizer;
      const count = Math.max(8, v.barCount | 0);
      this._ensure(count);
      /* Kare süresi çizim saatinden (#878). Tepe noktasının düşüşü kare
         başına sabit bir artışla hızlanıyordu: 144 Hz'de 60 Hz'e göre
         yaklaşık 5,8 kat hızlı düşüyor, 60 fps dışa aktarım canlıyla
         eşleşmiyordu. İlk kare eski davranıştaki gibi bir 60 Hz adımı; saat
         geri giderse (yeniden başlama, arama) adım 0. */
      const dt = this._lastT == null ? 1 / 60 : !(t > this._lastT) ? 0 : Math.min(0.1, t - this._lastT);
      this._lastT = t;

      const bars = audio.getBars(count, v.minFreq, v.maxFreq, v.spectrum);
      ctx.clearRect(0, 0, W, H);

      const mirror = v.mirror;

      /* Yerleşim.

         Yayın düzeninde barlar kadranın tamamını doldurmaz: belli bir
         genişlikte bir şerit olarak, belli bir yüksekliğe kadar, seçilen bir
         taban çizgisinin üstünde durur. Bunu katman dönüşümüyle yapmak
         barları yatayda da küçültüyordu; ölçüler bu yüzden modun kendi
         ayarları. Varsayılanlar eski davranışı birebir korur. */
      const span = clamp01(v.barSpan == null ? 1 : v.barSpan);
      const cxFrac = clamp01(v.barCenterX == null ? 0.5 : v.barCenterX);
      const areaW = W * span;
      const areaX = W * cxFrac - areaW / 2;

      const slot = areaW / count;
      const gap = slot * Math.min(0.8, Math.max(0, v.gap));
      const bw = Math.max(1, slot - gap);

      const defBase = v.position === 'center' ? 0.5 : 1;
      const baseY = H * (v.baseline == null ? defBase : clamp01(v.baseline));
      const defH = v.position === 'center' ? 0.46 : v.position === 'full' ? 0.95 : 0.92;
      const maxH = H * (v.barHeight == null ? defH : clamp01(v.barHeight));
      /* Biçim (#879). Her ayarın varsayılanı eski çizimi birebir verir:
         köşe 0,4 × bar genişliği, düz dolgu, yukarı büyüme, beklemesiz
         tepe, eski düşüş ivmesi, tepe rengi bar renginden. */
      const centred = v.position === 'center';
      const down = !centred && v.barDirection === 'down';
      const radiusK = v.barRadius == null ? 0.4 : Math.max(0, Math.min(0.5, Number(v.barRadius) || 0));
      const segments = v.barStyle === 'segments';
      const segH = Math.max(2, maxH * Math.max(0.01, Math.min(0.2, v.segmentSize == null ? 0.035 : Number(v.segmentSize))));
      const segGap = segH * Math.max(0, Math.min(0.8, v.segmentGap == null ? 0.3 : Number(v.segmentGap)));
      const gradient = v.barFill === 'gradient';
      const capHold = Math.max(0, Number(v.capHold) || 0);
      const capFall = v.capFall == null ? 1 : Math.max(0.1, Math.min(8, Number(v.capFall) || 1));
      const capOwn = v.capColorMode === 'custom' && v.capColor ? v.capColor : null;

      /* Yerleşim kutusu (#534): barların alanı, sesten bağımsız. Düzen
         editörü yakalamayı bununla yapıyor. Normalize, tuvale göre.
         Aşağı büyüyen barlarda kutu tabanın altında. */
      this.layoutBounds = W > 0 && H > 0 ? {
        x: areaX / W,
        y: (down ? baseY : baseY - maxH) / H,
        w: areaW / W,
        h: (centred ? 2 * maxH : maxH) / H,
      } : null;

      // Bir yönde bar çiz: dir -1 yukarı, +1 aşağı
      const drawBar = (x, bh, dir) => {
        if (!segments) {
          roundRect(ctx, x, dir < 0 ? baseY - bh : baseY, bw, bh, bw * radiusK);
          ctx.fill();
          return;
        }
        // LED: tam bloklar; sesin değmediği blok çizilmez
        const n = Math.max(1, Math.floor((bh + segGap) / segH));
        const bH = Math.max(1, segH - segGap);
        const r = Math.min(bw * radiusK, bH / 2);
        for (let k = 0; k < n; k++) {
          const y0 = dir < 0 ? baseY - k * segH - bH : baseY + k * segH;
          roundRect(ctx, x, y0, bw, bH, r);
          ctx.fill();
        }
      };

      // Parlama tek geçişte (bloom) uygulanır; şekiller burada düz çizilir.
      ctx.save();

      for (let i = 0; i < count; i++) {
        // ayna: ortadan dışa
        let idx = i;
        if (mirror) {
          const half = count / 2;
          idx = i < half ? Math.floor(half - 1 - i) : Math.floor(i - half);
        }
        let val = bars[idx] * v.sensitivity;
        val = Math.min(1, val);
        const bh = Math.max(1, val * maxH);

        const x = areaX + i * slot + (slot - bw) / 2;

        // renk
        let col;
        let top = null; // dikey degradenin uç rengi
        const colorMode = v.colorMode || (v.rainbow ? 'rainbow' : 'custom');
        if (colorMode === 'theme') {
          col = window.SV.sampleThemeColor(cfg, i / count);
          if (gradient) top = window.SV.sampleThemeColor(cfg, Math.min(1, i / count + 0.35));
        } else if (colorMode === 'rainbow') {
          const hue = (i / count) * 320 + t * 12;
          col = `hsl(${hue % 360}, 85%, ${55 + val * 12}%)`;
          if (gradient) top = `hsl(${(hue + 60) % 360}, 90%, 70%)`;
        } else {
          col = v.color;
          if (gradient) top = v.color2 || lighten(v.color);
        }

        /* Degrade barın kendi boyuna değil en yüksek bar boyuna göre:
           kısa bar taban rengini, uzun bar uç rengini de gösterir (ölçer). */
        const fill = (dir) => {
          if (!top) return col;
          const g = ctx.createLinearGradient(0, baseY, 0, baseY + dir * maxH);
          g.addColorStop(0, col);
          g.addColorStop(1, top);
          return g;
        };

        if (centred) {
          ctx.fillStyle = fill(-1);
          drawBar(x, bh, -1);
          ctx.fillStyle = fill(1);
          drawBar(x, bh, 1);
        } else {
          ctx.fillStyle = fill(down ? 1 : -1);
          drawBar(x, bh, down ? 1 : -1);
        }

        // tepe noktaları
        if (v.cap) {
          if (val * maxH >= this.peaks[i]) {
            this.peaks[i] = val * maxH;
            this.peakVel[i] = 0;
            this.peakHold[i] = capHold;
          } else if (this.peakHold[i] > 0) {
            this.peakHold[i] = Math.max(0, this.peakHold[i] - dt);
          } else {
            /* 60 Hz'de eski kare adımıyla birebir: ivme H × 0,0009 px/kare²
               = H × 3,24 px/s²; hız px/s, yol hız × dt. */
            this.peakVel[i] += H * PEAK_ACCEL * capFall * dt;
            this.peaks[i] = Math.max(0, this.peaks[i] - this.peakVel[i] * dt);
          }
          ctx.fillStyle = capOwn || ((colorMode === 'rainbow') ? col : (colorMode === 'theme' ? lighten(col) : lighten(v.color)));
          if (down) ctx.fillRect(x, baseY + this.peaks[i] + 1, bw, 2.5);
          else ctx.fillRect(x, baseY - this.peaks[i] - 3, bw, 2.5);
          if (centred) ctx.fillRect(x, baseY + this.peaks[i] + 1, bw, 2.5);
        }
      }
      ctx.restore();

      /* Zemin yansıması (#842): taban çizgisinin altına, barların aynası,
         aşağı doğru sönerek. Yalnız tabanda duran barlarda ve taban kadranın
         içindeyken; ortada duran barlar zaten iki yönlü. Tuval kendi üstüne
         çiziliyor (2B tuval bunu bir kopyadan yapıyor), sonra sönme
         'destination-out' degradesiyle yalnız tabanın altında siliniyor.
         Sesten başka hiçbir şeye bağlı değil: canlı ve dışa aktarım aynı. */
      const refl = clamp01(Number(v.reflection) || 0);
      // Aşağı büyüyen barlar tabanın altını zaten dolduruyor; yansıma yok
      if (refl > 0 && !centred && !down && baseY < H - 1) {
        const len = Math.min(H - baseY, maxH * Math.max(0.05, Math.min(1, v.reflectionLength == null ? 0.4 : Number(v.reflectionLength))));
        if (len >= 1) {
          ctx.save();
          ctx.globalAlpha = refl;
          ctx.translate(0, 2 * baseY);
          ctx.scale(1, -1);
          ctx.drawImage(this.canvas, areaX, baseY - len, areaW, len, areaX, baseY - len, areaW, len);
          ctx.restore();
          ctx.save();
          ctx.globalCompositeOperation = 'destination-out';
          const g = ctx.createLinearGradient(0, baseY, 0, baseY + len);
          g.addColorStop(0, 'rgba(0,0,0,0.15)');
          g.addColorStop(1, 'rgba(0,0,0,1)');
          ctx.fillStyle = g;
          ctx.fillRect(areaX - 1, baseY, areaW + 2, len + 1);
          ctx.restore();
        }
      }

      this.glow.apply(this.canvas, v.glow, 0.9);
    }

    dispose() {}
  }

  function roundRect(ctx, x, y, w, h, r) {
    r = Math.min(r, w / 2, Math.abs(h) / 2);
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }

  function lighten(hex) {
    if (typeof hex === 'string' && hex.startsWith('rgb')) {
      const m = hex.match(/[\d.]+/g);
      if (m && m.length >= 3) {
        return `rgb(${Math.min(255, +m[0] + 60)},${Math.min(255, +m[1] + 60)},${Math.min(255, +m[2] + 60)})`;
      }
    }
    const c = window.SV.hexToRgb01(hex);
    return `rgb(${Math.min(255, c[0] * 255 + 60) | 0},${Math.min(255, c[1] * 255 + 60) | 0},${Math.min(255, c[2] * 255 + 60) | 0})`;
  }

  window.SVModes = window.SVModes || {};
  window.SVModes.bars = BarsMode;
})();
