'use strict';

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

function findMt() {
  const roots = [
    'C:/Program Files (x86)/Windows Kits/10/bin',
    'C:/Program Files/Windows Kits/10/bin',
  ];
  const matches = [];
  for (const root of roots) {
    if (!fs.existsSync(root)) continue;
    for (const version of fs.readdirSync(root)) {
      const candidate = path.join(root, version, 'x64', 'mt.exe');
      if (fs.existsSync(candidate)) matches.push({ version, candidate });
    }
  }
  matches.sort((a, b) => b.version.localeCompare(a.version, undefined, { numeric: true }));
  if (!matches.length) throw new Error('mt.exe was not found in the Windows SDK.');
  return matches[0].candidate;
}

module.exports = async function afterPack(context) {
  if (context.electronPlatformName !== 'win32') return;

  const root = context.packager.projectDir;
  const manifest = path.join(root, 'build', 'identity', 'CAYADEV.Visualizer.exe.manifest');
  const executable = path.join(context.appOutDir, `${context.packager.appInfo.productFilename}.exe`);
  if (!fs.existsSync(manifest)) throw new Error(`Identity manifest is missing: ${manifest}`);
  if (!fs.existsSync(executable)) throw new Error(`Packaged executable is missing: ${executable}`);

  const mt = findMt();
  const result = spawnSync(mt, [
    '-nologo',
    '-manifest', manifest,
    `-outputresource:${executable};#1`,
  ], { encoding: 'utf8', windowsHide: true });

  if (result.stdout) process.stdout.write(result.stdout);
  if (result.stderr) process.stderr.write(result.stderr);
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`mt.exe failed with exit code ${result.status}.`);
  console.log(`Sparse identity metadata embedded into ${executable}`);
};
