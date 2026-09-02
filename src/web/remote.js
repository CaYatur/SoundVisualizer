'use strict';
/* Mobil uzaktan kumanda.

   Yalnızca komut gönderir; doğrulama ve uygulama ana süreçtedir
   (main.js -> applyRemoteCommand). Buradan giden mesajlar VERİDİR: sunucu
   hangi ayar yollarının değişebileceğine kendisi karar verir.

   Kitaplık (sahneler, renk şablonları, Studio presetleri) adlarıyla listelenir
   ve her biri ◀ ▶ ile sırayla gezilebilir — sahne aralarında telefona bakmadan
   geçmek için. */
(function () {
  const R = window.SVRemote;
  const $ = (id) => document.getElementById(id);
  let cfg = null;
  let presets = [];
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
    ['gradient', 'Gradyan'], ['ink', 'Mürekkep'], ['nebula', 'Bulutsu'], ['waves', 'Dalga'],
    ['aurora', 'Kutup'], ['grid', 'Izgara'], ['hexgrid', 'Petek'], ['mosaic', 'Mozaik'],
    ['corridor', 'Koridor'], ['spiral', 'Sarmal'], ['rings', 'Halka'], ['network', 'Ağ'],
    ['starfield', 'Yıldız'], ['snow', 'Kar'], ['bokeh', 'Bokeh'], ['rain', 'Yağmur'],
    ['city', 'Şehir'], ['custom', 'Studio'], ['solid', 'Düz'],
  ];

  /* Yerleşik renk şablonları masaüstüyle AYNI kaynaktan (shared/defaults.js)
     okunur; burada ikinci bir kopya tutmak, şablon eklendiğinde telefonun
     listesinin sessizce eskimesi demekti. */
  const BUILTIN_PALETTES = ((window.SV && window.SV.GRADIENT_PRESETS) || []).map((p) => [p.name, p.colors]);

  function send(action, payload) {
    R.send(Object.assign({ type: 'command', action }, payload || {}));
  }
  function setPath(path, value) {
    send('set', { path, value });
  }
  function getPath(o, p) {
    return p.split('.').reduce((x, k) => (x == null ? x : x[k]), o);
  }

  // --------------------------------------------------------------------------
  // Kitaplık listeleri — hepsi aynı "sıra" mantığını paylaşır
  // --------------------------------------------------------------------------
  function scenes() {
    return (cfg && cfg.scenes) || [];
  }
  function palettes() {
    return BUILTIN_PALETTES.concat(((cfg && cfg.userPresets) || []).map((p) => [p.name || 'Şablonum', p.colors]));
  }
  function studioPresets() {
    // Yalnızca shader presetleri: varyasyonlar sahne olarak zaten uygulanabiliyor
    return presets.filter((p) => p && p.engine === 'shader');
  }

  function currentColors() {
    return (cfg && cfg.background && cfg.background.gradient && cfg.background.gradient.colors) || [];
  }
  function sameColors(a, b) {
    if (!a || !b || a.length !== b.length) return false;
    for (let i = 0; i < a.length; i++) {
      if (String(a[i]).toLowerCase() !== String(b[i]).toLowerCase()) return false;
    }
    return true;
  }

  function activePaletteIndex() {
    return palettes().findIndex(([, colors]) => sameColors(colors, currentColors()));
  }

  /* Sahnenin şu an uygulanmış olup olmadığı: sahne verisi arkaplan türü,
     görselleştirici türü ve renkleri saklar. Üçü de tutuyorsa o sahnedeyiz.
     (Panelde ayrıca bir kimlik tutuluyor ama o kimlik telefona gelmiyor.) */
  function sceneMatches(s) {
    const d = (s && s.data) || {};
    if (!cfg) return false;
    if (d.layerStack && d.layerStack.enabled) {
      if (!cfg.layerStack || !cfg.layerStack.enabled) return false;
      const dl = Array.isArray(d.layers) ? d.layers : [];
      const cl = Array.isArray(cfg.layers) ? cfg.layers : [];
      if (dl.length !== cl.length) return false;
      return dl.every((l, i) => l.kind === cl[i].kind && l.type === cl[i].type && l.enabled === cl[i].enabled);
    }
    if (!d.background || !d.visualizer) return false;
    if (d.background.type !== cfg.background.type) return false;
    if (d.visualizer.type !== cfg.visualizer.type) return false;
    const sc = d.background.gradient && d.background.gradient.colors;
    return !sc || sameColors(sc, currentColors());
  }
  function activeSceneIndex() {
    return scenes().findIndex(sceneMatches);
  }

  function activeStudioIndex() {
    if (!cfg) return -1;
    const id = cfg.visualizer.type === 'custom' ? cfg.custom && cfg.custom.visualizerId
      : cfg.background.type === 'custom' ? cfg.custom && cfg.custom.backgroundId
        : null;
    return id ? studioPresets().findIndex((p) => p.id === id) : -1;
  }

  // --------------------------------------------------------------------------
  // Uygulama eylemleri
  // --------------------------------------------------------------------------
  function applyScene(i) {
    const list = scenes();
    if (!list.length) return;
    const s = list[((i % list.length) + list.length) % list.length];
    send('scene', { id: s.id });
  }
  function applyPalette(i) {
    const list = palettes();
    if (!list.length) return;
    const p = list[((i % list.length) + list.length) % list.length];
    setPath('background.gradient.colors', p[1]);
  }
  function applyStudio(i) {
    const list = studioPresets();
    if (!list.length) return;
    const p = list[((i % list.length) + list.length) % list.length];
    if (p.kind === 'background') {
      setPath('custom.backgroundId', p.id);
      setPath('background.type', 'custom');
    } else {
      setPath('custom.visualizerId', p.id);
      setPath('visualizer.type', 'custom');
    }
  }

  /* ◀ ▶ düğmeleri: seçili öğeden bir sonrakine/öncekine geç.
     Hiçbiri seçili değilken (kullanıcı ayarları elle değiştirmişse) ▶ listenin
     başından, ◀ sonundan başlar — aradan rastgele bir yere atlamak yerine. */
  function step(index, dir, len) {
    if (index < 0) return dir > 0 ? 0 : len - 1;
    return index + dir;
  }

  document.querySelectorAll('[data-step]').forEach((btn) => {
    const [what, dirStr] = btn.dataset.step.split(':');
    const dir = parseInt(dirStr, 10);
    btn.addEventListener('click', () => {
      if (what === 'scene') applyScene(step(activeSceneIndex(), dir, scenes().length));
      else if (what === 'palette') applyPalette(step(activePaletteIndex(), dir, palettes().length));
      else if (what === 'studio') applyStudio(step(activeStudioIndex(), dir, studioPresets().length));
    });
  });

  // --------------------------------------------------------------------------
  // Çizim
  // --------------------------------------------------------------------------
  function buildGrid(host, items, path) {
    host.innerHTML = '';
    for (const [value, label] of items) {
      const b = document.createElement('button');
      b.textContent = label;
      b.dataset.value = value;
      b.addEventListener('click', () => setPath(path, value));
      host.appendChild(b);
    }
  }

  function markActive(host, value) {
    host.querySelectorAll('button').forEach((b) => b.classList.toggle('on', b.dataset.value === value));
  }

  function setNow(id, name, subtitle) {
    const n = $(id);
    n.textContent = name;
    const small = document.createElement('small');
    small.textContent = subtitle;
    n.appendChild(small);
  }

  function renderScenes() {
    const host = $('scenes');
    const list = scenes();
    const active = activeSceneIndex();
    $('sceneCount').textContent = list.length ? list.length + ' kayıtlı' : '';
    setNow('sceneNow', active >= 0 ? list[active].name || 'Sahne' : '—',
      list.length ? (active >= 0 ? (active + 1) + ' / ' + list.length : list.length + ' sahne') : 'sahne yok');

    host.innerHTML = '';
    if (!list.length) {
      host.innerHTML = '<span class="empty">Kayıtlı sahne yok. Bilgisayardaki panelden sahne kaydedin.</span>';
      return;
    }
    list.forEach((s, i) => {
      const b = document.createElement('button');
      b.textContent = s.name || 'Sahne ' + (i + 1);
      if (i === active) b.classList.add('on');
      b.addEventListener('click', () => send('scene', { id: s.id }));
      host.appendChild(b);
    });
  }

  function renderPalettes() {
    const host = $('palettes');
    const list = palettes();
    const active = activePaletteIndex();
    $('paletteCount').textContent = list.length + ' şablon';
    setNow('paletteNow', active >= 0 ? list[active][0] : 'Özel renkler',
      active >= 0 ? (active + 1) + ' / ' + list.length : 'şablona uymuyor');

    host.innerHTML = '';
    list.forEach(([name, colors], i) => {
      const b = document.createElement('button');
      b.className = 'sw' + (i === active ? ' on' : '');
      b.title = name;
      const bar = document.createElement('span');
      bar.className = 'bar';
      bar.style.background = 'linear-gradient(135deg, ' + colors.join(', ') + ')';
      const nm = document.createElement('span');
      nm.className = 'nm';
      nm.textContent = name;
      b.appendChild(bar);
      b.appendChild(nm);
      b.addEventListener('click', () => setPath('background.gradient.colors', colors));
      host.appendChild(b);
    });
  }

  function renderStudio() {
    const list = studioPresets();
    const card = $('studioCard');
    card.hidden = list.length === 0;
    if (!list.length) return;
    const active = activeStudioIndex();
    $('studioCount').textContent = list.length + ' preset';
    setNow('studioNow', active >= 0 ? list[active].name : '—',
      active >= 0 ? (active + 1) + ' / ' + list.length : list.length + ' preset');

    const host = $('studioPresets');
    host.innerHTML = '';
    list.forEach((p, i) => {
      const b = document.createElement('button');
      b.textContent = p.name;
      b.title = (p.kind === 'background' ? 'Arkaplan' : 'Görselleştirici') + (p.description ? ' — ' + p.description : '');
      if (i === active) b.classList.add('on');
      b.addEventListener('click', () => applyStudio(i));
      host.appendChild(b);
    });
  }

  // --------------------------------------------------------------------------
  // Kaydırıcılar
  // --------------------------------------------------------------------------
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

  // --------------------------------------------------------------------------
  // Durum senkronu
  // --------------------------------------------------------------------------
  function syncFromConfig(c) {
    cfg = c;
    markActive($('visModes'), c.visualizer && c.visualizer.type);
    markActive($('bgModes'), c.background && c.background.type);
    renderScenes();
    renderPalettes();
    renderStudio();
    for (const s of sliders) {
      const v = getPath(c, s.path);
      if (v == null) continue;
      if (document.activeElement !== s.el) s.el.value = v;
      s.out.textContent = s.fmt(+v);
    }
    // "Bağlı" ve mod adı ayrı düğümlerde: birleşik metin çevrilemezdi
    const st = $('statusText');
    st.textContent = '';
    st.appendChild(document.createTextNode('Bağlı'));
    const label = VIS_MODES.find(([v]) => v === (c.visualizer && c.visualizer.type));
    st.appendChild(document.createTextNode(' · '));
    const modeSpan = document.createElement('span');
    modeSpan.textContent = label ? label[1] : (c.visualizer ? c.visualizer.type : '—');
    st.appendChild(modeSpan);
  }

  document.querySelectorAll('[data-action]').forEach((b) => {
    b.addEventListener('click', () => send(b.dataset.action));
  });

  // Karartma: yayında "panik" düğmesi — sahneyi kapatmadan karartır
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
  R.presetsReady.then((list) => { presets = list || []; renderStudio(); });
  R.onPresets((list) => { presets = list || []; renderStudio(); });
})();
