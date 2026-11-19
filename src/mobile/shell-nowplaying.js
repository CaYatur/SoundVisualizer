/*
 * SoundVisualizer — CaYaDev Ses Görselleştirici
 * Copyright (c) 2026 Çağan Turgut (CaYatur) — CaYaDev, https://cayadev.com
 * https://github.com/CaYatur/SoundVisualizer
 * SPDX-License-Identifier: MIT
 */
'use strict';
/* ÇALAN PARÇA KATMANININ AYARLARI (masaüstündeki src/admin/scene-panels.js nowplaying* kartları).

   Aynı alanlar, aynı varsayılanlar ve aynı öncelik: katmanın `settings.nowplaying` değeri kök
   `cfg.nowplaying`'in üstüne yazılır, kalıba bağlı alanlar boşsa kalıptan gelir (SVNowPlaying).
   Masaüstünde süre ve çubuk yalnız Windows medya oturumunda açık; telefonda da sistem oturumu
   var (media/NowPlaying.kt), bu yüzden burada hep sunulur. android/js-tests/nowplaying-panel.test.js
   masaüstündeki alanların burada da olduğunu denetler. */
(function () {
  if (typeof window === 'undefined' || !window.SVShell || !window.SVShellUI) return;
  const S = window.SVShell;
  const U = window.SVShellUI;
  const { h, icon, A } = S;
  const tr = (s) => (window.SVI18n && window.SVI18n.t ? window.SVI18n.t(s) : s);

  const FONTS = [
    ['', 'Metin Katmanıyla Aynı'],
    ['system-ui, -apple-system, Segoe UI, Roboto, sans-serif', 'Sistem'],
    ['Georgia, "Times New Roman", serif', 'Serif'],
    ['ui-monospace, "Cascadia Code", Consolas, monospace', 'Tek Aralıklı'],
    ['Impact, "Arial Black", sans-serif', 'Ağır Başlık'],
    ['"Trebuchet MS", "Segoe UI", sans-serif', 'Yuvarlak'],
  ];
  const ANIMS = [['none', 'Yok'], ['fade', 'Belirme'], ['slideUp', 'Yukarı Kayma'], ['slideLeft', 'Yana Kayma'], ['scale', 'Büyüme'], ['typewriter', 'Daktilo'], ['wipe', 'Silme']];
  const ALIGNS = [['left', 'Sola'], ['center', 'Ortaya'], ['right', 'Sağa']];

  function parseClock(v) {
    const p = String(v || '').trim().split(':').map((x) => parseInt(x, 10) || 0);
    return p.reduce((sum, x) => sum * 60 + x, 0);
  }

  /* Okuma ve yazma: katman → kök → varsayılan. */
  function bag(getLayer, set) {
    const root = () => (A().config.get() || {}).nowplaying || {};
    const np = () => { const l = getLayer(); return (l && l.settings && l.settings.nowplaying) || {}; };
    const get = (k, fb) => { const a = np()[k]; if (a != null) return a; const b = root()[k]; return b != null ? b : fb; };
    const puts = (o) => set((x) => { x.settings = x.settings || {}; x.settings.nowplaying = Object.assign({}, x.settings.nowplaying, o); });
    const put = (k, v) => puts({ [k]: v });
    const showOf = () => Object.assign({}, root().show || {}, np().show || {});
    const setShow = (k, v) => puts({ show: Object.assign({}, showOf(), { [k]: v }) });
    const style = () => window.SVNowPlaying.styleOf(get('style', 'modern'));
    const manual = () => Object.assign({ title: '', artist: '', album: '', duration: 0 }, root().manual, np().manual);
    const setManual = (k, v) => puts({ manual: Object.assign(manual(), { [k]: v }) });
    const fromSystem = () => get('source', 'system') === 'system';
    return { get, put, puts, showOf, setShow, style, manual, setManual, fromSystem };
  }

  /* Telefonun o an okuduğu parça. Satır belgeden çıkınca zamanlayıcı da durur. */
  function liveRow() {
    const N = window.SVNowPlaying;
    const line = h('div', { class: 'row-sub', 'data-user-text': '' });
    const paint = () => {
      const cur = A().nowPlaying ? A().nowPlaying.current() : null;
      if (!cur || !cur.has) { line.textContent = tr('Şu anda bir şey çalmıyor'); return; }
      const st = N.resolve(cur, Date.now());
      const who = [cur.title, cur.artist].filter(Boolean).join(' — ');
      line.textContent = who + (!st.live && st.duration > 0 ? '  ·  ' + N.fmtTime(st.position) + ' / ' + N.fmtTime(st.duration) : '');
    };
    paint();
    const tick = setInterval(() => { if (!line.isConnected) clearInterval(tick); else paint(); }, 500);
    return U.row('Canlı Medya', [h('div', { class: 'row-text' }, [line])]);
  }

  // ---- İçerik: kaynak, görünme zamanı, yerleşim, renk ----
  function contentKids(b, set, getLayer, redo) {
    const out = [U.seg({ label: 'Kaynak', options: [['system', 'Sistemden Oku'], ['manual', 'Elle Yaz']], value: b.get('source', 'system'), onChange: (v) => { b.put('source', v); redo(); } })];
    if (b.fromSystem()) out.push(liveRow());
    else {
      const m = b.manual();
      out.push(U.text({ label: 'Parça Adı', value: m.title, onInput: (v) => b.setManual('title', v) }));
      out.push(U.text({ label: 'Sanatçı', value: m.artist, onInput: (v) => b.setManual('artist', v) }));
      out.push(U.text({ label: 'Albüm', value: m.album, onInput: (v) => b.setManual('album', v) }));
      out.push(U.text({ label: 'Süre', placeholder: '3:24', value: m.duration ? window.SVNowPlaying.fmtTime(m.duration) : '', onInput: (v) => b.setManual('duration', parseClock(v)) }));
    }
    out.push(U.select({ label: 'Ne Zaman', options: [['always', 'Sürekli Görünsün'], ['onChange', 'Parça Değişince']], value: b.get('mode', 'always'), onChange: (v) => { b.put('mode', v); redo(); } }));
    if (b.get('mode', 'always') === 'onChange') {
      const sp = window.SVNowPlaying.speedOf(b.get('speed', 'normal'));
      out.push(U.select({ label: 'Hız', options: [['fast', 'Hızlı'], ['normal', 'Normal'], ['slow', 'Yavaş']], value: b.get('speed', 'normal'), onChange: (v) => { b.puts({ speed: v, animDuration: null, holdSeconds: null }); redo(); } }));
      out.push(U.slider({ label: 'Ekranda Kalma', min: 0.5, max: 20, step: 0.5, value: b.get('holdSeconds', sp.hold), def: sp.hold, format: (v) => U.num(v, 1) + ' ' + tr('sn'), onInput: (v) => b.put('holdSeconds', v) }));
    }
    out.push(U.select({ label: 'Hizalama', options: ALIGNS, value: b.get('align', 'center'), def: 'center', onChange: (v) => b.put('align', v) }));
    out.push(U.slider({ label: 'Dikey Konum', min: 0, max: 1, step: 0.005, percent: true, value: b.get('y', 0.86), def: 0.86, onInput: (v) => b.put('y', v) }));
    out.push(U.select({ label: 'Dikey Hiza', options: [['top', 'Üst'], ['middle', 'Orta'], ['bottom', 'Alt']], value: b.get('vAlign', 'middle'), def: 'middle', onChange: (v) => b.put('vAlign', v) }));
    out.push(U.slider({ label: 'Boyut', min: 0.015, max: 0.16, step: 0.002, value: b.get('size', 0.042), def: 0.042, format: (v) => '%' + U.num(v * 100, 1), onInput: (v) => b.put('size', v) }));
    // Renk: katmanın kendi kipi; görselleştirici ayarı da aynı kipe çekilir (masaüstündeki gibi)
    const mode = b.get('colorMode', null) || (b.get('useCustomColor', false) ? 'custom' : 'theme');
    out.push(U.seg({
      label: 'Renk Modu', options: [['custom', 'Sabit Renk'], ['theme', 'Renk Teması'], ['rainbow', 'Gökkuşağı']], value: mode,
      onChange: (v) => {
        set((x) => {
          x.settings = x.settings || {};
          x.settings.nowplaying = Object.assign({}, x.settings.nowplaying, { colorMode: v, useCustomColor: v === 'custom' });
          x.settings.visualizer = Object.assign({}, x.settings.visualizer, { colorMode: v, rainbow: v === 'rainbow' });
        });
        redo();
      },
    }));
    if (mode === 'theme' && pageCtx && window.SVShellScene) out.push(window.SVShellScene.themeRow(pageCtx));
    if (mode === 'custom') {
      out.push(U.color({ label: 'Parça Adı', value: b.get('color', '#ffffff'), onInput: (v) => b.put('color', v) }));
      out.push(U.color({ label: 'İkincil Yazı', value: b.get('colorDim', '#c8c8d0'), onInput: (v) => b.put('colorDim', v) }));
      if (b.fromSystem()) out.push(U.color({ label: 'Çubuk', value: b.get('colorBar', '#3aa6ff'), onInput: (v) => b.put('colorBar', v) }));
    }
    return out;
  }

  // ---- Yazı: görünen alanlar ve yazı biçimi ----
  function typeKids(b, redo) {
    const show = (k, label, def) => U.toggle({ label, value: b.showOf()[k] === undefined ? def : !!b.showOf()[k], onChange: (v) => { b.setShow(k, v); redo(); } });
    const out = [show('title', 'Parça Adı', true), show('artist', 'Sanatçı', true), show('album', 'Albüm', false)];
    if (b.fromSystem()) {
      out.push(show('appName', 'Oynatıcı Adı', false), show('elapsed', 'Geçen Süre', true), show('remaining', 'Kalan Süre', false), show('total', 'Toplam Süre', true));
    }
    out.push(U.toggle({ label: 'Parça ve Sanatçı Tek Satırda', value: !!b.get('oneLine', false), onChange: (v) => { b.put('oneLine', v); redo(); } }));
    if (b.get('oneLine', false)) out.push(U.text({ label: 'Ayırıcı', value: b.get('separator', ' — '), onInput: (v) => b.put('separator', v) }));
    if (b.fromSystem()) out.push(U.text({ label: 'Süre Ayırıcı', value: b.get('timeSeparator', ' / '), onInput: (v) => b.put('timeSeparator', v) }));
    const st = b.style();
    out.push(U.seg({
      label: 'Kalıp', options: [['modern', 'Modern'], ['og', 'OG (Klasik)']], value: b.get('style', 'modern'),
      onChange: (v) => { b.puts({ style: v, weight: null, outline: null, shadow: null, uppercase: null, barHeight: null, barSegments: null, barRadius: null, barBackOpacity: null }); redo(); },
    }));
    out.push(U.select({ label: 'Yazı Tipi', options: FONTS, value: b.get('font', ''), onChange: (v) => b.put('font', v) }));
    out.push(U.slider({ label: 'Kalınlık', min: 100, max: 900, step: 100, value: b.get('weight', st.weight), def: st.weight, onInput: (v) => b.put('weight', Math.round(v / 100) * 100) }));
    out.push(U.toggle({ label: 'Büyük Harf', value: !!b.get('uppercase', st.uppercase), def: !!st.uppercase, onChange: (v) => b.put('uppercase', v) }));
    out.push(U.slider({ label: 'Satır Aralığı', min: 0, max: 1.2, step: 0.02, value: b.get('lineGap', 0.32), def: 0.32, onInput: (v) => b.put('lineGap', v) }));
    out.push(U.slider({ label: 'Yazı Saydamlığı', min: 0, max: 1, step: 0.01, percent: true, value: b.get('opacity', 1), def: 1, onInput: (v) => b.put('opacity', v) }));
    out.push(U.slider({ label: 'Kontur', min: 0, max: 1, step: 0.02, value: b.get('outline', st.outline), def: st.outline, onInput: (v) => b.put('outline', v) }));
    out.push(U.slider({ label: 'Gölge', min: 0, max: 1, step: 0.02, value: b.get('shadow', st.shadow), def: st.shadow, onInput: (v) => b.put('shadow', v) }));
    out.push(U.slider({ label: 'En Fazla Genişlik', min: 0.2, max: 1, step: 0.01, percent: true, value: b.get('maxWidth', 0.8), def: 0.8, onInput: (v) => b.put('maxWidth', v) }));
    out.push(U.toggle({ label: 'Uzun Adları Kaydır', value: b.get('scrollLongTitles', true) !== false, def: true, onChange: (v) => { b.put('scrollLongTitles', v); redo(); } }));
    if (b.get('scrollLongTitles', true) !== false) {
      out.push(U.slider({ label: 'Kaydırma Hızı', min: 0.25, max: 4, step: 0.05, value: b.get('scrollSpeed', 1), def: 1, format: (v) => U.num(v, 2) + '×', onInput: (v) => b.put('scrollSpeed', v) }));
    }
    return out;
  }

  // ---- İlerleme çubuğu ----
  function barKids(b, redo) {
    if (!b.fromSystem()) return [h('div', { class: 'hint', text: 'İlerleme çubuğu yalnız sistemden okunan parçada çizilir.' })];
    const on = b.showOf().bar !== false;
    const out = [U.toggle({ label: 'İlerleme Çubuğu', value: on, onChange: (v) => { b.setShow('bar', v); redo(); } })];
    if (!on) return out;
    const st = b.style();
    out.push(U.slider({ label: 'Genişlik', min: 0.05, max: 1, step: 0.01, percent: true, value: b.get('barWidth', 0.42), def: 0.42, onInput: (v) => b.put('barWidth', v) }));
    out.push(U.slider({ label: 'Çubuk Kalınlığı', min: 0.001, max: 0.04, step: 0.001, value: b.get('barHeight', st.barHeight), def: st.barHeight, format: (v) => '%' + U.num(v * 100, 1), onInput: (v) => b.put('barHeight', v) }));
    out.push(U.slider({ label: 'Bölme Sayısı', min: 0, max: 80, step: 1, value: b.get('barSegments', st.barSegments), def: st.barSegments, format: (v) => (v < 1 ? tr('kesintisiz') : Math.round(v) + ' ' + tr('bölme')), onInput: (v) => b.put('barSegments', Math.round(v)) }));
    out.push(U.slider({ label: 'Yazıyla Arası', min: 0, max: 2, step: 0.05, value: b.get('barGap', 0.5), def: 0.5, onInput: (v) => b.put('barGap', v) }));
    out.push(U.slider({ label: 'Zemin Koyuluğu', min: 0, max: 1, step: 0.02, percent: true, value: b.get('barBackOpacity', st.barBackOpacity), def: st.barBackOpacity, onInput: (v) => b.put('barBackOpacity', v) }));
    return out;
  }

  // ---- Albüm kapağı ----
  function coverKids(b, redo) {
    const out = [U.toggle({ label: 'Kapağı Göster', value: !!b.get('coverOverlay', false), onChange: (v) => { b.put('coverOverlay', !!v); redo(); } })];
    if (!b.get('coverOverlay', false)) return out;
    out.push(h('div', { class: 'hint', text: 'Çalan parçanın albüm kapağını yazının yanına veya üstüne yerleştirir. Boyut ekranın kısa kenarına göredir. Kapak yoksa bindirme çizilmez.' }));
    out.push(U.seg({ label: 'Kapak Kaynağı', options: [['auto', 'Otomatik (Sistem)'], ['manual', 'Elle Yükle']], value: b.get('coverSource', 'auto'), onChange: (v) => { b.put('coverSource', v); redo(); } }));
    const art = b.manual().artwork || '';
    out.push(U.row('Kapak', [
      art ? h('img', { class: 'thumb xs', src: art, alt: '' }) : null,
      h('div', { class: 'spacer' }),
      art ? h('button', { class: 'btn ghost', onclick: () => { b.setManual('artwork', ''); redo(); } }, [h('span', { text: 'Kapağı Kaldır' })]) : null,
      h('button', {
        class: 'btn',
        onclick: () => A().media.pick('image').then((f) => { b.setManual('artwork', f.dataUrl); redo(); }, (e) => {
          const code = String((e && e.message) || e);
          if (code !== 'cancelled') S.confirm(tr('Dosya açılamadı.') + ' (' + code + ')', 'Tamam');
        }),
      }, [icon('image'), h('span', { text: art ? 'Kapağı Değiştir' : 'Kapak Seç' })]),
    ].filter(Boolean)));
    out.push(U.slider({ label: 'Kapak Boyutu', min: 0.05, max: 0.5, step: 0.01, percent: true, value: b.get('coverSize', 0.14), def: 0.14, onInput: (v) => b.put('coverSize', v) }));
    out.push(U.slider({ label: 'Yazı Aralığı', min: 0, max: 1, step: 0.02, percent: true, value: b.get('coverGap', 0.35), def: 0.35, onInput: (v) => b.put('coverGap', v) }));
    out.push(U.slider({ label: 'Köşe / Oval', min: 0, max: 0.5, step: 0.01, percent: true, value: b.get('coverRadius', 0.14), def: 0.14, onInput: (v) => b.put('coverRadius', v) }));
    out.push(U.select({ label: 'Kapak Sığdırma', options: [['natural', 'Doğal oran'], ['square', 'Kareye ger'], ['cover', 'Kareye kapla'], ['contain', 'Kareye sığdır']], value: b.get('coverFit', 'natural'), def: 'natural', onChange: (v) => b.put('coverFit', v) }));
    out.push(U.select({ label: 'Kapak Konumu', options: [['auto', 'Otomatik (Üstte)'], ['left', 'Solda'], ['right', 'Sağda'], ['top', 'Üstte']], value: b.get('coverSide', 'auto'), def: 'auto', onChange: (v) => b.put('coverSide', v) }));
    out.push(U.slider({ label: 'Kapak Bas Nabzı', min: 0, max: 0.4, step: 0.01, value: b.get('coverAudioScale', 0), def: 0, onInput: (v) => b.put('coverAudioScale', v) }));
    return out;
  }

  // ---- Hareket ve ses ----
  function motionKids(b) {
    const sp = window.SVNowPlaying.speedOf(b.get('speed', 'normal'));
    return [
      U.select({ label: 'Giriş', options: ANIMS, value: b.get('animation', 'slideUp'), def: 'slideUp', onChange: (v) => b.put('animation', v) }),
      U.slider({ label: 'Giriş Süresi', min: 0.05, max: 3, step: 0.05, value: b.get('animDuration', sp.anim), def: sp.anim, format: (v) => U.num(v, 2) + ' ' + tr('sn'), onInput: (v) => b.put('animDuration', v) }),
      U.slider({ label: 'Bas Nabzı', min: 0, max: 0.4, step: 0.01, value: b.get('audioScale', 0.04), def: 0.04, onInput: (v) => b.put('audioScale', v) }),
    ];
  }

  let tab = 'content';
  /** Katmanın Kaynak sekmesi. getLayer: güncel katman; set: katman kopyasını değiştirip yazar. */
  let pageCtx = null;
  function controls(getLayer, set, ctx) {
    pageCtx = ctx || null;
    const b = bag(getLayer, set);
    const pane = h('div', { class: 'edit-pane' });
    const show = (id) => {
      tab = id;
      pane.textContent = '';
      const redo = () => show(tab);
      const kids = id === 'type' ? typeKids(b, redo) : id === 'bar' ? barKids(b, redo) : id === 'cover' ? coverKids(b, redo)
        : id === 'motion' ? motionKids(b) : contentKids(b, set, getLayer, redo);
      pane.appendChild(U.card(kids));
    };
    const tabs = U.tabs([['content', 'İçerik'], ['type', 'Yazı'], ['bar', 'Çubuk'], ['cover', 'Kapak'], ['motion', 'Hareket']], tab, show);
    show(tab);
    return [tabs, pane];
  }

  window.SVShellNowPlaying = Object.freeze({ controls });
})();
