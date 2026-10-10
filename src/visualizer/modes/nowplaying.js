/*
 * SoundVisualizer — CaYaDev Ses Görselleştirici
 * Copyright (c) 2026 Çağan Turgut (CaYatur) — CaYaDev, https://cayadev.com
 * https://github.com/CaYatur/SoundVisualizer
 * SPDX-License-Identifier: MIT
 */
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

  /* main'deki ease'li gidiş-dönüş. Kısa taşma en az 0,85 sn sürer;
     hız çarpanı süreyi böler, pikseli bir karede yutmaz. */
  function overflowAlong(clock, overPx, fontPx, speed) {
    const rate = Math.max(0.15, speed || 1);
    const cruise = Math.max(1, fontPx) * 3;
    const travel = Math.max(0.85, overPx / cruise) / rate;
    const pause = 0.28 / rate;
    const half = pause + travel;
    let local = clock % (half * 2);
    const ease = (u) => {
      const x = u < 0 ? 0 : u > 1 ? 1 : u;
      return x * x * (3 - 2 * x);
    };
    if (local < pause) return 0;
    if (local < half) return overPx * ease((local - pause) / travel);
    if (local < half + pause) return overPx;
    return overPx * (1 - ease((local - half - pause) / travel));
  }

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
      this._coverImg = null;
      this._coverKey = '';
    }

    _coverImage(url) {
      if (!url || typeof url !== 'string' || url.length < 20) {
        this._coverImg = null; this._coverKey = '';
        return null;
      }
      if (this._coverKey === url && this._coverImg) return this._coverImg;
      this._coverKey = url;
      const img = new Image();
      img.decoding = 'async';
      img.src = url;
      this._coverImg = img;
      return img;
    }
    resize() {}

    /* Gösterilecek ham durum. Sistemden ya da elle yazılandan. */
    _source(N, cfg) {
      const c = cfg.nowplaying || {};
      if ((c.source || 'system') === 'manual') {
        const m = c.manual || {};
        const dur = Math.max(0, Number(m.duration) || 0);
        const any = !!(m.title || m.artist || m.album || dur > 0);
        return Object.assign({}, N.EMPTY, {
          has: any, playing: false,
          title: m.title || '', artist: m.artist || '', album: m.album || '',
          duration: dur,
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
      const scrollSpeed = clamp(c.scrollSpeed == null ? 1 : c.scrollSpeed, 0.15, 4);
      this.scrollT += step;

      // ---- durum ve parça değişimi
      const raw = this._source(N, cfg);
      const now = Date.now();
      if (this.tracker) this.tracker.update(raw, now);
      let st = N.resolve(raw, now);
      if (!st.has) {
        /* Şablon kartının yer tutucusu (`placeholder`): parça çalmıyorken
           yalnız panel önizlemesinde "PARÇA ADI / SANATÇI ADI" görünür,
           yerleşim çalmadan da görülsün. Çıkışlarda, yayında ve kayıtta
           kart parça gelene kadar boş kalır. */
        if (!(c.placeholder && typeof window !== 'undefined' && window.SVPanel)) return;
        const I = window.SVI18n;
        const tr = (k) => (I && typeof I.t === 'function' ? I.t(k) : k);
        st = Object.assign({}, st, { has: true, playing: false, title: tr('PARÇA ADI'), artist: tr('SANATÇI ADI'), album: '', app: '' });
      }

      // ---- görünürlük zarfı (sürekli mi, değişimde mi)
      const age = this.tracker ? this.tracker.ageAt(now) : Infinity;
      const env = N.envelope(age, c);
      if (env.alpha <= 0.001) return;

      const style = N.styleOf(c.style);
      const pick = (v, k) => (v === null || v === undefined ? style[k] : v);

      /* Geçen süre, kalan süre, çubuk ve oynatıcı adı sistem oturumundan gelir.
         macOS/Linux bunu okuyamaz. Elle yazılan toplam süre gösterilir;
         geçen süre uydurulmaz. */
      const platWin = !(typeof window !== 'undefined' && window.SV_PLATFORM && window.SV_PLATFORM.isWindows === false);
      const fromSystem = platWin && (c.source || 'system') === 'system';
      const manualDur = Math.max(0, Number((c.manual && c.manual.duration) || 0));
      const show = fromSystem ? c.show : Object.assign({}, c.show, {
        appName: false, elapsed: false, remaining: false, bar: false,
        total: manualDur > 0,
      });
      const parts = N.compose(st, Object.assign({}, c, {
        show,
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

      /* Katmanın kendi kipi önce gelir. visualizer.colorMode yedek;
         eski kayıtlarda useCustomColor sabit rengi anlatır. */
      const colorMode = c.colorMode
        || (c.useCustomColor ? 'custom' : null)
        || (cfg.visualizer && cfg.visualizer.colorMode)
        || 'theme';
      let baseCol, dimCol, barCol;
      if (colorMode === 'custom') {
        baseCol = hexRgb(c.color);
        dimCol = hexRgb(c.colorDim);
        barCol = hexRgb(c.colorBar);
      } else if (colorMode === 'rainbow') {
        const hsl = (pos) => {
          const h = ((t * 40 + pos * 300) % 360 + 360) % 360;
          const a = h / 60;
          const x = 1 - Math.abs(a % 2 - 1);
          let r = 0, g = 0, b = 0;
          if (a < 1) { r = 1; g = x; }
          else if (a < 2) { r = x; g = 1; }
          else if (a < 3) { g = 1; b = x; }
          else if (a < 4) { g = x; b = 1; }
          else if (a < 5) { r = x; b = 1; }
          else { r = 1; b = x; }
          return [(r * 255) | 0, (g * 255) | 0, (b * 255) | 0];
        };
        baseCol = hsl(0.9);
        dimCol = hsl(0.6);
        barCol = hsl(0.3);
      } else {
        baseCol = paletteAt(cfg, 0.9);
        dimCol = paletteAt(cfg, 0.6);
        barCol = paletteAt(cfg, 0.3);
      }
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

      const vAlign = c.vAlign || 'middle';
      const yOrigin = vAlign === 'top' ? 0 : vAlign === 'bottom' ? -total : -total / 2;

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

      // ---- album cover overlay (optional; default off)
      // Text/bar stay anchored at (cx,cy). Cover attaches outside the bar/text
      // column (left/right) or above the title block (top). Size is relative to
      // the display short side (minDim), like logo scale; values > 1 keep the
      // legacy "relative to text-block height" meaning.
      const wantCover = !!c.coverOverlay;
      /* auto: Windows oturumundaki kapak, yoksa elle yüklenen.
         manual: yalnız elle yüklenen. Sistem kaynağı kapalıysa otomatik kapak yok. */
      const uploaded = (c.manual && c.manual.artwork) || '';
      const useSystemArt = fromSystem && (c.coverSource || 'auto') !== 'manual';
      const artUrl = !wantCover ? '' : (useSystemArt ? ((raw && raw.artwork) || uploaded) : uploaded);
      const coverImg = wantCover ? this._coverImage(artUrl) : null;
      const coverReady = !!(coverImg && coverImg.complete && coverImg.naturalWidth > 0);
      const coverSizeVal = c.coverSize == null ? 0.14 : c.coverSize;
      const coverPx = coverReady
        ? Math.max(8, coverSizeVal > 1 ? total * coverSizeVal : minDim * coverSizeVal)
        : 0;
      // Fit mode: default natural (keep aspect — rect covers must not square-crop).
      // square = legacy stretch-to-square; cover/contain = square box + object-fit.
      let coverFit = c.coverFit || 'natural';
      if (coverFit === 'aspect') coverFit = 'natural'; // alias
      const iw = coverReady ? (coverImg.naturalWidth || 1) : 1;
      const ih = coverReady ? (coverImg.naturalHeight || 1) : 1;
      let coverW = coverPx;
      let coverH = coverPx;
      let drawFit = 'stretch'; // passed to SVRoundImage
      if (coverReady) {
        if (coverFit === 'natural') {
          if (iw >= ih) { coverW = coverPx; coverH = coverPx * (ih / iw); }
          else { coverH = coverPx; coverW = coverPx * (iw / ih); }
          drawFit = 'stretch';
        } else if (coverFit === 'cover') {
          coverW = coverH = coverPx;
          drawFit = 'cover';
        } else if (coverFit === 'contain') {
          coverW = coverH = coverPx;
          drawFit = 'contain';
        } else {
          // square (legacy): stretch into square
          coverW = coverH = coverPx;
          drawFit = 'stretch';
        }
      }
      const coverGapPx = coverReady
        ? Math.max(coverW, coverH) * (c.coverGap == null ? 0.35 : c.coverGap)
        : 0;
      let side = c.coverSide || 'auto';
      if (side === 'auto') side = 'top'; // default: above title

      // Bar/text column width used to park left/right covers flush to the block.
      const bwRef = hasBar ? W * clamp(c.barWidth == null ? 0.42 : c.barWidth, 0.05, 1) : 0;
      const refW = hasBar ? bwRef : maxW;
      const blockLeft = align === 'left' ? 0 : align === 'right' ? -refW : -refW / 2;
      const blockRight = align === 'left' ? refW : align === 'right' ? 0 : refW / 2;
      // Vertical center of title/artist rows only (exclude bar + time) so a
      // left/right cover does not sit over the progress bar.
      let textH = 0;
      rows.forEach((r, i) => { textH += r.size + (i ? gap : 0); });
      const textCenterY = yOrigin + textH / 2;

      /* `anchor: 'group'`: x kapağın dış kenarını gösterir (kapak + yazı
         birlikte yerleşir). Varsayılan 'text' eski davranış: x yazının
         kenarı, kapak onun dışına asılır. Konum genişliğe, kapak kısa kenara
         oranlı olduğundan eski davranışta kapak 9:16 gibi dar kadrajlarda
         ekrandan taşabiliyordu; grup çıpasında her oranda kenar boşluğu
         aynı kalır, kapak yoksa yazı kenara yaslanır. */
      let groupShift = 0;
      if (c.anchor === 'group' && coverReady) {
        if (side === 'left' && align === 'left') groupShift = coverW + coverGapPx;
        else if (side === 'right' && align === 'right') groupShift = -(coverW + coverGapPx);
      }
      const ax = cx + groupShift;

      ctx.save();
      ctx.globalAlpha = clamp(env.alpha * animA * (c.opacity == null ? 1 : c.opacity), 0, 1);
      ctx.translate(ax + ox, cy + oy);
      ctx.scale(scale * pulse, scale * pulse);
      ctx.textBaseline = 'middle';

      if (coverReady) {
        const minCover = Math.min(coverW, coverH);
        const rad = Math.max(0, Math.min(0.5, c.coverRadius == null ? 0.14 : c.coverRadius)) * minCover;
        let coverCx = 0;
        let coverCy = textCenterY;
        if (side === 'top') {
          coverCx = align === 'left' ? coverW / 2 : align === 'right' ? -coverW / 2 : 0;
          coverCy = yOrigin - coverGapPx - coverH / 2;
        } else if (side === 'left') {
          coverCx = blockLeft - coverGapPx - coverW / 2;
        } else {
          coverCx = blockRight + coverGapPx + coverW / 2;
        }
        // Cover has its own bass pulse (coverAudioScale), independent of text audioScale.
        const coverPulse = 1 + bass * (c.coverAudioScale == null ? 0 : c.coverAudioScale);
        ctx.save();
        // Undo shared text pulse so cover reacts only via coverAudioScale.
        ctx.scale(1 / pulse, 1 / pulse);
        ctx.translate(coverCx, coverCy);
        ctx.scale(coverPulse, coverPulse);
        /* Kapak parlaması logo ile aynı kenar halesi. Slider visualizer.glow.
           Metin gölgesi kapağa shadowBlur basmaz. */
        const glowAmt = Math.max(0, Number(cfg.visualizer && cfg.visualizer.glow) || 0);
        const coverGlow = glowAmt > 0 ? glowAmt * 40 * (minDim / 1080) : 0;
        if (window.SVRoundImage && window.SVRoundImage.drawImage) {
          window.SVRoundImage.drawImage(ctx, coverImg, -coverW / 2, -coverH / 2, coverW, coverH, {
            radiusPx: rad,
            glowBlur: coverGlow,
            glowAmount: glowAmt,
            edgeBloom: true,
            owner: this,
            fit: drawFit,
          });
        } else {
          ctx.beginPath();
          if (ctx.roundRect) ctx.roundRect(-coverW / 2, -coverH / 2, coverW, coverH, rad);
          else ctx.rect(-coverW / 2, -coverH / 2, coverW, coverH);
          ctx.clip();
          if (window.SVRoundImage && window.SVRoundImage.drawFitted) {
            window.SVRoundImage.drawFitted(ctx, coverImg, -coverW / 2, -coverH / 2, coverW, coverH, drawFit);
          } else {
            ctx.drawImage(coverImg, -coverW / 2, -coverH / 2, coverW, coverH);
          }
        }
        ctx.restore();
      }

      // Grup, verilen noktada dikeyde ortalanır
      let y = yOrigin;

      /* Yazı kutusu tuvalin dışına taşmasın. Sığmayan satır bu görünür
         aralıkta kayar; ölçü nabız ölçeğiyle ekran pikseline çevrilir. */
      const fitScale = Math.max(0.05, scale * pulse);
      const limitPx = Math.min(maxW, W);
      const rawLeft = align === 'left' ? ax : align === 'right' ? ax - limitPx : ax - limitPx / 2;
      const slotLeftPx = clamp(rawLeft, 0, W);
      const slotRightPx = clamp(rawLeft + limitPx, 0, W);
      const slotPx = Math.max(1, slotRightPx - slotLeftPx);
      const slotUserLeft = (slotLeftPx - ax) / fitScale;
      const slotUserW = slotPx / fitScale;

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
        const overPx = wdt * fitScale - slotPx;

        if (overPx > 1 && r.scroll && c.scrollLongTitles !== false) {
          ctx.beginPath();
          ctx.rect(slotUserLeft, -fsize, slotUserW, fsize * 2);
          ctx.clip();
          const along = overflowAlong(this.scrollT, overPx, fsize * fitScale, scrollSpeed);
          const prevAlign = ctx.textAlign;
          ctx.textAlign = 'left';
          paint(r.text, fsize, r.col, r.a, slotUserLeft - along / fitScale);
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

    dispose() { this.tracker = null; this._coverImg = null; this._coverKey = ''; }
  }

  window.SVModes = window.SVModes || {};
  window.SVModes.nowplaying = NowPlayingMode;
})();
