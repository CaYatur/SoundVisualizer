/*
 * SoundVisualizer — CaYaDev Ses Görselleştirici
 * Copyright (c) 2026 Çağan Turgut (CaYatur) — CaYaDev, https://cayadev.com
 * https://github.com/CaYatur/SoundVisualizer
 * SPDX-License-Identifier: MIT
 */
'use strict';
/* Yönetici paneli mantığı: şema tabanlı kontrol üretimi, ekran yönetimi,
   canlı seviye göstergesi ve görselleştiriciye anlık yapılandırma gönderimi. */
(function () {
  let cfg = window.SV.defaultConfig();
  let displays = [];
  let selectedDisplayIds = []; // görselleştirmenin açılacağı ekranlar (çoklu)
  let visOpen = false;
  let floatingOpen = false; // yüzen PiP açık mı (visualizer-status.floating)
  let audioDevices = [];
  let audioApps = [];              // o an ses oturumu olan uygulamalar
  let appAudioStatus = null;       // özellik bu makinede kullanılabilir mi
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
  let exportPct = 0;
  let exportStatusText = '';
  let exportStatusCls = '';
  let exportStatusIcon = '';
  let gpuAvailable = false;

  const $ = (id) => document.getElementById(id);
  // Mod listeleri tek kaynaktan (shared/mode-catalog.js, #638)
  const MC = () => window.SVModeCatalog;

  /* Ekran yenileme hızı. "Ekranla Eşitle" seçildiğinde hızın nereden
     geldiği görünmüyordu; kullanıcı ayarın işe yarayıp yaramadığını
     anlayamıyordu. Bulunan hız hem seçeneğe hem de nota yazılıyor. */
  function refreshRates() {
    const ids = selectedDisplayIds && selectedDisplayIds.length ? selectedDisplayIds : null;
    const use = ids ? displays.filter((d) => ids.includes(Number(d.id))) : displays;
    const list = (use.length ? use : displays).map((d) => d.refreshRate).filter((r) => r > 0);
    return Array.from(new Set(list)).sort((a, b) => a - b);
  }
  function refreshNote() {
    const r = refreshRates();
    if (!r.length) return '';
    return 'Bulunan ekran hızı: ' + r.join(' Hz, ') + ' Hz.';
  }

  // --------------------------------------------------------------------------
  // Yapılandırma gönderimi (debounce)
  // --------------------------------------------------------------------------
  function push(immediate) {
    if (isBlackedOut()) {
      cfg.isBlackout = true;
      cfg.background = Object.assign({}, cfg.background, { type: 'solid', solidColor: '#000000' });
      cfg.visualizer = Object.assign({}, cfg.visualizer, { type: 'none' });
      if (cfg.images) cfg.images.enabled = false;
      if (cfg.media) cfg.media.enabled = false;
      if (cfg.logo) cfg.logo.enabled = false;
      if (cfg.text) cfg.text.enabled = false;
      if (Array.isArray(cfg.layers)) {
        cfg.layers = cfg.layers.map((l) => Object.assign({}, l, { enabled: false }));
      }
    } else {
      cfg.isBlackout = false;
    }
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
      sendFullConfig();
      return;
    }
    if (pushTimer) return;
    pushTimer = setTimeout(() => {
      pushTimer = null;
      sendConfigPatch();
    }, 55);
  }

  /* AYAR GÖNDERİMİ (#695).

     Gerçek bir ayar ~640 KB: 22 sahne ~330 KB, MilkDrop etiketleri
     ~290 KB. Kaydırıcı sürüklenirken bütün yapılandırma saniyede ~18 kez
     gidiyordu; panelde her gönderim ~15 ms, ana süreç her açık pencereye
     ve yayına yeniden kopyalıyordu. Ölçüldü: sürüklerken ana sürecin
     yanıtı 0,3 ms'den 14–19 ms'ye (p95 34–42 ms) çıkıyor, Spout penceresi
     kare kaçırıyordu.

     Şimdi push(false) yalnız değişen üst düzey anahtarları yollar. Ağır
     anahtarlar karşılaştırılmaz ve yamaya girmez; sürükleme bittikten
     FULL_AFTER_MS sonra bütün yapılandırma bir kez daha gider, yani bir
     yerin yanlışlıkla kaçırdığı değişiklik de en geç orada yetişir.
     push(true), anahtar kaybolması, karartma ve dış yapılandırmadan sonraki
     ilk gönderim her zaman tamdır. */
  const HEAVY_KEYS = { scenes: 1, milkdropLibrary: 1, userPresets: 1 };
  const FULL_AFTER_MS = 700;
  let sentSig = null;
  let fullTimer = null;

  function lightSig() {
    const m = new Map();
    for (const k of Object.keys(cfg)) {
      if (!HEAVY_KEYS[k]) m.set(k, JSON.stringify(cfg[k]));
    }
    return m;
  }

  function sendFullConfig() {
    if (fullTimer) { clearTimeout(fullTimer); fullTimer = null; }
    window.api.updateConfig(cfg);
    sentSig = window.api.patchConfig ? lightSig() : null;
  }

  function sendConfigPatch() {
    if (!window.api.patchConfig || !sentSig || isBlackedOut()) { sendFullConfig(); return; }
    const sig = lightSig();
    for (const k of sentSig.keys()) {
      if (!sig.has(k)) { sendFullConfig(); return; }
    }
    const patch = {};
    let n = 0;
    for (const [k, v] of sig) {
      if (sentSig.get(k) !== v) { patch[k] = cfg[k]; n++; }
    }
    sentSig = sig;
    if (n) window.api.patchConfig(patch);
    if (fullTimer) clearTimeout(fullTimer);
    fullTimer = setTimeout(() => { fullTimer = null; sendFullConfig(); }, FULL_AFTER_MS);
  }

  /* Pencere kapanırken bekleyen tam gönderim kaybolmasın. */
  function flushConfig() {
    if (pushTimer) { clearTimeout(pushTimer); pushTimer = null; sendFullConfig(); return; }
    if (fullTimer) sendFullConfig();
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
        else if (e.key === 'Enter') {
          e.preventDefault();
          if (document.activeElement === cancelBtn) close(false);
          else close(true);
        }
      };

      const okBtn = el('button', {
        class: 'btn ' + (o.danger ? 'danger' : 'primary'),
        type: 'button',
        text: o.okText || tr('Evet, devam et'),
        onclick: () => close(true),
      });
      const cancelBtn = el('button', {
        class: 'btn ghost', type: 'button', text: o.cancelText || tr('Vazgeç'), onclick: () => close(false),
      });

      const backdrop = el('div', { class: 'ask-backdrop' }, [
        el('div', { class: 'ask-panel', role: 'dialog', 'aria-modal': 'true' }, [
          el('div', { class: 'ask-title', text: o.title || tr('Emin misiniz?') }),
          el('div', { class: 'ask-text', text: message }),
          el('div', { class: 'ask-actions' }, [cancelBtn, okBtn]),
        ]),
      ]);
      backdrop.addEventListener('mousedown', (e) => {
        if (e.target === backdrop) close(false);
      });
      document.body.appendChild(backdrop);
      document.addEventListener('keydown', onKey, true);
      if (o.defaultCancel) cancelBtn.focus();
      else okBtn.focus();
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
  /* Değer değil VARLIK taşıyan öznitelikler (bkz. el()) */
  const BOOL_ATTRS = {
    disabled: 1, checked: 1, selected: 1, readonly: 1, multiple: 1,
    hidden: 1, required: 1, open: 1, autofocus: 1, novalidate: 1,
  };

  function el(tag, props, kids) {
    const e = document.createElement(tag);
    if (props) {
      for (const k in props) {
        if (k === 'class') e.className = props[k];
        else if (k === 'icon') continue;
        else if (k === 'html') e.innerHTML = props[k];
        else if (k === 'text') e.textContent = props[k];
        else if (k.startsWith('on') && typeof props[k] === 'function')
          e.addEventListener(k.slice(2), props[k]);
        /* Mantıksal öznitelikler: HTML'de VARLIKLARI belirleyicidir, değerleri
           değil. setAttribute('disabled', false) öğeyi disabled="false" yapar
           ve düğmeyi KAPATIR. Kayıt/Anlık Görüntü düğmeleri ile MilkDrop içe
           aktarma düğmesi tam bu yüzden hep pasif kalıyordu. */
        else if (BOOL_ATTRS[k]) {
          if (props[k]) e.setAttribute(k, '');
          else e.removeAttribute(k);
        } else e.setAttribute(k, props[k]);
      }
    }
    /* İkon (#665): yazıdan ÖNCE, ayrı bir öğe olarak. Yazı kendi metin
       düğümünde kalıyor, çeviri o düğümü tam metin olarak eşliyor. */
    if (props && props.icon && window.SVIcons) {
      const txt = e.textContent;
      e.insertBefore(window.SVIcons.el(props.icon, txt ? 'svi-lead' : ''), e.firstChild);
      e.dataset.icon = props.icon;
    }
    (kids || []).forEach((c) => c && e.appendChild(c));
    return e;
  }

  /* Sürükle-bırak ile sıralama.

     Sürüklenebilir olan SATIR değil, satırdaki tutamak. Sahne ve şablon
     satırlarında ad yazmak için metin kutuları var; draggable bir
     kapsayıcı Chromium'da o kutularda metin seçmeyi engelliyor.

     Tutamak aynı zamanda bir düğme: odaklanıp yukarı/aşağı ok tuşlarıyla
     da taşınabiliyor. Sürükle-bırak yalnızca fare ile çalışır ve tek yol
     olarak bırakılırsa klavyeyle sıralama hiç mümkün olmaz.

     Olaylar tek tek satırlara değil KAPSAYICIYA bağlanır; listeler her
     çizimde baştan kurulduğu için satır başına dinleyici bağlamak
     birikirdi. Kapsayıcı yeniden kullanılıyorsa ikinci kez bağlanmaz. */
  function dragHandle(title) {
    const h = el('button', {
      class: 'drag-handle', type: 'button', draggable: 'true',
      title: title || 'Sürükleyerek ya da yukarı/aşağı ok tuşlarıyla taşıyın',
      'aria-label': title || 'Taşı',
      icon: 'grip',
    });
    return h;
  }

  function sortableList(host, arr, itemSel, apply) {
    if (!host || host._svSortable) return;
    host._svSortable = true;
    let from = -1;

    const rows = () => Array.from(host.querySelectorAll(itemSel));
    const clearMarks = () => rows().forEach((r) => {
      r.classList.remove('drop-before', 'drop-after', 'dragging');
    });
    const rowAt = (t) => (t && t.closest ? t.closest(itemSel) : null);

    // Diziyi taşı; to, öğe ÇIKARILMADAN önceki hedef konumdur
    const move = (fromIdx, to) => {
      const list = arr();
      if (fromIdx < 0 || fromIdx >= list.length) return false;
      let t = to;
      const item = list[fromIdx];
      list.splice(fromIdx, 1);
      if (t > fromIdx) t--;
      t = Math.max(0, Math.min(list.length, t));
      if (t === fromIdx) { list.splice(fromIdx, 0, item); return false; }
      list.splice(t, 0, item);
      return true;
    };

    host.addEventListener('dragstart', (e) => {
      const h = e.target && e.target.closest ? e.target.closest('.drag-handle') : null;
      if (!h) { e.preventDefault(); return; }
      const row = rowAt(h);
      from = rows().indexOf(row);
      if (from < 0) return;
      row.classList.add('dragging');
      if (e.dataTransfer) {
        e.dataTransfer.effectAllowed = 'move';
        try { e.dataTransfer.setData('text/plain', String(from)); } catch { /* bazı tarayıcılar */ }
        if (e.dataTransfer.setDragImage) e.dataTransfer.setDragImage(row, 24, 16);
      }
    });

    host.addEventListener('dragover', (e) => {
      if (from < 0) return;
      e.preventDefault();
      if (e.dataTransfer) e.dataTransfer.dropEffect = 'move';
      const row = rowAt(e.target);
      rows().forEach((r) => r.classList.remove('drop-before', 'drop-after'));
      if (!row) return;
      const b = row.getBoundingClientRect();
      row.classList.add(e.clientY < b.top + b.height / 2 ? 'drop-before' : 'drop-after');
    });

    host.addEventListener('drop', (e) => {
      if (from < 0) return;
      e.preventDefault();
      const row = rowAt(e.target);
      let to = arr().length;
      if (row) {
        to = rows().indexOf(row);
        const b = row.getBoundingClientRect();
        if (e.clientY >= b.top + b.height / 2) to++;
      }
      const moved = move(from, to);
      from = -1;
      clearMarks();
      if (moved) apply();
    });

    host.addEventListener('dragend', () => { from = -1; clearMarks(); });

    // Klavye: tutamak odaktayken yukarı/aşağı
    host.addEventListener('keydown', (e) => {
      if (e.key !== 'ArrowUp' && e.key !== 'ArrowDown') return;
      const h = e.target && e.target.closest ? e.target.closest('.drag-handle') : null;
      if (!h) return;
      const i = rows().indexOf(rowAt(h));
      if (i < 0) return;
      e.preventDefault();
      const to = e.key === 'ArrowUp' ? i - 1 : i + 2; // +2: kendi yerinden sonraki komşunun ardı
      if (move(i, to)) {
        apply();
        // Yeniden çizimden sonra aynı öğenin tutamağına odağı geri ver
        const ni = e.key === 'ArrowUp' ? i - 1 : i + 1;
        requestAnimationFrame(() => {
          const r = rows()[ni];
          const nh = r && r.querySelector('.drag-handle');
          if (nh) nh.focus();
        });
      }
    });
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
    /* Tek Ayarlar: üst sağ dişli ve sol ray aynı kategoriye gider. */
    openSettings: () => setCategory('settings'),
    isBlackedOut: () => isBlackedOut(),
    toggleBlackout,
    // Yeniden çiz ve ardından gönder. Paneller çizim sırasında bağımlı
    // alanları düzeltebildiği için sıra bu şekilde olmalı.
    apply: () => { render(); push(true); },
    toast: svToast,
    confirm: svConfirm,
    /* Görselleştirici tür etiketleri, TEK kaynaktan: bölüm şemasındaki tür
       seçicisi. Otomatik VJ paneli bunları kendi listesinde tekrar etseydi
       yeni bir tür eklenince iki liste sessizce ayrışırdı. */
    visualizerLabels: () => {
      const out = {};
      const secs = sectionSchema();
      for (const sec of secs) {
        for (const c of (sec.controls || [])) {
          if (c && c.path === 'visualizer.type' && Array.isArray(c.options)) {
            for (const o of c.options) if (o && o.value) out[o.value] = o.label;
          }
        }
      }
      return out;
    },
    /* Sahne uygulama TEK yerde. Otomatik VJ ve klip destesi kendi
       kopyalarını taşıyordu ve kopyalar eksikti: karartma koruması, görsel
       normalleştirme ve katman yığını eşitlemesi yalnızca buradaydı.
       Karartma açıkken kopyanın sahneyi doğrudan yazması, sahnedeki
       karartmayı kaldırırdı. */
    applyScene: (id) => actions.applyScene(id),
    get: (p) => getPath(cfg, p),
    set: (p, v) => setPath(cfg, p, v),
    syncToggles: (p, v) => syncToggleInputs(p, v),

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
      return segmentCtrl({ label: labelText, path, options, rebuild: o.rebuild, onChange: o.onChange });
    },
    color(labelText, path) {
      return colorCtrl({ label: labelText, path });
    },

    /* Sahne/şablon eylemleri. Dışarıya AÇILIYOR çünkü zaman çizelgesi ve
       klip destesi de sahne uygulamak zorunda; kendi kopyalarını yazsalardı
       karartma durumu, etkin sahne kimliği ve görsel normalleştirmesi
       ellerinden kaçardı (Otomatik VJ’de olduğu gibi). */
    actions: () => actions,
    lightingModes: () => MODE_OPTIONS,
    /* Özel paneller (Genel Işık vb.) tek ayar sıfırlama / rozet için */
    isModified: (p) => isModified(p),
    resetPath: (p) => resetPath(p),
    defaultAt: (p) => defaultAt(p),
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
      case 'npcoverfile':
        return npCoverFileCtrl(def);
      case 'logolibrary':
        return logoLibraryCtrl(def);
      case 'floatingtoggle':
        return floatingToggleCtrl(def);
      case 'floatingtools':
        return floatingToolsCtrl(def);
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
      case 'lightinggeneralpanel':
        return window.SVLightingGeneral ? window.SVLightingGeneral.panel() : null;
      case 'dynamictheme':
        return dynamicThemeCtrl(def);
      case 'streampanel':
        return window.SVStream ? window.SVStream.panel() : null;
      case 'studiopanel':
        return window.SVStudio ? window.SVStudio.panel() : null;
      case 'controlpanel':
        return window.SVControl ? window.SVControl.panel(def.surface) : null;
      case 'mcppanel':
        return window.SVMcpPanel ? window.SVMcpPanel.panel() : null;
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
      case 'openrgbpanel':
        return window.SVOpenRGBPanel ? window.SVOpenRGBPanel.panel() : null;
      case 'texturepanel':
        return window.SVTexturePanel ? window.SVTexturePanel.panel() : null;
      case 'autovjpanel':
        return window.SVAutoVJ ? window.SVAutoVJ.panel() : null;
      case 'timelinepanel':
        return window.SVTimelinePanel ? window.SVTimelinePanel.panel() : null;
      case 'clipdeckpanel':
        return window.SVClipDeckPanel ? window.SVClipDeckPanel.panel() : null;
      case 'modulationpanel':
        return window.SVModulationPanel ? window.SVModulationPanel.panel() : null;
      case 'analysispanel':
        return window.SVAnalysisPanel ? window.SVAnalysisPanel.panel() : null;
      case 'transitionpanel':
        return window.SVTransitionPanel ? window.SVTransitionPanel.panel() : null;
      case 'aspectpanel':
        return window.SVAspectPanel ? window.SVAspectPanel.panel() : null;
      case 'mappingpanel':
        return window.SVMappingPanel ? window.SVMappingPanel.panel() : null;
      case 'milkdroppanel':
        return window.SVMilkdropPanel ? window.SVMilkdropPanel.panel() : null;
      case 'mdgenpanel':
        return window.SVMdGenPanel ? window.SVMdGenPanel.panel() : null;
      case 'mdeditpanel':
        return window.SVMdEditPanel ? window.SVMdEditPanel.panel() : null;
      case 'recordpanel':
        return window.SVRecordPanel ? window.SVRecordPanel.panel() : null;
      case 'templatepanel':
        return window.SVTemplatePanel ? window.SVTemplatePanel.panel() : null;
      case 'textpanel':
        return window.SVTextPanel ? window.SVTextPanel.panel() : null;
      case 'updatespanel':
        return window.SVUpdatesPanel ? window.SVUpdatesPanel.panel() : null;
      case 'language':
        return languageCtrl();
      case 'extendedrange':
        return extendedRangeCtrl();
      case 'nowplayingpanel':
        return window.SVNowPlayingPanel ? window.SVNowPlayingPanel.panel() : null;
      case 'grouppanel':
        return window.SVGroupPanel ? window.SVGroupPanel.panel() : null;
      case 'note': {
        // Metin işlev olabilir: içerik çizim anında hesaplanır (ör. ekran hızı)
        const note = el('div', {
          class: 'ctrl settings-io-note' + (def.warn ? ' warn' : ''),
          text: typeof def.text === 'function' ? def.text() : def.text,
        });
        if (def.attrs) {
          for (const k in def.attrs) note.setAttribute(k, def.attrs[k]);
        }
        return note;
      }
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
      icon: def.icon,
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
    /* nullable: değer null iken ayar "moda bırakılmış" demektir ve
       kaydırıcı o modun kendi varsayılanını gösterir. Bar yerleşimi
       böyle: dokunulmadığı sürece eski davranış aynen sürer, kaydırıcıya
       dokunulduğu anda somut bir değere geçer. */
    const raw = getPath(cfg, def.path);
    const cur = raw == null && def.nullable != null ? def.nullable : raw;
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

  function syncToggleInputs(path, val) {
    document.querySelectorAll(`input[type="checkbox"][data-path="${path}"]`).forEach((box) => {
      if (box.checked !== !!val) box.checked = !!val;
    });
  }

  function toggleCtrl(def) {
    const input = el('input', {
      type: 'checkbox',
      'data-path': def.path,
      onchange: (e) => {
        const val = e.target.checked;
        setPath(cfg, def.path, val);
        if (def.path === 'audio.humGuard') {
          const prev = window.SVPreview;
          const eng = prev && prev.audioEngine && prev.audioEngine();
          if (eng) {
            if (eng.cfg) eng.cfg.humGuard = val;
            if (eng.analysis) eng.analysis.humGuard = val;
          }
        }
        syncToggleInputs(def.path, val);
        // Sıra önemli: render() panel gövdelerinin bağımlı alanları
        // normalleştirmesine izin verir, push() sonuçta oluşan tutarlı
        // yapılandırmayı gönderir.
        if (def.rebuild) render();
        push(true);
      },
    });
    input.checked = !!getPath(cfg, def.path);
    const rowChildren = [
      el('label', { class: 'lbl', text: tr(def.label) }),
      el('label', { class: 'switch' }, [input, el('span', { class: 'track' })]),
    ];
    const ctrlChildren = [el('div', { class: 'row' }, rowChildren)];
    if (def.hint) {
      ctrlChildren.push(el('div', { class: 'studio-note dim-hint', text: tr(def.hint), style: 'margin-top:4px;' }));
    }
    return el('div', { class: 'ctrl' }, ctrlChildren);
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
    let cur = getPath(cfg, def.path);
    if (def.path === 'visualizer.colorMode' && !cur) {
      cur = cfg.visualizer && cfg.visualizer.rainbow ? 'rainbow' : 'custom';
    }
    const seg = el('div', { class: 'segment' });

    def.options.forEach((o) => {
      // { group: 'Başlık' } girdileri seçenek değil, ayırıcı başlıktır
      if (o.group) { seg.appendChild(el('div', { class: 'seg-group', text: tr(o.group) })); return; }
      const b = el('button', {
        class: cur === o.value ? 'active' : '',
        icon: o.icon,
        text: tr(o.label),
        onclick: () => {
          setPath(cfg, def.path, o.value);
          if (def.path === 'visualizer.colorMode' && cfg.visualizer) {
            cfg.visualizer.rainbow = (o.value === 'rainbow');
            if (cfg.nowplaying && cfg.visualizer.type === 'nowplaying') {
              cfg.nowplaying.useCustomColor = (o.value === 'custom');
            }
            if (cfg.text && cfg.visualizer.type === 'text') {
              cfg.text.useCustomColor = (o.value === 'custom');
            }
          }
          /* Seçili görünümü hemen güncelle. rebuild/onChange olmadan
             (Otomatik VJ "Hangi Katmanlar" / "Sıra") panel yeniden
             çizilene kadar eski active sınıfı kalıyordu. */
          for (const sib of seg.querySelectorAll('button')) sib.classList.remove('active');
          b.classList.add('active');
          /* Değeri yazdıktan SONRA, yeniden çizimden ÖNCE: çağıran taraf
             yeni değere göre kendi durumunu düzeltebilsin (Otomatik VJ
             zamanlayıcısını sıfırlamak gibi). */
          if (typeof def.onChange === 'function') def.onChange(o.value);
          if (def.rebuild) render();
          push(true);
        },
      });
      seg.appendChild(b);
    });

    return el('div', { class: 'ctrl' }, [
      el('label', { class: 'lbl', text: tr(def.label) }),
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
      const updateBtn = el('button', { class: 'btn ghost small', icon: 'refresh', text: 'Güncelle', title: 'Mevcut renklerle güncelle', onclick: () => actions.updateUserPreset(p.id) });
      const delBtn = el('button', { class: 'btn ghost small danger', icon: 'trash', title: 'Sil', onclick: () => actions.deleteUserPreset(p.id) });

      const row = el('div', { class: 'up-item' }, [
        dragHandle('Şablonu taşı'),
        swatch,
        el('div', { class: 'up-main' }, [nameInput, el('div', { class: 'up-actions' }, [applyBtn, updateBtn, delBtn])]),
      ]);
      list.appendChild(row);
    });
    // Sıralama sürükle-bırak ya da ok tuşlarıyla
    sortableList(list, () => cfg.userPresets, '.up-item', () => { push(true); render(); });
    wrap.appendChild(list);

    const saveBtn = el('button', { class: 'btn ghost small', icon: 'save', text: 'Mevcut Renkleri Kaydet', onclick: () => actions.saveCurrentPreset() });
    const expBtn = el('button', { class: 'btn ghost small', icon: 'export', text: 'Dışa Aktar', onclick: () => actions.exportPresets() });
    const impBtn = el('button', { class: 'btn ghost small', icon: 'import', text: 'İçe Aktar', onclick: () => actions.importPresets() });
    const bar = el('div', { class: 'up-toolbar' }, [saveBtn, expBtn, impBtn]);
    wrap.appendChild(bar);
    return wrap;
  }

  // --- Arkaplan ayarlarını içe/dışa aktarma ---
  function bgIoCtrl() {
    const expBtn = el('button', { class: 'btn ghost small', icon: 'export', text: 'Arkaplanı Dışa Aktar', onclick: () => actions.exportBackground() });
    const impBtn = el('button', { class: 'btn ghost small', icon: 'import', text: 'Arkaplanı İçe Aktar', onclick: () => actions.importBackground() });
    return el('div', { class: 'ctrl' }, [
      el('label', { class: 'lbl', text: 'Arkaplan Ayarları (dosya)' }),
      el('div', { class: 'up-toolbar' }, [expBtn, impBtn]),
    ]);
  }

  // --- Dil seçici (eski modal Ayarlar penceresinden) ---
  function languageCtrl() {
    const saved = localStorage.getItem('sv-language') || 'auto';
    const sel = el('select', {
      onchange: (e) => {
        const value = e.target.value;
        if (value === 'auto') localStorage.removeItem('sv-language');
        else localStorage.setItem('sv-language', value);
        window.location.reload();
      },
    });
    [
      ['auto', 'Otomatik (Sistem dili)'],
      ['tr', 'Türkçe'],
      ['en', 'English'],
    ].forEach(([v, t]) => {
      const o = el('option', { value: v, text: tr(t) });
      if (v === (['auto', 'tr', 'en'].includes(saved) ? saved : 'auto')) o.selected = true;
      sel.appendChild(o);
    });
    /* Group header already says Dil — avoid a second Dil label. */
    return el('div', { class: 'ctrl' }, [
      sel,
      el('div', { class: 'studio-note dim-hint', text: tr('Dil değişikliği uygulamayı yeniden yükler.'), style: 'margin-top:4px;' }),
    ]);
  }

  // --- Genişletilmiş aralıklar (localStorage; cfg yolu yok) ---
  function extendedRangeCtrl() {
    const input = el('input', {
      type: 'checkbox',
      onchange: (e) => {
        extendedRange = e.target.checked;
        localStorage.setItem('sv-extended-range', extendedRange ? '1' : '0');
        render();
      },
    });
    input.checked = !!extendedRange;
    return el('div', { class: 'ctrl' }, [
      el('div', { class: 'row' }, [
        el('label', { class: 'lbl', text: tr('Genişletilmiş Ayar Aralıkları') }),
        el('label', { class: 'switch' }, [input, el('span', { class: 'track' })]),
      ]),
      el('div', {
        class: 'studio-note dim-hint',
        text: tr('Kaydırıcıların üst sınırını 5 katına çıkarır; normalin çok üstünde değerler girebilirsiniz. Aşırı değerler performansı düşürebilir.'),
        style: 'margin-top:4px;',
      }),
    ]);
  }

  // --- Tüm ayarları içe/dışa aktarma (renk şablonları hariç) ---
  function settingsIoCtrl() {
    const expBtn = el('button', { class: 'btn ghost small', icon: 'export', text: 'Tüm Ayarları Dışa Aktar', onclick: () => actions.exportAllSettings() });
    const impBtn = el('button', { class: 'btn ghost small', icon: 'import', text: 'Ayarları İçe Aktar', onclick: () => actions.importAllSettings() });
    return el('div', { class: 'ctrl settings-io-panel' }, [
      el('div', { class: 'settings-io-note', text: 'Ses, görünüm, Dynamic Lighting, performans, logo, görsel nesneler ve video dışa aktarma ayarlarını JSON dosyasına kaydeder. Renk şablonlarınız ve sahneleriniz dosyaya dahil edilmez ve içe aktarma sırasında korunur; onların kendi dışa aktarma düğmeleri vardır.' }),
      el('div', { class: 'up-toolbar' }, [expBtn, impBtn]),
    ]);
  }

  // --- Sahneler (tüm görünümün anlık görüntüsü) ---
  // Bir sahne yalnızca "görünüm" alanlarını taşır; ses aygıtı, ekran, performans
  // ve dışa aktarma ayarları sahneden bağımsızdır.
  const SCENE_KEYS = [
    'background', 'visualizer', 'layers', 'layerStack', 'layerGroups', 'crossfade',
    'geometry', 'postfx', 'logo', 'images', 'media', 'text', 'modulation',
    'transition', 'custom', 'milkdrop', 'feedback',
  ];

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
    const parts = [];
    if (d.layerStack && d.layerStack.enabled && Array.isArray(d.layers) && d.layers.length) {
      parts.push(d.layers.length + ' ' + (d.layers.length === 1 ? tr('Katman') : tr('Katmanlar')));
    } else {
      const type = (d.visualizer && d.visualizer.type) || 'none';
      parts.push(MC().label('visualizer', type));
    }
    if (d.logo && d.logo.enabled) parts.push('Logo');
    if (d.images && d.images.enabled && (d.images.items || []).length) parts.push('Nesneler');
    if (d.media && d.media.enabled) parts.push('Medya');
    if (d.text && d.text.enabled && d.text.content) parts.push('Metin');
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
        class: 'up-name', type: 'text', value: tr(sc.name || 'Sahne'), title: tr('Sahne adı'),
      });
      name.addEventListener('change', () => actions.renameScene(sc.id, name.value));
      const applyBtn = el('button', { class: 'btn small', text: 'Uygula', onclick: () => actions.applyScene(sc.id) });
      const updBtn = el('button', { class: 'btn ghost small', icon: 'refresh', text: 'Güncelle', title: 'Mevcut görünümle güncelle', onclick: () => actions.updateScene(sc.id) });
      const delBtn = el('button', { class: 'btn ghost small danger', icon: 'trash', title: 'Sil', onclick: () => actions.deleteScene(sc.id) });
      list.appendChild(
        el('div', { class: 'up-item' + (sc.id === activeSceneId ? ' active' : '') }, [
          dragHandle('Sahneyi taşı'),
          swatch,
          el('div', { class: 'up-main' }, [
            name,
            el('div', { class: 'scene-meta', text: sceneSummary(sc) }),
            el('div', { class: 'up-actions' }, [applyBtn, updBtn, delBtn]),
          ]),
        ])
      );
    });
    // Kitaplıktaki sahne listesi de dock'taki gibi sıralanabilir
    sortableList(list, ensureScenes, '.up-item', () => { push(true); render(); renderScenes(); });

    const toolbar = el('div', { class: 'up-toolbar' }, [
      el('button', { class: 'btn small', icon: 'save', text: 'Mevcut Görünümü Kaydet', onclick: () => actions.saveScene() }),
      el('button', { class: 'btn ghost small', icon: 'export', text: 'Dışa Aktar', onclick: () => actions.exportScenes() }),
      el('button', { class: 'btn ghost small', icon: 'import', text: 'İçe Aktar', onclick: () => actions.importScenes() }),
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
          // Kullanıcının seçimi: bütün kutular kalkarsa boş liste boş kalır
          cfg.display = cfg.display || {};
          cfg.display.chosen = true;
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
        el('span', { class: 'source-icon', icon: 'monitor' }),
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
      const delBtn = el('button', { class: 'btn ghost small danger', icon: 'trash', text: 'Kaldır', onclick: () => actions.removeImage(it.id) });
      const replaceBtn = el('button', { class: 'btn ghost small', icon: 'image', text: 'Değiştir', onclick: () => actions.replaceImage(it.id) });

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
      add({ type: 'slider', path: base + 'cornerRadius', label: 'Köşe / Oval', min: 0, max: 0.5, step: 0.01, percent: true });
      add({ type: 'select', path: base + 'blend', label: 'Karışım', options: BLEND_OPTS });
      add({ type: 'select', path: base + 'layer', label: 'Katman', options: LAYER_OPTS });
      add({ type: 'toggle', path: base + 'noOverlap', label: 'Üst Üste Binmeyi Engelle', rebuild: false });
      add({ type: 'slider', path: base + 'minDist', label: 'Minimum Mesafe (boyut çarpanı)', min: 0.5, max: 3.0, step: 0.05 });

      wrap.appendChild(el('div', { class: 'img-card' }, [head, body]));
    });

    const addBtn = el('button', { class: 'btn ghost small', icon: 'plus', text: 'Görsel Ekle', onclick: () => actions.addImage() });
    wrap.appendChild(el('div', { class: 'up-toolbar' }, [addBtn]));
    return el('div', { class: 'ctrl' }, [wrap]);
  }

  function logoFileCtrl() {
    /* macOS/Linux albüm kapağını okuyamaz. Kayıtlı auto/track burada özel resme iner. */
    if (!isWindows() && cfg.logo && cfg.logo.source !== 'manual') cfg.logo.source = 'manual';
    const fileInput = el('input', { type: 'file', accept: 'image/*' });
    fileInput.style.display = 'none';
    fileInput.addEventListener('change', (e) => {
      const file = e.target.files[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = () => {
        cfg.logo.src = reader.result;
        cfg.logo.libraryId = '';
        cfg.logo.kind = (file.type === 'image/gif' || /\.gif$/i.test(file.name || '')) ? 'gif' : 'image';
        push(true);
        preview.src = reader.result;
        preview.style.display = 'block';
        render();
      };
      reader.readAsDataURL(file);
    });
    const btn = el('label', { class: 'filebtn', icon: 'image', text: 'Resim / Logo Seç' });
    btn.appendChild(fileInput);
    btn.addEventListener('click', () => fileInput.click());

    const removeBtn = el('button', {
      class: 'btn ghost small', text: 'Kaldır',
      onclick: () => {
        cfg.logo.src = null;
        cfg.logo.libraryId = '';
        cfg.logo.kind = '';
        push(true);
        preview.style.display = 'none';
        render();
      },
    });
    removeBtn.style.marginLeft = '8px';

    const mode = isWindows() ? (cfg.logo.source || 'auto') : 'manual';
    if (mode === 'track') {
      const live = (window.SVNowLive && window.SVNowLive.state && window.SVNowLive.state.has) ? window.SVNowLive.state : null;
      const note = el('div', {
        class: 'studio-note dim-hint',
        text: 'Yalnızca çalan şarkının albüm kapağı/resmi gösterilir. Şarkı sözü / çalan parça sistemi aktifken parça çalınca otomatik devreye girer.',
      });
      const kids = [note];
      if (live && live.artwork) {
        const livePre = el('img', { class: 'logo-preview', src: live.artwork, style: 'display: block;' });
        kids.push(livePre);
      }
      return el('div', { class: 'ctrl' }, kids);
    }

    const preview = el('img', { class: 'logo-preview' });
    const previewSrc = cfg.logo.src || (cfg.logo.libraryId && window.SVGif && window.SVGif.libraryUrl(cfg.logo.libraryId));
    if (previewSrc) {
      preview.src = previewSrc;
      preview.style.display = 'block';
    }
    const hintText = mode === 'auto'
      ? 'Otomatik mod: Çalan şarkının kapağı varsa gösterilir; parça çalmıyorsa veya kapağı yoksa bu özel resim gösterilir.'
      : 'Özel resim modu: Şarkı çalsa dahi her zaman bu özel görsel gösterilir.';
    const hint = el('div', { class: 'studio-note dim-hint', style: 'margin-top: 6px;', text: hintText });

    return el('div', { class: 'ctrl' }, [
      el('div', { class: 'row' }, [btn, removeBtn]),
      preview,
      hint,
    ]);
  }

  /* Çalan parça kapağı: Windows'ta otomatik kapağın yedeği, diğer platformlarda tek kaynak. */
  function npCoverFileCtrl() {
    const C = cfg.nowplaying || (cfg.nowplaying = {});
    C.manual = C.manual || {};
    if (!isWindows()) C.coverSource = 'manual';
    const fileInput = el('input', { type: 'file', accept: 'image/*' });
    fileInput.style.display = 'none';
    fileInput.addEventListener('change', (e) => {
      const file = e.target.files && e.target.files[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = () => {
        C.manual.artwork = reader.result;
        push(true);
        render();
      };
      reader.readAsDataURL(file);
    });
    const pick = el('button', {
      class: 'btn small', type: 'button', icon: 'image',
      text: C.manual.artwork ? 'Kapağı Değiştir' : 'Kapak Seç',
      onclick: () => fileInput.click(),
    });
    const remove = C.manual.artwork ? el('button', {
      class: 'btn ghost small danger', type: 'button', text: 'Kapağı Kaldır',
      onclick: () => {
        C.manual.artwork = '';
        push(true);
        render();
      },
    }) : null;
    const preview = C.manual.artwork
      ? el('img', { class: 'logo-preview', src: C.manual.artwork, alt: 'Kapak Görseli', style: 'display:block' })
      : null;
    return el('div', { class: 'ctrl' }, [
      el('div', { class: 'row' }, [pick, remove, fileInput].filter(Boolean)),
      preview,
    ].filter(Boolean));
  }

  function isGifLogo(lg) {
    if (!lg) return false;
    if (window.SVGif && window.SVGif.isAnimatedLogo) return window.SVGif.isAnimatedLogo(lg, lg.src);
    return lg.kind === 'gif' || /^data:image\/gif/i.test(lg.src || '') || /\.gif(?:$|\?)/i.test(lg.src || '');
  }

  function logoLibraryCtrl() {
    if (!window.SVLogoLibUi) return el('div');
    return window.SVLogoLibUi.mount({
      selectedId: (cfg.logo && cfg.logo.libraryId) || '',
      onPick: (it) => {
        const wasGif = isGifLogo(cfg.logo);
        cfg.logo.libraryId = it.id;
        cfg.logo.src = null;
        cfg.logo.kind = it.kind || '';
        cfg.logo.enabled = true;
        if (window.SVLogoRuntime && window.SVLogoRuntime.warm) window.SVLogoRuntime.warm(it.id);
        push(true);
        const url = (window.SVLogoRuntime && window.SVLogoRuntime.urlFor(it.id))
          || (window.SVGif && window.SVGif.libraryUrl(it.id));
        if (url) {
          document.querySelectorAll('.logo-preview, .layer-preview').forEach((img) => {
            img.src = url;
            img.style.display = 'block';
          });
        }
        /* Önizleme + GIF kontrolleri için paneli yenile. Kitaplık thumb'ları
           blob önbelleğinden geldiği için yeniden mount donmaya yol açmaz. */
        render();
      },
      onRemove: (it) => {
        if (!cfg.logo || cfg.logo.libraryId !== it.id) return;
        cfg.logo.libraryId = '';
        if (!cfg.logo.src) cfg.logo.kind = '';
        push(true);
        render();
      },
    });
  }


  function updateFloatingToggles() {
    document.querySelectorAll('[data-sv-floating-toggle]').forEach((box) => {
      box.checked = !!floatingOpen;
    });
  }

  function floatingToggleCtrl() {
    const box = el('input', {
      type: 'checkbox',
      onchange: async (e) => {
        const want = !!e.target.checked;
        if (want === floatingOpen) return;
        try {
          const r = await window.api.toggleFloating();
          floatingOpen = !!(r && r.open);
        } catch {
          floatingOpen = false;
        }
        updateFloatingToggles();
        /* Boyut/köşe araçları yalnızca açıkken anlamlı; kartı tazele. */
        render();
      },
    });
    box.checked = !!floatingOpen;
    box.setAttribute('data-sv-floating-toggle', '1');
    return el('div', { class: 'ctrl' }, [
      el('div', { class: 'row' }, [
        el('label', { class: 'lbl', text: 'Yüzen pencere (PiP)' }),
        el('label', { class: 'switch' }, [box, el('span', { class: 'track' })]),
      ]),
      el('div', {
        class: 'settings-io-note',
        style: 'margin-top:6px',
        text: 'Ekrandan bağımsız küçük görselleştirici. Pencereyi dışarıdan kapatınca bu anahtar anında kapanır.',
      }),
    ]);
  }

  function floatingToolsCtrl() {
    const chip = (label, fn, icon, title) => el('button', {
      class: 'btn ghost small',
      type: 'button',
      text: icon ? '' : label,
      icon,
      title,
      onclick: fn,
    });
    return el('div', { class: 'ctrl' }, [
      el('div', { class: 'lbl', text: tr('Boyut ve köşe') }),
      el('div', { class: 'float-tools' }, [
        chip('S', () => actions.floatingSizeS()),
        chip('M', () => actions.floatingSizeM()),
        chip('L', () => actions.floatingSizeL()),
      ]),
      el('div', { class: 'float-tools' }, [
        chip('', () => actions.floatingSnapTl(), 'corner-tl', 'Sol üst köşe'),
        chip('', () => actions.floatingSnapTr(), 'corner-tr', 'Sağ üst köşe'),
        chip('', () => actions.floatingSnapBl(), 'corner-bl', 'Sol alt köşe'),
        chip('', () => actions.floatingSnapBr(), 'corner-br', 'Sağ alt köşe'),
      ]),
    ]);
  }

  function xyCtrl() {
    const mk = (axis, label) =>
      sliderCtrl({ path: 'logo.' + axis, label, min: 0, max: 1, step: 0.01, percent: true });
    const auto = el('button', {
      class: 'btn ghost small', icon: 'target', text: 'Otomatik Ortala',
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
    const AA = window.SVAppAudio;

    /* Kaynaklar iki türlü: aygıt adı (metin) ve uygulama hedefi (nesne).
       İkisi aynı listede duruyor çünkü karışım zaten çoklu kaynak
       destekliyor — "Spotify + mikrofon" tek bir seçim kümesi. */
    const keyOf = (s) => (AA && AA.isAppSource(s)
      ? 'app:' + AA.baseName(s.match)
      : String(s));

    function getCur() {
      const v = getPath(cfg, def.path);
      return Array.isArray(v) ? v : (v ? [v] : ['default']);
    }

    function appMode() {
      const cur = getCur().filter((s) => AA && AA.isAppSource(s));
      return cur.length && cur[0].mode === 'exclude' ? 'exclude' : 'include';
    }

    function toggle(entry) {
      const key = keyOf(entry);
      let arr = getCur().slice();
      if (arr.some((s) => keyOf(s) === key)) {
        arr = arr.filter((s) => keyOf(s) !== key);
      } else {
        const add = AA && AA.isAppSource(entry)
          ? Object.assign({}, entry, { mode: appMode() })
          : entry;
        /* Hariç tutma tek uygulamayla sınırlı (bkz. shared/app-audio.js):
           iki hariç-tutma akışı birbirinin sesini taşır ve karıştırılınca
           o ses iki kez sayılırdı. */
        if (AA && AA.isAppSource(add) && add.mode === 'exclude') {
          arr = arr.filter((s) => !(AA && AA.isAppSource(s)));
        }
        arr.push(add);
      }
      if (arr.length === 0) arr = ['default']; // en az bir kaynak her zaman seçili
      setPath(cfg, def.path, arr);
      push(true);
      render();
    }

    function setAppMode(mode) {
      let arr = getCur().slice();
      const apps = arr.filter((s) => AA && AA.isAppSource(s));
      arr = arr.filter((s) => !(AA && AA.isAppSource(s)));
      const kept = mode === 'exclude' ? apps.slice(0, 1) : apps;
      for (const a of kept) arr.push(Object.assign({}, a, { mode }));
      if (arr.length === 0) arr = ['default'];
      setPath(cfg, def.path, arr);
      push(true);
      render();
    }

    function updateChecks() {
      const cur = getCur().map(keyOf);
      checkboxes.forEach((cb, k) => { cb.checked = cur.includes(k); });
    }

    function makeRow(entry, icon, label, extra) {
      const cb = el('input', { type: 'checkbox' });
      checkboxes.set(keyOf(entry), cb);
      cb.addEventListener('change', () => toggle(entry));
      const kids = [
        cb,
        el('span', { class: 'source-icon', icon }),
        el('span', { class: 'source-name', text: label }),
      ];
      if (extra) kids.push(el('span', { class: 'source-note', text: extra }));
      return el('label', { class: 'source-item' }, kids);
    }

    const devices = typeof def.devices === 'function' ? def.devices() : (def.devices || []);
    const rows = [makeRow('default', 'speaker', 'Varsayılan Çıkış (Aktif Hoparlör)')];
    devices.forEach((d) => {
      const icon = d.kind === 'input' ? 'mic' : 'speaker';
      const suffix = d.isDefault ? ' (' + tr('varsayılan') + ')' : '';
      rows.push(makeRow(d.name, icon, d.name + suffix));
    });
    const kids = [
      el('label', { class: 'lbl', text: def.label }),
      el('div', { class: 'source-list' }, rows),
    ];

    // --------------------------------------------- uygulama başına yakalama
    const apps = typeof def.apps === 'function' ? def.apps() : (def.apps || []);
    const status = typeof def.appStatus === 'function' ? def.appStatus() : null;
    const selectedApps = getCur().filter((s) => AA && AA.isAppSource(s));

    kids.push(el('label', { class: 'lbl', text: 'Uygulama Sesi' }));
    if (!AA || (status && status.available === false)) {
      kids.push(el('div', { class: 'studio-note dim-hint',
        text: (status && status.message) || 'Uygulama başına ses yakalama kullanılamıyor.' }));
    } else {
      const appRows = [];
      const shown = new Set();
      for (const a of apps) {
        shown.add(AA.baseName(a.match));
        appRows.push(makeRow(
          { kind: 'app', match: a.match, label: a.label },
          a.audible ? 'music' : 'mute',
          a.label,
          a.count > 1 ? a.count + ' süreç' : ''
        ));
      }
      /* Seçili ama şu an çalışmayan uygulama listeden DÜŞMEMELİ; aksi halde
         kullanıcı seçimini kaybeder ve neden kaybettiğini göremez. Yakalama
         tarafı da uygulama açılınca kendiliğinden bağlanıyor. */
      for (const s of selectedApps) {
        if (shown.has(AA.baseName(s.match))) continue;
        appRows.push(makeRow(
          { kind: 'app', match: s.match, label: s.label },
          'pause', s.label || s.match, 'çalışmıyor'
        ));
      }
      if (!appRows.length) {
        kids.push(el('div', { class: 'studio-note dim-hint',
          text: 'Şu anda ses çalan bir uygulama yok. Bir şey çaldırıp Aygıtları Yenile’ye basın.' }));
      } else {
        kids.push(el('div', { class: 'source-list' }, appRows));
      }

      if (selectedApps.length) {
        const mode = appMode();
        const seg = el('div', { class: 'segment' });
        for (const opt of [['include', 'Yalnızca Seçilenler'], ['exclude', 'Seçilen Hariç']]) {
          const b = el('button', {
            class: mode === opt[0] ? 'active' : '', type: 'button', text: tr(opt[1]),
          });
          b.addEventListener('click', () => setAppMode(opt[0]));
          seg.appendChild(b);
        }
        kids.push(el('div', { class: 'ctrl' }, [
          el('label', { class: 'lbl', text: 'Uygulama Kipi' }), seg,
        ]));
        if (mode === 'exclude') {
          kids.push(el('div', { class: 'studio-note dim-hint',
            text: 'Seçilen uygulama hariç sistemdeki her şey dinlenir. Bu kipte tek uygulama seçilebilir.' }));
        }
      }
    }

    updateChecks();
    return el('div', { class: 'ctrl' }, kids);
  }

  // --- Video dışa aktarma: ses dosyası seçici ---
  function audioFileCtrl() {
    const name = el('div', {
      class: 'export-filename',
      id: 'exportAudioName',
      text: exportAudioName || 'Henüz dosya seçilmedi',
    });
    const btn = el('label', { class: 'filebtn', icon: 'music', text: 'Ses Dosyası Seç (MP3 / WAV / FLAC)' });
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
      class: 'btn primary', id: 'exportRunBtn', icon: 'clapper', text: 'Videoya Aktar',
      onclick: () => actions.runExport(),
    });
    const cancelBtn = el('button', {
      class: 'btn ghost small', id: 'exportCancelBtn', icon: 'stop', text: 'İptal',
      onclick: () => window.api.cancelExport(),
    });
    cancelBtn.style.display = exporting ? 'inline-flex' : 'none';
    cancelBtn.style.marginLeft = '8px';
    runBtn.disabled = exporting;

    const fill = el('i', { id: 'exportProgressFill' });
    fill.style.width = (exporting ? exportPct : 0) + '%';
    const bar = el('div', { class: 'export-progress', id: 'exportProgressBar' }, [fill]);
    bar.style.display = exporting ? 'block' : 'none';

    const status = el('div', { class: 'export-status', id: 'exportStatus' });
    if (exportStatusText) {
      status.className = 'export-status' + (exportStatusCls ? ' ' + exportStatusCls : '');
      if (window.SVIcons) window.SVIcons.set(status, exportStatusIcon || '', exportStatusText);
      else status.textContent = exportStatusText;
    }

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
    const resolvedStatusText = available ? devices.length + ' uyumlu aydınlatma aygıtı bulundu' : statusText;
    const status = el('div', { class: available ? 'lighting-status ok' : 'lighting-status', icon: available ? 'check' : '', text: resolvedStatusText });

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
      icon: 'refresh', text: 'Aydınlatma Aygıtlarını Tara',
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
        ? 'Arka plan Dynamic Lighting kimliği hazır'
        : lightingIdentity.packaged
          ? 'Arka plan kimliği bulunamadı; ön plan kontrolü kullanılabilir.'
          : 'Geliştirme modunda yalnızca ön plan kontrolü kullanılabilir.';
    const identityStatus = el('div', {
      class: !lightingIdentity.portable && lightingIdentity.hasIdentity ? 'lighting-status ok' : 'lighting-status',
      icon: !lightingIdentity.portable && lightingIdentity.hasIdentity ? 'check' : '',
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
        ? 'Windows ' + controlAvailable + '/' + controlTotal + ' aygıt için kontrol verdi'
        : lightingIdentity.portable
          ? 'Portable sürüm yalnızca uygulama odaktayken kontrol eder (' + controlAvailable + '/' + controlTotal + ').'
          : 'Windows arka plan kontrolünü vermedi (' + controlAvailable + '/' + controlTotal + '). Dynamic Lighting ayarlarında CAYADEV Visualizer uygulamasını listenin en üstüne taşıyın.';
    const controlStatus = el('div', {
      class: lighting.enabled && controlGranted ? 'lighting-status ok' : 'lighting-status',
      icon: !lighting.enabled ? '' : (controlGranted ? 'check' : 'warning'),
      text: controlText,
    });

    const settingsBtn = el('button', {
      class: 'btn ghost small',
      icon: 'gear', text: 'Windows Dynamic Lighting Ayarları',
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

    /* Görünüm ayarları (mod, renk, tepki…) her zaman erişilebilir Genel Işık
       Ayarları kartında. Burada yalnız Windows Dynamic Lighting'e özgü
       aygıt/LED boyama kalır — OpenRGB bunları süremez. */
    children.push(el('div', {
      class: 'lighting-mode-help',
      text: 'Ortak görünüm ayarları (mod, parlaklık, ses tepkisi, renkler) aşağıda Genel Işık Ayarları kartındadır. Bu kartta yalnız Windows aygıtlarına özel renk boyama vardır.',
    }));

    const staticMode = ['single-color', 'per-device', 'per-led'].includes(lighting.mode);
    if (lighting.mode === 'single-color') {
      const input = el('input', {
        type: 'color', value: lighting.color,
        oninput: (e) => { lighting.color = e.target.value; apply(false); },
      });
      children.push(el('div', { class: 'ctrl' }, [
        el('div', { class: 'row' }, [
          el('label', { class: 'lbl', text: 'Tek Renk' }),
          input,
        ]),
        el('div', { class: 'lighting-backends' }, [
          el('span', { class: 'lighting-backend-tag', text: 'Windows Dynamic Lighting' }),
        ]),
      ]));
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
            el('label', { class: 'lbl', text: device.name + ' — ' + device.lampCount + ' LED' }), input,
          ]),
          el('div', { class: 'lighting-backends' }, [
            el('span', { class: 'lighting-backend-tag', text: 'Windows Dynamic Lighting' }),
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
            title: device.name + ' — LED ' + (index + 1),
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
          el('label', { class: 'lbl', text: device.name + ' — ' + device.lampCount + ' LED / bölge' }),
          grid,
          el('div', { class: 'lighting-backends' }, [
            el('span', { class: 'lighting-backend-tag', text: 'Windows Dynamic Lighting' }),
          ]),
        ]));
      });
    } else if (!staticMode) {
      children.push(el('div', {
        class: 'lighting-devices',
        text: devices.map((device) => device.name + ' (' + device.lampCount + ' LED)').join(' · '),
      }));
    }

    return el('div', { class: 'lighting-panel' }, children);
  }


  // --- Dinamik / Olay Temelli Renk Teması Kontrolü (Windows SMTC) ---
  let lastDynamicTrackKey = '';
  let lastDynamicArtwork = '';
  let dynamicArtworkWaitTimer = null;
  let pendingDynamicTrackState = null;

  function clearDynamicArtworkTimer() {
    if (dynamicArtworkWaitTimer) {
      clearTimeout(dynamicArtworkWaitTimer);
      dynamicArtworkWaitTimer = null;
    }
    pendingDynamicTrackState = null;
  }

  function applyResolvedTheme(res, isManual) {
    if (!res || !res.colors || !res.colors.length) return;
    const dt = cfg.dynamicTheme || {};

    if (dt.applyToBackground !== false && cfg.background && cfg.background.gradient) {
      cfg.background.gradient.colors = res.colors.slice(0, 5);
      /* sync live theme into background layers */
      if (cfg.layerStack && cfg.layerStack.enabled && Array.isArray(cfg.layers)) {
        cfg.layers.forEach((ly) => {
          if (!ly || ly.kind !== 'background') return;
          const bg = (ly.settings = ly.settings || {}).background = (ly.settings.background || {});
          const mode = bg.colorMode || cfg.background.colorMode || 'theme';
          if (mode !== 'theme') return;
          bg.colorMode = 'theme';
          bg.gradient = bg.gradient || {};
          bg.gradient.colors = res.colors.slice(0, 5);
        });
      }
    }
    if (dt.applyToVisualizer !== false && cfg.visualizer) {
      cfg.visualizer.color = res.color || res.colors[2] || '#3aa6ff';
      cfg.visualizer.color2 = res.color2 || res.colors[4] || '#d24bff';
    }
    if (res.nextCycleIdx !== undefined) {
      dt._cycleIdx = res.nextCycleIdx;
    }
    push(true);

    if (isManual) {
      render();
    } else {
      const bar = document.querySelector('.dynamic-theme-swatch');
      if (bar) {
        bar.style.background = `linear-gradient(90deg, ${res.colors.slice(0, 5).join(',')})`;
      }
    }
  }

  function resolveAndApplyDynamicTheme(st, expectedTrackKey) {
    if (!window.SV || !window.SV.AdaptiveTheme) return;
    const presets = (window.SV.GRADIENT_PRESETS || []).concat(cfg.userPresets || []);

    window.SV.AdaptiveTheme.resolveDynamicTheme(st, cfg.dynamicTheme, presets, (res) => {
      // Asenkron görsel çözümlemesi sırasında başka şarkıya geçildiyse eski şarkının renklerini uygulama
      if (expectedTrackKey && expectedTrackKey !== lastDynamicTrackKey) return;
      if (res && res.colors) {
        applyResolvedTheme(res, false);
      }
    });
  }

  function applyDynamicThemeNow() {
    clearDynamicArtworkTimer();
    if (!window.SV_PLATFORM || !window.SV_PLATFORM.isWindows) {
      svToast(tr('Dinamik renk teması yalnızca Windows’ta kullanılabilir.'), 'warn');
      return;
    }
    if (!window.SV || !window.SV.AdaptiveTheme) return;
    const dt = cfg.dynamicTheme;
    if (!dt) return;
    const live = (window.SVNowLive && window.SVNowLive.state) ? window.SVNowLive.state : null;
    const presets = (window.SV.GRADIENT_PRESETS || []).concat(cfg.userPresets || []);

    window.SV.AdaptiveTheme.resolveDynamicTheme(live, dt, presets, (res) => {
      if (!res || !res.colors) {
        svToast(tr('Uygulanacak renk teması bulunamadı.'), 'warn');
        return;
      }
      applyResolvedTheme(res, true);
      const modeLabel = res.modeUsed === 'artwork' ? tr('Albüm Kapağı') : (res.style || res.track || tr('Başarılı'));
      svToast(tr('Dinamik renk teması uygulandı: ') + modeLabel, 'ok');
    });
  }

  function handleDynamicThemeTrackUpdate(st) {
    if (!cfg.dynamicTheme || !cfg.dynamicTheme.enabled) return;
    if (!window.SV_PLATFORM || !window.SV_PLATFORM.isWindows) return;
    if (!st || !st.has) return;

    const title = (st.title || '').trim();
    // Şarkı geçiş aralığında başlık boş/geçici gelebilir; önceki renkleri aynen koru
    if (!title) return;

    const trackKey = `${title}|${(st.artist || '').trim()}|${(st.album || '').trim()}`;
    const hasArtwork = !!(st.artwork && typeof st.artwork === 'string' && st.artwork.length > 20);
    const artworkKey = hasArtwork ? st.artwork.slice(0, 120) : '';

    const mode = (cfg.dynamicTheme && cfg.dynamicTheme.mode) || 'artworkOrRandom';
    const usesArtwork = (mode === 'artwork' || mode === 'artworkOrRandom');

    const isTrackChange = (trackKey !== lastDynamicTrackKey && trackKey !== '||');
    const isNewArtwork = hasArtwork && (artworkKey !== lastDynamicArtwork);

    if (!isTrackChange && !isNewArtwork) return;

    if (isTrackChange) {
      lastDynamicTrackKey = trackKey;
      lastDynamicArtwork = ''; // Yeni parça için kapak anahtarını sıfırla, kapak geldiğinde hemen tanınsın
      clearDynamicArtworkTimer();

      if (usesArtwork) {
        if (hasArtwork) {
          lastDynamicArtwork = artworkKey;
          resolveAndApplyDynamicTheme(st, trackKey);
        } else {
          // Şarkı geçiş aralığı: Kapak henüz SMTC'den yüklenmemiş.
          // Bu bekleme süresince önceki şarkının renkleri AYNEN KORUNUR (farklı/rastgele renkler araya girmez).
          pendingDynamicTrackState = st;
          dynamicArtworkWaitTimer = setTimeout(() => {
            dynamicArtworkWaitTimer = null;
            // Bekleme süresi dolduğunda hâlâ kapak gelmemişse (kapağı olmayan parça) fallback devreye girer
            if (pendingDynamicTrackState && pendingDynamicTrackState === st) {
              if (mode === 'artworkOrRandom') {
                resolveAndApplyDynamicTheme(pendingDynamicTrackState, trackKey);
              }
              pendingDynamicTrackState = null;
            }
          }, 2500);
        }
        return;
      }

      // Kapağa dayanmayan modlar (random, energyMood, presetRandom, presetCycle):
      // Şarkı değiştiğinde yalnızca bir kez çözülür
      resolveAndApplyDynamicTheme(st, trackKey);
      return;
    }

    if (isNewArtwork) {
      if (!usesArtwork) return;
      lastDynamicArtwork = artworkKey;
      clearDynamicArtworkTimer();
      resolveAndApplyDynamicTheme(st, trackKey);
      return;
    }
  }

  function dynamicThemeCtrl() {
    if (!cfg.dynamicTheme) {
      cfg.dynamicTheme = {
        enabled: false,
        mode: 'artworkOrRandom',
        applyToBackground: true,
        applyToVisualizer: true,
      };
    }
    const dt = cfg.dynamicTheme;
    const isWindows = !!(window.SV_PLATFORM && window.SV_PLATFORM.isWindows);

    const wrap = el('div', { class: 'dynamic-theme-panel' });

    if (!isWindows) {
      const banner = el('div', { class: 'studio-note' }, [
        el('div', { style: 'font-weight: 600; color: var(--accent);', text: tr('Yalnızca Windows Desteklenir') }),
        el('div', { class: 'dim-hint', style: 'margin-top: 4px;', text: tr('Dinamik renk teması modu, Windows Medya Taşıma Denetimleri (SMTC) oturumundan gelen çalan parça ve albüm kapağı verileriyle çalışır. Bu platformda kullanılamaz.') }),
      ]);
      wrap.appendChild(banner);
      return el('div', { class: 'ctrl' }, [wrap]);
    }

    // 1. Canlı Şarkı Durum Başlığı
    const live = (window.SVNowLive && window.SVNowLive.state && window.SVNowLive.state.has) ? window.SVNowLive.state : null;
    const statusRow = el('div', { class: 'studio-note', style: 'display: flex; align-items: center; justify-content: space-between; gap: 10px; margin-bottom: 10px;' });
    const statusInfo = el('div', { style: 'flex: 1; min-width: 0;' });
    if (live && live.title) {
      /* `np-live`: içerik ÇALAN PARÇANIN adı, yani çeviri yüzeyi değil.
         Sınıf olmadan i18n taraması bunu "çevrilmemiş Türkçe" sayıyor ve
         Türkçe bir şarkı çalarken sürüm kapısı düşüyordu — kapının sonucu
         o an ne dinlendiğine bağlı olamaz. */
      statusInfo.appendChild(el('div', { class: 'np-live', style: 'font-weight: 600; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;', icon: 'music', text: `${live.title} — ${live.artist || ''}` }));
      statusInfo.appendChild(el('div', { class: 'dim-hint', style: 'margin-top: 2px;', icon: live.artwork ? 'image' : 'info', text: live.artwork ? tr('Albüm kapağı algılandı') : tr('Albüm kapağı yok (parça bilgisi mevcut)') }));
    } else {
      statusInfo.appendChild(el('div', { style: 'font-weight: 600;', icon: 'music', text: tr('Windows Medya Oturumu Hazır') }));
      statusInfo.appendChild(el('div', { class: 'dim-hint', style: 'margin-top: 2px;', text: tr('Müzik çaldığında (Spotify, Apple Music, YouTube vb.) renkler otomatik güncellenir.') }));
    }
    statusRow.appendChild(statusInfo);

    if (live && live.artwork) {
      const artThumb = el('img', {
        src: live.artwork,
        style: 'width: 42px; height: 42px; border-radius: 7px; object-fit: cover; border: 1px solid var(--line); flex-shrink: 0;',
        title: tr('Çalan Parça Kapağı'),
      });
      statusRow.appendChild(artThumb);
    }
    wrap.appendChild(statusRow);

    // 2. Ana Etkinleştirme Switch'i (Uygulamanın standart switch bileşeni)
    const mainSwitchInput = el('input', {
      type: 'checkbox',
      checked: !!dt.enabled,
      onchange: (e) => {
        dt.enabled = e.target.checked;
        if (!dt.enabled) clearDynamicArtworkTimer();
        push(true);
        render();
      },
    });
    const mainSwitch = el('label', { class: 'switch' }, [mainSwitchInput, el('span', { class: 'track' })]);
    const mainRow = el('div', { class: 'row' }, [
      el('label', { class: 'lbl', text: tr('Dinamik Renk Temasını Etkinleştir') }),
      mainSwitch,
    ]);
    const mainCtrl = el('div', { class: 'ctrl' }, [
      mainRow,
      el('div', { class: 'dim-hint', text: tr('Şarkı değiştiğinde veya yeni kapak geldiğinde renkleri otomatik uyarla.') }),
    ]);
    wrap.appendChild(mainCtrl);

    if (dt.enabled) {
      const sub = el('div', { class: 'subctrls' });

      // 3. Çalışma Modu Seçimi
      const MODES = [
        ['artworkOrRandom', tr('Albüm Kapağı (Yoksa Rastgele)')],
        ['artwork', tr('Yalnızca Albüm Kapağı')],
        ['random', tr('Rastgele Renk Teması (Stüdyo Üreticisi)')],
        ['energyMood', tr('Parça Adı & Ruh Hali Analizi')],
        ['presetCycle', tr('Hazır Şablon Döngüsü')],
        ['presetRandom', tr('Hazır Şablon Rastgele')],
      ];

      const sel = el('select', {
        onchange: (e) => {
          dt.mode = e.target.value;
          push(true);
          render();
        },
      });
      MODES.forEach(([val, lbl]) => {
        const opt = el('option', { value: val, text: lbl });
        if (dt.mode === val) opt.selected = true;
        sel.appendChild(opt);
      });

      const MODE_DESCS = {
        artworkOrRandom: tr('Çalan şarkının albüm kapağı varsa renklerini çıkarıp miksler; kapak yoksa stüdyo armonisiyle rastgele bir renk teması üretir.'),
        artwork: tr('Yalnızca çalan şarkının albüm kapağındaki renkleri çıkarır ve miksler. Kapak yoksa mevcut renkleri korur.'),
        random: tr('Her şarkı değişiminde stüdyo renk teorisi ve armonik yayılımla (analogous, cyberpunk, sunset vb.) sıfırdan yepyeni 5 renkli bir palet üretir.'),
        energyMood: tr('Şarkı ve sanatçı adındaki anahtar kelimeleri ve duyguyu analiz ederek parçanın hissine özel renk paleti kurar.'),
        presetCycle: tr('Her yeni şarkıda uygulamadaki yerleşik hazır renk şablonlarını sırayla uygular.'),
        presetRandom: tr('Her yeni şarkıda yerleşik hazır renk şablonlarından rastgele birini seçip uygular.'),
      };

      const modeCtrl = el('div', { class: 'ctrl' }, [
        el('label', { class: 'lbl', text: tr('Çalışma Modu') }),
        sel,
        el('div', { class: 'dim-hint', style: 'margin-top: 5px;', text: MODE_DESCS[dt.mode] || '' }),
      ]);
      sub.appendChild(modeCtrl);

      // 4. Uygulama Hedefleri Switch'leri (Check-box yerine tam uyumlu switch)
      const makeSwitchControl = (label, isChecked, onToggle) => {
        const input = el('input', {
          type: 'checkbox',
          checked: !!isChecked,
          onchange: (e) => onToggle(e.target.checked),
        });
        const sw = el('label', { class: 'switch' }, [input, el('span', { class: 'track' })]);
        const row = el('div', { class: 'row' }, [
          el('label', { class: 'lbl', text: label }),
          sw,
        ]);
        return el('div', { class: 'ctrl' }, [row]);
      };

      sub.appendChild(makeSwitchControl(
        tr('Arkaplan 5 Noktalı Gradyan Paletine Uygula'),
        dt.applyToBackground !== false,
        (val) => { dt.applyToBackground = val; push(true); }
      ));

      sub.appendChild(makeSwitchControl(
        tr('Görselleştirici Ana ve İkincil Renklerine Uygula'),
        dt.applyToVisualizer !== false,
        (val) => { dt.applyToVisualizer = val; push(true); }
      ));

      // 5. Canlı Renk Paleti ve Test Butonu
      const currentColors = cfg.background && cfg.background.gradient && cfg.background.gradient.colors
        ? cfg.background.gradient.colors
        : ['#5b4be0', '#3aa6ff', '#37e0c8', '#7be07b', '#d24bff'];

      const swatchBar = el('div', {
        class: 'swatch dynamic-theme-swatch',
        style: `height: 28px; border-radius: 8px; background: linear-gradient(90deg, ${currentColors.join(',')}); border: 1px solid var(--line); margin-top: 6px;`,
        title: tr('Mevcut Aktif Renk Paleti'),
      });

      const testBtn = el('button', {
        class: 'btn',
        type: 'button',
        style: 'width: 100%; justify-content: center; margin-top: 8px;',
        icon: 'bolt', text: tr('Şimdi Test Et / Renkleri Uygula'),
        onclick: () => {
          applyDynamicThemeNow();
        },
      });

      const swatchCtrl = el('div', { class: 'ctrl' }, [
        el('label', { class: 'lbl', text: tr('Aktif Renk Paleti') }),
        swatchBar,
        testBtn,
      ]);
      sub.appendChild(swatchCtrl);

      wrap.appendChild(sub);
    }

    return wrap;
  }

  // Kategoriler — sol raydaki üst düzey gruplar
  // --------------------------------------------------------------------------
  const CATEGORIES = [
    {
      id: 'scene', icon: 'palette', title: 'Sahne',
      desc: 'Ekranda görünen her şey: arkaplan, görselleştirici, logo ve görsel nesneler.',
    },
    {
      id: 'audio', icon: 'speaker', title: 'Ses',
      desc: 'Hangi sesin yakalanacağı ve görüntüye nasıl çevrileceği.',
    },
    {
      id: 'lighting', icon: 'bulb', title: 'Işık',
      desc: 'Windows Dynamic Lighting ile uyumlu RGB aygıtlarını müzikle senkronize edin.',
    },
    {
      id: 'output', icon: 'tv', title: 'Çıkış',
      desc: 'Görüntünün nereye ve nasıl gideceği: ekran, yayın, performans ve video dosyası.',
    },
    {
      id: 'control', icon: 'sliders', title: 'Kontrol',
      desc: 'MIDI denetleyicileri ve OSC ile ayarları canlı sürün.',
    },
    {
      id: 'studio', icon: 'flask', title: 'Studio',
      desc: 'Kendi görselleştiricini ve arkaplanını yap; içe/dışa aktar.',
    },
    {
      id: 'library', icon: 'library', title: 'Kitaplık',
      desc: 'Kayıtlı sahneler, renk şablonları ve ayar yedekleri.',
    },
    {
      id: 'settings', icon: 'gear', title: 'Ayarlar',
      desc: 'Dil, pencere koruması, genişletilmiş aralıklar ve güncellemeler.',
    },
  ];

  /* Arkaplan modlarına özel ayarlar: katalogdaki `settings` listesi (#638).
     Her mod kendi ayar bloğunu (background.<mod>) taşır; yalnızca o mod
     seçiliyken görünür. Eskiden liste burada elle tutuluyordu ve otuz
     arkaplanın yirmi ikisinin ayarı motorda olduğu hâlde panelde yoktu. */
  function bgModeControls() {
    const out = [];
    MC().BACKGROUNDS.forEach(({ id: mode }) => {
      MC().settingsOf('background', mode).forEach(([key, label, min, max, step, percent]) => {
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
    const isStackOn = () => {
      if (window.SVLayers && typeof window.SVLayers.stackOn === 'function') {
        return window.SVLayers.stackOn(cfg);
      }
      const s = cfg && cfg.layerStack;
      if (s && typeof s.enabled === 'boolean') return s.enabled;
      return !!(cfg && Array.isArray(cfg.layers) && cfg.layers.length);
    };
    const notStack = () => !isStackOn();
    const isGradient = () => cfg.background.type === 'gradient';
    // Renk paleti gradyan dışındaki 2D arkaplan modlarında da kullanılır
    const usesPalette = () => cfg.background.type !== 'solid';
    /* K1: WebGL gradient ctor failed → silent 2D solid. Informational only. */
    const isGradientWebGLFallback = () => !!(
      window.SVLayers
      && typeof window.SVLayers.isGradientWebGLFallback === 'function'
      && window.SVLayers.isGradientWebGLFallback()
    );
    // Frekans bandı okuyan ön modlar (bar sayısı / frekans aralığı anlamlı)
    const isBandMode = () => MC().is('visualizer', v.type, 'bands');
    // Bar benzeri geometriye sahip modlar (aralarındaki boşluk anlamlı)
    const hasGap = () => MC().is('visualizer', v.type, 'gap');
    // Dalga formu çizen modlar (çizgi kalınlığı / genlik anlamlı)
    const isWaveMode = () => MC().is('visualizer', v.type, 'wave');
    return [
      {
        id: 'sources',
        category: 'audio',
        icon: 'mic',
        title: 'Ses Kaynakları',
        desc: 'Birden fazla kaynak seçilip karıştırılabilir: sistem sesi, mikrofon ve tek tek uygulamalar.',
        controls: [
          {
            type: 'multisource',
            path: 'audio.sources',
            label: 'Aktif Kaynaklar',
            devices: () => audioDevices,
            apps: () => (window.SVAppAudio ? window.SVAppAudio.candidates(audioApps) : []),
            appStatus: () => appAudioStatus,
          },
          { type: 'button', icon: 'refresh', label: 'Aygıtları Yenile', action: 'refreshDevices' },
        ],
      },
      {
        id: 'analysis',
        category: 'audio',
        icon: 'chart-line',
        title: 'Ses Analizi',
        desc: 'Yakalanan sesin görsele ne kadar sert veya yumuşak yansıyacağı.',
        controls: [
          { type: 'slider', path: 'audio.sensitivity', label: 'Hassasiyet', min: 0.2, max: 4, step: 0.05 },
          { type: 'slider', path: 'audio.smoothing', label: 'Yumuşatma', min: 0, max: 0.95, step: 0.01, percent: true , noExtend: true },
          { type: 'slider', path: 'audio.bassBoost', label: 'Bas Vurgusu', min: 1, max: 4, step: 0.05 },
          {
            type: 'toggle',
            path: 'audio.humGuard',
            label: 'Akıllı Sessizlik Filtresi',
            hint: 'Açıkken 50/60 Hz donanım uğultusu ve boşta dip gürültüsü sessizlik sayılır. Temiz stüdyo donanımında ham analiz için kapatılabilir (müzikte kayıp olmaz; yalnızca çok kısık saf test sinyallerinde etkilidir).',
          },
        ],
      },
      {
        id: 'lighting',
        category: 'lighting',
        icon: 'bulb',
        wide: true,
        /* Yalnız Windows: LampArray bir Windows API'si. Diğer
           platformlarda kart hiç çizilmez — devre dışı bir kart
           göstermek her açılışta gürültü olurdu. */
        show: isWindows,
        title: 'Windows Dynamic Lighting',
        desc: 'Uyumlu RGB aygıtlarını görselleştirici renkleriyle senkronize eder. Varsayılan olarak kapalıdır.',
        roots: [],
        controls: [{ type: 'lightingpanel' }],
      },
      {
        id: 'colorPresets',
        category: 'scene',
        icon: 'palette',
        wide: true,
        title: 'Renkler ve Hazır Şablonlar',
        desc: 'Akışkan gradyan ve palet kullanan arkaplanların renk dizisi ve hazır renk temaları.',
        /* Theme/preset strip: always visible (show => true).
           usesPalette helper stays for Background card speed/reactivity
           sliders only; do not gate this strip — other features still
           read the palette when background is solid. */
        show: () => true,
        controls: [
          { type: 'colors', path: 'background.gradient.colors', label: 'Renkler (5 nokta)' },
          { type: 'presets' },
        ],
      },
      {
        id: 'background',
        category: 'scene',
        icon: 'background',
        title: 'Arkaplan',
        desc: 'Sese tepki veren akışkan fon, dalga katmanları, yıldız alanı ve daha fazlası.',
        show: notStack,
        controls: [
          {
            type: 'segment', path: 'background.type', label: 'Tür', rebuild: true, grouped: true,
            options: MC().options('background'),
          },
          {
            type: 'note',
            warn: true,
            attrs: { 'data-sv-webgl-fallback-note': '1' },
            text: 'WebGL yok / desteklenmiyor: gradyan düz renge düştü',
            show: () => isGradient() && isGradientWebGLFallback(),
          },
          { type: 'custompicker', kind: 'background', show: () => cfg.background.type === 'custom' },
          {
            type: 'segment',
            path: 'background.colorMode',
            label: 'Renk Modu',
            rebuild: true,
            options: [
              { value: 'solid', label: 'Düz Renk' },
              { value: 'theme', label: 'Renk Teması' },
              { value: 'rainbow', label: 'Gökkuşağı' },
            ],
            show: () => usesPalette(),
          },
          { type: 'color', path: 'background.solidColor', label: 'Düz Renk',
            show: () => cfg.background.type === 'solid'
              || ((cfg.background.colorMode || 'theme') === 'solid' && cfg.background.type !== 'solid'), },
          { type: 'toggle', path: 'background.transparent', label: 'Şeffaf Arkaplan', rebuild: true },
          {
            type: 'note',
            text: 'Şeffaf arkaplan açıkken görselleştirici pencerenin arkası görünür: düz renk arkaplan boyanmaz, arkaplan efektlerinin koyu yerleri saydamlaşır. Yayın katmanı (OBS) ve Spout/Syphon aynı ayarı kullanır. Pencere şeffaflığı doğuşta kilitlendiği için açık görselleştirici pencereleri bu anahtarla yeniden kurulur.',
            show: () => !!cfg.background.transparent,
          },
          {
            type: 'toggle', path: 'background.coverTaskbar', label: 'Tam Ekran (Görev Çubuğu Dahil)',
            show: () => !!cfg.background.transparent,
          },
          {
            type: 'note',
            text: 'Kapalıyken görselleştirici Windows görev çubuğunun dışında kalır (çalışma alanı). Açıkken tüm ekranı — görev çubuğu dahil — kaplar. Yalnızca şeffaf arkaplanda gerekir; opak tam ekran zaten görev çubuğunu örter. Canlı uygulanır; pencere yeniden kurulmaz.',
            show: () => !!cfg.background.transparent,
          },
          {
            type: 'slider', path: 'background.transparentKey', label: 'Saydamlık Eşiği',
            min: 0, max: 1, step: 0.01, percent: true,
            show: () => !!cfg.background.transparent && cfg.background.type !== 'solid',
          },
          {
            type: 'note',
            text: 'Arkaplan efektinin bu parlaklığın altında kalan yerleri masaüstünü gösterir: siyah tamamen saydam, eşiğin üstü tamamen görünür. Canlı uygulanır.',
            show: () => !!cfg.background.transparent && cfg.background.type !== 'solid',
          },
          {
            type: 'segment', path: 'background.gradient.style', label: 'Stil',
            options: [
              { value: 'soft', label: 'Yumuşak (Parlamasız)' },
              { value: 'plasma', label: 'Plazma (Parlamalı)' },
            ],
            show: () => cfg.background.type === 'gradient',
          },
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
        icon: 'palette',
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
        icon: 'bars',
        title: 'Görselleştirici',
        desc: 'Sese duyarlı ön efekt: barlar, dalga, çember, tünel, spektrogram ve daha fazlası.',
        show: notStack,
        controls: [
          {
            type: 'segment', path: 'visualizer.type', label: 'Tür', rebuild: true, grouped: true,
            options: MC().options('visualizer'),
          },
          { type: 'custompicker', kind: 'visualizer', show: () => v.type === 'custom' },
          {
            type: 'segment',
            path: 'visualizer.colorMode',
            label: 'Renk Modu',
            rebuild: true,
            options: [
              { value: 'custom', label: 'Sabit Renk' },
              { value: 'theme', label: 'Renk Teması' },
              { value: 'rainbow', label: 'Gökkuşağı' },
            ],
            show: () => v.type !== 'none',
          },
          {
            type: 'color',
            path: 'visualizer.color',
            label: 'Renk',
            show: () => v.type !== 'none' && v.type !== 'nowplaying' && v.type !== 'text'
              && (v.colorMode || (v.rainbow ? 'rainbow' : 'custom')) === 'custom',
          },
          {
            type: 'color',
            path: 'visualizer.color2',
            label: 'İkincil Renk',
            show: () => v.type !== 'nowplaying' && v.type !== 'text'
              && (v.colorMode || (v.rainbow ? 'rainbow' : 'custom')) === 'custom'
              && MC().is('visualizer', v.type, 'color2'),
          },
          /* Now Playing solid/custom: all three editable colors (not visualizer.color). */
          {
            type: 'color', path: 'nowplaying.color', label: 'Parça Adı',
            show: () => v.type === 'nowplaying'
              && (v.colorMode || (v.rainbow ? 'rainbow' : 'custom')) === 'custom',
          },
          {
            type: 'color', path: 'nowplaying.colorDim', label: 'İkincil Yazı',
            show: () => v.type === 'nowplaying'
              && (v.colorMode || (v.rainbow ? 'rainbow' : 'custom')) === 'custom',
          },
          {
            type: 'color', path: 'nowplaying.colorBar', label: 'Çubuk',
            show: () => v.type === 'nowplaying'
              && isWindows()
              && ((cfg.nowplaying && cfg.nowplaying.source) || 'system') === 'system'
              && (v.colorMode || (v.rainbow ? 'rainbow' : 'custom')) === 'custom',
          },
          {
            type: 'toggle', path: 'nowplaying.coverOverlay', label: 'Kapağı Göster',
            rebuild: true,
            show: () => v.type === 'nowplaying',
          },
          {
            type: 'note',
            text: 'Çalan parçanın albüm kapağını yazının yanına veya üstüne yerleştirir. Boyut ekranın kısa kenarına göredir. Kapak yoksa bindirme çizilmez. Varsayılan kapalıdır.',
            show: () => v.type === 'nowplaying' && !!(cfg.nowplaying && cfg.nowplaying.coverOverlay),
          },
          {
            type: 'select', path: 'nowplaying.coverSource', label: 'Kapak Kaynağı', rebuild: true,
            options: [
              { value: 'auto', label: 'Otomatik (Sistem)' },
              { value: 'manual', label: 'Elle Yükle' },
            ],
            show: () => isWindows() && v.type === 'nowplaying' && !!(cfg.nowplaying && cfg.nowplaying.coverOverlay),
          },
          {
            type: 'note',
            text: () => {
              if (!isWindows()) return 'Bu platformda albüm kapağı otomatik okunamaz. Gösterilecek resmi elle yükleyin.';
              const src = (cfg.nowplaying && cfg.nowplaying.coverSource) || 'auto';
              return src === 'manual'
                ? 'Elle yüklenen resim yazının yanında gösterilir.'
                : 'Windows’ta kapak çalan parçadan otomatik gelir. İsterseniz kendi resminizi de yükleyebilirsiniz; otomatik kapak yoksa o resim kullanılır.';
            },
            show: () => v.type === 'nowplaying' && !!(cfg.nowplaying && cfg.nowplaying.coverOverlay),
          },
          {
            type: 'npcoverfile',
            show: () => v.type === 'nowplaying' && !!(cfg.nowplaying && cfg.nowplaying.coverOverlay),
          },
          {
            type: 'slider', path: 'nowplaying.coverSize', label: 'Kapak Boyutu',
            min: 0.05, max: 0.5, step: 0.01, percent: true,
            show: () => v.type === 'nowplaying' && !!(cfg.nowplaying && cfg.nowplaying.coverOverlay),
          },
          {
            type: 'slider', path: 'nowplaying.coverGap', label: 'Yazı Aralığı',
            min: 0, max: 1, step: 0.02, percent: true,
            show: () => v.type === 'nowplaying' && !!(cfg.nowplaying && cfg.nowplaying.coverOverlay),
          },
          {
            type: 'slider', path: 'nowplaying.coverRadius', label: 'Köşe / Oval',
            min: 0, max: 0.5, step: 0.01, percent: true,
            show: () => v.type === 'nowplaying' && !!(cfg.nowplaying && cfg.nowplaying.coverOverlay),
          },
          {
            type: 'select', path: 'nowplaying.coverFit', label: 'Kapak Sığdırma',
            options: [
              { value: 'natural', label: 'Doğal oran' },
              { value: 'square', label: 'Kareye ger' },
              { value: 'cover', label: 'Kareye kapla' },
              { value: 'contain', label: 'Kareye sığdır' },
            ],
            show: () => v.type === 'nowplaying' && !!(cfg.nowplaying && cfg.nowplaying.coverOverlay),
          },
          {
            type: 'select', path: 'nowplaying.coverSide', label: 'Kapak Konumu',
            options: [
              { value: 'auto', label: 'Otomatik (Üstte)' },
              { value: 'left', label: 'Solda' },
              { value: 'right', label: 'Sağda' },
              { value: 'top', label: 'Üstte' },
            ],
            show: () => v.type === 'nowplaying' && !!(cfg.nowplaying && cfg.nowplaying.coverOverlay),
          },
          {
            type: 'slider', path: 'nowplaying.coverAudioScale', label: 'Kapak Bas Nabzı',
            min: 0, max: 0.4, step: 0.01,
            show: () => v.type === 'nowplaying' && !!(cfg.nowplaying && cfg.nowplaying.coverOverlay),
          },
          {
            type: 'color', path: 'text.color', label: 'Metin Rengi',
            show: () => v.type === 'text'
              && (v.colorMode || (v.rainbow ? 'rainbow' : 'custom')) === 'custom',
          },
          {
            type: 'color', path: 'text.colorHighlight', label: 'Vurgu Rengi',
            hint: 'Söylenen kısmı boyar. Sabit yazı ve çalan parça bu rengi kullanmaz.',
            show: () => v.type === 'text'
              && (v.colorMode || (v.rainbow ? 'rainbow' : 'custom')) === 'custom'
              && cfg.text
              && (cfg.text.source || 'static') === 'lyrics'
              && cfg.text.karaoke !== false,
          },
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

          /* --- Bar yerleşimi ---
             Yayın ve müzik videosu düzenlerinde bar bloğu kadranın tamamını
             kaplamaz: köşede, ortada ya da ince bir şerit olarak durur. */
          { type: 'slider', path: 'visualizer.barSpan', label: 'Bar Genişliği', min: 0.1, max: 1, step: 0.01, percent: true, nullable: 1, show: () => v.type === 'bars', group: 'Bar Yerleşimi', advanced: true },
          { type: 'slider', path: 'visualizer.barCenterX', label: 'Yatay Konum', min: 0, max: 1, step: 0.01, percent: true, nullable: 0.5, show: () => v.type === 'bars', group: 'Bar Yerleşimi', advanced: true },
          { type: 'slider', path: 'visualizer.barHeight', label: 'Bar Yüksekliği', min: 0.05, max: 1, step: 0.01, percent: true, nullable: 0.92, show: () => v.type === 'bars', group: 'Bar Yerleşimi', advanced: true },
          { type: 'slider', path: 'visualizer.baseline', label: 'Taban Çizgisi', min: 0, max: 1, step: 0.01, percent: true, nullable: 1, show: () => v.type === 'bars', group: 'Bar Yerleşimi', advanced: true },

          // --- Dalga / çizgi biçimi (gelişmiş) ---
          { type: 'slider', path: 'visualizer.lineWidth', label: 'Çizgi Kalınlığı', min: 1, max: 12, step: 0.5, show: isWaveMode, group: 'Dalga Biçimi', advanced: true },
          { type: 'slider', path: 'visualizer.thickness', label: 'Genlik / Dolgu', min: 0.1, max: 1, step: 0.02, percent: true, show: () => MC().is('visualizer', v.type, 'thick'), group: 'Dalga Biçimi', advanced: true },

          // --- Frekans aralığı (gelişmiş) ---
          { type: 'slider', path: 'visualizer.minFreq', label: 'Min Frekans (Hz)', min: 20, max: 500, step: 5, show: isBandMode, group: 'Frekans Aralığı', advanced: true },
          { type: 'slider', path: 'visualizer.maxFreq', label: 'Max Frekans (Hz)', min: 2000, max: 20000, step: 100, show: isBandMode, group: 'Frekans Aralığı', advanced: true },

          /* --- Tayf ölçümü (gelişmiş) ---
             Barların NASIL ölçüldüğü. Ölçek bantların frekans ekseninde nasıl
             dağıldığını, genlik yüksekliğe nasıl çevrildiğini, balistik ise
             hareketin karakterini belirler. */
          { type: 'select', path: 'visualizer.spectrum.scale', label: 'Frekans Ölçeği', show: isBandMode, group: 'Tayf Ölçümü', advanced: true,
            options: [
              { value: 'log', label: 'Logaritmik (müzikal)' },
              { value: 'linear', label: 'Doğrusal' },
              { value: 'mel', label: 'Mel (algısal)' },
              { value: 'bark', label: 'Bark (kritik bant)' },
            ] },
          { type: 'select', path: 'visualizer.spectrum.amplitude', label: 'Genlik Ölçeği', show: isBandMode, group: 'Tayf Ölçümü', advanced: true,
            options: [
              { value: 'linear', label: 'Doğrusal' },
              { value: 'db', label: 'Desibel (sessiz ayrıntıyı görünür kılar)' },
            ] },
          { type: 'slider', path: 'visualizer.spectrum.floorDb', label: 'dB Tabanı', min: -96, max: -24, step: 2, group: 'Tayf Ölçümü', advanced: true,
            show: () => isBandMode() && (v.spectrum || {}).amplitude === 'db' },
          { type: 'slider', path: 'visualizer.spectrum.attack', label: 'Atak (sn)', min: 0, max: 0.2, step: 0.005, show: isBandMode, group: 'Tayf Ölçümü', advanced: true },
          { type: 'slider', path: 'visualizer.spectrum.release', label: 'Bırakma (sn)', min: 0.01, max: 1.2, step: 0.01, show: isBandMode, group: 'Tayf Ölçümü', advanced: true },
          { type: 'slider', path: 'visualizer.spectrum.spread', label: 'Komşu Yayılımı', min: 0, max: 0.95, step: 0.01, percent: true, show: isBandMode, group: 'Tayf Ölçümü', advanced: true },
          { type: 'slider', path: 'visualizer.spectrum.tilt', label: 'Eğim (dB/oktav)', min: -6, max: 12, step: 0.5, show: isBandMode, group: 'Tayf Ölçümü', advanced: true },
          { type: 'slider', path: 'visualizer.spectrum.smooth', label: 'Profil Yumuşatma', min: 0, max: 1, step: 0.01, percent: true, show: isBandMode, group: 'Tayf Ölçümü', advanced: true },
        ],
      },
      {
        id: 'layers',
        /* layers dizisi yaprak kalır: bölüm/kategori sıfırlaması tüm yığını
           fabrika varsayılanına (boş []) döndürür — kullanıcının eklediği
           katmanlar kalkar, sevkiyat varsayılan yığını gelir. layerStack /
           layerGroups / crossfade kategori düzeyi kontrollerdir. Katman
           içi ayarlar genişletilmez (Layers’a özgü). */
        roots: ['layers', 'layerStack', 'layerGroups', 'crossfade'],
        category: 'scene',
        icon: 'layers',
        wide: true,
        title: 'Katmanlar',
        desc: 'Sahneyi üst üste binen katmanlardan kurun: her katmanın kendi kaynağı, karışım modu, saydamlığı, dönüşümü ve sese tepkisi olur.',
        controls: [{ type: 'layerspanel' }],
      },
      {
        id: 'templates',
        /* Badge/reset must cover every SCENE_KEYS field apply() touches.
           Partial roots left modulation/layers/geometry dirty and — with
           layerStack on — syncStackState re-cleared classic visualizer to
           'none' after a partial reset, so the badge bounced back alone. */
        roots: (window.SVTemplates && window.SVTemplates.SCENE_KEYS
          ? window.SVTemplates.SCENE_KEYS.slice()
          : ['background', 'visualizer', 'geometry', 'postfx', 'layers', 'layerStack', 'logo',
            'modulation', 'transition', 'custom', 'milkdrop', 'images', 'feedback']),
        /* Same preserves as templates.apply / resetScene — user setup, not scene. */
        rootOmit: [
          'background.transparent', 'background.transparentKey', 'background.coverTaskbar',
          'logo.src', 'logo.libraryId', 'logo.kind', 'logo.source', 'logo.enabled',
        ],
        /* TEMP: hide card modified badge + circular reset on Ready Templates.
           Applying a template still changes SCENE_KEYS; re-enable by setting
           hideCardReset: false once resetScene bounce is fully validated UX-wise. */
        hideCardReset: true,
        category: 'library',
        icon: 'sparkles',
        wide: true,
        title: 'Hazır Şablonlar',
        desc: 'Kullanıma ve türe göre gruplanmış bitmiş sahneler. Tek tıkla uygulanır; ses, ekran, yayın ve aydınlatma ayarlarınıza dokunmaz.',
        controls: [{ type: 'templatepanel' }],
      },
      {
        id: 'record',
        roots: ['recording'],
        category: 'output',
        icon: 'record',
        title: 'Kayıt ve Anlık Görüntü',
        desc: 'Ekranda göründüğü gibi kaydedin: canlı sesle, modülasyon, geçiş ve efektler dahil. MP4, WebM, GIF ve PNG.',
        controls: [{ type: 'recordpanel' }],
      },
      {
        /* Haritalamadan ÖNCE geliyor ve sırası kasıtlı: önce panelin piksel
           geometrisi düzeltilir, sonra görüntü yüzeye oturtulur. Ters sırada
           kullanıcı köşeleri basık bir görüntüye göre hizalar ve düzeltmeyi
           sonradan açınca hizalamayı baştan yapması gerekirdi. */
        id: 'aspect',
        roots: ['aspect'],
        category: 'output',
        icon: 'ellipse',
        title: 'Basıklık Düzeltme',
        desc: 'Ekranın bildirdiği çözünürlük fiziksel şekliyle uyuşmuyorsa daireler elips, logo ve yazılar basık çıkar. Tek ayarla arkaplan, görselleştirici, logo ve yazıların hepsi birden düzelir; kırpma ya da siyah bant oluşmaz.',
        controls: [{ type: 'aspectpanel' }],
      },
      {
        id: 'mapping',
        roots: ['mapping'],
        category: 'output',
        icon: 'warp',
        wide: true,
        title: 'Projeksiyon Haritalama',
        desc: 'Görüntüyü düz olmayan yüzeylere oturtun: köşe düzeltme, bükme ızgarası, kırpma, kenar harmanlama, ekran başına renk düzeltme, maske ve hizalama desenleri.',
        controls: [{ type: 'mappingpanel' }],
      },
      {
        id: 'deepanalysis',
        roots: [],
        category: 'audio',
        icon: 'chart-bar',
        wide: true,
        title: 'Ses Çözümlemesi',
        desc: 'Sinyalden çıkarılan canlı ölçümler: tonalite, akor, perde, gürlük, tını, armonik/vurmalı dengesi ve nota sınıfı dağılımı. Hepsi modülasyon matrisinde kaynak olarak kullanılabilir.',
        controls: [{ type: 'analysispanel' }],
      },
      {
        id: 'text',
        roots: ['text'],
        category: 'scene',
        icon: 'text',
        title: 'Metin ve Şarkı Sözü',
        desc: 'Sabit metin, zamanlanmış şarkı sözü (LRC / SRT, karaoke vurgusuyla) ya da çalan parça bilgisi.',
        show: notStack,
        controls: [{ type: 'textpanel' }],
      },
      {
        id: 'dynamicTheme',
        roots: ['dynamicTheme'],
        category: 'scene',
        icon: 'disco',
        wide: true,
        title: 'Dinamik Renk Teması (Windows)',
        desc: 'Çalan şarkının albüm kapağına veya şarkı geçişlerine göre renk temasını otomatik değiştirin.',
        show: () => !!(window.SV_PLATFORM && window.SV_PLATFORM.isWindows),
        controls: [{ type: 'dynamictheme' }],
      },
      {
        id: 'nowplaying',
        roots: ['nowplaying'],
        category: 'scene',
        icon: 'music',
        title: 'Çalan Parça',
        desc: isWindows()
          ? 'Bilgisayarda çalan parçayı ekrana getirir: ad, sanatçı, geçen ve kalan süre, ilerleme çubuğu. Sürekli görünebilir ya da yalnızca parça değişince canlandırmayla belirir.'
          : 'Elle yazılan parça adı ve sanatçı ekrana gelir. Albüm kapağı elle yüklenir. Süre ve ilerleme çubuğu sistemden okunduğu için bu platformda yoktur.',
        controls: [{ type: 'nowplayingpanel' }],
        show: () => notStack() && v.type === 'nowplaying',
      },
      {
        id: 'milkdrop',
        roots: ['milkdrop'],
        category: 'scene',
        icon: 'drop',
        wide: true,
        title: 'MilkDrop Presetleri',
        desc: 'MilkDrop preset dosyalarını (.milk) yükleyin. Denklem blokları gerçekten çalıştırılır: per_frame ve per_pixel hareketi, warp ağı ve geri besleme.',
        controls: [{ type: 'milkdroppanel' }],
        /* Scene only when MilkDrop is actually in use:
           stack on → at least one MilkDrop visualizer layer;
           stack off → classic visualizer mode is MilkDrop. */
        show: () => {
          if (isStackOn()) {
            return (cfg.layers || []).some(
              (l) => l && l.kind === 'visualizer' && l.type === 'milkdrop');
          }
          return v.type === 'milkdrop';
        },
      },
      {
        id: 'transition',
        roots: ['transition'],
        category: 'scene',
        icon: 'swap',
        title: 'Sahne Geçişi',
        desc: 'Sahne değiştirirken sert kesme yerine geçiş: çapraz geçiş, silme, iris, zum, glitch ve daha fazlası. İstenirse tamamen kapatılabilir.',
        controls: [{ type: 'transitionpanel' }],
      },
      {
        id: 'modulation',
        roots: ['modulation'],
        category: 'scene',
        icon: 'wave',
        wide: true,
        title: 'Modülasyon Matrisi',
        desc: 'Herhangi bir kaynağı (bas, LFO, zarf, makro, rastgele, tempo) herhangi bir sayısal ayara bağlayın. Kaydedilen ayarlar değişmez; modülasyon yalnızca çizim anında uygulanır ve dışa aktarımda da birebir çalışır.',
        controls: [{ type: 'modulationpanel' }],
      },
      {
        id: 'groups',
        roots: ['layerGroups'],
        category: 'scene',
        icon: 'copy',
        title: 'Katman Grupları ve A/B',
        desc: 'Birden çok katmanı tek fader ile yönetin; "A" ve "B" grupları arasında eşit güç eğrisiyle çapraz geçiş yapın.',
        controls: [{ type: 'grouppanel' }],
      },
      {
        id: 'effects',
        roots: ['postfx'],
        category: 'scene',
        icon: 'sparkle',
        wide: true,
        title: 'Efekt Zinciri',
        desc: 'Birleştirilmiş sahneye sırayla uygulanan son-işlem efektleri. Sıra görüntüyü değiştirir; zincir dışa aktarımda da aynen çalışır.',
        controls: [{ type: 'effectspanel' }],
      },
      {
        id: 'geometry',
        roots: ['geometry'],
        category: 'scene',
        icon: 'cube',
        title: '3B Geometri',
        desc: 'Matematiksel formüllerden gerçek perspektifte geometri: yüzeyler, uzay eğrileri ve çekici sistemler.',
        show: () => notStack() && cfg.visualizer.type === 'geometry',
        controls: [{ type: 'geometrypanel' }],
      },
      {
        id: 'feedbackengine',
        roots: ['feedback'],
        category: 'scene',
        icon: 'infinity',
        title: 'Geri Besleme Motoru',
        desc: 'MilkDrop ailesi: her kare bir öncekini büker, yakınlaştırır ve söndürür. Sonsuz tünel görünümü buradan gelir.',
        show: () => notStack() && cfg.visualizer.type === 'feedback',
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
        roots: ['media'],
        category: 'scene',
        icon: 'video',
        title: 'Medya Katmanı',
        desc: 'Web kameranızı veya bir video dosyasını sahneye katman olarak koyun; sese göre nabız atsın.',
        show: notStack,
        controls: [{ type: 'mediapanel' }],
      },
      {
        id: 'stream',
        category: 'output',
        icon: 'broadcast',
        wide: true,
        title: 'Yayın Çıkışı (OBS / Web)',
        desc: 'OBS ve benzeri programlara "Tarayıcı Kaynağı" olarak eklenebilen bir sayfa yayınlar; telefondan uzaktan kumanda da buradan açılır.',
        controls: [{ type: 'streampanel' }],
      },
      {
        id: 'timeline',
        category: 'control',
        icon: 'timeline',
        wide: true,
        title: 'Zaman Çizelgesi',
        desc: 'Sahneleri ve ayar değişimlerini zamana yayın. Ölçüye ya da saniyeye hizalı planlayın; oynatma kafası tüm ekranları birlikte sürer.',
        controls: [{ type: 'timelinepanel' }],
      },
      {
        id: 'clipdeck',
        category: 'control',
        icon: 'grid',
        wide: true,
        title: 'Klip Destesi',
        desc: 'Sahneleri, şablonları ve medyayı bir ızgaraya yerleştirip vuruşa hizalı ateşleyin. Sütun başlatmak satırın tamamını sahne gibi çalıştırır.',
        controls: [{ type: 'clipdeckpanel' }],
      },
      {
        id: 'tempo',
        category: 'control',
        icon: 'drum',
        title: 'Tempo ve Otomatik VJ',
        desc: 'Parçanın temposunu bulur; sahneleri, modları veya renkleri ölçüye hizalı olarak kendiliğinden değiştirir.',
        controls: [{ type: 'autovjpanel' }],
      },
      {
        /* Kullanıcı Windows'ta yaptığı ayarı buraya taşıdıysa
           lighting.enabled açık gelir ama hiçbir şey olmaz. Sessiz
           kalmak yerine nedenini söyle. */
        id: 'lightingUnavailable',
        category: 'lighting',
        icon: 'bulb',
        wide: true,
        show: () => !isWindows() && !!(cfg.lighting && cfg.lighting.enabled),
        title: 'Windows Dynamic Lighting bu sistemde yok',
        desc: 'Ayarlarınızda açık görünüyor ama Windows Dynamic Lighting yalnızca Windows üzerinde çalışır. Bu sistemde RGB aygıtları için OpenRGB veya Art-Net/DMX kullanın.',
        controls: [],
      },
      {
        /* Spout (Windows) / Syphon (macOS): goruntuyu ayni makinedeki
           baska bir uygulamaya GPU uzerinden verir. Linux'ta yok, ama
           kart yine cizilir: orada NEDEN olmadigini ve yerine ne
           kullanilacagini soylemek, olmayan bir ayari aratmaktan iyidir. */
        id: 'textureShare',
        category: 'output',
        icon: 'tv',
        wide: true,
        title: 'Spout / Syphon Çıkışı',
        desc: 'Görüntüyü aynı bilgisayardaki başka bir uygulamaya GPU üzerinden verir: Resolume, OBS, TouchDesigner. Pencere yakalama ve eklenti gerekmez.',
        controls: [{ type: 'texturepanel' }],
      },
      {
        /* Windows'ta Dynamic Lighting'in YERINE degil YANINA: LampArray
           yalniz Windows'un tanidigi aygitlari surer, OpenRGB cok daha
           fazlasini. macOS ve Linux'ta RGB'nin tek yolu budur. */
        id: 'openrgb',
        category: 'lighting',
        icon: 'rainbow',
        wide: true,
        title: 'OpenRGB',
        desc: 'Ayrı çalışan OpenRGB sunucusuna bağlanır ve RGB aygıtlarını müzikle sürer. Windows, macOS ve Linux.',
        roots: ['openrgb'],
        controls: [{ type: 'openrgbpanel' }],
      },
      {
        id: 'artnet',
        category: 'lighting',
        icon: 'sliders',
        title: 'Art-Net / DMX Çıkışı',
        desc: 'Sahne renklerini standart DMX protokolüyle ışık konsollarına ve arayüzlerine yollar.',
        roots: ['artnet'],
        controls: [{ type: 'artnetpanel' }],
      },
      {
        /* Ortak görünüm: WDL kapalı veya OpenRGB tek başına açıkken de
           erişilsin diye kategorinin EN ALTINDA, belirgin başlıkla. */
        id: 'lightingGeneral',
        category: 'lighting',
        icon: 'sliders',
        wide: true,
        title: 'Genel Işık Ayarları',
        desc: isWindows()
          ? 'Mod, renk ve ses tepkisi — Windows Dynamic Lighting ve OpenRGB ortak görünümü. Her ayarın hangi çıkışlarda geçerli olduğu yanında yazar. Art-Net kendi kartındaki ayarları kullanır.'
          : 'Mod, renk ve ses tepkisi — OpenRGB çıkışı. Art-Net kendi kartındaki ayarları kullanır.',
        roots: ['lighting'],
        rootOmit: ['lighting.enabled', 'lighting.deviceColors', 'lighting.deviceLedColors'],
        controls: [{ type: 'lightinggeneralpanel' }],
      },
      {
        id: 'midi',
        category: 'control',
        icon: 'keys',
        wide: true,
        title: 'MIDI Denetleyici',
        desc: 'MIDI kumandanızın düğme ve faderlarını istediğiniz ayara bağlayın. Öğren düğmesine basıp denetleyiciyi oynatmanız yeterli.',
        controls: [{ type: 'controlpanel', surface: 'midi' }],
      },
      {
        id: 'osc',
        category: 'control',
        icon: 'share',
        wide: true,
        title: 'OSC',
        desc: 'TouchOSC, Resolume, Ableton veya QLab gibi kaynaklardan gelen OSC mesajlarını ayarlara bağlayın.',
        controls: [{ type: 'controlpanel', surface: 'osc' }],
      },
      {
        id: 'mcp',
        category: 'control',
        icon: 'sliders',
        wide: true,
        title: 'MCP',
        desc: 'Ajan bu karttaki kiple sürer. Kapalı başlar; açılınca okuma. Her şey kipi tek tık ve varsayılan değil.',
        controls: [{ type: 'mcppanel' }],
      },
      {
        id: 'studio',
        category: 'studio',
        icon: 'flask',
        wide: true,
        title: 'Studio — Kendi Görselleştiricin',
        desc: 'Hazır bir modu kendine göre değiştir ya da sıfırdan shader yaz. Shadertoy, ISF ve MilkDrop dosyaları içe aktarılabilir.',
        controls: [{ type: 'studiopanel' }],
      },
      {
        id: 'scenegen',
        roots: [],
        category: 'studio',
        icon: 'dice',
        title: 'Sahne Üretici',
        desc: 'Ruh halini yaz, uygulama sana uygun bir sahne kursun. Tamamen çevrimdışı çalışır.',
        controls: [{ type: 'scenegen' }],
      },
      {
        id: 'mdgen',
        roots: [],
        category: 'studio',
        icon: 'dna',
        title: 'MilkDrop Preset Üretici',
        desc: 'Enerji, sıcaklık, yoğunluk ve hareketten özgün bir MilkDrop preseti yazar ya da kütüphanenizdeki presetlerin parçalarını karıştırır. Tamamen çevrimdışı; beğendiğinizi kütüphaneye kaydedin.',
        controls: [{ type: 'mdgenpanel' }],
      },
      {
        id: 'mdedit',
        roots: [],
        category: 'studio',
        icon: 'pencil',
        wide: true,
        title: 'MilkDrop Preset Düzenleyici',
        desc: 'Ekrandaki MilkDrop presetinin denklemlerini, dalgalarını, şekillerini ve shader\'larını düzenleyin; sonuç çalışan görüntüde hemen görünür. Hatalar presetin kendi satırını gösterir. Asıl preset hiç değişmez.',
        controls: [{ type: 'mdeditpanel' }],
      },
      {
        id: 'logo',
        roots: ['logo'],
        category: 'scene',
        icon: 'image',
        title: 'Logo / Resim',
        desc: 'Sahneye bir resim veya GIF yerleştirin; sese göre nabız atar. GIF seçilince oynatma ve ses ayarları açılır.',
        show: notStack,
        controls: [
          { type: 'toggle', path: 'logo.enabled', label: 'Logo Göster', rebuild: true },
          {
            type: 'select',
            path: 'logo.source',
            label: 'Resim Kaynağı',
            options: [
              { value: 'auto', label: 'Otomatik (Şarkı resmi varsa göster, yoksa özel)' },
              { value: 'manual', label: 'Özel Resim (Yalnızca seçilen dosya)' },
              { value: 'track', label: 'Sadece Çalan Şarkı Resmi' },
            ],
            show: () => cfg.logo.enabled && isWindows(),
            rebuild: true,
          },
          { type: 'logofile', show: () => cfg.logo.enabled },
          { type: 'slider', path: 'logo.scale', label: 'Boyut', min: 0.05, max: 0.6, step: 0.01, percent: true, show: () => cfg.logo.enabled },
          { type: 'slider', path: 'logo.opacity', label: 'Saydamlık', min: 0, max: 1, step: 0.02, percent: true, show: () => cfg.logo.enabled },
          { type: 'slider', path: 'logo.pulse', label: 'Ses Nabzı', min: 0, max: 1, step: 0.02, percent: true, show: () => cfg.logo.enabled },
          { type: 'slider', path: 'logo.cornerRadius', label: 'Köşe / Oval', min: 0, max: 0.5, step: 0.01, percent: true, show: () => cfg.logo.enabled },
          { type: 'slider', path: 'logo.speed', label: 'Oynatma Hızı', min: 0.1, max: 3, step: 0.01, show: () => cfg.logo.enabled && isGifLogo(cfg.logo) },
          {
            type: 'segment', path: 'logo.loop', label: 'Döngü',
            options: [{ value: 'loop', label: 'Tekrar' }, { value: 'pingpong', label: 'Gidiş-Dönüş' }, { value: 'once', label: 'Bir Kez' }],
            show: () => cfg.logo.enabled && isGifLogo(cfg.logo),
          },
          { type: 'toggle', path: 'logo.reverse', label: 'Ters Oynat', show: () => cfg.logo.enabled && isGifLogo(cfg.logo) },
          { type: 'toggle', path: 'logo.smooth', label: 'Kenar Yumuşatma', show: () => cfg.logo.enabled && isGifLogo(cfg.logo) },
          { type: 'slider', path: 'logo.brightness', label: 'Parlaklık', min: 0.2, max: 2, step: 0.01, show: () => cfg.logo.enabled && isGifLogo(cfg.logo) },
          { type: 'slider', path: 'logo.hue', label: 'Renk Kayması', min: 0, max: 1, step: 0.01, percent: true, show: () => cfg.logo.enabled && isGifLogo(cfg.logo) },
          { type: 'slider', path: 'logo.saturate', label: 'Doygunluk', min: 0, max: 2, step: 0.01, show: () => cfg.logo.enabled && isGifLogo(cfg.logo) },
          {
            type: 'segment', path: 'logo.blend', label: 'Karışım',
            options: [{ value: 'normal', label: 'Normal' }, { value: 'screen', label: 'Ekran' }, { value: 'add', label: 'Ekle' }],
            show: () => cfg.logo.enabled && isGifLogo(cfg.logo),
          },
          {
            type: 'select', path: 'logo.audioBand', label: 'Ses Bandı',
            options: [
              { value: 'bass', label: 'Bas' },
              { value: 'mid', label: 'Orta' },
              { value: 'treble', label: 'Tiz' },
              { value: 'level', label: 'Seviye' },
            ],
            show: () => cfg.logo.enabled && isGifLogo(cfg.logo),
          },
          { type: 'slider', path: 'logo.audioSpeed', label: 'Ses → Hız', min: 0, max: 1, step: 0.01, percent: true, show: () => cfg.logo.enabled && isGifLogo(cfg.logo) },
          { type: 'slider', path: 'logo.audioBrightness', label: 'Ses → Parlaklık', min: 0, max: 1, step: 0.01, percent: true, show: () => cfg.logo.enabled && isGifLogo(cfg.logo) },
          { type: 'slider', path: 'logo.audioOpacity', label: 'Ses → Saydamlık', min: 0, max: 1, step: 0.01, percent: true, show: () => cfg.logo.enabled && isGifLogo(cfg.logo) },
          { type: 'slider', path: 'logo.beatFlash', label: 'Ritim Parlaması', min: 0, max: 1, step: 0.01, percent: true, show: () => cfg.logo.enabled && isGifLogo(cfg.logo) },
          { type: 'slider', path: 'logo.audioHue', label: 'Ses → Renk', min: 0, max: 1, step: 0.01, percent: true, show: () => cfg.logo.enabled && isGifLogo(cfg.logo) },
          { type: 'slider', path: 'logo.glow', label: 'Parlama', min: 0, max: 1, step: 0.02, percent: true, show: () => cfg.logo.enabled, group: 'Konum ve Işıltı', advanced: true },
          { type: 'xy', show: () => cfg.logo.enabled, group: 'Konum ve Işıltı', advanced: true },
          { type: 'logolibrary', show: () => cfg.logo.enabled },
        ],
      },
      {
        id: 'images',
        roots: ['images'],
        category: 'scene',
        icon: 'sparkles',
        title: 'Görsel Nesneler',
        desc: 'Resim ekleyin; sahnede süzülsün, yörünge çizsin, sese göre saçılsın.',
        show: notStack,
        controls: [
          { type: 'toggle', path: 'images.enabled', label: 'Görsel Nesneleri Etkinleştir', rebuild: true },
          { type: 'images', show: () => cfg.images && cfg.images.enabled },
        ],
      },
      {
        id: 'display',
        category: 'output',
        icon: 'monitor',
        title: 'Ekran',
        desc: 'Görselleştirme hangi ekranda tam ekran açılsın? Üst çubuktan da seçebilirsiniz.',
        controls: [
          { type: 'displaypicker' },
          { type: 'floatingtoggle' },
          { type: 'slider', path: 'floating.opacity', label: 'Yüzen Pencere Saydamlığı', min: 0.2, max: 1, step: 0.01, percent: true },
          { type: 'toggle', path: 'floating.aspectLock', label: 'En-Boy Kilidi (16:9)' },
          { type: 'toggle', path: 'floating.locked', label: 'Konumu Kilitle' },
          { type: 'toggle', path: 'floating.clickThrough', label: 'Tıklamayı Alt Pencereye Geçir' },
          { type: 'floatingtools' },
        ],
      },
      {
        id: 'power',
        category: 'output',
        icon: 'bolt',
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
            text: 'Ekranla Eşitle varsayılandır: kare hızı ekranınızdan otomatik gelir, elle ayarlamak gerekmez. Yenileme hızınızın tam böleni olmayan bir sınır (75 Hz ekranda 60 gibi) kare aralıklarını eşitsiz yapar. Panel önizlemesi ayrıca 45 FPS ile sınırlıdır; akıcılığı görselleştirici penceresinden değerlendirin.',
          },
          {
            // Bulunan hız ayrı not: sözlükte kalıp olarak çevrilir
            type: 'note',
            text: () => refreshNote(),
            show: () => refreshRates().length > 0,
          },
          { type: 'slider', path: 'power.renderScale', label: 'Arkaplan Çözünürlüğü', min: 0.4, max: 1, step: 0.05, percent: true , noExtend: true },
          { type: 'toggle', path: 'power.pauseOnSilence', label: 'Sessizlikte Duraklat', group: 'Davranış', advanced: true },
          { type: 'toggle', path: 'power.hideCursor', label: 'İmleci Gizle', group: 'Davranış', advanced: true },
        ],
      },
      {
        id: 'scenes',
        category: 'library',
        icon: 'clapper',
        title: 'Sahneler',
        desc: 'Arkaplan + görselleştirici + logo + görsel nesneleri tek isim altında saklayın.',
        controls: [{ type: 'scenes' }],
      },
      {
        id: 'backup',
        category: 'library',
        icon: 'save',
        title: 'Ayarları Yedekle / Geri Yükle',
        desc: 'Renk şablonları hariç tüm uygulama ayarlarını tek JSON dosyasında taşıyın.',
        controls: [{ type: 'settingsio' }],
      },
      {
        /* Uygulama: Dil / Pencere / Panel. Güncellemeler ayrı tam genişlik
           kartta (settings-updates). Footer indirme modalı kaldırıldı. */
        id: 'settings-main',
        category: 'settings',
        wide: true,
        icon: 'gear',
        title: 'Uygulama',
        desc: '',
        roots: ['power.alwaysOnTop', 'power.protect', 'power.protectNoEscape', 'power.confirmClose'],
        controls: [
          { type: 'language', group: 'Dil' },
          {
            type: 'toggle', path: 'power.alwaysOnTop', label: 'Görselleştirmeyi Her Zaman Üstte Tut',
            group: 'Pencere',
            hint: 'Başka bir uygulama öne çıksa bile görselleştirme ekranı üstte kalır.',
          },
          {
            type: 'toggle', path: 'power.protect', label: 'Kaza Koruması', rebuild: true,
            group: 'Pencere',
            hint: 'Görselleştirme penceresi beklenmedik biçimde kapanırsa (çökme, Alt+F4) anında geri açılır. Panelden ya da ESC ile kapatmak her zaman çalışır.',
          },
          {
            type: 'toggle', path: 'power.protectNoEscape', label: 'ESC ile Kapatmayı Devre Dışı Bırak',
            group: 'Pencere',
            show: () => !!(cfg.power && cfg.power.protect),
            hint: 'Yalnızca Kaza Koruması açıkken çalışır. Bu haldeyken görselleştirme ancak paneldeki “Kapat” düğmesiyle ya da pencere odaktayken Ctrl+Shift+Q (veya Ctrl+Alt+Shift+Q) ile kapanır.',
          },
          {
            type: 'toggle', path: 'power.confirmClose', label: 'Yanlışlıkla Kapatmayı Önle',
            group: 'Pencere',
            hint: 'Görselleştirici açıkken uygulamanın yanlışlıkla kapatılmasını engeller; çıkışta onay ister.',
          },
          { type: 'extendedrange', group: 'Panel' },
        ],
      },
      {
        id: 'settings-updates',
        category: 'settings',
        wide: true,
        icon: 'download',
        title: 'Güncellemeler',
        desc: 'Yeni sürümleri denetle ve kurulum türüne göre nasıl güncelleneceğini gör.',
        roots: ['updates.mode'],
        controls: [
          {
            type: 'select', path: 'updates.mode', label: 'Güncellemeleri Denetle',
            options: [
              { value: 'notify', label: 'Açık — yeni sürümü haber ver' },
              { value: 'auto', label: 'Otomatik — indir ve kapanırken kur' },
              { value: 'off', label: 'Kapalı' },
            ],
          },
          { type: 'updatespanel' },
        ],
      },
      {
        id: 'export',
        category: 'output',
        icon: 'film',
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
                    { value: 'gpu', label: 'GPU — NVIDIA NVENC (çok hızlı)' },
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
              { value: 'fast', label: 'Hızlı (en hızlı dışa aktarım)' },
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
  /* Bir bölümün dokunduğu yapılandırma yolları.

     Bildirimsel kontroller yollarını kendileri taşıyor. Özel paneller
     (modülasyon, geçiş, haritalama, MilkDrop, kayıt, şablon, metin, 3B
     geometri, derin çözümleme, gruplar) kontrollerini kendi modüllerinde
     kuruyor ve buraya hiçbir yol bildirmiyorlardı; yol olmayınca da başlıkta
     ne değişiklik rozeti ne sıfırlama düğmesi çıkıyordu. Artık her bölüm
     kendi köklerini `roots` ile bildiriyor. */
  /* Kök bir düz nesneyse yaprak yollarına aç: roots: ['lighting'] tek
     birim sayılmasın, her değişen ayar rozette ayrı sayılsın. Dizi ve
     boş/harita nesneleri yaprak kalır. rootOmit ile kartta olmayan alanlar
     (WDL anahtarı, aygıt boyası) Genel Işık sayımından düşülür. */
  function expandRoot(rootPath) {
    const def = defaultAt(rootPath);
    if (def === undefined) return [];
    if (def === null || typeof def !== 'object') return [rootPath];
    if (Array.isArray(def)) return [rootPath];
    const keys = Object.keys(def);
    if (!keys.length) return [rootPath];
    const out = [];
    keys.forEach((k) => {
      const child = rootPath + '.' + k;
      const v = def[k];
      if (v !== null && typeof v === 'object' && !Array.isArray(v) && Object.keys(v).length > 0) {
        expandRoot(child).forEach((p) => out.push(p));
      } else {
        out.push(child);
      }
    });
    return out;
  }

  function sectionPaths(sec) {
    const out = [];
    const omit = new Set(sec.rootOmit || []);
    const add = (p) => {
      if (!p || omit.has(p) || out.indexOf(p) >= 0) return;
      if (defaultAt(p) === undefined) return;
      out.push(p);
    };
    (sec.controls || []).forEach((c) => {
      if (c.path) add(c.path);
    });
    (sec.roots || []).forEach((r) => {
      expandRoot(r).forEach(add);
    });
    return out;
  }

  function sectionShowsResetChrome(sec) {
    /* hideCardReset: TEMP gate for Ready Templates card chrome. */
    return !(sec && sec.hideCardReset);
  }

  function countModified(paths) {
    return paths.filter(isModified).length;
  }

  function categoryModifiedCount(catId) {
    let n = 0;
    sectionSchema().forEach((sec) => {
      if (sec.category !== catId) return;
      if (sec.show && !sec.show()) return;
      if (!sectionShowsResetChrome(sec)) return;
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
    rail.appendChild(el('div', { class: 'nav-group-label', text: tr('Kategoriler') }));
    CATEGORIES.forEach((cat) => {
      const n = categoryModifiedCount(cat.id);
      const item = el(
        'button',
        {
          class: 'nav-item' + (cat.id === activeCategory ? ' active' : ''),
          type: 'button',
          // Otomasyon kartı/kategoriyi sıraya göre değil kimliğe göre bulsun
          'data-cat': cat.id,
          title: tr(cat.desc),
          onclick: () => setCategory(cat.id),
        },
        [
          el('span', { class: 'nav-ico', icon: cat.icon }),
          el('span', { class: 'nav-label', text: tr(cat.title) }),
          n > 0 ? el('span', { class: 'nav-badge', text: String(n), title: tr('Varsayılandan farklı ayar sayısı') }) : null,
        ]
      );
      rail.appendChild(item);
    });
    rail.appendChild(el('div', { class: 'nav-spacer' }));
    rail.appendChild(
      el('div', { class: 'nav-foot', text: tr('Kırmızı nokta ve rakamlar, varsayılandan farklı ayarları gösterir.') })
    );
  }

  function setCategory(id) {
    if (activeCategory === id) return;
    saveCategoryScroll(activeCategory);
    activeCategory = id;
    localStorage.setItem('sv-category', id);
    pendingCategoryScrollId = id;
    render();
  }

  // --------------------------------------------------------------------------
  // Render — yalnızca seçili kategorinin kartları
  // --------------------------------------------------------------------------
  /* Per-category #sections scroll while Admin is open (not persisted to disk). */
  const categoryScrollById = new Map();
  let pendingCategoryScrollId = null;

  /* Odak, silinecek bir kontrolün üstündeyken tarayıcı kaydırmayı başa
     alır ve bir sonraki karede eski yerine döner. Kullanıcı o gidiş-gelişi
     görür. Odak, çocuklar silinmeden kaydırıcıda kalır. */
  function holdSectionsFocus(root) {
    const ae = document.activeElement;
    if (!ae || ae === root || !root.contains(ae)) return;
    try { root.focus({ preventScroll: true }); } catch (e) { /* odak verilemez */ }
  }

  let sectionsScrollWant = 0;
  /* Son etkileşilen kutu. Kullanıcı başka yere kaydırınca görüşün
     dışındaysa artık onu değil, ekranda duran kartı izleriz. */
  let pinnedNode = null;

  function nudgeScroll(root, el, beforeTop) {
    if (!root || beforeTop == null || !el || !el.getBoundingClientRect) return;
    const d = el.getBoundingClientRect().top - beforeTop;
    if (d > 0.5 || d < -0.5) root.scrollTop += d;
  }

  function inScrollerView(root, el) {
    if (!root.getBoundingClientRect || !el.getBoundingClientRect) return true;
    const view = root.getBoundingClientRect();
    const r = el.getBoundingClientRect();
    return r.bottom > view.top + 1 && r.top < view.bottom - 1;
  }

  function topVisibleNode(root) {
    if (!root.querySelectorAll || !root.getBoundingClientRect) return null;
    const view = root.getBoundingClientRect();
    const nodes = root.querySelectorAll('.card, .layer');
    let best = null;
    let bestTop = Infinity;
    for (let i = 0; i < nodes.length; i++) {
      const n = nodes[i];
      if (!n.getBoundingClientRect) continue;
      const r = n.getBoundingClientRect();
      if (r.bottom <= view.top + 1 || r.top >= view.bottom - 1) continue;
      if (r.top < bestTop) { bestTop = r.top; best = n; }
    }
    return best;
  }

  /* Son dokunulan öğe (fare ya da klavye). Odak her zaman ona geçmiyor:
     anahtar etiketi, segment düğmesi veya bir sekme tıklanınca
     document.activeElement panelin dışında kalabiliyor. Yeniden çizimde
     tıklanan kutuyu yerinde tutan bilgi buradan gelir (#695). */
  let lastTouch = null;
  function noteTouch(e) { lastTouch = e && e.target; }

  /* Kullanıcının o an etkileştiği kutu: önce odak, yoksa son dokunuş.
     inView: görüşün dışında kalan kutu izlenmez (kayma düzeltmesi için).
     Yeniden çizimde görüş dışındaki kutu da tutulabilir; ekranla arası
     aynı kalır. */
  function touchedBox(root, inView) {
    if (!root || !root.contains) return null;
    const ok = (box) => box && (!inView || inScrollerView(root, box));
    const ae = document.activeElement;
    if (ae && ae !== root && root.contains(ae)) {
      const box = anchorBoxOf(ae);
      if (ok(box)) return box;
    }
    if (lastTouch && lastTouch.isConnected !== false && root.contains(lastTouch)) {
      const box = anchorBoxOf(lastTouch);
      if (ok(box)) return box;
    }
    return null;
  }

  /* Etkileşim yoksa (arka plandan gelen yeniden çizim) ekranın üstünde
     tamamen görünen ilk kutu tutulur; sayfa olduğu yerde kalır. */
  function topVisibleBox(root) {
    if (!root.querySelectorAll || !root.getBoundingClientRect) return null;
    const view = root.getBoundingClientRect();
    const nodes = root.querySelectorAll('.ctrl, .layer-tab, .fold-head, .layer-name');
    for (let i = 0; i < nodes.length; i++) {
      const r = nodes[i].getBoundingClientRect();
      if (r.height > 0 && r.top >= view.top && r.top < view.bottom - 1) return nodes[i];
    }
    return null;
  }

  /* İzlenen kutu: odaktaki ya da son dokunulan kontrol, yoksa az önceki
     etkileşim, o da görüşten çıktıysa ekranın üstünde duran kart. */
  function pinElement(root) {
    if (!root) return null;
    const touched = touchedBox(root, true);
    if (touched) return touched;
    if (pinnedNode && pinnedNode.isConnected !== false && root.contains && root.contains(pinnedNode)
      && inScrollerView(root, pinnedNode)) return pinnedNode;
    return topVisibleNode(root);
  }

  /* Sıfırlama düğmesi gizlenince tarayıcı odaklı öğeyi kaybedip
     kaydırmayı başa alır. Odak önce kutunun içindeki alana verilir. */
  function parkResetFocus(root) {
    const ae = document.activeElement;
    if (!ae || !ae.classList || !ae.classList.contains('ctrl-reset') || !root.contains(ae)) return;
    const ctrl = ae.closest ? ae.closest('.ctrl') : null;
    const stay = ctrl && ctrl.querySelector ? ctrl.querySelector('input, select, textarea') : null;
    try { (stay || root).focus({ preventScroll: true }); } catch (e) { /* odak verilemez */ }
  }

  function applySectionsScroll(root, prevScroll) {
    if (!root || !root.isConnected) return;
    const want = prevScroll == null ? sectionsScrollWant : prevScroll;
    const max = Math.max(0, root.scrollHeight - root.clientHeight);
    const next = Math.min(want, max);
    if (root.scrollTop !== next) root.scrollTop = next;
  }

  function saveCategoryScroll(catId) {
    const root = $('sections');
    if (!root || !catId) return;
    categoryScrollById.set(catId, root.scrollTop);
  }

  /* Etiket metninin kendisi. Sıfırlama düğmesi etiketin içinde; onun
     metni eşleşmeyi kaçırıp katman başlığına zıplatıyordu. */
  function boxLabel(node) {
    if (!node) return '';
    const lbl = (node.classList && node.classList.contains('ctrl') && node.querySelector)
      ? node.querySelector('.lbl') : null;
    const src = lbl || node;
    let text = '';
    const kids = src.childNodes ? [...src.childNodes] : [];
    for (const n of kids) {
      if (n.nodeType === 3) text += n.nodeValue || '';
    }
    if (!text.trim() && src.querySelector) {
      const spans = src.querySelectorAll ? src.querySelectorAll('span') : [];
      for (const s of spans) {
        if (s.classList && s.classList.contains('fold-caret')) continue;
        if (s.textContent) { text = s.textContent; break; }
      }
    }
    if (!text.trim() && src.textContent) text = src.textContent;
    return text.replace(/\s+/g, ' ').trim().slice(0, 80);
  }

  function anchorBoxOf(el) {
    if (!el || !el.closest) return null;
    return el.closest('.ctrl, .layer-tab, .fold-head, .layer-name');
  }

  function layerOf(el) {
    return (el && el.closest) ? el.closest('.layer') : null;
  }

  function tabKeyOf(node) {
    if (!node || !node.classList) return '';
    if (node.classList.contains('layer-tab')) return node.getAttribute('data-k') || '';
    const pane = node.closest ? node.closest('.layer-pane') : null;
    if (!pane || !pane.parentElement || !pane.parentElement.querySelector) return '';
    const active = pane.parentElement.querySelector('.layer-tab.active');
    return active ? (active.getAttribute('data-k') || '') : '';
  }

  function foldKeyOf(node) {
    if (!node || !node.classList) return '';
    const fold = node.classList.contains('fold-head')
      ? node.parentElement
      : (node.closest ? node.closest('.fold') : null);
    if (!fold || !fold.querySelector) return '';
    const head = fold.querySelector('.fold-head') || node;
    const stable = head.getAttribute && (head.getAttribute('data-anchor') || head.getAttribute('data-path'));
    return stable || boxLabel(head);
  }

  function anchorIdentity(box) {
    const kind = box.classList.contains('layer-tab') ? 'tab'
      : box.classList.contains('fold-head') ? 'fold'
      : box.classList.contains('layer-name') ? 'name' : 'ctrl';
    /* Görünen yazı çeviriden sonra değişir. Eşleşme yol ya da kaynak
       etiketindedir; yoksa ekrandaki metne düşülür. */
    const stable = box.getAttribute && (box.getAttribute('data-path') || box.getAttribute('data-anchor'));
    const label = stable || boxLabel(box);
    return {
      kind,
      label,
      tabKey: tabKeyOf(box),
      fold: kind === 'fold' ? label : foldKeyOf(box),
    };
  }

  function sameIdentity(a, b) {
    return a.kind === b.kind && a.label === b.label && a.tabKey === b.tabKey && a.fold === b.fold;
  }

  /* Etkileşilen kutunun ekrandaki yeri. Kaydırıcı veya seçim kutusu
     etiketin altında; etikete hizalamak her tıklamada sayfayı kaydırıyordu.
     Aynı yazı birden fazla kutuda geçebiliyor (gövde ve sekme). Sekme,
     katlanır başlık ve sıra onları ayırır. */
  function sectionAnchor(root) {
    if (!root) return null;
    const box = touchedBox(root) || topVisibleBox(root);
    if (!box || !box.classList || !box.getBoundingClientRect) return null;
    const id = anchorIdentity(box);
    if (!id.label) return null;
    const layer = layerOf(box);
    const nameEl = layer && layer.querySelector ? layer.querySelector('.layer-name b') : null;
    const layerId = layer && layer.getAttribute ? (layer.getAttribute('data-id') || '') : '';
    const host = layer || root;
    const boxes = host.querySelectorAll ? [...host.querySelectorAll('.ctrl, .layer-tab, .fold-head, .layer-name')] : [];
    let nth = 0;
    for (const n of boxes) {
      if (n === box) break;
      if (n.classList && sameIdentity(anchorIdentity(n), id)) nth++;
    }
    return {
      layerId,
      layer: nameEl && nameEl.textContent ? nameEl.textContent : '',
      kind: id.kind,
      label: id.label,
      tabKey: id.tabKey,
      fold: id.fold,
      nth,
      top: box.getBoundingClientRect().top,
    };
  }

  function findAnchorNode(root, anchor) {
    if (!anchor || !anchor.label || !root.querySelectorAll) return null;
    let host = root;
    if (anchor.layerId) {
      host = null;
      const layers = root.querySelectorAll('.layer');
      for (let i = 0; i < layers.length; i++) {
        const n = layers[i];
        if (n.getAttribute && n.getAttribute('data-id') === anchor.layerId) { host = n; break; }
      }
      if (!host) return null;
    } else if (anchor.layer) {
      host = null;
      for (const n of root.querySelectorAll('.layer')) {
        const b = n.querySelector && n.querySelector('.layer-name b');
        if (b && b.textContent === anchor.layer) { host = n; break; }
      }
      if (!host) return null;
    }
    const boxes = [...host.querySelectorAll('.ctrl, .layer-tab, .fold-head, .layer-name')];
    const hits = [];
    for (const n of boxes) {
      if (!n.classList) continue;
      const id = anchorIdentity(n);
      if (sameIdentity(id, anchor)) hits.push(n);
    }
    if (hits.length) return hits[Math.min(anchor.nth || 0, hits.length - 1)];
    if (anchor.tabKey) {
      for (const n of host.querySelectorAll('.layer-tab')) {
        if (n.getAttribute && n.getAttribute('data-k') === anchor.tabKey) return n;
      }
    }
    if (anchor.fold) {
      for (const n of host.querySelectorAll('.fold-head')) {
        if (boxLabel(n) === anchor.fold) return n;
      }
    }
    if (anchor.layer && host.querySelector) return host.querySelector('.layer-name');
    return null;
  }

  /* Tek hedef. Önce eski pikseli yazıp sonra kutuyu aramak, aradaki
     konumu bir kare gösteriyordu. */
  function anchoredScroll(root, anchor, prevScroll) {
    const max = Math.max(0, root.scrollHeight - root.clientHeight);
    const found = anchor ? findAnchorNode(root, anchor) : null;
    if (!found || !found.getBoundingClientRect) return Math.min(Math.max(0, prevScroll || 0), max);
    const next = root.scrollTop + (found.getBoundingClientRect().top - anchor.top);
    return Math.min(Math.max(0, next), max);
  }

  /* Açık alt sekmenin kendi kaydırması. Sayfa yeniden kurulunca sıfırlanırsa
     kontrol yukarı ışınlanır. Katman kimliği, aynı adlı ikinci katmanı ayırır. */
  function captureLayerPaneScroll(root) {
    const map = new Map();
    if (!root || !root.querySelectorAll) return map;
    const panes = root.querySelectorAll('.layer-pane.open');
    for (let i = 0; i < panes.length; i++) {
      const pane = panes[i];
      const layer = pane.closest ? pane.closest('.layer') : null;
      const id = layer && layer.getAttribute ? layer.getAttribute('data-id') : '';
      if (id) map.set(id, pane.scrollTop || 0);
    }
    return map;
  }

  function restoreLayerPaneScroll(root, map) {
    if (!root || !map || !map.size || !root.querySelectorAll) return;
    const panes = root.querySelectorAll('.layer-pane.open');
    for (let i = 0; i < panes.length; i++) {
      const pane = panes[i];
      const layer = pane.closest ? pane.closest('.layer') : null;
      const id = layer && layer.getAttribute ? layer.getAttribute('data-id') : '';
      if (!id || !map.has(id)) continue;
      const max = Math.max(0, (pane.scrollHeight || 0) - (pane.clientHeight || 0));
      const next = Math.min(map.get(id), max);
      if (pane.scrollTop !== next) pane.scrollTop = next;
    }
  }

  /* Arka plandan gelen yeniden çizim (MCP, preset değişikliği, söz
     kitaplığı, ışık aygıtları, uzaktan kumanda).

     Bunlar doğrudan render() çağırıyordu: kullanıcı bir kaydırıcıyı
     sürüklerken bile bütün kategori baştan kuruluyor, kaydırıcı imlecin
     altından sökülüyordu. Şimdi:
       - yalnız ilgili kategori açıksa çizilir (cats verilmişse); başka
         kategoriye geçince zaten baştan çizilir,
       - aynı karedeki istekler tek çizime iner,
       - fare paneldeyken basılıysa bırakılana kadar beklenir. */
  /* Preset listesini gösteren kategoriler: MilkDrop ve özel mod seçici
     (Sahne), Studio, Kitaplık, Clip Deck ve Otomatik VJ (Kontrol). */
  const PRESET_CATS = ['scene', 'studio', 'library', 'control'];
  const MCP_PRESET_POLL_MS = 3000;
  let renderWanted = false;
  let renderRaf = 0;
  let pointerHeld = false;
  /* Açılır liste ya da renk seçici açılınca pointerup sayfaya hiç
     gelmeyebilir; basılı bayrağı takılı kalırsa arka plan çizimleri bir
     sonraki tıklamaya kadar bekler. change/focusout da bırakır, en geç
     HOLD_MAX_MS sonra bayrak kendiliğinden düşer. */
  const HOLD_MAX_MS = 8000;
  let holdTimer = 0;
  function holdPointer() {
    pointerHeld = true;
    if (holdTimer) clearTimeout(holdTimer);
    holdTimer = setTimeout(releasePointer, HOLD_MAX_MS);
  }
  function scheduleRender(cats) {
    if (Array.isArray(cats) && cats.indexOf(activeCategory) < 0) return;
    renderWanted = true;
    if (pointerHeld || renderRaf) return;
    renderRaf = requestAnimationFrame(() => {
      renderRaf = 0;
      if (!renderWanted || pointerHeld) return;
      renderWanted = false;
      render();
      /* Paneller çizerken cfg'yi tamamlayabiliyor (katman listesi gibi);
         önizleme son hâli görsün. */
      if (window.SVPreview) window.SVPreview.setConfig(cfg);
    });
  }
  function releasePointer() {
    if (holdTimer) { clearTimeout(holdTimer); holdTimer = 0; }
    if (!pointerHeld) return;
    pointerHeld = false;
    if (renderWanted) scheduleRender();
  }

  function render() {
    renderWanted = false;
    const root = $('sections');
    const paneScroll = captureLayerPaneScroll(root);
    /* Kategori değişirken eski sayfanın kutusu yeni sayfada aranmaz: aynı
       adlı bir kontrol başka kategoride de olabilir. Orada kayıtlı konum
       geçerli. */
    const switching = pendingCategoryScrollId === activeCategory;
    const anchor = switching ? null : sectionAnchor(root);
    let prevScroll;
    if (switching) {
      prevScroll = categoryScrollById.has(activeCategory)
        ? categoryScrollById.get(activeCategory)
        : 0;
      pendingCategoryScrollId = null;
    } else {
      prevScroll = root.scrollTop;
    }
    holdSectionsFocus(root);
    if (window.SVPreview) window.SVPreview.setConfig(cfg);
    root.innerHTML = '';

    const cat = CATEGORIES.find((c) => c.id === activeCategory) || CATEGORIES[0];
    $('catTitle').textContent = tr(cat.title);
    $('catDesc').textContent = tr(cat.desc);

    const sections = sectionSchema().filter((s) => s.category === cat.id && (!s.show || s.show()));
    root.classList.toggle('single', sections.length === 1 || sections.every((s) => s.wide));

    // Sıfırlanacak bir şey yoksa (ör. Kitaplık) düğme boşuna durmasın
    const resettable = sections.some((s) => sectionShowsResetChrome(s) && countModified(sectionPaths(s)) > 0);
    $('catResetBtn').classList.toggle('hidden', !resettable);

    sections.forEach((sec) => {
      const card = buildCard(sec);
      if (card) root.appendChild(card);
    });

    renderNav();
    /* Konum bu görevde, boy ölçülüp ızgara oturduktan sonra yazılır.
       Sonraki karede ikinci bir atama, kullanıcının gördüğü gidiş-gelişti. */
    sectionsScrollWant = prevScroll;
    layoutCards(root);
    restoreLayerPaneScroll(root, paneScroll);
    void root.offsetHeight;
    const widthBeforeScroll = root.clientWidth;
    applySectionsScroll(root, anchoredScroll(root, anchor, prevScroll));
    if (root.clientWidth !== widthBeforeScroll) {
      layoutCards(root, root._svCards);
      applySectionsScroll(root, anchoredScroll(root, anchor, prevScroll));
    }
    sectionsScrollWant = root.scrollTop;
    pinnedNode = anchor ? findAnchorNode(root, anchor) : null;
  }

  /* KART DÜZENİ (#622, #695).

     İlk düzen kartları satır satır diziyordu; kısa kartın altında büyük
     boşluk kalıyordu. #622 bunu 4 px satırlı bir masonry ızgarasıyla
     çözdü, ama o ızgarada kartın yeri boyundan hesaplanıyordu: bir kart
     açılıp kapanınca sonraki kartlar başka sütuna geçiyordu (bir katlanır
     başlık, öbür sütundaki kartı 916 px oynatıyordu). Küçülme bir sonraki
     tam çizime kadar uygulanmadığı için boşluk birden kapanıyordu.

     Şimdi kartlar sütunlara yerleştirilir ve sütunda kalır:
       - geniş kart kendi satırıdır;
       - aradaki yarım kartlar bir şerittir. Şeritte sütun sayısı pencereye
         göre hesaplanır, kart sayısından fazla olmaz (tek kart tam
         genişlik, iki kart yarım yarım);
       - kart sıraya göre o an en kısa sütuna konur ve bu sütun kategori
         ve sütun sayısı aynı kaldıkça hatırlanır. Kart büyüyüp küçülünce
         yalnız aynı sütunda altındaki kartlar kayar.
     Sütun sayısı değişince (pencere boyu) düzen yeniden kurulur. */
  const MIN_COL = 330; // px — eski ızgaranın minmax(330px, 1fr) değeri
  const COL_GAP = 14; // px — admin.css .sections / .sec-band gap
  const columnPlans = new Map(); // "kategori|sütun" -> Map(kart -> sütun)
  let sectionsRO = null;
  let sectionsCols = 0;

  function columnCount(root) {
    if (root.classList.contains('single')) return 1;
    const cs = getComputedStyle(root);
    const avail = root.clientWidth - (parseFloat(cs.paddingLeft) || 0) - (parseFloat(cs.paddingRight) || 0);
    return Math.max(1, Math.floor((avail + COL_GAP) / (MIN_COL + COL_GAP)));
  }

  function buildBand(cards, n, plan) {
    const cols = Math.max(1, Math.min(n, cards.length));
    const band = el('div', { class: 'sec-band' });
    band.style.setProperty('--cols', String(cols));
    const colEls = [];
    for (let i = 0; i < cols; i++) {
      const c = el('div', { class: 'sec-col' });
      colEls.push(c);
      band.appendChild(c);
    }
    return { band, colEls, cols, cards, plan };
  }

  /* Şerit sayfadayken doldurulur: en kısa sütun ölçülerek bulunur. */
  function fillBand(b) {
    for (const card of b.cards) {
      const id = card.getAttribute('data-card') || '';
      let col = b.plan.has(id) ? b.plan.get(id) : -1;
      if (!(col >= 0 && col < b.cols)) {
        col = 0;
        let best = Infinity;
        for (let i = 0; i < b.cols; i++) {
          const h = b.colEls[i].offsetHeight;
          if (h < best - 0.5) { best = h; col = i; }
        }
        b.plan.set(id, col);
      }
      b.colEls[col].appendChild(card);
    }
  }

  function layoutCards(root, given) {
    const cards = given || [...root.children].filter((c) => c.classList && c.classList.contains('card'));
    root._svCards = cards;
    const n = columnCount(root);
    sectionsCols = n;
    const key = activeCategory + '|' + n;
    if (!columnPlans.has(key)) columnPlans.set(key, new Map());
    const plan = columnPlans.get(key);
    root.textContent = '';
    const bands = [];
    let run = [];
    const flush = () => {
      if (!run.length) return;
      const b = buildBand(run, n, plan);
      root.appendChild(b.band);
      bands.push(b);
      run = [];
    };
    for (const c of cards) {
      if (n === 1 || c.classList.contains('wide')) { flush(); root.appendChild(c); }
      else run.push(c);
    }
    flush();
    bands.forEach(fillBand);
    watchSectionsWidth(root);
  }

  /* Sütun sayısı değişince aynı kart düğümleriyle düzeni yeniden kur.
     Ekranda duran kutu yerinde kalır. */
  function watchSectionsWidth(root) {
    if (sectionsRO || !window.ResizeObserver) return;
    sectionsRO = new ResizeObserver(() => {
      if (!root.isConnected || !root._svCards) return;
      if (columnCount(root) === sectionsCols) return;
      const pin = pinElement(root);
      const before = pin && pin.getBoundingClientRect ? pin.getBoundingClientRect().top : null;
      layoutCards(root, root._svCards);
      if (pin && pin.isConnected) nudgeScroll(root, pin, before);
    });
    sectionsRO.observe(root);
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

    const modCount = sectionShowsResetChrome(sec) ? countModified(sectionPaths(sec)) : 0;
    const head = el('div', { class: 'card-head' }, [
      el('span', { class: 'ico', icon: sec.icon }),
      el('div', { class: 'ch-main' }, [
        el('h3', { text: tr(sec.title) }),
        sec.desc ? el('div', { class: 'desc', text: tr(sec.desc) }) : null,
      ]),
      el('div', { class: 'ch-actions' }, [
        modCount > 0
          ? el('span', { class: 'chip-mod', text: String(modCount), title: tr('Varsayılandan farklı ayar sayısı') })
          : null,
        modCount > 0
          ? el('button', {
              class: 'icon-btn small',
              type: 'button',
              icon: 'reset',
              title: tr('Bu bölümü varsayılana döndür'),
              onclick: () => resetSection(sec),
            })
          : null,
      ]),
    ]);

    const card = el('div', { class: 'card' + (sec.wide ? ' wide' : ''), 'data-card': sec.id }, [head]);
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
              '<span class="caret"></span><span>Gelişmiş ayarlar</span>' +
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
      if (def.label) c.setAttribute('data-anchor', String(def.label).slice(0, 80));
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
              icon: 'reset',
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
    /* Yeniden çizim, sıfırlama düğmesi hâlâ odaktayken konumu okur.
       push önce çalışırsa düğme gizlenir ve kaydırma başa döner. */
    render();
    push(true);
  }

  // "Varsayılandan farklı" göstergelerini yeniden çizmeden tazele.
  // Kaydırıcı sürüklenirken kart yeniden kurulamaz (odak ve sürükleme kopar),
  // bu yüzden yalnızca noktalar ve sayaçlar güncellenir.
  function refreshModifiedMarks() {
    const root = $('sections');
    if (!root) return;
    parkResetFocus(root);
    const pin = pinElement(root);
    const before = pin && pin.getBoundingClientRect ? pin.getBoundingClientRect().top : null;
    root.querySelectorAll('.ctrl[data-path]').forEach((node) => {
      node.classList.toggle('modified', isModified(node.getAttribute('data-path')));
    });
    /* Layer-internal (attachDefault) controls: no config path; get/defVal
       live on _svSyncModified. Path-based refresh does not touch them;
       this keeps per-control reset visibility instant on change. */
    root.querySelectorAll('.ctrl[data-sv-local-def]').forEach((node) => {
      if (typeof node._svSyncModified === 'function') node._svSyncModified();
    });

    const sections = sectionSchema().filter((s) => s.category === activeCategory && (!s.show || s.show()));
    /* Kartlar sütunlarda; belge sırası bölüm sırası değil. Kart kimliğiyle bulunur. */
    const cardOf = {};
    root.querySelectorAll('.card[data-card]').forEach((c) => { cardOf[c.getAttribute('data-card')] = c; });
    sections.forEach((sec) => {
      const card = cardOf[sec.id];
      if (!card) return;
      const n = sectionShowsResetChrome(sec) ? countModified(sectionPaths(sec)) : 0;
      let chip = card.querySelector('.chip-mod');
      const acts = card.querySelector('.ch-actions');
      if (n > 0 && !chip && acts) {
        // Kart sıfırdan değişikliğe geçtiyse rozet ve sıfırlama düğmesi belirir
        acts.appendChild(el('span', { class: 'chip-mod', title: 'Varsayılandan farklı ayar sayısı' }));
        acts.appendChild(
          el('button', {
            class: 'icon-btn small', type: 'button', icon: 'reset',
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
    const resettable = sections.some((s) => sectionShowsResetChrome(s) && countModified(sectionPaths(s)) > 0);
    const catBtn = $('catResetBtn');
    if (catBtn) catBtn.classList.toggle('hidden', !resettable);
    nudgeScroll(root, pin, before);
  }

  function setAdvanced(on) {
    advancedOn = !!on;
    localStorage.setItem('sv-advanced', advancedOn ? '1' : '0');
    const box = $('advToggle');
    if (box) box.checked = advancedOn;
    render();
  }

  async function resetSection(sec) {
    if (sec && sec.hideCardReset) return;
    const paths = sectionPaths(sec);
    if (!paths.length) return;
    const ok = await svConfirm('Bu bölümdeki ayarlar varsayılana dönecek.', { danger: true, okText: 'Bölümü sıfırla' });
    if (!ok) return;
    /* Ready Templates: whole-object SCENE_KEYS restore (not leaf setPath).
       Leaf reset missed array/object identity and left layerStack on, so
       the next syncStackState re-dirtied visualizer.type back to 'none'. */
    if (sec.id === 'templates' && window.SVTemplates && typeof window.SVTemplates.resetScene === 'function') {
      window.SVTemplates.resetScene(cfg, {
        defaultConfig: window.SV.defaultConfig,
        clone: window.SV.clone,
      });
      if (window.SVTemplatePanel && typeof window.SVTemplatePanel.clearLastApplied === 'function') {
        window.SVTemplatePanel.clearLastApplied();
      }
    } else {
      const defaults = window.SV.defaultConfig();
      paths.forEach((p) => {
        const dv = getPath(defaults, p);
        if (dv !== undefined) setPath(cfg, p, window.SV.clone(dv));
      });
    }
    render();
    push(true);
  }

  // --------------------------------------------------------------------------
  // Arama — tüm kategorilerdeki her ayarı tek kutudan bulmak için.
  // Yeni ayarlar şemaya eklendiğinde otomatik olarak aranabilir olur; arayüzün
  // büyüdükçe karmaşıklaşmamasının asıl nedeni budur.
  // --------------------------------------------------------------------------
  function tr(s) {
    return (window.SVI18n && window.SVI18n.t ? window.SVI18n.t(s) : s) || s;
  }

  /* Platform. Tarayıcı bağlamında process yok; preload veriyor.
     Yedek olarak Windows varsayılır: bu dosya yalnız uygulamanın
     içinde koşar ve tarihsel olarak tek platform Windows idi. */
  const PLATFORM = (typeof window !== 'undefined' && window.SV_PLATFORM) ||
    { os: 'win32', isWindows: true, isMac: false, isLinux: false };
  const isWindows = () => !!PLATFORM.isWindows;

  /* Işık modlarının TEK listesi. OpenRGB paneli de bunu kullanır; iki ayrı
     liste olsaydı aynı mod iki kartta iki farklı adla görünürdü. */
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

  function buildSearchIndex() {
    const out = [];
    sectionSchema().forEach((sec) => {
      const cat = CATEGORIES.find((c) => c.id === sec.category);
      if (!cat) return;
      /* Gizli bölüm aranabilir OLMAMALI: bulunup tıklanınca hiçbir yere
         gitmeyen bir sonuç, hiç çıkmamasından kötüdür. */
      if (sec.show && !sec.show()) return;
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
      box.appendChild(el('div', { class: 'sr-empty', text: tr('Eşleşen ayar bulunamadı.') }));
      return;
    }
    items.forEach((e, i) => {
      box.appendChild(
        el('button', { class: 'sr-item' + (i === 0 ? ' active' : ''), type: 'button', onclick: () => jumpTo(e) }, [
          el('span', { class: 'sr-ico', icon: e.icon }),
          el('span', { class: 'sr-main' }, [
            el('div', { class: 'sr-label', text: tr(e.label) }),
            el('div', { class: 'sr-path', text: tr(e.categoryTitle) + ' › ' + tr(e.section) }),
          ]),
          e.advanced ? el('span', { class: 'sr-tag', text: tr('Gelişmiş') }) : null,
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
    if (entry.category !== activeCategory) {
      saveCategoryScroll(activeCategory);
      pendingCategoryScrollId = entry.category;
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
      .filter((s) => s.category === catId && (!s.show || s.show()))
      .forEach((sec) => {
        if (!sectionShowsResetChrome(sec)) return;
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
    // Artık bağlı olmayan ekranları ayıkla. Boş liste boş kalır:
    // kullanıcı bütün kutuları kaldırdığında bir ekran geri seçilmez.
    selectedDisplayIds = selectedDisplayIds.filter((id) => displays.some((d) => d.id === id));
    cfg.display.ids = selectedDisplayIds.slice();
    cfg.display.id = selectedDisplayIds[0] != null ? selectedDisplayIds[0] : null;
    /* Kimlik kalıcı değil; ekranın izi kimlik değişince onu yeniden bulur. */
    if (window.SVDisplayMatch) cfg.display.prints = window.SVDisplayMatch.prints(selectedDisplayIds, displays);
  }

  /* Kayıtlı seçimi bağlı ekranlara oturtur (shared/display-match.js).
     Liste kayıttakinden farklı çıktıysa true döner; çağıran kaydetmeli. */
  function adoptDisplaySelection(saved) {
    if (window.SVDisplayMatch) {
      const r = window.SVDisplayMatch.resolve(saved, displays);
      selectedDisplayIds = r.ids.slice();
      return r.changed;
    }
    const ids = saved && Array.isArray(saved.ids) && saved.ids.length
      ? saved.ids
      : (saved && saved.id != null ? [saved.id] : []);
    selectedDisplayIds = ids.map(Number);
    return false;
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
          // Kullanıcının seçimi: bütün kutular kalkarsa boş liste boş kalır
          cfg.display = cfg.display || {};
          cfg.display.chosen = true;
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

    const pipSep = el('div', { class: 'dm-sep' });
    menu.appendChild(pipSep);
    const pipBox = el('input', {
      type: 'checkbox',
      onchange: async (e) => {
        e.stopPropagation();
        const want = !!e.target.checked;
        if (want === floatingOpen) return;
        try {
          const r = await window.api.toggleFloating();
          floatingOpen = !!(r && r.open);
        } catch { floatingOpen = false; }
        updateFloatingToggles();
        render();
      },
    });
    pipBox.checked = !!floatingOpen;
    pipBox.setAttribute('data-sv-floating-toggle', '1');
    /* Menü dış tıklanınca kapanmasın diye mousedown durdur. */
    const pipRow = el('label', { class: 'dm-pip' }, [
      pipBox,
      el('span', { text: 'Yüzen pencere (PiP)' }),
    ]);
    pipRow.addEventListener('click', (e) => e.stopPropagation());
    menu.appendChild(pipRow);

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
      cfg.background = blackoutSaved.bg;
      cfg.visualizer = blackoutSaved.vis;
      cfg.images = blackoutSaved.images;
      cfg.media = blackoutSaved.media;
      cfg.logo = blackoutSaved.logo;
      cfg.text = blackoutSaved.text;
      cfg.layerStack = blackoutSaved.layerStack;
      cfg.layers = blackoutSaved.layers;
      blackoutSaved = null;
    } else {
      blackoutSaved = {
        bg: JSON.parse(JSON.stringify(cfg.background || {})),
        vis: JSON.parse(JSON.stringify(cfg.visualizer || {})),
        images: JSON.parse(JSON.stringify(cfg.images || {})),
        media: JSON.parse(JSON.stringify(cfg.media || {})),
        logo: JSON.parse(JSON.stringify(cfg.logo || {})),
        text: JSON.parse(JSON.stringify(cfg.text || {})),
        layerStack: JSON.parse(JSON.stringify(cfg.layerStack || {})),
        layers: JSON.parse(JSON.stringify(cfg.layers || [])),
      };
      cfg.background = Object.assign({}, cfg.background, { type: 'solid', solidColor: '#000000' });
      cfg.visualizer = Object.assign({}, cfg.visualizer, { type: 'none' });
      if (cfg.images) cfg.images.enabled = false;
      if (cfg.media) cfg.media.enabled = false;
      if (cfg.logo) cfg.logo.enabled = false;
      if (cfg.text) cfg.text.enabled = false;
      if (Array.isArray(cfg.layers)) {
        cfg.layers = cfg.layers.map((l) => Object.assign({}, l, { enabled: false }));
      }
    }
    if (btn) {
      btn.classList.toggle('on', !!blackoutSaved);
      window.SVIcons.set(btn, blackoutSaved ? 'sun' : 'moon', blackoutSaved ? 'Karartmayı Kaldır' : 'Karart');
    }
    push(true);
    render();
  }

  // --------------------------------------------------------------------------
  // Durum
  // --------------------------------------------------------------------------
    function setStatus(open, displayIds, floating) {
    visOpen = open;
    if (typeof floating === 'boolean') floatingOpen = floating;
    const n = Array.isArray(displayIds) ? displayIds.length : open ? 1 : 0;
    $('statusDot').className = 'dot ' + (open ? 'on' : 'off');
    $('statusText').textContent = open ? (n > 1 ? n + ' ekranda açık' : 'Açık') : 'Kapalı';
    // Seçim değişmişse açıkken de yeniden uygulanabilsin
    $('openBtn').disabled = false;
    $('closeBtn').disabled = !open;
    window.SVIcons.set($('openBtn'), 'play', open ? 'Ekranları Uygula' : 'Görselleştirmeyi Aç');
    // Görselleştirici açıkken yakalama zaten sürüyor; önizleme kareleri bedava
    syncPreviewSubscription();
    updateFloatingToggles();
  }

  /* audioUiKind tracks how the Ses Seviyesi status was last set:
     idle (waiting / diagnosing), capture (source started or levels flowing),
     devices (enumerate success), err (capture/diagnose failure).
     Capture may already be running before the admin window subscribes to
     audio-source-status, so meters can move while the label still says
     "Ses bekleniyor…". Levels refresh promotes idle/devices -> capture. */
  let audioUiKind = 'idle';
  let audioCaptureDevice = null;
  let audioCaptureFromStatus = false; // true after onAudioSourceStatus started

  function setAudioState(text, cls, icon) {
    const a = $('audioState');
    window.SVIcons.set(a, icon || '', text);
    a.title = text; // kısaltılan uzun aygıt adları için tam metin
    a.className = 'audio-state' + (cls ? ' ' + cls : '');
  }

  /* Mirror loopback-helper resolveDevice + CAPTURE-START naming:
     'default' -> pickDefault device name; apps -> label; else device name.
     Joined with ' + ' so the status matches onAudioSourceStatus started. */
  function pickDefaultDeviceName() {
    const all = audioDevices || [];
    const d =
      all.find((x) => x.loopback && x.isDefault) ||
      all.find((x) => x.loopback) ||
      all.find((x) => x.kind === 'output' && x.isDefault) ||
      all.find((x) => x.kind === 'output') ||
      all.find((x) => x.isDefault) ||
      all[0] ||
      null;
    return d && d.name ? d.name : null;
  }

  function resolveSelectedCaptureLabel() {
    const audio = cfg && cfg.audio;
    const sources = (audio && Array.isArray(audio.sources) && audio.sources.length)
      ? audio.sources
      : (audio && audio.source ? [audio.source] : ['default']);
    const AA = window.SVAppAudio;
    const names = [];
    const seen = new Set();
    for (const s of sources) {
      let name = null;
      if (AA && AA.isAppSource(s)) name = s.label || s.match || null;
      else if (s === 'default') name = pickDefaultDeviceName();
      else if (s != null && s !== '') name = String(s);
      if (!name || seen.has(name)) continue;
      seen.add(name);
      names.push(name);
    }
    return names.length ? names.join(' + ') : null;
  }

  function markAudioCapturing(device) {
    if (device) audioCaptureDevice = device;
    const label = audioCaptureDevice || resolveSelectedCaptureLabel() || 'çıkış';
    audioCaptureDevice = label;
    audioCaptureFromStatus = true;
    audioUiKind = 'capture';
    setAudioState('Yakalanıyor: ' + label, 'ok', 'record');
  }

  /* Promote waiting/device-list status when live meters show signal.
     Resolves the selected Ses Kaynakları label so we do not need a
     re-select (started event) just to learn the device name. */
  function ensureAudioListeningFromLevels(d) {
    if (!d || audioUiKind === 'err') return;
    if (audioCaptureFromStatus && audioUiKind === 'capture') return;
    const signal = Math.max(+d.level || 0, +d.bass || 0, +d.mid || 0, +d.treble || 0);
    if (!(signal > 0.015)) return;
    const label = resolveSelectedCaptureLabel() || audioCaptureDevice;
    if (audioUiKind === 'capture' && audioCaptureDevice && audioCaptureDevice === label) return;
    audioCaptureDevice = label;
    audioUiKind = 'capture';
    if (label) setAudioState('Yakalanıyor: ' + label, 'ok', 'record');
    else setAudioState('Yakalanıyor: ' + (resolveSelectedCaptureLabel() || 'çıkış'), 'ok', 'record');
  }

  /* Ölçek olarak yazılıyor, genişlik değil (bkz. admin.css .meter .bar i,
     #621). Aynı değer yeniden yazılmıyor: stil bildirimi her yazımda
     değişmiş sayılıyor. */
  function setMeter(id, v) {
    const s = 'scaleX(' + Math.min(1, Math.max(0, v || 0)).toFixed(3) + ')';
    const e = $(id);
    if (e && e.style.transform !== s) e.style.transform = s;
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
    /* Platforma gore TR metin: Windows Ses ayarlari Linux'ta yaniltir.
       loopbackAdvice / noDevicesMessage ile ayni yonlendirme. */
    const tr = {
      NODE_NOT_FOUND: 'Node.js bulunamadı. Node.js LTS kurun veya PATH ayarınızı onarın.',
      HELPER_MISSING: 'Ses yardımcı dosyaları kurulumda eksik. Uygulamayı yeniden kurun veya onarın.',
      AUDIFY_MISSING: 'Native ses modülü eksik. Uygulamayı yeniden kurun veya onarın.',
      NATIVE_ABI_MISMATCH: 'Native ses modülü bu Node.js sürümüyle uyumsuz. Node.js LTS ve uygulamayı yeniden kurun.',
      ACCESS_DENIED: PLATFORM.isLinux
        ? 'Ses alt sistemine erişim engellendi. PulseAudio/PipeWire izinlerini kontrol edip uygulamayı yeniden başlatın.'
        : PLATFORM.isMac
          ? 'macOS ses alt sistemine erişimi engelledi. Ses ve Gizlilik ayarlarını kontrol edip uygulamayı yeniden başlatın.'
          : 'Windows ses sistemine erişimi engelledi. Ses gizlilik/güvenlik ayarlarını kontrol edip uygulamayı yeniden başlatın.',
      DEVICE_ENUM_TIMEOUT: PLATFORM.isLinux
        ? 'Ses aygıtı algılama zaman aşımına uğradı. PulseAudio veya PipeWire servisini ve bağlı aygıtları kontrol edin.'
        : PLATFORM.isMac
          ? 'Ses aygıtı algılama zaman aşımına uğradı. macOS Ses ayarlarını ve bağlı aygıtları kontrol edin.'
          : 'Ses aygıtı algılama zaman aşımına uğradı. Windows Ses hizmetini ve bağlı aygıtları kontrol edin.',
      NO_DEVICES: PLATFORM.isLinux
        ? 'Etkin ses aygıtı bulunamadı. PulseAudio veya PipeWire çalışıyor mu ve bir monitor kaynağı görünüyor mu kontrol edin.'
        : PLATFORM.isMac
          ? 'Etkin ses aygıtı bulunamadı. macOS Ses ayarlarını kontrol edin ve aygıtı yeniden bağlayın.'
          : 'Etkin ses aygıtı bulunamadı. Windows Ses ayarlarını kontrol edin ve aygıtı yeniden bağlayın.',
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
      // Keep an active capture label; enumerate success must not hide it.
      if (showSuccess && audioUiKind !== 'capture') {
        audioUiKind = 'devices';
        setAudioState(`${audioDevices.length} ses aygıtı bulundu`, 'ok', 'check');
      } else if (audioUiKind === 'capture' && !audioCaptureFromStatus) {
        // Device list just refreshed — resolve default -> real name for status.
        const label = resolveSelectedCaptureLabel();
        if (label && label !== audioCaptureDevice) {
          audioCaptureDevice = label;
          setAudioState('Yakalanıyor: ' + label, 'ok', 'record');
        }
      }
      $('banner').classList.add('hidden');
      return;
    }
    audioUiKind = 'err';
    setAudioState('Ses aygıtı tanılaması başarısız', 'err', 'warning');
    $('bannerDetail').textContent = diagnosticText(result);
    $('banner').classList.remove('hidden');
  }

  /* BAŞKA KOPYA VE AYAR ÇAKIŞMASI (#564).

     Ana süreç iki şey bildiriyor: aynı ayar klasörünü kullanan diğer kopyalar
     (kayıt defteri) ve settings.json'ın bu kopyanın dışında değiştiği
     (dosya bekçisi). İkisi ayrı bant, çünkü biri bilgi, öteki karar istiyor.

     Kopya satırı parçalı kuruluyor: "kurulu", "açılış" gibi sabit sözcükler
     ayrı düğümde, sürüm ve yol ayrı düğümde — sözlük tam dizeyle eşleştiği
     için birleşik bir metin hiç çevrilmezdi. */
  const COPY_KIND = { installed: 'kurulu', portable: 'taşınabilir', dev: 'geliştirme' };
  const COPY_ROLE = { selftest: 'öz test', screenshots: 'ekran görüntüsü aracı' };
  let copiesDismissed = '';
  let lastInstanceStatus = null;

  function copiesKey(list) {
    return (list || []).map((o) => o.pid + ':' + o.startedAt).sort().join(',');
  }

  function renderInstanceStatus(st) {
    lastInstanceStatus = st || null;
    const others = st && Array.isArray(st.others) ? st.others : [];
    const list = $('copiesList');
    if (list) {
      list.textContent = '';
      for (const o of others) {
        const at = new Date(o.startedAt || Date.now());
        const hhmm = String(at.getHours()).padStart(2, '0') + ':' + String(at.getMinutes()).padStart(2, '0');
        list.appendChild(el('li', null, [
          el('span', { text: COPY_ROLE[o.role] || COPY_KIND[o.kind] || String(o.kind || '') }),
          el('span', { text: ' · ' }),
          el('span', { class: 'copy-ver', text: 'v' + (o.version || '?') }),
          el('span', { text: ' · ' }),
          el('span', { text: 'açılış' }),
          el('span', { class: 'copy-time', text: ' ' + hhmm }),
          o.exe ? el('div', { class: 'copy-path', text: o.exe }) : null,
        ]));
      }
    }
    /* Kapatılan uyarı, kopya kümesi DEĞİŞİNCE geri gelir: yeni açılan bir
       kopya eski bir "kapat" ile gizlenmemeli. */
    const key = copiesKey(others);
    if (!others.length) copiesDismissed = '';
    $('copiesBanner').classList.toggle('hidden', !others.length || key === copiesDismissed);
    const conflict = !!(st && st.conflict);
    $('conflictBanner').classList.toggle('hidden', !conflict);
    if (!conflict) $('conflictError').classList.add('hidden');
  }

  function initInstanceBanners() {
    if (!window.api.instanceStatus) return;
    window.api.onInstanceStatus(renderInstanceStatus);
    window.api.instanceStatus().then(renderInstanceStatus).catch(() => {});
    $('copiesClose').addEventListener('click', () => {
      copiesDismissed = copiesKey(lastInstanceStatus && lastInstanceStatus.others);
      $('copiesBanner').classList.add('hidden');
    });
    const resolve = async (choice) => {
      const buttons = [$('conflictLoadBtn'), $('conflictKeepBtn')];
      buttons.forEach((b) => { b.disabled = true; });
      try {
        const r = await window.api.resolveSettingsConflict(choice);
        $('conflictError').classList.toggle('hidden', !!(r && r.ok));
      } catch {
        $('conflictError').classList.remove('hidden');
      } finally {
        buttons.forEach((b) => { b.disabled = false; });
      }
    };
    $('conflictLoadBtn').addEventListener('click', () => resolve('load'));
    $('conflictKeepBtn').addEventListener('click', () => resolve('keep'));
  }

  /* Uygulama listesi ANLIK: hangi uygulamanın ses oturumu olduğu sürekli
     değişiyor, önbelleğe almak yanıltıcı olurdu. */
  async function refreshAudioApps() {
    if (!window.api || !window.api.listAudioApps) return;
    try {
      audioApps = (await window.api.listAudioApps()) || [];
      if (window.api.appAudioStatus) appAudioStatus = await window.api.appAudioStatus();
    } catch (_) { audioApps = []; }
  }

  actions.toggleFloating = async () => {
    if (!window.api || !window.api.toggleFloating) return;
    try { await window.api.toggleFloating(); } catch { /* köprü yok */ }
  };
  actions.floatingSizeS = () => { if (window.api && window.api.floatingSize) window.api.floatingSize('s'); };
  actions.floatingSizeM = () => { if (window.api && window.api.floatingSize) window.api.floatingSize('m'); };
  actions.floatingSizeL = () => { if (window.api && window.api.floatingSize) window.api.floatingSize('l'); };
  actions.floatingSnapBr = () => { if (window.api && window.api.floatingSnap) window.api.floatingSnap('br'); };
  actions.floatingSnapTr = () => { if (window.api && window.api.floatingSnap) window.api.floatingSnap('tr'); };
  actions.floatingSnapBl = () => { if (window.api && window.api.floatingSnap) window.api.floatingSnap('bl'); };
  actions.floatingSnapTl = () => { if (window.api && window.api.floatingSnap) window.api.floatingSnap('tl'); };

  actions.refreshDevices = async () => {
    // Do not clobber an active capture status while re-enumerating devices
    // (started handler may call refresh when a device name is missing).
    if (audioUiKind !== 'capture') {
      audioUiKind = 'idle';
      setAudioState(window.SVI18n?.locale === 'tr' ? 'Ses aygıtları tanılanıyor…' : 'Diagnosing audio devices…');
    }
    const result = await window.api.diagnoseAudio();
    applyAudioDiagnostic(result, true);
    await refreshAudioApps();
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
      ensureAudioListeningFromLevels(l);
    }, 50);

    const btn = $('previewToggle');
    if (btn) {
      btn.addEventListener('click', () => {
        const next = !window.SVPreview.isPaused();
        window.SVPreview.setPaused(next);
        window.SVIcons.set(btn, next ? 'play' : 'pause', '');
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
    const hasAnalysis = !!document.querySelector('.an-panel');
    window.api.subscribePreview(!paused && (previewWantsLive || visOpen || hasAnalysis));
  }
  window.SVAdmin = window.SVAdmin || {};
  window.SVAdmin.syncPreviewSubscription = syncPreviewSubscription;

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
    const name = tr('Sahne ') + (arr.length + 1);
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
    const def = window.SV.DEFAULT_CONFIG;
    const blacked = isBlackedOut();
    const keepTransparent = !!(cfg.background && cfg.background.transparent);
    const keepKey = cfg.background && cfg.background.transparentKey;
    const keepCover = cfg.background && cfg.background.coverTaskbar;
    SCENE_KEYS.forEach((k) => {
      let val;
      if (sc.data[k] === undefined) {
        val = def[k] !== undefined ? window.SV.clone(def[k]) : undefined;
      } else if (Array.isArray(sc.data[k])) {
        val = sc.data[k].map((item) => window.SV.clone(item));
      } else if (sc.data[k] && typeof sc.data[k] === 'object') {
        val = window.SV.deepMerge(window.SV.clone(def[k] || {}), window.SV.clone(sc.data[k]));
      } else {
        val = sc.data[k];
      }
      if (blacked && blackoutSaved) {
        if (k === 'background') blackoutSaved.bg = val;
        else if (k === 'visualizer') blackoutSaved.vis = val;
        else blackoutSaved[k] = val;
      } else {
        cfg[k] = val;
      }
    });
    if (blacked && blackoutSaved) {
      if (blackoutSaved.images && Array.isArray(blackoutSaved.images.items)) {
        blackoutSaved.images.items = blackoutSaved.images.items.map((it) => window.SV.normalizeImageItem(it));
      }
    } else {
      if (cfg.images && Array.isArray(cfg.images.items)) {
        cfg.images.items = cfg.images.items.map((it) => window.SV.normalizeImageItem(it));
      }
    }
    if (window.SVLayers && window.SVLayers.syncStackState) {
      window.SVLayers.syncStackState(cfg);
    }
    /* Şeffaf arkaplan çıkış ayarıdır; sahne görünümünü değiştirmek onu
       kapatıp pencereyi yeniden kurdurmamalı. */
    if (cfg.background) {
      cfg.background.transparent = keepTransparent;
      if (keepKey != null) cfg.background.transparentKey = keepKey;
      if (keepCover != null) cfg.background.coverTaskbar = !!keepCover;
    }
    sceneActionInFlight = true;
    activeSceneId = id;
    cfg._activeSceneId = id;
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
    cfg._activeSceneId = id;
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
    // Sıralama sürükle-bırak ya da ok tuşlarıyla; sıra kullanıcının
    sortableList(host, ensureScenes, '.scene-item', () => { push(true); renderScenes(); });
    if (!arr.length) {
      host.appendChild(
        el('div', { class: 'scene-empty', text: tr('Kayıtlı sahne yok. “Kaydet” ile mevcut görünümü saklayın.') })
      );
      return;
    }
    arr.forEach((sc) => {
      const thumb = el('div', {
        class: 'scene-thumb',
        title: tr('Bu sahneyi uygula'),
        style: 'background:' + sceneGradient(sc),
        onclick: () => actions.applyScene(sc.id),
      });
      const name = el('input', { class: 'scene-name', type: 'text', value: tr(sc.name || 'Sahne'), title: tr('Sahne adı') });
      name.addEventListener('change', () => actions.renameScene(sc.id, name.value));
      host.appendChild(
        el('div', { class: 'scene-item' + (sc.id === activeSceneId ? ' active' : '') }, [
          dragHandle(tr('Sahneyi taşı')),
          thumb,
          el('div', { class: 'scene-main' }, [name, el('div', { class: 'scene-meta', text: sceneSummary(sc) })]),
          el('div', { class: 'scene-acts' }, [
            el('button', { class: 'icon-btn small', type: 'button', icon: 'refresh', title: tr('Mevcut görünümle güncelle'), onclick: () => actions.updateScene(sc.id) }),
            el('button', { class: 'icon-btn small', type: 'button', icon: 'trash', title: tr('Sil'), onclick: () => actions.deleteScene(sc.id) }),
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
    adoptDisplaySelection(cfg.display);
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
  function setExportStatus(text, cls, icon) {
    exportStatusText = text || '';
    exportStatusCls = cls || '';
    exportStatusIcon = icon || '';
    const s = $('exportStatus');
    if (!s) return;
    window.SVIcons.set(s, exportStatusIcon, exportStatusText);
    s.className = 'export-status' + (exportStatusCls ? ' ' + exportStatusCls : '');
  }

  function setExportUI(active) {
    const run = $('exportRunBtn');
    const cancel = $('exportCancelBtn');
    const bar = $('exportProgressBar');
    const fill = $('exportProgressFill');
    if (run) run.disabled = active;
    if (cancel) cancel.style.display = active ? 'inline-flex' : 'none';
    if (bar) bar.style.display = active ? 'block' : 'none';
    if (!active) exportPct = 0;
    if (fill) fill.style.width = (active ? exportPct : 0) + '%';
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
      setExportStatus((r && r.error) || 'Başlatılamadı', 'err', 'warning');
      return;
    }
    exporting = true;
    setExportUI(true);
    setExportStatus('Hazırlanıyor…');
  };

  async function init() {
    // Durağan HTML'deki ikonlar (üst çubuk, bantlar, dock): ayarları beklemeden
    if (window.SVIcons) window.SVIcons.hydrate(document);
    /* Seçili arayüz dilini ana sürece EN BAŞTA bildir (diyaloglar, ekran
       adları, yayın sayfaları). Ekran listesi bundan önce istenince dil
       değiştikten sonra adlar eski dilde kalıyordu ("Display 1 (Primary)"). */
    try { window.api.setUiLanguage(window.SVI18n.locale); } catch { /* i18n yok */ }
    const saved = await window.api.getSettings();
    if (saved) cfg = window.SV.deepMerge(window.SV.defaultConfig(), saved);
    if (window.SVLayers && window.SVLayers.syncStackState) {
      window.SVLayers.syncStackState(cfg);
    }

    // Eski/eksik görsel nesneleri varsayılan alanlarla tamamla
    if (cfg.images && Array.isArray(cfg.images.items)) {
      cfg.images.items = cfg.images.items.map((it) => window.SV.normalizeImageItem(it));
    }
    if (!Array.isArray(cfg.userPresets)) cfg.userPresets = [];
    if (!Array.isArray(cfg.scenes)) cfg.scenes = [];

    displays = await window.api.getDisplays();
    /* Eski kayıtlar tek kimlik tutuyordu, yeni kimlik kalıcı değil; ikisini
       de eşleştirici çözer. İlk açılışta birincil ekran seçilir. */
    const displayFixed = adoptDisplaySelection(cfg.display);
    const audioDiagnostic = await window.api.diagnoseAudio();
    audioDevices = audioDiagnostic?.devices || [];
    // Prefetch capture label from selected sources so meter promote has a name.
    audioCaptureDevice = resolveSelectedCaptureLabel();
    await refreshAudioApps();
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
    if (!(window.SV_PLATFORM && window.SV_PLATFORM.isWindows)) {
      let platformTouched = false;
      if (cfg.dynamicTheme && cfg.dynamicTheme.enabled) {
        cfg.dynamicTheme.enabled = false;
        platformTouched = true;
      }
      if (cfg.nowplaying) {
        if (cfg.nowplaying.source === 'system') { cfg.nowplaying.source = 'manual'; platformTouched = true; }
        if (cfg.nowplaying.coverSource !== 'manual') { cfg.nowplaying.coverSource = 'manual'; platformTouched = true; }
      }
      if (cfg.logo && cfg.logo.source && cfg.logo.source !== 'manual') {
        cfg.logo.source = 'manual';
        platformTouched = true;
      }
      if (cfg.text && cfg.text.nowSource === 'system') {
        cfg.text.nowSource = 'manual';
        platformTouched = true;
      }
      if (cfg.text && cfg.text.lyricsFollow) {
        cfg.text.lyricsFollow = false;
        platformTouched = true;
      }
      if (Array.isArray(cfg.layers)) {
        cfg.layers.forEach((l) => {
          if (!l || !l.settings) return;
          if (l.kind === 'logo' && l.settings.logo && l.settings.logo.source && l.settings.logo.source !== 'manual') {
            l.settings.logo.source = 'manual';
            platformTouched = true;
          }
          if (l.settings.nowplaying && l.settings.nowplaying.coverSource !== 'manual') {
            l.settings.nowplaying.coverSource = 'manual';
            platformTouched = true;
          }
          const lt = l.settings.text;
          if (lt && lt.nowSource === 'system') { lt.nowSource = 'manual'; platformTouched = true; }
          if (lt && lt.lyricsFollow) { lt.lyricsFollow = false; platformTouched = true; }
        });
      }
      if (platformTouched) push(true);
    }


    // Studio presetleri (kullanıcının kendi shader/varyasyon tasarımları).
    // render() bunlara bakacağı için ÇİZİMDEN ÖNCE yüklenmeli.
    /* Liste isteği sürerken gelen kayıtlar kaybolmasın. Dinleyici
       cevaptan sonra kurulursa yayın düşer, setUser eski listeyi yazar
       ve preset yeniden başlatılana kadar arayüzde görünmez. */
    let presetsReady = false;
    const earlyPresetDeltas = [];
    let presetGen = 0;
    let presetCatchBusy = false;
    const onPresetDelta = (d) => {
      if (!presetsReady) { earlyPresetDeltas.push(d); return; }
      if (d && d.gen) presetGen = Math.max(presetGen, Number(d.gen) || 0);
      const S = window.SVPresets;
      const ups = (d && Array.isArray(d.upsert)) ? d.upsert : [];
      const studio = ups.some((p) => p && p.kind !== 'milkdrop') ||
        (d && Array.isArray(d.remove) ? d.remove : []).some((id) => {
          const p = S && S.get ? S.get(id) : null;
          return !!p && p.kind !== 'milkdrop';
        });
      /* Seçili MilkDrop kaynağı dosyada değiştiyse panelin kopyası da
         değişsin. Yayın bunu ayara yazıyor; burada da tutmak, aradaki
         kaydırıcının eski metni geri göndermesini keser. */
      if (cfg && cfg.milkdrop) {
        for (let i = 0; i < ups.length; i++) {
          const p = ups[i];
          if (p && p.kind === 'milkdrop' && p.id === cfg.milkdrop.presetId && typeof p.source === 'string' && p.source !== cfg.milkdrop.source) {
            cfg.milkdrop = Object.assign({}, cfg.milkdrop, { source: p.source, name: p.name || cfg.milkdrop.name });
            break;
          }
        }
      }
      if (S && S.applyDelta) S.applyDelta(d);
      scheduleRender(PRESET_CATS);
      if (studio && window.SVPreview && window.SVPreview.notePresets) window.SVPreview.notePresets();
      else if (window.SVPreview) window.SVPreview.setConfig(cfg);
    };
    async function catchPresets() {
      if (!window.api.presetsSince || presetCatchBusy) return;
      presetCatchBusy = true;
      try {
        const page = await window.api.presetsSince(presetGen);
        if (!page) return;
        const nextGen = Number(page.gen) || 0;
        if (page.reset || page.bulk) {
          presetGen = nextGen;
          window.SVPresets.setUser(await window.api.listPresets());
          scheduleRender(PRESET_CATS);
          if (window.SVPreview && window.SVPreview.notePresets) window.SVPreview.notePresets();
          else if (window.SVPreview) window.SVPreview.setConfig(cfg);
          return;
        }
        presetGen = nextGen;
        const up = page.upsert || [];
        const rm = page.remove || [];
        if (!up.length && !rm.length) return;
        onPresetDelta({ upsert: up, remove: rm, gen: nextGen });
      } catch { /* ana süreç kapandıysa bir sonraki tur dener */ }
      finally { presetCatchBusy = false; }
    }
    if (window.api.onPresetsDelta) window.api.onPresetsDelta(onPresetDelta);
    let headGen = 0;
    try {
      if (window.api.presetsHead) {
        const head = await window.api.presetsHead();
        headGen = head && Number(head.gen) || 0;
      }
    } catch { headGen = 0; }
    try {
      window.SVPresets.setUser(await window.api.listPresets());
    } catch { /* preset yoksa yerleşiklerle devam */ }
    presetsReady = true;
    let maxEarly = 0;
    for (let i = 0; i < earlyPresetDeltas.length; i++) {
      const d = earlyPresetDeltas[i];
      if (d && d.gen) maxEarly = Math.max(maxEarly, Number(d.gen) || 0);
      onPresetDelta(d);
    }
    try {
      if (window.api.presetsSince) {
        const page = await window.api.presetsSince(headGen);
        if (page) {
          presetGen = Math.max(maxEarly, Number(page.gen) || 0);
          if (page.reset || page.bulk) {
            try { window.SVPresets.setUser(await window.api.listPresets()); } catch { /* liste yok */ }
            render();
            if (window.SVPreview && window.SVPreview.notePresets) window.SVPreview.notePresets();
          } else if ((page.upsert && page.upsert.length) || (page.remove && page.remove.length)) {
            onPresetDelta({ upsert: page.upsert || [], remove: page.remove || [], gen: page.gen });
          }
        }
      }
    } catch { /* yakalama yoksa yayın yeter */ }
    presetGen = Math.max(presetGen, maxEarly);
    /* Yedek yoklama. Ana süreç her MCP isteğinden sonra ve dosya izleyicisi
       bir değişiklik görünce farkı zaten yayınlıyor; bu yalnız kaçan bir
       yayını yakalar. 400 ms'de bir, 10 bin presetlik klasörün adlarını
       ana süreçte baştan okutuyordu (#695). */
    setInterval(() => {
      if (cfg && cfg.mcp && cfg.mcp.enabled && !document.hidden) catchPresets();
    }, MCP_PRESET_POLL_MS);
    window.addEventListener('focus', () => { catchPresets(); });
    window.api.onPresets((list) => {
      window.SVPresets.setUser(list);
      scheduleRender(PRESET_CATS);
      if (window.SVPreview && window.SVPreview.notePresets) window.SVPreview.notePresets();
      else if (window.SVPreview) window.SVPreview.setConfig(cfg);
    });

    // Uzaktan kumandadan (telefon / OBS sayfası) gelen değişiklik: panelin
    // kendi kopyası tazelenir ve geri gönderilmez — yoksa sonsuz döngü olur.
    window.api.onExternalConfig((incoming) => {
      cfg = window.SV.deepMerge(window.SV.defaultConfig(), incoming);
      // Ana süreç yeni bir yapılandırmada; sonraki gönderim tam olsun
      sentSig = null;
      /* MCP ve telefon aynı yapılandırmayı yollar. Ekran seçimi ayrı bir
         değişkende duruyordu; render() cfg'yi çizse de menü eski kutuyu
         işaretli bırakıyordu. Tıklamadaki gibi seçimi ve sahne vurgusunu
         gelen duruma çek, sonra aynı çizimi çalıştır. */
      if (cfg.display && displays.length) {
        adoptDisplaySelection(cfg.display);
        renderDisplays();
      }
      if (Object.prototype.hasOwnProperty.call(cfg, '_activeSceneId')) {
        activeSceneId = cfg._activeSceneId || null;
      }
      const blackBtn = $('blackoutBtn');
      if (blackBtn) blackBtn.classList.toggle('on', !!(cfg && cfg.isBlackout) || isBlackedOut());
      scheduleRender();
      renderScenes();
      /* render() önizlemeyi katman paneli cfg'yi düzeltmeden önce kuruyor.
         Panel açılıp kapanmadan çıkış ve önizleme aynı cfg'yi görsün. */
      if (window.SVPreview) window.SVPreview.setConfig(cfg);
    });

    // Aynı ayar klasörünü kullanan başka kopyalar ve ayar çakışması (#564)
    initInstanceBanners();

    // Kontrol yüzeyleri (MIDI / OSC)
    if (window.SVControl) window.SVControl.init();
    // Tempo motoru ve otomatik VJ döngüsü
    if (window.SVAutoVJ) window.SVAutoVJ.init();
    if (window.SVAspectPanel) window.SVAspectPanel.init();
    if (window.SVMappingPanel) window.SVMappingPanel.init();
    if (window.SVMilkdropPanel) window.SVMilkdropPanel.init();
    // Yayın sunucusu durumu
    if (window.SVStream) window.SVStream.init();
    // Kamera listesi (medya katmanı için)
    if (window.SVMediaPanel) window.SVMediaPanel.init();

    const sectionsEl = $('sections');
    if (sectionsEl) {
      sectionsEl.addEventListener('pointerdown', (e) => { noteTouch(e); holdPointer(); }, true);
      sectionsEl.addEventListener('keydown', noteTouch, true);
      sectionsEl.addEventListener('change', releasePointer, true);
      sectionsEl.addEventListener('focusout', releasePointer, true);
    }
    window.addEventListener('beforeunload', flushConfig);
    window.addEventListener('pointerup', releasePointer, true);
    window.addEventListener('pointercancel', releasePointer, true);
    window.addEventListener('blur', releasePointer);

    renderDisplays();
    render();
    renderScenes();
    // Eşleştirilen ya da ilk kez seçilen ekran kayda geçsin
    if (displayFixed) push(true);
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
          scheduleRender(['lighting']);
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
    $('openBtn').addEventListener('click', async (e) => {
      /* Seçim boşken açılacak ekran yok. Sessiz kalmak yerine menüyü aç.
         Belgeye ulaşan tıklama menüyü hemen geri kapatırdı. */
      if (!selectedDisplayIds.length) {
        e.stopPropagation();
        const menu = $('displayMenu');
        if (menu) menu.classList.remove('hidden');
        const dBtn = $('displayBtn');
        if (dBtn) dBtn.setAttribute('aria-expanded', 'true');
        svToast(tr('Önce görselleştirmenin açılacağı ekranı seçin.'), 'warn');
        return;
      }
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

    /* Üst sağ dişli → tek Ayarlar kategorisi (modal yok). */
    const settingsBtn = $('settingsBtn');
    if (settingsBtn) {
      settingsBtn.addEventListener('click', () => setCategory('settings'));
    }

    // Gelişmiş ayarlar anahtarı + kategori sıfırlama
    $('advToggle').addEventListener('change', (e) => setAdvanced(e.target.checked));
    $('catResetBtn').addEventListener('click', () => resetCategory(activeCategory));

    // Sağ dock'taki sahne düğmeleri
    $('sceneSaveBtn').addEventListener('click', () => actions.saveScene());
    $('sceneExportBtn').addEventListener('click', () => actions.exportScenes());
    $('sceneImportBtn').addEventListener('click', () => actions.importScenes());

    // Telefondan gelen eylemler paneldeki gerçek uygulamayı çağırır
    if (window.api.onRemoteAction) {
      window.api.onRemoteAction((action) => {
        if (action === 'blackout') toggleBlackout();
      });
    }
    /* Kaza koruması geri bildirimi. ESC engellendiğinde kullanıcı tuşa
       basıp hiçbir şey olmadığını görüyor; ne yapması gerektiğini
       söylemezsek uygulamayı çökmüş sanır. */
    if (window.api.onProtectionBlocked) {
      window.api.onProtectionBlocked(() => {
        svToast(tr('ESC kapatma kapalı. Kapatmak için Kapat düğmesini ya da Ctrl+Shift+Q kullanın.'), 'warn');
      });
    }
    if (window.api.onProtectionRecovered) {
      window.api.onProtectionRecovered((id) => {
        svToast(tr('Görselleştirme penceresi beklenmedik biçimde kapandı, kaza koruması geri açtı.'), 'ok');
        // Kaza koruması pencereyi geri açtığında butonları derhal aktif et ve durumu sorgula
        if (window.api.getVisualizerStatus) {
          window.api.getVisualizerStatus().then((d) => {
            if (d && typeof d.open === 'boolean') setStatus(d.open, d.displayIds);
          }).catch(() => setStatus(true, id != null ? [id] : null));
        } else {
          setStatus(true, id != null ? [id] : null);
        }
      });
    }
    if (window.api.onProtectionGaveUp) {
      window.api.onProtectionGaveUp(() => {
        svToast(tr('Görselleştirme penceresi sürekli kapanıyor; kaza koruması geri açmayı bıraktı.'), 'err');
      });
    }
    if (window.api.onRequestConfirmClose) {
      window.api.onRequestConfirmClose(async () => {
        if (document.querySelector('.ask-backdrop')) return;
        const confirmed = await svConfirm(
          tr('Görselleştirici açıkken uygulamayı kapatmak istediğinizden emin misiniz? Görselleştirici ekranları ve yönetici paneli sonlandırılacak.'),
          {
            title: tr('Uygulamayı Kapat'),
            okText: tr('Uygulamayı Kapat'),
            cancelText: tr('İptal'),
            danger: true,
            defaultCancel: true,
          }
        );
        if (confirmed && window.api.confirmCloseApproved) {
          window.api.confirmCloseApproved();
        }
      });
    }
    if (window.api.onNowPlaying) {
      window.api.onNowPlaying((st) => {
        window.SVNowLive = window.SVNowLive || { state: null };
        window.SVNowLive.state = st;
        handleDynamicThemeTrackUpdate(st);
      });
    }
    if (window.SVLyricsClock && window.SVLyricsClock.install) window.SVLyricsClock.install(window.api);
    if (window.SVLyricsSync && window.SVLyricsSync.installLibrary) {
      window.SVLyricsSync.installLibrary(window.api, () => {
        const ae = document.activeElement;
        if (ae && (ae.tagName === 'INPUT' || ae.tagName === 'TEXTAREA')) return;
        if (document.getElementById('sections')) scheduleRender(['scene', 'library']);
      });
    }
    window.api.onVisualizerStatus((d) => setStatus(d.open, d.displayIds, d.floating));

    /* K1 admin notice: refresh when preview stack flips WebGL→solid fallback. */
    let fallbackUiRaf = 0;
    window.addEventListener('sv-gradient-webgl-fallback', () => {
      if (fallbackUiRaf) return;
      fallbackUiRaf = requestAnimationFrame(() => {
        fallbackUiRaf = 0;
        const want = !!(window.SVLayers
          && typeof window.SVLayers.isGradientWebGLFallback === 'function'
          && window.SVLayers.isGradientWebGLFallback());
        const has = !!document.querySelector('[data-sv-webgl-fallback-note]');
        if (want !== has) scheduleRender(['scene']);
      });
    });

    // Farklı kontrol sistemi (Heartbeat / Durum Güvencesi):
    // Kaza korumasıyla pencere geri açıldığında, çökme anında veya IPC gecikmelerinde
    // buton durumunun ve görselleştirici durumunun gerçekle %100 uyuşmasını garanti eder.
    const syncVisualizerStatusFromMain = async () => {
      if (!window.api || !window.api.getVisualizerStatus) return;
      try {
        const st = await window.api.getVisualizerStatus();
        if (st && typeof st.open === 'boolean') {
          const closeBtn = $('closeBtn');
          const isMismatched = (st.open !== visOpen) || (closeBtn && closeBtn.disabled === st.open);
          if (isMismatched) {
            setStatus(st.open, st.displayIds, st.floating);
          }
        }
      } catch {}
    };

    setInterval(() => {
      if (!document.hidden) syncVisualizerStatusFromMain();
    }, 1000);

    window.addEventListener('focus', syncVisualizerStatusFromMain);
    document.addEventListener('visibilitychange', () => {
      if (!document.hidden) syncVisualizerStatusFromMain();
    });
    window.api.onDisplaysChanged((list) => {
      displays = list;
      /* Ekran yeniden takılınca kimliği değişebilir; seçim izle bulunur. */
      const moved = adoptDisplaySelection(cfg.display);
      renderDisplays();
      if (moved) push(true);
    });
    window.api.onAudioMeter((d) => {
      /* MilkDrop `monitor` değeri doğrudan DOM'a yazılıyor, paneli yeniden
         çizerek değil: panel her karede yeniden çizilseydi ayar
         alanlarındaki odak ve imleç konumu kaybolurdu. */
      window.SVMdMonitor = d.mdMonitor;
      const mv = document.getElementById('mdMonitorVal');
      if (mv) {
        const txt = (d.mdMonitor === null || d.mdMonitor === undefined)
          ? '—' : Number(d.mdMonitor).toFixed(4);
        // Aynı metni yeniden yazmak düğümü söküp takıyor ve yerleşimi bozuyor
        if (mv.textContent !== txt) mv.textContent = txt;
      }
      /* Otomatik geçişin o an çizdiği preset. Seçim ayara yazılmıyor
         (shared/milkdrop-cycle.js): panel ekranda ne olduğunu, önizleme de
         neyi izleyeceğini yalnız buradan öğrenebiliyor. Alan yoksa MilkDrop
         çizilmiyor ve izlenecek bir şey yok. */
      window.SVMdFollow = d.mdPreset ? Object.assign({ at: performance.now() }, d.mdPreset) : null;
      /* Gösterilen preset geçmişe ve puan yıldızlarına da gidiyor (#569):
         "geri" otomatik geçişin seçtiğine de dönebilsin. Mesaj
         requestAnimationFrame'e bağlı değil; görselleştirici paneli örtse
         de geliyor. */
      if (window.SVMilkdropPanel && window.SVMilkdropPanel.noteLive) {
        window.SVMilkdropPanel.noteLive(d.mdPreset);
      }
      const lv = document.getElementById('mdLiveName');
      if (lv) {
        const adsiz = window.SVI18n && window.SVI18n.t ? window.SVI18n.t('Adsız') : 'Adsız';
        const nm = d.mdPreset && d.mdPreset.id ? (d.mdPreset.name || adsiz) : lv.getAttribute('data-cfg');
        if (nm !== null && lv.textContent !== nm) lv.textContent = nm;
      }
      setMeter('mLevel', d.level);
      setMeter('mBass', d.bass);
      setMeter('mMid', d.mid);
      setMeter('mTreble', d.treble);
      ensureAudioListeningFromLevels(d);
    });
    window.api.onAudioSourceStatus((s) => {
      if (s.type === 'started') {
        markAudioCapturing(s.device || 'çıkış');
        $('banner').classList.add('hidden');
        // başlatılan aygıtlardan herhangi biri listede yoksa listeyi tazele
        if (s.device) {
          const devNames = s.device.split(' + ');
          const anyMissing = devNames.some((n) => n !== 'default' && !audioDevices.some((d) => d.name === n));
          if (anyMissing) actions.refreshDevices();
        }
      } else if (s.type === 'no-loopback') {
        /* Bu platformda sistem sesini veren bir aygıt yok. Hata değil,
           eksik bir kurulum: macOS'ta CoreAudio loopback vermez ve
           kullanıcının BlackHole gibi sanal bir aygıt kurması gerekir.
           Sessiz kalmak, kullanıcının neden hiçbir şey görmediğini
           anlamaması demek olurdu. */
        audioUiKind = 'err';
        setAudioState('Sistem sesi yakalanamıyor', 'err', 'warning');
        $('bannerDetail').textContent = s.message || 'Bu sistemde sistem sesini veren bir aygıt bulunamadı.';
        $('banner').classList.remove('hidden');
      } else if (s.type === 'error') {
        audioUiKind = 'err';
        setAudioState('Ses yakalanamadı', 'err', 'warning');
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
        exportPct = 100;
        const fill = $('exportProgressFill');
        if (fill) fill.style.width = '100%';
        setExportStatus('Kodlanıyor (' + exportEnc + ')… kareler bitti, video yazılıyor.');
        return;
      }
      const pct = d.total ? Math.round((d.done / d.total) * 100) : 0;
      exportPct = pct;
      const fill = $('exportProgressFill');
      if (fill) fill.style.width = pct + '%';
      setExportStatus('Render ediliyor [' + exportEnc + ']… %' + pct + '  (' + d.done + ' / ' + d.total + ' kare)');
    });
    window.api.onExportDone((d) => {
      exporting = false;
      setExportUI(false);
      if (d.status === 'done') {
        const enc = d.encoder === 'gpu' ? 'GPU/NVENC' : 'CPU/libx264';
        setExportStatus('Tamamlandı (' + enc + ') → ' + d.output, 'ok', 'check-circle');
      } else if (d.status === 'cancelled') {
        setExportStatus('İptal edildi.');
      } else {
        setExportStatus('Hata: ' + (d.message || 'bilinmeyen hata'), 'err', 'warning');
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
        el('span', { class: 'ico', icon: 'warning' }),
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

  /* Öz test için küçük bir denetim yüzeyi.

     Yalnızca ölçüm yapar, hiçbir şeyi değiştirmez. Buradaki tek amaç,
     bölümlerin bildirdiği yapılandırma köklerinin gerçekten varsayılanlarda
     karşılığı olduğunu doğrulamak: yanlış yazılmış bir kök sessizce yok
     sayılır ve o bölümün sıfırlama düğmesi hiç görünmezdi. */
  window.SVAdminDebug = {
    checkSectionRoots() {
      const bad = [];
      let withRoots = 0;
      let resettable = 0;
      sectionSchema().forEach((sec) => {
        if (sec.roots && sec.roots.length) {
          withRoots++;
          sec.roots.forEach((r) => {
            if (defaultAt(r) === undefined) bad.push(sec.id + '.' + r);
          });
        }
        if (sectionPaths(sec).length) resettable++;
      });
      return { bad, withRoots, resettable };
    },

    /* Mantıksal öznitelik denetimi.

       el() bir zamanlar setAttribute('disabled', false) çağırıyordu; HTML'de
       bu özniteliğin VARLIĞI belirleyici olduğu için düğme disabled="false"
       ile KAPALI doğuyordu. Kayıt, Anlık Görüntü ve MilkDrop içe aktarma
       düğmeleri hiç çalışmadı. Öz test bunu gerçek DOM'da doğruluyor. */
    checkBoolAttrs() {
      const off = el('button', { disabled: false, text: 'x' });
      const on = el('button', { disabled: true, text: 'x' });
      const box = el('input', { type: 'checkbox', checked: false });
      return {
        offDisabled: off.disabled,   // false olmalı
        onDisabled: on.disabled,     // true olmalı
        boxChecked: box.checked,     // false olmalı
        offHasAttr: off.hasAttribute('disabled'),
      };
    },
  };

  init().catch(showFatal);
})();
