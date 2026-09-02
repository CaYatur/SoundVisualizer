'use strict';
/* MilkDrop preset dilinin yorumlayıcısı.

   2.1'de `.milk` dosyalarının yalnızca SABİT parametreleri okunuyordu ve bu
   açıkça öyle söyleniyordu. Buradaki iş, presetin asıl içeriğini — denklem
   bloklarını — gerçekten çalıştırmak.

   Dört parça:

     1. Sözcükleyici (tokenize)  — kaynak metni belirteçlere ayırır
     2. Ayrıştırıcı (parse)      — öncelik kurallarıyla sözdizim ağacı kurar
     3. Derleyici (compile)      — ağacı bir JS kapanışına çevirir
     4. Değişken havuzu          — q1..q32, t1..t8, regNN ve preset değişkenleri

   NEDEN DERLEME:
   Ağacı piksel piksel yürütmek kabul edilemez derecede yavaş. `per_pixel`
   bloğu 48x36'lık bir ağda kare başına 1728 kez koşuyor; ağaç yürüyüşünde
   her düğüm bir sanal çağrı demek. Derlenmiş kapanışta ise aynı iş düz
   aritmetiğe iniyor.

   GÜVENLİK:
   Üretilen JS'e preset metninden hiçbir şey KOPYALANMAZ. Tanımlayıcılar
   havuz indislerine (P[12]) çevrilir, sayılar yeniden biçimlendirilir. Yani
   çalıştırılan kod her zaman bu dosyanın ürettiği koddur; presetin
   içeriğinden gelen bir dize asla kod olarak değerlendirilmez.

   Dil ns-eel türevidir: büyük/küçük harf ayrımı yoktur, `//` yorum satırı
   açar, deyimler `;` ile ayrılır, atama bir ifadedir ve değerini döndürür. */
