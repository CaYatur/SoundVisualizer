'use strict';
/* Görselleştirici ve arkaplan modlarının TEK listesi (#638).
 *
 * NEDEN
 * Mod listesi yedi ayrı yerde elle tutuluyordu: panelin tür seçicisi, katman
 * türü listesi, Otomatik VJ, kısayol döngüsü, telefon kumandası, sahne
 * üreticisi ve sahne özeti. Yeni bir mod eklendiğinde bunların çoğu
 * güncellenmemişti; kısayol döngüsü ve telefon kumandası on beşten fazla
 * modu hiç göstermiyordu, sahne özeti yeni modları kimlikleriyle yazıyordu.
 * Artık hepsi bu listeden türetiliyor; yeni bir mod burada bir satırdır.
 *
 * ALANLAR
 *   id     motorun kayıt adı (window.SVModes / window.SVBackgrounds)
 *   label  arayüz adı (Türkçe; İngilizcesi i18n.js'te)
 *   group  panel seçicisindeki başlık
 *   bands  frekans bandı okuyor: bar sayısı ve frekans aralığı anlamlı
 *   gap    bar benzeri geometri: aralık anlamlı
 *   wave   dalga çiziyor: çizgi kalınlığı ve genlik anlamlı
 *   thick  genlik / dolgu ayarı anlamlı
 *   color2 ikincil renk kullanıyor
 *   cycle  false ise otomatik dolaşıma (Otomatik VJ, kısayol, sahne üretici)
 *          girmez: ekranı boşaltan, görselleştirici olmayan ya da ayrıca
 *          seçilmesi gereken bir kaynağa bağlı modlar
 *   engine kendi ayar kartı olan motor (MilkDrop, 3B geometri, geri besleme);
 *          sahne üreticisi bunları rastgele seçmiyor
 *   layer  false ise katman türü listesinde yok ('none')
 *   settings  arkaplanın kendi ayarları: [anahtar, etiket, min, maks, adım,
 *          yüzde mi]. Değer background.<id>.<anahtar> yolunda; varsayılanı
 *          defaults.js'te, motorun mset() yedeğiyle aynı (testle korunuyor)
 */
