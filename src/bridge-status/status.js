/*
 * SoundVisualizer — CaYaDev Ses Görselleştirici
 * Copyright (c) 2026 Çağan Turgut (CaYatur) — CaYaDev, https://cayadev.com
 * https://github.com/CaYatur/SoundVisualizer
 * SPDX-License-Identifier: MIT
 */
'use strict';
/* KÖPRÜ PENCERESİ (#813, #822). Köprü kipinin tek arayüzü: panel açmadan
   her şey burada. Üç sekme:
     Durum      çalışıyor mu, seviye, alıcılar, kayıp kare, çalan parça
     Kaynaklar  uygulamanın Ses Kaynakları seçicisinin AYNISI (çıkışlar,
                girişler, tek tek uygulamalar; birlikte karıştırılır, canlı)
     Ayarlar    ad, port, eşleşme parolası, bu makinenin adresleri, oturum
                açılınca başlatma, olağan kipe dönüş
   Seviye ölçeri ayrı ve sık gelir (~20 Hz); geri kalanı durum değişince
   çizilir. Yazı alanındayken yeniden çizilmez (odak ve yazılan kaybolmasın);
   alanlar yazarken değil alandan çıkınca kaydedilir, çünkü port ya da parola
   değişimi köprüyü yeniden kurar ve alıcılar yeniden bağlanır. */
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
  let addrs = [];         // bu makinenin ağ adresleri (Ayarlar)
  let showSecret = false;
  const meters = new Map(); // uygulama anahtarı -> { fill }
  let metersOn = false;
  let levelBox = null;
  let beatDot = null;
  let lastSig = '';

  const TABS = [['status', 'Durum'], ['sources', 'Kaynaklar'], ['settings', 'Ayarlar']];
  let tab = 'status';
  try { const t = localStorage.getItem('sv-bridge-tab'); if (TABS.some((x) => x[0] === t)) tab = t; } catch { /* depolama yok */ }

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
  function cfg() { return (st && st.cfg) || {}; }

  function header() {
    const live = st && st.sender && st.sender.listening && !st.paused;
    const tone = !st ? 'off' : st.paused ? 'off' : st.problem ? 'err' : live ? 'ok' : (st.sender && st.sender.error) ? 'err' : 'warn';
    const text = !st ? 'Bekleniyor' : st.paused ? 'Durduruldu' : st.problem ? 'Parola eksik' : live ? 'Yayında' : (st.sender && st.sender.error) ? 'Açılamadı' : 'Başlıyor';
    const name = st && st.sender ? st.sender.name : '';
    return el('section', { class: 'bs-card bs-head' }, [
      el('div', { class: 'bs-top' }, [
        el('div', { class: 'bs-title' }, [
          el('h1', { text: 'Ses Köprüsü' }),
          name ? el('span', { class: 'bs-name', 'data-user-text': '', title: name, text: name + (st.sender && st.sender.port ? ' · :' + st.sender.port : '') }) : null,
        ]),
        V.pill(tone, text),
      ]),
      el('div', { class: 'bs-actions' }, [
        st && st.paused
          ? el('button', { class: 'btn small primary', type: 'button', text: 'Köprüyü Başlat', onclick: () => W.action('start') })
          : el('button', { class: 'btn small', type: 'button', text: 'Köprüyü Durdur', onclick: () => W.action('stop') }),
        el('button', { class: 'btn small ghost', type: 'button', text: 'Çık', onclick: () => W.action('quit') }),
      ]),
      st && !st.tray ? el('div', { class: 'bs-note', text: 'Sistem tepsisi yok: bu pencere köprünün arayüzü; kapatınca köprü de kapanır.' }) : null,
      tabBar(),
    ]);
  }

  // Sekmeler: öz testin İngilizce taraması .bs-seg düğmelerini tek tek açar
  function tabBar() {
    return el('div', { class: 'bs-seg bs-tabs', role: 'tablist' }, TABS.map(([id, label]) => el('button', {
      type: 'button', role: 'tab', class: tab === id ? 'on' : '', 'aria-selected': tab === id ? 'true' : 'false', 'data-tab': id, text: label,
      onclick: () => { if (tab === id) return; tab = id; try { localStorage.setItem('sv-bridge-tab', id); } catch { /* */ } if (id === 'settings') loadAddrs(); draw(true); },
    })));
  }

  /* ---- Durum ---------------------------------------------------------- */
  function sourceSummary() {
    const list = sources();
    const name = (x) => (x === 'default' ? tr('Varsayılan Çıkış') : x && typeof x === 'object' ? (x.label || x.match || '') : String(x));
    const first = name(list[0]);
    return list.length > 1 ? first + ' +' + (list.length - 1) : first;
  }
  function summaryCard() {
    const s = st && st.sender;
    const peers = (s && s.peers) || [];
    const lost = peers.reduce((n, p) => n + (p.lost || 0) + (p.dropped || 0), 0);
    const worstAge = peers.reduce((m, p) => (p.ageMs != null && p.ageMs > m ? p.ageMs : m), -1);
    return el('section', { class: 'bs-card bs-sum' }, [V.grid([
      V.tile(tr('Alıcılar'), peers.length ? String(peers.length) : tr('yok'), { tone: peers.length ? 'ok' : 'dim' }),
      V.tile(tr('Kaynak'), sourceSummary(), { user: true }),
      V.tile(tr('Kare yaşı'), worstAge >= 0 ? V.ms(worstAge) : '—', { tone: worstAge > 50 ? 'warn' : '' }),
      V.tile(tr('Kayıp kare'), String(lost), { tone: lost ? 'warn' : '' }),
    ])]);
  }

  function levelCard() {
    levelBox = el('div', { class: 'bs-big-meter' });
    const a0 = st && st.analysis;
    levelBox.appendChild(levelGrid(a0 ? a0.level : 0, null, a0 && a0.bands));
    beatDot = el('span', { class: 'bs-beat', title: tr('Vuruş') });
    const a = st && st.analysis;
    const cap = st && st.capturing;
    return el('section', { class: 'bs-card' }, [
      el('div', { class: 'br-head' }, [el('div', { class: 'group-label', text: 'Seviye' }), el('div', { class: 'bs-inline' }, [beatDot, V.pill(cap ? 'ok' : 'off', cap ? 'Yakalanıyor' : 'Yakalama kapalı')])]),
      levelBox,
      V.grid(V.analysisTiles(a)),
      cap ? null : el('div', { class: 'bs-note', text: 'Yakalama yalnız bir alıcı bağlıyken ya da bu pencere açıkken çalışır.' }),
    ]);
  }
  // Seviye ve bantlar tam genişlik: bant kutusu dar sütunda sıkışmasın
  function levelGrid(level, peak, bands) {
    const b = V.bandsTile(bands);
    b.classList.add('wide');
    return V.grid([V.levelTile(level, peak), b]);
  }
  function setLevel(l) {
    if (!levelBox || !levelBox.isConnected) return;
    levelBox.replaceChildren(levelGrid(l.level, l.peak, l.bands));
    if (beatDot) { beatDot.classList.toggle('on', !!l.beat); if (l.beat) setTimeout(() => beatDot && beatDot.classList.remove('on'), 90); }
  }

  function receiversCard() {
    const s = st && st.sender;
    const peers = (s && s.peers) || [];
    const nodes = [el('div', { class: 'br-head' }, [el('div', { class: 'group-label', text: 'Alıcılar' }), V.pill(peers.length ? 'ok' : 'off', peers.length ? peers.length + ' ' + tr('bağlı') : 'Alıcı yok')])];
    const list = el('div', { class: 'br-list' });
    peers.forEach((p) => {
      list.appendChild(el('div', { class: 'br-item bs-peer' }, [
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
    else nodes.push(el('div', { class: 'bs-note' }, [
      el('span', { text: 'Alıcılar bu köprüyü ağda kendiliğinden bulur; aynı eşleşme parolası gerekli.' }),
      ' ',
      el('button', { class: 'bs-link', type: 'button', text: 'Adresler ve parola', onclick: () => { tab = 'settings'; try { localStorage.setItem('sv-bridge-tab', tab); } catch { /* */ } loadAddrs(); draw(true); } }),
    ]));
    if (s && s.error) nodes.push(el('div', { class: 'br-err', text: ERR[s.error] || s.error }));
    if (st && st.problem === 'secret') nodes.push(el('div', { class: 'br-err', text: 'Eşleşme parolası en az 16 karakter olmalı; Ayarlar sekmesinden girin.' }));
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

  /* ---- Kaynaklar ------------------------------------------------------ */
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
    nodes.push(...sourceWarnings());
    return el('section', { class: 'bs-card bs-src' }, nodes);
  }
  // Kaynak sorunları iki sekmede de görünür: Durum'da da kaçmasın
  function sourceWarnings() {
    const out = [];
    const states = (st && st.sourceStates) || {};
    for (const k of Object.keys(states)) {
      const x = states[k];
      if (!x || !SRC_STATE[x.state]) continue;
      const name = k === 'default' ? tr('Varsayılan Çıkış (Aktif Hoparlör)') : k.startsWith('app:') ? k.slice(4) : k;
      out.push(el('div', { class: x.state === 'failed' ? 'br-err' : 'bs-warn' }, [
        el('span', { 'data-user-text': '', text: name }),
        el('span', { text: ': ' + tr(SRC_STATE[x.state]) }),
      ]));
    }
    if (st && st.appFallback) out.push(el('div', { class: 'bs-warn', text: APP_ERR[st.appFallback.code] || st.appFallback.message || APP_ERR.UNSUPPORTED_PLATFORM }));
    const cs = st && st.captureStatus;
    if (cs && cs.type === 'error') out.push(el('div', { class: 'br-err', text: ERR[cs.code] || cs.message || tr('Ses yakalanamadı') }));
    if (cs && cs.type === 'no-loopback' && cs.message) out.push(el('div', { class: 'bs-warn', text: cs.message }));
    return out;
  }

  /* ---- Ayarlar -------------------------------------------------------- */
  async function save(patch) {
    try {
      const r = await W.setConfig(patch);
      if (r && r.cfg && st) st.cfg = r.cfg;
    } catch { /* */ }
    draw(true);
  }
  function field(label, control, note) {
    return el('label', { class: 'bs-field' }, [el('span', { class: 'bs-field-k', text: label }), control, note ? el('span', { class: 'bs-field-n', text: note }) : null]);
  }
  function check(label, on, onSet, opts) {
    const o = opts || {};
    const inp = el('input', { type: 'checkbox', role: 'switch', checked: !!on, disabled: !!o.disabled, 'aria-label': tr(label) });
    inp.addEventListener('change', () => onSet(inp.checked));
    return el('div', { class: 'bs-check' + (o.disabled ? ' off' : '') }, [
      el('div', { class: 'bs-check-t' }, [el('span', { class: 'bs-check-k', text: label }), o.note ? el('span', { class: 'bs-field-n', text: o.note }) : null]),
      el('span', { class: 'switch' }, [inp, el('span', { class: 'track' })]),
    ]);
  }
  // Kopyala: düğme bir an "Kopyalandı" der
  function copyBtn(text, label) {
    const b = el('button', { class: 'btn small ghost', type: 'button', text: label || 'Kopyala' });
    b.addEventListener('click', async () => {
      let ok = false;
      try { ok = await W.copy(text); } catch { ok = false; }
      if (!ok) return;
      b.textContent = tr('Kopyalandı');
      setTimeout(() => { b.textContent = tr(label || 'Kopyala'); }, 1200);
    });
    return b;
  }

  function bridgeSettings() {
    const c = cfg();
    const name = el('input', { type: 'text', value: c.name || '', maxlength: '60', placeholder: c.defaultName || tr('Bilgisayarın adı'), 'data-user-attr': '', spellcheck: 'false' });
    name.addEventListener('change', () => save({ name: name.value.trim() }));
    const port = el('input', { type: 'number', min: '1024', max: '65535', step: '1', value: String(c.port || 8741), class: 'bs-port' });
    port.addEventListener('change', () => {
      const v = Math.round(Number(port.value));
      if (!(v >= 1024 && v <= 65535)) { port.value = String(c.port || 8741); return; }
      save({ port: v });
    });
    const secret = el('input', { type: showSecret ? 'text' : 'password', value: c.secret || '', autocomplete: 'off', spellcheck: 'false', 'data-user-attr': '', class: 'bs-secret', 'aria-label': tr('Eşleşme Parolası') });
    secret.addEventListener('change', () => save({ secret: secret.value.trim() }));
    const short = (c.secret || '').length < 16;
    return el('section', { class: 'bs-card bs-form' }, [
      el('div', { class: 'group-label', text: 'Köprü' }),
      field(tr('Köprünün Adı'), name, 'Alıcıların listesinde görünen ad. Boşsa bilgisayarın adı.'),
      field(tr('Eşleşme Parolası'), el('div', { class: 'bs-row' }, [
        secret,
        el('button', { class: 'btn small ghost', type: 'button', text: showSecret ? 'Gizle' : 'Göster', onclick: () => { showSecret = !showSecret; draw(true); } }),
        c.secret ? copyBtn(c.secret) : null,
        el('button', { class: 'btn small', type: 'button', icon: 'refresh', text: 'Yeni Parola', onclick: async () => {
          if (c.secret && c.secret.length >= 16 && !window.confirm(tr('Yeni parola bağlı alıcıları düşürür; her alıcıya yeni parolayı girmeniz gerekir. Devam edilsin mi?'))) return;
          let s = '';
          try { s = await W.newSecret(); } catch { s = ''; }
          if (s) { showSecret = true; save({ secret: s }); }
        } }),
      ]), 'Köprüde ve her alıcıda aynı parola, en az 16 karakter. Parola ağa gitmez; iki taraf birbirini doğrular.'),
      short ? el('div', { class: 'br-err', text: 'Eşleşme parolası en az 16 karakter olmalı. Yeni Parola bir tane üretir; alıcıya aynısını girin.' }) : null,
      field(tr('Köprü Portu'), port, 'TCP bu port, keşif UDP 8742. Değişince alıcılar yeniden bağlanır; adres elle yazıldıysa alıcıda da değiştirin.'),
    ]);
  }

  function addressCard() {
    const port = (st && st.sender && st.sender.port) || cfg().port || 8741;
    const nodes = [el('div', { class: 'group-label', text: 'Bu Makinenin Adresleri' })];
    const list = el('div', { class: 'br-list' });
    addrs.forEach((a) => {
      const full = a.address + ':' + port;
      list.appendChild(el('div', { class: 'br-item bs-addr' }, [
        el('div', { class: 'br-item-main' }, [
          el('span', { class: 'br-item-t bs-mono', 'data-user-text': '', text: full }),
          el('span', { class: 'br-item-s' }, [el('span', { 'data-user-text': '', text: a.name }), a.virtual ? el('span', { text: ' · ' + tr('sanal bağdaştırıcı') }) : null]),
        ]),
        copyBtn(a.address),
      ]));
    });
    if (addrs.length) nodes.push(list);
    else nodes.push(el('div', { class: 'bs-warn', text: 'Ağ bağlantısı bulunamadı. Alıcılar bu köprüye ancak aynı ağdan bağlanabilir.' }));
    nodes.push(el('div', { class: 'bs-note', text: 'Alıcılar köprüyü kendiliğinden bulur. Bulamazsa (UDP engelli, farklı alt ağ) alıcının Köprünün Adresi alanına bu adreslerden birini yazın. Güvenlik duvarı köprü portuna (TCP) ve UDP 8742\'ye izin vermeli.' }));
    return el('section', { class: 'bs-card' }, nodes);
  }

  function startupCard() {
    const c = cfg();
    const au = (st && st.autostart) || { supported: false };
    const auNote = au.supported ? 'Bilgisayar açılıp oturum açılınca köprü penceresiz başlar; tepsiden açılır.'
      : au.reason === 'dev' ? 'Yalnız kurulu ya da taşınabilir sürümde.'
      : 'Bu sistemde sunulmuyor; köprüyü sistemin başlangıç öğelerine --bridge --hidden ile ekleyin.';
    return el('section', { class: 'bs-card bs-form' }, [
      el('div', { class: 'group-label', text: 'Açılış' }),
      check('Oturum Açılınca Köprüyü Başlat', au.on, async (v) => { try { await W.autostart(v); } catch { /* */ } refreshStatus(); }, { disabled: !au.supported, note: auNote }),
      check('Durum Penceresi Açılışta Açılmasın', c.startHidden, (v) => save({ startHidden: v }), { note: st && !st.tray ? 'Sistem tepsisi yokken pencere her zaman açılır.' : 'Köprü tepside başlar; pencere tepsiden açılır.' }),
    ]);
  }

  function modeCard() {
    const own = !!(st && st.ownProfile);
    return el('section', { class: 'bs-card bs-form' }, [
      el('div', { class: 'group-label', text: 'Kip' }),
      el('div', { class: 'bs-note', text: own
        ? 'Bu köprü ayrı açıldı (Ses Köprüsü kısayolu ya da --bridge): ayarları kendi klasöründe, olağan uygulamanın yanında çalışabilir.'
        : 'Uygulama yalnız ses köprüsü kipinde açıldı: görüntü, ışık ve yayın kapalı, GPU kullanılmıyor.' }),
      el('div', { class: 'bs-actions' }, [
        el('button', { class: 'btn small primary', type: 'button', text: own ? 'Köprüyü Kapat, Uygulamayı Aç' : 'Olağan Kipe Dön', onclick: async () => { try { await W.exitMode(); } catch { /* */ } } }),
        el('button', { class: 'btn small ghost', type: 'button', text: 'Gelişmiş Ayarlar (Panel)', onclick: () => W.action('panel') }),
      ]),
    ]);
  }

  /* ---- Çizim ---------------------------------------------------------- */
  function sig() {
    if (!st) return '';
    const s = st.sender || {};
    return JSON.stringify([tab, showSecret, st.paused, st.problem, st.tray, s.listening, s.error, s.name, s.port, (s.peers || []).map((p) => [p.addr, p.name, Math.round((p.rttMs || 0) / 5), Math.round((p.ageMs || 0) / 5), p.lost, p.dropped]), (s.authFails || []).map((f) => f.addr), st.wantedSources, st.sourceStates, st.captureStatus, st.capturing, st.nowPlaying, st.appFallback, st.analysis && [st.analysis.bpm, st.analysis.onsets, Math.round((st.analysis.ageMs || 0) / 20)], devices.length, apps.map((a) => [a.match, a.audible]), appStatus && appStatus.available, st.cfg, st.autostart, st.ownProfile, addrs]);
  }
  function draw(force) {
    const a = document.activeElement;
    // Yazı alanındayken ya da açık bir seçimdeyken yeniden çizilmez
    if (!force && a && app.contains(a) && (a.tagName === 'SELECT' || a.tagName === 'INPUT' && a.type !== 'checkbox' || a.tagName === 'TEXTAREA')) return;
    // Ölçerler canlı: yeniden çizim yalnız durum değişince
    const s = sig();
    if (!force && s === lastSig) return;
    lastSig = s;
    meters.clear();
    levelBox = null;
    const body = tab === 'sources' ? [sourceCard()]
      : tab === 'settings' ? [bridgeSettings(), addressCard(), startupCard(), modeCard()]
      : [summaryCard(), ...sourceWarnings(), levelCard(), receiversCard(), nowCard()];
    app.replaceChildren(header(), ...body);
    syncMeters();
  }
  // "Aygıtları Yenile": aygıtlar, uygulamalar ve uygulama yakalamanın durumu
  async function refresh() {
    try { devices = await W.devices(); } catch { devices = []; }
    try { appStatus = await W.appStatus(); } catch { appStatus = { available: false }; }
    try { apps = appStatus && appStatus.available !== false ? ((await W.appList()) || []) : []; } catch { apps = []; }
    draw(true);
  }
  async function loadAddrs() {
    try { addrs = (await W.addresses()) || []; } catch { addrs = []; }
    draw(false);
  }
  async function refreshStatus() {
    try { st = await W.status(); } catch { /* */ }
    draw(false);
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
  // Tepsiden "Köprü Ayarları": pencere Ayarlar sekmesinde açılır
  if (W.onGoto) W.onGoto((t) => { if (TABS.some((x) => x[0] === t)) { tab = t; if (t === 'settings') loadAddrs(); draw(true); } });
  // Tema canlı: paneldeki seçim ya da sistemin koyu/açık değişimi (#813)
  if (W.onTheme) W.onTheme((t) => { if (t && window.SVUiThemes) window.SVUiThemes.apply(document, t.id, !!t.dark); });
  (async () => {
    try { st = await W.status(); } catch { /* */ }
    draw(true);
    refresh();
    loadAddrs();
  })();
  // Ölçümler (yaş) ilerlesin; adresler arada bir (ağ değişebilir)
  let ticks = 0;
  setInterval(async () => {
    try { st = await W.status(); draw(false); } catch { /* */ }
    if (tab === 'settings' && ++ticks % 10 === 0) loadAddrs();
  }, 1000);
})();
