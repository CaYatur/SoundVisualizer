/*
 * SoundVisualizer — CaYaDev Ses Görselleştirici
 * Copyright (c) 2026 Çağan Turgut (CaYatur) — CaYaDev, https://cayadev.com
 * https://github.com/CaYatur/SoundVisualizer
 * SPDX-License-Identifier: MIT
 */
'use strict';
/* UYGULAMA MENÜSÜ. Uygulama menü kurmadığında Electron kendi varsayılanını koyuyor:
   Dosya / Düzen / Görünüm / Pencere. Çubuk gizli olsa da kısayolları çalışıyordu:
     Ctrl+R        paneli ve çıkış penceresini yeniden yüklüyordu (gösteri ortasında),
     Ctrl+Shift+I  geliştirici araçlarını açıyordu,
     Ctrl+W        odaktaki pencereyi kapatıyordu,
     Alt           panelde Electron'un genel menü çubuğunu gösteriyordu.
   Windows ve Linux'ta menü kaldırılıyor; kopyala/yapıştır ve yazı alanındaki geri al
   Chromium'un kendi işi, menüye bağlı değil. macOS'ta menü çubuğu sistemin parçası ve
   Cmd+C/V/Q oradan geliyor: yalnız uygulama, Düzen ve Pencere menüleri kalıyor, Görünüm
   (yeniden yükle, geliştirici araçları) yok. `--dev` ile açıldığında F5 ve F12 duruyor. */

function template(platform, dev) {
  const out = [];
  if (platform === 'darwin') {
    out.push({ role: 'appMenu' }, { role: 'editMenu' }, { role: 'windowMenu' });
  }
  if (dev) {
    out.push({
      label: 'Developer',
      submenu: [
        { role: 'reload', accelerator: 'F5' },
        { role: 'toggleDevTools', accelerator: 'F12' },
      ],
    });
  }
  return out.length ? out : null;
}

function install(Menu, platform, dev) {
  const t = template(platform, dev);
  Menu.setApplicationMenu(t ? Menu.buildFromTemplate(t) : null);
  return t;
}

module.exports = { template, install };
