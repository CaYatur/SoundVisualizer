/*
 * SoundVisualizer — CaYaDev Ses Görselleştirici
 * Copyright (c) 2026 Çağan Turgut (CaYatur) — CaYaDev, https://cayadev.com
 * https://github.com/CaYatur/SoundVisualizer
 * SPDX-License-Identifier: MIT
 */
'use strict';
/* METİN VE ŞARKI SÖZÜ KATMANININ AYARLARI (masaüstündeki src/admin/scene-panels.js metin kartı ve
   src/admin/lyrics-lib-ui.js block).

   Aynı alanlar ve aynı varsayılanlar: sabit yazı, çalan parça ve şarkı sözü; karaoke dolumu, sabit
   renkte metin ve vurgu rengi, yazı biçimi, yerleşim, giriş ve ses tepkisi. Dosya yükleme yerine söz
   kitaplıktan seçilir. android/js-tests/nowplaying-panel.test.js masaüstündeki alanların burada da
   olduğunu denetler. */
(function () {
  if (typeof window === 'undefined' || !window.SVShell || !window.SVShellUI) return;
  const S = window.SVShell;
  const U = window.SVShellUI;
  const { h, icon, A } = S;
  const tr = (s) => (window.SVI18n && window.SVI18n.t ? window.SVI18n.t(s) : s);
  const sec = (v, d) => U.num(v, d) + ' ' + tr('sn');

  const FONTS = [
    ['system-ui, -apple-system, Segoe UI, Roboto, sans-serif', 'Sistem'],
    ['Georgia, "Times New Roman", serif', 'Serif'],
    ['ui-monospace, "Cascadia Code", Consolas, monospace', 'Tek Aralıklı'],
    ['Impact, "Arial Black", sans-serif', 'Ağır Başlık'],
    ['"Trebuchet MS", "Segoe UI", sans-serif', 'Yuvarlak'],
  ];
  const ANIMS = [['none', 'Yok'], ['fade', 'Belirme'], ['slideUp', 'Yukarı Kayma'], ['slideLeft', 'Yana Kayma'], ['scale', 'Büyüme']];
  const ALIGNS = [['left', 'Sola'], ['center', 'Ortaya'], ['right', 'Sağa']];

  // ---- Şarkı sözü ----
  function lyricsStatus(t) {
    const Sy = window.SVLyricsSync;
    const live = window.SVNowLive && window.SVNowLive.state;
    if (!live || !live.has || !(live.title || live.artist)) return 'Çalan parça yok: Ses sekmesinden bildirim erişimi verin ya da uygulama içi çaları kullanın.';
    const lib = (window.SVLyricsLib && window.SVLyricsLib.items) || [];
    const hit = Sy && Sy.matchTrack ? Sy.matchTrack({ title: live.title, artist: live.artist }, lib, t.lyricsMatch || 'exact') : null;
    if (hit && hit.item) return tr('Eşleşen söz') + ': ' + (hit.item.name || hit.item.title || '') + (hit.item.auto ? ' (' + tr('otomatik') + ')' : '');
    return tr('Bu parça için kitaplıkta söz yok') + ': ' + [live.artist, live.title].filter(Boolean).join(' - ');
  }
  function lyricsKids(t, put, puts, redo) {
    const follow = t.lyricsFollow === true;
    const out = [
      U.toggle({ label: 'Çalan Parçayı İzle', value: follow, def: true, onChange: (v) => { put('lyricsFollow', !!v); redo(); } }),
      h('div', { class: 'hint', text: 'Söz kütüphanesindeki dosyayla eşleşir ve çalan parçanın süresiyle gider.' }),
    ];
    if (follow) {
      out.push(U.select({ label: 'Eşleme', options: [['exact', 'Tam Eşleme'], ['partial', 'Kısmen Eşleme']], value: t.lyricsMatch || 'exact', def: 'exact', onChange: (v) => { put('lyricsMatch', v === 'partial' ? 'partial' : 'exact'); redo(); } }));
      out.push(h('div', { class: 'hint', 'data-user-text': '', text: lyricsStatus(t) }));
    } else {
      // İzleme kapalıyken söz kitaplıktan seçilir ve ekran saatiyle akar
      const items = ((window.SVLyricsLib && window.SVLyricsLib.items) || []).filter((x) => x && x.text);
      out.push(U.select({
        label: 'Söz Dosyası', options: [['', tr('yüklü dosya yok')]].concat(items.map((x) => [x.id, x.name || x.title || x.id])),
        value: (items.find((x) => x.text === t.lyricsSource) || {}).id || '',
        onChange: (id) => { const it = items.find((x) => x.id === id); puts({ lyricsSource: it ? it.text : '', lyricsName: it ? (it.name || it.title || '') : '' }); },
      }));
    }
    out.push(h('button', { class: 'btn', onclick: () => { if (window.SVShellLibrary && window.SVShellLibrary.lyrics) window.SVShellLibrary.lyrics(); } }, [icon('library'), 'Söz Kütüphanesi']));
    out.push(U.slider({ label: 'Senkron Kayması', min: -10, max: 10, step: 0.05, value: t.offset || 0, def: 0, format: (v) => (v > 0 ? '+' : '') + sec(v, 2), onInput: (v) => put('offset', v) }));
    out.push(U.toggle({ label: 'Karaoke Vurgusu', value: t.karaoke !== false, def: true, onChange: (v) => { put('karaoke', !!v); redo(); } }));
    if (t.karaoke !== false) {
      out.push(U.select({ label: 'Karaoke Dolumu', options: [['word', 'Kelime Kelime'], ['progressive', 'Kelime İçinde Akan']], value: t.karaokeFill == null ? 'progressive' : t.karaokeFill, def: 'progressive', onChange: (v) => put('karaokeFill', v) }));
      out.push(U.toggle({ label: 'Uzatılan Heceyi Esnet', value: t.karaokeHold === true, def: false, onChange: (v) => { put('karaokeHold', !!v); redo(); } }));
      if (t.karaokeHold === true) {
        out.push(U.slider({ label: 'Esneme Eşiği', min: 0.2, max: 3, step: 0.05, value: t.karaokeHoldMin == null ? 0.6 : t.karaokeHoldMin, def: 0.6, format: (v) => sec(v, 2), onInput: (v) => put('karaokeHoldMin', v) }));
        out.push(U.slider({ label: 'Esneme Miktarı', min: 0, max: 1, step: 0.01, percent: true, value: t.karaokeHoldAmount == null ? 0.25 : t.karaokeHoldAmount, def: 0.25, onInput: (v) => put('karaokeHoldAmount', v) }));
      }
    }
    return out;
  }

  // ---- Çalan parça ----
  function nowKids(t, put, puts, redo) {
    const auto = (t.nowSource || 'system') === 'system';
    const np = t.nowPlaying || {};
    const field = t.field || 'both';
    const setNp = (k, v) => {
      const o = { nowPlaying: Object.assign({}, np, { [k]: v }) };
      if (field !== 'both') o.content = v;
      np[k] = v;
      puts(o);
    };
    const out = [
      U.select({ label: 'Gösterilen Alan', options: [['title', 'Parça Adı'], ['artist', 'Sanatçı Adı'], ['both', 'Parça ve Sanatçı']], value: field, onChange: (v) => { put('field', v); redo(); } }),
      U.toggle({ label: 'Sistemden Otomatik Doldur', value: auto, onChange: (v) => { put('nowSource', v ? 'system' : 'manual'); redo(); } }),
      U.toggle({ label: 'Şarkı Resmini Göster', value: t.showArtwork !== false, onChange: (v) => put('showArtwork', !!v) }),
    ];
    const cur = A().nowPlaying ? A().nowPlaying.current() : null;
    if (cur && cur.has && (cur.title || cur.artist)) {
      out.push(h('button', {
        class: 'btn', onclick: () => {
          puts({ nowPlaying: Object.assign({}, np, cur.title ? { title: cur.title } : null, cur.artist ? { artist: cur.artist } : null, cur.artwork ? { artwork: cur.artwork } : null) });
          redo();
        },
      }, [icon('import'), 'Çalan Şarkıyı Alanlara Doldur']));
    }
    if (auto) out.push(h('div', { class: 'hint', text: 'Sistem medya oturumundan (Spotify, YouTube vb.) çalan parça otomatik okunur. Çalmadığında aşağıdaki yedek bilgiler gösterilir.' }));
    if (field !== 'artist') out.push(U.text({ label: auto ? 'Yedek Parça Adı' : 'Parça Adı', value: np.title || (field === 'title' ? t.content : '') || '', onInput: (v) => setNp('title', v) }));
    if (field !== 'title') out.push(U.text({ label: auto ? 'Yedek Sanatçı' : 'Sanatçı', value: np.artist || (field === 'artist' ? t.content : '') || '', onInput: (v) => setNp('artist', v) }));
    return out;
  }

  // ---- Sekmeler ----
  function contentKids(t, put, puts, redo) {
    const src = t.source || 'static';
    const out = [U.select({
      label: 'Metin Kaynağı', options: [['static', 'Sabit Metin'], ['now', 'Çalan Parça'], ['lyrics', 'Şarkı Sözü (LRC / SRT)']], value: src,
      onChange: (v) => {
        // Söze çevrilen katman hazır "Şarkı Sözü" katmanıyla aynı başlar: çalan parçayı izler
        puts(v === 'lyrics' && !t.lyricsSource && t.lyricsFollow !== true ? { source: v, lyricsFollow: true } : { source: v });
        redo();
      },
    })];
    if (src === 'lyrics') return out.concat(lyricsKids(t, put, puts, redo));
    if (src === 'now') return out.concat(nowKids(t, put, puts, redo));
    out.push(U.text({ label: 'Yazı Metni', value: t.content || '', onInput: (v) => puts({ content: v, placeholder: false }) }));
    out.push(U.toggle({ label: 'Kayan Yazı', value: !!t.marquee, def: false, onChange: (v) => { put('marquee', !!v); redo(); } }));
    if (t.marquee) out.push(U.slider({ label: 'Kayma Hızı', min: 0.02, max: 0.6, step: 0.01, value: t.marqueeSpeed || 0.12, def: 0.12, onInput: (v) => put('marqueeSpeed', v) }));
    return out;
  }

  function styleKids(t, put, puts, redo) {
    const src = t.source || 'static';
    const c = A().config.get() || {};
    // Kip bu yazının kendisinde durur; yazmamışsa sahnenin görselleştirici kipi geçerli
    const mode = t.colorMode || (t.useCustomColor ? 'custom' : null) || (c.visualizer && c.visualizer.colorMode) || 'theme';
    const weightDef = src === 'now' ? 800 : 700;
    const out = [U.seg({
      label: 'Renk Modu', options: [['custom', 'Sabit Renk'], ['theme', 'Renk Teması'], ['rainbow', 'Gökkuşağı']], value: mode,
      onChange: (m) => { puts({ colorMode: m, useCustomColor: m === 'custom' }); redo(); },
    })];
    if (mode === 'custom') {
      out.push(U.color({ label: 'Metin Rengi', value: t.color || '#ffffff', def: '#ffffff', onInput: (v) => put('color', v) }));
      if (src === 'lyrics' && t.karaoke !== false) {
        out.push(U.color({ label: 'Vurgu Rengi', value: t.colorHighlight || '#ffd23f', def: '#ffd23f', onInput: (v) => put('colorHighlight', v) }));
        out.push(h('div', { class: 'hint', text: 'Söylenen kısmı boyar. Sabit yazı ve çalan parça bu rengi kullanmaz.' }));
      }
    }
    out.push(U.select({ label: 'Yazı Tipi', options: FONTS, value: t.font || FONTS[0][0], def: FONTS[0][0], onChange: (v) => put('font', v) }));
    out.push(U.slider({ label: 'Kalınlık', min: 100, max: 900, step: 100, value: t.weight == null ? weightDef : t.weight, def: weightDef, onInput: (v) => put('weight', Math.round(v / 100) * 100) }));
    out.push(U.slider({ label: 'Yazı Saydamlığı', min: 0, max: 1, step: 0.01, percent: true, value: t.opacity == null ? 1 : t.opacity, def: 1, onInput: (v) => put('opacity', v) }));
    out.push(U.slider({ label: 'Kontur', min: 0, max: 1, step: 0.02, value: t.outline == null ? 0 : t.outline, def: 0, onInput: (v) => put('outline', v) }));
    out.push(U.slider({ label: 'Gölge', min: 0, max: 1, step: 0.02, value: t.shadow == null ? 0 : t.shadow, def: 0, onInput: (v) => put('shadow', v) }));
    return out;
  }

  function placeKids(t, put, puts, redo) {
    const src = t.source || 'static';
    const sizeDef = src === 'lyrics' ? 0.07 : src === 'now' ? 0.06 : 0.09;
    const alignDef = src === 'now' ? 'left' : 'center';
    const yDef = src === 'lyrics' ? 0.82 : src === 'now' ? 0.78 : 0.5;
    const out = [
      U.slider({ label: 'Yazı Boyutu', min: 0.01, max: 0.3, step: 0.005, value: t.size == null ? sizeDef : t.size, def: sizeDef, onInput: (v) => put('size', v) }),
      U.select({ label: 'Hizalama', options: ALIGNS, value: t.align || alignDef, def: alignDef, onChange: (v) => put('align', v) }),
      U.slider({ label: 'Dikey Konum', min: 0, max: 1, step: 0.005, percent: true, value: t.y == null ? yDef : t.y, def: yDef, onInput: (v) => put('y', v) }),
      U.select({ label: 'Dikey Hiza', options: [['top', 'Üst'], ['middle', 'Orta'], ['bottom', 'Alt']], value: t.vAlign || 'middle', def: 'middle', onChange: (v) => put('vAlign', v) }),
      U.slider({ label: 'En Fazla Genişlik', min: 0.2, max: 1, step: 0.01, percent: true, value: t.maxWidth == null ? 0.9 : t.maxWidth, def: 0.9, onInput: (v) => put('maxWidth', v) }),
      U.toggle({ label: 'Uzun Yazıyı Kaydır', value: t.scrollOverflow !== false, def: true, onChange: (v) => { put('scrollOverflow', !!v); redo(); } }),
    ];
    if (t.scrollOverflow !== false && !t.marquee) {
      out.push(U.slider({ label: 'Kaydırma Hızı', min: 0.25, max: 4, step: 0.05, value: t.scrollSpeed == null ? 1 : t.scrollSpeed, def: 1, format: (v) => U.num(v, 2) + '×', onInput: (v) => put('scrollSpeed', v) }));
    }
    out.push(h('div', { class: 'hint', text: 'Yazı ekrana ya da bu genişliğe sığmazsa kutu ekranın içinde kalır ve yazı ileri geri kayar. Kayan yazı açıkken o döngü kullanılır.' }));
    return out;
  }

  function motionKids(t, put, puts, redo) {
    const pulseDef = t.source === 'now' ? 0 : 0.12;
    const out = [
      U.select({ label: 'Giriş', options: ANIMS, value: t.animation || 'fade', def: 'fade', onChange: (v) => put('animation', v) }),
      U.slider({ label: 'Giriş Süresi', min: 0.05, max: 2, step: 0.05, value: t.animDuration == null ? 0.45 : t.animDuration, def: 0.45, format: (v) => sec(v, 2), onInput: (v) => put('animDuration', v) }),
      U.slider({ label: 'Bas Nabzı', min: 0, max: 0.6, step: 0.01, value: t.audioScale == null ? pulseDef : t.audioScale, def: pulseDef, onInput: (v) => put('audioScale', v) }),
      U.slider({ label: 'Titreşim', min: 0, max: 1, step: 0.02, value: t.audioJitter || 0, def: 0, onInput: (v) => put('audioJitter', v) }),
      U.toggle({ label: 'Harf Harf Tepki', value: !!t.perCharacter, def: false, onChange: (v) => { put('perCharacter', !!v); redo(); } }),
    ];
    if (t.perCharacter) out.push(U.slider({ label: 'Harf Yükselmesi', min: 0, max: 1, step: 0.02, value: t.audioLift == null ? 0.25 : t.audioLift, def: 0.25, onInput: (v) => put('audioLift', v) }));
    return out;
  }

  const PANES = { content: contentKids, style: styleKids, place: placeKids, motion: motionKids };
  let tab = 'content';
  /** Katmanın Kaynak sekmesi. getLayer: güncel katman; set: katman kopyasını değiştirip yazar. */
  function controls(getLayer, set) {
    const puts = (o) => set((x) => { x.settings = x.settings || {}; x.settings.text = Object.assign({}, x.settings.text, o); });
    const put = (k, v) => puts({ [k]: v });
    const pane = h('div', { class: 'edit-pane' });
    const show = (id) => {
      tab = id;
      pane.textContent = '';
      const l = getLayer();
      const t = (l && l.settings && l.settings.text) || {};
      pane.appendChild(U.card((PANES[id] || contentKids)(t, put, puts, () => show(tab))));
    };
    const tabs = U.tabs([['content', 'İçerik'], ['style', 'Yazı'], ['place', 'Yerleşim'], ['motion', 'Hareket']], tab, show);
    show(tab);
    return [tabs, pane];
  }

  window.SVShellText = Object.freeze({ controls });
})();
