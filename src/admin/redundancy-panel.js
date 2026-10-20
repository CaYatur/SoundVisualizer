/*
 * SoundVisualizer — CaYaDev Ses Görselleştirici
 * Copyright (c) 2026 Çağan Turgut (CaYatur) — CaYaDev, https://cayadev.com
 * https://github.com/CaYatur/SoundVisualizer
 * SPDX-License-Identifier: MIT
 */
'use strict';
/* YEDEKLİLİK paneli (#540). İşin kendisi ana süreçte (main/redundancy.js);
   burada rol, eşleşme parolası, adres, eşik, devralma biçimi ve durum.
   Yetkiyi elle alma/bırakma ağ ayarına dokunmadan yapılır (#546).

   DÜZEN (#816): üstte durum hapı ve ölçüm kutucukları (son atış, en uzun
   boşluk, atış aralığı, titreme, kayıp atış, saat farkı, süre); altında
   gruplar: Yetki, Bağlantı, Gösteri Verisi, Gösteri Paketi, Arşivler.
   Uzun açıklamalar "?" yardımında. Kutucuklar panel açıkken saniyede bir
   yerinde güncellenir (yeniden çizim yok: yazılan alan odağını kaybetmez).
   Görünüm ses köprüsü kartıyla aynı parçalar (bridge.css: br-pill, br-tile). */
