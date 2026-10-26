/*
 * SoundVisualizer — CaYaDev Ses Görselleştirici
 * Copyright (c) 2026 Çağan Turgut (CaYatur) — CaYaDev, https://cayadev.com
 * https://github.com/CaYatur/SoundVisualizer
 * SPDX-License-Identifier: MIT
 */
'use strict';
/* DÜZEN EDİTÖRÜ (#534).

   Canlı önizlemenin sahnesi büyük bir pencereye TAŞINIR (yeniden çizilmez):
   aynı katman kodu, aynı ayarlar, aynı tuvaller. Önizleme kendi kutusunun
   boyutunu izlediği için yüksek çözünürlükte çizmeye geçer; kapanınca
   yerine döner. Ayrı bir çizici yok, böylece editörde görülen ile çıkış
   arasında ikinci bir yol yok (#539).

   Öğeler (barlar, çalan parça kartı, metin, logo) çizicinin bildirdiği
   kutuyla gösterilir (SVPreview.stack().layoutBounds()). Sürükleme, ok
   tuşları ve sayısal alanlar konumu öğenin KENDİ parametrelerine yazar
   (src/shared/layout.js).

   Yakalama: karenin kenarları ve merkezi, güvenli alanlar (SMPTE ST 2046-1 /
   EBU R 95) ve diğer öğelerin kenar ve merkezleri. Alt basılıyken kapalı —
   zaman çizelgesindeki gibi. Sürüklemenin tek işaretçili karşılığı ok
   tuşları ve sayısal alanlar (WCAG 2.5.7). */
