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

function num(v, d) { const n = Number(v); return Number.isFinite(n) ? n : d; }

const MIN_FREE = 2 * 1024 * 1024 * 1024; // 2 GB: bir 1080p dışa aktarımın ara kopyası + video payı

/* Sahnenin başvurduğu dosyalar ve kitaplık öğeleri (sahne + kayıtlı
   sahneler): logo kitaplığı kimlikleri, kullanıcı preset kimlikleri. */
function references(cfg) {
  const logos = new Set();
  const presets = new Set();
  const visit = (c) => {
    if (!c || typeof c !== 'object') return;
    const lg = c.logo;
    if (lg && lg.libraryId) logos.add(lg.libraryId);
    if (lg && lg.swap && Array.isArray(lg.swap.items)) lg.swap.items.forEach((x) => typeof x === 'string' && logos.add(x));
    const cu = c.custom || {};
    [cu.visualizerId, cu.backgroundId].forEach((x) => { if (typeof x === 'string' && x) presets.add(x); });
    (Array.isArray(c.layers) ? c.layers : []).forEach((l) => {
      if (!l) return;
      if (typeof l.presetId === 'string' && l.presetId) presets.add(l.presetId);
      const ll = l.settings && l.settings.logo;
      if (ll && ll.libraryId) logos.add(ll.libraryId);
      if (ll && ll.swap && Array.isArray(ll.swap.items)) ll.swap.items.forEach((x) => typeof x === 'string' && logos.add(x));
    });
  };
  visit(cfg);
  for (const sc of (cfg && Array.isArray(cfg.scenes) ? cfg.scenes : [])) visit(sc && sc.data);
  // Yerleşik presetler koddan gelir; yalnız kullanıcı presetleri (usr_) denetlenir
  return { logos: [...logos], presets: [...presets].filter((x) => /^usr_/.test(x)) };
}

/* Denetimler. Girdi:
     displays: [{ id, label }], outputs: [{ displayId, fps, target, paused }]
     wantedDisplays: [id]   — ayarda çıkış için seçili ekranlar
     audio: { wanted, ageMs, level }
     redundancy: { role, state, peers, problem, show }
     disks: [{ label, free }]
     missing: { media: [ad], logos: [ad], presets: [kimlik] } */
function evaluate(input) {
  const o = input || {};
  const out = [];
  const add = (id, state, text, parts) => out.push({ id, state, text, parts: parts || [] });

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
    let worst = null;
    for (const w of outputs) {
      if (w.paused) continue;
      const target = num(w.target, 60);
      const ratio = target > 0 ? num(w.fps, 0) / target : 1;
      if (!worst || ratio < worst.ratio) worst = { ratio, fps: num(w.fps, 0), target };
    }
    if (!worst) add('outputs', 'info', 'Çıkışlar sessizlikte duraklatılmış');
    else if (worst.ratio < 0.9) add('outputs', 'warn', 'Bir çıkış hedef kare hızının altında', [Math.round(worst.fps) + ' / ' + Math.round(worst.target) + ' fps']);
    else add('outputs', 'ok', 'Çıkışlar hedef kare hızında', [String(outputs.length), Math.round(worst.fps) + ' / ' + Math.round(worst.target) + ' fps']);
  }

  // --- Ses ---
  const a = o.audio || {};
  if (!a.wanted) add('audio', 'info', 'Ses yakalama beklemede: açık çıkış yok');
  else if (!(num(a.ageMs, Infinity) < 2000)) add('audio', 'fail', 'Ses gelmiyor: seçili aygıt yok ya da yakalama durdu');
  else if (num(a.level, 0) < 0.002) add('audio', 'warn', 'Ses geliyor ama sessiz');
  else add('audio', 'ok', 'Ses geliyor');

  // --- Sahnenin dosyaları ---
  const m = o.missing || {};
  const nMissing = (m.media || []).length + (m.logos || []).length + (m.presets || []).length;
  if (nMissing) add('files', 'fail', 'Sahnenin başvurduğu dosyalar eksik', [String(nMissing)].concat((m.media || []).concat(m.logos || [], m.presets || []).slice(0, 8)));
  else add('files', 'ok', 'Sahnenin dosyaları yerinde');

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

  // --- Disk ---
  const low = (Array.isArray(o.disks) ? o.disks : []).filter((d) => num(d.free, Infinity) < MIN_FREE);
  if (low.length) add('disk', 'warn', 'Diskte yer az', low.map((d) => d.label + ': ' + (Math.round(num(d.free, 0) / 1e8) / 10) + ' GB'));
  else add('disk', 'ok', 'Diskte yer var');

  const rank = { fail: 3, warn: 2, info: 1, ok: 0 };
  const overall = out.reduce((acc, c) => (rank[c.state] > rank[acc] ? c.state : acc), 'ok');
  return { overall: overall === 'info' ? 'ok' : overall, checks: out };
}

module.exports = { references, evaluate, MIN_FREE };
