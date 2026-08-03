'use strict';

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

if (process.platform !== 'win32') {
  console.log('Dynamic Lighting native module is required only for Windows builds.');
  process.exit(0);
}

const root = path.join(__dirname, '..');
const moduleDir = path.join(root, 'native', 'dynamic-lighting');
const nodeGyp = path.join(root, 'node_modules', 'node-gyp', 'bin', 'node-gyp.js');
const electronVersion = require(path.join(root, 'node_modules', 'electron', 'package.json')).version;
const output = path.join(moduleDir, 'build', 'Release', 'dynamic_lighting.node');

if (!fs.existsSync(nodeGyp)) throw new Error('node-gyp is required to build Dynamic Lighting.');

const result = spawnSync(process.execPath, [
  nodeGyp,
  'rebuild',
  '--directory', moduleDir,
  `--target=${electronVersion}`,
  '--dist-url=https://electronjs.org/headers',
], { stdio: 'inherit', windowsHide: true });

if (result.error) throw result.error;
if (result.status !== 0) process.exit(result.status || 1);
if (!fs.existsSync(output)) throw new Error('Dynamic Lighting native module was not produced.');

const sizeKiB = fs.statSync(output).size / 1024;
console.log(`Dynamic Lighting native module prepared: ${output} (${sizeKiB.toFixed(1)} KiB)`);
