/*
 * SoundVisualizer — CaYaDev Ses Görselleştirici
 * Copyright (c) 2026 Çağan Turgut (CaYatur) — CaYaDev, https://cayadev.com
 * https://github.com/CaYatur/SoundVisualizer
 * SPDX-License-Identifier: MIT
 */
'use strict';
/* ZAMAN ÇİZELGESİ DENETÇİSİ VE AYARLARI (src/mobile/shell-timeline.js çekirdeğiyle).

   Masaüstünün denetçisi ve "Döngü, işaretler ve cetvel" bölümüyle aynı alanlar, aynı
   sırayla (src/admin/timeline-panel.js inspector, moreSettings): klip, çoklu seçim, otomasyon
   noktası, işaret, tempo değişimi, parça; çizelge ayarları. Değerler ortak modelin
   alanlarına yazılır (src/shared/timeline.js makeClip/makeTrack/makeMarker); geçiş türleri
   ve eğrileri motorun listelerinden (SVTransition, SVModulation), otomasyon hedefleri
   masaüstünün kataloğundan (SVModulationPanel.targetCatalog + şema kaydırıcıları + çizelgenin
   kendi opaklık hedefleri). Telefonda tablet genişliğinde sağda, dar ekranda ayrı sayfa. */
(function () {
  if (typeof window === 'undefined' || !window.SVShell) return;
  const S = window.SVShell;
  const { h, icon } = S;
  const U = () => window.SVShellUI;
  const A = () => window.SVAndroid;
  const TL = () => window.SVTimeline;
  const TE = () => window.SVTimelineEdit;

  // Masaüstünün denetçisindeki adlar (src/admin/timeline-panel.js EASE_LABELS)
  const EASE_LABELS = { linear: 'Doğrusal', smooth: 'Yumuşak', easeIn: 'Yavaş Başla', easeOut: 'Yavaş Bitir', easeInOut: 'Yavaş Başla ve Bitir', snap: 'Ani' };
  const CURVE_LABELS = { linear: 'Doğrusal', exp: 'Üstel', exp3: 'Üstel (küp)', log: 'Logaritmik', scurve: 'S Eğrisi', ease: 'Yumuşak', abs: 'Mutlak', hold: 'Tut (anlık)' };

  // ---- Küçük alanlar ----
  function numField(core, label, value, o) {
    const step = o.step || 0.01;
    const input = h('input', { type: 'number', class: 'field tl-num', inputmode: 'decimal', step: String(step), min: o.min != null ? String(o.min) : null, max: o.max != null ? String(o.max) : null, 'aria-label': core.tr(label), value: String(Math.round(value / step) * step) });
    input.addEventListener('change', () => {
      let v = parseFloat(String(input.value).replace(',', '.'));
      if (!isFinite(v)) return;
      if (o.min != null) v = Math.max(o.min, v);
      if (o.max != null) v = Math.min(o.max, v);
      o.onChange(v);
    });
    return U().row(label, [input]);
  }
  function btn(ic, label, fn, cls) { return h('button', { class: 'btn' + (cls ? ' ' + cls : ''), onclick: fn }, [icon(ic), h('span', { text: label })]); }
  function head(text, ic) { return h('div', { class: 'tl-insp-head' }, [ic ? icon(ic) : null, h('span', { text })]); }
  function note(text) { return h('div', { class: 'hint', text }); }
  function transTypePairs(core) {
    const T = window.SVTransition;
    const out = [['', core.tr('Sahne varsayılanını kullan')]];
    if (T && T.TRANSITION_IDS) T.TRANSITION_IDS.forEach((id) => out.push([id, core.tr((T.TRANSITIONS[id] && T.TRANSITIONS[id].label) || id)]));
    return out;
  }
  function transEasePairs(core) {
    const T = window.SVTransition;
    const ids = (T && T.EASING_IDS) || Object.keys(EASE_LABELS);
    return [['', core.tr('Sahne varsayılanını kullan')]].concat(ids.map((id) => [id, core.tr(EASE_LABELS[id] || id)]));
  }
  function keyCurves() { return ((window.SVModulation && window.SVModulation.CURVE_IDS) || ['linear']).concat(['hold']); }

  // ---- Kaynaklar (masaüstü: refOptions, clipdeck targetOptions) ----
  function refOptions(core, type) {
    const c = core.cfg();
    if (type === 'scene') return (c.scenes || []).filter(Boolean).map((sc) => [sc.id, sc.name || sc.id]);
    if (type === 'preset') { const T = window.SVTemplates; return T ? T.TEMPLATES.map((t) => [t.id, (t.group ? core.tr(t.group) + ' · ' : '') + core.tr(t.name)]) : []; }
    if (type === 'palette') return ((window.SV && window.SV.GRADIENT_PRESETS) || []).concat(c.userPresets || []).map((g) => [g.name, core.tr(g.name)]);
    if (type === 'visualizer') { const MC = window.SVModeCatalog; return ((MC && MC.VISUALIZERS) || []).filter((m) => m && m.id && m.id !== 'none').map((m) => [m.id, core.tr(m.label || m.id)]); }
    if (type === 'action') return core.actionOptions();
    if (type === 'shader') {
      const P = window.SVPresets;
      const list = P ? P.byKind('visualizer').concat(P.byKind('background')).filter((x) => x.engine === 'shader') : [];
      return list.map((x) => [x.id, x.name || x.id]);
    }
    return null;
  }
  function targetOptions(core, type) {
    const c = core.cfg();
    const layers = Array.isArray(c.layers) ? c.layers : [];
    const lname = (l) => l.name || l.id;
    const out = [];
    if (type === 'video') {
      out.push(['media', core.tr('Medya (ana)')]);
      for (const l of layers) if (l.kind === 'media') out.push(['layer:' + l.id, core.tr('Katman') + ': ' + lname(l)]);
    } else if (type === 'shader') {
      out.push(['vis', core.tr('Görselleştirici (ana)')], ['bg', core.tr('Arkaplan (ana)')]);
      for (const l of layers) if (l.kind === 'background' || (l.kind === 'visualizer' && l.type !== 'text' && l.type !== 'nowplaying')) out.push(['layer:' + l.id, core.tr('Katman') + ': ' + lname(l)]);
    } else if (type === 'image') {
      const items = (c.images && Array.isArray(c.images.items)) ? c.images.items : [];
      items.forEach((it, i) => out.push(['img:' + it.id, core.tr('Nesne') + ' ' + (i + 1) + (it.name ? ' · ' + it.name : '')]));
      for (const l of layers) {
        if (l.kind !== 'sprites') continue;
        const li = (l.settings && l.settings.images && l.settings.images.items) || [];
        li.forEach((it, i) => out.push(['limg:' + l.id + ':' + it.id, lname(l) + ' · ' + core.tr('Nesne') + ' ' + (i + 1)]));
      }
    }
    return out;
  }
  const EMPTY = { scene: 'Henüz kayıtlı sahne yok. Sahne ayarlarından bir sahne kaydedin.', palette: 'Henüz renk şablonu yok.', visualizer: 'Görselleştirici listesi yüklenemedi.', shader: 'Henüz shader preseti yok.', action: 'Bu tür için seçilebilir bir kaynak yok.' };
  /* Kaynak seçimi: listeli türler seçiciden; video kitaplıktan ya da galeriden; görsel
     galeriden. Döner: { ref, name?, target? } ya da null. */
  async function pickSource(core, type, current) {
    if (type === 'video') {
      let libs = [];
      try { libs = (await A().libraries.list('media')) || []; } catch (e) { libs = []; }
      const opts = [['__pick', '＋ ' + core.tr('Galeriden seç')]].concat(libs.map((it) => ['lib:' + (it.file || ''), it.name || it.file || '']));
      const v = await S.choose(core.tr('Video'), opts, '');
      if (!v) return null;
      if (v.indexOf('lib:') === 0) {
        const file = v.slice(4);
        const it = libs.find((x) => (x.file || '') === file) || {};
        return { ref: 'https://appassets.androidplatform.net/files/lib-media/' + encodeURIComponent(file), name: it.name || file, target: firstTarget(core, 'video') };
      }
      try { const f = await A().media.pick('video'); return f && f.url ? { ref: f.url, name: f.name || '', target: firstTarget(core, 'video') } : null; } catch (e) { return null; }
    }
    if (type === 'image') {
      try { const f = await A().media.pick('image'); return f && f.dataUrl ? { ref: f.dataUrl, name: f.name || '', target: firstTarget(core, 'image') } : null; } catch (e) { return null; }
    }
    const opts = refOptions(core, type) || [];
    if (!opts.length) { await S.confirm(core.tr(EMPTY[type] || EMPTY.action), core.tr('Tamam')); return null; }
    const v = await S.choose(core.typeLabel(type), opts, current || '');
    if (!v) return null;
    return type === 'shader' ? { ref: v, target: firstTarget(core, 'shader') } : { ref: v };
  }
  function firstTarget(core, type) { const o = targetOptions(core, type); return o.length ? o[0][0] : ''; }

  // ---- Otomasyon hedefleri (masaüstü: targetCatalog) ----
  function targetCatalog(core) {
    const c = core.cfg();
    const out = [];
    const MP = window.SVModulationPanel;
    if (MP && MP.targetCatalog) { try { out.push(...MP.targetCatalog(c)); } catch (e) { /* katalog kurulamadı: şema yeter */ } }
    const Sc = window.SVSchema;
    for (const r of (Sc && Sc.SLIDERS) || []) if (!out.some((o) => o.path === r.path)) out.push({ path: r.path, label: r.label || r.path, group: 'Ayarlar', min: r.min, max: r.max });
    const tl = core.model();
    tl.tracks.forEach((trk, ti) => {
      if (trk.kind !== 'clip') return;
      const tname = trk.name || (core.tr('Parça') + ' ' + (ti + 1));
      out.push({ path: 'tl.track.' + trk.id + '.opacity', label: core.tr('Parça Opaklığı') + ': ' + tname, group: 'Zaman Çizelgesi', min: 0, max: 1 });
      for (const cl of trk.clips) out.push({ path: 'tl.clip.' + cl.id + '.opacity', label: core.tr('Klip Opaklığı') + ': ' + core.clipLabel(cl) + ' · ' + core.fmt(cl.start), group: 'Zaman Çizelgesi', min: 0, max: 1 });
    });
    return out;
  }
  async function pickTarget(core, trk) {
    const cat = targetCatalog(core);
    const q = await S.prompt(core.tr('Hedef ayar ara (boş: hepsi)'), '');
    if (q == null) return;
    const list = TE().filterTargets ? TE().filterTargets(cat, q) : cat.filter((x) => (x.label + ' ' + x.path).toLowerCase().includes(String(q).toLowerCase()));
    if (!list.length) { await S.confirm(core.tr('Eşleşen ayar yok.'), core.tr('Tamam')); return; }
    const v = await S.choose(core.tr('Hedef Ayar'), list.slice(0, 300).map((x) => [x.path, core.tr(x.group || '') + ' · ' + core.tr(x.label || x.path)]), trk.target || '');
    if (!v) return;
    const hit = list.find((x) => x.path === v) || {};
    trk.target = v;
    if (isFinite(hit.min) && isFinite(hit.max)) { trk.min = hit.min; trk.max = hit.max; }
    if (!trk.name || /^(Otomasyon|Automation)\s*\d*$/.test(trk.name)) trk.name = core.tr(hit.label || v);
    core.commit();
  }

  // ---- Denetçi ----
  function clipForm(core, box, c, trk, ctx) {
    const t = core.tr;
    const locked = trk.locked;
    const save = () => core.commit();
    box.appendChild(head(core.clipLabel(c), core.TYPE_ICONS[c.type] || 'clapper'));
    const kids = [];
    kids.push(U().text({ label: 'Klip Adı', value: c.name || '', placeholder: core.clipSourceLabel(c), onChange: (v) => { c.name = String(v || '').trim(); save(); } }));
    kids.push(U().select({ label: 'Tür', options: ['scene', 'preset', 'palette', 'visualizer', 'video', 'image', 'shader', 'action'].map((x) => [x, core.typeLabel(x)]), value: c.type, onChange: (v) => { if (v === c.type) return; c.type = v; c.ref = ''; c.target = ''; save(); rerender(); } }));
    kids.push(U().row('Kaynak', [h('button', { class: 'btn tl-src', onclick: () => pickSource(core, c.type, c.ref).then((r) => {
      if (!r) return;
      c.ref = r.ref;
      if (r.name && !c.name && (c.type === 'video' || c.type === 'image')) c.name = r.name;
      if (r.target && !c.target) c.target = r.target;
      save();
      rerender();
    }) }, [icon('folder-open'), h('span', { class: 'tl-src-name', text: core.clipSourceLabel(c) || t('seçilmedi') })])]));
    const tOpts = targetOptions(core, c.type);
    if (c.type === 'video' || c.type === 'image' || c.type === 'shader') {
      if (tOpts.length) kids.push(U().select({ label: 'Hedef', options: tOpts, value: c.target || tOpts[0][0], onChange: (v) => { c.target = v; save(); } }));
      else kids.push(note(t(c.type === 'image' ? 'Görsel klibi bir görsel nesnenin resmini değiştirir; henüz nesne yok. Katman ekle menüsünden Görsel Nesneler ekleyin.' : 'Bu tür için uygun hedef yok.')));
    }
    if (c.type === 'scene' && c.ref) {
      kids.push(note(t('Bu klip sahneye başvurur; katmanlar ve efektler sahnenin kendisinde düzenlenir.')));
      kids.push(U().row('Kaynak düzeni', [btn('layers', t('Sahneyi aç'), () => {
        // Elle ayara dön, sahneyi uygula, katmanları aç: sahne güncellenince klip de değişir
        if (core.modeOn()) core.unlinkOutput();
        S.recallScene(c.ref);
        S.close();
        S.open('layers');
      })]));
    } else if (c.type === 'preset') kids.push(note(t('Bu klip şablona başvurur; şablonlar Kitaplık bölümünde.')));
    else if (c.type === 'action') kids.push(note(t('Eylem, oynatma kafası klibe girince bir kez çalışır (Timeline kullan açıkken).')));
    box.appendChild(U().card(kids));
    const time = [];
    time.push(numField(core, 'Başlangıç (sn)', c.start, { min: 0, step: 0.01, onChange: (v) => { c.start = v; TE().sortClips(trk); save(); } }));
    time.push(numField(core, 'Süre (sn)', c.dur, { min: 0.05, step: 0.01, onChange: (v) => { c.dur = v; save(); } }));
    if (c.type !== 'action') {
      time.push(U().slider({ label: 'Geçiş (sn, 0 = genel)', min: 0, max: 8, step: 0.05, value: c.fade || 0, def: 0, onChange: (v) => { c.fade = v; save(); } }));
      time.push(U().select({ label: 'Geçiş Türü', options: transTypePairs(core), value: c.transType || '', onChange: (v) => { c.transType = v; save(); } }));
      time.push(U().select({ label: 'Geçiş Eğrisi', options: transEasePairs(core), value: c.transEase || '', onChange: (v) => { c.transEase = v; save(); } }));
      time.push(U().slider({ label: 'Opaklık', min: 0, max: 1, step: 0.01, percent: true, value: c.opacity == null ? 1 : c.opacity, def: 1, onChange: (v) => { c.opacity = v; save(); } }));
      time.push(U().slider({ label: 'Giriş Solması (sn)', min: 0, max: Math.max(1, Math.min(30, c.dur)), step: 0.05, value: c.fadeIn || 0, def: 0, onChange: (v) => { c.fadeIn = v; save(); } }));
      time.push(U().slider({ label: 'Çıkış Solması (sn)', min: 0, max: Math.max(1, Math.min(30, c.dur)), step: 0.05, value: c.fadeOut || 0, def: 0, onChange: (v) => { c.fadeOut = v; save(); } }));
    }
    if (c.type === 'video') {
      time.push(numField(core, 'Kırpma Başı (sn)', c.inPoint || 0, { min: 0, step: 0.01, onChange: (v) => { c.inPoint = v; save(); } }));
      time.push(U().slider({ label: 'Hız', min: 0.05, max: 4, step: 0.05, value: c.speed || 1, def: 1, onChange: (v) => { c.speed = v; save(); } }));
    }
    // Renk; kendi rengi varsa "parçadan al" (masaüstündeki sıfırla düğmesi)
    time.push(U().color({ label: 'Renk', value: TE().clipColor(c, trk), onChange: (v) => { c.color = v; save(); rerender(); } }));
    if (c.color) time.push(h('button', { class: 'btn ghost', onclick: () => { c.color = ''; save(); rerender(); } }, [icon('reset'), h('span', { text: t('Parçadan al') })]));
    box.appendChild(U().card(time));
    if (locked) box.appendChild(note(t('Parça kilitli: taşınamaz, silinemez.')));
    box.appendChild(h('div', { class: 'btn-row' }, [
      btn('cut', t('Böl'), () => { if (!core.splitAtPlayhead()) S.confirm(t('Oynatma kafası bu klibin içinde değil.'), t('Tamam')); }),
      btn('copy', t('Çoğalt'), () => core.duplicateSelection()),
      btn('play', t('Başına git'), () => core.seek(c.start)),
      btn('trash', t('Sil'), () => { if (core.deleteSelection() && ctx) ctx.pop(); }, 'danger'),
    ]));
    function rerender() { if (ctx) ctx.refresh(); else core.openInspector(); }
  }
  function multiForm(core, box, ctx) {
    const t = core.tr;
    const picked = core.pickedClips();
    box.appendChild(head(picked.length + ' ' + t('klip seçili'), 'grid'));
    box.appendChild(U().card([
      U().color({ label: 'Renk (hepsi)', value: TE().clipColor(picked[0].clip, picked[0].trk), onChange: (v) => { picked.forEach((q) => { if (!q.trk.locked) q.clip.color = v; }); core.commit(); } }),
      U().slider({ label: 'Geçiş (sn, hepsi)', min: 0, max: 8, step: 0.05, value: picked[0].clip.fade || 0, onChange: (v) => { picked.forEach((q) => { if (!q.trk.locked) q.clip.fade = Math.max(0, v); }); core.commit(); } }),
    ]));
    box.appendChild(h('div', { class: 'btn-row' }, [
      btn('copy', t('Çoğalt'), () => core.duplicateSelection()),
      btn('copy', t('Kopyala'), () => core.copySelection()),
      btn('x', t('Seçimi bırak'), () => { core.multiClear(); if (ctx) ctx.pop(); }),
      btn('trash', t('Sil'), () => { if (core.deleteSelection() && ctx) ctx.pop(); }, 'danger'),
    ]));
  }
  function keyForm(core, box, trk, ki, ctx) {
    const t = core.tr;
    const k = trk.keys[ki];
    if (!k) return;
    box.appendChild(head(trk.name + ' · ' + t('nokta') + ' ' + (ki + 1), 'wave'));
    const real = (v) => trk.min + (trk.max - trk.min) * v;
    box.appendChild(U().card([
      numField(core, 'Zaman (sn)', k.t, { min: 0, step: 0.01, onChange: (v) => { k.t = v; trk.keys.sort((a, b) => a.t - b.t); core.setSelection({ kind: 'key', trackId: trk.id, keyIndex: trk.keys.indexOf(k) }); core.commit(); } }),
      U().slider({ label: 'Değer', min: 0, max: 1, step: 0.001, value: k.v, format: (v) => U().num(v, 3) + ' → ' + U().num(real(v), 2), onChange: (v) => { k.v = v; core.commit(); } }),
      U().select({ label: 'Segment Eğrisi', options: keyCurves().map((cv) => [cv, t(CURVE_LABELS[cv] || cv)]), value: k.curve || 'linear', onChange: (v) => { k.curve = v; core.commit(); } }),
    ]));
    box.appendChild(h('div', { class: 'btn-row' }, [
      btn('play', t('Git'), () => core.seek(k.t)),
      btn('trash', t('Noktayı sil'), () => { if (core.deleteSelection() && ctx) ctx.pop(); }, 'danger'),
    ]));
  }
  function markerForm(core, box, m, ctx) {
    const t = core.tr;
    box.appendChild(head(t('İşaret') + ' · ' + core.fmt(m.t), 'pin'));
    box.appendChild(U().card([
      U().text({ label: 'Ad', value: m.name || '', onChange: (v) => { m.name = String(v || '').trim(); core.commit(); } }),
      numField(core, 'Zaman (sn)', m.t, { min: 0, step: 0.01, onChange: (v) => { m.t = v; core.model().markers.sort((a, b) => a.t - b.t); core.commit(); } }),
      U().toggle({ label: 'Cue: burada bekle', value: !!m.hold, onChange: (v) => { if (v) m.hold = true; else delete m.hold; core.commit(); } }),
    ]));
    box.appendChild(h('div', { class: 'btn-row' }, [
      btn('play', t('Git'), () => core.seek(m.t)),
      btn('trash', t('Sil'), () => { if (core.deleteSelection() && ctx) ctx.pop(); }, 'danger'),
    ]));
  }
  function tempoForm(core, box, i, ctx) {
    const t = core.tr;
    const list = TE().tempoList(core.model().tempo);
    const e = list[i];
    if (!e) return;
    box.appendChild(head('♩ ' + t(i ? 'Tempo değişimi' : 'Başlangıç temposu') + ' · ' + core.fmt(e.t), 'metronome'));
    const kids = [];
    if (i > 0) kids.push(numField(core, 'Zaman (sn)', e.t, { min: 0, step: 0.01, onChange: (v) => core.applyTempo(TE().moveTempoChange(list, i, v), i) }));
    kids.push(numField(core, 'BPM', e.bpm, { min: 1, max: 999, step: 0.1, onChange: (v) => core.applyTempo(TE().setTempo(list, i, { bpm: v }), i) }));
    kids.push(numField(core, 'Ölçüdeki vuruş', e.beatsPerBar, { min: 1, max: 16, step: 1, onChange: (v) => core.applyTempo(TE().setTempo(list, i, { beatsPerBar: Math.round(v) }), i) }));
    box.appendChild(U().card(kids));
    box.appendChild(note(t('Bu andan sonraki ölçüler bu tempoyla sayılır. Etiketi cetvelde sürükleyerek de taşıyabilirsiniz.')));
    box.appendChild(h('div', { class: 'btn-row' }, [
      btn('play', t('Git'), () => core.seek(e.t)),
      i > 0 ? btn('trash', t('Sil'), () => { if (core.deleteSelection() && ctx) ctx.pop(); }, 'danger') : null,
    ].filter(Boolean)));
  }
  function trackForm(core, box, trk, ctx) {
    const t = core.tr;
    const tl = core.model();
    box.appendChild(head(trk.name || t('Parça'), trk.kind === 'clip' ? 'clapper' : 'wave'));
    const kids = [
      U().text({ label: 'Parçanın Adı', value: trk.name || '', onChange: (v) => { trk.name = String(v || '').trim() || trk.name; core.commit(); } }),
      U().color({ label: 'Renk', value: trk.color || (trk.kind === 'clip' ? '#4f8cff' : '#e11d2a'), onChange: (v) => { trk.color = v; core.commit(); rerender(); } }),
      trk.color ? h('button', { class: 'btn ghost', onclick: () => { trk.color = ''; core.commit(); rerender(); } }, [icon('reset'), h('span', { text: t('Türden al') })]) : null,
      U().toggle({ label: 'Sustur', value: !!trk.muted, onChange: (v) => { trk.muted = v; core.commit(); } }),
      U().toggle({ label: 'Solo: yalnız solo parçalar çalar', value: !!trk.solo, onChange: (v) => { trk.solo = v; core.commit(); } }),
      U().toggle({ label: 'Kilitle: taşınamaz, silinemez', value: !!trk.locked, onChange: (v) => { trk.locked = v; core.commit(); } }),
    ];
    if (trk.kind === 'clip') {
      kids.push(U().slider({ label: 'Parça Opaklığı', min: 0, max: 1, step: 0.01, percent: true, value: trk.opacity == null ? 1 : trk.opacity, def: 1, onChange: (v) => { trk.opacity = v; core.commit(); } }));
      kids.push(note(t('Üstteki parça önde görünür; alttaki parçaların sahneleri arkasında çalışmaya devam eder.')));
    }
    box.appendChild(U().card(kids));
    if (trk.kind === 'automation') {
      const cat = targetCatalog(core);
      const info = TE().targetInfo ? TE().targetInfo(cat, trk.target, null) : null;
      box.appendChild(U().card([
        U().row('Hedef Ayar', [h('button', { class: 'btn tl-src', onclick: () => pickTarget(core, trk).then(rerender) }, [icon('search'), h('span', { class: 'tl-src-name', text: trk.target ? (info && info.label ? t(info.group || '') + ' · ' + t(info.label) : trk.target) : t('Hedef seç…') })])]),
        trk.target ? h('button', { class: 'btn ghost', onclick: () => { trk.target = ''; core.commit(); rerender(); } }, [icon('x'), h('span', { text: t('Hedefi Kaldır') })]) : null,
        U().text({ label: 'Yol (gelişmiş)', value: trk.target || '', placeholder: 'postfx.0.params.strength', onChange: (v) => { trk.target = String(v || '').trim(); core.commit(); } }),
        numField(core, 'En Az', trk.min, { step: 0.01, onChange: (v) => { trk.min = v; core.commit(); } }),
        numField(core, 'En Çok', trk.max, { step: 0.01, onChange: (v) => { trk.max = v; core.commit(); } }),
        note(t('Noktalar 0..1 arasında; en az/en çok aralığına çevrilir. Şeritte boş yere çift dokunarak nokta ekleyin.')),
      ]));
      // Öğren / kaydet (masaüstündeki parça başlığı düğmesi)
      box.appendChild(U().card([
        h('div', { class: 'btn-row' }, [
          btn('aim', t(core.isLearning(trk) ? 'Öğrenmeyi bırak' : 'Öğren'), () => { if (core.isLearning(trk)) { core.stopLearn(); rerender(); } else core.startLearn(trk); }),
          trk.target ? btn('record', t(core.isRecording(trk) ? 'Kaydı durdur' : 'Kayda başla'), () => { core.toggleRecord(trk); rerender(); }, core.isRecording(trk) ? 'primary' : '') : null,
          h('button', { class: 'btn danger', disabled: trk.keys.length ? null : true, onclick: () => { trk.keys = []; core.commit(); rerender(); } }, [icon('trash'), h('span', { text: t('Noktaları temizle') })]),
        ].filter(Boolean)),
        note(t('Öğren: çizelge kapanır; uygulamada bir ayarı oynatın, o ayar hedef olur. Kaydet: oynarken o ayarın elle değişimi noktalara yazılır.')),
      ]));
    }
    const i = tl.tracks.indexOf(trk);
    const move = (d) => { const j = i + d; if (j < 0 || j >= tl.tracks.length) return; tl.tracks.splice(i, 1); tl.tracks.splice(j, 0, trk); core.commit(); rerender(); };
    box.appendChild(h('div', { class: 'btn-row' }, [
      h('button', { class: 'btn', disabled: i > 0 ? null : true, onclick: () => move(-1) }, [icon('arrow-up'), h('span', { text: t('Yukarı') })]),
      h('button', { class: 'btn', disabled: i < tl.tracks.length - 1 ? null : true, onclick: () => move(1) }, [icon('arrow-down'), h('span', { text: t('Aşağı') })]),
      btn('trash', t('Parçayı Sil'), () => S.confirm(t('Bu parça ve içindeki her şey silinecek.'), t('Sil'), true).then((ok) => {
        if (!ok) return;
        const k = tl.tracks.indexOf(trk);
        if (k >= 0) tl.tracks.splice(k, 1);
        core.clearSelection();
        core.commit();
        if (ctx) ctx.pop();
      }), 'danger'),
    ]));
    function rerender() { if (ctx) ctx.refresh(); else core.openInspector(); }
  }

  // ---- Çizelge ayarları (masaüstü: araç çubuğu + "Döngü, işaretler ve cetvel") ----
  function settingsForm(core, box, ctx) {
    const t = core.tr;
    const c = core.tlCfg();
    const tl = core.model();
    const list = TE().tempoList(tl.tempo);
    const ti = core.tempoAtHead();
    const e = list[ti];
    const set = (fn) => { core.writeTl(fn); core.invalidate(); core.redraw(); };
    box.appendChild(head(t('Çıkış'), 'broadcast'));
    box.appendChild(U().card([
      U().toggle({ label: 'Timeline kullan', value: core.modeOn(), onChange: (v) => (v ? core.linkOutput() : core.unlinkOutput()) }),
      note(t('Açık: çıkış oynatma kafasındaki çizelge bileşimini gösterir; düzenlemeler hemen yansır. Kapalı: çizelge çıkışa dokunmaz, elle ayarlarınız aynen geri gelir.')),
    ]));
    box.appendChild(head(t('Tempo ve ızgara'), 'metronome'));
    box.appendChild(U().card([
      numField(core, 'BPM (oynatma kafasında)', e.bpm, { min: 1, max: 999, step: 0.1, onChange: (v) => core.applyTempo(TE().setTempo(list, ti, { bpm: v })) }),
      numField(core, 'Ölçüdeki vuruş', e.beatsPerBar, { min: 1, max: 16, step: 1, onChange: (v) => core.applyTempo(TE().setTempo(list, ti, { beatsPerBar: Math.round(v) })) }),
      h('div', { class: 'btn-row' }, [
        btn('music', t('Tempoyu sesten al'), () => {
          const V = window.SVMobileVJ;
          const b = V && V.tempo ? Math.round(V.tempo().bpm) : 0;
          if (!b) { S.confirm(t('Tempo henüz bulunmadı; müzik çalarken yeniden deneyin.'), t('Tamam')); return; }
          core.applyTempo(TE().setTempo(list, ti, { bpm: b }));
          if (ctx) ctx.refresh();
        }),
        btn('plus', t('Kafada tempo değişimi'), () => { core.addTempoAtHead(); if (ctx) ctx.pop(); }),
      ]),
      U().select({ label: 'Yakalama', options: core.SNAP_PAIRS.map(([k, l]) => [k, t(l)]), value: c.snap || 'bar', onChange: (v) => set((x) => { x.snap = v; }) }),
      U().select({ label: 'Cetvel', options: [['both', t('Süre ve Ölçü')], ['time', t('Yalnızca Süre')], ['bars', t('Yalnızca Ölçü')]], value: c.ruler || 'both', onChange: (v) => set((x) => { x.ruler = v; }) }),
      U().toggle({ label: 'Oynatırken kafayı takip et', value: c.followPlayhead !== false, onChange: (v) => set((x) => { x.followPlayhead = v; }) }),
      U().slider({ label: 'Şerit yüksekliği', min: 40, max: 120, step: 4, value: core.laneH(), def: core.wide() ? 64 : 52, onChange: (v) => { set((x) => { x.laneHeight = v; }); core.refresh(); } }),
    ]));
    // Döngü
    box.appendChild(head(t('Döngü'), 'loop'));
    const lp = tl.loop;
    const lk = [];
    if (lp.enabled && !(lp.end > lp.start)) lk.push(h('div', { class: 'warn-text', text: t('Döngü sonu başından büyük olmadığı için döngü çalışmıyor. "Sonu kafaya al" ile bir bitiş belirleyin.') }));
    lk.push(U().toggle({ label: 'Döngü', value: !!lp.enabled, onChange: (v) => { tl.loop = Object.assign({}, tl.loop, { enabled: v }); core.commit(); if (ctx) ctx.refresh(); } }));
    lk.push(numField(core, 'Döngü başı (sn)', lp.start, { min: 0, step: 0.01, onChange: (v) => core.setLoopEdge('start', v) }));
    lk.push(numField(core, 'Döngü sonu (sn)', lp.end, { min: 0, step: 0.01, onChange: (v) => core.setLoopEdge('end', v) }));
    lk.push(h('div', { class: 'btn-row' }, [
      btn('corner-tl', t('Başı kafaya al'), () => { core.setLoopEdge('start', core.headTime()); if (ctx) ctx.refresh(); }),
      btn('corner-tr', t('Sonu kafaya al'), () => { core.setLoopEdge('end', core.headTime()); if (ctx) ctx.refresh(); }),
    ]));
    box.appendChild(U().card(lk));
    // İşaretler
    box.appendChild(head(t('İşaretler'), 'pin'));
    const mk = [];
    tl.markers.forEach((m) => {
      mk.push(h('div', { class: 'tl-marker-row' }, [
        h('button', { class: 'btn ghost tl-mk-go', 'aria-label': t('Bu işarete git'), onclick: () => core.seek(m.t) }, [icon('play'), h('span', { class: 'mono', text: core.fmt(m.t) })]),
        h('button', { class: 'btn ghost tl-mk-name', onclick: () => { core.setSelection({ kind: 'marker', markerId: m.id }); if (ctx) ctx.push(page(core, 'selection')); } }, [m.hold ? icon('pause') : null, h('span', { text: m.name || t('İşaret') })]),
        h('button', { class: 'iconbtn plain', 'aria-label': t('İşareti sil'), onclick: () => { tl.markers.splice(tl.markers.indexOf(m), 1); core.commit(); if (ctx) ctx.refresh(); } }, [icon('x')]),
      ]));
    });
    if (!tl.markers.length) mk.push(note(t('Henüz işaret yok. Araç çubuğundaki İşaret ile oynatma kafasına ekleyin.')));
    mk.push(h('div', { class: 'btn-row' }, [
      btn('text', t('Sözlerden işaret üret'), () => markersFromLyrics(core, ctx)),
      btn('copy', t('YouTube bölümlerini kopyala'), () => copyChapters(core)),
    ]));
    box.appendChild(U().card(mk));
  }
  /* Sözlerden işaret (masaüstü: SVTimeline.markersFromCues). Kaynak: sahnedeki söz katmanının
     LRC/SRT ipuçları; yoksa çalan parçanın söz kitaplığındaki kaydı. */
  async function markersFromLyrics(core, ctx) {
    const t = core.tr;
    let cues = (core.cfg().text && core.cfg().text.lyrics && core.cfg().text.lyrics.cues) || [];
    if (!cues.length) {
      // Çalan parçanın kitaplıktaki sözleri (sanatçı + ad eşleşmesi; yoksa tek kayıt varsa o)
      const items = ((window.SVLyricsLib && window.SVLyricsLib.items) || []).filter((x) => x && x.text);
      const np = A() && A().nowPlaying && A().nowPlaying.current ? A().nowPlaying.current() : null;
      const low = (s) => String(s || '').toLocaleLowerCase('tr');
      const it = (np && items.find((x) => low(x.title) === low(np.title) && (!x.artist || low(x.artist) === low(np.artist)))) || (items.length === 1 ? items[0] : null);
      const LY = window.SVLyrics;
      if (it && LY && LY.parse) cues = (LY.parse(it.text).lines || []).map((l) => ({ t: l.start, text: l.text }));
    }
    if (!cues.length) { S.confirm(t('Önce bir söz katmanında LRC ya da SRT sözleri açın ya da sözleri Kitaplık → Sözler bölümüne ekleyin.'), t('Tamam')); return; }
    const tl = core.model();
    tl.markers = TL().markersFromCues(cues);
    core.commit();
    S.confirm(tl.markers.length + ' ' + t('işaret üretildi.'), t('Tamam'));
    if (ctx) ctx.refresh();
  }
  async function copyChapters(core) {
    const t = core.tr;
    const FX = window.SVExportFormats;
    const tl = core.model();
    if (!FX || !tl.markers.length) { S.confirm(t('Önce zaman çizelgesine işaret ekleyin.'), t('Tamam')); return; }
    const r = FX.youtubeChapters(tl.markers, TL().timelineLength(tl), core.en() ? { first: 'Start', chapter: 'Chapter' } : { first: 'Başlangıç', chapter: 'Bölüm' });
    let ok = false;
    try { await navigator.clipboard.writeText(r.text); ok = true; } catch (e) { ok = false; }
    if (!ok) { await S.prompt(t('Pano kullanılamadı; listeyi buradan kopyalayın.'), r.text); return; }
    if (r.problems.indexOf('FEW') >= 0) S.confirm(t('Kopyalandı; YouTube en az üç bölüm istiyor.'), t('Tamam'));
    else if (r.problems.indexOf('SHORT') >= 0) S.confirm(t('Kopyalandı; YouTube her bölümün en az 10 saniye sürmesini istiyor.'), t('Tamam'));
    else S.confirm(r.rows.length + ' ' + t('bölüm kopyalandı.'), t('Tamam'));
  }

  function render(box, core, kind, opts) {
    const ctx = opts && opts.ctx;
    box.textContent = '';
    if (kind === 'settings') { settingsForm(core, box, ctx); return; }
    const sel = core.selection();
    if (core.multi().length > 1) { multiForm(core, box, ctx); return; }
    if (sel && sel.kind === 'clip') { const c = core.selClip(); const trk = core.selTrack(); if (c && trk) { clipForm(core, box, c, trk, ctx); return; } }
    if (sel && sel.kind === 'key') { const trk = core.selTrack(); if (trk) { keyForm(core, box, trk, sel.keyIndex, ctx); return; } }
    if (sel && sel.kind === 'marker') { const m = core.selMarker(); if (m) { markerForm(core, box, m, ctx); return; } }
    if (sel && sel.kind === 'tempo') { tempoForm(core, box, sel.index, ctx); return; }
    if (sel && sel.kind === 'track') { const trk = core.selTrack(); if (trk) { trackForm(core, box, trk, ctx); return; } }
    box.appendChild(note(core.tr('Bir klip, nokta, işaret ya da parça seçin. Çift dokunuş ayarlarını açar; boş yerde uzun basmak menüyü açar.')));
  }
  function page(core, kind) {
    return {
      size: 'dock',
      title: () => core.tr(kind === 'settings' ? 'Çizelge ayarları' : 'Seçim'),
      render(body, ctx) { render(body, core, kind, { ctx }); },
      onConfig() { /* çekirdek kendi yazımlarını yok sayar; burada yeniden çizmek alanı kapatırdı */ },
    };
  }

  window.SVTimelineForms = Object.freeze({ render, page, pickSource, targetCatalog, refOptions, targetOptions });
})();
