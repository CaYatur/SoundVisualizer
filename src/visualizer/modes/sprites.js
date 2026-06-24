'use strict';
/* Ek görsel nesneler / partikül katmanı (2D canvas).
   Bir veya birden fazla resim yüklenir; her resim "emitör" olur ve N kopya
   (partikül) üretir. Konumlar zamanın SAF (analitik) fonksiyonudur — dt ile
   integral alınmaz — böylece canlı görselleştirici ile dışa aktarım birebir
   aynı kareyi üretir (deterministik). Ses (bas/seviye) boyut, hız ve saçılmayı
   anlık olarak modüle eder. */
(function () {
  // mulberry32 — küçük, hızlı, deterministik PRNG (partikül sabitleri için)
  function mulberry32(a) {
    return function () {
      a |= 0;
      a = (a + 0x6d2b79f5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  function frac(x) {
    return x - Math.floor(x);
  }
  function clamp(v, a, b) {
    return v < a ? a : v > b ? b : v;
  }

  class SpriteSystem {
    constructor() {
      this.items = [];
      this.cache = new Map(); // src -> { img, ready, promise }
    }

    _img(src) {
      if (!src) return null;
      let e = this.cache.get(src);
      if (!e) {
        const img = new Image();
        e = { img, ready: false, promise: null };
        e.promise = new Promise((res) => {
          img.onload = () => {
            e.ready = true;
            res();
          };
          img.onerror = () => {
            e.ready = false;
            res();
          };
        });
        img.src = src;
        this.cache.set(src, e);
      }
      return e;
    }

    // Yapılandırmadan emitör listesini hazırla (her src için resmi yükler ve
    // count adet partikülün deterministik sabitlerini üretir).
    setItems(itemsCfg) {
      const list = Array.isArray(itemsCfg) ? itemsCfg : [];
      this.items = list.filter((c) => c && c.src).map((c) => this._prepare(c));
    }

    _prepare(cfg) {
      const count = clamp(cfg.count | 0 || 1, 1, 240);
      const rng = mulberry32((cfg.seed || 1) >>> 0);
      const bx = new Float32Array(count);
      const by = new Float32Array(count);
      const ph = new Float32Array(count);
      const fx = new Float32Array(count);
      const fy = new Float32Array(count);
      const sz = new Float32Array(count);
      const ang = new Float32Array(count);
      const rad = new Float32Array(count);
      const spin = new Float32Array(count);
      const al = new Float32Array(count);
      for (let i = 0; i < count; i++) {
        bx[i] = rng();
        by[i] = rng();
        ph[i] = rng() * Math.PI * 2;
        fx[i] = 0.3 + rng() * 1.2;
        fy[i] = 0.3 + rng() * 1.2;
        sz[i] = 1 - clamp(cfg.sizeVar || 0, 0, 0.95) * rng();
        ang[i] = rng() * Math.PI * 2;
        rad[i] = 0.15 + rng() * 0.85;
        spin[i] = (rng() < 0.5 ? -1 : 1) * (0.5 + rng());
        al[i] = 0.55 + rng() * 0.45;
      }
      return { cfg, imgEntry: this._img(cfg.src), count, bx, by, ph, fx, fy, sz, ang, rad, spin, al };
    }

    // Tüm resimler yüklenene kadar bekle (dışa aktarımda kare 0'dan itibaren hazır olsun)
    whenReady() {
      return Promise.all(this.items.map((it) => (it.imgEntry ? it.imgEntry.promise : Promise.resolve())));
    }

    // Verilen katmana ('front'|'back') ait emitörleri ctx üzerine çiz.
    draw(ctx, audio, t, W, H, layer) {
      const minDim = Math.min(W, H);
      const asp = W / H;
      const bass = audio.bass || 0;
      const level = audio.level || 0;
      for (const it of this.items) {
        const c = it.cfg;
        if ((c.layer || 'front') !== layer) continue;
        const e = it.imgEntry;
        if (!e || !e.ready) continue;
        const img = e.img;
        const iw = img.naturalWidth || 1;
        const ih = img.naturalHeight || 1;
        const ratio = ih / iw;
        const spread = c.spread != null ? c.spread : 0.7;
        const speed = (c.speed || 0) * (1 + level * (c.audioSpeed || 0) * 2);

        ctx.save();
        ctx.globalCompositeOperation =
          c.blend === 'screen' ? 'screen' : c.blend === 'add' ? 'lighter' : 'source-over';
        if ((c.glow || 0) > 0) {
          ctx.shadowBlur = c.glow * 42 * (minDim / 1080);
          ctx.shadowColor = 'rgba(255,255,255,0.55)';
        }

        // Tüm partiküllerin normalleştirilmiş konumlarını ve boyutlarını hesapla
        const pxArr = new Float32Array(it.count);
        const pyArr = new Float32Array(it.count);
        const sArr = new Float32Array(it.count);
        for (let i = 0; i < it.count; i++) {
          let px, py;
          switch (c.motion) {
            case 'static':
              px = it.bx[i] + Math.sin(t * 0.6 + it.ph[i]) * 0.0025;
              py = it.by[i] + Math.cos(t * 0.6 + it.ph[i]) * 0.0025;
              break;
            case 'orbit': {
              const a = it.ang[i] + t * speed * it.spin[i] * 0.5;
              const r = (0.12 + it.rad[i] * 0.4) * spread;
              px = 0.5 + (Math.cos(a) * r) / asp;
              py = 0.5 + Math.sin(a) * r;
              break;
            }
            case 'swirl': {
              const a = it.ang[i] + t * speed * it.spin[i] * 0.5;
              const r =
                (0.12 + it.rad[i] * 0.4) * spread * (0.7 + 0.3 * Math.sin(t * 0.8 + it.ph[i]) + bass * 0.4);
              px = 0.5 + (Math.cos(a) * r) / asp;
              py = 0.5 + Math.sin(a) * r;
              break;
            }
            case 'scatter': {
              const base = 0.04 + it.rad[i] * 0.05;
              const burst =
                base + (it.rad[i] * 0.6 + 0.2) * spread * (bass * 2.2 * (0.5 + (c.audioSpeed || 0)) + level * 0.3);
              px = 0.5 + (Math.cos(it.ang[i]) * burst) / asp;
              py = 0.5 + Math.sin(it.ang[i]) * burst;
              break;
            }
            case 'rise':
              px = it.bx[i] + Math.sin(t * speed * it.fx[i] + it.ph[i]) * 0.04 * spread;
              py = frac(it.by[i] - t * speed * 0.08);
              break;
            case 'fall':
              px = it.bx[i] + Math.sin(t * speed * it.fx[i] + it.ph[i]) * 0.04 * spread;
              py = frac(it.by[i] + t * speed * 0.08);
              break;
            case 'float':
            default: {
              const amp = 0.18 * spread;
              px = it.bx[i] + Math.sin(t * speed * it.fx[i] + it.ph[i]) * amp;
              py = it.by[i] + Math.cos(t * speed * it.fy[i] + it.ph[i] * 1.3) * amp;
              break;
            }
          }
          pxArr[i] = px;
          pyArr[i] = py;
          sArr[i] = (c.size || 0.06) * minDim * it.sz[i] * (1 + bass * (c.audioSize || 0));
        }

        // Üst üste binme engeli: partikülleri birbirinden iterek minimum mesafeyi koru
        if (c.noOverlap) {
          const minDistFactor = c.minDist != null ? c.minDist : 1.1;
          const ITERS = 4;
          for (let iter = 0; iter < ITERS; iter++) {
            for (let i = 0; i < it.count - 1; i++) {
              if (sArr[i] < 0.5) continue;
              for (let j = i + 1; j < it.count; j++) {
                if (sArr[j] < 0.5) continue;
                const minPx = (sArr[i] + sArr[j]) * 0.5 * minDistFactor;
                const dx = (pxArr[j] - pxArr[i]) * W;
                const dy = (pyArr[j] - pyArr[i]) * H;
                const dist = Math.sqrt(dx * dx + dy * dy) || 0.001;
                if (dist < minPx) {
                  const push = (minPx - dist) * 0.5;
                  const nx = (dx / dist) * push;
                  const ny = (dy / dist) * push;
                  pxArr[i] -= nx / W;
                  pyArr[i] -= ny / H;
                  pxArr[j] += nx / W;
                  pyArr[j] += ny / H;
                }
              }
            }
          }
        }

        for (let i = 0; i < it.count; i++) {
          const s = sArr[i];
          if (s < 0.5) continue;
          const w = s;
          const h = s * ratio;
          let a = (c.opacity != null ? c.opacity : 1) * it.al[i] * (1 + bass * (c.audioOpacity || 0));
          ctx.globalAlpha = clamp(a, 0, 1);
          const rot = it.ph[i] + t * (c.spin || 0) * it.spin[i] * 1.2;
          ctx.translate(pxArr[i] * W, pyArr[i] * H);
          ctx.rotate(rot);
          ctx.drawImage(img, -w / 2, -h / 2, w, h);
          ctx.setTransform(1, 0, 0, 1, 0, 0);
        }
        ctx.restore();
      }
    }

    // Herhangi bir 'back' / 'front' katmanında emitör var mı? (boş karelerde atla)
    hasLayer(layer) {
      return this.items.some((it) => (it.cfg.layer || 'front') === layer);
    }
  }

  window.SVSprites = SpriteSystem;
})();
