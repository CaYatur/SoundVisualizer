/*
 * SoundVisualizer — CaYaDev Ses Görselleştirici
 * Copyright (c) 2026 Çağan Turgut (CaYatur) — CaYaDev, https://cayadev.com
 * https://github.com/CaYatur/SoundVisualizer
 * SPDX-License-Identifier: MIT
 */
'use strict';
/* SES KAYNAKLARI seçicisi: "Aktif Kaynaklar" (çıkışlar ve girişler) ile
   "Uygulama Sesi" listesi. Panelin Ses Kaynakları kartı ve ses köprüsünün
   durum penceresi (#813) AYNI parçayı kullanıyor; yakalama ve karıştırma da
   aynı (audio.sources -> loopback-helper). Çizen taraf yalnız ortamı verir:
     host.el(tag, props, kids)  öğe kurucusu (icon desteğiyle)
     host.get() / host.set(list) seçili kaynak listesi
     host.appMeter(match)        uygulama satırının canlı ölçeri (yoksa null)
     host.requestPermission()    macOS Ekran Kaydı izni (isteğe bağlı) */
(function () {
  function control(def, host) {
    const el = host.el;
    const tr = host.tr || ((t) => t);
    const appMeter = host.appMeter || (() => null);
    const checkboxes = new Map();
    const AA = window.SVAppAudio;

    /* Kaynaklar iki türlü: aygıt adı (metin) ve uygulama hedefi (nesne).
       İkisi aynı listede duruyor çünkü karışım zaten çoklu kaynak
       destekliyor — "Spotify + mikrofon" tek bir seçim kümesi. */
    const keyOf = (s) => (AA && AA.isAppSource(s)
      ? 'app:' + AA.baseName(s.match)
      : String(s));

    function getCur() {
      const v = host.get();
      return Array.isArray(v) ? v : (v ? [v] : ['default']);
    }

    function appMode() {
      const cur = getCur().filter((s) => AA && AA.isAppSource(s));
      return cur.length && cur[0].mode === 'exclude' ? 'exclude' : 'include';
    }

    function toggle(entry) {
      const key = keyOf(entry);
      let arr = getCur().slice();
      if (arr.some((s) => keyOf(s) === key)) {
        arr = arr.filter((s) => keyOf(s) !== key);
      } else {
        const add = AA && AA.isAppSource(entry)
          ? Object.assign({}, entry, { mode: appMode() })
          : entry;
        /* Hariç tutma tek uygulamayla sınırlı (bkz. shared/app-audio.js):
           iki hariç-tutma akışı birbirinin sesini taşır ve karıştırılınca
           o ses iki kez sayılırdı. */
        if (AA && AA.isAppSource(add) && add.mode === 'exclude') {
          arr = arr.filter((s) => !(AA && AA.isAppSource(s)));
        }
        arr.push(add);
      }
      if (arr.length === 0) arr = ['default']; // en az bir kaynak her zaman seçili
      host.set(arr);
    }

    function setAppMode(mode) {
      let arr = getCur().slice();
      const apps = arr.filter((s) => AA && AA.isAppSource(s));
      arr = arr.filter((s) => !(AA && AA.isAppSource(s)));
      const kept = mode === 'exclude' ? apps.slice(0, 1) : apps;
      for (const a of kept) arr.push(Object.assign({}, a, { mode }));
      if (arr.length === 0) arr = ['default'];
      host.set(arr);
    }

    function updateChecks() {
      const cur = getCur().map(keyOf);
      checkboxes.forEach((cb, k) => { cb.checked = cur.includes(k); });
    }

    function makeRow(entry, icon, label, extra, meter) {
      /* Yakalamanın bildirdiği satır durumu (köprü penceresi, #813):
         "kapandı, bekleniyor" gibi; yoksa satırın kendi notu. */
      const stNote = host.stateOf ? host.stateOf(keyOf(entry)) : '';
      if (stNote) extra = stNote;
      const cb = el('input', { type: 'checkbox' });
      checkboxes.set(keyOf(entry), cb);
      cb.addEventListener('change', () => toggle(entry));
      const kids = [
        cb,
        el('span', { class: 'source-icon', icon }),
        el('span', { class: 'source-name', text: label, title: label }),
      ];
      if (meter) kids.push(meter);
      if (extra) kids.push(el('span', { class: 'source-note' + (stNote ? ' is-state' : ''), text: extra }));
      return el('label', { class: 'source-item' }, kids);
    }

    const devices = typeof def.devices === 'function' ? def.devices() : (def.devices || []);
    const rows = [makeRow('default', 'speaker', 'Varsayılan Çıkış (Aktif Hoparlör)')];
    devices.forEach((d) => {
      const icon = d.kind === 'input' ? 'mic' : 'speaker';
      const suffix = d.isDefault ? ' (' + tr('varsayılan') + ')' : '';
      rows.push(makeRow(d.name, icon, d.name + suffix));
    });
    const kids = [
      el('label', { class: 'lbl', text: def.label }),
      el('div', { class: 'source-list' }, rows),
    ];

    // --------------------------------------------- uygulama başına yakalama
    const apps = typeof def.apps === 'function' ? def.apps() : (def.apps || []);
    const status = typeof def.appStatus === 'function' ? def.appStatus() : null;
    const selectedApps = getCur().filter((s) => AA && AA.isAppSource(s));

    kids.push(el('label', { class: 'lbl', text: 'Uygulama Sesi' }));
    if (!AA || (status && status.available === false)) {
      kids.push(el('div', { class: 'studio-note dim-hint',
        text: (status && status.message) || 'Uygulama başına ses yakalama kullanılamıyor.' }));
      /* macOS: izin eksikse sebebi yazmak yetmez, istemenin yolu da olmalı.
         Pencere açılışta kendiliğinden çıkmıyor (özelliği hiç kullanmayan
         herkese Ekran Kaydı sorulurdu); yalnız bu düğmeyle. */
      if (status && status.canRequest && host.requestPermission) {
        const req = el('button', {
          class: 'btn small', type: 'button', icon: 'lock', text: 'Ekran Kaydı İzni İste',
        });
        req.addEventListener('click', () => host.requestPermission());
        kids.push(req);
      }
    } else {
      const appRows = [];
      const shown = new Set();
      /* Önceki çizimin seviyeleri yeni çubuklara taşınsın diye eski harita
         appMeter içinde okunuyor; bu çizimde olmayan uygulamalar düşüyor. */
      if (host.keepMeters) host.keepMeters(new Set(apps.map((a) => AA.baseName(a.match))));
      for (const a of apps) {
        shown.add(AA.baseName(a.match));
        appRows.push(makeRow(
          { kind: 'app', match: a.match, label: a.label },
          a.audible ? 'music' : 'mute',
          a.label,
          a.count > 1 ? a.count + ' süreç' : '',
          appMeter(a.match)
        ));
      }
      /* Seçili ama şu an çalışmayan uygulama listeden DÜŞMEMELİ; aksi halde
         kullanıcı seçimini kaybeder ve neden kaybettiğini göremez. Yakalama
         tarafı da uygulama açılınca kendiliğinden bağlanıyor. */
      for (const s of selectedApps) {
        if (shown.has(AA.baseName(s.match))) continue;
        /* A plain key saved before Linux split apps by name ("pacat")
           still captures every app of that binary: show it as running. */
        const live = AA.sameApp ? apps.filter((a) => AA.sameApp(a.match, AA.baseName(s.match))) : [];
        if (live.length) {
          appRows.push(makeRow(
            { kind: 'app', match: s.match, label: s.label },
            live.some((a) => a.audible) ? 'music' : 'mute',
            s.label || s.match,
            live.length > 1 ? live.length + ' süreç' : '',
            appMeter(s.match)
          ));
          continue;
        }
        appRows.push(makeRow(
          { kind: 'app', match: s.match, label: s.label },
          'pause', s.label || s.match, 'çalışmıyor'
        ));
      }
      if (!appRows.length) {
        kids.push(el('div', { class: 'studio-note dim-hint',
          text: 'Şu anda ses çalan bir uygulama yok. Bir şey çaldırıp Aygıtları Yenile’ye basın.' }));
      } else {
        kids.push(el('div', { class: 'source-list' }, appRows));
      }

      if (selectedApps.length) {
        const mode = appMode();
        const seg = el('div', { class: 'segment' });
        for (const opt of [['include', 'Yalnızca Seçilenler'], ['exclude', 'Seçilen Hariç']]) {
          const b = el('button', {
            class: mode === opt[0] ? 'active' : '', type: 'button', text: tr(opt[1]),
          });
          b.addEventListener('click', () => setAppMode(opt[0]));
          seg.appendChild(b);
        }
        kids.push(el('div', { class: 'ctrl' }, [
          el('label', { class: 'lbl', text: 'Uygulama Kipi' }), seg,
        ]));
        if (mode === 'exclude') {
          kids.push(el('div', { class: 'studio-note dim-hint',
            text: 'Seçilen uygulama hariç sistemdeki her şey dinlenir. Bu kipte tek uygulama seçilebilir.' }));
        }
      }
    }

    updateChecks();
    return el('div', { class: 'ctrl' }, kids);
  }


  window.SVAudioSources = { control };
})();
