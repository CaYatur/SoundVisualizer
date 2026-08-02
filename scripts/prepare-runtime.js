'use strict';

const fs = require('fs');
const path = require('path');

if (process.platform !== 'win32') {
  console.log('Bundled Node runtime preparation is currently required only for Windows builds.');
  process.exit(0);
}

const runtimeDir = path.join(__dirname, '..', 'build', 'runtime');
const destination = path.join(runtimeDir, 'node.exe');

fs.mkdirSync(runtimeDir, { recursive: true });
fs.copyFileSync(process.execPath, destination);

const sizeMiB = fs.statSync(destination).size / 1024 / 1024;
console.log(`Bundled Node runtime prepared: ${destination} (${sizeMiB.toFixed(2)} MiB)`);
