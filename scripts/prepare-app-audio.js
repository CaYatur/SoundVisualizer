'use strict';
/* Uygulama başına ses yakalama yardımcısını derler (yalnızca Windows).
 *
 * SMTC yardımcısıyla aynı desen ve aynı gerekçe: WASAPI'nin süreç loopback'i
 * COM üzerinden geliyor, Node'dan çağrılamıyor. Yerel bir node eklentisi
 * yerine kendi kendine yeten bir .NET ikilisi kullanıyoruz; eklenti
 * Electron'un ABI'sine bağlanır ve her sürüm yükseltmesinde yeniden derlenmesi
 * gerekirdi.
 *
 * dotnet yoksa ya da derleme başarısız olursa SESSİZCE geçilir: özellik
 * çalışmaz ama uygulama derlenir ve çalışır. Yakalama tarafı ikiliyi
 * bulamadığında kullanıcıya sebebini söyler.
 */

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

if (process.platform !== 'win32') {
  console.log('App audio helper is required only for Windows builds.');
  process.exit(0);
}

const root = path.join(__dirname, '..');
const projectDir = path.join(root, 'native', 'app-audio-helper');
const output = path.join(
  projectDir, 'bin', 'Release', 'net8.0-windows10.0.19041.0', 'win-x64', 'publish',
  'app-audio-helper.exe'
);

console.log('Building app audio capture helper...');
const result = spawnSync('dotnet', [
  'publish', projectDir, '-c', 'Release', '-r', 'win-x64', '--self-contained',
], { stdio: 'inherit', windowsHide: true });

if (result.error) {
  console.warn('dotnet CLI not found or failed, skipping app audio helper build '
    + '(per-application capture will report as unavailable):', result.error.message);
  process.exit(0);
}
if (result.status !== 0) {
  console.warn('dotnet publish exited with code', result.status,
    '(per-application capture will report as unavailable)');
  process.exit(0);
}
if (!fs.existsSync(output)) {
  console.warn('App audio helper binary not found after publish '
    + '(per-application capture will report as unavailable).');
  process.exit(0);
}

const sizeMiB = fs.statSync(output).size / (1024 * 1024);
console.log(`App audio helper prepared: ${output} (${sizeMiB.toFixed(2)} MiB)`);
