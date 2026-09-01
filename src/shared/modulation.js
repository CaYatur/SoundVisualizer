'use strict';
/* Modülasyon matrisi — herhangi bir kaynaktan herhangi bir ayara.

   Şimdiye kadar bir mod sese yalnızca yazarının kodladığı biçimde tepki
   veriyordu. Bu modül aradaki yönlendirme katmanı: her mod, efekt, arkaplan,
   palet ve formül parametresi kullanıcının bası, bir LFO'yu, bir MIDI düğmesini
   ya da vuruş saatini bağlayabileceği bir HEDEF haline geliyor.

   Üç parça var:

     Kaynak (source)  — kare başına 0..1 (ya da çift kutuplu -1..1) bir sayı
                        üreten şey: ses bantları, spektrum kutuları, LFO'lar,
                        zarflar, rastgele üreteçler, makro düğmeler, zaman.
     Biçimleme        — kazanç, eğri, yumuşatma, ters çevirme, basamaklama.
     Yönlendirme      — kaynağı noktalı bir yapılandırma yoluna bağlar
                        (ör. "postfx.0.params.strength").

   BELİRLENİMLİLİK
   Çevrimdışı dışa aktarımın kare kare tekrarlanabilir olması tüm görsel
   regresyon ağının dayanağı. Bu yüzden zamana bağlı hiçbir kaynak duvar
   saatini okumaz: LFO'lar doğrudan çizim döngüsünün verdiği `t`'den, rastgele
   üreteçler ise tohumlu bir diziden hesaplanır. Dışa aktarıcıda `t = kare/fps`
   olduğu için aynı sahne her koşuda aynı kareleri verir.

   DEĞİŞMEZLİK
   apply() saklanan yapılandırmayı ASLA değiştirmez; yalnızca dokunulan yol
   boyunca kopya çıkarır (copy-on-write). Böylece kullanıcının kaydettiği
   ayarlar modülasyon yüzünden kaymaz. */
