'use strict';
/* KATMAN PANOSU DÜZENİ (#622).
 *
 * Her katman bütün ayarlarıyla açık duruyordu: altı katmanlı gerçek bir
 * sahnede kart 4.356 piksel boyundaydı. Artık katmanlar kapalı geliyor,
 * başlık özetliyor, açık olanlar bu makinede hatırlanıyor ve alt bölümler
 * bir sekme şeridinde. Pano sahte bir DOM'la kuruluyor: `el` düğüm ağacı
 * döndürüyor, sınıf ve metinle aranıyor. */
const test = require('node:test');
const assert = require('node:assert');

global.window = global.window || {};
require('../src/shared/defaults.js');
require('../src/shared/lyrics-clock.js');
require('../src/admin/lyrics-lib-ui.js');
const L = require('../src/visualizer/layers.js');

function setup(layers, openIds) {
  const store = {};
  if (openIds) store['sv-layers-open'] = JSON.stringify(openIds);
  global.localStorage = {
    getItem: (k) => (k in store ? store[k] : null),
    setItem: (k, v) => { store[k] = String(v); },
    removeItem: (k) => { delete store[k]; },
  };
  const cfg = window.SV.defaultConfig();
  cfg.layerStack = { enabled: true };
  cfg.layers = layers.map((l) => L.normalizeLayer(l));
  let renders = 0;
  const el = (tag, attrs, children) => {
    const node = { tag, attrs: attrs || {}, children: (children || []).filter(Boolean), style: {}, classList: { toggle() {}, add() {} } };
    node.appendChild = (c) => { node.children.push(c); return c; };
    node.setAttribute = (k, v) => { node.attrs[k] = v; };
    node.querySelector = (sel) => querySelector(node, sel);
    node.getAttribute = (k) => node.attrs[k];
    return node;
  };
  window.SVLayers = L;
  window.SVPanel = {
    el,
    cfg: () => cfg,
    row: (label, ctrl) => el('div', { class: 'ctrl' }, [el('div', { class: 'row' }, [el('label', { class: 'lbl', text: label }), ctrl])]),
    push() {},
    apply: () => { renders++; },
    rerender: () => { renders++; },
    toast() {},
    confirm: async () => true,
    isModified: () => false,
    resetPath() {},
    defaultAt: () => undefined,
  };
  delete require.cache[require.resolve('../src/admin/scene-panels.js')];
  require('../src/admin/scene-panels.js');
  const panel = window.SVScenePanels.layersPanel();
  return { panel, cfg, store, renders: () => renders };
}

function querySelector(root, sel) {
  const wantTag = sel.startsWith('.') ? '' : sel.split('.')[0];
  const wantClass = sel.startsWith('.') ? sel.slice(1) : sel.split('.').slice(1).join('.');
  const walk = (n) => {
    for (const c of n.children || []) {
      const cls = typeof c.attrs?.class === 'string' ? c.attrs.class.split(/\s+/) : [];
      const tagOk = !wantTag || c.tag === wantTag;
      const classOk = !wantClass || cls.includes(wantClass);
      if (tagOk && classOk && (wantTag || wantClass)) return c;
      const inner = walk(c);
      if (inner) return inner;
    }
    return null;
  };
  return walk(root);
}

const all = (node, pred, out = []) => {
  if (!node || typeof node !== 'object') return out;
  if (pred(node)) out.push(node);
  for (const c of node.children || []) all(c, pred, out);
  return out;
};
const cls = (name) => (n) => typeof n.attrs.class === 'string' && n.attrs.class.split(/\s+/).includes(name);

const LAYERS = [
  { id: 'bg', kind: 'background', type: 'hexpulse', name: 'Arkaplan' },
  { id: 'v1', kind: 'visualizer', type: 'bars', name: 'Görselleştirici', blend: 'screen', opacity: 0.8 },
  { id: 'lg', kind: 'logo', type: 'back', name: 'Logo' },
];

test('katmanlar kapalı geliyor: başlık var, ayar gövdesi yok', () => {
  const { panel } = setup(LAYERS);
  const items = all(panel, cls('layer'));
  assert.strictEqual(items.length, 3, 'her katman bir satır');
  assert.strictEqual(all(panel, cls('layer-body')).length, 0, 'hiçbir katmanın ayarı açık değil');
  assert.strictEqual(all(panel, cls('layer-head')).length, 3);
});

test('başlık kaynağı, karışımı ve saydamlığı özetliyor', () => {
  const { panel } = setup(LAYERS);
  const smalls = all(panel, (n) => n.tag === 'small').map((n) => n.attrs.text);
  assert.ok(smalls.some((t) => /Barlar/.test(t) && /Ekran/.test(t) && /%80/.test(t)), 'özet: ' + smalls.join(' | '));
});

test('açık katman hatırlanıyor ve alt bölümler sekme şeridinde', () => {
  const { panel } = setup(LAYERS, ['v1']);
  const bodies = all(panel, cls('layer-body'));
  assert.strictEqual(bodies.length, 1, 'yalnız hatırlanan katman açık');
  const tabs = all(bodies[0], cls('layer-tab')).map((n) => n.attrs.text);
  assert.deepStrictEqual(tabs, ['Dönüşüm', 'Sese Tepki', 'Maske', 'Katman Efektleri', 'Grup ve Fader']);
  assert.strictEqual(all(bodies[0], cls('fold')).length, 0, 'eski katlanır başlıklar kalmadı');
});

