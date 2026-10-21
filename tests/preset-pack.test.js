'use strict';
/* CaYaDev MilkDrop preset paketi (#825).
 *
 * Görünüş gözle ve önizleme/karşılaştırma araçlarıyla onaylandı (bkz.
 * presets/cayadev/README.md). Testlerin tuttuğu şey paketin BAŞKA
 * OYNATICILARDA da çalışmasını sağlayan kurallar ve gömülü kopyanın
 * kaynakla aynı kalması:
 *  - dosyalar ASCII, adlar "CaYaDev - <Ad>.milk", lisans ve README yerinde;
 *  - her preset warp ve comp shader'ı taşıyor ve motorda hatasız çevriliyor;
 *  - MilkDrop 2'nin kendisinin bildirmediği örnekleyiciler (sampler_pw_noise_lq
 *    gibi) shader'da bildirilmiş: bildirilmezse MilkDrop comp'u düşürüyor,
 *    bizim motor ise sessizce çalıştırıyor (BeatDrop'ta ölçüldü);
 *  - dalga ve şekil kodu aspectx/aspecty okumuyor: MilkDrop 2 onları bu
 *    bloklara vermiyor (0 görünüyor), paket q31/q32 ile taşıyor;
 *  - söndürmeler kare hızına bağlı değil (q30), 144 Hz'te izler kısalmıyor. */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const root = path.join(__dirname, '..');
const PP = require('../scripts/preset-pack.js');
const MD = require('../src/shared/milkdrop.js');
const S = require('../src/shared/milkdrop-shader.js');
const ZIP = require('../src/main/zip-reader.js');
const LIST = require('../src/shared/presets-milkdrop.js');

const PACK = PP.load();

test('gömülü paket dosyası presets/cayadev ile aynı', () => {
  // Windows'ta autocrlf dosyayı CRLF açabilir; karşılaştırma satır sonundan bağımsız
  assert.strictEqual(fs.readFileSync(PP.OUT, 'utf-8').replace(/\r\n/g, '\n'), PP.render(PACK),
    'node scripts/preset-pack.js ile yeniden üretin');
  // Yerleşik listeye ekleniyor, elle yazılmış beşin ardından
  const own = LIST.filter((p) => !p.pack);
  const mine = LIST.filter((p) => p.pack);
  assert.strictEqual(own.length, 5);
  assert.deepStrictEqual(mine.map((p) => p.id), PACK.map((p) => p.id));
  for (const p of mine) {
    assert.strictEqual(p.author, 'CaYaDev', p.id);
    assert.strictEqual(p.builtin, true, p.id);
    assert.strictEqual(p.kind, 'milkdrop', p.id);
  }
});

test('dosya adı, kimlik, açıklama ve lisans', () => {
  assert.ok(PACK.length >= 5);
  for (const p of PACK) {
    assert.match(p.file, /^CaYaDev - [A-Z][A-Za-z0-9 ]+\.milk$/, p.file);
    assert.strictEqual(p.id, 'md_caya_' + p.name.toLowerCase().replace(/ /g, '_'), p.file);
    assert.ok(p.description.tr.length > 30 && p.description.en.length > 30, p.file + ': açıklama kısa');
    assert.ok(/^[a-z ]+$/.test(p.category), p.file + ': kategori');
  }
  const lic = fs.readFileSync(path.join(PP.DIR, 'LICENSE.md'), 'utf-8');
  assert.match(lic, /CC BY 4\.0/);
  assert.match(lic, /CaYaDev/);
  const readme = fs.readFileSync(path.join(PP.DIR, 'README.md'), 'utf-8');
  for (const p of PACK) assert.ok(readme.includes('| ' + p.name + ' |'), 'README tablosunda yok: ' + p.name);
});

