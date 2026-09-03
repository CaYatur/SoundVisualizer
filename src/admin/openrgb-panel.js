'use strict';
/* OpenRGB paneli.
 *
 * OpenRGB ayrı çalışan bir sunucu: kullanıcı onu kurar ve içinden SDK
 * sunucusunu açar. Bu yüzden panelin ilk işi, bağlanamadığında NEDENİNİ ve
 * ne yapılacağını söylemek — yoksa kapalı bir anahtar gibi görünür ve
 * kimse sebebini bulamaz.
 *
 * Görünüm ayarları (mod, yoğunluk) cfg.lighting ile ORTAKTIR. Windows'ta
 * aynı ayarlar Dynamic Lighting kartında da görünür; ikisi tek bir görünümü
 * düzenler. Ayrı olsalardı aynı masadaki iki aygıt iki farklı renk yakardı.
 */
(function () {
  const P = () => window.SVPanel;

  let watching = false;
  let state = { running: false, connected: false, devices: [], error: null };

  /* Mod listesi Dynamic Lighting kartıyla ORTAK — kendi kopyamı yazmıştım,
     iki liste zamanla ayrışır ve aynı mod iki kartta iki farklı adla
     görünürdü. Yalnızca sesi izleyen modlar gösterilir: statik modlarda
     OpenRGB'ye kare gönderilmez, yani listede olsalar ölü seçenek olurlardı. */
  function modes() {
    const all = (P().lightingModes && P().lightingModes()) || [];
    const dynamic = window.SVLightingRender && window.SVLightingRender.DYNAMIC_MODES;
    if (!dynamic) return all;
    return all.filter((m) => dynamic.has(m.value));
  }

  function panel() {
    const el = P().el;
    const cfg = P().cfg();
    const o = cfg.openrgb;
    const lighting = cfg.lighting || {};
    const nodes = [];

    if (!watching) {
      watching = true;
      window.api.onOpenRgbStatus((s) => { state = s; });
      window.api.openrgbStatus().then((s) => { state = s; }).catch(() => {});
    }

    const enable = el('input', {
      type: 'checkbox',
      onchange: async (e) => {
        o.enabled = e.target.checked;
        P().push(true);
        try { state = await window.api.openrgbSync(); } catch {}
        P().rerender();
      },
    });
    enable.checked = !!o.enabled;
    nodes.push(P().row('OpenRGB Çıkışı', el('label', { class: 'switch' }, [enable, el('span', { class: 'track' })])));

    // --- Durum. Sayılar ayrı düğümlerde: birleşik metin çevrilemez. ---
    const st = el('div', { class: 'studio-status ' + (state.connected ? 'ok' : state.error ? 'err' : '') });
    if (state.connected) {
      st.appendChild(el('span', { text: '✓ ' }));
      st.appendChild(el('span', { text: 'Bağlı' }));
      st.appendChild(el('span', { class: 'st-sep', text: ' · ' }));
      st.appendChild(el('span', { class: 'st-num', text: String(state.drivable || 0) + ' ' }));
      st.appendChild(el('span', { text: 'sürülebilir aygıt' }));
      if (state.devices && state.devices.length > (state.drivable || 0)) {
        st.appendChild(el('span', { class: 'st-sep', text: ' · ' }));
        st.appendChild(el('span', { class: 'st-num', text: String(state.devices.length - (state.drivable || 0)) + ' ' }));
        st.appendChild(el('span', { text: 'yalnız kendi efektini oynatıyor' }));
      }
    } else if (state.error) {
      st.appendChild(el('span', { text: '✕ ' }));
      st.appendChild(el('span', { text: 'Bağlanılamadı' }));
    } else if (o.enabled) {
      st.appendChild(el('span', { text: 'Bağlanılıyor…' }));
    } else {
      st.appendChild(el('span', { text: 'Kapalı' }));
    }
    nodes.push(st);

    /* Bağlanamama en olası durum ve tek başına bir hata mesajı hiçbir şey
       anlatmaz: kullanıcının OpenRGB'yi kurup SDK sunucusunu açması gerekir. */
    if (o.enabled && !state.connected) {
      nodes.push(el('div', {
        class: 'settings-io-note',
        text: 'OpenRGB çalışmıyor gibi. 1) OpenRGB uygulamasını kurun ve çalıştırın. 2) İçinde Settings > General > Enable SDK Server seçeneğini işaretleyin. 3) Sunucu portu burada yazandan farklıysa aşağıdan düzeltin.',
      }));
      nodes.push(el('a', {
        class: 'link-note',
        href: 'https://openrgb.org/',
        target: '_blank',
        rel: 'noreferrer',
        text: 'OpenRGB indirme sayfası',
      }));
    }

    /* Çerçeve TEK bir düğüm bekliyor: dizi döndürmek appendChild'i
       patlatır ve panel hiç çizilmez. */
    if (!o.enabled) return el('div', { class: 'orgb-panel' }, nodes);

    // --- Bağlantı ---
    nodes.push(P().row('Sunucu Adresi', el('input', {
      type: 'text',
      value: o.host || '127.0.0.1',
      onchange: (e) => { o.host = e.target.value.trim() || '127.0.0.1'; P().push(true); window.api.openrgbSync().catch(() => {}); },
    })));
    nodes.push(P().row('Port', el('input', {
      type: 'number', min: 1, max: 65535, value: o.port || 6742,
      onchange: (e) => { o.port = Number(e.target.value) || 6742; P().push(true); window.api.openrgbSync().catch(() => {}); },
    })));

    // --- Görünüm: cfg.lighting ile ORTAK ---
    nodes.push(el('div', {
      class: 'settings-io-note',
      text: 'Aşağıdaki görünüm ayarları Windows Dynamic Lighting ile ortaktır: iki çıkış da aynı rengi üretir.',
    }));
    const modeSel = el('select', {
      onchange: (e) => {
        cfg.lighting = cfg.lighting || {};
        cfg.lighting.mode = e.target.value;
        P().push(true);
      },
    });
    for (const m of modes()) {
      const opt = el('option', { value: m.value, text: m.label });
      if ((lighting.mode || 'visualizer-sync') === m.value) opt.selected = true;
      modeSel.appendChild(opt);
    }
    nodes.push(P().row('Işık Modu', modeSel));

    nodes.push(P().row('Parlaklık', el('input', {
      type: 'range', min: 0, max: 1, step: 0.02,
      value: o.brightness === undefined ? 1 : o.brightness,
      oninput: (e) => { o.brightness = Number(e.target.value); P().push(false); },
      onchange: () => P().push(true),
    })));
    nodes.push(P().row('Güncelleme Hızı', el('input', {
      type: 'range', min: 5, max: 60, step: 1, value: o.fps || 30,
      oninput: (e) => { o.fps = Number(e.target.value); P().push(false); },
      onchange: () => P().push(true),
    })));

    // --- Aygıtlar ---
    const rescan = el('button', { class: 'btn small', type: 'button', text: 'Aygıtları Yenile' });
    rescan.addEventListener('click', async () => {
      try { state = await window.api.openrgbRescan(); } catch {}
      P().rerender();
    });
    nodes.push(P().row('Aygıtlar', rescan));

    const list = el('div', { class: 'orgb-devices' });
    const devices = state.devices || [];
    if (!devices.length) {
      list.appendChild(el('div', { class: 'settings-io-note', text: 'Aygıt bulunamadı. OpenRGB içinde aygıtlarınız görünüyor mu?' }));
    }
    for (const d of devices) {
      const row = el('div', { class: 'orgb-device' + (d.drivable ? '' : ' dim') });
      const box = el('input', { type: 'checkbox' });
      /* Boş liste "hepsi" demek; kullanıcı ilk kez bir kutuyu kaldırdığında
         açık bir listeye dönüştürülür ki niyeti kaybolmasın. */
      const chosen = Array.isArray(o.devices) ? o.devices : [];
      box.checked = d.drivable && (chosen.length === 0 || chosen.indexOf(d.name) >= 0);
      box.disabled = !d.drivable;
      box.addEventListener('change', () => {
        let next = chosen.length ? chosen.slice() : devices.filter((x) => x.drivable).map((x) => x.name);
        next = box.checked ? next.concat([d.name]) : next.filter((n) => n !== d.name);
        o.devices = Array.from(new Set(next));
        P().push(true);
      });
      row.appendChild(el('label', { class: 'switch small' }, [box, el('span', { class: 'track' })]));
      row.appendChild(el('span', { class: 'orgb-name', text: d.name }));
      row.appendChild(el('span', { class: 'orgb-meta' }, [
        el('span', { class: 'st-num', text: String(d.leds) + ' ' }),
        el('span', { text: 'LED' }),
      ]));
      if (!d.drivable) {
        row.appendChild(el('span', { class: 'orgb-warn', text: 'anlık renk kabul etmiyor' }));
      }
      list.appendChild(row);
    }
    nodes.push(list);
    return el('div', { class: 'orgb-panel' }, nodes);
  }

  const api = { panel, modes };
  if (typeof window !== 'undefined') window.SVOpenRGBPanel = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})();
