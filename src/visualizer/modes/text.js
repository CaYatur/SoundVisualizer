'use strict';
/* Metin ve şarkı sözü katmanı.

   Görselleştirici sözleşmesini kullanıyor (new Mode(canvas) / draw / dispose),
   böylece bir katman olarak istenen sıraya konabiliyor: sözün arkaplanın
   üstünde ama parçacıkların altında olması gerekebilir.

   Üç kaynak:
     'static'  — sabit metin
     'lyrics'  — LRC/SRT dosyasından zamanlanmış söz (karaoke vurgusuyla)
     'now'     — çalan parçanın bilgisi

   Yazı tipi ölçüsü ekranın KISA kenarına oranla verilir; aynı sahne 1080p
   monitörde ve 4K projektörde aynı görünsün diye. Piksel cinsinden vermek
   çözünürlük değişince yazıyı kaybettirirdi. */
(function () {
  const TAU = Math.PI * 2;
  const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);

  function colorsOf(cfg) {
    const c = (cfg.background && cfg.background.gradient && cfg.background.gradient.colors) || [];
    return c.length ? c : ['#ffffff', '#7c5cff'];
  }
  function paletteAt(cfg, pos) {
    const cols = colorsOf(cfg);
    const x = clamp(pos, 0, 0.9999) * (cols.length - 1);
    const i = Math.floor(x);
    const f = x - i;
    const a = window.SV.hexToRgb01(cols[i]);
    const b = window.SV.hexToRgb01(cols[Math.min(cols.length - 1, i + 1)]);
    return [
      ((a[0] + (b[0] - a[0]) * f) * 255) | 0,
      ((a[1] + (b[1] - a[1]) * f) * 255) | 0,
      ((a[2] + (b[2] - a[2]) * f) * 255) | 0,
    ];
  }
  const rgba = (c, a) => `rgba(${c[0]},${c[1]},${c[2]},${a})`;

  class TextMode {
    constructor(canvas) {
      this.canvas = canvas;
      this.ctx = canvas.getContext('2d');
      this.doc = null;
      this.docKey = '';
      this.t0 = 0;
      this.lastLine = -1;
      this.lineAge = 0;
      this.marquee = 0;
    }
    resize() {}

    _ensureLyrics(t) {
      const key = (t.lyricsSource || '').length + ':' + (t.lyricsSource || '').slice(0, 40);
      if (key === this.docKey) return;
      this.docKey = key;
      this.doc = t.lyricsSource && window.SVLyrics ? window.SVLyrics.parse(t.lyricsSource) : null;
    }

    draw(audio, cfg, t, dt) {
      const ctx = this.ctx;
      const W = this.canvas.width;
      const H = this.canvas.height;
      const step = Math.min(0.05, dt || 0.016);
      ctx.clearRect(0, 0, W, H);
      const T = cfg.text || {};
      if (T.enabled === false) return;

      const minDim = Math.min(W, H);
      const size = Math.max(8, (T.size == null ? 0.09 : T.size) * minDim);
      const weight = T.weight || 700;
      const family = T.font || 'system-ui, -apple-system, Segoe UI, Roboto, sans-serif';
      ctx.font = weight + ' ' + size.toFixed(1) + 'px ' + family;
      ctx.textBaseline = 'middle';
      ctx.textAlign = T.align || 'center';

      const sens = (cfg.visualizer && cfg.visualizer.sensitivity) || 1;
      const level = clamp(audio.level * sens, 0, 1.4);
      const bass = clamp(audio.bass * sens, 0, 1.4);

      let content = '';
      let progress = 0;
      let wordIndex = -1;
      let words = null;

      const src = T.source || 'static';
      if (src === 'lyrics') {
        this._ensureLyrics(T);
        if (this.doc && window.SVLyrics) {
          // Söz saati: dışa aktarımda kare saatinden, canlıda geçen süreden
          const hit = window.SVLyrics.at(this.doc, t, T.offset || 0);
          if (hit.index >= 0) {
            content = hit.line.text;
            progress = hit.progress;
            wordIndex = hit.wordIndex;
            words = hit.line.words && hit.line.words.length ? hit.line.words : null;
          }
          if (hit.index !== this.lastLine) { this.lastLine = hit.index; this.lineAge = 0; }
          else this.lineAge += step;
        }
      } else if (src === 'now') {
        const n = T.nowPlaying || {};
        content = [n.title, n.artist].filter(Boolean).join(' — ') || (T.content || '');
        this.lineAge += step;
      } else {
        content = T.content || '';
        this.lineAge += step;
      }
      if (!content) return;

      const cx = T.align === 'left' ? W * 0.06 : T.align === 'right' ? W * 0.94 : W * (T.x == null ? 0.5 : T.x);
      const cy = H * (T.y == null ? 0.5 : T.y);

      // Giriş canlandırması
      const anim = T.animation || 'fade';
      const dur = Math.max(0.05, T.animDuration == null ? 0.45 : T.animDuration);
      const k = clamp(this.lineAge / dur, 0, 1);
      const ease = k * k * (3 - 2 * k);

      ctx.save();
      let alpha = 1;
      let ox = 0;
      let oy = 0;
      let scale = 1;
      if (anim === 'fade') alpha = ease;
      else if (anim === 'slideUp') { alpha = ease; oy = (1 - ease) * size * 0.8; }
      else if (anim === 'slideLeft') { alpha = ease; ox = (1 - ease) * size * 1.5; }
      else if (anim === 'scale') { alpha = ease; scale = 0.7 + ease * 0.3; }
      else if (anim === 'none') alpha = 1;

      // Sese tepki: nabız ve titreşim
      const pulse = 1 + bass * (T.audioScale == null ? 0.12 : T.audioScale);
      const jitter = level * (T.audioJitter || 0) * size * 0.15;

      ctx.globalAlpha = clamp(alpha * (T.opacity == null ? 1 : T.opacity), 0, 1);
      ctx.translate(cx + ox, cy + oy);
      ctx.scale(scale * pulse, scale * pulse);

      const drawOne = (text, x, y, fill) => {
        if (T.shadow > 0) {
          ctx.shadowColor = 'rgba(0,0,0,0.75)';
          ctx.shadowBlur = T.shadow * size * 0.3;
          ctx.shadowOffsetY = T.shadow * size * 0.05;
        }
        if (T.outline > 0) {
          ctx.lineWidth = T.outline * size * 0.06;
          ctx.strokeStyle = 'rgba(0,0,0,0.85)';
          ctx.lineJoin = 'round';
          ctx.strokeText(text, x, y);
        }
        ctx.fillStyle = fill;
        ctx.fillText(text, x, y);
        ctx.shadowBlur = 0;
        ctx.shadowOffsetY = 0;
      };

      const baseColor = T.useCustomColor
        ? window.SV.hexToRgb01(T.color || '#ffffff').map((v) => (v * 255) | 0)
        : paletteAt(cfg, 0.85);
      const hiColor = T.useCustomColor
        ? window.SV.hexToRgb01(T.colorHighlight || '#ffd23f').map((v) => (v * 255) | 0)
        : paletteAt(cfg, 0.35);

      if (words && T.karaoke !== false) {
        /* Karaoke: satır tek parça çizilmez. Söylenen kelimeler vurgulu,
           gelecek kelimeler sönük. Kelimeleri ayrı ayrı ölçüp yerleştirmek
           gerekiyor çünkü tek fillText çağrısı iki renk veremez. */
        const parts = words.map((w) => w.text);
        const widths = parts.map((p) => ctx.measureText(p).width);
        const total = widths.reduce((s, w) => s + w, 0);
        let x = ctx.textAlign === 'center' ? -total / 2
          : ctx.textAlign === 'right' ? -total : 0;
        const prevAlign = ctx.textAlign;
        ctx.textAlign = 'left';
        for (let i = 0; i < parts.length; i++) {
          const sung = i <= wordIndex;
          drawOne(parts[i], x, jitter * Math.sin(i * 1.7 + t * 9),
            rgba(sung ? hiColor : baseColor, sung ? 1 : 0.45));
          x += widths[i];
        }
        ctx.textAlign = prevAlign;
      } else if (T.perCharacter) {
        // Harf harf: her harf spektrumun bir bandına tepki verir
        const chars = Array.from(content);
        const widths = chars.map((c) => ctx.measureText(c).width);
        const total = widths.reduce((s, w) => s + w, 0);
        let x = ctx.textAlign === 'center' ? -total / 2
          : ctx.textAlign === 'right' ? -total : 0;
        const prevAlign = ctx.textAlign;
        ctx.textAlign = 'left';
        const bars = audio.getBars(Math.max(1, chars.length), 60, 12000);
        for (let i = 0; i < chars.length; i++) {
          const e = clamp(bars[i] * sens, 0, 1);
          const dy = -e * size * (T.audioLift == null ? 0.25 : T.audioLift);
          drawOne(chars[i], x, dy, rgba(paletteAt(cfg, i / chars.length), 0.55 + e * 0.45));
          x += widths[i];
        }
        ctx.textAlign = prevAlign;
      } else if (T.marquee) {
        // Kayan yazı: metin genişliğinden uzun bir döngüde sürekli akar
        this.marquee += step * (T.marqueeSpeed == null ? 0.12 : T.marqueeSpeed) * W;
        const wdt = ctx.measureText(content).width + size * 2;
        const off = -((this.marquee % wdt));
        const prevAlign = ctx.textAlign;
        ctx.textAlign = 'left';
        drawOne(content, off - W / 2, 0, rgba(baseColor, 1));
        drawOne(content, off - W / 2 + wdt, 0, rgba(baseColor, 1));
        ctx.textAlign = prevAlign;
      } else {
        // Tek parça. İlerleme vurgusu istenirse kırpma ile yapılır.
        if (src === 'lyrics' && T.karaoke !== false && progress > 0) {
          const wdt = ctx.measureText(content).width;
          const left = ctx.textAlign === 'center' ? -wdt / 2 : ctx.textAlign === 'right' ? -wdt : 0;
          drawOne(content, 0, 0, rgba(baseColor, 0.45));
          ctx.save();
          ctx.beginPath();
          ctx.rect(left, -size, wdt * progress, size * 2);
          ctx.clip();
          drawOne(content, 0, 0, rgba(hiColor, 1));
          ctx.restore();
        } else {
          drawOne(content, 0, 0, rgba(baseColor, 1));
        }
      }
      ctx.restore();
    }

    dispose() { this.doc = null; }
  }

  window.SVModes = window.SVModes || {};
  window.SVModes.text = TextMode;
})();
