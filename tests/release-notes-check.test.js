'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { notesProblems } = require('../scripts/release-notes-check');

const FILES = ['a-setup.exe', 'a.AppImage', 'a.AppImage.zsync', 'Presets.zip'];
const link = (f) => '[x](https://github.com/o/r/releases/download/v1/' + f + ')';

test('yüklenen her dosyanın indirme bağlantısı olmalı; zsync hariç', () => {
  const all = link('a-setup.exe') + link('a.AppImage') + link('Presets.zip');
  assert.deepStrictEqual(notesProblems(all, FILES), []);
  assert.deepStrictEqual(notesProblems(link('a-setup.exe') + link('a.AppImage'), FILES), ['indirme bağlantısı yok: Presets.zip']);
  assert.strictEqual(notesProblems('', FILES).length, 3);
});

test('kişi anmak yakalanıyor; kod, e-posta ve bağlantı yolu sayılmıyor', () => {
  assert.deepStrictEqual(notesProblems('(#904, reported by @someone).', []), ['kişi anılmış: @someone']);
  assert.deepStrictEqual(notesProblems('@first line', []), ['kişi anılmış: @first']);
  const clean = 'kod `@types/node` ve\n```\nnpm i @scope/pkg\n```\nposta a@b.com, yol https://x.y/@z';
  assert.deepStrictEqual(notesProblems(clean, []), []);
});
