/*
 * SoundVisualizer — CaYaDev Ses Görselleştirici
 * Copyright (c) 2026 Çağan Turgut (CaYatur) — CaYaDev, https://cayadev.com
 * https://github.com/CaYatur/SoundVisualizer
 * SPDX-License-Identifier: MIT
 */
'use strict';
/* YENİ SÜRÜM UYARISI (docs/android/PLAN.md K13): Ayarlar → Güncellemeler.

   - Denetim uygulamada (update/AppUpdate.kt): GitHub'ın sürüm listesi, yalnız android-v*
     etiketleri. Kip "bildir" iken günde en çok bir kez kendiliğinden; kapalıyken hiç ağa
     çıkmaz, "Şimdi Denetle" yine çalışır.
   - Uygulama kendini kurmaz: "Sürüm Sayfasını Aç" tarayıcıda sürüm sayfasını açar.
   - Yeni sürüm varken: Ayarlar sayfasının üstünde şerit, alt gezinmede Ayarlar düğmesinde nokta ve sürüm
     başına bir kez kısa bildirim. "Bu Sürümü Atla" uyarıyı o sürüm için susturur.
   - Telefon bir bilgisayara bağlıyken oradaki uygulamanın sürümü de görünür (`updates.state`,
     salt okunur). Kurulum PC'de yapılır. */