test('aç/kapa durumu kaydediliyor, yeni eklenen katman açık geliyor', () => {
  const { panel, store, cfg } = setup(LAYERS);
  const toggle = all(panel, cls('layer-name'))[0];
  toggle.attrs.onclick();
  assert.deepStrictEqual(JSON.parse(store['sv-layers-open']), ['lg'], 'en üstteki (logo) açıldı');
  const add = all(panel, (n) => n.tag === 'button' && /Medya$/.test(n.attrs.text || ''))[0];
  add.attrs.onclick();
  const made = cfg.layers[cfg.layers.length - 1];
  assert.strictEqual(made.kind, 'media');
  assert.ok(JSON.parse(store['sv-layers-open']).includes(made.id), 'yeni katman açık');
});


test('nowplaying add button creates nowplaying kind layer', () => {
  const { panel, cfg } = setup(LAYERS);
  const add = all(panel, (n) => n.tag === 'button' && /Çalan Parça$/.test(n.attrs.text || ''))[0];
  assert.ok(add, 'Çalan Parça add button present');
  add.attrs.onclick();
  const made = cfg.layers[cfg.layers.length - 1];
  assert.strictEqual(made.kind, 'nowplaying');
  assert.strictEqual(made.type, 'nowplaying');
  assert.ok(made.settings && made.settings.nowplaying);
});

test('kilitli katman açılamıyor', () => {
  const { panel } = setup([{ id: 'k', kind: 'visualizer', type: 'bars', locked: true }], ['k']);
  assert.strictEqual(all(panel, cls('layer-tabs')).length, 0);
  assert.ok(all(panel, (n) => /kilitli/.test(n.attrs.text || '')).length, 'kilit notu görünüyor');
});

