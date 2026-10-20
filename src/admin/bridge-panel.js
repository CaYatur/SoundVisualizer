/*
 * SoundVisualizer — CaYaDev Ses Görselleştirici
 * Copyright (c) 2026 Çağan Turgut (CaYatur) — CaYaDev, https://cayadev.com
 * https://github.com/CaYatur/SoundVisualizer
 * SPDX-License-Identifier: MIT
 */
'use strict';
/* SES KÖPRÜSÜ paneli (#813). İş ana süreçte (main/audio-bridge.js,
   main/bridge-input.js); burada gönderme, alma, parola, adres, yedek giriş,
   "yalnız köprü" kipi ve ölçülen gecikme / saat farkı. */
(function () {
  const P = () => window.SVPanel;
  const tr = (s) => (window.SVI18n && window.SVI18n.t ? window.SVI18n.t(s) : s);
  let status = null;
  let started = false;
  let lastDraw = 0;

  const RX_TEXT = {
    idle: 'Kapalı',
    searching: 'Ağda köprü aranıyor',
    connecting: 'Köprüye bağlanılıyor',
    connected: 'Köprüye bağlı',
    error: 'Bağlanamadı',
  };
  const INPUT_TEXT = {
    waiting: 'Köprüden ses bekleniyor',
    bridge: 'Ses köprüden geliyor',
    fallback: 'Köprü sessiz: yerel giriş kullanılıyor',
  };
  const ERR_TEXT = {
    auth: 'Eşleşme parolası tutmuyor.',
    version: 'Köprünün sürümü farklı; iki makinede aynı sürümü kullanın.',
    timeout: 'Köprü yanıt vermedi.',
    ECONNREFUSED: 'Bu adreste çalışan bir köprü yok.',
    EADDRINUSE: 'Köprü portu kullanımda; başka bir port seçin.',
  };
  const REASON_TEXT = { secret: 'parola farklı', clock: 'saat farkı çok büyük', version: 'sürüm farklı' };

  function cfg() {
    const c = P().cfg();
    if (!c.bridge || typeof c.bridge !== 'object') c.bridge = {};
    return c.bridge;
  }
  function ms(v) { return v == null ? '—' : (Math.round(v * 10) / 10) + ' ms'; }

  function toggleRow(label, value, onSet) {
    const el = P().el;
    const inp = el('input', { type: 'checkbox' });
    inp.checked = !!value;
    inp.addEventListener('change', () => onSet(inp.checked));
    return P().row(label, inp);
  }
  function textRow(label, value, onSet, attrs) {
    const el = P().el;
    const inp = el('input', Object.assign({ class: 'p-in wide', type: 'text', value: value || '' }, attrs || {}));
    inp.addEventListener('change', () => onSet(inp.value.trim()));
    return P().row(label, inp);
  }
  function numRow(label, value, min, max, onSet) {
    const el = P().el;
    const inp = el('input', { class: 'num', type: 'number', min: String(min), max: String(max), step: '1' });
    inp.value = String(value);
    inp.addEventListener('change', () => {
      const v = Math.round(Number(inp.value));
      if (!Number.isFinite(v)) { inp.value = String(value); return; }
      onSet(Math.max(min, Math.min(max, v)));
    });
    return P().row(label, inp);
  }
  function kv(label, value, user) {
    const el = P().el;
    return el('div', { class: 'lay-file' }, [el('span', { text: label }), el('span', { text: ' ' }), el('strong', Object.assign({ text: String(value) }, user ? { 'data-user-text': '' } : {}))]);
  }

  function senderBox() {
    const el = P().el;
    const s = status && status.sender;
    if (!s) return null;
    const ok = s.listening && !s.error;
    const nodes = [el('div', { class: 'studio-status ' + (ok ? 'ok' : 'err'), role: 'status' }, [
      el('span', { icon: ok ? 'check' : 'warning' }),
      el('span', { text: ok ? 'Köprü yayında' : (ERR_TEXT[s.error] || 'Köprü açılamadı') }),
    ])];
    nodes.push(kv(tr('Köprünün adı') + ':', s.name || '—', true));
    nodes.push(kv(tr('Bağlı alıcı') + ':', s.clients || 0));
    if (s.dropped) nodes.push(kv(tr('Yavaş alıcıya atlanan kare') + ':', s.dropped));
    nodes.push(kv(tr('Yakalama') + ':', status.capturing ? tr('açık') : tr('kapalı (alıcı yok)')));
    return el('div', { class: 'bridge-send' }, nodes);
  }

  function receiverBox() {
    const el = P().el;
    const r = status && status.receiver;
    if (!r) return null;
    const inp = status.input || {};
    const good = r.state === 'connected' && inp.state === 'bridge';
    const nodes = [el('div', { class: 'studio-status ' + (good ? 'ok' : r.state === 'error' ? 'err' : 'warn'), role: 'status' }, [
      el('span', { icon: good ? 'check' : 'warning' }),
      el('span', { text: INPUT_TEXT[inp.state] || RX_TEXT[r.state] || r.state }),
    ])];
    nodes.push(kv(tr('Bağlantı') + ':', tr(RX_TEXT[r.state] || r.state)));
    if (r.host) nodes.push(kv(tr('Köprü') + ':', (r.name ? r.name + ' — ' : '') + r.host + ':' + r.port, true));
    if (r.error && ERR_TEXT[r.error]) nodes.push(el('div', { class: 'studio-note err', text: ERR_TEXT[r.error] }));
    nodes.push(kv(tr('Gidiş-dönüş') + ':', ms(r.rttMs)));
    nodes.push(kv(tr('Saat farkı') + ':', ms(r.offsetMs)));
    nodes.push(kv(tr('Karenin yaşı') + ':', ms(r.ageMs)));
    if (r.lost) nodes.push(kv(tr('Kayıp kare') + ':', r.lost));
    if (inp.switches) nodes.push(kv(tr('Giriş değişimi') + ':', inp.switches));
    if (status.meta && (status.meta.title || status.meta.artist)) {
      nodes.push(kv(tr('Köprüde çalan') + ':', [status.meta.artist, status.meta.title].filter(Boolean).join(' — '), true));
    }
    return el('div', { class: 'bridge-recv' }, nodes);
  }

  function foundBox(b) {
    const el = P().el;
    const list = (status && status.found) || [];
    if (!list.length) {
      return el('div', { class: 'studio-note dim-hint', text: 'Ağda köprü bulunamadı. Köprünün açık olduğundan ve güvenlik duvarının UDP 8742 ile köprü portuna izin verdiğinden emin olun; adresi elle de yazabilirsiniz.' });
    }
    const ul = el('ul', { class: 'red-diff' });
    list.forEach((f) => ul.appendChild(el('li', {}, [
      el('span', { text: f.name || f.id, 'data-user-text': '' }), el('span', { text: ' · ' }),
      el('span', { text: f.host + ':' + f.port, 'data-user-text': '' }), el('span', { text: ' · ' }),
      f.paired
        ? el('button', { class: 'btn small ghost', type: 'button', text: 'Bu Köprüyü Kullan', onclick: () => { b.host = f.host; b.port = f.port; P().push(true); P().rerender(); } })
        : el('span', { class: 'dim-hint', text: REASON_TEXT[f.reason] || 'eşleşmedi' }),
    ])));
    return el('div', { class: 'bridge-found' }, [el('div', { class: 'studio-note', text: 'Ağda bulunan köprüler:' }), ul]);
  }

  function panel() {
    const el = P().el;
    const b = cfg();
    const push = () => P().push(true);
    const nodes = [];
    if (status && status.only) {
      nodes.push(el('div', { class: 'studio-status ok', role: 'status' }, [el('span', { icon: 'wave' }), el('span', { text: 'Yalnız ses köprüsü kipi: görüntü çıkışı açılmaz' })]));
    }
    nodes.push(toggleRow('Bu Makinenin Sesini Köprüye Ver', b.send, (v) => { b.send = v; push(); P().rerender(); }));
    nodes.push(toggleRow('Ses Girişi: Ağ Köprüsü', b.receive, (v) => { b.receive = v; push(); P().rerender(); }));

    const secret = el('input', { class: 'p-in wide', type: 'text', value: b.secret || '', autocomplete: 'off', spellcheck: 'false', 'data-user-attr': '' });
    secret.addEventListener('change', () => { b.secret = secret.value.trim(); push(); });
    nodes.push(P().row('Eşleşme Parolası', el('div', { class: 'url-row' }, [
      secret,
      el('button', { class: 'btn small', type: 'button', icon: 'refresh', text: 'Yeni Parola', onclick: async () => { b.secret = await window.api.bridgeNewSecret(); push(); P().rerender(); } }),
    ])));
    if (status && status.problem === 'secret' && (b.send || b.receive || status.only)) {
      nodes.push(el('div', { class: 'studio-note err', text: 'Eşleşme parolası en az 16 karakter olmalı; köprünün ve alıcının parolası aynı olmalı.' }));
    }
    nodes.push(numRow('Köprü Portu', b.port || 8741, 1024, 65535, (v) => { b.port = v; push(); }));

    if (b.send || (status && status.only)) {
      nodes.push(textRow('Köprünün Adı', b.name, (v) => { b.name = v; push(); }, { placeholder: tr('Bilgisayarın adı'), 'data-user-attr': '' }));
      const sb = senderBox();
      if (sb) nodes.push(sb);
    }
    if (b.receive && !(status && status.only)) {
      nodes.push(textRow('Köprünün Adresi', b.host, (v) => { b.host = v; push(); }, { placeholder: tr('Boş: ağda kendiliğinden bulunur'), 'data-user-attr': '' }));
      nodes.push(toggleRow('Köprü Susarsa Yerel Girişe Dön', b.fallback !== false, (v) => { b.fallback = v; push(); }));
      const rb = receiverBox();
      if (rb) nodes.push(rb);
      nodes.push(foundBox(b));
    }
    nodes.push(toggleRow('Yalnız Ses Köprüsü (sonraki açılışta)', b.only, (v) => { b.only = v; push(); }));
    nodes.push(el('div', { class: 'studio-note dim-hint', text: 'Yalnız köprü kipinde uygulama görüntü çıkışı, ışık ve yayın açmaz, GPU kullanmaz; sistem tepsisinde durur. Aynı makinede olağan uygulamanın yanında çalıştırmak için uygulamayı --bridge ile açın: ayarlarını ayrı bir klasörde tutar.' }));
    nodes.push(el('div', { class: 'studio-note dim-hint', text: 'Köprü yakalama yardımcısının analiz karelerini (tayf ve dalga biçimi) ve çalan parça bilgisini gönderir; iki makine aynı sesi aynı sayılarla çözümler. Dinlenebilir ses gönderilmez.' }));
    return el('div', { class: 'bridge-panel' }, nodes);
  }

  async function init() {
    if (started || !window.api || !window.api.bridgeStatus) return;
    started = true;
    const sig = (x) => JSON.stringify(x ? [x.problem, x.sender && [x.sender.listening, x.sender.clients, x.sender.error], x.receiver && [x.receiver.state, x.receiver.host, x.receiver.error], x.input && x.input.state, (x.found || []).map((f) => f.id + f.paired + f.host), x.capturing] : null);
    window.api.onBridgeStatus((s) => {
      const prev = sig(status);
      status = s || null;
      const panelOpen = document.querySelector('.bridge-panel');
      if (!panelOpen) return;
      // Yazı yazılırken yeniden çizim odağı çalmasın
      const a = document.activeElement;
      if (a && panelOpen.contains(a) && (a.tagName === 'INPUT' || a.tagName === 'SELECT')) return;
      // Ölçümler (gecikme, saat farkı) her durumda; yapı değişince tam çizim
      if (prev === sig(status) && Date.now() - lastDraw < 1000) return;
      lastDraw = Date.now();
      P().rerender();
    });
    try { status = await window.api.bridgeStatus(); } catch { /* */ }
  }

  window.SVBridgePanel = { panel, init, RX_TEXT, INPUT_TEXT, ERR_TEXT, REASON_TEXT };
})();
