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
    V('ink', 'Mürekkep', 'Akışkan'),
    V('nebula', 'Bulutsu', 'Akışkan'),
    V('waves', 'Dalga Katmanları', 'Akışkan'),
    V('aurora', 'Kutup Işıkları', 'Akışkan'),

    V('grid', 'Retro Izgara', 'Geometrik'),
    V('hexgrid', 'Petek Izgara', 'Geometrik'),
    V('mosaic', 'Mozaik', 'Geometrik'),
    V('corridor', 'Koridor', 'Geometrik'),
    V('spiral', 'Sarmal', 'Geometrik'),
    V('rings', 'Nabız Halkaları', 'Geometrik'),
    V('network', 'Ağ', 'Geometrik'),

    V('starfield', 'Yıldız Alanı', 'Atmosfer'),
    V('snow', 'Kar / Kor', 'Atmosfer'),
    V('bokeh', 'Işık Parçacıkları', 'Atmosfer'),
    V('rain', 'Dijital Yağmur', 'Atmosfer'),
    V('city', 'Şehir', 'Atmosfer'),

    V('liquid', 'Sıvı Metal', 'Üretken Zeminler'),
    V('plasma', 'Plazma', 'Üretken Zeminler'),
    V('caustics', 'Su Yüzeyi', 'Üretken Zeminler'),
    V('ribbons', 'Şeritler', 'Üretken Zeminler'),
    V('contours', 'Eşyükselti', 'Üretken Zeminler'),
    V('wavefield', 'Dalga Alanı', 'Üretken Zeminler'),
    V('embers', 'Kıvılcım', 'Üretken Zeminler'),
    V('sand', 'Kum', 'Üretken Zeminler'),
    V('stained', 'Vitray', 'Üretken Zeminler'),
    V('circuit', 'Devre Kartı', 'Üretken Zeminler'),
    V('prism', 'Prizma', 'Üretken Zeminler'),
    V('globe', 'Küre Ağı', 'Üretken Zeminler'),
    V('wireframe', 'Tel Tüneli', 'Üretken Zeminler'),
    V('hexpulse', 'Petek Nabzı', 'Üretken Zeminler'),

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

  const api = { VISUALIZERS, BACKGROUNDS, get, label, ids, is, cycleIds, options, layerPairs };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (typeof window !== 'undefined') window.SVModeCatalog = api;
})();
