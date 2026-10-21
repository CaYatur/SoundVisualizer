/*
 * SoundVisualizer — CaYaDev Ses Görselleştirici
 * Copyright (c) 2026 Çağan Turgut (CaYatur) — CaYaDev, https://cayadev.com
 * https://github.com/CaYatur/SoundVisualizer
 * SPDX-License-Identifier: MIT
 */
'use strict';
/* KÖPRÜ: OTURUM AÇILINCA BAŞLAT (#822). Köprü makinesi çoğu zaman başında
   kimsenin olmadığı bir bilgisayar; açılınca köprü kendiliğinden, penceresiz
   başlamalı. Doğrusu ayar dosyası değil sistemin listesi: kullanıcı oradan
   silerse durum penceresi de kapalı gösterir.
     Windows  sistemin başlangıç listesi (HKCU Run), ayrı adla
     Linux    ~/.config/autostart/*.desktop (XDG)
     macOS    giriş öğesi argüman taşımıyor; köprü kipi seçilemediği için
              burada sunulmuyor, pencere nedenini söyler
   Yalnız paketli sürümde: geliştirmede exe Electron'un kendisi. */
const path = require('path');

const NAME = 'CAYADEV Visualizer Audio Bridge';
const DESKTOP_FILE = 'cayadev-visualizer-bridge.desktop';

/* Başlatılacak komut. Köprünün kendi klasörü (`--bridge`) ya da olağan
   klasör (ayardaki "yalnız köprü", `--bridge-shared-profile`): ikisi ayrı
   ayarlar, ayrı parola demek; açılışta aynı klasör kullanılmalı. */
function spec(o) {
  const platform = o.platform;
  if (!o.packaged) return { supported: false, reason: 'dev' };
  if (platform !== 'win32' && platform !== 'linux') return { supported: false, reason: 'platform' };
  const env = o.env || {};
  const exe = env.PORTABLE_EXECUTABLE_FILE || env.APPIMAGE || o.execPath;
  const args = o.ownProfile ? ['--bridge', '--hidden'] : ['--bridge', '--bridge-shared-profile', '--hidden'];
  return { supported: true, platform, exe, args, name: NAME };
}

// XDG masaüstü girdisi: boşluklu yol tırnakta, tırnak ve ters bölü kaçışlı
function quoteExec(s) {
  return /[\s"'\\$`]/.test(s) ? '"' + String(s).replace(/(["\\$`])/g, '\\$1') + '"' : String(s);
}
function desktopEntry(sp) {
  return [
    '[Desktop Entry]',
    'Type=Application',
    'Name=' + NAME,
    'Exec=' + [sp.exe].concat(sp.args).map(quoteExec).join(' '),
    'X-GNOME-Autostart-enabled=true',
    'NoDisplay=true',
    '',
  ].join('\n');
}
function desktopPath(home) { return path.join(home, '.config', 'autostart', DESKTOP_FILE); }

function get(deps, sp) {
  if (!sp || !sp.supported) return false;
  if (sp.platform === 'linux') {
    try { return deps.fs.readFileSync(desktopPath(deps.home), 'utf8').indexOf('Name=' + NAME) >= 0; } catch { return false; }
  }
  try {
    const s = deps.app.getLoginItemSettings({ path: sp.exe, args: sp.args });
    if (Array.isArray(s.launchItems)) return s.launchItems.some((i) => i && String(i.name).toLowerCase() === NAME.toLowerCase() && i.enabled !== false);
    return !!s.openAtLogin;
  } catch { return false; }
}

function set(deps, sp, on) {
  if (!sp || !sp.supported) return false;
  if (sp.platform === 'linux') {
    const file = desktopPath(deps.home);
    if (on) {
      deps.fs.mkdirSync(path.dirname(file), { recursive: true });
      deps.fs.writeFileSync(file, desktopEntry(sp));
    } else {
      try { deps.fs.unlinkSync(file); } catch { /* zaten yoktu */ }
    }
    return get(deps, sp);
  }
  deps.app.setLoginItemSettings({ openAtLogin: !!on, path: sp.exe, args: sp.args, name: NAME });
  return get(deps, sp);
}

module.exports = { NAME, DESKTOP_FILE, spec, desktopEntry, desktopPath, quoteExec, get, set };
