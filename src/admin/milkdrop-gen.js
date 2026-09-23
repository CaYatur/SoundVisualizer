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

  // Üreticinin son sonucu; karışımınki `saveMix`
  function save() {
    return saveResult(last);
  }

  async function saveResult(r) {
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

  // --------------------------------------------------------------------
  // Kütüphaneden karışım (shared/milkdrop-mashup.js)
  // --------------------------------------------------------------------
  /* Parçalar MilkDrop panelinin listesinde GÖRÜNEN presetlerden çekiliyor
     (arama ve süzgeç burada da geçerli) ve yalnız o parçası olanlardan.
     Warp ve birleştirme bazen "yok" çıkıyor: kütüphanenin çoğu MilkDrop 2
     presetiyse her karışım iki shader alırdı ve görünümün sabit yolu
     (yankı, gama, bayraklar) hiç çalışmazdı.

     Geçmiş tarifleri tutuyor (parça -> preset kimliği), metni değil: ◀/▶
     karışımı aynı parçalardan yeniden kuruyor. Parçalarından biri silinmiş
     bir tarif atlanıyor, MilkDrop panelinin ◀/▶'ı gibi. */
  const X = () => window.SVMdMix;
  const NONE_CHANCE = 0.12;
  const SLOT_LABELS = {
    look: 'Görünüm', motion: 'Hareket', waves: 'Dalgalar', shapes: 'Şekiller', warp: 'Warp', comp: 'Birleştirme',
  };
  let mix = null;
  let mixLast = null;
  let mixHist = null;
  const mixRecipes = new Map();
  function mixHistory() {
    const C = window.SVMilkdropCycle;
    if (!mixHist && C && C.History) mixHist = new C.History(64);
    return mixHist;
  }
  const byId = (id) => (MP() && MP().presetById ? MP().presetById(id) : null);

  // Bir parçanın yeni presetini çeker; bulunamazsa null
  function draw(list, slot, avoid) {
    if ((slot === 'warp' || slot === 'comp') && avoid !== X().NONE && Math.random() < NONE_CHANCE) return X().NONE;
    const p = X().pick(list, slot, Math.random, avoid);
    if (p) return p.id;
    return slot === 'warp' || slot === 'comp' ? X().NONE : null;
  }

  /* Tarifi kurar ve yükler. `record` yeni bir karışım mı (geçmişe girer)
     yoksa geçmişte gezinme mi. Parçalarından biri artık yoksa false. */
  function showMix(recipe, record) {
    const donors = {};
    for (const s of X().SLOTS) {
      if (recipe[s] === X().NONE) { donors[s] = X().NONE; continue; }
      const p = byId(recipe[s]);
      if (!p || typeof p.source !== 'string') return false;
      donors[s] = p.source;
    }
    const nameOf = (id) => { const p = byId(id); return p ? tr(p.name || id) : id; };
    const r = {
      id: X().idOf(recipe), name: X().nameFor(recipe, nameOf, lang()),
      source: X().compose(donors), recipe: Object.assign({}, recipe),
    };
    mix = r.recipe;
    mixLast = r;
    if (record) {
      const key = X().recipeKey(recipe);
      mixRecipes.set(key, r.recipe);
      const h = mixHistory();
      if (h) h.note(key);
    }
    const panel = MP();
    if (!panel || !panel.preview || !panel.preview({ id: r.id, kind: 'milkdrop', name: r.name, source: r.source })) {
      P().toast(tr('MilkDrop paneli kullanılamıyor.'), 'err');
      P().rerender();
    }
    return true;
  }

  function mixList() {
    const panel = MP();
    const list = panel && panel.visibleList ? panel.visibleList() : [];
    if (!list.length) P().toast(tr('Listede preset yok.'), 'err');
    return list;
  }

  // Altı parçanın hepsi yeniden
  function rollAll() {
    if (!X()) return;
    const list = mixList();
    if (!list.length) return;
    const look = draw(list, 'look', null);
    if (!look) return;
    const recipe = { look };
    for (const s of X().SLOTS) {
      if (s === 'look') continue;
      const id = draw(list, s, null);
      // Parçası olan aday yoksa görünümün presetinden (belki boş) gelir
      recipe[s] = id === null ? look : id;
    }
    showMix(recipe, true);
  }

  // Tek parça yeniden; ötekiler yerinde
  function rollSlot(slot) {
    if (!X() || !mix) return;
    const list = mixList();
    if (!list.length) return;
    const id = draw(list, slot, mix[slot]);
    if (id === null) {
      P().toast(tr('Listede bu parçası olan başka preset yok.'), 'err');
      return;
    }
    showMix(Object.assign({}, mix, { [slot]: id }), true);
  }

  /* Ekrandaki presetten başlar: altı parçanın hepsi ondan, sonra tek tek
     değiştirilir. Ekrandaki listede olmalı — kaydedilmemiş bir önizleme ya
     da karışım parça veremez. */
  function fromScreen() {
    if (!X()) return;
    const panel = MP();
    const cfg = P().cfg();
    const id = panel && panel.liveId && cfg.milkdrop ? panel.liveId(cfg.milkdrop) : '';
    const p = id ? byId(id) : null;
    if (!p) {
      P().toast(tr('Önce MilkDrop listesinden bir preset seçin.'), 'err');
      return;
    }
    const recipe = {};
    for (const s of X().SLOTS) {
      recipe[s] = (s === 'warp' || s === 'comp') && !X().has(p.source, s) ? X().NONE : p.id;
    }
    showMix(recipe, true);
  }

  function mixNav(dir) {
    const h = mixHistory();
    if (!h) return;
    for (let key = dir < 0 ? h.back() : h.forward(); key; key = dir < 0 ? h.back() : h.forward()) {
      const recipe = mixRecipes.get(key);
      if (recipe && showMix(recipe, false)) return;
    }
    P().rerender();
  }

  function saveMix() {
    return saveResult(mixLast);
  }

  function mixSection() {
    const el = P().el;
    const nodes = [el('h4', { class: 'mdgen-sub', text: 'Kütüphaneden Karışım' })];
    const h = mixHistory();
    nodes.push(el('div', { class: 'gen-actions' }, [
      el('button', {
        class: 'btn primary', type: 'button', text: '🎲 Yeni Karışım',
        title: 'Her parçayı listede görünen presetlerden rastgele çeker',
        onclick: () => rollAll(),
      }),
      el('button', {
        class: 'btn', type: 'button', text: '📌 Ekrandakinden Başla',
        title: 'Altı parçanın hepsini ekrandaki presetten alır; sonra tek tek değiştirin',
        onclick: () => fromScreen(),
      }),
    ]));
    if (mix) {
      for (const s of X().SLOTS) {
        const id = mix[s];
        const p = id && id !== X().NONE ? byId(id) : null;
        nodes.push(el('div', { class: 'mdmix-row' }, [
          el('span', { class: 'mdmix-slot', text: SLOT_LABELS[s] }),
          // Presetin adı kendi adı; yerleşiklerin adı sözlükte
          el('span', { class: 'mdmix-name' + (p ? '' : ' dim-hint'), text: p ? tr(p.name || p.id) : (id === X().NONE ? 'Yok' : '—') }),
          el('button', {
            class: 'btn ghost small', type: 'button', text: '🎲',
            title: 'Bu parçayı yeniden çek', 'aria-label': tr('Bu parçayı yeniden çek'),
            onclick: () => rollSlot(s),
          }),
        ]));
      }
    }
    nodes.push(el('div', { class: 'gen-actions' }, [
      el('button', {
        class: 'btn', type: 'button', text: '◀', title: 'Önceki karışım',
        disabled: !(h && h.canBack()), onclick: () => mixNav(-1),
      }),
      el('button', {
        class: 'btn', type: 'button', text: '▶', title: 'Sonraki karışım',
        disabled: !(h && h.canForward()), onclick: () => mixNav(1),
      }),
      el('button', {
        class: 'btn', type: 'button', text: saving ? 'Kaydediliyor…' : '💾 Kütüphaneye Kaydet',
        disabled: !mixLast || saving,
        onclick: () => saveMix(),
      }),
    ]));
    if (mixLast) {
      const kept = inLibrary(mixLast.id);
      nodes.push(el('div', { class: 'studio-note' }, [
        el('div', { class: 'gen-pair' }, [
          el('span', { class: 'dim-hint', text: 'Son Karışım' }),
          el('span', { class: 'md-cur mdgen-name', text: mixLast.name }),
          el('span', { class: 'dim-hint', text: 'Durum' }),
          el('span', { class: kept ? 'md-ok' : 'dim-hint', text: kept ? '✓ Kütüphanede' : 'Önizleme — kaydedilmedi' }),
        ]),
      ]));
    }
    nodes.push(el('div', {
      class: 'studio-note dim-hint',
      text: 'Parçalar MilkDrop panelinin listesinde görünen presetlerden çekilir; arama ve süzgeç burada da geçerli. Her parça bütünüyle tek bir presetten gelir ve satırları olduğu gibi kopyalanır. Bir presetin shader\'ı başka bir presetin denklemlerine göre yazılmış olabilir, yani sonuç şaşırtabilir. Warp ve birleştirme bazen "yok" çıkar: o zaman görünümün kendi yankısı ve gaması çalışır. ◀ ▶ önceki karışımlara döner.',
    }));
    return nodes;
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
    if (X()) for (const n of mixSection()) nodes.push(n);
    return el('div', { class: 'mdgen-panel' }, nodes);
  }

  window.SVMdGenPanel = {
    panel, regenerate, save, fromCode, rollAll, rollSlot, fromScreen, mixNav, saveMix,
    state: () => ({ axes: Object.assign({}, axes), seed, last, mix: mix && Object.assign({}, mix), mixLast }),
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = window.SVMdGenPanel;
})();