test('her preset MilkDrop 2 başlığı, warp ve comp shader\'ı taşıyor ve hatasız çevriliyor', () => {
  for (const p of PACK) {
    assert.ok(p.source.startsWith('MILKDROP_PRESET_VERSION=201\r\nPSVERSION=3\r\nPSVERSION_WARP=3\r\nPSVERSION_COMP=3\r\n'), p.name);
    const parsed = new MD.Preset(p.source, { seed: 1234 });
    assert.deepStrictEqual(parsed.errors, [], p.name + ': ' + parsed.errors.join(' | '));
    const f = MD.parseMilk(p.source);
    for (const [stage, text] of [['warp', f.warpShader], ['comp', f.compShader]]) {
      assert.ok(text && /shader_body/.test(text), p.name + ': ' + stage + ' shader yok');
      const t = S.translate(text, { stage });
      assert.deepStrictEqual(t.hard, [], p.name + ' ' + stage);
      assert.deepStrictEqual(t.soft, [], p.name + ' ' + stage);
    }
  }
});

test('MilkDrop 3 işareti dosyanın kendisiyle tutarlı', () => {
  for (const p of PACK) {
    assert.strictEqual(MD.md3Auto(p.source), p.md3, p.name + ': md3 ' + MD.md3Features(p.source).join(','));
  }
});

test('MilkDrop\'un bildirmediği örnekleyiciler shader\'da bildirilmiş', () => {
  const own = /^(main|fw_main|fc_main|pw_main|pc_main|noise_lq|noise_lq_lite|noise_mq|noise_hq|noisevol_lq|noisevol_hq|blur1|blur2|blur3)$/;
  for (const p of PACK) {
    const f = MD.parseMilk(p.source);
    for (const text of [f.warpShader, f.compShader]) {
      const used = new Set((text.match(/sampler_[A-Za-z0-9_]+/g) || []).map((s) => s.slice(8)));
      for (const n of used) {
        if (own.test(n)) continue;
        // Yalnız MilkDrop'un yerleşik dokuları: paket doku dosyası istemiyor
        assert.match(n, /^(fw_|fc_|pw_|pc_)(noise_(lq|lq_lite|mq|hq)|noisevol_(lq|hq))$/, p.name + ': ' + n);
        assert.ok(new RegExp('^sampler\\s+sampler_' + n + '\\s*;', 'm').test(text), p.name + ': sampler_' + n + ' bildirilmemiş');
      }
    }
  }
});

test('dalga ve şekil kodu en-boy oranını q31/q32\'den okuyor', () => {
  for (const p of PACK) {
    for (const line of p.source.split(/\r\n/)) {
      if (/^(wave|shape)_\d+_(init|per_frame|per_point)\d+=/.test(line)) {
        assert.doesNotMatch(line, /aspect[xy]/, p.name + ': ' + line);
      }
    }
    assert.match(p.source, /\r\nper_frame_2=q31 = aspectx;\r\nper_frame_3=q32 = aspecty;\r\n/, p.name);
  }
});

test('söndürmeler kare hızından bağımsız', () => {
  for (const p of PACK) {
    assert.match(p.source, /\r\nper_frame_1=q30 = 60\/max\(fps, 15\);\r\n/, p.name);
    const warp = MD.parseMilk(p.source).warpShader;
    // Geri besleme tamponunu kare başına çarpan her söndürme q30 ile ölçekli
    assert.match(warp, /pow\([^)]*q30\)/, p.name + ': warp söndürmesi q30\'suz');
  }
});

test('sürüm eki: zip paketi okunuyor ve içerik birebir', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sv-pack-'));
  try {
    const out = path.join(dir, 'pack.zip');
    const folder = 'CaYaDev MilkDrop Presets/';
    const files = PACK.map((p) => ({ name: folder + p.file, data: Buffer.from(p.source, 'latin1') }))
      .concat([{ name: folder + 'LICENSE.md', data: fs.readFileSync(path.join(PP.DIR, 'LICENSE.md')) }]);
    fs.writeFileSync(out, PP.zip(files));
    const z = ZIP.open(out);
    try {
      assert.deepStrictEqual(z.entries.map((e) => e.name), files.map((f) => f.name));
      z.entries.forEach((e, i) => assert.ok(z.read(e).equals(files[i].data), e.name));
    } finally { z.close(); }
    // Aynı içerik aynı arşiv: sürümler arası fark yalnız gerçek değişiklik
    assert.ok(PP.zip(files).equals(fs.readFileSync(out)));
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
  assert.match(PP.zipName(), /^CaYaDev-MilkDrop-Presets-\d+\.\d+\.\d+(-[\w.]+)?\.zip$/);
  // Sürüm betiği zip'i bekliyor
  const rel = fs.readFileSync(path.join(root, 'scripts/release-assets.js'), 'utf-8');
  assert.match(rel, /'CaYaDev-MilkDrop-Presets-' \+ version \+ '\.zip'/);
});

