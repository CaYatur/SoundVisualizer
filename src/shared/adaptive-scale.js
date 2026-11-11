/*
 * SoundVisualizer — CaYaDev Ses Görselleştirici
 * Copyright (c) 2026 Çağan Turgut (CaYatur) — CaYaDev, https://cayadev.com
 * https://github.com/CaYatur/SoundVisualizer
 * SPDX-License-Identifier: MIT
 */
'use strict';
/* UYARLANIR ÇÖZÜNÜRLÜK (#453).

   Sahne ekranın yenileme hızına yetişemiyorsa takılır; izleyen bunu çözünürlükteki küçük bir
   düşüşten çok daha kolay fark eder. Bu modül çıkış penceresinin kare aralıklarını izler ve
   kare kaçıyorsa çizim çözünürlüğünü basamak basamak düşürür, sahne hafifleyince geri yükseltir.

   Ölçüldü (8 katmanlı gerçek bir sahne, 2560×1600, 75 Hz): tam çözünürlükte 57 fps, 0,8'de
   72 fps, 0,65'te 75 fps.

   Saf: pencere, tuval ve saat yok. Çağıran her animasyon karesinde aralığı verir; ölçek
   değişirse yeni değer döner, çağıran tuvalleri yeniden boyutlandırır.

   KURALLAR
   - Yenileme süresi görülen en kısa aralıklardan öğrenilir (ekran 60, 75, 144 Hz olabilir).
   - Kaçan kare: aralığın yenileme süresinin 1,6 katını aşması.
   - İki saniyelik pencerede karelerin %12'sinden fazlası kaçtıysa bir basamak (0,1) aşağı.
   - Yükseltme temkinli: art arda sakin pencereler ister; yükseltmenin hemen ardından yine kare
     kaçarsa bekleme iki katına çıkar (en çok iki dakika). Sınırda duran bir sahne böylece
     birkaç saniyede bir bulanıp netleşmez.
   - Her değişimden sonra bir pencere ölçülmez: yeniden boyutlandırmanın kendi takılması
     yeni bir düşüşe sayılmasın.
   - Yarım saniyeyi aşan aralık ölçülmez (pencere gizliydi, sekme uyuyordu). */
(function () {
  const STEP = 0.1;
  const FLOOR = 0.5;
  const WINDOW_MS = 2000;
  const DROP_RATIO = 0.12;
  const CALM_RATIO = 0.02;
  const MISS_FACTOR = 1.6;
  const RAISE_AFTER = 5; // sakin pencere sayısı (10 sn)
  const RAISE_MAX = 60; // iki dakika
  const round = (v) => Math.round(v * 100) / 100;

  function create(opts) {
    const o = opts || {};
    const floor = o.floor == null ? FLOOR : o.floor;
    let scale = 1;
    let period = 0; // öğrenilen yenileme süresi (ms)
    let acc = 0;
    let frames = 0;
    let missed = 0;
    let skip = 0; // ölçülmeyecek pencere sayısı
    let calm = 0;
    let raiseAfter = RAISE_AFTER;
    let sinceRaise = -1; // son yükseltmeden beri geçen pencere; -1: yükseltme yok

    function reset() {
      scale = 1; acc = 0; frames = 0; missed = 0; skip = 0; calm = 0; raiseAfter = RAISE_AFTER; sinceRaise = -1;
    }

    /* dt: iki animasyon karesi arası (ms). Dönen: ölçek değiştiyse yeni değer, yoksa null.
       t (isteğe bağlı, her karede verilebilir):
         minPeriod  hedef kare aralığı (ms). Kare hızı sınırı varken (ör. 30 FPS) hedef o
                    sınırdır, ekranın yenileme hızı değil: sınırı tutturan bir sahne 75 Hz'e
                    göre "kare kaçırıyor" sayılıp boşuna bulanıyordu (#453).
         floor      en düşük ölçek; kullanıcı ayarı (power.adaptiveFloor). */
    function tick(dt, t) {
      if (!(dt > 2) || dt > 500) return null;
      const lim = t && t.floor > 0 ? Math.min(1, Math.max(0.2, t.floor)) : floor;
      // Alt sınır yükseltildiyse ölçek hemen ona çıkar
      if (scale < lim - 1e-6) { scale = round(lim); skip = 1; acc = 0; frames = 0; missed = 0; return scale; }
      // En kısa aralık yenileme süresidir; yavaşça yukarı sızar ki ekran değişince yeniden öğrenilsin
      period = period ? Math.min(dt, period * 1.0005) : dt;
      const want = Math.max(period, t && t.minPeriod > 0 ? t.minPeriod : 0);
      acc += dt;
      frames++;
      if (dt > want * MISS_FACTOR) missed += Math.max(1, Math.round(dt / want) - 1);
      if (acc < WINDOW_MS) return null;
      const ratio = missed / Math.max(1, frames + missed);
      acc = 0; frames = 0; missed = 0;
      if (skip > 0) { skip--; return null; }
      if (sinceRaise >= 0) sinceRaise++;
      if (ratio > DROP_RATIO) {
        calm = 0;
        // Yükseltmenin hemen ardından düşüş: bu sahne o basamağı taşımıyor, daha uzun bekle
        if (sinceRaise >= 0 && sinceRaise <= 2) raiseAfter = Math.min(RAISE_MAX, raiseAfter * 2);
        sinceRaise = -1;
        if (scale <= lim + 1e-6) return null;
        scale = round(Math.max(lim, scale - STEP));
        skip = 1;
        return scale;
      }
      if (ratio <= CALM_RATIO) calm++; else calm = 0;
      if (scale < 1 && calm >= raiseAfter) {
        calm = 0;
        scale = round(Math.min(1, scale + STEP));
        sinceRaise = 0;
        skip = 1;
        return scale;
      }
      return null;
    }

    return { tick, reset, scale: () => scale, period: () => period, raiseAfter: () => raiseAfter };
  }

  const api = { create, STEP, FLOOR, WINDOW_MS, DROP_RATIO, MISS_FACTOR };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (typeof window !== 'undefined') window.SVAdaptiveScale = api;
})();
