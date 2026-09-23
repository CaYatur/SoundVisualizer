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
  /* megabuf/gmegabuf: MilkDrop'un karalama bellekleri.

     MilkDrop bunları 1.048.576 girdilik sabit bir dizi olarak tutar. Burada
     4096'dan başlayıp ikiye katlayarak büyütüyoruz: yönetici paneli her
     çizimde presetin derlemesini doğrulamak için yeni bir Preset kuruyor ve
     preset başına 8 MB ayırmak kabul edilemezdi. Yazılmamış girdi 0'dır,
     dolayısıyla dizinin kısa olması okumayı değiştirmiyor. */
  const MEM_MAX = 1048576;
  function makeMem() {
    let a = new Float64Array(4096);
    return {
      get(i) {
        const k = i | 0;
        return k >= 0 && k < a.length ? a[k] : 0;
      },
      set(i, v) {
        const k = i | 0;
        if (k < 0 || k >= MEM_MAX) return v;
        if (k >= a.length) {
          let n = a.length;
          while (n <= k) n *= 2;
          if (n > MEM_MAX) n = MEM_MAX;
          const b = new Float64Array(n);
          b.set(a);
          a = b;
        }
        a[k] = v;
        return v;
      },
    };
  }
  // gmegabuf presetler arasında ORTAK: MilkDrop'ta da öyle.
  const GMEM = makeMem();

  const PUNCT = [
    '<<', '>>', '<=', '>=', '==', '!=', '&&', '||',
    '+=', '-=', '*=', '/=', '%=',
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
    while: [1, null],    // ifade sıfır dönene kadar tekrar; bütçeyle sınırlı
    exec2: [2, null],    // ikisini de çalıştırır, İKİNCİNİN değerini döner
    exec3: [3, null],    // üçünü de çalıştırır, ÜÇÜNCÜNÜN değerini döner
    assign: [2, null],   // assign(değişken, değer) — atamanın çağrı biçimi
    megabuf: [1, null],  // karalama bellek, derleyicide özel (yazılabilir)
    gmegabuf: [1, null], // aynısı, ama presetler arasında ortak
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
        const e = seqExpr();
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
          /* loop(sayı, deyim; deyim; …) — ns-eel'in döngü biçimi. Gövde
             virgülle DEĞİL noktalı virgülle ayrılıyor ve parantezle bitiyor,
             yani sıradan bir çağrı gibi ayrıştırılamaz. */
          if (tk.v === 'loop') {
            const n = expr();
            if (!eat(',')) {
              throw new SyntaxError(`'loop' için ',' bekleniyordu (satır ${peek().line})`);
            }
            const body = [];
            while (!isOp(')') && peek().t !== 'eof') {
              if (eat(';') || eat(',')) continue;
              const before = pos;
              body.push(expr());
              // expr() ilerlemediyse sonsuz döngüye girerdik
              if (pos === before) break;
            }
            expect(')');
            return { k: 'loop', n, body };
          }
          const args = [];
          if (!isOp(')')) {
            do { args.push(seqExpr()); } while (eat(','));
          }
          expect(')');
          /* assign(x, v) atamanın çağrı biçimi. Sol taraf bir değişken
             olmalı; başka bir şeyse sıradan çağrı gibi ele alınır ve arity
             denetimine takılır. */
          if (tk.v === 'assign' && args.length === 2 && args[0] && args[0].k === 'var') {
            return { k: 'assign', name: args[0].name, v: args[1] };
          }
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

    /* Parantez içinde ';' bir DEYİM DİZİSİ kurar; hepsi çalışır, sonuncunun
       değeri döner. ns-eel'de olağan: `if (c, a = 1; b = 2, ...)` gibi bir
       dalın içinde birden çok atama olabiliyor. Bunu desteklemeyen bir
       ayrıştırıcı gerçek presetlerin önemli bir bölümünü reddediyor. */
    function seqExpr() {
      const list = [expr()];
      while (isOp(';')) {
        // Ard arda gelen ';' boş deyimdir; gerçek presetlerde sık.
        while (eat(';')) { /* boş */ }
        if (isOp(')') || isOp(',') || peek().t === 'eof') break;
        const before = pos;
        list.push(expr());
        if (pos === before) break;
      }
      return list.length === 1 ? list[0] : { k: 'seq', list };
    }

    function expr() {
      const start = pos;
      /* Bellek yazması: megabuf(i) = ifade
         MilkDrop'un ifade dilinde megabuf() bir GÖSTERGE döndürür, dolayısıyla
         atamanın sol tarafında durabilir. Dilin geri kalanında çağrıya atama
         yoktur; bu yüzden yalnızca bu iki ad için açılıyor. */
      if (peek().t === 'id' && (peek().v === 'megabuf' || peek().v === 'gmegabuf')
          && toks[pos + 1] && toks[pos + 1].t === 'op' && toks[pos + 1].v === '(') {
        const buf = peek().v;
        pos += 2;
        const idx = expr();
        const nxt = toks[pos + 1];
        const COMP = ['+=', '-=', '*=', '/=', '%='];
        if (isOp(')') && nxt && nxt.t === 'op' && (nxt.v === '=' || COMP.indexOf(nxt.v) >= 0)) {
          const op = nxt.v;
          pos += 2;
          // Belleğe de bileşik atama yapılabiliyor: gmegabuf(n+1) *= 0.9
          return { k: 'bufset', buf, i: idx, compound: op === '=' ? '' : op[0], v: expr() };
        }
        // Atama değilmiş: sıradan bir okuma çağrısı olarak yeniden ayrıştır
        pos = start;
      }
      /* Bileşik atama: `zoom -= 0.03` ==> `zoom = zoom - 0.03`
         Ayrı bir düğüm türü gerekmiyor; sağ tarafı ikili işleme sarmak
         yeterli ve geri kalan her şey (guard, kapanış üretimi) aynen çalışır. */
      if (peek().t === 'id' && toks[pos + 1] && toks[pos + 1].t === 'op'
          && ['+=', '-=', '*=', '/=', '%='].indexOf(toks[pos + 1].v) >= 0) {
        const name = peek().v;
        const op = toks[pos + 1].v[0];
        pos += 2;
        return { k: 'assign', name, v: { k: 'bin', op, a: { k: 'var', name }, b: expr() } };
      }
      // Atama: sol taraf tek bir değişken olmalı
      if (peek().t === 'id' && toks[pos + 1] && toks[pos + 1].t === 'op' && toks[pos + 1].v === '=') {
        const name = peek().v;
        pos += 2;
        return { k: 'assign', name, v: expr() };
      }
      pos = start;
      return binary(0);
    }

    /* Deyim düzeyinde hata kurtarma.
       Tek bozuk satır yüzünden presetin TAMAMINI kaybetmek doğru değil;
       elde 10.347 gerçek preset var ve bozuk olanların hepsi elle düzenleme
       kalıntısı (`0 = 0.01*rand(..)`, işleçle başlayan deyim, iç içe girmiş
       iki anahtar satırı). Bozuk deyim atlanır, kalanı çalışır — ama hata
       YUTULMAZ: `errors` üzerinden derleyiciye, oradan panele taşınır. */
    const stmts = [];
    const errors = [];
    while (peek().t !== 'eof') {
      if (eat(';')) continue;
      const before = pos;
      try {
        stmts.push(expr());
      } catch (e) {
        errors.push(String((e && e.message) || e));
        if (pos === before) pos++;   // ilerlemeyi garanti et
        // Bozuk deyimi atla: derinlik 0'daki bir sonraki ';' ya da dosya sonu
        let depth = 0;
        while (peek().t !== 'eof') {
          const t = peek();
          if (t.t === 'op' && t.v === '(') depth++;
          else if (t.t === 'op' && t.v === ')') depth = Math.max(0, depth - 1);
          else if (t.t === 'op' && t.v === ';' && depth === 0) { pos++; break; }
          pos++;
        }
        continue;
      }
      if (!eat(';') && peek().t !== 'eof') {
        /* MilkDrop presetlerinde ';' sık sık unutulur ve orijinal
           yorumlayıcı buna izin verir. Katı davranmak, gerçek dünyadaki
           presetlerin büyük bölümünü reddetmek olurdu. */
        continue;
      }
    }
    stmts.errors = errors;
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
      /* megabuf presetin KENDİNE ait. Havuzda duruyor çünkü init, per_frame
         ve per_pixel ayrı ayrı derleniyor ama aynı belleği paylaşmaları
         gerekiyor — MilkDrop'ta da öyle. */
      this.mem = makeMem();
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
    /* Ada HİÇ dokunuldu mu. `get` bilinmeyen adda 0 dönüyor ve bu denklem
       koşarken doğru olan davranış — MilkDrop'ta da tanımsız değişken
       sıfırdır. Ama "preset sıfır yazdı" ile "preset hiç yazmadı"yı ayırmak
       gereken yerler var: `monitor` göstergesi bunlardan biri, boş
       gösterilmesi gereken yerde 0 göstermek yanlış bilgi olurdu. */
    has(name) { return this.index.has(name); }
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

  /* Bir düğümü, çağrıldığında değerini veren bir KAPANIŞA çevirir.

     Neden metin değil de kapanış: eskiden burada JavaScript kaynağı üretilip
     `new Function` ile derleniyordu. Sayfanın Content-Security-Policy'si
     `unsafe-eval` içermediği için tarayıcı bunu engelliyordu ve HİÇBİR preset
     çalışmıyordu (#559). CSP'yi gevşetmek yerine eval'i tümden kaldırdık.

     İkinci ve daha sinsi kazanç: eski `callExpr` fonksiyon adını üretilen
     metne yapıştırıyordu. Kod enjeksiyonunu ayrıştırıcıdaki beyaz liste
     engelliyordu, ama `FUNCS['constructor']` gibi miras alınan özellikler
     oraya sızabiliyordu; onları da yalnızca argüman sayısı denetiminin
     tesadüfen elemesi kurtarıyordu. Kapanışta yapıştırılacak metin yok.

     Hız: dallanma DERLEME anında bir kez yapılır, her karede değil. per_pixel
     40x30'luk ağın her düğümünde koşuyor — 60 fps'te saniyede ~76 bin
     değerlendirme; switch'i içeride bırakmak buranın en pahalı hatası olurdu. */
  function emit(node, pool, cx) {
    switch (node.k) {
      case 'num': {
        const v = isFinite(node.v) ? node.v : 0;
        return () => v;
      }
      case 'var': {
        const i = pool.id(node.name);
        return (P) => P[i];
      }
      case 'assign': {
        const i = pool.id(node.name);
        const rhs = emit(node.v, pool, cx);
        const F = cx.F;
        return (P) => (P[i] = F(rhs(P)));
      }
      case 'un': {
        const a = emit(node.a, pool, cx);
        if (node.op === '-') return (P) => -a(P);
        if (node.op === '!') return (P) => (a(P) === 0 ? 1 : 0);
        return a;
      }
      case 'seq': {
        const list = node.list.map((x) => emit(x, pool, cx));
        const n = list.length;
        return (P) => {
          let v = 0;
          for (let i = 0; i < n; i++) v = list[i](P);
          return v;
        };
      }
      case 'loop': {
        const n = emit(node.n, pool, cx);
        const body = node.body.map((b) => emit(b, pool, cx));
        const budget = cx.budget;
        const len = body.length;
        /* Bütçe: bir preset per_pixel içinde loop(10000, …) yazabilir. Ağın
           1271 düğümünde 60 fps ile bu kare başına 762 milyon işlem demek —
           uygulama donar. Bütçe her run() çağrısında sıfırlanıyor ve bloğun
           KAÇ KEZ koştuğuna göre veriliyor (bkz. Preset). Aşılırsa döngü
           kesilir; preset yanlış görünür ama uygulama yaşar. */
        return (P) => {
          let k = n(P) | 0;
          if (k < 0) k = 0;
          for (let i = 0; i < k; i++) {
            if (--budget.n < 0) break;
            for (let j = 0; j < len; j++) body[j](P);
          }
          return 0;
        };
      }
      case 'bufset': {
        const mem = node.buf === 'gmegabuf' ? GMEM : pool.mem;
        const i = emit(node.i, pool, cx);
        const v = emit(node.v, pool, cx);
        const F = cx.F;
        if (!node.compound) return (P) => mem.set(i(P), F(v(P)));
        /* Bileşik atamada indeks BİR KEZ değerlendirilir: `megabuf(n=n+1) *= 2`
           gibi yan etkili bir indeks iki kez çalışsaydı iki farklı gözü
           okuyup yazardı. İşleç de burada, derleme anında seçiliyor. */
        const D = cx.D, MM = cx.M, op = node.compound;
        const apply = op === '+' ? (a, b) => a + b
          : op === '-' ? (a, b) => a - b
            : op === '*' ? (a, b) => a * b
              : op === '/' ? (a, b) => D(a, b)
                : (a, b) => MM(a, b);
        return (P) => {
          const k = i(P);
          return mem.set(k, F(apply(mem.get(k), v(P))));
        };
      }
      case 'bin':
        return binExpr(node, pool, cx);
      case 'call':
        return callExpr(node, pool, cx);
      default:
        return () => 0;
    }
  }

  // Bölme ve benzeri işlemler sonsuz üretebilir; sonuç her zaman sonlu tutulur
  const guard = (fn, F) => (P) => F(fn(P));

  function binExpr(node, pool, cx) {
    const a = emit(node.a, pool, cx);
    const b = emit(node.b, pool, cx);
    const F = cx.F;
    switch (node.op) {
      case '+': return (P) => a(P) + b(P);
      case '-': return (P) => a(P) - b(P);
      case '*': return (P) => a(P) * b(P);
      // Sıfıra bölme MilkDrop'ta hata değil: sonuç 0 kabul edilir
      case '/': { const D = cx.D; return (P) => D(a(P), b(P)); }
      case '%': { const M = cx.M; return (P) => M(a(P), b(P)); }
      case '^': return (P) => F(Math.pow(a(P), b(P)));
      case '==': return (P) => (a(P) === b(P) ? 1 : 0);
      case '!=': return (P) => (a(P) !== b(P) ? 1 : 0);
      case '<': return (P) => (a(P) < b(P) ? 1 : 0);
      case '>': return (P) => (a(P) > b(P) ? 1 : 0);
      case '<=': return (P) => (a(P) <= b(P) ? 1 : 0);
      case '>=': return (P) => (a(P) >= b(P) ? 1 : 0);
      /* && ve || JavaScript'te olduğu gibi kısa devre yapar: sağ taraf
         gerekmedikçe ÇAĞRILMAZ. Eski üretilen kod da öyleydi; atama içeren
         bir sağ taraf iki davranış arasında fark yaratırdı. */
      case '&&': return (P) => (a(P) !== 0 && b(P) !== 0 ? 1 : 0);
      case '||': return (P) => (a(P) !== 0 || b(P) !== 0 ? 1 : 0);
      // Bit işleçleri tam sayıya yuvarlar
      case '&': return (P) => (a(P) | 0) & (b(P) | 0);
      case '|': return (P) => (a(P) | 0) | (b(P) | 0);
      default: return () => 0;
    }
  }

  function callExpr(node, pool, cx) {
    const name = node.name;
    const a = node.args.map((x) => emit(x, pool, cx));
    // if() kısa devre yapmalı: her iki dalı da hesaplamak yan etkileri
    // (atamaları) yanlışlıkla çalıştırırdı
    if (name === 'if') {
      const c = a[0], t = a[1], f = a[2];
      return (P) => (c(P) !== 0 ? t(P) : f(P));
    }
    if (name === 'rand') {
      const R = cx.R, n = a[0];
      return (P) => R(n(P));
    }
    if (name === 'while') {
      /* ns-eel'in while'ı: ifadeyi çalıştırır, SIFIR DÖNENE KADAR tekrarlar.
         Sonlanacağının hiçbir garantisi yok — durma problemi. Bütçe burada
         süs değil, uygulamanın donmamasının tek sebebi. */
      const body = a[0];
      const budget = cx.budget;
      return (P) => {
        for (;;) {
          if (--budget.n < 0) break;
          if (body(P) === 0) break;
        }
        return 0;
      };
    }
    if (name === 'exec2' || name === 'exec3') {
      // Hepsi çalışır, SONUNCUNUN değeri döner — dizi ifadesiyle aynı anlam
      const n = a.length;
      return (P) => {
        let v = 0;
        for (let i = 0; i < n; i++) v = a[i](P);
        return v;
      };
    }
    if (name === 'megabuf' || name === 'gmegabuf') {
      const mem = name === 'gmegabuf' ? GMEM : pool.mem;
      const i = a[0];
      return (P) => mem.get(i(P));
    }
    /* Ayrıştırıcı adı zaten beyaz listeye karşı doğruladı (bilinmeyen ad
       SyntaxError atar), burada da doğrudan o tablodan çözülüyor: çalışma
       anında ad üzerinden arama yok. */
    const def = FUNCS[name];
    const f = def && def[1];
    if (!f) return () => 0;
    // Argüman sayısına göre özelleşiyoruz: apply/yayılım her çağrıda dizi ayırır
    if (a.length === 1) { const x = a[0]; return (P) => f(x(P)); }
    if (a.length === 2) { const x = a[0], y = a[1]; return (P) => f(x(P), y(P)); }
    if (a.length === 3) { const x = a[0], y = a[1], z = a[2]; return (P) => f(x(P), y(P), z(P)); }
    return (P) => f.apply(null, a.map((g) => g(P)));
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
    /* Atlanan deyimler hata olarak bildirilir — preset yine de çalışır ama
       panel bunu göstersin diye. Sessizce çalıştırmak, kullanıcıya yanlış
       görünen bir sahnenin sebebini saklardı. */
    const skipped = (stmts.errors || []).slice();
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

    /* Yardımcılar kapanışlara buradan verilir. R tohumu dışarıda tuttuğu
       için resetSeed sonradan da çalışır. */
    const budget = { n: 0 };
    const cx = { F, D, M, R, budget };
    const LOOP_BUDGET = Math.max(0, Number(o.loopBudget) || 65536);

    let prog;
    try {
      prog = stmts.map((st) => guard(emit(st, p, cx), F));
    } catch (e) {
      return { run: () => {}, pool: p, error: 'derleme: ' + String(e.message || e), statements: 0 };
    }

    return {
      pool: p,
      error: skipped.length
        ? skipped.length + ' deyim atlandı: ' + skipped.join(' | ')
        : '',
      skipped: skipped.length,
      statements: stmts.length,
      resetSeed: (sd) => { seed = (sd || 12345) >>> 0; },
      run: (P) => {
        const V = P || p.values;
        budget.n = LOOP_BUDGET;
        try {
          for (let i = 0; i < prog.length; i++) prog[i](V);
        } catch (e) { /* çalışma anı hatası kareyi düşürmesin */ }
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

    /* Numaralı satırlar ARAYA HİÇBİR ŞEY KOYMADAN birleşir. MilkDrop uzun
       denklemleri sabit bir karakter sınırında keser ve kesik simgenin
       ortasından geçebilir: `...above(Treb,t` + `reb_Att))))...`. Araya
       satır sonu koymak o simgeyi ikiye böler ve preset ayrıştırılamaz.
       Deyimleri `;` ayırdığı, satır sonu ise yalnızca boşluk sayıldığı
       için bu birleştirme başka hiçbir şeyi değiştirmiyor. */
    /* Numaralı satırların birleştirilmesi iki YÖNDE de bozulabilir ve iki
       durum sözcük düzeyinde ayırt edilemiyor:

         bitiştir  -> `...above(Treb,t` + `reb_Att)` = `treb_Att`   DOĞRU
         bitiştir  -> `...bass_att` + `chng=sin(..)` = `bass_attchng` YANLIŞ

       Ayırt eden şey sonucu: doğru olan ayrıştırılır, yanlış olan
       ayrıştırılamaz. Bu yüzden önce bitiştirilir, ayrıştırılamazsa satır
       sonuyla birleştirilmiş biçim denenir. İkisi de olmuyorsa bitiştirilmiş
       biçim döner; hata mesajı birincil yoruma ait olsun. */
    const joinWith = (arr, sep) => (arr || []).slice().sort((a, b) => a.idx - b.idx)
      /* Satır yorumu ÖNCE ve satır satır atılır: bitiştirmeden sonra tek bir
         `//` kendinden sonraki bütün anahtarları yutar ve blok sessizce
         boşalır. Ölçüldü — 10.347 presetin 630'u böyle boşalıyordu. */
      .map((x) => String(x.value).replace(/\/\/.*$/, ''))
      .join(sep);
    /* parse artık atmıyor (deyim düzeyinde kurtarma var), bu yüzden
       birleştirme seçimi hata SAYISINA bakıyor. */
    const parses = (t) => { try { return parse(t).errors.length === 0; } catch (e) { return false; } };
    /* Shader blokları HLSL'dir, denklem değil. Yukarıdaki birleştirme onlara
       UYGULANAMAZ: denklem ayrıştırıcısı HLSL'i hiçbir zaman kabul etmeyeceği
       için her seferinde bitiştirilmiş biçim seçilir ve satırlar kaynaşır.
       Shader'lar satır yapısını korur ve yorumları kendi derleyicisine
       bırakır. */
    const joinShader = (arr) => (arr || []).slice()
      .sort((a, b) => a.idx - b.idx)
      /* MilkDrop her shader satırını ters tırnakla yazar: warp_1=`ret = ...
         Ters tırnak satırın parçası değil, MilkDrop'un satır başı işareti;
         soyulmazsa GLSL derleyicisine geçersiz bir simge olarak gider. */
      .map((x) => String(x.value).replace(/^`/, ''))
      .join('\n');
    const join = (arr) => {
      const glued = joinWith(arr, '');
      if (!arr || arr.length < 2 || parses(glued)) return glued;
      const lined = joinWith(arr, '\n');
      return parses(lined) ? lined : glued;
    };
    const joinBlocks = (map) => {
      const out = {};
      for (const k in map) out[k] = join(map[k]);
      return out;
    };

    /* Blok NUMARASI korunuyor. Preset yalnızca 0 ve 3 numaralı dalgayı
       tanımlayabiliyor; diziye sırayla koyup dizideki konumu numara saymak,
       o dalganın `wavecode_3_*` parametrelerini `wavecode_1_*` ile
       eşleştirirdi — renk ve örnek sayısı başka bir dalgadan gelirdi. */
    const wavesOut = [];
    for (const k of Object.keys(waves).sort((a, b) => a - b)) {
      const o = joinBlocks(waves[k]);
      o.index = +k;
      wavesOut.push(o);
    }
    const shapesOut = [];
    for (const k of Object.keys(shapes).sort((a, b) => a - b)) {
      const o = joinBlocks(shapes[k]);
      o.index = +k;
      shapesOut.push(o);
    }

    return {
      params,
      init: join(blocks.per_frame_init),
      perFrame: join(blocks.per_frame),
      perPixel: join(blocks.per_pixel),
      warpShader: joinShader(warpShader),
      compShader: joinShader(compShader),
      waves: wavesOut,
      shapes: shapesOut,
    };
  }

  /* Bir presetin çalıştırılabilir hali.

     Preset yüklendiğinde blokları derler, kare başına per_frame'i bir kez,
     per_pixel'i ağ düğümü başına bir kez koşturur ve sonuçları okunabilir
     bir yapıda döndürür. */

  /* Custom dalga/şekil havuzlarına taşınan kare geneli girdiler. Liste tek
     yerde duruyor: taşınmayan bir ad alt blokta sessizce sıfır kalır ve
     preset hiç kıpırdamaz — hata da vermez. */
  /* Preset başlığındaki ad -> denklemlerdeki ad. MilkDrop bu ikisini ayrı
     tutuyor ve presetler ikisini de kullanıyor: başlıkta `nWaveMode=2`,
     per_frame içinde `wave_mode = 3`. */
  const PARAM_ALIAS = [
    /* Kare geneli görüntü ayarları. `fDecay` gözden kaçtığında sonuç sessiz
       ama büyük: motor `decay` adını bulamayıp 0,98'lik kendi varsayılanına
       düşüyordu, oysa preset 0,5 yazmıştı. Görüntü sönmek yerine birikiyor
       ve birkaç saniyede beyaza doyuyordu. */
    ['fdecay', 'decay'],
    /* bTexWrap: warp geçişinin doku adresleme kipi. MilkDrop'un varsayılanı
       AÇIK ve referans pakette presetlerin %61'i açık kullanıyor. Kapalıyken
       kenardan çıkan görüntü geri girmiyor, ekran boşalıyor ve preset
       "bitmiş" gibi görünüyor. */
    ['btexwrap', 'wrap'],
    /* Dosyada `b1ed`, denklem dilinde `blur1_edge_darken`. Korpusta hiçbir
       preset denklemden yazmıyor, ama okuyan bir preset ikisini de
       bulmalı — MilkDrop ikisini aynı değişkene bağlıyor. */
    ['b1ed', 'blur1_edge_darken'],
    ['fgammaadj', 'gamma'],
    ['fvideoechoalpha', 'echo_alpha'],
    ['fvideoechozoom', 'echo_zoom'],
    ['nvideoechoorientation', 'echo_orient'],
    ['bdarkencenter', 'darken_center'],
    ['bbrighten', 'brighten'],
    ['bdarken', 'darken'],
    ['bsolarize', 'solarize'],
    ['binvert', 'invert'],
    /* fZoomExponent: yakınlaştırmanın YARIÇAPA GÖRE üssü. Motorun ağ
       dönüşümünün tam ortasında duruyor — `pow(zoom, pow(zoomexp, rad*2-1))`.
       Eşleme yoktu: dosyada `fZoomExponent` yazıyor, denklem dili ise
       `zoomexp` diye okuyor. Ulaşmayan değer `captureBase`in `|| 1`
       yedeğine düşüyor, yani zum merkezden kenara doğru HİÇ değişmiyordu.
       Korpusta 3.826 preset (%37,0) varsayılandan farklı bir üs yazıyor. */
    ['fzoomexponent', 'zoomexp'],
    ['fwarpanimspeed', 'warpanimspeed'],
    ['fwarpscale', 'warpscale'],
    ['fshader', 'fshader'],
    ['nwavemode', 'wave_mode'],
    ['bwavedots', 'wave_usedots'],
    ['bwavethick', 'wave_thick'],
    ['badditivewaves', 'wave_additive'],
    ['bmaximizewavecolor', 'wave_brighten'],
    ['fwavealpha', 'wave_a'],
    ['fwavescale', 'wave_scale'],
    /* fWaveParam: dalga biçimlerinin ikinci parametresi — denklem dilindeki
       adı `wave_mystery`. Motor `wave_mystery`yi zaten OKUYOR, dosyadan
       gelen değer ona hiç bağlanmamıştı. 1/2/3/5. dalga biçimlerinde bu
       sayı biçimin kendisini değiştiriyor; 3.484 preset (%33,7) sıfırdan
       farklı bir değer yazıyor. */
    ['fwaveparam', 'wave_mystery'],
    ['fwavesmoothing', 'wave_smoothing'],
    ['bmodwavealphabyvolume', 'wave_modalpha'],
    ['fmodwavealphastart', 'wave_modalpha_start'],
    ['fmodwavealphaend', 'wave_modalpha_end'],
    /* HAREKET VEKTÖRLERİ. Korpustaki presetlerin %92'sinde ızgara açık ama
       görünürlüğü `mv_a` belirliyor: %8,6'sı dosyada sıfırdan büyük bir
       alfa yazıyor, %5,7'si de per_frame içinde açıp kapıyor. Başlıktaki ad
       ile denklemlerdeki ad burada da farklı — nMotionVectorsX / mv_x. */
    ['nmotionvectorsx', 'mv_x'],
    ['nmotionvectorsy', 'mv_y'],
    ['bmotionvectorson', 'mv_on'],
  ];

  /* KARE BASINA SIFIRLANAN YERLESIK ADLAR.

     MilkDrop her karede per_frame'i kosturmadan ONCE butun yerlesik kare
     degiskenlerini preset DOSYASINDAN yeniden yukluyor
     (`LoadPerFrameEvallibVars`). Yani per_frame'in `zoom`a yazdigi deger
     o karenin sonunda atiliyor; sonraki kare yine dosyadaki degerle
     basliyor.

     Bizde havuz kalici oldugu icin bu hic olmuyordu: `zoom = zoom*1,01`
     yazan bir preset her karede bir oncekinin uzerine biniyor ve zum
     ussel olarak kaciyordu.

     Etkisi en buyuk olan yer q degiskenleri: MilkDrop q1..q32'yi her
     karede per_frame_init'in biraktigi degere geri aliyor, cunku q'lar
     kare geneli ile per_pixel/sekil/dalga arasindaki HABERLESME kanali,
     kalici depo degil (kalici depo `reg00..reg99`). Korpusta 2.015
     preset (%19,5) per_frame icinde `q1 = q1 + ...` gibi bir birikme
     yaziyor: MilkDrop'ta bu her karede AYNI sonucu verir, bizde ise
     sinirsiz buyuyordu. Karsilastirma: `reg` kullanan yalnizca 193
     preset (%1,9) — yani birikmeyi q ile yazan preset onu MilkDrop'un
     sifirladigini varsayarak yaziyor.

     Liste MilkDrop'un kendi `LoadPerFrameEvallibVars` govdesinden
     birebir alindi; preset YAZARININ kendi degiskenleri (atime, beat, zm
     gibi) listede YOK ve sifirlanmiyor — MilkDrop'ta da kaliciar.

     `monitor` bilerek disarida: MilkDrop onu her per_frame sonrasi
     yeniden yakalayip sonraki kareye tasiyor, yani havuzun dogal
     davranisi zaten dogru. */
  const PF_RESET = [
    // 1. Piksel hareketini etkileyenler
    'zoom', 'zoomexp', 'rot', 'warp', 'cx', 'cy', 'dx', 'dy', 'sx', 'sy',
    // 2. Etkilemeyenler
    'decay', 'wave_a', 'wave_r', 'wave_g', 'wave_b', 'wave_x', 'wave_y',
    'wave_mystery', 'wave_mode',
    'ob_size', 'ob_r', 'ob_g', 'ob_b', 'ob_a',
    'ib_size', 'ib_r', 'ib_g', 'ib_b', 'ib_a',
    'mv_x', 'mv_y', 'mv_dx', 'mv_dy', 'mv_l', 'mv_r', 'mv_g', 'mv_b', 'mv_a',
    'echo_zoom', 'echo_alpha', 'echo_orient',
    'wave_usedots', 'wave_thick', 'wave_additive', 'wave_brighten',
    'darken_center', 'gamma', 'wrap', 'invert', 'brighten', 'darken', 'solarize',
    /* MilkDrop'un denklem adlari blur1_min/blur1_max; bizim havuzdaki
       karsiliklari b1n/b1x (dosya anahtarlari da oyle). Korpusta bu adlari
       denklemde yazan tek bir preset var, o yuzden ayrica ad esleme
       kurulmadi — ama sifirlama listesine havuzdaki adiyla giriyorlar. */
    'b1n', 'b1x', 'b2n', 'b2x', 'b3n', 'b3x', 'b1ed',
  ];

  /* MILKDROP'UN VARSAYILANLARI, dosyanın YAZMADIĞI yerleşik adlar için
     (state.cpp CState::Default ve Import; #580). Havuzun doğal başlangıcı
     0 ve kare başı sıfırlama o 0'ı her kare geri yazıyordu: fDecay yazmayan
     bir preset hiç iz bırakmıyor (MilkDrop'ta 0,98), fGammaAdj yazmayan
     yarı parlaklıkta çıkıyor (MilkDrop'ta 2,0). Motorun "yazılmadıysa
     0,98" denetimi de işe yaramıyordu: sıfırlama adı havuza her kare
     yazdığı için ad hep "var" görünüyordu.

     `mv_a` MilkDrop'ta da sonunda 0: `bMotionVectorsOn` yoksa 0'a
     çevriliyor (state.cpp:1402), ancak sonra `mv_a` okunuyor.

     `wave_r/g/b/x/y` yazılmamışsa 0, CState::Default'un 1 ve 0,5'i DEĞİL:
     Import onları varsayılan olarak `rot`un o anki değeriyle okuyor
     (`GetFastFloat("wave_r", m_fRot.eval(-1), f)`, state.cpp:1389-1393;
     BeatDrop'un D3D9 hâli 1368-1372 aynı) ve `rot` henüz okunmadığı için
     o değer Default'un 0'ı. Yani bu anahtarları yazmayan bir dosyanın
     dalgası MilkDrop'ta siyah ve köşede. Korpusta hiçbir dosya onları
     atlamıyor, yerleşiklerimiz ve üreticimiz de yazıyor (#580).

     Uyum açıkken bu tablo, kapalıyken eski taban geçerli. */
  const MD2_PF_DEFAULTS = {
    zoom: 1, zoomexp: 1, rot: 0, warp: 1, cx: 0.5, cy: 0.5, dx: 0, dy: 0, sx: 1, sy: 1,
    decay: 0.98, wave_a: 0.8, wave_r: 0, wave_g: 0, wave_b: 0, wave_x: 0, wave_y: 0,
    wave_mystery: 0, wave_mode: 0,
    ob_size: 0.01, ob_r: 0, ob_g: 0, ob_b: 0, ob_a: 0,
    ib_size: 0.01, ib_r: 0.25, ib_g: 0.25, ib_b: 0.25, ib_a: 0,
    mv_x: 12, mv_y: 9, mv_dx: 0, mv_dy: 0, mv_l: 0.9, mv_r: 1, mv_g: 1, mv_b: 1, mv_a: 0,
    echo_zoom: 2, echo_alpha: 0, echo_orient: 0,
    wave_usedots: 0, wave_thick: 0, wave_additive: 0, wave_brighten: 1,
    darken_center: 0, gamma: 2, wrap: 1, invert: 0, brighten: 0, darken: 0, solarize: 0,
    b1n: 0, b1x: 1, b2n: 0, b2x: 1, b3n: 0, b3x: 1, b1ed: 0.25,
  };

  const NUM_Q = 32;

  /* t1..t8 — DALGA VE ŞEKİL BLOKLARININ KENDİ ARA DEĞİŞKENLERİ.

     q1..q32 için düzelttiğimiz hatanın (bkz. PF_RESET) bir kat aşağıdaki
     eşi. MilkDrop her karede, dalganın/şeklin `per_frame` bloğunu
     koşturmadan HEMEN ÖNCE t1..t8'i `per_init`in bıraktığı değere geri
     yazıyor:

         for (int vi = 0; vi < NUM_T_VAR; vi++)
             *var_pf_t[vi] = m_wave[i].t_values_after_init_code[vi];

     (milkdropfs.cpp:2331 dalga için, 2288 şekil için.)

     Biz taşımaya devam ediyorduk. Fark yalnızca kendi kendine biriken
     yazımlarda görünüyor — `t3 = t3 + 0.01` gibi — ve orada büyük: değer
     her karede bir öncekinin üstüne binerek sınırsız büyüyor, MilkDrop'ta
     ise her kare aynı yerden başlıyor. Korpusta 1.805 preset (%17,4) dalga
     bloğunda, 1.139'u (%11,0) şekil bloğunda t yazıyor; 149'u (%1,4)
     birikmeli yazıyor.

     ŞEKİLLERDE ÖRNEK BAŞINA sıfırlanıyor, kare başına değil: MilkDrop
     yükleyiciyi `instance` parametresiyle her örnek için ayrı çağırıyor
     (milkdropfs.cpp:2150). Yani bir örnek bir öncekinin ara değerini
     devralmıyor.

     per_point tarafı ayrıca sıfırlanmıyor ve sıfırlanmamalı: MilkDrop
     `var_pp_t`yi kare başına BİR KEZ `var_pf_t`den tohumluyor (2421), yani
     t noktalar boyunca birikiyor. Bizde ikisi zaten aynı havuz, dolayısıyla
     bu davranış kendiliğinden doğru — yalnızca kareler arası sızıntıyı
     kapatmak gerekiyordu. */
  const NUM_T = 8;
  const T_NAMES = ['t1', 't2', 't3', 't4', 't5', 't6', 't7', 't8'];
  const captureT = (pool) => {
    const out = new Array(NUM_T);
    for (let i = 0; i < NUM_T; i++) out[i] = pool.get(T_NAMES[i]) || 0;
    return out;
  };
  const restoreT = (pool, base) => {
    if (!base) return;
    for (let i = 0; i < NUM_T; i++) pool.set(T_NAMES[i], base[i]);
  };

  /* ALT BLOKLARA (özel dalga ve şekil) kare başına taşınan girdiler.

     MilkDrop 2'de her dalganın ve şeklin KENDİ sanal makinesi var ve oraya
     yalnız kaydedilen adlar giriyor (state.cpp:405-500): zaman, kare, fps,
     ilerleme, üç bant ve üç ortalama — artı bloğun kendi değişkenleri ile
     q1..q32. `vol`, `vol_att`, `meshx/meshy`, `aspectx/aspecty` ve
     `pixelsx/pixelsy` orada KAYITLI DEĞİL: bir dalga bunları okursa kendi
     makinesindeki değeri görür — atamadıysa 0, atadıysa kareler arası
     kendi değerini.

     Motor bunları ana kare havuzundan her karede kopyalıyordu. Metin
     taraması bir dalga ya da şekilde `vol`'ü atamadan okuyan 47 preset
     sayıyor, ama okuma ile atamanın sırasını bilmiyor. Korpusun tamamı bu
     denklem makinesiyle anahtar açık ve kapalı koşturulup dalga ve şekil
     çıktıları kare kare karşılaştırıldığında GERÇEKTEN değişen 19 preset
     (%0,18) kalıyor ve hepsinde sebep aynı: kare denklemleri `vol`'ü kendi
     değişkeni olarak atıyor (`vol = (bass+mid+treb)*0.55`), şekil onu
     atamadan okuyor (`rad = sin(bass+vol)`). MilkDrop'ta şekil kendi
     makinesindeki 0'ı görüyor, bizde kare denklemlerinin değerini
     görüyordu. Diğer adların korpusta alt bloklarda görünür etkisi yok.
     Uyum kapalıyken eski davranış: SHARED_LEGACY de taşınıyor. */
  const SHARED_VARS = [
    'time', 'frame', 'fps', 'progress',
    'bass', 'mid', 'treb', 'bass_att', 'mid_att', 'treb_att',
    /* Fare bizim eklentimiz — MilkDrop 2'de fare yok, dolayısıyla uyulacak
       bir davranış da yok. Alt bloklara taşınıyor ki fareyle çizen bir
       dalga yazılabilsin. */
    'mouse_x', 'mouse_y', 'mouse_down',
  ];
  const SHARED_LEGACY = ['vol', 'vol_att', 'meshx', 'meshy', 'aspectx', 'aspecty', 'pixelsx', 'pixelsy'];

  class Preset {
    constructor(text, opts) {
      const o = opts || {};
      this.file = parseMilk(text);
      this.pool = new Pool();
      this.errors = [];
      this.name = o.name || this.file.params.psetname || '';
      /* "MilkDrop uyumu" anahtarı. Görselleştirici her kare kendi ayarını
         buraya yazıyor; alt blokların hangi kare değişkenlerini gördüğünü
         seçiyor (bkz. SHARED_LEGACY). */
      this.accurate = o.accurate !== false;

      /* MilkDrop varsayılanları. Dosya bunları belirtmeyebilir ve havuzun
         doğal başlangıcı 0; kırpma sonrası 0 SİYAH demek olurdu. MilkDrop'ta
         belirtilmemiş dalga rengi beyazdır. */
      this.pool.set('wave_r', 1);
      this.pool.set('wave_g', 1);
      this.pool.set('wave_b', 1);
      this.pool.set('wave_a', 1);
      /* Dalganın EKRANDAKİ YERİ. Havuzun doğal başlangıcı 0 ve 0, MilkDrop'ta
         sol/alt kenar demek: dalga ekranın dışına kayardı. MilkDrop'un
         varsayılanı ortadır. */
      this.pool.set('wave_x', 0.5);
      this.pool.set('wave_y', 0.5);
      this.pool.set('wave_brighten', 1);
      this.pool.set('wave_scale', 1);
      /* Hareket vektörleri. Uzunluk çarpanı belirtilmezse 1: MilkDrop'un
         varsayılanı da bu ve 0 kalsaydı vektörler sıfır uzunlukta çizilip
         hiç görünmezdi. Renk beyaz, alfa 0 — yani preset açıkça istemedikçe
         görünmüyorlar, MilkDrop'ta olduğu gibi. */
      this.pool.set('mv_l', 1);
      this.pool.set('mv_r', 1);
      this.pool.set('mv_g', 1);
      this.pool.set('mv_b', 1);
      this.pool.set('mv_a', 0);
      this.pool.set('mv_x', 16);
      this.pool.set('mv_y', 12);
      /* Blur ölçekleri. MilkDrop'un varsayılanı 0 ve 1; havuzun doğal
         başlangıcı ikisi için de 0 ve `b1x = 0` demek "bulanık kopyayı
         sıfırla çarp", yani presetin shader'ında GetBlur okuyan her satır
         siyaha düşer. Yazmayan preset varsayılanı görmeli. */
      for (const b of ['b1', 'b2', 'b3']) {
        this.pool.set(b + 'n', 0);
        this.pool.set(b + 'x', 1);
      }
      /* KENAR KARARTMA. MilkDrop'un varsayılanı 0,25 ve korpusta 1.544
         preset (%14,9) bu anahtarı hiç yazmıyor — havuzun doğal
         başlangıcı 0 olsaydı o presetlerde karartma hiç olmazdı, oysa
         yazarları varsayılanı görüyordu. */
      this.pool.set('b1ed', 0.25);
      // MilkDrop'un varsayılanı sarma AÇIK
      this.pool.set('wrap', 1);
      // Presetin sabit parametreleri havuza başlangıç değeri olarak girer
      for (const k in this.file.params) {
        const v = this.file.params[k];
        if (typeof v === 'number') this.pool.set(k, v);
      }

      /* Dosya adları ile DENKLEM adları farklı: preset başlığında `nWaveMode`
         yazıyor ama per_frame içinde aynı şey `wave_mode` diye okunuyor ve
         yazılıyor. Eşlemeyi kurmazsak dosyadaki dalga biçimi, kalınlığı ve
         toplamalı çizim ayarı motora hiç ulaşmıyor — hepsi sıfır kalıyor,
         yani her preset aynı ince tek çizgiyi çiziyor. */
      for (const [from, to] of PARAM_ALIAS) {
        const v = this.file.params[from];
        if (typeof v === 'number') this.pool.set(to, v);
      }

      /* bMotionVectorsOn ESKİ presetler için bir uyumluluk anahtarı, ayrı bir
         çalışma zamanı bayrağı değil: MilkDrop onu yükleme anında `mv_a`ya
         çeviriyor (0 ise 0, değilse 1) ve dosyada ayrıca `mv_a` varsa o
         eziyor. Motor onu `mv_on` diye ayrı bir ada koyuyor ve kimse
         okumuyordu.

         Korpusta 86 preset taşıyor ve HİÇBİRİNDE `mv_a` yok — yani o 86'sı
         için tek kaynak bu. 82'si kapalı (bizim 0 varsayılanımızla zaten
         doğruydu), 4'ü AÇIK ve onlarda hareket vektörleri hiç çizilmiyordu.

         Sıra önemli: dosyanın kendi `mv_a`sı varsa ona dokunulmuyor. */
      if (typeof this.file.params.bmotionvectorson === 'number'
        && typeof this.file.params.mv_a !== 'number') {
        this.pool.set('mv_a', this.file.params.bmotionvectorson === 0 ? 0 : 1);
      }

      /* Döngü bütçesi bloğun KAÇ KEZ koştuğuna göre veriliyor: init bir kez,
         per_frame saniyede 60 kez, per_pixel ise ağın 1271 düğümünde yani
         saniyede ~76 bin kez. Tek bir sabit bütçe ya init'i boğardı ya da
         per_pixel'de uygulamayı dondururdu. */
      this.cInit = compile(this.file.init, this.pool, { seed: o.seed, loopBudget: 1048576 });
      this.cFrame = compile(this.file.perFrame, this.pool, { seed: o.seed, loopBudget: 65536 });
      this.cPixel = compile(this.file.perPixel, this.pool, { seed: o.seed, loopBudget: 1024 });
      for (const c of [this.cInit, this.cFrame, this.cPixel]) {
        if (c.error) this.errors.push(c.error);
      }
      this.initialised = false;

      /* Sifirlama tabani: havuz dosyadan ve varsayilanlardan doldurulduktan
         SONRA, init kosmadan once alINIyor. MilkDrop'ta da init'in bu adlara
         yazdigi sey ilk karede zaten uzerine yaziliyor. */
      this._pfBase = {};
      for (const k of PF_RESET) this._pfBase[k] = this.pool.get(k);
      /* Uyum açıkken taban: dosyanın yazdığı değer, yazmadığı adda
         MilkDrop'un varsayılanı. Dosya bir adı ya kendi adıyla ya da
         başlık adıyla (PARAM_ALIAS) yazıyor; `mv_a`yı `bMotionVectorsOn`
         de veriyor. */
      const fromFile = new Set();
      for (const k of PF_RESET) if (typeof this.file.params[k] === 'number') fromFile.add(k);
      for (const [from, to] of PARAM_ALIAS) if (typeof this.file.params[from] === 'number') fromFile.add(to);
      if (typeof this.file.params.bmotionvectorson === 'number') fromFile.add('mv_a');
      this._pfBaseMd2 = {};
      for (const k of PF_RESET) {
        this._pfBaseMd2[k] = fromFile.has(k) || !(k in MD2_PF_DEFAULTS) ? this._pfBase[k] : MD2_PF_DEFAULTS[k];
      }
      this._qInit = null;

      /* Custom dalgalar ve şekiller. Referans preset paketinde şekillerin
         %48'i, dalgaların %32'si kullanılıyor: motorun bunları çizmemesi,
         o presetlerin ekranda bambaşka görünmesinin en büyük tek sebebiydi.
         Ayrıştırıcı blokları zaten çıkarıyordu, derleyen kimse yoktu. */
      this.waves = this._collect('wavecode', this.file.waves).map((w) => this._buildWave(w, o));
      this.shapes = this._collect('shapecode', this.file.shapes).map((s) => this._buildShape(s, o));
    }

    /* Blok numaralarını DENKLEMLERDEN ve PARAMETRELERDEN birlikte toplar.

       Yalnızca denklem bloklarına bakmak yetmiyor: bir şekil tamamen
       `shapecode_0_*` parametreleriyle tanımlanabiliyor ve tek bir denklem
       satırı taşımayabiliyor. MilkDrop onu yine çiziyor — sabit bir çokgen
       olarak. Denklemden türetmek bu şekilleri tümden düşürüyordu. */
    _collect(prefix, blocks) {
      const byIdx = new Map();
      for (const b of (blocks || [])) byIdx.set(b.index || 0, b);
      const re = new RegExp('^' + prefix + '_(\\d+)_');
      for (const k in this.file.params) {
        const m = re.exec(k);
        if (!m) continue;
        const i = +m[1];
        if (!byIdx.has(i)) byIdx.set(i, { index: i });
      }
      return Array.from(byIdx.keys()).sort((a, b) => a - b).map((i) => byIdx.get(i));
    }

    /* Blok parametrelerini okumak için: `wavecode_2_r` gibi adlar presetin
       düz parametre sözlüğünde duruyor. */
    _sub(prefix, idx, name, dflt) {
      const v = this.file.params[prefix + '_' + idx + '_' + name];
      return typeof v === 'number' ? v : dflt;
    }

    _buildWave(w, o) {
      const i = w.index || 0;
      const g = (n, d) => this._sub('wavecode', i, n, d);
      const pool = new Pool();
      const wave = {
        index: i,
        enabled: g('enabled', 0) !== 0,
        // MilkDrop 512 örnekle sınırlı; daha fazlası ne dosyada var ne anlamlı
        samples: Math.max(2, Math.min(512, Math.round(g('samples', 512)))),
        sep: Math.max(0, Math.round(g('sep', 0))),
        spectrum: g('bspectrum', 0) !== 0,
        useDots: g('busedots', 0) !== 0,
        thick: g('bdrawthick', 0) !== 0,
        additive: g('badditive', 0) !== 0,
        scaling: g('scaling', 1),
        smoothing: g('smoothing', 0.5),
        r: g('r', 1), g: g('g', 1), b: g('b', 1), a: g('a', 1),
        pool,
        initialised: false,
      };
      /* per_point saniyede samples×60 kez koşuyor; bütçe per_pixel'inkiyle
         aynı mantıkta, blok başına veriliyor. */
      wave.cInit = compile(w.init || '', pool, { seed: o.seed, loopBudget: 65536 });
      wave.cFrame = compile(w.per_frame || '', pool, { seed: o.seed, loopBudget: 65536 });
      wave.cPoint = compile(w.per_point || '', pool, { seed: o.seed, loopBudget: 1024 });
      for (const c of [wave.cInit, wave.cFrame, wave.cPoint]) {
        if (c.error) this.errors.push('wave ' + i + ': ' + c.error);
      }
      return wave;
    }

    _buildShape(s, o) {
      const i = s.index || 0;
      const g = (n, d) => this._sub('shapecode', i, n, d);
      const pool = new Pool();
      const shape = {
        index: i,
        enabled: g('enabled', 0) !== 0,
        // MilkDrop kenar sayısını 3..100 arasında tutuyor
        sides: Math.max(3, Math.min(100, Math.round(g('sides', 4)))),
        additive: g('additive', 0) !== 0,
        thickOutline: g('thickoutline', 0) !== 0,
        textured: g('textured', 0) !== 0,
        instances: Math.max(1, Math.min(1024, Math.round(g('num_inst', 1)))),
        base: {
          x: g('x', 0.5), y: g('y', 0.5), rad: g('rad', 0.1), ang: g('ang', 0),
          tex_ang: g('tex_ang', 0), tex_zoom: g('tex_zoom', 1),
          r: g('r', 1), g: g('g', 1), b: g('b', 1), a: g('a', 1),
          r2: g('r2', 0), g2: g('g2', 0), b2: g('b2', 0), a2: g('a2', 0),
          border_r: g('border_r', 1), border_g: g('border_g', 1),
          border_b: g('border_b', 1), border_a: g('border_a', 0.1),
          /* `thick` KENARLIĞIN KALINLIĞI ve MilkDrop'ta GİRDİ-ÇIKTI:
             state.cpp:496 onu `var_pf_thick ... // i/o` diye kaydediyor,
             yani şeklin per_frame kodu da yazabiliyor (korpusta 15 preset
             yazıyor). Dosyadaki `thickOutline` yalnız BAŞLANGIÇ değeri.

             `base` içinde durmasının sebebi bu: shapeFrame base'i havuza
             yazıp per_frame'den sonra geri okuyor, yani girdi-çıktı
             davranışı buradan bedavaya geliyor. Başlıkta bırakmak 15
             preseti yanlış çizerdi. */
          thick: g('thickoutline', 0) !== 0 ? 1 : 0,
          /* `sides`, `textured` ve `additive` de GİRDİ-ÇIKTI (state.cpp:
             491, 492, 495). Dosyadaki değer yalnız başlangıç; şeklin
             per_frame kodu kenar sayısını, dokulu olup olmadığını ve
             toplamalı çizimi kare kare değiştirebiliyor. Korpusta 53
             preset `additive`, 8 preset `textured`, 4 preset `sides`
             yazıyor. Ham sayı olarak duruyorlar: kenetleme ve tam sayıya
             çevirme MilkDrop'ta per_frame'den SONRA. */
          sides: g('sides', 4),
          textured: g('textured', 0),
          additive: g('additive', 0),
        },
        pool,
        initialised: false,
      };
      /* MilkDrop'un şekil renkleri, dosya yazmamışsa (state.cpp:619-626):
         iç renk KIRMIZI (1,0,0), dış renk YEŞİL ve saydam (0,1,0,0).
         Eski tabanımız beyaz ve siyahtı. Fark yalnız dosyanın atladığı
         renklerde — korpustaki 15.982 açık şeklin hiçbiri atlamıyor. Uyum
         açıkken bu taban geçerli (shapeFrame; #580). */
      shape.baseMd2 = Object.assign({}, shape.base, { g: g('g', 0), b: g('b', 0), g2: g('g2', 1) });
      shape.cInit = compile(s.init || '', pool, { seed: o.seed, loopBudget: 65536 });
      shape.cFrame = compile(s.per_frame || '', pool, { seed: o.seed, loopBudget: 65536 });
      for (const c of [shape.cInit, shape.cFrame]) {
        if (c.error) this.errors.push('shape ' + i + ': ' + c.error);
      }
      return shape;
    }

    /* Ana havuzdaki kare geneli girdileri alt bloğun havuzuna taşır.

       NEDEN AYRI HAVUZ: MilkDrop'ta her dalganın ve şeklin kendi t1..t8'i
       var; tek havuz kullanmak iki dalganın birbirinin ara değişkenini
       ezmesine yol açardı. NEDEN KOPYALAMA: presetler dalgayı q
       değişkenleri ve ses girdileriyle sürüyor, o yüzden bunlar paylaşılmalı. */
    _shareInto(pool) {
      const P = this.pool;
      for (const k of SHARED_VARS) pool.set(k, P.get(k));
      if (this.accurate === false) for (const k of SHARED_LEGACY) pool.set(k, P.get(k));
      // Uyum açıkken per_frame'in bıraktığı q; kapalıyken havuzun o anki hâli
      const q = this.accurate !== false ? this._qFrame : null;
      for (let i = 1; i <= 32; i++) pool.set('q' + i, q ? q[i - 1] : P.get('q' + i));
    }

    // Bir custom dalganın kare denklemlerini koşturur. false: çizilmeyecek.
    waveFrame(w) {
      if (!w || !w.enabled) return false;
      const P = w.pool;
      this._shareInto(P);
      P.set('r', w.r); P.set('g', w.g); P.set('b', w.b); P.set('a', w.a);
      /* `samples` de her karede dosyadaki değere dönüyor
         (milkdropfs.cpp:2338). Yazılabilir bir giriş: preset per_frame'de
         nokta sayısını sesle oynatabiliyor, ama başlangıcı hep dosya. */
      P.set('samples', w.samples);
      if (!w.initialised) {
        w.cInit.run(P.values);
        w.initialised = true;
        w._tInit = captureT(P);
      }
      restoreT(P, w._tInit);
      w.cFrame.run(P.values);
      /* NOKTA SAYISI per_frame'den SONRA okunuyor. MilkDrop:
             nSamples = (int)*var_pf_samples;
             nSamples = std::min(512, nSamples);
         (milkdropfs.cpp:2424). Öncesinde okumak presetin yazdığı değeri
         görmezden gelirdi; korpusta 196 preset (%1,9) bunu yazıyor.

         Alt sınır KIRPILMIYOR, çizim aşamasında eleniyor — MilkDrop da
         öyle: `nSamples >= 2`, nokta kipinde `>= 1`. Burada 2'ye
         yuvarlamak "hiç çizme" diyen bir preseti çizdirirdi. */
      const n = Math.floor(P.get('samples'));
      w.frameSamples = isFinite(n) ? Math.min(512, Math.max(0, n)) : 0;
      /* Noktaların rengi HER NOKTADA bu değerlerden başlıyor
         (milkdropfs.cpp:2475-2478). Kare denklemleri koştuktan sonra
         alınıyor: dalganın o karedeki rengi bu. */
      w._ppColor = { r: P.get('r'), g: P.get('g'), b: P.get('b'), a: P.get('a') };
      return true;
    }

    /* Dalganın tek bir noktası. sample 0..1; value1/value2 sol ve sağ kanal.
       `out` her çağrıda YENİDEN KULLANILIYOR: 512 nokta için kare başına
       512 nesne ayırmak kabul edilemezdi. */
    wavePoint(w, sample, v1, v2, out) {
      const P = w.pool;
      P.set('sample', sample);
      P.set('value1', v1);
      P.set('value2', v2);
      /* HER NOKTA kendi tohumundan başlıyor (milkdropfs.cpp:2470-2478):
         x ve y dalganın kendi örneğinden (`0,5 + value`), renk de dalganın
         o karedeki renginden. Motor x'i örneğin sırasına, y'yi 0,5'e
         kuruyordu ve rengi hiç tohumlamıyordu:
           • x ya da y yazmayan bir blok (korpusta 63 ve 98 blok, 58 ve 84
             preset) dalga biçimi yerine düz bir çizgi ya da rampa
             görüyordu;
           • rengi kendi değerinden türeten bir blok (`a = a * 0,9` gibi;
             4.371 blok, 1.811 preset, %17,5) noktalar boyunca BİRİKİYORDU
             — MilkDrop'ta her nokta aynı renkten başlıyor.
         Uyum kapalıyken eski tohumlar duruyor. */
      const acc = this.accurate !== false;
      P.set('x', acc ? 0.5 + v1 : sample);
      P.set('y', acc ? 0.5 + v2 : 0.5);
      if (acc && w._ppColor) {
        P.set('r', w._ppColor.r); P.set('g', w._ppColor.g);
        P.set('b', w._ppColor.b); P.set('a', w._ppColor.a);
      }
      w.cPoint.run(P.values);
      const o = out || {};
      o.x = P.get('x'); o.y = P.get('y');
      o.r = P.get('r'); o.g = P.get('g'); o.b = P.get('b'); o.a = P.get('a');
      return o;
    }

    /* Bir şeklin tek örneğinin kare denklemleri. MilkDrop num_inst kez
       koşturuyor ve her koşuda `instance` değişiyor; şekiller bu sayede
       tek blokla bir halka ya da ızgara kurabiliyor. */
    shapeFrame(s, instance, out) {
      if (!s || !s.enabled) return null;
      const P = s.pool;
      this._shareInto(P);
      const b = this.accurate !== false && s.baseMd2 ? s.baseMd2 : s.base;
      for (const k in b) P.set(k, b[k]);
      P.set('instance', instance);
      P.set('num_inst', s.instances);
      if (!s.initialised) {
        s.cInit.run(P.values);
        s.initialised = true;
        s._tInit = captureT(P);
      }
      restoreT(P, s._tInit);
      s.cFrame.run(P.values);
      const o = out || {};
      for (const k in b) o[k] = P.get(k);
      return o;
    }

    // Havuzdaki değişkenlere kısayol
    get(name) { return this.pool.get(name); }
    set(name, v) { this.pool.set(name, v); }

    /* Kare başına: girdi değişkenlerini yaz, init'i (bir kez) ve per_frame'i
       koştur. inputs: { time, fps, frame, bass, mid, treb, bass_att, ... } */
    frame(inputs) {
      const P = this.pool;
      if (inputs) for (const k in inputs) P.set(k, inputs[k]);
      const base = this.accurate ? this._pfBaseMd2 : this._pfBase;
      if (!this.initialised) {
        /* MilkDrop init'i koşturmadan önce de yerleşik adları yüklüyor
           (state.cpp RecompileExpressions: LoadPerFrameEvallibVars, sonra
           init): init MilkDrop'un varsayılanlarını görmeli. */
        if (this.accurate) for (const k of PF_RESET) P.set(k, base[k]);
        this.cInit.run(P.values);
        this.initialised = true;
        /* q'larin "init sonrasi" degeri: her karenin basladigi nokta.
           MilkDrop init kodunu preset yuklenirken bir kez kosturup
           q1..q32'yi tam burada saklıyor. */
        this._qInit = new Array(NUM_Q);
        for (let i = 0; i < NUM_Q; i++) this._qInit[i] = P.get('q' + (i + 1)) || 0;
      }
      /* Yerlesik kare degiskenleri her karede dosyadaki degere donuyor —
         ilk kare dahil, cunku MilkDrop init'ten sonra da yeniden yukluyor.
         Ayrintili gerekce PF_RESET'in yaninda. */
      for (const k of PF_RESET) P.set(k, base[k]);
      if (this._qInit) for (let i = 0; i < NUM_Q; i++) P.set('q' + (i + 1), this._qInit[i]);
      this.cFrame.run(P.values);
      /* q'ların KARE değeri, per_pixel koşmadan önce. MilkDrop per_frame
         bittiğinde q1..q32'yi ayrı bir yuva takımına kopyalıyor
         (milkdropfs.cpp:649-650) ve per_vertex kodu o kopyayı yazıyor;
         dalgalar ve şekiller ise per_frame'in bıraktığını okuyor
         (plugin.cpp:2317 ve şeklin eşi). Bizde tek havuz var: ağ
         düğümlerinde q yazan 155 preset (%1,5) aynı karede çizilen
         dalgalara ve şekillere düğümlerin bıraktığı değeri geçiriyordu. */
      if (!this._qFrame) this._qFrame = new Array(NUM_Q);
      for (let i = 0; i < NUM_Q; i++) this._qFrame[i] = P.get('q' + (i + 1));
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
      /* Merkez 0 GEÇERLİ bir değer: dönmenin ve germenin merkezi köşede.
         `|| 0,5` onu ortaya taşıyordu; korpusta 84 preset başlıkta cx ya da
         cy 0 yazıyor (#580). Uyum açıkken varsayılan zaten tabandan geliyor
         (MD2_PF_DEFAULTS), yani 0 yalnız yazılmış 0. zoom, sx ve sy'de 0
         MilkDrop'ta da sıfıra bölme — onlarda koruma kalıyor. */
      const acc = this.accurate;
      this._base = {
        zoom: P.get('zoom') || 1,
        zoomexp: P.get('zoomexp') || 1,
        rot: P.get('rot'),
        warp: P.get('warp'),
        cx: acc ? P.get('cx') : (P.get('cx') || 0.5),
        cy: acc ? P.get('cy') : (P.get('cy') || 0.5),
        dx: P.get('dx'),
        dy: P.get('dy'),
        sx: P.get('sx') || 1,
        sy: P.get('sy') || 1,
      };
      return this._base;
    }
  }

  /* Renk kanalını çizilebilir aralığa indirger.

     Ayrı bir işlev, çünkü kuralı MilkDrop koyuyor, çizici değil — ve burada
     iki kez hata yapıldı: `v || 1` geçerli bir SIFIRI "belirtilmemiş" sanıp
     1'e çeviriyordu (sarı bir preset beyaz çıkıyordu), üst sınır ise hiç
     yoktu (13 gibi bir değer beyaza doyuyordu). İkisi de yalnız ekrana
     bakınca görülür; bu yüzden kural test edilebilir bir yerde duruyor. */
  function clampColor(v) {
    if (typeof v !== 'number' || !isFinite(v)) return 1;
    return v < 0 ? 0 : v > 1 ? 1 : v;
  }

  /* MilkDrop'un TEPE RENGİ dönüşümü — `COLOR_NORM` (milkdropfs.cpp:37):

         #define COLOR_NORM(x) (((int)(x * 255) & 0xFF) / 255.0f)

     KENETLEMİYOR, 256'ya göre SARIYOR. Denklemi 1,5 üreten bir preset
     MilkDrop'ta 0,494 çiziyor, 1,0 değil; 2,0 üreten 0,996 çiziyor.
     Negatifler de sarıyor: `(int)` sıfıra doğru kırpıyor ve `& 0xFF` iki
     tümleyen sonucu veriyor, yani −0,5 → 0,506.

     Motor kenetliyordu. Fark yalnızca [0,1) dışına çıkan değerlerde ama
     orada büyük: taşan bir renk MilkDrop'ta BAŞKA BİR RENGE dönüyor,
     bizde beyaza gidiyordu. Ölçüldü — 10.347 presetin 3.818'i (%36,9)
     en az bir kez kenetlemeden anlamlı biçimde farklı bir değer üretiyor,
     2.055'i (%19,9) 1,4'ün üstüne çıkıyor.

     `(int)` yerine `Math.trunc`: JavaScript'te `|0` da sıfıra doğru
     kırpıyor ama 2^31'i aşan girdilerde sarıyor, `Math.trunc` ise
     aşmıyor — sonra `& 0xFF` zaten daraltıyor.

     NEREYE UYGULANIR: MilkDrop'un tepe rengi yazdığı her yer — şekil
     dolgusu ve kenar çizgisi, özel dalga, varsayılan dalga, hareket
     vektörleri ve `decay`. Shader'ların ürettiği renge UYGULANMAZ; onlar
     8 bitlik tepe rengi yolundan geçmiyor. */
  function colorNorm(v) {
    if (typeof v !== 'number' || !isFinite(v)) return 1;
    return ((Math.trunc(v * 255) & 0xFF)) / 255;
  }

  // ==========================================================================
  // MilkDrop 2'nin aşama seçimi ve sabit yol ayrıntıları (#580)
  // ==========================================================================
  /* Birincil kaynak: jecassis/foo_vis_milk2 5b44cea (Nullsoft'un kodu),
     sabit yol için BeatDrop 53d83ee'deki D3D9 hâliyle de karşılaştırıldı.
     Buradakiler kaynaktan öğrenilen KURALLAR; kod bizim.

     AŞAMA SÜRÜMDEN SEÇİLİYOR, METİNDEN DEĞİL (state.cpp:1328-1348,
     milkdropfs.cpp:921-924). MilkDrop bir aşamanın shader'ını ancak o
     aşamanın sürümü sıfırdan büyükse kullanıyor:
       MILKDROP_PRESET_VERSION yok ya da 200'den küçük -> ikisi de 0
       tam 200 -> PSVERSION (yoksa 2) ikisine de
       201 ve üstü -> PSVERSION_WARP / PSVERSION_COMP (yoksa 2)
     Sürümü 0 olan aşamanın metni varsa bile okunmuyor, sabit yol çiziyor.
     Sürümü sıfırdan büyük ama metni olmayan aşama için MilkDrop YÜKLEMEDE
     bir shader yazıyor ve dosyadaki değerleri içine GÖMÜYOR: o presette
     kare denklemlerinin gama, yankı ve bayraklara yazdıkları yok sayılıyor.
     Tam sayılar `sscanf("%d")` ile okunuyor: kesirli bir değer aşağı
     kırpılıyor. */
  function md2Versions(params) {
    const p = params || {};
    const int = (v, d) => (typeof v === 'number' && isFinite(v) ? Math.trunc(v) : d);
    const pv = int(p.milkdrop_preset_version, 100);
    if (pv < 200) return { preset: pv, warp: 0, comp: 0 };
    if (pv === 200) {
      const v = int(p.psversion, 2);
      return { preset: pv, warp: v, comp: v };
    }
    return { preset: pv, warp: int(p.psversion_warp, 2), comp: int(p.psversion_comp, 2) };
  }

  /* Aşama başına yol: 'shader' (presetin metni), 'generated' (MilkDrop'un
     yüklemede yazdığı, değerleri gömülü shader) ya da 'fixed' (shader'sız
     sabit yol). `file` parseMilk çıktısı. */
  function stagePlan(file) {
    const f = file || {};
    const v = md2Versions(f.params);
    const pick = (ver, text) => (ver > 0 ? (String(text || '').trim() ? 'shader' : 'generated') : 'fixed');
    return { warp: pick(v.warp, f.warpShader), comp: pick(v.comp, f.compShader), versions: v };
  }

  /* Gömülü değerler dosyadan, MilkDrop'un varsayılanlarıyla
     (state.cpp CState::Default): decay 0,98, gama 2,0, yankı yakınlaşması
     2,0, yankı saydamlığı 0, yön 0, doku sarma açık. Kayan sayılar 32 bit
     okunuyor (`%f` bir float'a); yuvarlamadan önce Math.fround — 0,975
     float'ta 0,97500002 ve "%.2f" onu 0,98 yazıyor, double 0,97. */
  const f32 = (v, d) => Math.fround(typeof v === 'number' && isFinite(v) ? v : d);
  const i32 = (v, d) => (typeof v === 'number' && isFinite(v) ? Math.trunc(v) : d);

  // Sürümü olup metni olmayan warp aşaması (plugin.cpp GenWarpPShaderText)
  function genWarpText(params) {
    const p = params || {};
    const wrap = i32(p.btexwrap, 1) !== 0;
    return [
      'shader_body',
      '{',
      '    ret = tex2D(' + (wrap ? 'sampler_main' : 'sampler_fc_main') + ', uv).xyz;',
      '    ret *= ' + f32(p.fdecay, 0.98).toFixed(2) + ';',
      '}',
    ].join('\n');
  }

  /* Sürümü olup metni olmayan birleştirme aşaması (plugin.cpp
     GenCompPShaderText). Sıra: yankı ya da düz örnek, gama çarpanı, ton,
     sonra dört bayrak — shader'daki biçimleriyle: karekök, kare,
     4c(1-c), 1-c. Yön burada `% 4` görmüyor: 5 iki ekseni de çeviriyor. */
  function genCompText(params) {
    const p = params || {};
    const alpha = f32(p.fvideoechoalpha, 0);
    const zoom = f32(p.fvideoechozoom, 2);
    const orient = i32(p.nvideoechoorientation, 0);
    const gamma = f32(p.fgammaadj, 2).toFixed(2);
    const hue = f32(p.fshader, 0);
    const on = (k) => i32(p[k], 0) !== 0;
    const out = ['shader_body', '{'];
    if (alpha > 0.001) {
      const ox = orient % 2 !== 0 ? -1 : 1;
      const oy = orient >= 2 ? -1 : 1;
      out.push('    float2 uv_echo = (uv - 0.5)*' + Math.fround(1 / zoom).toFixed(3) + '*float2(' + ox + ',' + oy + ') + 0.5;');
      out.push('    ret = lerp(tex2D(sampler_main, uv).xyz, tex2D(sampler_main, uv_echo).xyz, ' + alpha.toFixed(2) + ');');
    } else {
      out.push('    ret = tex2D(sampler_main, uv).xyz;');
    }
    out.push('    ret *= ' + gamma + ';');
    if (hue >= 1) out.push('    ret *= hue_shader;');
    else if (hue > 0.001) out.push('    ret *= ' + Math.fround(1 - hue).toFixed(2) + ' + ' + hue.toFixed(2) + '*hue_shader;');
    if (on('bbrighten')) out.push('    ret = sqrt(ret);');
    if (on('bdarken')) out.push('    ret *= ret;');
    if (on('bsolarize')) out.push('    ret = ret*(1-ret)*4;');
    if (on('binvert')) out.push('    ret = 1 - ret;');
    out.push('}');
    return out.join('\n');
  }

  /* Sabit yolun yankı yönü (milkdropfs.cpp:3888, BeatDrop 4066):
     `(int)echo_orient % 4` — C'de sıfıra doğru kırpılıyor ve kalan
     bölünenin işaretini alıyor; x ekseni `% 2` sıfır değilse, y ekseni
     değer 2 ya da üstüyse çevriliyor. Yani -1 x'i çeviriyor, 5 de 1 gibi.
     Dönüş: 1 = x, 2 = y, 3 = ikisi. */
  function echoFlipBits(v) {
    const o = Math.trunc(Number(v) || 0) % 4;
    return (o % 2 !== 0 ? 1 : 0) | (o >= 2 ? 2 : 0);
  }

  /* SABİT BİRLEŞTİRMENİN KÖŞE AĞIRLIKLARI (#580; milkdropfs.cpp:3907-4003,
     BeatDrop'un D3D9 hâli 4090-4180 aynı).

     MilkDrop sabit yolda görüntüyü dokulu bir dörtgenle BİRKAÇ KEZ
     çiziyor: ilki yazıyor, gerisi üstüne ekliyor. Her çizimin köşe rengi
     (o çizimin gaması) × (katmanın payı) × (ton rengi) ve tepe rengi
     yolundan, yani COLOR_NORM'dan geçiyor: bayta kırpılıyor, 1'i aşan ya
     da eksiye düşen değer SARIYOR. Ekrandaki sonuç

       ana doku × Σ ana çizimlerin rengi + yankı dokusu × Σ yankı çizimlerinin rengi

     ve bu işlev iki toplamı köşe başına veriyor. Ton [0,1] içindeyken
     toplam gama × pay × tonun bayta kırpılmışı; `fShader` 1'in üstündeyse
     ton eksiye iniyor ve sarma onu başka bir renge çeviriyor (korpusta
     sabit yolda 16 preset `fShader=10` yazıyor).

     - Yankı açık (saydamlık > 0,001): iki katman, ana `1 − a`, yankı `a`
       payıyla. Her biri bir kez çiziliyor; gama 0,001'in üstündeyse
       `(int)(gama − 0,0001)` kez daha, son tekrarın gaması kesirli kısım.
       Yani 1'in altındaki gama yankıyla HİÇ uygulanmıyor.
     - Yankı kapalı: `(int)(gama − 0,001) + 1` geçiş, sonuncunun gaması
       kalan. Gama −0,999'un altındaysa hiç geçiş yok, dörtgen çizilmiyor
       (bizde siyah).

     MilkDrop 8 bitlik tamponda her çizimden sonra yuvarlıyor; burada
     toplam bir kez yuvarlanıyor. Hesap float32, MilkDrop'taki gibi.
     `shade`: 12 sayı, köşe sırası üst-sol, üst-sağ, alt-sol, alt-sağ
     (MilkDrop'un dörtgeni v3[0..3]). `out` verilirse dizileri yeniden
     kullanılıyor. */
  function fixedCompWeights(gamma, echoAlpha, shade, out) {
    const f = Math.fround;
    const g = f(Number(gamma) || 0);
    const a = f(Number(echoAlpha) || 0);
    const main = out && out.main ? out.main.fill(0) : new Float32Array(12);
    const echo = out && out.echo ? out.echo.fill(0) : new Float32Array(12);
    // COLOR_NORM float32'de: (int)(x * 255) & 0xFF
    const cn = (x) => (Math.trunc(f(x * 255)) & 0xFF) / 255;
    const draw = (dst, k) => { for (let i = 0; i < 12; i++) dst[i] += cn(f(k * shade[i])); };
    /* Tam katlar 256'da kesiliyor: sıfır olmayan her çizim en az 1/255
       ekliyor, yani 255 kattan sonra kanal zaten doymuş. */
    const MAX_DRAWS = 256;
    const echoOn = a > 0.001;
    if (echoOn) {
      for (let layer = 0; layer < 2; layer++) {
        const mix = layer === 1 ? a : f(1 - a);
        const dst = layer === 1 ? echo : main;
        draw(dst, mix);
        if (g > 0.001) {
          const n = Math.trunc(f(g - f(0.0001)));
          for (let r = Math.max(0, n - MAX_DRAWS); r < n; r++) {
            draw(dst, f((r === n - 1 ? f(g - n) : 1) * mix));
          }
        }
      }
    } else {
      const n = Math.trunc(f(g - f(0.001))) + 1;
      for (let p = Math.max(0, n - MAX_DRAWS); p < n; p++) draw(main, p === n - 1 ? f(g - p) : 1);
    }
    return { main, echo, echoOn };
  }

  const api = { tokenize, parse, compile, Pool, FUNCS, parseMilk, Preset,
    clampColor, colorNorm, md2Versions, stagePlan, genWarpText, genCompText,
    echoFlipBits, fixedCompWeights };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (typeof window !== 'undefined') window.SVMilkdrop = api;
})();