(function () {
  if (typeof window === 'undefined' || !window.SVShell || !window.SVShellUI) return;
  const S = window.SVShell;
  const U = window.SVShellUI;
  const { h, icon, A } = S;
  const en = () => !!(window.SVI18n && window.SVI18n.locale === 'en');
  const api = () => A() && A().updates;

  let st = null; // telefon uygulamasının durumu
  let pcSt = null; // bağlı PC'nin durumu (yoksa null)
  let pcAsked = false;
  let busy = false;
  let pageCtx = null;

  const ERR = {
    offline: 'İnternet bağlantısı yok.',
    timeout: 'GitHub zamanında yanıt vermedi.',
    rate: 'GitHub\'ın istek sınırı doldu. Bir saat sonra yeniden deneyin.',
    server: 'GitHub şu an yanıt veremiyor. Sonra yeniden deneyin.',
    'no-browser': 'Bağlantıyı açacak bir tarayıcı bulunamadı.',
  };
  const errText = (e) => ERR[e] || 'Sürüm listesi okunamadı.';

  function pending() { return !!(st && st.status === 'available' && !st.skipped); }

  function when(t) {
    if (!t) return '';
    try { return new Date(t).toLocaleString(en() ? 'en-GB' : 'tr-TR', { dateStyle: 'medium', timeStyle: 'short' }); } catch (e) { return ''; }
  }
  const mb = (b) => (b / 1048576).toFixed(1).replace('.', en() ? '.' : ',') + ' MB';

  // ---- Uyarının ana ekrandaki izleri: gezinmede nokta, sürüm başına bir kez bildirim ----
  function markNav() {
    const b = document.querySelector('#sv-shell .nav [data-tab="settings"]');
    if (b) b.classList.toggle('has-dot', pending());
  }
  function told() { try { return localStorage.getItem('sv-update-told') || ''; } catch (e) { return ''; } }
  function tell() {
    if (!pending() || told() === st.latest) return;
    try { localStorage.setItem('sv-update-told', st.latest); } catch (e) { /* yazılamazsa her açılışta bir kez */ }
    S.toast(en() ? 'Version ' + st.latest + ' is available. See Settings → Updates.' : 'Yeni sürüm ' + st.latest + ' çıktı. Ayrıntı: Ayarlar → Güncellemeler.');
  }
  function refreshPage() {
    // Ayarlar açık ve en üstteyse (Hakkında gibi bir alt sayfa değil) yeniden çiz
    const s = S.state();
    if (pageCtx && s.sheet && s.tab === 'settings' && s.depth === 1) pageCtx.refresh();
  }
  function set(v, quiet) {
    if (!v) return;
    st = v;
    markNav();
    if (!quiet) tell();
    refreshPage();
  }

  async function checkNow() {
    if (busy || !api()) return;
    busy = true;
    refreshPage();
    try {
      const v = await api().check();
      set(v);
      if (v && v.status === 'error') S.toast(errText(v.error));
      else if (v && v.status === 'latest') S.toast('En son sürümü kullanıyorsunuz.');
    } catch (e) {
      S.toast(errText(String((e && e.message) || '')));
    } finally {
      busy = false;
      refreshPage();
    }
    if (pcSt) loadPc(true);
  }

  // ---- Bağlı PC'nin sürümü ----
  function pcConnected() {
    try { const t = A().target.get(); return !!(t && t.state === 'connected'); } catch (e) { return false; }
  }
  function loadPc(force) {
    if (!pcConnected()) { pcSt = null; return; }
    if (pcAsked && !force) return;
    pcAsked = true;
    // link.request: eski PC işlemi tanımıyorsa ortak hata bildirimi çıkmasın, satır gizli kalır
    A().link.request('updates.state', {}).then((r) => {
      pcSt = r && r.ok && r.result ? r.result : null;
      refreshPage();
    }, () => { pcSt = null; });
  }
  async function pcCheck() {
    const r = await A().link.request('updates.check', {}).catch(() => null);
    if (r && r.ok && r.result) { pcSt = r.result; refreshPage(); return; }
    const e = r && r.error;
    S.toast(e === 'level' ? 'Bu telefonun PC\'deki erişim düzeyi buna yetmiyor.' : 'PC denetleyemedi.');
  }

  // ---- Ayarlar sayfasındaki parçalar ----
  function statusRow() {
    const s = st || { status: 'idle' };
    const checking = busy || s.checking;
    let title;
    let sub;
    let ic = 'info';
    if (checking) {
      title = h('span', { text: 'Denetleniyor…' });
      ic = 'refresh';
    } else if (s.status === 'available') {
      title = h('span', {}, [h('span', { text: 'Yeni sürüm var' }), ' ' + s.latest]);
      sub = h('span', {}, [h('span', { text: 'Bu telefonda' }), ' ' + s.current]);
      ic = 'download';
    } else if (s.status === 'latest') {
      title = h('span', { text: 'Güncel' });
      sub = h('span', {}, [h('span', { text: 'Sürüm' }), ' ' + s.current]);
      ic = 'check-circle';
    } else if (s.status === 'none') {
      title = h('span', { text: 'Henüz yayımlanmış Android sürümü yok' });
      sub = h('span', {}, [h('span', { text: 'Sürüm' }), ' ' + s.current]);
    } else if (s.status === 'error') {
      title = h('span', { text: 'Denetlenemedi' });
      sub = h('span', { text: errText(s.error) });
      ic = 'warning';
    } else {
      title = h('span', { text: 'Henüz denetlenmedi' });
      sub = h('span', {}, [h('span', { text: 'Sürüm' }), ' ' + ((window.__SV_ANDROID || {}).version || '?')]);
    }
    return h('div', { class: 'ctl-row' }, [
      icon(ic),
      h('div', { class: 'row-text' }, [
        h('div', { class: 'row-title small' }, [title]),
        sub ? h('div', { class: 'row-sub' }, [sub]) : null,
      ]),
      s.status === 'available' && s.skipped ? h('span', { class: 'badge', text: 'Atlandı' }) : null,
    ]);
  }

  function section(ctx) {
    pageCtx = ctx;
    loadPc(false);
    const s = st || { status: 'idle', mode: 'notify' };
    const out = [h('div', { class: 'section-label', text: 'Güncellemeler' })];
    const rows = [statusRow()];
    const extra = [];
    if (s.checkedAt) extra.push(h('span', {}, [h('span', { text: 'Son denetim' }), ' ' + when(s.checkedAt)]));
    // Önceki sonuç duruyor ama son deneme olmadı
    if (s.error && s.status !== 'error') extra.push(h('span', {}, [' · ', h('span', { text: 'Son deneme olmadı' })]));
    if (extra.length) rows.push(h('div', { class: 'hint' }, extra));
    if (s.status === 'available' && s.notes) {
      rows.push(h('div', { class: 'divider flush' }));
      rows.push(h('div', { class: 'ctl-label', text: 'Sürüm notları' }));
      // Sürüm notu düz metin (uygulamada sadeleştirildi), textContent ile
      rows.push(h('div', { class: 'update-notes', text: s.notes }));
    }
    if (s.status === 'available' && s.apkBytes > 0) rows.push(h('div', { class: 'hint' }, [h('span', { text: 'APK boyutu' }), ' ' + mb(s.apkBytes)]));
    rows.push(h('div', { class: 'btn-row' }, [
      h('button', { class: 'btn' + (s.status === 'available' ? '' : ' primary'), disabled: busy || s.checking ? true : null, onclick: checkNow }, [icon('refresh'), h('span', { text: 'Şimdi Denetle' })]),
      s.status === 'available' ? h('button', {
        class: 'btn primary',
        onclick: () => api().open().catch((e) => S.toast(errText(String((e && e.message) || '')))),
      }, [icon('globe'), h('span', { text: 'Sürüm Sayfasını Aç' })]) : null,
    ]));
    if (s.status === 'available' && !s.skipped) {
      rows.push(h('div', { class: 'btn-row' }, [
        h('button', { class: 'btn ghost', onclick: () => api().skip().then((v) => set(v, true)) }, [h('span', { text: 'Bu Sürümü Atla' })]),
      ]));
    }
    rows.push(h('div', { class: 'divider flush' }));
    rows.push(U.toggle({
      label: 'Yeni sürümü bildir',
      value: s.mode !== 'off',
      def: true,
      onChange: (on) => api().setMode(on ? 'notify' : 'off').then((v) => set(v, true)),
    }));
    rows.push(h('div', { class: 'hint', text: 'Açıkken günde en çok bir kez GitHub\'daki sürüm listesine bakılır; kişisel bilgi gönderilmez. Uygulama kendini güncellemez: yeni APK\'yı sürüm sayfasından indirip kurarsınız, ayarlarınız kalır.' }));
    out.push(U.card(rows));

    // Bağlı PC'nin sürümü (PC'deki uygulama bunu biliyorsa)
    if (pcSt && pcConnected()) {
      const p = pcSt;
      // İndiriliyor, kuruluma hazır, kuruldu: yeni sürüm PC'de bilinir (src/main/updater.js durumları)
      const avail = ['available', 'downloading', 'ready', 'installed'].indexOf(p.status) >= 0 && !!p.latest;
      const pcRows = [h('div', { class: 'ctl-row' }, [
        icon(avail ? 'download' : 'monitor'),
        h('div', { class: 'row-text' }, [
          h('div', { class: 'row-title small' }, [avail ? h('span', {}, [h('span', { text: 'PC için yeni sürüm var' }), ' ' + p.latest]) : h('span', { text: p.status === 'latest' ? 'PC güncel' : 'PC\'deki uygulama' })]),
          h('div', { class: 'row-sub' }, [h('span', { text: 'PC\'de' }), ' ' + (p.current || '?')]),
        ]),
      ])];
      const PC_NOTE = {
        available: 'Kurulum PC\'de yapılır: PC\'de Ayarlar → Güncellemeler.',
        downloading: 'PC yeni sürümü indiriyor.',
        ready: 'PC\'de kuruluma hazır: PC\'de Ayarlar → Güncellemeler.',
        installed: 'Kuruldu. PC\'deki uygulama yeniden açılınca yeni sürüm başlar.',
      };
      if (avail) pcRows.push(h('div', { class: 'hint', text: PC_NOTE[p.status] }));
      if (p.status === 'error' && p.error) pcRows.push(h('div', { class: 'hint', text: 'PC son denetimde sürüm listesini okuyamadı.' }));
      pcRows.push(h('div', { class: 'btn-row' }, [h('button', { class: 'btn', onclick: pcCheck }, [icon('refresh'), h('span', { text: 'PC\'de Denetle' })])]));
      out.push(h('div', { class: 'section-label', text: 'PC\'nin Sürümü' }));
      out.push(U.card(pcRows));
    }
    return out;
  }

  /** Ayarlar'ın en üstünde, yeni sürüm varken */
  function banner() {
    if (!pending()) return null;
    return h('div', { class: 'banner info', role: 'status' }, [
      icon('download'),
      h('div', { class: 'grow-text' }, [h('b', {}, [h('span', { text: 'Yeni sürüm var' }), ' ' + st.latest]), h('div', { class: 'row-sub', text: 'Aşağıda, Güncellemeler bölümünde' })]),
      h('button', { class: 'btn primary', onclick: () => api().open().catch((e) => S.toast(errText(String((e && e.message) || '')))) }, [h('span', { text: 'Aç' })]),
    ]);
  }

  // ---- Başlangıç: son bilinen durum, 15 sn sonra kendiliğinden denetim, öne gelince yeniden ----
  function start() {
    const u = api();
    if (!u) return;
    u.onChange((v) => set(v));
    u.state().then((v) => set(v)).catch(() => {});
    setTimeout(() => { u.auto().catch(() => {}); }, 15000);
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') u.auto().catch(() => {});
    });
    // PC'ye bağlanınca ya da kopunca PC satırı yenilensin
    try {
      // Hedef olayı gecikme ölçümüyle sık gelir: yalnız bağlantı açılıp kapanınca
      let conn = pcConnected();
      A().target.onChange(() => {
        const now = pcConnected();
        if (now === conn) return;
        conn = now;
        pcAsked = false;
        if (!now) { pcSt = null; refreshPage(); } else loadPc(true);
      });
      if (A().pc && A().pc.onUpdates) A().pc.onUpdates((v) => { if (v) { pcSt = v; refreshPage(); } });
    } catch (e) { /* PC bağlantısı olmayan yapı */ }
  }

  window.SVShellUpdates = Object.freeze({ section, banner, pending, state: () => st, pc: () => pcSt, check: checkNow });
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start, { once: true });
  else start();
})();
