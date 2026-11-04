/*
 * SoundVisualizer — CaYaDev Ses Görselleştirici
 * Copyright (c) 2026 Çağan Turgut (CaYatur) — CaYaDev, https://cayadev.com
 * https://github.com/CaYatur/SoundVisualizer
 * SPDX-License-Identifier: MIT
 */
'use strict';
/* TEK PAKET (#905). Görselleştirici sayfası 85 ayrı betik yüklüyor; tek dosyada açılış ölçümde
   ~100 ms kısalıyor. Paketleme öncesi betikler sırasıyla birleştiriliyor. Dönüştürme yok, kaynak
   aynen: dosyalar zaten pencereye bağlanıyor ve hepsi 'use strict'.

   Geliştirmede sayfa eski haliyle açılıyor; ana süreç paketi yalnız paketli sürümde ya da
   SV_BUNDLED ile kullanıyor.

   Kullanım:
     node scripts/bundle-pages.js          (üretir)
     node scripts/bundle-pages.js --clean  (siler) */
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const PAGES = ['src/visualizer'];
const SCRIPT = /[ \t]*<script src="([^"]+)"><\/script>[ \t]*\r?\n/g;

/* Yazmadan üretir: test src/ altına dosya bırakmasın. */
function build(dir) {
  const abs = path.join(ROOT, dir);
  const html = fs.readFileSync(path.join(abs, 'index.html'), 'utf8');
  const parts = [];
  const scripts = [];
  const out = html.replace(SCRIPT, (whole, src) => {
    if (/^(https?:)?\/\//.test(src)) throw new Error('uzak betik pakete giremez: ' + src);
    const code = fs.readFileSync(path.join(abs, src), 'utf8');
    if (!/^\s*(\/\*[\s\S]*?\*\/\s*)*(['"])use strict\2/.test(code)) throw new Error('use strict yok: ' + src);
    parts.push('/* ' + src + ' */\n' + code);
    scripts.push(src);
    return '';
  });
  // Betikler gövdenin sonunda: paket de orada
  const page = out.replace(/<\/body>/, '    <script src="bundle.gen.js"></script>\n  </body>');
  return { scripts, bundle: "'use strict';\n" + parts.join('\n;\n'), page };
}

function bundlePage(dir) {
  const { scripts, bundle, page } = build(dir);
  const abs = path.join(ROOT, dir);
  fs.writeFileSync(path.join(abs, 'bundle.gen.js'), bundle);
  fs.writeFileSync(path.join(abs, 'index.gen.html'), page);
  return { dir, scripts: scripts.length, kb: Math.round(bundle.length / 1024) };
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

module.exports = { build, bundlePage, clean, PAGES };
