/*
 * SoundVisualizer — CaYaDev Ses Görselleştirici
 * Copyright (c) 2026 Çağan Turgut (CaYatur) — CaYaDev, https://cayadev.com
 * https://github.com/CaYatur/SoundVisualizer
 * SPDX-License-Identifier: MIT
 */
'use strict';
/* TELEFON BAĞLANTISI KARTI (#1054, docs/PHONE-LINK.md). Aç/kapa, eşleşme QR'ı ve kodu, yeni
   telefonun sayı onayı, eşleşmiş cihazlar (erişim, bağlantıyı kes, unut). Onay penceresi panelde
   hangi sayfa açık olursa olsun çıkar: telefon beklerken kartı aramak gerekmesin. Anahtarlar ve
   kimlik ana süreçte; burada yalnız durum. */
(function () {
  const P = () => window.SVPanel;
  const T = (s) => (window.SVI18n && window.SVI18n.t ? window.SVI18n.t(s) : s);
  const LEVELS = [['full', 'Tam'], ['edit', 'Düzenleme'], ['control', 'Kumanda'], ['view', 'İzle']];
  let st = null;
  let wired = false;
  let ticker = null;
  let asking = null; // açık onay penceresi: { no, close }

  function api() { return window.api || {}; }
  function refresh() {
    if (!api().phoneLinkStatus) return;
    api().phoneLinkStatus().then((s) => { st = s; redraw(); }).catch(() => {});
  }
  function redraw() {
    const box = document.querySelector('[data-phone-link]');
    if (box && box.isConnected) box.replaceWith(build());
    // Bekleyen onay artık yoksa (telefon vazgeçti, süre doldu) pencere kapanır
    if (asking && st && !(st.pending || []).some((x) => x.no === asking.no)) asking.close();
  }
  function wire() {
    if (wired || !api().onPhoneLinkState) return;
    wired = true;
    api().onPhoneLinkState((s) => { st = s; redraw(); });
    api().onPhoneLinkSas((p) => askSas(p));
  }

  function modal(title, body, buttons) {
    const el = P().el;
    let done = false;
    const backdrop = el('div', { class: 'ask-backdrop' });
    let onClose = null;
    const close = () => { if (done) return; done = true; document.removeEventListener('keydown', onKey, true); backdrop.remove(); if (onClose) onClose(); };
    const onKey = (e) => { if (e.key === 'Escape') { e.preventDefault(); buttons[0].run(); close(); } };
    const btns = buttons.map((b) => el('button', { class: 'btn ' + (b.cls || 'ghost'), type: 'button', text: T(b.text), onclick: () => { b.run(); close(); } }));
    backdrop.appendChild(el('div', { class: 'ask-panel', role: 'dialog', 'aria-modal': 'true', 'aria-label': T(title) }, [
      el('div', { class: 'ask-title', text: T(title) }), body, el('div', { class: 'ask-actions' }, btns),
    ]));
    document.body.appendChild(backdrop);
    document.addEventListener('keydown', onKey, true);
    btns[btns.length - 1].focus();
    close.then = (fn) => { onClose = fn; };
    return close;
  }

  /* Aynı anda iki telefon eşleşmek isterse pencereler SIRAYLA açılır. Eskiden yenisi eskisini
     kapatıyordu; eski istek ne onaylanıyor ne reddediliyordu, telefon süre dolana dek bekliyordu. */
  const answered = new Set();
  function nextSas() {
    setTimeout(() => {
      if (asking) return;
      const n = ((st && st.pending) || []).find((x) => !answered.has(x.no));
      if (n) askSas(n);
    }, 0);
  }
  function answer(no, ok) {
    answered.add(no);
    api().phoneLinkConfirm(no, ok);
  }
  function askSas(p) {
    if (!p || !P() || answered.has(p.no)) return;
    if (asking) return; // sırada: bu kapanınca nextSas açar
    const el = P().el;
    const digits = String(p.digits || '');
    const body = el('div', { class: 'ask-text' }, [
      el('div', { text: (p.name || T('Telefon')) + (p.model ? ' · ' + p.model : '') }),
      el('div', { class: 'pl-sas', text: digits.slice(0, 3) + ' ' + digits.slice(3), 'aria-label': T('Doğrulama sayısı') + ' ' + digits }),
      el('div', { class: 'note', text: T('Telefondaki sayıyla karşılaştırın. Farklıysa reddedin: ağda araya giren biri olabilir. Onaylanan telefon tam erişimle başlar, aşağıdaki listeden değiştirebilirsiniz.') }),
    ]);
    const close = modal('Yeni telefon bağlanmak istiyor', body, [
      { text: 'Reddet', run: () => answer(p.no, false) },
      { text: 'Aynı, onayla', cls: 'primary', run: () => answer(p.no, true) },
    ]);
    // Düğmeyle kapanınca da sıradaki açılsın
    close.then(() => { if (asking && asking.no === p.no) { asking = null; nextSas(); } });
    asking = { no: p.no, close: () => close() };
  }

  function askForget(name, run) {
    const el = P().el;
    modal('Cihazı unut', el('div', { class: 'ask-text', text: name + ': ' + T('bu telefon yeniden bağlanmak için baştan eşleşmek zorunda kalır.') }), [
      { text: 'Vazgeç', run: () => {} },
      { text: 'Unut', cls: 'danger', run },
    ]);
  }

  function since(ms) {
    if (!ms) return '';
    const s = Math.max(0, Math.round((Date.now() - ms) / 1000));
    if (s < 60) return T('az önce');
    if (s < 3600) return T('{n} dk önce').replace('{n}', String(Math.floor(s / 60)));
    if (s < 86400) return T('{n} sa önce').replace('{n}', String(Math.floor(s / 3600)));
    return T('{n} gün önce').replace('{n}', String(Math.floor(s / 86400)));
  }

  function pairingBox() {
    const el = P().el;
    const p = st && st.pairing;
    if (!p) {
      return el('div', { class: 'pl-pair' }, [
        el('button', { class: 'btn primary', type: 'button', icon: 'phone', text: T('Telefon Ekle'), onclick: () => api().phoneLinkNewCode().then(refresh) }),
        el('div', { class: 'note', text: T('Telefonda: Ayarlar → PC\'ye Bağlan. Eşleşme için QR ya da kod gösterilir.') }),
      ]);
    }
    const qr = el('div', { class: 'pl-qr', role: 'img', 'aria-label': T('Eşleşme QR kodu') });
    // QR siyah-beyaz kalır: okuyucular renkli ve koyu zeminli kodda zorlanıyor
    qr.innerHTML = window.SVQr ? window.SVQr.svg(p.qr, { ecc: 'L', label: T('Eşleşme QR kodu') }) : '';
    const left = el('div', { class: 'pl-left', text: '' });
    const tick = () => {
      const s = Math.max(0, Math.ceil((p.expiresAt - Date.now()) / 1000));
      left.textContent = T('{s} sn sonra yenilenir · tek kullanımlık').replace('{s}', String(s));
      // Süre dolunca panel açıkken kendiliğinden yeni kod
      if (s <= 0 && st && st.pairing === p) { st.pairing = null; api().phoneLinkNewCode().then(refresh); }
    };
    tick();
    if (ticker) clearInterval(ticker);
    ticker = setInterval(() => { if (!left.isConnected) { clearInterval(ticker); ticker = null; return; } tick(); }, 1000);
    // Yazıda en olası adres; QR bütün adresleri taşır, telefon sırayla dener
    const addrs = (st.addresses || []).slice(0, 1).map((a) => a + ':' + st.port);
    return el('div', { class: 'pl-pair' }, [
      qr,
      el('div', { class: 'pl-pair-txt' }, [
        el('div', { class: 'note', text: T('Telefonda: Ayarlar → PC\'ye Bağlan → QR. Okunmazsa adres ve kodla bağlanın:') }),
        el('div', { class: 'pl-addr mono', text: addrs[0] || T('Ağ adresi bulunamadı') }),
        el('div', { class: 'pl-code mono', text: p.code.slice(0, 3) + ' ' + p.code.slice(3) }),
        left,
        el('button', { class: 'btn ghost', type: 'button', text: T('Yeni Kod'), onclick: () => api().phoneLinkNewCode().then(refresh) }),
      ]),
    ]);
  }

  function deviceRows() {
    const el = P().el;
    const list = (st && st.devices) || [];
    if (!list.length) return el('div', { class: 'note', text: T('Henüz eşleşmiş telefon yok.') });
    const rows = list.map((d) => {
      const sel = el('select', { class: 'p-in', 'aria-label': T('Erişim') + ': ' + d.name, onchange: (e) => api().phoneLinkSetLevel(d.id, e.target.value).then(refresh) },
        LEVELS.map(([v, l]) => el('option', { value: v, text: T(l) })));
      sel.value = d.level;
      return el('div', { class: 'pl-dev' + (d.online ? ' on' : '') }, [
        el('span', { class: 'sv-led' }),
        el('div', { class: 'pl-dev-txt' }, [
          el('b', { text: d.name + (d.model ? ' · ' + d.model : '') }),
          el('span', { class: 'note', text: d.online ? T('Bağlı') : T('Çevrimdışı') + (d.lastSeen ? ' · ' + since(d.lastSeen) : '') }),
        ]),
        sel,
        d.online ? el('button', { class: 'btn ghost', type: 'button', text: T('Bağlantıyı Kes'), onclick: () => api().phoneLinkDisconnect(d.id).then(refresh) }) : null,
        el('button', { class: 'btn ghost', type: 'button', text: T('Unut'), onclick: () => askForget(d.name, () => api().phoneLinkForget(d.id).then(refresh)) }),
      ]);
    });
    return el('div', { class: 'pl-devs' }, rows);
  }

  /* TELEFONUN SESİ (B4): telefonda çalan, mikrofona gelen ya da uygulama içi çaların sesi bu
     bilgisayarın ses girişi olur. Telefon susarsa yedek giriş (yerel yakalama) açılır. */
  function audioBox() {
    const p = P();
    const el = p.el;
    const cfg = p.cfg();
    const a = cfg.phoneLink.audioIn || (cfg.phoneLink.audioIn = { enabled: false, device: '', fallback: true });
    const ai = (st && st.audioIn) || {};
    const devs = (st && st.devices) || [];
    const sel = el('select', { class: 'p-in', 'aria-label': T('Hangi telefon'), onchange: (e) => { a.device = e.target.value; p.push(true); setTimeout(refresh, 300); } },
      [el('option', { value: '', text: T('Gönderen herhangi bir telefon') })].concat(devs.map((d) => el('option', { value: d.id, text: d.name + (d.model ? ' · ' + d.model : '') }))));
    sel.value = a.device || '';
    const STATE = { bridge: 'Ses telefondan geliyor', waiting: 'Telefondan ses bekleniyor', fallback: 'Telefon sessiz: yerel giriş kullanılıyor', off: 'Kapalı' };
    const kbps = ai.stats && ai.stats.sampleRate ? ' · ' + Math.round(ai.stats.sampleRate / 1000) + ' kHz' : '';
    return el('div', { class: 'pl-audio' }, [
      el('div', { class: 'lbl', text: T('Telefonun Sesi') }),
      p.toggle(T('Telefonun Sesini Ses Girişi Yap'), 'phoneLink.audioIn.enabled'),
      a.enabled ? el('div', { class: 'ctrl' }, [el('label', { class: 'lbl', text: T('Hangi telefon') }), sel]) : null,
      a.enabled ? p.toggle(T('Telefon Susunca Yerel Girişe Dön'), 'phoneLink.audioIn.fallback') : null,
      a.enabled ? el('div', { class: 'note', text: T(STATE[ai.state] || STATE.off) + (ai.name ? ' · ' + ai.name : '') + kbps }) : null,
      el('div', { class: 'note', text: T('Telefonda Ses → "PC\'ye gönder" açılınca telefonun sesi (mikrofon, telefonda çalan müzik ya da uygulama içi çalar) bu bilgisayarın ses girişi olur. Görüntü, ışık ve tempo bu sese tepki verir.') }),
    ].filter(Boolean));
  }

  function build() {
    const p = P();
    const el = p.el;
    const cfg = p.cfg();
    if (!cfg.phoneLink) cfg.phoneLink = { enabled: false, discoverable: true };
    if (!cfg.phoneLink.audioIn) cfg.phoneLink.audioIn = { enabled: false, device: '', fallback: true };
    const on = cfg.phoneLink.enabled === true;
    const running = !!(st && st.running);
    const online = ((st && st.devices) || []).filter((d) => d.online).length;
    const statusText = !on ? T('Kapalı. Ağdan bağlantı kabul edilmez.')
      : st && st.error ? T('Açılamadı') + ': ' + (st.error === 'PORT_IN_USE' ? T('bağlantı noktası kullanımda') : st.error)
        : running ? T('Açık') + ' · ' + T('{n} telefon bağlı').replace('{n}', String(online)) : T('Açılıyor…');
    const nodes = [
      p.moduleHead({
        id: 'phonelink', title: 'Telefon Bağlantısı', on, error: on && st && !!st.error,
        status: el('span', { class: 'note', text: statusText }),
        toggle: (next) => { cfg.phoneLink.enabled = !!next; p.push(true); setTimeout(refresh, 400); },
      }),
    ];
    if (on) {
      nodes.push(pairingBox());
      if (st && st.pending && st.pending.length && !asking) nextSas();
    }
    nodes.push(el('div', { class: 'lbl', text: T('Eşleşmiş cihazlar') }), deviceRows());
    if (st && st.devices && st.devices.length > 1) {
      nodes.push(el('button', { class: 'btn ghost', type: 'button', text: T('Hepsini Unut'), onclick: () => askForget(T('Bütün telefonlar'), () => api().phoneLinkForgetAll().then(refresh)) }));
    }
    nodes.push(p.toggle(T('Ağda Görünür Ol'), 'phoneLink.discoverable'));
    if (on) nodes.push(audioBox());
    nodes.push(el('div', { class: 'note', text: T('Bağlantı açıkken telefon aynı ağdan bu bilgisayarı yönetebilir. Trafik şifrelidir; yayın sayfaları ve dosyalar bu yüzden ağa açılmaz. Windows ilk açılışta güvenlik duvarı izni sorar: "Özel ağlar"ı seçin. Misafir ağlarında cihazlar birbirini görmeyebilir.') }));
    if (st && st.keysError) {
      nodes.push(el('div', { class: 'note warn', text: T('Bağlantı anahtarları okunamadı (sistemin anahtar koruması şu an kullanılamıyor olabilir). Dosyaya dokunulmadı; eşleşmiş telefonlar korunuyor. Uygulamayı yeniden başlatmayı deneyin. Sorun sürerse anahtarları yeniden kurun: bütün telefonlar baştan eşleşir.') }));
      nodes.push(el('button', { class: 'btn ghost', type: 'button', text: T('Anahtarları Yeniden Kur'), onclick: () => askForget(T('Bütün telefonlar'), () => api().phoneLinkForgetAll().then(refresh)) }));
    }
    if (st && st.safe === false) nodes.push(el('div', { class: 'note warn', text: T('Bu sistemde anahtar koruması yok: telefon anahtarları uygulama klasöründe korumasız durur.') }));
    return el('div', { class: 'control-panel pl-panel', 'data-phone-link': '1' }, nodes);
  }

  function panel() {
    wire();
    if (!st) refresh();
    return build();
  }

  // Panel açılır açılmaz olaylar dinlensin: onay penceresi kart açılmadan da gelsin
  function init() { wire(); refresh(); }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();

  window.SVPhoneLinkPanel = { panel, refresh };
})();
