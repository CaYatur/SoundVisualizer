'use strict';
/* Basıklık (piksel en boy oranı) düzeltme paneli.
 *
 * Bildirdiği çözünürlükle fiziksel şekli uyuşmayan paneller için. Matematik
 * src/shared/aspect.js'te, testleri tests/aspect.test.js'te; burada yalnızca
 * kullanıcının o tek sayıya nasıl ulaşacağı var.
 *
 * TASARIMIN ÇIKIŞ NOKTASI
 * Bu paneli kullanacak kişi genelde ekranını ÖLÇEMEZ: sahnenin arkasındaki
 * LED duvarın fiziksel boyutunu kimse bilmiyor, teknik föyü de yok. Ama bir
 * dairenin yuvarlak olup olmadığını herkes görür. Bu yüzden asıl yol
 * kalibrasyon deseni + kaydırıcı; sayısal girişler yardımcıdır, tersi değil.
 *
 * Kaydırıcı LOGARİTMİK. Doğrusal olsaydı 0.25..4 aralığında "düzeltme yok"
 * (1.0) noktası %21'de kalırdı ve iki yön eşit hissedilmezdi. log2 ile 1.0
 * tam ortada durur, dikey ve yatay düzeltme simetrik olur.
 */
(function () {
  const P = () => window.SVPanel;
  const SP = () => window.SVScenePanels;
  const A = () => window.SVAspect;

  const PATTERN_LABELS = [
    ['none', 'Yok'],
    ['circle', 'Daire'],
    ['square', 'Kare'],
    ['grid', 'Izgara ve Daire'],
  ];

  const QUALITY_LABELS = [
    ['quality', 'Kalite — çözünürlük kaybı yok'],
    ['balanced', 'Dengeli — piksel sayısı değişmez'],
    ['performance', 'Performans — en az piksel'],
  ];

  let editTarget = null; // düzeltilen çıkış anahtarı
  let displays = [];

  // Sayısal yardımcıların geçici alanları (yapılandırmaya yazılmaz)
  const scratch = { physW: '', physH: '', arW: '', arH: '', srcW: '', srcH: '' };

  function rootOf(cfg) {
    const a = cfg.aspect || (cfg.aspect = window.SV.defaultConfig().aspect);
    a.outputs = a.outputs || {};
    return a;
  }

  function ensureOutput(cfg, key) {
    const root = rootOf(cfg);
    if (!root.outputs[key]) root.outputs[key] = A().defaultOutput();
    const o = root.outputs[key];
    // Eski ayar dosyalarından gelen eksik alanları tamamla
    const def = A().defaultOutput();
    for (const k of Object.keys(def)) if (o[k] == null) o[k] = def[k];
    o.enabled = true;
    return o;
  }

  /* Seçili çıkışın çerçeve boyutu — maliyet ve sonuç çözünürlüğünü gerçek
     rakamla gösterebilmek için. 'default' seçiliyken birincil ekran örnek
     alınır; hangi ekran olduğu yazıda söylenir ki kullanıcı tahmin etmesin. */
  function frameOf(cfg) {
    let d = null;
    if (editTarget && editTarget !== 'default') {
      d = displays.find((x) => String(x.id) === String(editTarget)) || null;
    }
    if (!d) d = displays.find((x) => x.isPrimary) || displays[0] || null;
    if (!d || !d.size) return { w: 1920, h: 1080, label: '', guess: true };
    const sf = d.scaleFactor || 1;
    const rs = Math.max(0.4, Math.min(1, (cfg.power && cfg.power.renderScale) || 1));
    return {
      w: Math.round(d.size.width * sf * rs),
      h: Math.round(d.size.height * sf * rs),
      label: d.label || '',
      guess: false,
    };
  }

  // Yön açıklaması: kullanıcı kaydırıcıyı hangi yöne çektiğini bilsin
  function directionText(par) {
    if (Math.abs(par - 1) < 0.005) return 'düzeltme yok';
    return par > 1 ? 'içerik dikey gerilir' : 'içerik yatay gerilir';
  }

  function numBox(key, placeholder, onEnter) {
    const el = P().el;
    return el('input', {
      class: 'p-in tiny',
      type: 'number',
      step: 'any',
      min: 0,
      placeholder,
      value: scratch[key],
      oninput: (e) => { scratch[key] = e.target.value; },
      onkeydown: (e) => { if (e.key === 'Enter') onEnter(); },
    });
  }

  function panel() {
    const el = P().el;
    const cfg = P().cfg();
    const root = rootOf(cfg);
    const rerender = () => P().apply();
    const nodes = [];

    nodes.push(SP().miniToggle('Basıklık Düzeltme Etkin',
      () => !!root.enabled, (v) => { root.enabled = v; }, rerender));

    if (!root.enabled) {
      nodes.push(el('div', {
        class: 'studio-note dim-hint',
        text: 'Düzeltme kapalı: görüntü ekrana olduğu gibi gider ve bu aşamanın ölçülebilir bir maliyeti yoktur.',
      }));
      return el('div', { class: 'map-panel' }, nodes);
    }

    // Hangi çıkış düzeltiliyor — haritalama panelindeki örüntünün aynısı
    const opts = [['default', 'Tüm Ekranlar (varsayılan)']];
    for (const d of displays) opts.push([String(d.id), d.label || ('Ekran ' + d.id)]);
    if (!editTarget || !opts.some((o) => o[0] === editTarget)) editTarget = 'default';
    nodes.push(SP().miniSelect('Düzeltilen Çıkış', opts,
      () => editTarget, (v) => { editTarget = v; }, rerender));

    const out = ensureOutput(cfg, editTarget);

    /* ÖNEMLİ UYARI, ve yeri kasıtlı olarak burası — kalibrasyona başlamadan
       önce görülmeli.

       Basıklığı olan kullanıcının bulduğu ilk çare, görseli başka bir
       programda gerip öyle yüklemek oluyor. O dosyalar telafiyi ZATEN
       içeriyor. Düzeltme açılınca bir kez daha düzeltilirler ve ters yöne,
       aynı oranda bozulurlar; kullanıcı da başladığı yerden daha kötü bir
       sahneyle kalır. Panelin "tek ayarla hepsi düzelir" sözü yeni içerik
       için doğru, elle onarılmış dosyalar için değil. */
    nodes.push(el('div', {
      class: 'studio-note',
      text: 'Önce elle gerdiğiniz görselleri özgün hâlleriyle değiştirin. O dosyalar telafiyi zaten içerdiği için bir kez daha düzeltilir ve ters yöne bozulur.',
    }));

    // ---------------------------------------------------------- kalibrasyon
    nodes.push(el('div', { class: 'studio-note', text: 'Deseni açın ve düzeltilen ekrana bakın; daire yuvarlak görünene kadar kaydırıcıyı oynatın. Ölçü almanız gerekmez.' }));

    nodes.push(SP().miniSelect('Kalibrasyon Deseni', PATTERN_LABELS,
      () => out.pattern || 'none', (v) => { out.pattern = v; }, rerender));

    /* Asıl denetim. Kaydırıcı log2(PAR) taşır; okunan değer PAR'ın kendisi. */
    const parLabel = el('span', { class: 'val' });
    const setParLabel = () => {
      const p = out.par;
      parLabel.textContent = p.toFixed(3) + '  (' + A().ratioText(p) + ')  ·  '
        + window.SVI18n.t(directionText(p));
    };
    const slider = el('input', {
      type: 'range',
      min: Math.log2(A().MIN_PAR),
      max: Math.log2(A().MAX_PAR),
      step: 0.002,
      value: Math.log2(out.par || 1),
      oninput: (e) => {
        out.par = Math.pow(2, parseFloat(e.target.value));
        setParLabel();
        P().push(false);
      },
    });
    setParLabel();
    nodes.push(el('div', { class: 'ctrl' }, [
      el('div', { class: 'row' }, [
        el('label', { class: 'lbl', text: 'Piksel Oranı' }), parLabel,
      ]),
      slider,
    ]));

    /* İnce ayar. Kaydırıcıyla son %1'i yakalamak zor; sahada bu düğmeler
       fare sürüklemekten hızlı. */
    const nudge = (mul) => {
      out.par = Math.max(A().MIN_PAR, Math.min(A().MAX_PAR, out.par * mul));
      rerender();
    };
    nodes.push(el('div', { class: 'row' }, [
      el('button', { class: 'btn ghost tiny', type: 'button', text: '− İnce', onclick: () => nudge(1 / 1.005) }),
      el('button', { class: 'btn ghost tiny', type: 'button', text: '+ İnce', onclick: () => nudge(1.005) }),
      el('button', {
        class: 'btn ghost tiny', type: 'button', text: 'Sıfırla',
        onclick: () => { out.par = 1; rerender(); },
      }),
    ]));

    // ------------------------------------------------------ çözünürlük bütçesi
    nodes.push(SP().miniSelect('Çözünürlük Bütçesi', QUALITY_LABELS,
      () => out.quality || A().DEFAULT_QUALITY, (v) => { out.quality = v; }, rerender));

    const fr = frameOf(cfg);
    const r = A().renderSize(fr.w, fr.h, out);
    /* Maliyet satırı sabit kalıplı, sayıları değişken: sözlükte kalıp olarak
       çevriliyor (bkz. i18n.js). Ekran adı AYRI düğümde duruyor — kalıba
       katılsaydı desen çapalanamaz ve çeviri kaçardı; ad zaten ana süreçte
       yerelleştirilmiş geliyor. */
    if (!fr.guess && fr.label) {
      nodes.push(el('div', { class: 'studio-note dim-hint', text: fr.label }));
    }
    const costLine = 'ekran ' + fr.w + '×' + fr.h
      + ' · çizim ' + r.w + '×' + r.h
      + ' · ' + r.pixelRatio.toFixed(2) + ' kat piksel';
    nodes.push(el('div', { class: 'studio-note dim-hint', text: costLine }));
    if (r.capped) {
      nodes.push(el('div', {
        class: 'studio-note',
        text: 'Piksel tavanına ulaşıldı: düzeltme doğru kalır ama görüntü bir miktar yumuşar. Çözünürlük bütçesini düşürmek burada kayıp getirmez.',
      }));
    }

    // ------------------------------------------------------ sayısal girişler
    nodes.push(el('div', {
      class: 'studio-note dim-hint',
      text: 'Ölçüyü biliyorsanız doğrudan girebilirsiniz; kaydırıcıya dokunmanız gerekmez.',
    }));

    const applyPar = (v) => { out.par = v; rerender(); };

    // 1) Panelin fiziksel ölçüsü
    nodes.push(el('div', { class: 'map-num' }, [
      el('span', { class: 'map-num-lbl', text: 'Panel Ölçüsü (en × boy)' }),
      numBox('physW', 'genişlik', () => {}),
      numBox('physH', 'yükseklik', () => {}),
      el('button', {
        class: 'btn ghost tiny', type: 'button', text: 'Uygula',
        onclick: () => applyPar(A().parFromPhysical(fr.w, fr.h, scratch.physW, scratch.physH)),
      }),
    ]));

    // 2) Panelin gerçek en boy oranı
    nodes.push(el('div', { class: 'map-num' }, [
      el('span', { class: 'map-num-lbl', text: 'Gerçek En Boy Oranı' }),
      numBox('arW', '21', () => {}),
      numBox('arH', '9', () => {}),
      el('button', {
        class: 'btn ghost tiny', type: 'button', text: 'Uygula',
        onclick: () => applyPar(A().parFromAspect(fr.w, fr.h, scratch.arW, scratch.arH)),
      }),
    ]));

    /* 3) Kullanıcının kendi çözümünden. Basıklığı olan çoğu kişi çareyi bir
       görseli başka programda gerip yüklemekte buluyor; o dosya PAR'ı zaten
       ölçmüş oluyor. Elde hazır bir cevap varken yeniden ölçtürmek gereksiz.

       Bu alanın hemen ardından gelen uyarı şart: buraya ölçüyü giren kişi
       elinde gerilmiş bir dosya olduğunu söylemiş oluyor, yani düzeltme
       açılınca çifte telafiye düşecek olan tam olarak o kişi. */
    nodes.push(el('div', { class: 'map-num' }, [
      el('span', { class: 'map-num-lbl', text: 'Elle Gerdiğiniz Görselin Ölçüsü' }),
      numBox('srcW', 'genişlik', () => {}),
      numBox('srcH', 'yükseklik', () => {}),
      el('button', {
        class: 'btn ghost tiny', type: 'button', text: 'Uygula',
        onclick: () => applyPar(A().parFromStretchedSource(scratch.srcW, scratch.srcH)),
      }),
    ]));
    nodes.push(el('div', {
      class: 'studio-note dim-hint',
      text: 'Ölçüyü aldıktan sonra o görseli özgün hâliyle değiştirmeyi unutmayın.',
    }));

    nodes.push(el('div', {
      class: 'studio-note dim-hint',
      text: 'Düzeltme yalnızca bu ekrandaki görselleştirici penceresine uygulanır. Dışa aktarılan video, yayın ve web kaplaması düzeltilmez: onlar başka ekranlarda izlenir ve orada düzeltme bozukluk olurdu.',
    }));

    return el('div', { class: 'map-panel' }, nodes);
  }

  function init() {
    if (!window.api || !window.api.getDisplays) return;
    window.api.getDisplays().then((list) => { displays = list || []; }).catch(() => {});
  }

  window.SVAspectPanel = { panel, init };
})();
