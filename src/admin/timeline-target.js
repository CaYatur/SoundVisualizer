/*
 * SoundVisualizer — CaYaDev Ses Görselleştirici
 * Copyright (c) 2026 Çağan Turgut (CaYatur) — CaYaDev, https://cayadev.com
 * https://github.com/CaYatur/SoundVisualizer
 * SPDX-License-Identifier: MIT
 */
'use strict';
/* Timeline klip DÜZENLEME HEDEFİ.
 *
 * "Timeline kullan" açıkken çizelgede görsel bir klip seçilince normal
 * Sahne / katman / efekt panelleri o klibin YEREL KOPYASINI düzenler.
 * Paneller yapılandırma nesnesine (cfg) referansla bağlı; bu yüzden
 * oturum süresince sahne anahtarları (SCENE_KEYS) klibin kopyasıyla
 * yer değiştirir, elle ayar ise ayrı saklanır:
 *
 *   cfg.timeline.editTarget     = { trackId, clipId }
 *   cfg.timeline.manualBaseline = elle ayarın sahne anahtarları
 *
 * İkisi de yapılandırmada durur: uygulama oturum ortasında kapanırsa
 * açılışta elle ayar geri konur (recover). Çıkış etkilenmez: mod açıkken
 * çıkış yalnız zamana bağlı bileşimi (SVTimelineCompose) çizer, seçim
 * değil. İleride başlayan bir klibi seçmek onu erken göstermez.
 *
 * Kaynak sahne hiç yazılmaz; aynı kaynaktan başka klipler etkilenmez.
 * Panelden eklenen yeni katman klibin alt katmanı olur: süresi klibinki,
 * klip bitince kaybolur. */
