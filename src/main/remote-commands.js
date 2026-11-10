/*
 * SoundVisualizer — CaYaDev Ses Görselleştirici
 * Copyright (c) 2026 Çağan Turgut (CaYatur) — CaYaDev, https://cayadev.com
 * https://github.com/CaYatur/SoundVisualizer
 * SPDX-License-Identifier: MIT
 */
'use strict';
/* UZAKTAN KUMANDANIN KOMUTLARI (#443): saf doğrulama, ağ ve pencere yok.

   Kumandadan gelen her ileti VERİDİR. Burada iki yeni tür doğrulanır; uygulamayı panel yapar:

   osc — sabit denetim ağacı (shared/osc-tree.js). OSC, MQTT ve Companion ile aynı adresler ve
         aynı aralıklar; kumandaya özel bir yazma yolu yok. Adres önek olmadan gelir
         ('show/opacity'), uygulamanın öneki burada eklenir. İleti ağacın KENDİ planlayıcısından
         geçmezse (bilinmeyen adres, yanlış tür, olmayan katman) atılır; değeri de o sıkıştırır.
         OSC girişi kapalıyken de çalışır: kumandanın izni yayın sunucusunun kumanda jetonudur.

   run — panelin adlı eylemleri (control.js runAction), gösteride işe yarayan kısa bir listeden.
         Yedeklilik devri, deste yuvaları ve sprite komutları bilerek yok.

   İleride telefon uygulaması ve sahne/sunum araçları aynı iletileri kullanır; yüzey buradan
   büyür, her yeni adres önce ağaca girer. */

const ACTIONS = Object.freeze([
  'nextScene', 'nextPalette', 'nextVisualizer', 'prevVisualizer', 'nextBackground',
  'tlPlay', 'tlPause', 'tlStop', 'tlNextMarker', 'tlPrevMarker', 'deckStopAll',
  'mdNext', 'mdPrev', 'mdRandom',
]);

const PATH_RE = /^[a-z0-9]+(\/[a-z0-9]+){0,3}$/i;

function actionAllowed(id) {
  return typeof id === 'string' && ACTIONS.indexOf(id) >= 0;
}

/* { path, args } → { address, args } ya da null. `tree`: shared/osc-tree.js. */
function oscMessage(msg, cfg, tree) {
  if (!msg || !tree) return null;
  const p = typeof msg.path === 'string' ? msg.path : '';
  if (p.length > 64 || !PATH_RE.test(p)) return null;
  const args = Array.isArray(msg.args) ? msg.args : [];
  if (args.length > 4) return null;
  for (const a of args) {
    if (typeof a === 'number') { if (!Number.isFinite(a)) return null; }
    else if (typeof a === 'string') { if (a.length > 255) return null; }
    else if (typeof a !== 'boolean') return null;
  }
  const out = { address: tree.prefixOf(cfg) + '/' + p, args: args.slice() };
  let planned;
  try { planned = tree.plan([out], cfg); } catch { return null; }
  return planned && Array.isArray(planned.consumed) && planned.consumed.length === 1 ? out : null;
}

/* Kumandanın canlı özeti: yapılandırmada olmayan, saniyede birkaç kez değişen şeyler.
   `ctx`: main.js oscOutContext(); `meter`: son ölçüm ({ level, bass, mid, treble, at }). Ölçüm
   1,5 saniyeden eskiyse seviye sıfır sayılır (ses durdu, son değer asılı kalmasın). */
function liveState(ctx, meter, now) {
  const c = ctx || {};
  const m = meter || {};
  const show = c.show || {};
  const fresh = (now || Date.now()) - (Number(m.at) || 0) < 1500;
  const lv = (v) => (fresh && Number.isFinite(v) ? Math.round(Math.max(0, Math.min(1, v)) * 100) / 100 : 0);
  return {
    level: lv(m.level), bass: lv(m.bass), mid: lv(m.mid), treble: lv(m.treble),
    bpm: Number.isFinite(c.bpm) && c.bpm > 0 ? Math.round(c.bpm * 10) / 10 : 0,
    timeline: show.timeline === true,
    blackout: show.blackout === true,
  };
}

module.exports = { ACTIONS, actionAllowed, oscMessage, liveState };
