'use strict';
/* MİLKDROP KARIŞIMI (#579) — kütüphanedeki presetlerin parçalarından yeni bir preset.

   NE YAPIYOR (kendi sözlerimizle; MilkDrop 2'nin kodu okunmadı): MilkDrop 2
   bir preseti başka presetlerin parçalarından kurabiliyor — parçalar ya
   rastgele seçiliyor ya da her parçanın hangi presetten geleceği tek tek
   seçiliyor. Buradaki karışım aynı fikri kendi yolundan kuruyor: altı
   parça, her biri BÜTÜNÜYLE bir presetten.

     look   — görünüm: sönme, gama, yankı, bayraklar, ana dalga, kenarlar,
              hareket vektörleri, puan
     motion — hareket: per_frame_init, per_frame, per_pixel denklemleri ve
              zoom, rot, cx, cy, dx, dy, warp, sx, sy, fWarpAnimSpeed,
              fWarpScale, fZoomExponent
     waves  — özel dalgalar (wavecode_*, wave_N_*)
     shapes — özel şekiller (shapecode_*, shape_N_*)
     warp   — warp shader'ı (warp_N)
     comp   — birleştirme shader'ı (comp_N) ve bulanıklık aralıkları
              (b1n..b3x, b1ed): GetBlur'un ölçeği onlardan geliyor ve
              bulanıklığı en çok birleştirme shader'ı okuyor

   SATIRLAR OLDUĞU GİBİ KOPYALANIYOR, numaraları değiştirilmeden. Her anahtar
   tam olarak bir parçaya ait; bir parçanın bütün satırları aynı presetten
   geldiği için numaralar kendi içinde zaten sürekli. Anahtarların listesi
   korpustan sayıldı (10.332 dosya, 86 başlık anahtarı); bilinmeyen bir
   başlık anahtarı görünüme gidiyor.

   Sürüm satırları kopyalanmıyor, yeniden yazılıyor: MilkDrop 2 shader'ı
   ancak PSVERSION_WARP/PSVERSION_COMP sıfırdan büyükse okuyor, yani o
   değerler shader'ı veren presetinkiler olmalı.

   Parçalar arası bağ KORUNMUYOR ve korunamaz: bir presetin shader'ı başka
   bir presetin kare denklemlerinin yazdığı q değişkenlerini okuyor olabilir.
   Karışımın doğası bu; MilkDrop 2'de de öyle. */