(function () {
  const V = (id, label, group, f) => Object.assign({ id, label, group }, f || {});

  const VISUALIZERS = [
    V('none', 'Kapalı', 'Temel', { cycle: false, layer: false }),
    V('bars', 'Barlar', 'Temel', { bands: true, gap: true }),
    V('centerBars', 'Merkez', 'Temel', { bands: true, gap: true }),
    V('blocks', 'Segment', 'Temel', { bands: true, gap: true }),
    V('dots', 'Nokta Matris', 'Temel', { bands: true, gap: true }),
    V('skyline', 'Şehir Silüeti', 'Temel', { bands: true, gap: true }),

    V('wave', 'Dalga', 'Dalga Formu', { wave: true, thick: true, color2: true }),
    V('ribbon', 'Şerit', 'Dalga Formu', { wave: true, thick: true, color2: true }),
    V('wave3d', '3B Dalga', 'Dalga Formu', { wave: true, thick: true, color2: true }),
    V('lissajous', 'Lissajous', 'Dalga Formu', { wave: true, thick: true }),
    V('strings', 'Teller', 'Dalga Formu', { bands: true, gap: true, wave: true, thick: true }),
    V('terrain', 'Arazi', 'Dalga Formu', { bands: true, wave: true, color2: true }),

    V('circular', 'Çember', 'Dairesel', { bands: true, gap: true }),
    V('radialWave', 'Dairesel Dalga', 'Dairesel', { wave: true, thick: true, color2: true }),
    V('starburst', 'Işın', 'Dairesel', { bands: true, gap: true }),
    V('arcs', 'Yaylar', 'Dairesel', { bands: true, gap: true }),
    V('pinwheel', 'Fırıldak', 'Dairesel', { bands: true }),
    V('mandala', 'Mandala', 'Dairesel', { bands: true, wave: true, color2: true }),
    V('kaleido', 'Kaleydoskop', 'Dairesel', { bands: true, gap: true }),
    V('vortex', 'Girdap', 'Dairesel', { bands: true, wave: true }),
    V('helix', 'Helis', 'Dairesel', { bands: true, wave: true, thick: true, color2: true }),
    V('tunnel', 'Tünel', 'Dairesel', { bands: true, color2: true }),
    V('orb', 'Küre', 'Dairesel', { bands: true, wave: true, color2: true }),

    V('particles', 'Parçacık', 'Parçacık ve Olay'),
    V('fireworks', 'Havai Fişek', 'Parçacık ve Olay', { wave: true }),
    V('lightning', 'Şimşek', 'Parçacık ve Olay', { wave: true }),
    V('bubbles', 'Baloncuk', 'Parçacık ve Olay', { wave: true, thick: true }),
    V('metaball', 'Sıvı Damla', 'Parçacık ve Olay', { bands: true, gap: true, thick: true }),
    V('ripplegrid', 'Dalgalı Izgara', 'Parçacık ve Olay', { gap: true, thick: true }),
    V('spectrogram', 'Spektrogram', 'Parçacık ve Olay', { bands: true }),

    V('flowfield', 'Akış Alanı', 'Üretken Sistemler'),
    V('flock', 'Sürü', 'Üretken Sistemler'),
    V('voronoi', 'Voronoi', 'Üretken Sistemler'),
    V('truchet', 'Truchet', 'Üretken Sistemler'),
    V('moire', 'Moiré', 'Üretken Sistemler'),
    V('interference', 'Dalga Girişimi', 'Üretken Sistemler'),
    V('ropes', 'İpler', 'Üretken Sistemler'),
    V('galaxy', 'Galaksi', 'Üretken Sistemler'),
    V('dna', 'DNA Sarmalı', 'Üretken Sistemler'),
    V('isocity', 'İzometrik Şehir', 'Üretken Sistemler'),
    V('attractorfield', 'Çekici Alanı', 'Üretken Sistemler'),

    V('text', 'Metin / Şarkı Sözü', 'Metin', { cycle: false }),
    V('nowplaying', 'Çalan Parça', 'Metin', { cycle: false }),

    V('scope', 'Osiloskop (XY)', 'Ölçüm'),
    V('goniometer', 'Gonyometre', 'Ölçüm'),
    V('chromawheel', 'Kroma Çemberi', 'Ölçüm'),

    V('geometry', '◈ 3B Geometri', 'Gelişmiş Motorlar', { engine: true }),
    V('milkdrop', '🥛 MilkDrop', 'Gelişmiş Motorlar', { engine: true }),
    V('feedback', '♾ Geri Besleme', 'Gelişmiş Motorlar', { engine: true }),
    V('custom', '🧪 Studio', 'Gelişmiş Motorlar', { cycle: false, engine: true }),
  ];

  /* 'gradient', 'solid' ve 'custom' SVBackgrounds'ta değil: gradyan kendi
     motoru (SVModes.gradient), düz renk çizim gerektirmiyor, Studio bir
     preset seçer. */
  const BACKGROUNDS = [
    V('gradient', 'Akışkan Gradyan', 'Akışkan'),
    V('ink', 'Mürekkep', 'Akışkan', { settings: [
      ['blobs', 'Damla Sayısı', 1, 12, 1],
      ['viscosity', 'Akışkanlık', 0.2, 3, 0.05],
      ['swirl', 'Burulma', 0, 3, 0.05],
      ['spread', 'Yayılma', 0.3, 2.5, 0.05],
      ['opacity', 'Saydamlık', 0.2, 1.5, 0.02],
      ['bassPush', 'Bas İtkisi', 0, 4, 0.05],
    ] }),
    V('nebula', 'Bulutsu', 'Akışkan', { settings: [
      ['clouds', 'Bulut Sayısı', 2, 14, 1],
      ['size', 'Bulut Boyutu', 0.3, 2.5, 0.05],
      ['softness', 'Kenar Yumuşaklığı', 0.3, 2.5, 0.05],
      ['drift', 'Sürüklenme', 0, 3, 0.05],
      ['density', 'Yoğunluk', 0.1, 1, 0.02, true],
      ['bassPush', 'Bas İtkisi', 0, 4, 0.05],
    ] }),
    V('waves', 'Dalga Katmanları', 'Akışkan', { settings: [
      ['layers', 'Katman Sayısı', 1, 14, 1],
      ['amplitude', 'Tepe Yüksekliği', 0.2, 3, 0.05],
      ['frequency', 'Dalga Sıklığı', 0.2, 3, 0.05],
      ['spread', 'Katman Aralığı', 0.3, 2, 0.05],
      ['opacity', 'Saydamlık', 0.2, 1.5, 0.02],
      ['bassPush', 'Bas İtkisi', 0, 4, 0.05],
    ] }),
    V('aurora', 'Kutup Işıkları', 'Akışkan', { settings: [
      ['bands', 'Perde Sayısı', 1, 12, 1],
      ['amplitude', 'Dalgalanma', 0.2, 3, 0.05],
      ['thickness', 'Perde Kalınlığı', 0.2, 3, 0.05],
      ['softness', 'Kenar Yumuşaklığı', 0.4, 3, 0.05],
      ['height', 'Dikey Konum', 0.1, 0.9, 0.01, true],
      ['bassPush', 'Bas İtkisi', 0, 4, 0.05],
    ] }),

    V('grid', 'Retro Izgara', 'Geometrik', { settings: [
      ['horizon', 'Ufuk Yüksekliği', 0.15, 0.85, 0.01, true],
      ['rows', 'Yatay Çizgi Sayısı', 4, 60, 1],
      ['cols', 'Dikey Çizgi Sayısı', 4, 80, 1],
      ['lineWidth', 'Çizgi Kalınlığı', 0.2, 4, 0.05],
      ['horizonGlow', 'Ufuk Parlaması', 0, 2, 0.02],
      ['skyIntensity', 'Gökyüzü Yoğunluğu', 0, 1.5, 0.02],
      ['spectrumBars', 'Spektrum Tepkisi', 0, 3, 0.05],
      ['bassPush', 'Bas İtkisi', 0, 6, 0.1],
    ] }),
    V('hexgrid', 'Petek Izgara', 'Geometrik', { settings: [
      ['size', 'Hücre Boyutu', 0.4, 3, 0.05],
      ['gap', 'Hücre Aralığı', 0, 0.5, 0.01, true],
      ['spectrum', 'Spektrum Tepkisi', 0, 3, 0.05],
      ['wave', 'Merkez Dalgası', 0, 2, 0.05],
      ['speed', 'Hız', 0.1, 3, 0.05],
      ['bassPush', 'Bas İtkisi', 0, 4, 0.05],
    ] }),
    V('mosaic', 'Mozaik', 'Geometrik', { settings: [
      ['cells', 'Hücre Sayısı', 6, 60, 1],
      ['jitter', 'Düzensizlik', 0, 1, 0.02, true],
      ['borders', 'Kenar Kalınlığı', 0, 1, 0.02, true],
      ['response', 'Spektrum Tepkisi', 0, 3, 0.05],
      ['speed', 'Hız', 0.1, 3, 0.05],
      ['bassPush', 'Bas İtkisi', 0, 4, 0.05],
    ] }),
    V('corridor', 'Koridor', 'Geometrik', { settings: [
      ['rings', 'Halka Sayısı', 6, 60, 1],
      ['speed', 'İlerleme Hızı', 0.1, 4, 0.05],
      ['sides', 'Kenar Sayısı (0 = daire)', 0, 12, 1],
      ['twist', 'Burulma', 0, 2, 0.05],
      ['lineWidth', 'Çizgi Kalınlığı', 0.2, 4, 0.05],
      ['bassPush', 'Bas İtkisi', 0, 4, 0.05],
    ] }),
    V('spiral', 'Sarmal', 'Geometrik', { settings: [
      ['arms', 'Kol Sayısı', 1, 12, 1],
      ['turns', 'Tur Sayısı', 1, 10, 0.1],
      ['thickness', 'Kalınlık', 0.2, 3, 0.05],
      ['speed', 'Hız', 0.1, 3, 0.05],
      ['taper', 'İncelme', 0, 1, 0.02, true],
      ['bassPush', 'Bas İtkisi', 0, 4, 0.05],
    ] }),
    V('rings', 'Nabız Halkaları', 'Geometrik', { settings: [
      ['rate', 'Halka Sıklığı', 0.2, 10, 0.1],
      ['speed', 'Genişleme Hızı', 0.2, 4, 0.05],
      ['thickness', 'Kalınlık', 0.2, 4, 0.05],
      ['beatSpawn', 'Darbede Halka', 0, 3, 0.05],
      ['fade', 'Sönme', 0.2, 3, 0.05],
    ] }),
    V('network', 'Ağ', 'Geometrik', { settings: [
      ['nodes', 'Düğüm Sayısı', 8, 220, 2],
      ['linkDist', 'Bağlantı Mesafesi', 0.04, 0.5, 0.01],
      ['nodeSize', 'Düğüm Boyutu', 0.2, 4, 0.05],
      ['lineWidth', 'Çizgi Kalınlığı', 0.2, 4, 0.05],
      ['speed', 'Hareket Hızı', 0.1, 4, 0.05],
      ['bassPush', 'Bas İtkisi', 0, 4, 0.05],
    ] }),

    V('starfield', 'Yıldız Alanı', 'Atmosfer', { settings: [
      ['count', 'Yıldız Sayısı', 40, 1200, 10],
      ['size', 'Yıldız Boyutu', 0.3, 3, 0.05],
      ['trail', 'Hız İzi', 0, 3, 0.05],
      ['depth', 'Derinlik', 0.4, 2.5, 0.05],
      ['twinkle', 'Parıldama', 0, 1, 0.02, true],
      ['bassPush', 'Bas İtkisi', 0, 6, 0.1],
    ] }),
    V('snow', 'Kar / Kor', 'Atmosfer', { settings: [
      ['count', 'Parçacık Sayısı', 20, 900, 10],
      ['size', 'Boyut', 0.3, 3, 0.05],
      ['fall', 'Düşme Hızı', 0, 3, 0.05],
      ['sway', 'Salınım', 0, 3, 0.05],
      ['depth', 'Derinlik', 0.4, 2.5, 0.05],
      ['bassPush', 'Bas İtkisi', 0, 4, 0.05],
    ] }),
    V('bokeh', 'Işık Parçacıkları', 'Atmosfer', { settings: [
      ['count', 'Işık Sayısı', 4, 160, 1],
      ['size', 'Boyut', 0.2, 3, 0.05],
      ['sizeVar', 'Boyut Çeşitliliği', 0, 2, 0.05],
      ['drift', 'Süzülme', 0, 3, 0.05],
      ['pulse', 'Bas Nabzı', 0, 2, 0.02],
      ['opacity', 'Saydamlık', 0.2, 2, 0.02],
    ] }),
    V('rain', 'Dijital Yağmur', 'Atmosfer', { settings: [
      ['columns', 'Sütun Sayısı', 10, 240, 2],
      ['speed', 'Düşme Hızı', 0.2, 4, 0.05],
      ['trail', 'İz Uzunluğu', 0.1, 3, 0.05],
      ['density', 'Yoğunluk', 0.1, 1, 0.02, true],
      ['thickness', 'Kalınlık', 0.2, 3, 0.05],
      ['bassPush', 'Bas İtkisi', 0, 4, 0.05],
    ] }),
    V('city', 'Şehir', 'Atmosfer', { settings: [
      ['buildings', 'Bina Sayısı', 8, 80, 1],
      ['height', 'Bina Yüksekliği', 0.3, 2, 0.05],
      ['windows', 'Pencere Yoğunluğu', 0, 2, 0.05],
      ['skyGlow', 'Gökyüzü Parlaması', 0, 2, 0.02],
      ['parallax', 'Katman Kayması', 0, 3, 0.05],
      ['bassPush', 'Bas İtkisi', 0, 4, 0.05],
    ] }),

    V('liquid', 'Sıvı Metal', 'Üretken Zeminler', { settings: [
      ['bands', 'Bant Sayısı', 2, 16, 1],
      ['warp', 'Bükülme', 0.3, 3, 0.05],
      ['sharp', 'Keskinlik', 0, 1, 0.02, true],
    ] }),
    V('plasma', 'Plazma', 'Üretken Zeminler', { settings: [
      ['scale', 'Desen Ölçeği', 0.3, 3, 0.05],
      ['swirl', 'Girdap', 0, 3, 0.05],
    ] }),
    V('caustics', 'Su Yüzeyi', 'Üretken Zeminler', { settings: [
      ['scale', 'Desen Ölçeği', 0.3, 3, 0.05],
      ['sharp', 'Keskinlik', 0, 2, 0.05],
    ] }),
    V('ribbons', 'Şeritler', 'Üretken Zeminler', { settings: [
      ['count', 'Şerit Sayısı', 2, 16, 1],
      ['width', 'Şerit Genişliği', 0.3, 3, 0.05],
      ['wave', 'Dalgalanma', 0, 3, 0.05],
    ] }),
    V('contours', 'Eşyükselti', 'Üretken Zeminler', { settings: [
      ['lines', 'Çizgi Sayısı', 6, 60, 1],
      ['scale', 'Desen Ölçeği', 0.3, 3, 0.05],
      ['drift', 'Sürüklenme', 0, 3, 0.05],
    ] }),
    V('wavefield', 'Dalga Alanı', 'Üretken Zeminler', { settings: [
      ['depth', 'Satır Sayısı', 6, 60, 1],
      ['amp', 'Genlik', 0.2, 3, 0.05],
      ['spacing', 'Satır Aralığı', 0.6, 1.4, 0.02],
    ] }),
    V('embers', 'Kıvılcım', 'Üretken Zeminler', { settings: [
      ['drift', 'Yükselme Hızı', 0, 3, 0.05],
      ['size', 'Boyut', 0.3, 3, 0.05],
      ['glowAmt', 'Işıma', 0.2, 3, 0.05],
    ] }),
    V('sand', 'Kum', 'Üretken Zeminler', { settings: [
      ['flow', 'Akış Hızı', 0, 3, 0.05],
      ['layers', 'Katman Sayısı', 2, 10, 1],
      ['grain', 'Tane Boyutu', 0.4, 3, 0.05],
    ] }),
    V('stained', 'Vitray', 'Üretken Zeminler', { settings: [
      ['count', 'Cam Sayısı', 12, 120, 1],
      ['lead', 'Kurşun Çizgi', 0, 1.2, 0.02],
      ['glowAmt', 'Işıma', 0, 3, 0.05],
    ] }),
    V('circuit', 'Devre Kartı', 'Üretken Zeminler', { settings: [
      ['count', 'Hat Sayısı', 8, 90, 1],
      ['pulse', 'Sinyal Boyutu', 0.2, 3, 0.05],
      ['thickness', 'Hat Kalınlığı', 0.3, 3, 0.05],
    ] }),
    V('prism', 'Prizma', 'Üretken Zeminler', { settings: [
      ['slices', 'Dilim Sayısı', 3, 36, 1],
      ['depth', 'Derinlik', 0.2, 1.5, 0.05],
      ['spin', 'Dönüş Hızı', 0, 3, 0.05],
    ] }),
    V('globe', 'Küre Ağı', 'Üretken Zeminler', { settings: [
      ['tilt', 'Eğim', -1.2, 1.2, 0.02],
      ['links', 'Bağlantılar', 0, 2, 0.05],
      ['size', 'Nokta Boyutu', 0.3, 3, 0.05],
    ] }),
    V('wireframe', 'Tel Tüneli', 'Üretken Zeminler', { settings: [
      ['rings', 'Halka Sayısı', 6, 40, 1],
      ['sides', 'Kenar Sayısı', 3, 24, 1],
      ['speed', 'Hız', 0.1, 3, 0.05],
    ] }),
    V('hexpulse', 'Petek Nabzı', 'Üretken Zeminler', { settings: [
      ['size', 'Hücre Boyutu', 0.4, 3, 0.05],
      ['gap', 'Hücre Aralığı', 0.8, 2, 0.02],
      ['wave', 'Dalga Sıklığı', 0.2, 3, 0.05],
    ] }),

    V('solid', 'Düz Renk', 'Diğer'),
    V('custom', '🧪 Studio', 'Diğer', { cycle: false }),
  ];

  const listOf = (kind) => (kind === 'background' ? BACKGROUNDS : VISUALIZERS);

  function get(kind, id) {
    return listOf(kind).find((m) => m.id === id) || null;
  }
  function label(kind, id) {
    const m = get(kind, id);
    return m ? m.label : String(id || '');
  }
  function ids(kind, flag) {
    return listOf(kind).filter((m) => !flag || m[flag]).map((m) => m.id);
  }
  function is(kind, id, flag) {
    const m = get(kind, id);
    return !!(m && m[flag]);
  }
  // Otomatik dolaşıma girenler (Otomatik VJ, kısayol döngüsü)
  function cycleIds(kind) {
    return listOf(kind).filter((m) => m.cycle !== false).map((m) => m.id);
  }
  // Panelin gruplu tür seçicisi: { group } başlıkları arasına { value, label }
  function options(kind) {
    const out = [];
    let g = null;
    for (const m of listOf(kind)) {
      if (m.group !== g) { g = m.group; out.push({ group: g }); }
      out.push({ value: m.id, label: m.label });
    }
    return out;
  }
  // Katman türü listesi: [id, ad] çiftleri
  function layerPairs(kind) {
    return listOf(kind).filter((m) => m.layer !== false).map((m) => [m.id, m.label]);
  }

  // Arkaplanın kendi ayarları (yoksa boş liste)
  function settingsOf(kind, id) {
    const m = get(kind, id);
    return (m && m.settings) || [];
  }

  const api = { VISUALIZERS, BACKGROUNDS, get, label, ids, is, cycleIds, options, layerPairs, settingsOf };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (typeof window !== 'undefined') window.SVModeCatalog = api;
})();
