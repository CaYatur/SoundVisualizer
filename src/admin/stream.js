'use strict';
/* Yayın çıkışı paneli — OBS tarayıcı kaynağı ve mobil uzaktan kumanda.

   Sunucunun kendisi ana süreçtedir (main/stream-server.js). Burada yalnızca
   ayarlar, adresler ve bağlı istemciler gösterilir. */
(function () {
  const P = () => window.SVPanel;
  let status = { running: false, port: 0, urls: {}, clients: [], error: null, lan: false };
  let started = false;

  const ERRORS = {
    PORT_IN_USE: 'Bu port başka bir uygulama tarafından kullanılıyor. Başka bir port deneyin.',
    EACCES: 'Bu portu açma izni yok. 1024 üstü bir port deneyin.',
    EADDRNOTAVAIL: 'Ağ adresi kullanılamıyor.',
  };

  async function sync() {
    status = await window.api.streamSync();
    P().rerender();
  }

  function copy(text, label) {
    navigator.clipboard.writeText(text).then(
      () => P().toast(label + ' kopyalandı.', 'ok'),
      () => P().toast('Kopyalanamadı.', 'err')
    );
  }

  function urlRow(label, url, hint) {
    const el = P().el;
    if (!url) return null;
    const field = el('input', { class: 'p-in wide url-field', type: 'text', value: url, readonly: 'readonly' });
    field.addEventListener('focus', () => field.select());
    return el('div', { class: 'ctrl' }, [
      el('div', { class: 'row' }, [
        el('label', { class: 'lbl', text: label }),
        el('span', { class: 'dim-hint', text: hint || '' }),
      ]),
      el('div', { class: 'url-row' }, [
        field,
        el('button', { class: 'btn small', type: 'button', text: '⧉ Kopyala', onclick: () => copy(url, label) }),
      ]),
    ]);
  }

  function panel() {
    const el = P().el;
    const cfg = P().cfg();
    const s = cfg.stream;
    const nodes = [];

    // --- açma/kapama ---
    const enable = el('input', {
      type: 'checkbox',
      onchange: async (e) => {
        s.enabled = e.target.checked;
        if (s.enabled && !s.token) s.token = await window.api.streamNewToken();
        P().push(true);
        await sync();
      },
    });
    enable.checked = !!s.enabled;
    nodes.push(P().row('Yayın Sunucusunu Aç', el('label', { class: 'switch' }, [enable, el('span', { class: 'track' })])));

    // --- durum ---
    // Parçalar ayrı düğümlerde: çeviri sözlüğü tam metin eşleştirdiği için
    // sayı içeren birleşik bir cümle hiçbir zaman çevrilemezdi.
    const statusBox = el('div', { class: 'studio-status ' + (status.running ? 'ok' : status.error ? 'err' : '') });
    if (status.running) {
      statusBox.appendChild(el('span', { text: '✓ ' }));
      statusBox.appendChild(el('span', { text: status.lan ? 'Ağa açık' : 'Yalnızca bu bilgisayar' }));
      statusBox.appendChild(el('span', { class: 'st-sep', text: ' · ' }));
      statusBox.appendChild(el('span', { text: 'Port' }));
      statusBox.appendChild(el('span', { class: 'st-num', text: ' ' + status.port }));
      statusBox.appendChild(el('span', { class: 'st-sep', text: ' · ' }));
      if (status.clients.length) {
        statusBox.appendChild(el('span', { class: 'st-num', text: status.clients.length + ' ' }));
        statusBox.appendChild(el('span', { text: 'bağlı istemci' }));
      } else {
        statusBox.appendChild(el('span', { text: 'istemci yok' }));
      }
    } else if (status.error) {
      statusBox.appendChild(el('span', { text: '✕ ' }));
      statusBox.appendChild(el('span', { text: ERRORS[status.error] || status.error }));
    } else {
      statusBox.appendChild(el('span', { text: 'Kapalı' }));
    }
    nodes.push(statusBox);

    if (s.enabled) {
      // --- adresler ---
      const u = status.urls || {};
      nodes.push(urlRow('OBS Tarayıcı Kaynağı', u.overlay, 'bu adresi OBS\'e yapıştırın'));
      if (s.remote) nodes.push(urlRow('Mobil Kumanda', u.remote, 'telefondan açın'));

      nodes.push(
        el('div', { class: 'obs-help' }, [
          el('div', { class: 'obs-help-title', text: 'OBS kurulumu' }),
          el('ol', {}, [
            el('li', { text: 'OBS → Kaynaklar → ＋ → Tarayıcı (Browser).' }),
            el('li', { text: 'URL alanına yukarıdaki adresi yapıştırın.' }),
            el('li', { text: 'Genişlik/Yükseklik: sahne çözünürlüğünüzle aynı (ör. 1920 × 1080).' }),
            el('li', { text: '“Kaynak görünür değilken kapat” seçeneğini KAPALI bırakın; yoksa sahne değişince yeniden bağlanır.' }),
            el('li', { text: 'Saydam arkaplan açıksa görselleştirici doğrudan üst katman olur; kapatırsanız arkaplan da yayına girer.' }),
          ]),
          el('div', { class: 'dim-hint', text: 'Adresin sonuna ?transparent=0 eklerseniz o kaynak arkaplanı da gösterir; ?fps=30 veya ?scale=0.75 ile o kaynağın yükünü ayrıca düşürebilirsiniz.' }),
        ])
      );

      // --- ayarlar ---
      nodes.push(
        P().row(
          'Port',
          el('input', {
            class: 'p-in p-num', type: 'number', min: '1024', max: '65535', value: s.port,
            onchange: async (e) => {
              s.port = Math.max(1024, Math.min(65535, parseInt(e.target.value, 10) || 8722));
              P().push(true);
              await sync();
            },
          })
        )
      );

      const transparent = el('input', {
        type: 'checkbox',
        onchange: (e) => { s.transparent = e.target.checked; P().push(true); },
      });
      transparent.checked = !!s.transparent;
      nodes.push(P().row('Saydam Arkaplan (üst katman)', el('label', { class: 'switch' }, [transparent, el('span', { class: 'track' })])));

      const remote = el('input', {
        type: 'checkbox',
        onchange: async (e) => { s.remote = e.target.checked; P().push(true); await sync(); },
      });
      remote.checked = !!s.remote;
      nodes.push(P().row('Mobil Uzaktan Kumanda', el('label', { class: 'switch' }, [remote, el('span', { class: 'track' })])));

      const lan = el('input', {
        type: 'checkbox',
        onchange: async (e) => {
          if (e.target.checked) {
            const ok = await P().confirm(
              'Yayın sayfası yerel ağdaki tüm cihazlara açılacak. Adres, tahmin edilmesi güç bir jeton içerir ve jeton olmadan hiçbir istek kabul edilmez. Genel/paylaşımlı bir ağdaysanız (kafe, otel, konferans) açmayın.',
              { okText: 'Ağa aç' }
            );
            if (!ok) { e.target.checked = false; return; }
            if (!s.token) s.token = await window.api.streamNewToken();
          }
          s.lan = e.target.checked;
          P().push(true);
          await sync();
        },
      });
      lan.checked = !!s.lan;
      nodes.push(P().row('Yerel Ağa Aç (telefon erişebilsin)', el('label', { class: 'switch' }, [lan, el('span', { class: 'track' })])));

      if (s.lan) {
        nodes.push(
          el('div', { class: 'ctrl' }, [
            el('div', { class: 'row' }, [
              el('label', { class: 'lbl', text: 'Erişim Jetonu' }),
              el('button', {
                class: 'btn ghost small', type: 'button', text: '⟳ Yenile',
                title: 'Yeni jeton üretir; eski adresler geçersiz olur',
                onclick: async () => {
                  s.token = await window.api.streamNewToken();
                  P().push(true);
                  await sync();
                },
              }),
            ]),
            el('input', { class: 'p-in wide', type: 'text', value: s.token || '', readonly: 'readonly' }),
          ])
        );
      }

      nodes.push(P().slider('Tarayıcı Kaynağı Kare Hızı', 'stream.overlayFps', { min: 24, max: 120, step: 1, fmt: (v) => Math.round(v) + ' FPS' }));
      nodes.push(P().slider('Tarayıcı Kaynağı Çözünürlük Ölçeği', 'stream.quality', { min: 0.4, max: 1, step: 0.05, percent: true, noExtend: true }));

      // --- bağlı istemciler ---
      if (status.clients && status.clients.length) {
        const list = el('div', { class: 'client-list' });
        status.clients.forEach((c) => {
          list.appendChild(
            el('div', { class: 'client-row' }, [
              el('span', { class: 'client-kind', text: c.kind === 'remote' ? '📱 Kumanda' : '📺 Katman' }),
              el('span', { class: 'client-addr', text: (c.address || '').replace('::ffff:', '') }),
            ])
          );
        });
        nodes.push(el('div', { class: 'studio-group', text: 'Bağlı İstemciler' }));
        nodes.push(list);
      }

      nodes.push(
        el('div', { class: 'studio-note' }, [
          el('span', { text: 'Yayın sayfası masaüstü penceresiyle aynı motoru çalıştırır; ayrı bir render yoktur, bu yüzden iki görüntü asla birbirinden ayrışmaz. NDI ve Spout çıkışı bu sürümde yok — OBS için tarayıcı kaynağı zaten aynı işi eklenti kurmadan görür.' }),
        ])
      );
    }

    return el('div', { class: 'stream-panel' }, nodes);
  }

  async function init() {
    if (started) return;
    started = true;
    window.api.onStreamStatus((s) => { status = s; });
    window.api.onStreamClients((clients) => {
      status.clients = clients;
      const host = document.querySelector('.client-list');
      if (host) P().rerender();
    });
    try { status = await window.api.streamStatus(); } catch { /* sunucu kapalı */ }
  }

  window.SVStream = { panel, init };
})();
