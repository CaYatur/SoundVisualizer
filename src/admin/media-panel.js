'use strict';
/* Medya katmanı paneli — web kamerası veya video dosyası.

   Kamera listesi enumerateDevices ile alınır; etiketler ancak bir kez izin
   verildikten sonra dolu gelir, bu yüzden katman ilk kez açıldığında liste
   yeniden okunur. */
(function () {
  const P = () => window.SVPanel;
  let cameras = [];
  let started = false;

  async function refreshCameras() {
    if (!navigator.mediaDevices || !navigator.mediaDevices.enumerateDevices) return;
    try {
      const all = await navigator.mediaDevices.enumerateDevices();
      cameras = all.filter((d) => d.kind === 'videoinput').map((d) => ({ id: d.deviceId, label: d.label }));
    } catch { cameras = []; }
  }

  function panel() {
    const el = P().el;
    const cfg = P().cfg();
    const m = cfg.media;
    const nodes = [];

    const enable = el('input', {
      type: 'checkbox',
      onchange: async (e) => {
        m.enabled = e.target.checked;
        P().push(true);
        if (m.enabled) { await refreshCameras(); }
        P().rerender();
      },
    });
    enable.checked = !!m.enabled;
    nodes.push(P().row('Medya Katmanı', el('label', { class: 'switch' }, [enable, el('span', { class: 'track' })])));

    if (!m.enabled) {
      nodes.push(el('div', { class: 'studio-note', text: 'Kameranızı veya bir video dosyasını sahneye katman olarak koyar. Kaleydoskop, renk kayması ve sese bağlı yakınlaşma uygulanabilir; Studio shader\'larında sv_media (iChannel3) olarak da okunur.' }));
      return el('div', {}, nodes);
    }

    nodes.push(
      P().segment('Kaynak', 'media.source', [
        { value: 'webcam', label: '📷 Kamera' },
        { value: 'file', label: '🎞 Video Dosyası' },
      ], { rebuild: true })
    );

    if (m.source === 'webcam') {
      const sel = el('select', { onchange: (e) => { m.deviceId = e.target.value; P().push(true); } });
      const def = el('option', { value: '', text: 'Varsayılan kamera' });
      if (!m.deviceId) def.selected = true;
      sel.appendChild(def);
      cameras.forEach((c, i) => {
        const o = el('option', { value: c.id, text: c.label || 'Kamera ' + (i + 1) });
        if (m.deviceId === c.id) o.selected = true;
        sel.appendChild(o);
      });
      nodes.push(P().row('Kamera', sel));
      nodes.push(
        el('button', {
          class: 'btn ghost small', type: 'button', text: '🔄 Kameraları Yenile',
          onclick: async () => { await refreshCameras(); P().rerender(); },
        })
      );
    } else {
      nodes.push(
        el('div', { class: 'ctrl' }, [
          el('div', { class: 'row' }, [
            el('label', { class: 'lbl', text: 'Video Dosyası' }),
            el('span', { class: 'dim-hint', text: m.file ? (m.fileName || 'seçildi') : 'seçilmedi' }),
          ]),
          el('button', {
            class: 'btn small', type: 'button', text: '🎞 Video Seç',
            onclick: async () => {
              const r = await window.api.pickVideo();
              if (!r) return;
              m.file = r.url;
              m.fileName = r.name;
              P().push(true);
              P().rerender();
            },
          }),
        ])
      );
      const loop = el('input', { type: 'checkbox', onchange: (e) => { m.loop = e.target.checked; P().push(true); } });
      loop.checked = m.loop !== false;
      nodes.push(P().row('Döngüde Oynat', el('label', { class: 'switch' }, [loop, el('span', { class: 'track' })])));
    }

    nodes.push(
      P().segment('Katman', 'media.layer', [
        { value: 'back', label: 'Arkada' },
        { value: 'front', label: 'Önde' },
      ])
    );
    nodes.push(
      P().segment('Sığdırma', 'media.fit', [
        { value: 'cover', label: 'Doldur' },
        { value: 'contain', label: 'Sığdır' },
        { value: 'stretch', label: 'Ger' },
      ])
    );
    nodes.push(P().slider('Saydamlık', 'media.opacity', { min: 0, max: 1, step: 0.02, percent: true, noExtend: true }));
    nodes.push(
      P().segment('Karışım', 'media.blend', [
        { value: 'normal', label: 'Normal' },
        { value: 'screen', label: 'Ekran' },
        { value: 'add', label: 'Toplama' },
        { value: 'multiply', label: 'Çarpma' },
      ])
    );

    const mirror = el('input', { type: 'checkbox', onchange: (e) => { m.mirror = e.target.checked; P().push(true); } });
    mirror.checked = !!m.mirror;
    nodes.push(P().row('Aynala', el('label', { class: 'switch' }, [mirror, el('span', { class: 'track' })])));

    nodes.push(P().slider('Kaleydoskop Dilimi', 'media.kaleido', { min: 0, max: 12, step: 1, fmt: (v) => (v < 3 ? 'kapalı' : Math.round(v) + ' dilim') }));
    nodes.push(P().slider('Renk Kayması', 'media.hue', { min: 0, max: 1, step: 0.01, percent: true, noExtend: true }));
    nodes.push(P().slider('Doygunluk', 'media.saturate', { min: 0, max: 3, step: 0.05 }));
    nodes.push(P().slider('Bas → Yakınlaşma', 'media.audioZoom', { min: 0, max: 1, step: 0.01, percent: true }));
    nodes.push(P().slider('Bas → Saydamlık', 'media.audioOpacity', { min: 0, max: 1, step: 0.02, percent: true, noExtend: true }));

    return el('div', {}, nodes);
  }

  async function init() {
    if (started) return;
    started = true;
    await refreshCameras();
    if (navigator.mediaDevices && navigator.mediaDevices.addEventListener) {
      navigator.mediaDevices.addEventListener('devicechange', refreshCameras);
    }
  }

  window.SVMediaPanel = { panel, init };
})();
