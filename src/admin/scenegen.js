'use strict';
/* Sahne Üretici — yazdığınız ruh halinden bir sahne kurar.

   Tamamen ÇEVRİMDIŞI çalışır: hiçbir servise bağlanmaz, hesap veya anahtar
   istemez. Metin, ağırlıklı bir anahtar kelime sözlüğünden dört eksene
   çevrilir (enerji, sıcaklık, karanlık, organiklik); sahne bu eksenlerden
   tohumlanmış deterministik bir üreticiyle kurulur. Aynı metin + aynı tohum
   her zaman aynı sahneyi verir, böylece beğendiğinizi geri getirebilirsiniz.

   Türkçe ve İngilizce anahtar kelimeler birlikte tanınır. */
(function () {
  const P = () => window.SVPanel;

  let prompt = '';
  let seed = 1;
  let lastResult = null;

  // Anahtar kelime -> eksen ağırlıkları. Eksenler -1..1 arası birikir.
  // [enerji, sıcaklık, karanlık, organiklik]
  const LEXICON = [
    [['enerjik', 'hızlı', 'sert', 'agresif', 'parti', 'rave', 'techno', 'drum', 'bass', 'metal', 'rock', 'dans', 'coşku', 'patlama',
      'energetic', 'fast', 'hard', 'aggressive', 'party', 'punch', 'intense', 'wild', 'hype'], [0.9, 0.2, 0, -0.2]],
    [['sakin', 'yavaş', 'huzurlu', 'ambient', 'lofi', 'lo-fi', 'chill', 'dingin', 'yumuşak', 'rüya', 'uyku', 'meditasyon',
      'calm', 'slow', 'peaceful', 'dreamy', 'soft', 'gentle', 'sleep', 'meditation', 'relax'], [-0.85, 0, 0.15, 0.5]],
    [['sıcak', 'gün batımı', 'günbatımı', 'ateş', 'lav', 'turuncu', 'kırmızı', 'sonbahar', 'çöl', 'altın',
      'warm', 'sunset', 'fire', 'lava', 'orange', 'red', 'autumn', 'desert', 'golden', 'amber'], [0.15, 0.95, -0.1, 0.15]],
    [['soğuk', 'buz', 'kış', 'mavi', 'okyanus', 'deniz', 'kar', 'kuzey', 'kutup',
      'cold', 'ice', 'winter', 'blue', 'ocean', 'sea', 'snow', 'arctic', 'frost'], [-0.1, -0.95, 0.1, 0.25]],
    [['karanlık', 'gece', 'gotik', 'uzay', 'derin', 'gizem', 'korku', 'siyah',
      'dark', 'night', 'noir', 'space', 'deep', 'mystery', 'horror', 'black', 'shadow'], [0.05, -0.2, 0.95, 0]],
    [['parlak', 'neon', 'ışık', 'gündüz', 'renkli', 'canlı', 'gökkuşağı',
      'bright', 'neon', 'light', 'glow', 'colorful', 'vivid', 'rainbow', 'day'], [0.35, 0.1, -0.85, -0.15]],
    [['doğa', 'orman', 'su', 'sıvı', 'akışkan', 'bulut', 'duman', 'organik', 'yosun', 'bitki',
      'nature', 'forest', 'water', 'liquid', 'fluid', 'cloud', 'smoke', 'organic', 'plant'], [-0.2, 0, 0, 0.95]],
    [['geometrik', 'retro', 'ızgara', 'dijital', 'siber', 'teknoloji', 'matrix', 'sentetik', 'makine', 'robot',
      'geometric', 'retro', 'grid', 'digital', 'cyber', 'tech', 'synthwave', 'machine', 'robot', 'circuit'], [0.3, 0, 0.2, -0.95]],
    [['minimal', 'sade', 'temiz', 'basit', 'boş', 'clean', 'simple', 'minimalist', 'empty'], [-0.3, 0, 0, 0]],
    [['yoğun', 'karmaşık', 'dolu', 'kaotik', 'complex', 'busy', 'dense', 'chaotic', 'maximal'], [0.5, 0, 0, 0]],
  ];

  // Eksenlere göre aday havuzları. Her aday: [tür, ağırlık fonksiyonu]
  const BACKGROUNDS = [
    ['gradient', (a) => 1 + a.organic * 0.8 - a.energy * 0.2],
    ['ink', (a) => 0.7 + a.organic * 1.1 - a.energy * 0.3],
    ['nebula', (a) => 0.7 + a.organic * 0.8 + a.dark * 0.7],
    ['waves', (a) => 0.6 + a.organic * 0.7 - Math.abs(a.energy) * 0.2],
    ['aurora', (a) => 0.6 + a.organic * 0.6 + a.dark * 0.5 - a.warm * 0.3],
    ['grid', (a) => 0.5 - a.organic * 1.0 + a.energy * 0.5],
    ['hexgrid', (a) => 0.4 - a.organic * 0.9 + a.energy * 0.4],
    ['mosaic', (a) => 0.4 - a.organic * 0.7],
    ['corridor', (a) => 0.4 - a.organic * 0.6 + a.energy * 0.7],
    ['spiral', (a) => 0.35 + a.energy * 0.5],
    ['rings', (a) => 0.4 + a.energy * 0.6],
    ['network', (a) => 0.4 - a.organic * 0.7],
    ['starfield', (a) => 0.5 + a.dark * 0.9 + a.energy * 0.3],
    ['snow', (a) => 0.4 - a.warm * 0.7 - a.energy * 0.3],
    ['bokeh', (a) => 0.5 - a.energy * 0.4 + a.organic * 0.3],
    ['rain', (a) => 0.35 - a.organic * 0.6 + a.dark * 0.5],
    ['city', (a) => 0.35 + a.dark * 0.6 - a.organic * 0.4],
  ];

  const VISUALIZERS = [
    ['bars', (a) => 1 + a.energy * 0.4 - a.organic * 0.3],
    ['centerBars', (a) => 0.8 + a.energy * 0.4],
    ['blocks', (a) => 0.6 - a.organic * 0.6 + a.energy * 0.4],
    ['dots', (a) => 0.5 - a.organic * 0.5],
    ['wave', (a) => 0.8 - a.energy * 0.2 + a.organic * 0.4],
    ['ribbon', (a) => 0.6 + a.organic * 0.5],
    ['wave3d', (a) => 0.5 + a.organic * 0.3],
    ['lissajous', (a) => 0.4 - a.organic * 0.4],
    ['strings', (a) => 0.4 + a.organic * 0.5 - a.energy * 0.3],
    ['circular', (a) => 0.7],
    ['radialWave', (a) => 0.5 + a.organic * 0.3],
    ['starburst', (a) => 0.5 + a.energy * 0.5],
    ['arcs', (a) => 0.45],
    ['pinwheel', (a) => 0.4 + a.energy * 0.4],
    ['mandala', (a) => 0.45 + a.organic * 0.4 - a.energy * 0.2],
    ['kaleido', (a) => 0.45 + a.energy * 0.3],
    ['vortex', (a) => 0.4 + a.energy * 0.5],
    ['helix', (a) => 0.4 + a.organic * 0.3],
    ['tunnel', (a) => 0.4 + a.energy * 0.5 - a.organic * 0.3],
    ['orb', (a) => 0.4 + a.organic * 0.3],
    ['particles', (a) => 0.5 + a.energy * 0.7],
    ['fireworks', (a) => 0.3 + a.energy * 0.9],
    ['lightning', (a) => 0.25 + a.energy * 0.9 + a.dark * 0.4],
    ['bubbles', (a) => 0.35 + a.organic * 0.6 - a.energy * 0.3],
    ['metaball', (a) => 0.35 + a.organic * 0.7],
    ['ripplegrid', (a) => 0.35 - a.organic * 0.3],
    ['skyline', (a) => 0.3 + a.dark * 0.4 - a.organic * 0.3],
    ['spectrogram', (a) => 0.25 - a.organic * 0.3],
    ['feedback', (a) => 0.3 + a.energy * 0.4 + a.dark * 0.4],
  ];

  function rng(s) {
    let x = (s >>> 0) || 1;
    return () => {
      x ^= x << 13; x >>>= 0;
      x ^= x >> 17;
      x ^= x << 5; x >>>= 0;
      return x / 4294967296;
    };
  }

  function hashString(s) {
    let h = 2166136261;
    for (let i = 0; i < s.length; i++) {
      h ^= s.charCodeAt(i);
      h = Math.imul(h, 16777619);
    }
    return h >>> 0;
  }

  // Metni dört eksene indirger
  function analyze(text) {
    const lower = ' ' + String(text || '').toLocaleLowerCase('tr') + ' ';
    const axes = { energy: 0, warm: 0, dark: 0, organic: 0 };
    let hits = 0;
    for (const [words, w] of LEXICON) {
      for (const word of words) {
        if (lower.indexOf(word) === -1) continue;
        hits++;
        axes.energy += w[0];
        axes.warm += w[1];
        axes.dark += w[2];
        axes.organic += w[3];
        break; // aynı grup birden çok kez sayılmasın
      }
    }
    const clamp = (v) => Math.max(-1, Math.min(1, v));
    // Hiç eşleşme yoksa metnin kendisinden tohumlanmış nötr-rastgele eksenler
    if (!hits) {
      const r = rng(hashString(lower) ^ seed);
      return { energy: r() * 2 - 1, warm: r() * 2 - 1, dark: r() * 2 - 1, organic: r() * 2 - 1, hits: 0 };
    }
    return {
      energy: clamp(axes.energy / Math.max(1, hits * 0.7)),
      warm: clamp(axes.warm / Math.max(1, hits * 0.7)),
      dark: clamp(axes.dark / Math.max(1, hits * 0.7)),
      organic: clamp(axes.organic / Math.max(1, hits * 0.7)),
      hits,
    };
  }

  function pick(pool, axes, rand) {
    // Ağırlıklı seçim: negatif ağırlıklar sıfırlanır, kalanı tohuma göre çekilir
    const scored = pool.map(([v, f]) => [v, Math.max(0.02, f(axes))]);
    const total = scored.reduce((s, x) => s + x[1], 0);
    let r = rand() * total;
    for (const [v, w] of scored) {
      r -= w;
      if (r <= 0) return v;
    }
    return scored[scored.length - 1][0];
  }

  function hsl(h, s, l) {
    h = ((h % 360) + 360) % 360;
    const a = s * Math.min(l, 1 - l);
    const f = (n) => {
      const k = (n + h / 30) % 12;
      const c = l - a * Math.max(-1, Math.min(Math.min(k - 3, 9 - k), 1));
      return Math.round(255 * c).toString(16).padStart(2, '0');
    };
    return '#' + f(0) + f(8) + f(4);
  }

  // Eksenlerden 5 renkli palet üretir
  function palette(axes, rand) {
    // Sıcaklık ekseni ana tonu belirler: +1 ≈ 25° (turuncu), -1 ≈ 210° (mavi)
    const baseHue = 210 - (axes.warm + 1) * 0.5 * 195 + (rand() - 0.5) * 30;
    const spread = 25 + (axes.energy + 1) * 0.5 * 90 + rand() * 25;
    const sat = 0.45 + (axes.energy + 1) * 0.5 * 0.42 + rand() * 0.1;
    const baseLight = 0.62 - (axes.dark + 1) * 0.5 * 0.32;
    const out = [];
    for (let i = 0; i < 5; i++) {
      const f = i / 4;
      const h = baseHue + (f - 0.5) * spread * (axes.organic > 0 ? 1 : 1.5);
      const l = Math.max(0.1, Math.min(0.86, baseLight + (f - 0.5) * (0.22 + rand() * 0.1)));
      const s = Math.max(0.2, Math.min(1, sat + (rand() - 0.5) * 0.18));
      out.push(hsl(h, s, l));
    }
    return out;
  }

  function generate() {
    const axes = analyze(prompt);
    const rand = rng(hashString(String(prompt)) ^ (seed * 2654435761));
    const bg = pick(BACKGROUNDS, axes, rand);
    const vis = pick(VISUALIZERS, axes, rand);
    const colors = palette(axes, rand);

    const energy01 = (axes.energy + 1) / 2;
    const scene = {
      background: {
        type: bg,
        gradient: {
          colors,
          style: axes.dark > 0.1 || energy01 > 0.6 ? 'plasma' : 'soft',
          speed: +(0.18 + energy01 * 1.0).toFixed(2),
          audioReactivity: +(0.4 + energy01 * 1.1).toFixed(2),
          brightness: +(0.75 + (1 - (axes.dark + 1) / 2) * 0.5).toFixed(2),
          audioBrightness: +(0.5 + energy01 * 1.4).toFixed(2),
          audioHue: +(energy01 * 0.6).toFixed(2),
          vignette: +(0.2 + (axes.dark + 1) / 2 * 0.4).toFixed(2),
          scale: +(0.8 + rand() * 0.7).toFixed(2),
          warp: +(0.25 + ((axes.organic + 1) / 2) * 1.0).toFixed(2),
          swirl: +(((axes.organic + 1) / 2) * 1.3).toFixed(2),
        },
      },
      visualizer: {
        type: vis,
        rainbow: rand() < 0.35 + energy01 * 0.4,
        color: colors[2],
        color2: colors[4],
        barCount: Math.round(48 + energy01 * 110),
        sensitivity: +(0.5 + energy01 * 0.9).toFixed(2),
        glow: +(0.2 + energy01 * 0.6).toFixed(2),
        gap: +(0.12 + (1 - energy01) * 0.4).toFixed(2),
        mirror: rand() < 0.3,
        position: rand() < 0.45 ? 'bottom' : 'center',
        thickness: +(0.25 + rand() * 0.5).toFixed(2),
        lineWidth: +(1.5 + energy01 * 5).toFixed(1),
      },
    };

    lastResult = { scene, axes, bg, vis };
    return lastResult;
  }

  function apply() {
    const r = lastResult || generate();
    const cfg = P().cfg();
    cfg.background = window.SV.deepMerge(cfg.background, r.scene.background);
    cfg.visualizer = window.SV.deepMerge(cfg.visualizer, r.scene.visualizer);
    P().push(true);
    P().rerender();
  }

  /* Eksenleri okunur etiketlere çevirir.
     Her parça ayrı bir düğüm olarak çizilir: çeviri sözlüğü tam metin
     eşleştirdiği için birleşik bir cümle asla çevrilemezdi. */
  function describe(axes) {
    const w = (v, lo, hi) => (v > 0.25 ? hi : v < -0.25 ? lo : 'dengeli');
    return [
      ['Enerji', w(axes.energy, 'sakin', 'yüksek')],
      ['Sıcaklık', w(axes.warm, 'soğuk', 'sıcak')],
      ['Ton', w(axes.dark, 'aydınlık', 'karanlık')],
      ['Doku', w(axes.organic, 'geometrik', 'organik')],
    ];
  }

  // Mod kimliğini kullanıcıya gösterilecek ada çevirir
  const BG_LABELS = {
    gradient: 'Akışkan Gradyan', ink: 'Mürekkep', nebula: 'Bulutsu', waves: 'Dalga Katmanları',
    aurora: 'Kutup Işıkları', grid: 'Retro Izgara', hexgrid: 'Petek Izgara', mosaic: 'Mozaik',
    corridor: 'Koridor', spiral: 'Sarmal', rings: 'Nabız Halkaları', network: 'Ağ',
    starfield: 'Yıldız Alanı', snow: 'Kar / Kor', bokeh: 'Işık Parçacıkları', rain: 'Dijital Yağmur',
    city: 'Şehir', solid: 'Düz Renk',
  };
  const VIS_LABELS = {
    bars: 'Barlar', centerBars: 'Merkez', blocks: 'Segment', dots: 'Nokta Matris', wave: 'Dalga',
    ribbon: 'Şerit', wave3d: '3B Dalga', lissajous: 'Lissajous', strings: 'Teller', terrain: 'Arazi',
    circular: 'Çember', radialWave: 'Dairesel Dalga', starburst: 'Işın', arcs: 'Yaylar',
    pinwheel: 'Fırıldak', mandala: 'Mandala', kaleido: 'Kaleydoskop', vortex: 'Girdap',
    helix: 'Sarmal', tunnel: 'Tünel', orb: 'Küre', particles: 'Parçacık', fireworks: 'Havai Fişek',
    lightning: 'Şimşek', bubbles: 'Baloncuk', metaball: 'Sıvı Damla', ripplegrid: 'Dalgalı Izgara',
    skyline: 'Şehir Silüeti', spectrogram: 'Spektrogram', feedback: 'Geri Besleme',
  };

  function panel() {
    const el = P().el;
    const nodes = [];

    const input = el('input', {
      class: 'p-in wide', type: 'text', value: prompt,
      placeholder: 'ör. "karanlık sinematik uzay", "enerjik neon techno", "sakin orman sabahı"',
      oninput: (e) => { prompt = e.target.value.slice(0, 200); },
    });
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') { seed = (Math.random() * 1e9) | 0; generate(); apply(); }
    });
    nodes.push(P().row('Ruh Hali', input));

    nodes.push(
      el('div', { class: 'gen-actions' }, [
        el('button', {
          class: 'btn primary', type: 'button', text: '✨ Sahne Üret',
          onclick: () => { generate(); apply(); P().toast('Sahne kuruldu.', 'ok'); },
        }),
        el('button', {
          class: 'btn', type: 'button', text: '🎲 Karıştır',
          title: 'Aynı ruh hali, farklı yorum',
          onclick: () => { seed = (Math.random() * 1e9) | 0; generate(); apply(); },
        }),
      ])
    );

    if (lastResult) {
      const sw = el('div', { class: 'gen-swatch' });
      sw.style.background = 'linear-gradient(90deg,' + lastResult.scene.background.gradient.colors.join(',') + ')';
      nodes.push(sw);
      const chips = el('div', { class: 'gen-chips' });
      describe(lastResult.axes).forEach(([k, v]) => {
        chips.appendChild(
          el('span', { class: 'gen-chip' }, [
            el('b', { text: k }),
            el('i', { text: v }),
          ])
        );
      });
      nodes.push(
        el('div', { class: 'studio-note' }, [
          chips,
          el('div', { class: 'gen-pair' }, [
            el('span', { class: 'dim-hint', text: 'Arkaplan' }),
            el('span', { text: BG_LABELS[lastResult.bg] || lastResult.bg }),
            el('span', { class: 'dim-hint', text: 'Görselleştirici' }),
            el('span', { text: VIS_LABELS[lastResult.vis] || lastResult.vis }),
          ]),
        ])
      );
    }

    nodes.push(
      el('div', { class: 'studio-note dim-hint', text: 'Tamamen bu bilgisayarda çalışır — hiçbir servise bağlanmaz. Yazdığınız metin enerji, sıcaklık, aydınlık ve doku eksenlerine çevrilir; sahne bu eksenlerden tohumlanmış deterministik bir üreticiyle kurulur. Beğendiğinizi sağdaki Sahneler bölümünden kaydedin.' })
    );

    return el('div', {}, nodes);
  }

  window.SVSceneGen = { panel, generate };
})();
