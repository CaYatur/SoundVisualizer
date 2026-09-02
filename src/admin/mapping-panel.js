'use strict';
/* Projeksiyon haritalama paneli.

   Her ekranın kendi çıkış tanımı var: köşeler, bükme ızgarası, kırpma, kenar
   harmanlama, renk düzeltme, maskeler ve hizalama deseni. Panel bir ekranı
   seçip onu düzenler.

   Düzenleme yüzeyi asıl kısım. Sayıları elle girmek sahada işe yaramaz;
   köşeyi tutup çekmek gerekir. Ama yalnızca sürüklemek de yetmez — bir
   projektörü hizalarken piksel piksel ilerlemek gerekir, o yüzden ok
   tuşlarıyla ince ayar ve sayısal giriş de var. */
(function () {
  const P = () => window.SVPanel;
  const SP = () => window.SVScenePanels;

  const PATTERN_LABELS = [
    ['none', 'Yok'],
    ['grid', 'Izgara'],
    ['cross', 'Artı ve Çember'],
    ['bars', 'Renk Barları'],
    ['circle', 'Odak Çemberleri'],
  ];

  const CORNER_NAMES = ['Sol Üst', 'Sağ Üst', 'Sağ Alt', 'Sol Alt'];

  let editTarget = null;   // düzenlenen çıkış anahtarı
  let editMode = 'corners'; // 'corners' | 'mesh' | 'mask'
  let activeMask = 0;
  let displays = [];

  function outputsOf(cfg) {
    const m = cfg.mapping || (cfg.mapping = window.SV.defaultConfig().mapping);
    m.outputs = m.outputs || {};
    return m.outputs;
  }

  function ensureOutput(cfg, key) {
    const outs = outputsOf(cfg);
    if (!outs[key]) outs[key] = window.SVWarp.defaultOutput();
    const o = outs[key];
    // Eksik alanları tamamla (eski ayar dosyalarından gelenler için)
    const def = window.SVWarp.defaultOutput();
    for (const k of Object.keys(def)) if (o[k] == null) o[k] = def[k];
    o.enabled = true;
    return o;
  }

  // Izgarayı düz diziye çevir (JSON'a yazılabilsin diye)
  function meshToPlain(g) {
    return { cols: g.cols, rows: g.rows, pts: Array.from(g.pts) };
  }
  function meshFromPlain(m) {
    if (!m || !m.pts) return null;
    return { cols: m.cols, rows: m.rows, pts: Float32Array.from(m.pts) };
  }

  // ==========================================================================
  // Düzenleme yüzeyi
  // ==========================================================================
  function editor(out, onChange) {
    const el = P().el;
    const box = el('div', { class: 'map-edit' });
    const cv = el('canvas', { class: 'map-canvas' });
    box.appendChild(cv);

    const W = 460;
    const H = 280;
    cv.width = W;
    cv.height = H;

    // Kenar boşluğu: köşeler dışarı çekildiğinde tutamaklar görünür kalsın
    const PAD = 26;
    const toPx = (x, y) => [PAD + x * (W - PAD * 2), PAD + y * (H - PAD * 2)];
    const toNorm = (px, py) => [(px - PAD) / (W - PAD * 2), (py - PAD) / (H - PAD * 2)];

    let drag = null;
    let hover = null;

    function points() {
      if (editMode === 'corners') {
        return (out.corners || []).map((p, i) => ({ p, i, kind: 'corner' }));
      }
      if (editMode === 'mesh') {
        const g = meshFromPlain(out.mesh) || window.SVWarp.identityGrid(3, 3);
        const list = [];
        for (let j = 0; j < g.rows; j++) {
          for (let i = 0; i < g.cols; i++) {
            list.push({ p: [g.pts[(j * g.cols + i) * 2], g.pts[(j * g.cols + i) * 2 + 1]], i: j * g.cols + i, kind: 'mesh', grid: g });
          }
        }
        return list;
      }
      const mask = (out.masks || [])[activeMask];
      if (!mask) return [];
      return mask.map((p, i) => ({ p, i, kind: 'mask' }));
    }

    function draw() {
      const c = cv.getContext('2d');
      c.clearRect(0, 0, W, H);
      // Zemin
      c.fillStyle = 'rgba(255,255,255,0.03)';
      c.fillRect(0, 0, W, H);
      // Referans dikdörtgeni (haritalanmamış görüntü)
      const a = toPx(0, 0);
      const b = toPx(1, 1);
      c.strokeStyle = 'rgba(255,255,255,0.16)';
      c.setLineDash([4, 4]);
      c.lineWidth = 1;
      c.strokeRect(a[0], a[1], b[0] - a[0], b[1] - a[1]);
      c.setLineDash([]);

      // Haritalanmış dörtgen
      const corners = out.corners || [[0, 0], [1, 0], [1, 1], [0, 1]];
      c.beginPath();
      corners.forEach(([x, y], i) => {
        const q = toPx(x, y);
        if (i === 0) c.moveTo(q[0], q[1]); else c.lineTo(q[0], q[1]);
      });
      c.closePath();
      c.fillStyle = 'rgba(124,92,255,0.12)';
      c.fill();
      c.strokeStyle = 'rgba(124,92,255,0.85)';
      c.lineWidth = 1.5;
      c.stroke();

      // Bükme ızgarası
      if (editMode === 'mesh') {
        const g = meshFromPlain(out.mesh) || window.SVWarp.identityGrid(3, 3);
        c.strokeStyle = 'rgba(33,212,253,0.4)';
        c.lineWidth = 1;
        const STEPS = 12;
        for (let j = 0; j < g.rows; j++) {
          c.beginPath();
          for (let s = 0; s <= STEPS; s++) {
            const p = window.SVWarp.meshPoint(g, s / STEPS, g.rows === 1 ? 0 : j / (g.rows - 1));
            const q = toPx(p[0], p[1]);
            if (s === 0) c.moveTo(q[0], q[1]); else c.lineTo(q[0], q[1]);
          }
          c.stroke();
        }
        for (let i = 0; i < g.cols; i++) {
          c.beginPath();
          for (let s = 0; s <= STEPS; s++) {
            const p = window.SVWarp.meshPoint(g, g.cols === 1 ? 0 : i / (g.cols - 1), s / STEPS);
            const q = toPx(p[0], p[1]);
            if (s === 0) c.moveTo(q[0], q[1]); else c.lineTo(q[0], q[1]);
          }
          c.stroke();
        }
      }

      // Maskeler
      (out.masks || []).forEach((poly, mi) => {
        if (!poly || poly.length < 3) return;
        c.beginPath();
        poly.forEach(([x, y], i) => {
          const q = toPx(x, y);
          if (i === 0) c.moveTo(q[0], q[1]); else c.lineTo(q[0], q[1]);
        });
        c.closePath();
        c.fillStyle = mi === activeMask && editMode === 'mask' ? 'rgba(255,80,80,0.28)' : 'rgba(0,0,0,0.45)';
        c.fill();
        c.strokeStyle = 'rgba(255,120,120,0.8)';
        c.stroke();
      });

      // Tutamaklar
      points().forEach((pt, k) => {
        const q = toPx(pt.p[0], pt.p[1]);
        const on = hover === k || (drag && drag.k === k);
        c.beginPath();
        c.arc(q[0], q[1], on ? 7 : 5, 0, Math.PI * 2);
        c.fillStyle = on ? '#fff' : (pt.kind === 'mask' ? '#ff7070' : '#7c5cff');
        c.fill();
        c.strokeStyle = 'rgba(0,0,0,0.6)';
        c.lineWidth = 1;
        c.stroke();
        if (pt.kind === 'corner') {
          c.fillStyle = 'rgba(255,255,255,0.6)';
          c.font = '10px system-ui, sans-serif';
          c.textAlign = 'center';
          c.fillText(String(pt.i + 1), q[0], q[1] - 10);
        }
      });
    }

    function nearest(px, py) {
      const list = points();
      let best = -1;
      let bd = 16 * 16;
      list.forEach((pt, k) => {
        const q = toPx(pt.p[0], pt.p[1]);
        const d = (q[0] - px) * (q[0] - px) + (q[1] - py) * (q[1] - py);
        if (d < bd) { bd = d; best = k; }
      });
      return best;
    }

    function setPoint(k, nx, ny) {
      const list = points();
      const pt = list[k];
      if (!pt) return;
      const x = Math.max(-0.4, Math.min(1.4, nx));
      const y = Math.max(-0.4, Math.min(1.4, ny));
      if (pt.kind === 'corner') {
        out.corners[pt.i] = [x, y];
      } else if (pt.kind === 'mesh') {
        pt.grid.pts[pt.i * 2] = x;
        pt.grid.pts[pt.i * 2 + 1] = y;
        out.mesh = meshToPlain(pt.grid);
      } else {
        out.masks[activeMask][pt.i] = [x, y];
      }
    }

    cv.addEventListener('pointermove', (e) => {
      const r = cv.getBoundingClientRect();
      const px = ((e.clientX - r.left) / r.width) * W;
      const py = ((e.clientY - r.top) / r.height) * H;
      if (drag) {
        const [nx, ny] = toNorm(px, py);
        setPoint(drag.k, nx, ny);
        draw();
        onChange(false);
        return;
      }
      const h = nearest(px, py);
      if (h !== hover) { hover = h; draw(); }
    });
    cv.addEventListener('pointerdown', (e) => {
      const r = cv.getBoundingClientRect();
      const px = ((e.clientX - r.left) / r.width) * W;
      const py = ((e.clientY - r.top) / r.height) * H;
      const k = nearest(px, py);
      if (k < 0) return;
      drag = { k };
      cv.setPointerCapture(e.pointerId);
      cv.focus();
      draw();
    });
    const endDrag = () => { if (drag) { drag = null; draw(); onChange(true); } };
    cv.addEventListener('pointerup', endDrag);
    cv.addEventListener('pointercancel', endDrag);
    cv.addEventListener('pointerleave', () => { if (!drag && hover !== null) { hover = null; draw(); } });

    // Ok tuşlarıyla ince ayar: sahada bir projektörü hizalarken tek piksel
    // hassasiyeti sürüklemeyle elde edilemiyor
    cv.tabIndex = 0;
    cv.addEventListener('keydown', (e) => {
      if (hover == null || hover < 0) return;
      const step = e.shiftKey ? 0.02 : 0.002;
      let dx = 0;
      let dy = 0;
      if (e.key === 'ArrowLeft') dx = -step;
      else if (e.key === 'ArrowRight') dx = step;
      else if (e.key === 'ArrowUp') dy = -step;
      else if (e.key === 'ArrowDown') dy = step;
      else return;
      e.preventDefault();
      const pt = points()[hover];
      if (!pt) return;
      setPoint(hover, pt.p[0] + dx, pt.p[1] + dy);
      draw();
      onChange(false);
    });

    draw();
    return { node: box, redraw: draw };
  }

  // ==========================================================================
  function panel() {
    const el = P().el;
    const cfg = P().cfg();
    const m = cfg.mapping || (cfg.mapping = window.SV.defaultConfig().mapping);
    const rerender = () => P().apply();
    const nodes = [];

    nodes.push(SP().miniToggle('Haritalama Etkin', () => !!m.enabled, (v) => { m.enabled = v; }, rerender));
    if (!m.enabled) {
      nodes.push(el('div', {
        class: 'studio-note dim-hint',
        text: 'Haritalama kapalı: görüntü ekrana olduğu gibi gider ve bu aşamanın ölçülebilir bir maliyeti yoktur.',
      }));
      return el('div', { class: 'map-panel' }, nodes);
    }

    // Hangi çıkış düzenleniyor
    const opts = [{ value: 'default', label: 'Tüm Ekranlar (varsayılan)' }];
    for (const d of displays) {
      opts.push({ value: String(d.id), label: d.label || ('Ekran ' + d.id) });
    }
    if (!editTarget || !opts.some((o) => o.value === editTarget)) editTarget = 'default';
    nodes.push(SP().miniSelect('Düzenlenen Çıkış', opts.map((o) => [o.value, o.label]),
      () => editTarget, (v) => { editTarget = v; }, rerender));

    const out = ensureOutput(cfg, editTarget);

    // Düzenleme kipi
    nodes.push(SP().miniSelect('Düzenleme', [
      ['corners', 'Köşeler'], ['mesh', 'Bükme Izgarası'], ['mask', 'Maske'],
    ], () => editMode, (v) => { editMode = v; }, rerender));

    const ed = editor(out, (commit) => P().push(!!commit));
    nodes.push(ed.node);

    // Köşe sayıları
    if (editMode === 'corners') {
      const rows = [];
      for (let i = 0; i < 4; i++) {
        rows.push(el('div', { class: 'map-num' }, [
          el('span', { class: 'map-num-lbl', text: CORNER_NAMES[i] }),
          numInput(out.corners[i], 0, () => { ed.redraw(); P().push(false); }),
          numInput(out.corners[i], 1, () => { ed.redraw(); P().push(false); }),
        ]));
      }
      nodes.push(el('div', { class: 'map-nums' }, rows));
      nodes.push(el('div', { class: 'row' }, [
        el('button', {
          class: 'btn ghost tiny', type: 'button', text: 'Köşeleri Sıfırla',
          onclick: () => { out.corners = [[0, 0], [1, 0], [1, 1], [0, 1]]; rerender(); },
        }),
      ]));
    }

    // Izgara çözünürlüğü
    if (editMode === 'mesh') {
      const g = meshFromPlain(out.mesh) || window.SVWarp.identityGrid(3, 3);
      nodes.push(el('div', { class: 'row' }, [
        el('span', { class: 'lbl', text: 'Izgara' }),
        ...[[2, 2], [3, 3], [4, 4], [5, 5], [7, 7], [9, 9]].map(([c, r]) =>
          el('button', {
            class: 'btn ghost tiny' + (g.cols === c && g.rows === r ? ' active' : ''),
            type: 'button', text: c + '×' + r,
            onclick: () => {
              // Yeniden örnekleme mevcut şekli korur: 3x3 ile kaba hizalayıp
              // 7x7'ye geçmek yapılan işi silmez
              out.mesh = meshToPlain(window.SVWarp.resampleGrid(g, c, r));
              rerender();
            },
          })),
      ]));
      nodes.push(el('div', { class: 'row' }, [
        el('button', {
          class: 'btn ghost tiny', type: 'button', text: 'Izgarayı Sıfırla',
          onclick: () => { out.mesh = meshToPlain(window.SVWarp.identityGrid(g.cols, g.rows)); rerender(); },
        }),
      ]));
      nodes.push(el('div', { class: 'studio-note dim-hint', text: 'Bir noktayı sürükleyin; ok tuşlarıyla ince ayar yapın (Shift ile büyük adım). Eğri kontrol noktalarından geçer, yani nokta nereye giderse görüntü de oraya gider.' }));
    }

    // Maskeler
    if (editMode === 'mask') {
      out.masks = out.masks || [];
      const list = el('div', { class: 'map-masks' });
      out.masks.forEach((poly, i) => {
        list.appendChild(el('div', { class: 'row' }, [
          el('button', {
            class: 'btn ghost tiny' + (i === activeMask ? ' active' : ''),
            type: 'button', text: 'Maske ' + (i + 1),
            onclick: () => { activeMask = i; rerender(); },
          }),
          el('button', {
            class: 'btn ghost tiny danger', type: 'button', text: '✕',
            onclick: () => { out.masks.splice(i, 1); activeMask = 0; rerender(); },
          }),
        ]));
      });
      nodes.push(list);
      nodes.push(el('div', { class: 'row' }, [
        el('button', {
          class: 'btn', type: 'button', text: '+ Dörtgen Maske',
          onclick: () => {
            out.masks.push([[0.1, 0.1], [0.4, 0.1], [0.4, 0.4], [0.1, 0.4]]);
            activeMask = out.masks.length - 1;
            rerender();
          },
        }),
        el('button', {
          class: 'btn ghost', type: 'button', text: '+ Altıgen Maske',
          onclick: () => {
            const poly = [];
            for (let i = 0; i < 6; i++) {
              const a = (i / 6) * Math.PI * 2;
              poly.push([0.5 + Math.cos(a) * 0.2, 0.5 + Math.sin(a) * 0.2]);
            }
            out.masks.push(poly);
            activeMask = out.masks.length - 1;
            rerender();
          },
        }),
      ]));
      nodes.push(el('div', { class: 'studio-note dim-hint', text: 'Maskeler görüntünün dışına taşan alanı gizler. Çokgenin içi karartılır.' }));
    }

    // Kenar harmanlama
    nodes.push(SP().foldable('Kenar Harmanlama', () => {
      out.edges = out.edges || { left: 0, right: 0, top: 0, bottom: 0, gamma: 1 };
      const e = out.edges;
      const s = (label, key) => SP().miniSlider(label, () => e[key] || 0, (v) => { e[key] = v; }, {
        min: 0, max: 0.5, step: 0.005, percent: true,
      });
      return [
        s('Sol', 'left'), s('Sağ', 'right'), s('Üst', 'top'), s('Alt', 'bottom'),
        SP().miniSlider('Işık Eğrisi (gama)', () => (e.gamma == null ? 1 : e.gamma), (v) => { e.gamma = v; }, {
          min: 0.4, max: 3, step: 0.01, fmt: (v) => (+v).toFixed(2),
        }),
        el('div', { class: 'studio-note dim-hint', text: 'İki projektör üst üste bindiğinde her ikisinin de kendi kenarını karartması gerekir. Eğriler toplandığında tam ışık verecek biçimde tasarlandı; gama projektörün ışık eğrisine göre ayarlanır.' }),
      ];
    }));

    // Kırpma
    nodes.push(SP().foldable('Kırpma', () => {
      out.crop = out.crop || { x: 0, y: 0, w: 1, h: 1 };
      const c = out.crop;
      return [
        SP().miniSlider('X', () => c.x || 0, (v) => { c.x = v; }, { min: 0, max: 1, step: 0.005, percent: true }),
        SP().miniSlider('Y', () => c.y || 0, (v) => { c.y = v; }, { min: 0, max: 1, step: 0.005, percent: true }),
        SP().miniSlider('Genişlik', () => (c.w == null ? 1 : c.w), (v) => { c.w = v; }, { min: 0.05, max: 1, step: 0.005, percent: true }),
        SP().miniSlider('Yükseklik', () => (c.h == null ? 1 : c.h), (v) => { c.h = v; }, { min: 0.05, max: 1, step: 0.005, percent: true }),
        el('div', { class: 'studio-note dim-hint', text: 'Kompozisyonun bir bölgesini alıp bu çıkışa yayar. Tek bir sahneyi birden çok yüzeye bölmenin yolu budur.' }),
      ];
    }));

    // Renk
    nodes.push(SP().foldable('Renk Düzeltme', () => {
      out.color = out.color || { brightness: 1, contrast: 1, gamma: 1, r: 1, g: 1, b: 1 };
      const c = out.color;
      const s = (label, key, min, max) => SP().miniSlider(label, () => (c[key] == null ? 1 : c[key]), (v) => { c[key] = v; }, {
        min, max, step: 0.01, fmt: (v) => (+v).toFixed(2),
      });
      return [
        s('Parlaklık', 'brightness', 0, 2),
        s('Kontrast', 'contrast', 0, 3),
        s('Gama', 'gamma', 0.3, 3),
        s('Kırmızı', 'r', 0, 2),
        s('Yeşil', 'g', 0, 2),
        s('Mavi', 'b', 0, 2),
        el('div', { class: 'studio-note dim-hint', text: 'Yan yana duran iki projektörün rengi hiçbir zaman birebir aynı olmaz; bu ayarlar onları eşleştirmek içindir.' }),
      ];
    }));

    // Hizalama deseni
    nodes.push(SP().miniSelect('Hizalama Deseni', PATTERN_LABELS,
      () => out.testPattern || 'none', (v) => { out.testPattern = v; }));

    nodes.push(el('div', { class: 'row' }, [
      el('button', {
        class: 'btn ghost', type: 'button', text: 'Bu Çıkışı Sıfırla',
        onclick: async () => {
          if (!(await P().confirm('Bu çıkışın tüm haritalama ayarları sıfırlansın mı?'))) return;
          const outs = outputsOf(cfg);
          outs[editTarget] = window.SVWarp.defaultOutput();
          outs[editTarget].enabled = true;
          rerender();
        },
      }),
    ]));

    return el('div', { class: 'map-panel' }, nodes);
  }

  function numInput(pair, idx, onChange) {
    return P().el('input', {
      class: 'p-in tiny', type: 'number', step: '0.001',
      value: (+pair[idx]).toFixed(3),
      oninput: (e) => {
        const v = parseFloat(e.target.value);
        if (!isFinite(v)) return;
        pair[idx] = v;
        onChange();
      },
    });
  }

  function init() {
    if (!window.api || !window.api.getDisplays) return;
    window.api.getDisplays().then((list) => { displays = list || []; }).catch(() => {});
  }

  window.SVMappingPanel = { panel, init };
})();
