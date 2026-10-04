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

  /* main'deki çalan parça gezintisi: uçta kısa bekleme, arada ease.
     Süre taşma uzunluğuna bağlıdır; birkaç pikselik taşma bir karede
     bitmez. Hız çarpanı bu süreyi böler. */
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

  /* Masaüstü süreçleri aynı Date.now() değerini görür. Tarayıcı ve OBS
     başka bir makinedeyse SVServerNow ofseti sunucu saatine çeker. */
  function wallNow() {
    const box = window.SVServerNow;
    const off = box && isFinite(box.offset) ? box.offset : 0;
    return Date.now() + off;
  }

  /* Çıpa yoksa ekranın kendi açılış saati. Çıpa varsa bütün pencereler
     aynı süreyi görür; oynat, duraklat ve durdur oradan gelir. */
  function manualLyricTime(frameT) {
    const run = window.SVLyricsRun;
    const clock = window.SVLyricsClock;
    if (run && run.anchor && clock && clock.resolve) return clock.resolve(run.anchor, wallNow());
    return frameT;
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
  const rgba = (c, a) => `rgba(${c[0]},${c[1]},${c[2]},${a})`;

  class TextMode {
    constructor(canvas) {
      this.canvas = canvas;
      this.ctx = canvas.getContext('2d');
      this.doc = null;
      this.docKey = '';
      this.t0 = 0;
      this.lastLine = -1;
      this.lastNow = '';
      this.lineAge = 0;
      this.marquee = 0;
      this.scrollT = 0;
      this.scrollKey = '';
    }
    resize() {}

    _ensureLyrics(t) {
      const src = t.lyricsSource || '';
      let h = src.length;
      for (let i = 0; i < src.length; i += 17) h = (h + src.charCodeAt(i)) | 0;
      const key = src.length + ':' + h;
      if (key === this.docKey) return;
      this.docKey = key;
      this.doc = src && window.SVLyrics ? window.SVLyrics.parse(src) : null;
    }

    draw(audio, cfg, t, dt) {
      const ctx = this.ctx;
      const W = this.canvas.width;
      const H = this.canvas.height;
      const step = Math.min(0.05, dt || 0.016);
      ctx.clearRect(0, 0, W, H);
      const T = cfg.text || {};
      const isStandaloneText = cfg.visualizer && cfg.visualizer.type === 'text';
      if (!isStandaloneText && T.enabled === false) return;

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
        /* Takip kapalıysa ya da Windows değilse use yoktur: söz, elle
           yüklenen dosyayla kalır. Saat, ekran açılınca başlar; panelden
           gelen çıpa varsa bütün ekranlar onu paylaşır. */
        const sync = window.SVLyricsSync;
        /* İzleme yalnız Windows oturumunda açılır. Dışa aktarma da aynı
           kuralı kullanır: macOS ve Linux yüklenen söz dosyasında kalır. */
        const use = (sync && sync.playback) ? sync.playback({
          windows: !!(window.SV_PLATFORM && window.SV_PLATFORM.isWindows),
          follow: T.lyricsFollow === true,
          match: T.lyricsMatch || 'exact',
          library: (window.SVLyricsLib && window.SVLyricsLib.items) || [],
          live: (window.SVNowLive && window.SVNowLive.state) || null,
          manualText: T.lyricsSource || '',
          nowMs: wallNow(),
        }) : null;
        if (use && use.line) {
          content = use.text || '';
          if (content !== this.lyricKey) { this.lyricKey = content; this.lineAge = 0; }
          else this.lineAge += step;
        } else if (use && use.source === 'none') {
          content = '';
        } else {
          const body = use ? (use.text || '') : (T.lyricsSource || '');
          const clock = (use && use.time != null) ? use.time : manualLyricTime(t);
          this._ensureLyrics({ lyricsSource: body });
          if (this.doc && window.SVLyrics) {
            const hit = window.SVLyrics.at(this.doc, clock, T.offset || 0);
            if (hit.index >= 0) {
              content = hit.line.text;
              progress = hit.progress;
              wordIndex = hit.wordIndex;
              words = hit.line.words && hit.line.words.length ? hit.line.words : null;
            }
            if (hit.index !== this.lastLine) { this.lastLine = hit.index; this.lineAge = 0; }
            else this.lineAge += step;
          }
        }
      } else if (src === 'now') {
        /* Sistemden okunan parça varsa o kazanır; yoksa elle yazılana düşer.
           Böylece hiçbir oynatıcı açık değilken alan boş kalmıyor. */
        const live = (T.nowSource || 'system') === 'system'
          && window.SVNowLive && window.SVNowLive.state && window.SVNowLive.state.has
          ? window.SVNowLive.state : null;
        const n = live || T.nowPlaying || {};
        const field = T.field || 'both';
        if (field === 'title') content = n.title || T.content || '';
        else if (field === 'artist') content = n.artist || T.content || '';
        else content = [n.title, n.artist].filter(Boolean).join(' — ') || (T.content || '');
        /* Parça değişince giriş canlandırması yeniden oynasın; sabit yazı
           gibi durmasın. Söz satırlarındaki mantığın aynısı. */
        const key = (n.title || '') + ' ' + (n.artist || '');
        if (key !== this.lastNow) { this.lastNow = key; this.lineAge = 0; }
        else this.lineAge += step;
      } else {
        content = T.content || '';
        this.lineAge += step;
      }
      if (!content) return;

      const defX = T.align === 'left' ? 0.06 : T.align === 'right' ? 0.94 : 0.5;
      const cx = W * (T.x == null ? defX : T.x);
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

      /* Katmanın kendi kipi önce gelir. Sahne görselleştiricisi yedektir;
         eski katmanlarda yalnız useCustomColor duruyorsa sabit renk odur. */
      const colorMode = T.colorMode
        || (T.useCustomColor ? 'custom' : null)
        || (cfg.visualizer && cfg.visualizer.colorMode)
        || 'theme';
      let baseColor, hiColor;
      if (colorMode === 'custom') {
        baseColor = window.SV.hexToRgb01(T.color || '#ffffff').map((v) => (v * 255) | 0);
        hiColor = window.SV.hexToRgb01(T.colorHighlight || '#ffd23f').map((v) => (v * 255) | 0);
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
        baseColor = hsl(0.85);
        hiColor = hsl(0.35);
      } else {
        baseColor = paletteAt(cfg, 0.85);
        hiColor = paletteAt(cfg, 0.35);
      }

      /* Kutu hizaya göre kurulur, sonra tuvalin içine kırpılır. Yazı bu
         görünür aralıktan uzunsa (ya da olduğu yerde ekrandan taşıyorsa)
         ileri geri kayar. Ölçü dönüşümden bağımsızdır; nabız ölçeği ekran
         genişliğine ayrıca katılır. Kayan yazı açıksa o döngü kullanılır. */
      const align = T.align || 'center';
      const anchorX = cx + ox;
      const fitScale = Math.max(0.05, scale * pulse);
      const limitPx = Math.min(W * clamp(T.maxWidth == null ? 0.9 : T.maxWidth, 0.15, 1), W);
      const rawLeft = align === 'left' ? anchorX : align === 'right' ? anchorX - limitPx : anchorX - limitPx / 2;
      const slotLeftPx = clamp(rawLeft, 0, W);
      const slotRightPx = clamp(rawLeft + limitPx, 0, W);
      const slotPx = Math.max(0, slotRightPx - slotLeftPx);
      const scrollOn = T.scrollOverflow !== false && !T.marquee;
      const scrollSpeed = clamp(T.scrollSpeed == null ? 1 : T.scrollSpeed, 0.15, 4);
      if (content !== this.scrollKey) {
        this.scrollKey = content;
        this.scrollT = 0;
      }
      if (scrollOn) this.scrollT += step;

      /* Yerleşim, ölçülen genişliğe göre. Sığan yazı null döner ve eski
         hizasında kalır. Taşan yazı kutuya kırpılır; kaydırma açıksa x
         ileri geri gider. Karaoke ve satır silme aynı x'i kullanır, böylece
         vurgu rengi kaydırma açıkken de söylenen kelimenin üstünde kalır. */
      const placeInSlot = (textWidth) => {
        const textPx = textWidth * fitScale;
        const naturalLeft = align === 'left' ? anchorX : align === 'right' ? anchorX - textPx : anchorX - textPx / 2;
        const hangs = naturalLeft < -0.5 || naturalLeft + textPx > W + 0.5;
        const tooWide = textPx > slotPx + 1;
        if (!hangs && !tooWide) return null;
        const overUser = Math.max(0, (textPx - slotPx) / fitScale);
        const userLeft = (slotLeftPx - anchorX) / fitScale;
        const userW = slotPx / fitScale;
        let x = userLeft;
        if (overUser > 1 && scrollOn) {
          const overPx = overUser * fitScale;
          const along = overflowAlong(this.scrollT, overPx, size * fitScale, scrollSpeed);
          x = userLeft - along / fitScale;
        } else if (align === 'right') {
          x = userLeft + userW - textWidth;
        } else if (align === 'center') {
          x = userLeft + (userW - textWidth) / 2;
        }
        return { userLeft, userW, x };
      };

      const clipSlot = (slot, paint) => {
        ctx.save();
        ctx.beginPath();
        ctx.rect(slot.userLeft, -size * 1.2, slot.userW, size * 2.4);
        ctx.clip();
        const prevAlign = ctx.textAlign;
        ctx.textAlign = 'left';
        paint(slot.x);
        ctx.textAlign = prevAlign;
        ctx.restore();
      };

      const drawScrolled = (text, fill) => {
        const slot = placeInSlot(ctx.measureText(text).width);
        if (!slot) return false;
        clipSlot(slot, (x) => drawOne(text, x, 0, fill));
        return true;
      };

      const lines = String(content).split(/\r?\n/);
      const single = lines.length === 1;
      /* Üst hiza kutunun tepesini çapaya koyar; orta, eski gibi kutunun
         ortasını. Böylece söz satırı ekranın tepesine de oturur. */
      const vAlign = T.vAlign || 'middle';
      const blockH = Math.max(1, lines.length) * size * 1.2;
      const yBias = vAlign === 'top' ? blockH / 2 : vAlign === 'bottom' ? -blockH / 2 : 0;
      if (yBias) ctx.translate(0, yBias);

      const paintLines = (fill) => {
        const gapY = size * 1.2;
        const y0 = -((lines.length - 1) * gapY) / 2;
        lines.forEach((line, i) => {
          ctx.save();
          ctx.translate(0, y0 + i * gapY);
          if (!drawScrolled(line, fill)) drawOne(line, 0, 0, fill);
          ctx.restore();
        });
      };

      if (T.marquee) {
        // Kayan yazı: metin genişliğinden uzun bir döngüde sürekli akar
        this.marquee += step * (T.marqueeSpeed == null ? 0.12 : T.marqueeSpeed) * W;
        const wdt = ctx.measureText(content).width + size * 2;
        const off = -((this.marquee % wdt));
        const prevAlign = ctx.textAlign;
        ctx.textAlign = 'left';
        drawOne(content, off - W / 2, 0, rgba(baseColor, 1));
        drawOne(content, off - W / 2 + wdt, 0, rgba(baseColor, 1));
        ctx.textAlign = prevAlign;
      } else if (single && words && T.karaoke !== false) {
        /* Karaoke: satır tek parça çizilmez. Söylenen kelimeler vurgu
           renginde, gelecek kelimeler sönük. Tek fillText iki renk veremez.
           Satır kutuya sığmıyorsa kelimeler birlikte kırpılıp kayar. */
        const parts = words.map((w) => w.text);
        const widths = parts.map((p) => ctx.measureText(p).width);
        const total = widths.reduce((s, w) => s + w, 0);
        const paintWords = (origin) => {
          let x = origin;
          for (let i = 0; i < parts.length; i++) {
            const sung = i <= wordIndex;
            drawOne(parts[i], x, jitter * Math.sin(i * 1.7 + t * 9),
              rgba(sung ? hiColor : baseColor, sung ? 1 : 0.45));
            x += widths[i];
          }
        };
        const slot = placeInSlot(total);
        if (slot) clipSlot(slot, paintWords);
        else {
          const origin = ctx.textAlign === 'center' ? -total / 2
            : ctx.textAlign === 'right' ? -total : 0;
          const prevAlign = ctx.textAlign;
          ctx.textAlign = 'left';
          paintWords(origin);
          ctx.textAlign = prevAlign;
        }
      } else if (single && T.perCharacter) {
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
      } else if (single && src === 'lyrics' && T.karaoke !== false && progress > 0) {
        /* Kelime zamanı yoksa satırın söylenen oranı vurgu rengiyle silinir.
           Taşan satırda silme, kayan kutunun içinde kalır. */
        const wdt = ctx.measureText(content).width;
        const slot = placeInSlot(wdt);
        const paintWipe = (left, at) => {
          drawOne(content, at, 0, rgba(baseColor, 0.45));
          ctx.save();
          ctx.beginPath();
          ctx.rect(left, -size, wdt * progress, size * 2);
          ctx.clip();
          drawOne(content, at, 0, rgba(hiColor, 1));
          ctx.restore();
        };
        if (slot) clipSlot(slot, (x) => paintWipe(x, x));
        else {
          const left = ctx.textAlign === 'center' ? -wdt / 2 : ctx.textAlign === 'right' ? -wdt : 0;
          paintWipe(left, 0);
        }
      } else {
        paintLines(rgba(baseColor, 1));
      }
      ctx.restore();
    }

    dispose() { this.doc = null; }
  }

  window.SVModes = window.SVModes || {};
  window.SVModes.text = TextMode;
})();
