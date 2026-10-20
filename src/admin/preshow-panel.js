/*
 * SoundVisualizer — CaYaDev Ses Görselleştirici
 * Copyright (c) 2026 Çağan Turgut (CaYatur) — CaYaDev, https://cayadev.com
 * https://github.com/CaYatur/SoundVisualizer
 * SPDX-License-Identifier: MIT
 */
'use strict';
/* GÖSTERİ ÖNCESİ DENETİM paneli (#545). Denetim ana süreçte
   (main/preshow.js); burada sonuç. Panel görünürken 3 sn'de bir yenilenir.
   Kapılar açılmadan bakılır, bir şey bozulduktan sonra değil.

   Ayrıntısı olan satır (çıkışlar, eksik dosyalar, yenileme sınırı)
   tıklanınca açılır: hangi ekran, hangi sahne ve katman, dosyanın yolu ve
   düzeltme. Düzeltmeler ayara yazar; her biri önce onay ister. Başvuruların
   yeri ve değiştirilmesi shared/preshow-refs.js'te (denetimle aynı alanlar). */
(function () {
  const P = () => window.SVPanel;
  const Refs = () => window.SVPreshowRefs;
  const tr = (s) => (window.SVI18n && window.SVI18n.t ? window.SVI18n.t(s) : s);
  let last = null;
  let busy = false;
  let timer = null;
  const open = new Set(); // açık ayrıntı satırları (denetim kimliği)

  const ICON = { ok: 'check', warn: 'warning', fail: 'x', info: 'info' };
  const OVERALL = { ok: 'Düzen hazır', warn: 'Düzen hazır, uyarılar var', fail: 'Düzen hazır değil' };
  const KIND = { preset: 'Preset', logo: 'Logo', media: 'Video dosyası' };
  const FIELD = {
    'custom.visualizerId': 'Studio görselleştiricisi',
    'custom.backgroundId': 'Studio arkaplanı',
    presetId: 'Katmanın preseti',
    'logo.libraryId': 'Logo',
    'settings.logo.libraryId': 'Logo',
    'logo.swap': 'Logo değişim listesi',
    'settings.logo.swap': 'Logo değişim listesi',
    'media.file': 'Video',
    'settings.media.file': 'Video',
  };
  const REASON = {
    'preset:unreadable': 'Dosya diskte var ama okunamıyor: içeriği bozuk ya da geçerli JSON değil.',
    'preset:absent': 'Preset bu bilgisayarda yok: silinmiş ya da başka bir bilgisayardan gelen sahnede kalmış.',
    'logo:absent': 'Logo kitaplıkta yok: silinmiş ya da başka bir bilgisayardan gelen sahnede kalmış.',
    'media:absent': 'Video dosyası bu yolda yok: taşınmış, silinmiş ya da başka bir diskte.',
  };
  const FIX = {
    'preset:unreadable': 'Dosyayı düzeltin ya da yerine yenisini kaydedin. Başvuruyu kaldırırsanız katman boş kalır.',
    'preset:absent': 'Preseti içe aktarın ya da Studio\'da yeniden kaydedin. Başvuruyu kaldırırsanız katman boş kalır.',
    'logo:absent': 'Logoyu kitaplığa yeniden ekleyip sahnede seçin ya da başvuruyu kaldırın.',
    'media:absent': 'Dosya taşındıysa yeni yerini gösterin; bütün başvurular ona çevrilir.',
  };

  async function run() {
    if (busy || !window.api || !window.api.preshowCheck) return;
    busy = true;
    try {
      const r = await window.api.preshowCheck();
      const changed = JSON.stringify(r) !== JSON.stringify(last);
      last = r;
      if (changed && document.querySelector('.preshow-panel')) P().rerender();
    } catch { /* ana süreç yanıt vermedi */ } finally { busy = false; }
  }

  function ensureTimer() {
    if (timer) return;
    timer = setInterval(() => {
      if (!document.querySelector('.preshow-panel')) { clearInterval(timer); timer = null; return; }
      run();
    }, 3000);
  }

  const sep = () => P().el('span', { class: 'st-sep', 'aria-hidden': 'true', text: ' · ' });
  const user = (t) => P().el('span', { class: 'st-num', text: String(t), 'data-user-text': '' });

  // "Kayıtlı sahne «Test 2» · Katman 2 · Bakir Halkalar · Katmanın preseti"
  function whereRow(w) {
    const el = P().el;
    const li = el('li', { class: 'preshow-where' });
    if (w.scene) {
      li.appendChild(el('span', { text: 'Kayıtlı sahne' }));
      li.appendChild(el('span', { text: ' «' }));
      li.appendChild(user(w.scene.name || String(w.scene.index + 1)));
      li.appendChild(el('span', { text: '»' }));
    } else {
      li.appendChild(el('span', { class: 'preshow-live', text: 'Canlı sahne' }));
    }
    if (w.layer) {
      li.appendChild(sep());
      li.appendChild(el('span', { text: 'Katman' }));
      li.appendChild(user(' ' + (w.layer.index + 1)));
      if (w.layer.name) { li.appendChild(sep()); li.appendChild(user(w.layer.name)); }
    }
    if (FIELD[w.field]) { li.appendChild(sep()); li.appendChild(el('span', { class: 'dim-hint', text: FIELD[w.field] })); }
    return li;
  }

  async function confirmed(text, okText) {
    return P().confirm(text, { okText: tr(okText) });
  }

  // Değişiklik canlı ayara ve kayıtlı sahnelere yazılır, sonra yeniden denetlenir
  function applyReplace(item, to) {
    const n = Refs().replace(P().cfg(), item.kind, item.id, to);
    if (n) { P().apply(); setTimeout(run, 300); }
    return n;
  }

  async function locate(item) {
    const r = await window.api.pickVideo();
    if (!r) return;
    const ok = await confirmed(tr('Bu videonun bütün başvuruları seçilen dosyaya çevrilecek:') + '\n\n' + (item.name || item.id) + '\n→ ' + r.name +
      '\n\n' + item.where.length + ' ' + tr('yer'), 'Çevir');
    if (!ok) return;
    const n = applyReplace(item, r.url);
    P().toast(n ? tr('Başvurular güncellendi.') : tr('Değişecek başvuru bulunamadı.'), n ? 'ok' : 'warn');
  }

  async function drop(item) {
    const ok = await confirmed(tr('Bu başvuru bütün sahnelerden kaldırılacak:') + '\n\n' + (KIND[item.kind] ? tr(KIND[item.kind]) + ': ' : '') + (item.name || item.id) +
      '\n\n' + item.where.length + ' ' + tr('yer'), 'Kaldır');
    if (!ok) return;
    const n = applyReplace(item, null);
    P().toast(n ? tr('Başvuru kaldırıldı.') : tr('Değişecek başvuru bulunamadı.'), n ? 'ok' : 'warn');
  }

  function fileItem(item) {
    const el = P().el;
    const key = item.kind + ':' + (item.reason || 'absent');
    const box = el('div', { class: 'preshow-item' });
    box.appendChild(el('div', { class: 'preshow-item-head' }, [
      el('span', { class: 'preshow-kind', text: KIND[item.kind] || item.kind }),
      sep(),
      el('span', { class: 'preshow-name', text: item.name || item.id, 'data-user-text': '' }),
    ]));
    if (REASON[key]) box.appendChild(el('div', { class: 'preshow-reason', text: REASON[key] }));
    if (item.path) box.appendChild(el('div', { class: 'preshow-path', text: item.path, 'data-user-text': '', title: item.path }));
    const wl = el('ul', { class: 'preshow-wheres' });
    item.where.slice(0, 6).forEach((w) => wl.appendChild(whereRow(w)));
    if (item.where.length > 6) wl.appendChild(el('li', { class: 'preshow-where dim-hint', text: '+' + (item.where.length - 6) }));
    box.appendChild(wl);
    if (FIX[key]) box.appendChild(el('div', { class: 'preshow-fix dim-hint', text: FIX[key] }));
    const acts = el('div', { class: 'preshow-actions' });
    if (item.kind === 'media') {
      acts.appendChild(el('button', { class: 'btn small primary', type: 'button', icon: 'search', text: 'Dosyayı Bul…', onclick: () => locate(item) }));
    }
    // Yalnız var olan dosya/klasör (ana süreç `reveal`'ı yalnız öyleyse verir)
    if (item.reveal && window.api.preshowReveal) {
      acts.appendChild(el('button', {
        class: 'btn small', type: 'button', icon: 'folder-open', text: item.revealFile ? 'Klasörde Göster' : 'Klasörü Aç',
        onclick: () => window.api.preshowReveal(item.reveal),
      }));
    }
    acts.appendChild(el('button', { class: 'btn small ghost', type: 'button', icon: 'trash', text: 'Başvuruyu Kaldır', onclick: () => drop(item) }));
    box.appendChild(acts);
    return box;
  }

  function outputItem(it) {
    const el = P().el;
    const STATE = { measuring: 'ölçülüyor', paused: 'sessizlikte duraklatıldı', stale: 'çizmiyor' };
    const row = el('div', { class: 'preshow-out ' + it.state }, [
      el('span', { class: 'preshow-icon', icon: ICON[it.state] || 'info', 'aria-hidden': 'true' }),
      user(it.label),
    ]);
    if (it.hz) { row.appendChild(sep()); row.appendChild(user(it.hz + ' Hz')); }
    row.appendChild(sep());
    const st = it.stale ? 'stale' : it.measuring ? 'measuring' : it.paused ? 'paused' : '';
    if (st) row.appendChild(el('span', { class: 'dim-hint', text: STATE[st] }));
    else row.appendChild(user(it.fps + ' / ' + it.target + ' fps'));
    return row;
  }

  function detail(c) {
    const el = P().el;
    const box = el('div', { class: 'preshow-detail', id: 'preshow-detail-' + c.id });
    if (c.id === 'files') (c.items || []).forEach((it) => box.appendChild(fileItem(it)));
    else if (c.id === 'outputs') (c.items || []).forEach((it) => box.appendChild(outputItem(it)));
    if (c.hint) box.appendChild(el('div', { class: 'preshow-fix dim-hint', text: c.hint }));
    return box;
  }

  function panel() {
    const el = P().el;
    ensureTimer();
    if (!last) run();
    const nodes = [];
    if (last) {
      nodes.push(el('div', { class: 'studio-status ' + (last.overall === 'ok' ? 'ok' : last.overall === 'fail' ? 'err' : ''), role: 'status' }, [
        el('span', { icon: ICON[last.overall] || 'info' }),
        el('span', { text: OVERALL[last.overall] || OVERALL.ok }),
      ]));
      const list = el('ul', { class: 'preshow-list' });
      last.checks.forEach((c) => {
        const more = !!((c.items && c.items.length) || c.hint);
        const isOpen = more && open.has(c.id);
        const row = el('li', { class: 'preshow-row ' + c.state + (more ? ' has-more' : '') }, [
          el('span', { class: 'preshow-icon', icon: ICON[c.state] || 'info', 'aria-hidden': 'true' }),
          el('span', { class: 'preshow-text', text: c.text }),
        ]);
        (c.parts || []).forEach((p) => { row.appendChild(sep()); row.appendChild(user(p)); });
        if (more) {
          const toggle = () => { if (open.has(c.id)) open.delete(c.id); else open.add(c.id); P().rerender(); };
          row.appendChild(el('button', {
            class: 'icon-btn small preshow-more', type: 'button', icon: isOpen ? 'chevron-up' : 'chevron-down',
            title: tr(isOpen ? 'Ayrıntıları Gizle' : 'Ayrıntılar'), 'aria-expanded': isOpen ? 'true' : 'false',
            'aria-controls': 'preshow-detail-' + c.id, onclick: (e) => { e.stopPropagation(); toggle(); },
          }));
          row.addEventListener('click', toggle);
        }
        list.appendChild(row);
        if (isOpen) list.appendChild(el('li', { class: 'preshow-detail-row' }, [detail(c)]));
      });
      nodes.push(list);
    } else {
      nodes.push(el('div', { class: 'studio-note dim-hint', text: 'Denetleniyor…' }));
    }
    nodes.push(el('div', { class: 'lay-file' }, [
      el('button', { class: 'btn small', type: 'button', icon: 'refresh', text: 'Şimdi Denetle', onclick: () => run() }),
    ]));
    nodes.push(el('div', { class: 'studio-note dim-hint', text: 'Ekranlar, ses, çıkışların kare hızı, sahnenin dosyaları, yedek ve disk. Kare hızı ekran kartının payını gösterir: çıkış ekranın yenileme hızını (kare sınırı varsa onu) tutmuyorsa kart yetişmiyordur. Ayrıntısı olan satıra tıklayın.' }));
    return el('div', { class: 'preshow-panel' }, nodes);
  }

  window.SVPreshowPanel = { panel, run };
})();
