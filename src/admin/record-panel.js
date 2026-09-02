'use strict';
/* Kayıt paneli.

   Kayıt, paneldeki CANLI ÖNİZLEMEDEN alınır. Görselleştirici penceresinden
   almak daha doğru görünürdü ama o pencere ayrı bir işlem; oradaki tuvalin
   akışını buraya taşımanın ucuz bir yolu yok. Önizleme aynı katman yığınını,
   aynı modülasyonu, aynı efekt zincirini ve aynı geçişleri çalıştırıyor —
   yani kaydedilen görüntü ekrandakiyle aynı sahnedir, yalnızca çözünürlüğü
   önizleme yüzeyinin çözünürlüğüdür.

   Kayıt sırasında önizleme tek yüzeye iner: MediaRecorder bir tuvalin akışını
   alır, katman katman CSS kompozitini yakalayamaz. */
(function () {
  const P = () => window.SVPanel;
  const SP = () => window.SVScenePanels;

  let rec = null;
  let timer = 0;
  let status = '';
  let busy = false;

  const FORMAT_LABELS = [['mp4', 'MP4 (H.264)'], ['webm', 'WebM'], ['gif', 'GIF']];

  const RES_LABELS = [
    ['1920x1080', '1920 × 1080 (Full HD)'],
    ['1280x720', '1280 × 720 (HD)'],
    ['2560x1440', '2560 × 1440 (2K)'],
    ['3840x2160', '3840 × 2160 (4K)'],
    ['1080x1920', '1080 × 1920 (Dikey)'],
    ['1080x1080', '1080 × 1080 (Kare)'],
    ['0x0', 'Önizleme boyutu'],
  ];

  /* Yakalama tuvali.

     Kayıt ve anlık görüntü doğrudan önizleme yüzeyinden alınıyordu. İki
     sorun çıkarıyordu: önizleme panelle birlikte yeniden boyutlanınca
     yakalanan tuvalin boyutu değişiyor ve captureStream akışı kesiliyor
     (kayıt kare göremeden bitiyor), ayrıca çıktı önizleme kadar küçük
     kalıyordu. Sahne artık sabit boyutlu ayrı bir tuvale kopyalanıyor:
     boyut kayıt boyunca hiç değişmez ve çözünürlük kullanıcının seçtiği
     değerdir. En-boy oranı korunur; artan yer siyah kalır. */
  let capCanvas = null;
  let capCtx = null;
  let pumpRaf = 0;

  function capSize(r, src) {
    const w = Math.round(r.captureWidth == null ? 1920 : r.captureWidth);
    const h = Math.round(r.captureHeight == null ? 1080 : r.captureHeight);
    if (w > 0 && h > 0) return { w, h };
    return { w: Math.max(2, src.width), h: Math.max(2, src.height) };
  }

  function ensureCapture(src, r) {
    const { w, h } = capSize(r, src);
    if (!capCanvas) {
      capCanvas = document.createElement('canvas');
      capCtx = capCanvas.getContext('2d');
    }
    // Boyut YALNIZCA kayıt dışındayken değişir; akış sürerken asla
    if (capCanvas.width !== w || capCanvas.height !== h) {
      capCanvas.width = w;
      capCanvas.height = h;
    }
    return capCanvas;
  }

  // Kaynağı en-boy oranını bozmadan yakalama tuvaline bas
  function blit(src) {
    if (!capCtx || !src || !src.width || !src.height) return;
    const W = capCanvas.width;
    const H = capCanvas.height;
    const k = Math.min(W / src.width, H / src.height);
    const w = src.width * k;
    const h = src.height * k;
    capCtx.fillStyle = '#000';
    capCtx.fillRect(0, 0, W, H);
    try { capCtx.drawImage(src, (W - w) / 2, (H - h) / 2, w, h); } catch { /* yüzey henüz hazır değil */ }
  }

  function startPump(src) {
    stopPump();
    const step = () => {
      const prev = window.SVPreview;
      const stack = prev && prev.stack && prev.stack();
      blit((stack && stack.surface()) || src);
      pumpRaf = requestAnimationFrame(step);
    };
    step();
  }

  function stopPump() {
    if (pumpRaf) cancelAnimationFrame(pumpRaf);
    pumpRaf = 0;
  }

  function engine() {
    if (!rec && window.SVRecorder) rec = new window.SVRecorder.Recorder();
    return rec;
  }

  /* Kaydedilecek tuval: önizlemenin görünür tek yüzeyi.

     Yüzeyi ÇİZİLMİŞ olarak beklemek şart. setForceSingle(true) yalnızca
     niyeti bildirir; birleştirme tuvali ancak bir sonraki çizim karesinde
     dolar. Hemen yakalamaya başlanınca MediaRecorder hiç kare göremiyor,
     ffmpeg de "streams received no packets" diyip boş dosya bırakıyordu.
     stack.surface() tam olarak ilk tek-yüzey çiziminde dolduğu için
     beklenecek koşul odur. */
  function awaitSurface() {
    const prev = window.SVPreview;
    const stack = prev && prev.stack && prev.stack();
    if (!stack) return Promise.resolve(null);
    // Duraklatılmış önizleme hiç çizmez; kayıt için sürdürülür
    if (prev.isPaused && prev.isPaused() && prev.setPaused) prev.setPaused(false);
    stack.setForceSingle(true);
    stack._ensureComp();
    const deadline = performance.now() + 1500;
    return new Promise((resolve) => {
      const look = () => {
        const cv = stack.surface();
        if (cv && cv.width > 0 && cv.height > 0) { resolve(cv); return; }
        if (performance.now() > deadline) { resolve(null); return; }
        requestAnimationFrame(look);
      };
      requestAnimationFrame(look);
    });
  }

  function release() {
    const prev = window.SVPreview;
    const stack = prev && prev.stack && prev.stack();
    if (stack) stack.setForceSingle(false);
  }

  function panel() {
    const el = P().el;
    const cfg = P().cfg();
    const r = cfg.recording || (cfg.recording = window.SV.defaultConfig().recording);
    const R = engine();
    const nodes = [];

    const recording = !!(R && R.recording);
    if (!recording) {
      busy = false;
    }
    const timeLbl = el('span', { class: 'rec-time', text: recording ? fmt(R.elapsed) : '00:00' });

    nodes.push(el('div', { class: 'row rec-row' }, [
      el('button', {
        class: 'btn ' + (recording ? 'danger' : 'primary'),
        type: 'button',
        text: busy ? 'Kaydediliyor…' : (recording ? '■ Durdur' : '● Kayda Başla'),
        disabled: busy && !recording,
        onclick: () => (recording ? stop() : start(cfg)),
      }),
      el('button', {
        class: 'btn ghost', type: 'button', text: '📷 Anlık Görüntü',
        disabled: busy || recording,
        onclick: () => snap(cfg),
      }),
      timeLbl,
    ]));

    if (recording) {
      // Süre göstergesi kendi kendine tazelenir; panel yeniden çizilmez
      if (timer) clearInterval(timer);
      timer = setInterval(() => {
        if (!timeLbl.isConnected) { clearInterval(timer); timer = 0; return; }
        if (!R.recording) { clearInterval(timer); timer = 0; P().rerender(); return; }
        R.tick();
        timeLbl.textContent = fmt(R.elapsed);
      }, 200);
    }

    if (status) nodes.push(el('div', { class: 'studio-note rec-status', text: status }));

    nodes.push(SP().miniSelect('Biçim', FORMAT_LABELS, () => r.format || 'mp4', (v) => { r.format = v; }, () => P().apply()));
    nodes.push(SP().miniSelect('Çözünürlük', RES_LABELS,
      () => (r.captureWidth == null ? 1920 : r.captureWidth) + 'x' + (r.captureHeight == null ? 1080 : r.captureHeight),
      (v) => {
        const p = String(v).split('x');
        r.captureWidth = Number(p[0]) || 0;
        r.captureHeight = Number(p[1]) || 0;
      }, () => P().apply()));
    nodes.push(SP().miniSlider('Kare Hızı', () => r.fps || 60, (v) => { r.fps = Math.round(v); }, {
      min: 15, max: 120, step: 1, fmt: (v) => Math.round(v) + ' fps',
    }));
    nodes.push(SP().miniSlider('Süre Sınırı', () => r.limit || 0, (v) => { r.limit = Math.round(v); }, {
      min: 0, max: 300, step: 5, fmt: (v) => (v > 0 ? Math.round(v) + ' sn' : 'sınırsız'),
    }));

    if ((r.format || 'mp4') !== 'gif') {
      nodes.push(SP().miniSlider('Bit Hızı', () => (r.bitrate || 16000000) / 1e6, (v) => { r.bitrate = Math.round(v * 1e6); }, {
        min: 2, max: 60, step: 1, fmt: (v) => Math.round(v) + ' Mbps',
      }));
    } else {
      nodes.push(SP().miniSlider('GIF Kare Hızı', () => r.gifFps || 15, (v) => { r.gifFps = Math.round(v); }, {
        min: 5, max: 30, step: 1, fmt: (v) => Math.round(v) + ' fps',
      }));
      nodes.push(SP().miniSlider('GIF Genişliği', () => r.gifWidth || 640, (v) => { r.gifWidth = Math.round(v); }, {
        min: 160, max: 1280, step: 20, fmt: (v) => Math.round(v) + ' px',
      }));
      nodes.push(el('div', { class: 'studio-note dim-hint', text: 'GIF iki geçişte üretilir: önce sahneye özel renk paleti çıkarılır, sonra o paletle kodlanır. Tek geçişte sonuç gözle görülür biçimde bantlanır.' }));
    }

    nodes.push(SP().miniSlider('Anlık Görüntü Ölçeği', () => r.snapshotScale || 1, (v) => { r.snapshotScale = v; }, {
      min: 1, max: 4, step: 0.5, fmt: (v) => (+v).toFixed(1) + '×',
    }));

    nodes.push(el('div', {
      class: 'studio-note dim-hint',
      text: 'Kayıt paneldeki canlı önizlemeden alınır ve o anki sesle birlikte ekranda göründüğü gibi kaydedilir — modülasyon, geçişler, efektler dahil. Sahne seçilen çözünürlükte sabit bir tuvale basılır, en-boy oranı korunur. Kaynak önizleme olduğu için büyütmek ayrıntı eklemez; bir ses dosyasının tamamını gerçek yüksek çözünürlükte işlemek için Video Dışa Aktarma kartını kullanın.',
    }));

    return el('div', { class: 'rec-panel' }, nodes);
  }

  function fmt(sec) {
    const s = Math.floor(sec || 0);
    return String(Math.floor(s / 60)).padStart(2, '0') + ':' + String(s % 60).padStart(2, '0');
  }

  async function start(cfg) {
    const R = engine();
    if (!R) { status = 'Kayıt motoru yok.'; P().rerender(); return; }
    status = 'Yüzey hazırlanıyor…';
    P().rerender();
    const src = await awaitSurface();
    if (!src) { status = 'Önizleme yüzeyi hazır değil; bir an sonra yeniden deneyin.'; P().rerender(); return; }
    const r = cfg.recording || {};
    // Sabit boyutlu tuvale kopyala ve AKIŞI ondan al
    const cv = ensureCapture(src, r);
    startPump(src);
    const res = R.start(cv, {
      fps: r.fps,
      bitrate: r.bitrate,
      limit: r.limit,
      onStop: (blob) => finish(blob, cfg),
    });
    if (!res.ok) {
      stopPump();
      release();
      status = 'Kayıt başlatılamadı: ' + res.error;
    } else {
      status = '';
    }
    P().rerender();
  }

  function stop() {
    const R = engine();
    if (R) R.stop();
    busy = true;
    status = 'Dosya yazılıyor…';
    P().rerender();
  }

  async function finish(blob, cfg) {
    stopPump();
    release();
    /* Boş kayıtta kaydetme penceresi AÇILMAZ.

        Kare üretilmemişse ffmpeg'e boş bir kap gidiyor ve kullanıcı, dosya
        adını seçtikten sonra "streams received no packets" gibi bir kodlayıcı
        hatasıyla karşılaşıyordu. Hata kaynağında ve anlaşılır dille söylenir. */
    /* Çok kısa kayıtta kodlayıcı tek bir kare bile yazamıyor ve ffmpeg
       "streams received no packets" diyerek boş dosya bırakıyor. Kullanıcıyı
       dosya adı seçtirdikten sonra bu hatayla karşılaştırmak yerine burada
       durduruluyor: WebM başlığı tek başına yaklaşık bir kaç yüz bayttır. */
    if (!blob || blob.size < 2048) {
      busy = false;
      status = '⚠ Kayıt çok kısa: kare yazılamadı (' + (blob ? blob.size : 0) +
        ' bayt). En az bir saniye kaydedin.';
      P().rerender();
      return;
    }
    try {
      const buf = await blob.arrayBuffer();
      const r = cfg.recording || {};
      const out = await window.api.saveRecording(new Uint8Array(buf), {
        format: r.format || 'mp4',
        gifFps: r.gifFps,
        gifWidth: r.gifWidth,
      });
      busy = false;
      if (out && out.ok) {
        status = '✓ Kaydedildi: ' + out.path;
        P().toast('Kayıt tamamlandı.');
      } else if (out && out.canceled) {
        status = 'Kaydetme iptal edildi.';
      } else {
        status = '⚠ ' + ((out && out.error) || 'yazılamadı');
      }
    } catch (e) {
      busy = false;
      status = '⚠ ' + String(e.message || e);
    }
    P().rerender();
  }

  /* Anlık görüntü, önizlemenin ZATEN çizdiği yüzeyi alır.

     Burada sahne yeniden çiziliyordu ve ses olarak SVPreview.lastAudio ya da
     window.SVAudioCore veriliyordu — ikisi de bu projede hiç var olmadı.
     Yani çizim her seferinde audio === undefined ile yapılıyor ve modların
     çoğu audio.bass okuduğu için hemen hata atıyordu. Yeniden çizmenin bir
     yararı da yoktu: istenen şey ekranda görünen kare. */
  async function snap(cfg) {
    const r = cfg.recording || {};
    status = 'Yüzey hazırlanıyor…';
    P().rerender();
    const src = await awaitSurface();
    if (!src) { status = 'Önizleme yüzeyi hazır değil.'; P().rerender(); return; }
    // Anlık görüntü de seçilen çözünürlükte alınır, önizleme boyutunda değil
    const cv = ensureCapture(src, r);
    blit(src);

    busy = true;
    status = 'Görüntü kaydediliyor…';
    P().rerender();

    try {
      const url = window.SVRecorder.snapshot(cv, r.snapshotScale || 1);
      release();
      if (!url) { status = 'Görüntü alınamadı.'; busy = false; P().rerender(); return; }
      const saver = (window.api && window.api.saveSnapshot) || (window.api && window.api.saveRecording);
      if (!saver) { status = 'Kaydetme API\'si hazır değil.'; busy = false; P().rerender(); return; }
      const out = await (window.api.saveSnapshot ? window.api.saveSnapshot(url) : window.api.saveRecording(url, { isSnapshot: true }));
      busy = false;
      if (out && out.ok) {
        status = '✓ Görüntü kaydedildi: ' + out.path;
        P().toast('Anlık görüntü kaydedildi.');
      } else if (out && out.canceled) {
        status = '';
      } else {
        status = '⚠ ' + ((out && out.error) || 'yazılamadı');
      }
    } catch (e) {
      busy = false;
      release();
      status = '⚠ ' + (e && e.message ? e.message : String(e));
    }
    P().rerender();
  }

  window.SVRecordPanel = { panel };
})();