(function () {
  const VERSION = 1;
  const SLOTS = ['look', 'motion', 'waves', 'shapes', 'warp', 'comp'];
  // Shader parçası "yok" olabilir: görünümün sabit yolu (yankı, gama, bayraklar) o zaman çalışıyor
  const NONE = '';

  const MOTION_KEYS = new Set([
    'zoom', 'rot', 'cx', 'cy', 'dx', 'dy', 'warp', 'sx', 'sy',
    'fwarpanimspeed', 'fwarpscale', 'fzoomexponent',
  ]);
  const BLUR_KEYS = new Set(['b1n', 'b2n', 'b3n', 'b1x', 'b2x', 'b3x', 'b1ed']);
  const VERSION_KEYS = new Set(['milkdrop_preset_version', 'psversion', 'psversion_warp', 'psversion_comp']);

  /* Anahtarın parçası. Sıra önemli: per_frame_init_N, per_frame_N'den önce
     sınanmalı; `wave_N_` başlıktaki `wave_r`dan rakamla ayrılıyor; `warp_N`
     shader, düz `warp` hareket. */
  function slotOf(key) {
    const k = String(key).trim().toLowerCase();
    if (VERSION_KEYS.has(k)) return 'version';
    if (/^per_frame_init_\d+$/.test(k) || /^per_frame_\d+$/.test(k) ||
        /^per_pixel_\d+$/.test(k) || /^per_vertex_\d+$/.test(k) || MOTION_KEYS.has(k)) return 'motion';
    if (/^wavecode_\d+_/.test(k) || /^wave_\d+_(init|per_frame|per_point)\d+$/.test(k)) return 'waves';
    if (/^shapecode_\d+_/.test(k) || /^shape_\d+_(init|per_frame)\d+$/.test(k)) return 'shapes';
    if (/^warp_\d+$/.test(k)) return 'warp';
    if (/^comp_\d+$/.test(k) || BLUR_KEYS.has(k)) return 'comp';
    return 'look';
  }

  /* Sürüm satırının değeri, ayrıştırıcının kuralıyla: değerin TAMAMI
     sayıysa sayı, değilse "yok" (NaN; sürüm kuralı onu varsayılana
     düşürüyor). Aynı anahtar iki kez geçerse sonuncusu — ayrıştırıcı da
     öyle tutuyor. */
  const numVal = (raw) => {
    const n = parseFloat(raw);
    return isFinite(n) && /^[\s\-+.0-9eE]+$/.test(raw) ? n : NaN;
  };

  // Yalnız sürüm satırları, metni ayrıştırmadan (aday sınaması için)
  function versionsOf(text) {
    const ver = {};
    const re = /^[ \t]*(milkdrop_preset_version|psversion_warp|psversion_comp|psversion)[ \t]*=(.*)$/gmi;
    let m;
    while ((m = re.exec(text)) !== null) ver[m[1].toLowerCase()] = numVal(m[2].replace(/\s+$/, ''));
    return ver;
  }

  /* Metni parçalarına ayırır. Eşittirsiz satırlar ve bölüm başlıkları
     düşüyor (ayrıştırıcı da onları okumuyor). Dönüş: parça -> satırlar ve
     sürüm satırlarının değerleri. */
  function split(text) {
    const out = { look: [], motion: [], waves: [], shapes: [], warp: [], comp: [] };
    const ver = {};
    for (const raw of String(text == null ? '' : text).split(/\r?\n/)) {
      const line = raw.trim();
      if (!line || line[0] === '[') continue;
      const eq = line.indexOf('=');
      if (eq < 0) continue;
      const key = line.slice(0, eq).trim().toLowerCase();
      const slot = slotOf(key);
      if (slot === 'version') {
        ver[key] = numVal(line.slice(eq + 1));
        continue;
      }
      /* Satırın iki ucu kırpılmış hâli: ayrıştırıcı da satırı öyle okuyor.
         Shader girintisi ters tırnaktan SONRA, kırpmadan etkilenmiyor. */
      out[slot].push(line);
    }
    return { lines: out, ver };
  }

  /* Bir parçası var mı — ayrıştırıcıyla aynı cevap, ama ayrıştırmadan.
     Aday seçimi on bin presetlik bir listede satır satır arıyor; her aday
     için tam ayrıştırma pahalı olurdu. Ölçüldü: korpusun 10.332 presetinde
     altı parçanın hepsi için ayrıştırıcıyla birebir aynı (ROADMAP #579).

       motion — boş olmayan bir denklem satırı (yorum dışında)
       waves/shapes — açık (enabled sıfırdan farklı) bir blok
       warp/comp — boş olmayan bir shader satırı VE o aşamanın sürümü
         sıfırdan büyük: MilkDrop sürümü 0 olan aşamanın metnini okumuyor,
         motor da (#580); öyle bir preset o parçayı veremez */
  function has(text, slot) {
    if (slot === 'warp' || slot === 'comp') {
      return hasLine(text, slot) && stageVersion(versionsOf(String(text == null ? '' : text)), slot) > 0;
    }
    return hasLine(text, slot);
  }

  function hasLine(text, slot) {
    if (slot === 'look') return true;
    const s = String(text == null ? '' : text);
    let re;
    if (slot === 'motion') re = /^[ \t]*(per_frame_init_\d+|per_frame_\d+|per_pixel_\d+|per_vertex_\d+)[ \t]*=(.*)$/gmi;
    else if (slot === 'waves') re = /^[ \t]*wavecode_\d+_enabled[ \t]*=(.*)$/gmi;
    else if (slot === 'shapes') re = /^[ \t]*shapecode_\d+_enabled[ \t]*=(.*)$/gmi;
    else if (slot === 'warp') re = /^[ \t]*warp_\d+[ \t]*=(.*)$/gmi;
    else if (slot === 'comp') re = /^[ \t]*comp_\d+[ \t]*=(.*)$/gmi;
    else return false;
    let m;
    /* Açık bloklar anahtar başına SON değerle: aynı anahtar dosyada iki kez
       geçebiliyor (korpusta `shapecode_2_enabled=1`, sonra `=0`) ve
       ayrıştırıcı sonuncuyu tutuyor. */
    const last = new Map();
    while ((m = re.exec(s)) !== null) {
      const v = m[m.length - 1];
      if (slot === 'motion') {
        // Ayrıştırıcı satır yorumunu atıyor: yalnız yorum olan satır boş sayılır
        if (v.replace(/\/\/.*$/, '').trim()) return true;
      } else if (slot === 'waves' || slot === 'shapes') {
        last.set(m[0].slice(0, m[0].indexOf('=')).trim().toLowerCase(), v);
      } else if (v.replace(/^`/, '').trim()) {
        return true;
      }
    }
    for (const v of last.values()) {
      const n = parseFloat(v);
      if (isFinite(n) && n !== 0 && /^[\s\-+.0-9eE]+$/.test(v)) return true;
    }
    return false;
  }

  /* Bir aşamanın MilkDrop'taki sürümü, MilkDrop'un kuralıyla (#580;
     motordaki eşi shared/milkdrop.js `md2Versions`, test ikisini
     karşılaştırıyor): MILKDROP_PRESET_VERSION yoksa ya da 200'den küçükse
     0, tam 200'de PSVERSION (yoksa 2), üstünde PSVERSION_WARP/_COMP
     (yoksa 2). Sürümü 0 olan aşamanın metni MilkDrop'ta da motorda da
     okunmuyor. */
  function stageVersion(ver, slot) {
    const int = (v, d) => (typeof v === 'number' && isFinite(v) ? Math.trunc(v) : d);
    const pv = int(ver.milkdrop_preset_version, 100);
    if (pv < 200) return 0;
    if (pv === 200) return int(ver.psversion, 2);
    return int(ver['psversion_' + slot], 2);
  }

  /* Bir parçanın yazılacak shader sürümü: shader satırı yoksa 0, varsa
     onu veren presetin o aşamadaki sürümü — MilkDrop'ta okunmayan bir
     shader karışımda da okunmayan kalıyor. Yalnız `warp_N`/`comp_N`
     satırlarına bakılıyor: birleştirme parçasında bulanıklık aralıkları da
     var ve shader'ı olmayan bir presette onları shader sanmak, 308 MilkDrop
     1 presetine olmayan bir shader için sürüm satırı yazıyordu (ölçüm). */
  function shaderVersion(parts, slot) {
    const re = slot === 'warp' ? /^warp_\d+[ \t]*=/i : /^comp_\d+[ \t]*=/i;
    if (!parts.lines[slot].some((l) => re.test(l) && l.slice(l.indexOf('=') + 1).replace(/^`/, '').trim())) return 0;
    return stageVersion(parts.ver, slot);
  }

  /* Karışımı yazar. `donors`: parça -> preset metni. warp ve comp için
     NONE ('') "shader yok" demek; tanımsız bir parça görünümün presetinden
     geliyor. */
  function compose(donors) {
    const d = donors || {};
    const look = split(d.look);
    /* NONE boş metin: boş metnin hiçbir parçası yok, yani "shader yok" ayrı
       bir dal istemiyor. Tanımsız parça görünümün presetinden. */
    const parts = {};
    for (const slot of SLOTS) {
      const t = d[slot];
      parts[slot] = slot === 'look' || t === undefined || t === null ? look : split(t);
    }
    const warpV = shaderVersion(parts.warp, 'warp');
    const compV = shaderVersion(parts.comp, 'comp');
    const lines = [];
    /* Sürüm satırları shader'ı verenlerden. İkisi de yoksa ve görünümün
       presetinde sürüm satırları varsa onun değerleri korunuyor: tek
       presetten kurulan karışım kendisini birebir veriyor. */
    const lookHasVer = look.ver.milkdrop_preset_version > 0;
    if (warpV || compV || lookHasVer) {
      const ps = Math.max(warpV, compV) || look.ver.psversion || 2;
      lines.push('MILKDROP_PRESET_VERSION=' + (look.ver.milkdrop_preset_version > 0 ? look.ver.milkdrop_preset_version : 201));
      lines.push('PSVERSION=' + ps);
      lines.push('PSVERSION_WARP=' + warpV);
      lines.push('PSVERSION_COMP=' + compV);
    }
    lines.push('[preset00]');
    for (const slot of SLOTS) {
      for (const l of parts[slot].lines[slot]) lines.push(l);
    }
    return lines.join('\n') + '\n';
  }

  // --------------------------------------------------------------------
  // Tarif, kimlik, ad, aday
  // --------------------------------------------------------------------
  function hashString(s) {
    let h = 2166136261;
    for (let i = 0; i < s.length; i++) {
      h ^= s.charCodeAt(i);
      h = Math.imul(h, 16777619);
    }
    return h >>> 0;
  }

  // Tarifin tek metni: parça sırası sabit, "yok" boş dize
  const recipeKey = (r) => SLOTS.map((s) => s + ':' + (r && typeof r[s] === 'string' ? r[s] : '')).join('|');

  /* Kimlik tariften: aynı karışımı iki kez kaydetmek ikinci bir kopya
     bırakmıyor. Sürüm kimlikte, çünkü parça kuralları değişirse aynı tarif
     başka bir metin verir ve eski kaydın üstüne yazılmamalı. İki ayrı özet
     (64 bit) çakışmayı uzak tutuyor. */
  function idOf(recipe) {
    const k = recipeKey(recipe);
    const a = hashString(k).toString(16).padStart(8, '0');
    const b = hashString('mix:' + k + ':' + k.length).toString(16).padStart(8, '0');
    return 'md_mix' + VERSION + '_' + a + b;
  }

  const WORD = { tr: 'Karışım', en: 'Mash-up' };
  const short = (s, n) => {
    const t = String(s || '').trim();
    return t.length > n ? t.slice(0, n - 1).trimEnd() + '…' : t;
  };

  /* Ad: kelime ve parçaları veren presetlerin adları (ilk üç ayrı ad,
     kısaltılmış). Arayüz dilinde; kaynağa girmiyor. `nameOf(id)` presetin
     görünen adını veriyor (yerleşiklerin adı çevrilebiliyor).

     Ayırıcı ": ", " · " değil: çeviri " · " gördüğü metni bölüp parçaları
     ayrı ayrı çeviriyor ve "Karışım" sözlükte ("Blend", katman karışımı).
     Türkçe arayüzde kaydedilmiş bir karışım İngilizce arayüzde "Blend · …"
     okunurdu. Ad, presetin kendi adı olarak bütün kalıyor. */
  function nameFor(recipe, nameOf, lang) {
    const seen = new Set();
    const names = [];
    for (const s of SLOTS) {
      const id = recipe[s];
      if (!id || seen.has(id)) continue;
      seen.add(id);
      const n = short(nameOf ? nameOf(id) : id, 22);
      if (n) names.push(n);
      if (names.length === 3) break;
    }
    return (WORD[lang === 'en' ? 'en' : 'tr']) + ': ' + names.join(' × ');
  }

  /* Parçası olan rastgele bir aday. Liste on binlerce preset olabilir:
     süzmek yerine rastgele dokunup sınıyor, en çok `tries` kez. `avoid`
     o parçada şu an duran preset — yeniden çekilince değişsin. Bulamazsa
     null. */
  function pick(list, slot, rand, avoid, tries) {
    const L = Array.isArray(list) ? list : [];
    if (!L.length) return null;
    const r = typeof rand === 'function' ? rand : Math.random;
    const n = Math.max(1, tries || 400);
    let fallback = null;
    for (let i = 0; i < n; i++) {
      const p = L[Math.floor(r() * L.length)];
      if (!p || typeof p.source !== 'string' || !has(p.source, slot)) continue;
      if (p.id !== avoid) return p;
      fallback = p;
    }
    /* Rastgele dokunuş bulamadıysa (parçası olan preset çok seyrek) liste
       baştan taranıyor: aday varsa mutlaka bulunsun. */
    for (const p of L) {
      if (p && typeof p.source === 'string' && p.id !== avoid && has(p.source, slot)) return p;
    }
    return fallback;
  }

  const api = {
    VERSION, SLOTS, NONE, slotOf, split, has, compose, recipeKey, idOf, nameFor, pick,
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (typeof window !== 'undefined') window.SVMdMix = api;
})();
