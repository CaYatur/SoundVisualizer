'use strict';
/* CaYaDev MilkDrop preset paketi (#825).
 *
 * Görünüş gözle ve önizleme/karşılaştırma araçlarıyla onaylandı (bkz.
 * presets/README.md). Testlerin tuttuğu şey paketin BAŞKA
 * OYNATICILARDA da çalışmasını sağlayan kurallar ve gömülü kopyanın
 * kaynakla aynı kalması:
 *  - dosyalar ASCII, adlar "CaYaDev - <Ad>.milk", lisans ve README yerinde;
 *  - her preset warp ve comp shader'ı taşıyor ve motorda hatasız çevriliyor;
 *  - MilkDrop 2'nin kendisinin bildirmediği örnekleyiciler (sampler_pw_noise_lq
 *    gibi) shader'da bildirilmiş: bildirilmezse MilkDrop comp'u düşürüyor,
 *    bizim motor ise sessizce çalıştırıyor (BeatDrop'ta ölçüldü);
 *  - dalga ve şekil kodu aspectx/aspecty okumuyor: MilkDrop 2 onları bu
 *    bloklara vermiyor (0 görünüyor), paket q31/q32 ile taşıyor; dalga
 *    koordinatı ise zaten eşit ölçekli (y en-boyla geriliyor), q31/q32 ile
 *    çarpılan dalga dikeyde 1,78 kat uzuyordu;
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

test('gömülü paket orijinal md2 ve md3 dosyalarıyla aynı', () => {
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
  const lic = fs.readFileSync(path.join(PP.PRESETS, 'LICENSE.md'), 'utf-8');
  assert.match(lic, /CC BY 4\.0/);
  assert.match(lic, /CaYaDev/);
  const readme = fs.readFileSync(PP.README, 'utf-8');
  // Galeri pack.json'dan üretilir (elle eklenen tablo satırları bir kez tablonun dışına düşmüştü)
  assert.strictEqual(readme.replace(/\r\n/g, '\n'), PP.renderReadme(readme, PACK), 'README galerisi güncel değil: node scripts/preset-pack.js');
  for (const p of PACK) {
    const cell = PP.gallery(PACK).find((l) => l.includes('"' + p.preview + '"'));
    assert.ok(cell && cell.includes('<b>' + p.name + '</b>') && cell.includes(encodeURI(p.file)), 'galeride yok: ' + p.name);
  }
});

test('her presetin 960x540 JPEG önizlemesi var', () => {
  for (const p of PACK) {
    const b = fs.readFileSync(path.join(PP.PRESETS, p.preview));
    assert.ok(b[0] === 0xff && b[1] === 0xd8, p.preview + ': JPEG değil');
    // SOF0/SOF2 başlığından boyut
    let i = 2, size = null;
    while (i < b.length - 9 && !size) {
      const marker = b[i + 1], len = b.readUInt16BE(i + 2);
      if (marker === 0xc0 || marker === 0xc2) size = [b.readUInt16BE(i + 7), b.readUInt16BE(i + 5)];
      i += 2 + len;
    }
    assert.deepStrictEqual(size, [960, 540], p.preview);
    assert.ok(b.length < 250 * 1024, p.preview + ': ' + Math.round(b.length / 1024) + ' KB, 250 KB sınırı');
  }
});

test('her preset MilkDrop 2 başlığı, warp ve comp shader\'ı taşıyor ve hatasız çevriliyor', () => {
  for (const p of PACK) {
    assert.match(p.source, /^MILKDROP_PRESET_VERSION=201\r\nPSVERSION=([34])\r\nPSVERSION_WARP=\1\r\nPSVERSION_COMP=\1\r\n/, p.name);
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

test('özel dalga koordinatı en-boyla çarpılmıyor', () => {
  /* MilkDrop dalga noktasını y'de 1/aspecty ile geriyor (milkdropfs.cpp:2485):
     dalga birimi iki eksende aynı piksel, daire çarpansız yuvarlak. q31/q32
     (aspectx/aspecty = 1/en-boy) ile ÇARPMAK geniş ekranda dikeyi 1,78 kat
     uzatıyordu: Phosphor Scope'un Lissajous'u ekrandan taşıyordu. Ekran
     kenarına uzanmak için BÖLMEK doğru (Infinite Frame). Şekil konumu ise ekran
     kesri; orada çarpmak doğru. */
  for (const p of PACK) {
    for (const line of p.source.split(/\r\n/)) {
      if (/^wave_\d+_per_point\d+=/.test(line)) assert.doesNotMatch(line, /\*\s*q3[12]\b/, p.name + ': ' + line);
    }
  }
});

