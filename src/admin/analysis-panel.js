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

  let timer = 0;
  const live = []; // { el, read, fmt }

  function readout(label, read, fmt) {
    const el = P().el;
    const val = el('span', { class: 'an-val', text: '—' });
    live.push({ el: val, read, fmt: fmt || ((v) => (typeof v === 'number' ? v.toFixed(2) : String(v))) });
    return el('div', { class: 'an-row' }, [
      el('span', { class: 'an-lbl', text: label }),
      val,
    ]);
  }

  function bar(label, read) {
    const el = P().el;
    const fill = el('i');
    const track = el('span', { class: 'an-bar' }, [fill]);
    live.push({ el: fill, read, bar: true });
    return el('div', { class: 'an-row' }, [
      el('span', { class: 'an-lbl', text: label }),
      track,
    ]);
  }

  function panel() {
    const el = P().el;
    live.length = 0;

    const an = () => {
      const prev = window.SVPreview;
      const eng = prev && prev.audioEngine && prev.audioEngine();
      return eng && eng.analysis;
    };

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
      el('div', { class: 'an-grid' }, [
        el('div', { class: 'an-col' }, [
          el('h4', { text: 'Müzikal' }),
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
          el('h4', { text: 'Seviye' }),
          bar('Gürlük', () => { const a = an(); return a ? a.loudness : 0; }),
          bar('Tepe', () => { const a = an(); return a ? a.peak : 0; }),
          bar('Dinamik', () => { const a = an(); return a ? a.dynamics : 0; }),
          readout('Durum', () => {
            const a = an();
            if (!a) return '—';
            return a.silent ? 'sessiz' : 'sinyal var';
          }, String),
        ]),
        el('div', { class: 'an-col' }, [
          el('h4', { text: 'Tını' }),
          bar('Tayf Merkezi', () => { const a = an(); return a ? a.centroid : 0; }),
          bar('Tayf Düzlüğü', () => { const a = an(); return a ? a.flatness : 0; }),
          bar('Yuvarlanma', () => { const a = an(); return a ? a.rolloff : 0; }),
          bar('Tayf Akısı', () => { const a = an(); return a ? a.flux : 0; }),
        ]),
        el('div', { class: 'an-col' }, [
          el('h4', { text: 'Yapı' }),
          bar('Armonik Oran', () => { const a = an(); return a ? a.harmonic : 0; }),
          bar('Vurmalı Oran', () => { const a = an(); return a ? a.percussive : 0; }),
          bar('Stereo Genişlik', () => { const a = an(); return a ? a.width : 0; }),
          readout('Stereo Korelasyon', () => { const a = an(); return a ? a.correlation : 0; },
            (v) => (typeof v === 'number' ? v.toFixed(2) : '—')),
        ]),
        el('div', { class: 'an-col' }, [
          el('h4', { text: 'Davul' }),
          bar('Bas Davul', () => { const a = an(); return a ? a.bands.kick : 0; }),
          bar('Trampet', () => { const a = an(); return a ? a.bands.snare : 0; }),
          bar('Hi-Hat', () => { const a = an(); return a ? a.bands.hat : 0; }),
        ]),
      ]),
      el('div', { class: 'ctrl' }, [
        el('label', { class: 'lbl', text: 'Nota Sınıfları' }),
        wheel,
      ]),
      el('div', { class: 'studio-note dim-hint', text: 'Buradaki her ölçüm modülasyon matrisinde kaynak olarak kullanılabilir. Sahne sese tepki vermiyorsa önce buraya bakın: sinyal geliyor mu, tek kanal mı, sessizlik eşiğinin altında mı?' }),
    ];

    // Kroma hücreleri canlı listeye (dikey doldukları için ayrı işaretli)
    for (let i = 0; i < 12; i++) {
      live.push({
        el: cells[i],
        bar: true,
        vertical: true,
        read: () => {
          const a = an();
          // En yüksek sınıfa göre ölçekle: mutlak değerler küçük olduğu için
          // ham gösterim neredeyse boş görünürdü
          if (!a) return 0;
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
          const text = item.fmt(v);
          if (item.el.textContent !== text) item.el.textContent = text;
        }
      }
      if (!alive) { clearInterval(timer); timer = 0; }
    }, 100);
  }

  window.SVAnalysisPanel = { panel };
})();
