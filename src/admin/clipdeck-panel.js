'use strict';
/* Klip destesi paneli — ızgara, ateşleme, geri sayım ve yuva düzenleyici.
 *
 * SAAT BURADA DEĞİL. Zaman ve tempo, zaman çizelgesi panelinin taşımasından
 * geliyor (SVTimelinePanel.tick çağrısıyla). Deste kendi saatini tutsaydı iki
 * yüzey birbirinden kayar ve aynı vuruşta ateşlenmesi gereken şeyler görünür
 * biçimde ayrışırdı.
 *
 * Izgara DOM ile çiziliyor (zaman çizelgesinin aksine): hücre sayısı küçük ve
 * sınırlı, buna karşılık her hücrenin odaklanabilir bir düğme olması gerekiyor —
 * klavyeyle gezinme ve MIDI öğrenme bunu şart koşuyor.
 *
 * PERFORMANS YÜZEYİ (#637). Resolume'un klip ızgarası ve Ableton'un Session
 * görünümü örnek alındı: adlandırılmış sütunlar, ölçü/vuruş göstergesi ve
 * genel niceleme; hücrede renk, tür, çalma ilerlemesi ve bekleyen yuvanın
 * geri sayımı; boş hücrede "+" ve tek tıkla tür seçimi.
 */
