/*
 * SoundVisualizer — CaYaDev Ses Görselleştirici
 * Copyright (c) 2026 Çağan Turgut (CaYatur) — CaYaDev, https://cayadev.com
 * https://github.com/CaYatur/SoundVisualizer
 * SPDX-License-Identifier: MIT
 */
'use strict';
/* Hazır MIDI denetleyici haritaları.

   Yaygın denetleyicilerin fader, düğüm ve düğmelerini kullanışlı hedeflere
   bağlayan şablonlar. Aygıt adı tanınınca panel haritayı ÖNERİR; kullanıcı
   onaylamadan mevcut eşlemelere dokunulmaz. Uygularken aynı kaynağa
   (tür + kanal + numara) bağlı bir eşleme zaten varsa o atlanır.

   Numaralar üreticilerin varsayılan kiplerine göre:
   - nanoKONTROL2: CC kipi, kanal 1 (LED geri bildirimi için Korg
     Kontrol Editor'da LED Mode = External).
   - APC40 mkII: genel kip; faderlar kanal 1-8 CC 7, klip ızgarası nota 0-39.
   - Launchpad (Mini MK3 / X / Pro MK3): Programmer kipi; ızgara nota
     11-88 (satır*10 + sütun), üst sıra CC 91-98.
   - Push 2: User kipi; pedler nota 36-99, kodlayıcılar CC 71-78. */
