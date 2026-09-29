'use strict';
/* MİLKDROP PRESET DÜZENLEYİCİ — metin tarafı (#578).
 *
 * Düzenleyici bir .milk dosyasını bloklara ayırıyor ve düzenlenmiş blokları
 * dosyaya geri yazıyor. Depoya girmeyen korpusta (10.347 dosya) ölçüldü:
 *   - değiştirilmeden geri yazılan her dosya baytı baytına aynı;
 *   - okunan bloklar MilkDrop'un okuduğu satırlarla aynı (yinelenen
 *     numaralar, CRLF ile LF'nin karışık yazıldığı dosyalar dahil);
 *   - bir bloğa satır eklenip iki değer değiştirilince MilkDrop'un
 *     okuyuşunda yalnız o blok ve o değerler değişiyor.
 * Buradaki testler o özelliklerin kırılabileceği yerleri tek tek sınıyor.
 */
const test = require('node:test');
const assert = require('node:assert');
const M = require('../src/shared/milkdrop.js');
const E = require('../src/shared/milkdrop-edit.js');

const CRLF = (lines) => lines.join('\r\n') + '\r\n';
const SRC = CRLF([
  'MILKDROP_PRESET_VERSION=201',
  'PSVERSION=2',
  'PSVERSION_WARP=2',
  'PSVERSION_COMP=2',
  '[preset00]',
  'fRating=3.000',
  'fDecay=0.9',
  'fVideoEchoZoom=1.000',
  'fVideoEchoAlpha=0.000',
  'zoom=1.01',
  'rot=0.000',
  'warp=0.500',
  'wavecode_0_enabled=1',
  'wavecode_0_samples=512',
  'wave_0_per_point1=x = sample;',
  'wave_0_per_point2=y = 0.5 + value1;',
  'shapecode_1_enabled=1',
  'shapecode_1_sides=4',
  'per_frame_1=zoom = zoom + 0.01*bass;',
  'per_frame_2=q1 = time;',
  'per_pixel_1=rot = rot + 0.1*rad;',
  'warp_1=`shader_body',
  'warp_2=`{',
  'warp_3=`  ret = tex2D(sampler_main, uv).xyz;',
  'warp_4=`}',
]);

// ------------------------------------------------------------ okuma

test('bloklar ve değerler MilkDrop\'un okuduğu gibi', () => {
  const r = E.read(SRC);
  assert.deepStrictEqual(r.blocks.per_frame, ['zoom = zoom + 0.01*bass;', 'q1 = time;']);
  assert.deepStrictEqual(r.blocks.per_pixel, ['rot = rot + 0.1*rad;']);
  assert.deepStrictEqual(r.blocks.wave_0_per_point, ['x = sample;', 'y = 0.5 + value1;']);
  assert.deepStrictEqual(r.blocks.warp, ['shader_body', '{', '  ret = tex2D(sampler_main, uv).xyz;', '}'], 'ters tırnak gösterilmiyor');
  assert.deepStrictEqual(r.blocks.comp, []);
  assert.deepStrictEqual(r.blocks.shape_1_per_frame, []);
  assert.deepStrictEqual(r.values, { zoom: 1.01, warp: 0.5, rot: 0, decay: 0.9, echoZoom: 1, echoAlpha: 0 });
});

test('ilk eksik numarada duruyor, yinelenen numarada aramanın bulduğunu alıyor', () => {
  const src = CRLF(['[preset00]', 'per_frame_1=a = 1;', 'per_frame_2=b = 2;', 'per_frame_4=d = 4;',
    'per_frame_1=a = 9;', 'per_frame_2=b = 8;']);
  // MilkDrop: per_frame_1 baştan (ilk), per_frame_2 bir sonraki satır (ikinci de olsa)
  assert.deepStrictEqual(E.read(src).blocks.per_frame, ['a = 1;', 'b = 2;']);
  assert.strictEqual(M.parseMilkMd2(src).perFrame, 'a = 1;b = 2;');
});

// ------------------------------------------------------------ yazma

