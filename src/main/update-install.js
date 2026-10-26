/*
 * SoundVisualizer — CaYaDev Ses Görselleştirici
 * Copyright (c) 2026 Çağan Turgut (CaYatur) — CaYaDev, https://cayadev.com
 * https://github.com/CaYatur/SoundVisualizer
 * SPDX-License-Identifier: MIT
 */
'use strict';
/* GÜNCELLEMEYİ İNDİR, DOĞRULA, KUR (#640, 2. adım).

   Kurallar (hiçbiri gevşetilmiyor):
   - Yalnız https. Yönlendirme yalnız github.com ve *.githubusercontent.com
     alan adlarına, en çok 5 kez; başka bir yere yönlendiren yanıt reddedilir.
   - Dosya önce ".part" adıyla iner. İnerken SHA-256 hesaplanır; boyut
     sürümün bildirdiği boyutu geçerse indirme kesilir.
   - Boyut ve SHA-256 (GitHub'ın dosya özetiyle) BİREBİR tutmadan hiçbir şey
     çalıştırılmaz ya da yerine konmaz; tutmazsa .part silinir.
   - Ağ (request), dosya sistemi ve süreç başlatma dışarıdan veriliyor:
     testler gerçek ağa ve diske dokunmadan her dalı sınıyor. */

const crypto = require('crypto');
const path = require('path');

const MAX_REDIRECTS = 5;

function allowedUrl(u) {
  let url;
  try {
    url = new URL(u);
  } catch (e) {
    return false;
  }
  if (url.protocol !== 'https:') return false;
  const h = url.hostname.toLowerCase();
  return h === 'github.com' || h === 'api.github.com' || h.endsWith('.githubusercontent.com');
}

/* Sıkıştırılmış gövde GitHub'ın ham SHA-256'ı ile tutmaz. identity ve boş
   başlık ham bayttır; gzip, deflate, br reddedilir. */
function refusedEncoding(headers) {
  const h = headers || {};
  let enc = h['content-encoding'];
  if (enc == null && typeof h.get === 'function') enc = h.get('content-encoding');
  enc = String(Array.isArray(enc) ? enc[0] : (enc || '')).trim().toLowerCase();
  if (!enc || enc === 'identity') return '';
  return 'compressed body refused: ' + enc;
}

/* request(url) -> Promise<{ status, headers, body }>; body okunabilir akış.
   fsx: { createWriteStream, rename, unlink }. */
async function download(opts) {
  const o = opts || {};
  const { request, fsx } = o;
  const expectSize = Number(o.size) || 0;
  const digest = String(o.digest || '').toLowerCase();
  if (!/^[0-9a-f]{64}$/.test(digest)) throw new Error('missing sha256 digest');
  if (!expectSize) throw new Error('missing size');
  let url = o.url;
  let res = null;
  for (let i = 0; i <= MAX_REDIRECTS; i++) {
    if (!allowedUrl(url)) throw new Error('refused host: ' + String(url).slice(0, 80));
    res = await request(url);
    if (res.status >= 300 && res.status < 400 && res.headers && res.headers.location) {
      if (res.body && res.body.resume) res.body.resume();
      url = new URL(res.headers.location, url).toString();
      res = null;
      continue;
    }
    break;
  }
  if (!res) throw new Error('too many redirects');
  if (res.status !== 200) {
    if (res.body && res.body.destroy) res.body.destroy();
    throw new Error('HTTP ' + res.status);
  }
  const encoding = refusedEncoding(res.headers);
  if (encoding) {
    if (res.body && res.body.destroy) res.body.destroy();
    throw new Error(encoding);
  }

  const part = o.dest + '.part';
  const hash = crypto.createHash('sha256');
  let got = 0;
  await new Promise((resolve, reject) => {
    const out = fsx.createWriteStream(part);
    let failed = false;
    const fail = (err) => {
      if (failed) return;
      failed = true;
      if (res.body.destroy) res.body.destroy();
      out.destroy();
      reject(err);
    };
    res.body.on('data', (chunk) => {
      if (failed) return;
      got += chunk.length;
      if (got > expectSize) return fail(new Error('larger than the release says'));
      hash.update(chunk);
      // Disk yavaşsa ağı beklet (bellekte büyüyen tampon olmasın)
      if (!out.write(chunk) && res.body.pause) {
        res.body.pause();
        out.once('drain', () => res.body.resume());
      }
      if (o.onProgress) o.onProgress(got / expectSize);
    });
    res.body.on('error', fail);
    out.on('error', fail);
    res.body.on('end', () => { if (!failed) out.end(); });
    out.on('finish', () => { if (!failed) resolve(); });
  }).catch(async (e) => {
    await safeUnlink(fsx, part);
    throw e;
  });
  const sum = hash.digest('hex');
  if (got !== expectSize) {
    await safeUnlink(fsx, part);
    throw new Error('size mismatch: ' + got + ' / ' + expectSize);
  }
  if (sum !== digest) {
    await safeUnlink(fsx, part);
    throw new Error('sha256 mismatch');
  }
  await fsx.rename(part, o.dest);
  return { file: o.dest, sha256: sum, size: got };
}

