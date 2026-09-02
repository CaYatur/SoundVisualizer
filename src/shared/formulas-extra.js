'use strict';
/* Formül kitaplığının ikinci bölümü.

   formulas.js ile aynı sözleşme; katalog, get() ve testler ikisi arasında
   ayrım yapmaz. Ayrı dosyada durmasının tek nedeni okunabilirlik: kitaplık üç
   haneye yaklaşırken tek dosya kullanılmaz hale geliyordu.

   Hepsi literatürde tanımlı, telif konusu olmayan matematik. Her formül
   tests/formulas-health.test.js tarafından otomatik olarak taranır: her
   parametre kaydırıcısının iki ucunda da sonlu, sınırlı ve tek noktaya
   çökmemiş çıktı üretmek zorunda. Çekicilerde parametre aralığı sistemin
   gerçekten SINIRLI kaldığı bölgeyle sınırlıdır — var olmayan bir çekicinin
   kaydırıcıda yer alması kullanıcıya boş ekrandan başka bir şey vermez. */
(function () {
  const F = typeof window !== 'undefined' ? window.SVFormulas : require('./formulas.js');
  const TAU = Math.PI * 2;
  const p = (name, label, min, max, step, def) => ({ name, label, min, max, step, default: def });

  // ==========================================================================
  // PARAMETRİK YÜZEYLER
  // ==========================================================================
  F.extend('surface', {
    enneper: {
      label: 'Enneper Yüzeyi',
      accuracy: 'exact',
      params: [p('n', 'n', 1, 5, 1, 2), p('r', 'Yarıçap', 0.5, 2.5, 0.05, 1.4)],
      f: (u, v, q) => {
        // Klasik Enneper: minimal yüzey ailesinin en bilinen örneği
        const a = (u * 2 - 1) * q.r;
        const b = (v * 2 - 1) * q.r;
        const n = q.n;
        const x = a - (Math.pow(a, 2 * n + 1)) / (2 * n + 1) + a * b * b;
        const y = -b + (Math.pow(b, 2 * n + 1)) / (2 * n + 1) - a * a * b;
        const z = (2 / (n + 1)) * (Math.pow(a, n + 1) - Math.pow(b, n + 1)) * 0.5;
        return [x * 0.35, y * 0.35, z * 0.35];
      },
    },
    catenoid: {
      label: 'Katenoid',
      accuracy: 'exact',
      params: [p('c', 'Boyun', 0.2, 1.5, 0.01, 0.5), p('h', 'Yükseklik', 0.5, 3, 0.05, 1.6)],
      f: (u, v, q) => {
        const t = (v * 2 - 1) * q.h;
        const th = u * TAU;
        const r = q.c * Math.cosh(t / Math.max(0.2, q.c));
        return [r * Math.cos(th) * 0.5, t * 0.5, r * Math.sin(th) * 0.5];
      },
    },
    helicoid: {
      label: 'Helikoid',
      accuracy: 'exact',
      params: [p('turns', 'Dönüş', 0.5, 4, 0.1, 1.5), p('r', 'Yarıçap', 0.3, 2, 0.05, 1)],
      f: (u, v, q) => {
        const t = (v * 2 - 1) * q.r;
        const th = u * TAU * q.turns;
        return [t * Math.cos(th), th * 0.18, t * Math.sin(th)];
      },
    },
    roman: {
      label: 'Roma Yüzeyi (Steiner)',
      accuracy: 'exact',
      params: [p('r', 'Yarıçap', 0.4, 1.6, 0.02, 1)],
      f: (u, v, q) => {
        // Steiner'in Roma yüzeyi: RP² gömülmesi
        const th = u * Math.PI;
        const ph = v * TAU;
        const r = q.r;
        const st = Math.sin(th);
        const ct = Math.cos(th);
        const sp = Math.sin(ph);
        const cp = Math.cos(ph);
        return [
          r * r * st * st * sp * cp,
          r * r * st * ct * cp,
          r * r * st * ct * sp,
        ];
      },
    },
    crosscap: {
      label: 'Çapraz Başlık',
      accuracy: 'exact',
      params: [p('r', 'Yarıçap', 0.4, 1.6, 0.02, 1)],
      f: (u, v, q) => {
        const th = u * Math.PI;
        const ph = v * TAU;
        const r = q.r;
        return [
          r * Math.sin(th) * Math.sin(2 * ph) * 0.5,
          r * Math.sin(2 * th) * Math.cos(ph) * 0.5,
          r * Math.cos(2 * th) * 0.5,
        ];
      },
    },
    hyperboloid: {
      label: 'Hiperboloit (tek kanatlı)',
      accuracy: 'exact',
      params: [p('a', 'a', 0.2, 1.5, 0.01, 0.6), p('h', 'Yükseklik', 0.3, 2.5, 0.05, 1.2)],
      f: (u, v, q) => {
        const t = (v * 2 - 1) * q.h;
        const th = u * TAU;
        const r = q.a * Math.sqrt(1 + t * t);
        return [r * Math.cos(th), t * 0.6, r * Math.sin(th)];
      },
    },
    paraboloid: {
      label: 'Eliptik Paraboloit',
      accuracy: 'exact',
      params: [p('a', 'a', 0.2, 2, 0.02, 1), p('b', 'b', 0.2, 2, 0.02, 1)],
      f: (u, v, q) => {
        const r = v;
        const th = u * TAU;
        const x = r * Math.cos(th);
        const y = r * Math.sin(th);
        return [x * q.a, (x * x * q.a * q.a + y * y * q.b * q.b) - 0.5, y * q.b];
      },
    },
    monkeySaddle: {
      label: 'Maymun Eyeri',
      accuracy: 'exact',
      params: [p('k', 'Kol', 2, 7, 1, 3), p('s', 'Ölçek', 0.5, 2, 0.05, 1)],
      f: (u, v, q) => {
        const r = v * q.s;
        const th = u * TAU;
        // r^k cos(k θ): k kollu eyer
        return [r * Math.cos(th), Math.pow(r, q.k) * Math.cos(q.k * th) * 0.8, r * Math.sin(th)];
      },
    },
    eggCarton: {
      label: 'Yumurta Kolisi',
      accuracy: 'exact',
      params: [p('fx', 'X Frekansı', 1, 10, 0.5, 3), p('fy', 'Y Frekansı', 1, 10, 0.5, 3), p('amp', 'Genlik', 0.05, 0.8, 0.01, 0.25)],
      f: (u, v, q) => {
        const x = u * 2 - 1;
        const z = v * 2 - 1;
        return [x, Math.sin(x * Math.PI * q.fx) * Math.cos(z * Math.PI * q.fy) * q.amp, z];
      },
    },
    sineSurface: {
      label: 'Sinüs Yüzeyi',
      accuracy: 'exact',
      params: [p('a', 'a', 0.3, 2, 0.02, 1)],
      f: (u, v, q) => {
        const x = u * TAU;
        const y = v * TAU;
        const a = q.a;
        return [a * Math.sin(x) * 0.6, a * Math.sin(y) * 0.6, a * Math.sin(x + y) * 0.6];
      },
    },
    pseudosphere: {
      label: 'Sözde Küre',
      accuracy: 'exact',
      params: [p('h', 'Yükseklik', 0.5, 4, 0.05, 2.2)],
      f: (u, v, q) => {
        // Traktrisin dönmesi: sabit negatif eğrilikli yüzey
        const t = 0.05 + v * q.h;
        const th = u * TAU;
        const r = 1 / Math.cosh(t);
        const y = t - Math.tanh(t);
        return [r * Math.cos(th), (y - q.h * 0.4) * 0.8, r * Math.sin(th)];
      },
    },
    kuen: {
      label: 'Kuen Yüzeyi',
      accuracy: 'exact',
      params: [p('s', 'Ölçek', 0.2, 1.2, 0.01, 0.45)],
      f: (u, v, q) => {
        const a = (u * 2 - 1) * 4;
        const b = 0.05 + v * (Math.PI - 0.1);
        const den = 1 + a * a * Math.sin(b) * Math.sin(b);
        const s = q.s;
        return [
          (2 * (Math.cos(a) + a * Math.sin(a)) * Math.sin(b) / den) * s,
          (Math.log(Math.tan(b / 2) + 1e-6) + 2 * Math.cos(b) / den) * s,
          (2 * (Math.sin(a) - a * Math.cos(a)) * Math.sin(b) / den) * s,
        ];
      },
    },
    breather: {
      label: 'Breather Yüzeyi',
      accuracy: 'exact',
      params: [p('aa', 'a', 0.1, 0.9, 0.01, 0.4), p('s', 'Ölçek', 0.1, 1, 0.01, 0.35)],
      f: (u, v, q) => {
        const a = q.aa;
        const w = Math.sqrt(1 - a * a);
        const x = (u * 2 - 1) * 13;
        const y = (v * 2 - 1) * 12;
        const den = a * (Math.pow(w * Math.cosh(a * x), 2) + Math.pow(a * Math.sin(w * y), 2));
        if (!(Math.abs(den) > 1e-6)) return [0, 0, 0];
        const s = q.s;
        return [
          (-x + (2 * w * w * Math.cosh(a * x) * Math.sinh(a * x)) / den) * s * 0.25,
          ((2 * w * Math.cosh(a * x) * (-w * Math.cos(y) * Math.cos(w * y) - Math.sin(y) * Math.sin(w * y))) / den) * s,
          ((2 * w * Math.cosh(a * x) * (-w * Math.sin(y) * Math.cos(w * y) + Math.cos(y) * Math.sin(w * y))) / den) * s,
        ];
      },
    },
    superellipsoid: {
      label: 'Süperelipsoit',
      accuracy: 'exact',
      params: [p('e1', 'e1', 0.1, 3, 0.05, 1), p('e2', 'e2', 0.1, 3, 0.05, 1)],
      f: (u, v, q) => {
        const th = (v - 0.5) * Math.PI;
        const ph = u * TAU;
        const sgnPow = (x, e) => Math.sign(x) * Math.pow(Math.abs(x), e);
        const ct = sgnPow(Math.cos(th), q.e1);
        return [
          ct * sgnPow(Math.cos(ph), q.e2),
          sgnPow(Math.sin(th), q.e1),
          ct * sgnPow(Math.sin(ph), q.e2),
        ];
      },
    },
    gielis3d: {
      label: 'Gielis Süperşekli (3B)',
      accuracy: 'exact',
      params: [
        p('m1', 'm₁', 1, 16, 1, 6), p('n11', 'n₁₁', 0.3, 8, 0.1, 1),
        p('m2', 'm₂', 1, 16, 1, 3), p('n21', 'n₂₁', 0.3, 8, 0.1, 1),
        p('n2', 'n₂', 0.3, 8, 0.1, 1), p('n3', 'n₃', 0.3, 8, 0.1, 1),
      ],
      f: (u, v, q) => {
        const th = (u - 0.5) * TAU;
        const ph = (v - 0.5) * Math.PI;
        const r1 = F.superShape(th, q.m1, q.n11, q.n2, q.n3);
        const r2 = F.superShape(ph, q.m2, q.n21, q.n2, q.n3);
        return [
          r1 * Math.cos(th) * r2 * Math.cos(ph),
          r2 * Math.sin(ph),
          r1 * Math.sin(th) * r2 * Math.cos(ph),
        ];
      },
    },
    torusTwist: {
      label: 'Bükülü Simit',
      accuracy: 'exact',
      params: [p('R', 'Ana Yarıçap', 0.4, 1.5, 0.02, 0.75), p('r', 'Boru', 0.05, 0.6, 0.01, 0.28), p('tw', 'Büküm', 0, 8, 1, 3)],
      f: (u, v, q) => {
        const th = u * TAU;
        const ph = v * TAU + th * q.tw;
        const r = q.r;
        return [
          (q.R + r * Math.cos(ph)) * Math.cos(th),
          r * Math.sin(ph),
          (q.R + r * Math.cos(ph)) * Math.sin(th),
        ];
      },
    },
    trefoilTube: {
      label: 'Yonca Boru',
      accuracy: 'exact',
      params: [p('r', 'Boru', 0.03, 0.35, 0.01, 0.12), p('s', 'Ölçek', 0.15, 0.6, 0.01, 0.3)],
      f: (u, v, q) => {
        // Yonca düğümü boyunca süpürülen daire (Frenet çatısı yerine
        // basit bir dik çatı yeterli: görsel sonuç aynı, hesap ucuz)
        const t = u * TAU;
        const s = q.s;
        const cx = (Math.sin(t) + 2 * Math.sin(2 * t)) * s;
        const cy = (Math.cos(t) - 2 * Math.cos(2 * t)) * s;
        const cz = -Math.sin(3 * t) * s;
        const dx = (Math.cos(t) + 4 * Math.cos(2 * t)) * s;
        const dy = (-Math.sin(t) + 4 * Math.sin(2 * t)) * s;
        const dz = -3 * Math.cos(3 * t) * s;
        const dl = Math.hypot(dx, dy, dz) || 1;
        // Teğete dik iki vektör
        let ax = -dy / dl;
        let ay = dx / dl;
        let az = 0;
        const al = Math.hypot(ax, ay, az) || 1;
        ax /= al; ay /= al; az /= al;
        const bx = (dy / dl) * az - (dz / dl) * ay;
        const by = (dz / dl) * ax - (dx / dl) * az;
        const bz = (dx / dl) * ay - (dy / dl) * ax;
        const a = v * TAU;
        const ca = Math.cos(a) * q.r;
        const sa = Math.sin(a) * q.r;
        return [cx + ax * ca + bx * sa, cy + ay * ca + by * sa, cz + az * ca + bz * sa];
      },
    },
  });

  // ==========================================================================
  // DÜZLEM EĞRİLERİ
  // ==========================================================================
  F.extend('curve2d', {
    epitrochoid: {
      label: 'Epitrokoid',
      accuracy: 'exact',
      params: [p('R', 'R', 1, 8, 0.1, 3), p('r', 'r', 0.2, 4, 0.1, 1), p('d', 'd', 0.1, 4, 0.1, 1.6)],
      f: (u, q) => {
        const t = u * TAU * 6;
        const k = (q.R + q.r) / q.r;
        const s = 1 / (q.R + q.r + q.d);
        return [
          ((q.R + q.r) * Math.cos(t) - q.d * Math.cos(k * t)) * s,
          ((q.R + q.r) * Math.sin(t) - q.d * Math.sin(k * t)) * s,
        ];
      },
    },
    hypocycloid: {
      label: 'Hiposikloid',
      accuracy: 'exact',
      params: [p('R', 'R', 1, 10, 0.1, 5), p('r', 'r', 0.2, 5, 0.1, 1)],
      f: (u, q) => {
        const t = u * TAU * 4;
        const k = (q.R - q.r) / Math.max(0.05, q.r);
        const s = 1 / Math.max(0.2, q.R);
        return [
          ((q.R - q.r) * Math.cos(t) + q.r * Math.cos(k * t)) * s,
          ((q.R - q.r) * Math.sin(t) - q.r * Math.sin(k * t)) * s,
        ];
      },
    },
    deltoid: {
      label: 'Deltoit',
      accuracy: 'exact',
      params: [p('a', 'a', 0.2, 2, 0.02, 0.5)],
      f: (u, q) => {
        const t = u * TAU;
        const a = q.a;
        return [
          (2 * a * Math.cos(t) + a * Math.cos(2 * t)) / 3,
          (2 * a * Math.sin(t) - a * Math.sin(2 * t)) / 3,
        ];
      },
    },
    nephroid: {
      label: 'Nefroit',
      accuracy: 'exact',
      params: [p('a', 'a', 0.1, 1, 0.01, 0.35)],
      f: (u, q) => {
        const t = u * TAU;
        const a = q.a;
        return [
          a * (3 * Math.cos(t) - Math.cos(3 * t)) / 2,
          a * (3 * Math.sin(t) - Math.sin(3 * t)) / 2,
        ];
      },
    },
    limacon: {
      label: 'Limaçon (Pascal Salyangozu)',
      accuracy: 'exact',
      params: [p('a', 'a', 0.05, 1, 0.01, 0.4), p('b', 'b', 0.05, 1, 0.01, 0.7)],
      f: (u, q) => {
        const t = u * TAU;
        const r = (q.a + q.b * Math.cos(t)) / (q.a + q.b);
        return [r * Math.cos(t), r * Math.sin(t)];
      },
    },
    cissoid: {
      label: 'Diocles Sissoidi',
      accuracy: 'exact',
      params: [p('a', 'a', 0.1, 1, 0.01, 0.35)],
      f: (u, q) => {
        // Parametrik biçim; kutuptan uzaklaşan kolları sınırlamak için t
        // aralığı daraltılır
        const t = (u * 2 - 1) * 1.25;
        const s = Math.sin(t);
        const c = Math.cos(t);
        const den = Math.max(0.05, c);
        const r = 2 * q.a * s * s / den;
        return [Math.max(-3, Math.min(3, r * c)), Math.max(-3, Math.min(3, r * s))];
      },
    },
    folium: {
      label: 'Descartes Yaprağı',
      accuracy: 'exact',
      params: [p('a', 'a', 0.1, 1.5, 0.01, 0.6)],
      f: (u, q) => {
        // t ∈ (-1, ∞) kolunun sınırlı bir dilimi
        const t = -0.9 + u * 6;
        const den = 1 + t * t * t;
        if (Math.abs(den) < 0.05) return [0, 0];
        const a = q.a;
        return [
          Math.max(-3, Math.min(3, (3 * a * t) / den)),
          Math.max(-3, Math.min(3, (3 * a * t * t) / den)),
        ];
      },
    },
    strophoid: {
      label: 'Strofoit',
      accuracy: 'exact',
      params: [p('a', 'a', 0.1, 1, 0.01, 0.4)],
      f: (u, q) => {
        const t = (u * 2 - 1) * 1.3;
        const c = Math.cos(t);
        const den = Math.max(0.08, Math.abs(c)) * Math.sign(c || 1);
        const r = q.a * (1 - 2 * Math.sin(t) * Math.sin(t)) / den;
        return [Math.max(-3, Math.min(3, r * c)), Math.max(-3, Math.min(3, r * Math.sin(t)))];
      },
    },
    conchoid: {
      label: 'Konkoit (Nikomedes)',
      accuracy: 'exact',
      params: [p('a', 'a', 0.1, 1, 0.01, 0.3), p('b', 'b', 0.1, 1.2, 0.01, 0.6)],
      f: (u, q) => {
        const t = 0.35 + u * (Math.PI - 0.7);
        const s = Math.max(0.15, Math.sin(t));
        const r = q.a / s + q.b;
        return [Math.max(-3, Math.min(3, r * Math.cos(t))), Math.max(-3, Math.min(3, r * Math.sin(t)))];
      },
    },
    cochleoid: {
      label: 'Kokleoit',
      accuracy: 'exact',
      params: [p('a', 'a', 0.2, 2, 0.02, 1), p('turns', 'Dönüş', 1, 6, 0.5, 3)],
      f: (u, q) => {
        const t = 0.02 + u * TAU * q.turns;
        const r = (q.a * Math.sin(t)) / t;
        return [r * Math.cos(t), r * Math.sin(t)];
      },
    },
    fermatSpiral: {
      label: 'Fermat Sarmalı',
      accuracy: 'exact',
      params: [p('a', 'a', 0.05, 0.5, 0.005, 0.16), p('turns', 'Dönüş', 1, 12, 0.5, 5)],
      f: (u, q) => {
        const t = (u * 2 - 1) * TAU * q.turns;
        const r = q.a * Math.sqrt(Math.abs(t)) * Math.sign(t || 1);
        return [r * Math.cos(Math.abs(t)), r * Math.sin(Math.abs(t))];
      },
    },
    hyperbolicSpiral: {
      label: 'Hiperbolik Sarmal',
      accuracy: 'exact',
      params: [p('a', 'a', 0.1, 2, 0.02, 0.6), p('turns', 'Dönüş', 1, 8, 0.5, 4)],
      f: (u, q) => {
        const t = 0.35 + u * TAU * q.turns;
        const r = q.a / t;
        return [r * Math.cos(t), r * Math.sin(t)];
      },
    },
    archimedeanSpiral: {
      label: 'Arşimet Sarmalı',
      accuracy: 'exact',
      params: [p('a', 'a', 0, 0.3, 0.005, 0.02), p('b', 'b', 0.005, 0.15, 0.001, 0.03), p('turns', 'Dönüş', 1, 14, 0.5, 6)],
      f: (u, q) => {
        const t = u * TAU * q.turns;
        const r = q.a + q.b * t;
        return [r * Math.cos(t), r * Math.sin(t)];
      },
    },
    lituus: {
      label: 'Lituus',
      accuracy: 'exact',
      params: [p('a', 'a', 0.1, 2, 0.02, 0.8), p('turns', 'Dönüş', 1, 8, 0.5, 4)],
      f: (u, q) => {
        const t = 0.15 + u * TAU * q.turns;
        const r = q.a / Math.sqrt(t);
        return [r * Math.cos(t), r * Math.sin(t)];
      },
    },
    involute: {
      label: 'Çember Evolventi',
      accuracy: 'exact',
      params: [p('a', 'a', 0.02, 0.3, 0.005, 0.07), p('turns', 'Dönüş', 1, 8, 0.5, 3)],
      f: (u, q) => {
        const t = u * TAU * q.turns;
        const a = q.a;
        return [
          a * (Math.cos(t) + t * Math.sin(t)),
          a * (Math.sin(t) - t * Math.cos(t)),
        ];
      },
    },
    cycloid: {
      label: 'Sikloit',
      accuracy: 'exact',
      params: [p('r', 'r', 0.05, 0.4, 0.005, 0.12), p('arches', 'Kemer', 1, 6, 1, 3)],
      f: (u, q) => {
        const t = u * TAU * q.arches;
        const r = q.r;
        return [r * (t - Math.sin(t)) - r * Math.PI * q.arches, r * (1 - Math.cos(t)) - r];
      },
    },
    trochoid: {
      label: 'Trokoit',
      accuracy: 'exact',
      params: [p('r', 'r', 0.05, 0.4, 0.005, 0.12), p('d', 'd', 0.01, 0.6, 0.005, 0.2), p('arches', 'Kemer', 1, 6, 1, 3)],
      f: (u, q) => {
        const t = u * TAU * q.arches;
        return [q.r * t - q.d * Math.sin(t) - q.r * Math.PI * q.arches, q.r - q.d * Math.cos(t)];
      },
    },
    maurerRose: {
      label: 'Maurer Gülü',
      accuracy: 'exact',
      params: [p('n', 'n', 1, 12, 1, 6), p('d', 'd', 1, 180, 1, 71)],
      f: (u, q) => {
        // Gül eğrisi üzerinde d derece adımlarla gezilen kiriş dizisi
        const k = u * 360 * 2;
        const th = (k * q.d * Math.PI) / 180;
        const r = Math.sin(q.n * th);
        return [r * Math.cos(th), r * Math.sin(th)];
      },
    },
  });

  // ==========================================================================
  // UZAY EĞRİLERİ
  // ==========================================================================
  F.extend('curve3d', {
    lissajousKnot: {
      label: 'Lissajous Düğümü',
      accuracy: 'exact',
      params: [
        p('nx', 'nx', 1, 9, 1, 3), p('ny', 'ny', 1, 9, 1, 2), p('nz', 'nz', 1, 9, 1, 7),
        p('px', 'Faz x', 0, 1, 0.01, 0.15), p('py', 'Faz y', 0, 1, 0.01, 0.7),
      ],
      f: (u, q) => {
        const t = u * TAU;
        return [
          Math.cos(q.nx * t + q.px * TAU),
          Math.cos(q.ny * t + q.py * TAU),
          Math.cos(q.nz * t),
        ];
      },
    },
    sphericalSpiral: {
      label: 'Küresel Sarmal',
      accuracy: 'exact',
      params: [p('turns', 'Dönüş', 2, 40, 1, 14)],
      f: (u, q) => {
        const th = u * Math.PI;
        const ph = th * q.turns;
        return [Math.sin(th) * Math.cos(ph), Math.cos(th), Math.sin(th) * Math.sin(ph)];
      },
    },
    conicalHelix: {
      label: 'Konik Sarmal',
      accuracy: 'exact',
      params: [p('turns', 'Dönüş', 1, 20, 0.5, 7), p('h', 'Yükseklik', 0.3, 2, 0.05, 1)],
      f: (u, q) => {
        const t = u * TAU * q.turns;
        const r = u;
        return [r * Math.cos(t), (u * 2 - 1) * q.h, r * Math.sin(t)];
      },
    },
    seiffert: {
      label: 'Seiffert Sarmalı',
      accuracy: 'approx',
      params: [p('k', 'k', 0.1, 0.95, 0.01, 0.6), p('len', 'Uzunluk', 2, 24, 0.5, 10)],
      f: (u, q) => {
        // Jacobi eliptik fonksiyonları AGM ile değil, seri yaklaşımıyla
        // hesaplanır: görsel amaç için yeterli, adı da bunu söylüyor
        const s = (u * 2 - 1) * q.len;
        const k = q.k;
        const sn = Math.sin(s) - (k * k / 4) * (s - Math.sin(s) * Math.cos(s)) * Math.cos(s);
        const cn = Math.cos(s) + (k * k / 4) * (s - Math.sin(s) * Math.cos(s)) * Math.sin(s);
        const dn = Math.sqrt(Math.max(0, 1 - k * k * sn * sn));
        const ph = k * s;
        return [sn * Math.cos(ph), cn, sn * Math.sin(ph) * (0.5 + dn * 0.5)];
      },
    },
    grannyKnot: {
      label: 'Büyükanne Düğümü',
      accuracy: 'exact',
      params: [p('s', 'Ölçek', 0.1, 0.6, 0.01, 0.25)],
      f: (u, q) => {
        const t = u * TAU;
        const s = q.s;
        return [
          (-22 * Math.cos(t) - 128 * Math.sin(t) - 44 * Math.cos(3 * t) - 78 * Math.sin(3 * t)) * s * 0.01,
          (-10 * Math.cos(2 * t) - 27 * Math.sin(2 * t) + 38 * Math.cos(4 * t) + 46 * Math.sin(4 * t)) * s * 0.01,
          (70 * Math.cos(3 * t) - 40 * Math.sin(3 * t)) * s * 0.01,
        ];
      },
    },
    figureEightKnot: {
      label: 'Sekiz Düğümü',
      accuracy: 'exact',
      params: [p('s', 'Ölçek', 0.1, 0.6, 0.01, 0.3)],
      f: (u, q) => {
        const t = u * TAU;
        const s = q.s;
        return [
          (2 + Math.cos(2 * t)) * Math.cos(3 * t) * s,
          Math.sin(4 * t) * s,
          (2 + Math.cos(2 * t)) * Math.sin(3 * t) * s,
        ];
      },
    },
    solenoid: {
      label: 'Solenoit',
      accuracy: 'exact',
      params: [p('big', 'Ana Dönüş', 1, 6, 1, 2), p('small', 'İnce Dönüş', 4, 60, 1, 24), p('r', 'İnce Yarıçap', 0.02, 0.4, 0.01, 0.14)],
      f: (u, q) => {
        const t = u * TAU * q.big;
        const s = u * TAU * q.small;
        const R = 0.7;
        return [
          (R + q.r * Math.cos(s)) * Math.cos(t),
          q.r * Math.sin(s),
          (R + q.r * Math.cos(s)) * Math.sin(t),
        ];
      },
    },
    torusLink: {
      label: 'Simit Halkası (p,q)',
      accuracy: 'exact',
      params: [p('pp', 'p', 1, 9, 1, 3), p('qq', 'q', 1, 9, 1, 4), p('R', 'Yarıçap', 0.3, 1, 0.02, 0.6)],
      f: (u, q) => {
        const t = u * TAU;
        const r = q.R * (2 + Math.cos(q.qq * t)) / 3;
        return [r * Math.cos(q.pp * t), r * Math.sin(q.qq * t) * 0.6, r * Math.sin(q.pp * t)];
      },
    },
  });

  // ==========================================================================
  // ÇEKİCİLER (sürekli)
  //
  // Her birinin parametre aralığı, sistemin sınırlı kaldığı bölgeye göre
  // seçildi. tests/formulas-health.test.js her kaydırıcı ucunu üç ayrı
  // integrasyon adımıyla tarar; kaçan bir yörünge testte hemen görünür.
  // ==========================================================================
  F.extend('attractor', {
    chen: {
      label: 'Chen',
      accuracy: 'approx',
      start: [-0.1, 0.5, -0.6],
      scale: 0.03,
      center: [0, 0, 22],
      params: [p('a', 'a', 30, 45, 0.1, 35), p('b', 'b', 2, 5, 0.1, 3), p('c', 'c', 20, 32, 0.1, 28)],
      step: (s, q, dt) => [
        s[0] + dt * (q.a * (s[1] - s[0])),
        s[1] + dt * ((q.c - q.a) * s[0] - s[0] * s[2] + q.c * s[1]),
        s[2] + dt * (s[0] * s[1] - q.b * s[2]),
      ],
    },
    chua: {
      label: 'Chua Devresi',
      accuracy: 'approx',
      start: [0.7, 0, 0],
      scale: 0.16,
      center: [0, 0, 0],
      params: [p('alpha', 'α', 9, 18, 0.1, 15.6), p('beta', 'β', 20, 35, 0.1, 28), p('m0', 'm₀', -2, -0.5, 0.01, -1.143), p('m1', 'm₁', -1.2, -0.2, 0.01, -0.714)],
      step: (s, q, dt) => {
        const h = q.m1 * s[0] + 0.5 * (q.m0 - q.m1) * (Math.abs(s[0] + 1) - Math.abs(s[0] - 1));
        return [
          s[0] + dt * (q.alpha * (s[1] - s[0] - h)),
          s[1] + dt * (s[0] - s[1] + s[2]),
          s[2] + dt * (-q.beta * s[1]),
        ];
      },
    },
    dadras: {
      label: 'Dadras',
      accuracy: 'approx',
      start: [1.1, 2.1, -2],
      scale: 0.06,
      center: [0, 0, 0],
      params: [p('a', 'a', 2, 4, 0.05, 3), p('b', 'b', 2, 3.5, 0.05, 2.7), p('c', 'c', 1.2, 2.2, 0.02, 1.7), p('d', 'd', 1.5, 2.5, 0.02, 2), p('e', 'e', 7, 10, 0.05, 9)],
      step: (s, q, dt) => [
        s[0] + dt * (s[1] - q.a * s[0] + q.b * s[1] * s[2]),
        s[1] + dt * (q.c * s[1] - s[0] * s[2] + s[2]),
        s[2] + dt * (q.d * s[0] * s[1] - q.e * s[2]),
      ],
    },
    fourWing: {
      label: 'Dört Kanat',
      accuracy: 'approx',
      start: [0.1, -0.1, 0.1],
      scale: 0.14,
      center: [0, 0, 0],
      params: [p('a', 'a', 0.15, 0.35, 0.005, 0.2), p('b', 'b', 0.005, 0.03, 0.001, 0.01), p('c', 'c', -0.6, -0.2, 0.01, -0.4)],
      step: (s, q, dt) => [
        s[0] + dt * (q.a * s[0] + s[1] * s[2]),
        s[1] + dt * (q.b * s[0] + q.c * s[1] - s[0] * s[2]),
        s[2] + dt * (-s[2] - s[0] * s[1]),
      ],
    },
    rabinovich: {
      label: 'Rabinovich-Fabrikant',
      accuracy: 'approx',
      start: [-1, 0, 0.5],
      scale: 0.24,
      center: [0, 0, 0],
      params: [p('alpha', 'α', 0.05, 0.25, 0.005, 0.14), p('gamma', 'γ', 0.05, 0.15, 0.001, 0.1)],
      step: (s, q, dt) => [
        s[0] + dt * (s[1] * (s[2] - 1 + s[0] * s[0]) + q.gamma * s[0]),
        s[1] + dt * (s[0] * (3 * s[2] + 1 - s[0] * s[0]) + q.gamma * s[1]),
        s[2] + dt * (-2 * s[2] * (q.alpha + s[0] * s[1])),
      ],
    },
    noseHoover: {
      label: 'Nosé-Hoover',
      accuracy: 'approx',
      start: [0.1, 0.1, 0.1],
      scale: 0.26,
      center: [0, 0, 0],
      params: [p('a', 'a', 1, 2, 0.01, 1.5)],
      step: (s, q, dt) => [
        s[0] + dt * s[1],
        s[1] + dt * (-s[0] + s[1] * s[2]),
        s[2] + dt * (q.a - s[1] * s[1]),
      ],
    },
    rikitake: {
      label: 'Rikitake Dinamosu',
      accuracy: 'approx',
      start: [0.1, 0, 0.1],
      scale: 0.12,
      center: [0, 0, 0],
      params: [p('a', 'a', 1, 6, 0.05, 5), p('mu', 'μ', 1, 4, 0.05, 2)],
      step: (s, q, dt) => [
        s[0] + dt * (-q.mu * s[0] + s[1] * s[2]),
        s[1] + dt * (-q.mu * s[1] + s[0] * (s[2] - q.a)),
        s[2] + dt * (1 - s[0] * s[1]),
      ],
    },
    sprottLinzA: {
      label: 'Sprott-Linz A',
      accuracy: 'approx',
      start: [0, 0.5, 0],
      scale: 0.2,
      center: [0, 0, 0],
      params: [p('a', 'a', 0.5, 1.5, 0.01, 1)],
      step: (s, q, dt) => [
        s[0] + dt * s[1],
        s[1] + dt * (-s[0] + s[1] * s[2]),
        s[2] + dt * (q.a - s[1] * s[1]),
      ],
    },
    sprottLinzB: {
      label: 'Sprott-Linz B',
      accuracy: 'approx',
      start: [0.1, 0.1, 0.1],
      scale: 0.2,
      center: [0, 0, 0],
      params: [p('a', 'a', 0.5, 1.5, 0.01, 1)],
      step: (s, q, dt) => [
        s[0] + dt * (q.a * s[1] * s[2]),
        s[1] + dt * (s[0] - s[1]),
        s[2] + dt * (1 - s[0] * s[1]),
      ],
    },
    lorenz84: {
      label: 'Lorenz-84',
      accuracy: 'approx',
      start: [0.5, 0.5, 0.5],
      scale: 0.3,
      center: [0, 0, 0],
      params: [p('a', 'a', 0.2, 0.35, 0.005, 0.25), p('b', 'b', 3, 5, 0.05, 4), p('ff', 'F', 6, 10, 0.05, 8), p('gg', 'G', 0.5, 1.5, 0.01, 1)],
      step: (s, q, dt) => [
        s[0] + dt * (-s[1] * s[1] - s[2] * s[2] - q.a * s[0] + q.a * q.ff),
        s[1] + dt * (s[0] * s[1] - q.b * s[0] * s[2] - s[1] + q.gg),
        s[2] + dt * (q.b * s[0] * s[1] + s[0] * s[2] - s[2]),
      ],
    },
    langford: {
      label: 'Langford (Aizawa varyantı)',
      accuracy: 'approx',
      start: [0.1, 0, 0],
      scale: 0.35,
      center: [0, 0, 0],
      params: [p('a', 'a', 0.9, 1.1, 0.005, 0.95), p('b', 'b', 0.6, 0.8, 0.005, 0.7), p('c', 'c', 0.5, 0.7, 0.005, 0.6), p('d', 'd', 3.2, 3.7, 0.01, 3.5)],
      step: (s, q, dt) => [
        s[0] + dt * ((s[2] - q.b) * s[0] - q.d * s[1]),
        s[1] + dt * (q.d * s[0] + (s[2] - q.b) * s[1]),
        s[2] + dt * (q.c + q.a * s[2] - (s[2] * s[2] * s[2]) / 3 - (s[0] * s[0] + s[1] * s[1]) * (1 + 0.25 * s[2])),
      ],
    },
    duffing: {
      label: 'Duffing Salınıcısı',
      accuracy: 'approx',
      start: [0.1, 0.1, 0],
      scale: 0.35,
      center: [0, 0, 0],
      params: [p('a', 'a', 0.1, 0.4, 0.005, 0.25), p('b', 'b', 0.2, 0.5, 0.005, 0.3)],
      step: (s, q, dt) => {
        // Üçüncü bileşen sürücü fazı: sistemi otonom hale getirir
        const ph = s[2];
        return [
          s[0] + dt * s[1],
          s[1] + dt * (-q.a * s[1] - s[0] * s[0] * s[0] + q.b * Math.cos(ph)),
          ph + dt,
        ];
      },
      bound: 50,
    },
  });

  // ==========================================================================
  // ÇEKİCİLER (ayrık haritalar)
  //
  // Ayrık haritalar kapalı formludur: her adım tam olarak hesaplanır,
  // integrasyon hatası yoktur.
  // ==========================================================================
  F.extend('attractor', {
    henon: {
      label: 'Hénon',
      accuracy: 'exact',
      start: [0.1, 0.1, 0],
      scale: 0.6,
      center: [0, 0, 0],
      discrete: true,
      params: [p('a', 'a', 1, 1.42, 0.005, 1.4), p('b', 'b', 0.1, 0.4, 0.005, 0.3)],
      step: (s, q) => [1 - q.a * s[0] * s[0] + s[1], q.b * s[0], 0],
    },
    ikeda: {
      label: 'Ikeda',
      accuracy: 'exact',
      start: [0.1, 0.1, 0],
      scale: 0.25,
      center: [0, 0, 0],
      discrete: true,
      // u ≳ 0.91'de yörünge bir sabit noktaya oturur ve çekici kaybolur;
      // kaydırıcı yalnızca kaotik bölgeyi kapsar
      params: [p('u', 'u', 0.6, 0.9, 0.005, 0.9)],
      step: (s, q) => {
        const t = 0.4 - 6 / (1 + s[0] * s[0] + s[1] * s[1]);
        const ct = Math.cos(t);
        const st = Math.sin(t);
        return [1 + q.u * (s[0] * ct - s[1] * st), q.u * (s[0] * st + s[1] * ct), 0];
      },
    },
    tinkerbell: {
      label: 'Tinkerbell',
      accuracy: 'exact',
      start: [-0.72, -0.64, 0],
      scale: 0.7,
      center: [0, 0, 0],
      discrete: true,
      params: [p('a', 'a', 0.85, 0.95, 0.001, 0.9), p('b', 'b', -0.65, -0.55, 0.001, -0.6013), p('c', 'c', 1.9, 2.1, 0.005, 2), p('d', 'd', 0.4, 0.6, 0.005, 0.5)],
      step: (s, q) => [
        s[0] * s[0] - s[1] * s[1] + q.a * s[0] + q.b * s[1],
        2 * s[0] * s[1] + q.c * s[0] + q.d * s[1],
        0,
      ],
    },
    gumowskiMira: {
      label: 'Gumowski-Mira',
      accuracy: 'exact',
      start: [0.1, 0.1, 0],
      scale: 0.06,
      center: [0, 0, 0],
      discrete: true,
      params: [p('a', 'a', 0.005, 0.05, 0.001, 0.008), p('b', 'b', 0.9, 1, 0.005, 0.99), p('mu', 'μ', -1, -0.5, 0.005, -0.801)],
      step: (s, q) => {
        const g = (x) => q.mu * x + (2 * (1 - q.mu) * x * x) / (1 + x * x);
        const xn = q.b * s[1] + g(s[0]);
        return [xn, -s[0] + g(xn), 0];
      },
      bound: 200,
    },
    bedhead: {
      label: 'Bedhead',
      accuracy: 'exact',
      start: [1, 1, 0],
      scale: 0.55,
      center: [0, 0, 0],
      discrete: true,
      // b bölen olduğu için sıfırdan uzak tutulur; klasik değerler a=-0.81,
      // b=-0.92 ve aralık bunların çevresinde kaotik kaldığı bölgeyi kapsar
      params: [p('a', 'a', -1.2, -0.3, 0.005, -0.81), p('b', 'b', -1.2, -0.4, 0.005, -0.92)],
      step: (s, q) => [
        Math.sin((s[0] * s[1]) / q.b) * s[1] + Math.cos(q.a * s[0] - s[1]),
        s[0] + Math.sin(s[1]) / q.b,
        0,
      ],
    },
    svensson: {
      label: 'Svensson',
      accuracy: 'exact',
      start: [0.1, 0.1, 0],
      scale: 0.32,
      center: [0, 0, 0],
      discrete: true,
      params: [p('a', 'a', -2, 2, 0.01, 1.4), p('b', 'b', -2, 2, 0.01, 1.56), p('c', 'c', -2, 2, 0.01, 1.4), p('d', 'd', -8, 8, 0.01, -6.56)],
      step: (s, q) => [
        q.d * Math.sin(q.a * s[0]) - Math.sin(q.b * s[1]),
        q.c * Math.cos(q.a * s[0]) + Math.cos(q.b * s[1]),
        0,
      ],
    },
    hopalong: {
      label: 'Hopalong (Barry Martin)',
      accuracy: 'exact',
      start: [0, 0, 0],
      scale: 0.045,
      center: [0, 0, 0],
      discrete: true,
      params: [p('a', 'a', 0.1, 4, 0.01, 2), p('b', 'b', 0.1, 4, 0.01, 1), p('c', 'c', 0.1, 4, 0.01, 0.5)],
      step: (s, q) => [
        s[1] - Math.sign(s[0] || 1) * Math.sqrt(Math.abs(q.b * s[0] - q.c)),
        q.a - s[0],
        0,
      ],
      bound: 400,
    },
    standardMap: {
      label: 'Standart Harita (Chirikov)',
      accuracy: 'exact',
      start: [0.1, 0.1, 0],
      scale: 0.28,
      center: [Math.PI, Math.PI, 0],
      discrete: true,
      params: [p('K', 'K', 0.2, 4, 0.02, 0.971635)],
      step: (s, q) => {
        // Toroid üzerinde: değerler 2π'ye göre sarılır, yani doğal sınırlı
        let pnew = s[1] + q.K * Math.sin(s[0]);
        pnew = ((pnew % TAU) + TAU) % TAU;
        let xnew = s[0] + pnew;
        xnew = ((xnew % TAU) + TAU) % TAU;
        return [xnew, pnew, 0];
      },
    },
  });
})();