test('söndürmeler kare hızından bağımsız', () => {
  for (const p of PACK) {
    assert.match(p.source, /\r\nper_frame_1=q30 = 60\/max\(fps, 15\);\r\n/, p.name);
    const warp = MD.parseMilk(p.source).warpShader;
    /* Geri besleme tamponunu kare başına değiştiren adım (söndürme pow(k, q30), kural adımı
       min(1, q30) ile) q30'a bağlı. Önceki kareyi hiç okumayan warp (Spectral Ridges tamponu
       her karede temizleyip veri satırı olarak kullanıyor) geri besleme değil. Söndürmesi kare kodundaki
       bir zaman tıkıyla (saniyede sabit sayıda 8 bit adım) inen warp da kare hızından bağımsız; bunu
       shader'daki "time tick" açıklamasıyla söylüyor (Vinyl Groove: oluklar dakikalarca kalıyor). */
    if (!/sampler_(\w\w_)?main\b/.test(warp)) continue;
    assert.match(warp, /\bq30\b|time tick/, p.name + ': warp adımı q30\'suz');
  }
});

test('sürüm eki: zip paketi okunuyor ve içerik birebir', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sv-pack-'));
  try {
    const out = path.join(dir, 'pack.zip');
    const folder = 'CaYaDev MilkDrop Presets/';
    const files = PACK.map((p) => ({ name: folder + p.file, data: Buffer.from(p.source, 'latin1') }))
      .concat([{ name: folder + 'LICENSE.md', data: fs.readFileSync(path.join(PP.PRESETS, 'LICENSE.md')) }]);
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
   açılarak 512 komuta sığmalı. İkisi de BeatDrop'ta ve SDK derleyicisinde ölçüldü.
   PSVERSION 4'te (ps_3_0) `break` derleniyor ama MilkDrop 2 o aşamayı siyah çiziyor
   (Mandelbrot Dive, BeatDrop'la karşılaştırmada): break hiçbir presette yok. */
test('shader\'lar MilkDrop 2 derleyicisinin kurallarına uyuyor', () => {
  const macros = ['time', 'fps', 'frame', 'progress', 'bass', 'mid', 'treb', 'vol', 'bass_att', 'mid_att',
    'treb_att', 'vol_att', 'aspect', 'texsize', 'roam_cos', 'roam_sin', 'slow_roam_cos', 'slow_roam_sin',
    'mip_x', 'mip_y', 'mip_xy', 'mip_avg', 'blur1_min', 'blur1_max', 'blur2_min', 'blur2_max', 'blur3_min',
    'blur3_max', 'rad', 'ang', 'uv', 'uv_orig', 'hue_shader'];
  for (let i = 1; i <= 32; i++) macros.push('q' + i);
  const decl = new RegExp('\\b(?:float|half|int|bool)[1-4]?(?:x[1-4])?\\s+(' + macros.join('|') + ')\\b');
  for (const p of PACK) {
    /* 3 (ps_2_x) varsayılan; 32 sabit yazmacını aşan preset 4 (ps_3_0) yazar ve
       while yasağı ona uygulanmaz. */
    const ps2 = /\r\nPSVERSION_WARP=3\r\nPSVERSION_COMP=3\r\n/.test(p.source);
    assert.ok(ps2 || /\r\nPSVERSION_WARP=4\r\nPSVERSION_COMP=4\r\n/.test(p.source), p.name);
    const f = MD.parseMilk(p.source);
    for (const [stage, text] of [['warp', f.warpShader], ['comp', f.compShader]]) {
      const code = text.replace(/\/\/[^\n]*/g, '');
      const m = decl.exec(code);
      assert.ok(!m, p.name + ' ' + stage + ': MilkDrop makrosu ad olarak kullanılmış: ' + (m && m[0]));
      assert.doesNotMatch(code, /\bbreak\b/, p.name + ' ' + stage + ': MilkDrop 2 break\'li aşamayı siyah çiziyor');
      if (ps2) assert.doesNotMatch(code, /\bwhile\b/, p.name + ' ' + stage + ': ps_2_x döngüden çıkamaz');
      // Yardımcı işlevler PS gövdesinin dışında: aşama makroları orada tanımsız bir parametreye açılır
      const helpers = code.slice(0, code.indexOf('shader_body'));
      assert.doesNotMatch(helpers, /\b(uv|uv_orig|rad|ang|hue_shader|ret)\b/, p.name + ' ' + stage + ': yardımcı işlev aşama girdisi okuyor');
    }
  }
});

// Asıllar sürüme göre ayrılır. Uygulama ikisini de gömer. compat/ yalnız MilkDrop 2
// sınırına indirilmiş kopyalar: q1..q32, dört dalga, dört şekil, pw_ yok.
function checkMd2(name, source) {
  const qs = (source.match(/\bq\d+\b/g) || []).map((q) => +q.slice(1));
  assert.ok(Math.max(0, ...qs) <= 32, name + ': q32 üstü kullanılmış');
  for (const kind of ['wavecode', 'shapecode']) {
    const on = new Set();
    for (const m of source.matchAll(new RegExp('^' + kind + '_(\\d+)_enabled=1', 'gm'))) on.add(m[1]);
    assert.ok(on.size <= 4, name + ': ' + kind + ' dörtten fazla');
    for (const n of on) assert.ok(+n < 4, name + ': ' + kind + '_' + n + ' MD2 tarafından çizilmez');
  }
  assert.doesNotMatch(source, /\bsampler_pw_/, name + ': pw_ örnekleyicisi var');
}

test('md2 yalnız MilkDrop 2 asıllarını, md3 yalnız MilkDrop 3 asıllarını tutar', () => {
  const milks = (dir) => fs.readdirSync(dir).filter((f) => f.endsWith('.milk')).sort();
  assert.deepStrictEqual(milks(PP.MD2_DIR), PACK.filter((p) => !p.md3).map((p) => p.file).sort());
  assert.deepStrictEqual(milks(PP.MD3_DIR), PACK.filter((p) => p.md3).map((p) => p.file).sort());
  assert.ok(milks(PP.MD3_DIR).length >= 10);
  for (const p of PACK) {
    const disk = fs.readFileSync(path.join(p.md3 ? PP.MD3_DIR : PP.MD2_DIR, p.file), 'latin1');
    assert.strictEqual(disk, p.source, p.file + ': gömülü kopya asılla aynı değil');
    assert.strictEqual(p.md3, MD.md3Auto(p.source), p.name);
  }
  const arcade = PACK.find((x) => x.id === 'md_caya_arcade_invaders');
  checkMd2(arcade.id, arcade.source.replace(/\r\n/g, '\n'));
  assert.strictEqual(arcade.md3, false);
});

const COMPAT_DIR = path.join(root, 'presets', 'compat', 'md', 'cayadev');

// BeatDrop 1.5'in d3dx9_31 derleyicisi anten satırındaki tall çarpanında çöküyor.
test('compat kopyaları MD2 sınırında; Spectrum City BeatDrop tall çarpanını düşürür', () => {
  const rd = (f) => fs.readFileSync(path.join(COMPAT_DIR, f), 'utf-8');
  const files = fs.readdirSync(COMPAT_DIR).filter((x) => x.endsWith('.milk'));
  assert.ok(files.includes('CaYaDev - Spectrum City BeatDrop.milk'));
  assert.doesNotMatch(rd('CaYaDev - Spectrum City BeatDrop.milk'), /\* tall \* blink/);
  const original = fs.readFileSync(path.join(PP.MD2_DIR, 'CaYaDev - Spectrum City.milk'), 'utf-8');
  assert.match(original, /\* tall \* blink/);
  assert.match(rd('CaYaDev - Spectrum City.milk'), /\* tall \* blink/);
  assert.notStrictEqual(rd('CaYaDev - Spectrum City.milk').replace(/\r\n/g, '\n'), original.replace(/\r\n/g, '\n'));
  for (const f of files) {
    checkMd2(f, rd(f).replace(/\r\n/g, '\n'));
    if (f.endsWith(' BeatDrop.milk')) continue;
    const hit = PACK.find((p) => p.file === f);
    assert.ok(hit, f + ': aslı pakette yok');
    assert.notStrictEqual(rd(f).replace(/\r\n/g, '\n'), hit.source.replace(/\r\n/g, '\n'), f + ': uyumluluk kopyası asılla aynı');
  }
});

test('Arcade Invaders Score: filo sığınaklara inince vurulan uzaylılar geri gelmiyor', () => {
  // Uzaylı ölüm sayaçları (k0..k10) yalnızca dalga temizlenince (wc) sıfırlanmalı;
  // istila (go) skoru siler, sağ kalanları tepeye çeker ama ölüleri diriltmez.
  const src = fs.readFileSync(path.join(root, 'presets', 'original', 'md2', 'cayadev', 'CaYaDev - Arcade Invaders Score.milk'), 'utf-8');
  for (let i = 0; i <= 10; i++) {
    const re = new RegExp('^per_frame_\\d+=k' + i + ' = k' + i + '\\*\\(1 - (\\w+)\\);', 'm');
    const m = re.exec(src);
    assert.ok(m, 'k' + i + ' sıfırlama satırı bulunamadı');
    assert.strictEqual(m[1], 'wc', 'k' + i + ' dalga temizlenmeden sıfırlanıyor');
  }
});

test('Arcade Invaders Score: shader paketlenmiş ölüm/hasar sayaçlarını taşmadan çözüyor', () => {
  // Sabit +0.001 payı 7775/7776 gibi büyük paketlerde üst basamağı taşırıp -1 veriyordu;
  // sağdaki tamamen vurulmuş sütunlar filo aşağı inince hayalet gibi yeniden çiziliyordu.
  const src = fs.readFileSync(path.join(root, 'presets', 'original', 'md2', 'cayadev', 'CaYaDev - Arcade Invaders Score.milk'), 'utf-8');
  const warp = src.split(/\r?\n/).filter((l) => /^warp_\d+=`/.test(l)).map((l) => l.replace(/^warp_\d+=`/, '')).join('\n');
  const m = /float digitOf\(float v, float base, float i\)\s*\{([\s\S]*?)\n\}/.exec(warp);
  assert.ok(m, 'digitOf bulunamadı');
  const body = m[1].replace(/\/\/.*$/gm, '').replace(/float /g, 'let ').replace(/\bpow\(/g, 'Math.pow(').replace(/\bfloor\(/g, 'Math.floor(');
  const f32 = Math.fround;
  // eslint-disable-next-line no-new-func
  const digitOf = new Function('v', 'base', 'i', body);
  const check = (base, n) => {
    const max = Math.pow(base, n);
    for (let v = 0; v < max; v++) {
      for (let i = 0; i < n; i++) {
        const want = Math.floor(v / Math.pow(base, i)) % base;
        assert.strictEqual(digitOf(f32(v), base, i), want, 'base ' + base + ' v=' + v + ' basamak ' + i);
      }
    }
  };
  check(6, 6); // q6: k0..k5
  check(6, 5); // q7: k6..k10
  check(4, 8); // q8/q9: sığınak hasarı
});
