'use strict';
/* MilkDrop preset paneli.

   Presetler ayar dosyasında değil, Studio presetleriyle aynı depoda
   (userData/presets) tutulur: bir `.milk` dosyası onlarca kilobayt olabiliyor
   ve settings.json her kaydırıcı hareketinde baştan yazılıyor.

   Panelin asıl işi paketleri içeri almak. MilkDrop preset paketleri yüzlerce
   dosyadan oluşur; tek tek eklemek kullanılmaz olurdu, o yüzden çoklu seçim
   destekleniyor ve derleme hataları içe aktarma sırasında toplanıp
   gösteriliyor — bozuk bir preset sessizce boş ekran vermemeli. */
(function () {
  const P = () => window.SVPanel;
  const SP = () => window.SVScenePanels;

  let loaded = false;
  let loading = false;
  let presets = [];
  let filter = '';
  let busy = '';
  let listScroll = 0;
  /* Doku klasöründe kaç görsel bulunduğu. null = henüz sorulmadı.
     Yol tek başına yeterli değil: kullanıcı klasörü doğru seçip yanlış
     klasörü göstermiş olabilir ve sayı bunu anında ele veriyor. */
  let texCount = null;
  let texAsked = false;

  /* YERLEŞİKLER DEPODA DEĞİL, KODDA (shared/presets-milkdrop.js). Depoya
     kopyalansalardı kullanıcı silebilir, sürüm yükseltmesi ikinci bir kopya
     bırakabilirdi. Liste burada birleşiyor: önce yerleşikler, sonra
     kullanıcının kendi paketleri. */
  function builtins() {
    const L = window.SVMilkdropBuiltins;
    return Array.isArray(L) ? L : [];
  }

  /* Preset ADI da çeviriden geçiyor: yerleşiklerin adları i18n'de kayıtlı,
     yani İngilizce arayüzde İngilizce görünüyorlar. Kullanıcının kendi
     paketindeki ad sözlükte olmadığı için olduğu gibi dönüyor — bir presetin
     adı onun kendi adı, arayüz metni değil. */
  const tr = (s) => (window.SVI18n && window.SVI18n.t ? window.SVI18n.t(s) : s);

  /* Panel liste gelmeden çizildiyse, liste gelince yeniden çizilmeli.
     Açılışta `init` listeyi callback'siz istiyor; panel o istek sürerken
     çizilirse (`loading` doğru olduğu için) ikinci bir istek de yapmıyordu,
     yani liste, ◀/▶ ve kilit bir sonraki ayar değişikliğine kadar hiç
     görünmüyordu. Yalıtılmış bir kopyada yeniden üretildi: uygulama açılır
     açılmaz Sahne sekmesine geçince panel yalnız içe aktarma düğmeleriyle
     çizildi. */
  let staleRender = false;

  function refresh(cb) {
    if (!window.api || !window.api.listPresets || loading) return;
    loading = true;
    const done = () => {
      if (cb) cb();
      else if (staleRender) { staleRender = false; P().rerender(); }
    };
    window.api.listPresets().then((list) => {
      loading = false;
      loaded = true;
      const mine = (list || []).filter((p) => p.kind === 'milkdrop');
      presets = builtins().concat(mine);
      done();
    }).catch(() => {
      loading = false;
      loaded = true;
      presets = builtins();
      done();
    });
  }

  function visible() {
    const f = filter.trim().toLowerCase();
    if (!f) return presets;
    return presets.filter((p) => (p.name || '').toLowerCase().includes(f));
  }

  /* Katman yığını AÇIKKEN sahneyi cfg.visualizer.type belirlemiyor:
     layers.js'teki resolve() liste doluysa yalnız cfg.layers'a bakıyor.
     Bu yüzden panelden preset seçmek hiçbir şeyi değiştirmiyordu — kullanıcı
     tıklıyor, sahne aynı kalıyordu (#560, madde 8).

     Yığının anlamını bozmadan çözüm: görselleştirici katmanını MilkDrop'a
     çevirmek. Katmanların geri kalanı (arkaplan, metin, görseller) olduğu
     gibi kalıyor; yalnız hangi motorun çizdiği değişiyor. Böyle bir katman
     yoksa bir tane ekleniyor, çünkü seçimin görünür olması gerekiyor.

     Metin ve "şimdi çalan" katmanları da kind='visualizer' taşıyor ama
     görselleştirici değiller; onları çevirmek kullanıcının yazısını
     silerdi. */
  const OVERLAY_TYPES = ['text', 'nowplaying'];

  function pointStackAtMilkdrop(cfg) {
    const L = window.SVLayers;
    if (!L || !L.stackOn || !L.stackOn(cfg)) return;
    if (!Array.isArray(cfg.layers) || !cfg.layers.length) return;
    const vis = cfg.layers.filter(
      (l) => l && l.kind === 'visualizer' && OVERLAY_TYPES.indexOf(l.type) < 0);
    if (vis.length) {
      /* Birden çok görselleştirici katmanı varsa yalnız ilki çevriliyor:
         hepsini çevirmek kullanıcının kurduğu kompozisyonu tek tıkla yok
         ederdi. */
      vis[0].type = 'milkdrop';
      if (vis[0].settings && vis[0].settings.visualizer) {
        vis[0].settings.visualizer.type = 'milkdrop';
      }
      vis[0].enabled = true;
      vis[0].muted = false;
      return;
    }
    cfg.layers.push({
      id: 'ly_vis_md', name: 'MilkDrop', kind: 'visualizer', type: 'milkdrop',
      enabled: true, settings: {},
    });
  }

  function load(cfg, p) {
    cfg.milkdrop = cfg.milkdrop || window.SV.defaultConfig().milkdrop;
    cfg.milkdrop.presetId = p ? p.id : '';
    cfg.milkdrop.name = p ? p.name : '';
    cfg.milkdrop.source = p ? p.source : '';
    // Her seçim yeniden karışarak yükleniyor; "şimdi kes" bunu `go`da açıyor
    control(cfg).cutTo = '';
    // Sahne MilkDrop motoruna geçsin, yoksa yükleme görünmez olur
    cfg.visualizer.type = 'milkdrop';
    pointStackAtMilkdrop(cfg);
  }

  const CY = () => window.SVMilkdropCycle;

  /* SAHNEYE AİT OLMAYAN İKİ BLOK (defaults.js). Sahne kaydı ve şablon
     `milkdrop` bloğunu bütünüyle değiştiriyor; puanlar, kilit ve "şimdi
     kes" orada dursaydı bir sahne geçişi onları silerdi. */
  function library(cfg) {
    const l = cfg.milkdropLibrary || (cfg.milkdropLibrary = {});
    if (!l.ratings || typeof l.ratings !== 'object') l.ratings = {};
    return l;
  }
  function control(cfg) {
    return cfg.milkdropControl || (cfg.milkdropControl = { locked: false, cutTo: '' });
  }
  const ratingsOf = (cfg) => (cfg && cfg.milkdropLibrary && cfg.milkdropLibrary.ratings) || null;

  /* GEÇMİŞ (#569) panelde, çünkü "geri" bir kullanıcı eylemi ve elle seçim
     bütün pencerelere buradan gidiyor. Kayıt ise görselleştiricinin ~30 Hz
     ölçer mesajından: otomatik geçişin ve sert geçişin seçtikleri de
     giriyor (admin.js → `noteLive`). */
  let hist = null;
  function history() {
    if (!hist && CY() && CY().History) hist = new (CY().History)(64);
    return hist;
  }

  // Motorun elle seçim anahtarıyla aynı biçim (modes/milkdrop.js `_manualKey`)
  const manualKey = (md) => (md.presetId || '') + '|' + (md.source || '').length;

  /* Ekranda O AN olan preset: görselleştiricinin son mesajı tazeyse ve AYNI
     elle seçimin üstündeyse onun seçtiği, değilse ayardaki. */
  function liveId(md) {
    const F = window.SVMdFollow;
    if (F && F.id && F.base === manualKey(md) && (performance.now() - F.at) < 1500) return F.id;
    return md.presetId || '';
  }

  // Rastgele seçim motorunkiyle aynı kural: o an görülen hariç, puana göre
  function randomPick(cfg, md) {
    const C = CY();
    if (!C) return presets[(Math.random() * presets.length) | 0];
    const ratings = ratingsOf(cfg);
    const w = md.useRatings === false ? null : (p) => C.ratingOf(p, ratings);
    return C.pick(presets, liveId(md), 'random', Math.random, w);
  }

  /* `cut`: karışmadan yükle (#570, "şimdi kes"). Motor bunu elle seçimin
     kendisinden okuyor: `milkdropControl.cutTo` yeni seçilen presetin
     kimliğiyse o geçiş karışmıyor. `load` alanı her seçimde temizliyor,
     yani bir sonraki sıradan seçim yine ayardaki süreyle karışıyor. */
  function go(cfg, p, cut) {
    if (!p) return;
    load(cfg, p);
    if (cut) control(cfg).cutTo = p.id;
    const h = history();
    if (h) h.note(p.id);
    P().apply();
  }

  const byId = (id) => presets.find((p) => p.id === id);

  /* Liste adımı EKRANDAKİ presete göre: otomatik geçiş ilerlemişse
     "sonraki" ayardaki elle seçimin değil, o an görülenin sonraki
     (MilkDrop'ta da `m_nCurrentPreset` gösterileni tutuyor). */
  function stepList(cfg, md, dir, cut) {
    if (!presets.length) return;
    const i = presets.findIndex((p) => p.id === liveId(md));
    const j = ((i < 0 ? 0 : i + dir) % presets.length + presets.length) % presets.length;
    go(cfg, presets[j], cut);
  }

  /* ◀ ve ▶ GEÇMİŞTE geziyor (#569): ekranda gösterilenler, otomatik
     geçişin seçtikleri dahil. Silinmiş bir presete denk gelen adım
     atlanıyor. Geçmiş boşsa listede bir önceki; ileride bir şey yoksa
     sıraya göre yenisi — rastgelede puana göre. */
  function navBack(cfg, md) {
    const h = history();
    for (let id = h && h.back(); id; id = h.back()) {
      const p = byId(id);
      if (p) { go(cfg, p); return; }
    }
    stepList(cfg, md, -1);
  }

  function navForward(cfg, md, cut) {
    const h = history();
    for (let id = h && h.forward(); id; id = h.forward()) {
      const p = byId(id);
      if (p) { go(cfg, p, cut); return; }
    }
    if (md.autoOrder === 'random') go(cfg, randomPick(cfg, md), cut);
    else stepList(cfg, md, 1, cut);
  }

  /* DENETLEYİCİ EYLEMLERİ (#570). MIDI ve OSC buradan geçiyor (control.js
     `runAction`), yani geçmiş, puan ağırlığı ve kilit düğmelerle aynı.
     "Şimdi kes" MilkDrop'un H tuşu: sıradaki preset, karışmadan
     (`LoadRandomPreset(0.0f)`). Puan bir tam adım oynuyor ve 0..5'te
     kalıyor; dosyadan gelen 3,5 gibi bir puan önce tam sayıya iniyor ya
     da çıkıyor. Dönüş: bir şey yapıldı mı. */
  function act(name) {
    const cfg = P().cfg();
    const md = cfg.milkdrop || (cfg.milkdrop = window.SV.defaultConfig().milkdrop);
    if (name === 'Lock') {
      const c = control(cfg);
      c.locked = c.locked !== true;
      P().apply();
      return true;
    }
    if (!presets.length) return false;
    if (name === 'Next') navForward(cfg, md);
    else if (name === 'Prev') navBack(cfg, md);
    else if (name === 'Random') go(cfg, randomPick(cfg, md));
    else if (name === 'Cut') navForward(cfg, md, true);
    else if (name === 'RateUp' || name === 'RateDown') {
      const id = liveId(md);
      const p = byId(id);
      const C = CY();
      if (!p || !C) return false;
      /* Adım ETKİN puandan atılıyor: puan verilmemiş presette dosyadaki
         puandan. "Artır" bir preseti asla daha seyrek getirmemeli —
         dosyada 5 yazan bir preset boş yıldızdan 1'e inseydi öyle olurdu. */
      const r = C.ratingOf(p, ratingsOf(cfg));
      setRating(id, name === 'RateUp' ? Math.min(5, Math.floor(r) + 1) : Math.max(0, Math.ceil(r) - 1));
    } else {
      return false;
    }
    return true;
  }

  /* PUAN YILDIZLARI — ekrandaki presetin. Otomatik geçiş preseti
     değiştirince panel yeniden çizilmiyor (odak kaybolurdu); yıldızlar
     yerinde tazeleniyor. 0 ayrı bir düğme: rastgele sırada hiç gelmeyecek
     demek, "puansız" değil. */
  let starsFor = null;
  function fillStars(wrap, cfg) {
    const el = P().el;
    const C = CY();
    const id = liveId(cfg.milkdrop || {});
    starsFor = id;
    wrap.textContent = '';
    const p = presets.find((x) => x.id === id);
    if (!p || !C) {
      wrap.appendChild(el('span', { class: 'dim-hint', text: '—' }));
      return;
    }
    /* YALNIZ SİZİN VERDİĞİNİZ PUAN YILDIZ OLARAK GÖRÜNÜYOR (#587).
       Puan verilmemiş preset boş görünüyor; dosyanın kendi `fRating`i
       yıldızlara taşınmıyor. Önceden taşınıyordu ve hiç puan verilmemiş bir
       preset beş yıldızla geliyordu — korpusun %95'i dosyada 5 yazıyor —
       yani bir puan verip başka presete geçince yıldızlar "bozuk" görünüyordu.

       SEÇİM BUNDAN ETKİLENMİYOR, bilerek: rastgele sıra puan verilmemiş
       presette dosyadaki puanı kullanmaya devam ediyor (`C.ratingOf`,
       MilkDrop'un kuralı: plugin.cpp:5795-5796). Gösterimi seçime
       "eşitlemek" için ağırlığı değiştirmek, kitaplığın yazarların verdiği
       puanlara göre dağılmasını sessizce bozardı. */
    const mine = ratingsOf(cfg);
    const own = mine && Object.prototype.hasOwnProperty.call(mine, id) && isFinite(Number(mine[id]))
      ? Math.max(0, Math.min(5, Number(mine[id]))) : null;
    wrap.classList && wrap.classList.toggle('md-unrated', own === null);
    for (let k = 0; k <= 5; k++) {
      const on = own !== null && (k === 0 ? own === 0 : k <= own);
      wrap.appendChild(el('button', {
        class: 'md-star' + (k === 0 ? ' md-star0' : '') + (on ? ' on' : ''),
        type: 'button', title: String(k),
        text: k === 0 ? '0' : (on ? '★' : '☆'),
        onclick: () => setRating(id, k),
      }));
    }
  }

  function setRating(id, k) {
    const cfg = P().cfg();
    const lib = library(cfg);
    const next = Object.assign({}, lib.ratings);
    next[id] = k;
    lib.ratings = next;
    P().apply();
  }

  function syncStars() {
    const wrap = document.getElementById('mdStars');
    const cfg = P() && P().cfg && P().cfg();
    if (wrap && cfg && cfg.milkdrop) fillStars(wrap, cfg);
  }

  /* ÖLÇÜ DURUMU (#571) — görselleştiricinin söylediği; sayı ve metin ayrı
     düğümlerde, çünkü çeviri sözlüğü tam metin eşliyor. Mesaj yalnız
     değişince yeniden yazılıyor: ~30 Hz geliyor. */
  let lastBars = null;
  let lastBarsKey = '';
  function fillBarStatus(wrap, info) {
    const el = P().el;
    const tt = (s) => (window.SVI18n && window.SVI18n.t ? window.SVI18n.t(s) : s);
    wrap.textContent = '';
    if (!info) {
      wrap.appendChild(el('span', { text: tt('Ölçü sayacı görselleştirici açıkken burada görünür.') }));
      return;
    }
    if (info.noTempo || !info.bpm) {
      wrap.appendChild(el('span', { text: tt('Tempo bulunamadı: ölçüler sayılamıyor, geçiş zamana düştü.') }));
      return;
    }
    wrap.appendChild(el('span', { class: 'md-num', text: info.bpm + ' BPM · ' + info.count + '/' + info.of + ' ' }));
    wrap.appendChild(el('span', { text: tt('ölçü') }));
  }

  /* Ölçer mesajı (admin.js): görselleştiricinin o an çizdiği preset.
     Elle seçimden önceki bayat mesaj `base` eşleşmediği için atılıyor —
     yoksa az önce bırakılan preset geçmişe yeni bir kayıt gibi girerdi. */
  function noteLive(mp) {
    const bars = mp && mp.bars ? mp.bars : null;
    const key = bars ? [bars.bpm, bars.count, bars.of, bars.noTempo].join('|') : '';
    if (key !== lastBarsKey) {
      lastBarsKey = key;
      lastBars = bars;
      const bs = document.getElementById('mdBarStatus');
      if (bs) fillBarStatus(bs, lastBars);
    }
    const cfg = P() && P().cfg && P().cfg();
    const md = cfg && cfg.milkdrop;
    if (!md || !mp || mp.base !== manualKey(md)) return;
    const id = mp.id || md.presetId || '';
    const h = history();
    if (h) h.note(id);
    if (id !== starsFor) syncStars();
  }

  function panel() {
    const el = P().el;
    const cfg = P().cfg();
    const md = cfg.milkdrop || (cfg.milkdrop = window.SV.defaultConfig().milkdrop);
    const rerender = () => P().apply();
    const nodes = [];

    if (!loaded && !loading) {
      refresh(() => P().rerender());
    } else if (!loaded) {
      staleRender = true;
    }

    // Durum
    /* Otomatik geçiş açıkken ekrandaki preset AYARDAKİ DEĞİL: seçim ayara
       yazılmıyor (shared/milkdrop-cycle.js). Ad, görselleştiricinin ~30 Hz
       ölçer mesajıyla yerinde güncelleniyor (admin.js); `data-cfg` o mesaj
       "ayardaki preset çiziliyor" dediğinde dönülecek ad. Metinler burada
       çevriliyor çünkü güncelleme DOM çevirmeninden sonra geliyor. */
    const tt = (s) => (window.SVI18n && window.SVI18n.t ? window.SVI18n.t(s) : s);
    const current = md.name ? tr(md.name) : tt(md.source ? 'Adsız' : 'Yerleşik varsayılan');
    const lf = window.SVMdFollow;
    const live = lf && lf.id && (performance.now() - lf.at) < 1500 ? (tr(lf.name) || tt('Adsız')) : null;
    nodes.push(P().row('Yüklü Preset', el('span', {
      id: 'mdLiveName', class: 'md-cur', 'data-cfg': current, text: live || current,
    })));
    /* PUAN (#569). Presetin kendi `fRating`iyle başlıyor; verilen puan
       ayarlara yazılıyor. Rastgele sıra puana göre ağırlıklı. */
    const stars = el('span', { id: 'mdStars', class: 'md-stars' });
    fillStars(stars, cfg);
    nodes.push(P().row('Puan', stars));

    // Doğrulama: yüklü presetin derleme durumu
    if (md.source && window.SVMilkdrop) {
      try {
        const p = new window.SVMilkdrop.Preset(md.source);
        /* Sayı ve metin AYRI düğümlerde. i18n sözlüğü metin düğümlerini
           birebir eşleştiriyor, dolayısıyla '3 hata' gibi birleşik bir metin
           hiçbir zaman eşleşmez ve İngilizce arayüzde Türkçe kalırdı —
           #559'daki ekran görüntüsünde tam olarak bu görünüyor. */
        const st = el('span', { class: p.errors.length ? 'md-err' : 'md-ok' });
        if (p.errors.length) {
          st.appendChild(el('span', { text: '⚠ ' }));
          st.appendChild(el('span', { class: 'md-num', text: String(p.errors.length) + ' ' }));
          st.appendChild(el('span', { text: 'hata' }));
        } else {
          st.appendChild(el('span', { text: '✓ ' }));
          st.appendChild(el('span', {
            class: 'md-num',
            text: String(p.cFrame.statements + p.cPixel.statements + p.cInit.statements) + ' ',
          }));
          st.appendChild(el('span', { text: 'deyim derlendi' }));
        }
        nodes.push(P().row('Derleme', st));
        /* `monitor` — presetin kendi hata ayıklama probu. Render girdisi
           değil; yazar denklemine koyup değerini görmek istiyor. Korpusta
           4.489 preset (%43,4) yazıyor ve okunmadığı sürece o satırlar
           ölüydü. Kimlik sabit, değeri ses ölçer mesajı ~30 Hz yazıyor —
           panel yeniden çizilmiyor, yoksa ayar alanlarındaki odak
           kaybolurdu. "—" yazması "preset hiç yazmadı" demek; 0 yazan bir
           preset 0.0000 gösterir. */
        const mval = window.SVMdMonitor;
        nodes.push(P().row('monitor', el('span', {
          id: 'mdMonitorVal', class: 'md-num',
          text: (mval === null || mval === undefined) ? '—' : Number(mval).toFixed(4),
        })));
        if (p.errors.length) {
          nodes.push(el('div', { class: 'studio-note md-errbox', text: p.errors.join('\n') }));
        }
      } catch (e) {
        nodes.push(P().row('Derleme', el('span', { class: 'md-err', text: String(e.message || e) })));
      }
    }

    /* KALITE AYARLARI (#560, madde 1 ve 7). Ikisi de gorunur bir denge:
       ag sıklıgı kıvrımlı warp'ların koseliligini, ic cozunurluk ise ince
       sekillerin keskinligini belirliyor. Maliyetleri farklı buyuyor — ag
       dogrusal, cozunurluk KARESEL — bu yuzden ayrı ayrı ayarlanıyorlar. */
    const selOf = (pairs, value, onChange) => {
      const sel = el('select', { class: 'sel' });
      for (const [v, label] of pairs) {
        const o = el('option', { value: String(v), text: label });
        if (String(v) === String(value)) o.selected = true;
        sel.appendChild(o);
      }
      sel.addEventListener('change', () => { onChange(sel.value); rerender(); });
      return sel;
    };

    nodes.push(P().row('Ağ Sıklığı', selOf([
      [24, '24x18 (en hızlı)'],
      [32, '32x24 (MilkDrop varsayılanı)'],
      [48, '48x36'],
      [64, '64x48 (önerilen)'],
      [96, '96x72'],
      [128, '128x96 (en pürüzsüz)'],
    ], md.mesh || 64, (v) => { md.mesh = Number(v); })));

    nodes.push(P().row('İç Çözünürlük', selOf([
      [0.75, '0,75x (düşük güçlü makine)'],
      [1, '1x (tuval boyutu)'],
      [1.5, '1,5x'],
      [2, '2x (en keskin)'],
    ], md.renderScale == null ? 1 : md.renderScale, (v) => { md.renderScale = Number(v); })));

    /* Geçiş MilkDrop'un çift boru hattı: eski preset donmuş bir kare değil,
       kendi denklemleri ve shader'larıyla koşmaya devam ediyor. 1,7 ve 2,7
       MilkDrop'un kendi varsayılanları (kullanıcı geçişi / kendiliğinden
       geçiş). */
    nodes.push(P().row('Preset Geçişi', selOf([
      [0, 'Kapalı (sert kesme)'],
      [0.8, '0,8 saniye'],
      [1.7, '1,7 saniye (MilkDrop)'],
      [2.7, '2,7 saniye (MilkDrop otomatik)'],
      [5, '5 saniye'],
    ], md.blendTime == null ? 1.7 : md.blendTime, (v) => { md.blendTime = Number(v); })));

    /* ÇİZGİ ÇİZİMİ. MilkDrop çizgiyi kaydırılmış kopyalarıyla
       kalınlaştırıyor; kalınlık oluyor ama kenar merdiven kalıyor.
       Yumuşatılmış yol çizgiyi şerit olarak çizip kenarı bir teksel
       içinde söndürüyor. "Işık korumalı" seçeneği eski yolun bıraktığı
       ışığı hedefliyor (ölçüldü: ±%12), yani presetlerin parlaklığı
       yerinde kalıyor. "Gerçek kalınlık" fiziksel olarak doğru ama
       dalga taşıyan presetler gözle görülür biçimde sönükleşiyor.

       Ayar ÜÇ çizgiyi birden sürüyor: dalga, şekil kenarlığı ve hareket
       vektörleri. Yalnız dalgaya uygulansaydı aynı karede yumuşak bir
       dalga ile tırtıklı bir kenarlık yan yana dururdu. */
    nodes.push(P().row('Çizgi Çizimi', selOf([
      ['smooth', 'Yumuşatılmış (ışık korumalı)'],
      ['thin', 'Yumuşatılmış (gerçek kalınlık)'],
      ['milkdrop', 'MilkDrop (kaydırmalı kalınlaştırma)'],
    ], md.lineStyle || 'smooth', (v) => { md.lineStyle = String(v); })));

    /* FLAŞ SINIRLAMA. MilkDrop'ta yok; erişilebilirlik için eklendi.
       Korpusta "Definitly Not For The Epileptic" gibi adlar var; yazarı
       ne yaptığını biliyor, izleyen herkes bilmiyor. Ölçüldü: presetlerin
       %90'ı eşiğin altında ve hiç etkilenmiyor. */
    nodes.push(P().row('Flaş Sınırlama', selOf([
      [1, 'Açık (nöbet riskini kes)'],
      [0, 'Kapalı (ham görüntü)'],
    ], md.flashLimit === false ? 0 : 1, (v) => { md.flashLimit = Number(v) === 1; })));

    nodes.push(el('div', {
      class: 'studio-note dim-hint',
      text: 'Ölçüt WCAG 2.3.1\'in genel flaş tanımı: bağıl parlaklıkta 0,10\'dan büyük ve saniyede üçten fazla değişim. Ölçüldü: presetlerin %90\'ı bu eşiğin altında kalıyor ve hiç etkilenmiyor; sınırlama yalnızca kalan %10\'da devreye giriyor ve orada da kesme değil oranlama yapıyor — eşiği on kat aşan bir flaş onda bir geçiyor.',
    }));

    /* MILKDROP UYUMLULUĞU. Motorun ölçülebilir uyum hataları düzeltildi ve
       düzeltilmiş değerler varsayılan. Anahtar yalnızca DEĞERLERİ geri
       alıyor — shader'lar, dokular ve doku birimleri iki durumda da aynı;
       böylece tek kod yolu ve tek test yüzeyi kalıyor. */
    nodes.push(P().row('MilkDrop Uyumu', selOf([
      [1, 'Açık (MilkDrop değerleri)'],
      [0, 'Kapalı (motorun eski yaklaşımı)'],
    ], md.accurate === false ? 0 : 1, (v) => { md.accurate = Number(v) === 1; })));

    nodes.push(el('div', {
      class: 'studio-note dim-hint',
      text: 'Açıkken motor MilkDrop\'un kendi değerlerini kullanır: gürültü dokularının kafes ölçekleri, gerçekten üç boyutlu hacim gürültüsü, ekran boyunca değişen renk kayması, doğru bulanıklık ölçeği ve kenar karartması, ağın MilkDrop sırasıyla kurulan dönüşümü (dikey yön, en-boy, yarıçap ve açı), warp titreşiminin kendi ölçeği ve hızı, dalga yumuşatma, sese göre dalga saydamlığı, özel dalgaların gerçek genliği ve tayf kaynağı, dış/iç kenarlıklar ve merkez karartma. Kapalı hâl motorun daha önceki yaklaşık değerlerini geri verir; presetler iki durumda da çalışır, yalnız görüntü farklıdır.',
    }));

    nodes.push(el('div', {
      class: 'studio-note dim-hint',
      text: 'Geçişte iki preset de çalışır: kare denklemleri, warp ağları ve shader\'ları aynı anda koşar ve ekranın farklı yerleri farklı zamanda yeni presete döner. Maliyeti neredeyse tam iki katı: 1280×720\'de ve varsayılan 64\'lük ağda kare süresi 2,7 ms\'den 5,2 ms\'ye çıkıyor, yani 60 fps bütçesinin %31\'i. En yoğun ağda (96) bu oran %67 oluyor.',
    }));

    nodes.push(el('div', {
      class: 'studio-note dim-hint',
      text: 'İç çözünürlüğün maliyeti çarpanın karesi kadar artar: 2x seçildiğinde dört katı piksel işlenir. Ağ sıklığının maliyeti doğrusaldır ama her düğümde preset denklemleri yeniden koşar.',
    }));

    /* DOKU PAKETİ (#560 madde 2). Presetler kendi görsellerini ada göre
       istiyor; preset paketleri o görselleri getirmiyor. Klasör
       gösterilmezse yerine gürültü bağlanıyor — preset çalışır ama deseni
       yanlış olur. */
    if (md.textureDir && !texAsked && window.api && window.api.milkdropTextures) {
      texAsked = true;
      window.api.milkdropTextures().then((r) => {
        texCount = (r && Array.isArray(r.names)) ? r.names.length : 0;
        P().rerender();
      }).catch(() => { texCount = 0; });
    }
    /* Düz bir kapsayıcı: `P().row` zaten kendi `.row`unu kuruyor, ikincisi
       flex kuralını miras alıp iki düğmeyi iki uca iterdi. */
    const texRow = el('span', {}, [
      el('button', {
        class: 'btn', type: 'button', text: '🖼 Doku Klasörü Seç',
        onclick: async () => {
          if (!window.api || !window.api.pickMilkdropTextures) {
            P().toast('Doku klasörü seçimi kullanılamıyor.');
            return;
          }
          const r = await window.api.pickMilkdropTextures();
          if (!r || !r.ok) return;
          md.textureDir = r.dir;
          texCount = r.count;
          texAsked = true;
          rerender();
          P().rerender();
        },
      }),
    ]);
    if (md.textureDir) {
      texRow.appendChild(el('button', {
        class: 'btn', type: 'button', text: 'Kaldır',
        onclick: () => {
          md.textureDir = '';
          texCount = null;
          texAsked = false;
          rerender();
          P().rerender();
        },
      }));
    }
    nodes.push(P().row('Doku Paketi', texRow));
    {
      /* Sayı ve metin AYRI düğümlerde: i18n sözlüğü metin düğümlerini birebir
         eşleştiriyor, birleşik bir metin İngilizce arayüzde Türkçe kalırdı. */
      const st = el('span', { class: md.textureDir ? 'md-ok' : 'md-err' });
      if (!md.textureDir) {
        st.appendChild(el('span', { text: 'Seçilmedi — presetin kendi dokusu yerine gürültü kullanılıyor' }));
      } else if (texCount === null) {
        st.appendChild(el('span', { text: 'Okunuyor…' }));
      } else if (texCount === 0) {
        st.className = 'md-err';
        st.appendChild(el('span', { text: 'Bu klasörde görsel dosyası yok' }));
      } else {
        st.appendChild(el('span', { class: 'md-num', text: String(texCount) + ' ' }));
        st.appendChild(el('span', { text: 'görsel bulundu' }));
      }
      nodes.push(P().row('Durum', st));
    }
    nodes.push(el('div', {
      class: 'studio-note dim-hint',
      text: 'MilkDrop presetleri dokularını ada göre ister: sampler_worms yazan bir preset klasörde worms.jpg arar. Bu görseller preset paketleriyle gelmez; MilkDrop kurulumunuzdaki textures klasörünü gösterin. Klasör seçilmezse preset yine çalışır, yalnız o dokunun yerine gürültü kullanılır.',
    }));

    // İçe aktarma
    nodes.push(el('div', { class: 'row' }, [
      el('button', {
        class: 'btn', type: 'button', text: busy || '📂 .milk Dosyaları Ekle',
        disabled: !!busy,
        onclick: async () => {
          if (!window.api || !window.api.importMilk) { P().toast('İçe aktarma kullanılamıyor.'); return; }
          busy = 'Okunuyor…';
          P().rerender();
          try {
            const r = await window.api.importMilk();
            if (!r || !r.ok) { busy = ''; P().rerender(); return; }
            const M = window.SVMilkdrop;
            const items = [];
            let bad = 0;
            for (const f of r.files) {
              const parsed = M ? new M.Preset(f.text, { name: f.name }) : null;
              if (parsed && parsed.errors.length) bad++;
              items.push({
                id: 'md_' + Math.random().toString(36).slice(2, 10),
                kind: 'milkdrop',
                name: f.name,
                source: f.text,
                updatedAt: Date.now(),
              });
            }
            if (items.length && window.api.savePresets) {
              await window.api.savePresets(items);
            }
            busy = '';
            refresh(() => {
              P().rerender();
              P().toast(items.length + ' preset eklendi' +
                (bad ? ' (' + bad + ' tanesinde derleme uyarısı var)' : '') +
                (r.skipped ? ' — ' + r.skipped + ' dosya atlandı' : ''));
            });
          } catch (e) {
            busy = '';
            P().rerender();
            P().toast('İçe aktarılamadı: ' + (e.message || e));
          }
        },
      }),
      el('button', {
        class: 'btn ghost', type: 'button', text: 'Varsayılana Dön',
        onclick: () => { load(cfg, null); rerender(); },
      }),
    ]));

    // Arama
    if (presets.length > 6) {
      nodes.push(P().row('Ara', el('input', {
        class: 'p-in md-search', type: 'search', value: filter,
        placeholder: 'preset adı',
        /* Filtre paneli baştan çiziyor, yani bu girdi düğümü siliniyor ve
           yerine yenisi geliyor. Odak da onunla birlikte gidiyordu: kullanıcı
           her harften sonra kutuya yeniden tıklamak zorunda kalıyordu.
           Yeni düğümü bulup odağı ve imleç yerini geri koyuyoruz. */
        oninput: (e) => {
          filter = e.target.value;
          const caret = e.target.selectionStart;
          P().rerender();
          // Yalnızca panellerin çizildiği kökte ara: belge geneli, ileride
          // ikinci bir örnek çizilirse yanlış kutuya odaklanırdı
          const root = document.getElementById('sections') || document;
          const again = root.querySelector('.md-search');
          if (!again) return;
          again.focus();
          try { again.setSelectionRange(caret, caret); } catch (_) { /* desteklemeyen tarayıcı */ }
        },
      })));
    }

    // Liste
    const list = el('div', {
      class: 'md-list',
      onscroll: (e) => { listScroll = e.target.scrollTop; },
    });
    const vis = visible();
    if (!vis.length) {
      list.appendChild(el('div', {
        class: 'studio-note',
        /* Liste artık hiç boş kalmıyor — yerleşikler her zaman orada; bu
           dal yalnız yerleşik modülü yüklenemediyse görünür. */
        text: presets.length
          ? 'Aramaya uyan preset yok.'
          : 'Preset listesi yüklenemedi. Bir MilkDrop paketindeki .milk dosyalarını ekleyebilirsiniz; hepsi bir kerede seçilebilir.',
      }));
    }
    vis.slice(0, 400).forEach((p) => {
      const active = md.presetId === p.id;
      list.appendChild(el('div', { class: 'md-item' + (active ? ' active' : '') }, [
        el('button', {
          class: 'md-name', type: 'button', text: tr(p.name || p.id),
          onclick: () => {
            const listEl = document.querySelector('.md-list');
            if (listEl) listScroll = listEl.scrollTop;
            load(cfg, p);
            rerender();
          },
        }),
        /* Yerleşiğin silme düğmesi YOK: dosyası olmadığı için `deletePreset`
           onu bulamaz, satır da bir sonraki tazelemede geri gelirdi —
           kullanıcıya çalışmayan bir düğme göstermiş olurduk. */
        p.builtin
          ? el('span', { class: 'md-builtin', text: 'yerleşik', title: 'CAYADEV presetleri' })
          : el('button', {
            class: 'btn ghost tiny danger', type: 'button', text: '✕', title: 'Sil',
            onclick: async () => {
              if (!(await P().confirm('"' + (p.name || p.id) + '" silinsin mi?'))) return;
              if (window.api.deletePreset) await window.api.deletePreset(p.id);
              if (md.presetId === p.id) load(cfg, null);
              refresh(() => rerender());
            },
          }),
      ]));
    });
    nodes.push(list);
    if (listScroll > 0) {
      setTimeout(() => {
        list.scrollTop = listScroll;
        const active = list.querySelector('.md-item.active');
        if (active) active.scrollIntoView({ block: 'nearest' });
      }, 0);
    }
    if (vis.length > 400) {
      nodes.push(el('div', { class: 'studio-note dim-hint', text: vis.length + ' presetten ilk 400 gösteriliyor; aramayı daraltın.' }));
    }

    // Gezinme ve otomatik geçiş
    if (presets.length > 1) {
      // Düğmeler ve denetleyici eylemleri aynı yoldan (bkz. `act`)
      const back = () => navBack(cfg, md);
      const forward = () => navForward(cfg, md);
      /* KİLİT (#568). MilkDrop'taki gibi yalnız otomatik geçişi ve sert
         geçişi durduruyor; elle seçim çalışıyor. Kilit açılınca kalan süre
         kaldığı yerden sayıyor (shared/milkdrop-cycle.js). */
      const locked = control(cfg).locked === true;
      nodes.push(el('div', { class: 'row' }, [
        el('button', { class: 'btn ghost', type: 'button', text: '◀ Önceki', onclick: back }),
        el('button', { class: 'btn ghost', type: 'button', text: 'Sonraki ▶', onclick: forward }),
        el('button', {
          class: 'btn ghost', type: 'button', text: '🎲 Rastgele',
          onclick: () => go(cfg, randomPick(cfg, md)),
        }),
        el('button', {
          id: 'mdLock', class: 'btn ghost' + (locked ? ' md-locked' : ''), type: 'button',
          text: locked ? '🔒 Kilitli' : '🔓 Kilitle',
          title: 'Otomatik geçişi ve sert geçişi durdurur; elle seçim çalışır',
          'aria-pressed': locked ? 'true' : 'false',
          onclick: () => { control(cfg).locked = !locked; rerender(); },
        }),
      ]));
      /* ARALIK BİRİMİ (#571). Ölçüde aralık müziğin kendi ızgarası: geçiş
         ölçünün ilk vuruşunda başlıyor. Etiketler Otomatik VJ'ninkilerle
         aynı, çünkü aynı şeyi söylüyorlar. */
      const bars = md.autoNextUnit === 'bars';
      nodes.push(P().row('Aralık Birimi', selOf([
        ['seconds', 'Saniye'],
        ['bars', 'Ölçü'],
      ], bars ? 'bars' : 'seconds', (v) => { md.autoNextUnit = String(v); })));
      if (bars) {
        nodes.push(SP().miniSlider('Otomatik Geçiş', () => (md.autoNextBars == null ? 8 : md.autoNextBars), (v) => { md.autoNextBars = Math.round(v); }, {
          min: 0, max: 64, step: 1, fmt: (v) => (v > 0 ? Math.round(v) + ' ' + tt('ölçü') : tt('kapalı')),
        }));
        /* Durum görselleştiriciden geliyor (admin.js → `noteLive`): panelin
           kendi tempo kestirimi başka bir sese bakıyor ve başka bir BPM
           söylerdi. */
        const bs = el('div', { id: 'mdBarStatus', class: 'studio-note' });
        fillBarStatus(bs, lastBars);
        nodes.push(bs);
      } else {
        nodes.push(SP().miniSlider('Otomatik Geçiş', () => md.autoNext || 0, (v) => { md.autoNext = Math.round(v); }, {
          min: 0, max: 120, step: 1, fmt: (v) => (v > 0 ? Math.round(v) + ' ' + tt('sn') : tt('kapalı')),
        }));
      }
      /* RASTGELE PAY. Sonraki geçiş aralığa 0..pay arası bir süre ekliyor;
         pay preset başına bir kez çekiliyor. MilkDrop'un varsayılanı 16 sn
         aralığa 10 sn pay. Aralık kapalıyken ve ölçü kipinde — aralığı
         müzik veriyor — anlamı yok, gösterilmiyor. */
      if (!bars && (md.autoNext || 0) > 0) {
        nodes.push(SP().miniSlider('Rastgele Pay', () => md.autoNextRand || 0, (v) => { md.autoNextRand = Math.round(v); }, {
          min: 0, max: 30, step: 1, fmt: (v) => (v > 0 ? '+0–' + Math.round(v) + ' ' + tt('sn') : tt('yok')),
        }));
      }
      nodes.push(P().row('Geçiş Sırası', selOf([
        ['sequential', 'Sırayla'],
        ['random', 'Rastgele'],
      ], md.autoOrder === 'random' ? 'random' : 'sequential', (v) => { md.autoOrder = String(v); })));
      /* PUANA GÖRE SEÇİM (#569). MilkDrop'ta varsayılan açık; kapalıyken
         rastgele sıra eşit olasılıklı. Yalnız rastgele sırada anlamlı. */
      if (md.autoOrder === 'random') {
        nodes.push(P().row('Puana Göre', selOf([
          [1, 'Açık (MilkDrop gibi)'],
          [0, 'Kapalı (eşit olasılık)'],
        ], md.useRatings === false ? 0 : 1, (v) => { md.useRatings = Number(v) === 1; })));
      }
      /* SERT GEÇİŞ (#568). Sesin ani yükselişinde karışmadan yeni preset.
         MilkDrop 2'nin kuralı ve varsayılanları; orada da KAPALI başlıyor. */
      nodes.push(P().row('Sert Geçiş', selOf([
        ['off', 'Kapalı'],
        ['md2', 'MilkDrop 2 (ses yükselişi)'],
      ], md.hardCut === 'md2' ? 'md2' : 'off', (v) => { md.hardCut = String(v); })));
      if (md.hardCut === 'md2') {
        nodes.push(SP().miniSlider('Sert Geçiş Eşiği',
          () => (md.hardCutThreshold == null ? 2.5 : md.hardCutThreshold),
          (v) => { md.hardCutThreshold = Math.round(v * 10) / 10; },
          { min: 1, max: 6, step: 0.1, fmt: (v) => (+v).toFixed(1) }));
        nodes.push(SP().miniSlider('Eşik Toparlanması',
          () => (md.hardCutHalfLife == null ? 60 : md.hardCutHalfLife),
          (v) => { md.hardCutHalfLife = Math.round(v); },
          { min: 5, max: 240, step: 5, fmt: (v) => Math.round(v) + ' ' + tt('sn') }));
        nodes.push(el('div', {
          class: 'studio-note dim-hint',
          text: 'Bas, orta ve tiz, her biri kendi uzun ortalamasına göre, birlikte eşiğin üç katını aşınca karışmadan yeni presete geçilir. Eşik her kesimde iki katına çıkar ve sonra tabanına döner: arka arkaya patlamalar arka arkaya kesim yapmaz. Kural ve varsayılanlar MilkDrop 2\'nin (2,5 ve 60 sn); oradaki gibi, toparlanma süresi sonunda eşiğin fazlası dörtte bire iner.',
        }));
      }
      nodes.push(el('div', {
        class: 'studio-note dim-hint',
        text: 'Otomatik geçiş görselleştiricinin kendi saatiyle çalışır: panel kapalıyken ya da görselleştirici paneli örterken de durmaz. Geçilen preset ayarlara yazılmaz; Yüklü Preset satırı o an ekranda olanı gösterir. Rastgele sırada o an çizilen preset hiç seçilmez. Her geçişin süresi yukarıdaki Preset Geçişi ayarından gelir.',
      }));
      nodes.push(el('div', {
        class: 'studio-note dim-hint',
        text: 'Zamanlama MilkDrop 2\'ninki: aralık, geçiş bittikten sonra sayılmaya başlar ve rastgele pay her presette bir kez çekilir. Kilit otomatik geçişi ve sert geçişi durdurur; açılınca kalan süre kaldığı yerden sayar.',
      }));
      if (bars) {
        nodes.push(el('div', {
          class: 'studio-note dim-hint',
          text: 'Ölçü kipinde tempo görselleştiricinin kendi sesinden kestirilir; BPM kilidi ve tap tempo Tempo ve Otomatik VJ bölümündeki ayardır. Geçiş ölçünün ilk vuruşunda başlar ve süresi en yakın tam vuruşa yuvarlanır, yani bir vuruşun üstünde biter. Tempo bulunamazsa ölçü sayısının iki katı saniyede, en az 4 saniyede bir geçilir.',
        }));
      }
      nodes.push(el('div', {
        class: 'studio-note dim-hint',
        text: 'Yıldızlar yalnız sizin verdiğiniz puanı gösterir; puan vermediğiniz preset boş görünür ve rastgele sırada kendi dosyasındaki fRating değeriyle (yoksa 3) seçilir. Rastgele sırada presetler puanlarıyla orantılı olasılıkla gelir ve 0 puanlı preset hiç gelmez — MilkDrop 2\'nin kuralı. Verdiğiniz puan ayarlara yazılır, preset dosyasına dokunulmaz. ◀ Önceki ve Sonraki ▶ ekranda gösterilenlerin geçmişinde gezer; otomatik geçişin seçtikleri de o geçmişte.',
      }));
    }

    nodes.push(el('div', {
      class: 'studio-note dim-hint',
      text: 'Denklem blokları (per_frame, per_pixel) ve MilkDrop 2 presetlerinin HLSL warp/composite shaderları gerçekten çalıştırılır: 10.332 presetlik bir korpustaki 16.346 shader aşamasının hepsi derleniyor. Şekiller, dalgalar, blur zinciri ve hareket vektörleri çizilir; preset dosyalarıyla gelmeyen kullanıcı dokuları, doku paketi seçilmediyse gürültüyle ikame edilir.',
    }));

    return el('div', { class: 'md-panel' }, nodes);
  }

  function init() { refresh(); }

  /* load ve pointStackAtMilkdrop testler icin de disa aciliyor: preset
     secmenin sahneyi GERCEKTEN degistirdigi, panelin arayuzunu kurmadan
     sinanabilsin. */
  window.SVMilkdropPanel = {
    panel, init, refresh, load, pointStackAtMilkdrop, noteLive, liveId, history, act, fillStars,
  };
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = window.SVMilkdropPanel;
  }
})();
