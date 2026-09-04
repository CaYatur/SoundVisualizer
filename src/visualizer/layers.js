'use strict';
/* Katman kompozit motoru.

   Sahne artık sabit bir yığın (arkaplan → görselleştirici → logo) değil,
   sıralı bir KATMAN listesidir. Her katmanın kendi kaynağı, karışım modu,
   saydamlığı, dönüşümü ve kendi ayar geçersiz kılmaları vardır — yani aynı
   sahnede farklı renklerde iki "bars" katmanı ya da bir shader'ın üstüne
   bindirilmiş bir çember olabilir.

   İki kompozit yolu var, ikisi de AYNI katman listesini okur:

   • Canlı pencereler (görselleştirici, panel önizlemesi, OBS katmanı) her
     katmanı kendi <canvas>'ına çizer ve karıştırmayı CSS mix-blend-mode ile
     TARAYICININ GPU kompozitörüne bırakır. Elle drawImage yapmaya göre çok
     daha ucuz; dönüşüm ve saydamlık da bedavaya gelir.

   • Çevrimdışı dışa aktarıcı tek bir tuvale yazmak zorunda olduğu için aynı
     katmanları globalCompositeOperation ile elle birleştirir. Canvas 2D'nin
     karışım adları CSS ile birebir aynı olduğu için iki yol aynı görüntüyü
     üretir.

   Geriye dönük uyum: cfg.layers boşsa liste eski alanlardan (background /
   media / images / visualizer / logo) SENTEZLENİR. v2.0 ayarları, sahneleri
   ve preset paketleri hiçbir değişiklik olmadan aynı kareyi verir. */
