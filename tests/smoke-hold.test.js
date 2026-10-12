'use strict';
/* Öz testin sprite ölçümü panel gönderimlerinden korunur (13.10).

   Paketli v3.1.5 öz testi üç koşunun birinde "sprite: the launch was
   refused (NO_FILE)" ile düştü. Öz test gerçek ayarlarla koşuyor; panel
   (dinamik tema gibi) kendiliğinden tam yapılandırma yollayabiliyor, bir
   koşuda 26-29 kez. Ölçümün ortasına düşen gönderim görselleştiriciyi
   kullanıcının sahnesine döndürüyor ve bellekteki geçici sprite dosyasını
   siliyordu. Ölçümün ortasında panelden bilerek bir gönderim yaptırıldı:
   bekletme olmadan aynı NO_FILE ve "layer" hatası, bekletmeyle PASS. */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const SRC = fs.readFileSync(path.join(__dirname, '..', 'src', 'main', 'main.js'), 'utf8').replace(/\r\n/g, '\n');

test('panel gönderimleri bekletilirken saklanır, bitince uygulanır', () => {
  assert.match(SRC, /ipcMain\.on\('update-config', \(e, config\) => \{\n  if \(smokeHold\) \{ smokeHold\.full = config; smokeHold\.patches = \[\]; return; \}\n  applyIncomingConfig\(config\);\n\}\);/);
  assert.match(SRC, /ipcMain\.on\('patch-config', \(e, patch\) => \{\n  if \(smokeHold\) \{ smokeHold\.patches\.push\(patch\); return; \}\n  applyConfigPatch\(patch\);\n\}\);/);
  const end = SRC.slice(SRC.indexOf('function smokeHoldEnd()'), SRC.indexOf("ipcMain.on('update-config'"));
  assert.match(end, /smokeHold = null;/);
  assert.ok(end.indexOf('applyIncomingConfig(h.full)') < end.indexOf('applyConfigPatch(p)'), 'önce tam yapılandırma, sonra yamalar');
});

test('bekletmeyi yalnız öz test açar ve sprite ölçümünü sarar', () => {
  const starts = SRC.split('smokeHoldStart();').length - 1;
  assert.strictEqual(starts, 1, 'tek çağıran');
  assert.match(SRC, /smokeHoldStart\(\);\n  let spr;\n  try \{ spr = await spriteProbe\(\); \} finally \{ smokeHoldEnd\(\); \}/);
  const at = SRC.indexOf('smokeHoldStart();\n  let spr;');
  assert.ok(at > SRC.indexOf('async function runSmoke()'), 'runSmoke içinde');
});