(function () {
  const P = () => window.SVPanel;
  let status = { role: 'off' };
  let started = false;
  let liveTimer = null;

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
  const PEER_STATE_TEXT = { following: 'izliyor', active: 'yetkide', lost: 'birincili kaybetti', connecting: 'bağlanıyor' };
  // Yetki (#814)
  const HOLDER_TEXT = { self: 'Bu makinede', peer: 'Öteki makinede', unknown: 'Bekleniyor' };
  const OUTPUT_TEXT = { artnet: 'Art-Net', oscOut: 'OSC Çıkışı', openrgb: 'OpenRGB', lighting: 'Dynamic Lighting' };
  const PRE_TEXT = {
    'not-active': 'Yetki bu makinede',
    'primary-alive': 'Birincil en az 5 sn kesintisiz atıyor',
    'show-unknown': 'Gösteriler aynı',
    'show-differs': 'Gösteriler aynı',
    clock: 'Saat eşlendi (en az 20 örnek)',
    version: 'İki makinede aynı uygulama sürümü',
  };
  const PRE_ORDER = ['not-active', 'primary-alive', 'show-differs', 'clock', 'version'];

  const tr = (s) => (window.SVI18n && window.SVI18n.t ? window.SVI18n.t(s) : s);

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
  function checkRow(label, value, onSet) {
    const el = P().el;
    const c = el('input', { type: 'checkbox' });
    c.checked = !!value;
    c.addEventListener('change', () => onSet(c.checked));
    return el('label', { class: 'chk red-chk' }, [c, el('span', { text: label })]);
  }
  function selectRow(label, options, value, onSet) {
    const el = P().el;
    const sel = el('select', { class: 'sel-ctrl' });
    options.forEach(([v, t]) => { const o = el('option', { value: v, text: t }); if (v === value) o.selected = true; sel.appendChild(o); });
    sel.addEventListener('change', () => onSet(sel.value));
    return P().row(label, sel);
  }

  /* ---- Görünüm parçaları -------------------------------------------------- */
  function pill(tone, text) {
    const el = P().el;
    return el('span', { class: 'br-pill ' + (tone || 'off'), role: 'status' }, [el('span', { class: 'br-dot' }), el('span', { text })]);
  }
  // Kutucuk: `key` canlı güncelleme için; değer ve not sayısal (çevrilmez)
  function tile(key, label, value, opts) {
    const el = P().el;
    const o = opts || {};
    return el('div', { class: 'br-tile' + (o.tone ? ' ' + o.tone : ''), 'data-stat': key }, [
      el('div', { class: 'br-tile-k', text: label }),
      el('div', { class: 'br-tile-v', text: String(value) }),
      el('div', { class: 'br-tile-n', text: o.note || '' }),
    ]);
  }
  /* "?" yardımı: açık olanlar burada tutulur, yeniden çizimde açık kalır. */
  const openHelp = new Set();
  function help(key, text) {
    const el = P().el;
    const box = el('details', { class: 'br-help red-help' }, [
      el('summary', { 'aria-label': tr('Yardım'), title: tr('Yardım'), text: '?' }),
      el('div', { class: 'br-help-body', text }),
    ]);
    if (openHelp.has(key)) box.open = true;
    box.addEventListener('toggle', () => { if (box.open) openHelp.add(key); else openHelp.delete(key); });
    return box;
  }
  // Grup başlığı: etiket, isteğe bağlı hap ve "?"
  function head(label, opts) {
    const el = P().el;
    const o = opts || {};
    return el('div', { class: 'br-head red-head' }, [
      el('div', { class: 'red-head-l' }, [el('div', { class: 'group-label', text: label }), o.help ? help(o.helpKey || label, o.help) : null].filter(Boolean)),
      o.pill || null,
    ].filter(Boolean));
  }
  function group(nodes, cls) { return P().el('div', { class: 'red-group' + (cls ? ' ' + cls : '') }, nodes.filter(Boolean)); }
  function grid(nodes) { return P().el('div', { class: 'br-grid red-grid' }, nodes.filter(Boolean)); }

  function bytes(n) {
    const v = Number(n) || 0;
    if (v >= 1e9) return (v / 1e9).toFixed(2) + ' GB';
    if (v >= 1e6) return (v / 1e6).toFixed(1) + ' MB';
    if (v >= 1e3) return Math.round(v / 1e3) + ' KB';
    return v + ' B';
  }
  function ms(v) { return v == null || !Number.isFinite(Number(v)) ? '—' : Math.round(v) + ' ms'; }
  // Süre dilden bağımsız: 0:42, 12:05, 1:04:12
  function dur(t) {
    const s = Math.max(0, Math.round((Number(t) || 0) / 1000));
    const p2 = (n) => String(n).padStart(2, '0');
    const h = Math.floor(s / 3600);
    const m = Math.floor((s % 3600) / 60);
    return h ? h + ':' + p2(m) + ':' + p2(s % 60) : m + ':' + p2(s % 60);
  }
  function line(kids) { return P().el('div', { class: 'studio-note' }, kids); }
  function num(t) { return P().el('span', { class: 'st-num', text: String(t) }); }
  function sep() { return P().el('span', { class: 'st-sep', 'aria-hidden': 'true', text: ' · ' }); }

  /* ---- Durum: hap ve kutucuklar ------------------------------------------- */
  function stateTone(s) {
    if (s.problem) return 'err';
    if (s.role === 'primary') return !s.serverRunning ? 'err' : s.peerState === 'active' ? 'warn' : s.peers ? 'ok' : 'off';
    if (s.role === 'backup') return s.state === 'following' ? (s.autoHeld ? 'warn' : 'ok') : s.state === 'lost' ? 'err' : s.state === 'active' ? 'warn' : 'off';
    return 'off';
  }
  function stateText(s) {
    if (s.problem) return PROBLEM_TEXT[s.problem] || s.problem;
    if (s.role === 'primary') {
      if (!s.serverRunning) return 'Yayın sunucusu açılamadı';
      if (s.peerState === 'active') return 'Yedek yetkiyi aldı';
      return s.peers ? 'Yedek bağlı' : 'Yedek bekleniyor';
    }
    if (s.role === 'backup') {
      /* Elle bırakıştan sonra otomatik devralma duruyor; "elle devralma
         bekleniyor · otomatik devralma bekletiliyor" çelişkili okunuyordu. */
      const heldLost = s.autoHeld && s.state === 'lost';
      return heldLost ? 'Birincil yanıt vermiyor' : (STATE_TEXT[s.state] || 'Kapalı');
    }
    return 'Kapalı';
  }

  /* Kutucukların değerleri: hem ilk çizim hem canlı güncelleme buradan.
     [anahtar, etiket, değer, { tone, note }] */
  function tileSpecs(s) {
    const now = Date.now();
    const out = [];
    const auth = (k) => ['auth', 'Yetki', tr(HOLDER_TEXT[s.holder] || '—'), { tone: s.split ? 'err' : s.holder === 'self' ? 'ok' : s.holder === 'peer' ? '' : 'warn', note: tr('dönem') + ' ' + (s.term || 0) }];
    if (s.role === 'primary') {
      out.push(auth());
      const conn = s.peers > 0;
      out.push(['peer', 'Yedek', tr(conn ? 'Bağlı' : 'Yok'), { tone: conn ? 'ok' : 'dim', note: conn && s.peerState ? tr(PEER_STATE_TEXT[s.peerState] || s.peerState) : '' }]);
      out.push(['up', 'Bağlantı süresi', conn && s.peerSince ? dur(now - s.peerSince) : '—', { tone: conn ? '' : 'dim' }]);
      out.push(['hb', 'Atış aralığı', ms(s.heartbeatMs), { note: (s.beatsSent || 0) + ' ' + tr('atış gönderildi') }]);
      const late = (s.ownMaxGap || 0) - (s.heartbeatMs || 0);
      out.push(['own', 'En uzun gecikme', ms(s.ownMaxGap), { tone: late > 500 ? 'warn' : '', note: tr('bu makinenin') }]);
      if (s.show) out.push(['show', 'Gösteri', s.show.differences ? s.show.differences + ' ' + tr('fark') : tr('Aynı'), { tone: s.show.differences ? 'warn' : 'ok' }]);
      return out;
    }
    if (s.role !== 'backup' || s.problem) return out;
    out.push(auth());
    const limit = s.lossLimitMs || s.timeoutMs || 1500;
    const since = s.lastBeat ? now - s.lastBeat : null;
    const ratio = since == null ? 0 : since / limit;
    const beating = s.state === 'following' || s.state === 'active';
    out.push(['last', 'Son atış', since == null ? '—' : ms(since), { tone: since == null ? 'dim' : ratio > 0.66 ? 'err' : ratio > 0.33 ? 'warn' : 'ok', note: tr('eşik') + ' ' + ms(limit) }]);
    out.push(['gap', 'En uzun boşluk', ms(s.maxGap), { tone: s.maxGap > limit * 0.66 ? 'err' : s.maxGap > limit * 0.4 ? 'warn' : '', note: tr('birincilde') + ' ' + ms(s.maxPrimaryGap) }]);
    out.push(['p95', 'Atış aralığı p95', ms(s.gapP95Ms), { note: tr('hedef') + ' ' + ms(s.heartbeatMs) }]);
    out.push(['jit', 'Titreme', ms(s.jitterMs), { tone: s.jitterMs > (s.heartbeatMs || 250) ? 'warn' : '' }]);
    out.push(['miss', 'Kayıp atış', String(s.missed || 0), { tone: s.missed ? 'warn' : '', note: (s.beats || 0) + ' ' + tr('alındı') }]);
    const off = s.offsetMs;
    out.push(['clk', 'Saat farkı', off == null ? '—' : (off > 0 ? '+' : '') + Math.round(off) + ' ms', { tone: (s.offsetSamples || 0) < 20 ? 'dim' : '', note: (s.offsetSamples || 0) + ' ' + tr('örnek') }]);
    // Vuruş eşlemesi (#815): birincilin temposu ve bu makinenin algısının ızgaraya uzaklığı
    const tr0 = s.tempoRemote;
    out.push(['bpm', 'Birincilin temposu', tr0 && tr0.bpm ? Math.round(tr0.bpm) + ' BPM' : '—', { tone: tr0 && tr0.bpm ? '' : 'dim', note: s.tempo && s.tempo.following ? tr('ızgara izleniyor') : '' }]);
    out.push(['perr', 'Faz farkı p95', s.tempo && s.tempo.phaseErrP95 != null ? s.tempo.phaseErrP95 + ' ms' : '—', { tone: s.tempo && s.tempo.phaseErrP95 > 30 ? 'warn' : '', note: tr('kendi algısı') }]);
    out.push(['since', s.state === 'active' ? 'Yetkide' : 'Bu durumda', s.since ? dur(now - s.since) : '—', { tone: beating ? '' : 'dim', note: s.state === 'active' && s.takenBy ? tr(s.takenBy === 'auto' ? 'kendiliğinden' : 'elle') : '' }]);
    return out;
  }
  function tiles(s) {
    const specs = tileSpecs(s);
    if (!specs.length) return null;
    return grid(specs.map(([k, label, v, o]) => tile(k, label, v, o)));
  }
  // Panel açıkken: yalnız kutucukların yazısı ve tonu
  function updateTiles(s) {
    const root = document.querySelector('.redundancy-panel');
    if (!root) return;
    const specs = tileSpecs(s).concat(s.peerInfo ? peerSpecs(s.peerInfo) : []);
    for (const [k, , v, o] of specs) {
      const t = root.querySelector('[data-stat="' + k + '"]');
      if (!t) continue;
      const vEl = t.querySelector('.br-tile-v');
      const nEl = t.querySelector('.br-tile-n');
      if (vEl && vEl.textContent !== String(v)) vEl.textContent = String(v);
      if (nEl && nEl.textContent !== (o.note || '')) nEl.textContent = o.note || '';
      t.className = 'br-tile' + (o.tone ? ' ' + o.tone : '');
    }
  }
  function ensureLive() {
    if (liveTimer || typeof setInterval !== 'function') return;
    // Öteki makinenin önizlemesi yalnız bu bölüm görünürken (#814)
    if (window.api.redundancyMonitor) window.api.redundancyMonitor(true).catch(() => {});
    liveTimer = setInterval(async () => {
      if (!document.querySelector('.redundancy-panel') || status.role === 'off') {
        clearInterval(liveTimer); liveTimer = null;
        monFrame = null;
        if (window.api.redundancyMonitor) window.api.redundancyMonitor(false).catch(() => {});
        return;
      }
      try { status = Object.assign({}, status, await window.api.redundancyStatus()); window.SVRedundancyState = status; } catch { return; }
      updateTiles(status);
    }, 1000);
  }

  function statusBlock() {
    const nodes = [head('Durum', { pill: pill(stateTone(status), stateText(status)) })];
    const t = tiles(status);
    if (t) nodes.push(t);
    const el = P().el;
    /* İKİ YÖNETİCİ (#814): iki makine de karar veriyor. Panelde en üstte,
       ne yapılacağıyla. Çit: yeniden açılan birincil yedeği bekliyor. */
    if (status.split) {
      nodes.push(el('div', { class: 'br-err red-split', role: 'alert' }, [
        el('strong', { text: 'İki yönetici: iki makine de yetkide.' }),
        el('span', { text: ' ' }),
        el('span', { text: status.split === 'artnet' ? 'Ağda aynı Art-Net evrenine başka bir makine de gönderiyor.' : 'Öteki makine de yetkiyi kendinde görüyor.' }),
        el('span', { text: ' ' }),
        el('span', { text: 'Birinde yetkiyi bırakın ya da birincile geri verin.' }),
      ]));
    } else if (status.fenced) {
      nodes.push(el('div', { class: 'br-warn', text: 'Birincil, yedeğin yetkide olup olmadığını bekliyor; ışık ve OSC çıkışı o zamana dek kapalı.' }));
    } else if (status.role === 'primary' && status.holder === 'peer') {
      nodes.push(el('div', { class: 'br-warn', text: 'Yetki yedekte: bu makinenin ışık ve OSC çıkışı kapalı, Otomatik VJ ve zaman çizelgesi karar vermiyor.' }));
    }
    nodes.push(checkRow('Alarmda Ses Çal', red().alarmSound === true, (v) => { red().alarmSound = v; P().push(true); }));
    if (status.role === 'backup' && status.autoHeld && status.state !== 'active') {
      const heldLost = status.autoHeld && status.state === 'lost';
      nodes.push(el('div', { class: 'br-warn', text: heldLost
        ? 'Otomatik devralma elle bırakıştan beri duraklatıldı: elle devralın ya da yeniden kurun'
        : 'Otomatik devralma duraklatıldı (elle bırakıldı)' }));
    }
    return group(nodes, 'red-status');
  }

  /* GÖSTERİ KARŞILAŞTIRMASI (#541): iki makinenin gösteri özeti ve fark
     listesi. Presetler ve logolar onayla gönderilir; video dosyaları elle
     kopyalanır. */
  const KIND_TEXT = { cfg: 'Ayar', preset: 'Preset', logo: 'Logo', media: 'Video dosyası', app: 'Uygulama sürümü' };
  const DIFF_TEXT = { missing: 'yedekte yok', different: 'farklı', extra: 'yalnız yedekte' };

  function showBox() {
    const el = P().el;
    const sh = status.show;
    const same = sh && sh.differences === 0;
    const nodes = [head('Gösteri Karşılaştırması', {
      pill: sh ? pill(same ? 'ok' : 'warn', same ? 'İki makine aynı gösteriyi çalıştırıyor' : 'Gösteriler farklı') : pill('off', 'Yedekten envanter bekleniyor.'),
      help: 'Yedekte olmayan presetler ve logolar gönderilir; yedek onları kütüphanesine eklemeden ayrı alanda tutar, aynı kimlikli öğesi değişmez. Videolar ve farklı öğeler için yedekte "Birincilden Paket İste"yi kullanın.',
    })];
    if (sh && !same) {
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
    if (sh && sh.hash) nodes.push(el('div', { class: 'br-sub' }, [el('span', { text: 'Gösteri özeti' }), sep(), num(String(sh.hash).slice(0, 12))]));
    nodes.push(el('div', { class: 'lay-file' }, [
      el('button', { class: 'btn small ghost', type: 'button', icon: 'refresh', text: 'Karşılaştır', onclick: async () => { try { await window.api.redundancyCompare(); } catch { /* */ } } }),
      el('button', {
        class: 'btn small', type: 'button', icon: 'export', text: 'Farkları Yedeğe Gönder',
        disabled: sh && sh.pushable > 0 ? null : 'disabled',
        onclick: pushDiff,
      }),
    ]));
    return group(nodes, 'red-show');
  }

  async function pushDiff() {
    const sh = status.show;
    if (!sh || !sh.pushable) return;
    // Açık onay: neyin değişeceği listelenir
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

  // Açılır liste: başlık sayıyla, içerik yalnız açılınca görünür (uzun listeler sayfayı kaplamasın)
  const openLists = new Set();
  function fold(key, title, count, body) {
    const el = P().el;
    const d = el('details', { class: 'red-fold' }, [
      el('summary', {}, [el('span', { text: title }), sep(), num(count)]),
      body,
    ]);
    if (openLists.has(key)) d.open = true;
    d.addEventListener('toggle', () => { if (d.open) openLists.add(key); else openLists.delete(key); });
    return d;
  }

  function spaceBox() {
    const el = P().el;
    const sp = status.space;
    const nodes = [head('Gösteri Verisi', {
      help: 'Birincilden gelenler ayrı bir alanda tutulur; bu makinenin kendi sahneleri, presetleri ve logoları değişmez. Rol kapatılınca kendi gösteriniz olduğu gibi geri gelir. Aktarılan yalnız görüntü ve gösteri: sahne, katmanlar, kayıtlı sahneler, zaman çizelgesi, Clip Deck. Ses aygıtı, ekranlar, ağ, ışık ve dışa aktarım ayarları her makinenin kendisinde kalır.',
    })];
    nodes.push(selectRow('Devralmada Kullanılacak Gösteri', [['primary', 'Birincilin kopyası'], ['local', 'Bu makinenin gösterisi']],
      red().takeoverData === 'local' ? 'local' : 'primary', (v) => { red().takeoverData = v; P().push(true); }));
    if (!sp) {
      nodes.push(el('div', { class: 'studio-note dim-hint', text: 'Yerel gösteri ayrı tutulamadı; ayrıntı geliştirici konsolunda.' }));
      return group(nodes, 'red-space');
    }
    /* Devralmada birincilin kopyası çizilirse kullanılacak videolar (#812):
       paketle bu makineye kopyalananlar, adı ve boyutuyla. */
    const vids = Array.isArray(status.pkgMedia) ? status.pkgMedia : [];
    const scenes = Array.isArray(sp.primaryScenes) ? sp.primaryScenes : [];
    nodes.push(grid([
      tile('src', 'Şu an çizilen', tr(SOURCE_TEXT[sp.source] || sp.source), { tone: sp.source === 'local' ? 'warn' : '' }),
      tile('psc', 'Birincilin sahneleri', String(scenes.length)),
      tile('lsc', 'Yerel sahneler', String(sp.local ? sp.local.scenes : 0)),
      tile('vid', 'Videolar', String(vids.length), { note: bytes(vids.reduce((n, v) => n + (Number(v.size) || 0), 0)), tone: vids.length ? '' : 'dim' }),
    ]));
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
    if (scenes.length) {
      const list = el('ul', { class: 'red-diff' });
      scenes.slice(0, 50).forEach((sc) => {
        list.appendChild(el('li', {}, [
          el('span', { text: sc.name, 'data-user-text': '' }),
          el('button', { class: 'btn small ghost', type: 'button', icon: 'import', text: 'Yerel Gösteriye Aktar', onclick: () => importScene(sc) }),
        ]));
      });
      nodes.push(fold('scenes', 'Birincilin kayıtlı sahneleri', scenes.length, list));
    }
    if (vids.length) {
      nodes.push(fold('videos', 'Bu makineye kopyalanmış videolar', vids.length, mediaList(vids)));
      nodes.push(el('div', { class: 'lay-file' }, [el('button', { class: 'btn small danger', type: 'button', icon: 'trash', text: 'Kopyalanmış Videoları Kaldır', onclick: () => removeVideos(vids) })]));
    }
    else nodes.push(el('div', { class: 'br-sub', text: 'Birincilin sahnesindeki videolar bu makinede yoksa boş görünür; "Birincilden Paket İste" ile "Video dosyalarını da kopyala"yı seçin.' }));
    return group(nodes, 'red-space');
  }

  /* Kopyalanmış videoları kaldır (#815): yalnız paket klasörü; presetler ve
     logolar kalır. Oynayan video kilitliyse sonraki temizlikte gider. */
  async function removeVideos(vids) {
    if (!window.api.redundancyRemoveVideos) return;
    const total = vids.reduce((n, v) => n + (Number(v.size) || 0), 0);
    const msg = tr('Bu makineye kopyalanan videolar silinecek; presetler ve logolar kalır. Birincilin kopyası çizilirken bu videolar boş görünür.') + '\n\n' + vids.length + ' · ' + bytes(total);
    if (!(await P().confirm(msg, { okText: tr('Kaldır') }))) return;
    let r = null;
    try { r = await window.api.redundancyRemoveVideos(); } catch { /* */ }
    if (r && r.ok) P().toast(tr('Videolar kaldırıldı:') + ' ' + bytes(r.freed) + (r.locked ? ' · ' + r.locked + ' ' + tr('kullanımda, sonra silinecek') : ''), 'ok');
    else P().toast(tr('Kaldırılamadı.'), 'err');
    try { status = await window.api.redundancyStatus(); } catch { /* */ }
    P().rerender();
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
    const tone = pk.state === 'done' ? 'ok' : pk.state === 'error' ? 'err' : pk.state === 'offered' ? 'warn' : pk.state === 'idle' ? 'off' : '';
    const nodes = [head('Gösteri Paketi', {
      pill: pill(tone, tr(PKG_STATE_TEXT[pk.state] || pk.state)),
      help: 'Paket parça parça, her parçanın özetiyle gelir; bağlantı koparsa kaldığı yerden sürer. Doğrulanmadan hiçbir şey yerine geçmez. Video dosyaları yalnız onaylarsanız kopyalanır ve birincilin sahnesi bu kopyalara eşlenir.',
    })];
    if (pk.state === 'error' && pk.error) nodes.push(el('div', { class: 'br-err' }, [el('span', { text: 'Kopyalama durdu' }), sep(), el('span', { class: 'st-num', text: pk.error })]));
    if (pk.summary) {
      const t = [];
      for (const k of ['presets', 'logos', 'media']) {
        const g = pk.summary[k];
        if (!g || !g.n) continue;
        t.push(tile('pk-' + k, PKG_KIND_TEXT[k], String(g.n), { note: bytes(g.bytes) }));
      }
      if (t.length) nodes.push(grid(t));
    }
    if (pk.progress && (pk.state === 'transferring' || pk.state === 'verifying' || pk.state === 'done' || pk.state === 'error')) {
      const pr = pk.progress;
      nodes.push(el('progress', { class: 'red-progress', max: String(pr.total || 1), value: String(pr.bytes || 0), 'aria-label': tr('Kopyalama ilerlemesi') }));
      nodes.push(el('div', { class: 'br-sub' }, [num(bytes(pr.bytes) + ' / ' + bytes(pr.total)), sep(), num(pr.files + ' / ' + pr.of), sep(), num(bytes(pk.speed) + '/s')]));
    }
    if (pk.state === 'offered' || pk.state === 'transferring') {
      const files = el('ul', { class: 'red-diff red-pkg-files' });
      (pk.files || []).slice(0, 30).forEach((f) => files.appendChild(el('li', {}, [
        el('span', { text: PKG_KIND_TEXT[f.kind] || f.kind }), sep(), el('span', { text: f.name, 'data-user-text': '' }), sep(), num(bytes(f.size)),
      ])));
      nodes.push(fold('pkgfiles', 'Paketteki dosyalar', (pk.files || []).length, files));
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
      nodes.push(grid([
        tile('r-add', 'Kütüphaneye alınan', String(res.added)),
        tile('r-iso', 'Ayrı alanda', String(res.isolatedCount || 0)),
        tile('r-same', 'Aynı', String(res.same)),
        tile('r-vid', 'Video dosyası', String(res.media)),
      ]));
      /* Bu makinede olmayanlar (#812): kütüphaneye kendiliğinden girmez,
         her biri ayrı onayla alınır. */
      if (res.isolated && res.isolated.length) {
        const iso = el('ul', { class: 'red-diff red-isolated' });
        res.isolated.slice(0, 40).forEach((c) => iso.appendChild(el('li', {}, [
          el('span', { text: c.kind === 'logo' ? 'Logo' : 'Preset' }), sep(), el('span', { text: c.name, 'data-user-text': '' }),
          el('button', { class: 'btn small ghost', type: 'button', icon: 'plus', text: 'Kütüphaneye Ekle', onclick: () => addIsolated(c) }),
        ])));
        const body = el('div', {}, [el('div', { class: 'studio-note', text: 'Bu makinede yok; ayrı alanda tutuluyor ve birincilin kopyası çizilirken kullanılıyor:' }), iso]);
        if ((res.isolatedCount || res.isolated.length) > 40) body.appendChild(el('div', { class: 'studio-note dim-hint', text: 'İlk 40 öğe gösteriliyor.' }));
        nodes.push(fold('isolated', 'Ayrı alanda', res.isolatedCount || res.isolated.length, body));
      }
      if (res.conflicts && res.conflicts.length) {
        const list = el('ul', { class: 'red-diff' });
        res.conflicts.slice(0, 40).forEach((c) => list.appendChild(el('li', {}, [
          el('span', { text: c.kind === 'logo' ? 'Logo' : 'Preset' }), sep(), el('span', { text: c.name, 'data-user-text': '' }),
          el('button', { class: 'btn small ghost', type: 'button', text: 'Birincilinkini Kullan', onclick: () => usePrimaryAsset(c) }),
        ])));
        nodes.push(fold('conflicts', 'Çakışan', res.conflicts.length, el('div', {}, [el('div', { class: 'studio-note', text: 'Bu makinede aynı kimlikle farklı içerik var; yerel öğe korundu:' }), list])));
      }
    }
    return group(nodes, 'red-pkg');
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
    return group([
      head('Görüntü birincilden farklı olabilir', {
        pill: pill('warn', String(list.length)),
        help: 'Otomatik seçimin denetimi birincilin görselleştirici penceresi açıkken çalışır; el ile seçilen preset sahne kopyasıyla her zaman denetlenir.',
      }),
      ul,
      el('div', { class: 'br-sub', text: 'Birincilden paket isteyin: eksik presetler ayrı alandan kullanılır, farklı olanlar listede tek tek seçilir.' }),
    ], 'red-parity');
  }

  /* Yerel gösteri arşivleri (#812): rol her kapanışta yerel gösteriyi
     arşivliyor; buradan onayla geri yüklenir. */
  function archiveBox() {
    const el = P().el;
    const list = Array.isArray(status.archives) ? status.archives : [];
    if (!list.length) return null;
    const ul = el('ul', { class: 'red-diff red-archives' });
    list.forEach((a) => ul.appendChild(el('li', {}, [
      el('span', { class: 'st-num', text: new Date(a.at).toLocaleString() }), sep(), num(bytes(a.size)),
      el('button', { class: 'btn small ghost', type: 'button', icon: 'reset', text: tr('Geri Yükle'), onclick: () => restoreArchive(a) }),
    ])));
    return group([
      head('Yerel Gösteri Arşivleri', { help: 'Rol her kapatıldığında yerel gösteri burada arşivlenir. Geri yüklemeden önce şu anki gösteri de arşivlenir; işlem geri alınabilir.' }),
      fold('archives', 'Arşiv', list.length, ul),
    ], 'red-archive');
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

  /* ELLE DEVRALMA ONAYLA (#816). Eskiden izleyen yedeğin en göze çarpan
     (mavi, üzerine gelince parlayan) düğmesiydi ve hiç sormadan yetkiyi
     alıyordu: ne işe yaradığını görmek için tıklayan operatör sağlıklı bir
     birincilin elinden gösteriyi alıyordu. Artık uyarı renginde, ne
     yapacağını söylüyor ve birincil yaşarken ayrıca uyarıyor. */
  async function act(which) {
    if (which === 'takeover') {
      const alive = status.state === 'following';
      const msg = tr('Bu makine gösteriyi yönetmeye başlar: görüntü birincili izlemeyi bırakır ve kararları (sahne, Otomatik VJ, zaman çizelgesi) bu makine verir.') +
        (alive ? '\n\n' + tr('Birincil şu an çalışıyor. Yalnız birincil bozulduysa ya da prova için devralın.') : '');
      if (!(await P().confirm(msg, { okText: tr('Elle Devral') }))) return;
    } else {
      const msg = tr('Yetki birincile geri verilir; bu makine birincili yeniden izler ve birincilden taze bir kopya ister.');
      if (!(await P().confirm(msg, { okText: tr('Yetkiyi Bırak') }))) return;
    }
    try {
      status = which === 'takeover' ? await window.api.redundancyTakeover() : await window.api.redundancyRelease();
    } catch { /* ana süreç yanıt vermedi */ }
    P().rerender();
  }

  function authorityBox(r) {
    const el = P().el;
    const active = status.state === 'active';
    const auto = r.takeover !== 'manual';
    const nodes = [head('Yetki', {
      help: 'Yedek izlerken sahne birincilden gelir; burada yapılan sahne değişikliği birincilin bir sonraki değişikliğiyle ezilir. Yetkiyi alan yedek, birincil geri gelse de "Yetkiyi Bırak" denene kadar yetkide kalır.',
    })];
    nodes.push(el('div', { class: 'br-sub red-auth-note', text: active
      ? 'Bu makine gösteriyi yönetiyor; birincil geri gelse de siz bırakana dek yetkide kalır.'
      : auto ? 'Birincil düşerse bu makine kendiliğinden devralır.' : 'Birincil düşerse bu makine elle devralmanızı bekler.' }));
    const btns = [];
    if (!active) btns.push(el('button', { class: 'btn small warn-btn', type: 'button', icon: 'bolt', text: 'Elle Devral', title: tr('Birincilin yerine bu makine gösteriyi yönetir (onay ister)'), onclick: () => act('takeover') }));
    else btns.push(el('button', { class: 'btn small primary', type: 'button', icon: 'reset', text: 'Yetkiyi Bırak', onclick: () => act('release') }));
    /* El ile bırakıştan sonra otomatik devralma bekler (#812): birincil
       geri gelince ya da operatör yeniden kurunca biter. */
    if (status.autoHeld && !active && r.takeover !== 'manual') {
      btns.push(el('button', { class: 'btn small ghost', type: 'button', icon: 'bolt', text: 'Otomatik Devralmayı Yeniden Kur', onclick: () => rearm() }));
    }
    nodes.push(el('div', { class: 'lay-file' }, btns));
    if (active) nodes.push(handbackBox(r));
    return group(nodes, 'red-auth');
  }

  /* KORUMALI GERİ VERME (#814): koşullar tek tek, tutmayan çarpıyla. Seçilen
     anda (hemen, sonraki sahne, karartma) yetki birincile geçer. */
  function handbackBox(r) {
    const el = P().el;
    const failed = Array.isArray(status.handbackFailed) ? status.handbackFailed : [];
    const nodes = [el('div', { class: 'br-subhead', text: 'Birincile Geri Ver' })];
    const ul = el('ul', { class: 'red-check' });
    for (const k of PRE_ORDER) {
      if (k === 'not-active') continue;
      const bad = failed.indexOf(k) >= 0 || (k === 'show-differs' && failed.indexOf('show-unknown') >= 0);
      ul.appendChild(el('li', { class: bad ? 'bad' : 'good' }, [el('span', { icon: bad ? 'x' : 'check', 'aria-hidden': 'true' }), el('span', { text: PRE_TEXT[k] })]));
    }
    nodes.push(ul);
    nodes.push(selectRow('Geçiş Anı', [['scene', 'Sonraki sahne değişiminde'], ['black', 'Karartmada'], ['now', 'Hemen']], r.handbackAt || 'scene', (v) => { r.handbackAt = v; P().push(true); }));
    if (status.handback) {
      nodes.push(el('div', { class: 'br-warn', text: 'Geri verme kuruldu: seçilen anda yetki birincile geçecek.' }));
      nodes.push(el('div', { class: 'lay-file' }, [el('button', { class: 'btn small ghost', type: 'button', icon: 'x', text: 'Geri Vermeyi İptal Et', onclick: () => handback('cancel') })]));
    } else {
      nodes.push(el('div', { class: 'lay-file' }, [el('button', {
        class: 'btn small primary', type: 'button', icon: 'reset', text: 'Birincile Geri Ver',
        disabled: failed.filter((f) => f !== 'not-active').length ? 'disabled' : null, onclick: () => handback(r.handbackAt || 'scene'),
      })]));
    }
    return el('div', { class: 'red-handback' }, nodes);
  }
  async function handback(at) {
    if (!window.api.redundancyHandback) return;
    let res = null;
    try { res = await window.api.redundancyHandback(at); } catch { /* */ }
    if (res && res.ok && !res.canceled) P().toast(tr('Geri verme kuruldu.'), 'ok');
    else if (res && res.failed) P().toast(tr('Geri verilemez:') + ' ' + res.failed.map((f) => tr(PRE_TEXT[f] || f)).join(', '), 'warn');
    try { status = await window.api.redundancyStatus(); } catch { /* */ }
    P().rerender();
  }

  /* ÇIKIŞ KAPILARI (#814): her ışık/OSC çıkışı "yalnız yetkiyle" (varsayılan)
     ya da "her zaman". Durum: şu an gönderiyor mu. */
  function gatesBox(r) {
    const el = P().el;
    const push = () => P().push(true);
    if (!r.outputs || typeof r.outputs !== 'object') r.outputs = {};
    const gates = status.gates || {};
    const nodes = [head('Çıkış Yetkisi', {
      help: 'Art-Net, OSC çıkışı, OpenRGB ve Dynamic Lighting varsayılan olarak yalnız yetkideki makineden gider: iki makine aynı ışığı sürmez. "Her zaman" seçilen çıkış iki makinede de çalışır. Görüntü, Spout/Syphon ve yayın sayfası her zaman çalışır; seyirciye hangisinin gideceğini görüntü anahtarlayıcısı seçer.',
    })];
    for (const k of ['artnet', 'oscOut', 'openrgb', 'lighting']) {
      const sel = el('select', { class: 'sel-ctrl' });
      [['authority', 'Yalnız yetkiyle'], ['always', 'Her zaman']].forEach(([v, t]) => { const o = el('option', { value: v, text: t }); if ((r.outputs[k] || 'authority') === v) o.selected = true; sel.appendChild(o); });
      sel.addEventListener('change', () => { r.outputs[k] = sel.value; push(); });
      const open = gates[k] !== false;
      nodes.push(P().row(OUTPUT_TEXT[k], el('div', { class: 'red-gate' }, [
        el('span', { class: 'br-pill ' + (open ? 'ok' : 'off') }, [el('span', { class: 'br-dot' }), el('span', { text: open ? 'açık' : 'yetki yok' })]),
        sel,
      ])));
    }
    if (P().advanced ? P().advanced() : true) {
      nodes.push(selectRow('Yetki Gidince Art-Net', [['hold', 'Son kareyi tut'], ['zero', 'Bir kez karart']], r.artnetOnLoss === 'zero' ? 'zero' : 'hold', (v) => { r.artnetOnLoss = v; push(); }));
      const w = status.witness;
      nodes.push(el('label', { class: 'chk' }, [
        (function () { const c = el('input', { type: 'checkbox' }); c.checked = r.artnetWitness !== false; c.addEventListener('change', () => { r.artnetWitness = c.checked; push(); }); return c; })(),
        el('span', { text: 'Art-Net tanığı: aynı evrene başka bir kaynak gönderiyorsa uyar' }),
      ]));
      if (w && w.error) nodes.push(el('div', { class: 'br-sub', text: 'Art-Net tanığı açılamadı: 6454 başka bir uygulamada.' }));
    }
    return group(nodes, 'red-gates');
  }

  /* ÖTEKİ MAKİNE (#814): durumu, yetkisi, kare hızı, ses seviyesi, ses
     girişi ve çıkış kapıları; panel açıkken saniyede iki küçük önizleme.
     Komutlar yetkideki makinede uygulanır. */
  let monFrame = null;
  function peerBox() {
    const el = P().el;
    const pi = status.peerInfo;
    if (!pi || Date.now() - (pi.at || 0) > 5000) return null;
    const nodes = [head(status.role === 'primary' ? 'Yedek Makine' : 'Birincil Makine', { pill: pi.split ? pill('err', 'İki yönetici') : null })];
    const img = el('img', { class: 'red-mon', alt: tr('Öteki makinenin önizlemesi'), src: monFrame ? monFrame.src : '' });
    if (!monFrame) img.hidden = true;
    nodes.push(el('div', { class: 'red-peer' }, [
      el('div', { class: 'red-mon-box' }, [img, monFrame ? null : el('div', { class: 'br-sub', text: 'Önizleme: öteki makinede görselleştirici penceresi açık olmalı.' })].filter(Boolean)),
      grid(peerSpecs(pi).map(([k, label, v, o]) => tile(k, label, v, o))),
    ]));
    const cmd = (action, label, icon) => el('button', { class: 'btn small', type: 'button', icon, text: label, onclick: () => ctl(action) });
    nodes.push(el('div', { class: 'lay-file' }, [
      cmd('nextScene', 'Sonraki Sahne', 'skip'), cmd('blackout', 'Karart', 'moon'), cmd('nextVisualizer', 'Sonraki Görselleştirici', 'next'),
      cmd('tlPlay', 'Çizelge Oynat', 'play'), cmd('tlPause', 'Çizelge Duraklat', 'pause'),
    ]));
    nodes.push(el('div', { class: 'br-sub', text: 'Komut yetkideki makinede uygulanır: yetki buradaysa burada, değilse öteki makineye gönderilir.' }));
    return group(nodes, 'red-peerbox');
  }
  // Öteki makinenin kutucukları: ilk çizim ve canlı güncelleme aynı yerden
  function peerSpecs(pi) {
    const gatesOn = pi.gates ? Object.keys(pi.gates).filter((k) => pi.gates[k]).length : 0;
    return [
      // Öteki makinenin gözünden "bu makinede" burada yanıltırdı: yetkide mi değil mi
      ['p-auth', 'Yetki', tr(pi.holder === 'self' ? 'Yetkide' : pi.holder === 'unknown' ? 'Bekleniyor' : 'Yetkide değil'), { note: tr('dönem') + ' ' + pi.term, tone: pi.split ? 'err' : pi.holder === 'self' ? 'ok' : '' }],
      ['p-state', 'Durum', pi.state ? tr(PEER_STATE_TEXT[pi.state] || pi.state) : tr(pi.role === 'primary' ? 'Birincil' : 'Yedek'), {}],
      ['p-fps', 'Kare hızı', pi.fps ? pi.fps + ' fps' : '—', { tone: pi.fps ? '' : 'dim' }],
      ['p-lvl', 'Ses seviyesi', Math.round((pi.level || 0) * 100) + '%', {}],
      ['p-gate', 'Açık çıkış', gatesOn + ' / 4', { tone: gatesOn ? 'ok' : '' }],
    ];
  }
  async function ctl(action, args) {
    if (!window.api.redundancyCtl) return;
    let r = null;
    try { r = await window.api.redundancyCtl({ action, args: args || {} }); } catch { /* */ }
    if (r && r.local) { runCtl({ action, args }); P().toast(tr('Bu makinede uygulandı.'), 'ok'); return; }
    if (r && r.ok) { P().toast(tr('Öteki makinede uygulandı.'), 'ok'); return; }
    const why = r && r.error === 'timeout' ? 'Öteki makine yanıt vermedi.' : r && r.error === 'not-authority' ? 'Yetki öteki makinede değil; komut uygulanmadı.' : 'Komut gönderilemedi.';
    P().toast(tr(why), 'warn');
  }
  // Öteki makineden ya da buradan gelen gösteri komutu: panelin kendi eylemi
  function runCtl(d) {
    if (!d || typeof d.action !== 'string') return;
    if (d.action === 'sceneGo') { if (d.args && d.args.id && P().applyScene) P().applyScene(String(d.args.id)); return; }
    const C = window.SVControl;
    if (!C || !C.runAction) return;
    const cfg = P().cfg();
    const done = C.runAction(d.action, cfg);
    if (!done && d.action !== 'blackout') P().apply();
  }

  function connectionBox(r, role) {
    const el = P().el;
    const push = () => P().push(true);
    const nodes = [head('Bağlantı', {
      help: role === 'backup'
        ? 'Yedek, birincilin yayın sunucusuna bağlanır. Parola iki makinede aynı olmalı. Atış aralığı ve kayıp eşiği Gelişmiş görünümde; eşik en az üç atış. Yedek adres: OBS sayfası bu makineye ulaşamazsa öbür makinenin yayın sayfasına geçer; iki makineye de birbirinin adresini (jetonuyla) yazın.'
        : 'Yedek bu bilgisayarın yayın sunucusuna bağlanır. Yedek başka bir bilgisayardaysa Çıkış → Yayın Çıkışı\'nda ağa açmayı etkinleştirin; yedeğe bu bilgisayarın adresini ve yayın portunu yazın. Yedek adres: OBS sayfası bu makineye ulaşamazsa öbür makinenin yayın sayfasına geçer; iki makineye de birbirinin adresini (jetonuyla) yazın.',
    })];
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
      nodes.push(selectRow('Devralma', [['auto', 'Kendiliğinden'], ['manual', 'Elle']], r.takeover === 'manual' ? 'manual' : 'auto',
        (v) => { r.takeover = v; push(); }));
      const adv = P().advanced ? P().advanced() : true;
      if (adv) {
        nodes.push(numRow('Kalp Atışı (ms)', r.heartbeatMs || 250, 50, 5000, 10, (v) => { r.heartbeatMs = v; push(); }));
        nodes.push(numRow('Kayıp Eşiği (ms)', r.timeoutMs || 1500, 150, 60000, 50, (v) => { r.timeoutMs = v; push(); }));
      }
      nodes.push(checkRow('İzlerken Birincilin Vuruşunu Kullan', r.phaseLock !== false, (v) => { r.phaseLock = v; push(); }));
    }
    /* Yayın sayfasının yedek adresleri (#815): OBS/tarayıcı kaynağı bu
       makineye ulaşamazsa sırayla bunlara geçer. Ayar yayın çıkışında
       saklanır (kurulum ayarı, aktarılmaz). */
    const cfgAll = P().cfg();
    if (!cfgAll.stream || typeof cfgAll.stream !== 'object') cfgAll.stream = {};
    const fb = el('textarea', { class: 'p-in wide red-fallback', rows: '2', spellcheck: 'false', placeholder: 'http://192.168.1.21:8722/overlay?token=…', 'data-user-attr': '' });
    fb.value = cfgAll.stream.fallbackUrls || '';
    fb.addEventListener('change', () => { cfgAll.stream.fallbackUrls = fb.value.trim(); push(); });
    nodes.push(P().row('Yayın Sayfasının Yedek Adresleri', fb));
    return group(nodes, 'red-conn');
  }

  function panel() {
    const el = P().el;
    const r = red();
    const role = r.role || 'off';
    const nodes = [];
    nodes.push(selectRow('Bu Makinenin Rolü', [['off', 'Kapalı'], ['primary', 'Birincil'], ['backup', 'Yedek']], role,
      (v) => { r.role = v; P().push(true); P().rerender(); }));
    if (role === 'off') {
      nodes.push(el('div', { class: 'red-intro' }, [
        el('span', { class: 'br-sub', text: 'İki makineyle sıcak yedek: yedek aynı sahneyi sürekli çizer, birincil düşerse yetkiyi alır. Ekran kararmaz; hangi çıkışın seyirciye gittiğini görüntü anahtarlayıcısı seçer.' }),
      ]));
      const ab0 = archiveBox();
      if (ab0) nodes.push(ab0);
      return el('div', { class: 'redundancy-panel' }, nodes);
    }
    ensureLive();
    nodes.push(statusBlock());
    if (!status.problem) { const pb0 = peerBox(); if (pb0) nodes.push(pb0); }
    if (role === 'backup') {
      if (!status.problem) nodes.push(authorityBox(r));
      if (!status.problem) nodes.push(gatesBox(r));
      nodes.push(connectionBox(r, 'backup'));
      if (!status.problem) {
        const pb = parityBox();
        if (pb) nodes.push(pb);
        nodes.push(spaceBox());
        nodes.push(packageBox());
      }
    } else {
      if (!status.problem) nodes.push(gatesBox(r));
      nodes.push(connectionBox(r, 'primary'));
      if (status.peers) nodes.push(showBox());
    }
    const ab = archiveBox();
    if (ab) nodes.push(ab);
    return el('div', { class: 'redundancy-panel' }, nodes);
  }

  /* DURUM BANDI ve ALARM (#815). Rol açıkken her sekmenin üstünde: rol ve
     durum, yetki ve dönem, son atış, saat farkı, titreme, ses girişi. Renk:
     yeşil izliyor / yedek bağlı, sarı kayıp / bekliyor / çitli, kırmızı
     yetkide yedek ya da iki yönetici. Devralma, iki yönetici ve birincilin
     geri çekilmesi alarm: bant yanıp söner, "Tamam" susturur; ayar açıksa
     kısa bir ses (varsayılan kapalı: canlı mekânda karışıma sızmasın). */
  let alarm = null;
  let prevBanner = null;
  function beep() {
    try {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return;
      const ac = new AC();
      [0, 0.28].forEach((d) => {
        const o = ac.createOscillator();
        const g = ac.createGain();
        o.frequency.value = 880;
        g.gain.setValueAtTime(0.0001, ac.currentTime + d);
        g.gain.exponentialRampToValueAtTime(0.25, ac.currentTime + d + 0.02);
        g.gain.exponentialRampToValueAtTime(0.0001, ac.currentTime + d + 0.22);
        o.connect(g).connect(ac.destination);
        o.start(ac.currentTime + d);
        o.stop(ac.currentTime + d + 0.25);
      });
      setTimeout(() => { try { ac.close(); } catch { /* */ } }, 900);
    } catch { /* ses yok */ }
  }
  const ALARM_TEXT = { takeover: 'Yedek yetkiyi aldı', split: 'İki yönetici: iki makine de yetkide', stepped: 'Yetki yedekte' };
  function noteAlarm(s, p) {
    if (!p || s.role !== p.role) return;
    let kind = '';
    if (s.split && !p.split) kind = 'split';
    else if (s.role === 'backup' && s.state === 'active' && p.state !== 'active') kind = 'takeover';
    else if (s.role === 'primary' && s.holder === 'peer' && p.holder !== 'peer') kind = 'stepped';
    if (!kind) return;
    alarm = { kind, at: Date.now() };
    if (red().alarmSound === true) beep();
  }
  function bannerTone(s) {
    if (s.split) return 'err';
    if (s.role === 'backup') return s.state === 'active' ? 'err' : s.state === 'following' && !s.autoHeld ? 'ok' : 'warn';
    if (s.role === 'primary') return !s.serverRunning || s.fenced || s.holder === 'peer' ? 'warn' : s.peers ? 'ok' : 'warn';
    return 'off';
  }
  function updateBanner(s) {
    if (typeof document === 'undefined' || !document.getElementById) return;
    const b = document.getElementById('redBanner');
    if (!b) return;
    noteAlarm(s, prevBanner);
    prevBanner = { role: s.role, state: s.state, holder: s.holder, split: s.split };
    if (!s || s.role === 'off' || !s.role) { b.classList.add('hidden'); alarm = null; return; }
    const el = P().el;
    const tone = bannerTone(s);
    b.className = 'red-banner ' + tone + (alarm ? ' alarm' : '');
    b.textContent = '';
    const role = tr(s.role === 'primary' ? 'Birincil' : 'Yedek');
    b.appendChild(el('span', { class: 'rb-main' }, [el('span', { class: 'rb-dot' }), el('span', { text: role + ' · ' + tr(alarm ? ALARM_TEXT[alarm.kind] : stateText(s)) })]));
    const stat = (k, v) => el('span', { class: 'rb-stat' }, [el('span', { text: tr(k) + ' ' }), el('b', { text: String(v) })]);
    b.appendChild(stat('Yetki', tr(HOLDER_TEXT[s.holder] || '—') + ' · ' + (s.term || 0)));
    if (s.role === 'backup' && !s.problem) {
      const since = s.lastBeat ? Date.now() - s.lastBeat : null;
      b.appendChild(stat('Son atış', since == null ? '—' : Math.round(since) + ' ms'));
      b.appendChild(stat('Saat farkı', s.offsetMs == null ? '—' : Math.round(s.offsetMs) + ' ms'));
      b.appendChild(stat('Titreme', s.jitterMs == null ? '—' : s.jitterMs + ' ms'));
    } else if (s.role === 'primary') {
      b.appendChild(stat('Yedek', tr(s.peers ? 'Bağlı' : 'Yok')));
      if (s.peerBeat) b.appendChild(stat('Son atış', Math.round(s.peerBeat.ageMs) + ' ms'));
    }
    const pi = s.peerInfo;
    if (pi && pi.bridge) b.appendChild(stat('Ses', pi.bridge));
    const acts = el('span', { class: 'rb-acts' });
    if (alarm) acts.appendChild(el('button', { class: 'btn small', type: 'button', text: 'Tamam', onclick: () => { alarm = null; updateBanner(status); } }));
    acts.appendChild(el('button', { class: 'btn small ghost', type: 'button', text: 'Yedekliliği Aç', onclick: () => { if (P().jumpTo) P().jumpTo({ category: 'show', section: 'redundancy' }); } }));
    b.appendChild(acts);
  }

  async function init() {
    if (started || !window.api || !window.api.redundancyStatus) return;
    started = true;
    window.api.onRedundancyStatus((s) => {
      const sig = (x) => JSON.stringify([x.role, x.state, x.autoHeld, x.peers, x.peerState, x.problem, x.serverRunning, x.show && x.show.hash, x.show && x.show.peerHash, x.show && x.show.differences,
        // Yalıtılmış gösteri ve paket (#812); ilerleme en çok saniyede dört kez gelir
        x.space, x.pkg, x.pkgResult, x.parity, x.pkgMedia, x.archives,
        // Yetki (#814): kimde, çit, iki yönetici, kapılar, geri verme, öteki makine var mı
        x.holder, x.fenced, x.split, x.gates, x.handback, x.handbackFailed, !!x.peerInfo]);
      const prev = sig(status);
      status = s || { role: 'off' };
      window.SVRedundancyState = status;
      updateBanner(status);
      const next = sig(status);
      /* Yazarken imleç kaybolmasın: ilerleme güncellemesi odak bir alandayken
         beklenir (#812, aynı kural gösteri öncesi denetimde). */
      const ae = document.activeElement;
      const typing = ae && (ae.tagName === 'INPUT' || ae.tagName === 'SELECT' || ae.tagName === 'TEXTAREA') && ae.type !== 'checkbox';
      if (prev !== next && document.querySelector('.redundancy-panel') && !typing) P().rerender();
      else updateTiles(status);
    });
    // Birincilin tempo ızgarası (#815): izleyen yedeğin tempo motoru onu kullanır
    if (window.api.onRedundancyTempo) window.api.onRedundancyTempo((g) => { if (window.SVAutoVJ && window.SVAutoVJ.followGrid) window.SVAutoVJ.followGrid(g); });
    // Öteki makineden gelen gösteri komutu ve önizleme karesi (#814)
    if (window.api.onRedundancyCtl) window.api.onRedundancyCtl((d) => runCtl(d));
    if (window.api.onRedundancyMonitor) {
      window.api.onRedundancyMonitor((f) => {
        const had = !!monFrame;
        monFrame = f && f.src ? f : null;
        const img = document.querySelector('.redundancy-panel .red-mon');
        if (img && monFrame) { img.src = monFrame.src; img.hidden = false; }
        if (!had && monFrame && !img && document.querySelector('.red-peerbox')) P().rerender();
      });
    }
    // Birincilin taşıması (#544): zaman çizelgesi paneli onu izler
    if (window.api.onShowClockFollow) {
      window.api.onShowClockFollow((a) => { if (window.SVTimelinePanel && window.SVTimelinePanel.followAnchor) window.SVTimelinePanel.followAnchor(a); });
    }
    try { status = await window.api.redundancyStatus(); window.SVRedundancyState = status; updateBanner(status); } catch { /* */ }
  }

  // Otomatik VJ gibi kendi karar veren işler: yedek birincili izlerken durur
  function following() {
    const s = window.SVRedundancyState;
    return !!(s && s.role === 'backup' && (s.state === 'following' || s.state === 'lost' || s.state === 'connecting') && !s.problem);
  }

  /* Birincil geri çekildi (#814): yetki yedekte. Otomatik VJ ve zaman
     çizelgesi karar vermez. */
  function steppedBack() {
    const s = window.SVRedundancyState;
    return !!(s && s.role === 'primary' && s.holder === 'peer');
  }

  window.SVRedundancyPanel = { panel, init, following, steppedBack, _tileSpecs: tileSpecs, _bannerTone: bannerTone, _noteAlarm: (s, p) => { noteAlarm(s, p); const a = alarm; alarm = null; return a; } };
})();
