/*
 * SoundVisualizer — CaYaDev Ses Görselleştirici
 * Copyright (c) 2026 Çağan Turgut (CaYatur) — CaYaDev, https://cayadev.com
 * https://github.com/CaYatur/SoundVisualizer
 * SPDX-License-Identifier: MIT
 */
'use strict';
/* TELEFON BAĞLANTISININ CANLI DENETİMİ (B2, docs/PHONE-LINK.md). Saf doğrulama: ağ, pencere yok.

   Telefondan gelen her istek VERİDİR. Burada denetlenir ve panelin uygulayacağı biçime çevrilir:
     { kind: 'osc', message }   sabit OSC ağacının iletisi (shared/osc-tree.js). Ağaç aralığı kendisi
                                sıkıştırır; ağacın tutmadığı ileti reddedilir.
     { kind: 'panel', op, args } ağacın kapsamadığı işler (sahne kimliğiyle, anlık efekt, makro,
                                tempo, MilkDrop gezintisi, çizelge taşıması). Panelde tek giriş:
                                src/admin/link-live.js SVLinkLive.run.

   KURAL: ağ üstünden gelen işlem MUTLAK olmalı. "Karartmayı değiştir" yerine "karartma açık/kapalı":
   yeniden denenen istek ya da aynı anda basan iki telefon ters yöne çevirmesin. */

const MOMENTARY = Object.freeze(['flash', 'strobe', 'blur', 'kaleido', 'glitch', 'negative']);
const MD_NAV = Object.freeze(['next', 'prev', 'random']);
const TL_ACTIONS = Object.freeze(['play', 'pause', 'stop', 'next', 'prev', 'seek']);
const MACROS = 8;
// Panelin "BPM Kilidi" kaydırıcısıyla aynı aralık (autovj.js); 0 = müzikten bul
const BPM_MIN = 30;
const BPM_MAX = 200;
const ID_RE = /^[A-Za-z0-9_.:-]{1,80}$/;

function bad() { const e = new Error('bad-args'); e.code = 'bad-args'; return e; }
const num = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : null);
const clamp01 = (v) => Math.max(0, Math.min(1, v));
const int = (v, lo, hi) => (Number.isInteger(v) && v >= lo && v <= hi ? v : null);

/* (op, args, cfg, tree, actions) → plan ya da Error('bad-args'). `tree`: shared/osc-tree.js,
   `actions`: remote-commands ACTIONS (adlı eylemlerin izin listesi). */
