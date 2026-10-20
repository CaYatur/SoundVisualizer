'use strict';
/* CANLI / DIŞA AKTARIM EŞLİĞİ (#539).
 *
 * Gerçek piksel karşılaştırması `npm run parity` (Electron gerekir). Burada
 * onun saf kısmı ve ölçümün bulduğu farkların kalıcı denetimleri:
 *   - 'add' karışımı canlıda 'screen'di, dışa aktarımda 'lighter';
 *   - çalan parça kartının giriş/görünürlük zarfı duvar saatindeydi;
 *   - dışa aktarıcı medya modunu ve sözlüğü yüklemiyordu;
 *   - sayfaların betik listeleri: canlı sayfada çizime giren her betik
 *     dışa aktarıcıda ve yayın katmanında da olmalı.
 */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.join(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(root, p), 'utf8');
const P = require('../scripts/parity-lib.js');

// Sayfanın yüklediği betikler, depo yoluna göre
function scripts(page) {
  const html = read(page);
  const dir = path.posix.dirname(page);
  return [...html.matchAll(/<script src="([^"]+)"/g)].map((m) => {
    const s = m[1];
    if (s.startsWith('/app/')) return 'src/' + s.slice(5);
    return path.posix.normalize(path.posix.join(dir, s));
  });
}

/* Canlı pencereye özgü, BİLEREK dışa aktarıcıda olmayanlar. Her birinin
   nedeni: dışa aktarım çevrimdışı ve kare saatiyle çiziyor. */
const LIVE_ONLY = {
  'src/visualizer/visualizer.js': 'canlı pencerenin kendisi (dışa aktarıcının yerine exporter.js)',
  'src/shared/adaptive-theme.js': 'arayüz teması; çizime girmez',
  'src/shared/icons.js': 'arayüz simgeleri',
  'src/shared/aspect.js': 'pencerenin en-boy oranı; dışa aktarımda çözünürlük seçiliyor',
  'src/shared/showclock.js': 'gösteri saati duvar saatine dayanır; dışa aktarım kare saatini kullanır',
  'src/shared/lyrics-clock.js': 'canlı söz akışının çapası; dışa aktarımda söz kare saatinden',
  'src/shared/late-event.js': 'geç açılan pencerenin çalan parçayı yakalaması',
  'src/shared/clipdeck.js': 'Clip Deck canlı tetikleme; dışa aktarımda tetik yok',
  'src/shared/milkdrop-sprites.js': 'MilkDrop sprite\'ları elle (K + numara) canlı başlatılıyor',
};

test('canlı sayfada çizime giren her betik dışa aktarıcıda ve yayın katmanında da var', () => {
  const live = scripts('src/visualizer/index.html');
  const exp = new Set(scripts('src/exporter/index.html'));
  const overlay = new Set(scripts('src/web/overlay.html'));
  const missingExp = live.filter((s) => !exp.has(s) && !LIVE_ONLY[s]);
  assert.deepStrictEqual(missingExp, [], 'dışa aktarıcıda eksik');
  const missingOverlay = live.filter((s) => !overlay.has(s) && s !== 'src/visualizer/visualizer.js');
  assert.deepStrictEqual(missingOverlay, [], 'yayın katmanında eksik');
  // İstisna listesi bayatlamasın: listedeki her betik canlı sayfada olmalı
  Object.keys(LIVE_ONLY).forEach((s) => assert.ok(live.includes(s), 'istisna artık canlı sayfada yok: ' + s));
  assert.ok(exp.has('src/visualizer/modes/media.js'), 'medya modu');
  assert.ok(exp.has('src/shared/i18n.js'), 'sözlük (metin yer tutucuları canlıdaki dilde)');
});