(function () {
  // CSS mix-blend-mode ve canvas globalCompositeOperation'ın ortak kümesi
  const BLEND_MODES = [
    'normal', 'multiply', 'screen', 'overlay', 'darken', 'lighten',
    'color-dodge', 'color-burn', 'hard-light', 'soft-light',
    'difference', 'exclusion', 'hue', 'saturation', 'color', 'luminosity',
  ];
  // 'add' CSS'te yok; canvas'ta 'lighter'. Canlı yolda 'screen'e en yakın
  // görsel karşılığıyla eşlenir (ikisi de aydınlatır).
  const CSS_BLEND = (b) => (b === 'add' ? 'screen' : BLEND_MODES.indexOf(b) >= 0 ? b : 'normal');
  const CANVAS_BLEND = (b) => (b === 'add' ? 'lighter' : BLEND_MODES.indexOf(b) >= 0 ? b : 'source-over');

  const KINDS = ['background', 'visualizer', 'media', 'sprites', 'logo'];

  function newLayerId() {
    return 'ly_' + Date.now().toString(36) + '_' + Math.floor(Math.random() * 0xffff).toString(36);
  }

  const LAYER_DEFAULTS = {
    id: null,
    name: '',
    enabled: true,
    kind: 'visualizer',
    type: 'bars', // arkaplan/görselleştirici mod adı
    presetId: null, // type === 'custom' iken Studio preseti
    blend: 'normal',
    opacity: 1,
    transform: { scale: 1, rotate: 0, x: 0, y: 0, flipX: false, flipY: false },
    // Sese bağlı modülasyon: seçilen bant katmanın saydamlığını/ölçeğini sürer
    audio: { band: 'bass', opacity: 0, scale: 0, rotate: 0 },
    // Katmana özel ayar geçersiz kılmaları (genel yapılandırmanın üstüne biner)
    settings: {},

    /* Solo / sessiz / kilit.

       Üçü de farklı sorunu çözüyor ve üçü de bir kompozitörde beklenen
       davranışlar: solo bir katmanı yalnız bırakır (diğerlerini silmeden),
       sessiz katmanı ayarlarını kaybetmeden gizler, kilit ise kazara
       düzenlemeyi engeller. */
    solo: false,
    muted: false,
    locked: false,

    // Katman grubu adı. Aynı gruptaki katmanlar tek fader'la yönetilir.
    group: '',

    /* Maske. Katmanın hangi bölgesinin görüneceğini belirler.
         type: 'none' | 'rect' | 'ellipse' | 'linear' | 'radial' | 'layer'
         invert: maskeyi tersine çevirir
         feather: kenar yumuşaklığı (0..1)
         from: type === 'layer' iken maske olarak kullanılacak katmanın kimliği */
    mask: { type: 'none', x: 0.5, y: 0.5, w: 0.6, h: 0.6, angle: 0, feather: 0.1, invert: false, from: '' },

    // Katmana özel efekt zinciri (bileşik zincirden ayrı)
    postfx: [],
  };

  function normalizeLayer(l) {
    const out = Object.assign({}, LAYER_DEFAULTS, l || {});
    out.transform = Object.assign({}, LAYER_DEFAULTS.transform, (l && l.transform) || {});
    out.audio = Object.assign({}, LAYER_DEFAULTS.audio, (l && l.audio) || {});
    out.mask = Object.assign({}, LAYER_DEFAULTS.mask, (l && l.mask) || {});
    out.postfx = Array.isArray(l && l.postfx) ? l.postfx : [];
    out.settings = (l && l.settings) || {};
    if (KINDS.indexOf(out.kind) < 0) out.kind = 'visualizer';
    if (!out.id) out.id = newLayerId();
    return out;
  }

  /* Eski (katmansız) yapılandırmadan katman listesi üretir.
     Sıra, v2.0'daki z-index yığınının birebir aynısıdır:
       arkaplan → (medya arkada) → sprite arka → görselleştirici →
       sprite ön → (medya önde) → logo */
  function synthesize(cfg) {
    const out = [];
    const bgType = cfg.background && cfg.background.type;
    if (bgType && bgType !== 'transparent') {
      out.push(normalizeLayer({
        id: 'ly_bg', name: 'Arkaplan', kind: 'background',
        type: bgType, presetId: cfg.custom && cfg.custom.backgroundId,
      }));
    }
    const media = cfg.media || {};
    if (media.enabled && media.layer !== 'front') {
      out.push(normalizeLayer({ id: 'ly_media', name: 'Medya', kind: 'media', blend: media.blend || 'normal' }));
    }
    if (cfg.images && cfg.images.enabled) {
      out.push(normalizeLayer({ id: 'ly_spr_back', name: 'Görsel Nesneler (arka)', kind: 'sprites', type: 'back' }));
    }
    const visType = cfg.visualizer && cfg.visualizer.type;
    if (visType && visType !== 'none') {
      out.push(normalizeLayer({
        id: 'ly_vis', name: 'Görselleştirici', kind: 'visualizer',
        type: visType, presetId: cfg.custom && cfg.custom.visualizerId,
      }));
    }
    if (cfg.images && cfg.images.enabled) {
      out.push(normalizeLayer({ id: 'ly_spr_front', name: 'Görsel Nesneler (ön)', kind: 'sprites', type: 'front' }));
    }
    if (media.enabled && media.layer === 'front') {
      out.push(normalizeLayer({ id: 'ly_media', name: 'Medya', kind: 'media', blend: media.blend || 'normal' }));
    }
    if (cfg.logo && cfg.logo.enabled && cfg.logo.src) {
      out.push(normalizeLayer({ id: 'ly_logo', name: 'Logo', kind: 'logo' }));
    }
    return out;
  }

  /* Katman yığını açık mı?

     Kapalıyken katman listesi DURUR ama kullanılmaz: sahne yine Arkaplan ve
     Görselleştirici kartlarından sentezlenir. Böylece katmanları kapatmak
     onları silmek anlamına gelmiyor, geri açınca aynı düzen geri geliyor.

     Bayrak hiç yoksa eski davranış: dolu bir liste varsa açık sayılır. Bu,
     v3.0.0 öncesi ayar dosyalarının sahnesini bozmadan açılmasını sağlıyor. */
  function stackOn(cfg) {
    const s = cfg && cfg.layerStack;
    if (s && typeof s.enabled === 'boolean') return s.enabled;
    return !!(cfg && Array.isArray(cfg.layers) && cfg.layers.length);
  }

  // Etkin katman listesi: kullanıcı tanımlıysa o, değilse sentez
  function resolve(cfg) {
    const list = stackOn(cfg) && cfg && Array.isArray(cfg.layers) ? cfg.layers : [];
    const used = list.length ? list.map(normalizeLayer) : synthesize(cfg);
    /* Solo varsa yalnızca solo katmanlar çizilir. Bir kompozitörde solo,
       "diğerlerini kapat" demenin geri alınabilir yoludur; katmanları tek tek
       kapatıp sonra geri açmak zorunda kalmamak için var. */
    const soloed = used.filter((l) => l.solo);
    const visible = soloed.length ? soloed : used;
    return visible.filter((l) => l.enabled !== false && !l.muted);
  }

  /* Grup çarpanı: katman opaklığı, ait olduğu grubun fader'ıyla çarpılır.
     Gruplar yapılandırmada cfg.layerGroups altında adla saklanır. */
  function groupGain(cfg, layer) {
    if (!layer || !layer.group) return 1;
    let gain = 1;
    const groups = (cfg && cfg.layerGroups) || {};
    const g = groups[layer.group];
    if (g) {
      if (g.muted) return 0;
      gain = g.opacity == null ? 1 : Math.max(0, Math.min(1, g.opacity));
    }
    /* A/B çapraz geçiş.

       "A" ve "B" adlı gruplar özel: aralarındaki fader klasik VJ
       çapraz geçişidir. Eşit güç eğrisi kullanılıyor — doğrusal karışımda
       ortada toplam parlaklık düşer ve geçişin ortasında görüntü sönük
       görünür; kök-kosinüs çifti bunu önler. */
    const x = cfg && cfg.crossfade;
    if (x && x.enabled !== false && (layer.group === 'A' || layer.group === 'B')) {
      const v = Math.max(0, Math.min(1, x.value == null ? 0.5 : x.value));
      gain *= layer.group === 'A' ? Math.cos(v * Math.PI / 2) : Math.sin(v * Math.PI / 2);
    }
    return gain;
  }

  /* Katmanın gördüğü yapılandırma: genel ayarların üstüne katmanın kendi
     geçersiz kılmaları biner. Böylece iki "bars" katmanı farklı renk ve bar
     sayısıyla aynı sahnede durabilir. */
  function layerConfig(cfg, layer) {
    const over = layer.settings;
    const hasOverrides = over && Object.keys(over).length;
    const base = hasOverrides ? window.SV.deepMerge(cfg, over) : cfg;
    // Katmanın kendi mod seçimi genel alandan önce gelir
    if (layer.kind === 'background') {
      return Object.assign({}, base, {
        background: Object.assign({}, base.background, { type: layer.type }),
        custom: Object.assign({}, base.custom, { backgroundId: layer.presetId || (base.custom && base.custom.backgroundId) }),
      });
    }
    if (layer.kind === 'visualizer') {
      return Object.assign({}, base, {
        visualizer: Object.assign({}, base.visualizer, { type: layer.type }),
        custom: Object.assign({}, base.custom, { visualizerId: layer.presetId || (base.custom && base.custom.visualizerId) }),
      });
    }
    return base;
  }

  /* Sahne imzası.

     Geçiş her yapılandırma değişikliğinde değil, SAHNE değiştiğinde
     tetiklenmeli. Kullanıcı bir kaydırıcıyı sürüklerken geçiş başlatmak
     paneli kullanılmaz hale getirirdi. İmza yalnızca sahnenin kimliğini
     belirleyen alanlardan üretilir: mod ve arkaplan türü, Studio preset
     kimlikleri, katman listesinin yapısı, palet ve 3B formül. Kaydırıcılar
     imzayı değiştirmez. */
  function sceneSignature(cfg) {
    if (!cfg) return '';
    const v = cfg.visualizer || {};
    const b = cfg.background || {};
    const c = cfg.custom || {};
    const g = cfg.geometry || {};
    const layers = Array.isArray(cfg.layers)
      ? cfg.layers.map((l) => (l.kind || '') + '.' + (l.type || '') + '.' + (l.presetId || '') + '.' + (l.enabled !== false ? '1' : '0')).join(',')
      : '';
    const grad = ((b.gradient && b.gradient.colors) || []).join(',');
    const stackState = stackOn(cfg) ? 'stack' : 'classic';
    const black = cfg.isBlackout ? 'blackout' : '';
    return [v.type, b.type, c.visualizerId, c.backgroundId, g.family, g.formula, layers, grad, stackState, black].join('|');
  }

  function bandValue(audio, band) {
    if (!audio) return 0;
    if (band === 'mid') return audio.mid;
    if (band === 'treble') return audio.treble;
    if (band === 'level') return audio.level;
    return audio.bass;
  }

  // ==========================================================================
  // Katman yığını
  // ==========================================================================
  class LayerStack {
    /* container: katman tuvallerinin ekleneceği öğe (canlı yol).
       Çevrimdışı kullanımda (dışa aktarıcı) container verilmez; tuvaller
       belgeye eklenmez, yalnızca drawTo() ile birleştirilir. */
    constructor(container, opts) {
      this.container = container || null;
      this.opts = opts || {};
      this.entries = []; // { layer, canvas, ctx, mode, key }
      this.width = 2;
      this.height = 2;
      this.sprites = null; // paylaşılan sprite motoru
      this.media = null; // paylaşılan medya katmanı
      this.logoEl = this.opts.logoEl || null;
      this._imageCache = {};
      this.signature = '';
      // Son-işlem zinciri (varsa sahne tek yüzeye birleştirilip GPU'ya verilir)
      this.postfx = null;
      this.compCanvas = null;
      this.compCtx = null;
      this._fxMode = false;
      this._surface = null;
      // Projeksiyon haritalaması açıkken sahne tek yüzeye inmeli: bükme
      // katman katman değil, birleştirilmiş görüntüye uygulanır
      this._mapping = false;
      this._forceSingle = false;
      // Sahne geçişi durumu (bkz. beginTransition)
      this.trans = null;
      this.lastSig = '';
      if (this.container) this.container.style.isolation = 'isolate';
    }

    _getImage(src) {
      if (!src) return null;
      if (this._imageCache[src]) return this._imageCache[src];
      const img = new Image();
      img.src = src;
      this._imageCache[src] = img;
      return img;
    }

    /* Efekt zincirini kur. Boş zincir = CSS kompozit yolu (en ucuz).
       Dolu zincir = tek yüzeye birleştirme + GPU geçişleri. */
    setPostFX(chain) {
      const list = Array.isArray(chain) ? chain.filter((f) => f && f.enabled !== false) : [];
      if (!list.length) {
        if (this.postfx) this.postfx.setChain([]);
        return;
      }
      if (!this.postfx && window.SVPostFX) this.postfx = new window.SVPostFX.PostFX();
      if (this.postfx) this.postfx.setChain(list);
    }

    _ensureComp() {
      if (this.compCanvas) return;
      this.compCanvas = document.createElement('canvas');
      this.compCtx = this.compCanvas.getContext('2d');
    }

    /* Görünür yüzeyi belirle.

       Normalde her katman kendi tuvaline çizer ve karıştırmayı tarayıcının
       kompozitörü yapar — en ucuz yol. İki durumda tek bir yüzeye inmek
       gerekiyor: efekt zinciri doluyken (GPU geçişleri tek dokuya uygulanır)
       ve sahne geçişi sürerken (iki sahne birleştirilir). İkisi de aynı
       mekanizmayı kullanır; ayrı kod yollarına gerek yok. */
    _setSurface(canvas) {
      if (this._surface === canvas) return;
      const prev = this._surface;
      this._surface = canvas || null;
      this._fxMode = !!canvas;
      if (!this.container) return;
      for (const e of this.entries) {
        if (e.canvas) e.canvas.style.display = canvas ? 'none' : 'block';
      }
      if (prev && prev !== canvas && prev.parentNode) prev.parentNode.removeChild(prev);
      if (canvas) {
        canvas.style.position = 'absolute';
        canvas.style.inset = '0';
        canvas.style.width = '100%';
        canvas.style.height = '100%';
        canvas.style.display = 'block';
        canvas.style.zIndex = '999';
        if (!canvas.parentNode) this.container.appendChild(canvas);
      }
      if (this.logoEl) {
        const li = this.entries.findIndex((e) => e.layer.kind === 'logo');
        // Tek yüzey kipinde logo yüzeyin içine çizilir, DOM'da gizlenir
        this.logoEl.style.display = li >= 0 && !canvas ? 'block' : 'none';
      }
    }

    // Logo'yu birleştirme yüzeyine çizer (efekt modunda ve dışa aktarımda,
    // logonun da efektlerden geçmesi için)
    _drawLogoToCanvas(ctx, cfg, audio) {
      const img = this.logoEl;
      const l = cfg.logo;
      if (!img || !l || !l.enabled || !l.src || !img.naturalWidth) return;
      const W = this.width;
      const H = this.height;
      const minDim = Math.min(W, H);
      const size = minDim * Math.max(0.03, Math.min(0.9, l.scale));
      const pulse = 1 + (audio ? audio.bass : 0) * l.pulse;
      const w = size * pulse;
      const h = w * (img.naturalHeight / img.naturalWidth);
      ctx.save();
      ctx.globalAlpha = Math.max(0, Math.min(1, l.opacity));
      if (l.glow > 0) {
        ctx.shadowColor = 'rgba(255,255,255,0.6)';
        ctx.shadowBlur = l.glow * 40 * (minDim / 1080);
      }
      ctx.drawImage(img, l.x * W - w / 2, l.y * H - h / 2, w, h);
      ctx.restore();
    }

    setSprites(s) { this.sprites = s; }
    setMedia(m) { this.media = m; }

    // Katmanın kimliği: değişirse mod örneği yeniden kurulur
    _key(l) {
      return [l.id, l.kind, l.type, l.presetId || ''].join('|');
    }

    _makeCanvas() {
      const c = document.createElement('canvas');
      c.width = this.width;
      c.height = this.height;
      c.style.position = 'absolute';
      c.style.inset = '0';
      c.style.width = '100%';
      c.style.height = '100%';
      c.style.display = 'block';
      return c;
    }

    _disposeEntry(e) {
      if (e.mode && e.mode.dispose) {
        try { e.mode.dispose(); } catch { /* motor zaten kapanmış */ }
      }
      if (e.canvas && e.canvas.parentNode) e.canvas.parentNode.removeChild(e.canvas);
    }

    /* Yapılandırmayı uygula. Yalnızca DEĞİŞEN katmanların mod örneği yeniden
       kurulur; sürükleme sırasında her karede WebGL bağlamı yeniden yaratmak
       hem pahalı hem de görsel olarak sıçramalı olurdu. */
    setConfig(cfg) {
      /* Sahne değiştiyse ve geçiş açıksa, mevcut katmanları giden yığına
         devret. Bu, aşağıdaki yeniden kurulumdan ÖNCE olmalı — sonrasında
         eski katmanlar çoktan atılmış olurdu. */
      const scnSig = sceneSignature(cfg);
      const T = window.SVTransition;
      const spec = cfg && cfg.transition;

      const isBlackoutNow = !!(cfg && cfg.isBlackout) ||
        (cfg && cfg.background && cfg.background.type === 'solid' && cfg.background.solidColor === '#000000' &&
         cfg.visualizer && cfg.visualizer.type === 'none' &&
         (!cfg.layers || cfg.layers.every((l) => !l.enabled)));

      const wasBlackout = !!(this.prevCfg && (
        this.prevCfg.isBlackout ||
        (this.prevCfg.background && this.prevCfg.background.type === 'solid' && this.prevCfg.background.solidColor === '#000000' &&
         this.prevCfg.visualizer && this.prevCfg.visualizer.type === 'none' &&
         (!this.prevCfg.layers || this.prevCfg.layers.every((l) => !l.enabled)))
      ));

      const bothBlackout = isBlackoutNow && wasBlackout;
      const isBlackoutTrans = isBlackoutNow !== wasBlackout;
      const transType = isBlackoutTrans ? (spec && spec.blackoutType || 'crossfade') : (spec && spec.type || 'crossfade');
      const transDur = isBlackoutTrans
        ? (spec && spec.blackoutDuration != null ? spec.blackoutDuration : 0.4)
        : (T ? T.durationSeconds(cfg, this.bpm || (spec && spec.bpm || 0)) : 0.7);

      /* Karartmanın kendi animasyon türü ve süresi var; genel geçiş anahtarı
         kapalıyken de çalışmalı. Aksi halde “Karartma Animasyonu” ayarı
         sessizce yok sayılır ve panik düğmesi kesme yapar. */
      const transOn = isBlackoutTrans || (spec && spec.enabled !== false);
      if (T && spec && transOn && !bothBlackout && transType && transType !== 'cut' && transDur > 0 &&
          this.lastSig && scnSig !== this.lastSig && this.prevCfg) {
        this.beginTransition(this.prevCfg, {
          type: transType,
          duration: transDur,
          opts: isBlackoutTrans ? {} : (spec.params || {}),
          ease: isBlackoutTrans ? 'smooth' : (spec.ease || 'smooth'),
        });
      }
      this.lastSig = scnSig;
      this.prevCfg = cfg;

      const wanted = resolve(cfg);
      const sig = wanted.map((l) => this._key(l)).join(';');
      const oldEntries = this.entries;
      const next = [];

      for (const layer of wanted) {
        const key = this._key(layer);
        const reuse = oldEntries.find((e) => e.key === key && !e.taken);
        if (reuse) {
          reuse.taken = true;
          reuse.layer = layer;
          next.push(reuse);
          continue;
        }
        next.push(this._create(layer, key, cfg));
      }

      for (const e of oldEntries) if (!e.taken) this._disposeEntry(e);
      for (const e of next) e.taken = false;
      this.entries = next;
      this.signature = sig;

      // z-sırası: liste sırası
      if (this.container) {
        this.entries.forEach((e, i) => {
          if (!e.canvas) return;
          e.canvas.style.zIndex = String(i + 1);
          if (!e.canvas.parentNode) this.container.appendChild(e.canvas);
        });
        if (this.logoEl) {
          const li = this.entries.findIndex((e) => e.layer.kind === 'logo');
          this.logoEl.style.zIndex = String(li >= 0 ? li + 1 : this.entries.length + 1);
          // Efekt modunda logo birleştirme yüzeyine çizilir, DOM'da gizlenir
          this.logoEl.style.display = li >= 0 && !this._fxMode ? 'block' : 'none';
        }
      }
      this._applyStatic();
    }

    _create(layer, key, cfg) {
      const e = { layer, key, canvas: null, ctx: null, mode: null };
      e.canvas = this._makeCanvas();
      if (this.container) this.container.appendChild(e.canvas);

      if (layer.kind === 'logo') {
        e.ctx = e.canvas.getContext('2d');
        this._sizeEntry(e);
        return e;
      }

      const lcfg = layerConfig(cfg, layer);
      if (layer.kind === 'background') {
        if (layer.type === 'gradient') {
          // WebGL gradyan kendi tuvalini sürer
          try { e.mode = new window.SVModes.gradient(e.canvas); } catch { e.mode = null; }
          e.gl = true;
        } else if (window.SVBackgrounds && window.SVBackgrounds[layer.type]) {
          e.mode = new window.SVBackgrounds[layer.type]();
          e.ctx = e.canvas.getContext('2d');
        } else {
          e.ctx = e.canvas.getContext('2d');
          e.solid = true; // 'solid' ya da bilinmeyen tür: düz renk
        }
      } else if (layer.kind === 'visualizer') {
        if (window.SVModes[layer.type]) e.mode = new window.SVModes[layer.type](e.canvas);
        e.ctx = e.canvas.getContext('2d');
      } else {
        e.ctx = e.canvas.getContext('2d');
      }
      this._sizeEntry(e);
      return e;
    }

    _sizeEntry(e) {
      if (!e.canvas) return;
      if (e.gl && e.mode && e.mode.resize) {
        e.canvas.style.width = '100%';
        e.canvas.style.height = '100%';
        e.mode.resize(this.width, this.height);
        return;
      }
      if (e.canvas.width !== this.width || e.canvas.height !== this.height) {
        e.canvas.width = this.width;
        e.canvas.height = this.height;
        if (e.mode && e.mode.resize) e.mode.resize();
      }
    }

    resize(w, h) {
      this.width = Math.max(2, w | 0);
      this.height = Math.max(2, h | 0);
      for (const e of this.entries) this._sizeEntry(e);
    }

    // Sese bağlı OLMAYAN stil (karışım modu) — yalnızca yapılandırma değişince
    _applyStatic() {
      if (!this.container) return;
      for (const e of this.entries) {
        if (!e.canvas) continue;
        e.canvas.style.mixBlendMode = CSS_BLEND(e.layer.blend);
      }
    }

    // Katmanın o karedeki dönüşümü ve saydamlığı
    /* Çizim anındaki katman nesnesi.

       setConfig() sırasında yakalanan kopya durağandır; opaklık, karışım ve
       dönüşüm alanları modülasyon matrisi tarafından kare kare
       değiştirilebildiği için çizimde yapılandırmadaki taze nesne kullanılır.
       Kimlik önbelleği sayesinde değişmeyen katmanda normalleştirme tekrar
       çalışmaz. */
    _live(e, cfg) {
      const list = cfg && Array.isArray(cfg.layers) ? cfg.layers : null;
      if (!list || !list.length) return e.layer;
      let src = null;
      for (let i = 0; i < list.length; i++) {
        if (list[i] && list[i].id === e.layer.id) { src = list[i]; break; }
      }
      if (!src) return e.layer;
      if (e._liveSrc === src) return e._liveCache;
      e._liveSrc = src;
      e._liveCache = normalizeLayer(src);
      return e._liveCache;
    }

    _dynamics(layer, audio, cfg) {
      const t = layer.transform;
      const a = layer.audio;
      const band = bandValue(audio, a.band);
      /* Opaklık eğrisi: fader'ın hissini belirler. Doğrusal bir fader
         görsel olarak doğrusal davranmaz — algı yaklaşık karesel olduğu için
         üstel seçenek gerçek bir kısma hissi verir. */
      let base = Math.max(0, Math.min(1, layer.opacity));
      if (layer.opacityCurve === 'exp') base = base * base;
      else if (layer.opacityCurve === 'log') base = Math.sqrt(base);
      base *= groupGain(cfg, layer);
      const opacity = Math.max(0, Math.min(1, base * (1 + (a.opacity || 0) * (band * 2 - 1))));
      const scale = t.scale * (1 + (a.scale || 0) * band);
      const rotate = t.rotate + (a.rotate || 0) * band * 180;
      return { opacity, scale, rotate, x: t.x, y: t.y, flipX: t.flipX, flipY: t.flipY };
    }

    _hasTransform(d) {
      return d.scale !== 1 || d.rotate !== 0 || d.x !== 0 || d.y !== 0 || d.flipX || d.flipY;
    }

    // Haritalama aşaması tek yüzey ister; görselleştirici bunu bildirir
    setMapping(on) {
      this._mapping = !!on;
    }

    /* Kayıt da tek yüzey ister: MediaRecorder tek bir tuvalin akışını alır,
       katman katman CSS kompoziti yakalayamaz. */
    setForceSingle(on) {
      this._forceSingle = !!on;
    }

    // Görünür tek yüzey (haritalama aşaması bunu kaynak olarak kullanır)
    surface() {
      return this._surface || null;
    }

    /* Sahne geçişini başlat.

       Giden sahnenin donmuş bir fotoğrafı yerine, KATMANLARI olduğu gibi
       devralan ikinci bir yığın kuruyoruz: geçiş boyunca eski sahne de canlı
       kalıyor. Donmuş kare yarım saniyelik bir geçişte açıkça fark edilirdi.

       Devralınan tuvaller DOM'dan çıkarılır; giden yığın container'sız çalışıp
       yalnızca drawTo() ile çizer. */
    beginTransition(oldCfg, spec) {
      if (this.trans) this.endTransition();
      const out = new LayerStack(null, this.opts);
      out.entries = this.entries || [];
      out.width = this.width;
      out.height = this.height;
      out.sprites = this.sprites;
      out.media = this.media;
      for (const e of out.entries) {
        if (e.canvas && e.canvas.parentNode) e.canvas.parentNode.removeChild(e.canvas);
      }
      this.entries = [];
      this.trans = {
        stack: out,
        cfg: oldCfg,
        elapsed: 0,
        dur: Math.max(0.02, spec.duration),
        type: spec.type,
        opts: spec.opts || {},
        ease: spec.ease || 'smooth',
      };
    }

    endTransition() {
      if (!this.trans) return;
      const out = this.trans.stack;
      for (const e of out.entries) out._disposeEntry(e);
      out.entries = [];
      this.trans = null;
    }

    // Geçiş sürüyorsa bu karedeki ilerlemesini döndürür, yoksa null
    _tickTransition(dt) {
      const tr = this.trans;
      if (!tr) return null;
      tr.elapsed += Math.max(0, dt || 0);
      const raw = Math.min(1, tr.elapsed / tr.dur);
      if (raw >= 1) { this.endTransition(); return null; }
      const T = window.SVTransition;
      return { p: T ? T.easeOf(tr.ease)(raw) : raw, tr };
    }

    _ensureTrans() {
      if (!this.transOut) {
        this.transOut = document.createElement('canvas');
        this.transOutCtx = this.transOut.getContext('2d');
        this.transSurface = document.createElement('canvas');
        this.transCtx = this.transSurface.getContext('2d');
        this.compositor = new window.SVTransition.Compositor();
      }
      for (const c of [this.transOut, this.transSurface]) {
        if (c.width !== this.width || c.height !== this.height) {
          c.width = this.width;
          c.height = this.height;
        }
      }
    }

    draw(audio, cfg, t, dt) {
      const tick = this._tickTransition(dt);
      const isBlackout = !!(cfg && cfg.isBlackout) ||
        (cfg && cfg.background && cfg.background.type === 'solid' && cfg.background.solidColor === '#000000' &&
         cfg.visualizer && cfg.visualizer.type === 'none' &&
         (!cfg.layers || cfg.layers.every((l) => !l.enabled)));
      const fxOn = !!(this.postfx && this.postfx.hasWork());
      const single = fxOn || !!tick || this._mapping || this._forceSingle || isBlackout;

      if (single) {
        this._ensureComp();
        if (this.compCanvas.width !== this.width || this.compCanvas.height !== this.height) {
          this.compCanvas.width = this.width;
          this.compCanvas.height = this.height;
        }
        this.drawTo(this.compCtx, audio, cfg, t, dt, (ctx) => this._drawLogoToCanvas(ctx, cfg, audio));

        let src = this.compCanvas;
        if (tick) {
          const tr = tick.tr;
          this._ensureTrans();
          tr.stack.width = this.width;
          tr.stack.height = this.height;
          for (const e of tr.stack.entries) {
            if (e.canvas && (e.canvas.width !== this.width || e.canvas.height !== this.height)) {
              e.canvas.width = this.width;
              e.canvas.height = this.height;
              if (e.mode && e.mode.resize) e.mode.resize();
            }
          }
          tr.stack.drawTo(this.transOutCtx, audio, tr.cfg, t, dt,
            (ctx) => tr.stack._drawLogoToCanvas(ctx, tr.cfg, audio));
          this.compositor.compose(this.transCtx, this.transOut, this.compCanvas,
            this.width, this.height, tr.type, tick.p, tr.opts);
          src = this.transSurface;
        }

        if (fxOn) {
          this.postfx.resize(this.width, this.height);
          this.postfx.render(src, audio, t, dt);
          this._setSurface(this.postfx.canvas);
        } else if (tick) {
          this._setSurface(this.transSurface);
        } else {
          // Yalnızca haritalama ya da kayıt için tek yüzeye indik
          this._setSurface(this.compCanvas);
        }
        return;
      }

      this._setSurface(null);
      if (this.logoEl) this.logoEl.style.display = 'none';

      for (const e of this.entries) {
        const l = this._live(e, cfg);
        this._drawEntry(e, audio, cfg, t, dt, l);

        if (this.container && e.canvas) {
          const d = this._dynamics(l, audio, cfg);
          e.canvas.style.opacity = d.opacity === 1 ? '' : d.opacity.toFixed(3);
          e.canvas.style.transform = this._hasTransform(d)
            ? `translate(${d.x * 100}%, ${d.y * 100}%) rotate(${d.rotate}deg) scale(${d.flipX ? -d.scale : d.scale}, ${d.flipY ? -d.scale : d.scale})`
            : '';
        }
      }
    }

    /* Maskeyi katmanın kendi tuvaline uygular.

       Maskeleme kompozit aşamasında değil KATMANDA yapılıyor: böylece maske
       katmanın dönüşümüyle birlikte hareket etmiyor (ekranda sabit kalıyor)
       ve karışım modundan bağımsız çalışıyor. Alternatif, maskeyi kompozit
       sırasında uygulamak olurdu ama o zaman her katman için ayrı bir ara
       yüzey gerekirdi. */
    _applyMask(e, l) {
      const m = l.mask;
      if (!m || !m.type || m.type === 'none' || !e.ctx) return;
      const W = this.width;
      const H = this.height;
      const ctx = e.ctx;
      const feather = Math.max(0.001, m.feather == null ? 0.1 : m.feather);
      ctx.save();
      ctx.globalCompositeOperation = m.invert ? 'destination-out' : 'destination-in';
      const cx = (m.x == null ? 0.5 : m.x) * W;
      const cy = (m.y == null ? 0.5 : m.y) * H;
      const w = (m.w == null ? 0.6 : m.w) * W;
      const h = (m.h == null ? 0.6 : m.h) * H;

      if (m.type === 'rect') {
        const fx = feather * Math.min(w, h);
        const g = ctx.createLinearGradient(cx - w / 2, 0, cx - w / 2 + fx, 0);
        // Dikdörtgen maskede yumuşama dört kenardan gelir; en ucuz yol
        // kenarları ayrı ayrı silmek yerine gölge kullanmak
        ctx.shadowColor = '#fff';
        ctx.shadowBlur = fx;
        ctx.fillStyle = '#fff';
        ctx.fillRect(cx - w / 2 + fx / 2, cy - h / 2 + fx / 2, Math.max(1, w - fx), Math.max(1, h - fx));
        ctx.shadowBlur = 0;
        void g;
      } else if (m.type === 'ellipse') {
        const g = ctx.createRadialGradient(cx, cy, 0, cx, cy, Math.max(w, h) / 2);
        g.addColorStop(Math.max(0, 1 - feather), 'rgba(255,255,255,1)');
        g.addColorStop(1, 'rgba(255,255,255,0)');
        ctx.fillStyle = g;
        ctx.save();
        ctx.translate(cx, cy);
        ctx.scale(1, h / Math.max(1, w));
        ctx.translate(-cx, -cy);
        ctx.beginPath();
        ctx.arc(cx, cy, Math.max(w, h) / 2, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
      } else if (m.type === 'linear') {
        const a = (m.angle || 0) * Math.PI * 2;
        const dx = Math.cos(a) * W;
        const dy = Math.sin(a) * H;
        const g = ctx.createLinearGradient(cx - dx / 2, cy - dy / 2, cx + dx / 2, cy + dy / 2);
        g.addColorStop(0, 'rgba(255,255,255,1)');
        g.addColorStop(Math.min(1, feather * 2), 'rgba(255,255,255,1)');
        g.addColorStop(1, 'rgba(255,255,255,0)');
        ctx.fillStyle = g;
        ctx.fillRect(0, 0, W, H);
      } else if (m.type === 'radial') {
        const r = Math.max(w, h) / 2;
        const g = ctx.createRadialGradient(cx, cy, 0, cx, cy, r);
        g.addColorStop(Math.max(0, 1 - feather), 'rgba(255,255,255,1)');
        g.addColorStop(1, 'rgba(255,255,255,0)');
        ctx.fillStyle = g;
        ctx.fillRect(0, 0, W, H);
      } else if (m.type === 'layer' && m.from) {
        // Başka bir katmanın parlaklığı maske olur
        const src = this.entries.find((x) => x.layer.id === m.from);
        if (src && src.canvas) ctx.drawImage(src.canvas, 0, 0, W, H);
      }
      ctx.restore();
    }

    /* Katmanı çizer, ardından maskesini ve varsa kendi efekt zincirini
       uygular.

       Çizim gövdesi ayrı bir metotta çünkü içinde birden çok erken `return`
       var; maskeyi her birinin sonrasına ayrı ayrı eklemek yerine sarmalamak
       hem kısa hem de yeni bir katman türü eklendiğinde unutulamaz. */
    _drawEntry(e, audio, cfg, t, dt, live) {
      const l = live || e.layer;
      this._drawEntryRaw(e, audio, cfg, t, dt, l);
      this._applyMask(e, l);
      this._applyLayerFX(e, l, audio, t, dt);
    }

    /* Katmana özel efekt zinciri.

       Tek bir paylaşılan PostFX örneği sırayla kullanılıyor: katman başına
       ayrı bir WebGL bağlamı açmak, on katmanlı bir sahnede on bağlam demek
       olurdu ve tarayıcılar eşzamanlı bağlam sayısını sınırlıyor. */
    _applyLayerFX(e, l, audio, t, dt) {
      const chain = Array.isArray(l.postfx) ? l.postfx.filter((f) => f && f.enabled !== false) : [];
      if (!chain.length || !e.canvas || !window.SVPostFX) return;
      if (!this.layerFx) this.layerFx = new window.SVPostFX.PostFX();
      const fx = this.layerFx;
      fx.setChain(chain);
      if (!fx.hasWork()) return;
      fx.resize(this.width, this.height);
      if (!fx.render(e.canvas, audio, t, dt)) return;
      const ctx = e.ctx || (e.canvas.getContext ? e.canvas.getContext('2d') : null);
      if (!ctx) return;
      ctx.save();
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.globalCompositeOperation = 'copy';
      ctx.globalAlpha = 1;
      ctx.drawImage(fx.canvas, 0, 0, this.width, this.height);
      ctx.restore();
    }

    // Katmanı kendi tuvaline çizer (her iki yol da bunu kullanır)
    _drawEntryRaw(e, audio, cfg, t, dt, live) {
      const l = live || e.layer;
      const lcfg = layerConfig(cfg, l);
      const W = this.width;
      const H = this.height;

      if (l.kind === 'background') {
        if (e.gl && e.mode) { e.mode.draw(audio, lcfg, t); return; }
        if (e.mode) { e.mode.draw(e.ctx, audio, lcfg, t, W, H, dt); return; }
        /* Şeffaf arkaplanda düz renk BOYANMAZ; boyasaydık pencerenin
           şeffaflığı bir işe yaramaz, altındaki masaüstü görünmezdi. */
        if (lcfg.background && lcfg.background.transparent) {
          e.ctx.clearRect(0, 0, W, H);
          return;
        }
        // düz renk
        e.ctx.fillStyle = (lcfg.background && lcfg.background.solidColor) || '#000000';
        e.ctx.fillRect(0, 0, W, H);
        return;
      }

      if (l.kind === 'visualizer') {
        if (!e.mode) { e.ctx.clearRect(0, 0, W, H); return; }
        if (!audio || !audio.ready) { e.ctx.clearRect(0, 0, W, H); return; }
        e.mode.draw(audio, lcfg, t, dt);
        return;
      }

      if (l.kind === 'media') {
        e.ctx.clearRect(0, 0, W, H);
        if (this.media) this.media.draw(e.ctx, audio, lcfg, W, H, t);
        return;
      }

      if (l.kind === 'sprites') {
        e.ctx.clearRect(0, 0, W, H);
        if (this.sprites && audio && audio.ready && this.sprites.hasLayer(l.type)) {
          this.sprites.draw(e.ctx, audio, t, W, H, l.type);
        }
        return;
      }

      if (l.kind === 'logo') {
        e.ctx.clearRect(0, 0, W, H);
        const lg = (l.settings && l.settings.logo) || cfg.logo;
        if (!lg || !lg.src) return;
        const img = this._getImage(lg.src);
        if (!img || !img.naturalWidth) return;
        const minDim = Math.min(W, H);
        const scale = Math.max(0.02, Math.min(1.5, lg.scale == null ? 0.22 : lg.scale));
        const pulse = 1 + (audio ? audio.bass : 0) * (lg.pulse == null ? 0.3 : lg.pulse);
        const size = minDim * scale * pulse;
        const aspect = img.naturalHeight / img.naturalWidth;
        const w = size;
        const h = w * aspect;
        const x = (lg.x == null ? 0.5 : lg.x) * W;
        const y = (lg.y == null ? 0.5 : lg.y) * H;
        const opacity = Math.max(0, Math.min(1, lg.opacity == null ? 1 : lg.opacity));

        e.ctx.save();
        e.ctx.globalAlpha = opacity;
        if (lg.glow && lg.glow > 0) {
          e.ctx.shadowColor = 'rgba(255,255,255,0.7)';
          e.ctx.shadowBlur = lg.glow * 40 * (minDim / 1080);
        }
        e.ctx.drawImage(img, x - w / 2, y - h / 2, w, h);
        e.ctx.restore();
        return;
      }
    }

    /* Çevrimdışı birleştirme (dışa aktarıcı). Katmanlar tek bir hedef tuvale
       CSS ile aynı karışım adlarıyla basılır. */
    drawTo(ctx, audio, cfg, t, dt, drawLogo) {
      const W = this.width;
      const H = this.height;
      ctx.save();
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.globalCompositeOperation = 'source-over';
      ctx.globalAlpha = 1;
      ctx.clearRect(0, 0, W, H);
      /* Çizilecek katman yoksa yüzey SAYDAM kalırdı. Karartma tam bunu
         üretir: bütün katmanlar kapanır, geçişin varış sahnesi saydam olur
         ve çapraz geçiş görünürde hiçbir şey yapmaz — süre dolunca sahne
         birden kararır. Kompozisyonun zemini siyahtır; saydam yayın kipi
         bunun tek istisnasıdır. */
      if (!this.entries.length && !(cfg && cfg.background && cfg.background.type === 'transparent')) {
        ctx.fillStyle = '#000';
        ctx.fillRect(0, 0, W, H);
      }
      ctx.restore();

      for (const e of this.entries) {
        const l = this._live(e, cfg);
        this._drawEntry(e, audio, cfg, t, dt, l);
        if (!e.canvas) continue;

        const d = this._dynamics(l, audio, cfg);
        ctx.save();
        ctx.globalCompositeOperation = CANVAS_BLEND(l.blend);
        ctx.globalAlpha = d.opacity;
        if (this._hasTransform(d)) {
          ctx.translate(W / 2 + d.x * W, H / 2 + d.y * H);
          ctx.rotate((d.rotate * Math.PI) / 180);
          ctx.scale(d.flipX ? -d.scale : d.scale, d.flipY ? -d.scale : d.scale);
          ctx.drawImage(e.canvas, -W / 2, -H / 2, W, H);
        } else {
          ctx.drawImage(e.canvas, 0, 0, W, H);
        }
        ctx.restore();
      }
    }

    /* Çevrimdışı birleştirme + sahne geçişi.

       Dışa aktarıcı bunu çağırır: drawTo() ham birleştirmeyi yapar, burada
       üstüne varsa geçiş biner. Geçiş ilerlemesi dt üzerinden hesaplandığı ve
       dışa aktarıcıda dt = 1/fps olduğu için sonuç kare kare belirlenimlidir. */
    composeTo(ctx, audio, cfg, t, dt, drawLogo) {
      const tick = this._tickTransition(dt);
      if (!tick) { this.drawTo(ctx, audio, cfg, t, dt, drawLogo); return; }
      const tr = tick.tr;
      this._ensureComp();
      if (this.compCanvas.width !== this.width || this.compCanvas.height !== this.height) {
        this.compCanvas.width = this.width;
        this.compCanvas.height = this.height;
      }
      this.drawTo(this.compCtx, audio, cfg, t, dt, drawLogo);
      this._ensureTrans();
      tr.stack.width = this.width;
      tr.stack.height = this.height;
      tr.stack.drawTo(this.transOutCtx, audio, tr.cfg, t, dt, drawLogo);
      this.compositor.compose(ctx, this.transOut, this.compCanvas,
        this.width, this.height, tr.type, tick.p, tr.opts);
    }

    // Shader tabanlı katmanlara medya görüntüsünü bağla (sv_media / iChannel3)
    bindMedia(videoEl) {
      for (const e of this.entries) {
        if (e.mode && e.mode.host && e.mode.host.setMedia) e.mode.host.setMedia(videoEl);
      }
    }

    // Dynamic Lighting arkaplan rengi ister: en alttaki arkaplan katmanı bildirir
    palette(cfg) {
      for (const e of this.entries) {
        if (e.layer.kind !== 'background') continue;
        if (e.gl && e.mode && typeof e.mode.sampleColors === 'function') return e.mode.sampleColors(48);
        if (e.mode && typeof e.mode.palette === 'function') return e.mode.palette(layerConfig(cfg, e.layer));
      }
      return [];
    }

    dispose() {
      for (const e of this.entries) this._disposeEntry(e);
      this.entries = [];
      if (this.postfx) { this.postfx.dispose(); this.postfx = null; }
    }
  }

  const api = {
    LayerStack,
    BLEND_MODES,
    KINDS,
    normalizeLayer,
    newLayerId,
    synthesize,
    resolve,
    stackOn,
    layerConfig,
    sceneSignature,
    groupGain,
    LAYER_DEFAULTS,
  };
  /* Saf yardımcılar (katman çözümleme, sıra, grup kazancı) Node'da test
     edilebilsin diye ayrıca dışa aktarılıyor; LayerStack sınıfı tuval
     gerektirdiği için testlerde kullanılmaz. */
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (typeof window !== 'undefined') window.SVLayers = api;
})();
