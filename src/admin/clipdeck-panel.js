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
 */
(function () {
  const P = () => window.SVPanel;
  const CD = () => window.SVClipDeck;

  let engine = null;
  let selected = null; // { row, col }
  let gridHost = null;
  let recorder = null;
  let lastTick = 0;

  function cfg() {
    return P().cfg().clipdeck;
  }

  function deckSpec() {
    const c = cfg();
    const list = Array.isArray(c.decks) && c.decks.length ? c.decks : [{ id: 'deck', name: 'A' }];
    return list.find((d) => d.id === c.activeDeck) || list[0];
  }

  function ensureEngine() {
    const c = cfg();
    if (!engine) {
      engine = new (CD().Engine)({ decks: c.decks });
      engine.on(onEngineEvent);
    }
    return engine;
  }

  /* Motorun destelerini yapılandırmadan yeniden kur. Yuva düzenlendiğinde
     çağrılır; çalan/hazırlanan durum korunur, yoksa bir adı değiştirmek
     çalan klibi düşürürdü. */
  function syncEngine() {
    const e = ensureEngine();
    e.decks = (cfg().decks || []).map(CD().makeDeck);
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

  /* Ateşlenen yuvayı uygula. Sahne uygulaması panelin KENDİ eylemini çağırır:
     karartma durumu, etkin sahne kimliği ve görsel normalleştirmesi orada
     doğru işleniyor. */
  function applySlot(ev) {
    const slot = ev.slot;
    if (!slot.ref) return;
    const actions = P().actions ? P().actions() : null;
    if (slot.type === 'scene' && actions && actions.applyScene) {
      /* Geçiş süresi ve türü sahne geçiş motoruna verilir; 'cut' gerçek
         kesmedir, motor tek karelik harman bile yapmaz. */
      const c = P().cfg();
      if (c.transition) {
        c.transition.enabled = ev.fade > 0;
        if (ev.fade > 0) {
          c.transition.duration = ev.fade;
          if (ev.transition) c.transition.type = ev.transition;
        }
      }
      actions.applyScene(slot.ref);
    }
  }

  // --------------------------------------------------------------------------
  // Kare başına — zaman çizelgesi döngüsünden çağrılır
  // --------------------------------------------------------------------------
  function tick(now, tempoMap) {
    const e = ensureEngine();
    e.update(now, tempoMap);
    lastTick = now;
    // Geri sayım göstergesi yalnızca hazırlık varsa boyanır
    if (e.armed.length) paintCountdowns(now);
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
      }
    }
  }

  function paintCountdowns(now) {
    if (!gridHost || !gridHost.isConnected) return;
    const e = ensureEngine();
    for (const a of e.armed) {
      const node = gridHost.querySelector('#' + cellId(a.slot.row, a.slot.col));
      if (!node) continue;
      const cd = node.querySelector('.cd-count');
      if (cd) cd.textContent = Math.max(0, a.at - now).toFixed(1);
    }
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

  function launch(row, col) {
    const e = ensureEngine();
    e.launch(deckSpec().id, row, col, clockNow(), tempoNow());
    if (window.SVTimelinePanel) window.SVTimelinePanel.start();
    paintGrid();
  }

  function launchRow(row) {
    const e = ensureEngine();
    e.launchRow(deckSpec().id, row, clockNow(), tempoNow());
    if (window.SVTimelinePanel) window.SVTimelinePanel.start();
    paintGrid();
  }

  /* Performans görünümü aynı motoru ve aynı saati kullanır; kendi
     ateşleme yolunu kursaydı niceleme iki yerde ayrışırdı. */
  const api = {
    panel,
    tick,
    engine: () => ensureEngine(),
    launchSlot: launch,
    launchRow,
  };
  if (typeof window !== 'undefined') window.SVClipDeckPanel = api;

  // --------------------------------------------------------------------------
  // Panel arayüzü
  // --------------------------------------------------------------------------
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
            p.apply();
            if (box.checked && window.SVTimelinePanel) window.SVTimelinePanel.start();
          });
          return el('label', { class: 'switch' }, [box, el('span', { class: 'track' })]);
        })()
      )
    );

    if (!c.enabled) {
      host.appendChild(
        el('div', {
          class: 'ctrl settings-io-note',
          text: 'Klip destesi kapalı. Açtığınızda vuruş ızgarası sürekli akar ve yuvalar ölçüye hizalı ateşlenir.',
        })
      );
      return host;
    }

    syncEngine();
    const deck = CD().makeDeck(deckSpec());

    // --- Izgara ---
    const grid = el('div', { class: 'cd-grid' });
    grid.style.gridTemplateColumns = 'auto repeat(' + deck.cols + ', minmax(64px, 1fr))';

    // Başlık satırı: sütun durdurma
    grid.appendChild(el('div', { class: 'cd-corner', text: '' }));
    for (let col = 0; col < deck.cols; col++) {
      const stop = el('button', { class: 'cd-stop', type: 'button', title: 'Bu sütunu durdur', text: '⏹' });
      const cc = col;
      stop.addEventListener('click', () => {
        ensureEngine().stopColumn(deckSpec().id, cc);
        paintGrid();
      });
      grid.appendChild(stop);
    }

    for (let row = 0; row < deck.rows; row++) {
      const rn = deck.rowNames[row] || String(row + 1);
      const rowBtn = el('button', { class: 'cd-rowlaunch', type: 'button', title: 'Satırın tamamını sahne gibi başlat', text: '▶ ' + rn });
      const rr = row;
      rowBtn.addEventListener('click', () => launchRow(rr));
      grid.appendChild(rowBtn);

      for (let col = 0; col < deck.cols; col++) {
        const slot = CD().getSlot(deck, row, col);
        const cell = el('button', {
          class: 'cd-cell' + (slot ? ' filled' : ''),
          type: 'button',
          id: cellId(row, col),
          title: slot ? (slot.name || slot.ref || slot.type) : 'Boş yuva — düzenlemek için tıklayın',
        });
        const prev = slotPreview(slot);
        if (prev) cell.appendChild(el('span', { class: 'cd-thumb', style: 'background:' + prev }));
        cell.appendChild(el('span', { class: 'cd-name', text: slot ? (slot.name || slot.ref || slot.type) : '' }));
        cell.appendChild(el('span', { class: 'cd-count', text: '' }));
        const rr2 = row;
        const cc2 = col;
        cell.addEventListener('click', (e) => {
          selected = { row: rr2, col: cc2 };
          /* Dolu yuvaya tıklamak ateşler, boş yuvaya tıklamak düzenleyiciyi
             açar. Shift ile tıklamak dolu yuvayı da yalnızca seçer — canlıda
             yanlışlıkla ateşlememek için. */
          if (slot && !e.shiftKey) launch(rr2, cc2);
          else p.rerender();
        });
        grid.appendChild(cell);
      }
    }
    gridHost = grid;
    host.appendChild(grid);
    requestAnimationFrame(paintGrid);

    // --- Genel denetimler ---
    const perf = el('button', { class: 'btn', type: 'button', text: 'Performans Görünümü' });
    perf.addEventListener('click', () => {
      if (window.SVPerformView) window.SVPerformView.open();
    });
    const stopAll = el('button', { class: 'btn danger', type: 'button', text: 'Hepsini Durdur' });
    stopAll.addEventListener('click', () => {
      ensureEngine().stopAll();
      paintGrid();
    });
    host.appendChild(el('div', { class: 'tl-actions' }, [perf, stopAll]));

    host.appendChild(
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

    host.appendChild(
      p.row(
        'Deste Etkinliğini Çizelgeye Kaydet',
        (() => {
          const box = el('input', { type: 'checkbox' });
          box.checked = !!c.recording;
          box.addEventListener('change', () => {
            c.recording = box.checked;
            if (box.checked) recorder = new (CD().Recorder)();
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
          return el('label', { class: 'switch' }, [box, el('span', { class: 'track' })]);
        })()
      )
    );
    host.appendChild(
      el('div', {
        class: 'ctrl settings-io-note',
        text: 'Kayıt kapatıldığında ateşlenen yuvalar zaman çizelgesine parça olarak eklenir; doğaçlanan set düzenlenebilir hale gelir.',
      })
    );

    // --- Yuva düzenleyici ---
    host.appendChild(slotEditor(deck));
    return host;
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

  function slotEditor(deck) {
    const p = P();
    const el = p.el;
    const box = el('div', { class: 'cd-editor' });
    if (!selected) {
      box.appendChild(el('div', { class: 'ctrl settings-io-note', text: 'Bir yuva seçin. Dolu yuvaya Shift ile tıklamak ateşlemeden seçer.' }));
      return box;
    }
    const cur = CD().getSlot(deck, selected.row, selected.col);
    const spec = cur || CD().makeSlot({ row: selected.row, col: selected.col, quantize: cfg().defaultQuantize });

    const save = (patch) => {
      const merged = Object.assign({}, spec, patch, { row: selected.row, col: selected.col });
      const live = CD().makeDeck(deckSpec());
      CD().setSlot(live, selected.row, selected.col, merged);
      deckSpec().slots = CD().slotList(live);
      p.apply();
    };

    box.appendChild(el('div', { class: 'cd-editor-head', text: 'Yuva ' + (selected.row + 1) + '×' + (selected.col + 1) }));
    box.appendChild(p.row('Ad', textInput(spec.name, (v) => save({ name: v }))));
    box.appendChild(
      p.row('Tür', select(
        [['scene', 'Sahne'], ['preset', 'Şablon'], ['video', 'Video'], ['image', 'Görsel'], ['shader', 'Shader'], ['action', 'Eylem']],
        spec.type,
        (v) => save({ type: v, fade: CD().DEFAULT_FADE[v] })
      ))
    );
    box.appendChild(p.row('Kaynak Kimliği', textInput(spec.ref, (v) => save({ ref: v }), 'ör. sahne kimliği')));
    box.appendChild(
      p.row('Niceleme', select(
        [
          ['off', 'Kapalı (anında)'],
          ['frame', 'Bir Sonraki Kare'],
          ['quarter', 'Çeyrek Vuruş'],
          ['half', 'Yarım Vuruş'],
          ['beat', 'Vuruş'],
          ['bar', 'Ölçü'],
          ['bar2', 'İki Ölçü'],
          ['bar4', 'Dört Ölçü'],
        ],
        spec.quantize,
        (v) => save({ quantize: v })
      ))
    );
    box.appendChild(
      p.row('Tetikleme', select([['fade', 'Geçişle'], ['cut', 'Kesme']], spec.trigger, (v) => save({ trigger: v })))
    );
    box.appendChild(p.row('Geçiş Süresi (sn)', numInput(spec.fade, 0, 30, 0.05, (v) => save({ fade: v }))));
    box.appendChild(
      p.row('Geçiş Türü', textInput(spec.transition, (v) => save({ transition: v }), 'boş = mevcut ayar'))
    );
    box.appendChild(
      p.row('Süre (sn, boş = süresiz)', (() => {
        const i = el('input', { class: 'num tl-num', type: 'number', min: '0', step: '0.05' });
        i.value = spec.dur == null ? '' : String(spec.dur);
        i.addEventListener('change', () => save({ dur: i.value === '' ? null : Number(i.value) }));
        return i;
      })())
    );
    box.appendChild(
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
    if (spec.follow === 'goto') {
      box.appendChild(p.row('Hedef (satır:sütun)', textInput(spec.followTarget, (v) => save({ followTarget: v }), 'ör. 2:0')));
    }

    const del = el('button', { class: 'btn danger', type: 'button', text: 'Yuvayı Boşalt' });
    del.addEventListener('click', () => {
      const live = CD().makeDeck(deckSpec());
      CD().setSlot(live, selected.row, selected.col, null);
      deckSpec().slots = CD().slotList(live);
      selected = null;
      p.apply();
    });
    const name = el('button', { class: 'btn', type: 'button', text: 'Satırı Adlandır' });
    name.addEventListener('click', async () => {
      const v = window.prompt('Satır adı', deckSpec().rowNames[selected.row] || '');
      if (v == null) return;
      deckSpec().rowNames = Object.assign({}, deckSpec().rowNames);
      if (v.trim()) deckSpec().rowNames[selected.row] = v.trim();
      else delete deckSpec().rowNames[selected.row];
      p.apply();
    });
    box.appendChild(el('div', { class: 'tl-actions' }, [name, del]));
    return box;
  }
})();
