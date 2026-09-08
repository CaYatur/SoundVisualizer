'use strict';
/* Tempo ve Otomatik VJ paneli.

   Tempo motoru (shared/tempo.js) panelin canlı önizleme ses motorundan
   beslenir — böylece görselleştirici penceresi kapalıyken de BPM okunur.
   Seçim ve sıra kuralları shared/autovj.js'te ve sınanabilir; burada
   yalnızca uygulama ve arayüz var.

   BU PANEL NEDEN YENİDEN YAZILDI

   1) SESSİZ BAŞARISIZLIK. Varsayılan kaynak "Sahneler"di. Kayıtlı sahnesi
      olmayan kullanıcıda seçim listesi boş kalıyor, değişim başarısız
      oluyor ve hiçbir yerde tek kelime çıkmıyordu. Ölçüldü: kaynak
      "Sahneler" + 0 sahne = sonsuza kadar hiçbir şey. Artık durum satırı
      sebebi yazıyor ve boş kaynak önceden uyarılıyor.

   2) PANELİN KENDİNİ YENİDEN ÇİZMESİ. Her değişimde P().rerender()
      çağrılıyordu; panelin tamamı yıkılıp yeniden kuruluyordu. Kullanıcı o
      sırada bir düğmeye basarsa tıklama, yerinden kaldırılmış bir düğüme
      gidiyor ve hiçbir şey olmuyordu — "düğmelere basınca bir şey olmuyor"
      şikâyetinin doğrudan sebebi. Artık çalışırken panel yeniden
      kurulmuyor; yalnızca durum satırı yerinde güncelleniyor.

   3) METİN KATMANI KAYBI. Metin katmanı da kind:'visualizer' taşıyor.
      Eski kod ilk 'visualizer' katmanını bulup türünü değiştiriyordu ve
      kullanıcının metin katmanını spektrum çizerine dönüştürüyordu.

   4) TEK KATMAN. Yalnızca ilk görselleştirici katmanı değişiyordu; iki
      görselleştiricili sahnede ikincisi hiç dokunulmadan kalıyordu.
*/
(function () {
  const P = () => window.SVPanel;
  const R = () => window.SVAutoVJRules;

  let tempo = null;
  let raf = 0;
  let started = false;
  let lastSwitch = 0; // saniye
  let barsSince = 0;
  let lastBpmPaint = 0;
  let rules = null; // { cursors, last }
  let lastResult = null; // { kind, label } — durum satırı için
  let lastFailure = null; // { code, kind }
  /* Sayaçlar yalnızca ölçüm için. Eski kod her değişimde paneli yeniden
     kuruyordu; duman testi bunu "yeniden kurulum sayısı değişim sayısına
     yaklaşmıyor" diye sınıyor. Mutlak sıfır iddia edilemez: ışık aygıtı
     sayısı değişince admin zaten tüm paneli yeniden çiziyor (nadir, ama
     gerçek). */
  let panelRenders = 0;
  let switchCount = 0;

  const SOURCE_LABELS = [
    ['scenes', 'Sahneler'],
    ['visualizers', 'Görselleştiriciler'],
    ['palettes', 'Renk Şablonları'],
    ['all', 'Hepsi (sırayla)'],
  ];
  const UNIT_LABELS = [['bars', 'Ölçü'], ['seconds', 'Saniye']];
  const ORDER_LABELS = [['sequential', 'Sırayla'], ['random', 'Rastgele']];
  const PALETTE_SOURCE_LABELS = [
    ['both', 'Hepsi'], ['builtin', 'Hazır'], ['user', 'Kendi Yaptıklarım'],
  ];
  const VIS_TARGET_LABELS = [
    ['all', 'Tüm Görselleştirici Katmanları'], ['first', 'Yalnızca İlki'],
  ];
  const KIND_LABELS = {
    scenes: 'Sahne', visualizers: 'Görselleştirici', palettes: 'Renk Şablonu',
  };

  /* Kullanıcıya gösterilecek görselleştirici adları. Etiketler burada
     TEKRAR EDİLMİYOR: panelin kendi tür seçicisinden okunuyor, böylece yeni
     bir tür eklendiğinde iki liste ayrışamaz. */
  function visLabel(id) {
    const map = P().visualizerLabels ? P().visualizerLabels() : null;
    const raw = (map && map[id]) || id;
    return T(raw);
  }

  function T(s) {
    return window.SVI18n && window.SVI18n.t ? window.SVI18n.t(s) : s;
  }

  /* Kural modülünün dış dünyaya bakan bağlamı: sahneler ve paletler. */
  function ctxOf(cfg) {
    const a = R().normalize(cfg.autovj);
    return {
      scenes: cfg.scenes || [],
      builtinPalettes: window.SV.GRADIENT_PRESETS || [],
      userPalettes: cfg.userPresets || [],
      paletteSource: a.paletteSource,
    };
  }

  // --------------------------------------------------------------------------
  // Değişimi uygula
  // --------------------------------------------------------------------------

  /* Sahne anahtarları. Bir sahnede olmayan anahtar SİLİNİR, önceki sahneden
     kalanla bırakılmaz: eskiden kalıyordu ve sahneler birbirine karışıyordu
     (bir sahnenin logosu, kendisinde logo tanımı olmayan sonraki sahnede de
     görünmeye devam ediyordu). */
  const SCENE_KEYS = [
    'background', 'visualizer', 'layers', 'layerStack', 'layerGroups', 'crossfade',
    'geometry', 'postfx', 'logo', 'images', 'media', 'text', 'modulation',
    'transition', 'custom', 'milkdrop', 'feedback',
  ];

  function applyScene(cfg, sceneItem) {
    const list = cfg.scenes || [];
    const found = list.find((s, i) => {
      const id = String((s && (s.id != null ? s.id : s.name)) != null
        ? (s.id != null ? s.id : s.name) : i);
      return id === String(sceneItem.id);
    });
    if (!found) return false;
    const data = found.data || {};
    const base = window.SV.defaultConfig();
    for (const key of SCENE_KEYS) {
      if (data[key] !== undefined) {
        cfg[key] = JSON.parse(JSON.stringify(data[key]));
      } else if (base[key] !== undefined) {
        // Sahnede yoksa VARSAYILANA dön — önceki sahneden sızmasın
        cfg[key] = JSON.parse(JSON.stringify(base[key]));
      }
    }
    return true;
  }

  function applyVisualizer(cfg, type, targets) {
    const layers = R().visualizerLayers(cfg.layers);
    const isStack = window.SVLayers && window.SVLayers.stackOn(cfg);

    if (layers.length) {
      /* Tüm görselleştirici katmanları ya da yalnızca ilki. Metin katmanları
         listeye hiç girmiyor (kural modülü ayıklıyor). */
      const hit = targets === 'first' ? layers.slice(0, 1) : layers;
      for (const l of hit) l.type = type;
      if (!isStack && cfg.visualizer) cfg.visualizer.type = type;
      return true;
    }
    if (cfg.visualizer) { cfg.visualizer.type = type; return true; }
    return false;
  }

  function applyPalette(cfg, item) {
    const colors = (item && item.colors) || null;
    if (!colors || !colors.length) return false;
    /* Paleti hem arkaplan gradyanına hem görselleştirici renklerine uygula.
       Eskiden yalnızca gradyana yazılıyordu; arkaplan gradyan kipinde
       değilse ekranda hiçbir şey değişmiyor, kullanıcı da renk şablonu
       değişiminin çalışmadığını sanıyordu. */
    let touched = false;
    if (cfg.background && cfg.background.gradient) {
      cfg.background.gradient.colors = colors.slice();
      touched = true;
    }
    if (cfg.visualizer) {
      cfg.visualizer.color = colors[0];
      if (colors.length > 1) cfg.visualizer.color2 = colors[colors.length - 1];
      touched = true;
    }
    return touched;
  }

  /* Bir değişim uygula. Dönüş: { ok, kind, label } ya da { ok:false, code } */
  function applySwitch() {
    const cfg = P().cfg();
    const a = R().normalize(cfg.autovj);
    const ctx = ctxOf(cfg);
    const res = R().plan(cfg.autovj, ctx, rules);
    if (!res.ok) {
      lastFailure = { code: res.code, kind: res.kind };
      lastResult = null;
      return res;
    }
    rules = res.state;

    let done = false;
    if (res.kind === 'scenes') done = applyScene(cfg, res.item);
    else if (res.kind === 'visualizers') done = applyVisualizer(cfg, res.item.id, a.visualizerTargets);
    else if (res.kind === 'palettes') done = applyPalette(cfg, res.item);

    if (!done) {
      lastFailure = { code: 'EMPTY', kind: res.kind };
      lastResult = null;
      return { ok: false, code: 'EMPTY', kind: res.kind };
    }
    lastFailure = null;
    switchCount++;
    lastResult = {
      kind: res.kind,
      label: res.kind === 'visualizers' ? visLabel(res.item.id) : res.item.label,
    };
    return { ok: true, kind: res.kind };
  }

  // --------------------------------------------------------------------------
  // Durum satırı — kullanıcı çalıştığını GÖRSÜN
  // --------------------------------------------------------------------------
  function statusText(a, ctx) {
    if (!a.enabled) return T('Otomatik VJ kapalı.');

    const d = R().diagnose(cfg0(), ctx);
    if (!d.ok) {
      if (a.source === 'scenes') return T('⚠ Kayıtlı sahne yok. Önce Kitaplık › Sahneler bölümünden sahne kaydedin ya da başka bir kaynak seçin.');
      if (a.source === 'palettes') return T('⚠ Seçilen kaynakta renk şablonu yok.');
      return T('⚠ Bu kaynakta değiştirilecek bir şey yok.');
    }

    const parts = [];
    if (lastResult) {
      parts.push(T('Son değişim') + ': ' + T(KIND_LABELS[lastResult.kind] || lastResult.kind)
        + ' → ' + lastResult.label);
    }
    if (lastFailure) {
      parts.push(T('Son deneme başarısız') + ': ' + T(KIND_LABELS[lastFailure.kind] || lastFailure.kind));
    }

    // Sıradaki değişime kalan
    if (a.unit === 'seconds') {
      const left = Math.max(0, a.interval - (performance.now() / 1000 - lastSwitch));
      parts.push(T('sıradaki') + ': ' + left.toFixed(1) + ' ' + T('sn'));
    } else {
      const left = Math.max(0, a.interval - barsSince);
      parts.push(T('sıradaki') + ': ' + left + ' ' + T('ölçü'));
    }
    if (a.source === 'all' && d.skipped && d.skipped.length) {
      parts.push(T('atlanan') + ': ' + d.skipped.map((k) => T(KIND_LABELS[k] || k)).join(', '));
    }
    return parts.join('  ·  ');
  }

  // statusText içinde ham yapılandırma gerekiyor (diagnose normalize ediyor)
  function cfg0() {
    return P().cfg().autovj;
  }

  // --------------------------------------------------------------------------
  // Döngü
  // --------------------------------------------------------------------------
  function loop() {
    raf = requestAnimationFrame(loop);
    const audio = window.SVPreview && window.SVPreview.audioEngine ? window.SVPreview.audioEngine() : null;
    if (!audio || !tempo) return;
    const cfg = P().cfg();
    const a = R().normalize(cfg.autovj);
    const now = performance.now() / 1000;
    const dt = 1 / 60;

    tempo.beatsPerBar = a.beatsPerBar;
    if (a.bpmLock > 0) tempo.setLock(a.bpmLock);
    else if (tempo.locked) tempo.setLock(0);

    const fired = tempo.update(audio, now, dt);
    if (fired && tempo.barPosition === 0) barsSince++;

    if (now - lastBpmPaint > 0.2) {
      lastBpmPaint = now;
      const el = document.getElementById('bpmValue');
      if (el) el.textContent = tempo.bpm ? Math.round(tempo.bpm) + ' BPM' : '— BPM';
      const conf = document.getElementById('bpmConf');
      if (conf) conf.style.width = Math.round(tempo.confidence * 100) + '%';
      const dot = document.getElementById('beatDot');
      if (dot) dot.classList.toggle('hit', tempo.energy > 0.35);
      /* Durum satırı yerinde güncelleniyor — paneli yeniden çizmeden.
         Yeniden çizmek kullanıcının tıklamasını düşürüyordu. */
      const st = document.getElementById('autovjStatus');
      if (st) st.textContent = statusText(a, ctxOf(cfg));
    }

    if (!a.enabled) return;

    let due = false;
    if (a.unit === 'seconds') {
      due = now - lastSwitch >= a.interval;
    } else {
      due = barsSince >= a.interval;
      // Tempo bulunamıyorsa ölçü sayılamaz; zamana düş
      if (!tempo.bpm && now - lastSwitch > Math.max(4, a.interval * 2)) due = true;
    }
    if (!due) return;

    // Ölçü kipinde geçişi vuruşa hizala
    if (a.unit === 'bars' && tempo.bpm && !tempo.justFired()) return;

    lastSwitch = now;
    barsSince = 0;
    const res = applySwitch();
    if (res.ok) {
      /* SADECE gönder, yeniden çizme. Panelin yeniden kurulması kullanıcının
         o anda yaptığı tıklamayı düşürüyordu. */
      P().push(true);
    }
  }

  /* Zamanlayıcıyı sıfırla. Kullanıcı bir ayarı değiştirdiğinde çağrılır:
     aksi hâlde 8 ölçülük aralıkta değişikliğin etkisi ~16 saniye sonra
     görünüyor ve düğme çalışmamış gibi hissediliyor. */
  function restartTiming() {
    lastSwitch = performance.now() / 1000;
    barsSince = 0;
  }

  // --------------------------------------------------------------------------
  // Seçim listesi
  // --------------------------------------------------------------------------
  function pickList(kind, a, ctx, rerender) {
    const el = P().el;
    const all = R().catalog(kind, ctx);
    if (!all.length) return null;

    const cfg = P().cfg();
    cfg.autovj.picks = cfg.autovj.picks || { scenes: [], visualizers: [], palettes: [] };
    const cur = cfg.autovj.picks[kind] || (cfg.autovj.picks[kind] = []);
    const has = (id) => cur.indexOf(String(id)) >= 0;

    const rows = all.map((item) => {
      const box = el('input', {
        type: 'checkbox',
        onchange: (e) => {
          const id = String(item.id);
          const i = cur.indexOf(id);
          if (e.target.checked) { if (i < 0) cur.push(id); }
          else if (i >= 0) cur.splice(i, 1);
          restartTiming();
          P().push(true);
          const c = document.getElementById('autovjPickCount');
          if (c) c.textContent = countText(cur.length, all.length);
        },
      });
      box.checked = has(item.id);
      return el('label', { class: 'pick-row' }, [
        box,
        el('span', { class: 'pick-label', text: kind === 'visualizers' ? visLabel(item.id) : item.label }),
      ]);
    });

    return el('div', { class: 'pick-box' }, [
      el('div', { class: 'row' }, [
        el('span', { class: 'lbl', text: 'Hangileri' }),
        el('span', { id: 'autovjPickCount', class: 'val', text: countText(cur.length, all.length) }),
      ]),
      el('div', { class: 'studio-note dim-hint', text: 'Hiçbiri seçili değilse hepsi kullanılır.' }),
      el('div', { class: 'pick-list' }, rows),
      el('div', { class: 'row' }, [
        el('button', {
          class: 'btn ghost tiny', type: 'button', text: 'Hepsini Seç',
          onclick: () => { cfg.autovj.picks[kind] = all.map((x) => String(x.id)); restartTiming(); rerender(); },
        }),
        el('button', {
          class: 'btn ghost tiny', type: 'button', text: 'Seçimi Temizle',
          onclick: () => { cfg.autovj.picks[kind] = []; restartTiming(); rerender(); },
        }),
      ]),
    ]);
  }

  function countText(n, total) {
    return n === 0 ? T('hepsi') + ' (' + total + ')' : n + ' / ' + total;
  }

  // --------------------------------------------------------------------------
  // Panel
  // --------------------------------------------------------------------------
  function panel() {
    panelRenders++;
    const el = P().el;
    const cfg = P().cfg();
    if (!cfg.autovj) cfg.autovj = window.SV.defaultConfig().autovj;
    const raw = cfg.autovj;
    const a = R().normalize(raw);
    const ctx = ctxOf(cfg);
    const rerender = () => P().apply();
    const nodes = [];

    // --- tempo göstergesi ---
    nodes.push(el('div', { class: 'bpm-box' }, [
      el('span', { id: 'beatDot', class: 'beat-dot' }),
      el('span', { id: 'bpmValue', class: 'bpm-value', text: tempo && tempo.bpm ? Math.round(tempo.bpm) + ' BPM' : '— BPM' }),
      el('div', { class: 'bpm-conf' }, [el('i', { id: 'bpmConf' })]),
      el('button', {
        class: 'btn small', type: 'button', text: '👆 Tempoya Vur',
        title: 'Ritimle birkaç kez basın; tempo elle sabitlenir',
        onclick: () => {
          if (!tempo) return;
          raw.bpmLock = Math.round(tempo.tap());
          P().push(true);
          P().rerender();
        },
      }),
    ]));

    nodes.push(P().slider('BPM Kilidi', 'autovj.bpmLock', {
      min: 0, max: 200, step: 1,
      fmt: (v) => (v > 0 ? Math.round(v) + ' BPM' : 'otomatik'),
    }));
    nodes.push(P().slider('Ölçüdeki Vuruş', 'autovj.beatsPerBar', {
      min: 1, max: 16, step: 1, fmt: (v) => String(Math.round(v)),
    }));

    nodes.push(el('div', { class: 'studio-note dim-hint', text: 'Tempo, spektral akıdan bulunan vuruşların aralık histogramıyla kestirilir ve 60–180 BPM aralığına katlanır; böylece aynı parça bazen 75 bazen 150 görünmez. Dış bir tempo kaynağına bağlanılmaz — elle vurarak sabitleyebilirsiniz.' }));

    // --- otomatik VJ ---
    const enable = el('input', {
      type: 'checkbox',
      onchange: (e) => {
        raw.enabled = e.target.checked;
        restartTiming();
        lastResult = null;
        lastFailure = null;
        P().push(true);
        P().rerender();
      },
    });
    enable.checked = !!a.enabled;
    nodes.push(P().row('Otomatik VJ', el('label', { class: 'switch' }, [enable, el('span', { class: 'track' })])));

    /* Durum satırı — kapalıyken de duruyor ki kullanıcı nereye bakacağını
       bilsin. Döngü bunu yerinde günceller. */
    nodes.push(el('div', {
      id: 'autovjStatus', class: 'studio-note autovj-status',
      text: statusText(a, ctx),
    }));

    if (a.enabled) {
      /* Kaynak değişince zamanlayıcı sıfırlanır. Eskiden sıfırlanmıyordu ve
         8 ölçülük aralıkta kullanıcı düğmeye basıp ~16 saniye hiçbir şey
         olmadığını görüyordu. */
      nodes.push(P().segment('Neyi Değiştirsin', 'autovj.source',
        SOURCE_LABELS.map(([v, l]) => ({ value: v, label: l })), { onChange: () => { restartTiming(); rerender(); } }));

      // Kaynağa özel ayarlar
      if (a.source === 'palettes' || a.source === 'all') {
        nodes.push(P().segment('Şablon Kaynağı', 'autovj.paletteSource',
          PALETTE_SOURCE_LABELS.map(([v, l]) => ({ value: v, label: l })), { onChange: rerender }));
      }
      if (a.source === 'visualizers' || a.source === 'all') {
        nodes.push(P().segment('Hangi Katmanlar', 'autovj.visualizerTargets',
          VIS_TARGET_LABELS.map(([v, l]) => ({ value: v, label: l }))));
      }

      // Seçim listesi — 'all' kipinde her tür için ayrı
      const kinds = a.source === 'all' ? R().KINDS : [a.source];
      for (const k of kinds) {
        const box = pickList(k, a, ctx, rerender);
        if (box) {
          if (kinds.length > 1) {
            nodes.push(el('div', { class: 'row' }, [
              el('span', { class: 'lbl', text: KIND_LABELS[k] || k }),
            ]));
          }
          nodes.push(box);
        }
      }

      nodes.push(P().segment('Aralık Birimi', 'autovj.unit',
        UNIT_LABELS.map(([v, l]) => ({ value: v, label: l })), { onChange: () => { restartTiming(); rerender(); } }));
      nodes.push(P().slider('Aralık', 'autovj.interval', {
        min: 1, max: 64, step: 1,
        fmt: (v) => Math.round(v) + (a.unit === 'seconds' ? ' sn' : ' ölçü'),
      }));
      nodes.push(P().segment('Sıra', 'autovj.order',
        ORDER_LABELS.map(([v, l]) => ({ value: v, label: l }))));

      nodes.push(el('div', { class: 'row' }, [
        el('button', {
          class: 'btn ghost small', type: 'button', text: '⏭ Şimdi Değiştir',
          onclick: () => {
            restartTiming();
            const res = applySwitch();
            if (res.ok) { P().push(true); }
            const st = document.getElementById('autovjStatus');
            if (st) st.textContent = statusText(R().normalize(raw), ctxOf(P().cfg()));
          },
        }),
      ]));
    }

    return el('div', { class: 'autovj-panel' }, nodes);
  }

  function init() {
    if (started) return;
    started = true;
    tempo = new window.SVTempo.Tempo();
    restartTiming();
    raf = requestAnimationFrame(loop);
  }

  window.SVAutoVJ = {
    panel, init, tempoOf: () => tempo, applySwitch,
    statusOf: () => ({ lastResult, lastFailure }),
    counters: () => ({ panelRenders, switchCount }),
  };
})();
