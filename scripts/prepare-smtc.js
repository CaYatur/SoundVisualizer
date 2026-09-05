'use strict';

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

if (process.platform !== 'win32') {
  console.log('SMTC native helper is required only for Windows builds.');
  process.exit(0);
}

const root = path.join(__dirname, '..');
const projectDir = path.join(root, 'native', 'smtc-helper');
const output = path.join(projectDir, 'bin', 'Release', 'net8.0-windows10.0.19041.0', 'win-x64', 'publish', 'smtc-helper.exe');

console.log('Building native SMTC helper...');
const result = spawnSync('dotnet', [
  'publish',
  projectDir,
  '-c', 'Release',
  '-r', 'win-x64',
  '--self-contained'
], { stdio: 'inherit', windowsHide: true });

if (result.error) {
  console.warn('dotnet CLI not found or failed, skipping SMTC helper build (will use PowerShell fallback):', result.error.message);
  process.exit(0);
}
if (result.status !== 0) {
  console.warn('dotnet publish exited with code', result.status, '(will use PowerShell fallback)');
  process.exit(0);
}
if (!fs.existsSync(output)) {
  console.warn('SMTC native helper binary not found after publish (will use PowerShell fallback).');
  process.exit(0);
}

const sizeMiB = fs.statSync(output).size / (1024 * 1024);
console.log(`SMTC native helper prepared: ${output} (${sizeMiB.toFixed(2)} MiB)`);
