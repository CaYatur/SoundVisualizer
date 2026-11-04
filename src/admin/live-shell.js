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
    if (!all.length) grid.appendChild(el('div', { class: 'scene-empty', text: tr('Kayıtlı sahne yok. “Kaydet” ile mevcut görünümü sahne yap.') }));
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
    const strips = list.slice().reverse().map((l) => el('div', { class: 'sv-chan' }, [
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
    const master = el('div', { class: 'sv-chan sv-master' }, [
      fader(() => (cfg.master == null ? 1 : cfg.master), (v) => { cfg.master = v; }, tr('Çıkış')),
      el('span', { class: 'sv-lbl', text: tr('Çıkış') }),
      el('span', { class: 'sv-sm' }, [el('button', {
        class: 'sv-tgl mute' + (P().isBlackedOut() ? ' act' : ''), type: 'button', text: 'K', title: tr('Karart'), onclick: () => { P().toggleBlackout(); paint(); },
      })]),
    ]);
    return el('section', { class: 'sv-card sv-mixer' }, [el('div', { class: 'sv-strips' }, strips), fx, master]);
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
    const el = P().el;
    const all = scenes();
    if (bank * PER_BANK >= Math.max(all.length, 1)) bank = 0;
    const cued = sceneById(cue);
    const live = sceneById(P().activeSceneId());

    const pvwFrame = el('div', { class: 'sv-m169' });
    if (cued) {
      pvwFrame.style.background = P().sceneGradient(cued);
      pvwFrame.appendChild(el('span', { class: 'sv-mon-note', text: P().sceneSummary(cued) }));
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
      ['tempo', 'transition'].map((id) => P().sectionCard(id)).filter(Boolean))]);

    host.replaceChildren(mons, scenesCard, mixer(), rail);
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

  window.SVLiveShell = { paint };
})();
