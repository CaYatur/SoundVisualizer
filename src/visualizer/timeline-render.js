/*
 * SoundVisualizer — CaYaDev Ses Görselleştirici
 * Copyright (c) 2026 Çağan Turgut (CaYatur) — CaYaDev, https://cayadev.com
 * SPDX-License-Identifier: MIT
 */
'use strict';
/* Her Timeline klibi ayrı bir sahne yüzeyidir. Sahne efektleri birleşmeden
   ÖNCE uygulanır; klip/parça opaklığı işlenmiş yüzeye bir kez uygulanır.
   Mevcut geçiş birleştiricisi (wipe/slide/zoom/maske/…) saf p ile sürülür.
   Canlı LayerStack.draw ve dışa aktarım composeTo AYNI yolu kullanır. */
(function () {
  class Renderer {
    constructor(env) {
      this.env = env || {
        canvas: () => document.createElement('canvas'),
        stack: () => new window.SVLayers.LayerStack(null),
        compositor: () => new window.SVTransition.Compositor(),
      };
      this.children = new Map();
      this.compositor = this.env.compositor();
      this.from = this.env.canvas();
      this.to = this.env.canvas();
    }
    size(c, w, h) { if (c.width !== w) c.width = w; if (c.height !== h) c.height = h; }
    prepare(plan) {
      if (this.time != null && plan.time != null && plan.time < this.time - 1e-6) { this.dispose(); }
      this.time = plan.time;
      const units = plan.units || [];
      const active = new Set(units.map((u) => u.id));
      for (const [id, c] of this.children) if (!active.has(id)) { c.stack.dispose(); this.children.delete(id); }
      for (const u of units) {
        let c = this.children.get(u.id);
        if (!c) { c = { stack: this.env.stack(), sig: null, modulator: typeof window !== 'undefined' && window.SVModulation ? new window.SVModulation.Modulator() : null }; this.children.set(u.id, c); }
        const s = c.stack; c.unit = u;
        // Ana ayar değil yalnız sahne alanları: aygıt/kitaplık değişimi motoru yeniden kurmaz
        const keys = (typeof window !== 'undefined' && window.SVSchema && window.SVSchema.SCENE_KEYS) || Object.keys(u.cfg);
        const sig = JSON.stringify(keys.map((k) => u.cfg[k]));
        if (sig !== c.sig) {
          c.sig = sig;
          s.setConfig(u.cfg); s.setPostFX(u.cfg.postfx || []);
          if (s.syncMedia) s.syncMedia(u.cfg);
        }
      }
    }
    async readyAssets() {
      const waits = [];
      for (const c of this.children.values()) for (const e of c.stack.entries || []) {
        const l = e.layer, cfg = c.stack.prevCfg || c.stack.cfg;
        if (l.kind === 'sprites' && typeof window !== 'undefined' && window.SVSprites) {
          if (!e.sprites) e.sprites = new window.SVSprites();
          const images = l.settings && l.settings.images || cfg && cfg.images || {};
          e.sprites.setItems(images.enabled === false ? [] : images.items || []);
          waits.push(e.sprites.whenReady());
        }
        if (l.kind === 'logo' && typeof window !== 'undefined' && window.SVLayers.logoFileSrc) {
          const logo = l.settings && l.settings.logo || cfg && cfg.logo;
          const src = logo && window.SVLayers.logoFileSrc(logo);
          const img = src && c.stack._getImage(src);
          if (img && img.decode) waits.push(img.decode().catch(() => {}));
        }
      }
      let timer;
      try {
        return await Promise.race([Promise.all(waits).then(() => true), new Promise((resolve) => { timer = setTimeout(() => resolve(false), 5000); })]);
      } finally { clearTimeout(timer); }
    }
    async seekMedia(plan) {
      this.prepare(plan);
      const waits = [];
      for (const u of plan.units || []) {
        const s = this.children.get(u.id).stack;
        if (s._mediaPool) for (const m of s._mediaPool.values()) if (m.seekTo) waits.push(m.seekTo(u.localTime));
      }
      const assetsReady = await this.readyAssets();
      return assetsReady && (await Promise.all(waits)).every((r) => r !== false);
    }
    draw(ctx, plan, audio, t, dt, w, h, drawLogo) {
      const units = plan.units || [];
      this.prepare(plan);
      this.size(this.from, w, h); this.size(this.to, w, h);
      const fromCtx = this.from.getContext('2d');
      const toCtx = this.to.getContext('2d');
      ctx.save(); ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.globalAlpha = 1;
      ctx.globalCompositeOperation = 'source-over'; ctx.clearRect(0, 0, w, h);
      ctx.fillStyle = '#000'; ctx.fillRect(0, 0, w, h);
      for (const u of units) {
        const c = this.children.get(u.id);
        const s = c.stack;
        const localT = plan.time == null ? t : plan.time;
        let childCfg = u.cfg;
        if (c.modulator) { c.modulator.update(childCfg, audio, localT, dt); childCfg = c.modulator.apply(childCfg, dt); }
        if (s._mediaPool) for (const m of s._mediaPool.values()) if (!m.offline && m.seekTimeline) m.seekTimeline(u.localTime);
        if (s.width !== w || s.height !== h) s.resize(w, h);
        s._ensureComp(); this.size(s.compCanvas, w, h);
        if (c.modulator && c.modulator.touches('postfx')) s.setPostFX(childCfg.postfx);
        s.drawTo(s.compCtx, audio, childCfg, localT, dt, drawLogo);
        let image = s.compCanvas;
        if (s.postfx && s._lostNow && s._lostNow(s.postfx, '_fxRevivedAt')) {
          const chain = s.postfx.chain; s.postfx.dispose();
          s.postfx = new window.SVPostFX.PostFX(); s.postfx.setChain(chain);
        }
        if (s.postfx && s.postfx.hasWork()) {
          s.postfx.resize(w, h); s.postfx.render(image, audio, localT, dt, true); image = s.postfx.canvas;
        }
        // Geçiş: mevcut etkin alt bileşim -> üzerine yeni klip eklenmiş bileşim.
        // Süresi dolmuş klipten snapshot alınmaz; sarma sırası sonucu değiştirmez.
        fromCtx.clearRect(0, 0, w, h); fromCtx.drawImage(ctx.canvas, 0, 0, w, h);
        toCtx.clearRect(0, 0, w, h); toCtx.globalAlpha = 1; toCtx.drawImage(this.from, 0, 0, w, h);
        toCtx.globalAlpha = u.opacity; toCtx.drawImage(image, 0, 0, w, h); toCtx.globalAlpha = 1;
        if (u.transition) this.compositor.compose(ctx, this.from, this.to, w, h, u.transition.type, u.transition.p, u.transition.params);
        else { ctx.clearRect(0, 0, w, h); ctx.drawImage(this.to, 0, 0, w, h); }
      }
      ctx.restore();
    }
    read(method, ...args) {
      for (const c of Array.from(this.children.values()).reverse()) {
        if (c.unit && c.unit.opacity <= 0) continue;
        if (typeof c.stack[method] !== 'function') continue;
        const value = method === 'palette' ? c.stack.palette(c.unit.cfg) : c.stack[method](...args);
        if (value != null && (!Array.isArray(value) || value.length)) return value;
      }
      return null;
    }
    layerReadouts() {
      const out = {};
      for (const c of this.children.values()) if (c.stack.milkdropLayers) Object.assign(out, c.stack.milkdropLayers() || {});
      return Object.keys(out).length ? out : null;
    }
    assetModes() { return Array.from(this.children.values()).flatMap((c) => c.stack._assetModes()); }
    dispose() { for (const c of this.children.values()) c.stack.dispose(); this.children.clear(); }
  }
  if (typeof module !== 'undefined' && module.exports) module.exports = { Renderer };
  if (typeof window !== 'undefined') window.SVTimelineRender = { Renderer };
})();
