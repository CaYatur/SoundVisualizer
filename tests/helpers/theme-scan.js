/*
 * SoundVisualizer — CaYaDev Ses Görselleştirici
 * Copyright (c) 2026 Çağan Turgut (CaYatur) — CaYaDev, https://cayadev.com
 * https://github.com/CaYatur/SoundVisualizer
 * SPDX-License-Identifier: MIT
 */
'use strict';
/* Tema testlerinin CSS ve JS tarayıcısı (#770). Renk sabitlerini bulur;
   yorumları ve url(...) içini atlar (veri URI'leri görüntü). */

// Onaltılık renk, sayıyla başlayan rgb()/rgba()/hsl()/hsla()
const COLOR = /#[0-9a-fA-F]{3,8}\b|\b(?:rgba?|hsla?)\(\s*[\d.]/g;

// CSS'te değer olarak yazılabilecek adlı renkler (transparent ve currentColor serbest)
const NAMED = ['white', 'black', 'red', 'green', 'blue', 'yellow', 'orange', 'gray', 'grey',
  'silver', 'purple', 'pink', 'magenta', 'cyan', 'lime', 'navy', 'teal', 'maroon', 'olive',
  'aqua', 'fuchsia', 'gold', 'brown', 'crimson', 'coral', 'salmon', 'tomato', 'violet',
  'indigo', 'khaki', 'beige', 'ivory', 'lavender', 'orchid', 'plum', 'tan', 'turquoise',
  'wheat', 'snow', 'azure', 'chartreuse', 'darkred', 'darkgray', 'darkgrey', 'lightgray',
  'lightgrey', 'whitesmoke', 'gainsboro', 'dimgray', 'dimgrey'];
const NAMED_RE = new RegExp('(^|[\\s,(])(' + NAMED.join('|') + ')(?=$|[\\s,;)!])', 'i');

function blank(s, re) {
  return s.replace(re, (m) => m.replace(/[^\n]/g, ' '));
}

function stripCss(src) {
  let s = blank(src, /\/\*[\s\S]*?\*\//g);
  s = blank(s, /url\((?:"[^"]*"|'[^']*'|[^)]*)\)/g);
  return s;
}

function lineOf(src, idx) {
  return src.slice(0, idx).split('\n').length;
}

/* Kurallar: { sel, body, start, decls: [{ prop, value, index }] }. @media
   ve @keyframes içindeki kurallar da düz kural olarak gelir. */
function cssRules(src) {
  const s = stripCss(src);
  const out = [];
  const re = /([^{}]*)\{([^{}]*)\}/g;
  let m;
  while ((m = re.exec(s))) {
    const sel = m[1].replace(/\s+/g, ' ').trim();
    const body = m[2];
    const decls = [];
    let off = m.index + m[1].length + 1;
    body.split(';').forEach((d) => {
      const i = d.indexOf(':');
      if (i > 0) decls.push({ prop: d.slice(0, i).trim(), value: d.slice(i + 1).trim(), index: off });
      off += d.length + 1;
    });
    out.push({ sel, body, start: m.index, decls });
  }
  return out;
}

// :root bloğundaki özel özellikler
function rootVars(src) {
  const r = cssRules(src).find((x) => x.sel === ':root');
  const map = {};
  if (r) r.decls.forEach((d) => { if (d.prop.startsWith('--')) map[d.prop] = d.value; });
  return map;
}

// :root dışındaki renk sabitleri
function cssLiterals(src) {
  const found = [];
  cssRules(src).forEach((r) => {
    if (r.sel === ':root') return;
    r.decls.forEach((d) => {
      const v = d.value;
      let m;
      COLOR.lastIndex = 0;
      while ((m = COLOR.exec(v))) {
        found.push({ line: lineOf(src, d.index), sel: r.sel, prop: d.prop, literal: m[0] });
      }
      const n = NAMED_RE.exec(v);
      if (n && !/^font|^grid-template|^animation|^transition|^content$/.test(d.prop)) {
        found.push({ line: lineOf(src, d.index), sel: r.sel, prop: d.prop, literal: n[2] });
      }
    });
  });
  return found;
}

// Kullanılan değişkenler ve kullanım biçimleri
function cssVarUses(src) {
  const s = stripCss(src);
  const uses = [];
  const re = /var\(\s*(--[\w-]+)/g;
  let m;
  while ((m = re.exec(s))) uses.push({ name: m[1], line: lineOf(src, m.index) });
  return uses;
}

// Kurallarda tanımlanan özel özellikler (ör. .cd-cell { --slot: ... })
function cssLocalVars(src) {
  const set = new Set();
  cssRules(src).forEach((r) => r.decls.forEach((d) => { if (d.prop.startsWith('--')) set.add(d.prop); }));
  return set;
}

// rgb(var(--x) / a) biçimindeki kanal kullanımları
function cssChannelUses(src) {
  const s = stripCss(src);
  const out = [];
  const re = /rgba?\(\s*var\(\s*(--[\w-]+)\s*\)/g;
  let m;
  while ((m = re.exec(s))) out.push({ name: m[1], line: lineOf(src, m.index) });
  return out;
}

/* JS: dize sabitlerinin içindeki renkler (yorumlar sayılmaz). Basit bir
   tarayıcı: dizeleri, yorumları ve düzenli ifadeleri ayırt eder. */
function jsStringColors(src) {
  const found = [];
  let i = 0;
  const n = src.length;
  let lastSig = '';
  while (i < n) {
    const c = src[i];
    const d = src[i + 1];
    if (c === '/' && d === '/') { const e = src.indexOf('\n', i); i = e < 0 ? n : e; continue; }
    if (c === '/' && d === '*') { const e = src.indexOf('*/', i + 2); i = e < 0 ? n : e + 2; continue; }
    if (c === '\'' || c === '"' || c === '`') {
      let j = i + 1;
      while (j < n && src[j] !== c) { if (src[j] === '\\') j++; j++; }
      const str = src.slice(i + 1, j);
      let m;
      COLOR.lastIndex = 0;
      while ((m = COLOR.exec(str))) found.push({ line: lineOf(src, i), literal: m[0], text: str.slice(0, 80) });
      i = j + 1;
      lastSig = 'x';
      continue;
    }
    // Düzenli ifade sabiti: bölme işaretinden sonra gelen bir ifade değilse
    if (c === '/' && !/[\w)\]$]/.test(lastSig)) {
      let j = i + 1;
      let cls = false;
      while (j < n && (src[j] !== '/' || cls) && src[j] !== '\n') {
        if (src[j] === '\\') j++;
        else if (src[j] === '[') cls = true;
        else if (src[j] === ']') cls = false;
        j++;
      }
      i = j + 1;
      lastSig = 'x';
      continue;
    }
    if (!/\s/.test(c)) lastSig = c;
    i++;
  }
  return found;
}

module.exports = { COLOR, NAMED, stripCss, cssRules, rootVars, cssLiterals, cssVarUses, cssLocalVars, cssChannelUses, jsStringColors };
