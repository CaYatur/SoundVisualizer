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

  /* T-bar: konum mutlak yollanır, saniyede en çok ~25 kez; sürükleme bitince son konum hemen.
     Bırakınca PC'nin özeti yetişene dek (en çok 1,5 sn) ekranda son konum kalır: ağdan geç
     gelen eski özet çubuğu geri sıçratmasın. */
  let tbarTimer = 0;
  let tbarLast = 0;
  let tbarNext = null;
  function sendTbar(v, now) {
    tbarNext = v;
    const t = performance.now();
    if (!now && t - tbarLast < 40) {
      if (!tbarTimer) tbarTimer = setTimeout(() => { tbarTimer = 0; if (tbarNext != null) sendTbar(tbarNext, true); }, 45);
      return;
    }
    clearTimeout(tbarTimer);
    tbarTimer = 0;
    tbarLast = t;
    const x = tbarNext;
    tbarNext = null;
    ask('tbar', { v: x });
  }
  function tbarPos() {
    const tb = live().tbar;
    if (!tb) return 0;
    if (!tb.live) return tb.rest;
    return tb.rest === 0 ? tb.p : 1 - tb.p;
  }
  let tbarHold = null; // { v, until }
  function tbarEl() {
    const fill = h('i', { class: 'tb-fill' });
    const grip = h('b', { class: 'tb-grip' });
    const bar = h('div', { class: 'tbar', role: 'slider', 'aria-label': 'T-bar', 'aria-valuemin': '0', 'aria-valuemax': '100', tabindex: '0' }, [fill, grip]);
    let shown = 0;
    const show = (v) => {
      shown = Math.max(0, Math.min(1, v));
      const p = Math.round(shown * 1000) / 10;
      fill.style.width = p + '%';
      grip.style.left = p + '%';
      bar.setAttribute('aria-valuenow', String(Math.round(p)));
    };
    relDrag(bar, {
      get: () => shown,
      move: (v) => { tbarHold = null; show(v); sendTbar(v); },
      end: (v) => {
        if (v == null) return;
        show(v);
        sendTbar(v, true);
        tbarHold = { v, until: performance.now() + 1500 };
      },
    });
    const pcPos = () => {
      const v = tbarPos();
      if (tbarHold) {
        // PC son konuma yetişti (ya da uca varıp sahne geçti) veya süre doldu
        if (Math.abs(v - tbarHold.v) < 0.02 || ((tbarHold.v <= 0.01 || tbarHold.v >= 0.99) && !(live().tbar || {}).live) || performance.now() > tbarHold.until) tbarHold = null;
        else return tbarHold.v;
      }
      return v;
    };
    show(pcPos());
    bar.paint = () => { if (!drags.has(bar)) show(pcPos()); };
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
