/*
 * SoundVisualizer — CaYaDev Ses Görselleştirici
 * Copyright (c) 2026 Çağan Turgut (CaYatur) — CaYaDev, https://cayadev.com
 * https://github.com/CaYatur/SoundVisualizer
 * SPDX-License-Identifier: MIT
 */
'use strict';
/* PC AYARLARI (PC bağlantısı B6; PLAN §4.8–4.9, taslak 20–21). Hedef menüsünden açılır; tam
   erişim ister (bilgisayar düzeyi denetler, burada yalnız yanıtı söyleriz).

   Çıkışlar (ekranlar, yüzen pencere), bilgisayarın ses girişi, kayıt, dışa aktarma (şarkı
   telefondan gönderilir, video bilgisayarın Videolar klasörüne), MilkDrop kitaplığında arama,
   telefondan dosya gönderme (video, logo, söz, preset; uygulama gönderir, sayfa kapansa da sürer),
   ışık ve güç, sahne aktarma (telefona kopyala / PC'ye gönder). Hiçbir yerde yol yazılmaz:
   bilgisayar kimlik ve kendi klasörleriyle çalışır (docs/PHONE-LINK.md "Operations", "Files"). */
(function () {
  if (typeof window === 'undefined' || !window.SVShell || !window.SVShellUI) return;
  const S = window.SVShell;
  const U = window.SVShellUI;
  const { h, icon, A } = S;
  const tr = (s) => (window.SVI18n && window.SVI18n.t ? window.SVI18n.t(s) : s);
  const ask = (op, args) => A().pc.request(op, args);
  const cfg = () => A().config.get() || {};

  const KINDS = [['video', 'Video'], ['logo', 'Logo'], ['lyrics', 'Söz'], ['milk', 'MilkDrop preseti']];
  const uploads = new Map(); // anahtar → son ilerleme
  let exportP = null;
  let song = null; // { id, name } gönderilmiş şarkı
  let outputs = null;
  let devices = null;
  let outputTimer = 0;
  let outputSig = '';
  let outputHold = 0;
  let wired = false;
  let page = null;

  function mb(n) { return (Math.round((Number(n) || 0) / 1048576 * 10) / 10).toLocaleString(window.SVI18n && window.SVI18n.locale === 'en' ? 'en' : 'tr') + ' MB'; }
  function refresh() { const top = S.state().sheet ? page : null; if (top && page.ctx) page.ctx.refresh(); }

  function wire() {
    if (wired) return;
    wired = true;
    A().pc.onUpload((u) => {
      if (!u || !u.key) return;
      uploads.set(u.key, u);
      if (u.state === 'done' && u.kind === 'audio' && u.result && u.result.id) song = { id: u.result.id, name: u.name };
      if (u.state === 'done' && u.kind !== 'audio') S.toast(tr('PC\'ye gönderildi') + ': ' + u.name);
      if (u.state === 'error') S.toast(tr('Gönderilemedi') + ': ' + u.name + ' (' + u.error + ')');
      refresh();
    });
    A().pc.onExport((p) => { exportP = p; refresh(); });
  }

  async function send(kind) {
    let f;
    try { f = await A().pc.pick(kind); } catch (e) { return; }
    if (!f || !f.uri) return;
    await A().pc.upload(f, kind);
  }

  function uploadRows(body) {
    const live = Array.from(uploads.values()).filter((u) => u.state === 'begin' || u.state === 'sending');
    for (const u of live) {
      const pct = u.size ? Math.round((u.sent / u.size) * 100) : 0;
      body.appendChild(h('div', { class: 'card export-card' }, [
        h('div', { class: 'export-head' }, [h('span', { class: 'grow-text', text: tr('Gönderiliyor') + ': ' + u.name }), h('span', { class: 'export-pct mono', text: pct + '%' })]),
        h('div', { class: 'export-bar' }, [h('i', { style: 'width:' + pct + '%' })]),
        h('div', { class: 'hint', text: mb(u.sent) + ' / ' + mb(u.size) }),
        h('button', { class: 'btn', onclick: () => A().pc.cancelUpload(u.key) }, [icon('x'), h('span', { text: 'İptal' })]),
      ]));
    }
  }

  function render(body, ctx) {
    wire();
    page.ctx = ctx;
    const st = A().target.get();
    if (st.target !== 'pc') { body.appendChild(h('div', { class: 'hint', text: 'Önce hedef olarak PC\'yi seçin.' })); return; }
    if (st.level && st.level !== 'full') body.appendChild(h('div', { class: 'banner info' }, [icon('info'), h('div', { text: 'Bu sayfadaki işler bilgisayarda tam erişim ister. Erişim düzeyi bilgisayardaki Telefon Bağlantısı kartından değiştirilir.' })]));
    const c = cfg();

    // ---- Çıkışlar. Açık pencereler ve PC'deki ekran seçimi birlikte güncellenir;
    // yalnız bir kimlik yollamak diğer ekranları kapatıyordu ve seçim PC'de eski kalıyordu.
    body.appendChild(h('div', { class: 'section-label', text: 'Çıkışlar' }));
    if (!outputTimer) outputTimer = setInterval(() => {
      if (Date.now() < outputHold || S.state().sheet !== page) return;
      ask('output.list').then((r) => {
        if (!r || !r.ok || !r.result || Date.now() < outputHold) return;
        const sig = JSON.stringify([r.result.open, r.result.selected, r.result.floating]);
        if (sig === outputSig) return;
        outputSig = sig;
        outputs = r.result;
        if (page.ctx) page.ctx.refresh();
      });
    }, 1500);
    if (!outputs) ask('output.list').then((r) => { outputs = r && r.ok ? r.result : { displays: [], open: [], floating: false, selected: [] }; ctx.refresh(); });
    else {
      const open = [];
      for (const x of outputs.open || []) { const n = Number(x); if (Number.isFinite(n) && open.indexOf(n) < 0) open.push(n); }
      const card = [];
      for (const d of outputs.displays) {
        const id = Number(d.id);
        card.push(U.toggle({
          label: d.label + (d.width ? ' · ' + d.width + '×' + d.height : ''), value: open.indexOf(id) >= 0,
          onChange: (on) => {
            const next = on ? (open.indexOf(id) >= 0 ? open.slice() : open.concat([id])) : open.filter((n) => n !== id);
            /* İlk dokunuş pencereyi de seçimi de bırakır. Yanıt gelene kadar
               anahtar açık pencerede kalıyordu; ikinci dokunuş seçimi siliyordu. */
            outputs = Object.assign({}, outputs, { open: next.slice(), selected: next.slice() });
            outputHold = Date.now() + 1500;
            const job = next.length ? ask('output.open', { ids: next }) : ask('output.close', {});
            job.then((r) => {
              if (r && r.ok && r.result) outputs = Object.assign({}, outputs, r.result);
              else S.toast('Açılamadı.');
              outputSig = '';
              ctx.refresh();
            });
          },
        }));
      }
      card.push(U.toggle({ label: 'Yüzen pencere', value: !!outputs.floating, onChange: (on) => ask('output.set', { floating: on }).then((r) => { if (r && r.ok) outputs.floating = r.result.floating; ctx.refresh(); }) }));
      body.appendChild(U.card(card));
    }

    // ---- Ses girişi
    body.appendChild(h('div', { class: 'section-label', text: 'PC\'nin ses girişi' }));
    if (!devices) ask('audio.sources').then((r) => { devices = r && r.ok ? r.result : { devices: [], sources: [] }; ctx.refresh(); });
    else {
      const cur = (devices.sources && devices.sources[0]) || 'default';
      const opts = [['default', tr('Sistem sesi (varsayılan)')]].concat(devices.devices.filter((d) => d.name && d.name !== 'default').map((d) => [d.name, d.name]));
      body.appendChild(U.card([
        U.select({
          label: 'Aygıt', value: typeof cur === 'string' ? cur : 'default', options: opts,
          onChange: (v) => { const a = Object.assign({}, c.audio || {}, { sources: [v] }); A().config.patch({ audio: a }); devices.sources = [v]; },
        }),
        h('div', { class: 'hint', text: st.audioSend ? 'Şu an PC\'nin girişi bu telefon (Ses → PC\'ye gönder).' : 'Telefonun sesini PC\'ye vermek için Ses → PC\'ye gönder.' }),
      ]));
    }

    // ---- Kayıt ve dışa aktarma
    body.appendChild(h('div', { class: 'section-label', text: 'Kayıt ve dışa aktarma' }));
    body.appendChild(h('div', { class: 'btn-row' }, [
      h('button', { class: 'btn', onclick: () => ask('record.start').then((r) => S.toast(r && r.ok ? 'PC\'de kayıt başladı.' : 'Kayıt başlamadı.')) }, [icon('record'), h('span', { text: 'Kaydı Başlat' })]),
      h('button', { class: 'btn', onclick: () => ask('record.stop').then((r) => S.toast(r && r.ok ? 'PC\'de kayıt durdu.' : 'Kayıt durmadı.')) }, [icon('stop'), h('span', { text: 'Kaydı Durdur' })]),
    ]));
    const fmt = { v: 'mp4-h264' }; const res = { v: '1080p' }; const fps = { v: '60' };
    const running = exportP && exportP.phase && exportP.phase !== 'done' && exportP.phase !== 'error' && exportP.phase !== 'cancelled';
    const pct = exportP && exportP.total ? Math.round(((exportP.done || 0) / exportP.total) * 100) : 0;
    body.appendChild(U.card([
      h('div', { class: 'ctl-row' }, [h('div', { class: 'ctl-label', text: 'Şarkı' }), h('span', { class: 'grow-text', text: song ? song.name : tr('Seçilmedi') }),
        h('button', { class: 'btn', onclick: () => send('audio') }, [icon('upload'), h('span', { text: 'Telefondan Gönder' })])]),
      U.select({ label: 'Biçim', value: fmt.v, options: [['mp4-h264', 'MP4 (H.264)'], ['mp4-hevc', 'MP4 (HEVC)'], ['webm-vp9', 'WebM (VP9)'], ['mov-prores', 'MOV (ProRes)']], onChange: (v) => { fmt.v = v; } }),
      U.select({ label: 'Çözünürlük', value: res.v, options: [['720p', '720p'], ['1080p', '1080p'], ['1440p', '1440p'], ['2160p', '4K'], ['1080x1920', '1080×1920'], ['1080x1080', '1080×1080']], onChange: (v) => { res.v = v; } }),
      U.select({ label: 'Kare hızı', value: fps.v, options: [['30', '30'], ['50', '50'], ['60', '60']], onChange: (v) => { fps.v = v; } }),
      running ? h('div', { class: 'export-bar' }, [h('i', { style: 'width:' + pct + '%' })]) : null,
      h('div', { class: 'btn-row' }, [
        h('button', { class: 'btn primary', disabled: !song || running, onclick: () => ask('export.start', { audio: song.id, format: fmt.v, resolution: res.v, fps: Number(fps.v) }).then((r) => S.toast(r && r.ok ? tr('PC\'de dışa aktarma başladı') + ': ' + r.result.file : tr('Başlamadı') + (r && r.detail ? ': ' + r.detail : ''))) }, [icon('export'), h('span', { text: 'PC\'de Dışa Aktar' })]),
        running ? h('button', { class: 'btn', onclick: () => ask('export.cancel') }, [icon('x'), h('span', { text: 'İptal' })]) : null,
      ]),
      h('div', { class: 'hint', text: 'Video bilgisayarın Videolar/SoundVisualizer klasörüne yazılır.' }),
    ]));

    // ---- Dosya gönder
    body.appendChild(h('div', { class: 'section-label', text: 'PC\'ye dosya gönder' }));
    body.appendChild(h('div', { class: 'btn-row' }, KINDS.map(([k, label]) => h('button', { class: 'btn', onclick: () => send(k) }, [icon('upload'), h('span', { text: label })]))));
    uploadRows(body);
    body.appendChild(h('div', { class: 'hint', text: 'Dosya PC\'nin kitaplığına eklenir. Gönderim uygulama arka plandayken de sürer.' }));

    // ---- Işık ve güç
    body.appendChild(h('div', { class: 'section-label', text: 'Işık ve güç' }));
    const L = c.lighting || {};
    const P = c.power || {};
    body.appendChild(U.card([
      U.toggle({ label: 'Işık', value: !!L.enabled, onChange: (on) => A().config.set(Object.assign({}, cfg(), { lighting: Object.assign({}, cfg().lighting || {}, { enabled: on }) })) }),
      U.slider({ label: 'Parlaklık', min: 0, max: 1, step: 0.01, percent: true, value: L.brightness == null ? 1 : L.brightness,
        onInput: (v) => A().config.patch({ lighting: Object.assign({}, cfg().lighting || {}, { brightness: v }) }),
        onChange: (v) => A().config.set(Object.assign({}, cfg(), { lighting: Object.assign({}, cfg().lighting || {}, { brightness: v }) })) }),
      U.select({ label: 'Kare sınırı', value: String(P.fpsCap || 0), options: [['0', tr('Ekranla eşitle')], ['30', '30'], ['60', '60'], ['120', '120']],
        onChange: (v) => A().config.set(Object.assign({}, cfg(), { power: Object.assign({}, cfg().power || {}, { fpsCap: Number(v) }) })) }),
      U.select({ label: 'Düşük güç', value: P.lowPower || 'off', options: [['off', tr('Kapalı')], ['battery', tr('Pildeyken')], ['on', tr('Açık')]],
        onChange: (v) => A().config.set(Object.assign({}, cfg(), { power: Object.assign({}, cfg().power || {}, { lowPower: v }) })) }),
    ]));

    // ---- Sahne aktarma
    body.appendChild(h('div', { class: 'section-label', text: 'Sahne aktarma' }));
    const pcScenes = Array.isArray(c.scenes) ? c.scenes : [];
    const mine = (A().config.local() || {}).scenes || [];
    body.appendChild(h('div', { class: 'hint', text: 'Sahnenin ayarları aktarılır. Kullandığı video ve logo gibi dosyalar ayrıca gönderilir; bilgisayara özgü katmanlar (web sayfası, görüntü girişleri) telefonda çalışmaz.' }));
    body.appendChild(U.select({
      label: 'PC\'den telefona', value: '', options: [['', tr('Sahne seçin')]].concat(pcScenes.map((x) => [x.id, x.name || x.id])),
      onChange: (id) => {
        const sc = pcScenes.find((x) => x.id === id);
        if (!sc) return;
        const local = A().config.local();
        const copy = { id: 'sc_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6), name: sc.name, createdAt: Date.now(), data: JSON.parse(JSON.stringify(sc.data || {})) };
        // Telefonun kendi ayarına: hedef PC iken config.set PC'ye gider, bu yüzden yerel yol
        A().pc.copyToPhone(Object.assign({}, local, { scenes: (local.scenes || []).concat([copy]) }));
        S.toast(tr('Telefona kopyalandı') + ': ' + (sc.name || ''));
      },
    }));
    body.appendChild(U.select({
      label: 'Telefondan PC\'ye', value: '', options: [['', tr('Sahne seçin')]].concat(mine.map((x) => [x.id, x.name || x.id])),
      onChange: (id) => {
        const sc = mine.find((x) => x.id === id);
        if (!sc) return;
        ask('scene.create', { name: sc.name || '', data: sc.data || {} }).then((r) => S.toast(r && r.ok ? tr('PC\'ye gönderildi') + ': ' + (sc.name || '') : tr('Gönderilemedi') + (r && r.detail ? ': ' + r.detail : '')));
      },
    }));
  }

  page = {
    size: 'tall',
    title: 'PC Ayarları',
    subtitle: () => (A() && A().target ? A().target.get().name || '' : ''),
    render,
    onLeave() { clearInterval(outputTimer); outputTimer = 0; outputs = null; devices = null; outputSig = ''; },
  };
  window.SVShellPcManage = { page: () => { clearInterval(outputTimer); outputTimer = 0; outputs = null; devices = null; outputSig = ''; return page; } };
})();
