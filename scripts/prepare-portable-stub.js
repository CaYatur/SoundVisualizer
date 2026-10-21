/*
 * SoundVisualizer — CaYaDev Ses Görselleştirici
 * Copyright (c) 2026 Çağan Turgut (CaYatur) — CaYaDev, https://cayadev.com
 * https://github.com/CaYatur/SoundVisualizer
 * SPDX-License-Identifier: MIT
 */
'use strict';

/* Taşınabilir exe'nin kabuğu (electron-builder portable.nsi) uygulamayı
   sabit bir geçici klasöre açar (unpackDirName; güvenlik duvarı izni exe
   yoluna bağlı, yol her açılışta değişmesin). Kabuk o klasörü açılışta ve
   uygulama kapanınca RMDir /r ile siler. Exe ikinci kez açılınca çalışan
   kopyanın 177 dosyasından 170'i siliniyordu (#822, ölçüldü).

   electron-builder taşınabilir hedefe kendi betiğini eklemeye izin vermiyor;
   bu betik şablonu derlemeden önce yamalar: klasördeki exe kullanımdaysa
   (çalışan bir kopya var) kabuk silmez ve açmaz, var olan exe'yi çalıştırır
   (tek örnek kilidi açılışı çalışan kopyaya iletir); kapanışta da exe hâlâ
   kullanımdaysa (aynı klasörden açılmış köprü) klasör kalır. Yama tekrar
   uygulanmaz; şablon değişmişse derleme durur. */

const fs = require('fs');
const path = require('path');

const MARK = '; cayadev-portable-guard';

const OPEN_FROM = '  RMDir /r $INSTDIR\n  SetOutPath $INSTDIR\n';
const OPEN_TO = `  ${MARK} (#822): exe in use means a running copy, keep the folder
  IfFileExists "$INSTDIR\\\${APP_EXECUTABLE_FILENAME}" 0 cayadev_extract
  ClearErrors
  FileOpen $R8 "$INSTDIR\\\${APP_EXECUTABLE_FILENAME}" a
  IfErrors cayadev_in_use
  FileClose $R8
  Goto cayadev_extract
cayadev_in_use:
  SetOutPath $INSTDIR
  Goto cayadev_run
cayadev_extract:
  RMDir /r $INSTDIR
  SetOutPath $INSTDIR
`;

const RUN_FROM = '  System::Call \'Kernel32::SetEnvironmentVariable(t, t)i ("PORTABLE_EXECUTABLE_DIR"';
const RUN_TO = 'cayadev_run:\n' + RUN_FROM;

const CLOSE_FROM = '  SetOutPath $EXEDIR\n\tRMDir /r $INSTDIR\n';
const CLOSE_TO = `  SetOutPath $EXEDIR
  ClearErrors
  FileOpen $R8 "$INSTDIR\\\${APP_EXECUTABLE_FILENAME}" a
  IfErrors cayadev_keep
  FileClose $R8
\tRMDir /r $INSTDIR
cayadev_keep:
`;

function patch(text) {
  const nl = text.includes('\r\n') ? '\r\n' : '\n';
  let s = text.replace(/\r\n/g, '\n');
  if (s.includes(MARK)) return { text, changed: false };
  for (const [from, to] of [[OPEN_FROM, OPEN_TO], [RUN_FROM, RUN_TO], [CLOSE_FROM, CLOSE_TO]]) {
    const count = s.split(from).length - 1;
    if (count !== 1) throw new Error(`portable.nsi changed: expected one match for ${JSON.stringify(from.trim())}, found ${count}`);
    s = s.replace(from, to);
  }
  return { text: s.replace(/\n/g, nl), changed: true };
}

function templatePath() {
  const lib = path.dirname(require.resolve('app-builder-lib/package.json'));
  return path.join(lib, 'templates', 'nsis', 'portable.nsi');
}

if (require.main === module) {
  const file = templatePath();
  const { text, changed } = patch(fs.readFileSync(file, 'utf8'));
  if (changed) fs.writeFileSync(file, text);
  console.log(`Portable stub guard ${changed ? 'applied' : 'already present'}: ${file}`);
}

module.exports = { MARK, patch, templatePath };
