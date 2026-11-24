/*
 * SoundVisualizer — CaYaDev Ses Görselleştirici
 * Copyright (c) 2026 Çağan Turgut (CaYatur) — CaYaDev, https://cayadev.com
 * https://github.com/CaYatur/SoundVisualizer
 * SPDX-License-Identifier: MIT
 */
'use strict';
/* YEDEK AL VE GERİ YÜKLE (Ayarlar → Veri). Bölümler tek tek seçilir (src/shared/backup-sections.js).
   Arşiv masaüstünün tam yedeğiyle aynı biçimde: telefon da bilgisayar da açar. */
(function () {
  if (typeof window === 'undefined' || !window.SVShell || !window.SVShellUI) return;
  const S = window.SVShell;
  const U = window.SVShellUI;
  const { h, icon, A } = S;
  const tr = (s) => (window.SVI18n && window.SVI18n.t ? window.SVI18n.t(s) : s);
  const en = () => !!(window.SVI18n && window.SVI18n.locale === 'en');

  const INFO = {
    settings: ['gear', 'Uygulama ayarları', 'Tema, dil, ses ve performans'],
    scenes: ['image', 'Sahneler ve katmanlar', 'Kayıtlı sahneler ve şu anki görünüm'],
    colors: ['sparkles', 'Renk şablonları', 'Kendi kaydettiğiniz renkler'],
    timeline: ['timeline', 'Zaman çizelgeleri', 'Klipler, işaretler ve otomasyon'],
    presets: ['drop', 'Presetler', 'MilkDrop ve Studio presetleriniz'],
    logos: ['image', 'Logolar', 'Logo kitaplığı'],
    lyrics: ['text', 'Şarkı sözleri', 'Söz kitaplığı'],
    videos: ['video', 'Videolar', 'Sahnelerdeki videolar; yedek büyüyebilir'],
    textures: ['image', 'MilkDrop dokuları', 'Presetlerin kullandığı görseller'],
  };
  const ORDER = window.SVBackupSections.SECTIONS;

  function sizeText(bytes) {
    const n = Number(bytes) || 0;
    if (n >= 1073741824) return U.num(n / 1073741824, 1) + ' GB';
    if (n >= 1048576) return U.num(n / 1048576, 1) + ' MB';
    if (n >= 1024) return Math.round(n / 1024) + ' KB';
    return n ? n + ' B' : '';
  }

  /* Bölüm satırı: simge, ad, açıklama ve anahtar. */
  function row(id, on, sub, onChange) {
    const [ic, title] = INFO[id];
    const sw = h('button', {
      class: 'toggle', role: 'switch', 'aria-label': title, 'aria-checked': on ? 'true' : 'false', 'data-section': id,
      onclick: () => { const v = sw.getAttribute('aria-checked') !== 'true'; sw.setAttribute('aria-checked', v ? 'true' : 'false'); onChange(v); },
    });
    return h('div', { class: 'ctl-row' }, [icon(ic), h('div', { class: 'row-text' }, [h('div', { class: 'row-title small', text: title }), h('div', { class: 'row-sub', text: sub })]), sw]);
  }
  function allNone(ids, chosen, ctx) {
    return h('div', { class: 'btn-row' }, [
      h('button', { class: 'btn', onclick: () => { ids.forEach((k) => chosen.add(k)); ctx.refresh(); } }, [icon('check'), h('span', { text: 'Tümünü Seç' })]),
      h('button', { class: 'btn ghost', onclick: () => { chosen.clear(); ctx.refresh(); } }, [h('span', { text: 'Hiçbirini Seçme' })]),
    ]);
  }

  // ---- Sonuç şeridi (Ayarlar sayfasında) ----
  let notice = null;
  function status() {
    if (!notice) return null;
    return h('div', { class: 'banner info' + (notice.ok ? ' ok' : ''), role: 'status' }, [icon(notice.ok ? 'check-circle' : 'warning'), h('div', { class: 'grow-text', 'data-user-text': '', text: notice.text })]);
  }
  const count = (n, one, en1) => n + ' ' + (en() ? en1 : one);
  function resultLine(r) {
    const c = r || {};
    return [
      c.scenes ? count(c.scenes, 'sahne', 'scenes') : '', c.presets ? count(c.presets, 'preset', 'presets') : '',
      c.logos ? count(c.logos, 'logo', 'logos') : '', c.lyrics ? count(c.lyrics, 'söz', 'lyrics') : '',
      c.videos ? count(c.videos, 'video', 'videos') : '', c.textures ? count(c.textures, 'doku', 'textures') : '',
      c.skipped ? count(c.skipped, 'atlandı', 'skipped') : '',
    ].filter(Boolean).join(' · ');
  }

  // ---- Yedek al ----
  function exportPage() {
    const chosen = new Set(ORDER.filter((k) => k !== 'videos'));
    let plan = null;
    let busy = false;
    let progress = null;
    let error = '';
    let off = null;
    return {
      size: 'full',
      title: 'Yedek Al',
      onLeave() { if (off) off(); off = null; },
      render(body, ctx) {
        if (!plan) A().backup.plan().then((p) => { plan = p || {}; if (body.isConnected) ctx.refresh(); }, () => { plan = {}; });
        const sub = (id) => {
          const p = plan && plan[id];
          if (!p) return tr(INFO[id][2]);
          return p.count ? p.count + ' · ' + sizeText(p.bytes) : tr('Boş');
        };
        body.appendChild(h('div', { class: 'hint', text: 'Yedeğe girecek bölümleri seçin. Dosyayı telefonda ya da bilgisayarda geri yükleyebilirsiniz.' }));
        body.appendChild(allNone(ORDER, chosen, ctx));
        body.appendChild(h('div', { class: 'card nav-card' }, ORDER.map((id) => row(id, chosen.has(id), sub(id), (v) => { if (v) chosen.add(id); else chosen.delete(id); ctx.refresh(); }))));
        const partial = ['settings', 'scenes', 'colors', 'timeline'].some((k) => !chosen.has(k));
        if (partial && chosen.size) body.appendChild(h('div', { class: 'banner info' }, [icon('info'), h('div', { class: 'grow-text', text: 'Bilgisayar bir yedeği geri yüklerken bütün ayarlarını yedektekiyle değiştirir. Bilgisayarda kullanacaksanız ayar bölümlerinin hepsini seçin.' })]));
        if (progress) {
          const pct = progress.total > 0 ? Math.min(100, Math.round(progress.done / progress.total * 100)) : 0;
          body.appendChild(h('div', { class: 'card ctl', role: 'status' }, [
            h('div', { class: 'row-title small', text: 'Yedek yazılıyor…' }),
            h('div', { class: 'opbar export-bar', 'aria-hidden': 'true' }, [h('b', { style: 'width:' + pct + '%' })]),
            h('div', { class: 'row-sub', text: '%' + pct + ' · ' + sizeText(progress.done) + ' / ' + sizeText(progress.total) }),
          ]));
        }
        if (error) body.appendChild(h('div', { class: 'banner', role: 'alert' }, [icon('warning'), h('div', { class: 'grow-text', text: tr('Yedek alınamadı.') + ' (' + error + ')' })]));
        ctx.foot.appendChild(h('button', {
          class: 'btn primary block', disabled: busy || !chosen.size ? true : null,
          onclick: () => {
            busy = true; error = ''; progress = null;
            ctx.refresh();
            off = A().backup.onProgress((p) => { progress = p; if (body.isConnected || ctx.top) ctx.refresh(); });
            A().backup.exportTo(Array.from(chosen)).then((r) => {
              notice = { ok: true, text: tr('Yedek kaydedildi.') + ' ' + (r.name || '') + (resultLine(r) ? ' · ' + resultLine(r) : '') };
              busy = false;
              ctx.pop();
            }, (e) => {
              busy = false; progress = null;
              const code = String((e && e.message) || e);
              if (code !== 'cancelled') error = code;
              ctx.refresh();
            }).then(() => { if (off) off(); off = null; });
          },
        }, [icon('save'), h('span', { text: busy ? 'Yazılıyor…' : 'Yedeği Kaydet' })]));
      },
    };
  }

  // ---- Geri yükle ----
  const ERRORS = {
    NOT_BACKUP: 'Bu dosya SoundVisualizer yedeği değil.',
    FORMAT: 'Yedek daha yeni bir sürümden; uygulamayı güncelleyin.',
    NOT_SETTINGS: 'Bu dosya bir ayar dosyası değil.',
  };
  function restorePage(info) {
    const ids = ORDER.filter((k) => info.available[k]);
    const chosen = new Set(ids);
    let busy = false;
    let error = '';
    let done = false;
    return {
      size: 'full',
      title: 'Yedekten Geri Yükle',
      onLeave() { if (!done && !busy) A().backup.discard(); },
      render(body, ctx) {
        const s = info.summary || {};
        const from = s.platform === 'android' ? 'Telefon yedeği' : (info.kind === 'svbackup' ? 'Bilgisayar yedeği' : 'Ayar dosyası');
        const when = s.createdAt ? new Date(s.createdAt).toLocaleDateString(en() ? 'en' : 'tr') : '';
        body.appendChild(h('div', { class: 'card scene-head' }, [icon('download'), h('div', { class: 'row-text' }, [
          h('div', { class: 'row-title', text: from }), when ? h('div', { class: 'row-sub', 'data-user-text': '', text: when + (s.appVersion ? ' · ' + s.appVersion : '') }) : null,
        ])]));
        body.appendChild(h('div', { class: 'hint', text: 'Seçtiğiniz bölümler yedektekiyle değişir; seçmedikleriniz olduğu gibi kalır. Yedekte olmayan sahne dışı dosyalar silinmez.' }));
        body.appendChild(allNone(ids, chosen, ctx));
        body.appendChild(h('div', { class: 'card nav-card' }, ids.map((id) => {
          const n = info.available[id];
          return row(id, chosen.has(id), n > 1 ? String(n) : tr(INFO[id][2]), (v) => { if (v) chosen.add(id); else chosen.delete(id); ctx.refresh(); });
        })));
        if (error) body.appendChild(h('div', { class: 'banner', role: 'alert' }, [icon('warning'), h('div', { class: 'grow-text', text: tr('Geri yüklenemedi.') + ' (' + error + ')' })]));
        ctx.foot.appendChild(h('button', {
          class: 'btn primary block', disabled: busy || !chosen.size ? true : null,
          onclick: () => {
            busy = true; error = '';
            ctx.refresh();
            A().backup.apply(Array.from(chosen)).then((r) => {
              done = true;
              const lb = r.libraries || {};
              notice = { ok: true, text: tr('Geri yüklendi.') + ' ' + resultLine({ scenes: chosen.has('scenes') ? r.scenes : 0, presets: r.presets, textures: r.textures, skipped: r.skipped, logos: lb.logos, lyrics: lb.lyrics, videos: lb.videos }) };
              busy = false;
              ctx.pop();
            }, (e) => { busy = false; error = String((e && e.message) || e); ctx.refresh(); });
          },
        }, [icon('download'), h('span', { text: busy ? 'Geri yükleniyor…' : 'Geri Yükle' })]));
      },
    };
  }

  let opening = false;
  function openRestore(ctx) {
    if (opening) return;
    opening = true;
    notice = { ok: true, text: tr('Yedek okunuyor… Büyük yedeklerde bir dakika sürebilir.') };
    ctx.refresh();
    A().backup.open().then((info) => {
      notice = null;
      if (!Object.keys(info.available).length) { notice = { ok: false, text: tr('Bu yedekte geri yüklenecek bir şey yok.') }; ctx.refresh(); return; }
      ctx.push(restorePage(info));
    }, (e) => {
      const code = String((e && e.message) || e);
      notice = code === 'cancelled' ? null : { ok: false, text: tr(ERRORS[code] || 'Yedek açılamadı.') + (ERRORS[code] ? '' : ' (' + code + ')') };
      ctx.refresh();
    }).then(() => { opening = false; });
  }

  window.SVShellBackup = Object.freeze({ exportPage, openRestore, status });
})();
