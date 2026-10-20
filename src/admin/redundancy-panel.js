/*
 * SoundVisualizer — CaYaDev Ses Görselleştirici
 * Copyright (c) 2026 Çağan Turgut (CaYatur) — CaYaDev, https://cayadev.com
 * https://github.com/CaYatur/SoundVisualizer
 * SPDX-License-Identifier: MIT
 */
'use strict';
/* YEDEKLİLİK paneli (#540). İşin kendisi ana süreçte (main/redundancy.js);
   burada rol, eşleşme parolası, adres, eşik, devralma biçimi ve durum.
   Yetkiyi elle alma/bırakma ağ ayarına dokunmadan yapılır (#546). */
(function () {
  const P = () => window.SVPanel;
  let status = { role: 'off' };
  let started = false;

  const STATE_TEXT = {
    connecting: 'Birincile bağlanılıyor',
    following: 'Birincili izliyor',
    lost: 'Birincil yanıt vermiyor: elle devralma bekleniyor',
    active: 'Yetki bu makinede',
  };
  const PROBLEM_TEXT = {
    secret: 'Eşleşme parolası en az 16 karakter olmalı.',
    host: 'Birincilin adresini yazın.',
  };

  function red() {
    const cfg = P().cfg();
    if (!cfg.redundancy || typeof cfg.redundancy !== 'object') cfg.redundancy = {};
    return cfg.redundancy;
  }

  function textRow(label, value, onSet, attrs) {
    const el = P().el;
    const inp = el('input', Object.assign({ class: 'p-in wide', type: 'text', value: value || '' }, attrs || {}));
    inp.addEventListener('change', () => onSet(inp.value.trim()));
    return P().row(label, inp);
  }
  function numRow(label, value, min, max, step, onSet) {
    const el = P().el;
    const inp = el('input', { class: 'num', type: 'number', min: String(min), max: String(max), step: String(step) });
    inp.value = String(value);
    inp.addEventListener('change', () => {
      const v = Number(inp.value);
      if (!Number.isFinite(v)) { inp.value = String(value); return; }
      onSet(Math.max(min, Math.min(max, Math.round(v))));
    });
    return P().row(label, inp);
  }
  function selectRow(label, options, value, onSet) {
    const el = P().el;
    const sel = el('select', { class: 'sel-ctrl' });
    options.forEach(([v, t]) => { const o = el('option', { value: v, text: t }); if (v === value) o.selected = true; sel.appendChild(o); });
    sel.addEventListener('change', () => onSet(sel.value));
    return P().row(label, sel);
  }

  function statusBox() {
    const el = P().el;
    const box = el('div', { class: 'studio-status', role: 'status' });
    if (status.problem) {
      box.classList.add('err');
      box.appendChild(el('span', { icon: 'x' }));
      box.appendChild(el('span', { text: PROBLEM_TEXT[status.problem] || status.problem }));
      return box;
    }
    if (status.role === 'primary') {
      // classList.add('') hata fırlatır: yedek yokken bütün sayfa çizilemiyordu
      if (status.peers) box.classList.add('ok');
      box.appendChild(el('span', { icon: status.peers ? 'check' : 'broadcast' }));
      box.appendChild(el('span', { text: status.peers ? 'Yedek bağlı' : 'Yedek bekleniyor' }));
      if (status.peerState === 'active') {
        box.appendChild(el('span', { class: 'st-sep', 'aria-hidden': 'true', text: ' · ' }));
        box.appendChild(el('span', { text: 'Yedek yetkiyi aldı' }));
      }
      if (!status.serverRunning) {
        box.appendChild(el('span', { class: 'st-sep', 'aria-hidden': 'true', text: ' · ' }));
        box.appendChild(el('span', { text: 'Yayın sunucusu açılamadı' }));
      }
      return box;
    }
    if (status.role === 'backup') {
      if (status.state === 'following') box.classList.add('ok');
      if (status.state === 'lost') box.classList.add('err');
      box.appendChild(el('span', { icon: status.state === 'active' ? 'bolt' : status.state === 'following' ? 'check' : 'broadcast' }));
      /* Elle bırakıştan sonra otomatik devralma duruyor; "elle devralma
         bekleniyor · otomatik devralma bekletiliyor" çelişkili okunuyordu. */
      const heldLost = status.autoHeld && status.state === 'lost';
      box.appendChild(el('span', { text: heldLost ? 'Birincil yanıt vermiyor' : (STATE_TEXT[status.state] || 'Kapalı') }));
      if (status.state === 'active' && status.takenBy) {
        box.appendChild(el('span', { class: 'st-sep', 'aria-hidden': 'true', text: ' · ' }));
        box.appendChild(el('span', { text: status.takenBy === 'auto' ? 'kendiliğinden' : 'elle' }));
      }
      if (status.autoHeld && status.state !== 'active') {
        box.appendChild(el('span', { class: 'st-sep', 'aria-hidden': 'true', text: ' · ' }));
        box.appendChild(el('span', { text: heldLost
          ? 'Otomatik devralma elle bırakıştan beri duraklatıldı: elle devralın ya da yeniden kurun'
          : 'Otomatik devralma duraklatıldı (elle bırakıldı)' }));
      }
      return box;
    }
    box.appendChild(el('span', { text: 'Kapalı' }));
    return box;
  }

  /* GÖSTERİ KARŞILAŞTIRMASI (#541): iki makinenin gösteri özeti ve fark
     listesi. Presetler ve logolar onayla gönderilir; video dosyaları elle
     kopyalanır. */
  const KIND_TEXT = { cfg: 'Ayar', preset: 'Preset', logo: 'Logo', media: 'Video dosyası', app: 'Uygulama sürümü' };
  const DIFF_TEXT = { missing: 'yedekte yok', different: 'farklı', extra: 'yalnız yedekte' };

  function showBox() {
    const el = P().el;
    const sh = status.show;
    const nodes = [el('div', { class: 'group-label', text: 'Gösteri Karşılaştırması' })];
    if (!sh) {
      nodes.push(el('div', { class: 'studio-note dim-hint', text: 'Yedekten envanter bekleniyor.' }));
    } else {
      const same = sh.differences === 0;
      const box = el('div', { class: 'studio-status ' + (same ? 'ok' : 'err'), role: 'status' }, [
        el('span', { icon: same ? 'check' : 'warning' }),
        el('span', { text: same ? 'İki makine aynı gösteriyi çalıştırıyor' : 'Gösteriler farklı' }),
        el('span', { class: 'st-sep', 'aria-hidden': 'true', text: ' · ' }),
        el('span', { class: 'st-num', text: String(sh.hash || '').slice(0, 12) }),
      ]);
      nodes.push(box);
      if (!same) {
        const list = el('ul', { class: 'red-diff' });
        sh.items.filter((d) => d.status !== 'extra').forEach((d) => {
          list.appendChild(el('li', {}, [
            el('span', { text: KIND_TEXT[d.kind] || d.kind }),
            el('span', { class: 'st-sep', 'aria-hidden': 'true', text: ' · ' }),
            el('span', { text: d.label || d.id, 'data-user-text': '' }),
            el('span', { class: 'st-sep', 'aria-hidden': 'true', text: ' · ' }),
            el('span', { class: 'dim-hint', text: DIFF_TEXT[d.status] || d.status }),
          ]));
        });
        nodes.push(list);
        if (sh.differences > sh.items.filter((d) => d.status !== 'extra').length) {
          nodes.push(el('div', { class: 'studio-note dim-hint', text: 'Listede ilk 40 fark gösteriliyor.' }));
        }
      }
    }
    nodes.push(el('div', { class: 'lay-file' }, [
      el('button', { class: 'btn small ghost', type: 'button', icon: 'refresh', text: 'Karşılaştır', onclick: async () => { try { await window.api.redundancyCompare(); } catch { /* */ } } }),
      el('button', {
        class: 'btn small', type: 'button', icon: 'export', text: 'Farkları Yedeğe Gönder',
        disabled: sh && sh.pushable > 0 ? null : 'disabled',
        onclick: pushDiff,
      }),
    ]));
    nodes.push(el('div', { class: 'studio-note dim-hint', text: 'Yedekte olmayan presetler ve logolar gönderilir; yedek onları kütüphanesine eklemeden ayrı alanda tutar, aynı kimlikli öğesi değişmez. Videolar ve farklı öğeler için yedekte "Birincilden Paket İste"yi kullanın.' }));
    return el('div', { class: 'red-show' }, nodes);
  }

  async function pushDiff() {
    const sh = status.show;
    if (!sh || !sh.pushable) return;
    // Açık onay: neyin değişeceği listelenir
    const tr = (s) => (window.SVI18n && window.SVI18n.t ? window.SVI18n.t(s) : s);
    const name = (d) => (d.kind === 'logo' ? 'Logo' : 'Preset') + ': ' + (d.label || d.id);
    const items = sh.items.filter((d) => d.pushable && d.status !== 'extra');
    /* Yedekte HİÇ olmayanlar ile yedekte FARKLI olanlar ayrı listelenir;
       ikisi tek "yedekte olmayan" başlığı altında yanıltıcıydı. */
    const missing = items.filter((d) => d.status !== 'different');
    const differing = items.filter((d) => d.status === 'different');
    let left = 20;
    // Sayı iki noktadan önce: "Yedekte olmayanlar (3):" (#812)
    const block = (title, list, note) => {
      if (!list.length) return '';
      const shown = list.slice(0, Math.max(0, left));
      left -= shown.length;
      return '\n\n' + tr(title) + ' (' + list.length + '):' + (note ? ' ' + tr(note) : '') + '\n' + shown.map((d) => '• ' + name(d)).join('\n') + (list.length > shown.length ? '\n… +' + (list.length - shown.length) : '');
    };
    const text = tr('Şu öğeler gönderilecek; yedek onları ayrı alanda tutar, aynı kimlikli öğeleri değişmez.') +
      block('Yedekte olmayanlar', missing) +
      block('Yedekte farklı olanlar', differing, 'yedeğin kendi sürümü kalır') +
      (sh.pushable > items.length ? '\n… +' + (sh.pushable - items.length) : '');
    const ok = await P().confirm(text, { okText: tr('Yedeğe Gönder') });
    if (!ok) return;
    try {
      const r = await window.api.redundancyPush();
      P().toast(r && r.ok ? tr('Yedeğe gönderildi.') : tr('Gönderilemedi.'), r && r.ok ? 'ok' : 'err');
    } catch { P().toast(tr('Gönderilemedi.'), 'err'); }
  }

  /* YALITILMIŞ GÖSTERİ ve GÖSTERİ PAKETİ (#812). Yedekte: hangi gösterinin
     çizildiği, devralmada hangisinin kullanılacağı, birincilin sahnelerini
     tek tek yerel gösteriye aktarma, paket kopyası (ilerleme, hız, hatalar),
     paket çakışmaları ve MilkDrop eşliği. Sayılar ayrı öğede: çeviri tam
     metni eşliyor. */
  const tr = (s) => (window.SVI18n && window.SVI18n.t ? window.SVI18n.t(s) : s);
  const SOURCE_TEXT = { primary: 'Birincilin kopyası', local: 'Bu makinenin gösterisi' };
  const PKG_STATE_TEXT = {
    idle: 'Paket istenmedi',
    offered: 'Paket hazır: içeriği gözden geçirip onaylayın',
    transferring: 'Kopyalanıyor',
    verifying: 'Doğrulanıyor',
    done: 'Paket doğrulandı ve yerine kondu',
    error: 'Kopyalama durdu',
  };
  const PKG_KIND_TEXT = { presets: 'Preset', logos: 'Logo', media: 'Video dosyası', preset: 'Preset', logo: 'Logo' };
  const PARITY_TEXT = { missing: 'birincilin preseti bu makinede yok', different: 'bu makinedeki preset farklı' };

  function bytes(n) {
    const v = Number(n) || 0;
    if (v >= 1e9) return (v / 1e9).toFixed(2) + ' GB';
    if (v >= 1e6) return (v / 1e6).toFixed(1) + ' MB';
    if (v >= 1e3) return Math.round(v / 1e3) + ' KB';
    return v + ' B';
  }
  function line(kids) { return P().el('div', { class: 'studio-note' }, kids); }
  function num(t) { return P().el('span', { class: 'st-num', text: String(t) }); }
  function sep() { return P().el('span', { class: 'st-sep', 'aria-hidden': 'true', text: ' · ' }); }

  function spaceBox() {
    const el = P().el;
    const sp = status.space;
    const nodes = [el('div', { class: 'group-label', text: 'Gösteri Verisi' })];
    nodes.push(selectRow('Devralmada Kullanılacak Gösteri', [['primary', 'Birincilin kopyası'], ['local', 'Bu makinenin gösterisi']],
      red().takeoverData === 'local' ? 'local' : 'primary', (v) => { red().takeoverData = v; P().push(true); }));
    if (!sp) {
      nodes.push(el('div', { class: 'studio-note dim-hint', text: 'Yerel gösteri ayrı tutulamadı; ayrıntı geliştirici konsolunda.' }));
      return el('div', { class: 'red-space' }, nodes);
    }
    nodes.push(line([el('span', { text: 'Şu an çizilen' }), sep(), el('span', { text: SOURCE_TEXT[sp.source] || sp.source })]));
    /* Devralmada birincilin kopyası çizilirse kullanılacak videolar (#812):
       paketle bu makineye kopyalananlar, adı ve boyutuyla. */
    const vids = Array.isArray(status.pkgMedia) ? status.pkgMedia : [];
    nodes.push(line([el('span', { text: 'Bu makineye kopyalanmış videolar' }), sep(), num(vids.length), sep(), num(bytes(vids.reduce((n, v) => n + (Number(v.size) || 0), 0)))]));
    if (vids.length) nodes.push(mediaList(vids));
    else nodes.push(el('div', { class: 'studio-note dim-hint', text: 'Birincilin sahnesindeki videolar bu makinede yoksa boş görünür; "Birincilden Paket İste" ile "Video dosyalarını da kopyala"yı seçin.' }));
    if (status.state === 'active') {
      const toLocal = sp.source !== 'local';
      nodes.push(el('div', { class: 'lay-file' }, [
        el('button', {
          class: 'btn small', type: 'button', icon: 'swap',
          text: toLocal ? 'Bu Makinenin Gösterisine Geç' : 'Birincilin Kopyasına Geç',
          onclick: async () => {
            const ok = await P().confirm(tr(toLocal ? 'Canlı görüntü bu makinenin kendi gösterisine geçecek.' : 'Canlı görüntü birincilin kopyasına geçecek.'), { okText: tr('Geç') });
            if (!ok) return;
            try { status = await window.api.redundancyUseShow(toLocal ? 'local' : 'primary'); } catch { /* */ }
            P().rerender();
          },
        }),
      ]));
    }
    const scenes = Array.isArray(sp.primaryScenes) ? sp.primaryScenes : [];
    nodes.push(line([el('span', { text: 'Birincilin kayıtlı sahneleri' }), sep(), num(scenes.length)]));
    if (scenes.length) {
      const list = el('ul', { class: 'red-diff' });
      scenes.slice(0, 50).forEach((sc) => {
        list.appendChild(el('li', {}, [
          el('span', { text: sc.name, 'data-user-text': '' }),
          sep(),
          el('button', { class: 'btn small ghost', type: 'button', icon: 'import', text: 'Yerel Gösteriye Aktar', onclick: () => importScene(sc) }),
        ]));
      });
      nodes.push(list);
    }
    nodes.push(el('div', { class: 'studio-note dim-hint', text: 'Birincilden gelenler ayrı bir alanda tutulur; bu makinenin kendi sahneleri, presetleri ve logoları değişmez. Rol kapatılınca kendi gösteriniz olduğu gibi geri gelir.' }));
    return el('div', { class: 'red-space' }, nodes);
  }

  async function importScene(sc) {
    const ok = await P().confirm(tr('Bu sahne bu makinenin kendi gösterisine kopyalanacak. Aynı kimlikte bir sahne varsa yeni bir kimlik alır; mevcut sahneler değişmez.') + '\n\n' + sc.name, { okText: tr('Aktar') });
    if (!ok) return;
    let r = null;
    try { r = await window.api.redundancyImportScene(sc.id); } catch { /* */ }
    P().toast(r && r.ok ? tr('Sahne yerel gösteriye aktarıldı.') : tr('Aktarılamadı.'), r && r.ok ? 'ok' : 'err');
  }

  function mediaList(list) {
    const el = P().el;
    const ul = el('ul', { class: 'red-diff red-media' });
    list.slice(0, 50).forEach((f) => ul.appendChild(el('li', {}, [
      el('span', { text: f.name, 'data-user-text': '' }), sep(), num(bytes(f.size)),
      f.have ? sep() : null, f.have ? el('span', { class: 'dim-hint', text: tr('bu makinede zaten var') }) : null,
    ].filter(Boolean))));
    if (list.length > 50) ul.appendChild(el('li', { class: 'dim-hint', text: tr('İlk 50 öğe gösteriliyor.') }));
    return ul;
  }

  function packageBox() {
    const el = P().el;
    const pk = status.pkg || { state: 'idle' };
    const nodes = [el('div', { class: 'group-label', text: 'Gösteri Paketi' })];
    const box = el('div', { class: 'studio-status' + (pk.state === 'done' ? ' ok' : pk.state === 'error' ? ' err' : ''), role: 'status' }, [
      el('span', { icon: pk.state === 'done' ? 'check' : pk.state === 'error' ? 'warning' : 'broadcast' }),
      el('span', { text: PKG_STATE_TEXT[pk.state] || pk.state }),
    ]);
    if (pk.state === 'error' && pk.error) { box.appendChild(sep()); box.appendChild(el('span', { class: 'st-num', text: pk.error })); }
    nodes.push(box);
    if (pk.summary) {
      for (const k of ['presets', 'logos', 'media']) {
        const g = pk.summary[k];
        if (!g || !g.n) continue;
        nodes.push(line([el('span', { text: PKG_KIND_TEXT[k] }), sep(), num(g.n), sep(), num(bytes(g.bytes))]));
      }
    }
    if (pk.progress && (pk.state === 'transferring' || pk.state === 'verifying' || pk.state === 'done' || pk.state === 'error')) {
      const pr = pk.progress;
      nodes.push(el('progress', { class: 'red-progress', max: String(pr.total || 1), value: String(pr.bytes || 0), 'aria-label': tr('Kopyalama ilerlemesi') }));
      nodes.push(line([num(bytes(pr.bytes) + ' / ' + bytes(pr.total)), sep(), num(pr.files + ' / ' + pr.of), sep(), num(bytes(pk.speed) + '/s')]));
    }
    if (pk.state === 'offered' || pk.state === 'transferring') {
      const files = el('ul', { class: 'red-diff red-pkg-files' });
      (pk.files || []).slice(0, 30).forEach((f) => files.appendChild(el('li', {}, [
        el('span', { text: PKG_KIND_TEXT[f.kind] || f.kind }), sep(), el('span', { text: f.name, 'data-user-text': '' }), sep(), num(bytes(f.size)),
      ])));
      nodes.push(files);
    }
    const buttons = [];
    if (pk.state === 'offered') {
      const media = pk.summary && pk.summary.media && pk.summary.media.n ? pk.summary.media : null;
      const box2 = el('input', { type: 'checkbox', id: 'redPkgMedia' });
      if (media) {
        // Kendi satırında: dosya listesinin üstüne binmesin (#817, Windows)
        nodes.push(el('label', { class: 'chk red-pkg-media', for: 'redPkgMedia' }, [box2, el('span', { text: 'Video dosyalarını da kopyala' }), sep(), num(bytes(media.bytes))]));
        // Kutu işaretlenmeden de görünsün: hangi videolar, ne kadar (#812)
        nodes.push(mediaList(pk.mediaFiles || []));
      }
      buttons.push(el('button', {
        class: 'btn small primary', type: 'button', icon: 'import', text: 'Kopyalamayı Başlat',
        onclick: async () => {
          const withMedia = !!(media && box2.checked);
          const msg = tr('Birincilin presetleri ve logoları bu makinenin yedeklilik klasörüne kopyalanacak. Hiçbiri kütüphaneye kendiliğinden eklenmez: bu makinede olmayanlar ayrı alanda kalır ve birincilin kopyası çizilirken kullanılır; aynı kimlikli yerel öğeler değişmez.') +
            (withMedia ? '\n\n' + tr('Video dosyaları da kopyalanacak:') + ' ' + bytes(media.bytes) : '');
          const ok = await P().confirm(msg, { okText: tr('Kopyala') });
          if (!ok) return;
          try { status = await window.api.redundancyPkgConfirm({ media: withMedia }); } catch { /* */ }
          P().rerender();
        },
      }));
    }
    if (pk.state === 'transferring' || pk.state === 'offered') {
      buttons.push(el('button', { class: 'btn small ghost', type: 'button', icon: 'x', text: 'Vazgeç', onclick: async () => { try { status = await window.api.redundancyPkgCancel(); } catch { /* */ } P().rerender(); } }));
    } else {
      buttons.push(el('button', {
        class: 'btn small', type: 'button', icon: 'refresh', text: 'Birincilden Paket İste',
        disabled: status.state === 'connecting' || status.connected === false ? 'disabled' : null,
        onclick: async () => { try { status = await window.api.redundancyPkgRequest(); } catch { /* */ } P().rerender(); },
      }));
    }
    nodes.push(el('div', { class: 'lay-file' }, buttons));
    const res = status.pkgResult;
    if (res) {
      nodes.push(line([el('span', { text: 'Kütüphaneye alınan' }), sep(), num(res.added), sep(), el('span', { text: 'Ayrı alanda' }), sep(), num(res.isolatedCount || 0), sep(), el('span', { text: 'Aynı' }), sep(), num(res.same), sep(), el('span', { text: 'Video dosyası' }), sep(), num(res.media)]));
      /* Bu makinede olmayanlar (#812): kütüphaneye kendiliğinden girmez,
         her biri ayrı onayla alınır. */
      if (res.isolated && res.isolated.length) {
        nodes.push(el('div', { class: 'studio-note', text: 'Bu makinede yok; ayrı alanda tutuluyor ve birincilin kopyası çizilirken kullanılıyor:' }));
        const iso = el('ul', { class: 'red-diff red-isolated' });
        res.isolated.slice(0, 40).forEach((c) => iso.appendChild(el('li', {}, [
          el('span', { text: c.kind === 'logo' ? 'Logo' : 'Preset' }), sep(), el('span', { text: c.name, 'data-user-text': '' }), sep(),
          el('button', { class: 'btn small ghost', type: 'button', icon: 'plus', text: 'Kütüphaneye Ekle', onclick: () => addIsolated(c) }),
        ])));
        nodes.push(iso);
        if ((res.isolatedCount || res.isolated.length) > 40) nodes.push(el('div', { class: 'studio-note dim-hint', text: 'İlk 40 öğe gösteriliyor.' }));
      }
      if (res.conflicts && res.conflicts.length) {
        nodes.push(el('div', { class: 'studio-note', text: 'Bu makinede aynı kimlikle farklı içerik var; yerel öğe korundu:' }));
        const list = el('ul', { class: 'red-diff' });
        res.conflicts.slice(0, 40).forEach((c) => list.appendChild(el('li', {}, [
          el('span', { text: c.kind === 'logo' ? 'Logo' : 'Preset' }), sep(), el('span', { text: c.name, 'data-user-text': '' }), sep(),
          el('button', { class: 'btn small ghost', type: 'button', text: 'Birincilinkini Kullan', onclick: () => usePrimaryAsset(c) }),
        ])));
        nodes.push(list);
      }
    }
    nodes.push(el('div', { class: 'studio-note dim-hint', text: 'Paket parça parça, her parçanın özetiyle gelir; bağlantı koparsa kaldığı yerden sürer. Doğrulanmadan hiçbir şey yerine geçmez. Video dosyaları yalnız onaylarsanız kopyalanır ve birincilin sahnesi bu kopyalara eşlenir.' }));
    return el('div', { class: 'red-pkg' }, nodes);
  }

  async function usePrimaryAsset(c) {
    const ok = await P().confirm(tr('Bu makinedeki öğe birincilin sürümüyle değiştirilecek:') + '\n\n' + c.name, { okText: tr('Değiştir') });
    if (!ok) return;
    let r = null;
    try { r = await window.api.redundancyUsePrimaryAsset({ kind: c.kind, id: c.id }); } catch { /* */ }
    P().toast(r && r.ok ? tr('Birincilin sürümü kullanılıyor.') : tr('Değiştirilemedi.'), r && r.ok ? 'ok' : 'err');
  }

  async function addIsolated(c) {
    const ok = await P().confirm(tr('Bu öğe bu makinenin kütüphanesine eklenecek:') + '\n\n' + c.name, { okText: tr('Ekle') });
    if (!ok) return;
    let r = null;
    try { r = await window.api.redundancyUsePrimaryAsset({ kind: c.kind, id: c.id }); } catch { /* */ }
    P().toast(r && r.ok ? tr('Kütüphaneye eklendi.') : tr('Eklenemedi.'), r && r.ok ? 'ok' : 'err');
  }

  function parityBox() {
    const el = P().el;
    const list = Array.isArray(status.parity) ? status.parity : [];
    if (!list.length) return null;
    const ul = el('ul', { class: 'red-diff' });
    list.forEach((p) => ul.appendChild(el('li', {}, [el('span', { text: 'MilkDrop' }), sep(), el('span', { text: p.name, 'data-user-text': '' }), sep(), el('span', { class: 'dim-hint', text: PARITY_TEXT[p.status] || p.status }), sep(), el('span', { class: 'dim-hint', text: p.via === 'manual' ? 'El ile seçildi' : 'Otomatik seçim' })])));
    return el('div', { class: 'red-parity' }, [
      el('div', { class: 'studio-status err', role: 'status' }, [el('span', { icon: 'warning' }), el('span', { text: 'Görüntü birincilden farklı olabilir' })]),
      ul,
      el('div', { class: 'studio-note dim-hint', text: 'Birincilden paket isteyin: eksik presetler ayrı alandan kullanılır, farklı olanlar listede tek tek seçilir.' }),
      el('div', { class: 'studio-note dim-hint', text: 'Otomatik seçimin denetimi birincilin görselleştirici penceresi açıkken çalışır; el ile seçilen preset sahne kopyasıyla her zaman denetlenir.' }),
    ]);
  }

  /* Yerel gösteri arşivleri (#812): rol her kapanışta yerel gösteriyi
     arşivliyor; buradan onayla geri yüklenir. */
  function archiveBox() {
    const el = P().el;
    const list = Array.isArray(status.archives) ? status.archives : [];
    if (!list.length) return null;
    const ul = el('ul', { class: 'red-diff red-archives' });
    list.forEach((a) => ul.appendChild(el('li', {}, [
      el('span', { class: 'st-num', text: new Date(a.at).toLocaleString() }), sep(), num(bytes(a.size)), sep(),
      el('button', { class: 'btn small ghost', type: 'button', icon: 'reset', text: tr('Geri Yükle'), onclick: () => restoreArchive(a) }),
    ])));
    return el('div', { class: 'red-archive' }, [
      el('div', { class: 'group-label', text: 'Yerel Gösteri Arşivleri' }),
      ul,
      el('div', { class: 'studio-note dim-hint', text: 'Rol her kapatıldığında yerel gösteri burada arşivlenir. Geri yüklemeden önce şu anki gösteri de arşivlenir; işlem geri alınabilir.' }),
    ]);
  }

  async function restoreArchive(a) {
    if (!window.api.redundancyRestoreArchive) return;
    const msg = tr('Bu makinenin sahneleri, kayıtlı sahneleri, zaman çizelgesi ve Clip Deck\'i bu arşivdekilerle değiştirilecek. Şu anki gösteri önce arşivlenir.') + '\n\n' + new Date(a.at).toLocaleString();
    if (!(await P().confirm(msg, { okText: tr('Geri Yükle') }))) return;
    let r = null;
    try { r = await window.api.redundancyRestoreArchive(a.name); } catch { /* */ }
    if (r && r.ok) P().toast(r.live ? tr('Gösteri arşivden geri yüklendi.') : tr('Yerel gösteri arşivden geri yüklendi; birincilin kopyası çizilmeye devam ediyor.'), 'ok');
    else P().toast(tr('Geri yüklenemedi.'), 'err');
    try { status = await window.api.redundancyStatus(); } catch { /* */ }
    P().rerender();
  }

  async function rearm() {
    if (!window.api.redundancyRearm) return;
    if (!(await P().confirm(tr('Birincil hâlâ yoksa yedek yetkiyi hemen kendiliğinden alır. Otomatik devralma yeniden kurulsun mu?')))) return;
    try { status = await window.api.redundancyRearm(); } catch { /* */ }
    P().rerender();
  }

  async function act(which) {
    try {
      status = which === 'takeover' ? await window.api.redundancyTakeover() : await window.api.redundancyRelease();
    } catch { /* ana süreç yanıt vermedi */ }
    P().rerender();
  }

  function panel() {
    const el = P().el;
    const r = red();
    const role = r.role || 'off';
    const nodes = [];
    const push = () => P().push(true);
    nodes.push(selectRow('Bu Makinenin Rolü', [['off', 'Kapalı'], ['primary', 'Birincil'], ['backup', 'Yedek']], role,
      (v) => { r.role = v; push(); P().rerender(); }));
    nodes.push(statusBox());
    if (role === 'off') {
      nodes.push(el('div', { class: 'studio-note dim-hint', text: 'İki makineyle sıcak yedek: yedek aynı sahneyi sürekli çizer, birincil düşerse yetkiyi alır. Ekran kararmaz; hangi çıkışın seyirciye gittiğini görüntü anahtarlayıcısı seçer.' }));
      const ab0 = archiveBox();
      if (ab0) nodes.push(ab0);
      return el('div', { class: 'redundancy-panel' }, nodes);
    }

    // Eşleşme parolası: iki makinede aynı
    const secret = el('input', { class: 'p-in wide', type: 'text', value: r.secret || '', autocomplete: 'off', spellcheck: 'false', 'data-user-attr': '' });
    secret.addEventListener('change', () => { r.secret = secret.value.trim(); push(); });
    nodes.push(P().row('Eşleşme Parolası', el('div', { class: 'url-row' }, [
      secret,
      el('button', {
        class: 'btn small', type: 'button', icon: 'refresh', text: 'Yeni Parola',
        onclick: async () => { r.secret = await window.api.redundancyNewSecret(); push(); P().rerender(); },
      }),
    ])));

    if (role === 'backup') {
      nodes.push(textRow('Birincilin Adresi', r.host, (v) => { r.host = v; push(); }, { placeholder: '192.168.1.20', 'data-user-attr': '' }));
      nodes.push(numRow('Birincilin Portu', r.port || 8722, 1024, 65535, 1, (v) => { r.port = v; push(); }));
      nodes.push(numRow('Kalp Atışı (ms)', r.heartbeatMs || 250, 50, 5000, 10, (v) => { r.heartbeatMs = v; push(); }));
      nodes.push(numRow('Kayıp Eşiği (ms)', r.timeoutMs || 1500, 150, 60000, 50, (v) => { r.timeoutMs = v; push(); }));
      nodes.push(selectRow('Devralma', [['auto', 'Kendiliğinden'], ['manual', 'Elle']], r.takeover === 'manual' ? 'manual' : 'auto',
        (v) => { r.takeover = v; push(); }));
      const active = status.state === 'active';
      nodes.push(el('div', { class: 'lay-file' }, [
        el('button', { class: 'btn small' + (active ? '' : ' primary'), type: 'button', icon: 'bolt', text: 'Yetkiyi Al', disabled: active ? 'disabled' : null, onclick: () => act('takeover') }),
        el('button', { class: 'btn small ghost', type: 'button', icon: 'reset', text: 'Yetkiyi Bırak', disabled: active ? null : 'disabled', onclick: () => act('release') }),
      ]));
      /* El ile bırakıştan sonra otomatik devralma bekler (#812): birincil
         geri gelince ya da operatör yeniden kurunca biter. */
      if (status.autoHeld && !active && r.takeover !== 'manual') {
        nodes.push(el('div', { class: 'studio-status warn', role: 'status' }, [el('span', { icon: 'warning' }),
          el('span', { text: 'Yetki el ile bırakıldı: birincil yeniden görülene dek otomatik devralma duraklatıldı.' })]));
        nodes.push(el('div', { class: 'lay-file' }, [
          el('button', { class: 'btn small ghost', type: 'button', icon: 'bolt', text: 'Otomatik Devralmayı Yeniden Kur', onclick: () => rearm() }),
        ]));
      }
      nodes.push(el('div', { class: 'studio-note dim-hint', text: 'Yedek izlerken sahne birincilden gelir; burada yapılan sahne değişikliği birincilin bir sonraki değişikliğiyle ezilir. Yetkiyi alan yedek, birincil geri gelse de "Yetkiyi Bırak" denene kadar yetkide kalır.' }));
      if (!status.problem) {
        const pb = parityBox();
        if (pb) nodes.push(pb);
        nodes.push(spaceBox());
        nodes.push(packageBox());
      }
    } else {
      nodes.push(el('div', { class: 'studio-note dim-hint', text: 'Yedek bu bilgisayarın yayın sunucusuna bağlanır. Yedek başka bir bilgisayardaysa Çıkış → Yayın Çıkışı\'nda ağa açmayı etkinleştirin; yedeğe bu bilgisayarın adresini ve yayın portunu yazın.' }));
      if (status.peers) nodes.push(showBox());
    }
    const ab = archiveBox();
    if (ab) nodes.push(ab);
    nodes.push(el('div', { class: 'studio-note dim-hint', text: 'Aktarılan yalnız görüntü ve gösteri: sahne, katmanlar, kayıtlı sahneler, zaman çizelgesi, Clip Deck. Ses aygıtı, ekranlar, ağ, ışık ve dışa aktarım ayarları her makinenin kendisinde kalır. Presetleri, logoları ve videoları yedeğe "Birincilden Paket İste" kopyalar; birincilin sahnesi bu kopyalara eşlenir, dosyaların iki makinede aynı yerde olması gerekmez.' }));
    return el('div', { class: 'redundancy-panel' }, nodes);
  }

  async function init() {
    if (started || !window.api || !window.api.redundancyStatus) return;
    started = true;
    window.api.onRedundancyStatus((s) => {
      const sig = (x) => JSON.stringify([x.role, x.state, x.autoHeld, x.peers, x.peerState, x.problem, x.serverRunning, x.show && x.show.hash, x.show && x.show.peerHash, x.show && x.show.differences,
        // Yalıtılmış gösteri ve paket (#812); ilerleme en çok saniyede dört kez gelir
        x.space, x.pkg, x.pkgResult, x.parity, x.pkgMedia, x.archives]);
      const prev = sig(status);
      status = s || { role: 'off' };
      window.SVRedundancyState = status;
      const next = sig(status);
      /* Yazarken imleç kaybolmasın: ilerleme güncellemesi odak bir alandayken
         beklenir (#812, aynı kural gösteri öncesi denetimde). */
      const ae = document.activeElement;
      const typing = ae && (ae.tagName === 'INPUT' || ae.tagName === 'SELECT' || ae.tagName === 'TEXTAREA') && ae.type !== 'checkbox';
      if (prev !== next && document.querySelector('.redundancy-panel') && !typing) P().rerender();
    });
    // Birincilin taşıması (#544): zaman çizelgesi paneli onu izler
    if (window.api.onShowClockFollow) {
      window.api.onShowClockFollow((a) => { if (window.SVTimelinePanel && window.SVTimelinePanel.followAnchor) window.SVTimelinePanel.followAnchor(a); });
    }
    try { status = await window.api.redundancyStatus(); window.SVRedundancyState = status; } catch { /* */ }
  }

  // Otomatik VJ gibi kendi karar veren işler: yedek birincili izlerken durur
  function following() {
    const s = window.SVRedundancyState;
    return !!(s && s.role === 'backup' && (s.state === 'following' || s.state === 'lost' || s.state === 'connecting') && !s.problem);
  }

  window.SVRedundancyPanel = { panel, init, following };
})();