test('her sayfa paketi presets-milkdrop.js\'ten ÖNCE yüklüyor; çeviri paketten', () => {
  for (const rel of ['src/admin/index.html', 'src/exporter/index.html', 'src/visualizer/index.html', 'src/web/overlay.html']) {
    const html = fs.readFileSync(path.join(root, rel), 'utf-8');
    const pack = html.indexOf('presets-milkdrop-pack.js');
    const mine = html.indexOf('presets-milkdrop.js');
    assert.ok(pack > 0 && pack < mine, rel);
  }
  const i18n = fs.readFileSync(path.join(root, 'src/shared/i18n.js'), 'utf-8');
  assert.match(i18n, /window\.SVMilkdropPack/);
  assert.match(i18n, /hit\.description\.en/);
});

/* MilkDrop 2 shader metnini kendi başlığıyla (include.fx) derliyor ve şu adları #define
   ediyor: ses ve zaman girdileri, q1..q32, aspect/texsize ve aşama başına rad, ang, uv,
   uv_orig (comp'ta hue_shader). Bu adla bir değişken ya da parametre tanımlamak orada
   derlemeyi düşürüyor ("unexpected token '.'"); bizim motorda ise sıradan bir küresel.
   PSVERSION 3, MilkDrop'ta ps_3_0 değil ps_2_x demek: dinamik `break` yok ve döngüler
   açılarak 512 komuta sığmalı. İkisi de BeatDrop'ta ve SDK derleyicisinde ölçüldü. */
test('shader\'lar MilkDrop 2 derleyicisinin kurallarına uyuyor', () => {
  const macros = ['time', 'fps', 'frame', 'progress', 'bass', 'mid', 'treb', 'vol', 'bass_att', 'mid_att',
    'treb_att', 'vol_att', 'aspect', 'texsize', 'roam_cos', 'roam_sin', 'slow_roam_cos', 'slow_roam_sin',
    'mip_x', 'mip_y', 'mip_xy', 'mip_avg', 'blur1_min', 'blur1_max', 'blur2_min', 'blur2_max', 'blur3_min',
    'blur3_max', 'rad', 'ang', 'uv', 'uv_orig', 'hue_shader'];
  for (let i = 1; i <= 32; i++) macros.push('q' + i);
  const decl = new RegExp('\\b(?:float|half|int|bool)[1-4]?(?:x[1-4])?\\s+(' + macros.join('|') + ')\\b');
  for (const p of PACK) {
    assert.match(p.source, /\r\nPSVERSION_WARP=3\r\nPSVERSION_COMP=3\r\n/, p.name);
    const f = MD.parseMilk(p.source);
    for (const [stage, text] of [['warp', f.warpShader], ['comp', f.compShader]]) {
      const code = text.replace(/\/\/[^\n]*/g, '');
      const m = decl.exec(code);
      assert.ok(!m, p.name + ' ' + stage + ': MilkDrop makrosu ad olarak kullanılmış: ' + (m && m[0]));
      assert.doesNotMatch(code, /\bbreak\b|\bwhile\b/, p.name + ' ' + stage + ': ps_2_x döngüden çıkamaz');
      // Yardımcı işlevler PS gövdesinin dışında: aşama makroları orada tanımsız bir parametreye açılır
      const helpers = code.slice(0, code.indexOf('shader_body'));
      assert.doesNotMatch(helpers, /\b(uv|uv_orig|rad|ang|hue_shader|ret)\b/, p.name + ' ' + stage + ': yardımcı işlev aşama girdisi okuyor');
    }
  }
});
