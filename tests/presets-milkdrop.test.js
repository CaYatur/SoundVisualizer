'use strict';
/* YERLEŞİK MİLKDROP PRESETLERİ (#560).
 *
 * Motor v3.1.2'den beri var ama uygulama tek bir yedek presetle geliyordu:
 * kendi .milk paketini eklemeyen biri motorun ne yaptığını hiç görmüyordu.
 * Beş preset artık kodda geliyor ve hepsi bu depoda yazıldı.
 *
 * Testlerin tuttuğu şey "güzel görünüyor" değil — o gözle karara bağlandı —
 * presetlerin GERÇEKTEN ÇALIŞTIĞI: motor hepsini hatasız derliyor, hepsi
 * hareket ve ışık üretecek alanları yazıyor, kimlikleri kullanıcının
 * deposuyla çakışmıyor ve panel yerleşiğe çalışmayan bir silme düğmesi
 * göstermiyor. */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
global.window = global.window || {};
require('../src/shared/defaults.js');
require('../src/shared/presets.js');
const PR = global.window.SVPresets;
const LIST = require('../src/shared/presets-milkdrop.js');
const MD = require('../src/shared/milkdrop.js');

const SRC = fs.readFileSync(path.join(root, 'src/admin/milkdrop-panel.js'), 'utf-8');
const MODE = fs.readFileSync(path.join(root, 'src/visualizer/modes/milkdrop.js'), 'utf-8');

test('beş preset kayıtlı ve kimlikleri deposuyla çakışmıyor', () => {
  assert.strictEqual(LIST.length, 5);
  const ids = LIST.map((p) => p.id);
  assert.strictEqual(new Set(ids).size, 5, 'kimlik yinelenmiş');
  for (const id of ids) {
    /* Depo kimliği `md_<rastgele>` ya da `usr_<rastgele>` üretiyor; önek
       ayrı olmalı ki kullanıcının preseti bir yerleşiği gölgelemesin. */
    assert.match(id, /^md_caya_[a-z]+$/, id);
    /* presets-store.js `safeName` kimlikten dosya adı türetiyor ve bu küme
       dışındaki her karakteri atıyor: kimlik o kümede kalmalı. */
    assert.strictEqual(id.replace(/[^A-Za-z0-9_-]/g, ''), id, id);
  }
});

test('her preset motorda hatasız derleniyor', () => {
  for (const p of LIST) {
    const parsed = new MD.Preset(p.source, { seed: 1234 });
    assert.deepStrictEqual(parsed.errors, [], p.name + ': ' + parsed.errors.join(' | '));
  }
});

test('her preset hareket ve ışık üretiyor', () => {
  for (const p of LIST) {
    const parsed = new MD.Preset(p.source, { seed: 1234 });
    /* Hareket: per_frame ve per_pixel'in ikisi de yazılmış olmalı. Yalnız
       başlıkla gelen bir preset duran bir görüntü çizer. */
    assert.match(p.source, /per_frame_1=/, p.name + ': per_frame yok');
    assert.match(p.source, /per_pixel_1=/, p.name + ': per_pixel yok');
    /* Işık: en az bir şekil ya da özel dalga. Geri besleme tamponu kendi
       kendine aydınlanmıyor; her kare yeni bir şey çizilmezse sönüyor. */
    const hasDraw = /shapecode_\d+_enabled=1/.test(p.source) || /wavecode_\d+_enabled=1/.test(p.source);
    assert.ok(hasDraw, p.name + ': ne şekil ne dalga çiziyor');
    /* Sönüm 1'e çok yaklaşırsa görüntü doyuyor ve beyaza kilitleniyor —
       ilk turda tam olarak bu oldu. 0,99 üstü hiçbirinde olmamalı. */
    const decay = parsed.get('decay');
    assert.ok(decay > 0.8 && decay < 0.99, p.name + ': sönüm ' + decay);
  }
});

