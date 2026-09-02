'use strict';
/* Performans görünümü — deste, taşıma ve karartmadan başka hiçbir şey.
 *
 * Karanlık bir odada, uzaktan okunacak ve muhtemelen aceleyle kullanılacak:
 * hedefler büyük, kontrast yüksek, her yuva klavyeden erişilebilir.
 *
 * AYRI BİR PENCERE DEĞİL, panelin üstünde tam ekran bir katman. Sebebi
 * mimari: yapılandırmanın tek sahibi yönetici paneli. İkinci bir panel
 * penceresi aynı ayarın iki yazıcısı olurdu ve bu, projenin her yerinde
 * bilinçli olarak kaçınılan sorunun ta kendisi (bkz. admin/autovj.js başlığı).
 * Operatör görünümü kendi ekranında istiyorsa panel penceresi o ekrana
 * taşınır; görselleştirici pencereleri zaten ayrı ekranlarda çalışıyor.
 */
(function () {
  const P = () => window.SVPanel;
  const CD = () => window.SVClipDeck;
  const DP = () => window.SVClipDeckPanel;

  let host = null;
  let timer = 0;
  let cursorRow = 0;
  /* Sütun harfleri: 1..9 satırı, a..p sütunu seçer. Rakam+harf ayrımı,
     tek elle ve bakmadan kullanılabilsin diye. */
  const COL_KEYS = 'abcdefghijklmnop';

  function deckSpec() {
    const c = P().cfg().clipdeck;
    const list = Array.isArray(c.decks) && c.decks.length ? c.decks : [{ id: 'deck', name: 'A' }];
    return list.find((d) => d.id === c.activeDeck) || list[0];
  }

  function transport() {
    const tp = window.SVTimelinePanel;
    return tp && tp.transport ? tp.transport() : null;
  }
  function clockNow() {
    const tr = transport();
    return tr ? tr.time : 0;
  }

  function open() {
    if (host) return;
    const el = P().el;
    const deck = CD().makeDeck(deckSpec());

    host = el('div', { class: 'perf-view' });
    host.tabIndex = 0;

    const clock = el('span', { class: 'perf-clock', text: '1.1' });
    const stop = el('button', { class: 'perf-btn', type: 'button', text: 'Hepsini Durdur' });
    stop.addEventListener('click', () => {
      DP().engine().stopAll();
      paint();
    });
    const black = el('button', { class: 'perf-btn danger', type: 'button', text: 'Karart' });
    black.addEventListener('click', () => P().toggleBlackout());
    const close = el('button', { class: 'perf-btn', type: 'button', text: 'Kapat' });
    close.addEventListener('click', hide);
    host.appendChild(el('div', { class: 'perf-head' }, [clock, stop, black, close]));

    const grid = el('div', { class: 'perf-grid' });
    grid.style.gridTemplateColumns = 'minmax(90px, auto) repeat(' + deck.cols + ', 1fr)';

    grid.appendChild(el('div', { class: 'perf-corner' }));
    for (let c = 0; c < deck.cols; c++) {
      const st = el('button', { class: 'perf-stopcol', type: 'button', text: COL_KEYS[c].toUpperCase() + ' ⏹' });
      const cc = c;
      st.addEventListener('click', () => {
        DP().engine().stopColumn(deckSpec().id, cc);
        paint();
      });
      grid.appendChild(st);
    }

    for (let r = 0; r < deck.rows; r++) {
      const rn = deck.rowNames[r] || String(r + 1);
      const rb = el('button', { class: 'perf-row', type: 'button', id: 'pvr-' + r, text: (r < 9 ? r + 1 + ' · ' : '') + rn });
      const rr = r;
      rb.addEventListener('click', () => {
        cursorRow = rr;
        DP().launchRow(rr);
        paint();
      });
      grid.appendChild(rb);

      for (let c = 0; c < deck.cols; c++) {
        const slot = CD().getSlot(deck, r, c);
        const cell = el('button', {
          class: 'perf-cell' + (slot ? ' filled' : ''),
          type: 'button',
          id: 'pvc-' + r + '-' + c,
        });
        cell.appendChild(el('span', { class: 'perf-name', text: slot ? slot.name || slot.ref || '' : '' }));
        cell.appendChild(el('span', { class: 'perf-count', text: '' }));
        const rr2 = r;
        const cc2 = c;
        cell.addEventListener('click', () => {
          cursorRow = rr2;
          if (slot) DP().launchSlot(rr2, cc2);
          paint();
        });
        grid.appendChild(cell);
      }
    }
    host.appendChild(grid);
    host.appendChild(
      el('div', {
        class: 'perf-hint',
        text: 'Satır seçmek için 1-9, yuva ateşlemek için A-P, satırı başlatmak için Enter, çıkmak için Esc.',
      })
    );

    host.addEventListener('keydown', onKey);
    document.body.appendChild(host);
    host.focus();
    timer = setInterval(paint, 100);
    paint();
  }

  function onKey(e) {
    if (e.key === 'Escape') {
      hide();
      e.preventDefault();
      return;
    }
    const deck = CD().makeDeck(deckSpec());
    if (e.key >= '1' && e.key <= '9') {
      cursorRow = Math.min(deck.rows - 1, Number(e.key) - 1);
      paint();
      e.preventDefault();
      return;
    }
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      cursorRow = Math.max(0, Math.min(deck.rows - 1, cursorRow + (e.key === 'ArrowDown' ? 1 : -1)));
      paint();
      e.preventDefault();
      return;
    }
    if (e.key === 'Enter') {
      DP().launchRow(cursorRow);
      paint();
      e.preventDefault();
      return;
    }
    const col = COL_KEYS.indexOf(String(e.key).toLowerCase());
    if (col >= 0 && col < deck.cols) {
      DP().launchSlot(cursorRow, col);
      paint();
      e.preventDefault();
    }
  }

  function paint() {
    if (!host || !host.isConnected) return;
    const deck = CD().makeDeck(deckSpec());
    const engine = DP().engine();
    const now = clockNow();

    const tr = transport();
    const clock = host.querySelector('.perf-clock');
    if (clock && tr) {
      const b = tr.bars();
      clock.textContent = b.bar + '.' + b.beat;
    }

    const active = new Set(engine.activeSlots().map((a) => a.slot.row + ':' + a.slot.col));
    const armed = new Map(engine.armed.map((a) => [a.slot.row + ':' + a.slot.col, a.at]));

    for (let r = 0; r < deck.rows; r++) {
      const rowNode = host.querySelector('#pvr-' + r);
      if (rowNode) rowNode.classList.toggle('cursor', r === cursorRow);
      for (let c = 0; c < deck.cols; c++) {
        const node = host.querySelector('#pvc-' + r + '-' + c);
        if (!node) continue;
        const key = r + ':' + c;
        node.classList.toggle('active', active.has(key));
        node.classList.toggle('armed', armed.has(key));
        node.classList.toggle('cursor', r === cursorRow);
        const cd = node.querySelector('.perf-count');
        /* Geri sayım yalnızca hazırlanmış yuvada görünür; her hücreye sayı
           yazmak karanlıkta okunamayacak bir gürültü olurdu. */
        if (cd) cd.textContent = armed.has(key) ? Math.max(0, armed.get(key) - now).toFixed(1) : '';
      }
    }
  }

  function hide() {
    if (timer) {
      clearInterval(timer);
      timer = 0;
    }
    if (host && host.parentNode) host.parentNode.removeChild(host);
    host = null;
  }

  function isOpen() {
    return !!host;
  }

  if (typeof window !== 'undefined') window.SVPerformView = { open, hide, isOpen };
})();
