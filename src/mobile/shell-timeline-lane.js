/*
 * SoundVisualizer — CaYaDev Ses Görselleştirici
 * Copyright (c) 2026 Çağan Turgut (CaYatur) — CaYaDev, https://cayadev.com
 * https://github.com/CaYatur/SoundVisualizer
 * SPDX-License-Identifier: MIT
 */
'use strict';
/* ZAMAN ÇİZELGESİ ŞERİDİ — dokunmatik (src/mobile/shell-timeline.js kullanır).

   Masaüstündeki gibi TUVAL (src/admin/timeline-panel.js "NEDEN TUVAL"): yüzlerce klip ve
   binlerce otomasyon noktası tek geçişte çizilir; iki parmakla yakınlaştırırken DOM yeniden
   dizilmez. Veri ve kurallar ortak koddan: tempo/ölçü src/shared/timeline.js, klip rengi,
   grup kayması ve parça değiştirme src/shared/timeline-edit.js. Sürükleme kuralları
   masaüstünün fare kurallarıyla aynı (kırp, taşı, solma, grup, dikeyde parça değiştir,
   nokta, işaret, tempo etiketi, döngü kenarları, seçim dikdörtgeni).

   Dokunma (masaüstündeki farenin karşılığı):
   - dokun: seç (boşa dokunmak seçimi bırakır); çift dokun: denetçi; otomasyon şeridinde
     boş yere çift dokun: nokta
   - seçili klibi sürükle: taşı (dikeyde başka klip parçasına); uzun bas: seç ve taşı
   - seçili klibin kenarları: kırp (tutamaç klibin dışına taşar, dokunma alanı geniş);
     üst köşeler: giriş/çıkış solması
   - başka yerde tek parmak: kaydır (bırakınca süzülür); iki parmak: yakınlaştır
   - boş yerde uzun bas: bağlam menüsü; "Seç" kipinde boşta sürükle: seçim dikdörtgeni
   - cetvel: dokun/sürükle oynatma kafası; işaret bayrağı, ♩ etiketi ve döngü kenarı sürüklenir

   Bu dosya yalnız çizim ve dokunma; seçim, kayıt ve geçmiş çekirdekte (api). Sürüklerken
   yaşayan model nesnesi yerinde değişir, bırakınca `api.changed()` bir kez kaydeder. */
