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

   Kaynaklar ve sınırlar: docs/midi-controllers.md. Korg CC sahnesi kullanıcı
   tarafından aşağıdaki numaralarla ayarlanmalı; fabrika ayarı varsayılmaz.
   Kip değiştirme yalnız ayrı hazırlama düğmesiyle, tanınan çıkışa yapılır. */
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
      name: 'Korg nanoKONTROL2 (CC setup)',
      match: /nanokontrol\s*2\b/i,
      mappings: [].concat(
        range(8, (i) => ({ kind: 'cc', channel: 1, cc: i, target: FADERS[i] })),
        range(8, (i) => ({ kind: 'cc', channel: 1, cc: 16 + i, target: KNOBS[i] })),
        range(8, (i) => ({ kind: 'cc', channel: 1, cc: 32 + i, target: BUTTONS[i] })),
        [
          { kind: 'cc', channel: 1, cc: 41, target: A('tlPlay') },
          { kind: 'cc', channel: 1, cc: 42, target: A('tlStop') },
          { kind: 'cc', channel: 1, cc: 61, target: A('tlPrevMarker') },
          { kind: 'cc', channel: 1, cc: 62, target: A('tlNextMarker') },
          { kind: 'cc', channel: 1, cc: 58, target: A('mdPrev') },
          { kind: 'cc', channel: 1, cc: 59, target: A('mdNext') },
        ]
      ),
    },
    {
      id: 'apc40mk2',
      name: 'Akai APC40 mkII',
      match: /apc\s*40\s*mk\s*(?:ii|2)\b/i,
      mappings: [].concat(
        range(8, (i) => ({ kind: 'cc', channel: i + 1, cc: 7, target: FADERS[i] })),
        // Üst track düğümleri sabittir; device düğümlerinin kanalı seçili track ile değişir.
        range(8, (i) => ({ kind: 'cc', channel: 1, cc: 48 + i, target: KNOBS[i] })),
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
      match: /(?:launchpad\s*(?:x\b|mini\s*\[?mk\s*3\b|pro\s*\[?mk\s*3\b)|lp(?:mini|pro)mk3\b|lpx\b)/i,
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
      match: /push\s*2\b/i,
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

  /* İşletim sisteminin eklediği yön sözcükleri ayıklanır; port sırası KALIR.
     Win IN2/OUT2, macOS User Port ve ALSA :1 aynı rolü anlatabilir. */
  function portInfo(name) {
    const n = String(name || '').trim();
    const tpl = matchDevice(n);
    if (!tpl) return null;
    const compact = n.toLowerCase().replace(/[^a-z0-9]/g, '');
    const win = n.match(/midi(?:in|out)([123])\b/i);
    const alsa = n.match(/\d+:(\d+)\s*$/);
    const index = win ? Number(win[1]) : alsa ? Number(alsa[1]) + 1 : 0;
    let model = tpl.id;
    let role = 'main';
    if (model === 'push2') {
      role = /user/i.test(n) || index === 2 ? 'user' : 'live';
    } else if (model === 'launchpad') {
      model = /lpminimk3|launchpadminimk3/.test(compact) ? 'lpmini3'
        : /lppromk3|launchpadpromk3/.test(compact) ? 'lppro3' : 'lpx';
      role = /daw/i.test(n) ? 'daw' : /\bdin\b/i.test(n) ? 'din'
        : index ? (model === 'lppro3' ? ['midi', 'din', 'daw'][index - 1] : ['daw', 'midi'][index - 1])
        : /\bmidi\b/i.test(n) ? 'midi' : 'unknown';
    }
    // Birden çok aynı model takılıysa ad farklılığını silerek yanlış aygıta eşlemeyelim.
    const pair = n.toLowerCase().replace(/slider\s*\/\s*knob|\bctrl\b/g, 'control').replace(/midi(?:in|out)([123])/g, 'midiport$1')
      .replace(/\b(?:in|out|input|output)\b/g, '').replace(/\s+/g, ' ').trim();
    return { id: tpl.id, model, role, pair };
  }

  function acceptsPort(preset, name) {
    const p = portInfo(name);
    return !!(p && p.id === preset && (preset === 'push2' ? p.role === 'user'
      : preset === 'launchpad' ? p.role === 'midi' : true));
  }

  /* Belirsiz portlar otomatik seçilmez. Yön eki dışında ad bire bir eşleşmeli;
     sürücünün başka bir ad verdiği durumda kullanıcı çıkışı elle seçebilir. */
  function paired(inputName, outputName) {
    const a = portInfo(inputName); const b = portInfo(outputName);
    return !!(a && b && a.model === b.model && a.role === b.role && a.pair === b.pair);
  }

  function modeMessages(preset, outputName, restore) {
    if (!acceptsPort(preset, outputName)) return [];
    const p = portInfo(outputName);
    if (preset === 'push2') return [[0xf0, 0x00, 0x21, 0x1d, 0x01, 0x01, 0x0a, restore ? 0 : 1, 0xf7]];
    if (preset === 'launchpad') {
      const model = p.model === 'lpmini3' ? 0x0d : p.model === 'lppro3' ? 0x0e : 0x0c;
      return [[0xf0, 0x00, 0x20, 0x29, 0x02, model, 0x0e, restore ? 0 : 1, 0xf7]];
    }
    if (preset === 'apc40mk2') return [
      [0xf0, 0x47, 0x7f, 0x29, 0x60, 0x00, 0x04, restore ? 0x40 : 0x42, 4, 0, 0, 0xf7],
      // Track halkalarını tek nokta kipinde açık tut (CC 0x38..0x3f).
      ...(!restore ? range(8, (i) => [0xb0, 0x38 + i, 1]) : []),
    ];
    // Korg sahnesi yazılmaz; CC/kanal ve External LED ayarı Kontrol Editor'da yapılır.
    return [];
  }

  /* Yalnız belgelenmiş LED'ler: motoru olmayan faderlar, Korg düğümleri ve
     APC Stop All için sahte geri bildirim üretmeyiz. Renkler palet indeksidir. */
  function feedbackMap(map) {
    if (!map || map.relative) return null;
    if (!map.preset) return map;
    const t = byId(map.preset);
    if (!t || !t.mappings.some((m) => srcKey(m) === srcKey(map))) return null;
    const out = Object.assign({}, map);
    if (t.id === 'nanokontrol2') {
      if (!((map.cc >= 32 && map.cc <= 39) || map.cc === 41 || map.cc === 42)) return null;
      out.feedback = { on: 127, off: 0 };
    } else if (t.id === 'apc40mk2') {
      if (map.kind === 'cc') return map.cc >= 48 && map.cc <= 55 ? out : null;
      if (map.cc === 81) return null;
      out.feedback = { on: map.cc === 91 ? 127 : 5, off: 0 };
    } else if (t.id === 'launchpad') out.feedback = { on: 5, off: 0 };
    else if (t.id === 'push2') out.feedback = { on: map.kind === 'note' ? 126 : 127, off: 0 };
    return out;
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
      if (o.deviceId) m.deviceId = o.deviceId;
      list.push(m);
      have.add(srcKey(m));
      added++;
    }
    return { added, skipped };
  }

  const api = { TEMPLATES, byId, matchDevice, toMappings, apply, portInfo, acceptsPort, paired, modeMessages, feedbackMap };
  if (typeof window !== 'undefined') window.SVControllerMaps = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})();
