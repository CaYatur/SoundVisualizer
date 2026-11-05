/*
 * SoundVisualizer — CaYaDev Ses Görselleştirici
 * Copyright (c) 2026 Çağan Turgut (CaYatur) — CaYaDev, https://cayadev.com
 * https://github.com/CaYatur/SoundVisualizer
 * SPDX-License-Identifier: MIT
 */
'use strict';
/* CANLI SAYFASI (#905). Sırada ve canlı görüntü, sahne ızgarası, katman faderleri; sağda tempo,
   Otomatik VJ ve sahne geçişi.

   "Sırada" görüntüsü sahnenin renk özeti, gerçek çizim değil: ikinci bir motor çalıştırmak canlı
   çıkışın karesinden alırdı. Sahne ızgarası ve tuşlar `applyScene`i kullanıyor, geçiş ayarı aynı. */
(function () {
  const P = () => window.SVPanel;
  const tr = (s) => (window.SVI18n && window.SVI18n.t ? window.SVI18n.t(s) : s);
  const PER_BANK = 24;
  const BANKS = ['A', 'B', 'C', 'D'];
  let cue = '';
  let bank = 0;
  let lower = 'scenes';
  /* Rail / alt gövde kaydırması: Otomatik VJ veya sahne değişiminde paint
     tüm #svLive'ı yeniden kuruyor; kullanıcı aşağıdaysa başa fırlatılmasın. */
  let railScroll = 0;
  let lowerScroll = 0;

  const scenes = () => P().scenes();
  const sceneById = (id) => scenes().find((s) => s && s.id === id) || null;

  function takeCue() {
    if (!cue || !sceneById(cue)) return;
    const id = cue;
    cue = '';
    P().applyScene(id);
  }

  function cell(sc, i) {
    const el = P().el;
    const live = sc.id === P().activeSceneId();
    const armed = sc.id === cue;
    const box = el('button', {
      class: 'sv-scell' + (live ? ' pgm' : '') + (armed ? ' pvw' : ''), type: 'button',
      title: tr('Tıkla: sıraya al. Çift tıkla: hemen al.'),
      onclick: () => { cue = sc.id === cue ? '' : sc.id; paint(); },
      ondblclick: () => { cue = sc.id; takeCue(); },
    });
    const th = el('span', { class: 'sv-th' });
    th.style.background = P().sceneGradient(sc);
    const own = P().sceneThumbShot ? P().sceneThumbShot(sc.id) : '';
    const shot = !own && window.SVSceneShell && window.SVSceneShell.sceneThumb ? window.SVSceneShell.sceneThumb(sc) : null;
    if (shot && shot.id) th.setAttribute('data-thumb-for', shot.id);
    const url = own || (shot && shot.url);
    if (url) th.appendChild(el('img', { src: url, alt: '', onerror: (e) => { e.target.remove(); } }));
    box.appendChild(th);
    if (live) box.appendChild(el('span', { class: 'sv-st', text: tr('Canlı') }));
    else if (armed) box.appendChild(el('span', { class: 'sv-st', text: tr('Sırada') }));
    if (i < 12) box.appendChild(el('em', { text: 'F' + (i + 1) }));
    box.appendChild(el('span', { class: 'sv-sname', text: tr(sc.name || 'Sahne') }));
    return box;
  }

  function scenesBody() {
    const el = P().el;
    const all = scenes();
    const from = bank * PER_BANK;
    const grid = el('div', { class: 'sv-scenes' }, all.slice(from, from + PER_BANK).map((s, i) => cell(s, from + i)));
    if (!all.length) grid.appendChild(el('div', { class: 'scene-empty', text: tr('Kayıtlı sahne yok. “Kaydet” ile mevcut görünümü saklayın.') }));
    return grid;
  }

  // Dikey fader: sürükleyince değer, bırakınca kayıt
  function fader(get, set, label) {
    const el = P().el;
    const fill = el('i');
    const cap = el('b');
    const show = () => { const v = get(); fill.style.height = Math.round(v * 100) + '%'; cap.style.bottom = 'calc(' + Math.round(v * 100) + '% - 2px)'; };
    show();
    const f = el('div', { class: 'sv-vfad', role: 'slider', tabindex: '0', 'aria-label': label, 'aria-valuemin': '0', 'aria-valuemax': '100' }, [fill, cap]);
    const at = (e) => {
      const r = f.getBoundingClientRect();
      set(Math.max(0, Math.min(1, 1 - (e.clientY - r.top) / Math.max(1, r.height))));
      show();
      P().push(false);
    };
    f.addEventListener('pointerdown', (e) => {
      if (e.button != null && e.button !== 0) return; // yalnız sol tuş (#957)
      e.preventDefault();
      f.setPointerCapture(e.pointerId);
      const end = () => { f.removeEventListener('pointermove', at); f.removeEventListener('pointerup', end); P().push(true); };
      f.addEventListener('pointermove', at);
      f.addEventListener('pointerup', end);
      at(e);
    });
    f.addEventListener('keydown', (e) => {
      const d = e.key === 'ArrowUp' ? 0.02 : e.key === 'ArrowDown' ? -0.02 : 0;
      if (!d) return;
      e.preventDefault();
      set(Math.max(0, Math.min(1, get() + d)));
      show();
      P().push(true);
    });
    return f;
  }

  function mixer() {
    const el = P().el;
    const cfg = P().cfg();
    const list = (cfg.layers || []).filter((l) => l && l.kind !== 'logo');
    const SP = window.SVScenePanels;
    const nameOf = (l) => {
      const n = tr(l.name || l.kind);
      const sum = SP && SP.layerSummary ? SP.layerSummary(l) : '';
      return sum && sum !== n ? n + ': ' + sum : n;
    };
    /* Göstergedeki yeşil şerit: ölçülen ses seviyesi, kanalın saydamlığıyla çarpılmış. Katman başına ayrı
       ölçüm yok; sessiz ya da kapalı kanal sıfır gösteriyor. */
    const reach = (l) => (l.muted || l.enabled === false ? 0 : (l.opacity == null ? 1 : l.opacity));
    const strips = list.slice().reverse().map((l) => el('div', { class: 'sv-chan', style: '--chan:' + reach(l) }, [
      window.SVSceneShell && window.SVSceneShell.thumbOf ? window.SVSceneShell.thumbOf(l) : el('span', { class: 'sv-th' }),
      fader(() => (l.opacity == null ? 1 : l.opacity), (v) => { l.opacity = v; }, nameOf(l)),
      el('span', { class: 'sv-lbl', text: SP && SP.layerSummary ? SP.layerSummary(l) : tr(l.name || l.kind), title: nameOf(l) }),
      el('span', { class: 'sv-sm' }, [
        el('button', { class: 'sv-tgl solo' + (l.solo ? ' act' : ''), type: 'button', text: 'S', title: tr('Solo: yalnızca solo katmanlar çizilir'), onclick: () => { l.solo = !l.solo; P().apply(); } }),
        el('button', { class: 'sv-tgl mute' + (l.muted ? ' act' : ''), type: 'button', text: 'M', title: tr('Sessiz: katmanı ayarlarını kaybetmeden gizler'), onclick: () => { l.muted = !l.muted; P().apply(); } }),
      ]),
    ]));
    const FX = window.SVPostFX;
    const chain = Array.isArray(cfg.postfx) ? cfg.postfx : [];
    const fx = el('div', { class: 'sv-mfx' }, [el('div', { class: 'sv-mh', text: tr('Ana Efektler') })].concat(chain.map((f) => {
      const def = FX && FX.EFFECTS && FX.EFFECTS[f.type];
      const inp = el('input', { type: 'checkbox', onchange: (e) => { f.enabled = e.target.checked; P().apply(); } });
      inp.checked = f.enabled !== false;
      return el('label', { class: 'sv-fxrow' }, [el('span', { class: 'switch small' }, [inp, el('span', { class: 'track' })]), el('span', { text: tr(def ? def.label : f.type) })]);
    })));
    if (!chain.length) fx.appendChild(el('div', { class: 'sv-hint', text: tr('Efekt zinciri boş.') }));
    const master = el('div', { class: 'sv-chan sv-master', style: '--chan:' + (cfg.master == null ? 1 : cfg.master) }, [
      el('span', { class: 'sv-th' }, [el('span', { icon: 'upload' })]),
      fader(() => (cfg.master == null ? 1 : cfg.master), (v) => { cfg.master = v; }, tr('Çıkış')),
      el('span', { class: 'sv-lbl', text: tr('Çıkış') }),
      el('span', { class: 'sv-sm' }, [el('button', {
        class: 'sv-tgl mute' + (P().isBlackedOut() ? ' act' : ''), type: 'button', text: 'K', title: tr('Karart'), onclick: () => { P().toggleBlackout(); paint(); },
      })]),
    ]);
    return el('section', { id: 'svMixer', class: 'sv-card sv-mixer' }, [el('div', { class: 'sv-strips' }, strips), fx, master]);
  }

  /* ANLIK EFEKTLER. Basılı tutulduğu sürece çıkışta; ayara yazılmaz, geri alma geçmişine girmez.
     Bırakma pencerede dinleniyor: basılıyken sayfa yeniden çizilse de düğme takılı kalmasın. */
  const MOMENTARY = [
    ['flash', 'Flaş', 'flash', { amount: 0.85 }],
    ['strobe', 'Strobe', 'strobe', { rate: 3, amount: 1 }],
    ['blur', 'Bulanık', 'zoomblur', { amount: 0.2, samples: 16 }],
    ['kaleido', 'Kaleydoskop', 'kaleido', { slices: 6, spin: 0.1, zoom: 1 }],
    ['glitch', 'Glitch', 'glitch', { amount: 0.8, slices: 24, speed: 10 }],
    ['negative', 'Negatif', 'posterize', { levels: 32, invert: 1 }],
  ];
  const held = new Set();
  let heldTimer = null;
  function sendHeld() {
    /* Flaş sınırlaması açıkken strobe saniyede üç flaşı geçmez (WCAG 2.3.1): MilkDrop sınırlayıcısıyla aynı ayar. */
    const free = (P().cfg().milkdrop || {}).flashLimit === false;
    const list = MOMENTARY.filter((m) => held.has(m[0])).map((m) => ({
      type: m[2], enabled: true, params: m[0] === 'strobe' && free ? Object.assign({}, m[3], { rate: 10 }) : m[3],
    }));
    if (window.api && window.api.sendMomentaryFx) window.api.sendMomentaryFx(list);
    const stack = window.SVPreview && window.SVPreview.stack && window.SVPreview.stack();
    if (stack) stack.setMomentary(list);
  }
  function holdFx(id, btn) {
    held.add(id);
    if (btn) btn.classList.add('act');
    sendHeld();
    if (!heldTimer) heldTimer = setInterval(sendHeld, 1000);
    const release = () => {
      window.removeEventListener('pointerup', release);
      window.removeEventListener('pointercancel', release);
      window.removeEventListener('blur', release);
      held.delete(id);
      document.querySelectorAll('.sv-moment button[data-fx="' + id + '"]').forEach((b) => b.classList.remove('act'));
      sendHeld();
      if (!held.size) { clearInterval(heldTimer); heldTimer = null; }
    };
    window.addEventListener('pointerup', release);
    window.addEventListener('pointercancel', release);
    window.addEventListener('blur', release);
  }
  function momentaryCard() {
    const el = P().el;
    return el('div', { class: 'card sv-momentary' }, [
      el('div', { class: 'card-head' }, [el('div', { class: 'ch-main' }, [el('h3', { text: tr('Anlık Efektler') })])]),
      el('div', { class: 'sv-moment' }, MOMENTARY.map((m) => el('button', {
        class: held.has(m[0]) ? 'act' : '', type: 'button', 'data-fx': m[0], text: tr(m[1]), title: tr('Basılı tutun'),
        onpointerdown: (e) => { e.preventDefault(); holdFx(m[0], e.currentTarget); },
      }))),
    ]);
  }

  /* MILKDROP SIRASI. Her MilkDrop katmanı için ekrandaki preset ve "sonraki" düğmesi. Ad ölçer
     mesajıyla güncelleniyor (admin.js `data-md-layer`), liste yeniden çizilmiyor. */
  function mdQueue() {
    const el = P().el;
    const MP = window.SVMilkdropPanel;
    const cfg = P().cfg();
    const list = (cfg.layers || []).filter((l) => l && l.kind === 'visualizer' && l.type === 'milkdrop');
    if (!list.length || !MP || !MP.isOwnLayer) return null;
    const rows = list.slice().reverse().map((l) => {
      const own = MP.isOwnLayer(l);
      const md = own ? l.settings.milkdrop : (cfg.milkdrop || {});
      const name = md.name ? tr(md.name) : tr('Yerleşik varsayılan');
      return el('div', { class: 'sv-qitem' }, [
        window.SVSceneShell.thumbOf(l),
        el('span', { class: 'sv-nm' }, [
          el('b', { text: window.SVSceneShell.titleOf(l) }),
          el('span', Object.assign({ text: name }, own ? { 'data-md-layer': l.id, 'data-cfg': name } : { id: 'svLiveMdName' })),
        ]),
        el('button', {
          class: 'sv-ib sm', type: 'button', icon: 'next', title: tr('Sonraki preset'), 'aria-label': tr('Sonraki preset'),
          onclick: () => { MP.pickFor(own ? l.id : ''); MP.act('Next'); },
        }),
      ]);
    });
    return el('div', { class: 'card sv-queue' }, [
      el('div', { class: 'card-head' }, [el('div', { class: 'ch-main' }, [el('h3', { text: tr('MilkDrop Sırası') })])]),
    ].concat(rows));
  }

  function monitor(kind, title, sub, inner) {
    const el = P().el;
    return el('div', { class: 'sv-card sv-mon ' + kind }, [
      el('div', { class: 'sv-chead' }, [
        el('span', { class: 'sv-tally' + (kind === 'pgm' ? ' on' : ' ok') }),
        el('h3', { class: 'sv-grow', text: tr(title) }),
        el('small', { class: 'sv-mon-sub', text: sub }),
      ]),
      el('div', { class: 'sv-mon-box' }, [inner]),
    ]);
  }

  function paint() {
    const host = document.getElementById('svLive');
    if (!host) return;
    const prevRail = host.querySelector('.sv-rail .sv-cbody');
    const prevLower = host.querySelector('.sv-scenes-card .sv-cbody');
    if (prevRail) railScroll = prevRail.scrollTop;
    if (prevLower) lowerScroll = prevLower.scrollTop;
    const el = P().el;
    const all = scenes();
    if (bank * PER_BANK >= Math.max(all.length, 1)) bank = 0;
    const live = sceneById(P().activeSceneId());
    /* Sıra boşsa bir sonraki sahne sırada: AL her zaman bir yere gidiyor, gösteri elle ilerletilebiliyor. */
    if (!sceneById(cue) && all.length) {
      const at = live ? all.indexOf(live) : -1;
      cue = all[(at + 1) % all.length].id;
      if (cue === P().activeSceneId()) cue = '';
    }
    const cued = sceneById(cue);

    const pvwFrame = el('div', { class: 'sv-m169' });
    if (cued) {
      pvwFrame.style.background = P().sceneGradient(cued);
      const shot = P().sceneThumbShot ? P().sceneThumbShot(cued.id) : '';
      if (shot) pvwFrame.appendChild(el('img', { class: 'sv-pvw-img', src: shot, alt: '' }));
      else pvwFrame.appendChild(el('span', { class: 'sv-mon-note', text: P().sceneSummary(cued) }));
    } else {
      pvwFrame.appendChild(el('span', { class: 'sv-mon-note', text: tr('Izgaradan bir sahne seçin; AL ile canlıya geçer.') }));
    }
    const pgmFrame = el('div', { class: 'sv-m169', id: 'svPgmFrame' });
    const mons = el('div', { class: 'sv-mons' }, [
      monitor('pvw', 'Sırada', cued ? tr(cued.name || 'Sahne') : '', pvwFrame),
      el('div', { class: 'sv-tbar' }, [
        el('button', { class: 'sv-take', type: 'button', text: tr('AL'), title: tr('Sıradaki sahneyi canlıya al'), disabled: !cued, onclick: takeCue }),
      ]),
      monitor('pgm', 'Canlı', live ? tr(live.name || 'Sahne') : '', pgmFrame),
    ]);

    const tabs = el('div', { class: 'sv-tabs', role: 'tablist' }, [
      el('button', { class: lower === 'scenes' ? 'on' : '', type: 'button', text: tr('Sahneler'), onclick: () => { lower = 'scenes'; paint(); } }),
      el('button', { class: lower === 'deck' ? 'on' : '', type: 'button', text: tr('Klip Destesi'), onclick: () => { lower = 'deck'; paint(); } }),
    ]);
    const headKids = [tabs, el('span', { class: 'sv-grow' })];
    if (lower === 'scenes') {
      const pages = Math.ceil(all.length / PER_BANK);
      if (pages > 1) {
        headKids.push(el('div', { class: 'sv-pills' }, BANKS.slice(0, Math.min(BANKS.length, pages)).map((b, i) => el('button', {
          class: i === bank ? 'on' : '', type: 'button', text: tr('Banka') + ' ' + b, onclick: () => { bank = i; paint(); },
        }))));
      }
      headKids.push(el('button', { class: 'btn small', type: 'button', icon: 'plus', text: tr('Kaydet'), onclick: () => { P().saveScene(); paint(); } }));
    }
    const lowerBody = el('div', { class: 'sv-cbody' }, lower === 'scenes' ? [scenesBody()] : [P().sectionCard('clipdeck')].filter(Boolean));
    const scenesCard = el('section', { class: 'sv-card sv-scenes-card sv-insp-free' }, [el('div', { class: 'sv-chead' }, headKids), lowerBody]);

    const rail = el('aside', { class: 'sv-card sv-rail' }, [el('div', { class: 'sv-cbody sv-insp' },
      [P().sectionCard('tempo'), mdQueue(), momentaryCard(), P().sectionCard('transition')].filter(Boolean))]);

    host.replaceChildren(mons, scenesCard, mixer(), rail);
    const nextRail = host.querySelector('.sv-rail .sv-cbody');
    const nextLower = host.querySelector('.sv-scenes-card .sv-cbody');
    if (nextRail) {
      nextRail.scrollTop = railScroll;
      nextRail.onscroll = () => { railScroll = nextRail.scrollTop; };
    }
    if (nextLower) {
      nextLower.scrollTop = lowerScroll;
      nextLower.onscroll = () => { lowerScroll = nextLower.scrollTop; };
    }
    if (window.SVSceneShell) window.SVSceneShell.placeStage('live');
  }

  // Sahne tuşları: yalnız bu sayfadayken, yazı yazarken değil
  document.addEventListener('keydown', (e) => {
    if (!document.body || document.body.getAttribute('data-page') !== 'live') return;
    const t = e.target;
    if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable)) return;
    const m = /^F(\d+)$/.exec(e.key);
    if (m) {
      const sc = scenes()[Number(m[1]) - 1];
      if (sc) { e.preventDefault(); cue = sc.id; paint(); }
      return;
    }
    if (e.key === 'Enter' && cue) { e.preventDefault(); takeCue(); }
  });

  window.SVLiveShell = { paint, setLower: (v) => { lower = v === 'deck' ? 'deck' : 'scenes'; paint(); } };
})();
