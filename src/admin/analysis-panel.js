'use strict';
/* Ses çözümlemesi paneli — canlı ölçümler.

   İki işi var. Birincisi bilgi: tempo, tonalite, akor, gürlük, stereo durumu
   ve nota sınıfı dağılımı tek yerde görünür. İkincisi teşhis: bir sahne sese
   tepki vermiyorsa sorunun sinyalde mi (kaynak sessiz, tek kanal, sıkışmış)
   yoksa yönlendirmede mi olduğu buradan bir bakışta anlaşılır.

   Panel kendi çözümleyicisini kurmaz; önizlemedeki motorun sonuçlarını okur,
   böylece burada görünen sayı ekrandaki görüntüyü süren sayının aynısıdır. */
(function () {
  const P = () => window.SVPanel;
  const NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
  const tr = (t) => (window.SVI18n && typeof window.SVI18n.t === 'function' ? window.SVI18n.t(t) : t);

  let timer = 0;
  let bannerEl = null;
  let currentGuardSwitch = null;
  const live = []; // { el, read, fmt }

  function readout(label, read, fmt) {
    const el = P().el;
    const val = el('span', { class: 'an-val', text: '—' });
    live.push({ el: val, read, fmt: fmt || ((v) => (typeof v === 'number' ? v.toFixed(2) : String(v))) });
    return el('div', { class: 'an-row' }, [
      el('span', { class: 'an-lbl', text: tr(label) }),
      val,
    ]);
  }

  function bar(label, read) {
    const el = P().el;
    const fill = el('i');
    const track = el('span', { class: 'an-bar' }, [fill]);
    live.push({ el: fill, read, bar: true });
    return el('div', { class: 'an-row' }, [
      el('span', { class: 'an-lbl', text: tr(label) }),
      track,
    ]);
  }

  function panel() {
    const el = P().el;
    live.length = 0;

    const an = () => {
      const prev = window.SVPreview;
      if (!prev || !prev.isLive()) return null;
      const eng = prev.audioEngine && prev.audioEngine();
      const a = eng && eng.analysis;
      if (!a || a.silent) return null;
      return a;
    };

    // --- Akıllı Sessizlik Filtresi Araç Çubuğu ---
    const guardEnabled = P().get ? (P().get('audio.humGuard') !== false) : true;
    const guardSwitch = el('input', {
      type: 'checkbox',
      'data-path': 'audio.humGuard',
      onchange: (e) => {
        const val = e.target.checked;
        if (P().set) P().set('audio.humGuard', val);
        const prev = window.SVPreview;
        const eng = prev && prev.audioEngine && prev.audioEngine();
        if (eng) {
          if (eng.cfg) eng.cfg.humGuard = val;
          if (eng.analysis) eng.analysis.humGuard = val;
        }
        if (P().syncToggles) P().syncToggles('audio.humGuard', val);
        else {
          document.querySelectorAll('input[type="checkbox"][data-path="audio.humGuard"]').forEach((box) => {
            if (box.checked !== val) box.checked = val;
          });
        }
        if (bannerEl) {
          const isHum = !!(eng && eng.analysis && eng.analysis.humDetected);
          bannerEl.style.display = (!val && isHum) ? 'flex' : 'none';
        }
        if (P().push) P().push(true);
      },
    });
    guardSwitch.checked = guardEnabled;
    currentGuardSwitch = guardSwitch;

    const toolbar = el('div', { class: 'an-toolbar' }, [
      el('div', { class: 'an-toolbar-info' }, [
        el('div', { class: 'an-toolbar-title', text: tr('Akıllı Sessizlik Filtresi') }),
        el('div', { class: 'an-toolbar-desc', text: tr('50/60 Hz donanım uğultusu ve boşta dip gürültüsünü filtreler') }),
      ]),
      el('label', { class: 'switch' }, [guardSwitch, el('span', { class: 'track' })]),
    ]);

    // --- Dip Gürültüsü Uyarı Bandı ---
    const bannerBtn = el('button', {
      class: 'an-banner-btn',
      text: tr('Filtreyi Aç'),
      onclick: () => {
        guardSwitch.checked = true;
        if (P().set) P().set('audio.humGuard', true);
        const prev = window.SVPreview;
        const eng = prev && prev.audioEngine && prev.audioEngine();
        if (eng) {
          if (eng.cfg) eng.cfg.humGuard = true;
          if (eng.analysis) eng.analysis.humGuard = true;
        }
        if (bannerEl) bannerEl.style.display = 'none';
        if (P().syncToggles) P().syncToggles('audio.humGuard', true);
        else {
          document.querySelectorAll('input[type="checkbox"][data-path="audio.humGuard"]').forEach((box) => {
            if (box.checked !== true) box.checked = true;
          });
        }
        if (P().push) P().push(true);
        if (P().toast) P().toast(tr('Akıllı Sessizlik Filtresi etkinleştirildi.'));
      },
    });

    bannerEl = el('div', { class: 'an-banner', style: 'display:none;' }, [
      el('span', { class: 'an-banner-text', text: tr('⚡ Donanım dip gürültüsü / şebeke uğultusu algılandı (50/60 Hz). Düzeltmeli moda geçmek için Akıllı Sessizlik Filtresini açabilirsiniz.') }),
      bannerBtn,
    ]);

    // --- nota sınıfı çemberi -------------------------------------------
    const wheel = el('div', { class: 'an-chroma' });
    const cells = [];
    for (let i = 0; i < 12; i++) {
      const fill = el('i');
      const cell = el('div', { class: 'an-note' }, [
        el('span', { class: 'an-note-name', text: NOTE_NAMES[i] }),
        el('span', { class: 'an-note-bar' }, [fill]),
      ]);
      cells.push(fill);
      wheel.appendChild(cell);
    }

    const nodes = [
      bannerEl,
      toolbar,
      el('div', { class: 'an-grid' }, [
        el('div', { class: 'an-col' }, [
          el('h4', { text: tr('Müzikal') }),
          readout('Tonalite', () => { const a = an(); return a ? a.key.name : '—'; }, String),
          readout('Akor', () => { const a = an(); return a ? a.chord.name : '—'; }, String),
          readout('Perde', () => {
            const a = an();
            if (!a || !a.pitch.hz) return '—';
            return a.pitch.note + ' · ' + a.pitch.hz.toFixed(1) + ' Hz';
          }, String),
          bar('Akor Güveni', () => { const a = an(); return a ? a.chord.confidence : 0; }),
        ]),
        el('div', { class: 'an-col' }, [
          el('h4', { text: tr('Seviye') }),
          bar('Gürlük', () => { const a = an(); return a ? a.loudness : 0; }),
          bar('Tepe', () => { const a = an(); return a ? a.peak : 0; }),
          bar('Dinamik', () => { const a = an(); return a ? a.dynamics : 0; }),
          readout('Durum', () => {
            const a = an();
            if (!a || a.silent) return tr('sessiz');
            return tr('sinyal var');
          }, String),
        ]),
        el('div', { class: 'an-col' }, [
          el('h4', { text: tr('Tını') }),
          bar('Tayf Merkezi', () => { const a = an(); return a ? a.centroid : 0; }),
          bar('Tayf Düzlüğü', () => { const a = an(); return a ? a.flatness : 0; }),
          bar('Yuvarlanma', () => { const a = an(); return a ? a.rolloff : 0; }),
          bar('Tayf Akısı', () => { const a = an(); return a ? a.flux : 0; }),
        ]),
        el('div', { class: 'an-col' }, [
          el('h4', { text: tr('Yapı') }),
          bar('Armonik Oran', () => { const a = an(); return a ? a.harmonic : 0; }),
          bar('Vurmalı Oran', () => { const a = an(); return a ? a.percussive : 0; }),
          bar('Stereo Genişlik', () => { const a = an(); return a ? a.width : 0; }),
          readout('Stereo Korelasyon', () => { const a = an(); return a ? a.correlation : 0; },
            (v) => (typeof v === 'number' && v > 0 ? v.toFixed(2) : '—')),
        ]),
        el('div', { class: 'an-col' }, [
          el('h4', { text: tr('Davul') }),
          bar('Bas Davul', () => { const a = an(); return a ? a.bands.kick : 0; }),
          bar('Trampet', () => { const a = an(); return a ? a.bands.snare : 0; }),
          bar('Hi-Hat', () => { const a = an(); return a ? a.bands.hat : 0; }),
        ]),
      ]),
      el('div', { class: 'ctrl' }, [
        el('label', { class: 'lbl', text: tr('Nota Sınıfları') }),
        wheel,
      ]),
      el('div', { class: 'studio-note dim-hint', text: tr('Buradaki her ölçüm modülasyon matrisinde kaynak olarak kullanılabilir. Sahne sese tepki vermiyorsa önce buraya bakın: sinyal geliyor mu, tek kanal mı, sessizlik eşiğinin altında mı? Akıllı Sessizlik Filtresi müzikte hiçbir kayba yol açmaz (yalnızca 115 Hz altı aşırı kısık saf test sinyalleri hariç). Temiz stüdyo donanımlarında ham analiz için filtre kapatılabilir.') }),
    ];

    // Kroma hücreleri canlı listeye (dikey doldukları için ayrı işaretli)
    for (let i = 0; i < 12; i++) {
      live.push({
        el: cells[i],
        bar: true,
        vertical: true,
        read: () => {
          const a = an();
          if (!a || a.silent) return 0;
          let max = 0;
          for (let k = 0; k < 12; k++) if (a.chromaSmooth[k] > max) max = a.chromaSmooth[k];
          return max > 1e-6 ? a.chromaSmooth[i] / max : 0;
        },
      });
    }

    start();
    return el('div', { class: 'an-panel' }, nodes);
  }

  function start() {
    if (timer) clearInterval(timer);
    if (window.api && window.api.subscribePreview) {
      window.api.subscribePreview(true);
    }
    timer = setInterval(() => {
      let alive = false;
      for (const item of live) {
        if (!item.el || !item.el.isConnected) continue;
        alive = true;
        const v = item.read();
        if (item.bar) {
          const p = Math.max(0, Math.min(1, typeof v === 'number' ? v : 0));
          if (item.vertical) item.el.style.height = (p * 100).toFixed(1) + '%';
          else item.el.style.width = (p * 100).toFixed(1) + '%';
        } else {
          const rawText = item.fmt(v);
          const text = tr(rawText);
          if (item.el.textContent !== text) item.el.textContent = text;
        }
      }

      if (currentGuardSwitch && currentGuardSwitch.isConnected) {
        const expected = P().get ? (P().get('audio.humGuard') !== false) : true;
        if (currentGuardSwitch.checked !== expected) {
          currentGuardSwitch.checked = expected;
        }
      }

      if (bannerEl && bannerEl.isConnected) {
        const prev = window.SVPreview;
        const eng = prev && prev.audioEngine && prev.audioEngine();
        const a = eng && eng.analysis;
        const isHum = !!(a && a.humDetected);
        const isOff = P().get ? (P().get('audio.humGuard') === false) : false;
        const targetDisplay = (isHum && isOff) ? 'flex' : 'none';
        if (bannerEl.style.display !== targetDisplay) {
          bannerEl.style.display = targetDisplay;
        }
      }

      if (!alive) {
        clearInterval(timer);
        timer = 0;
        if (window.SVAdmin && typeof window.SVAdmin.syncPreviewSubscription === 'function') {
          window.SVAdmin.syncPreviewSubscription();
        }
      }
    }, 100);
  }

  window.SVAnalysisPanel = { panel };
})();
