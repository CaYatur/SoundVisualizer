'use strict';
/* MİLKDROP PRESET ÜRETİCİ (#579).

   Dört eksenden ve bir tohumdan özgün bir .milk preseti yazar: enerji (sese
   tepkinin gücü), sıcaklık (renk ailesi), yoğunluk (öğe sayısı ve ayrıntı)
   ve hareket (hız). Sahne Üretici'nin (admin/scenegen.js) MilkDrop
   karşılığı: çevrimdışı, hesapsız; aynı eksenler ve aynı tohum her zaman
   aynı preseti verir.

   BLOKLAR BU DOSYADA YAZILDI. Hareket, dalga, şekil ve shader kalıpları
   hiçbir preset paketinden alınmadı. Test, üretilen denklem satırlarının
   korpusta birebir geçmediğini de ölçtü (#579).

   KOD. Eksenler ve tohum tek bir kodda taşınıyor: `72-15-40-88-k3x9ab`
   (enerji, sıcaklık, yoğunluk, hareket, tohum). Kod yazılarak aynı preset
   geri getirilebiliyor. Kimlik de koddan geliyor (`md_gen1_<kod>`), yani
   aynı preset iki kez kaydedilince ikinci bir kopya oluşmuyor.

   SÜRÜM. Kalıplardan biri değişirse aynı kod başka bir preset verir. O
   yüzden kimlikte sürüm var ve böyle bir değişiklik VERSION'ı artırmalı:
   eski sürümle kaydedilmiş presetler kendi kaynaklarını saklıyor, yeni
   sürümün çıktısı onların üstüne yazılmıyor. Testlerdeki altın özetler bu
   değişikliği yakalıyor.

   EKSEN OYNATMAK PRESETİ YERİNDE BIRAKIYOR. Her bileşen (palet, hareket,
   her dalga ve şekil, shader, görünüm) kendi rastgele akışından çekiyor ve
   çekiliş sayısı eksenlere bağlı değil. Yoğunluk bir dalga eklediğinde
   paletin ve hareketin çekilişleri kaymıyor; kaydırıcı çoğunlukla aynı
   presetin daha enerjik ya da daha sıcak hâlini veriyor.

   PLATFORM. Yazılan her sayı yalnız dört işlemden, min/max'tan ve
   yuvarlamadan geçiyor (xorshift, doğrusal ara değer, HSL). sin, pow, exp
   gibi işlevler platformlar arasında son basamakta ayrışabilir ve bir
   yuvarlama sınırını çevirebilir; altın özetler Windows'ta ve Ubuntu'da
   aynı çıkmalı. Açılar ve salınımlar presetin kendisinde, çalışma anında
   hesaplanıyor.

   GÜVENLİK. Flaş yok: ters çevirme, solarize, parlatma ve karartma
   bayrakları hep kapalı; sese bağlı hiçbir ifade basamak işlevi (above,
   below, if) kullanmıyor. Renk ve saydamlık ifadeleri her girdi için [0,1]
   içinde kalacak biçimde kuruluyor: MilkDrop 1'i aşan bir renk değerini
   KENETLEMİYOR, SARIYOR (milkdrop.js `colorNorm`). 1,02 yazan bir ifade
   siyaha atlar ve ses dalgalandıkça bu kare kare yanıp söner. Sınırlar
   bu yüzden üretim anında, yazılan sayılardan hesaplanıyor. */
