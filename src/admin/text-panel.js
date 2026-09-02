'use strict';
/* Metin ve şarkı sözü paneli.

   Üç kaynak var ve panelin şekli kaynağa göre değişiyor: sabit metinde bir
   yazı alanı yeter, sözde dosya yükleme ve senkron ayarı gerekir, "çalan
   parça"da yalnızca alanları düzenlemek. Hepsini birden göstermek paneli
   okunmaz hale getirirdi.

   Senkron düzeltmesi ayrı bir özen istiyor: yarım saniyelik kayma karaokede
   açıkça görünür, o yüzden hem ince kaydırma hem de "şimdi burası" düğmesi
   var. */
(function () {
  const P = () => window.SVPanel;
  const SP = () => window.SVScenePanels;

  const SOURCE_LABELS = [
    ['static', 'Sabit Metin'],
    ['lyrics', 'Şarkı Sözü (LRC / SRT)'],
    ['now', 'Çalan Parça'],
  ];
  const ANIM_LABELS = [
    ['none', 'Yok'], ['fade', 'Belirme'], ['slideUp', 'Yukarı Kayma'],
    ['slideLeft', 'Yana Kayma'], ['scale', 'Büyüme'],
  ];
  const ALIGN_LABELS = [['left', 'Sola'], ['center', 'Ortaya'], ['right', 'Sağa']];
  const FONT_LABELS = [
    ['system-ui, -apple-system, Segoe UI, Roboto, sans-serif', 'Sistem'],
    ['Georgia, "Times New Roman", serif', 'Serif'],
    ['ui-monospace, "Cascadia Code", Consolas, monospace', 'Tek Aralıklı'],
    ['Impact, "Arial Black", sans-serif', 'Ağır Başlık'],
    ['"Trebuchet MS", "Segoe UI", sans-serif', 'Yuvarlak'],
  ];

  function panel() {
    const el = P().el;
    const cfg = P().cfg();
    const T = cfg.text || (cfg.text = window.SV.defaultConfig().text);
    const rerender = () => P().apply();
    const nodes = [];

    nodes.push(SP().miniToggle('Metin Etkin', () => T.enabled !== false, (v) => { T.enabled = v; }, rerender));
    if (T.enabled === false) {
      return el('div', { class: 'txt-panel' }, nodes);
    }

    nodes.push(SP().miniSelect('Kaynak', SOURCE_LABELS, () => T.source || 'static', (v) => { T.source = v; }, rerender));

    // ------------------------------------------------------------- kaynak
    if ((T.source || 'static') === 'static') {
      nodes.push(el('div', { class: 'ctrl' }, [
        el('label', { class: 'lbl', text: 'Metin' }),
        el('textarea', {
          class: 'p-in txt-area', rows: 2, value: T.content || '',
          oninput: (e) => { T.content = e.target.value; P().push(false); },
        }),
      ]));
      nodes.push(SP().miniToggle('Kayan Yazı', () => !!T.marquee, (v) => { T.marquee = v; }, rerender));
      if (T.marquee) {
        nodes.push(SP().miniSlider('Kayma Hızı', () => T.marqueeSpeed || 0.12, (v) => { T.marqueeSpeed = v; }, {
          min: 0.02, max: 0.6, step: 0.01,
        }));
      }
    } else if (T.source === 'now') {
      nodes.push(P().row('Başlık', el('input', {
        class: 'p-in', type: 'text', value: (T.nowPlaying && T.nowPlaying.title) || '',
        oninput: (e) => { T.nowPlaying = T.nowPlaying || {}; T.nowPlaying.title = e.target.value; P().push(false); },
      })));
      nodes.push(P().row('Sanatçı', el('input', {
        class: 'p-in', type: 'text', value: (T.nowPlaying && T.nowPlaying.artist) || '',
        oninput: (e) => { T.nowPlaying = T.nowPlaying || {}; T.nowPlaying.artist = e.target.value; P().push(false); },
      })));
    } else {
      // ------------------------------------------------------------ söz
      const doc = T.lyricsSource && window.SVLyrics ? window.SVLyrics.parse(T.lyricsSource) : null;
      const info = doc
        ? doc.lines.length + ' satır · ' + doc.format.toUpperCase() +
          (doc.lines.some((l) => l.words && l.words.length) ? ' · karaoke zamanlı' : '')
        : 'yüklü dosya yok';
      nodes.push(P().row('Dosya', el('span', { class: 'txt-info', text: (T.lyricsName || '') + ' ' + info })));

      nodes.push(el('div', { class: 'row' }, [
        el('button', {
          class: 'btn', type: 'button', text: '📂 Söz Dosyası Yükle',
          onclick: async () => {
            if (!window.api || !window.api.importShaderText) { P().toast('İçe aktarma kullanılamıyor.'); return; }
            const r = await window.api.importShaderText();
            if (!r || !r.ok) return;
            T.lyricsSource = r.text;
            T.lyricsName = r.name || '';
            const d = window.SVLyrics ? window.SVLyrics.parse(r.text) : null;
            rerender();
            P().toast(d ? (d.lines.length + ' satır okundu (' + d.format.toUpperCase() + ')') : 'Yüklendi.');
          },
        }),
        el('button', {
          class: 'btn ghost', type: 'button', text: 'Temizle',
          onclick: () => { T.lyricsSource = ''; T.lyricsName = ''; rerender(); },
        }),
      ]));

      nodes.push(SP().miniSlider('Senkron Kayması', () => T.offset || 0, (v) => { T.offset = v; }, {
        min: -10, max: 10, step: 0.05, fmt: (v) => (v > 0 ? '+' : '') + (+v).toFixed(2) + ' sn',
      }));
      nodes.push(SP().miniToggle('Karaoke Vurgusu', () => T.karaoke !== false, (v) => { T.karaoke = v; }));
      nodes.push(el('div', { class: 'studio-note dim-hint', text: 'LRC ve SRT desteklenir; biçim dosyanın içeriğinden anlaşılır. Gelişmiş LRC\'deki kelime zamanları varsa karaoke vurgusu kelime kelime ilerler, yoksa satır boyunca düzgün akar.' }));
    }

    // ------------------------------------------------------------- görünüm
    nodes.push(SP().foldable('Yazı', () => [
      SP().miniSelect('Yazı Tipi', FONT_LABELS, () => T.font, (v) => { T.font = v; }),
      SP().miniSlider('Boyut', () => T.size == null ? 0.09 : T.size, (v) => { T.size = v; }, {
        min: 0.02, max: 0.35, step: 0.005, fmt: (v) => Math.round(v * 100) + '%',
      }),
      SP().miniSlider('Kalınlık', () => T.weight || 700, (v) => { T.weight = Math.round(v / 100) * 100; }, {
        min: 100, max: 900, step: 100, fmt: (v) => String(Math.round(v / 100) * 100),
      }),
      SP().miniSelect('Hizalama', ALIGN_LABELS, () => T.align || 'center', (v) => { T.align = v; }),
      SP().miniSlider('Yatay', () => T.x == null ? 0.5 : T.x, (v) => { T.x = v; }, { min: 0, max: 1, step: 0.005, percent: true }),
      SP().miniSlider('Dikey', () => T.y == null ? 0.5 : T.y, (v) => { T.y = v; }, { min: 0, max: 1, step: 0.005, percent: true }),
      SP().miniSlider('Saydamlık', () => T.opacity == null ? 1 : T.opacity, (v) => { T.opacity = v; }, { min: 0, max: 1, step: 0.01, percent: true }),
      SP().miniSlider('Kontur', () => T.outline || 0, (v) => { T.outline = v; }, { min: 0, max: 1, step: 0.02 }),
      SP().miniSlider('Gölge', () => T.shadow || 0, (v) => { T.shadow = v; }, { min: 0, max: 1, step: 0.02 }),
    ]));

    nodes.push(SP().foldable('Renk', () => {
      const kids = [SP().miniToggle('Kendi Rengim', () => !!T.useCustomColor, (v) => { T.useCustomColor = v; }, rerender)];
      if (T.useCustomColor) {
        kids.push(P().color('Metin Rengi', 'text.color'));
        kids.push(P().color('Vurgu Rengi', 'text.colorHighlight'));
      } else {
        kids.push(el('div', { class: 'studio-note dim-hint', text: 'Renkler sahne paletinden alınır; palet değişince metin de değişir.' }));
      }
      return kids;
    }));

    nodes.push(SP().foldable('Hareket ve Ses', () => [
      SP().miniSelect('Giriş', ANIM_LABELS, () => T.animation || 'fade', (v) => { T.animation = v; }),
      SP().miniSlider('Giriş Süresi', () => T.animDuration == null ? 0.45 : T.animDuration, (v) => { T.animDuration = v; }, {
        min: 0.05, max: 2, step: 0.05, fmt: (v) => (+v).toFixed(2) + ' sn',
      }),
      SP().miniSlider('Basla Nabız', () => T.audioScale == null ? 0.12 : T.audioScale, (v) => { T.audioScale = v; }, {
        min: 0, max: 0.6, step: 0.01,
      }),
      SP().miniSlider('Titreşim', () => T.audioJitter || 0, (v) => { T.audioJitter = v; }, { min: 0, max: 1, step: 0.02 }),
      SP().miniToggle('Harf Harf Tepki', () => !!T.perCharacter, (v) => { T.perCharacter = v; }, rerender),
      T.perCharacter
        ? SP().miniSlider('Harf Yükselmesi', () => T.audioLift == null ? 0.25 : T.audioLift, (v) => { T.audioLift = v; }, { min: 0, max: 1, step: 0.02 })
        : null,
    ].filter(Boolean)));

    return el('div', { class: 'txt-panel' }, nodes);
  }

  window.SVTextPanel = { panel };
})();
