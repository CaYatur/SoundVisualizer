'use strict';
/* GIF kare zamanlaması — Node'da test edilir, tarayıcıda oynatıcı kullanır.

   Çözme (ImageDecoder) Chromium'a bağlıdır; burada yalnız kare seçimi,
   kaynak tanıma ve kitaplık URL'si durur. */
(function () {
  const DEFAULT_DELAY_MS = 60;

  function isGifSrc(src) {
    if (!src || typeof src !== 'string') return false;
    if (/^data:image\/gif/i.test(src)) return true;
    if (/\.gif(?:$|[?#])/i.test(src)) return true;
    return false;
  }

  function isAnimatedLogo(lg, src) {
    if (lg && lg.kind === 'gif') return true;
    return isGifSrc(src || (lg && lg.src) || '');
  }

  /* Kitaplık kimliğini ortamın okuyabileceği bir URL'ye çevirir.
     Masaüstü: sv-logo://lib/<id>  Yayın: /logo-file?id= */
  function libraryUrl(id) {
    if (!id) return null;
    const http = typeof location !== 'undefined' && /^https?:$/.test(location.protocol);
    if (http) return '/logo-file?id=' + encodeURIComponent(id);
    return 'sv-logo://lib/' + encodeURIComponent(id);
  }

  function logoFileSrc(lg) {
    if (!lg) return null;
    if (typeof window !== 'undefined' && window.SVLogoRuntime && window.SVLogoRuntime.displaySrc) {
      const ready = window.SVLogoRuntime.displaySrc(lg);
      if (ready) return ready;
      if (lg.libraryId) return null;
    }
    if (lg.src) return lg.src;
    if (lg.libraryId) return libraryUrl(lg.libraryId);
    return null;
  }

  /* durations: kare süreleri (ms). loopMode: 'loop' | 'pingpong' | 'once'. */
  function frameIndexAt(durations, ms, loopMode, reverse) {
    const n = durations && durations.length;
    if (!n) return 0;
    let total = 0;
    for (let i = 0; i < n; i++) total += (durations[i] > 0 ? durations[i] : DEFAULT_DELAY_MS);
    if (total <= 0) return 0;
    let t = Number(ms);
    if (!isFinite(t)) t = 0;
    const mode = loopMode || 'loop';
    if (mode === 'once') {
      if (t < 0) t = 0;
      if (t >= total) t = total - 0.0001;
    } else if (mode === 'pingpong' && n > 1) {
      const cycle = total * 2;
      t = ((t % cycle) + cycle) % cycle;
      if (t >= total) t = cycle - t;
    } else {
      t = ((t % total) + total) % total;
    }
    let acc = 0;
    let idx = 0;
    for (let i = 0; i < n; i++) {
      acc += (durations[i] > 0 ? durations[i] : DEFAULT_DELAY_MS);
      if (t < acc) { idx = i; break; }
      idx = i;
    }
    if (reverse) idx = n - 1 - idx;
    return idx;
  }

  const api = {
    DEFAULT_DELAY_MS,
    isGifSrc,
    isAnimatedLogo,
    libraryUrl,
    logoFileSrc,
    frameIndexAt,
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (typeof window !== 'undefined') window.SVGif = api;
})();