(function () {
  const VERSION = 1;
  const AXES = ['energy', 'warmth', 'density', 'motion'];
  // Tohum en çok altı hane (36^6): kod kısa kalsın
  const SEED_LIMIT = 2176782336;
  /* Sese bağlı q1..q3'ün tavanı. `bass_att` sessizlikte 0, ortalama müzikte
     1 civarı, sert vuruşta 3'ü aşabiliyor; preset `min` ile 2,5'te kesiyor
     ve renk sınırları bu tavana göre hesaplanıyor. */
  const AUDIO_CAP = 2.5;

  // --------------------------------------------------------------------
  // Tohumlu rastgele
  // --------------------------------------------------------------------
  function hashString(s) {
    let h = 2166136261;
    for (let i = 0; i < s.length; i++) {
      h ^= s.charCodeAt(i);
      h = Math.imul(h, 16777619);
    }
    return h >>> 0;
  }

  function rng(seed) {
    let x = (seed >>> 0) || 1;
    const next = () => {
      x ^= x << 13; x >>>= 0;
      x ^= x >>> 17;
      x ^= x << 5; x >>>= 0;
      return x / 4294967296;
    };
    // İlk çıktılar tohuma çok yakın; birkaçını atmak akışı karıştırıyor
    next(); next(); next();
    return next;
  }

  // Bileşenin kendi akışı: ad ve tohumdan
  function stream(seed, name) {
    const h = hashString('mdgen' + VERSION + ':' + name);
    return rng(Math.imul((h ^ seed) >>> 0, 2654435761) >>> 0);
  }

  function tools(r) {
    return {
      r,
      range: (a, b) => a + (b - a) * r(),
      chance: (p) => r() < p,
      int: (a, b) => a + Math.floor(r() * (b - a + 1)),
      pick: (list) => list[Math.floor(r() * list.length)],
      /* Ağırlıklı seçim: [değer, ağırlık] çiftleri, tek çekiliş. Sıfır ya
         da eksi ağırlık o seçeneği kapatıyor. */
      pickW: (pairs) => {
        let total = 0;
        for (const p of pairs) total += p[1] > 0 ? p[1] : 0;
        let x = r() * total;
        let last = pairs[0][0];
        for (const p of pairs) {
          if (!(p[1] > 0)) continue;
          last = p[0];
          x -= p[1];
          if (x < 0) return p[0];
        }
        return last;
      },
    };
  }

  // --------------------------------------------------------------------
  // Sayılar ve ifadeler
  // --------------------------------------------------------------------
  const P10 = [1, 10, 100, 1000, 10000];
  const rnd = (v, d) => Math.round(v * P10[d]) / P10[d];
  const down = (v, d) => Math.floor(v * P10[d]) / P10[d];
  const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);
  const lerp = (a, b, t) => a + (b - a) * t;

  /* Sayı metni YALNIZ toFixed'den: yerel ayar virgülü ve üstel gösterim
     çıkmaz. "-0.000" düzeltiliyor; MilkDrop okur ama göze batar. */
  function num(v, d) {
    const s = (Number.isFinite(v) ? v : 0).toFixed(d == null ? 3 : d);
    return /^-0(\.0*)?$/.test(s) ? s.slice(1) : s;
  }

  // `time*0.300` ya da `-time*0.300`: "time*-0.3" yazılmıyor
  function tm(v, d) {
    const r = rnd(v, d == null ? 3 : d);
    return (r < 0 ? '-' : '') + 'time*' + num(Math.abs(r), d);
  }

  /* "a + b*x - c*y" biçimli ifade. İşaret terimin önüne geçiyor ("+ -"
     yazılmıyor), sıfıra yuvarlanan terim düşüyor. */
  function sum(base, terms, d) {
    const dd = d == null ? 3 : d;
    let s = base == null ? '' : num(rnd(base, dd), dd);
    for (const [c, e] of terms) {
      const v = rnd(c, dd);
      if (v === 0) continue;
      const t = num(Math.abs(v), dd) + '*' + e;
      if (!s) s = (v < 0 ? '-' : '') + t;
      else s += (v < 0 ? ' - ' : ' + ') + t;
    }
    return s || '0';
  }

  /* Düğüm başına ekleme: `zoom = zoom + 0.0123*rad;`. Katsayı sıfıra
     yuvarlanırsa satır kendisini yazıyor, yine geçerli. */
  function grow(name, c, e, d) {
    const dd = d == null ? 3 : d;
    const v = rnd(c, dd);
    if (v === 0) return name + ' = ' + name + ';';
    return name + ' = ' + name + (v < 0 ? ' - ' : ' + ') + num(Math.abs(v), dd) + '*' + e + ';';
  }

  // Açıya zaman terimi: `x + time*0.3` ya da `x - time*0.3`
  function plusTime(expr, v, d) {
    const r = rnd(v, d == null ? 3 : d);
    return expr + (r < 0 ? ' - ' : ' + ') + 'time*' + num(Math.abs(r), d);
  }

  /* İki değer arasında gidip gelen ifade: sin +1'de `b`, -1'de `a`.
     Yazılan orta ve genlikten hesaplanıyor, yani yuvarlamadan sonra da
     [0,1] dışına çıkmıyor. */
  function sway(a, b, arg) {
    const mid = rnd(clamp((a + b) / 2, 0, 1), 3);
    let amp = rnd((b - a) / 2, 3);
    const room = Math.min(mid, 1 - mid);
    if (Math.abs(amp) > room) amp = amp < 0 ? -room : room;
    if (amp === 0) return num(mid);
    return num(mid) + (amp < 0 ? ' - ' : ' + ') + num(Math.abs(amp)) + '*sin(' + arg + ')';
  }

  /* Sesle büyüyen değer: taban + kazanç*q, q en çok AUDIO_CAP. Kazanç
     tavanı aşmayacak kadar kırpılıyor. */
  function withAudio(base, gain, q, cap) {
    const b = rnd(clamp(base, 0, cap), 3);
    const g = down(Math.max(0, Math.min(gain, (cap - b) / AUDIO_CAP)), 3);
    return g > 0 ? num(b) + ' + ' + num(g) + '*' + q : num(b);
  }

  // HSL -> [r,g,b] 0..1; yalnız dört işlem ve min/max
  function hsl(h, s, l) {
    const hh = ((h % 360) + 360) % 360;
    const a = s * Math.min(l, 1 - l);
    const f = (n) => {
      const k = (n + hh / 30) % 12;
      return l - a * Math.max(-1, Math.min(k - 3, 9 - k, 1));
    };
    return [f(0), f(8), f(4)];
  }

  const mix = (c, d, t) => [lerp(c[0], d[0], t), lerp(c[1], d[1], t), lerp(c[2], d[2], t)];

  // --------------------------------------------------------------------
  // Eksenler, tohum ve kod
  // --------------------------------------------------------------------
  function normAxes(o) {
    const out = {};
    for (const k of AXES) {
      const v = Math.round(Number(o && o[k]));
      out[k] = Number.isFinite(v) ? clamp(v, 0, 100) : 50;
    }
    return out;
  }

  function normSeed(s) {
    const v = Math.floor(Number(s));
    return Number.isFinite(v) && v >= 0 ? v % SEED_LIMIT : 0;
  }

  function encode(axes, seed) {
    const a = normAxes(axes);
    return [a.energy, a.warmth, a.density, a.motion].join('-') + '-' + normSeed(seed).toString(36);
  }

  /* Kodu okur. Boşluk ve büyük harf kabul, baştaki sıfırlar atılıyor —
     `050` ile `50` aynı kod, aynı kimlik. Aralık dışı bir eksen kodu
     geçersiz kılıyor: sessizce kırpmak başka bir presete götürürdü. */
  function decode(code) {
    const s = String(code == null ? '' : code).replace(/\s+/g, '').toLowerCase();
    const m = /^(\d{1,3})-(\d{1,3})-(\d{1,3})-(\d{1,3})-([0-9a-z]{1,6})$/.exec(s);
    if (!m) return null;
    const v = [m[1], m[2], m[3], m[4]].map(Number);
    if (v.some((x) => x > 100)) return null;
    return {
      axes: { energy: v[0], warmth: v[1], density: v[2], motion: v[3] },
      seed: parseInt(m[5], 36),
    };
  }

  const idOf = (code) => 'md_gen' + VERSION + '_' + code;

  function randomSeed(rand) {
    const r = typeof rand === 'function' ? rand : Math.random;
    return Math.floor(r() * SEED_LIMIT) % SEED_LIMIT;
  }

  // --------------------------------------------------------------------
  // Palet
  // --------------------------------------------------------------------
  /* Sıcaklık ana tonu seçiyor: 0 buz mavisi (195°), 0,5 mor (290°),
     1 turuncu (385° = 25°). Yeşil ve sarı ana ton olmuyor; bölünmüş ve
     üçlü şemalarda yan ton olarak geliyorlar. Enerji doygunluğu ve şemanın
     cesaretini artırıyor. */
  function makePalette(ax, T) {
    const base = 195 + 190 * ax.warmth + T.range(-12, 12);
    const scheme = T.pickW([
      ['komsu', 1.4 - 0.5 * ax.energy],
      ['bolunmus', 0.5 + 0.6 * ax.energy],
      ['uclu', 0.2 + 0.5 * ax.energy],
    ]);
    const offs = scheme === 'komsu' ? [0, 30, -30] : scheme === 'bolunmus' ? [0, 150, 210] : [0, 120, 240];
    const sat = clamp(0.5 + 0.42 * ax.energy + T.range(-0.08, 0.08), 0.3, 1);
    const cols = [];
    for (let i = 0; i < 3; i++) {
      const jitter = T.range(-10, 10);
      const light = T.range(0.5, 0.64);
      cols.push(hsl(base + offs[i] + (i ? jitter : 0), sat, light));
    }
    const dark = hsl(base + T.range(-20, 20), sat * 0.9, 0.2);
    const pale = hsl(base + offs[1] * 0.5, sat * 0.45, 0.85);
    return { base, scheme, cols, dark, pale };
  }

  // --------------------------------------------------------------------
  // Hareket kalıpları
  // --------------------------------------------------------------------
  /* Her kalıp `frame` (kare denklemleri: temel zoom/rot/merkez) ve `pixel`
     (ağ düğümü başına EKLEMELER) veriyor. İkincil kalıptan yalnız `pixel`
     alınıyor ve `k` ile yarıya iniyor: iki kalıbın kare denklemleri aynı
     değişkenleri yazardı ve ikincisi birincisini silerdi.

     `sp` hız çarpanı (hareket ekseni), `ge` ses kazancı (enerji ekseni).
     Sessizlikte zoom 1'in altına inmiyor: tünel bir anda tersine akmasın. */
  const MOTIONS = {
    tunel(ax, T, sp, ge, k) {
      const z = 1.004 + 0.02 * ax.motion * T.range(0.6, 1);
      const zg = 0.003 + 0.012 * ge * T.range(0.7, 1);
      const r0 = (0.002 + 0.012 * ax.motion) * T.range(0.5, 1) * (T.chance(0.5) ? 1 : -1);
      const f1 = sp * T.range(0.15, 0.4);
      const f2 = sp * T.range(0.1, 0.3);
      const f3 = sp * T.range(0.1, 0.3);
      const c = (0.02 + 0.08 * ax.motion) * T.range(0.5, 1);
      const kp = (0.01 + 0.04 * ax.density) * T.range(0.6, 1) * k;
      return {
        frame: [
          'zoom = ' + sum(Math.max(1, z - zg), [[zg, 'q1']], 4) + ';',
          'rot = ' + sum(null, [[r0, 'sin(' + tm(f1) + ')']], 4) + ';',
          'cx = ' + sum(0.5, [[c, 'sin(' + tm(f2) + ')']]) + ';',
          'cy = ' + sum(0.5, [[c, 'cos(' + tm(f3) + ')']]) + ';',
        ],
        pixel: [grow('zoom', kp, 'rad', 4)],
      };
    },
    girdap(ax, T, sp, ge, k) {
      const s = T.chance(0.5) ? 1 : -1;
      const r0 = s * (0.004 + 0.026 * ax.motion) * T.range(0.6, 1);
      const rg = s * (0.002 + 0.008 * ge) * T.range(0.5, 1);
      const z = 0.998 + 0.012 * T.r();
      const zg = 0.002 + 0.008 * ge * T.range(0.5, 1);
      const kr = s * (0.01 + 0.05 * ax.motion) * T.range(0.5, 1) * k;
      const kz = (0.005 + 0.02 * ax.density) * T.range(0.4, 1) * k;
      return {
        frame: [
          'rot = ' + sum(r0, [[rg, 'q2']], 4) + ';',
          'zoom = ' + sum(Math.max(1, z - zg), [[zg, 'q1']], 4) + ';',
        ],
        pixel: [
          grow('rot', kr, '(1 - rad)', 4),
          grow('zoom', -kz, 'rad', 4),
        ],
      };
    },
    halka(ax, T, sp, ge, k) {
      const z = 1.0 + 0.012 * T.r();
      const zg = 0.002 + 0.01 * ge * T.range(0.5, 1);
      const r = (0.002 + 0.01 * ax.motion) * T.range(0.3, 1) * (T.chance(0.5) ? 1 : -1);
      const f = sp * T.range(0.1, 0.35);
      const a = (0.004 + 0.016 * ge) * T.range(0.6, 1) * k;
      const n = 6 + Math.floor(18 * ax.density * T.range(0.5, 1));
      const v = sp * T.range(0.8, 2.5);
      return {
        frame: [
          'zoom = ' + sum(Math.max(1, z - zg), [[zg, 'q1']], 4) + ';',
          'rot = ' + sum(null, [[r, 'sin(' + tm(f) + ')']], 4) + ';',
        ],
        pixel: [grow('zoom', a, 'sin(rad*' + n + ' - ' + tm(v) + ')', 4)],
      };
    },
    akinti(ax, T, sp, ge, k) {
      const z = 1.0 + 0.006 * T.r();
      const zg = 0.001 + 0.006 * ge * T.range(0.5, 1);
      const d = (0.001 + 0.004 * ax.motion) * T.range(0.4, 1);
      const f1 = sp * T.range(0.08, 0.25);
      const f2 = sp * T.range(0.08, 0.25);
      const a = (0.002 + 0.005 * ax.motion + 0.003 * ax.energy) * T.range(0.6, 1) * k;
      const fy = 3 + Math.floor(12 * ax.density * T.range(0.4, 1));
      const fx = 3 + Math.floor(12 * ax.density * T.range(0.4, 1));
      const v1 = sp * T.range(0.4, 1.4);
      const v2 = sp * T.range(0.4, 1.4);
      return {
        frame: [
          'zoom = ' + sum(Math.max(1, z - zg), [[zg, 'q1']], 4) + ';',
          'dx = ' + sum(null, [[d, 'sin(' + tm(f1) + ')']], 4) + ';',
          'dy = ' + sum(null, [[d, 'cos(' + tm(f2) + ')']], 4) + ';',
        ],
        pixel: [
          grow('dx', a, 'sin(y*' + fy + ' + ' + tm(v1) + ')', 4),
          grow('dy', a, 'cos(x*' + fx + ' - ' + tm(v2) + ')', 4),
        ],
      };
    },
    cicek(ax, T, sp, ge, k) {
      const z = 1.0 + 0.01 * T.r();
      const zg = 0.002 + 0.008 * ge * T.range(0.5, 1);
      const r = (0.002 + 0.01 * ax.motion) * T.range(0.4, 1) * (T.chance(0.5) ? 1 : -1);
      const f = sp * T.range(0.1, 0.3);
      const n = T.pick([3, 4, 5, 6, 8]);
      const a = (0.01 + 0.03 * ge) * T.range(0.5, 1) * k;
      const v = sp * T.range(0.3, 1.2);
      const b = (0.003 + 0.012 * ax.density) * T.range(0.3, 1) * k;
      const v2 = sp * T.range(0.3, 1.0);
      return {
        frame: [
          'zoom = ' + sum(Math.max(1, z - zg), [[zg, 'q1']], 4) + ';',
          'rot = ' + sum(null, [[r, 'sin(' + tm(f) + ')']], 4) + ';',
        ],
        pixel: [
          grow('rot', a, 'sin(ang*' + n + ' + ' + tm(v) + ')', 4),
          grow('zoom', b, 'cos(ang*' + n + ' - ' + tm(v2) + ')', 4),
        ],
      };
    },
    nefes(ax, T, sp, ge, k) {
      const a = (0.004 + 0.012 * ax.motion) * T.range(0.5, 1);
      const v = sp * T.range(0.2, 0.6);
      const zg = 0.002 + 0.01 * ge * T.range(0.5, 1);
      const s = (0.005 + 0.02 * ax.motion) * T.range(0.3, 1);
      const v2 = sp * T.range(0.1, 0.4);
      const v3 = sp * T.range(0.1, 0.4);
      const kz = (0.004 + 0.012 * ax.density) * T.range(0.4, 1) * k;
      const n = 3 + Math.floor(9 * ax.density * T.range(0.4, 1));
      const v4 = sp * T.range(0.4, 1.4);
      return {
        frame: [
          'zoom = ' + sum(1 - zg, [[a, 'sin(' + tm(v) + ')'], [zg, 'q1']], 4) + ';',
          'sx = ' + sum(1, [[s, 'sin(' + tm(v2) + ')']], 4) + ';',
          'sy = ' + sum(1, [[s, 'cos(' + tm(v3) + ')']], 4) + ';',
        ],
        pixel: [grow('zoom', kz, 'rad*sin(rad*' + n + ' + ' + tm(v4) + ')', 4)],
      };
    },
  };

  // Ağırlıklar eksenlerden: hangi kalıbın hangi ruha yakın olduğu
  const MOTION_W = [
    ['tunel', (a) => 0.7 + 0.7 * a.motion],
    ['girdap', (a) => 0.6 + 0.6 * a.energy],
    ['halka', (a) => 0.5 + 0.6 * a.density],
    ['akinti', (a) => 0.6 + 0.6 * (1 - a.energy)],
    ['cicek', (a) => 0.5 + 0.5 * a.density],
    ['nefes', (a) => 0.5 + 0.7 * (1 - a.motion)],
  ];

  function buildMotion(ax, seed, sp, ge) {
    const T = tools(stream(seed, 'motion'));
    const primary = T.pickW(MOTION_W.map(([n, f]) => [n, f(ax)]));
    const wantSecond = T.r() < 0.2 + 0.6 * ax.density;
    const second = T.pickW(MOTION_W.filter(([n]) => n !== primary).map(([n, f]) => [n, f(ax)]));
    const P = MOTIONS[primary](ax, T, sp, ge, 1);
    /* İkincil kalıp KENDİ akışından: birincil değişince ikincilin
       sayıları kaymasın, ve tersi. */
    const S = MOTIONS[second](ax, tools(stream(seed, 'motion2')), sp, ge, 0.5);
    const warp0 = T.range(0, 0.35) + 0.5 * ax.density * T.r();
    const warpG = (0.05 + 0.25 * ax.energy) * T.r();
    return {
      primary,
      second: wantSecond ? second : null,
      frame: P.frame.concat(['warp = ' + sum(warp0, [[warpG, 'q3']]) + ';']),
      pixel: P.pixel.concat(wantSecond ? S.pixel : []),
    };
  }

  // --------------------------------------------------------------------
  // Özel dalgalar
  // --------------------------------------------------------------------
  const WAVE_KINDS = [
    ['halka', (a) => 1.0],
    ['sarmal', (a) => 0.45 + 0.6 * a.motion],
    ['ufuk', (a) => 0.6 + 0.4 * a.energy],
    ['lissajous', (a) => 0.5 + 0.5 * a.density],
    ['yorunge', (a) => 0.35 + 0.6 * a.density],
    ['yildiz', (a) => 0.35 + 0.6 * a.energy],
  ];
  // k. dalganın açık olma olasılığı; yoğunlukla artıyor
  const WAVE_ON = [(d) => 0.35 + 0.6 * d, (d) => 0.1 + 0.55 * d, (d) => -0.1 + 0.6 * d, (d) => -0.35 + 0.7 * d];

  /* Konum `q9`/`q10` ile çarpılıyor: kare denklemleri onları 1/aspecty ve
     1/aspectx yapıyor, halka geniş ekranda da yuvarlak kalıyor. Dalga
     kendi makinesinde aspectx'i göremiyor (MilkDrop 2 onu alt bloklara
     taşımıyor), q değişkenlerini görüyor. */
  function buildWave(k, ax, seed, pal, sp, ge, addScale, force) {
    const T = tools(stream(seed, 'wave' + k));
    // Çekiliş zorlansa da yapılıyor: akışın geri kalanı aynı yerden sürsün
    if (!(T.r() < WAVE_ON[k](ax.density)) && !force) return null;
    const kind = T.pickW(WAVE_KINDS.map(([n, f]) => [n, f(ax)]));
    const cA = pal.cols[k % 3];
    const cB = pal.cols[(k + 1) % 3];
    const sign = T.chance(0.5) ? 1 : -1;
    const v1 = sign * sp * T.range(0.15, 0.6) * (kind === 'ufuk' ? 0.35 : 1);
    const v2 = sp * T.range(0.2, 0.7);
    const vc = sp * T.range(0.2, 0.9);
    const nc = T.int(1, 4);
    const additive = T.chance(0.6);
    const thick = T.chance(0.3 + 0.4 * ax.density);
    const a0 = clamp(0.18 + 0.3 * T.r(), 0.15, 0.5) * (additive ? addScale : 1);
    const ag = (0.03 + 0.15 * ax.energy) * T.r() * (additive ? addScale : 1);
    const scaling = lerp(0.6, 1.8, ax.energy) * T.range(0.8, 1.2);
    const smoothing = T.range(0.3, 0.85);
    const frame = ['t1 = ' + tm(v1) + ';', 't2 = ' + tm(v2) + ';'];
    const pt = [];
    const place = (xe, ye) => {
      pt.push('x = 0.5 + (' + xe + ')*q9;');
      pt.push('y = 0.5 + (' + ye + ')*q10;');
    };
    let samples = 512;
    let dots = false;
    let spectrum = false;
    if (kind === 'halka') {
      const r0 = T.range(0.12, 0.34);
      const rv = T.range(0.04, 0.16) * (0.4 + 0.6 * ge);
      /* Zamanla dalgalanan kenar: düz bir halkayı döndürmek görüntüyü
         değiştirmiyor, sessizlikte preset donmuş görünüyordu. */
      const rw = T.range(0.01, 0.05);
      const nw = T.int(2, 6);
      spectrum = T.chance(0.3);
      pt.push('t3 = sample*6.2832;');
      pt.push('t4 = ' + sum(r0, [[rv, 'value1'], [rw, 'sin(t3*' + nw + ' + t2)']]) + ';');
      place('t4*cos(t3 + t1)', 't4*sin(t3 + t1)');
    } else if (kind === 'sarmal') {
      const turns = T.int(2, 5);
      const R = T.range(0.3, 0.46);
      const kv = T.range(0.1, 0.35);
      pt.push('t3 = sample*' + num(6.2832 * turns, 4) + ';');
      pt.push('t4 = sample*' + num(R) + '*(1 + ' + num(kv) + '*value1);');
      place('t4*cos(t3 + t1)', 't4*sin(t3 + t1)');
    } else if (kind === 'ufuk') {
      const len = T.range(0.6, 1.0);
      const amp = T.range(0.08, 0.22) * (0.5 + 0.6 * ge);
      spectrum = T.chance(0.5);
      samples = T.pick([256, 384, 512]);
      pt.push('t3 = ' + sum(-len / 2, [[len, 'sample']]) + ';');
      pt.push('t4 = ' + num(amp) + '*value1;');
      place('t3*cos(t1) - t4*sin(t1)', 't3*sin(t1) + t4*cos(t1)');
    } else if (kind === 'lissajous') {
      const fa = T.int(1, 4);
      const fb = fa + T.int(1, 3);
      const A = T.range(0.2, 0.38);
      const B = T.range(0.2, 0.38);
      const kv = T.range(0.05, 0.25);
      pt.push('t3 = sample*6.2832;');
      place(num(A) + '*sin(t3*' + fa + ' + t1)*(1 + ' + num(kv) + '*value1)',
        num(B) + '*sin(t3*' + fb + ' + t2)*(1 + ' + num(kv) + '*value2)');
    } else if (kind === 'yorunge') {
      const n = T.int(1, 3);
      const m = T.pick([1, 2, 3]);
      const r0 = T.range(0.15, 0.38);
      const kv = T.range(0.03, 0.12);
      samples = T.int(24, 72);
      dots = true;
      pt.push('t3 = sample*' + num(6.2832 * n, 4) + ';');
      pt.push('t4 = ' + sum(r0, [[kv, 'value1']]) + ';');
      place('t4*cos(t3 + t1)', 't4*sin(t3*' + m + ' + t1)');
    } else {
      const n = T.int(3, 9);
      const r0 = T.range(0.12, 0.3);
      const kd = T.range(0.2, 0.6);
      const ke = T.range(0.03, 0.12) * (0.4 + 0.6 * ge);
      pt.push('t3 = sample*6.2832;');
      pt.push('t4 = ' + num(r0) + '*(1 + ' + num(kd) + '*sin(t3*' + n + ' + t2)) + ' + num(ke) + '*value1;');
      place('t4*cos(t3 + t1)', 't4*sin(t3 + t1)');
    }
    // Renk dalga boyunca iki palet rengi arasında akıyor
    const arg = 'sample*' + num(6.2832 * nc, 4) + ' + ' + tm(vc);
    pt.push('r = ' + sway(cA[0], cB[0], arg) + ';');
    pt.push('g = ' + sway(cA[1], cB[1], arg) + ';');
    pt.push('b = ' + sway(cA[2], cB[2], arg) + ';');
    pt.push('a = ' + withAudio(a0, ag, 'q1', 0.95) + ';');
    return {
      kind,
      additive,
      head: [
        ['enabled', '1'],
        ['samples', String(samples)],
        ['sep', '0'],
        ['bSpectrum', spectrum ? '1' : '0'],
        ['bUseDots', dots ? '1' : '0'],
        ['bDrawThick', thick || dots ? '1' : '0'],
        ['bAdditive', additive ? '1' : '0'],
        ['scaling', num(scaling)],
        ['smoothing', num(smoothing)],
        ['r', num(cA[0])], ['g', num(cA[1])], ['b', num(cA[2])], ['a', num(a0)],
      ],
      frame,
      point: pt,
    };
  }

  // --------------------------------------------------------------------
  // Özel şekiller
  // --------------------------------------------------------------------
  const SHAPE_KINDS = [
    ['cekirdek', (a) => 1.0],
    ['yorungeler', (a) => 0.4 + 0.9 * a.density],
    ['cerceve', (a) => 0.55 + 0.35 * a.motion],
    ['ayna', (a) => 0.3 + 0.5 * a.density],
  ];
  const SHAPE_ON = [(d) => 0.4 + 0.5 * d, (d) => 0.12 + 0.5 * d, (d) => -0.1 + 0.55 * d, (d) => -0.3 + 0.6 * d];

  function buildShape(k, ax, seed, pal, sp, ge, addScale) {
    const T = tools(stream(seed, 'shape' + k));
    if (!(T.r() < SHAPE_ON[k](ax.density))) return null;
    const kind = T.pickW(SHAPE_KINDS.map(([n, f]) => [n, f(ax)]));
    const C = pal.cols[(k + 2) % 3];
    const D = pal.cols[k % 3];
    const sign = T.chance(0.5) ? 1 : -1;
    const w = sign * sp * T.range(0.1, 0.5);
    const vc = sp * T.range(0.15, 0.6);
    const recolor = T.chance(0.6);
    const carg = tm(vc);
    const head = {
      sides: 4, additive: 0, thickOutline: 0, textured: 0, num_inst: 1,
      x: 0.5, y: 0.5, rad: 0.1, ang: 0, tex_ang: 0, tex_zoom: 1,
      r: C[0], g: C[1], b: C[2], a: 0.2,
      r2: D[0], g2: D[1], b2: D[2], a2: 0,
      border_r: pal.pale[0], border_g: pal.pale[1], border_b: pal.pale[2], border_a: 0,
    };
    const fr = [];
    const colorLines = (pre, x, y) => {
      if (!recolor) return;
      fr.push(pre + 'r = ' + sway(x[0], y[0], carg) + ';');
      fr.push(pre + 'g = ' + sway(x[1], y[1], carg) + ';');
      fr.push(pre + 'b = ' + sway(x[2], y[2], carg) + ';');
    };
    if (kind === 'cekirdek') {
      const r0 = T.range(0.05, 0.14);
      const rg = T.range(0.01, 0.05) * (0.3 + ge);
      // Sessizlikte de nefes alsın: yuvarlak bir çekirdeği döndürmek görünmüyor
      const rw = T.range(0.005, 0.03);
      const vr = sp * T.range(0.3, 1.0);
      const a0 = T.range(0.08, 0.25) * addScale;
      const ag = (0.03 + 0.12 * ax.energy) * T.r() * addScale;
      const b0 = T.range(0.05, 0.2);
      const bg = (0.02 + 0.1 * ax.energy) * T.r();
      head.sides = T.pick([3, 4, 5, 6, 8, 32, 48]);
      head.additive = 1;
      head.rad = r0;
      head.a = a0;
      head.border_a = b0;
      // Yarıçap 0,4'ü aşmıyor: taban + salınım + en yüksek seste kazanç
      const rgc = down(Math.max(0, Math.min(rg, (0.4 - rnd(r0, 3) - rnd(rw, 3)) / AUDIO_CAP)), 3);
      fr.push('rad = ' + sum(r0, [[rw, 'sin(' + tm(vr) + ')'], [rgc, 'q1']]) + ';');
      fr.push('ang = ' + tm(w) + ';');
      fr.push('a = ' + withAudio(a0, ag, 'q1', 0.9) + ';');
      fr.push('border_a = ' + withAudio(b0, bg, 'q3', 0.6) + ';');
      colorLines('', C, D);
    } else if (kind === 'yorungeler') {
      const n = T.int(2, 3 + Math.floor(9 * ax.density));
      const R = T.range(0.18, 0.38);
      const r0 = T.range(0.02, 0.07);
      const rg = T.range(0.005, 0.03) * (0.3 + ge);
      const spin = T.range(0.5, 2);
      const additive = T.chance(0.7);
      const a0 = T.range(0.15, 0.4) * (additive ? addScale : 1);
      const ag = (0.02 + 0.1 * ax.energy) * T.r() * (additive ? addScale : 1);
      head.sides = T.pick([3, 4, 5, 6, 24]);
      head.additive = additive ? 1 : 0;
      head.thickOutline = T.chance(0.4) ? 1 : 0;
      head.num_inst = n;
      head.rad = r0;
      head.a = a0;
      head.a2 = a0 * 0.3;
      head.border_a = T.range(0.1, 0.35);
      fr.push('ph = ' + plusTime(num(rnd(6.2832 / n, 4), 4) + '*instance', w) + ';');
      fr.push('x = 0.5 + ' + num(R) + '*cos(ph)*q9;');
      fr.push('y = 0.5 + ' + num(R) + '*sin(ph)*q10;');
      fr.push('rad = ' + withAudio(r0, rg, 'q2', 0.2) + ';');
      fr.push('ang = ph*' + num(spin) + ';');
      fr.push('a = ' + withAudio(a0, ag, 'q2', 0.9) + ';');
      colorLines('', C, D);
    } else if (kind === 'cerceve') {
      const R = T.range(0.25, 0.45);
      const rv = T.range(0.01, 0.05);
      const f = sp * T.range(0.2, 0.8);
      const b0 = T.range(0.1, 0.3);
      const bg = (0.02 + 0.12 * ax.energy) * T.r();
      head.sides = T.int(3, 8);
      head.additive = T.chance(0.5) ? 1 : 0;
      head.thickOutline = 1;
      head.rad = R;
      head.a = 0;
      head.border_r = C[0]; head.border_g = C[1]; head.border_b = C[2];
      head.border_a = b0;
      fr.push('rad = ' + sum(R, [[rv, 'sin(' + tm(f) + ')']]) + ';');
      fr.push('ang = ' + tm(w) + ';');
      fr.push('border_a = ' + withAudio(b0, bg, 'q2', 0.7) + ';');
      colorLines('border_', C, D);
    } else {
      /* Dokulu şekil bir önceki kareyi kendi içine, döndürülmüş ve
         ölçeklenmiş olarak çiziyor; geri beslemeyle iç içe desenler
         doğuyor. Saydam ve toplamasız: parlaklığı kareden kareye
         katlanmıyor. */
      const R = T.range(0.28, 0.5);
      const a0 = T.range(0.25, 0.55);
      const tz = T.range(0.75, 1.3);
      const tzv = T.range(0.02, 0.12);
      const f = sp * T.range(0.1, 0.4);
      const w2 = sp * T.range(0.05, 0.3) * (T.chance(0.5) ? 1 : -1);
      const tint = mix(pal.pale, [1, 1, 1], T.range(0.3, 0.8));
      head.sides = T.pick([4, 5, 6, 8, 40]);
      head.textured = 1;
      head.rad = R;
      head.r = tint[0]; head.g = tint[1]; head.b = tint[2]; head.a = a0;
      head.r2 = tint[0]; head.g2 = tint[1]; head.b2 = tint[2]; head.a2 = a0 * T.range(0.3, 1);
      head.tex_zoom = tz;
      fr.push('ang = ' + tm(w * 0.5) + ';');
      fr.push('tex_ang = ' + tm(w2) + ';');
      fr.push('tex_zoom = ' + sum(tz, [[tzv, 'sin(' + tm(f) + ')']]) + ';');
    }
    return { kind, additive: head.additive === 1, head, frame: fr };
  }

  // --------------------------------------------------------------------
  // Shader'lar (MilkDrop 2)
  // --------------------------------------------------------------------
  /* Warp shader'ı olan presette MilkDrop `decay`i KENDİSİ uygulamıyor;
     söndürmek shader'ın işi. `q8` kare denklemlerinde saniyelik sönmeyi
     kare hızından bağımsız kılıyor: 30 fps'te `decay`in kendisi, 60'ta
     karekökü. */
  const COMP_KINDS = [
    ['parilti', (a) => 1.0],
    ['ton', (a) => 0.7 + 0.4 * a.energy],
    ['ayna', (a) => 0.4 + 0.4 * a.density],
    ['kabartma', (a) => 0.4 + 0.3 * (1 - a.density)],
  ];
  const WARP_KINDS = [
    ['duman', (a) => 1.0],
    ['turbulans', (a) => 0.6 + 0.6 * a.motion],
  ];

  function buildShaders(ax, T, sp) {
    const style = T.pickW([
      ['yok', 1.0],
      ['comp', 1.1],
      ['warp', 0.3 + 0.3 * ax.density],
      ['ikisi', 0.4 + 0.6 * ax.density],
    ]);
    const compKind = T.pickW(COMP_KINDS.map(([n, f]) => [n, f(ax)]));
    const warpKind = T.pickW(WARP_KINDS.map(([n, f]) => [n, f(ax)]));
    // Sayılar koşulsuz çekiliyor: seçim değişince diğerleri kaymasın
    const gain = T.range(1.05, 1.5);
    const k1 = T.range(0.9, 1.2);
    const k2 = T.range(0.3, 0.8);
    const vig = T.range(0.3, 1.2);
    const tone = T.range(0.3, 0.8);
    const fourWay = T.chance(0.4);
    /* Kenar vurgusu hareketli ince çizgiyi de güçlendiriyor: hızlı bir
       Lissajous'un geçtiği ekran parçası saniyede üç kez aydınlanıp
       kararıyordu (ölçüm: 200 presetin en kötüsü). Vurgu ve kazanç düşük. */
    const edge = T.range(0.4, 1.0);
    const blurMix = T.range(0.05, 0.3);
    /* Warp shader'ının sabit çıkarması: 8 bitlik tamponda çarpımsal sönme
       küçük değerleri sıfıra indiremiyor (3/255 * 0,97 yine 3/255'e
       yuvarlanıyor), yarım adımdan büyük bir çıkarma iz bırakmıyor. Daha
       büyüğü soluk öğeleri yiyordu (ölçüm: 0,0028'de ekranın %3'ü). */
    const sub = T.range(0.0012, 0.002);
    const ns = T.range(0.3, 1.2);
    const nv = sp * T.range(0.01, 0.04);
    const na = T.range(0.002, 0.008);

    let comp = null;
    if (style === 'comp' || style === 'ikisi') {
      if (compKind === 'parilti') {
        comp = [
          'float3 c = tex2D(sampler_main, uv).xyz;',
          'float3 g = GetBlur1(uv);',
          'ret = c*' + num(k1) + ' + g*' + num(k2) + ';',
          'ret *= 1 - ' + num(vig) + '*dot(uv - 0.5, uv - 0.5);',
        ];
      } else if (compKind === 'ton') {
        comp = [
          'float3 c = tex2D(sampler_main, uv).xyz;',
          'ret = lerp(c, c.yzx, q4*' + num(tone) + ')*' + num(gain) + ';',
        ];
      } else if (compKind === 'ayna') {
        comp = [
          'float2 m = uv;',
          'm.x = 0.5 - abs(m.x - 0.5);',
        ].concat(fourWay ? ['m.y = 0.5 - abs(m.y - 0.5);'] : []).concat([
          'ret = tex2D(sampler_main, m).xyz*' + num(k1) + ' + GetBlur1(m)*' + num(k2 * 0.6) + ';',
        ]);
      } else {
        comp = [
          'float3 c = tex2D(sampler_main, uv).xyz;',
          'float3 b = GetBlur1(uv);',
          'ret = (c + (c - b)*' + num(edge) + ')*' + num(Math.min(gain, 1.25)) + ';',
        ];
      }
    }
    let warp = null;
    if (style === 'warp' || style === 'ikisi') {
      if (warpKind === 'duman') {
        warp = [
          'float3 c = tex2D(sampler_main, uv).xyz;',
          'float3 b = GetBlur1(uv);',
          'ret = lerp(c, b, ' + num(blurMix) + ')*q8 - ' + num(sub, 4) + ';',
        ];
      } else {
        warp = [
          'float2 n = tex2D(sampler_noise_lq, uv*' + num(ns) + ' + time*' + num(nv, 4) + ').xy - 0.5;',
          'ret = tex2D(sampler_main, uv + n*' + num(na, 4) + ').xyz*q8 - ' + num(sub, 4) + ';',
        ];
      }
    }
    return {
      style,
      comp,
      warp,
      compKind: comp ? compKind : null,
      warpKind: warp ? warpKind : null,
    };
  }

  // --------------------------------------------------------------------
  // Ad
  // --------------------------------------------------------------------
  /* Ad yalnız arayüz dilinde üretiliyor ve KAYNAĞA girmiyor: aynı kod iki
     dilde aynı .milk'i veriyor. Presetin adı onun kendi adı; İngilizce
     arayüzde üretilen preset İngilizce adla kaydediliyor.

     Sözcük çiftlerinden hiçbiri sözlükte anahtar ya da bir yerleşik
     presetin adı olmamalı: çeviri adı " · "den bölüp ilk parçayı çeviriyor.
     "Dingin Halkalar" yerleşik bir presetin adıydı ve İngilizce arayüzde
     "Still Rings" okunuyordu; halka sözcükleri bu yüzden "Çemberler" ve
     "Circles". Test bütün çiftleri sözlüğe karşı sınıyor. */
  const NAME_WORDS = {
    tr: {
      tone: [['Buzlu', 'Soğuk', 'Kristal'], ['Lacivert', 'Derin', 'Gece Mavisi'], ['Mor', 'Leylak', 'Eflatun'],
        ['Pembe', 'Mercan', 'Fuşya'], ['Kızıl', 'Kehribar', 'Altın']],
      mood: [['Dingin', 'Sakin', 'Uykulu'], ['Akışkan', 'Salınan', 'Gezgin'], ['Coşkun', 'Çılgın', 'Fırtınalı']],
      noun: {
        tunel: ['Tünel', 'Geçit'], girdap: ['Girdap', 'Anafor'], halka: ['Çemberler', 'Yankı'],
        akinti: ['Akıntı', 'Rüzgâr'], cicek: ['Çiçek', 'Taç'], nefes: ['Nefes', 'Nabız'],
      },
    },
    en: {
      tone: [['Icy', 'Cold', 'Crystal'], ['Navy', 'Deep', 'Midnight'], ['Violet', 'Lilac', 'Mauve'],
        ['Rose', 'Coral', 'Fuchsia'], ['Crimson', 'Amber', 'Golden']],
      mood: [['Still', 'Calm', 'Drowsy'], ['Fluid', 'Swaying', 'Wandering'], ['Restless', 'Wild', 'Stormy']],
      noun: {
        tunel: ['Tunnel', 'Passage'], girdap: ['Vortex', 'Whirl'], halka: ['Circles', 'Echo'],
        akinti: ['Current', 'Drift'], cicek: ['Bloom', 'Crown'], nefes: ['Breath', 'Pulse'],
      },
    },
  };

  function makeName(axes, seed, motion, lang) {
    const W = NAME_WORDS[lang === 'en' ? 'en' : 'tr'];
    const T = tools(stream(seed, 'name'));
    const useTone = T.chance(0.5);
    const ti = T.int(0, 2);
    const mi = T.int(0, 2);
    const ni = T.int(0, 1);
    const tb = axes.warmth <= 19 ? 0 : axes.warmth <= 39 ? 1 : axes.warmth <= 59 ? 2 : axes.warmth <= 79 ? 3 : 4;
    const mb = axes.energy <= 33 ? 0 : axes.energy <= 66 ? 1 : 2;
    const adj = useTone ? W.tone[tb][ti] : W.mood[mb][mi];
    return adj + ' ' + W.noun[motion][ni] + ' · ' + normSeed(seed).toString(36);
  }

  // --------------------------------------------------------------------
  // Preset
  // --------------------------------------------------------------------
  /* Ana dalganın kipi. 1, 2, 3 ve 5 sol/sağ kanalı birbirine karşı
     çiziyor: sessizlikte tek bir noktaya, müzikte küçük bir kümeye
     iniyorlar. Ağırlıkları yoğunlukla açılıyor ve en az iki öğe yoksa
     kapalı (ölçüm: tek bir çekirdekle kalan preset müzikte ekranın %4'ünü
     aydınlatıyordu). 0, 4, 6 ve 7 sessizlikte de bir çember ya da ekranı
     geçen bir çizgi bırakıyor. */
  const MAIN_MODES = [
    [0, () => 1.0], [1, (a, n) => (n >= 2 ? 0.6 * a.density : 0)], [2, (a, n) => (n >= 2 ? 0.6 * a.density : 0)],
    [3, (a, n) => (n >= 2 ? 0.5 * a.density : 0)], [4, () => 0.5],
    [5, (a, n) => (n >= 2 ? (0.25 + 0.5 * a.energy) * a.density : 0)], [6, () => 0.5], [7, () => 0.45],
  ];

  /* Üretir. `opts`: { energy, warmth, density, motion } (0..100 tamsayı,
     `axes` altında da verilebilir), `seed` ve `lang` ('tr' | 'en'; yalnız
     adı etkiliyor). Dönüş: kimlik, kod, ad, kaynak ve arayüzün
     gösterebileceği özet (`parts`). */
  function generate(opts) {
    const o = opts || {};
    const axes = normAxes(o.axes || o);
    const seed = normSeed(o.seed);
    const code = encode(axes, seed);
    const ax = {
      energy: axes.energy / 100,
      warmth: axes.warmth / 100,
      density: axes.density / 100,
      motion: axes.motion / 100,
    };
    const sp = lerp(0.25, 1.6, ax.motion);
    const ge = lerp(0.15, 1.2, ax.energy);

    const pal = makePalette(ax, tools(stream(seed, 'palette')));
    const motion = buildMotion(ax, seed, sp, ge);

    /* Toplamalı öğelerin saydamlığı öğe sayısıyla azalıyor: yoğun bir
       presette dört toplamalı dalga ve şekil üst üste binip beyaza
       doymasın. Sayım, öğelerin "açık mı" çekilişinden; o çekiliş her
       akışın ilki olduğu için burada yeniden yapılabiliyor. */
    let count = 0;
    for (let k = 0; k < 4; k++) {
      if (stream(seed, 'wave' + k)() < WAVE_ON[k](ax.density)) count++;
      if (stream(seed, 'shape' + k)() < SHAPE_ON[k](ax.density)) count++;
    }
    /* Hiç öğe çıkmadıysa ilk dalga yine de açılıyor. Yalnız ana dalgayla
       kalan seyrek presetler ölçümde siyaha yakın çıktı: ana dalga ince
       bir çizgi, bazı kiplerde sessizlikte tek bir nokta. Seyrek, boş
       demek değil. */
    const forceWave = count === 0;
    if (forceWave) count = 1;
    const addScale = 1 / (1 + 0.18 * count);
    const waves = [];
    const shapes = [];
    for (let k = 0; k < 4; k++) {
      const w = buildWave(k, ax, seed, pal, sp, ge, addScale, forceWave && k === 0);
      if (w) waves.push([k, w]);
      const s = buildShape(k, ax, seed, pal, sp, ge, addScale);
      if (s) shapes.push([k, s]);
    }
    const sh = buildShaders(ax, tools(stream(seed, 'shader')), sp);

    // Görünüm: sönme, gama, yankı, kenarlar, vektörler, ana dalga
    const L = tools(stream(seed, 'look'));
    /* Üst sınır 0,98: 0,99'da aynı yere her kare çizilen kalın, toplamalı
       bir çizgi sessizlikte bile birikip akışla bütün ekrana yayılıyordu
       (ölçüm: ekranın %61'i beyaz). */
    const decay = clamp(0.972 - 0.035 * ax.density + 0.01 * ax.motion + L.range(-0.006, 0.006), 0.925, 0.98);
    /* Seyrek presette gama daha yüksek (az öğe, daha parlak), ama 1,9'a
       kadar çıkınca tünel gibi biriken hareketlerde yüksek seste beyaza
       doyuyordu (ölçüm: 200 presetin birinde ekranın %37'si). */
    const gamma = clamp(lerp(1.7, 1.25, ax.density) + L.range(-0.1, 0.1), 1.1, 1.8);
    const echoOn = L.chance(0.45);
    const echoA = L.range(0.15, 0.4);
    const echoZ = L.range(0.985, 1.035);
    const echoO = L.int(0, 3);
    /* Ortayı karartmak ortada biriken parlaklığı kesiyor, ama seyrek bir
       presette her şey zaten ortada: orada tek öğeyi de siliyordu (ölçüm:
       yoğunluk 0'da siyah kalan preset). */
    const darkCenter = L.chance(motion.primary === 'tunel' ? 0.5 : 0.2) && ax.density >= 0.4;
    const texWrap = L.chance(0.8);
    const warpSpeed = lerp(0.4, 2.0, ax.motion) * L.range(0.8, 1.2);
    const warpScale = lerp(0.7, 2.4, ax.density) * L.range(0.8, 1.2);
    const zexpOn = L.chance(0.25);
    const zexp = L.range(0.8, 1.35);
    const hueOn = L.chance(0.3);
    const hue = L.range(0.2, 0.7);
    const obOn = L.chance(0.4);
    const ob = [L.range(0.004, 0.02), L.range(0.1, 0.4)];
    const ibOn = L.chance(0.35);
    const ib = [L.range(0.004, 0.02), L.range(0.05, 0.2)];
    const mvOn = L.chance(0.1 + 0.2 * ax.density);
    const mvX = L.int(12, 40);
    const mvL = L.range(0.5, 2);
    const mvA = L.range(0.05, 0.18);

    const V = tools(stream(seed, 'mainwave'));
    const mode = V.pickW(MAIN_MODES.map(([n, f]) => [n, f(ax, count)]));
    const wAdd = V.chance(0.55);
    /* Seyrek presette ana dalga çoğunlukla kalın: çoğu zaman ekrandaki tek
       çizgi o. Noktalı dalga yalnız başka öğeler varken — tek başına
       noktalar küçültülünce kayboluyor (ölçüm: her seste siyah çıkan
       preset). */
    const wThick = V.chance(0.8 - 0.45 * ax.density);
    const wDots = V.chance(0.08) && count >= 2;
    const wMax = V.chance(0.2);
    /* Ana dalga her kare çiziliyor ve sönme ne kadar yavaşsa o kadar
       birikiyor: saydamlık (1 - sönme) ile ölçekleniyor, 0,97'de tam. */
    const wA = clamp(0.35 + 0.45 * ax.energy + V.range(-0.05, 0.05), 0.3, 0.9) *
      (wAdd ? Math.max(0.6, addScale) : 1) * clamp((1 - decay) / 0.03, 0.5, 1);
    const wScale = lerp(0.6, 1.6, ax.energy) * V.range(0.85, 1.15);
    const wSmooth = V.range(0.45, 0.85);
    const wParam = V.range(-0.4, 0.4);
    const wv = sp * V.range(0.1, 0.4);

    const cW = pal.cols[0];
    const cW2 = pal.cols[1];
    const warpShader = !!sh.warp;
    const lines = [];
    const put = (k, v) => lines.push(k + '=' + v);
    if (sh.warp || sh.comp) {
      put('MILKDROP_PRESET_VERSION', '201');
      put('PSVERSION', '2');
      put('PSVERSION_WARP', sh.warp ? '2' : '0');
      put('PSVERSION_COMP', sh.comp ? '2' : '0');
    }
    lines.push('[preset00]');
    put('fRating', '3.000');
    put('fGammaAdj', num(gamma));
    put('fDecay', num(decay));
    put('fVideoEchoZoom', num(echoOn ? echoZ : 1));
    put('fVideoEchoAlpha', num(echoOn ? echoA : 0));
    put('nVideoEchoOrientation', String(echoO));
    put('nWaveMode', String(mode));
    put('bAdditiveWaves', wAdd ? '1' : '0');
    put('bWaveDots', wDots ? '1' : '0');
    put('bWaveThick', wThick ? '1' : '0');
    put('bModWaveAlphaByVolume', '0');
    put('bMaximizeWaveColor', wMax ? '1' : '0');
    put('bTexWrap', texWrap ? '1' : '0');
    put('bDarkenCenter', darkCenter ? '1' : '0');
    // Flaşa götürebilecek dört bayrak hep kapalı
    put('bBrighten', '0');
    put('bDarken', '0');
    put('bSolarize', '0');
    put('bInvert', '0');
    put('fModWaveAlphaStart', '0.750');
    put('fModWaveAlphaEnd', '0.950');
    put('fWarpAnimSpeed', num(warpSpeed));
    put('fWarpScale', num(warpScale));
    put('fZoomExponent', num(zexpOn ? zexp : 1));
    put('fShader', num(hueOn ? hue : 0));
    put('zoom', '1.000');
    put('rot', '0.000');
    put('cx', '0.500');
    put('cy', '0.500');
    put('dx', '0.000');
    put('dy', '0.000');
    put('warp', '0.300');
    put('sx', '1.000');
    put('sy', '1.000');
    put('wave_r', num(cW[0]));
    put('wave_g', num(cW[1]));
    put('wave_b', num(cW[2]));
    put('wave_a', num(wA));
    put('wave_x', '0.500');
    put('wave_y', '0.500');
    put('fWaveScale', num(wScale));
    put('fWaveSmoothing', num(wSmooth));
    put('fWaveParam', num(wParam));
    put('ob_size', num(ob[0]));
    put('ob_r', num(pal.dark[0]));
    put('ob_g', num(pal.dark[1]));
    put('ob_b', num(pal.dark[2]));
    put('ob_a', num(obOn ? ob[1] : 0));
    put('ib_size', num(ib[0]));
    put('ib_r', num(pal.cols[2][0]));
    put('ib_g', num(pal.cols[2][1]));
    put('ib_b', num(pal.cols[2][2]));
    put('ib_a', num(ibOn ? ib[1] : 0));
    put('nMotionVectorsX', num(mvOn ? mvX : 0));
    put('nMotionVectorsY', num(mvOn ? Math.round(mvX * 0.75) : 0));
    put('mv_dx', '0.000');
    put('mv_dy', '0.000');
    put('mv_l', num(mvL));
    put('mv_r', num(pal.cols[1][0]));
    put('mv_g', num(pal.cols[1][1]));
    put('mv_b', num(pal.cols[1][2]));
    put('mv_a', num(mvOn ? mvA : 0));

    const frame = [
      'q1 = min(bass_att, ' + num(AUDIO_CAP, 1) + ');',
      'q2 = min(mid_att, ' + num(AUDIO_CAP, 1) + ');',
      'q3 = min(treb_att, ' + num(AUDIO_CAP, 1) + ');',
      'q4 = 0.5 + 0.5*sin(' + tm(sp * 0.07) + ');',
      'q9 = 1/aspecty;',
      'q10 = 1/aspectx;',
    ];
    if (warpShader) frame.push('q8 = pow(' + num(decay) + ', 30/max(fps, 15));');
    for (const l of motion.frame) frame.push(l);
    const carg = tm(wv);
    frame.push('wave_r = ' + sway(cW[0], cW2[0], carg) + ';');
    frame.push('wave_g = ' + sway(cW[1], cW2[1], carg) + ';');
    frame.push('wave_b = ' + sway(cW[2], cW2[2], carg) + ';');
    frame.forEach((l, i) => put('per_frame_' + (i + 1), l));
    motion.pixel.forEach((l, i) => put('per_pixel_' + (i + 1), l));

    for (const [k, w] of waves) {
      for (const [key, v] of w.head) put('wavecode_' + k + '_' + key, v);
      w.frame.forEach((l, i) => put('wave_' + k + '_per_frame' + (i + 1), l));
      w.point.forEach((l, i) => put('wave_' + k + '_per_point' + (i + 1), l));
    }
    const SHAPE_HEAD = ['sides', 'additive', 'thickOutline', 'textured', 'num_inst', 'x', 'y', 'rad', 'ang',
      'tex_ang', 'tex_zoom', 'r', 'g', 'b', 'a', 'r2', 'g2', 'b2', 'a2', 'border_r', 'border_g', 'border_b', 'border_a'];
    const INT_HEAD = ['sides', 'additive', 'thickOutline', 'textured', 'num_inst'];
    for (const [k, s] of shapes) {
      put('shapecode_' + k + '_enabled', '1');
      for (const key of SHAPE_HEAD) {
        const v = s.head[key];
        put('shapecode_' + k + '_' + key, INT_HEAD.indexOf(key) >= 0 ? String(v) : num(v));
      }
      s.frame.forEach((l, i) => put('shape_' + k + '_per_frame' + (i + 1), l));
    }
    /* Shader satırları MilkDrop 2'nin biçiminde: her satırın başında ters
       tırnak, gövde `shader_body { ... }`. */
    const shaderLines = (prefix, body) => {
      const out = ['shader_body', '{'].concat(body.map((l) => '    ' + l)).concat(['}']);
      out.forEach((l, i) => put(prefix + (i + 1), '`' + l));
    };
    if (sh.warp) shaderLines('warp_', sh.warp);
    if (sh.comp) shaderLines('comp_', sh.comp);

    const name = makeName(axes, seed, motion.primary, o.lang);
    return {
      id: idOf(code),
      code,
      name,
      source: lines.join('\n') + '\n',
      axes,
      seed,
      parts: {
        motion: motion.primary,
        motion2: motion.second,
        waves: waves.map(([, w]) => w.kind),
        shapes: shapes.map(([, s]) => s.kind),
        shader: sh.style,
        comp: sh.compKind,
        warp: sh.warpKind,
        palette: pal.scheme,
      },
    };
  }

  const api = {
    VERSION, AXES, SEED_LIMIT, AUDIO_CAP,
    generate, encode, decode, idOf, randomSeed, normAxes,
    /* Sınır yardımcıları testler için: bugünkü aralıklarda sınırları hiç
       zorlanmıyor, yani üretilen presetlerden sınanamıyorlar. Aralık
       genişletilince devreye girecekler ve o zaman da tutmaları gerek. */
    _test: { num, sway, withAudio, NAME_WORDS },
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (typeof window !== 'undefined') window.SVMdGen = api;
})();
