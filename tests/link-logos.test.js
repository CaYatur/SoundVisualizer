'use strict';
/* Telefon bağlantısının logo okuması: yalnız gösterinin başvurduğu kimlik,
   boyut sınırıyla. Dosya sistemi yok. */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const L = require('../src/main/link-logos');
const link = require('../src/main/phone-link');

const png = { id: 'img_a', mime: 'image/png', b64: 'QQ==', size: 2 };

test('canlı sahne, katman, değişim listesi, kayıtlı sahne ve çizelge klibi', () => {
  const cfg = {
    logo: { libraryId: 'img_live' },
    layers: [{ settings: { logo: { libraryId: 'img_layer', swap: { items: ['img_swap', '', 'not an id'] } } } }],
    scenes: [{ id: 's1', data: { logo: { libraryId: 'img_scene' } } }],
    timeline: { tracks: [{ clips: [
      { id: 'c', local: { data: { layers: [{ settings: { logo: { libraryId: 'img_clip' } } }] } } },
      { id: 'l', type: 'logo', ref: 'img_tl' },
      { id: 'd', type: 'logo', ref: 'data:image/png;base64,QQ' },
    ] }] },
  };
  const ids = L.collectLogoIds(cfg);
  assert.deepStrictEqual([...ids].sort(), ['img_clip', 'img_layer', 'img_live', 'img_scene', 'img_swap', 'img_tl']);
});

test('veri adresi ve bozuk kimlik toplanmaz', () => {
  const cfg = {
    logo: { libraryId: 'data:image/png;base64,QQ', src: 'data:image/png;base64,QQ' },
    timeline: { tracks: [{ clips: [{ type: 'image', ref: 'data:image/png;base64,QQ' }] }] },
  };
  assert.strictEqual(L.collectLogoIds(cfg).size, 0);
  assert.strictEqual(L.collectLogoIds(null).size, 0);
});

test('başvurulmayan kimlik ve büyük dosya gitmez', () => {
  const cfg = { logo: { libraryId: 'img_a' } };
  const lookup = (id) => (id === 'img_a' || id === 'img_other' ? png : null);
  assert.strictEqual(L.serveLogo(cfg, 'img_other', lookup).error, 'missing');
  assert.strictEqual(L.serveLogo(cfg, '../x', lookup).error, 'bad-args');
  assert.strictEqual(L.serveLogo(cfg, 'img_a', () => ({ size: L.MAX_LINK_BYTES + 1 })).error, 'too-big');
  assert.strictEqual(L.serveLogo(cfg, 'img_a', () => null).error, 'missing');
  const ok = L.serveLogo(cfg, 'img_a', lookup);
  assert.deepStrictEqual(ok, { id: 'img_a', mime: 'image/png', b64: 'QQ==' });
});

test('logo.get izleme düzeyinde ve ana süreç onu bağlıyor', () => {
  assert.strictEqual(link.OPS['logo.get'], 'view');
  assert.strictEqual(link.OPS['library.logo'], 'view');
  assert.strictEqual(link.allowed('view', 'logo.get'), true);
  assert.strictEqual(link.allowed('view', 'library.logo'), true);
  const main = fs.readFileSync(path.join(__dirname, '../src/main/main.js'), 'utf8');
  assert.match(main, /const linkLogos = require\('\.\/link-logos'\)/);
  assert.match(main, /'logo\.get': \(args\) => \{[\s\S]*linkLogos\.serveLogo/);
  assert.match(main, /'library\.logo': \(args\) => \{[\s\S]*logoLibrary\.read/);
  assert.doesNotMatch(main.slice(main.indexOf("'library.logo'"), main.indexOf("'library.logo'") + 500), /serveLogo/);
});
