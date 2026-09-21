'use strict';
/* GIF kare çözücü. Chromium ImageDecoder kullanır (yeni bağımlılık yok).

   Çözme pahalıdır ve yalnız kaynak değişince yapılır. Kareler pencere
   paylaşımlı önbellekte durur; çoklu ekran aynı GIF'i yeniden çözmez. */
(function () {
  const CACHE = new Map();

  function isGifSrc(src) {
    return window.SVGif ? window.SVGif.isGifSrc(src) : false;
  }

  function b64ToBytes(b64) {
    const bin = atob(b64);
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  }

  async function srcToBytes(src) {
    if (/^data:/i.test(src)) {
      const m = /^data:[^;]+;base64,(.+)$/i.exec(src);
      if (!m) throw new Error('bad data url');
      return b64ToBytes(m[1]);
    }
    const res = await fetch(src);
    if (!res.ok) throw new Error('fetch ' + res.status);
    return new Uint8Array(await res.arrayBuffer());
  }

  async function decodeGif(bytes, onPartial) {
    if (typeof ImageDecoder === 'undefined') throw new Error('ImageDecoder unavailable');
    const dec = new ImageDecoder({ data: bytes, type: 'image/gif' });
    await dec.tracks.ready;
    const track = dec.tracks.selectedTrack;
    const count = (track && track.frameCount) || 1;
    const frames = [];
    const durations = [];
    let width = 0;
    let height = 0;
    for (let i = 0; i < count; i++) {
      const res = await dec.decode({ frameIndex: i });
      const vf = res.image;
      width = vf.displayWidth || vf.codedWidth;
      height = vf.displayHeight || vf.codedHeight;
      const bmp = await createImageBitmap(vf);
      const durUs = vf.duration;
      vf.close();
      frames.push(bmp);
      durations.push(durUs != null ? Math.max(20, durUs / 1000) : (window.SVGif ? window.SVGif.DEFAULT_DELAY_MS : 60));
      if (onPartial) onPartial({ frames, durations, width, height });
      if (i % 3 === 2) await new Promise((r) => setTimeout(r, 0));
    }
    try { dec.close(); } catch { /* yok */ }
    return { frames, durations, width, height };
  }

  function load(src) {
    if (!src) return null;
    let entry = CACHE.get(src);
    if (entry) return entry;
    entry = { status: 'loading', frames: null, durations: null, width: 0, height: 0, error: null };
    CACHE.set(src, entry);
    entry.promise = (async () => {
      const bytes = await srcToBytes(src);
      const dec = await decodeGif(bytes, (partial) => {
        entry.frames = partial.frames;
        entry.durations = partial.durations;
        entry.width = partial.width;
        entry.height = partial.height;
        if (entry.status === 'loading') entry.status = 'ready';
      });
      if (!dec.frames.length) throw new Error('no frames');
      entry.frames = dec.frames;
      entry.durations = dec.durations;
      entry.width = dec.width;
      entry.height = dec.height;
      entry.status = 'ready';
    })().catch((e) => {
      entry.status = 'error';
      entry.error = e && e.message ? e.message : String(e);
      setTimeout(() => {
        if (CACHE.get(src) === entry && entry.status === 'error') CACHE.delete(src);
      }, 4000);
    });
    return entry;
  }

  function get(src) {
    if (!src) return null;
    return CACHE.get(src) || load(src);
  }

  function frameAt(entry, ms, loopMode, reverse) {
    if (!entry || !entry.durations || !window.SVGif) return 0;
    return window.SVGif.frameIndexAt(entry.durations, ms, loopMode, reverse);
  }

  function clear() {
    CACHE.forEach((e) => {
      if (e.frames) e.frames.forEach((b) => { try { b.close(); } catch { /* yok */ } });
    });
    CACHE.clear();
  }

  window.SVGifPlayer = { isGifSrc, load, get, frameAt, clear };
})();
