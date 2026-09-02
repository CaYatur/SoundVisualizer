'use strict';
/* Klip destesi — saf veri ve saf aritmetik.
 *
 * Zaman çizelgesiyle AYNI saati ve AYNI niceleyiciyi kullanır. Deste kendi
 * saatini tutsaydı iki yüzey birbirinden kayar ve "aynı vuruşta" ateşlenen
 * şeyler görünür şekilde ayrışırdı; bu yüzden buradaki her zaman değeri
 * dışarıdan verilen taşımadan (SVTimeline.Transport) okunur.
 *
 * Seyrek ızgara: boş yuvalar SAKLANMAZ. 8x8 bir deste tek bir klip içeriyorsa
 * gösteri dosyasında 64 değil 1 kayıt olur.
 */
(function () {
  const CD_EPS = 1e-9;

  function num(v, fallback) {
    v = Number(v);
    return isFinite(v) ? v : fallback;
  }
  function clamp(v, lo, hi) {
    v = num(v, lo);
    return v < lo ? lo : v > hi ? hi : v;
  }

  function TL() {
    if (typeof window !== 'undefined' && window.SVTimeline) return window.SVTimeline;
    try {
      return require('./timeline.js');
    } catch (e) {
      return null;
    }
  }

  // ==========================================================================
  // Niceleme (quantise)
  //
  // Vuruş cinsinden ızgara. "next" = bir sonraki ızgara çizgisi; klibin şu an
  // ateşlenmesi istense bile müzikal sınıra kadar bekler.
  // ==========================================================================
  const QUANTIZE = {
    off: 0,
    frame: -1, // özel: bir sonraki karede
    quarter: 0.25,
    half: 0.5,
    beat: 1,
    bar: null, // ölçü uzunluğu tempo haritasından gelir
    bar2: null,
    bar4: null,
  };
  const QUANTIZE_IDS = ['off', 'frame', 'quarter', 'half', 'beat', 'bar', 'bar2', 'bar4'];

  function quantizeBeats(mode, beatsPerBar) {
    const bpb = Math.max(1, num(beatsPerBar, 4));
    if (mode === 'bar') return bpb;
    if (mode === 'bar2') return bpb * 2;
    if (mode === 'bar4') return bpb * 4;
    const q = QUANTIZE[mode];
    return typeof q === 'number' && q > 0 ? q : 0;
  }

  /* Şu anki zamandan sonraki ilk ızgara çizgisinin ZAMANI (saniye).
     'off' ve 'frame' anında döner — çağıran taraf ikisini ayırt eder. */
  function nextGridTime(tempoMap, now, mode) {
    const tl = TL();
    if (!tl || !mode || mode === 'off' || mode === 'frame') return now;
    const beat = tl.secondsToBeats(tempoMap, now);
    const seg = tempoMap[0] || { beatsPerBar: 4 };
    let bpb = seg.beatsPerBar;
    for (const s of tempoMap) if (s.t <= now + CD_EPS) bpb = s.beatsPerBar;
    const div = quantizeBeats(mode, bpb);
    if (!div) return now;
    /* Tam ızgara üstündeysek BİR SONRAKİ çizgiye git, yerinde durma: aksi
       halde operatör vuruşa tam basınca klip hiç beklemez ve niceleme
       rastgele davranıyormuş gibi görünür. */
    const nextIdx = Math.floor(beat / div + CD_EPS) + 1;
    return tl.beatsToSeconds(tempoMap, nextIdx * div);
  }

  // ==========================================================================
  // Yuva (slot)
  // ==========================================================================
  const CLIP_TYPES = ['scene', 'preset', 'palette', 'video', 'image', 'shader', 'action'];

  /* Tür başına makul varsayılan geçiş süresi. Video ve görüntü sert kesildiğinde
     rahatsız edici olduğu için kısa bir geçiş alır; sahne değişimi zaten kendi
     geçiş motorunu kullandığından 0 gelir ve oradaki ayar geçerli olur. */
  const DEFAULT_FADE = { scene: 0, preset: 0.25, palette: 0.25, video: 0.35, image: 0.35, shader: 0.25, action: 0 };

  const FOLLOW_ACTIONS = ['stop', 'loop', 'next', 'random', 'goto', 'none'];

  function makeSlot(spec) {
    const s = spec || {};
    const type = CLIP_TYPES.indexOf(s.type) >= 0 ? s.type : 'scene';
    return {
      row: Math.max(0, Math.round(num(s.row, 0))),
      col: Math.max(0, Math.round(num(s.col, 0))),
      name: typeof s.name === 'string' ? s.name : '',
      type,
      ref: typeof s.ref === 'string' ? s.ref : '',
      quantize: QUANTIZE_IDS.indexOf(s.quantize) >= 0 ? s.quantize : 'bar',
      /* 'cut' gerçek kesmedir: tek karelik harman bile yapılmaz. Geçiş adı
         verilirse mevcut geçiş motorunun 18 geçişinden biri kullanılır. */
      trigger: s.trigger === 'cut' ? 'cut' : 'fade',
      transition: typeof s.transition === 'string' ? s.transition : '',
      fade: s.fade == null ? DEFAULT_FADE[type] : clamp(s.fade, 0, 30),
      dur: s.dur == null ? null : Math.max(0.05, num(s.dur, 4)),
      follow: FOLLOW_ACTIONS.indexOf(s.follow) >= 0 ? s.follow : 'none',
      followTarget: typeof s.followTarget === 'string' ? s.followTarget : '',
    };
  }

  function slotKey(row, col) {
    return row + ':' + col;
  }

  // ==========================================================================
  // Deste
  // ==========================================================================
  function makeDeck(spec) {
    const s = spec || {};
    const rows = clamp(Math.round(num(s.rows, 8)), 1, 64);
    const cols = clamp(Math.round(num(s.cols, 8)), 1, 64);
    const slots = {};
    const src = s.slots;
    if (Array.isArray(src)) {
      for (const raw of src) {
        const sl = makeSlot(raw);
        if (sl.row < rows && sl.col < cols) slots[slotKey(sl.row, sl.col)] = sl;
      }
    } else if (src && typeof src === 'object') {
      for (const k of Object.keys(src)) {
        const sl = makeSlot(src[k]);
        if (sl.row < rows && sl.col < cols) slots[slotKey(sl.row, sl.col)] = sl;
      }
    }
    return {
      id: typeof s.id === 'string' && s.id ? s.id : 'deck',
      name: typeof s.name === 'string' ? s.name : 'A',
      rows,
      cols,
      slots,
      /* Satır adları: bir satır "Giriş" ya da "Nakarat" diye okunabilsin,
         "3. satır" değil. Yalnızca adı olanlar saklanır. */
      rowNames: s.rowNames && typeof s.rowNames === 'object' ? Object.assign({}, s.rowNames) : {},
    };
  }

  function getSlot(deck, row, col) {
    return deck.slots[slotKey(row, col)] || null;
  }
  function setSlot(deck, row, col, spec) {
    if (row < 0 || col < 0 || row >= deck.rows || col >= deck.cols) return null;
    if (spec == null) {
      delete deck.slots[slotKey(row, col)];
      return null;
    }
    const sl = makeSlot(Object.assign({}, spec, { row, col }));
    deck.slots[slotKey(row, col)] = sl;
    return sl;
  }
  function slotList(deck) {
    return Object.keys(deck.slots)
      .map((k) => deck.slots[k])
      .sort((a, b) => a.row - b.row || a.col - b.col);
  }

  /* Seyrek kaydetme: boş yuvalar dosyaya hiç yazılmaz. */
  function serializeDeck(deck) {
    return {
      id: deck.id,
      name: deck.name,
      rows: deck.rows,
      cols: deck.cols,
      rowNames: deck.rowNames,
      slots: slotList(deck),
    };
  }

  // ==========================================================================
  // Çalıştırıcı (engine)
  //
  // Kendi zamanlayıcısı yok. Her karede `update(now, tempoMap)` çağrılır ve
  // `now` taşımadan gelir. Böylece çevrimdışı dışa aktarımda da aynı kareler
  // aynı ateşlemeleri üretir.
  // ==========================================================================
  function Engine(opts) {
    const o = opts || {};
    this.decks = (Array.isArray(o.decks) ? o.decks : []).map(makeDeck);
    if (!this.decks.length) this.decks = [makeDeck({ id: 'deck', name: 'A' })];
    /* Sütun başına ÇALAN yuva. Bir sütunda aynı anda tek klip çalar: sütun
       bir katman gibi düşünülür. */
    this.active = {}; // 'deckId:col' -> { slot, startedAt }
    this.armed = []; // { deckId, slot, at }
    this.listeners = [];
    /* Takip eylemi koruması: aynı yuva aynı anda tekrar tekrar tetiklenirse
       (süresi 0'a yakın bir klip + 'next' zinciri) kare başına sonsuz döngü
       oluşur. Kare başına ateşleme sayısı sınırlanır. */
    this.maxFiresPerUpdate = 32;
  }

  Engine.prototype.on = function (fn) {
    if (typeof fn === 'function') this.listeners.push(fn);
    return this;
  };
  Engine.prototype.emit = function (type, payload) {
    for (const fn of this.listeners) {
      try {
        fn(type, payload);
      } catch (e) {
        /* Bir dinleyicinin hatası ateşlemeyi durdurmamalı */
      }
    }
  };

  Engine.prototype.deck = function (id) {
    return this.decks.find((d) => d.id === id) || this.decks[0];
  };

  /* Yuvayı ATEŞLEMEYE HAZIRLA. Niceleme kapalıysa hemen çalar; değilse bir
     sonraki ızgara çizgisine kuyruğa girer ve geri sayım görünür olur. */
  Engine.prototype.launch = function (deckId, row, col, now, tempoMap) {
    const deck = this.deck(deckId);
    const slot = getSlot(deck, row, col);
    if (!slot) return null;
    const at =
      slot.quantize === 'off' || slot.quantize === 'frame'
        ? now
        : nextGridTime(tempoMap, now, slot.quantize);
    /* Aynı sütunda bekleyen başka bir yuva varsa onu değiştir: operatör
       fikrini değiştirdiğinde iki klip birden ateşlenmemeli. */
    this.armed = this.armed.filter((a) => !(a.deckId === deck.id && a.slot.col === slot.col));
    const entry = { deckId: deck.id, slot, at };
    this.armed.push(entry);
    this.emit('armed', entry);
    return entry;
  };

  /* SÜTUN başlatma: satırdaki tüm yuvalar TEK bir zamanda hizalanır.
     Her yuva kendi nicelemesini kullansaydı satır görünür şekilde dağılırdı;
     bu yüzden satırın en uzun nicelemesi hepsine uygulanır. */
  Engine.prototype.launchRow = function (deckId, row, now, tempoMap) {
    const deck = this.deck(deckId);
    const slots = [];
    for (let c = 0; c < deck.cols; c++) {
      const s = getSlot(deck, row, c);
      if (s) slots.push(s);
    }
    if (!slots.length) return [];
    let at = now;
    for (const s of slots) {
      if (s.quantize === 'off' || s.quantize === 'frame') continue;
      at = Math.max(at, nextGridTime(tempoMap, now, s.quantize));
    }
    const out = [];
    for (const s of slots) {
      this.armed = this.armed.filter((a) => !(a.deckId === deck.id && a.slot.col === s.col));
      const entry = { deckId: deck.id, slot: s, at, row };
      this.armed.push(entry);
      out.push(entry);
    }
    this.emit('rowArmed', { deckId: deck.id, row, at, count: out.length });
    return out;
  };

  Engine.prototype.stopColumn = function (deckId, col) {
    const deck = this.deck(deckId);
    const key = deck.id + ':' + col;
    this.armed = this.armed.filter((a) => !(a.deckId === deck.id && a.slot.col === col));
    if (this.active[key]) {
      const prev = this.active[key];
      delete this.active[key];
      this.emit('stopped', { deckId: deck.id, col, slot: prev.slot });
    }
  };

  Engine.prototype.stopAll = function () {
    this.armed = [];
    for (const key of Object.keys(this.active)) {
      const prev = this.active[key];
      delete this.active[key];
      this.emit('stopped', { deckId: prev.deckId, col: prev.slot.col, slot: prev.slot });
    }
  };

  /* Hazırlanmış yuvanın ateşlenmesine kalan süre (saniye). Geri sayımı
     gösteren arayüz bunu okur. */
  Engine.prototype.countdown = function (deckId, row, col, now) {
    const a = this.armed.find((x) => x.deckId === deckId && x.slot.row === row && x.slot.col === col);
    return a ? Math.max(0, a.at - now) : null;
  };

  Engine.prototype.fire = function (entry, now) {
    const key = entry.deckId + ':' + entry.slot.col;
    const prev = this.active[key] || null;
    this.active[key] = { deckId: entry.deckId, slot: entry.slot, startedAt: now };
    this.emit('fire', {
      deckId: entry.deckId,
      slot: entry.slot,
      previous: prev ? prev.slot : null,
      at: now,
      /* 'cut' gerçek kesme: süre 0 verilir, çizim tarafı harman yapmaz. */
      fade: entry.slot.trigger === 'cut' ? 0 : entry.slot.fade,
      transition: entry.slot.trigger === 'cut' ? 'cut' : entry.slot.transition,
    });
  };

  Engine.prototype.followFrom = function (deckId, slot, now, tempoMap) {
    const deck = this.deck(deckId);
    if (slot.follow === 'loop') return this.launch(deckId, slot.row, slot.col, now, tempoMap);
    if (slot.follow === 'next') {
      for (let r = slot.row + 1; r < deck.rows; r++) {
        if (getSlot(deck, r, slot.col)) return this.launch(deckId, r, slot.col, now, tempoMap);
      }
      return null;
    }
    if (slot.follow === 'random') {
      const candidates = [];
      for (let r = 0; r < deck.rows; r++) {
        if (r !== slot.row && getSlot(deck, r, slot.col)) candidates.push(r);
      }
      if (!candidates.length) return null;
      /* Seçim `now`dan türetilir, Math.random'dan değil: çevrimdışı dışa
         aktarım aynı gösteriyi iki kez işlediğinde aynı kareleri üretmeli. */
      const idx = Math.abs(Math.floor(now * 1000)) % candidates.length;
      return this.launch(deckId, candidates[idx], slot.col, now, tempoMap);
    }
    if (slot.follow === 'goto' && slot.followTarget) {
      const parts = String(slot.followTarget).split(':');
      const r = Math.round(num(parts[0], -1));
      const c = parts.length > 1 ? Math.round(num(parts[1], slot.col)) : slot.col;
      if (r >= 0 && getSlot(deck, r, c)) return this.launch(deckId, r, c, now, tempoMap);
      return null;
    }
    return null; // 'stop' ve 'none'
  };

  /* Her karede bir kez. Hazırlananları zamanı gelmişse ateşler, süresi dolan
     kliplerin takip eylemini işletir. */
  Engine.prototype.update = function (now, tempoMap) {
    let fired = 0;

    // 1) Zamanı gelen hazırlıklar
    const due = this.armed.filter((a) => a.at <= now + CD_EPS);
    if (due.length) {
      this.armed = this.armed.filter((a) => a.at > now + CD_EPS);
      for (const entry of due) {
        if (fired >= this.maxFiresPerUpdate) break;
        this.fire(entry, now);
        fired++;
      }
    }

    // 2) Süresi dolan klipler -> takip eylemi
    for (const key of Object.keys(this.active)) {
      if (fired >= this.maxFiresPerUpdate) break;
      const a = this.active[key];
      const dur = a.slot.dur;
      if (dur == null) continue; // süresiz: kendiliğinden bitmez
      if (now - a.startedAt < dur - CD_EPS) continue;
      const slot = a.slot;
      if (slot.follow === 'stop') {
        delete this.active[key];
        this.emit('stopped', { deckId: a.deckId, col: slot.col, slot });
        continue;
      }
      if (slot.follow === 'none') {
        /* Takip eylemi yoksa klip yerinde kalır ama süresi tekrar tekrar
           dolmaz: başlangıcı ileri alınır, yoksa her karede buraya düşerdi. */
        a.startedAt = now;
        continue;
      }
      a.startedAt = now;
      if (this.followFrom(a.deckId, slot, now, tempoMap)) fired++;
    }

    if (fired >= this.maxFiresPerUpdate) {
      /* Buraya gelmek bir yapılandırma hatasıdır (sıfıra yakın süreli bir
         'next' zinciri gibi). Sessizce döngüye girmek yerine bildir. */
      this.emit('overrun', { at: now, limit: this.maxFiresPerUpdate });
    }
    return fired;
  };

  Engine.prototype.activeSlots = function () {
    return Object.keys(this.active).map((k) => this.active[k]);
  };

  // ==========================================================================
  // Köprü: deste etkinliğini zaman çizelgesine kaydet
  //
  // Doğaçlanmış bir set, düzenlenebilir bir sete dönüşsün diye. Kayıt sırasında
  // her ateşleme bir klip başlangıcı, aynı sütundaki bir sonraki ateşleme ise
  // öncekinin bitişidir.
  // ==========================================================================
  function Recorder() {
    this.rows = [];
  }
  Recorder.prototype.note = function (deckId, slot, at) {
    // Aynı sütunda açık kalan kaydı kapat
    for (let i = this.rows.length - 1; i >= 0; i--) {
      const r = this.rows[i];
      if (r.deckId === deckId && r.col === slot.col && r.end == null) {
        r.end = at;
        break;
      }
    }
    this.rows.push({ deckId, col: slot.col, slot, start: at, end: null });
  };
  Recorder.prototype.close = function (at) {
    for (const r of this.rows) if (r.end == null) r.end = at;
  };
  /* Kaydı zaman çizelgesi parçalarına çevir: sütun başına bir parça. */
  Recorder.prototype.toTracks = function (at) {
    this.close(at);
    const tl = TL();
    if (!tl) return [];
    const byCol = new Map();
    for (const r of this.rows) {
      const key = r.deckId + ':' + r.col;
      if (!byCol.has(key)) byCol.set(key, []);
      byCol.get(key).push(r);
    }
    const out = [];
    for (const [key, list] of byCol) {
      out.push(
        tl.makeTrack({
          kind: 'clip',
          name: 'Deste ' + key,
          clips: list
            .filter((r) => r.end > r.start + CD_EPS)
            .map((r) =>
              tl.makeClip({
                start: r.start,
                dur: r.end - r.start,
                type: r.slot.type,
                ref: r.slot.ref,
                name: r.slot.name,
                fade: r.slot.trigger === 'cut' ? 0 : r.slot.fade,
              })
            ),
        })
      );
    }
    return out;
  };

  const api = {
    QUANTIZE_IDS,
    quantizeBeats,
    nextGridTime,
    CLIP_TYPES,
    FOLLOW_ACTIONS,
    DEFAULT_FADE,
    makeSlot,
    makeDeck,
    getSlot,
    setSlot,
    slotList,
    serializeDeck,
    slotKey,
    Engine,
    Recorder,
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (typeof window !== 'undefined') window.SVClipDeck = api;
})();
