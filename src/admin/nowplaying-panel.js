'use strict';
/* Çalan parça paneli.
 *
 * Panelin en üstünde CANLI DURUM satırı var ve bu kasıtlı: özellik sistemin
 * medya oturumunu okuyor, okuyamadığında ekranda hiçbir şey çıkmıyor. Sebebi
 * görünmezse kullanıcı ayarlarla uğraşıp durur. Satır üç şeyi ayırt ediyor —
 * okuma çalışmıyor, çalışıyor ama hiçbir şey çalmıyor, çalışıyor ve şu parça
 * çalıyor.
 *
 * Ayarlar çok; katlanabilir başlıklara bölündü. Varsayılanı `null` olan
 * alanlar "kalıptan al" demek: kullanıcı Modern/OG seçtiğinde kontur, çubuk
 * kalınlığı gibi değerler kendiliğinden yerine oturuyor, ama tek tek
 * ezilebiliyor da.
 */
(function () {
  const P = () => window.SVPanel;
  const SP = () => window.SVScenePanels;
  const NP = () => window.SVNowPlaying;

  const SOURCE_LABELS = [['system', 'Sistemden Oku'], ['manual', 'Elle Yaz']];
  const MODE_LABELS = [['always', 'Sürekli Görünsün'], ['onChange', 'Parça Değişince']];
  const SPEED_LABELS = [['fast', 'Hızlı'], ['normal', 'Normal'], ['slow', 'Yavaş']];
  const STYLE_LABELS = [['modern', 'Modern'], ['og', 'OG (Klasik)']];
  const ANIM_LABELS = [
    ['none', 'Yok'], ['fade', 'Belirme'], ['slideUp', 'Yukarı Kayma'],
    ['slideLeft', 'Yana Kayma'], ['scale', 'Büyüme'],
    ['typewriter', 'Daktilo'], ['wipe', 'Perde'],
  ];
  const ALIGN_LABELS = [['left', 'Sola'], ['center', 'Ortaya'], ['right', 'Sağa']];
  const FONT_LABELS = [
    ['', 'Metin Katmanıyla Aynı'],
    ['system-ui, -apple-system, Segoe UI, Roboto, sans-serif', 'Sistem'],
    ['Georgia, "Times New Roman", serif', 'Serif'],
    ['ui-monospace, "Cascadia Code", Consolas, monospace', 'Tek Aralıklı'],
    ['Impact, "Arial Black", sans-serif', 'Ağır Başlık'],
    ['"Trebuchet MS", "Segoe UI", sans-serif', 'Yuvarlak'],
  ];

  // ------------------------------------------------------------ canlı durum
  let live = null;
  let status = null;
  let wired = false;
  let statusEl = null;

  function paintStatus() {
    if (!statusEl || !statusEl.isConnected) return;
    const N = NP();
    if (status && status.supported === false) {
      statusEl.textContent = status.platform === 'win32'
        ? 'Sistemden okunamıyor' + (status.error ? ' — ' + status.error : '')
        : 'Sistemden okuma yalnızca Windows’ta çalışıyor';
      statusEl.className = 'txt-info np-status bad';
      return;
    }
    if (!live || !live.has) {
      statusEl.textContent = 'Şu anda bir şey çalmıyor';
      statusEl.className = 'txt-info np-status';
      return;
    }
    const st = N ? N.resolve(live, Date.now()) : null;
    const who = [live.title, live.artist].filter(Boolean).join(' — ') || '(adsız)';
    const time = st && !st.live && st.duration > 0
      ? '  ·  ' + N.fmtTime(st.position) + ' / ' + N.fmtTime(st.duration)
      : '';
    statusEl.textContent = (live.playing ? '▶ ' : '❚❚ ') + who + time;
    statusEl.className = 'txt-info np-status ok';
  }

  function ensureLive() {
    if (wired || !window.api || !window.api.onNowPlaying) return;
    wired = true;
    window.api.onNowPlaying((st) => { live = st; paintStatus(); });
    if (window.api.nowPlayingCurrent) {
      window.api.nowPlayingCurrent().then((st) => { live = st; paintStatus(); }).catch(() => {});
    }
    if (window.api.nowPlayingStatus) {
      window.api.nowPlayingStatus().then((s) => { status = s; paintStatus(); }).catch(() => {});
    }
    /* Konum çıpadan hesaplanıyor, yeni mesaj beklemeden akıyor; satırın
       canlı görünmesi için yarım saniyede bir yeniden yazılıyor. */
    setInterval(paintStatus, 500);
  }

  // ------------------------------------------------------------------ panel
  function panel() {
    const el = P().el;
    const cfg = P().cfg();
    const C = cfg.nowplaying || (cfg.nowplaying = window.SV.defaultConfig().nowplaying);
    C.show = C.show || {};
    const rerender = () => P().apply();
    const nodes = [];

    const src = C.source || 'system';
    if (src === 'system' && window.api && window.api.nowPlayingSubscribe) {
      window.api.nowPlayingSubscribe(true);
    }
    ensureLive();

    nodes.push(SP().miniToggle('Etkin', () => C.enabled !== false, (v) => { C.enabled = v; }, rerender));
    if (C.enabled === false) return el('div', { class: 'txt-panel' }, nodes);

    nodes.push(SP().miniSelect('Kaynak', SOURCE_LABELS, () => src, (v) => { C.source = v; }, rerender));

    if (src === 'system') {
      statusEl = el('span', { class: 'txt-info np-status', text: 'okunuyor…' });
      nodes.push(P().row('Durum', statusEl));
      paintStatus();
      nodes.push(el('div', { class: 'studio-note dim-hint',
        text: 'Bilgi işletim sisteminin medya oturumundan okunur; Spotify, YouTube Music, tarayıcı ve çoğu oynatıcı desteklenir. Okunan bilgi bu bilgisayardan dışarı çıkmaz.' }));
    } else {
      C.manual = C.manual || {};
      const man = (key, label) => P().row(label, el('input', {
        class: 'p-in', type: 'text', value: C.manual[key] || '',
        // push(false): yeniden çizim yok, yoksa her harfte odak kaybolurdu
        oninput: (e) => { C.manual[key] = e.target.value; P().push(false); },
      }));
      nodes.push(man('title', 'Parça Adı'));
      nodes.push(man('artist', 'Sanatçı'));
      nodes.push(man('album', 'Albüm'));
    }

    // ------------------------------------------------------------ görünürlük
    nodes.push(SP().foldable('Görünürlük', () => {
      const kids = [
        SP().miniSelect('Ne Zaman', MODE_LABELS, () => C.mode || 'always', (v) => { C.mode = v; }, rerender),
      ];
      if ((C.mode || 'always') === 'onChange') {
        kids.push(el('div', { class: 'studio-note dim-hint',
          text: 'Sabit durmak yerine yalnızca yeni parçaya geçince belirir, bir süre kalır ve söner.' }));
        kids.push(SP().miniSelect('Hız', SPEED_LABELS, () => C.speed || 'normal', (v) => {
          C.speed = v; C.animDuration = null; C.holdSeconds = null;
        }, rerender));
        const sp = NP() ? NP().speedOf(C.speed) : { anim: 0.5, hold: 4 };
        kids.push(SP().miniSlider('Ekranda Kalma', () => (C.holdSeconds == null ? sp.hold : C.holdSeconds),
          (v) => { C.holdSeconds = v; }, { min: 0.5, max: 20, step: 0.5, fmt: (v) => (+v).toFixed(1) + ' sn' }));
      }
      return kids;
    }));

    // ---------------------------------------------------------------- alanlar
    nodes.push(SP().foldable('Gösterilecek Alanlar', () => {
      const f = (key, label, def) => SP().miniToggle(label,
        () => (C.show[key] === undefined ? def : !!C.show[key]),
        (v) => { C.show[key] = v; }, rerender);
      const kids = [
        f('title', 'Parça Adı', true),
        f('artist', 'Sanatçı', true),
        f('album', 'Albüm', false),
        f('appName', 'Oynatıcı Adı', false),
        f('elapsed', 'Geçen Süre', true),
        f('remaining', 'Kalan Süre', false),
        f('total', 'Toplam Süre', true),
        f('bar', 'İlerleme Çubuğu', true),
      ];
      kids.push(SP().miniToggle('Parça ve Sanatçı Tek Satırda', () => !!C.oneLine, (v) => { C.oneLine = v; }, rerender));
      if (C.oneLine) {
        kids.push(P().row('Ayırıcı', el('input', {
          class: 'p-in', type: 'text', value: C.separator === undefined ? ' — ' : C.separator,
          oninput: (e) => { C.separator = e.target.value; P().push(false); },
        })));
      }
      kids.push(P().row('Süre Ayırıcı', el('input', {
        class: 'p-in', type: 'text', value: C.timeSeparator === undefined ? ' / ' : C.timeSeparator,
        oninput: (e) => { C.timeSeparator = e.target.value; P().push(false); },
      })));
      kids.push(el('div', { class: 'studio-note dim-hint',
        text: 'Her alan tek tek kapatılabilir: yalnızca parça adı, yalnızca süre ya da yalnızca çubuk gösterilebilir.' }));
      return kids;
    }));

    // ----------------------------------------------------------------- yazı
    nodes.push(SP().foldable('Yazı ve Yerleşim', () => {
      const style = NP() ? NP().styleOf(C.style) : { weight: 600, outline: 0, shadow: 0.55 };
      return [
        SP().miniSelect('Kalıp', STYLE_LABELS, () => C.style || 'modern', (v) => {
          /* Kalıp ayrı bir kod yolu değil, yalnızca varsayılan değerler.
             Elle ezilmişleri sıfırlıyoruz ki seçim gerçekten görünsün. */
          C.style = v;
          C.weight = null; C.outline = null; C.shadow = null;
          C.uppercase = null; C.barHeight = null; C.barSegments = null;
          C.barRadius = null; C.barBackOpacity = null;
        }, rerender),
        SP().miniSelect('Yazı Tipi', FONT_LABELS, () => C.font || '', (v) => { C.font = v; }),
        SP().miniSlider('Boyut', () => (C.size == null ? 0.042 : C.size), (v) => { C.size = v; },
          { min: 0.015, max: 0.16, step: 0.002, fmt: (v) => (v * 100).toFixed(1) + '%' }),
        SP().miniSlider('Kalınlık', () => (C.weight == null ? style.weight : C.weight),
          (v) => { C.weight = Math.round(v / 100) * 100; },
          { min: 100, max: 900, step: 100, fmt: (v) => String(Math.round(v / 100) * 100) }),
        SP().miniToggle('Büyük Harf', () => (C.uppercase == null ? style.uppercase : !!C.uppercase),
          (v) => { C.uppercase = v; }, rerender),
        SP().miniSelect('Hizalama', ALIGN_LABELS, () => C.align || 'center', (v) => { C.align = v; }),
        SP().miniSlider('Yatay', () => (C.x == null ? 0.5 : C.x), (v) => { C.x = v; },
          { min: 0, max: 1, step: 0.005, percent: true }),
        SP().miniSlider('Dikey', () => (C.y == null ? 0.86 : C.y), (v) => { C.y = v; },
          { min: 0, max: 1, step: 0.005, percent: true }),
        SP().miniSlider('Satır Aralığı', () => (C.lineGap == null ? 0.32 : C.lineGap), (v) => { C.lineGap = v; },
          { min: 0, max: 1.2, step: 0.02 }),
        SP().miniSlider('Saydamlık', () => (C.opacity == null ? 1 : C.opacity), (v) => { C.opacity = v; },
          { min: 0, max: 1, step: 0.01, percent: true }),
        SP().miniSlider('Kontur', () => (C.outline == null ? style.outline : C.outline), (v) => { C.outline = v; },
          { min: 0, max: 1, step: 0.02 }),
        SP().miniSlider('Gölge', () => (C.shadow == null ? style.shadow : C.shadow), (v) => { C.shadow = v; },
          { min: 0, max: 1, step: 0.02 }),
        SP().miniSlider('En Fazla Genişlik', () => (C.maxWidth == null ? 0.8 : C.maxWidth), (v) => { C.maxWidth = v; },
          { min: 0.2, max: 1, step: 0.01, percent: true }),
        SP().miniToggle('Uzun Adları Kaydır', () => C.scrollLongTitles !== false, (v) => { C.scrollLongTitles = v; }),
      ];
    }));

    // ---------------------------------------------------------------- çubuk
    if (C.show.bar !== false) {
      nodes.push(SP().foldable('İlerleme Çubuğu', () => {
        const style = NP() ? NP().styleOf(C.style) : { barHeight: 0.005, barSegments: 0, barBackOpacity: 0.22 };
        return [
          SP().miniSlider('Genişlik', () => (C.barWidth == null ? 0.42 : C.barWidth), (v) => { C.barWidth = v; },
            { min: 0.05, max: 1, step: 0.01, percent: true }),
          SP().miniSlider('Kalınlık', () => (C.barHeight == null ? style.barHeight : C.barHeight),
            (v) => { C.barHeight = v; }, { min: 0.001, max: 0.04, step: 0.001, fmt: (v) => (v * 100).toFixed(1) + '%' }),
          SP().miniSlider('Bölme Sayısı', () => (C.barSegments == null ? style.barSegments : C.barSegments),
            (v) => { C.barSegments = Math.round(v); },
            { min: 0, max: 80, step: 1, fmt: (v) => (v < 1 ? 'kesintisiz' : Math.round(v) + ' bölme') }),
          SP().miniSlider('Yazıyla Arası', () => (C.barGap == null ? 0.5 : C.barGap), (v) => { C.barGap = v; },
            { min: 0, max: 2, step: 0.05 }),
          SP().miniSlider('Zemin Koyuluğu', () => (C.barBackOpacity == null ? style.barBackOpacity : C.barBackOpacity),
            (v) => { C.barBackOpacity = v; }, { min: 0, max: 1, step: 0.02, percent: true }),
        ];
      }));
    }

    // ----------------------------------------------------------------- renk
    nodes.push(SP().foldable('Renk', () => {
      const kids = [SP().miniToggle('Kendi Renklerim', () => !!C.useCustomColor, (v) => { C.useCustomColor = v; }, rerender)];
      if (C.useCustomColor) {
        kids.push(P().color('Parça Adı', 'nowplaying.color'));
        kids.push(P().color('İkincil Yazı', 'nowplaying.colorDim'));
        kids.push(P().color('Çubuk', 'nowplaying.colorBar'));
      } else {
        kids.push(el('div', { class: 'studio-note dim-hint',
          text: 'Renkler sahne paletinden alınır; palet değişince yazı da değişir.' }));
      }
      return kids;
    }));

    // -------------------------------------------------------------- hareket
    nodes.push(SP().foldable('Hareket', () => {
      const sp = NP() ? NP().speedOf(C.speed) : { anim: 0.5 };
      return [
        SP().miniSelect('Giriş', ANIM_LABELS, () => C.animation || 'slideUp', (v) => { C.animation = v; }),
        SP().miniSlider('Giriş Süresi', () => (C.animDuration == null ? sp.anim : C.animDuration),
          (v) => { C.animDuration = v; }, { min: 0.05, max: 3, step: 0.05, fmt: (v) => (+v).toFixed(2) + ' sn' }),
        SP().miniSlider('Basla Nabız', () => (C.audioScale == null ? 0.04 : C.audioScale),
          (v) => { C.audioScale = v; }, { min: 0, max: 0.4, step: 0.01 }),
      ];
    }));

    return el('div', { class: 'txt-panel' }, nodes);
  }

  window.SVNowPlayingPanel = { panel };
})();
