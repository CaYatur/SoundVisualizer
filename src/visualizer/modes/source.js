/*
 * SoundVisualizer — CaYaDev Ses Görselleştirici
 * Copyright (c) 2026 Çağan Turgut (CaYatur) — CaYaDev, https://cayadev.com
 * https://github.com/CaYatur/SoundVisualizer
 * SPDX-License-Identifier: MIT
 */
'use strict';
/* DIŞ KAYNAK KATMANININ ÇİZİCİSİ (Spout/Syphon girişi, web sayfası).

   Kaynak ana süreçte açılıyor (src/main/layer-sources.js); kare bu
   pencerenin önyükleme betiğinin gizli tuvaline geliyor
   (`canvas[data-sv-source="<anahtar>"]`). Burada o tuval katmanın tuvaline
   sığdırılarak çizilir: içine sığdır, kapla, uzat, ayna, ters çevir.

   OBS yayın sayfası (tarayıcı kaynağı) dokuyu alamaz. Kare, kamerada olduğu
   gibi uygulama penceresinden sıkıştırılıp yayın sunucusu üzerinden gider
   (`cam-frame`, anahtar `src:<anahtar>`); yayın sayfası onu çizer. WebP
   saydamlığı taşır: saydam bir web sayfası yayında da saydam kalır.

   Kare yoksa çıkışta HİÇBİR ŞEY çizilmez: seyirci "bekleniyor" yazısı
   görmemeli. Panel önizlemesi ise durumu yazar. */
