'use strict';
/* Pioneer / .lkd görsel modu.

   Klasik Pioneer araç ses sistemi animasyonlarını (yunuslar vb.) sahneye
   getirir. İki içerik türü:
     - .lkd : SVLkd ile çözülür (kareler ham RGBA); her kare bir ImageBitmap'e
              çevrilip ÖNBELLEĞE alınır.
     - .gif : Chromium'un yerleşik ImageDecoder'ı ile çözülür (kareler +
              süreler); yine ImageBitmap olarak önbelleğe alınır.

   Çözme PAHALI ve YALNIZCA klip değişince yapılır. Çözülen kareler modül
   düzeyinde bir önbellekte tutulur; böylece aynı klip birden çok pencerede
   (çoklu ekran) ya da katman yığınında tekrar tekrar çözülmez.

   Oynatma DETERMİNİSTİK: kare, gösteri saati zamanından (t) seçilir, yani
   tüm ekranlar aynı kareyi gösterir. Ses tepkiselliği yalnızca GÖRÜNÜMÜ
   etkiler (parlaklık, ölçek, saydamlık, ritim parlaması) — orijinal
   animasyonun akışını bozmaz. İsteğe bağlı ses-hızı açıldığında faz dt ile
   birikir (o zaman oynatma hafifçe pencereye özel olur). */
