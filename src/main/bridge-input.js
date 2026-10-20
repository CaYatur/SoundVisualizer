/*
 * SoundVisualizer — CaYaDev Ses Görselleştirici
 * Copyright (c) 2026 Çağan Turgut (CaYatur) — CaYaDev, https://cayadev.com
 * https://github.com/CaYatur/SoundVisualizer
 * SPDX-License-Identifier: MIT
 */
'use strict';
/* "AĞ KÖPRÜSÜ" SES GİRİŞİNİN GEÇİŞ MAKİNESİ (#813). Saf: saat dışarıdan.

     waiting   köprüden henüz kare yok. Yedek giriş açıksa yerel giriş çalışır.
     bridge    köprünün kareleri kullanılıyor; yerel yakalama kapalı (aygıtı
               boşuna tutmasın, aynı aygıtı köprü kullanıyor olabilir).
     fallback  köprü `lossMs` boyunca sessiz kaldı: yerel girişe dönüldü.

   Geri dönüş titremesin diye köprü `recoverMs` boyunca kesintisiz (iki kare
   arası `lossMs`'ten kısa) kare vermeden köprüye geçilmez. İlk bağlantıda
   aynı kural, daha kısa süreyle (`firstMs`).

   Çıktılar: `useBridge` (kareler köprüden) ve `wantLocal` (yerel yakalama
   gerekli). Yedek giriş kapalıysa köprü kesilince ses de kesilir —
   operatörün açıkça seçtiği davranış. */

function createInputSwitch(opts) {
  /* recoverMs 2 sn idi; Windows'ta köprü yeniden açılınca giriş 5-6 sn
     sonra dönüyordu (#813). 0,5 sn kesintisiz kare (~35 kare) titremeyi
     önlemeye yetiyor. */
  const o = Object.assign({ lossMs: 600, recoverMs: 500, firstMs: 300, fallback: true }, opts || {});
  let state = 'waiting';
  let lastFrame = null;
  let runStart = 0; // kesintisiz kare dizisinin başı
  let everBridged = false;
  let switches = 0;
  let since = 0;
  let graceUntil = 0; // köprü kaynak değiştiriyor: bu ana dek yedeğe dönülmez

  function set(next, now) {
    if (next === state) return false;
    state = next;
    since = now;
    switches++;
    return true;
  }

  return {
    // Köprüden kare geldi. Dönüş: durum değişti mi
    frame(now) {
      if (lastFrame == null || now - lastFrame > o.lossMs) runStart = now;
      lastFrame = now;
      if (state === 'bridge') return false;
      const need = everBridged ? o.recoverMs : o.firstMs;
      if (now - runStart >= need) {
        everBridged = true;
        return set('bridge', now);
      }
      return false;
    },
    // Düzenli denetim (ör. 100 ms). Dönüş: durum değişti mi
    tick(now) {
      if (now < graceUntil) return false;
      // Hoşgörü bitince boşluk o andan sayılır: kare gelmezse lossMs sonra yedek
      if (state === 'bridge' && lastFrame != null && now - Math.max(lastFrame, graceUntil) > o.lossMs) return set(everBridged ? 'fallback' : 'waiting', now);
      return false;
    },
    configure(next) { Object.assign(o, next || {}); },
    /* Köprü kaynağını değiştiriyor (#813): yakalama yardımcısı yeniden
       kurulurken kısa bir kare boşluğu olur; alıcı o arada yedeğe dönüp geri
       gelmesin. En çok 5 sn. */
    hold(now, ms) { graceUntil = Math.max(graceUntil, now + Math.max(0, Math.min(5000, Number(ms) || 0))); },
    get state() { return state; },
    get useBridge() { return state === 'bridge'; },
    get wantLocal() { return state !== 'bridge' && o.fallback !== false; },
    status(now) {
      return {
        state, since, switches, holding: (now || 0) < graceUntil,
        fallback: o.fallback !== false,
        silentMs: lastFrame != null ? Math.max(0, (now || 0) - lastFrame) : null,
      };
    },
  };
}

module.exports = { createInputSwitch };
