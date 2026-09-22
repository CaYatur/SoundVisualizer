'use strict';
/* MİLKDROP PRESET ÜRETİCİ — arayüz (#579). Üretici: shared/milkdrop-generator.js.

   Dört kaydırıcı, bir kod alanı ve üç düğme. Kaydırıcı bırakılınca AYNI
   TOHUMLA yeniden üretilip yükleniyor: tohum sabit kaldığı için kaydırıcı
   başka bir preset değil, aynı presetin daha enerjik ya da daha sıcak
   hâlini veriyor. Sürüklerken değil bırakınca, çünkü her yükleme bir
   yapılandırma gönderip geçişi baştan başlatıyor.

   ÖNİZLEME KAYDEDİLMİYOR. Üretilen preset MilkDrop panelinin elle seçim
   yolundan yükleniyor (`SVMilkdropPanel.preview`): katman yığını MilkDrop'a
   dönüyor, geçmişe giriyor, bütün pencereler görüyor. Kimliği listede
   olmadığı için puan, favori ve etiket kapalı; kaydedilince aynı kimlikle
   açılıyorlar.

   "Kütüphaneye Kaydet" ÜRETİCİNİN SON SONUCUNU yazıyor, ekrandakini değil:
   otomatik geçiş o arada başka bir presete geçmiş olabilir. Kimlik koddan
   geldiği için aynı preseti iki kez kaydetmek ikinci bir kopya bırakmıyor.

   Durum modülde, ayarlarda değil (Sahne Üretici gibi): kaydırıcıların
   konumu bir sahnenin parçası değil. */
