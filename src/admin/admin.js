'use strict';
/* Yönetici paneli mantığı: şema tabanlı kontrol üretimi, ekran yönetimi,
   canlı seviye göstergesi ve görselleştiriciye anlık yapılandırma gönderimi. */
(function () {
  let cfg = window.SV.defaultConfig();
  let displays = [];
  let selectedDisplayId = null;
  let visOpen = false;
  let audioDevices = [];
  let pushTimer = null;

  const $ = (id) => document.getElementById(id);

  // --------------------------------------------------------------------------
  // Yapılandırma gönderimi (debounce)
  // --------------------------------------------------------------------------
  function push(immediate) {
    if (immediate) {
      if (pushTimer) clearTimeout(pushTimer);
      pushTimer = null;
      window.api.updateConfig(cfg);
      return;
    }
    if (pushTimer) return;
    pushTimer = setTimeout(() => {
      pushTimer = null;
      window.api.updateConfig(cfg);
    }, 55);
  }

  function getPath(o, p) {
    return p.split('.').reduce((x, k) => (x == null ? x : x[k]), o);
  }
  function setPath(o, p, v) {
    const ks = p.split('.');
    let x = o;
    for (let i = 0; i < ks.length - 1; i++) x = x[ks[i]];
    x[ks[ks.length - 1]] = v;
  }

  // --------------------------------------------------------------------------
  // DOM yardımcısı
  // --------------------------------------------------------------------------
  function el(tag, props, kids) {
    const e = document.createElement(tag);
    if (props) {
      for (const k in props) {
        if (k === 'class') e.className = props[k];
        else if (k === 'html') e.innerHTML = props[k];
        else if (k === 'text') e.textContent = props[k];
        else if (k.startsWith('on') && typeof props[k] === 'function')
          e.addEventListener(k.slice(2), props[k]);
        else e.setAttribute(k, props[k]);
      }
    }
    (kids || []).forEach((c) => c && e.appendChild(c));
    return e;
  }

  function fmtVal(def, v) {
    if (def.fmt) return def.fmt(v);
    if (def.step && def.step >= 1) return String(Math.round(v));
    if (def.percent) return Math.round(v * 100) + '%';
    return (+v).toFixed(2);
  }

  // --------------------------------------------------------------------------
  // Kontrol üreticileri
  // --------------------------------------------------------------------------
  function buildControl(def) {
    switch (def.type) {
      case 'slider':
        return sliderCtrl(def);
      case 'toggle':
        return toggleCtrl(def);
      case 'color':
        return colorCtrl(def);
      case 'segment':
        return segmentCtrl(def);
      case 'select':
        return selectCtrl(def);
      case 'colors':
        return colorsCtrl(def);
      case 'presets':
        return presetsCtrl(def);
      case 'logofile':
        return logoFileCtrl(def);
      case 'xy':
        return xyCtrl(def);
      case 'button':
        return buttonCtrl(def);
      case 'multisource':
        return multisourceCtrl(def);
      default:
        return null;
    }
  }

  const actions = {};

  function buttonCtrl(def) {
    const btn = el('button', {
      class: 'btn ghost small',
      text: def.label,
      onclick: () => {
        if (def.action && actions[def.action]) actions[def.action]();
      },
    });
    btn.style.marginTop = '2px';
    return el('div', { class: 'ctrl' }, [btn]);
  }

  function sliderCtrl(def) {
    const valSpan = el('span', { class: 'val' });
    const setText = (v) => (valSpan.textContent = fmtVal(def, v));
    const cur = getPath(cfg, def.path);
    setText(cur);
    const input = el('input', {
      type: 'range',
      min: def.min,
      max: def.max,
      step: def.step,
      value: cur,
      oninput: (e) => {
        const v = parseFloat(e.target.value);
        setPath(cfg, def.path, v);
        setText(v);
        push(false);
      },
    });
    return el('div', { class: 'ctrl' }, [
      el('div', { class: 'row' }, [el('label', { class: 'lbl', text: def.label }), valSpan]),
      input,
    ]);
  }

  function toggleCtrl(def) {
    const input = el('input', {
      type: 'checkbox',
      onchange: (e) => {
        setPath(cfg, def.path, e.target.checked);
        push(true);
        if (def.rebuild) render();
      },
    });
    input.checked = !!getPath(cfg, def.path);
    return el('div', { class: 'ctrl' }, [
      el('div', { class: 'row' }, [
        el('label', { class: 'lbl', text: def.label }),
        el('label', { class: 'switch' }, [input, el('span', { class: 'track' })]),
      ]),
    ]);
  }

  function colorCtrl(def) {
    const input = el('input', {
      type: 'color',
      value: getPath(cfg, def.path),
      oninput: (e) => {
        setPath(cfg, def.path, e.target.value);
        push(false);
      },
    });
    return el('div', { class: 'ctrl' }, [
      el('div', { class: 'row' }, [el('label', { class: 'lbl', text: def.label }), input]),
    ]);
  }

  function segmentCtrl(def) {
    const cur = getPath(cfg, def.path);
    const seg = el('div', { class: 'segment' });
    def.options.forEach((o) => {
      const b = el('button', {
        class: cur === o.value ? 'active' : '',
        text: o.label,
        onclick: () => {
          setPath(cfg, def.path, o.value);
          push(true);
          render();
        },
      });
      seg.appendChild(b);
    });
    return el('div', { class: 'ctrl' }, [
      el('label', { class: 'lbl', text: def.label }),
      seg,
    ]);
  }

  function selectCtrl(def) {
    const cur = getPath(cfg, def.path);
    const opts = typeof def.options === 'function' ? def.options() : def.options;
    const sel = el('select', {
      onchange: (e) => {
        let v = e.target.value;
        if (def.numeric) v = parseFloat(v);
        setPath(cfg, def.path, v);
        push(true);
        if (def.rebuild) render();
      },
    });
    let found = false;
    opts.forEach((o) => {
      const opt = el('option', { value: o.value, text: o.label });
      if (String(o.value) === String(cur)) {
        opt.selected = true;
        found = true;
      }
      sel.appendChild(opt);
    });
    if (!found && cur != null) {
      const opt = el('option', { value: cur, text: String(cur) });
      opt.selected = true;
      sel.appendChild(opt);
    }
    sel.style.width = '100%';
    sel.style.cssText += 'background:var(--card2);color:var(--text);border:1px solid var(--line);border-radius:9px;padding:8px 10px;font-size:13px;margin-top:6px;outline:none;';
    return el('div', { class: 'ctrl' }, [el('label', { class: 'lbl', text: def.label }), sel]);
  }

  function colorsCtrl(def) {
    const arr = getPath(cfg, def.path);
    const list = el('div', { class: 'colorlist' });
    for (let i = 0; i < 5; i++) {
      const input = el('input', {
        type: 'color',
        value: arr[i] || '#000000',
        oninput: (e) => {
          arr[i] = e.target.value;
          push(false);
        },
      });
      list.appendChild(input);
    }
    return el('div', { class: 'ctrl' }, [
      el('label', { class: 'lbl', text: def.label }),
      list,
    ]);
  }

  function presetsCtrl(def) {
    const grid = el('div', { class: 'presets' });
    window.SV.GRADIENT_PRESETS.forEach((p) => {
      const swatch = el('div', { class: 'swatch' });
      swatch.style.background = `linear-gradient(90deg, ${p.colors.join(',')})`;
      const card = el('div', { class: 'preset', onclick: () => {
        cfg.background.gradient.colors = p.colors.slice();
        push(true);
        render();
      } }, [swatch, el('div', { class: 'name', text: p.name })]);
      grid.appendChild(card);
    });
    return el('div', { class: 'ctrl' }, [
      el('label', { class: 'lbl', text: 'Hazır Şablonlar' }),
      grid,
    ]);
  }

  function logoFileCtrl() {
    const fileInput = el('input', { type: 'file', accept: 'image/*' });
    fileInput.style.display = 'none';
    fileInput.addEventListener('change', (e) => {
      const file = e.target.files[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = () => {
        cfg.logo.src = reader.result;
        push(true);
        preview.src = reader.result;
        preview.style.display = 'block';
      };
      reader.readAsDataURL(file);
    });
    const btn = el('label', { class: 'filebtn', text: '🖼  Resim / Logo Seç' });
    btn.appendChild(fileInput);
    btn.addEventListener('click', () => fileInput.click());

    const removeBtn = el('button', {
      class: 'btn ghost small', text: 'Kaldır',
      onclick: () => {
        cfg.logo.src = null;
        push(true);
        preview.style.display = 'none';
      },
    });
    removeBtn.style.marginLeft = '8px';

    const preview = el('img', { class: 'logo-preview' });
    if (cfg.logo.src) {
      preview.src = cfg.logo.src;
      preview.style.display = 'block';
    }
    return el('div', { class: 'ctrl' }, [
      el('div', { class: 'row' }, [btn, removeBtn]),
      preview,
    ]);
  }

  function xyCtrl() {
    const mk = (axis, label) =>
      sliderCtrl({ path: 'logo.' + axis, label, min: 0, max: 1, step: 0.01, percent: true });
    const auto = el('button', {
      class: 'btn ghost small', text: '⌖ Otomatik Ortala',
      onclick: () => {
        cfg.logo.x = 0.5;
        cfg.logo.y = 0.5;
        push(true);
        render();
      },
    });
    auto.style.marginTop = '6px';
    return el('div', {}, [mk('x', 'Yatay Konum'), mk('y', 'Dikey Konum'), auto]);
  }
  function multisourceCtrl(def) {
    const checkboxes = new Map();

    function getCur() {
      const v = getPath(cfg, def.path);
      return Array.isArray(v) ? v : (v ? [v] : ['default']);
    }

    function toggle(value) {
      let arr = getCur().slice();
      if (arr.includes(value)) {
        arr = arr.filter((v) => v !== value);
        if (arr.length === 0) arr = ['default']; // en az bir kaynak her zaman seçili
      } else {
        arr.push(value);
      }
      setPath(cfg, def.path, arr);
      updateChecks();
      push(true);
    }

    function updateChecks() {
      const cur = getCur();
      checkboxes.forEach((cb, val) => { cb.checked = cur.includes(val); });
    }

    function makeRow(value, icon, label) {
      const cb = el('input', { type: 'checkbox' });
      checkboxes.set(value, cb);
      cb.addEventListener('change', () => toggle(value));
      const row = el('label', { class: 'source-item' }, [
        cb,
        el('span', { class: 'source-icon', text: icon }),
        el('span', { class: 'source-name', text: label }),
      ]);
      return row;
    }

    const devices = typeof def.devices === 'function' ? def.devices() : (def.devices || []);
    const rows = [makeRow('default', '\ud83d\udd0a', 'Varsayılan Çıkış (Aktif Hoparlör)')];
    devices.forEach((d) => {
      const icon = d.kind === 'input' ? '\ud83c\udfa4' : '\ud83d\udd0a';
      const suffix = d.isDefault ? ' (★)' : '';
      rows.push(makeRow(d.name, icon, d.name + suffix));
    });
    updateChecks();

    const list = el('div', { class: 'source-list' }, rows);
    return el('div', { class: 'ctrl' }, [
      el('label', { class: 'lbl', text: def.label }),
      list,
    ]);
  }
  // --------------------------------------------------------------------------
  // Bölüm şeması
  // --------------------------------------------------------------------------
  function sectionSchema() {
    const v = cfg.visualizer;
    const isBarsLike = v.type === 'bars' || v.type === 'circular' || v.type === 'centerBars';
    return [
      {
        icon: '🔊',
        title: 'Ses Kaynakları',
        desc: 'Birden fazla kaynak seçilebilir ve karıştırılır. 🔊 Loopback (sistem sesi), 🎤 Mikrofon (giriş aygıtı).',
        controls: [
          {
            type: 'multisource',
            path: 'audio.sources',
            label: 'Aktif Kaynaklar',
            devices: () => audioDevices,
          },
          { type: 'button', label: '🔄 Aygıtları Yenile', action: 'refreshDevices' },
          { type: 'slider', path: 'audio.sensitivity', label: 'Hassasiyet', min: 0.2, max: 4, step: 0.05 },
          { type: 'slider', path: 'audio.smoothing', label: 'Yumuşatma', min: 0, max: 0.95, step: 0.01, percent: true },
          { type: 'slider', path: 'audio.bassBoost', label: 'Bas Vurgusu', min: 1, max: 4, step: 0.05 },
        ],
      },
      {
        icon: '🌫️',
        title: 'Arkaplan (Akışkan Gradyan)',
        desc: 'Sese tepki veren sisli/akışkan fon. Renkler ve hazır şablonlar.',
        controls: [
          {
            type: 'segment', path: 'background.type', label: 'Tür',
            options: [{ value: 'gradient', label: 'Akışkan Gradyan' }, { value: 'solid', label: 'Düz Renk' }],
          },
          { type: 'color', path: 'background.solidColor', label: 'Düz Renk', show: () => cfg.background.type === 'solid' },
          {
            type: 'segment', path: 'background.gradient.style', label: 'Stil',
            options: [
              { value: 'soft', label: 'Yumuşak (Parlamasız)' },
              { value: 'plasma', label: 'Plazma (Parlamalı)' },
            ],
            show: () => cfg.background.type === 'gradient',
          },
          { type: 'colors', path: 'background.gradient.colors', label: 'Renkler (5 nokta)', show: () => cfg.background.type === 'gradient' },
          { type: 'presets', show: () => cfg.background.type === 'gradient' },
          { type: 'slider', path: 'background.gradient.speed', label: 'Akış Hızı', min: 0, max: 2, step: 0.02, show: () => cfg.background.type === 'gradient' },
          { type: 'slider', path: 'background.gradient.drift', label: 'Tek Yönlü Kayma', min: 0, max: 1, step: 0.01, percent: true, show: () => cfg.background.type === 'gradient' },
          { type: 'slider', path: 'background.gradient.wander', label: 'Gezinme Alanı', min: 0, max: 2, step: 0.02, show: () => cfg.background.type === 'gradient' },
          { type: 'slider', path: 'background.gradient.orbit', label: 'Dolanma Miktarı', min: 0, max: 2, step: 0.02, show: () => cfg.background.type === 'gradient' },
          { type: 'slider', path: 'background.gradient.swirl', label: 'İç Dönüş (Swirl)', min: 0, max: 2, step: 0.02, show: () => cfg.background.type === 'gradient' },
          { type: 'slider', path: 'background.gradient.scale', label: 'Ölçek (Yoğunluk)', min: 0.4, max: 3, step: 0.05, show: () => cfg.background.type === 'gradient' },
          { type: 'slider', path: 'background.gradient.warp', label: 'Bozulma (Akışkanlık)', min: 0, max: 2, step: 0.02, show: () => cfg.background.type === 'gradient' },
          { type: 'slider', path: 'background.gradient.audioReactivity', label: 'Ses Tepkisi (Dalgalanma)', min: 0, max: 2, step: 0.02, show: () => cfg.background.type === 'gradient' },
          { type: 'slider', path: 'background.gradient.brightness', label: 'Parlaklık (Temel)', min: 0.4, max: 1.6, step: 0.02, show: () => cfg.background.type === 'gradient' },
          { type: 'slider', path: 'background.gradient.audioBrightness', label: 'Ses Patlaması (Parlaklık)', min: 0, max: 2, step: 0.02, show: () => cfg.background.type === 'gradient' },
          { type: 'slider', path: 'background.gradient.audioHue', label: 'Ses ile Renk Kayması', min: 0, max: 1, step: 0.02, percent: true, show: () => cfg.background.type === 'gradient' },
          { type: 'toggle', path: 'background.gradient.hideLines', label: 'Hat Çizgilerini Gizle', show: () => cfg.background.type === 'gradient' },
          { type: 'slider', path: 'background.gradient.grain', label: 'Gren', min: 0, max: 0.2, step: 0.005, show: () => cfg.background.type === 'gradient' },
          { type: 'slider', path: 'background.gradient.vignette', label: 'Vinyet', min: 0, max: 1, step: 0.02, percent: true, show: () => cfg.background.type === 'gradient' },
        ],
      },
      {
        icon: '📊',
        title: 'Görselleştirici',
        desc: 'Sese duyarlı ön efekt. Frekans barları, dalga veya çember.',
        controls: [
          {
            type: 'segment', path: 'visualizer.type', label: 'Tür',
            options: [
              { value: 'none', label: 'Kapalı' },
              { value: 'bars', label: 'Barlar' },
              { value: 'centerBars', label: 'Merkez' },
              { value: 'wave', label: 'Dalga' },
              { value: 'circular', label: 'Çember' },
            ],
          },
          { type: 'toggle', path: 'visualizer.rainbow', label: 'Gökkuşağı (Rainbow)', rebuild: true, show: () => v.type !== 'none' },
          { type: 'color', path: 'visualizer.color', label: 'Renk', show: () => v.type !== 'none' && !v.rainbow },
          { type: 'color', path: 'visualizer.color2', label: 'İkincil Renk', show: () => v.type === 'wave' && !v.rainbow },
          { type: 'slider', path: 'visualizer.sensitivity', label: 'Hassasiyet', min: 0.3, max: 3, step: 0.05, show: () => v.type !== 'none' },
          { type: 'slider', path: 'visualizer.glow', label: 'Parlama (Glow)', min: 0, max: 1, step: 0.02, percent: true, show: () => v.type !== 'none' },
          { type: 'slider', path: 'visualizer.barCount', label: 'Bar Sayısı', min: 16, max: 160, step: 1, show: () => isBarsLike },
          { type: 'slider', path: 'visualizer.minFreq', label: 'Min Frekans (Hz)', min: 20, max: 500, step: 5, show: () => isBarsLike },
          { type: 'slider', path: 'visualizer.maxFreq', label: 'Max Frekans (Hz)', min: 2000, max: 20000, step: 100, show: () => isBarsLike },
          { type: 'slider', path: 'visualizer.gap', label: 'Bar Boşluğu', min: 0, max: 0.8, step: 0.02, percent: true, show: () => isBarsLike },
          {
            type: 'segment', path: 'visualizer.position', label: 'Yerleşim',
            options: [{ value: 'bottom', label: 'Alt' }, { value: 'center', label: 'Orta' }, { value: 'full', label: 'Tam' }],
            show: () => v.type === 'bars',
          },
          { type: 'toggle', path: 'visualizer.mirror', label: 'Ayna (Simetri)', show: () => v.type === 'bars' || v.type === 'wave' },
          { type: 'slider', path: 'visualizer.lineWidth', label: 'Çizgi Kalınlığı', min: 1, max: 12, step: 0.5, show: () => v.type === 'wave' },
          { type: 'slider', path: 'visualizer.thickness', label: 'Genlik / Dolgu', min: 0.1, max: 1, step: 0.02, percent: true, show: () => v.type === 'wave' },
        ],
      },
      {
        icon: '🖼️',
        title: 'Logo / Resim',
        desc: 'Merkeze resim yerleştir; otomatik boyutlandırılır ve nabız atar.',
        controls: [
          { type: 'toggle', path: 'logo.enabled', label: 'Logo Göster', rebuild: true },
          { type: 'logofile', show: () => cfg.logo.enabled },
          { type: 'slider', path: 'logo.scale', label: 'Boyut', min: 0.05, max: 0.6, step: 0.01, percent: true, show: () => cfg.logo.enabled },
          { type: 'slider', path: 'logo.opacity', label: 'Saydamlık', min: 0, max: 1, step: 0.02, percent: true, show: () => cfg.logo.enabled },
          { type: 'slider', path: 'logo.pulse', label: 'Ses Nabzı', min: 0, max: 1, step: 0.02, percent: true, show: () => cfg.logo.enabled },
          { type: 'slider', path: 'logo.glow', label: 'Parlama', min: 0, max: 1, step: 0.02, percent: true, show: () => cfg.logo.enabled },
          { type: 'xy', show: () => cfg.logo.enabled },
        ],
      },
      {
        icon: '⚡',
        title: 'Güç / Performans',
        desc: 'Kare hızı, çözünürlük ölçeği ve enerji ayarları.',
        controls: [
          {
            type: 'select', path: 'power.fpsCap', label: 'Kare Hızı (FPS)', numeric: true,
            options: [
              { value: 30, label: '30 FPS (Düşük güç)' },
              { value: 60, label: '60 FPS (Dengeli)' },
              { value: 120, label: '120 FPS (Akıcı)' },
              { value: 0, label: 'Sınırsız' },
            ],
          },
          { type: 'slider', path: 'power.renderScale', label: 'Arkaplan Çözünürlüğü', min: 0.4, max: 1, step: 0.05, percent: true },
          { type: 'toggle', path: 'power.pauseOnSilence', label: 'Sessizlikte Duraklat' },
          { type: 'toggle', path: 'power.hideCursor', label: 'İmleci Gizle' },
        ],
      },
    ];
  }

  // --------------------------------------------------------------------------
  // Render
  // --------------------------------------------------------------------------
  function render() {
    const root = $('sections');
    root.innerHTML = '';
    sectionSchema().forEach((sec) => {
      const card = el('div', { class: 'card' }, [
        el('h2', {}, [el('span', { class: 'ico', text: sec.icon }), document.createTextNode(' ' + sec.title)]),
        el('div', { class: 'desc', text: sec.desc }),
      ]);
      sec.controls.forEach((def) => {
        if (def.show && !def.show()) return;
        const c = buildControl(def);
        if (c) card.appendChild(c);
      });
      root.appendChild(card);
    });
  }

  // --------------------------------------------------------------------------
  // Ekranlar
  // --------------------------------------------------------------------------
  function renderDisplays() {
    const sel = $('displaySelect');
    sel.innerHTML = '';
    displays.forEach((d) => {
      const opt = el('option', {
        value: d.id,
        text: `${d.label} — ${d.size.width}×${d.size.height}`,
      });
      sel.appendChild(opt);
    });
    if (selectedDisplayId == null && displays.length) {
      const ext = displays.find((d) => !d.isPrimary);
      selectedDisplayId = (ext || displays[0]).id;
    }
    if (selectedDisplayId != null) sel.value = selectedDisplayId;
  }

  // --------------------------------------------------------------------------
  // Durum
  // --------------------------------------------------------------------------
  function setStatus(open) {
    visOpen = open;
    $('statusDot').className = 'dot ' + (open ? 'on' : 'off');
    $('statusText').textContent = open ? 'Açık' : 'Kapalı';
    $('openBtn').disabled = open;
    $('closeBtn').disabled = !open;
    $('openBtn').textContent = open ? '▶ Açık' : '▶ Görselleştirmeyi Aç';
  }

  function setAudioState(text, cls) {
    const a = $('audioState');
    a.textContent = text;
    a.className = 'audio-state' + (cls ? ' ' + cls : '');
  }

  function setMeter(id, v) {
    $(id).style.width = Math.min(100, Math.max(0, v * 100)) + '%';
  }

  // --------------------------------------------------------------------------
  // Başlat
  // --------------------------------------------------------------------------
  actions.refreshDevices = async () => {
    audioDevices = (await window.api.getOutputDevices()) || [];
    render();
  };

  async function init() {
    const saved = await window.api.getSettings();
    if (saved) cfg = window.SV.deepMerge(window.SV.defaultConfig(), saved);

    displays = await window.api.getDisplays();
    audioDevices = (await window.api.getOutputDevices()) || [];
    renderDisplays();
    render();

    visOpen = await window.api.visualizerIsOpen();
    setStatus(visOpen);

    // Olaylar
    $('displaySelect').addEventListener('change', (e) => {
      selectedDisplayId = parseInt(e.target.value, 10);
    });
    $('openBtn').addEventListener('click', async () => {
      await window.api.openVisualizer(selectedDisplayId);
      push(true); // en güncel yapılandırmayı gönder
    });
    $('closeBtn').addEventListener('click', () => window.api.closeVisualizer());
    $('resetBtn').addEventListener('click', () => {
      if (!confirm('Tüm ayarlar varsayılana dönecek. Emin misiniz?')) return;
      const sources = cfg.audio.sources ? cfg.audio.sources.slice() : ['default'];
      cfg = window.SV.defaultConfig();
      cfg.audio.sources = sources;
      push(true);
      render();
    });

    window.api.onVisualizerStatus((d) => setStatus(d.open));
    window.api.onDisplaysChanged((list) => {
      displays = list;
      renderDisplays();
    });
    window.api.onAudioMeter((d) => {
      setMeter('mLevel', d.level);
      setMeter('mBass', d.bass);
      setMeter('mMid', d.mid);
      setMeter('mTreble', d.treble);
    });
    window.api.onAudioSourceStatus((s) => {
      if (s.type === 'started') {
        setAudioState('● Yakalanıyor: ' + (s.device || 'çıkış'), 'ok');
        $('banner').classList.add('hidden');
        // başlatılan aygıtlardan herhangi biri listede yoksa listeyi tazele
        if (s.device) {
          const devNames = s.device.split(' + ');
          const anyMissing = devNames.some((n) => n !== 'default' && !audioDevices.some((d) => d.name === n));
          if (anyMissing) actions.refreshDevices();
        }
      } else if (s.type === 'error') {
        setAudioState('⚠ Ses yakalanamadı', 'err');
        $('bannerDetail').textContent = s.message || 'Çıkış aygıtı yakalanamadı.';
        $('banner').classList.remove('hidden');
      }
    });

    $('bannerClose').addEventListener('click', () => $('banner').classList.add('hidden'));

    // Açılışta ana sürece de gönder (kalıcılık + senkron)
    push(true);
  }

  init();
})();
