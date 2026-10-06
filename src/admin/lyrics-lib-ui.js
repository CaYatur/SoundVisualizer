/*
 * SoundVisualizer — CaYaDev Ses Görselleştirici
 * Copyright (c) 2026 Çağan Turgut (CaYatur) — CaYaDev, https://cayadev.com
 * https://github.com/CaYatur/SoundVisualizer
 * SPDX-License-Identifier: MIT
 */
'use strict';
/* Windows söz kütüphanesi. macOS ve Linux bu düğümleri kurmaz.

   Kütüphane uygulama klasöründedir; katman yalnız takip ve eşleme
   kipini saklar. Sanatçı ve parça adı her tuşta panoyu yeniden çizmez,
   yoksa imleç kutudan düşer. */
(function () {
  const P = () => window.SVPanel;
  const SP = () => window.SVScenePanels;

  function items() {
    const box = window.SVLyricsLib;
    return (box && Array.isArray(box.items)) ? box.items : [];
  }

  function live() {
    const st = window.SVNowLive && window.SVNowLive.state;
    return (st && st.has) ? st : null;
  }

  function statusNode(el, txt) {
    const sync = window.SVLyricsSync;
    if (!txt.lyricsFollow || !sync || !sync.playback) {
      return el('div', { class: 'studio-note dim-hint np-live', text: '' });
    }
    const use = sync.playback({
      windows: true,
      follow: true,
      match: txt.lyricsMatch || 'exact',
      library: items(),
      live: window.SVNowLive && window.SVNowLive.state,
      manualText: txt.lyricsSource || '',
      nowMs: Date.now(),
    });
    let label = 'Parça algılanmadı';
    let detail = '';
    if (use && use.source === 'system') { label = 'Oynatıcı sözü'; detail = (live() && live().title) || ''; }
    else if (use && use.source === 'system-line') { label = 'Oynatıcı sözü'; detail = use.text || ''; }
    else if (use && use.source === 'library') {
      label = 'Eşleşen söz';
      detail = [use.item && use.item.title, use.item && use.item.artist].filter(Boolean).join(' — ');
    } else if (use && use.source === 'none') label = 'Eşleşme yok';
    else if (use && use.source === 'manual') label = 'Parça algılanmadı';
    return el('div', { class: 'row' }, [
      el('span', { class: 'lbl', text: label }),
      el('span', { class: 'txt-info np-live', text: detail }),
    ]);
  }

  function toast(msg) {
    if (P().toast) P().toast(msg);
  }

  function flushPending(id) {
    const prev = pending.get(id);
    if (!prev) return Promise.resolve();
    if (prev.timer) clearTimeout(prev.timer);
    pending.delete(id);
    if (prev.patch && window.api && window.api.lyricsLibUpdate) {
      return window.api.lyricsLibUpdate(id, prev.patch);
    }
    return Promise.resolve();
  }

  function lyricInfo(text) {
    const api = window.SVLyrics;
    if (!api || !api.parse) return '';
    const doc = api.parse(text || '');
    if (!doc || !doc.lines) return '';
    return doc.lines.length + ' satır · ' + String(doc.format || '').toUpperCase();
  }

  const TIME_RE = /\[(\d{1,3}):(\d{1,2})(?:[.:]\d{1,3})?\]|<(\d{1,3}):(\d{1,2})(?:[.:]\d{1,3})?>|(\d{1,3}:\d{2}:\d{2}[,.]\d{1,3})|(-->)/g;

  function highlightLine(line) {
    const meta = /^\[([a-zA-Z#]+):(.*)\]$/.exec(line);
    if (meta && !/^\d+$/.test(meta[1])) {
      return [
        { k: 'meta', s: '[' + meta[1] + ':' },
        { k: 'meta-val', s: meta[2] },
        { k: 'meta', s: ']' },
      ];
    }
    const out = [];
    TIME_RE.lastIndex = 0;
    let last = 0;
    let m;
    while ((m = TIME_RE.exec(line))) {
      if (m.index > last) out.push({ k: 'lyric', s: line.slice(last, m.index) });
      let kind = 'time';
      if (m[0] === '-->') kind = 'arrow';
      else if (m[0].charAt(0) === '<') kind = 'word';
      out.push({ k: kind, s: m[0] });
      last = m.index + m[0].length;
    }
    if (last < line.length) out.push({ k: 'lyric', s: line.slice(last) });
    if (/^\d+$/.test(line) && out.length === 1 && out[0].k === 'lyric') out[0].k = 'index';
    return out;
  }

  function highlightParts(text) {
    return String(text == null ? '' : text).split('\n').map(highlightLine);
  }

  let colorOn = true;

  function paintLyrics(host, text) {
    while (host.firstChild) host.removeChild(host.firstChild);
    const el = P().el;
    const lines = highlightParts(text);
    lines.forEach((parts, i) => {
      if (i) host.appendChild(document.createTextNode('\n'));
      parts.forEach((p) => {
        if (!p.s) return;
        host.appendChild(el('span', { class: 'lyr-k lyr-k-' + p.k, text: p.s }));
      });
    });
    host.appendChild(document.createTextNode('\n'));
  }

  /* Kenara tıklamak kapatmaz. Kapatma yalnız başlık düğmesi, Vazgeç ve Escape. */
  async function openEditor(it, rerender) {
    if (document.querySelector && document.querySelector('.lyr-editor-backdrop')) return;
    if (!window.api || !window.api.lyricsLibRead || !window.api.lyricsLibUpdate) {
      toast('Düzenleme kullanılamıyor.');
      return;
    }
    await flushPending(it.id);
    const rec = await window.api.lyricsLibRead(it.id);
    if (!rec) { toast('Söz dosyası okunamadı.'); return; }
    const el = P().el;
    let dirty = false;
    let saving = false;
    const mark = () => { dirty = true; };
    const titleIn = el('input', { class: 'p-in', type: 'text', value: rec.title || '', oninput: mark });
    const artistIn = el('input', { class: 'p-in', type: 'text', value: rec.artist || '', oninput: mark });
    const paint = el('pre', { class: 'lyr-editor-paint', 'aria-hidden': 'true' });
    const area = el('textarea', {
      class: 'p-in lyr-editor-text', spellcheck: 'false', wrap: 'off', oninput: () => {
        mark();
        if (info) info.textContent = lyricInfo(area.value);
        if (colorOn) paintLyrics(paint, area.value);
      },
      onscroll: () => {
        paint.scrollTop = area.scrollTop;
        paint.scrollLeft = area.scrollLeft;
      },
    });
    area.value = rec.text || '';
    const info = el('div', { class: 'studio-note dim-hint', text: lyricInfo(rec.text || '') });
    const applyColor = () => {
      area.classList.toggle('lyr-plain', !colorOn);
      paint.hidden = !colorOn;
      if (colorOn) paintLyrics(paint, area.value);
    };
    const colorBtn = el('button', {
      class: 'btn small ' + (colorOn ? 'primary' : 'ghost'),
      type: 'button',
      text: 'Renklendirme',
      'aria-pressed': colorOn ? 'true' : 'false',
      onclick: () => {
        colorOn = !colorOn;
        colorBtn.classList.toggle('primary', colorOn);
        colorBtn.classList.toggle('ghost', !colorOn);
        colorBtn.setAttribute('aria-pressed', colorOn ? 'true' : 'false');
        applyColor();
      },
    });
    applyColor();
    const close = () => {
      document.removeEventListener('keydown', onKey, true);
      backdrop.remove();
    };
    const requestClose = async () => {
      if (saving) return;
      if (dirty && P().confirm) {
        const ok = await P().confirm('Kaydedilmemiş değişiklikler silinecek.', {
          title: 'Düzenleyici kapatılsın mı?',
          okText: 'Kapat',
          cancelText: 'Düzenlemeye dön',
          danger: true,
          defaultCancel: true,
        });
        if (!ok) return;
      } else if (dirty) return;
      close();
    };
    const onKey = (e) => {
      if (e.key !== 'Escape') return;
      if (document.querySelectorAll && document.querySelectorAll('.ask-backdrop').length > 1) return;
      e.preventDefault();
      e.stopPropagation();
      requestClose();
    };
    const save = async () => {
      if (saving) return;
      const text = area.value || '';
      if (!text) { toast('Söz boş olamaz.'); return; }
      saving = true;
      saveBtn.disabled = true;
      const r = await window.api.lyricsLibUpdate(it.id, {
        title: titleIn.value || '',
        artist: artistIn.value || '',
        text,
      });
      saving = false;
      saveBtn.disabled = false;
      if (!r || !r.ok) {
        toast(r && r.error === 'SIZE' ? 'Söz çok büyük.' : 'Söz kaydedilemedi.');
        return;
      }
      dirty = false;
      close();
      rerender();
      toast('Söz kaydedildi.');
    };
    const saveBtn = el('button', { class: 'btn primary', type: 'button', text: 'Kaydet', onclick: save });
    const backdrop = el('div', { class: 'ask-backdrop lyr-editor-backdrop' }, [
      el('div', {
        class: 'ask-panel lyr-editor', role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': 'lyr-editor-title',
      }, [
        el('div', { class: 'lyr-editor-head' }, [
          el('div', { class: 'ask-title', id: 'lyr-editor-title', text: rec.name || 'Sözü Düzenle' }),
          el('div', { class: 'lyr-editor-tools' }, [
            colorBtn,
            el('button', {
            class: 'btn ghost small', type: 'button', icon: 'x', text: 'Kapat',
            title: 'Kapat', 'aria-label': 'Kapat',
            onclick: requestClose,
          }),
          ]),
        ]),
        el('div', {
          class: 'studio-note dim-hint',
          text: 'Bu metin kütüphanedeki kopyadır. Kaydetmek bu kopyayı değiştirir; içe aktardığınız özgün dosya olduğu yerde kalır.',
        }),
        el('div', { class: 'lyr-editor-fields' }, [
          P().row('Parça Adı', titleIn),
          P().row('Sanatçı', artistIn),
        ]),
        info,
        el('div', { class: 'lyr-editor-code' }, [paint, area]),
        el('div', { class: 'ask-actions' }, [
          el('button', { class: 'btn ghost', type: 'button', text: 'Vazgeç', onclick: requestClose }),
          saveBtn,
        ]),
      ]),
    ]);
    document.body.appendChild(backdrop);
    document.addEventListener('keydown', onKey, true);
    area.focus();
  }

  function libraryKids(el, rerender) {
    const kids = [];
    const list = items();
    if (!list.length) {
      kids.push(el('div', { class: 'studio-note dim-hint', text: 'Kütüphanede söz yok. LRC veya SRT ekleyin.' }));
    }
    list.forEach((it) => {
      kids.push(el('div', { class: 'lyr-item' }, [
        el('div', { class: 'lyr-item-head' }, [
          el('span', { class: 'txt-info np-live lyr-item-name', text: it.name || it.id || '' }),
          el('div', { class: 'lyr-item-actions' }, [
            el('button', {
              class: 'btn ghost small', type: 'button', text: 'Çalan Parçayı Yaz',
              onclick: async () => {
                const cur = live();
                if (!cur || (!cur.title && !cur.artist)) {
                  if (P().toast) P().toast('Sistemde çalan aktif parça bulunamadı.');
                  return;
                }
                if (!window.api || !window.api.lyricsLibUpdate) return;
                await window.api.lyricsLibUpdate(it.id, { title: cur.title || '', artist: cur.artist || '' });
                rerender();
              },
            }),
            el('button', {
              class: 'btn ghost small', type: 'button', text: 'Düzenle',
              onclick: () => openEditor(it, rerender),
            }),
            el('button', {
              class: 'btn ghost small', type: 'button', text: 'Kaldır',
              onclick: async () => {
                if (!window.api || !window.api.lyricsLibRemove) return;
                await window.api.lyricsLibRemove(it.id);
                rerender();
              },
            }),
          ]),
        ]),
        P().row('Parça Adı', el('input', {
          class: 'p-in', type: 'text', value: it.title || '',
          oninput: (e) => schedule(it, 'title', e.target.value),
        })),
        P().row('Sanatçı', el('input', {
          class: 'p-in', type: 'text', value: it.artist || '',
          oninput: (e) => schedule(it, 'artist', e.target.value),
        })),
      ]));
    });
    kids.push(el('div', { class: 'row lyr-add' }, [
      el('button', {
        class: 'btn small', type: 'button', icon: 'folder-open', text: 'Söz Kütüphanesine Ekle',
        onclick: async () => {
          if (!window.api || !window.api.lyricsLibImport) {
            if (P().toast) P().toast('İçe aktarma kullanılamıyor.');
            return;
          }
          const r = await window.api.lyricsLibImport();
          if (!r || !r.ok) return;
          rerender();
        },
      }),
    ]));
    return kids;
  }

  function block(ctx) {
    const txt = (ctx && ctx.txt) || {};
    const rerender = (ctx && ctx.rerender) || (() => {});
    const el = P().el;
    const nodes = [];
    nodes.push(SP().miniToggle('Çalan Parçayı İzle', () => txt.lyricsFollow === true, (v) => {
      txt.lyricsFollow = !!v;
      if (v && window.api && window.api.nowPlayingSubscribe) window.api.nowPlayingSubscribe(true);
      if (ctx && ctx.sync) ctx.sync();
    }, rerender, { def: false }));
    nodes.push(el('div', {
      class: 'studio-note dim-hint',
      text: 'Söz kütüphanesindeki dosyayla eşleşir ve çalan parçanın süresiyle gider.',
    }));
    if (txt.lyricsFollow === true) {
      nodes.push(SP().miniSelect('Eşleme', [
        ['exact', 'Tam Eşleme'],
        ['partial', 'Kısmen Eşleme'],
      ], () => txt.lyricsMatch || 'exact', (v) => {
        txt.lyricsMatch = v === 'partial' ? 'partial' : 'exact';
        if (ctx && ctx.sync) ctx.sync();
      }, rerender, 'exact'));
      nodes.push(statusNode(el, txt));
    }
    return nodes;
  }

  function library(ctx) {
    const rerender = (ctx && ctx.rerender) || (() => {});
    return libraryKids(P().el, rerender);
  }

  const pending = new Map();
  function schedule(it, key, value) {
    it[key] = value;
    const id = it.id;
    const prev = pending.get(id) || { patch: {} };
    prev.patch[key] = value;
    if (prev.timer) clearTimeout(prev.timer);
    prev.timer = setTimeout(() => {
      pending.delete(id);
      if (window.api && window.api.lyricsLibUpdate) window.api.lyricsLibUpdate(id, prev.patch);
    }, 280);
    pending.set(id, prev);
  }

  window.SVLyricsLibUi = { block, library, highlightParts };
})();
