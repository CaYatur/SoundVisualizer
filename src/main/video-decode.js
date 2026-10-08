/*
 * SoundVisualizer — CaYaDev Ses Görselleştirici
 * Copyright (c) 2026 Çağan Turgut (CaYatur) — CaYaDev, https://cayadev.com
 * https://github.com/CaYatur/SoundVisualizer
 * SPDX-License-Identifier: MIT
 */
'use strict';
/* Video çözme yolu: varsayılan yazılım, isteğe bağlı donanım.

   NEDEN
   Medya katmanı videoyu DOM'a koymadan tuvale çiziyor. Chromium'un
   donanım çözücüsü (Windows'ta D3D11) böyle bir videoya yalnız pencere
   masaüstü birleştiricisinden geçerek sunulurken kare üretiyor. Ölçüldü:
   - tam ekran görselleştirici (Windows birleştiriciyi atlayıp doğrudan
     sunuyor): saniyede 0,3 kare, döngü sonunda takılı;
   - Spout/Syphon penceresi (ekran dışı çizim): aynı;
   - bunlardan biri açıkken panel önizlemesi de duruyordu;
   - aynı tam ekran pencerenin köşesine 1 piksellik bir pencere binince ya
     da görev çubuğu önizlemesi açılınca saniyede 60 kare.
   Yayın katmanı OBS'in kendi tarayıcısında çizildiği için akıcıydı.
   Yazılım çözücüsüyle (FFmpegVideoDecoder) üçü de saniyede 60 kare ve
   düzgün döngü; çözme sunum yolundan bağımsız. Linux'ta Chromium zaten
   yazılımla çözüyor; anahtar macOS'ta da aynı çalışır.

   BEDELİ
   1080p60 başına yaklaşık yarım çekirdek. Chromium HEVC/H.265'i yalnız
   donanımla oynatıyor: bu videolar için ayar açılmalı (yeniden başlatma
   ister). Seçim Chromium'a pencereler açılmadan önce verilmeli; bu yüzden
   ayar dosyası açılışta doğrudan okunuyor. */
const fs = require('fs');

// Ayar dosyasının ham metninden: donanım çözme açık mı (bozuk/yok = kapalı)
function wantsHardwareDecode(raw) {
  if (!raw) return false;
  try {
    // Not Defteri UTF-8 BOM ekleyebiliyor; ana ayar yükleyicisi gibi ayıkla
    const cfg = JSON.parse(String(raw).replace(/^\uFEFF/, ''));
    return !!(cfg && cfg.power && cfg.power.hwVideoDecode === true);
  } catch {
    return false;
  }
}

/* app.ready'den ÖNCE çağrılır. Dönüş: donanım çözme kullanılıyor mu. */
function applyVideoDecodePolicy(app, settingsPath) {
  let raw = null;
  try { raw = fs.readFileSync(settingsPath, 'utf8'); } catch { /* ilk açılış */ }
  const hw = wantsHardwareDecode(raw);
  if (!hw) app.commandLine.appendSwitch('disable-accelerated-video-decode');
  return hw;
}

module.exports = { wantsHardwareDecode, applyVideoDecodePolicy };