(function () {
  const P = () => window.SVPanel;
  const TC = () => window.SVTimelineCompose;
  const KEYS = () => (window.SVSchema && window.SVSchema.SCENE_KEYS) || [];
  const clone = (v) => (v === undefined ? undefined : JSON.parse(JSON.stringify(v)));
  const t = (s) => (window.SVI18n && window.SVI18n.t ? window.SVI18n.t(s) : s);

  let generation = 0;
  let manualDepth = 0;
  let protectedManual = null;
  let notice = '';
  const EDITABLE = { scene: 1, preset: 1, visualizer: 1, video: 1, image: 1, shader: 1, palette: 1 };

  function tlOf(cfg) { return cfg && cfg.timeline; }
  function findClip(cfg, target) {
    const tl = tlOf(cfg);
    if (!tl || !target || !Array.isArray(tl.tracks)) return null;
    const trk = tl.tracks.find((x) => x && x.id === target.trackId);
    const clip = trk && Array.isArray(trk.clips) ? trk.clips.find((c) => c && c.id === target.clipId) : null;
    return clip ? { trk, clip } : null;
  }
  function active(cfg) {
    const tl = tlOf(cfg);
    return tl && tl.editTarget && tl.manualBaseline ? tl.editTarget : null;
  }

  function snapScene(cfg) {
    const o = {};
    for (const k of KEYS()) if (cfg[k] !== undefined) o[k] = clone(cfg[k]);
    return o;
  }
  function loadScene(cfg, data) {
    const def = (window.SV && window.SV.defaultConfig) ? window.SV.defaultConfig() : {};
    for (const k of KEYS()) {
      const v = data && data[k] !== undefined ? data[k] : def[k];
      if (v === undefined) delete cfg[k];
      else cfg[k] = clone(v);
    }
  }

  /* Paneldeki değişiklikleri klibin yerel kopyasına yaz (gönderimden önce). */
  function sync(cfgIn) {
    const cfg = cfgIn || (P() && P().cfg());
    const tgt = active(cfg);
    if (manualDepth) return false;
    if (!tgt) {
      // Mod açık ama görsel klip hedefi yok: normal editör elle tabana yazamaz
      if (cfg && TC() && TC().modeOn(cfg) && protectedManual) loadScene(cfg, protectedManual);
      return false;
    }
    const hit = findClip(cfg, tgt);
    if (!hit) return false; // silinmiş: reloadFromClip/commit oturumu kapatır
    const C = TC();
    if (!C || !EDITABLE[hit.clip.type]) return false;
    if (!hit.clip.local || (hit.clip.local.from && (hit.clip.local.from.type !== hit.clip.type || hit.clip.local.from.ref !== hit.clip.ref))) return false; // tür/kaynak değişti: yeniden yüklenecek
    /* YERİNDE yaz: çizelge modeli aynı `data` nesnesini paylaşıyor; yeni
       nesne atansaydı modelin sonraki commit'i eski kopyayı geri yazardı. */
    const data = hit.clip.local.data;
    const next = snapScene(cfg);
    for (const k of Object.keys(data)) if (!(k in next)) delete data[k];
    Object.assign(data, next);
    data.layerStack = Object.assign({}, data.layerStack, { enabled: true });
    return true;
  }

  /* IPC, disk, önizleme: editörün geçici kök alanları HİÇ gönderilmez.
     Kalıcı model her zaman elle taban + kliplerin yerel verileridir. */
  function persistent(cfg) {
    const tl = tlOf(cfg);
    if (!tl) return cfg;
    const out = Object.assign({}, cfg);
    if (active(cfg) && !manualDepth) for (const k of KEYS()) {
      if (tl.manualBaseline[k] === undefined) delete out[k];
      else out[k] = clone(tl.manualBaseline[k]);
    }
    out.timeline = Object.assign({}, tl);
    delete out.timeline.manualBaseline; delete out.timeline.editTarget;
    return out;
  }
  function modeChanged(on) {
    generation++;
    const cfg = P() && P().cfg();
    if (on) protectedManual = snapScene(cfg);
    else { protectedManual = null; notice = ''; }
    paintBanner();
  }
  /* Auto VJ / deste / eylemler elle motoru hedefler, seçili klibi değil.
     İşlem eşzamanlıdır; geçici editör verisi finally ile geri konur. */
  function withManual(fn, label) {
    if (manualDepth) return fn();
    const p = P(), cfg = p && p.cfg();
    if (!cfg || !TC() || !TC().modeOn(cfg)) return fn();
    sync(cfg);
    const tgt = active(cfg);
    const editor = tgt ? snapScene(cfg) : null;
    if (tgt) loadScene(cfg, cfg.timeline.manualBaseline);
    manualDepth++;
    try { return fn(); }
    finally {
      protectedManual = snapScene(cfg);
      if (tgt) { cfg.timeline.manualBaseline = clone(protectedManual); loadScene(cfg, editor); }
      manualDepth--;
      notice = label || t('Harici değişiklik elle ayarlara uygulandı; Timeline klibi korunuyor.');
      rerender();
      p.push(true);
    }
  }
  /* MCP/uzak denetimden gelen model elle ayarı taşır. Seçili klibin editör
     kök alanlarını gelen elle alanlarla eşitlemek, onları yanlışlıkla
     klibe yazardı. Hedefi koruyup yalnız klibin kendi verisini yükle. */
  function adoptIncoming(incoming, oldCfg) {
    generation++;
    const old = oldCfg && active(oldCfg);
    recover(incoming);
    protectedManual = snapScene(incoming);
    if (old && TC().modeOn(incoming)) {
      const hit = findClip(incoming, old);
      if (hit && EDITABLE[hit.clip.type]) {
        TC().dropStaleLocal(hit.clip);
        const local = TC().ensureLocal(incoming, hit.clip);
        if (local) {
          incoming.timeline.manualBaseline = clone(protectedManual);
          incoming.timeline.editTarget = clone(old);
          loadScene(incoming, local.data);
        }
      }
    }
    notice = t('Harici değişiklik elle ayarlara uygulandı; Timeline klibi korunuyor.');
    invalidateTimeline();
    return incoming;
  }

  function scopeUndo(key, load) {
    const u = window.SVUndoHistory;
    if (u && u.scope) u.scope(key, load);
    else if (load) load();
  }
  function rerender() {
    const p = P();
    if (p && p.rerender) p.rerender();
    paintBanner();
  }
  function invalidateTimeline() {
    const tp = window.SVTimelinePanel;
    if (tp && tp.invalidate) tp.invalidate();
  }

  /* Oturumu kapat: kopyayı klibe yaz, elle ayarı geri koy. */
  function end(opts) {
    const p = P();
    const cfg = p && p.cfg();
    if (!cfg || !active(cfg)) { paintBanner(); return false; }
    sync(cfg);
    generation++;
    const tl = tlOf(cfg);
    protectedManual = clone(tl.manualBaseline);
    scopeUndo('', () => loadScene(cfg, tl.manualBaseline));
    delete tl.manualBaseline;
    delete tl.editTarget;
    invalidateTimeline();
    if (!(opts && opts.silent)) { rerender(); p.push(true); }
    return true;
  }

  /* Bir klibi düzenleme hedefi yap. Mod kapalıysa ya da tür düzenlenemezse
     hedef temizlenir; elle ayara asla yazılmaz. */
  function begin(trackId, clipId) {
    const p = P();
    const cfg = p && p.cfg();
    if (!cfg) return false;
    const C = TC();
    if (!C || !C.modeOn(cfg)) { end(); return false; }
    const cur = active(cfg);
    if (cur && cur.trackId === trackId && cur.clipId === clipId) {
      const hit = findClip(cfg, cur);
      if (hit && !hit.trk.locked) { paintBanner(); return true; }
    }
    if (cur) end({ silent: true });
    const hit = findClip(cfg, { trackId, clipId });
    if (!hit || hit.trk.locked || !EDITABLE[hit.clip.type]) { rerender(); p.push(true); return false; }
    C.dropStaleLocal(hit.clip);
    const loc = C.ensureLocal(cfg, hit.clip);
    if (!loc) {
      // Kaynak sahne silinmiş / bulunamıyor: düzenlenecek bir şey yok
      if (p.toast) p.toast(t('Klibin kaynağı bulunamadı; düzenlenemez.'), 'warn');
      rerender(); p.push(true);
      return false;
    }
    generation++;
    const tl = tlOf(cfg);
    tl.manualBaseline = protectedManual ? clone(protectedManual) : snapScene(cfg);
    tl.editTarget = { trackId, clipId };
    scopeUndo('clip:' + clipId, () => loadScene(cfg, loc.data));
    if (cfg.layerStack) cfg.layerStack.enabled = true;
    invalidateTimeline();
    rerender();
    p.push(true);
    return true;
  }

  /* Çizelge seçimini izle: tek görsel klip → hedef; yoksa / çoklu → temizle. */
  function follow(sel, multiCount) {
    const p = P();
    const cfg = p && p.cfg();
    const C = TC();
    if (!cfg || !C) return;
    if (!C.modeOn(cfg) || !sel || sel.kind !== 'clip' || (multiCount || 0) > 1) {
      if (active(cfg)) end();
      return;
    }
    begin(sel.trackId, sel.clipId);
  }

  /* Çizelgenin kendi geri al/ileri al'ı klibin kopyasını değiştirebilir:
     paneller kopyanın yeni hâlini göstersin. */
  function reloadFromClip(force) {
    const p = P();
    const cfg = p && p.cfg();
    const tgt = cfg && active(cfg);
    if (!tgt) return;
    const hit = findClip(cfg, tgt);
    if (!hit) {
      // Düzenlenen klip silindi: elle ayar geri, hedef kapanır
      recover(cfg); scopeUndo(''); rerender(); p.push(true);
      return;
    }
    if (hit.trk.locked) { end(); return; }
    const C = TC();
    const stale = C.dropStaleLocal(hit.clip);
    if (!force && !stale && !(EDITABLE[hit.clip.type])) { end(); return; }
    if (!force && !stale) return;
    if (!EDITABLE[hit.clip.type]) { end(); return; }
    const loc = C.ensureLocal(cfg, hit.clip);
    if (!loc) { end(); return; }
    generation++;
    loadScene(cfg, loc.data);
    rerender();
  }

  /* Açılışta yarım kalmış oturum: elle ayarı geri koy (kopya zaten klipte). */
  function recover(cfgIn) {
    const cfg = cfgIn || (P() && P().cfg());
    const tl = tlOf(cfg);
    if (!tl) return false;
    if (!tl.manualBaseline) { delete tl.editTarget; return false; }
    loadScene(cfg, tl.manualBaseline);
    delete tl.manualBaseline;
    delete tl.editTarget;
    return true;
  }

  function info() {
    const cfg = P() && P().cfg();
    const tgt = active(cfg);
    if (!tgt) return null;
    const hit = findClip(cfg, tgt);
    if (!hit) return null;
    return { trackId: tgt.trackId, clipId: tgt.clipId, clip: hit.clip, track: hit.trk };
  }

  function paletteInspector(i) {
    const pane = document.getElementById('svInspector');
    if (!pane) return;
    // Palet görsel katman üretmez. Sahne geçişi/katman araçlarını taklit
    // etmek yerine yalnız klibin zamanlı renk değiştiricisi düzenlenir.
    if (pane.dataset && pane.dataset.paletteTarget === i.clipId && pane.querySelector('.tl-palette-title')) return;
    pane.textContent = '';
    if (pane.dataset) pane.dataset.paletteTarget = i.clipId;
    const h = document.createElement('h3'); h.className = 'tl-palette-title'; h.textContent = t('Renk Şablonu');
    const note = document.createElement('p'); note.textContent = t('Renkler yalnız bu klibin süresince uygulanır.');
    pane.append(h, note);
    const colors = P().cfg().background.gradient.colors || [];
    colors.forEach((color, n) => {
      const label = document.createElement('label'); label.textContent = t('Renk') + ' ' + (n + 1);
      const input = document.createElement('input'); input.type = 'color'; input.value = color;
      input.addEventListener('input', () => {
        const current = info(); if (!current || current.clipId !== i.clipId) return;
        P().cfg().background.gradient.colors[n] = input.value; P().push(true);
      });
      label.append(input); pane.append(label);
    });
  }

  /* Hedef bandı: hangi klibin düzenlendiği her panelde açıkça görünür. */
  function clipName(c) {
    const tp = window.SVTimelinePanel;
    return (tp && tp._clipLabel ? tp._clipLabel(c) : '') || c.name || c.ref || c.type;
  }
  function fmt(s) {
    const m = Math.floor(s / 60);
    const r = s - m * 60;
    return m + ':' + (r < 10 ? '0' : '') + r.toFixed(2);
  }
  function paintBanner() {
    if (typeof document === 'undefined' || !document.body || !document.createElement) return;
    let b = document.getElementById('tlEditBanner');
    const i = info();
    const on = P() && TC() && TC().modeOn(P().cfg());
    for (const id of ['svLayers', 'svInspector', 'svShelf']) {
      const pane = document.getElementById(id);
      if (pane) pane.inert = !!(on && (!i || (i.clip.type === 'palette' && id !== 'svInspector')));
    }
    if (document.body.classList) document.body.classList.toggle('tl-no-target', !!(on && !i));
    if (i && i.clip.type === 'palette') paletteInspector(i);
    if (!on) { if (b) b.hidden = true; document.body.classList && document.body.classList.remove('tl-editing'); return; }
    if (!b) {
      b = document.createElement('div');
      b.id = 'tlEditBanner';
      b.className = 'tl-edit-banner';
      b.setAttribute('role', 'status');
      // Üst bantlarla aynı yerde (çalışma alanının hemen üstünde): her sayfada görünür
      const ws = document.querySelector('.workspace');
      if (ws && ws.parentNode) ws.parentNode.insertBefore(b, ws);
      else document.body.insertBefore(b, document.body.firstChild);
    }
    b.hidden = false;
    if (document.body.classList) document.body.classList.add('tl-editing');
    b.textContent = '';
    if (!i) { b.textContent = t('Timeline açık: düzenlemek için tek bir görsel klip seçin. Elle ayarlar korunuyor.'); return; }
    const lab = document.createElement('span');
    lab.className = 'tl-eb-label';
    lab.textContent = t('Düzenlenen Timeline klibi');
    const name = document.createElement('b');
    name.className = 'tl-eb-name';
    name.textContent = clipName(i.clip);
    const meta = document.createElement('span');
    meta.className = 'tl-eb-meta';
    const tp = window.SVTimelinePanel;
    const content = i.clip.name && tp && tp._clipContentLabel ? ' · ' + tp._clipContentLabel(i.clip) : '';
    meta.textContent = (i.track.name || '') + ' · ' + fmt(i.clip.start) + '–' + fmt(i.clip.start + i.clip.dur) + content;
    meta.title = t('Klip kopyası varsa kaynak yerine kullanılır.');
    const note = document.createElement('span');
    note.className = 'tl-eb-note';
    note.textContent = notice || t('Değişiklikler yalnız bu klibe uygulanır; asıl sahne değişmez.');
    const done = document.createElement('button');
    done.type = 'button';
    done.className = 'btn small';
    done.textContent = t('Bitir');
    done.addEventListener('click', () => {
      const tp = window.SVTimelinePanel;
      if (tp && tp._select) tp._select(null);
      end();
      if (tp && tp._draw) tp._draw();
    });
    b.append(lab, name, meta, note, done);
    if (i.clip.type === 'palette') {
      const colors = P().cfg().background && P().cfg().background.gradient && P().cfg().background.gradient.colors || [];
      for (let n = 0; n < colors.length; n++) {
        const input = document.createElement('input'); input.type = 'color'; input.value = colors[n];
        input.setAttribute('aria-label', t('Renk') + ' ' + (n + 1));
        const id = i.clipId;
        input.addEventListener('input', () => {
          const now = info(); if (!now || now.clipId !== id) return; // eski hedefin callback'i
          P().cfg().background.gradient.colors[n] = input.value; P().push(true);
        });
        b.append(input);
      }
    }
  }

  const api = { capture: () => { const captured = generation; return () => captured === generation; }, manualWriting: () => manualDepth > 0, persistent, modeChanged, withManual, adoptIncoming, begin, end, follow, sync, reloadFromClip, recover, info, active: () => !!active(P() && P().cfg()), refresh: paintBanner, clear: () => end() };
  if (typeof window !== 'undefined') window.SVTimelineTarget = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})();
