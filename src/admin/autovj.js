'use strict';
/* Tempo ve Otomatik VJ.

   Tempo motoru (shared/tempo.js) panelin canlı önizleme ses motorundan
   beslenir — böylece görselleştirici penceresi kapalıyken de BPM okunur.
   Otomatik VJ, ölçü/saniye başına sahne, mod ya da renk şablonu değiştirir;
   geçişler vuruşa hizalanır.

   Neden panelde: yapılandırmanın tek sahibi bu paneldir. Sahne değişimini
   burada yapmak, MIDI/OSC eşlemeleriyle aynı yolu kullanır ve iki farklı
   yerden aynı ayarın yazılması sorununu doğurmaz. */
(function () {
  const P = () => window.SVPanel;

  let tempo = null;
  let raf = 0;
  let started = false;
  let lastSwitch = 0; // saniye
  let barsSince = 0;
  let cursor = 0;
  let lastBpmPaint = 0;

  const SOURCE_LABELS = [
    ['scenes', 'Sahneler'],
    ['visualizers', 'Görselleştiriciler'],
    ['palettes', 'Renk Şablonları'],
    ['all', 'Hepsi (sırayla)'],
  ];
  const UNIT_LABELS = [['bars', 'Ölçü'], ['seconds', 'Saniye']];
  const ORDER_LABELS = [['sequential', 'Sırayla'], ['random', 'Rastgele']];

  const VIS_CYCLE = [
    'bars', 'centerBars', 'blocks', 'dots', 'skyline', 'wave', 'ribbon', 'wave3d',
    'lissajous', 'strings', 'terrain', 'circular', 'radialWave', 'starburst', 'arcs',
    'pinwheel', 'mandala', 'kaleido', 'vortex', 'helix', 'tunnel', 'orb', 'particles',
    'fireworks', 'lightning', 'bubbles', 'metaball', 'ripplegrid', 'geometry', 'feedback',
  ];

  function cfgOf() {
    return P().cfg().autovj;
  }

  // --------------------------------------------------------------------------
  // Geçiş uygulama
  // --------------------------------------------------------------------------
  function pickIndex(len, order) {
    if (len <= 0) return -1;
    if (order === 'random') return Math.floor(Math.random() * len);
    cursor = (cursor + 1) % len;
    return cursor;
  }

  function applySwitch() {
    const cfg = P().cfg();
    const a = cfg.autovj;
    let what = a.source;
    if (what === 'all') {
      // Sırayla sahne → görselleştirici → palet
      what = ['scenes', 'visualizers', 'palettes'][cursor % 3];
    }

    if (what === 'scenes') {
      const list = cfg.scenes || [];
      const i = pickIndex(list.length, a.order);
      if (i < 0) return false;
      const data = list[i].data || {};
      for (const key of ['background', 'visualizer', 'logo', 'images', 'custom', 'feedback', 'layers', 'postfx', 'geometry']) {
        if (data[key]) cfg[key] = JSON.parse(JSON.stringify(data[key]));
      }
      return true;
    }

    if (what === 'visualizers') {
      const i = pickIndex(VIS_CYCLE.length, a.order);
      cfg.visualizer.type = VIS_CYCLE[i];
      // Katman listesi kullanılıyorsa ilk görselleştirici katmanını değiştir
      if (Array.isArray(cfg.layers) && cfg.layers.length) {
        const ly = cfg.layers.find((l) => l && l.kind === 'visualizer');
        if (ly) ly.type = VIS_CYCLE[i];
      }
      return true;
    }

    if (what === 'palettes') {
      const list = (window.SV.GRADIENT_PRESETS || []).concat(cfg.userPresets || []);
      const i = pickIndex(list.length, a.order);
      if (i < 0) return false;
      cfg.background.gradient.colors = list[i].colors.slice();
      return true;
    }
    return false;
  }

  // --------------------------------------------------------------------------
  // Döngü
  // --------------------------------------------------------------------------
  function loop() {
    raf = requestAnimationFrame(loop);
    const audio = window.SVPreview && window.SVPreview.audioEngine ? window.SVPreview.audioEngine() : null;
    if (!audio || !tempo) return;
    const cfg = P().cfg();
    const a = cfg.autovj || {};
    const now = performance.now() / 1000;
    const dt = 1 / 60;

    tempo.beatsPerBar = Math.max(1, Math.min(16, a.beatsPerBar || 4));
    if (a.bpmLock > 0) tempo.setLock(a.bpmLock);
    else if (tempo.locked) tempo.setLock(0);

    const fired = tempo.update(audio, now, dt);
    if (fired && tempo.barPosition === 0) barsSince++;

    // BPM göstergesini saniyede ~4 kez tazele (her karede DOM yazmak israf)
    if (now - lastBpmPaint > 0.25) {
      lastBpmPaint = now;
      const el = document.getElementById('bpmValue');
      if (el) el.textContent = tempo.bpm ? Math.round(tempo.bpm) + ' BPM' : '— BPM';
      const conf = document.getElementById('bpmConf');
      if (conf) conf.style.width = Math.round(tempo.confidence * 100) + '%';
      const dot = document.getElementById('beatDot');
      if (dot) dot.classList.toggle('hit', tempo.energy > 0.35);
    }

    if (!a.enabled) return;

    let due = false;
    if (a.unit === 'seconds') {
      due = now - lastSwitch >= Math.max(1, a.interval);
    } else {
      due = barsSince >= Math.max(1, a.interval);
      // Ölçü sayılamıyorsa (tempo yoksa) zamana düş
      if (!tempo.bpm && now - lastSwitch > Math.max(4, a.interval * 2)) due = true;
    }

    if (due) {
      // Geçişi vuruşa hizala: ölçü birimindeyken tam vuruşta değiştir
      if (a.unit === 'bars' && tempo.bpm && !tempo.justFired()) return;
      lastSwitch = now;
      barsSince = 0;
      if (applySwitch()) {
        P().push(true);
        P().rerender();
      }
    }
  }

  // --------------------------------------------------------------------------
  // Panel
  // --------------------------------------------------------------------------
  function panel() {
    const el = P().el;
    const cfg = P().cfg();
    const a = cfg.autovj;
    const nodes = [];

    // --- tempo göstergesi ---
    const meter = el('div', { class: 'bpm-box' }, [
      el('span', { id: 'beatDot', class: 'beat-dot' }),
      el('span', { id: 'bpmValue', class: 'bpm-value', text: tempo && tempo.bpm ? Math.round(tempo.bpm) + ' BPM' : '— BPM' }),
      el('div', { class: 'bpm-conf' }, [el('i', { id: 'bpmConf' })]),
      el('button', {
        class: 'btn small', type: 'button', text: '👆 Tempoya Vur',
        title: 'Ritimle birkaç kez basın; tempo elle sabitlenir',
        onclick: () => {
          if (!tempo) return;
          const bpm = tempo.tap();
          a.bpmLock = Math.round(bpm);
          P().push(true);
          P().rerender();
        },
      }),
    ]);
    nodes.push(meter);

    nodes.push(
      P().slider('BPM Kilidi', 'autovj.bpmLock', {
        min: 0, max: 200, step: 1,
        fmt: (v) => (v > 0 ? Math.round(v) + ' BPM' : 'otomatik'),
      })
    );
    nodes.push(P().slider('Ölçüdeki Vuruş', 'autovj.beatsPerBar', { min: 1, max: 16, step: 1, fmt: (v) => String(Math.round(v)) }));

    nodes.push(
      el('div', { class: 'studio-note dim-hint', text: 'Tempo, spektral akıdan bulunan vuruşların aralık histogramıyla kestirilir ve 60–180 BPM aralığına katlanır; böylece aynı parça bazen 75 bazen 150 görünmez. Dış bir tempo kaynağına bağlanılmaz — elle vurarak sabitleyebilirsiniz.' })
    );

    // --- otomatik VJ ---
    const enable = el('input', {
      type: 'checkbox',
      onchange: (e) => {
        a.enabled = e.target.checked;
        lastSwitch = performance.now() / 1000;
        barsSince = 0;
        P().push(true);
        P().rerender();
      },
    });
    enable.checked = !!a.enabled;
    nodes.push(P().row('Otomatik VJ', el('label', { class: 'switch' }, [enable, el('span', { class: 'track' })])));

    if (a.enabled) {
      nodes.push(P().segment('Neyi Değiştirsin', 'autovj.source', SOURCE_LABELS.map(([v, l]) => ({ value: v, label: l }))));
      nodes.push(P().segment('Aralık Birimi', 'autovj.unit', UNIT_LABELS.map(([v, l]) => ({ value: v, label: l }))));
      nodes.push(
        P().slider('Aralık', 'autovj.interval', {
          min: 1, max: 64, step: 1,
          fmt: (v) => Math.round(v) + (a.unit === 'seconds' ? ' sn' : ' ölçü'),
        })
      );
      nodes.push(P().segment('Sıra', 'autovj.order', ORDER_LABELS.map(([v, l]) => ({ value: v, label: l }))));
      nodes.push(
        el('button', {
          class: 'btn ghost small', type: 'button', text: '⏭ Şimdi Değiştir',
          onclick: () => {
            lastSwitch = performance.now() / 1000;
            barsSince = 0;
            if (applySwitch()) { P().push(true); P().rerender(); }
          },
        })
      );
    }

    return el('div', { class: 'autovj-panel' }, nodes);
  }

  function init() {
    if (started) return;
    started = true;
    tempo = new window.SVTempo.Tempo();
    raf = requestAnimationFrame(loop);
  }

  window.SVAutoVJ = { panel, init, tempoOf: () => tempo };
})();
