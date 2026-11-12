/*
 * SoundVisualizer — CaYaDev Ses Görselleştirici
 * Copyright (c) 2026 Çağan Turgut (CaYatur) — CaYaDev, https://cayadev.com
 * https://github.com/CaYatur/SoundVisualizer
 * SPDX-License-Identifier: MIT
 */
'use strict';
/* GÖSTERİ KISAYOLLARI ve kısayol listesi.

   Belgelerde yıllardır üç kısayol yazıyordu (Boşluk: karart, Ctrl+S: anlık görüntü, Ctrl+R:
   kayıt) ama hiçbiri kodda yoktu; Ctrl+R ise Electron'un varsayılan menüsü yüzünden paneli ve
   çıkış penceresini YENİDEN YÜKLÜYORDU. Burası tek tanım: ana süreç çıkış penceresinde,
   panel kendi penceresinde aynı işlevle eşleştirir; kısayol penceresi de aynı listeyi gösterir.

   match(input): { key, control, meta, alt, shift } -> 'blackout' | 'snapshot' | 'record' | null
   (Electron'un before-input-event girdisi ve DOM KeyboardEvent'i için alan adları farklı;
   fromEvent DOM olayını bu biçime çevirir.) */
(function () {
  function match(input) {
    const i = input || {};
    const key = String(i.key || '').toLowerCase();
    const mod = !!(i.control || i.meta);
    if (i.alt) return null;
    if (!mod && !i.shift && (key === ' ' || key === 'space' || key === 'spacebar')) return 'blackout';
    if (mod && !i.shift && key === 's') return 'snapshot';
    if (mod && !i.shift && key === 'r') return 'record';
    return null;
  }

  function fromEvent(e) {
    return { key: e.key, control: !!e.ctrlKey, meta: !!e.metaKey, alt: !!e.altKey, shift: !!e.shiftKey };
  }

  /* Panelde odak bir denetimdeyken Boşluk o denetimindir (düğmeye basar, kutuyu işaretler,
     yazı alanına boşluk yazar). Ctrl+S ve Ctrl+R yalnız yazı alanlarında bırakılır. */
  function panelAllows(action, target) {
    const t = target || {};
    const tag = String(t.tagName || '').toUpperCase();
    const typing = tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || !!t.isContentEditable;
    if (action !== 'blackout') {
      // Kaydırıcı ve onay kutusu yazı alanı değil: orada da çalışsın
      const type = String(t.type || '').toLowerCase();
      if (tag === 'INPUT' && (type === 'range' || type === 'checkbox' || type === 'radio' || type === 'color')) return true;
      return !typing;
    }
    if (typing || tag === 'BUTTON' || tag === 'A' || tag === 'SUMMARY') return false;
    const role = typeof t.getAttribute === 'function' ? String(t.getAttribute('role') || '') : '';
    if (role === 'button' || role === 'tab' || role === 'slider' || role === 'option' || role === 'menuitem' || role === 'switch') return false;
    if (typeof t.closest === 'function' && t.closest('[tabindex], .code-editor, [contenteditable]')) return false;
    return true;
  }

  /* Kısayol listesi. `where`: tuşun çalıştığı yer. Metinler Türkçe anahtar; arayüz çevirir.
     `mac: true` satırında Ctrl yerine Cmd gösterilir. */
  const GROUPS = [
    { title: 'Her Yerde', keys: [
      { keys: ['Boşluk Tuşu'], text: 'Sahneyi karart; tekrar basınca geri gelir' },
      { keys: ['Ctrl', 'S'], text: 'Anlık görüntü (PNG) kaydet', mac: true },
      { keys: ['Ctrl', 'R'], text: 'Kaydı başlat ya da durdur', mac: true },
    ] },
    { title: 'Panel', keys: [
      { keys: ['Ctrl', 'K'], text: 'Bütün ayarlarda ara', mac: true },
      { keys: ['Alt', '1…5'], text: 'Sayfa değiştir: Sahne, Canlı, Zaman, Stüdyo, Çıktı' },
      { keys: ['Ctrl', 'Z'], text: 'Geri al', mac: true },
      { keys: ['Ctrl', 'Y'], text: 'Yinele', mac: true },
      { keys: ['Ctrl', '+ / −'], text: 'Arayüzü büyüt ya da küçült', mac: true },
      { keys: ['?'], text: 'Bu listeyi aç' },
    ] },
    { title: 'Canlı Sayfası', keys: [
      { keys: ['F1…F12'], text: 'Sahneyi sıraya al' },
      { keys: ['Enter'], text: 'Sıradaki sahneyi canlıya al' },
    ] },
    { title: 'Çıkış Penceresi', keys: [
      { keys: ['Esc'], text: 'Bütün görselleştirme pencerelerini kapat' },
      { keys: ['F11'], text: 'Tam ekran ile pencere arasında geç' },
      { keys: ['Ctrl', 'Shift', 'Q'], text: 'Kaza Koruması açıkken kapat' },
      { keys: ['K', '0…9', '0…9'], text: 'MilkDrop sprite başlat' },
    ] },
  ];
  const MORE = 'Zaman çizelgesi, klip destesi ve düzen editörünün kendi kısayolları var; her biri kendi panelinde listelenir.';

  const api = { match, fromEvent, panelAllows, GROUPS, MORE };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (typeof window !== 'undefined') window.SVHotkeys = api;
})();
