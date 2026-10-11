'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.join(__dirname, '..');
const adminSrc = fs.readFileSync(path.join(ROOT, 'src/admin/admin.js'), 'utf8');
const previewSrc = fs.readFileSync(path.join(ROOT, 'src/admin/preview.js'), 'utf8');

function mockEl(tag, attrs = {}, children = []) {
  const elem = {
    tagName: tag.toUpperCase(),
    className: attrs.class || '',
    classList: {
      contains: (c) => (elem.className || '').split(' ').includes(c),
      add: (c) => {
        const parts = new Set((elem.className || '').split(' ').filter(Boolean));
        parts.add(c);
        elem.className = Array.from(parts).join(' ');
      },
      remove: (c) => {
        const parts = new Set((elem.className || '').split(' ').filter(Boolean));
        parts.delete(c);
        elem.className = Array.from(parts).join(' ');
      },
      toggle: (c, val) => {
        if (val) elem.classList.add(c);
        else elem.classList.remove(c);
      },
    },
    src: attrs.src || '',
    title: attrs.title || '',
    style: {},
    children: [],
    appendChild: (child) => {
      elem.children.push(child);
      child.parentNode = elem;
      return child;
    },
    remove: () => {
      if (elem.parentNode) {
        const idx = elem.parentNode.children.indexOf(elem);
        if (idx >= 0) elem.parentNode.children.splice(idx, 1);
        elem.parentNode = null;
      }
    },
    querySelector: (sel) => {
      for (const ch of elem.children) {
        if (sel.startsWith('.') && ch.classList.contains(sel.slice(1))) return ch;
        const sub = ch.querySelector ? ch.querySelector(sel) : null;
        if (sub) return sub;
      }
      return null;
    },
  };
  (Array.isArray(children) ? children : [children]).filter(Boolean).forEach((c) => elem.appendChild(c));
  return elem;
}

test('syncDynamicThemePreview: kapak fotoğrafı değiştiğinde veya geldiğinde önizleme öğesini anında günceller', () => {
  const fnMatch = adminSrc.slice(adminSrc.indexOf('function syncDynamicThemePreview(st)'), adminSrc.indexOf('function applyResolvedTheme(res, isManual)'));

  const statusInfo = mockEl('div', { class: 'dynamic-theme-status-info' });
  const statusRow = mockEl('div', { class: 'dynamic-theme-status-row' }, [statusInfo]);
  const panel = mockEl('div', { class: 'dynamic-theme-panel' }, [statusRow]);

  const doc = {
    querySelector: (sel) => (sel === '.dynamic-theme-panel' ? panel : null),
  };

  const sandbox = {
    document: doc,
    el: mockEl,
    tr: (s) => s,
    window: { SVNowLive: { state: null } },
  };
  vm.runInNewContext(fnMatch, sandbox);

  // 1. Kapaklı yeni parça geldiğinde
  const st1 = {
    has: true,
    title: 'Şarkı 1',
    artist: 'Sanatçı 1',
    artwork: 'data:image/jpeg;base64,ILK_KAPAK_VERISI_1234567890',
  };
  sandbox.syncDynamicThemePreview(st1);

  const thumb1 = statusRow.querySelector('.dynamic-theme-art-thumb');
  assert.ok(thumb1, 'Kapak thumbnail elementi oluşturulmalı');
  assert.strictEqual(thumb1.src, st1.artwork, 'Kapak kaynağı güncel olmalı');

  // 2. Kapak fotoğrafı değiştiğinde hemen güncellenmeli
  const st2 = {
    has: true,
    title: 'Şarkı 1',
    artist: 'Sanatçı 1',
    artwork: 'data:image/jpeg;base64,YENI_GUNCEL_KAPAK_9876543210',
  };
  sandbox.syncDynamicThemePreview(st2);

  const thumb2 = statusRow.querySelector('.dynamic-theme-art-thumb');
  assert.strictEqual(thumb2, thumb1, 'Aynı element yeniden kullanılmalı');
  assert.strictEqual(thumb2.src, st2.artwork, 'Yeni kapak anında çizilmeli/yansımalı');

  // 3. Kapak kalktığında element silinmeli
  sandbox.syncDynamicThemePreview({ has: true, title: 'Şarkı 2', artwork: '' });
  assert.strictEqual(statusRow.querySelector('.dynamic-theme-art-thumb'), null, 'Kapak yoksa kaldırılmalı');
});

test('handleDynamicThemeTrackUpdate: kapak başlığı aynı JPEG prefix taşısada yeni kapağı tanır ve çözümler', () => {
  // admin.js içindeki handleDynamicThemeTrackUpdate bloğunu test et
  const fnStart = adminSrc.indexOf('function handleDynamicThemeTrackUpdate(st)');
  const fnEnd = adminSrc.indexOf('function dynamicThemeCtrl()');
  const code = adminSrc.slice(fnStart, fnEnd);

  let appliedTrack = null;
  const commonPrefix = 'data:image/jpeg;base64,/9j/4AAQSkZJRgABAQEASABIAAD/2wBDAP//////////////////////////////////////////////////////////////////////////////////////wgALCA==';

  const artA = commonPrefix + '_RESIM_A_' + 'A'.repeat(200);
  const artB = commonPrefix + '_RESIM_B_' + 'B'.repeat(200);

  const cfg = {
    dynamicTheme: { enabled: true, mode: 'artwork' },
  };

  const sandbox = {
    cfg,
    lastDynamicTrackKey: '',
    lastDynamicArtwork: '',
    dynamicArtworkWaitTimer: null,
    pendingDynamicTrackState: null,
    clearDynamicArtworkTimer: () => {},
    resolveAndApplyDynamicTheme: (st) => { appliedTrack = st; },
    syncDynamicThemePreview: () => {},
    window: { SV_PLATFORM: { isWindows: true } },
  };

  vm.runInNewContext(code, sandbox);

  // Parça 1 için ilk kapak
  sandbox.handleDynamicThemeTrackUpdate({
    has: true,
    title: 'Parça',
    artist: 'Sanatçı',
    artwork: artA,
  });
  assert.ok(appliedTrack, 'İlk kapak çözülmeli');
  assert.strictEqual(appliedTrack.artwork, artA);

  appliedTrack = null;
  // Parça adı aynı kalıp veya değişip ortak 120-karakter JPEG başlığı taşıyan ikinci kapak geldiğinde:
  sandbox.handleDynamicThemeTrackUpdate({
    has: true,
    title: 'Parça',
    artist: 'Sanatçı',
    artwork: artB,
  });
  assert.ok(appliedTrack, 'Başlığı aynı prefix taşısa bile yeni kapak anında algılanıp çözülmeli');
  assert.strictEqual(appliedTrack.artwork, artB);
});

test('SVPreview: drawOnce fonksiyonu dışa aktarılır ve renderFrame çağırır', () => {
  assert.match(previewSrc, /function drawOnce\s*\(\)\s*\{/);
  assert.match(previewSrc, /drawOnce,\s*\n\s*notePresets/);
  assert.match(previewSrc, /window\.SVPreview\s*=\s*\{[\s\S]*drawOnce/);
  assert.match(previewSrc, /onNowPlaying\(\(st\)[\s\S]*drawOnce\(\)/);
});
