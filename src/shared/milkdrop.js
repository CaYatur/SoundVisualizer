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

     Bellek 4096 girdilik bloklar hâlinde tutuluyor, bir blok ilk
     yazıldığında ayrılıyor: yönetici paneli her çizimde presetin
     derlemesini doğrulamak için yeni bir Preset kuruyor ve preset başına
     megabaytlar ayırmak kabul edilemezdi. Yazılmamış girdi 0'dır.

     İndis ve sınır kipe göre (memKey, #580):
       • kapalıyken eski kural: `x | 0`, 0..1.048.575 (MEM_MAX);
       • açıkken MilkDrop'unki: indis trunc(x + 0,00001) — MilkDrop indise
         yakınlık payını ekleyip kırpıyor (asm `_asm_megabuf`: fadd
         closefact; fistp), yani 2,9999999 gibi bir hesap 3. gözü, −1 ise
         0. gözü buluyor. megabuf 0..8.388.607 (NSEEL_RAM_BLOCKS ×
         NSEEL_RAM_ITEMSPERBLOCK = 128 × 65.536); dışı 0 okuyor, yazılanı
         atıyor. gmegabuf tek bir 2^20'lik dizi ve indis ona SARIYOR
         (nseel-ram.c __NSEEL_RAMAllocGMEM: `w & (NSEEL_SHARED_GRAM_SIZE −
         1)`; MilkDrop sanal makinelerine ayrı bir GRAM bloğu vermiyor). */
  const MEM_MAX = 1048576;
  const MD2_MEM_MAX = 8388608;
  const GMEM_MASK = 0xFFFFF;
  function makeMem() {
    const blocks = [];
    return {
      // k: tam sayı indis, max: sınır (hariç)
      get(k, max) {
        if (!(k >= 0 && k < max)) return 0;
        const b = blocks[k >>> 12];
        return b ? b[k & 4095] : 0;
      },
      set(k, v, max) {
        if (!(k >= 0 && k < max)) return v;
        let b = blocks[k >>> 12];
        if (!b) b = blocks[k >>> 12] = new Float64Array(4096);
        b[k & 4095] = v;
        return v;
      },
      clear() { blocks.length = 0; },
    };
  }
  // gmegabuf presetler arasında ORTAK: MilkDrop'ta da öyle.
  const GMEM = makeMem();

  /* reg00..reg99: ns-eel2'de SÜREÇ GENELİNDE tek bir dizi
     (nseel-eval.c `nseel_globalregs[100]`; ad büyük/küçük harfe bakmadan
     "reg" + iki rakam). Her sanal makine — per_frame, per_pixel, her dalga
     ve şekil, geçişteki iki preset — aynı yüz gözü görüyor ve hiçbiri
     sıfırlamıyor. Uyum açıkken böyle; kapalıyken eski kural: her havuzun
     kendi reg'leri (Pool.persistent). Kip koşarken okunuyor, anahtar
     çevrilince aynı karede değişiyor. */
  const REGS = new Float64Array(100);
  const REG_RE = /^reg\d\d$/;

  /* Döngü sınırı: ns-eel2'de `loop` ve `while` ÇAĞRI BAŞINA en çok
     1.048.576 tur (ns-eel.h NSEEL_LOOPFUNC_SUPPORT_MAXLEN; asm
     nseel_asm_repeat / _repeatwhile). Uyum açıkken bu sınır da uygulanıyor;
     motorun koşu başına bütçesi (loopBudget / loopBudgetMd2) uygulamanın
     donmaması için ayrıca duruyor. */
  const LOOP_CAP = 1048576;
  // Uyum açıkken bir şeklin bir karede, bütün örnekleriyle harcayabileceği tur
  const SHAPE_FRAME_LOOPS = 4194304;
  /* Ortak bellekleri (gmegabuf, reg'ler) sıfırlar. MilkDrop bunu hiç
     yapmıyor; ölçüm ve testler presetleri birbirinden yalıtmak için
     çağırıyor. */
  function resetGlobals() {
    GMEM.clear();
    REGS.fill(0);
  }

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

  /* MilkDrop 2'NİN İÇ İŞLEVLERİ (#580). MilkDrop 2'nin ifade derleyicisi
     (Nullsoft'un ns-eel2'si; BeatDrop kopyasında nseel-compiler.c fnTable1,
     ad çevirisi nseel-eval.c) işleçleri adlı işlevler olarak da
     çağrılabilir tutuyor: `_aboeq(a, b)` `a >= b` demek. Korpusta üç preset
     `_aboeq` çağırıyor ve motor onları "bilinmeyen işlev" diye atlıyordu.
     D3D11 çatalı (jecassis) ifadeleri projectM'in yeniden yazdığı
     kütüphaneyle değerlendiriyor; burada presetlerin yazıldığı Nullsoft
     derleyicisi izleniyor. Yalnız uyum açıkken derleniyor — kapalıyken eski
     davranış (bilinmeyen işlev) duruyor.

     `_and` ve `_or` `band`/`bor` DEĞİL: onlar `&&` ve `||`nin kendisi —
     sağ tarafı gerekmedikçe hesaplamıyorlar (derleyici bu iki işlevi
     döngüyle birlikte ayrı bir yoldan kuruyor). `band`/`bor` ise iki
     tarafı da hep hesaplıyor. `_mem`/`_gmem` `megabuf`/`gmegabuf`un iç adı.

     Değer verenler var olan işleçlere eşleniyor; atama biçimleri
     (`_set(x, v)`, `_addop(x, v)` …) ilk bağımsız değişkeni değişken olan
     `x = v`, `x += v` … gibi derleniyor. */
  const MD2_FUNCS = {
    _if: 'if', _and: '&&', _or: '||', _not: 'bnot', _equal: 'equal', _noteq: '!=',
    _below: '<', _above: '>', _beleq: '<=', _aboeq: '>=', _mod: '%',
  };
  const MD2_ASSIGN_FUNCS = {
    _set: null, _addop: '+', _subop: '-', _mulop: '*', _divop: '/', _modop: '%',
    _orop: '|', _andop: '&', _powop: '^',
  };
  const MD2_MEM = { _mem: 'megabuf', _gmem: 'gmegabuf' };
  const own = (o, k) => Object.prototype.hasOwnProperty.call(o, k);

  /* MilkDrop'un doğruluk ve eşitlik sınamaları bir YAKINLIK PAYIYLA
     (NSEEL_CLOSEFACTOR = 0,00001; ns-eel-int.h): mutlak değeri bunun
     altındaki sayı "yanlış", farkı bunun altındaki iki sayı "eşit".
       • `if`, `!`/`bnot`, `&&`, `||`, `while`: |x| >= pay doğru
         (asm: fabs; fcomp closefact);
       • `band`/`bor` işlevleri: |x| > pay doğru — sınırda farklılar
         (C: `fabs(a) > g_closefact`);
       • `==`/`equal`: |a − b| < pay eşit; `!=` tersi;
       • `<`, `>`, `<=`, `>=`, `above`, `below`: birebir.
     NaN'da x87 karşılaştırması "sırasız" dönüyor ve C0 bitini kuruyor:
     NaN yanlış sayılıyor, NaN'lı eşitlik doğru. Uyum açıkken geçerli;
     kapalıyken eski birebir sınamalar. Anahtar çalışma anında
     çevrilebildiği için karar derlemede değil çağrıda: presetin paylaştığı
     `mode` nesnesi anahtarla birlikte güncelleniyor (Preset.accurate). */
  const CLOSE = 0.00001;
  const T_MD2 = (v) => v >= CLOSE || v <= -CLOSE;
  const T_STRICT = (v) => v > CLOSE || v < -CLOSE;
  const EQ_MD2 = (a, b) => { const d = a - b; return !(d >= CLOSE || d <= -CLOSE); };

  /* SONSUZ, NaN VE TAŞMA (#580). MilkDrop 2'nin ifade motoru (Nullsoft
     ns-eel2) 32 bitlik x87 kodu üretiyor; kuralları ondan DERLENMİŞ bir
     karşılaştırma aracıyla ölçüldü (milkdrop-tools/eelref: aynı ifadeler, aynı
     girdiler, iki motor). Eskiden "MilkDrop sonsuz verir" diye yazılmıştı;
     ölçüm başka bir şey gösterdi:
       • İşlemler ham: 1/0 = sonsuz, 0/0 = NaN, log(−1) = NaN, asin(2) = NaN.
         Ara değerler böyle akıyor: min(1/0, 5) = 5, above(1/0, 3) = 1.
       • DÜZ ATAMA temizliyor (asm-nseel-x86-msvc.c nseel_asm_assign): üs
         alanı 0 (sıfır, altnormal) ya da 7FF (sonsuz, NaN) olan değer 0
         yazılıyor. Bileşik atamalar (`+=`, `/=` …, _op işlevleri) ham yazıyor:
         `q /= 0` sonsuz bırakıyor.
       • Kod sıfıra doğru yuvarlama kipinde koşuyor (GLUE_CALL_CODE
         `_RC_CHOP`): taşan çarpma/toplama/exp/pow sonsuz değil ±DBL_MAX
         veriyor. Sıfıra bölme ve kutup (log(0), pow(0, −1)) yine sonsuz.
       • x87 karşılaştırması NaN'da "sırasız": `<`, `>`, above, below DOĞRU;
         `<=`, `>=` YANLIŞ. min(NaN, 1) = NaN ama min(1, NaN) = 1; max
         tersine; sign(NaN) = −1.
       • fsin/fcos |x| >= 2^63'te argümanı değiştirmeden bırakıyor, fptan
         NaN veriyor.
     Yalnız uyum açıkken; kapalıyken eski korumalı değerler. */
  const DBL_MAX = Number.MAX_VALUE;
  const DBL_MIN = 2.2250738585072014e-308;
  const TWO63 = 9223372036854775808;
  // Düz atamanın temizliği: sıfır/altnormal ve sonsuz/NaN → 0 (−0 da +0 oluyor)
  const SAN = (v) => (v - v === 0 ? (v < DBL_MIN && v > -DBL_MIN ? 0 : v) : 0);
  // Sonlu girdilerden gelen sonsuz TAŞMADIR: kırpma kipinde ±DBL_MAX
  const OVF = (v, a, b) => ((v === Infinity || v === -Infinity) && a - a === 0 && b - b === 0
    ? (v > 0 ? DBL_MAX : -DBL_MAX) : v);
  /* KIRPMA KİPİ (#580). MilkDrop kodu x87'de yuvarlama kipi "sıfıra doğru"
     iken koşturuyor (GLUE_CALL_CODE `_RC_CHOP`); her işlemin sonucu en yakına
     değil sıfıra doğru yuvarlanıyor. Çoğu yerde son bit farkı, ama tam sayıya
     çevrilen yerde görünür: 0,3·50 MilkDrop'ta 14,999999999999998, `int` 14
     (korpusta `int(value1*50)`, `(100*value1)%7` yazan dalgalar). JavaScript
     en yakına yuvarlıyor; sonucun tam değerden uzaklığı hata terimiyle (toplamada
     TwoSum, çarpmada Dekker bölmesi) bulunuyor ve sonuç sıfırdan uzağa
     yuvarlanmışsa bir basamak sıfıra çekiliyor. Yalnız `+ − · /`. */
  const SPLIT = 134217729; // 2^27 + 1
  const F64 = new Float64Array(1);
  const U32 = new Uint32Array(F64.buffer);
  const LO = new Uint8Array(new Uint16Array([1]).buffer)[0] === 1 ? 0 : 1;
  const HI = 1 - LO;
  /* Büyüklüğü bir basamak küçült (işaret korunur).

     Normal sayılarda tek çarpma: v = m·2^e (1 ≤ m < 2) için tam çarpım
     v − m·2^(e−53), yani v'nin bir basamağının (2^(e−52)) yarısı ile tamamı
     arasında aşağıda; en yakına yuvarlama onu hep bir alttaki sayıya
     götürüyor. m = 1 iken (ikinin kuvveti) alttaki aralık yarı genişlikte ve
     çarpım tam o sayı. Altnormallerde aralık sabit, çarpım v'ye geri
     yuvarlanırdı: orada bitlerle. Tipli dizi yolu per_pixel'in en sıcak
     işlemindeydi (her çarpmanın yarısı sıfırdan uzağa yuvarlanıyor); ikisinin
     her girdide aynı sonucu verdiği testte sınanıyor. */
  const CHOP_K = 1 - 2 ** -53;
  const toZero = (v) => (v >= 4.450147717014403e-308 || v <= -4.450147717014403e-308 ? v * CHOP_K : toZeroBits(v));
  const toZeroBits = (v) => {
    F64[0] = v;
    if (U32[LO] === 0) { U32[LO] = 0xFFFFFFFF; U32[HI] -= 1; } else U32[LO] -= 1;
    return F64[0];
  };
  // a·b − p, tam (p = a·b en yakına yuvarlanmış)
  const prodErr = (a, b, p) => {
    let t = SPLIT * a;
    const ah = t - (t - a), al = a - ah;
    t = SPLIT * b;
    const bh = t - (t - b), bl = b - bh;
    return ((ah * bh - p) + ah * bl + al * bh) + al * bl;
  };
  // Hata sonucun tersi yöndeyse sonuç sıfırdan uzağa yuvarlanmış demektir
  const chop = (v, err) => (err !== 0 && v !== 0 && (err > 0) !== (v > 0) ? toZero(v) : v);
  const ADD_MD2 = (a, b) => {
    const s = a + b;
    if (s - s !== 0) return OVF(s, a, b);
    const bb = s - a;
    return chop(s, (a - (s - bb)) + (b - bb));
  };
  const SUB_MD2 = (a, b) => ADD_MD2(a, -b);
  const MUL_MD2 = (a, b) => {
    const p = a * b;
    if (p - p !== 0) return OVF(p, a, b);
    return chop(p, prodErr(a, b, p));
  };
  // Sıfıra bölme kutup: sonsuz ya da NaN kalıyor
  const DIV_MD2 = (a, b) => {
    if (b === 0) return a / b;
    const q = a / b;
    if (q - q !== 0) return OVF(q, a, b);
    if (q === 0) return q;
    // Kalan r = a − q·b tam; tam bölüm q + r/b
    const pq = q * b;
    const r = (a - pq) - prodErr(q, b, pq);
    return r === 0 ? q : chop(q, (r > 0) === (b > 0) ? 1 : -1);
  };
  // C'nin pow'u: pow(1, NaN) = 1, pow(−1, ±∞) = 1 (JavaScript NaN veriyor)
  const POW_MD2 = (a, b) => {
    if (a === 1 || b === 0) return 1;
    if (a === -1 && (b === Infinity || b === -Infinity)) return 1;
    const v = Math.pow(a, b);
    return a !== 0 ? OVF(v, a, b) : v;
  };
  const EXP_MD2 = (a) => { const v = Math.exp(a); return v === Infinity && a !== Infinity ? DBL_MAX : v; };
  /* fsqrt da kırpma kipinde (`sqrt` MilkDrop'ta mutlak değerin karekökü):
     s² tam olarak girdiyi aşıyorsa s bir basamak büyük yuvarlanmış */
  const SQRT_MD2 = (a) => {
    const x = Math.abs(a);
    const s = Math.sqrt(x);
    if (s - s !== 0 || s === 0) return s;
    const p = s * s;
    return (p - x) + prodErr(s, s, p) > 0 ? toZero(s) : s;
  };
  const LT_MD2 = (a, b) => !(a >= b);
  const GT_MD2 = (a, b) => !(a <= b);
  /* invsqrt: hızlı ters karekök (asm nseel_asm_invsqrt). Girdi float32'ye
     kırpma kipinde iniyor (sığmayan FLT_MAX oluyor), 0x5f3759df sabiti ve
     tek Newton adımı: y · (1,5 − 0,5 · x · y²). */
  const F32 = new Float32Array(1);
  const I32 = new Int32Array(F32.buffer);
  const INVSQRT_MD2 = (x) => {
    F32[0] = x;
    // Math.fround en yakına yuvarlıyor; kırpma kipinde büyüklük aşılmaz
    if (x - x === 0 && Math.abs(F32[0]) > Math.abs(x)) I32[0] -= 1;
    const y0 = (I32[0] = 0x5f3759df - (I32[0] >> 1), F32[0]);
    /* Her adım kırpma kipinde (fmul, fmul, fmul, fadd, fmul). x87'nin üs
       aralığı geniş: ara değer taşmıyor, taşarsa sonuç DBL_MAX'a iniyor */
    const t = MUL_MD2(MUL_MD2(MUL_MD2(x, -0.5), y0), y0);
    const v = MUL_MD2(ADD_MD2(t, 1.5), y0);
    return v - v === 0 ? v : OVF((x * -0.5 * y0 * y0 + 1.5) * y0, x, 0);
  };
  const FUNCS_MD2 = {
    sin: (a) => (a >= TWO63 || a <= -TWO63 ? (a - a === 0 ? a : NaN) : Math.sin(a)),
    cos: (a) => (a >= TWO63 || a <= -TWO63 ? (a - a === 0 ? a : NaN) : Math.cos(a)),
    tan: (a) => (a >= TWO63 || a <= -TWO63 ? NaN : Math.tan(a)),
    asin: (a) => Math.asin(a),
    acos: (a) => Math.acos(a),
    pow: POW_MD2,
    exp: EXP_MD2,
    log: (a) => Math.log(a),
    log10: (a) => Math.log10(a),
    sqr: (a) => MUL_MD2(a, a),
    sqrt: SQRT_MD2,
    min: (a, b) => (b < a ? b : a),
    max: (a, b) => (a > b ? a : b),
    sign: (a) => (a > 0 ? 1 : a === 0 ? 0 : -1),
    above: (a, b) => (GT_MD2(a, b) ? 1 : 0),
    below: (a, b) => (LT_MD2(a, b) ? 1 : 0),
    // C: t = 1 + exp(−x·c); |t| > pay ise 1/t
    sigmoid: (x, c) => { const t = 1 + Math.exp(-x * c); return t > CLOSE || t < -CLOSE ? 1 / t : 0; },
    invsqrt: INVSQRT_MD2,
  };

  /* x87 `fistp` ile 32 bitlik tam sayıya çevirme. MilkDrop kodu koşturmadan
     önce yuvarlama kipini KIRPMAYA alıyor (nseel-compiler.c GLUE_CALL_CODE:
     `_controlfp(_RC_CHOP, _MCW_RC)`), yani sıfıra doğru kırpılıyor; sığmayan
     değer ve NaN "belirsiz tam sayı" veriyor: −2^31. */
  const FIST = (x) => {
    const t = Math.trunc(x);
    return t >= -2147483648 && t <= 2147483647 ? t : -2147483648;
  };

  /* MilkDrop'un KALANI (`%`, `%=`, `_mod`): iki taraf da MUTLAK değerinin
     tam kısmına iniyor ve bölme işaretsiz — sonuç hiç negatif olmuyor
     (asm-nseel-x86-msvc.c nseel_asm_mod: fabs; fistp; div). −7 % 3 MilkDrop'ta
     1, JavaScript'te −1. Sığmayan değer −2^31, işaretsiz 2^31 oluyor.
     Bölen 0 ise 0. */
  const MOD_MD2 = (a, b) => {
    const ub = FIST(Math.abs(b)) >>> 0;
    return ub === 0 ? 0 : (FIST(Math.abs(a)) >>> 0) % ub;
  };

  // Bellek indisi ve sınırı: uyum açıkken MilkDrop'unki (bkz. makeMem)
  const memKey = (x, md2, g) => (!md2 ? x | 0 : g ? FIST(x + CLOSE) & GMEM_MASK : FIST(x + CLOSE));
  const memMax = (md2, g) => (md2 && !g ? MD2_MEM_MAX : MEM_MAX);

  /* Bit işleçleri (`&`, `|`, `&=`, `|=`): MilkDrop iki tarafı 64 bitlik tam
     sayıya çeviriyor (nseel_asm_and/or: fistp qword, kırpma kipinde).
     32 bite sığan değerde JavaScript'in `|0`ıyla aynı sonuç — yol hızlı
     kalıyor; sığmayanda 64 bit. Sığmayan 64 bit değer ve NaN −2^63. */
  const I64_MIN = -9223372036854775808;
  const toI64 = (x) => {
    const t = Math.trunc(x);
    return t >= I64_MIN && t < -I64_MIN ? BigInt(t) : BigInt(I64_MIN);
  };
  const fits32 = (x) => x > -2147483649 && x < 2147483648;
  const AND_MD2 = (a, b) => (fits32(a) && fits32(b) ? (a | 0) & (b | 0)
    : Number(BigInt.asIntN(64, toI64(a) & toI64(b))));
  const OR_MD2 = (a, b) => (fits32(a) && fits32(b) ? (a | 0) | (b | 0)
    : Number(BigInt.asIntN(64, toI64(a) | toI64(b))));

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
  // ==========================================================================
  // MILKDROP 2'NİN İFADE ÖN UCU (#580)
  //
  // Uyum açıkken denklemler MilkDrop 2'nin derleyicisinin (Nullsoft ns-eel2;
  // BeatDrop kopyası 53d83ee, nseel-compiler.c preprocessCode, nseel-eval.c,
  // nseel-lextab.c) okuduğu gibi okunuyor. Aşağısı onun DAVRANIŞININ bizim
  // kodumuzla kurulmuş hâli; her kural derlenmiş gerçeğiyle karşılaştırılarak
  // doğrulandı (milkdrop-tools/eelref: aynı ifade, iki motor):
  //
  //  1. ÖNİŞLEMCİ. Dilbilgisi yalnız `+ - * / & |`, tekli işaret, çağrı ve
  //     parantez biliyor. Geri kalan işleçler metin düzeyinde çağrıya
  //     çevriliyor; işlenenin sınırı METİN TARANARAK bulunuyor:
  //       `a = x`   → `_set(a, x)`, sol taraf harf/rakam/`_`/`.` dışındaki ilk
  //                  karaktere kadar geri, sağ taraf `, ) ;`'e kadar ileri;
  //       `+= -= *= /= %= |= &= ^=` aynı biçimde (`_addop` …);
  //       `== != < > <= >= && ||` sol taraf `: ( , ; ? %`'ye kadar geri, sağ
  //                  taraf `, ) : ? ;` ya da `&&`/`||`'ye kadar ileri
  //                  (`_equal`, `_below` …);
  //       `%` ve `^` sol taraf tek terim, sağ taraf ilk ad/sayıdan sonraki
  //                  işlece kadar (`_mod`, `pow`);
  //       `!x` → `_not(x)`, `c ? a : b` → `_if(c, a, b)`, `x[i]` → `_mem(x+i)`;
  //       `$pi $e $phi $x1F $'A'` sayıya.
  //     Ölçülen "öncelikler" bunun sonucu: `-2^2` = −4, `3*-7%4` = −9,
  //     `1<2<3` = 1<(2<3), `7%3^2` = (7%3)^2, `g = 1 + b*b = 7` =
  //     g = 1 + b*(b = 7).
  //  2. Parantez içinde `;` ardından harf, rakam, `( _ ! $` geliyorsa `%`
  //     (dilbilgisinde DİZİ: iki yanı çalışır, sağdakinin değeri döner),
  //     gelmiyorsa boşluk oluyor: `(k;; * 3)` = k*3.
  //  3. En üstte `;` deyim ayırıcı. Bir deyim bile derlenemezse BLOK
  //     BÜTÜNÜYLE düşüyor (MilkDrop "preset hatalı" uyarısı verip o bloğu
  //     çalıştırmıyor, state.cpp RecompileExpressions).
  //  4. Sayılar: noktasız tam sayı 32 bite kırpılıyor (atoi: 3000000000 →
  //     2147483647); noktalıda üs işaretsiz (`1.5e2` = 150, `1.5e-2` =
  //     `1.5e` − 2 = −0,5); noktasız üs (`1e3`) ve `0x1F` hata.
  //  5. Adlar büyük/küçük harf ayırmıyor; bir işlev adı parantezsiz
  //     kullanılırsa (`rot*sin*cos(t)`) hata.
  // ==========================================================================
  const md2Sp = (c) => c === ' ' || c === '\t' || c === '\n' || c === '\r' || c === '\v' || c === '\f';
  const md2Al = (c) => {
    if (!c) return false;
    const k = c.charCodeAt(0);
    return (k >= 48 && k <= 57) || (k >= 65 && k <= 90) || (k >= 97 && k <= 122);
  };
  const md2Dig = (c) => !!c && c >= '0' && c <= '9';
  const MD2_PRE_LISTS = ['', ':(,;?%', ',):?;', ',);', ',);', ''];
  // [ilk karakter, ikinci karakter, sol tarama, sağ tarama, üretilen]
  const MD2_PRE_OPS = [
    ['+', '=', 0, 3, '_addop'], ['-', '=', 0, 3, '_subop'], ['%', '=', 0, 3, '_modop'],
    ['|', '=', 0, 3, '_orop'], ['&', '=', 0, 3, '_andop'], ['/', '=', 0, 3, '_divop'],
    ['*', '=', 0, 3, '_mulop'], ['^', '=', 0, 3, '_powop'],
    ['=', '=', 1, 2, '_equal'], ['<', '=', 1, 2, '_beleq'], ['>', '=', 1, 2, '_aboeq'],
    ['<', '', 1, 2, '_below'], ['>', '', 1, 2, '_above'], ['!', '=', 1, 2, '_noteq'],
    ['|', '|', 1, 2, '_or'], ['&', '&', 1, 2, '_and'],
    ['=', '', 0, 3, '_set'], ['%', '', 0, 0, '_mod'], ['^', '', 0, 0, 'pow'],
    ['[', '', 0, 5, '['], ['!', '', -1, 0, '!'], ['?', '', 1, 4, '?'],
  ];

  function md2Pre(src) {
    const s = String(src);
    const n = s.length;
    let out = '';
    let i = 0;
    let depth = 0;
    while (i < n) {
      const c0 = s[i];
      // Yorumlar
      if (c0 === '/' && s[i + 1] === '/') {
        i += 2;
        while (i < n && s[i] !== '\n') i++;
        continue;
      }
      if (c0 === '/' && s[i + 1] === '*') {
        i += 2;
        while (i < n && !(s[i] === '*' && s[i + 1] === '/')) i++;
        if (i < n) i += 2;
        continue;
      }
      // Sabitler
      if (c0 === '$') {
        const a = s[i + 1] || '', b = s[i + 2] || '', d = s[i + 3] || '';
        if (a === 'x' || a === 'X') {
          let j = i + 2, v = 0;
          while (j < n && /[0-9a-fA-F]/.test(s[j])) { v = Math.min(4294967295, v * 16 + parseInt(s[j], 16)); j++; }
          out += String(v);
          i = j;
          continue;
        }
        if (a === '\'' && b && d === '\'') { out += String(s.charCodeAt(i + 2) & 255); i += 4; continue; }
        if ((a === 'p' || a === 'P') && (b === 'i' || b === 'I')) { out += '3.141592653589793'; i += 3; continue; }
        if (a === 'e' || a === 'E') { out += '2.71828183'; i += 2; continue; }
        if ((a === 'p' || a === 'P') && (b === 'h' || b === 'H') && (d === 'i' || d === 'I')) { out += '1.61803399'; i += 4; continue; }
      }
      let c = s[i++];
      if (md2Sp(c)) c = ' ';
      if (c === '(') depth++;
      else if (c === ')') { depth--; if (depth < 0) depth = 0; }
      else if (c === ';' && depth > 0) {
        // Parantez içindeki `;`: sonrası bir terimse dizi işleci, değilse boşluk
        let p = i, cs = 0, nc = '';
        while (p < n) {
          nc = s[p];
          if (!cs && nc === '/') { if (s[p + 1] === '/') cs = 1; else if (s[p + 1] === '*') cs = 2; }
          if (cs === 1 && nc === '\n') cs = 0;
          else if (cs === 2 && nc === '*' && s[p + 1] === '/') { p++; cs = 0; }
          else if (!cs && !md2Sp(nc)) break;
          p++;
        }
        if (p >= n) nc = '';
        c = nc && (md2Al(nc) || nc === '(' || nc === '_' || nc === '!' || nc === '$') ? '%' : ' ';
      } else if (!md2Sp(c) && !md2Al(c)) {
        let op = null;
        for (const o of MD2_PRE_OPS) {
          if (c === o[0] && (!o[1] || s[i] === o[1])) { op = o; break; }
        }
        if (op) {
          const [, second, lscan, rscan, fn] = op;
          // Sol taraf: çıktıda geriye
          let lhs = null;
          if (lscan >= 0) {
            const list = MD2_PRE_LISTS[lscan];
            let lp = out.length - 1, lsc = 0;
            while (lp >= 0) {
              const ch = out[lp];
              if (ch === ')') lsc++;
              else if (ch === '(') { lsc--; if (lsc < 0) break; }
              else if (!lsc) {
                if (!list) {
                  if (!md2Sp(ch) && !md2Al(ch) && ch !== '_' && ch !== '.') break;
                } else if (list.indexOf(ch) >= 0) break;
              }
              lp--;
            }
            lhs = out.slice(lp + 1);
            out = out.slice(0, lp + 1);
          }
          if (second) i++;
          // Sağ taraf: kaynakta ileriye
          const list = MD2_PRE_LISTS[rscan];
          let rp = i, rsc = 0, qc = 0, cs = 0, had = false, br = 0;
          while (rp < n) {
            const ch = s[rp];
            if (!cs && ch === '/') { if (s[rp + 1] === '/') cs = 1; else if (s[rp + 1] === '*') cs = 2; }
            if (cs === 1 && ch === '\n') cs = 0;
            else if (cs === 2 && ch === '*' && s[rp + 1] === '/') { rp++; cs = 0; }
            else if (!cs) {
              if (ch === '(') { had = true; rsc++; }
              else if (ch === ')') { rsc--; if (rsc < 0) break; }
              else if (!rsc) {
                if (ch === ';' || ch === ',') break;
                if (!rscan) {
                  if (ch === ':') break;
                  if (!md2Sp(ch) && !md2Al(ch) && ch !== '_' && ch !== '.' && had) break;
                  if (md2Al(ch) || ch === '_') had = true;
                } else if (rscan === 2 && ((ch === '|' && s[rp + 1] === '|') || (ch === '&' && s[rp + 1] === '&'))) {
                  break;
                } else if (rscan === 3 || rscan === 4) {
                  if (ch === ':') qc--; else if (ch === '?') qc++;
                  if (qc < 3 - rscan) break;
                } else if (rscan === 5) {
                  if (ch === '[') br++; else if (ch === ']') br--;
                  if (br < 0) break;
                }
                if (list.indexOf(ch) >= 0) break;
              }
            }
            rp++;
          }
          const rhs = md2Pre(s.slice(i, rp));
          i = rp;
          if (fn === '[') {
            const lp = (lhs || '').replace(/^\s+/, '');
            const rr = rhs.replace(/^\s+/, '');
            if (/^gmem(\s|$)/i.test(lp)) out += '_gmem(' + (rhs ? rhs : '0');
            else if (rr && rr !== '0') out += '_mem((' + lp + ')+(' + rr + ')';
            else out += '_mem(' + lp;
            if (s[i] === ']') i++;
          } else if (fn === '!') {
            out += '_not(' + rhs;
          } else if (fn === '?') {
            // Sağ tarafı en üst düzeydeki ':'den böl
            let k = 0, par = 0, q = 1;
            for (; k < rhs.length; k++) {
              const ch = rhs[k];
              if (ch === '?') q++;
              else if (ch === ':') q--;
              else if (ch === '(') par++;
              else if (ch === ')') par--;
              if (par < 0) break;
              if (!par && !q && ch === ':') break;
            }
            const yes = rhs.slice(0, k).replace(/^\s+/, '');
            const no = (k < rhs.length ? rhs.slice(k + 1) : '').replace(/^\s+/, '');
            out += '_if(' + (lhs || '') + ',' + (yes || '0') + ',' + (no || '0');
          } else {
            out += fn + '(' + (lhs || '') + ',' + rhs;
          }
          c = ')';
        }
      }
      out += c;
    }
    return out;
  }

  // ns-eel2'nin işlev tablosu (nseel-compiler.c fnTable1) ve ad çevirisi (nseel-eval.c)
  const MD2_ALIAS = {
    if: '_if', bnot: '_not', assign: '_set', equal: '_equal', below: '_below', above: '_above',
    megabuf: '_mem', gmegabuf: '_gmem', int: 'floor',
  };
  const MD2_ARITY = {
    _if: 3, _and: 2, _or: 2, loop: 2, while: 1, _not: 1, _equal: 2, _noteq: 2, _below: 2, _above: 2,
    _beleq: 2, _aboeq: 2, _set: 2, _mod: 2, _mulop: 2, _divop: 2, _orop: 2, _andop: 2, _addop: 2,
    _subop: 2, _modop: 2, _powop: 2, sin: 1, cos: 1, tan: 1, asin: 1, acos: 1, atan: 1, atan2: 2,
    sqr: 1, sqrt: 1, pow: 2, exp: 1, log: 1, log10: 1, abs: 1, min: 2, max: 2, sign: 1, rand: 1,
    floor: 1, ceil: 1, invsqrt: 1, sigmoid: 2, band: 2, bor: 2, exec2: 2, exec3: 3, _mem: 1, _gmem: 1,
  };
  const MD2_CMP = { _equal: 'equal', _noteq: '!=', _below: '<', _above: '>', _beleq: '<=', _aboeq: '>=' };
  const MD2_OPS = { _mulop: '*', _divop: '/', _orop: '|', _andop: '&', _addop: '+', _subop: '-', _modop: '%', _powop: '^' };

  /* Önişlenmiş metnin dilbilgisi: `|` < `&` < `+ -` < `* / %` < tekli
     işaret, hepsi soldan; `%` burada dizi (bkz. md2Pre, madde 2). */
  function md2Tokens(src) {
    const out = [];
    const s = src;
    let i = 0;
    while (i < s.length) {
      const c = s[i];
      if (md2Sp(c)) { i++; continue; }
      // Tek başına `.` de sayı: atof(".") = 0 (korpusta `.-.4` yazan presetler var)
      if (md2Dig(c) || c === '.') {
        let j = i;
        while (md2Dig(s[j])) j++;
        if (s[j] === '.') {
          j++;
          while (md2Dig(s[j])) j++;
          if (s[j] === 'e' || s[j] === 'E') { j++; while (md2Dig(s[j])) j++; }
          out.push({ t: 'num', v: parseFloat(s.slice(i, j)) || 0 });
        } else {
          // atoi: taşan değer 2^31 − 1
          const v = parseInt(s.slice(i, j), 10);
          out.push({ t: 'num', v: v > 2147483647 ? 2147483647 : v });
        }
        i = j;
        continue;
      }
      if (md2Al(c) || c === '_') {
        let j = i;
        while (j < s.length && (md2Al(s[j]) || s[j] === '_')) j++;
        out.push({ t: 'id', v: s.slice(i, j).toLowerCase() });
        i = j;
        continue;
      }
      if ('+-*/%&|(),'.indexOf(c) >= 0) { out.push({ t: 'op', v: c }); i++; continue; }
      throw new SyntaxError(`beklenmeyen '${c}'`);
    }
    out.push({ t: 'eof', v: '' });
    return out;
  }

  function md2Statement(src) {
    const toks = md2Tokens(src);
    let pos = 0;
    const peek = () => toks[pos];
    const isOp = (v) => toks[pos].t === 'op' && toks[pos].v === v;
    const expect = (v) => {
      if (!isOp(v)) throw new SyntaxError(`'${v}' bekleniyordu, bulunan '${toks[pos].v || 'son'}'`);
      pos++;
    };
    const LEVELS = [['|'], ['&'], ['+', '-'], ['*', '/', '%']];
    function level(k) {
      if (k >= LEVELS.length) return unary();
      let left = level(k + 1);
      while (peek().t === 'op' && LEVELS[k].indexOf(peek().v) >= 0) {
        const op = peek().v;
        pos++;
        const right = level(k + 1);
        if (op === '%') left = { k: 'seq', list: (left.k === 'seq' ? left.list : [left]).concat([right]) };
        else left = { k: 'bin', op, a: left, b: right };
      }
      return left;
    }
    function unary() {
      if (isOp('-')) { pos++; return { k: 'un', op: '-', a: unary() }; }
      if (isOp('+')) { pos++; return unary(); }
      return primary();
    }
    function primary() {
      const tk = peek();
      if (tk.t === 'num') { pos++; return { k: 'num', v: tk.v }; }
      if (isOp('(')) { pos++; const e = level(0); expect(')'); return e; }
      if (tk.t === 'id') {
        pos++;
        const name = MD2_ALIAS[tk.v] || tk.v;
        const arity = own(MD2_ARITY, name) ? MD2_ARITY[name] : 0;
        if (!arity) return { k: 'var', name: tk.v };
        // İşlev adı: parantez şart
        expect('(');
        const args = [level(0)];
        while (isOp(',')) { pos++; args.push(level(0)); }
        expect(')');
        if (args.length !== arity) throw new SyntaxError(`'${tk.v}' ${arity} argüman ister, ${args.length} verildi`);
        return md2Call(name, args);
      }
      throw new SyntaxError(`beklenmeyen '${tk.v || 'son'}'`);
    }
    const e = level(0);
    if (peek().t !== 'eof') throw new SyntaxError(`beklenmeyen '${peek().v}'`);
    return e;
  }

  // Önişlemcinin ürettiği çağrıları motorun düğümlerine çevirir
  function md2Call(name, args) {
    const [a, b] = args;
    const memOf = (x) => (x.k === 'call' && (x.name === 'megabuf' || x.name === 'gmegabuf') ? x : null);
    if (name === '_set' || own(MD2_OPS, name)) {
      const op = MD2_OPS[name] || '';
      if (a.k === 'var') {
        return op ? { k: 'assign', name: a.name, compound: true, v: { k: 'bin', op, a, b } }
          : { k: 'assign', name: a.name, v: b };
      }
      const m = memOf(a);
      if (m) return { k: 'bufset', buf: m.name, i: m.args[0], compound: op, v: b };
      /* Değişken olmayan sol taraf (`0 = x`, önişlemcinin ürettiği `1 = 9`):
         MilkDrop geçici bir yere yazıp değeri döndürüyor */
      return op ? { k: 'bin', op, a, b } : { k: 'tmpset', v: b };
    }
    if (own(MD2_CMP, name)) {
      const to = MD2_CMP[name];
      return to === 'equal' ? { k: 'call', name: 'equal', args } : { k: 'bin', op: to, a, b };
    }
    if (name === '_and') return { k: 'bin', op: '&&', a, b };
    if (name === '_or') return { k: 'bin', op: '||', a, b };
    if (name === '_mod') return { k: 'bin', op: '%', a, b };
    if (name === '_not') return { k: 'call', name: 'bnot', args };
    if (name === '_if') return { k: 'call', name: 'if', args };
    if (name === '_mem') return { k: 'call', name: 'megabuf', args };
    if (name === '_gmem') return { k: 'call', name: 'gmegabuf', args };
    if (name === 'loop') return { k: 'loop', n: a, body: [b] };
    return { k: 'call', name, args };
  }

  /* MilkDrop'un bir bloğu okuması: önişlem, deyimlere bölme, her deyimin
     ayrıştırılması. Bir deyim bile başarısızsa `errors` dolu döner ve
     derleyici bloğu bütünüyle düşürür. */
  function md2Parse(src) {
    const stmts = [];
    const errors = [];
    let pre;
    try { pre = md2Pre(src); } catch (e) { pre = ''; errors.push(String((e && e.message) || e)); }
    for (const part of pre.split(';')) {
      if (!part.trim()) continue;
      try { stmts.push(md2Statement(part)); } catch (e) {
        errors.push(String((e && e.message) || e) + ' — ' + part.trim().slice(0, 60));
      }
    }
    stmts.errors = errors;
    stmts.md2 = true;
    return stmts;
  }

  /* `popts.md2`: MilkDrop 2'nin kendi ön ucuyla ayrıştır (md2Parse, #580).
     Aşağısı uyum kapalıyken kullanılan eski ayrıştırıcı. */
  function parse(src, popts) {
    if (popts && popts.md2) return md2Parse(src);
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
      const memOf = (v) => (v === 'megabuf' || v === 'gmegabuf' ? v : '');
      if (peek().t === 'id' && memOf(peek().v)
          && toks[pos + 1] && toks[pos + 1].t === 'op' && toks[pos + 1].v === '(') {
        const buf = memOf(peek().v);
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
         yeterli ve geri kalan her şey (kapanış üretimi) aynen çalışır. */
      if (peek().t === 'id' && toks[pos + 1] && toks[pos + 1].t === 'op'
          && ['+=', '-=', '*=', '/=', '%='].indexOf(toks[pos + 1].v) >= 0) {
        const name = peek().v;
        const op = toks[pos + 1].v[0];
        pos += 2;
        return { k: 'assign', name, compound: true, v: { k: 'bin', op, a: { k: 'var', name }, b: expr() } };
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
      /* megabuf havuzun, yani sanal makinenin. Havuzda duruyor çünkü init
         ile per_frame ayrı ayrı derleniyor ama MilkDrop'ta aynı makinede
         koşuyor ve aynı belleği görüyor. per_pixel MilkDrop'ta AYRI makine:
         uyum açıkken kendi havuzunda (pvPool), kendi megabuf'ıyla; uyum
         kapalıyken eski hâli, ana havuzu paylaşıyor. */
      this.mem = makeMem();
      /* Kare boyunca kalıcı olanlar (registerlar) — sıfırlamada korunur.
         Yalnız uyum kapalıyken kullanılıyor; açıkken reg'ler REGS'te. */
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
        if (REG_RE.test(node.name)) {
          const r = +node.name.slice(3), mode = cx.mode;
          return (P) => (mode.md2 ? REGS[r] : P[i]);
        }
        return (P) => P[i];
      }
      case 'assign': {
        const i = pool.id(node.name);
        const rhs = emit(node.v, pool, cx);
        const F = cx.F, mode = cx.mode;
        /* Uyum açıkken düz atama temizliyor (SAN), bileşik atama ham yazıyor
           (bkz. SAN, #580); kapalıyken ikisi de eskisi gibi sonlu tutuyor. */
        const W = node.compound ? (v) => (mode.md2 ? v : F(v)) : (v) => (mode.md2 ? SAN(v) : F(v));
        if (REG_RE.test(node.name)) {
          const r = +node.name.slice(3);
          return (P) => {
            const v = W(rhs(P));
            if (mode.md2) REGS[r] = v; else P[i] = v;
            return v;
          };
        }
        return (P) => (P[i] = W(rhs(P)));
      }
      case 'tmpset': {
        // Değişken olmayana atama (`0 = x`): değer temizlenip dönüyor, yazılmıyor
        const rhs = emit(node.v, pool, cx);
        const F = cx.F, mode = cx.mode;
        return (P) => (mode.md2 ? SAN(rhs(P)) : F(rhs(P)));
      }
      case 'un': {
        const a = emit(node.a, pool, cx);
        if (node.op === '-') return (P) => -a(P);
        if (node.op === '!') {
          const mode = cx.mode;
          return (P) => { const v = a(P); return (mode.md2 ? !T_MD2(v) : v === 0) ? 1 : 0; };
        }
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
        const budget = cx.budget, mode = cx.mode;
        const len = body.length;
        /* Bütçe: bir preset per_pixel içinde loop(10000, …) yazabilir. Ağın
           1271 düğümünde 60 fps ile bu kare başına 762 milyon işlem demek —
           uygulama donar. Bütçe her run() çağrısında sıfırlanıyor ve bloğun
           KAÇ KEZ koştuğuna göre veriliyor (bkz. Preset). Aşılırsa döngü
           kesilir; preset yanlış görünür ama uygulama yaşar. */
        return (P) => {
          let k = n(P) | 0;
          if (k < 0) k = 0;
          if (mode.md2 && k > LOOP_CAP) k = LOOP_CAP;
          for (let i = 0; i < k; i++) {
            if (--budget.n < 0) break;
            for (let j = 0; j < len; j++) body[j](P);
          }
          return 0;
        };
      }
      case 'bufset': {
        const g = node.buf === 'gmegabuf';
        const mem = g ? GMEM : pool.mem;
        const i = emit(node.i, pool, cx);
        const v = emit(node.v, pool, cx);
        const F = cx.F, mode = cx.mode;
        if (!node.compound) {
          return (P) => {
            const md2 = mode.md2;
            return mem.set(memKey(i(P), md2, g), md2 ? SAN(v(P)) : F(v(P)), memMax(md2, g));
          };
        }
        /* Bileşik atamada indeks BİR KEZ değerlendirilir: `megabuf(n=n+1) *= 2`
           gibi yan etkili bir indeks iki kez çalışsaydı iki farklı gözü
           okuyup yazardı. İşleç de burada, derleme anında seçiliyor.
           Uyum açıkken ham yazıyor (bkz. SAN). */
        const D = cx.D, MM = cx.M, op = node.compound;
        const apply = op === '+' ? (a, b) => (mode.md2 ? ADD_MD2(a, b) : a + b)
          : op === '-' ? (a, b) => (mode.md2 ? SUB_MD2(a, b) : a - b)
            : op === '*' ? (a, b) => (mode.md2 ? MUL_MD2(a, b) : a * b)
              : op === '/' ? (a, b) => D(a, b)
                : (a, b) => MM(a, b);
        return (P) => {
          const md2 = mode.md2, max = memMax(md2, g);
          const k = memKey(i(P), md2, g);
          const r = apply(mem.get(k, max), v(P));
          return mem.set(k, md2 ? r : F(r), max);
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


  /* YAPRAK İŞLENEN: düz bir değişken (reg'ler hariç — onlar uyum açıkken
     havuzda değil) ya da bir sayı. `leafOf` indisi ya da sabiti veriyor. */
  function leafOf(node, pool) {
    if (node.k === 'num') return { v: isFinite(node.v) ? node.v : 0 };
    if (node.k === 'var' && !REG_RE.test(node.name)) return { i: pool.id(node.name) };
    return null;
  }

  /* `+ − ·` İÇİN YAPRAKLI KAPANIŞLAR (#621, genel hız). per_pixel ağın her
     düğümünde koşuyor ve işlenenlerin yarısından çoğu düz bir değişken ya
     da sayı; her biri ayrı bir kapanış çağrısıydı (`(P) => P[i]`). Burada
     değişken doğrudan diziden, sayı sabitten okunuyor. Sonuç ve okuma
     sırası genel yolla aynı: MilkDrop okuyuşunda (late) sol değişken sağ
     ifadeden SONRA okunuyor (işaretçi sırası, bkz. binExpr), eski okuyuşta
     önce. İki sabitli ya da iki ifadeli durumlar genel yola kalıyor. */
  function arithLeaf(op, a, b, A, B, cx) {
    const md = cx.mode, late = cx.md2Ast;
    const shape = (A ? (A.i !== undefined ? 'v' : 'n') : 'e') + (B ? (B.i !== undefined ? 'v' : 'n') : 'e');
    const ai = A && A.i !== undefined ? A.i : 0, bi = B && B.i !== undefined ? B.i : 0;
    const av = A && A.i === undefined ? A.v : 0, bv = B && B.i === undefined ? B.v : 0;
    switch (op + shape) {
      case '+ev': return (P) => { const x = a(P), y = P[bi]; return md.md2 ? ADD_MD2(x, y) : x + y; };
      case '+ve': return late
        ? (P) => { const y = b(P), x = P[ai]; return md.md2 ? ADD_MD2(x, y) : x + y; }
        : (P) => { const x = P[ai], y = b(P); return md.md2 ? ADD_MD2(x, y) : x + y; };
      case '+vv': return (P) => { const x = P[ai], y = P[bi]; return md.md2 ? ADD_MD2(x, y) : x + y; };
      case '+en': return (P) => { const x = a(P); return md.md2 ? ADD_MD2(x, bv) : x + bv; };
      case '+ne': return (P) => { const y = b(P); return md.md2 ? ADD_MD2(av, y) : av + y; };
      case '+vn': return (P) => { const x = P[ai]; return md.md2 ? ADD_MD2(x, bv) : x + bv; };
      case '+nv': return (P) => { const y = P[bi]; return md.md2 ? ADD_MD2(av, y) : av + y; };
      case '-ev': return (P) => { const x = a(P), y = P[bi]; return md.md2 ? SUB_MD2(x, y) : x - y; };
      case '-ve': return late
        ? (P) => { const y = b(P), x = P[ai]; return md.md2 ? SUB_MD2(x, y) : x - y; }
        : (P) => { const x = P[ai], y = b(P); return md.md2 ? SUB_MD2(x, y) : x - y; };
      case '-vv': return (P) => { const x = P[ai], y = P[bi]; return md.md2 ? SUB_MD2(x, y) : x - y; };
      case '-en': return (P) => { const x = a(P); return md.md2 ? SUB_MD2(x, bv) : x - bv; };
      case '-ne': return (P) => { const y = b(P); return md.md2 ? SUB_MD2(av, y) : av - y; };
      case '-vn': return (P) => { const x = P[ai]; return md.md2 ? SUB_MD2(x, bv) : x - bv; };
      case '-nv': return (P) => { const y = P[bi]; return md.md2 ? SUB_MD2(av, y) : av - y; };
      case '*ev': return (P) => { const x = a(P), y = P[bi]; return md.md2 ? MUL_MD2(x, y) : x * y; };
      case '*ve': return late
        ? (P) => { const y = b(P), x = P[ai]; return md.md2 ? MUL_MD2(x, y) : x * y; }
        : (P) => { const x = P[ai], y = b(P); return md.md2 ? MUL_MD2(x, y) : x * y; };
      case '*vv': return (P) => { const x = P[ai], y = P[bi]; return md.md2 ? MUL_MD2(x, y) : x * y; };
      case '*en': return (P) => { const x = a(P); return md.md2 ? MUL_MD2(x, bv) : x * bv; };
      case '*ne': return (P) => { const y = b(P); return md.md2 ? MUL_MD2(av, y) : av * y; };
      case '*vn': return (P) => { const x = P[ai]; return md.md2 ? MUL_MD2(x, bv) : x * bv; };
      case '*nv': return (P) => { const y = P[bi]; return md.md2 ? MUL_MD2(av, y) : av * y; };
      default: return null;
    }
  }

  function binExpr(node, pool, cx) {
    let a = emit(node.a, pool, cx);
    let b = emit(node.b, pool, cx);
    if (node.op === '+' || node.op === '-' || node.op === '*') {
      const A = leafOf(node.a, pool), B = leafOf(node.b, pool);
      const f = (A || B) && arithLeaf(node.op, a, b, A, B, cx);
      if (f) return f;
    }
    /* İşaretçi sırası (#580, MilkDrop okuyuşunda). ns-eel basit bir değişkeni
       işleme GÖSTERGE olarak veriyor ve değerini işlem anında okuyor; öbür
       işlenen o sırada çoktan hesaplanmış oluyor. `b*(b = 7)` MilkDrop'ta
       7·7 = 49 (eelref: `g = 1 + b*b = 7` → 50). Sol işlenen değişken, sağı
       hesaplanan bir ifadeyse önce sağ hesaplanıyor. Kısa devreli `&&`/`||`
       hariç: orada sağ taraf gerekmedikçe çalışmıyor. */
    if (cx.md2Ast && node.op !== '&&' && node.op !== '||' && node.a.k === 'var'
        && node.b.k !== 'var' && node.b.k !== 'num') {
      const a0 = a, b0 = b;
      let cb = 0;
      a = (P) => { cb = b0(P); return a0(P); };
      b = () => cb;
    }
    const F = cx.F, md = cx.mode;
    switch (node.op) {
      // Uyum açıkken taşma ±DBL_MAX (kırpma kipi, bkz. OVF)
      case '+': return (P) => { const x = a(P), y = b(P); return md.md2 ? ADD_MD2(x, y) : x + y; };
      case '-': return (P) => { const x = a(P), y = b(P); return md.md2 ? SUB_MD2(x, y) : x - y; };
      case '*': return (P) => { const x = a(P), y = b(P); return md.md2 ? MUL_MD2(x, y) : x * y; };
      // Sıfıra bölme: kapalıyken 0, açıkken MilkDrop'taki gibi sonsuz/NaN (bkz. D)
      case '/': { const D = cx.D; return (P) => D(a(P), b(P)); }
      case '%': { const M = cx.M; return (P) => M(a(P), b(P)); }
      case '^': return (P) => { const x = a(P), y = b(P); return md.md2 ? POW_MD2(x, y) : F(Math.pow(x, y)); };
      // Uyum açıkken yakınlık payıyla (CLOSE)
      case '==': {
        const mode = cx.mode;
        return (P) => { const x = a(P), y = b(P); return (mode.md2 ? EQ_MD2(x, y) : x === y) ? 1 : 0; };
      }
      case '!=': {
        const mode = cx.mode;
        return (P) => { const x = a(P), y = b(P); return (mode.md2 ? !EQ_MD2(x, y) : x !== y) ? 1 : 0; };
      }
      // x87'de NaN'lı `<` ve `>` DOĞRU (bkz. LT_MD2); `<=`, `>=` birebir
      case '<': return (P) => { const x = a(P), y = b(P); return (md.md2 ? LT_MD2(x, y) : x < y) ? 1 : 0; };
      case '>': return (P) => { const x = a(P), y = b(P); return (md.md2 ? GT_MD2(x, y) : x > y) ? 1 : 0; };
      case '<=': return (P) => (a(P) <= b(P) ? 1 : 0);
      case '>=': return (P) => (a(P) >= b(P) ? 1 : 0);
      /* && ve || JavaScript'te olduğu gibi kısa devre yapar: sağ taraf
         gerekmedikçe ÇAĞRILMAZ. Eski üretilen kod da öyleydi; atama içeren
         bir sağ taraf iki davranış arasında fark yaratırdı. */
      case '&&': {
        const mode = cx.mode;
        return (P) => ((mode.md2 ? T_MD2(a(P)) && T_MD2(b(P)) : a(P) !== 0 && b(P) !== 0) ? 1 : 0);
      }
      case '||': {
        const mode = cx.mode;
        return (P) => ((mode.md2 ? T_MD2(a(P)) || T_MD2(b(P)) : a(P) !== 0 || b(P) !== 0) ? 1 : 0);
      }
      // Bit işleçleri tam sayıya yuvarlar; uyum açıkken 64 bit (AND_MD2)
      case '&': {
        const mode = cx.mode;
        return (P) => (mode.md2 ? AND_MD2(a(P), b(P)) : (a(P) | 0) & (b(P) | 0));
      }
      case '|': {
        const mode = cx.mode;
        return (P) => (mode.md2 ? OR_MD2(a(P), b(P)) : (a(P) | 0) | (b(P) | 0));
      }
      default: return () => 0;
    }
  }

  /* SIK İŞLEVLER KENDİ ÇAĞRI NOKTALARINDA (#621, genel hız). Genel yolda
     bütün tek argümanlı işlevler aynı kapanış metnini paylaşıyor; V8 o
     noktada sin, cos, abs... hepsini görüp çağrıyı satır içine almıyor.
     Her işleve ayrı bir metin, her birinde tek hedef. Çağrılan işlevler
     genel yoldakilerin aynısı; yalnız çağrının yeri ayrı. */
  function hotCall(name, a, f0, fm, mode) {
    const x = a[0], y = a[1];
    const key = a.length === 1 ? name : a.length === 2 ? name + '/2' : '';
    if (fm && f0) {
      switch (key) {
        case 'sin': return (P) => (mode.md2 ? fm(x(P)) : f0(x(P)));
        case 'cos': return (P) => (mode.md2 ? fm(x(P)) : f0(x(P)));
        case 'asin': return (P) => (mode.md2 ? fm(x(P)) : f0(x(P)));
        case 'acos': return (P) => (mode.md2 ? fm(x(P)) : f0(x(P)));
        case 'sqr': return (P) => (mode.md2 ? fm(x(P)) : f0(x(P)));
        case 'sqrt': return (P) => (mode.md2 ? fm(x(P)) : f0(x(P)));
        case 'sign': return (P) => (mode.md2 ? fm(x(P)) : f0(x(P)));
        case 'pow/2': return (P) => (mode.md2 ? fm(x(P), y(P)) : f0(x(P), y(P)));
        case 'min/2': return (P) => (mode.md2 ? fm(x(P), y(P)) : f0(x(P), y(P)));
        case 'max/2': return (P) => (mode.md2 ? fm(x(P), y(P)) : f0(x(P), y(P)));
        case 'above/2': return (P) => (mode.md2 ? fm(x(P), y(P)) : f0(x(P), y(P)));
        case 'below/2': return (P) => (mode.md2 ? fm(x(P), y(P)) : f0(x(P), y(P)));
        default: return null;
      }
    }
    const f = f0 || fm;
    switch (key) {
      case 'abs': return (P) => f(x(P));
      case 'int': return (P) => f(x(P));
      case 'atan': return (P) => f(x(P));
      case 'atan2/2': return (P) => f(x(P), y(P));
      default: return null;
    }
  }

  function callExpr(node, pool, cx) {
    const name = node.name;
    const a = node.args.map((x) => emit(x, pool, cx));
    const mode = cx.mode;
    // if() kısa devre yapmalı: her iki dalı da hesaplamak yan etkileri
    // (atamaları) yanlışlıkla çalıştırırdı
    if (name === 'if') {
      const c = a[0], t = a[1], f = a[2];
      return (P) => ((mode.md2 ? T_MD2(c(P)) : c(P) !== 0) ? t(P) : f(P));
    }
    /* Doğruluk ve eşitlik sınayan işlevler uyum açıkken yakınlık payıyla
       (CLOSE). band/bor iki tarafı da HEP hesaplıyor — && ve || gibi kısa
       devre yapmıyorlar; sınırları da onlardan farklı (T_STRICT). */
    if (name === 'equal') {
      const x = a[0], y = a[1];
      return (P) => { const u = x(P), v = y(P); return (mode.md2 ? EQ_MD2(u, v) : u === v) ? 1 : 0; };
    }
    if (name === 'bnot') {
      const x = a[0];
      return (P) => { const u = x(P); return (mode.md2 ? !T_MD2(u) : u === 0) ? 1 : 0; };
    }
    if (name === 'band') {
      const x = a[0], y = a[1];
      return (P) => { const u = x(P), v = y(P); return (mode.md2 ? T_STRICT(u) && T_STRICT(v) : u !== 0 && v !== 0) ? 1 : 0; };
    }
    if (name === 'bor') {
      const x = a[0], y = a[1];
      return (P) => { const u = x(P), v = y(P); return (mode.md2 ? T_STRICT(u) || T_STRICT(v) : u !== 0 || v !== 0) ? 1 : 0; };
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
        for (let it = 0; ; it++) {
          if (mode.md2 && it >= LOOP_CAP) break;
          if (--budget.n < 0) break;
          const v = body(P);
          if (mode.md2 ? !T_MD2(v) : v === 0) break;
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
      const g = name === 'gmegabuf';
      const mem = g ? GMEM : pool.mem;
      const i = a[0];
      return (P) => {
        const md2 = mode.md2;
        return mem.get(memKey(i(P), md2, g), memMax(md2, g));
      };
    }
    /* Ayrıştırıcı adı zaten beyaz listeye karşı doğruladı (bilinmeyen ad
       SyntaxError atar), burada da doğrudan o tablodan çözülüyor: çalışma
       anında ad üzerinden arama yok. */
    const def = FUNCS[name];
    const f0 = def && def[1];
    /* Uyum açıkken MilkDrop'un ham C/x87 davranışı (FUNCS_MD2, bkz. SAN);
       kapalıyken korumalı olanlar. invsqrt yalnız uyum açıkken ayrışıyor. */
    const fm = FUNCS_MD2[name];
    const hot = hotCall(name, a, f0, fm, mode);
    if (hot) return hot;
    const f = fm && f0 ? (...v) => (mode.md2 ? fm : f0)(...v) : (f0 || fm);
    if (!f) return () => 0;
    // Argüman sayısına göre özelleşiyoruz: apply/yayılım her çağrıda dizi ayırır
    /* İki ayrı çağrı noktası: tek noktada değişen hedef (`(md2 ? fm : f0)(…)`)
       V8'in satır içine almasını engelliyor ve per-pixel'de pahalı */
    if (fm && f0 && a.length === 1) { const x = a[0]; return (P) => (mode.md2 ? fm(x(P)) : f0(x(P))); }
    if (fm && f0 && a.length === 2) { const x = a[0], y = a[1]; return (P) => (mode.md2 ? fm(x(P), y(P)) : f0(x(P), y(P))); }
    if (a.length === 1) { const x = a[0]; return (P) => f(x(P)); }
    if (a.length === 2) { const x = a[0], y = a[1]; return (P) => f(x(P), y(P)); }
    if (a.length === 3) { const x = a[0], y = a[1], z = a[2]; return (P) => f(x(P), y(P), z(P)); }
    return (P) => f.apply(null, a.map((g) => g(P)));
  }

  /* Bir denklem bloğunu derler.

     Dönüş: { run(P), pool, error }  — hata varsa run yine çalışır ama hiçbir
     şey yapmaz. Bozuk bir preset uygulamayı durdurmamalı; olan biteni
     kullanıcıya söylemek yeterli.

     opts.mode: { md2 } — MilkDrop 2 uyumu (#580). Kapanışlar bunu HER
       ÇAĞRIDA okuyor, yani anahtar çevrildiğinde yeniden derlemek
       gerekmiyor. Verilmezse eski davranış.
     opts.md2Funcs: MilkDrop'un iç işlev adları (`_aboeq` …) tanınsın mı.
       Ayrıştırma anında karar verildiği için anahtar çevrilince bu adları
       kullanan preset yeniden kuruluyor (readingsDiffer). */
  function compile(src, pool, opts) {
    const p = pool || new Pool();
    const o = opts || {};
    let stmts;
    try {
      stmts = parse(src, { md2: !!o.md2Funcs });
    } catch (e) {
      return { run: () => {}, pool: p, error: String(e.message || e), statements: 0 };
    }
    /* Atlanan deyimler hata olarak bildirilir — preset yine de çalışır ama
       panel bunu göstersin diye. Sessizce çalıştırmak, kullanıcıya yanlış
       görünen bir sahnenin sebebini saklardı. */
    const skipped = (stmts.errors || []).slice();
    /* MilkDrop'un okuyuşunda (md2Parse) bir deyim bile derlenemezse BLOK
       BÜTÜNÜYLE düşüyor — MilkDrop o bloğu hiç çalıştırmıyor (state.cpp
       RecompileExpressions: NSEEL_code_compile NULL döndürünce kod yok).
       Eskiden deyim deyim kurtarılıyordu; ayrıştırıcılar neyin hata olduğunda
       ayrıştığı için bütünüyle düşürmek doğru blokları da düşürürdü. Artık
       ayrıştırıcı MilkDrop'unkiyle aynı: korpusun 10.757 tekil bloğunda
       derlenip derlenmeme iki motorda aynı (eelref). */
    if (stmts.md2 && skipped.length) {
      return {
        run: () => 0, pool: p, statements: 0, skipped: skipped.length, dropped: true,
        error: 'blok derlenmedi (MilkDrop da çalıştırmıyor): ' + skipped.join(' | '),
        resetSeed: () => {},
      };
    }
    const mode = o.mode || { md2: false };
    // Yardımcılar kapanışa dışarıdan verilir; üretilen kodda serbest
    // tanımlayıcı yoktur.
    const F = (v) => (isFinite(v) ? v : 0);
    // Uyum açıkken ham bölme (sıfıra bölme sonsuz/NaN; atama temizler — SAN)
    const D = (a, b) => (mode.md2 ? DIV_MD2(a, b) : b === 0 ? 0 : F(a / b));
    // Kalan: uyum açıkken MilkDrop'unki (MOD_MD2), kapalıyken işaretli
    const M = (a, b) => {
      if (mode.md2) return MOD_MD2(a, b);
      const bi = b | 0;
      return bi === 0 ? 0 : (a | 0) % bi;
    };
    /* rand(n). Tohumlu, çünkü çevrimdışı dışa aktarımın kare kare
       tekrarlanabilir olması gerekiyor.

       Uyum açıkken MilkDrop'unki: TAM SAYI DEĞİL, 0 ile max(1, floor(n))
       arasında ondalıklı bir sayı (nseel-cfunc.c nseel_int_rand:
       `genrand_int32() * (1.0 / 0xFFFFFFFF) * x`). Tam sayı veren dal
       NSEEL_EEL1_COMPAT_MODE'a bağlı ve iki MilkDrop kod tabanı da onu
       açmıyor; korpusta sık görülen `int(rand(4))` bu yüzden var. Üreteç
       bizim (MilkDrop'unki Mersenne Twister), aralık ve dağılım aynı.
       Kapalıyken eski davranış: 0..n−1 tam sayı. */
    let seed = (o.seed || 12345) >>> 0;
    const R = (n) => {
      seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
      if (mode.md2) {
        const x = Math.floor(n);
        return seed * (1 / 4294967295) * (x < 1 ? 1 : x);
      }
      const k = Math.max(1, Math.floor(n) || 1);
      return (seed / 4294967296) * k | 0;
    };

    /* Yardımcılar kapanışlara buradan verilir. R tohumu dışarıda tuttuğu
       için resetSeed sonradan da çalışır. */
    const budget = { n: 0 };
    const cx = { F, D, M, R, budget, mode, md2Ast: !!stmts.md2 };
    const LOOP_BUDGET = Math.max(0, Number(o.loopBudget) || 65536);
    // Uyum açıkken bütçe (verilmezse aynısı): MilkDrop'un izin verdiğine yakın
    const LOOP_BUDGET_MD2 = Math.max(0, Number(o.loopBudgetMd2) || LOOP_BUDGET);

    let prog;
    try {
      /* Deyimin değeri kullanılmıyor (run dönüşü atıyor); eskiden her deyim
         sonucunu sonlu tutan bir kapanışla sarılıydı — düğüm başına boşa bir
         çağrı (#621, genel hız). */
      prog = stmts.map((st) => emit(st, p, cx));
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
      /* cap: bu koşunun bütçesi bundan büyük olamaz (şeklin kare toplamı).
         Dönüş: harcanan tur. */
      run: (P, cap) => {
        const V = P || p.values;
        const b = mode.md2 ? LOOP_BUDGET_MD2 : LOOP_BUDGET;
        const start = cap !== undefined && cap < b ? cap : b;
        budget.n = start;
        try {
          for (let i = 0; i < prog.length; i++) prog[i](V);
        } catch (e) { /* çalışma anı hatası kareyi düşürmesin */ }
        return start - Math.max(0, budget.n);
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

  /* MILKDROP 2'NİN OKUYUŞU (#580). Uyum açıkken preset dosyası bununla
     okunuyor (`readMilk`); kapalıyken yukarıdaki `parseMilk` duruyor.

     MilkDrop dosyayı önce satır satır bir dizine çeviriyor (state.cpp
     _GetLineByName; BeatDrop'un D3D9 hâli aynı): satırın ADI ilk `=`ye, ilk
     boşluğa ya da satır sonuna kadar olan kısım, DEĞERİ ondan sonrası.
     Sonra anahtarları KENDİ sırasıyla arıyor (CState::Import, CWave::Import,
     CShape::Import): önce bir önceki okumanın hemen ardındaki satıra
     bakıyor, o değilse baştan tarıyor. Bizim ayrıştırıcımızdan farkları —
     korpusun 10.332 presetinden 25'inde görülüyor:
      - anahtar büyük/küçük harfe duyarlı (`PSVERSION_comp` okunmuyor);
      - girintili satırın adı boş, hiç okunmuyor; `anahtar değer` (boşlukla)
        okunuyor, `anahtar = değer` okunmuyor (değer `=` ile başlıyor);
      - iki kez yazılmış anahtarda sıradaki ya da İLK geçiş, son değil;
      - tam sayı anahtarları `%d`: `textured=0.05` 0, `bBrighten=0.5` 0;
        kayan noktalılar `%f`: baştaki sayı, `.975;` 0,975; sayı yoksa
        anahtar okunmamış sayılıyor;
      - numaralı kod satırları ilk eksik numarada bitiyor, ilk satırdaki ters
        tırnak her kod satırında atılıyor;
      - denklem satırlarında `//` ve `\\` satır sonuna kadar yorum ve satırlar
        ARADA HİÇBİR ŞEY OLMADAN yapışıyor, satır sonundaki boşluk korunarak
        (ReadCode, StripLinefeedCharsAndComments). Bizim ayrıştırıcı
        yapışık biçim ayrışmazsa satır sonuyla birleştiriyordu.
     Okunmayan anahtar sonuçta YOK; varsayılanı motor veriyor.

     Yapılmayanlar: MilkDrop baytları okuyor, motor çözülmüş metni alıyor.
     0xFF baytını dosya sonu sayması ve 251 karakteri aşan değeri dizinde
     ikinci bir satıra bölmesi bayt kuralları; çözülmüş metinde birebir
     kurulamıyor ve korpusta hiçbir dosyada etkisi yok. Değerler double
     kalıyor: MilkDrop float'a çeviriyor, fark 1e-7'nin altında. Derlenemeyen
     bir blok MilkDrop'ta bütünüyle düşüyor; uyum açıkken bizde de (bkz.
     md2Parse ve compile): ayrıştırıcı artık MilkDrop'unkiyle aynı, korpusun
     10.757 tekil bloğunda derlenip derlenmeme iki motorda aynı. */
  function md2Index(text) {
    const s = String(text == null ? '' : text);
    const N = s.length;
    const names = [];
    const vals = [];
    let i = 0;
    while (i < N) {
      // Ad: satır sonuna, boşluğa ya da '='ye kadar
      let j = i;
      while (j < N) {
        const c = s.charCodeAt(j);
        if (c === 13 || c === 10 || c === 32 || c === 61) break;
        j++;
      }
      if (j >= N) break;
      const stop = s.charCodeAt(j);
      let next = j + 1;
      if (stop === 61 || stop === 32) {
        names.push(s.slice(i, j));
        // Aramada okunan değer: satır sonuna kadar
        let e = next;
        while (e < N && s.charCodeAt(e) !== 13 && s.charCodeAt(e) !== 10) e++;
        vals.push(s.slice(next, e));
        // Dizin satırın geri kalanını LF'ye kadar yutuyor (fgets)
        const lf = s.indexOf('\n', next);
        next = lf < 0 ? N : lf + 1;
      }
      // Arta kalan satır sonları
      while (next < N && (s.charCodeAt(next) === 13 || s.charCodeAt(next) === 10)) next++;
      i = next;
    }
    /* Arama: önce bir önceki okumanın ardındaki satır, o değilse baştan.
       Bulunamayan anahtar sırayı bozmuyor. */
    let line = 0;
    const find = (name) => {
      if (!(line < names.length && names[line] === name)) {
        const k = names.indexOf(name);
        if (k < 0) return null;
        line = k;
      }
      return vals[line++];
    };
    return { find };
  }

  // %d: baştaki boşluk, işaret ve rakamlar; %f: C yerel ayarında baştaki sayı
  const md2Int = (v) => {
    const m = /^[ \t\n\v\f\r]*([+-]?\d+)/.exec(v);
    return m ? parseInt(m[1], 10) : null;
  };
  const md2Float = (v) => {
    const m = /^[ \t\n\v\f\r]*([+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?)/.exec(v);
    return m ? parseFloat(m[1]) : null;
  };

  /* Sürüm satırları, MilkDrop'un Import'ta okuduğu sırayla ve kuralıyla —
     dosyanın ilk okumaları bunlar, yani `parseMilkMd2` de tam bu değerleri
     buluyor. Karışımlar (milkdrop-mashup.js) aynı kuralı buradan alıyor. */
  function readVersions(text, idx) {
    const ix = idx || md2Index(text);
    const out = {};
    const I = (k) => {
      const v = ix.find(k);
      const n = v === null ? null : md2Int(v);
      if (n !== null) out[k.toLowerCase()] = n;
    };
    I('MILKDROP_PRESET_VERSION');
    const ver = typeof out.milkdrop_preset_version === 'number' ? out.milkdrop_preset_version : 100;
    if (ver === 200) I('PSVERSION');
    else if (ver > 200) { I('PSVERSION_WARP'); I('PSVERSION_COMP'); }
    return out;
  }

  /* `seen` verilirse aranan her anahtar (küçük harfle) oraya yazılıyor.
     `raw` verilirse her kod bloğunun satırları, MilkDrop'un bulduğu
     sırayla ve yapıştırılmadan, önekiyle oraya (`raw['per_frame_']`):
     düzenleyici (#578) bloğu MilkDrop'un gördüğü satırlarla gösteriyor —
     yinelenen numaralarda hangisini seçtiği aramanın sırasına bağlı. */
  function parseMilkMd2(text, seen, raw, slots) {
    /* Dalga ve şekil yuvası: MilkDrop 2'de 4 (md_defines.h
       MAX_CUSTOM_WAVES/SHAPES), MilkDrop 3 kipinde 16 (#567). 4'te okuma
       sırası ve arama konumu eskisinin aynısı. */
    const SLOTS = slots === 16 ? 16 : 4;
    const ix = md2Index(text);
    const params = readVersions(text, ix);
    const put = (k, parse) => {
      if (seen) seen.add(k.toLowerCase());
      const v = ix.find(k);
      const n = v === null ? null : parse(v);
      if (n !== null) params[k.toLowerCase()] = n;
    };
    const I = (...keys) => keys.forEach((k) => put(k, md2Int));
    const F = (...keys) => keys.forEach((k) => put(k, md2Float));
    const code = (prefix) => {
      const out = [];
      for (let n = 1; ; n++) {
        const v = ix.find(prefix + n);
        if (v === null) break;
        out.push(v.charAt(0) === '`' ? v.slice(1) : v);
      }
      if (raw) raw[prefix] = out.slice();
      return out;
    };
    // Denklem: satır satır yorum kesiliyor, satırlar yapışıyor
    const eq = (lines) => lines.map((l) => {
      const a = l.indexOf('//');
      const b = l.indexOf('\\\\');
      const cut = a < 0 ? b : b < 0 ? a : Math.min(a, b);
      return cut < 0 ? l : l.slice(0, cut);
    }).join('');

    // Genel
    F('fRating', 'fDecay', 'fGammaAdj', 'fVideoEchoZoom', 'fVideoEchoAlpha');
    I('nVideoEchoOrientation', 'bRedBlueStereo', 'bBrighten', 'bDarken', 'bSolarize', 'bInvert');
    F('fShader', 'b1n', 'b2n', 'b3n', 'b1x', 'b2x', 'b3x', 'b1ed');
    // Dalga
    I('nWaveMode', 'bAdditiveWaves', 'bWaveDots', 'bWaveThick', 'bModWaveAlphaByVolume', 'bMaximizeWaveColor');
    F('fWaveAlpha', 'fWaveScale', 'fWaveSmoothing', 'fWaveParam', 'fModWaveAlphaStart', 'fModWaveAlphaEnd',
      'wave_r', 'wave_g', 'wave_b', 'wave_x', 'wave_y',
      'nMotionVectorsX', 'nMotionVectorsY', 'mv_dx', 'mv_dy', 'mv_l', 'mv_r', 'mv_g', 'mv_b');
    I('bMotionVectorsOn');
    F('mv_a');
    const waves = [];
    for (let i = 0; i < SLOTS; i++) {
      const k = (n) => 'wavecode_' + i + '_' + n;
      I(k('enabled'), k('samples'), k('sep'), k('bSpectrum'), k('bUseDots'), k('bDrawThick'), k('bAdditive'));
      F(k('scaling'), k('smoothing'), k('r'), k('g'), k('b'), k('a'));
      const w = { index: i };
      const init = code('wave_' + i + '_init');
      const frame = code('wave_' + i + '_per_frame');
      const point = code('wave_' + i + '_per_point');
      if (init.length) w.init = eq(init);
      if (frame.length) w.per_frame = eq(frame);
      if (point.length) w.per_point = eq(point);
      if (init.length || frame.length || point.length) waves.push(w);
    }
    const shapes = [];
    for (let i = 0; i < SLOTS; i++) {
      const k = (n) => 'shapecode_' + i + '_' + n;
      I(k('enabled'), k('sides'), k('additive'), k('thickOutline'), k('textured'), k('num_inst'));
      F(k('x'), k('y'), k('rad'), k('ang'), k('tex_ang'), k('tex_zoom'), k('r'), k('g'), k('b'), k('a'),
        k('r2'), k('g2'), k('b2'), k('a2'), k('border_r'), k('border_g'), k('border_b'), k('border_a'));
      const s = { index: i };
      const init = code('shape_' + i + '_init');
      const frame = code('shape_' + i + '_per_frame');
      if (init.length) s.init = eq(init);
      if (frame.length) s.per_frame = eq(frame);
      if (init.length || frame.length) shapes.push(s);
    }
    // Hareket
    F('zoom', 'rot', 'cx', 'cy', 'dx', 'dy', 'warp', 'sx', 'sy');
    I('bTexWrap', 'bDarkenCenter');
    F('fWarpAnimSpeed', 'fWarpScale', 'fZoomExponent',
      'ob_size', 'ob_r', 'ob_g', 'ob_b', 'ob_a', 'ib_size', 'ib_r', 'ib_g', 'ib_b', 'ib_a');
    const init = eq(code('per_frame_init_'));
    const perFrame = eq(code('per_frame_'));
    const perPixel = eq(code('per_pixel_'));
    const warpShader = code('warp_').join('\n');
    const compShader = code('comp_').join('\n');
    return { params, init, perFrame, perPixel, warpShader, compShader, waves, shapes };
  }

  // Uyum anahtarına göre okuyuş: açıkken MilkDrop'unki, kapalıyken eski ayrıştırıcı
  const readMilk = (text, accurate, slots) => (accurate === false ? parseMilk(text) : parseMilkMd2(text, null, null, slots));

  /* MİLKDROP 3 UZANTILARI (#567). Bir presetin hangi MilkDrop 3 uzantısını
     kullandığı: 'slots' (5.–16. dalga ya da şekil yuvası etkin ya da kodlu),
     'slot4' (yalnız 5. yuva, yani 4 numara), 'q64' (denklemlerde q33–q64),
     'wavemode' (nWaveMode 8 ve üstü), 'fft' ve 'mouse' (shader'da get_fft,
     get_fft_hz, mouse.x…). Tarif MilkDrop 3'ün kendi açıklamasından
     (README): 16 şekil ve dalga, q1–q64, 16 basit dalga biçimi, shader'da
     FFT ve fare; o özelliklerin koduna erişim yok, yalnız adları.

     Otomatik kip (`md3Auto`) yalnız 'slots', 'q64', 'fft' ve 'mouse'u MD3
     sayıyor. Korpusun 10.347 presetinden 14'ü öbür ikisine takılıyor ve
     hepsi MilkDrop 2 dönemi dosyası: 7'si 4 numaralı yuvayı açık ya da
     kodlu yazıyor (162 dosya o yuvanın anahtarını taşıyor), 5'i 8 ve üstü
     dalga kipi yazıyor. MilkDrop 2 ikisini de yok sayıyordu (yuva 4'ün
     ötesi okunmuyor; kip `% 8`) — yazarlarının gördüğü o. */
  const MD3_AUTO = ['slots', 'q64', 'fft', 'mouse'];
  function md3Features(text) {
    const out = new Set();
    for (const raw of String(text == null ? '' : text).split('\n')) {
      const l = raw.replace(/\r$/, '');
      let m = /^(wavecode|shapecode)_(\d+)_enabled[ =]\s*([+-]?\d+)/i.exec(l);
      if (m && +m[2] >= 4 && +m[2] < 16 && +m[3] !== 0) out.add(+m[2] === 4 ? 'slot4' : 'slots');
      m = /^(wave|shape)_(\d+)_(?:init|per_frame|per_point)\d+[ =](.*)$/i.exec(l);
      if (m && +m[2] >= 4 && +m[2] < 16 && m[3].replace(/\/\/.*$/, '').trim()) out.add(+m[2] === 4 ? 'slot4' : 'slots');
      m = /^(?:per_frame_init_|per_frame_|per_pixel_|wave_\d+_(?:init|per_frame|per_point)|shape_\d+_(?:init|per_frame))\d+[ =](.*)$/i.exec(l);
      if (m && /(^|[^a-z0-9_])q(3[3-9]|[45]\d|6[0-4])(?![a-z0-9_])/i.test(m[1].replace(/\/\/.*$/, ''))) out.add('q64');
      m = /^nWaveMode[ =]\s*([+-]?\d+)/.exec(l);
      if (m && +m[1] >= 8) out.add('wavemode');
      m = /^(?:warp|comp)_\d+[ =](.*)$/i.exec(l);
      if (m) {
        const c = m[1].replace(/\/\/.*$/, '');
        if (/\bget_fft(?:_hz)?\s*\(/.test(c)) out.add('fft');
        if (/\bmouse\s*\.\s*[xyzw]/.test(c)) out.add('mouse');
      }
    }
    return Array.from(out);
  }
  const md3Auto = (text) => md3Features(text).some((f) => MD3_AUTO.indexOf(f) >= 0);
  // Biçim ayarı ve metin → bu preset MilkDrop 3 kurallarıyla mı okunuyor
  function isMd3(format, text) {
    if (format === 'md3') return true;
    if (format === 'md2') return false;
    return md3Auto(text);
  }

  /* İki okuyuş bu dosyada MOTORUN KULLANDIĞI bir şeyde ayrışıyor mu. Uyum
     anahtarı çevrilince motor presetini ancak o zaman yeniden kuruyor
     (denklem durumu baştan başlıyor); ayrışmıyorsa preset yerinde kalıyor.
     Karşılaştırılan:
      - aşama sürümleri, motorun çıkardığı hâliyle (`md2Versions`) — ham
        `PSVERSION` satırı değil: MilkDrop onu sürüm 200 değilse okumuyor
        ve dosyaların çoğu yine de yazıyor;
      - motorun dosyadan okuduğu sayısal anahtarlar: MilkDrop'un anahtarları
        ve kare değişkeni adları (eski ayrıştırıcı `decay=` gibi bir başlık
        satırını da okuyordu);
      - denklemler boşluksuz, shader'lar satır sonları kırpılarak: MilkDrop
        satır sonundaki boşluğu koruyor, eski ayrıştırıcı kırpıyordu;
      - kodda MilkDrop'un iç işlev adları (`_aboeq` …) varsa metin aynı
        olsa da DERLEME farklı: o adlar yalnız uyum açıkken tanınıyor.
     Boşluksuz karşılaştırma, satır sonundaki bir boşluğun iki simgeyi
     ayırdığı durumu kaçırabilir; o preset bir sonraki yüklenişinde doğru
     okunuyor, yalnız anahtar çevrildiği an eski okuyuşla kalıyor. */
  const MD2_READ_KEYS = new Set();
  function readingsDiffer(text) {
    const a = parseMilk(text);
    const b = parseMilkMd2(text);
    if (!MD2_READ_KEYS.size) {
      // MilkDrop'un aradığı bütün anahtarlar (boş bir dosyada da hepsi aranıyor)
      parseMilkMd2('', MD2_READ_KEYS);
      for (const k of PF_RESET) MD2_READ_KEYS.add(k);
    }
    const eqs = (f) => JSON.stringify([f.init, f.perFrame, f.perPixel,
      (f.waves || []).map((w) => [w.index, w.init, w.per_frame, w.per_point]),
      (f.shapes || []).map((s) => [s.index, s.init, s.per_frame])].map(function strip(x) {
      return Array.isArray(x) ? x.map(strip) : typeof x === 'string' ? x.replace(/\s+/g, '') : x;
    }));
    const shaders = (f) => [f.warpShader, f.compShader].map((s) => String(s || '').replace(/[ \t]+$/gm, '')).join('\u0000');
    if (eqs(a) !== eqs(b) || shaders(a) !== shaders(b)) return true;
    const code = (f) => [f.init, f.perFrame, f.perPixel]
      .concat(...(f.waves || []).map((w) => [w.init, w.per_frame, w.per_point]),
        ...(f.shapes || []).map((s) => [s.init, s.per_frame])).join('\n');
    /* Uyum ayrıştırmayı da değiştiriyor (#580): iç işlev adları, invsqrt,
       öncelik ve birleşme yönü. Tahmin yerine kod iki kipte ayrıştırılıp
       ağaçlar karşılaştırılıyor — yalnız anahtar çevrildiğinde çalışıyor. */
    const tree = (src, md2) => {
      const st = parse(src, { md2 });
      return JSON.stringify({ st, e: st.errors || [] });
    };
    for (const src of [code(a), code(b)]) {
      if (tree(src, false) !== tree(src, true)) return true;
    }
    if (JSON.stringify(md2Versions(a.params)) !== JSON.stringify(md2Versions(b.params))) return true;
    // Sürüm anahtarları bu kümede yok (readVersions kaydetmiyor): yukarıda karşılaştırıldılar
    for (const k of MD2_READ_KEYS) {
      const va = typeof a.params[k] === 'number' ? a.params[k] : undefined;
      const vb = typeof b.params[k] === 'number' ? b.params[k] : undefined;
      if (va !== vb) return true;
    }
    return false;
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

  /* per_pixel'in KENDİ sanal makinesine giden kare girdileri (#580).

     MilkDrop per_pixel'i ayrı bir makinede koşturuyor (state.cpp:214
     `m_pv_eel`). O makine kare denklemlerinin değişkenlerini görmüyor;
     yalnız şunları alıyor:
       • bu liste — kare başına bir kez, per_frame KOŞMADAN ÖNCE
         (milkdropfs.cpp:619-634, yürütme 638-641): per_frame `bass`i
         değiştirse de per_pixel dosyanın/sesin değerini görüyor;
       • q1..q32 — per_frame BİTTİKTEN sonra (649-650);
       • zoom..sy — her düğümde per_frame'in bıraktığı değerler
         (1651-1660), x, y, rad, ang da düğümün kendisi.
     Kendi değişkenleri ve megabuf'ı kareler boyunca kalıyor. Fare bizim
     eklentimiz: alt bloklara gittiği gibi buraya da gidiyor. */
  const PV_IN = ['time', 'fps', 'frame', 'progress', 'bass', 'mid', 'treb', 'bass_att', 'mid_att',
    'treb_att', 'meshx', 'meshy', 'pixelsx', 'pixelsy', 'aspectx', 'aspecty',
    'mouse_x', 'mouse_y', 'mouse_down'];

  /* Dalga per_point'inin KENDİ sanal makinesine gidenler (#580; state.cpp:220
     `m_pp_eel`, değişkenler 424-454). Dalganın per_frame değişkenlerini
     görmüyor; bu liste dalganın per_frame kodu KOŞMADAN ÖNCE, q1..q32 ve
     t1..t8 SONRA kopyalanıyor (milkdropfs.cpp:2405-2421). Nokta başına
     sample, value1, value2, x, y ve renk ayrıca kuruluyor (wavePoint). */
  const PP_IN = ['time', 'fps', 'frame', 'progress', 'bass', 'mid', 'treb', 'bass_att', 'mid_att',
    'treb_att', 'mouse_x', 'mouse_y', 'mouse_down'];

  // Ağ düğümünün girdileri ve hareket değişkenleri, `pixel`in yazdığı sırayla
  const PIX_NAMES = ['x', 'y', 'rad', 'ang', 'zoom', 'zoomexp', 'rot', 'warp', 'cx', 'cy', 'dx', 'dy', 'sx', 'sy'];

  class Preset {
    constructor(text, opts) {
      const o = opts || {};
      /* "MilkDrop uyumu" anahtarı. Görselleştirici her kare kendi ayarını
         buraya yazıyor; alt blokların hangi kare değişkenlerini gördüğünü
         seçiyor (bkz. SHARED_LEGACY). Dosyanın hangi kuralla OKUNDUĞUNU da
         o seçiyor (#580, `readMilk`) — okuyuş kurulumda bir kez yapılıyor ve
         `readAcc`ta kalıyor; anahtar sonradan çevrilirse görselleştirici
         iki okuyuş ayrışıyorsa presetini yeniden kuruyor.

         Derlenmiş kodun hepsi (ana bloklar, dalgalar, şekiller) `_mode`u
         paylaşıyor; anahtar yazılınca o da çevriliyor (`accurate`
         erişimcisi), yani ifadelerin MilkDrop sınamaları aynı karede
         değişiyor. */
      this._mode = { md2: true };
      this.accurate = o.accurate !== false;
      this.readAcc = this.accurate;
      /* BİÇİM (#567): 'md2' | 'md3' | 'auto'. Uyumdan (`accurate`) ayrı bir
         eksen: MilkDrop 3 kurallarında 16 dalga ve şekil yuvası ve q1–q64.
         Otomatikte preset metninden (`md3Auto`). Kurulumda bir kez; ayar
         değişince görselleştirici preseti yeniden kuruyor. */
      this.format = o.format === 'md2' || o.format === 'md3' ? o.format : 'auto';
      this.md3 = isMd3(this.format, text);
      this.slots = this.md3 ? 16 : 4;
      this._nq = this.md3 ? 64 : NUM_Q;
      this.file = readMilk(text, this.accurate, this.slots);
      this.pool = new Pool();
      this.errors = [];
      // `psetname` MilkDrop'un okuduğu bir anahtar değil; ad için metinden
      const pname = /^[ \t]*psetname[ \t]*=(.*)$/im.exec(String(text == null ? '' : text));
      this.name = o.name || (pname ? pname[1].trim() : '') || '';

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
         per_pixel'de uygulamayı dondururdu. Uyum açıkken init ve kare
         blokları MilkDrop'un çağrı sınırına göre daha geniş (loopBudgetMd2):
         korpusta beş preset init'te ~1,07 milyon tur, bir şekil karede
         ~103 bin tur istiyor. Düğüm ve nokta başına bütçe aynı — MilkDrop'un
         çağrı sınırı orada uygulamayı dondururdu. */
      const eel = this._eel();
      this.cInit = compile(this.file.init, this.pool, Object.assign({ seed: o.seed, loopBudget: 1048576, loopBudgetMd2: 4194304 }, eel));
      this.cFrame = compile(this.file.perFrame, this.pool, Object.assign({ seed: o.seed, loopBudget: 65536, loopBudgetMd2: 1048576 }, eel));
      this.cPixel = compile(this.file.perPixel, this.pool, Object.assign({ seed: o.seed, loopBudget: 1024 }, eel));
      /* Uyum açıkken per_pixel kendi havuzunda (PV_IN). Aynı kod iki kez
         derleniyor: kapanışlar havuzun indislerini ve megabuf'ını derleme
         anında bağlıyor, anahtar ise koşarken çevrilebiliyor. Hatalar
         aynı metinden, bir kez sayılıyor. */
      this.pvPool = new Pool();
      this.cPixelMd2 = compile(this.file.perPixel, this.pvPool, Object.assign({ seed: o.seed, loopBudget: 1024 }, eel));
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

    get accurate() { return this._acc; }
    set accurate(v) {
      this._acc = v !== false;
      this._mode.md2 = this._acc;
    }

    /* Derleme seçenekleri: paylaşılan `mode` ve iç adlar. İç adların kararı
       OKUYUŞLA birlikte veriliyor (`readAcc`) — ikisi de kurulumda bir kez;
       anahtar çevrilince görselleştirici presetini yeniden kuruyor. */
    _eel() { return { mode: this._mode, md2Funcs: this.readAcc !== false }; }

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
      /* Yuva sayısının ötesi yok (#567): MilkDrop 2'de 4, MilkDrop 3
         kurallarında 16. Eski okuyucu (uyum kapalı) bütün numaraları
         topluyordu ve 4 numaralı yuvayı açan 7 korpus presetinde MilkDrop'un
         hiç çizmediği bir şekil ya da dalga çiziliyordu. */
      return Array.from(byIdx.keys()).filter((i) => i >= 0 && i < this.slots)
        .sort((a, b) => a - b).map((i) => byIdx.get(i));
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
      const eel = this._eel();
      wave.cInit = compile(w.init || '', pool, Object.assign({ seed: o.seed, loopBudget: 65536, loopBudgetMd2: 4194304 }, eel));
      wave.cFrame = compile(w.per_frame || '', pool, Object.assign({ seed: o.seed, loopBudget: 65536, loopBudgetMd2: 1048576 }, eel));
      wave.cPoint = compile(w.per_point || '', pool, Object.assign({ seed: o.seed, loopBudget: 1024 }, eel));
      /* Uyum açıkken per_point kendi havuzunda, kendi megabuf'ıyla (PP_IN);
         per_pixel gibi iki kez derleniyor. */
      wave.ppPool = new Pool();
      wave.cPointMd2 = compile(w.per_point || '', wave.ppPool, Object.assign({ seed: o.seed, loopBudget: 1024 }, eel));
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
      const eel = this._eel();
      shape.cInit = compile(s.init || '', pool, Object.assign({ seed: o.seed, loopBudget: 65536, loopBudgetMd2: 4194304 }, eel));
      shape.cFrame = compile(s.per_frame || '', pool, Object.assign({ seed: o.seed, loopBudget: 65536, loopBudgetMd2: 1048576 }, eel));
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
      /* Zaman ve ses: MilkDrop dalgaya ve şekle bunları kendi kaynağından
         veriyor (milkdropfs.cpp LoadCustomWavePerFrameEvallibVars,
         LoadCustomShapePerFrameEvallibVars), ana per_frame'in değiştirdiği
         değerden değil. Uyum açıkken per_frame'den ÖNCEKİ değerler
         okunuyor — per_pixel'in aldığı anlık görüntü (PV_IN hepsini
         içeriyor). Korpusta 3 preset per_frame'de bunlardan birini yazıp
         bir dalgada ya da şekilde okuyor. */
      const S = this.accurate !== false ? this.pvPool : P;
      for (const k of SHARED_VARS) pool.set(k, S.get(k));
      if (this.accurate === false) for (const k of SHARED_LEGACY) pool.set(k, P.get(k));
      // Uyum açıkken per_frame'in bıraktığı q; kapalıyken havuzun o anki hâli
      const q = this.accurate !== false ? this._qFrame : null;
      for (let i = 1; i <= this._nq; i++) pool.set('q' + i, q ? q[i - 1] : P.get('q' + i));
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
      const V = w.ppPool;
      for (const k of PP_IN) V.set(k, P.get(k));
      w.cFrame.run(P.values);
      for (let i = 1; i <= this._nq; i++) V.set('q' + i, P.get('q' + i));
      for (let i = 1; i <= 8; i++) V.set('t' + i, P.get('t' + i));
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
      const md2 = this._mode.md2;
      const P = md2 ? w.ppPool : w.pool;
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
      (md2 ? w.cPointMd2 : w.cPoint).run(P.values);
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
      /* Şeklin kare denklemi örnek başına koşuyor (1024'e kadar). Uyum
         açıkken koşu başına bütçe MilkDrop'un çağrı sınırında; tek bir
         şeklin bir karede harcayabileceği toplam ayrıca sınırlı
         (SHAPE_FRAME_LOOPS), yoksa her örneğinde dönen bir preset
         uygulamayı dondururdu. Korpustaki en büyük ihtiyaç ~103 bin tur. */
      if (this._mode.md2) {
        if (instance === 0 || s._loopLeft === undefined) s._loopLeft = SHAPE_FRAME_LOOPS;
        s._loopLeft -= s.cFrame.run(P.values, Math.max(0, s._loopLeft));
      } else {
        s.cFrame.run(P.values);
      }
      const o = out || {};
      for (const k in b) o[k] = P.get(k);
      return o;
    }

    /* Havuzdaki değişkenlere kısayol. Uyum açıkken reg'ler havuzda değil,
       ortak REGS dizisinde. */
    get(name) {
      if (this._mode.md2 && name.charCodeAt(0) === 114 && REG_RE.test(name)) return REGS[+name.slice(3)];
      return this.pool.get(name);
    }
    set(name, v) {
      if (this._mode.md2 && name.charCodeAt(0) === 114 && REG_RE.test(name)) REGS[+name.slice(3)] = Number(v) || 0;
      else this.pool.set(name, v);
    }

    /* Kare başına: girdi değişkenlerini yaz, init'i (bir kez) ve per_frame'i
       koştur. inputs: { time, fps, frame, bass, mid, treb, bass_att, ... } */
    frame(inputs) {
      const P = this.pool;
      if (inputs) for (const k in inputs) P.set(k, inputs[k]);
      /* per_pixel'in girdileri per_frame'den ÖNCE (PV_IN). Anahtar kare
         ortasında çevrilebildiği için kip ne olursa olsun dolduruluyor. */
      const V = this.pvPool;
      for (const k of PV_IN) V.set(k, P.get(k));
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
        this._qInit = new Array(this._nq);
        for (let i = 0; i < this._nq; i++) this._qInit[i] = P.get('q' + (i + 1)) || 0;
      }
      /* Yerlesik kare degiskenleri her karede dosyadaki degere donuyor —
         ilk kare dahil, cunku MilkDrop init'ten sonra da yeniden yukluyor.
         Ayrintili gerekce PF_RESET'in yaninda. */
      for (const k of PF_RESET) P.set(k, base[k]);
      if (this._qInit) for (let i = 0; i < this._nq; i++) P.set('q' + (i + 1), this._qInit[i]);
      this.cFrame.run(P.values);
      /* q'ların KARE değeri, per_pixel koşmadan önce. MilkDrop per_frame
         bittiğinde q1..q32'yi ayrı bir yuva takımına kopyalıyor
         (milkdropfs.cpp:649-650) ve per_vertex kodu o kopyayı yazıyor;
         dalgalar ve şekiller ise per_frame'in bıraktığını okuyor
         (plugin.cpp:2317 ve şeklin eşi). Bizde tek havuz var: ağ
         düğümlerinde q yazan 155 preset (%1,5) aynı karede çizilen
         dalgalara ve şekillere düğümlerin bıraktığı değeri geçiriyordu. */
      if (!this._qFrame) this._qFrame = new Array(this._nq);
      for (let i = 0; i < this._nq; i++) this._qFrame[i] = P.get('q' + (i + 1));
      for (let i = 0; i < this._nq; i++) V.set('q' + (i + 1), this._qFrame[i]);
      return P;
    }

    /* Ağ düğümü başına: x, y, rad, ang yazılır, per_pixel koşar ve hareket
       değişkenleri okunur. Dönüş nesnesi HER ÇAĞRIDA YENİDEN KULLANILIR —
       1728 düğüm için kare başına 1728 nesne ayırmak kabul edilemezdi. */
    pixel(x, y, rad, ang, out) {
      /* Uyum açıkken per_pixel'in kendi havuzu: kare denklemlerinin
         değişkenlerini görmüyor, yazdıkları da kare denklemlerine ve
         çizime sızmıyor (PV_IN). */
      const md2 = this._mode.md2;
      const P = md2 ? this.pvPool : this.pool;
      /* Adlar düğüm başına aranmıyor (#621, genel hız): 64x48 ağda karede
         ~3.200 düğüm, her birinde 24 ad araması demekti. İndisler havuz
         başına bir kez alınıyor ve değişmiyor; dizi ise yeni ad eklenince
         değişebildiği için her çağrıda havuzdan okunuyor. Yazılan değerler
         `Pool.set` ile aynı: sayı değilse ya da NaN ise 0. */
      const I = md2 ? (this._pixMd2 || (this._pixMd2 = PIX_NAMES.map((n) => P.id(n))))
        : (this._pixOld || (this._pixOld = PIX_NAMES.map((n) => P.id(n))));
      const V = P.values;
      const B = this._base;
      V[I[0]] = +x || 0;
      V[I[1]] = +y || 0;
      V[I[2]] = +rad || 0;
      V[I[3]] = +ang || 0;
      // Varsayılanlar her düğümde yeniden kurulur; presetler bunlara güvenir
      // `zoom_base` motorun eski bir kaçamağı; MilkDrop'ta yok, korpusta kullanan yok
      V[I[4]] = +(md2 ? B.zoom : (P.get('zoom_base') || B.zoom)) || 0;
      V[I[5]] = +B.zoomexp || 0;
      V[I[6]] = +B.rot || 0;
      V[I[7]] = +B.warp || 0;
      V[I[8]] = +B.cx || 0;
      V[I[9]] = +B.cy || 0;
      V[I[10]] = +B.dx || 0;
      V[I[11]] = +B.dy || 0;
      V[I[12]] = +B.sx || 0;
      V[I[13]] = +B.sy || 0;
      (md2 ? this.cPixelMd2 : this.cPixel).run(V);
      const o = out || {};
      o.zoom = V[I[4]];
      o.zoomexp = V[I[5]];
      o.rot = V[I[6]];
      o.warp = V[I[7]];
      o.cx = V[I[8]];
      o.cy = V[I[9]];
      o.dx = V[I[10]];
      o.dy = V[I[11]];
      o.sx = V[I[12]];
      o.sy = V[I[13]];
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

  /* DIŞ ve İÇ KENARLIK geometrisi (#580; milkdropfs.cpp:3226-3284).
     Kırpma uzayında (−1..1, en-boya göre DÜZELTİLMEDEN) şerit: dış halka
     `1 − ob`den `1`e, iç halka `1 − ob − ib`den `1 − ob`ye. Her kenar bir
     yamuk (iç köşe, dış köşe, dış köşe, iç köşe), öbür üç kenar onun 90°
     döndürülmüşü; yamuk MilkDrop'un yelpazesiyle iki üçgen. Kalınlık
     sınırlanmıyor: eksi kalınlık tersine dönmüş bir şerit (içte dış şeridin
     üstüne biner), 1'in üstü ortada üst üste binen yamuklar. Halka ancak
     HAM saydamlığı 0,001'i aşarsa, renk sarmasından (colorNorm) önce.
     Dönüş: [{ ring: 0 dış | 1 iç, verts: 24 nokta }]. */
  function borderRings(ob, ib, obA, ibA) {
    const out = [];
    const rings = [[0, obA, 1 - ob, 1], [1, ibA, 1 - ob - ib, 1 - ob]];
    for (const [ring, a, i0, o0] of rings) {
      if (!(a > 0.001) || !isFinite(i0) || !isFinite(o0)) continue;
      let q = [[i0, i0], [o0, o0], [o0, -o0], [i0, -i0]];
      const verts = [];
      for (let side = 0; side < 4; side++) {
        for (const j of [0, 1, 2, 0, 2, 3]) verts.push(q[j].slice());
        q = q.map(([x, y]) => [-y, x]);
      }
      out.push({ ring, verts });
    }
    return out;
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
    clampColor, colorNorm, borderRings, md2Versions, stagePlan, genWarpText, genCompText, md3Features, md3Auto, isMd3,
    echoFlipBits, fixedCompWeights, parseMilkMd2, readMilk, readVersions, readingsDiffer,
    resetGlobals,
    /* Çağrılabilen işlev adları (küçük harf): uyum açıkken ns-eel2'nin
       tablosu ve ad çevirisi, kapalıyken eski tablo ve özel biçimler.
       Düzenleyici bilinmeyen bir adı ayrıştırıcının iç sözü yerine adıyla
       söylüyor (shared/milkdrop-edit.js). */
    callNames: (md2) => (md2
      ? Object.keys(MD2_ARITY).concat(Object.keys(MD2_ALIAS))
      : Object.keys(FUNCS).concat(['if', 'loop', 'while', 'megabuf', 'gmegabuf', 'exec2', 'exec3', 'rand',
        'equal', 'bnot', 'band', 'bor'])),
    // Yalnız testler için: kırpma yardımcılarının iki yolu (bkz. toZero)
    _chop: { toZero, toZeroBits, MUL_MD2, ADD_MD2 } };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (typeof window !== 'undefined') window.SVMilkdrop = api;
})();
