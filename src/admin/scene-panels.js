'use strict';
/* Sahne motorlarının panelleri: Katmanlar, Efekt Zinciri ve 3B Geometri.

   Üçü de aynı desende: yapılandırmadaki listeyi/nesneyi doğrudan düzenler ve
   push() ile canlı yayar. Kontroller SVPanel yardımcılarıyla üretildiği için
   görünüm diğer kartlarla aynı kalır. */
(function () {
  const P = () => window.SVPanel;

  function moveItem(list, i, dir) {
    const j = i + dir;
    if (j < 0 || j >= list.length) return false;
    const t = list[i];
    list[i] = list[j];
    list[j] = t;
    return true;
  }

  // Sıra/sil düğmelerinden oluşan başlık çubuğu
  function itemHeader(list, i, title, onChange, extra) {
    const el = P().el;
    const kids = [
      el('button', {
        class: 'btn ghost tiny', type: 'button', text: '▲', title: 'Yukarı taşı',
        onclick: () => { if (moveItem(list, i, -1)) onChange(); },
      }),
      el('button', {
        class: 'btn ghost tiny', type: 'button', text: '▼', title: 'Aşağı taşı',
        onclick: () => { if (moveItem(list, i, 1)) onChange(); },
      }),
      el('span', { class: 'item-title', text: title }),
    ];
    if (extra) kids.push(extra);
    kids.push(
      el('button', {
        class: 'btn ghost tiny danger', type: 'button', text: '✕', title: 'Kaldır',
        onclick: () => { list.splice(i, 1); onChange(); },
      })
    );
    return el('div', { class: 'item-head' }, kids);
  }

  // Küçük etiketli kaydırıcı (katman/efekt kartlarının içinde)
  function miniSlider(label, get, set, opts) {
    const el = P().el;
    const o = opts || {};
    const fmt = o.fmt || ((v) => (o.percent ? Math.round(v * 100) + '%' : (+v).toFixed(2)));
    const val = el('span', { class: 'val', text: fmt(get()) });
    const input = el('input', {
      type: 'range',
      min: o.min == null ? 0 : o.min,
      max: o.max == null ? 1 : o.max,
      step: o.step == null ? 0.01 : o.step,
      value: get(),
      oninput: (e) => {
        const v = parseFloat(e.target.value);
        set(v);
        val.textContent = fmt(v);
        P().push(false);
      },
    });
    return el('div', { class: 'ctrl' }, [
      el('div', { class: 'row' }, [el('label', { class: 'lbl', text: label }), val]),
      input,
    ]);
  }

  function miniSelect(label, options, get, set, onAfter) {
    const el = P().el;
    const sel = el('select', {
      class: 'p-in',
      onchange: (e) => { set(e.target.value); P().push(true); if (onAfter) onAfter(); },
    });
    for (const [v, t] of options) {
      const o = el('option', { value: v, text: t });
      if (String(get()) === String(v)) o.selected = true;
      sel.appendChild(o);
    }
    return P().row(label, sel);
  }

  function miniToggle(label, get, set, onAfter) {
    const el = P().el;
    const inp = el('input', {
      type: 'checkbox',
      onchange: (e) => { set(e.target.checked); P().push(true); if (onAfter) onAfter(); },
    });
    inp.checked = !!get();
    return P().row(label, el('label', { class: 'switch small' }, [inp, el('span', { class: 'track' })]));
  }

  // Katlanır bölüm (dönüşüm / ses gibi ikincil ayarlar için)
  function foldable(title, buildKids) {
    const el = P().el;
    const body = el('div', { class: 'fold-body' });
    let open = false;
    const head = el('button', {
      class: 'fold-head', type: 'button', text: '▸ ' + title,
      onclick: () => {
        open = !open;
        head.textContent = (open ? '▾ ' : '▸ ') + title;
        body.classList.toggle('open', open);
        if (open && !body.childElementCount) buildKids().forEach((n) => n && body.appendChild(n));
      },
    });
    return el('div', { class: 'fold' }, [head, body]);
  }

  // ==========================================================================
  // KATMANLAR
  // ==========================================================================
  const LAYER_KIND_LABELS = [
    ['background', 'Arkaplan'],
    ['visualizer', 'Görselleştirici'],
    ['media', 'Medya'],
    ['sprites', 'Görsel Nesneler'],
    ['logo', 'Logo'],
  ];

  const BLEND_LABELS = [
    ['normal', 'Normal'], ['add', 'Toplama'], ['screen', 'Ekran'], ['multiply', 'Çarpma'],
    ['overlay', 'Kaplama'], ['darken', 'Koyulaştır'], ['lighten', 'Açıklaştır'],
    ['color-dodge', 'Renk Soldurma'], ['color-burn', 'Renk Yakma'],
    ['hard-light', 'Sert Işık'], ['soft-light', 'Yumuşak Işık'],
    ['difference', 'Fark'], ['exclusion', 'Dışlama'],
    ['hue', 'Renk Tonu'], ['saturation', 'Doygunluk'], ['color', 'Renk'], ['luminosity', 'Parlaklık'],
  ];

  const BAND_LABELS = [['bass', 'Bas'], ['mid', 'Orta'], ['treble', 'Tiz'], ['level', 'Genel']];

  // Katman türüne göre seçilebilir mod listesi
  function typeOptionsFor(kind) {
    if (kind === 'background') {
      return [
        ['gradient', 'Akışkan Gradyan'], ['ink', 'Mürekkep'], ['nebula', 'Bulutsu'],
        ['waves', 'Dalga Katmanları'], ['aurora', 'Kutup Işıkları'], ['grid', 'Retro Izgara'],
        ['hexgrid', 'Petek Izgara'], ['mosaic', 'Mozaik'], ['corridor', 'Koridor'],
        ['spiral', 'Sarmal'], ['rings', 'Nabız Halkaları'], ['network', 'Ağ'],
        ['starfield', 'Yıldız Alanı'], ['snow', 'Kar / Kor'], ['bokeh', 'Işık Parçacıkları'],
        ['rain', 'Dijital Yağmur'], ['city', 'Şehir'], ['custom', 'Studio Preset'], ['solid', 'Düz Renk'],
      ];
    }
    if (kind === 'visualizer') {
      return [
        ['bars', 'Barlar'], ['centerBars', 'Merkez'], ['blocks', 'Segment'], ['dots', 'Nokta Matris'],
        ['skyline', 'Şehir Silüeti'], ['wave', 'Dalga'], ['ribbon', 'Şerit'], ['wave3d', '3B Dalga'],
        ['lissajous', 'Lissajous'], ['strings', 'Teller'], ['terrain', 'Arazi'], ['circular', 'Çember'],
        ['radialWave', 'Dairesel Dalga'], ['starburst', 'Işın'], ['arcs', 'Yaylar'], ['pinwheel', 'Fırıldak'],
        ['mandala', 'Mandala'], ['kaleido', 'Kaleydoskop'], ['vortex', 'Girdap'], ['helix', 'Sarmal'],
        ['tunnel', 'Tünel'], ['orb', 'Küre'], ['particles', 'Parçacık'], ['fireworks', 'Havai Fişek'],
        ['lightning', 'Şimşek'], ['bubbles', 'Baloncuk'], ['metaball', 'Sıvı Damla'],
        ['ripplegrid', 'Dalgalı Izgara'], ['spectrogram', 'Spektrogram'], ['geometry', '3B Geometri'],
        ['flowfield', 'Akış Alanı'], ['flock', 'Sürü'], ['voronoi', 'Voronoi'],
        ['truchet', 'Truchet'], ['moire', 'Moiré'], ['interference', 'Dalga Girişimi'],
        ['ropes', 'İpler'], ['galaxy', 'Galaksi'], ['dna', 'DNA Sarmalı'],
        ['isocity', 'İzometrik Şehir'], ['attractorfield', 'Çekici Alanı'],
        ['scope', 'Osiloskop (XY)'], ['goniometer', 'Gonyometre'], ['chromawheel', 'Kroma Çemberi'],
        ['feedback', 'Geri Besleme'], ['custom', 'Studio Preset'],
      ];
    }
    if (kind === 'sprites') return [['back', 'Arka Katman'], ['front', 'Ön Katman']];
    return [];
  }

  function layersPanel() {
    const el = P().el;
    const cfg = P().cfg();
    const nodes = [];
    const list = Array.isArray(cfg.layers) ? cfg.layers : (cfg.layers = []);
    const rerender = () => P().apply();

    if (!list.length) {
      // Katman listesi boşken sahne eski alanlardan sentezlenir. Kullanıcı
      // düzenlemek isterse o sentezi somutlaştırıyoruz — böylece mevcut
      // görünümünü kaybetmeden katmanlara geçiyor.
      nodes.push(
        el('div', { class: 'studio-note', text: 'Sahne şu anda Arkaplan ve Görselleştirici kartlarından sürülüyor. Katmanlara geçerseniz aynı görünüm katman listesi olarak açılır ve üzerine yenilerini ekleyebilirsiniz.' })
      );
      nodes.push(
        el('button', {
          class: 'btn primary', type: 'button', text: '⬗ Katmanlara Geç',
          onclick: () => {
            cfg.layers = window.SVLayers.synthesize(cfg);
            rerender();
          },
        })
      );
      return el('div', {}, nodes);
    }

    list.forEach((raw, i) => {
      const l = (list[i] = window.SVLayers.normalizeLayer(raw));
      const typeOpts = typeOptionsFor(l.kind);
      const typeLabel = (typeOpts.find(([v]) => v === l.type) || [null, l.type])[1];
      const title = (l.name || LAYER_KIND_LABELS.find(([k]) => k === l.kind)[1]) +
        (typeOpts.length ? ' · ' + typeLabel : '');

      const enable = el('input', {
        type: 'checkbox',
        onchange: (e) => { l.enabled = e.target.checked; rerender(); },
      });
      enable.checked = l.enabled !== false;
      const enableBox = el('label', { class: 'switch small', title: 'Katmanı aç/kapat' }, [enable, el('span', { class: 'track' })]);

      const kids = [itemHeader(list, i, title, rerender, enableBox)];

      if (typeOpts.length) {
        kids.push(miniSelect('Kaynak', typeOpts, () => l.type, (v) => { l.type = v; }, rerender));
      }
      if (l.type === 'custom') {
        const presets = window.SVPresets
          .byKind(l.kind === 'background' ? 'background' : 'visualizer')
          .filter((p) => p.engine === 'shader')
          .map((p) => [p.id, p.name]);
        if (presets.length) {
          kids.push(miniSelect('Studio Preseti', presets, () => l.presetId || presets[0][0], (v) => { l.presetId = v; }));
        } else {
          kids.push(el('div', { class: 'studio-note', text: 'Henüz Studio preseti yok.' }));
        }
      }

      if (l.kind !== 'logo') {
        kids.push(miniSelect('Karışım', BLEND_LABELS, () => l.blend, (v) => { l.blend = v; }));
      }
      kids.push(miniSlider('Saydamlık', () => l.opacity, (v) => { l.opacity = v; }, { min: 0, max: 1, step: 0.01, percent: true }));

      kids.push(
        foldable('Dönüşüm', () => [
          miniSlider('Ölçek', () => l.transform.scale, (v) => { l.transform.scale = v; }, { min: 0.2, max: 3, step: 0.01 }),
          miniSlider('Dönüş', () => l.transform.rotate, (v) => { l.transform.rotate = v; }, { min: -180, max: 180, step: 1, fmt: (v) => Math.round(v) + '°' }),
          miniSlider('Yatay Konum', () => l.transform.x, (v) => { l.transform.x = v; }, { min: -0.5, max: 0.5, step: 0.005, percent: true }),
          miniSlider('Dikey Konum', () => l.transform.y, (v) => { l.transform.y = v; }, { min: -0.5, max: 0.5, step: 0.005, percent: true }),
          miniToggle('Yatay Aynala', () => l.transform.flipX, (v) => { l.transform.flipX = v; }),
          miniToggle('Dikey Aynala', () => l.transform.flipY, (v) => { l.transform.flipY = v; }),
        ])
      );

      kids.push(
        foldable('Sese Tepki', () => [
          miniSelect('Bant', BAND_LABELS, () => l.audio.band, (v) => { l.audio.band = v; }),
          miniSlider('Ses → Saydamlık', () => l.audio.opacity, (v) => { l.audio.opacity = v; }, { min: 0, max: 1, step: 0.02, percent: true }),
          miniSlider('Ses → Ölçek', () => l.audio.scale, (v) => { l.audio.scale = v; }, { min: 0, max: 1, step: 0.02, percent: true }),
          miniSlider('Ses → Dönüş', () => l.audio.rotate, (v) => { l.audio.rotate = v; }, { min: 0, max: 1, step: 0.02, percent: true }),
        ])
      );

      nodes.push(el('div', { class: 'stack-item' }, kids));
    });

    // Ekleme menüsü
    const addRow = el('div', { class: 'add-row' });
    LAYER_KIND_LABELS.forEach(([kind, label]) => {
      addRow.appendChild(
        el('button', {
          class: 'btn ghost small', type: 'button', text: '＋ ' + label,
          onclick: () => {
            const opts = typeOptionsFor(kind);
            list.push(window.SVLayers.normalizeLayer({
              kind,
              name: label,
              type: opts.length ? opts[0][0] : 'back',
            }));
            rerender();
          },
        })
      );
    });
    nodes.push(addRow);

    nodes.push(
      el('button', {
        class: 'btn ghost small', type: 'button', text: '↺ Katmanları Sıfırla',
        title: 'Katman listesini boşaltır; sahne yeniden Arkaplan/Görselleştirici kartlarından sürülür',
        onclick: async () => {
          if (!(await P().confirm('Katman listesi boşaltılacak. Sahne yeniden Arkaplan ve Görselleştirici kartlarından sürülecek.', { danger: true, okText: 'Sıfırla' }))) return;
          cfg.layers = [];
          rerender();
        },
      })
    );

    return el('div', { class: 'layer-panel' }, nodes);
  }

  // ==========================================================================
  // EFEKT ZİNCİRİ
  // ==========================================================================
  function effectsPanel() {
    const el = P().el;
    const cfg = P().cfg();
    const FX = window.SVPostFX;
    const nodes = [];
    const list = Array.isArray(cfg.postfx) ? cfg.postfx : (cfg.postfx = []);
    const rerender = () => P().apply();

    if (!list.length) {
      nodes.push(el('div', { class: 'studio-note', text: 'Zincir boşken sahne doğrudan kompozit edilir; hiçbir ek maliyet yoktur. Efekt eklediğinizde sahne tek yüzeye birleştirilip GPU\'da işlenir ve efektler dışa aktarımda da aynı sırayla uygulanır.' }));
    }

    list.forEach((fx, i) => {
      const def = FX.EFFECTS[fx.type];
      if (!def) return;
      fx.params = fx.params || {};
      fx.audio = fx.audio || {};

      const enable = el('input', {
        type: 'checkbox',
        onchange: (e) => { fx.enabled = e.target.checked; rerender(); },
      });
      enable.checked = fx.enabled !== false;
      const enableBox = el('label', { class: 'switch small', title: 'Efekti aç/kapat' }, [enable, el('span', { class: 'track' })]);

      const kids = [itemHeader(list, i, (i + 1) + '. ' + def.label, rerender, enableBox)];

      for (const p of def.params) {
        if (fx.params[p.name] == null) fx.params[p.name] = p.default;
        kids.push(
          miniSlider(p.label, () => fx.params[p.name], (v) => { fx.params[p.name] = v; }, {
            min: p.min, max: p.max, step: p.step,
            fmt: (v) => (p.step >= 1 ? String(Math.round(v)) : (+v).toFixed(3)),
          })
        );
      }

      if (def.audio && def.audio.length) {
        kids.push(
          foldable('Sese Bağla', () => {
            const out = [miniSelect('Bant', BAND_LABELS, () => fx.audioBand || 'bass', (v) => { fx.audioBand = v; })];
            for (const name of def.audio) {
              const p = def.params.find((x) => x.name === name);
              if (!p) continue;
              out.push(
                miniSlider(p.label + ' ← ses', () => fx.audio[name] || 0, (v) => { fx.audio[name] = v; }, {
                  min: 0, max: 1, step: 0.02, percent: true,
                })
              );
            }
            return out;
          })
        );
      }

      nodes.push(el('div', { class: 'stack-item' }, kids));
    });

    const addSel = el('select', {
      class: 'p-in',
      onchange: (e) => {
        if (!e.target.value) return;
        list.push(FX.defaultChainEntry(e.target.value));
        rerender();
      },
    });
    addSel.appendChild(el('option', { value: '', text: '＋ Efekt ekle…' }));
    FX.EFFECT_IDS.forEach((id) => addSel.appendChild(el('option', { value: id, text: FX.EFFECTS[id].label })));
    nodes.push(P().row('Yeni Efekt', addSel));

    return el('div', { class: 'fx-panel' }, nodes);
  }

  // ==========================================================================
  // 3B GEOMETRİ
  // ==========================================================================
  const FAMILY_LABELS = [
    ['surface', 'Yüzey'],
    ['curve3d', 'Uzay Eğrisi'],
    ['curve2d', 'Düzlem Eğrisi'],
    ['attractor', 'Çekici'],
  ];
  const RENDER_LABELS = [['surface', 'Yüzey'], ['wireframe', 'Tel Kafes'], ['points', 'Nokta']];
  const DEFORM_LABELS = [['normal', 'Normal Yönünde'], ['radial', 'Işınsal'], ['vertical', 'Dikey'], ['collapse', 'Çökme']];
  const COLOR_LABELS = [['palette', 'Palet'], ['depth', 'Derinlik'], ['normal', 'Normal'], ['spectrum', 'Spektrum']];

  function geometryPanel() {
    const el = P().el;
    const cfg = P().cfg();
    const g = cfg.geometry;
    const nodes = [];
    const rerender = () => P().apply();

    nodes.push(
      P().segment('Aile', 'geometry.family', FAMILY_LABELS.map(([v, l]) => ({ value: v, label: l })), { rebuild: true })
    );

    const cat = window.SVFormulas.catalog().filter((e) => e.family === g.family);
    if (!cat.length) return el('div', { class: 'studio-note', text: 'Bu ailede formül yok.' });
    if (!cat.some((e) => e.key === g.formula)) {
      g.formula = cat[0].key;
      g.params = {};
    }
    nodes.push(
      miniSelect('Formül', cat.map((e) => [e.key, e.label]), () => g.formula, (v) => { g.formula = v; g.params = {}; }, rerender)
    );

    const active = cat.find((e) => e.key === g.formula);
    if (active) {
      // Formülün kendi parametreleri — tanımdan otomatik üretilir
      if (active.params.length) {
        g.params = g.params || {};
        for (const p of active.params) {
          if (g.params[p.name] == null) g.params[p.name] = p.default;
          nodes.push(
            miniSlider(p.label, () => g.params[p.name], (v) => { g.params[p.name] = v; }, {
              min: p.min, max: p.max, step: p.step,
              fmt: (v) => (p.step >= 1 ? String(Math.round(v)) : (+v).toFixed(3)),
            })
          );
        }
      }
    }

    nodes.push(P().segment('Çizim', 'geometry.render', RENDER_LABELS.map(([v, l]) => ({ value: v, label: l }))));
    nodes.push(P().slider('Çözünürlük', 'geometry.resolution', { min: 8, max: 200, step: 1, fmt: (v) => String(Math.round(v)) }));
    nodes.push(P().slider('Sese Bağlı Bozulma', 'geometry.deform', { min: 0, max: 1.5, step: 0.01 }));
    nodes.push(miniSelect('Bozulma Kipi', DEFORM_LABELS, () => g.deformMode, (v) => { g.deformMode = v; }));
    nodes.push(miniSelect('Renklendirme', COLOR_LABELS, () => g.colorMode, (v) => { g.colorMode = v; }));

    nodes.push(
      foldable('Kamera ve Görünüm', () => [
        P().slider('Dönüş Hızı', 'geometry.spin', { min: -2, max: 2, step: 0.01 }),
        P().slider('Eğim', 'geometry.tilt', { min: -1.5, max: 1.5, step: 0.01 }),
        P().slider('Yakınlaşma', 'geometry.zoom', { min: 0.2, max: 3, step: 0.02 }),
        P().slider('Bas → Kamera', 'geometry.cameraAudio', { min: 0, max: 1, step: 0.01, percent: true }),
        P().slider('Nokta Boyutu', 'geometry.pointSize', { min: 1, max: 12, step: 0.5 }),
        P().slider('Saydamlık', 'geometry.alpha', { min: 0.05, max: 1, step: 0.01, percent: true }),
      ])
    );

    if (g.family === 'attractor') {
      nodes.push(
        foldable('Çekici Ayarları', () => [
          P().slider('Nokta Sayısı', 'geometry.attractorPoints', { min: 1000, max: 200000, step: 1000, fmt: (v) => Math.round(v / 1000) + 'k' }),
          P().slider('İntegrasyon Adımı', 'geometry.attractorStep', { min: 0.0005, max: 0.02, step: 0.0005, fmt: (v) => (+v).toFixed(4) }),
        ])
      );
    }

    return el('div', { class: 'geo-panel' }, nodes);
  }

  // ==========================================================================
  // ART-NET / DMX
  // ==========================================================================
  const ARTNET_MODES = [
    ['palette', 'Sahne Paleti'],
    ['bands', 'Frekans Bantları'],
    ['spectrum', 'Kayan Spektrum'],
    ['single', 'Tek Renk'],
  ];

  let artnetState = { running: false, error: null, packets: 0 };
  let artnetWatch = false;

  function artnetPanel() {
    const el = P().el;
    const cfg = P().cfg();
    const a = cfg.artnet;
    const nodes = [];

    if (!artnetWatch) {
      artnetWatch = true;
      window.api.onArtnetStatus((s) => { artnetState = s; });
      window.api.artnetStatus().then((s) => { artnetState = s; }).catch(() => {});
    }

    const enable = el('input', {
      type: 'checkbox',
      onchange: async (e) => {
        a.enabled = e.target.checked;
        P().push(true);
        artnetState = await window.api.artnetSync();
        P().rerender();
      },
    });
    enable.checked = !!a.enabled;
    nodes.push(P().row('Art-Net Çıkışı', el('label', { class: 'switch' }, [enable, el('span', { class: 'track' })])));

    // Durum: parçalar ayrı düğümlerde (sayı içeren birleşik metin çevrilemez)
    const st = el('div', { class: 'studio-status ' + (artnetState.running ? 'ok' : artnetState.error ? 'err' : '') });
    if (artnetState.running) {
      st.appendChild(el('span', { text: '✓ ' }));
      st.appendChild(el('span', { text: 'Yayında' }));
      st.appendChild(el('span', { class: 'st-sep', text: ' · ' }));
      st.appendChild(el('span', { text: 'Evren' }));
      st.appendChild(el('span', { class: 'st-num', text: ' ' + artnetState.universe }));
      st.appendChild(el('span', { class: 'st-sep', text: ' · ' }));
      st.appendChild(el('span', { class: 'st-num', text: String(artnetState.packets || 0) + ' ' }));
      st.appendChild(el('span', { text: 'paket' }));
    } else if (artnetState.error) {
      st.appendChild(el('span', { text: '✕ ' + artnetState.error }));
    } else {
      st.appendChild(el('span', { text: 'Kapalı' }));
    }
    nodes.push(st);

    if (a.enabled) {
      nodes.push(
        P().row(
          'Hedef Adres',
          el('input', {
            class: 'p-in wide', type: 'text', value: a.host,
            onchange: async (e) => {
              a.host = (e.target.value || '255.255.255.255').trim().slice(0, 64);
              P().push(true);
              artnetState = await window.api.artnetSync();
            },
          })
        )
      );
      nodes.push(P().slider('Evren (Universe)', 'artnet.universe', { min: 0, max: 32, step: 1, fmt: (v) => String(Math.round(v)) }));
      nodes.push(P().slider('Başlangıç Kanalı', 'artnet.startChannel', { min: 1, max: 512, step: 1, fmt: (v) => String(Math.round(v)) }));
      nodes.push(P().slider('Aygıt Sayısı', 'artnet.fixtures', { min: 1, max: 64, step: 1, fmt: (v) => String(Math.round(v)) }));
      nodes.push(
        P().segment('Aygıt Kanalları', 'artnet.channelsPerFixture', [
          { value: 3, label: 'RGB' },
          { value: 4, label: 'RGBW' },
        ])
      );
      nodes.push(miniSelect('Renk Kaynağı', ARTNET_MODES, () => a.mode, (v) => { a.mode = v; }, () => P().rerender()));
      if (a.mode === 'single') nodes.push(P().color('Renk', 'artnet.color'));
      nodes.push(P().slider('Parlaklık', 'artnet.brightness', { min: 0, max: 1, step: 0.02, percent: true, noExtend: true }));
      nodes.push(P().slider('Gönderim Hızı', 'artnet.fps', { min: 1, max: 44, step: 1, fmt: (v) => Math.round(v) + ' Hz' }));
      nodes.push(
        el('div', { class: 'studio-note dim-hint', text: 'Varsayılan hedef yayın adresidir; ağdaki tüm Art-Net düğümleri paketi alır. Tek bir arayüze göndermek isterseniz onun IP adresini yazın. DMX 44 Hz üstünü zaten taşımaz, bu yüzden gönderim hızı orada sınırlıdır.' })
      );
    } else {
      nodes.push(
        el('div', { class: 'studio-note', text: 'Sahne renklerini standart DMX protokolüyle (Art-Net) ışık konsollarına, DMX arayüzlerine ve QLC+ gibi yazılımlara yollar. Windows Dynamic Lighting\'in yerine geçmez; o tüketici aygıtlarını, bu sahne ışıklarını sürer.' })
      );
    }

    return el('div', { class: 'artnet-panel' }, nodes);
  }

  window.SVScenePanels = {
    layersPanel, effectsPanel, geometryPanel, artnetPanel,
    // Ortak satır üreticileri — diğer paneller de aynı görünümü kullansın
    miniSlider, miniSelect, miniToggle, foldable, itemHeader, moveItem,
  };
})();
