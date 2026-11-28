/*
 * SoundVisualizer — CaYaDev Ses Görselleştirici
 * Copyright (c) 2026 Çağan Turgut (CaYatur) — CaYaDev, https://cayadev.com
 * https://github.com/CaYatur/SoundVisualizer
 * SPDX-License-Identifier: MIT
 */
'use strict';
/* SES SEKMESİ (docs/android/PLAN.md Faz 3.5; onaylı taslak 5).

   Tam ekran sayfa: seviye (16 bant, dB), ses kaynağı (uygulama içi çalar, sistem sesi,
   çıkış karışımı, mikrofon), sessizlik uyarısı (çalan uygulama sesini paylaşmıyorsa
   çıkış karışımı önerilir), tempo (BPM, elle vuruş) ve Otomatik VJ.

   Seviye çubukları motorun KENDİ ses nesnesinden (src/mobile/autovj.js yakalıyor):
   ekranda çizilen sesle aynı. Kaynak hiç açılmadıysa motor demo sesi çalıyor. */
(function () {
  if (typeof window === 'undefined' || !window.SVShell || !window.SVShellUI) return;
  const S = window.SVShell;
  const U = window.SVShellUI;
  const { h, icon, A } = S;
  const VJ = () => window.SVMobileVJ;
  const R = () => window.SVAutoVJRules;
  const tr = (s) => (window.SVI18n && window.SVI18n.t ? window.SVI18n.t(s) : s);
  const en = () => !!(window.SVI18n && window.SVI18n.locale === 'en');
  const cfg = () => (A() && A().config.get()) || {};

  const SOURCES = [
    { id: 'player', icon: 'music', title: 'Uygulama içi çalar', sub: 'Şarkı seçin; en temiz ses, izin gerekmez' },
    { id: 'capture', icon: 'phone', title: 'Sistem sesi', sub: 'Diğer uygulamaların sesi · her oturumda onay' },
    { id: 'visualizer', icon: 'wave', title: 'Çıkış karışımı', sub: 'Sesini paylaşmayan uygulamalar için, düşük kalite' },
    { id: 'mic', icon: 'mic', title: 'Mikrofon', sub: 'Ortamdaki ses' },
  ];
  const TIMELINE_SOURCE = { id: 'timeline', icon: 'timeline', title: 'Zaman çizelgesi sesi', sub: 'Çizelgede ses varken bu kaynak listede kalır. Seçilince görüntüyü ve çalan parçayı o şarkı sürer.' };
  function sources() {
    const M = window.SVShellTimelineAudio;
    return M && M.offered && M.offered() ? [TIMELINE_SOURCE].concat(SOURCES) : SOURCES.slice();
  }
  const ERRORS = {
    'permission-denied': 'Mikrofon izni verilmedi.',
    'consent-denied': 'Ekran kaydı onayı verilmedi; sistem sesi alınamıyor.',
    cancelled: 'Şarkı seçilmedi.',
  };
  const VJ_SOURCES = [['visualizers', 'Görselleştiriciler'], ['scenes', 'Sahneler'], ['palettes', 'Renk Şablonları'], ['backgrounds', 'Arkaplanlar'], ['all', 'Hepsi (sırayla)']];

  let refs = null;
  let error = '';

  const status = () => (A() && A().audio.status()) || null;
  const running = () => { const st = status(); return st && st.state === 'running' ? st.source : null; };
  /* Seçili kaynak: çalışan kaynak; çalar duraklatılmışsa da çalar seçili sayılır. */
  function activeSource() {
    const st = status();
    if (!st) return null;
    if (st.source === 'timeline') return 'timeline';
    if (st.state === 'running') return st.source;
    if (st.source === 'player' && (st.state === 'paused' || st.state === 'ended')) return 'player';
    return null;
  }

  function badge() {
    const src = running();
    const silent = src && A().audio.silent();
    if (!src) return h('span', { class: 'badge', text: 'Demo ses' });
    if (silent) return h('span', { class: 'badge warn', text: 'Ses yok' });
    return h('span', { class: 'badge ok', text: 'Dinleniyor' });
  }

  async function choose(id) {
    error = '';
    const S0 = A();
    try {
      const M = window.SVShellTimelineAudio;
      if (id === 'timeline') {
        if (activeSource() === 'player') await S0.player.pause().catch(() => {});
        await S0.audio.stop().catch(() => {});
        if (M && M.userPicked) M.userPicked('timeline');
      } else if (id === 'player') {
        if (M && M.userPicked) M.userPicked('player');
        const p = S0.player.state && S0.player.state();
        if (p && p.has) await S0.player.play();
        else await S0.player.pick();
      } else {
        if (M && M.userPicked) M.userPicked(id);
        if (activeSource() === 'player') await S0.player.pause().catch(() => {});
        await S0.audio.start(id);
      }
    } catch (e) {
      const code = String((e && e.message) || e);
      error = ERRORS[code] || ('Başlatılamadı: ' + code);
    }
    paint();
  }
  async function stopAll() {
    error = '';
    const S0 = A();
    const M = window.SVShellTimelineAudio;
    if (M && M.userPicked) M.userPicked('demo');
    if (activeSource() === 'player') await S0.player.stop().catch(() => {});
    await S0.audio.stop().catch(() => {});
    paint();
  }

  function sourceCard(s) {
    const on = activeSource() === s.id;
    return h('button', {
      class: 'source' + (on ? ' on' : ''), role: 'radio', 'aria-checked': on ? 'true' : 'false', 'data-source': s.id,
      onclick: () => choose(s.id),
    }, [
      h('div', { class: 'ic', 'aria-hidden': 'true' }, [icon(s.icon)]),
      h('div', { class: 'row-text' }, [h('div', { class: 'row-title', text: s.title }), h('div', { class: 'row-sub', text: s.sub })]),
      h('span', { class: 'radio' + (on ? ' on' : ''), 'aria-hidden': 'true' }),
    ]);
  }

  /* Çalar açıkken: parça adı, oynat/duraklat, başka şarkı. */
  function playerCard() {
    const p = A().player.state ? A().player.state() : null;
    if (!p || !p.has) return null;
    const playing = !!p.playing;
    const name = p.title || p.name || '';
    return h('div', { class: 'card player-card' }, [
      h('div', { class: 'ctl-row' }, [
        h('div', { class: 'row-text' }, [
          h('div', { class: 'row-title', text: name }),
          p.artist ? h('div', { class: 'row-sub', text: p.artist }) : null,
        ]),
        h('button', { class: 'iconbtn plain', 'aria-label': playing ? 'Duraklat' : 'Oynat', onclick: () => (playing ? A().player.pause() : A().player.play()).then(paint, paint) }, [icon(playing ? 'pause' : 'play')]),
        h('button', { class: 'iconbtn plain', 'aria-label': 'Başka şarkı', title: 'Başka şarkı', onclick: () => A().player.pick().then(paint, paint) }, [icon('folder-open')]),
      ]),
    ]);
  }

  /* ÇALAN PARÇA (media/NowPlaying.kt): başka uygulamalarda çalanı okumak için bildirim
     erişimi. Erişim yoksa neden gerektiği ve düğme; varsa parça kapağıyla. Şarkı bilgisi
     katmanı, söz katmanının saati ve otomatik söz bulma bunu kullanır. */
  let npEnabled = null;
  let npSeen = ''; // medya oturumu görülen uygulamalar
  function askNowPlaying() {
    const N = A().nowPlaying;
    if (!N) return;
    N.status().then((r) => {
      const on = !!(r && r.enabled);
      const seen = r && Array.isArray(r.sessions) ? r.sessions.map((x) => x.app).filter(Boolean).join(', ') : '';
      if (on !== npEnabled || seen !== npSeen) { npEnabled = on; npSeen = seen; paint(); }
    }, () => {});
  }
  function nowPlayingCard() {
    const N = A().nowPlaying;
    if (!N) return null;
    if (npEnabled === null) askNowPlaying();
    const cur = N.current();
    const kids = [h('div', { class: 'section-label', text: 'Çalan parça' })];
    if (npEnabled === false && !(cur && cur.has)) {
      kids.push(h('div', { class: 'card np-card' }, [
        h('div', { class: 'row-text' }, [
          h('div', { class: 'row-title small', text: 'Başka uygulamalarda çalan parça' }),
          h('div', { class: 'row-sub', text: 'Parçanın adı, kapağı ve söz zamanlaması için bildirim erişimi gerekir. Uygulama bildirimlerinizi okumaz; yalnız çalan parçayı görür.' }),
        ]),
        h('button', { class: 'btn', onclick: () => N.openAccess().catch(() => {}) }, [icon('gear'), 'Erişim ver']),
      ]));
      return kids;
    }
    if (!cur || !cur.has) {
      kids.push(h('div', { class: 'card np-card' }, [
        h('div', { class: 'row-sub', text: 'Şu an hiçbir uygulama çalmıyor.' }),
        npSeen ? h('div', { class: 'row-sub' }, [h('span', { text: 'Parça bilgisi vermeyen uygulamalar' }), ': ', h('span', { 'data-user-text': '', text: npSeen })]) : null,
      ]));
      return kids;
    }
    const art = cur.artwork ? h('img', { class: 'np-art', src: cur.artwork, alt: '' }) : h('div', { class: 'np-art ph' }, [icon('music')]);
    const sub = [cur.artist, cur.app].filter(Boolean).join(' · ');
    kids.push(h('div', { class: 'card np-card row-card' }, [
      art,
      h('div', { class: 'row-text' }, [
        h('div', { class: 'row-title', text: cur.title || '' }),
        sub ? h('div', { class: 'row-sub', text: sub }) : null,
      ]),
      h('span', { class: 'badge' + (cur.playing ? ' ok' : ''), text: cur.playing ? 'Çalıyor' : 'Duraklatıldı' }),
    ]));
    return kids;
  }

  function silenceBanner() {
    const src = running();
    if (!src || !A().audio.silent() || src === 'visualizer' || src === 'player') return null;
    return h('div', { class: 'banner', role: 'status' }, [
      icon('warning'),
      h('div', { class: 'grow-text' }, [
        h('b', { text: '3 saniyedir ses gelmiyor.' }), ' ',
        h('span', { text: 'Çalan uygulama sesini paylaşmıyor olabilir.' }), ' ',
        h('button', { class: 'link', onclick: () => choose('visualizer') }, [h('span', { text: 'Çıkış karışımına geç' })]),
      ]),
    ]);
  }

  function vjText(a) {
    const n = a.interval;
    if (a.unit === 'seconds') return en() ? 'Changes every ' + n + ' s' : 'Her ' + n + ' saniyede değişir';
    return en() ? 'Changes every ' + n + (n === 1 ? ' bar' : ' bars') : 'Her ' + n + ' ölçüde değişir';
  }

  function tempoCard() {
    const a = R() ? R().normalize(cfg().autovj) : { enabled: false, unit: 'bars', interval: 8, source: 'visualizers' };
    const bpm = h('div', { class: 'bpm' });
    const conf = h('div', { class: 'row-sub tempo-src' });
    const tap = h('button', { class: 'tap', 'aria-label': 'Tempoya dokun', onclick: () => { if (VJ()) VJ().tap(); tap.classList.add('hit'); setTimeout(() => tap.classList.remove('hit'), 120); } }, ['TAP']);
    const setVJ = (patch) => {
      const c = cfg();
      A().config.patch({ autovj: Object.assign({}, c.autovj, patch) });
      if (VJ()) VJ().restart();
    };
    const toggle = h('button', { class: 'toggle', role: 'switch', 'aria-label': 'Otomatik VJ', 'aria-checked': a.enabled ? 'true' : 'false', onclick: () => setVJ({ enabled: !(cfg().autovj && cfg().autovj.enabled) }) });
    const kids = [
      h('div', { class: 'tempo-row' }, [
        h('div', { class: 'grow-col' }, [conf, bpm]),
        tap,
      ]),
      h('div', { class: 'divider flush' }),
      h('div', { class: 'ctl-row' }, [
        icon('dice'),
        h('div', { class: 'row-text' }, [h('div', { class: 'row-title', text: 'Otomatik VJ' }), h('div', { class: 'row-sub', text: vjText(a) })]),
        toggle,
      ]),
    ];
    if (a.enabled) {
      kids.push(U.select({ label: 'Değişen', options: VJ_SOURCES, value: a.source === 'custom' ? 'all' : a.source, onChange: (v) => setVJ({ source: v }) }));
      kids.push(U.seg({ label: 'Aralık', options: [['4', '4'], ['8', '8'], ['16', '16'], ['32', '32']], value: String(a.unit === 'bars' ? a.interval : 8), onChange: (v) => setVJ({ unit: 'bars', interval: +v }) }));
      kids.push(h('button', { class: 'btn', onclick: () => { const r = VJ() && VJ().switchNow(); paint(); return r; } }, [icon('next'), 'Şimdi Değiştir']));
      const st = VJ() ? VJ().status() : null;
      if (st && st.lastFailure) kids.push(h('div', { class: 'hint warn-text', text: st.lastFailure.code === 'EMPTY' || st.lastFailure.code === 'NONE' ? 'Bu kaynakta değiştirilecek bir şey yok.' : 'Otomatik VJ değiştiremedi.' }));
      else if (st && st.lastResult) kids.push(h('div', { class: 'hint' }, [h('span', { text: 'Son değişim' }), ': ' + st.lastResult.label]));
    }
    refs.bpm = bpm;
    refs.conf = conf;
    refs.tap = tap;
    return h('div', { class: 'card tempo-card' }, kids);
  }

  // ---- Canlı çizim: seviye, dB, BPM (yalnız sayfa açıkken) ----
  const BANDS = 16;
  let raf = 0;
  function frame() {
    raf = 0;
    if (!refs || !refs.meter || !refs.meter.isConnected) return;
    raf = requestAnimationFrame(frame);
    const audio = VJ() && VJ().audio();
    if (audio && audio.ready && audio.getBars) {
      const bars = audio.getBars(BANDS, 30, 16000);
      for (let i = 0; i < BANDS; i++) {
        const v = Math.sqrt(Math.max(0, Math.min(1, bars[i] || 0)));
        const hp = Math.round(4 + 96 * v) + '%';
        if (refs.bars[i].style.height !== hp) refs.bars[i].style.height = hp;
      }
      const lvl = Math.max(1e-4, audio.level || 0);
      const db = Math.max(-60, Math.round(20 * Math.log10(lvl)));
      const txt = db <= -60 ? '−∞ dB' : (db < 0 ? '−' + Math.abs(db) : String(db)) + ' dB';
      if (refs.db.textContent !== txt) refs.db.textContent = txt;
    }
    const t = VJ() ? VJ().tempo() : null;
    if (t && refs.bpm) {
      const b = t.bpm ? String(Math.round(t.bpm)) : '—';
      if (refs.bpm.firstChild === null || refs.bpm.dataset.v !== b) {
        refs.bpm.dataset.v = b;
        refs.bpm.textContent = '';
        refs.bpm.appendChild(document.createTextNode(b));
        refs.bpm.appendChild(h('span', { class: 'unit', text: ' BPM' }));
      }
      const src = t.locked ? 'Tempo · elle' : 'Tempo · sesten';
      if (refs.conf.dataset.v !== src) { refs.conf.dataset.v = src; refs.conf.textContent = src; }
      refs.tap.classList.toggle('beat', t.energy > 0.35);
    }
  }

  function render(body, ctx) {
    refs = { bars: [] };
    for (let i = 0; i < BANDS; i++) refs.bars.push(h('i'));
    refs.db = h('span', { class: 'mono', text: '' });
    refs.meter = h('div', { class: 'bigmeter', 'aria-hidden': 'true' }, refs.bars);
    body.appendChild(h('div', { class: 'card level-card' }, [
      h('div', { class: 'level-head' }, [h('span', { text: 'Seviye' }), refs.db]),
      refs.meter,
    ]));
    /* PC bağlantısı (B4): seçili kaynağın sesi ve çalan parça bilgisayarın ses girişi olur.
       Kayıtlı bilgisayar yoksa görünmez. */
    const T = A().target ? A().target.get() : null;
    // Hedef "Bu telefon"ken telefonun sahnesi PC'de çalana tepki versin (taslak 19)
    if (T && T.state === 'connected' && T.target !== 'pc' && !T.audioSend) {
      body.appendChild(h('div', { class: 'card' }, [h('div', { class: 'ctl' }, [
        U.toggle({ label: 'PC\'nin sesini kullan', value: !!T.usePcAudio, onChange: (on) => { A().pc.usePcAudio(on); ctx.refresh(); } }),
        h('div', { class: 'hint', text: 'Bu telefonun sahnesi PC\'de çalan sese tepki verir; telefonun kendi kaynağı o sırada kullanılmaz.' }),
      ])]));
    }
    if (T && (T.state === 'connected' || T.audioSend)) {
      const sendKids = [
        U.toggle({ label: 'PC\'ye gönder', value: !!T.audioSend, onChange: (on) => A().pc.audioSend(on).then(() => ctx.refresh()) }),
        h('div', { class: 'hint', text: T.audioSend
          ? (T.state === 'connected' ? window.SVI18n.t('Aşağıda seçili kaynağın sesi, çalan parça ve kapağı {pc} için ses girişi.').replace('{pc}', T.name || 'PC') : 'PC bağlanınca gönderilecek.')
          : 'Açınca seçili kaynağın sesi ve çalan parça PC\'nin ses girişi olur; PC\'nin görüntüsü, ışığı ve temposu bu sese tepki verir. Uygulama arka plandayken de sürer.' }),
      ];
      if (T.audioSend && T.state === 'connected' && A().pc.audioIn) {
        const ai = T.audioIn || {};
        sendKids.push(U.toggle({ label: 'PC Hoparlöründen de Çal', value: !!ai.play, onChange: (on) => A().pc.audioIn({ play: on }).then(() => ctx.refresh()) }));
        sendKids.push(U.toggle({ label: 'Telefon susunca PC kendi sesine döner', value: ai.fallback !== false, onChange: (on) => A().pc.audioIn({ fallback: on }).then(() => ctx.refresh()) }));
        sendKids.push(U.slider({ label: 'Görüntü Gecikmesi', min: 0, max: 500, step: 10, value: ai.delayMs || 0, onChange: (v) => A().pc.audioIn({ delayMs: v }) }));
        sendKids.push(U.slider({ label: 'PC\'ye giden ses', min: 0, max: 2, step: 0.05, percent: true, value: ai.gain == null ? 1 : ai.gain, def: 1, onChange: (v) => A().pc.audioIn({ gain: v }) }));
        sendKids.push(h('div', { class: 'hint', text: 'Bu ayarlar PC\'deki Telefon Bağlantısı kartıyla aynıdır. Hoparlör, PC susunca yerel sese dönüş ve görüntünün sesi beklemesi. Ses düzeyi %100 normaldir, %200e kadar yükselir.' }));
      }
      if (T.audioSend && T.state === 'connected' && A().pc.audioIn) {
        const ai = T.audioIn || {};
        sendKids.push(U.toggle({ label: 'Kayıpsız aktarım', value: !!ai.lossless, onChange: (on) => A().pc.audioIn({ lossless: on }).then(() => ctx.refresh()) }));
        sendKids.push(h('div', { class: 'hint', text: 'Kayıpsız aktarım paket atmaz; gecikme biraz artar. Kapalıyken hızlı yol durur.' }));
        if (ai.lossless) {
          sendKids.push(U.toggle({ label: 'Gecikme ile eşitle', value: ai.syncDelay !== false, onChange: (on) => A().pc.audioIn({ syncDelay: on }) }));
          sendKids.push(h('div', { class: 'hint', text: 'Görüntü, söz ve şarkı saati bu gecikme kadar geriden gelir; iki taraf aynı anda ilerler.' }));
        }
      }
      if (!T.audioSend && T.state === 'connected' && A().pc.playPcAudio) {
        sendKids.push(U.toggle({ label: 'PC sesini telefonda çal', value: !!T.playPc, onChange: (on) => { A().pc.playPcAudio(on); ctx.refresh(); } }));
        sendKids.push(U.slider({ label: 'Telefona gelen PC sesi', min: 0, max: 2, step: 0.05, percent: true, value: T.pcGain == null ? 1 : T.pcGain, def: 1, onChange: (v) => { A().pc.playPcGain(v); } }));
        sendKids.push(h('div', { class: 'hint', text: T.target === 'pc'
          ? 'PC\'de çalan ses telefonun hoparlöründen de duyulur. Kapalıyken görüntü yine bu sese göre çizilir; demo ses kullanılmaz. Ses düzeyi görüntüyü ve hoparlörü birlikte yükseltir.'
          : 'PC\'de çalan ses telefonun hoparlöründen de duyulur. Hedef bu telefonken görüntü PC\'yi yalnız "PC\'nin sesini kullan" veya bu anahtar açıkken izler.' }));
      }
      body.appendChild(h('div', { class: 'card' }, [h('div', { class: 'ctl' }, sendKids)]));
    }
    body.appendChild(h('div', { class: 'section-label', text: 'Kaynak' }));
    const group = h('div', { class: 'source-list', role: 'radiogroup', 'aria-label': 'Kaynak' }, sources().map(sourceCard));
    body.appendChild(group);
    const pc = playerCard();
    if (pc) body.appendChild(pc);
    for (const k of nowPlayingCard() || []) body.appendChild(k);
    if (error) body.appendChild(h('div', { class: 'banner', role: 'alert' }, [icon('warning'), h('div', { class: 'grow-text', text: error })]));
    const sb = silenceBanner();
    if (sb) body.appendChild(sb);
    if (activeSource() === 'pc') body.appendChild(h('div', { class: 'hint', text: 'Ses PC\'den geliyor. Telefon demo ses kullanmıyor.' }));
    else if (activeSource()) body.appendChild(h('button', { class: 'btn ghost', onclick: stopAll }, [icon('stop'), 'Demo sese dön']));
    body.appendChild(tempoCard());
    if (!raf) raf = requestAnimationFrame(frame);
    refs.ctx = ctx;
  }
  /* Kaynak, sessizlik ya da çalar değişince sayfa yeniden çizilir (açıksa). */
  function paint() {
    if (refs && refs.ctx && refs.meter && refs.meter.isConnected) refs.ctx.refresh();
  }

  const page = {
    size: 'screen',
    title: 'Ses',
    actions(slot) { slot.appendChild(badge()); },
    render,
    onConfig() { /* Otomatik VJ düğmesi kendi yamasıyla değişiyor; yeniden çizim sayfayı başa atmasın */ paint(); },
  };
  S.tab('audio', page);
  if (A()) {
    A().audio.onStatus(paint);
    A().audio.onSilence(paint);
    if (A().player.onState) A().player.onState(paint);
    // Çalan parça değişince kart yenilenir; erişim ayarlardan dönünce yeniden sorulur
    if (A().nowPlaying) A().nowPlaying.onChange(() => { npEnabled = null; paint(); });
    document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') { npEnabled = null; paint(); } });
  }
  window.SVShellAudio = Object.freeze({ choose, stopAll });
})();
