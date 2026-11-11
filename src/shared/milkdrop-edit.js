/*
 * SoundVisualizer — CaYaDev Ses Görselleştirici
 * Copyright (c) 2026 Çağan Turgut (CaYatur) — CaYaDev, https://cayadev.com
 * https://github.com/CaYatur/SoundVisualizer
 * SPDX-License-Identifier: MIT
 */
'use strict';
/* MİLKDROP PRESET DÜZENLEYİCİ — metin tarafı (#578). Arayüz: admin/milkdrop-editor.js.

   Bir .milk dosyasını düzenlenebilir bloklara ayırır, düzenlenmiş blokları
   dosyaya geri yazar, hataları PRESETİN SATIRINA bağlar ve ana değerleri
   (zoom, warp, dönme, sönüm, yankı) okuyup yazar.

   Dosya MilkDrop'un okuduğu gibi okunuyor (shared/milkdrop.js
   `parseMilkMd2`): kod satırları `per_frame_1`, `per_frame_2`… diye
   numaralı ve MilkDrop 1'den başlayıp ilk EKSİK numarada duruyor; aradaki
   boşluktan sonrakiler onun için yok. Düzenleyici de onları göstermiyor ve
   geri yazarken satırları 1'den kesintisiz numaralıyor.

   YAZILAN HER ŞEY DOSYANIN KENDİ BİÇİMİNDE. Blok dışındaki satırlara
   (başlık, dalga ve şekil parametreleri, bilinmeyen anahtarlar)
   dokunulmuyor; bir blok dosyadaki yerine yazılıyor. Satır sonu biçimi
   (CRLF ya da LF) korunuyor.

   Denklem satırları MilkDrop'ta ARAYA BİR ŞEY KONMADAN yapışıyor
   (satır sonu ayırıcı değil, deyimleri `;` ayırıyor). Düzenleyici satırları
   olduğu gibi yazıyor; iki satırın yapışıp tek bir ad oluşturması MilkDrop'ta
   da olurdu ve hata listesinde görünüyor. */