(function () {
  const SL = () => window.SVSourceLayers;
  const STALE_MS = 1500;
  const RELAY_MS = 80;
  const RELAY_MAX_W = 1280;

  function webPage() {
    return typeof location !== 'undefined' && /^https?:$/.test(location.protocol);
  }

  function norm(r, W, H) {
    return W > 0 && H > 0 && r.dw > 0 && r.dh > 0 ? { x: r.dx / W, y: r.dy / H, w: r.dw / W, h: r.dh / H } : null;
  }

  function frameCanvas(key) {
    if (!key || typeof document === 'undefined') return null;
    const sel = 'canvas[data-sv-source="' + (window.CSS && CSS.escape ? CSS.escape(key) : key.replace(/"/g, '\\"')) + '"]';
    return document.querySelector(sel);
  }

  class SourceLayer {
    constructor(opts) {
      this.opts = opts || {};
      this.key = '';
      this._pump = null;
      this._claimTimer = null;
      this._encoding = false;
      this._relayKey = null;
      this._cap = null;
      this._capCtx = null;
      this._frozen = null;
    }

    /* DONDURMA (kusursuz döngü dışa aktarımı). Canlı bir kaynak (zamanlayıcılı
       web sayfası, Spout/Syphon) kendi saatiyle akar: videonun son karesi ile
       ilk karesi hiç buluşmaz, döngü kapanmaz. Dışa aktarıcı döngüde o anki
       kareyi KOPYALAYIP bütün video boyunca onu çizer; durağan bir görüntü
       döngüyü bozmaz. Kare henüz yoksa false. */
    freeze() {
      if (this._frozen) return true;
      const f = this.frame();
      if (!f || !(f.w > 0 && f.h > 0)) return false;
      const snap = document.createElement('canvas');
      snap.width = f.w;
      snap.height = f.h;
      snap.getContext('2d').drawImage(f.pic, 0, 0, f.w, f.h);
      this._frozen = { pic: snap, w: f.w, h: f.h, seq: 'frozen' };
      return true;
    }

    setLayer(layer) {
      const S = SL();
      this._kind = layer && layer.kind;
      const key = S ? S.sourceKey(layer) : '';
      if (key === this.key) return;
      this._stopRelay();
      this.key = key;
      if (key && !webPage()) this._startRelay(key);
    }

    /* Bu karede çizilecek görüntü: { pic, w, h, at } ya da null. */
    frame() {
      if (!this.key) return null;
      // Donmuş kare hiç bayatlamaz (at her çağrıda şimdi)
      if (this._frozen) return Object.assign({ at: Date.now() }, this._frozen);
      if (webPage()) {
        const slot = typeof window.SVRelaySlot === 'function' ? window.SVRelaySlot('src:' + this.key) : null;
        if (!slot || !slot.ready || !slot.img.naturalWidth) return null;
        return { pic: slot.img, w: slot.img.naturalWidth, h: slot.img.naturalHeight, at: slot.at };
      }
      const c = frameCanvas(this.key);
      if (!c || !c.width || !c.height || !c.dataset.at) return null;
      return { pic: c, w: c.width, h: c.height, at: Number(c.dataset.at) || 0, seq: c.dataset.seq || '' };
    }

    draw(ctx, layer, W, H) {
      ctx.clearRect(0, 0, W, H);
      this.setLayer(layer);
      const S = SL();
      if (!S) return;
      const spec = S.settingsOf(layer);
      if (!spec) return;
      const f = this.frame();
      const stale = !f || (Date.now() - f.at > STALE_MS);
      const hold = layer.kind === 'input' ? spec.hold !== false : true;
      /* Yerleşim kutusu (düzen editörü, #534): görüntü varken çizilen
         dikdörtgen, yokken katmanın kutusu (16:9 kabulüyle). */
      if (!f || (stale && !hold)) {
        const b = S.boxRect(spec, W, H, 16, 9);
        this.layoutBounds = norm(b, W, H);
        if (this.opts.placeholder) this._placeholder(ctx, layer, spec, W, H, b);
        return;
      }
      const r = S.boxRect(spec, W, H, f.w, f.h);
      this.layoutBounds = norm(r, W, H);
      if (!(r.dw > 0 && r.dh > 0)) return;
      ctx.save();
      // Ayna ve çevirme görüntünün kendi merkezinde: kutu kenardaysa yerinde kalır
      ctx.translate(r.dx + r.dw / 2, r.dy + r.dh / 2);
      ctx.scale(spec.mirror ? -1 : 1, spec.flip ? -1 : 1);
      ctx.drawImage(f.pic, -r.dw / 2, -r.dh / 2, r.dw, r.dh);
      ctx.restore();
    }

    /* Yalnız panel önizlemesinde: kaynağın neden görünmediği. */
    _placeholder(ctx, layer, spec, W, H, box) {
      const t = (x) => (window.SVI18n && typeof window.SVI18n.t === 'function' ? window.SVI18n.t(x) : x);
      let text;
      if (layer.kind === 'input') {
        text = spec.sender ? t('Gönderici bekleniyor:') + ' ' + spec.sender : t('Gönderici seçilmedi');
      } else {
        text = spec.url ? t('Sayfa yükleniyor…') : t('Adres girilmedi');
      }
      const b = box || { dx: 0, dy: 0, dw: W, dh: H };
      ctx.save();
      ctx.fillStyle = 'rgba(128,128,128,0.18)';
      ctx.fillRect(b.dx, b.dy, b.dw, b.dh);
      ctx.strokeStyle = 'rgba(200,200,200,0.5)';
      ctx.setLineDash([Math.max(4, W / 80), Math.max(4, W / 80)]);
      ctx.lineWidth = Math.max(1, W / 400);
      const m = Math.min(b.dw, b.dh) * 0.02;
      ctx.strokeRect(b.dx + m, b.dy + m, b.dw - 2 * m, b.dh - 2 * m);
      ctx.setLineDash([]);
      ctx.fillStyle = 'rgba(235,235,235,0.9)';
      ctx.font = Math.max(11, Math.round(Math.min(H, b.dh) * 0.045)) + 'px system-ui, sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(text.length > 80 ? text.slice(0, 79) + '…' : text, b.dx + b.dw / 2, b.dy + b.dh / 2);
      ctx.restore();
    }

    // ---- Yayın sayfasına aktarma (kamera aktarmasıyla aynı yol) ----------

    _startRelay(key) {
      const api = window.api;
      if (!api || typeof api.claimCamRelay !== 'function' || typeof api.sendCamFrame !== 'function') return;
      const id = 'src:' + key;
      const tick = () => {
        if (this.key !== key) return;
        api.claimCamRelay(id).then((ok) => {
          if (this.key !== key) {
            if (ok && api.releaseCamRelay) api.releaseCamRelay(id);
            return;
          }
          if (ok && !this._pump) {
            this._relayKey = id;
            this._pump = setInterval(() => this._sendFrame(id), RELAY_MS);
          } else if (!ok && this._pump) {
            clearInterval(this._pump);
            this._pump = null;
            if (this._relayKey != null && api.releaseCamRelay) api.releaseCamRelay(this._relayKey);
            this._relayKey = null;
          }
        }).catch(() => {});
        this._claimTimer = setTimeout(tick, this._pump ? 2000 : 400);
      };
      tick();
    }

    /* Yeni kare geldikçe gönderilir. Durağan bir sayfa yeni kare üretmez:
       son kare saniyede bir yinelenir, sonradan bağlanan yayın sayfası da
       görüntüyü alsın. Kesilmiş bir Spout göndericisi ise yinelenmez. */
    _sendFrame(id) {
      if (this._encoding || !window.api || !window.api.sendCamFrame) return;
      const f = this.frame();
      if (!f) return;
      const t = Date.now();
      const changed = f.seq !== this._sentSeq;
      if (!changed && t - (this._sentAt || 0) < 1000) return;
      if (!changed && this._kind === 'input' && t - f.at > STALE_MS) return;
      this._sentSeq = f.seq;
      this._sentAt = t;
      const scale = Math.min(1, RELAY_MAX_W / f.w);
      const w = Math.max(2, Math.round(f.w * scale));
      const h = Math.max(2, Math.round(f.h * scale));
      if (!this._cap) {
        this._cap = document.createElement('canvas');
        this._capCtx = this._cap.getContext('2d');
      }
      if (this._cap.width !== w || this._cap.height !== h) {
        this._cap.width = w;
        this._cap.height = h;
      }
      this._capCtx.clearRect(0, 0, w, h);
      this._capCtx.drawImage(f.pic, 0, 0, w, h);
      this._encoding = true;
      this._cap.toBlob((blob) => {
        this._encoding = false;
        if (!blob || !this._pump) return;
        blob.arrayBuffer().then((buf) => {
          if (!this._pump || !window.api || !window.api.sendCamFrame) return;
          window.api.sendCamFrame({ key: id, jpeg: new Uint8Array(buf) });
        }).catch(() => {});
      }, 'image/webp', 0.8);
    }

    _stopRelay() {
      if (this._pump) { clearInterval(this._pump); this._pump = null; }
      if (this._claimTimer) { clearTimeout(this._claimTimer); this._claimTimer = null; }
      this._encoding = false;
      if (this._relayKey != null && window.api && typeof window.api.releaseCamRelay === 'function') {
        try { window.api.releaseCamRelay(this._relayKey); } catch { /* pencere kapanıyor */ }
      }
      this._relayKey = null;
    }

    dispose() {
      this._stopRelay();
      this.key = '';
    }
  }

  window.SVSourceLayer = SourceLayer;
})();
