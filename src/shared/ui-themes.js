/*
 * SoundVisualizer — CaYaDev Ses Görselleştirici
 * Copyright (c) 2026 Çağan Turgut (CaYatur) — CaYaDev, https://cayadev.com
 * https://github.com/CaYatur/SoundVisualizer
 * SPDX-License-Identifier: MIT
 */
'use strict';
/* ARAYÜZ TEMALARI (#770).

   Panelin bütün renkleri bu tablodan gelir. admin.css ve studio.css renk
   yazmaz; yalnız buradaki değişkenleri (`var(--x)`) kullanır. CaYaDev teması
   admin.css'in :root bloğunda da aynen durur (betik yüklenmeden önceki ilk
   çizim için); test ikisinin eşit olduğunu denetler.

   Değişken türleri:
     - renk: '#rrggbb' ya da 'rgba(...)' (popover, perde gibi yarı saydam
       yüzeyler);
     - kanal: '255 255 255' — CSS'te `rgb(var(--fg-rgb) / .05)` biçiminde
       saydamlıkla kullanılır. Koyu temada beyaz olan bir ince örtü aydınlık
       temada koyu olmalı; saydamlık CSS'te kalır, ton temadan gelir.

   Görselleştirici çıktısı, yayın katmanı ve kullanıcının kendi renkleri
   (paletler, renk seçiciler, klip renkleri) temaya bağlı DEĞİL. Medya
   önizlemesinin zemini (`--media-*`) her temada koyu kalır: üstünde
   görüntü durur.

   "Cihaz varsayılanı" bir tema değil, seçim: işletim sisteminin açık/koyu
   tercihine göre Karanlık ya da Aydınlık'a çözülür ve tercih değişince
   canlı izlenir.

   `--accent2` yazı olarak da kullanılıyor (grup başlıkları), bu yüzden koyu
   zeminde açık olmalı; dolu düğmelerin geçişi `--accent` → `--accent-grad`
   ve üstündeki yazı (`--on-accent`) geçişin ortasında da okunmalı. İkisi
   aynı renk olamaz: koyu kartta 4.5:1 okunan bir kırmızının üstünde beyaz
   yazı 4.5:1 okunamaz. */
