'use strict';
/* Matematiksel formül kitaplığı.

   Üç aile:
     curve2d   — düzlem eğrileri.  f(u, p) -> [x, y]        (u ∈ [0,1])
     curve3d   — uzay eğrileri.    f(u, p) -> [x, y, z]
     surface   — parametrik yüzey. f(u, v, p) -> [x, y, z]  (u,v ∈ [0,1])
     attractor — çekici sistem.    step(s, p, dt) -> [x, y, z] (durum ilerletir)

   Hepsi kanonik matematik: literatürde tanımlı, telif konusu olmayan
   ifadeler. Kapalı formlu olanların bilinen noktalardaki değerleri
   tests/formulas.test.js içinde sayısal olarak doğrulanır — "kaç formül var"
   demek kolay, "hangileri doğru" demek zor olduğu için.

   `accuracy` alanı dürüstlük içindir:
     'exact'        — kapalı form, çift duyarlıkta tam (test edilir)
     'approx'       — sayısal integrasyon/yaklaşım, sınırlı hata
     'visual'       — görsel amaçlı; niceliksel doğrulama yok */
(function () {
  const TAU = Math.PI * 2;

  // ==========================================================================
  // DÜZLEM EĞRİLERİ
  // ==========================================================================
  const CURVES_2D = {
    lissajous: {
      label: 'Lissajous',
      accuracy: 'exact',
      params: [
        { name: 'a', label: 'a', min: 1, max: 12, step: 1, default: 3 },
        { name: 'b', label: 'b', min: 1, max: 12, step: 1, default: 2 },
        { name: 'delta', label: 'Faz', min: 0, max: 1, step: 0.01, default: 0.25 },
      ],
      f: (u, p) => [Math.sin(p.a * u * TAU + p.delta * TAU), Math.sin(p.b * u * TAU)],
    },
    rose: {
      label: 'Gül Eğrisi (Rhodonea)',
      accuracy: 'exact',
      params: [
        { name: 'n', label: 'n', min: 1, max: 12, step: 1, default: 5 },
        { name: 'd', label: 'd', min: 1, max: 12, step: 1, default: 1 },
      ],
      f: (u, p) => {
        const th = u * TAU * p.d;
        const r = Math.cos((p.n / p.d) * th);
        return [r * Math.cos(th), r * Math.sin(th)];
      },
    },
    epicycloid: {
      label: 'Episikloid',
      accuracy: 'exact',
      params: [
        { name: 'R', label: 'R', min: 1, max: 10, step: 0.1, default: 3 },
        { name: 'r', label: 'r', min: 0.2, max: 5, step: 0.1, default: 1 },
      ],
      f: (u, p) => {
        const t = u * TAU;
        const k = (p.R + p.r) / p.r;
        const s = 1 / (p.R + 2 * p.r);
        return [
          ((p.R + p.r) * Math.cos(t) - p.r * Math.cos(k * t)) * s,
          ((p.R + p.r) * Math.sin(t) - p.r * Math.sin(k * t)) * s,
        ];
      },
    },
    hypotrochoid: {
      label: 'Hipotrokoid (Spirograf)',
      accuracy: 'exact',
      params: [
        { name: 'R', label: 'R', min: 1, max: 10, step: 0.1, default: 5 },
        { name: 'r', label: 'r', min: 0.2, max: 5, step: 0.1, default: 3 },
        { name: 'd', label: 'd', min: 0, max: 6, step: 0.1, default: 5 },
      ],
      f: (u, p) => {
        const t = u * TAU * 3;
        const k = (p.R - p.r) / p.r;
        const s = 1 / (p.R - p.r + p.d || 1);
        return [
          ((p.R - p.r) * Math.cos(t) + p.d * Math.cos(k * t)) * s,
          ((p.R - p.r) * Math.sin(t) - p.d * Math.sin(k * t)) * s,
        ];
      },
    },
    superformula: {
      label: 'Süperformül (Gielis)',
      accuracy: 'exact',
      params: [
        { name: 'm', label: 'm', min: 0, max: 20, step: 0.5, default: 6 },
        { name: 'n1', label: 'n1', min: 0.1, max: 10, step: 0.1, default: 1 },
        { name: 'n2', label: 'n2', min: 0.1, max: 10, step: 0.1, default: 1.7 },
        { name: 'n3', label: 'n3', min: 0.1, max: 10, step: 0.1, default: 1.7 },
      ],
      f: (u, p) => {
        const th = u * TAU;
        const r = superShape(th, p.m, p.n1, p.n2, p.n3);
        return [r * Math.cos(th), r * Math.sin(th)];
      },
    },
    butterfly: {
      label: 'Kelebek Eğrisi',
      accuracy: 'exact',
      params: [{ name: 'turns', label: 'Tur', min: 1, max: 12, step: 1, default: 6 }],
      f: (u, p) => {
        const t = u * TAU * p.turns;
        const r = (Math.exp(Math.cos(t)) - 2 * Math.cos(4 * t) + Math.pow(Math.sin(t / 12), 5)) / 4.2;
        return [r * Math.sin(t), -r * Math.cos(t)];
      },
    },
    lemniscate: {
      label: 'Lemniskat (Bernoulli)',
      accuracy: 'exact',
      params: [{ name: 'a', label: 'a', min: 0.2, max: 2, step: 0.05, default: 1 }],
      f: (u, p) => {
        const t = u * TAU;
        const d = 1 + Math.sin(t) * Math.sin(t);
        return [(p.a * Math.cos(t)) / d, (p.a * Math.sin(t) * Math.cos(t)) / d];
      },
    },
    astroid: {
      label: 'Astroid',
      accuracy: 'exact',
      params: [{ name: 'n', label: 'Üs', min: 0.2, max: 4, step: 0.05, default: 3 }],
      f: (u, p) => {
        const t = u * TAU;
        const c = Math.cos(t);
        const s = Math.sin(t);
        return [Math.sign(c) * Math.pow(Math.abs(c), p.n), Math.sign(s) * Math.pow(Math.abs(s), p.n)];
      },
    },
    cardioid: {
      label: 'Kardiyoid',
      accuracy: 'exact',
      params: [{ name: 'a', label: 'a', min: 0.2, max: 2, step: 0.05, default: 0.5 }],
      f: (u, p) => {
        const t = u * TAU;
        const r = p.a * (1 - Math.cos(t));
        return [r * Math.cos(t), r * Math.sin(t)];
      },
    },
    phyllotaxis: {
      label: 'Filotaksi (Altın Açı)',
      accuracy: 'exact',
      params: [
        { name: 'angle', label: 'Açı (derece)', min: 100, max: 200, step: 0.1, default: 137.5 },
        { name: 'spread', label: 'Yayılma', min: 0.2, max: 3, step: 0.05, default: 1 },
      ],
      f: (u, p, i, n) => {
        const k = i == null ? u * (n || 500) : i;
        const th = (k * p.angle * Math.PI) / 180;
        const r = (p.spread * Math.sqrt(k)) / Math.sqrt(n || 500);
        return [r * Math.cos(th), r * Math.sin(th)];
      },
      pointwise: true, // noktasal: her i ayrı bir nokta (çizgi değil)
    },
    spiralLog: {
      label: 'Logaritmik Sarmal',
      accuracy: 'exact',
      params: [
        { name: 'a', label: 'a', min: 0.05, max: 1, step: 0.01, default: 0.15 },
        { name: 'turns', label: 'Tur', min: 1, max: 10, step: 0.5, default: 4 },
      ],
      f: (u, p) => {
        const t = u * TAU * p.turns;
        const r = p.a * Math.exp(0.15 * t);
        const s = 1 / (p.a * Math.exp(0.15 * TAU * p.turns));
        return [r * Math.cos(t) * s, r * Math.sin(t) * s];
      },
    },
    harmonograph: {
      label: 'Harmonograf',
      accuracy: 'exact',
      params: [
        { name: 'f1', label: 'f1', min: 1, max: 8, step: 0.01, default: 2 },
        { name: 'f2', label: 'f2', min: 1, max: 8, step: 0.01, default: 3 },
        { name: 'damp', label: 'Sönüm', min: 0, max: 3, step: 0.01, default: 0.6 },
      ],
      f: (u, p) => {
        const t = u * TAU * 4;
        const d = Math.exp(-p.damp * u * 2);
        return [Math.sin(p.f1 * t) * d, Math.sin(p.f2 * t + 1.2) * d];
      },
    },
  };

  // ==========================================================================
  // UZAY EĞRİLERİ
  // ==========================================================================
  const CURVES_3D = {
    torusKnot: {
      label: 'Simit Düğümü',
      accuracy: 'exact',
      params: [
        { name: 'p', label: 'p', min: 1, max: 12, step: 1, default: 2 },
        { name: 'q', label: 'q', min: 1, max: 12, step: 1, default: 3 },
      ],
      f: (u, prm) => {
        const t = u * TAU;
        const r = (2 + Math.cos((prm.q * t) / prm.p)) / 3;
        return [r * Math.cos(t), r * Math.sin(t), Math.sin((prm.q * t) / prm.p) / 3];
      },
    },
    helix3: {
      label: 'Sarmal (Helis)',
      accuracy: 'exact',
      params: [
        { name: 'turns', label: 'Tur', min: 1, max: 20, step: 0.5, default: 6 },
        { name: 'radius', label: 'Yarıçap', min: 0.1, max: 1, step: 0.02, default: 0.6 },
      ],
      f: (u, p) => {
        const t = u * TAU * p.turns;
        return [p.radius * Math.cos(t), u * 2 - 1, p.radius * Math.sin(t)];
      },
    },
    viviani: {
      label: 'Viviani Eğrisi',
      accuracy: 'exact',
      params: [{ name: 'a', label: 'a', min: 0.2, max: 1, step: 0.02, default: 0.6 }],
      f: (u, p) => {
        const t = u * 2 * TAU;
        const a = p.a;
        return [a * (1 + Math.cos(t)), a * Math.sin(t), 2 * a * Math.sin(t / 2)];
      },
    },
    trefoil: {
      label: 'Yonca Düğümü',
      accuracy: 'exact',
      params: [{ name: 'scale', label: 'Ölçek', min: 0.1, max: 0.5, step: 0.01, default: 0.22 }],
      f: (u, p) => {
        const t = u * TAU;
        const s = p.scale;
        return [
          s * (Math.sin(t) + 2 * Math.sin(2 * t)),
          s * (Math.cos(t) - 2 * Math.cos(2 * t)),
          s * -Math.sin(3 * t),
        ];
      },
    },
  };

  // ==========================================================================
  // PARAMETRİK YÜZEYLER
  // ==========================================================================
  const SURFACES = {
    plane: {
      label: 'Düzlem',
      accuracy: 'exact',
      params: [],
      f: (u, v) => [u * 2 - 1, v * 2 - 1, 0],
    },
    sphere: {
      label: 'Küre',
      accuracy: 'exact',
      params: [],
      f: (u, v) => {
        const th = u * TAU;
        const ph = v * Math.PI;
        return [Math.sin(ph) * Math.cos(th), Math.cos(ph), Math.sin(ph) * Math.sin(th)];
      },
    },
    torus: {
      label: 'Simit (Torus)',
      accuracy: 'exact',
      params: [{ name: 'tube', label: 'Boru Kalınlığı', min: 0.05, max: 0.6, step: 0.01, default: 0.35 }],
      f: (u, v, p) => {
        const th = u * TAU;
        const ph = v * TAU;
        const R = 1 - p.tube;
        return [
          (R + p.tube * Math.cos(ph)) * Math.cos(th),
          p.tube * Math.sin(ph),
          (R + p.tube * Math.cos(ph)) * Math.sin(th),
        ];
      },
    },
    klein: {
      label: 'Klein Şişesi',
      accuracy: 'exact',
      params: [],
      f: (u, v) => {
        // Klasik "sekiz" (figure-8) daldırması — kapalı form
        const th = u * TAU;
        const ph = v * TAU;
        const r = 0.5;
        const c = Math.cos(th / 2) * Math.sin(ph) - Math.sin(th / 2) * Math.sin(2 * ph);
        const s = Math.sin(th / 2) * Math.sin(ph) + Math.cos(th / 2) * Math.sin(2 * ph);
        const w = (2 + r * c) * 0.42;
        return [w * Math.cos(th), r * s * 0.9, w * Math.sin(th)];
      },
    },
    mobius: {
      label: 'Möbius Şeridi',
      accuracy: 'exact',
      params: [{ name: 'width', label: 'Genişlik', min: 0.05, max: 0.8, step: 0.01, default: 0.35 }],
      f: (u, v, p) => {
        const th = u * TAU;
        const w = (v - 0.5) * 2 * p.width;
        const r = 1 - p.width;
        return [
          (r + w * Math.cos(th / 2)) * Math.cos(th),
          w * Math.sin(th / 2),
          (r + w * Math.cos(th / 2)) * Math.sin(th),
        ];
      },
    },
    supershape: {
      label: 'Süperşekil (3B Gielis)',
      accuracy: 'exact',
      params: [
        { name: 'm1', label: 'm1', min: 0, max: 20, step: 0.5, default: 7 },
        { name: 'n11', label: 'n1', min: 0.1, max: 10, step: 0.1, default: 0.2 },
        { name: 'n12', label: 'n2', min: 0.1, max: 10, step: 0.1, default: 1.7 },
        { name: 'n13', label: 'n3', min: 0.1, max: 10, step: 0.1, default: 1.7 },
      ],
      f: (u, v, p) => {
        const th = u * TAU - Math.PI;
        const ph = v * Math.PI - Math.PI / 2;
        const r1 = superShape(th, p.m1, p.n11, p.n12, p.n13);
        const r2 = superShape(ph, p.m1, p.n11, p.n12, p.n13);
        return [
          r1 * Math.cos(th) * r2 * Math.cos(ph),
          r2 * Math.sin(ph),
          r1 * Math.sin(th) * r2 * Math.cos(ph),
        ];
      },
    },
    seashell: {
      label: 'Deniz Kabuğu',
      accuracy: 'exact',
      params: [{ name: 'turns', label: 'Tur', min: 1, max: 8, step: 0.5, default: 4 }],
      f: (u, v, p) => {
        const th = u * TAU * p.turns;
        const ph = v * TAU;
        const g = Math.exp(-1.2 * u * p.turns * 0.25);
        const r = 0.5 * g;
        return [
          (1.2 * g + r * Math.cos(ph)) * Math.cos(th) * 0.8,
          u * 1.6 - 0.8 + r * Math.sin(ph),
          (1.2 * g + r * Math.cos(ph)) * Math.sin(th) * 0.8,
        ];
      },
    },
    boy: {
      label: 'Boy Yüzeyi',
      accuracy: 'exact',
      params: [],
      f: (u, v) => {
        // Bryant–Kusner parametrizasyonunun sadeleştirilmiş biçimi
        const a = u * Math.PI;
        const b = v * Math.PI;
        const ca = Math.cos(a);
        const sa = Math.sin(a);
        const c2b = Math.cos(2 * b);
        const s2b = Math.sin(2 * b);
        const d = 2 - Math.sqrt(2) * sa * Math.sin(3 * b);
        return [
          (Math.sqrt(2) * ca * ca * c2b + ca * s2b) / d * 0.9,
          (3 * ca * ca) / d * 0.6 - 0.6,
          (Math.sqrt(2) * ca * ca * s2b - ca * c2b) / d * 0.9,
        ];
      },
    },
    dini: {
      label: 'Dini Yüzeyi',
      accuracy: 'exact',
      params: [{ name: 'twist', label: 'Burulma', min: 0.05, max: 0.6, step: 0.01, default: 0.2 }],
      f: (u, v, p) => {
        const a = u * TAU * 2;
        const b = 0.05 + v * 1.5;
        return [
          Math.cos(a) * Math.sin(b) * 0.8,
          (Math.cos(b) + Math.log(Math.tan(b / 2)) + p.twist * a) * 0.28,
          Math.sin(a) * Math.sin(b) * 0.8,
        ];
      },
    },
    sphericalHarmonic: {
      label: 'Küresel Harmonik',
      accuracy: 'exact',
      params: [
        { name: 'm0', label: 'm0', min: 0, max: 8, step: 1, default: 4 },
        { name: 'm1', label: 'm1', min: 0, max: 8, step: 1, default: 3 },
        { name: 'm2', label: 'm2', min: 0, max: 8, step: 1, default: 2 },
        { name: 'm3', label: 'm3', min: 0, max: 8, step: 1, default: 3 },
      ],
      f: (u, v, p) => {
        const th = u * TAU;
        const ph = v * Math.PI;
        const r =
          Math.pow(Math.sin(p.m0 * ph), 1) +
          Math.pow(Math.cos(p.m1 * ph), 2) +
          Math.pow(Math.sin(p.m2 * th), 1) +
          Math.pow(Math.cos(p.m3 * th), 2);
        const s = r / 4;
        return [s * Math.sin(ph) * Math.cos(th), s * Math.cos(ph), s * Math.sin(ph) * Math.sin(th)];
      },
    },
    chladni: {
      label: 'Chladni Deseni',
      accuracy: 'exact',
      params: [
        { name: 'm', label: 'm', min: 1, max: 12, step: 1, default: 3 },
        { name: 'n', label: 'n', min: 1, max: 12, step: 1, default: 5 },
        { name: 'height', label: 'Yükseklik', min: 0, max: 1, step: 0.02, default: 0.35 },
      ],
      f: (u, v, p) => {
        const x = u * 2 - 1;
        const y = v * 2 - 1;
        // Kare plakanın klasik duran dalga çözümü
        const z =
          Math.cos(p.n * Math.PI * u) * Math.cos(p.m * Math.PI * v) -
          Math.cos(p.m * Math.PI * u) * Math.cos(p.n * Math.PI * v);
        return [x, z * p.height, y];
      },
    },
    ripple: {
      label: 'Dalga Yüzeyi',
      accuracy: 'exact',
      params: [
        { name: 'freq', label: 'Sıklık', min: 1, max: 30, step: 0.5, default: 8 },
        { name: 'height', label: 'Yükseklik', min: 0, max: 1, step: 0.02, default: 0.25 },
      ],
      f: (u, v, p) => {
        const x = u * 2 - 1;
        const y = v * 2 - 1;
        const r = Math.sqrt(x * x + y * y);
        return [x, Math.sin(r * p.freq) * p.height * Math.exp(-r), y];
      },
    },
  };

  // ==========================================================================
  // ÇEKİCİLER (strange attractors)
  //
  // Durum sistemi: her adımda önceki noktadan yeni nokta üretilir. Sayısal
  // integrasyon olduğu için 'approx' — kapalı formları yoktur.
  // ==========================================================================
  const ATTRACTORS = {
    lorenz: {
      label: 'Lorenz',
      accuracy: 'approx',
      start: [0.1, 0, 0],
      scale: 0.045,
      center: [0, 0, -25],
      params: [
        { name: 'sigma', label: 'σ', min: 1, max: 20, step: 0.1, default: 10 },
        { name: 'rho', label: 'ρ', min: 1, max: 60, step: 0.1, default: 28 },
        { name: 'beta', label: 'β', min: 0.1, max: 6, step: 0.01, default: 8 / 3 },
      ],
      step: (s, p, dt) => [
        s[0] + dt * p.sigma * (s[1] - s[0]),
        s[1] + dt * (s[0] * (p.rho - s[2]) - s[1]),
        s[2] + dt * (s[0] * s[1] - p.beta * s[2]),
      ],
    },
    rossler: {
      label: 'Rössler',
      accuracy: 'approx',
      start: [1, 1, 1],
      scale: 0.05,
      center: [0, 0, -5],
      params: [
        { name: 'a', label: 'a', min: 0.05, max: 0.5, step: 0.005, default: 0.2 },
        { name: 'b', label: 'b', min: 0.05, max: 2, step: 0.01, default: 0.2 },
        { name: 'c', label: 'c', min: 1, max: 18, step: 0.1, default: 5.7 },
      ],
      step: (s, p, dt) => [
        s[0] + dt * (-s[1] - s[2]),
        s[1] + dt * (s[0] + p.a * s[1]),
        s[2] + dt * (p.b + s[2] * (s[0] - p.c)),
      ],
    },
    thomas: {
      label: 'Thomas',
      accuracy: 'approx',
      start: [0.1, 0, 0],
      scale: 0.2,
      center: [0, 0, 0],
      params: [{ name: 'b', label: 'b', min: 0.1, max: 0.35, step: 0.005, default: 0.208186 }],
      step: (s, p, dt) => [
        s[0] + dt * (Math.sin(s[1]) - p.b * s[0]),
        s[1] + dt * (Math.sin(s[2]) - p.b * s[1]),
        s[2] + dt * (Math.sin(s[0]) - p.b * s[2]),
      ],
    },
    aizawa: {
      label: 'Aizawa',
      accuracy: 'approx',
      start: [0.1, 0, 0],
      scale: 0.5,
      center: [0, 0, 0],
      params: [
        { name: 'a', label: 'a', min: 0.1, max: 1.5, step: 0.01, default: 0.95 },
        { name: 'b', label: 'b', min: 0.1, max: 1.5, step: 0.01, default: 0.7 },
        { name: 'c', label: 'c', min: 0.1, max: 1.5, step: 0.01, default: 0.6 },
        { name: 'd', label: 'd', min: 1, max: 5, step: 0.05, default: 3.5 },
      ],
      step: (s, p, dt) => [
        s[0] + dt * ((s[2] - p.b) * s[0] - p.d * s[1]),
        s[1] + dt * (p.d * s[0] + (s[2] - p.b) * s[1]),
        s[2] + dt * (p.c + p.a * s[2] - (s[2] * s[2] * s[2]) / 3 - (s[0] * s[0] + s[1] * s[1]) * (1 + 0.25 * s[2]) + 0.1 * s[2] * s[0] * s[0] * s[0]),
      ],
    },
    halvorsen: {
      label: 'Halvorsen',
      accuracy: 'approx',
      start: [-1.48, -1.51, 2.04],
      scale: 0.08,
      center: [0, 0, 0],
      // a < 1.3 için sistem sınırlı değildir (yörünge sonsuza kaçar); kaydırıcı
      // bu yüzden yalnızca çekicinin var olduğu aralığı kapsar
      params: [{ name: 'a', label: 'a', min: 1.3, max: 3, step: 0.01, default: 1.89 }],
      step: (s, p, dt) => [
        s[0] + dt * (-p.a * s[0] - 4 * s[1] - 4 * s[2] - s[1] * s[1]),
        s[1] + dt * (-p.a * s[1] - 4 * s[2] - 4 * s[0] - s[2] * s[2]),
        s[2] + dt * (-p.a * s[2] - 4 * s[0] - 4 * s[1] - s[0] * s[0]),
      ],
    },
    clifford: {
      label: 'Clifford (Ayrık)',
      accuracy: 'exact', // ayrık harita: kapalı form, yuvarlama dışında tam
      start: [0.1, 0.1, 0],
      scale: 0.4,
      center: [0, 0, 0],
      discrete: true,
      params: [
        { name: 'a', label: 'a', min: -3, max: 3, step: 0.01, default: -1.4 },
        { name: 'b', label: 'b', min: -3, max: 3, step: 0.01, default: 1.6 },
        { name: 'c', label: 'c', min: -3, max: 3, step: 0.01, default: 1 },
        { name: 'd', label: 'd', min: -3, max: 3, step: 0.01, default: 0.7 },
      ],
      step: (s, p) => [
        Math.sin(p.a * s[1]) + p.c * Math.cos(p.a * s[0]),
        Math.sin(p.b * s[0]) + p.d * Math.cos(p.b * s[1]),
        0,
      ],
    },
    dejong: {
      label: 'de Jong (Ayrık)',
      accuracy: 'exact',
      start: [0.1, 0.1, 0],
      scale: 0.4,
      center: [0, 0, 0],
      discrete: true,
      params: [
        { name: 'a', label: 'a', min: -3, max: 3, step: 0.01, default: 1.641 },
        { name: 'b', label: 'b', min: -3, max: 3, step: 0.01, default: 1.902 },
        { name: 'c', label: 'c', min: -3, max: 3, step: 0.01, default: 0.316 },
        { name: 'd', label: 'd', min: -3, max: 3, step: 0.01, default: 1.525 },
      ],
      step: (s, p) => [
        Math.sin(p.a * s[1]) - Math.cos(p.b * s[0]),
        Math.sin(p.c * s[0]) - Math.cos(p.d * s[1]),
        0,
      ],
    },
  };

  // Gielis süperformülü — hem 2B eğri hem 3B süperşekilde kullanılır
  function superShape(theta, m, n1, n2, n3) {
    const t = (m * theta) / 4;
    const a = Math.pow(Math.abs(Math.cos(t)), n2);
    const b = Math.pow(Math.abs(Math.sin(t)), n3);
    const r = Math.pow(a + b, -1 / n1);
    return isFinite(r) ? Math.min(3, r) : 0;
  }

  /* Çekici yörüngesini korumalı biçimde ilerletir.

     Euler integrasyonu büyük adımda ya da uç parametrelerde sınırlı kalmaz;
     yörünge sonsuza kaçabilir. Böyle bir durumda hesap NaN'a dönüşmeden
     yakalanır ve durum başlangıca alınır — hiçbir ayar birleşimi bozuk
     geometri üretemez.

     opts: { steps, dt, skip, bound, onPoint }
     Dönüş: son durum. onPoint verilirse her nokta için çağrılır. */
  function iterate(def, params, opts) {
    const o = opts || {};
    const steps = Math.max(1, o.steps | 0 || 1000);
    const dt = o.dt == null ? 0.005 : o.dt;
    const skip = o.skip == null ? 500 : o.skip;
    const bound = o.bound == null ? (def.bound || 1e3) : o.bound;
    const start = def.start ? def.start.slice() : [0.1, 0.1, 0.1];
    let s = start.slice();

    const runaway = (q) =>
      !(isFinite(q[0]) && isFinite(q[1]) && isFinite(q[2])) ||
      Math.abs(q[0]) > bound || Math.abs(q[1]) > bound || Math.abs(q[2]) > bound;

    for (let i = 0; i < skip; i++) {
      s = def.step(s, params, dt);
      if (runaway(s)) { s = start.slice(); break; }
    }
    for (let i = 0; i < steps; i++) {
      s = def.step(s, params, dt);
      if (runaway(s)) s = start.slice();
      if (o.onPoint) o.onPoint(s, i);
    }
    return s;
  }

  // Bir formülün varsayılan parametre nesnesi
  function defaults(def) {
    const out = {};
    for (const p of def.params || []) out[p.name] = p.default;
    return out;
  }

  // Kayıtlı tüm formüller tek listede (arayüz için)
  function catalog() {
    const out = [];
    const push = (family, key, def) =>
      out.push({ family, key, label: def.label, accuracy: def.accuracy, params: def.params || [] });
    for (const k in CURVES_2D) push('curve2d', k, CURVES_2D[k]);
    for (const k in CURVES_3D) push('curve3d', k, CURVES_3D[k]);
    for (const k in SURFACES) push('surface', k, SURFACES[k]);
    for (const k in ATTRACTORS) push('attractor', k, ATTRACTORS[k]);
    return out;
  }

  function get(family, key) {
    if (family === 'curve2d') return CURVES_2D[key] || null;
    if (family === 'curve3d') return CURVES_3D[key] || null;
    if (family === 'surface') return SURFACES[key] || null;
    if (family === 'attractor') return ATTRACTORS[key] || null;
    return null;
  }

  const api = { CURVES_2D, CURVES_3D, SURFACES, ATTRACTORS, superShape, defaults, catalog, get, iterate, TAU };

  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (typeof window !== 'undefined') window.SVFormulas = api;
})();
