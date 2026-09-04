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

  /* Sıra/sil düğmelerinden oluşan başlık çubuğu.

     `reverse`, listenin ekranda ters sırada gösterildiği yerler içindir
     (katmanlar). Orada "yukarı", dizide GERİYE değil İLERİYE gitmek demektir;
     bayrak olmadan oklar kullanıcının gördüğünün tersine çalışırdı. */
  function itemHeader(list, i, title, onChange, extra, reverse) {
    const el = P().el;
    const up = reverse ? 1 : -1;
    const kids = [
      el('button', {
        class: 'btn ghost tiny', type: 'button', text: '▲', title: 'Yukarı taşı',
        onclick: () => { if (moveItem(list, i, up)) onChange(); },
      }),
      el('button', {
        class: 'btn ghost tiny', type: 'button', text: '▼', title: 'Aşağı taşı',
        onclick: () => { if (moveItem(list, i, -up)) onChange(); },
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

  function miniColor(label, get, set) {
    const el = P().el;
    const inp = el('input', {
      type: 'color',
      value: get() || '#ff0055',
      oninput: (e) => { set(e.target.value); P().push(false); },
    });
    return P().row(label, inp);
  }

  const foldStates = {};

  // Katlanır bölüm (dönüşüm / ses gibi ikincil ayarlar için)
  function foldable(title, buildKids, key) {
    const k = key || title;
    const el = P().el;
    const body = el('div', { class: 'fold-body' });
    let open = !!foldStates[k];
    const head = el('button', {
      class: 'fold-head', type: 'button', text: (open ? '▾ ' : '▸ ') + title,
      onclick: () => {
        open = !open;
        foldStates[k] = open;
        head.textContent = (open ? '▾ ' : '▸ ') + title;
        body.classList.toggle('open', open);
        if (open && !body.childElementCount) buildKids().forEach((n) => n && body.appendChild(n));
      },
    });
    if (open) {
      body.classList.add('open');
      buildKids().forEach((n) => n && body.appendChild(n));
    }
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

  const MASK_LABELS = [
    ['none', 'Yok'], ['rect', 'Dikdörtgen'], ['ellipse', 'Elips'],
    ['linear', 'Doğrusal Gradyan'], ['radial', 'Işınsal Gradyan'], ['layer', 'Başka Katman'],
  ];

  /* Katman panosu. Sahneler arasında katman taşımanın yolu bu; oturum
     boyunca bellekte durur, ayar dosyasına yazılmaz. */
  let clipboard = null;

  // Katman türüne göre seçilebilir mod listesi
  function typeOptionsFor(kind) {
    if (kind === 'background') {
      return [
        ['gradient', 'Akışkan Gradyan'], ['ink', 'Mürekkep'], ['nebula', 'Bulutsu'],
        ['waves', 'Dalga Katmanları'], ['aurora', 'Kutup Işıkları'], ['grid', 'Retro Izgara'],
        ['hexgrid', 'Petek Izgara'], ['mosaic', 'Mozaik'], ['corridor', 'Koridor'],
        ['spiral', 'Sarmal'], ['rings', 'Nabız Halkaları'], ['network', 'Ağ'],
        ['starfield', 'Yıldız Alanı'], ['snow', 'Kar / Kor'], ['bokeh', 'Işık Parçacıkları'],
        ['rain', 'Dijital Yağmur'], ['city', 'Şehir'],
        ['liquid', 'Sıvı Metal'], ['plasma', 'Plazma'], ['caustics', 'Su Yüzeyi'],
        ['ribbons', 'Şeritler'], ['contours', 'Eşyükselti'], ['wavefield', 'Dalga Alanı'],
        ['embers', 'Kıvılcım'], ['sand', 'Kum'], ['stained', 'Vitray'],
        ['circuit', 'Devre Kartı'], ['prism', 'Prizma'], ['globe', 'Küre Ağı'],
        ['wireframe', 'Tel Tüneli'], ['hexpulse', 'Petek Nabzı'],
        ['custom', 'Studio Preset'], ['solid', 'Düz Renk'],
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
        ['text', 'Metin / Şarkı Sözü'], ['nowplaying', 'Çalan Parça'],
        ['milkdrop', 'MilkDrop'], ['feedback', 'Geri Besleme'], ['custom', 'Studio Preset'],
      ];
    }
    if (kind === 'sprites') return [['back', 'Arka Katman'], ['front', 'Ön Katman']];
    return [];
  }

  function pickImage(cb) {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'image/*';
    input.style.display = 'none';
    input.addEventListener('change', () => {
      const file = input.files && input.files[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = () => cb(reader.result, file.name);
      reader.readAsDataURL(file);
    });
    document.body.appendChild(input);
    input.click();
    setTimeout(() => input.remove(), 1000);
  }

  function pickVideoFile(cb) {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'video/*';
    input.style.display = 'none';
    input.addEventListener('change', () => {
      const file = input.files && input.files[0];
      if (!file) return;
      const url = URL.createObjectURL(file);
      cb(url, file.name);
    });
    document.body.appendChild(input);
    input.click();
    setTimeout(() => input.remove(), 1000);
  }

  const BG_MODE_CONTROLS = {
    starfield: [
      ['stars', 'Yıldız Sayısı', 50, 2000, 25],
      ['speed', 'Hız', 0.1, 5, 0.05],
      ['colorMode', 'Renk Çeşitliliği', 0, 1, 0.02, true],
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

  /* Bir katmanın kendi kaynağına ait ayarlar.

     Her katman eklenen modun (Barlar, Dalga, Çember, Gradyan vb.) kendine
     has ayarlarını l.settings içinde benzersiz ve bağımsız olarak tutar. */
  function layerOwnSettings(l, rerender) {
    const el = P().el;
    const cfg = P().cfg();
    const out = [];

    if (l.kind === 'media') {
      const m = (cfg.media = cfg.media || {});
      out.push(miniSelect('Medya Kaynağı', [['webcam', 'Web Kamerası'], ['file', 'Video Dosyası']],
        () => m.source || 'webcam', (v) => { m.source = v; }, rerender));

      if ((m.source || 'webcam') === 'file') {
        // Seçili dosyanın adı ve küçük bir ön izlemesi
        const info = el('div', { class: 'row' }, [
          el('label', { class: 'lbl', text: 'Dosya' }),
          el('span', { class: 'dim-hint', text: m.file ? (m.fileName || 'seçildi') : 'seçilmedi' }),
        ]);
        out.push(el('div', { class: 'ctrl' }, [info]));
        if (m.file) {
          const prev = el('video', { class: 'layer-preview', muted: true, loop: true, autoplay: true, playsinline: true });
          prev.muted = true;
          prev.src = m.file;
          prev.play().catch(() => { /* ön izleme oynatılamazsa satır yine de dursun */ });
          out.push(prev);
        }
        out.push(el('div', { class: 'row' }, [
          el('button', {
            class: 'btn small', type: 'button', text: m.file ? '🎞 Videoyu Değiştir' : '🎞 Video Seç',
            onclick: async () => {
              if (window.api && window.api.pickVideo) {
                const r = await window.api.pickVideo();
                if (!r) return;
                m.file = r.url;
                m.fileName = r.name;
                m.enabled = true;
                P().push(true);
                rerender();
              } else {
                pickVideoFile((url, name) => {
                  m.file = url;
                  m.fileName = name;
                  m.enabled = true;
                  P().push(true);
                  rerender();
                });
              }
            },
          }),
          m.file ? el('button', {
            class: 'btn ghost small danger', type: 'button', text: 'Kaldır',
            onclick: () => {
              m.file = '';
              m.fileName = '';
              P().push(true);
              rerender();
            },
          }) : null,
        ].filter(Boolean)));
        out.push(miniToggle('Döngüde Oynat', () => m.loop !== false, (v) => { m.loop = v; }));
      }
      out.push(miniSelect('Sığdırma', [['cover', 'Kapla'], ['contain', 'Sığdır'], ['stretch', 'Ger']],
        () => m.fit || 'cover', (v) => { m.fit = v; }));
      out.push(miniToggle('Aynala', () => !!m.mirror, (v) => { m.mirror = v; }));
      if (!m.enabled) {
        out.push(el('div', { class: 'studio-note dim-hint', text: 'Medya kapalı. Kaynak seçilince açılır.' }));
      }
      return out;
    }

    if (l.kind === 'logo') {
      l.settings = l.settings || {};
      const lg = (l.settings.logo = l.settings.logo || (l.id === 'ly_logo' && cfg.logo ? Object.assign({}, cfg.logo) : { enabled: true, src: (cfg.logo && cfg.logo.src) || '', scale: 0.22, pulse: 0.3, opacity: 1, glow: 0, x: 0.5, y: 0.5 }));
      const getL = (k, def) => lg[k] !== undefined ? lg[k] : (cfg.logo && cfg.logo[k] !== undefined ? cfg.logo[k] : def);
      const setL = (k, val) => { lg[k] = val; };

      const info = el('div', { class: 'row' }, [
        el('label', { class: 'lbl', text: 'Logo Görseli' }),
        el('span', { class: 'dim-hint', text: lg.src ? 'seçildi' : 'seçilmedi' }),
      ]);
      out.push(el('div', { class: 'ctrl' }, [info]));
      if (lg.src) out.push(el('img', { class: 'layer-preview', src: lg.src, alt: '' }));
      out.push(el('div', { class: 'row' }, [
        el('button', {
          class: 'btn small', type: 'button', text: lg.src ? '🖼 Logoyu Değiştir' : '🖼 Logo Seç',
          onclick: () => {
            pickImage((dataUrl) => {
              lg.src = dataUrl;
              lg.enabled = true;
              if (l.id === 'ly_logo' && cfg.logo) cfg.logo.src = dataUrl;
              P().push(true);
              rerender();
            });
          },
        }),
        lg.src ? el('button', {
          class: 'btn ghost small danger', type: 'button', text: 'Kaldır',
          onclick: () => {
            lg.src = '';
            if (l.id === 'ly_logo' && cfg.logo) cfg.logo.src = '';
            P().push(true);
            rerender();
          },
        }) : null,
      ].filter(Boolean)));
      out.push(miniSlider('Yatay Konum (X)', () => getL('x', 0.5), (v) => setL('x', v), { min: 0, max: 1, step: 0.01, percent: true }));
      out.push(miniSlider('Dikey Konum (Y)', () => getL('y', 0.5), (v) => setL('y', v), { min: 0, max: 1, step: 0.01, percent: true }));
      out.push(miniSlider('Boyut', () => getL('scale', 0.22), (v) => setL('scale', v), { min: 0.05, max: 0.9, step: 0.01, percent: true }));
      out.push(miniSlider('Nabız', () => getL('pulse', 0.3), (v) => setL('pulse', v), { min: 0, max: 1, step: 0.01, percent: true }));
      out.push(miniSlider('Parlama (Glow)', () => getL('glow', 0), (v) => setL('glow', v), { min: 0, max: 1, step: 0.02, percent: true }));
      out.push(miniSlider('Saydamlık', () => getL('opacity', 1), (v) => setL('opacity', v), { min: 0, max: 1, step: 0.02, percent: true }));
      return out;
    }

    if (l.kind === 'sprites') {
      const imgs = (cfg.images = cfg.images || { enabled: true, items: [] });
      if (!Array.isArray(imgs.items)) imgs.items = [];
      const items = imgs.items;

      const imgList = el('div', { class: 'ctrl' });
      if (!items.length) {
        imgList.appendChild(el('div', { class: 'studio-note dim-hint', text: 'Henüz görsel nesne eklenmedi. Aşağıdaki düğmeyle bir görsel seçin.' }));
      }
      items.forEach((it, idx) => {
        const thumb = it.src ? el('img', { class: 'layer-preview', src: it.src, style: 'max-height: 48px; width: auto;' }) : null;
        const nameInput = el('input', {
          class: 'p-in', type: 'text', value: it.name || ('Görsel ' + (idx + 1)),
          onchange: (e) => { it.name = e.target.value.trim() || 'Görsel'; P().push(true); },
        });
        const repBtn = el('button', {
          class: 'btn ghost tiny', type: 'button', text: '🖼 Değiştir',
          onclick: () => {
            pickImage((dataUrl) => {
              it.src = dataUrl;
              P().push(true);
              rerender();
            });
          },
        });
        const delBtn = el('button', {
          class: 'btn ghost tiny danger', type: 'button', text: '🗑 Sil',
          onclick: () => {
            imgs.items.splice(idx, 1);
            P().push(true);
            rerender();
          },
        });
        imgList.appendChild(el('div', { class: 'img-head', style: 'margin-bottom: 6px;' }, [
          thumb,
          el('div', { class: 'img-headmain' }, [nameInput, el('div', { class: 'up-actions' }, [repBtn, delBtn])]),
        ]));
      });
      out.push(imgList);

      out.push(el('button', {
        class: 'btn small', type: 'button', text: '➕ Görsel Ekle',
        onclick: () => {
          pickImage((dataUrl, fileName) => {
            imgs.items.push(window.SV.imageItem({ src: dataUrl, name: fileName || ('Görsel ' + (imgs.items.length + 1)) }));
            imgs.enabled = true;
            P().push(true);
            rerender();
          });
        },
      }));
      return out;
    }

    if (l.kind === 'visualizer' && l.type === 'text') {
      const txt = (l.settings && l.settings.text) ? l.settings.text : (l.settings = l.settings || {}, l.settings.text = l.settings.text || Object.assign({}, cfg.text || window.SV.defaultConfig().text));
      txt.enabled = true;
      const src = txt.source || 'static';

      out.push(miniSelect('Metin Kaynağı', [['static', 'Sabit Metin'], ['now', 'Çalan Parça'], ['lyrics', 'Şarkı Sözü (LRC / SRT)']],
        () => src, (v) => { txt.source = v; if (cfg.text) cfg.text.source = v; }, rerender));

      if (src === 'static') {
        const area = el('textarea', {
          class: 'p-in txt-area', rows: 2, value: txt.content || '',
          oninput: (e) => {
            txt.content = e.target.value;
            if (cfg.text) cfg.text.content = e.target.value;
            P().push(false);
          },
        });
        out.push(el('div', { class: 'ctrl' }, [el('label', { class: 'lbl', text: 'Yazı Metni' }), area]));
        out.push(miniToggle('Kayan Yazı', () => !!txt.marquee, (v) => { txt.marquee = v; }, rerender));
        if (txt.marquee) {
          out.push(miniSlider('Kayma Hızı', () => txt.marqueeSpeed || 0.12, (v) => { txt.marqueeSpeed = v; }, { min: 0.02, max: 0.6, step: 0.01 }));
        }
      } else if (src === 'now') {
        const titleVal = txt.field === 'title' ? (txt.content || '') : ((txt.nowPlaying && txt.nowPlaying.title) || (cfg.text && cfg.text.nowPlaying && cfg.text.nowPlaying.title) || (txt.content || ''));
        const artistVal = txt.field === 'artist' ? (txt.content || '') : ((txt.nowPlaying && txt.nowPlaying.artist) || (cfg.text && cfg.text.nowPlaying && cfg.text.nowPlaying.artist) || '');

        if (txt.field === 'title') {
          out.push(P().row('Parça Adı', el('input', {
            class: 'p-in', type: 'text', value: titleVal,
            oninput: (e) => {
              txt.content = e.target.value;
              txt.nowPlaying = txt.nowPlaying || {};
              txt.nowPlaying.title = e.target.value;
              cfg.text = cfg.text || {};
              cfg.text.nowPlaying = cfg.text.nowPlaying || {};
              cfg.text.nowPlaying.title = e.target.value;
              P().push(false);
            },
          })));
        } else if (txt.field === 'artist') {
          out.push(P().row('Sanatçı', el('input', {
            class: 'p-in', type: 'text', value: artistVal,
            oninput: (e) => {
              txt.content = e.target.value;
              txt.nowPlaying = txt.nowPlaying || {};
              txt.nowPlaying.artist = e.target.value;
              cfg.text = cfg.text || {};
              cfg.text.nowPlaying = cfg.text.nowPlaying || {};
              cfg.text.nowPlaying.artist = e.target.value;
              P().push(false);
            },
          })));
        } else {
          out.push(P().row('Parça Adı', el('input', {
            class: 'p-in', type: 'text', value: titleVal,
            oninput: (e) => {
              txt.nowPlaying = txt.nowPlaying || {};
              txt.nowPlaying.title = e.target.value;
              cfg.text = cfg.text || {};
              cfg.text.nowPlaying = cfg.text.nowPlaying || {};
              cfg.text.nowPlaying.title = e.target.value;
              P().push(false);
            },
          })));
          out.push(P().row('Sanatçı', el('input', {
            class: 'p-in', type: 'text', value: artistVal,
            oninput: (e) => {
              txt.nowPlaying = txt.nowPlaying || {};
              txt.nowPlaying.artist = e.target.value;
              cfg.text = cfg.text || {};
              cfg.text.nowPlaying = cfg.text.nowPlaying || {};
              cfg.text.nowPlaying.artist = e.target.value;
              P().push(false);
            },
          })));
        }
      } else {
        const doc = txt.lyricsSource && window.SVLyrics ? window.SVLyrics.parse(txt.lyricsSource) : null;
        const info = doc
          ? doc.lines.length + ' satır · ' + doc.format.toUpperCase()
          : 'yüklü dosya yok';
        out.push(P().row('Dosya', el('span', { class: 'txt-info', text: (txt.lyricsName || '') + ' ' + info })));
        out.push(el('div', { class: 'row' }, [
          el('button', {
            class: 'btn small', type: 'button', text: '📂 Söz Dosyası Yükle',
            onclick: async () => {
              if (!window.api || !window.api.importShaderText) { P().toast('İçe aktarma kullanılamıyor.'); return; }
              const r = await window.api.importShaderText();
              if (!r || !r.ok) return;
              txt.lyricsSource = r.text;
              txt.lyricsName = r.name || '';
              if (cfg.text) { cfg.text.lyricsSource = r.text; cfg.text.lyricsName = r.name || ''; }
              const d = window.SVLyrics ? window.SVLyrics.parse(r.text) : null;
              rerender();
              P().toast(d ? (d.lines.length + ' satır okundu') : 'Yüklendi.');
            },
          }),
          el('button', {
            class: 'btn ghost small', type: 'button', text: 'Temizle',
            onclick: () => {
              txt.lyricsSource = '';
              txt.lyricsName = '';
              if (cfg.text) { cfg.text.lyricsSource = ''; cfg.text.lyricsName = ''; }
              rerender();
            },
          }),
        ]));
      }

      out.push(miniSlider('Yazı Boyutu', () => txt.size == null ? 0.08 : txt.size, (v) => { txt.size = v; }, { min: 0.01, max: 0.3, step: 0.005 }));
      out.push(miniSelect('Hizalama', [['left', 'Sola'], ['center', 'Ortaya'], ['right', 'Sağa']], () => txt.align || 'center', (v) => { txt.align = v; }));
      return out;
    }

    if (l.kind === 'visualizer' && l.type !== 'none' && l.type !== 'custom') {
      l.settings = l.settings || {};
      const vs = (l.settings.visualizer = l.settings.visualizer || {});
      const getV = (k, def) => vs[k] !== undefined ? vs[k] : (cfg.visualizer && cfg.visualizer[k] !== undefined ? cfg.visualizer[k] : def);
      const setV = (k, val) => { vs[k] = val; };

      // Gökkuşağı / Renk
      out.push(miniToggle('Gökkuşağı', () => getV('rainbow', true) !== false, (v) => { setV('rainbow', v); }, rerender));
      if (!getV('rainbow', true)) {
        out.push(miniColor('Renk', () => getV('color', '#ff2d3a'), (v) => setV('color', v)));
        if (['wave', 'ribbon', 'orb', 'tunnel', 'radialWave', 'terrain', 'mandala', 'wave3d', 'helix'].includes(l.type)) {
          out.push(miniColor('İkincil Renk', () => getV('color2', '#3aa6ff'), (v) => setV('color2', v)));
        }
      }
      out.push(miniSlider('Hassasiyet', () => getV('sensitivity', 1), (v) => setV('sensitivity', v), { min: 0.2, max: 3, step: 0.05 }));
      if (l.type !== 'spectrogram') {
        out.push(miniSlider('Parlama (Glow)', () => getV('glow', 0.2), (v) => setV('glow', v), { min: 0, max: 1, step: 0.02, percent: true }));
      }

      // Bar / Band ayarları
      const usesBands = ['bars', 'centerBars', 'circular', 'blocks', 'dots', 'spectrogram', 'starburst', 'terrain', 'orb', 'tunnel',
        'kaleido', 'helix', 'metaball', 'vortex', 'mandala', 'skyline', 'arcs', 'pinwheel', 'strings'];
      if (usesBands.includes(l.type)) {
        out.push(miniSlider('Bar Sayısı', () => getV('barCount', 64), (v) => setV('barCount', v), { min: 16, max: 160, step: 1 }));
      }
      const hasGap = ['bars', 'centerBars', 'circular', 'blocks', 'dots', 'starburst',
        'kaleido', 'metaball', 'skyline', 'arcs', 'strings', 'ripplegrid'];
      if (hasGap.includes(l.type)) {
        out.push(miniSlider('Bar Boşluğu', () => getV('gap', 0.3), (v) => setV('gap', v), { min: 0, max: 0.8, step: 0.02, percent: true }));
      }
      if (['bars', 'wave', 'radialWave'].includes(l.type)) {
        out.push(miniToggle('Ayna (Simetri)', () => !!getV('mirror', false), (v) => setV('mirror', v)));
      }

      if (l.type === 'bars') {
        out.push(miniSelect('Yerleşim', [['bottom', 'Alt'], ['center', 'Orta'], ['full', 'Tam']], () => getV('position', 'bottom'), (v) => setV('position', v)));
        out.push(miniSlider('Bar Genişliği', () => getV('barSpan', 1), (v) => setV('barSpan', v), { min: 0.1, max: 1, step: 0.01, percent: true }));
        out.push(miniSlider('Yatay Konum', () => getV('barCenterX', 0.5), (v) => setV('barCenterX', v), { min: 0, max: 1, step: 0.01, percent: true }));
        out.push(miniSlider('Bar Yüksekliği', () => getV('barHeight', 0.9), (v) => setV('barHeight', v), { min: 0.05, max: 1, step: 0.01, percent: true }));
        out.push(miniSlider('Taban Çizgisi', () => getV('baseline', 1), (v) => setV('baseline', v), { min: 0, max: 1, step: 0.01, percent: true }));
      }

      const isWaveMode = ['wave', 'ribbon', 'radialWave', 'terrain', 'orb',
        'helix', 'vortex', 'mandala', 'fireworks', 'lightning', 'lissajous', 'strings', 'wave3d', 'bubbles'];
      if (isWaveMode.includes(l.type)) {
        out.push(miniSlider('Çizgi Kalınlığı', () => getV('lineWidth', 2), (v) => setV('lineWidth', v), { min: 1, max: 12, step: 0.5 }));
        out.push(miniSlider('Genlik / Dolgu', () => getV('thickness', 0.5), (v) => setV('thickness', v), { min: 0.1, max: 1, step: 0.02, percent: true }));
      }

      return out;
    }

    if (l.kind === 'background') {
      l.settings = l.settings || {};
      const bg = (l.settings.background = l.settings.background || {});
      const getB = (k, def) => bg[k] !== undefined ? bg[k] : (cfg.background && cfg.background[k] !== undefined ? cfg.background[k] : def);
      const setB = (k, val) => { bg[k] = val; };

      if (l.type === 'solid') {
        out.push(miniColor('Düz Renk', () => getB('solidColor', '#0a0a12'), (v) => setB('solidColor', v)));
        return out;
      }

      if (l.type === 'gradient') {
        const gr = (bg.gradient = bg.gradient || {});
        const cfgGr = (cfg.background && cfg.background.gradient) || {};
        const getGr = (k, def) => gr[k] !== undefined ? gr[k] : (cfgGr[k] !== undefined ? cfgGr[k] : def);
        const setGr = (k, val) => { gr[k] = val; };

        out.push(miniSelect('Stil', [['soft', 'Yumuşak'], ['plasma', 'Plazma']], () => getGr('style', 'soft'), (v) => setGr('style', v)));
        out.push(miniSlider('Akış Hızı', () => getGr('speed', 1), (v) => setGr('speed', v), { min: 0, max: 2, step: 0.02 }));
        out.push(miniSlider('Ses Tepkisi', () => getGr('audioReactivity', 1), (v) => setGr('audioReactivity', v), { min: 0, max: 2, step: 0.02 }));
        out.push(miniSlider('Ölçek', () => getGr('scale', 1.5), (v) => setGr('scale', v), { min: 0.4, max: 3, step: 0.05 }));
        out.push(miniSlider('Bozulma (Warp)', () => getGr('warp', 1), (v) => setGr('warp', v), { min: 0, max: 2, step: 0.02 }));
        out.push(miniSlider('Parlaklık', () => getGr('brightness', 1), (v) => setGr('brightness', v), { min: 0.4, max: 1.6, step: 0.02 }));
        out.push(miniSlider('Vinyet', () => getGr('vignette', 0.3), (v) => setGr('vignette', v), { min: 0, max: 1, step: 0.02, percent: true }));
        return out;
      }

      if (BG_MODE_CONTROLS[l.type]) {
        const modeObj = (bg[l.type] = bg[l.type] || {});
        const cfgModeObj = (cfg.background && cfg.background[l.type]) || {};
        BG_MODE_CONTROLS[l.type].forEach(([key, label, min, max, step, percent]) => {
          const curVal = () => modeObj[key] !== undefined ? modeObj[key] : (cfgModeObj[key] !== undefined ? cfgModeObj[key] : min);
          out.push(miniSlider(label, curVal, (v) => { modeObj[key] = v; }, { min, max, step, percent }));
        });
        return out;
      }

      return out;
    }

    return out;
  }

  function layersPanel() {
    const el = P().el;
    const cfg = P().cfg();
    const nodes = [];
    const list = Array.isArray(cfg.layers) ? cfg.layers : (cfg.layers = []);
    const rerender = () => P().apply();

    /* Yığın anahtarı.

       Kapalıyken katman listesi silinmez, yalnızca kullanılmaz: sahne
       Arkaplan ve Görselleştirici kartlarından sürülür. Böylece yalın
       deneyimle katmanlı deneyim arasında ayar kaybetmeden gidip gelinir. */
    if (!cfg.layerStack || typeof cfg.layerStack.enabled !== 'boolean') {
      cfg.layerStack = { enabled: !!list.length };
    }
    const on = cfg.layerStack.enabled;
    const stackSwitch = el('input', {
      type: 'checkbox',
      onchange: (e) => {
        cfg.layerStack.enabled = e.target.checked;
        if (e.target.checked && !list.length) cfg.layers = window.SVLayers.synthesize(cfg);
        P().push(true);
        rerender();
      },
    });
    stackSwitch.checked = on;
    nodes.push(P().row('Katman Yığınını Kullan', el('label', { class: 'switch' }, [stackSwitch, el('span', { class: 'track' })])));

    if (!on) {
      nodes.push(
        el('div', { class: 'studio-note', text: list.length
          ? 'Katman yığını kapalı. Sahne Arkaplan ve Görselleştirici kartlarından sürülüyor. Katman listeniz duruyor; anahtarı açtığınızda aynı düzenle geri gelir.'
          : 'Katman yığını kapalı. Sahne Arkaplan ve Görselleştirici kartlarından sürülüyor. Anahtarı açarsanız aynı görünüm katman listesi olarak açılır ve üzerine yenilerini ekleyebilirsiniz.' })
      );
      return el('div', {}, nodes);
    }

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
            cfg.layerStack.enabled = true;
            rerender();
          },
        })
      );
      return el('div', {}, nodes);
    }

    nodes.push(el('div', { class: 'studio-note dim-hint', text: 'Liste çizim sırasının tersinde: en üstteki katman görüntüde de en üstte.' }));

    for (let i = list.length - 1; i >= 0; i--) {
      const raw = list[i];
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

      /* Solo / sessiz / kilit üçlüsü.

         Üçü de bir kompozitörde beklenen ama farklı işler yapan davranışlar:
         solo diğerlerini geri alınabilir biçimde susturur, sessiz katmanı
         ayarlarını kaybetmeden gizler, kilit kazara düzenlemeyi engeller. */
      const flagBtn = (key, label, title, cls) => el('button', {
        class: 'btn ghost tiny flagbtn' + (l[key] ? ' on ' + cls : ''),
        type: 'button', text: label, title,
        onclick: () => { l[key] = !l[key]; rerender(); },
      });
      const flags = el('span', { class: 'layer-flags' }, [
        flagBtn('solo', 'S', 'Solo — yalnızca solo katmanlar çizilir', 'solo'),
        flagBtn('muted', 'M', 'Sessiz — katmanı ayarlarını kaybetmeden gizler', 'mute'),
        flagBtn('locked', '🔒', 'Kilit — kazara düzenlemeyi engeller', 'lock'),
        el('label', { class: 'switch small', title: 'Katmanı aç/kapat' }, [enable, el('span', { class: 'track' })]),
      ]);

      const kids = [itemHeader(list, i, title, rerender, flags, true)];

      if (l.locked) {
        kids.push(el('div', { class: 'studio-note dim-hint', text: 'Katman kilitli. Düzenlemek için kilidi açın.' }));
        nodes.push(el('div', { class: 'stack-item locked' }, kids));
        continue;
      }

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

      /* Katmanın kendi ayarları.

         Medya ve logo katmanları eskiden yalnızca bir satır başlıktan
         ibaretti; ayarları başka kartlarda duruyordu ve katmana bakan
         kullanıcı neyin çizildiğini göremiyordu. Artık kaynak buradan
         seçiliyor, seçili dosyanın adı ve küçük bir ön izlemesi burada
         görünüyor. */
      kids.push.apply(kids, layerOwnSettings(l, rerender));

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
        ], (l.id || i) + '_transform')
      );

      kids.push(
        foldable('Sese Tepki', () => [
          miniSelect('Bant', BAND_LABELS, () => l.audio.band, (v) => { l.audio.band = v; }),
          miniSlider('Ses → Saydamlık', () => l.audio.opacity, (v) => { l.audio.opacity = v; }, { min: 0, max: 1, step: 0.02, percent: true }),
          miniSlider('Ses → Ölçek', () => l.audio.scale, (v) => { l.audio.scale = v; }, { min: 0, max: 1, step: 0.02, percent: true }),
          miniSlider('Ses → Dönüş', () => l.audio.rotate, (v) => { l.audio.rotate = v; }, { min: 0, max: 1, step: 0.02, percent: true }),
        ], (l.id || i) + '_audio')
      );

      // ---- Maske ----
      kids.push(foldable('Maske', () => {
        l.mask = l.mask || { type: 'none' };
        const m = l.mask;
        const out = [miniSelect('Şekil', MASK_LABELS, () => m.type || 'none', (v) => { m.type = v; }, rerender)];
        if (m.type && m.type !== 'none') {
          if (m.type === 'layer') {
            const others = list.filter((x, j) => j !== i && x.id).map((x) => [x.id, x.name || x.kind]);
            out.push(others.length
              ? miniSelect('Kaynak Katman', others, () => m.from || others[0][0], (v) => { m.from = v; })
              : el('div', { class: 'studio-note', text: 'Maske için başka katman yok.' }));
          } else {
            out.push(miniSlider('Yatay', () => m.x == null ? 0.5 : m.x, (v) => { m.x = v; }, { min: -0.2, max: 1.2, step: 0.005, percent: true }));
            out.push(miniSlider('Dikey', () => m.y == null ? 0.5 : m.y, (v) => { m.y = v; }, { min: -0.2, max: 1.2, step: 0.005, percent: true }));
            out.push(miniSlider('Genişlik', () => m.w == null ? 0.6 : m.w, (v) => { m.w = v; }, { min: 0.02, max: 2, step: 0.01, percent: true }));
            out.push(miniSlider('Yükseklik', () => m.h == null ? 0.6 : m.h, (v) => { m.h = v; }, { min: 0.02, max: 2, step: 0.01, percent: true }));
            if (m.type === 'linear') {
              out.push(miniSlider('Açı', () => m.angle || 0, (v) => { m.angle = v; }, { min: 0, max: 1, step: 0.005 }));
            }
          }
          out.push(miniSlider('Yumuşaklık', () => m.feather == null ? 0.1 : m.feather, (v) => { m.feather = v; }, { min: 0, max: 1, step: 0.01, percent: true }));
          out.push(miniToggle('Tersine Çevir', () => !!m.invert, (v) => { m.invert = v; }));
        }
        out.push(el('div', { class: 'studio-note dim-hint', text: 'Maske katmanın kendi tuvaline uygulanır; dönüşümle birlikte hareket etmez ve karışım modundan bağımsızdır. Shader tabanlı katmanlarda (Studio, gradyan) 2B maske uygulanamaz.' }));
        return out;
      }, (l.id || i) + '_mask'));

      // ---- Katmana özel efekt zinciri ----
      kids.push(foldable('Katman Efektleri', () => {
        l.postfx = Array.isArray(l.postfx) ? l.postfx : [];
        const FX = window.SVPostFX;
        const out = [];
        l.postfx.forEach((f, fi) => {
          const def = FX && FX.EFFECTS[f.type];
          out.push(el('div', { class: 'row' }, [
            el('span', { class: 'lbl', text: (fi + 1) + '. ' + (def ? def.label : f.type) }),
            el('button', {
              class: 'btn ghost tiny danger', type: 'button', text: '✕',
              onclick: () => { l.postfx.splice(fi, 1); rerender(); },
            }),
          ]));
          if (def) {
            for (const p of def.params || []) {
              f.params = f.params || {};
              if (f.params[p.name] == null) f.params[p.name] = p.default;
              out.push(miniSlider(p.label, () => f.params[p.name], (v) => { f.params[p.name] = v; }, {
                min: p.min, max: p.max, step: p.step,
              }));
            }
          }
        });
        const sel = el('select', { class: 'p-in' });
        sel.appendChild(el('option', { value: '', text: '— efekt ekle —' }));
        if (FX) FX.EFFECT_IDS.forEach((id) => sel.appendChild(el('option', { value: id, text: FX.EFFECTS[id].label })));
        sel.onchange = (ev) => {
          const id = ev.target.value;
          if (!id) return;
          l.postfx.push(FX.defaultChainEntry(id));
          rerender();
        };
        out.push(P().row('Ekle', sel));
        out.push(el('div', { class: 'studio-note dim-hint', text: 'Bu zincir yalnızca bu katmana uygulanır; sahnenin geneline uygulanan Efekt Zinciri kartından bağımsızdır.' }));
        return out;
      }, (l.id || i) + '_fx'));

      // ---- Grup ve opaklık eğrisi ----
      kids.push(foldable('Grup ve Fader', () => [
        P().row('Grup', el('input', {
          class: 'p-in', type: 'text', value: l.group || '', placeholder: 'grup adı (boş = gruplanmamış)',
          oninput: (ev) => { l.group = ev.target.value; P().push(false); },
        })),
        miniSelect('Fader Eğrisi', [['linear', 'Doğrusal'], ['exp', 'Üstel'], ['log', 'Logaritmik']],
          () => l.opacityCurve || 'linear', (v) => { l.opacityCurve = v; }),
        el('div', { class: 'studio-note dim-hint', text: 'Aynı gruptaki katmanlar Katman Grupları kartındaki tek fader ile birlikte kısılır. Doğrusal bir fader görsel olarak doğrusal davranmaz; üstel eğri gerçek bir kısma hissi verir.' }),
      ], (l.id || i) + '_group'));

      // ---- Kopyala / çoğalt ----
      kids.push(el('div', { class: 'row' }, [
        el('button', {
          class: 'btn ghost tiny', type: 'button', text: '⧉ Çoğalt',
          onclick: () => {
            const copy = JSON.parse(JSON.stringify(l));
            copy.id = null;
            copy.name = (l.name || l.kind) + ' (kopya)';
            copy.solo = false;
            list.splice(i + 1, 0, window.SVLayers.normalizeLayer(copy));
            rerender();
          },
        }),
        el('button', {
          class: 'btn ghost tiny', type: 'button', text: '⧉ Kopyala',
          title: 'Katmanı panoya al; başka bir sahnede yapıştırılabilir',
          onclick: () => {
            clipboard = JSON.parse(JSON.stringify(l));
            P().toast('Katman kopyalandı.');
          },
        }),
      ]));

      nodes.push(el('div', { class: 'stack-item' }, kids));
    }

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
    if (clipboard) {
      addRow.appendChild(el('button', {
        class: 'btn ghost small', type: 'button', text: '📋 Yapıştır',
        onclick: () => {
          const copy = JSON.parse(JSON.stringify(clipboard));
          copy.id = null;
          copy.solo = false;
          list.push(window.SVLayers.normalizeLayer(copy));
          rerender();
        },
      }));
    }
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
    ['solid', 'Katı'],
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

    /* Katalog iki kaynaktan geliyor: parametrik formüller ve katı geometri
       ailesi. Panel ikisi arasında ayrım yapmaz. */
    const full = window.SVFormulas.catalog()
      .concat(window.SVSolids ? window.SVSolids.catalog() : []);
    const cat = full.filter((e) => e.family === g.family);
    if (!cat.length) return el('div', { class: 'studio-note', text: 'Bu ailede formül yok.' });
    if (!cat.some((e) => e.key === g.formula)) {
      g.formula = cat[0].key;
      g.params = {};
    }
    nodes.push(
      miniSelect('Formül', cat.map((e) => [e.key, e.label]), () => g.formula, (v) => { g.formula = v; g.params = {}; }, rerender)
    );

    const active = cat.find((e) => e.key === g.formula);
    if (g.family === 'solid') {
      nodes.push(el('div', { class: 'studio-note dim-hint', text: 'Katı geometri ağı bir kez kurulup GPU\'da kalır; sese bağlı bozulma vertex shader\'da yapılır. Nokta bulutu üreten şekillerde (IFS) çizim kipi otomatik olarak nokta olur.' }));
    }
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
