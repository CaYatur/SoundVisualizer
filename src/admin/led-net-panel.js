/*
 * SoundVisualizer — CaYaDev Ses Görselleştirici
 * Copyright (c) 2026 Çağan Turgut (CaYatur) — CaYaDev, https://cayadev.com
 * https://github.com/CaYatur/SoundVisualizer
 * SPDX-License-Identifier: MIT
 */
'use strict';
/* Ağ LED çıkışları paneli: sACN (E1.31), WLED (DDP) ve WLED ses senkronu.
   Üçü de varsayılan kapalı; açma/kapama ana süreçte lednet:sync ile
   uygulanır. Metinler Türkçe yazılır, İngilizcesi i18n sözlüğünde. */
(function () {
  const P = () => window.SVPanel;
  const T = (s) => (window.SVI18n && window.SVI18n.t ? window.SVI18n.t(s) : s);

  const MODES = [
    { value: 'palette', label: 'Sahne Paleti' },
    { value: 'bands', label: 'Frekans Bantları' },
    { value: 'spectrum', label: 'Kayan Spektrum' },
    { value: 'single', label: 'Tek Renk' },
    { value: 'matrix', label: 'Matris' },
  ];

  let st = { sacn: {}, wled: {}, wledSync: {} };
  let watching = false;
  let found = [];
  let infoText = '';

  function watch() {
    if (watching || !window.api || !window.api.ledNetStatus) return;
    watching = true;
    window.api.onLedNetStatus((s) => { if (s) st = s; });
    window.api.ledNetStatus().then((s) => { if (s) st = s; }).catch(() => {});
  }

  async function sync() {
    if (window.api && window.api.ledNetSync) {
      const s = await window.api.ledNetSync();
      if (s) st = s;
    }
  }

  function statusNode(s) {
    const el = P().el;
    const x = s || {};
    const node = el('div', { class: 'studio-status ' + (x.running ? 'ok' : x.error ? 'err' : '') });
    if (x.running) {
      node.appendChild(el('span', { icon: 'check' }));
      node.appendChild(el('span', { text: 'Yayında' }));
      node.appendChild(el('span', { class: 'st-sep', 'aria-hidden': 'true', text: ' · ' }));
      node.appendChild(el('span', { class: 'st-num', text: String(x.packets || 0) + ' ' }));
      node.appendChild(el('span', { text: 'paket' }));
    } else if (x.error === 'no-host') {
      node.appendChild(el('span', { icon: 'x', text: 'Adres yok' }));
    } else if (x.error) {
      node.appendChild(el('span', { icon: 'x', text: x.error }));
    } else {
      node.appendChild(el('span', { text: 'Kapalı' }));
    }
    return node;
  }

  function head(id, title, obj, s) {
    return P().moduleHead({
      id, title, on: !!obj.enabled, error: !!(s && s.error), status: statusNode(s),
      start: 'Göndermeyi Başlat', stop: 'Göndermeyi Durdur',
      toggle: async (next) => {
        obj.enabled = next;
        P().push(true);
        await sync();
        P().rerender();
      },
    });
  }

  function hostRow(label, obj, placeholder) {
    const el = P().el;
    return P().row(label, el('input', {
      class: 'p-in wide', type: 'text', value: obj.host || '', placeholder: placeholder || '',
      onchange: async (e) => {
        obj.host = String(e.target.value || '').trim().slice(0, 64);
        P().push(true);
        await sync();
        P().rerender();
      },
    }));
  }

  function colorRows(nodes, prefix, obj) {
    nodes.push(P().segment('Renk Kaynağı', prefix + '.mode', MODES, { rebuild: true }));
    if (obj.mode === 'single') nodes.push(P().color('Renk', prefix + '.color'));
    if (obj.mode === 'matrix' && window.SVScenePanels && window.SVScenePanels.matrixDimSliders) {
      const n = prefix === 'wled'
        ? Math.max(1, Math.min(4096, obj.ledCount | 0 || 60))
        : Math.max(1, Math.min(170, obj.fixtures | 0 || 8));
      window.SVScenePanels.matrixDimSliders(obj, n).forEach((node) => nodes.push(node));
    }
    nodes.push(P().slider('Parlaklık', prefix + '.brightness', { step: 0.02, percent: true }));
  }

  function sacnPanel() {
    watch();
    const el = P().el;
    const cfg = P().cfg();
    const a = cfg.sacn || (cfg.sacn = window.SV.defaultConfig().sacn);
    const nodes = [head('sacn', 'sACN (E1.31) Çıkışı', a, st.sacn)];
    if (a.enabled) {
      nodes.push(hostRow('Hedef Adres', a, T('Boş = multicast')));
      nodes.push(P().slider('Evren (Universe)', 'sacn.universe', { min: 1, max: 512, step: 1, fmt: (v) => String(Math.round(v)) }));
      nodes.push(P().slider('Öncelik', 'sacn.priority', { min: 0, max: 200, step: 1, fmt: (v) => String(Math.round(v)) }));
      nodes.push(P().slider('Başlangıç Kanalı', 'sacn.startChannel', { min: 1, max: 512, step: 1, fmt: (v) => String(Math.round(v)) }));
      nodes.push(P().slider('Aygıt Sayısı', 'sacn.fixtures', { min: 1, max: 64, step: 1, fmt: (v) => String(Math.round(v)) }));
      nodes.push(P().segment('Aygıt Kanalları', 'sacn.channelsPerFixture', [
        { value: 3, label: 'RGB' },
        { value: 4, label: 'RGBW' },
      ]));
      colorRows(nodes, 'sacn', a);
      nodes.push(P().slider('Gönderim Hızı', 'sacn.fps', { min: 1, max: 44, step: 1, fmt: (v) => Math.round(v) + ' Hz' }));
      nodes.push(el('div', { class: 'studio-note dim-hint', text: 'Adres boşsa paket evrenin multicast adresine (239.255.x.x) gider; tek bir düğüm için IP adresini yazın. Kanal düzeni Art-Net ile aynıdır.' }));
    } else {
      nodes.push(el('div', { class: 'studio-note', text: 'Sahne renklerini sACN (E1.31) ile ışık konsollarına, DMX düğümlerine ve WLED gibi aygıtlara yollar. Art-Net ile birlikte ya da onun yerine kullanılabilir.' }));
    }
    return el('div', { class: 'lednet-panel' }, nodes);
  }

  function wledPanel() {
    watch();
    const el = P().el;
    const cfg = P().cfg();
    const w = cfg.wled || (cfg.wled = window.SV.defaultConfig().wled);
    const nodes = [head('wled', 'WLED (DDP) Çıkışı', w, st.wled)];
    nodes.push(hostRow('WLED Adresi', w, '192.168.1.50'));

    const findBtn = el('button', {
      class: 'btn ghost small', type: 'button', icon: 'share', text: 'Ağda WLED Bul',
      onclick: async (e) => {
        if (!window.api || !window.api.wledDiscover) return;
        e.currentTarget.disabled = true;
        const r = await window.api.wledDiscover().catch(() => null);
        found = (r && r.devices) || [];
        if (!found.length) P().toast(T('Ağda WLED bulunamadı.'), 'warn');
        P().rerender();
      },
    });
    const infoBtn = el('button', {
      class: 'btn ghost small', type: 'button', text: 'LED Sayısını Al',
      disabled: !w.host,
      onclick: async () => {
        if (!window.api || !window.api.wledInfo || !w.host) return;
        const r = await window.api.wledInfo(w.host).catch(() => null);
        if (r && r.ok && r.leds > 0) {
          w.ledCount = Math.min(1500, r.leds);
          infoText = (r.name || 'WLED') + (r.version ? ' ' + r.version : '') + ' · ' + r.leds + ' LED';
          P().push(true);
        } else {
          infoText = '';
          P().toast(T('WLED bilgisi alınamadı.'), 'warn');
        }
        P().rerender();
      },
    });
    nodes.push(el('div', { class: 'map-row', style: 'gap:8px;flex-wrap:wrap;align-items:center' }, [findBtn, infoBtn]));
    if (infoText) nodes.push(el('div', { class: 'note', text: infoText }));
    if (found.length) {
      nodes.push(el('div', { class: 'map-list' }, found.map((d) => el('div', { class: 'map-row' }, [
        el('span', { text: d.name + ' · ' + d.host }),
        el('button', {
          class: 'btn ghost small', type: 'button', text: 'Kullan',
          onclick: async () => {
            w.host = d.host;
            P().push(true);
            await sync();
            P().rerender();
          },
        }),
      ]))));
    }
    if (w.enabled) {
      nodes.push(P().slider('LED Sayısı', 'wled.ledCount', { min: 1, max: 1500, step: 1, fmt: (v) => String(Math.round(v)) }));
      colorRows(nodes, 'wled', w);
      nodes.push(P().slider('Gönderim Hızı', 'wled.fps', { min: 1, max: 60, step: 1, fmt: (v) => Math.round(v) + ' Hz' }));
    }
    nodes.push(el('div', { class: 'studio-note dim-hint', text: 'WLED piksellerini DDP (UDP 4048) ile doğrudan sürer; Art-Net evren ayarı gerekmez. Ağ yalnız "Ağda WLED Bul" ya da "LED Sayısını Al" düğmesine basınca taranır.' }));
    return el('div', { class: 'lednet-panel' }, nodes);
  }

  function wledSyncPanel() {
    watch();
    const el = P().el;
    const cfg = P().cfg();
    const s = cfg.wledSync || (cfg.wledSync = window.SV.defaultConfig().wledSync);
    const nodes = [head('wledSync', 'WLED Ses Senkronu', s, st.wledSync)];
    if (s.enabled) {
      nodes.push(hostRow('Hedef Adres', s, '239.0.0.1'));
      nodes.push(P().slider('Gönderim Hızı', 'wledSync.fps', { min: 5, max: 60, step: 1, fmt: (v) => Math.round(v) + ' Hz' }));
    }
    nodes.push(el('div', { class: 'studio-note dim-hint', text: 'Ses seviyesini, 16 frekans bandını ve vuruşları WLED Audio Sync (v2) paketi olarak yayınlar. Ses tepkili WLED aygıtında Audio Sync kipini "Receive" yapın; aygıt kendi mikrofonu yerine bu analizi kullanır.' }));
    return el('div', { class: 'lednet-panel' }, nodes);
  }

  const api = { sacnPanel, wledPanel, wledSyncPanel };
  if (typeof window !== 'undefined') window.SVLedNetPanel = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})();
