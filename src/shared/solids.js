'use strict';
/* Katı geometri ailesi — düzgün çokyüzlüler, jeodezik küre, L-sistemler ve
   yinelemeli fonksiyon sistemleri.

   Parametrik yüzeyler f(u,v) sözleşmesiyle çalışıyor; buradaki şekiller ise
   öyle yazılamaz: bir dodekahedronun ya da bir L-sistem ağacının kapalı bir
   parametrik formu yok. Bu yüzden ayrı bir aile: her tanım doğrudan bir AĞ
   üretir (köşeler, normaller, üçgenler ve/veya çizgiler).

   Ağ bir kez kurulup GPU'da kalır; sese bağlı bozulma vertex shader'da
   yapılır, tıpkı parametrik yüzeylerde olduğu gibi. Yani buradaki maliyet
   yalnızca şekil ya da parametre değiştiğinde ödenir. */
(function () {
  const TAU = Math.PI * 2;
  const PHI = (1 + Math.sqrt(5)) / 2;

  const p = (name, label, min, max, step, def) => ({ name, label, min, max, step, default: def });

  // ==========================================================================
  // Ağ yardımcıları
  // ==========================================================================
  /* Köşe listesi + yüz listesinden ağ kurar.

     Yüzler üçgene bölünür ve HER ÜÇGEN KENDİ KÖŞELERİNİ alır: düz yüzlü bir
     katıda köşe paylaşmak, normalleri ortalayıp yüzeyi yuvarlak gösterirdi.
     Çokyüzlülerin keskin kenarları bu ayrımdan geliyor. */
  function fromFaces(verts, faces, scale) {
    const pos = [];
    const nor = [];
    const uvs = [];
    const tri = [];
    const lineSet = new Set();
    const line = [];
    const s = scale || 1;

    for (const face of faces) {
      // Çokgeni yelpaze biçiminde üçgenle
      for (let k = 1; k < face.length - 1; k++) {
        const idx = [face[0], face[k], face[k + 1]];
        const a = verts[idx[0]];
        const b = verts[idx[1]];
        const c = verts[idx[2]];
        // Yüz normali
        const ux = b[0] - a[0], uy = b[1] - a[1], uz = b[2] - a[2];
        const vx = c[0] - a[0], vy = c[1] - a[1], vz = c[2] - a[2];
        let nx = uy * vz - uz * vy;
        let ny = uz * vx - ux * vz;
        let nz = ux * vy - uy * vx;
        const nl = Math.hypot(nx, ny, nz) || 1;
        nx /= nl; ny /= nl; nz /= nl;
        const base = pos.length / 3;
        for (const v of [a, b, c]) {
          pos.push(v[0] * s, v[1] * s, v[2] * s);
          nor.push(nx, ny, nz);
          uvs.push((v[0] * s + 1) * 0.5, (v[1] * s + 1) * 0.5);
        }
        tri.push(base, base + 1, base + 2);
      }
      // Tel kafes için kenarlar (her kenar bir kez)
      for (let k = 0; k < face.length; k++) {
        const a = face[k];
        const b = face[(k + 1) % face.length];
        const key = Math.min(a, b) + ':' + Math.max(a, b);
        if (lineSet.has(key)) continue;
        lineSet.add(key);
        line.push(a, b);
      }
    }
    // Tel kafes indeksleri ORİJİNAL köşe listesine bakar; ayrı bir konum
    // dizisi gerekiyor
    const linePos = [];
    const lineNor = [];
    const lineUv = [];
    for (const v of verts) {
      const l = Math.hypot(v[0], v[1], v[2]) || 1;
      linePos.push(v[0] * s, v[1] * s, v[2] * s);
      lineNor.push(v[0] / l, v[1] / l, v[2] / l);
      lineUv.push((v[0] * s + 1) * 0.5, (v[1] * s + 1) * 0.5);
    }
    return {
      pos: new Float32Array(pos),
      nor: new Float32Array(nor),
      uvs: new Float32Array(uvs),
      tri: new Uint32Array(tri),
      count: pos.length / 3,
      // Tel kafes ayrı bir ağ olarak verilir
      wire: {
        pos: new Float32Array(linePos),
        nor: new Float32Array(lineNor),
        uvs: new Float32Array(lineUv),
        line: new Uint32Array(line),
        count: verts.length,
      },
    };
  }

  const norm = (v) => {
    const l = Math.hypot(v[0], v[1], v[2]) || 1;
    return [v[0] / l, v[1] / l, v[2] / l];
  };

  // ==========================================================================
  // Düzgün çokyüzlüler
  // ==========================================================================
  const PLATONIC = {
    tetrahedron: {
      verts: [[1, 1, 1], [-1, -1, 1], [-1, 1, -1], [1, -1, -1]],
      faces: [[0, 1, 2], [0, 3, 1], [0, 2, 3], [1, 3, 2]],
    },
    cube: {
      verts: [
        [-1, -1, -1], [1, -1, -1], [1, 1, -1], [-1, 1, -1],
        [-1, -1, 1], [1, -1, 1], [1, 1, 1], [-1, 1, 1],
      ],
      faces: [[0, 3, 2, 1], [4, 5, 6, 7], [0, 1, 5, 4], [2, 3, 7, 6], [0, 4, 7, 3], [1, 2, 6, 5]],
    },
    octahedron: {
      verts: [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]],
      faces: [[0, 2, 4], [2, 1, 4], [1, 3, 4], [3, 0, 4], [2, 0, 5], [1, 2, 5], [3, 1, 5], [0, 3, 5]],
    },
    dodecahedron: (() => {
      const a = 1 / PHI;
      const b = PHI;
      const v = [
        [1, 1, 1], [1, 1, -1], [1, -1, 1], [1, -1, -1],
        [-1, 1, 1], [-1, 1, -1], [-1, -1, 1], [-1, -1, -1],
        [0, a, b], [0, a, -b], [0, -a, b], [0, -a, -b],
        [a, b, 0], [a, -b, 0], [-a, b, 0], [-a, -b, 0],
        [b, 0, a], [b, 0, -a], [-b, 0, a], [-b, 0, -a],
      ];
      const f = [
        [0, 8, 10, 2, 16], [0, 16, 17, 1, 12], [0, 12, 14, 4, 8],
        [1, 17, 3, 11, 9], [1, 9, 5, 14, 12], [2, 10, 6, 15, 13],
        [2, 13, 3, 17, 16], [3, 13, 15, 7, 11], [4, 14, 5, 19, 18],
        [4, 18, 6, 10, 8], [5, 9, 11, 7, 19], [6, 18, 19, 7, 15],
      ];
      return { verts: v, faces: f };
    })(),
    icosahedron: (() => {
      const t = PHI;
      const v = [
        [-1, t, 0], [1, t, 0], [-1, -t, 0], [1, -t, 0],
        [0, -1, t], [0, 1, t], [0, -1, -t], [0, 1, -t],
        [t, 0, -1], [t, 0, 1], [-t, 0, -1], [-t, 0, 1],
      ];
      const f = [
        [0, 11, 5], [0, 5, 1], [0, 1, 7], [0, 7, 10], [0, 10, 11],
        [1, 5, 9], [5, 11, 4], [11, 10, 2], [10, 7, 6], [7, 1, 8],
        [3, 9, 4], [3, 4, 2], [3, 2, 6], [3, 6, 8], [3, 8, 9],
        [4, 9, 5], [2, 4, 11], [6, 2, 10], [8, 6, 7], [9, 8, 1],
      ];
      return { verts: v, faces: f };
    })(),
  };

  function platonic(kind, scale) {
    const def = PLATONIC[kind] || PLATONIC.cube;
    const s = scale / Math.hypot(def.verts[0][0], def.verts[0][1], def.verts[0][2]);
    return fromFaces(def.verts, def.faces, s);
  }

  /* Jeodezik küre.

     UV küresi yerine ikosahedron alt bölünmesi kullanılıyor: UV küresinde
     kutuplarda üçgenler sıkışır ve sese bağlı bozulma orada bariz biçimde
     bozuk görünür. Jeodezikte köşe dağılımı her yerde neredeyse eşit. */
  function geodesic(subdiv, scale) {
    const base = PLATONIC.icosahedron;
    let verts = base.verts.map(norm);
    let faces = base.faces.map((f) => f.slice());
    const n = Math.max(0, Math.min(4, subdiv | 0));
    for (let it = 0; it < n; it++) {
      const mid = new Map();
      const nf = [];
      const midpoint = (a, b) => {
        const key = Math.min(a, b) + ':' + Math.max(a, b);
        if (mid.has(key)) return mid.get(key);
        const va = verts[a];
        const vb = verts[b];
        const m = norm([(va[0] + vb[0]) / 2, (va[1] + vb[1]) / 2, (va[2] + vb[2]) / 2]);
        verts.push(m);
        const idx = verts.length - 1;
        mid.set(key, idx);
        return idx;
      };
      for (const f of faces) {
        const [a, b, c] = f;
        const ab = midpoint(a, b);
        const bc = midpoint(b, c);
        const ca = midpoint(c, a);
        nf.push([a, ab, ca], [b, bc, ab], [c, ca, bc], [ab, bc, ca]);
      }
      faces = nf;
    }
    return fromFaces(verts, faces, scale);
  }

  // ==========================================================================
  // L-sistemler — üç boyutlu kaplumbağa grafiği
  // ==========================================================================
  /* Kurallar bir dizeyi tekrar tekrar yeniden yazar; sonuç kaplumbağa
     komutları olarak yorumlanır:
       F ileri çiz, + - sağ/sol dön, & ^ yukarı/aşağı eğ, \ / yuvarlan,
       [ ] durumu yığına al/geri koy */
  const LSYS = {
    tree: { axiom: 'F', rules: { F: 'FF+[+F-F-F]-[-F+F+F]' }, angle: 22.5 },
    bush: { axiom: 'A', rules: { A: '[&FL!A]/////[&FL!A]///////[&FL!A]', F: 'S/////F', S: 'F L', L: '[Fl]' }, angle: 22.5 },
    fern: { axiom: 'X', rules: { X: 'F[+X][-X]FX', F: 'FF' }, angle: 25 },
    dragon: { axiom: 'FX', rules: { X: 'X+YF+', Y: '-FX-Y' }, angle: 90 },
    hilbert: { axiom: 'A', rules: { A: 'B-F+CFC+F-D&F^D-F+&&CFC+F+B//', B: 'A&F^CFB^F^D^^-F-D^|F^B|FC^F^A//', C: '|D^|F^B-F+C^F^A&&FA&F^C+F+B^F^D//', D: '|CFB-F-B|FA&F^A&&FB-F+B|FC//' }, angle: 90 },
  };

  function lsystem(kind, iterations, angleDeg, scale) {
    const def = LSYS[kind] || LSYS.tree;
    let s = def.axiom;
    const iter = Math.max(1, Math.min(kind === 'hilbert' ? 3 : 6, iterations | 0));
    for (let i = 0; i < iter; i++) {
      let out = '';
      for (const ch of s) out += (def.rules[ch] !== undefined ? def.rules[ch] : ch);
      s = out;
      // Dize patlamasını sınırla: 200k karakterden sonrası görsel olarak
      // ayırt edilemez ama ağ kurulumunu kilitler
      if (s.length > 200000) break;
    }

    const ang = (angleDeg == null ? def.angle : angleDeg) * Math.PI / 180;
    const pos = [];
    const line = [];
    // Kaplumbağa çatısı: ileri (H), sol (L), yukarı (U)
    let P = [0, -1, 0];
    let H = [0, 1, 0];
    let L = [-1, 0, 0];
    let U = [0, 0, 1];
    const stack = [];
    const step = 0.06;
    const push = (v) => { pos.push(v[0], v[1], v[2]); return pos.length / 3 - 1; };
    let cur = push(P);

    const rot = (a, b, t) => {
      // a ekseninde değil, a ve b düzleminde döndür
      const c = Math.cos(t);
      const s2 = Math.sin(t);
      return [
        [a[0] * c + b[0] * s2, a[1] * c + b[1] * s2, a[2] * c + b[2] * s2],
        [b[0] * c - a[0] * s2, b[1] * c - a[1] * s2, b[2] * c - a[2] * s2],
      ];
    };

    for (const ch of s) {
      if (ch === 'F' || ch === 'S' || ch === 'G') {
        P = [P[0] + H[0] * step, P[1] + H[1] * step, P[2] + H[2] * step];
        const next = push(P);
        line.push(cur, next);
        cur = next;
      } else if (ch === '+') { const r = rot(H, L, ang); H = r[0]; L = r[1]; }
      else if (ch === '-') { const r = rot(H, L, -ang); H = r[0]; L = r[1]; }
      else if (ch === '&') { const r = rot(H, U, ang); H = r[0]; U = r[1]; }
      else if (ch === '^') { const r = rot(H, U, -ang); H = r[0]; U = r[1]; }
      else if (ch === '\\' || ch === '<') { const r = rot(L, U, ang); L = r[0]; U = r[1]; }
      else if (ch === '/' || ch === '>') { const r = rot(L, U, -ang); L = r[0]; U = r[1]; }
      else if (ch === '|') { H = [-H[0], -H[1], -H[2]]; L = [-L[0], -L[1], -L[2]]; }
      else if (ch === '[') stack.push({ P: P.slice(), H: H.slice(), L: L.slice(), U: U.slice(), cur });
      else if (ch === ']') {
        const st = stack.pop();
        if (st) { P = st.P; H = st.H; L = st.L; U = st.U; cur = st.cur; }
      }
      if (pos.length / 3 > 120000) break;
    }

    const count = pos.length / 3;
    const nor = new Float32Array(count * 3);
    const uvs = new Float32Array(count * 2);
    for (let i = 0; i < count; i++) {
      const x = pos[i * 3];
      const y = pos[i * 3 + 1];
      const z = pos[i * 3 + 2];
      const l = Math.hypot(x, y, z) || 1;
      nor[i * 3] = x / l; nor[i * 3 + 1] = y / l; nor[i * 3 + 2] = z / l;
      uvs[i * 2] = i / count;
      uvs[i * 2 + 1] = 0.5;
    }
    const sc = scale || 1;
    const p32 = new Float32Array(count * 3);
    for (let i = 0; i < count * 3; i++) p32[i] = pos[i] * sc;
    return { pos: p32, nor, uvs, tri: null, line: new Uint32Array(line), count };
  }

  // ==========================================================================
  // Yinelemeli fonksiyon sistemleri (nokta bulutu)
  // ==========================================================================
  /* Kaotik oyun: rastgele seçilen bir dönüşüm tekrar tekrar uygulanır ve
     yörünge çekiciyi doldurur. Seçim TOHUMLU bir üreteçten gelir, böylece
     aynı ayar her zaman aynı bulutu verir (dışa aktarım belirlenimliliği). */
  // centre: yörüngenin ölçülmüş orta noktası (elle değil, sınırlardan)
  const IFS_CENTRE = {
    barnsley: [0.24, 5.05, 0],
    sierpinski: [1.0, 0.87, 0.82],
    spiralIfs: [2.23, 1.30, 0.07],
  };

  const IFS = {
    barnsley: [
      { w: 0.01, m: [0, 0, 0, 0, 0.16, 0, 0, 0, 0], t: [0, 0, 0] },
      { w: 0.85, m: [0.85, 0.04, 0, -0.04, 0.85, 0, 0, 0, 0.85], t: [0, 1.6, 0] },
      { w: 0.07, m: [0.2, -0.26, 0, 0.23, 0.22, 0, 0, 0, 0.3], t: [0, 1.6, 0] },
      { w: 0.07, m: [-0.15, 0.28, 0, 0.26, 0.24, 0, 0, 0, 0.3], t: [0, 0.44, 0] },
    ],
    sierpinski: [
      { w: 0.25, m: [0.5, 0, 0, 0, 0.5, 0, 0, 0, 0.5], t: [0, 0, 0] },
      { w: 0.25, m: [0.5, 0, 0, 0, 0.5, 0, 0, 0, 0.5], t: [1, 0, 0] },
      { w: 0.25, m: [0.5, 0, 0, 0, 0.5, 0, 0, 0, 0.5], t: [0.5, 0.87, 0] },
      { w: 0.25, m: [0.5, 0, 0, 0, 0.5, 0, 0, 0, 0.5], t: [0.5, 0.29, 0.82] },
    ],
    spiralIfs: [
      { w: 0.9, m: [0.79, 0.55, 0, -0.55, 0.79, 0, 0, 0, 0.85], t: [0, 1.6, 0] },
      { w: 0.1, m: [-0.19, 0.28, 0, 0.27, 0.24, 0, 0, 0, 0.3], t: [0, 0.44, 0.1] },
    ],
  };

  function ifsCloud(kind, count, scale, seed) {
    const maps = IFS[kind] || IFS.barnsley;
    const centre = IFS_CENTRE[kind] || IFS_CENTRE.barnsley;
    const n = Math.max(1000, Math.min(200000, count | 0));
    const pos = new Float32Array(n * 3);
    const nor = new Float32Array(n * 3);
    const uvs = new Float32Array(n * 2);
    let s = (seed || 12345) >>> 0;
    const rnd = () => {
      s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
      return s / 4294967296;
    };
    let x = 0, y = 0, z = 0;
    // Toplam ağırlık üzerinden seçim
    const cum = [];
    let acc = 0;
    for (const m of maps) { acc += m.w; cum.push(acc); }
    for (let i = 0; i < n; i++) {
      const r = rnd() * acc;
      let k = 0;
      while (k < cum.length - 1 && r > cum[k]) k++;
      const m = maps[k];
      const nx = m.m[0] * x + m.m[1] * y + m.m[2] * z + m.t[0];
      const ny = m.m[3] * x + m.m[4] * y + m.m[5] * z + m.t[1];
      const nz = m.m[6] * x + m.m[7] * y + m.m[8] * z + m.t[2];
      x = nx; y = ny; z = nz;
      if (!isFinite(x) || !isFinite(y) || !isFinite(z)) { x = y = z = 0; }
      const sc = scale || 0.18;
      pos[i * 3] = (x - centre[0]) * sc;
      pos[i * 3 + 1] = (y - centre[1]) * sc;
      pos[i * 3 + 2] = (z - centre[2]) * sc;
      const l = Math.hypot(pos[i * 3], pos[i * 3 + 1], pos[i * 3 + 2]) || 1;
      nor[i * 3] = pos[i * 3] / l;
      nor[i * 3 + 1] = pos[i * 3 + 1] / l;
      nor[i * 3 + 2] = pos[i * 3 + 2] / l;
      uvs[i * 2] = i / n;
      uvs[i * 2 + 1] = 0.5;
    }
    return { pos, nor, uvs, tri: null, line: null, count: n, points: true };
  }

  // ==========================================================================
  // Katalog
  // ==========================================================================
  const SOLIDS = {
    tetrahedron: {
      label: 'Dörtyüzlü',
      params: [p('size', 'Boyut', 0.2, 1.5, 0.01, 0.8)],
      build: (q) => platonic('tetrahedron', q.size),
    },
    cube: {
      label: 'Küp',
      params: [p('size', 'Boyut', 0.2, 1.5, 0.01, 0.7)],
      build: (q) => platonic('cube', q.size),
    },
    octahedron: {
      label: 'Sekizyüzlü',
      params: [p('size', 'Boyut', 0.2, 1.5, 0.01, 0.85)],
      build: (q) => platonic('octahedron', q.size),
    },
    dodecahedron: {
      label: 'Onikiyüzlü',
      params: [p('size', 'Boyut', 0.2, 1.5, 0.01, 0.75)],
      build: (q) => platonic('dodecahedron', q.size),
    },
    icosahedron: {
      label: 'Yirmiyüzlü',
      params: [p('size', 'Boyut', 0.2, 1.5, 0.01, 0.8)],
      build: (q) => platonic('icosahedron', q.size),
    },
    geodesic: {
      label: 'Jeodezik Küre',
      params: [p('subdiv', 'Alt Bölünme', 0, 4, 1, 2), p('size', 'Boyut', 0.2, 1.5, 0.01, 0.85)],
      build: (q) => geodesic(q.subdiv, q.size),
    },
    lsysTree: {
      label: 'L-Sistem Ağaç',
      params: [p('iter', 'Yineleme', 1, 5, 1, 4), p('angle', 'Açı', 5, 60, 0.5, 22.5), p('size', 'Boyut', 0.2, 2, 0.02, 1)],
      build: (q) => lsystem('tree', q.iter, q.angle, q.size),
    },
    lsysFern: {
      label: 'L-Sistem Eğrelti',
      params: [p('iter', 'Yineleme', 1, 6, 1, 5), p('angle', 'Açı', 5, 60, 0.5, 25), p('size', 'Boyut', 0.2, 2, 0.02, 1)],
      build: (q) => lsystem('fern', q.iter, q.angle, q.size),
    },
    lsysDragon: {
      label: 'Ejderha Eğrisi',
      params: [p('iter', 'Yineleme', 4, 14, 1, 11), p('size', 'Boyut', 0.2, 2, 0.02, 0.6)],
      build: (q) => lsystem('dragon', q.iter, 90, q.size),
    },
    lsysHilbert: {
      label: 'Hilbert Eğrisi (3B)',
      params: [p('iter', 'Yineleme', 1, 3, 1, 2), p('size', 'Boyut', 0.2, 2, 0.02, 0.8)],
      build: (q) => lsystem('hilbert', q.iter, 90, q.size),
    },
    ifsBarnsley: {
      label: 'Barnsley Eğreltisi',
      params: [p('points', 'Nokta', 5000, 200000, 1000, 60000), p('size', 'Boyut', 0.05, 0.5, 0.005, 0.16)],
      build: (q) => ifsCloud('barnsley', q.points, q.size, 12345),
    },
    ifsSierpinski: {
      label: 'Sierpinski Dörtyüzlü',
      params: [p('points', 'Nokta', 5000, 200000, 1000, 60000), p('size', 'Boyut', 0.1, 1.5, 0.02, 0.6)],
      build: (q) => ifsCloud('sierpinski', q.points, q.size, 777),
    },
    ifsSpiral: {
      label: 'Sarmal IFS',
      params: [p('points', 'Nokta', 5000, 200000, 1000, 60000), p('size', 'Boyut', 0.05, 0.5, 0.005, 0.14)],
      build: (q) => ifsCloud('spiralIfs', q.points, q.size, 4242),
    },
  };

  function defaults(def) {
    const out = {};
    for (const q of def.params || []) out[q.name] = q.default;
    return out;
  }

  function catalog() {
    return Object.keys(SOLIDS).map((k) => ({
      family: 'solid', key: k, label: SOLIDS[k].label, params: SOLIDS[k].params || [],
    }));
  }

  const api = { SOLIDS, catalog, defaults, platonic, geodesic, lsystem, ifsCloud, fromFaces, PLATONIC, LSYS, IFS };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (typeof window !== 'undefined') window.SVSolids = api;
})();
