'use strict';
/* macOS .app paketlerini Windows üzerinde üretir (@electron/packager ile).
   NOT: Bu makinede derlenen audify binary'si Windows'a aittir; macOS'ta sesin
   çalışması için Mac'te `npm install` (audify mac binary) gerekir. UI/görseller çalışır. */
const pkg = require('@electron/packager');
const packager = typeof pkg === 'function' ? pkg : pkg.packager;
const path = require('path');

const ROOT = path.join(__dirname, '..');

async function main() {
  const common = {
    dir: ROOT,
    name: 'CAYADEV Visualizer',
    platform: 'darwin',
    out: path.join(ROOT, 'dist'),
    overwrite: true,
    icon: path.join(ROOT, 'build', 'icon.icns'),
    appBundleId: 'com.cayadev.visualizer',
    appCategoryType: 'public.app-category.music',
    appVersion: require(path.join(ROOT, 'package.json')).version,
    prune: true,
    ignore: [/^\/dist($|\/)/, /^\/scripts($|\/)/, /\.log$/, /^\/\.git/],
    asar: { unpack: '{**/node_modules/audify/**,**/loopback-helper.js}' },
  };

  for (const arch of ['arm64', 'x64']) {
    console.log('macOS .app uretiliyor: ' + arch + ' ...');
    const out = await packager({ ...common, arch });
    console.log('  -> ' + out.join(', '));
  }
  console.log('Bitti.');
}

main().catch((e) => {
  console.error('pack-mac hata:', e);
  process.exit(1);
});
