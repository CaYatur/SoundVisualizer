/*
 * SoundVisualizer — CaYaDev Ses Görselleştirici
 * Copyright (c) 2026 Çağan Turgut (CaYatur) — CaYaDev, https://cayadev.com
 * https://github.com/CaYatur/SoundVisualizer
 * SPDX-License-Identifier: MIT
 */
'use strict';
/* DÜZEN EDİTÖRÜ (#534; yeniden yazım #905).

   Canlı önizlemenin sahnesi büyük bir pencereye TAŞINIR (yeniden çizilmez):
   aynı katman kodu, aynı ayarlar, aynı tuvaller. Önizleme kendi kutusunun
   boyutunu izlediği için yüksek çözünürlükte çizmeye geçer; kapanınca
   yerine döner. Ayrı bir çizici yok, böylece editörde görülen ile çıkış
   arasında ikinci bir yol yok (#539).

   Öğeler (barlar, çalan parça kartı, metin, logo, dış kaynaklar) çizicinin
   bildirdiği kutuyla gösterilir (SVPreview.stack().layoutBounds()). Sürükleme,
   ok tuşları, hizalama ve sayısal alanlar konumu öğenin KENDİ parametrelerine
   yazar (src/shared/layout.js).

   SAHNE EDİTÖRÜNDÜR. Editör açıkken sayfa yeniden çizilse de (geri al, dışarıdan
   gelen ayar) önizleme sahnesi burada kalır: kabuk `isOpen()` iken sahneyi
   taşımaz. Eskiden Ctrl+Z sayfayı yeniden çizdiriyor, sahne arkadaki sayfaya
   dönüyor ve editör simsiyah kalıyordu.

   KLAVYE tek yerden (belge, yakalama aşaması): kipli pencere olduğu için tuşlar
   arkadaki panele sızmaz (Alt+1…5 sayfa değiştirmez, Ctrl+Z iki kez çalışmaz).
   Geri al tek geçmişi kullanır (undo.js); ok tuşu ve hizalama da adım bırakır.

   HIZ. Fare saniyede yüzlerce olay yollar; ayar kare başına bir kez yazılır.
   Kutu konumu ve sınıfları yalnız değişince DOM'a yazılır.

   Yakalama: karenin kenarları ve merkezi, güvenli alanlar (SMPTE ST 2046-1 /
   EBU R 95) ve diğer öğelerin kenar ve merkezleri. Alt basılıyken kapalı —
   zaman çizelgesindeki gibi. Sürüklemenin tek işaretçili karşılığı ok
   tuşları ve sayısal alanlar (WCAG 2.5.7). Tek harfli kısayollar (H, L)
   yalnız bir kutu odaktayken çalışır (WCAG 2.1.4). */
