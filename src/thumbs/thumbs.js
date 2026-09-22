'use strict';
/* MILKDROP KÜÇÜK RESİM ÇİZİCİSİ (#575). Gizli pencere; ana süreç iş
   gönderiyor: { key, source, textureDir, textureRev, recipe }.

   AYNI İŞ HER SEFERİNDE AYNI BAYTLAR:
     - Her iş YENİ bir motor örneğinde. `dispose` bağlamı bırakıyor; önceki
       işin geri besleme tamponu, flaş sınırlayıcısı, ses yumuşatması —
       hiçbiri taşınmıyor. Tampon siyahtan başlıyor.
     - `Math.random` işin anahtarından tohumlanıyor (motor her karede
       `rand_frame` için çekiyor); presetin tohumu da anahtardan.
     - Ses örnek ses (`demo-audio.js`), kare indisine bağlı — MilkDrop render
       ölçümünün verdiği sesin aynısı (`scripts/milkdrop-render-rate.js`).
     - Derleme bekleyerek (`SVMilkdropSync`).
     - Doku isteniyorsa istendiği karenin hemen ardından bekleniyor (dışa
       aktarıcıdaki gibi). Süre dolarsa iş BAŞARISIZ: yazılsaydı görüntü o
       anki disk hızına kalırdı.
     - Her kare CANLI bir bağlamda ve presetle çizilmiş olmalı. Bağlam
       alınamazsa motor yedek bir görüntü çiziyor, kaybolursa son kareyi
       bırakıyor; ikisi de içerik anahtarıyla kalıcı olarak saklanırdı —
       bir GPU sıfırlaması yanlış küçük resmi sonsuza dek yerleştirirdi.
       Motorun kare sayacı (`frameNo`) yalnız gerçekten çizilen karede
       artıyor. */
(function () {
  window.SVMilkdropSync = true;
  const bridge = window.thumbs;
  const DEMO = window.SVDemoAudio;
  const canvas = document.getElementById('c');
  const out = document.createElement('canvas');

  function seedRandom(key) {
    let x = (parseInt(String(key || '').slice(0, 8), 16) >>> 0) || 1;
    Math.random = function () {
      x = (x * 1103515245 + 12345) % 2147483648;
      return x / 2147483648;
    };
  }

  /* Ölçümün sesi, kare kare: parça 1. saniyeden başlıyor; bas/orta/tiz ve
     sentetik tayf da ölçümdekiyle aynı ('spectrum = 1' dalgaları okuyor). */
  function audioAt(i, fps) {
    const t = i / fps;
    const beat = Math.pow(Math.max(0, 1 - ((t * 2) % 1) * 2.2), 2);
    const end = Math.floor((1 + t) * DEMO.SR);
    const time = new Uint8Array(2048);
    const timeL = new Uint8Array(2048);
    const timeR = new Uint8Array(2048);
    DEMO.fill(end, time, timeL, timeR);
    const freq = new Float32Array(512);
    for (let q = 0; q < 512; q++) {
      const fu = q / 512;
      freq[q] = Math.max(0, Math.min(1, (1 - fu) * (0.35 + 0.5 * beat) + 0.15 * Math.abs(Math.sin(fu * 22 + t * 2.1))));
    }
    return {
      bass: 0.45 + 0.45 * beat,
      mid: 0.35 + 0.25 * Math.abs(Math.sin(t * 0.7)),
      treble: 0.25 + 0.2 * Math.abs(Math.sin(t * 1.3)),
      timeBytes: time, timeL, timeR, stereo: true, freq,
    };
  }

  function settle(mode, ms) {
    let timer = null;
    const late = new Promise((r) => { timer = setTimeout(() => r(false), ms); });
    return Promise.race([mode.whenTexturesSettled().then(() => true), late]).then((ok) => {
      clearTimeout(timer);
      return ok;
    });
  }

  async function run(job) {
    const R = job.recipe;
    canvas.width = R.renderW;
    canvas.height = R.renderH;
    seedRandom(job.key);
    const mode = new window.SVModes.milkdrop(canvas);
    const cfg = {
      milkdrop: {
        presetId: 'thumb:' + job.key, source: job.source, blendTime: 0,
        textureDir: job.textureDir || '', accurate: true,
      },
      milkdropLibrary: { textureRev: +job.textureRev || 0 },
      visualizer: { sensitivity: 1 },
    };
    try {
      for (let i = 0; i < R.frames; i++) {
        mode.draw(audioAt(i, R.fps), cfg, i / R.fps, 1 / R.fps);
        // Bu karede istenen doku (ya da doku listesi) varsa gelmesi bekleniyor
        while (mode.texturesPending()) {
          if (!(await settle(mode, R.textureWaitMs))) return { ok: false, error: 'TEXTURE_TIMEOUT' };
        }
      }
      const gl = mode.gl;
      if (!gl || (gl.isContextLost && gl.isContextLost()) || mode._lost || mode.recoveries ||
          !mode.preset || mode.frameNo !== R.frames) {
        return { ok: false, error: 'NO_CONTEXT' };
      }
      out.width = R.thumbW;
      out.height = R.thumbH;
      const c = out.getContext('2d');
      c.imageSmoothingEnabled = true;
      c.imageSmoothingQuality = 'high';
      c.drawImage(canvas, 0, 0, R.thumbW, R.thumbH);
      const blob = await new Promise((res) => out.toBlob(res, 'image/webp', R.quality));
      if (!blob) return { ok: false, error: 'ENCODE' };
      return { ok: true, bytes: new Uint8Array(await blob.arrayBuffer()) };
    } finally {
      mode.dispose();
    }
  }

  bridge.onJob((job) => {
    run(job).then((r) => bridge.done(job.key, r), (e) => bridge.done(job.key, { ok: false, error: String((e && e.message) || e) }));
  });
  bridge.ready();
})();
