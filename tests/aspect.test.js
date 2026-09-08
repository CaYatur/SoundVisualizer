'use strict';
/* Piksel en boy oranı düzeltmesinin testleri (src/shared/aspect.js).
 *
 * Buradaki asıl dayanak shapeOnScreen(): "mantıksal tuvalde 1:1 çizilen bir
 * şekil, panelin kendi çarpıklığından geçtikten sonra ekranda kaça kaç
 * görünüyor?" Formülü değil, GÖZÜN GÖRECEĞİ sonucu ölçer. Boyut formülünü
 * doğrudan sınamak, formülü kendisiyle karşılaştırmak olurdu.
 *
 * Sağlamanın kendisinin bir şey kanıtladığını göstermek için düzeltme KAPALI
 * hâli de her seferinde sınanıyor: kapalıyken sonuç 1 çıkıyorsa test
 * hiçbir şey ölçmüyor demektir.
 */
const test = require('node:test');
const assert = require('node:assert');
const A = require('../src/shared/aspect.js');

// Gerçekte karşılaşılan çerçeve boyutları
const FRAMES = [
  [1920, 1080], [3840, 2160], [1280, 720], [2560, 1440], [1024, 768], [1600, 900],
];
// Kullanıcının sahne ekranı (~1.68) dahil, iki yöne de sapan PAR değerleri
const PARS = [0.4, 0.5, 0.75, 0.9, 1.1, 1.25, 1.5, 1.681, 2, 2.5, 3.2];

test('varsayılan tanım kimlik ve maliyetsiz', () => {
  const d = A.defaultOutput();
  assert.strictEqual(d.enabled, false);
  assert.strictEqual(d.par, 1);
  assert.ok(A.isIdentity(d));
  assert.strictEqual(A.pixelCost(1920, 1080, d), 1);
  const r = A.renderSize(1920, 1080, d);
  assert.deepStrictEqual([r.w, r.h], [1920, 1080]);
});

test('kapalı düzeltme tuvale dokunmuyor', () => {
  /* PAR yazılı ama enabled false: hiçbir şey olmamalı. Aksi hâlde ayarı
     kapatmak çözünürlüğü değiştirir ve kullanıcı sebebini bulamazdı. */
  const r = A.renderSize(1920, 1080, { enabled: false, par: 1.681 });
  assert.deepStrictEqual([r.w, r.h], [1920, 1080]);
  assert.strictEqual(r.pixelRatio, 1);
});

test('normalize bozuk değerleri güvenli hale getiriyor', () => {
  /* Bu sayı doğrudan canvas.width'e gidiyor; NaN ya da 0 bir kareyi değil
     pencereyi bozardı. */
  for (const bad of [null, undefined, {}, { par: NaN }, { par: 'abc' }, { par: 0 }]) {
    const d = A.normalize(bad);
    assert.ok(Number.isFinite(d.par), 'par sonlu değil: ' + JSON.stringify(bad));
    assert.ok(d.par >= A.MIN_PAR && d.par <= A.MAX_PAR);
  }
  assert.strictEqual(A.normalize({ par: 999 }).par, A.MAX_PAR);
  assert.strictEqual(A.normalize({ par: -5 }).par, A.MIN_PAR);
  assert.strictEqual(A.normalize({ quality: 'saçma' }).quality, A.DEFAULT_QUALITY);
  assert.strictEqual(A.normalize({ pattern: 'saçma' }).pattern, 'none');
  assert.strictEqual(A.normalize({ enabled: 'evet' }).enabled, false, 'enabled kesin boolean olmalı');
});

test('bozuk tanım bile çizilebilir bir boyut veriyor', () => {
  for (const bad of [null, { par: NaN }, { enabled: true, par: 0 }]) {
    const r = A.renderSize(1920, 1080, bad);
    assert.ok(r.w >= 2 && r.h >= 2 && Number.isFinite(r.w) && Number.isFinite(r.h));
  }
  // Çerçevenin kendisi saçmaysa da çökmemeli
  const r = A.renderSize(0, -5, { enabled: true, par: 2 });
  assert.ok(r.w >= 2 && r.h >= 2);
});

