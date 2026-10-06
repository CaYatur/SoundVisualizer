/*
 * SoundVisualizer — CaYaDev Ses Görselleştirici
 * Copyright (c) 2026 Çağan Turgut (CaYatur) — CaYaDev, https://cayadev.com
 * https://github.com/CaYatur/SoundVisualizer
 * SPDX-License-Identifier: MIT
 */
'use strict';
/* GÜNCELLEME DENETİMİ (#640).

   Neden kendi kodumuz: electron-updater yeni bir bağımlılık ve bu uygulamanın
   dağıtım biçimlerinin yarısını (taşınabilir exe, .deb, imzasız macOS) zaten
   kuramıyor; oralarda yapılacak tek doğru şey haber vermek. Bu modül yalnız
   GitHub Releases'e sorar ve bir karar döndürür; ağ ve dosya işlemleri
   dışarıdan veriliyor, böylece her dal ağsız sınanıyor.

   Gizlilik: tek istek https://api.github.com/.../releases/latest adresine.
   Kimlik, sayaç ya da cihaz bilgisi gönderilmez; User-Agent yalnız uygulama
   adı ve sürümü (GitHub API'si User-Agent istiyor). */

const REPO = 'CaYatur/SoundVisualizer';
const API_LATEST = 'https://api.github.com/repos/' + REPO + '/releases/latest';
const RELEASES_PAGE = 'https://github.com/' + REPO + '/releases';

/* Sürüm karşılaştırma: "v3.1.10" > "3.1.9"; ön sürüm aynı çekirdekli
   kararlıdan küçük ("3.2.0-beta.1" < "3.2.0"). Anlaşılmayan sürüm 0.0.0. */
function parseVersion(v) {
  const m = /^v?(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?/.exec(String(v || '').trim());
  if (!m) return { core: [0, 0, 0], pre: null };
  return { core: [Number(m[1]), Number(m[2]), Number(m[3])], pre: m[4] || null };
}

function compareVersions(a, b) {
  const x = parseVersion(a);
  const y = parseVersion(b);
  for (let i = 0; i < 3; i++) {
    if (x.core[i] !== y.core[i]) return x.core[i] < y.core[i] ? -1 : 1;
  }
  if (x.pre === y.pre) return 0;
  if (!x.pre) return 1;
  if (!y.pre) return -1;
  // Ön sürüm etiketleri: sayısal parçalar sayı olarak
  const pa = x.pre.split('.');
  const pb = y.pre.split('.');
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    if (pa[i] == null) return -1;
    if (pb[i] == null) return 1;
    const na = /^\d+$/.test(pa[i]);
    const nb = /^\d+$/.test(pb[i]);
    if (na && nb && Number(pa[i]) !== Number(pb[i])) return Number(pa[i]) < Number(pb[i]) ? -1 : 1;
    if (pa[i] !== pb[i]) return pa[i] < pb[i] ? -1 : 1;
  }
  return 0;
}

/* Kurulum biçimi — neyin yapılabileceğini belirleyen tek şey.
     nsis      Windows kurulumu: indirilip kurulabilir
     portable  Windows taşınabilir exe: üzerine kurulacak bir şey yok, haber ver
     appimage  Linux AppImage: kendi dosyasını değiştirebilir
     deb       Linux paket kurulumu: paket yöneticisinin işi, haber ver
     mac       macOS: imzasız; sistem güncelleyicisi reddeder, haber ver
     dev       paketlenmemiş geliştirme kopyası: yalnız denetim */
function installKind(platform, env, isPackaged) {
  const e = env || {};
  if (!isPackaged) return 'dev';
  if (platform === 'win32') return e.PORTABLE_EXECUTABLE_FILE || e.PORTABLE_EXECUTABLE_DIR ? 'portable' : 'nsis';
  if (platform === 'linux') return e.APPIMAGE ? 'appimage' : 'deb';
  if (platform === 'darwin') return 'mac';
  return 'dev';
}

