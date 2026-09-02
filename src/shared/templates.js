'use strict';
/* Hazır sahne şablonları.

   Uygulamayı ilk açan biri 47 mod, 31 arkaplan, 40 efekt ve 98 formülle
   karşılaşıyor. Bu, seçenek değil felç. Şablonlar o yüzden var: kullanıma
   göre (kulüp, ambiyans, yayın, şarkı sözü, ekran koruyucu) ve türe göre
   gruplanmış, hepsi tek tıkla uygulanan bitmiş sahneler.

   Her şablon yapılandırmanın YALNIZCA sahneyi belirleyen kısmına dokunur:
   arkaplan, görselleştirici, palet, efekt zinciri, modülasyon ve geçiş.
   Ses aygıtı, ekran seçimi, yayın ayarları, aydınlatma gibi kullanıcının
   kendi kurulumuna ait alanlar korunur — bir şablon denemek kurulumu
   bozmamalı. */
(function () {
  // Kısa yazım: renk paleti
  const pal = (...colors) => ({ background: { gradient: { colors } } });

  // Şablon tanımı
  const T = (id, group, name, desc, patch) => ({ id, group, name, desc, patch });

  // Efekt zinciri girdisi
  const fx = (type, params) => ({ type, enabled: true, opacity: 1, params: params || {} });

  // Modülasyon yönlendirmesi
  const mod = (source, target, min, max, extra) =>
    Object.assign({ id: 'tpl_' + source + '_' + target.replace(/\W/g, ''), enabled: true, source, target, min, max, mode: 'set', curve: 'linear', amount: 1 }, extra || {});

  const V = (type, over) => ({ visualizer: Object.assign({ type }, over || {}) });
  const B = (type, over) => ({ background: Object.assign({ type }, over || {}) });

  // Birden çok parçayı tek yamada birleştir (derin)
  function merge(...parts) {
    const out = {};
    const deep = (dst, src) => {
      for (const k in src) {
        const v = src[k];
        if (v && typeof v === 'object' && !Array.isArray(v)) {
          dst[k] = dst[k] && typeof dst[k] === 'object' && !Array.isArray(dst[k]) ? dst[k] : {};
          deep(dst[k], v);
        } else {
          dst[k] = v;
        }
      }
    };
    for (const p of parts) deep(out, p);
    return out;
  }

  const TEMPLATES = [
    // ======================= KULÜP / SAHNE =======================
    T('club-strobe', 'Kulüp', 'Strobe Wall', 'Sert barlar, bloom ve vuruşta parlayan bir duvar.',
      merge(
        B('grid', { gradient: { speed: 0.8, audioReactivity: 1, brightness: 1.1 } }),
        V('blocks', { barCount: 96, glow: 0.8, gap: 0.2, rainbow: false, color: '#ff2d55', color2: '#00e5ff' }),
        pal('#ff2d55', '#ff8a00', '#00e5ff', '#7c5cff', '#ffffff'),
        { postfx: [fx('bloom', { threshold: 0.4, intensity: 1.5, radius: 3 }), fx('chroma', { amount: 0.006 })] },
        { modulation: { routes: [mod('anKick', 'postfx.0.params.intensity', 0.8, 2.6, { curve: 'exp' })] } },
        { transition: { type: 'flash', duration: 0.35, unit: 'seconds' } }
      )),

    T('club-tunnel', 'Kulüp', 'Hyper Tunnel', 'Basla nefes alan sonsuz tünel.',
      merge(
        B('corridor', { gradient: { brightness: 1.35, audioReactivity: 1.1, speed: 0.8 } }),
        V('tunnel', { glow: 0.85, thickness: 0.7, rainbow: true, barCount: 140 }),
        pal('#1a0033', '#7c3aed', '#00e5ff', '#ff2d95', '#ffe066'),
        { postfx: [fx('bloom', { threshold: 0.35, intensity: 1.5 }), fx('zoomblur', { strength: 0.18 })] },
        { modulation: { routes: [mod('bass', 'postfx.1.params.strength', 0, 0.45, { curve: 'exp' })] } },
        { transition: { type: 'zoom', duration: 0.5 } }
      )),

    T('club-laser', 'Kulüp', 'Laser Grid', 'Moiré ızgaraları ve lazer rengi.',
      merge(
        B('grid'), V('moire', { glow: 0.9, barCount: 200, rainbow: false, color: '#00ff9d', color2: '#ff0066' }),
        pal('#00ff9d', '#00e5ff', '#ff0066', '#ffee00'),
        { postfx: [fx('bloom', { threshold: 0.3, intensity: 1.8 }), fx('starfilter', { len: 0.06 })] },
        { transition: { type: 'wipe', duration: 0.4 } }
      )),

    T('club-mandala', 'Kulüp', 'Mandala Drop', 'Simetrik mandala, vuruşta açılıp kapanır.',
      merge(
        B('nebula'), V('mandala', { glow: 0.75, barCount: 128 }),
        pal('#2b0055', '#ff007a', '#ffb300', '#00ffe1'),
        { postfx: [fx('bloom', { intensity: 1.2 }), fx('kaleido', { slices: 8 })] },
        { modulation: { routes: [mod('anKick', 'visualizer.glow', 0.3, 1, { curve: 'exp' })] } }
      )),

    T('club-strobefloor', 'Kulüp', 'Strobe Floor', 'İzometrik şehir; her bant bir kule.',
      merge(
        B('hexpulse'), V('isocity', { thickness: 0.7, barCount: 140 }),
        pal('#06060f', '#3d5afe', '#00e5ff', '#ff4081'),
        { postfx: [fx('bloom', { intensity: 0.9 }), fx('vignette', { amount: 0.4 })] }
      )),

    T('club-fireworks', 'Kulüp', 'Fireworks', 'Her vuruşta havai fişek.',
      merge(
        B('starfield'), V('fireworks', { glow: 0.8, sensitivity: 0.9 }),
        pal('#050510', '#ffcc00', '#ff3b30', '#34c759', '#5ac8fa'),
        { postfx: [fx('bloom', { threshold: 0.45, intensity: 1.4 })] }
      )),

    T('club-milkdrop', 'Kulüp', 'MilkDrop Flow', 'Klasik MilkDrop akışı, geri beslemeli.',
      merge(V('milkdrop'), B('solid', { solidColor: '#000000' }),
        pal('#0a0020', '#7c4dff', '#00e5ff', '#ff4081'),
        { postfx: [fx('bloom', { intensity: 0.7 })] })),

    T('club-attractor', 'Kulüp', 'Strange Attractor', 'Kaotik çekiciler, vuruşta değişir.',
      merge(B('solid', { solidColor: '#03030a' }), V('attractorfield', { glow: 0.6, thickness: 0.6 }),
        pal('#00e5ff', '#7c5cff', '#ff2d95', '#ffffff'),
        { postfx: [fx('bloom', { intensity: 1.3 }), fx('trails', { amount: 0.4 })] })),

    // ======================== AMBİYANS ========================
    T('amb-aurora', 'Ambiyans', 'Aurora', 'Yavaş kutup ışıkları, sakin dalga.',
      merge(B('aurora', { gradient: { speed: 0.25, brightness: 0.9 } }), V('wave', { thickness: 0.3, glow: 0.4, lineWidth: 2 }),
        pal('#04121f', '#0f8a7a', '#3ad6c0', '#a3e4ff'),
        { postfx: [fx('bloom', { threshold: 0.6, intensity: 0.6 }), fx('grain', { amount: 0.06 })] },
        { transition: { type: 'crossfade', duration: 2.5 } })),

    T('amb-ink', 'Ambiyans', 'Ink in Water', 'Mürekkep bulutları, çok yavaş.',
      merge(B('ink', { gradient: { speed: 0.18 } }), V('none'),
        pal('#0a0a12', '#2b3a67', '#6b4e9e', '#c86dd7'),
        { postfx: [fx('grain', { amount: 0.08 }), fx('vignette', { amount: 0.35 })] },
        { transition: { type: 'crossfade', duration: 3 } })),

    T('amb-contours', 'Ambiyans', 'Topography', 'Eşyükselti çizgileri, harita sakinliği.',
      merge(B('contours'), V('none'),
        pal('#07110d', '#1f5c4a', '#4fbf9a', '#d7f5e8'),
        { postfx: [fx('grain', { amount: 0.05 })] })),

    T('amb-caustics', 'Ambiyans', 'Underwater', 'Su yüzeyinden kırılan ışık.',
      merge(B('caustics'), V('none'),
        pal('#021018', '#0b4a63', '#28a3c4', '#bff2ff'),
        { postfx: [fx('blur', { radius: 1.2 }), fx('vignette', { amount: 0.3 })] })),

    T('amb-embers', 'Ambiyans', 'Embers', 'Yükselen kıvılcımlar.',
      merge(B('embers'), V('none'),
        pal('#120602', '#7a2a06', '#e0651b', '#ffc46b'),
        { postfx: [fx('bloom', { threshold: 0.5, intensity: 1 })] })),

    T('amb-liquid', 'Ambiyans', 'Liquid Metal', 'Akışkan metal bantları.',
      merge(B('liquid'), V('none'),
        pal('#0b0b10', '#4a4f63', '#9aa6c2', '#e8eeff'),
        { postfx: [fx('sharpen', { amount: 0.6 })] })),

    T('amb-globe', 'Ambiyans', 'Night Globe', 'Dönen küre ağı.',
      merge(B('globe'), V('none'),
        pal('#02030a', '#1b3a6b', '#3f8ad6', '#a9d8ff'),
        { postfx: [fx('bloom', { intensity: 0.7 })] })),

    T('amb-flow', 'Ambiyans', 'Flow Field', 'Gürültü alanında sürüklenen izler.',
      merge(B('solid', { solidColor: '#05060b' }), V('flowfield', { thickness: 0.4, lineWidth: 2 }),
        pal('#0a1220', '#2e6f8e', '#63c7b2', '#f2e9c9'),
        { postfx: [fx('bloom', { intensity: 0.6 })] })),

    T('amb-interference', 'Ambiyans', 'Interference', 'Dalga girişimi deseni.',
      merge(B('solid', { solidColor: '#03040a' }), V('interference', { thickness: 0.5 }),
        pal('#001018', '#0a5a6e', '#3fd0c9', '#eaf7ff'))),

    // ======================== YAYIN / OBS ========================
    T('str-corner', 'Yayın', 'Corner Bars', 'Saydam arkaplan, alt köşe barları.',
      merge(B('transparent'), V('bars', { barCount: 64, position: 'bottom', glow: 0.5, gap: 0.4, rainbow: false, color: '#7c5cff', color2: '#21d4fd' }),
        pal('#7c5cff', '#21d4fd', '#ff4ecd'),
        { postfx: [] })),

    T('str-wave', 'Yayın', 'Clean Wave', 'Saydam, ince dalga çizgisi.',
      merge(B('transparent'), V('wave', { thickness: 0.22, lineWidth: 3, glow: 0.45, rainbow: false, color: '#ffffff', color2: '#7c5cff' }),
        pal('#ffffff', '#7c5cff'))),

    T('str-ring', 'Yayın', 'Ring Meter', 'Saydam dairesel spektrum, avatar çevresi için.',
      merge(B('transparent'), V('circular', { barCount: 96, glow: 0.5, thickness: 0.35 }),
        pal('#00e5ff', '#7c5cff', '#ff4ecd'))),

    T('str-scope', 'Yayın', 'Scope Overlay', 'Saydam osiloskop; fosfor izli.',
      merge(B('transparent'), V('scope', { thickness: 0.75, lineWidth: 2, rainbow: false, color: '#4ade80' }),
        pal('#4ade80', '#22d3ee'))),

    T('str-lowerthird', 'Yayın', 'Lower Third', 'Alt şeritte nokta matris.',
      merge(B('transparent'), V('dots', { barCount: 72, position: 'bottom', glow: 0.4 }),
        pal('#ff8a00', '#ff2d55', '#7c5cff'))),

    T('str-meter', 'Yayın', 'Studio Meters', 'Gonyometre — stereo görüntü denetimi.',
      merge(B('solid', { solidColor: '#07070c' }), V('goniometer', { glow: 0.3, rainbow: false, color: '#7dd3fc' }),
        pal('#7dd3fc', '#a78bfa'))),

    /* ====================== MÜZİK VİDEOSU ======================

       Resmî kanal ve şarkı videosu düzeni. Kulüp/VJ malzemesinden bilinçli
       olarak ayrı: sınırlı sayıda bar, sakin renk, logonun barların ARKASINDA
       değil YANINDA durduğu bir yerleşim ve altında parça/sanatçı adı.

       Hepsi katman yığınıyla kuruluyor, çünkü bu düzenin gereği aynı sahnede
       birden çok metin bloğu ve barların ayrı yerleşimi. Metinler parça
       bilgisinden besleniyor; boşken yer tutucu gösteriyorlar.

       Logo alanı kullanıcının kendi görseliyle dolar (Logo kartından). Şablon
       logo dosyasını değiştirmez, yalnızca yerini ve boyutunu ayarlar. */

    // Ortak parçalar
    ...(() => {
      // Sakin, yavaş, sese az tepki veren dikey zemin
      const ground = (over) => B('gradient', {
        gradient: merge({
          style: 'soft', speed: 0.1, drift: 0.02, wander: 0.2, orbit: 0.15,
          swirl: 0.1, scale: 1.6, warp: 0.08, audioReactivity: 0.22,
          brightness: 0.9, audioBrightness: 0.5, audioHue: 0, grain: 0.1, vignette: 0.5,
        }, over || {}),
      });

      // Yayın düzeninde barlar: az sayıda, ince, gökkuşağı yok
      const barLayer = (id, over) => ({
        id, name: 'Barlar', kind: 'visualizer', type: 'bars',
        settings: { visualizer: Object.assign({
          barCount: 64, gap: 0.42, rainbow: false, cap: false, glow: 0.18,
          position: 'bottom', sensitivity: 0.8, mirror: false,
          barSpan: 0.86, barCenterX: 0.5, barHeight: 0.3, baseline: 0.58,
          spectrum: { scale: 'log', amplitude: 'db', floorDb: -62, attack: 0.012, release: 0.22, spread: 0.35 },
        }, over || {}) },
      });

      // Metin bloğu: parça bilgisinden beslenir, boşken yer tutucu gösterir
      const textLayer = (id, name, field, placeholder, over) => ({
        id, name, kind: 'visualizer', type: 'text',
        settings: { text: Object.assign({
          enabled: true, source: 'now', field, content: placeholder,
          align: 'left', weight: 800, size: 0.062, x: 0.2, y: 0.78,
          outline: 0, shadow: 0.35, animation: 'fade', audioScale: 0,
          perCharacter: false, useCustomColor: true, color: '#ffffff',
        }, over || {}) },
      });

      const logoLayer = (id) => ({ id, name: 'Logo', kind: 'logo' });
      const logoAt = (over) => ({ logo: Object.assign({
        enabled: true, scale: 0.11, x: 0.1, y: 0.79, pulse: 0.06, glow: 0, opacity: 1,
      }, over || {}) });

      const stack = (...layers) => ({ layerStack: { enabled: true }, layers });

      return [
        T('bc-label', 'Müzik Videosu', 'Label Card',
          'Resmî kanal düzeni: bar şeridi, altında logo ve parça bilgisi.',
          merge(
            ground({ brightness: 0.8 }),
            pal('#0b0405', '#1a0709', '#4a0d14', '#b8121f', '#ff2d3a'),
            logoAt(),
            stack(
              { id: 'bcl_bg', name: 'Zemin', kind: 'background', type: 'gradient' },
              barLayer('bcl_bars', { color: '#ff2d3a' }),
              logoLayer('bcl_logo'),
              textLayer('bcl_title', 'Parça Adı', 'title', 'TRACK TITLE', { size: 0.066, weight: 800, y: 0.765 }),
              textLayer('bcl_artist', 'Sanatçı', 'artist', 'ARTIST NAME', { size: 0.032, weight: 500, y: 0.83 })
            ),
            { postfx: [fx('bloom', { threshold: 0.72, intensity: 0.35, radius: 2 })] }
          )),

        T('bc-artwork', 'Müzik Videosu', 'Artwork Card',
          'Kapak görseli solda, parça bilgisi sağında; barlar üstte.',
          merge(
            ground({ brightness: 0.75 }),
            pal('#0a0406', '#210a10', '#5c1220', '#c81f33', '#ff5566'),
            logoAt({ scale: 0.17, x: 0.115, y: 0.755 }),
            stack(
              { id: 'bca_bg', name: 'Zemin', kind: 'background', type: 'gradient' },
              barLayer('bca_bars', { color: '#ff4757', barCount: 72, barHeight: 0.26, baseline: 0.52 }),
              logoLayer('bca_logo'),
              textLayer('bca_title', 'Parça Adı', 'title', 'TRACK TITLE', { size: 0.07, x: 0.225, y: 0.735 }),
              textLayer('bca_artist', 'Sanatçı', 'artist', 'ARTIST NAME', { size: 0.034, weight: 500, x: 0.225, y: 0.81 })
            ),
            { postfx: [fx('bloom', { threshold: 0.75, intensity: 0.3 })] }
          )),

        T('bc-line', 'Müzik Videosu', 'Baseline Bars',
          'Parlak bir taban çizgisine oturan barlar, altında büyük başlık.',
          merge(
            ground({ brightness: 0.7, vignette: 0.55 }),
            pal('#0a0410', '#1b0726', '#4a0f52', '#c81d8e', '#ff2d95'),
            logoAt({ scale: 0.13, x: 0.095, y: 0.75 }),
            stack(
              { id: 'bcn_bg', name: 'Zemin', kind: 'background', type: 'gradient' },
              barLayer('bcn_bars', { color: '#ff2d95', barCount: 96, gap: 0.3, glow: 0.32, barSpan: 0.92, barHeight: 0.24, baseline: 0.45 }),
              logoLayer('bcn_logo'),
              textLayer('bcn_title', 'Parça Adı', 'title', 'TRACK TITLE', { size: 0.085, weight: 800, x: 0.2, y: 0.72 }),
              textLayer('bcn_artist', 'Sanatçı', 'artist', 'ARTIST NAME', { size: 0.038, weight: 600, x: 0.2, y: 0.81 })
            ),
            { postfx: [fx('bloom', { threshold: 0.6, intensity: 0.55 })] }
          )),

        T('bc-amber', 'Müzik Videosu', 'Amber Room',
          'Koyu tepeden sıcak sarıya inen zemin, ortada bar şeridi.',
          merge(
            ground({ brightness: 0.85 }),
            pal('#080806', '#161405', '#4a4406', '#c9b40b', '#f5e050'),
            logoAt({ scale: 0.115, x: 0.1, y: 0.8 }),
            stack(
              { id: 'bcm_bg', name: 'Zemin', kind: 'background', type: 'gradient' },
              barLayer('bcm_bars', { color: '#e8d21a', barCount: 60, gap: 0.45, barHeight: 0.3, baseline: 0.56 }),
              logoLayer('bcm_logo'),
              textLayer('bcm_title', 'Parça Adı', 'title', 'TRACK TITLE', { size: 0.06, y: 0.775 }),
              textLayer('bcm_artist', 'Sanatçı', 'artist', 'ARTIST NAME', { size: 0.031, weight: 500, y: 0.835 })
            ),
            { postfx: [fx('bloom', { threshold: 0.78, intensity: 0.28 })] }
          )),

        T('bc-minimal', 'Müzik Videosu', 'Minimal White',
          'İnce beyaz barlar, dokulu koyu zemin; en sade yayın düzeni.',
          merge(
            ground({ brightness: 0.42, grain: 0.2, vignette: 0.62, audioReactivity: 0.12 }),
            pal('#0a0908', '#141210', '#241f1b', '#3a322c', '#4a403a'),
            logoAt({ scale: 0.1, x: 0.095, y: 0.79 }),
            stack(
              { id: 'bcw_bg', name: 'Zemin', kind: 'background', type: 'gradient' },
              barLayer('bcw_bars', { color: '#ffffff', barCount: 80, gap: 0.5, glow: 0.05, barSpan: 0.88, barHeight: 0.2, baseline: 0.5 }),
              logoLayer('bcw_logo'),
              textLayer('bcw_title', 'Parça Adı', 'title', 'TRACK TITLE', { size: 0.055, y: 0.765 }),
              textLayer('bcw_artist', 'Sanatçı', 'artist', 'ARTIST NAME', { size: 0.028, weight: 500, y: 0.825 })
            ),
            { postfx: [] }
          )),

        T('bc-quiet', 'Müzik Videosu', 'Quiet Frame',
          'Neredeyse boş kadraj: köşede küçük barlar, altta parça bilgisi.',
          merge(
            ground({ brightness: 0.35, grain: 0.16, vignette: 0.7, audioReactivity: 0.08 }),
            pal('#050506', '#0b0b0e', '#131318', '#1c1c24', '#2a2a36'),
            logoAt({ scale: 0.085, x: 0.075, y: 0.87 }),
            stack(
              { id: 'bcq_bg', name: 'Zemin', kind: 'background', type: 'gradient' },
              barLayer('bcq_bars', { color: '#ffffff', barCount: 44, gap: 0.55, glow: 0.04,
                barSpan: 0.26, barCenterX: 0.18, barHeight: 0.12, baseline: 0.72 }),
              logoLayer('bcq_logo'),
              textLayer('bcq_title', 'Parça Adı', 'title', 'TRACK TITLE', { size: 0.042, x: 0.15, y: 0.855 }),
              textLayer('bcq_artist', 'Sanatçı', 'artist', 'ARTIST NAME', { size: 0.024, weight: 500, x: 0.15, y: 0.9 })
            ),
            { postfx: [] }
          )),

        T('bc-corner', 'Müzik Videosu', 'Corner Meter',
          'Barlar sağ alt köşede, parça bilgisi sol altta.',
          merge(
            ground({ brightness: 0.6, vignette: 0.55 }),
            pal('#04070a', '#0a1420', '#12304a', '#1d6fa8', '#38bdf8'),
            logoAt({ scale: 0.1, x: 0.08, y: 0.86 }),
            stack(
              { id: 'bcc_bg', name: 'Zemin', kind: 'background', type: 'gradient' },
              barLayer('bcc_bars', { color: '#38bdf8', barCount: 52, gap: 0.4,
                barSpan: 0.3, barCenterX: 0.8, barHeight: 0.16, baseline: 0.85 }),
              logoLayer('bcc_logo'),
              textLayer('bcc_title', 'Parça Adı', 'title', 'TRACK TITLE', { size: 0.048, x: 0.155, y: 0.845 }),
              textLayer('bcc_artist', 'Sanatçı', 'artist', 'ARTIST NAME', { size: 0.026, weight: 500, x: 0.155, y: 0.895 })
            ),
            { postfx: [fx('bloom', { threshold: 0.8, intensity: 0.22 })] }
          )),

        T('bc-center', 'Müzik Videosu', 'Centre Strip',
          'Ortada dar bar şeridi, üstünde başlık; simetrik ve sakin.',
          merge(
            ground({ brightness: 0.7, vignette: 0.5 }),
            pal('#06060a', '#0d0d18', '#1c1b3a', '#3f3a8c', '#8b7bff'),
            logoAt({ scale: 0.09, x: 0.5, y: 0.84 }),
            stack(
              { id: 'bcs_bg', name: 'Zemin', kind: 'background', type: 'gradient' },
              barLayer('bcs_bars', { color: '#8b7bff', barCount: 88, gap: 0.36, position: 'center',
                barSpan: 0.7, barHeight: 0.16, baseline: 0.55 }),
              textLayer('bcs_title', 'Parça Adı', 'title', 'TRACK TITLE',
                { size: 0.058, align: 'center', x: 0.5, y: 0.3 }),
              textLayer('bcs_artist', 'Sanatçı', 'artist', 'ARTIST NAME',
                { size: 0.03, weight: 500, align: 'center', x: 0.5, y: 0.37 }),
              logoLayer('bcs_logo')
            ),
            { postfx: [fx('bloom', { threshold: 0.72, intensity: 0.35 })] }
          )),
      ];
    })(),

    // ====================== ŞARKI SÖZÜ / MÜZİK ======================
    T('mus-chroma', 'Müzik', 'Chroma Wheel', 'Nota sınıfları ve algılanan akor.',
      merge(B('solid', { solidColor: '#08080f' }), V('chromawheel', { glow: 0.5 }),
        pal('#f87171', '#fbbf24', '#4ade80', '#22d3ee', '#a78bfa', '#f472b6'))),

    T('mus-dna', 'Müzik', 'Helix', 'Çift sarmal, spektrumla açılır.',
      merge(B('nebula'), V('dna', { thickness: 0.55, glow: 0.6 }),
        pal('#0b0620', '#7c3aed', '#22d3ee', '#f0abfc'),
        { postfx: [fx('bloom', { intensity: 0.9 })] })),

    T('mus-ribbons', 'Müzik', 'Silk Ribbons', 'Akan şeritler.',
      merge(B('ribbons'), V('ribbon', { thickness: 0.4, glow: 0.5 }),
        pal('#100a20', '#5b21b6', '#db2777', '#fbbf24'))),

    T('mus-strings', 'Müzik', 'Strings', 'Titreşen teller.',
      merge(B('solid', { solidColor: '#06060c' }), V('ropes', { lineWidth: 3, glow: 0.55, barCount: 160 }),
        pal('#f59e0b', '#ef4444', '#8b5cf6', '#06b6d4'))),

    T('mus-piano', 'Müzik', 'Spectrogram', 'Kayan zaman-frekans yüzeyi.',
      merge(B('solid', { solidColor: '#04040a' }), V('spectrogram', { barCount: 220 }),
        pal('#020617', '#1d4ed8', '#06b6d4', '#fde047', '#ffffff'))),

    T('mus-galaxy', 'Müzik', 'Galaxy', 'Dönen yıldız diski.',
      merge(B('starfield'), V('galaxy', { glow: 0.6, thickness: 0.5 }),
        pal('#02020a', '#4338ca', '#0ea5e9', '#fde68a'),
        { postfx: [fx('bloom', { intensity: 1.1 })] })),

    // ======================== EKRAN KORUYUCU ========================
    T('scr-plasma', 'Ekran Koruyucu', 'Plasma', 'Klasik plazma, sonsuz akış.',
      merge(B('plasma'), V('none'),
        pal('#1a0033', '#7c3aed', '#06b6d4', '#f0abfc'))),

    T('scr-stained', 'Ekran Koruyucu', 'Stained Glass', 'Vitray hücreleri.',
      merge(B('stained'), V('none'),
        pal('#0a0512', '#b91c1c', '#f59e0b', '#0891b2', '#7c3aed'))),

    T('scr-circuit', 'Ekran Koruyucu', 'Circuit', 'Devre kartında dolaşan sinyaller.',
      merge(B('circuit'), V('none'),
        pal('#020806', '#0f766e', '#22d3ee', '#a3e635'))),

    T('scr-wireframe', 'Ekran Koruyucu', 'Wire Tunnel', 'Tel kafes tünel.',
      merge(B('wireframe'), V('none'),
        pal('#04040d', '#3b0764', '#7c3aed', '#e879f9'))),

    T('scr-sand', 'Ekran Koruyucu', 'Dunes', 'Yatay kum akışı.',
      merge(B('sand'), V('none'),
        pal('#160e06', '#78350f', '#d97706', '#fcd34d'))),

    T('scr-prism', 'Ekran Koruyucu', 'Prism', 'Işınsal prizma dilimleri.',
      merge(B('prism'), V('none'),
        pal('#05030a', '#4c1d95', '#0ea5e9', '#fbbf24'),
        { postfx: [fx('bloom', { intensity: 0.8 })] })),

    // ============================ 3B ============================
    T('geo-klein', '3B Geometri', 'Klein Bottle', 'Kendine dönen yüzey.',
      merge(B('nebula'), V('geometry'),
        { geometry: { family: 'surface', formula: 'klein', render: 'wireframe', deform: 0.35, colorMode: 'normal', spin: 0.25 } },
        pal('#0a0618', '#6d28d9', '#06b6d4', '#f472b6'),
        { postfx: [fx('bloom', { intensity: 0.9 })] })),

    T('geo-lorenz', '3B Geometri', 'Lorenz', 'Kelebek çekicisi.',
      merge(B('solid', { solidColor: '#03030a' }), V('geometry'),
        { geometry: { family: 'attractor', formula: 'lorenz', render: 'points', attractorPoints: 90000, colorMode: 'depth', spin: 0.18, tilt: 0.45, zoom: 1.15, pointSize: 1.6, alpha: 0.85 } },
        pal('#00e5ff', '#7c5cff', '#ff2d95'),
        { postfx: [fx('bloom', { intensity: 1.2 })] })),

    T('geo-supershape', '3B Geometri', 'Supershape', 'Gielis süperşekli.',
      merge(B('aurora'), V('geometry'),
        { geometry: { family: 'surface', formula: 'gielis3d', render: 'surface', deform: 0.5, colorMode: 'palette', spin: 0.3 } },
        pal('#07131a', '#0e7490', '#22d3ee', '#fde68a'))),

    T('geo-knot', '3B Geometri', 'Trefoil Tube', 'Yonca düğümü boru.',
      merge(B('solid', { solidColor: '#05040c' }), V('geometry'),
        { geometry: { family: 'surface', formula: 'trefoilTube', render: 'surface', deform: 0.3, colorMode: 'normal', spin: 0.4 } },
        pal('#1e1b4b', '#7c3aed', '#f472b6', '#fef08a'),
        { postfx: [fx('bloom', { intensity: 0.8 })] })),

    T('geo-chladni', '3B Geometri', 'Chladni', 'Titreşim düğüm desenleri.',
      merge(B('solid', { solidColor: '#060606' }), V('geometry'),
        { geometry: { family: 'surface', formula: 'chladni', render: 'points', resolution: 160, deform: 0.8, colorMode: 'spectrum' } },
        pal('#0b0b0b', '#e5e5e5', '#fbbf24'))),

    T('geo-rose', '3B Geometri', 'Rose Curve', 'Gül eğrisi.',
      merge(B('ink'), V('geometry'),
        { geometry: { family: 'curve2d', formula: 'rose', render: 'wireframe', deform: 0.4, colorMode: 'palette', spin: 0.15 } },
        pal('#150520', '#be185d', '#f472b6', '#fbcfe8'))),

    T('geo-chua', '3B Geometri', 'Chua Circuit', 'Çift sarmallı elektronik kaos.',
      merge(B('solid', { solidColor: '#02040a' }), V('geometry'),
        { geometry: { family: 'attractor', formula: 'chua', render: 'points', attractorPoints: 80000, colorMode: 'depth', spin: 0.25 } },
        pal('#022c43', '#0891b2', '#34d399', '#fef3c7'),
        { postfx: [fx('bloom', { intensity: 1 })] })),

    T('geo-mobius', '3B Geometri', 'Möbius', 'Tek yüzlü şerit.',
      merge(B('nebula'), V('geometry'),
        { geometry: { family: 'surface', formula: 'mobius', render: 'surface', deform: 0.4, colorMode: 'normal', spin: 0.3 } },
        pal('#0f0a1e', '#4c1d95', '#c026d3', '#fde047'))),

    // ============================ TÜRLER ============================
    T('gen-techno', 'Tür', 'Techno', 'Sert, tek renk, yüksek kontrast.',
      merge(B('grid'), V('centerBars', { barCount: 128, glow: 0.7, gap: 0.15, rainbow: false, color: '#ffffff', color2: '#ff0033' }),
        pal('#000000', '#ff0033', '#ffffff'),
        { postfx: [fx('bloom', { threshold: 0.5, intensity: 1.3 }), fx('crt', { amount: 0.3 })] },
        { modulation: { routes: [mod('anKick', 'visualizer.glow', 0.3, 1.1, { curve: 'exp' })] } })),

    T('gen-house', 'Tür', 'House', 'Sıcak, yuvarlak, akışkan.',
      merge(B('liquid'), V('orb', { glow: 0.6, thickness: 0.5 }),
        pal('#2a1206', '#c2410c', '#fb923c', '#fde68a'),
        { postfx: [fx('bloom', { intensity: 1 })] })),

    T('gen-dnb', 'Tür', 'Drum & Bass', 'Hızlı, parçalı, glitchli.',
      merge(B('hexgrid'), V('truchet', { barCount: 180, glow: 0.6 }),
        pal('#050010', '#00ff88', '#00b3ff', '#ff0066'),
        { postfx: [fx('glitch', { amount: 0.35 }), fx('bloom', { intensity: 1.1 })] },
        { modulation: { routes: [mod('anSnare', 'postfx.0.params.amount', 0.05, 0.8, { curve: 'exp' })] } })),

    T('gen-hiphop', 'Tür', 'Hip-Hop', 'Kalın barlar, altın tonlar.',
      merge(B('city'), V('bars', { barCount: 48, gap: 0.5, glow: 0.5, rainbow: false, color: '#f59e0b', color2: '#b45309' }),
        pal('#0c0a09', '#78350f', '#f59e0b', '#fde68a'),
        { postfx: [fx('vhs', { noise: 0.15, bleed: 0.005 })] })),

    T('gen-lofi', 'Tür', 'Lo-Fi', 'Yumuşak, taneli, nostaljik.',
      merge(B('bokeh', { gradient: { speed: 0.3 } }), V('wave', { thickness: 0.25, lineWidth: 2, glow: 0.3 }),
        pal('#1c1917', '#78716c', '#d6d3d1', '#fca5a5'),
        { postfx: [fx('grain', { amount: 0.18 }), fx('vhs', { noise: 0.1 }), fx('vignette', { amount: 0.45 })] })),

    T('gen-synthwave', 'Tür', 'Synthwave', 'Neon ızgara ve mor gökyüzü.',
      merge(B('grid'), V('skyline', { barCount: 64, glow: 0.8, rainbow: false, color: '#ff2d95', color2: '#00e5ff' }),
        pal('#1a0033', '#ff2d95', '#7c3aed', '#00e5ff', '#fbbf24'),
        { postfx: [fx('bloom', { intensity: 1.4 }), fx('crt', { amount: 0.25 }), fx('chroma', { amount: 0.004 })] })),

    T('gen-rock', 'Tür', 'Rock', 'Sert kenarlar, şimşek.',
      merge(B('solid', { solidColor: '#0a0a0a' }), V('lightning', { glow: 0.7, lineWidth: 3, rainbow: false, color: '#f8fafc', color2: '#fbbf24' }),
        pal('#0a0a0a', '#525252', '#f8fafc', '#fbbf24'),
        { postfx: [fx('bloom', { intensity: 1.2 }), fx('grain', { amount: 0.12 })] })),

    T('gen-metal', 'Tür', 'Metal', 'Kömür ve kor.',
      merge(B('embers'), V('starburst', { barCount: 96, glow: 0.7, rainbow: false, color: '#dc2626', color2: '#f97316' }),
        pal('#0a0a0a', '#7f1d1d', '#dc2626', '#f97316'),
        { postfx: [fx('bloom', { intensity: 1.3 }), fx('edge', { amount: 0.3 })] })),

    T('gen-jazz', 'Tür', 'Jazz', 'Sıcak, akışkan, akor renkli.',
      merge(B('ink'), V('lissajous', { lineWidth: 2, glow: 0.5, thickness: 0.4 }),
        pal('#1a120b', '#7c2d12', '#d97706', '#fef3c7'),
        { modulation: { routes: [mod('anChordRoot', 'background.gradient.hueShift', 0, 1, { smooth: 0.8 })] } })),

    T('gen-classical', 'Tür', 'Classical', 'Ağırbaşlı, altın oran.',
      merge(B('waves', { gradient: { speed: 0.25 } }), V('radialWave', { thickness: 0.3, glow: 0.4 }),
        pal('#0f0d0a', '#44403c', '#a8a29e', '#e7e5e4', '#d4af37'))),

    T('gen-ambient', 'Tür', 'Ambient', 'Neredeyse hareketsiz.',
      merge(B('nebula', { gradient: { speed: 0.12, brightness: 0.75 } }), V('none'),
        pal('#04060b', '#1e3a5f', '#4a7fa5', '#c9e4f0'),
        { postfx: [fx('grain', { amount: 0.06 })] },
        { transition: { type: 'crossfade', duration: 4 } })),

    T('gen-pop', 'Tür', 'Pop', 'Parlak, renkli, hareketli.',
      merge(B('mosaic'), V('pinwheel', { barCount: 72, glow: 0.65 }),
        pal('#ff4ecd', '#ffd23f', '#3ddc97', '#4d9de0'),
        { postfx: [fx('bloom', { intensity: 1 })] })),

    T('gen-trance', 'Tür', 'Trance', 'Uzun yükselişler, geniş alan.',
      merge(B('spiral'), V('vortex', { glow: 0.7, barCount: 120 }),
        pal('#020617', '#1e40af', '#06b6d4', '#a5f3fc'),
        { postfx: [fx('bloom', { intensity: 1.2 }), fx('zoomblur', { strength: 0.12 })] },
        { modulation: { routes: [mod('anLoudness', 'postfx.1.params.strength', 0, 0.3, { smooth: 0.4 })] } })),

    T('gen-dubstep', 'Tür', 'Dubstep', 'Ağır düşüş, blok kayması.',
      merge(B('hexgrid'), V('blocks', { barCount: 64, gap: 0.25, glow: 0.6 }),
        pal('#0a0a0a', '#84cc16', '#22d3ee', '#f43f5e'),
        { postfx: [fx('datamosh', { amount: 0.1 }), fx('bloom', { intensity: 1.1 })] },
        { modulation: { routes: [mod('bass', 'postfx.0.params.amount', 0.02, 0.3, { curve: 'exp3' })] } })),

    T('gen-chiptune', 'Tür', 'Chiptune', 'Piksel ve sınırlı palet.',
      merge(B('grid'), V('dots', { barCount: 48, glow: 0.3 }),
        pal('#0f380f', '#306230', '#8bac0f', '#9bbc0f'),
        { postfx: [fx('pixelate', { size: 6 }), fx('dither', { levels: 4 })] })),

    T('gen-experimental', 'Tür', 'Experimental', 'Reaksiyon-difüzyon hissi.',
      merge(B('solid', { solidColor: '#000000' }), V('voronoi', { thickness: 0.7 }),
        pal('#000000', '#ffffff', '#ff0000'),
        { postfx: [fx('threshold', { level: 0.42 }), fx('edge', { amount: 0.5 })] })),

    // ========================= SUNUM / ETKİNLİK =========================
    T('evt-minimal', 'Etkinlik', 'Minimal Line', 'Tek çizgi, beyaz üstü siyah.',
      merge(B('solid', { solidColor: '#000000' }), V('wave', { thickness: 0.18, lineWidth: 2, glow: 0.2, rainbow: false, color: '#ffffff', color2: '#ffffff' }),
        pal('#000000', '#ffffff'))),

    T('evt-corporate', 'Etkinlik', 'Corporate', 'Sakin mavi, düzenli.',
      merge(B('network'), V('bars', { barCount: 80, gap: 0.4, glow: 0.3, rainbow: false, color: '#3b82f6', color2: '#93c5fd' }),
        pal('#0f172a', '#1e40af', '#3b82f6', '#dbeafe'))),

    T('evt-gala', 'Etkinlik', 'Gala', 'Altın ve siyah.',
      merge(B('bokeh'), V('arcs', { barCount: 96, glow: 0.6, rainbow: false, color: '#d4af37', color2: '#fff8dc' }),
        pal('#0a0a0a', '#8b6f1f', '#d4af37', '#fff8dc'),
        { postfx: [fx('bloom', { intensity: 1 }), fx('starfilter', { len: 0.04 })] })),

    T('evt-festival', 'Etkinlik', 'Festival', 'Yüksek doygunluk, geniş hareket.',
      merge(B('spiral'), V('kaleido', { barCount: 120, glow: 0.7 }),
        pal('#ff006e', '#fb5607', '#ffbe0b', '#8338ec', '#3a86ff'),
        { postfx: [fx('bloom', { intensity: 1.3 }), fx('chroma', { amount: 0.005 })] })),

    T('evt-projection', 'Etkinlik', 'Projection Test', 'Hizalama için ızgara ve kontrast.',
      merge(B('grid'), V('none'),
        pal('#000000', '#ffffff', '#00ff00', '#ff0000'),
        { mapping: { enabled: true, outputs: { default: null } } })),
  ];

  // Bir şablonu yapılandırmaya uygular; kullanıcının kurulumuna dokunmaz.
  const SCENE_KEYS = [
    'background', 'visualizer', 'geometry', 'postfx', 'layers', 'layerStack', 'logo',
    'modulation', 'transition', 'custom', 'milkdrop', 'images', 'feedback',
  ];

  /* Şablonu uygula.

     Yalnızca SAHNE alanları değişir. Ses aygıtı, ekran seçimi, yayın
     sunucusu, aydınlatma, kontrol eşlemeleri gibi kurulum alanları korunur —
     bir şablonu denemek kullanıcının kurulumunu bozmamalı.

     Sahne alanları önce VARSAYILANA döner. Bunu yapmazsak önceki şablondan
     kalan bir efekt zinciri ya da modülasyon yönlendirmesi yeni sahneye
     sızar ve kullanıcı "şablon bozuk" sanır.

     env: { defaultConfig, deepMerge, clone } — window.SV'nin karşılıkları. */
  function apply(cfg, tpl, env) {
    if (!cfg || !tpl || !env) return cfg;
    const { defaultConfig, deepMerge, clone } = env;
    const out = clone(cfg);
    const def = defaultConfig();
    /* Logo GÖRSELİ kullanıcının kendi içeriği, sahnenin parçası değil.
       Yerleşimi ve boyutu şablonla değişebilir ama dosyanın kendisi
       korunur — yoksa başka bir şablon denemek kullanıcının logosunu
       silerdi. */
    const logoSrc = (cfg.logo && cfg.logo.src) || null;
    for (const k of SCENE_KEYS) {
      if (def[k] !== undefined) out[k] = clone(def[k]);
    }
    if (logoSrc) out.logo.src = logoSrc;
    const merged = deepMerge(out, tpl.patch);
    /* Listeler doğrudan geçer. deepMerge dizileri birleştirmez ve bu
       bilinçli: bir şablonun efekt zinciri öncekinin ÜSTÜNE eklenmemeli,
       onun YERİNE geçmeli. */
    if (tpl.patch.postfx) merged.postfx = clone(tpl.patch.postfx);
    if (tpl.patch.layers) merged.layers = clone(tpl.patch.layers);
    if (tpl.patch.modulation && tpl.patch.modulation.routes) {
      merged.modulation = merged.modulation || clone(def.modulation);
      merged.modulation.routes = clone(tpl.patch.modulation.routes);
    }
    return merged;
  }

  function groups() {
    const out = [];
    for (const t of TEMPLATES) if (out.indexOf(t.group) < 0) out.push(t.group);
    return out;
  }

  const api = { TEMPLATES, apply, groups };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (typeof window !== 'undefined') window.SVTemplates = api;
})();
