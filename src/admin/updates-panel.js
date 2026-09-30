'use strict';
/* Güncellemeler kartı (#640).

   Ana süreç denetler (src/main/updater.js) ve durumu gönderir; bu kart onu
   gösterir. Sürüm notları yalnız METİN olarak basılıyor: GitHub'dan gelen
   gövde asla HTML olarak sayfaya girmiyor. Adresler de buradan gönderilmiyor;
   ana süreç yalnız son denetimin GitHub adreslerini açıyor.

   Yeni sürüm ilk görüldüğünde (oturum başına sürüm başına bir kez) bir bildirim
   çıkıyor; kart o sırada açık olmasa da kullanıcı haberdar oluyor. */
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
    return '';
  }

  function onStatus(s) {
    state = s;
    if (s && s.status === 'available' && !s.skipped && !toasted.has(s.latest) && P() && P().toast) {
      toasted.add(s.latest);
      P().toast(tt('Yeni sürüm:') + ' v' + s.latest + ' — ' + tt('Kitaplık › Güncellemeler'), 'ok');
    }
    refresh();
  }

  function refresh() {
    if (!box || !box.isConnected) return;
    const old = box; // panel() box'ı yenisiyle değiştiriyor
    old.replaceWith(panel());
  }

  function panel() {
    const p = P();
    const el = p.el;
    const s = state || { status: 'idle' };
    const root = el('div', { class: 'upd-panel' });
    const btn = (text, title, fn, cls) => {
      const b = el('button', { class: 'btn small' + (cls ? ' ' + cls : ''), type: 'button', text, title: title || '' });
      b.addEventListener('click', fn);
      return b;
    };

    const kind = s.kind || 'dev';
    root.appendChild(p.row('Kurulu Sürüm', el('span', { class: 'upd-ver', text: s.current ? 'v' + s.current : '—' })));
    root.appendChild(p.row('Kurulum Türü', el('span', { text: KIND_LABELS[kind] || kind })));
    root.appendChild(el('div', { class: 'ctrl upd-status ' + (s.status || 'idle'), text: statusText(s) }));

    const check = btn('↻ Şimdi Denetle', 'GitHub sürümlerine bir kez sorar', async () => {
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

    if (s.status === 'available') {
      root.appendChild(p.row('En Yeni Sürüm', el('span', { class: 'upd-ver new', text: 'v' + s.latest + (s.publishedAt ? ' · ' + fmtDate(s.publishedAt) : '') })));
      if (s.asset) acts.push(btn('⬇ İndir', s.asset.name, () => window.api.updatesOpen('asset'), 'primary'));
      acts.push(btn('Sürüm Sayfası', 'Sürüm notları ve tüm dosyalar', () => window.api.updatesOpen('release')));
      if (!s.skipped) acts.push(btn('Bu Sürümü Atla', 'Bu sürüm için bir daha bildirim gösterme', async () => onStatus(await window.api.updatesSkip())));
    }
    root.appendChild(el('div', { class: 'tl-actions' }, acts));

    if (s.status === 'available') {
      root.appendChild(el('div', { class: 'ctrl settings-io-note', text: KIND_HINTS[kind] || '' }));
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

  function init() {
    if (!window.api || !window.api.onUpdatesStatus) return;
    window.api.onUpdatesStatus(onStatus);
    if (window.api.updatesState) window.api.updatesState().then(onStatus).catch(() => {});
  }

  window.SVUpdatesPanel = { panel, init, _state: () => state, _onStatus: onStatus };
  if (typeof document !== 'undefined' && document.readyState !== undefined) init();
})();
