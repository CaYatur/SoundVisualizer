/*
 * SoundVisualizer — CaYaDev Ses Görselleştirici
 * Copyright (c) 2026 Çağan Turgut (CaYatur) — CaYaDev, https://cayadev.com
 * https://github.com/CaYatur/SoundVisualizer
 * SPDX-License-Identifier: MIT
 */
'use strict';
/* TEK PAKET (#905). Görselleştirici sayfası 85 ayrı betik yüklüyor; pencere açılışının en büyük
   payı bu. Paketleme öncesi betikler sırasıyla tek dosyada birleştiriliyor. Dönüştürme yok,
   kaynak aynen: dosyalar zaten pencereye bağlanıyor ve hepsi 'use strict'.

   Geliştirmede bu dosyalar yok ve sayfa eski haliyle açılıyor; ana süreç yalnız varsa kullanıyor.

   Kullanım:
     node scripts/bundle-pages.js          (üretir)
     node scripts/bundle-pages.js --clean  (siler) */
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const PAGES = ['src/visualizer'];
const SCRIPT = /[ \t]*<script src="([^"]+)"><\/script>[ \t]*\r?\n/g;

function bundlePage(dir) {
  const abs = path.join(ROOT, dir);
  const html = fs.readFileSync(path.join(abs, 'index.html'), 'utf8');
  const parts = [];
  let last = -1;
  const out = html.replace(SCRIPT, (whole, src, at) => {
    if (/^(https?:)?\/\//.test(src)) throw new Error('uzak betik pakete giremez: ' + src);
    const file = path.join(abs, src);
    const code = fs.readFileSync(file, 'utf8');
    if (!/^\s*(\/\*[\s\S]*?\*\/\s*)*(['"])use strict\2/.test(code)) throw new Error('use strict yok: ' + src);
    parts.push('/* ' + src + ' */\n' + code);
    if (at > last) last = at;
    return '';
  });
  const bundle = "'use strict';\n" + parts.join('\n;\n');
  fs.writeFileSync(path.join(abs, 'bundle.gen.js'), bundle);
  // Betikler gövdenin sonunda: paket de orada
  const page = out.replace(/<\/body>/, '    <script src="bundle.gen.js"></script>\n  </body>');
  fs.writeFileSync(path.join(abs, 'index.gen.html'), page);
  return { dir, scripts: parts.length, kb: Math.round(bundle.length / 1024) };
}

function clean() {
  for (const dir of PAGES) {
    for (const f of ['bundle.gen.js', 'index.gen.html']) {
      try { fs.unlinkSync(path.join(ROOT, dir, f)); } catch { /* yok */ }
    }
  }
}

if (require.main === module) {
  if (process.argv.includes('--clean')) clean();
  else for (const d of PAGES) console.log(JSON.stringify(bundlePage(d)));
}

module.exports = { bundlePage, clean, PAGES };