(function () {
  const A = (action) => 'action:' + action;

  const range = (n, f) => Array.from({ length: n }, (_, i) => f(i));

  // Sık kullanılan kaydırıcı hedefleri (schema.SLIDERS içinde)
  const FADERS = [
    'audio.sensitivity', 'visualizer.sensitivity', 'visualizer.glow', 'background.gradient.brightness',
    'background.gradient.speed', 'feedback.decay', 'media.opacity', 'logo.opacity',
  ];
  const KNOBS = [
    'audio.smoothing', 'audio.bassBoost', 'background.gradient.audioReactivity', 'background.gradient.audioHue',
    'feedback.zoom', 'feedback.warp', 'feedback.rotate', 'milkdrop.blendTime',
  ];
  const BUTTONS = [
    A('nextScene'), A('nextVisualizer'), A('prevVisualizer'), A('nextBackground'),
    A('nextPalette'), A('mdNext'), A('mdRandom'), A('blackout'),
  ];

  const TEMPLATES = [
    {
      id: 'nanokontrol2',
      name: 'Korg nanoKONTROL2',
      match: /nanokontrol\s*2/i,
      mappings: [].concat(
        range(8, (i) => ({ kind: 'cc', channel: 1, cc: i, target: FADERS[i] })),
        range(8, (i) => ({ kind: 'cc', channel: 1, cc: 16 + i, target: KNOBS[i] })),
        range(8, (i) => ({ kind: 'cc', channel: 1, cc: 32 + i, target: BUTTONS[i] })),
        [
          { kind: 'cc', channel: 1, cc: 41, target: A('tlPlay') },
          { kind: 'cc', channel: 1, cc: 42, target: A('tlStop') },
          { kind: 'cc', channel: 1, cc: 43, target: A('tlPrevMarker') },
          { kind: 'cc', channel: 1, cc: 44, target: A('tlNextMarker') },
          { kind: 'cc', channel: 1, cc: 58, target: A('mdPrev') },
          { kind: 'cc', channel: 1, cc: 59, target: A('mdNext') },
        ]
      ),
    },
    {
      id: 'apc40mk2',
      name: 'Akai APC40 mkII',
      match: /apc\s*40/i,
      mappings: [].concat(
        range(8, (i) => ({ kind: 'cc', channel: i + 1, cc: 7, target: FADERS[i] })),
        range(8, (i) => ({ kind: 'cc', channel: 1, cc: 16 + i, target: KNOBS[i] })),
        range(8, (i) => ({ kind: 'note', channel: 1, cc: 32 + i, target: BUTTONS[i] })), // ızgaranın alt sırası
        [
          { kind: 'cc', channel: 1, cc: 14, target: 'background.gradient.brightness' }, // ana fader
          { kind: 'note', channel: 1, cc: 82, target: A('nextScene') }, // sahne başlatma 1
          { kind: 'note', channel: 1, cc: 83, target: A('mdNext') },
          { kind: 'note', channel: 1, cc: 84, target: A('mdPrev') },
          { kind: 'note', channel: 1, cc: 85, target: A('mdRandom') },
          { kind: 'note', channel: 1, cc: 86, target: A('mdLock') },
          { kind: 'note', channel: 1, cc: 81, target: A('deckStopAll') }, // Stop All Clips
          { kind: 'note', channel: 1, cc: 91, target: A('tlPlay') },
        ]
      ),
    },
    {
      id: 'launchpad',
      name: 'Novation Launchpad (Programmer)',
      match: /launchpad/i,
      mappings: [].concat(
        range(8, (i) => ({ kind: 'note', channel: 1, cc: 11 + i, target: BUTTONS[i] })), // alt sıra
        [
          { kind: 'cc', channel: 1, cc: 91, target: A('mdPrev') },
          { kind: 'cc', channel: 1, cc: 92, target: A('mdNext') },
          { kind: 'cc', channel: 1, cc: 93, target: A('mdRandom') },
          { kind: 'cc', channel: 1, cc: 94, target: A('mdLock') },
          { kind: 'cc', channel: 1, cc: 95, target: A('tlPlay') },
          { kind: 'cc', channel: 1, cc: 96, target: A('tlPause') },
          { kind: 'cc', channel: 1, cc: 97, target: A('tlPrevMarker') },
          { kind: 'cc', channel: 1, cc: 98, target: A('tlNextMarker') },
        ]
      ),
    },
    {
      id: 'push2',
      name: 'Ableton Push 2 (User)',
      match: /push\s*2/i,
      mappings: [].concat(
        range(8, (i) => ({ kind: 'cc', channel: 1, cc: 71 + i, target: FADERS[i], relative: 'twos-complement' })),
        range(8, (i) => ({ kind: 'note', channel: 1, cc: 36 + i, target: BUTTONS[i] })), // alt ped sırası
        [
          { kind: 'cc', channel: 1, cc: 85, target: A('tlPlay') },
        ]
      ),
    },
  ];

  function byId(id) { return TEMPLATES.find((t) => t.id === id) || null; }

  // Aygıt adına göre şablon (yoksa null)
  function matchDevice(name) {
    const n = String(name || '');
    if (!n) return null;
    return TEMPLATES.find((t) => t.match.test(n)) || null;
  }

  function srcKey(m) {
    return (m.kind === 'note' ? 'n' : 'c') + ':' + ((m.channel | 0) || 0) + ':' + (m.cc | 0);
  }

  /* Şablonu eşleme nesnelerine çevirir. `idGen` kimlik üretir (test için). */
  function toMappings(tpl, idGen) {
    const gen = idGen || ((i) => 'map_' + Date.now().toString(36) + '_' + i);
    return (tpl ? tpl.mappings : []).map((m, i) => ({
      id: gen(i), kind: m.kind, channel: m.channel | 0, cc: m.cc | 0,
      address: '/cayadev/1', index: -1, pad: -1, target: m.target, min: null, max: null, preset: tpl.id,
      ...(m.relative ? { relative: m.relative } : {}),
    }));
  }

  /* Mevcut listeye ekler; aynı kaynaklı eşleme varsa dokunmaz. Hedefi
     bilinmeyen eşleme (`known(target)` false) eklenmez. */
  function apply(list, tpl, opts) {
    const o = opts || {};
    const have = new Set((list || []).map(srcKey));
    let added = 0;
    let skipped = 0;
    for (const m of toMappings(tpl, o.idGen)) {
      // Kanal 0 (= her kanal) eşlemesi aynı numarayı zaten yakalar
      const any = srcKey(Object.assign({}, m, { channel: 0 }));
      if (have.has(srcKey(m)) || have.has(any) || (o.known && !o.known(m.target))) { skipped++; continue; }
      list.push(m);
      have.add(srcKey(m));
      added++;
    }
    return { added, skipped };
  }

  const api = { TEMPLATES, byId, matchDevice, toMappings, apply };
  if (typeof window !== 'undefined') window.SVControllerMaps = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})();