(function () {
  const DEFAULT_ID = 'cayadev';
  const SYSTEM_ID = 'system';

  /* Bütün temaların tanımlaması ZORUNLU değişkenler ve rolleri. Rol,
     karşıtlık testinin ve yeni bir değişken ekleyenin rehberi. */
  const TOKENS = {
    // Yüzeyler (koyudan açığa ya da açıktan koyuya, iç içe kartlar)
    '--bg': 'color', '--bg2': 'color', '--surface': 'color',
    '--card': 'color', '--card2': 'color', '--card3': 'color', '--card-end': 'color',
    '--popover': 'color', '--scrim': 'color',
    '--glow-a': 'color', '--glow-b': 'color',
    // Çizgiler
    '--line': 'color', '--line2': 'color',
    // Yazı
    '--text': 'color', '--text-strong': 'color', '--muted': 'color', '--muted2': 'color',
    '--brand-ink': 'color',
    // Vurgu
    '--accent': 'color', '--accent2': 'color', '--accent-grad': 'color', '--accent-rgb': 'rgb', '--on-accent': 'color',
    '--accent-text': 'color', '--accent-label': 'color', '--on-solid': 'color',
    // Durumlar
    '--ok': 'color', '--ok-rgb': 'rgb', '--ok-text': 'color',
    '--warn': 'color', '--warn-rgb': 'rgb', '--warn-text': 'color', '--on-warn': 'color',
    '--danger': 'color', '--danger-rgb': 'rgb', '--danger-text': 'color',
    '--solo': 'color', '--on-solo': 'color', '--lock': 'color', '--off': 'color',
    '--sel-rgb': 'rgb', '--info-rgb': 'rgb', '--tempo': 'color',
    // Örtüler ve gölge
    '--fg-rgb': 'rgb', '--shade-rgb': 'rgb', '--shadow-rgb': 'rgb', '--knob': 'color',
    // Klip destesi, performans görünümü, ölçerler
    '--cue-live': 'color', '--cue-armed': 'color', '--slot-default': 'color',
    '--meter-mid': 'color', '--meter-hot': 'color',
    // Kod düzenleyicileri (Studio, MilkDrop, şarkı sözü, MCP)
    '--code-bg': 'color', '--code-gutter': 'color', '--code-fg': 'color',
    '--syn-kw': 'color', '--syn-type': 'color', '--syn-fn': 'color',
    '--syn-num': 'color', '--syn-com': 'color', '--syn-pre': 'color',
    // Medya önizlemesi (her temada koyu)
    '--media-bg': 'color', '--media-scrim': 'color', '--on-media-rgb': 'rgb',
  };
  const TOKEN_NAMES = Object.keys(TOKENS);

  // Her temada aynı kalan medya zemini
  const MEDIA = {
    '--media-bg': '#05040a',
    '--media-scrim': 'rgba(0, 0, 0, .55)',
    '--on-media-rgb': '255 255 255',
  };

  const CAYADEV = Object.assign({
    '--bg': '#0b0910', '--bg2': '#120d13', '--surface': '#17111a',
    '--card': '#1b141f', '--card2': '#241a29', '--card3': '#2c2032', '--card-end': 'rgba(16, 11, 18, .9)',
    '--popover': 'rgba(20, 14, 22, .985)', '--scrim': 'rgba(3, 3, 8, .62)',
    '--glow-a': '#3d1016', '--glow-b': '#1d1030',
    '--line': '#34222f', '--line2': '#472c3a',
    '--text': '#f4edf1', '--text-strong': '#ffffff', '--muted': '#b2969f', '--muted2': '#a1858f',
    '--brand-ink': '#ffffff',
    '--accent': '#e11d2a', '--accent2': '#ff4d5e', '--accent-grad': '#ea2636', '--accent-rgb': '225 29 42', '--on-accent': '#ffffff',
    '--accent-text': '#ff9aa3', '--accent-label': '#ffc7cd', '--on-solid': '#ffffff',
    '--ok': '#43d98a', '--ok-rgb': '67 217 138', '--ok-text': '#9df0c4',
    '--warn': '#ffc44d', '--warn-rgb': '255 196 77', '--warn-text': '#f3cf82', '--on-warn': '#1b141f',
    '--danger': '#d93a40', '--danger-rgb': '255 80 80', '--danger-text': '#ff8a8a',
    '--solo': '#f5a524', '--on-solo': '#1a1a1a', '--lock': '#6e56cf', '--off': '#6a4a52',
    '--sel-rgb': '124 92 255', '--info-rgb': '120 180 255', '--tempo': '#50d2e6',
    '--fg-rgb': '255 255 255', '--shade-rgb': '0 0 0', '--shadow-rgb': '0 0 0', '--knob': '#ffffff',
    '--cue-live': '#2ea043', '--cue-armed': '#f0b429', '--slot-default': '#4f8cff',
    '--meter-mid': '#ffd54a', '--meter-hot': '#ff5e6c',
    '--code-bg': '#0d0a11', '--code-gutter': '#0a0810', '--code-fg': '#e7dfe9',
    '--syn-kw': '#ff7b8a', '--syn-type': '#7fd6ff', '--syn-fn': '#c39bff',
    '--syn-num': '#ffc46b', '--syn-com': '#9a8aa0', '--syn-pre': '#8fdca0',
  }, MEDIA);

  // Koyu temaların ortak durum ve kod renkleri CaYaDev'den
  function darkFrom(over) { return Object.assign({}, CAYADEV, over); }

  const LIGHT = Object.assign({
    '--bg': '#eef0f4', '--bg2': '#e6e9ee', '--surface': '#f4f5f8',
    '--card': '#ffffff', '--card2': '#f4f5f8', '--card3': '#e8ebf0', '--card-end': 'rgba(249, 250, 252, .96)',
    '--popover': 'rgba(255, 255, 255, .99)', '--scrim': 'rgba(24, 28, 40, .42)',
    '--glow-a': '#fbe3e6', '--glow-b': '#e3e7fb',
    '--line': '#d8dce4', '--line2': '#bfc5d0',
    '--text': '#16181d', '--text-strong': '#000000', '--muted': '#454b58', '--muted2': '#5b6170',
    '--brand-ink': '#16181d',
    '--accent': '#c8102e', '--accent2': '#b3132b', '--accent-grad': '#e0213d', '--accent-rgb': '200 16 46', '--on-accent': '#ffffff',
    '--accent-text': '#a00d24', '--accent-label': '#8f0c20', '--on-solid': '#ffffff',
    '--ok': '#0e6236', '--ok-rgb': '14 98 54', '--ok-text': '#0d5e33',
    '--warn': '#8f5600', '--warn-rgb': '200 130 0', '--warn-text': '#6f4300', '--on-warn': '#ffffff',
    '--danger': '#c62828', '--danger-rgb': '210 40 40', '--danger-text': '#9c1a17',
    '--solo': '#f5a524', '--on-solo': '#1a1a1a', '--lock': '#5b45c2', '--off': '#9aa0ad',
    '--sel-rgb': '98 70 230', '--info-rgb': '0 112 200', '--tempo': '#00708a',
    '--fg-rgb': '20 24 36', '--shade-rgb': '255 255 255', '--shadow-rgb': '30 36 52', '--knob': '#ffffff',
    '--cue-live': '#1f883d', '--cue-armed': '#b07800', '--slot-default': '#2f6fe0',
    '--meter-mid': '#d9a400', '--meter-hot': '#e5484d',
    '--code-bg': '#f6f7f9', '--code-gutter': '#eceef2', '--code-fg': '#1f2328',
    '--syn-kw': '#b3132b', '--syn-type': '#0b5fa5', '--syn-fn': '#6b33b8',
    '--syn-num': '#8a5100', '--syn-com': '#5d6472', '--syn-pre': '#1a6e33',
  }, MEDIA);

  const THEMES = [
    { id: 'cayadev', name: 'CaYaDev', scheme: 'dark', tokens: CAYADEV },
    {
      id: 'dark', name: 'Karanlık', scheme: 'dark',
      tokens: darkFrom({
        '--bg': '#0f1115', '--bg2': '#14171c', '--surface': '#181b21',
        '--card': '#1c1f26', '--card2': '#21252c', '--card3': '#272b33', '--card-end': 'rgba(21, 24, 29, .92)',
        '--popover': 'rgba(24, 27, 33, .985)', '--scrim': 'rgba(4, 5, 8, .62)',
        '--glow-a': '#14223a', '--glow-b': '#191b26',
        '--line': '#2f343d', '--line2': '#3e4450',
        '--text': '#e9ecf1', '--muted': '#aab1bd', '--muted2': '#9299a6',
        '--accent': '#3170e2', '--accent2': '#6aa7ff', '--accent-grad': '#2a5fd0', '--accent-rgb': '49 112 226',
        '--accent-text': '#9cc4ff', '--accent-label': '#c7dcff',
        '--off': '#4b515c',
        '--code-bg': '#111317', '--code-gutter': '#0d0f12', '--code-fg': '#e6e8ec',
        '--syn-com': '#8f97a3',
      }),
    },
    { id: 'light', name: 'Aydınlık', scheme: 'light', tokens: LIGHT },
    {
      id: 'contrast', name: 'Yüksek Karşıtlık', scheme: 'dark', aaa: true,
      tokens: darkFrom({
        '--bg': '#000000', '--bg2': '#000000', '--surface': '#000000',
        '--card': '#000000', '--card2': '#0c0c0c', '--card3': '#1a1a1a', '--card-end': 'rgba(0, 0, 0, 1)',
        '--popover': 'rgba(0, 0, 0, 1)', '--scrim': 'rgba(0, 0, 0, .82)',
        '--glow-a': '#000000', '--glow-b': '#000000',
        '--line': '#8c8c8c', '--line2': '#d0d0d0',
        '--text': '#ffffff', '--muted': '#ececec', '--muted2': '#d4d4d4',
        '--accent': '#ffd400', '--accent2': '#ffe14d', '--accent-grad': '#ffe14d', '--accent-rgb': '255 212 0', '--on-accent': '#000000',
        '--on-solid': '#000000', '--knob': '#000000',
        '--accent-text': '#ffe14d', '--accent-label': '#fff1a6',
        '--ok': '#3dff8f', '--ok-rgb': '61 255 143', '--ok-text': '#9dffc7',
        '--warn': '#ffae33', '--warn-rgb': '255 174 51', '--warn-text': '#ffd08a', '--on-warn': '#000000',
        '--danger': '#ff7070', '--danger-rgb': '255 112 112', '--danger-text': '#ffa3a3',
        '--solo': '#ffae33', '--on-solo': '#000000', '--lock': '#c7b3ff', '--off': '#3d3d3d',
        '--sel-rgb': '170 150 255', '--info-rgb': '90 220 255', '--tempo': '#5ae6ff',
        '--cue-live': '#3dff8f', '--cue-armed': '#ffd400', '--slot-default': '#5fb0ff',
        '--meter-mid': '#ffd400', '--meter-hot': '#ff5c5c',
        '--code-bg': '#000000', '--code-gutter': '#0c0c0c', '--code-fg': '#ffffff',
        '--syn-kw': '#ff9eb0', '--syn-type': '#8ae4ff', '--syn-fn': '#dcc6ff',
        '--syn-num': '#ffd78a', '--syn-com': '#cfcfcf', '--syn-pre': '#a6f5ba',
      }),
    },
    {
      id: 'midnight', name: 'Gece Mavisi', scheme: 'dark',
      tokens: darkFrom({
        '--bg': '#0a0f1c', '--bg2': '#0e1424', '--surface': '#111829',
        '--card': '#141c30', '--card2': '#1a2440', '--card3': '#212d4d', '--card-end': 'rgba(13, 19, 34, .92)',
        '--popover': 'rgba(17, 24, 41, .985)', '--scrim': 'rgba(3, 6, 14, .64)',
        '--glow-a': '#0c2b4a', '--glow-b': '#1b1640',
        '--line': '#24304d', '--line2': '#32426c',
        '--text': '#e6edf8', '--muted': '#a6b4ce', '--muted2': '#8e9dbb',
        '--accent': '#22c3d8', '--accent2': '#67e1ef', '--accent-grad': '#67e1ef', '--accent-rgb': '34 195 216', '--on-accent': '#04121a',
        '--knob': '#04121a',
        '--accent-text': '#8fe9f4', '--accent-label': '#c4f3f9',
        '--off': '#3f4c6b',
        '--code-bg': '#0b1222', '--code-gutter': '#08101d', '--code-fg': '#dde6f5',
        '--syn-com': '#8d9bb8',
      }),
    },
    {
      id: 'sepia', name: 'Sepya', scheme: 'light',
      tokens: Object.assign({}, LIGHT, {
        '--bg': '#efe5d3', '--bg2': '#e8dcc6', '--surface': '#f4ebdc',
        '--card': '#fbf5ea', '--card2': '#f3e9d7', '--card3': '#e9dbc2', '--card-end': 'rgba(246, 238, 224, .96)',
        '--popover': 'rgba(251, 245, 234, .99)', '--scrim': 'rgba(50, 35, 20, .42)',
        '--glow-a': '#f4d6bf', '--glow-b': '#e8dcc4',
        '--line': '#dac7a5', '--line2': '#c6af88',
        '--text': '#3a2a1a', '--text-strong': '#22160a', '--muted': '#5a4633', '--muted2': '#6a5541',
        '--brand-ink': '#3a2a1a',
        '--accent': '#a8441a', '--accent2': '#963c16', '--accent-grad': '#c25a22', '--accent-rgb': '168 68 26',
        '--accent-text': '#82300f', '--accent-label': '#762c0f',
        '--ok': '#1f5a33', '--ok-rgb': '31 90 51', '--ok-text': '#1d5530',
        '--warn': '#875400', '--warn-text': '#674000',
        '--danger': '#b3261e', '--danger-text': '#8a1a14',
        '--fg-rgb': '60 40 20', '--shade-rgb': '255 250 240', '--shadow-rgb': '80 55 30',
        '--off': '#a8987f', '--tempo': '#00627a',
        '--cue-live': '#2c7040', '--cue-armed': '#a06800', '--slot-default': '#3b6db0',
        '--code-bg': '#f8f0e2', '--code-gutter': '#efe3cf', '--code-fg': '#3a2a1a',
        '--syn-kw': '#9e2f1a', '--syn-type': '#1d5986', '--syn-fn': '#663b98',
        '--syn-num': '#7f5200', '--syn-com': '#66584a', '--syn-pre': '#2a6530',
      }),
    },
    {
      id: 'neon', name: 'Neon', scheme: 'dark',
      tokens: darkFrom({
        '--bg': '#0d0618', '--bg2': '#120a22', '--surface': '#160c2a',
        '--card': '#1a0f31', '--card2': '#23143f', '--card3': '#2c1a4e', '--card-end': 'rgba(18, 9, 34, .92)',
        '--popover': 'rgba(24, 13, 44, .985)', '--scrim': 'rgba(6, 2, 14, .64)',
        '--glow-a': '#4a0c4f', '--glow-b': '#0a2c4a',
        '--line': '#3a2363', '--line2': '#4f3085',
        '--text': '#f6ecff', '--muted': '#c6b2e2', '--muted2': '#a993cc',
        '--accent': '#d61f87', '--accent2': '#2fd8f0', '--accent-grad': '#9b2ff0', '--accent-rgb': '214 31 135',
        '--accent-text': '#ff9fd6', '--accent-label': '#ffcbe9',
        '--off': '#5a3f80',
        '--code-bg': '#110820', '--code-gutter': '#0c0618', '--code-fg': '#efe4ff',
        '--syn-com': '#a08fbe',
      }),
    },
  ];

  const BY_ID = {};
  THEMES.forEach((t) => { BY_ID[t.id] = t; });

  /* Seçim listesi: temalar + "Cihaz varsayılanı". Sıra panelde görünen
     sıra. */
  const CHOICES = [
    { id: 'cayadev' }, { id: SYSTEM_ID, name: 'Cihaz varsayılanı' },
    { id: 'dark' }, { id: 'light' }, { id: 'contrast' },
    { id: 'midnight' }, { id: 'sepia' }, { id: 'neon' },
  ].map((c) => (c.id === SYSTEM_ID ? c : { id: c.id, name: BY_ID[c.id].name }));

  function normalizeId(id) {
    return id === SYSTEM_ID || Object.prototype.hasOwnProperty.call(BY_ID, id) ? id : DEFAULT_ID;
  }

  // Seçimi (system dahil) somut bir temaya çevirir
  function resolve(id, prefersDark) {
    const n = normalizeId(id);
    if (n === SYSTEM_ID) return BY_ID[prefersDark === false ? 'light' : 'dark'];
    return BY_ID[n];
  }

  // ---- Renk hesapları (karşıtlık testi ve öz testteki tarama kullanır) ----
  function parseColor(s) {
    if (typeof s !== 'string') return null;
    const t = s.trim();
    let m = /^#([0-9a-f]{3}|[0-9a-f]{6}|[0-9a-f]{8})$/i.exec(t);
    if (m) {
      let h = m[1];
      if (h.length === 3) h = h.split('').map((c) => c + c).join('');
      const a = h.length === 8 ? parseInt(h.slice(6, 8), 16) / 255 : 1;
      return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16), a];
    }
    m = /^rgba?\(\s*([\d.]+)[\s,]+([\d.]+)[\s,]+([\d.]+)(?:\s*[,/]\s*([\d.]+%?))?\s*\)$/i.exec(t);
    if (m) {
      let a = m[4] === undefined ? 1 : m[4].endsWith('%') ? parseFloat(m[4]) / 100 : parseFloat(m[4]);
      if (!Number.isFinite(a)) a = 1;
      return [+m[1], +m[2], +m[3], a];
    }
    m = /^([\d.]+)\s+([\d.]+)\s+([\d.]+)$/.exec(t); // kanal değişkeni
    if (m) return [+m[1], +m[2], +m[3], 1];
    return null;
  }

  // Yarı saydam bir rengi opak bir zeminin üstüne koyar
  function over(top, base) {
    const a = top[3];
    return [0, 1, 2].map((i) => top[i] * a + base[i] * (1 - a)).concat(1);
  }

  function luminance(c) {
    const ch = c.slice(0, 3).map((v) => {
      const x = v / 255;
      return x <= 0.04045 ? x / 12.92 : Math.pow((x + 0.055) / 1.055, 2.4);
    });
    return 0.2126 * ch[0] + 0.7152 * ch[1] + 0.0722 * ch[2];
  }

  function contrast(a, b) {
    const ca = typeof a === 'string' ? parseColor(a) : a;
    const cb = typeof b === 'string' ? parseColor(b) : b;
    const la = luminance(ca);
    const lb = luminance(cb);
    return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
  }

  // Bir temanın değişkenini opak renge çevirir (yarı saydamsa --bg üstünde)
  function solid(theme, name, base) {
    const c = parseColor(theme.tokens[name]);
    if (!c) return null;
    if (c[3] >= 1) return c;
    return over(c, base || solid(theme, '--bg'));
  }

  // Kanal değişkenini saydamlıkla bir zeminin üstüne koyar
  function tint(theme, rgbName, alpha, baseName) {
    const c = parseColor(theme.tokens[rgbName]);
    return over([c[0], c[1], c[2], alpha], solid(theme, baseName));
  }

  /* Belgeye uygular. CaYaDev'de satır içi değerler silinir: admin.css'in
     :root'u zaten CaYaDev. */
  function apply(doc, id, prefersDark) {
    const theme = resolve(id, prefersDark);
    const el = doc.documentElement;
    TOKEN_NAMES.forEach((n) => {
      if (theme.id === DEFAULT_ID) el.style.removeProperty(n);
      else el.style.setProperty(n, theme.tokens[n]);
    });
    el.style.colorScheme = theme.scheme;
    el.setAttribute('data-ui-theme', theme.id);
    el.setAttribute('data-ui-scheme', theme.scheme);
    return theme;
  }

  const api = {
    DEFAULT_ID, SYSTEM_ID, TOKENS, TOKEN_NAMES, THEMES, CHOICES,
    byId: (id) => BY_ID[id] || null,
    normalizeId, resolve, apply,
    parseColor, over, luminance, contrast, solid, tint,
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (typeof window !== 'undefined') window.SVUiThemes = api;
})();