test('isIdentity yalnız gerçekten iş yapmayanı atlıyor', () => {
  assert.ok(A.isIdentity({ enabled: true, par: 1 }));
  assert.ok(A.isIdentity({ enabled: true, par: 1.00001 }), 'görülemeyecek fark için bedel ödenmemeli');
  assert.ok(!A.isIdentity({ enabled: true, par: 1.02 }));
  assert.ok(A.isIdentity({ enabled: false, par: 3 }));
  /* Kalibrasyon deseni açıksa aşama atlanamaz — desenin çizilmesi gerek. */
  assert.ok(!A.isIdentity({ enabled: true, par: 1, pattern: 'circle' }));
});

// ---------------------------------------------------------------- PAR bulma

test('ölçülen panel boyutundan PAR', () => {
  // 1920x1080 sürülen, fiziksel olarak 3:1 bir sahne ekranı
  const par = A.parFromPhysical(1920, 1080, 300, 100);
  assert.ok(Math.abs(par - 1.6875) < 1e-9, 'par=' + par);
  // Birim sadeleşiyor: mm ya da cm fark etmemeli
  assert.strictEqual(A.parFromPhysical(1920, 1080, 3000, 1000), par);
  // Kare piksel
  assert.strictEqual(A.parFromPhysical(1920, 1080, 160, 90), 1);
  // Eksik ölçü sessizce 1
  assert.strictEqual(A.parFromPhysical(1920, 1080, 0, 100), 1);
});

test('bilinen en boy oranından PAR', () => {
  // 21:9 panel ama 1920x1080 besleniyor
  const par = A.parFromAspect(1920, 1080, 21, 9);
  assert.ok(Math.abs(par - (21 / 9) / (16 / 9)) < 1e-9);
  // Zaten doğru oran -> düzeltme yok
  assert.strictEqual(A.parFromAspect(1920, 1080, 16, 9), 1);
});

test('ekranda ölçülen daireden PAR', () => {
  /* Daire yassı görünüyorsa (enine geniş) PAR > 1. */
  assert.ok(A.parFromCircle(168, 100) > 1);
  assert.ok(A.parFromCircle(100, 168) < 1);
  assert.strictEqual(A.parFromCircle(100, 100), 1);
});

test('elle gerilmiş görselden PAR — kullanıcının kendi çözümü', () => {
  /* Kullanıcı basıklığı, logoyu başka programda DİKEY gerip yükleyerek
     çözmüştü. O dosya PAR'ı zaten ölçmüş oluyor: yuvarlak olması gereken
     şekli 360x605'lik bir elipse çevirdiyse panel 605/360 kadar eziyor. */
  const par = A.parFromStretchedSource(360, 605);
  assert.ok(Math.abs(par - 605 / 360) < 1e-9, 'par=' + par);
  assert.ok(par > 1.6 && par < 1.7);

  /* Ekranda ölçmenin TERSİ olmalı — ikisi karıştırılırsa düzeltme iki kat
     ters yöne gider ve kullanıcı daha da bozuk bir görüntü alır. */
  const same = A.parFromCircle(605, 360);
  assert.ok(Math.abs(par - same) < 1e-9, 'kaynak ve ekran ölçümü birbirinin tersi olmalı');
});

test('ratioText okunur oran veriyor', () => {
  assert.strictEqual(A.ratioText(1), '1:1');
  assert.strictEqual(A.ratioText(4 / 3), '4:3');
  assert.strictEqual(A.ratioText(2), '2:1');
  assert.strictEqual(A.ratioText(0.5), '1:2');
  assert.match(A.ratioText(1.681), /^\d+:\d+$/);
});

// ------------------------------------------------- asıl sağlama: daire yuvarlak mı

test('SAĞLAMA: düzeltme açıkken daire her koşulda yuvarlak çıkıyor', () => {
  for (const [fw, fh] of FRAMES) {
    for (const par of PARS) {
      for (const quality of A.QUALITIES) {
        const def = { enabled: true, par, quality };
        const shape = A.shapeOnScreen(fw, fh, def);
        assert.ok(
          Math.abs(shape - 1) < 0.01,
          `${fw}x${fh} par=${par} ${quality}: ekranda ${shape.toFixed(4)} (1 olmalı)`
        );
      }
    }
  }
});

