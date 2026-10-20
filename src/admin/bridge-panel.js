/*
 * SoundVisualizer — CaYaDev Ses Görselleştirici
 * Copyright (c) 2026 Çağan Turgut (CaYatur) — CaYaDev, https://cayadev.com
 * https://github.com/CaYatur/SoundVisualizer
 * SPDX-License-Identifier: MIT
 */
'use strict';
/* SES KÖPRÜSÜ kartı (#813). İş ana süreçte (main/audio-bridge.js,
   main/bridge-input.js). Kart diğer Ayarlar kartlarının düzeninde: üç grup
   (Kip, Bağlantı, Durum), etiket + denetim satırları, anahtarlar; durum
   ölçüm kutucukları olarak (bridge-view.js, köprü durum penceresiyle ortak).
   Uzun açıklamalar '?' yardımında. */
(function () {
  const P = () => window.SVPanel;
  const V = () => window.SVBridgeView;
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
  const el = (...a) => P().el(...a);

  /* Etiket + '?' (yardım etiketin yanında; tıklayınca satırın altında
     kısa açıklama). Diğer kartlardaki gibi: etiket solda, denetim sağda. */
  function labelWithHelp(label, helpText) {
    const lbl = el('label', { class: 'lbl' }, [el('span', { class: 'lbl-t', text: label })]);
    if (!helpText) return { lbl, body: null };
    const body = V().helpBody(tr(helpText));
    lbl.appendChild(V().helpButton(body));
    return { lbl, body };
  }
  function switchRow(label, value, onSet, helpText) {
    const inp = el('input', { type: 'checkbox', 'aria-label': label });
    inp.checked = !!value;
    inp.addEventListener('change', () => onSet(inp.checked));
    const { lbl, body } = labelWithHelp(label, helpText);
    return el('div', { class: 'ctrl' }, [el('div', { class: 'row' }, [lbl, el('label', { class: 'switch' }, [inp, el('span', { class: 'track' })])]), body]);
  }
  function ctlRow(label, nodes, opts) {
    const o = opts || {};
    const { lbl, body } = labelWithHelp(label, o.help);
    return el('div', { class: 'ctrl' }, [
      el('div', { class: 'row br-stack' }, [lbl, el('div', { class: 'br-ctl' }, nodes)]),
      body,
      o.sub ? el('div', { class: 'br-sub', text: o.sub }) : null,
    ]);
  }
  function textInput(value, onSet, attrs) {
    const inp = el('input', Object.assign({ class: 'p-in', type: 'text', value: value || '' }, attrs || {}));
    inp.addEventListener('change', () => onSet(inp.value.trim()));
    return inp;
  }
  function numInput(value, min, max, onSet) {
    const inp = el('input', { class: 'num p-in', type: 'number', min: String(min), max: String(max), step: '1' });
    inp.value = String(value);
    inp.addEventListener('change', () => {
      const v = Math.round(Number(inp.value));
      if (!Number.isFinite(v)) { inp.value = String(value); return; }
      onSet(Math.max(min, Math.min(max, v)));
    });
    return inp;
  }
  function group(label, nodes, head) {
    const top = head ? el('div', { class: 'br-head' }, [el('div', { class: 'group-label', text: label }), head]) : el('div', { class: 'group-label', text: label });
    return el('div', { class: 'group' }, [top].concat(nodes.filter(Boolean)));
  }

  // Köprünün yakaladığı kaynak: tek seçim, açık etiketli (#813, Windows'ta karışıyordu)
  function captureSourceRow(push) {
    const c = P().cfg();
    if (!c.audio || typeof c.audio !== 'object') c.audio = {};
    const list = Array.isArray(c.audio.sources) && c.audio.sources.length ? c.audio.sources : ['default'];
    const cur = list[0];
    const sel = el('select', { class: 'p-in' });
    const opt = (value, label, user) => el('option', Object.assign({ value, text: label }, user ? { 'data-user-text': '' } : {}));
    sel.appendChild(opt('default', tr('Varsayılan çıkış (sistem sesi)')));
    const devs = (P().audioDevices ? P().audioDevices() : []).filter((d) => d && d.name);
    const outs = devs.filter((d) => d.kind === 'output');
    const ins = devs.filter((d) => d.kind !== 'output');
    const og = (label, arr) => { if (!arr.length) return; const g = el('optgroup', { label: tr(label) }); arr.forEach((d) => g.appendChild(opt(d.name, d.name, true))); sel.appendChild(g); };
    og('Çıkışlar (loopback)', outs);
    og('Girişler', ins);
    let multi = false;
    if (cur && typeof cur === 'object') { sel.appendChild(opt('__app', (cur.label || cur.match) + ' (' + tr('uygulama') + ')', true)); sel.value = '__app'; }
    else {
      if (cur !== 'default' && !devs.some((d) => d.name === cur)) sel.appendChild(opt(cur, cur + ' (' + tr('bulunamadı') + ')', true));
      sel.value = cur;
    }
    if (list.length > 1) multi = true;
    sel.addEventListener('change', () => { if (sel.value === '__app') return; c.audio.sources = [sel.value]; push(); P().rerender(); });
    return ctlRow('Köprünün Kaynağı', [sel], {
      sub: multi ? tr('Ses Kaynakları\'nda birden çok kaynak seçili; köprü hepsini karıştırır. Burada seçince yalnız bu kaynak kalır.') : '',
      help: 'Köprünün ağa verdiği ses. Çıkış seçilirse o aygıtın çaldığı ses (loopback), giriş seçilirse mikrofon ya da hat girişi yakalanır. Tek bir uygulamanın sesi için köprü durum penceresini kullanın.',
    });
  }

  function fallbackSelect(b, push) {
    const sel = el('select', { class: 'p-in' });
    const add = (value, label, user) => sel.appendChild(el('option', Object.assign({ value, text: label }, user ? { 'data-user-text': '' } : {})));
    add('', tr('Olağan ses girişi'));
    const seen = new Set(['']);
    const devs = (P().audioDevices ? P().audioDevices() : []).filter((d) => d && d.name);
    devs.forEach((d) => { if (seen.has(d.name)) return; seen.add(d.name); add(d.name, d.name, true); });
    if (b.fallbackSource && !seen.has(b.fallbackSource)) add(b.fallbackSource, b.fallbackSource + ' (' + tr('bulunamadı') + ')', true);
    sel.value = b.fallbackSource || '';
    sel.addEventListener('change', () => { b.fallbackSource = sel.value; push(); });
    return sel;
  }

  function outputSelect(b, push) {
    const sel = el('select', { class: 'p-in' });
    sel.appendChild(el('option', { value: '', text: tr('Sistemin varsayılan çıkışı') }));
    const outs = (status && status.outputs) || [];
    outs.forEach((o, i) => sel.appendChild(el('option', Object.assign({ value: o.id, text: o.label || (tr('Çıkış') + ' ' + (i + 1)) }, o.label ? { 'data-user-text': '' } : {}))));
    if (b.playDevice && !outs.some((o) => o.id === b.playDevice)) sel.appendChild(el('option', { value: b.playDevice, text: tr('Kayıtlı çıkış (bulunamadı)') }));
    sel.value = b.playDevice || '';
    sel.addEventListener('change', () => { b.playDevice = sel.value; push(); });
    return sel;
  }

  function senderStatus() {
    const s = status && status.sender;
    if (!s) return null;
    const v = V();
    const a = status.analysis;
    const tiles = [
      v.tile(tr('Alıcılar'), s.clients || 0, { tone: s.clients ? 'ok' : '' }),
      v.tile(tr('Ses yakalama'), status.capturing ? tr('açık') : tr('alıcı bekleniyor'), { tone: status.capturing ? 'ok' : 'dim' }),
    ];
    if (s.listeners) tiles.push(v.tile(tr('Ses dinleyen'), s.listeners));
    if (s.dropped) tiles.push(v.tile(tr('Atlanan kare'), s.dropped, { tone: 'warn' }));
    if (a) tiles.push(v.levelTile(a.level, a.peak), v.bandsTile(a.bands));
    if (a) v.analysisTiles(a).forEach((t) => tiles.push(t));
    if (status.meta && (status.meta.title || status.meta.artist)) tiles.push(v.tile(tr('Çalan'), [status.meta.artist, status.meta.title].filter(Boolean).join(' — '), { wide: true, user: true }));
    const nodes = [v.grid(tiles)];
    if (s.error) nodes.push(el('div', { class: 'br-err', text: tr(ERR_TEXT[s.error] || 'Köprü açılamadı') }));
    return el('div', { class: 'bridge-send' }, nodes);
  }

  function receiverStatus(alsoSending) {
    const r = status && status.receiver;
    if (!r) return null;
    const v = V();
    const inp = status.input || {};
    const tiles = [
      v.tile(tr('Bağlantı'), tr(RX_TEXT[r.state] || r.state), { wide: true, tone: r.state === 'connected' ? 'ok' : r.state === 'error' ? 'err' : 'warn' }),
    ];
    if (r.host) tiles.push(v.tile(tr('Köprü'), r.name || r.host, { user: true, note: r.host + ':' + r.port, noteUser: true }));
    tiles.push(v.tile(tr('Gidiş-dönüş'), v.ms(r.rttMs)), v.tile(tr('Saat farkı'), v.ms(r.offsetMs)), v.tile(tr('Karenin yaşı'), v.ms(r.ageMs)));
    tiles.push(v.tile(tr('Kayıp kare'), r.lost || 0, { tone: r.lost ? 'warn' : '' }));
    if (inp.switches) tiles.push(v.tile(tr('Giriş değişimi'), inp.switches));
    tiles.push(v.tile(tr('Zaman damgası'), status.clock === 'shared' ? tr('ortak saat') : tr('bu makinenin saati'), { wide: true }));
    if (status.play && status.player) {
      const p = status.player;
      tiles.push(v.tile(tr('Ses tamponu'), v.ms(p.bufferedMs), { note: p.underruns ? tr('kesinti') + ': ' + p.underruns : '', tone: p.underruns ? 'warn' : '' }));
    }
    if (status.meta && (status.meta.title || status.meta.artist)) tiles.push(v.tile(tr('Köprüde çalan'), [status.meta.artist, status.meta.title].filter(Boolean).join(' — '), { wide: true, user: true }));
    if (inp.state === 'bridge' && status.analysis && !alsoSending) {
      tiles.push(v.levelTile(status.analysis.level, status.analysis.peak), v.bandsTile(status.analysis.bands));
      v.analysisTiles(status.analysis).forEach((t) => tiles.push(t));
    }
    const nodes = [v.grid(tiles)];
    if (r.error && ERR_TEXT[r.error]) nodes.push(el('div', { class: 'br-err', text: tr(ERR_TEXT[r.error]) }));
    if (status.player && status.player.sinkError) nodes.push(el('div', { class: 'br-err', text: tr('Seçilen çıkış aygıtı açılamadı; varsayılan çıkış kullanılıyor.') }));
    return el('div', { class: 'bridge-recv' }, nodes);
  }

  function foundList(b) {
    const list = (status && status.found) || [];
    if (!list.length) return el('div', { class: 'br-sub', text: tr('Ağda köprü bulunamadı. Güvenlik duvarı UDP 8742 ve köprü portuna izin vermeli; adresi elle de yazabilirsiniz.') });
    const box = el('div', { class: 'br-list' });
    list.forEach((f) => box.appendChild(el('div', { class: 'br-item' }, [
      el('div', { class: 'br-item-main' }, [
        el('span', { class: 'br-item-t', text: f.name || f.id, 'data-user-text': '' }),
        el('span', { class: 'br-item-s', text: f.host + ':' + f.port, 'data-user-text': '' }),
      ]),
      f.paired
        ? el('button', { class: 'btn small ghost', type: 'button', text: tr('Bu Köprüyü Kullan'), onclick: () => { b.host = f.host; b.port = f.port; P().push(true); P().rerender(); } })
        : V().pill('warn', REASON_TEXT[f.reason] || 'eşleşmedi'),
    ])));
    return box;
  }

  function panel() {
    const b = cfg();
    const push = () => P().push(true);
    const only = !!(status && status.only);
    const sending = b.send || only;
    const receiving = b.receive && !only;
    const groups = [];

    // 1) Kip
    groups.push(group(tr('Kip'), [
      switchRow(tr('Bu Makinenin Sesini Köprüye Ver'), b.send, (v) => { b.send = v; push(); P().rerender(); }),
      switchRow(tr('Ses Girişi: Ağ Köprüsü'), b.receive, (v) => { b.receive = v; push(); P().rerender(); }),
      switchRow(tr('Yalnız Ses Köprüsü (sonraki açılışta)'), b.only, (v) => { b.only = v; push(); },
        'Yalnız köprü kipinde görüntü çıkışı, ışık ve yayın açılmaz, GPU kullanılmaz; küçük bir durum penceresi ve sistem tepsisi kalır. Olağan uygulamanın yanında çalıştırmak için uygulamayı --bridge ile açın (ayarları ayrı klasörde). --hidden pencereyi açmadan başlatır.'),
      only ? switchRow(tr('Durum Penceresi Açılışta Açılmasın'), b.startHidden, (v) => { b.startHidden = v; push(); }) : null,
    ]));

    // 2) Bağlantı
    const secret = textInput(b.secret, (v) => { b.secret = v; push(); }, { autocomplete: 'off', spellcheck: 'false', 'data-user-attr': '' });
    const conn = [
      ctlRow(tr('Eşleşme Parolası'), [secret, el('button', { class: 'btn small', type: 'button', icon: 'refresh', text: tr('Yeni Parola'), onclick: async () => { b.secret = await window.api.bridgeNewSecret(); push(); P().rerender(); } })],
        { help: 'Köprüde ve her alıcıda aynı parola, en az 16 karakter. Parola ağa gitmez; iki taraf birbirini doğrular.' }),
    ];
    if (status && status.problem === 'secret' && (b.send || b.receive || only)) conn.push(el('div', { class: 'br-err', text: tr('Eşleşme parolası en az 16 karakter olmalı; köprünün ve alıcının parolası aynı olmalı.') }));
    conn.push(ctlRow(tr('Köprü Portu'), [numInput(b.port || 8741, 1024, 65535, (v) => { b.port = v; push(); })], { help: 'TCP bu port, keşif UDP 8742. Güvenlik duvarı ikisine de izin vermeli.' }));
    if (sending) {
      conn.push(ctlRow(tr('Köprünün Adı'), [textInput(b.name, (v) => { b.name = v; push(); }, { placeholder: tr('Bilgisayarın adı'), 'data-user-attr': '' })]));
      conn.push(captureSourceRow(push));
    }
    if (receiving) {
      conn.push(ctlRow(tr('Köprünün Adresi'), [textInput(b.host, (v) => { b.host = v; push(); }, { placeholder: tr('Boş: ağda kendiliğinden bulunur'), 'data-user-attr': '' })]));
      if (!b.host) conn.push(foundList(b));
      conn.push(switchRow(tr('Köprü Susarsa Yerel Girişe Dön'), b.fallback !== false, (v) => { b.fallback = v; push(); P().rerender(); }));
      if (b.fallback !== false) conn.push(ctlRow(tr('Yedek Giriş'), [fallbackSelect(b, push)], { help: 'Köprü susunca kullanılacak giriş: olağan ses girişi ya da ayrı bir aygıt, örneğin mikserin bu makineye giden ayrı çıkışı (split).' }));
      conn.push(switchRow(tr('Köprünün Sesini Bu Makinede Çal'), b.play, (v) => { b.play = v; push(); P().rerender(); },
        'Köprü dinlenebilir sesi de yollar (sıkıştırılmamış PCM, yaklaşık 1,5 Mbit/sn). Ses bu makinenin seçilen çıkışından, tampon kadar gecikmeyle çalar. Görüntü için gerekmez.'));
      if (b.play) {
        const vol = el('input', { type: 'range', min: '0', max: '1', step: '0.01', value: String(b.playVolume == null ? 1 : b.playVolume), 'aria-label': tr('Ses düzeyi') });
        vol.addEventListener('change', () => { b.playVolume = Number(vol.value); push(); });
        conn.push(ctlRow(tr('Ses Düzeyi'), [vol]));
        conn.push(ctlRow(tr('Çıkış Aygıtı'), [outputSelect(b, push)]));
        conn.push(ctlRow(tr('Ses Tamponu (ms)'), [numInput(b.playLatencyMs || 120, 40, 1000, (v) => { b.playLatencyMs = v; push(); })], { help: 'Kısa tampon daha az gecikme, uzun tampon kablosuz ağda daha az kesinti demek.' }));
      }
    }
    groups.push(group(tr('Bağlantı'), conn));

    // 3) Durum
    if (sending || receiving) {
      const s = status && status.sender;
      const r = status && status.receiver;
      const inp = (status && status.input) || {};
      let tone = 'off';
      let text = 'Kapalı';
      if (status && status.problem) { tone = 'err'; text = 'Parola eksik'; }
      else if (receiving && r) {
        tone = inp.state === 'bridge' ? 'ok' : r.state === 'error' ? 'err' : 'warn';
        text = INPUT_TEXT[inp.state] || RX_TEXT[r.state] || r.state;
      } else if (s) { tone = s.listening && !s.error ? 'ok' : 'err'; text = s.listening && !s.error ? 'Köprü yayında' : 'Köprü açılamadı'; }
      const st = [];
      if (sending) { if (receiving) st.push(el('div', { class: 'br-subhead', text: tr('Bu makine (köprü)') })); st.push(senderStatus()); }
      if (receiving) { if (sending) st.push(el('div', { class: 'br-subhead', text: tr('Alıcı') })); st.push(receiverStatus(sending)); }
      groups.push(group(tr('Durum'), st, V().pill(tone, tr(text))));
    }
    return el('div', { class: 'bridge-panel' }, groups);
  }

  async function init() {
    if (started || !window.api || !window.api.bridgeStatus) return;
    started = true;
    const sig = (x) => JSON.stringify(x ? [x.problem, x.sender && [x.sender.listening, x.sender.clients, x.sender.error], x.receiver && [x.receiver.state, x.receiver.host, x.receiver.error], x.input && x.input.state, (x.found || []).map((f) => f.id + f.paired + f.host), x.capturing, x.play, (x.outputs || []).length] : null);
    window.api.onBridgeStatus((s) => {
      const prev = sig(status);
      status = s || null;
      const panelOpen = document.querySelector('.bridge-panel');
      if (!panelOpen) return;
      // Yazı yazılırken yeniden çizim odağı çalmasın
      const a = document.activeElement;
      if (a && panelOpen.contains(a) && (a.tagName === 'INPUT' || a.tagName === 'SELECT')) return;
      // Ölçümler her saniye; yapı değişince hemen
      if (prev === sig(status) && Date.now() - lastDraw < 1000) return;
      lastDraw = Date.now();
      P().rerender();
    });
    try { status = await window.api.bridgeStatus(); } catch { /* */ }
  }

  window.SVBridgePanel = { panel, init, RX_TEXT, INPUT_TEXT, ERR_TEXT, REASON_TEXT };
})();
