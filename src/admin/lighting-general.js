/*
 * SoundVisualizer — CaYaDev Ses Görselleştirici
 * Copyright (c) 2026 Çağan Turgut (CaYatur) — CaYaDev, https://cayadev.com
 * https://github.com/CaYatur/SoundVisualizer
 * SPDX-License-Identifier: MIT
 */
'use strict';
/* Genel Işık Ayarları — Windows Dynamic Lighting ve OpenRGB ortak görünümü.
 *
 * Eskiden bu ayarlar yalnız WDL kartı AÇIKken görünüyordu; OpenRGB tek başına
 * açıkken veya henüz hiçbir çıkış seçilmemişken dokunulamıyordu. Bu panel
 * Işık kategorisinin en altında her zaman durur. Linux ve macOS'ta kart
 * kapanmaz: yalnız WDL'ye ait denetimler ve "Windows Dynamic Lighting"
 * etiketi gizlenir, OpenRGB'nin kullandığı ayarlar yerinde kalır.
 *
 * Her denetimin yanında hangi çıkışlarda geçerli olduğu yazar. Etiketler
 * kod yollarına göre: shared/lighting-render.js → WDL + OpenRGB; lighting.brightness
 * / updateRate yalnız WDL (OpenRGB kendi brightness/fps alanını kullanır);
 * statik modlar (tek renk / aygıt / LED) yalnız WDL. Art-Net ayrı cfg.artnet
 * kullanır — burada etiketlenmez.
 */
