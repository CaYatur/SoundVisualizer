/*
 * SoundVisualizer — CaYaDev Ses Görselleştirici
 * Copyright (c) 2026 Çağan Turgut (CaYatur) — CaYaDev, https://cayadev.com
 * https://github.com/CaYatur/SoundVisualizer
 * SPDX-License-Identifier: MIT
 */
'use strict';
/* DIŞA AKTARIMDA VİDEO KATMANI (#539): kare başı sarma için hazırlık.

   Dışa aktarıcı her kareden önce videoyu o karenin zamanına sarıyor; aynı
   iş aynı videoyu versin diye oynatmıyor. Sıradan bir video dosyasında
   (telefon, kurgu programı: anahtar kare 1-10 sn'de bir) her sarma önceki
   anahtar kareden ileri çözmek demek. Ölçüldü (1080p30, x264 varsayılan
   GOP): kare başına ~150 ms; 20 sn'lik dışa aktarım 7,8 sn yerine 98 sn,
   60 fps'te 195 sn sürdü.

   Çözüm: dışa aktarım başlamadan her video dosyası, her karesi anahtar kare
   olan bir ara kopyaya çevriliyor (x264 ultrafast, -g 1). Aynı ölçümde
   çevirme 30 sn'lik kaynak için 1,1 sn, sarma kare başına ~6 ms; dışa
   aktarım 11,4 sn (60 fps'te 18,8 sn).

   - Yalnız dışa aktarım süresi kadarı çevrilir (+1 sn): döngüdeki video
     kendi süresinde sarar, daha uzun kaynağın sonrası hiç gösterilmez.
   - Çıktıdan büyük kaynak çıktıyı örtecek boya küçültülür (4K kaynak 1080p
     dışa aktarımda dört kat daha az çözer); küçük kaynak büyütülmez.
   - Saydamlıklı kaynak (VP9 alfa, ProRes 4444) çevrilmez: H.264 alfayı
     taşımaz. O dosya yavaş ama doğru sarılır.
   - Çevirme başarısızsa özgün dosya kullanılır; sonuç yine doğru, yalnız
     yavaş.

   Saf kısım (dosya listesi, argümanlar, alfa tespiti) test ediliyor; süreç
   ve dosya işi main.js'te. */
const path = require('path');

// layers.js stackOn ile aynı kural: anahtar yoksa katman listesi belirler
function stackOnCfg(cfg) {
  const s = cfg && cfg.layerStack;
  if (s && typeof s.enabled === 'boolean') return s.enabled;
  return !!(cfg && Array.isArray(cfg.layers) && cfg.layers.length);
}

// Sahnede dışa aktarıma girecek video dosyaları: cfg değerleri (URL ya da yol)
function mediaFiles(cfg) {
  const stackOn = stackOnCfg(cfg);
  const out = [];
  const add = (m) => {
    if (!m || m.source !== 'file' || !m.file || typeof m.file !== 'string') return;
    if (out.indexOf(m.file) < 0) out.push(m.file);
  };
  if (!cfg) return out;
  if (stackOn) {
    (Array.isArray(cfg.layers) ? cfg.layers : []).forEach((l) => {
      if (!l || l.kind !== 'media' || l.enabled === false || l.muted) return;
      add(Object.assign({}, cfg.media || {}, (l.settings && l.settings.media) || {}));
    });
  } else if (cfg.media && cfg.media.enabled) {
    add(cfg.media);
  }
  return out;
}

/* ffmpeg'in `-i` çıktısından saydamlık: piksel biçiminde alfa (yuva, rgba,
   argb, gbrap, ya16 …) ya da WebM'in alpha_mode etiketi. */
function hasAlpha(probeText) {
  const s = String(probeText || '');
  const video = s.split('\n').filter((l) => /Stream #\d+:\d+.*Video:/.test(l)).join('\n');
  if (/\b(yuva\w*|rgba\w*|bgra|argb|abgr|gbrap\w*|ya8|ya16\w*|pal8)\b/.test(video)) return true;
  return /alpha_mode\s*:\s*1/i.test(s);
}

/* Ara kopyanın argümanları. Genişlik çıktıyı örtecek en küçük boy (kaynaktan
   büyük değil), çift sayıya yuvarlı; yükseklik oranla. */
function transcodeArgs(input, output, opts) {
  const o = opts || {};
  const W = Math.max(2, Math.round(Number(o.width) || 1920));
  const H = Math.max(2, Math.round(Number(o.height) || 1080));
  const args = ['-v', 'error', '-y'];
  if (Number(o.maxSec) > 0) args.push('-t', String(Math.ceil(Number(o.maxSec) + 1)));
  args.push('-i', input, '-an', '-sn', '-dn',
    '-vf', `scale=w='trunc(min(iw,max(${W},ceil(${H}*iw/ih)))/2)*2':h=-2:flags=bicubic`,
    '-c:v', 'libx264', '-preset', 'ultrafast', '-tune', 'fastdecode', '-g', '1', '-crf', '17',
    '-pix_fmt', 'yuv420p', '-fps_mode', 'passthrough', '-movflags', '+faststart', output);
  return args;
}

function tempName(dir, i) {
  return path.join(dir, 'media-' + i + '.mp4');
}

module.exports = { mediaFiles, hasAlpha, transcodeArgs, tempName, stackOnCfg };