test('dışa aktarıcının içerik güvenliği video ve blob kaynaklarına izin veriyor', () => {
  const csp = /Content-Security-Policy" content="([^"]+)"/.exec(read('src/exporter/index.html'))[1];
  assert.match(csp, /media-src 'self' sv-media: blob: data:/);
  assert.match(csp, /img-src 'self' data: blob: sv-logo:/);
});

test("'add' karışımı iki yolda da toplamalı: CSS plus-lighter, canvas lighter", () => {
  const src = read('src/visualizer/layers.js');
  assert.match(src, /const CSS_BLEND = \(b\) => \(b === 'add' \? 'plus-lighter'/);
  assert.match(src, /const CANVAS_BLEND = \(b\) => \(b === 'add' \? 'lighter'/);
});

test('dışa aktarıcı medya katmanını kurar ve her kareden önce kare saatine sarar', () => {
  const ex = read('src/exporter/exporter.js');
  assert.match(ex, /window\.SV_OFFLINE = true;/);
  assert.match(ex, /stack\.setConfig\(cfg\);\s*\n\s*setupMedia\(\);/);
  assert.match(ex, /await seekMedia\(i \/ fps\);\s*\n\s*const data = renderFrame\(i\);/);
  const media = read('src/visualizer/modes/media.js');
  assert.match(media, /async seekTo\(sec\) \{/);
  assert.match(media, /const target = v\.loop \? s % d : Math\.min\(s, Math\.max\(0, d - 0\.001\)\);/);
  // Kuyruktaki sahnenin videosu da sunulur
  const main = read('src/main/main.js');
  assert.match(main, /exportMediaCfg = jobCfg;/);
  assert.match(main, /!inLibrary && !inExport/);
});

/* Çalan parça kartı: görünürlük zarfı kare saatinden. Duvar saati
   DONDURULMUŞ: eski kodda yaş hiç ilerlemez, kart hiç görünmezdi. */
test('çalan parça kartının "değişince göster" zarfı kare saatiyle ilerliyor', () => {
  const alphas = [];
  let alpha = 1;
  const ctx = new Proxy({}, {
    get: (_, k) => {
      if (k === 'measureText') return (s) => ({ width: String(s).length * 8 });
      if (k === 'fillText') return () => alphas[alphas.length - 1].push(alpha);
      if (k === 'createLinearGradient') return () => ({ addColorStop() {} });
      if (k === 'globalAlpha') return alpha;
      return () => {};
    },
    set: (_, k, v) => { if (k === 'globalAlpha') alpha = v; return true; },
  });
  const frozen = 1700000000000;
  const sandbox = {
    window: { SV: { hexToRgb01: () => [1, 1, 1], sampleThemeColor: () => '#fff' }, SVGlow: function () { this.apply = () => {}; } },
    Date: { now: () => frozen },
    console, Math, Number, String, Object, Array, Infinity, isFinite, Map, Set,
  };
  vm.createContext(sandbox);
  vm.runInContext(read('src/shared/nowplaying.js'), sandbox);
  vm.runInContext(read('src/visualizer/modes/nowplaying.js'), sandbox);
  const Mode = sandbox.window.SVModes.nowplaying;
  const m = new Mode({ width: 1280, height: 720, getContext: () => ctx });
  const cfg = { nowplaying: { enabled: true, source: 'manual', manual: { title: 'Song', artist: 'Artist' }, mode: 'onChange', speed: 'fast', animation: 'fade' } };
  const at = (t) => { alphas.push([]); m.draw({ bass: 0, level: 0 }, cfg, t, 1 / 30); const a = alphas[alphas.length - 1]; return a.length ? Math.max(...a) : 0; };
  assert.strictEqual(at(10), 0, 'parça bu karede geldi: henüz görünmez');
  const mid = at(10.14);
  assert.ok(mid > 0 && mid < 1, 'giriş yarıda: ' + mid);
  assert.ok(at(11) > 0.9, 'tutma: tam görünür');
  // fast: giriş 0,28 + tutma 2,5 + çıkış 0,28 → 3,06 sn sonra görünmez
  assert.strictEqual(at(13.5), 0, 'süre doldu: gizlendi');
});

test('eşlik ölçümü: karşılaştırma kanal sırasını ve sınırı doğru uyguluyor', () => {
  // Canlı BGRA, dışa aktarım RGBA: aynı renk farksız
  const live = Buffer.from([30, 20, 10, 255]);
  const exp = Buffer.from([10, 20, 30, 255]);
  assert.strictEqual(P.compare(live, 1, 1, exp, 1, 1, true).max, 0);
  const off = Buffer.from([10, 20, 60, 255]);
  const r = P.compare(live, 1, 1, off, 1, 1, true);
  assert.strictEqual(r.max, 30);
  assert.strictEqual(r.over8, 1);
  assert.strictEqual(P.passes(r), false);
  assert.strictEqual(P.passes({ mean: 0.2, over8: 0.0001 }), true);
  assert.strictEqual(P.passes({ mean: 0, over8: 0, sizeNote: 'x' }), false, 'boyut tutmazsa geçmez');
});

test('eşlik ölçümü durumları: karışımların hepsi, açılış, dönüşüm, maske, grup; canlı yol karartmaya inmez', () => {
  const names = P.cases('data:,').map((c) => c.name);
  P.BLENDS.forEach((b) => assert.ok(names.includes('blend-' + b), b));
  assert.ok(names.includes('blend-add'));
  ['opacity-transform', 'mask-rect', 'group-crossfade', 'reveal-wipe', 'reveal-scale', 'layout-basic'].forEach((n) => assert.ok(names.includes(n), n));
  assert.strictEqual(P.baseConfig().isBlackout, false, 'düz siyah + görselleştirici yok karartma sayılırdı');
  assert.strictEqual(P.baseConfig().power.pauseOnSilence, true, 'sayfanın döngüsü durmalı');
  assert.match(read('scripts/parity.js'), /single: !!st\._surface/, 'tek yüzeye inen canlı yol yakalanır');
  assert.match(read('src/visualizer/layers.js'), /if \(!reuse\) this\._drawEntry\(e, audio, cfg, t, dt, l\);/);
  assert.match(read('package.json'), /"parity": "node scripts\/parity\.js"/);
});
