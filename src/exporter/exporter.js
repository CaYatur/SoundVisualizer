'use strict';
/*
 * Offline (deterministik) video render motoru.
 * Ekran/ses KAYDI YAPMAZ: seçilen ses dosyasını çözer, her video karesi için
 * FFT'yi birebir hesaplar (loopback-helper.js ile aynı ölçek) ve görselleştiriciyle
 * AYNI efektleri (WebGL gradyan + 2D ön katman + logo) kare kare çizer.
 * Ham RGBA kareler ana sürece akıtılır; ffmpeg orada kayıpsız videoya kodlar.
 */
(function () {
  // ---- loopback-helper.js ile birebir aynı sabitler/ölçek ----
  const FFT_SIZE = 2048;
  const BINS = FFT_SIZE / 2; // 1024
  const MIN_DB = -90;
  const MAX_DB = -18;

  const hann = new Float32Array(FFT_SIZE);
  for (let i = 0; i < FFT_SIZE; i++) {
    hann[i] = 0.5 * (1 - Math.cos((2 * Math.PI * i) / (FFT_SIZE - 1)));
  }
  const re = new Float32Array(FFT_SIZE);
  const im = new Float32Array(FFT_SIZE);

  // loopback-helper.js'teki radix-2 FFT (birebir)
  function fft() {
    const n = FFT_SIZE;
    for (let i = 1, j = 0; i < n; i++) {
      let bit = n >> 1;
      for (; j & bit; bit >>= 1) j ^= bit;
      j ^= bit;
      if (i < j) {
        const tr = re[i]; re[i] = re[j]; re[j] = tr;
        const ti = im[i]; im[i] = im[j]; im[j] = ti;
      }
    }
    for (let len = 2; len <= n; len <<= 1) {
      const ang = (-2 * Math.PI) / len;
      const wr = Math.cos(ang), wi = Math.sin(ang);
      const half = len >> 1;
      for (let i = 0; i < n; i += len) {
        let cr = 1, ci = 0;
        for (let k = 0; k < half; k++) {
          const a = i + k, b = a + half;
          const vr = re[b] * cr - im[b] * ci;
          const vi = re[b] * ci + im[b] * cr;
          re[b] = re[a] - vr; im[b] = im[a] - vi;
          re[a] += vr; im[a] += vi;
          const ncr = cr * wr - ci * wi;
          ci = cr * wi + ci * wr;
          cr = ncr;
        }
      }
    }
  }

  // ---- Durum ----
  const glCanvas = document.getElementById('gl');
  const c2d = document.getElementById('c2d');
  const comp = document.getElementById('comp');
  // Her karede getImageData ile geri okuma yapıldığı için willReadFrequently açık.
  const compCtx = comp.getContext('2d', { willReadFrequently: true });

  const audio = new window.SVAudio();
  let cfg = null;
  let gradient = null;
  let foreground = null;
  let sprites = null;
  let logo = null;

  let pcm = null;
  let totalSamples = 0;
  let sampleRate = 48000;
  let width = 1920;
  let height = 1080;
  let fps = 60;
  let totalFrames = 1;

  const ring = new Float32Array(FFT_SIZE);
  const freqBytes = new Uint8Array(BINS);
  const timeBytes = new Uint8Array(FFT_SIZE);

  function clamp(v, a, b) { return Math.max(a, Math.min(b, v)); }

  // Belirli bir örnek konumunda (sampleEnd ile biten 2048 örneklik pencere) analiz et.
  // Çıktı: freqBytes (0..255, dB ölçekli) + timeBytes (128 merkez) — loopback ile aynı.
  function analyzeAt(sampleEnd) {
    const start = sampleEnd - FFT_SIZE;
    for (let i = 0; i < FFT_SIZE; i++) {
      const idx = start + i;
      ring[i] = idx >= 0 && idx < totalSamples ? pcm[idx] : 0;
    }
    for (let i = 0; i < FFT_SIZE; i++) {
      re[i] = ring[i] * hann[i];
      im[i] = 0;
    }
    fft();
    const range = MAX_DB - MIN_DB;
    for (let i = 0; i < BINS; i++) {
      const mag = Math.sqrt(re[i] * re[i] + im[i] * im[i]) / (FFT_SIZE / 4);
      let db = 20 * Math.log10(mag + 1e-9);
      let v = (db - MIN_DB) / range;
      v = v < 0 ? 0 : v > 1 ? 1 : v;
      freqBytes[i] = (v * 255) | 0;
    }
    for (let i = 0; i < FFT_SIZE; i++) {
      let s = ring[i];
      s = s < -1 ? -1 : s > 1 ? 1 : s;
      timeBytes[i] = (128 + s * 127) | 0;
    }
  }

  // Ses dosyasını PCM'e çöz (kayıpsız çözümleme). 48000 Hz sabit — canlı boru hattıyla
  // aynı binHz (48000/2048) için. Kanallar mono'ya indirgenir (loopback ile aynı).
  async function decodeAudio(arrayBuffer) {
    const Ctx = window.AudioContext || window.webkitAudioContext;
    const ac = new Ctx({ sampleRate: 48000 });
    const buf = await ac.decodeAudioData(arrayBuffer);
    try { ac.close(); } catch (e) {}
    sampleRate = buf.sampleRate;
    const n = buf.length;
    const ch = buf.numberOfChannels;
    pcm = new Float32Array(n);
    if (ch <= 1) {
      pcm.set(buf.getChannelData(0));
    } else {
      const a = buf.getChannelData(0);
      const b = buf.getChannelData(1);
      for (let i = 0; i < n; i++) pcm[i] = (a[i] + b[i]) * 0.5;
    }
    totalSamples = n;
    return buf.duration;
  }

  function loadLogo(src) {
    return new Promise((resolve) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = () => resolve(null);
      img.src = src;
    });
  }

  async function setup(job) {
    cfg = window.SV.deepMerge(window.SV.defaultConfig(), job.cfg || {});
    width = job.width;
    height = job.height;
    fps = job.fps;

    glCanvas.width = width;
    glCanvas.height = height;
    c2d.width = width;
    c2d.height = height;
    comp.width = width;
    comp.height = height;

    // Arkaplan (gradyan WebGL). Dışa aktarımda tam çözünürlük (renderScale yok sayılır).
    if (cfg.background.type === 'gradient') {
      gradient = new window.SVModes.gradient(glCanvas);
      gradient.resize(width, height);
    }

    // Ön görselleştirici
    const type = cfg.visualizer.type;
    if (type && type !== 'none' && window.SVModes[type]) {
      foreground = new window.SVModes[type](c2d);
      if (foreground.resize) foreground.resize();
    }

    // Ek görsel nesneler / partiküller (resimler kare 0'dan önce yüklenir)
    if (cfg.images && cfg.images.enabled && Array.isArray(cfg.images.items) && cfg.images.items.length) {
      sprites = new window.SVSprites();
      sprites.setItems(cfg.images.items);
      await sprites.whenReady();
    }

    audio.applyConfig(cfg.audio);

    if (cfg.logo.enabled && cfg.logo.src) {
      logo = await loadLogo(cfg.logo.src);
    }
  }

  function drawLogo() {
    if (!logo || !cfg.logo.enabled) return;
    const l = cfg.logo;
    const minDim = Math.min(width, height);
    const size = minDim * clamp(l.scale, 0.03, 0.9);
    const pulse = 1 + audio.bass * l.pulse;
    const w = size * pulse;
    const ratio = logo.naturalHeight && logo.naturalWidth ? logo.naturalHeight / logo.naturalWidth : 1;
    const h = w * ratio;
    const cx = l.x * width;
    const cy = l.y * height;
    compCtx.save();
    compCtx.globalAlpha = clamp(l.opacity, 0, 1);
    if (l.glow > 0) {
      compCtx.shadowColor = 'rgba(255,255,255,0.6)';
      compCtx.shadowBlur = l.glow * 40 * (minDim / 1080);
    }
    compCtx.drawImage(logo, cx - w / 2, cy - h / 2, w, h);
    compCtx.restore();
  }

  // Tek kareyi çiz ve birleştirme yüzeyinin RGBA baytlarını döndür.
  function renderFrame(i) {
    const t = i / fps;
    const dt = 1 / fps;
    const sampleEnd = Math.round(t * sampleRate);

    analyzeAt(sampleEnd);
    audio.ingestFrame({ freq: freqBytes, time: timeBytes, sampleRate });
    audio.update();

    // Arkaplan
    if (cfg.background.type === 'gradient' && gradient) {
      gradient.draw(audio, cfg, t);
      compCtx.drawImage(glCanvas, 0, 0, width, height);
    } else {
      compCtx.fillStyle = cfg.background.solidColor;
      compCtx.fillRect(0, 0, width, height);
    }

    // Ek görsel nesneler — arka katman (görselin arkasında)
    if (sprites && sprites.hasLayer('back')) sprites.draw(compCtx, audio, t, width, height, 'back');

    // Ön görselleştirici (kendi kanvasını temizleyip çizer)
    if (foreground) {
      foreground.draw(audio, cfg, t, dt);
      compCtx.drawImage(c2d, 0, 0, width, height);
    }

    // Ek görsel nesneler — ön katman (görselin önünde)
    if (sprites && sprites.hasLayer('front')) sprites.draw(compCtx, audio, t, width, height, 'front');

    // Logo
    drawLogo();

    return compCtx.getImageData(0, 0, width, height).data; // Uint8ClampedArray RGBA
  }

  async function run(job) {
    const duration = await decodeAudio(job.audioBuffer);
    await setup(job);
    totalFrames = Math.max(1, Math.ceil(duration * fps));
    window.exp.ready(totalFrames);

    // Boru hattı (pipeline): render, IPC ve ffmpeg kodlaması ÜST ÜSTE çalışsın.
    // Karelerin tek tek beklenmesi yerine WINDOW kadar kareyi "uçuşta" tutarız;
    // böylece render ederken ffmpeg de önceki kareleri kodlar. Bu, GPU'da
    // dışa aktarımı belirgin biçimde hızlandırır (darboğaz = max(render, encode)).
    // WINDOW, bellek için kare boyutuna göre sınırlanır (~64 MB tampon).
    const frameBytes = width * height * 4;
    const WINDOW = Math.max(3, Math.min(12, Math.round((64 * 1024 * 1024) / frameBytes)));

    const progStep = Math.max(1, Math.round(fps / 4));
    let cancelled = false;
    const pending = [];

    for (let i = 0; i < totalFrames && !cancelled; i++) {
      const data = renderFrame(i);
      // Geri basınç: ana süreç kareyi ffmpeg.stdin'e yazana kadar bekler; ama
      // hemen await etmeyip pencereyi dolduruyoruz (render/encode örtüşmesi).
      const p = window.exp.sendFrame(data, i).then((res) => {
        if (res && res.cancel) cancelled = true;
      });
      pending.push(p);
      if (pending.length >= WINDOW) await pending.shift();
      if (i % progStep === 0) window.exp.progress(i + 1, totalFrames);
    }

    await Promise.all(pending);
    if (cancelled) {
      window.exp.cancelled();
      return;
    }
    window.exp.progress(totalFrames, totalFrames);
    window.exp.finish();
  }

  window.exp.onJob((job) => {
    let ab = job.audioBuffer;
    // Node Buffer/Uint8Array geldiyse ArrayBuffer'a normalize et
    if (ab && ab.buffer && ab.byteLength != null && !(ab instanceof ArrayBuffer)) {
      ab = ab.buffer.slice(ab.byteOffset, ab.byteOffset + ab.byteLength);
    }
    job.audioBuffer = ab;
    run(job).catch((e) => window.exp.error(String((e && e.stack) || e)));
  });
})();