test('otomatik geçiş ve katman seçicisi yerleşikleri görüyor', () => {
  /* Görselleştirici listeyi `byKind('milkdrop')` ile kuruyor
     (modes/milkdrop.js `_autoCycle`); yerleşikler oraya düşmezse otomatik
     geçiş yalnız kullanıcının kendi paketlerinde dolaşır. */
  const kinds = PR.byKind('milkdrop');
  for (const p of LIST) {
    const hit = kinds.find((x) => x.id === p.id);
    assert.ok(hit, p.id + ' byKind listesinde yok');
    assert.strictEqual(hit.builtin, true, p.id + ' yerleşik işaretli değil');
    assert.ok(hit.source && hit.source.length > 200, p.id + ' kaynağı taşınmamış');
  }
});

test('modül iki kez değerlendirilirse kayıt bozulmuyor', () => {
  /* `registerBuiltin` yinelenen kimlikte HATA ATIYOR. Bir sayfa paylaşılan
     betiği ikinci kez değerlendirirse (yayın katmanının yeniden bağlanma
     yolu) nöbetçi olmasa kayıt orada yarıda kalırdı. */
  const before = PR.byKind('milkdrop').length;
  const file = path.join(root, 'src/shared/presets-milkdrop.js');
  const code = fs.readFileSync(file, 'utf-8');
  assert.doesNotThrow(() => {
    new Function('window', 'module', code)(global.window, { exports: {} });
  });
  assert.strictEqual(PR.byKind('milkdrop').length, before, 'ikinci değerlendirme liste büyüttü');
});

test('her sayfa modülü presets.js\'ten SONRA yüklüyor', () => {
  const pages = ['src/admin/index.html', 'src/exporter/index.html',
    'src/visualizer/index.html', 'src/web/overlay.html'];
  for (const rel of pages) {
    const html = fs.readFileSync(path.join(root, rel), 'utf-8');
    const mine = html.indexOf('presets-milkdrop.js');
    const base = html.indexOf('presets.js"');
    assert.ok(mine > 0, rel + ': modül yüklenmiyor');
    assert.ok(base > 0 && base < mine, rel + ': presets.js sonrasında değil');
  }
});

test('panel yerleşiği silme düğmesi olmadan çiziyor', () => {
  // Liste yerleşiklerle birleşiyor
  assert.match(SRC, /presets = builtins\(\)\.concat\(mine\)/);
  assert.match(SRC, /window\.SVMilkdropBuiltins/);
  /* Silme düğmesi yalnız kullanıcı presetinde: yerleşiğin dosyası yok,
     `deletePreset` onu bulamaz ve satır tazelemede geri gelirdi. */
  assert.match(SRC, /p\.builtin\s*\n?\s*\?\s*el\('span', \{ class: 'md-builtin'/);
});

test('preset seçilmemişken yerleşiğin kendisi çiziliyor', () => {
  assert.match(MODE, /const src = \(a \? a\.source : c\.source\) \|\| defaultSource\(\);/);
  const fn = /const defaultSource = \(\) => \{([\s\S]*?)\};/.exec(MODE);
  assert.ok(fn, 'defaultSource bulunamadı');
  const run = new Function('window', 'DEFAULT_PRESET', 'return (() => {' + fn[1] + '})();');
  // Yerleşikler yüklüyken ilk yerleşiğin kaynağı
  assert.strictEqual(run({ SVMilkdropBuiltins: LIST }, 'YEDEK'), LIST[0].source);
  // Modül yüklenmemişse asgari yedek
  assert.strictEqual(run({}, 'YEDEK'), 'YEDEK');
});

test('kaynaklar bize ait: hiçbiri bir pakete işaret etmiyor', () => {
  /* Yerleşikler kendi yazdıklarımız. Bir preset paketinden alınmış olsaydı
     dosya başlığında adı ya da yazarı kalırdı; ayrıca kullanıcı dokusu
     isteyen bir preset doku paketi olmadan gürültüyle çizilirdi. */
  for (const p of LIST) {
    assert.strictEqual(p.author, 'CAYADEV', p.id);
    assert.doesNotMatch(p.source, /sampler_(?!fw_|fc_|pw_|pc_|main|blur|noise|pw_main)/i, p.id + ': kullanıcı dokusu istiyor');
    assert.doesNotMatch(p.source, /^\s*MILKDROP_PRESET_VERSION/im, p.id);
  }
});