(function () {
  const TAU = Math.PI * 2;
  const NOTE_LABELS = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
  const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
  const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);

  // dt'ye göre üstel yumuşatma katsayısı (kare hızından bağımsız)
  function alphaFor(dt, tau) {
    if (!(tau > 0)) return 1;
    return 1 - Math.exp(-Math.max(0, dt) / tau);
  }

  // ==========================================================================
  // Eğriler — aynı kaynak farklı hedeflerde farklı hissetsin diye
  // ==========================================================================
  const CURVES = {
    linear: (v) => v,
    exp: (v) => v * v,
    exp3: (v) => v * v * v,
    log: (v) => Math.sqrt(clamp01(v)),
    scurve: (v) => v * v * (3 - 2 * clamp01(v)),
    // Ters S: uçlarda hızlı, ortada yavaş
    ease: (v) => 0.5 - Math.cos(clamp01(v) * Math.PI) / 2,
    abs: (v) => Math.abs(v),
  };
  const CURVE_IDS = Object.keys(CURVES);

  // ==========================================================================
  // LFO dalga biçimleri — phase 0..1 girer, -1..1 çıkar
  // ==========================================================================
  const SHAPES = {
    sine: (p) => Math.sin(p * TAU),
    triangle: (p) => 4 * Math.abs(p - Math.floor(p + 0.5)) - 1,
    sawUp: (p) => 2 * (p - Math.floor(p)) - 1,
    sawDown: (p) => 1 - 2 * (p - Math.floor(p)),
    square: (p) => (p - Math.floor(p) < 0.5 ? 1 : -1),
    // Darbe genişliği ayrı verilir; burada varsayılan %25
    pulse: (p, w) => (p - Math.floor(p) < (w == null ? 0.25 : w) ? 1 : -1),
    // Basamaklı ve yumuşak rastgele: tohumlu, bu yüzden tekrarlanabilir
    stepRandom: (p, w, seed) => hashUnit(Math.floor(p) + (seed || 0)) * 2 - 1,
    smoothRandom: (p, w, seed) => {
      const i = Math.floor(p);
      const f = p - i;
      const a = hashUnit(i + (seed || 0)) * 2 - 1;
      const b = hashUnit(i + 1 + (seed || 0)) * 2 - 1;
      const k = f * f * (3 - 2 * f);
      return a + (b - a) * k;
    },
  };
  const SHAPE_IDS = Object.keys(SHAPES);

  /* Tam sayıdan 0..1 — tohumlu ve durumsuz. Aynı adım her zaman aynı sayıyı
     verir; bu, rastgele kaynakların dışa aktarımda tekrarlanabilir olmasını
     sağlar (durum taşıyan bir üreteç kare atlanınca kayardı). */
  function hashUnit(n) {
    let x = (n | 0) * 374761393 + 668265263;
    x = (x ^ (x >>> 13)) >>> 0;
    x = Math.imul(x, 1274126177) >>> 0;
    return ((x ^ (x >>> 16)) >>> 0) / 4294967296;
  }

  // Nota bölümleri: LFO hızını tempoya kilitlerken kullanılır
  const DIVISIONS = [
    { id: '8/1', beats: 32 }, { id: '4/1', beats: 16 }, { id: '2/1', beats: 8 },
    { id: '1/1', beats: 4 }, { id: '1/2', beats: 2 }, { id: '1/2T', beats: 4 / 3 },
    { id: '1/4', beats: 1 }, { id: '1/4T', beats: 2 / 3 }, { id: '1/8', beats: 0.5 },
    { id: '1/8T', beats: 1 / 3 }, { id: '1/16', beats: 0.25 }, { id: '1/16T', beats: 1 / 6 },
    { id: '1/32', beats: 0.125 },
  ];
  const divisionBeats = (id) => {
    const d = DIVISIONS.find((x) => x.id === id);
    return d ? d.beats : 4;
  };

  // ==========================================================================
  // Kaynak kataloğu — panelin listelediği şey
  // ==========================================================================
  function catalog(cfg) {
    const m = (cfg && cfg.modulation) || {};
    const out = [
      { id: 'bass', label: 'Bas', group: 'Ses' },
      { id: 'mid', label: 'Orta', group: 'Ses' },
      { id: 'treble', label: 'Tiz', group: 'Ses' },
      { id: 'level', label: 'Seviye', group: 'Ses' },
      { id: 'onset', label: 'Vuruş Zarfı', group: 'Ses' },
      { id: 'onsetTrig', label: 'Vuruş (tetik)', group: 'Ses', trigger: true },
    ];
    for (let i = 0; i < 8; i++) {
      out.push({ id: 'band' + i, label: 'Bant ' + (i + 1), group: 'Spektrum' });
    }
    const lfos = Array.isArray(m.lfos) ? m.lfos : [];
    for (let i = 0; i < Math.max(4, lfos.length); i++) {
      out.push({ id: 'lfo' + (i + 1), label: 'LFO ' + (i + 1), group: 'LFO', bipolar: true });
    }
    const envs = Array.isArray(m.envelopes) ? m.envelopes : [];
    for (let i = 0; i < Math.max(2, envs.length); i++) {
      out.push({ id: 'env' + (i + 1), label: 'Zarf ' + (i + 1), group: 'Zarf' });
    }
    for (let i = 0; i < 8; i++) {
      const mc = (m.macros || [])[i];
      out.push({ id: 'macro' + (i + 1), label: (mc && mc.name) || ('Makro ' + (i + 1)), group: 'Makro' });
    }
    // Derin çözümleme kaynakları
    const AN = [
      ['anLoudness', 'Gürlük'], ['anPeak', 'Tepe'], ['anDynamics', 'Dinamik'],
      ['anCentroid', 'Tayf Merkezi'], ['anRolloff', 'Yuvarlanma'],
      ['anFlatness', 'Tayf Düzlüğü'], ['anCrest', 'Tepe Faktörü'],
      ['anFlux', 'Tayf Akısı'], ['anSpread', 'Tayf Yayılımı'],
      ['anHarmonic', 'Armonik Oran'], ['anPercussive', 'Vurmalı Oran'],
      ['anWidth', 'Stereo Genişlik'], ['anCorrelation', 'Stereo Korelasyon'],
      ['anPitch', 'Perde'], ['anChordRoot', 'Akor Kökü'], ['anKeyTonic', 'Tonalite'],
      ['anKeyConf', 'Tonalite Güveni'], ['anChordConf', 'Akor Güveni'],
      ['anKick', 'Bas Davul'], ['anSnare', 'Trampet'], ['anHat', 'Hi-Hat'],
    ];
    for (const [id, label] of AN) out.push({ id, label, group: 'Çözümleme' });
    for (let i = 0; i < 12; i++) {
      out.push({ id: 'chroma' + i, label: 'Nota ' + NOTE_LABELS[i], group: 'Nota Sınıfı' });
    }
    out.push(
      { id: 'kickTrig', label: 'Bas Davul (tetik)', group: 'Çözümleme', trigger: true },
      { id: 'snareTrig', label: 'Trampet (tetik)', group: 'Çözümleme', trigger: true },
      { id: 'hatTrig', label: 'Hi-Hat (tetik)', group: 'Çözümleme', trigger: true }
    );

    out.push(
      { id: 'random', label: 'Rastgele (basamaklı)', group: 'Diğer' },
      { id: 'randomSmooth', label: 'Rastgele (yumuşak)', group: 'Diğer' },
      { id: 'time', label: 'Zaman (testere)', group: 'Diğer' },
      { id: 'beatPhase', label: 'Vuruş Fazı', group: 'Tempo' },
      { id: 'barPhase', label: 'Ölçü Fazı', group: 'Tempo' },
      { id: 'const', label: 'Sabit (1.0)', group: 'Diğer' }
    );
    return out;
  }

  // ==========================================================================
  // Yol yardımcıları — dokunulan yol boyunca kopya çıkarır
  // ==========================================================================
  function getIn(root, path) {
    const keys = path.split('.');
    let cur = root;
    for (let i = 0; i < keys.length; i++) {
      if (cur == null) return undefined;
      cur = cur[keys[i]];
    }
    return cur;
  }

  /* setIn: kökten hedefe kadar olan nesneleri kopyalayıp yeni kökü döndürür.
     Dokunulmayan dallar paylaşılır — kare başına tüm yapılandırmayı derin
     kopyalamak gereksiz pahalı olurdu. */
  function setIn(root, path, value) {
    const keys = path.split('.');
    if (getIn(root, path) === undefined) return root; // olmayan yola yazma
    const out = Array.isArray(root) ? root.slice() : Object.assign({}, root);
    let cur = out;
    for (let i = 0; i < keys.length - 1; i++) {
      const k = keys[i];
      const child = cur[k];
      if (child == null || typeof child !== 'object') return root;
      cur[k] = Array.isArray(child) ? child.slice() : Object.assign({}, child);
      cur = cur[k];
    }
    cur[keys[keys.length - 1]] = value;
    return out;
  }

  // ==========================================================================
  // Motor
  // ==========================================================================
  class Modulator {
    constructor() {
      this.values = {};        // kaynak kimliği -> anlık değer
      this.smoothed = {};      // yönlendirme kimliği -> yumuşatılmış değer
      this.triggers = {};      // tetik kaynakları için bu karede ateşlendi mi
      this.onset = null;       // paylaşılan vuruş algılayıcısı (varsa)
      this.bars = null;        // spektrum kutusu önbelleği
      this._beatAcc = 0;       // tempo yoksa serbest koşan vuruş fazı
      this._touched = new Set();
      this.frame = 0;
    }

    reset() {
      this.values = {};
      this.smoothed = {};
      this.triggers = {};
      this._beatAcc = 0;
      this.frame = 0;
      if (this.onset) this.onset.reset();
    }

    /* Kare başına bir kez: tüm kaynakları hesapla.
       clock: { bpm, beatPhase, barPhase } — verilmezse tempo serbest koşar. */
    update(cfg, audio, t, dt, clock) {
      const m = (cfg && cfg.modulation) || {};
      const v = this.values;
      const step = clamp(dt || 0.016, 1 / 1000, 0.25);
      this.frame++;

      // --- ses bantları ---
      v.bass = audio ? audio.bass || 0 : 0;
      v.mid = audio ? audio.mid || 0 : 0;
      v.treble = audio ? audio.treble || 0 : 0;
      v.level = audio ? audio.level || 0 : 0;
      v.const = 1;

      // --- spektrum kutuları ---
      if (audio && typeof audio.getBars === 'function') {
        this.bars = audio.getBars(8, 30, 14000);
        for (let i = 0; i < 8; i++) v['band' + i] = this.bars[i] || 0;
      } else {
        for (let i = 0; i < 8; i++) v['band' + i] = 0;
      }

      // --- vuruş ---
      if (!this.onset && typeof window !== 'undefined' && window.SVOnset) {
        this.onset = new window.SVOnset.Onset({ refractory: 0.1 });
      } else if (!this.onset && typeof require === 'function') {
        try { this.onset = new (require('./onset.js').Onset)({ refractory: 0.1 }); } catch (e) { /* tarayıcı */ }
      }
      let hit = 0;
      if (this.onset) {
        hit = this.onset.push(v.bass, step);
        v.onset = this.onset.energy;
      } else {
        v.onset = v.bass;
      }
      this.triggers.onsetTrig = hit;
      v.onsetTrig = hit > 0 ? 1 : 0;

      // --- tempo fazı ---
      const bpm = clock && clock.bpm > 0 ? clock.bpm : (m.bpm > 0 ? m.bpm : 120);
      if (clock && clock.beatPhase != null) {
        v.beatPhase = clock.beatPhase;
        v.barPhase = clock.barPhase != null ? clock.barPhase : (clock.beatPhase / 4);
      } else {
        this._beatAcc += (step * bpm) / 60;
        v.beatPhase = this._beatAcc - Math.floor(this._beatAcc);
        v.barPhase = (this._beatAcc / 4) - Math.floor(this._beatAcc / 4);
      }

      // --- LFO'lar ---
      const lfos = Array.isArray(m.lfos) ? m.lfos : [];
      for (let i = 0; i < 4; i++) {
        const l = lfos[i] || {};
        const shape = SHAPES[l.shape] ? l.shape : 'sine';
        // Hız: ya serbest Hz ya da nota bölümü cinsinden tempoya kilitli
        const hz = l.sync
          ? bpm / 60 / Math.max(1e-6, divisionBeats(l.division || '1/1'))
          : (l.rate == null ? 0.5 : l.rate);
        const phase = t * hz + (l.phase || 0);
        const raw = SHAPES[shape](phase, l.width, (i + 1) * 7919);
        // Çift kutuplu istenmiyorsa 0..1'e taşı
        v['lfo' + (i + 1)] = l.bipolar ? raw : raw * 0.5 + 0.5;
      }

      // --- zarf takipçileri ---
      const envs = Array.isArray(m.envelopes) ? m.envelopes : [];
      for (let i = 0; i < 2; i++) {
        const e = envs[i] || {};
        const key = 'env' + (i + 1);
        const src = v[e.band || 'bass'] != null ? v[e.band || 'bass'] : v.bass;
        const prev = v[key] || 0;
        const rising = src > prev;
        const tau = Math.max(0.001, (rising ? (e.attack == null ? 0.02 : e.attack) : (e.release == null ? 0.35 : e.release)));
        v[key] = prev + (src - prev) * alphaFor(step, tau);
      }

      // --- makrolar ---
      const macros = Array.isArray(m.macros) ? m.macros : [];
      for (let i = 0; i < 8; i++) {
        const mc = macros[i];
        v['macro' + (i + 1)] = mc && mc.value != null ? clamp01(mc.value) : 0;
      }

      // --- rastgele ---
      const rnd = m.random || {};
      const rHz = rnd.sync ? bpm / 60 / Math.max(1e-6, divisionBeats(rnd.division || '1/1')) : (rnd.rate == null ? 1 : rnd.rate);
      const rPhase = t * rHz;
      v.random = SHAPES.stepRandom(rPhase, 0, 4021) * 0.5 + 0.5;
      v.randomSmooth = SHAPES.smoothRandom(rPhase, 0, 9173) * 0.5 + 0.5;

      // --- zaman ---
      v.time = (t * (m.timeRate == null ? 0.1 : m.timeRate)) % 1;

      /* --- derin çözümleme ---
         Ses motoru bir Analyser taşıyorsa onun ürettiği her şey (kroma,
         tınısal betimleyiciler, gürlük, armonik/vurmalı oranı, davul
         bantları) doğrudan kaynak olur. Motor yoksa bu kaynaklar 0 kalır ve
         yönlendirmeler sessizce çalışmaya devam eder. */
      const an = audio && audio.analysis;
      if (an) {
        const s = an.sources();
        for (const k in s) v[k] = s[k];
        for (let i = 0; i < 12; i++) v['chroma' + i] = an.chromaSmooth[i] || 0;
        this.triggers.kickTrig = an.hits.kick || 0;
        this.triggers.snareTrig = an.hits.snare || 0;
        this.triggers.hatTrig = an.hits.hat || 0;
        v.kickTrig = this.triggers.kickTrig > 0 ? 1 : 0;
        v.snareTrig = this.triggers.snareTrig > 0 ? 1 : 0;
        v.hatTrig = this.triggers.hatTrig > 0 ? 1 : 0;
        // Akor kökü ve tonalite toniği: 0..1'e ölçeklenmiş nota sınıfı.
        // Renk tonuna bağlandığında akor değişimi rengi değiştirir.
        v.anChordRoot = an.chord.root >= 0 ? an.chord.root / 11 : 0;
        v.anKeyTonic = an.key.tonic >= 0 ? an.key.tonic / 11 : 0;
      } else {
        this.triggers.kickTrig = 0;
        this.triggers.snareTrig = 0;
        this.triggers.hatTrig = 0;
      }

      return v;
    }

    // Kaynağın anlık değeri
    value(id) {
      const v = this.values[id];
      return v == null ? 0 : v;
    }

    // Bu karede tetiklenen tetik kaynağının şiddeti (yoksa 0)
    trigger(id) {
      return this.triggers[id] || 0;
    }

    /* Yönlendirmeleri uygula ve yeni yapılandırmayı döndür.
       Saklanan nesne değiştirilmez; yalnızca dokunulan yollar kopyalanır. */
    apply(cfg, dt) {
      const m = (cfg && cfg.modulation) || {};
      if (m.enabled === false) return cfg;
      const routes = Array.isArray(m.routes) ? m.routes : [];
      if (!routes.length) return cfg;

      const step = clamp(dt || 0.016, 1 / 1000, 0.25);
      this._touched.clear();
      let out = cfg;

      for (let i = 0; i < routes.length; i++) {
        const r = routes[i];
        if (!r || r.enabled === false || !r.target) continue;
        const base = getIn(out, r.target);
        if (typeof base !== 'number') continue; // yalnızca sayısal hedefler

        let x = this.value(r.source);
        // Çift kutuplu kaynakları 0..1'e taşımadan eğri uygulanmaz
        const bipolar = x < 0;
        const unit = bipolar ? x * 0.5 + 0.5 : clamp01(x);
        const curve = CURVES[r.curve] || CURVES.linear;
        let shaped = curve(unit);
        if (r.invert) shaped = 1 - shaped;
        if (r.steps > 1) shaped = Math.round(shaped * (r.steps - 1)) / (r.steps - 1);

        // yumuşatma (yönlendirme başına, kare hızından bağımsız)
        const key = r.id || ('r' + i);
        if (r.smooth > 0) {
          const prev = this.smoothed[key] == null ? shaped : this.smoothed[key];
          shaped = prev + (shaped - prev) * alphaFor(step, r.smooth);
        }
        this.smoothed[key] = shaped;

        const amount = r.amount == null ? 1 : r.amount;
        const lo = r.min == null ? 0 : r.min;
        const hi = r.max == null ? 1 : r.max;
        const span = hi - lo;

        if (r.mode === 'add') x = base + span * shaped * amount;
        else if (r.mode === 'mul') x = base * (1 + (shaped * 2 - 1) * amount);
        else x = base + (lo + span * shaped - base) * amount; // 'set' (varsayılan)

        if (r.clamp !== false) x = clamp(x, Math.min(lo, hi), Math.max(lo, hi));
        if (!isFinite(x)) continue;

        out = setIn(out, r.target, x);
        this._touched.add(r.target.split('.')[0]);
      }
      return out;
    }

    // apply() bu karede hangi üst düzey alanlara dokundu (ör. 'postfx')
    touches(key) {
      return this._touched.has(key);
    }
  }

  const api = {
    Modulator, catalog, CURVES, CURVE_IDS, SHAPES, SHAPE_IDS,
    DIVISIONS, divisionBeats, getIn, setIn, alphaFor, hashUnit,
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (typeof window !== 'undefined') window.SVModulation = api;
})();
