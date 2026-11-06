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

  const EDITABLE = { scene: 1, preset: 1, visualizer: 1, video: 1, image: 1, shader: 1 };

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
    if (!tgt) return false;
    const hit = findClip(cfg, tgt);
    if (!hit) return false; // silinmiş: reloadFromClip/commit oturumu kapatır
    const C = TC();
    if (!C || !EDITABLE[hit.clip.type]) return false;
    if (C.dropStaleLocal(hit.clip) || !hit.clip.local) return false; // tür/kaynak değişti: yeniden yüklenecek
    /* YERİNDE yaz: çizelge modeli aynı `data` nesnesini paylaşıyor; yeni
       nesne atansaydı modelin sonraki commit'i eski kopyayı geri yazardı. */
    const data = hit.clip.local.data;
    const next = snapScene(cfg);
    for (const k of Object.keys(data)) if (!(k in next)) delete data[k];
    Object.assign(data, next);
    data.layerStack = Object.assign({}, data.layerStack, { enabled: true });
    return true;
  }

  function scopeUndo(key) {
    const u = window.SVUndoHistory;
    if (u && u.scope) u.scope(key);
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
    const tl = tlOf(cfg);
    loadScene(cfg, tl.manualBaseline);
    delete tl.manualBaseline;
    delete tl.editTarget;
    scopeUndo('');
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
    if (cur && cur.trackId === trackId && cur.clipId === clipId) { paintBanner(); return true; }
    if (cur) end({ silent: true });
    const hit = findClip(cfg, { trackId, clipId });
    if (!hit || !EDITABLE[hit.clip.type]) { rerender(); p.push(true); return false; }
    C.dropStaleLocal(hit.clip);
    const loc = C.ensureLocal(cfg, hit.clip);
    if (!loc) {
      // Kaynak sahne silinmiş / bulunamıyor: düzenlenecek bir şey yok
      if (p.toast) p.toast(t('Klibin kaynağı bulunamadı; düzenlenemez.'), 'warn');
      rerender(); p.push(true);
      return false;
    }
    const tl = tlOf(cfg);
    tl.manualBaseline = snapScene(cfg);
    tl.editTarget = { trackId, clipId };
    loadScene(cfg, loc.data);
    if (cfg.layerStack) cfg.layerStack.enabled = true;
    scopeUndo('clip:' + clipId);
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
    const C = TC();
    const stale = C.dropStaleLocal(hit.clip);
    if (!force && !stale && !(EDITABLE[hit.clip.type])) { end(); return; }
    if (!force && !stale) return;
    if (!EDITABLE[hit.clip.type]) { end(); return; }
    const loc = C.ensureLocal(cfg, hit.clip);
    if (!loc) { end(); return; }
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
    if (!i) { if (b) b.hidden = true; document.body.classList && document.body.classList.remove('tl-editing'); return; }
    if (!b) {
      b = document.createElement('div');
      b.id = 'tlEditBanner';
      b.className = 'tl-edit-banner';
      b.setAttribute('role', 'status');
      const host = document.querySelector('.work') || document.body;
      host.insertBefore(b, host.firstChild);
    }
    b.hidden = false;
    if (document.body.classList) document.body.classList.add('tl-editing');
    b.textContent = '';
    const lab = document.createElement('span');
    lab.className = 'tl-eb-label';
    lab.textContent = t('Düzenlenen Timeline klibi');
    const name = document.createElement('b');
    name.className = 'tl-eb-name';
    name.textContent = clipName(i.clip);
    const meta = document.createElement('span');
    meta.className = 'tl-eb-meta';
    meta.textContent = (i.track.name || '') + ' · ' + fmt(i.clip.start) + '–' + fmt(i.clip.start + i.clip.dur);
    const note = document.createElement('span');
    note.className = 'tl-eb-note';
    note.textContent = t('Değişiklikler yalnız bu klibe uygulanır; asıl sahne değişmez.');
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
  }

  const api = { begin, end, follow, sync, reloadFromClip, recover, info, active: () => !!active(P() && P().cfg()), refresh: paintBanner, clear: () => end() };
  if (typeof window !== 'undefined') window.SVTimelineTarget = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})();
