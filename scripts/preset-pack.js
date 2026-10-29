/*
 * SoundVisualizer — CaYaDev Ses Görselleştirici
 * Copyright (c) 2026 Çağan Turgut (CaYatur) — CaYaDev, https://cayadev.com
 * https://github.com/CaYatur/SoundVisualizer
 * SPDX-License-Identifier: MIT
 */
'use strict';
/* CaYaDev MilkDrop preset paketi (#825).
 *
 * Kaynak `presets/md3/cayadev/`: .milk dosyaları ve pack.json (kimlik, kategori,
 * TR/EN açıklama). Uygulama dosya okumadan çalışan sayfalarda da (yayın
 * katmanı, dışa aktarıcı) presetleri gördüğü için paket JS olarak gömülür:
 * bu betik `src/shared/presets-milkdrop-pack.js`i üretir.
 *
 *   node scripts/preset-pack.js                 gömülü dosyayı ve README galerisini yeniden üretir
 *   node scripts/preset-pack.js --check         ikisinden biri güncel değilse 1 ile çıkar
 *   node scripts/preset-pack.js --zip[=<dosya>] sürüm eki: .milk + önizlemeler + LICENSE.md + README.md
 *                                               (varsayılan dist/CaYaDev-MilkDrop-Presets-<sürüm>.zip)
 *
 * Her presetin bir önizleme görseli var: previews/<ad-kısa>.jpg (960x540). README'deki galeri
 * pack.json'dan üretilir; elle eklenen tablo satırları bir kez tablonun dışına düşmüştü.
 *
 * Paket CC BY 4.0, uygulama MIT: üretilen dosya da paketin lisansını taşır. */
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const root = path.join(__dirname, '..');
const DIR = path.join(root, 'presets', 'md3', 'cayadev');
const OUT = path.join(root, 'src', 'shared', 'presets-milkdrop-pack.js');
const README = path.join(DIR, 'README.md');
const GALLERY = ['<!-- gallery: node scripts/preset-pack.js -->', '<!-- /gallery -->'];

const previewOf = (name) => 'previews/' + name.toLowerCase().replace(/ /g, '-') + '.jpg';

function load() {
  const meta = JSON.parse(fs.readFileSync(path.join(DIR, 'pack.json'), 'utf-8'));
  const listed = new Set();
  const list = meta.presets.map((p) => {
    const m = /^CaYaDev - ([A-Za-z0-9 ]+)\.milk$/.exec(p.file);
    if (!m) throw new Error('Dosya adı "CaYaDev - <Ad>.milk" değil: ' + p.file);
    if (!/^md_caya_[a-z0-9_]+$/.test(p.id)) throw new Error('Kimlik md_caya_ ile başlamalı: ' + p.id);
    if (!p.description || !p.description.tr || !p.description.en) throw new Error('TR/EN açıklama eksik: ' + p.file);
    const source = fs.readFileSync(path.join(DIR, p.file), 'latin1');
    // Başka oynatıcılar UTF-8'i bozuyor; paket dosyaları ASCII
    if (/[^\x09\x0a\x0d\x20-\x7e]/.test(source)) throw new Error('ASCII dışı karakter: ' + p.file);
    const preview = previewOf(m[1]);
    if (!fs.existsSync(path.join(DIR, preview))) throw new Error('Önizleme görseli yok: ' + preview);
    listed.add(p.file);
    listed.add(preview);
    return { id: p.id, name: m[1], category: p.category, md3: !!p.md3, description: p.description, file: p.file, preview, source };
  });
  const pv = path.join(DIR, 'previews');
  const stray = fs.readdirSync(DIR).filter((f) => /\.milk$/i.test(f) && !listed.has(f))
    .concat(fs.existsSync(pv) ? fs.readdirSync(pv).map((f) => 'previews/' + f).filter((f) => !listed.has(f)) : []);
  if (stray.length) throw new Error('pack.json\'da olmayan dosya: ' + stray.join(', '));
  const ids = list.map((p) => p.id);
  if (new Set(ids).size !== ids.length) throw new Error('Yinelenen kimlik');
  return list;
}

function render(list) {
  const rows = list.map((p) => '    ' + JSON.stringify({
    id: p.id, name: p.name, category: p.category, md3: p.md3, description: p.description, source: p.source,
  }) + ',');
  return [
    '/*',
    ' * CaYaDev MilkDrop Presets — Copyright (c) 2026 CaYaDev',
    ' * https://github.com/CaYatur/SoundVisualizer/tree/main/presets/md3/cayadev',
    ' * SPDX-License-Identifier: CC-BY-4.0',
    ' */',
    "'use strict';",
    '/* OTOMATİK ÜRETİLDİ: scripts/preset-pack.js (#825). Elle düzenlemeyin; kaynak',
    '   presets/md3/cayadev/ klasörü. Liste shared/presets-milkdrop.js üzerinden yerleşik',
    '   havuza giriyor; sayfada bu dosya ondan ÖNCE yükleniyor. */',
    '(function () {',
    '  const PACK = [',
    ...rows,
    '  ];',
    "  if (typeof module !== 'undefined' && module.exports) module.exports = PACK;",
    "  if (typeof window !== 'undefined' && window) window.SVMilkdropPack = PACK;",
    '})();',
    '',
  ].join('\n');
}

