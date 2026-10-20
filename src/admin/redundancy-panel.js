/*
 * SoundVisualizer — CaYaDev Ses Görselleştirici
 * Copyright (c) 2026 Çağan Turgut (CaYatur) — CaYaDev, https://cayadev.com
 * https://github.com/CaYatur/SoundVisualizer
 * SPDX-License-Identifier: MIT
 */
'use strict';
/* YEDEKLİLİK paneli (#540). İşin kendisi ana süreçte (main/redundancy.js);
   burada rol, eşleşme parolası, adres, eşik, devralma biçimi ve durum.
   Yetkiyi elle alma/bırakma ağ ayarına dokunmadan yapılır (#546). */
(function () {
  const P = () => window.SVPanel;
  let status = { role: 'off' };
  let started = false;

  const STATE_TEXT = {
    connecting: 'Birincile bağlanılıyor',
    following: 'Birincili izliyor',
    lost: 'Birincil yanıt vermiyor: elle devralma bekleniyor',
    active: 'Yetki bu makinede',
  };
  const PROBLEM_TEXT = {
    secret: 'Eşleşme parolası en az 16 karakter olmalı.',
    host: 'Birincilin adresini yazın.',
  };

  function red() {
    const cfg = P().cfg();
    if (!cfg.redundancy || typeof cfg.redundancy !== 'object') cfg.redundancy = {};
    return cfg.redundancy;
  }

  function textRow(label, value, onSet, attrs) {
    const el = P().el;
    const inp = el('input', Object.assign({ class: 'p-in wide', type: 'text', value: value || '' }, attrs || {}));
    inp.addEventListener('change', () => onSet(inp.value.trim()));
    return P().row(label, inp);
  }
  function numRow(label, value, min, max, step, onSet) {
    const el = P().el;
    const inp = el('input', { class: 'num', type: 'number', min: String(min), max: String(max), step: String(step) });
    inp.value = String(value);
    inp.addEventListener('change', () => {
      const v = Number(inp.value);
      if (!Number.isFinite(v)) { inp.value = String(value); return; }
      onSet(Math.max(min, Math.min(max, Math.round(v))));
    });
    return P().row(label, inp);
  }
  function selectRow(label, options, value, onSet) {
    const el = P().el;
    const sel = el('select', { class: 'sel-ctrl' });
    options.forEach(([v, t]) => { const o = el('option', { value: v, text: t }); if (v === value) o.selected = true; sel.appendChild(o); });
    sel.addEventListener('change', () => onSet(sel.value));
    return P().row(label, sel);
  }

  function statusBox() {
    const el = P().el;
    const box = el('div', { class: 'studio-status', role: 'status' });
    if (status.problem) {
      box.classList.add('err');
      box.appendChild(el('span', { icon: 'x' }));
      box.appendChild(el('span', { text: PROBLEM_TEXT[status.problem] || status.problem }));
      return box;
    }
    if (status.role === 'primary') {
      box.classList.add(status.peers ? 'ok' : '');
      box.appendChild(el('span', { icon: status.peers ? 'check' : 'broadcast' }));
      box.appendChild(el('span', { text: status.peers ? 'Yedek bağlı' : 'Yedek bekleniyor' }));
      if (status.peerState === 'active') {
        box.appendChild(el('span', { class: 'st-sep', 'aria-hidden': 'true', text: ' · ' }));
        box.appendChild(el('span', { text: 'Yedek yetkiyi aldı' }));
      }
      if (!status.serverRunning) {
        box.appendChild(el('span', { class: 'st-sep', 'aria-hidden': 'true', text: ' · ' }));
        box.appendChild(el('span', { text: 'Yayın sunucusu açılamadı' }));
      }
      return box;
    }
    if (status.role === 'backup') {
      if (status.state === 'following') box.classList.add('ok');
      if (status.state === 'lost') box.classList.add('err');
      box.appendChild(el('span', { icon: status.state === 'active' ? 'bolt' : status.state === 'following' ? 'check' : 'broadcast' }));
      box.appendChild(el('span', { text: STATE_TEXT[status.state] || 'Kapalı' }));
      if (status.state === 'active' && status.takenBy) {
        box.appendChild(el('span', { class: 'st-sep', 'aria-hidden': 'true', text: ' · ' }));
        box.appendChild(el('span', { text: status.takenBy === 'auto' ? 'kendiliğinden' : 'elle' }));
      }
      return box;
    }
    box.appendChild(el('span', { text: 'Kapalı' }));
    return box;
  }

  async function act(which) {
    try {
      status = which === 'takeover' ? await window.api.redundancyTakeover() : await window.api.redundancyRelease();
    } catch { /* ana süreç yanıt vermedi */ }
    P().rerender();
  }

  function panel() {
    const el = P().el;
    const r = red();
    const role = r.role || 'off';
    const nodes = [];
    const push = () => P().push(true);
    nodes.push(selectRow('Bu Makinenin Rolü', [['off', 'Kapalı'], ['primary', 'Birincil'], ['backup', 'Yedek']], role,
      (v) => { r.role = v; push(); P().rerender(); }));
    nodes.push(statusBox());
    if (role === 'off') {
      nodes.push(el('div', { class: 'studio-note dim-hint', text: 'İki makineyle sıcak yedek: yedek aynı sahneyi sürekli çizer, birincil düşerse yetkiyi alır. Ekran kararmaz; hangi çıkışın seyirciye gittiğini görüntü anahtarlayıcısı seçer.' }));
      return el('div', { class: 'redundancy-panel' }, nodes);
    }

    // Eşleşme parolası: iki makinede aynı
    const secret = el('input', { class: 'p-in wide', type: 'text', value: r.secret || '', autocomplete: 'off', spellcheck: 'false', 'data-user-attr': '' });
    secret.addEventListener('change', () => { r.secret = secret.value.trim(); push(); });
    nodes.push(P().row('Eşleşme Parolası', el('div', { class: 'url-row' }, [
      secret,
      el('button', {
        class: 'btn small', type: 'button', icon: 'refresh', text: 'Yeni Parola',
        onclick: async () => { r.secret = await window.api.redundancyNewSecret(); push(); P().rerender(); },
      }),
    ])));

    if (role === 'backup') {
      nodes.push(textRow('Birincilin Adresi', r.host, (v) => { r.host = v; push(); }, { placeholder: '192.168.1.20', 'data-user-attr': '' }));
      nodes.push(numRow('Birincilin Portu', r.port || 8722, 1024, 65535, 1, (v) => { r.port = v; push(); }));
      nodes.push(numRow('Kalp Atışı (ms)', r.heartbeatMs || 250, 50, 5000, 10, (v) => { r.heartbeatMs = v; push(); }));
      nodes.push(numRow('Kayıp Eşiği (ms)', r.timeoutMs || 1500, 150, 60000, 50, (v) => { r.timeoutMs = v; push(); }));
      nodes.push(selectRow('Devralma', [['auto', 'Kendiliğinden'], ['manual', 'Elle']], r.takeover === 'manual' ? 'manual' : 'auto',
        (v) => { r.takeover = v; push(); }));
      const active = status.state === 'active';
      nodes.push(el('div', { class: 'lay-file' }, [
        el('button', { class: 'btn small' + (active ? '' : ' primary'), type: 'button', icon: 'bolt', text: 'Yetkiyi Al', disabled: active ? 'disabled' : null, onclick: () => act('takeover') }),
        el('button', { class: 'btn small ghost', type: 'button', icon: 'reset', text: 'Yetkiyi Bırak', disabled: active ? null : 'disabled', onclick: () => act('release') }),
      ]));
      nodes.push(el('div', { class: 'studio-note dim-hint', text: 'Yedek izlerken sahne birincilden gelir; burada yapılan sahne değişikliği birincilin bir sonraki değişikliğiyle ezilir. Yetkiyi alan yedek, birincil geri gelse de "Yetkiyi Bırak" denene kadar yetkide kalır.' }));
    } else {
      nodes.push(el('div', { class: 'studio-note dim-hint', text: 'Yedek bu bilgisayarın yayın sunucusuna bağlanır. Yedek başka bir bilgisayardaysa Yayın Çıkışı\'nda ağa açmayı etkinleştirin; yedeğe bu bilgisayarın adresini ve yayın portunu yazın.' }));
    }
    nodes.push(el('div', { class: 'studio-note dim-hint', text: 'Aktarılan yalnız görüntü ve gösteri: sahne, katmanlar, kayıtlı sahneler, zaman çizelgesi, Clip Deck. Ses aygıtı, ekranlar, ağ, ışık ve dışa aktarım ayarları her makinenin kendisinde kalır. Video ve logo dosyaları iki makinede aynı yerde olmalı.' }));
    return el('div', { class: 'redundancy-panel' }, nodes);
  }

  async function init() {
    if (started || !window.api || !window.api.redundancyStatus) return;
    started = true;
    window.api.onRedundancyStatus((s) => {
      const prev = JSON.stringify([status.role, status.state, status.peers, status.peerState, status.problem, status.serverRunning]);
      status = s || { role: 'off' };
      window.SVRedundancyState = status;
      const next = JSON.stringify([status.role, status.state, status.peers, status.peerState, status.problem, status.serverRunning]);
      if (prev !== next && document.querySelector('.redundancy-panel')) P().rerender();
    });
    try { status = await window.api.redundancyStatus(); window.SVRedundancyState = status; } catch { /* */ }
  }

  // Otomatik VJ gibi kendi karar veren işler: yedek birincili izlerken durur
  function following() {
    const s = window.SVRedundancyState;
    return !!(s && s.role === 'backup' && (s.state === 'following' || s.state === 'lost' || s.state === 'connecting') && !s.problem);
  }

  window.SVRedundancyPanel = { panel, init, following };
})();