(function () {
  if (typeof window === 'undefined') return;
  const TL = () => window.SVTimeline;
  const TE = () => window.SVTimelineEdit;

  const RULER_H = 36; // üstte döngü bandı, ortada ölçü/süre, altta işaret bayrakları
  const LOOP_BAND = 7;
  const HANDLE_W = 14; // tutamacın görünen genişliği (klibin dışında)
  const HANDLE_HIT = 28; // tutamacın dokunma alanı: dışa 28, içe 12 px
  const FADE_HIT = 22; // üst köşelerdeki solma tutamacı: yatayda köşeden 22 px
  const FADE_BAND = 14; // dikeyde yalnız üst kenar (klibin ortasına inmesin: çift dokunuş klibe)
  const KEY_R = 6;
  const KEY_HIT = 22;
  const SLOP = 8; // px: dokunma mı sürükleme mi
  const LONG_MS = 450;
  const DOUBLE_MS = 330;
  const MIN_ZOOM = 2; // saniye başına piksel
  const MAX_ZOOM = 400;
  const TEMPO_TAG_W = 44;
  const MARKER_MAX_W = 96;

  function create(host, api) {
    const canvas = document.createElement('canvas');
    canvas.className = 'tl-canvas';
    canvas.setAttribute('role', 'application');
    canvas.setAttribute('aria-label', api.tr('Zaman çizelgesi şeridi'));
    host.appendChild(canvas);
    const ctx = canvas.getContext('2d');
    const view = { zoom: api.zoom ? api.zoom() : 24, sx: 0, sy: 0, w: 0, h: 0 };
    let raf = 0;
    let colors = null;
    let drag = null;
    let fling = 0;
    const pointers = new Map();
    let pinch = null;
    let lastTap = null; // { t, key }
    const flagRects = []; // işaret bayrakları (çizimde ölçülür, vuruş testi okur)
    const tempoRects = [];

    // ---- Görünüm ----
    const laneH = () => api.laneH();
    const xOf = (t) => t * view.zoom - view.sx;
    const tOf = (x) => Math.max(0, (x + view.sx) / view.zoom);
    const rowTop = (i) => RULER_H + i * laneH() - view.sy;
    function contentW(tl) { return Math.max(view.w, (Math.max(api.length(tl), 1) + 4) * view.zoom); }
    function clampScroll(tl) {
      const maxX = Math.max(0, contentW(tl) - view.w + 60);
      view.sx = Math.max(0, Math.min(maxX, view.sx));
      const maxY = Math.max(0, tl.tracks.length * laneH() + laneH() - (view.h - RULER_H));
      view.sy = Math.max(0, Math.min(maxY, view.sy));
    }
    function resize() {
      const r = host.getBoundingClientRect();
      const dpr = window.devicePixelRatio || 1;
      view.w = Math.max(1, Math.round(r.width));
      view.h = Math.max(1, Math.round(r.height));
      canvas.width = Math.round(view.w * dpr);
      canvas.height = Math.round(view.h * dpr);
      canvas.style.width = view.w + 'px';
      canvas.style.height = view.h + 'px';
      // Boyut belli olunca hemen çiz: ağır sahnede kare sıklığı düşükken tuval bir sonraki kareye dek boş kalıyordu
      if (raf) { cancelAnimationFrame(raf); raf = 0; }
      paint();
    }
    const ro = typeof ResizeObserver === 'function' ? new ResizeObserver(() => resize()) : null;
    if (ro) ro.observe(host);

    function setZoom(z, anchorX) {
      const ax = anchorX == null ? view.w / 2 : anchorX;
      const t = tOf(ax);
      view.zoom = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, z));
      view.sx = t * view.zoom - ax;
      clampScroll(api.model());
      if (api.zoomed) api.zoomed(view.zoom);
      draw();
    }
    function fit() {
      const tl = api.model();
      const len = Math.max(api.length(tl), 8);
      const f = TE().fitView(len, Math.max(1, view.w - 24), MIN_ZOOM, MAX_ZOOM);
      view.zoom = f.zoom;
      view.sx = 0;
      if (api.zoomed) api.zoomed(view.zoom);
      draw();
    }
    // Oynatırken kafayı takip et (masaüstündeki "takip"): kafa sağ kenara yaklaşınca sayfa çevrilir
    function follow(t) {
      const x = xOf(t);
      if (x < 24 || x > view.w - 48) { view.sx = Math.max(0, t * view.zoom - view.w * 0.25); clampScroll(api.model()); }
    }
    function reveal(t) { const x = xOf(t); if (x < 0 || x > view.w) { view.sx = Math.max(0, t * view.zoom - view.w * 0.4); clampScroll(api.model()); draw(); } }

    // ---- Renkler: tema belirteçlerinden (renk yalnız ui-themes.js'te) ----
    function readColors() {
      const cs = getComputedStyle(host);
      const v = (n, d) => (cs.getPropertyValue(n) || '').trim() || d;
      const rgbOf = (n) => { const s = v(n, ''); const p = s.split(/[\s,]+/).filter(Boolean).map(Number); return p.length >= 3 ? p.slice(0, 3) : [128, 128, 128]; };
      colors = {
        bg: v('--card', '#000'), line: v('--line', '#444'), line2: v('--line2', '#555'), text: v('--text', '#eee'),
        muted: v('--muted', '#999'), accent: v('--accent', '#e11d2a'), accent2: v('--accent2', '#ff4d5e'),
        onSolid: v('--on-solid', '#fff'), warn: v('--warn', '#fc4'), onWarn: v('--on-warn', '#000'), tempo: v('--tempo', '#4cf'), fg: rgbOf('--fg-rgb'), shadow: rgbOf('--shadow-rgb'),
        accentRgb: rgbOf('--accent-rgb'), font: cs.fontFamily || 'sans-serif',
      };
    }
    const fgA = (a) => 'rgba(' + colors.fg.join(',') + ',' + a + ')';
    const accA = (a) => 'rgba(' + colors.accentRgb.join(',') + ',' + a + ')';
    function hexA(hex, a) {
      const m = /^#?([0-9a-f]{6})$/i.exec(hex || '');
      if (!m) return accA(a);
      const n = parseInt(m[1], 16);
      return 'rgba(' + (n >> 16) + ',' + ((n >> 8) & 255) + ',' + (n & 255) + ',' + a + ')';
    }

    // ---- Çizim ----
    function draw() { if (!raf) raf = requestAnimationFrame(paint); }
    function paint() {
      raf = 0;
      if (!canvas.isConnected) return;
      if (!colors) readColors();
      const tl = api.model();
      clampScroll(tl);
      const dpr = window.devicePixelRatio || 1;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, view.w, view.h);
      ctx.fillStyle = colors.bg;
      ctx.fillRect(0, 0, view.w, view.h);
      const lh = laneH();
      // Şeritler
      ctx.save();
      ctx.beginPath();
      ctx.rect(0, RULER_H, view.w, view.h - RULER_H);
      ctx.clip();
      tl.tracks.forEach((trk, i) => {
        const y = rowTop(i);
        if (y > view.h || y + lh < RULER_H) return;
        if (i % 2) { ctx.fillStyle = fgA(0.025); ctx.fillRect(0, y, view.w, lh); }
        if (api.isTrackSelected(trk)) { ctx.fillStyle = accA(0.07); ctx.fillRect(0, y, view.w, lh); }
        ctx.fillStyle = fgA(0.07);
        ctx.fillRect(0, y + lh - 1, view.w, 1);
      });
      grid(tl);
      loopShade(tl);
      tl.tracks.forEach((trk, i) => {
        const y = rowTop(i);
        if (y > view.h || y + lh < RULER_H) return;
        if (trk.kind === 'clip') drawClipTrack(tl, trk, i, y, lh);
        else drawAutomation(trk, i, y, lh);
        if (trk.locked) hatch(y, lh);
      });
      // Yeni parçaya taşıma: son satırın altında hayalet satır
      if (drag && drag.kind === 'move' && drag.newTrack) {
        const y = rowTop(tl.tracks.length);
        ctx.strokeStyle = colors.accent;
        ctx.setLineDash([6, 4]);
        ctx.strokeRect(2, y + 2, view.w - 4, lh - 4);
        ctx.setLineDash([]);
      }
      // İşaret çizgileri
      ctx.strokeStyle = fgA(0.22);
      ctx.setLineDash([3, 4]);
      for (const m of tl.markers) {
        const x = Math.round(xOf(m.t)) + 0.5;
        if (x < 0 || x > view.w) continue;
        ctx.beginPath(); ctx.moveTo(x, RULER_H); ctx.lineTo(x, view.h); ctx.stroke();
      }
      ctx.setLineDash([]);
      if (drag && drag.kind === 'marquee' && drag.moved) {
        const x0 = Math.min(drag.x0, drag.x1), y0 = Math.min(drag.y0, drag.y1);
        ctx.fillStyle = accA(0.12);
        ctx.strokeStyle = colors.accent;
        ctx.fillRect(x0, y0, Math.abs(drag.x1 - drag.x0), Math.abs(drag.y1 - drag.y0));
        ctx.strokeRect(x0 + 0.5, y0 + 0.5, Math.abs(drag.x1 - drag.x0), Math.abs(drag.y1 - drag.y0));
      }
      ctx.restore();
      ruler(tl);
      // Oynatma kafası
      const hx = Math.round(xOf(api.head())) + 0.5;
      if (hx >= -2 && hx <= view.w + 2) {
        ctx.strokeStyle = colors.accent;
        ctx.lineWidth = 2;
        ctx.beginPath(); ctx.moveTo(hx, RULER_H - 10); ctx.lineTo(hx, view.h); ctx.stroke();
        ctx.lineWidth = 1;
        ctx.fillStyle = colors.accent;
        ctx.beginPath(); ctx.moveTo(hx - 7, RULER_H - 14); ctx.lineTo(hx + 7, RULER_H - 14); ctx.lineTo(hx, RULER_H - 5); ctx.closePath(); ctx.fill();
      }
      if (api.painted) api.painted();
    }

    function grid(tl) {
      const map = tl.tempo;
      const bar = Math.max(1e-3, TL().barsToSeconds(map, 2, 1) - TL().barsToSeconds(map, 1, 1));
      const barPx = bar * view.zoom;
      const beats = (map[0] && map[0].beatsPerBar) || 4;
      const t0 = tOf(0);
      const t1 = tOf(view.w);
      const b0 = Math.max(1, TL().secondsToBars(map, t0).bar);
      for (let b = b0; ; b++) {
        const t = TL().barsToSeconds(map, b, 1);
        if (t > t1 || b > b0 + 4000) break;
        const x = Math.round(xOf(t)) + 0.5;
        ctx.fillStyle = fgA(0.09);
        ctx.fillRect(x, RULER_H, 1, view.h - RULER_H);
        if (barPx / beats >= 14) {
          ctx.fillStyle = fgA(0.035);
          for (let k = 1; k < beats; k++) {
            const bx = Math.round(xOf(TL().barsToSeconds(map, b, k + 1))) + 0.5;
            ctx.fillRect(bx, RULER_H, 1, view.h - RULER_H);
          }
        }
      }
    }
    function loopShade(tl) {
      const lp = tl.loop;
      if (!lp || !(lp.end > lp.start)) return;
      const x0 = xOf(lp.start), x1 = xOf(lp.end);
      ctx.fillStyle = lp.enabled ? accA(0.07) : fgA(0.02);
      ctx.fillRect(x0, RULER_H, x1 - x0, view.h - RULER_H);
    }
    function hatch(y, h) {
      ctx.save();
      ctx.beginPath(); ctx.rect(0, y, view.w, h); ctx.clip();
      ctx.strokeStyle = fgA(0.06);
      for (let x = -h; x < view.w; x += 10) { ctx.beginPath(); ctx.moveTo(x, y + h); ctx.lineTo(x + h, y); ctx.stroke(); }
      ctx.restore();
    }
    function roundRect(x, y, w, h, r) {
      const rr = Math.min(r, w / 2, h / 2);
      ctx.beginPath();
      ctx.moveTo(x + rr, y);
      ctx.arcTo(x + w, y, x + w, y + h, rr);
      ctx.arcTo(x + w, y + h, x, y + h, rr);
      ctx.arcTo(x, y + h, x, y, rr);
      ctx.arcTo(x, y, x + w, y, rr);
      ctx.closePath();
    }
    function clipRect(c, y, lh) { return { x: xOf(c.start), y: y + 5, w: Math.max(6, c.dur * view.zoom), h: lh - 10 }; }
    function drawClipTrack(tl, trk, i, y, lh) {
      // Çalıyor mu: susturulmamış ve (solo varsa) solo (src/shared/timeline.js audible)
      const audible = TL().audible ? TL().audible(trk, TL().anySolo(tl)) : !trk.muted;
      const selId = api.selClipId();
      for (const c of trk.clips) {
        const r = clipRect(c, y, lh);
        if (r.x > view.w || r.x + r.w < 0) continue;
        const col = TE().clipColor(c, trk);
        const on = c.id === selId && api.selTrackId() === trk.id;
        const picked = api.isPicked(c);
        ctx.globalAlpha = audible ? 1 : 0.4;
        roundRect(r.x, r.y, r.w, r.h, 9);
        ctx.fillStyle = hexA(col, on ? 0.95 : 0.78);
        ctx.fill();
        // Geçiş penceresi (fade) başta, giriş ve çıkış solması rampaları
        const fade = Math.min(c.dur, c.fade || 0);
        if (fade > 0) {
          ctx.fillStyle = 'rgba(' + colors.shadow.join(',') + ',0.25)';
          ctx.fillRect(r.x, r.y, Math.min(r.w, fade * view.zoom), r.h);
        }
        ramp(r, Math.min(c.dur, c.fadeIn || 0), false);
        ramp(r, Math.min(c.dur, c.fadeOut || 0), true);
        // Ad
        if (r.w > 26) {
          ctx.save();
          ctx.beginPath(); ctx.rect(Math.max(r.x, 0), r.y, Math.min(r.w, view.w) - Math.max(0, -r.x), r.h); ctx.clip();
          ctx.fillStyle = colors.onSolid;
          ctx.font = '600 12px ' + colors.font;
          ctx.textBaseline = 'middle';
          const tx = Math.max(r.x, 0) + 8;
          ctx.fillText(api.labelOf(c), tx, r.y + r.h / 2 - (lh >= 52 ? 7 : 0));
          if (lh >= 52) {
            ctx.font = '500 10.5px ' + colors.font;
            ctx.globalAlpha *= 0.8;
            ctx.fillText(api.typeLabel(c.type), tx, r.y + r.h / 2 + 9);
          }
          ctx.restore();
        }
        ctx.globalAlpha = 1;
        if (on || picked) {
          roundRect(r.x - 1, r.y - 1, r.w + 2, r.h + 2, 10);
          ctx.strokeStyle = colors.accent;
          ctx.lineWidth = 2;
          if (picked && !on) ctx.setLineDash([5, 3]);
          ctx.stroke();
          ctx.setLineDash([]);
          ctx.lineWidth = 1;
        }
        if (on && !trk.locked && !api.pickMode()) handles(r);
      }
    }
    function ramp(r, sec, out) {
      if (!(sec > 0)) return;
      const w = Math.min(r.w, sec * view.zoom);
      ctx.fillStyle = 'rgba(' + colors.shadow.join(',') + ',0.35)';
      ctx.beginPath();
      if (out) { ctx.moveTo(r.x + r.w - w, r.y); ctx.lineTo(r.x + r.w, r.y); ctx.lineTo(r.x + r.w, r.y + r.h); }
      else { ctx.moveTo(r.x, r.y); ctx.lineTo(r.x + w, r.y); ctx.lineTo(r.x, r.y + r.h); }
      ctx.closePath();
      ctx.fill();
    }
    function handles(r) {
      ctx.fillStyle = colors.accent;
      roundRect(r.x - HANDLE_W, r.y, HANDLE_W, r.h, 6); ctx.fill();
      roundRect(r.x + r.w, r.y, HANDLE_W, r.h, 6); ctx.fill();
      ctx.strokeStyle = colors.onSolid;
      ctx.lineWidth = 1.5;
      for (const hx of [r.x - HANDLE_W / 2, r.x + r.w + HANDLE_W / 2]) {
        ctx.beginPath(); ctx.moveTo(hx - 2, r.y + r.h / 2 - 7); ctx.lineTo(hx - 2, r.y + r.h / 2 + 7);
        ctx.moveTo(hx + 2, r.y + r.h / 2 - 7); ctx.lineTo(hx + 2, r.y + r.h / 2 + 7); ctx.stroke();
      }
      // Solma tutamaçları: üst köşelerde küçük daireler
      ctx.fillStyle = colors.onSolid;
      for (const fx of [r.x + 9, r.x + r.w - 9]) { ctx.beginPath(); ctx.arc(fx, r.y + 7, 4, 0, Math.PI * 2); ctx.fill(); }
      ctx.lineWidth = 1;
    }
    function keyY(v, y, lh) { return y + 6 + (1 - v) * (lh - 12); }
    function drawAutomation(trk, i, y, lh) {
      const col = trk.color || colors.accent2;
      const keys = trk.keys || [];
      ctx.globalAlpha = trk.muted ? 0.4 : 1;
      if (keys.length) {
        // Eğri: noktalar arası ortak değerlendirme (src/shared/timeline.js evalKeys) ile örneklenir
        ctx.beginPath();
        const step = 3;
        for (let x = 0; x <= view.w; x += step) {
          const v = TL().evalKeys(keys, tOf(x));
          const yy = keyY(v == null ? 0 : v, y, lh);
          if (x === 0) ctx.moveTo(x, yy); else ctx.lineTo(x, yy);
        }
        ctx.strokeStyle = col;
        ctx.lineWidth = 2;
        ctx.stroke();
        ctx.lineWidth = 1;
        ctx.lineTo(view.w, y + lh); ctx.lineTo(0, y + lh); ctx.closePath();
        ctx.fillStyle = hexA(col, 0.12);
        ctx.fill();
        const sel = api.selKey();
        keys.forEach((k, ki) => {
          const x = xOf(k.t);
          if (x < -10 || x > view.w + 10) return;
          const on = sel && sel.trackId === trk.id && sel.keyIndex === ki;
          ctx.beginPath(); ctx.arc(x, keyY(k.v, y, lh), on ? KEY_R + 3 : KEY_R, 0, Math.PI * 2);
          ctx.fillStyle = on ? colors.accent : col;
          ctx.fill();
          ctx.strokeStyle = colors.onSolid;
          ctx.lineWidth = on ? 2 : 1;
          ctx.stroke();
          ctx.lineWidth = 1;
        });
      } else {
        ctx.fillStyle = colors.muted;
        ctx.font = '500 11px ' + colors.font;
        ctx.textBaseline = 'middle';
        ctx.fillText(api.tr(trk.target ? 'Nokta eklemek için çift dokunun' : 'Hedef seçin (parça başlığı)'), 10, y + lh / 2);
      }
      ctx.globalAlpha = 1;
    }

    function fmtTime(t) {
      const m = Math.floor(t / 60);
      const s = Math.floor(t - m * 60);
      return m + ':' + (s < 10 ? '0' : '') + s;
    }
    function ruler(tl) {
      ctx.fillStyle = colors.bg;
      ctx.fillRect(0, 0, view.w, RULER_H);
      ctx.fillStyle = fgA(0.05);
      ctx.fillRect(0, 0, view.w, RULER_H);
      ctx.fillStyle = colors.line;
      ctx.fillRect(0, RULER_H - 1, view.w, 1);
      const mode = api.rulerMode();
      const map = tl.tempo;
      ctx.textBaseline = 'middle';
      ctx.font = '600 11px ' + colors.font;
      const yLbl = LOOP_BAND + 8;
      if (mode !== 'time') {
        const bar = Math.max(1e-3, TL().barsToSeconds(map, 2, 1) - TL().barsToSeconds(map, 1, 1));
        const every = Math.max(1, Math.ceil(36 / Math.max(1, bar * view.zoom)));
        const t1 = tOf(view.w);
        const b0 = Math.max(1, TL().secondsToBars(map, tOf(0)).bar);
        for (let b = Math.max(1, b0 - ((b0 - 1) % every)); ; b += every) {
          const t = TL().barsToSeconds(map, b, 1);
          if (t > t1 || b > b0 + 20000) break;
          const x = Math.round(xOf(t)) + 0.5;
          ctx.fillStyle = fgA(0.3);
          ctx.fillRect(x, LOOP_BAND + 1, 1, RULER_H - LOOP_BAND - 1);
          ctx.fillStyle = colors.text;
          let label = String(b);
          if (mode === 'both' && bar * view.zoom * every >= 78) label += '  ' + fmtTime(t);
          ctx.fillText(label, x + 4, yLbl);
        }
      } else {
        const steps = [1, 2, 5, 10, 15, 30, 60, 120, 300];
        const st = steps.find((s) => s * view.zoom >= 56) || 600;
        const t1 = tOf(view.w);
        for (let t = Math.floor(tOf(0) / st) * st; t <= t1; t += st) {
          const x = Math.round(xOf(t)) + 0.5;
          ctx.fillStyle = fgA(0.3);
          ctx.fillRect(x, LOOP_BAND + 1, 1, RULER_H - LOOP_BAND - 1);
          ctx.fillStyle = colors.text;
          ctx.fillText(fmtTime(t), x + 4, yLbl);
        }
      }
      // Döngü bandı
      const lp = tl.loop;
      if (lp && lp.end > lp.start) {
        const x0 = xOf(lp.start), x1 = xOf(lp.end);
        ctx.fillStyle = lp.enabled ? colors.accent : fgA(0.25);
        ctx.fillRect(x0, 0, x1 - x0, LOOP_BAND);
        ctx.fillRect(x0 - 2, 0, 4, LOOP_BAND + 6);
        ctx.fillRect(x1 - 2, 0, 4, LOOP_BAND + 6);
      }
      // Tempo değişimleri (♩): ilk giriş taşıma satırında düzenlenir, değişimler burada
      tempoRects.length = 0;
      const list = TE().tempoList(map);
      const selTempo = api.selTempo();
      ctx.font = '700 10.5px ' + colors.font;
      list.forEach((e, ti) => {
        if (ti === 0) return;
        const x = xOf(e.t);
        if (x < -TEMPO_TAG_W || x > view.w) return;
        const on = selTempo === ti;
        roundRect(x, LOOP_BAND + 1, TEMPO_TAG_W, 15, 4);
        ctx.fillStyle = on ? colors.accent : colors.tempo;
        ctx.globalAlpha = on ? 1 : 0.85;
        ctx.fill();
        ctx.globalAlpha = 1;
        ctx.fillStyle = on ? colors.onSolid : colors.bg;
        ctx.fillText('♩' + Math.round(e.bpm), x + 4, LOOP_BAND + 9);
        tempoRects.push({ x, y: LOOP_BAND, w: TEMPO_TAG_W, h: 17, index: ti });
      });
      // İşaret bayrakları (ruler altı)
      flagRects.length = 0;
      ctx.font = '600 10.5px ' + colors.font;
      const selMk = api.selMarkerId();
      for (const m of tl.markers) {
        const x = xOf(m.t);
        if (x > view.w || x < -MARKER_MAX_W) continue;
        const name = m.name || fmtTime(m.t);
        const pad = m.hold ? 9 : 0; // bekleme (cue): adın önünde iki çubuk
        const w = Math.min(MARKER_MAX_W, ctx.measureText(name).width + 12 + pad);
        const on = m.id === selMk;
        roundRect(x, RULER_H - 15, w, 13, 4);
        ctx.fillStyle = on ? colors.accent : m.hold ? colors.warn : fgA(0.22);
        ctx.fill();
        ctx.save();
        ctx.beginPath(); ctx.rect(x, RULER_H - 15, w, 13); ctx.clip();
        ctx.fillStyle = on ? colors.onSolid : m.hold ? colors.onWarn : colors.text;
        if (m.hold) { ctx.fillRect(x + 5, RULER_H - 12, 2, 7); ctx.fillRect(x + 9, RULER_H - 12, 2, 7); }
        ctx.fillText(name, x + 5 + pad, RULER_H - 8);
        ctx.restore();
        flagRects.push({ x, y: RULER_H - 17, w: Math.max(w, 28), h: 17, marker: m });
      }
    }

    // ---- Vuruş testi ----
    function hit(x, y) {
      const tl = api.model();
      if (y < RULER_H) {
        const lp = tl.loop;
        if (lp && lp.end > lp.start && y <= LOOP_BAND + 8) {
          if (Math.abs(x - xOf(lp.start)) <= 16) return { zone: 'loopL' };
          if (Math.abs(x - xOf(lp.end)) <= 16) return { zone: 'loopR' };
        }
        for (let i = tempoRects.length - 1; i >= 0; i--) {
          const r = tempoRects[i];
          if (x >= r.x - 4 && x <= r.x + r.w && y >= r.y - 2 && y <= r.y + r.h + 2) return { zone: 'tempo', index: r.index };
        }
        for (let i = flagRects.length - 1; i >= 0; i--) {
          const r = flagRects[i];
          if (x >= r.x - 6 && x <= r.x + r.w && y >= r.y - 4) return { zone: 'marker', marker: r.marker };
        }
        return { zone: 'ruler' };
      }
      const lh = laneH();
      const row = Math.floor((y - RULER_H + view.sy) / lh);
      const trk = tl.tracks[row];
      if (!trk) return { zone: 'empty', row };
      const top = rowTop(row);
      if (trk.kind === 'automation') {
        const keys = trk.keys || [];
        let best = null;
        let bd = KEY_HIT;
        keys.forEach((k, ki) => {
          const d = Math.hypot(xOf(k.t) - x, keyY(k.v, top, lh) - y);
          if (d <= bd) { bd = d; best = ki; }
        });
        if (best != null) return { zone: 'key', row, trk, ki: best, top, bot: top + lh };
        return { zone: 'lane', row, trk, top, bot: top + lh };
      }
      // Seçili klibin tutamaçları önce: klibin dışına taşan geniş alan
      const selId = api.selClipId();
      const sel = selId && api.selTrackId() === trk.id ? trk.clips.find((c) => c.id === selId) : null;
      if (sel && !trk.locked && !api.pickMode()) {
        const r = clipRect(sel, top, lh);
        if (y >= r.y - 6 && y <= r.y + r.h + 6) {
          if (y <= r.y + FADE_BAND && x >= r.x && x <= r.x + FADE_HIT) return { zone: 'fade', row, trk, clip: sel };
          if (y <= r.y + FADE_BAND && x <= r.x + r.w && x >= r.x + r.w - FADE_HIT) return { zone: 'fadeOut', row, trk, clip: sel };
          if (x >= r.x - HANDLE_HIT && x <= r.x + Math.min(12, r.w / 3)) return { zone: 'trimL', row, trk, clip: sel };
          if (x <= r.x + r.w + HANDLE_HIT && x >= r.x + r.w - Math.min(12, r.w / 3)) return { zone: 'trimR', row, trk, clip: sel };
        }
      }
      for (let ci = trk.clips.length - 1; ci >= 0; ci--) {
        const c = trk.clips[ci];
        const r = clipRect(c, top, lh);
        if (x >= r.x && x <= r.x + r.w && y >= r.y - 3 && y <= r.y + r.h + 3) return { zone: 'clip', row, trk, clip: c };
      }
      return { zone: 'lane', row, trk };
    }

    // ---- Dokunma ----
    function local(e) { const r = canvas.getBoundingClientRect(); return { x: e.clientX - r.left, y: e.clientY - r.top }; }
    function stopFling() { if (fling) { cancelAnimationFrame(fling); fling = 0; } }
    canvas.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      stopFling();
      try { canvas.setPointerCapture(e.pointerId); } catch (err) { /* tuval kaldırıldı */ }
      const p = local(e);
      pointers.set(e.pointerId, p);
      if (pointers.size === 2) {
        // İki parmak: yakınlaştırma; süren tek parmak işi bırakılır (yarım taşıma geri alınır)
        cancelDrag();
        const [a, b] = [...pointers.values()];
        pinch = { d0: Math.max(10, Math.abs(a.x - b.x)), z0: view.zoom, mx: (a.x + b.x) / 2, t: tOf((a.x + b.x) / 2), sy0: view.sy, my0: (a.y + b.y) / 2 };
        return;
      }
      if (pointers.size > 2) return;
      const h = hit(p.x, p.y);
      drag = { id: e.pointerId, x0: p.x, y0: p.y, x1: p.x, y1: p.y, sx0: view.sx, sy0: view.sy, h, moved: false, kind: 'pending', at: performance.now(), samples: [{ x: p.x, y: p.y, t: performance.now() }] };
      const tl = api.model();
      // Hemen başlayan sürüklemeler: cetvel, seçili klibin tutamaçları/gövdesi, seçili nokta
      if (h.zone === 'ruler') { drag.kind = 'scrub'; api.scrub(api.snapFree(tOf(p.x)), false); }
      else if (h.zone === 'loopL' || h.zone === 'loopR') drag.kind = h.zone;
      else if (h.zone === 'trimL' || h.zone === 'trimR' || h.zone === 'fade' || h.zone === 'fadeOut') beginClipDrag(h.zone, h, p);
      else if (h.zone === 'clip' && api.isSelectedClip(h.trk, h.clip) && !h.trk.locked && !api.pickMode()) beginClipDrag('move', h, p);
      else if (h.zone === 'clip' && api.pickMode() && api.isPicked(h.clip) && !h.trk.locked) beginClipDrag('move', h, p);
      else if (h.zone === 'key' && api.isSelectedKey(h.trk, h.ki) && !h.trk.locked) drag.kind = 'key';
      else if (h.zone === 'marker' && h.marker.id === api.selMarkerId()) drag.kind = 'marker';
      else if (h.zone === 'tempo' && api.selTempo() === h.index) drag.kind = 'tempo';
      if (drag.kind === 'pending') {
        drag.long = setTimeout(() => onLong(), LONG_MS);
      }
      if (drag.kind === 'tempo') { drag.base = TE().tempoList(tl.tempo); drag.tt0 = drag.base[h.index].t; }
      if (drag.kind === 'marker') drag.mt0 = h.marker.t;
    }, { passive: false });

    function beginClipDrag(kind, h, p) {
      const tl = api.model();
      drag.kind = kind;
      drag.clip = h.clip;
      drag.trk = h.trk;
      drag.start0 = h.clip.start;
      drag.dur0 = h.clip.dur;
      drag.t0 = tOf(p.x);
      if (kind === 'move') {
        const picked = api.pickedClips();
        if (picked.length > 1 && picked.some((q) => q.clip === h.clip)) {
          drag.group = picked.filter((q) => !q.trk.locked).map((q) => ({ clip: q.clip, trk: q.trk, start0: q.clip.start }));
        }
      }
      drag.tl = tl;
    }
    function onLong() {
      if (!drag || drag.kind !== 'pending' || drag.moved) return;
      const h = drag.h;
      if (h.zone === 'clip' && !h.trk.locked) {
        // Uzun bas: seç ve taşımaya başla
        api.selectClip(h.trk, h.clip);
        beginClipDrag('move', h, { x: drag.x0, y: drag.y0 });
        drag.longMove = true;
        draw();
        return;
      }
      if (h.zone === 'clip' || h.zone === 'lane' || h.zone === 'empty' || h.zone === 'key') {
        drag.kind = 'menu';
        const r = canvas.getBoundingClientRect();
        api.menu({ t: tOf(drag.x0), row: h.row, trk: h.trk || null, clip: h.clip || null, key: h.zone === 'key' ? h.ki : null, x: r.left + drag.x0, y: r.top + drag.y0 });
      }
    }
    function cancelDrag() {
      if (!drag) return;
      clearTimeout(drag.long);
      if (drag.clip && drag.moved && drag.kind !== 'pending') {
        // Yarım kalan taşıma/kırpma geri alınır
        drag.clip.start = drag.start0;
        drag.clip.dur = drag.dur0;
        if (drag.group) for (const g of drag.group) g.clip.start = g.start0;
      }
      drag = null;
      draw();
    }

    canvas.addEventListener('pointermove', (e) => {
      if (!pointers.has(e.pointerId)) return;
      const p = local(e);
      pointers.set(e.pointerId, p);
      if (pinch && pointers.size >= 2) {
        const [a, b] = [...pointers.values()];
        const d = Math.max(10, Math.abs(a.x - b.x));
        const mx = (a.x + b.x) / 2;
        view.zoom = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, pinch.z0 * d / pinch.d0));
        view.sx = pinch.t * view.zoom - mx;
        view.sy = pinch.sy0 - ((a.y + b.y) / 2 - pinch.my0);
        clampScroll(api.model());
        if (api.zoomed) api.zoomed(view.zoom);
        draw();
        return;
      }
      if (!drag || drag.id !== e.pointerId) return;
      drag.x1 = p.x;
      drag.y1 = p.y;
      drag.samples.push({ x: p.x, y: p.y, t: performance.now() });
      if (drag.samples.length > 6) drag.samples.shift();
      const dist = Math.hypot(p.x - drag.x0, p.y - drag.y0);
      if (!drag.moved && dist < SLOP) return;
      if (!drag.moved) {
        drag.moved = true;
        clearTimeout(drag.long);
        if (drag.kind === 'pending') {
          const h = drag.h;
          if (api.pickMode() && (h.zone === 'lane' || h.zone === 'empty')) drag.kind = 'marquee';
          else drag.kind = 'pan';
        }
      }
      move(p);
      draw();
    }, { passive: false });

    function move(p) {
      const tl = api.model();
      const k = drag.kind;
      if (k === 'pan') {
        view.sx = drag.sx0 - (p.x - drag.x0);
        view.sy = drag.sy0 - (p.y - drag.y0);
        clampScroll(tl);
        return;
      }
      if (k === 'scrub') { api.scrub(api.snapFree(tOf(p.x)), false); return; }
      if (k === 'marquee') return;
      if (k === 'loopL' || k === 'loopR') {
        const t = api.snap(tOf(p.x));
        if (k === 'loopL') tl.loop.start = Math.min(t, tl.loop.end - 0.05);
        else tl.loop.end = Math.max(t, tl.loop.start + 0.05);
        return;
      }
      if (k === 'marker') {
        const m = drag.h.marker;
        m.t = api.snap(drag.mt0 + tOf(p.x) - tOf(drag.x0));
        tl.markers.sort((a, b) => a.t - b.t);
        return;
      }
      if (k === 'tempo') {
        const want = api.snap(drag.tt0 + tOf(p.x) - tOf(drag.x0));
        api.setTempoList(TE().moveTempoChange(drag.base, drag.h.index, want), drag.h.index, false);
        return;
      }
      if (k === 'key') {
        const trk = drag.h.trk;
        const key = trk.keys[api.selKey().keyIndex];
        if (!key) return;
        key.t = api.snap(tOf(p.x));
        key.v = Math.max(0, Math.min(1, (drag.h.bot - 6 - p.y) / (drag.h.bot - drag.h.top - 12)));
        trk.keys.sort((a, b) => a.t - b.t);
        api.keyMoved(trk, trk.keys.indexOf(key));
        return;
      }
      const c = drag.clip;
      if (!c) return;
      const delta = tOf(p.x) - drag.t0;
      if (k === 'fade' || k === 'fadeOut') {
        const v = Math.round(Math.max(0, Math.min(c.dur, k === 'fadeOut' ? c.start + c.dur - tOf(p.x) : tOf(p.x) - c.start)) * 100) / 100;
        if (k === 'fadeOut') c.fadeOut = v;
        else { c.fade = v; if (c.fadeIn > 0) c.fadeIn = v; }
        return;
      }
      if (k === 'move' && drag.group) {
        const want = api.snap(drag.start0 + delta, [c]) - drag.start0;
        const d = TE().groupDelta(drag.group.map((g) => g.start0), want);
        const touched = new Set();
        for (const g of drag.group) { g.clip.start = g.start0 + d; touched.add(g.trk); }
        touched.forEach((t) => TE().sortClips(t));
        return;
      }
      if (k === 'move') {
        c.start = api.snapMove(drag.start0 + delta, c.dur, [c]);
        // Dikey taşıma: parmağın satırı hedef parça; son satırın altı yeni parça
        const row = Math.floor((p.y - RULER_H + view.sy) / laneH());
        const cur = tl.tracks.indexOf(drag.trk);
        drag.newTrack = row >= tl.tracks.length;
        if (!drag.newTrack && row >= 0 && row !== cur) {
          const to = TE().moveClipToTrack(tl, c, row);
          if (to) { drag.trk = to; api.selectClip(to, c, true); }
        }
        TE().sortClips(drag.trk);
        return;
      }
      if (k === 'trimL') {
        const ns = api.snap(drag.start0 + delta, [c]);
        const end = drag.start0 + drag.dur0;
        c.start = Math.min(ns, end - 0.05);
        c.dur = end - c.start;
        TE().sortClips(drag.trk);
        return;
      }
      if (k === 'trimR') c.dur = Math.max(0.05, api.snap(drag.start0 + drag.dur0 + delta, [c]) - c.start);
    }

    function release(e, cancelled) {
      if (!pointers.has(e.pointerId)) return;
      pointers.delete(e.pointerId);
      if (pinch) { if (pointers.size < 2) pinch = null; drag = null; return; }
      if (!drag || drag.id !== e.pointerId) return;
      const d = drag;
      drag = null;
      clearTimeout(d.long);
      if (cancelled) { drag = d; cancelDrag(); return; }
      const tl = api.model();
      if (d.kind === 'menu') return;
      if (d.kind === 'scrub') { api.scrub(api.snapFree(tOf(d.x1)), true); draw(); return; }
      if (d.kind === 'pan') { startFling(d); return; }
      if (d.kind === 'marquee') {
        const i0 = Math.floor((Math.min(d.y0, d.y1) - RULER_H + view.sy) / laneH());
        const i1 = Math.floor((Math.max(d.y0, d.y1) - RULER_H + view.sy) / laneH());
        api.pickRect(TE().clipsInRect(tl, tOf(Math.min(d.x0, d.x1)), tOf(Math.max(d.x0, d.x1)), i0, i1));
        draw();
        return;
      }
      if (!d.moved) { tap(d); return; }
      if (d.kind === 'move' && d.newTrack && d.clip) {
        const to = TE().moveClipToTrack(tl, d.clip, tl.tracks.length, () => TL().makeTrack({ kind: 'clip', name: api.tr('Parça') + ' ' + (tl.tracks.length + 1) }));
        if (to) api.selectClip(to, d.clip, true);
      }
      if (d.kind === 'tempo') { api.setTempoList(null, d.h.index, true); draw(); return; }
      api.changed(d.kind);
      draw();
    }
    canvas.addEventListener('pointerup', (e) => release(e, false));
    canvas.addEventListener('pointercancel', (e) => release(e, true));

    function startFling(d) {
      const s = d.samples;
      if (s.length < 2) return;
      const a = s[0], b = s[s.length - 1];
      const dt = Math.max(1, b.t - a.t);
      let vx = (b.x - a.x) / dt * 16;
      let vy = (b.y - a.y) / dt * 16;
      if (performance.now() - b.t > 80 || (Math.abs(vx) < 2 && Math.abs(vy) < 2)) return;
      const tl = api.model();
      const stepF = () => {
        vx *= 0.94; vy *= 0.94;
        view.sx -= vx; view.sy -= vy;
        clampScroll(tl);
        paint();
        fling = Math.abs(vx) > 0.4 || Math.abs(vy) > 0.4 ? requestAnimationFrame(stepF) : 0;
      };
      fling = requestAnimationFrame(stepF);
    }

    function tap(d) {
      // Tutamaca hareketsiz dokunuş klibe dokunuştur (çift dokunuş ikinci dokunuşta tutamağa düşebilir)
      const h = /^(trimL|trimR|fade|fadeOut)$/.test(d.h.zone) ? Object.assign({}, d.h, { zone: 'clip' }) : d.h;
      const now = performance.now();
      const key = h.zone + ':' + (h.clip ? h.clip.id : h.marker ? h.marker.id : h.zone === 'key' ? h.row + '/' + h.ki : h.zone === 'tempo' ? h.index : h.row);
      const dbl = lastTap && lastTap.key === key && now - lastTap.t < DOUBLE_MS;
      lastTap = dbl ? null : { key, t: now };
      if (h.zone === 'clip') {
        if (api.pickMode()) api.toggleMulti(h.trk, h.clip);
        else { api.selectClip(h.trk, h.clip); if (dbl) api.inspect(); }
      } else if (h.zone === 'key') { api.selectKey(h.trk, h.ki); if (dbl) api.inspect(); }
      else if (h.zone === 'marker') { api.selectMarker(h.marker); if (dbl) api.inspect(); }
      else if (h.zone === 'tempo') { api.selectTempo(h.index); if (dbl) api.inspect(); }
      else if (h.zone === 'lane' && h.trk && h.trk.kind === 'automation' && dbl && !h.trk.locked) {
        api.addKey(h.trk, api.snap(tOf(d.x0)), Math.max(0, Math.min(1, (h.bot - 6 - d.y0) / (h.bot - h.top - 12))));
      } else if (h.zone === 'lane' && h.trk && h.trk.kind === 'clip' && dbl && !h.trk.locked) {
        api.addClipAt(h.trk, api.snap(tOf(d.x0)));
      } else if (h.zone === 'lane' || h.zone === 'empty') api.clearSelection(h.trk || null);
      draw();
    }

    /* Probe ve erişilebilirlik için: klip, nokta, işaret ve tutamaçların ekrandaki yerleri
       (CSS px, sayfaya göre). Tuvalde DOM düğümü olmadığı için yoklama gerçek dokunuşu
       buradan alır. */
    function layout() {
      const r = canvas.getBoundingClientRect();
      const tl = api.model();
      const lh = laneH();
      const out = { ruler: { x: r.left, y: r.top, w: r.width, h: RULER_H }, zoom: view.zoom, sx: view.sx, clips: [], keys: [], markers: [], rows: [] };
      tl.tracks.forEach((trk, i) => {
        const top = rowTop(i);
        out.rows.push({ id: trk.id, kind: trk.kind, y: r.top + top, h: lh });
        if (trk.kind === 'clip') {
          for (const c of trk.clips) { const q = clipRect(c, top, lh); out.clips.push({ id: c.id, track: trk.id, x: r.left + q.x, y: r.top + q.y, w: q.w, h: q.h }); }
        } else {
          (trk.keys || []).forEach((k, ki) => out.keys.push({ track: trk.id, index: ki, x: r.left + xOf(k.t), y: r.top + keyY(k.v, top, lh) }));
        }
      });
      for (const f of flagRects) out.markers.push({ id: f.marker.id, x: r.left + f.x, y: r.top + f.y, w: f.w, h: f.h });
      out.tempo = tempoRects.map((q) => ({ index: q.index, x: r.left + q.x, y: r.top + q.y, w: q.w, h: q.h }));
      return out;
    }

    function destroy() { if (ro) ro.disconnect(); stopFling(); if (raf) cancelAnimationFrame(raf); raf = 0; canvas.remove(); }
    requestAnimationFrame(resize);
    return {
      el: canvas, draw, resize, fit, follow, reveal, layout, destroy,
      setZoom, zoom: () => view.zoom, xOf, tOf, themeChanged: () => { colors = null; draw(); },
      scrollY: () => view.sy, RULER_H,
    };
  }

  window.SVTimelineLane = Object.freeze({ create, RULER_H });
})();
