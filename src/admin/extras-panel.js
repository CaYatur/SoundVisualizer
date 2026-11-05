/*
 * SoundVisualizer — CaYaDev Ses Görselleştirici
 * Copyright (c) 2026 Çağan Turgut (CaYatur) — CaYaDev, https://cayadev.com
 * https://github.com/CaYatur/SoundVisualizer
 * SPDX-License-Identifier: MIT
 */
'use strict';
/* Ek ayar panelleri: boşta ekran koruyucu, oturum kurtarma, otomatik söz
   bulma (#937) ve çoklu kopya kumandası. Satırlar SVPanel üreticileriyle
   kuruluyor; görünüm öbür kartlarla aynı. */
(function () {
  const P = () => window.SVPanel;
  const T = (s) => (window.SVI18n && window.SVI18n.t ? window.SVI18n.t(s) : s);

  function note(text) { return P().el('div', { class: 'note', text: T(text) }); }

  function textArea(value, placeholder, onChange) {
    const t = P().el('textarea', {
      class: 'p-in', rows: '3', spellcheck: 'false', placeholder,
      style: 'width:100%;font-family:monospace;font-size:12px;',
      onchange: (e) => onChange(e.target.value),
    });
    // textarea value özniteliğini okumaz; özellik olarak verilmeli
    t.value = value || '';
    return t;
  }

  function screensaver() {
    const p = P();
    const cfg = p.cfg();
    if (!cfg.screensaver) cfg.screensaver = window.SVScreensaver ? window.SVScreensaver.defaults() : { enabled: false, idleSec: 300 };
    const s = cfg.screensaver;
    const nodes = [
      p.toggle(T('Ekran Koruyucu'), 'screensaver.enabled'),
      p.slider(T('Bekleme (sn)'), 'screensaver.idleSec', { min: 10, max: 3600, step: 10, noExtend: true }),
      p.slider(T('Karartma'), 'screensaver.dim', { min: 0.2, max: 1, step: 0.05, percent: true }),
      p.toggle(T('Saati Göster'), 'screensaver.showClock'),
      p.row(T('Yazı'), p.el('input', {
        class: 'p-in', type: 'text', maxlength: '80', value: s.text || '', placeholder: T('ör. Birazdan başlıyoruz'),
        onchange: (e) => { s.text = e.target.value.slice(0, 80); p.push(true); },
      })),
      note('Ses bu süre boyunca kesik kalınca çıkış kararır, saat ve yazı ekranda yavaşça gezinir (projeksiyon ve LED duvarlarda iz kalmasın). Ses gelince hemen çıkar. Tüm sistemlerde çalışır.'),
    ];
    return p.el('div', { class: 'control-panel' }, nodes);
  }

  function recovery() {
    const p = P();
    const cfg = p.cfg();
    if (!cfg.recovery) cfg.recovery = { enabled: true, intervalSec: 120 };
    return p.el('div', { class: 'control-panel' }, [
      p.toggle(T('Otomatik Kurtarma Kopyası'), 'recovery.enabled'),
      p.slider(T('Kopya Aralığı (sn)'), 'recovery.intervalSec', { min: 15, max: 900, step: 15, noExtend: true }),
      note('Ayarların anlık kopyası uygulama veri klasöründeki recovery/ altına yazılır (son 5 kopya). Uygulama çöktükten sonra ayar dosyası okunamazsa en yeni sağlam kopya kendiliğinden geri yüklenir.'),
    ]);
  }

  function lyricsLookup() {
    const p = P();
    const el = p.el;
    const cfg = p.cfg();
    if (!cfg.lyricsLookup) cfg.lyricsLookup = { enabled: false, sidecar: true, embedded: true, cache: true, providers: [], timeoutMs: 4000 };
    const L = cfg.lyricsLookup;
    if (!Array.isArray(L.providers)) L.providers = [];
    const nodes = [
      p.toggle(T('Sözleri Otomatik Bul'), 'lyricsLookup.enabled'),
      p.toggle(T('Yandaki .lrc / .srt Dosyası'), 'lyricsLookup.sidecar'),
      p.toggle(T('Dosyaya Gömülü Sözler'), 'lyricsLookup.embedded'),
      p.toggle(T('Yerel Önbellek'), 'lyricsLookup.cache'),
      p.slider(T('Sağlayıcı Zaman Aşımı (ms)'), 'lyricsLookup.timeoutMs', { min: 1000, max: 15000, step: 500, noExtend: true }),
    ];
    const list = el('div', { class: 'map-list' });
    if (!L.providers.length) list.appendChild(el('div', { class: 'studio-empty', text: T('Sağlayıcı yok: hiçbir ağ isteği yapılmaz.') }));
    L.providers.forEach((pr, i) => {
      const kind = el('select', { class: 'p-in', onchange: (e) => { pr.format = e.target.value; p.push(true); p.rerender(); } });
      [['json', 'JSON'], ['lrc', T('Ham LRC')]].forEach(([v, t]) => {
        const o = el('option', { value: v, text: t });
        if ((pr.format || 'json') === v) o.selected = true;
        kind.appendChild(o);
      });
      const row = [
        el('input', { class: 'p-in', type: 'checkbox', checked: pr.enabled !== false, title: T('Etkin'),
          onchange: (e) => { pr.enabled = e.target.checked; p.push(true); } }),
        el('input', { class: 'p-in', type: 'text', value: pr.name || '', placeholder: T('Ad'), style: 'max-width:110px',
          onchange: (e) => { pr.name = e.target.value.slice(0, 40); p.push(true); } }),
        el('input', { class: 'p-in', type: 'text', value: pr.url || '', placeholder: 'https://example.com/api/get?artist={artist}&title={title}',
          onchange: (e) => { pr.url = e.target.value.trim().slice(0, 500); p.push(true); } }),
        kind,
      ];
      if ((pr.format || 'json') === 'json') {
        row.push(el('input', { class: 'p-in', type: 'text', value: pr.path || '', placeholder: 'syncedLyrics', style: 'max-width:140px',
          title: T('Sözlerin JSON yolu (ör. data.lyrics)'), onchange: (e) => { pr.path = e.target.value.trim().slice(0, 200); p.push(true); } }));
      }
      row.push(el('button', { class: 'btn ghost small', type: 'button', icon: 'x', title: T('Kaldır'),
        onclick: () => { L.providers.splice(i, 1); p.push(true); p.rerender(); } }));
      list.appendChild(el('div', { class: 'map-row' }, row));
    });
    list.appendChild(el('div', { class: 'map-row', style: 'gap:8px;flex-wrap:wrap;align-items:center' }, [
      el('button', {
        class: 'btn ghost small', type: 'button', icon: 'plus', text: T('Sağlayıcı Ekle'),
        onclick: () => {
          L.providers.push({ enabled: true, name: '', url: 'https://example.com/api/get?artist={artist}&title={title}', format: 'json', path: 'syncedLyrics' });
          p.push(true); p.rerender();
        },
      }),
      el('button', {
        class: 'btn ghost small', type: 'button', icon: 'plus', text: T('LRCLIB Ekle'),
        title: T('LRCLIB hazır şablonunu ekle (isteğe bağlı)'),
        onclick: () => {
          const api = window.SVLyricsProviders;
          if (!api) return;
          const r = api.addLrclibPreset(L.providers);
          if (!r.added) { p.toast(T('LRCLIB zaten listede.'), 'info'); return; }
          p.push(true); p.rerender();
          p.toast(T('LRCLIB eklendi.'), 'ok');
        },
      }),
    ]));
    nodes.push(list);
    nodes.push(el('button', {
      class: 'btn ghost small', type: 'button', text: T('Söz Önbelleğini Temizle'),
      onclick: async () => {
        if (window.api && window.api.lyricsCacheClear) await window.api.lyricsCacheClear();
        p.toast(T('Söz önbelleği temizlendi.'));
      },
    }));
    nodes.push(note('Sıra: şarkının yanındaki .lrc/.srt → dosyaya gömülü sözler (ID3 USLT/SYLT, Vorbis LYRICS, MP4 lyr) → önbellek → sağlayıcılar (yukarıdan aşağı). Adreste {artist}, {title}, {album} ve {duration} kullanılabilir. Sağlayıcı hatası çalmayı asla durdurmaz; sağlayıcı yoksa ağa çıkılmaz. LRCLIB hazır isteğe bağlı bir şablondur; zorunlu değildir.'));
    return el('div', { class: 'control-panel' }, nodes);
  }

  function peers() {
    const p = P();
    const el = p.el;
    const cfg = p.cfg();
    const st = cfg.stream || (cfg.stream = {});
    const status = el('div', { class: 'note', text: '' });
    if (window.api && window.api.remotePeersStatus) {
      window.api.remotePeersStatus().then((list) => {
        if (!list || !list.length) return;
        status.textContent = list.map((x) => x.host + ': ' + T(x.connected ? 'bağlı' : 'bağlı değil')).join(' · ');
      }).catch(() => {});
    }
    return el('div', { class: 'control-panel' }, [
      p.row(T('Öbür Kopyalar'), textArea(st.remotePeers, 'http://192.168.1.21:8722/remote?token=…', (v) => { st.remotePeers = v.slice(0, 4000); p.push(true); })),
      status,
      note('Her satıra öbür kopyanın uzaktan kumanda adresini (jetonuyla) yapıştırın. Bu kopyanın kumandasından gelen her komut onlara da gider; böylece tek telefon birden çok kopyayı (başka makinedekiler dahil) birlikte sürer. Yayın sunucusu ve kumanda açık olmalı. Döngü olmaz: aktarılan komut bir daha aktarılmaz.'),
    ]);
  }

  // Açılışta: önceki oturum çöktüyse bildir
  async function checkRecovery() {
    if (!window.api || !window.api.recoveryStatus) return;
    try {
      const n = await window.api.recoveryStatus();
      if (!n) return;
      const text = n.restored
        ? 'Önceki oturum beklenmedik biçimde kapandı; ayarlar son kurtarma kopyasından geri yüklendi.'
        : n.intact
          ? 'Önceki oturum beklenmedik biçimde kapandı. Ayarlar sağlam, olduğu gibi açıldı.'
          : 'Önceki oturum beklenmedik biçimde kapandı. Ayar dosyası okunamadı, varsayılan ayarlarla açıldı.';
      P().toast(T(text), n.restored || !n.intact ? 'warn' : 'info');
    } catch { /* */ }
  }

  function panel(kind) {
    if (kind === 'screensaver') return screensaver();
    if (kind === 'recovery') return recovery();
    if (kind === 'lyricsLookup') return lyricsLookup();
    if (kind === 'peers') return peers();
    return null;
  }

  window.SVExtrasPanel = { panel, checkRecovery };
})();