async function safeUnlink(fsx, p) {
  try {
    await fsx.unlink(p);
  } catch (e) {
    /* zaten yok */
  }
}

/* Windows kurulumu. electron-builder'ın NSIS şablonu "--updated" görünce
   uygulamanın kapanmasını bekliyor (gerekirse kapatıyor); "/S" sessiz kurar
   (tüm kullanıcılar için kurulumda Windows yine izin sorar). Kurulum kendi
   sürecinde, uygulamadan bağımsız başlar; ardından uygulama kapanmalı. */
function installerArgs(silent) {
  return silent ? ['/S', '--updated'] : ['--updated'];
}
function runInstaller(file, silent, spawn) {
  const child = spawn(file, installerArgs(silent), { detached: true, stdio: 'ignore' });
  /* Başlatılamayan kurucu (antivirüs silmiş, izin yok) 'error' yayar.
     Dinleyici yoksa bu olay yakalanmamış hata olur ve uygulama kapanır.
     Karar whenInstallerStarted'da: hata varsa çıkış yapılmaz. */
  if (child && typeof child.on === 'function') {
    child.on('error', (err) => {
      child.spawnError = err || new Error('installer failed to start');
    });
  }
  if (child && child.unref) child.unref();
  return child;
}

/* spawn gelirse kurucu başladı. error gelirse ya da ikisi de gelmezse
   başarısız: çağıran uygulamayı kapatmamalı. */
function whenInstallerStarted(child, timeoutMs) {
  const fail = (err) => ({ ok: false, error: String((err && err.message) || err || 'installer failed to start') });
  if (child && child.spawnError) return Promise.resolve(fail(child.spawnError));
  if (!child || typeof child.once !== 'function') return Promise.resolve(fail());
  return new Promise((resolve) => {
    let settled = false;
    const finish = (result) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(result);
    };
    const timer = setTimeout(() => finish(fail()), timeoutMs == null ? 5000 : timeoutMs);
    child.once('error', (err) => finish(fail(err)));
    child.once('spawn', () => finish({ ok: true }));
  });
}

/* AppImage: yeni dosya AYNI klasöre (aynı dosya sistemi) iner, çalıştırılabilir
   yapılır ve eskisinin üstüne atomik olarak taşınır. Çalışan kopya eski
   dosyayı bağlı tuttuğu için etkilenmez; yeni sürüm bir sonraki açılışta. */
function appImageTemp(target, assetName) {
  return path.join(path.dirname(target), '.' + path.basename(assetName) + '.new');
}
async function replaceAppImage(file, target, fsx) {
  await fsx.chmod(file, 0o755);
  await fsx.rename(file, target);
  return target;
}

module.exports = { MAX_REDIRECTS, allowedUrl, refusedEncoding, download, installerArgs, runInstaller, whenInstallerStarted, appImageTemp, replaceAppImage };
