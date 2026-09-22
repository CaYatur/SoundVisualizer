'use strict';
/* MilkDrop kitaplığı (#576): favoriler, etiketler, yazar ve arama.
 *
 * NEREDE DURUYOR
 * Favoriler ve etiketler kullanıcının verdiği şeyler, presetin kendisine ait
 * değil: #569'un puanları gibi AYARLARDA, preset kimliğine bağlı
 * (`milkdropLibrary.favorites`: kimlik → true, `milkdropLibrary.tags`:
 * kimlik → dizi). Preset dosyasına dokunulmuyor; kitaplık bloğu sahne
 * anahtarı değil, yani sahne değişince kaybolmuyor.
 *
 * PAKETTE NASIL GİDİYOR
 * Kimlikler karşı tarafta aynı değil: içe aktarım her presete yeni kimlik
 * veriyor (`SVPresets.readImported`). Bu yüzden paket kimlik → değer eşlemini
 * değil, her presetin kendi kaydında bir `library` alanı taşıyor (favori,
 * etiketler, puan) ve içe aktarım onu yeni kimliğe katlıyor. Alan preset
 * dosyasına yazılmıyor.
 *
 * YAZAR
 * MilkDrop preset dosyasında yazar alanı yok; adlar çoğunlukla
 * "Yazar - Başlık" ("Flexi, martin + geiss - ..."). Yazar arama sırasında
 * addan türetiliyor, diske yazılmıyor: diskteki presetler için taşıma
 * gerekmiyor ve yeniden içe aktarılan preset aynı yazarı buluyor. Kaydın
 * kendi `author` alanı doluysa (yerleşikler) o geçerli.
 */
