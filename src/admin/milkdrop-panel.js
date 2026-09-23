'use strict';
/* MilkDrop preset paneli.

   Presetler ayar dosyasında değil, Studio presetleriyle aynı depoda
   (userData/presets) tutulur: bir `.milk` dosyası onlarca kilobayt olabiliyor
   ve settings.json her kaydırıcı hareketinde baştan yazılıyor.

   Panelin asıl işi paketleri içeri almak. MilkDrop preset paketleri yüzlerce
   dosyadan oluşur; tek tek eklemek kullanılmaz olurdu, o yüzden çoklu seçim
   destekleniyor ve derleme hataları içe aktarma sırasında toplanıp
   gösteriliyor — bozuk bir preset sessizce boş ekran vermemeli. */
(function () {
  const P = () => window.SVPanel;
  const SP = () => window.SVScenePanels;

  let loaded = false;
  let loading = false;
  let presets = [];
  let filter = '';
  /* Listenin süzgeci (#576): 'all' | 'fav' | 'tag:<anahtar>', ve yazar
     (katlanmış anahtar, boşsa hepsi). Aramayla birleşiyor. */
  let showSel = 'all';
  let authorSel = '';
  let busy = '';
  let listScroll = 0;
  /* Doku klasöründe kaç görsel bulunduğu. null = henüz sorulmadı.
     Yol tek başına yeterli değil: kullanıcı klasörü doğru seçip yanlış
     klasörü göstermiş olabilir ve sayı bunu anında ele veriyor. */
  let texCount = null;
  let texAsked = false;
  /* Sprite dosyası (#577): listesi ana süreçten, dosya değişince ya da
     "Yenile" ile yeniden. `sprFor` listenin okunduğu dosya. */
  let sprList = null;
  let sprFor = null;

  /* YERLEŞİKLER DEPODA DEĞİL, KODDA (shared/presets-milkdrop.js). Depoya
     kopyalansalardı kullanıcı silebilir, sürüm yükseltmesi ikinci bir kopya
     bırakabilirdi. Liste burada birleşiyor: önce yerleşikler, sonra
     kullanıcının kendi paketleri. */
  function builtins() {
    const L = window.SVMilkdropBuiltins;
    return Array.isArray(L) ? L : [];
  }

  /* Preset ADI da çeviriden geçiyor: yerleşiklerin adları i18n'de kayıtlı,
     yani İngilizce arayüzde İngilizce görünüyorlar. Kullanıcının kendi
     paketindeki ad sözlükte olmadığı için olduğu gibi dönüyor — bir presetin
     adı onun kendi adı, arayüz metni değil. */
  const tr = (s) => (window.SVI18n && window.SVI18n.t ? window.SVI18n.t(s) : s);

  /* Panel liste gelmeden çizildiyse, liste gelince yeniden çizilmeli.
     Açılışta `init` listeyi callback'siz istiyor; panel o istek sürerken
     çizilirse (`loading` doğru olduğu için) ikinci bir istek de yapmıyordu,
     yani liste, ◀/▶ ve kilit bir sonraki ayar değişikliğine kadar hiç
     görünmüyordu. Yalıtılmış bir kopyada yeniden üretildi: uygulama açılır
     açılmaz Sahne sekmesine geçince panel yalnız içe aktarma düğmeleriyle
     çizildi. */
  let staleRender = false;

  /* TEK LİSTE (#574). Panel eskiden kendi kopyasını istiyordu
     (`listPresets`); admin.js'in tuttuğu `SVPresets` listesi değişiklik
     yayınıyla zaten güncel. İkinci kopya 10.347 presette yüzlerce MB
     demekti (ölçülen: panel 631 MB). Ortak liste hazır değilse (açılışın
     ilk anı, testler) eski yol. */
  function fromStore() {
    const S = window.SVPresets;
    if (!S || typeof S.ready !== 'function' || !S.ready() || typeof S.user !== 'function') return false;
    presets = builtins().concat(S.user().filter((p) => p && p.kind === 'milkdrop'));
    loaded = true;
    return true;
  }

  // Kaydedilen/silinen hemen ortak listeye: yayın zaten geliyor, ikisi aynı sonucu veriyor
  function adoptDelta(delta) {
    const S = window.SVPresets;
    if (S && typeof S.applyDelta === 'function' && typeof S.ready === 'function' && S.ready()) S.applyDelta(delta);
  }

  function refresh(cb) {
    if (fromStore()) {
      if (cb) cb();
      else if (staleRender) { staleRender = false; P().rerender(); }
      return;
    }
    if (!window.api || !window.api.listPresets || loading) return;
    loading = true;
    const done = () => {
      if (cb) cb();
      else if (staleRender) { staleRender = false; P().rerender(); }
    };
    window.api.listPresets().then((list) => {
      loading = false;
      loaded = true;
      const mine = (list || []).filter((p) => p.kind === 'milkdrop');
      presets = builtins().concat(mine);
      done();
    }).catch(() => {
      loading = false;
      loaded = true;
      presets = builtins();
      done();
    });
  }

  /* ARAMA VE SÜZGEÇ (#576). Arama adda, yazarda ve etiketlerde; `#etiket`
     ve `yazar:` sözcükleri yalnız oralarda. Görünen ad da aranıyor:
     yerleşiklerin adı İngilizce arayüzde çevrili. */
  function visible(cfg) {
    const L = LB();
    if (!L) {
      const f = filter.trim().toLowerCase();
      return f ? presets.filter((p) => (p.name || '').toLowerCase().includes(f)) : presets;
    }
    const tag = showSel.indexOf('tag:') === 0 ? showSel.slice(4) : '';
    return L.filter(presets, {
      query: filter, show: tag ? 'tag' : showSel, tag, author: authorSel, nameOf: tr,
    }, cfg && cfg.milkdropLibrary);
  }

  /* Favori ve etiket yazımı: puanlarla aynı desen (`setRating`), yeni bir
     eşlem kitaplığa atanıyor ve yapılandırma gönderiliyor. */
  function setFavorite(id, on) {
    const L = LB();
    const cfg = P().cfg();
    if (!L || !id) return;
    const lib = library(cfg);
    lib.favorites = L.withFavorite(lib, id, on);
    P().apply();
  }

  /* PAKET (#576). Dışa aktarılan: listede GÖRÜNEN kendi presetleri — süzgeç
     "favoriler" ya da bir etiketse yalnız onlar — favori, etiket ve
     puanlarıyla. Yerleşikler girmiyor: her kurulumda zaten varlar.
     İçe aktarımda presetler yeni kimlik alıyor ve kayıtları o kimliğe
     katlanıyor (shared/milkdrop-library.js `mergeEntries`). */
  async function exportPack(cfg) {
    const IS = window.SVPresets;
    const L = LB();
    if (!IS || !IS.makePack || !window.api || !window.api.exportJson) {
      P().toast(tr('Dışa aktarma kullanılamıyor.'), 'err');
      return;
    }
    const list = visible(cfg).filter((p) => p && !p.builtin);
    if (!list.length) {
      P().toast(tr('Listede dışa aktarılacak kendi presetiniz yok.'), 'err');
      return;
    }
    const lib = cfg.milkdropLibrary;
    const data = IS.makePack(list, { name: 'MilkDrop' }, L ? (p) => L.packEntry(lib, p.id) : null);
    const r = await window.api.exportJson('milkdrop-presetler.svpack', data);
    if (r && r.ok) P().toast(list.length + ' ' + tr('preset pakete yazıldı.'), 'ok');
  }

  /* KÜTÜPHANE İÇE AKTARIMI (#574): ZIP, klasör ve makinede bulunanlar. İKİ
     AŞAMA: tarama bir özet getiriyor (kaç preset, kaç doku, kaç MB, neler
     atlanacak); onaylanınca ana süreç kopyalıyor. Sormadan hiçbir şey
     kopyalanmıyor. `libBusy` sürüyorsa durum metni, `libFound` makinede
     bulunanlar, `libSearchDone` arama bütün adaylara bakabildi mi,
     `libResult` son içe aktarımın özeti. */
  let libBusy = '';
  let libFound = null;
  let libSearchDone = true;
  let libResult = '';
  let libListening = false;
  // Sayılar dile göre ayrılıyor: 9.795 / 9,795
  const loc = () => (window.SVI18n && window.SVI18n.locale === 'en' ? 'en' : 'tr');
  const fmt = (s, vars) => tr(s).replace(/\{(\w+)\}/g, (m, k) => {
    if (!vars || !(k in vars)) return m;
    return typeof vars[k] === 'number' ? vars[k].toLocaleString(loc()) : String(vars[k]);
  });
  const mb = (b) => (Math.round(((+b || 0) / 1048576) * 10) / 10).toLocaleString(loc());

  const LIB_ERR = {
    NOT_ZIP: 'ZIP okunamadı: bozuk ya da ZIP değil.',
    CORRUPT: 'ZIP okunamadı: bozuk ya da ZIP değil.',
    READ_FAILED: 'ZIP okunamadı: bozuk ya da ZIP değil.',
    TOO_MANY_ENTRIES: 'ZIP çok fazla girdi içeriyor.',
    TOO_BIG: 'Kaynak çok büyük (2 GB üstü).',
    NO_PLAN: 'Bu tarama artık geçerli değil; yeniden tarayın.',
  };
  const libError = (code) => tr(LIB_ERR[code] || 'İçe aktarılamadı.');

  function libSetBusy(text) {
    libBusy = text;
    const n = typeof document !== 'undefined' && document.getElementById('mdLibProgress');
    if (n) n.textContent = text;
  }

  function listenLibrary() {
    if (libListening || !window.api || !window.api.onMilkdropLibraryProgress) return;
    libListening = true;
    const PH = { read: 'Okunuyor: {a}/{b}', save: 'Kaydediliyor: {a}/{b}', textures: 'Dokular: {a}/{b}' };
    window.api.onMilkdropLibraryProgress((p) => {
      if (!p || !libBusy) return;
      libSetBusy(fmt(PH[p.phase] || 'İçe aktarılıyor…', { a: p.done, b: p.total }));
    });
  }

  // Onaydan önce gösterilen özet: ne eklenecek, neler atlanacak
  function libSummaryText(s) {
    const lines = [fmt('“{label}”: {p} preset, {t} doku, {mb} MB.', { label: s.label, p: s.presets, t: s.textures, mb: mb(s.bytes) })];
    if (s.loose) lines.push(fmt('Presetlerin yanındaki {n} görselden yalnız presetlerin istediği kopyalanır.', { n: s.loose }));
    const k = s.skipped || {};
    if (k.milk2) lines.push(fmt('{n} .milk2 dosyası (MilkDrop 3 çift preseti) desteklenmiyor, atlanacak.', { n: k.milk2 }));
    if (k.tooLarge || k.textureTooLarge) lines.push(fmt('{n} dosya boyut sınırını aşıyor, atlanacak.', { n: (k.tooLarge || 0) + (k.textureTooLarge || 0) }));
    if (k.encrypted || k.unsupported) lines.push(fmt('{n} şifreli ya da desteklenmeyen ZIP girdisi atlanacak.', { n: (k.encrypted || 0) + (k.unsupported || 0) }));
    if (s.complete === false) lines.push(tr('Tarama yarıda kesildi: çok fazla dosya var; bulunanlar alınır.'));
    if (s.tags && control(P().cfg()).importFolderTags !== false) lines.push(fmt('{n} klasör adı etiket olacak.', { n: s.tags }));
    return lines.join(' ');
  }

  // Son içe aktarımın sonucu
  function libResultText(r) {
    const lines = [fmt('{a} preset eklendi, {d} tekrar atlandı.', { a: r.added || 0, d: r.duplicates || 0 })];
    if (r.failed) lines.push(fmt('{f} preset okunamadı ya da kaydedilemedi.', { f: r.failed }));
    const t = r.textures || {};
    if (t.copied) lines.push(fmt('{c} doku kopyalandı.', { c: t.copied }));
    if (t.same) lines.push(fmt('{s} doku zaten vardı.', { s: t.same }));
    if (t.conflicts) lines.push(fmt('{k} doku adı var olan başka bir dokuyla çakıştı; var olan kaldı.', { k: t.conflicts }));
    if (r.skipped && r.skipped.milk2) lines.push(fmt('{n} .milk2 dosyası atlandı (MilkDrop 3 çift preseti).', { n: r.skipped.milk2 }));
    return lines.join(' ');
  }

  /* Aramanın süresi yetmeyip eksik saydığı kütüphane: onaydan önce tamamı
     taranıyor, onay gerçek sayıları gösteriyor ve eksik içe aktarım olmuyor.
     Yeni özet listedekinin yerini alıyor (onay verilmese de). Baştan tarama
     `searchCut` taşımıyor; o da sınıra takılırsa (çok büyük klasör) olağan
     onaya geçiliyor, döngü yok. */
  async function rescanFirst(s) {
    if (!window.api || !window.api.rescanMilkdropLibrary) { P().toast(tr('İçe aktarma kullanılamıyor.'), 'err'); return null; }
    libSetBusy(tr('Taranıyor…'));
    P().rerender();
    let r = null;
    try { r = await window.api.rescanMilkdropLibrary(s.token); } catch (e) { r = null; }
    libSetBusy('');
    if (!r || !r.ok) { P().toast(libError(r && r.error), 'err'); P().rerender(); return null; }
    if (libFound) libFound = libFound.map((x) => (x.token === s.token ? r : x));
    return r;
  }

  async function confirmAndImport(s) {
    if (s && s.searchCut) {
      s = await rescanFirst(s);
      if (!s) return;
    }
    if (!s || !s.presets) { P().toast(tr('Bu kaynakta MilkDrop preseti yok.'), 'err'); P().rerender(); return; }
    if (s.tooBig) { P().toast(libError('TOO_BIG'), 'err'); P().rerender(); return; }
    const msg = libSummaryText(s) + ' ' + tr('Aynı ad ve içerikteki presetler atlanır; dosyalar uygulamanın klasörüne kopyalanır. Devam edilsin mi?');
    if (!(await P().confirm(msg, { okText: tr('İçe Aktar') }))) { P().rerender(); return; }
    listenLibrary();
    libResult = '';
    libSetBusy(tr('İçe aktarılıyor…'));
    P().rerender();
    let r = null;
    try { r = await window.api.importMilkdropLibrary(s.token); } catch (e) { r = null; }
    libSetBusy('');
    if (!r || !r.ok) { P().toast(libError(r && r.error), 'err'); P().rerender(); return; }
    // Bulunanlar listesinden çıkıyor: aynı kütüphane iki kez önerilmesin
    if (libFound) libFound = libFound.filter((x) => x.token !== s.token);
    /* Kaydedilen presetler değişiklik yayınıyla geliyor; etiketler ve doku
       sayacı ayara buradan (ayar paneldeki kopyadan gönderiliyor). */
    const cfg = P().cfg();
    const lib = library(cfg);
    const L = LB();
    const tagged = (r.saved || []).filter((x) => x && x.tag);
    if (L && tagged.length && control(cfg).importFolderTags !== false) lib.tags = L.addTags(lib, tagged);
    if (r.textures && r.textures.copied) lib.textureRev = (+lib.textureRev || 0) + 1;
    libResult = libResultText(r);
    P().apply();
  }

  async function pickLibrary(kind) {
    if (!window.api || !window.api.pickMilkdropLibrary) { P().toast(tr('İçe aktarma kullanılamıyor.'), 'err'); return; }
    libSetBusy(tr('Taranıyor…'));
    P().rerender();
    let r = null;
    try { r = await window.api.pickMilkdropLibrary(kind); } catch (e) { r = null; }
    libSetBusy('');
    if (!r || !r.ok) {
      P().rerender();
      if (!r || !r.canceled) P().toast(libError(r && r.error), 'err');
      return;
    }
    await confirmAndImport(r);
  }

  async function discoverLibraries() {
    if (!window.api || !window.api.discoverMilkdropLibraries) { P().toast(tr('İçe aktarma kullanılamıyor.'), 'err'); return; }
    libFound = null;
    libSetBusy(tr('Makinede aranıyor…'));
    P().rerender();
    let r = null;
    try { r = await window.api.discoverMilkdropLibraries(); } catch (e) { r = null; }
    libSetBusy('');
    libFound = (r && r.ok && Array.isArray(r.libraries)) ? r.libraries : [];
    libSearchDone = !(r && r.complete === false);
    P().rerender();
  }

  /* KÜÇÜK RESİMLER (#575). Izgara görünümünde her hücrenin küçük resmi ana
     süreçten geliyor: görünen hücrelerin kimlikleri isteniyor, hazır
     olanların anahtarı hemen dönüyor, gerisi çizildikçe olayla. Görsel
     `sv-thumb://t/<anahtar>.webp`. Görünüm (liste / ızgara) bu
     görüntüleyicinin tercihi: ayara değil tarayıcı deposuna yazılıyor.
       thumbKeys: kimlik → anahtar ('' = çizilemedi); çizimler arasında
       kalıyor. Preset değişince ya da silinince (değişiklik yayını) kaydı,
       doku klasörü ya da içe aktarılan dokular değişince hepsi düşüyor.
     Bekleyen hücre çizgili, çizilemeyen kesikli çerçeveli: ikisi de siyah
     bir küçük resimden ayrı görünmeli — presetlerin ~%9'u gerçekten siyah
     başlıyor. */
  const VIEW_KEY = 'sv-md-view';
  let viewMode = (() => {
    try { return localStorage.getItem(VIEW_KEY) === 'grid' ? 'grid' : 'list'; } catch (e) { return 'list'; }
  })();
  const thumbKeys = new Map();
  const thumbWanted = new Set();
  let thumbTexSig = null;
  let thumbObserver = null;
  let thumbTimer = null;
  let thumbListening = false;
  // Gözlemci (IntersectionObserver) yoksa istenen ilk hücre sayısı
  const THUMB_FIRST = 24;
  const thumbUrl = (key) => 'sv-thumb://t/' + key + '.webp';

  function setView(v) {
    viewMode = v === 'grid' ? 'grid' : 'list';
    try { localStorage.setItem(VIEW_KEY, viewMode); } catch (e) { /* depo yok: bu oturumluk */ }
  }

  function listenThumbs() {
    if (thumbListening || !window.api) return;
    thumbListening = true;
    if (window.api.onMilkdropThumb) {
      window.api.onMilkdropThumb((t) => {
        if (!t || typeof t.id !== 'string') return;
        // Beklerken anahtarı eskidi (dokular değişti): yeni anahtarla yeniden
        if (t.stale) { thumbKeys.delete(t.id); paintThumb(thumbBox(t.id), undefined); wantThumb(t.id); return; }
        setThumb(t.id, t.ok ? String(t.key || '') : '');
      });
    }
    if (window.api.onPresetsDelta) {
      window.api.onPresetsDelta((d) => {
        for (const p of (d && d.upsert) || []) if (p && p.id) thumbKeys.delete(p.id);
        for (const id of (d && d.remove) || []) thumbKeys.delete(id);
      });
    }
  }

  function thumbBox(id) {
    if (typeof document === 'undefined') return null;
    const root = (document.getElementById && document.getElementById('sections')) || document;
    if (!root || !root.querySelectorAll) return null;
    for (const b of root.querySelectorAll('.md-thumb-box')) if (b.getAttribute('data-id') === id) return b;
    return null;
  }

  // Hücrenin durumu: anahtar (görsel), '' (çizilemedi) ya da undefined (bekliyor)
  function paintThumb(box, key) {
    if (!box) return;
    const img = box.querySelector && box.querySelector('img');
    box.classList.remove('pending', 'failed');
    if (key) {
      if (img && img.getAttribute('src') !== thumbUrl(key)) img.setAttribute('src', thumbUrl(key));
      box.removeAttribute('title');
      return;
    }
    if (img) img.removeAttribute('src');
    box.classList.add(key === '' ? 'failed' : 'pending');
    box.setAttribute('title', tr(key === '' ? 'Küçük resim çizilemedi' : 'Küçük resim hazırlanıyor…'));
  }

  function setThumb(id, key) {
    thumbKeys.set(id, key);
    paintThumb(thumbBox(id), key);
  }

  function wantThumb(id) {
    if (!id) return;
    thumbWanted.add(id);
    clearTimeout(thumbTimer);
    thumbTimer = setTimeout(flushThumbs, 80);
  }

  async function flushThumbs() {
    thumbTimer = null;
    const ids = Array.from(thumbWanted);
    thumbWanted.clear();
    if (!ids.length || !window.api || !window.api.milkdropThumbs) return;
    listenThumbs();
    let r = null;
    try { r = await window.api.milkdropThumbs(ids); } catch (e) { r = null; }
    if (!r || !r.ok || !r.ready) return;
    for (const id of Object.keys(r.ready)) setThumb(id, String(r.ready[id] || ''));
  }

  /* Her çizimde gözlemci yeniden kuruluyor: panel düğümleri baştan
     yaratıyor. Görünen hücreler (biraz payla) isteniyor; ana süreç aynı
     anahtarı bir kez çiziyor, önbellektekini hemen döndürüyor — yani görünen
     her hücreyi her çizimde yeniden istemek ucuz ve dışarıda değişen bir
     doku da böylece fark ediliyor. */
  function watchThumbs(grid) {
    if (thumbObserver) { try { thumbObserver.disconnect(); } catch (e) { /* yok say */ } thumbObserver = null; }
    const boxes = grid && grid.querySelectorAll ? Array.from(grid.querySelectorAll('.md-thumb-box')) : [];
    if (typeof IntersectionObserver !== 'function') {
      boxes.slice(0, THUMB_FIRST).forEach((b) => wantThumb(b.getAttribute('data-id')));
      return;
    }
    thumbObserver = new IntersectionObserver((entries) => {
      for (const en of entries) if (en.isIntersecting) wantThumb(en.target.getAttribute('data-id'));
    }, { root: grid, rootMargin: '160px 0px' });
    boxes.forEach((b) => thumbObserver.observe(b));
  }

  async function importPack() {
    const IS = window.SVPresets;
    const L = LB();
    if (!IS || !IS.readImported || !window.api || !window.api.importShaderText || !window.api.savePresets) {
      P().toast(tr('İçe aktarma kullanılamıyor.'), 'err');
      return;
    }
    const r = await window.api.importShaderText();
    if (!r || !r.ok) {
      if (r && r.error === 'FILE_TOO_LARGE') P().toast(tr('Dosya çok büyük (2 MB üstü).'), 'err');
      return;
    }
    let data = null;
    try { data = JSON.parse(r.text); } catch (e) { data = null; }
    const read = data ? IS.readImported(data) : { ok: false };
    if (!read.ok) {
      P().toast(tr('Paket okunamadı (.svpack ya da .svpreset bekleniyordu).'), 'err');
      return;
    }
    const res = await window.api.savePresets(read.presets);
    const saved = (res && res.saved) || [];
    adoptDelta({ upsert: saved });
    if (L) L.adopt(library(P().cfg()), read.library, saved);
    refresh(() => {
      P().apply();
      P().toast(saved.length + ' ' + tr('preset içe aktarıldı.'), 'ok');
    });
  }

  function setTags(id, input) {
    const L = LB();
    const cfg = P().cfg();
    if (!L || !id) return;
    const lib = library(cfg);
    const before = JSON.stringify(L.tagsOf(lib, id));
    lib.tags = L.withTags(lib, id, input);
    if (JSON.stringify(L.tagsOf(lib, id)) !== before) P().apply();
  }

  /* Katman yığını AÇIKKEN sahneyi cfg.visualizer.type belirlemiyor:
     layers.js'teki resolve() liste doluysa yalnız cfg.layers'a bakıyor.
     Bu yüzden panelden preset seçmek hiçbir şeyi değiştirmiyordu — kullanıcı
     tıklıyor, sahne aynı kalıyordu (#560, madde 8).

     Yığının anlamını bozmadan çözüm: görselleştirici katmanını MilkDrop'a
     çevirmek. Katmanların geri kalanı (arkaplan, metin, görseller) olduğu
     gibi kalıyor; yalnız hangi motorun çizdiği değişiyor. Böyle bir katman
     yoksa bir tane ekleniyor, çünkü seçimin görünür olması gerekiyor.

     Metin ve "şimdi çalan" katmanları da kind='visualizer' taşıyor ama
     görselleştirici değiller; onları çevirmek kullanıcının yazısını
     silerdi. */
  const OVERLAY_TYPES = ['text', 'nowplaying'];

  function pointStackAtMilkdrop(cfg) {
    const L = window.SVLayers;
    if (!L || !L.stackOn || !L.stackOn(cfg)) return;
    if (!Array.isArray(cfg.layers) || !cfg.layers.length) return;
    const vis = cfg.layers.filter(
      (l) => l && l.kind === 'visualizer' && OVERLAY_TYPES.indexOf(l.type) < 0);
    if (vis.length) {
      /* Birden çok görselleştirici katmanı varsa yalnız ilki çevriliyor:
         hepsini çevirmek kullanıcının kurduğu kompozisyonu tek tıkla yok
         ederdi. */
      vis[0].type = 'milkdrop';
      if (vis[0].settings && vis[0].settings.visualizer) {
        vis[0].settings.visualizer.type = 'milkdrop';
      }
      vis[0].enabled = true;
      vis[0].muted = false;
      return;
    }
    cfg.layers.push({
      id: 'ly_vis_md', name: 'MilkDrop', kind: 'visualizer', type: 'milkdrop',
      enabled: true, settings: {},
    });
  }

  function load(cfg, p) {
    cfg.milkdrop = cfg.milkdrop || window.SV.defaultConfig().milkdrop;
    cfg.milkdrop.presetId = p ? p.id : '';
    cfg.milkdrop.name = p ? p.name : '';
    cfg.milkdrop.source = p ? p.source : '';
    // Her seçim yeniden karışarak yükleniyor; "şimdi kes" bunu `go`da açıyor
    control(cfg).cutTo = '';
    // Sahne MilkDrop motoruna geçsin, yoksa yükleme görünmez olur
    cfg.visualizer.type = 'milkdrop';
    pointStackAtMilkdrop(cfg);
  }

  const CY = () => window.SVMilkdropCycle;

  /* SAHNEYE AİT OLMAYAN İKİ BLOK (defaults.js). Sahne kaydı ve şablon
     `milkdrop` bloğunu bütünüyle değiştiriyor; puanlar, kilit ve "şimdi
     kes" orada dursaydı bir sahne geçişi onları silerdi. */
  function library(cfg) {
    const l = cfg.milkdropLibrary || (cfg.milkdropLibrary = {});
    if (!l.ratings || typeof l.ratings !== 'object') l.ratings = {};
    if (!l.favorites || typeof l.favorites !== 'object') l.favorites = {};
    if (!l.tags || typeof l.tags !== 'object') l.tags = {};
    return l;
  }
  // Favoriler, etiketler, yazar, arama ve havuz (#576)
  const LB = () => window.SVMilkdropLibrary;
  function control(cfg) {
    return cfg.milkdropControl || (cfg.milkdropControl = { locked: false, cutTo: '' });
  }
  const ratingsOf = (cfg) => (cfg && cfg.milkdropLibrary && cfg.milkdropLibrary.ratings) || null;

  /* GEÇMİŞ (#569) panelde, çünkü "geri" bir kullanıcı eylemi ve elle seçim
     bütün pencerelere buradan gidiyor. Kayıt ise görselleştiricinin ~30 Hz
     ölçer mesajından: otomatik geçişin ve sert geçişin seçtikleri de
     giriyor (admin.js → `noteLive`). */
  let hist = null;
  function history() {
    if (!hist && CY() && CY().History) hist = new (CY().History)(64);
    return hist;
  }

  // Motorun elle seçim anahtarıyla aynı biçim (modes/milkdrop.js `_manualKey`)
  const manualKey = (md) => (md.presetId || '') + '|' + (md.source || '').length;

  /* Ekranda O AN olan preset: görselleştiricinin son mesajı tazeyse ve AYNI
     elle seçimin üstündeyse onun seçtiği, değilse ayardaki. */
  function liveId(md) {
    const F = window.SVMdFollow;
    if (F && F.id && F.base === manualKey(md) && (performance.now() - F.at) < 1500) return F.id;
    return md.presetId || '';
  }

  // Rastgele seçim motorunkiyle aynı kural: o an görülen hariç, puana göre
  function randomPick(cfg, md) {
    const C = CY();
    if (!C) return presets[(Math.random() * presets.length) | 0];
    const ratings = ratingsOf(cfg);
    const w = md.useRatings === false ? null : (p) => C.ratingOf(p, ratings);
    return C.pick(presets, liveId(md), 'random', Math.random, w);
  }

  /* `cut`: karışmadan yükle (#570, "şimdi kes"). Motor bunu elle seçimin
     kendisinden okuyor: `milkdropControl.cutTo` yeni seçilen presetin
     kimliğiyse o geçiş karışmıyor. `load` alanı her seçimde temizliyor,
     yani bir sonraki sıradan seçim yine ayardaki süreyle karışıyor. */
  function go(cfg, p, cut) {
    if (!p) return;
    load(cfg, p);
    if (cut) control(cfg).cutTo = p.id;
    const h = history();
    if (h) h.note(p.id);
    P().apply();
  }

  const byId = (id) => presets.find((p) => p.id === id);

  /* ÜRETİCİ (#579). Üretilen preset KAYDEDİLMEDEN elle seçim gibi
     yükleniyor: aynı yol, yani katman yığını MilkDrop'a dönüyor, geçmişe
     giriyor ve bütün pencereler görüyor. Kimliği listede olmadığı için
     puan, favori ve etiket kapalı (üçü de `byId` soruyor), ◀/▶ geçmişteki
     kaydını atlıyor, liste adımı listenin başından sürüyor. */
  function preview(p) {
    if (!p || typeof p.id !== 'string' || !p.id || typeof p.source !== 'string') return false;
    go(P().cfg(), p);
    return true;
  }

  /* Kaydedilen preset HEMEN listeye. Kaydı başka bir kart yapıyor; değişiklik
     yayını gelene kadar liste eski kalır, ekrandaki önizlemenin yıldızları
     ve favori düğmesi bir çizim boyunca kapalı görünürdü. */
  function adopt(saved) {
    if (!saved || !saved.id) return;
    adoptDelta({ upsert: [saved] });
    refresh(() => P().rerender());
  }

  /* Liste adımı EKRANDAKİ presete göre: otomatik geçiş ilerlemişse
     "sonraki" ayardaki elle seçimin değil, o an görülenin sonraki
     (MilkDrop'ta da `m_nCurrentPreset` gösterileni tutuyor). */
  function stepList(cfg, md, dir, cut) {
    if (!presets.length) return;
    const i = presets.findIndex((p) => p.id === liveId(md));
    const j = ((i < 0 ? 0 : i + dir) % presets.length + presets.length) % presets.length;
    go(cfg, presets[j], cut);
  }

  /* ◀ ve ▶ GEÇMİŞTE geziyor (#569): ekranda gösterilenler, otomatik
     geçişin seçtikleri dahil. Silinmiş bir presete denk gelen adım
     atlanıyor. Geçmiş boşsa listede bir önceki; ileride bir şey yoksa
     sıraya göre yenisi — rastgelede puana göre. */
  function navBack(cfg, md) {
    const h = history();
    for (let id = h && h.back(); id; id = h.back()) {
      const p = byId(id);
      if (p) { go(cfg, p); return; }
    }
    stepList(cfg, md, -1);
  }

  function navForward(cfg, md, cut) {
    const h = history();
    for (let id = h && h.forward(); id; id = h.forward()) {
      const p = byId(id);
      if (p) { go(cfg, p, cut); return; }
    }
    if (md.autoOrder === 'random') go(cfg, randomPick(cfg, md), cut);
    else stepList(cfg, md, 1, cut);
  }

  /* DENETLEYİCİ EYLEMLERİ (#570). MIDI ve OSC buradan geçiyor (control.js
     `runAction`), yani geçmiş, puan ağırlığı ve kilit düğmelerle aynı.
     "Şimdi kes" MilkDrop'un H tuşu: sıradaki preset, karışmadan
     (`LoadRandomPreset(0.0f)`). Puan bir tam adım oynuyor ve 0..5'te
     kalıyor; dosyadan gelen 3,5 gibi bir puan önce tam sayıya iniyor ya
     da çıkıyor. Dönüş: bir şey yapıldı mı. */
  /* İşletim sisteminin "hareketi azalt" isteği (#581). Panel aynı
     makinede; ayar değişince kendini yeniden çiziyor. */
  let rmq = null;
  function osReducedMotion() {
    if (!rmq && typeof window !== 'undefined' && typeof window.matchMedia === 'function') {
      rmq = window.matchMedia('(prefers-reduced-motion: reduce)');
      const re = () => { try { P().rerender(); } catch (e) { /* panel yok */ } };
      if (rmq.addEventListener) rmq.addEventListener('change', re);
      else if (rmq.addListener) rmq.addListener(re);
    }
    return !!(rmq && rmq.matches);
  }

  /* SPRITE'LAR (#577). Komut ana sürece gidiyor, oradan her motora; panel
     yalnız sonucu (hata varsa) söylüyor. */
  const SPRITE_ERR = {
    NO_FILE: 'Sprite dosyası seçilmedi',
    NOT_FILE: 'milk_img.ini okunamadı',
    READ_FAILED: 'milk_img.ini okunamadı',
    TOO_LARGE: 'Dosya çok büyük',
    BAD_NUM: 'Numara 00 ile 99 arasında olmalı',
    NOT_DEFINED: 'Bu numara milk_img.ini içinde tanımlı değil',
    NO_IMG: 'img= satırı boş',
    BAD_PATH: 'Resim yolu kabul edilmiyor: tam yolda sürücü yazılmalı, ya da yol ini dosyasının klasörüne göre olmalı',
    UNSUPPORTED: 'Desteklenmeyen resim biçimi (JPG, PNG, BMP, GIF, WebP)',
    NOT_FOUND: 'Resim bulunamadı',
  };
  const spriteErr = (code) => tr(SPRITE_ERR[code] || 'Sprite başlatılamadı');

  /* Liste isteği bir sonraki göreve bırakılıyor: `P().apply()` önce paneli
     çiziyor, ayarı SONRA gönderiyor. Hemen sorulsaydı ana süreç yeni
     seçilen dosyayı henüz bilmez, eskisini okurdu. Aynı sayfanın IPC
     iletileri sırasıyla işleniyor; ayar önce varıyor. */
  function loadSprites(file) {
    if (!window.api || !window.api.milkdropSprites) return;
    sprFor = file;
    setTimeout(() => {
      window.api.milkdropSprites().then((r) => {
        if (sprFor !== file) return;
        sprList = r || null;
        P().rerender();
      }).catch(() => {});
    }, 0);
  }

  async function spriteCmd(req) {
    if (!window.api || !window.api.milkdropSprite) return false;
    const r = await window.api.milkdropSprite(req);
    if (r && !r.ok) P().toast((r.num ? r.num + ': ' : '') + spriteErr(r.error));
    return !!(r && r.ok);
  }

  /* Denetleyici hedefleri (control.js): tanımlı ve başlatılabilir her sprite
     bir eylem. Liste paneldeki son okumadan. */
  function spriteTargets() {
    const list = sprList && Array.isArray(sprList.sprites) ? sprList.sprites : [];
    return list.filter((s) => !s.error).map((s) => ({
      action: 'mdSprite:' + s.num,
      label: '🖼 MilkDrop · Sprite ' + s.num + (s.desc || s.img ? ' · ' + (s.desc || s.img) : ''),
    }));
  }

  function act(name) {
    const cfg = P().cfg();
    const md = cfg.milkdrop || (cfg.milkdrop = window.SV.defaultConfig().milkdrop);
    // Sprite eylemleri presetlere bağlı değil: preset listesi boşken de çalışıyor
    if (name.indexOf('Sprite') === 0) {
      if (name === 'SpriteNewest') spriteCmd({ op: 'newest' });
      else if (name === 'SpriteOldest') spriteCmd({ op: 'oldest' });
      else if (name === 'SpriteAll') spriteCmd({ op: 'all' });
      else if (name.indexOf('Sprite:') === 0) spriteCmd({ op: 'launch', num: name.slice(7) });
      else return false;
      return true;
    }
    if (name === 'Lock') {
      const c = control(cfg);
      c.locked = c.locked !== true;
      P().apply();
      return true;
    }
    if (!presets.length) return false;
    if (name === 'Next') navForward(cfg, md);
    else if (name === 'Prev') navBack(cfg, md);
    else if (name === 'Random') go(cfg, randomPick(cfg, md));
    else if (name === 'Cut') navForward(cfg, md, true);
    else if (name === 'RateUp' || name === 'RateDown') {
      const id = liveId(md);
      const p = byId(id);
      const C = CY();
      if (!p || !C) return false;
      /* Adım ETKİN puandan atılıyor: puan verilmemiş presette dosyadaki
         puandan. "Artır" bir preseti asla daha seyrek getirmemeli —
         dosyada 5 yazan bir preset boş yıldızdan 1'e inseydi öyle olurdu. */
      const r = C.ratingOf(p, ratingsOf(cfg));
      setRating(id, name === 'RateUp' ? Math.min(5, Math.floor(r) + 1) : Math.max(0, Math.ceil(r) - 1));
    } else if (name === 'Favorite') {
      // Ekrandaki preset favorilere girer ya da çıkar (#576)
      const L = LB();
      const id = liveId(md);
      if (!L || !byId(id)) return false;
      setFavorite(id, !L.isFavorite(cfg.milkdropLibrary, id));
    } else {
      return false;
    }
    return true;
  }

  /* PUAN YILDIZLARI — ekrandaki presetin. Otomatik geçiş preseti
     değiştirince panel yeniden çizilmiyor (odak kaybolurdu); yıldızlar
     yerinde tazeleniyor. 0 ayrı bir düğme: rastgele sırada hiç gelmeyecek
     demek, "puansız" değil. */
  let starsFor = null;
  function fillStars(wrap, cfg) {
    const el = P().el;
    const C = CY();
    const id = liveId(cfg.milkdrop || {});
    starsFor = id;
    wrap.textContent = '';
    const p = presets.find((x) => x.id === id);
    if (!p || !C) {
      wrap.appendChild(el('span', { class: 'dim-hint', text: '—' }));
      return;
    }
    /* YALNIZ SİZİN VERDİĞİNİZ PUAN YILDIZ OLARAK GÖRÜNÜYOR (#587).
       Puan verilmemiş preset boş görünüyor; dosyanın kendi `fRating`i
       yıldızlara taşınmıyor. Önceden taşınıyordu ve hiç puan verilmemiş bir
       preset beş yıldızla geliyordu — korpusun %95'i dosyada 5 yazıyor —
       yani bir puan verip başka presete geçince yıldızlar "bozuk" görünüyordu.

       SEÇİM BUNDAN ETKİLENMİYOR, bilerek: rastgele sıra puan verilmemiş
       presette dosyadaki puanı kullanmaya devam ediyor (`C.ratingOf`,
       MilkDrop'un kuralı: plugin.cpp:5795-5796). Gösterimi seçime
       "eşitlemek" için ağırlığı değiştirmek, kitaplığın yazarların verdiği
       puanlara göre dağılmasını sessizce bozardı. */
    const mine = ratingsOf(cfg);
    const own = mine && Object.prototype.hasOwnProperty.call(mine, id) && isFinite(Number(mine[id]))
      ? Math.max(0, Math.min(5, Number(mine[id]))) : null;
    wrap.classList && wrap.classList.toggle('md-unrated', own === null);
    for (let k = 0; k <= 5; k++) {
      const on = own !== null && (k === 0 ? own === 0 : k <= own);
      wrap.appendChild(el('button', {
        class: 'md-star' + (k === 0 ? ' md-star0' : '') + (on ? ' on' : ''),
        type: 'button', title: String(k),
        text: k === 0 ? '0' : (on ? '★' : '☆'),
        onclick: () => setRating(id, k),
      }));
    }
  }

  function setRating(id, k) {
    const cfg = P().cfg();
    const lib = library(cfg);
    const next = Object.assign({}, lib.ratings);
    next[id] = k;
    lib.ratings = next;
    P().apply();
  }

  function syncStars() {
    const wrap = document.getElementById('mdStars');
    const cfg = P() && P().cfg && P().cfg();
    if (wrap && cfg && cfg.milkdrop) fillStars(wrap, cfg);
    const fav = document.getElementById('mdFav');
    if (fav && cfg && cfg.milkdrop) fillFav(fav, cfg);
    /* Etiket kutusu yazılırken tazelenmiyor: otomatik geçiş kullanıcının
       yazdığını silip başka presetin etiketlerini koyardı. */
    const box = document.getElementById('mdTagsBox');
    const typing = box && document.activeElement && box.contains(document.activeElement);
    if (box && cfg && cfg.milkdrop && !typing) fillTags(box, cfg);
  }

  /* EKRANDAKİ PRESETİN FAVORİSİ VE ETİKETLERİ (#576). Yıldızlar gibi
     ekrandakinin ve yerinde tazeleniyor; metinler burada çevriliyor, çünkü
     tazeleme DOM çevirmeninden sonra geliyor. */
  function fillFav(btn, cfg) {
    const L = LB();
    const id = liveId(cfg.milkdrop || {});
    const ok = !!(L && byId(id));
    const on = ok && L.isFavorite(cfg.milkdropLibrary, id);
    btn.textContent = tr(on ? '★ Favori' : '☆ Favorilere Ekle');
    btn.className = 'btn ghost small md-fav-live' + (on ? ' on' : '');
    btn.setAttribute('aria-pressed', on ? 'true' : 'false');
    btn.disabled = !ok;
  }

  function fillTags(box, cfg) {
    const el = P().el;
    const L = LB();
    const id = liveId(cfg.milkdrop || {});
    box.textContent = '';
    box.setAttribute('data-for', id);
    if (!L || !byId(id)) {
      box.appendChild(el('span', { class: 'dim-hint', text: '—' }));
      return;
    }
    const lib = cfg.milkdropLibrary;
    const mine = L.tagsOf(lib, id);
    box.appendChild(el('input', {
      class: 'p-in md-tags-in', type: 'text', value: mine.join(', '),
      placeholder: tr('virgülle ayırın: sakin, dans'),
      'aria-label': tr('Etiketler'),
      /* Yazılan etiket KUTUNUN presetine gidiyor: kutu yazılırken
         tazelenmediği için (`syncStars`) bu, yazmaya başlanan preset —
         otomatik geçiş o arada ekrandakini değiştirse de. */
      onchange: (e) => { setTags(id, e.target.value); },
      onkeydown: (e) => { if (e.key === 'Enter') e.target.blur(); },
      onblur: () => {
        // Yazarken ekrandaki preset değiştiyse kutu şimdi ona dönüyor
        setTimeout(() => {
          const b = document.getElementById('mdTagsBox');
          const c = P().cfg();
          if (b && c && c.milkdrop && b.getAttribute('data-for') !== liveId(c.milkdrop)) fillTags(b, c);
        }, 0);
      },
    }));
    /* Var olan etiketler tek tıkla eklenip çıkarılıyor: virgüllü kutuda
       tarayıcının öneri listesi yalnız ilk etikete yarardı. */
    const known = L.tagCounts(presets, lib);
    if (known.length) {
      const wrap = el('span', { class: 'md-tagchips' });
      for (const t of known.slice(0, 40)) {
        const on = mine.some((m) => L.fold(m) === t.key);
        wrap.appendChild(el('button', {
          class: 'md-tagchip' + (on ? ' on' : ''), type: 'button', text: '#' + t.name,
          'aria-pressed': on ? 'true' : 'false',
          title: tr(on ? 'Bu presetten çıkar' : 'Bu presete ekle'),
          onclick: () => setTags(id, on ? mine.filter((m) => L.fold(m) !== t.key) : mine.concat([t.name])),
        }));
      }
      box.appendChild(wrap);
    }
  }

  /* ÖLÇÜ DURUMU (#571) — görselleştiricinin söylediği; sayı ve metin ayrı
     düğümlerde, çünkü çeviri sözlüğü tam metin eşliyor. Mesaj yalnız
     değişince yeniden yazılıyor: ~30 Hz geliyor. */
  let lastBars = null;
  let lastBarsKey = '';
  function fillBarStatus(wrap, info) {
    const el = P().el;
    const tt = (s) => (window.SVI18n && window.SVI18n.t ? window.SVI18n.t(s) : s);
    wrap.textContent = '';
    if (!info) {
      wrap.appendChild(el('span', { text: tt('Ölçü sayacı görselleştirici açıkken burada görünür.') }));
      return;
    }
    if (info.noTempo || !info.bpm) {
      wrap.appendChild(el('span', { text: tt('Tempo bulunamadı: ölçüler sayılamıyor, geçiş zamana düştü.') }));
      return;
    }
    wrap.appendChild(el('span', { class: 'md-num', text: info.bpm + ' BPM · ' + info.count + '/' + info.of + ' ' }));
    wrap.appendChild(el('span', { text: tt('ölçü') }));
  }

  /* Ölçer mesajı (admin.js): görselleştiricinin o an çizdiği preset.
     Elle seçimden önceki bayat mesaj `base` eşleşmediği için atılıyor —
     yoksa az önce bırakılan preset geçmişe yeni bir kayıt gibi girerdi. */
  function noteLive(mp) {
    const bars = mp && mp.bars ? mp.bars : null;
    const key = bars ? [bars.bpm, bars.count, bars.of, bars.noTempo].join('|') : '';
    if (key !== lastBarsKey) {
      lastBarsKey = key;
      lastBars = bars;
      const bs = document.getElementById('mdBarStatus');
      if (bs) fillBarStatus(bs, lastBars);
    }
    const cfg = P() && P().cfg && P().cfg();
    const md = cfg && cfg.milkdrop;
    if (!md || !mp || mp.base !== manualKey(md)) return;
    const id = mp.id || md.presetId || '';
    const h = history();
    if (h) h.note(id);
    if (id !== starsFor) syncStars();
  }

  function panel() {
    const el = P().el;
    const cfg = P().cfg();
    const md = cfg.milkdrop || (cfg.milkdrop = window.SV.defaultConfig().milkdrop);
    const rerender = () => P().apply();
    const nodes = [];

    // Ortak liste değişiklik yayınıyla güncel (#574): her çizimde ondan
    if (!fromStore()) {
      if (!loaded && !loading) {
        refresh(() => P().rerender());
      } else if (!loaded) {
        staleRender = true;
      }
    }

    // Durum
    /* Otomatik geçiş açıkken ekrandaki preset AYARDAKİ DEĞİL: seçim ayara
       yazılmıyor (shared/milkdrop-cycle.js). Ad, görselleştiricinin ~30 Hz
       ölçer mesajıyla yerinde güncelleniyor (admin.js); `data-cfg` o mesaj
       "ayardaki preset çiziliyor" dediğinde dönülecek ad. Metinler burada
       çevriliyor çünkü güncelleme DOM çevirmeninden sonra geliyor. */
    const tt = (s) => (window.SVI18n && window.SVI18n.t ? window.SVI18n.t(s) : s);
    const current = md.name ? tr(md.name) : tt(md.source ? 'Adsız' : 'Yerleşik varsayılan');
    const lf = window.SVMdFollow;
    const live = lf && lf.id && (performance.now() - lf.at) < 1500 ? (tr(lf.name) || tt('Adsız')) : null;
    nodes.push(P().row('Yüklü Preset', el('span', {
      id: 'mdLiveName', class: 'md-cur', 'data-cfg': current, text: live || current,
    })));
    /* PUAN (#569). Presetin kendi `fRating`iyle başlıyor; verilen puan
       ayarlara yazılıyor. Rastgele sıra puana göre ağırlıklı. */
    const stars = el('span', { id: 'mdStars', class: 'md-stars' });
    fillStars(stars, cfg);
    nodes.push(P().row('Puan', stars));
    /* FAVORİ VE ETİKETLER (#576) — ekrandaki presetin. Ayarlara, preset
       kimliğine bağlı yazılıyor; preset dosyasına dokunulmuyor. */
    const favBtn = el('button', { id: 'mdFav', type: 'button', onclick: () => act('Favorite') });
    fillFav(favBtn, cfg);
    nodes.push(P().row('Favori', favBtn));
    const tagsBox = el('span', { id: 'mdTagsBox', class: 'md-tagsbox' });
    fillTags(tagsBox, cfg);
    nodes.push(P().row('Etiketler', tagsBox));

    // Doğrulama: yüklü presetin derleme durumu
    if (md.source && window.SVMilkdrop) {
      try {
        // Görselleştiricinin okuyacağı kuralla (#580: uyum açıkken MilkDrop'unki)
        const p = new window.SVMilkdrop.Preset(md.source, { accurate: md.accurate !== false });
        /* Sayı ve metin AYRI düğümlerde. i18n sözlüğü metin düğümlerini
           birebir eşleştiriyor, dolayısıyla '3 hata' gibi birleşik bir metin
           hiçbir zaman eşleşmez ve İngilizce arayüzde Türkçe kalırdı —
           #559'daki ekran görüntüsünde tam olarak bu görünüyor. */
        const st = el('span', { class: p.errors.length ? 'md-err' : 'md-ok' });
        if (p.errors.length) {
          st.appendChild(el('span', { text: '⚠ ' }));
          st.appendChild(el('span', { class: 'md-num', text: String(p.errors.length) + ' ' }));
          st.appendChild(el('span', { text: 'hata' }));
        } else {
          st.appendChild(el('span', { text: '✓ ' }));
          st.appendChild(el('span', {
            class: 'md-num',
            text: String(p.cFrame.statements + p.cPixel.statements + p.cInit.statements) + ' ',
          }));
          st.appendChild(el('span', { text: 'deyim derlendi' }));
        }
        nodes.push(P().row('Derleme', st));
        /* `monitor` — presetin kendi hata ayıklama probu. Render girdisi
           değil; yazar denklemine koyup değerini görmek istiyor. Korpusta
           4.489 preset (%43,4) yazıyor ve okunmadığı sürece o satırlar
           ölüydü. Kimlik sabit, değeri ses ölçer mesajı ~30 Hz yazıyor —
           panel yeniden çizilmiyor, yoksa ayar alanlarındaki odak
           kaybolurdu. "—" yazması "preset hiç yazmadı" demek; 0 yazan bir
           preset 0.0000 gösterir. */
        const mval = window.SVMdMonitor;
        nodes.push(P().row('monitor', el('span', {
          id: 'mdMonitorVal', class: 'md-num',
          text: (mval === null || mval === undefined) ? '—' : Number(mval).toFixed(4),
        })));
        if (p.errors.length) {
          nodes.push(el('div', { class: 'studio-note md-errbox', text: p.errors.join('\n') }));
        }
      } catch (e) {
        nodes.push(P().row('Derleme', el('span', { class: 'md-err', text: String(e.message || e) })));
      }
    }

    /* KALITE AYARLARI (#560, madde 1 ve 7). Ikisi de gorunur bir denge:
       ag sıklıgı kıvrımlı warp'ların koseliligini, ic cozunurluk ise ince
       sekillerin keskinligini belirliyor. Maliyetleri farklı buyuyor — ag
       dogrusal, cozunurluk KARESEL — bu yuzden ayrı ayrı ayarlanıyorlar. */
    const selOf = (pairs, value, onChange) => {
      const sel = el('select', { class: 'sel' });
      for (const [v, label] of pairs) {
        const o = el('option', { value: String(v), text: label });
        if (String(v) === String(value)) o.selected = true;
        sel.appendChild(o);
      }
      sel.addEventListener('change', () => { onChange(sel.value); rerender(); });
      return sel;
    };

    nodes.push(P().row('Ağ Sıklığı', selOf([
      [24, '24x18 (en hızlı)'],
      [32, '32x24 (MilkDrop varsayılanı)'],
      [48, '48x36'],
      [64, '64x48 (önerilen)'],
      [96, '96x72'],
      [128, '128x96 (en pürüzsüz)'],
    ], md.mesh || 64, (v) => { md.mesh = Number(v); })));

    nodes.push(P().row('İç Çözünürlük', selOf([
      [0.75, '0,75x (düşük güçlü makine)'],
      [1, '1x (tuval boyutu)'],
      [1.5, '1,5x'],
      [2, '2x (en keskin)'],
    ], md.renderScale == null ? 1 : md.renderScale, (v) => { md.renderScale = Number(v); })));

    /* Geçiş MilkDrop'un çift boru hattı: eski preset donmuş bir kare değil,
       kendi denklemleri ve shader'larıyla koşmaya devam ediyor. 1,7 ve 2,7
       MilkDrop'un kendi varsayılanları (kullanıcı geçişi / kendiliğinden
       geçiş). */
    nodes.push(P().row('Preset Geçişi', selOf([
      [0, 'Kapalı (sert kesme)'],
      [0.8, '0,8 saniye'],
      [1.7, '1,7 saniye (MilkDrop)'],
      [2.7, '2,7 saniye (MilkDrop otomatik)'],
      [5, '5 saniye'],
    ], md.blendTime == null ? 1.7 : md.blendTime, (v) => { md.blendTime = Number(v); })));

    /* ÇİZGİ ÇİZİMİ. MilkDrop çizgiyi kaydırılmış kopyalarıyla
       kalınlaştırıyor; kalınlık oluyor ama kenar merdiven kalıyor.
       Yumuşatılmış yol çizgiyi şerit olarak çizip kenarı bir teksel
       içinde söndürüyor. "Işık korumalı" seçeneği eski yolun bıraktığı
       ışığı hedefliyor (ölçüldü: ±%12), yani presetlerin parlaklığı
       yerinde kalıyor. "Gerçek kalınlık" fiziksel olarak doğru ama
       dalga taşıyan presetler gözle görülür biçimde sönükleşiyor.

       Ayar ÜÇ çizgiyi birden sürüyor: dalga, şekil kenarlığı ve hareket
       vektörleri. Yalnız dalgaya uygulansaydı aynı karede yumuşak bir
       dalga ile tırtıklı bir kenarlık yan yana dururdu. */
    nodes.push(P().row('Çizgi Çizimi', selOf([
      ['smooth', 'Yumuşatılmış (ışık korumalı)'],
      ['thin', 'Yumuşatılmış (gerçek kalınlık)'],
      ['milkdrop', 'MilkDrop (kaydırmalı kalınlaştırma)'],
    ], md.lineStyle || 'smooth', (v) => { md.lineStyle = String(v); })));

    /* FLAŞ SINIRLAMA. MilkDrop'ta yok; erişilebilirlik için eklendi.
       Korpusta "Definitly Not For The Epileptic" gibi adlar var; yazarı
       ne yaptığını biliyor, izleyen herkes bilmiyor. Ölçüldü: presetlerin
       %90'ı eşiğin altında ve hiç etkilenmiyor. */
    nodes.push(P().row('Flaş Sınırlama', selOf([
      [1, 'Açık (nöbet riskini kes)'],
      [0, 'Kapalı (ham görüntü)'],
    ], md.flashLimit === false ? 0 : 1, (v) => { md.flashLimit = Number(v) === 1; })));

    nodes.push(el('div', {
      class: 'studio-note dim-hint',
      text: 'Ölçüt WCAG 2.3.1\'in genel flaş tanımı: bağıl parlaklıkta 0,10\'dan büyük ve saniyede üçten fazla değişim. Ölçüldü: presetlerin %90\'ı bu eşiğin altında kalıyor ve hiç etkilenmiyor; sınırlama yalnızca kalan %10\'da devreye giriyor ve orada da kesme değil oranlama yapıyor — eşiği on kat aşan bir flaş onda bir geçiyor. Sınır kare başına değil saniye başına tutuluyor: 30 fps\'te kare başına 0,10, 60 Hz\'lik ekranda 0,05 — yenileme hızı yüksek bir ekranda da aynı sıkılıkta.',
    }));

    /* HAREKETİ AZALT (#581). İşletim sistemi hareketin azaltılmasını
       istediğinde flaş sınırlayıcı açık kalıyor, sesin yükselişinde sert
       geçiş olmuyor ve geçişler uzun sürüyor. Panel nedenini söylüyor ve
       kullanıcı iki yönde de geçersiz kılabiliyor. Ayar gösterinin,
       sahnenin değil (`milkdropControl`). */
    {
      const ctl = control(cfg);
      const rm = ctl.reduceMotion === 'on' || ctl.reduceMotion === 'off' ? ctl.reduceMotion : 'system';
      nodes.push(P().row('Hareketi Azalt', selOf([
        ['system', 'Sistemi izle'],
        ['on', 'Her zaman'],
        ['off', 'Kapalı (sistem istese de)'],
      ], rm, (v) => { ctl.reduceMotion = String(v); })));
      const sys = osReducedMotion();
      const on = rm === 'on' || (rm === 'system' && sys);
      const st = el('span', { class: on ? 'md-ok' : 'dim-hint' });
      st.appendChild(el('span', {
        text: on
          ? (rm === 'on' ? 'Açık — bu ayarla' : 'Açık — işletim sistemi hareketin azaltılmasını istiyor')
          : (rm === 'off' && sys ? 'Kapalı — sistem istiyor ama geçersiz kılındı'
            : rm === 'off' ? 'Kapalı' : 'Kapalı — işletim sistemi istemiyor'),
      }));
      nodes.push(P().row('Durum', st));
      if (on) {
        nodes.push(el('div', {
          class: 'studio-note',
          text: 'Flaş sınırlayıcı açık kalıyor, sesin yükselişinde sert geçiş olmuyor ve geçişler 5 saniye sürüyor. Elle "şimdi kes" yine keser. Video dışa aktarımında sistemin ayarı değil yalnız bu ayar ("Her zaman") geçerli.',
        }));
      }
    }

    /* IŞIK RENKLERİ (#589). Işıklar arkaplanın ya da temanın renklerini
       alıyordu, MilkDrop'unkini değil. Buradaki seçim Aydınlatma
       bölümündeki Renk Kaynağı'nın kısayolu: MilkDrop seçilince önceki
       kaynak saklanıyor, geri dönülünce o geri geliyor. */
    const light = cfg.lighting || (cfg.lighting = {});
    nodes.push(P().row('Işık Renkleri', selOf([
      [0, 'Işık ayarındaki kaynak'],
      [1, 'MilkDrop görüntüsü (canlı)'],
    ], light.paletteSource === 'milkdrop' ? 1 : 0, (v) => {
      if (Number(v) === 1) {
        if (light.paletteSource !== 'milkdrop') light.paletteSourceSaved = light.paletteSource || 'background';
        light.paletteSource = 'milkdrop';
      } else if (light.paletteSource === 'milkdrop') {
        const back = light.paletteSourceSaved;
        light.paletteSource = back && back !== 'milkdrop' ? back : 'background';
      }
    })));
    nodes.push(el('div', {
      class: 'studio-note dim-hint',
      text: 'MilkDrop görüntüsü seçiliyken ışıklar rengini o anki kareden alır: görüntü soldan sağa sekiz dilime bölünür ve her dilimin parlak bölgelerinin rengi saniyede yaklaşık 30 kez okunur; ışıkların sırası dilimlerin sırasını izler. Işığın parlaklığını yine ışık kipi sesle belirler. Dynamic Lighting, OpenRGB ve Art-Net\'te çalışır; sahnede MilkDrop yoksa arkaplan renklerine döner.',
    }));
    if (light.paletteSource === 'milkdrop' && !light.enabled
        && !(cfg.openrgb && cfg.openrgb.enabled) && !(cfg.artnet && cfg.artnet.enabled)) {
      nodes.push(el('div', {
        class: 'studio-note md-err',
        text: 'Işık çıkışı kapalı: Aydınlatma bölümünden Dynamic Lighting, OpenRGB ya da Art-Net\'i açın.',
      }));
    }

    /* MILKDROP UYUMLULUĞU. Motorun ölçülebilir uyum hataları düzeltildi ve
       düzeltilmiş değerler varsayılan. Anahtar yalnızca DEĞERLERİ geri
       alıyor — shader'lar, dokular ve doku birimleri iki durumda da aynı;
       böylece tek kod yolu ve tek test yüzeyi kalıyor. */
    nodes.push(P().row('MilkDrop Uyumu', selOf([
      [1, 'Açık (MilkDrop değerleri)'],
      [0, 'Kapalı (motorun eski yaklaşımı)'],
    ], md.accurate === false ? 0 : 1, (v) => { md.accurate = Number(v) === 1; })));

    nodes.push(el('div', {
      class: 'studio-note dim-hint',
      text: 'Açıkken motor MilkDrop\'un kendi değerlerini kullanır: gürültü dokularının kafes ölçekleri, gerçekten üç boyutlu hacim gürültüsü, ekran boyunca değişen renk kayması, doğru bulanıklık ölçeği ve kenar karartması, ağın MilkDrop sırasıyla kurulan dönüşümü (dikey yön, en-boy, yarıçap ve açı), warp titreşiminin kendi ölçeği ve hızı, dalga yumuşatma, sese göre dalga saydamlığı, özel dalgaların gerçek genliği ve tayf kaynağı, dış/iç kenarlıklar ve merkez karartma. Kapalı hâl motorun daha önceki yaklaşık değerlerini geri verir; presetler iki durumda da çalışır, yalnız görüntü farklıdır.',
    }));

    nodes.push(el('div', {
      class: 'studio-note dim-hint',
      text: 'Geçişte iki preset de çalışır: kare denklemleri, warp ağları ve shader\'ları aynı anda koşar ve ekranın farklı yerleri farklı zamanda yeni presete döner. Maliyeti neredeyse tam iki katı: 1280×720\'de ve varsayılan 64\'lük ağda kare süresi 2,7 ms\'den 5,2 ms\'ye çıkıyor, yani 60 fps bütçesinin %31\'i. En yoğun ağda (96) bu oran %67 oluyor.',
    }));

    nodes.push(el('div', {
      class: 'studio-note dim-hint',
      text: 'İç çözünürlüğün maliyeti çarpanın karesi kadar artar: 2x seçildiğinde dört katı piksel işlenir. Ağ sıklığının maliyeti doğrusaldır ama her düğümde preset denklemleri yeniden koşar.',
    }));

    /* DOKU PAKETİ (#560 madde 2). Presetler kendi görsellerini ada göre
       istiyor; preset paketleri o görselleri getirmiyor. Klasör
       gösterilmezse yerine gürültü bağlanıyor — preset çalışır ama deseni
       yanlış olur. */
    if (md.textureDir && !texAsked && window.api && window.api.milkdropTextures) {
      texAsked = true;
      window.api.milkdropTextures().then((r) => {
        texCount = (r && Array.isArray(r.names)) ? r.names.length : 0;
        P().rerender();
      }).catch(() => { texCount = 0; });
    }
    /* Düz bir kapsayıcı: `P().row` zaten kendi `.row`unu kuruyor, ikincisi
       flex kuralını miras alıp iki düğmeyi iki uca iterdi. */
    const texRow = el('span', {}, [
      el('button', {
        class: 'btn', type: 'button', text: '🖼 Doku Klasörü Seç',
        onclick: async () => {
          if (!window.api || !window.api.pickMilkdropTextures) {
            P().toast('Doku klasörü seçimi kullanılamıyor.');
            return;
          }
          const r = await window.api.pickMilkdropTextures();
          if (!r || !r.ok) return;
          md.textureDir = r.dir;
          texCount = r.count;
          texAsked = true;
          rerender();
          P().rerender();
        },
      }),
    ]);
    if (md.textureDir) {
      texRow.appendChild(el('button', {
        class: 'btn', type: 'button', text: 'Kaldır',
        onclick: () => {
          md.textureDir = '';
          texCount = null;
          texAsked = false;
          rerender();
          P().rerender();
        },
      }));
    }
    nodes.push(P().row('Doku Paketi', texRow));
    {
      /* Sayı ve metin AYRI düğümlerde: i18n sözlüğü metin düğümlerini birebir
         eşleştiriyor, birleşik bir metin İngilizce arayüzde Türkçe kalırdı. */
      const st = el('span', { class: md.textureDir ? 'md-ok' : 'md-err' });
      if (!md.textureDir) {
        st.appendChild(el('span', { text: 'Seçilmedi — presetin kendi dokusu yerine gürültü kullanılıyor' }));
      } else if (texCount === null) {
        st.appendChild(el('span', { text: 'Okunuyor…' }));
      } else if (texCount === 0) {
        st.className = 'md-err';
        st.appendChild(el('span', { text: 'Bu klasörde görsel dosyası yok' }));
      } else {
        st.appendChild(el('span', { class: 'md-num', text: String(texCount) + ' ' }));
        st.appendChild(el('span', { text: 'görsel bulundu' }));
      }
      nodes.push(P().row('Durum', st));
    }
    nodes.push(el('div', {
      class: 'studio-note dim-hint',
      text: 'MilkDrop presetleri dokularını ada göre ister: sampler_worms yazan bir preset klasörde worms.jpg arar. Bu görseller preset paketleriyle gelmez; MilkDrop kurulumunuzdaki textures klasörünü gösterin. Klasör seçilmezse preset yine çalışır, yalnız o dokunun yerine gürültü kullanılır.',
    }));

    /* SPRITE'LAR (#577): MilkDrop'un milk_img.ini dosyası. Dosya gösteri
       aracı, sahneyle değişmiyor (`milkdropControl`). */
    {
      const ctl = control(cfg);
      const sFile = typeof ctl.spriteFile === 'string' ? ctl.spriteFile : '';
      if (sFile && sprFor !== sFile) loadSprites(sFile);
      if (!sFile && sprFor) { sprList = null; sprFor = null; }
      const sprRow = el('span', {}, [
        el('button', {
          class: 'btn', type: 'button', text: '🖼 milk_img.ini Seç',
          onclick: async () => {
            if (!window.api || !window.api.pickMilkdropSprites) {
              P().toast('Sprite dosyası seçimi kullanılamıyor.');
              return;
            }
            const r = await window.api.pickMilkdropSprites();
            if (!r || !r.ok) { if (r && r.error) P().toast(spriteErr(r.error)); return; }
            ctl.spriteFile = r.file;
            sprFor = null;
            rerender();
          },
        }),
      ]);
      if (sFile) {
        sprRow.appendChild(el('button', {
          class: 'btn', type: 'button', text: 'Yenile',
          onclick: () => { sprFor = null; P().rerender(); },
        }));
        sprRow.appendChild(el('button', {
          class: 'btn', type: 'button', text: 'Kaldır',
          onclick: () => { ctl.spriteFile = ''; sprList = null; sprFor = null; rerender(); },
        }));
      }
      nodes.push(P().row('Sprite Dosyası', sprRow));
      const st = el('span', { class: sFile && sprList && !sprList.error ? 'md-ok' : 'md-err' });
      if (!sFile) {
        st.appendChild(el('span', { text: 'Seçilmedi' }));
      } else if (!sprList) {
        st.appendChild(el('span', { text: 'Okunuyor…' }));
      } else if (sprList.error) {
        st.appendChild(el('span', { text: spriteErr(sprList.error) }));
      } else {
        st.appendChild(el('span', { class: 'md-num', text: String(sprList.sprites.length) + ' ' }));
        st.appendChild(el('span', { text: 'sprite tanımlı' }));
      }
      nodes.push(P().row('Durum', st));
      if (sFile && sprList && !sprList.error && sprList.sprites.length) {
        const list = el('div', { class: 'md-sprites' });
        for (const s of sprList.sprites) {
          const bad = !!s.error;
          list.appendChild(el('div', { class: 'md-sprite' + (bad ? ' md-sprite-bad' : '') }, [
            el('span', { class: 'md-num', text: s.num }),
            el('span', { class: 'md-sprite-name', text: s.desc || s.img || '—' }),
            bad ? el('span', { class: 'md-err', text: spriteErr(s.error) }) : null,
            el('button', {
              class: 'btn ghost', type: 'button', text: '▶', title: tr('Başlat'), disabled: bad,
              onclick: () => spriteCmd({ op: 'launch', num: s.num }),
            }),
            el('button', {
              class: 'btn ghost', type: 'button', text: '■', title: tr('Bu numaranın hepsini sil'),
              onclick: () => spriteCmd({ op: 'kill', num: s.num }),
            }),
          ].filter(Boolean)));
        }
        nodes.push(list);
        nodes.push(el('div', { class: 'row' }, [
          el('button', { class: 'btn', type: 'button', text: 'En Yeniyi Sil', onclick: () => spriteCmd({ op: 'newest' }) }),
          el('button', { class: 'btn', type: 'button', text: 'En Eskiyi Sil', onclick: () => spriteCmd({ op: 'oldest' }) }),
          el('button', { class: 'btn', type: 'button', text: 'Hepsini Sil', onclick: () => spriteCmd({ op: 'all' }) }),
        ]));
      }
      nodes.push(el('div', {
        class: 'studio-note dim-hint',
        text: 'Sprite, MilkDrop görüntüsünün üstüne çizilen ve kendi koduyla hareket eden bir resimdir. MilkDrop\'un milk_img.ini dosyasını seçin; resim yolları o dosyanın klasörüne göredir. Görselleştirici penceresinde MilkDrop\'un tuşları da çalışır: K ve iki hane başlatır, SHIFT+K ve iki hane o numaranın hepsini siler, sprite kipinde DELETE en yeniyi, SHIFT+DELETE en eskiyi siler, CTRL+K hepsini siler. Bütün ekranlar aynı sprite\'ı gösterir; video dışa aktarımına girmez.',
      }));
    }

    // İçe aktarma
    nodes.push(el('div', { class: 'row' }, [
      el('button', {
        class: 'btn', type: 'button', text: busy || '📂 .milk Dosyaları Ekle',
        disabled: !!busy,
        onclick: async () => {
          if (!window.api || !window.api.importMilk) { P().toast('İçe aktarma kullanılamıyor.'); return; }
          busy = 'Okunuyor…';
          P().rerender();
          try {
            const r = await window.api.importMilk();
            if (!r || !r.ok) { busy = ''; P().rerender(); return; }
            const M = window.SVMilkdrop;
            const items = [];
            let bad = 0;
            for (const f of r.files) {
              const parsed = M ? new M.Preset(f.text, { name: f.name, accurate: md.accurate !== false }) : null;
              if (parsed && parsed.errors.length) bad++;
              items.push({
                id: 'md_' + Math.random().toString(36).slice(2, 10),
                kind: 'milkdrop',
                name: f.name,
                source: f.text,
                updatedAt: Date.now(),
              });
            }
            if (items.length && window.api.savePresets) {
              const res = await window.api.savePresets(items);
              adoptDelta({ upsert: (res && res.saved) || [] });
            }
            busy = '';
            refresh(() => {
              P().rerender();
              P().toast(items.length + ' preset eklendi' +
                (bad ? ' (' + bad + ' tanesinde derleme uyarısı var)' : '') +
                (r.skipped ? ' — ' + r.skipped + ' dosya atlandı' : ''));
            });
          } catch (e) {
            busy = '';
            P().rerender();
            P().toast('İçe aktarılamadı: ' + (e.message || e));
          }
        },
      }),
      el('button', {
        class: 'btn ghost', type: 'button', text: 'Varsayılana Dön',
        onclick: () => { load(cfg, null); rerender(); },
      }),
    ]));
    // Paket (#576): favori, etiket ve puanlar presetlerle birlikte
    nodes.push(el('div', { class: 'row' }, [
      el('button', {
        class: 'btn ghost', type: 'button', text: '📦 Görünenleri Paketle',
        title: 'Listede görünen kendi presetlerinizi favori, etiket ve puanlarıyla tek dosyaya yazar',
        onclick: () => exportPack(cfg),
      }),
      el('button', {
        class: 'btn ghost', type: 'button', text: '📥 Paket İçe Aktar',
        title: 'Bir .svpack paketini favori, etiket ve puanlarıyla ekler',
        onclick: () => importPack(),
      }),
    ]));
    /* KÜTÜPHANE (#574): ZIP paketi, klasör ya da makinede bulunan bir
       kütüphane. Önce ne ekleneceği gösteriliyor, onaysız kopya yok. */
    nodes.push(el('div', { class: 'row' }, [
      el('button', {
        class: 'btn ghost', type: 'button', text: '🗜 ZIP Paketinden İçe Aktar', disabled: !!libBusy,
        onclick: () => pickLibrary('zip'),
      }),
      el('button', {
        class: 'btn ghost', type: 'button', text: '📁 Klasörden İçe Aktar', disabled: !!libBusy,
        onclick: () => pickLibrary('folder'),
      }),
      el('button', {
        class: 'btn ghost', type: 'button', text: '🔎 Makinede Ara', disabled: !!libBusy,
        title: 'Bilinen kurulum klasörlerinde ve Masaüstü, İndirilenler, Belgeler, Müzik klasörlerinde MilkDrop kütüphanesi arar',
        onclick: () => discoverLibraries(),
      }),
    ]));
    nodes.push(P().row('Klasör Adları', selOf([
      [1, 'Etiket yap'],
      [0, 'Etiket yapma'],
    ], control(cfg).importFolderTags === false ? 0 : 1, (v) => { control(cfg).importFolderTags = Number(v) === 1; })));
    if (libBusy) nodes.push(el('div', { id: 'mdLibProgress', class: 'studio-note', text: libBusy }));
    if (libResult) nodes.push(el('div', { class: 'studio-note md-ok', text: libResult }));
    if (libFound) {
      if (!libFound.length) {
        nodes.push(el('div', {
          class: 'studio-note dim-hint',
          text: 'Bilinen kurulum klasörlerinde ve Masaüstü, İndirilenler, Belgeler, Müzik klasörlerinde MilkDrop kütüphanesi bulunamadı.',
        }));
      } else {
        const box = el('div', { class: 'md-libs' });
        for (const s of libFound) {
          /* Aramanın süresi yetmediyse sayılar alt sınır ("+"); hiç
             sayılamadıysa bu söyleniyor. İçe aktarmadan önce tamamı taranıyor. */
          const vars = { p: s.presets, t: s.textures, mb: mb(s.bytes) };
          const count = !s.searchCut ? fmt('{p} preset · {t} doku · {mb} MB', vars)
            : s.presets ? fmt('{p}+ preset · {t}+ doku · {mb}+ MB', vars) : tr('sayılmadı');
          box.appendChild(el('div', { class: 'md-lib' }, [
            el('span', { class: 'md-lib-name', text: s.label, title: s.where || '' }),
            el('span', { class: 'md-lib-count', text: count }),
            el('button', {
              class: 'btn ghost tiny', type: 'button', text: tr('İçe Aktar'), disabled: !!libBusy,
              onclick: () => confirmAndImport(s),
            }),
          ]));
        }
        nodes.push(P().row('Bulunan Kütüphaneler', box));
        if (libFound.some((s) => s.searchCut)) {
          nodes.push(el('div', {
            class: 'studio-note dim-hint',
            text: 'Aramanın süresi bazı kütüphaneleri saymaya yetmedi (+ ya da “sayılmadı”); içe aktarmadan önce tamamı taranır.',
          }));
        }
      }
      if (!libSearchDone) {
        nodes.push(el('div', {
          class: 'studio-note dim-hint',
          text: 'Arama süre sınırına ulaştı, bazı klasörlere bakılamadı. Kütüphaneniz listede yoksa 📁 Klasörden İçe Aktar ile seçin.',
        }));
      }
    }
    nodes.push(el('div', {
      class: 'studio-note dim-hint',
      text: 'ZIP paketi, bir klasör ya da makinede bulunan bir kütüphane: önce ne ekleneceği gösterilir, onaylamadan hiçbir şey kopyalanmaz. İç içe klasörler ve dokular dahil; aynı ad ve içerikteki presetler atlanır. Dokular uygulamanın kendi klasörüne gider ve seçtiğiniz doku klasöründen sonra aranır. Uygulamayla hiçbir preset paketi gelmez. .milk2 (MilkDrop 3 çift preseti) henüz desteklenmiyor.',
    }));

    // Arama
    if (presets.length > 6) {
      nodes.push(P().row('Ara', el('input', {
        class: 'p-in md-search', type: 'search', value: filter,
        placeholder: 'ad, yazar ya da #etiket',
        /* Filtre paneli baştan çiziyor, yani bu girdi düğümü siliniyor ve
           yerine yenisi geliyor. Odak da onunla birlikte gidiyordu: kullanıcı
           her harften sonra kutuya yeniden tıklamak zorunda kalıyordu.
           Yeni düğümü bulup odağı ve imleç yerini geri koyuyoruz. */
        oninput: (e) => {
          filter = e.target.value;
          const caret = e.target.selectionStart;
          P().rerender();
          // Yalnızca panellerin çizildiği kökte ara: belge geneli, ileride
          // ikinci bir örnek çizilirse yanlış kutuya odaklanırdı
          const root = document.getElementById('sections') || document;
          const again = root.querySelector('.md-search');
          if (!again) return;
          again.focus();
          try { again.setSelectionRange(caret, caret); } catch (_) { /* desteklemeyen tarayıcı */ }
        },
      })));
      /* SÜZGEÇ VE YAZAR (#576). Görünümün ayarı, sahnenin değil: seçmek
         yapılandırma göndermiyor, yalnız paneli yeniden çiziyor. Sayılar
         seçeneğin içinde, o yüzden metin burada çevriliyor. */
      const L = LB();
      if (L) {
        const lib = library(cfg);
        const viewSel = (pairs, value, onChange) => {
          const sel = el('select', { class: 'sel' });
          for (const [v, label] of pairs) {
            const o = el('option', { value: String(v), text: label });
            if (String(v) === String(value)) o.selected = true;
            sel.appendChild(o);
          }
          sel.addEventListener('change', () => { onChange(sel.value); listScroll = 0; P().rerender(); });
          return sel;
        };
        const tags = L.tagCounts(presets, lib);
        if (showSel.indexOf('tag:') === 0 && !tags.some((t) => 'tag:' + t.key === showSel)) showSel = 'all';
        const favN = presets.reduce((n, p) => n + (L.isFavorite(lib, p.id) ? 1 : 0), 0);
        nodes.push(P().row('Süz', viewSel([
          ['all', tr('Tümü') + ' (' + presets.length + ')'],
          ['fav', tr('★ Favoriler') + ' (' + favN + ')'],
        ].concat(tags.map((t) => ['tag:' + t.key, '#' + t.name + ' (' + t.count + ')'])),
        showSel, (v) => { showSel = String(v); })));
        const authors = L.authorCounts(presets);
        if (authorSel && !authors.some((a) => a.key === authorSel)) authorSel = '';
        if (authors.length > 1) {
          nodes.push(P().row('Yazar', viewSel([['', tr('Tüm yazarlar')]]
            .concat(authors.map((a) => [a.key, a.name + ' (' + a.count + ')'])),
          authorSel, (v) => { authorSel = String(v); })));
        }
      }
    }

    /* DÜZEN (#575): liste ya da küçük resimli ızgara. Seçmek yapılandırma
       göndermiyor, yalnız paneli yeniden çiziyor. */
    const viewSel = el('select', { class: 'sel' });
    for (const [v, label] of [['list', 'Liste'], ['grid', 'Izgara']]) {
      const o = el('option', { value: v, text: tr(label) });
      if (v === viewMode) o.selected = true;
      viewSel.appendChild(o);
    }
    viewSel.addEventListener('change', () => { setView(viewSel.value); listScroll = 0; P().rerender(); });
    nodes.push(P().row('Düzen', viewSel));
    const grid = viewMode === 'grid';

    // Liste ya da ızgara
    const list = el('div', {
      class: grid ? 'md-grid' : 'md-list',
      onscroll: (e) => { listScroll = e.target.scrollTop; },
    });
    /* Arama ve süzgeç satırları az presette gizli; görünmeyen bir süzgeç
       listeyi sessizce daraltmasın (silme sonrası 6'ya inince de). */
    if (presets.length <= 6) { filter = ''; showSel = 'all'; authorSel = ''; }
    const vis = visible(cfg);
    const LBn = LB();
    const libNow = library(cfg);
    const keepScroll = () => {
      const box = document.querySelector(grid ? '.md-grid' : '.md-list');
      if (box) listScroll = box.scrollTop;
    };
    const removePreset = async (p) => {
      if (!(await P().confirm('"' + (p.name || p.id) + '" silinsin mi?'))) return;
      if (window.api.deletePreset) await window.api.deletePreset(p.id);
      adoptDelta({ remove: [p.id] });
      if (md.presetId === p.id) load(cfg, null);
      // Puanı, favorisi ve etiketleri de gidiyor (#576): kimlik bir daha gelmiyor
      if (LBn) Object.assign(library(cfg), LBn.forget(library(cfg), p.id));
      refresh(() => rerender());
    };
    if (grid) {
      // Doku klasörü ya da içe aktarılan dokular değiştiyse bütün anahtarlar eski
      const tsig = (md.textureDir || '') + '#' + (+libNow.textureRev || 0);
      if (thumbTexSig !== null && thumbTexSig !== tsig) thumbKeys.clear();
      thumbTexSig = tsig;
      listenThumbs();
    }
    if (!vis.length) {
      list.appendChild(el('div', {
        class: 'studio-note',
        /* Liste artık hiç boş kalmıyor — yerleşikler her zaman orada; bu
           dal yalnız yerleşik modülü yüklenemediyse görünür. */
        text: presets.length
          ? 'Aramaya uyan preset yok.'
          : 'Preset listesi yüklenemedi. Bir MilkDrop paketindeki .milk dosyalarını ekleyebilirsiniz; hepsi bir kerede seçilebilir.',
      }));
    }
    vis.slice(0, 400).forEach((p) => {
      const active = md.presetId === p.id;
      // Favori ve etiketler (#576): yıldız tek tıkla, etiketler adın yanında
      const fav = !!(LBn && LBn.isFavorite(libNow, p.id));
      const favBtn = LBn ? el('button', {
        class: 'md-fav' + (fav ? ' on' : ''), type: 'button', text: fav ? '★' : '☆',
        title: fav ? 'Favorilerden çıkar' : 'Favorilere ekle',
        'aria-pressed': fav ? 'true' : 'false',
        onclick: () => { keepScroll(); setFavorite(p.id, !fav); },
      }) : null;
      if (grid) {
        /* Hücre: küçük resim, ad, yıldız ve (kullanıcı presetinde) silme.
           Dosyası gitmiş bir anahtarın görseli yüklenemezse yeniden isteniyor. */
        const key = thumbKeys.get(p.id);
        const img = el('img', {
          alt: '', draggable: 'false',
          onerror: () => {
            if (!thumbKeys.get(p.id)) return;
            thumbKeys.delete(p.id);
            paintThumb(thumbBox(p.id), undefined);
            wantThumb(p.id);
          },
        });
        if (key) img.setAttribute('src', thumbUrl(key));
        const box = el('div', { class: 'md-thumb-box', 'data-id': p.id }, [img]);
        paintThumb(box, key);
        list.appendChild(el('div', { class: 'md-cell' + (active ? ' active' : '') }, [
          el('button', {
            class: 'md-cell-main', type: 'button', title: tr(p.name || p.id),
            onclick: () => { keepScroll(); load(cfg, p); rerender(); },
          }, [box, el('span', { class: 'md-cell-name', text: tr(p.name || p.id) })]),
          favBtn,
          p.builtin ? null : el('button', {
            class: 'btn ghost tiny danger md-cell-del', type: 'button', text: '✕', title: 'Sil',
            onclick: () => removePreset(p),
          }),
        ]));
        return;
      }
      const tags = LBn ? LBn.tagsOf(libNow, p.id) : [];
      list.appendChild(el('div', { class: 'md-item' + (active ? ' active' : '') }, [
        favBtn,
        el('button', {
          class: 'md-name', type: 'button', text: tr(p.name || p.id),
          onclick: () => { keepScroll(); load(cfg, p); rerender(); },
        }),
        tags.length ? el('span', { class: 'md-tagline', text: tags.map((t) => '#' + t).join(' ') }) : null,
        /* Yerleşiğin silme düğmesi YOK: dosyası olmadığı için `deletePreset`
           onu bulamaz, satır da bir sonraki tazelemede geri gelirdi —
           kullanıcıya çalışmayan bir düğme göstermiş olurduk. */
        p.builtin
          ? el('span', { class: 'md-builtin', text: 'yerleşik', title: 'CAYADEV presetleri' })
          : el('button', {
            class: 'btn ghost tiny danger', type: 'button', text: '✕', title: 'Sil',
            onclick: () => removePreset(p),
          }),
      ]));
    });
    nodes.push(list);
    if (listScroll > 0) {
      setTimeout(() => {
        list.scrollTop = listScroll;
        const active = list.querySelector(grid ? '.md-cell.active' : '.md-item.active');
        if (active) active.scrollIntoView({ block: 'nearest' });
      }, 0);
    }
    if (grid) {
      setTimeout(() => watchThumbs(list), 0);
      nodes.push(el('div', {
        class: 'studio-note dim-hint',
        text: 'Küçük resim, presetin ilk iki saniyesi: örnek sesle, siyah bir ekrandan başlanarak çiziliyor. Her preset bir kez çiziliyor ve saklanıyor; preset değişince yeniden çiziliyor.',
      }));
    }
    if (vis.length > 400) {
      nodes.push(el('div', { class: 'studio-note dim-hint', text: vis.length + ' presetten ilk 400 gösteriliyor; aramayı daraltın.' }));
    }

    // Gezinme ve otomatik geçiş
    if (presets.length > 1) {
      // Düğmeler ve denetleyici eylemleri aynı yoldan (bkz. `act`)
      const back = () => navBack(cfg, md);
      const forward = () => navForward(cfg, md);
      /* KİLİT (#568). MilkDrop'taki gibi yalnız otomatik geçişi ve sert
         geçişi durduruyor; elle seçim çalışıyor. Kilit açılınca kalan süre
         kaldığı yerden sayıyor (shared/milkdrop-cycle.js). */
      const locked = control(cfg).locked === true;
      nodes.push(el('div', { class: 'row' }, [
        el('button', { class: 'btn ghost', type: 'button', text: '◀ Önceki', onclick: back }),
        el('button', { class: 'btn ghost', type: 'button', text: 'Sonraki ▶', onclick: forward }),
        el('button', {
          class: 'btn ghost', type: 'button', text: '🎲 Rastgele',
          onclick: () => go(cfg, randomPick(cfg, md)),
        }),
        el('button', {
          id: 'mdLock', class: 'btn ghost' + (locked ? ' md-locked' : ''), type: 'button',
          text: locked ? '🔒 Kilitli' : '🔓 Kilitle',
          title: 'Otomatik geçişi ve sert geçişi durdurur; elle seçim çalışır',
          'aria-pressed': locked ? 'true' : 'false',
          onclick: () => { control(cfg).locked = !locked; rerender(); },
        }),
      ]));
      /* ARALIK BİRİMİ (#571). Ölçüde aralık müziğin kendi ızgarası: geçiş
         ölçünün ilk vuruşunda başlıyor. Etiketler Otomatik VJ'ninkilerle
         aynı, çünkü aynı şeyi söylüyorlar. */
      const bars = md.autoNextUnit === 'bars';
      nodes.push(P().row('Aralık Birimi', selOf([
        ['seconds', 'Saniye'],
        ['bars', 'Ölçü'],
      ], bars ? 'bars' : 'seconds', (v) => { md.autoNextUnit = String(v); })));
      if (bars) {
        nodes.push(SP().miniSlider('Otomatik Geçiş', () => (md.autoNextBars == null ? 8 : md.autoNextBars), (v) => { md.autoNextBars = Math.round(v); }, {
          min: 0, max: 64, step: 1, fmt: (v) => (v > 0 ? Math.round(v) + ' ' + tt('ölçü') : tt('kapalı')),
        }));
        /* Durum görselleştiriciden geliyor (admin.js → `noteLive`): panelin
           kendi tempo kestirimi başka bir sese bakıyor ve başka bir BPM
           söylerdi. */
        const bs = el('div', { id: 'mdBarStatus', class: 'studio-note' });
        fillBarStatus(bs, lastBars);
        nodes.push(bs);
      } else {
        nodes.push(SP().miniSlider('Otomatik Geçiş', () => md.autoNext || 0, (v) => { md.autoNext = Math.round(v); }, {
          min: 0, max: 120, step: 1, fmt: (v) => (v > 0 ? Math.round(v) + ' ' + tt('sn') : tt('kapalı')),
        }));
      }
      /* RASTGELE PAY. Sonraki geçiş aralığa 0..pay arası bir süre ekliyor;
         pay preset başına bir kez çekiliyor. MilkDrop'un varsayılanı 16 sn
         aralığa 10 sn pay. Aralık kapalıyken ve ölçü kipinde — aralığı
         müzik veriyor — anlamı yok, gösterilmiyor. */
      if (!bars && (md.autoNext || 0) > 0) {
        nodes.push(SP().miniSlider('Rastgele Pay', () => md.autoNextRand || 0, (v) => { md.autoNextRand = Math.round(v); }, {
          min: 0, max: 30, step: 1, fmt: (v) => (v > 0 ? '+0–' + Math.round(v) + ' ' + tt('sn') : tt('yok')),
        }));
      }
      /* PARÇA DEĞİŞİNCE (#582). Şimdi Çalıyor yeni bir parça gördüğünde
         sıradaki preset, aşağıdaki Geçiş Sırası'na göre. Zamanlayıcıdan
         bağımsız; kilit bunu da durduruyor. */
      nodes.push(P().row('Parça Değişince', selOf([
        [0, 'Bir şey yapma'],
        [1, 'Sıradaki presete geç'],
      ], md.trackAdvance === true ? 1 : 0, (v) => { md.trackAdvance = Number(v) === 1; })));
      nodes.push(P().row('Geçiş Sırası', selOf([
        ['sequential', 'Sırayla'],
        ['random', 'Rastgele'],
      ], md.autoOrder === 'random' ? 'random' : 'sequential', (v) => { md.autoOrder = String(v); })));
      /* PUANA GÖRE SEÇİM (#569). MilkDrop'ta varsayılan açık; kapalıyken
         rastgele sıra eşit olasılıklı. Yalnız rastgele sırada anlamlı. */
      if (md.autoOrder === 'random') {
        nodes.push(P().row('Puana Göre', selOf([
          [1, 'Açık (MilkDrop gibi)'],
          [0, 'Kapalı (eşit olasılık)'],
        ], md.useRatings === false ? 0 : 1, (v) => { md.useRatings = Number(v) === 1; })));
      }
      /* HAVUZ (#576). Otomatik geçiş — zamanlayıcı, sert geçiş, parça
         değişimi — yalnız favorilerden ya da bir etiketten seçebiliyor.
         Seçim sahneyle kaydediliyor (`milkdrop.autoFrom`/`autoTag`). Elle
         ◀/▶/🎲 ve listeden seçim bütün presetlere gidiyor. */
      const LP = LB();
      if (LP) {
        const lib = library(cfg);
        const tags = LP.tagCounts(presets, lib);
        const favN = presets.reduce((n, p) => n + (LP.isFavorite(lib, p.id) ? 1 : 0), 0);
        const cur = LP.poolOf(md);
        /* Seçilen etiket en sık yazılışıyla eşleşiyor; hiçbir presette
           kalmadıysa seçim yine görünüyor (0 ile), sessizce "hepsi"ne dönmüyor. */
        const hit = cur.from === 'tag' ? tags.find((t) => t.key === LP.fold(cur.tag)) : null;
        const value = cur.from === 'tag' ? 'tag:' + (hit ? hit.name : cur.tag) : cur.from;
        const pairs = [
          ['all', tr('Tüm presetler')],
          ['favorites', tr('★ Favoriler') + ' (' + favN + ')'],
        ].concat(tags.map((t) => ['tag:' + t.name, '#' + t.name + ' (' + t.count + ')']));
        if (cur.from === 'tag' && !hit) pairs.push([value, '#' + cur.tag + ' (0)']);
        nodes.push(P().row('Havuz', selOf(pairs, value, (v) => {
          const s = String(v);
          if (s.indexOf('tag:') === 0) { md.autoFrom = 'tag'; md.autoTag = s.slice(4); } else { md.autoFrom = s === 'favorites' ? 'favorites' : 'all'; md.autoTag = ''; }
        })));
        const n = cur.from === 'all' ? presets.length : LP.pool(presets, md, lib).length;
        if (cur.from !== 'all') {
          nodes.push(el('div', {
            class: 'studio-note dim-hint',
            text: 'Havuz yalnız otomatik geçişi sınırlar: zamanlayıcı, sert geçiş ve parça değişimi yalnız bunlardan seçer. ◀ Önceki, Sonraki ▶, Rastgele ve listeden seçim bütün presetlere gider.',
          }));
        }
        if (cur.from !== 'all' && n < 2) {
          nodes.push(el('div', {
            class: 'studio-note',
            text: n ? 'Havuzda tek preset var; otomatik geçiş bekliyor. Favori ekleyin ya da etiketleyin.'
              : 'Havuzda preset yok; otomatik geçiş bekliyor. Favori ekleyin ya da etiketleyin.',
          }));
        }
      }
      /* SERT GEÇİŞ (#568). Sesin ani yükselişinde karışmadan yeni preset.
         MilkDrop 2'nin kuralı ve varsayılanları; orada da KAPALI başlıyor. */
      nodes.push(P().row('Sert Geçiş', selOf([
        ['off', 'Kapalı'],
        ['md2', 'MilkDrop 2 (ses yükselişi)'],
      ], md.hardCut === 'md2' ? 'md2' : 'off', (v) => { md.hardCut = String(v); })));
      if (md.hardCut === 'md2') {
        nodes.push(SP().miniSlider('Sert Geçiş Eşiği',
          () => (md.hardCutThreshold == null ? 2.5 : md.hardCutThreshold),
          (v) => { md.hardCutThreshold = Math.round(v * 10) / 10; },
          { min: 1, max: 6, step: 0.1, fmt: (v) => (+v).toFixed(1) }));
        nodes.push(SP().miniSlider('Eşik Toparlanması',
          () => (md.hardCutHalfLife == null ? 60 : md.hardCutHalfLife),
          (v) => { md.hardCutHalfLife = Math.round(v); },
          { min: 5, max: 240, step: 5, fmt: (v) => Math.round(v) + ' ' + tt('sn') }));
        nodes.push(el('div', {
          class: 'studio-note dim-hint',
          text: 'Bas, orta ve tiz, her biri kendi uzun ortalamasına göre, birlikte eşiğin üç katını aşınca karışmadan yeni presete geçilir. Eşik her kesimde iki katına çıkar ve sonra tabanına döner: arka arkaya patlamalar arka arkaya kesim yapmaz. Kural ve varsayılanlar MilkDrop 2\'nin (2,5 ve 60 sn); oradaki gibi, toparlanma süresi sonunda eşiğin fazlası dörtte bire iner.',
        }));
      }
      /* EKRANLAR (#585). Varsayılan: seçimi ilk görselleştirici penceresi
         yapıyor, diğer pencereler, Spout/Syphon ve web çıkışı onu izliyor.
         Sahnenin değil kurulumun ayarı: `milkdropControl`da, sahne değişince
         kendiliğinden açılıp kapanmasın. */
      nodes.push(P().row('Ekranlar', selOf([
        [0, 'Hepsinde aynı preset'],
        [1, 'Her ekran kendi seçer'],
      ], control(cfg).independent === true ? 1 : 0, (v) => { control(cfg).independent = Number(v) === 1; })));
      nodes.push(el('div', {
        class: 'studio-note dim-hint',
        text: 'Hepsinde aynı presette seçimi ilk görselleştirici penceresi yapar — yoksa Spout/Syphon penceresi, o da yoksa bu önizleme — ve diğer pencereler, Spout/Syphon ve web çıkışı aynı preseti aynı geçişle gösterir. Her ekran kendi seçerse otomatik geçiş ve sert geçiş her ekranda ayrı çalışır; rastgele sırada her ekran başka bir preset gösterir. Önizleme her iki durumda da ilk pencereyi izler.',
      }));
      nodes.push(el('div', {
        class: 'studio-note dim-hint',
        text: 'Otomatik geçiş görselleştiricinin kendi saatiyle çalışır: panel kapalıyken ya da görselleştirici paneli örterken de durmaz. Geçilen preset ayarlara yazılmaz; Yüklü Preset satırı o an ekranda olanı gösterir. Rastgele sırada o an çizilen preset hiç seçilmez. Her geçişin süresi yukarıdaki Preset Geçişi ayarından gelir.',
      }));
      nodes.push(el('div', {
        class: 'studio-note dim-hint',
        text: 'Zamanlama MilkDrop 2\'ninki: aralık, geçiş bittikten sonra sayılmaya başlar ve rastgele pay her presette bir kez çekilir. Kilit otomatik geçişi ve sert geçişi durdurur; açılınca kalan süre kaldığı yerden sayar.',
      }));
      if (bars) {
        nodes.push(el('div', {
          class: 'studio-note dim-hint',
          text: 'Ölçü kipinde tempo görselleştiricinin kendi sesinden kestirilir; BPM kilidi ve tap tempo Tempo ve Otomatik VJ bölümündeki ayardır. Geçiş ölçünün ilk vuruşunda başlar ve süresi en yakın tam vuruşa yuvarlanır, yani bir vuruşun üstünde biter. Tempo bulunamazsa ölçü sayısının iki katı saniyede, en az 4 saniyede bir geçilir.',
        }));
      }
      nodes.push(el('div', {
        class: 'studio-note dim-hint',
        text: 'Yıldızlar yalnız sizin verdiğiniz puanı gösterir; puan vermediğiniz preset boş görünür ve rastgele sırada kendi dosyasındaki fRating değeriyle (yoksa 3) seçilir. Rastgele sırada presetler puanlarıyla orantılı olasılıkla gelir ve 0 puanlı preset hiç gelmez — MilkDrop 2\'nin kuralı. Verdiğiniz puan ayarlara yazılır, preset dosyasına dokunulmaz. ◀ Önceki ve Sonraki ▶ ekranda gösterilenlerin geçmişinde gezer; otomatik geçişin seçtikleri de o geçmişte.',
      }));
    }

    nodes.push(el('div', {
      class: 'studio-note dim-hint',
      text: 'Denklem blokları (per_frame, per_pixel) ve MilkDrop 2 presetlerinin HLSL warp/composite shaderları gerçekten çalıştırılır: 10.332 presetlik bir korpustaki 16.346 shader aşamasının hepsi derleniyor. Şekiller, dalgalar, blur zinciri ve hareket vektörleri çizilir; preset dosyalarıyla gelmeyen kullanıcı dokuları, doku paketi seçilmediyse gürültüyle ikame edilir.',
    }));

    return el('div', { class: 'md-panel' }, nodes);
  }

  /* Sprite listesi de açılışta: denetleyici eşlemesinin hedef listesi
     (control.js) MilkDrop paneli hiç açılmadan da sprite'ları görsün. */
  function init() {
    refresh();
    const cfg = P() && P().cfg && P().cfg();
    const f = cfg && cfg.milkdropControl && cfg.milkdropControl.spriteFile;
    if (typeof f === 'string' && f) loadSprites(f);
  }

  /* load ve pointStackAtMilkdrop testler icin de disa aciliyor: preset
     secmenin sahneyi GERCEKTEN degistirdigi, panelin arayuzunu kurmadan
     sinanabilsin. */
  /* Karışım (#579) parçalarını buradan çekiyor: listede GÖRÜNENLER, yani
     arama ve süzgeç orada da geçerli. Kaydedilmemiş bir önizleme listede
     olmadığı için hiçbir zaman parça vermiyor. `presetById` bütün listede
     arıyor: geçmişteki bir karışım süzgeç değişse de geri getirilebilsin. */
  const visibleList = () => visible(P().cfg());
  window.SVMilkdropPanel = {
    panel, init, refresh, load, pointStackAtMilkdrop, noteLive, liveId, history, act, fillStars,
    spriteTargets, preview, adopt, visibleList, presetById: byId,
  };
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = window.SVMilkdropPanel;
  }
})();
