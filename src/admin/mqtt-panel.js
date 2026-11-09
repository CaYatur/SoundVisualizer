/*
 * SoundVisualizer — CaYaDev Ses Görselleştirici
 * Copyright (c) 2026 Çağan Turgut (CaYatur) — CaYaDev, https://cayadev.com
 * https://github.com/CaYatur/SoundVisualizer
 * SPDX-License-Identifier: MIT
 */
'use strict';
/* MQTT / Home Assistant kartı. Varsayılan kapalı; aracı (broker) adresi
   kullanıcı yazar. Komut dinleme ayrı bir anahtardır (varsayılan kapalı):
   kapalıyken uygulama yalnız durum yayınlar. Metinler Türkçe, İngilizcesi
   i18n sözlüğünde. */
(function () {
  const P = () => window.SVPanel;
  const T = (s) => (window.SVI18n && window.SVI18n.t ? window.SVI18n.t(s) : s);

  let st = { connected: false, error: '' };
  let watching = false;

  function watch() {
    if (watching || !window.api || !window.api.mqttStatus) return;
    watching = true;
    if (window.api.onMqttStatus) window.api.onMqttStatus((s) => { if (s) { st = s; if (P()) P().rerender(); } });
    window.api.mqttStatus().then((s) => { if (s) st = s; }).catch(() => {});
  }

  function statusNode(m) {
    const el = P().el;
    const node = el('div', { class: 'studio-status ' + (st.connected ? 'ok' : st.error ? 'err' : '') });
    if (!m.enabled) node.appendChild(el('span', { text: 'Kapalı' }));
    else if (!m.host) node.appendChild(el('span', { icon: 'x', text: 'Aracı adresi yok' }));
    else if (st.connected) node.appendChild(el('span', { icon: 'check', text: 'Bağlı' }));
    else if (st.error) node.appendChild(el('span', { icon: 'x', text: T('Bağlanamadı') + ': ' + st.error }));
    else node.appendChild(el('span', { text: 'Bağlanıyor…' }));
    return node;
  }

  function textRow(label, obj, key, opts) {
    const o = opts || {};
    const el = P().el;
    return P().row(T(label), el('input', {
      class: 'p-in wide', type: o.type || 'text', value: obj[key] == null ? '' : String(obj[key]),
      placeholder: o.placeholder || '', autocomplete: 'off', spellcheck: 'false',
      onchange: (e) => {
        let v = String(e.target.value || '');
        if (o.number) {
          const n = Math.round(Number(v));
          v = Number.isInteger(n) && n > 0 && n < 65536 ? n : obj[key];
        } else {
          v = o.raw ? v.slice(0, 256) : v.trim().slice(0, o.max || 255);
        }
        obj[key] = v;
        P().push(true);
        P().rerender();
      },
    }));
  }

  function panel() {
    watch();
    const el = P().el;
    const cfg = P().cfg();
    const m = cfg.mqtt || (cfg.mqtt = window.SV.defaultConfig().mqtt);
    const nodes = [P().moduleHead({
      id: 'mqtt', title: 'MQTT / Home Assistant', on: !!m.enabled, error: !!(m.enabled && st.error && !st.connected),
      status: statusNode(m), start: 'Bağlan', stop: 'Bağlantıyı Kes',
      toggle: (next) => {
        m.enabled = next;
        st = { connected: false, error: '' };
        P().push(true);
        P().rerender();
      },
    })];
    nodes.push(textRow('Aracı Adresi', m, 'host', { placeholder: '192.168.1.10' }));
    nodes.push(textRow('Port', m, 'port', { type: 'number', number: true }));
    nodes.push(P().toggle(T('TLS (şifreli bağlantı)'), 'mqtt.tls'));
    nodes.push(textRow('Kullanıcı Adı', m, 'username', { max: 128 }));
    nodes.push(textRow('Parola', m, 'password', { type: 'password', raw: true }));
    nodes.push(textRow('Konu Kökü', m, 'baseTopic', { placeholder: 'soundvisualizer', max: 64 }));
    nodes.push(P().toggle(T('Home Assistant keşfi'), 'mqtt.discovery', { rebuild: true }));
    if (m.discovery !== false) nodes.push(textRow('Keşif Öneki', m, 'discoveryPrefix', { placeholder: 'homeassistant', max: 64 }));
    nodes.push(P().toggle(T('Komutları kabul et'), 'mqtt.allowControl', { rebuild: true }));
    nodes.push(el('div', { class: 'studio-note dim-hint', text: T('Durum (karartma, Auto VJ, tempo, çalan parça, sahne, kip, opaklık) <kök>/state/… konularına yayınlanır. "Komutları kabul et" açıkken <kök>/set/blackout, autovj, scene, visualizer ve opacity dinlenir ve OSC girişiyle aynı yoldan uygulanır. Aracıdaki herkes sahneyi değiştirebileceği için yalnız güvendiğiniz bir aracıda açın.') }));
    return el('div', { class: 'mqtt-panel' }, nodes);
  }

  const api = { panel };
  if (typeof window !== 'undefined') window.SVMqttPanel = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})();
