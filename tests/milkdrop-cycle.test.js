'use strict';
/* MilkDrop OTOMATİK GEÇİŞ.
 *
 * `milkdrop.autoNext` ilk MilkDrop commit'inden (5ac5f73) beri panelde
 * duruyordu: kaydırıcı yazıyor, ayar dosyasına kaydediliyor, varsayılanlarda
 * tanımlı — ve HİÇBİR YER okumuyordu. Ölçüldü: gerçek uygulamada panelin
 * kendi yolundan `autoNext=2` verildi ve dokuz saniye beklendi; motorun
 * preset anahtarı hiç değişmedi.
 *
 * Kurallar saf bir modülde (shared/milkdrop-cycle.js) ve burada DAVRANIŞIYLA
 * sınanıyor. Motorun, panelin ve dört render penceresinin ona bağlandığı
 * yerler kaynak üzerinden sabitleniyor. */
global.window = global.window || {};
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const C = require('../src/shared/milkdrop-cycle.js');

const ROOT = path.join(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf-8');
const bare = (s) => s
  .replace(/\/\*[\s\S]*?\*\//g, ' ')
  .replace(/(^|[^:])\/\/[^\n]*/g, '$1 ');

const L3 = [
  { id: 'a', name: 'A', source: 'x' },
  { id: 'b', name: 'B', source: 'yy' },
  { id: 'c', name: 'C', source: 'zzz' },
];

// Kare kare ilerletir; her geçişin kimliğini ve ZAMANINI toplar
function run(cy, md, list, seconds, dt, startId) {
  let cur = startId;
  const out = [];
  const frames = Math.round(seconds / dt);
  for (let f = 1; f <= frames; f++) {
    const p = cy.step(dt, md, list, cur);
    if (p) { out.push({ id: p.id, t: f * dt }); cur = p.id; }
  }
  return out;
}

// ------------------------------------------------------------ zamanlama

test('kapalıyken hiç geçmiyor', () => {
  const cy = new C.Cycle();
  assert.deepStrictEqual(run(cy, { autoNext: 0 }, L3, 30, 1 / 60, 'a'), []);
  assert.strictEqual(cy.reason, 'OFF');
});

test('2 saniyede bir geçiyor — bildirilen durum', () => {
  /* Sayaç her geçişte sıfırlanıyor, yani bir aralık en fazla BİR KARE
     uzayabilir; kısalamaz. */
  const dt = 1 / 60;
  const g = run(new C.Cycle(), { autoNext: 2 }, L3, 10.2, dt, 'a');
  assert.strictEqual(g.length, 5, 'geçiş zamanları: ' + g.map((x) => x.t.toFixed(3)).join(', '));
  let prev = 0;
  for (const x of g) {
    const aralik = x.t - prev;
    assert.ok(aralik >= 2 - 1e-9 && aralik <= 2 + dt + 1e-9, 'aralık ' + aralik.toFixed(4));
    prev = x.t;
  }
});

test('kare hızından bağımsız', () => {
  for (const fps of [30, 60, 144]) {
    const g = run(new C.Cycle(), { autoNext: 2 }, L3, 10.2, 1 / fps, 'a');
    assert.strictEqual(g.length, 5, fps + ' fps: ' + g.length + ' geçiş');
  }
});

test('açılınca ANINDA geçmiyor — kapalıyken süre birikmiyor', () => {
  /* Birikseydi ayar açılır açılmaz bir geçiş olurdu ve kullanıcı seçtiği
     aralığı hiç görmezdi. */
  const cy = new C.Cycle();
  run(cy, { autoNext: 0 }, L3, 30, 1 / 60, 'a');
  assert.deepStrictEqual(run(cy, { autoNext: 2 }, L3, 1.9, 1 / 60, 'a'), []);
});

test('aralık kısaltılınca eski aralığı beklemiyor', () => {
  const cy = new C.Cycle();
  run(cy, { autoNext: 10 }, L3, 5, 1 / 60, 'a');
  assert.ok(cy.step(1 / 60, { autoNext: 2 }, L3, 'a'),
    'birikmiş 5 sn yeni 2 sn aralığını aşıyor; hemen geçmeliydi');
});

test('kalan süre azalıyor ve kapalıyken sıfır', () => {
  const cy = new C.Cycle();
  run(cy, { autoNext: 4 }, L3, 1, 1 / 60, 'a');
  const r = cy.remaining({ autoNext: 4 });
  assert.ok(r > 2.9 && r < 3.1, 'kalan=' + r);
  assert.strictEqual(cy.remaining({ autoNext: 0 }), 0);
});

// ------------------------------------------------------------ sıra

test('sırayla: a → b → c → a, sona gelince başa dönüyor', () => {
  const g = run(new C.Cycle(), { autoNext: 1 }, L3, 4.1, 1 / 60, 'a');
  assert.deepStrictEqual(g.map((x) => x.id), ['b', 'c', 'a', 'b']);
});

test('yerleşik varsayılan çizilirken sıradaki İLK preset', () => {
  assert.strictEqual(C.pick(L3, '', 'sequential').id, 'a');
  assert.strictEqual(C.pick(L3, 'listede-yok', 'sequential').id, 'a');
});

test('rastgele: o an çizilen preset HİÇ seçilmiyor', () => {
  /* Düzgün seçim 1/n olasılıkla aynı preseti verir ve o geçişte ekranda
     hiçbir şey değişmez. Üç presetle her üç geçişten biri böyle olurdu. */
  for (let i = 0; i < 2000; i++) {
    assert.notStrictEqual(C.pick(L3, 'b', 'random', Math.random).id, 'b');
  }
});

test('rastgele: geri kalanların hepsine uğruyor', () => {
  const seen = new Set();
  for (let i = 0; i < 500; i++) seen.add(C.pick(L3, 'a', 'random', Math.random).id);
  assert.deepStrictEqual([...seen].sort(), ['b', 'c']);
});

test('rastgele: üretecin sınır değerleri dizini taşırmıyor', () => {
  for (const r of [0, 0.5, 0.999999, 1, NaN, -0.1]) {
    const p = C.pick(L3, 'a', 'random', () => r);
    assert.ok(p && (p.id === 'b' || p.id === 'c'), 'rnd=' + r + ' → ' + (p && p.id));
  }
});

test('tek presetle geçmiyor, boş listeyle de', () => {
  /* Kendine geçmek preseti baştan başlatır: geçiş değil takılma görünür. */
  const tek = new C.Cycle();
  assert.deepStrictEqual(run(tek, { autoNext: 1 }, [L3[0]], 5, 1 / 60, 'a'), []);
  assert.strictEqual(tek.reason, 'ALONE');
  const bos = new C.Cycle();
  assert.deepStrictEqual(run(bos, { autoNext: 1 }, [], 5, 1 / 60, ''), []);
  assert.strictEqual(bos.reason, 'EMPTY');
});

test('bozuk ayar değerleri güvenli', () => {
  assert.deepStrictEqual(C.normalize({}), { seconds: 0, order: 'sequential' });
  assert.strictEqual(C.normalize(null).seconds, 0);
  assert.strictEqual(C.normalize({ autoNext: -5 }).seconds, 0);
  assert.strictEqual(C.normalize({ autoNext: 'abc' }).seconds, 0);
  assert.strictEqual(C.normalize({ autoNext: 1e9 }).seconds, C.MAX_SECONDS);
  assert.strictEqual(C.normalize({ autoOrder: 'shuffle' }).order, 'sequential');
  assert.strictEqual(C.normalize({ autoOrder: 'random' }).order, 'random');
});

// ------------------------------------------------------------ ayarlar

test('varsayılan sıra "sırayla"; eski ayar dosyası da alıyor', () => {
  require('../src/shared/defaults.js');
  const SV = global.window.SV;
  assert.strictEqual(SV.defaultConfig().milkdrop.autoOrder, 'sequential');
  const eski = SV.deepMerge(SV.defaultConfig(), { milkdrop: { autoNext: 2 } });
  assert.strictEqual(eski.milkdrop.autoOrder, 'sequential');
  assert.strictEqual(eski.milkdrop.autoNext, 2, 'kullanıcının değeri korunmalı');
});

// ------------------------------------------------------------ motor

const MODE = bare(read('src/visualizer/modes/milkdrop.js'));

test('motor: seçim o karenin preset yüklemesinden ÖNCE yapılıyor', () => {
  const a = MODE.indexOf('this._autoCycle(cfg, step);');
  const e = MODE.indexOf('this._ensurePreset(cfg);');
  assert.ok(a > 0, '_autoCycle çağrılmıyor');
  assert.ok(e > a, 'seçim yüklemeden sonra kalırsa geçiş bir kare gecikir');
});

test('motor: otomatik seçim AYARA YAZILMIYOR', () => {
  /* Her yapılandırma gönderimi settings.json'ı senkron yeniden yazıyor ve
     `.milk` kaynağı onlarca kilobayt: iki saniyede bir geçiş dakikada otuz
     tam dosya yazımı olurdu. */
  const fn = /_autoCycle\(cfg, step\) \{[\s\S]*?\n    \}/.exec(MODE);
  assert.ok(fn, '_autoCycle bulunamadı');
  assert.match(fn[0], /this\.cycle\.step\(step, cfg\.milkdrop, list, cur\)/);
  assert.doesNotMatch(fn[0], /cfg\.milkdrop\.(presetId|source|name)\s*=/);
  assert.ok(!MODE.includes('updateConfig'), 'motor yapılandırma göndermemeli');
});

test('motor: elle seçim otomatiği ezer ve sayacı sıfırlar', () => {
  const fn = /_ensurePreset\(cfg\) \{[\s\S]*?\n    \}/.exec(MODE);
  assert.ok(fn, '_ensurePreset bulunamadı');
  assert.match(fn[0],
    /if \(man !== this\._manualKey\) \{[\s\S]*?this\.autoPick = null;[\s\S]*?this\.cycle\.reset\(\);/);
  assert.match(fn[0], /const src = \(a \? a\.source : c\.source\) \|\| DEFAULT_PRESET;/,
    'otomatik seçimin kaynağı çizilmeli');
});

test('motor: önizleme yalnız AYNI elle seçimin üstündeki seçimi izliyor', () => {
  /* Elle seçimden hemen sonra yolda eski bir ölçer mesajı olabilir; onu
     izlemek yeni preseti eskisine geri harmanlardı. */
  const fn = /_autoCycle\(cfg, step\) \{[\s\S]*?\n    \}/.exec(MODE)[0];
  assert.match(fn, /F\.base === \(this\._manualKey \|\| ''\)/);
  assert.match(fn, /\(performance\.now\(\) - F\.at\) < FOLLOW_MS/);
  assert.match(MODE, /livePreset\(\) \{[\s\S]*?base: this\._manualKey \|\| ''/);
});

test('aktarım: ölçer mesajı → panel → önizleme', () => {
  assert.match(bare(read('src/visualizer/layers.js')),
    /milkdropPreset\(\) \{[\s\S]*?e\.mode\.livePreset\(\)/);
  assert.match(bare(read('src/visualizer/visualizer.js')), /mdPreset: stack\.milkdropPreset\(\),/);
  assert.match(bare(read('src/admin/admin.js')),
    /window\.SVMdFollow = d\.mdPreset \? Object\.assign\(\{ at: performance\.now\(\) \}, d\.mdPreset\) : null;/);
  /* İzleme TEK pencereye dayanıyor: birden çok ekranda her görselleştirici
     kendi mesajını gönderseydi önizleme aralarında gidip gelirdi. Ana süreç
     yalnız birincil pencerenin mesajını geçiriyor — bu varsayım sabit. */
  assert.match(read('src/main/main.js'), /if \(primary && e\.sender !== primary\.webContents\) return;/);
});

// ------------------------------------------------------------ panel

test('panel: sıra seçici autoOrder yazıyor, ad canlı güncelleniyor', () => {
  const PANEL = bare(read('src/admin/milkdrop-panel.js'));
  assert.match(PANEL, /P\(\)\.row\('Geçiş Sırası', selOf\(/);
  assert.match(PANEL, /md\.autoOrder = String\(v\)/);
  assert.match(PANEL, /id: 'mdLiveName'/);
});

test('yeni arayüz metinlerinin İngilizcesi var', () => {
  const I = read('src/shared/i18n.js');
  const keys = [
    'Geçiş Sırası', 'Sırayla', 'Rastgele', 'sn',
    'Otomatik geçiş görselleştiricinin kendi saatiyle çalışır: panel kapalıyken ya da görselleştirici paneli örterken de durmaz. Geçilen preset ayarlara yazılmaz; Yüklü Preset satırı o an ekranda olanı gösterir. Rastgele sırada o an çizilen preset hiç seçilmez. Her geçişin süresi yukarıdaki Preset Geçişi ayarından gelir.',
    'Denklem blokları (per_frame, per_pixel) ve MilkDrop 2 presetlerinin HLSL warp/composite shaderları gerçekten çalıştırılır: 10.332 presetlik bir korpustaki 16.346 shader aşamasının hepsi derleniyor. Şekiller, dalgalar, blur zinciri ve hareket vektörleri çizilir; preset dosyalarıyla gelmeyen kullanıcı dokuları, doku paketi seçilmediyse gürültüyle ikame edilir.',
  ];
  for (const k of keys) assert.ok(I.includes("'" + k + "':"), 'çevirisi yok: ' + k.slice(0, 40));
});
