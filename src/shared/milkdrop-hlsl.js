'use strict';
/* HLSL ifadelerinin tip çıkarımı ve GLSL'e daraltılması.

   NEDEN BU DOSYA VAR:
   Çeviricinin metin dönüşümleri shader'ların %80'ini derletiyor. Kalan
   %20'nin neredeyse tamamı TEK bir sebepten kalıyor: HLSL iki farklı
   genişlikteki vektörü toplayınca sessizce dar olana KIRPIYOR, GLSL ise
   hata veriyor. Gerçek koddan: `uv*.3 + .01*rand_frame` — solda float2,
   sağda float4. HLSL bunu float2 okur; GLSL "wrong operand types" der ve
   shader hiç derlenmez.

   Bunu metinle çözmek mümkün değil: hangi tarafın daha geniş olduğunu
   bilmek için ifadenin TİPİNİ bilmek gerekiyor. Bu yüzden burada gerçek
   bir ayrıştırıcı var.

   NEDEN METNİ YENİDEN ÜRETMİYOR:
   Ayrıştırıcı ağacı kuruyor, tipleri çıkarıyor ve yalnızca GEREKEN YERE
   bir daraltma ekliyor — kaynağın geri kalanına dokunmuyor. Ağaçtan GLSL
   yeniden üretmek her düğümü doğru yazma sorumluluğu getirirdi ve zaten
   çalışan %80'i riske atardı. Buradaki iş yalnızca eksik olanı eklemek.

   NEDEN SADECE İFADELER:
   Deyim düzeyi bölme çeviricide zaten çalışıyor. HLSL'in deyim dilbilgisini
   de ayrıştırmak işi ikiye katlar ve hiçbir hatayı çözmez. */