test('SAĞLAMA gerçekten ayırt ediyor: kapalıyken daire yuvarlak DEĞİL', () => {
  /* Bu olmadan yukarıdaki test hiçbir şey kanıtlamazdı: her zaman 1 döndüren
     bir sağlama da bütün testleri geçirirdi. */
  for (const par of PARS) {
    const shape = A.shapeOnScreen(1920, 1080, { enabled: false, par });
    assert.ok(
      Math.abs(shape - par) < 1e-9,
      `düzeltme kapalıyken panelin çarpıklığı görünmeli: par=${par}, ölçülen=${shape}`
    );
    assert.ok(Math.abs(shape - 1) > 0.05, 'kapalıyken düzeltilmiş görünüyor — sağlama kör');
  }
});

test('mantıksal tuvalin oranı panelin fiziksel oranına eşit', () => {
  /* Düzeltmenin tek matematiksel şartı bu; kalite kipi yalnızca aynı oranı
     hangi çözünürlükte gerçekleyeceğini seçer. */
  for (const [fw, fh] of FRAMES) {
    for (const par of PARS) {
      for (const quality of A.QUALITIES) {
        const r = A.renderSize(fw, fh, { enabled: true, par, quality });
        const want = (fw / fh) * par;
        const got = r.w / r.h;
        assert.ok(
          Math.abs(got - want) / want < 0.01,
          `${fw}x${fh} par=${par} ${quality}: oran ${got.toFixed(4)}, beklenen ${want.toFixed(4)}`
        );
      }
    }
  }
});

// ------------------------------------------------------------- kalite kipleri

test('quality kipi hiçbir ekseni çerçevenin altına düşürmüyor', () => {
  /* Varsayılanın quality olmasının sebebi bu: balanced, panelin
     gösterebileceği gerçek satır sayısının altına inip yumuşatıyordu.

     TEK İSTİSNA piksel tavanı. 4K panel + uç PAR birleşiminde quality
     20 megapiksellik bir tuval isteyebiliyor; tavan orada iki ekseni birden
     küçültüyor ve bu güvence kaçınılmaz olarak bozuluyor. Bu bir kusur
     değil, bilinçli takas — ama sessiz kalmasın diye burada AÇIKÇA yazılı:
     güvence yalnızca tavana çarpılmadığında geçerli, ve tavan devreye
     girdiğinde r.capped bunu söylüyor. */
  let cappedSeen = 0;
  for (const [fw, fh] of FRAMES) {
    for (const par of PARS) {
      const r = A.renderSize(fw, fh, { enabled: true, par, quality: 'quality' });
      if (r.capped) {
        cappedSeen++;
        // Tavana çarpsa bile düzeltmenin kendisi doğru kalmalı
        assert.ok(Math.abs(A.shapeOnScreen(fw, fh, { enabled: true, par, quality: 'quality' }) - 1) < 0.01);
        continue;
      }
      assert.ok(r.w >= fw - 1, `genişlik düştü: ${r.w} < ${fw} (par=${par}, ${fw}x${fh})`);
      assert.ok(r.h >= fh - 1, `yükseklik düştü: ${r.h} < ${fh} (par=${par}, ${fw}x${fh})`);
    }
  }
  /* Tavanın gerçekten bu veri kümesinde tetiklendiğini de göster: hiç
     tetiklenmiyorsa yukarıdaki `continue` ölü koddur ve istisna uydurma
     olurdu. */
  assert.ok(cappedSeen > 0, 'tavan hiç tetiklenmedi — istisna gerçek değil');
});

test('balanced kipi piksel sayısını koruyor', () => {
  for (const [fw, fh] of FRAMES) {
    for (const par of PARS) {
      const r = A.renderSize(fw, fh, { enabled: true, par, quality: 'balanced' });
      assert.ok(
        Math.abs(r.pixelRatio - 1) < 0.01,
        `piksel oranı ${r.pixelRatio.toFixed(3)} (par=${par}, ${fw}x${fh})`
      );
    }
  }
});

