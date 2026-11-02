/*
 * SoundVisualizer — CaYaDev Ses Görselleştirici
 * Copyright (c) 2026 Çağan Turgut (CaYatur) — CaYaDev, https://cayadev.com
 * https://github.com/CaYatur/SoundVisualizer
 * SPDX-License-Identifier: MIT
 */
'use strict';
/* BU MAKİNEDE HANGİ KODLAYICI, HANGİ YOLLA ÇALIŞIYOR (#521, #904).

   Windows ve macOS'ta tek soru var: paketteki ffmpeg bu kodlayıcıyla deneme
   kodlamasını geçiyor mu. Linux'ta üç şey daha gerekiyor:

   - Paketteki ffmpeg-static'te QSV ve VA-API yok. Sistemin ffmpeg'i varsa GPU
     kodlayıcıları onunla da deneniyor. CPU kodlayıcıları pakettekinde kalıyor:
     dışa aktarımın sonucu sistemdeki sürüme bağlanmasın.
   - Bazı Intel GPU'larında (Tiger Lake) H.264 yalnız düşük güç giriş noktasıyla
     kodlanıyor. Önce `-low_power` olmadan deneniyor; eski GPU'larda düşük güç
     kodlayıcısı yok, zorlamak onları bozardı.
   - VA-API bir aygıt dosyası istiyor; her render düğümü deneniyor.

   Burada süreç başlatılmıyor: `run` ve `list` dışarıdan geliyor, karar mantığı
   donanımsız sınanabiliyor. */
const F = require('../shared/export-formats.js');

const base = (key) => String(key).replace(/@10$/, '');

/* `run(bin, args)` deneme kodlamasının sonucu, `list(bin)` o ikilideki kodlayıcı
   adları (yoklanamazsa null: elemeden denenir). Yanıt:
     map     anahtar → bool; panel ve seçim bunu okuyor
     routes  anahtar → { bin, variant }; gerçek iş aynı yoldan koşuyor */
async function probeEncoders(o) {
  const { platform, bins, keys, renderNodes, run, list } = o;
  const map = {};
  const routes = {};
  const env = { platform, renderNodes: renderNodes || [] };
  const gpuOf = (k) => F.ENCODERS[base(k)].gpu;

  // CPU kodlayıcıları birlikte ve yalnız paketteki ikiliyle
  const cpu = keys.filter((k) => !gpuOf(k));
  await Promise.all(cpu.map(async (k) => {
    const args = F.probeArgs(k);
    map[k] = args ? await run(bins[0], args) : false;
    if (map[k]) routes[k] = { bin: bins[0], variant: {} };
  }));

  /* GPU denemeleri SIRAYLA: her biri bir sürücü aygıtı açıyor, hepsi birden
     görselleştirici açılırken GPU'yu meşgul ediyordu. Yalnız Linux'ta ikinci
     ikili var; orada olmayan kodlayıcı denenmiyor, boşuna aygıt açılmıyor. */
  const binsFor = platform === 'linux' ? bins : bins.slice(0, 1);
  const known = new Map();
  const has = async (bin, enc) => {
    if (binsFor.length < 2) return true;
    if (!known.has(bin)) known.set(bin, await list(bin));
    const names = known.get(bin);
    return !names || names.indexOf(enc) >= 0;
  };
  for (const k of keys.filter(gpuOf)) {
    map[k] = false;
    const variants = F.encoderVariants(base(k), env);
    for (let b = 0; b < binsFor.length && !map[k]; b++) {
      if (!variants.length || !(await has(binsFor[b], base(k)))) continue;
      for (let v = 0; v < variants.length && !map[k]; v++) {
        const args = F.probeArgs(k, variants[v]);
        if (!args) continue;
        if (await run(binsFor[b], args)) {
          map[k] = true;
          routes[k] = { bin: binsFor[b], variant: variants[v] };
        }
      }
    }
  }
  return { map, routes };
}

module.exports = { probeEncoders };
