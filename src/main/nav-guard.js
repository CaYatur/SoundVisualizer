/*
 * SoundVisualizer — CaYaDev Ses Görselleştirici
 * Copyright (c) 2026 Çağan Turgut (CaYatur) — CaYaDev, https://cayadev.com
 * https://github.com/CaYatur/SoundVisualizer
 * SPDX-License-Identifier: MIT
 */
'use strict';
/* Pencereler yalnız uygulamanın kendi sayfalarını gösterir.

   Önyükleme betiği (preload) pencereye bağlı: pencere başka bir adrese
   giderse o sayfa da panelin köprüsünü (window.api) alır. Pencereye bir
   bağlantı ya da dosya bırakmak Chromium'un varsayılanıyla pencereyi oraya
   götürüyordu. Burada uygulama klasörü dışındaki her gezinme durur.

   Yeni pencere (target="_blank", window.open) açılmaz; https bağlantısı
   sistem tarayıcısında açılır (ör. OpenRGB indirme sayfası). Ana süreçten
   yapılan loadFile/loadURL bu olayları tetiklemez. */

const path = require('path');
const url = require('url');

function norm(p, platform) {
  const r = path.resolve(p);
  return (platform || process.platform) === 'win32' ? r.toLowerCase() : r;
}

/* file: adresi uygulama klasörünün içindeyse evet. Paketli uygulamada
   sayfalar app.asar/src altında; kök de oradan hesaplanır. */
function isAppPage(target, root, platform) {
  if (typeof target !== 'string' || !target) return false;
  let parsed;
  try { parsed = new URL(target); } catch { return false; }
  if (parsed.protocol !== 'file:') return false;
  let file;
  try { file = url.fileURLToPath(parsed); } catch { return false; }
  const base = norm(root, platform);
  const p = norm(file, platform);
  return p === base || p.startsWith(base + path.sep);
}

function isWebLink(target) {
  try { return new URL(target).protocol === 'https:'; } catch { return false; }
}

function install(app, shell, root) {
  app.on('web-contents-created', (_e, contents) => {
    const guard = (e, target) => { if (!isAppPage(target, root)) e.preventDefault(); };
    contents.on('will-navigate', guard);
    contents.on('will-redirect', guard);
    contents.setWindowOpenHandler(({ url: target }) => {
      if (isWebLink(target)) shell.openExternal(target);
      return { action: 'deny' };
    });
  });
}

module.exports = { isAppPage, isWebLink, install };
