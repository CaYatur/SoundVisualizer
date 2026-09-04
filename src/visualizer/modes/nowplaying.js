'use strict';
/* Çalan parça katmanı.
 *
 * Görselleştirici sözleşmesini kullanır (new Mode(canvas) / draw / dispose),
 * böylece katman yığınında istenen sıraya konabiliyor — parçacıkların üstünde
 * ama logonun altında gibi.
 *
 * Bilgi işletim sisteminin medya oturumundan geliyor ve SÜREKLİ akmıyor:
 * kaynak konumu ancak ara sıra güncelliyor. Aradaki değeri her kare
 * SVNowPlaying çıpadan hesaplıyor, o yüzden burada yalnızca çizim var.
 *
 * Yazı ölçüsü ekranın KISA kenarına orandır; aynı sahne 1080p monitörde ve
 * 4K projektörde aynı görünsün diye (metin katmanıyla aynı kural).
 */
(function () {
  const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
  const smooth = (k) => k * k * (3 - 2 * k);

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
  const rgba = (c, a) => 'rgba(' + c[0] + ',' + c[1] + ',' + c[2] + ',' + a + ')';
  const hexRgb = (h) => window.SV.hexToRgb01(h || '#ffffff').map((v) => (v * 255) | 0);

  const DEFAULT_FONT = 'system-ui, -apple-system, Segoe UI, Roboto, sans-serif';

  class NowPlayingMode {
    constructor(canvas) {
      this.canvas = canvas;
      this.ctx = canvas.getContext('2d');
      this.tracker = window.SVNowPlaying ? new window.SVNowPlaying.Tracker() : null;
      this.scrollT = 0;
      this.lastKey = '';
    }
    resize() {}

    /* Gösterilecek ham durum. Sistemden ya da elle yazılandan. */
    _source(N, cfg) {
      const c = cfg.nowplaying || {};
      if ((c.source || 'system') === 'manual') {
        const m = c.manual || {};
        const any = !!(m.title || m.artist || m.album);
        return Object.assign({}, N.EMPTY, {
          has: any, playing: any,
          title: m.title || '', artist: m.artist || '', album: m.album || '',
        });
      }
      return (window.SVNowLive && window.SVNowLive.state) || N.EMPTY;
    }

    draw(audio, cfg, t, dt) {
      const ctx = this.ctx;
      const W = this.canvas.width;
      const H = this.canvas.height;
      ctx.clearRect(0, 0, W, H);

      const N = window.SVNowPlaying;
      if (!N) return;
      const c = cfg.nowplaying || {};
      if (c.enabled === false) return;

      const step = Math.min(0.05, dt || 0.016);
      this.scrollT += step;

      // ---- durum ve parça değişimi
      const raw = this._source(N, cfg);
      const now = Date.now();
      if (this.tracker) this.tracker.update(raw, now);
      const st = N.resolve(raw, now);
      if (!st.has) return;

      // ---- görünürlük zarfı (sürekli mi, değişimde mi)
      const age = this.tracker ? this.tracker.ageAt(now) : Infinity;
      const env = N.envelope(age, c);
      if (env.alpha <= 0.001) return;

      const style = N.styleOf(c.style);
      const pick = (v, k) => (v === null || v === undefined ? style[k] : v);

      const parts = N.compose(st, Object.assign({}, c, {
        uppercase: pick(c.uppercase, 'uppercase'),
      }));
      if (!parts.hasText && !parts.hasTime && !parts.showBar) return;

      // ---- ölçüler
      const minDim = Math.min(W, H);
      const size = Math.max(8, (c.size == null ? 0.042 : c.size) * minDim);
      const weight = pick(c.weight, 'weight');
      const family = c.font || (cfg.text && cfg.text.font) || DEFAULT_FONT;
      const align = c.align || 'center';
      const maxW = W * clamp(c.maxWidth == null ? 0.8 : c.maxWidth, 0.1, 1);

      const sens = (cfg.visualizer && cfg.visualizer.sensitivity) || 1;
      const bass = clamp(audio.bass * sens, 0, 1.4);
      const pulse = 1 + bass * (c.audioScale == null ? 0.04 : c.audioScale);

      const baseCol = c.useCustomColor ? hexRgb(c.color) : paletteAt(cfg, 0.9);
      const dimCol = c.useCustomColor ? hexRgb(c.colorDim) : paletteAt(cfg, 0.6);
      const barCol = c.useCustomColor ? hexRgb(c.colorBar) : paletteAt(cfg, 0.3);
      const dimA = style.dimOpacity;

      const outline = pick(c.outline, 'outline');
      const shadow = pick(c.shadow, 'shadow');

      // ---- satırları kur
      const gap = (c.lineGap == null ? 0.32 : c.lineGap) * size;
      const rows = [];
      const sep = c.separator === undefined ? ' — ' : String(c.separator);

      if (c.oneLine) {
        const one = [parts.title, parts.artist].filter(Boolean).join(sep);
        if (one) rows.push({ text: one, size: size, col: baseCol, a: 1, scroll: true });
      } else {
        if (parts.title) rows.push({ text: parts.title, size: size, col: baseCol, a: 1, scroll: true });
        if (parts.artist) rows.push({ text: parts.artist, size: size * 0.62, col: dimCol, a: dimA, scroll: true });
      }
      if (parts.album) rows.push({ text: parts.album, size: size * 0.52, col: dimCol, a: dimA * 0.85, scroll: true });
      if (parts.app) rows.push({ text: parts.app, size: size * 0.46, col: dimCol, a: dimA * 0.7, scroll: false });

      const barH = pick(c.barHeight, 'barHeight') * minDim;
      const barGap = (c.barGap == null ? 0.5 : c.barGap) * size;
      const hasBar = parts.showBar;
      const timeRow = parts.hasTime ? { text: parts.time, size: size * 0.5, col: dimCol, a: dimA } : null;

      // ---- toplam yükseklik (grup dikeyde ortalanır)
      let total = 0;
      rows.forEach((r, i) => { total += r.size + (i ? gap : 0); });
      if (hasBar) total += barGap + barH;
      if (timeRow) total += (hasBar ? gap * 0.7 : barGap) + timeRow.size;

      const cx = W * (c.x == null ? 0.5 : c.x);
      const cy = H * (c.y == null ? 0.86 : c.y);

      // ---- giriş canlandırması
      const sp = N.speedOf(c.speed);
      const animDur = Math.max(0.05, c.animDuration == null ? sp.anim : c.animDuration);
      const kIn = c.mode === 'onChange'
        ? clamp(age / animDur, 0, 1)
        : clamp(age / animDur, 0, 1);
      const ease = smooth(kIn);
      const anim = c.animation || 'slideUp';

      let ox = 0;
      let oy = 0;
      let scale = 1;
      let animA = 1;
      if (anim === 'fade') animA = ease;
      else if (anim === 'slideUp') { animA = ease; oy = (1 - ease) * size * 0.9; }
      else if (anim === 'slideLeft') { animA = ease; ox = (1 - ease) * size * 2; }
      else if (anim === 'scale') { animA = ease; scale = 0.82 + ease * 0.18; }

      ctx.save();
      ctx.globalAlpha = clamp(env.alpha * animA * (c.opacity == null ? 1 : c.opacity), 0, 1);
      ctx.translate(cx + ox, cy + oy);
      ctx.scale(scale * pulse, scale * pulse);
      ctx.textBaseline = 'middle';

      // Grup, verilen noktada dikeyde ortalanır
      let y = -total / 2;

      const boxLeft = align === 'left' ? 0 : align === 'right' ? -maxW : -maxW / 2;

      const paint = (text, fsize, col, alpha, xOff) => {
        ctx.font = weight + ' ' + fsize.toFixed(1) + 'px ' + family;
        if (shadow > 0) {
          ctx.shadowColor = 'rgba(0,0,0,0.75)';
          ctx.shadowBlur = shadow * fsize * 0.35;
          ctx.shadowOffsetY = shadow * fsize * 0.06;
        }
        if (outline > 0) {
          ctx.lineWidth = Math.max(1, outline * fsize * 0.07);
          ctx.strokeStyle = 'rgba(0,0,0,0.9)';
          ctx.lineJoin = 'round';
          ctx.strokeText(text, xOff, 0);
        }
        ctx.fillStyle = rgba(col, alpha);
        ctx.fillText(text, xOff, 0);
        ctx.shadowBlur = 0;
        ctx.shadowOffsetY = 0;
      };

      /* Bir satırı çizer. Sığmıyorsa kutuya kırpıp ileri geri kaydırır —
         uzun başlığı ortadan kesmek yerine tamamını okutmak için. */
      const drawRow = (r, i) => {
        const fsize = r.size;
        y += (i ? gap : 0) + fsize / 2;
        ctx.save();
        ctx.translate(0, y);
        ctx.font = weight + ' ' + fsize.toFixed(1) + 'px ' + family;
        const wdt = ctx.measureText(r.text).width;
        const over = wdt - maxW;

        if (over > 0 && r.scroll && c.scrollLongTitles !== false) {
          ctx.beginPath();
          ctx.rect(boxLeft, -fsize, maxW, fsize * 2);
          ctx.clip();
          // Uçlarda bekleyen ileri-geri gezinme
          const cycle = 2.5 + over / Math.max(1, fsize * 3);
          const ph = (this.scrollT % (cycle * 2)) / cycle;
          const pp = ph < 1 ? ph : 2 - ph;
          const e = smooth(clamp((pp - 0.18) / 0.64, 0, 1));
          const prevAlign = ctx.textAlign;
          ctx.textAlign = 'left';
          paint(r.text, fsize, r.col, r.a, boxLeft - over * e);
          ctx.textAlign = prevAlign;
        } else if (anim === 'typewriter' && kIn < 1) {
          // Harf harf beliren yazı
          const chars = Array.from(r.text);
          const n = Math.max(0, Math.round(chars.length * ease));
          ctx.textAlign = align;
          paint(chars.slice(0, n).join(''), fsize, r.col, r.a, 0);
        } else if (anim === 'wipe' && kIn < 1) {
          // Soldan sağa açılan perde
          ctx.beginPath();
          const l = align === 'left' ? 0 : align === 'right' ? -wdt : -wdt / 2;
          ctx.rect(l, -fsize, wdt * ease, fsize * 2);
          ctx.clip();
          ctx.textAlign = align;
          paint(r.text, fsize, r.col, r.a, 0);
        } else {
          ctx.textAlign = align;
          paint(r.text, fsize, r.col, r.a, 0);
        }
        ctx.restore();
        y += fsize / 2;
      };

      rows.forEach(drawRow);

      // ---- ilerleme çubuğu
      if (hasBar) {
        y += barGap;
        const bw = W * clamp(c.barWidth == null ? 0.42 : c.barWidth, 0.05, 1);
        const bx = align === 'left' ? 0 : align === 'right' ? -bw : -bw / 2;
        const by = y;
        const segs = pick(c.barSegments, 'barSegments');
        const rounded = pick(c.barRadius, 'barRadius');
        const backA = pick(c.barBackOpacity, 'barBackOpacity');
        const p = clamp(parts.progress, 0, 1);

        const rect = (x, w, h, col, a) => {
          ctx.fillStyle = rgba(col, a);
          if (rounded && ctx.roundRect) {
            ctx.beginPath();
            ctx.roundRect(x, by, w, h, h / 2);
            ctx.fill();
          } else {
            ctx.fillRect(x, by, w, h);
          }
        };

        if (segs > 0) {
          /* Bölmeli çubuk — eski dönem görünümü. Dolu bölmeler parlak,
             boşlar sönük. */
          const cell = bw / segs;
          const pad = Math.max(1, cell * 0.22);
          const lit = Math.round(segs * p);
          for (let i = 0; i < segs; i++) {
            const on = i < lit;
            ctx.fillStyle = rgba(on ? barCol : dimCol, on ? 1 : backA);
            ctx.fillRect(bx + i * cell, by, cell - pad, barH);
          }
        } else {
          rect(bx, bw, barH, dimCol, backA);
          if (p > 0) rect(bx, Math.max(barH, bw * p), barH, barCol, 1);
        }
        y += barH;
      }

      // ---- süre satırı
      if (timeRow) {
        y += (hasBar ? gap * 0.7 : barGap) + timeRow.size / 2;
        ctx.save();
        ctx.translate(0, y);
        ctx.textAlign = align;
        paint(timeRow.text, timeRow.size, timeRow.col, timeRow.a, 0);
        ctx.restore();
        y += timeRow.size / 2;
      }

      ctx.restore();
    }

    dispose() { this.tracker = null; }
  }

  window.SVModes = window.SVModes || {};
  window.SVModes.nowplaying = NowPlayingMode;
})();