(function () {
  // ==========================================================================
  // Sözcükleyici
  // ==========================================================================
  const PUNCT = [
    '<<', '>>', '<=', '>=', '==', '!=', '&&', '||',
    '+', '-', '*', '/', '%', '^', '(', ')', ',', ';', '=', '<', '>', '&', '|', '!',
  ];

  function tokenize(src) {
    const s = String(src == null ? '' : src);
    const out = [];
    let i = 0;
    let line = 1;
    while (i < s.length) {
      const c = s[i];
      if (c === '\n') { line++; i++; continue; }
      if (c === ' ' || c === '\t' || c === '\r') { i++; continue; }
      // Yorumlar
      if (c === '/' && s[i + 1] === '/') {
        while (i < s.length && s[i] !== '\n') i++;
        continue;
      }
      if (c === '/' && s[i + 1] === '*') {
        i += 2;
        while (i < s.length && !(s[i] === '*' && s[i + 1] === '/')) { if (s[i] === '\n') line++; i++; }
        i += 2;
        continue;
      }
      // Sayı
      if ((c >= '0' && c <= '9') || (c === '.' && s[i + 1] >= '0' && s[i + 1] <= '9')) {
        let j = i;
        while (j < s.length && ((s[j] >= '0' && s[j] <= '9') || s[j] === '.')) j++;
        // Üstel gösterim
        if (s[j] === 'e' || s[j] === 'E') {
          let k = j + 1;
          if (s[k] === '+' || s[k] === '-') k++;
          if (s[k] >= '0' && s[k] <= '9') {
            j = k;
            while (j < s.length && s[j] >= '0' && s[j] <= '9') j++;
          }
        }
        const num = parseFloat(s.slice(i, j));
        out.push({ t: 'num', v: isFinite(num) ? num : 0, line });
        i = j;
        continue;
      }
      // Tanımlayıcı
      if (/[A-Za-z_]/.test(c)) {
        let j = i;
        while (j < s.length && /[A-Za-z0-9_.]/.test(s[j])) j++;
        // Dil büyük/küçük harf ayrımı yapmaz
        out.push({ t: 'id', v: s.slice(i, j).toLowerCase(), line });
        i = j;
        continue;
      }
      // İşleç
      let hit = null;
      for (const p of PUNCT) {
        if (s.startsWith(p, i)) { hit = p; break; }
      }
      if (hit) {
        out.push({ t: 'op', v: hit, line });
        i += hit.length;
        continue;
      }
      // Tanınmayan karakter: presetlerde çöp bayt olabiliyor, atla
      i++;
    }
    out.push({ t: 'eof', v: '', line });
    return out;
  }

  // ==========================================================================
  // Yerleşik fonksiyonlar
  //
  // Hepsi tanımına sadık ve UÇ DURUMLARDA NaN ÜRETMEZ. Bir presetin
  // log(0) yazması olağandır; NaN üretmek tüm kareyi siyaha çevirirdi, oysa
  // MilkDrop'un kendisi bu durumlarda sonlu bir değerle devam eder.
  // ==========================================================================
  const FUNCS = {
    sin: [1, (a) => Math.sin(a)],
    cos: [1, (a) => Math.cos(a)],
    tan: [1, (a) => { const v = Math.tan(a); return isFinite(v) ? v : 0; }],
    asin: [1, (a) => Math.asin(Math.max(-1, Math.min(1, a)))],
    acos: [1, (a) => Math.acos(Math.max(-1, Math.min(1, a)))],
    atan: [1, (a) => Math.atan(a)],
    atan2: [2, (a, b) => Math.atan2(a, b)],
    abs: [1, (a) => Math.abs(a)],
    sqr: [1, (a) => a * a],
    sqrt: [1, (a) => Math.sqrt(Math.abs(a))],
    pow: [2, (a, b) => { const v = Math.pow(a, b); return isFinite(v) ? v : 0; }],
    exp: [1, (a) => { const v = Math.exp(a); return isFinite(v) ? v : 0; }],
    log: [1, (a) => (a > 0 ? Math.log(a) : 0)],
    log10: [1, (a) => (a > 0 ? Math.log10(a) : 0)],
    int: [1, (a) => Math.floor(a)],
    floor: [1, (a) => Math.floor(a)],
    ceil: [1, (a) => Math.ceil(a)],
    frac: [1, (a) => a - Math.floor(a)],
    min: [2, (a, b) => (a < b ? a : b)],
    max: [2, (a, b) => (a > b ? a : b)],
    sign: [1, (a) => (a > 0 ? 1 : a < 0 ? -1 : 0)],
    rand: [1, null],     // durum taşır, derleyicide özel
    bnot: [1, (a) => (a === 0 ? 1 : 0)],
    bor: [2, (a, b) => (a !== 0 || b !== 0 ? 1 : 0)],
    band: [2, (a, b) => (a !== 0 && b !== 0 ? 1 : 0)],
    equal: [2, (a, b) => (a === b ? 1 : 0)],
    above: [2, (a, b) => (a > b ? 1 : 0)],
    below: [2, (a, b) => (a < b ? 1 : 0)],
    if: [3, null],       // kısa devre, derleyicide özel
    sigmoid: [2, (a, b) => {
      const t = 1 + Math.exp(-a * b);
      return t !== 0 ? 1 / t : 0;
    }],
  };

  // ==========================================================================
  // Ayrıştırıcı
  // ==========================================================================
  /* Öncelik, düşükten yükseğe. ns-eel sırası:
       ||  →  &&  →  |  →  &  →  karşılaştırma  →  + -  →  * / %  →  ^ */
  const BIN = [
    ['||'], ['&&'], ['|'], ['&'],
    ['==', '!=', '<', '>', '<=', '>='],
    ['+', '-'], ['*', '/', '%'],
  ];

  function parse(src) {
    const toks = tokenize(src);
    let pos = 0;
    const peek = () => toks[pos];
    const isOp = (v) => toks[pos].t === 'op' && toks[pos].v === v;
    const eat = (v) => { if (isOp(v)) { pos++; return true; } return false; };
    const expect = (v) => {
      if (!eat(v)) throw new SyntaxError(`'${v}' bekleniyordu (satır ${toks[pos].line}, bulunan '${toks[pos].v}')`);
    };

    function primary() {
      const tk = peek();
      if (tk.t === 'num') { pos++; return { k: 'num', v: tk.v }; }
      if (tk.t === 'op' && tk.v === '(') {
        pos++;
        const e = expr();
        expect(')');
        return e;
      }
      if (tk.t === 'op' && (tk.v === '-' || tk.v === '+' || tk.v === '!')) {
        pos++;
        const e = unary();
        if (tk.v === '+') return e;
        return { k: 'un', op: tk.v, a: e };
      }
      if (tk.t === 'id') {
        pos++;
        if (isOp('(')) {
          pos++;
          const args = [];
          if (!isOp(')')) {
            do { args.push(expr()); } while (eat(','));
          }
          expect(')');
          const def = FUNCS[tk.v];
          if (!def) throw new SyntaxError(`bilinmeyen fonksiyon '${tk.v}' (satır ${tk.line})`);
          if (def[0] !== args.length) {
            throw new SyntaxError(`'${tk.v}' ${def[0]} argüman ister, ${args.length} verildi (satır ${tk.line})`);
          }
          return { k: 'call', name: tk.v, args };
        }
        return { k: 'var', name: tk.v };
      }
      throw new SyntaxError(`beklenmeyen '${tk.v || 'dosya sonu'}' (satır ${tk.line})`);
    }

    function unary() { return primary(); }

    // Üs alma sağdan birleşir ve tekli eksiden daha sıkı bağlar
    function power() {
      let left = unary();
      if (isOp('^')) {
        pos++;
        const right = power();
        return { k: 'bin', op: '^', a: left, b: right };
      }
      return left;
    }

    function binary(level) {
      if (level >= BIN.length) return power();
      let left = binary(level + 1);
      for (;;) {
        const tk = peek();
        if (tk.t !== 'op' || BIN[level].indexOf(tk.v) < 0) break;
        pos++;
        const right = binary(level + 1);
        left = { k: 'bin', op: tk.v, a: left, b: right };
      }
      return left;
    }

    function expr() {
      // Atama: sol taraf tek bir değişken olmalı
      const start = pos;
      if (peek().t === 'id' && toks[pos + 1] && toks[pos + 1].t === 'op' && toks[pos + 1].v === '=') {
        const name = peek().v;
        pos += 2;
        return { k: 'assign', name, v: expr() };
      }
      pos = start;
      return binary(0);
    }

    const stmts = [];
    while (peek().t !== 'eof') {
      if (eat(';')) continue;
      stmts.push(expr());
      if (!eat(';') && peek().t !== 'eof') {
        /* MilkDrop presetlerinde ';' sık sık unutulur ve orijinal
           yorumlayıcı buna izin verir. Katı davranmak, gerçek dünyadaki
           presetlerin büyük bölümünü reddetmek olurdu. */
        continue;
      }
    }
    return stmts;
  }

  // ==========================================================================
  // Derleyici
  // ==========================================================================
  /* Değişken havuzu.

     Tanımlayıcılar bir indise çevrilir ve üretilen kodda yalnızca `P[12]`
     biçiminde görünür. Preset metninden hiçbir dize koda kopyalanmaz. */
  class Pool {
    constructor() {
      this.index = new Map();
      this.names = [];
      this.values = new Float64Array(0);
      // Kare boyunca kalıcı olanlar (registerlar) — sıfırlamada korunur
      this.persistent = new Set();
      for (let i = 0; i < 100; i++) {
        const n = 'reg' + (i < 10 ? '0' + i : i);
        this.persistent.add(n);
      }
    }
    id(name) {
      let i = this.index.get(name);
      if (i === undefined) {
        i = this.names.length;
        this.index.set(name, i);
        this.names.push(name);
        const next = new Float64Array(this.names.length);
        next.set(this.values);
        this.values = next;
      }
      return i;
    }
    get(name) {
      const i = this.index.get(name);
      return i === undefined ? 0 : this.values[i];
    }
    set(name, v) {
      /* İndis ÖNCE alınmalı.

         `this.values[this.id(name)] = v` yazmak sessizce yanlış çalışır:
         JavaScript dizi referansını indeks ifadesinden ÖNCE değerlendirir,
         oysa id() yeni bir değişken eklerken values'ı daha büyük bir diziyle
         DEĞİŞTİRİYOR. Yazma o zaman atılmış olan eski diziye gider ve değer
         kaybolur. */
      const i = this.id(name);
      this.values[i] = Number(v) || 0;
    }
    // Kalıcı olmayan değişkenleri sıfırla (yeni preset yüklendiğinde)
    reset() {
      for (let i = 0; i < this.names.length; i++) {
        if (!this.persistent.has(this.names[i])) this.values[i] = 0;
      }
    }
  }

  const num = (v) => {
    if (!isFinite(v)) return '0';
    // Tam sayılar da ondalık yazılır ki JS'te tamsayı bölmesi sürprizi olmasın
    return Number.isInteger(v) ? v.toFixed(1) : String(v);
  };

  function emit(node, pool) {
    switch (node.k) {
      case 'num':
        return num(node.v);
      case 'var':
        return 'P[' + pool.id(node.name) + ']';
      case 'assign':
        return '(P[' + pool.id(node.name) + '] = ' + guard(emit(node.v, pool)) + ')';
      case 'un':
        if (node.op === '-') return '(-' + emit(node.a, pool) + ')';
        if (node.op === '!') return '((' + emit(node.a, pool) + ') === 0 ? 1 : 0)';
        return emit(node.a, pool);
      case 'bin':
        return binExpr(node, pool);
      case 'call':
        return callExpr(node, pool);
      default:
        return '0';
    }
  }

  // Bölme ve benzeri işlemler sonsuz üretebilir; sonuç her zaman sonlu tutulur
  const guard = (js) => '(F(' + js + '))';

  function binExpr(node, pool) {
    const a = emit(node.a, pool);
    const b = emit(node.b, pool);
    switch (node.op) {
      case '+': return '(' + a + ' + ' + b + ')';
      case '-': return '(' + a + ' - ' + b + ')';
      case '*': return '(' + a + ' * ' + b + ')';
      // Sıfıra bölme MilkDrop'ta hata değil: sonuç 0 kabul edilir
      case '/': return '(D(' + a + ', ' + b + '))';
      case '%': return '(M(' + a + ', ' + b + '))';
      case '^': return '(F(Math.pow(' + a + ', ' + b + ')))';
      case '==': return '((' + a + ' === ' + b + ') ? 1 : 0)';
      case '!=': return '((' + a + ' !== ' + b + ') ? 1 : 0)';
      case '<': return '((' + a + ' < ' + b + ') ? 1 : 0)';
      case '>': return '((' + a + ' > ' + b + ') ? 1 : 0)';
      case '<=': return '((' + a + ' <= ' + b + ') ? 1 : 0)';
      case '>=': return '((' + a + ' >= ' + b + ') ? 1 : 0)';
      case '&&': return '(((' + a + ') !== 0 && (' + b + ') !== 0) ? 1 : 0)';
      case '||': return '(((' + a + ') !== 0 || (' + b + ') !== 0) ? 1 : 0)';
      // Bit işleçleri tam sayıya yuvarlar
      case '&': return '((' + a + ' | 0) & (' + b + ' | 0))';
      case '|': return '((' + a + ' | 0) | (' + b + ' | 0))';
      default: return '0';
    }
  }

  function callExpr(node, pool) {
    const name = node.name;
    const a = node.args.map((x) => emit(x, pool));
    // if() kısa devre yapmalı: her iki dalı da hesaplamak yan etkileri
    // (atamaları) yanlışlıkla çalıştırırdı
    if (name === 'if') return '(((' + a[0] + ') !== 0) ? (' + a[1] + ') : (' + a[2] + '))';
    if (name === 'rand') return '(R(' + a[0] + '))';
    return '(FN.' + name + '(' + a.join(', ') + '))';
  }

  /* Bir denklem bloğunu derler.

     Dönüş: { run(P), pool, error }  — hata varsa run yine çalışır ama hiçbir
     şey yapmaz. Bozuk bir preset uygulamayı durdurmamalı; olan biteni
     kullanıcıya söylemek yeterli. */
  function compile(src, pool, opts) {
    const p = pool || new Pool();
    const o = opts || {};
    let stmts;
    try {
      stmts = parse(src);
    } catch (e) {
      return { run: () => {}, pool: p, error: String(e.message || e), statements: 0 };
    }
    const body = stmts.map((s) => guard(emit(s, p)) + ';').join('\n');

    // Yardımcılar kapanışa dışarıdan verilir; üretilen kodda serbest
    // tanımlayıcı yoktur.
    const F = (v) => (isFinite(v) ? v : 0);
    const D = (a, b) => (b === 0 ? 0 : F(a / b));
    const M = (a, b) => {
      const bi = b | 0;
      return bi === 0 ? 0 : (a | 0) % bi;
    };
    // rand(n): 0..n-1 tam sayı. Tohumlu, çünkü çevrimdışı dışa aktarımın
    // kare kare tekrarlanabilir olması gerekiyor.
    let seed = (o.seed || 12345) >>> 0;
    const R = (n) => {
      seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
      const k = Math.max(1, Math.floor(n) || 1);
      return (seed / 4294967296) * k | 0;
    };

    let fn;
    try {
      // eslint-disable-next-line no-new-func
      fn = new Function('P', 'FN', 'F', 'D', 'M', 'R', body);
    } catch (e) {
      return { run: () => {}, pool: p, error: 'derleme: ' + String(e.message || e), statements: 0 };
    }
    const funcs = {};
    for (const k in FUNCS) if (FUNCS[k][1]) funcs[k] = FUNCS[k][1];
    return {
      pool: p,
      error: '',
      statements: stmts.length,
      source: body,
      resetSeed: (s) => { seed = (s || 12345) >>> 0; },
      run: (P) => {
        try { fn(P || p.values, funcs, F, D, M, R); } catch (e) { /* çalışma anı hatası kareyi düşürmesin */ }
      },
    };
  }

  // ==========================================================================
  // .milk dosya ayrıştırıcısı
  // ==========================================================================
  /* MilkDrop preset dosyası INI benzeridir ama tutarsızdır: denklem satırları
     `per_frame_1=`, `per_frame_2=` gibi numaralandırılmış anahtarlarla
     yazılır ve sırayla birleştirilmeleri gerekir; anahtarlar bazen büyük
     harflidir; dosya sonunda çöp olabilir. Ayrıştırıcı hoşgörülü olmak
     zorunda — katı olan, gerçek dünyadaki dosyaların çoğunu reddederdi. */
  function parseMilk(text) {
    const lines = String(text == null ? '' : text).split(/\r?\n/);
    const params = {};
    const blocks = {};
    const warpShader = [];
    const compShader = [];
    const waves = {};
    const shapes = {};

    const push = (map, key, idx, value) => {
      (map[key] = map[key] || []).push({ idx, value });
    };

    for (const raw of lines) {
      const line = raw.trim();
      if (!line || line[0] === '[') continue;
      const eq = line.indexOf('=');
      if (eq < 0) continue;
      const key = line.slice(0, eq).trim().toLowerCase();
      const value = line.slice(eq + 1);

      // Numaralandırılmış denklem satırları
      let m = /^per_frame_init_(\d+)$/.exec(key);
      if (m) { push(blocks, 'per_frame_init', +m[1], value); continue; }
      m = /^per_frame_(\d+)$/.exec(key);
      if (m) { push(blocks, 'per_frame', +m[1], value); continue; }
      m = /^per_pixel_(\d+)$/.exec(key);
      if (m) { push(blocks, 'per_pixel', +m[1], value); continue; }
      m = /^per_vertex_(\d+)$/.exec(key);
      if (m) { push(blocks, 'per_pixel', +m[1], value); continue; } // eşanlamlı
      m = /^warp_(\d+)$/.exec(key);
      if (m) { warpShader.push({ idx: +m[1], value }); continue; }
      m = /^comp_(\d+)$/.exec(key);
      if (m) { compShader.push({ idx: +m[1], value }); continue; }

      // Özel dalgalar / şekiller
      m = /^wave_(\d+)_(init|per_frame|per_point)(\d+)$/.exec(key);
      if (m) {
        const w = (waves[+m[1]] = waves[+m[1]] || {});
        push(w, m[2], +m[3], value);
        continue;
      }
      m = /^shape_(\d+)_(init|per_frame)(\d+)$/.exec(key);
      if (m) {
        const sh = (shapes[+m[1]] = shapes[+m[1]] || {});
        push(sh, m[2], +m[3], value);
        continue;
      }

      // Sayısal ya da metinsel parametre
      const n = parseFloat(value);
      params[key] = isFinite(n) && /^[\s\-+.0-9eE]+$/.test(value) ? n : value.trim();
    }

    const join = (arr) => (arr || []).slice().sort((a, b) => a.idx - b.idx).map((x) => x.value).join('\n');
    const joinBlocks = (map) => {
      const out = {};
      for (const k in map) out[k] = join(map[k]);
      return out;
    };

    const wavesOut = [];
    for (const k of Object.keys(waves).sort((a, b) => a - b)) wavesOut.push(joinBlocks(waves[k]));
    const shapesOut = [];
    for (const k of Object.keys(shapes).sort((a, b) => a - b)) shapesOut.push(joinBlocks(shapes[k]));

    return {
      params,
      init: join(blocks.per_frame_init),
      perFrame: join(blocks.per_frame),
      perPixel: join(blocks.per_pixel),
      warpShader: join(warpShader),
      compShader: join(compShader),
      waves: wavesOut,
      shapes: shapesOut,
    };
  }

  /* Bir presetin çalıştırılabilir hali.

     Preset yüklendiğinde blokları derler, kare başına per_frame'i bir kez,
     per_pixel'i ağ düğümü başına bir kez koşturur ve sonuçları okunabilir
     bir yapıda döndürür. */
  class Preset {
    constructor(text, opts) {
      const o = opts || {};
      this.file = parseMilk(text);
      this.pool = new Pool();
      this.errors = [];
      this.name = o.name || this.file.params.psetname || '';

      // Presetin sabit parametreleri havuza başlangıç değeri olarak girer
      for (const k in this.file.params) {
        const v = this.file.params[k];
        if (typeof v === 'number') this.pool.set(k, v);
      }

      this.cInit = compile(this.file.init, this.pool, { seed: o.seed });
      this.cFrame = compile(this.file.perFrame, this.pool, { seed: o.seed });
      this.cPixel = compile(this.file.perPixel, this.pool, { seed: o.seed });
      for (const c of [this.cInit, this.cFrame, this.cPixel]) {
        if (c.error) this.errors.push(c.error);
      }
      this.initialised = false;
    }

    // Havuzdaki değişkenlere kısayol
    get(name) { return this.pool.get(name); }
    set(name, v) { this.pool.set(name, v); }

    /* Kare başına: girdi değişkenlerini yaz, init'i (bir kez) ve per_frame'i
       koştur. inputs: { time, fps, frame, bass, mid, treb, bass_att, ... } */
    frame(inputs) {
      const P = this.pool;
      if (inputs) for (const k in inputs) P.set(k, inputs[k]);
      if (!this.initialised) {
        this.cInit.run(P.values);
        this.initialised = true;
      }
      this.cFrame.run(P.values);
      return P;
    }

    /* Ağ düğümü başına: x, y, rad, ang yazılır, per_pixel koşar ve hareket
       değişkenleri okunur. Dönüş nesnesi HER ÇAĞRIDA YENİDEN KULLANILIR —
       1728 düğüm için kare başına 1728 nesne ayırmak kabul edilemezdi. */
    pixel(x, y, rad, ang, out) {
      const P = this.pool;
      P.set('x', x);
      P.set('y', y);
      P.set('rad', rad);
      P.set('ang', ang);
      // Varsayılanlar her düğümde yeniden kurulur; presetler bunlara güvenir
      P.set('zoom', P.get('zoom_base') || this._base.zoom);
      P.set('zoomexp', this._base.zoomexp);
      P.set('rot', this._base.rot);
      P.set('warp', this._base.warp);
      P.set('cx', this._base.cx);
      P.set('cy', this._base.cy);
      P.set('dx', this._base.dx);
      P.set('dy', this._base.dy);
      P.set('sx', this._base.sx);
      P.set('sy', this._base.sy);
      this.cPixel.run(P.values);
      const o = out || {};
      o.zoom = P.get('zoom');
      o.zoomexp = P.get('zoomexp');
      o.rot = P.get('rot');
      o.warp = P.get('warp');
      o.cx = P.get('cx');
      o.cy = P.get('cy');
      o.dx = P.get('dx');
      o.dy = P.get('dy');
      o.sx = P.get('sx');
      o.sy = P.get('sy');
      return o;
    }

    // per_frame sonrası hareket değişkenlerinin kare genelindeki değerleri
    captureBase() {
      const P = this.pool;
      this._base = {
        zoom: P.get('zoom') || 1,
        zoomexp: P.get('zoomexp') || 1,
        rot: P.get('rot'),
        warp: P.get('warp'),
        cx: P.get('cx') || 0.5,
        cy: P.get('cy') || 0.5,
        dx: P.get('dx'),
        dy: P.get('dy'),
        sx: P.get('sx') || 1,
        sy: P.get('sy') || 1,
      };
      return this._base;
    }
  }

  const api = { tokenize, parse, compile, Pool, FUNCS, parseMilk, Preset };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (typeof window !== 'undefined') window.SVMilkdrop = api;
})();