(function () {
  const MAX_TAGS = 16;
  const MAX_TAG_LEN = 32;
  // Birleşik nokta (İ'nin küçüğünde kalan): kaçış yerine koddan kuruluyor
  const COMBINING_DOT = new RegExp(String.fromCharCode(0x307), 'g');

  /* Karşılaştırma anahtarı. Büyük/küçük harf ve Türkçe I/ı, İ/i farkı yok:
     "IŞIK" ile "ışık" aynı etiket, "INFINITY" ile "infinity" aynı ad.
     Görünen metin olduğu gibi kalıyor; yalnız eşleştirme bununla. */
  function fold(s) {
    return String(s == null ? '' : s)
      .toLowerCase()
      .replace(COMBINING_DOT, '')
      .replace(/ı/g, 'i')
      .replace(/\s+/g, ' ')
      .trim();
  }

  const own = (o, k) => !!o && typeof o === 'object' && Object.prototype.hasOwnProperty.call(o, k);
  /* Eşlem anahtarı olabilecek kimlik. Kayıtlar dosyadan da geliyor (paket);
     nesnenin kendi alanlarına denk gelen anahtar yazılmıyor. */
  const safeKey = (id) => typeof id === 'string' && id !== '' &&
    id !== '__proto__' && id !== 'constructor' && id !== 'prototype';

  /* Yazar(lar). Birden çok yazar `+`, `&` ya da virgülle ayrılıyor; harf
     taşımayan parça ("001 - ...") yazar sayılmıyor. */
  function authorsOf(p) {
    if (!p) return [];
    let src = typeof p.author === 'string' ? p.author.trim() : '';
    if (!src) {
      const m = /^\s*(.+?)\s+-\s+\S/.exec(String(p.name || ''));
      if (!m) return [];
      src = m[1];
    }
    const out = [];
    const seen = new Set();
    for (const part of src.split(/\s*(?:\+|&|,)\s*/)) {
      const a = part.trim();
      if (!a || !/\p{L}/u.test(a)) continue;
      const k = fold(a);
      if (seen.has(k)) continue;
      seen.add(k);
      out.push(a);
    }
    return out;
  }

  /* Etiket girişi: virgülle (ya da noktalı virgülle, satırla) ayrılmış metin
     veya dizi. Baştaki `#` atılıyor, aynı etiket bir kez, en çok 16 etiket
     ve etiket başına 32 karakter. */
  function normTags(input) {
    const raw = Array.isArray(input) ? input : String(input == null ? '' : input).split(/[,;\n]/);
    const out = [];
    const seen = new Set();
    for (const t of raw) {
      if (typeof t !== 'string' && typeof t !== 'number') continue;
      let s = String(t).replace(/\s+/g, ' ').trim().replace(/^#+/, '').trim();
      if (s.length > MAX_TAG_LEN) s = s.slice(0, MAX_TAG_LEN).trim();
      const k = fold(s);
      if (!k || seen.has(k)) continue;
      seen.add(k);
      out.push(s);
      if (out.length >= MAX_TAGS) break;
    }
    return out;
  }

  function isFavorite(lib, id) {
    return !!lib && own(lib.favorites, id) && lib.favorites[id] === true;
  }

  function tagsOf(lib, id) {
    return lib && own(lib.tags, id) && Array.isArray(lib.tags[id]) ? normTags(lib.tags[id]) : [];
  }

  /* Değişiklikler YENİ bir eşlem döndürüyor; çağıran kitaplığa atıyor
     (panelin puan yazımıyla aynı desen, milkdrop-panel.js `setRating`). */
  function withFavorite(lib, id, on) {
    const fav = Object.assign({}, lib && lib.favorites);
    if (!safeKey(id)) return fav;
    if (on) fav[id] = true;
    else delete fav[id];
    return fav;
  }

  function withTags(lib, id, input) {
    const all = Object.assign({}, lib && lib.tags);
    if (!safeKey(id)) return all;
    const t = normTags(input);
    if (t.length) all[id] = t;
    else delete all[id];
    return all;
  }

  /* Toplu etiket (#574, içe aktarımda klasör adları): her `{ id, tag }` için
     etiket ekleniyor, eşlem BİR kez kopyalanıyor — 10 bin presette tek tek
     `withTags` eşlemi 10 bin kez kopyalardı. */
  function addTags(lib, pairs) {
    const all = Object.assign({}, lib && lib.tags);
    for (const pr of Array.isArray(pairs) ? pairs : []) {
      if (!pr || !safeKey(pr.id) || !pr.tag) continue;
      const t = normTags((Array.isArray(all[pr.id]) ? all[pr.id] : []).concat([pr.tag]));
      if (t.length) all[pr.id] = t;
    }
    return all;
  }

  /* Silinen presetin izi: puan, favori ve etiketler birlikte gidiyor. */
  function forget(lib, id) {
    const drop = (o) => {
      const c = Object.assign({}, o);
      delete c[id];
      return c;
    };
    return { ratings: drop(lib && lib.ratings), favorites: drop(lib && lib.favorites), tags: drop(lib && lib.tags) };
  }

  /* ARAMA. Sorgu boşlukla ayrılmış sözcükler ve HEPSİ uymalı. `#etiket`
     (ya da `etiket:`, `tag:`) yalnız etiketlerde, `yazar:` (ya da
     `author:`) yalnız yazarlarda arıyor; düz sözcük adda, yazarlarda ve
     etiketlerde. Eşleşme parça eşleşmesi: yazarken daralıyor. */
  function parseQuery(q) {
    const terms = [];
    for (const w of String(q == null ? '' : q).split(/\s+/)) {
      if (!w) continue;
      let m;
      if (w[0] === '#') {
        if (w.length > 1) terms.push({ in: 'tag', v: fold(w.slice(1)) });
      } else if ((m = /^(?:yazar|author):(.*)$/i.exec(w))) {
        if (m[1]) terms.push({ in: 'author', v: fold(m[1]) });
      } else if ((m = /^(?:etiket|tag):(.*)$/i.exec(w))) {
        if (m[1]) terms.push({ in: 'tag', v: fold(m[1].replace(/^#+/, '')) });
      } else {
        terms.push({ in: 'any', v: fold(w) });
      }
    }
    return terms.filter((t) => t.v);
  }

  /* `nameOf`: panelde görünen ad (yerleşiklerin adı çevriliyor); arama
     hem onda hem kayıttaki adda. */
  function matches(p, terms, lib, nameOf) {
    if (!terms.length) return true;
    const names = [fold(p.name || p.id)];
    if (typeof nameOf === 'function') names.push(fold(nameOf(p.name || p.id)));
    const authors = authorsOf(p).map(fold);
    const tags = tagsOf(lib, p.id).map(fold);
    const inName = (v) => names.some((n) => n.includes(v));
    const inList = (arr, v) => arr.some((x) => x.includes(v));
    return terms.every((t) => {
      if (t.in === 'tag') return inList(tags, t.v);
      if (t.in === 'author') return inList(authors, t.v);
      return inName(t.v) || inList(authors, t.v) || inList(tags, t.v);
    });
  }

  /* Listenin süzgeci. `show`: 'all' | 'fav' | 'tag' (+ `tag`), `author`
     yazar (tam, katlanmış karşılaştırma), `query` arama metni. */
  function filter(list, opts, lib) {
    const o = opts || {};
    const terms = parseQuery(o.query);
    const tagK = o.show === 'tag' ? fold(o.tag) : '';
    const authorK = o.author ? fold(o.author) : '';
    return (Array.isArray(list) ? list : []).filter((p) => {
      if (!p) return false;
      if (o.show === 'fav' && !isFavorite(lib, p.id)) return false;
      if (o.show === 'tag' && !tagsOf(lib, p.id).some((t) => fold(t) === tagK)) return false;
      if (authorK && !authorsOf(p).some((a) => fold(a) === authorK)) return false;
      return matches(p, terms, lib, o.nameOf);
    });
  }

  /* OTOMATİK GEÇİŞİN HAVUZU. `md.autoFrom`: 'all' (varsayılan) |
     'favorites' | 'tag' (+ `md.autoTag`). Sıra listeninki; havuz boşsa
     döngü bunu kendi nedeniyle söylüyor (EMPTY, ALONE). */
  function poolOf(md) {
    const from = md && (md.autoFrom === 'favorites' || md.autoFrom === 'tag') ? md.autoFrom : 'all';
    return { from, tag: from === 'tag' && md && typeof md.autoTag === 'string' ? md.autoTag : '' };
  }

  function pool(list, md, lib) {
    const o = poolOf(md);
    const arr = Array.isArray(list) ? list : [];
    if (o.from === 'all') return arr;
    if (o.from === 'favorites') return arr.filter((p) => p && isFavorite(lib, p.id));
    const k = fold(o.tag);
    if (!k) return [];
    return arr.filter((p) => p && tagsOf(lib, p.id).some((t) => fold(t) === k));
  }

  /* Seçiciler için sayımlar: etiketler ve yazarlar, katlanmış anahtara
     göre gruplanıp alfabetik. Görünen biçim en sık yazılışı. */
  function counted(pairs) {
    const by = new Map();
    for (const [shown, key] of pairs) {
      let e = by.get(key);
      if (!e) { e = { key, count: 0, forms: new Map() }; by.set(key, e); }
      e.count++;
      e.forms.set(shown, (e.forms.get(shown) || 0) + 1);
    }
    const out = [];
    for (const e of by.values()) {
      let best = '';
      let n = -1;
      for (const [f, c] of e.forms) if (c > n) { best = f; n = c; }
      out.push({ name: best, key: e.key, count: e.count });
    }
    return out.sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
  }

  function tagCounts(list, lib) {
    const pairs = [];
    for (const p of Array.isArray(list) ? list : []) {
      if (p) for (const t of tagsOf(lib, p.id)) pairs.push([t, fold(t)]);
    }
    return counted(pairs);
  }

  function authorCounts(list) {
    const pairs = [];
    for (const p of Array.isArray(list) ? list : []) {
      if (p) for (const a of authorsOf(p)) pairs.push([a, fold(a)]);
    }
    return counted(pairs);
  }

  /* PAKET. Dışa aktarımda her presetin kaydına giden bölüm: yalnız bu
     kullanıcının verdikleri ve varsa. */
  function packEntry(lib, id) {
    const e = {};
    if (isFavorite(lib, id)) e.favorite = true;
    const t = tagsOf(lib, id);
    if (t.length) e.tags = t;
    const r = lib && own(lib.ratings, id) ? Number(lib.ratings[id]) : NaN;
    if (isFinite(r)) e.rating = Math.max(0, Math.min(5, r));
    return Object.keys(e).length ? e : null;
  }

  /* İçe aktarımda gelenler (`yeni kimlik → kayıt`) kitaplığa. Dosyadan
     geldikleri için doğrulanıyor: favori yalnız `true`, etiketler temizleniyor,
     puan 0..5 sayı. Dönüş: yeni `ratings`, `favorites`, `tags` eşlemleri. */
  function mergeEntries(lib, entries) {
    const ratings = Object.assign({}, lib && lib.ratings);
    const favorites = Object.assign({}, lib && lib.favorites);
    const tags = Object.assign({}, lib && lib.tags);
    let n = 0;
    for (const id of Object.keys(entries || {})) {
      const e = entries[id];
      if (!safeKey(id) || !e || typeof e !== 'object') continue;
      let any = false;
      if (e.favorite === true) { favorites[id] = true; any = true; }
      const t = normTags(Array.isArray(e.tags) ? e.tags : []);
      if (t.length) { tags[id] = t; any = true; }
      const r = typeof e.rating === 'number' ? e.rating : NaN;
      if (isFinite(r)) { ratings[id] = Math.max(0, Math.min(5, r)); any = true; }
      if (any) n++;
    }
    return { ratings, favorites, tags, count: n };
  }

  /* İçe aktarımın son adımı (MilkDrop paneli ve Studio ortak): yalnız
     GERÇEKTEN kaydedilen presetlerin kayıtları kitaplığa — kaydedilemeyen
     presetin izi ayarlarda kalmasın. `entries` `SVPresets.readImported`in
     `library`si, `saved` kaydın döndürdüğü presetler. `lib` yerinde
     güncelleniyor; dönüş: kaç presetin kaydı geldi. */
  function adopt(lib, entries, saved) {
    if (!lib || typeof lib !== 'object') return 0;
    const ids = new Set((Array.isArray(saved) ? saved : []).map((p) => p && p.id).filter(Boolean));
    const pick = {};
    for (const id of Object.keys(entries || {})) if (ids.has(id)) pick[id] = entries[id];
    const m = mergeEntries(lib, pick);
    lib.ratings = m.ratings;
    lib.favorites = m.favorites;
    lib.tags = m.tags;
    return m.count;
  }

  const api = {
    MAX_TAGS, MAX_TAG_LEN, fold, authorsOf, normTags, isFavorite, tagsOf, withFavorite, withTags, addTags, forget,
    parseQuery, matches, filter, poolOf, pool, tagCounts, authorCounts, packEntry, mergeEntries, adopt,
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (typeof window !== 'undefined') window.SVMilkdropLibrary = api;
})();