(function () {
  const P = () => window.SVPanel;
  const G = () => window.SVMdGen;
  const MP = () => window.SVMilkdropPanel;
  const tr = (s) => (window.SVI18n && window.SVI18n.t ? window.SVI18n.t(s) : s);
  const lang = () => (window.SVI18n && window.SVI18n.locale === 'en' ? 'en' : 'tr');

  const axes = { energy: 50, warmth: 50, density: 50, motion: 50 };
  let seed = null;
  let last = null;
  let saving = false;

  // Eksen, etiket ve iki ucun adı
  const AXIS_ROWS = [
    ['energy', 'Enerji', 'sakin', 'coşkun'],
    ['warmth', 'Sıcaklık', 'soğuk', 'sıcak'],
    ['density', 'Yoğunluk', 'seyrek', 'yoğun'],
    ['motion', 'Hareket', 'yavaş', 'hızlı'],
  ];
  const MOTION_LABELS = {
    tunel: 'Tünel', girdap: 'Girdap', halka: 'Halkalar', akinti: 'Akıntı', cicek: 'Çiçek', nefes: 'Nefes',
  };
  const SHADER_LABELS = { yok: 'Yok', comp: 'Birleştirme', warp: 'Warp', ikisi: 'Warp ve birleştirme' };

  function make() {
    if (seed === null) seed = G().randomSeed();
    last = G().generate({ axes, seed, lang: lang() });
    return last;
  }

  // Üretir ve yükler; MilkDrop paneli yoksa (yükleme hatası) söylüyor
  function regenerate() {
    if (!G()) return;
    const r = make();
    const panel = MP();
    if (!panel || !panel.preview || !panel.preview({ id: r.id, kind: 'milkdrop', name: r.name, source: r.source })) {
      P().toast(tr('MilkDrop paneli kullanılamıyor.'), 'err');
      P().rerender();
    }
  }

  function fromCode(text) {
    const d = G() && G().decode(text);
    if (!d) {
      P().toast(tr('Kod okunamadı. Biçim: enerji-sıcaklık-yoğunluk-hareket-tohum'), 'err');
      return;
    }
    Object.assign(axes, d.axes);
    seed = d.seed;
    regenerate();
  }

  const inLibrary = (id) => {
    const S = window.SVPresets;
    return !!(S && typeof S.user === 'function' && S.user().some((p) => p && p.id === id));
  };

  async function save() {
    const r = last;
    if (!r || saving) return;
    if (!window.api || !window.api.savePreset) {
      P().toast(tr('Kaydetme kullanılamıyor.'), 'err');
      return;
    }
    saving = true;
    P().rerender();
    let res = null;
    try {
      /* Yazar alanı yazar süzgecinde üretilenleri bir arada tutuyor; kayıt
         anındaki arayüz dilinde, çünkü adı da o dilde. */
      res = await window.api.savePreset({
        id: r.id, kind: 'milkdrop', name: r.name, source: r.source, author: tr('Üretici'),
      });
    } catch (e) {
      res = null;
    }
    saving = false;
    if (res && res.ok) {
      const panel = MP();
      if (panel && panel.adopt) panel.adopt(res.preset);
      else P().rerender();
      P().toast(tr('Preset kütüphaneye kaydedildi.'), 'ok');
    } else {
      P().rerender();
      P().toast(tr('Kaydedilemedi.'), 'err');
    }
  }

  function axisRow(key, label, lo, hi) {
    const el = P().el;
    const val = el('span', { class: 'val', text: String(axes[key]) });
    const input = el('input', {
      type: 'range', min: 0, max: 100, step: 1, value: axes[key],
      'aria-label': tr(label),
      oninput: (e) => { val.textContent = e.target.value; },
      onchange: (e) => {
        axes[key] = Math.max(0, Math.min(100, Math.round(Number(e.target.value)) || 0));
        regenerate();
      },
    });
    return el('div', { class: 'ctrl' }, [
      el('div', { class: 'row' }, [el('label', { class: 'lbl', text: label }), val]),
      input,
      el('div', { class: 'mdgen-ends dim-hint' }, [el('span', { text: lo }), el('span', { text: hi })]),
    ]);
  }

  function panel() {
    const el = P().el;
    const nodes = [];
    if (!G()) {
      nodes.push(el('div', { class: 'studio-note md-err', text: 'Üretici yüklenemedi.' }));
      return el('div', {}, nodes);
    }
    for (const [key, label, lo, hi] of AXIS_ROWS) nodes.push(axisRow(key, label, lo, hi));

    const codeIn = el('input', {
      class: 'p-in', type: 'text', value: last ? last.code : '',
      placeholder: tr('ör. 50-50-50-50-k3x9ab'), spellcheck: 'false', 'aria-label': tr('Kod'),
      // Enter da değişikliği bildiriyor; ikinci bir tuş dinleyicisi çift üretirdi
      onchange: (e) => fromCode(e.target.value),
    });
    nodes.push(P().row('Kod', codeIn));

    nodes.push(el('div', { class: 'gen-actions' }, [
      el('button', {
        class: 'btn primary', type: 'button', text: '✨ Preset Üret',
        title: 'Kaydırıcılardaki eksenlerle üretir ve yükler',
        onclick: () => regenerate(),
      }),
      el('button', {
        class: 'btn', type: 'button', text: '🎲 Karıştır',
        title: 'Aynı eksenler, başka bir tohum',
        onclick: () => { seed = G().randomSeed(); regenerate(); },
      }),
      el('button', {
        class: 'btn', type: 'button', text: saving ? 'Kaydediliyor…' : '💾 Kütüphaneye Kaydet',
        disabled: !last || saving,
        onclick: () => save(),
      }),
    ]));

    if (last) {
      const kept = inLibrary(last.id);
      // Etiket ve değer ayrı düğümlerde: çeviri sözlüğü tam metin eşliyor
      const chip = (k, v) => el('span', { class: 'gen-chip' }, [el('b', { text: k }), el('i', { text: v })]);
      const chips = el('div', { class: 'gen-chips' }, [
        chip('Hareket', MOTION_LABELS[last.parts.motion] || last.parts.motion),
        chip('Dalgalar', String(last.parts.waves.length)),
        chip('Şekiller', String(last.parts.shapes.length)),
        chip('Shader', SHADER_LABELS[last.parts.shader] || last.parts.shader),
      ]);
      nodes.push(el('div', { class: 'studio-note' }, [
        el('div', { class: 'gen-pair' }, [
          el('span', { class: 'dim-hint', text: 'Son Üretilen' }),
          // Presetin adı onun kendi adı, arayüz metni değil (üretildiği dilde)
          el('span', { class: 'md-cur mdgen-name', text: last.name }),
          el('span', { class: 'dim-hint', text: 'Durum' }),
          el('span', { class: kept ? 'md-ok' : 'dim-hint', text: kept ? '✓ Kütüphanede' : 'Önizleme — kaydedilmedi' }),
        ]),
        chips,
      ]));
    }

    nodes.push(el('div', {
      class: 'studio-note dim-hint',
      text: 'Tamamen bu bilgisayarda çalışır, hiçbir servise bağlanmaz. Kaydırıcıyı bırakınca aynı tohumla yeniden üretilir; 🎲 başka bir tohum dener. Kod eksenleri ve tohumu taşır: aynı kod her zaman aynı preseti verir. Önizleme kütüphaneye yazılmaz; puan, favori ve etiket kaydettikten sonra açılır. Hareket, dalga, şekil ve shader kalıpları bu uygulamada yazıldı, hiçbir preset paketinden alınmadı.',
    }));
    return el('div', { class: 'mdgen-panel' }, nodes);
  }

  window.SVMdGenPanel = { panel, regenerate, save, fromCode, state: () => ({ axes: Object.assign({}, axes), seed, last }) };
  if (typeof module !== 'undefined' && module.exports) module.exports = window.SVMdGenPanel;
})();
