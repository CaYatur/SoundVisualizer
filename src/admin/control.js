/*
 * SoundVisualizer — CaYaDev Ses Görselleştirici
 * Copyright (c) 2026 Çağan Turgut (CaYatur) — CaYaDev, https://cayadev.com
 * https://github.com/CaYatur/SoundVisualizer
 * SPDX-License-Identifier: MIT
 */
'use strict';
/* Harici kontrol yüzeyleri: MIDI ve OSC.

   İkisi de aynı eşleme motorunu kullanır — "şu kaynaktan gelen şu sinyal, şu
   ayarı şu aralıkta sürsün". Eşlemenin uygulanması burada, yönetici panelinde
   yapılır; çünkü yapılandırmanın tek sahibi bu paneldir. OSC paketleri ana
   süreçte alınıp buraya iletilir, MIDI ise doğrudan Web MIDI ile okunur.

   "Öğren": bir eşlemeye basılıp denetleyici oynatıldığında gelen ilk sinyal
   o eşlemeye yazılır. Kanal/CC numarasını elle girmek zorunda kalmazsınız. */
(function () {
  const P = () => window.SVPanel;

  let midiAccess = null;
  let midiInputs = [];
  let midiError = '';
  let learning = null; // { surface, id }
  let lastSignal = { midi: '', osc: '', gamepad: '', artnet: '' };
  let oscState = { running: false, port: 0, error: null, lastAddress: '' };
  let oscOutState = { running: false, host: '', port: 0, packets: 0, error: null };
  let started = false;

  /* Sürülebilir hedefler: kaydırıcılar şemadan (#905), eylemler burada. */
  const Schema = (typeof window !== 'undefined' && window.SVSchema) || require('../shared/schema.js');
  const TARGETS = Schema.SLIDERS.concat([
    { action: 'nextVisualizer', label: 'Eylem · Sonraki Görselleştirici' },
    { action: 'prevVisualizer', label: 'Eylem · Önceki Görselleştirici' },
    { action: 'nextBackground', label: 'Eylem · Sonraki Arkaplan' },
    { action: 'nextScene', label: 'Eylem · Sonraki Sahne' },
    { action: 'nextPalette', label: 'Eylem · Sonraki Renk Şablonu' },
    { action: 'blackout', label: 'Eylem · Karart (aç/kapa)' },
    { action: 'tlPlay', label: 'Çizelge · Oynat' },
    { action: 'tlPause', label: 'Çizelge · Duraklat' },
    { action: 'tlStop', label: 'Çizelge · Durdur ve Başa Dön' },
    { action: 'tlNextMarker', label: 'Çizelge · Sonraki İşaret' },
    { action: 'tlPrevMarker', label: 'Çizelge · Önceki İşaret' },
    { action: 'deckStopAll', label: 'Deste · Hepsini Durdur' },
    /* Yedeklilik (#546): yetkiyi ağ ayarına dokunmadan al/bırak. Yalnız
       yedek makinede bir şey yapar. */
    { action: 'redTakeover', label: 'Yedeklilik · Yetkiyi Al' },
    { action: 'redRelease', label: 'Yedeklilik · Yetkiyi Bırak' },
    /* MilkDrop eylemleri panelin kendi düğmeleriyle AYNI yoldan gidiyor
       (milkdrop-panel.js `act`): geçmiş, puan ağırlığı ve kilit
       denetleyiciden de aynı çalışsın. */
    { action: 'mdNext', label: 'MilkDrop · Sonraki Preset' },
    { action: 'mdPrev', label: 'MilkDrop · Önceki Preset' },
    { action: 'mdRandom', label: 'MilkDrop · Rastgele Preset' },
    { action: 'mdCut', label: 'MilkDrop · Şimdi Kes (geçişsiz)' },
    { action: 'mdLock', label: 'MilkDrop · Kilit (aç/kapa)' },
    { action: 'mdRateUp', label: 'MilkDrop · Puanı Artır' },
    { action: 'mdRateDown', label: 'MilkDrop · Puanı Azalt' },
    // Ekrandaki preset favorilere girer ya da çıkar (#576)
    { action: 'mdFavorite', label: 'MilkDrop · Favori (aç/kapa)' },
    /* Sprite'lar (#577): başlatma hedefleri ini'deki her sprite için canlı
       ekleniyor (milkdrop-panel.js `spriteTargets`); silme üçü sabit. */
    { action: 'mdSpriteNewest', label: 'MilkDrop · Sprite: En Yeniyi Sil' },
    { action: 'mdSpriteOldest', label: 'MilkDrop · Sprite: En Eskiyi Sil' },
    { action: 'mdSpriteAll', label: 'MilkDrop · Sprite: Hepsini Sil' },
  ]);

  /* Kısayol döngüsü katalogdan: elle tutulan liste on beşten fazla modu
     atlıyordu (#638). */
  const MC = () => window.SVModeCatalog || require('../shared/mode-catalog.js');
  const VIS_CYCLE = MC().cycleIds('visualizer');
  const BG_CYCLE = MC().cycleIds('background');

  let blackoutSaved = null;

  /* Deste yuvaları hedef listesine CANLI eklenir: ızgara büyüyebilir,
     yuvalar adlandırılabilir. Sabit bir liste tutmak, 6x6 ızgarayı 36
     ölü satırla doldurur ve kullanıcı ızgarayı büyütünce eskirdi.
     Yalnızca DOLU yuvalar listelenir; boş hücreyi eşlemek anlamsız. */
  /* Deste etiketleri kullanıcının verdiği adlarla BİRLEŞTİRİLİYOR. Çeviri
     tam dize eşleşmesiyle çalıştığı için "Yuva (1×1)" ya da "Satır Intro"
     gibi birleşimler sözlükte bulunamıyordu ve İngilizce arayüzde Türkçe
     kalıyorlardı. Sabit kelimeyi burada çevirip kullanıcının adına
     dokunmuyoruz. */
  const T = (s) => (window.SVI18n && window.SVI18n.t ? window.SVI18n.t(s) : s);

  function deckTargets() {
    const out = [];
    const cfg = P() && P().cfg();
    const cd = cfg && cfg.clipdeck;
    if (!cd || !cd.enabled || !window.SVClipDeck) return out;
    const list = Array.isArray(cd.decks) ? cd.decks : [];
    for (const spec of list) {
      const deck = window.SVClipDeck.makeDeck(spec);
      const named = new Set();
      for (const slot of window.SVClipDeck.slotList(deck)) {
        out.push({
          action: 'deckSlot:' + deck.id + ':' + slot.row + ':' + slot.col,
          label: 'Deste · ' + (slot.name || slot.ref || T('Yuva')) + ' (' + (slot.row + 1) + '×' + (slot.col + 1) + ')',
        });
        if (!named.has(slot.row)) {
          named.add(slot.row);
          out.push({
            action: 'deckRow:' + deck.id + ':' + slot.row,
            label: 'Deste · ' + T('Satır') + ' ' + (deck.rowNames[slot.row] || slot.row + 1),
          });
        }
      }
    }
    return out;
  }

  function spriteTargets() {
    const mp = window.SVMilkdropPanel;
    return mp && mp.spriteTargets ? mp.spriteTargets() : [];
  }

  function allTargets() {
    return TARGETS.concat(deckTargets(), spriteTargets());
  }

  function targetFor(key) {
    return allTargets().find((t) => (t.path || 'action:' + t.action) === key) || null;
  }

  // --------------------------------------------------------------------------
  // Eşlemenin uygulanması
  // --------------------------------------------------------------------------
  function applyMapping(map, value01) {
    const editor = window.SVTimelineTarget;
    return editor ? editor.withManual(() => applyMappingManual(map, value01)) : applyMappingManual(map, value01);
  }
  function applyMappingManual(map, value01) {
    const cfg = P().cfg();
    const t = targetFor(map.target);
    if (!t) return;

    if (t.action) {
      // Eylemler yalnızca sinyal yükselirken tetiklenir (fader sürüklerken değil)
      if (value01 < 0.5) return;
      if (map._armed === false) return;
      map._armed = false;
      if (runAction(t.action, cfg) !== true) {
        P().push(true);
        P().rerender();
      }
      return;
    }

    /* Yığın açıkken değer ilk canlı katmana da yazılır; yalnız genel yola
       yazılınca katmanın kopyası onu eziyordu (layers.js effectivePath).
       Genel yol da yazılır: değer göstergesi ve klasik kip onu okuyor. */
    const v = mappedValue(t, map, value01);
    P().set(t.path, v);
    const L = window.SVLayers;
    const eff = L && L.effectivePath ? L.effectivePath(cfg, t.path) : t.path;
    if (eff !== t.path) P().set(eff, v);
    P().push(false);
    refreshValueChips();
  }

  /* Denetleyici değerinin (0..1) hedefteki karşılığı. Kovalı hedefte yol
     eşit kovalara bölünüyor ve kovanın değeri yazılıyor; min/max orada
     anlamsız, arayüz de onları göstermiyor. */
  function mappedValue(t, map, value01) {
    const u = Math.max(0, Math.min(1, Number(value01) || 0));
    if (Array.isArray(t.steps) && t.steps.length) {
      const n = t.steps.length;
      return t.steps[Math.min(n - 1, Math.floor(u * n))];
    }
    const lo = map && map.min != null ? map.min : t.min;
    const hi = map && map.max != null ? map.max : t.max;
    let v = lo + (hi - lo) * u;
    if (t.int) v = Math.round(v);
    return v;
  }

  /* Yığın açıkken ekranı katmanlar çiziyor ve klasik `visualizer.type`
     bilerek 'none'. Eylemler eskiden yalnız klasik alanı okuyup yazıyordu:
     yığında ekran hiç değişmiyordu, sıra da listenin başından başlıyordu.
     Tür artık ekranda görünen katmandan okunup ona yazılıyor (layers.js
     currentType / adoptVisualizer / adoptBackground). */
  function stackLive(cfg) {
    const L = window.SVLayers;
    return !!(L && L.currentType && cfg);
  }

  /* Dönüş true: eylem sahneyi kendisi uyguladı ve gönderdi; çağıran yeniden
     göndermez (göndermek etkin sahne işaretini silerdi). */
  function runAction(action, cfg) {
    const editor = window.SVTimelineTarget;
    return editor && P() && P().cfg() === cfg ? editor.withManual(() => runActionManual(action, P().cfg())) : runActionManual(action, cfg);
  }
  function runActionManual(action, cfg) {
    if (action === 'nextVisualizer' || action === 'prevVisualizer') {
      const stack = stackLive(cfg);
      const cur = stack ? window.SVLayers.currentType(cfg, 'visualizer') : cfg.visualizer.type;
      const i = VIS_CYCLE.indexOf(cur);
      const d = action === 'nextVisualizer' ? 1 : -1;
      const next = VIS_CYCLE[(i + d + VIS_CYCLE.length) % VIS_CYCLE.length];
      if (stack) window.SVLayers.adoptVisualizer(cfg, { type: next });
      else cfg.visualizer.type = next;
    } else if (action === 'nextBackground') {
      const stack = stackLive(cfg);
      const cur = stack ? window.SVLayers.currentType(cfg, 'background') : cfg.background.type;
      const i = BG_CYCLE.indexOf(cur);
      const next = BG_CYCLE[(i + 1) % BG_CYCLE.length];
      if (stack) window.SVLayers.adoptBackground(cfg, { type: next });
      else cfg.background.type = next;
    } else if (action === 'nextScene') {
      const list = cfg.scenes || [];
      if (!list.length) return false;
      const idx = (runAction._scene = ((runAction._scene || 0) + 1) % list.length);
      /* Panelin sahne düğmesiyle AYNI uygulama: Şeffaf Arkaplan ve
         karartma korunur. Eskiden alanlar burada ayrıca kopyalanıyordu ve
         sahne şeffaflık kapalıyken kaydedildiyse yayındaki şeffaf pencere
         opak yeniden kuruluyordu. */
      if (P() && P().applyScene && list[idx].id) {
        P().applyScene(list[idx].id);
        return true;
      }
      const data = list[idx].data || {};
      const bg = cfg.background || {};
      const keep = { transparent: !!bg.transparent, transparentKey: bg.transparentKey, coverTaskbar: bg.coverTaskbar };
      const SCENE_KEYS = Schema.SCENE_KEYS;
      for (const key of SCENE_KEYS) {
        if (data[key] !== undefined) cfg[key] = JSON.parse(JSON.stringify(data[key]));
      }
      if (cfg.background) {
        cfg.background.transparent = keep.transparent;
        if (keep.transparentKey != null) cfg.background.transparentKey = keep.transparentKey;
        if (keep.coverTaskbar != null) cfg.background.coverTaskbar = !!keep.coverTaskbar;
      }
    } else if (action === 'nextPalette') {
      const list = (window.SV.GRADIENT_PRESETS || []).concat(cfg.userPresets || []);
      if (!list.length) return;
      const idx = (runAction._pal = ((runAction._pal || 0) + 1) % list.length);
      cfg.background.gradient.colors = list[idx].colors.slice();
    } else if (action === 'blackout') {
      if (P().toggleBlackout) {
        P().toggleBlackout();
      }
    } else if (action === 'redTakeover' || action === 'redRelease') {
      const api = typeof window !== 'undefined' ? window.api : null;
      const fn = api && (action === 'redTakeover' ? api.redundancyTakeover : api.redundancyRelease);
      if (fn) fn().catch(() => {});
      return true; // yapılandırma değişmedi
    } else if (action.indexOf('tl') === 0) {
      runTimeline(action);
    } else if (action.indexOf('deck') === 0) {
      runDeck(action, cfg);
    } else if (action.indexOf('md') === 0) {
      const mp = window.SVMilkdropPanel;
      if (mp && mp.act) mp.act(action.slice(2));
    }
  }

  /* Taşıma eylemleri panelin KENDİ taşımasını sürer; ayrı bir saat
     kurmak iki yüzeyi ayrıştırırdı. */
  function runTimeline(action) {
    const tp = window.SVTimelinePanel;
    if (!tp || !tp.transport) return;
    const tr = tp.transport();
    if (action === 'tlPlay') tp.play();
    else if (action === 'tlPause') tp.pause();
    else if (action === 'tlStop') tp.stop();
    else if (action === 'tlNextMarker') {
      const m = window.SVTimeline.markerAfter(tr.tl, tr.time);
      if (m) tp.seek(m.t);
    } else if (action === 'tlPrevMarker') {
      const m = window.SVTimeline.markerBefore(tr.tl, tr.time);
      tp.seek(m ? m.t : 0);
    }
  }

  function runDeck(action, cfg) {
    const dp = window.SVClipDeckPanel;
    if (!dp || !dp.engine || !cfg.clipdeck || !cfg.clipdeck.enabled) return;
    const e = dp.engine();
    const tp = window.SVTimelinePanel;
    const now = tp && tp.transport ? tp.transport().time : 0;
    const tempo = tp && tp.transport ? tp.transport().tl.tempo : window.SVTimeline.makeTempoMap([{ t: 0, bpm: 120 }]);
    if (action === 'deckStopAll') { e.stopAll(); return; }
    const parts = action.split(':');
    if (parts[0] === 'deckSlot' && parts.length === 4) {
      e.launch(parts[1], Number(parts[2]), Number(parts[3]), now, tempo);
    } else if (parts[0] === 'deckRow' && parts.length === 3) {
      e.launchRow(parts[1], Number(parts[2]), now, tempo);
    }
    if (tp) tp.start();
  }

  function refreshValueChips() {
    document.querySelectorAll('[data-map-value]').forEach((n) => {
      const t = targetFor(n.dataset.mapValue);
      if (!t || t.action) return;
      const v = P().get(t.path);
      n.textContent = typeof v === 'number'
        ? (t.int ? String(Math.round(v)) : t.steps ? String(v) : v.toFixed(2)) : '—';
    });
  }

  // --------------------------------------------------------------------------
  // MIDI
  // --------------------------------------------------------------------------
  function onMidi(ev) {
    const d = ev.data;
    if (!d || d.length < 3) return;
    const status = d[0] & 0xf0;
    const channel = (d[0] & 0x0f) + 1;
    const isCC = status === 0xb0;
    const isNote = status === 0x90 || status === 0x80;
    if (!isCC && !isNote) return;

    const num = d[1];
    const raw = d[2];
    const value01 = isNote ? (status === 0x90 && raw > 0 ? 1 : 0) : raw / 127;
    const sig = (isCC ? 'CC' : 'Nota') + ' ' + num + ' · kanal ' + channel;
    lastSignal.midi = sig + ' → ' + raw;
    const chip = document.getElementById('midiSignal');
    if (chip) chip.textContent = lastSignal.midi;

    const cfg = P().cfg();
    if (learning && learning.surface === 'midi') {
      const m = (cfg.control.midi.mappings || []).find((x) => x.id === learning.id);
      if (m) {
        m.channel = channel;
        m.cc = num;
        m.kind = isCC ? 'cc' : 'note';
        learning = null;
        P().push(true);
        P().rerender();
      }
      return;
    }

    if (!cfg.control.midi.enabled) return;
    for (const m of cfg.control.midi.mappings || []) {
      if (m.cc !== num) continue;
      if (m.channel && m.channel !== channel) continue;
      if ((m.kind === 'note') !== isNote) continue;
      if (value01 < 0.5) m._armed = true; // eylem yeniden tetiklenebilir hale gelsin
      applyMapping(m, value01);
    }
  }

  function bindMidiInputs() {
    if (!midiAccess) return;
    midiInputs = Array.from(midiAccess.inputs.values());
    const cfg = P().cfg();
    const want = cfg.control.midi.deviceId || 'all';
    const ts = cfg.tempoSync || {};
    const clockWant = ts.source === 'midi' ? ts.midiDevice || 'all' : null;
    const mt = cfg.control.mtc || {};
    const mtcWant = mt.enabled ? mt.deviceId || 'all' : null;
    for (const input of midiInputs) {
      const map = !!cfg.control.midi.enabled && (want === 'all' || want === input.id);
      const clk = clockWant != null && (clockWant === 'all' || clockWant === input.id);
      const tc = mtcWant != null && (mtcWant === 'all' || mtcWant === input.id);
      input.onmidimessage = map || clk || tc
        ? (ev) => { if (tc) onMtc(ev); if (clk) onMidiClock(ev); if (map || learning) onMidi(ev); }
        : null;
    }
  }

  // --------------------------------------------------------------------------
  // Dış tempo: MIDI saati (burada) ve Ableton Link (ana süreç dinler)
  // --------------------------------------------------------------------------
  const MCK = () => window.SVMidiClock || require('../shared/midi-clock.js');
  let midiClock = null;
  let tempoState = { source: 'off', bpm: 0, peers: 0 };
  let tempoApplyAt = 0;
  function onMidiClock(ev) {
    const d = ev.data;
    if (!d || !d.length || d[0] < 0xf8) return;
    if (!midiClock) midiClock = MCK().create();
    const now = ev.timeStamp || performance.now();
    if (!midiClock.message(d[0], now) || d[0] !== 0xf8) return;
    // Darbe başına değil, en çok 4 kez/sn uygula
    if (now - tempoApplyAt < 250) return;
    tempoApplyAt = now;
    applyExternalTempo(midiClock.bpm(now), 'midi');
  }
  function applyExternalTempo(bpm, source) {
    tempoState = Object.assign({}, tempoState, { source, bpm });
    const chip = document.getElementById('tempoSyncState');
    if (chip) chip.textContent = tempoLabel();
    const cfg = P().cfg();
    const ts = cfg.tempoSync || {};
    if (ts.source !== source || !(bpm > 0)) return;
    const cur = cfg.modulation && cfg.modulation.bpm;
    if (!MCK().shouldApply(cur, bpm, 0.1)) return;
    P().set('modulation.bpm', bpm);
    P().push(false);
  }
  function tempoLabel() {
    const s = tempoState;
    if (!s.bpm) return T(s.source === 'link' ? 'Link eşi bekleniyor…' : 'Saat bekleniyor…');
    return s.bpm.toFixed(1) + ' BPM' + (s.source === 'link' ? ' · ' + s.peers + ' ' + T('eş') : '');
  }

  function tempoNodes(cfg) {
    const el = P().el;
    const ts = cfg.tempoSync || (cfg.tempoSync = { source: 'off', midiDevice: 'all' });
    const nodes = [];
    const sel = el('select', {
      onchange: async (e) => {
        MCK().switchSource(ts, cfg.modulation, e.target.value);
        tempoState = { source: ts.source, bpm: 0, peers: 0 };
        if (midiClock) midiClock.reset();
        P().push(true);
        if (ts.source === 'midi') { if (!midiAccess) await initMidi(); else bindMidiInputs(); }
        else bindMidiInputs();
        P().rerender();
      },
    });
    [['off', 'Kapalı (ses analizi)'], ['link', 'Ableton Link'], ['midi', 'MIDI Saati']].forEach(([v, t]) => {
      const o = el('option', { value: v, text: T(t) });
      if ((ts.source || 'off') === v) o.selected = true;
      sel.appendChild(o);
    });
    nodes.push(P().row(T('Tempo Kaynağı'), sel));
    if (ts.source === 'midi') {
      const dev = el('select', { onchange: (e) => { ts.midiDevice = e.target.value; P().push(true); bindMidiInputs(); } });
      const all = el('option', { value: 'all', text: T('Tüm MIDI aygıtları') });
      if ((ts.midiDevice || 'all') === 'all') all.selected = true;
      dev.appendChild(all);
      midiInputs.forEach((inp) => {
        const o = el('option', { value: inp.id, text: inp.name || 'MIDI' });
        if (ts.midiDevice === inp.id) o.selected = true;
        dev.appendChild(o);
      });
      nodes.push(P().row(T('Saat Aygıtı'), dev));
      if (midiError) nodes.push(el('div', { class: 'studio-status err', text: midiError }));
    }
    if (ts.source && ts.source !== 'off') {
      nodes.push(el('div', { class: 'ctrl' }, [el('div', { class: 'row' }, [
        el('label', { class: 'lbl', text: T('Gelen Tempo') }),
        el('span', { id: 'tempoSyncState', class: 'map-signal', text: tempoLabel() }),
      ])]));
    }
    nodes.push(el('div', { class: 'note', text: T(ts.source === 'link'
      ? 'Link oturumu yalnızca dinlenir: ağdaki Ableton Live, Traktor ya da Rekordbox temposu modülasyon saatine yazılır; uygulama tempo yayınlamaz. Tüm sistemlerde çalışır; güvenlik duvarı UDP 20808 çok noktaya yayını engellememeli.'
      : 'Dış kaynak seçilince modülasyon saatinin BPM değeri ondan gelir. MIDI saati Web MIDI ile okunur (Windows, macOS ve Linux).') }));
    return nodes;
  }

  // --------------------------------------------------------------------------
  // Oyun kumandası (Gamepad API)
  // --------------------------------------------------------------------------
  const GPM = () => window.SVGamepadMap || require('../shared/gamepad-map.js');
  let padState = {};
  let padTimer = null;
  function padCount() {
    try { return Array.from(navigator.getGamepads ? navigator.getGamepads() : []).filter(Boolean).length; } catch { return 0; }
  }
  // Analog eşlemenin son yazılan değeri (0..1); ayara kaydedilmez
  const padVal = new Map();
  let padAt = 0;
  let padTick = 0;
  /* Hedefin şu anki değeri 0..1 olarak (göreli kip buradan devam eder). */
  function value01Of(t, map) {
    const v = P().get(t.path);
    if (Array.isArray(t.steps) && t.steps.length) {
      const i = t.steps.indexOf(v);
      return i < 0 ? 0 : (i + 0.5) / t.steps.length;
    }
    const lo = map && map.min != null ? map.min : t.min;
    const hi = map && map.max != null ? map.max : t.max;
    if (typeof v !== 'number' || hi === lo) return 0;
    return Math.max(0, Math.min(1, (v - lo) / (hi - lo)));
  }
  /* Sürekli (analog) eşleme: eksen ya da analog tetik bir kaydırıcıyı sürer. Her okumada çalışır;
     göreli kip ve yumuşatma olay beklemeden ilerlesin diye. */
  function continuous(m) {
    if (!m || !(m.index >= 0)) return null;
    const t = targetFor(m.target);
    if (!t || t.action) return null;
    return t;
  }
  function driveAnalog(m, t, raw, dt) {
    const G = GPM();
    const o = G.opts(m);
    let want;
    if (o.mode === 'rel') {
      const base = padVal.has(m.id) ? padVal.get(m.id) : value01Of(t, m);
      want = G.relStep(m, base, m.kind === 'button' ? raw * 2 - 1 : raw, dt);
      // Göreli kipte yumuşatma yok: değer zaten adım adım ilerliyor
      if (want === padVal.get(m.id)) return;
      padVal.set(m.id, want);
    } else {
      const target = m.kind === 'button' ? Math.max(0, Math.min(1, raw)) : G.abs01(m, raw);
      const prev = padVal.has(m.id) ? padVal.get(m.id) : null;
      want = G.smoothTo(m, prev, target, dt);
      if (Math.abs(want - target) < 0.0005) want = target;
      if (prev != null && Math.abs(want - prev) < 0.0005) return;
      padVal.set(m.id, want);
    }
    applyMapping(m, want);
  }
  function paintAxes(state) {
    const host = document.getElementById('gamepadAxes');
    if (!host) return false;
    const keys = Object.keys(state).filter((k) => k.includes(':a:') || (state[k] > 0 && state[k] < 1));
    const sig = keys.join(',');
    if (host.dataset.sig !== sig) {
      host.dataset.sig = sig;
      host.replaceChildren(...keys.map((k) => {
        const [p, kind, i] = k.split(':');
        const en = !!(window.SVI18n && window.SVI18n.locale === 'en');
        const name = (kind === 'a' ? (en ? 'Axis ' : 'Eksen ') : (en ? 'Button ' : 'Düğme ')) + i + ' · #' + (Number(p) + 1);
        return P().el('div', { class: 'gp-axis', 'data-k': k }, [P().el('span', { class: 'gp-n', text: name }), P().el('span', { class: 'gp-bar' }, [P().el('i')]), P().el('span', { class: 'gp-v sv-mono' })]);
      }));
    }
    for (const row of host.children) {
      const v = Number(state[row.dataset.k]) || 0;
      const bipolar = row.dataset.k.includes(':a:');
      const bar = row.querySelector('i');
      bar.style.left = bipolar ? (Math.min(0, v) * 50 + 50) + '%' : '0%';
      bar.style.width = (bipolar ? Math.abs(v) * 50 : v * 100) + '%';
      row.querySelector('.gp-v').textContent = (v >= 0 ? '+' : '') + v.toFixed(2);
    }
    return true;
  }
  function pollGamepads() {
    if (!navigator.getGamepads) return;
    const cfg = P().cfg();
    const g = cfg.control.gamepad || {};
    const now = (typeof performance !== 'undefined' ? performance.now() : Date.now());
    const dt = padAt ? Math.min(100, now - padAt) : 16;
    padAt = now;
    // Ölü bölgeyi eşleme uygular; burada yalnız çok küçük titreme yutulur
    const r = GPM().diff(padState, navigator.getGamepads(), 0.02);
    padState = r.state;
    const shown = (padTick++ % 3 === 0) ? paintAxes(r.state) : !!document.getElementById('gamepadAxes');
    if (r.events.length) {
      const e0 = r.events[r.events.length - 1];
      lastSignal.gamepad = GPM().label(e0, !!(window.SVI18n && window.SVI18n.locale === 'en')) + ' → ' + (Math.round(e0.raw * 100) / 100);
      const chip = document.getElementById('gamepadSignal');
      if (chip) chip.textContent = lastSignal.gamepad;
    }
    if (learning && learning.surface === 'gamepad') {
      const got = GPM().learnFrom(r.events);
      const m = got && (g.mappings || []).find((x) => x.id === learning.id);
      if (m) {
        Object.assign(m, got);
        // Öğrenilen yön: çubuğun tek yönü ya da tetik yalnız o yarıyı kullansın diye ipucu
        if (got.kind === 'axis' && m.range == null) m.range = 'full';
        padVal.delete(m.id);
        learning = null; syncGamepad(); P().push(true); P().rerender();
      }
      return;
    }
    if (!g.enabled) { if (!shown) syncGamepad(); return; }
    const analog = new Set();
    for (const m of g.mappings || []) {
      const t = continuous(m);
      if (!t) continue;
      analog.add(m);
      const raw = GPM().rawOf(m, r.state);
      if (raw == null) continue;
      /* Mutlak kip kumanda dokunulmadan ayarı ezmesin: ilk hareketten sonra sürer.
         Göreli kip zaten ortada sıfır adım atar. */
      if (GPM().opts(m).mode === 'abs' && !padVal.has(m.id) && !r.events.some((ev) => GPM().matches(m, ev))) continue;
      driveAnalog(m, t, raw, dt);
    }
    for (const ev of r.events) {
      for (const m of g.mappings || []) {
        if (analog.has(m) || !GPM().matches(m, ev)) continue;
        // Eksen → eylem: biçimlenmiş değer eşiği geçince bir kez
        const v = ev.kind === 'axis' ? GPM().abs01(Object.assign({}, m, { range: m.range || 'pos' }), ev.raw) : ev.value01;
        if (v < 0.5) m._armed = true;
        applyMapping(m, v);
      }
    }
  }
  function syncGamepad() {
    const cfg = P().cfg();
    const on = !!(cfg.control.gamepad && cfg.control.gamepad.enabled) || (learning && learning.surface === 'gamepad') || !!document.getElementById('gamepadAxes');
    if (on && !padTimer) { padAt = 0; padTimer = setInterval(pollGamepads, 16); }
    else if (!on && padTimer) { clearInterval(padTimer); padTimer = null; }
  }

  async function initMidi() {
    if (!navigator.requestMIDIAccess) {
      midiError = 'Bu ortamda Web MIDI kullanılamıyor.';
      return;
    }
    try {
      midiAccess = await navigator.requestMIDIAccess({ sysex: false });
      midiAccess.onstatechange = () => { bindMidiInputs(); P().rerender(); };
      bindMidiInputs();
    } catch (e) {
      midiError = 'MIDI erişimi reddedildi: ' + (e && e.message ? e.message : e);
    }
  }

  // --------------------------------------------------------------------------
  // MIDI Time Code girişi: Zaman Çizelgesi dış zaman kodunu kovalar
  // --------------------------------------------------------------------------
  const MTCM = () => window.SVMtc || require('../shared/mtc.js');
  let mtcDecoder = null;
  let mtcTimer = null;
  function onMtc(ev) {
    const d = ev.data;
    if (!d || !d.length || (d[0] !== 0xf1 && d[0] !== 0xf0)) return;
    if (!mtcDecoder) mtcDecoder = MTCM().createDecoder();
    mtcDecoder.feed(d, performance.now());
  }
  function mtcTick() {
    const cfg = P() && P().cfg();
    const m = cfg && cfg.control && cfg.control.mtc;
    const chip = document.getElementById('mtcSignal');
    if (chip && mtcDecoder) chip.textContent = mtcDecoder.label() + (mtcDecoder.running(performance.now()) ? '' : ' · ' + T('durdu'));
    if (!m || !m.enabled || !mtcDecoder || mtcDecoder.time() == null) return;
    const tp = window.SVTimelinePanel;
    if (!tp || !tp.transport) return;
    const tr = tp.transport();
    const step = MTCM().chaseStep(
      { time: mtcDecoder.time(), running: mtcDecoder.running(performance.now()) },
      { time: tr.time, playing: !!tr.playing },
      { offset: Number(m.offsetSec) || 0 }
    );
    if (step.pause) tp.pause();
    if (step.seek != null) tp.seek(step.seek);
    if (step.play) tp.play();
  }
  function syncMtc() {
    const cfg = P() && P().cfg();
    const on = !!(cfg && cfg.control && cfg.control.mtc && cfg.control.mtc.enabled);
    if (on && !mtcTimer) mtcTimer = setInterval(mtcTick, 40);
    else if (!on && mtcTimer) { clearInterval(mtcTimer); mtcTimer = null; if (mtcDecoder) mtcDecoder.reset(); }
  }

  // --------------------------------------------------------------------------
  // Art-Net (DMX) girişi: ana süreç yalnız değişen kanalları iletir
  // --------------------------------------------------------------------------
  let artnetInState = { listening: false, error: '', packets: 0 };
  function onArtnetIn(msg) {
    const cfg = P() && P().cfg();
    const a = cfg && cfg.control && cfg.control.artnet;
    if (!a || !msg || !Array.isArray(msg.changes) || !msg.changes.length) return;
    const lastCh = msg.changes[msg.changes.length - 1];
    lastSignal.artnet = 'DMX ' + lastCh[0] + ' → ' + lastCh[1];
    const chip = document.getElementById('artnetInSignal');
    if (chip) chip.textContent = lastSignal.artnet;
    if (learning && learning.surface === 'artnet') {
      // Öğrenme: en çok oynayan kanal (aynı anda birkaç kanal değişebilir)
      const m = (a.mappings || []).find((x) => x.id === learning.id);
      const pick = msg.changes.slice().sort((x, y) => y[1] - x[1])[0];
      if (m && pick) {
        m.channel = pick[0];
        learning = null;
        P().push(true);
        P().rerender();
      }
      return;
    }
    if (!a.enabled) return;
    for (const [ch, v] of msg.changes) {
      for (const m of a.mappings || []) {
        if ((m.channel | 0) !== ch) continue;
        const value01 = Math.max(0, Math.min(1, v / 255));
        if (value01 < 0.5) m._armed = true; // eylem yeniden tetiklenebilir
        applyMapping(m, value01);
      }
    }
  }

  function artnetInNodes(cfg) {
    const el = P().el;
    const a = cfg.control.artnet || (cfg.control.artnet = { enabled: false, bind: '127.0.0.1', port: 6454, universe: 0, mappings: [] });
    const sync = async () => {
      P().push(true);
      if (window.api.artnetInSync) artnetInState = (await window.api.artnetInSync()) || artnetInState;
      P().rerender();
    };
    const st = artnetInState;
    const status = el('div', { class: 'studio-status ' + (st.listening ? 'ok' : st.error ? 'err' : '') });
    if (st.listening) {
      status.appendChild(el('span', { text: 'Dinliyor' }));
      status.appendChild(el('span', { class: 'st-sep', 'aria-hidden': 'true', text: ' · ' }));
      status.appendChild(el('span', { class: 'st-num', text: String(st.packets || 0) + ' ' }));
      status.appendChild(el('span', { text: 'paket' }));
    } else if (st.error === 'same-universe') {
      status.appendChild(el('span', { text: 'Art-Net çıkışıyla aynı evren: kapalı' }));
    } else if (st.error) {
      status.appendChild(el('span', { text: st.error }));
    } else {
      status.appendChild(el('span', { text: 'Kapalı' }));
    }
    const nodes = [P().moduleHead({
      id: 'artnetIn', title: 'Art-Net Girişi', on: !!a.enabled, error: !!st.error, status,
      start: 'Dinlemeyi Başlat', stop: 'Dinlemeyi Durdur',
      toggle: async (next) => { a.enabled = next; await sync(); },
    })];
    const bindSel = el('select', {
      'aria-label': T('Dinleme Adresi'),
      onchange: async (e) => { a.bind = e.target.value; await sync(); },
    });
    [['127.0.0.1', 'Yalnız bu bilgisayar (127.0.0.1)'], ['0.0.0.0', 'Tüm ağ arayüzleri (0.0.0.0)']].forEach(([v, t]) => {
      const o = el('option', { value: v, text: T(t) });
      if ((a.bind || '127.0.0.1') === v) o.selected = true;
      bindSel.appendChild(o);
    });
    nodes.push(P().row('Dinleme Adresi', bindSel));
    nodes.push(P().row('Evren (Universe)', el('input', {
      class: 'p-in p-num', type: 'number', min: '0', max: '32767', value: a.universe | 0,
      onchange: async (e) => {
        const n = Math.max(0, Math.min(32767, parseInt(e.target.value, 10) || 0));
        a.universe = n;
        await sync();
      },
    })));
    nodes.push(el('div', { class: 'ctrl' }, [el('div', { class: 'row' }, [
      el('label', { class: 'lbl', text: 'Son kanal' }),
      el('span', { id: 'artnetInSignal', class: 'map-signal', text: lastSignal.artnet || T('sinyal bekleniyor…') }),
    ])]));
    nodes.push(mappingRows('artnet'));
    nodes.push(el('div', { class: 'note', text: 'Işık masasının gönderdiği DMX kanallarını ayarlara ve eylemlere bağlar (0–255 → hedef aralığı; eylemler yarının üstüne çıkınca tetiklenir). Varsayılan yalnız bu bilgisayarı dinler; ağdaki bir masa için Tüm ağ arayüzleri seçin. Art-Net çıkışıyla aynı evren seçilemez.' }));
    return nodes;
  }

  function mtcNodes(cfg) {
    const el = P().el;
    const m = cfg.control.mtc || (cfg.control.mtc = { enabled: false, deviceId: 'all', offsetSec: 0 });
    const nodes = [P().moduleHead({
      id: 'mtc', title: 'MIDI Zaman Kodu (MTC)', on: !!m.enabled,
      status: el('div', { class: 'studio-status', text: m.enabled ? 'Dinliyor' : 'Kapalı' }),
      start: 'Dinlemeyi Başlat', stop: 'Dinlemeyi Durdur',
      toggle: async (next) => {
        m.enabled = next;
        P().push(true);
        if (next && !midiAccess) await initMidi();
        bindMidiInputs();
        syncMtc();
        P().rerender();
      },
    })];
    const sel = el('select', { 'aria-label': T('Aygıt'), onchange: (e) => { m.deviceId = e.target.value; P().push(true); bindMidiInputs(); } });
    const optAll = el('option', { value: 'all', text: 'Tüm MIDI aygıtları' });
    if ((m.deviceId || 'all') === 'all') optAll.selected = true;
    sel.appendChild(optAll);
    midiInputs.forEach((inp) => {
      const o = el('option', { value: inp.id, text: inp.name || 'MIDI' });
      if (m.deviceId === inp.id) o.selected = true;
      sel.appendChild(o);
    });
    nodes.push(P().row('Aygıt', sel));
    nodes.push(P().row('Başlangıç Ofseti (sn)', el('input', {
      class: 'p-in p-num', type: 'number', step: '0.01', min: '0', max: '86400', value: Number(m.offsetSec) || 0,
      onchange: (e) => { const n = parseFloat(e.target.value); m.offsetSec = Number.isFinite(n) ? Math.max(0, Math.min(86400, n)) : 0; P().push(true); },
    })));
    nodes.push(el('div', { class: 'ctrl' }, [el('div', { class: 'row' }, [
      el('label', { class: 'lbl', text: 'Zaman Kodu' }),
      el('span', { id: 'mtcSignal', class: 'map-signal', text: mtcDecoder ? mtcDecoder.label() : '--:--:--:--' }),
    ])]));
    nodes.push(el('div', { class: 'note', text: 'DAW ya da şov denetleyicisi MTC gönderirken Zaman Çizelgesi aynı konumda oynar, durunca durur, atlayınca atlar. Çizelge zamanı = zaman kodu − ofset (ör. 01:00:00:00 başlayan bir şov için 3600). 24, 25, 29.97 drop-frame ve 30 fps desteklenir.' }));
    return nodes;
  }

  // --------------------------------------------------------------------------
  // OSC (ana süreçten iletilir)
  // --------------------------------------------------------------------------
  /* Sabit ağaç bu adresi tuttuysa öğrenilen eşleme onu bir daha sürmez.
     Tutmadıysa eski eşleme durur. */
  function applyLearned(cfg, msg) {
    const value = typeof msg.args[0] === 'number' ? msg.args[0] : msg.args[0] === true ? 1 : 0;
    const v01 = value > 1 ? value / 127 : value;
    for (const m of cfg.control.osc.mappings || []) {
      if (m.address !== msg.address) continue;
      if (v01 < 0.5) m._armed = true;
      applyMapping(m, v01);
    }
  }

  function sameName(a, b) {
    return String(a || '').trim().toLocaleLowerCase() === String(b || '').trim().toLocaleLowerCase();
  }

  function applyOscStep(cfg, step) {
    if (!step) return;
    if (step.kind === 'set') {
      P().set(step.path, step.value);
      const L = window.SVLayers;
      const eff = L && L.effectivePath ? L.effectivePath(cfg, step.path) : step.path;
      if (eff !== step.path) P().set(eff, step.value);
      return;
    }
    if (step.op === 'blackout') {
      const on = !!(window.SVShow && window.SVShow.blackout);
      if (on !== step.value && P().toggleBlackout) P().toggleBlackout({ quiet: true });
      return;
    }
    if (step.op === 'scene') {
      const sc = (cfg.scenes || []).find((s) => s && sameName(s.name, step.name));
      if (sc && sc.id && P().applyScene) P().applyScene(sc.id, { quiet: true });
      return;
    }
    if (step.op === 'visualizer' || step.op === 'background') {
      const stack = stackLive(cfg);
      const spec = { type: step.id };
      if (step.op === 'visualizer') {
        if (stack && window.SVLayers.adoptVisualizer) window.SVLayers.adoptVisualizer(cfg, spec);
        else cfg.visualizer.type = step.id;
      } else if (stack && window.SVLayers.adoptBackground) {
        window.SVLayers.adoptBackground(cfg, spec);
      } else {
        cfg.background.type = step.id;
      }
      return;
    }
    if (step.op === 'milkdrop') {
      const mp = window.SVMilkdropPanel;
      const named = mp && mp.presetByName ? mp.presetByName(step.name) : null;
      const list = mp && mp.visibleList ? mp.visibleList() : [];
      const hit = named || list.find((p) => p && sameName(p.name, step.name));
      if (!hit) return;
      // Listede metni yok (#906): metin gelince yüklenip kendi gönderiliyor
      if (hit.lazy && mp.go) mp.go(cfg, hit);
      else if (mp.load) mp.load(cfg, hit);
      return;
    }
    if (step.op === 'deck') {
      const dp = window.SVClipDeckPanel;
      if (dp && dp.press) dp.press(step.row, step.col);
      return;
    }
    if (step.op === 'deck-many') {
      const dp = window.SVClipDeckPanel;
      if (!dp || !dp.press) return;
      for (const cell of step.cells) dp.press(cell.row, cell.col);
      return;
    }
    if (step.op === 'deck-stop') {
      runAction('deckStopAll', cfg);
      return;
    }
    if (step.op === 'timeline') {
      const tp = window.SVTimelinePanel;
      if (!tp) return;
      if (step.mode === 'play' && tp.play) tp.play();
      else if (step.mode === 'pause' && tp.pause) tp.pause();
      else if (step.mode === 'stop' && tp.stop) tp.stop();
    }
  }

  function onOsc(msg) {
    const editor = window.SVTimelineTarget;
    return editor ? editor.withManual(() => onOscManual(msg)) : onOscManual(msg);
  }
  function onOscManual(msg) {
    const messages = msg && Array.isArray(msg.messages) ? msg.messages : [msg];
    const last = messages[messages.length - 1] || {};
    const args = Array.isArray(last.args) ? last.args : [];
    lastSignal.osc = (last.address || '') + (args.length ? ' ' + JSON.stringify(args[0]) : '');
    const chip = document.getElementById('oscSignal');
    if (chip) chip.textContent = lastSignal.osc;

    const cfg = P().cfg();
    if (learning && learning.surface === 'osc') {
      const m = (cfg.control.osc.mappings || []).find((x) => x.id === learning.id);
      const heard = messages.find((one) => one && one.address);
      if (m && heard) {
        m.address = heard.address;
        learning = null;
        P().push(true);
        P().rerender();
      }
      return;
    }

    if (!cfg.control.osc.enabled) return;
    const tree = window.SVOscTree;
    const planned = tree && tree.plan ? tree.plan(messages, cfg) : { steps: [], consumed: [] };
    const consumed = new Set(planned.consumed || []);
    const steps = planned.steps || [];
    /* Sahne vurgusu, sonraki adım görünümü değiştirirse son push'ta kalkar.
       Paketin kendisi tek gönderimdir: karartma ve sahne ara push yapmaz. */
    let holdScene = false;
    for (const step of steps) {
      if (holdScene && step && (step.kind === 'set' || (step.op && step.op !== 'scene'))) {
        if (P().releaseSceneAction) P().releaseSceneAction();
        holdScene = false;
      }
      applyOscStep(cfg, step);
      if (step && step.op === 'scene') holdScene = true;
    }
    for (let i = 0; i < messages.length; i++) {
      if (consumed.has(i) || !messages[i]) continue;
      applyLearned(cfg, messages[i]);
    }
    if (steps.length) {
      const structural = steps.some((s) => s && (s.op === 'blackout' || s.op === 'scene'));
      P().push(structural);
      if (holdScene && P().releaseSceneAction) P().releaseSceneAction();
      P().rerender();
      refreshValueChips();
    }
  }

  // --------------------------------------------------------------------------
  // Arayüz
  // --------------------------------------------------------------------------
  function newMapping(surface) {
    return {
      id: 'map_' + Date.now().toString(36) + Math.floor(Math.random() * 999).toString(36),
      kind: 'cc',
      channel: 0,
      cc: -1,
      address: '/cayadev/1',
      index: -1,
      pad: -1,
      target: TARGETS[0].path,
      min: null,
      max: null,
      _armed: true,
    };
  }

  function mappingRows(surface) {
    const el = P().el;
    const cfg = P().cfg();
    const list = cfg.control[surface].mappings || (cfg.control[surface].mappings = []);
    const host = el('div', { class: 'map-list' });

    if (!list.length) {
      host.appendChild(el('div', { class: 'studio-empty', text: 'Henüz eşleme yok. “Eşleme Ekle” ile başlayın.' }));
    }

    list.forEach((m, i) => {
      const t = targetFor(m.target);
      const isLearning = learning && learning.surface === surface && learning.id === m.id;

      const sourceLabel = surface === 'artnet' ? (m.channel > 0 ? 'DMX ' + m.channel : '—') :
        surface === 'gamepad' ? GPM().label(m, !!(window.SVI18n && window.SVI18n.locale === 'en')) :
        surface === 'midi'
          ? m.cc >= 0
            ? (m.kind === 'note' ? 'Nota ' : 'CC ') + m.cc + (m.channel ? ' · k' + m.channel : '')
            : '—'
          : m.address;

      const learnBtn = el('button', {
        class: 'btn small' + (isLearning ? ' primary' : ' ghost'),
        type: 'button',
        icon: isLearning ? 'record' : 'aim',
        text: isLearning ? 'Dinleniyor…' : 'Öğren',
        title: surface === 'osc' ? 'Bas, sonra OSC mesajını gönder' : 'Bas, sonra denetleyicideki düğmeyi oynat',
        onclick: () => {
          learning = isLearning ? null : { surface, id: m.id };
          if (surface === 'gamepad') syncGamepad();
          P().rerender();
        },
      });

      const srcNode = surface === 'artnet'
        ? el('input', {
            class: 'p-in p-num', type: 'number', min: '1', max: '512', value: m.channel > 0 ? m.channel : '', placeholder: 'DMX',
            'aria-label': T('DMX kanalı'),
            onchange: (e) => { const n = parseInt(e.target.value, 10); m.channel = n >= 1 && n <= 512 ? n : 0; P().push(true); },
          })
        : surface === 'osc'
        ? el('input', {
            class: 'p-in', type: 'text', value: m.address, placeholder: '/adres/yolu',
            oninput: (e) => { m.address = e.target.value.slice(0, 120); P().push(true); },
          })
        : el('span', { class: 'map-src', text: sourceLabel });

      const targetSel = el('select', {
        class: 'p-in',
        'aria-label': T('Hedef'),
        onchange: (e) => { m.target = e.target.value; m.min = null; m.max = null; P().push(true); P().rerender(); },
      });
      allTargets().forEach((tt) => {
        const key = tt.path || 'action:' + tt.action;
        const o = el('option', { value: key, text: tt.label });
        if (key === m.target) o.selected = true;
        targetSel.appendChild(o);
      });

      const extras = [];
      if (t && !t.action && t.steps) {
        extras.push(el('span', { class: 'map-val', 'data-map-value': m.target }));
      } else if (t && !t.action) {
        extras.push(
          el('input', {
            class: 'p-in p-num', type: 'number', step: 'any', placeholder: 'min',
            value: m.min == null ? '' : m.min,
            oninput: (e) => { m.min = e.target.value === '' ? null : parseFloat(e.target.value); P().push(true); },
          }),
          el('input', {
            class: 'p-in p-num', type: 'number', step: 'any', placeholder: 'max',
            value: m.max == null ? '' : m.max,
            oninput: (e) => { m.max = e.target.value === '' ? null : parseFloat(e.target.value); P().push(true); },
          }),
          el('span', { class: 'map-val', 'data-map-value': m.target })
        );
      }

      const analogOpts = surface === 'gamepad' && t && !t.action && !t.steps ? gamepadOpts(m) : null;
      host.appendChild(
        el('div', { class: 'map-row' + (isLearning ? ' learning' : '') }, [
          learnBtn,
          srcNode,
          targetSel,
          ...extras,
          el('button', {
            class: 'btn ghost small', type: 'button', icon: 'x', title: 'Eşlemeyi kaldır',
            onclick: () => { list.splice(i, 1); P().push(true); P().rerender(); },
          }),
        ])
      );
      if (analogOpts) host.appendChild(analogOpts);
    });

    host.appendChild(
      el('button', {
        class: 'btn ghost small', type: 'button', icon: 'plus', text: 'Eşleme Ekle',
        onclick: () => { list.push(newMapping(surface)); P().push(true); P().rerender(); },
      })
    );
    setTimeout(refreshValueChips, 0);
    return host;
  }

  /* Oyun kumandası eşlemesinin analog ayrıntısı: kip, eksen yarısı, ölü bölge, eğri, ters, yumuşatma, hız. */
  function gamepadOpts(m) {
    const el = P().el;
    const o = GPM().opts(m);
    const save = (k, v) => { m[k] = v; padVal.delete(m.id); P().push(true); };
    const sel = (k, list, label) => {
      const s = el('select', { class: 'p-in', 'aria-label': T(label), title: T(label), onchange: (e) => { save(k, e.target.value); P().rerender(); } });
      for (const [v, text] of list) { const op = el('option', { value: v, text: T(text) }); if (o[k] === v) op.selected = true; s.appendChild(op); }
      return s;
    };
    const num = (k, lo, hi, step, label) => el('label', { class: 'gp-opt' }, [
      el('span', { text: T(label) }),
      el('input', {
        class: 'p-in p-num', type: 'number', min: lo, max: hi, step, value: o[k], 'aria-label': T(label),
        onchange: (e) => { const n = parseFloat(e.target.value); save(k, Number.isFinite(n) ? Math.max(lo, Math.min(hi, n)) : GPM().OPTS[k]); },
      }),
    ]);
    const inv = el('input', { type: 'checkbox', onchange: (e) => save('invert', e.target.checked) });
    inv.checked = o.invert;
    const kids = [
      sel('mode', [['abs', 'Mutlak'], ['rel', 'Göreli (artımlı)']], 'Kip'),
    ];
    if (m.kind === 'axis') {
      kids.push(sel('range', [['full', 'Tam eksen'], ['pos', 'Yalnız + yön'], ['neg', 'Yalnız − yön']], 'Eksen aralığı'));
      kids.push(num('deadzone', 0, 0.9, 0.01, 'Ölü bölge'));
      kids.push(sel('curve', [['linear', 'Doğrusal'], ['expo', 'Üstel']], 'Tepki eğrisi'));
      if (o.curve === 'expo') kids.push(num('expo', 1, 5, 0.1, 'Üs'));
      kids.push(el('label', { class: 'gp-opt' }, [inv, el('span', { text: T('Ters çevir') })]));
    }
    if (o.mode === 'rel') kids.push(num('rate', 0.01, 10, 0.05, 'Hız (aralık/sn)'));
    else kids.push(num('smooth', 0, 0.95, 0.05, 'Yumuşatma'));
    return el('div', { class: 'map-row gp-opts' }, kids);
  }

  function panel(surface) {
    const el = P().el;
    const cfg = P().cfg();
    const nodes = [];

    if (surface === 'midi') {
      nodes.push(P().moduleHead({
        id: 'midi', title: 'MIDI', on: !!cfg.control.midi.enabled, error: !!midiError,
        status: el('div', { class: 'studio-status', text: cfg.control.midi.enabled ? 'Dinliyor' : 'Kapalı' }),
        start: 'Dinlemeyi Başlat', stop: 'Dinlemeyi Durdur',
        toggle: (next) => { cfg.control.midi.enabled = next; P().push(true); if (next) initMidi(); P().rerender(); },
      }));

      if (midiError) {
        nodes.push(el('div', { class: 'studio-status err', text: midiError }));
      } else {
        const sel = el('select', {
          onchange: (e) => { cfg.control.midi.deviceId = e.target.value; P().push(true); bindMidiInputs(); },
        });
        const optAll = el('option', { value: 'all', text: 'Tüm MIDI aygıtları' });
        if ((cfg.control.midi.deviceId || 'all') === 'all') optAll.selected = true;
        sel.appendChild(optAll);
        midiInputs.forEach((inp) => {
          const o = el('option', { value: inp.id, text: (inp.name || 'MIDI') + (inp.manufacturer ? ' — ' + inp.manufacturer : '') });
          if (cfg.control.midi.deviceId === inp.id) o.selected = true;
          sel.appendChild(o);
        });
        nodes.push(P().row('Aygıt', sel));
        const foundBox = el('label', { class: 'lbl' });
        if (midiInputs.length) {
          foundBox.appendChild(el('span', { class: 'st-num', text: midiInputs.length + ' ' }));
          foundBox.appendChild(el('span', { text: 'MIDI girişi bulundu' }));
        } else {
          foundBox.appendChild(el('span', { text: 'MIDI girişi bulunamadı' }));
        }
        nodes.push(
          el('div', { class: 'ctrl' }, [
            el('div', { class: 'row' }, [
              foundBox,
              el('span', { id: 'midiSignal', class: 'map-signal', text: lastSignal.midi || 'sinyal bekleniyor…' }),
            ]),
          ])
        );
      }
      nodes.push(mappingRows('midi'));
    } else if (surface === 'tempo') {
      tempoNodes(cfg).forEach((n) => nodes.push(n));
    } else if (surface === 'gamepad') {
      const g = cfg.control.gamepad || (cfg.control.gamepad = { enabled: false, mappings: [] });
      nodes.push(P().moduleHead({
        id: 'gamepad', title: T('Oyun Kumandası'), on: !!g.enabled,
        status: el('div', { class: 'studio-status', text: g.enabled ? 'Dinliyor' : 'Kapalı' }),
        start: 'Dinlemeyi Başlat', stop: 'Dinlemeyi Durdur',
        toggle: (next) => { g.enabled = next; P().push(true); syncGamepad(); P().rerender(); },
      }));
      if (!navigator.getGamepads) {
        nodes.push(el('div', { class: 'studio-status err', text: T('Bu ortamda Gamepad API kullanılamıyor.') }));
      } else {
        const n = padCount();
        nodes.push(el('div', { class: 'ctrl' }, [el('div', { class: 'row' }, [
          el('label', { class: 'lbl', text: n ? n + ' ' + T('kumanda bağlı') : T('Kumanda bulunamadı (bir düğmeye basın)') }),
          el('span', { id: 'gamepadSignal', class: 'map-signal', text: lastSignal.gamepad || T('sinyal bekleniyor…') }),
        ])]));
        // Canlı eksen göstergesi: eşleme yaparken hangi eksenin ne kadar oynadığı
        nodes.push(el('div', { id: 'gamepadAxes', class: 'gp-axes', 'aria-live': 'off', 'aria-label': T('Canlı eksen değerleri') }));
        setTimeout(syncGamepad, 0);
      }
      nodes.push(el('div', { class: 'note', text: T('Xbox, PlayStation ve genel USB/Bluetooth kumandalar çalışır (Windows, macOS, Linux). Kumanda yalnızca uygulama pencerelerinden biri öndeyken okunur; bu Chromium sınırıdır.') }));
      nodes.push(mappingRows('gamepad'));
    } else if (surface === 'artnetin') {
      artnetInNodes(cfg).forEach((n) => nodes.push(n));
    } else if (surface === 'mtc') {
      mtcNodes(cfg).forEach((n) => nodes.push(n));
    } else if (surface === 'oscout') {
      oscOutNodes(cfg).forEach((n) => nodes.push(n));
    } else {
      nodes.push(P().moduleHead({
        id: 'osc', title: 'OSC Girişi', on: !!cfg.control.osc.enabled,
        status: el('div', { class: 'studio-status', text: cfg.control.osc.enabled ? 'Dinliyor' : 'Kapalı' }),
        start: 'Dinlemeyi Başlat', stop: 'Dinlemeyi Durdur',
        toggle: async (next) => {
          cfg.control.osc.enabled = next;
          P().push(true);
          oscState = await window.api.oscSync();
          P().rerender();
        },
      }));
      /* Dinlenen port: 1024 altı Linux/macOS'ta yönetici ister, sunucu
         açılamaz. Windows'ta böyle bir sınır yok; orada 1'den başlar. */
      const oscMin = window.SV_PLATFORM && window.SV_PLATFORM.isWindows ? 1 : 1024;
      const oscSync = async () => {
        P().push(true);
        oscState = await window.api.oscSync();
        P().rerender();
      };
      nodes.push(
        P().row(
          'UDP Portu',
          el('input', {
            class: 'p-in p-num', type: 'number', min: String(oscMin), max: '65535', value: cfg.control.osc.port,
            onchange: async (e) => {
              const port = P().portValue(e.target, cfg.control.osc.port, oscMin);
              if (port == null) return;
              cfg.control.osc.port = port;
              await oscSync();
            },
          })
        )
      );
      const queryFallback = (window.SVOscTree && window.SVOscTree.DEFAULT_QUERY_PORT) || 17801;
      const queryPort = oscState.queryPort || cfg.control.osc.queryPort || queryFallback;
      nodes.push(P().row('OSCQuery Portu', el('input', {
        id: 'oscQueryPort',
        class: 'p-in p-num', type: 'number', min: String(oscMin), max: '65535', value: queryPort,
        onchange: async (e) => {
          const port = P().portValue(e.target, queryPort, oscMin);
          if (port == null) return;
          cfg.control.osc.queryPort = port;
          await oscSync();
        },
      })));
      const shownPrefix = cfg.control.osc.prefix || (cfg.oscOut && cfg.oscOut.prefix) || '/cayadev';
      nodes.push(P().row('Adres Öneki', el('input', {
        class: 'p-in', type: 'text', value: shownPrefix, spellcheck: 'false', autocomplete: 'off',
        onchange: async (e) => {
          const v = String(e.target.value || '').trim().replace(/\/+$/, '');
          if (!OSC_PREFIX.test(v) || !v) {
            P().toast(T('Önek /cayadev gibi olmalı: en çok dört parça, harf, rakam, - ve _.'), 'err');
            e.target.value = shownPrefix;
            return;
          }
          cfg.control.osc.prefix = v;
          await oscSync();
        },
      })));
      const stBox = el('label', {
        class: 'lbl studio-status ' + (oscState.running ? 'ok' : oscState.error ? 'err' : ''),
      });
      if (oscState.running) {
        stBox.appendChild(el('span', { icon: 'check' }));
        stBox.appendChild(el('span', { text: 'Port' }));
        stBox.appendChild(el('span', { class: 'st-num', text: ' ' + oscState.port + ' ' }));
        stBox.appendChild(el('span', { text: 'dinleniyor' }));
        if (oscState.queryPort) {
          stBox.appendChild(el('span', { text: ' · OSCQuery ' }));
          stBox.appendChild(el('span', { class: 'st-num', text: String(oscState.queryPort) }));
          const mdnsText = oscState.mdns ? 'mDNS' : (oscState.mdnsAnnounce ? 'duyuru gidiyor' : 'mDNS yok');
          stBox.appendChild(el('span', { text: ' · ' }));
          stBox.appendChild(el('span', { text: mdnsText }));
        }
      } else if (oscState.error) {
        stBox.appendChild(el('span', { icon: 'x', text: oscState.error }));
      } else {
        stBox.appendChild(el('span', { text: 'Kapalı' }));
      }
      nodes.push(
        el('div', { class: 'ctrl' }, [
          el('div', { class: 'row' }, [
            stBox,
            el('span', { id: 'oscSignal', class: 'map-signal', text: lastSignal.osc || 'mesaj bekleniyor…' }),
          ]),
        ])
      );
      nodes.push(
        el('div', { class: 'studio-note', text: 'OSC gönderen uygulamayı bu bilgisayarın IP adresine ve yukarıdaki porta yöneltin. 0..1 arası değerler doğrudan, 0..127 arası değerler otomatik ölçeklenerek kullanılır.' })
      );
      nodes.push(P().slider('Ana Opaklık', 'master', { step: 0.01 }));
      nodes.push(el('div', {
        class: 'studio-note',
        text: 'Sabit adres ağacı README dosyasında. Öğrenme duruyor. Çıkışla aynı önek. Paket bütün olarak uygulanır. Gelecek zaman etiketi en çok 30 saniye bekler. OSCQuery HTTP ve mDNS ile duyurulur.',
      }));
      if (oscState.queryMoved) {
        nodes.push(el('div', {
          class: 'studio-note',
          text: 'OSCQuery seçilen portta bu makinenin localhost adresine ulaşamıyor. Servis boş bir porta geçti; buradaki port kullanılan porttur.',
        }));
      }
      nodes.push(mappingRows('osc'));
    }

    return el('div', { class: 'control-panel' }, nodes);
  }

  // --------------------------------------------------------------------------
  // OSC çıkışı (#437)
  // --------------------------------------------------------------------------
  /* Ana süreçteki denetimin (src/main/osc-out.js) aynısı; panel geçersiz
     bir değeri baştan geri çeviriyor ki kullanıcı ne olduğunu görsün. */
  const OSC_HOST = /^(?=.{1,253}$)[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?(?:\.[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?)*$/;
  const OSC_PREFIX = /^(\/[A-Za-z0-9_-]{1,32}){0,4}$/;
  /* Ana süreçteki validHost ile aynı kabul: IPv4, IPv6 ya da ana bilgisayar
     adı. Bölge kimliği (%eth0) yok. Köşeli parantez yalnız alanda soyulur. */
  function oscHostOk(v) {
    let h = String(v || '').trim();
    if (h.startsWith('[') && h.endsWith(']')) h = h.slice(1, -1);
    if (!h || h.length > 253 || h.includes('%')) return false;
    if (OSC_HOST.test(h)) return true;
    if (!/^[0-9A-Fa-f:]+$/.test(h) || !h.includes(':')) return false;
    const halves = h.split('::');
    if (halves.length > 2) return false;
    const groups = h.split(':');
    if (groups.length > 8) return false;
    return groups.every((g) => g.length <= 4);
  }

  function oscOutNodes(cfg) {
    const el = P().el;
    const o = cfg.oscOut;
    /* Eski ayar dosyasında bu alanlar yok. Ana süreç yokluğu "açık" sayar;
       kutu da öyle görünmeli. */
    if (o.analysis == null) o.analysis = true;
    if (o.latencyMs == null) o.latencyMs = 0;
    if (o.extra == null) o.extra = '';
    const nodes = [];
    const sync = async () => {
      P().push(true);
      try { oscOutState = await window.api.oscOutSync(); } catch { /* servis kapalı */ }
      P().rerender();
    };
    const toggle = (label, key) => {
      const box = el('input', { type: 'checkbox', onchange: (e) => { o[key] = e.target.checked; sync(); } });
      box.checked = !!o[key];
      return P().row(label, el('label', { class: 'switch' }, [box, el('span', { class: 'track' })]));
    };
    const text = (value, ok, apply, bad) => el('input', {
      class: 'p-in', type: 'text', value, spellcheck: 'false', autocomplete: 'off',
      onchange: (e) => {
        const v = String(e.target.value).trim();
        if (!ok(v)) {
          P().toast(T(bad), 'err');
          e.target.value = value;
          return;
        }
        apply(v);
        sync();
      },
    });

    nodes.push(P().moduleHead({
      id: 'oscout', title: 'OSC Çıkışı', on: !!o.enabled,
      status: el('div', { class: 'studio-status', text: o.enabled ? 'Gönderiyor' : 'Kapalı' }),
      start: 'Göndermeyi Başlat', stop: 'Göndermeyi Durdur',
      toggle: (next) => { o.enabled = next; sync(); },
    }));
    nodes.push(P().row('Hedef Adres', text(o.host, oscHostOk, (v) => {
      o.host = v.startsWith('[') && v.endsWith(']') ? v.slice(1, -1) : v;
    }, 'Adres bir IPv4, IPv6 ya da ana bilgisayar adı olmalı.')));
    nodes.push(P().row('Hedef Port', el('input', {
      class: 'p-in p-num', type: 'number', min: '1', max: '65535', value: o.port,
      onchange: (e) => {
        const port = P().portValue(e.target, o.port, 1);
        if (port == null) return;
        o.port = port;
        sync();
      },
    })));
    nodes.push(P().row('Seviye Gönderim Hızı (Hz)', el('input', {
      class: 'p-in p-num', type: 'number', min: '1', max: '30', value: o.rate,
      onchange: (e) => {
        const n = Number(e.target.value);
        if (!Number.isInteger(n) || n < 1 || n > 30) {
          P().toast(T('Hız 1–30 arasında bir tam sayı olmalı.'), 'err');
          e.target.value = String(o.rate);
          return;
        }
        o.rate = n;
        sync();
      },
    })));
    nodes.push(P().row('Adres Öneki', text(o.prefix, (v) => OSC_PREFIX.test(v.replace(/\/+$/, '')),
      (v) => { o.prefix = v.replace(/\/+$/, ''); }, 'Önek /cayadev gibi olmalı: en çok dört parça, harf, rakam, - ve _.')));
    nodes.push(P().row('Saat Gecikmesi (ms)', el('input', {
      class: 'p-in p-num', type: 'number', min: '-2000', max: '2000', step: '1', value: o.latencyMs || 0,
      onchange: (e) => {
        const n = Number(e.target.value);
        if (!Number.isInteger(n) || n < -2000 || n > 2000) {
          P().toast(T('Gecikme -2000 ile 2000 ms arasında bir tam sayı olmalı.'), 'err');
          e.target.value = String(o.latencyMs || 0);
          return;
        }
        o.latencyMs = n;
        sync();
      },
    })));
    nodes.push(P().row('Ek Hedefler', el('textarea', {
      class: 'p-in', rows: '3', spellcheck: 'false', value: o.extra || '',
      onchange: (e) => { o.extra = e.target.value; sync(); },
    })));
    nodes.push(toggle('Ses Seviyeleri', 'levels'));
    nodes.push(toggle('Davul Vuruşları', 'hits'));
    nodes.push(toggle('Tempo ve Vuruş Saati', 'tempo'));
    nodes.push(toggle('Sahne ve Mod Değişimleri', 'state'));
    nodes.push(toggle('Çözümleme ve Tayf', 'analysis'));

    const st = oscOutState || {};
    const stBox = el('label', { class: 'lbl studio-status ' + (st.error ? 'err' : st.running ? 'ok' : '') });
    if (st.error === 'loop') {
      stBox.appendChild(el('span', { icon: 'x', text: 'Hedef bu bilgisayarın OSC girişi; geri besleme olmasın diye gönderilmiyor. Portu değiştirin.' }));
    } else if (st.error) {
      stBox.appendChild(el('span', { icon: 'x', text: st.error }));
    } else if (st.running) {
      stBox.appendChild(el('span', { icon: 'check' }));
      stBox.appendChild(el('span', { text: 'Gönderiliyor' }));
      stBox.appendChild(el('span', { class: 'st-num', text: ' ' + st.host + ':' + st.port + ' · ' }));
      stBox.appendChild(el('span', { id: 'oscOutPackets', class: 'st-num', text: String(st.packets || 0) + ' ' }));
      stBox.appendChild(el('span', { text: 'paket' }));
      pollOscOutCount();
    } else {
      stBox.appendChild(el('span', { text: 'Kapalı' }));
    }
    nodes.push(el('div', { class: 'ctrl' }, [el('div', { class: 'row' }, [stBox])]));
    nodes.push(el('div', {
      class: 'studio-note',
      text: 'Seviye, bas, mid ve tiz tek pakette gider. Vuruştan sonra 0 gelir. Saat: BPM, faz (0..1), ölçü fazı, ölçü başı, çalıyor ya da durdu. Ayrıntılı adres ağacı README dosyasında.',
    }));
    nodes.push(el('div', {
      class: 'studio-note',
      text: 'Ek hedefler satır satır: 10.0.0.8:9001 ya da [::1]:9001. Pozitif gecikme saati geri alır; hoparlör geç kalıyorsa ışık onu bekler.',
    }));
    nodes.push(el('div', { class: 'studio-note', text: 'Seviye, tayf ve vuruşları açık bir çıkış ölçer: ekran, yüzen pencere ya da Spout/Syphon. Yalnız panel açıkken saat ve gösteri durumu gider.' }));
    return nodes;
  }

  /* Paket sayacı canlı: kart ekrandayken saniyede bir tazelenir, paneli
     yeniden çizmeden. Kalıcı bir zamanlayıcı yok; sayaç ekrandan kalkınca
     zincir kendiliğinden durur. */
  let oscOutPoll = 0;
  function pollOscOutCount() {
    if (oscOutPoll || !window.api || !window.api.oscOutStatus) return;
    const tick = async () => {
      oscOutPoll = 0;
      const n = document.getElementById('oscOutPackets');
      if (!n) return;
      try {
        const st = await window.api.oscOutStatus();
        if (st) {
          oscOutState = st;
          n.textContent = String(st.packets || 0) + ' ';
        }
      } catch { /* servis kapalı */ }
      if (!oscOutPoll) oscOutPoll = setTimeout(tick, 1000);
    };
    oscOutPoll = setTimeout(tick, 1000);
  }

  async function init() {
    if (started) return;
    started = true;
    const cfg = P().cfg();
    if (cfg.control && cfg.control.midi && cfg.control.midi.enabled) initMidi();
    else if (cfg.tempoSync && cfg.tempoSync.source === 'midi') initMidi();
    if (!cfg.control.gamepad) cfg.control.gamepad = { enabled: false, mappings: [] };
    syncGamepad();
    if (window.api.tempoSyncStatus) {
      window.api.tempoSyncStatus().then((st) => { if (st) tempoState = Object.assign({}, tempoState, st); }).catch(() => {});
    }
    if (window.api.onTempoSync) {
      window.api.onTempoSync((st) => {
        if (!st) return;
        tempoState = Object.assign({}, tempoState, st);
        if (st.source === 'link') applyExternalTempo(st.bpm, 'link');
      });
    }
    window.api.onOscMessage(onOsc);
    if (window.api.onArtnetIn) window.api.onArtnetIn(onArtnetIn);
    if (window.api.onArtnetInStatus) window.api.onArtnetInStatus((s) => { if (s) artnetInState = s; });
    if (window.api.artnetInStatus) window.api.artnetInStatus().then((s) => { if (s) artnetInState = s; }).catch(() => {});
    if (cfg.control.mtc && cfg.control.mtc.enabled) {
      const already = (cfg.control.midi && cfg.control.midi.enabled) || (cfg.tempoSync && cfg.tempoSync.source === 'midi');
      if (!already) initMidi();
      syncMtc();
    }
    window.api.onOscStatus((s) => {
      oscState = s || oscState;
      const live = P().cfg();
      if (s && s.queryPort && live && live.control && live.control.osc && live.control.osc.queryPort !== s.queryPort) {
        live.control.osc.queryPort = s.queryPort;
        const field = document.getElementById('oscQueryPort');
        if (field) field.value = String(s.queryPort);
      }
    });
    try { oscState = await window.api.oscStatus(); } catch { /* servis kapalı */ }
    if (window.api.onOscOutStatus) window.api.onOscOutStatus((s) => { oscOutState = s; });
    if (window.api.oscOutStatus) {
      try { oscOutState = await window.api.oscOutStatus(); } catch { /* servis kapalı */ }
    }
  }

  window.SVControl = { panel, init, TARGETS, allTargets, mappedValue, runAction };
})();