(function () {
  const P = () => window.SVPanel;
  const WDL = 'Windows Dynamic Lighting';
  const ORGB = 'OpenRGB';

  const STATIC_MODES = ['single-color', 'per-device', 'per-led'];

  function wdlOn() {
    return !!(typeof window !== 'undefined' && window.SV_PLATFORM && window.SV_PLATFORM.isWindows);
  }

  function shownTags(names) {
    if (wdlOn()) return names;
    return names.filter((n) => n !== WDL);
  }

  function backends(names) {
    const el = P().el;
    return el('div', { class: 'lighting-backends' }, names.map((n) => el('span', { class: 'lighting-backend-tag', text: n })));
  }

  /* keep: etiket kalmayınca denetimi yine çiz (mod listesi). WDL-only
     kaydırıcılar keep olmadan tamamen düşer. */
  function wrap(ctrl, names, keep) {
    const el = P().el;
    const tags = shownTags(names);
    if (!tags.length) return keep ? ctrl : null;
    return el('div', { class: 'lighting-tagged' }, [ctrl, backends(tags)]);
  }

  /* Tek ayar sıfırlama: admin appendGrouped ile aynı data-path + ctrl-reset.
     Rozet sayımı sectionPaths yapraklarına dayandığı için her denetim yolu şart. */
  function attachPath(ctrl, key) {
    const path = key.indexOf('.') >= 0 ? key : 'lighting.' + key;
    const el = P().el;
    ctrl.setAttribute('data-path', path);
    if (P().isModified && P().isModified(path)) ctrl.classList.add('modified');
    const lbl = ctrl.querySelector('label.lbl');
    if (lbl && P().resetPath && P().defaultAt && P().defaultAt(path) !== undefined) {
      lbl.appendChild(el('button', {
        class: 'ctrl-reset',
        type: 'button',
        icon: 'reset',
        title: 'Bu ayarı varsayılana döndür',
        onclick: (e) => {
          e.preventDefault();
          e.stopPropagation();
          P().resetPath(path);
        },
      }));
    }
    return ctrl;
  }
  function panel() {
    const el = P().el;
    const cfg = P().cfg();
    const lighting = cfg.lighting || (cfg.lighting = window.SV.defaultConfig().lighting);
    const apply = (rebuild) => {
      P().push(!!rebuild);
      if (rebuild) P().rerender();
    };

    const nodes = [];
    nodes.push(el('div', {
      class: 'lighting-general-banner',
      text: wdlOn()
        ? 'Bu ayarlar Windows Dynamic Lighting ve OpenRGB çıkışlarının ortak görünümüdür. Art-Net kendi kartındaki ayarları kullanır. Bir çıkışı açmadan da burada düzenleyebilirsiniz.'
        : 'Bu ayarlar OpenRGB çıkışının görünümüdür. Art-Net kendi kartındaki ayarları kullanır. Bir çıkışı açmadan da burada düzenleyebilirsiniz.',
    }));

    const themedDropdown = (label, value, options, onChange, description) => {
      const selected = options.find((option) => String(option.value) === String(value)) || options[0];
      const menu = el('div', { class: 'lighting-select-menu' });
      const buttonText = el('span', { class: 'lighting-select-value', text: selected.label });
      const arrow = el('span', { class: 'lighting-select-arrow', icon: 'chevron-down' });
      const button = el('button', { type: 'button', class: 'lighting-select-button' }, [buttonText, arrow]);
      const wrapSel = el('div', { class: 'lighting-select-wrap', tabIndex: 0 }, [button, menu]);
      const close = () => wrapSel.classList.remove('open');
      options.forEach((option) => {
        const item = el('button', {
          type: 'button',
          class: String(option.value) === String(value) ? 'lighting-select-option active' : 'lighting-select-option',
          onclick: (event) => {
            event.preventDefault();
            event.stopPropagation();
            close();
            onChange(option.value);
          },
        }, [
          el('span', { class: 'lighting-option-label', text: option.label }),
          description && option.desc ? el('span', { class: 'lighting-option-desc', text: option.desc }) : null,
        ].filter(Boolean));
        menu.appendChild(item);
      });
      button.onclick = (event) => {
        event.preventDefault();
        event.stopPropagation();
        wrapSel.classList.toggle('open');
      };
      wrapSel.onblur = () => setTimeout(close, 100);
      return el('div', { class: 'ctrl' }, [el('label', { class: 'lbl', text: label }), wrapSel]);
    };

    const colorRow = (key, label) => {
      const input = el('input', {
        type: 'color', value: lighting[key],
        oninput: (e) => { lighting[key] = e.target.value; apply(false); },
      });
      return attachPath(el('div', { class: 'ctrl' }, [el('div', { class: 'row' }, [el('label', { class: 'lbl', text: label }), input])]), key);
    };

    const rangeRow = (key, label, min, max, step, percent) => {
      const current = Number(lighting[key]);
      const value = el('span', { class: 'val', text: percent ? Math.round(current * 100) + '%' : String(current) });
      const input = el('input', {
        type: 'range', min, max, step, value: current,
        oninput: (e) => {
          lighting[key] = parseFloat(e.target.value);
          value.textContent = percent ? Math.round(lighting[key] * 100) + '%' : String(lighting[key]);
          apply(false);
        },
      });
      return attachPath(el('div', { class: 'ctrl' }, [el('div', { class: 'row' }, [el('label', { class: 'lbl', text: label }), value]), input]), key);
    };

    const optionRow = (key, label, options) => attachPath(themedDropdown(label, lighting[key], options, (value) => {
      lighting[key] = value;
      apply(true);
    }, false), key);

    let modes = (P().lightingModes && P().lightingModes()) || [];
    if (!wdlOn()) modes = modes.filter((m) => STATIC_MODES.indexOf(String(m.value)) < 0);
    const staticMode = STATIC_MODES.includes(lighting.mode);
    const dynamicMode = !staticMode;

    nodes.push(wrap(
      attachPath(themedDropdown('Aydınlatma Modu', lighting.mode, modes, (value) => {
        lighting.mode = value;
        apply(true);
      }, true), 'mode'),
      staticMode ? [WDL] : [WDL, ORGB],
      !wdlOn()
    ));
    if (staticMode && wdlOn()) {
      nodes.push(el('div', {
        class: 'lighting-mode-help',
        text: 'Statik modlar (tek renk, aygıt başına, LED başına) yalnız Windows Dynamic Lighting ile çalışır. OpenRGB sesi izleyen dinamik modları sürer. Aygıt/LED renk boyası Windows Dynamic Lighting kartındadır.',
      }));
    } else if (staticMode) {
      nodes.push(el('div', {
        class: 'lighting-mode-help',
        text: 'Kayıtlı aydınlatma modu bu sistemde yok. Listeden OpenRGB\'nin sürebildiği bir mod seçin.',
      }));
    }

    if (wdlOn()) {
      nodes.push(wrap(rangeRow('brightness', 'Genel Parlaklık', 0, 1, 0.01, true), [WDL]));
      nodes.push(el('div', {
        class: 'lighting-mode-help',
        text: 'OpenRGB parlaklığı OpenRGB kartındaki Parlaklık kaydırıcısındadır; buradaki değer Windows Dynamic Lighting içindir.',
      }));
    }

    if (lighting.mode === 'single-color') {
      nodes.push(wrap(colorRow('color', 'Tek Renk'), [WDL]));
    }

    if (dynamicMode) {
      nodes.push(el('div', { class: 'lighting-subtitle', text: 'Genel Dinamik Ayarlar' }));
      nodes.push(wrap(optionRow('layout', 'LED Yerleşimi', [
        { value: 'global', label: 'Tüm Aygıtlarda Kesintisiz' },
        { value: 'per-device', label: 'Her Aygıtta Baştan Başla' },
        { value: 'uniform', label: 'Tüm LED\'lerde Aynı Ton' },
      ]), [WDL, ORGB]));
      if (lighting.mode !== 'threshold-background-burst') {
        nodes.push(wrap(rangeRow('intensity', 'Ses Tepkisi', 0, 1, 0.01, true), [WDL, ORGB]));
        nodes.push(wrap(rangeRow('smoothing', 'Yumuşatma', 0, 0.95, 0.01, true), [WDL, ORGB]));
        nodes.push(wrap(rangeRow('baseLevel', 'Sessizlikte Işık', 0.02, 0.6, 0.01, true), [WDL, ORGB]));
        nodes.push(wrap(rangeRow('spread', 'Renk Yayılımı', 0.1, 4, 0.05), [WDL, ORGB]));
      }
      if (wdlOn()) {
        nodes.push(wrap(rangeRow('updateRate', 'Güncelleme Hızı', 5, 60, 1), [WDL]));
        nodes.push(el('div', {
          class: 'lighting-mode-help',
          text: 'OpenRGB kare hızı OpenRGB kartındaki Güncelleme Hızı kaydırıcısındadır.',
        }));
      }
      nodes.push(wrap(rangeRow('saturation', 'Renk Doygunluğu', 0, 1.5, 0.01), [WDL, ORGB]));
    }

    const paletteModes = ['visualizer-sync', 'spectrum-bars', 'beat-pulse', 'ripple', 'ambient-fusion', 'device-flow'];
    if (paletteModes.includes(lighting.mode)) {
      nodes.push(wrap(optionRow('paletteSource', 'Renk Kaynağı', [
        { value: 'visualizer', label: 'Görselleştirici Bar Renkleri' },
        { value: 'background', label: 'Arka Plan Gradyanı' },
        { value: 'bands', label: 'Bas · Mid · Tiz Renkleri' },
        { value: 'rainbow', label: 'Tam Spektrum Gökkuşağı' },
        { value: 'custom', label: 'Birincil · İkincil Renk' },
        { value: 'milkdrop', label: 'MilkDrop Görüntüsü (Canlı)' },
      ]), [WDL, ORGB]));
    }

    if (lighting.paletteSource === 'custom' && paletteModes.includes(lighting.mode)) {
      nodes.push(wrap(colorRow('color', 'Birincil Renk'), [WDL, ORGB]));
      nodes.push(wrap(colorRow('color2', 'İkincil Renk'), [WDL, ORGB]));
    }

    const bandColorModes = ['spectrum-bars', 'band-zones', 'beat-pulse', 'ripple'];
    if (bandColorModes.includes(lighting.mode) || lighting.paletteSource === 'bands') {
      nodes.push(el('div', { class: 'lighting-subtitle', text: 'Frekans Renkleri ve Hassasiyet' }));
      nodes.push(wrap(colorRow('bassColor', 'Bas Rengi'), [WDL, ORGB]));
      nodes.push(wrap(colorRow('midColor', 'Orta Frekans Rengi'), [WDL, ORGB]));
      nodes.push(wrap(colorRow('trebleColor', 'Tiz Rengi'), [WDL, ORGB]));
      nodes.push(wrap(rangeRow('bassGain', 'Bas Hassasiyeti', 0, 3, 0.05), [WDL, ORGB]));
      nodes.push(wrap(rangeRow('midGain', 'Orta Frekans Hassasiyeti', 0, 3, 0.05), [WDL, ORGB]));
      nodes.push(wrap(rangeRow('trebleGain', 'Tiz Hassasiyeti', 0, 3, 0.05), [WDL, ORGB]));
      nodes.push(wrap(optionRow('bandResponse', 'Bant Tepki Profili', [
        { value: 'instant', label: 'Anlık / Katı' },
        { value: 'punchy', label: 'Vuruşlu / Sert' },
        { value: 'smooth', label: 'Yumuşak / Akıcı' },
      ]), [WDL, ORGB]));
      if (lighting.bandResponse !== 'instant') {
        nodes.push(wrap(rangeRow('bandAttack', 'Bant Saldırı Hızı', 0.15, 1, 0.01, true), [WDL, ORGB]));
        nodes.push(wrap(rangeRow('bandRelease', 'Bant Bırakma Hızı', 0.03, 0.65, 0.01, true), [WDL, ORGB]));
      }
      nodes.push(wrap(rangeRow('bandThreshold', 'Bant Gürültü Eşiği', 0, 0.8, 0.01, true), [WDL, ORGB]));
      nodes.push(wrap(rangeRow('bandHardness', 'Bant Sertliği', 0, 1, 0.01, true), [WDL, ORGB]));
      nodes.push(wrap(rangeRow('bandSeparation', 'Bant Ayrıştırma', 0, 1, 0.01, true), [WDL, ORGB]));
    }

    if (lighting.mode === 'visualizer-sync') {
      nodes.push(wrap(rangeRow('colorSpeed', 'Renk Akış Hızı', 0, 3, 0.02), [WDL, ORGB]));
      nodes.push(wrap(rangeRow('audioAcceleration', 'Sesle Hızlanma', 0, 3, 0.05), [WDL, ORGB]));
    }

    if (lighting.mode === 'spectrum-bars') {
      nodes.push(wrap(rangeRow('spectrumContrast', 'Bar Kontrastı', 0, 1, 0.01, true), [WDL, ORGB]));
      nodes.push(el('div', { class: 'lighting-mode-help', text: 'Her LED, görselleştiricide aynı konuma denk gelen barın renk ve yüksekliğini izler.' }));
    }

    if (lighting.mode === 'band-zones') {
      nodes.push(wrap(optionRow('bandPattern', 'Bant LED Deseni', [
        { value: 'zones', label: 'Bas · Mid · Tiz Bölgeleri' },
        { value: 'alternate', label: 'LED\'lerde Sırayla Bas · Mid · Tiz' },
        { value: 'mirror', label: 'Merkezden Aynalı Dağılım' },
        { value: 'dominant', label: 'En Güçlü Bant Tüm LED\'lerde' },
      ]), [WDL, ORGB]));
      nodes.push(wrap(rangeRow('zoneBlend', 'Bölge Geçiş Yumuşaklığı', 0, 1, 0.01, true), [WDL, ORGB]));
    }

    if (lighting.mode === 'background-sync') {
      nodes.push(wrap(rangeRow('colorSpeed', 'Arka Plan Akış Çarpanı', 0, 3, 0.02), [WDL, ORGB]));
    }

    const flashModes = ['background-sync', 'beat-pulse', 'ripple', 'ambient-fusion', 'device-flow'];
    if (flashModes.includes(lighting.mode)) {
      nodes.push(el('div', { class: 'lighting-subtitle', text: 'Vuruş ve Işık Patlaması' }));
      nodes.push(wrap(optionRow('triggerBand', 'Patlamayı Tetikleyen Bant', [
        { value: 'bass', label: 'Bas' },
        { value: 'mid', label: 'Orta Frekans' },
        { value: 'treble', label: 'Tiz' },
        { value: 'level', label: 'Genel Ses Seviyesi' },
        { value: 'auto', label: 'En Güçlü Frekansı Otomatik Seç' },
      ]), [WDL, ORGB]));
      nodes.push(wrap(rangeRow('flashThreshold', 'Patlama Eşiği', 0.02, 0.98, 0.01, true), [WDL, ORGB]));
      nodes.push(wrap(rangeRow('flashStrength', 'Patlama Gücü', 0, 1.5, 0.01), [WDL, ORGB]));
      nodes.push(wrap(rangeRow('flashDecay', 'Patlama Sönümleme', 0.45, 0.995, 0.005), [WDL, ORGB]));
    }

    if (lighting.mode === 'ripple') {
      nodes.push(el('div', { class: 'lighting-subtitle', text: 'Dalga Hareketi' }));
      nodes.push(wrap(optionRow('rippleDirection', 'Dalga Yönü', [
        { value: 'forward', label: 'İleri' },
        { value: 'reverse', label: 'Geri' },
        { value: 'alternate', label: 'Her Vuruşta Yön Değiştir' },
      ]), [WDL, ORGB]));
      nodes.push(wrap(rangeRow('rippleSpeed', 'Dalga Hızı', 0.05, 3, 0.05), [WDL, ORGB]));
      nodes.push(wrap(rangeRow('rippleWidth', 'Dalga Genişliği', 0.03, 0.6, 0.01), [WDL, ORGB]));
    }

    if (lighting.mode === 'ambient-fusion') {
      nodes.push(wrap(rangeRow('fusionMix', 'Arka Plan Karışım Oranı', 0, 1, 0.01, true), [WDL, ORGB]));
      nodes.push(wrap(rangeRow('spectrumContrast', 'Bar Kontrastı', 0, 1, 0.01, true), [WDL, ORGB]));
    }

    if (lighting.mode === 'device-flow') {
      nodes.push(wrap(rangeRow('flowSpeed', 'Aygıtlar Arası Akış Hızı', 0, 3, 0.02), [WDL, ORGB]));
      nodes.push(wrap(rangeRow('audioAcceleration', 'Sesle Akış Hızlanması', 0, 3, 0.05), [WDL, ORGB]));
    }

    if (lighting.mode === 'rainbow') {
      nodes.push(el('div', { class: 'lighting-subtitle', text: 'Rainbow Ayarları' }));
      nodes.push(wrap(optionRow('rainbowStyle', 'Rainbow Dağıtımı', [
        { value: 'ordered', label: 'LED\'lerde Sıralı Gökkuşağı' },
        { value: 'single', label: 'Tüm LED\'lerde Aynı Ton' },
      ]), [WDL, ORGB]));
      nodes.push(wrap(optionRow('rainbowAudioBand', 'Parlaklığa Tepki Veren Ses', [
        { value: 'level', label: 'Genel Ses Seviyesi' },
        { value: 'bass', label: 'Bas' },
        { value: 'mid', label: 'Orta Frekans' },
        { value: 'treble', label: 'Tiz' },
        { value: 'auto', label: 'En Güçlü Frekans' },
      ]), [WDL, ORGB]));
      nodes.push(wrap(rangeRow('rainbowSpeed', 'Rainbow Akış Hızı', 0.05, 3, 0.05), [WDL, ORGB]));
      nodes.push(wrap(rangeRow('rainbowSpread', 'Rainbow Renk Yayılımı', 0.1, 4, 0.05), [WDL, ORGB]));
      nodes.push(wrap(rangeRow('rainbowBaseBrightness', 'Rainbow Taban Parlaklığı', 0.02, 1, 0.01, true), [WDL, ORGB]));
      nodes.push(wrap(rangeRow('rainbowAudioBrightness', 'Sese Göre Parlaklık Gücü', 0, 1.5, 0.01), [WDL, ORGB]));
    }

    if (lighting.mode === 'threshold-background-burst') {
      nodes.push(el('div', { class: 'lighting-subtitle', text: 'Eşik Tetiklemeli Patlama Ayarları' }));
      nodes.push(wrap(optionRow('thresholdBurstSource', 'İzlenecek Tek Ses Kaynağı', [
        { value: 'bass', label: 'Bas' },
        { value: 'mid', label: 'Orta Frekans' },
        { value: 'treble', label: 'Tiz' },
        { value: 'level', label: 'Genel Ses Seviyesi' },
        { value: 'auto', label: 'En Güçlü Frekans' },
      ]), [WDL, ORGB]));
      nodes.push(wrap(optionRow('thresholdBurstMode', 'Eşik Üstü Davranış', [
        { value: 'pulse', label: 'Yalnızca Darbe / Patlama' },
        { value: 'proportional', label: 'Eşik Üstünde Orantılı Parlama' },
        { value: 'hybrid', label: 'Darbe + Orantılı Parlama' },
      ]), [WDL, ORGB]));
      nodes.push(wrap(rangeRow('thresholdBurstThreshold', 'Tetikleme Eşiği', 0.01, 0.99, 0.01, true), [WDL, ORGB]));
      nodes.push(wrap(rangeRow('thresholdBurstStrength', 'Eşik Üstü Patlama Gücü', 0, 2, 0.01), [WDL, ORGB]));
      nodes.push(wrap(rangeRow('thresholdBurstBaseBrightness', 'Eşik Altı Taban Işığı', 0, 0.5, 0.01, true), [WDL, ORGB]));
      if (lighting.thresholdBurstMode !== 'proportional') {
        nodes.push(wrap(rangeRow('thresholdBurstDecay', 'Patlama Sönümleme', 0.45, 0.995, 0.005), [WDL, ORGB]));
        nodes.push(wrap(rangeRow('thresholdBurstCooldown', 'Darbeler Arası Süre (ms)', 0, 1000, 10), [WDL, ORGB]));
      }
      nodes.push(wrap(optionRow('thresholdBurstColorPosition', 'Arka Plan Renk Eşleme', [
        { value: 'source', label: 'Seçilen Frekans Bölgesinin Rengi' },
        { value: 'center', label: 'Arka Plan Merkez Rengi' },
        { value: 'spread', label: 'Arka Plan Renklerini LED\'lere Yay' },
      ]), [WDL, ORGB]));
    }

    return el('div', { class: 'lighting-general-panel' }, nodes);
  }

  const api = { panel };
  if (typeof window !== 'undefined') window.SVLightingGeneral = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})();
