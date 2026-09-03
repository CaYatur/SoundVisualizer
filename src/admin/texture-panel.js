'use strict';
/* Spout / Syphon paneli.
 *
 * Protokolün adı platforma göre değişiyor (Windows'ta Spout, macOS'ta
 * Syphon) ve kullanıcı hangisini aradığını bilmeli: alıcı uygulamada
 * arayacağı menü öğesinin adı bu.
 *
 * Linux'ta özellik YOK. Ama kartı tümden gizlemiyoruz: burada gizlemek
 * kullanıcıyı olmayan bir ayarı aramaya bırakır. Onun yerine neden
 * olmadığı ve yerine ne kullanılacağı yazılı — Dynamic Lighting'den farkı
 * bu, orada gidilecek bir yer yoktu.
 */
(function () {
  const P = () => window.SVPanel;

  let watching = false;
  let state = { running: false, supported: null, protocol: '', frames: 0, dropped: 0, error: null, reason: null };
  let senders = [];

  function protocolName() {
    if (state.protocol === 'syphon') return 'Syphon';
    if (state.protocol === 'spout') return 'Spout';
    const p = window.SV_PLATFORM || {};
    if (p.isMac) return 'Syphon';
    if (p.isWindows) return 'Spout';
    return 'Spout / Syphon';
  }

  function panel() {
    const el = P().el;
    const cfg = P().cfg();
    const t = cfg.textureShare;
    const nodes = [];

    if (!watching) {
      watching = true;
      window.api.onTextureStatus((s) => { state = s; });
      window.api.textureStatus().then((s) => { state = s; }).catch(() => {});
    }

    /* Bu platformda hiç yoksa: sebebini ve alternatifini söyle, bitir. */
    if (state.supported === false) {
      nodes.push(el('div', {
        class: 'settings-io-note',
        text: 'Spout bir Windows, Syphon bir macOS teknolojisidir; bu sistemde ikisi de yok ve yerleşik bir eşdeğeri bulunmuyor. Görüntüyü başka bir uygulamaya vermek için Çıkış bölümündeki OBS tarayıcı kaynağını kullanın — o her platformda çalışır.',
      }));
      return el('div', { class: 'texture-panel' }, nodes);
    }

    const enable = el('input', {
      type: 'checkbox',
      onchange: async (e) => {
        t.enabled = e.target.checked;
        P().push(true);
        try { state = await window.api.textureSync(); } catch {}
        P().rerender();
      },
    });
    enable.checked = !!t.enabled;
    nodes.push(P().row(protocolName() + ' Çıkışı', el('label', { class: 'switch' }, [enable, el('span', { class: 'track' })])));

    // --- Durum. Sayılar ayrı düğümlerde: birleşik metin çevrilemez. ---
    const st = el('div', { class: 'studio-status ' + (state.running && !state.error ? 'ok' : state.error ? 'err' : '') });
    if (state.running && !state.error) {
      st.appendChild(el('span', { text: '✓ ' }));
      st.appendChild(el('span', { text: 'Yayında' }));
      st.appendChild(el('span', { class: 'st-sep', text: ' · ' }));
      st.appendChild(el('span', { class: 'st-num', text: state.width + '×' + state.height }));
      st.appendChild(el('span', { class: 'st-sep', text: ' · ' }));
      st.appendChild(el('span', { class: 'st-num', text: String(state.frames || 0) + ' ' }));
      st.appendChild(el('span', { text: 'kare' }));
      if (state.dropped) {
        st.appendChild(el('span', { class: 'st-sep', text: ' · ' }));
        st.appendChild(el('span', { class: 'st-num', text: String(state.dropped) + ' ' }));
        st.appendChild(el('span', { text: 'düşen' }));
      }
    } else if (state.error) {
      st.appendChild(el('span', { text: '✕ ' }));
      st.appendChild(el('span', { text: 'Hata' }));
    } else {
      st.appendChild(el('span', { text: 'Kapalı' }));
    }
    nodes.push(st);

    if (!t.enabled) {
      nodes.push(el('div', {
        class: 'settings-io-note',
        text: 'Açıldığında görüntü, aynı bilgisayardaki alıcı uygulamalara GPU üzerinden verilir: Resolume, OBS, TouchDesigner veya başka bir alıcı. Pencere yakalamaya, eklenti kurmaya ve CPU kopyasına gerek yok.',
      }));
      return el('div', { class: 'texture-panel' }, nodes);
    }

    /* Kaynak adı: alıcı uygulamada BU ad görünecek. */
    nodes.push(P().row('Kaynak Adı', el('input', {
      type: 'text',
      value: t.name || 'CAYADEV Visualizer',
      onchange: (e) => {
        t.name = e.target.value.trim() || 'CAYADEV Visualizer';
        P().push(true);
        window.api.textureSync().catch(() => {});
      },
    })));

    const sizes = [[1280, 720], [1920, 1080], [2560, 1440], [3840, 2160]];
    const sizeSel = el('select', {
      onchange: (e) => {
        const [w, h] = e.target.value.split('x').map(Number);
        t.width = w;
        t.height = h;
        P().push(true);
        window.api.textureSync().catch(() => {});
      },
    });
    for (const [w, h] of sizes) {
      const v = w + 'x' + h;
      const opt = el('option', { value: v, text: v });
      if (Number(t.width) === w && Number(t.height) === h) opt.selected = true;
      sizeSel.appendChild(opt);
    }
    nodes.push(P().row('Çözünürlük', sizeSel));

    nodes.push(P().row('Kare Hızı', el('input', {
      type: 'range', min: 10, max: 60, step: 1, value: t.fps || 60,
      oninput: (e) => { t.fps = Number(e.target.value); P().push(false); },
      onchange: () => { P().push(true); window.api.textureSync().catch(() => {}); },
    })));

    /* Aynı makinedeki kaynaklar: kullanıcının kendi göndericisini alıcı
       tarafta göremediğinde ilk sorduğu şey "gerçekten yayında mı?" */
    const refresh = el('button', { class: 'btn small', type: 'button', text: 'Kaynakları Listele' });
    refresh.addEventListener('click', async () => {
      try { senders = await window.api.textureSenders(); } catch { senders = []; }
      try { state = await window.api.textureStatus(); } catch {}
      P().rerender();
    });
    nodes.push(P().row('Bu Makinedeki Kaynaklar', refresh));

    if (senders.length) {
      const list = el('div', { class: 'orgb-devices' });
      for (const s of senders) {
        const mine = s.name === (t.name || 'CAYADEV Visualizer');
        const row = el('div', { class: 'orgb-device' });
        row.appendChild(el('span', { class: 'orgb-name', text: s.name }));
        if (mine) row.appendChild(el('span', { class: 'orgb-meta', text: 'bu uygulama' }));
        list.appendChild(row);
      }
      nodes.push(list);
    }

    nodes.push(el('div', {
      class: 'settings-io-note',
      text: 'Alıcı uygulamada yukarıdaki kaynak adını seçin. Görüntü, ana ekranınızın yapılandırmasıyla üretilir; ekranlarda pencere açık olmasa bile yayın sürer.',
    }));

    return el('div', { class: 'texture-panel' }, nodes);
  }

  const api = { panel, protocolName };
  if (typeof window !== 'undefined') window.SVTexturePanel = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})();
