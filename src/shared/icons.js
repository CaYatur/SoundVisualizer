'use strict';
/* ARAYÜZ İKONLARI (#665).

   Arayüz eskiden emoji ve Unicode resim karakterleri kullanıyordu (💾 📤 🗑
   ⚠️ ⏭ …). Bunlar işletim sisteminin renkli emoji yazı tipiyle çiziliyor:
   panelin renklerine uymuyor, Windows sürümüne göre değişiyor, macOS ve
   Linux'ta başka görünüyor; üstelik bir kısmı (⏸ ⏹ ⏭) renkli emojiye, bir
   kısmı (▶ ■) düz metne düştüğü için aynı araç çubuğunda iki ayrı üslup
   oluyordu ve emoji düğmenin satır yüksekliğini büyütüyordu.

   Buradaki ikonlar bu uygulama için çizildi: 24'lük ızgara, tek çizgi
   kalınlığı (1.8), yuvarlak uç ve köşe, renk `currentColor`. Hazır bir ikon
   kütüphanesinden alınmadı.

   Her ikon yalnız PATH dizelerinden oluşuyor (daire ve dikdörtgen de path'e
   çevriliyor): aynı tanım hem SVG olarak hem de tuval üzerinde Path2D ile
   çizilebiliyor (zaman çizelgesi klipleri tuvalde çiziliyor).

   Kullanım:
     SVIcons.el('save')              → <svg class="svi svi-save">
     SVIcons.draw(ctx, 'film', x, y, 14)  tuvale
     SVIcons.has('save')
   Panelin el() yardımcısı `icon: 'save'` özniteliğini bununla çiziyor. */
