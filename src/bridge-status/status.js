/*
 * SoundVisualizer — CaYaDev Ses Görselleştirici
 * Copyright (c) 2026 Çağan Turgut (CaYatur) — CaYaDev, https://cayadev.com
 * https://github.com/CaYatur/SoundVisualizer
 * SPDX-License-Identifier: MIT
 */
'use strict';
/* KÖPRÜ DURUM PENCERESİ (#813). Çalışıyor mu, kaynak (aygıt ya da tek
   uygulama; canlı değişir), seviye, alıcılar, kayıp kare, çalan parça,
   hatalar. Seviye ölçeri ayrı ve sık gelir (~20 Hz); geri kalanı durum
   değişince çizilir. */
(function () {
  const W = window.bridgeWin;
  const V = window.SVBridgeView;
  const tr = (s) => (window.SVI18n && window.SVI18n.t ? window.SVI18n.t(s) : s);
  if (!W || !V) return;
  const el = V.el;
  const app = document.getElementById('app');
  let st = null;
  let devices = [];
  let apps = null; // { available, code, message, apps }
  let mode = null; // 'device' | 'app'
  let srcMsg = '';
  let levelBox = null;
  let beatDot = null;
  let lastSig = '';

  const ERR = {
    EADDRINUSE: 'Köprü portu kullanımda; başka bir port seçin.',
    EACCES: 'Köprü portu açılamadı (izin yok).',
    NO_DEVICE: 'Seçili ses aygıtı bulunamadı. Takıldığında yakalama kendiliğinden başlar.',
  };
  const APP_ERR = {
    WIN_TOO_OLD: 'Bu Windows sürümü uygulama başına yakalamayı desteklemiyor; aygıt yakalanıyor.',
    MAC_TOO_OLD: 'Uygulama başına yakalama macOS 13 ve üstünü gerektiriyor; aygıt yakalanıyor.',
    MAC_NO_PERMISSION: 'Uygulama sesini yakalamak için Ekran Kaydı izni gerekiyor; şimdilik aygıt yakalanıyor.',
    NO_HELPER: 'Uygulama ses yardımcısı bu pakette yok; aygıt yakalanıyor.',
    NO_SOUND_SERVER: 'Uygulama başına yakalama için PipeWire ya da PulseAudio gerekiyor; aygıt yakalanıyor.',
    LINUX_NO_TOOLS: 'Uygulama başına yakalama için pulseaudio-utils (pactl, parec) gerekiyor; aygıt yakalanıyor.',
    SOUND_SERVER_DOWN: 'Ses sunucusuna bağlanılamadı; aygıt yakalanıyor.',
    UNSUPPORTED_PLATFORM: 'Bu işletim sisteminde uygulama başına yakalama yok; aygıt yakalanıyor.',
  };

  function current() {
    const w = (st && st.wantedSources) || ['default'];
    return w[0];
  }
  function isApp(x) { return !!x && typeof x === 'object' && x.kind === 'app'; }

  function header() {
    const live = st && st.sender && st.sender.listening && !st.paused;
    const tone = !st ? 'off' : st.paused ? 'off' : st.problem ? 'err' : live ? 'ok' : (st.sender && st.sender.error) ? 'err' : 'warn';
    const text = !st ? 'Bekleniyor' : st.paused ? 'Durduruldu' : st.problem ? 'Parola eksik' : live ? 'Yayında' : (st.sender && st.sender.error) ? 'Açılamadı' : 'Başlıyor';
    const name = st && st.sender ? st.sender.name : '';
    return el('section', { class: 'bs-card' }, [
      el('div', { class: 'bs-top' }, [
        el('div', { class: 'bs-title' }, [
          el('h1', { text: 'Ses Köprüsü' }),
          name ? el('span', { class: 'bs-name', 'data-user-text': '', text: name + (st.sender && st.sender.port ? ' · :' + st.sender.port : '') }) : null,
        ]),
        V.pill(tone, text),
      ]),
      el('div', { class: 'bs-actions', style: { marginTop: '10px' } }, [
        el('button', { class: 'btn small', type: 'button', text: 'Köprü Ayarları', onclick: () => W.action('panel') }),
        st && st.paused
          ? el('button', { class: 'btn small primary', type: 'button', text: 'Köprüyü Başlat', onclick: () => W.action('start') })
          : el('button', { class: 'btn small', type: 'button', text: 'Köprüyü Durdur', onclick: () => W.action('stop') }),
        el('button', { class: 'btn small ghost', type: 'button', text: 'Çık', onclick: () => W.action('quit') }),
      ]),
      st && !st.tray ? el('div', { class: 'bs-note', style: { marginTop: '8px' }, text: 'Sistem tepsisi yok: bu pencere köprünün arayüzü; kapatınca köprü de kapanır.' }) : null,
    ]);
  }

  function sourceCard() {
    const cur = current();
    if (mode == null) mode = isApp(cur) ? 'app' : 'device';
    const seg = el('div', { class: 'bs-seg', role: 'tablist' }, [
      el('button', { type: 'button', class: mode === 'device' ? 'on' : '', text: 'Aygıt', onclick: () => { mode = 'device'; draw(true); } }),
      el('button', { type: 'button', class: mode === 'app' ? 'on' : '', text: 'Tek Uygulama', onclick: () => { mode = 'app'; loadApps(); draw(true); } }),
    ]);
    const nodes = [el('div', { class: 'br-head' }, [el('div', { class: 'group-label', text: 'Kaynak' }), seg])];
    if (mode === 'device') {
      const sel = el('select', { class: 'p-in wide', 'aria-label': tr('Ses aygıtı') });
      const add = (value, label, user) => sel.appendChild(el('option', Object.assign({ value, text: label }, user ? { 'data-user-text': '' } : {})));
      add('default', tr('Varsayılan çıkış (sistem sesi)'));
      const outs = devices.filter((d) => d.kind === 'output');
      const ins = devices.filter((d) => d.kind !== 'output');
      const group = (label, list, suffix) => {
        if (!list.length) return;
        const g = el('optgroup', { label: tr(label) });
        list.forEach((d) => g.appendChild(el('option', { value: d.name, text: d.name + suffix, 'data-user-text': '' })));
        sel.appendChild(g);
      };
      group('Çıkışlar (loopback)', outs, '');
      group('Girişler', ins, '');
      const curName = typeof cur === 'string' ? cur : 'default';
      if (curName !== 'default' && !devices.some((d) => d.name === curName)) add(curName, curName + ' (' + tr('bulunamadı') + ')', true);
      sel.value = curName;
      sel.addEventListener('change', async () => { const r = await W.setSource(sel.value); srcMsg = r && r.ok ? '' : (r && r.message) || ''; });
      nodes.push(sel);
      nodes.push(el('div', { class: 'bs-note', text: 'Çıkış seçilirse o aygıtın çaldığı ses (loopback), giriş seçilirse mikrofon ya da hat girişi yakalanır. Değişiklik köprüyü kesmez.' }));
    } else {
      if (!apps) nodes.push(el('div', { class: 'bs-note', text: 'Uygulamalar listeleniyor…' }));
      else if (!apps.available) nodes.push(el('div', { class: 'bs-warn', text: APP_ERR[apps.code] || apps.message || APP_ERR.UNSUPPORTED_PLATFORM }));
      else {
        const sel = el('select', { class: 'p-in wide', 'aria-label': tr('Uygulama') });
        sel.appendChild(el('option', { value: '', text: tr('Bir uygulama seçin') }));
        const list = apps.apps || [];
        list.forEach((a, i) => sel.appendChild(el('option', { value: String(i), text: (a.label || a.name || a.match) + (a.pid ? ' (' + a.pid + ')' : ''), 'data-user-text': '' })));
        if (isApp(cur)) {
          const i = list.findIndex((a) => (a.match || a.name) === cur.match);
          if (i >= 0) sel.value = String(i);
          else { sel.appendChild(el('option', { value: 'cur', text: (cur.label || cur.match) + ' (' + tr('çalışmıyor') + ')', 'data-user-text': '' })); sel.value = 'cur'; }
        }
        sel.addEventListener('change', async () => {
          const a = list[Number(sel.value)];
          if (!a) return;
          const r = await W.setSource({ match: a.match || a.name, label: a.label || a.name || a.match, pid: a.pid });
          srcMsg = r && r.ok ? '' : (APP_ERR[r && r.code] || (r && r.message) || '');
          draw(true);
        });
        nodes.push(el('div', { class: 'url-row' }, [sel, el('button', { class: 'btn small', type: 'button', text: 'Yenile', onclick: () => { apps = null; loadApps(); draw(true); } })]));
        nodes.push(el('div', { class: 'bs-note', text: 'Yalnız seçilen uygulamanın sesi yakalanır. Uygulama kapanırsa açılınca kendiliğinden bağlanır.' }));
      }
    }
    if (st && st.appFallback) nodes.push(el('div', { class: 'bs-warn', text: APP_ERR[st.appFallback.code] || st.appFallback.message || APP_ERR.UNSUPPORTED_PLATFORM }));
    if (srcMsg) nodes.push(el('div', { class: 'bs-warn', text: srcMsg }));
    const cs = st && st.captureStatus;
    if (cs && cs.type === 'error') nodes.push(el('div', { class: 'br-err', text: ERR[cs.code] || cs.message || tr('Ses yakalanamadı') }));
    if (cs && cs.type === 'no-loopback') nodes.push(el('div', { class: 'bs-warn', text: cs.message }));
    return el('section', { class: 'bs-card bs-src' }, nodes);
  }

  function levelCard() {
    levelBox = el('div', { class: 'bs-big-meter' });
    const a0 = st && st.analysis;
    levelBox.appendChild(V.grid([V.levelTile(a0 ? a0.level : 0, null), V.bandsTile(a0 && a0.bands)]));
    beatDot = el('span', { class: 'bs-beat', title: tr('Vuruş') });
    const a = st && st.analysis;
    const cap = st && st.capturing;
    return el('section', { class: 'bs-card' }, [
      el('div', { class: 'br-head' }, [el('div', { class: 'group-label', text: 'Seviye' }), el('div', { style: { display: 'flex', alignItems: 'center', gap: '8px' } }, [beatDot, V.pill(cap ? 'ok' : 'off', cap ? 'Yakalanıyor' : 'Yakalama kapalı')])]),
      levelBox,
      el('div', { style: { height: '8px' } }),
      V.grid(V.analysisTiles(a)),
    ]);
  }
  function setLevel(l) {
    if (!levelBox) return;
    levelBox.replaceChildren(V.grid([V.levelTile(l.level, l.peak), V.bandsTile(l.bands)]));
    if (beatDot) { beatDot.classList.toggle('on', !!l.beat); if (l.beat) setTimeout(() => beatDot && beatDot.classList.remove('on'), 90); }
  }

  function receiversCard() {
    const s = st && st.sender;
    const peers = (s && s.peers) || [];
    const nodes = [el('div', { class: 'br-head' }, [el('div', { class: 'group-label', text: 'Alıcılar' }), V.pill(peers.length ? 'ok' : 'off', peers.length ? peers.length + ' bağlı' : 'Alıcı yok')])];
    const list = el('div', { class: 'br-list' });
    peers.forEach((p) => {
      list.appendChild(el('div', { class: 'br-item' }, [
        el('div', { class: 'br-item-main' }, [
          el('span', { class: 'br-item-t', 'data-user-text': '', text: (p.name || p.addr) }),
          el('span', { class: 'br-item-s', 'data-user-text': '', text: p.addr }),
        ]),
        V.grid([
          V.tile(tr('Gidiş-dönüş'), V.ms(p.rttMs)),
          V.tile(tr('Kare yaşı'), V.ms(p.ageMs)),
          V.tile(tr('Kayıp kare'), String((p.lost || 0) + (p.dropped || 0)), { tone: (p.lost || p.dropped) ? 'warn' : '' }),
          V.tile(tr('Eşleşme'), tr('doğrulandı'), { tone: 'ok' }),
        ]),
      ]));
    });
    ((s && s.authFails) || []).slice(0, 3).forEach((f) => {
      list.appendChild(el('div', { class: 'br-item' }, [
        el('div', { class: 'br-item-main' }, [el('span', { class: 'br-item-t', 'data-user-text': '', text: f.addr }), el('span', { class: 'br-item-s', text: tr('Eşleşme parolası tutmuyor') })]),
        V.pill('err', 'Reddedildi'),
      ]));
    });
    if (list.childNodes.length) nodes.push(list);
    else nodes.push(el('div', { class: 'bs-note', text: 'Alıcılar bu köprüyü ağda kendiliğinden bulur; aynı eşleşme parolası gerekli.' }));
    if (s && s.error) nodes.push(el('div', { class: 'br-err', text: ERR[s.error] || s.error }));
    if (st && st.problem === 'secret') nodes.push(el('div', { class: 'br-err', text: 'Eşleşme parolası en az 16 karakter olmalı; Köprü Ayarları\'ndan girin.' }));
    return el('section', { class: 'bs-card' }, nodes);
  }

  function nowCard() {
    const np = st && st.nowPlaying;
    const info = (st && st.nowPlayingInfo) || {};
    const nodes = [el('div', { class: 'group-label', text: 'Çalan Parça' })];
    if (np && (np.title || np.artist)) {
      nodes.push(el('div', { class: 'br-item' }, [el('div', { class: 'br-item-main' }, [
        el('span', { class: 'br-item-t', 'data-user-text': '', text: np.title || '—' }),
        el('span', { class: 'br-item-s', 'data-user-text': '', text: [np.artist, np.app].filter(Boolean).join(' · ') }),
      ])]));
    } else {
      nodes.push(el('div', { class: 'bs-note', text: info.supported === false ? 'Bu sistemde çalan parça bilgisi okunamıyor.' : info.error ? 'Çalan parça okunamadı.' : 'Çalan parça yok.' }));
    }
    return el('section', { class: 'bs-card' }, nodes);
  }

  function sig() {
    if (!st) return '';
    const s = st.sender || {};
    return JSON.stringify([st.paused, st.problem, st.tray, s.listening, s.error, s.name, s.port, (s.peers || []).map((p) => [p.addr, p.name, Math.round((p.rttMs || 0) / 5), Math.round((p.ageMs || 0) / 5), p.lost, p.dropped]), (s.authFails || []).map((f) => f.addr), st.wantedSources, st.captureStatus, st.capturing, st.nowPlaying, st.appFallback, st.analysis && [st.analysis.bpm, st.analysis.onsets, Math.round((st.analysis.ageMs || 0) / 20)], devices.length, apps && apps.apps && apps.apps.length, mode, srcMsg]);
  }
  function draw(force) {
    const a = document.activeElement;
    if (!force && a && app.contains(a) && a.tagName === 'SELECT') return;
    const s = sig();
    if (!force && s === lastSig) return;
    lastSig = s;
    app.replaceChildren(header(), sourceCard(), levelCard(), receiversCard(), nowCard());
  }
  async function loadApps() {
    try { apps = await W.apps(); } catch { apps = { available: false, code: 'ERROR', apps: [] }; }
    draw(true);
  }

  W.onStatus((s) => { st = s; draw(false); });
  W.onLevel((l) => setLevel(l));
  (async () => {
    try { st = await W.status(); } catch { /* */ }
    draw(true);
    try { devices = await W.devices(); } catch { devices = []; }
    if (isApp(current())) loadApps();
    draw(true);
  })();
  // Ölçümler (yaş) ilerlesin
  setInterval(async () => { try { st = await W.status(); draw(false); } catch { /* */ } }, 1000);
})();
