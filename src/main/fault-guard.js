/*
 * SoundVisualizer — CaYaDev Ses Görselleştirici
 * Copyright (c) 2026 Çağan Turgut (CaYatur) — CaYaDev, https://cayadev.com
 * https://github.com/CaYatur/SoundVisualizer
 * SPDX-License-Identifier: MIT
 */
'use strict';
/* Ana süreçte yakalanmamış hata.

   Electron'un varsayılanı modal bir hata kutusu: kutu kapanana dek ana
   iş parçacığı durur. Ses kareleri pencerelere gitmez, panel ve kumanda
   yanıt vermez; canlı gösteride ekran donar ve kimse bilgisayarın başında
   olmayabilir. Yayın sunucusunda reddedilen bir istemcinin sert kopuşu
   bunu canlıda yaptı (#695).

   Burada hata kaydedilir ve panel kısa bir uyarı gösterir; uygulama
   çalışmaya devam eder. Electron kendi kutusunu yalnız başka dinleyici
   yokken açar. Panel penceresi yoksa (açılış sırasında) eski kutu
   gösterilir: aksi halde yarım açılmış, görünmeyen bir uygulama kalırdı.

   Aynı hata saniyede onlarca kez gelebilir (ses yolu ~70 Hz); uyarı aynı
   ileti için en çok notifyEveryMs'de bir verilir. İşleyici hiçbir koşulda
   kendisi hata atmaz. */

function safe(fn) {
  try { return fn(); } catch { return undefined; }
}

function createFaultGuard(opts) {
  const o = opts || {};
  const now = typeof o.now === 'function' ? o.now : Date.now;
  const notifyEveryMs = o.notifyEveryMs > 0 ? o.notifyEveryMs : 30000;
  const maxKeys = 50;
  const seen = new Map();
  const recorded = [];

  function handle(err, origin) {
    try {
      const e = err instanceof Error ? err : new Error(String(err));
      const key = String((e.name || 'Error') + ': ' + (e.message || '')).slice(0, 300);
      let rec = seen.get(key);
      if (!rec) {
        if (seen.size >= maxKeys) seen.delete(seen.keys().next().value);
        rec = { count: 0, at: -Infinity };
        seen.set(key, rec);
      }
      rec.count += 1;
      if (recorded.length < 100) recorded.push(key);
      safe(() => o.log && o.log(key, String(e.stack || key), rec.count, origin || ''));
      const t = now();
      if (t - rec.at < notifyEveryMs) return 'quiet';
      rec.at = t;
      if (safe(() => o.hasWindow && o.hasWindow())) {
        safe(() => o.notify && o.notify(key, rec.count));
        return 'notified';
      }
      safe(() => o.fallback && o.fallback(key, String(e.stack || key)));
      return 'fallback';
    } catch {
      return 'failed';
    }
  }

  return {
    handle,
    /* Öz test bunları hata sayar: işleyici başarısız bir koşuyu PASS'e
       çevirmemeli. */
    errors: () => recorded.slice(),
  };
}

/* Kayıt dosyası yalnız hata olunca yazılır; temiz koşu kullanıcı verisine
   dokunmaz. Boyutu sınırlı: dolunca bir önceki .old olur. */
function appendCapped(fs, file, text, maxBytes) {
  try {
    const st = fs.statSync(file);
    if (st.size + text.length > maxBytes) fs.renameSync(file, file + '.old');
  } catch { /* dosya henüz yok */ }
  fs.appendFileSync(file, text, 'utf8');
}

module.exports = { createFaultGuard, appendCapped };
