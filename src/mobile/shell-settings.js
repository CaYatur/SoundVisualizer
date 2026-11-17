/*
 * SoundVisualizer — CaYaDev Ses Görselleştirici
 * Copyright (c) 2026 Çağan Turgut (CaYatur) — CaYaDev, https://cayadev.com
 * https://github.com/CaYatur/SoundVisualizer
 * SPDX-License-Identifier: MIT
 */
'use strict';
/* AYARLAR SEKMESİ (docs/android/PLAN.md Faz 3.6; onaylı taslak 8).

   - Görünüm: tema (masaüstündeki temalar, `ui.theme`; "Cihaz varsayılanı" sistemi izler),
     dil (masaüstüyle aynı `sv-language` anahtarı; değişince sayfa yeniden yüklenir, ayar
     önce yazılır).
   - Performans: çizim ölçeği (`power.renderScale`), kare sınırı (`power.fpsCap`, 0 = ekran),
     pilde düşük güç (`power.lowPower` 'battery' / 'off').
   - Veri: bilgisayardan içe aktarma (.svbackup ya da settings.json; SVAndroid.importProfile)
     ve Hakkında. */
(function () {
  if (typeof window === 'undefined' || !window.SVShell || !window.SVShellUI) return;
  const S = window.SVShell;
  const U = window.SVShellUI;
  const { h, icon, A } = S;
  const en = () => !!(window.SVI18n && window.SVI18n.locale === 'en');
  const cfg = () => (A() && A().config.get()) || {};
  const env = window.__SV_ANDROID || {};

  function patchPower(p) {
    const c = cfg();
    A().config.patch({ power: Object.assign({}, c.power, p) });
  }

  // ---- Tema örnekleri: temanın kendi zemini ve vurgusu ----
  function swatch(choice, current) {
    const T = window.SVUiThemes;
    let style = '';
    if (choice.id === 'system') {
      const l = T.byId('light').tokens;
      const d = T.byId('dark').tokens;
      style = 'background:linear-gradient(135deg,' + l['--bg'] + ' 50%,' + d['--bg'] + ' 50%)';
    } else {
      const t = T.byId(choice.id).tokens;
      style = 'background:linear-gradient(135deg,' + t['--bg'] + ' 55%,' + t['--accent'] + ' 55%)';
    }
    const on = choice.id === current;
    return h('button', {
      class: 'sw' + (on ? ' on' : ''), 'aria-label': choice.name, title: choice.name, 'aria-pressed': on ? 'true' : 'false',
      onclick: () => A().config.patch({ ui: Object.assign({}, cfg().ui, { theme: choice.id }) }),
    }, [h('i', { style, 'aria-hidden': 'true' })]);
  }

  function langPref() {
    try { return localStorage.getItem('sv-language') || 'auto'; } catch (e) { return 'auto'; }
  }
  function setLang(v) {
    try { if (v === 'auto') localStorage.removeItem('sv-language'); else localStorage.setItem('sv-language', v); } catch (e) { return; }
    // Bekleyen ayar önce diske; sonra sayfa yeni dille açılır (motor aynı ayarla döner)
    Promise.resolve(A().config.flush()).then(() => location.reload(), () => location.reload());
  }

  function navRow(name, title, sub, onclick) {
    return h('button', { class: 'ctl-row nav-row', onclick }, [
      icon(name),
      h('div', { class: 'row-text' }, [h('div', { class: 'row-title small', text: title }), h('div', { class: 'row-sub', text: sub })]),
      icon('chevron-right'),
    ]);
  }

  // ---- İçe aktarma ----
  let importing = false;
  let importResult = null;
  function startImport(ctx) {
    if (importing) return;
    importing = true;
    importResult = null;
    ctx.refresh();
    A().importProfile({}).then((r) => { importResult = { ok: true, r }; }, (e) => { importResult = { ok: false, code: String((e && e.message) || e) }; })
      .then(() => { importing = false; ctx.refresh(); });
  }
  const IMPORT_ERRORS = {
    NOT_BACKUP: 'Bu dosya SoundVisualizer yedeği değil.',
    FORMAT: 'Yedek daha yeni bir sürümden; uygulamayı güncelleyin.',
    NOT_SETTINGS: 'Bu dosya bir ayar dosyası değil.',
    cancelled: 'Dosya seçilmedi.',
  };
  function importStatus() {
    if (importing) return h('div', { class: 'banner info', role: 'status' }, [icon('download'), h('div', { class: 'grow-text', text: 'İçe aktarılıyor… Büyük kitaplıklarda bir dakika sürebilir.' })]);
    if (!importResult) return null;
    if (!importResult.ok) {
      const t = IMPORT_ERRORS[importResult.code] || ((en() ? 'Import failed: ' : 'İçe aktarılamadı: ') + importResult.code);
      return h('div', { class: 'banner', role: 'alert' }, [icon('warning'), h('div', { class: 'grow-text', text: t })]);
    }
    const r = importResult.r || {};
    const lines = en()
      ? [(r.scenes || 0) + ' scenes', (r.presets || 0) + ' presets'].concat(r.skipped ? [r.skipped + ' skipped'] : [])
      : [(r.scenes || 0) + ' sahne', (r.presets || 0) + ' preset'].concat(r.skipped ? [r.skipped + ' atlandı'] : []);
    const later = r.later && Object.values(r.later).some((n) => n > 0);
    return h('div', { class: 'banner info ok', role: 'status' }, [icon('check-circle'), h('div', { class: 'grow-text' }, [
      h('b', { text: 'İçe aktarıldı.' }), ' ' + lines.join(' · '),
      later ? h('div', { class: 'row-sub', text: 'Videolar, logolar ve şarkı sözleri kitaplıkla birlikte gelecek (Faz 4).' }) : null,
    ])]);
  }

  // ---- Hakkında ----
  const aboutPage = {
    size: 'screen',
    title: 'Hakkında',
    render(body) {
      body.appendChild(h('div', { class: 'about-head' }, [
        h('img', { class: 'logo lg', src: '../../assets/logo-256.png', alt: '' }),
        h('div', { class: 'row-text' }, [
          h('div', { class: 'row-title', text: 'SoundVisualizer' }),
          h('div', { class: 'row-sub' }, [h('span', { text: 'Sürüm' }), ' ' + (env.version || '?')]),
          h('div', { class: 'row-sub' }, ['WebView ' + (env.webview || '?')]),
        ]),
      ]));
      body.appendChild(U.card([
        h('div', { class: 'hint', text: 'CaYaDev Ses Görselleştirici. Kaynak kodu MIT lisansıyla açık: github.com/CaYatur/SoundVisualizer' }),
      ]));
      body.appendChild(h('div', { class: 'section-label', text: 'Lisanslar' }));
      const LIC = [
        ['AndroidX, Media3', 'Apache License 2.0'],
        ['Geist, Geist Mono', 'SIL Open Font License 1.1'],
        ['MilkDrop preset paketi', 'Her presetin yazarı ve lisansı kitaplıkta'],
      ];
      body.appendChild(U.card(LIC.map(([n, l]) => h('div', { class: 'ctl-row' }, [h('div', { class: 'row-text' }, [h('div', { class: 'row-title small', text: n }), h('div', { class: 'row-sub', text: l })])]))));
    },
  };

  const page = {
    size: 'screen',
    title: 'Ayarlar',
    lead(slot) { slot.appendChild(h('img', { class: 'logo', src: '../../assets/logo-256.png', alt: '' })); },
    render(body, ctx) {
      const T = window.SVUiThemes;
      const c = cfg();
      const power = Object.assign({ renderScale: 1, fpsCap: 0, lowPower: 'off' }, c.power);
      const current = T ? T.normalizeId(c.ui && c.ui.theme) : 'cayadev';
      body.appendChild(h('div', { class: 'section-label', text: 'Görünüm' }));
      body.appendChild(U.card([
        h('div', { class: 'ctl-row col' }, [
          h('div', { class: 'ctl-label', text: 'Tema' }),
          h('div', { class: 'swatches', role: 'group', 'aria-label': 'Tema' }, (T ? T.CHOICES : []).map((ch) => swatch(ch, current))),
        ]),
        h('div', { class: 'divider flush' }),
        U.seg({ label: 'Dil', options: [['auto', 'Cihaz'], ['tr', 'Türkçe\u200B'], ['en', 'English']], value: langPref(), onChange: setLang }),
      ]));
      body.appendChild(h('div', { class: 'section-label', text: 'Performans' }));
      const cap = power.fpsCap === 30 ? '30' : power.fpsCap === 60 ? '60' : '0';
      body.appendChild(U.card([
        U.slider({ label: 'Çizim ölçeği', min: 0.5, max: 1, step: 0.05, percent: true, value: power.renderScale || 1, onChange: (v) => patchPower({ renderScale: v }) }),
        U.seg({ label: 'Kare sınırı', options: [['30', '30'], ['60', '60'], ['0', 'Ekran']], value: cap, onChange: (v) => patchPower({ fpsCap: +v }) }),
        h('div', { class: 'ctl-row' }, [
          h('div', { class: 'row-text' }, [h('div', { class: 'row-title small', text: 'Pilde düşük güç' }), h('div', { class: 'row-sub', text: 'Şarj olmazken ölçek ve kare hızı düşer' })]),
          h('button', {
            class: 'toggle', role: 'switch', 'aria-label': 'Pilde düşük güç', 'aria-checked': power.lowPower === 'battery' || power.lowPower === 'on' ? 'true' : 'false',
            onclick: (e) => {
              const on = e.currentTarget.getAttribute('aria-checked') !== 'true';
              e.currentTarget.setAttribute('aria-checked', on ? 'true' : 'false');
              patchPower({ lowPower: on ? 'battery' : 'off' });
            },
          }),
        ]),
      ]));
      body.appendChild(h('div', { class: 'section-label', text: 'Veri' }));
      body.appendChild(h('div', { class: 'card nav-card' }, [
        navRow('upload', 'Bilgisayardan içe aktar', '.svbackup ya da settings.json', () => startImport(ctx)),
        h('div', { class: 'divider flush' }),
        navRow('info', 'Hakkında ve lisanslar', (en() ? 'Version ' : 'Sürüm ') + (env.version || '?'), () => ctx.push(aboutPage)),
      ]));
      const st = importStatus();
      if (st) body.appendChild(st);
    },
    onConfig(ctx) { ctx.refresh(); },
  };

  S.tab('settings', page);
  window.SVShellSettings = Object.freeze({ startImport, importStatus });
})();
