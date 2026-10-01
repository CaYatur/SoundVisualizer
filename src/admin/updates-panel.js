'use strict';
/* Güncellemeler (#640).

   Ana süreç denetler (src/main/updater.js) ve durumu gönderir. UI footer’daki
   Güncellemeler düğmesinden açılan modalda yaşar (Settings kartında değil).
   Sürüm notları yalnız METİN; adresler ana süreçte açılır.

   Yeni sürüm ilk görüldüğünde (oturum başına sürüm başına bir kez) toast
   çıkar; modal kapalı olsa da kullanıcı haberdar olur. */
(function () {
  const P = () => window.SVPanel;
  const tt = (s) => (window.SVI18n && window.SVI18n.t ? window.SVI18n.t(s) : s);
  let state = null;
  let box = null;
  const toasted = new Set();

  const KIND_LABELS = {
    nsis: 'Windows kurulumu',
    portable: 'Windows taşınabilir',
    appimage: 'Linux AppImage',
    deb: 'Linux .deb paketi',
    mac: 'macOS',
    dev: 'Geliştirme kopyası',
  };
  // Biçime göre güncellemenin nasıl yapılacağı
  const KIND_HINTS = {
    nsis: 'Kurulum dosyasını indirip çalıştırın; ayarlarınız korunur.',
    portable: 'Taşınabilir kopya kendini güncelleyemez: yeni exe dosyasını indirip eskisinin yerine koyun.',
    appimage: 'Yeni AppImage dosyasını indirip eskisinin yerine koyun ve çalıştırılabilir yapın.',
    deb: 'Yeni .deb paketini indirip kurun (ör. sudo apt install ./dosya.deb).',
    mac: 'Uygulama imzasız olduğu için macOS uygulama içi güncellemeye izin vermiyor; yeni dmg dosyasını indirin.',
    dev: 'Geliştirme kopyası: yalnız denetim yapılır; otomatik denetim kapalı.',
  };

  function fmtDate(iso) {
    const d = new Date(iso);
    if (isNaN(d.getTime())) return '';
    try {
      return d.toLocaleDateString(window.SVI18n && window.SVI18n.locale === 'en' ? 'en-GB' : 'tr-TR', { year: 'numeric', month: 'long', day: 'numeric' });
    } catch (e) {
      return d.toISOString().slice(0, 10);
    }
  }

  function statusText(s) {
    if (!s || s.status === 'idle') return s && s.auto ? 'Henüz denetlenmedi.' : 'Otomatik denetim bu kopyada kapalı; elle denetleyebilirsiniz.';
    if (s.status === 'checking') return 'Denetleniyor…';
    if (s.status === 'latest') return 'Güncel: en yeni sürüm kurulu.';
    if (s.status === 'available') return s.skipped ? 'Yeni sürüm var (atlandı).' : 'Yeni sürüm var.';
    if (s.status === 'error') return 'Denetlenemedi. İnternet bağlantısını kontrol edip yeniden deneyin.';
    if (s.status === 'downloading') return tt('İndiriliyor…') + ' %' + Math.round((s.progress || 0) * 100);
    if (s.status === 'ready') return 'İndirildi ve doğrulandı. Kurmak için uygulama kapanıp yeniden açılacak.';
    if (s.status === 'installed') return 'Yeni sürüm yerine kondu; yeniden başlatınca açılır.';
    return '';
  }

  function onStatus(s) {
    state = s;
    if (s && s.status === 'available' && !s.skipped && !toasted.has(s.latest) && P() && P().toast) {
      toasted.add(s.latest);
      P().toast(tt('Yeni sürüm:') + ' v' + s.latest + ' — ' + tt('Güncellemeler'), 'ok');
    }
    refresh();
    syncFooterBtn();
  }

  function refresh() {
    if (!box || !box.isConnected) return;
    const old = box; // panel() box'ı yenisiyle değiştiriyor
    old.replaceWith(panel());
    // If the modal is open, rebuild mode+panel host too
    if (typeof document === 'undefined') return;
    const body = document.getElementById('updatesModalBody');
    if (body && !body.classList.contains('hidden') && body.isConnected) {
      /* panel() already replaced box when it was inside body */
    }
  }

  function syncFooterBtn() {
    if (typeof document === 'undefined') return;
    const btn = document.getElementById('updatesBtn');
    if (!btn) return;
    const hot = !!(state && state.status === 'available' && !state.skipped);
    btn.classList.toggle('has-update', hot);
  }

  function modeSelect() {
    const p = P();
    if (!p || !p.el || !p.cfg) return null;
    const el = p.el;
    const cfg = p.cfg();
    if (!cfg.updates) cfg.updates = { mode: 'notify' };
    const sel = el('select', {
      onchange: (e) => {
        cfg.updates.mode = e.target.value;
        if (p.push) p.push(true);
      },
    });
    [
      ['notify', 'Açık — yeni sürümü haber ver'],
      ['auto', 'Otomatik — indir ve kapanırken kur'],
      ['off', 'Kapalı'],
    ].forEach(([v, t]) => {
      const o = el('option', { value: v, text: tt(t) });
      if (String(cfg.updates.mode || 'notify') === v) o.selected = true;
      sel.appendChild(o);
    });
    return p.row(tt('Güncellemeleri Denetle'), sel);
  }

  function fillModalBody() {
    if (typeof document === 'undefined') return;
    const body = document.getElementById('updatesModalBody');
    if (!body || !P() || !P().el) return;
    body.textContent = '';
    const mode = modeSelect();
    if (mode) body.appendChild(mode);
    body.appendChild(panel());
  }

  function openModal() {
    if (typeof document === 'undefined') return;
    const backdrop = document.getElementById('updatesBackdrop');
    if (!backdrop) return;
    fillModalBody();
    backdrop.classList.remove('hidden');
    backdrop.setAttribute('aria-hidden', 'false');
    const closeBtn = document.getElementById('updatesClose');
    if (closeBtn) closeBtn.focus();
  }

  function closeModal() {
    if (typeof document === 'undefined') return;
    const backdrop = document.getElementById('updatesBackdrop');
    if (!backdrop) return;
    backdrop.classList.add('hidden');
    backdrop.setAttribute('aria-hidden', 'true');
    const btn = document.getElementById('updatesBtn');
    if (btn) btn.focus();
  }

  function panel() {
    const p = P();
    const el = p.el;
    const s = state || { status: 'idle' };
    const root = el('div', { class: 'upd-panel' });
    const btn = (text, title, fn, cls) => {
      const [ico, txt] = Array.isArray(text) ? text : ['', text];
      const b = el('button', { class: 'btn small' + (cls ? ' ' + cls : ''), type: 'button', icon: ico, text: txt, title: title || '' });
      b.addEventListener('click', fn);
      return b;
    };

    const kind = s.kind || 'dev';
    root.appendChild(p.row('Kurulu Sürüm', el('span', { class: 'upd-ver', text: s.current ? 'v' + s.current : '—' })));
    root.appendChild(p.row('Kurulum Türü', el('span', { text: KIND_LABELS[kind] || kind })));
    root.appendChild(el('div', { class: 'ctrl upd-status ' + (s.status || 'idle'), text: statusText(s) }));

    const check = btn(['refresh', 'Şimdi Denetle'], 'GitHub sürümlerine bir kez sorar', async () => {
      if (!window.api || !window.api.updatesCheck) return;
      check.disabled = true;
      try {
        onStatus(await window.api.updatesCheck());
      } catch (e) {
        onStatus(Object.assign({}, s, { status: 'error' }));
      }
    });
    check.disabled = s.status === 'checking';
    const acts = [check];

    if (s.status === 'ready' || s.status === 'installed') {
      acts.push(btn(s.status === 'ready' ? ['upload', 'Kur ve Yeniden Başlat'] : ['refresh', 'Yeniden Başlat'], 'Uygulama kapanır; yeni sürüm açılır', async () => {
        const r = await window.api.updatesInstall();
        if (!r || !r.ok) P().toast(tt('Kurulum başlatılamadı; sürüm sayfasından indirin.'), 'warn');
      }, 'primary'));
    }
    if (s.status === 'available') {
      root.appendChild(p.row('En Yeni Sürüm', el('span', { class: 'upd-ver new', text: 'v' + s.latest + (s.publishedAt ? ' · ' + fmtDate(s.publishedAt) : '') })));
      /* Kurulabilen türde (Windows kurulumu, AppImage) indirme uygulamanın
         içinde ve doğrulanarak; diğerlerinde tarayıcıda. */
      if (s.installable && s.auto && window.api.updatesDownload) {
        acts.push(btn(['download', 'İndir ve Kur'], s.asset.name + ' — ' + tt('SHA-256 ile doğrulanır'), async () => onStatus(await window.api.updatesDownload()), 'primary'));
      } else if (s.asset) {
        acts.push(btn(['download', 'İndir'], s.asset.name, () => window.api.updatesOpen('asset'), 'primary'));
      }
      acts.push(btn('Sürüm Sayfası', 'Sürüm notları ve tüm dosyalar', () => window.api.updatesOpen('release')));
      if (!s.skipped) acts.push(btn('Bu Sürümü Atla', 'Bu sürüm için bir daha bildirim gösterme', async () => onStatus(await window.api.updatesSkip())));
    }
    root.appendChild(el('div', { class: 'tl-actions' }, acts));

    if (s.status === 'available') {
      root.appendChild(el('div', { class: 'ctrl settings-io-note', text: KIND_HINTS[kind] || '' }));
      if (s.downloadError) {
        root.appendChild(el('div', { class: 'ctrl settings-io-note warn', text: tt('İndirme başarısız:') + ' ' + s.downloadError }));
      }
      if (!s.asset) {
        root.appendChild(el('div', { class: 'ctrl settings-io-note warn', text: 'Bu sistem için hazır bir dosya bulunamadı; sürüm sayfasından uygun olanı seçin.' }));
      }
      if (s.notes) {
        const notes = el('pre', { class: 'upd-notes' });
        notes.textContent = s.notes; // yalnız metin
        root.appendChild(el('details', { class: 'tl-more' }, [el('summary', { text: 'Sürüm Notları' }), notes]));
      }
    } else if (kind === 'dev') {
      root.appendChild(el('div', { class: 'ctrl settings-io-note', text: KIND_HINTS.dev }));
    }
    root.appendChild(el('div', { class: 'ctrl settings-io-note dim', text: 'Denetim yalnız GitHub Releases sayfasına tek bir istektir; kimlik ya da kullanım bilgisi gönderilmez.' }));
    box = root;
    return root;
  }

  function wireModalChrome() {
    if (typeof document === 'undefined') return;
    const btn = document.getElementById('updatesBtn');
    const backdrop = document.getElementById('updatesBackdrop');
    const closeBtn = document.getElementById('updatesClose');
    if (btn) btn.addEventListener('click', openModal);
    if (closeBtn) closeBtn.addEventListener('click', closeModal);
    if (backdrop) {
      backdrop.addEventListener('click', (e) => {
        if (e.target === backdrop) closeModal();
      });
    }
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && backdrop && !backdrop.classList.contains('hidden')) {
        e.preventDefault();
        closeModal();
      }
    });
  }

  function init() {
    wireModalChrome();
    syncFooterBtn();
    if (!window.api || !window.api.onUpdatesStatus) return;
    window.api.onUpdatesStatus(onStatus);
    if (window.api.updatesState) window.api.updatesState().then(onStatus).catch(() => {});
  }

  window.SVUpdatesPanel = { panel, init, openModal, closeModal, _state: () => state, _onStatus: onStatus };
  if (typeof document !== 'undefined') {
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
    else init();
  }
})();
