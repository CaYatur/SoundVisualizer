/*
 * SoundVisualizer — CaYaDev Ses Görselleştirici
 * Copyright (c) 2026 Çağan Turgut (CaYatur) — CaYaDev, https://cayadev.com
 * https://github.com/CaYatur/SoundVisualizer
 * SPDX-License-Identifier: MIT
 */
'use strict';
/* KÖPRÜ DURUM PENCERESİ (#813). Çalışıyor mu, kaynaklar (uygulamanın Ses
   Kaynakları seçicisinin AYNISI: çıkışlar, girişler ve tek tek uygulamalar,
   birlikte karıştırılır; canlı değişir), seviye, alıcılar, kayıp kare,
   çalan parça, hatalar. Seviye ölçeri ayrı ve sık gelir (~20 Hz); geri kalanı durum
   değişince çizilir. */
(function () {
  const W = window.bridgeWin;
  const V = window.SVBridgeView;
  const tr = (s) => (window.SVI18n && window.SVI18n.t ? window.SVI18n.t(s) : s);
  if (!W || !V) return;
  // Ortak seçici simgeli öğe istiyor (panelin el'i gibi)
  const el = (tag, props, kids) => {
    const p = Object.assign({}, props || {});
    const icon = p.icon;
    delete p.icon;
    const n = V.el(tag, p, kids);
    if (icon && window.SVIcons) n.insertBefore(window.SVIcons.el(icon, p.text ? 'svi-lead' : ''), n.firstChild);
    return n;
  };
  const app = document.getElementById('app');
  let st = null;
  let devices = [];
  let apps = [];          // ses oturumu olan uygulamalar (app-audio:list ile aynı)
  let appStatus = null;   // uygulama başına yakalama kullanılabilir mi
  const meters = new Map(); // uygulama anahtarı -> { fill }
  let metersOn = false;
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

  function sources() {
    return (st && st.wantedSources) || ['default'];
  }

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

  /* Uygulama satırının canlı ölçeri: panelinkiyle aynı akış, aynı ölçek. */
  function appMeter(match) {
    const AA = window.SVAppAudio;
    if (!AA || !W.appMeters) return null;
    const fill = el('i');
    fill.style.transform = 'scaleX(0)';
    meters.set(AA.baseName(match), { fill });
    return el('span', { class: 'source-meter', title: 'Anlık ses seviyesi', 'aria-hidden': 'true' }, [fill]);
  }
  function syncMeters() {
    const want = meters.size > 0 && !document.hidden;
    if (want === metersOn) return;
    metersOn = want;
    W.appMeters(want);
  }
  const SRC_STATE = {
    missing: 'bulunamadı; öteki kaynaklar sürüyor',
    failed: 'açılamadı; öteki kaynaklar sürüyor',
    waiting: 'çalışmıyor; açılınca kendiliğinden bağlanır',
    closed: 'kapandı; yeniden açılınca kendiliğinden bağlanır',
  };
  // Satırın yanındaki kısa not (ortak seçici host.stateOf)
  const SRC_SHORT = { missing: 'bulunamadı', failed: 'açılamadı', waiting: 'bekleniyor', closed: 'kapandı, bekleniyor' };

  function sourceCard() {
    const S = window.SVAudioSources;
    const AA = window.SVAppAudio;
    meters.clear();
    const nodes = [el('div', { class: 'group-label', text: 'Kaynaklar' })];
    if (S) {
      nodes.push(S.control({
        label: 'Aktif Kaynaklar',
        devices: () => devices,
        apps: () => (AA ? AA.candidates(apps) : []),
        appStatus: () => appStatus,
      }, {
        el,
        tr,
        get: () => sources(),
        set: async (list) => {
          if (st) st.wantedSources = list;
          draw(true);
          try { await W.setSources(list); } catch { /* */ }
        },
        appMeter,
        stateOf: (key) => { const x = st && st.sourceStates && st.sourceStates[key]; return x && SRC_SHORT[x.state] ? tr(SRC_SHORT[x.state]) : ''; },
        requestPermission: async () => { try { await W.requestPermission(); } catch { /* */ } refresh(); },
      }));
      nodes.push(el('button', { class: 'btn small', type: 'button', icon: 'refresh', text: 'Aygıtları Yenile', onclick: () => refresh() }));
    }
    nodes.push(el('div', { class: 'bs-note', text: 'Seçilen kaynakların hepsi tek akışta karıştırılır ve köprü o karışımı gönderir. Değişiklik köprüyü kesmez.' }));
    // Kaynak başına hata: biri düşünce ötekiler karışımda sürer
    const states = (st && st.sourceStates) || {};
    for (const k of Object.keys(states)) {
      const x = states[k];
      if (!x || !SRC_STATE[x.state]) continue;
      const name = k === 'default' ? tr('Varsayılan Çıkış (Aktif Hoparlör)') : k.startsWith('app:') ? k.slice(4) : k;
      nodes.push(el('div', { class: x.state === 'failed' ? 'br-err' : 'bs-warn' }, [
        el('span', { 'data-user-text': '', text: name }),
        el('span', { text: ': ' + tr(SRC_STATE[x.state]) }),
      ]));
    }
    if (st && st.appFallback) nodes.push(el('div', { class: 'bs-warn', text: APP_ERR[st.appFallback.code] || st.appFallback.message || APP_ERR.UNSUPPORTED_PLATFORM }));
    const cs = st && st.captureStatus;
    if (cs && cs.type === 'error') nodes.push(el('div', { class: 'br-err', text: ERR[cs.code] || cs.message || tr('Ses yakalanamadı') }));
    if (cs && cs.type === 'no-loopback' && cs.message) nodes.push(el('div', { class: 'bs-warn', text: cs.message }));
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
        el('span', { class: 'br-item-s', 'data-user-text': '', text: [np.artist, np.album, np.app].filter(Boolean).join(' · ') }),
      ])]));
      const dur = np.duration > 0 ? Math.floor(np.duration / 60) + ':' + String(Math.floor(np.duration % 60)).padStart(2, '0') : '—';
      nodes.push(V.grid([
        V.tile(tr('Durum'), np.playing ? tr('çalıyor') : tr('duraklatıldı')),
        V.tile(tr('Süre'), dur),
        V.tile(tr('Kapak'), np.cover ? tr('gönderiliyor') : tr('yok'), { tone: np.cover ? 'ok' : '' }),
      ]));
    } else {
      /* Yalnız Windows'ta okunuyor (SMTC). Öteki sistemlerde köprü parça
         bilgisi göndermez; ses ve çözümleme etkilenmez. */
      nodes.push(el('div', { class: 'bs-note', text: info.supported === false ? 'Çalan parça bilgisi bu sistemde okunamıyor (yalnız Windows: SMTC). Köprü parça bilgisi göndermez; ses ve çözümleme etkilenmez.' : info.error ? 'Çalan parça okunamadı.' : 'Çalan parça yok.' }));
    }
    return el('section', { class: 'bs-card' }, nodes);
  }

  function sig() {
    if (!st) return '';
    const s = st.sender || {};
    return JSON.stringify([st.paused, st.problem, st.tray, s.listening, s.error, s.name, s.port, (s.peers || []).map((p) => [p.addr, p.name, Math.round((p.rttMs || 0) / 5), Math.round((p.ageMs || 0) / 5), p.lost, p.dropped]), (s.authFails || []).map((f) => f.addr), st.wantedSources, st.sourceStates, st.captureStatus, st.capturing, st.nowPlaying, st.appFallback, st.analysis && [st.analysis.bpm, st.analysis.onsets, Math.round((st.analysis.ageMs || 0) / 20)], devices.length, apps.map((a) => [a.match, a.audible]), appStatus && appStatus.available]);
  }
  function draw(force) {
    const a = document.activeElement;
    if (!force && a && app.contains(a) && a.tagName === 'SELECT') return;
    // Ölçerler canlı: yeniden çizim yalnız durum değişince
    const s = sig();
    if (!force && s === lastSig) return;
    lastSig = s;
    app.replaceChildren(header(), sourceCard(), levelCard(), receiversCard(), nowCard());
    syncMeters();
  }
  // "Aygıtları Yenile": aygıtlar, uygulamalar ve uygulama yakalamanın durumu
  async function refresh() {
    try { devices = await W.devices(); } catch { devices = []; }
    try { appStatus = await W.appStatus(); } catch { appStatus = { available: false }; }
    try { apps = appStatus && appStatus.available !== false ? ((await W.appList()) || []) : []; } catch { apps = []; }
    draw(true);
  }
  if (W.onAppLevels) {
    W.onAppLevels((p) => {
      const AA = window.SVAppAudio;
      if (!p || !AA || !metersOn) return;
      const lv = p.levels || {};
      for (const [k, m] of meters) m.fill.style.transform = 'scaleX(' + AA.meterFraction(lv[k] || 0).toFixed(3) + ')';
    });
  }
  document.addEventListener('visibilitychange', syncMeters);

  W.onStatus((s) => { st = s; draw(false); });
  W.onLevel((l) => setLevel(l));
  // Tema canlı: paneldeki seçim ya da sistemin koyu/açık değişimi (#813)
  if (W.onTheme) W.onTheme((t) => { if (t && window.SVUiThemes) window.SVUiThemes.apply(document, t.id, !!t.dark); });
  (async () => {
    try { st = await W.status(); } catch { /* */ }
    draw(true);
    refresh();
  })();
  // Ölçümler (yaş) ilerlesin
  setInterval(async () => { try { st = await W.status(); draw(false); } catch { /* */ } }, 1000);
})();
