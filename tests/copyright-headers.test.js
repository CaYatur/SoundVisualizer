'use strict';
/* Telif bildirimi (#695).

   src, scripts ve native altındaki her kaynak dosya aynı başlığı taşır;
   yeni eklenen dosya da. JSON, .gyp ve .csproj gibi bildirim dosyaları
   başlık almaz. HTML'de başlık doctype'tan, kabuk betiğinde shebang'den
   sonra gelir. */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const root = path.join(__dirname, '..');
const HOLDER = 'Copyright (c) 2026 Çağan Turgut (CaYatur) — CaYaDev, https://cayadev.com';
const EXTS = ['.js', '.css', '.html', '.cs', '.cpp', '.sh', '.nsh'];

function sources() {
  let out;
  try {
    out = execFileSync('git', ['ls-files', 'src', 'scripts', 'native'], { cwd: root, encoding: 'utf8' });
  } catch (e) {
    return null;
  }
  return out.split('\n').filter((f) => EXTS.includes(path.extname(f).toLowerCase()));
}

test('her kaynak dosyanın başında telif bildirimi var', (t) => {
  const files = sources();
  if (!files) { t.skip('git yok'); return; }
  assert.ok(files.length > 150, 'beklenenden az dosya: ' + files.length);
  const missing = [];
  for (const rel of files) {
    const head = fs.readFileSync(path.join(root, rel), 'utf8').split(/\r?\n/).slice(0, 8).join('\n');
    if (!head.includes(HOLDER) || !head.includes('SPDX-License-Identifier: MIT')) missing.push(rel);
  }
  assert.deepStrictEqual(missing, [], 'başlığı olmayan dosyalar');
});

test('doctype ve shebang ilk satırda kalıyor', (t) => {
  const files = sources();
  if (!files) { t.skip('git yok'); return; }
  for (const rel of files) {
    const text = fs.readFileSync(path.join(root, rel), 'utf8');
    if (rel.endsWith('.html')) assert.match(text, /^<!DOCTYPE html>\r?\n<!--/i, rel);
    if (rel.endsWith('.sh')) assert.match(text, /^#!/, rel);
  }
});

test('LICENSE ve paket aynı sahibi yazıyor', () => {
  assert.ok(fs.readFileSync(path.join(root, 'LICENSE'), 'utf8').includes(HOLDER));
  const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
  assert.strictEqual(pkg.build.copyright, HOLDER);
  assert.strictEqual(pkg.license, 'MIT');
});