// README galerisi: üçlü sıralar, görsel .milk dosyasına bağlı; alt metin İngilizce açıklama
function gallery(list) {
  const esc = (t) => t.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
  const cell = (p) => '<td align="center" valign="top" width="33%"><a href="' + encodeURI(p.file) + '"><img src="' + p.preview +
    '" width="100%" alt="' + esc(p.name + (/^[aeiou]/.test(p.category) ? ', an ' : ', a ') + p.category + ' MilkDrop preset by CaYaDev. ' + p.description.en) + '"></a><br><b>' +
    esc(p.name) + '</b><br><sub>' + p.category + ' · ' + (p.md3 ? 'MilkDrop 3' : 'MilkDrop 2') + '</sub></td>';
  const out = [GALLERY[0], '<table>'];
  for (let i = 0; i < list.length; i += 3) out.push('<tr>', ...list.slice(i, i + 3).map(cell), '</tr>');
  return out.concat(['</table>', GALLERY[1]]);
}

// README'nin işaretler arasını galeriyle değiştirir (CRLF kopyada da)
function renderReadme(text, list) {
  const lines = text.replace(/\r\n/g, '\n').split('\n');
  const a = lines.indexOf(GALLERY[0]);
  const b = lines.indexOf(GALLERY[1]);
  if (a < 0 || b < a) throw new Error('README galeri işaretleri yok: ' + GALLERY.join(' ... '));
  lines.splice(a, b - a + 1, ...gallery(list));
  return lines.join('\n');
}

// En küçük ZIP yazıcısı (deflate, UTF-8 adlar); yalnız düz dosyalar
function zip(files) {
  const crcT = new Int32Array(256);
  for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; crcT[n] = c; }
  const crc = (b) => { let c = -1; for (let i = 0; i < b.length; i++) c = crcT[(c ^ b[i]) & 255] ^ (c >>> 8); return (c ^ -1) >>> 0; };
  const local = [];
  const central = [];
  let offset = 0;
  // Sabit tarih (2026-01-01): aynı içerik aynı zip'i versin
  const DOS_TIME = 0, DOS_DATE = ((2026 - 1980) << 9) | (1 << 5) | 1;
  for (const f of files) {
    const name = Buffer.from(f.name, 'utf-8');
    const data = zlib.deflateRawSync(f.data, { level: 9 });
    const c = crc(f.data);
    const h = Buffer.alloc(30);
    h.writeUInt32LE(0x04034b50, 0); h.writeUInt16LE(20, 4); h.writeUInt16LE(0x0800, 6); h.writeUInt16LE(8, 8);
    h.writeUInt16LE(DOS_TIME, 10); h.writeUInt16LE(DOS_DATE, 12); h.writeUInt32LE(c, 14);
    h.writeUInt32LE(data.length, 18); h.writeUInt32LE(f.data.length, 22); h.writeUInt16LE(name.length, 26); h.writeUInt16LE(0, 28);
    local.push(h, name, data);
    const e = Buffer.alloc(46);
    e.writeUInt32LE(0x02014b50, 0); e.writeUInt16LE(20, 4); e.writeUInt16LE(20, 6); e.writeUInt16LE(0x0800, 8); e.writeUInt16LE(8, 10);
    e.writeUInt16LE(DOS_TIME, 12); e.writeUInt16LE(DOS_DATE, 14); e.writeUInt32LE(c, 16);
    e.writeUInt32LE(data.length, 20); e.writeUInt32LE(f.data.length, 24); e.writeUInt16LE(name.length, 28);
    e.writeUInt32LE(offset, 42);
    central.push(e, name);
    offset += h.length + name.length + data.length;
  }
  const cd = Buffer.concat(central);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(files.length, 8); end.writeUInt16LE(files.length, 10);
  end.writeUInt32LE(cd.length, 12); end.writeUInt32LE(offset, 16);
  return Buffer.concat(local.concat([cd, end]));
}

function zipName() {
  return 'CaYaDev-MilkDrop-Presets-' + require(path.join(root, 'package.json')).version + '.zip';
}

module.exports = { load, render, gallery, renderReadme, zip, zipName, OUT, DIR, README };

if (require.main === module) {
  const args = process.argv.slice(2);
  const list = load();
  const text = render(list);
  const readmeNow = fs.readFileSync(README, 'utf-8').replace(/\r\n/g, '\n');
  const readme = renderReadme(readmeNow, list);
  const zipArg = args.find((a) => a === '--zip' || a.startsWith('--zip='));
  if (args.includes('--check')) {
    const cur = fs.existsSync(OUT) ? fs.readFileSync(OUT, 'utf-8').replace(/\r\n/g, '\n') : '';
    if (cur !== text) {
      console.error('src/shared/presets-milkdrop-pack.js güncel değil: node scripts/preset-pack.js');
      process.exit(1);
    }
    if (readmeNow !== readme) {
      console.error('presets/md3/cayadev/README.md galerisi güncel değil: node scripts/preset-pack.js');
      process.exit(1);
    }
    console.log('Paket güncel: ' + list.length + ' preset');
  } else if (zipArg) {
    const out = zipArg.includes('=') ? path.resolve(zipArg.slice(6)) : path.join(root, 'dist', zipName());
    const folder = 'CaYaDev MilkDrop Presets/';
    const files = list.map((p) => ({ name: folder + p.file, data: Buffer.from(p.source, 'latin1') }))
      .concat(list.map((p) => ({ name: folder + p.preview, data: fs.readFileSync(path.join(DIR, p.preview)) })))
      .concat(['LICENSE.md', 'README.md'].map((f) => ({ name: folder + f, data: fs.readFileSync(path.join(DIR, f)) })));
    fs.mkdirSync(path.dirname(out), { recursive: true });
    fs.writeFileSync(out, zip(files));
    console.log(out + ' (' + list.length + ' preset)');
  } else {
    fs.writeFileSync(OUT, text);
    if (readmeNow !== readme) fs.writeFileSync(README, readme);
    console.log(path.relative(root, OUT) + ' ve README galerisi: ' + list.length + ' preset');
  }
}
