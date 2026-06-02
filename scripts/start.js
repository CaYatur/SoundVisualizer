'use strict';
/* Electron'u GUI olarak başlatır. ELECTRON_RUN_AS_NODE ayarlıysa temizler
   (aksi halde Electron düz Node gibi çalışıp uygulamayı açamaz). */
const { spawn } = require('child_process');
const electronPath = require('electron'); // Node bağlamında binary yolunu (string) verir
const path = require('path');

const env = { ...process.env };
delete env.ELECTRON_RUN_AS_NODE;

const args = ['.', ...process.argv.slice(2)];
const child = spawn(electronPath, args, {
  stdio: 'inherit',
  cwd: path.join(__dirname, '..'),
  env,
});

child.on('close', (code) => process.exit(code));
