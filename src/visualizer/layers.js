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
  };

  function normalizeLayer(l) {
    const out = Object.assign({}, LAYER_DEFAULTS, l || {});
    out.transform = Object.assign({}, LAYER_DEFAULTS.transform, (l && l.transform) || {});
    out.audio = Object.assign({}, LAYER_DEFAULTS.audio, (l && l.audio) || {});
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

  // Etkin katman listesi: kullanıcı tanımlıysa o, değilse sentez
  function resolve(cfg) {
    const list = cfg && Array.isArray(cfg.layers) ? cfg.layers : [];
    const used = list.length ? list.map(normalizeLayer) : synthesize(cfg);
    return used.filter((l) => l.enabled !== false);
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
      ? cfg.layers.map((l) => (l.kind || '') + '.' + (l.type || '') + '.' + (l.presetId || '')).join(',')
      : '';
    const grad = ((b.gradient && b.gradient.colors) || []).join(',');
    return [v.type, b.type, c.visualizerId, c.backgroundId, g.family, g.formula, layers, grad].join('|');
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
      if (T && spec && spec.enabled !== false && spec.type && spec.type !== 'cut' &&
          this.lastSig && scnSig !== this.lastSig && this.entries.length && this.prevCfg) {
        this.beginTransition(this.prevCfg, {
          type: spec.type,
          duration: T.durationSeconds(cfg, this.bpm || (spec.bpm || 0)),
          opts: spec.params || {},
          ease: spec.ease,
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
      if (layer.kind === 'logo') return e; // logo bir <img>, tuval değil

      e.canvas = this._makeCanvas();
      if (this.container) this.container.appendChild(e.canvas);

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

    _dynamics(layer, audio) {
      const t = layer.transform;
      const a = layer.audio;
      const band = bandValue(audio, a.band);
      const opacity = Math.max(0, Math.min(1, layer.opacity * (1 + (a.opacity || 0) * (band * 2 - 1))));
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
      if (!this.entries.length) return;
      const out = new LayerStack(null, this.opts);
      out.entries = this.entries;
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

    /* Bir kare çiz (canlı yol). Katmanlar kendi tuvallerine çizer; karıştırma
       ve dönüşüm CSS ile tarayıcının kompozitörüne bırakılır. */
    draw(audio, cfg, t, dt) {
      const tick = this._tickTransition(dt);
      const fxOn = !!(this.postfx && this.postfx.hasWork());
      const single = fxOn || !!tick || this._mapping || this._forceSingle;

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

      for (const e of this.entries) {
        const l = this._live(e, cfg);
        if (l.kind === 'logo') {
          if (this.logoEl) {
            const d = this._dynamics(l, audio);
            this.logoEl.style.opacity = String(d.opacity * (cfg.logo ? cfg.logo.opacity : 1));
          }
          continue;
        }
        this._drawEntry(e, audio, cfg, t, dt, l);

        if (this.container && e.canvas) {
          const d = this._dynamics(l, audio);
          e.canvas.style.opacity = d.opacity === 1 ? '' : d.opacity.toFixed(3);
          e.canvas.style.transform = this._hasTransform(d)
            ? `translate(${d.x * 100}%, ${d.y * 100}%) rotate(${d.rotate}deg) scale(${d.flipX ? -d.scale : d.scale}, ${d.flipY ? -d.scale : d.scale})`
            : '';
        }
      }
    }

    // Tek bir katmanı kendi tuvaline çizer (her iki yol da bunu kullanır)
    _drawEntry(e, audio, cfg, t, dt, live) {
      const l = live || e.layer;
      const lcfg = layerConfig(cfg, l);
      const W = this.width;
      const H = this.height;

      if (l.kind === 'background') {
        if (e.gl && e.mode) { e.mode.draw(audio, lcfg, t); return; }
        if (e.mode) { e.mode.draw(e.ctx, audio, lcfg, t, W, H, dt); return; }
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
      ctx.restore();

      for (const e of this.entries) {
        const l = this._live(e, cfg);
        if (l.kind === 'logo') { if (drawLogo) drawLogo(ctx); continue; }
        this._drawEntry(e, audio, cfg, t, dt, l);
        if (!e.canvas) continue;

        const d = this._dynamics(l, audio);
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

  window.SVLayers = {
    LayerStack,
    BLEND_MODES,
    KINDS,
    normalizeLayer,
    newLayerId,
    synthesize,
    resolve,
    layerConfig,
    sceneSignature,
    LAYER_DEFAULTS,
  };
})();
