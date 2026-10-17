/*
 * SoundVisualizer — CaYaDev Ses Görselleştirici
 * Copyright (c) 2026 Çağan Turgut (CaYatur) — CaYaDev, https://cayadev.com
 * https://github.com/CaYatur/SoundVisualizer
 * SPDX-License-Identifier: MIT
 */
'use strict';
/* TEMA KARŞITLIK KURALLARI (#770).

   Her tema için hangi yazı hangi zeminde okunmalı, eşik ne. Testler ve
   öz test bu listeyi kullanır; yeni bir yazı rengi ya da yüzey eklenirse
   buraya da girer.

   Eşikler WCAG 2.2'den:
     - yazı 4.5:1 (panelin yazılarının çoğu 10.5–13 px, yani "küçük yazı");
     - anlam taşıyan çizgi, odak halkası, düğme topuzu 3:1 (1.4.11);
     - Yüksek Karşıtlık temasında yazı 7:1 (AAA). */
(function () {
  const T = typeof module !== 'undefined' && module.exports ? require('./ui-themes') : window.SVUiThemes;
  const SURFACES = ['--bg', '--bg2', '--surface', '--card', '--card2', '--card3'];
  const TEXT = 4.5;
  const AAA = 7;
  const UI = 3;

  /* Kurallar: { fg, on, min, why }. `on` bir değişken adı ya da
     { tint: kanal, alpha, base } (yarı saydam örtülü zemin). `min` 'text'
     ise tema AAA'ysa 7, değilse 4.5. */
  function rules() {
    const out = [];
    const text = (fg, on, why) => out.push({ fg, on, min: 'text', why });
    const ui = (fg, on, why) => out.push({ fg, on, min: UI, why });

    // Gövde yazısı ve ikincil yazılar her yüzeyde
    ['--text', '--muted', '--muted2', '--accent2', '--ok', '--warn',
      '--danger-text', '--ok-text', '--warn-text', '--accent-text', '--accent-label'].forEach((fg) => {
      SURFACES.forEach((s) => text(fg, s, 'yazı ' + fg + ' / ' + s));
    });
    text('--text', '--popover', 'arama sonuçları ve açılır menü');
    text('--muted2', '--popover', 'arama sonucu yolu');
    text('--text-strong', '--card3', 'seçili satır');
    // Örtülü zeminlerdeki durum yazıları (rozet, bildirim, bant)
    [['--accent-text', '--accent-rgb', 0.22], ['--accent-label', '--accent-rgb', 0.14],
      ['--ok-text', '--ok-rgb', 0.14], ['--warn-text', '--warn-rgb', 0.16],
      ['--danger-text', '--danger-rgb', 0.14], ['--danger-text', '--danger-rgb', 0.22],
      ['--ok', '--ok-rgb', 0.14], ['--text-strong', '--accent-rgb', 0.3],
      ['--text', '--sel-rgb', 0.22], ['--text', '--fg-rgb', 0.08]].forEach(([fg, rgb, a]) => {
      ['--bg2', '--card', '--card2'].forEach((base) => {
        out.push({ fg, on: { tint: rgb, alpha: a, base }, min: 'text', why: fg + ' / ' + rgb + ' ' + a + ' / ' + base });
      });
    });
    // Dolu düğmeler
    text('--on-accent', '--accent', 'birincil düğme');
    text('--on-accent', { mix: ['--accent', '--accent-grad'] }, 'birincil düğme, geçişin ortası');
    ui('--on-accent', '--accent-grad', 'birincil düğme, geçişin sonu');
    text('--on-solid', '--danger', 'tehlikeli düğme, sessiz bayrağı');
    text('--on-solid', '--lock', 'kilit bayrağı');
    text('--on-warn', '--warn', 'uyarı bandı düğmesi');
    text('--on-solo', '--solo', 'solo bayrağı');
    // Kod düzenleyicileri
    ['--code-fg', '--syn-kw', '--syn-type', '--syn-fn', '--syn-num', '--syn-com', '--syn-pre'].forEach((fg) => {
      text(fg, '--code-bg', 'kod ' + fg);
    });
    text('--muted2', '--code-gutter', 'satır numaraları');
    // Zaman çizelgesi cetvelindeki tempo etiketi
    ['--card', '--card2'].forEach((base) => {
      out.push({ fg: '--tempo', on: { tint: '--fg-rgb', alpha: 0.04, base }, min: 'text', why: 'tempo etiketi / ' + base });
    });
    // Marka yazısı
    text('--brand-ink', '--bg', 'yazı işareti');
    text('--brand-ink', '--bg2', 'yazı işareti');
    // Yazı olmayan ama anlam taşıyan
    SURFACES.forEach((s) => ui('--accent', s, 'odak halkası ve seçili kenar / ' + s));
    ui('--knob', '--accent', 'açık anahtarın topuzu');
    ui('--muted', '--card3', 'kapalı anahtarın topuzu');
    ui('--cue-live', '--card', 'çalan klip kenarı');
    ui('--cue-armed', '--card', 'sıradaki klip kenarı');
    return out;
  }

  // Yüksek karşıtlıkta çizgiler de görünmeli
  function aaaExtras() {
    return [
      { fg: '--line', on: '--card', min: UI, why: 'kart kenarı' },
      { fg: '--line2', on: '--card', min: TEXT, why: 'denetim kenarı' },
      { fg: '--line2', on: '--card3', min: UI, why: 'denetim kenarı / üstü' },
    ];
  }

  function background(theme, on) {
    if (typeof on === 'string') return T.solid(theme, on);
    if (on.mix) {
      const a = T.solid(theme, on.mix[0]);
      const b = T.solid(theme, on.mix[1]);
      return [0, 1, 2].map((i) => (a[i] + b[i]) / 2).concat(1);
    }
    return T.tint(theme, on.tint, on.alpha, on.base);
  }

  // Bir temanın bütün kurallarını ölçer; eşik altındakileri döndürür
  function check(theme) {
    const list = rules().concat(theme.aaa ? aaaExtras() : []);
    const fails = [];
    const measured = [];
    list.forEach((r) => {
      const bg = background(theme, r.on);
      const fg = T.solid(theme, r.fg, bg);
      const ratio = T.contrast(fg, bg);
      const min = r.min === 'text' ? (theme.aaa ? AAA : TEXT) : r.min;
      measured.push({ rule: r, ratio, min });
      if (!(ratio >= min)) fails.push({ theme: theme.id, why: r.why, fg: r.fg, ratio: Math.round(ratio * 100) / 100, min });
    });
    return { fails, measured };
  }

  const api = { SURFACES, TEXT, AAA, UI, rules, check };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (typeof window !== 'undefined') window.SVUiThemeContrast = api;
})();