(function () {
  const P = () => window.SVPanel;
  const LY = () => window.SVLayout;
  const tr = (s) => (window.SVI18n && typeof window.SVI18n.t === 'function' ? window.SVI18n.t(s) : s);
  const SNAP_PX = 8;
  const NUDGE = 0.005;
  const ASPECTS = [['16:9', 16 / 9], ['9:16', 9 / 16], ['1:1', 1]];
  const KIND_NAMES = { bars: 'Barlar', nowplaying: 'Çalan Parça', text: 'Metin', logo: 'Logo' };

  let st = null; // açık editörün durumu

  function pref(key, def) {
    try { const v = localStorage.getItem('sv-layout-' + key); return v == null ? def : v; } catch (e) { return def; }
  }
  function setPref(key, v) {
    try { localStorage.setItem('sv-layout-' + key, String(v)); } catch (e) { /* özel pencere */ }
  }

  // Düzenlenebilir öğeler: önizlemenin katmanları, yapılandırmadaki karşılığıyla
  function elements() {
    const cfg = P().cfg();
    const stack = window.SVPreview && window.SVPreview.stack && window.SVPreview.stack();
    if (!stack || !Array.isArray(stack.entries)) return [];
    const on = LY().stackOn(cfg);
    const out = [];
    stack.entries.forEach((e) => {
      const live = e && e.layer;
      const kind = LY().kindOf(live);
      if (!kind || live.enabled === false || live.muted) return;
      // Katman yığınında yazılacak nesne yapılandırmadaki katman; yoksa genel bölüm
      const layer = on ? (cfg.layers || []).find((l) => l && l.id === live.id) : live;
      if (!layer) return;
      out.push({ id: live.id, kind, layer, name: live.name || tr(KIND_NAMES[kind]) });
    });
    return out;
  }

  function boxOf(el, bounds) {
    const b = bounds[el.id];
    if (b) return b;
    const a = st ? st.aspect : 16 / 9;
    return LY().fallbackBox(el.layer, P().cfg(), a);
  }

  function open(opener) {
    if (st) return;
    const stage = document.getElementById('previewStage');
    if (!stage || !window.SVLayout || !window.SVPreview) return;
    const el = P().el;
    const aspectKey = pref('aspect', '16:9');
    st = {
      opener: opener || null,
      stage,
      home: stage.parentNode,
      next: stage.nextSibling,
      aspectKey,
      aspect: (ASPECTS.find((a) => a[0] === aspectKey) || ASPECTS[0])[1],
      safe: pref('safe', '1') === '1',
      snap: pref('snap', '1') === '1',
      sel: null,
      drag: null,
      raf: 0,
      boxes: {},
    };

    const overlay = el('div', { class: 'lay-overlay' });
    const safeA = el('div', { class: 'lay-safe action', 'aria-hidden': 'true' });
    const safeT = el('div', { class: 'lay-safe title', 'aria-hidden': 'true' });
    const cv = el('div', { class: 'lay-center v', 'aria-hidden': 'true' });
    const ch = el('div', { class: 'lay-center h', 'aria-hidden': 'true' });
    const gx = el('div', { class: 'lay-guide x', 'aria-hidden': 'true' });
    const gy = el('div', { class: 'lay-guide y', 'aria-hidden': 'true' });
    // Yakalama çizgileri yalnız sürüklerken görünür
    gx.hidden = true;
    gy.hidden = true;
    overlay.append(safeA, safeT, cv, ch, gx, gy);
    st.overlay = overlay;
    st.guides = { gx, gy, safe: [safeA, safeT] };

    const stageWrap = el('div', { class: 'lay-stage-wrap' });
    const side = el('div', { class: 'lay-side' });
    st.side = side;

    const aspectBtns = ASPECTS.map(([k]) => el('button', {
      type: 'button', class: 'btn ghost small' + (k === st.aspectKey ? ' active' : ''), text: k,
      'aria-pressed': k === st.aspectKey ? 'true' : 'false',
      onclick: () => { setAspect(k); aspectBtns.forEach((b) => { const on = b.textContent === k; b.classList.toggle('active', on); b.setAttribute('aria-pressed', on ? 'true' : 'false'); }); },
    }));
    const toggle = (label, on, set) => {
      const box = el('input', { type: 'checkbox' });
      box.checked = on;
      box.addEventListener('change', () => set(box.checked));
      return el('label', { class: 'lay-toggle' }, [box, el('span', { text: label })]);
    };
    const head = el('div', { class: 'lay-head' }, [
      el('h3', { id: 'layTitle', text: 'Düzen Editörü' }),
      el('div', { class: 'lay-aspect', role: 'group', 'aria-label': 'Çıktı oranı' }, aspectBtns),
      toggle('Güvenli alanlar', st.safe, (v) => { st.safe = v; setPref('safe', v ? '1' : '0'); paintGuides(); }),
      toggle('Yakalama', st.snap, (v) => { st.snap = v; setPref('snap', v ? '1' : '0'); }),
      el('button', { type: 'button', class: 'btn small', icon: 'x', text: 'Kapat', onclick: close }),
    ]);

    const panel = el('div', { class: 'ask-panel lay-editor', role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': 'layTitle' }, [
      head,
      el('div', { class: 'lay-body' }, [stageWrap, side]),
    ]);
    const backdrop = el('div', { class: 'ask-backdrop lay-backdrop' }, [panel]);
    st.backdrop = backdrop;
    document.body.appendChild(backdrop);

    st.wrap = stageWrap;
    st.onResize = () => fit();
    window.addEventListener('resize', st.onResize);
    stageWrap.appendChild(stage);
    stage.classList.add('lay-stage');
    stage.appendChild(overlay);
    setAspect(st.aspectKey);
    st.panel = panel;
    st.onKey = (e) => {
      // Üstte başka bir pencere (onay) varsa tuşlar onun
      if (document.querySelector('.ask-backdrop:not(.lay-backdrop)')) return;
      if (e.key === 'Escape' && !st.drag) { e.preventDefault(); close(); return; }
      /* Kipli pencere: Tab arkadaki panele kaçmasın, içeride döner. */
      if (e.key === 'Tab') {
        const f = Array.from(st.panel.querySelectorAll('button, input, select, textarea, [tabindex]:not([tabindex="-1"])'))
          .filter((x) => !x.disabled && x.offsetParent !== null);
        if (!f.length) return;
        const first = f[0];
        const last = f[f.length - 1];
        const a = document.activeElement;
        if (e.shiftKey && (a === first || !st.panel.contains(a))) { e.preventDefault(); last.focus(); }
        else if (!e.shiftKey && (a === last || !st.panel.contains(a))) { e.preventDefault(); first.focus(); }
      }
    };
    document.addEventListener('keydown', st.onKey, true);
    renderSide();
    paintGuides();
    loop();
    const first = overlay.querySelector('.lay-box') || head.querySelector('button');
    if (first) first.focus();
  }

  function setAspect(k) {
    const a = ASPECTS.find((x) => x[0] === k) || ASPECTS[0];
    st.aspectKey = a[0];
    st.aspect = a[1];
    setPref('aspect', a[0]);
    st.stage.dataset.aspect = a[0];
    fit();
  }

  // Sahneyi alana oranı koruyarak sığdırır (9:16'da yükseklik sınırlar)
  function fit() {
    if (!st || !st.wrap) return;
    const r = st.wrap.getBoundingClientRect();
    const pad = 16;
    const W = Math.max(40, r.width - pad * 2);
    const H = Math.max(40, r.height - pad * 2);
    const w = Math.min(W, H * st.aspect);
    st.stage.style.width = Math.round(w) + 'px';
    st.stage.style.height = Math.round(w / st.aspect) + 'px';
  }

  function close() {
    if (!st) return;
    cancelAnimationFrame(st.raf);
    document.removeEventListener('keydown', st.onKey, true);
    const s = st;
    st = null;
    s.overlay.remove();
    s.stage.classList.remove('lay-stage');
    s.stage.style.width = '';
    s.stage.style.height = '';
    delete s.stage.dataset.aspect;
    window.removeEventListener('resize', s.onResize);
    if (s.next && s.next.parentNode === s.home) s.home.insertBefore(s.stage, s.next);
    else s.home.appendChild(s.stage);
    s.backdrop.remove();
    P().apply();
    if (s.opener && s.opener.focus) s.opener.focus();
  }

  function paintGuides() {
    if (!st) return;
    const L = LY();
    const set = (n, m) => { n.style.left = (m * 100) + '%'; n.style.top = (m * 100) + '%'; n.style.right = (m * 100) + '%'; n.style.bottom = (m * 100) + '%'; };
    set(st.guides.safe[0], L.SAFE.action);
    set(st.guides.safe[1], L.SAFE.title);
    st.guides.safe.forEach((n) => { n.hidden = !st.safe; });
  }

  // Kutuları çizicinin bildirdiği yere taşır (her karede: ses ve içerik değişiyor)
  function loop() {
    if (!st) return;
    const stack = window.SVPreview.stack();
    const bounds = stack && stack.layoutBounds ? stack.layoutBounds() : {};
    const els = elements();
    const seen = {};
    els.forEach((e) => {
      seen[e.id] = true;
      let b = st.boxes[e.id];
      if (!b) {
        b = P().el('button', {
          type: 'button', class: 'lay-box',
          'aria-label': e.name + ' — ' + tr('ok tuşlarıyla taşıyın'),
        }, [P().el('span', { class: 'lay-tag', text: e.name, 'data-user-text': '' })]);
        b.dataset.id = e.id;
        b.addEventListener('pointerdown', (ev) => startDrag(ev, e.id));
        b.addEventListener('keydown', (ev) => nudge(ev, e.id));
        b.addEventListener('focus', () => select(e.id));
        st.overlay.appendChild(b);
        st.boxes[e.id] = b;
      }
      const box = boxOf(e, bounds);
      if (box) {
        b.style.left = (box.x * 100) + '%';
        b.style.top = (box.y * 100) + '%';
        b.style.width = (box.w * 100) + '%';
        b.style.height = (box.h * 100) + '%';
      }
      b.classList.toggle('sel', st.sel === e.id);
    });
    Object.keys(st.boxes).forEach((id) => { if (!seen[id]) { st.boxes[id].remove(); delete st.boxes[id]; } });
    st.raf = requestAnimationFrame(loop);
  }

  function select(id) {
    if (!st || st.sel === id) return;
    st.sel = id;
    renderSide();
  }

  function find(id) { return elements().find((e) => e.id === id) || null; }

  function startDrag(ev, id) {
    if (ev.button !== 0) return;
    const e = find(id);
    if (!e) return;
    ev.preventDefault();
    // preventDefault odağı da engelliyor: odak seçilen kutuya geçsin
    if (ev.currentTarget && ev.currentTarget.focus) ev.currentTarget.focus({ preventScroll: true });
    select(id);
    const stack = window.SVPreview.stack();
    const bounds = stack.layoutBounds();
    const startBox = boxOf(e, bounds);
    if (!startBox) return;
    const cfg = P().cfg();
    const fields = LY().KINDS[e.kind].fields;
    const startVals = {};
    fields.forEach((f) => { startVals[f.key] = LY().getField(e.layer, cfg, f.key); });
    // Diğer öğelerin kutuları sürükleme başında sabitlenir (kendine yakalanmasın)
    const others = elements().filter((x) => x.id !== id).map((x) => boxOf(x, bounds)).filter(Boolean);
    const guides = LY().mergeGuides(LY().frameGuides(), LY().elementGuides(others));
    const rect = st.stage.getBoundingClientRect();
    st.drag = { id, e, startBox, startVals, guides, rect, x0: ev.clientX, y0: ev.clientY, moved: false };
    const target = ev.currentTarget;
    target.setPointerCapture(ev.pointerId);
    const move = (m) => {
      const d = st && st.drag;
      if (!d) return;
      const dx = (m.clientX - d.x0) / d.rect.width;
      const dy = (m.clientY - d.y0) / d.rect.height;
      let box = { x: d.startBox.x + dx, y: d.startBox.y + dy, w: d.startBox.w, h: d.startBox.h };
      let lx = null;
      let lyl = null;
      if (st.snap && !m.altKey) {
        const s = LY().snapBox(box, d.guides, SNAP_PX / d.rect.width, SNAP_PX / d.rect.height);
        box = s.box; lx = s.x; lyl = s.y;
      }
      applyMove(d.e, d.startVals, box.x - d.startBox.x, box.y - d.startBox.y);
      showGuide(lx, lyl);
      d.moved = true;
    };
    const up = () => {
      target.removeEventListener('pointermove', move);
      target.removeEventListener('pointerup', up);
      target.removeEventListener('pointercancel', up);
      const d = st && st.drag;
      if (st) st.drag = null;
      showGuide(null, null);
      if (d && d.moved) { P().push(true); renderSide(); }
    };
    target.addEventListener('pointermove', move);
    target.addEventListener('pointerup', up);
    target.addEventListener('pointercancel', up);
  }

  // Başlangıç değerlerine döner, toplam kaymayı uygular (birikme hatası yok)
  function applyMove(e, startVals, dx, dy) {
    const cfg = P().cfg();
    Object.keys(startVals).forEach((k) => LY().setField(e.layer, cfg, k, startVals[k]));
    LY().moveBy(e.layer, cfg, dx, dy);
    P().push(false);
  }

  function showGuide(lx, lyl) {
    if (!st) return;
    const { gx, gy } = st.guides;
    gx.hidden = !lx;
    gy.hidden = !lyl;
    if (lx) { gx.style.left = (lx.at * 100) + '%'; gx.dataset.kind = lx.kind; }
    if (lyl) { gy.style.top = (lyl.at * 100) + '%'; gy.dataset.kind = lyl.kind; }
  }

  function nudge(ev, id) {
    const keys = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] };
    const k = keys[ev.key];
    if (!k) return;
    const e = find(id);
    if (!e) return;
    ev.preventDefault();
    const step = ev.shiftKey ? NUDGE * 10 : NUDGE;
    LY().moveBy(e.layer, P().cfg(), k[0] * step, k[1] * step);
    P().push(false);
    renderSide();
  }

  /* DÜZEN DOSYASI (#538): yerleştirilebilir öğeler, kullanıcı içeriği
     olmadan (src/shared/layout.js exportLayout). */
  function effectiveLayers() {
    const cfg = P().cfg();
    if (LY().stackOn(cfg)) return cfg.layers || [];
    return window.SVLayers && window.SVLayers.resolve ? window.SVLayers.resolve(cfg) : [];
  }

  async function exportFile() {
    const data = LY().exportLayout(effectiveLayers(), P().cfg(), { aspect: st && st.aspectKey });
    if (!data.elements.length) { P().toast(tr('Dışa aktarılacak öğe yok.'), 'warn'); return; }
    /* Varsayılan katman adları ('Görselleştirici', 'Metin'…) Türkçe sabit;
       dışa aktarılan dosya arayüz diline uysun. Çeviri tablosunda olmayan
       (kullanıcının verdiği) ad olduğu gibi kalır. */
    data.elements.forEach((el) => {
      if (el.layer && typeof el.layer.name === 'string' && el.layer.name) el.layer.name = tr(el.layer.name);
    });
    await window.api.exportJson(tr('duzen.json'), data);
  }

  async function importFile() {
    const r = await window.api.importJson(tr('Düzeni İçe Aktar'));
    if (!r || !r.ok) { if (r && r.error) P().toast('İçe aktarılamadı: ' + r.error, 'err'); return; }
    const data = r.data;
    if (!data || data.type !== LY().LAYOUT_TYPE) { P().toast(tr('Bu bir düzen dosyası değil.'), 'err'); return; }
    const ok = await P().confirm(tr('Dosyadaki öğeler bu sahnede aynı türdeki öğelerin konumunu ve görünüşünü değiştirecek; eksik olanlar eklenecek. Logo görseliniz ve parça bilgileriniz değişmez.'), { okText: tr('Düzeni Uygula') });
    if (!ok) return;
    const cfg = P().cfg();
    if (!LY().stackOn(cfg) && window.SVLayers && window.SVLayers.setStackEnabled) window.SVLayers.setStackEnabled(cfg, true);
    const res = LY().importLayout(cfg, data, (spec) => (window.SVLayers ? window.SVLayers.normalizeLayer(spec) : spec));
    if (!res.ok) { P().toast('İçe aktarılamadı: ' + res.error, 'err'); return; }
    if (window.SVLayers && window.SVLayers.syncStackState) window.SVLayers.syncStackState(cfg);
    P().push(true);
    renderSide();
    P().toast(tr('Düzen uygulandı.'));
  }

  // Seçili öğenin sayısal alanları ve öğe listesi
  function renderSide() {
    if (!st) return;
    const el = P().el;
    const side = st.side;
    side.textContent = '';
    side.appendChild(el('div', { class: 'lay-file' }, [
      el('button', { type: 'button', class: 'btn ghost small', icon: 'export', text: 'Düzeni Dışa Aktar', onclick: exportFile }),
      el('button', { type: 'button', class: 'btn ghost small', icon: 'import', text: 'Düzeni İçe Aktar', onclick: importFile }),
    ]));
    const els = elements();
    if (!els.length) {
      side.appendChild(el('div', { class: 'studio-note dim-hint', text: 'Bu sahnede yerleştirilebilir öğe yok. Barlar, çalan parça kartı, metin ya da logo katmanı ekleyin.' }));
      return;
    }
    side.appendChild(el('div', { class: 'group-label', text: 'Öğeler' }));
    const list = el('div', { class: 'lay-list' }, els.map((e) => el('button', {
      type: 'button', class: 'btn ghost small' + (st.sel === e.id ? ' active' : ''), text: e.name,
      'data-user-text': '',
      'aria-pressed': st.sel === e.id ? 'true' : 'false',
      onclick: () => { select(e.id); const b = st.boxes[e.id]; if (b) b.focus(); },
    })));
    side.appendChild(list);
    const cur = st.sel && els.find((e) => e.id === st.sel);
    if (!cur) {
      side.appendChild(el('div', { class: 'studio-note dim-hint', text: 'Bir öğe seçin: önizlemede sürükleyin, ok tuşlarıyla taşıyın (Shift ile on kat) ya da değerleri yazın. Alt basılıyken yakalama kapanır.' }));
      return;
    }
    const cfg = P().cfg();
    side.appendChild(el('div', { class: 'group-label', text: cur.name }));
    LY().KINDS[cur.kind].fields.forEach((f) => {
      const inp = el('input', { type: 'number', class: 'num', min: String(f.min), max: String(f.max), step: String(f.step) });
      inp.value = String(LY().getField(cur.layer, cfg, f.key));
      inp.addEventListener('change', () => {
        if (LY().setField(cur.layer, P().cfg(), f.key, inp.value)) P().push(true);
        inp.value = String(LY().getField(cur.layer, P().cfg(), f.key));
      });
      side.appendChild(el('div', { class: 'ctrl' }, [el('div', { class: 'row' }, [el('label', { class: 'lbl', text: f.label }), inp])]));
    });
    /* Biçem önayarı ve metin kaynağı (#536). Seçim katmanın kendi
       ayarına yazılır; renk değişmez. */
    if (cur.kind === 'text' || cur.kind === 'nowplaying') {
      const sel = el('select', { class: 'sel-ctrl' });
      const now = LY().styleIdOf(cur.layer, cfg);
      if (!now) sel.appendChild(el('option', { value: '', text: 'Özel' }));
      Object.keys(LY().STYLES).forEach((id) => {
        const o = el('option', { value: id, text: LY().STYLES[id].name });
        if (id === now) o.selected = true;
        sel.appendChild(o);
      });
      sel.addEventListener('change', () => {
        if (LY().applyStyle(cur.layer, P().cfg(), sel.value)) { P().push(true); renderSide(); }
      });
      side.appendChild(el('div', { class: 'ctrl' }, [el('label', { class: 'lbl', text: 'Biçem' }), sel]));
    }
    if (cur.kind === 'text') {
      const src = el('select', { class: 'sel-ctrl' });
      const v = LY().textSourceOf(cur.layer, cfg);
      LY().TEXT_SOURCES.forEach(([a, b, label]) => {
        const val = a === 'static' ? 'static' : a + ':' + b;
        const o = el('option', { value: val, text: label });
        if (val === v) o.selected = true;
        src.appendChild(o);
      });
      src.addEventListener('change', () => {
        if (LY().setTextSource(cur.layer, P().cfg(), src.value)) { P().push(true); renderSide(); }
      });
      side.appendChild(el('div', { class: 'ctrl' }, [el('label', { class: 'lbl', text: 'Yazı Kaynağı' }), src]));
      if (v === 'static') {
        const sec = LY().sectionOf(cur.layer, cfg, false);
        const inp = el('input', { type: 'text', class: 'txt', value: sec.content || '', 'data-user-attr': '' });
        inp.addEventListener('change', () => { LY().sectionOf(cur.layer, P().cfg(), true).content = inp.value; P().push(true); });
        side.appendChild(el('div', { class: 'ctrl' }, [el('label', { class: 'lbl', text: 'Yazı İçeriği' }), inp]));
      } else {
        side.appendChild(el('div', { class: 'studio-note dim-hint', text: 'Çalan parça sistemden okunur; okunamazsa metin kartındaki elle girilen parça bilgisi çizilir.' }));
      }
    }
    renderReveal(side, cur);
    side.appendChild(el('div', { class: 'studio-note dim-hint', text: 'Değerler karenin oranı (0–1). Güvenli alanlar SMPTE ST 2046-1 ve EBU R 95: kesikli çizgi aksiyon (%93), noktalı çizgi başlık (%90).' }));
  }

  /* AÇILIŞ ANİMASYONU (#537): seçili öğenin türü, süresi, gecikmesi.
     Ayar katmana (yığın) ya da bölüme (katmansız) yazılır; çizim
     shared/reveal.js'ten, canlı ve dışa aktarımda aynı. */
  const REVEAL_TYPES = [
    ['none', 'Yok'], ['fade', 'Belirme'], ['slideUp', 'Yukarı Kayma'], ['slideDown', 'Aşağı Kayma'],
    ['slideLeft', 'Sola Kayma'], ['slideRight', 'Sağa Kayma'], ['scale', 'Büyüme'], ['wipe', 'Silme'],
  ];
  const REVEAL_EASES = [['out', 'Yavaşlayarak'], ['smooth', 'Yumuşak Giriş-Çıkış'], ['linear', 'Doğrusal'], ['back', 'Esneyerek']];

  function revealNum(label, value, min, max, step, onSet) {
    const el = P().el;
    const inp = el('input', { type: 'number', class: 'num', min: String(min), max: String(max), step: String(step) });
    inp.value = String(value);
    inp.addEventListener('change', () => {
      const v = Number(inp.value);
      if (!Number.isFinite(v)) { inp.value = String(value); return; }
      onSet(Math.max(min, Math.min(max, v)));
    });
    return el('div', { class: 'ctrl' }, [el('div', { class: 'row' }, [el('label', { class: 'lbl', text: label }), inp])]);
  }

  function renderReveal(side, cur) {
    const el = P().el;
    const R = window.SVReveal;
    if (!R || !LY().revealOf) return;
    const spec = LY().revealOf(cur.layer, P().cfg());
    // Yazılan nesne her değişiklikte yeniden alınır (bölüm yoksa kurulur)
    const write = (patch, again) => {
      const h = LY().revealHolder(cur.layer, P().cfg());
      if (!h) return;
      const next = R.normalize(Object.assign({}, h.reveal || {}, patch));
      if (R.active(next)) h.reveal = next; else delete h.reveal;
      P().push(true);
      if (again) renderSide();
    };
    side.appendChild(el('div', { class: 'group-label', text: 'Açılış Animasyonu' }));
    const type = el('select', { class: 'sel-ctrl' });
    REVEAL_TYPES.forEach(([v, label]) => { const o = el('option', { value: v, text: label }); if (v === spec.type) o.selected = true; type.appendChild(o); });
    type.addEventListener('change', () => write({ type: type.value }, true));
    side.appendChild(el('div', { class: 'ctrl' }, [el('label', { class: 'lbl', text: 'Açılış Türü' }), type]));
    if (R.active(spec)) {
      side.appendChild(revealNum('Açılış Süresi (sn)', spec.duration, 0, 10, 0.05, (v) => write({ duration: v })));
      side.appendChild(revealNum('Gecikme (sn)', spec.delay, 0, 60, 0.05, (v) => write({ delay: v })));
      const ez = el('select', { class: 'sel-ctrl' });
      REVEAL_EASES.forEach(([v, label]) => { const o = el('option', { value: v, text: label }); if (v === spec.ease) o.selected = true; ez.appendChild(o); });
      ez.addEventListener('change', () => write({ ease: ez.value }));
      side.appendChild(el('div', { class: 'ctrl' }, [el('label', { class: 'lbl', text: 'Hız Eğrisi' }), ez]));
      if (/^slide/.test(spec.type)) side.appendChild(revealNum('Kayma Mesafesi', spec.distance, 0, 0.5, 0.01, (v) => write({ distance: v })));
    }
    side.appendChild(el('div', { class: 'lay-file' }, [
      el('button', { type: 'button', class: 'btn ghost small', icon: 'play', text: 'Açılışı Oynat', onclick: replayReveal }),
      el('button', { type: 'button', class: 'btn ghost small', text: 'Sırayla Geciktir', onclick: staggerReveal }),
    ]));
    side.appendChild(el('div', { class: 'studio-note dim-hint', text: 'Öğe videonun başında, sahne yüklenince ya da "Açılışı Oynat" ile gelir; aynı sahnede kalan öğe yeniden oynamaz. Yazının ve parça kartının kendi giriş canlandırması içerik değişince oynar; açılış onun üstüne bir kez uygulanır.' }));
  }

  // Bütün öğelerin açılışı baştan: canlı çıktı ve önizleme sayacı görür
  function replayReveal() {
    const cfg = P().cfg();
    cfg.revealReplay = ((cfg.revealReplay | 0) + 1) % 1000000;
    P().push(true);
  }

  // Öğeler listedeki sırayla 0,3 sn arayla gelir (animasyonu olmayan yukarı kayar)
  function staggerReveal() {
    const R = window.SVReveal;
    if (!R) return;
    const cfg = P().cfg();
    const holders = elements().map((e) => LY().revealHolder(e.layer, cfg)).filter(Boolean);
    if (!holders.length) return;
    R.stagger(holders, 0.3, 'slideUp');
    P().push(true);
    renderSide();
  }

  window.SVLayoutEditor = { open, close, isOpen: () => !!st };
})();
