'use strict';
/* Çıkış geometrisi: köşe düzeltme, ağ bükme ve kenar harmanlama matematiği.

   Projeksiyon haritalama, görüntüyü düz bir dikdörtgen olmayan yüzeylere
   oturtmaktır: eğimli bir duvar, bir kubbe, bir sahne dekoru ya da yan yana
   iki projektörün üst üste binen alanı.

   Bu dosyada yalnızca MATEMATİK var — tuval, WebGL, DOM yok. Bunun iki
   sebebi var: birincisi, homografi çözümü ve kenar harmanlama eğrisi gibi
   şeyler sayısal olarak doğrulanabilir ve tests/warp.test.js bunu doğrudan
   yapıyor; ikincisi, aynı matematik hem canlı pencerede hem çevrimdışı
   dışa aktarımda kullanılıyor — haritalama bir pencere hilesi değil, render
   hattının parçası, yoksa dışa aktarılan video projektörde görünenle
   eşleşmezdi. */
(function () {
  const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);

  /* Homografi (perspektif dönüşüm) çözümü.

     Dört kaynak köşesini dört hedef köşesine götüren 3x3 matrisi bulur.
     Köşeleri sürüklerken doğruların doğru kalmasını sağlayan şey budur —
     basit iki doğrusal ara değerleme kullanılsaydı düz çizgiler bükülürdü,
     ki gerçek bir projeksiyon böyle davranmaz.

     8 bilinmeyenli doğrusal sistem Gauss eliminasyonuyla çözülür (h33 = 1
     alınır). src ve dst: [[x,y] x4], sıra sol-üst, sağ-üst, sağ-alt, sol-alt.
     Dönüş: 9 elemanlı satır-öncelikli dizi, çözülemezse null. */
  function homography(src, dst) {
    if (!src || !dst || src.length !== 4 || dst.length !== 4) return null;
    const A = [];
    const b = [];
    for (let i = 0; i < 4; i++) {
      const [x, y] = src[i];
      const [u, v] = dst[i];
      A.push([x, y, 1, 0, 0, 0, -u * x, -u * y]);
      b.push(u);
      A.push([0, 0, 0, x, y, 1, -v * x, -v * y]);
      b.push(v);
    }
    const h = solve(A, b);
    if (!h) return null;
    return [h[0], h[1], h[2], h[3], h[4], h[5], h[6], h[7], 1];
  }

  // Kısmi pivotlamalı Gauss eliminasyonu (8x8 için fazlasıyla yeterli)
  function solve(A, b) {
    const n = b.length;
    const M = A.map((row, i) => row.concat([b[i]]));
    for (let col = 0; col < n; col++) {
      let piv = col;
      for (let r = col + 1; r < n; r++) {
        if (Math.abs(M[r][col]) > Math.abs(M[piv][col])) piv = r;
      }
      if (Math.abs(M[piv][col]) < 1e-12) return null; // tekil
      const tmp = M[col]; M[col] = M[piv]; M[piv] = tmp;
      const p = M[col][col];
      for (let c = col; c <= n; c++) M[col][c] /= p;
      for (let r = 0; r < n; r++) {
        if (r === col) continue;
        const f = M[r][col];
        if (!f) continue;
        for (let c = col; c <= n; c++) M[r][c] -= f * M[col][c];
      }
    }
    return M.map((row) => row[n]);
  }

  // Noktayı homografiyle dönüştür
  function applyHomography(H, x, y) {
    if (!H) return [x, y];
    const w = H[6] * x + H[7] * y + H[8];
    if (Math.abs(w) < 1e-12) return [x, y];
    return [
      (H[0] * x + H[1] * y + H[2]) / w,
      (H[3] * x + H[4] * y + H[5]) / w,
    ];
  }

  /* Ağ bükme: kontrol noktası ızgarası üzerinde iki kübik yüzey.

     Köşe düzeltme yalnızca düzlemsel yüzeyler için yeterli. Silindirik bir
     kolon ya da bir kubbe için ızgara gerekir. Catmull-Rom ara değerlemesi
     seçildi çünkü kontrol noktalarından GEÇER — kullanıcı bir noktayı
     sürüklediğinde görüntü tam oraya gider, B-spline'da olduğu gibi
     yaklaşmakla kalmaz. */
  function catmullRom(p0, p1, p2, p3, t) {
    const t2 = t * t;
    const t3 = t2 * t;
    return 0.5 * (
      2 * p1 +
      (-p0 + p2) * t +
      (2 * p0 - 5 * p1 + 4 * p2 - p3) * t2 +
      (-p0 + 3 * p1 - 3 * p2 + p3) * t3
    );
  }

  /* Izgara dışındaki hayalet kontrol noktası.

     Kenarda değeri kopyalamak (clamp) yanlış: Catmull-Rom o zaman düz bir
     rampayı bile eğri yapar ve kimlik ızgarası kimlik olmaktan çıkar.
     Bunun yerine kenardaki eğim doğrusal olarak uzatılır; böylece kontrol
     noktaları bir doğru üzerindeyken eğri tam olarak o doğrudur. */
  function ghost(get, n, i) {
    if (i >= 0 && i <= n - 1) return get(i);
    if (i < 0) return 2 * get(0) - get(Math.min(1, n - 1));
    return 2 * get(n - 1) - get(Math.max(0, n - 2));
  }

  /* Izgaradan yüzey noktası.
       grid: { cols, rows, pts: Float32Array(cols*rows*2) } — 0..1 uzayında
       u, v: 0..1
     Dönüş: [x, y] */
  function meshPoint(grid, u, v) {
    const { cols, rows, pts } = grid;
    if (cols < 2 || rows < 2) return [u, v];
    const fx = clamp01(u) * (cols - 1);
    const fy = clamp01(v) * (rows - 1);
    const ix = Math.min(cols - 2, Math.floor(fx));
    const iy = Math.min(rows - 2, Math.floor(fy));
    const tx = fx - ix;
    const ty = fy - iy;
    const raw = (c, r, k) => pts[(r * cols + c) * 2 + k];
    // Satır/sütun yönünde hayalet noktalar doğrusal uzatmayla üretilir
    const cell = (c, r, k) =>
      ghost((rr) => ghost((cc) => raw(cc, rr, k), cols, c), rows, r);
    const out = [0, 0];
    for (let k = 0; k < 2; k++) {
      const col = [];
      for (let r = -1; r <= 2; r++) {
        col.push(catmullRom(
          cell(ix - 1, iy + r, k), cell(ix, iy + r, k),
          cell(ix + 1, iy + r, k), cell(ix + 2, iy + r, k), tx
        ));
      }
      out[k] = catmullRom(col[0], col[1], col[2], col[3], ty);
    }
    return out;
  }

  // Düzgün ızgara (bükme yokken bu kimlik dönüşümüdür)
  function identityGrid(cols, rows) {
    const c = Math.max(2, cols | 0);
    const r = Math.max(2, rows | 0);
    const pts = new Float32Array(c * r * 2);
    for (let j = 0; j < r; j++) {
      for (let i = 0; i < c; i++) {
        pts[(j * c + i) * 2] = i / (c - 1);
        pts[(j * c + i) * 2 + 1] = j / (r - 1);
      }
    }
    return { cols: c, rows: r, pts };
  }

  /* Izgarayı yeniden boyutlandır: mevcut şekli koruyarak kontrol noktası
     sayısını değiştirir. Kullanıcı 3x3 ile hizalayıp sonra 5x5'e geçtiğinde
     yaptığı iş kaybolmasın diye. */
  function resampleGrid(grid, cols, rows) {
    const out = identityGrid(cols, rows);
    if (!grid || grid.cols < 2 || grid.rows < 2) return out;
    for (let j = 0; j < out.rows; j++) {
      for (let i = 0; i < out.cols; i++) {
        const p = meshPoint(grid, i / (out.cols - 1), j / (out.rows - 1));
        out.pts[(j * out.cols + i) * 2] = p[0];
        out.pts[(j * out.cols + i) * 2 + 1] = p[1];
      }
    }
    return out;
  }

  /* Kenar harmanlama.

     İki projektör üst üste bindiğinde, örtüşen bantta ikisi de ışık verdiği
     için görüntü parlar. Her projektörün kendi kenarını bir eğriyle
     karartması gerekir; iki eğrinin TOPLAMI örtüşme boyunca 1 olmalı, yoksa
     dikişte açık ya da koyu bir bant kalır.

     pos: kenardan içeri uzaklık, 0..1 (0 = tam kenar)
     width: harmanlama bandının genişliği (0 = harmanlama yok)
     gamma: projektörün ışık eğrisi (1 = doğrusal) */
  function edgeBlend(pos, width, gamma) {
    if (!(width > 0)) return 1;
    const x = clamp01(pos / width);
    if (x >= 1) return 1;
    const g = gamma > 0 ? gamma : 1;
    // Tümleyen çift: f(x) + f(1-x) = 1 (doğrusal gamma'da tam olarak)
    const s = x < 0.5
      ? 0.5 * Math.pow(2 * x, g)
      : 1 - 0.5 * Math.pow(2 * (1 - x), g);
    return clamp01(s);
  }

  // Dört kenarın harmanlaması tek bir çarpanda
  function blendAt(u, v, edges) {
    if (!edges) return 1;
    const g = edges.gamma == null ? 1 : edges.gamma;
    return (
      edgeBlend(u, edges.left || 0, g) *
      edgeBlend(1 - u, edges.right || 0, g) *
      edgeBlend(v, edges.top || 0, g) *
      edgeBlend(1 - v, edges.bottom || 0, g)
    );
  }

  /* Nokta çokgenin içinde mi (ışın atma). Maskeler için. */
  function pointInPolygon(x, y, poly) {
    if (!poly || poly.length < 3) return true;
    let inside = false;
    for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
      const [xi, yi] = poly[i];
      const [xj, yj] = poly[j];
      const hit = (yi > y) !== (yj > y) &&
        x < ((xj - xi) * (y - yi)) / ((yj - yi) || 1e-12) + xi;
      if (hit) inside = !inside;
    }
    return inside;
  }

  /* Varsayılan bir çıkış tanımı. Her görüntüleyici penceresi kendi
     tanımını taşır; hiçbir alan verilmezse haritalama kimlik dönüşümüdür ve
     ölçülebilir bir maliyeti yoktur. */
  function defaultOutput() {
    return {
      enabled: false,
      corners: [[0, 0], [1, 0], [1, 1], [0, 1]],
      mesh: { cols: 2, rows: 2, pts: null }, // pts null = kimlik
      edges: { left: 0, right: 0, top: 0, bottom: 0, gamma: 1 },
      color: { brightness: 1, contrast: 1, gamma: 1, r: 1, g: 1, b: 1 },
      crop: { x: 0, y: 0, w: 1, h: 1 },
      masks: [],
      testPattern: 'none', // 'none' | 'grid' | 'cross' | 'bars' | 'circle'
    };
  }

  // Bir çıkış tanımı kimlik mi? (öyleyse haritalama tamamen atlanır)
  function isIdentity(out) {
    if (!out || out.enabled === false) return true;
    const c = out.corners;
    if (c && (c[0][0] !== 0 || c[0][1] !== 0 || c[1][0] !== 1 || c[1][1] !== 0 ||
      c[2][0] !== 1 || c[2][1] !== 1 || c[3][0] !== 0 || c[3][1] !== 1)) return false;
    const m = out.mesh;
    if (m && m.pts) {
      const id = identityGrid(m.cols, m.rows);
      for (let i = 0; i < id.pts.length; i++) {
        if (Math.abs(id.pts[i] - m.pts[i]) > 1e-6) return false;
      }
    }
    const e = out.edges || {};
    if (e.left || e.right || e.top || e.bottom) return false;
    const col = out.color || {};
    for (const k of ['brightness', 'contrast', 'gamma', 'r', 'g', 'b']) {
      if (col[k] != null && Math.abs(col[k] - 1) > 1e-6) return false;
    }
    const cr = out.crop || {};
    if ((cr.x || 0) !== 0 || (cr.y || 0) !== 0 ||
      (cr.w == null ? 1 : cr.w) !== 1 || (cr.h == null ? 1 : cr.h) !== 1) return false;
    if (out.masks && out.masks.length) return false;
    if (out.testPattern && out.testPattern !== 'none') return false;
    return true;
  }

  const api = {
    homography, applyHomography, solve,
    catmullRom, meshPoint, identityGrid, resampleGrid,
    edgeBlend, blendAt, pointInPolygon,
    defaultOutput, isIdentity,
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (typeof window !== 'undefined') window.SVWarp = api;
})();