(function () {
  const P = () => window.SVPanel;
  const CD = () => window.SVClipDeck;
  const TE = () => window.SVTimelineEdit;
  const tt = (s) => (window.SVI18n && window.SVI18n.t ? window.SVI18n.t(s) : s);

  let engine = null;
  let selected = null; // { row, col }
  let gridHost = null;
  let headHost = null;
  let recorder = null;
  let lastTick = 0;
  let lastBeatKey = '';

  function cfg() {
    return P().cfg().clipdeck;
  }

  /* Deste kaydı YAPILANDIRMANIN İÇİNDE olmalı (#637). Önce listesi boş
     ya da eksik bir yapılandırmada geçici bir nesne dönüyordu: ızgara
     boyutu, yuvalar ve satır adları ona yazılıyor ve kayboluyordu. Eski ya
     da elle düzenlenmiş dosyada satır adı sözlüğü de eksik olabiliyor. */
  function deckSpec() {
    const c = cfg();
    if (!Array.isArray(c.decks) || !c.decks.length) c.decks = [{ id: 'deck', name: 'A', rows: 6, cols: 6, slots: [], rowNames: {} }];
    const d = c.decks.find((x) => x && x.id === c.activeDeck) || c.decks[0];
    if (!d.rowNames || typeof d.rowNames !== 'object') d.rowNames = {};
    if (!d.colNames || typeof d.colNames !== 'object') d.colNames = {};
    if (!Array.isArray(d.slots)) d.slots = [];
    return d;
  }

  /* Motorun desteleri yapılandırmadan türetilir. İmza değişmedikçe yeniden
     kurulmaz: her karede kurmak, çalan ve hazırlanan yuvaların tuttuğu
     nesneleri her karede değiştirir ve deste kararsız görünürdü. */
  let deckSig = null;

  function signature(list) {
    try {
      return JSON.stringify(list);
    } catch (e) {
      return String(Math.random());
    }
  }

  function ensureEngine() {
    const c = cfg();
    if (!engine) {
      engine = new (CD().Engine)({ decks: c.decks });
      engine.on(onEngineEvent);
      deckSig = signature(c.decks);
    } else {
      const sig = signature(c.decks);
      if (sig !== deckSig) {
        engine.decks = (c.decks || []).map(CD().makeDeck);
        deckSig = sig;
      }
    }
    engine.globalQuantize = CD().QUANTIZE_IDS.indexOf(c.defaultQuantize) >= 0 ? c.defaultQuantize : 'bar';
    return engine;
  }

  function syncEngine() {
    ensureEngine();
  }

  function onEngineEvent(type, payload) {
    if (type === 'fire') {
      applySlot(payload);
      if (cfg().recording && recorder) recorder.note(payload.deckId, payload.slot, payload.at);
    } else if (type === 'overrun') {
      P().toast('Takip eylemi zinciri çok hızlı; ateşleme sınırlandı. Klip sürelerini kontrol edin.', 'warn');
    }
    paintGrid();
  }

  /* Yuvanın/klibin içeriğini uygula.

     Sahne ve şablon TÜM yapılandırmaya etki eder; ne yapacakları belirsiz
     değil. Video, görsel ve shader ise BİR KATMANI hedeflemek zorunda; hangi
     katman olduğu söylenmeden uygulanırsa kullanıcının orada ne varsa üzerine
     yazılır. Bu yüzden model onları tanıyor ama uygulanmıyorlar — arayüz de
     bunu açıkça söylüyor. */
  function applyRef(type, ref) {
    if (!ref) return false;
    const actions = P().actions ? P().actions() : null;
    if (type === 'scene') {
      if (actions && actions.applyScene) {
        actions.applyScene(ref);
        return true;
      }
      return false;
    }
    if (type === 'palette') {
      const list = (window.SV.GRADIENT_PRESETS || []).concat(P().cfg().userPresets || []);
      const pal = list.find((x) => x && x.name === ref);
      if (!pal || !Array.isArray(pal.colors)) return false;
      const cur = P().cfg();
      cur.background.gradient.colors = pal.colors.slice();
      P().apply();
      return true;
    }
    if (type === 'preset') {
      const T = window.SVTemplates;
      if (!T) return false;
      const tpl = T.TEMPLATES.find((t) => t.id === ref);
      if (!tpl) return false;
      const cur = P().cfg();
      const next = T.apply(cur, tpl, {
        defaultConfig: window.SV.defaultConfig,
        deepMerge: window.SV.deepMerge,
        clone: window.SV.clone,
      });
      /* Yapılandırma nesnesi panelin her yerinde referansla tutuluyor; yerine
         yenisini koymak yerine İÇERİĞİNİ değiştiriyoruz, yoksa açık paneller
         eski nesneye bakmaya devam ederdi (template-panel.js ile aynı gerekçe). */
      for (const k of Object.keys(next)) cur[k] = next[k];
      P().apply();
      return true;
    }
    return false;
  }

  /* Yuva ateşlerken geçiş ayarını GEÇİCİ olarak devralırız.

     Önce doğrudan yazılıyordu ve bu kalıcı hasar veriyordu: bir "Kesme"
     yuvası ateşlemek transition.enabled değerini false yapıp orada
     bırakıyordu, yani kullanıcının sahne geçişleri bir daha çalışmıyor ve
     sebebi hiçbir yerde görünmüyordu.

     Artık ilk devralmada kullanıcının ayarı saklanır; deste kapatıldığında
     ya da her şey durdurulduğunda geri konur. Deste açıkken geçişi destenin
     sürmesi doğru davranış — kalıcı olarak elinden alması değil. */
  let savedTransition = null;

  /* Kullanıcının ayarını BİR KEZ sakla. */
  function stashTransition() {
    const c = P().cfg();
    if (c.transition && !savedTransition) savedTransition = window.SV.clone(c.transition);
  }

  function overrideTransition(ev) {
    const c = P().cfg();
    if (!c.transition) return;
    c.transition.enabled = ev.fade > 0;
    if (ev.fade > 0) {
      c.transition.duration = ev.fade;
      if (ev.transition && ev.transition !== 'cut') c.transition.type = ev.transition;
    }
  }

  let releaseTimer = 0;

  /* Geri verme ÇİZİME BAĞLI DEĞİL. Önce panel yeniden çizildiğinde
     yapılıyordu, ama panel o kategoride değilse ya da hiç çizilmiyorsa
     geri verme hiç olmuyor ve kullanıcının geçişleri kapalı kalıyordu.
     Artık geçiş tamamlandıktan hemen sonra bir zamanlayıcı geri veriyor:
     destenin ayarı o sahne değişimini yönetir, sonra kullanıcınınki döner. */
  function scheduleRelease(fade) {
    if (releaseTimer) clearTimeout(releaseTimer);
    const ms = Math.max(120, (Number(fade) || 0) * 1000 + 120);
    releaseTimer = setTimeout(() => {
      releaseTimer = 0;
      releaseTransition();
    }, ms);
  }

  function releaseTransition() {
    if (releaseTimer) {
      clearTimeout(releaseTimer);
      releaseTimer = 0;
    }
    if (!savedTransition) return;
    const c = P().cfg();
    if (c.transition) {
      c.transition.enabled = savedTransition.enabled;
      c.transition.duration = savedTransition.duration;
      c.transition.type = savedTransition.type;
    }
    savedTransition = null;
    P().push(true);
  }

  /* SIRA ÖNEMLİ ve öz testle bulundu: applyScene, transition’ı SCENE_KEYS
     listesinde taşıdığı için sahne verisinden yeniden yazar — sahnede
     transition yoksa VARSAYILANA döner. Destenin geçişini sahneden ÖNCE
     yazmak bu yüzden hiçbir işe yaramıyordu: yuvanın "Kesme" seçimi yok
     sayılıyor, üstelik kullanıcının süresi de kayboluyordu.

     Doğru sıra: kullanıcının ayarını sakla → sahneyi uygula → destenin
     ayarını yaz → yeniden gönder. İkinci gönderim aynı tık içinde olduğu
     için çizim tarafı ikisini de bir sonraki kareden önce işler. */
  function applySlot(ev) {
    const slot = ev.slot;
    if (!slot.ref) return;
    stashTransition();
    applyRef(slot.type, slot.ref);
    overrideTransition(ev);
    P().push(true);
    scheduleRelease(ev.fade);
  }

  // --------------------------------------------------------------------------
  // Kare başına — zaman çizelgesi döngüsünden çağrılır
  // --------------------------------------------------------------------------
  function tick(now, tempoMap) {
    const e = ensureEngine();
    e.update(now, tempoMap);
    lastTick = now;
    paintLive(now, tempoMap);
  }

  // --------------------------------------------------------------------------
  // Yuva görünüşü — panel ve performans görünümü aynı işlevleri kullanıyor
  // --------------------------------------------------------------------------
  const TYPE_LABELS = {
    scene: 'Sahne', preset: 'Şablon', palette: 'Renk Şablonu', video: 'Video', image: 'Görsel', shader: 'Shader', action: 'Eylem',
  };
  const TYPE_ICONS = { scene: '🎬', preset: '✨', palette: '🎨', video: '🎞', image: '🖼', shader: '🌀', action: '⚡' };
  const QUANTIZE_LABELS = [
    ['global', 'Genel (destenin)'],
    ['off', 'Kapalı (anında)'],
    ['frame', 'Bir Sonraki Kare'],
    ['quarter', 'Çeyrek Vuruş'],
    ['half', 'Yarım Vuruş'],
    ['beat', 'Vuruş'],
    ['bar', 'Ölçü'],
    ['bar2', 'İki Ölçü'],
    ['bar4', 'Dört Ölçü'],
  ];
  // Hücrede kısa niceleme etiketi
  const QUANTIZE_SHORT = { off: '⚡', frame: '1f', quarter: '¼', half: '½', beat: '1♩', bar: '1▮', bar2: '2▮', bar4: '4▮' };
  const FOLLOW_ICONS = { stop: '⏹', loop: '↻', next: '↓', random: '🎲', goto: '↪', none: '' };

  function slotColor(slot) {
    if (!slot) return '';
    if (slot.color) return slot.color;
    const tc = TE() && TE().TYPE_COLORS;
    return (tc && tc[slot.type]) || '#4f8cff';
  }

  // Okunur ad: yuvanın adı, yoksa kaynağının adı (sahne kimliği değil)
  function slotLabel(slot) {
    if (!slot) return '';
    if (slot.name) return slot.name;
    if (slot.ref) {
      if (slot.type === 'scene') {
        const sc = (P().cfg().scenes || []).find((x) => x && x.id === slot.ref);
        if (sc) return sc.name || sc.id;
      }
      if (slot.type === 'preset' && window.SVTemplates) {
        const tp = window.SVTemplates.TEMPLATES.find((x) => x.id === slot.ref);
        if (tp) return tt(tp.name);
      }
      return slot.ref;
    }
    return tt(TYPE_LABELS[slot.type] || slot.type);
  }

  function colName(deck, col) {
    const n = deck.colNames && deck.colNames[col];
    return n || String.fromCharCode(65 + (col % 26)) + (col >= 26 ? Math.floor(col / 26) : '');
  }

  /* Yuva önizlemesi: referans verilen sahnenin renkleri. Sahne dock'unda
     kullanılan yöntemin aynısı.

     Gerçek bir kare YAKALANMIYOR: bunun için görselleştiriciyi o sahneye
     geçirmek gerekirdi, yani önizleme uğruna sahneyi değiştirmek. Renk
     karanlıkta uzaktan da ayırt edilir ve hiçbir şeyi bozmaz. */
  function slotPreview(slot) {
    if (!slot || !slot.ref) return '';
    if (slot.type !== 'scene') return '';
    const scenes = (P().cfg().scenes || []);
    const sc = scenes.find((x) => x && x.id === slot.ref);
    const bg = sc && sc.data && sc.data.background;
    if (!bg) return '';
    if (bg.type === 'solid') return bg.solidColor || '';
    const cols = (bg.gradient && bg.gradient.colors) || [];
    if (!cols.length) return '';
    return 'linear-gradient(135deg,' + cols.join(',') + ')';
  }

  /* Çalma ilerlemesi (0..1): süreli yuvada geçen süre / süre; süresizde
     ölçünün neresinde olunduğu — çalan hücre uzaktan da nabız gibi okunsun. */
  function progressOf(a, now, tempoMap) {
    if (!a) return 0;
    if (a.slot.dur) return Math.max(0, Math.min(1, (now - a.startedAt) / a.slot.dur));
    const T = window.SVTimeline;
    if (!T || !tempoMap) return 0;
    const b = T.secondsToBars(tempoMap, now);
    return ((b.beat - 1) + b.tick) / Math.max(1, b.beatsPerBar);
  }

  // --------------------------------------------------------------------------
  // Izgara boyama
  // --------------------------------------------------------------------------
  function cellId(row, col) {
    return 'cdc-' + row + '-' + col;
  }

  function paintGrid() {
    if (!gridHost || !gridHost.isConnected) return;
    const deck = CD().makeDeck(deckSpec());
    const e = ensureEngine();
    const active = new Set(e.activeSlots().map((a) => a.slot.row + ':' + a.slot.col));
    const armed = new Set(e.armed.map((a) => a.slot.row + ':' + a.slot.col));
    for (let r = 0; r < deck.rows; r++) {
      for (let c = 0; c < deck.cols; c++) {
        const node = gridHost.querySelector('#' + cellId(r, c));
        if (!node) continue;
        const key = r + ':' + c;
        node.classList.toggle('active', active.has(key));
        node.classList.toggle('armed', armed.has(key));
        node.classList.toggle('sel', !!selected && selected.row === r && selected.col === c);
        if (!active.has(key)) {
          const pg = node.querySelector('.cd-prog');
          if (pg) pg.style.width = '0%';
        }
        if (!armed.has(key)) {
          const cd = node.querySelector('.cd-count');
          if (cd && cd.textContent) cd.textContent = '';
        }
      }
    }
  }

  /* Her karede: geri sayım, ilerleme çubukları ve vuruş göstergesi. Yalnız
     değişen düğümlere dokunuluyor; ızgara kurulmuyor. */
  function paintLive(now, tempoMap) {
    if (!gridHost || !gridHost.isConnected) return;
    const e = ensureEngine();
    for (const a of e.armed) {
      const node = gridHost.querySelector('#' + cellId(a.slot.row, a.slot.col));
      if (!node) continue;
      const cd = node.querySelector('.cd-count');
      if (cd) cd.textContent = Math.max(0, a.at - now).toFixed(1);
    }
    for (const a of e.activeSlots()) {
      const node = gridHost.querySelector('#' + cellId(a.slot.row, a.slot.col));
      const pg = node && node.querySelector('.cd-prog');
      if (pg) pg.style.width = (progressOf(a, now, tempoMap) * 100).toFixed(1) + '%';
    }
    paintBeat(now, tempoMap);
  }

  function paintBeat(now, tempoMap) {
    if (!headHost || !headHost.isConnected || !window.SVTimeline || !tempoMap) return;
    const b = window.SVTimeline.secondsToBars(tempoMap, now);
    const key = b.bar + ':' + b.beat + ':' + b.beatsPerBar;
    if (key === lastBeatKey) return;
    lastBeatKey = key;
    const bar = headHost.querySelector('.cd-barnum');
    if (bar) bar.textContent = b.bar + '.' + b.beat;
    const dots = headHost.querySelector('.cd-beats');
    if (!dots) return;
    if (dots.childNodes.length !== b.beatsPerBar) {
      while (dots.firstChild) dots.removeChild(dots.firstChild);
      for (let i = 0; i < b.beatsPerBar; i++) dots.appendChild(P().el('span', { class: 'cd-dot' }));
    }
    for (let i = 0; i < dots.childNodes.length; i++) dots.childNodes[i].classList.toggle('on', i === b.beat - 1);
    const bpm = headHost.querySelector('.cd-bpm');
    const seg = tempoMap[0];
    if (bpm && seg) bpm.textContent = (Math.round(seg.bpm * 10) / 10) + ' BPM';
  }

  // --------------------------------------------------------------------------
  // Ateşleme
  // --------------------------------------------------------------------------
  function clockNow() {
    const tp = window.SVTimelinePanel;
    return tp && tp.transport ? tp.transport().time : lastTick;
  }
  function tempoNow() {
    const tp = window.SVTimelinePanel;
    return tp && tp.transport ? tp.transport().tl.tempo : window.SVTimeline.makeTempoMap([{ t: 0, bpm: 120 }]);
  }

  /* Kaynağı olmayan yuvayı ATEŞLEME. Adı var ama kaynağı boş bir yuva
     hazırlanır, geri sayar, ateşlenir ve hiçbir şey olmaz — kullanıcı
     için bu "deste kararsız çalışıyor" demektir. Sebebi söylemek,
     sessizce hiçbir şey yapmaktan iyi. */
  function launch(row, col) {
    const deck = CD().makeDeck(deckSpec());
    const slot = CD().getSlot(deck, row, col);
    if (slot && !slot.ref) {
      P().toast('Bu yuvanın kaynağı seçilmemiş. Aşağıdaki Kaynak listesinden bir sahne, şablon ya da renk şablonu seçin.', 'warn');
      selected = { row, col };
      P().rerender();
      return;
    }
    const e = ensureEngine();
    e.launch(deckSpec().id, row, col, clockNow(), tempoNow());
    if (window.SVTimelinePanel) window.SVTimelinePanel.start();
    paintGrid();
  }

  function launchRow(row) {
    const deck = CD().makeDeck(deckSpec());
    let empty = 0;
    for (let c = 0; c < deck.cols; c++) {
      const sl = CD().getSlot(deck, row, c);
      if (sl && !sl.ref) empty++;
    }
    if (empty) {
      P().toast(empty + ' yuvanın kaynağı seçilmemiş; onlar atlanacak.', 'warn');
    }
    const e = ensureEngine();
    e.launchRow(deckSpec().id, row, clockNow(), tempoNow());
    if (window.SVTimelinePanel) window.SVTimelinePanel.start();
    paintGrid();
  }

  function stopColumn(col) {
    ensureEngine().stopColumn(deckSpec().id, col);
    paintGrid();
  }

  function stopAll() {
    ensureEngine().stopAll();
    releaseTransition();
    P().apply();
    paintGrid();
  }

  /* Performans görünümü aynı motoru ve aynı saati kullanır; kendi
     ateşleme yolunu kursaydı niceleme iki yerde ayrışırdı. */
  const api = {
    panel,
    tick,
    engine: () => ensureEngine(),
    launchSlot: launch,
    applyRef,
    /* Öz testin kaynak listelerini doğrulayabilmesi için. */
    refOptions: (t) => refOptions(t),
    launchRow,
    stopColumn,
    stopAll,
    // Performans görünümü hücreyi aynı biçimde çizsin diye
    slotLabel,
    slotColor,
    colName,
    progressOf,
    TYPE_ICONS,
    _select: (s) => { selected = s; },
  };
  if (typeof window !== 'undefined') window.SVClipDeckPanel = api;

  // --------------------------------------------------------------------------
  // Panel arayüzü
  // --------------------------------------------------------------------------
  let moreOpen = false;

  function panel() {
    const p = P();
    const el = p.el;
    const c = cfg();
    const host = el('div', { class: 'cd-panel' });

    host.appendChild(
      p.row(
        'Klip Destesini Etkinleştir',
        (() => {
          const box = el('input', { type: 'checkbox' });
          box.checked = !!c.enabled;
          box.addEventListener('change', () => {
            c.enabled = box.checked;
            if (!box.checked) {
              ensureEngine().stopAll();
              releaseTransition(); // kullanıcının geçiş ayarını geri ver
            }
            p.apply();
            if (box.checked && window.SVTimelinePanel) window.SVTimelinePanel.start();
          });
          return el('label', { class: 'switch' }, [box, el('span', { class: 'track' })]);
        })()
      )
    );

    if (!c.enabled) {
      /* Deste kapalıysa kullanıcının geçiş ayarını geri ver. Yalnızca
         anahtara basıldığında geri vermek yetmiyordu: yapılandırma başka
         yollardan da kapanabiliyor (ayar dosyası yükleme, dış yapılandırma)
         ve o durumda kullanıcının geçişleri kapalı kalırdı. */
      releaseTransition();
      host.appendChild(
        el('div', {
          class: 'ctrl settings-io-note',
          text: 'Klip destesi kapalı. Açtığınızda vuruş ızgarası sürekli akar ve yuvalar ölçüye hizalı ateşlenir.',
        })
      );
      return host;
    }

    /* Otomatik VJ de sahne değiştiriyor. İkisi aynı anda açıkken sahneyi
       birbirlerinin elinden alırlar. Engellemiyoruz — kullanıcı Otomatik
       VJ'yi renk için, desteyi sahne için kullanmak isteyebilir — ama
       söylemezsek "deste kararsız çalışıyor" diye görünür. */
    const av = p.cfg().autovj;
    if (av && av.enabled && (av.source === 'scenes' || av.source === 'all')) {
      host.appendChild(
        el('div', {
          class: 'ctrl settings-io-note warn',
          text: 'Otomatik VJ de sahne değiştiriyor. İkisi aynı anda açıkken sahneyi birbirlerinin elinden alır; birini kapatmanız ya da Otomatik VJ kaynağını Renk Şablonları yapmanız daha öngörülebilir olur.',
        })
      );
    }

    syncEngine();
    const deck = CD().makeDeck(deckSpec());

    host.appendChild(headBar());

    // --- Izgara ---
    const grid = el('div', { class: 'cd-grid' });
    grid.style.gridTemplateColumns = 'minmax(76px, auto) repeat(' + deck.cols + ', minmax(84px, 1fr))';

    // Başlık satırı: sütun adı ve durdurma
    grid.appendChild(el('div', { class: 'cd-corner', text: tt('Sahne') }));
    for (let col = 0; col < deck.cols; col++) {
      const cc = col;
      const name = el('input', {
        class: 'cd-colname', type: 'text', value: deck.colNames[col] || '',
        placeholder: colName({ colNames: {} }, col), title: 'Sütun adı — bir sütunda aynı anda tek yuva çalar',
      });
      name.addEventListener('change', () => {
        const d = deckSpec();
        d.colNames = Object.assign({}, d.colNames);
        const v = name.value.trim();
        if (v) d.colNames[cc] = v;
        else delete d.colNames[cc];
        p.apply();
      });
      const stop = el('button', { class: 'cd-stop', type: 'button', title: 'Bu sütunu durdur', text: '⏹' });
      stop.addEventListener('click', () => stopColumn(cc));
      grid.appendChild(el('div', { class: 'cd-colhead' }, [name, stop]));
    }

    for (let row = 0; row < deck.rows; row++) {
      const rn = deck.rowNames[row] || String(row + 1);
      const rowBtn = el('button', { class: 'cd-rowlaunch', type: 'button', title: 'Satırın tamamını sahne gibi başlat', text: '▶ ' + rn });
      const rr = row;
      rowBtn.addEventListener('click', () => launchRow(rr));
      grid.appendChild(rowBtn);

      for (let col = 0; col < deck.cols; col++) {
        grid.appendChild(cellNode(deck, row, col));
      }
    }
    gridHost = grid;
    host.appendChild(el('div', { class: 'cd-gridwrap' }, [grid]));
    // Arka plandaki pencere kare almıyor; boyama zamanlayıcıyla
    setTimeout(paintGrid, 0);

    // --- Yuva düzenleyici ---
    host.appendChild(slotEditor(deck));

    // --- Seyrek değişen ayarlar ---
    host.appendChild(moreSettings(deck));
    return host;
  }

  function cellNode(deck, row, col) {
    const p = P();
    const el = p.el;
    const slot = CD().getSlot(deck, row, col);
    const kids = [];
    if (slot) {
      const prev = slotPreview(slot);
      if (prev) kids.push(el('span', { class: 'cd-thumb', style: 'background:' + prev }));
      kids.push(el('span', { class: 'cd-color', style: 'background:' + slotColor(slot) }));
      kids.push(el('span', { class: 'cd-name', text: (TYPE_ICONS[slot.type] || '') + ' ' + slotLabel(slot) }));
      const q = slot.quantize === 'global' ? '' : QUANTIZE_SHORT[slot.quantize] || '';
      const meta = [q, FOLLOW_ICONS[slot.follow] || '', slot.dur ? slot.dur + 's' : ''].filter(Boolean).join(' · ');
      kids.push(el('span', { class: 'cd-meta', text: meta }));
      kids.push(el('span', { class: 'cd-progwrap' }, [el('span', { class: 'cd-prog' })]));
    } else {
      kids.push(el('span', { class: 'cd-plus', text: '+' }));
    }
    kids.push(el('span', { class: 'cd-count', text: '' }));
    const cell = el('button', {
      class: 'cd-cell' + (slot ? ' filled' : ' empty') + (slot && !slot.ref ? ' noref' : ''),
      type: 'button',
      id: cellId(row, col),
      title: slot
        ? (slot.ref ? slotLabel(slot) + ' — ' + tt('tıkla: ateşle · Shift+tıkla: düzenle') : 'Kaynağı seçilmemiş — tıklayıp seçin')
        : 'Boş yuva — eklemek için tıklayın',
    }, kids);
    if (slot && cell.style && cell.style.setProperty) cell.style.setProperty('--slot', slotColor(slot));
    cell.addEventListener('click', (e) => {
      selected = { row, col };
      /* Dolu yuvaya tıklamak ateşler, boş yuvaya tıklamak düzenleyiciyi
         açar. Shift ile tıklamak dolu yuvayı da yalnızca seçer — canlıda
         yanlışlıkla ateşlememek için. Sağ tık da düzenler. */
      if (slot && !e.shiftKey) launch(row, col);
      else p.rerender();
    });
    cell.addEventListener('contextmenu', (e) => {
      if (e.preventDefault) e.preventDefault();
      selected = { row, col };
      p.rerender();
    });
    return cell;
  }

  // Başlık çubuğu: ölçü.vuruş, vuruş noktaları, tempo, genel niceleme, durdur, performans
  function headBar() {
    const p = P();
    const el = p.el;
    const c = cfg();
    const qSel = select(QUANTIZE_LABELS.filter(([v]) => v !== 'global'), c.defaultQuantize || 'bar', (v) => {
      c.defaultQuantize = v;
      ensureEngine();
      p.apply();
    });
    qSel.title = tt('Genel niceleme: "Genel" seçili yuvalar bu ızgaraya hizalı ateşlenir');
    const perf = el('button', { class: 'btn small', type: 'button', text: '🎛 Performans Görünümü', title: 'Tam ekran, büyük hedefler, klavyeyle' });
    perf.addEventListener('click', () => {
      if (window.SVPerformView) window.SVPerformView.open();
    });
    const stop = el('button', { class: 'btn small danger', type: 'button', text: '⏹ Hepsini Durdur' });
    stop.addEventListener('click', stopAll);
    lastBeatKey = '';
    const bar = el('div', { class: 'cd-head' }, [
      el('div', { class: 'cd-clock', title: 'Ölçü.vuruş' }, [
        el('span', { class: 'cd-barnum', text: '1.1' }),
        el('span', { class: 'cd-beats' }),
      ]),
      el('span', { class: 'cd-bpm', text: '' }),
      el('label', { class: 'cd-q' }, [el('span', { class: 'cd-lbl', text: 'Niceleme' }), qSel]),
      el('span', { class: 'cd-spacer' }),
      perf,
      stop,
    ]);
    headHost = bar;
    setTimeout(() => paintBeat(clockNow(), tempoNow()), 0);
    return bar;
  }

  function numInput(value, min, max, step, onChange) {
    const i = P().el('input', { class: 'num tl-num', type: 'number', min: String(min), max: String(max), step: String(step) });
    i.value = String(Math.round(value * 1000) / 1000);
    i.addEventListener('change', () => {
      const v = Number(i.value);
      if (!isFinite(v)) {
        i.value = String(value);
        return;
      }
      onChange(Math.max(min, Math.min(max, v)));
    });
    return i;
  }

  function select(pairs, value, onChange) {
    const s = P().el('select', { class: 'sel' });
    for (const [v, label] of pairs) {
      const o = P().el('option', { value: v, text: label });
      if (v === value) o.selected = true;
      s.appendChild(o);
    }
    s.addEventListener('change', () => onChange(s.value));
    return s;
  }

  function textInput(value, onChange, placeholder) {
    const i = P().el('input', { class: 'txt', type: 'text', value: value || '', placeholder: placeholder || '' });
    i.addEventListener('change', () => onChange(i.value.trim()));
    return i;
  }

  /* Kaynak seçici — zaman çizelgesindekiyle aynı gerekçe: kullanıcı sahne
     kimliği ezberlemek zorunda kalmamalı. Hiç kayıt yoksa boş liste yerine
     bunu söyleyen bir not gösterilir. */
  function refOptions(type) {
    const c = P().cfg();
    if (type === 'scene') return (c.scenes || []).map((sc) => [sc.id, sc.name || sc.id]);
    if (type === 'preset') {
      const T = window.SVTemplates;
      if (!T) return [];
      return T.TEMPLATES.map((t) => [t.id, (t.group ? t.group + ' · ' : '') + t.name]);
    }
    if (type === 'palette') {
      return (window.SV.GRADIENT_PRESETS || [])
        .map((g) => [g.name, g.name])
        .concat((c.userPresets || []).map((g) => [g.name, g.name]));
    }
    return null;
  }

  function refPicker(type, value, onChange) {
    const el = P().el;
    const opts = refOptions(type);
    if (opts === null) {
      const i = el('input', { class: 'txt', type: 'text', value: value || '', placeholder: 'dosya yolu ya da kimlik' });
      i.addEventListener('change', () => onChange(i.value.trim()));
      return i;
    }
    if (!opts.length) {
      const t = type === 'scene'
        ? 'Henüz kayıtlı sahne yok. Sahne bölümünden bir sahne kaydedin.'
        : 'Bu tür için seçilebilir bir kaynak yok.';
      return el('div', { class: 'ctrl settings-io-note', text: t });
    }
    const sel = el('select', { class: 'sel' });
    sel.appendChild(el('option', { value: '', text: '— seçin —' }));
    for (const [v, label] of opts) {
      const o = el('option', { value: v, text: label });
      if (v === value) o.selected = true;
      sel.appendChild(o);
    }
    sel.addEventListener('change', () => onChange(sel.value));
    return sel;
  }

  // Geçiş türleri geçiş motorundan: serbest metin yerine seçim (#637)
  function transitionPairs() {
    const T = window.SVTransition;
    const out = [['', 'Genel ayar (Geçiş kartı)']];
    if (T && T.TRANSITION_IDS) for (const id of T.TRANSITION_IDS) out.push([id, (T.TRANSITIONS[id] && T.TRANSITIONS[id].label) || id]);
    return out;
  }

  function slotEditor(deck) {
    const p = P();
    const el = p.el;
    const box = el('div', { class: 'cd-editor' });
    if (!selected || selected.row >= deck.rows || selected.col >= deck.cols) {
      selected = null;
      box.appendChild(el('div', { class: 'ctrl settings-io-note', text: 'Boş bir yuvaya tıklayıp ekleyin. Dolu yuvaya tıklamak ateşler; düzenlemek için Shift ile ya da sağ tıklayın.' }));
      return box;
    }
    const cur = CD().getSlot(deck, selected.row, selected.col);
    const at = { row: selected.row, col: selected.col };
    const where = (deck.rowNames[at.row] || String(at.row + 1)) + ' · ' + colName(deck, at.col);

    const save = (patch) => {
      const base = CD().getSlot(CD().makeDeck(deckSpec()), at.row, at.col) || CD().makeSlot({ row: at.row, col: at.col, quantize: 'global' });
      const merged = Object.assign({}, base, patch, { row: at.row, col: at.col });
      const live = CD().makeDeck(deckSpec());
      CD().setSlot(live, at.row, at.col, merged);
      deckSpec().slots = CD().slotList(live);
      p.apply();
    };

    const act = (text, title, fn, cls) => {
      const b = el('button', { class: 'btn small' + (cls ? ' ' + cls : ''), type: 'button', text, title });
      b.addEventListener('click', fn);
      return b;
    };

    // Boş yuva: tek tıkla tür seç ve yuva oluşsun
    if (!cur) {
      box.appendChild(el('div', { class: 'cd-editor-head', text: tt('Boş yuva') + ' · ' + where }));
      const types = el('div', { class: 'cd-typepick' });
      for (const t of ['scene', 'preset', 'palette']) {
        types.appendChild(act((TYPE_ICONS[t] || '') + ' ' + tt(TYPE_LABELS[t]), 'Bu türde bir yuva oluştur', () => save({ type: t, ref: '', fade: CD().DEFAULT_FADE[t] })));
      }
      box.appendChild(types);
      box.appendChild(el('div', { class: 'ctrl settings-io-note', text: 'Tür seçin; sonra kaynağını (hangi sahne, şablon ya da renk) seçin. Video, görsel ve shader türleri yuva düzenleyicinin Tür listesinde.' }));
      return box;
    }

    const spec = cur;
    box.appendChild(el('div', { class: 'cd-editor-head' }, [
      el('span', { class: 'cd-editor-sw', style: 'background:' + slotColor(spec) }),
      el('span', { text: (TYPE_ICONS[spec.type] || '') + ' ' + slotLabel(spec) }),
      el('span', { class: 'cd-editor-where', text: where }),
    ]));
    box.appendChild(el('div', { class: 'tl-actions' }, [
      act('▶ Ateşle', 'Bu yuvayı nicelemesine göre ateşle', () => launch(at.row, at.col)),
      act('⏹ Sütunu Durdur', 'Bu sütunda çalan yuvayı durdur', () => stopColumn(at.col)),
      act('🗑 Yuvayı Boşalt', 'Yuvayı sil', () => {
        const live = CD().makeDeck(deckSpec());
        CD().setSlot(live, at.row, at.col, null);
        deckSpec().slots = CD().slotList(live);
        selected = null;
        p.apply();
      }, 'danger'),
    ]));

    const grid = el('div', { class: 'tl-insp-grid' });
    box.appendChild(grid);
    grid.appendChild(p.row('Ad', textInput(spec.name, (v) => save({ name: v }), slotLabel(Object.assign({}, spec, { name: '' })))));
    grid.appendChild(
      p.row('Tür', select(
        [['scene', 'Sahne'], ['preset', 'Şablon'], ['palette', 'Renk Şablonu'], ['video', 'Video'], ['image', 'Görsel'], ['shader', 'Shader'], ['action', 'Eylem']],
        spec.type,
        /* Tür değişince kaynak listesi de değişir; eskisini temizle,
           yoksa sahne kimliği şablon alanında kalır. */
        (v) => save({ type: v, ref: '', fade: CD().DEFAULT_FADE[v] })
      ))
    );
    grid.appendChild(p.row('Kaynak', refPicker(spec.type, spec.ref, (v) => save({ ref: v }))));
    const col = el('input', { class: 'tl-swatch big', type: 'color', value: slotColor(spec) });
    col.addEventListener('change', () => save({ color: col.value }));
    const colReset = act('↺', 'Rengi türden al', () => save({ color: '' }));
    grid.appendChild(p.row('Renk', el('div', { class: 'tl-inline' }, [col, colReset])));
    grid.appendChild(p.row('Niceleme', select(QUANTIZE_LABELS, spec.quantize, (v) => save({ quantize: v }))));
    grid.appendChild(p.row('Tetikleme', select([['fade', 'Geçişle'], ['cut', 'Kesme']], spec.trigger, (v) => save({ trigger: v }))));
    if (spec.trigger !== 'cut') {
      grid.appendChild(p.row('Geçiş Türü', select(transitionPairs(), spec.transition, (v) => save({ transition: v }))));
      grid.appendChild(p.row('Geçiş Süresi (sn)', numInput(spec.fade, 0, 30, 0.05, (v) => save({ fade: v }))));
    }
    grid.appendChild(
      p.row('Süre (sn, boş = süresiz)', (() => {
        const i = el('input', { class: 'num tl-num', type: 'number', min: '0', step: '0.05' });
        i.value = spec.dur == null ? '' : String(spec.dur);
        i.addEventListener('change', () => save({ dur: i.value === '' ? null : Number(i.value) }));
        return i;
      })())
    );
    grid.appendChild(
      p.row('Takip Eylemi', select(
        [
          ['none', 'Yok (yerinde kal)'],
          ['stop', 'Dur'],
          ['loop', 'Baştan Çal'],
          ['next', 'Sonraki Yuva'],
          ['random', 'Sütunda Rastgele'],
          ['goto', 'Belirli Yuvaya Git'],
        ],
        spec.follow,
        (v) => save({ follow: v })
      ))
    );
    if (spec.follow !== 'none' && spec.follow !== 'stop' && spec.dur == null) {
      box.appendChild(el('div', { class: 'ctrl settings-io-note warn', text: 'Takip eylemi süre dolunca çalışır; bu yuvanın süresi yok. Bir süre girin.' }));
    }
    if (spec.follow === 'goto') {
      /* Hedef satır ve sütun seçimle (#637). Önce "satır:sütun" metniydi ve
         sıfırdan mı birden mi sayıldığı belli değildi. Model aynı metni
         tutuyor: "satır:sütun", sıfırdan. */
      const parts = String(spec.followTarget || '').split(':');
      const tr = Math.max(0, Math.min(deck.rows - 1, Math.round(Number(parts[0])) || 0));
      const tc = parts.length > 1 && parts[1] !== '' ? Math.max(0, Math.min(deck.cols - 1, Math.round(Number(parts[1])) || 0)) : at.col;
      const rows = [];
      for (let r = 0; r < deck.rows; r++) rows.push([String(r), deck.rowNames[r] || String(r + 1)]);
      const cols = [];
      for (let c2 = 0; c2 < deck.cols; c2++) cols.push([String(c2), colName(deck, c2)]);
      let rSel = null;
      let cSel = null;
      const put = () => save({ followTarget: rSel.value + ':' + cSel.value });
      rSel = select(rows, String(tr), put);
      cSel = select(cols, String(tc), put);
      grid.appendChild(p.row('Hedef Yuva', el('div', { class: 'tl-inline' }, [rSel, cSel])));
    }
    const rowAt = at.row;
    /* Satır adı burada, bir metin kutusunda. Önce "Satırı Adlandır"
       düğmesi `window.prompt` açıyordu: Electron onu desteklemiyor, düğme
       hiçbir şey yapmıyordu (ve satır adı sözlüğü eksikse hata atıyordu). */
    grid.appendChild(p.row('Satır Adı', textInput(deckSpec().rowNames[rowAt] || '', (v) => {
      const d = deckSpec();
      d.rowNames = Object.assign({}, d.rowNames);
      if (v) d.rowNames[rowAt] = v;
      else delete d.rowNames[rowAt];
      p.apply();
    }, String(rowAt + 1))));
    if (spec.type !== 'scene' && spec.type !== 'preset' && spec.type !== 'palette') {
      box.appendChild(
        el('div', {
          class: 'ctrl settings-io-note',
          text: 'Bu tür kaydedilir ve zaman çizelgesine yazılır, ama henüz ateşlendiğinde uygulanmaz: bir katmanı hedeflemesi gerekiyor ve hedef söylenmeden uygulamak o katmandaki içeriğin üzerine yazardı. Sahne ve Şablon türleri çalışıyor.',
        })
      );
    }
    return box;
  }

  // Seyrek değişenler: ızgara boyutu ve çizelgeye kayıt
  function moreSettings(deck) {
    const p = P();
    const el = p.el;
    const c = cfg();
    const box = el('details', { class: 'tl-more' });
    if (moreOpen || c.recording) box.setAttribute('open', '');
    box.addEventListener('toggle', () => { moreOpen = !!box.open; });
    box.appendChild(el('summary', { text: 'Izgara ve kayıt' }));
    box.appendChild(
      p.row(
        'Izgara Boyutu',
        el('div', { class: 'tl-inline' }, [
          numInput(deck.rows, 1, 32, 1, (v) => {
            deckSpec().rows = Math.round(v);
            p.apply();
          }),
          numInput(deck.cols, 1, 32, 1, (v) => {
            deckSpec().cols = Math.round(v);
            p.apply();
          }),
        ])
      )
    );

    box.appendChild(
      p.row(
        'Deste Etkinliğini Çizelgeye Kaydet',
        (() => {
          const cb = el('input', { type: 'checkbox' });
          cb.checked = !!c.recording;
          cb.addEventListener('change', () => {
            c.recording = cb.checked;
            if (cb.checked) recorder = new (CD().Recorder)();
            else if (recorder) {
              const tracks = recorder.toTracks(clockNow());
              if (tracks.length) {
                const tcfg = p.cfg().timeline;
                tcfg.tracks = (tcfg.tracks || []).concat(tracks);
                p.toast(tracks.length + ' parça zaman çizelgesine eklendi.', 'ok');
              }
              recorder = null;
            }
            p.apply();
          });
          return el('label', { class: 'switch' }, [cb, el('span', { class: 'track' })]);
        })()
      )
    );
    box.appendChild(
      el('div', {
        class: 'ctrl settings-io-note',
        text: 'Kayıt kapatıldığında ateşlenen yuvalar zaman çizelgesine parça olarak eklenir; doğaçlanan set düzenlenebilir hale gelir.',
      })
    );
    return box;
  }
})();