(function () {
  // Kod blokları: kimlik, dosyadaki anahtar öneki, shader mi
  const MAIN_BLOCKS = [
    { id: 'per_frame_init', prefix: 'per_frame_init_' },
    { id: 'per_frame', prefix: 'per_frame_' },
    { id: 'per_pixel', prefix: 'per_pixel_' },
    { id: 'warp', prefix: 'warp_', shader: true },
    { id: 'comp', prefix: 'comp_', shader: true },
  ];
  const WAVE_PARTS = ['init', 'per_frame', 'per_point'];
  const SHAPE_PARTS = ['init', 'per_frame'];
  /* Tanınan yuva: MilkDrop 3 kurallarında 16 (#567). Bir dosya kaç yuvayla
     OKUNUYOR ayrı soru — `read` ve `write`ın `slots`u: MilkDrop 2 kuralında
     4, ve 4'ün ötesindeki satırlara dokunulmuyor. */
  const SLOTS = 16;

  function blockDefs() {
    const out = MAIN_BLOCKS.slice();
    for (let i = 0; i < SLOTS; i++) {
      for (const p of WAVE_PARTS) out.push({ id: 'wave_' + i + '_' + p, prefix: 'wave_' + i + '_' + p, wave: i });
    }
    for (let i = 0; i < SLOTS; i++) {
      for (const p of SHAPE_PARTS) out.push({ id: 'shape_' + i + '_' + p, prefix: 'shape_' + i + '_' + p, shape: i });
    }
    return out;
  }
  const BLOCKS = blockDefs();
  const BLOCK_BY_ID = {};
  for (const b of BLOCKS) BLOCK_BY_ID[b.id] = b;

  /* Ana değerler: MilkDrop'un dosya anahtarı (yazımı birebir) ve
     denklemlerdeki adı. Aralıklar kaydırıcı için; dosyadaki değer aralık
     dışındaysa kaydırıcı o değeri kırpmıyor, yalnız gösteriyor. */
  const VALUES = [
    { id: 'zoom', key: 'zoom', name: 'zoom', min: 0.5, max: 1.5, step: 0.001, dflt: 1 },
    { id: 'warp', key: 'warp', name: 'warp', min: 0, max: 5, step: 0.01, dflt: 1 },
    { id: 'rot', key: 'rot', name: 'rot', min: -1, max: 1, step: 0.001, dflt: 0 },
    { id: 'decay', key: 'fDecay', name: 'decay', min: 0.5, max: 1, step: 0.001, dflt: 0.98 },
    { id: 'echoZoom', key: 'fVideoEchoZoom', name: 'echo_zoom', min: 0.5, max: 3, step: 0.001, dflt: 1 },
    { id: 'echoAlpha', key: 'fVideoEchoAlpha', name: 'echo_alpha', min: 0, max: 1, step: 0.01, dflt: 0 },
  ];

  /* Satırlar ayırıcılarıyla birlikte. MilkDrop dosyayı satır satır LF'ye
     kadar okuyor (fgets); CR yalnız DEĞERİ bitiriyor, satırı değil — tek
     başına bir CR'den sonraki anahtar onun için yok. Korpusta CRLF ile LF'yi
     karışık yazan dosyalar var. Ayırıcı satırla taşınıyor ki dokunulmayan
     satır baytı baytına aynı kalsın. */
  function splitKeep(text) {
    const s = String(text == null ? '' : text);
    const out = [];
    let last = 0;
    for (let i = s.indexOf('\n'); i >= 0; i = s.indexOf('\n', last)) {
      const cr = i > last && s.charCodeAt(i - 1) === 13;
      out.push({ text: s.slice(last, cr ? i - 1 : i), sep: cr ? '\r\n' : '\n' });
      last = i + 1;
    }
    if (last < s.length) out.push({ text: s.slice(last), sep: '' });
    return out;
  }
  const splitLines = (text) => splitKeep(text).map((x) => x.text);
  // Yeni satırların ayırıcısı: dosyada en çok kullanılan
  const eolOf = (text) => {
    const s = String(text || '');
    const crlf = (s.match(/\r\n/g) || []).length;
    const lf = (s.match(/\n/g) || []).length - crlf;
    return crlf >= lf && crlf > 0 ? '\r\n' : '\n';
  };
  // Anahtar: satır başından '=' ya da boşluğa kadar (MilkDrop'un dizini gibi)
  const keyOf = (line) => { const m = /^([^\s=]+)[ =]/.exec(line); return m ? m[1] : null; };
  // Değer: satır sonuna ya da ilk CR'ye kadar (MilkDrop'un okuduğu kadar)
  const valueOf = (line) => { const m = /^[^\s=]+[ =]([^\r]*)/.exec(line); return m ? m[1] : ''; };

  // Motor: tarayıcıda sayfanın, Node'da (testler) modülün kendisi
  const engine = () => (typeof window !== 'undefined' && window.SVMilkdrop)
    || (typeof require === 'function' ? require('./milkdrop.js') : null);

  /* Dosyayı okur: { blocks: { id: [satır, …] }, values: { id: sayı|null } }.
     Bloklar MilkDrop'un okuduğu satırlar (motorun `parseMilkMd2`si: 1'den
     ilk eksik numaraya, yinelenen numarada aramanın bulduğu). Satırın
     baştaki ters tırnağı (MilkDrop'un satır işareti) gösterilmiyor; shader
     satırlarına geri yazarken ekleniyor. */
  function read(source, slots) {
    const lines = splitLines(source);
    const M = engine();
    const raw = {};
    if (M && M.parseMilkMd2) M.parseMilkMd2(String(source == null ? '' : source), null, raw, slots === 16 ? 16 : 4);
    const blocks = {};
    for (const b of BLOCKS) blocks[b.id] = (raw[b.prefix] || []).slice();
    const values = {};
    for (const v of VALUES) {
      let found = null;
      for (const l of lines) {
        const k = keyOf(l);
        if (k && k.toLowerCase() === v.key.toLowerCase()) {
          const n = parseFloat(valueOf(l));
          found = isFinite(n) ? n : null;
          break;
        }
      }
      values[v.id] = found;
    }
    return { blocks, values };
  }

  // Bir satır hangi bloğa ait (numarası ne olursa olsun); değilse null
  function blockOfLine(line) {
    const k = keyOf(line);
    if (!k) return null;
    for (const b of BLOCKS) {
      if (k.length > b.prefix.length && k.slice(0, b.prefix.length) === b.prefix && /^\d+$/.test(k.slice(b.prefix.length))) {
        /* `per_frame_` öneki `per_frame_init_1`i de tutardı: numaradan
           önce yalnız rakam olmalı, `init_1` değil. */
        return b.id;
      }
    }
    return null;
  }

  /* Sayı metni: altı basamak (MilkDrop'un %f'i), sondaki sıfırlar dosyanın
     kendi basamak sayısına ya da en az üçe kadar atılıyor. Değer hiçbir
     zaman kısaltılmıyor: 1,2345 dosyada üç basamak olsa da 1.2345 yazılıyor. */
  const numText = (n, like) => {
    const m = like ? /\.(\d+)/.exec(like) : null;
    const keep = m ? Math.min(6, Math.max(3, m[1].length)) : 3;
    let s = (Math.abs(n) < 1e-12 ? 0 : n).toFixed(6);
    const dot = s.indexOf('.');
    while (s.length - dot - 1 > keep && s.endsWith('0')) s = s.slice(0, -1);
    return s;
  };

  /* Düzenlenmiş blokları ve değerleri dosyaya yazar. `blocks` verilmeyen
     blok dosyadaki hâliyle kalır (yeniden numaralanmadan). Bir blok
     dosyadaki İLK satırının yerine yazılıyor; dosyada hiç yoksa: dalga ve
     şekil kodu kendi parametrelerinin ardına, ötekiler dosyanın sonuna,
     MilkDrop'un kendi sırasıyla. */
  function write(source, blocks, values, slots) {
    const eol = eolOf(source);
    const items = splitKeep(source);
    /* Yalnız DEĞİŞEN bloklar yazılıyor: aynısı verilen blok dosyadaki
       satırlarıyla, yerinde ve numarasıyla kalıyor (dosya baytı baytına
       aynı kalsın; MilkDrop'un aramasına göre sıra zaten önemsiz). */
    const now = read(source, slots);
    const want = {};
    for (const id in (blocks || {})) {
      if (!BLOCK_BY_ID[id]) continue;
      const a = blocks[id] || [];
      const b = now.blocks[id] || [];
      if (a.length !== b.length || a.some((x, i) => x !== b[i])) want[id] = a;
    }
    const out = [];
    const placed = new Set();
    const lineOf = (b, v, i) => ({ text: b.prefix + (i + 1) + '=' + (b.shader ? '`' : '') + v, sep: eol });
    /* Araya satır koyar. Dosya satır sonuyla bitmiyorsa (son öğenin ayırıcısı
       boş) öyle bitmeye devam etsin: o öğe ayırıcı alıyor, yeni son öğe
       almıyor. */
    const insert = (at, chunk) => {
      if (!chunk.length) return;
      const prev = out[at - 1];
      if (prev && prev.sep === '' ) { prev.sep = eol; chunk[chunk.length - 1].sep = ''; }
      out.splice(at, 0, ...chunk);
    };
    for (const it of items) {
      const id = blockOfLine(it.text);
      if (id && Object.prototype.hasOwnProperty.call(want, id)) {
        if (!placed.has(id)) {
          const b = BLOCK_BY_ID[id];
          const chunk = want[id].map((v, i) => lineOf(b, v, i));
          // Blok boşaldıysa yerindeki satırın ayırıcısı kaybolmasın
          if (chunk.length) chunk[chunk.length - 1].sep = it.sep;
          out.push(...chunk);
          placed.add(id);
        }
        continue;
      }
      out.push({ text: it.text, sep: it.sep });
    }
    // Dosyada olmayan bloklar
    for (const b of BLOCKS) {
      if (placed.has(b.id) || !Object.prototype.hasOwnProperty.call(want, b.id) || !want[b.id].length) continue;
      const own = b.wave !== undefined ? 'wavecode_' + b.wave + '_' : b.shape !== undefined ? 'shapecode_' + b.shape + '_' : '';
      let at = -1;
      if (own) {
        for (let i = 0; i < out.length; i++) {
          const k = keyOf(out[i].text);
          if (k && k.indexOf(own) === 0) at = i;
          // Aynı dalganın/şeklin daha önce yazılmış kod satırlarının da ardına
          const id = blockOfLine(out[i].text);
          const d = id && BLOCK_BY_ID[id];
          if (d && ((b.wave !== undefined && d.wave === b.wave) || (b.shape !== undefined && d.shape === b.shape))) at = i;
        }
      }
      insert(at >= 0 ? at + 1 : out.length, want[b.id].map((v, i) => lineOf(b, v, i)));
      placed.add(b.id);
    }
    // Değerler: var olan satır yerinde, yoksa ilk kod satırından önce
    for (const v of VALUES) {
      if (!values || values[v.id] === undefined || values[v.id] === null) continue;
      const n = Number(values[v.id]);
      if (!isFinite(n)) continue;
      // Değişmeyen değerin satırı olduğu gibi (`fDecay=0.9` `0.900` olmasın)
      if (now.values[v.id] !== null && now.values[v.id] === n) continue;
      const hit = out.findIndex((l) => { const k = keyOf(l.text); return k && k.toLowerCase() === v.key.toLowerCase(); });
      if (hit >= 0) {
        out[hit].text = v.key + '=' + numText(n, valueOf(out[hit].text));
      } else {
        let at = out.findIndex((l) => blockOfLine(l.text) !== null);
        if (at < 0) at = out.length;
        insert(at, [{ text: v.key + '=' + numText(n), sep: eol }]);
      }
    }
    return out.map((l) => l.text + l.sep).join('');
  }

  // ------------------------------------------------------------------ hatalar

  /* Bir denklem bloğunu MilkDrop'un birleştirdiği gibi birleştirir ve her
     karakterin hangi satırdan geldiğini tutar. Yorum satır satır kesiliyor
     (`//` ve `\\`, MilkDrop'un okuyuşu), satırlar yapışıyor. */
  function glue(lines) {
    let text = '';
    const lineAt = [];
    lines.forEach((l, i) => {
      const a = l.indexOf('//');
      const b = l.indexOf('\\\\');
      const cut = a < 0 ? b : b < 0 ? a : Math.min(a, b);
      const s = cut < 0 ? l : l.slice(0, cut);
      text += s;
      for (let k = 0; k < s.length; k++) lineAt.push(i);
    });
    return { text, lineAt };
  }

  /* Üst düzey `;`lerde deyimlere böler (parantez ve köşeli parantez
     içindekiler deyimin parçası: MilkDrop onları sıra işlemine çeviriyor).
     Her deyim: metni ve ilk dolu karakterinin satırı. */
  function statements(lines) {
    const { text, lineAt } = glue(lines);
    const out = [];
    let depth = 0;
    let start = 0;
    const flush = (end) => {
      const s = text.slice(start, end);
      const lead = s.length - s.replace(/^\s+/, '').length;
      if (s.trim()) out.push({ text: s, line: lineAt[start + lead] !== undefined ? lineAt[start + lead] : 0 });
    };
    for (let i = 0; i < text.length; i++) {
      const c = text[i];
      if (c === '(' || c === '[') depth++;
      else if ((c === ')' || c === ']') && depth > 0) depth--;
      else if (c === ';' && depth === 0) { flush(i); start = i + 1; }
    }
    flush(text.length);
    return out;
  }

  // Deyimde çağrılan ve motorun tanımadığı ilk işlev adı; yoksa ''
  function unknownCall(text, M, md2) {
    if (!M || typeof M.callNames !== 'function') return '';
    const known = new Set(M.callNames(!!md2).map((n) => String(n).toLowerCase()));
    const re = /([A-Za-z_][A-Za-z0-9_]*)\s*\(/g;
    let m;
    while ((m = re.exec(text))) {
      if (!known.has(m[1].toLowerCase())) return m[1];
    }
    return '';
  }

  // Parantez dengesi: açık kalan ya da fazladan kapanan ilk parantez
  function balance(text) {
    let depth = 0;
    for (const c of text) {
      if (c === '(' || c === '[') depth++;
      else if (c === ')' || c === ']') { if (--depth < 0) return 'paren-close'; }
    }
    return depth > 0 ? 'paren-open' : '';
  }

  /* Denklem bloklarının hataları: { block, line (0'dan), code, detail, text }.
     Her deyim tek başına ayrıştırılıyor, hata o deyimin başladığı satıra
     yazılıyor ve deyimin PRESETTEKİ metni veriliyor — motorun önişlenmiş
     kodu (`_set(…)`) değil. `code`: 'paren-open' | 'paren-close' | 'parse';
     'parse'ta `detail` ayrıştırıcının kısa sözü. `md2` MilkDrop'un okuyuşu
     (uyum açık): orada tek bir hatalı deyim bütün bloğu düşürüyor; bu da
     `code: 'dropped'` ve `line: -1` ile söyleniyor. */
  function diagnose(blocks, M, md2) {
    const out = [];
    if (!M || !M.parse) return out;
    for (const b of BLOCKS) {
      if (b.shader) continue;
      const lines = (blocks && blocks[b.id]) || [];
      if (!lines.length) continue;
      let bad = 0;
      for (const st of statements(lines)) {
        const text = st.text.trim().replace(/\s+/g, ' ').slice(0, 90);
        const par = balance(st.text);
        if (par) {
          bad++;
          out.push({ block: b.id, line: st.line, code: par, detail: '', text });
          continue;
        }
        let errs = [];
        try {
          const r = M.parse(st.text, md2 ? { md2: true } : undefined);
          errs = (r && r.errors) || [];
        } catch (e) {
          errs = [String((e && e.message) || e)];
        }
        if (errs.length) {
          bad++;
          const unknown = unknownCall(st.text, M, md2);
          if (unknown) {
            out.push({ block: b.id, line: st.line, code: 'unknown-func', detail: unknown, text });
            continue;
          }
          // Ayrıştırıcının sözü; ardındaki üretilmiş kod atılıyor
          const detail = String(errs[0]).split(' — ')[0].replace(/\s*\(satır \d+[^)]*\)/, '').trim();
          out.push({ block: b.id, line: st.line, code: 'parse', detail, text });
        }
      }
      if (bad && md2) out.push({ block: b.id, line: -1, code: 'dropped', detail: '', text: '' });
    }
    return out;
  }

  // Ağaçtaki atamaların adları (bileşik atamalar dahil)
  function assignedNames(node, into) {
    if (!node || typeof node !== 'object') return into;
    if (Array.isArray(node)) { for (const n of node) assignedNames(n, into); return into; }
    if (node.k === 'assign' && node.name) into.add(String(node.name).toLowerCase());
    for (const k in node) {
      const v = node[k];
      if (v && typeof v === 'object') assignedNames(v, into);
    }
    return into;
  }

  // Ağaçta bu adın OKUNDUĞU bir yer var mı
  function readsName(node, name) {
    if (!node || typeof node !== 'object') return false;
    if (Array.isArray(node)) return node.some((n) => readsName(n, name));
    if (node.k === 'var' && String(node.name).toLowerCase() === name) return true;
    for (const k in node) {
      const v = node[k];
      if (v && typeof v === 'object' && readsName(v, name)) return true;
    }
    return false;
  }
  // Bu adın ilk ataması: { relative } — değeri kendisinden mi hesaplıyor
  function firstAssign(node, name) {
    if (!node || typeof node !== 'object') return null;
    if (Array.isArray(node)) {
      for (const n of node) { const r = firstAssign(n, name); if (r) return r; }
      return null;
    }
    if (node.k === 'assign' && String(node.name).toLowerCase() === name) {
      return { relative: !!node.compound || readsName(node.v, name) };
    }
    for (const k in node) {
      const v = node[k];
      if (v && typeof v === 'object') { const r = firstAssign(v, name); if (r) return r; }
    }
    return null;
  }

  /* Hangi ana değeri presetin denklemleri her karede yeniden yazıyor:
     { valueId: { block, line, relative } } — ilk yazan satır. MilkDrop her
     karenin başında bu değerleri dosyadakine döndürüyor ve per_frame ile
     per_pixel sonra yazıyor; init'in yazdığı ilk kareden sonra kalmıyor.
     `relative`: değer kendisinden hesaplanıyor (`zoom = zoom*1.01`, `+=`) —
     dosyadaki değer hesabın başladığı yer; değilse (`zoom = 1.007 + …`)
     dosyadaki değer görüntüye hiç ulaşmıyor. */
  function overrides(blocks, M, md2) {
    const out = {};
    if (!M || !M.parse) return out;
    for (const id of ['per_frame', 'per_pixel']) {
      const lines = (blocks && blocks[id]) || [];
      for (const st of statements(lines)) {
        let ast;
        try { ast = M.parse(st.text, md2 ? { md2: true } : undefined); } catch (e) { continue; }
        for (const v of VALUES) {
          if (out[v.id]) continue;
          const a = firstAssign(ast, v.name);
          if (a) out[v.id] = { block: id, line: st.line, relative: a.relative };
        }
      }
    }
    return out;
  }

  /* GLSL derleyicisinin satırını presetin shader satırına eşler. Çevirmen
     satırları yeniden yazıyor (sayılar, türler, örnekleyiciler), yani satır
     numarası doğrudan tutmuyor; en çok ortak simgesi olan satır seçiliyor.
     Hiçbiri yeterince benzemiyorsa -1. */
  function nearestLine(srcLines, glslLine) {
    const toks = (s) => new Set(String(s || '').replace(/\/\/.*$/, '').match(/[A-Za-z_][A-Za-z0-9_]*/g) || []);
    const g = toks(glslLine);
    if (!g.size) return -1;
    let best = -1;
    let score = 0;
    (srcLines || []).forEach((l, i) => {
      const s = toks(l);
      if (!s.size) return;
      let common = 0;
      for (const t of s) if (g.has(t)) common++;
      const sc = common / Math.max(s.size, g.size);
      if (sc > score) { score = sc; best = i; }
    });
    return score >= 0.5 ? best : -1;
  }

  // Derleyici günlüğünden satırlar: `ERROR: 0:123: …`
  function glslErrors(log) {
    const out = [];
    for (const l of String(log || '').split(/\r?\n/)) {
      const m = /^\s*ERROR:\s*\d+:(\d+):\s*(.*)$/.exec(l);
      if (m) out.push({ line: +m[1], message: m[2].trim() });
      else if (/ERROR/.test(l)) out.push({ line: 0, message: l.trim() });
    }
    return out;
  }

  const api = {
    BLOCKS, VALUES, SLOTS, read, write, blockOfLine, statements, diagnose, overrides,
    nearestLine, glslErrors, assignedNames,
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (typeof window !== 'undefined') window.SVMdEdit = api;
})();
