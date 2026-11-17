/*
 * SoundVisualizer — CaYaDev Ses Görselleştirici
 * Copyright (c) 2026 Çağan Turgut (CaYatur) — CaYaDev, https://cayadev.com
 * https://github.com/CaYatur/SoundVisualizer
 * SPDX-License-Identifier: MIT
 */
'use strict';
/* ANDROID SÜRÜMÜNÜN APK'SI (docs/android/PLAN.md K9, §2.6, R11).

   Masaüstünün scripts/release-assets.js'i yalnız masaüstü sürümlerini (v1.2.3) kabul ediyor;
   Android ayrı çizgide: etiket android-v<sürüm>, sürüm android/version.properties'ten.

     node android/tools/release-apk.js android-v1.0.0 <apk>            # yalnız denetle (varsayılan)
     node android/tools/release-apk.js android-v1.0.0 <apk> --upload   # Release'e yükle

   Denetim:
     - etiket android-vX.Y.Z ve version.properties ile aynı;
     - APK var, imzası geliştirme imzası DEĞİL (Android Debug), apksigner doğruluyor;
     - SHA-256 hesaplanır, yanına <apk>.sha256 yazılır (Release'te dosyanın yanında durur).
   Yükleme (--upload) yalnız VAR OLAN bir Release'e: Release'i bu betik açmaz. Yükledikten
   sonra Release "Latest" değilse dokunulmaz, "Latest" ise --latest=false ile geri alınır:
   Latest her zaman masaüstünde kalır (masaüstü güncelleyicisi ve README indirme düğmeleri).
   Yayın kararı ayrı onayla; bu betik kendiliğinden hiçbir şey yayımlamaz. */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { spawnSync } = require('child_process');

const ROOT = path.join(__dirname, '..', '..');

function appVersion(root) {
  const txt = fs.readFileSync(path.join(root || ROOT, 'android', 'version.properties'), 'utf8');
  const m = /^version=(\d+\.\d+\.\d+)\s*$/m.exec(txt);
  if (!m) throw new Error('android/version.properties: version=X.Y.Z yok');
  return m[1];
}

/** Etiket denetimi: { ok, version, error }. */
function checkTag(tag, version) {
  const m = /^android-v(\d+\.\d+\.\d+)$/.exec(String(tag || ''));
  if (!m) return { ok: false, error: 'Etiket android-vX.Y.Z olmalı (verilen: ' + tag + ')' };
  if (m[1] !== version) return { ok: false, error: 'Etiket ' + m[1] + ', android/version.properties ' + version };
  return { ok: true, version: m[1] };
}

function sha256(file) {
  return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
}

function apksigner() {
  const sdk = process.env.ANDROID_HOME || process.env.ANDROID_SDK_ROOT || (process.env.LOCALAPPDATA && path.join(process.env.LOCALAPPDATA, 'Android', 'Sdk'));
  if (!sdk) return null;
  const bt = path.join(sdk, 'build-tools');
  let dirs = [];
  try { dirs = fs.readdirSync(bt).sort(); } catch (e) { return null; }
  for (const d of dirs.reverse()) {
    for (const n of ['apksigner.bat', 'apksigner']) {
      const f = path.join(bt, d, n);
      if (fs.existsSync(f)) return f;
    }
  }
  return null;
}

function main() {
  const args = process.argv.slice(2);
  const [tag, apk] = args.filter((a) => !a.startsWith('--'));
  const upload = args.includes('--upload');
  if (!tag || !apk) {
    console.error('kullanım: node android/tools/release-apk.js android-v' + appVersion() + ' <apk> [--upload]');
    process.exit(2);
  }
  const t = checkTag(tag, appVersion());
  if (!t.ok) { console.error(t.error); process.exit(2); }
  if (!fs.existsSync(apk)) { console.error('APK yok: ' + apk); process.exit(2); }
  const signer = apksigner();
  if (!signer) { console.error('apksigner bulunamadı (ANDROID_HOME)'); process.exit(2); }
  const v = spawnSync(signer, ['verify', '--print-certs', apk], { encoding: 'utf8', shell: process.platform === 'win32' });
  if (v.status !== 0) { console.error('İmza doğrulanamadı:\n' + (v.stderr || v.stdout)); process.exit(1); }
  if (/CN=Android Debug/.test(v.stdout)) { console.error('Bu APK geliştirme imzalı (Android Debug): yayımlanamaz. Kalıcı anahtarla imzalayın.'); process.exit(1); }
  const sum = sha256(apk);
  const sumFile = apk + '.sha256';
  fs.writeFileSync(sumFile, sum + '  ' + path.basename(apk) + '\n');
  console.log(tag + ': ' + path.basename(apk) + ' ' + fs.statSync(apk).size + ' B, SHA-256 ' + sum);
  if (!upload) { console.log('Denetim tamam (yükleme için --upload).'); return; }
  const gh = (a) => spawnSync('gh', a, { cwd: ROOT, encoding: 'utf8' });
  const rel = gh(['api', 'repos/{owner}/{repo}/releases/tags/' + tag]);
  if (rel.status !== 0) { console.error('Release yok (' + tag + '): önce Release açılmalı (--latest=false).'); process.exit(1); }
  const up = gh(['release', 'upload', tag, apk + '#Android — APK', sumFile + '#Android — SHA-256', '--clobber']);
  if (up.status !== 0) { console.error(up.stderr); process.exit(1); }
  // Latest her zaman masaüstünde kalır
  const latest = gh(['api', 'repos/{owner}/{repo}/releases/latest', '--jq', '.tag_name']);
  if (latest.status === 0 && latest.stdout.trim() === tag) {
    gh(['release', 'edit', tag, '--latest=false']);
    console.log('Release "Latest" idi: geri alındı (Latest masaüstünde kalır).');
  }
  console.log('Yüklendi.');
}

if (require.main === module) main();
module.exports = { appVersion, checkTag, sha256 };
