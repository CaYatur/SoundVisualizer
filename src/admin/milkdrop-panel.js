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

  function refresh(cb) {
    if (!window.api || !window.api.listPresets || loading) return;
    loading = true;
    window.api.listPresets().then((list) => {
      loading = false;
      loaded = true;
      presets = (list || []).filter((p) => p.kind === 'milkdrop');
      if (cb) cb();
    }).catch(() => {
      loading = false;
      loaded = true;
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
    // Sahne MilkDrop motoruna geçsin, yoksa yükleme görünmez olur
    cfg.visualizer.type = 'milkdrop';
    pointStackAtMilkdrop(cfg);
  }

  function panel() {
    const el = P().el;
    const cfg = P().cfg();
    const md = cfg.milkdrop || (cfg.milkdrop = window.SV.defaultConfig().milkdrop);
    const rerender = () => P().apply();
    const nodes = [];

    if (!loaded && !loading) {
      refresh(() => P().rerender());
    }

    // Durum
    const current = md.name || (md.source ? 'Adsız' : 'Yerleşik varsayılan');
    nodes.push(P().row('Yüklü Preset', el('span', { class: 'md-cur', text: current })));

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
       dalga taşıyan presetler gözle görülür biçimde sönükleşiyor. */
    nodes.push(P().row('Çizgi Çizimi', selOf([
      ['smooth', 'Yumuşatılmış (ışık korumalı)'],
      ['thin', 'Yumuşatılmış (gerçek kalınlık)'],
      ['milkdrop', 'MilkDrop (kaydırmalı kalınlaştırma)'],
    ], md.lineStyle || 'smooth', (v) => { md.lineStyle = String(v); })));

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
        text: presets.length
          ? 'Aramaya uyan preset yok.'
          : 'Henüz preset yok. Bir MilkDrop paketindeki .milk dosyalarını ekleyin; hepsi bir kerede seçilebilir.',
      }));
    }
    vis.slice(0, 400).forEach((p) => {
      const active = md.presetId === p.id;
      list.appendChild(el('div', { class: 'md-item' + (active ? ' active' : '') }, [
        el('button', {
          class: 'md-name', type: 'button', text: p.name || p.id,
          onclick: () => {
            const listEl = document.querySelector('.md-list');
            if (listEl) listScroll = listEl.scrollTop;
            load(cfg, p);
            rerender();
          },
        }),
        el('button', {
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
      const step = (dir) => {
        const i = presets.findIndex((p) => p.id === md.presetId);
        const j = ((i < 0 ? 0 : i + dir) % presets.length + presets.length) % presets.length;
        load(cfg, presets[j]);
        rerender();
      };
      nodes.push(el('div', { class: 'row' }, [
        el('button', { class: 'btn ghost', type: 'button', text: '◀ Önceki', onclick: () => step(-1) }),
        el('button', { class: 'btn ghost', type: 'button', text: 'Sonraki ▶', onclick: () => step(1) }),
        el('button', {
          class: 'btn ghost', type: 'button', text: '🎲 Rastgele',
          onclick: () => { load(cfg, presets[(Math.random() * presets.length) | 0]); rerender(); },
        }),
      ]));
      nodes.push(SP().miniSlider('Otomatik Geçiş', () => md.autoNext || 0, (v) => { md.autoNext = Math.round(v); }, {
        min: 0, max: 120, step: 1, fmt: (v) => (v > 0 ? Math.round(v) + ' sn' : 'kapalı'),
      }));
    }

    nodes.push(el('div', {
      class: 'studio-note dim-hint',
      text: 'Denklem blokları (per_frame, per_pixel) ve MilkDrop 2 presetlerinin HLSL warp/composite shaderları gerçekten çalıştırılır: 10.332 presetlik bir korpusta shader derleme oranı %99,2. Şekiller, dalgalar, blur zinciri ve hareket vektörleri çizilir; preset dosyalarıyla gelmeyen kullanıcı dokuları gürültüyle ikame edilir.',
    }));

    return el('div', { class: 'md-panel' }, nodes);
  }

  function init() { refresh(); }

  /* load ve pointStackAtMilkdrop testler icin de disa aciliyor: preset
     secmenin sahneyi GERCEKTEN degistirdigi, panelin arayuzunu kurmadan
     sinanabilsin. */
  window.SVMilkdropPanel = { panel, init, refresh, load, pointStackAtMilkdrop };
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = window.SVMilkdropPanel;
  }
})();