// Biçime göre dağıtım dosyasının adı (release-assets.js'deki adlarla aynı)
const ASSET_PATTERNS = {
  nsis: /-windows-setup\.exe$/i,
  portable: /-windows-portable\.exe$/i,
  appimage: /-linux-(x86_64|x64)\.AppImage$/i,
  deb: /-linux-(amd64|x64)\.deb$/i,
  mac: /-macos-arm64\.dmg$/i,
};

function pickAsset(kind, assets, arch) {
  if (kind === 'mac' && arch && arch !== 'arm64') return null; // Intel Mac derlemesi yok
  const re = ASSET_PATTERNS[kind];
  if (!re) return null;
  return (assets || []).find((a) => a && re.test(a.name)) || null;
}

// Hangi biçimler uygulamanın içinden kurulabilir (indirme ve kurulum #640 b)
function canInstall(kind) {
  return kind === 'nsis' || kind === 'appimage';
}

/* GitHub yanıtını yalnız ihtiyaç duyulan alanlara indir. İndirme adresi
   yalnız https ve github.com ise kabul edilir. */
function parseRelease(json) {
  const j = json || {};
  const okUrl = (u) => typeof u === 'string' && /^https:\/\/github\.com\//.test(u);
  const assets = (Array.isArray(j.assets) ? j.assets : []).map((a) => ({
    name: String(a.name || ''),
    size: Number(a.size) || 0,
    url: okUrl(a.browser_download_url) ? a.browser_download_url : '',
    digest: typeof a.digest === 'string' && /^sha256:[0-9a-f]{64}$/i.test(a.digest) ? a.digest.slice(7).toLowerCase() : '',
  }));
  return {
    version: String(j.tag_name || '').replace(/^v/, ''),
    tag: String(j.tag_name || ''),
    name: String(j.name || j.tag_name || ''),
    notes: String(j.body || '').slice(0, 20000),
    publishedAt: String(j.published_at || ''),
    url: okUrl(j.html_url) ? j.html_url : RELEASES_PAGE,
    draft: !!j.draft,
    prerelease: !!j.prerelease,
    assets,
  };
}

/* DENETİM. fetchJson(url, headers) -> Promise<object> dışarıdan veriliyor.
   Dönen durum arayüzün doğrudan gösterebileceği biçimde. */
async function check(opts) {
  const o = opts || {};
  const current = String(o.current || '0.0.0');
  const kind = o.kind || 'dev';
  const base = { current, kind, checkedAt: Date.now() };
  let rel;
  try {
    const json = await o.fetchJson(API_LATEST, {
      Accept: 'application/vnd.github+json',
      'User-Agent': 'CAYADEV-Visualizer/' + current,
    });
    rel = parseRelease(json);
  } catch (e) {
    return Object.assign(base, { status: 'error', error: String((e && e.message) || e) });
  }
  if (!rel.version || rel.draft || rel.prerelease) {
    return Object.assign(base, { status: 'error', error: 'no stable release' });
  }
  const newer = compareVersions(rel.version, current) > 0;
  const asset = newer ? pickAsset(kind, rel.assets, o.arch) : null;
  return Object.assign(base, {
    status: newer ? 'available' : 'latest',
    latest: rel.version,
    name: rel.name,
    notes: newer ? rel.notes : '',
    publishedAt: rel.publishedAt,
    releaseUrl: rel.url,
    asset,
    skipped: newer && !!o.skipVersion && compareVersions(rel.version, o.skipVersion) === 0,
    installable: newer && !!asset && !!asset.digest && canInstall(kind),
  });
}

module.exports = {
  REPO,
  API_LATEST,
  RELEASES_PAGE,
  parseVersion,
  compareVersions,
  installKind,
  ASSET_PATTERNS,
  pickAsset,
  canInstall,
  parseRelease,
  check,
};
