/*
 * SoundVisualizer — CaYaDev Ses Görselleştirici
 * Copyright (c) 2026 Çağan Turgut (CaYatur) — CaYaDev, https://cayadev.com
 * https://github.com/CaYatur/SoundVisualizer
 * SPDX-License-Identifier: MIT
 */
'use strict';
/* Geçiş önizlemesi (#957): YALNIZ panelde, küçük bir tuvalde.

   "Geçişi Dene" önce canlı yığına geçişi başlatıp aynı sahneyi kendisine
   geçiriyordu: giden ve gelen kare aynı olduğu için hiçbir şey görünmüyordu,
   üstelik çıkışa (pencere, kayıt, NDI/Spout) gidiyordu. Bu önizleme çıkışa
   hiç dokunmuyor: iki karşıt örnek sahneyi (parlak sıcak çubuklar ↔ koyu
   soğuk dalga) kendisi çiziyor ve ayarlı tür, süre, birim, eğri ile geçiriyor;
   ardından karartma (blackout) ayarını da gösteriyor.

   Düşük maliyet: 240×135 tuval, saniyede en çok ~30 kare; tuval sayfadan
   kalkınca ya da Durdur'a basınca döngü kendiliğinden bitiyor. */
(function () {
  const W = 240;
  const H = 135;
  const tt = (x) => (window.SVI18n && window.SVI18n.t ? window.SVI18n.t(x) : x);
  /* Örnek sahnelerin renkleri arayüz değil, İÇERİK: tema ile değişmemeli,
     iki sahne her temada birbirinden açıkça ayrılmalı. */
  const PAL = {
    aTop: '#ffbe3c', aBot: '#e63c5a', aBg: '#ffecc8',
    bBg: '#080e28', bLine: '#3cdcff', bDot: '#8c50ff',
    black: '#000000',
  };
  const HOLD = 0.6; // geçişler arası bekleme (sn)

  /* Oynatma planı: [A bekle] → A→B geçiş → [B bekle] → B→siyah karartma →
     [siyah bekle] → siyah→A açılış. Saf işlev; test edilebilir. */
  function phases(spec, bpm) {
    const T = (typeof window !== 'undefined' && window.SVTransition) || (typeof require === 'function' ? require('../shared/transition.js') : null);
    const s = spec || {};
    const dur = T ? T.durationSeconds({ transition: s }, bpm || 0) : Math.max(0.02, s.duration || 0.6);
    const type = s.type || 'crossfade';
    const ease = s.ease || 'smooth';
    const bType = s.blackoutType || 'crossfade';
    const bDur = bType === 'cut' ? 0 : Math.max(0.02, s.blackoutDuration == null ? 0.4 : s.blackoutDuration);
    const bTrans = bType === 'dissolve' ? 'dissolve' : bType === 'cut' ? 'cut' : 'crossfade';
    const list = [];
    let t = 0;
    const push = (o) => { o.t0 = t; t += o.len; o.t1 = t; list.push(o); };
    push({ kind: 'hold', from: 'A', len: HOLD });
    push({ kind: 'trans', from: 'A', to: 'B', type, ease, opts: s.params || {}, len: s.enabled === false || type === 'cut' ? 0.001 : dur, label: 'Geçiş' });
    push({ kind: 'hold', from: 'B', len: HOLD });
    push({ kind: 'trans', from: 'B', to: 'black', type: bTrans, ease: 'linear', opts: { blackoutDirection: 'out' }, len: Math.max(0.001, bDur), label: 'Karartma' });
    push({ kind: 'hold', from: 'black', len: HOLD * 0.6 });
    push({ kind: 'trans', from: 'black', to: 'A', type: bTrans, ease: 'linear', opts: { blackoutDirection: 'in' }, len: Math.max(0.001, bDur), label: 'Karartma' });
    return { list, total: t };
  }

  // t anında ne çizilecek: { from, to, type, p (eğrili), label }
  function sampleAt(plan, t) {
    const T = (typeof window !== 'undefined' && window.SVTransition) || (typeof require === 'function' ? require('../shared/transition.js') : null);
    const x = Math.max(0, Math.min(plan.total, t));
    const ph = plan.list.find((q) => x < q.t1) || plan.list[plan.list.length - 1];
    if (ph.kind === 'hold') return { from: ph.from, to: null, type: null, p: 0, label: '' };
    const raw = Math.max(0, Math.min(1, (x - ph.t0) / ph.len));
    const p = T ? T.easeOf(ph.ease)(raw) : raw;
    return { from: ph.from, to: ph.to, type: ph.type, p, opts: ph.opts, label: ph.label };
  }

  // Örnek sahne A: parlak, sıcak paletli çubuklar
  function drawA(ctx, time) {
    const g = ctx.createLinearGradient(0, 0, 0, H);
    g.addColorStop(0, PAL.aTop);
    g.addColorStop(1, PAL.aBot);
    ctx.fillStyle = PAL.aBg;
    ctx.fillRect(0, 0, W, H);
    ctx.fillStyle = g;
    const n = 16;
    const bw = W / n;
    for (let i = 0; i < n; i++) {
      const h = H * (0.25 + 0.6 * Math.abs(Math.sin(time * 2.2 + i * 0.7)));
      ctx.fillRect(i * bw + 2, H - h, bw - 4, h);
    }
  }
  // Örnek sahne B: koyu, soğuk paletli dalga
  function drawB(ctx, time) {
    ctx.fillStyle = PAL.bBg;
    ctx.fillRect(0, 0, W, H);
    ctx.strokeStyle = PAL.bLine;
    ctx.lineWidth = 3;
    ctx.beginPath();
    for (let x = 0; x <= W; x += 4) {
      const y = H / 2 + Math.sin(x / 18 + time * 3) * H * 0.28 * Math.sin(time * 0.9 + x / 90);
      if (x) ctx.lineTo(x, y); else ctx.moveTo(x, y);
    }
    ctx.stroke();
    ctx.globalAlpha = 0.35;
    ctx.fillStyle = PAL.bDot;
    ctx.beginPath();
    ctx.arc(W * 0.78, H * 0.3, 18 + 6 * Math.sin(time * 4), 0, Math.PI * 2);
    ctx.fill();
    ctx.globalAlpha = 1;
  }
  function drawBlack(ctx) {
    ctx.fillStyle = PAL.black;
    ctx.fillRect(0, 0, W, H);
  }

  /* Önizleme kutusu: tuval + Oynat/Döngü/Durdur. getSpec her oynatmada
     okunuyor; ayar değişince yeniden oynatmak yeter. */
  function create(getSpec, opts) {
    const P = window.SVPanel;
    const el = P.el;
    const o = opts || {};
    const cv = el('canvas', { class: 'tr-preview-cv', width: String(W), height: String(H), 'aria-label': 'Geçiş önizlemesi' });
    const cap = el('span', { class: 'tr-preview-cap', text: '' });
    let raf = 0;
    let loop = !!o.loop;
    let t0 = 0;
    let plan = null;
    let last = 0;
    const mk = () => { const c = document.createElement('canvas'); c.width = W; c.height = H; return c; };
    let bufA = null;
    let bufB = null;
    let bufK = null;
    let comp = null;
    const stop = () => {
      if (raf) cancelAnimationFrame(raf);
      raf = 0;
      playBtn.classList.remove('on');
    };
    const frame = (now) => {
      raf = 0;
      // Kart kapandı / sayfa değişti: döngü kendiliğinden biter
      if (!cv.isConnected) { stop(); return; }
      if (now - last < 30) { raf = requestAnimationFrame(frame); return; }
      last = now;
      let t = (now - t0) / 1000;
      if (t >= plan.total) {
        if (!loop) { render(plan.total); stop(); return; }
        t0 = now;
        t = 0;
      }
      render(t);
      raf = requestAnimationFrame(frame);
    };
    const pick = (id) => (id === 'A' ? bufA : id === 'B' ? bufB : bufK);
    const render = (t) => {
      const ctx = cv.getContext('2d');
      if (!ctx) return;
      const s = sampleAt(plan, t);
      drawA(bufA.getContext('2d'), t);
      drawB(bufB.getContext('2d'), t);
      if (!s.to) ctx.drawImage(pick(s.from), 0, 0, W, H);
      else comp.compose(ctx, pick(s.from), pick(s.to), W, H, s.type, s.p, s.opts);
      cap.textContent = s.label ? tt(s.label) + ' ' + Math.round(s.p * 100) + '%' : '';
    };
    const play = () => {
      const T = window.SVTransition;
      if (!T) return false;
      if (!bufA) { bufA = mk(); bufB = mk(); bufK = mk(); drawBlack(bufK.getContext('2d')); comp = new T.Compositor(); }
      plan = phases(getSpec(), o.bpm ? o.bpm() : 0);
      t0 = performance.now();
      last = 0;
      playBtn.classList.add('on');
      if (!raf) raf = requestAnimationFrame(frame);
      return true;
    };
    const playBtn = el('button', { class: 'btn small', type: 'button', icon: 'play', text: 'Önizle', title: 'Geçişi yalnız bu küçük önizlemede oynat (çıkışa gitmez)', onclick: play });
    const loopBtn = el('button', { class: 'btn small' + (loop ? ' on' : ''), type: 'button', icon: 'loop', text: 'Döngü', 'aria-pressed': loop ? 'true' : 'false', title: 'Önizlemeyi sürekli tekrarla',
      onclick: () => { loop = !loop; loopBtn.classList.toggle('on', loop); loopBtn.setAttribute('aria-pressed', loop ? 'true' : 'false'); if (loop && !raf) play(); } });
    const stopBtn = el('button', { class: 'btn small', type: 'button', icon: 'stop', text: 'Durdur', title: 'Önizlemeyi durdur', onclick: stop });
    const box = el('div', { class: 'tr-preview' }, [cv, el('div', { class: 'tr-preview-bar' }, [playBtn, loopBtn, stopBtn, cap])]);
    box._play = play;
    box._stop = stop;
    box._running = () => !!raf;
    return box;
  }

  const api = { phases, sampleAt, create, W, H };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (typeof window !== 'undefined') window.SVTransitionPreview = api;
})();
