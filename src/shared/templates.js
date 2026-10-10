/*
 * SoundVisualizer — CaYaDev Ses Görselleştirici
 * Copyright (c) 2026 Çağan Turgut (CaYatur) — CaYaDev, https://cayadev.com
 * https://github.com/CaYatur/SoundVisualizer
 * SPDX-License-Identifier: MIT
 */
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
      /* Sakin, yavaş, sese az tepki veren dikey zemin. Gren yok: kartlarda
         zemin düz ve temiz kalmalı (kullanıcı geri bildirimi, 10.10; eskiden
         0,1–0,2 gren zemini kumlu gösteriyordu). */
      const ground = (over) => B('gradient', {
        gradient: merge({
          style: 'soft', speed: 0.1, drift: 0.02, wander: 0.2, orbit: 0.15,
          swirl: 0.1, scale: 1.6, warp: 0.08, audioReactivity: 0.22,
          brightness: 0.9, audioBrightness: 0.5, audioHue: 0, grain: 0, vignette: 0.42,
        }, over || {}),
      });

      // Kenar boşluğu: barlar ve kart aynı dikey çizgiye hizalanır
      const M = 0.07;

      // Yayın düzeninde barlar: az sayıda, ince, gökkuşağı yok
      const barLayer = (id, over) => ({
        id, name: 'Barlar', kind: 'visualizer', type: 'bars',
        settings: { visualizer: Object.assign({
          barCount: 64, gap: 0.42, rainbow: false, cap: false, glow: 0.18,
          position: 'bottom', sensitivity: 0.7, mirror: false,
          barSpan: 1 - 2 * M, barCenterX: 0.5, barHeight: 0.3, baseline: 0.62,
          spectrum: { scale: 'log', amplitude: 'db', floorDb: -38, attack: 0.012, release: 0.22, spread: 0.2, smooth: 0.3 },
        }, over || {}) },
      });

      /* Kart: kapak ve yanında parça adı ile sanatçı, tek "Çalan Parça"
         katmanında. Kapak yazının yanına motor tarafından yerleşir ve yazı
         bloğuna dikeyde ortalanır; `anchor:'group'` ile x kapağın sol
         kenarıdır. Eskiden logo ve iki metin katmanı ayrı konumlanıyordu:
         kapak ile yazı arası 16:9'da geniş, 9:16'da dar kalıyor, yazı kapağa
         göre aşağı kayıyordu. Kapak yoksa yazı kenara yaslanır. */
      const card = (id, over) => ({
        id, name: 'Çalan Parça', kind: 'nowplaying', type: 'nowplaying',
        settings: {
          visualizer: { glow: 0 },
          nowplaying: merge({
            enabled: true, source: 'system', mode: 'always', animation: 'fade', speed: 'normal', style: 'modern',
            coverOverlay: true, coverSource: 'auto', coverSide: 'left', anchor: 'group', placeholder: true,
            coverFit: 'cover', coverSize: 0.19, coverGap: 0.14, coverRadius: 0.06, coverAudioScale: 0,
            show: { title: true, artist: true, album: false, appName: false, elapsed: false, remaining: false, total: false, bar: false },
            oneLine: false, uppercase: false,
            x: M, y: 0.82, align: 'left', vAlign: 'middle', size: 0.058, weight: 800, lineGap: 0.3, maxWidth: 0.6,
            scrollLongTitles: true,
            colorMode: 'custom', useCustomColor: true, color: '#ffffff', colorDim: '#cfcfd8', colorBar: '#ffffff',
            outline: 0, shadow: 0.25, audioScale: 0, opacity: 1,
          }, over || {}),
        },
      });

      const stack = (...layers) => ({ layerStack: { enabled: true }, layers });
      const bg = (id) => ({ id, name: 'Zemin', kind: 'background', type: 'gradient' });

      return [
        T('bc-label', 'Müzik Videosu', 'Label Card',
          'Resmî kanal düzeni: geniş bar şeridi, altında kapak ve parça bilgisi.',
          merge(
            ground({ brightness: 0.85 }),
            pal('#0b0405', '#1a0709', '#4a0d14', '#b8121f', '#ff2d3a'),
            stack(
              bg('bcl_bg'),
              barLayer('bcl_bars', { color: '#ff2d3a', barCount: 72, barHeight: 0.32, baseline: 0.64 }),
              card('bcl_card')
            ),
            { postfx: [fx('bloom', { threshold: 0.72, intensity: 0.35, radius: 2 })] }
          )),

        T('bc-artwork', 'Müzik Videosu', 'Artwork Card',
          'Büyük kapak solda, parça bilgisi yanında; barlar üstte.',
          merge(
            ground({ brightness: 0.8 }),
            pal('#0a0406', '#210a10', '#5c1220', '#c81f33', '#ff5566'),
            stack(
              bg('bca_bg'),
              barLayer('bca_bars', { color: '#ff4757', barCount: 80, barHeight: 0.28, baseline: 0.52 }),
              card('bca_card', { coverSize: 0.27, size: 0.066, y: 0.78, coverRadius: 0.05 })
            ),
            { postfx: [fx('bloom', { threshold: 0.75, intensity: 0.3 })] }
          )),

        T('bc-line', 'Müzik Videosu', 'Baseline Bars',
          'Parlak bir taban çizgisine oturan barlar, altında büyük başlık.',
          merge(
            ground({ brightness: 0.75, vignette: 0.5 }),
            pal('#0a0410', '#1b0726', '#4a0f52', '#c81d8e', '#ff2d95'),
            stack(
              bg('bcn_bg'),
              barLayer('bcn_bars', { color: '#ff2d95', barCount: 110, gap: 0.3, glow: 0.32, barHeight: 0.3, baseline: 0.6 }),
              card('bcn_card', { coverSize: 0.17, size: 0.074, y: 0.79, coverRadius: 0.5 })
            ),
            { postfx: [fx('bloom', { threshold: 0.6, intensity: 0.55 })] }
          )),

        T('bc-amber', 'Müzik Videosu', 'Amber Room',
          'Koyu tepeden sıcak sarıya inen zemin, ortada bar şeridi.',
          merge(
            ground({ brightness: 0.9 }),
            pal('#080806', '#161405', '#4a4406', '#c9b40b', '#f5e050'),
            stack(
              bg('bcm_bg'),
              barLayer('bcm_bars', { color: '#e8d21a', barCount: 60, gap: 0.45, barHeight: 0.3, baseline: 0.62 }),
              card('bcm_card', { colorDim: '#e9dfb0' })
            ),
            { postfx: [fx('bloom', { threshold: 0.78, intensity: 0.28 })] }
          )),

        T('bc-minimal', 'Müzik Videosu', 'Minimal White',
          'İnce beyaz barlar, koyu ve düz zemin; en sade yayın düzeni.',
          merge(
            ground({ brightness: 0.5, vignette: 0.55, audioReactivity: 0.1 }),
            pal('#0a0908', '#141210', '#241f1b', '#3a322c', '#4a403a'),
            stack(
              bg('bcw_bg'),
              barLayer('bcw_bars', { color: '#ffffff', barCount: 96, gap: 0.55, glow: 0.04, barHeight: 0.22, baseline: 0.6 }),
              card('bcw_card', { coverSize: 0.16, size: 0.05, weight: 700, coverRadius: 0.03, y: 0.81 })
            ),
            { postfx: [] }
          )),

        T('bc-quiet', 'Müzik Videosu', 'Quiet Frame',
          'Neredeyse boş kadraj: altta küçük kart, yanında ince barlar.',
          merge(
            ground({ brightness: 0.4, vignette: 0.6, audioReactivity: 0.08 }),
            pal('#050506', '#0b0b0e', '#131318', '#1c1c24', '#2a2a36'),
            stack(
              bg('bcq_bg'),
              card('bcq_card', { coverSize: 0.12, size: 0.04, weight: 700, y: 0.86, coverRadius: 0.08, maxWidth: 0.42 }),
              barLayer('bcq_bars', { color: '#ffffff', barCount: 40, gap: 0.55, glow: 0.04,
                barSpan: 0.24, barCenterX: 1 - M - 0.12, barHeight: 0.1, baseline: 0.92 })
            ),
            { postfx: [] }
          )),

        T('bc-corner', 'Müzik Videosu', 'Corner Meter',
          'Kart sol altta, barlar sağ altta; ikisi aynı taban çizgisinde.',
          merge(
            ground({ brightness: 0.65, vignette: 0.5 }),
            pal('#04070a', '#0a1420', '#12304a', '#1d6fa8', '#38bdf8'),
            stack(
              bg('bcc_bg'),
              card('bcc_card', { coverSize: 0.15, size: 0.048, y: 0.845, maxWidth: 0.34 }),
              barLayer('bcc_bars', { color: '#38bdf8', barCount: 48, gap: 0.4,
                barSpan: 0.3, barCenterX: 1 - M - 0.15, barHeight: 0.2, baseline: 0.92 })
            ),
            { postfx: [fx('bloom', { threshold: 0.8, intensity: 0.22 })] }
          )),

        T('bc-center', 'Müzik Videosu', 'Centre Strip',
          'Ortada kapak ve başlık, altında dar bar şeridi; simetrik ve sakin.',
          merge(
            ground({ brightness: 0.75, vignette: 0.45 }),
            pal('#06060a', '#0d0d18', '#1c1b3a', '#3f3a8c', '#8b7bff'),
            stack(
              bg('bcs_bg'),
              card('bcs_card', { coverSide: 'top', align: 'center', anchor: 'text', x: 0.5, y: 0.5,
                coverSize: 0.26, coverGap: 0.1, size: 0.052, maxWidth: 0.7 }),
              barLayer('bcs_bars', { color: '#8b7bff', barCount: 72, gap: 0.4, position: 'center',
                barSpan: 0.5, barHeight: 0.1, baseline: 0.82 })
            ),
            { postfx: [fx('bloom', { threshold: 0.72, intensity: 0.35 })] }
          )),

        // ---- yeni kartlar (10.10)
        T('bc-wave', 'Müzik Videosu', 'Wave Card',
          'Ekranı boydan boya geçen yumuşak dalga, altında kapak ve parça bilgisi.',
          merge(
            ground({ brightness: 0.8 }),
            pal('#03070d', '#081a2b', '#0e3d5c', '#1aa3c9', '#7ee8fa'),
            stack(
              bg('bcv_bg'),
              { id: 'bcv_wave', name: 'Dalga', kind: 'visualizer', type: 'wave',
                settings: { visualizer: { thickness: 0.2, lineWidth: 3, glow: 0.4, rainbow: false, color: '#7ee8fa', color2: '#1aa3c9', sensitivity: 0.75 } },
                transform: { x: 0, y: -0.12, scale: 1, rotate: 0, flipX: false, flipY: false } },
              card('bcv_card')
            ),
            { postfx: [fx('bloom', { threshold: 0.6, intensity: 0.45 })] }
          )),

        T('bc-ring', 'Müzik Videosu', 'Cover Ring',
          'Ortada yuvarlak kapak, çevresinde dairesel spektrum; altında parça bilgisi.',
          merge(
            ground({ brightness: 0.7, vignette: 0.5 }),
            pal('#06040c', '#120a24', '#2c1857', '#7c4dff', '#c3a6ff'),
            stack(
              bg('bcr_bg'),
              { id: 'bcr_ring', name: 'Halka', kind: 'visualizer', type: 'circular',
                settings: { visualizer: { barCount: 120, glow: 0.35, rainbow: false, color: '#c3a6ff', color2: '#7c4dff', sensitivity: 0.55, thickness: 0.35 } },
                transform: { x: 0, y: -0.08, scale: 1, rotate: 0, flipX: false, flipY: false } },
              { id: 'bcr_cover', name: 'Kapak', kind: 'logo',
                settings: { logo: { enabled: true, source: 'auto', scale: 0.3, x: 0.5, y: 0.42, cornerRadius: 0.5, pulse: 0.03, glow: 0, opacity: 1 } } },
              card('bcr_card', { coverOverlay: false, align: 'center', anchor: 'text', x: 0.5, y: 0.88, size: 0.05, maxWidth: 0.8 })
            ),
            { postfx: [fx('bloom', { threshold: 0.65, intensity: 0.4 })] }
          )),

        T('bc-stage', 'Müzik Videosu', 'Stage Card',
          'Büyük kapak ve başlık sol yarıda dikeyde ortada, barlar sağ yarıda.',
          merge(
            ground({ brightness: 0.75 }),
            pal('#050807', '#0b1a14', '#14402e', '#22a06b', '#7cf0b4'),
            stack(
              bg('bct_bg'),
              card('bct_card', { coverSide: 'top', anchor: 'text', x: M + 0.02, y: 0.56, coverSize: 0.34, coverGap: 0.08, size: 0.06, maxWidth: 0.36 }),
              barLayer('bct_bars', { color: '#7cf0b4', barCount: 48, gap: 0.42, barSpan: 0.42, barCenterX: 1 - M - 0.21, barHeight: 0.42, baseline: 0.72 })
            ),
            { postfx: [fx('bloom', { threshold: 0.7, intensity: 0.32 })] }
          )),
      ];
    })(),

    /* ==================== MÜZİK ARKA PLANI ====================

       Müzik çalarken arkada sade, tam ekran bir görselleştirici; önde
       yalnız çalan parça. Görselleştirici katmanı kısık (opaklık), kart
       okunur kalır. Kulüp şablonlarından farkı: sakin hız, az efekt. */
    ...(() => {
      const card = (id, over) => ({
        id, name: 'Çalan Parça', kind: 'nowplaying', type: 'nowplaying',
        settings: {
          visualizer: { glow: 0 },
          nowplaying: merge({
            enabled: true, source: 'system', mode: 'always', animation: 'fade', speed: 'normal', style: 'modern',
            coverOverlay: true, coverSource: 'auto', coverSide: 'left', anchor: 'group', placeholder: true,
            coverFit: 'cover', coverSize: 0.17, coverGap: 0.14, coverRadius: 0.06, coverAudioScale: 0,
            show: { title: true, artist: true, album: false, appName: false, elapsed: false, remaining: false, total: false, bar: false },
            oneLine: false, uppercase: false,
            x: 0.07, y: 0.83, align: 'left', vAlign: 'middle', size: 0.054, weight: 800, lineGap: 0.3, maxWidth: 0.6,
            scrollLongTitles: true,
            colorMode: 'custom', useCustomColor: true, color: '#ffffff', colorDim: '#d6d6e0', colorBar: '#ffffff',
            outline: 0, shadow: 0.45, audioScale: 0, opacity: 1,
          }, over || {}),
        },
      });
      const centred = (id, over) => card(id, merge({ coverSide: 'top', align: 'center', anchor: 'text', x: 0.5, y: 0.6,
        coverSize: 0.3, coverGap: 0.09, size: 0.056, maxWidth: 0.8 }, over || {}));
      const vis = (id, name, type, opacity, settings) => ({ id, name, kind: 'visualizer', type, opacity, settings: { visualizer: settings || {} } });
      const stack = (...layers) => ({ layerStack: { enabled: true }, layers });

      return [
        T('np-aurora', 'Müzik Arka Planı', 'Aurora Backdrop',
          'Arkada yavaş kutup ışıkları ve ince dalga; ortada kapak ve parça bilgisi.',
          merge(
            B('aurora', { gradient: { speed: 0.22, brightness: 0.8, grain: 0 } }),
            pal('#04121f', '#0f8a7a', '#3ad6c0', '#a3e4ff', '#e8fbff'),
            stack(
              { id: 'npa_bg', name: 'Zemin', kind: 'background', type: 'aurora' },
              Object.assign(vis('npa_wave', 'Dalga', 'wave', 0.7, { thickness: 0.24, lineWidth: 2, glow: 0.35, rainbow: false, color: '#a3e4ff', color2: '#3ad6c0', sensitivity: 0.7 }),
                { transform: { x: 0, y: 0.32, scale: 1, rotate: 0, flipX: false, flipY: false } }),
              centred('npa_card', { y: 0.5 })
            ),
            { postfx: [fx('bloom', { threshold: 0.6, intensity: 0.45 }), fx('vignette', { amount: 0.35 })] },
            { transition: { type: 'crossfade', duration: 2 } }
          )),

        T('np-flow', 'Müzik Arka Planı', 'Flow Backdrop',
          'Arkada sese göre akan ince izler; sol altta kapak ve parça bilgisi.',
          merge(
            B('solid', { solidColor: '#05060b' }),
            pal('#0a1220', '#2e6f8e', '#63c7b2', '#f2e9c9', '#ffffff'),
            stack(
              { id: 'npf_bg', name: 'Zemin', kind: 'background', type: 'solid' },
              vis('npf_flow', 'Akış', 'flowfield', 1, { thickness: 0.6, lineWidth: 3, sensitivity: 0.9, glow: 0.4 }),
              card('npf_card')
            ),
            { postfx: [fx('bloom', { intensity: 0.5 }), fx('vignette', { amount: 0.45 })] },
            { transition: { type: 'crossfade', duration: 2 } }
          )),

        T('np-nebula', 'Müzik Arka Planı', 'Nebula Backdrop',
          'Arkada yavaş bulutsu ve sarmal; ortada büyük kapak.',
          merge(
            B('nebula', { gradient: { speed: 0.2, brightness: 1, grain: 0 } }),
            pal('#0b0620', '#3b1d7a', '#7c3aed', '#22d3ee', '#f0abfc'),
            stack(
              { id: 'npn_bg', name: 'Zemin', kind: 'background', type: 'nebula' },
              Object.assign(vis('npn_dna', 'Sarmal', 'dna', 0.55, { thickness: 0.5, glow: 0.4, sensitivity: 0.7 }),
                { transform: { x: 0, y: 0.34, scale: 1, rotate: 90, flipX: false, flipY: false } }),
              centred('npn_card', { coverSize: 0.34, y: 0.48 })
            ),
            { postfx: [fx('bloom', { intensity: 0.6 }), fx('vignette', { amount: 0.4 })] },
            { transition: { type: 'crossfade', duration: 2 } }
          )),

        T('np-milkdrop', 'Müzik Arka Planı', 'MilkDrop Backdrop',
          'Arkada kısık bir MilkDrop akışı; sol altta kapak ve parça bilgisi.',
          merge(
            V('milkdrop'), B('solid', { solidColor: '#000000' }),
            pal('#0a0020', '#7c4dff', '#00e5ff', '#ff4081'),
            stack(
              { id: 'npm_bg', name: 'Zemin', kind: 'background', type: 'solid' },
              vis('npm_md', 'MilkDrop', 'milkdrop', 0.55),
              card('npm_card')
            ),
            { postfx: [fx('vignette', { amount: 0.5 })] }
          )),

        T('np-galaxy', 'Müzik Arka Planı', 'Galaxy Backdrop',
          'Arkada dönen yıldız diski; sol altta kapak ve parça bilgisi.',
          merge(
            B('starfield'),
            pal('#02020a', '#4338ca', '#0ea5e9', '#fde68a', '#ffffff'),
            stack(
              { id: 'npg_bg', name: 'Zemin', kind: 'background', type: 'starfield' },
              Object.assign(vis('npg_galaxy', 'Galaksi', 'galaxy', 0.9, { glow: 0.6, thickness: 0.6, sensitivity: 0.8 }),
                { transform: { x: 0.18, y: -0.08, scale: 1.6, rotate: 0, flipX: false, flipY: false } }),
              card('npg_card')
            ),
            { postfx: [fx('bloom', { intensity: 0.7 })] }
          )),

        T('np-glow', 'Müzik Arka Planı', 'Soft Glow',
          'Arkada sese göre nefes alan yumuşak renk alanı; ortada kapak.',
          merge(
            B('gradient', { gradient: { style: 'soft', speed: 0.18, warp: 0.2, audioReactivity: 0.5, brightness: 0.85, audioBrightness: 0.8, grain: 0, vignette: 0.45 } }),
            pal('#0b0b1e', '#3a1c71', '#d76d77', '#ffaf7b', '#1b1b3a'),
            stack(
              { id: 'npw_bg', name: 'Zemin', kind: 'background', type: 'gradient' },
              centred('npw_card')
            ),
            { postfx: [] },
            { transition: { type: 'crossfade', duration: 2 } }
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
  function getLayersApi(env) {
    if (env && env.layers) return env.layers;
    if (typeof window !== 'undefined' && window.SVLayers) return window.SVLayers;
    if (typeof require !== 'undefined') {
      try { return require('../visualizer/layers.js'); } catch { }
    }
    return null;
  }

  /* Factory reset for Ready Templates card.

     Mirrors apply()'s SCENE_KEYS wipe + user-setup preserves, without
     merging a template patch. Keeps audio/display/stream/lighting intact
     and restores logo identity + transparent-window flags the same way
     apply() does, so the card badge can clear permanently. */
  function resetScene(cfg, env) {
    if (!cfg || !env) return cfg;
    const { defaultConfig, clone } = env;
    const def = defaultConfig();
    const keepTransparent = !!(cfg.background && cfg.background.transparent);
    const keepKey = cfg.background && cfg.background.transparentKey;
    const keepCover = cfg.background && cfg.background.coverTaskbar;
    const logoSrc = (cfg.logo && cfg.logo.src) || null;
    const logoLibraryId = (cfg.logo && cfg.logo.libraryId) || null;
    const logoKind = (cfg.logo && cfg.logo.kind) || null;
    const logoSource = (cfg.logo && cfg.logo.source) || null;
    const logoEnabled = cfg.logo && typeof cfg.logo.enabled === 'boolean' ? cfg.logo.enabled : null;
    for (const k of SCENE_KEYS) {
      if (def[k] !== undefined) cfg[k] = clone(def[k]);
    }
    if (cfg.logo) {
      if (logoSrc) cfg.logo.src = logoSrc;
      if (logoLibraryId) cfg.logo.libraryId = logoLibraryId;
      if (logoKind) cfg.logo.kind = logoKind;
      if (logoSource) cfg.logo.source = logoSource;
      if (logoEnabled !== null) cfg.logo.enabled = logoEnabled;
    }
    if (cfg.background) {
      cfg.background.transparent = keepTransparent;
      if (keepKey != null) cfg.background.transparentKey = keepKey;
      if (keepCover != null) cfg.background.coverTaskbar = !!keepCover;
    }
    return cfg;
  }

  function apply(cfg, tpl, env) {
    if (!cfg || !tpl || !env) return cfg;
    const { defaultConfig, deepMerge, clone } = env;
    const out = clone(cfg);
    const def = defaultConfig();
    /* Logo GÖRSELİ ve etkin durumu kullanıcının kendi çalışma alanı içeriğidir.
       Yerleşimi ve boyutu şablonla değişebilir ama dosyanın kendisi ve
       kullanıcının açıp kapama tercihleri şablonda açıkça belirtilmedikçe
       korunur — yoksa başka bir şablon denemek kullanıcının logosunu ya da
       katman yığını düzenini kapatırdı. */
    const keepTransparent = !!(cfg.background && cfg.background.transparent);
    const keepKey = cfg.background && cfg.background.transparentKey;
    const keepCover = cfg.background && cfg.background.coverTaskbar;
    const logoSrc = (cfg.logo && cfg.logo.src) || null;
    const logoLibraryId = (cfg.logo && cfg.logo.libraryId) || null;
    const logoKind = (cfg.logo && cfg.logo.kind) || null;
    const logoSource = (cfg.logo && cfg.logo.source) || null;
    const logoEnabled = cfg.logo && typeof cfg.logo.enabled === 'boolean' ? cfg.logo.enabled : null;
    const layerStackEnabled = cfg.layerStack && typeof cfg.layerStack.enabled === 'boolean' ? cfg.layerStack.enabled : null;
    const userLogo = (cfg.logo && typeof cfg.logo === 'object') ? clone(cfg.logo) : null;
    for (const k of SCENE_KEYS) {
      if (def[k] !== undefined) out[k] = clone(def[k]);
    }
    if (logoSrc) out.logo.src = logoSrc;
    if (logoLibraryId) out.logo.libraryId = logoLibraryId;
    if (logoKind) out.logo.kind = logoKind;
    if (logoSource) out.logo.source = logoSource;
    const merged = deepMerge(out, tpl.patch);
    if (!tpl.patch.logo && userLogo) {
      merged.logo = Object.assign({}, userLogo);
    } else {
      if (logoEnabled !== null && (!tpl.patch.logo || tpl.patch.logo.enabled === undefined)) {
        merged.logo = merged.logo || {};
        merged.logo.enabled = logoEnabled;
      }
      if (logoSrc) {
        merged.logo = merged.logo || {};
        merged.logo.src = logoSrc;
      }
      if (logoLibraryId) {
        merged.logo = merged.logo || {};
        merged.logo.libraryId = logoLibraryId;
      }
      if (logoKind) {
        merged.logo = merged.logo || {};
        merged.logo.kind = logoKind;
      }
      if (logoSource) {
        merged.logo = merged.logo || {};
        merged.logo.source = logoSource;
      }
    }
    if (layerStackEnabled !== null && (!tpl.patch.layerStack || tpl.patch.layerStack.enabled === undefined)) {
      merged.layerStack = merged.layerStack || {};
      merged.layerStack.enabled = layerStackEnabled;
    }
    /* Listeler doğrudan geçer. deepMerge dizileri birleştirmez ve bu
       bilinçli: bir şablonun efekt zinciri öncekinin ÜSTÜNE eklenmemeli,
       onun YERİNE geçmeli. */
    if (tpl.patch.postfx) merged.postfx = clone(tpl.patch.postfx);
    const layersApi = getLayersApi(env);
    if (tpl.patch.layers) {
      merged.layers = clone(tpl.patch.layers);
      merged.layers.forEach((ly) => {
        if (ly && ly.kind === 'logo') {
          ly.settings = ly.settings || {};
          ly.settings.logo = ly.settings.logo || {};
          if (logoSrc) ly.settings.logo.src = logoSrc;
          if (logoLibraryId) ly.settings.logo.libraryId = logoLibraryId;
          if (logoKind) ly.settings.logo.kind = logoKind;
          if (logoSource) ly.settings.logo.source = logoSource;
        }
      });
    } else if (layerStackEnabled) {
      // Şablonda açık katman listesi yoksa ve katman yığını açıksa,
      // önceki şablondan kalan eski katmanların (metinler, eski logolar,
      // önceki görselleştiriciler) üst üste binmesini önlemek için
      // yeni şablonun temiz sahnesinden katmanlar yeniden sentezlenir.
      if (layersApi && typeof layersApi.synthesize === 'function') {
        merged.layers = layersApi.synthesize(merged);
      } else {
        merged.layers = [];
      }
    } else {
      merged.layers = [];
    }
    if (tpl.patch.modulation && tpl.patch.modulation.routes) {
      merged.modulation = merged.modulation || clone(def.modulation);
      merged.modulation.routes = clone(tpl.patch.modulation.routes);
    }
    if (merged.background) {
      merged.background.transparent = keepTransparent;
      if (keepKey != null) merged.background.transparentKey = keepKey;
      if (keepCover != null) merged.background.coverTaskbar = !!keepCover;
    }
    giveFxIds(merged);
    return merged;
  }

  /* Şablonun efektleri kimliksiz yazılıyordu (fx()); panelden eklenenler
     kimlik alıyor. Kimliksiz efekt MCP'de `effectId` ile hedeflenemiyor,
     yalnız sırasıyla seçilebiliyordu. Biçim postfx.js'teki gibi. */
  let fxSeq = 0;
  function giveFxIds(cfg) {
    const give = (list) => {
      if (!Array.isArray(list)) return;
      for (const f of list) {
        if (f && typeof f === 'object' && !f.id) {
          fxSeq = (fxSeq + 1) % 0x7fffffff;
          f.id = 'fx_' + Date.now().toString(36) + '_' + fxSeq.toString(36) + Math.floor(Math.random() * 0xffff).toString(36);
        }
      }
    };
    give(cfg.postfx);
    (Array.isArray(cfg.layers) ? cfg.layers : []).forEach((l) => { if (l) give(l.postfx); });
  }

  function groups() {
    const out = [];
    for (const t of TEMPLATES) if (out.indexOf(t.group) < 0) out.push(t.group);
    return out;
  }

  const api = { TEMPLATES, SCENE_KEYS, apply, resetScene, groups };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (typeof window !== 'undefined') window.SVTemplates = api;
})();
