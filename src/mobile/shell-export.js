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
  const DEF = { length: 'all', orient: 'landscape', res: '720', fps: '30', quality: 'mid', codec: 'avc' };
  /* Kalite: piksel ve kare başına bit (1080p30'da ~5 / 9 / 19 Mbit/sn). H.265 aynı görüntüyü
     yaklaşık %40 daha az bitle verir. Kodek: H.265 yalnız cihazda kodlayıcısı varsa sunulur. */
  const QUALITY = { low: 0.08, mid: 0.15, high: 0.3 };
  let caps = null;
  function bitrate(sz) { return Math.round(sz.width * sz.height * (+prefs.fps) * (QUALITY[prefs.quality] || QUALITY.mid) * (codec() === 'hevc' ? 0.6 : 1)); }
  function codec() { return prefs.codec === 'hevc' && caps && caps.hevc ? 'hevc' : 'avc'; }
  /* v2: varsayılan süre şarkının tamamı. Eski kayıtlar bütün seçimleri (30 sn dahil) yazıyordu;
     onların süresi bir kez varsayılana döner. */
  function load() {
    try {
      const p = JSON.parse(localStorage.getItem(KEY) || '{}');
      if (p.v !== 2) delete p.length;
      return Object.assign({}, DEF, p, { v: 2 });
    } catch (e) { return Object.assign({ v: 2 }, DEF); }
  }
  function save(p) { try { localStorage.setItem(KEY, JSON.stringify(Object.assign({}, p, { v: 2 }))); } catch (e) { /* depo yok */ } }
  let prefs = load();
  let song = null; // { uri, name, tags }
  /* Sahnede şarkı bilgisini çizen katman var mı: yoksa videoda ad, kapak ve söz görünmez. */
  function showsTrack() {
    const list = (A().config.get() || {}).layers;
    return (Array.isArray(list) ? list : []).some((l) => l && l.enabled !== false && (l.kind === 'nowplaying' || l.type === 'nowplaying'
      || (l.type === 'text' && l.settings && l.settings.text && (l.settings.text.source === 'lyrics' || l.settings.text.source === 'now'))));
  }
  let busy = false;
  let checking = false;
  let pvWatch = null;
  let pvCtx = null;
  function fmtSec(sec) { const s = Math.max(0, Math.round(sec)); return Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0'); }
  let error = '';

  function size() {
    const long = prefs.res === '1080' ? 1920 : 1280;
    const short = prefs.res === '1080' ? 1080 : 720;
    return prefs.orient === 'portrait' ? { width: short, height: long } : { width: long, height: short };
  }

  /* Ses kaynağı (masaüstündeki kural, #1172, SVTimelineAudioCore.exportAudioSource):
     - çizelge dahil ve ses şeritlerinde duyulur klip varsa ses çizelgenin karışımı ('timeline');
       şarkı seçici kilitli, "Başka şarkı kullan" açıkça seçilirse şarkı ('file'),
     - çizelge dahil, ses yok, şarkı da yoksa video çizelgenin uzunluğunda ve sessiz ('none'),
     - yoksa şarkı gerekir.
     Karışım telefonda çizilir (src/mobile/shell-timeline-audio.js); bilgisayardan gelen projede
     bulunamayan ses dosyaları tek tek yeniden bağlanana dek dışa aktarma beklemede kalır. */
  let override = false;
  function tlInfo() { return window.SVShellTimeline ? window.SVShellTimeline.info() : null; }
  function timelineOn() {
    const TLi = tlInfo();
    return !!(prefs.timeline && TLi && TLi.clips > 0 && TLi.enabled);
  }
  const AUD = () => window.SVShellTimelineAudio;
  function tlTracks() { const t = (A().config.get() || {}).timeline; return t && Array.isArray(t.audioTracks) ? t.audioTracks : []; }
  function tlAudio() { const TLi = tlInfo(); return !!(timelineOn() && TLi.audioClips > 0 && AUD()); }
  function audioFrom() {
    if (tlAudio() && !override) return 'timeline';
    if (song) return 'file';
    if (timelineOn() && !tlAudio()) return 'none';
    return '';
  }
  /* Karışımın uzunluğu: çizelgenin ve ses kliplerinin sonu (hangisi uzunsa) */
  function mixLength() {
    const TLi = tlInfo();
    const s = window.SVTimelineAudioCore ? window.SVTimelineAudioCore.exportAudioSummary(tlTracks()) : { duration: 0 };
    return Math.max((TLi && TLi.length) || 0, s.duration || 0);
  }
  function clipTags() {
    const out = {};
    for (const t of tlTracks()) for (const c of (t && t.clips) || []) if (c && c.src && !out[c.src]) out[c.src] = { title: String(c.name || c.src.split('/').pop()).replace(/\.[^.]+$/, '') };
    return out;
  }
  let stage = '';

  function start(ctx) {
    if (!audioFrom() || busy) return;
    busy = true;
    error = '';
    ctx.refresh();
    const sz = size();
    const cfg = JSON.parse(JSON.stringify(A().config.get() || {}));
    /* Zaman çizelgesiyle (src/mobile/shell-timeline.js): dışa aktarıcı çizelgenin tam bileşimini
       kare kare çizer (masaüstündeki exportJobConfig includeTimeline, geçişler dahil). */
    const TLi = window.SVShellTimeline && window.SVShellTimeline.info();
    // Düğme kapalıysa masaüstü yedeğinden gelen includeTimeline da yok sayılır
    const useTl = !!(prefs.timeline && TLi && TLi.clips > 0 && TLi.enabled);
    cfg.export = Object.assign({}, cfg.export, { includeTimeline: useTl, timelineId: useTl ? TLi.id : '' });
    const from = audioFrom();
    const silent = from === 'none';
    const mixed = from === 'timeline';
    // Sessizde ve karışımda "Tamamı" çizelgenin uzunluğu (şarkı yok)
    const len = prefs.length === 'all' ? (silent ? Math.ceil((TLi && TLi.length) || 0) : mixed ? Math.ceil(mixLength()) : 0) : +prefs.length;
    const job = {
      cfg, width: sz.width, height: sz.height, fps: +prefs.fps, codec: codec(), bitrate: bitrate(sz),
      durationSec: len, audioFrom: from,
      audioUri: from === 'file' ? song.uri : '',
      outputName: from === 'file' ? (song.name || 'video').replace(/\.[^.]+$/, '') : ((TLi && TLi.name) || 'timeline'),
    };
    if ((silent || mixed) && !(len > 0)) { busy = false; error = tr('Zaman çizelgesi boş; süre ondan alınamaz.'); ctx.refresh(); return; }
    let ready = Promise.resolve();
    if (mixed) {
      // Karışım telefonda çizilir ve medya klasörüne yazılır; uygulama onu videonun sesi yapar
      if (AUD().previewStop) AUD().previewStop();
      stage = 'mix';
      ctx.refresh();
      ready = AUD().renderMix(tlTracks(), { from: 0, to: len })
        .then((buf) => { stage = 'write'; ctx.refresh(); return AUD().writeMix(AUD().encodeWav(buf)); })
        .then((name) => { job.audioFile = name; job.timelineAudioTags = clipTags(); stage = ''; });
    }
    // Bekleyen kayıt önce diske; sonra motor dışa aktarım sayfasına geçer (bu sayfa kapanır)
    ready.then(() => A().config.flush()).then(() => A().exportOpen(job))
      .catch((e) => {
        busy = false;
        stage = '';
        error = e && e.missing ? tr('Bazı ses dosyaları bulunamadı; önce yeniden bağlayın.') : String((e && e.message) || e);
        ctx.refresh();
      });
  }

  const page = {
    size: 'tall',
    title: 'Dışa Aktar',
    render(body, ctx) {
      // Seçimler her açılışta depodan (başka bir sekmede ya da sınamada değişmiş olabilir)
      if (!busy) prefs = load();
      body.appendChild(h('div', { class: 'hint', text: 'Şu anki sahne seçtiğiniz şarkıyla videoya dönüşür; dosya galeriye kaydedilir. Uzun şarkılar telefonda birkaç dakika sürebilir.' }));
      body.appendChild(U.card([
        U.row('Şarkı', [
          song && song.tags && song.tags.artwork ? h('img', { class: 'thumb xs', src: song.tags.artwork, alt: '' }) : null,
          h('div', { class: 'row-text' }, [
            h('div', { class: 'row-title small', 'data-user-text': '', text: song ? song.name : '—' }),
            song && song.tags && song.tags.artist ? h('div', { class: 'row-sub', 'data-user-text': '', text: [song.tags.title, song.tags.artist].filter(Boolean).join(' — ') }) : null,
          ]),
          h('button', {
            class: 'btn', disabled: audioFrom() === 'timeline' ? true : null, onclick: () => A().media.pick('audio').then((r) => {
              song = r;
              ctx.refresh();
              A().audioTags(r.uri).then((t) => { if (song === r) { song.tags = t; ctx.refresh(); } }, () => {});
            }, (e) => {
              const c = String((e && e.message) || e);
              if (c !== 'cancelled') { error = c; ctx.refresh(); }
            }),
          }, [icon('music'), h('span', { text: song ? 'Değiştir' : 'Seç' })]),
        ]),
        (window.SVShellTimeline && window.SVShellTimeline.info().clips > 0 && window.SVShellTimeline.info().enabled)
          ? U.toggle({ label: 'Zaman çizelgesiyle', value: !!prefs.timeline, onChange: (v) => { prefs.timeline = !!v; save(prefs); ctx.refresh(); } }) : null,
        tlAudio() ? U.toggle({ label: 'Başka şarkı kullan', value: override, onChange: (v) => { override = !!v; if (AUD()) AUD().previewStop(); ctx.refresh(); } }) : null,
        U.seg({ label: 'Süre', options: [['30', '30 sn'], ['60', '60 sn'], ['all', audioFrom() === 'none' || audioFrom() === 'timeline' ? 'Çizelgenin tamamı' : 'Tamamı']], value: prefs.length, onChange: (v) => { prefs.length = v; save(prefs); } }),
        U.seg({ label: 'Yön', options: [['landscape', 'Yatay 16:9'], ['portrait', 'Dikey 9:16']], value: prefs.orient, onChange: (v) => { prefs.orient = v; save(prefs); } }),
        U.seg({ label: 'Çözünürlük', options: [['720', '720p'], ['1080', '1080p']], value: prefs.res, onChange: (v) => { prefs.res = v; save(prefs); } }),
        U.seg({ label: 'Kare hızı', options: [['30', '30 fps'], ['60', '60 fps']], value: prefs.fps, onChange: (v) => { prefs.fps = v; save(prefs); } }),
        U.seg({ label: 'Kalite', options: [['low', 'Düşük'], ['mid', 'Orta'], ['high', 'Yüksek']], value: prefs.quality, onChange: (v) => { prefs.quality = v; save(prefs); } }),
        caps && caps.hevc
          ? U.seg({ label: 'Kodek', options: [['avc', 'H.264'], ['hevc', 'H.265']], value: codec(), onChange: (v) => { prefs.codec = v; save(prefs); } })
          : U.row('Kodek', [h('div', { class: 'row-text' }, [h('div', { class: 'row-title small', text: 'H.264' }), h('div', { class: 'row-sub', text: caps ? 'Bu cihazda H.265 kodlayıcısı yok.' : '' })])]),
      ]));
      // Ses kaynağı: çizelgenin karışımı (dinle, bulunamayanları yeniden bağla) ya da sessiz çizelge
      const TLn = tlInfo();
      let lost = [];
      if (audioFrom() === 'timeline') {
        lost = AUD().missing(tlTracks());
        const pv = AUD().previewing();
        // Dinleme bitince ya da durunca düğme güncellenir
        if (!pvWatch) {
          let was = '';
          pvWatch = AUD().onChange(() => {
            const p = AUD().previewing();
            const k = p.on + '|' + p.busy;
            if (k !== was) { was = k; if (pvCtx && pvCtx.body.isConnected) pvCtx.ctx.refresh(); }
          });
        }
        pvCtx = { body, ctx };
        body.appendChild(U.card([
          U.row('Ses', [
            h('div', { class: 'row-text' }, [
              h('div', { class: 'row-title small', text: tr('Zaman çizelgesinin sesi') }),
              h('div', { class: 'row-sub', text: TLn.audioClips + ' ' + tr('klip') + ' · ' + fmtSec(mixLength()) }),
            ]),
            h('button', {
              class: 'btn', disabled: lost.length || busy ? true : null,
              onclick: () => AUD().preview(tlTracks(), { from: 0, to: mixLength() }).then(() => ctx.refresh(), (e) => { error = e && e.missing ? tr('Bazı ses dosyaları bulunamadı; önce yeniden bağlayın.') : String((e && e.message) || e); ctx.refresh(); }),
            }, [icon(pv.on ? 'stop' : 'play'), h('span', { text: pv.busy ? 'Hazırlanıyor…' : pv.on ? 'Durdur' : 'Karışımı dinle' })]),
          ]),
        ]));
        for (const k of lost) {
          body.appendChild(h('div', { class: 'banner warn' }, [
            icon('warning'),
            h('div', { class: 'grow-text' }, [h('div', { 'data-user-text': '', text: k.name }), h('div', { class: 'row-sub', text: tr('Ses dosyası bu telefonda bulunamadı') + ' · ' + k.clips + ' ' + tr('klip') })]),
            h('button', { class: 'btn small', onclick: () => AUD().relink(k.src).then(() => ctx.refresh(), (e) => { const c = String((e && e.message) || e); if (c !== 'cancelled') { error = c; ctx.refresh(); } }) }, [h('span', { text: 'Yeniden bağla' })]),
          ]));
        }
        // Kaynaklar yüklenince (bulunamayanlar belli olunca) sayfa yenilenir
        if (!checking && tlTracks().some((t) => ((t && t.clips) || []).some((c) => c && c.src && AUD().status(c.src) === 'loading'))) {
          checking = true;
          AUD().check(tlTracks()).then(() => { checking = false; if (body.isConnected) ctx.refresh(); }, () => { checking = false; });
        }
      } else if (audioFrom() === 'none') {
        body.appendChild(h('div', { class: 'banner info' }, [icon('info'), h('div', { class: 'grow-text', text: tr('Şarkı seçilmedi: video çizelgenin uzunluğunda ve sessiz çıkar.') })]));
      }
      if (!showsTrack()) body.appendChild(h('div', { class: 'banner info' }, [icon('info'), h('div', { class: 'grow-text', text: 'Şarkı adı, sanatçı, kapak, ilerleme ve sözlerin videoda görünmesi için sahneye Çalan Parça ya da Şarkı Sözü katmanı ekleyin.' })]));
      // Cihazın kodlayıcıları bir kez sorulur
      if (!caps && A().exportCaps) A().exportCaps().then((c) => { caps = c || { avc: true, hevc: false }; if (body.isConnected) ctx.refresh(); }, () => { caps = { avc: true, hevc: false }; });
      if (error) body.appendChild(h('div', { class: 'banner', role: 'alert' }, [icon('warning'), h('div', { class: 'grow-text', text: tr('Dışa aktarma başlatılamadı.') + ' (' + error + ')' })]));
      const label = stage === 'mix' ? 'Ses karıştırılıyor…' : stage === 'write' ? 'Ses yazılıyor…' : busy ? 'Hazırlanıyor…' : 'Dışa Aktar';
      const go = h('button', { class: 'btn primary block', disabled: !audioFrom() || busy || lost.length ? true : null, onclick: () => start(ctx) }, [icon('export'), h('span', { text: label })]);
      ctx.foot.appendChild(go);
    },
  };

  window.SVShellExport = Object.freeze({ page: () => page });
})();
