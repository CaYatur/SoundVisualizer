/*
 * SoundVisualizer — CaYaDev Ses Görselleştirici
 * Copyright (c) 2026 Çağan Turgut (CaYatur) — CaYaDev, https://cayadev.com
 * https://github.com/CaYatur/SoundVisualizer
 * SPDX-License-Identifier: MIT
 */
'use strict';
/* ÖNİZLEME MODU ARAYÜZÜ (#1167, #1168, #1169).

   Üst çubuktaki "Önizleme" düğmesi modu açar (varsayılan KAPALI). Açıkken Sahne ve Zaman
   sayfaları taslağı düzenler, çıkış ekranları Program'da kalır. Şerit: Program monitörü,
   geçiş seçimi, Sahneye Gönder, son gönderimi geri al, dondur, sessiz, sahne olarak kaydet,
   Program'dan kopyala, boşalt ve çık. Asıl mantık admin.js'te (SVPanel.draft*). */
(function () {
  const P = () => window.SVPanel;
  const tr = (s) => (window.SVI18n && window.SVI18n.t ? window.SVI18n.t(s) : s);
  const SNAP_MS = 1500;
  const BEAT_WAIT_MS = 2500;

  let btn = null;
  let bar = null;
  let snapTimer = 0;
  let snapBusy = false;
  let beatRaf = 0;
  let beatDeadline = 0;
  const ui = {};

  function el(tag, props, kids) {
    const n = document.createElement(tag);
    for (const [k, v] of Object.entries(props || {})) {
      if (k === 'text') n.textContent = v;
      else if (k === 'onclick') n.addEventListener('click', v);
      else n.setAttribute(k, v);
    }
    (kids || []).forEach((c) => c && n.appendChild(c));
    return n;
  }
  function iconBtn(icon, label, title, onclick, cls) {
    const b = el('button', { type: 'button', class: 'btn small' + (cls ? ' ' + cls : ''), title: tr(title || label), onclick });
    if (window.SVIcons) window.SVIcons.set(b, icon, tr(label));
    else b.textContent = tr(label);
    return b;
  }

  function armed() { return !!(P() && P().draftArmed && P().draftArmed()); }

  function buildBar() {
    ui.monitor = el('img', { class: 'sv-pvw-mon', alt: '' });
    ui.monNote = el('span', { class: 'sv-pvw-monnote', text: tr('Çıkış kapalı') });
    ui.mode = el('select', { class: 'sv-pvw-mode', title: tr('Geçiş') }, [
      el('option', { value: 'fade', text: tr('Çapraz geçiş') }),
      el('option', { value: 'cut', text: tr('Kes') }),
      el('option', { value: 'scene', text: tr('Sahnenin geçişi') }),
    ]);
    ui.mode.value = localStorage.getItem('sv-pvw-mode') || 'fade';
    ui.mode.addEventListener('change', () => { localStorage.setItem('sv-pvw-mode', ui.mode.value); sync(); });
    ui.secs = el('input', { type: 'number', min: '0.1', max: '10', step: '0.1', class: 'sv-pvw-secs', title: tr('Geçiş süresi (sn)') });
    ui.secs.value = localStorage.getItem('sv-pvw-secs') || '1';
    ui.secs.addEventListener('change', () => localStorage.setItem('sv-pvw-secs', ui.secs.value));
    ui.beat = el('input', { type: 'checkbox', class: 'sv-pvw-beat' });
    ui.beat.checked = localStorage.getItem('sv-pvw-beat') === '1';
    ui.beat.addEventListener('change', () => localStorage.setItem('sv-pvw-beat', ui.beat.checked ? '1' : '0'));
    const beatLbl = el('label', { class: 'sv-pvw-beatlbl', title: tr('Bir sonraki vuruşta gönder') }, [ui.beat, el('span', { text: tr('Vuruşta') })]);
    ui.take = iconBtn('broadcast', 'Sahneye Gönder', 'Taslağı yayına gönder (Ctrl+Shift+Enter)', () => take(), 'primary sv-pvw-take');
    ui.revert = iconBtn('undo', 'Geri Al', 'Son gönderimi geri al', () => { P().draftRevert(); sync(); });
    ui.freeze = iconBtn('pause', 'Dondur', 'Çıkışta son kareyi tut', () => toggleSafety('freeze'));
    ui.mute = iconBtn('mute', 'Sessiz', 'Uygulamanın çaldığı sesi kapat', () => toggleSafety('mute'));
    ui.black = iconBtn('moon', 'Karart', 'Program\'ı karart', () => { P().toggleBlackout(); sync(); });
    const save = iconBtn('save', 'Sahne Olarak Kaydet', 'Taslağı kayıtlı sahnelere ekle; Canlı sayfasından çağrılabilir', () => { P().saveScene(); P().toast(tr('Taslak sahne olarak kaydedildi.'), 'ok'); });
    const copy = iconBtn('layers', 'Program\'dan Kopyala', 'Taslağı yayındaki görünüme döndür', () => P().draftFromProgram());
    const clear = iconBtn('x', 'Boşalt', 'Taslağın sahnesini boşalt (aygıt ve ağ ayarları kalır)', () => P().draftClearScene());
    const exit = iconBtn('x', 'Çık', 'Önizleme modundan çık', () => leave());
    bar = el('div', { id: 'svPreviewBar', class: 'sv-pvw-bar', role: 'region', 'aria-label': tr('Önizleme') }, [
      el('span', { class: 'sv-pvw-badge', text: tr('ÖNİZLEME — yayında değil') }),
      el('div', { class: 'sv-pvw-pgm', title: tr('Program: seyircinin gördüğü') }, [el('span', { class: 'sv-pvw-pgmlbl', text: 'PGM' }), ui.monitor, ui.monNote]),
      ui.mode, ui.secs, beatLbl, ui.take, ui.revert,
      el('span', { class: 'sv-pvw-sep' }),
      ui.freeze, ui.mute, ui.black,
      el('span', { class: 'sv-pvw-sep' }),
      save, copy, clear, exit,
    ]);
    bar.hidden = true;
    const top = document.querySelector('header.topbar');
    if (top && top.parentNode) top.parentNode.insertBefore(bar, top.nextSibling);
    else document.body.insertBefore(bar, document.body.firstChild);
  }

  function sync() {
    const on = armed();
    document.body.toggleAttribute('data-preview-mode', on);
    if (btn) {
      btn.classList.toggle('on', on);
      btn.setAttribute('aria-pressed', on ? 'true' : 'false');
    }
    if (!bar) return;
    bar.hidden = !on;
    if (!on) return;
    const st = P().outputSafetyState();
    ui.freeze.classList.toggle('on', st.freeze);
    ui.mute.classList.toggle('on', st.mute);
    ui.black.classList.toggle('on', !!P().isBlackedOut());
    ui.revert.disabled = !P().draftCanRevert();
    ui.secs.hidden = ui.mode.value !== 'fade';
    ui.take.classList.toggle('wait', !!beatRaf);
  }

  function toggleSafety(kind) {
    const st = P().outputSafetyState();
    P().outputSafety({ [kind]: !st[kind] });
    sync();
  }

  function doTake() {
    cancelBeat();
    P().draftTake(ui.mode.value, Number(ui.secs.value) || 1);
    sync();
  }
  function cancelBeat() {
    if (beatRaf) cancelAnimationFrame(beatRaf);
    beatRaf = 0;
  }
  /* Vuruşta gönder: tempo biliniyorsa bir sonraki vuruşu bekler; bilinmiyorsa hemen gönderir. */
  function take() {
    if (!armed()) return;
    if (beatRaf) { cancelBeat(); sync(); return; }
    if (!ui.beat.checked) { doTake(); return; }
    const A = window.SVAutoVJ;
    const tempo = A && A.tempoOf ? A.tempoOf() : null;
    if (!tempo || !(tempo.bpm > 0)) {
      P().toast(tr('Tempo bilinmiyor; hemen gönderildi.'), 'warn');
      doTake();
      return;
    }
    beatDeadline = performance.now() + BEAT_WAIT_MS;
    const tick = () => {
      if (!armed()) { cancelBeat(); sync(); return; }
      if (tempo.justFired() || performance.now() > beatDeadline) { doTake(); return; }
      beatRaf = requestAnimationFrame(tick);
    };
    beatRaf = requestAnimationFrame(tick);
    sync();
  }

  async function snap() {
    if (!armed() || snapBusy || document.hidden || !window.api || !window.api.programSnapshot) return;
    snapBusy = true;
    try {
      const r = await window.api.programSnapshot();
      if (r && r.dataUrl) { ui.monitor.src = r.dataUrl; ui.monitor.hidden = false; ui.monNote.hidden = true; }
      else { ui.monitor.hidden = true; ui.monNote.hidden = false; }
    } catch { /* pencere kapanıyor */ }
    snapBusy = false;
  }

  function enter() {
    if (armed()) return;
    if (!P().draftBegin()) return;
    if (!snapTimer) snapTimer = setInterval(snap, SNAP_MS);
    snap();
    sync();
  }
  async function leave() {
    if (!armed()) return;
    const ok = await P().confirm(tr('Önizlemeden çıkılsın mı? Sahneye gönderilmemiş taslak değişiklikleri atılır.'), {
      title: tr('Önizlemeden Çık'), okText: tr('Çık'), cancelText: tr('İptal'), danger: true, defaultCancel: true,
    });
    if (!ok) return;
    cancelBeat();
    P().draftEnd();
    if (snapTimer) { clearInterval(snapTimer); snapTimer = 0; }
    sync();
  }

  async function offerRestore() {
    if (!P().draftHasSaved()) return;
    const ok = await P().confirm(tr('Önceki oturumdan kalan bir önizleme taslağı bulundu. Geri yüklensin mi?'), {
      title: tr('Önizleme Taslağı'), okText: tr('Geri Yükle'), cancelText: tr('Sil'),
    });
    if (!ok) { P().draftDiscardSaved(); return; }
    if (P().draftRestore()) {
      if (!snapTimer) snapTimer = setInterval(snap, SNAP_MS);
      sync();
    }
  }

  function init() {
    if (!P() || !P().draftBegin) return;
    const tools = document.querySelector('.sv-tools');
    const undo = document.getElementById('undoBtn');
    btn = el('button', { id: 'previewModeBtn', type: 'button', class: 'sv-ib sv-pvw-toggle', title: tr('Önizleme modu: düzenlemeler yayına gitmeden hazırlanır'), 'aria-label': tr('Önizleme modu'), 'aria-pressed': 'false' });
    if (window.SVIcons) window.SVIcons.set(btn, 'eye', '');
    btn.addEventListener('click', () => (armed() ? leave() : enter()));
    if (tools) tools.insertBefore(btn, undo && undo.parentNode === tools ? undo : tools.firstChild);
    buildBar();
    document.addEventListener('keydown', (e) => {
      if (!armed()) return;
      if (e.key === 'Escape' && beatRaf) { cancelBeat(); sync(); return; }
      if (e.key === 'Enter' && e.shiftKey && (e.ctrlKey || e.metaKey)) { e.preventDefault(); take(); }
    });
    // Program başka yerden değişebilir (kısayol, MIDI, Canlı sayfası): düğme durumları tazelensin
    setInterval(() => { if (armed()) sync(); }, 1000);
    sync();
    setTimeout(offerRestore, 1500);
  }

  window.SVPreviewMode = { sync, enter, leave, take };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', () => setTimeout(init, 0));
  else setTimeout(init, 0);
})();