test('performance kipi hiçbir ekseni büyütmüyor', () => {
  for (const [fw, fh] of FRAMES) {
    for (const par of PARS) {
      const r = A.renderSize(fw, fh, { enabled: true, par, quality: 'performance' });
      assert.ok(r.w <= fw + 1 && r.h <= fh + 1, `büyüdü: ${r.w}x${r.h} > ${fw}x${fh}`);
      assert.ok(r.pixelRatio <= 1.01);
    }
  }
});

test('kalite kipleri maliyet sırasına uyuyor', () => {
  for (const par of [0.5, 1.681, 3.2]) {
    const q = A.pixelCost(1920, 1080, { enabled: true, par, quality: 'quality' });
    const b = A.pixelCost(1920, 1080, { enabled: true, par, quality: 'balanced' });
    const p = A.pixelCost(1920, 1080, { enabled: true, par, quality: 'performance' });
    assert.ok(q > b && b > p, `sıra bozuk: quality=${q} balanced=${b} performance=${p}`);
  }
});

test('piksel tavanı aşırı durumda devreye giriyor ve oranı bozmuyor', () => {
  /* 4K panel + uç PAR: tavan olmasaydı kare başına 33 megapiksel çizilirdi. */
  const def = { enabled: true, par: A.MAX_PAR, quality: 'quality' };
  const r = A.renderSize(3840, 2160, def);
  assert.ok(r.capped, 'tavan devreye girmedi');
  assert.ok(r.w * r.h <= A.MAX_LOGICAL_PIXELS + 4);
  // Küçültme İKİ eksende birden olmalı — yoksa düzeltmenin kendisi bozulur
  assert.ok(
    Math.abs(A.shapeOnScreen(3840, 2160, def) - 1) < 0.01,
    'tavana çarpınca düzeltme bozuldu'
  );
  // Normal durumda tavan devrede olmamalı
  assert.ok(!A.renderSize(1920, 1080, { enabled: true, par: 1.681 }).capped);
});

// ------------------------------------------------------------ ekran başına

test('ekran başına çözümleme, tümü için varsayılana düşüyor', () => {
  /* Haritalamadaki (mapping.outputs) örüntünün aynısı: kullanıcı ya tek
     ekranı ayrı ayarlar ya da hepsine birden aynı düzeltmeyi verir. */
  const root = {
    enabled: true,
    outputs: {
      default: { enabled: true, par: 1.2 },
      77: { enabled: true, par: 1.681 },
    },
  };
  assert.ok(Math.abs(A.resolve(root, 77).par - 1.681) < 1e-9, 'ekrana özel tanım kullanılmadı');
  assert.ok(Math.abs(A.resolve(root, 99).par - 1.2) < 1e-9, 'varsayılana düşmedi');
  assert.ok(Math.abs(A.resolve(root, null).par - 1.2) < 1e-9);

  // Kök kapalıysa hiçbir ekran düzeltilmez
  assert.ok(A.isIdentity(A.resolve({ enabled: false, outputs: root.outputs }, 77)));
  // Hiç tanım yoksa kimlik
  assert.ok(A.isIdentity(A.resolve({}, 77)));
  assert.ok(A.isIdentity(A.resolve(null, 77)));
});

test('ekran kimliği metin olarak gelse de eşleşiyor', () => {
  /* Yapılandırma JSON'dan geliyor ve nesne anahtarları metne dönüyor;
     displayId ise sayı. Eşleşme kaçarsa kullanıcının ayarı sessizce
     yok sayılır ve sebebi görünmez. */
  const root = { enabled: true, outputs: { 77: { enabled: true, par: 1.5 } } };
  assert.ok(Math.abs(A.resolve(root, 77).par - 1.5) < 1e-9, 'sayı kimlik eşleşmedi');
  assert.ok(Math.abs(A.resolve(root, '77').par - 1.5) < 1e-9, 'metin kimlik eşleşmedi');
});
