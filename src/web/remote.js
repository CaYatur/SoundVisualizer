'use strict';
/* Mobil uzaktan kumanda.

   Yalnızca komut gönderir; tüm doğrulama ve uygulama ana süreçte yapılır
   (bkz. main.js -> applyRemoteCommand). Buradan gelen mesajlar VERİDİR:
   sunucu hangi ayar yollarının değişebileceğine kendisi karar verir. */
(function () {
  const R = window.SVRemote;
  const $ = (id) => document.getElementById(id);
  let cfg = null;
  let blackoutSaved = null;

  const VIS_MODES = [
    ['none', 'Kapalı'], ['bars', 'Barlar'], ['centerBars', 'Merkez'], ['blocks', 'Segment'],
    ['dots', 'Nokta'], ['wave', 'Dalga'], ['ribbon', 'Şerit'], ['terrain', 'Arazi'],
    ['circular', 'Çember'], ['radialWave', 'Dairesel'], ['starburst', 'Işın'], ['tunnel', 'Tünel'],
    ['orb', 'Küre'], ['particles', 'Parçacık'], ['spectrogram', 'Spektrogram'],
    ['kaleido', 'Kaleydoskop'], ['helix', 'Sarmal'], ['metaball', 'Damla'], ['fireworks', 'Havai Fişek'],
    ['vortex', 'Girdap'], ['mandala', 'Mandala'], ['skyline', 'Silüet'], ['lightning', 'Şimşek'],
    ['ripplegrid', 'Dalgalı Izgara'], ['lissajous', 'Lissajous'], ['strings', 'Teller'],
    ['bubbles', 'Baloncuk'], ['wave3d', '3B Dalga'], ['arcs', 'Yaylar'], ['pinwheel', 'Fırıldak'],
    ['feedback', 'Geri Besleme'], ['custom', 'Studio'],
  ];

  const BG_MODES = [
    ['gradient', 'Gradyan'], ['waves', 'Dalga'], ['aurora', 'Kutup'], ['starfield', 'Yıldız'],
    ['grid', 'Izgara'], ['bokeh', 'Bokeh'], ['rain', 'Yağmur'], ['network', 'Ağ'], ['rings', 'Halka'],
    ['nebula', 'Bulutsu'], ['hexgrid', 'Petek'], ['ink', 'Mürekkep'], ['snow', 'Kar'], ['city', 'Şehir'],
    ['corridor', 'Koridor'], ['spiral', 'Sarmal'], ['mosaic', 'Mozaik'], ['custom', 'Studio'], ['solid', 'Düz'],
  ];

  function send(action, payload) {
    R.send(Object.assign({ type: 'command', action }, payload || {}));
  }

  function setPath(path, value) {
    send('set', { path, value });
  }

  // --- mod ızgaraları ---
  function buildGrid(host, items, path) {
    host.innerHTML = '';
    for (const [value, label] of items) {
      const b = document.createElement('button');
      b.textContent = label;
      b.dataset.value = value;
      b.addEventListener('click', () => {
        setPath(path, value);
        host.querySelectorAll('button').forEach((x) => x.classList.remove('on'));
        b.classList.add('on');
      });
      host.appendChild(b);
    }
  }

  function markActive(host, value) {
    host.querySelectorAll('button').forEach((b) => b.classList.toggle('on', b.dataset.value === value));
  }

  // --- sahneler ---
  function renderScenes() {
    const host = $('scenes');
    const list = (cfg && cfg.scenes) || [];
    host.innerHTML = '';
    if (!list.length) {
      host.innerHTML = '<span class="empty">Kayıtlı sahne yok.</span>';
      return;
    }
    for (const s of list) {
      const b = document.createElement('button');
      b.textContent = s.name || 'Sahne';
      b.addEventListener('click', () => send('scene', { id: s.id }));
      host.appendChild(b);
    }
  }

  // --- renk şablonları ---
  const PRESET_COLORS = [
    ['Aurora', ['#5b4be0', '#3aa6ff', '#37e0c8', '#7be07b', '#d24bff']],
    ['Gün Batımı', ['#ff5e62', '#ff9966', '#ffcf6b', '#c94b8e', '#5b2c83']],
    ['Okyanus', ['#0f2027', '#1c92d2', '#2af5d4', '#136a8a', '#0b486b']],
    ['Neon', ['#ff00cc', '#3333ff', '#00ffe0', '#9d00ff', '#ff0066']],
    ['Orman', ['#0b3d2e', '#1e6f5c', '#56c596', '#a3eb9d', '#0f5132']],
    ['Lav', ['#1a0000', '#7a0000', '#ff2e00', '#ff8a00', '#ffd000']],
    ['Pastel', ['#a8e6cf', '#dcedc1', '#ffd3b6', '#ffaaa5', '#d7a6ff']],
    ['Gece', ['#020111', '#191654', '#43377c', '#7b2ff7', '#22264b']],
    ['Buz', ['#cfefff', '#74c0ff', '#3a7bd5', '#7ee8fa', '#eaf6ff']],
  ];

  function renderPalettes() {
    const host = $('palettes');
    host.innerHTML = '';
    const all = PRESET_COLORS.concat(((cfg && cfg.userPresets) || []).map((p) => [p.name, p.colors]));
    for (const [name, colors] of all) {
      const b = document.createElement('button');
      b.className = 'sw';
      b.title = name;
      b.style.background = `linear-gradient(135deg, ${colors.join(', ')})`;
      b.addEventListener('click', () => setPath('background.gradient.colors', colors));
      host.appendChild(b);
    }
  }

  // --- kaydırıcılar ---
  function bindSlider(id, path, label, fmt) {
    const el = $(id);
    const out = $(label);
    el.addEventListener('input', () => {
      out.textContent = fmt(+el.value);
      setPath(path, +el.value);
    });
    return { el, out, path, fmt };
  }

  const sliders = [
    bindSlider('sens', 'audio.sensitivity', 'vSens', (v) => v.toFixed(2)),
    bindSlider('smooth', 'audio.smoothing', 'vSmooth', (v) => Math.round(v * 100) + '%'),
    bindSlider('bass', 'audio.bassBoost', 'vBass', (v) => v.toFixed(2)),
    bindSlider('glow', 'visualizer.glow', 'vGlow', (v) => Math.round(v * 100) + '%'),
  ];

  function getPath(o, p) {
    return p.split('.').reduce((x, k) => (x == null ? x : x[k]), o);
  }

  function syncFromConfig(c) {
    cfg = c;
    markActive($('visModes'), c.visualizer && c.visualizer.type);
    markActive($('bgModes'), c.background && c.background.type);
    renderScenes();
    renderPalettes();
    for (const s of sliders) {
      const v = getPath(c, s.path);
      if (v == null) continue;
      if (document.activeElement !== s.el) s.el.value = v;
      s.out.textContent = s.fmt(+v);
    }
    $('statusText').textContent = 'Bağlı · ' + (c.visualizer ? c.visualizer.type : '—');
  }

  // --- eylem düğmeleri ---
  document.querySelectorAll('[data-action]').forEach((b) => {
    const action = b.dataset.action;
    if (action === 'blackout') return; // aşağıda özel ele alınıyor
    b.addEventListener('click', () => send(action));
  });

  // Karartma: görselleştiriciyi kapatmadan sahneyi karartır (yayında "panik" düğmesi)
  $('blackoutBtn').addEventListener('click', () => {
    if (!cfg) return;
    const btn = $('blackoutBtn');
    if (blackoutSaved) {
      setPath('background.type', blackoutSaved.bg);
      setPath('visualizer.type', blackoutSaved.vis);
      blackoutSaved = null;
      btn.classList.remove('on');
    } else {
      blackoutSaved = { bg: cfg.background.type, vis: cfg.visualizer.type };
      setPath('background.type', 'solid');
      setPath('background.solidColor', '#000000');
      setPath('visualizer.type', 'none');
      btn.classList.add('on');
    }
  });

  buildGrid($('visModes'), VIS_MODES, 'visualizer.type');
  buildGrid($('bgModes'), BG_MODES, 'background.type');

  R.ready.then(syncFromConfig);
  R.onConfig(syncFromConfig);
})();
