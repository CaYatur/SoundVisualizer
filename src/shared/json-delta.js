/*
 * SoundVisualizer — CaYaDev Ses Görselleştirici
 * Copyright (c) 2026 Çağan Turgut (CaYatur) — CaYaDev, https://cayadev.com
 * https://github.com/CaYatur/SoundVisualizer
 * SPDX-License-Identifier: MIT
 */
'use strict';
/* JSON FARKI (PC bağlantısı): büyük bir ayar değerinin (zaman çizelgesi) yalnız değişen yerleri.
   Telefon çizelgeyi düzenleyince bütün çizelge yerine bu işlemler gider, PC de geri yayınlarken
   aynısını yollar. Bir klibi kaydırmak 550 KB yerine birkaç yüz bayt.

   İşlem: { p: [yol], v: değer } (yaz) ya da { p: [yol], d: 1 } (sil). Yol parçası nesne anahtarı
   (metin) ya da kimlikli dizi öğesi ({ id }). Kimlikli dizide öğeler kimlikle bulunur: araya başka
   bir düzenleme girse de yanlış öğeye yazılmaz. Kimliksiz ya da öğe kümesi değişen dizi bütün
   olarak yazılır (bir izin klip listesi; çizelgenin tamamı değil).

   apply hiçbir şeyi yarım bırakmaz: yol bulunamazsa ya da işlem bozuksa null döner ve çağıran tam
   değere geri döner (telefon tam çizelgeyi yollar, telefon PC'den yeniden çeker). Girdi
   değiştirilmez; dönen değer yeni bir nesnedir. */
(function (root) {
  const BAD = new Set(['__proto__', 'constructor', 'prototype']);
  const MAX_OPS = 4000;
  const MAX_DEPTH = 40;
  const MAX_KEY = 128;

  const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
  const sig = (v) => JSON.stringify(v === undefined ? null : v);
  function idList(arr) {
    if (!Array.isArray(arr)) return null;
    const ids = [];
    const seen = new Set();
    for (const x of arr) {
      if (!isObj(x) || typeof x.id !== 'string' || !x.id || x.id.length > MAX_KEY || seen.has(x.id)) return null;
      seen.add(x.id);
      ids.push(x.id);
    }
    return ids;
  }

  /* a → b farkı; işlem sayısı sınırı aşılırsa null (çağıran bütün değeri yollar). */
  function diff(a, b) {
    const ops = [];
    let over = false;
    const put = (op) => { if (ops.length >= MAX_OPS) over = true; else ops.push(op); };
    const walk = (x, y, path) => {
      if (over) return;
      if (path.length > MAX_DEPTH) { put({ p: path, v: y }); return; }
      if (isObj(x) && isObj(y)) {
        for (const k of Object.keys(x)) {
          if (!Object.prototype.hasOwnProperty.call(y, k) || y[k] === undefined) put({ p: path.concat(k), d: 1 });
        }
        for (const k of Object.keys(y)) {
          if (y[k] === undefined) continue;
          if (BAD.has(k) || k.length > MAX_KEY) { put({ p: path, v: y }); return; }
          const xv = x[k];
          if (xv === y[k]) continue;
          if (sig(xv) === sig(y[k])) continue;
          walk(xv, y[k], path.concat(k));
        }
        return;
      }
      if (Array.isArray(x) && Array.isArray(y)) {
        const ia = idList(x);
        const ib = idList(y);
        // Aynı kimlikler aynı sırada: öğe öğe; değilse bu dizi bütün olarak
        if (ia && ib && ia.length === ib.length && ia.every((id, i) => id === ib[i])) {
          for (let i = 0; i < y.length; i++) {
            if (sig(x[i]) === sig(y[i])) continue;
            walk(x[i], y[i], path.concat({ id: ib[i] }));
          }
          return;
        }
      }
      put({ p: path, v: y === undefined ? null : y });
    };
    if (sig(a) === sig(b)) return [];
    walk(a, b, []);
    return over ? null : ops;
  }

  function seg(s) {
    if (typeof s === 'string') return s.length <= MAX_KEY && !BAD.has(s) ? s : null;
    if (isObj(s) && typeof s.id === 'string' && s.id && s.id.length <= MAX_KEY && Object.keys(s).length === 1) return s;
    return null;
  }
  function validOps(ops) {
    if (!Array.isArray(ops) || ops.length > MAX_OPS) return false;
    for (const o of ops) {
      if (!isObj(o) || !Array.isArray(o.p) || o.p.length > MAX_DEPTH) return false;
      if (o.p.some((s) => seg(s) == null)) return false;
      const del = o.d === 1;
      if (del === Object.prototype.hasOwnProperty.call(o, 'v')) return false; // tam olarak biri
      if (del && !o.p.length) return false;
    }
    return true;
  }

  /* Değere işlemleri uygula; olmazsa null. Yalnız dokunulan dallar kopyalanır. */
  function apply(base, ops) {
    if (!validOps(ops)) return null;
    let rootVal = base === undefined ? null : base;
    const clone = (v) => (Array.isArray(v) ? v.slice() : isObj(v) ? Object.assign({}, v) : v);
    const copied = new Set();
    const own = (v) => { if (v !== null && typeof v === 'object' && !copied.has(v)) { const c = clone(v); copied.add(c); return c; } return v; };
    for (const o of ops) {
      const val = Object.prototype.hasOwnProperty.call(o, 'v') ? JSON.parse(sig(o.v)) : undefined;
      if (!o.p.length) { rootVal = val; continue; }
      rootVal = own(rootVal);
      let cur = rootVal;
      for (let i = 0; i < o.p.length; i++) {
        const s = o.p[i];
        const last = i === o.p.length - 1;
        let key;
        if (typeof s === 'string') {
          if (!isObj(cur)) return null;
          key = s;
        } else {
          if (!Array.isArray(cur)) return null;
          key = cur.findIndex((x) => isObj(x) && x.id === s.id);
          if (key < 0) return null;
        }
        if (last) {
          if (o.d === 1) {
            if (typeof key === 'number') cur.splice(key, 1);
            else delete cur[key];
          } else cur[key] = val;
        } else {
          if (cur[key] === null || typeof cur[key] !== 'object') return null;
          cur[key] = own(cur[key]);
          cur = cur[key];
        }
      }
    }
    return rootVal;
  }

  /* İşlemlerin metin boyu (karar için: fark bütün değerden küçük mü). */
  function size(v) { try { return JSON.stringify(v).length; } catch (e) { return Infinity; } }

  const api = { diff, apply, validOps, size, MAX_OPS };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (typeof window !== 'undefined') root.SVJsonDelta = api;
})(typeof window !== 'undefined' ? window : globalThis);