(function () {
  const P = () => window.SVPanel;
  const LY = () => window.SVLayout;
  const tr = (s) => (window.SVI18n && typeof window.SVI18n.t === 'function' ? window.SVI18n.t(s) : s);
  const SNAP_PX = 8;
  const NUDGE = 0.005;
  const NUDGE_FINE = 0.001; // Ctrl + ok: ince kaydırma
  const RESIZE_STEP = 0.02; // klavyeyle her + / − basışında ölçek değişimi (Shift: on kat)
  const MIN_RESIZE_PX = 24; // kutunun köşeden çekilince inebileceği en küçük kenar
  const DRAG_START_PX = 3; // tıklama ile sürüklemeyi ayıran eşik
  // Oran, ve konum satırında gösterilen başvuru çözünürlüğü
  const ASPECTS = [['16:9', 16 / 9, 1920, 1080], ['9:16', 9 / 16, 1080, 1920], ['1:1', 1, 1080, 1080]];
  /* Görünüm: 'fit' çerçeve alanı doldurur; 'wide' çerçeveyi küçültüp çevresini gösterir
     (çerçeve dışındaki öğeler görülsün, tutulsun). Görünüm YALNIZ kullanıcı değiştirince,
     pencere boyu ve oran değişince yeniden hesaplanır; sürükleme onu oynatmaz. */
  const VIEW_SCALE = { fit: 1, wide: 0.62 };
  const MIN_REACH_PX = 24; // sürüklenen öğenin çerçevede kalan en küçük parçası (her eksen)
  const OFF_FRACTION = 0.2; // görünen alan bundan azsa öğe "çerçeve dışında" sayılır
  const KIND_NAMES = { bars: 'Barlar', nowplaying: 'Çalan Parça', text: 'Metin', logo: 'Logo', input: 'Spout/Syphon Girişi', web: 'Web Sayfası' };
  const KIND_ICONS = { bars: 'bars', nowplaying: 'music', text: 'text', logo: 'image', input: 'video', web: 'globe' };
  const ARROWS = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] };
  const ALIGN_TOOLS = [
    ['left', 'align-left', 'Sola Hizala'], ['hcenter', 'align-hcenter', 'Yatayda Ortala'], ['right', 'align-right', 'Sağa Hizala'],
    ['top', 'align-top', 'Üste Hizala'], ['vcenter', 'align-vcenter', 'Dikeyde Ortala'], ['bottom', 'align-bottom', 'Alta Hizala'],
  ];
  const SHORTCUTS = [
    ['Sürükle', 'Öğeyi taşır; seçili öğelerin hepsi birlikte gider'],
    ['Shift', 'Sürüklerken tek eksende tutar'],
    ['Alt', 'Sürüklerken yakalamayı kapatır'],
    ['Shift + Tık', 'Öğeyi seçime ekler ya da seçimden çıkarır'],
    ['Ctrl + A', 'Bütün öğeleri seçer'],
    ['Ok Tuşları', 'Seçimi kaydırır (Shift: on kat, Ctrl: ince)'],
    ['+  −', 'Odaktaki öğeyi büyütür ve küçültür (Shift: on kat)'],
    ['H', 'Odaktaki öğeyi gizler ya da gösterir'],
    ['L', 'Odaktaki öğeyi kilitler ya da kilidini açar'],
    ['Ctrl + Z', 'Geri alır'],
    ['Ctrl + Y', 'Yineler'],
    ['Esc', 'Sürüklemeyi iptal eder; sürükleme yoksa editörü kapatır'],
  ];

  let st = null; // açık editörün durumu

  function pref(key, def) {
    try { const v = localStorage.getItem('sv-layout-' + key); return v == null ? def : v; } catch (e) { return def; }
  }
  function setPref(key, v) {
    try { localStorage.setItem('sv-layout-' + key, String(v)); } catch (e) { /* özel pencere */ }
  }

  /* Düzenlenebilir öğeler YAPILANDIRMADAN (cfg.layers), çizicinin listesinden değil.
     Eskiden yalnız önizleme yığınının o an çizdiği katmanlar geliyordu: gizli / sessiz
     katman, solo yüzünden çizilmeyen katman ve zaman çizelgesi çalarken hepsi editörden
     kayboluyordu. Şimdi hepsi listede; çizilmeyenin kutusu ayardan hesaplanıyor
     (fallbackBox) ve soluk gösteriliyor. */
  function elements() {
    const cfg = P().cfg();
    const stack = window.SVPreview && window.SVPreview.stack && window.SVPreview.stack();
    const drawn = new Set();
    if (stack && Array.isArray(stack.entries)) {
      stack.entries.forEach((e) => { if (e && e.layer && e.layer.id) drawn.add(e.layer.id); });
    }
    const out = [];
    (Array.isArray(cfg.layers) ? cfg.layers : []).forEach((layer) => {
      if (!layer || !layer.id) return;
      const kind = LY().kindOf(layer);
      if (!kind) return;
      const hidden = layer.enabled === false || !!layer.muted;
      out.push({ id: layer.id, kind, layer, name: tr(layer.name || KIND_NAMES[kind]), hidden, drawn: drawn.has(layer.id), locked: !!layer.locked });
    });
    return out;
  }

  // Kutular çiziciden: yazının genişliği, kapağın yeri ayardan tahmin edilemez
  function liveBounds() {
    const stack = window.SVPreview && window.SVPreview.stack && window.SVPreview.stack();
    return stack && stack.layoutBounds ? stack.layoutBounds() : {};
  }

  function boxOf(el, bounds) {
    const b = bounds[el.id];
    if (b) return b;
    const a = st ? st.aspect : 16 / 9;
    return LY().fallbackBox(el.layer, P().cfg(), a);
  }

  function find(id) { return elements().find((e) => e.id === id) || null; }
  function pickedEls() { return st ? elements().filter((e) => st.picked.has(e.id)) : []; }

  /* Parça gönderimi (sürükleme, ok tuşu) geri al adımı bırakmıyordu; adım yalnız tam
     gönderimde not ediliyordu. Not gecikmeli olduğu için art arda basılan ok tuşları
     tek adımda toplanır. */
  function noteUndo() {
    const h = window.SVUndoHistory;
    if (h && typeof h.note === 'function') h.note();
  }
  function commit(full) {
    P().push(!!full);
    noteUndo();
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
      platform: pref('platform', '1') === '1',
      snap: pref('snap', '1') === '1',
      view: pref('view', 'fit') === 'wide' ? 'wide' : 'fit',
      sel: null, // seçimin başı: yan paneldeki alanlar onun
      picked: new Set(), // seçili bütün öğeler
      marks: {},
      drag: null,
      raf: 0,
      boxes: {},
      geo: {}, // kutunun DOM'a yazılmış son konumu ve bayrakları
      infoSig: '',
      canUndo: null,
      canRedo: null,
    };

    const overlay = el('div', { class: 'lay-overlay' });
    const safeA = el('div', { class: 'lay-safe action', 'aria-hidden': 'true' });
    const safeT = el('div', { class: 'lay-safe title', 'aria-hidden': 'true' });
    const cv = el('div', { class: 'lay-center v', 'aria-hidden': 'true' });
    const ch = el('div', { class: 'lay-center h', 'aria-hidden': 'true' });
    const gx = el('div', { class: 'lay-guide x', 'aria-hidden': 'true' });
    const gy = el('div', { class: 'lay-guide y', 'aria-hidden': 'true' });
    const marquee = el('div', { class: 'lay-marquee', 'aria-hidden': 'true' });
    // Yakalama çizgileri yalnız sürüklerken görünür
    gx.hidden = true;
    gy.hidden = true;
    marquee.hidden = true;
    // Kısa video uygulamalarının arayüzünün kapladığı bölgeler (#838); en-boya göre dolar
    const plat = el('div', { class: 'lay-platform-wrap', 'aria-hidden': 'true' });
    overlay.append(plat, safeA, safeT, cv, ch, gx, gy, marquee);
    st.overlay = overlay;
    st.guides = { gx, gy, safe: [safeA, safeT], plat, marquee };

    const stageWrap = el('div', { class: 'lay-stage-wrap' });
    const side = el('div', { class: 'lay-side' });
    st.side = side;

    const press = (b, on) => { b.classList.toggle('active', on); b.setAttribute('aria-pressed', on ? 'true' : 'false'); };
    const aspectBtns = ASPECTS.map(([k]) => el('button', {
      type: 'button', class: k === st.aspectKey ? 'active' : '', text: k, 'data-user-text': '',
      'aria-pressed': k === st.aspectKey ? 'true' : 'false',
      onclick: () => { setAspect(k); aspectBtns.forEach((b) => press(b, b.textContent === k)); },
    }));
    const viewBtns = [['fit', 'Çerçeveye Sığdır', 'Çerçeve alanı doldurur'], ['wide', 'Çevreyi Göster', 'Çerçeveyi küçültür; dışarı taşan öğeler de görünür']].map(([k, label, hint]) => el('button', {
      type: 'button', class: k === st.view ? 'active' : '', text: label, title: hint, 'data-view': k,
      'aria-pressed': k === st.view ? 'true' : 'false',
      onclick: () => { setView(k); viewBtns.forEach((b) => press(b, b.dataset.view === k)); },
    }));
    st.viewBtns = viewBtns;
    // Kılavuz anahtarları: işaret kutusu değil, basılı kalan düğme
    const chip = (label, icon, on, set) => {
      const b = el('button', { type: 'button', class: 'lay-chip' + (on ? ' active' : ''), icon, text: label, 'aria-pressed': on ? 'true' : 'false' });
      b.addEventListener('click', () => { const v = b.getAttribute('aria-pressed') !== 'true'; press(b, v); set(v); });
      return b;
    };
    st.undoBtn = el('button', { type: 'button', class: 'icon-btn small', icon: 'undo', title: 'Geri al (Ctrl+Z)', 'aria-label': 'Geri al', onclick: () => history('undo') });
    st.redoBtn = el('button', { type: 'button', class: 'icon-btn small', icon: 'redo', title: 'Yinele (Ctrl+Y)', 'aria-label': 'Yinele', onclick: () => history('redo') });
    const keysBtn = el('button', { type: 'button', class: 'lay-chip', icon: 'keys', text: 'Kısayollar', 'aria-expanded': 'false', onclick: () => toggleKeys() });
    st.keysBtn = keysBtn;
    const head = el('div', { class: 'lay-head' }, [
      el('h3', { id: 'layTitle', text: 'Düzen Editörü' }),
      el('div', { class: 'lay-hgroup', role: 'group', 'aria-label': 'Geçmiş' }, [st.undoBtn, st.redoBtn]),
      el('div', { class: 'segment lay-seg', role: 'group', 'aria-label': 'Çıktı oranı' }, aspectBtns),
      el('div', { class: 'segment lay-seg lay-view', role: 'group', 'aria-label': 'Görünüm' }, viewBtns),
      el('div', { class: 'lay-hgroup', role: 'group', 'aria-label': 'Kılavuzlar' }, [
        chip('Güvenli alanlar', 'target', st.safe, (v) => { st.safe = v; setPref('safe', v ? '1' : '0'); paintGuides(); }),
        chip('Platform arayüzü', 'phone', st.platform, (v) => { st.platform = v; setPref('platform', v ? '1' : '0'); paintGuides(); }),
        chip('Yakalama', 'magnet', st.snap, (v) => { st.snap = v; setPref('snap', v ? '1' : '0'); }),
      ]),
      el('span', { class: 'lay-grow' }),
      keysBtn,
      el('button', { type: 'button', class: 'btn small', icon: 'x', text: 'Kapat', onclick: close }),
    ]);

    // Hizalama ve dağıtma: seçim yokken kapalı
    const tool = (icon, label, fn) => el('button', { type: 'button', class: 'icon-btn small', icon, title: label, 'aria-label': label, onclick: fn });
    st.alignBtns = ALIGN_TOOLS.map(([mode, icon, label]) => tool(icon, label, () => arrange(mode)));
    st.distBtns = [tool('dist-h', 'Yatayda Eşit Dağıt', () => arrange('dist-x')), tool('dist-v', 'Dikeyde Eşit Dağıt', () => arrange('dist-y'))];
    st.frameBtn = tool('fit', 'Çerçeveye Getir', () => bringIn());
    st.info = el('div', { class: 'lay-info', 'aria-live': 'polite', 'data-user-text': '' });
    const tools = el('div', { class: 'lay-tools', role: 'toolbar', 'aria-label': 'Hizalama' }, [
      el('div', { class: 'lay-tgroup' }, st.alignBtns.slice(0, 3)),
      el('div', { class: 'lay-tgroup' }, st.alignBtns.slice(3)),
      el('div', { class: 'lay-tgroup' }, st.distBtns),
      el('div', { class: 'lay-tgroup' }, [st.frameBtn]),
      st.info,
    ]);
    const hint = (k, text) => el('span', { class: 'lay-hint-i' }, [el('kbd', { text: k }), el('span', { text })]);
    const hints = el('div', { class: 'lay-hint' }, [
      hint('Shift', 'tek eksen'), hint('Alt', 'yakalama kapalı'), hint('Shift + Tık', 'seçime ekle'),
      hint('Ok Tuşları', 'kaydır'), hint('F1', 'tüm kısayollar'),
    ]);
    const keys = el('div', { class: 'lay-keys', role: 'region', 'aria-label': 'Kısayollar' }, [
      el('div', { class: 'lay-keys-h', text: 'Kısayollar' }),
    ].concat(SHORTCUTS.map(([k, text]) => el('div', { class: 'lay-keys-row' }, [el('kbd', { text: k }), el('span', { text })]))));
    keys.hidden = true;
    st.keys = keys;

    const panel = el('div', { class: 'ask-panel lay-editor', role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': 'layTitle' }, [
      head,
      el('div', { class: 'lay-body' }, [el('div', { class: 'lay-main' }, [tools, stageWrap, hints]), side]),
      keys,
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
    // Boş alana basmak seçimi bırakır; sürüklemek çerçeveyle seçer
    overlay.addEventListener('pointerdown', (ev) => { if (ev.target === overlay) startMarquee(ev); });
    stageWrap.addEventListener('pointerdown', (ev) => { if (ev.target === stageWrap) select(null); });
    st.onKey = onKey;
    document.addEventListener('keydown', st.onKey, true);
    renderSide();
    paintGuides();
    paintTools();
    loop();
    const first = overlay.querySelector('.lay-box') || head.querySelector('button');
    if (first) first.focus({ preventScroll: true });
  }

  /* TUŞLAR. Kipli pencere: hiçbir tuş arkadaki panelin kısayoluna ulaşmaz. */
  function onKey(e) {
    if (!st) return;
    // Üstte başka bir pencere (onay) varsa tuşlar onun
    if (document.querySelector('.ask-backdrop:not(.lay-backdrop)')) return;
    e.stopPropagation();
    const t = e.target;
    const typing = !!(t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable));
    if (e.key === 'Escape') {
      e.preventDefault();
      if (st.drag) st.drag.cancel();
      else if (!st.keys.hidden) toggleKeys(false);
      else close();
      return;
    }
    /* Kipli pencere: Tab arkadaki panele kaçmasın, içeride döner. */
    if (e.key === 'Tab') {
      const f = Array.from(st.panel.querySelectorAll('button, input, select, textarea, [tabindex]:not([tabindex="-1"])'))
        .filter((x) => !x.disabled && x.offsetParent !== null);
      if (!f.length) return;
      const first = f[0];
      const last = f[f.length - 1];
      const a = document.activeElement;
      if (e.shiftKey && (a === first || !st.panel.contains(a))) { e.preventDefault(); last.focus({ preventScroll: true }); }
      else if (!e.shiftKey && (a === last || !st.panel.contains(a))) { e.preventDefault(); first.focus({ preventScroll: true }); }
      return;
    }
    if (e.key === 'F1') { e.preventDefault(); toggleKeys(); return; }
    if (typing || st.drag) return; // yazı kutusunun kendi tuşları (kendi geri alması dahil)
    const mod = e.ctrlKey || e.metaKey;
    const k = String(e.key).toLowerCase();
    if (mod && !e.altKey && (k === 'z' || k === 'y')) {
      e.preventDefault();
      history(k === 'y' || e.shiftKey ? 'redo' : 'undo');
      return;
    }
    if (mod && !e.altKey && k === 'a') { e.preventDefault(); selectAll(); return; }
    if (e.altKey) return;
    if (ARROWS[e.key]) { if (st.picked.size) { e.preventDefault(); nudge(e); } return; }
    if (mod) return;
    const boxId = t && t.classList && t.classList.contains('lay-box') ? t.dataset.id : null;
    if (!boxId) return;
    if (resizeKey(e, boxId)) return;
    if (k === 'h') { e.preventDefault(); setFlag(boxId, 'visible'); }
    else if (k === 'l') { e.preventDefault(); setFlag(boxId, 'locked'); }
  }

  function toggleKeys(on) {
    if (!st) return;
    const show = on == null ? st.keys.hidden : !!on;
    st.keys.hidden = !show;
    st.keysBtn.classList.toggle('active', show);
    st.keysBtn.setAttribute('aria-expanded', show ? 'true' : 'false');
  }

  /* GERİ AL / YİNELE: panelin tek geçmişi. Sayfa arkada yeniden çizilir; sahne burada kalır
     (kabuk isOpen() iken taşımaz). Geri alınan adım bir öğeyi silmişse seçim de temizlenir. */
  function history(dir) {
    const h = window.SVUndoHistory;
    if (!st || !h || st.drag) return;
    if (dir === 'redo') h.redo(); else h.undo();
    refresh();
  }

  // Sahne editörün dışından değişti (geri al, içe aktarım): seçim ve yan panel yenilenir
  function refresh() {
    if (!st) return;
    const ids = new Set(elements().map((e) => e.id));
    Array.from(st.picked).forEach((id) => { if (!ids.has(id)) st.picked.delete(id); });
    if (st.sel && !ids.has(st.sel)) st.sel = Array.from(st.picked).pop() || null;
    renderSide();
    paintTools();
  }

  function setView(k) {
    if (!st) return;
    st.view = k === 'wide' ? 'wide' : 'fit';
    setPref('view', st.view);
    st.stage.dataset.view = st.view;
    fit();
  }

  /* KAYMAYAN GÖRÜNÜM. Önizleme sahnesi ve kabı `overflow: hidden` idi; bu kutular
     kaydırılabilir. Çerçeve dışına çekilmiş bir kutu odak alınca (Tab, listeden seçim)
     tarayıcı onu göstermek için sahneyi kaydırıyordu: çerçeve kayıyor, ekranın öteki
     yarısı görünmez oluyordu, editör kapanınca da önizleme kaymış kalıyordu. CSS artık
     `overflow: clip` (kaydırılamaz); bu da her karede ve kapanışta ikinci emniyet. */
  function pinScroll(s) {
    const nodes = [s.stage, s.wrap, s.overlay, document.getElementById('pvStage')];
    for (const n of nodes) {
      if (n && (n.scrollTop || n.scrollLeft)) { n.scrollTop = 0; n.scrollLeft = 0; }
    }
  }

  function setAspect(k) {
    const a = ASPECTS.find((x) => x[0] === k) || ASPECTS[0];
    st.aspectKey = a[0];
    st.aspect = a[1];
    st.ref = [a[2], a[3]];
    st.infoSig = '';
    setPref('aspect', a[0]);
    st.stage.dataset.aspect = a[0];
    st.stage.dataset.view = st.view;
    fit();
    paintGuides();
  }

  // Sahneyi alana oranı koruyarak sığdırır (9:16'da yükseklik sınırlar)
  function fit() {
    if (!st || !st.wrap) return;
    const r = st.wrap.getBoundingClientRect();
    const pad = 16;
    const W = Math.max(40, r.width - pad * 2);
    const H = Math.max(40, r.height - pad * 2);
    const k = VIEW_SCALE[st.view] || 1;
    const w = Math.min(W, H * st.aspect) * k;
    st.stage.style.width = Math.round(w) + 'px';
    st.stage.style.height = Math.round(w / st.aspect) + 'px';
  }

  function close() {
    if (!st) return;
    if (st.drag) st.drag.cancel();
    cancelAnimationFrame(st.raf);
    document.removeEventListener('keydown', st.onKey, true);
    const s = st;
    st = null;
    pinScroll(s);
    s.overlay.remove();
    s.stage.classList.remove('lay-stage');
    delete s.stage.dataset.view;
    s.stage.style.width = '';
    s.stage.style.height = '';
    delete s.stage.dataset.aspect;
    window.removeEventListener('resize', s.onResize);
    if (s.next && s.next.parentNode === s.home) s.home.insertBefore(s.stage, s.next);
    else s.home.appendChild(s.stage);
    s.backdrop.remove();
    // Sayfa yeniden çizilir: sahne o anki sayfanın yerine oturur (editör açıkken sayfa değişmiş olabilir)
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
    /* Platform bölgeleri (#838): 9:16 ve 1:1'de, yalnız kılavuz. Her
       boyamada yeniden kuruluyor; en fazla dört kutu. */
    const el = P().el;
    const plat = st.guides.plat;
    plat.textContent = '';
    plat.hidden = !st.platform;
    if (st.platform) {
      for (const z of L.platformZones(st.aspectKey)) {
        plat.appendChild(el('div', { class: 'lay-platform ' + z.id, title: 'Platform arayüzünün kapladığı alan',
          style: 'left:' + (z.x * 100) + '%;top:' + (z.y * 100) + '%;width:' + (z.w * 100) + '%;height:' + (z.h * 100) + '%' }));
      }
    }
  }

  function makeBox(e) {
    const resizable = LY().canResize(e.layer);
    const b = P().el('button', {
      type: 'button', class: 'lay-box' + (resizable ? ' resizable' : ''),
      'aria-label': e.name + ' — ' + tr('ok tuşlarıyla taşıyın') + (resizable ? ', ' + tr('+ ve − ile boyutlandırın') : ''),
    }, [P().el('span', { class: 'lay-tag', text: e.name, 'data-user-text': '' })]);
    b.dataset.id = e.id;
    if (resizable) {
      /* Boyutlandırma tutamacı: sağ alt köşe. Kutunun kendi sürükleme
         dinleyicisine ulaşmasın diye olay burada durur. */
      const h = P().el('span', { class: 'lay-handle', title: tr('Boyutlandırmak için sürükleyin'), 'aria-hidden': 'true' });
      h.addEventListener('pointerdown', (ev) => { if (ev.button != null && ev.button !== 0) return; ev.stopPropagation(); startResize(ev, e.id, b); });
      b.appendChild(h);
    }
    b.addEventListener('pointerdown', (ev) => { if (ev.button != null && ev.button !== 0) return; startDrag(ev, e.id); });
    // Klavyeyle gelen odak seçer (Tab); fareyle seçimi sürükleme başlangıcı yapar
    b.addEventListener('focus', () => { if (st && !st.byPointer && !st.drag && !st.picked.has(e.id)) select(e.id); });
    return b;
  }

  /* Kutuları çizicinin bildirdiği yere taşır (her karede: ses ve içerik değişiyor). DOM'a
     yalnız değişen değer yazılır: beş öğede kare başına yirmi stil yazımı sıfıra iner. */
  function loop() {
    if (!st) return;
    pinScroll(st);
    const bounds = liveBounds();
    const els = elements();
    const seen = {};
    let sig = '';
    for (const e of els) {
      seen[e.id] = true;
      let b = st.boxes[e.id];
      if (!b) {
        b = makeBox(e);
        st.overlay.appendChild(b);
        st.boxes[e.id] = b;
        st.geo[e.id] = { x: NaN, y: NaN, w: NaN, h: NaN, flags: -1 };
      }
      const g = st.geo[e.id];
      const box = boxOf(e, bounds);
      const frac = box ? LY().visibleFraction(box) : 0;
      const off = frac < OFF_FRACTION;
      if (box && (box.x !== g.x || box.y !== g.y || box.w !== g.w || box.h !== g.h)) {
        g.x = box.x; g.y = box.y; g.w = box.w; g.h = box.h;
        b.style.left = (box.x * 100) + '%';
        b.style.top = (box.y * 100) + '%';
        b.style.width = (box.w * 100) + '%';
        b.style.height = (box.h * 100) + '%';
      }
      const dim = e.hidden || !e.drawn;
      const flags = (st.picked.has(e.id) ? 1 : 0) | (st.sel === e.id ? 2 : 0) | (dim ? 4 : 0) | (e.locked ? 8 : 0) | (off ? 16 : 0) | (frac < 0.999 ? 32 : 0);
      if (flags !== g.flags) {
        g.flags = flags;
        b.classList.toggle('sel', !!(flags & 1));
        b.classList.toggle('lead', !!(flags & 2));
        // Çizilmeyen (gizli, sessiz, solo dışı) öğe soluk; kilitli öğe taşınmaz
        b.classList.toggle('is-hidden', dim);
        b.classList.toggle('locked', e.locked);
        b.classList.toggle('off', off);
        b.classList.toggle('partial', frac < 0.999);
      }
      paintMark(e, box, off);
      sig += e.id + ':' + (flags & 60) + '|';
    }
    Object.keys(st.boxes).forEach((id) => { if (!seen[id]) { st.boxes[id].remove(); delete st.boxes[id]; delete st.geo[id]; st.picked.delete(id); if (st.sel === id) st.sel = null; } });
    Object.keys(st.marks).forEach((id) => { if (!seen[id]) { st.marks[id].remove(); delete st.marks[id]; } });
    /* Liste rozetleri çizicinin kutusuna bağlı ve kutu bir kare gecikiyor: durum
       değişince yan panel yenilensin (yazılan alan odaktayken beklesin). */
    if (sig !== st.sideSig) {
      const a = document.activeElement;
      const typing = a && st.side.contains(a) && (a.tagName === 'INPUT' || a.tagName === 'SELECT' || a.tagName === 'TEXTAREA');
      if (!typing && !st.drag) { renderSide(); paintTools(); }
    }
    paintInfo(els, bounds);
    paintHistory();
    st.raf = requestAnimationFrame(loop);
  }

  function sideSigNow() {
    let sig = '';
    for (const e of elements()) sig += e.id + ':' + (((st.geo[e.id] || {}).flags | 0) & 60) + '|';
    return sig;
  }

  function paintHistory() {
    const h = window.SVUndoHistory;
    const u = !!(h && h.canUndo());
    const r = !!(h && h.canRedo());
    if (u !== st.canUndo) { st.canUndo = u; st.undoBtn.disabled = !u; }
    if (r !== st.canRedo) { st.canRedo = r; st.redoBtn.disabled = !r; }
  }

  // Seçimin konumu, başvuru çözünürlüğünde piksel olarak (16:9 → 1920 × 1080)
  function paintInfo(els, bounds) {
    let text;
    let sig;
    if (!st.picked.size) { sig = '0'; text = tr('Öğe seçili değil'); }
    else if (st.picked.size > 1) { sig = 'n' + st.picked.size; text = st.picked.size + ' ' + tr('öğe seçili'); }
    else {
      const e = els.find((x) => x.id === st.sel) || els.find((x) => st.picked.has(x.id));
      const box = e && boxOf(e, bounds);
      if (!e || !box) { sig = '0'; text = tr('Öğe seçili değil'); }
      else {
        const W = st.ref[0];
        const H = st.ref[1];
        const v = [Math.round(box.x * W), Math.round(box.y * H), Math.round(box.w * W), Math.round(box.h * H)];
        sig = e.id + v.join(',');
        text = e.name + '  ·  X ' + v[0] + '  Y ' + v[1] + '  ·  ' + v[2] + ' × ' + v[3] + ' px';
      }
    }
    if (sig === st.infoSig) return;
    st.infoSig = sig;
    st.info.textContent = text;
  }

  function paintTools() {
    if (!st) return;
    const free = pickedEls().filter((e) => !e.locked).length;
    st.alignBtns.forEach((b) => { b.disabled = free < 1; });
    st.distBtns.forEach((b) => { b.disabled = free < 3; });
    st.frameBtn.disabled = free < 1;
  }

  /* Çerçeve dışındaki öğenin işareti: kutu görünmese de çerçevenin kenarında adıyla
     ve yönüyle duruyor; tıklayınca seçilir. */
  function paintMark(e, box, off) {
    let m = st.marks[e.id];
    if (!off || !box) { if (m && !m.hidden) m.hidden = true; return; }
    if (!m) {
      m = P().el('button', { type: 'button', class: 'lay-off', tabindex: '-1', title: tr('Çerçeve dışında') + ': ' + e.name }, [
        P().el('span', { class: 'lay-off-arrow', 'aria-hidden': 'true' }),
        P().el('span', { class: 'lay-off-name', text: e.name, 'data-user-text': '' }),
      ]);
      m.addEventListener('click', () => {
        select(e.id);
        const b = st.boxes[e.id];
        if (b) b.focus({ preventScroll: true });
      });
      st.overlay.appendChild(m);
      st.marks[e.id] = m;
    }
    m.hidden = false;
    const cx = box.x + box.w / 2;
    const cy = box.y + box.h / 2;
    const px = Math.max(0.04, Math.min(0.96, cx));
    const py = Math.max(0.04, Math.min(0.96, cy));
    m.style.left = (px * 100) + '%';
    m.style.top = (py * 100) + '%';
    // Ok kutunun olduğu yöne bakıyor
    const ang = Math.atan2(cy - py, cx - px);
    const arrow = m.firstChild;
    if (arrow && arrow.style) arrow.style.transform = 'rotate(' + (Number.isFinite(ang) ? ang : 0) + 'rad)';
    m.classList.toggle('sel', st.picked.has(e.id));
  }

  /* SEÇİM. `add`: Shift/Ctrl ile tıklama, öğeyi seçime ekler ya da çıkarır. Seçimin başı
     (st.sel) son seçilen öğedir; yan paneldeki alanlar onundur. */
  function select(id, add) {
    if (!st) return;
    if (add && id) {
      if (st.picked.has(id)) st.picked.delete(id); else st.picked.add(id);
      st.sel = st.picked.has(id) ? id : (Array.from(st.picked).pop() || null);
    } else {
      if (st.sel === (id || null) && st.picked.size === (id ? 1 : 0)) return;
      st.picked.clear();
      if (id) st.picked.add(id);
      st.sel = id || null;
    }
    renderSide();
    paintTools();
  }

  function selectAll() {
    if (!st) return;
    const els = elements();
    st.picked = new Set(els.map((e) => e.id));
    if (!st.sel || !st.picked.has(st.sel)) st.sel = els.length ? els[0].id : null;
    renderSide();
    paintTools();
  }

  // Sürükleme başındaki kutu ve alan değerleri: toplam kayma her karede buradan uygulanır
  function snapshotOf(e, bounds, cfg) {
    const box = boxOf(e, bounds);
    if (!box) return null;
    const startVals = {};
    LY().KINDS[e.kind].fields.forEach((f) => { startVals[f.key] = LY().getField(e.layer, cfg, f.key); });
    return { id: e.id, box, startVals };
  }

  function startDrag(ev, id) {
    if (ev.button !== 0) return;
    const e = find(id);
    if (!e) return;
    ev.preventDefault();
    // preventDefault odağı da engelliyor: odak seçilen kutuya geçsin (seçimi aşağısı yapar)
    st.byPointer = true;
    try { if (ev.currentTarget && ev.currentTarget.focus) ev.currentTarget.focus({ preventScroll: true }); } finally { st.byPointer = false; }
    if (ev.shiftKey || ev.ctrlKey || ev.metaKey) { select(id, true); return; }
    // Seçili gruptaki bir kutudan tutulursa grup korunur
    if (!st.picked.has(id)) select(id);
    else if (st.sel !== id) { st.sel = id; renderSide(); }
    if (e.locked) return;
    const bounds = liveBounds();
    const cfg = P().cfg();
    // Seçili ve kilitsiz öğelerin hepsi birlikte taşınır
    const items = elements().filter((x) => st.picked.has(x.id) && !x.locked).map((x) => snapshotOf(x, bounds, cfg)).filter(Boolean);
    if (!items.length) return;
    const startBox = items.length === 1 ? items[0].box : LY().boundsOf(items.map((it) => it.box));
    // Diğer öğelerin kutuları sürükleme başında sabitlenir (taşınanlara yakalanmasın)
    const others = elements().filter((x) => !st.picked.has(x.id) && !x.hidden && x.drawn).map((x) => boxOf(x, bounds)).filter(Boolean);
    const guides = LY().mergeGuides(LY().frameGuides(), LY().elementGuides(others));
    const rect = st.stage.getBoundingClientRect();
    const d = { id, items, startBox, guides, rect, x0: ev.clientX, y0: ev.clientY, moved: false, last: null, pending: 0 };
    st.drag = d;
    const target = ev.currentTarget;
    target.setPointerCapture(ev.pointerId);
    // Kare başına bir kez: fare olayları arasında yalnız son konum tutulur
    const flush = () => {
      d.pending = 0;
      const m = d.last;
      if (!st || st.drag !== d || !m) return;
      let dx = (m.clientX - d.x0) / d.rect.width;
      let dy = (m.clientY - d.y0) / d.rect.height;
      // Shift: baskın eksende kalır
      if (m.shiftKey) { if (Math.abs(m.clientX - d.x0) >= Math.abs(m.clientY - d.y0)) dy = 0; else dx = 0; }
      let box = { x: d.startBox.x + dx, y: d.startBox.y + dy, w: d.startBox.w, h: d.startBox.h };
      let lx = null;
      let lyl = null;
      if (st.snap && !m.altKey) {
        const s = LY().snapBox(box, d.guides, SNAP_PX / d.rect.width, SNAP_PX / d.rect.height);
        box = s.box; lx = s.x; lyl = s.y;
      }
      // Öğe çerçeveden tamamen çıkamaz: en az bir parçası tutulabilir kalır
      box = LY().reachClamp(box, MIN_REACH_PX / d.rect.width, MIN_REACH_PX / d.rect.height);
      applyMove(d.items, box.x - d.startBox.x, box.y - d.startBox.y);
      showGuide(lx, lyl);
    };
    const move = (m) => {
      if (!st || st.drag !== d) return;
      if (!d.moved && Math.hypot(m.clientX - d.x0, m.clientY - d.y0) < DRAG_START_PX) return;
      d.moved = true;
      d.last = { clientX: m.clientX, clientY: m.clientY, altKey: m.altKey, shiftKey: m.shiftKey };
      if (!d.pending) d.pending = requestAnimationFrame(flush);
    };
    const end = (cancel) => {
      target.removeEventListener('pointermove', move);
      target.removeEventListener('pointerup', up);
      target.removeEventListener('pointercancel', up);
      if (d.pending) { cancelAnimationFrame(d.pending); d.pending = 0; }
      if (!st || st.drag !== d) return;
      if (cancel) { if (d.moved) applyMove(d.items, 0, 0); } else if (d.moved) flush();
      st.drag = null;
      showGuide(null, null);
      if (d.moved) { commit(true); renderSide(); }
      // Grubun içinden sürüklemeden tıklamak seçimi o öğeye indirir
      else if (!cancel && st.picked.size > 1) select(id);
    };
    const up = () => end(false);
    d.cancel = () => end(true);
    target.addEventListener('pointermove', move);
    target.addEventListener('pointerup', up);
    target.addEventListener('pointercancel', up);
  }

  /* Köşeden boyutlandırma: sol üst köşe sabit, kutu sağ alt köşeden
     çekilir. Çarpan imlecin iki eksendeki oranının ortalaması: kaynak
     oranı korunuyor, tek ölçek ayarı yazılıyor (logo `scale`, kaynaklar
     `size`). Başlangıç kutusu ve değerlerinden hesaplanır (birikme yok). */
  function startResize(ev, id, boxEl) {
    if (ev.button !== 0) return;
    const e = find(id);
    if (!e || e.locked || !LY().canResize(e.layer)) return;
    ev.preventDefault();
    if (boxEl && boxEl.focus) boxEl.focus({ preventScroll: true });
    select(id);
    const it = snapshotOf(e, liveBounds(), P().cfg());
    if (!it) return;
    const startBox = it.box;
    const startVals = it.startVals;
    const rect = st.stage.getBoundingClientRect();
    const minK = Math.max(MIN_RESIZE_PX / rect.width / startBox.w, MIN_RESIZE_PX / rect.height / startBox.h) || 0.05;
    const d = { id, resize: true, moved: false, last: null, pending: 0 };
    st.drag = d;
    const target = ev.currentTarget;
    target.setPointerCapture(ev.pointerId);
    const write = (k) => {
      const now = find(id);
      if (!now) return;
      LY().resizeBy(now.layer, P().cfg(), startBox, startVals, k);
      P().push(false);
    };
    const flush = () => {
      d.pending = 0;
      const m = d.last;
      if (!st || st.drag !== d || !m) return;
      const kx = (startBox.w * rect.width + (m.clientX - ev.clientX)) / (startBox.w * rect.width);
      const ky = (startBox.h * rect.height + (m.clientY - ev.clientY)) / (startBox.h * rect.height);
      write(Math.max(minK, (kx + ky) / 2));
    };
    const move = (m) => {
      if (!st || st.drag !== d) return;
      d.moved = true;
      d.last = { clientX: m.clientX, clientY: m.clientY };
      if (!d.pending) d.pending = requestAnimationFrame(flush);
    };
    const end = (cancel) => {
      target.removeEventListener('pointermove', move);
      target.removeEventListener('pointerup', up);
      target.removeEventListener('pointercancel', up);
      if (d.pending) { cancelAnimationFrame(d.pending); d.pending = 0; }
      if (!st || st.drag !== d) return;
      if (cancel) { if (d.moved) write(1); } else if (d.moved) flush();
      st.drag = null;
      if (d.moved) { commit(true); renderSide(); }
    };
    const up = () => end(false);
    d.cancel = () => end(true);
    target.addEventListener('pointermove', move);
    target.addEventListener('pointerup', up);
    target.addEventListener('pointercancel', up);
  }

  // Boş alandan sürükleme: çerçeveye değen öğeler seçilir (Shift: seçime eklenir)
  function startMarquee(ev) {
    if (ev.button !== 0 || !st) return;
    ev.preventDefault();
    const rect = st.stage.getBoundingClientRect();
    const keep = ev.shiftKey || ev.ctrlKey || ev.metaKey ? new Set(st.picked) : new Set();
    const box = st.guides.marquee;
    const d = { marquee: true, moved: false, cancel: null };
    const at = (m) => ({ x: (m.clientX - rect.left) / rect.width, y: (m.clientY - rect.top) / rect.height });
    const a = at(ev);
    const target = st.overlay;
    target.setPointerCapture(ev.pointerId);
    const move = (m) => {
      const b = at(m);
      if (!d.moved && Math.hypot(m.clientX - ev.clientX, m.clientY - ev.clientY) < DRAG_START_PX) return;
      if (!d.moved) { d.moved = true; st.drag = d; }
      const r = { x: Math.min(a.x, b.x), y: Math.min(a.y, b.y), w: Math.abs(b.x - a.x), h: Math.abs(b.y - a.y) };
      box.hidden = false;
      box.style.left = (r.x * 100) + '%';
      box.style.top = (r.y * 100) + '%';
      box.style.width = (r.w * 100) + '%';
      box.style.height = (r.h * 100) + '%';
      const bounds = liveBounds();
      const hit = new Set(keep);
      elements().forEach((e) => {
        const q = boxOf(e, bounds);
        if (q && q.x < r.x + r.w && q.x + q.w > r.x && q.y < r.y + r.h && q.y + q.h > r.y) hit.add(e.id);
      });
      st.picked = hit;
      if (!st.sel || !hit.has(st.sel)) st.sel = Array.from(hit).pop() || null;
    };
    const end = () => {
      target.removeEventListener('pointermove', move);
      target.removeEventListener('pointerup', end);
      target.removeEventListener('pointercancel', end);
      box.hidden = true;
      if (!st) return;
      if (st.drag === d) st.drag = null;
      if (!d.moved) { if (!keep.size) select(null); return; }
      renderSide();
      paintTools();
    };
    d.cancel = end;
    target.addEventListener('pointermove', move);
    target.addEventListener('pointerup', end);
    target.addEventListener('pointercancel', end);
  }

  // Klavye karşılığı: + / − ölçeği değiştirir (Shift: on kat), sol üst köşe sabit
  function resizeKey(ev, id) {
    const dir = ev.key === '+' || ev.key === '=' ? 1 : ev.key === '-' || ev.key === '_' ? -1 : 0;
    if (!dir) return false;
    const e = find(id);
    if (!e || !LY().canResize(e.layer)) return false;
    ev.preventDefault();
    if (e.locked) return true;
    const it = snapshotOf(e, liveBounds(), P().cfg());
    if (!it) return true;
    const step = RESIZE_STEP * (ev.shiftKey ? 10 : 1);
    LY().resizeBy(e.layer, P().cfg(), it.box, it.startVals, 1 + dir * step);
    commit(false);
    renderSide();
    return true;
  }

  /* Başlangıç değerlerine döner, toplam kaymayı uygular (birikme hatası yok). Katman her
     seferinde kimliğiyle bulunur: sürükleme sırasında liste yeniden kurulmuş olabilir. */
  function applyMove(items, dx, dy) {
    const cfg = P().cfg();
    const byId = {};
    elements().forEach((e) => { byId[e.id] = e; });
    items.forEach((it) => {
      const e = byId[it.id];
      if (!e) return;
      Object.keys(it.startVals).forEach((k) => LY().setField(e.layer, cfg, k, it.startVals[k]));
      LY().moveBy(e.layer, cfg, dx, dy);
    });
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

  /* OK TUŞLARI: seçimin hepsi birlikte kayar (Shift: on kat, Ctrl: ince). Klavyeyle de
     çerçeveden tamamen çıkılmaz (sürüklemeyle aynı kural): sınır, seçimin ortak kutusuna
     uygulanır. Kilitli öğe taşınmaz. */
  function nudge(ev) {
    const k = ARROWS[ev.key];
    if (!k) return;
    const group = pickedEls().filter((e) => !e.locked);
    if (!group.length) return;
    const step = ev.ctrlKey || ev.metaKey ? NUDGE_FINE : ev.shiftKey ? NUDGE * 10 : NUDGE;
    let dx = k[0] * step;
    let dy = k[1] * step;
    const bounds = liveBounds();
    const box = LY().boundsOf(group.map((e) => boxOf(e, bounds)).filter(Boolean));
    if (box) {
      const r = st.stage.getBoundingClientRect();
      const to = LY().reachClamp({ x: box.x + dx, y: box.y + dy, w: box.w, h: box.h }, MIN_REACH_PX / (r.width || 1), MIN_REACH_PX / (r.height || 1));
      dx = to.x - box.x;
      dy = to.y - box.y;
      if (Math.abs(dx) < 1e-9 && Math.abs(dy) < 1e-9) return;
    }
    const cfg = P().cfg();
    group.forEach((e) => LY().moveBy(e.layer, cfg, dx, dy));
    commit(false);
    renderSide();
  }

  // Hizalama ve dağıtma: tek öğe çerçeveye, birden çok öğe seçimin sınırlarına
  function arrange(mode) {
    if (!st) return;
    const group = pickedEls().filter((e) => !e.locked);
    if (!group.length) return;
    const bounds = liveBounds();
    const boxes = group.map((e) => { const b = boxOf(e, bounds); return b ? { id: e.id, x: b.x, y: b.y, w: b.w, h: b.h } : null; }).filter(Boolean);
    const d = mode === 'dist-x' || mode === 'dist-y' ? LY().distributeDeltas(boxes, mode === 'dist-y' ? 'y' : 'x') : LY().alignDeltas(boxes, mode);
    const cfg = P().cfg();
    let any = false;
    group.forEach((e) => {
      const m = d[e.id];
      if (!m || (!m.dx && !m.dy)) return;
      LY().moveBy(e.layer, cfg, m.dx, m.dy);
      any = true;
    });
    if (any) { commit(true); renderSide(); }
  }

  // Çerçeve dışına taşan seçili öğeler içeri alınır (sığmayan ortalanır)
  function bringIn() {
    if (!st) return;
    const bounds = liveBounds();
    const cfg = P().cfg();
    let any = false;
    pickedEls().filter((e) => !e.locked).forEach((e) => {
      const now = boxOf(e, bounds);
      if (!now) return;
      const to = LY().intoFrame(now);
      if (Math.abs(to.x - now.x) < 1e-9 && Math.abs(to.y - now.y) < 1e-9) return;
      LY().moveBy(e.layer, cfg, to.x - now.x, to.y - now.y);
      any = true;
    });
    if (any) { commit(true); renderSide(); }
  }

  /* Görünürlük ve kilit, katman listesindekiyle aynı alanlara yazılır. Sessiz (muted)
     katman da "gizli" sayıldığı için göstermek ikisini birden açar. */
  function setFlag(id, key) {
    const e = find(id);
    if (!e) return;
    if (key === 'visible') {
      if (e.hidden) { e.layer.enabled = true; e.layer.muted = false; } else e.layer.enabled = false;
    } else if (key === 'locked') e.layer.locked = !e.layer.locked;
    else return;
    commit(true);
    renderSide();
    paintTools();
  }

  /* DÜZEN DOSYASI (#538): yerleştirilebilir öğeler, kullanıcı içeriği
     olmadan (src/shared/layout.js exportLayout). */
  function effectiveLayers() {
    return P().cfg().layers || [];
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
    if (!r || !r.ok) { if (r && r.error) P().toast(tr('İçe aktarılamadı:') + ' ' + r.error, 'err'); return; }
    const data = r.data;
    if (!data || data.type !== LY().LAYOUT_TYPE) { P().toast(tr('Bu bir düzen dosyası değil.'), 'err'); return; }
    const ok = await P().confirm(tr('Dosyadaki öğeler bu sahnede aynı türdeki öğelerin konumunu ve görünüşünü değiştirecek; eksik olanlar eklenecek. Logo görseliniz ve parça bilgileriniz değişmez.'), { okText: tr('Düzeni Uygula') });
    if (!ok || !st) return;
    const cfg = P().cfg();
    if (window.SVLayers && window.SVLayers.enableStack) window.SVLayers.enableStack(cfg);
    const res = LY().importLayout(cfg, data, (spec) => (window.SVLayers ? window.SVLayers.normalizeLayer(spec) : spec));
    if (!res.ok) { P().toast(tr('İçe aktarılamadı:') + ' ' + res.error, 'err'); return; }
    if (window.SVLayers && window.SVLayers.syncStackState) window.SVLayers.syncStackState(cfg);
    commit(true);
    refresh();
    P().toast(tr('Düzen uygulandı.'));
  }

  // Öğe listesi, seçimin sayısal alanları, açılış animasyonu, düzen dosyası
  function renderSide() {
    if (!st) return;
    st.sideSig = sideSigNow();
    const el = P().el;
    const side = st.side;
    // Yeniden kurulan yan panelde odak aynı denetime dönsün
    const active = document.activeElement;
    const focusKey = active && side.contains(active) && active.dataset ? active.dataset.k : null;
    const scroll = side.scrollTop;
    side.textContent = '';
    const els = elements();
    if (!els.length) {
      side.appendChild(el('div', { class: 'lay-empty', text: 'Bu sahnede yerleştirilebilir öğe yok. Barlar, çalan parça kartı, metin ya da logo katmanı ekleyin.' }));
      side.appendChild(fileRow(el));
      return;
    }
    const bounds = liveBounds();
    side.appendChild(el('div', { class: 'lay-sec-h' }, [
      el('span', { text: 'Öğeler' }),
      el('button', { type: 'button', class: 'btn tiny ghost', text: 'Tümünü Seç', 'data-k': 'all', onclick: selectAll }),
    ]));
    side.appendChild(el('div', { class: 'lay-list' }, els.map((e) => {
      const box = boxOf(e, bounds);
      const off = !box || LY().visibleFraction(box) < OFF_FRACTION;
      const badges = [];
      if (e.hidden) badges.push(tr('gizli'));
      else if (!e.drawn) badges.push(tr('çizilmiyor'));
      if (off) badges.push(tr('çerçeve dışında'));
      const picked = st.picked.has(e.id);
      const main = el('button', {
        type: 'button', class: 'lay-row-main', icon: KIND_ICONS[e.kind] || 'layers', 'data-k': 'row:' + e.id,
        'aria-pressed': picked ? 'true' : 'false',
        onclick: (ev) => {
          select(e.id, ev.shiftKey || ev.ctrlKey || ev.metaKey);
          const b = st.boxes[e.id];
          if (b && st.picked.has(e.id)) b.focus({ preventScroll: true });
        },
      }, [el('span', { class: 'lay-row-name', text: e.name, 'data-user-text': '' })].concat(badges.length ? [el('span', { class: 'lay-badge', text: badges.join(' · ') })] : []));
      const eye = el('button', {
        type: 'button', class: 'icon-btn small', icon: e.hidden ? 'eye-off' : 'eye', 'data-k': 'eye:' + e.id,
        title: e.hidden ? 'Göster' : 'Gizle', 'aria-label': e.hidden ? 'Göster' : 'Gizle', onclick: () => setFlag(e.id, 'visible'),
      });
      const lock = el('button', {
        type: 'button', class: 'icon-btn small' + (e.locked ? ' on' : ''), icon: e.locked ? 'lock' : 'unlock', 'data-k': 'lock:' + e.id,
        title: e.locked ? 'Kilidi Aç' : 'Kilitle', 'aria-label': e.locked ? 'Kilidi Aç' : 'Kilitle', onclick: () => setFlag(e.id, 'locked'),
      });
      return el('div', { class: 'lay-row' + (picked ? ' on' : '') + (e.hidden || !e.drawn ? ' is-hidden' : '') + (off ? ' off' : '') }, [main, eye, lock]);
    })));

    const cur = st.sel && els.find((e) => e.id === st.sel);
    if (!cur) {
      side.appendChild(el('div', { class: 'lay-note', text: 'Bir öğe seçin: önizlemede sürükleyin, ok tuşlarıyla taşıyın (Shift ile on kat) ya da değerleri yazın. Alt basılıyken yakalama kapanır.' }));
      side.appendChild(fileRow(el));
      restoreSide(side, focusKey, scroll);
      return;
    }
    const cfg = P().cfg();
    side.appendChild(el('div', { class: 'lay-sec-h' }, [el('span', { text: cur.name, 'data-user-text': '' })]));
    if (st.picked.size > 1) {
      side.appendChild(el('div', { class: 'lay-note', text: 'Birden çok öğe seçili: sürükleme, ok tuşları ve hizalama hepsine uygulanır. Aşağıdaki alanlar son seçilen öğenin.' }));
    }
    if (cur.locked) {
      side.appendChild(el('div', { class: 'lay-note', text: 'Katman kilitli; konumu değişmez. Kilidi listedeki düğmeyle açın.' }));
    } else if (cur.hidden || !cur.drawn) {
      side.appendChild(el('div', { class: 'lay-note', text: 'Bu katman şu an çizilmiyor (gizli, sessiz ya da solo dışında); kutusu ayarlarından hesaplandı.' }));
    }
    const fields = el('div', { class: 'lay-fields' });
    LY().KINDS[cur.kind].fields.forEach((f) => {
      const inp = el('input', { type: 'number', class: 'num', min: String(f.min), max: String(f.max), step: String(f.step), 'data-k': 'f:' + f.key });
      inp.value = String(LY().getField(cur.layer, cfg, f.key));
      if (cur.locked) inp.disabled = true;
      inp.addEventListener('change', () => {
        const now = find(cur.id);
        if (!now) return;
        if (LY().setField(now.layer, P().cfg(), f.key, inp.value)) commit(true);
        inp.value = String(LY().getField(now.layer, P().cfg(), f.key));
      });
      fields.appendChild(el('label', { class: 'lay-field' }, [el('span', { class: 'lay-field-l', text: f.label }), inp]));
    });
    side.appendChild(fields);
    /* Biçem önayarı ve metin kaynağı (#536). Seçim katmanın kendi
       ayarına yazılır; renk değişmez. */
    if (cur.kind === 'text' || cur.kind === 'nowplaying') {
      const sel = el('select', { class: 'sel-ctrl', 'data-k': 'style' });
      const now = LY().styleIdOf(cur.layer, cfg);
      if (!now) sel.appendChild(el('option', { value: '', text: 'Özel' }));
      Object.keys(LY().STYLES).forEach((id) => {
        const o = el('option', { value: id, text: LY().STYLES[id].name });
        if (id === now) o.selected = true;
        sel.appendChild(o);
      });
      sel.addEventListener('change', () => {
        if (LY().applyStyle(cur.layer, P().cfg(), sel.value)) { commit(true); renderSide(); }
      });
      side.appendChild(el('label', { class: 'lay-field wide' }, [el('span', { class: 'lay-field-l', text: 'Biçem' }), sel]));
    }
    if (cur.kind === 'text') {
      const src = el('select', { class: 'sel-ctrl', 'data-k': 'src' });
      const v = LY().textSourceOf(cur.layer, cfg);
      LY().TEXT_SOURCES.forEach(([a, b, label]) => {
        const val = a === 'static' ? 'static' : a + ':' + b;
        const o = el('option', { value: val, text: label });
        if (val === v) o.selected = true;
        src.appendChild(o);
      });
      src.addEventListener('change', () => {
        if (LY().setTextSource(cur.layer, P().cfg(), src.value)) { commit(true); renderSide(); }
      });
      side.appendChild(el('label', { class: 'lay-field wide' }, [el('span', { class: 'lay-field-l', text: 'Yazı Kaynağı' }), src]));
      if (v === 'static') {
        const sec = LY().sectionOf(cur.layer, cfg, false);
        const inp = el('input', { type: 'text', class: 'txt', value: sec.content || '', 'data-user-attr': '', 'data-k': 'content' });
        inp.addEventListener('change', () => { LY().sectionOf(cur.layer, P().cfg(), true).content = inp.value; commit(true); });
        side.appendChild(el('label', { class: 'lay-field wide' }, [el('span', { class: 'lay-field-l', text: 'Yazı İçeriği' }), inp]));
      } else {
        side.appendChild(el('div', { class: 'lay-note', text: 'Çalan parça sistemden okunur; okunamazsa Çalan Parça katmanına elle yazılan parça bilgisi çizilir.' }));
      }
    }
    if (LY().canResize(cur.layer)) {
      side.appendChild(el('div', { class: 'lay-note', text: 'Boyut: kutunun sağ alt köşesinden sürükleyin ya da kutu seçiliyken + ve − tuşlarına basın (Shift ile on kat).' }));
    }
    renderReveal(side, cur);
    side.appendChild(el('div', { class: 'lay-note', text: 'Değerler karenin oranı (0–1). Güvenli alanlar SMPTE ST 2046-1 ve EBU R 95: kesikli çizgi aksiyon (%93), noktalı çizgi başlık (%90).' }));
    side.appendChild(el('div', { class: 'lay-note', text: 'Taralı alanlar 9:16 ve 1:1\'de kısa video uygulamalarının arayüzünün kapladığı yerler; yazı ve logo dışında kalsın. Yalnız kılavuz, videoya girmez.' }));
    side.appendChild(fileRow(el));
    restoreSide(side, focusKey, scroll);
  }

  function restoreSide(side, focusKey, scroll) {
    side.scrollTop = scroll;
    if (!focusKey) return;
    const again = Array.from(side.querySelectorAll('[data-k]')).find((n) => n.dataset.k === focusKey);
    if (again && !again.disabled) again.focus({ preventScroll: true });
  }

  function fileRow(el) {
    return el('div', { class: 'lay-files' }, [
      el('button', { type: 'button', class: 'btn ghost small', icon: 'export', text: 'Düzeni Dışa Aktar', 'data-k': 'export', onclick: exportFile }),
      el('button', { type: 'button', class: 'btn ghost small', icon: 'import', text: 'Düzeni İçe Aktar', 'data-k': 'import', onclick: importFile }),
    ]);
  }

  /* AÇILIŞ ANİMASYONU (#537): seçili öğenin türü, süresi, gecikmesi.
     Ayar katmana (yığın) ya da bölüme (katmansız) yazılır; çizim
     shared/reveal.js'ten, canlı ve dışa aktarımda aynı. */
  const REVEAL_TYPES = [
    ['none', 'Yok'], ['fade', 'Belirme'], ['slideUp', 'Yukarı Kayma'], ['slideDown', 'Aşağı Kayma'],
    ['slideLeft', 'Sola Kayma'], ['slideRight', 'Sağa Kayma'], ['scale', 'Büyüme'], ['wipe', 'Silme'],
  ];
  const REVEAL_EASES = [['out', 'Yavaşlayarak'], ['smooth', 'Yumuşak Giriş-Çıkış'], ['linear', 'Doğrusal'], ['back', 'Esneyerek']];

  function revealNum(label, key, value, min, max, step, onSet) {
    const el = P().el;
    const inp = el('input', { type: 'number', class: 'num', min: String(min), max: String(max), step: String(step), 'data-k': 'r:' + key });
    inp.value = String(value);
    inp.addEventListener('change', () => {
      const v = Number(inp.value);
      if (!Number.isFinite(v)) { inp.value = String(value); return; }
      onSet(Math.max(min, Math.min(max, v)));
    });
    return el('label', { class: 'lay-field' }, [el('span', { class: 'lay-field-l', text: label }), inp]);
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
      commit(true);
      if (again) renderSide();
    };
    side.appendChild(el('div', { class: 'lay-sec-h' }, [el('span', { text: 'Açılış Animasyonu' })]));
    const type = el('select', { class: 'sel-ctrl', 'data-k': 'r:type' });
    REVEAL_TYPES.forEach(([v, label]) => { const o = el('option', { value: v, text: label }); if (v === spec.type) o.selected = true; type.appendChild(o); });
    type.addEventListener('change', () => write({ type: type.value }, true));
    side.appendChild(el('label', { class: 'lay-field wide' }, [el('span', { class: 'lay-field-l', text: 'Açılış Türü' }), type]));
    if (R.active(spec)) {
      const fields = el('div', { class: 'lay-fields' });
      fields.appendChild(revealNum('Açılış Süresi (sn)', 'duration', spec.duration, 0, 10, 0.05, (v) => write({ duration: v })));
      fields.appendChild(revealNum('Gecikme (sn)', 'delay', spec.delay, 0, 60, 0.05, (v) => write({ delay: v })));
      if (/^slide/.test(spec.type)) fields.appendChild(revealNum('Kayma Mesafesi', 'distance', spec.distance, 0, 0.5, 0.01, (v) => write({ distance: v })));
      side.appendChild(fields);
      const ez = el('select', { class: 'sel-ctrl', 'data-k': 'r:ease' });
      REVEAL_EASES.forEach(([v, label]) => { const o = el('option', { value: v, text: label }); if (v === spec.ease) o.selected = true; ez.appendChild(o); });
      ez.addEventListener('change', () => write({ ease: ez.value }));
      side.appendChild(el('label', { class: 'lay-field wide' }, [el('span', { class: 'lay-field-l', text: 'Hız Eğrisi' }), ez]));
    }
    side.appendChild(el('div', { class: 'lay-acts' }, [
      el('button', { type: 'button', class: 'btn ghost small', icon: 'play', text: 'Açılışı Oynat', 'data-k': 'r:play', onclick: replayReveal }),
      el('button', { type: 'button', class: 'btn ghost small', text: 'Sırayla Geciktir', 'data-k': 'r:stagger', onclick: staggerReveal }),
    ]));
    side.appendChild(el('div', { class: 'lay-note', text: 'Öğe videonun başında, sahne yüklenince ya da "Açılışı Oynat" ile gelir; aynı sahnede kalan öğe yeniden oynamaz. Yazının ve parça kartının kendi giriş canlandırması içerik değişince oynar; açılış onun üstüne bir kez uygulanır.' }));
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
    commit(true);
    renderSide();
  }

  window.SVLayoutEditor = { open, close, isOpen: () => !!st, setView, _elements: elements };
})();
