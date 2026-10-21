/*
 * SoundVisualizer — CaYaDev Ses Görselleştirici
 * Copyright (c) 2026 Çağan Turgut (CaYatur) — CaYaDev, https://cayadev.com
 * https://github.com/CaYatur/SoundVisualizer
 * SPDX-License-Identifier: MIT
 */
'use strict';
/* KÖPRÜ: OTURUM AÇILINCA BAŞLAT (#822). Köprü makinesi çoğu zaman başında
   kimsenin olmadığı bir bilgisayar; açılınca köprü kendiliğinden, penceresiz
   başlamalı. Doğrusu ayar dosyası değil sistemin kendisi: kullanıcı oradan
   silerse ya da kapatırsa pencere de kapalı gösterir.
     Windows  kullanıcının Başlangıç klasöründe kısayol. Kayıt defteri
              (HKCU Run, app.setLoginItemSettings) KULLANILMAZ: kurulu sürüm
              Dynamic Lighting için paket kimliğiyle çalışıyor ve o süreçte
              HKCU yazımı sanal bir kopyaya gidiyor. Ölçüldü (paketli sürüm,
              Windows 11): uygulama girdiyi yazıp "açık" okuyor, gerçek Run
              anahtarında girdi yok; Windows açılışta görmezdi. Başlangıç
              klasörüne yazılan dosya gerçek klasöre düşüyor (ölçüldü).
              Görev Yöneticisi > Başlangıç'tan kapatılırsa kapalı okunur.
     Linux    ~/.config/autostart/*.desktop (XDG)
     macOS    giriş öğesi argüman taşımıyor; köprü kipi seçilemediği için
              burada sunulmuyor, pencere nedenini söyler
   Yalnız paketli sürümde: geliştirmede exe Electron'un kendisi. */
const path = require('path');

const NAME = 'CAYADEV Visualizer Audio Bridge';
const LNK = NAME + '.lnk';
// Görev Yöneticisi > Başlangıç'tan kapatılan kısayol burada: ilk bayt tekse kapalı
const APPROVED_KEY = 'HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Explorer\\StartupApproved\\StartupFolder';
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
function startupLink(appData) { return path.join(appData, 'Microsoft', 'Windows', 'Start Menu', 'Programs', 'Startup', LNK); }

function get(deps, sp) {
  if (!sp || !sp.supported) return false;
  if (sp.platform === 'linux') {
    try { return deps.fs.readFileSync(desktopPath(deps.home), 'utf8').indexOf('Name=' + NAME) >= 0; } catch { return false; }
  }
  const file = startupLink(deps.appData);
  let link = null;
  try { link = deps.fs.existsSync(file) ? deps.shell.readShortcutLink(file) : null; } catch { link = null; }
  if (!link || String(link.args || '').indexOf('--bridge') < 0) return false;
  try {
    const m = /REG_BINARY\s+([0-9A-Fa-f]{2})/.exec(deps.reg(['query', APPROVED_KEY, '/v', LNK]));
    if (m && (parseInt(m[1], 16) & 1)) return false;
  } catch { /* onay kaydı yok: açık */ }
  return true;
}

function set(deps, sp, on) {
  if (!sp || !sp.supported) return false;
  const file = sp.platform === 'linux' ? desktopPath(deps.home) : startupLink(deps.appData);
  if (on) {
    deps.fs.mkdirSync(path.dirname(file), { recursive: true });
    if (sp.platform === 'linux') deps.fs.writeFileSync(file, desktopEntry(sp));
    else deps.shell.writeShortcutLink(file, 'create', { target: sp.exe, args: sp.args.join(' '), description: NAME, icon: sp.exe, iconIndex: 0 });
  } else {
    try { deps.fs.unlinkSync(file); } catch { /* zaten yoktu */ }
  }
  return get(deps, sp);
}

module.exports = { NAME, LNK, APPROVED_KEY, DESKTOP_FILE, spec, desktopEntry, desktopPath, startupLink, quoteExec, get, set };