test('değiştirilmeden yazılan dosya baytı baytına aynı', () => {
  const r = E.read(SRC);
  assert.strictEqual(E.write(SRC, r.blocks, r.values), SRC);
  // Karışık satır sonu ve sonda satır sonu olmayan dosya
  const mixed = '[preset00]\r\nzoom=1.0\nper_frame_1=a = 1;\r\nper_frame_2=b = 2;';
  const m = E.read(mixed);
  assert.strictEqual(E.write(mixed, m.blocks, m.values), mixed);
});

test('düzenlenen blok yerinde, 1\'den numaralı; ötekiler dokunulmadan', () => {
  const r = E.read(SRC);
  const pf = ['zoom = zoom + 0.02*bass;', 'q1 = time;', 'q2 = sin(time);'];
  const out = E.write(SRC, Object.assign({}, r.blocks, { per_frame: pf }), r.values);
  const lines = out.split('\r\n');
  const at = lines.indexOf('per_frame_1=zoom = zoom + 0.02*bass;');
  assert.ok(at > 0);
  assert.strictEqual(lines[at + 1], 'per_frame_2=q1 = time;');
  assert.strictEqual(lines[at + 2], 'per_frame_3=q2 = sin(time);');
  assert.strictEqual(lines[at + 3], 'per_pixel_1=rot = rot + 0.1*rad;', 'sıradaki blok yerinde');
  const p = M.parseMilkMd2(out);
  assert.strictEqual(p.perFrame, pf.join(''));
  assert.strictEqual(p.perPixel, 'rot = rot + 0.1*rad;');
  assert.strictEqual(p.warpShader, M.parseMilkMd2(SRC).warpShader);
});

