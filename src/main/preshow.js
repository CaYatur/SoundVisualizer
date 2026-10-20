/*
 * SoundVisualizer — CaYaDev Ses Görselleştirici
 * Copyright (c) 2026 Çağan Turgut (CaYatur) — CaYaDev, https://cayadev.com
 * https://github.com/CaYatur/SoundVisualizer
 * SPDX-License-Identifier: MIT
 */
'use strict';
/* GÖSTERİ ÖNCESİ DENETİM (#545): kapılar açılmadan, bir şey bozulmadan
   önce "düzen hazır mı" tek sayfada.

   Saf kısım: ana süreç durumu toplar (ekranlar, ses, çıkışların kare hızı,
   yedeklilik, disk, sahnenin başvurduğu dosyalar), burada her denetim
   { id, state, text, parts } olur. state: ok | warn | fail | info.
   `text` çevrilebilir sabit cümle; sayılar ve adlar `parts` içinde ayrı
   (sözlük tam metin eşleştiriyor).

   GPU payı: ekran kartının doluluğu her sistemde okunamıyor; ölçülebilen
   şey çıkışın hedef kare hızını TUTUP TUTMADIĞI. Hedef ekranın yenileme
   hızı (kare sınırı varsa o); %90'ın altı uyarı. */

const Refs = require('../shared/preshow-refs');

function num(v, d) { const n = Number(v); return Number.isFinite(n) ? n : d; }

const MIN_FREE = 2 * 1024 * 1024 * 1024; // 2 GB: bir 1080p dışa aktarımın ara kopyası + video payı

/* Sahnenin başvurduğu kitaplık öğeleri (sahne + kayıtlı sahneler): logo
   kitaplığı kimlikleri, kullanıcı preset kimlikleri. Yerleriyle birlikte
   liste shared/preshow-refs.js `collect`'te. */
function references(cfg) {
  const all = Refs.collect(cfg);
  return {
    logos: all.filter((r) => r.kind === 'logo').map((r) => r.id),
    presets: all.filter((r) => r.kind === 'preset').map((r) => r.id),
  };
}

/* Eski girdi biçimi { media: [ad], logos: [kimlik], presets: [kimlik] }:
   yeri bilinmiyor, canlı sahnede sayılır. */
function missingItems(m) {
  if (Array.isArray(m)) return m;
  const o = m || {};
  const at = [{ scene: null, layer: null, field: '' }];
  return [].concat(
    (o.media || []).map((x) => ({ kind: 'media', id: x, name: x, reason: 'absent', where: at })),
    (o.logos || []).map((x) => ({ kind: 'logo', id: x, reason: 'absent', where: at })),
    (o.presets || []).map((x) => ({ kind: 'preset', id: x, reason: 'absent', where: at })),
  );
}

/* Denetimler. Girdi:
     displays: [{ id, label }]
     outputs: [{ displayId, label, fps, target, cap, hz, primaryHz, paused,
                 measuring, stale }]
       measuring — pencere ilk kare hızı ölçümünü henüz bitirmedi (ilk ~1 sn)
       stale     — pencere açık ama ölçer iletisi kesildi: çizmiyor
       hz — ekranın yenileme hızı; cap — kullanıcının kare sınırı
     sharedRate: { hz, label, primary } — Windows'ta bütün pencerelerin
       ortak hızı ve onu belirleyen ekran (yoksa çıkışların primaryHz'i)
     wantedDisplays: [id]   — ayarda çıkış için seçili ekranlar
     audio: { wanted, ageMs, level }
     redundancy: { role, state, peers, problem, show }
     disks: [{ label, free }]
     missing: [{ kind, id, name, path, reason, where }] (preshow-refs
       `collect` kayıtları + neden); eski biçim de kabul edilir
   Çıktıda bir denetim `items` (satır ayrıntısı) ve `hint` (düzeltme önerisi,
   sabit çevrilebilir cümle) taşıyabilir. */