test('layers category controls get ctrl-reset; stack switch does not', () => {
  const fs = require('fs');
  const path = require('path');
  const src = fs.readFileSync(path.join(__dirname, '..', 'src', 'admin', 'scene-panels.js'), 'utf8');
  assert.match(src, /function attachPath/);
  assert.match(src, /attachPath\([\s\S]*?'background\.transparent'/);
  assert.match(src, /attachPath\([\s\S]*?'background\.coverTaskbar'/);
  assert.match(src, /attachPath\([\s\S]*?'background\.transparentKey'/);
  assert.match(src, /layers-cta/);
  assert.doesNotMatch(src, /attachPath\([\s\S]{0,220}stackSwitch[\s\S]{0,100}layerStack\.enabled/);
  const admin = fs.readFileSync(path.join(__dirname, '..', 'src', 'admin', 'admin.js'), 'utf8');
  assert.match(admin, /id: 'layers'[\s\S]*?roots:\s*\['layers'/);
  assert.match(admin, /fabrika varsay/);
  const css = fs.readFileSync(path.join(__dirname, '..', 'src', 'admin', 'admin.css'), 'utf8');
  assert.match(css, /\.btn\.layers-cta/);
});

test('round-image helper ships and is wired for glow silhouette', () => {
  const fs = require('fs');
  const path = require('path');
  const ri = fs.readFileSync(path.join(__dirname, '..', 'src', 'visualizer', 'modes', 'round-image.js'), 'utf8');
  assert.match(ri, /function drawImage/);
  assert.match(ri, /shadowBlur/);
  assert.match(ri, /clip\(\)/);
  const layers = fs.readFileSync(path.join(__dirname, '..', 'src', 'visualizer', 'layers.js'), 'utf8');
  assert.match(layers, /SVRoundImage/);
  const sprites = fs.readFileSync(path.join(__dirname, '..', 'src', 'visualizer', 'modes', 'sprites.js'), 'utf8');
  assert.match(sprites, /SVRoundImage/);
  const np = fs.readFileSync(path.join(__dirname, '..', 'src', 'visualizer', 'modes', 'nowplaying.js'), 'utf8');
  assert.match(np, /SVRoundImage/);
  assert.match(np, /coverGlow/);
  const adminHtml = fs.readFileSync(path.join(__dirname, '..', 'src', 'admin', 'index.html'), 'utf8');
  const visHtml = fs.readFileSync(path.join(__dirname, '..', 'src', 'visualizer', 'index.html'), 'utf8');
  assert.match(adminHtml, /round-image\.js/);
  assert.match(visHtml, /round-image\.js/);
});


test('layer-internal mini helpers use attachDefault with def', () => {
  const fs = require('fs');
  const path = require('path');
  const src = fs.readFileSync(path.join(__dirname, '..', 'src', 'admin', 'scene-panels.js'), 'utf8');
  assert.match(src, /function attachDefault/);
  assert.match(src, /o\.def !== undefined \? attachDefault/);
  assert.match(src, /getL\('x',[\s\S]*?def:\s*0\.5/);
  assert.match(src, /l\.opacity[\s\S]*?def:\s*1/);
  assert.match(src, /l\.transform\.scale[\s\S]*?def:\s*1/);
  assert.doesNotMatch(src, /attachPath\([\s\S]{0,220}stackSwitch[\s\S]{0,100}layerStack\.enabled/);
});

test('Use Layer Stack toggle is visually distinct from other switches', () => {
  const fs = require('fs');
  const path = require('path');
  const src = fs.readFileSync(path.join(__dirname, '..', 'src', 'admin', 'scene-panels.js'), 'utf8');
  assert.match(src, /class:\s*'ctrl layer-stack-toggle'/);
  assert.match(src, /Katman Yığınını Kullan/);
  const css = fs.readFileSync(path.join(__dirname, '..', 'src', 'admin', 'admin.css'), 'utf8');
  assert.match(css, /\.ctrl\.layer-stack-toggle\s*\{/);
  assert.match(css, /\.btn\.layers-cta/);
  const { panel } = setup(LAYERS);
  const marked = all(panel, cls('layer-stack-toggle'));
  assert.strictEqual(marked.length, 1, 'exactly one master stack toggle');
});

test('attachDefault registers local-def sync so modified refreshes without rerender', () => {
  const fs = require('fs');
  const path = require('path');
  const src = fs.readFileSync(path.join(__dirname, '..', 'src', 'admin', 'scene-panels.js'), 'utf8');
  assert.match(src, /data-sv-local-def/);
  assert.match(src, /_svSyncModified\s*=\s*syncModified/);
  assert.match(src, /classList\.toggle\('modified',\s*mod\)/);
  const admin = fs.readFileSync(path.join(__dirname, '..', 'src', 'admin', 'admin.js'), 'utf8');
  assert.match(admin, /\.ctrl\[data-sv-local-def\]/);
  assert.match(admin, /node\._svSyncModified/);
});

test('open layer control gets data-sv-local-def and syncs modified on change', () => {
  // Start at factory opacity (1) so modified is false until we drag.
  const { panel, cfg } = setup([
    { id: 'v1', kind: 'visualizer', type: 'bars', name: 'Görselleştirici', opacity: 1 },
  ], ['v1']);
  const ctrls = all(panel, (n) => n.attrs && n.attrs['data-sv-local-def'] === '1');
  assert.ok(ctrls.length > 0, 'open layer should expose local-def controls');
  const opacity = ctrls.find((c) => {
    const labels = all(c, (n) => n.tag === 'label' && n.attrs.text === 'Saydamlık');
    return labels.length > 0;
  });
  assert.ok(opacity, 'opacity control with local-def');
  assert.strictEqual(typeof opacity._svSyncModified, 'function');
  const range = all(opacity, (n) => n.tag === 'input' && n.attrs.type === 'range')[0];
  assert.ok(range, 'opacity range input');
  let modified = null;
  opacity.classList.toggle = (name, on) => { if (name === 'modified') modified = !!on; };
  opacity._svSyncModified();
  assert.strictEqual(modified, false, 'at default: not modified');
  range.attrs.oninput({ target: { value: '0.4' } });
  opacity._svSyncModified();
  assert.strictEqual(modified, true, 'modified after change');
  assert.ok(Math.abs(cfg.layers.find((l) => l.id === 'v1').opacity - 0.4) < 1e-6);
  range.attrs.oninput({ target: { value: '1' } });
  opacity._svSyncModified();
  assert.strictEqual(modified, false, 'clears when back to default');
});

function rowOf(root, label) {
  return all(root, (n) => n.attrs && typeof n.attrs.class === 'string' && n.attrs.class.split(/\s+/).includes('row')
    && (n.children || []).some((c) => c.attrs && c.attrs.text === label))[0];
}

function selectOf(row) {
  return all(row, (n) => n.tag === 'select')[0];
}

function ctrlOf(root, label) {
  return all(root, (n) => (n.children || []).some((c) => c.attrs
    && typeof c.attrs.class === 'string'
    && c.attrs.class.split(/\s+/).includes('row')
    && (c.children || []).some((g) => g.attrs && g.attrs.text === label)))[0];
}

function rangeOf(root, label) {
  return all(ctrlOf(root, label), (n) => n.tag === 'input' && n.attrs.type === 'range')[0];
}

function resetOf(root, label) {
  const row = rowOf(root, label);
  return row ? all(row, (n) => n.tag === 'button' && typeof n.attrs.class === 'string' && n.attrs.class.split(/\s+/).includes('ctrl-reset'))[0] : null;
}

function openTab(panel, label) {
  const btn = all(panel, (n) => n.tag === 'button' && n.attrs && n.attrs.text === label
    && typeof n.attrs.class === 'string' && n.attrs.class.split(/\s+/).includes('layer-tab'))[0];
  assert.ok(btn, 'sekme ' + label);
  btn.attrs.onclick();
}

test('çalan parça katmanı hizalamayı ve ekranda kalma süresini yazar; linux süre alanlarını gizler', () => {
  const prev = window.SV_PLATFORM;
  window.SV_PLATFORM = { os: 'linux', isWindows: false, isMac: false, isLinux: true };
  try {
    const { cfg } = setup([{ id: 'np', kind: 'nowplaying', type: 'nowplaying', name: 'Çalan' }], ['np']);
    let panel = window.SVScenePanels.layersPanel();
    const align = rowOf(panel, 'Hizalama');
    assert.ok(align, 'hizalama satırı');
    selectOf(align).attrs.onchange({ target: { value: 'right' } });
    const np = cfg.layers[0].settings.nowplaying;
    assert.strictEqual(np.align, 'right');
    assert.strictEqual(np.source, 'manual');
    assert.strictEqual(rowOf(panel, 'Geçen Süre'), undefined);
    assert.strictEqual(rowOf(panel, 'İlerleme Çubuğu'), undefined);
    selectOf(rowOf(panel, 'Ne Zaman')).attrs.onchange({ target: { value: 'onChange' } });
    panel = window.SVScenePanels.layersPanel();
    const hold = rowOf(panel, 'Ekranda Kalma');
    assert.ok(hold, 'ekranda kalma');
    rangeOf(panel, 'Ekranda Kalma').attrs.oninput({ target: { value: '6.5' } });
    assert.strictEqual(cfg.layers[0].settings.nowplaying.holdSeconds, 6.5);
    assert.strictEqual(rowOf(panel, 'Yatay'), undefined, 'konum dönüşüm sekmesinde');
    assert.strictEqual(rowOf(panel, 'Geçen Süre'), undefined);
    const sure = all(ctrlOf(panel, 'Süre'), (n) => n.tag === 'input')[0];
    assert.ok(sure, 'süre elle');
    sure.attrs.oninput({ target: { value: '3:24' } });
    assert.strictEqual(cfg.layers[0].settings.nowplaying.manual.duration, 204);
    openTab(panel, 'Hareket');
    assert.ok(rowOf(panel, 'Giriş Süresi'), 'giriş süresi hareket sekmesinde');
  } finally {
    window.SV_PLATFORM = prev;
  }
});

test('çalan parça katmanı Windows’ta geçen süreyi ve çubuğu gösterir', () => {
  const prev = window.SV_PLATFORM;
  window.SV_PLATFORM = { os: 'win32', isWindows: true, isMac: false, isLinux: false };
  try {
    const { cfg } = setup([{ id: 'np', kind: 'nowplaying', type: 'nowplaying', name: 'Çalan' }], ['np']);
    const panel = window.SVScenePanels.layersPanel();
    assert.strictEqual(rowOf(panel, 'Süre'), undefined, 'sistem süresi elle kutusu açmaz');
    assert.ok(rowOf(panel, 'Hizalama'));
    openTab(panel, 'Yazı');
    assert.ok(rowOf(panel, 'Geçen Süre'));
    assert.ok(rowOf(panel, 'İlerleme Çubuğu'));
    assert.ok(rowOf(panel, 'Uzun Adları Kaydır'));
    assert.ok(resetOf(panel, 'En Fazla Genişlik'), 'çalan parça genişliği sıfırlanabilir');
    const npSpeed = rangeOf(panel, 'Kaydırma Hızı');
    assert.ok(npSpeed, 'çalan parça kaydırma hızı');
    npSpeed.attrs.oninput({ target: { value: '1.75' } });
    assert.strictEqual(cfg.layers[0].settings.nowplaying.scrollSpeed, 1.75);
  } finally {
    window.SV_PLATFORM = prev;
  }
});

test('metin katmanı yatay konumu ve giriş süresini yazar', () => {
  const { cfg } = setup([{ id: 'tx', kind: 'visualizer', type: 'text', name: 'Yazı' }], ['tx']);
  const panel = window.SVScenePanels.layersPanel();
  assert.strictEqual(rowOf(panel, 'Yatay'), undefined, 'ikinci yatay kaydırıcı yok');
  assert.ok(rowOf(panel, 'Hizalama'));
  const textX = cfg.layers[0].settings.text.x;
  openTab(panel, 'Dönüşüm');
  rangeOf(panel, 'Yatay Konum').attrs.oninput({ target: { value: '0.2' } });
  assert.strictEqual(cfg.layers[0].transform.x, 0.2);
  assert.strictEqual(cfg.layers[0].settings.text.x, textX);
  openTab(panel, 'Hareket');
  assert.ok(rowOf(panel, 'Giriş Süresi'));
  assert.ok(rowOf(panel, 'Uzun Yazıyı Kaydır'), 'uzun yazı kaydırma anahtarı');
  const speed = rangeOf(panel, 'Kaydırma Hızı');
  assert.ok(speed, 'kaydırma hızı');
  speed.attrs.oninput({ target: { value: '2.5' } });
  assert.strictEqual(cfg.layers[0].settings.text.scrollSpeed, 2.5);
  const toggle = all(rowOf(panel, 'Uzun Yazıyı Kaydır'), (n) => n.tag === 'input' && n.attrs.type === 'checkbox')[0];
  toggle.attrs.onchange({ target: { checked: false } });
  assert.strictEqual(cfg.layers[0].settings.text.scrollOverflow, false);
  const hidden = window.SVScenePanels.layersPanel();
  assert.strictEqual(rowOf(hidden, 'Kaydırma Hızı'), undefined, 'kaydırma kapalıyken hız gizlenir');
  selectOf(rowOf(panel, 'Metin Kaynağı')).attrs.onchange({ target: { value: 'lyrics' } });
  const again = window.SVScenePanels.layersPanel();
  assert.ok(rowOf(again, 'Senkron Kayması'));
  assert.ok(rowOf(again, 'Karaoke Vurgusu'));
});

test('metin katmanında yazı boyutu ve en fazla genişlik varsayılana döner', () => {
  const { cfg } = setup([{ id: 'tx', kind: 'visualizer', type: 'text', name: 'Yazı' }], ['tx']);
  let panel = window.SVScenePanels.layersPanel();
  assert.ok(resetOf(panel, 'Yazı Boyutu'), 'yazı boyutu sıfırlama düğmesi');
  assert.ok(resetOf(panel, 'En Fazla Genişlik'), 'en fazla genişlik sıfırlama düğmesi');
  const click = { preventDefault() {}, stopPropagation() {} };
  rangeOf(panel, 'Yazı Boyutu').attrs.oninput({ target: { value: '0.2' } });
  assert.strictEqual(cfg.layers[0].settings.text.size, 0.2);
  resetOf(panel, 'Yazı Boyutu').attrs.onclick(click);
  assert.strictEqual(cfg.layers[0].settings.text.size, 0.09);
  panel = window.SVScenePanels.layersPanel();
  rangeOf(panel, 'En Fazla Genişlik').attrs.oninput({ target: { value: '0.4' } });
  assert.strictEqual(cfg.layers[0].settings.text.maxWidth, 0.4);
  resetOf(panel, 'En Fazla Genişlik').attrs.onclick(click);
  assert.strictEqual(cfg.layers[0].settings.text.maxWidth, 0.9);
});

test('vurgu rengi yalnız şarkı sözünde görünür', () => {
  setup([{ id: 'tx', kind: 'visualizer', type: 'text', name: 'Yazı' }], ['tx']);
  let panel = window.SVScenePanels.layersPanel();
  const sabit = all(panel, (n) => n.tag === 'button' && n.attrs && n.attrs.text === 'Sabit Renk')[0];
  assert.ok(sabit, 'sabit renk');
  sabit.attrs.onclick();
  panel = window.SVScenePanels.layersPanel();
  assert.ok(rowOf(panel, 'Metin Rengi'));
  assert.strictEqual(rowOf(panel, 'Vurgu Rengi'), undefined, 'sabit yazıda vurgu rengi yok');
  selectOf(rowOf(panel, 'Metin Kaynağı')).attrs.onchange({ target: { value: 'lyrics' } });
  panel = window.SVScenePanels.layersPanel();
  assert.ok(rowOf(panel, 'Vurgu Rengi'), 'şarkı sözünde vurgu rengi');
  assert.ok(all(panel, (n) => n.attrs && typeof n.attrs.text === 'string' && n.attrs.text.indexOf('Söylenen kısmı boyar') >= 0).length);
});

function layerItem(panel, name) {
  return all(panel, cls('layer')).find((item) => all(item, (n) => n.attrs && n.attrs.text === name).length > 0);
}

function clickSeg(item, label) {
  const btn = all(item, (n) => n.tag === 'button' && n.attrs && n.attrs.text === label)[0];
  assert.ok(btn, label);
  btn.attrs.onclick();
}

test('şarkı sözünün dikey konumu ve hizası yalnız o katmana yazılır', () => {
  const { cfg } = setup([
    { id: 'a', kind: 'visualizer', type: 'text', name: 'Söz', settings: { text: { source: 'lyrics' } } },
    { id: 'b', kind: 'visualizer', type: 'text', name: 'Sabit' },
  ], ['a', 'b']);
  const panel = window.SVScenePanels.layersPanel();
  const soz = layerItem(panel, 'Söz');
  rangeOf(soz, 'Dikey Konum').attrs.oninput({ target: { value: '0' } });
  selectOf(rowOf(soz, 'Dikey Hiza')).attrs.onchange({ target: { value: 'top' } });
  const a = cfg.layers.find((l) => l.id === 'a');
  const b = cfg.layers.find((l) => l.id === 'b');
  assert.strictEqual(a.settings.text.y, 0);
  assert.strictEqual(a.settings.text.vAlign, 'top');
  assert.notStrictEqual(b.settings.text.y, 0);
  assert.ok(!b.settings.text.vAlign);
  const yRange = rangeOf(soz, 'Dikey Konum');
  assert.strictEqual(String(yRange.attrs.min), '0');
  assert.strictEqual(String(yRange.attrs.max), '1');
});

test('bir yazının renk modu diğer yazıları ve sahneyi değiştirmez', () => {
  const { cfg } = setup([
    { id: 'a', kind: 'visualizer', type: 'text', name: 'Bir' },
    { id: 'b', kind: 'visualizer', type: 'text', name: 'İki' },
  ], ['a', 'b']);
  const sceneMode = cfg.visualizer.colorMode;
  let panel = window.SVScenePanels.layersPanel();
  clickSeg(layerItem(panel, 'Bir'), 'Gökkuşağı');
  const bir = cfg.layers.find((l) => l.id === 'a');
  const iki = cfg.layers.find((l) => l.id === 'b');
  assert.strictEqual(bir.settings.text.colorMode, 'rainbow');
  assert.strictEqual(bir.settings.text.useCustomColor, false);
  assert.ok(iki.settings.text.colorMode == null);
  assert.strictEqual(cfg.visualizer.colorMode, sceneMode);
  assert.strictEqual(cfg.visualizer.rainbow, false);
  panel = window.SVScenePanels.layersPanel();
  const birBtn = all(layerItem(panel, 'Bir'), (n) => n.tag === 'button' && n.attrs && n.attrs.text === 'Gökkuşağı')[0];
  const ikiBtn = all(layerItem(panel, 'İki'), (n) => n.tag === 'button' && n.attrs && n.attrs.text === 'Renk Teması')[0];
  assert.ok(String(birBtn.attrs.class).split(/\s+/).includes('active'));
  assert.ok(String(ikiBtn.attrs.class).split(/\s+/).includes('active'));
});

test('çalan parçanın renk modu ve yazı rengi yalnız o katmana yazılır', () => {
  const { cfg } = setup([
    { id: 'a', kind: 'nowplaying', type: 'nowplaying', name: 'Bir' },
    { id: 'b', kind: 'nowplaying', type: 'nowplaying', name: 'İki' },
  ], ['a', 'b']);
  const sceneColor = cfg.nowplaying.color;
  let panel = window.SVScenePanels.layersPanel();
  clickSeg(layerItem(panel, 'Bir'), 'Sabit Renk');
  panel = window.SVScenePanels.layersPanel();
  const color = all(rowOf(layerItem(panel, 'Bir'), 'Parça Adı'), (n) => n.tag === 'input' && n.attrs.type === 'color')[0];
  assert.ok(color, 'parça adı rengi');
  color.attrs.oninput({ target: { value: '#112233' } });
  const bir = cfg.layers.find((l) => l.id === 'a');
  const iki = cfg.layers.find((l) => l.id === 'b');
  assert.strictEqual(bir.settings.visualizer.colorMode, 'custom');
  assert.strictEqual(bir.settings.nowplaying.colorMode, 'custom');
  assert.strictEqual(bir.settings.nowplaying.color, '#112233');
  assert.ok(!iki.settings.visualizer || iki.settings.visualizer.colorMode == null);
  assert.ok(!iki.settings.nowplaying || iki.settings.nowplaying.color !== '#112233');
  assert.strictEqual(cfg.nowplaying.color, sceneColor);
  assert.notStrictEqual(cfg.nowplaying.useCustomColor, true);
  assert.strictEqual(cfg.visualizer.colorMode, 'theme');
});

test('arkaplan katmanının renk modu ve düz rengi diğer arkaplanlara yazılmaz', () => {
  const { cfg } = setup([
    { id: 'a', kind: 'background', type: 'gradient', name: 'Bir' },
    { id: 'b', kind: 'background', type: 'gradient', name: 'İki' },
  ], ['a', 'b']);
  const sceneMode = cfg.background.colorMode;
  const sceneSolid = cfg.background.solidColor;
  let panel = window.SVScenePanels.layersPanel();
  clickSeg(layerItem(panel, 'Bir'), 'Düz Renk');
  panel = window.SVScenePanels.layersPanel();
  const color = all(rowOf(layerItem(panel, 'Bir'), 'Düz Renk'), (n) => n.tag === 'input' && n.attrs.type === 'color')[0];
  assert.ok(color, 'düz renk');
  color.attrs.oninput({ target: { value: '#abcdef' } });
  const bir = cfg.layers.find((l) => l.id === 'a');
  const iki = cfg.layers.find((l) => l.id === 'b');
  assert.strictEqual(bir.settings.background.colorMode, 'solid');
  assert.strictEqual(bir.settings.background.solidColor, '#abcdef');
  assert.ok(!iki.settings.background || iki.settings.background.colorMode == null);
  assert.strictEqual(cfg.background.colorMode, sceneMode);
  assert.strictEqual(cfg.background.solidColor, sceneSolid);
  const drawn = L.layerConfig(cfg, bir);
  const other = L.layerConfig(cfg, iki);
  assert.strictEqual(drawn.background.colorMode, 'solid');
  assert.strictEqual(drawn.background.solidColor, '#abcdef');
  assert.strictEqual(other.background.colorMode, sceneMode);

  const birItem = layerItem(panel, 'Bir');
  const texts = all(birItem, (n) => n.attrs && typeof n.attrs.text === 'string').map((n) => n.attrs.text);
  for (const label of [
    'Yumuşak (Parlamasız)', 'Plazma (Parlamalı)', 'Hareket', 'Görünüm', 'Sese Tepki',
    'Tek Yönlü Kayma', 'Gezinme Alanı', 'Dolanma Miktarı', 'İç Dönüş (Swirl)',
    'Bozulma (Akışkanlık)', 'Ölçek (Yoğunluk)', 'Parlaklık (Temel)',
    'Hat Çizgilerini Gizle', 'Gren', 'Ses Patlaması (Parlaklık)', 'Ses ile Renk Kayması',
  ]) {
    assert.ok(texts.includes(label), label);
  }
  assert.ok(!texts.includes('Bozulma (Warp)'), 'eski karışık etiket kalmamalı');
  const warpCtrl = ctrlOf(birItem, 'Bozulma (Akışkanlık)');
  assert.strictEqual(warpCtrl.attrs['data-anchor'], 'Bozulma (Akışkanlık)');
  const warp = rangeOf(birItem, 'Bozulma (Akışkanlık)');
  assert.strictEqual(Number(warp.attrs.value), cfg.background.gradient.warp);
  warp.attrs.oninput({ target: { value: '1.4' } });
  assert.strictEqual(bir.settings.background.gradient.warp, 1.4);
  assert.ok(!iki.settings.background.gradient || iki.settings.background.gradient.warp == null);
  assert.strictEqual(L.layerConfig(cfg, bir).background.gradient.warp, 1.4);
  assert.strictEqual(L.layerConfig(cfg, iki).background.gradient.warp, cfg.background.gradient.warp);
  resetOf(birItem, 'Bozulma (Akışkanlık)').attrs.onclick({ preventDefault() {}, stopPropagation() {} });
  assert.strictEqual(bir.settings.background.gradient.warp, 0.58);
  selectOf(rowOf(birItem, 'Stil')).attrs.onchange({ target: { value: 'soft' } });
  assert.strictEqual(bir.settings.background.gradient.style, 'soft');
  assert.ok(!iki.settings.background.gradient || iki.settings.background.gradient.style == null);
  const hide = all(rowOf(birItem, 'Hat Çizgilerini Gizle'), (n) => n.tag === 'input' && n.attrs.type === 'checkbox')[0];
  hide.attrs.onchange({ target: { checked: false } });
  assert.strictEqual(bir.settings.background.gradient.hideLines, false);
  assert.strictEqual(L.layerConfig(cfg, bir).background.gradient.hideLines, false);
  assert.strictEqual(L.layerConfig(cfg, iki).background.gradient.hideLines, true);
  rangeOf(birItem, 'Ses ile Renk Kayması').attrs.oninput({ target: { value: '0.7' } });
  assert.strictEqual(bir.settings.background.gradient.audioHue, 0.7);
  assert.strictEqual(L.layerConfig(cfg, bir).background.gradient.audioHue, 0.7);
  assert.strictEqual(L.layerConfig(cfg, iki).background.gradient.audioHue, cfg.background.gradient.audioHue);
});

test('söz kütüphanesi yalnız Windows panelinde görünür', () => {
  const prev = window.SV_PLATFORM;
  const prevLib = window.SVLyricsLib;
  window.SVLyricsLib = {
    items: [{ id: 'lyr1', name: 'gece', artist: 'Ada', title: 'Gece', text: '[00:00.00]satir' }],
    sig: 'hazir',
  };
  try {
    window.SV_PLATFORM = { os: 'linux', isWindows: false, isMac: false, isLinux: true };
    const { cfg } = setup([
      { id: 'a', kind: 'visualizer', type: 'text', name: 'Söz', settings: { text: { source: 'lyrics', lyricsSource: '[00:00.00]elle' } } },
    ], ['a']);
    let panel = window.SVScenePanels.layersPanel();
    assert.strictEqual(rowOf(panel, 'Çalan Parçayı İzle'), undefined, 'Linux kütüphaneyi göstermez');
    assert.strictEqual(all(panel, (n) => n.tag === 'button' && n.attrs && n.attrs.text === 'Söz Kütüphanesi').length, 0, 'Linux sekmesi yok');
    assert.ok(rowOf(panel, 'Söz Dosyası Yükle') || all(panel, (n) => n.attrs && n.attrs.text === 'Söz Dosyası Yükle').length, 'elle yükleme durur');
    const linuxTexts = all(panel, (n) => n.attrs && typeof n.attrs.text === 'string').map((n) => n.attrs.text);
    assert.ok(linuxTexts.includes('Oynat') && linuxTexts.includes('Duraklat') && linuxTexts.includes('Durdur'), 'elle yüklenen sözün saati');
    window.SV_PLATFORM = { os: 'win32', isWindows: true, isMac: false, isLinux: false };
    panel = window.SVScenePanels.layersPanel();
    assert.ok(rowOf(panel, 'Çalan Parçayı İzle'));
    assert.strictEqual(ctrlOf(panel, 'Çalan Parçayı İzle').attrs.class, 'ctrl', 'izle anahtarı standart satır');
    assert.strictEqual(all(panel, cls('lyrics-follow')).length, 0);
    const texts = all(panel, (n) => n.attrs && typeof n.attrs.text === 'string').map((n) => n.attrs.text);
    const iFollow = texts.indexOf('Çalan Parçayı İzle');
    const iLoad = texts.indexOf('Söz Dosyası Yükle');
    assert.ok(iLoad >= 0 && iLoad < iFollow, 'izle, dosya yüklemenin altında');
    assert.ok(texts.includes('Söz kütüphanesindeki dosyayla eşleşir ve çalan parçanın süresiyle gider.'));
    assert.strictEqual(rowOf(panel, 'Eşleme'), undefined, 'takip kapalıyken eşleme gizli');
    assert.strictEqual(rowOf(panel, 'Parça Adı'), undefined, 'kütüphane kapalıyken alanlar gizli');
    const toggle = all(rowOf(panel, 'Çalan Parçayı İzle'), (n) => n.tag === 'input' && n.attrs.type === 'checkbox')[0];
    assert.ok(toggle, 'izle anahtarı');
    toggle.attrs.onchange({ target: { checked: true } });
    assert.strictEqual(cfg.layers[0].settings.text.lyricsFollow, true);
    panel = window.SVScenePanels.layersPanel();
    const followedTexts = all(panel, (n) => n.attrs && typeof n.attrs.text === 'string').map((n) => n.attrs.text);
    assert.strictEqual(followedTexts.indexOf('Oynat'), -1, 'izleme açıkken saat oynatıcıdadır');
    assert.ok(rowOf(panel, 'Eşleme'));
    selectOf(rowOf(panel, 'Eşleme')).attrs.onchange({ target: { value: 'partial' } });
    assert.strictEqual(cfg.layers[0].settings.text.lyricsMatch, 'partial');
    const tabLabels = all(panel, cls('layer-tab')).map((n) => n.attrs.text);
    assert.strictEqual(tabLabels[tabLabels.indexOf('Yazı') + 1], 'Söz Kütüphanesi');
    openTab(panel, 'Söz Kütüphanesi');
    assert.ok(rowOf(panel, 'Parça Adı'));
    assert.ok(rowOf(panel, 'Sanatçı'));
    const actions = all(panel, cls('lyr-item-actions'))[0];
    assert.ok(actions, 'düğmeler öğenin yanında');
    assert.ok((actions.children || []).some((c) => c.attrs && c.attrs.text === 'Çalan Parçayı Yaz'));
    assert.ok((actions.children || []).some((c) => c.attrs && c.attrs.text === 'Düzenle'));
    assert.ok((actions.children || []).some((c) => c.attrs && c.attrs.text === 'Kaldır'));
  } finally {
    window.SV_PLATFORM = prev;
    window.SVLyricsLib = prevLib;
  }
});

test('medya katmanı birden fazla kameradan birini seçer', async () => {
  const desc = Object.getOwnPropertyDescriptor(navigator, 'mediaDevices');
  Object.defineProperty(navigator, 'mediaDevices', {
    configurable: true,
    value: {
      enumerateDevices: async () => [
        { kind: 'videoinput', deviceId: 'cam-a', label: 'Ön kamera' },
        { kind: 'videoinput', deviceId: 'cam-b', label: '' },
        { kind: 'audioinput', deviceId: 'mic', label: 'Mikrofon' },
      ],
    },
  });
  try {
    const { cfg } = setup([
      { id: 'm1', kind: 'media', name: 'Medya', settings: { media: { source: 'webcam', enabled: true } } },
    ], ['m1']);
    await new Promise((r) => setTimeout(r, 0));
    let panel = window.SVScenePanels.layersPanel();
    const row = rowOf(panel, 'Kamera');
    assert.ok(row, 'kamera satırı');
    const sel = selectOf(row);
    const labels = all(sel, (n) => n.tag === 'option').map((n) => n.attrs.text);
    assert.deepStrictEqual(labels, ['Varsayılan kamera', 'Ön kamera', 'Kamera 2']);
    sel.attrs.onchange({ target: { value: 'cam-a' } });
    assert.strictEqual(cfg.layers[0].settings.media.deviceId, 'cam-a');
    assert.strictEqual(cfg.layers[0].settings.media.deviceLabel, 'Ön kamera');
    sel.attrs.onchange({ target: { value: 'cam-b' } });
    assert.strictEqual(cfg.layers[0].settings.media.deviceId, 'cam-b');
    assert.strictEqual(cfg.layers[0].settings.media.deviceLabel, '');
    cfg.layers[0].settings.media.source = 'file';
    panel = window.SVScenePanels.layersPanel();
    assert.strictEqual(rowOf(panel, 'Kamera'), undefined, 'video dosyasında kamera listesi yok');
  } finally {
    if (desc) Object.defineProperty(navigator, 'mediaDevices', desc);
  }
});

test('meşgul kamera katmanda uyarı olarak görünür', async () => {
  require('../src/visualizer/modes/media.js');
  const busy = 'Bu kamera başka bir uygulama tarafından kullanılıyor.';
  assert.strictEqual(
    window.SVMediaFault({ name: 'NotReadableError', message: 'Could not start video source' }),
    busy
  );
  assert.strictEqual(
    window.SVMediaFault({ name: 'NotAllowedError', message: 'Permission denied' }),
    'Kamera izni verilmedi. Sistem ayarlarından izin verin.'
  );
  const prevDoc = global.document;
  global.document = {
    createElement: () => ({
      play: () => Promise.resolve(),
      pause() {}, load() {}, removeAttribute() {},
      set src(_) {}, set srcObject(_) {},
    }),
  };
  const desc = Object.getOwnPropertyDescriptor(navigator, 'mediaDevices');
  Object.defineProperty(navigator, 'mediaDevices', {
    configurable: true,
    value: {
      enumerateDevices: async () => [],
      getUserMedia: async () => {
        const err = new Error('Could not start video source');
        err.name = 'NotReadableError';
        throw err;
      },
    },
  });
  try {
    const media = new window.SVMedia();
    media.apply({ enabled: true, source: 'webcam', deviceId: 'cam-b', loop: true });
    await new Promise((r) => setTimeout(r, 0));
    assert.strictEqual(media.error, busy);
    assert.strictEqual(window.SVMediaWarning('cam-b'), busy);
    setup([
      { id: 'm1', kind: 'media', name: 'Medya', settings: { media: { source: 'webcam', deviceId: 'cam-b', enabled: true } } },
    ], ['m1']);
    let panel = window.SVScenePanels.layersPanel();
    assert.ok(all(panel, (n) => n.attrs && n.attrs.class === 'studio-note media-fault' && n.attrs.text === busy).length, 'uyarı kutusu');
    window.SVMediaStatus({
      type: 'media-status', slot: 'out:1|webcam|cam-b', source: 'webcam',
      deviceId: 'cam-b', error: '', ready: true,
    });
    panel = window.SVScenePanels.layersPanel();
    assert.strictEqual(all(panel, (n) => n.attrs && n.attrs.text === busy).length, 0, 'açık akış varken uyarı yok');
  } finally {
    if (desc) Object.defineProperty(navigator, 'mediaDevices', desc);
    else delete navigator.mediaDevices;
    if (prevDoc) global.document = prevDoc;
    else delete global.document;
  }
});