(function () {
  // ------------------------------------------------------------- sözcükleme

  const PUNCT = [
    '<<=', '>>=', '&&', '||', '==', '!=', '<=', '>=', '<<', '>>',
    '+=', '-=', '*=', '/=', '%=', '&=', '|=', '^=', '++', '--',
    '(', ')', '[', ']', '{', '}', ',', ';', '?', ':', '.',
    '+', '-', '*', '/', '%', '<', '>', '!', '~', '&', '|', '^', '=',
  ];

  function tokenize(src) {
    const out = [];
    let i = 0;
    while (i < src.length) {
      const c = src[i];
      if (c === ' ' || c === '\t' || c === '\n' || c === '\r') { i++; continue; }
      if ((c >= '0' && c <= '9') || (c === '.' && src[i + 1] >= '0' && src[i + 1] <= '9')) {
        const s = i;
        while (i < src.length && /[0-9.]/.test(src[i])) i++;
        if (src[i] === 'e' || src[i] === 'E') {
          i++;
          if (src[i] === '+' || src[i] === '-') i++;
          while (i < src.length && src[i] >= '0' && src[i] <= '9') i++;
        }
        if (src[i] === 'f' || src[i] === 'F') i++;
        out.push({ k: 'num', v: src.slice(s, i), s, e: i });
        continue;
      }
      if (/[A-Za-z_]/.test(c)) {
        const s = i;
        while (i < src.length && /[A-Za-z0-9_]/.test(src[i])) i++;
        out.push({ k: 'id', v: src.slice(s, i), s, e: i });
        continue;
      }
      let hit = null;
      for (const p of PUNCT) {
        if (src.startsWith(p, i)) { hit = p; break; }
      }
      if (!hit) { i++; continue; }
      out.push({ k: 'p', v: hit, s: i, e: i + hit.length });
      i += hit.length;
    }
    return out;
  }

  // ------------------------------------------------------------ ayrıştırma

  /* Öncelik basamakları, düşükten yükseğe. GLSL ve HLSL bu noktada aynı;
     yanlış bir öncelik daraltmayı yanlış düğüme koyardı ve hatayı taşırdı. */
  const BINOPS = [
    ['||'], ['&&'], ['|'], ['^'], ['&'],
    ['==', '!='], ['<', '>', '<=', '>='], ['<<', '>>'],
    ['+', '-'], ['*', '/', '%'],
  ];

  function parse(tokens) {
    let pos = 0;
    const peek = () => tokens[pos];
    const eat = (v) => {
      const t = tokens[pos];
      if (t && t.k === 'p' && t.v === v) { pos++; return true; }
      return false;
    };

    function primary() {
      const t = peek();
      if (!t) return null;
      if (t.k === 'num') { pos++; return { k: 'num', s: t.s, e: t.e }; }
      if (t.k === 'p' && t.v === '(') {
        const open = t.s;
        pos++;
        const inner = expr();
        eat(')');
        const close = tokens[pos - 1] ? tokens[pos - 1].e : open + 1;
        return postfix({ k: 'paren', a: inner, s: open, e: close });
      }
      if (t.k === 'p' && (t.v === '-' || t.v === '+' || t.v === '!' || t.v === '~')) {
        pos++;
        const a = unary();
        return { k: 'un', op: t.v, a, s: t.s, e: a ? a.e : t.e };
      }
      if (t.k === 'id') {
        pos++;
        let node = { k: 'id', name: t.v, s: t.s, e: t.e };
        if (peek() && peek().k === 'p' && peek().v === '(') {
          pos++;
          const args = [];
          if (!(peek() && peek().k === 'p' && peek().v === ')')) {
            for (;;) {
              const a = expr();
              if (a) args.push(a);
              if (!eat(',')) break;
            }
          }
          eat(')');
          const end = tokens[pos - 1] ? tokens[pos - 1].e : t.e;
          node = { k: 'call', name: t.v, args, s: t.s, e: end };
        }
        return postfix(node);
      }
      pos++;
      return { k: 'unknown', s: t.s, e: t.e };
    }

    function postfix(node) {
      for (;;) {
        const t = peek();
        if (!t || t.k !== 'p') return node;
        if (t.v === '.') {
          const nx = tokens[pos + 1];
          if (!nx || nx.k !== 'id') return node;
          pos += 2;
          node = { k: 'member', a: node, name: nx.v, s: node.s, e: nx.e };
          continue;
        }
        if (t.v === '[') {
          pos++;
          const idx = expr();
          eat(']');
          const end = tokens[pos - 1] ? tokens[pos - 1].e : node.e;
          node = { k: 'index', a: node, i: idx, s: node.s, e: end };
          continue;
        }
        return node;
      }
    }

    function unary() { return primary(); }

    function bin(level) {
      if (level >= BINOPS.length) return unary();
      let left = bin(level + 1);
      for (;;) {
        const t = peek();
        if (!t || t.k !== 'p' || BINOPS[level].indexOf(t.v) < 0) return left;
        pos++;
        const right = bin(level + 1);
        left = { k: 'bin', op: t.v, a: left, b: right, s: left ? left.s : t.s, e: right ? right.e : t.e };
      }
    }

    function expr() {
      const c = bin(0);
      const t = peek();
      if (t && t.k === 'p' && t.v === '?') {
        pos++;
        const a = expr();
        eat(':');
        const b = expr();
        return { k: 'sel', c, a, b, s: c ? c.s : t.s, e: b ? b.e : t.e };
      }
      return c;
    }

    const root = expr();
    return root;
  }

  // ------------------------------------------------------------- tip bilgisi

  const WIDTH = { float: 1, vec2: 2, vec3: 3, vec4: 4, bool: 1 };
  const BY_WIDTH = [null, 'float', 'vec2', 'vec3', 'vec4'];

  /* Yerleşiklerin dönüş tipi. `same` ilk argümanın tipini döndürüyor. */
  const FN = {
    tex2D: 'vec3', tex3D: 'vec3', tex2Dlod: 'vec3', tex2Dbias: 'vec3',
    texture: 'vec4', textureLod: 'vec4',
    GetBlur0: 'vec3', GetBlur1: 'vec3', GetBlur2: 'vec3', GetBlur3: 'vec3',
    GetPixel: 'vec3',
    lum: 'float', length: 'float', dot: 'float', distance: 'float',
    atan2: 'float', rsqrt: 'float',
    float: 'float', vec2: 'vec2', vec3: 'vec3', vec4: 'vec4',
    toF: 'float', toV2: 'vec2', toV3: 'vec3', toV4: 'vec4',
    hmat2: 'mat2', hmat3: 'mat3', hmat4: 'mat4',
    mat2: 'mat2', mat3: 'mat3', mat4: 'mat4',
    abs: 'same', normalize: 'same', saturate: 'same', frac: 'same', fract: 'same',
    floor: 'same', ceil: 'same', sqrt: 'same', exp: 'same', log: 'same',
    exp2: 'same', log2: 'same', sign: 'same',
    sin: 'same', cos: 'same', tan: 'same', asin: 'same', acos: 'same', atan: 'same',
    mix: 'same', lerp: 'same', clamp: 'same', min: 'same', max: 'same',
    mdPow: 'same', pow: 'same', mod: 'same', fmod: 'same',
    step: 'arg2', smoothstep: 'arg3',
    ddx: 'same', ddy: 'same', dFdx: 'same', dFdy: 'same',
    cross: 'vec3', reflect: 'same', refract: 'same',
  };

  const SWIZZLE = /^[xyzwrgbastpq]+$/;

  function typeOf(node, env) {
    if (!node) return 'unknown';
    switch (node.k) {
      case 'num': return 'float';
      case 'paren': return typeOf(node.a, env);
      case 'un': return node.op === '!' ? 'bool' : typeOf(node.a, env);
      case 'id': return env.get(node.name) || 'unknown';
      case 'index': {
        const t = typeOf(node.a, env);
        if (t === 'mat2') return 'vec2';
        if (t === 'mat3') return 'vec3';
        if (t === 'mat4') return 'vec4';
        return WIDTH[t] ? 'float' : 'unknown';
      }
      case 'member': {
        if (!SWIZZLE.test(node.name)) return 'unknown';
        const base = typeOf(node.a, env);
        if (!WIDTH[base] && base !== 'unknown') return 'unknown';
        return BY_WIDTH[node.name.length] || 'unknown';
      }
      case 'call': {
        const r = FN[node.name];
        if (!r) return 'unknown';
        if (r === 'same') return typeOf(node.args[0], env);
        if (r === 'arg2') return typeOf(node.args[1], env);
        if (r === 'arg3') return typeOf(node.args[2], env);
        return r;
      }
      case 'sel': {
        const a = typeOf(node.a, env);
        return a !== 'unknown' ? a : typeOf(node.b, env);
      }
      case 'bin': {
        if (['==', '!=', '<', '>', '<=', '>=', '&&', '||'].indexOf(node.op) >= 0) return 'bool';
        const a = typeOf(node.a, env);
        const b = typeOf(node.b, env);
        if (a === 'unknown' || b === 'unknown') return a === 'unknown' ? b : a;
        // Matris çarpımı vektör döndürür; daraltma buraya uygulanmamalı
        if (a.startsWith('mat') || b.startsWith('mat')) return a.startsWith('mat') ? b : a;
        const wa = WIDTH[a] || 0;
        const wb = WIDTH[b] || 0;
        if (!wa || !wb) return 'unknown';
        // HLSL kuralı: skaler yayılır, iki vektörden DAR olanı kazanır
        if (wa === 1) return b === 'bool' ? 'float' : b;
        if (wb === 1) return a === 'bool' ? 'float' : a;
        return BY_WIDTH[Math.min(wa, wb)];
      }
      default: return 'unknown';
    }
  }

  // --------------------------------------------------------------- daraltma

  /* Ağacı gezip yalnızca gereken yerlere yama toplar.

     İki tür yama var:
       daraltma  `(ifade).xy` — geniş operandı dar olana indirir
       sayıya    `float(ifade)` — karşılaştırmayı aritmetikte kullanılır kılar

     Yamalar konumla toplanıp SONDAN BAŞA uygulanıyor; baştan uygulamak
     sonraki konumları kaydırırdı. */
  /* Argümanlarının tipleri BİRBİRİYLE uyuşmak zorunda olan yerleşikler.
     HLSL burada da sessizce kırpıyor: `lerp(float3, float2, t)` orada
     geçerli, GLSL'de "no matching overloaded function" — derleme kapısında
     kalan en büyük kova buydu. Skaler argümanlar dokunulmadan geçiyor,
     çünkü GLSL zaten `mix(vec3, vec3, float)` biçimini tanıyor. */
  const MATCH_ARGS = {
    mix: 1, lerp: 1, min: 1, max: 1, clamp: 1, mdPow: 1, pow: 1,
    mod: 1, fmod: 1, dot: 1, distance: 1, cross: 1, step: 1,
    smoothstep: 1, atan: 1, reflect: 1,
  };

  function collect(node, env, patches) {
    if (!node) return;
    switch (node.k) {
      case 'paren': collect(node.a, env, patches); return;
      case 'un':
        collect(node.a, env, patches);
        /* `-(a<b)` HLSL'de geçerli: bool sayıya döner. GLSL'de bool'un
           eksisi yok. */
        if (node.op !== '!' && typeOf(node.a, env) === 'bool') {
          patches.push({ s: node.a.s, e: node.a.e, wrap: 'float' });
        }
        /* `!x` HLSL'de sayıda da geçerli (sıfırsa doğru). GLSL'de yalnızca
           bool alıyor, o yüzden karşılaştırmaya çevriliyor. */
        if (node.op === '!' && node.a && typeOf(node.a, env) !== 'bool') {
          patches.push({ s: node.s, e: node.e, notZero: true, inner: [node.a.s, node.a.e] });
        }
        return;
      case 'member': {
        collect(node.a, env, patches);
        /* `lum(ret).x` HLSL'de geçerli: skalerin bileşeni yine kendisi,
           `.xxx` ise üçe yayılması demek. GLSL ikisini de reddediyor. */
        if (SWIZZLE.test(node.name) && typeOf(node.a, env) === 'float') {
          const n = node.name.length;
          patches.push({ s: node.s, e: node.e, scalarSwz: n, inner: [node.a.s, node.a.e] });
        }
        return;
      }
      case 'index': collect(node.a, env, patches); collect(node.i, env, patches); return;
      case 'call': {
        for (const a of node.args) collect(a, env, patches);
        if (!MATCH_ARGS[node.name] || node.args.length < 2) return;
        let keep = 5;
        for (const a of node.args) {
          const w = WIDTH[typeOf(a, env)] || 0;
          if (w > 1 && w < keep) keep = w;
        }
        if (keep > 4) return;
        for (const a of node.args) {
          const w = WIDTH[typeOf(a, env)] || 0;
          if (w > keep) patches.push({ s: a.s, e: a.e, swz: '.' + 'xyzw'.slice(0, keep) });
        }
        return;
      }
      case 'sel':
        collect(node.c, env, patches);
        collect(node.a, env, patches);
        collect(node.b, env, patches);
        return;
      case 'bin': {
        collect(node.a, env, patches);
        collect(node.b, env, patches);
        const cmp = ['==', '!=', '<', '>', '<=', '>=', '&&', '||'].indexOf(node.op) >= 0;
        if (cmp) {
          /* HLSL vektörleri karşılaştırıp sonucu tek bir doğruluk değerine
             indirebiliyor; GLSL'de karşılaştırma yalnızca skalerlerde var.
             İlk bileşene indirgeniyor — YAKLAŞIK: HLSL'in kuralı bütün
             bileşenlere bakmak, ama bu presetlerde karşılaştırmalar zaten
             tek bir eşik denetimi. */
          const wa = WIDTH[typeOf(node.a, env)] || 0;
          const wb = WIDTH[typeOf(node.b, env)] || 0;
          // Bir taraf vektörse yeter: GLSL'de karşılaştırma yalnızca skalerlerde
          if (wa > 1) patches.push({ s: node.a.s, e: node.a.e, swz: '.x' });
          if (wb > 1) patches.push({ s: node.b.s, e: node.b.e, swz: '.x' });
          return;
        }
        const a = typeOf(node.a, env);
        const b = typeOf(node.b, env);
        // Aritmetikte bool sayıya çevrilir
        if (a === 'bool') patches.push({ s: node.a.s, e: node.a.e, wrap: 'float' });
        if (b === 'bool') patches.push({ s: node.b.s, e: node.b.e, wrap: 'float' });
        if (a === 'bool' || b === 'bool') return;
        if (a.startsWith && (a.startsWith('mat') || b.startsWith('mat'))) return;
        const wa = WIDTH[a] || 0;
        const wb = WIDTH[b] || 0;
        if (!wa || !wb || wa === wb) return;
        if (wa === 1 || wb === 1) return;    // skaler yayılımı GLSL'de de var
        const keep = Math.min(wa, wb);
        const target = wa > wb ? node.a : node.b;
        patches.push({ s: target.s, e: target.e, swz: '.' + 'xyzw'.slice(0, keep) });
        return;
      }
      default: return;
    }
  }

  /* Bir ifade metnini alır, gereken daraltmaları ekleyip döndürür.
     `env` ad -> tip çizelgesi (Map). Ayrıştırılamayan bir şey varsa metin
     OLDUĞU GİBİ dönüyor: yarım anlaşılmış bir ifadeye dokunmak, hiç
     dokunmamaktan kötü. */
  function narrowExpr(text, env) {
    /* ÇOK GEÇİŞ. Yamalar iç içe olabiliyor: `(!sw)*ret` içeride `!`i
       karşılaştırmaya çeviriyor, dışarıda sonucu sayıya. Tek geçişte
       ikisini birden uygulamak konumları kaydırırdı, bu yüzden her geçişte
       yalnızca iç içe OLMAYAN yamalar uygulanıp metin yeniden ayrıştırılıyor.
       Dört geçiş fazlasıyla yetiyor; sınır sonsuz döngüye karşı. */
    let out = text;
    for (let pass = 0; pass < 4; pass++) {
      const next = narrowOnce(out, env);
      if (next === out) break;
      out = next;
    }
    return out;
  }

  function narrowOnce(text, env) {
    /* Hızlı çıkış: dönüşüm gerektirebilecek hiçbir işaret yoksa ayrıştırma.
       Nokta da sayılıyor — `rad.xxx` gibi yalnızca swizzle içeren bir ifade
       de dönüşüm istiyor ve önce bu denetimden kaçıyordu. */
    if (!text || (text.indexOf('(') < 0 && !/[-+*/!.]/.test(text))) return text;
    let root;
    try { root = parse(tokenize(text)); } catch (e) { return text; }
    if (!root) return text;
    const patches = [];
    try { collect(root, env, patches); } catch (e) { return text; }
    if (!patches.length) return text;
    patches.sort((x, y) => y.s - x.s || y.e - x.e);
    let out = text;
    let lastS = Infinity;
    for (const p of patches) {
      // İç içe geçen yamalarda dıştakini atla: konumlar kayardı
      if (p.e > lastS) continue;
      const seg = out.slice(p.s, p.e);
      let rep;
      if (p.notZero) rep = '(' + out.slice(p.inner[0], p.inner[1]) + ' == 0.0)';
      else if (p.wrap) rep = p.wrap + '(' + seg + ')';
      else if (p.scalarSwz) {
        const base = out.slice(p.inner[0], p.inner[1]);
        rep = p.scalarSwz === 1 ? '(' + base + ')' : 'vec' + p.scalarSwz + '(' + base + ')';
      } else rep = '(' + seg + ')' + p.swz;
      out = out.slice(0, p.s) + rep + out.slice(p.e);
      lastS = p.s;
    }
    return out;
  }

  const api = { tokenize, parse, typeOf, narrowExpr, FN, WIDTH };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (typeof window !== 'undefined') window.SVMilkdropHLSL = api;
})();
