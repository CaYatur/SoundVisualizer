'use strict';
/* Kitaplık görsellerini sv-logo:// yerine blob URL ile gösterir.

   Özel protokol + çoklu pencere aynı anda Image/fetch yapınca Electron ana
   süreci / görselleştirici kilitleniyordu. Kimlik IPC ile bir kez okunur,
   blob URL önbellekte tutulur; ayar dosyasına dataURL yazılmaz. */
(function () {
  const cache = new Map();
  const inflight = new Map();

  function apiRead() {
    if (typeof window !== 'undefined' && window.api && typeof window.api.logoLibRead === 'function') {
      return window.api.logoLibRead.bind(window.api);
    }
    return null;
  }

  function b64ToBlob(b64, mime) {
    const bin = atob(b64);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return new Blob([bytes], { type: mime || 'application/octet-stream' });
  }

  function warm(id) {
    if (!id) return null;
    if (cache.has(id)) return cache.get(id);
    const read = apiRead();
    if (!read) return null;
    if (!inflight.has(id)) {
      const p = Promise.resolve()
        .then(() => read(id))
        .then((rec) => {
          inflight.delete(id);
          if (!rec || !rec.b64) return null;
          const url = URL.createObjectURL(b64ToBlob(rec.b64, rec.mime));
          const prev = cache.get(id);
          if (prev && prev !== url) {
            try { URL.revokeObjectURL(prev); } catch (e) { /* yok */ }
          }
          cache.set(id, url);
          return url;
        })
        .catch(() => {
          inflight.delete(id);
          return null;
        });
      inflight.set(id, p);
    }
    return cache.get(id) || null;
  }

  function urlFor(id) {
    return warm(id);
  }

  function displaySrc(lg) {
    if (!lg) return null;
    if (lg.src) return lg.src;
    if (lg.libraryId) {
      const ready = warm(lg.libraryId);
      if (ready) return ready;
      if (apiRead()) return null;
      if (typeof window !== 'undefined' && window.SVGif && window.SVGif.libraryUrl) {
        return window.SVGif.libraryUrl(lg.libraryId);
      }
      return null;
    }
    return null;
  }

  function isPending(id) {
    return !!(id && !cache.has(id) && inflight.has(id));
  }

  const api = { warm, urlFor, displaySrc, isPending, cache };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (typeof window !== 'undefined') window.SVLogoRuntime = api;
})();