function plan(op, args, cfg, tree, actions) {
  const a = args && typeof args === 'object' ? args : {};
  const osc = (path, list) => {
    const out = { address: tree.prefixOf(cfg) + '/' + path, args: list };
    let p;
    try { p = tree.plan([out], cfg); } catch { throw bad(); }
    if (!p || !Array.isArray(p.consumed) || p.consumed.length !== 1) throw bad();
    return { kind: 'osc', message: out };
  };
  const panel = (name, x) => ({ kind: 'panel', op: name, args: x || {} });

  switch (op) {
    case 'scene.apply': {
      const id = typeof a.id === 'string' && ID_RE.test(a.id) ? a.id : null;
      if (!id || !(cfg.scenes || []).some((s) => s && s.id === id)) throw bad();
      return panel('scene', { id });
    }
    case 'cue.set': {
      // Sıradaki sahne (T-bar ve AL). Boş = sırayı temizle
      if (a.id === '' || a.id == null) return panel('cue', { id: '' });
      const id = typeof a.id === 'string' && ID_RE.test(a.id) ? a.id : null;
      if (!id || !(cfg.scenes || []).some((s) => s && s.id === id)) throw bad();
      return panel('cue', { id });
    }
    case 'blackout': {
      if (typeof a.on !== 'boolean') throw bad();
      return osc('show/blackout', [a.on ? 1 : 0]);
    }
    case 'tbar': {
      // { take: true } AL düğmesi; { v } çubuğun mutlak konumu (0 alt, 1 üst).
      // { down } telefonun parmağı: basılıyken çubuk canlı izler, bırakınca biter.
      // Yoksa OSC (MIDI, Companion): her ileti kendi başına bir konumdur.
      if (a.take === true) return panel('take', {});
      const v = num(a.v);
      if (v == null) throw bad();
      if (a.down === true || a.down === false) return panel('tbar', { v: clamp01(v), down: a.down });
      return osc('show/tbar', [clamp01(v)]);
    }
    case 'master.set': {
      const v = num(a.v);
      if (v == null) throw bad();
      return osc('show/opacity', [clamp01(v)]);
    }
    case 'mixer.set': {
      // Katman kanalı: 1'den başlayan sıra (OSC ağacıyla aynı), saydamlık ya da açık/kapalı
      const n = int(a.layer, 1, 32);
      if (n == null) throw bad();
      if (typeof a.enabled === 'boolean') return osc('layer/' + n + '/enabled', [a.enabled ? 1 : 0]);
      const v = num(a.opacity);
      if (v == null) throw bad();
      return osc('layer/' + n + '/opacity', [clamp01(v)]);
    }
    case 'momentary': {
      // Telefonun BASILI tuttuğu efektlerin tam listesi (kira: ~0,5 sn'de bir yenilenir)
      if (!Array.isArray(a.list) || a.list.length > MOMENTARY.length) throw bad();
      const ids = [];
      for (const x of a.list) {
        if (typeof x !== 'string' || MOMENTARY.indexOf(x) < 0) throw bad();
        if (ids.indexOf(x) < 0) ids.push(x);
      }
      return panel('momentary', { list: ids });
    }
    case 'deck.trigger': {
      const row = int(a.row, 0, 64);
      const col = int(a.col, 0, 64);
      if (row == null || col == null) throw bad();
      return osc('deck/launch', [row, col]);
    }
    case 'deck.stop': {
      if (a.col == null) return osc('deck/stop', [1]);
      const col = int(a.col, 0, 64);
      if (col == null) throw bad();
      return panel('deckStopColumn', { col });
    }
    case 'macro.set': {
      const i = int(a.i, 0, MACROS - 1);
      const v = num(a.v);
      if (i == null || v == null) throw bad();
      return panel('macro', { i, v: clamp01(v) });
    }
    case 'tempo.set': {
      // Vuruş zamanı telefonda ölçülür (Wi-Fi gecikmesi bilgisayarda ölçmeyi bozar); gelen sonuç
      const b = num(a.bpm);
      if (b == null || b < 0) throw bad();
      return panel('tempo', { bpm: b === 0 ? 0 : Math.round(Math.max(BPM_MIN, Math.min(BPM_MAX, b))) });
    }
    case 'tempo.tap':
      return panel('tap', {});
    case 'autovj.toggle': {
      if (typeof a.on !== 'boolean') throw bad();
      return osc('show/autovj', [a.on ? 1 : 0]);
    }
    case 'milkdrop.nav': {
      if (MD_NAV.indexOf(a.dir) < 0) throw bad();
      return panel('milkdrop', { dir: a.dir });
    }
    case 'timeline.transport': {
      if (TL_ACTIONS.indexOf(a.action) < 0) throw bad();
      if (a.action === 'seek') {
        const t = num(a.t);
        if (t == null || t < 0 || t > 24 * 3600) throw bad();
        return panel('timeline', { action: 'seek', t });
      }
      return panel('timeline', { action: a.action });
    }
    case 'run': {
      if (typeof a.id !== 'string' || !actions || actions.indexOf(a.id) < 0) throw bad();
      return panel('run', { id: a.id });
    }
    default:
      throw bad();
  }
}

/* Ayarın telefona giden kopyası: yalnız ana makinede anlamlı alanlar (jetonlar, yollar, bu
   makinenin bağlantı anahtarları) çıkarılır. Telefon bunları göremez, yazamaz (link-guard). */
const PRIVATE_KEYS = Object.freeze(['phoneLink', 'mcp', 'stream', 'redundancy', 'updates', 'mqtt', 'bridge', '_lastPaths']);
function publicConfig(cfg) {
  const out = {};
  for (const k of Object.keys(cfg || {})) {
    if (PRIVATE_KEYS.indexOf(k) >= 0) continue;
    out[k] = cfg[k];
  }
  return out;
}

module.exports = { MOMENTARY, MD_NAV, TL_ACTIONS, MACROS, BPM_MIN, BPM_MAX, PRIVATE_KEYS, plan, publicConfig };