function evaluate(input) {
  const o = input || {};
  const out = [];
  const add = (id, state, text, parts, extra) => out.push(Object.assign({ id, state, text, parts: parts || [] }, extra || {}));

  // --- Ekranlar ---
  const displays = Array.isArray(o.displays) ? o.displays : [];
  const ids = new Set(displays.map((d) => String(d.id)));
  const wanted = (Array.isArray(o.wantedDisplays) ? o.wantedDisplays : []).map(String);
  const gone = wanted.filter((id) => !ids.has(id));
  if (gone.length) add('displays', 'fail', 'Çıkış için seçili ekran bağlı değil', [String(gone.length)]);
  else add('displays', 'ok', 'Ekranlar bağlı', [String(displays.length)]);

  // --- Çıkışlar ve kare hızı ---
  const outputs = Array.isArray(o.outputs) ? o.outputs : [];
  if (!outputs.length) {
    add('outputs', wanted.length ? 'warn' : 'info', 'Açık çıkış penceresi yok');
  } else {
    // Her çıkış kendi satırında: hangi ekran, kaç fps, hedef ne
    const items = outputs.map((w) => {
      const fps = num(w.fps, 0);
      const target = num(w.target, 60);
      let state = 'ok';
      if (w.stale) state = 'fail';
      else if (w.measuring || w.paused) state = 'info';
      else if (target > 0 && fps / target < 0.9) state = 'warn';
      return {
        label: w.label || String(w.displayId), fps: Math.round(fps), target: Math.round(target),
        hz: num(w.hz, 0), state, measuring: !!w.measuring, paused: !!w.paused, stale: !!w.stale,
      };
    });
    const rate = (it) => it.fps + ' / ' + it.target + ' fps';
    const measured = items.filter((it) => it.state !== 'info');
    const worst = measured.slice().sort((a, b) => (a.target ? a.fps / a.target : 1) - (b.target ? b.fps / b.target : 1))[0];
    const extra = { items };
    if (items.some((it) => it.stale)) {
      add('outputs', 'fail', 'Bir çıkış çizmiyor: pencere küçültülmüş, örtülü ya da gizli olabilir',
        items.filter((it) => it.stale).map((it) => it.label), extra);
    } else if (worst && worst.state === 'warn') {
      add('outputs', 'warn', 'Bir çıkış hedef kare hızının altında', [rate(worst)], extra);
    } else if (worst) {
      add('outputs', 'ok', 'Çıkışlar hedef kare hızında', [String(outputs.length), rate(worst)], extra);
    } else if (items.some((it) => it.measuring)) {
      add('outputs', 'info', 'Çıkışların kare hızı ölçülüyor', [], extra);
    } else {
      add('outputs', 'info', 'Çıkışlar sessizlikte duraklatılmış', [], extra);
    }
    /* Ekran ortak hızdan hızlıysa: Windows'ta Chromium bütün pencereleri tek
       dikey senkronla çiziyor — birincil ekranın ve açık çıkışların en
       yavaşı (ölçümler main.js sharedOutputRate'te). Hedef doğru; kullanıcı
       ekranın kendi hızını bekliyor, nedeni ve sınırlayan ekran burada.
       `sharedRate` yoksa eski girdi: her çıkışın `primaryHz`'i. */
    const sr = o.sharedRate && num(o.sharedRate.hz, 0) > 0 ? o.sharedRate : null;
    const limitOf = (w) => (sr ? num(sr.hz, 0) : num(w.primaryHz, 0));
    // Kullanıcının kendi kare sınırı ortak hızın altındaysa sınır o: satır yok
    const capped = outputs.filter((w) => limitOf(w) > 0 && num(w.hz, 0) > limitOf(w) + 1 &&
      !(num(w.cap, 0) > 0 && num(w.cap, 0) <= limitOf(w)));
    if (capped.length) {
      const byOutput = sr && !sr.primary;
      add('refresh', 'info', 'Windows bütün çıkış pencerelerini tek hızda çiziyor: birincil ekranın ve açık çıkışların en yavaşı',
        capped.map((w) => (w.label || String(w.displayId)) + ': ' + Math.round(num(w.hz, 0)) + ' Hz → ' + Math.round(limitOf(w)) + ' fps'),
        {
          limiter: sr ? { label: sr.label || '', hz: Math.round(num(sr.hz, 0)), primary: !!sr.primary } : null,
          hint: byOutput
            ? 'Hızı en yavaş çıkış belirliyor. Hızlı ekranların kendi hızında çizmesi için o ekrandaki çıkışı kapatın ya da daha hızlı bir ekrana taşıyın.'
            : 'Hızı birincil ekran belirliyor. Daha yüksek kare hızı için hızlı ekranı Windows ekran ayarlarında ana ekran yapmayı deneyin.',
        });
    }
  }

  // --- Ses ---
  const a = o.audio || {};
  if (!a.wanted) add('audio', 'info', 'Ses yakalama beklemede: açık çıkış yok');
  else if (!(num(a.ageMs, Infinity) < 2000)) add('audio', 'fail', 'Ses gelmiyor: seçili aygıt yok ya da yakalama durdu');
  else if (num(a.level, 0) < 0.002) add('audio', 'warn', 'Ses geliyor ama sessiz');
  else add('audio', 'ok', 'Ses geliyor');

  // --- Sahnenin dosyaları ---
  /* Canlı sahnede eksik dosya gösteriyi bozar (hazır değil); yalnız kayıtlı
     bir sahnede eksikse o sahne açılana kadar sorun yok (uyarı). Eskiden
     eski bir deneme sahnesi bütün düzeni "hazır değil" yapıyordu. */
  const missing = missingItems(o.missing);
  const liveMissing = missing.filter((r) => Refs.live(r));
  const short = (r) => r.name || r.id;
  if (liveMissing.length) {
    add('files', 'fail', 'Canlı sahnenin başvurduğu dosyalar eksik', [String(liveMissing.length)].concat(liveMissing.slice(0, 4).map(short)), { items: missing });
  } else if (missing.length) {
    add('files', 'warn', 'Kayıtlı sahnelerde eksik dosya var', [String(missing.length)].concat(missing.slice(0, 4).map(short)), { items: missing });
  } else {
    add('files', 'ok', 'Sahnenin dosyaları yerinde');
  }

  // --- Yedeklilik ---
  const r = o.redundancy || {};
  if (!r.role || r.role === 'off') add('redundancy', 'info', 'Yedeklilik kapalı');
  else if (r.problem) add('redundancy', 'fail', 'Yedeklilik ayarı eksik');
  else if (r.role === 'primary') {
    if (!r.peers) add('redundancy', 'fail', 'Yedek bağlı değil');
    else if (r.show && r.show.differences > 0) add('redundancy', 'warn', 'Yedek bağlı, gösteriler farklı', [String(r.show.differences)]);
    else if (!r.show) add('redundancy', 'warn', 'Yedek bağlı, gösteri karşılaştırması bekleniyor');
    else add('redundancy', 'ok', 'Yedek bağlı, gösteriler aynı');
  } else {
    const st = r.state;
    if (st === 'following') add('redundancy', 'ok', 'Birincili izliyor');
    else if (st === 'active') add('redundancy', 'warn', 'Yetki bu makinede (yedek)');
    else add('redundancy', 'fail', 'Birincile ulaşılamıyor');
  }

  // --- Ses köprüsü (#813): yalnız ses girişi köprüdeyken; etkin kaynak ---
  const b = o.bridge || null;
  if (b && b.receive) {
    if (b.problem) add('bridge', 'fail', 'Ses köprüsü ayarı eksik');
    else if (b.state === 'bridge') add('bridge', 'ok', 'Ses köprüden', b.from ? [String(b.from)] : undefined);
    // Etkin kaynak: olağan giriş ya da ayrı yedek aygıt (mikser split)
    else if (b.state === 'fallback') add('bridge', 'warn', b.fallbackSource ? 'Ses köprüsü sessiz: yedek giriş' : 'Ses köprüsü sessiz: yerel giriş', b.fallbackSource ? [String(b.fallbackSource)] : undefined);
    else add('bridge', b.fallback === false ? 'fail' : 'warn', 'Ses köprüsü bekleniyor');
  }

  // --- Disk ---
  const low = (Array.isArray(o.disks) ? o.disks : []).filter((d) => num(d.free, Infinity) < MIN_FREE);
  if (low.length) add('disk', 'warn', 'Diskte yer az', low.map((d) => d.label + ': ' + (Math.round(num(d.free, 0) / 1e8) / 10) + ' GB'));
  else add('disk', 'ok', 'Diskte yer var');

  const rank = { fail: 3, warn: 2, info: 1, ok: 0 };
  const overall = out.reduce((acc, c) => (rank[c.state] > rank[acc] ? c.state : acc), 'ok');
  return { overall: overall === 'info' ? 'ok' : overall, checks: out };
}

module.exports = { references, evaluate, missingItems, MIN_FREE };