(function () {
  const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);

  /* id -> { status:'loading'|'ready'|'error', frames:[ImageBitmap],
            durations:[ms], totalMs, width, height, error, promise } */
  const CACHE = new Map();

  function b64ToBytes(b64) {
    const bin = atob(b64);
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  }

  async function decodeGif(bytes) {
    if (typeof ImageDecoder === 'undefined') throw new Error('ImageDecoder unavailable');
    const dec = new ImageDecoder({ data: bytes, type: 'image/gif' });
    await dec.tracks.ready;
    const track = dec.tracks.selectedTrack;
    let count = (track && track.frameCount) || 1;
    const frames = [];
    const durations = [];
    let width = 0, height = 0;
    for (let i = 0; i < count; i++) {
      const res = await dec.decode({ frameIndex: i });
      const vf = res.image;
      width = vf.displayWidth || vf.codedWidth;
      height = vf.displayHeight || vf.codedHeight;
      const bmp = await createImageBitmap(vf);
      const durUs = vf.duration; // mikrosaniye ya da null
      vf.close();
      frames.push(bmp);
      durations.push(durUs != null ? Math.max(20, durUs / 1000) : 60);
    }
    try { dec.close(); } catch { /* yok say */ }
    return { frames, durations, width, height };
  }

  async function decodeLkd(bytes) {
    if (!window.SVLkd) throw new Error('SVLkd not loaded');
    const anim = await window.SVLkd.decode(bytes);
    const frames = [];
    const durations = [];
    for (let i = 0; i < anim.frames.length; i++) {
      const fr = anim.frames[i];
      const imgData = new ImageData(fr.rgba, fr.width, fr.height);
      const bmp = await createImageBitmap(imgData);
      frames.push(bmp);
      durations.push(anim.delayMs);
    }
    return { frames, durations, width: anim.width, height: anim.frameHeight };
  }

  function loadClip(id) {
    if (!id) return null;
    let entry = CACHE.get(id);
    if (entry) return entry;
    entry = { status: 'loading', frames: null, durations: null, totalMs: 0, width: 0, height: 0, error: null };
    CACHE.set(id, entry);
    entry.promise = (async () => {
      if (!window.api || !window.api.lkdRead) throw new Error('lkd API unavailable');
      const rec = await window.api.lkdRead(id);
      if (!rec || !rec.b64) throw new Error('clip not found: ' + id);
      const bytes = b64ToBytes(rec.b64);
      const dec = rec.kind === 'lkd' ? await decodeLkd(bytes) : await decodeGif(bytes);
      if (!dec.frames.length) throw new Error('clip has no frames');
      entry.frames = dec.frames;
      entry.durations = dec.durations;
      entry.width = dec.width;
      entry.height = dec.height;
      entry.totalMs = dec.durations.reduce((a, b) => a + b, 0) || (dec.frames.length * 60);
      entry.status = 'ready';
    })().catch((e) => {
      entry.status = 'error';
      entry.error = e && e.message ? e.message : String(e);
      // Bozuk klip önbelleği kilitlemesin: bir sonraki denemede yeniden yükle
      setTimeout(() => { if (CACHE.get(id) === entry && entry.status === 'error') CACHE.delete(id); }, 4000);
    });
    return entry;
  }

  // Kare seçimi SVLkd'deki saf yardımcıyla yapılır (Node'da test edilir).
  function frameAt(entry, ms) {
    return window.SVLkd ? window.SVLkd.frameIndexAt(entry.durations, ms) : 0;
  }

  class PioneerMode {
    constructor(canvas) {
      this.canvas = canvas;
      this.ctx = canvas.getContext('2d');
      this.entry = null;
      this.clipId = '';
      this.phaseMs = 0;
      this.errorLogged = '';
    }

    resize() {}

    _pcfg(cfg) {
      const v = (cfg && cfg.visualizer) || {};
      return v.pioneer || {};
    }

    draw(audio, cfg, t, dt) {
      const ctx = this.ctx;
      const W = this.canvas.width;
      const H = this.canvas.height;
      const p = this._pcfg(cfg);
      const id = p.clip || 'builtin:alt_diverdolphins_glow.gif';

      if (id !== this.clipId) {
        this.clipId = id;
        this.entry = loadClip(id);
        this.phaseMs = 0;
      }
      const entry = this.entry;

      ctx.clearRect(0, 0, W, H);
      if (!entry || entry.status !== 'ready') return; // yükleniyor / hata: boş kare

      const level = audio ? audio.level : 0;
      const bass = audio ? audio.bass : 0;

      // Zaman: varsayılan deterministik (t). Ses-hızı açıksa faz dt ile birikir.
      const baseSpeed = p.speed > 0 ? p.speed : 1;
      let ms;
      if (p.audioSpeed > 0) {
        const mul = baseSpeed * (1 + clamp01(p.audioSpeed) * bass * 1.5);
        this.phaseMs += (dt || 0) * 1000 * mul;
        ms = this.phaseMs;
      } else {
        ms = t * 1000 * baseSpeed;
      }
      const idx = frameAt(entry, ms);
      const bmp = entry.frames[idx];
      if (!bmp) return;

      // Yerleşim: en-boy oranını koru (contain/cover/stretch) + ölçek
      const iw = entry.width || bmp.width;
      const ih = entry.height || bmp.height;
      let scale = (p.scale > 0 ? p.scale : 1) * (1 + clamp01(p.audioScale || 0) * bass);
      const fit = p.fit || 'contain';
      let sw, sh;
      if (fit === 'stretch') { sw = W; sh = H; }
      else {
        const rimg = iw / ih, rcanvas = W / H;
        const cover = fit === 'cover';
        if ((rimg > rcanvas) === !cover) { sw = W; sh = W / rimg; }
        else { sh = H; sw = H * rimg; }
      }
      sw *= scale; sh *= scale;
      const dx = (W - sw) / 2, dy = (H - sh) / 2;

      // Ses tepkiselliği yalnızca görünümde: parlaklık + ritim parlaması + saydamlık
      let alpha = p.opacity == null ? 1 : clamp01(p.opacity);
      if (p.audioOpacity > 0) alpha *= (1 - p.audioOpacity) + p.audioOpacity * clamp01(level * 1.5);
      const bright = (p.brightness > 0 ? p.brightness : 1)
        + clamp01(p.audioBrightness || 0) * bass * 0.8
        + clamp01(p.beatFlash || 0) * Math.max(0, bass - 0.6) * 2;

      ctx.save();
      ctx.globalAlpha = clamp01(alpha);
      ctx.globalCompositeOperation = p.blend === 'add' ? 'lighter' : p.blend === 'screen' ? 'screen' : 'source-over';
      // Pioneer OEL görünümü keskin pikseldir; yumuşatmayı isteğe bağlı bırak
      ctx.imageSmoothingEnabled = p.smooth === true;
      const filters = [];
      if (bright !== 1) filters.push('brightness(' + bright.toFixed(3) + ')');
      if (p.hue) filters.push('hue-rotate(' + Math.round(p.hue * 360) + 'deg)');
      if (p.saturate != null && p.saturate !== 1) filters.push('saturate(' + p.saturate + ')');
      if (filters.length) ctx.filter = filters.join(' ');
      ctx.drawImage(bmp, dx, dy, sw, sh);
      ctx.restore();
    }

    dispose() {
      // Kareler ÖNBELLEKTE paylaşımlı; burada kapatmıyoruz (başka pencere
      // kullanıyor olabilir). Yalnızca yerel başvuruyu bırak.
      this.entry = null;
      this.clipId = '';
    }
  }

  // Test / bakım için önbelleği boşaltma (kareleri serbest bırakır).
  PioneerMode.clearCache = function () {
    CACHE.forEach((e) => { if (e.frames) e.frames.forEach((b) => { try { b.close(); } catch { /* yok */ } }); });
    CACHE.clear();
  };

  // Kare tabanlı: ses olmadan da oynar (bkz. layers.js çizim geçidi).
  PioneerMode.usesAudio = false;

  window.SVModes = window.SVModes || {};
  window.SVModes.pioneer = PioneerMode;
})();
