/*
 * SoundVisualizer — CaYaDev Ses Görselleştirici
 * Copyright (c) 2026 Çağan Turgut (CaYatur) — CaYaDev, https://cayadev.com
 * https://github.com/CaYatur/SoundVisualizer
 * SPDX-License-Identifier: MIT
 */
'use strict';
/* DIŞA AKTAR SAYFASI (docs/android/PLAN.md Faz 5): sahne kartındaki düğmeden (taslak 1).

   Şu anki sahne bir şarkıyla videoya: şarkı telefondan seçilir, süre (30 sn, 60 sn ya da
   şarkının tamamı), yön (yatay 16:9 / dikey 9:16), çözünürlük (720p / 1080p) ve kare
   hızı (30 / 60). "Dışa aktar" işi uygulamaya bırakır; motor dışa aktarım sayfasına
   geçer (src/mobile/export-ui.js), bitince dosya galeriye kaydedilir ve sahneye dönülür.
   Seçimler bu cihaza ait (yerel depo). */
(function () {
  if (typeof window === 'undefined' || !window.SVShell || !window.SVShellUI) return;
  const S = window.SVShell;
  const U = window.SVShellUI;
  const { h, icon, A } = S;
  const tr = (s) => (window.SVI18n && window.SVI18n.t ? window.SVI18n.t(s) : s);

  const KEY = 'sv-export';
  const DEF = { length: '30', orient: 'landscape', res: '720', fps: '30' };
  function load() { try { return Object.assign({}, DEF, JSON.parse(localStorage.getItem(KEY) || '{}')); } catch (e) { return Object.assign({}, DEF); } }
  function save(p) { try { localStorage.setItem(KEY, JSON.stringify(p)); } catch (e) { /* depo yok */ } }
  let prefs = load();
  let song = null; // { uri, name }
  let busy = false;
  let error = '';

  function size() {
    const long = prefs.res === '1080' ? 1920 : 1280;
    const short = prefs.res === '1080' ? 1080 : 720;
    return prefs.orient === 'portrait' ? { width: short, height: long } : { width: long, height: short };
  }

  function start(ctx) {
    if (!song || busy) return;
    busy = true;
    error = '';
    ctx.refresh();
    const sz = size();
    const cfg = JSON.parse(JSON.stringify(A().config.get() || {}));
    /* Zaman çizelgesiyle (src/mobile/shell-timeline.js): dışa aktarıcı çizelgenin tam bileşimini
       kare kare çizer (masaüstündeki exportJobConfig includeTimeline, geçişler dahil). */
    const TLi = window.SVShellTimeline && window.SVShellTimeline.info();
    // Düğme kapalıysa masaüstü yedeğinden gelen includeTimeline da yok sayılır
    const useTl = !!(prefs.timeline && TLi && TLi.clips > 0);
    cfg.export = Object.assign({}, cfg.export, { includeTimeline: useTl, timelineId: useTl ? TLi.id : '' });
    const job = {
      cfg, width: sz.width, height: sz.height, fps: +prefs.fps,
      durationSec: prefs.length === 'all' ? 0 : +prefs.length,
      audioUri: song.uri, outputName: (song.name || 'video').replace(/\.[^.]+$/, ''),
    };
    // Bekleyen kayıt önce diske; sonra motor dışa aktarım sayfasına geçer (bu sayfa kapanır)
    Promise.resolve(A().config.flush()).then(() => A().exportOpen(job))
      .catch((e) => { busy = false; error = String((e && e.message) || e); ctx.refresh(); });
  }

  const page = {
    size: 'tall',
    title: 'Dışa Aktar',
    render(body, ctx) {
      body.appendChild(h('div', { class: 'hint', text: 'Şu anki sahne seçtiğiniz şarkıyla videoya dönüşür; dosya galeriye kaydedilir. Uzun şarkılar telefonda birkaç dakika sürebilir.' }));
      body.appendChild(U.card([
        U.row('Şarkı', [
          h('div', { class: 'row-text' }, [h('div', { class: 'row-title small', text: song ? song.name : '—' })]),
          h('button', {
            class: 'btn', onclick: () => A().media.pick('audio').then((r) => { song = r; ctx.refresh(); }, (e) => {
              const c = String((e && e.message) || e);
              if (c !== 'cancelled') { error = c; ctx.refresh(); }
            }),
          }, [icon('music'), h('span', { text: song ? 'Değiştir' : 'Seç' })]),
        ]),
        (window.SVShellTimeline && window.SVShellTimeline.info().clips > 0)
          ? U.toggle({ label: 'Zaman çizelgesiyle', value: !!prefs.timeline, onChange: (v) => { prefs.timeline = !!v; save(prefs); } }) : null,
        U.seg({ label: 'Süre', options: [['30', '30 sn'], ['60', '60 sn'], ['all', 'Tamamı']], value: prefs.length, onChange: (v) => { prefs.length = v; save(prefs); } }),
        U.seg({ label: 'Yön', options: [['landscape', 'Yatay 16:9'], ['portrait', 'Dikey 9:16']], value: prefs.orient, onChange: (v) => { prefs.orient = v; save(prefs); } }),
        U.seg({ label: 'Çözünürlük', options: [['720', '720p'], ['1080', '1080p']], value: prefs.res, onChange: (v) => { prefs.res = v; save(prefs); } }),
        U.seg({ label: 'Kare hızı', options: [['30', '30 fps'], ['60', '60 fps']], value: prefs.fps, onChange: (v) => { prefs.fps = v; save(prefs); } }),
      ]));
      if (error) body.appendChild(h('div', { class: 'banner', role: 'alert' }, [icon('warning'), h('div', { class: 'grow-text', text: tr('Dışa aktarma başlatılamadı.') + ' (' + error + ')' })]));
      const go = h('button', { class: 'btn primary block', disabled: !song || busy ? true : null, onclick: () => start(ctx) }, [icon('export'), h('span', { text: busy ? 'Hazırlanıyor…' : 'Dışa Aktar' })]);
      ctx.foot.appendChild(go);
    },
  };

  window.SVShellExport = Object.freeze({ page: () => page });
})();
