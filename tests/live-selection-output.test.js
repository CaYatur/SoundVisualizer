'use strict';
/* Canlı gösteri güvenliği: seçim yalnız arayüz durumu.

   Çizelgede klip seçmek (tık, kement, sürüklemenin başı) klip düzenleme oturumunu
   açıp kapatıyor, her biri push(true) çağırıyordu. Çıkışa giden yapılandırma
   (oturumsuz hali) aynıyken bile önizleme setConfig ile modları yeniden kuruyor,
   açık çıkış pencereleri tam yapılandırmayı alıp baştan başlıyordu: ekran bir kare
   siyaha düşüyor, animasyon sıfırlanıyordu. Artık çıkış metni son gönderilenle
   aynıysa ne önizlemeye ne çıkışa bir şey gidiyor; gerçek düzenleme yine gidiyor. */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const read = (p) => fs.readFileSync(path.join(__dirname, '..', p), 'utf8').replace(/\r\n/g, '\n');
const ADMIN = read('src/admin/admin.js');
const TLP = read('src/admin/timeline-panel.js');

function sliceFn(src, name) {
  const start = src.indexOf('function ' + name + '(');
  assert.ok(start >= 0, name);
  let i = src.indexOf('{', start);
  let depth = 0;
  for (; i < src.length; i++) {
    if (src[i] === '{') depth++;
    else if (src[i] === '}') { depth--; if (depth === 0) return src.slice(start, i + 1); }
  }
  throw new Error('end ' + name);
}

/* push yolu: sahte api, önizleme ve klip düzenleme oturumu (persistent oturumu
   çıkarıyor, gerçek SVTimelineTarget gibi). */
function panel(cfg) {
  const out = { full: 0, patch: 0, preview: 0 };
  const win = {
    api: { updateConfig: () => out.full++, patchConfig: () => out.patch++ },
    SVPreview: { setConfig: () => out.preview++ },
    SVTimelineTarget: {
      sync() {},
      persistent: (c) => {
        if (!c.timeline || !c.timeline.editTarget) return c;
        const o = Object.assign({}, c, { timeline: Object.assign({}, c.timeline) });
        delete o.timeline.editTarget;
        delete o.timeline.manualBaseline;
        return o;
      },
    },
  };
  const names = ['outputSig', 'previewConfig', 'push', 'outputConfig', 'lightSig', 'fullPayload', 'sendFullConfig', 'sendConfigPatch'];
  const src = names.map((n) => sliceFn(ADMIN, n)).join('\n');
  // eslint-disable-next-line no-new-func
  return Object.assign(new Function('window', 'env', 'setTimeout', 'clearTimeout', `
    const HEAVY_KEYS = { scenes: 1, milkdropLibrary: 1, userPresets: 1 };
    const FULL_AFTER_MS = 700;
    const sendStats = { full: 0, patch: 0, preview: 0 };
    let sentSig = null; let fullTimer = null; let heavySent = null; let pushTimer = null;
    let lastOutSig = null; let pendingOutSig = null; let lastPreviewSig = null;
    let marksFresh = false; let activeSceneId = null; let sceneActionInFlight = false;
    const isBlackedOut = () => false;
    const refreshModifiedMarks = () => {};
    const clearActiveScene = () => {};
    let cfg = env.cfg;
    ${src}
    return { push, previewConfig };
  `)(win, { cfg }, () => 0, () => {}), { out });
}

const base = () => ({ visualizer: { type: 'bars' }, layers: [{ id: 'a', kind: 'visualizer', type: 'bars' }], timeline: { tracks: [] } });

test('seçim (oturum açılıp kapanması) çıkışı ve önizlemeyi yeniden kurmuyor', () => {
  const cfg = base();
  const p = panel(cfg);
  p.push(true); // ilk tam gönderim
  assert.deepStrictEqual(p.out, { full: 1, patch: 0, preview: 1 });
  // Klip seçildi: düzenleme oturumu açıldı (yalnız panel durumu)
  cfg.timeline.editTarget = { clipId: 'c1' };
  cfg.timeline.manualBaseline = { visualizer: { type: 'bars' } };
  p.push(true);
  p.previewConfig(); // sayfa çizimi
  // Seçim kalktı: oturum kapandı
  delete cfg.timeline.editTarget;
  delete cfg.timeline.manualBaseline;
  p.push(true);
  p.previewConfig();
  assert.deepStrictEqual(p.out, { full: 1, patch: 0, preview: 1 }, 'seçim çıkışa ve önizlemeye gitmedi');
});

test('gerçek düzenleme hâlâ gidiyor; kaydırıcı yamasından sonra tam gönderim yeniden yapılıyor', () => {
  const cfg = base();
  const p = panel(cfg);
  p.push(true);
  cfg.layers[0].type = 'circular';
  p.push(true);
  assert.deepStrictEqual(p.out, { full: 2, patch: 0, preview: 2 });
  p.push(false); // kaydırıcı: önizleme her seferinde, son gönderim bilinmiyor
  assert.strictEqual(p.out.preview, 3);
  p.push(true);
  assert.strictEqual(p.out.full, 3, 'yamadan sonra push(true) yine tam gönderiyor');
});

test('çizelge: seçim takibi sürükleme sürerken ertelenir; tık commit çıkışa gönderilen yapılandırmayı değiştirmez', () => {
  const q = sliceFn(TLP, 'queueTargetFollow');
  assert.match(q, /if \(drag\) \{ followAfterDrag = true; return; \}/);
  assert.match(TLP, /const DRAG_SLOP = 4;/);
  // Sayfa çizimi önizlemeyi doğrudan değil, karşılaştırmalı yoldan kuruyor
  for (const fn of ['render', 'scheduleRender']) {
    const body = sliceFn(ADMIN, fn);
    assert.doesNotMatch(body, /SVPreview\.setConfig\(/, fn);
    assert.match(body, /previewConfig\(\)/, fn);
  }
});
