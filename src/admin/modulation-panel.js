'use strict';
/* Modülasyon matrisi paneli.

   Üç bölüm:
     Makrolar      — sekiz adlandırılabilir düğme; her biri birden çok
                     yönlendirmeyi aynı anda sürebilir
     Üreteçler     — LFO'lar, zarf takipçileri, rastgele üreteç
     Yönlendirmeler— kaynak → hedef bağlantıları, canlı değer göstergesiyle

   Hedef listesi yapılandırmadan CANLI üretilir: efekt zincirine bir efekt
   eklendiğinde onun parametreleri, 3B geometride formül değiştiğinde o
   formülün kendi parametreleri hedef olarak anında görünür. Sabit bir liste
   tutmak, motor büyüdükçe kaçınılmaz olarak eskirdi. */
(function () {
  const P = () => window.SVPanel;
  const SP = () => window.SVScenePanels;

  // ==========================================================================
  // Hedef kataloğu — yapılandırmadaki sayısal yaprakları toplar
  // ==========================================================================

  /* Bu köklerin altındaki sayısal alanlar hedef olabilir. Yapılandırmanın
     tamamını taramak yerine seçici davranıyoruz: "ekran kimliği" ya da "port
     numarası" gibi sayısal ama modüle edilmesi anlamsız alanlar listeyi
     kirletirdi. */
  const ROOTS = [
    { path: 'visualizer', label: 'Görselleştirici', skip: ['barCount', 'minFreq', 'maxFreq'] },
    { path: 'background', label: 'Arkaplan', skip: [] },
    { path: 'geometry', label: '3B Geometri', skip: ['attractorPoints'] },
    { path: 'logo', label: 'Logo', skip: [] },
    { path: 'images', label: 'Görsel Nesneler', skip: ['count'] },
    { path: 'audio', label: 'Ses', skip: [] },
    { path: 'lighting', label: 'Aydınlatma', skip: [] },
  ];

  // Sık kullanılan alanların insan okuyabilir adları. Listede olmayan bir
  // alan ham anahtarıyla görünür — yeni alan eklendiğinde panel bozulmaz.
  const FIELD_LABELS = {
    glow: 'Parlama', opacity: 'Saydamlık', thickness: 'Kalınlık', gap: 'Boşluk',
    sensitivity: 'Duyarlılık', lineWidth: 'Çizgi Kalınlığı', smoothing: 'Yumuşatma',
    speed: 'Hız', bright: 'Parlaklık', react: 'Tepki', scale: 'Ölçek', rotate: 'Dönüş',
    spin: 'Dönüş Hızı', tilt: 'Eğim', zoom: 'Yakınlaşma', deform: 'Bozulma',
    alpha: 'Saydamlık', pointSize: 'Nokta Boyutu', resolution: 'Çözünürlük',
    cameraAudio: 'Bas → Kamera', pulse: 'Nabız', x: 'Yatay', y: 'Dikey',
    bassBoost: 'Bas Vurgusu', strength: 'Şiddet', amount: 'Miktar', size: 'Boyut',
    attractorStep: 'İntegrasyon Adımı', hueShift: 'Renk Kayması', saturation: 'Doygunluk',
  };
  const fieldLabel = (k) => FIELD_LABELS[k] || k;

  // Bir nesnenin sayısal yapraklarını topla (en fazla iki düzey derin)
  function collect(obj, base, out, group, skip, depth) {
    if (!obj || typeof obj !== 'object' || depth > 2) return;
    for (const k of Object.keys(obj)) {
      if (skip && skip.indexOf(k) >= 0) continue;
      const v = obj[k];
      const path = base + '.' + k;
      if (typeof v === 'number' && isFinite(v)) {
        out.push({ path, label: fieldLabel(k), group });
      } else if (v && typeof v === 'object' && !Array.isArray(v)) {
        collect(v, path, out, group, skip, depth + 1);
      }
    }
  }

  function targetCatalog(cfg) {
    const out = [];
    for (const r of ROOTS) {
      collect(cfg[r.path], r.path, out, r.label, r.skip, 1);
    }
    // Efekt zinciri: her efektin kendi parametreleri
    const fx = Array.isArray(cfg.postfx) ? cfg.postfx : [];
    const defs = (window.SVPostFX && window.SVPostFX.EFFECTS) || {};
    fx.forEach((f, i) => {
      const def = defs[f.type];
      if (!def) return;
      out.push({ path: 'postfx.' + i + '.opacity', label: 'Karışım', group: (i + 1) + '. ' + def.label });
      for (const p of def.params || []) {
        out.push({
          path: 'postfx.' + i + '.params.' + p.name,
          label: p.label || p.name,
          group: (i + 1) + '. ' + def.label,
          min: p.min, max: p.max,
        });
      }
    });
    // Katmanlar: opaklık ve dönüşüm
    const layers = Array.isArray(cfg.layers) ? cfg.layers : [];
    layers.forEach((l, i) => {
      const g = 'Katman ' + (i + 1) + (l.name ? ' · ' + l.name : '');
      out.push({ path: 'layers.' + i + '.opacity', label: 'Saydamlık', group: g, min: 0, max: 1 });
      out.push({ path: 'layers.' + i + '.transform.scale', label: 'Ölçek', group: g, min: 0.2, max: 3 });
      out.push({ path: 'layers.' + i + '.transform.rotate', label: 'Dönüş', group: g, min: -180, max: 180 });
      out.push({ path: 'layers.' + i + '.transform.x', label: 'Yatay', group: g, min: -0.5, max: 0.5 });
      out.push({ path: 'layers.' + i + '.transform.y', label: 'Dikey', group: g, min: -0.5, max: 0.5 });
    });
    return out;
  }

  // Hedefin makul kaydırıcı aralığı: katalogda varsa oradan, yoksa mevcut
  // değerden türetilir
  function rangeFor(cat, path, current) {
    const hit = cat.find((c) => c.path === path);
    if (hit && hit.min != null && hit.max != null) return [hit.min, hit.max];
    const v = typeof current === 'number' ? current : 1;
    if (v >= 0 && v <= 1) return [0, 1];
    const span = Math.max(1, Math.abs(v) * 2);
    return [v - span, v + span];
  }

  // ==========================================================================
  // Panel
  // ==========================================================================
  const SHAPE_LABELS = [
    ['sine', 'Sinüs'], ['triangle', 'Üçgen'], ['sawUp', 'Testere ↑'], ['sawDown', 'Testere ↓'],
    ['square', 'Kare'], ['pulse', 'Darbe'], ['stepRandom', 'Rastgele (basamaklı)'],
    ['smoothRandom', 'Rastgele (yumuşak)'],
  ];
  const CURVE_LABELS = [
    ['linear', 'Doğrusal'], ['exp', 'Üstel'], ['exp3', 'Üstel (güçlü)'], ['log', 'Logaritmik'],
    ['scurve', 'S Eğrisi'], ['ease', 'Yumuşak'], ['abs', 'Mutlak'],
  ];
  const MODE_LABELS = [['set', 'Değeri Belirle'], ['add', 'Üstüne Ekle'], ['mul', 'Çarp']];
  const BAND_LABELS = [['bass', 'Bas'], ['mid', 'Orta'], ['treble', 'Tiz'], ['level', 'Genel']];

  let meterTimer = 0;
  const meters = []; // { el, source }

  function newRoute(cfg) {
    return {
      id: 'md_' + Math.random().toString(36).slice(2, 8),
      enabled: true,
      source: 'bass',
      target: '',
      min: 0, max: 1,
      mode: 'set',
      curve: 'linear',
      amount: 1,
      smooth: 0,
      steps: 0,
      invert: false,
    };
  }

  function panel() {
    const el = P().el;
    const cfg = P().cfg();
    const m = cfg.modulation || (cfg.modulation = window.SV.defaultConfig().modulation);
    const rerender = () => P().apply();
    const nodes = [];
    meters.length = 0;

    nodes.push(SP().miniToggle('Modülasyon Etkin', () => m.enabled !== false, (v) => { m.enabled = v; }));

    // ---------------------------------------------------------------- makro
    const macroBox = el('div', { class: 'mod-macros' });
    for (let i = 0; i < 8; i++) {
      const mc = m.macros[i] || (m.macros[i] = { name: 'Makro ' + (i + 1), value: 0 });
      const nameIn = el('input', {
        class: 'p-in tiny', type: 'text', value: mc.name || '',
        oninput: (e) => { mc.name = e.target.value; P().push(false); },
      });
      const val = el('span', { class: 'val', text: Math.round((mc.value || 0) * 100) + '%' });
      const slider = el('input', {
        type: 'range', min: 0, max: 1, step: 0.01, value: mc.value || 0,
        oninput: (e) => {
          mc.value = parseFloat(e.target.value);
          val.textContent = Math.round(mc.value * 100) + '%';
          P().push(false);
        },
      });
      macroBox.appendChild(el('div', { class: 'mod-macro' }, [
        el('div', { class: 'row' }, [nameIn, val]), slider,
      ]));
    }
    nodes.push(el('div', { class: 'ctrl' }, [
      el('label', { class: 'lbl', text: 'Makrolar' }), macroBox,
      el('div', { class: 'studio-note dim-hint', text: 'Bir makroyu birden çok yönlendirmeye bağlayın: tek düğme sahnenin tamamını sürer.' }),
    ]));

    // ----------------------------------------------------------------- LFO
    nodes.push(SP().foldable('LFO (4)', () => {
      const kids = [];
      for (let i = 0; i < 4; i++) {
        const l = m.lfos[i] || (m.lfos[i] = {});
        kids.push(el('div', { class: 'mod-gen' }, [
          el('div', { class: 'item-head' }, [el('span', { class: 'item-title', text: 'LFO ' + (i + 1) })]),
          SP().miniSelect('Dalga', SHAPE_LABELS, () => l.shape || 'sine', (v) => { l.shape = v; }),
          SP().miniToggle('Tempoya Kilitle', () => !!l.sync, (v) => { l.sync = v; }, rerender),
          l.sync
            ? SP().miniSelect('Bölüm', window.SVModulation.DIVISIONS.map((d) => [d.id, d.id]), () => l.division || '1/1', (v) => { l.division = v; })
            : SP().miniSlider('Hız (Hz)', () => (l.rate == null ? 0.5 : l.rate), (v) => { l.rate = v; }, { min: 0.01, max: 8, step: 0.01, fmt: (v) => (+v).toFixed(2) + ' Hz' }),
          SP().miniSlider('Faz', () => l.phase || 0, (v) => { l.phase = v; }, { min: 0, max: 1, step: 0.01 }),
          l.shape === 'pulse'
            ? SP().miniSlider('Darbe Genişliği', () => (l.width == null ? 0.25 : l.width), (v) => { l.width = v; }, { min: 0.05, max: 0.95, step: 0.01, percent: true })
            : null,
          SP().miniToggle('Çift Kutuplu (-1..1)', () => !!l.bipolar, (v) => { l.bipolar = v; }),
        ].filter(Boolean)));
      }
      return kids;
    }));

    // --------------------------------------------------------------- zarf
    nodes.push(SP().foldable('Zarf Takipçileri (2)', () => {
      const kids = [];
      for (let i = 0; i < 2; i++) {
        const e = m.envelopes[i] || (m.envelopes[i] = {});
        kids.push(el('div', { class: 'mod-gen' }, [
          el('div', { class: 'item-head' }, [el('span', { class: 'item-title', text: 'Zarf ' + (i + 1) })]),
          SP().miniSelect('Kaynak Bant', BAND_LABELS, () => e.band || 'bass', (v) => { e.band = v; }),
          SP().miniSlider('Atak', () => (e.attack == null ? 0.02 : e.attack), (v) => { e.attack = v; }, { min: 0.001, max: 1, step: 0.001, fmt: (v) => Math.round(v * 1000) + ' ms' }),
          SP().miniSlider('Bırakma', () => (e.release == null ? 0.3 : e.release), (v) => { e.release = v; }, { min: 0.01, max: 3, step: 0.01, fmt: (v) => Math.round(v * 1000) + ' ms' }),
        ]));
      }
      const r = m.random || (m.random = {});
      kids.push(el('div', { class: 'mod-gen' }, [
        el('div', { class: 'item-head' }, [el('span', { class: 'item-title', text: 'Rastgele Üreteç' })]),
        SP().miniToggle('Tempoya Kilitle', () => !!r.sync, (v) => { r.sync = v; }, rerender),
        r.sync
          ? SP().miniSelect('Bölüm', window.SVModulation.DIVISIONS.map((d) => [d.id, d.id]), () => r.division || '1/1', (v) => { r.division = v; })
          : SP().miniSlider('Hız (Hz)', () => (r.rate == null ? 1 : r.rate), (v) => { r.rate = v; }, { min: 0.05, max: 12, step: 0.05, fmt: (v) => (+v).toFixed(2) + ' Hz' }),
      ]));
      return kids;
    }));

    // -------------------------------------------------------- yönlendirmeler
    const routes = Array.isArray(m.routes) ? m.routes : (m.routes = []);
    const cat = targetCatalog(cfg);
    const sources = window.SVModulation.catalog(cfg);

    const list = el('div', { class: 'mod-routes' });
    routes.forEach((r, i) => {
      const enableBox = el('input', {
        type: 'checkbox',
        onchange: (e) => { r.enabled = e.target.checked; rerender(); },
      });
      enableBox.checked = r.enabled !== false;

      const meter = el('span', { class: 'mod-meter' }, [el('i')]);
      meters.push({ el: meter.firstChild, source: r.source });

      const srcOpts = [];
      let lastGroup = null;
      for (const s of sources) {
        if (s.group !== lastGroup) { srcOpts.push([null, s.group]); lastGroup = s.group; }
        srcOpts.push([s.id, s.label]);
      }

      const tgtSel = P().el('select', {
        class: 'p-in',
        onchange: (e) => {
          r.target = e.target.value;
          const cur = window.SVModulation.getIn(cfg, r.target);
          const [lo, hi] = rangeFor(cat, r.target, cur);
          r.min = lo; r.max = hi;
          rerender();
        },
      });
      tgtSel.appendChild(P().el('option', { value: '', text: '— hedef seçin —' }));
      let tGroup = null;
      let optGroup = null;
      for (const c of cat) {
        if (c.group !== tGroup) {
          tGroup = c.group;
          optGroup = P().el('optgroup');
          optGroup.label = c.group;
          tgtSel.appendChild(optGroup);
        }
        const o = P().el('option', { value: c.path, text: c.label });
        if (c.path === r.target) o.selected = true;
        optGroup.appendChild(o);
      }

      const title = (sources.find((s) => s.id === r.source) || {}).label || r.source;
      const kids = [
        SP().itemHeader(routes, i, (i + 1) + '. ' + title, rerender,
          el('label', { class: 'switch small' }, [enableBox, el('span', { class: 'track' })])),
        P().row('Anlık', meter),
        (() => {
          const sel = P().el('select', {
            class: 'p-in',
            onchange: (e) => { r.source = e.target.value; rerender(); },
          });
          let g = null;
          let og = null;
          for (const [v, t] of srcOpts) {
            if (v === null) { og = P().el('optgroup'); og.label = t; sel.appendChild(og); g = t; continue; }
            const o = P().el('option', { value: v, text: t });
            if (v === r.source) o.selected = true;
            (og || sel).appendChild(o);
          }
          return P().row('Kaynak', sel);
        })(),
        P().row('Hedef', tgtSel),
        SP().miniSelect('Kip', MODE_LABELS, () => r.mode || 'set', (v) => { r.mode = v; }),
        SP().miniSelect('Eğri', CURVE_LABELS, () => r.curve || 'linear', (v) => { r.curve = v; }),
        SP().miniSlider('Miktar', () => (r.amount == null ? 1 : r.amount), (v) => { r.amount = v; }, { min: 0, max: 1, step: 0.01, percent: true }),
        SP().miniSlider('Alt Sınır', () => (r.min == null ? 0 : r.min), (v) => { r.min = v; }, { min: -180, max: 180, step: 0.01, fmt: (v) => (+v).toFixed(2) }),
        SP().miniSlider('Üst Sınır', () => (r.max == null ? 1 : r.max), (v) => { r.max = v; }, { min: -180, max: 180, step: 0.01, fmt: (v) => (+v).toFixed(2) }),
        SP().miniSlider('Yumuşatma', () => r.smooth || 0, (v) => { r.smooth = v; }, { min: 0, max: 2, step: 0.01, fmt: (v) => (v > 0 ? Math.round(v * 1000) + ' ms' : 'yok') }),
        SP().miniSlider('Basamak', () => r.steps || 0, (v) => { r.steps = Math.round(v); }, { min: 0, max: 16, step: 1, fmt: (v) => (v > 1 ? Math.round(v) : 'sürekli') }),
        SP().miniToggle('Ters Çevir', () => !!r.invert, (v) => { r.invert = v; }),
      ];
      list.appendChild(el('div', { class: 'mod-route' }, kids));
    });

    if (!routes.length) {
      list.appendChild(el('div', { class: 'studio-note', text: 'Henüz yönlendirme yok. "Yönlendirme Ekle" ile bası bir efekt parametresine ya da bir LFO\'yu kameraya bağlayın.' }));
    }
    nodes.push(list);

    nodes.push(el('div', { class: 'row' }, [
      el('button', {
        class: 'btn', type: 'button', text: '+ Yönlendirme Ekle',
        onclick: () => { routes.push(newRoute(cfg)); rerender(); },
      }),
      el('button', {
        class: 'btn ghost', type: 'button', text: 'Hepsini Temizle',
        onclick: async () => {
          if (!routes.length) return;
          if (await P().confirm('Tüm yönlendirmeler silinsin mi?')) { routes.length = 0; rerender(); }
        },
      }),
    ]));

    startMeters();
    return el('div', { class: 'mod-panel' }, nodes);
  }

  /* Canlı değer göstergeleri. Panelin kendi modülatörü yok; önizlemedeki
     motorun değerlerini okur, böylece gösterge ile ekrandaki görüntü aynı
     sayıyı gösterir. */
  function startMeters() {
    if (meterTimer) clearInterval(meterTimer);
    meterTimer = setInterval(() => {
      const mod = window.SVPreview && window.SVPreview.modulator && window.SVPreview.modulator();
      if (!mod) return;
      let alive = false;
      for (const m of meters) {
        if (!m.el || !m.el.isConnected) continue;
        alive = true;
        const v = Math.max(0, Math.min(1, Math.abs(mod.value(m.source))));
        m.el.style.width = (v * 100).toFixed(1) + '%';
      }
      if (!alive) { clearInterval(meterTimer); meterTimer = 0; }
    }, 80);
  }

  window.SVModulationPanel = { panel, targetCatalog };
})();
