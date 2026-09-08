'use strict';
/* Otomatik VJ — ne değişecek, sırada hangisi var, neden değişmiyor.
 *
 * NEDEN AYRI BİR MODÜL
 * Bu mantık panelin içinde, çizim döngüsünün ortasında duruyordu ve
 * sınanamıyordu. Sınanamadığı için de sessizce bozuktu: varsayılan kaynak
 * "Sahneler", kayıtlı sahnesi olmayan bir kullanıcıda seçim listesi boş
 * kalıyor, seçim başarısız oluyor ve HİÇBİR ŞEY OLMUYOR — ekranda da,
 * panelde de tek kelime açıklama yok. "Otomatik VJ çalışmıyor" şikâyetinin
 * kaynağı buydu; motor baştan beri çalışıyordu, söyleyecek ağzı yoktu.
 *
 * Bu yüzden buradaki asıl işlev plan(): ya "şunu şuna değiştireceğim" der,
 * ya da DEĞİŞTİREMEME SEBEBİNİ döndürür. Arayüz o sebebi yazar.
 *
 * SEÇİM MODELİ
 * Her kaynağın isteğe bağlı bir seçim listesi var (picks). Liste boşsa
 * "hepsi" demektir; doluysa yalnızca seçilenler arasında dolaşılır. Tek bir
 * kavramla kullanıcının istediği her durum karşılanıyor: belirli sahneler,
 * birkaç görselleştirici, yalnızca kendi yaptığı paletler.
 *
 * İMLEÇLER KAYNAK BAŞINA AYRI
 * Eskiden tek bir `cursor` hem "sırada hangi öğe var" hem de "all kipinde
 * sırada hangi TÜR var" sorusunu cevaplıyordu. İkisi birbirini bozuyordu:
 * öğe seçimi imleci ilerlettiği için tür dönüşümü düzensiz atlıyordu.
 */
