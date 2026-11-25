/*
 * SoundVisualizer — CaYaDev Ses Görselleştirici
 * Copyright (c) 2026 Çağan Turgut (CaYatur) — CaYaDev, https://cayadev.com
 * https://github.com/CaYatur/SoundVisualizer
 * SPDX-License-Identifier: MIT
 */
'use strict';
/* CANLI SEKMESİ (PC bağlantısı B2; PLAN §4.3, taslak 16–17). Yalnız hedef PC iken görünür.

   Önizleme ve program, T-bar ve "Geç", karartma, dokunarak tempo, anlık efektler (basılı tut),
   klip destesi, makrolar, çıkış opaklığı, Otomatik VJ, MilkDrop gezintisi, zaman çizelgesi
   taşıması ve gösteri kilidi. Her düğme PC'ye MUTLAK bir işlem yollar (docs/PHONE-LINK.md
   "Operations"); ekrandaki durum PC'nin canlı özetinden (`live`, `meter` olayları) gelir, düğme
   kendi tahminini göstermez. Ayar (sahne adları, deste, makro adları) PC'nin ayar aynasından. */
(function () {
  if (typeof window === 'undefined' || !window.SVShell || !window.SVShellUI) return;
  const S = window.SVShell;
  const U = window.SVShellUI;
  const { h, icon, A } = S;
  const tr = (s) => (window.SVI18n && window.SVI18n.t ? window.SVI18n.t(s) : s);

  const MOMENTARY = [['flash', 'Flaş'], ['strobe', 'Strobe'], ['blur', 'Bulanık'], ['kaleido', 'Kaleydoskop'], ['glitch', 'Glitch'], ['negative', 'Negatif']];
  const TAP_KEY = 'sv-live-tap';
  const ask = (op, args) => (A() && A().pc ? A().pc.request(op, args) : Promise.resolve({ ok: false }));
  const cfg = () => (A() && A().config.get()) || {};
  const live = () => (A() && A().pc && A().pc.live()) || {};
  const meter = () => (A() && A().pc && A().pc.meter()) || {};
  const scenes = () => (Array.isArray(cfg().scenes) ? cfg().scenes : []);
  const sceneById = (id) => scenes().find((s) => s && s.id === id) || null;

  let refs = null; // ekrandaki canlı öğeler (yeniden çizmeden boyanır)
  /* Kaydırıcı sürüklenirken saniyede en çok ~20 istek; son değer her zaman gider. */
  function throttled(fn) {
    let last = 0;
    let timer = 0;
    let pending = null;
    return (v) => {
      pending = v;
      const t = performance.now();
      if (t - last >= 50) { last = t; fn(pending); pending = null; return; }
      if (!timer) timer = setTimeout(() => { timer = 0; last = performance.now(); if (pending != null) { fn(pending); pending = null; } }, 55);
    };
  }

  /* ---- Anlık efektler: KİRA. Basış ve bırakış uygulamaya gider (SVAndroid.pc.hold); kirayı
     uygulama yarım saniyede bir yeniler, sayfanın iş parçacığı meşgul olsa da. Basılıyken sayfa
     saniyede bir "hâlâ basılı" der; 4 sn demezse uygulama bırakır. PC de 1,5 sn yenilenmeyen
     listeyi kendisi bırakır (bırakma iletisi kaybolsa da efekt takılı kalmaz). */
  const held = new Set();
  let heldTimer = 0;
  function sendHeld() {
    const pc = A() && A().pc;
    const list = Array.from(held);
    if (pc && pc.hold) pc.hold(list).catch(() => ask('momentary', { list }));
    else ask('momentary', { list });
    if (held.size && !heldTimer) heldTimer = setInterval(() => { const p = A() && A().pc; if (p && p.hold) p.hold(Array.from(held)); else ask('momentary', { list: Array.from(held) }); }, 1000);
    if (!held.size && heldTimer) { clearInterval(heldTimer); heldTimer = 0; }
  }
  function releaseAll() { if (!held.size) return; held.clear(); sendHeld(); paintLive(); }
  window.addEventListener('blur', releaseAll);
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') releaseAll(); });

  /* ---- Dokunarak tempo: vuruş aralıkları TELEFONDA ölçülür (ağ gecikmesi ölçümü bozmasın);
     PC'ye yalnız sonuç gider. İki saniye ara verince yeni ölçüm başlar. */
  const taps = [];
  function tap() {
    const t = performance.now();
    if (taps.length && t - taps[taps.length - 1] > 2000) taps.length = 0;
    taps.push(t);
    if (taps.length > 9) taps.shift();
    if (taps.length < 3) return 0;
    const span = (taps[taps.length - 1] - taps[0]) / (taps.length - 1);
    const bpm = Math.round(60000 / span);
    if (bpm >= 30 && bpm <= 200) ask('tempo.set', { bpm });
    return bpm;
  }

  /* ---- T-bar: çubuk PC'deki gibi bir uçta durur (rest); öbür uca gidince sıradaki sahne canlı
     olur ve çubuk orada kalır. Konum mutlak yollanır, saniyede en çok ~25 kez. */
  /* Sürükleme (T-bar ve makrolar): DOKUNMA DEĞER ATLATMAZ, tutulan yerden göreli kayar; dikey
     kaydırma sayfayı kaydırır (önce hangi yöne gidildiğine bakılır). Her denetim kendi sürükleme
     durumunu tutar: eskiden tek ortak bayrak bir makroda bırakma olayı kaçınca açık kalıyor, T-bar
     PC'nin konumunu hiç çizmiyor ve sayfa yenilenmiyordu (telefon denemesi 25.11). */
  const drags = new Set();
  function relDrag(el, o) {
    let st = null;
    const finish = (e, commit) => {
      if (!st) return;
      const s = st;
      st = null;
      drags.delete(el);
      try { el.releasePointerCapture(s.id); } catch (err) { /* */ }
      if (s.active && commit) o.end(s.v);
      else if (s.active) o.end(null);
    };
    el.addEventListener('pointerdown', (e) => {
      if (st) return;
      const r = el.getBoundingClientRect();
      st = { id: e.pointerId, x: e.clientX, y: e.clientY, left: r.left, right: r.right, v0: o.get(), v: o.get(), active: false };
      drags.add(el);
      try { el.setPointerCapture(e.pointerId); } catch (err) { /* */ }
    });
    el.addEventListener('pointermove', (e) => {
      if (!st || e.pointerId !== st.id) return;
      const dx = e.clientX - st.x;
      const dy = e.clientY - st.y;
      if (!st.active) {
        // Önce dikey giderse bu bir kaydırma: denetim bırakılır
        if (Math.abs(dy) > 10 && Math.abs(dy) > Math.abs(dx)) { finish(e, false); return; }
        if (Math.abs(dx) < 6) return;
        st.active = true;
        st.x = e.clientX; // eşik atlamasın: kayma buradan başlar
      }
      e.preventDefault();
      /* Parmak çubuğun hangi ucuna giderse çubuk da o uca varır: ortadan tutulsa da kenara
         gelince uç (eskiden göreli kayma uca varamıyordu, PC karışımda kalıyor, sahne geçmiyordu). */
      const x = e.clientX;
      let v = x >= st.x
        ? st.v0 + (1 - st.v0) * Math.min(1, (x - st.x) / Math.max(1, st.right - st.x))
        : st.v0 - st.v0 * Math.min(1, (st.x - x) / Math.max(1, st.x - st.left));
      if (v > 0.985) v = 1; // uçta tam uç (PC'nin "bitti" eşiği 0,995)
      else if (v < 0.015) v = 0;
      st.v = Math.max(0, Math.min(1, v));
      o.move(st.v);
    });
    el.addEventListener('pointerup', (e) => finish(e, true));
    el.addEventListener('pointercancel', (e) => finish(e, false));
    el.addEventListener('lostpointercapture', (e) => finish(e, true));
  }

  /* T-bar: konum mutlak, parmak basılıyken down:true. PC çubuğu her örnekte izler,
     bırakınca (down:false) ucu bitirir. Saniyede en çok ~25 kez; son konum hemen.
     Bırakınca PC'nin özeti yetişene dek (en çok 0,6 sn) ekranda son konum kalır. */
  let tbarTimer = 0;
  let tbarLast = 0;
  let tbarNext = null;
  let tbarUp = false;
  function sendTbar(v, now, up) {
    tbarNext = v;
    if (up) tbarUp = true;
    const t = performance.now();
    if (!now && t - tbarLast < 40) {
      if (!tbarTimer) tbarTimer = setTimeout(() => { tbarTimer = 0; if (tbarNext != null) sendTbar(tbarNext, true, false); }, 45);
      return;
    }
    clearTimeout(tbarTimer);
    tbarTimer = 0;
    tbarLast = t;
    const x = tbarNext;
    const release = tbarUp;
    tbarNext = null;
    tbarUp = false;
    return ask('tbar', { v: x, down: !release });
  }
  function tbarRead() {
    const tb = live().tbar;
    if (!tb) return { v: 0, p: 0, rest: 0, live: false };
    const rest = tb.rest === 1 ? 1 : 0;
    const v = typeof tb.v === 'number' ? tb.v : (tb.live ? (rest === 0 ? tb.p : 1 - tb.p) : rest);
    return { v, p: tb.live ? (Number(tb.p) || 0) : 0, rest, live: !!tb.live };
  }
  /* Parmak kalkınca PC ilerlemeyi sıfırlıyor (çubuk yeni uçta kalır). Telefon aynı
     resmi tutsun: dolgu karışımdır, tutamak konumdur. */
  let tbarHold = null; // { v, p, until }
  let tbarGesture = null; // { rest }
  let mixView = null; // { fromId, toId, p }
  function engineTbar(m) {
    const pc = A() && A().pc;
    if (pc && pc.tbarLocal) pc.tbarLocal(m);
  }
  function mixProgress(rest, v) { return rest === 0 ? v : 1 - v; }
  function tbarEl() {
    const fill = h('i', { class: 'tb-fill' });
    const grip = h('b', { class: 'tb-grip' });
    const pct = h('small', { class: 'tb-pct' });
    const bar = h('div', { class: 'tbar', role: 'slider', 'aria-label': 'T-bar', 'aria-valuemin': '0', 'aria-valuemax': '100', tabindex: '0' }, [fill, grip, pct]);
    let shown = 0;
    const show = (v, p, rest) => {
      shown = Math.max(0, Math.min(1, Number(v) || 0));
      const mix = Math.max(0, Math.min(1, Number(p) || 0));
      const origin = rest === 1 ? 1 : rest === 0 ? 0 : (tbarGesture ? tbarGesture.rest : tbarRead().rest);
      const gp = Math.round(shown * 1000) / 10;
      const fp = Math.round(mix * 1000) / 10;
      /* Dolgu çubuğun başladığı uçtan akar: solda bekliyorsa soldan, sağda bekliyorsa sağdan. */
      bar.classList.toggle('from-right', origin === 1);
      fill.style.width = fp + '%';
      grip.style.left = gp + '%';
      pct.textContent = mix > 0.005 ? Math.round(mix * 100) + '%' : '';
      bar.setAttribute('aria-valuenow', String(Math.round(fp)));
      if (mixView) mixView.p = mix;
      paintMixFrame();
    };
    relDrag(bar, {
      get: () => shown,
      move: (v) => {
        tbarHold = null;
        if (!tbarGesture) {
          const now = tbarRead();
          tbarGesture = { rest: now.rest };
          const l = live();
          mixView = { fromId: l.active || '', toId: l.cue || '', p: 0 };
          engineTbar({ phase: 'arm' });
        }
        const p = mixProgress(tbarGesture.rest, v);
        if (mixView && !mixView.toId) {
          const l = live();
          if (l.cue) mixView.toId = l.cue;
          else if (l.active && l.active !== mixView.fromId) mixView.toId = l.active;
        }
        show(v, p, tbarGesture.rest);
        engineTbar({ phase: 'move', p });
        sendTbar(v);
      },
      end: (v) => {
        if (v == null) { tbarGesture = null; mixView = null; return; }
        const rest = tbarGesture ? tbarGesture.rest : tbarRead().rest;
        tbarGesture = null;
        const p = mixProgress(rest, v);
        const atEnd = p >= 0.995;
        const atStart = p <= 0.005;
        const parked = atEnd ? (rest === 0 ? 1 : 0) : rest;
        if (atEnd) {
          engineTbar({ phase: 'end' });
          mixView = null;
          show(parked, 0, parked);
        } else if (atStart) {
          engineTbar({ phase: 'cancel' });
          mixView = null;
          show(rest, 0, rest);
        } else {
          engineTbar({ phase: 'move', p });
          if (mixView) mixView.p = p;
          show(v, p, rest);
        }
        const sent = sendTbar(v, true, true);
        tbarHold = { v: shown, p: atEnd || atStart ? 0 : p, rest: parked, until: performance.now() + 600 };
        if (sent && sent.then) sent.then((r) => {
          const tb = r && r.result && r.result.tbar;
          if (!tb || typeof tb.v !== 'number') return;
          const mix = tb.live ? (Number(tb.p) || 0) : 0;
          const origin = tb.rest === 1 ? 1 : 0;
          if (!tb.live) mixView = null;
          tbarHold = { v: tb.v, p: mix, rest: origin, until: performance.now() + 600 };
          show(tb.v, mix, origin);
        });
      },
    });
    const pcPos = () => {
      const s = tbarRead();
      if (tbarHold) {
        const done = !s.live && tbarHold.p === 0;
        if (done || (Math.abs(s.v - tbarHold.v) < 0.02 && Math.abs(s.p - tbarHold.p) < 0.02) || performance.now() > tbarHold.until) tbarHold = null;
        else return tbarHold;
      }
      if (!s.live) mixView = null;
      return s;
    };
    const first = pcPos();
    show(first.v, first.p, first.rest);
    bar.paint = () => { if (!drags.has(bar)) { const s = pcPos(); show(s.v, s.p, s.rest); } };
    return bar;
  }

  function sceneTile(sc, role) {
    const cap = h('figcaption', { text: (role === 'pgm' ? tr('PROGRAM') : tr('ÖNİZLEME')) + ' · ' + (sc ? sc.name || '' : '—') });
    return h('figure', { class: 'lv-mon ' + role }, [sc ? S.sceneArt(sc) : h('div', { class: 'art' }), cap]);
  }

  // Sahne ızgarasında dokununca: sıraya al (T-bar / Geç) ya da hemen geç
  function tapMode() { try { return localStorage.getItem(TAP_KEY) === 'cut' ? 'cut' : 'cue'; } catch (e) { return 'cue'; } }

  function deckOf(c) {
    const d = c.clipdeck || {};
    const list = Array.isArray(d.decks) ? d.decks : [];
    return list.find((x) => x && x.id === d.activeDeck) || list[0] || null;
  }
  function slotLabel(sl) {
    if (!sl) return '';
    if (sl.name) return sl.name;
    if (sl.type === 'scene') { const sc = sceneById(sl.ref); if (sc) return sc.name || ''; }
    return sl.ref ? String(sl.ref) : '';
  }

  function render(body, ctx) {
    const c = cfg();
    const st = A().target ? A().target.get() : {};
    refs = { cells: [], fx: [], scenes: [] };
    if (st.standby) body.appendChild(h('div', { class: 'banner info' }, [icon('info'), h('div', { text: 'Bu PC yedek rolünde: yalnız izlenir, denetim birincil kopyada.' })]));

    // Önizleme ve program
    const l = live();
    const mons = h('div', { class: 'lv-mons' }, [sceneTile(sceneById(l.cue), 'pvw'), sceneTile(sceneById(l.active), 'pgm')]);
    refs.mons = mons;
    body.appendChild(mons);

    // T-bar, Geç
    const bar = tbarEl();
    refs.tbar = bar;
    body.appendChild(h('div', { class: 'lv-row' }, [bar, h('button', { class: 'btn primary lv-take', onclick: () => ask('tbar', { take: true }) }, [icon('play'), h('span', { text: 'Geç' })])]));

    // Karartma ve tempo
    const blk = h('button', { class: 'blk', 'aria-pressed': l.blackout ? 'true' : 'false', onclick: () => ask('blackout', { on: !live().blackout }) }, [h('span', { text: 'Karartma' })]);
    const tapLabel = h('span', { class: 'mono' });
    const tapBtn = h('button', { class: 'blk', onclick: () => { const b = tap(); if (b) tapLabel.textContent = String(b); } }, [icon('hand'), h('span', { text: 'Dokun' }), tapLabel]);
    const autoBpm = h('button', { class: 'btn lv-auto', 'aria-label': 'Tempoyu müzikten bul', title: 'Tempoyu müzikten bul', onclick: () => { taps.length = 0; ask('tempo.set', { bpm: 0 }); } }, [icon('reset')]);
    refs.blk = blk;
    refs.tapLabel = tapLabel;
    body.appendChild(h('div', { class: 'lv-row' }, [blk, tapBtn, autoBpm]));

    // Sahneler
    const mode = tapMode();
    body.appendChild(U.seg({
      label: 'Sahneye dokununca', value: mode, options: [['cue', 'Sıraya al'], ['cut', 'Hemen geç']],
      onChange: (v) => { try { localStorage.setItem(TAP_KEY, v); } catch (e) { /* */ } },
    }));
    const grid = h('div', { class: 'lv-scenes' }, scenes().map((sc) => {
      const b = h('button', { class: 'lv-scene', 'data-id': sc.id, onclick: () => ask(tapMode() === 'cut' ? 'scene.apply' : 'cue.set', { id: sc.id }) }, [S.sceneArt(sc), h('span', { class: 'lv-name', text: sc.name || '' })]);
      refs.scenes.push(b);
      return b;
    }));
    if (!scenes().length) grid.appendChild(h('div', { class: 'hint', text: 'PC\'de kayıtlı sahne yok.' }));
    body.appendChild(grid);

    // Anlık efektler
    body.appendChild(h('div', { class: 'section-label', text: 'Anlık efektler (basılı tut)' }));
    body.appendChild(h('div', { class: 'lv-fx' }, MOMENTARY.map(([id, label]) => {
      const b = h('button', { class: 'cell', 'data-fx': id, text: label });
      const down = (e) => { e.preventDefault(); held.add(id); sendHeld(); paintLive(); try { b.setPointerCapture(e.pointerId); } catch (err) { /* */ } };
      const up = () => { if (!held.has(id)) return; held.delete(id); sendHeld(); paintLive(); };
      b.addEventListener('pointerdown', down);
      b.addEventListener('pointerup', up);
      b.addEventListener('pointercancel', up);
      b.addEventListener('lostpointercapture', up);
      refs.fx.push(b);
      return b;
    })));

    // Klip destesi
    const deck = deckOf(c);
    const slots = deck && Array.isArray(deck.slots) ? deck.slots.filter((x) => x && x.ref) : [];
    if (slots.length) {
      body.appendChild(h('div', { class: 'section-label', text: 'Klip destesi' }));
      const cols = Math.min(8, Math.max(1, deck.cols | 0 || 4));
      const rows = Array.from(new Set(slots.map((x) => x.row | 0))).sort((a, b) => a - b).slice(0, 8);
      const g = h('div', { class: 'lv-deck', style: '--cols:' + cols });
      for (const r of rows) {
        for (let col = 0; col < cols; col++) {
          const sl = slots.find((x) => (x.row | 0) === r && (x.col | 0) === col);
          const b = h('button', { class: 'cell', 'data-cell': r + ':' + col, disabled: !sl, text: sl ? slotLabel(sl) : '', onclick: () => ask('deck.trigger', { row: r, col }) });
          refs.cells.push(b);
          g.appendChild(b);
        }
      }
      body.appendChild(g);
      body.appendChild(h('button', { class: 'btn lv-stop', onclick: () => ask('deck.stop', {}) }, [icon('stop'), h('span', { text: 'Hepsini durdur' })]));
    }

    // Makrolar ve çıkış
    body.appendChild(h('div', { class: 'section-label', text: 'Makrolar' }));
    const macros = (c.modulation && Array.isArray(c.modulation.macros) ? c.modulation.macros : []).slice(0, 8);
    const mgrid = h('div', { class: 'lv-macros' });
    /* Makro ve çıkış: göreli sürüklenen çubuk (dokunma atlatmaz, dikey kaydırma sayfayı kaydırır) */
    const knob = (label, value, onSend) => {
      const fill = h('i', { class: 'tb-fill' });
      const val = h('span', { class: 'lv-kval mono' });
      const track = h('div', { class: 'tbar lv-knob', role: 'slider', 'aria-label': tr(label), 'aria-valuemin': '0', 'aria-valuemax': '100', tabindex: '0' }, [fill]);
      let cur = 0;
      const show = (v) => {
        cur = Math.max(0, Math.min(1, v));
        const p = Math.round(cur * 100);
        fill.style.width = p + '%';
        val.textContent = p + '%';
        track.setAttribute('aria-valuenow', String(p));
      };
      const send = throttled(onSend);
      relDrag(track, { get: () => cur, move: (v) => { show(v); send(v); }, end: (v) => { if (v != null) { show(v); onSend(v); } } });
      show(value);
      return h('div', { class: 'lv-knob-row' }, [h('div', { class: 'lv-knob-head' }, [h('span', { class: 'ctl-label', text: label }), val]), track]);
    };
    macros.forEach((m, i) => {
      mgrid.appendChild(knob((m && m.name) || tr('Makro') + ' ' + (i + 1), (m && m.value) || 0, (v) => ask('macro.set', { i, v })));
    });
    mgrid.appendChild(knob('Çıkış', c.master == null ? 1 : c.master, (v) => ask('master.set', { v })));
    body.appendChild(mgrid);

    // Otomatik VJ ve MilkDrop
    body.appendChild(U.toggle({ label: 'Otomatik VJ', value: !!(c.autovj && c.autovj.enabled), onChange: (on) => ask('autovj.toggle', { on }) }));
    const md = h('span', { class: 'grow-text lv-md' });
    refs.md = md;
    body.appendChild(h('div', { class: 'lv-row lv-mdrow' }, [
      h('div', { class: 'ctl-label', text: 'MilkDrop' }), md,
      h('button', { class: 'iconbtn', 'aria-label': 'Önceki preset', title: 'Önceki preset', onclick: () => ask('milkdrop.nav', { dir: 'prev' }) }, [icon('prev')]),
      h('button', { class: 'iconbtn', 'aria-label': 'Rastgele preset', title: 'Rastgele preset', onclick: () => ask('milkdrop.nav', { dir: 'random' }) }, [icon('shuffle')]),
      h('button', { class: 'iconbtn', 'aria-label': 'Sonraki preset', title: 'Sonraki preset', onclick: () => ask('milkdrop.nav', { dir: 'next' }) }, [icon('next')]),
    ]));

    // Zaman çizelgesi taşıması
    const tl = c.timeline && Array.isArray(c.timeline.tracks) && c.timeline.tracks.length;
    if (tl) {
      const time = h('span', { class: 'mono lv-time' });
      const play = h('button', { class: 'iconbtn', 'aria-label': 'Oynat / duraklat', title: 'Oynat / duraklat', onclick: () => ask('timeline.transport', { action: live().timeline && live().timeline.playing ? 'pause' : 'play' }) }, [icon('play-pause')]);
      refs.time = time;
      body.appendChild(h('div', { class: 'section-label', text: 'Zaman çizelgesi' }));
      body.appendChild(h('div', { class: 'lv-row lv-transport' }, [
        h('button', { class: 'iconbtn', 'aria-label': 'Önceki işaret', title: 'Önceki işaret', onclick: () => ask('timeline.transport', { action: 'prev' }) }, [icon('prev')]),
        play,
        h('button', { class: 'iconbtn', 'aria-label': 'Durdur', title: 'Durdur', onclick: () => ask('timeline.transport', { action: 'stop' }) }, [icon('stop')]),
        h('button', { class: 'iconbtn', 'aria-label': 'Sonraki işaret', title: 'Sonraki işaret', onclick: () => ask('timeline.transport', { action: 'next' }) }, [icon('next')]),
        time,
      ]));
    }
    paintLive();
    paintMeter();
  }

  /* Gösteri kilidi: yanlış dokunmaya karşı bütün kabuğu örter; kaydırarak açılır. */
  function lockShow() {
    const root = document.getElementById('sv-shell');
    if (!root || root.querySelector('.lv-lock')) return;
    const slide = h('input', { type: 'range', min: '0', max: '100', value: '0', 'aria-label': 'Kilidi açmak için kaydırın' });
    const box = h('div', { class: 'lv-lock' }, [h('div', { class: 'lv-lock-card glass' }, [icon('lock'), h('span', { text: 'Kilidi açmak için kaydırın' }), slide])]);
    const reset = () => { if (+slide.value < 96) slide.value = '0'; };
    slide.addEventListener('input', () => { if (+slide.value >= 96) box.remove(); });
    slide.addEventListener('change', reset);
    slide.addEventListener('pointerup', reset);
    root.appendChild(box);
  }

  function fmtTime(t) {
    const s = Math.max(0, Math.floor(Number(t) || 0));
    return Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0');
  }
  let tlBase = { t: 0, at: 0, playing: false };
  /* Program kutusu PC'deki gibi karışır: altta giden sahne, üstte sıradaki,
     saydamlık çubuğun ilerlemesi. Yarıda öbür görüntü tam görünmez. */
  function paintMixFrame() {
    if (!refs || !refs.mons) return;
    const fig = refs.mons.querySelector('.pgm');
    const pvw = refs.mons.querySelector('.pvw .art');
    if (!fig) return;
    if (!mixView || !mixView.fromId) {
      const over = fig.querySelector('.tb-over');
      if (over) over.remove();
      if (pvw) pvw.style.opacity = '';
      return;
    }
    if (!mixView.toId) {
      const l = live();
      if (l.cue) mixView.toId = l.cue;
      else if (l.active && l.active !== mixView.fromId) mixView.toId = l.active;
    }
    let base = fig.querySelector('.art:not(.tb-over)');
    if (!base || base.getAttribute('data-scene') !== String(mixView.fromId)) {
      const next = S.sceneArt(sceneById(mixView.fromId));
      if (base) base.replaceWith(next);
      else fig.insertBefore(next, fig.firstChild);
      base = next;
    }
    let over = fig.querySelector('.tb-over');
    if (mixView.toId && (!over || over.getAttribute('data-scene') !== String(mixView.toId))) {
      const next = S.sceneArt(sceneById(mixView.toId));
      next.classList.add('tb-over');
      const cap = fig.querySelector('figcaption');
      if (cap) fig.insertBefore(next, cap);
      else fig.appendChild(next);
      over = next;
    }
    if (over) over.style.opacity = String(Math.max(0, Math.min(1, mixView.p || 0)));
    if (pvw) pvw.style.opacity = String(Math.max(0, Math.min(1, mixView.p || 0)));
  }

  function paintLive() {
    if (!refs || !refs.mons || !refs.mons.isConnected) return;
    const l = live();
    if (refs.tbar) refs.tbar.paint();
    if (refs.blk) refs.blk.setAttribute('aria-pressed', l.blackout ? 'true' : 'false');
    const pgm = refs.mons.querySelector('.pgm figcaption');
    const pvw = refs.mons.querySelector('.pvw figcaption');
    const a = sceneById(l.active);
    const q = sceneById(l.cue);
    const pgmText = tr('PROGRAM') + ' · ' + (a ? a.name || '' : '—');
    const pvwText = tr('ÖNİZLEME') + ' · ' + (q ? q.name || '' : '—');
    if (pgm && pgm.textContent !== pgmText) { refs.mons.replaceChild(sceneTile(a, 'pgm'), refs.mons.querySelector('.pgm')); }
    if (pvw && pvw.textContent !== pvwText) { refs.mons.replaceChild(sceneTile(q, 'pvw'), refs.mons.querySelector('.pvw')); }
    paintMixFrame();
    for (const b of refs.scenes) {
      b.classList.toggle('on', b.dataset.id === l.active);
      b.classList.toggle('cue', b.dataset.id === l.cue);
    }
    const playing = new Set(String(l.deck || '').split(',').filter(Boolean));
    for (const b of refs.cells) b.classList.toggle('on', playing.has(b.dataset.cell));
    const pcHeld = new Set(Array.isArray(l.held) ? l.held : []);
    for (const b of refs.fx) b.classList.toggle('on', held.has(b.dataset.fx) || pcHeld.has(b.dataset.fx));
    if (refs.md) refs.md.textContent = l.milkdrop || '—';
    if (l.timeline) tlBase = { t: Number(l.timeline.time) || 0, at: performance.now(), playing: !!l.timeline.playing };
    paintTime();
  }
  // Kafa PC'nin özetleri arasında telefonda ilerletilir, her özetle düzeltilir
  function paintTime() {
    if (!refs || !refs.time) return;
    const t = tlBase.playing ? tlBase.t + (performance.now() - tlBase.at) / 1000 : tlBase.t;
    refs.time.textContent = fmtTime(t);
  }
  setInterval(() => { if (tlBase.playing) paintTime(); }, 250);
  function paintMeter() {
    if (!refs || !refs.tapLabel || !refs.tapLabel.isConnected) return;
    const m = meter();
    if (!taps.length || performance.now() - taps[taps.length - 1] > 2000) refs.tapLabel.textContent = m.bpm ? String(Math.round(m.bpm)) : '';
  }

  let wired = false;
  function wire() {
    if (wired || !A() || !A().pc) return;
    wired = true;
    A().pc.onLive(paintLive);
    A().pc.onMeter(paintMeter);
  }

  const page = {
    size: 'tall',
    title: 'Canlı',
    subtitle: () => (A() && A().target ? A().target.get().name || '' : ''),
    actions(box) {
      box.appendChild(h('button', { class: 'iconbtn plain', 'aria-label': 'Gösteri kilidi', title: 'Gösteri kilidi', onclick: lockShow }, [icon('lock')]));
    },
    render(body, ctx) { wire(); render(body, ctx); },
    // Ayar değişti (sahne adı, deste, makro): sürükleme yokken yeniden çizilir
    onConfig(ctx) { if (!drags.size) ctx.refresh(); },
    onLeave() { releaseAll(); },
  };
  S.tab('live', page);
  window.SVShellLive = { page: () => page, tap, _held: () => Array.from(held) };
})();
