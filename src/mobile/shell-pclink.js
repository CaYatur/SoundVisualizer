/*
 * SoundVisualizer — CaYaDev Ses Görselleştirici
 * Copyright (c) 2026 Çağan Turgut (CaYatur) — CaYaDev, https://cayadev.com
 * https://github.com/CaYatur/SoundVisualizer
 * SPDX-License-Identifier: MIT
 */
'use strict';
/* PC'YE BAĞLAN (Ayarlar → Veri ve bağlantı). Eşleşme ve bağlantı (docs/PHONE-LINK.md, taslak
   14–15–21): kayıtlı bilgisayarlar, ağda bulunanlar, QR ile ya da adres ve kodla eşleşme, sayı
   karşılaştırma, durum ve hatalar. Ağ ve şifreleme uygulamada (link/PcLink.kt); burada yalnız
   arayüz. QR kamerası sayfada açılır, kareler gri tonlu ve küçük yollanır, çözme uygulamada. */
(function () {
  if (typeof window === 'undefined' || !window.SVShell || !window.SVShellUI) return;
  const S = window.SVShell;
  const U = window.SVShellUI;
  const { h, icon, A } = S;
  const tr = (s) => (window.SVI18n && window.SVI18n.t ? window.SVI18n.t(s) : s);
  const en = () => !!(window.SVI18n && window.SVI18n.locale === 'en');

  let st = { state: 'idle', saved: [], discovered: [] };
  let wired = false;
  const watchers = new Set();
  function wire() {
    if (wired || !A().link) return;
    wired = true;
    A().link.onState((v) => { st = v || st; for (const w of watchers) w(); });
    A().link.status().then((v) => { st = v || st; for (const w of watchers) w(); }, () => {});
  }

  // Hata kodları (uygulama ve masaüstü) → kullanıcı cümlesi
  const ERR = {
    unreachable: 'Bilgisayara ulaşılamadı. Aynı ağda mısınız, bilgisayarda Telefon Bağlantısı açık mı?',
    'link-off': 'Bilgisayarda Telefon Bağlantısı kapalı. Ayarlar → Kontrol → Telefon Bağlantısı.',
    'pairing-closed': 'Bilgisayarda eşleşme açık değil. Orada "Telefon Ekle"ye basın.',
    'bad-code': 'Kod yanlış. Bilgisayarda görünen altı rakamı girin.',
    'too-many': 'Çok fazla yanlış deneme. Bilgisayarda yeni kod oluşturun.',
    'bad-secret': 'Bu QR kod artık geçerli değil. Bilgisayardaki güncel kodu okutun.',
    'bad-qr': 'Bu bir SoundVisualizer eşleşme kodu değil.',
    'wrong-pc': 'Bağlanılan bilgisayar beklenen bilgisayar değil. Bağlantı kesildi.',
    'bad-commit': 'Bilgisayarın yanıtı doğrulanamadı. Bağlantı kesildi; QR ile deneyin.',
    rejected: 'Bilgisayarda reddedildi.',
    timeout: 'Süre doldu. Yeniden deneyin.',
    'unknown-device': 'Bu telefon bilgisayarın listesinden çıkarılmış. Yeniden eşleşin.',
    protocol: 'Bilgisayardaki uygulama bu sürümle uyumsuz. İkisini de güncelleyin.',
    lost: 'Bağlantı koptu.',
  };
  const errText = (c) => tr(ERR[c] || 'Bağlanılamadı.') + (ERR[c] ? '' : ' (' + c + ')');
  const LEVEL = { full: 'Tam erişim', edit: 'Düzenleme', control: 'Kumanda', view: 'İzle' };

  function since(ms) {
    if (!ms) return '';
    const s = Math.max(0, Math.round((Date.now() - ms) / 1000));
    if (s < 60) return tr('az önce');
    if (s < 3600) return tr('{n} dk önce').replace('{n}', String(Math.floor(s / 60)));
    if (s < 86400) return tr('{n} sa önce').replace('{n}', String(Math.floor(s / 3600)));
    return tr('{n} gün önce').replace('{n}', String(Math.floor(s / 86400)));
  }
  const digitsOf = (d) => (d ? String(d).slice(0, 3) + ' ' + String(d).slice(3) : '');

  // ---- QR kamerası
  let cam = null; // { stream, video, timer }
  function stopCam() {
    if (!cam) return;
    clearInterval(cam.timer);
    try { cam.stream.getTracks().forEach((t) => t.stop()); } catch { /* */ }
    cam = null;
  }
  function startCam(video, onText, onError) {
    stopCam();
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) { onError('no-camera'); return; }
    navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment', width: { ideal: 1280 }, height: { ideal: 720 } }, audio: false }).then((stream) => {
      video.srcObject = stream;
      video.play().catch(() => {});
      const canvas = document.createElement('canvas');
      const g = canvas.getContext('2d', { willReadFrequently: true });
      let busy = false;
      cam = { stream, video, timer: setInterval(() => {
        if (busy || !video.videoWidth) return;
        // Küçük gri kare: 640 genişliğe kadar (kod ekranın ortasında, yeterli çözünürlük)
        const scale = Math.min(1, 640 / video.videoWidth);
        const w = Math.round(video.videoWidth * scale), hh = Math.round(video.videoHeight * scale);
        canvas.width = w; canvas.height = hh;
        g.drawImage(video, 0, 0, w, hh);
        const rgba = g.getImageData(0, 0, w, hh).data;
        const gray = new Uint8Array(w * hh);
        for (let i = 0, j = 0; j < gray.length; i += 4, j++) gray[j] = (rgba[i] * 77 + rgba[i + 1] * 150 + rgba[i + 2] * 29) >> 8;
        let bin = '';
        for (let i = 0; i < gray.length; i += 0x8000) bin += String.fromCharCode.apply(null, gray.subarray(i, i + 0x8000));
        busy = true;
        A().link.qrFrame(w, hh, btoa(bin)).then((text) => { busy = false; if (text && cam) onText(text); }, () => { busy = false; });
      }, 300) };
    }, (e) => onError(String((e && e.name) || e)));
  }

  function page() {
    let view = 'list';
    let form = { host: '', port: '8722', code: '' };
    let msg = '';
    let summary = null; // bağlıyken bilgisayarın özeti (state.get)
    let summaryFor = '';
    let redraw = null;
    return {
      size: 'full',
      title: 'PC\'ye Bağlan',
      onLeave() {
        stopCam();
        if (redraw) watchers.delete(redraw);
        if (A().link) A().link.discover(false).catch(() => {});
      },
      render(body, ctx) {
        wire();
        if (!redraw) {
          redraw = () => { if (body.isConnected || ctx.top) ctx.refresh(); };
          watchers.add(redraw);
          if (A().link) A().link.discover(true).catch(() => {});
        }
        if (!A().link) { body.appendChild(h('div', { class: 'hint', text: 'Bu sürümde PC bağlantısı yok.' })); return; }
        if (view === 'qr') return renderQr(body, ctx);
        if (view === 'code') return renderCode(body, ctx);
        stopCam();

        body.appendChild(h('div', { class: 'hint', text: 'Telefon ve bilgisayar aynı Wi-Fi ağında olmalı. Bilgisayarda Ayarlar → Kontrol → Telefon Bağlantısı\'nı açın.' }));
        statusCard(body, ctx);

        const saved = st.saved || [];
        if (saved.length) {
          body.appendChild(h('div', { class: 'section-label', text: 'Kayıtlı bilgisayarlar' }));
          body.appendChild(h('div', { class: 'card nav-card' }, saved.map((p, i) => {
            const on = st.state === 'connected' && st.pc && st.pc.id === p.id;
            const auto = h('button', {
              class: 'toggle', role: 'switch', 'aria-label': tr('Kendiliğinden bağlan') + ': ' + p.name, 'aria-checked': p.auto ? 'true' : 'false',
              onclick: () => { A().link.setAuto(p.id, !p.auto).catch(() => {}); },
            });
            const sub = (on ? tr('Bağlı') : (p.lastSeen ? tr('Son bağlantı') + ' ' + since(p.lastSeen) : '')) + ' · ' + tr(LEVEL[p.level] || p.level);
            return h('div', {}, [
              i ? h('div', { class: 'divider flush' }) : null,
              h('div', { class: 'ctl-row' }, [
                icon('monitor'),
                h('div', { class: 'row-text' }, [h('div', { class: 'row-title small', 'data-user-text': '', text: p.name }), h('div', { class: 'row-sub', text: sub })]),
                on ? h('button', { class: 'btn ghost', onclick: () => A().link.disconnect().catch(() => {}) }, [h('span', { text: 'Bağlantıyı Kes' })])
                  : h('button', { class: 'btn', onclick: () => { msg = ''; A().link.connect(p.id).catch((e) => { msg = errText(String(e && e.message)); ctx.refresh(); }); } }, [h('span', { text: 'Bağlan' })]),
                h('button', { class: 'iconbtn plain', 'aria-label': tr('Unut') + ': ' + p.name, title: tr('Unut'), onclick: () => {
                  S.confirm(p.name + ': ' + tr('yeniden bağlanmak için baştan eşleşmek gerekir.'), tr('Unut'), true).then((yes) => { if (yes) A().link.forget(p.id).catch(() => {}); });
                } }, [icon('x')]),
              ]),
              h('div', { class: 'ctl-row' }, [h('div', { class: 'row-text' }, [h('div', { class: 'row-sub', text: 'Uygulama açılınca bu bilgisayara kendiliğinden bağlan' })]), auto]),
            ]);
          })));
        }

        body.appendChild(h('div', { class: 'section-label', text: 'Yeni bilgisayar ekle' }));
        body.appendChild(h('div', { class: 'btn-row link-add' }, [
          h('button', { class: 'btn primary', onclick: () => { view = 'qr'; msg = ''; ctx.refresh(); } }, [icon('camera'), h('span', { text: 'QR Kodu Okut' })]),
          h('button', { class: 'btn', onclick: () => { view = 'code'; msg = ''; ctx.refresh(); } }, [icon('pencil'), h('span', { text: 'Adres ve Kodla' })]),
        ]));

        const savedIds = new Set(saved.map((p) => p.id));
        const savedNames = new Set(saved.map((p) => String(p.name || '').toLocaleLowerCase('tr')));
        const found = (st.discovered || []).filter((d) => d && !savedIds.has(d.id) && !savedNames.has(String(d.name || '').toLocaleLowerCase('tr')));
        body.appendChild(h('div', { class: 'section-label', text: 'Ağda bulunanlar' }));
        if (found.length) {
          body.appendChild(h('div', { class: 'card nav-card' }, found.map((d, i) => h('div', {}, [
            i ? h('div', { class: 'divider flush' }) : null,
            h('div', { class: 'ctl-row' }, [
              icon('monitor'),
              h('div', { class: 'row-text' }, [h('div', { class: 'row-title small', 'data-user-text': '', text: d.name || d.address }), h('div', { class: 'row-sub mono', text: d.address + ':' + d.port + ' · ' + tr('eşleşmemiş') })]),
              h('button', { class: 'btn', onclick: () => { form = { host: d.address, port: String(d.port), code: '' }; view = 'code'; msg = ''; ctx.refresh(); } }, [h('span', { text: 'Eşleş' })]),
            ]),
          ]))));
        } else {
          body.appendChild(h('div', { class: 'hint' }, [h('span', { text: 'Aranıyor… Listede yoksa: bilgisayarda bağlantı açık mı, "Ağda görünür ol" seçili mi, misafir ağında mısınız, Windows güvenlik duvarı izin verdi mi?' })]));
        }
      },
    };

    function statusCard(body, ctx) {
      const s = st.state;
      const pcName = st.pc && st.pc.name ? st.pc.name : tr('Bilgisayar');
      const cancel = h('button', { class: 'btn ghost', onclick: () => A().link.cancel().catch(() => {}) }, [h('span', { text: 'Vazgeç' })]);
      if (s === 'connected') {
        if (summaryFor !== (st.pc && st.pc.id)) {
          summaryFor = st.pc && st.pc.id;
          summary = null;
          A().link.request('state.get', {}).then((r) => { summary = r && r.ok ? r.result : null; ctx.refresh(); }, () => {});
        }
        const scenes = summary && Array.isArray(summary.scenes) ? summary.scenes.length : null;
        body.appendChild(h('div', { class: 'banner info ok', role: 'status' }, [icon('check-circle'), h('div', { class: 'grow-text' }, [
          h('div', { class: 'row-title small', 'data-user-text': '', text: pcName }),
          h('div', { class: 'row-sub', text: tr('Bağlı') + ' · ' + tr(LEVEL[st.level] || st.level) + (scenes != null ? ' · ' + tr('{n} sahne').replace('{n}', String(scenes)) : '') }),
        ])]));
        return;
      }
      summaryFor = '';
      if (s === 'connecting' || s === 'reconnecting') {
        body.appendChild(h('div', { class: 'banner info', role: 'status' }, [icon('refresh'), h('div', { class: 'grow-text', text: s === 'connecting' ? 'Bağlanıyor…' : 'Bağlantı koptu, yeniden bağlanıyor…' }), cancel]));
      } else if (s === 'approve' || s === 'sas') {
        body.appendChild(h('div', { class: 'card ctl link-sas', role: 'status' }, [
          h('div', { class: 'row-title', text: s === 'approve' ? 'Bilgisayarda onaylayın' : 'Sayıları karşılaştırın' }),
          h('div', { class: 'link-digits mono', 'aria-label': tr('Doğrulama sayısı') + ' ' + (st.digits || ''), text: digitsOf(st.digits) }),
          h('div', { class: 'row-sub', text: 'Bilgisayarın ekranında aynı altı rakam görünüyorsa orada "Aynı, onayla"ya basın. Farklıysa vazgeçin: ağda araya giren biri olabilir.' }),
          h('div', { class: 'btn-row' }, [cancel]),
        ]));
      } else if (s === 'error' && st.error) {
        body.appendChild(h('div', { class: 'banner', role: 'alert' }, [icon('warning'), h('div', { class: 'grow-text', text: errText(st.error) })]));
      }
      if (msg) body.appendChild(h('div', { class: 'banner', role: 'alert' }, [icon('warning'), h('div', { class: 'grow-text', text: msg })]));
    }

    function renderQr(body, ctx) {
      const video = h('video', { class: 'link-cam', playsinline: '', muted: '', 'aria-label': tr('Kamera görüntüsü') });
      body.appendChild(h('div', { class: 'link-cam-box' }, [video, h('div', { class: 'link-cam-frame', 'aria-hidden': 'true' })]));
      body.appendChild(h('div', { class: 'hint', text: 'Bilgisayardaki QR kodu çerçeveye getirin. Kamera yalnız okurken açıktır; görüntü kaydedilmez, hiçbir yere gönderilmez.' }));
      const err = h('div', { class: 'banner', role: 'alert', hidden: true });
      body.appendChild(err);
      ctx.foot.appendChild(h('div', { class: 'btn-row' }, [
        h('button', { class: 'btn ghost', onclick: () => { stopCam(); view = 'list'; ctx.refresh(); } }, [h('span', { text: 'Vazgeç' })]),
        h('button', { class: 'btn', onclick: () => { stopCam(); view = 'code'; ctx.refresh(); } }, [h('span', { text: 'Adres ve Kodla' })]),
      ]));
      startCam(video, (text) => {
        stopCam();
        view = 'list';
        A().link.pairQr(text).catch((e) => { msg = errText(String(e && e.message)); });
        ctx.refresh();
      }, (code) => {
        err.hidden = false;
        err.textContent = tr('Kamera açılamadı.') + ' (' + code + ')';
      });
    }

    function renderCode(body, ctx) {
      const field = (label, key, attrs) => {
        const input = h('input', Object.assign({ class: 'field mono', value: form[key], oninput: (e) => { form[key] = e.target.value; } }, attrs || {}));
        return h('label', { class: 'ctl-row column' }, [h('span', { class: 'ctl-label', text: label }), input]);
      };
      body.appendChild(h('div', { class: 'hint', text: 'Bilgisayarda Telefon Bağlantısı kartında "Telefon Ekle"ye basın; adres ve altı rakamlı kod orada görünür.' }));
      body.appendChild(h('div', { class: 'card ctl' }, [
        field('Bilgisayarın adresi', 'host', { inputmode: 'decimal', autocomplete: 'off', placeholder: '192.168.1.24' }),
        field('Bağlantı noktası', 'port', { inputmode: 'numeric', autocomplete: 'off' }),
        field('Eşleşme kodu', 'code', { inputmode: 'numeric', autocomplete: 'one-time-code', maxlength: '7', placeholder: '000 000' }),
      ]));
      if (msg) body.appendChild(h('div', { class: 'banner', role: 'alert' }, [icon('warning'), h('div', { class: 'grow-text', text: msg })]));
      ctx.foot.appendChild(h('div', { class: 'btn-row' }, [
        h('button', { class: 'btn ghost', onclick: () => { view = 'list'; msg = ''; ctx.refresh(); } }, [h('span', { text: 'Vazgeç' })]),
        h('button', { class: 'btn primary', onclick: () => {
          const code = String(form.code).replace(/\D/g, '');
          const host = String(form.host).trim();
          const port = parseInt(form.port, 10) || 8722;
          if (code.length !== 6 || !host) { msg = tr('Adres ve altı rakamlı kodu girin.'); ctx.refresh(); return; }
          msg = '';
          A().link.pairCode(host, port, code).then(() => { view = 'list'; ctx.refresh(); }, (e) => { msg = errText(String(e && e.message)); ctx.refresh(); });
        } }, [h('span', { text: 'Bağlan' })]),
      ]));
    }
  }

  /* Ayarlar satırının alt yazısı: bağlıysa bilgisayarın adı. */
  function rowSub() {
    wire();
    if (st.state === 'connected' && st.pc) return tr('Bağlı') + ': ' + st.pc.name;
    if (st.state === 'reconnecting') return tr('Yeniden bağlanıyor…');
    return tr('Bilgisayarı telefondan yönetin');
  }

  window.SVShellPcLink = Object.freeze({ page, rowSub, state: () => st, onChange: (cb) => { wire(); watchers.add(cb); return () => watchers.delete(cb); } });
})();