(function () {
  const SOURCES = ['scenes', 'visualizers', 'palettes', 'all'];
  const KINDS = ['scenes', 'visualizers', 'palettes']; // 'all' bunları dolaşır
  const PALETTE_SOURCES = ['both', 'builtin', 'user'];
  const VIS_TARGETS = ['first', 'all'];
  const ORDERS = ['sequential', 'random'];
  const UNITS = ['bars', 'seconds'];

  /* Dolaşılabilecek görselleştiriciler — panelin tür seçicisinin tamamı,
     üç bilinçli dışlamayla:

       none    ekranı boşaltır; bir geçiş değil, kaybolma olurdu.
       text    görselleştirici değil, metin katmanının türü.
       custom  Studio preseti seçilmemişse hiçbir şey çizmiyor
               (shaderhost.js activePreset -> null), yani sıraya girerse
               ekran boşalabilir. Kullanıcı yine de elle seçebilir.

     Eski dolaşım listesi bunların dışında 17 türü daha atlıyordu
     (spectrogram, flowfield, galaxy, dna, milkdrop...) — panelde vardı ama
     Otomatik VJ'ye hiç uğramıyordu. Liste ile seçicinin ayrışması sessiz bir
     hata olduğu için tests/autovj.test.js ikisini karşılaştırıyor. */
  const VISUALIZERS = [
    'bars', 'centerBars', 'blocks', 'dots', 'skyline',
    'wave', 'ribbon', 'wave3d', 'lissajous', 'strings', 'terrain',
    'circular', 'radialWave', 'starburst', 'arcs', 'pinwheel', 'mandala',
    'kaleido', 'vortex', 'helix', 'tunnel', 'orb',
    'particles', 'fireworks', 'lightning', 'bubbles', 'metaball', 'ripplegrid',
    'spectrogram', 'flowfield', 'flock', 'voronoi', 'truchet', 'moire',
    'interference', 'ropes', 'galaxy', 'dna', 'isocity', 'attractorfield',
    'scope', 'goniometer', 'chromawheel', 'geometry', 'milkdrop', 'feedback',
  ];

  const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);
  const num = (v, def) => (Number.isFinite(Number(v)) ? Number(v) : def);
  const pick = (list, v, def) => (list.indexOf(v) >= 0 ? v : def);
  const arr = (v) => (Array.isArray(v) ? v : []);

  function defaults() {
    return {
      enabled: false,
      source: 'visualizers',
      unit: 'bars',
      interval: 8,
      order: 'sequential',
      bpmLock: 0,
      beatsPerBar: 4,
      picks: { scenes: [], visualizers: [], palettes: [] },
      paletteSource: 'both',
      visualizerTargets: 'all',
    };
  }

  /* Yapılandırmayı güvenli hale getirir. Eski ayar dosyalarında picks ve
     yeni alanlar yok; eksikler varsayılana düşer, geçersiz değerler
     kırpılır. */
  function normalize(a) {
    const d = defaults();
    const s = a && typeof a === 'object' ? a : {};
    const p = s.picks && typeof s.picks === 'object' ? s.picks : {};
    return {
      enabled: s.enabled === true,
      source: pick(SOURCES, s.source, d.source),
      unit: pick(UNITS, s.unit, d.unit),
      interval: clamp(Math.round(num(s.interval, d.interval)), 1, 64),
      order: pick(ORDERS, s.order, d.order),
      bpmLock: clamp(Math.round(num(s.bpmLock, 0)), 0, 300),
      beatsPerBar: clamp(Math.round(num(s.beatsPerBar, 4)), 1, 16),
      picks: {
        scenes: arr(p.scenes).map(String),
        visualizers: arr(p.visualizers).filter((v) => VISUALIZERS.indexOf(v) >= 0),
        palettes: arr(p.palettes).map(String),
      },
      paletteSource: pick(PALETTE_SOURCES, s.paletteSource, d.paletteSource),
      visualizerTargets: pick(VIS_TARGETS, s.visualizerTargets, d.visualizerTargets),
    };
  }

  // ------------------------------------------------------------- katmanlar

  /* Metin katmanı da kind:'visualizer' taşıyor; ayırt eden alan type.
     Otomatik VJ bunu bilmiyordu ve kullanıcının METİN KATMANINI bir
     spektrum çizerine dönüştürüyordu — geri alınamayan bir veri kaybı.
     (Kodun geri kalanı bu ayrımı zaten yapıyor, bkz. layers.js:271.) */
  function isTextLayer(l) {
    return !!l && l.kind === 'visualizer' && l.type === 'text';
  }

  /* Değiştirilebilir görselleştirici katmanları. Metin dışlanır, kapalı
     katmanlar da: kapalı bir katmanın türünü değiştirmek ekranda hiçbir şey
     yapmaz ama kullanıcının ayarını sessizce bozar. */
  function visualizerLayers(layers) {
    return arr(layers).filter((l) => l && l.kind === 'visualizer'
      && !isTextLayer(l) && l.enabled !== false);
  }

  // -------------------------------------------------------------- adaylar

  /* Bir kaynağın seçilebilir öğeleri. ctx dış dünyadan gelir:
       scenes           [{ id?, name?, data }]
       builtinPalettes  [{ id?, name?, colors }]
       userPalettes     aynısı
     Dönüş: [{ id, label }] — kimlik seçim listesinde saklanan değer. */
  function catalog(kind, ctx) {
    const c = ctx || {};
    if (kind === 'scenes') {
      return arr(c.scenes).map((s, i) => ({
        id: String((s && (s.id != null ? s.id : s.name)) != null
          ? (s.id != null ? s.id : s.name) : i),
        label: (s && s.name) || ('Sahne ' + (i + 1)),
      }));
    }
    if (kind === 'visualizers') {
      return VISUALIZERS.map((v) => ({ id: v, label: v }));
    }
    if (kind === 'palettes') {
      const mode = pick(PALETTE_SOURCES, c.paletteSource, 'both');
      const out = [];
      const add = (list, tag) => {
        arr(list).forEach((p, i) => {
          if (!p || !Array.isArray(p.colors) || !p.colors.length) return;
          const id = String(p.id != null ? p.id : (tag + ':' + (p.name || i)));
          out.push({ id, label: p.name || id, colors: p.colors, builtin: tag === 'b' });
        });
      };
      if (mode !== 'user') add(c.builtinPalettes, 'b');
      if (mode !== 'builtin') add(c.userPalettes, 'u');
      return out;
    }
    return [];
  }

  /* Seçim uygulanmış aday listesi. Seçim listesi BOŞSA hepsi geçerlidir —
     kullanıcı hiçbir şey seçmemişse "hiçbiri" değil "hepsi" kastediyor.

     Seçilenlerden hiçbiri artık mevcut değilse (silinmiş sahne, kaldırılmış
     palet) yine hepsine düşülür: aksi hâlde kullanıcı, sildiği bir sahne
     yüzünden çalışmayı duran bir Otomatik VJ'yle kalırdı ve sebebi
     görünmezdi. */
  function selected(kind, a, ctx) {
    const all = catalog(kind, ctx);
    const want = normalize(a).picks[kind] || [];
    if (!want.length) return all;
    const set = new Set(want.map(String));
    const hit = all.filter((x) => set.has(String(x.id)));
    return hit.length ? hit : all;
  }

  // ---------------------------------------------------------------- sıra

  /* Sıradaki öğenin dizini.

     Rastgele kipte AYNI öğe üst üste seçilmez. Tek öğelik listede bu
     imkânsız olduğu için orada kural uygulanmaz. Bu kozmetik değil: aynı
     görselleştiriciye ikinci kez geçmek kullanıcıya "durdu" diye görünür ve
     şikâyetin bir parçası tam olarak buydu. */
  function nextIndex(len, order, cursor, previous) {
    if (len <= 0) return -1;
    if (len === 1) return 0;
    if (order === 'random') {
      let i = Math.floor(Math.random() * len);
      if (previous != null && i === previous) i = (i + 1 + Math.floor(Math.random() * (len - 1))) % len;
      return i;
    }
    const c = Number.isFinite(cursor) ? cursor : -1;
    return (c + 1) % len;
  }

  /* 'all' kipinde sıradaki TÜR. Boş türler atlanır: kayıtlı sahnesi olmayan
     bir kullanıcıda "Hepsi" seçiliyken her üç turdan biri boşa gitmemeli.

     "Hepsi" HİÇBİR ZAMAN boş kalamaz, çünkü görselleştirici listesi statik ve
     dış dünyaya bağlı değil — sahnesi ve paleti olmayan bir kullanıcıda bile
     en az bir tür döner. Bu bir varsayım değil, listeden gelen bir güvence;
     yine de görselleştiricilere düşülüyor ki sınanamayan bir hata dalı
     yaratılmasın. */
  function nextKind(a, ctx, kindCursor) {
    const usable = KINDS.filter((k) => selected(k, a, ctx).length > 0);
    const pool = usable.length ? usable : ['visualizers'];
    const c = Number.isFinite(kindCursor) ? kindCursor : -1;
    return pool[(c + 1) % pool.length];
  }

  // ---------------------------------------------------------------- plan

  /* Bir sonraki değişimin planı — ya da neden yapılamadığı.

     state: { cursors: {scenes,visualizers,palettes,all}, last: {kind:index} }
     Dönüş:
       { ok: true, kind, index, item, state }
       { ok: false, code, kind }   code: 'DISABLED' | 'EMPTY' | 'NO_SOURCE'
     Sebep kodu arayüze gider; sessiz başarısızlık kalmaz. */
  function plan(a, ctx, state) {
    const cfg = normalize(a);
    const st = state && typeof state === 'object' ? state : {};
    const cursors = Object.assign({ scenes: -1, visualizers: -1, palettes: -1, all: -1 }, st.cursors);
    const last = Object.assign({}, st.last);

    let kind = cfg.source;
    if (kind === 'all') {
      kind = nextKind(cfg, ctx, cursors.all);
      cursors.all = (Number.isFinite(cursors.all) ? cursors.all : -1) + 1;
    }

    const list = selected(kind, cfg, ctx);
    if (!list.length) return { ok: false, code: 'EMPTY', kind };

    const i = nextIndex(list.length, cfg.order, cursors[kind], last[kind]);
    if (i < 0) return { ok: false, code: 'EMPTY', kind };
    cursors[kind] = i;
    last[kind] = i;

    return { ok: true, kind, index: i, item: list[i], state: { cursors, last } };
  }

  /* Kullanıcının seçtiği kaynak hiç çalışabilir mi? Arayüz bunu ÖNCEDEN
     sorup uyarı yazsın diye ayrı: değişim vaktinin gelmesini beklemek
     gerekmemeli — eski davranışta kullanıcı 8 ölçü bekleyip hiçbir şey
     olmadığını görüyor, sebebini ise hiç öğrenemiyordu. */
  function diagnose(a, ctx) {
    const cfg = normalize(a);
    if (cfg.source === 'all') {
      /* Hepsi her zaman çalışır (bkz. nextKind). Buradaki bilgi "çalışıyor
         mu" değil, HANGİ türlerin sıraya girdiği: sahnesi olmayan kullanıcı
         "sahneler atlanıyor" bilgisini görmeli, yoksa eksik olanın ne
         olduğunu anlayamaz. */
      const usable = KINDS.filter((k) => selected(k, cfg, ctx).length > 0);
      const pool = usable.length ? usable : ['visualizers'];
      return { ok: true, kinds: pool, skipped: KINDS.filter((k) => pool.indexOf(k) < 0) };
    }
    const list = selected(cfg.source, cfg, ctx);
    return list.length
      ? { ok: true, kinds: [cfg.source], count: list.length }
      : { ok: false, code: 'EMPTY', kinds: [cfg.source] };
  }

  const api = {
    SOURCES, KINDS, PALETTE_SOURCES, VIS_TARGETS, ORDERS, UNITS, VISUALIZERS,
    defaults, normalize,
    isTextLayer, visualizerLayers,
    catalog, selected, nextIndex, nextKind, plan, diagnose,
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (typeof window !== 'undefined') window.SVAutoVJRules = api;
})();
