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
  let lastSignal = { midi: '', osc: '' };
  let oscState = { running: false, port: 0, error: null, lastAddress: '' };
  let started = false;

  // Sürülebilir hedefler. Aralıklar panel kaydırıcılarıyla aynı tutuldu ki
  // denetleyicinin tam açması, kaydırıcının sonuna gelmesiyle aynı şey olsun.
  const TARGETS = [
    { path: 'audio.sensitivity', label: 'Ses · Hassasiyet', min: 0.2, max: 4 },
    { path: 'audio.smoothing', label: 'Ses · Yumuşatma', min: 0, max: 0.95 },
    { path: 'audio.bassBoost', label: 'Ses · Bas Vurgusu', min: 1, max: 4 },
    { path: 'visualizer.sensitivity', label: 'Görselleştirici · Hassasiyet', min: 0.3, max: 3 },
    { path: 'visualizer.glow', label: 'Görselleştirici · Parlama', min: 0, max: 1 },
    { path: 'visualizer.barCount', label: 'Görselleştirici · Bar Sayısı', min: 16, max: 160, int: true },
    { path: 'visualizer.gap', label: 'Görselleştirici · Bar Boşluğu', min: 0, max: 0.8 },
    { path: 'visualizer.lineWidth', label: 'Görselleştirici · Çizgi Kalınlığı', min: 1, max: 12 },
    { path: 'visualizer.thickness', label: 'Görselleştirici · Genlik', min: 0.1, max: 1 },
    { path: 'background.gradient.speed', label: 'Arkaplan · Akış Hızı', min: 0, max: 2 },
    { path: 'background.gradient.audioReactivity', label: 'Arkaplan · Ses Tepkisi', min: 0, max: 2 },
    { path: 'background.gradient.brightness', label: 'Arkaplan · Parlaklık', min: 0.4, max: 1.6 },
    { path: 'background.gradient.audioHue', label: 'Arkaplan · Renk Kayması', min: 0, max: 1 },
    { path: 'background.gradient.vignette', label: 'Arkaplan · Vinyet', min: 0, max: 1 },
    { path: 'logo.opacity', label: 'Logo · Saydamlık', min: 0, max: 1 },
    { path: 'logo.scale', label: 'Logo · Boyut', min: 0.05, max: 0.6 },
    { path: 'feedback.zoom', label: 'Geri Besleme · Yakınlaşma', min: 0.94, max: 1.08 },
    { path: 'feedback.decay', label: 'Geri Besleme · Sönme', min: 0.7, max: 0.999 },
    { path: 'feedback.warp', label: 'Geri Besleme · Bükülme', min: 0, max: 2 },
    { path: 'feedback.rotate', label: 'Geri Besleme · Dönüş', min: -1, max: 1 },
    { path: 'media.opacity', label: 'Medya · Saydamlık', min: 0, max: 1 },
    { path: 'media.kaleido', label: 'Medya · Kaleydoskop', min: 0, max: 12, int: true },
    { action: 'nextVisualizer', label: '⏭ Eylem · Sonraki Görselleştirici' },
    { action: 'prevVisualizer', label: '⏮ Eylem · Önceki Görselleştirici' },
    { action: 'nextBackground', label: '⏭ Eylem · Sonraki Arkaplan' },
    { action: 'nextScene', label: '⏭ Eylem · Sonraki Sahne' },
    { action: 'nextPalette', label: '⏭ Eylem · Sonraki Renk Şablonu' },
    { action: 'blackout', label: '🌑 Eylem · Karart (aç/kapa)' },
  ];

  const VIS_CYCLE = ['bars', 'centerBars', 'blocks', 'dots', 'wave', 'ribbon', 'terrain', 'circular',
    'radialWave', 'starburst', 'tunnel', 'orb', 'particles', 'spectrogram', 'kaleido', 'helix',
    'metaball', 'fireworks', 'vortex', 'mandala', 'skyline', 'lightning', 'ripplegrid', 'lissajous',
    'strings', 'bubbles', 'wave3d', 'arcs', 'pinwheel', 'feedback'];
  const BG_CYCLE = ['gradient', 'ink', 'nebula', 'waves', 'aurora', 'grid', 'hexgrid', 'mosaic',
    'corridor', 'spiral', 'rings', 'network', 'starfield', 'snow', 'bokeh', 'rain', 'city', 'solid'];

  let blackoutSaved = null;

  function targetFor(key) {
    return TARGETS.find((t) => (t.path || 'action:' + t.action) === key) || null;
  }

  // --------------------------------------------------------------------------
  // Eşlemenin uygulanması
  // --------------------------------------------------------------------------
  function applyMapping(map, value01) {
    const cfg = P().cfg();
    const t = targetFor(map.target);
    if (!t) return;

    if (t.action) {
      // Eylemler yalnızca sinyal yükselirken tetiklenir (fader sürüklerken değil)
      if (value01 < 0.5) return;
      if (map._armed === false) return;
      map._armed = false;
      runAction(t.action, cfg);
      P().push(true);
      P().rerender();
      return;
    }

    const lo = map.min == null ? t.min : map.min;
    const hi = map.max == null ? t.max : map.max;
    let v = lo + (hi - lo) * Math.max(0, Math.min(1, value01));
    if (t.int) v = Math.round(v);
    P().set(t.path, v);
    P().push(false);
    refreshValueChips();
  }

  function runAction(action, cfg) {
    if (action === 'nextVisualizer' || action === 'prevVisualizer') {
      const i = VIS_CYCLE.indexOf(cfg.visualizer.type);
      const d = action === 'nextVisualizer' ? 1 : -1;
      cfg.visualizer.type = VIS_CYCLE[(i + d + VIS_CYCLE.length) % VIS_CYCLE.length];
    } else if (action === 'nextBackground') {
      const i = BG_CYCLE.indexOf(cfg.background.type);
      cfg.background.type = BG_CYCLE[(i + 1) % BG_CYCLE.length];
    } else if (action === 'nextScene') {
      const list = cfg.scenes || [];
      if (!list.length) return;
      const idx = (runAction._scene = ((runAction._scene || 0) + 1) % list.length);
      const data = list[idx].data || {};
      const SCENE_KEYS = ['background', 'visualizer', 'layers', 'layerStack', 'layerGroups', 'crossfade', 'geometry', 'postfx', 'logo', 'images', 'media', 'text', 'modulation', 'transition', 'custom', 'milkdrop', 'feedback'];
      for (const key of SCENE_KEYS) {
        if (data[key] !== undefined) cfg[key] = JSON.parse(JSON.stringify(data[key]));
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
    }
  }

  function refreshValueChips() {
    document.querySelectorAll('[data-map-value]').forEach((n) => {
      const t = targetFor(n.dataset.mapValue);
      if (!t || t.action) return;
      const v = P().get(t.path);
      n.textContent = typeof v === 'number' ? (t.int ? String(Math.round(v)) : v.toFixed(2)) : '—';
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
    for (const input of midiInputs) {
      input.onmidimessage = want === 'all' || want === input.id ? onMidi : null;
    }
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
  // OSC (ana süreçten iletilir)
  // --------------------------------------------------------------------------
  function onOsc(msg) {
    const value = typeof msg.args[0] === 'number' ? msg.args[0] : msg.args[0] === true ? 1 : 0;
    lastSignal.osc = msg.address + ' ' + (msg.args.length ? JSON.stringify(msg.args[0]) : '');
    const chip = document.getElementById('oscSignal');
    if (chip) chip.textContent = lastSignal.osc;

    const cfg = P().cfg();
    if (learning && learning.surface === 'osc') {
      const m = (cfg.control.osc.mappings || []).find((x) => x.id === learning.id);
      if (m) {
        m.address = msg.address;
        learning = null;
        P().push(true);
        P().rerender();
      }
      return;
    }

    if (!cfg.control.osc.enabled) return;
    for (const m of cfg.control.osc.mappings || []) {
      if (m.address !== msg.address) continue;
      // OSC 0..1 gönderir; 1'den büyük değerler 0..127 kabul edilir (TouchOSC)
      const v01 = value > 1 ? value / 127 : value;
      if (v01 < 0.5) m._armed = true;
      applyMapping(m, v01);
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
      host.appendChild(el('div', { class: 'studio-empty', text: 'Henüz eşleme yok. “＋ Eşleme Ekle” ile başlayın.' }));
    }

    list.forEach((m, i) => {
      const t = targetFor(m.target);
      const isLearning = learning && learning.surface === surface && learning.id === m.id;

      const sourceLabel =
        surface === 'midi'
          ? m.cc >= 0
            ? (m.kind === 'note' ? 'Nota ' : 'CC ') + m.cc + (m.channel ? ' · k' + m.channel : '')
            : '—'
          : m.address;

      const learnBtn = el('button', {
        class: 'btn small' + (isLearning ? ' primary' : ' ghost'),
        type: 'button',
        text: isLearning ? '● Dinleniyor…' : '🎯 Öğren',
        title: surface === 'midi' ? 'Bas, sonra denetleyicideki düğmeyi oynat' : 'Bas, sonra OSC mesajını gönder',
        onclick: () => {
          learning = isLearning ? null : { surface, id: m.id };
          P().rerender();
        },
      });

      const srcNode = surface === 'osc'
        ? el('input', {
            class: 'p-in', type: 'text', value: m.address, placeholder: '/adres/yolu',
            oninput: (e) => { m.address = e.target.value.slice(0, 120); P().push(true); },
          })
        : el('span', { class: 'map-src', text: sourceLabel });

      const targetSel = el('select', {
        class: 'p-in',
        onchange: (e) => { m.target = e.target.value; m.min = null; m.max = null; P().push(true); P().rerender(); },
      });
      TARGETS.forEach((tt) => {
        const key = tt.path || 'action:' + tt.action;
        const o = el('option', { value: key, text: tt.label });
        if (key === m.target) o.selected = true;
        targetSel.appendChild(o);
      });

      const extras = [];
      if (t && !t.action) {
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

      host.appendChild(
        el('div', { class: 'map-row' + (isLearning ? ' learning' : '') }, [
          learnBtn,
          srcNode,
          targetSel,
          ...extras,
          el('button', {
            class: 'btn ghost small', type: 'button', text: '✕', title: 'Eşlemeyi kaldır',
            onclick: () => { list.splice(i, 1); P().push(true); P().rerender(); },
          }),
        ])
      );
    });

    host.appendChild(
      el('button', {
        class: 'btn ghost small', type: 'button', text: '＋ Eşleme Ekle',
        onclick: () => { list.push(newMapping(surface)); P().push(true); P().rerender(); },
      })
    );
    setTimeout(refreshValueChips, 0);
    return host;
  }

  function panel(surface) {
    const el = P().el;
    const cfg = P().cfg();
    const nodes = [];

    if (surface === 'midi') {
      const enable = el('input', {
        type: 'checkbox',
        onchange: (e) => { cfg.control.midi.enabled = e.target.checked; P().push(true); if (e.target.checked) initMidi(); },
      });
      enable.checked = !!cfg.control.midi.enabled;
      nodes.push(P().row('MIDI Etkin', el('label', { class: 'switch' }, [enable, el('span', { class: 'track' })])));

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
    } else {
      const enable = el('input', {
        type: 'checkbox',
        onchange: async (e) => {
          cfg.control.osc.enabled = e.target.checked;
          P().push(true);
          oscState = await window.api.oscSync();
          P().rerender();
        },
      });
      enable.checked = !!cfg.control.osc.enabled;
      nodes.push(P().row('OSC Etkin', el('label', { class: 'switch' }, [enable, el('span', { class: 'track' })])));
      nodes.push(
        P().row(
          'UDP Portu',
          el('input', {
            class: 'p-in p-num', type: 'number', min: '1', max: '65535', value: cfg.control.osc.port,
            onchange: async (e) => {
              cfg.control.osc.port = Math.max(1, Math.min(65535, parseInt(e.target.value, 10) || 9000));
              P().push(true);
              oscState = await window.api.oscSync();
              P().rerender();
            },
          })
        )
      );
      const stBox = el('label', {
        class: 'lbl studio-status ' + (oscState.running ? 'ok' : oscState.error ? 'err' : ''),
      });
      if (oscState.running) {
        stBox.appendChild(el('span', { text: '✓ ' }));
        stBox.appendChild(el('span', { text: 'Port' }));
        stBox.appendChild(el('span', { class: 'st-num', text: ' ' + oscState.port + ' ' }));
        stBox.appendChild(el('span', { text: 'dinleniyor' }));
      } else if (oscState.error) {
        stBox.appendChild(el('span', { text: '✕ ' + oscState.error }));
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
      nodes.push(mappingRows('osc'));
    }

    return el('div', { class: 'control-panel' }, nodes);
  }

  async function init() {
    if (started) return;
    started = true;
    const cfg = P().cfg();
    if (cfg.control && cfg.control.midi && cfg.control.midi.enabled) initMidi();
    window.api.onOscMessage(onOsc);
    window.api.onOscStatus((s) => { oscState = s; });
    try { oscState = await window.api.oscStatus(); } catch { /* servis kapalı */ }
  }

  window.SVControl = { panel, init, TARGETS };
})();
