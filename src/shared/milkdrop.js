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
    ['fgammaadj', 'gamma'],
    ['fvideoechoalpha', 'echo_alpha'],
    ['fvideoechozoom', 'echo_zoom'],
    ['nvideoechoorientation', 'echo_orient'],
    ['bdarkencenter', 'darken_center'],
    ['bbrighten', 'brighten'],
    ['bdarken', 'darken'],
    ['bsolarize', 'solarize'],
    ['binvert', 'invert'],
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
    ['fwavesmoothing', 'wave_smoothing'],
    ['bmodwavealphabyvolume', 'wave_modalpha'],
    ['fmodwavealphastart', 'wave_modalpha_start'],
    ['fmodwavealphaend', 'wave_modalpha_end'],
  ];

  const SHARED_VARS = [
    'time', 'frame', 'fps', 'progress',
    'bass', 'mid', 'treb', 'bass_att', 'mid_att', 'treb_att',
    'vol', 'vol_att', 'meshx', 'meshy', 'aspectx', 'aspecty',
  ];

  class Preset {
    constructor(text, opts) {
      const o = opts || {};
      this.file = parseMilk(text);
      this.pool = new Pool();
      this.errors = [];
      this.name = o.name || this.file.params.psetname || '';

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
        },
        pool,
        initialised: false,
      };
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
      for (let i = 1; i <= 32; i++) pool.set('q' + i, P.get('q' + i));
    }

    // Bir custom dalganın kare denklemlerini koşturur. false: çizilmeyecek.
    waveFrame(w) {
      if (!w || !w.enabled) return false;
      const P = w.pool;
      this._shareInto(P);
      P.set('r', w.r); P.set('g', w.g); P.set('b', w.b); P.set('a', w.a);
      if (!w.initialised) { w.cInit.run(P.values); w.initialised = true; }
      w.cFrame.run(P.values);
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
      /* x/y tohumlanıyor: per_point bunları yazmayan bir preset varsa
         ekranın ortasında düz bir çizgi çıksın, tanımsız değer değil. */
      P.set('x', sample);
      P.set('y', 0.5);
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
      const b = s.base;
      for (const k in b) P.set(k, b[k]);
      P.set('instance', instance);
      P.set('num_inst', s.instances);
      if (!s.initialised) { s.cInit.run(P.values); s.initialised = true; }
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

  const api = { tokenize, parse, compile, Pool, FUNCS, parseMilk, Preset, clampColor };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (typeof window !== 'undefined') window.SVMilkdrop = api;
})();