(function () {
  const root = typeof window !== 'undefined' ? window : globalThis;
  // Daire: iki yarım yay
  const C = (cx, cy, r) => `M${cx - r} ${cy}a${r} ${r} 0 1 0 ${2 * r} 0a${r} ${r} 0 1 0 ${-2 * r} 0z`;
  // Köşesi yuvarlak dikdörtgen
  const R = (x, y, w, h, r) => (r
    ? `M${x + r} ${y}h${w - 2 * r}a${r} ${r} 0 0 1 ${r} ${r}v${h - 2 * r}a${r} ${r} 0 0 1 ${-r} ${r}h${-(w - 2 * r)}a${r} ${r} 0 0 1 ${-r} ${-r}v${-(h - 2 * r)}a${r} ${r} 0 0 1 ${r} ${-r}z`
    : `M${x} ${y}h${w}v${h}h${-w}z`);
  // Elips
  const E = (cx, cy, rx, ry) => `M${cx - rx} ${cy}a${rx} ${ry} 0 1 0 ${2 * rx} 0a${rx} ${ry} 0 1 0 ${-2 * rx} 0z`;

  /* Tanım: [path, 'f'?] dizisi. 'f' → dolu çiz (çizgisiz), yoksa çizgi. */
  const s = (d) => [d];
  const f = (d) => [d, 'f'];

  const STAR = 'M12 3.5L14.47 9.1L20.56 9.72L15.99 13.8L17.29 19.78L12 16.7L6.71 19.78L8.01 13.8L3.44 9.72L9.53 9.1Z';
  const GEAR = 'M9.70 5.28L10.15 2.89L13.85 2.89L14.30 5.28L15.12 5.62L17.14 4.25L19.75 6.86L18.38 8.88L18.72 9.70L21.11 10.15L21.11 13.85L18.72 14.30L18.38 15.12L19.75 17.14L17.14 19.75L15.12 18.38L14.30 18.72L13.85 21.11L10.15 21.11L9.70 18.72L8.88 18.38L6.86 19.75L4.25 17.14L5.62 15.12L5.28 14.30L2.89 13.85L2.89 10.15L5.28 9.70L5.62 8.88L4.25 6.86L6.86 4.25L8.88 5.62Z';
  const TRAY = 'M4 14.5v3.5a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-3.5';
  const SPEAKER = 'M4 9.5h3.5L12 5.5v13l-4.5-4H4z';
  const LOCK_BODY = R(5, 10.5, 14, 10, 2);

  const ICONS = {
    // ---- dosya ve kayıt ----
    save: [s('M5 5.5a1 1 0 0 1 1-1h10.2l3.3 3.3V18.5a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1z'), s('M8.5 4.5v4h6v-4'), s(R(8, 13, 8, 6.5, 1))],
    export: [s(TRAY), s('M12 15V4'), s('M7.5 8.5L12 4l4.5 4.5')],
    import: [s(TRAY), s('M12 4v11'), s('M7.5 10.5L12 15l4.5-4.5')],
    upload: [s('M12 19.5V5'), s('M6 11l6-6 6 6')],
    download: [s('M12 4.5V19'), s('M6 13l6 6 6-6')],
    trash: [s('M4 7h16'), s('M9.5 7V4.5h5V7'), s('M6.5 7l1 13h9l1-13'), s('M10 11v5.5'), s('M14 11v5.5')],
    folder: [s('M3.5 6.5a1 1 0 0 1 1-1h5l2 2.5h8a1 1 0 0 1 1 1v9a1 1 0 0 1-1 1h-15a1 1 0 0 1-1-1z')],
    'folder-open': [s('M3.5 18.5v-12a1 1 0 0 1 1-1h5l2 2.5h6.5a1 1 0 0 1 1 1v2'), s('M3.5 18.5l2.6-6.8a1 1 0 0 1 .9-.7h14l-2.8 7.3a1 1 0 0 1-.9.7H3.5z')],
    file: [s('M6 4.5a1 1 0 0 1 1-1h7l4 4v12a1 1 0 0 1-1 1H7a1 1 0 0 1-1-1z'), s('M14 3.5v4h4')],
    copy: [s(R(8.5, 8.5, 11.5, 11.5, 2)), s('M15.5 8.5V6a1.5 1.5 0 0 0-1.5-1.5H6A1.5 1.5 0 0 0 4.5 6v8A1.5 1.5 0 0 0 6 15.5h2.5')],
    paste: [s(R(5, 5, 14, 16, 2)), s(R(9, 3, 6, 4, 1)), s('M9 12h6'), s('M9 16h4')],
    box: [s('M12 3l8 4v10l-8 4-8-4V7z'), s('M4 7l8 4 8-4'), s('M12 11v10'), s('M8 5l8 4')],
    archive: [s(R(4, 4, 16, 16, 2)), s('M12 4v1.5'), s('M12 7.5V9'), s(R(10.5, 11, 3, 4, 0.8))],
    pin: [s('M9 3.5h6'), s('M10 3.5v6l-3.5 4h11L14 9.5v-6'), s('M12 13.5V21')],
    tag: [s('M3.5 4.5v6.2a1 1 0 0 0 .3.7l8.8 8.8a1 1 0 0 0 1.4 0l6.2-6.2a1 1 0 0 0 0-1.4L11.4 3.8a1 1 0 0 0-.7-.3H4.5a1 1 0 0 0-1 1z'), f(C(8, 8, 1.4))],
    search: [s(C(10.5, 10.5, 6.2)), s('M15.2 15.2L20 20')],
    pencil: [s('M4.5 19.5l.9-4.1L16 4.8a1.9 1.9 0 0 1 2.7 0l.5.5a1.9 1.9 0 0 1 0 2.7L8.6 18.6z'), s('M14 6.8l3.2 3.2')],
    scissors: [s(C(6.5, 6.5, 2.5)), s(C(6.5, 17.5, 2.5)), s('M8.6 8L20 18'), s('M8.6 16L20 6')],
    lock: [s(LOCK_BODY), s('M8 10.5V7.5a4 4 0 0 1 8 0v3'), s('M12 14.5v2')],
    unlock: [s(LOCK_BODY), s('M8 10.5V7.5a4 4 0 0 1 7.7-1.5'), s('M12 14.5v2')],

    // ---- durum ----
    check: [s('M5 12.5l4.5 4.5L19 7.5')],
    'check-circle': [s(C(12, 12, 9)), s('M8 12.3l2.8 2.8L16.2 9.5')],
    x: [s('M6.5 6.5l11 11'), s('M17.5 6.5l-11 11')],
    star: [s(STAR)],
    'star-fill': [f(STAR), s(STAR)],
    warning: [s('M12 4L21 19.5H3z'), s('M12 10v4.3'), f(C(12, 17, 1))],
    info: [s(C(12, 12, 9)), s('M12 11v5.5'), f(C(12, 7.8, 1))],
    dot: [f(C(12, 12, 4))],
    plus: [s('M12 5v14'), s('M5 12h14')],
    minus: [s('M5 12h14')],

    // ---- oynatma ----
    play: [f('M7.5 4.8v14.4a.8.8 0 0 0 1.2.7l11.3-7.2a.8.8 0 0 0 0-1.4L8.7 4.1a.8.8 0 0 0-1.2.7z')],
    pause: [f(R(6.5, 5, 4, 14, 1)), f(R(13.5, 5, 4, 14, 1))],
    stop: [f(R(6, 6, 12, 12, 1.6))],
    record: [f(C(12, 12, 6.5))],
    next: [f('M5 6.2v11.6a.8.8 0 0 0 1.2.7l8.6-5.8a.8.8 0 0 0 0-1.4L6.2 5.5a.8.8 0 0 0-1.2.7z'), f(R(16, 5.5, 2.8, 13, 1))],
    prev: [f('M19 6.2v11.6a.8.8 0 0 1-1.2.7l-8.6-5.8a.8.8 0 0 1 0-1.4l8.6-5.8a.8.8 0 0 1 1.2.7z'), f(R(5.2, 5.5, 2.8, 13, 1))],
    'play-pause': [f('M3.5 6.5v11a.7.7 0 0 0 1.1.6l7.6-5.5a.7.7 0 0 0 0-1.2L4.6 5.9a.7.7 0 0 0-1.1.6z'), f(R(14, 6, 2.6, 12, 0.8)), f(R(18.4, 6, 2.6, 12, 0.8))],
    loop: [s('M4 11.5V9.5A2.5 2.5 0 0 1 6.5 7H19'), s('M16 4l3 3-3 3'), s('M20 12.5v2a2.5 2.5 0 0 1-2.5 2.5H5'), s('M8 20l-3-3 3-3')],
    shuffle: [s('M4 7h3c2.6 0 3.7 1.6 5 5s2.4 5 5 5h3'), s('M4 17h3c1.3 0 2.2-.4 2.9-1.2'), s('M14.1 8.2c.7-.8 1.6-1.2 2.9-1.2h3'), s('M17.5 4.5L20 7l-2.5 2.5'), s('M17.5 14.5L20 17l-2.5 2.5')],
    refresh: [s('M19.5 12a7.5 7.5 0 0 1-13 5.1'), s('M4.5 12a7.5 7.5 0 0 1 13-5.1'), s('M17.8 3.5v3.6h-3.6'), s('M6.2 20.5v-3.6h3.6')],
    reset: [s('M5.2 9A7.5 7.5 0 1 1 4.5 12'), s('M4.8 4.5V9h4.5')],
    undo: [s('M9 14.5L4.5 10 9 5.5'), s('M4.5 10H15a4.5 4.5 0 0 1 0 9h-3')],
    redo: [s('M15 14.5l4.5-4.5L15 5.5'), s('M19.5 10H9a4.5 4.5 0 0 0 0 9h3')],
    dice: [s(R(4, 4, 16, 16, 3.5)), f(C(8.6, 8.6, 1.35)), f(C(15.4, 8.6, 1.35)), f(C(12, 12, 1.35)), f(C(8.6, 15.4, 1.35)), f(C(15.4, 15.4, 1.35))],
    cut: [s('M12 3.5v17'), s('M8 8L4.5 12 8 16'), s('M16 8l3.5 4-3.5 4')],

    // ---- yön ----
    'chevron-left': [s('M14.5 5.5L8 12l6.5 6.5')],
    'chevron-right': [s('M9.5 5.5L16 12l-6.5 6.5')],
    'chevron-up': [s('M5.5 14.5L12 8l6.5 6.5')],
    'chevron-down': [s('M5.5 9.5L12 16l6.5-6.5')],
    'caret-down': [f('M6.8 9.5h10.4a.6.6 0 0 1 .45 1l-5.2 5.6a.6.6 0 0 1-.9 0l-5.2-5.6a.6.6 0 0 1 .45-1z')],
    'caret-right': [f('M9.5 6.8v10.4a.6.6 0 0 0 1 .45l5.6-5.2a.6.6 0 0 0 0-.9l-5.6-5.2a.6.6 0 0 0-1 .45z')],
    'arrow-up': [s('M12 20V4.5'), s('M6 10.5l6-6 6 6')],
    'arrow-down': [s('M12 4v15.5'), s('M6 13.5l6 6 6-6')],
    'arrow-right': [s('M4 12h15.5'), s('M13.5 6l6 6-6 6')],
    'corner-tl': [s('M17.5 17.5L6.5 6.5'), s('M6.5 15V6.5H15')],
    'corner-tr': [s('M6.5 17.5l11-11'), s('M9 6.5h8.5V15')],
    'corner-bl': [s('M17.5 6.5l-11 11'), s('M6.5 9v8.5H15')],
    'corner-br': [s('M6.5 6.5l11 11'), s('M17.5 9v8.5H9')],
    redirect: [s('M4 18v-3.5a5 5 0 0 1 5-5h11'), s('M16 5.5l4 4-4 4')],
    swap: [s('M4 8h15'), s('M15.5 4.5L19 8l-3.5 3.5'), s('M20 16H5'), s('M8.5 12.5L5 16l3.5 3.5')],
    follow: [s('M4 12h11.5'), s('M11.5 8l4 4-4 4'), s('M20 5v14')],
    fullscreen: [s('M4 9V4h5'), s('M15 4h5v5'), s('M20 15v5h-5'), s('M9 20H4v-5')],
    fit: [s('M3.5 5v14'), s('M20.5 5v14'), s('M7 12h10'), s('M9.5 9.5L7 12l2.5 2.5'), s('M14.5 9.5L17 12l-2.5 2.5')],
    target: [s(C(12, 12, 7)), s('M12 2.5v4'), s('M12 17.5v4'), s('M2.5 12h4'), s('M17.5 12h4'), f(C(12, 12, 1.4))],
    aim: [s(C(12, 12, 8.5)), s(C(12, 12, 5)), f(C(12, 12, 1.6))],
    grip: [f(C(9, 6, 1.4)), f(C(15, 6, 1.4)), f(C(9, 12, 1.4)), f(C(15, 12, 1.4)), f(C(9, 18, 1.4)), f(C(15, 18, 1.4))],
    'lanes-less': [s('M4 12h16'), s('M12 3.5v5'), s('M9.5 6L12 8.5 14.5 6'), s('M12 20.5v-5'), s('M9.5 18l2.5-2.5 2.5 2.5')],
    'lanes-more': [s('M4 12h16'), s('M12 8.5v-5'), s('M9.5 6L12 3.5 14.5 6'), s('M12 15.5v5'), s('M9.5 18l2.5 2.5 2.5-2.5')],

    // ---- medya ----
    image: [s(R(3, 5, 18, 14, 2)), s(C(8.5, 10, 1.6)), s('M4 17.5l5-5 4 4 2.5-2.5 4.5 4')],
    background: [s(R(3, 5, 18, 14, 2)), s('M3.5 17.5l5.5-6.5 4.2 4.5 2.3-2.5 5 4.5'), f(C(16.5, 9.2, 1.5))],
    film: [s(R(4, 3.5, 16, 17, 1.5)), s('M8 3.5v17'), s('M16 3.5v17'), s('M4 8h4'), s('M4 12h4'), s('M4 16h4'), s('M16 8h4'), s('M16 12h4'), s('M16 16h4')],
    clapper: [s('M4 10h16v9a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1z'), s('M4 10L3.4 7.2a1 1 0 0 1 .8-1.2L17.9 3.3a1 1 0 0 1 1.2.8L19.6 6.6z'), s('M8.4 5.3l2.3 3'), s('M13.3 4.3l2.3 3')],
    video: [s(R(3, 6.5, 12.5, 11, 2)), s('M15.5 10.8l5.5-3.3v9l-5.5-3.3')],
    camera: [s('M4 8h3l1.5-2.5h7L17 8h3a1 1 0 0 1 1 1v10a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V9a1 1 0 0 1 1-1z'), s(C(12, 13.5, 3.6))],
    music: [s('M9 17.5V6.5l10-2.5v11'), s(C(6.5, 17.5, 2.5)), s(C(16.5, 15, 2.5))],
    speaker: [s(SPEAKER), s('M15.5 9a4 4 0 0 1 0 6'), s('M18.2 6.3a7.8 7.8 0 0 1 0 11.4')],
    mute: [s(SPEAKER), s('M16 9.5l5 5'), s('M21 9.5l-5 5')],
    mic: [s(R(9, 3, 6, 11, 3)), s('M5.5 11a6.5 6.5 0 0 0 13 0'), s('M12 17.5V21'), s('M9 21h6')],
    text: [s('M5 7V5h14v2'), s('M12 5v14'), s('M9 19h6')],
    bars: [s('M5 20v-6'), s('M9.7 20V6'), s('M14.3 20v-9'), s('M19 20V4')],
    wave: [s('M3 12c2-4.5 4-4.5 6 0s4 4.5 6 0 4-4.5 6 0')],
    drop: [s('M12 3.5c3.6 4.2 6 7.6 6 10.8a6 6 0 0 1-12 0c0-3.2 2.4-6.6 6-10.8z'), s('M9.2 14.5a2.9 2.9 0 0 0 2.5 2.8')],
    code: [s('M8.5 7L3.5 12l5 5'), s('M15.5 7l5 5-5 5'), s('M13.5 5l-3 14')],

    // ---- ekran ve cihaz ----
    monitor: [s(R(3, 4, 18, 12.5, 2)), s('M9 20.5h6'), s('M12 16.5v4')],
    tv: [s(R(3, 7, 18, 13, 2)), s('M8.5 3l3.5 4 3.5-4')],
    window: [s(R(3, 4, 18, 16, 2)), s('M3 9h18'), f(C(6, 6.5, 0.9)), f(C(8.8, 6.5, 0.9))],
    phone: [s(R(7, 3, 10, 18, 2)), s('M11 17.5h2')],
    gear: [s(GEAR), s(C(12, 12, 3))],
    sliders: [s('M6 4v16'), s('M12 4v16'), s('M18 4v16'), f(R(3.8, 12.5, 4.4, 3.2, 1)), f(R(9.8, 6.5, 4.4, 3.2, 1)), f(R(15.8, 10, 4.4, 3.2, 1))],
    keys: [s(R(3, 5, 18, 14, 1.5)), s('M7.5 13v6'), s('M12 13v6'), s('M16.5 13v6'), f(R(6.3, 5, 2.4, 8, 0.4)), f(R(10.8, 5, 2.4, 8, 0.4)), f(R(15.3, 5, 2.4, 8, 0.4))],
    broadcast: [f(C(12, 12, 2)), s('M8 8a5.7 5.7 0 0 0 0 8'), s('M16 8a5.7 5.7 0 0 1 0 8'), s('M5.2 5.2a9.6 9.6 0 0 0 0 13.6'), s('M18.8 5.2a9.6 9.6 0 0 1 0 13.6')],
    magnet: [s('M5.5 4h4v8a2.5 2.5 0 0 0 5 0V4h4v8a6.5 6.5 0 0 1-13 0z'), s('M5.5 8h4'), s('M14.5 8h4')],

    // ---- ışık ve renk ----
    bulb: [s('M9 17.5h6'), s('M10 20.5h4'), s('M8.6 14.8A6 6 0 1 1 15.4 14.8c-.6.5-.9 1.1-.9 1.8v.9h-5v-.9c0-.7-.3-1.3-.9-1.8z')],
    palette: [s('M12 3.5a8.5 8.5 0 1 0 0 17c1.2 0 1.8-.9 1.5-1.9-.4-1.3.3-2.6 1.8-2.6h1.7a3.5 3.5 0 0 0 3.5-3.6C20.4 7.4 16.7 3.5 12 3.5z'), f(C(7.6, 11.2, 1.2)), f(C(9.8, 7.4, 1.2)), f(C(14.4, 7.4, 1.2))],
    rainbow: [s('M3 18a9 9 0 0 1 18 0'), s('M6.5 18a5.5 5.5 0 0 1 11 0'), s('M10 18a2 2 0 0 1 4 0')],
    sun: [s(C(12, 12, 4)), s('M12 2.5v2.3'), s('M12 19.2v2.3'), s('M2.5 12h2.3'), s('M19.2 12h2.3'), s('M5.3 5.3l1.6 1.6'), s('M17.1 17.1l1.6 1.6'), s('M5.3 18.7l1.6-1.6'), s('M17.1 6.9l1.6-1.6')],
    moon: [s('M19.5 14.5A8 8 0 1 1 9.5 4.5a6.5 6.5 0 0 0 10 10z')],
    bolt: [s('M13.5 3L5.5 13.5h6.5L10.5 21l8-10.5H12z')],
    sparkles: [s('M10 5c.5 3.8 2.2 5.5 6 6-3.8.5-5.5 2.2-6 6-.5-3.8-2.2-5.5-6-6 3.8-.5 5.5-2.2 6-6z'), s('M18.5 3v4'), s('M16.5 5h4'), s('M18 16.5v3'), s('M16.5 18h3')],
    sparkle: [s('M12 3.5c.6 4.6 2.9 6.9 7.5 7.5-4.6.6-6.9 2.9-7.5 7.5-.6-4.6-2.9-6.9-7.5-7.5 4.6-.6 6.9-2.9 7.5-7.5z')],
    fog: [s('M4 8c1.5-1.2 3-1.2 4.5 0s3 1.2 4.5 0 3-1.2 4.5 0'), s('M6 12.5c1.5-1.2 3-1.2 4.5 0s3 1.2 4.5 0 3-1.2 4.5 0'), s('M4 17c1.5-1.2 3-1.2 4.5 0s3 1.2 4.5 0 3-1.2 4.5 0')],
    disco: [s(C(12, 13.5, 7.5)), s('M4.5 13.5h15'), s('M12 6c-2.4 2-3.5 4.5-3.5 7.5s1.1 5.5 3.5 7.5'), s('M12 6c2.4 2 3.5 4.5 3.5 7.5s-1.1 5.5-3.5 7.5'), s('M12 2v4')],

    // ---- motorlar ve kategoriler ----
    flask: [s('M9.5 3.5h5'), s('M10.5 3.5v5.2L5.3 18a1.7 1.7 0 0 0 1.5 2.5h10.4a1.7 1.7 0 0 0 1.5-2.5l-5.2-9.3V3.5'), s('M7.6 14.5h8.8')],
    library: [s(R(3.5, 4, 4, 16, 1)), s(R(9.5, 4, 4, 16, 1)), s('M15 6.2l3.4-.9 3.6 13.5-3.4.9z')],
    layers: [s('M12 4l8.5 4.5L12 13 3.5 8.5z'), s('M3.5 12.5L12 17l8.5-4.5'), s('M3.5 16.5L12 21l8.5-4.5')],
    cube: [s('M12 3l8 4.5v9L12 21l-8-4.5v-9z'), s('M4 7.5l8 4.5 8-4.5'), s('M12 12v9')],
    infinity: [s('M12 12c-2-2.7-3.7-4-5.5-4a4 4 0 0 0 0 8c1.8 0 3.5-1.3 5.5-4s3.7-4 5.5-4a4 4 0 0 1 0 8c-1.8 0-3.5-1.3-5.5-4z')],
    ellipse: [s(E(12, 12, 8.5, 5.5))],
    'chart-line': [s('M4 4v16h16'), s('M7.5 15l3.5-4.5 3 2.5 5-6.5')],
    'chart-bar': [s('M4 20h16'), s(R(6, 13, 3, 7, 0.6)), s(R(10.5, 7, 3, 13, 0.6)), s(R(15, 10, 3, 10, 0.6))],
    list: [s('M9 6h11'), s('M9 12h11'), s('M9 18h11'), f(C(5, 6, 1.2)), f(C(5, 12, 1.2)), f(C(5, 18, 1.2))],
    grid: [s(R(4, 4, 16, 16, 1.5)), s('M4 9.3h16'), s('M4 14.7h16'), s('M9.3 4v16'), s('M14.7 4v16')],
    // Projeksiyon haritalama: köşeleri çekilmiş dörtgen
    warp: [s('M5.5 6.5L18 4.5l2 14-15 1z'), f(C(5.5, 6.5, 1.7)), f(C(18, 4.5, 1.7)), f(C(20, 18.5, 1.7)), f(C(5, 19.5, 1.7))],
    // Zaman çizelgesi: kaydırılmış şeritler ve oynatma kafası
    timeline: [s('M4 6.5h8'), s('M8 12h12'), s('M4 17.5h10'), s('M16.5 3.5v17')],
    // Ağ (OSC): üç düğüm
    share: [s(C(6, 12, 2.5)), s(C(17.5, 6, 2.5)), s(C(17.5, 18, 2.5)), s('M8.2 10.8l7.1-3.6'), s('M8.2 13.2l7.1 3.6')],
    dna: [s('M7 3c0 4.5 10 4.5 10 9s-10 4.5-10 9'), s('M17 3c0 4.5-10 4.5-10 9s10 4.5 10 9'), s('M8.5 6h7'), s('M8.5 18h7')],
    drum: [s(E(12, 9, 7.5, 3)), s('M4.5 9v7c0 1.7 3.4 3 7.5 3s7.5-1.3 7.5-3V9'), s('M8 3.5l3.5 4'), s('M16 3.5l-3.5 4')],
    metronome: [s('M9 3.5h6l3.5 17h-13z'), s('M12 15.5l5-8.5'), s('M6.2 16h11.6')],
    hand: [s('M8 13V6.5a1.5 1.5 0 0 1 3 0V12'), s('M11 11.5V5a1.5 1.5 0 0 1 3 0v6.5'), s('M14 11.5V6.5a1.5 1.5 0 0 1 3 0V14a7 7 0 0 1-7 7 6 6 0 0 1-5-2.8l-1.4-2.8a1.5 1.5 0 0 1 2.6-1.4L8 15.5')],
  };

  const NS = 'http://www.w3.org/2000/svg';

  function has(name) { return Object.prototype.hasOwnProperty.call(ICONS, name); }

  /* SVG öğesi. Bilinmeyen ad sessizce boş kalmaz: 'dot' çizilir ve konsola
     yazılır, eksik ikon arayüzde görünmez bir boşluk bırakmasın. */
  function el(name, cls) {
    const def = has(name) ? ICONS[name] : ICONS.dot;
    if (!has(name) && typeof console !== 'undefined') console.warn('[icons] bilinmeyen ikon:', name);
    const svg = document.createElementNS(NS, 'svg');
    svg.setAttribute('viewBox', '0 0 24 24');
    svg.setAttribute('class', 'svi svi-' + name + (cls ? ' ' + cls : ''));
    svg.setAttribute('aria-hidden', 'true');
    svg.setAttribute('focusable', 'false');
    /* Çizgi nitelikleri öğenin üstünde: sayfada ikon CSS'i olmasa da
       (yayın sunucusunun kumanda sayfası) doğru çizilsin. Boyut CSS'le
       ezilebilir; varsayılanı yazının boyuna bağlı. */
    svg.setAttribute('width', '1.15em');
    svg.setAttribute('height', '1.15em');
    svg.setAttribute('fill', 'none');
    svg.setAttribute('stroke', 'currentColor');
    svg.setAttribute('stroke-width', '1.8');
    svg.setAttribute('stroke-linecap', 'round');
    svg.setAttribute('stroke-linejoin', 'round');
    for (const [d, mode] of def) {
      const p = document.createElementNS(NS, 'path');
      p.setAttribute('d', d);
      if (mode === 'f') { p.setAttribute('fill', 'currentColor'); p.setAttribute('stroke', 'none'); }
      svg.appendChild(p);
    }
    return svg;
  }

  /* Düz SVG metni (CSS mask-image için data: URL'si kurarken). */
  function markup(name, color) {
    const def = has(name) ? ICONS[name] : ICONS.dot;
    const c = color || '#000';
    const body = def.map(([d, mode]) => (mode === 'f'
      ? `<path d="${d}" fill="${c}"/>`
      : `<path d="${d}" fill="none" stroke="${c}" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/>`)).join('');
    return `<svg xmlns="${NS}" viewBox="0 0 24 24">${body}</svg>`;
  }

  /* Tuvale çizim: (x, y) sol üst köşe, size piksel. Renk ctx'in o anki
     fillStyle'ından alınır; çizgi rengi de ona eşitlenir. */
  function draw(ctx, name, x, y, size) {
    if (!ctx || typeof Path2D === 'undefined') return;
    const def = has(name) ? ICONS[name] : ICONS.dot;
    const k = size / 24;
    ctx.save();
    ctx.translate(x, y);
    ctx.scale(k, k);
    ctx.strokeStyle = ctx.fillStyle;
    ctx.lineWidth = 1.8;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    for (const [d, mode] of def) {
      const p = new Path2D(d);
      if (mode === 'f') ctx.fill(p); else ctx.stroke(p);
    }
    ctx.restore();
  }

  /* Bir düğmenin ikonunu ve yazısını birlikte değiştirir. textContent'e
     doğrudan yazmak ikonu siler; durumu değişen düğmeler (Aç/Uygula,
     Karart/Kaldır, oynat/duraklat) bunu kullanıyor. Yazı ayrı bir metin
     düğümünde kalıyor: çeviri tam metin düğümünü eşliyor. */
  function set(node, name, text) {
    if (!node) return node;
    while (node.firstChild) node.removeChild(node.firstChild);
    if (name) node.appendChild(el(name, text ? 'svi-lead' : ''));
    if (text) node.appendChild(document.createTextNode(text));
    node.dataset.icon = name || '';
    return node;
  }

  /* Durağan HTML'deki [data-icon] öğelerine ikonu koyar (üst çubuk,
     uyarı bantları, dock düğmeleri). Yazı olduğu gibi kalıyor. İkinci kez
     çağrılırsa aynı öğeye ikinci ikon eklenmiyor. */
  function hydrate(root) {
    const scope = root || document;
    scope.querySelectorAll('[data-icon]').forEach((n) => {
      const name = n.getAttribute('data-icon');
      if (!name || (n.firstChild && n.firstChild.nodeType === 1 && n.firstChild.classList && n.firstChild.classList.contains('svi'))) return;
      n.insertBefore(el(name, n.textContent.trim() ? 'svi-lead' : ''), n.firstChild);
    });
  }

  const api = { el, set, draw, markup, has, hydrate, names: () => Object.keys(ICONS), ICONS };
  root.SVIcons = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})();
