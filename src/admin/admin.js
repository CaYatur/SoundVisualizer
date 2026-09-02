'use strict';
/* Yönetici paneli mantığı: şema tabanlı kontrol üretimi, ekran yönetimi,
   canlı seviye göstergesi ve görselleştiriciye anlık yapılandırma gönderimi. */
(function () {
  let cfg = window.SV.defaultConfig();
  let displays = [];
  let selectedDisplayIds = []; // görselleştirmenin açılacağı ekranlar (çoklu)
  let visOpen = false;
  let audioDevices = [];
  let lightingInfo = { ok: true, supported: false, devices: [] };
  let lightingAvailability = { ok: true, devices: [], availableCount: 0, totalCount: 0 };
  let lightingIdentity = { portable: false, packaged: false, hasIdentity: false, canInstall: false };
  let pushTimer = null;

  // Arayüz durumu (yapılandırmaya değil, yerel depolamaya yazılır)
  let activeCategory = localStorage.getItem('sv-category') || 'scene';
  let advancedOn = localStorage.getItem('sv-advanced') === '1';
  let activeSceneId = null;
  let sceneActionInFlight = false; // sahne uygula/kaydet sırasındaki push'lar vurguyu silmesin
  // Önizlemenin gerçek sesi yakalaması kullanıcı isteğine bağlıdır (varsayılan: demo)
  let previewWantsLive = localStorage.getItem('sv-preview-live') === '1';
  let previewReady = false;
  // Genişletilmiş aralıklar: kaydırıcıların üst sınırını 5 katına çıkarır
  let extendedRange = localStorage.getItem('sv-extended-range') === '1';
  const RANGE_FACTOR = 5;

  // Etkin sahne vurgusunu kaldır (tam yeniden çizim gerektirmez)
  function clearActiveScene() {
    activeSceneId = null;
    document
      .querySelectorAll('#sceneList .scene-item.active, .up-item.active')
      .forEach((n) => n.classList.remove('active'));
  }

  // Video dışa aktarma durumu
  let exportAudioPath = null;
  let exportAudioName = '';
  let exporting = false;
  let gpuAvailable = false;

  const $ = (id) => document.getElementById(id);

  // --------------------------------------------------------------------------
  // Yapılandırma gönderimi (debounce)
  // --------------------------------------------------------------------------
  function push(immediate) {
    // Görünüm sahneden uzaklaştıysa "etkin sahne" vurgusu yanıltıcı olur, kaldır
    if (activeSceneId && !sceneActionInFlight) clearActiveScene();
    // Her yapılandırma değişikliği paneldeki canlı önizlemeye de yansır
    if (window.SVPreview) window.SVPreview.setConfig(cfg);
    // "Varsayılandan farklı" noktaları ve sayaçları anında güncelle
    // (kategori değiştirip dönmeyi beklemeden)
    refreshModifiedMarks();
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
  // Uygulama içi onay ve bildirim
  //
  // window.confirm / window.alert renderer iş parçacığını tamamen kilitler:
  // canlı önizleme durur, panel donar ve çok ekranlı kurulumlarda sistem
  // penceresi başka bir ekranda ya da pencerenin arkasında açılabildiği için
  // kullanıcı "uygulama çöktü, işlem de yapılmadı" durumuyla karşılaşır.
  // Bu yüzden onay ve bildirimler panelin kendi içinde, bloke etmeden gösterilir.
  // --------------------------------------------------------------------------
  function svConfirm(message, opts) {
    return new Promise((resolve) => {
      const o = opts || {};
      const close = (value) => {
        document.removeEventListener('keydown', onKey, true);
        backdrop.remove();
        resolve(value);
      };
      const onKey = (e) => {
        if (e.key === 'Escape') { e.preventDefault(); close(false); }
        else if (e.key === 'Enter') { e.preventDefault(); close(true); }
      };

      const okBtn = el('button', {
        class: 'btn ' + (o.danger ? 'danger' : 'primary'),
        type: 'button',
        text: o.okText || 'Evet, devam et',
        onclick: () => close(true),
      });
      const cancelBtn = el('button', {
        class: 'btn ghost', type: 'button', text: 'Vazgeç', onclick: () => close(false),
      });

      const backdrop = el('div', { class: 'ask-backdrop' }, [
        el('div', { class: 'ask-panel', role: 'dialog', 'aria-modal': 'true' }, [
          el('div', { class: 'ask-title', text: o.title || 'Emin misiniz?' }),
          el('div', { class: 'ask-text', text: message }),
          el('div', { class: 'ask-actions' }, [cancelBtn, okBtn]),
        ]),
      ]);
      backdrop.addEventListener('mousedown', (e) => {
        if (e.target === backdrop) close(false);
      });
      document.body.appendChild(backdrop);
      document.addEventListener('keydown', onKey, true);
      okBtn.focus();
    });
  }

  let toastTimer = null;
  function svToast(message, kind) {
    let host = $('toast');
    if (!host) {
      host = el('div', { class: 'toast hidden', id: 'toast' });
      document.body.appendChild(host);
    }
    host.textContent = message;
    host.className = 'toast' + (kind ? ' ' + kind : '');
    if (toastTimer) clearTimeout(toastTimer);
    toastTimer = setTimeout(() => host.classList.add('hidden'), 4200);
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
  // Panel API'si
  //
  // Studio, yayın, kontrol yüzeyi ve sahne üretici panelleri ayrı dosyalarda
  // duruyor (admin.js zaten büyük). Hepsi aynı yapılandırma nesnesini ve aynı
  // gönderim mantığını kullanmak zorunda; bu yüzden ortak yüzey burada tek
  // yerden veriliyor. Panel dosyaları admin.js'ten ÖNCE yüklenir ama API'yi
  // ancak çizim anında kullanır.
  // --------------------------------------------------------------------------
  window.SVPanel = {
    el,
    cfg: () => cfg,
    push,
    rerender: () => render(),
    // Yeniden çiz ve ardından gönder. Paneller çizim sırasında bağımlı
    // alanları düzeltebildiği için sıra bu şekilde olmalı.
    apply: () => { render(); push(true); },
    toast: svToast,
    confirm: svConfirm,
    get: (p) => getPath(cfg, p),
    set: (p, v) => setPath(cfg, p, v),

    // Sık kullanılan satır üreticileri — panellerin görünümü kartlarla aynı kalsın
    row(labelText, node) {
      return el('div', { class: 'ctrl' }, [
        el('div', { class: 'row' }, [el('label', { class: 'lbl', text: labelText }), node]),
      ]);
    },
    slider(labelText, path, opts) {
      const o = opts || {};
      return sliderCtrl({
        label: labelText, path,
        min: o.min == null ? 0 : o.min,
        max: o.max == null ? 1 : o.max,
        step: o.step == null ? 0.01 : o.step,
        percent: o.percent, fmt: o.fmt, noExtend: o.noExtend,
      });
    },
    toggle(labelText, path, opts) {
      const o = opts || {};
      return toggleCtrl({ label: labelText, path, rebuild: o.rebuild });
    },
    select(labelText, path, options, opts) {
      const o = opts || {};
      return selectCtrl({ label: labelText, path, options, rebuild: o.rebuild });
    },
    segment(labelText, path, options, opts) {
      const o = opts || {};
      return segmentCtrl({ label: labelText, path, options, rebuild: o.rebuild });
    },
    color(labelText, path) {
      return colorCtrl({ label: labelText, path });
    },
  };


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
      case 'userpresets':
        return userPresetsCtrl(def);
      case 'bgio':
        return bgIoCtrl(def);
      case 'settingsio':
        return settingsIoCtrl(def);
      case 'images':
        return imagesCtrl(def);
      case 'logofile':
        return logoFileCtrl(def);
      case 'xy':
        return xyCtrl(def);
      case 'button':
        return buttonCtrl(def);
      case 'multisource':
        return multisourceCtrl(def);
      case 'audiofile':
        return audioFileCtrl(def);
      case 'exportpanel':
        return exportPanelCtrl(def);
      case 'lightingpanel':
        return lightingPanelCtrl(def);
      case 'streampanel':
        return window.SVStream ? window.SVStream.panel() : null;
      case 'studiopanel':
        return window.SVStudio ? window.SVStudio.panel() : null;
      case 'controlpanel':
        return window.SVControl ? window.SVControl.panel(def.surface) : null;
      case 'mediapanel':
        return window.SVMediaPanel ? window.SVMediaPanel.panel() : null;
      case 'scenegen':
        return window.SVSceneGen ? window.SVSceneGen.panel() : null;
      case 'custompicker':
        return window.SVStudio ? window.SVStudio.picker(def.kind) : null;
      case 'layerspanel':
        return window.SVScenePanels ? window.SVScenePanels.layersPanel() : null;
      case 'effectspanel':
        return window.SVScenePanels ? window.SVScenePanels.effectsPanel() : null;
      case 'geometrypanel':
        return window.SVScenePanels ? window.SVScenePanels.geometryPanel() : null;
      case 'artnetpanel':
        return window.SVScenePanels ? window.SVScenePanels.artnetPanel() : null;
      case 'autovjpanel':
        return window.SVAutoVJ ? window.SVAutoVJ.panel() : null;
      case 'modulationpanel':
        return window.SVModulationPanel ? window.SVModulationPanel.panel() : null;
      case 'analysispanel':
        return window.SVAnalysisPanel ? window.SVAnalysisPanel.panel() : null;
      case 'transitionpanel':
        return window.SVTransitionPanel ? window.SVTransitionPanel.panel() : null;
      case 'mappingpanel':
        return window.SVMappingPanel ? window.SVMappingPanel.panel() : null;
      case 'milkdroppanel':
        return window.SVMilkdropPanel ? window.SVMilkdropPanel.panel() : null;
      case 'recordpanel':
        return window.SVRecordPanel ? window.SVRecordPanel.panel() : null;
      case 'templatepanel':
        return window.SVTemplatePanel ? window.SVTemplatePanel.panel() : null;
      case 'textpanel':
        return window.SVTextPanel ? window.SVTextPanel.panel() : null;
      case 'note':
        return el('div', { class: 'ctrl settings-io-note', text: def.text });
      case 'scenes':
        return scenesCtrl(def);
      case 'displaypicker':
        return displayPickerCtrl(def);
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

  // Genişletilmiş aralık açıkken üst sınır 5 katına çıkar. Algoritmanın
  // matematiği tarafından gerçekten sınırlanan ayarlar (noExtend) hariç tutulur;
  // örneğin yumuşatma 1'e ulaşırsa sinyal tamamen donar.
  function sliderMax(def) {
    if (!extendedRange || def.noExtend) return def.max;
    return def.max * RANGE_FACTOR;
  }

  function sliderCtrl(def) {
    const valSpan = el('span', { class: 'val' });
    const setText = (v) => (valSpan.textContent = fmtVal(def, v));
    const cur = getPath(cfg, def.path);
    setText(cur);
    const max = sliderMax(def);
    const input = el('input', {
      type: 'range',
      min: def.min,
      // Kayıtlı değer sınırın üstündeyse (aralık sonradan kapatıldıysa)
      // kaydırıcı onu kırpmasın
      max: Math.max(max, typeof cur === 'number' ? cur : max),
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
        // Sıra önemli: render() panel gövdelerinin bağımlı alanları
        // normalleştirmesine izin verir, push() sonuçta oluşan tutarlı
        // yapılandırmayı gönderir.
        if (def.rebuild) render();
        push(true);
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
      // { group: 'Başlık' } girdileri seçenek değil, ayırıcı başlıktır
      if (o.group) { seg.appendChild(el('div', { class: 'seg-group', text: o.group })); return; }
      const b = el('button', {
        class: cur === o.value ? 'active' : '',
        text: o.label,
        onclick: () => {
          setPath(cfg, def.path, o.value);
          render();
          push(true);
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
        if (def.rebuild) render();
        push(true);
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
    const current = (cfg.background.gradient.colors || []).map((c) => String(c).toLowerCase()).join(',');
    window.SV.GRADIENT_PRESETS.forEach((p) => {
      // 'group' taşıyan girdi aynı zamanda bir şablondur; başlık onun önüne gelir
      if (p.group) grid.appendChild(el('div', { class: 'preset-group', text: p.group }));
      const swatch = el('div', { class: 'swatch' });
      swatch.style.background = `linear-gradient(90deg, ${p.colors.join(',')})`;
      const active = p.colors.map((c) => String(c).toLowerCase()).join(',') === current;
      const card = el('div', { class: 'preset' + (active ? ' active' : ''), onclick: () => {
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

  // --- Kullanıcı renk şablonları (kaydet/yeniden adlandır/güncelle/sil + içe/dışa) ---
  function userPresetsCtrl() {
    if (!Array.isArray(cfg.userPresets)) cfg.userPresets = [];
    const wrap = el('div', { class: 'ctrl' });
    wrap.appendChild(el('label', { class: 'lbl', text: 'Kendi Şablonlarım' }));

    const list = el('div', { class: 'user-presets' });
    if (!cfg.userPresets.length) {
      list.appendChild(el('div', { class: 'up-empty', text: 'Henüz şablon yok. Aşağıdaki renkleri ayarlayıp “Mevcut Renkleri Kaydet”e basın.' }));
    }
    cfg.userPresets.forEach((p) => {
      const swatch = el('div', { class: 'up-swatch' });
      swatch.style.background = `linear-gradient(90deg, ${(p.colors || []).join(',')})`;
      swatch.title = 'Uygula';
      swatch.addEventListener('click', () => actions.applyUserPreset(p.id));

      const nameInput = el('input', {
        type: 'text', class: 'up-name', value: p.name || 'Şablon',
        onchange: (e) => { p.name = e.target.value.trim() || 'Şablon'; push(true); },
      });

      const applyBtn = el('button', { class: 'btn ghost small', text: 'Uygula', onclick: () => actions.applyUserPreset(p.id) });
      const updateBtn = el('button', { class: 'btn ghost small', text: '⟳ Güncelle', title: 'Mevcut renklerle güncelle', onclick: () => actions.updateUserPreset(p.id) });
      const delBtn = el('button', { class: 'btn ghost small danger', text: '🗑', title: 'Sil', onclick: () => actions.deleteUserPreset(p.id) });

      const row = el('div', { class: 'up-item' }, [
        swatch,
        el('div', { class: 'up-main' }, [nameInput, el('div', { class: 'up-actions' }, [applyBtn, updateBtn, delBtn])]),
      ]);
      list.appendChild(row);
    });
    wrap.appendChild(list);

    const saveBtn = el('button', { class: 'btn ghost small', text: '💾 Mevcut Renkleri Kaydet', onclick: () => actions.saveCurrentPreset() });
    const expBtn = el('button', { class: 'btn ghost small', text: '📤 Dışa Aktar', onclick: () => actions.exportPresets() });
    const impBtn = el('button', { class: 'btn ghost small', text: '📥 İçe Aktar', onclick: () => actions.importPresets() });
    const bar = el('div', { class: 'up-toolbar' }, [saveBtn, expBtn, impBtn]);
    wrap.appendChild(bar);
    return wrap;
  }

  // --- Arkaplan ayarlarını içe/dışa aktarma ---
  function bgIoCtrl() {
    const expBtn = el('button', { class: 'btn ghost small', text: '📤 Arkaplanı Dışa Aktar', onclick: () => actions.exportBackground() });
    const impBtn = el('button', { class: 'btn ghost small', text: '📥 Arkaplanı İçe Aktar', onclick: () => actions.importBackground() });
    return el('div', { class: 'ctrl' }, [
      el('label', { class: 'lbl', text: 'Arkaplan Ayarları (dosya)' }),
      el('div', { class: 'up-toolbar' }, [expBtn, impBtn]),
    ]);
  }

  // --- Tüm ayarları içe/dışa aktarma (renk şablonları hariç) ---
  function settingsIoCtrl() {
    const expBtn = el('button', { class: 'btn ghost small', text: '📤 Tüm Ayarları Dışa Aktar', onclick: () => actions.exportAllSettings() });
    const impBtn = el('button', { class: 'btn ghost small', text: '📥 Ayarları İçe Aktar', onclick: () => actions.importAllSettings() });
    return el('div', { class: 'ctrl settings-io-panel' }, [
      el('div', { class: 'settings-io-note', text: 'Ses, görünüm, Dynamic Lighting, performans, logo, görsel nesneler ve video dışa aktarma ayarlarını JSON dosyasına kaydeder. Renk şablonlarınız ve sahneleriniz dosyaya dahil edilmez ve içe aktarma sırasında korunur; onların kendi dışa aktarma düğmeleri vardır.' }),
      el('div', { class: 'up-toolbar' }, [expBtn, impBtn]),
    ]);
  }

  // --- Sahneler (tüm görünümün anlık görüntüsü) ---
  // Bir sahne yalnızca "görünüm" alanlarını taşır; ses aygıtı, ekran, performans
  // ve dışa aktarma ayarları sahneden bağımsızdır.
  const SCENE_KEYS = ['background', 'visualizer', 'logo', 'images'];

  function sceneGradient(scene) {
    const bg = scene && scene.data && scene.data.background;
    if (!bg) return 'linear-gradient(135deg,#2a1f2e,#161013)';
    if (bg.type === 'solid') return bg.solidColor || '#08080f';
    const cols = (bg.gradient && bg.gradient.colors) || [];
    if (!cols.length) return 'linear-gradient(135deg,#2a1f2e,#161013)';
    return 'linear-gradient(135deg,' + cols.join(',') + ')';
  }

  function sceneSummary(scene) {
    const d = (scene && scene.data) || {};
    const type = (d.visualizer && d.visualizer.type) || 'none';
    const names = {
      none: 'Kapalı', bars: 'Barlar', centerBars: 'Merkez', blocks: 'Segment',
      dots: 'Nokta Matris', wave: 'Dalga', ribbon: 'Şerit', terrain: 'Arazi',
      circular: 'Çember', radialWave: 'Dairesel Dalga', starburst: 'Işın',
      tunnel: 'Tünel', orb: 'Küre', particles: 'Parçacık', spectrogram: 'Spektrogram',
    };
    const parts = [names[type] || type];
    if (d.logo && d.logo.enabled) parts.push('Logo');
    if (d.images && d.images.enabled && (d.images.items || []).length) parts.push('Nesneler');
    // Birleştirilmiş metin çeviri gözlemcisiyle eşleşmeyeceği için parçalar
    // birleştirilmeden önce çevrilir
    return parts.map(tr).join(' · ');
  }

  function scenesCtrl() {
    ensureScenes();
    const list = el('div', { class: 'user-presets' });
    if (!cfg.scenes.length) {
      list.appendChild(
        el('div', {
          class: 'up-empty',
          text: 'Henüz sahne yok. Beğendiğiniz görünümü ayarlayıp “Mevcut Görünümü Kaydet”e basın; daha sonra tek tıkla geri dönersiniz.',
        })
      );
    }
    cfg.scenes.forEach((sc) => {
      const swatch = el('div', {
        class: 'up-swatch',
        title: 'Bu sahneyi uygula',
        style: 'background:' + sceneGradient(sc),
        onclick: () => actions.applyScene(sc.id),
      });
      const name = el('input', {
        class: 'up-name', type: 'text', value: sc.name || 'Sahne', title: 'Sahne adı',
      });
      name.addEventListener('change', () => actions.renameScene(sc.id, name.value));
      const applyBtn = el('button', { class: 'btn small', text: 'Uygula', onclick: () => actions.applyScene(sc.id) });
      const updBtn = el('button', { class: 'btn ghost small', text: '⟳ Güncelle', title: 'Mevcut görünümle güncelle', onclick: () => actions.updateScene(sc.id) });
      const delBtn = el('button', { class: 'btn ghost small danger', text: '🗑', title: 'Sil', onclick: () => actions.deleteScene(sc.id) });
      list.appendChild(
        el('div', { class: 'up-item' + (sc.id === activeSceneId ? ' active' : '') }, [
          swatch,
          el('div', { class: 'up-main' }, [
            name,
            el('div', { class: 'scene-meta', text: sceneSummary(sc) }),
            el('div', { class: 'up-actions' }, [applyBtn, updBtn, delBtn]),
          ]),
        ])
      );
    });

    const toolbar = el('div', { class: 'up-toolbar' }, [
      el('button', { class: 'btn small', text: '💾 Mevcut Görünümü Kaydet', onclick: () => actions.saveScene() }),
      el('button', { class: 'btn ghost small', text: '📤 Dışa Aktar', onclick: () => actions.exportScenes() }),
      el('button', { class: 'btn ghost small', text: '📥 İçe Aktar', onclick: () => actions.importScenes() }),
    ]);

    return el('div', { class: 'ctrl' }, [list, toolbar]);
  }

  // --- Ekran seçici (üst çubuktakiyle aynı listeyi kart içinde gösterir) ---
  function displayPickerCtrl() {
    const wrap = el('div', { class: 'ctrl' });
    const list = el('div', { class: 'source-list' });
    displays.forEach((d) => {
      const box = el('input', {
        type: 'checkbox',
        onchange: (e) => {
          if (e.target.checked) {
            if (selectedDisplayIds.indexOf(d.id) === -1) selectedDisplayIds.push(d.id);
          } else {
            selectedDisplayIds = selectedDisplayIds.filter((x) => x !== d.id);
          }
          syncSelectedDisplays();
          push(false);
          renderDisplays();
          render();
          if (visOpen) window.api.openVisualizer(selectedDisplayIds);
        },
      });
      box.checked = selectedDisplayIds.indexOf(d.id) >= 0;
      const row = el('label', { class: 'source-item' }, [
        box,
        el('span', { class: 'source-icon', text: d.isPrimary ? '🖥️' : '🖵' }),
        el('span', { class: 'source-name', text: `${d.label} — ${d.size.width}×${d.size.height}` }),
      ]);
      list.appendChild(row);
    });
    wrap.appendChild(list);
    wrap.appendChild(
      el('div', { class: 'settings-io-note', style: 'margin-top:10px', text: 'Seçtiğiniz her ekranda ayrı bir tam ekran görselleştirme açılır. ESC hepsini kapatır.' })
    );
    return wrap;
  }

  // --- Ek görsel nesneler / partiküller yöneticisi ---
  const MOTION_OPTS = [
    { value: 'static', label: 'Sabit' },
    { value: 'float', label: 'Süzülme' },
    { value: 'orbit', label: 'Yörünge' },
    { value: 'swirl', label: 'Girdap' },
    { value: 'scatter', label: 'Saçılma (sese)' },
    { value: 'rise', label: 'Yükselme' },
    { value: 'fall', label: 'Düşme' },
  ];
  const BLEND_OPTS = [
    { value: 'normal', label: 'Normal' },
    { value: 'screen', label: 'Ekran (parlak)' },
    { value: 'add', label: 'Toplama (ışıltı)' },
  ];
  const LAYER_OPTS = [
    { value: 'front', label: 'Önde' },
    { value: 'back', label: 'Arkada' },
  ];

  function imagesCtrl() {
    if (!cfg.images) cfg.images = { enabled: false, items: [] };
    if (!Array.isArray(cfg.images.items)) cfg.images.items = [];
    const wrap = el('div', {});

    const items = cfg.images.items;
    if (!items.length) {
      wrap.appendChild(el('div', { class: 'up-empty', text: 'Görsel eklemek için aşağıdaki düğmeyi kullanın. Her görsel için çok sayıda kopya (partikül) sahnede gezinir/saçılır.' }));
    }

    items.forEach((it, idx) => {
      const base = 'images.items.' + idx + '.';
      const thumb = el('img', { class: 'img-thumb' });
      if (it.src) thumb.src = it.src;

      const nameInput = el('input', {
        type: 'text', class: 'up-name', value: it.name || 'Görsel',
        onchange: (e) => { it.name = e.target.value.trim() || 'Görsel'; push(true); },
      });
      const delBtn = el('button', { class: 'btn ghost small danger', text: '🗑 Kaldır', onclick: () => actions.removeImage(it.id) });
      const replaceBtn = el('button', { class: 'btn ghost small', text: '🖼 Değiştir', onclick: () => actions.replaceImage(it.id) });

      const head = el('div', { class: 'img-head' }, [
        thumb,
        el('div', { class: 'img-headmain' }, [nameInput, el('div', { class: 'up-actions' }, [replaceBtn, delBtn])]),
      ]);

      const body = el('div', { class: 'img-body' });
      const add = (c) => { const e = buildControl(c); if (e) body.appendChild(e); };
      add({ type: 'select', path: base + 'motion', label: 'Hareket', options: MOTION_OPTS, rebuild: false });
      add({ type: 'slider', path: base + 'count', label: 'Kopya Sayısı', min: 1, max: 200, step: 1 });
      add({ type: 'slider', path: base + 'size', label: 'Boyut', min: 0.01, max: 0.4, step: 0.005, percent: true });
      add({ type: 'slider', path: base + 'sizeVar', label: 'Boyut Çeşitliliği', min: 0, max: 0.95, step: 0.05, percent: true });
      add({ type: 'slider', path: base + 'opacity', label: 'Saydamlık', min: 0, max: 1, step: 0.02, percent: true });
      add({ type: 'slider', path: base + 'spread', label: 'Yayılma / Alan', min: 0, max: 2, step: 0.05 });
      add({ type: 'slider', path: base + 'speed', label: 'Hız', min: 0, max: 2, step: 0.05 });
      add({ type: 'slider', path: base + 'spin', label: 'Dönüş', min: 0, max: 2, step: 0.05 });
      add({ type: 'slider', path: base + 'audioSize', label: 'Ses → Boyut', min: 0, max: 2, step: 0.05 });
      add({ type: 'slider', path: base + 'audioSpeed', label: 'Ses → Hız', min: 0, max: 2, step: 0.05 });
      add({ type: 'slider', path: base + 'audioOpacity', label: 'Ses → Saydamlık', min: 0, max: 2, step: 0.05 });
      add({ type: 'slider', path: base + 'glow', label: 'Parlama', min: 0, max: 1, step: 0.02, percent: true });
      add({ type: 'select', path: base + 'blend', label: 'Karışım', options: BLEND_OPTS });
      add({ type: 'select', path: base + 'layer', label: 'Katman', options: LAYER_OPTS });
      add({ type: 'toggle', path: base + 'noOverlap', label: 'Üst Üste Binmeyi Engelle', rebuild: false });
      add({ type: 'slider', path: base + 'minDist', label: 'Minimum Mesafe (boyut çarpanı)', min: 0.5, max: 3.0, step: 0.05 });

      wrap.appendChild(el('div', { class: 'img-card' }, [head, body]));
    });

    const addBtn = el('button', { class: 'btn ghost small', text: '➕ Görsel Ekle', onclick: () => actions.addImage() });
    wrap.appendChild(el('div', { class: 'up-toolbar' }, [addBtn]));
    return el('div', { class: 'ctrl' }, [wrap]);
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

  // --- Video dışa aktarma: ses dosyası seçici ---
  function audioFileCtrl() {
    const name = el('div', {
      class: 'export-filename',
      id: 'exportAudioName',
      text: exportAudioName || 'Henüz dosya seçilmedi',
    });
    const btn = el('label', { class: 'filebtn', text: '🎵  Ses Dosyası Seç (MP3 / WAV / FLAC)' });
    btn.addEventListener('click', async () => {
      if (exporting) return;
      const p = await window.api.pickExportAudio();
      if (p) {
        exportAudioPath = p;
        exportAudioName = p.split(/[\\/]/).pop();
        name.textContent = exportAudioName;
      }
    });
    return el('div', { class: 'ctrl' }, [btn, name]);
  }

  // --- Video dışa aktarma: çalıştır düğmesi + ilerleme ---
  function exportPanelCtrl() {
    const runBtn = el('button', {
      class: 'btn primary', id: 'exportRunBtn', text: '🎬 Videoya Aktar',
      onclick: () => actions.runExport(),
    });
    const cancelBtn = el('button', {
      class: 'btn ghost small', id: 'exportCancelBtn', text: '■ İptal',
      onclick: () => window.api.cancelExport(),
    });
    cancelBtn.style.display = 'none';
    cancelBtn.style.marginLeft = '8px';

    const fill = el('i', { id: 'exportProgressFill' });
    const bar = el('div', { class: 'export-progress', id: 'exportProgressBar' }, [fill]);
    bar.style.display = 'none';

    const status = el('div', { class: 'export-status', id: 'exportStatus' });

    return el('div', { class: 'ctrl' }, [
      el('div', { class: 'row' }, [runBtn, cancelBtn]),
      bar,
      status,
    ]);
  }

  // --------------------------------------------------------------------------
  function lightingPanelCtrl() {
    const lighting = cfg.lighting || (cfg.lighting = window.SV.defaultConfig().lighting);
    const devices = Array.isArray(lightingInfo.devices) ? lightingInfo.devices : [];
    const available = !!lightingInfo.supported && devices.length > 0;
    const apply = (rebuild = false) => {
      push(rebuild);
      if (rebuild) render();
    };

    const statusText = !lightingInfo.supported
      ? 'Bu Windows sürümünde Dynamic Lighting desteklenmiyor.'
      : available
        ? ''
        : 'Uyumlu Dynamic Lighting aygıtı bulunamadı.';
    const resolvedStatusText = available ? '✓ ' + devices.length + ' uyumlu aydınlatma aygıtı bulundu' : statusText;
    const status = el('div', { class: available ? 'lighting-status ok' : 'lighting-status', text: resolvedStatusText });

    const enabledInput = el('input', {
      type: 'checkbox',
      onchange: (e) => {
        lighting.enabled = available && e.target.checked;
        apply(true);
      },
    });
    enabledInput.checked = available && !!lighting.enabled;
    enabledInput.disabled = !available;

    const enabledRow = el('div', { class: 'ctrl' }, [
      el('div', { class: 'row' }, [
        el('label', { class: 'lbl', text: 'Windows Dynamic Lighting Etkin' }),
        el('label', { class: 'switch' }, [enabledInput, el('span', { class: 'track' })]),
      ]),
    ]);

    const refreshBtn = el('button', {
      class: 'btn ghost small',
      text: '🔄 Aydınlatma Aygıtlarını Tara',
      onclick: async () => {
        lightingInfo = await window.api.scanLighting();
        if (!lightingInfo.devices?.length) lighting.enabled = false;
        push(true);
        render();
      },
    });

    const identityText = lightingIdentity.portable
      ? 'Portable sürüm yalnızca CAYADEV Visualizer odaktayken aydınlatmayı kontrol eder.'
      : lightingIdentity.hasIdentity
        ? '✓ Arka plan Dynamic Lighting kimliği hazır'
        : lightingIdentity.packaged
          ? 'Arka plan kimliği bulunamadı; ön plan kontrolü kullanılabilir.'
          : 'Geliştirme modunda yalnızca ön plan kontrolü kullanılabilir.';
    const identityStatus = el('div', {
      class: !lightingIdentity.portable && lightingIdentity.hasIdentity ? 'lighting-status ok' : 'lighting-status',
      text: identityText,
    });

    const controlTotal = Number(lightingAvailability.totalCount) || devices.length;
    const controlAvailable = Number(lightingAvailability.availableCount) || 0;
    const controlGranted = controlTotal > 0 && controlAvailable === controlTotal;
    const controlText = !lighting.enabled
      ? (lightingIdentity.portable
        ? 'Ön plan kontrol durumu, Dynamic Lighting etkinleştirildiğinde izlenir.'
        : 'Arka plan kontrol durumu, Dynamic Lighting etkinleştirildiğinde izlenir.')
      : controlGranted
        ? '✓ Windows ' + controlAvailable + '/' + controlTotal + ' aygıt için kontrol verdi'
        : lightingIdentity.portable
          ? '⚠ Portable sürüm yalnızca uygulama odaktayken kontrol eder (' + controlAvailable + '/' + controlTotal + ').'
          : '⚠ Windows arka plan kontrolünü vermedi (' + controlAvailable + '/' + controlTotal + '). Dynamic Lighting ayarlarında CAYADEV Visualizer uygulamasını listenin en üstüne taşıyın.';
    const controlStatus = el('div', {
      class: lighting.enabled && controlGranted ? 'lighting-status ok' : 'lighting-status',
      text: controlText,
    });

    const settingsBtn = el('button', {
      class: 'btn ghost small',
      text: '⚙ Windows Dynamic Lighting Ayarları',
      onclick: () => window.api.openDynamicLightingSettings(),
    });
    const priorityNote = el('div', {
      class: 'lighting-priority-note',
      text: lightingIdentity.portable
        ? 'Not: Portable sürüm yalnızca uygulama odaktayken aydınlatmayı kontrol eder. Başka uygulamalara geçtiğinizde de kontrolün sürmesi gerekiyorsa installer sürümünü kullanın.'
        : 'Not: Arka planda kontrolün sürmesi için Windows Dynamic Lighting > Arka plan ışık denetimi bölümünde CAYADEV Visualizer uygulamasını listenin en üstüne taşıyın. Başka bir uygulama yine kontrolü alıyorsa “Ön plandaki uyumlu uygulamalar her zaman aydınlatmayı denetler” seçeneğini kapatın.',
    });

    const children = [
      status,
      identityStatus,
      controlStatus,
      priorityNote,
      enabledRow,
      el('div', { class: 'ctrl lighting-actions' }, [refreshBtn, settingsBtn]),
    ];
    if (!available || !lighting.enabled) return el('div', { class: 'lighting-panel' }, children);

    const MODE_OPTIONS = [
      { value: 'visualizer-sync', label: 'Görselleştirici Renk Akışı', desc: 'Görselleştiricinin bar renklerini aygıt ve LED’lere yayar.' },
      { value: 'spectrum-bars', label: 'Bar Spektrum Eşleme', desc: 'Her LED’i karşılık gelen frekans barının rengi ve yüksekliğiyle sürer.' },
      { value: 'band-zones', label: 'Bas · Mid · Tiz Bölgeleri', desc: 'Bas, orta ve tiz frekanslarını ayrı renk bölgelerine böler.' },
      { value: 'background-sync', label: 'Arka Plan Işık Senkronu', desc: 'Arka plan gradyanının renk, akış ve ses tepkisini ışıklara taşır.' },
      { value: 'beat-pulse', label: 'Eşzamanlı Ritim Patlaması', desc: 'Seçilen frekans vuruşunda tüm aygıtları aynı tonda parlatır.' },
      { value: 'ripple', label: 'Frekans Dalga / Ripple', desc: 'Vuruşları LED dizileri boyunca hareket eden renk dalgalarına dönüştürür.' },
      { value: 'ambient-fusion', label: 'Bar + Arka Plan Füzyonu', desc: 'Bar spektrumu ile arka plan ışıklarını aynı anda karıştırır.' },
      { value: 'device-flow', label: 'Aygıtlar Arası Renk Akışı', desc: 'Renkleri tüm aygıt ve LED’ler boyunca kesintisiz dolaştırır.' },
      { value: 'rainbow', label: 'Rainbow Işık Akışı', desc: 'Gökkuşağı renklerini sıralı veya tüm LED’lerde tek ton olarak dolaştırır.' },
      { value: 'threshold-background-burst', label: 'Eşik Tetiklemeli Arka Plan Patlaması', desc: 'Yalnızca seçilen ses kaynağı eşiği geçtiğinde arka planın gerçek anlık rengiyle ışık darbesi üretir.' },
      { value: 'single-color', label: 'Tüm Aygıtlarda Tek Renk', desc: 'Bütün ışıklara tek sabit renk uygular.' },
      { value: 'per-device', label: 'Aygıt Başına Renk', desc: 'Her aydınlatma aygıtına ayrı renk atar.' },
      { value: 'per-led', label: 'LED / Bölge Başına Renk', desc: 'Her LED veya bölgeyi tek tek ayarlamanızı sağlar.' },
    ];

    const themedDropdown = (label, value, options, onChange, description = true) => {
      const selected = options.find((option) => String(option.value) === String(value)) || options[0];
      const menu = el('div', { class: 'lighting-select-menu' });
      const buttonText = el('span', { class: 'lighting-select-value', text: selected.label });
      const arrow = el('span', { class: 'lighting-select-arrow', text: '▾' });
      const button = el('button', { type: 'button', class: 'lighting-select-button' }, [buttonText, arrow]);
      const wrap = el('div', { class: 'lighting-select-wrap', tabIndex: 0 }, [button, menu]);
      const close = () => wrap.classList.remove('open');
      options.forEach((option) => {
        const item = el('button', {
          type: 'button',
          class: String(option.value) === String(value) ? 'lighting-select-option active' : 'lighting-select-option',
          onclick: (event) => {
            event.preventDefault();
            event.stopPropagation();
            close();
            onChange(option.value);
          },
        }, [
          el('span', { class: 'lighting-option-label', text: option.label }),
          description && option.desc ? el('span', { class: 'lighting-option-desc', text: option.desc }) : null,
        ].filter(Boolean));
        menu.appendChild(item);
      });
      button.onclick = (event) => {
        event.preventDefault();
        event.stopPropagation();
        wrap.classList.toggle('open');
      };
      wrap.onblur = () => setTimeout(close, 100);
      return el('div', { class: 'ctrl' }, [el('label', { class: 'lbl', text: label }), wrap]);
    };

    children.push(themedDropdown('Aydınlatma Modu', lighting.mode, MODE_OPTIONS, (value) => {
      lighting.mode = value;
      apply(true);
    }));

    const colorRow = (key, label) => {
      const input = el('input', {
        type: 'color', value: lighting[key],
        oninput: (e) => { lighting[key] = e.target.value; apply(false); },
      });
      return el('div', { class: 'ctrl' }, [el('div', { class: 'row' }, [el('label', { class: 'lbl', text: label }), input])]);
    };

    const rangeRow = (key, label, min, max, step, percent = false) => {
      const current = Number(lighting[key]);
      const value = el('span', { class: 'val', text: percent ? Math.round(current * 100) + '%' : String(current) });
      const input = el('input', {
        type: 'range', min, max, step, value: current,
        oninput: (e) => {
          lighting[key] = parseFloat(e.target.value);
          value.textContent = percent ? Math.round(lighting[key] * 100) + '%' : String(lighting[key]);
          apply(false);
        },
      });
      return el('div', { class: 'ctrl' }, [el('div', { class: 'row' }, [el('label', { class: 'lbl', text: label }), value]), input]);
    };

    const optionRow = (key, label, options) => themedDropdown(label, lighting[key], options, (value) => {
      lighting[key] = value;
      apply(true);
    }, false);

    const staticMode = ['single-color', 'per-device', 'per-led'].includes(lighting.mode);
    const dynamicMode = !staticMode;

    children.push(rangeRow('brightness', 'Genel Parlaklık', 0, 1, 0.01, true));

    if (lighting.mode === 'single-color') {
      children.push(colorRow('color', 'Tek Renk'));
    }

    if (dynamicMode) {
      children.push(el('div', { class: 'lighting-subtitle', text: 'Genel Dinamik Ayarlar' }));
      children.push(optionRow('layout', 'LED Yerleşimi', [
        { value: 'global', label: 'Tüm Aygıtlarda Kesintisiz' },
        { value: 'per-device', label: 'Her Aygıtta Baştan Başla' },
        { value: 'uniform', label: 'Tüm LED’lerde Aynı Ton' },
      ]));
      if (lighting.mode !== 'threshold-background-burst') {
        children.push(rangeRow('intensity', 'Ses Tepkisi', 0, 1, 0.01, true));
        children.push(rangeRow('smoothing', 'Yumuşatma', 0, 0.95, 0.01, true));
        children.push(rangeRow('baseLevel', 'Sessizlikte Işık', 0.02, 0.6, 0.01, true));
        children.push(rangeRow('spread', 'Renk Yayılımı', 0.1, 4, 0.05));
      }
      children.push(rangeRow('updateRate', 'Güncelleme Hızı', 5, 60, 1));
      children.push(rangeRow('saturation', 'Renk Doygunluğu', 0, 1.5, 0.01));
    }

    const paletteModes = ['visualizer-sync', 'spectrum-bars', 'beat-pulse', 'ripple', 'ambient-fusion', 'device-flow'];
    if (paletteModes.includes(lighting.mode)) {
      children.push(optionRow('paletteSource', 'Renk Kaynağı', [
        { value: 'visualizer', label: 'Görselleştirici Bar Renkleri' },
        { value: 'background', label: 'Arka Plan Gradyanı' },
        { value: 'bands', label: 'Bas · Mid · Tiz Renkleri' },
        { value: 'rainbow', label: 'Tam Spektrum Gökkuşağı' },
        { value: 'custom', label: 'Birincil · İkincil Renk' },
      ]));
    }

    if (lighting.paletteSource === 'custom' && paletteModes.includes(lighting.mode)) {
      children.push(colorRow('color', 'Birincil Renk'));
      children.push(colorRow('color2', 'İkincil Renk'));
    }

    const bandColorModes = ['spectrum-bars', 'band-zones', 'beat-pulse', 'ripple'];
    if (bandColorModes.includes(lighting.mode) || lighting.paletteSource === 'bands') {
      children.push(el('div', { class: 'lighting-subtitle', text: 'Frekans Renkleri ve Hassasiyet' }));
      children.push(colorRow('bassColor', 'Bas Rengi'));
      children.push(colorRow('midColor', 'Orta Frekans Rengi'));
      children.push(colorRow('trebleColor', 'Tiz Rengi'));
      children.push(rangeRow('bassGain', 'Bas Hassasiyeti', 0, 3, 0.05));
      children.push(rangeRow('midGain', 'Orta Frekans Hassasiyeti', 0, 3, 0.05));
      children.push(rangeRow('trebleGain', 'Tiz Hassasiyeti', 0, 3, 0.05));
      children.push(optionRow('bandResponse', 'Bant Tepki Profili', [
        { value: 'instant', label: 'Anlık / Katı' },
        { value: 'punchy', label: 'Vuruşlu / Sert' },
        { value: 'smooth', label: 'Yumuşak / Akıcı' },
      ]));
      if (lighting.bandResponse !== 'instant') {
        children.push(rangeRow('bandAttack', 'Bant Saldırı Hızı', 0.15, 1, 0.01, true));
        children.push(rangeRow('bandRelease', 'Bant Bırakma Hızı', 0.03, 0.65, 0.01, true));
      }
      children.push(rangeRow('bandThreshold', 'Bant Gürültü Eşiği', 0, 0.8, 0.01, true));
      children.push(rangeRow('bandHardness', 'Bant Sertliği', 0, 1, 0.01, true));
      children.push(rangeRow('bandSeparation', 'Bant Ayrıştırma', 0, 1, 0.01, true));
    }

    if (lighting.mode === 'visualizer-sync') {
      children.push(rangeRow('colorSpeed', 'Renk Akış Hızı', 0, 3, 0.02));
      children.push(rangeRow('audioAcceleration', 'Sesle Hızlanma', 0, 3, 0.05));
    }

    if (lighting.mode === 'spectrum-bars') {
      children.push(rangeRow('spectrumContrast', 'Bar Kontrastı', 0, 1, 0.01, true));
      children.push(el('div', { class: 'lighting-mode-help', text: 'Her LED, görselleştiricide aynı konuma denk gelen barın renk ve yüksekliğini kullanır. Bas solda, tiz sağda ilerler.' }));
    }

    if (lighting.mode === 'band-zones') {
      children.push(optionRow('bandPattern', 'Bant LED Deseni', [
        { value: 'zones', label: 'Bas · Mid · Tiz Bölgeleri' },
        { value: 'alternate', label: 'LED’lerde Sırayla Bas · Mid · Tiz' },
        { value: 'mirror', label: 'Merkezden Aynalı Dağılım' },
        { value: 'dominant', label: 'En Güçlü Bant Tüm LED’lerde' },
      ]));
      children.push(rangeRow('zoneBlend', 'Bölge Geçiş Yumuşaklığı', 0, 1, 0.01, true));
      children.push(el('div', { class: 'lighting-mode-help', text: 'LED dizisinin ilk kısmı bas, ortası mid ve son kısmı tiz frekanslarına ayrılır.' }));
    }

    if (lighting.mode === 'background-sync') {
      children.push(rangeRow('colorSpeed', 'Arka Plan Akış Çarpanı', 0, 3, 0.02));
      children.push(el('div', { class: 'lighting-mode-help', text: 'Arka planın seçili renk şablonu, akış hızı ve ses tepkisi aynı anda ışıklara taşınır.' }));
    }

    const flashModes = ['background-sync', 'beat-pulse', 'ripple', 'ambient-fusion', 'device-flow'];
    if (flashModes.includes(lighting.mode)) {
      children.push(el('div', { class: 'lighting-subtitle', text: 'Vuruş ve Işık Patlaması' }));
      children.push(optionRow('triggerBand', 'Patlamayı Tetikleyen Bant', [
        { value: 'bass', label: 'Bas' },
        { value: 'mid', label: 'Orta Frekans' },
        { value: 'treble', label: 'Tiz' },
        { value: 'level', label: 'Genel Ses Seviyesi' },
        { value: 'auto', label: 'En Güçlü Frekansı Otomatik Seç' },
      ]));
      children.push(rangeRow('flashThreshold', 'Patlama Eşiği', 0.02, 0.98, 0.01, true));
      children.push(rangeRow('flashStrength', 'Patlama Gücü', 0, 1.5, 0.01));
      children.push(rangeRow('flashDecay', 'Patlama Sönümleme', 0.45, 0.995, 0.005));
    }

    if (lighting.mode === 'ripple') {
      children.push(el('div', { class: 'lighting-subtitle', text: 'Dalga Hareketi' }));
      children.push(optionRow('rippleDirection', 'Dalga Yönü', [
        { value: 'forward', label: 'İleri' },
        { value: 'reverse', label: 'Geri' },
        { value: 'alternate', label: 'Her Vuruşta Yön Değiştir' },
      ]));
      children.push(rangeRow('rippleSpeed', 'Dalga Hızı', 0.05, 3, 0.05));
      children.push(rangeRow('rippleWidth', 'Dalga Genişliği', 0.03, 0.6, 0.01));
    }

    if (lighting.mode === 'ambient-fusion') {
      children.push(rangeRow('fusionMix', 'Arka Plan Karışım Oranı', 0, 1, 0.01, true));
      children.push(rangeRow('spectrumContrast', 'Bar Kontrastı', 0, 1, 0.01, true));
    }

    if (lighting.mode === 'device-flow') {
      children.push(rangeRow('flowSpeed', 'Aygıtlar Arası Akış Hızı', 0, 3, 0.02));
      children.push(rangeRow('audioAcceleration', 'Sesle Akış Hızlanması', 0, 3, 0.05));
    }

    if (lighting.mode === 'rainbow') {
      children.push(el('div', { class: 'lighting-subtitle', text: 'Rainbow Ayarları' }));
      children.push(optionRow('rainbowStyle', 'Rainbow Dağıtımı', [
        { value: 'ordered', label: 'LED’lerde Sıralı Gökkuşağı' },
        { value: 'single', label: 'Tüm LED’lerde Aynı Ton' },
      ]));
      children.push(optionRow('rainbowAudioBand', 'Parlaklığa Tepki Veren Ses', [
        { value: 'level', label: 'Genel Ses Seviyesi' },
        { value: 'bass', label: 'Bas' },
        { value: 'mid', label: 'Orta Frekans' },
        { value: 'treble', label: 'Tiz' },
        { value: 'auto', label: 'En Güçlü Frekans' },
      ]));
      children.push(rangeRow('rainbowSpeed', 'Rainbow Akış Hızı', 0.05, 3, 0.05));
      children.push(rangeRow('rainbowSpread', 'Rainbow Renk Yayılımı', 0.1, 4, 0.05));
      children.push(rangeRow('rainbowBaseBrightness', 'Rainbow Taban Parlaklığı', 0.02, 1, 0.01, true));
      children.push(rangeRow('rainbowAudioBrightness', 'Sese Göre Parlaklık Gücü', 0, 1.5, 0.01));
    }

    if (lighting.mode === 'threshold-background-burst') {
      children.push(el('div', { class: 'lighting-subtitle', text: 'Eşik Tetiklemeli Patlama Ayarları' }));
      children.push(optionRow('thresholdBurstSource', 'İzlenecek Tek Ses Kaynağı', [
        { value: 'bass', label: 'Bas' },
        { value: 'mid', label: 'Orta Frekans' },
        { value: 'treble', label: 'Tiz' },
        { value: 'level', label: 'Genel Ses Seviyesi' },
        { value: 'auto', label: 'En Güçlü Frekans' },
      ]));
      children.push(optionRow('thresholdBurstMode', 'Eşik Üstü Davranış', [
        { value: 'pulse', label: 'Yalnızca Darbe / Patlama' },
        { value: 'proportional', label: 'Eşik Üstünde Orantılı Parlama' },
        { value: 'hybrid', label: 'Darbe + Orantılı Parlama' },
      ]));
      children.push(rangeRow('thresholdBurstThreshold', 'Tetikleme Eşiği', 0.01, 0.99, 0.01, true));
      children.push(rangeRow('thresholdBurstStrength', 'Eşik Üstü Patlama Gücü', 0, 2, 0.01));
      children.push(rangeRow('thresholdBurstBaseBrightness', 'Eşik Altı Taban Işığı', 0, 0.5, 0.01, true));
      if (lighting.thresholdBurstMode !== 'proportional') {
        children.push(rangeRow('thresholdBurstDecay', 'Patlama Sönümleme', 0.45, 0.995, 0.005));
        children.push(rangeRow('thresholdBurstCooldown', 'Darbeler Arası Süre (ms)', 0, 1000, 10));
      }
      children.push(optionRow('thresholdBurstColorPosition', 'Arka Plan Renk Eşleme', [
        { value: 'source', label: 'Seçilen Frekans Bölgesinin Rengi' },
        { value: 'center', label: 'Arka Plan Merkez Rengi' },
        { value: 'spread', label: 'Arka Plan Renklerini LED’lere Yay' },
      ]));
      children.push(el('div', {
        class: 'lighting-mode-help',
        text: 'Seçilen kaynak eşik altında kaldığında yalnızca taban ışığı görünür. Eşik aşıldığında, aşma miktarı patlamanın parlaklığını ve beyaz vurgu oranını belirler.',
      }));
    }

    if (lighting.mode === 'per-device') {
      devices.forEach((device) => {
        const input = el('input', {
          type: 'color',
          value: lighting.deviceColors?.[device.id] || lighting.color,
          oninput: (e) => {
            lighting.deviceColors = lighting.deviceColors || {};
            lighting.deviceColors[device.id] = e.target.value;
            apply(false);
          },
        });
        children.push(el('div', { class: 'ctrl lighting-device' }, [
          el('div', { class: 'row' }, [
            el('label', { class: 'lbl', text: device.name + ' · ' + device.lampCount + ' LED' }), input,
          ]),
        ]));
      });
    } else if (lighting.mode === 'per-led') {
      lighting.deviceLedColors = lighting.deviceLedColors || {};
      devices.forEach((device) => {
        const stored = lighting.deviceLedColors[device.id] || [];
        const grid = el('div', { class: 'lighting-led-grid' });
        for (let index = 0; index < device.lampCount; index++) {
          const input = el('input', {
            type: 'color',
            title: device.name + ' · LED ' + (index + 1),
            value: stored[index] || lighting.deviceColors?.[device.id] || lighting.color,
            oninput: (e) => {
              const colors = lighting.deviceLedColors[device.id] || [];
              colors[index] = e.target.value;
              lighting.deviceLedColors[device.id] = colors;
              apply(false);
            },
          });
          grid.appendChild(el('label', { class: 'lighting-led', title: 'LED ' + (index + 1) }, [
            el('span', { text: String(index + 1) }), input,
          ]));
        }
        children.push(el('div', { class: 'ctrl lighting-device' }, [
          el('label', { class: 'lbl', text: device.name + ' · ' + device.lampCount + ' LED / bölge' }),
          grid,
        ]));
      });
    } else if (dynamicMode) {
      children.push(el('div', { class: 'lighting-devices', text: devices.map((device) => device.name + ' (' + device.lampCount + ' LED)').join(' • ') }));
    }

    return el('div', { class: 'lighting-panel' }, children);
  }

  // Kategoriler — sol raydaki üst düzey gruplar
  // --------------------------------------------------------------------------
  const CATEGORIES = [
    {
      id: 'scene', icon: '🎨', title: 'Sahne',
      desc: 'Ekranda görünen her şey: arkaplan, görselleştirici, logo ve görsel nesneler.',
    },
    {
      id: 'audio', icon: '🔊', title: 'Ses',
      desc: 'Hangi sesin yakalanacağı ve görüntüye nasıl çevrileceği.',
    },
    {
      id: 'lighting', icon: '💡', title: 'Işık',
      desc: 'Windows Dynamic Lighting ile uyumlu RGB aygıtlarını müzikle senkronize edin.',
    },
    {
      id: 'output', icon: '📺', title: 'Çıkış',
      desc: 'Görüntünün nereye ve nasıl gideceği: ekran, yayın, performans ve video dosyası.',
    },
    {
      id: 'control', icon: '🎛️', title: 'Kontrol',
      desc: 'MIDI denetleyicileri ve OSC ile ayarları canlı sürün.',
    },
    {
      id: 'studio', icon: '🧪', title: 'Studio',
      desc: 'Kendi görselleştiricini ve arkaplanını yap; içe/dışa aktar.',
    },
    {
      id: 'library', icon: '📚', title: 'Kitaplık',
      desc: 'Kayıtlı sahneler, renk şablonları ve ayar yedekleri.',
    },
  ];

  // Arkaplan modlarına özel ayarlar.
  // Her mod kendi ayar bloğunu (background.<mod>) taşır; yalnızca o mod
  // seçiliyken görünür. Yeni bir mod eklemek = buraya bir satır eklemek.
  // [yol, etiket, min, max, adım, yüzde mi]
  const BG_MODE_CONTROLS = {
    starfield: [
      ['count', 'Yıldız Sayısı', 40, 1200, 10],
      ['size', 'Yıldız Boyutu', 0.3, 3, 0.05],
      ['trail', 'Hız İzi', 0, 3, 0.05],
      ['depth', 'Derinlik', 0.4, 2.5, 0.05],
      ['twinkle', 'Parıldama', 0, 1, 0.02, true],
      ['bassPush', 'Bas İtkisi', 0, 6, 0.1],
    ],
    grid: [
      ['horizon', 'Ufuk Yüksekliği', 0.15, 0.85, 0.01, true],
      ['rows', 'Yatay Çizgi Sayısı', 4, 60, 1],
      ['cols', 'Dikey Çizgi Sayısı', 4, 80, 1],
      ['lineWidth', 'Çizgi Kalınlığı', 0.2, 4, 0.05],
      ['horizonGlow', 'Ufuk Parlaması', 0, 2, 0.02],
      ['skyIntensity', 'Gökyüzü Yoğunluğu', 0, 1.5, 0.02],
      ['spectrumBars', 'Spektrum Tepkisi', 0, 3, 0.05],
      ['bassPush', 'Bas İtkisi', 0, 6, 0.1],
    ],
    waves: [
      ['layers', 'Katman Sayısı', 1, 14, 1],
      ['amplitude', 'Tepe Yüksekliği', 0.2, 3, 0.05],
      ['frequency', 'Dalga Sıklığı', 0.2, 3, 0.05],
      ['spread', 'Katman Aralığı', 0.3, 2, 0.05],
      ['opacity', 'Saydamlık', 0.2, 1.5, 0.02],
      ['bassPush', 'Bas İtkisi', 0, 4, 0.05],
    ],
    bokeh: [
      ['count', 'Işık Sayısı', 4, 160, 1],
      ['size', 'Boyut', 0.2, 3, 0.05],
      ['sizeVar', 'Boyut Çeşitliliği', 0, 2, 0.05],
      ['drift', 'Süzülme', 0, 3, 0.05],
      ['pulse', 'Bas Nabzı', 0, 2, 0.02],
      ['opacity', 'Saydamlık', 0.2, 2, 0.02],
    ],
    rain: [
      ['columns', 'Sütun Sayısı', 10, 240, 2],
      ['speed', 'Düşme Hızı', 0.2, 4, 0.05],
      ['trail', 'İz Uzunluğu', 0.1, 3, 0.05],
      ['density', 'Yoğunluk', 0.1, 1, 0.02, true],
      ['thickness', 'Kalınlık', 0.2, 3, 0.05],
      ['bassPush', 'Bas İtkisi', 0, 4, 0.05],
    ],
    aurora: [
      ['bands', 'Perde Sayısı', 1, 12, 1],
      ['amplitude', 'Dalgalanma', 0.2, 3, 0.05],
      ['thickness', 'Perde Kalınlığı', 0.2, 3, 0.05],
      ['softness', 'Kenar Yumuşaklığı', 0.4, 3, 0.05],
      ['height', 'Dikey Konum', 0.1, 0.9, 0.01, true],
      ['bassPush', 'Bas İtkisi', 0, 4, 0.05],
    ],
    network: [
      ['nodes', 'Düğüm Sayısı', 8, 220, 2],
      ['linkDist', 'Bağlantı Mesafesi', 0.04, 0.5, 0.01],
      ['nodeSize', 'Düğüm Boyutu', 0.2, 4, 0.05],
      ['lineWidth', 'Çizgi Kalınlığı', 0.2, 4, 0.05],
      ['speed', 'Hareket Hızı', 0.1, 4, 0.05],
      ['bassPush', 'Bas İtkisi', 0, 4, 0.05],
    ],
    rings: [
      ['rate', 'Halka Sıklığı', 0.2, 10, 0.1],
      ['speed', 'Genişleme Hızı', 0.2, 4, 0.05],
      ['thickness', 'Kalınlık', 0.2, 4, 0.05],
      ['beatSpawn', 'Darbede Halka', 0, 3, 0.05],
      ['fade', 'Sönme', 0.2, 3, 0.05],
    ],
  };

  function bgModeControls() {
    const out = [];
    Object.keys(BG_MODE_CONTROLS).forEach((mode) => {
      BG_MODE_CONTROLS[mode].forEach(([key, label, min, max, step, percent]) => {
        out.push({
          type: 'slider',
          path: 'background.' + mode + '.' + key,
          label,
          min, max, step,
          percent: !!percent,
          show: () => cfg.background.type === mode,
          group: 'Mod Ayarları',
        });
      });
    });
    return out;
  }

  // Bölüm şeması
  // Her kontrol isteğe bağlı olarak şunları taşır:
  //   group    — kart içindeki alt başlık
  //   advanced — "Gelişmiş" kapalıyken gizlenir (yeni ayarların varsayılanı)
  // --------------------------------------------------------------------------
  function sectionSchema() {
    const v = cfg.visualizer;
    const isGradient = () => cfg.background.type === 'gradient';
    // Renk paleti gradyan dışındaki 2D arkaplan modlarında da kullanılır
    const usesPalette = () => cfg.background.type !== 'solid';
    // Frekans bandı okuyan ön modlar (bar sayısı / frekans aralığı anlamlı)
    const usesBands = ['bars', 'centerBars', 'circular', 'blocks', 'dots', 'spectrogram', 'starburst', 'terrain', 'orb', 'tunnel',
      'kaleido', 'helix', 'metaball', 'vortex', 'mandala', 'skyline', 'arcs', 'pinwheel', 'strings'];
    const isBandMode = () => usesBands.indexOf(v.type) >= 0;
    // Bar benzeri geometriye sahip modlar (aralarındaki boşluk anlamlı)
    const hasGap = () => ['bars', 'centerBars', 'circular', 'blocks', 'dots', 'starburst',
      'kaleido', 'metaball', 'skyline', 'arcs', 'strings', 'ripplegrid'].indexOf(v.type) >= 0;
    // Dalga formu çizen modlar (çizgi kalınlığı / genlik anlamlı)
    const isWaveMode = () => ['wave', 'ribbon', 'radialWave', 'terrain', 'orb',
      'helix', 'vortex', 'mandala', 'fireworks', 'lightning', 'lissajous', 'strings', 'wave3d', 'bubbles'].indexOf(v.type) >= 0;
    return [
      {
        id: 'sources',
        category: 'audio',
        icon: '🎙️',
        title: 'Ses Kaynakları',
        desc: 'Birden fazla kaynak seçilip karıştırılabilir. 🔊 Loopback (sistem sesi), 🎤 Mikrofon.',
        controls: [
          {
            type: 'multisource',
            path: 'audio.sources',
            label: 'Aktif Kaynaklar',
            devices: () => audioDevices,
          },
          { type: 'button', label: '🔄 Aygıtları Yenile', action: 'refreshDevices' },
        ],
      },
      {
        id: 'analysis',
        category: 'audio',
        icon: '📈',
        title: 'Ses Analizi',
        desc: 'Yakalanan sesin görsele ne kadar sert veya yumuşak yansıyacağı.',
        controls: [
          { type: 'slider', path: 'audio.sensitivity', label: 'Hassasiyet', min: 0.2, max: 4, step: 0.05 },
          { type: 'slider', path: 'audio.smoothing', label: 'Yumuşatma', min: 0, max: 0.95, step: 0.01, percent: true , noExtend: true },
          { type: 'slider', path: 'audio.bassBoost', label: 'Bas Vurgusu', min: 1, max: 4, step: 0.05 },
        ],
      },
      {
        id: 'lighting',
        category: 'lighting',
        icon: '💡',
        wide: true,
        title: 'Windows Dynamic Lighting',
        desc: 'Uyumlu RGB aygıtlarını görselleştirici renkleriyle senkronize eder. Varsayılan olarak kapalıdır.',
        controls: [{ type: 'lightingpanel' }],
      },
      {
        id: 'background',
        category: 'scene',
        icon: '🌫️',
        title: 'Arkaplan',
        desc: 'Sese tepki veren akışkan fon, dalga katmanları, yıldız alanı ve daha fazlası.',
        controls: [
          {
            type: 'segment', path: 'background.type', label: 'Tür', rebuild: true, grouped: true,
            options: [
              { group: 'Akışkan' },
              { value: 'gradient', label: 'Akışkan Gradyan' },
              { value: 'ink', label: 'Mürekkep' },
              { value: 'nebula', label: 'Bulutsu' },
              { value: 'waves', label: 'Dalga Katmanları' },
              { value: 'aurora', label: 'Kutup Işıkları' },
              { group: 'Geometrik' },
              { value: 'grid', label: 'Retro Izgara' },
              { value: 'hexgrid', label: 'Petek Izgara' },
              { value: 'mosaic', label: 'Mozaik' },
              { value: 'corridor', label: 'Koridor' },
              { value: 'spiral', label: 'Sarmal' },
              { value: 'rings', label: 'Nabız Halkaları' },
              { value: 'network', label: 'Ağ' },
              { group: 'Atmosfer' },
              { value: 'starfield', label: 'Yıldız Alanı' },
              { value: 'snow', label: 'Kar / Kor' },
              { value: 'bokeh', label: 'Işık Parçacıkları' },
              { value: 'rain', label: 'Dijital Yağmur' },
              { value: 'city', label: 'Şehir' },
              { group: 'Diğer' },
              { value: 'custom', label: '🧪 Studio' },
              { group: 'Üretken Zeminler' },
              { value: 'liquid', label: 'Sıvı Metal' },
              { value: 'plasma', label: 'Plazma' },
              { value: 'caustics', label: 'Su Yüzeyi' },
              { value: 'ribbons', label: 'Şeritler' },
              { value: 'contours', label: 'Eşyükselti' },
              { value: 'wavefield', label: 'Dalga Alanı' },
              { value: 'embers', label: 'Kıvılcım' },
              { value: 'sand', label: 'Kum' },
              { value: 'stained', label: 'Vitray' },
              { value: 'circuit', label: 'Devre Kartı' },
              { value: 'prism', label: 'Prizma' },
              { value: 'globe', label: 'Küre Ağı' },
              { value: 'wireframe', label: 'Tel Tüneli' },
              { value: 'hexpulse', label: 'Petek Nabzı' },
              { value: 'solid', label: 'Düz Renk' },
            ],
          },
          { type: 'custompicker', kind: 'background', show: () => cfg.background.type === 'custom' },
          { type: 'color', path: 'background.solidColor', label: 'Düz Renk', show: () => cfg.background.type === 'solid' },
          {
            type: 'segment', path: 'background.gradient.style', label: 'Stil',
            options: [
              { value: 'soft', label: 'Yumuşak (Parlamasız)' },
              { value: 'plasma', label: 'Plazma (Parlamalı)' },
            ],
            show: () => cfg.background.type === 'gradient',
          },
          { type: 'colors', path: 'background.gradient.colors', label: 'Renkler (5 nokta)', show: usesPalette },
          { type: 'presets', show: usesPalette },
          { type: 'slider', path: 'background.gradient.speed', label: 'Akış Hızı', min: 0, max: 2, step: 0.02, show: usesPalette },
          { type: 'slider', path: 'background.gradient.audioReactivity', label: 'Ses Tepkisi', min: 0, max: 2, step: 0.02, show: usesPalette },

          // --- Hareket (gelişmiş) ---
          { type: 'slider', path: 'background.gradient.drift', label: 'Tek Yönlü Kayma', min: 0, max: 1, step: 0.01, percent: true, show: isGradient, group: 'Hareket', advanced: true },
          { type: 'slider', path: 'background.gradient.wander', label: 'Gezinme Alanı', min: 0, max: 2, step: 0.02, show: isGradient, group: 'Hareket', advanced: true },
          { type: 'slider', path: 'background.gradient.orbit', label: 'Dolanma Miktarı', min: 0, max: 2, step: 0.02, show: isGradient, group: 'Hareket', advanced: true },
          { type: 'slider', path: 'background.gradient.swirl', label: 'İç Dönüş (Swirl)', min: 0, max: 2, step: 0.02, show: isGradient, group: 'Hareket', advanced: true },
          { type: 'slider', path: 'background.gradient.warp', label: 'Bozulma (Akışkanlık)', min: 0, max: 2, step: 0.02, show: isGradient, group: 'Hareket', advanced: true },

          // --- Görünüm (gelişmiş) ---
          { type: 'slider', path: 'background.gradient.scale', label: 'Ölçek (Yoğunluk)', min: 0.4, max: 3, step: 0.05, show: isGradient, group: 'Görünüm', advanced: true },
          { type: 'slider', path: 'background.gradient.brightness', label: 'Parlaklık (Temel)', min: 0.4, max: 1.6, step: 0.02, show: usesPalette, group: 'Görünüm', advanced: true },
          { type: 'toggle', path: 'background.gradient.hideLines', label: 'Hat Çizgilerini Gizle', show: isGradient, group: 'Görünüm', advanced: true },
          { type: 'slider', path: 'background.gradient.grain', label: 'Gren', min: 0, max: 0.2, step: 0.005, show: isGradient, group: 'Görünüm', advanced: true },
          { type: 'slider', path: 'background.gradient.vignette', label: 'Vinyet', min: 0, max: 1, step: 0.02, percent: true, show: usesPalette, group: 'Görünüm', advanced: true },

          // --- Ses tepkisi (gelişmiş) ---
          { type: 'slider', path: 'background.gradient.audioBrightness', label: 'Ses Patlaması (Parlaklık)', min: 0, max: 2, step: 0.02, show: isGradient, group: 'Sese Tepki', advanced: true},
          { type: 'slider', path: 'background.gradient.audioHue', label: 'Ses ile Renk Kayması', min: 0, max: 1, step: 0.02, percent: true, show: isGradient, group: 'Sese Tepki', advanced: true},

          // --- Seçili arkaplan moduna özel ayarlar ---
          ...bgModeControls(),
        ],
      },
      {
        id: 'palettes',
        category: 'library',
        icon: '🎨',
        title: 'Renk Şablonlarım',
        desc: 'Beğendiğiniz arkaplan renklerini kaydedin; tek tıkla geri yükleyin.',
        controls: [
          { type: 'userpresets' },
          { type: 'bgio' },
        ],
      },
      {
        id: 'visualizer',
        category: 'scene',
        icon: '📊',
        title: 'Görselleştirici',
        desc: 'Sese duyarlı ön efekt: barlar, dalga, çember, tünel, spektrogram ve daha fazlası.',
        controls: [
          {
            type: 'segment', path: 'visualizer.type', label: 'Tür', rebuild: true, grouped: true,
            options: [
              { group: 'Temel' },
              { value: 'none', label: 'Kapalı' },
              { value: 'bars', label: 'Barlar' },
              { value: 'centerBars', label: 'Merkez' },
              { value: 'blocks', label: 'Segment' },
              { value: 'dots', label: 'Nokta Matris' },
              { value: 'skyline', label: 'Şehir Silüeti' },
              { group: 'Dalga Formu' },
              { value: 'wave', label: 'Dalga' },
              { value: 'ribbon', label: 'Şerit' },
              { value: 'wave3d', label: '3B Dalga' },
              { value: 'lissajous', label: 'Lissajous' },
              { value: 'strings', label: 'Teller' },
              { value: 'terrain', label: 'Arazi' },
              { group: 'Dairesel' },
              { value: 'circular', label: 'Çember' },
              { value: 'radialWave', label: 'Dairesel Dalga' },
              { value: 'starburst', label: 'Işın' },
              { value: 'arcs', label: 'Yaylar' },
              { value: 'pinwheel', label: 'Fırıldak' },
              { value: 'mandala', label: 'Mandala' },
              { value: 'kaleido', label: 'Kaleydoskop' },
              { value: 'vortex', label: 'Girdap' },
              { value: 'helix', label: 'Sarmal' },
              { value: 'tunnel', label: 'Tünel' },
              { value: 'orb', label: 'Küre' },
              { group: 'Parçacık ve Olay' },
              { value: 'particles', label: 'Parçacık' },
              { value: 'fireworks', label: 'Havai Fişek' },
              { value: 'lightning', label: 'Şimşek' },
              { value: 'bubbles', label: 'Baloncuk' },
              { value: 'metaball', label: 'Sıvı Damla' },
              { value: 'ripplegrid', label: 'Dalgalı Izgara' },
              { value: 'spectrogram', label: 'Spektrogram' },
              { group: 'Üretken Sistemler' },
              { value: 'flowfield', label: 'Akış Alanı' },
              { value: 'flock', label: 'Sürü' },
              { value: 'voronoi', label: 'Voronoi' },
              { value: 'truchet', label: 'Truchet' },
              { value: 'moire', label: 'Moiré' },
              { value: 'interference', label: 'Dalga Girişimi' },
              { value: 'ropes', label: 'İpler' },
              { value: 'galaxy', label: 'Galaksi' },
              { value: 'dna', label: 'DNA Sarmalı' },
              { value: 'isocity', label: 'İzometrik Şehir' },
              { value: 'attractorfield', label: 'Çekici Alanı' },
              { group: 'Metin' },
              { value: 'text', label: 'Metin / Şarkı Sözü' },
              { group: 'Ölçüm' },
              { value: 'scope', label: 'Osiloskop (XY)' },
              { value: 'goniometer', label: 'Gonyometre' },
              { value: 'chromawheel', label: 'Kroma Çemberi' },
              { group: 'Gelişmiş Motorlar' },
              { value: 'geometry', label: '◈ 3B Geometri' },
              { value: 'milkdrop', label: '🥛 MilkDrop' },
              { value: 'feedback', label: '♾ Geri Besleme' },
              { value: 'custom', label: '🧪 Studio' },
            ],
          },
          { type: 'custompicker', kind: 'visualizer', show: () => v.type === 'custom' },
          { type: 'toggle', path: 'visualizer.rainbow', label: 'Gökkuşağı (Rainbow)', rebuild: true, show: () => v.type !== 'none' },
          { type: 'color', path: 'visualizer.color', label: 'Renk', show: () => v.type !== 'none' && !v.rainbow },
          { type: 'color', path: 'visualizer.color2', label: 'İkincil Renk', show: () => !v.rainbow && ['wave', 'ribbon', 'orb', 'tunnel', 'radialWave', 'terrain', 'mandala', 'wave3d', 'helix'].indexOf(v.type) >= 0 },
          { type: 'slider', path: 'visualizer.sensitivity', label: 'Hassasiyet', min: 0.3, max: 3, step: 0.05, show: () => v.type !== 'none' },
          // Spektrogram kendi ısı haritasını çizer, parlama uygulanmaz
          { type: 'slider', path: 'visualizer.glow', label: 'Parlama (Glow)', min: 0, max: 1, step: 0.02, percent: true, show: () => v.type !== 'none' && v.type !== 'spectrogram' },
          {
            type: 'segment', path: 'visualizer.position', label: 'Yerleşim',
            options: [{ value: 'bottom', label: 'Alt' }, { value: 'center', label: 'Orta' }, { value: 'full', label: 'Tam' }],
            show: () => v.type === 'bars',
          },

          // --- Bar/segment geometrisi (gelişmiş) ---
          { type: 'slider', path: 'visualizer.barCount', label: 'Bar Sayısı', min: 16, max: 160, step: 1, show: isBandMode, group: 'Bar Biçimi', advanced: true },
          { type: 'slider', path: 'visualizer.gap', label: 'Bar Boşluğu', min: 0, max: 0.8, step: 0.02, percent: true, show: hasGap, group: 'Bar Biçimi', advanced: true },
          { type: 'toggle', path: 'visualizer.mirror', label: 'Ayna (Simetri)', show: () => ['bars', 'wave', 'radialWave'].indexOf(v.type) >= 0, group: 'Bar Biçimi', advanced: true },

          // --- Dalga / çizgi biçimi (gelişmiş) ---
          { type: 'slider', path: 'visualizer.lineWidth', label: 'Çizgi Kalınlığı', min: 1, max: 12, step: 0.5, show: isWaveMode, group: 'Dalga Biçimi', advanced: true },
          { type: 'slider', path: 'visualizer.thickness', label: 'Genlik / Dolgu', min: 0.1, max: 1, step: 0.02, percent: true, show: () => ['wave', 'ribbon', 'radialWave', 'helix', 'metaball', 'lissajous', 'strings', 'wave3d', 'ripplegrid', 'bubbles'].indexOf(v.type) >= 0, group: 'Dalga Biçimi', advanced: true },

          // --- Frekans aralığı (gelişmiş) ---
          { type: 'slider', path: 'visualizer.minFreq', label: 'Min Frekans (Hz)', min: 20, max: 500, step: 5, show: isBandMode, group: 'Frekans Aralığı', advanced: true },
          { type: 'slider', path: 'visualizer.maxFreq', label: 'Max Frekans (Hz)', min: 2000, max: 20000, step: 100, show: isBandMode, group: 'Frekans Aralığı', advanced: true },
        ],
      },
      {
        id: 'layers',
        category: 'scene',
        icon: '⬗',
        wide: true,
        title: 'Katmanlar',
        desc: 'Sahneyi üst üste binen katmanlardan kurun: her katmanın kendi kaynağı, karışım modu, saydamlığı, dönüşümü ve sese tepkisi olur.',
        controls: [{ type: 'layerspanel' }],
      },
      {
        id: 'templates',
        category: 'library',
        icon: '✨',
        wide: true,
        title: 'Hazır Şablonlar',
        desc: 'Kullanıma ve türe göre gruplanmış bitmiş sahneler. Tek tıkla uygulanır; ses, ekran, yayın ve aydınlatma ayarlarınıza dokunmaz.',
        controls: [{ type: 'templatepanel' }],
      },
      {
        id: 'record',
        category: 'output',
        icon: '⏺',
        title: 'Kayıt ve Anlık Görüntü',
        desc: 'Ekranda göründüğü gibi kaydedin: canlı sesle, modülasyon, geçiş ve efektler dahil. MP4, WebM, GIF ve PNG.',
        controls: [{ type: 'recordpanel' }],
      },
      {
        id: 'mapping',
        category: 'output',
        icon: '⧉',
        wide: true,
        title: 'Projeksiyon Haritalama',
        desc: 'Görüntüyü düz olmayan yüzeylere oturtun: köşe düzeltme, bükme ızgarası, kırpma, kenar harmanlama, ekran başına renk düzeltme, maske ve hizalama desenleri.',
        controls: [{ type: 'mappingpanel' }],
      },
      {
        id: 'deepanalysis',
        category: 'audio',
        icon: '📈',
        wide: true,
        title: 'Ses Çözümlemesi',
        desc: 'Sinyalden çıkarılan canlı ölçümler: tonalite, akor, perde, gürlük, tını, armonik/vurmalı dengesi ve nota sınıfı dağılımı. Hepsi modülasyon matrisinde kaynak olarak kullanılabilir.',
        controls: [{ type: 'analysispanel' }],
      },
      {
        id: 'text',
        category: 'scene',
        icon: '🅣',
        title: 'Metin ve Şarkı Sözü',
        desc: 'Sabit metin, zamanlanmış şarkı sözü (LRC / SRT, karaoke vurgusuyla) ya da çalan parça bilgisi.',
        controls: [{ type: 'textpanel' }],
        show: () => v.type === 'text',
      },
      {
        id: 'milkdrop',
        category: 'scene',
        icon: '🥛',
        wide: true,
        title: 'MilkDrop Presetleri',
        desc: 'MilkDrop preset dosyalarını (.milk) yükleyin. Denklem blokları gerçekten çalıştırılır: per_frame ve per_pixel hareketi, warp ağı ve geri besleme.',
        controls: [{ type: 'milkdroppanel' }],
        show: () => v.type === 'milkdrop',
      },
      {
        id: 'transition',
        category: 'scene',
        icon: '⇋',
        title: 'Sahne Geçişi',
        desc: 'Sahne değiştirirken sert kesme yerine geçiş: çapraz geçiş, silme, iris, zum, glitch ve daha fazlası. İstenirse tamamen kapatılabilir.',
        controls: [{ type: 'transitionpanel' }],
      },
      {
        id: 'modulation',
        category: 'scene',
        icon: '⇄',
        wide: true,
        title: 'Modülasyon Matrisi',
        desc: 'Herhangi bir kaynağı (bas, LFO, zarf, makro, rastgele, tempo) herhangi bir sayısal ayara bağlayın. Kaydedilen ayarlar değişmez; modülasyon yalnızca çizim anında uygulanır ve dışa aktarımda da birebir çalışır.',
        controls: [{ type: 'modulationpanel' }],
      },
      {
        id: 'effects',
        category: 'scene',
        icon: '✦',
        wide: true,
        title: 'Efekt Zinciri',
        desc: 'Birleştirilmiş sahneye sırayla uygulanan son-işlem efektleri. Sıra görüntüyü değiştirir; zincir dışa aktarımda da aynen çalışır.',
        controls: [{ type: 'effectspanel' }],
      },
      {
        id: 'geometry',
        category: 'scene',
        icon: '◈',
        title: '3B Geometri',
        desc: 'Matematiksel formüllerden gerçek perspektifte geometri: yüzeyler, uzay eğrileri ve çekici sistemler.',
        show: () => cfg.visualizer.type === 'geometry' ||
          (Array.isArray(cfg.layers) && cfg.layers.some((l) => l && l.type === 'geometry' && l.enabled !== false)),
        controls: [{ type: 'geometrypanel' }],
      },
      {
        id: 'feedbackengine',
        category: 'scene',
        icon: '♾',
        title: 'Geri Besleme Motoru',
        desc: 'MilkDrop ailesi: her kare bir öncekini büker, yakınlaştırır ve söndürür. Sonsuz tünel görünümü buradan gelir.',
        show: () => cfg.visualizer.type === 'feedback',
        controls: [
          {
            type: 'segment', path: 'feedback.waveMode', label: 'Dalga Biçimi',
            options: [
              { value: 'line', label: 'Çizgi' },
              { value: 'dual', label: 'Çift' },
              { value: 'circle', label: 'Çember' },
              { value: 'spectrum', label: 'Spektrum' },
            ],
          },
          { type: 'slider', path: 'feedback.zoom', label: 'Yakınlaşma', min: 0.94, max: 1.08, step: 0.001, noExtend: true, fmt: (x) => (+x).toFixed(3) },
          { type: 'slider', path: 'feedback.decay', label: 'Sönme', min: 0.7, max: 0.999, step: 0.001, noExtend: true, fmt: (x) => (+x).toFixed(3) },
          { type: 'slider', path: 'feedback.warp', label: 'Bükülme', min: 0, max: 2, step: 0.02 },
          { type: 'slider', path: 'feedback.rotate', label: 'Dönüş', min: -1, max: 1, step: 0.01, group: 'Hareket', advanced: true },
          { type: 'slider', path: 'feedback.swirl', label: 'İç Dönüş', min: 0, max: 2, step: 0.02, group: 'Hareket', advanced: true },
          { type: 'slider', path: 'feedback.dx', label: 'Yatay Kayma', min: -0.05, max: 0.05, step: 0.001, noExtend: true, group: 'Hareket', advanced: true, fmt: (x) => (+x).toFixed(3) },
          { type: 'slider', path: 'feedback.dy', label: 'Dikey Kayma', min: -0.05, max: 0.05, step: 0.001, noExtend: true, group: 'Hareket', advanced: true, fmt: (x) => (+x).toFixed(3) },
          { type: 'slider', path: 'feedback.waveAmp', label: 'Dalga Genliği', min: 0, max: 3, step: 0.02, group: 'Dalga', advanced: true },
          { type: 'slider', path: 'feedback.waveThickness', label: 'Dalga Kalınlığı', min: 0, max: 3, step: 0.02, group: 'Dalga', advanced: true },
          { type: 'slider', path: 'feedback.sharpen', label: 'Keskinlik', min: 0, max: 1, step: 0.02, percent: true, group: 'Dalga', advanced: true },
          { type: 'slider', path: 'feedback.bassZoom', label: 'Bas → Yakınlaşma', min: 0, max: 0.3, step: 0.005, group: 'Sese Tepki', advanced: true },
          { type: 'slider', path: 'feedback.bassRotate', label: 'Bas → Dönüş', min: 0, max: 0.3, step: 0.005, group: 'Sese Tepki', advanced: true },
        ],
      },
      {
        id: 'media',
        category: 'scene',
        icon: '🎥',
        title: 'Medya Katmanı',
        desc: 'Web kameranızı veya bir video dosyasını sahneye katman olarak koyun; sese göre nabız atsın.',
        controls: [{ type: 'mediapanel' }],
      },
      {
        id: 'stream',
        category: 'output',
        icon: '📡',
        wide: true,
        title: 'Yayın Çıkışı (OBS / Web)',
        desc: 'OBS ve benzeri programlara "Tarayıcı Kaynağı" olarak eklenebilen bir sayfa yayınlar; telefondan uzaktan kumanda da buradan açılır.',
        controls: [{ type: 'streampanel' }],
      },
      {
        id: 'tempo',
        category: 'control',
        icon: '🥁',
        title: 'Tempo ve Otomatik VJ',
        desc: 'Parçanın temposunu bulur; sahneleri, modları veya renkleri ölçüye hizalı olarak kendiliğinden değiştirir.',
        controls: [{ type: 'autovjpanel' }],
      },
      {
        id: 'artnet',
        category: 'lighting',
        icon: '🎚️',
        title: 'Art-Net / DMX Çıkışı',
        desc: 'Sahne renklerini standart DMX protokolüyle ışık konsollarına ve arayüzlerine yollar.',
        controls: [{ type: 'artnetpanel' }],
      },
      {
        id: 'midi',
        category: 'control',
        icon: '🎹',
        wide: true,
        title: 'MIDI Denetleyici',
        desc: 'MIDI kumandanızın düğme ve faderlarını istediğiniz ayara bağlayın. Öğren düğmesine basıp denetleyiciyi oynatmanız yeterli.',
        controls: [{ type: 'controlpanel', surface: 'midi' }],
      },
      {
        id: 'osc',
        category: 'control',
        icon: '🛰️',
        wide: true,
        title: 'OSC',
        desc: 'TouchOSC, Resolume, Ableton veya QLab gibi kaynaklardan gelen OSC mesajlarını ayarlara bağlayın.',
        controls: [{ type: 'controlpanel', surface: 'osc' }],
      },
      {
        id: 'studio',
        category: 'studio',
        icon: '🧪',
        wide: true,
        title: 'Studio — Kendi Görselleştiricin',
        desc: 'Hazır bir modu kendine göre değiştir ya da sıfırdan shader yaz. Shadertoy, ISF ve MilkDrop dosyaları içe aktarılabilir.',
        controls: [{ type: 'studiopanel' }],
      },
      {
        id: 'scenegen',
        category: 'studio',
        icon: '✨',
        title: 'Sahne Üretici',
        desc: 'Ruh halini yaz, uygulama sana uygun bir sahne kursun. Tamamen çevrimdışı çalışır.',
        controls: [{ type: 'scenegen' }],
      },
      {
        id: 'logo',
        category: 'scene',
        icon: '🖼️',
        title: 'Logo / Resim',
        desc: 'Sahneye bir resim yerleştirin; sese göre nabız atar.',
        controls: [
          { type: 'toggle', path: 'logo.enabled', label: 'Logo Göster', rebuild: true },
          { type: 'logofile', show: () => cfg.logo.enabled },
          { type: 'slider', path: 'logo.scale', label: 'Boyut', min: 0.05, max: 0.6, step: 0.01, percent: true, show: () => cfg.logo.enabled },
          { type: 'slider', path: 'logo.opacity', label: 'Saydamlık', min: 0, max: 1, step: 0.02, percent: true, show: () => cfg.logo.enabled },
          { type: 'slider', path: 'logo.pulse', label: 'Ses Nabzı', min: 0, max: 1, step: 0.02, percent: true, show: () => cfg.logo.enabled },
          { type: 'slider', path: 'logo.glow', label: 'Parlama', min: 0, max: 1, step: 0.02, percent: true, show: () => cfg.logo.enabled, group: 'Konum ve Işıltı', advanced: true },
          { type: 'xy', show: () => cfg.logo.enabled, group: 'Konum ve Işıltı', advanced: true },
        ],
      },
      {
        id: 'images',
        category: 'scene',
        icon: '✨',
        title: 'Görsel Nesneler',
        desc: 'Resim ekleyin; sahnede süzülsün, yörünge çizsin, sese göre saçılsın.',
        controls: [
          { type: 'toggle', path: 'images.enabled', label: 'Görsel Nesneleri Etkinleştir', rebuild: true },
          { type: 'images', show: () => cfg.images && cfg.images.enabled },
        ],
      },
      {
        id: 'display',
        category: 'output',
        icon: '🖥️',
        title: 'Ekran',
        desc: 'Görselleştirme hangi ekranda tam ekran açılsın? Üst çubuktan da seçebilirsiniz.',
        controls: [{ type: 'displaypicker' }],
      },
      {
        id: 'power',
        category: 'output',
        icon: '⚡',
        title: 'Güç / Performans',
        desc: 'Kare hızı, çözünürlük ölçeği ve enerji ayarları.',
        controls: [
          {
            type: 'select', path: 'power.fpsCap', label: 'Kare Hızı (FPS)', numeric: true,
            options: [
              { value: 0, label: 'Ekranla Eşitle — en akıcı (önerilen)' },
              { value: 120, label: 'En fazla 120 FPS' },
              { value: 60, label: 'En fazla 60 FPS' },
              { value: 30, label: 'En fazla 30 FPS (düşük güç)' },
            ],
          },
          {
            type: 'note',
            text: 'Ekranla Eşitle, her ekran yenilemesinde bir kare çizer; en akıcı sonucu verir. Ekranınızın yenileme hızının tam böleni olmayan bir sınır (75 Hz ekranda 60 gibi) kare aralıklarını eşitsiz yapabilir.',
          },
          { type: 'slider', path: 'power.renderScale', label: 'Arkaplan Çözünürlüğü', min: 0.4, max: 1, step: 0.05, percent: true , noExtend: true },
          { type: 'toggle', path: 'power.pauseOnSilence', label: 'Sessizlikte Duraklat', group: 'Davranış', advanced: true },
          { type: 'toggle', path: 'power.hideCursor', label: 'İmleci Gizle', group: 'Davranış', advanced: true },
        ],
      },
      {
        id: 'scenes',
        category: 'library',
        icon: '🎬',
        title: 'Sahneler',
        desc: 'Arkaplan + görselleştirici + logo + görsel nesneleri tek isim altında saklayın.',
        controls: [{ type: 'scenes' }],
      },
      {
        id: 'backup',
        category: 'library',
        icon: '💾',
        title: 'Ayarları Yedekle / Geri Yükle',
        desc: 'Renk şablonları hariç tüm uygulama ayarlarını tek JSON dosyasında taşıyın.',
        controls: [{ type: 'settingsio' }],
      },
      {
        id: 'export',
        category: 'output',
        icon: '🎞️',
        wide: true,
        title: 'Video Dışa Aktar (MP3 → Video)',
        desc: 'Bir ses dosyası seçin; mevcut sahne ayarlarıyla kayıpsız videoya dönüştürülür. Ekran kaydı değildir — her kare birebir render edilir.',
        controls: [
          { type: 'audiofile' },
          {
            type: 'select', path: 'export.resolution', label: 'Çözünürlük',
            options: [
              { value: '720p', label: '720p — 1280×720' },
              { value: '1080p', label: '1080p — 1920×1080 (Full HD)' },
              { value: '1440p', label: '1440p — 2560×1440 (2K)' },
              { value: '2160p', label: '2160p — 3840×2160 (4K)' },
            ],
          },
          {
            type: 'select', path: 'export.fps', label: 'Kare Hızı (FPS)', numeric: true,
            options: [
              { value: 30, label: '30 FPS' },
              { value: 60, label: '60 FPS (Akıcı)' },
            ],
          },
          {
            type: 'select', path: 'export.encoder', label: 'Kodlayıcı (Hız)',
            group: 'Kodlama', advanced: true,
            options: () =>
              gpuAvailable
                ? [
                    { value: 'gpu', label: '⚡ GPU — NVIDIA NVENC (çok hızlı)' },
                    { value: 'cpu', label: 'CPU — libx264 (en uyumlu, yavaş)' },
                  ]
                : [{ value: 'cpu', label: 'CPU — libx264 (GPU bulunamadı)' }],
          },
          {
            type: 'select', path: 'export.quality', label: 'Kalite',
            group: 'Kodlama', advanced: true,
            options: [
              { value: 'visually-lossless', label: 'Görsel Kayıpsız (en yüksek)' },
              { value: 'high', label: 'Yüksek' },
              { value: 'balanced', label: 'Dengeli (daha küçük dosya)' },
            ],
          },
          {
            type: 'select', path: 'export.speed', label: 'Hız / Kalite Dengesi',
            group: 'Kodlama', advanced: true,
            options: [
              { value: 'fast', label: '⚡ Hızlı (en hızlı dışa aktarım)' },
              { value: 'balanced', label: 'Dengeli (önerilen)' },
              { value: 'quality', label: 'Kalite (en yavaş, en iyi sıkıştırma)' },
            ],
          },
          { type: 'exportpanel', tail: true },
        ],
      },
    ];
  }

  // --------------------------------------------------------------------------
  // "Varsayılandan farklı" tespiti
  // --------------------------------------------------------------------------
  function defaultAt(path) {
    return getPath(window.SV.DEFAULT_CONFIG, path);
  }

  function isModified(path) {
    if (!path) return false;
    const cur = getPath(cfg, path);
    const def = defaultAt(path);
    if (def === undefined) return false;
    if (typeof cur === 'object' || typeof def === 'object') {
      return JSON.stringify(cur) !== JSON.stringify(def);
    }
    return cur !== def;
  }

  // Bir bölümdeki (kart) tüm ayar yolları — görünürlük koşullarından bağımsız
  function sectionPaths(sec) {
    const out = [];
    sec.controls.forEach((c) => {
      if (c.path && defaultAt(c.path) !== undefined) out.push(c.path);
    });
    // Şemada yolu olmayan özel paneller için ek kökler
    if (sec.id === 'lighting') out.push('lighting');
    if (sec.id === 'images') out.push('images');
    return out;
  }

  function countModified(paths) {
    return paths.filter(isModified).length;
  }

  function categoryModifiedCount(catId) {
    let n = 0;
    sectionSchema().forEach((sec) => {
      if (sec.category !== catId) return;
      n += countModified(sectionPaths(sec));
    });
    return n;
  }

  // --------------------------------------------------------------------------
  // Sol kategori rayı
  // --------------------------------------------------------------------------
  function renderNav() {
    const rail = $('navRail');
    rail.innerHTML = '';
    rail.appendChild(el('div', { class: 'nav-group-label', text: 'Kategoriler' }));
    CATEGORIES.forEach((cat) => {
      const n = categoryModifiedCount(cat.id);
      const item = el(
        'button',
        {
          class: 'nav-item' + (cat.id === activeCategory ? ' active' : ''),
          type: 'button',
          title: cat.desc,
          onclick: () => setCategory(cat.id),
        },
        [
          el('span', { class: 'nav-ico', text: cat.icon }),
          el('span', { class: 'nav-label', text: cat.title }),
          n > 0 ? el('span', { class: 'nav-badge', text: String(n), title: 'Varsayılandan farklı ayar sayısı' }) : null,
        ]
      );
      rail.appendChild(item);
    });
    rail.appendChild(el('div', { class: 'nav-spacer' }));
    rail.appendChild(
      el('div', { class: 'nav-foot', text: 'Kırmızı nokta ve rakamlar, varsayılandan farklı ayarları gösterir.' })
    );
  }

  function setCategory(id) {
    if (activeCategory === id) return;
    activeCategory = id;
    localStorage.setItem('sv-category', id);
    render();
  }

  // --------------------------------------------------------------------------
  // Render — yalnızca seçili kategorinin kartları
  // --------------------------------------------------------------------------
  function render() {
    const root = $('sections');
    const prevScroll = root.scrollTop;
    root.innerHTML = '';

    const cat = CATEGORIES.find((c) => c.id === activeCategory) || CATEGORIES[0];
    $('catTitle').textContent = cat.title;
    $('catDesc').textContent = cat.desc;

    const sections = sectionSchema().filter((s) => s.category === cat.id && (!s.show || s.show()));
    root.classList.toggle('single', sections.length === 1 || sections.every((s) => s.wide));

    // Sıfırlanacak bir şey yoksa (ör. Kitaplık) düğme boşuna durmasın
    const resettable = sections.some((s) => countModified(sectionPaths(s)) > 0);
    $('catResetBtn').classList.toggle('hidden', !resettable);

    sections.forEach((sec) => {
      const card = buildCard(sec);
      if (card) root.appendChild(card);
    });

    renderNav();
    root.scrollTop = prevScroll;
    if (window.SVPreview) window.SVPreview.setConfig(cfg);
  }

  // Tek bir kart: başlık + gruplanmış kontroller (+ gelişmiş)
  function buildCard(sec) {
    const visible = sec.controls.filter((def) => !def.show || def.show());
    // tail: eylem panelleri (ör. dışa aktarma düğmesi) en sona, gelişmiş bloğun
    // da altına yerleşir — ayarların "başlat" düğmesinden sonra gelmemesi için
    const basics = visible.filter((d) => !d.advanced && !d.tail);
    const advanced = visible.filter((d) => d.advanced && !d.tail);
    const tail = visible.filter((d) => d.tail);
    const showAdvanced = advancedOn;

    const modCount = countModified(sectionPaths(sec));
    const head = el('div', { class: 'card-head' }, [
      el('span', { class: 'ico', text: sec.icon }),
      el('div', { class: 'ch-main' }, [
        el('h3', { text: sec.title }),
        sec.desc ? el('div', { class: 'desc', text: sec.desc }) : null,
      ]),
      el('div', { class: 'ch-actions' }, [
        modCount > 0
          ? el('span', { class: 'chip-mod', text: String(modCount), title: 'Varsayılandan farklı ayar sayısı' })
          : null,
        modCount > 0
          ? el('button', {
              class: 'icon-btn small',
              type: 'button',
              text: '↺',
              title: 'Bu bölümü varsayılana döndür',
              onclick: () => resetSection(sec),
            })
          : null,
      ]),
    ]);

    const card = el('div', { class: 'card' + (sec.wide ? ' wide' : '') }, [head]);
    appendGrouped(card, basics);

    if (advanced.length) {
      if (showAdvanced) {
        appendGrouped(card, advanced, true);
      } else {
        card.appendChild(
          el('button', {
            class: 'adv-summary',
            type: 'button',
            title: 'Gelişmiş ayarları göster',
            onclick: () => setAdvanced(true),
            html:
              '<span class="caret">▶</span><span>Gelişmiş ayarlar</span>' +
              '<span class="count">' + advanced.length + '</span>',
          })
        );
      }
    }
    if (tail.length) appendGrouped(card, tail);
    return card;
  }

  // Kontrolleri "group" alanına göre alt başlıklar altında ekle
  function appendGrouped(card, defs, isAdvanced) {
    if (!defs.length) return;
    let currentGroup = null;
    let host = null;

    const openGroup = (name) => {
      const wrap = el('div', { class: 'group' });
      if (name) wrap.appendChild(el('div', { class: 'group-label', text: name }));
      card.appendChild(wrap);
      return wrap;
    };

    defs.forEach((def, i) => {
      const group = def.group || null;
      if (i === 0 || group !== currentGroup) {
        currentGroup = group;
        // Gelişmiş bloğun ilk grubu adsızsa "Gelişmiş" başlığını taşısın
        const label = group || (isAdvanced && i === 0 ? 'Gelişmiş' : null);
        host = openGroup(label);
      }
      const c = buildControl(def);
      if (!c) return;
      if (def.path) {
        c.setAttribute('data-path', def.path);
        if (isModified(def.path)) c.classList.add('modified');
        // Tek ayarı geri alma: bölümün tamamını sıfırlamaya gerek kalmasın
        const lbl = c.querySelector('label.lbl');
        if (lbl && defaultAt(def.path) !== undefined) {
          lbl.appendChild(
            el('button', {
              class: 'ctrl-reset',
              type: 'button',
              text: '↺',
              title: 'Bu ayarı varsayılana döndür',
              onclick: (e) => {
                e.preventDefault();
                resetPath(def.path);
              },
            })
          );
        }
      }
      host.appendChild(c);
    });
  }

  // Tek bir ayarı varsayılana döndür (onay istemez — geri alması kolay)
  function resetPath(path) {
    const dv = getPath(window.SV.defaultConfig(), path);
    if (dv === undefined) return;
    setPath(cfg, path, window.SV.clone(dv));
    push(true);
    render();
  }

  // "Varsayılandan farklı" göstergelerini yeniden çizmeden tazele.
  // Kaydırıcı sürüklenirken kart yeniden kurulamaz (odak ve sürükleme kopar),
  // bu yüzden yalnızca noktalar ve sayaçlar güncellenir.
  function refreshModifiedMarks() {
    const root = $('sections');
    if (!root) return;
    root.querySelectorAll('.ctrl[data-path]').forEach((node) => {
      node.classList.toggle('modified', isModified(node.getAttribute('data-path')));
    });

    const sections = sectionSchema().filter((s) => s.category === activeCategory && (!s.show || s.show()));
    const cards = root.querySelectorAll('.card');
    sections.forEach((sec, i) => {
      const card = cards[i];
      if (!card) return;
      const n = countModified(sectionPaths(sec));
      let chip = card.querySelector('.chip-mod');
      const acts = card.querySelector('.ch-actions');
      if (n > 0 && !chip && acts) {
        // Kart sıfırdan değişikliğe geçtiyse rozet ve sıfırlama düğmesi belirir
        acts.appendChild(el('span', { class: 'chip-mod', title: 'Varsayılandan farklı ayar sayısı' }));
        acts.appendChild(
          el('button', {
            class: 'icon-btn small', type: 'button', text: '↺',
            title: 'Bu bölümü varsayılana döndür',
            onclick: () => resetSection(sec),
          })
        );
        chip = card.querySelector('.chip-mod');
      }
      if (chip) {
        chip.textContent = String(n);
        chip.classList.toggle('hidden', n === 0);
        const btn = card.querySelector('.ch-actions .icon-btn');
        if (btn) btn.classList.toggle('hidden', n === 0);
      }
    });

    renderNav();
    const resettable = sections.some((s) => countModified(sectionPaths(s)) > 0);
    const catBtn = $('catResetBtn');
    if (catBtn) catBtn.classList.toggle('hidden', !resettable);
  }

  function setAdvanced(on) {
    advancedOn = !!on;
    localStorage.setItem('sv-advanced', advancedOn ? '1' : '0');
    const box = $('advToggle');
    if (box) box.checked = advancedOn;
    render();
  }

  async function resetSection(sec) {
    const paths = sectionPaths(sec);
    if (!paths.length) return;
    const ok = await svConfirm('Bu bölümdeki ayarlar varsayılana dönecek.', { danger: true, okText: 'Bölümü sıfırla' });
    if (!ok) return;
    const defaults = window.SV.defaultConfig();
    paths.forEach((p) => {
      const dv = getPath(defaults, p);
      if (dv !== undefined) setPath(cfg, p, window.SV.clone(dv));
    });
    push(true);
    render();
  }

  // --------------------------------------------------------------------------
  // Arama — tüm kategorilerdeki her ayarı tek kutudan bulmak için.
  // Yeni ayarlar şemaya eklendiğinde otomatik olarak aranabilir olur; arayüzün
  // büyüdükçe karmaşıklaşmamasının asıl nedeni budur.
  // --------------------------------------------------------------------------
  function tr(s) {
    return (window.SVI18n && window.SVI18n.t ? window.SVI18n.t(s) : s) || s;
  }

  function buildSearchIndex() {
    const out = [];
    sectionSchema().forEach((sec) => {
      const cat = CATEGORIES.find((c) => c.id === sec.category);
      if (!cat) return;
      out.push({
        kind: 'section',
        icon: sec.icon,
        label: sec.title,
        category: sec.category,
        categoryTitle: cat.title,
        section: sec.title,
        path: null,
        advanced: false,
      });
      sec.controls.forEach((def) => {
        if (!def.label || !def.path) return;
        out.push({
          kind: 'control',
          icon: sec.icon,
          label: def.label,
          category: sec.category,
          categoryTitle: cat.title,
          section: sec.title,
          path: def.path,
          advanced: !!def.advanced,
        });
      });
    });
    return out;
  }

  function searchEntries(query) {
    const q = query.trim().toLocaleLowerCase('tr');
    if (!q) return [];
    const score = (e) => {
      // Hem Türkçe anahtar hem de görüntülenen çeviri üzerinde eşleşme aranır
      const hay = [e.label, tr(e.label), e.section, tr(e.section), e.categoryTitle, tr(e.categoryTitle)];
      let best = -1;
      hay.forEach((h, i) => {
        const idx = (h || '').toLocaleLowerCase('tr').indexOf(q);
        if (idx < 0) return;
        // Etiket eşleşmesi bölüm/kategori eşleşmesinden değerli, baştan eşleşme daha da değerli
        const weight = i < 2 ? 0 : i < 4 ? 40 : 80;
        const s = weight + idx;
        if (best < 0 || s < best) best = s;
      });
      return best;
    };
    return buildSearchIndex()
      .map((e) => ({ e, s: score(e) }))
      .filter((x) => x.s >= 0)
      .sort((a, b) => a.s - b.s || a.e.label.length - b.e.label.length)
      .slice(0, 40)
      .map((x) => x.e);
  }

  function renderSearchResults(query) {
    const box = $('searchResults');
    if (!box) return;
    const items = searchEntries(query);
    box.innerHTML = '';
    if (!query.trim()) {
      box.classList.add('hidden');
      return;
    }
    box.classList.remove('hidden');
    if (!items.length) {
      box.appendChild(el('div', { class: 'sr-empty', text: 'Eşleşen ayar bulunamadı.' }));
      return;
    }
    items.forEach((e, i) => {
      box.appendChild(
        el('button', { class: 'sr-item' + (i === 0 ? ' active' : ''), type: 'button', onclick: () => jumpTo(e) }, [
          el('span', { class: 'sr-ico', text: e.icon }),
          el('span', { class: 'sr-main' }, [
            el('div', { class: 'sr-label', text: e.label }),
            el('div', { class: 'sr-path', text: e.categoryTitle + ' › ' + e.section }),
          ]),
          e.advanced ? el('span', { class: 'sr-tag', text: 'Gelişmiş' }) : null,
        ])
      );
    });
  }

  // Arama sonucuna git: kategoriyi aç, gerekirse gelişmişi göster, kontrolü vurgula
  function jumpTo(entry) {
    const input = $('searchInput');
    if (input) input.value = '';
    $('searchResults').classList.add('hidden');

    if (entry.advanced && !advancedOn) {
      advancedOn = true;
      localStorage.setItem('sv-advanced', '1');
      const box = $('advToggle');
      if (box) box.checked = true;
    }
    activeCategory = entry.category;
    localStorage.setItem('sv-category', activeCategory);
    render();

    requestAnimationFrame(() => {
      const root = $('sections');
      let target = null;
      if (entry.path) target = root.querySelector('[data-path="' + entry.path + '"]');
      if (!target) {
        // Bölüm başlığına git
        const cards = Array.from(root.querySelectorAll('.card'));
        const card = cards.find((c) => {
          const h = c.querySelector('h3');
          return h && (h.textContent === entry.section || h.textContent === tr(entry.section));
        });
        target = card;
      }
      if (!target) return;
      target.scrollIntoView({ block: 'center', behavior: 'smooth' });
      target.classList.remove('flash');
      void target.offsetWidth; // animasyonu yeniden tetikle
      target.classList.add('flash');
      setTimeout(() => target.classList.remove('flash'), 1800);
    });
  }

  async function resetCategory(catId) {
    const cat = CATEGORIES.find((c) => c.id === catId);
    if (!cat) return;
    const ok = await svConfirm('Bu kategorideki tüm ayarlar varsayılana dönecek.', { danger: true, okText: 'Kategoriyi sıfırla' });
    if (!ok) return;
    const defaults = window.SV.defaultConfig();
    sectionSchema()
      .filter((s) => s.category === catId)
      .forEach((sec) => {
        sectionPaths(sec).forEach((p) => {
          const dv = getPath(defaults, p);
          if (dv !== undefined) setPath(cfg, p, window.SV.clone(dv));
        });
      });
    push(true);
    render();
  }

  // --------------------------------------------------------------------------
  // Ekranlar
  // --------------------------------------------------------------------------
  /* Çoklu ekran seçimi.

     Görselleştirme artık seçilen HER ekranda ayrı bir pencerede açılır. Üst
     çubuktaki düğme seçimin özetini gösterir, açılan menüde onay kutuları var.
     cfg.display.ids listeyi tutar; cfg.display.id eski sürümlerle uyum için
     ilk ekranı yansıtmayı sürdürür. */
  function syncSelectedDisplays() {
    cfg.display = cfg.display || {};
    // Artık bağlı olmayan ekranları ayıkla
    selectedDisplayIds = selectedDisplayIds.filter((id) => displays.some((d) => d.id === id));
    if (!selectedDisplayIds.length && displays.length) {
      // Varsayılan: harici ekran varsa o, yoksa birincil
      const ext = displays.find((d) => !d.isPrimary);
      selectedDisplayIds = [(ext || displays[0]).id];
    }
    cfg.display.ids = selectedDisplayIds.slice();
    cfg.display.id = selectedDisplayIds[0] != null ? selectedDisplayIds[0] : null;
  }

  function displaySummary() {
    if (!selectedDisplayIds.length) return 'Ekran seçilmedi';
    if (selectedDisplayIds.length === 1) {
      const d = displays.find((x) => x.id === selectedDisplayIds[0]);
      return d ? d.label : 'Ekran';
    }
    return selectedDisplayIds.length + ' ekran seçili';
  }

  function renderDisplays() {
    syncSelectedDisplays();
    const btn = $('displayBtn');
    const menu = $('displayMenu');
    if (!btn || !menu) return;

    btn.textContent = displaySummary();
    btn.title = selectedDisplayIds
      .map((id) => (displays.find((d) => d.id === id) || {}).label)
      .filter(Boolean)
      .join(', ');

    menu.innerHTML = '';
    displays.forEach((d) => {
      const box = el('input', {
        type: 'checkbox',
        onchange: (e) => {
          if (e.target.checked) {
            if (selectedDisplayIds.indexOf(d.id) === -1) selectedDisplayIds.push(d.id);
          } else {
            selectedDisplayIds = selectedDisplayIds.filter((x) => x !== d.id);
          }
          syncSelectedDisplays();
          push(false);
          renderDisplays();
          render(); // Çıkış kategorisindeki ekran listesi de tazelensin
          // Görselleştirme açıkken seçim değişirse pencereler anında uysun
          if (visOpen) window.api.openVisualizer(selectedDisplayIds);
        },
      });
      box.checked = selectedDisplayIds.indexOf(d.id) >= 0;
      menu.appendChild(
        el('label', {}, [
          box,
          el('span', { text: d.label }),
          el('span', { class: 'dm-sub', text: d.size.width + '×' + d.size.height }),
        ])
      );
    });
    menu.appendChild(
      el('div', {
        class: 'dm-note',
        text: 'Birden fazla ekran seçerseniz görselleştirme hepsinde aynı anda açılır. ESC hepsini kapatır.',
      })
    );
  }

  // Menüyü aç/kapat ve dışarı tıklayınca kapat
  function setupDisplayMenu() {
    const btn = $('displayBtn');
    const menu = $('displayMenu');
    if (!btn || !menu) return;
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const open = menu.classList.toggle('hidden') === false;
      btn.setAttribute('aria-expanded', String(open));
    });
    document.addEventListener('click', (e) => {
      if (menu.classList.contains('hidden')) return;
      if (menu.contains(e.target) || btn.contains(e.target)) return;
      menu.classList.add('hidden');
      btn.setAttribute('aria-expanded', 'false');
    });
  }

  // --------------------------------------------------------------------------
  // Karartma — yayın sırasındaki "panik" düğmesi
  //
  // Görselleştirmeyi KAPATMAZ: arkaplanı düz siyaha, ön efekti kapalıya alır ve
  // önceki görünümü hatırlar. Tekrar basınca aynen geri gelir.
  // --------------------------------------------------------------------------
  let blackoutSaved = null;

  function isBlackedOut() {
    return !!blackoutSaved;
  }

  function toggleBlackout() {
    const btn = $('blackoutBtn');
    if (blackoutSaved) {
      cfg.background.type = blackoutSaved.bg;
      cfg.background.solidColor = blackoutSaved.solid;
      cfg.visualizer.type = blackoutSaved.vis;
      cfg.images.enabled = blackoutSaved.images;
      cfg.media.enabled = blackoutSaved.media;
      cfg.logo.enabled = blackoutSaved.logo;
      blackoutSaved = null;
    } else {
      blackoutSaved = {
        bg: cfg.background.type,
        solid: cfg.background.solidColor,
        vis: cfg.visualizer.type,
        images: !!(cfg.images && cfg.images.enabled),
        media: !!(cfg.media && cfg.media.enabled),
        logo: !!(cfg.logo && cfg.logo.enabled),
      };
      cfg.background.type = 'solid';
      cfg.background.solidColor = '#000000';
      cfg.visualizer.type = 'none';
      if (cfg.images) cfg.images.enabled = false;
      if (cfg.media) cfg.media.enabled = false;
      if (cfg.logo) cfg.logo.enabled = false;
    }
    if (btn) {
      btn.classList.toggle('on', !!blackoutSaved);
      btn.textContent = blackoutSaved ? '☀ Karartmayı Kaldır' : '🌑 Karart';
    }
    push(true);
    render();
  }

  // --------------------------------------------------------------------------
  // Durum
  // --------------------------------------------------------------------------
  function setStatus(open, displayIds) {
    visOpen = open;
    const n = Array.isArray(displayIds) ? displayIds.length : open ? 1 : 0;
    $('statusDot').className = 'dot ' + (open ? 'on' : 'off');
    $('statusText').textContent = open ? (n > 1 ? n + ' ekranda açık' : 'Açık') : 'Kapalı';
    // Seçim değişmişse açıkken de yeniden uygulanabilsin
    $('openBtn').disabled = false;
    $('closeBtn').disabled = !open;
    $('openBtn').textContent = open ? '▶ Ekranları Uygula' : '▶ Görselleştirmeyi Aç';
    // Görselleştirici açıkken yakalama zaten sürüyor; önizleme kareleri bedava
    syncPreviewSubscription();
  }

  function setAudioState(text, cls) {
    const a = $('audioState');
    a.textContent = text;
    a.title = text; // kısaltılan uzun aygıt adları için tam metin
    a.className = 'audio-state' + (cls ? ' ' + cls : '');
  }

  function setMeter(id, v) {
    $(id).style.width = Math.min(100, Math.max(0, v * 100)) + '%';
  }

  // --------------------------------------------------------------------------
  // Ses aygıtı tanılama / otomatik kurtarma
  // --------------------------------------------------------------------------
  function diagnosticText(result) {
    const code = result?.error?.code || 'UNKNOWN';
    const english = result?.error?.message || 'Audio device detection failed.';
    if (window.SVI18n?.locale !== 'tr') {
      return `${english} [${code}]${result?.retried ? ' Automatic retry was unsuccessful.' : ''}`;
    }
    const tr = {
      NODE_NOT_FOUND: 'Node.js bulunamadı. Node.js LTS kurun veya PATH ayarını onarın.',
      HELPER_MISSING: 'Ses yardımcı dosyaları kurulumda eksik. Uygulamayı yeniden kurun veya onarın.',
      AUDIFY_MISSING: 'Native ses modülü eksik. Uygulamayı yeniden kurun veya onarın.',
      NATIVE_ABI_MISMATCH: 'Native ses modülü bu Node.js sürümüyle uyumsuz. Node.js LTS ve uygulamayı yeniden kurun.',
      ACCESS_DENIED: 'Windows ses sistemine erişimi engelledi. Ses gizlilik/güvenlik ayarlarını kontrol edip uygulamayı yeniden başlatın.',
      DEVICE_ENUM_TIMEOUT: 'Ses aygıtı algılama zaman aşımına uğradı. Windows Ses hizmetini ve bağlı aygıtları kontrol edin.',
      NO_DEVICES: 'Etkin ses aygıtı bulunamadı. Windows Ses ayarlarını kontrol edin ve aygıtı yeniden bağlayın.',
      INVALID_HELPER_OUTPUT: 'Ses yardımcı süreci geçersiz veri döndürdü.',
      HELPER_EXITED: 'Ses yardımcı süreci beklenmedik şekilde kapandı.',
      PROCESS_START_FAILED: 'Ses yardımcı süreci başlatılamadı.',
      UNKNOWN: 'Ses aygıtı algılanamadı.'
    };
    return `${tr[code] || english} [${code}]${result?.retried ? ' Otomatik yeniden deneme başarısız oldu.' : ''}`;
  }

  function applyAudioDiagnostic(result, showSuccess = false) {
    audioDevices = result?.devices || [];
    if (result?.ok) {
      if (showSuccess) setAudioState(window.SVI18n?.locale === 'tr' ? `✓ ${audioDevices.length} ses aygıtı bulundu` : `✓ ${audioDevices.length} audio devices detected`, 'ok');
      $('banner').classList.add('hidden');
      return;
    }
    setAudioState(window.SVI18n?.locale === 'tr' ? '⚠ Ses aygıtı tanılaması başarısız' : '⚠ Audio device diagnostics failed', 'err');
    $('bannerDetail').textContent = diagnosticText(result);
    $('banner').classList.remove('hidden');
  }

  actions.refreshDevices = async () => {
    setAudioState(window.SVI18n?.locale === 'tr' ? 'Ses aygıtları tanılanıyor…' : 'Diagnosing audio devices…');
    const result = await window.api.diagnoseAudio();
    applyAudioDiagnostic(result, true);
    render();
  };

  actions.repairAudio = async () => {
    const button = $('repairAudioBtn');
    if (button) {
      button.disabled = true;
      button.textContent = window.SVI18n?.locale === 'tr' ? 'Onarılıyor…' : 'Repairing…';
    }
    try {
      const result = await window.api.repairAudio();
      if (result?.cancelled) return;
      if (result?.ok) {
        applyAudioDiagnostic(result.diagnostic, true);
        render();
        return;
      }
      const diagnostic = result?.diagnostic || {};
      applyAudioDiagnostic(diagnostic, false);
      if (result?.repairError) {
        $('bannerDetail').textContent = `${result.repairError.message} [${result.repairError.code}]`;
      } else if (result?.requiresManualAction) {
        const suffix = window.SVI18n?.locale === 'tr'
          ? ' Bu hata için güvenli otomatik kurulum yok; yukarıdaki öneriyi uygulayın.'
          : ' No safe automatic installation is available for this error; follow the recommendation above.';
        $('bannerDetail').textContent = diagnosticText(diagnostic) + suffix;
      }
      $('banner').classList.remove('hidden');
    } catch (error) {
      $('bannerDetail').textContent = `${window.SVI18n?.locale === 'tr' ? 'Otomatik onarım başlatılamadı' : 'Automatic repair could not start'}: ${error.message}`;
      $('banner').classList.remove('hidden');
    } finally {
      if (button) {
        button.disabled = false;
        button.textContent = window.SVI18n?.locale === 'tr' ? 'Otomatik Onar' : 'Automatic Repair';
      }
    }
  };

  // --------------------------------------------------------------------------
  // Kullanıcı renk şablonları
  // --------------------------------------------------------------------------
  function uid(prefix) {
    return prefix + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
  }
  function ensurePresets() {
    if (!Array.isArray(cfg.userPresets)) cfg.userPresets = [];
    return cfg.userPresets;
  }

  actions.saveCurrentPreset = () => {
    const arr = ensurePresets();
    const colors = (cfg.background.gradient.colors || []).slice(0, 5);
    while (colors.length < 5) colors.push(colors[colors.length - 1] || '#000000');
    arr.push({ id: uid('up_'), name: 'Şablonum ' + (arr.length + 1), colors });
    push(true);
    render();
  };
  actions.applyUserPreset = (id) => {
    const p = ensurePresets().find((x) => x.id === id);
    if (!p) return;
    cfg.background.gradient.colors = (p.colors || []).slice();
    push(true);
    render();
  };
  actions.updateUserPreset = (id) => {
    const p = ensurePresets().find((x) => x.id === id);
    if (!p) return;
    p.colors = (cfg.background.gradient.colors || []).slice(0, 5);
    push(true);
    render();
  };
  actions.deleteUserPreset = async (id) => {
    if (!(await svConfirm('Bu renk şablonu silinecek.', { danger: true, okText: 'Sil' }))) return;
    cfg.userPresets = ensurePresets().filter((x) => x.id !== id);
    push(true);
    render();
  };
  actions.exportPresets = async () => {
    const arr = ensurePresets();
    if (!arr.length) { svToast('Dışa aktarılacak şablon yok.', 'warn'); return; }
    await window.api.exportJson('renk-sablonlari.json', { type: 'sv-presets', version: 1, presets: arr });
  };
  actions.importPresets = async () => {
    const r = await window.api.importJson('Renk Şablonlarını İçe Aktar');
    if (!r || !r.ok) { if (r && r.error) svToast('İçe aktarılamadı: ' + r.error, 'err'); return; }
    const incoming = Array.isArray(r.data) ? r.data : (r.data && r.data.presets) || [];
    if (!Array.isArray(incoming) || !incoming.length) { svToast('Dosyada şablon bulunamadı.', 'warn'); return; }
    const arr = ensurePresets();
    incoming.forEach((p) => {
      let colors = Array.isArray(p.colors) ? p.colors.slice(0, 5) : [];
      if (!colors.length) return;
      while (colors.length < 5) colors.push(colors[colors.length - 1]);
      arr.push({ id: uid('up_'), name: (p.name || 'İçe Aktarılan').toString(), colors });
    });
    push(true);
    render();
  };

  // --------------------------------------------------------------------------
  // Canlı önizleme kurulumu
  // --------------------------------------------------------------------------
  function setupPreview() {
    if (!window.SVPreview) return;
    const pill = $('previewSource');

    const setPill = (live) => {
      if (!pill) return;
      pill.textContent = live ? 'Canlı' : 'Demo';
      pill.title = live
        ? 'Gerçek ses yakalanıyor — demo sinyaline dönmek için tıklayın'
        : 'Örnek sinyalle sürülüyor — gerçek sesi yakalamak için tıklayın';
      pill.classList.toggle('live', live);
      // Gerçek ses kesildiğinde çubuklar donmuş değerde kalmasın
      if (!live && !visOpen) ['mLevel', 'mBass', 'mMid', 'mTreble'].forEach((id) => setMeter(id, 0));
    };

    const ok = window.SVPreview.init({ onSourceChange: setPill });
    if (!ok) return; // önizleme kurulamadı: kare de istemeyiz (bkz. syncPreviewSubscription)
    previewReady = true;
    setPill(false);
    window.SVPreview.setConfig(cfg);

    if (window.api.onNativeAudio) window.api.onNativeAudio((f) => window.SVPreview.ingest(f));

    // Gerçek ses yakalaması yalnızca istendiğinde başlar. Görselleştirici zaten
    // açıkken yakalama sürdüğü için kareler bedavaya gelir; bu durumda otomatik
    // olarak açılır.
    syncPreviewSubscription();

    if (pill) {
      pill.style.cursor = 'pointer';
      pill.addEventListener('click', () => {
        previewWantsLive = !previewWantsLive;
        localStorage.setItem('sv-preview-live', previewWantsLive ? '1' : '0');
        syncPreviewSubscription();
      });
    }

    // Görselleştirici kapalıyken ana süreçten 'audio-meter' gelmez; önizleme
    // gerçek ses alıyorsa seviye çubuklarını onun çözümleyicisinden besle.
    // (Demo sinyalinde çubuklar kasten boş kalır — gerçek ses yok demektir.)
    setInterval(() => {
      if (visOpen || !window.SVPreview.isLive() || window.SVPreview.isPaused()) return;
      const l = window.SVPreview.getLevels();
      if (!l) return;
      setMeter('mLevel', l.level);
      setMeter('mBass', l.bass);
      setMeter('mMid', l.mid);
      setMeter('mTreble', l.treble);
    }, 50);

    const btn = $('previewToggle');
    if (btn) {
      btn.addEventListener('click', () => {
        const next = !window.SVPreview.isPaused();
        window.SVPreview.setPaused(next);
        btn.textContent = next ? '▶' : '⏸';
        btn.title = next ? 'Önizlemeyi başlat' : 'Önizlemeyi duraklat';
        syncPreviewSubscription();
      });
    }
  }

  // Panelin ana süreçten ses karesi isteyip istemediğini güncelle
  function syncPreviewSubscription() {
    if (!window.api.subscribePreview || !window.SVPreview) return;
    // Önizleme kurulamadıysa kare istemeyiz; aksi halde ana süreç kimsenin
    // dinlemediği bir yakalama başlatır
    if (!previewReady) {
      window.api.subscribePreview(false);
      return;
    }
    const paused = window.SVPreview.isPaused();
    window.api.subscribePreview(!paused && (previewWantsLive || visOpen));
  }

  // --------------------------------------------------------------------------
  // Arama kutusu kurulumu
  // --------------------------------------------------------------------------
  function setupSearch() {
    const input = $('searchInput');
    const box = $('searchResults');
    if (!input || !box) return;

    input.addEventListener('input', () => renderSearchResults(input.value));
    input.addEventListener('focus', () => {
      if (input.value.trim()) renderSearchResults(input.value);
    });
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        input.value = '';
        box.classList.add('hidden');
        input.blur();
        return;
      }
      const items = Array.from(box.querySelectorAll('.sr-item'));
      if (!items.length) return;
      const idx = items.findIndex((x) => x.classList.contains('active'));
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault();
        const next = e.key === 'ArrowDown'
          ? Math.min(items.length - 1, idx + 1)
          : Math.max(0, idx - 1);
        items.forEach((x) => x.classList.remove('active'));
        items[next].classList.add('active');
        items[next].scrollIntoView({ block: 'nearest' });
      } else if (e.key === 'Enter') {
        e.preventDefault();
        (items[idx < 0 ? 0 : idx] || items[0]).click();
      }
    });

    document.addEventListener('click', (e) => {
      if (!e.target.closest('.topsearch')) box.classList.add('hidden');
    });
    document.addEventListener('keydown', (e) => {
      if ((e.ctrlKey || e.metaKey) && (e.key === 'k' || e.key === 'K')) {
        e.preventDefault();
        input.focus();
        input.select();
      }
    });
  }

  // --------------------------------------------------------------------------
  // Sahneler — tüm görünümün adlandırılmış anlık görüntüsü
  // --------------------------------------------------------------------------
  function ensureScenes() {
    if (!Array.isArray(cfg.scenes)) cfg.scenes = [];
    return cfg.scenes;
  }

  function snapshotScene() {
    const data = {};
    SCENE_KEYS.forEach((k) => {
      if (cfg[k] !== undefined) data[k] = window.SV.clone(cfg[k]);
    });
    return data;
  }

  actions.saveScene = () => {
    const arr = ensureScenes();
    // Electron window.prompt'u uygulamaz (çağrı sessizce undefined döner), bu
    // yüzden sahne varsayılan adla oluşturulur ve ad alanı düzenlemeye açılır.
    const name = 'Sahne ' + (arr.length + 1);
    const scene = { id: uid('sc_'), name, createdAt: Date.now(), data: snapshotScene() };
    arr.push(scene);
    sceneActionInFlight = true;
    activeSceneId = scene.id;
    push(true);
    sceneActionInFlight = false;
    render();
    renderScenes();
    // Adı hemen yazabilmek için yeni sahnenin ad alanını seç
    requestAnimationFrame(() => {
      const list = $('sceneList');
      const item = list && list.querySelector('.scene-item.active .scene-name');
      if (item) {
        item.focus();
        item.select();
      }
    });
  };

  actions.applyScene = (id) => {
    const sc = ensureScenes().find((x) => x.id === id);
    if (!sc || !sc.data) return;
    SCENE_KEYS.forEach((k) => {
      if (sc.data[k] === undefined) return;
      // Eksik alanlar varsayılanla tamamlanır (eski/dış kaynaklı sahneler için)
      cfg[k] = window.SV.deepMerge(window.SV.DEFAULT_CONFIG[k], sc.data[k]);
    });
    if (cfg.images && Array.isArray(cfg.images.items)) {
      cfg.images.items = cfg.images.items.map((it) => window.SV.normalizeImageItem(it));
    }
    sceneActionInFlight = true;
    activeSceneId = id;
    push(true);
    sceneActionInFlight = false;
    render();
    renderScenes();
  };

  actions.updateScene = (id) => {
    const sc = ensureScenes().find((x) => x.id === id);
    if (!sc) return;
    sc.data = snapshotScene();
    sceneActionInFlight = true;
    activeSceneId = id;
    push(true);
    sceneActionInFlight = false;
    render();
    renderScenes();
  };

  actions.renameScene = (id, name) => {
    const sc = ensureScenes().find((x) => x.id === id);
    if (!sc) return;
    sc.name = (name || '').trim() || sc.name;
    sceneActionInFlight = true; // yalnızca ad değişti, görünüm aynı kaldı
    push(true);
    sceneActionInFlight = false;
    renderScenes();
    // Kitaplık kategorisindeki sahne kartı da aynı adı göstermeli
    if (activeCategory === 'library') render();
  };

  actions.deleteScene = async (id) => {
    if (!(await svConfirm('Bu sahne silinecek.', { danger: true, okText: 'Sil' }))) return;
    cfg.scenes = ensureScenes().filter((x) => x.id !== id);
    if (activeSceneId === id) activeSceneId = null;
    push(true);
    render();
    renderScenes();
  };

  actions.exportScenes = async () => {
    const arr = ensureScenes();
    if (!arr.length) { svToast('Dışa aktarılacak sahne yok.', 'warn'); return; }
    await window.api.exportJson('sahneler.json', { type: 'sv-scenes', version: 1, scenes: arr });
  };

  actions.importScenes = async () => {
    const r = await window.api.importJson('Sahneleri İçe Aktar');
    if (!r || !r.ok) { if (r && r.error) svToast('İçe aktarılamadı: ' + r.error, 'err'); return; }
    const incoming = Array.isArray(r.data) ? r.data : (r.data && r.data.scenes) || [];
    if (!Array.isArray(incoming) || !incoming.length) { svToast('Dosyada sahne bulunamadı.', 'warn'); return; }
    const arr = ensureScenes();
    incoming.forEach((s) => {
      if (!s || !s.data) return;
      arr.push({
        id: uid('sc_'),
        name: (s.name || 'İçe Aktarılan').toString(),
        createdAt: s.createdAt || Date.now(),
        data: s.data,
      });
    });
    push(true);
    render();
    renderScenes();
  };

  // Sağ dock'taki sahne listesi
  function renderScenes() {
    const host = $('sceneList');
    if (!host) return;
    host.innerHTML = '';
    const arr = ensureScenes();
    if (!arr.length) {
      host.appendChild(
        el('div', { class: 'scene-empty', text: 'Kayıtlı sahne yok. “＋ Kaydet” ile mevcut görünümü saklayın.' })
      );
      return;
    }
    arr.forEach((sc) => {
      const thumb = el('div', {
        class: 'scene-thumb',
        title: 'Bu sahneyi uygula',
        style: 'background:' + sceneGradient(sc),
        onclick: () => actions.applyScene(sc.id),
      });
      const name = el('input', { class: 'scene-name', type: 'text', value: sc.name || 'Sahne', title: 'Sahne adı' });
      name.addEventListener('change', () => actions.renameScene(sc.id, name.value));
      host.appendChild(
        el('div', { class: 'scene-item' + (sc.id === activeSceneId ? ' active' : '') }, [
          thumb,
          el('div', { class: 'scene-main' }, [name, el('div', { class: 'scene-meta', text: sceneSummary(sc) })]),
          el('div', { class: 'scene-acts' }, [
            el('button', { class: 'icon-btn small', type: 'button', text: '⟳', title: 'Mevcut görünümle güncelle', onclick: () => actions.updateScene(sc.id) }),
            el('button', { class: 'icon-btn small', type: 'button', text: '🗑', title: 'Sil', onclick: () => actions.deleteScene(sc.id) }),
          ]),
        ])
      );
    });
  }

  // --------------------------------------------------------------------------
  // Tüm ayarları içe/dışa aktarma
  // Kullanıcının kendi içeriği (renk şablonları ve sahneler) yedeğe DAHİL EDİLMEZ
  // ve içe aktarma sırasında korunur; ikisinin de kendi dışa aktarımı var.
  // --------------------------------------------------------------------------
  const USER_CONTENT_KEYS = ['userPresets', 'scenes'];

  function cloneWithoutUserContent(value) {
    const cloned = JSON.parse(JSON.stringify(value || {}));
    USER_CONTENT_KEYS.forEach((k) => delete cloned[k]);
    return cloned;
  }

  actions.exportAllSettings = async () => {
    const settings = cloneWithoutUserContent(cfg);
    settings.display = settings.display || {};
    settings.display.ids = selectedDisplayIds.slice();
    settings.display.id = selectedDisplayIds[0] != null ? selectedDisplayIds[0] : null;
    const result = await window.api.exportJson('cayadev-visualizer-ayarlari.json', {
      type: 'cayadev-visualizer-settings',
      version: 1,
      appVersion: '1.3.1',
      exportedAt: new Date().toISOString(),
      excludes: USER_CONTENT_KEYS.slice(),
      settings,
    });
    if (result && result.error) svToast('Ayarlar dışa aktarılamadı: ' + result.error, 'err');
  };

  actions.importAllSettings = async () => {
    const result = await window.api.importJson('CAYADEV Visualizer Ayarlarını İçe Aktar');
    if (!result || !result.ok) {
      if (result && result.error) svToast('Ayarlar içe aktarılamadı: ' + result.error, 'err');
      return;
    }
    const payload = result.data;
    const incoming = payload && payload.type === 'cayadev-visualizer-settings' ? payload.settings : null;
    if (!incoming || typeof incoming !== 'object' || Array.isArray(incoming)) {
      svToast('Bu dosya geçerli bir CAYADEV Visualizer ayar yedeği değil.', 'err');
      return;
    }
    const proceed = await svConfirm('Mevcut ayarlar yedekteki değerlerle değiştirilecek. Renk şablonlarınız ve sahneleriniz korunacak.', { okText: 'İçe aktar' });
    if (!proceed) return;

    // Kullanıcı içeriğini yedekten bağımsız olarak koru
    const preservedPresets = Array.isArray(cfg.userPresets) ? cfg.userPresets : [];
    const preservedScenes = Array.isArray(cfg.scenes) ? cfg.scenes : [];
    const sanitized = cloneWithoutUserContent(incoming);
    cfg = window.SV.deepMerge(window.SV.defaultConfig(), sanitized);
    cfg.userPresets = preservedPresets;
    cfg.scenes = preservedScenes;
    if (cfg.images && Array.isArray(cfg.images.items)) {
      cfg.images.items = cfg.images.items.map((item) => window.SV.normalizeImageItem(item));
    }
    if (cfg.display) {
      // Eski kayıtlar tek kimlik tutuyordu; listeye yükselt
      const ids = Array.isArray(cfg.display.ids) && cfg.display.ids.length
        ? cfg.display.ids
        : cfg.display.id != null ? [cfg.display.id] : [];
      selectedDisplayIds = ids.map(Number);
    }
    renderDisplays();
    push(true);
    render();
    renderScenes();
    svToast('Ayarlar başarıyla içe aktarıldı. Renk şablonlarınız ve sahneleriniz değiştirilmedi.', 'ok');
  };

  // --------------------------------------------------------------------------
  // Arkaplan ayarları içe/dışa aktarma
  // --------------------------------------------------------------------------
  actions.exportBackground = async () => {
    await window.api.exportJson('arkaplan-ayarlari.json', { type: 'sv-background', version: 1, background: cfg.background });
  };
  actions.importBackground = async () => {
    const r = await window.api.importJson('Arkaplan Ayarlarını İçe Aktar');
    if (!r || !r.ok) { if (r && r.error) svToast('İçe aktarılamadı: ' + r.error, 'err'); return; }
    const bg = r.data && (r.data.background || (r.data.type && r.data.gradient ? r.data : null));
    if (!bg) { svToast('Geçerli bir arkaplan dosyası değil.', 'err'); return; }
    const def = window.SV.defaultConfig().background;
    cfg.background = window.SV.deepMerge(def, bg);
    push(true);
    render();
  };

  // --------------------------------------------------------------------------
  // Ek görsel nesneler
  // --------------------------------------------------------------------------
  function pickImageFile(cb) {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'image/*';
    input.style.display = 'none';
    input.addEventListener('change', () => {
      const file = input.files && input.files[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = () => cb(reader.result);
      reader.readAsDataURL(file);
    });
    document.body.appendChild(input);
    input.click();
    setTimeout(() => input.remove(), 1000);
  }
  function ensureImages() {
    if (!cfg.images) cfg.images = { enabled: false, items: [] };
    if (!Array.isArray(cfg.images.items)) cfg.images.items = [];
    return cfg.images;
  }

  actions.addImage = () => {
    pickImageFile((dataUrl) => {
      const imgs = ensureImages();
      const item = window.SV.imageItem({ src: dataUrl, name: 'Görsel ' + (imgs.items.length + 1) });
      imgs.items.push(item);
      imgs.enabled = true;
      push(true);
      render();
    });
  };
  actions.replaceImage = (id) => {
    pickImageFile((dataUrl) => {
      const imgs = ensureImages();
      const it = imgs.items.find((x) => x.id === id);
      if (!it) return;
      it.src = dataUrl;
      push(true);
      render();
    });
  };
  actions.removeImage = (id) => {
    const imgs = ensureImages();
    imgs.items = imgs.items.filter((x) => x.id !== id);
    push(true);
    render();
  };

  // --------------------------------------------------------------------------
  // Video dışa aktarma
  // --------------------------------------------------------------------------
  function setExportStatus(text, cls) {
    const s = $('exportStatus');
    if (!s) return;
    s.textContent = text || '';
    s.className = 'export-status' + (cls ? ' ' + cls : '');
  }

  function setExportUI(active) {
    const run = $('exportRunBtn');
    const cancel = $('exportCancelBtn');
    const bar = $('exportProgressBar');
    if (run) run.disabled = active;
    if (cancel) cancel.style.display = active ? 'inline-flex' : 'none';
    if (bar) bar.style.display = active ? 'block' : 'none';
    if (!active) {
      const fill = $('exportProgressFill');
      if (fill) fill.style.width = '0%';
    }
  }

  actions.runExport = async () => {
    if (exporting) return;
    if (!exportAudioPath) {
      setExportStatus('Önce bir ses dosyası seçin.', 'err');
      return;
    }
    const base = (exportAudioName || 'gorsellestirme').replace(/\.[^.]+$/, '');
    const outputPath = await window.api.pickExportOutput(base + '.mp4');
    if (!outputPath) return;

    push(true); // en güncel görsel ayarları ana sürece gönder

    const r = await window.api.startExport({
      audioPath: exportAudioPath,
      outputPath,
      resolution: cfg.export.resolution,
      fps: cfg.export.fps,
      quality: cfg.export.quality,
      encoder: cfg.export.encoder,
      speed: cfg.export.speed,
    });
    if (!r || !r.ok) {
      setExportStatus('⚠ ' + ((r && r.error) || 'Başlatılamadı'), 'err');
      return;
    }
    exporting = true;
    setExportUI(true);
    setExportStatus('Hazırlanıyor…');
  };

  async function init() {
    const saved = await window.api.getSettings();
    if (saved) cfg = window.SV.deepMerge(window.SV.defaultConfig(), saved);

    // Eski/eksik görsel nesneleri varsayılan alanlarla tamamla
    if (cfg.images && Array.isArray(cfg.images.items)) {
      cfg.images.items = cfg.images.items.map((it) => window.SV.normalizeImageItem(it));
    }
    if (!Array.isArray(cfg.userPresets)) cfg.userPresets = [];
    if (!Array.isArray(cfg.scenes)) cfg.scenes = [];

    displays = await window.api.getDisplays();
    if (cfg.display) {
      // Eski kayıtlar tek kimlik tutuyordu; listeye yükselt
      const ids = Array.isArray(cfg.display.ids) && cfg.display.ids.length
        ? cfg.display.ids
        : cfg.display.id != null ? [cfg.display.id] : [];
      selectedDisplayIds = ids.map(Number);
    }
    const audioDiagnostic = await window.api.diagnoseAudio();
    audioDevices = audioDiagnostic?.devices || [];
    try {
      lightingIdentity = await window.api.getLightingIdentityStatus();
    } catch {
      lightingIdentity = { portable: false, packaged: false, hasIdentity: false, canInstall: false };
    }
    try {
      lightingInfo = await window.api.scanLighting();
    } catch {
      lightingInfo = { ok: false, supported: false, devices: [] };
    }
    try {
      lightingAvailability = await window.api.getLightingAvailability();
    } catch {
      lightingAvailability = { ok: false, devices: [], availableCount: 0, totalCount: lightingInfo.devices?.length || 0 };
    }
    if (!lightingInfo.devices?.length && cfg.lighting) {
      cfg.lighting.enabled = false;
    }

    // GPU (NVENC) kodlayıcı var mı? Yoksa CPU'ya zorla.
    try { gpuAvailable = !!(await window.api.gpuAvailable()); } catch { gpuAvailable = false; }
    if (!gpuAvailable && cfg.export && cfg.export.encoder === 'gpu') {
      cfg.export.encoder = 'cpu';
    }

    // Arayüz durumunu geri yükle
    const advBox = $('advToggle');
    if (advBox) advBox.checked = advancedOn;
    if (!CATEGORIES.some((c) => c.id === activeCategory)) activeCategory = CATEGORIES[0].id;

    // Seçili arayüz dilini ana sürece bildir (diyaloglar ve yayın sayfaları)
    try { window.api.setUiLanguage(window.SVI18n.locale); } catch { /* i18n yok */ }

    // Studio presetleri (kullanıcının kendi shader/varyasyon tasarımları).
    // render() bunlara bakacağı için ÇİZİMDEN ÖNCE yüklenmeli.
    try {
      window.SVPresets.setUser(await window.api.listPresets());
    } catch { /* preset yoksa yerleşiklerle devam */ }
    window.api.onPresets((list) => {
      window.SVPresets.setUser(list);
      render();
      if (window.SVPreview) window.SVPreview.setConfig(cfg);
    });

    // Uzaktan kumandadan (telefon / OBS sayfası) gelen değişiklik: panelin
    // kendi kopyası tazelenir ve geri gönderilmez — yoksa sonsuz döngü olur.
    window.api.onExternalConfig((incoming) => {
      cfg = window.SV.deepMerge(window.SV.defaultConfig(), incoming);
      render();
      renderScenes();
      if (window.SVPreview) window.SVPreview.setConfig(cfg);
    });

    // Kontrol yüzeyleri (MIDI / OSC)
    if (window.SVControl) window.SVControl.init();
    // Tempo motoru ve otomatik VJ döngüsü
    if (window.SVAutoVJ) window.SVAutoVJ.init();
    if (window.SVMappingPanel) window.SVMappingPanel.init();
    if (window.SVMilkdropPanel) window.SVMilkdropPanel.init();
    // Yayın sunucusu durumu
    if (window.SVStream) window.SVStream.init();
    // Kamera listesi (medya katmanı için)
    if (window.SVMediaPanel) window.SVMediaPanel.init();

    renderDisplays();
    render();
    renderScenes();
    setupPreview();
    setupSearch();
    applyAudioDiagnostic(audioDiagnostic, false);

    visOpen = await window.api.visualizerIsOpen();
    setStatus(visOpen);

    let lastLightingAvailabilityKey = `${lightingAvailability.availableCount || 0}/${lightingAvailability.totalCount || 0}`;
    const refreshLightingAvailability = async () => {
      if (!cfg.lighting?.enabled) return;
      try {
        const next = await window.api.getLightingAvailability();
        const key = `${next.availableCount || 0}/${next.totalCount || 0}`;
        lightingAvailability = next;
        if (key !== lastLightingAvailabilityKey) {
          lastLightingAvailabilityKey = key;
          render();
        }
      } catch {}
    };
    setInterval(refreshLightingAvailability, 1500);
    window.addEventListener('focus', refreshLightingAvailability);
    document.addEventListener('visibilitychange', () => {
      if (!document.hidden) refreshLightingAvailability();
    });

    // Olaylar
    setupDisplayMenu();
    $('openBtn').addEventListener('click', async () => {
      await window.api.openVisualizer(selectedDisplayIds);
      push(true); // en güncel yapılandırmayı gönder
    });
    $('closeBtn').addEventListener('click', () => window.api.closeVisualizer());
    $('blackoutBtn').addEventListener('click', toggleBlackout);
    $('resetBtn').addEventListener('click', async () => {
      if (!(await svConfirm('Tüm ayarlar varsayılana dönecek. Renk şablonlarınız ve sahneleriniz korunur.', { danger: true, okText: 'Hepsini sıfırla' }))) return;
      const sources = cfg.audio.sources ? cfg.audio.sources.slice() : ['default'];
      // Kullanıcı içeriği (renk şablonları ve sahneler) sıfırlamada korunur
      const presets = Array.isArray(cfg.userPresets) ? cfg.userPresets.slice() : [];
      const scenes = Array.isArray(cfg.scenes) ? cfg.scenes.slice() : [];
      cfg = window.SV.defaultConfig();
      cfg.audio.sources = sources;
      cfg.userPresets = presets;
      cfg.scenes = scenes;
      activeSceneId = null;
      push(true);
      render();
      renderScenes();
    });

    // Ayarlar penceresindeki uygulama anahtarları
    const aotBox = $('alwaysOnTopToggle');
    if (aotBox) {
      aotBox.checked = !!(cfg.power && cfg.power.alwaysOnTop);
      aotBox.addEventListener('change', (e) => {
        cfg.power = cfg.power || {};
        cfg.power.alwaysOnTop = e.target.checked;
        push(true);
        svToast(
          e.target.checked
            ? 'Görselleştirme artık her zaman üstte kalacak.'
            : 'Her zaman üstte kapatıldı.',
          'ok'
        );
      });
    }
    const extBox = $('extendedRangeToggle');
    if (extBox) {
      extBox.checked = extendedRange;
      extBox.addEventListener('change', (e) => {
        extendedRange = e.target.checked;
        localStorage.setItem('sv-extended-range', extendedRange ? '1' : '0');
        render();
        svToast(
          extendedRange
            ? 'Genişletilmiş aralıklar açık — kaydırıcılar 5 kat daha yükseğe çıkabilir.'
            : 'Genişletilmiş aralıklar kapatıldı. Mevcut yüksek değerler korunur.',
          'ok'
        );
      });
    }

    // Gelişmiş ayarlar anahtarı + kategori sıfırlama
    $('advToggle').addEventListener('change', (e) => setAdvanced(e.target.checked));
    $('catResetBtn').addEventListener('click', () => resetCategory(activeCategory));

    // Sağ dock'taki sahne düğmeleri
    $('sceneSaveBtn').addEventListener('click', () => actions.saveScene());
    $('sceneExportBtn').addEventListener('click', () => actions.exportScenes());
    $('sceneImportBtn').addEventListener('click', () => actions.importScenes());

    window.api.onVisualizerStatus((d) => setStatus(d.open, d.displayIds));
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

    $('repairAudioBtn').addEventListener('click', actions.repairAudio);
    $('bannerClose').addEventListener('click', () => $('banner').classList.add('hidden'));

    // Video dışa aktarma olayları
    let exportEnc = '';
    window.api.onExportProgress((d) => {
      if (d.phase === 'start') {
        exportEnc = d.encoder === 'gpu' ? 'GPU/NVENC' : 'CPU/libx264';
        return;
      }
      if (d.phase === 'encode') {
        setExportStatus('Kodlanıyor (' + exportEnc + ')… kareler bitti, video yazılıyor.');
        return;
      }
      const pct = d.total ? Math.round((d.done / d.total) * 100) : 0;
      const fill = $('exportProgressFill');
      if (fill) fill.style.width = pct + '%';
      setExportStatus('Render ediliyor [' + exportEnc + ']… %' + pct + '  (' + d.done + ' / ' + d.total + ' kare)');
    });
    window.api.onExportDone((d) => {
      exporting = false;
      setExportUI(false);
      if (d.status === 'done') {
        const enc = d.encoder === 'gpu' ? 'GPU/NVENC' : 'CPU/libx264';
        setExportStatus('✅ Tamamlandı (' + enc + ') → ' + d.output, 'ok');
      } else if (d.status === 'cancelled') {
        setExportStatus('İptal edildi.');
      } else {
        setExportStatus('⚠ Hata: ' + (d.message || 'bilinmeyen hata'), 'err');
      }
    });

    // Açılışta ana sürece de gönder (kalıcılık + senkron)
    push(true);
  }

  // Başlatma sırasında bir hata olursa panel boş kalmasın: nedeni ekranda göster
  function showFatal(err) {
    const msg = (err && (err.stack || err.message)) || String(err);
    console.error('[admin] init failed', err);
    const root = $('sections');
    if (!root) return;
    root.innerHTML = '';
    root.classList.add('single');
    const card = el('div', { class: 'card wide' }, [
      el('div', { class: 'card-head' }, [
        el('span', { class: 'ico', text: '⚠️' }),
        el('div', { class: 'ch-main' }, [
          el('h3', { text: 'Panel başlatılamadı' }),
          el('div', { class: 'desc', text: 'Uygulamayı yeniden başlatın. Sorun sürerse aşağıdaki ayrıntıyı bildirin.' }),
        ]),
      ]),
    ]);
    const pre = el('div', { class: 'settings-io-note' });
    pre.style.whiteSpace = 'pre-wrap';
    pre.style.userSelect = 'text';
    pre.textContent = msg;
    card.appendChild(pre);
    root.appendChild(card);
  }

  init().catch(showFatal);
})();
