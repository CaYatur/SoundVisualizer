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

  function engine() {
    if (!rec && window.SVRecorder) rec = new window.SVRecorder.Recorder();
    return rec;
  }

  // Kaydedilecek tuval: önizlemenin görünür tek yüzeyi
  function target() {
    const prev = window.SVPreview;
    const stack = prev && prev.stack && prev.stack();
    if (!stack) return null;
    stack.setForceSingle(true);
    stack._ensureComp();
    if (stack.compCanvas.width !== stack.width || stack.compCanvas.height !== stack.height) {
      stack.compCanvas.width = stack.width;
      stack.compCanvas.height = stack.height;
    }
    return stack.surface() || stack.compCanvas;
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
      text: 'Kayıt paneldeki canlı önizlemeden alınır ve o anki sesle birlikte ekranda göründüğü gibi kaydedilir — modülasyon, geçişler, efektler dahil. Bir ses dosyasının tamamını yüksek çözünürlükte işlemek için Video Dışa Aktarma kartını kullanın.',
    }));

    return el('div', { class: 'rec-panel' }, nodes);
  }

  function fmt(sec) {
    const s = Math.floor(sec || 0);
    return String(Math.floor(s / 60)).padStart(2, '0') + ':' + String(s % 60).padStart(2, '0');
  }

  function start(cfg) {
    const R = engine();
    if (!R) { status = 'Kayıt motoru yok.'; P().rerender(); return; }
    const cv = target();
    if (!cv) { status = 'Önizleme yüzeyi hazır değil; bir an sonra yeniden deneyin.'; P().rerender(); return; }
    const r = cfg.recording || {};
    const res = R.start(cv, {
      fps: r.fps,
      bitrate: r.bitrate,
      limit: r.limit,
      onStop: (blob) => finish(blob, cfg),
    });
    if (!res.ok) {
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
    release();
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

  async function snap(cfg) {
    const prev = window.SVPreview;
    const stack = prev && prev.stack && prev.stack();
    const r = cfg.recording || {};
    let cv = null;
    if (stack) {
      stack._ensureComp();
      if (stack.compCanvas.width !== stack.width || stack.compCanvas.height !== stack.height) {
        stack.compCanvas.width = stack.width;
        stack.compCanvas.height = stack.height;
      }
      stack.drawTo(stack.compCtx, (prev && prev.lastAudio) || (window.SVAudioCore && window.SVAudioCore.readAnalysis()), cfg, performance.now() / 1000, 0.016);
      cv = stack.compCanvas;
    }
    if (!cv) cv = target();
    if (!cv) { status = 'Önizleme yüzeyi hazır değil.'; P().rerender(); return; }

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