test('kısalan blokta fazla satır kalmıyor; shader satırı ters tırnakla yazılıyor', () => {
  const r = E.read(SRC);
  const out = E.write(SRC, Object.assign({}, r.blocks, { per_frame: ['q1 = 2;'], warp: ['shader_body', '{', '  ret = 1;', '}'] }), r.values);
  assert.ok(!/per_frame_2=/.test(out), 'eski ikinci satır kaldı');
  assert.ok(/\r\nwarp_3=` {2}ret = 1;\r\n/.test(out));
  assert.strictEqual(M.parseMilkMd2(out).warpShader, 'shader_body\n{\n  ret = 1;\n}');
});

test('dosyada olmayan blok: dalga ve şekil kendi parametrelerinin ardına', () => {
  const r = E.read(SRC);
  const out = E.write(SRC, Object.assign({}, r.blocks, {
    shape_1_per_frame: ['ang = time;'], wave_0_init: ['t1 = 0;'], comp: ['shader_body', '{', '  ret = 0;', '}'],
  }), r.values);
  const lines = out.split('\r\n');
  assert.strictEqual(lines[lines.indexOf('shapecode_1_sides=4') + 1], 'shape_1_per_frame1=ang = time;');
  // Dalga kodu dalganın öbür kod satırlarının ardına
  assert.strictEqual(lines[lines.indexOf('wave_0_per_point2=y = 0.5 + value1;') + 1], 'wave_0_init1=t1 = 0;');
  const p = M.parseMilkMd2(out);
  assert.strictEqual(p.shapes.find((s) => s.index === 1).per_frame, 'ang = time;');
  assert.strictEqual(p.waves.find((w) => w.index === 0).init, 't1 = 0;');
  assert.strictEqual(p.compShader, 'shader_body\n{\n  ret = 0;\n}');
});

test('değerler: değişen yerinde yazılıyor, değişmeyen olduğu gibi, yoksa ekleniyor', () => {
  const r = E.read(SRC);
  const out = E.write(SRC, r.blocks, Object.assign({}, r.values, { zoom: 1.2345, decay: 0.9 }));
  assert.ok(/\r\nzoom=1.2345\r\n/.test(out), 'kısaltılmadan yazılmalı: ' + /zoom=[^\r]*/.exec(out)[0]);
  assert.ok(/\r\nfDecay=0.9\r\n/.test(out), 'değişmeyen değer yeniden biçimlenmemeli');
  assert.strictEqual(M.parseMilkMd2(out).params.zoom, 1.2345);
  const bare = CRLF(['[preset00]', 'per_frame_1=q1 = 1;']);
  const b = E.write(bare, E.read(bare).blocks, { zoom: 0.95, rot: 0.1 });
  assert.deepStrictEqual(b.split('\r\n').slice(0, 4), ['[preset00]', 'zoom=0.950', 'rot=0.100', 'per_frame_1=q1 = 1;']);
  assert.strictEqual(M.parseMilkMd2(b).params.rot, 0.1);
});

// ------------------------------------------------------------ hatalar

test('hata deyimin başladığı satırda, presetteki metniyle', () => {
  const blocks = { per_frame: ['a = 1;', 'b = 2 +', '  3 * ;', 'c = 4;'] };
  const d = E.diagnose(blocks, M, true);
  const first = d.find((x) => x.code !== 'dropped');
  assert.strictEqual(first.block, 'per_frame');
  assert.strictEqual(first.line, 1, 'ikinci satırdan başlayan deyim');
  assert.strictEqual(first.code, 'parse');
  assert.strictEqual(first.text, 'b = 2 + 3 *');
  assert.ok(!/_set|_add/.test(first.detail + first.text), 'üretilmiş kod gösterilmemeli: ' + first.detail);
  // MilkDrop okuyuşunda blok bütünüyle düşüyor; eski okuyuşta bu söylenmiyor
  assert.ok(d.some((x) => x.code === 'dropped' && x.line === -1));
  assert.ok(!E.diagnose(blocks, M, false).some((x) => x.code === 'dropped'));
});

test('parantez ve bilinmeyen işlev açık sözle', () => {
  const d = E.diagnose({ per_pixel: ['x = sin(1;', 'y = 2;'], per_frame: ['a = foo(2);', 'b = max(1,2));'] }, M, true)
    .filter((x) => x.code !== 'dropped');
  const by = (b) => d.filter((x) => x.block === b).map((x) => [x.line, x.code, x.detail]);
  assert.deepStrictEqual(by('per_pixel'), [[0, 'paren-open', '']]);
  assert.deepStrictEqual(by('per_frame'), [[0, 'unknown-func', 'foo'], [1, 'paren-close', '']]);
});

test('satır yorumu ve yapışan satırlar MilkDrop gibi', () => {
  // `//` satırın geri kalanını kesiyor; satırlar araya bir şey koymadan yapışıyor
  assert.deepStrictEqual(E.diagnose({ per_frame: ['a = 1; // not ;', 'b = 2;'] }, M, true), []);
  const glued = E.diagnose({ per_frame: ['a = 1', 'b = 2;'] }, M, true).filter((x) => x.code !== 'dropped');
  assert.strictEqual(glued.length, 1, '`a = 1b = 2` ayrışmamalı');
  assert.strictEqual(glued[0].line, 0);
});

test('denklemin ezdiği değer: ilk yazan satır, kendisinden mi hesaplıyor, init sayılmıyor', () => {
  const o = E.overrides({
    per_frame_init: ['decay = 0.5;'],
    per_frame: ['q1 = 1;', 'zoom = zoom*1.01; rot += 0.1;'],
    per_pixel: ['warp = 0;'],
  }, M, true);
  assert.deepStrictEqual(o, {
    zoom: { block: 'per_frame', line: 1, relative: true },
    rot: { block: 'per_frame', line: 1, relative: true },
    warp: { block: 'per_pixel', line: 0, relative: false },
  });
});

test('GLSL derleyici satırı presetin satırına benzerlikle eşleniyor', () => {
  const src = ['shader_body', '{', '  float3 c = tex2D(sampler_main, uv).xyz;', '  ret = c * foo;', '}'];
  assert.strictEqual(E.nearestLine(src, '  vec3 c = texture(sampler_main, uv).xyz;'), 2);
  assert.strictEqual(E.nearestLine(src, '  ret = c * foo;'), 3);
  assert.strictEqual(E.nearestLine(src, 'uniform float q1;'), -1);
  assert.deepStrictEqual(E.glslErrors("ERROR: 0:42: 'foo' : undeclared identifier\nERROR: 1 compilation errors."),
    [{ line: 42, message: "'foo' : undeclared identifier" }, { line: 0, message: 'ERROR: 1 compilation errors.' }]);
});
