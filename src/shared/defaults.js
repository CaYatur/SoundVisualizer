'use strict';
/* Hem yönetici panelinde hem görselleştirici penceresinde yüklenir.
   window.SV altında ortak varsayılanlar + yardımcılar sağlar. */
(function () {
  const DEFAULT_CONFIG = {
    version: 1,
    // Görselleştirmenin açılacağı ekranlar. Birden fazla seçilirse her birinde
    // ayrı bir tam ekran pencere açılır. `id` eski sürümlerle uyum için kalır.
    display: { id: null, ids: [] },

    audio: {
      // Aygıt adları makineye özeldir; varsayılan her zaman sistem çıkışıdır.
      sources: ['default'],
      sensitivity: 0.25, // genel kazanç
      smoothing: 0.5, // zaman yumuşatma (0..0.95)
      bassBoost: 2.05, // düşük frekans vurgusu
    },

    background: {
      // 'gradient' (WebGL) | 'solid' | 2D modlar:
      // 'waves' | 'aurora' | 'starfield' | 'grid' | 'bokeh' | 'rain' | 'network' | 'rings'
      type: 'gradient',
      solidColor: '#08080f',
      // Not: 2D arkaplan modları da bu bloğun colors/speed/audioReactivity/
      // brightness/vignette alanlarını okur; böylece renk seçiciler, hazır
      // şablonlar ve kullanıcı şablonları tüm arkaplan modlarında geçerli kalır.
      gradient: {
        colors: ['#5b4be0', '#3aa6ff', '#37e0c8', '#7be07b', '#d24bff'],
        style: 'plasma', // 'soft' = yumuşak/parlamasız, 'plasma' = parlamalı
        speed: 0.5,
        drift: 0.05, // tek yönlü kayma miktarı
        wander: 0.85, // sınırlı gezinme/dolanma alanı
        orbit: 1.12, // renk alanlarının yörüngesel hareketi
        swirl: 0.8, // merkez çevresi iç dönüş
        scale: 1.1,
        warp: 0.58, // bozulma miktarı (akışkanlık)
        audioReactivity: 0.8, // sese tepki (akış/dalgalanma)
        brightness: 1.0, // temel parlaklık
        audioBrightness: 1.8, // ses patlaması parlaklığı (ayarlanabilir)
        audioHue: 0.36, // ses ile renk kayması miktarı (0 = kapalı)
        hideLines: true, // belirgin damar/şimşek çizgilerini yumuşat
        grain: 0.0, // film greni (banding'i gizler)
        vignette: 0.34,
      },

      // --- 2D arkaplan modlarının kendi ayarları ---
      // Ortak alanlar (renkler, akış hızı, ses tepkisi, parlaklık, vinyet)
      // yukarıdaki gradient bloğundan okunur; aşağıdakiler moda özeldir.
      starfield: {
        count: 340, // yıldız sayısı
        depth: 1.0, // perspektif derinliği
        size: 1.0, // yıldız boyutu çarpanı
        trail: 1.0, // hız izi uzunluğu
        twinkle: 0.35, // parıldama miktarı
        bassPush: 2.2, // bas darbesinin hızlandırma etkisi
      },
      grid: {
        horizon: 0.52, // ufuk çizgisinin dikey konumu
        rows: 18, // yatay çizgi sayısı
        cols: 26, // dikey çizgi sayısı
        lineWidth: 1.0,
        horizonGlow: 0.55, // ufuk parlamasının gücü
        skyIntensity: 0.95, // gökyüzü gradyanının yoğunluğu
        spectrumBars: 1.0, // dikey çizgilerin spektruma tepkisi
        bassPush: 1.6,
      },
      waves: {
        layers: 6, // katman sayısı
        amplitude: 1.0, // tepe yüksekliği
        frequency: 1.0, // dalga sıklığı
        spread: 1.0, // katmanlar arası açıklık
        opacity: 1.0,
        bassPush: 1.1,
      },
      bokeh: {
        count: 26, // ışık topu sayısı
        size: 1.0, // boyut çarpanı
        sizeVar: 1.0, // boyut çeşitliliği
        drift: 1.0, // süzülme miktarı
        pulse: 0.5, // bas nabzı
        opacity: 1.0,
      },
      rain: {
        columns: 68, // sütun sayısı
        speed: 1.0,
        trail: 1.0, // damla izinin uzunluğu
        density: 0.7, // aynı anda düşen sütun oranı
        thickness: 1.0,
        bassPush: 1.4,
      },
      aurora: {
        bands: 5, // perde sayısı
        amplitude: 1.0, // dalgalanma yüksekliği
        thickness: 1.0, // perde kalınlığı
        softness: 1.0, // kenar yumuşaklığı
        height: 0.55, // perdelerin dikey konumu
        bassPush: 1.2,
      },
      network: {
        nodes: 54, // düğüm sayısı
        linkDist: 0.18, // bağlantı mesafesi (kısa kenara oran)
        nodeSize: 1.0,
        lineWidth: 1.0,
        speed: 1.0,
        bassPush: 1.5,
      },
      rings: {
        rate: 2.4, // saniyedeki halka sayısı
        speed: 1.0, // genişleme hızı
        thickness: 1.0,
        beatSpawn: 1.0, // bas darbesinde ek halka doğurma
        fade: 1.0, // sönme hızı
      },
      nebula: {
        clouds: 7, // bulut katmanı sayısı
        size: 1.0, // bulut yarıçapı çarpanı
        softness: 1.0, // kenar yumuşaklığı
        drift: 1.0, // sürüklenme hızı
        density: 0.75, // yoğunluk / opaklık
        bassPush: 1.4,
      },
      hexgrid: {
        size: 1.0, // altıgen boyutu
        gap: 0.14, // hücreler arası boşluk
        spectrum: 1.0, // spektrumun hücrelere yansıması
        wave: 0.6, // merkezden yayılan dalga
        speed: 1.0,
        bassPush: 1.5,
      },
      ink: {
        blobs: 5, // mürekkep damlası sayısı
        viscosity: 1.0, // akış yumuşaklığı
        swirl: 1.0, // burulma miktarı
        spread: 1.0, // yayılma alanı
        opacity: 0.9,
        bassPush: 1.6,
      },
      snow: {
        count: 260, // parçacık sayısı
        size: 1.0,
        fall: 1.0, // düşme hızı
        sway: 1.0, // yanal salınım
        depth: 1.0, // derinlik katmanları
        bassPush: 1.2,
      },
      city: {
        buildings: 34, // bina sayısı
        height: 1.0, // bina yüksekliği çarpanı
        windows: 1.0, // pencere yoğunluğu
        skyGlow: 0.8, // gökyüzü parlaması
        parallax: 1.0, // ikinci katman kayması
        bassPush: 1.4,
      },
      corridor: {
        rings: 26, // koridor halkası sayısı
        speed: 1.0, // ilerleme hızı
        sides: 0, // 0 = daire, 3..12 = çokgen
        twist: 0.5, // dönüş miktarı
        lineWidth: 1.0,
        bassPush: 1.8,
      },
      spiral: {
        arms: 3, // kol sayısı
        turns: 4.5, // tur sayısı
        thickness: 1.0,
        speed: 1.0,
        taper: 0.7, // uca doğru incelme
        bassPush: 1.3,
      },
      mosaic: {
        cells: 26, // hücre sayısı (kısa kenar)
        jitter: 0.55, // hücre düzensizliği
        borders: 0.35, // hücre kenar kalınlığı
        response: 1.0, // spektrum tepkisi
        speed: 0.6,
        bassPush: 1.2,
      },
    },

    visualizer: {
      // 'none' | 'bars' | 'centerBars' | 'blocks' | 'dots' | 'wave' | 'ribbon' |
      // 'terrain' | 'circular' | 'radialWave' | 'starburst' | 'tunnel' | 'orb' |
      // 'particles' | 'spectrogram' | 'kaleido' | 'helix' | 'metaball' |
      // 'fireworks' | 'vortex' | 'mandala' | 'skyline' | 'lightning' |
      // 'ripplegrid' | 'lissajous' | 'strings' | 'bubbles' | 'wave3d' |
      // 'arcs' | 'pinwheel' |
      // üretken: 'flowfield' | 'flock' | 'voronoi' | 'truchet' | 'moire' |
      //          'interference' | 'ropes' | 'galaxy' | 'dna' | 'isocity' |
      //          'attractorfield' |
      // ölçüm:   'scope' | 'goniometer' | 'chromawheel' |
      // 'geometry' (3B parametrik) |
      // 'feedback' (MilkDrop ailesi) | 'custom' (Studio)
      type: 'bars',
      rainbow: true,
      color: '#3aa6ff',
      color2: '#d24bff',
      barCount: 160,
      minFreq: 20,
      maxFreq: 20000,
      sensitivity: 0.7,
      mirror: false,
      lineWidth: 3,
      cap: true, // bar tepe noktaları
      glow: 0.46,
      gap: 0.36, // barlar arası boşluk oranı
      position: 'center', // 'bottom' | 'center' | 'full' (bars için)
      thickness: 0.42, // dalga/çember için

      /* Tayf ölçümü — bar tabanlı modların hepsi buradan okur.

         Varsayılanlar eski görünüşü korur (log ölçek, doğrusal genlik,
         yayılım kapalı); değişen tek şey barların artık aynı FFT kutusunu
         paylaşmaması. Ayrıntı için src/shared/spectrum.js. */
      spectrum: {
        scale: 'log', // 'log' | 'linear' | 'mel' | 'bark'
        amplitude: 'linear', // 'linear' | 'db'
        floorDb: -60, // dB kipinde taban
        tilt: 0, // oktav başına dB; tiz ucu kaldırmak için
        attack: 0.02, // saniye — yükselme zaman sabiti
        release: 0.16, // saniye — düşme zaman sabiti
        spread: 0, // komşu yayılımı 0..0.95
        exact: true, // dar bantlarda Goertzel ile kesin ölçüm
      },
    },

    logo: {
      enabled: false,
      src: null, // dataURL
      scale: 0.22, // ekranın kısa kenarına oran
      opacity: 1,
      pulse: 0.3, // sese tepki (büyüme)
      x: 0.5,
      y: 0.5, // konum oranı (otomatik ortalama = 0.5, 0.5)
      glow: 0.2,
    },

    power: {
      // 0 = ekranla eşitle (her yenilemede bir kare). En akıcı sonuç budur:
      // ekranın yenileme hızının tam böleni olmayan bir sınır (75 Hz'de 60 gibi)
      // kare aralıklarını eşitsizleştirir.
      fpsCap: 120, // 0(ekranla eşitle) | 30 | 60 | 120
      renderScale: 1.0, // arkaplan çözünürlük ölçeği (0.5..1)
      pauseOnSilence: false,
      hideCursor: true,
      // Görselleştirme penceresini her zaman diğer pencerelerin üstünde tut.
      // Başka bir uygulama öne çıkarsa pencere kendini yeniden üste taşır.
      alwaysOnTop: false,
    },

    // Windows Dynamic Lighting (LampArray). Uyumlu aygıt bulunamazsa yönetici
    // paneli açılışta bunu otomatik olarak kapatır.
    lighting: {
      enabled: true,
      mode: 'beat-pulse',
      color: '#ff0000',
      color2: '#f00000',
      bassColor: '#52ff3f',
      midColor: '#35b8ff',
      trebleColor: '#d43cff',
      brightness: 1.0,
      intensity: 1.0,
      smoothing: 0.48,
      updateRate: 5,
      layout: 'global', // 'global' | 'per-device' | 'uniform'
      paletteSource: 'background', // 'visualizer' | 'background' | 'bands' | 'rainbow' | 'custom'
      colorSpeed: 0.45,
      spread: 2.25,
      saturation: 0.92,
      baseLevel: 0.02,
      bassGain: 1.9,
      midGain: 1.6,
      trebleGain: 1.05,
      spectrumContrast: 0.82,
      zoneBlend: 0.55,
      flashStrength: 1.5,
      flashThreshold: 0.52,
      flashDecay: 0.87,
      triggerBand: 'auto', // 'bass' | 'mid' | 'treble' | 'level' | 'auto'
      rippleSpeed: 0.8,
      rippleWidth: 0.16,
      rippleDirection: 'forward', // 'forward' | 'reverse' | 'alternate'
      fusionMix: 0.55,
      flowSpeed: 0.45,
      audioAcceleration: 1.3,
      bandResponse: 'instant', // 'instant' | 'punchy' | 'smooth'
      bandAttack: 0.92,
      bandRelease: 0.38,
      bandThreshold: 0.6,
      bandHardness: 0.63,
      bandSeparation: 0.78,
      bandPattern: 'zones', // 'zones' | 'alternate' | 'mirror' | 'dominant'
      rainbowStyle: 'ordered', // 'ordered' | 'single'
      rainbowSpeed: 0.5,
      rainbowAudioBand: 'level',
      rainbowAudioBrightness: 0.85,
      rainbowBaseBrightness: 0.2,
      rainbowSpread: 1.0,
      thresholdBurstSource: 'bass', // 'bass' | 'mid' | 'treble' | 'level' | 'auto'
      thresholdBurstThreshold: 0.55,
      thresholdBurstMode: 'hybrid', // 'pulse' | 'proportional' | 'hybrid'
      thresholdBurstStrength: 1.0,
      thresholdBurstDecay: 0.82,
      thresholdBurstCooldown: 120,
      thresholdBurstBaseBrightness: 0.04,
      thresholdBurstColorPosition: 'source', // 'source' | 'center' | 'spread'
      deviceColors: {},
      deviceLedColors: {},
    },

    // Ek görsel nesneler / partiküller. Bir veya birden fazla resim yüklenip
    // sahnede gezinir, saçılır, yörünge çizer; saydamlık + ses tepkisi ayarlanır.
    images: {
      enabled: false,
      items: [], // imageItem() ile üretilen nesneler
    },

    // ------------------------------------------------------------------
    // Katman yığını.
    //
    // Boşsa liste eski alanlardan (background / media / images / visualizer /
    // logo) otomatik SENTEZLENİR; v2.0 ayarları ve sahneleri hiçbir değişiklik
    // olmadan aynı kareyi verir. Kullanıcı katman eklediği anda bu liste
    // sahnenin tek kaynağı olur.
    //
    // Not: her modun kendi içindeki parlama (glow) yerinde kalır — o, şeklin
    // kendi görünümünün parçası. Kompozisyon seviyesindeki bloom ayrı bir
    // son-işlem efektidir ve varsayılan olarak kapalıdır; ikisi toplanır.
    // ------------------------------------------------------------------
    layers: [],

    // ------------------------------------------------------------------
    // Son-işlem efekt zinciri. Katmanların BİRLEŞTİRİLMİŞ çıktısına sırayla
    // uygulanır; sıra kullanıcıya aittir (bloom'dan önce mi sonra mı renk
    // düzeltmesi yapıldığı görüntüyü değiştirir).
    //
    // Zincir boşken sahne CSS ile kompozit edilir (en ucuz yol). İlk efekt
    // eklendiği anda motor tek bir birleştirme yüzeyine geçer ve zinciri
    // GPU'da çalıştırır — yani bedeli yalnızca kullanan öder.
    // { id, type, enabled, params:{}, audio:{param:miktar}, audioBand }
    // ------------------------------------------------------------------
    postfx: [],

    // Kullanıcı renk şablonları (arkaplan gradyanı). Kalıcıdır; içe/dışa aktarılabilir.
    userPresets: [], // { id, name, colors:[5] }

    // Sahneler: tüm görünümün (arkaplan + görselleştirici + logo + görsel nesneler)
    // adlandırılmış anlık görüntüsü. Tek tıkla geri yüklenir; içe/dışa aktarılabilir.
    // { id, name, createdAt, data: { background, visualizer, logo, images } }
    scenes: [],

    // ------------------------------------------------------------------
    // Yayın çıkışı (OBS / tarayıcı kaynağı + mobil uzaktan kumanda)
    //
    // Uygulama yerel bir HTTP + WebSocket sunucusu açar. OBS'e "Tarayıcı
    // Kaynağı" olarak eklenen sayfa, görselleştiricinin AYNI motorunu
    // çalıştırır; ses analizi kareleri WebSocket ile akar. Böylece pencere
    // yakalamaya, ekran kaydına veya native eklentiye gerek kalmaz.
    // ------------------------------------------------------------------
    stream: {
      enabled: false,
      port: 8722,
      lan: false, // true = 0.0.0.0 (telefon/başka makine erişir), false = yalnız 127.0.0.1
      token: '', // boşsa açılışta üretilir; LAN modunda zorunludur
      transparent: true, // arkaplanı saydam bırak (OBS'te üst katman olarak)
      remote: true, // /remote mobil kumanda sayfası açık mı
      overlayFps: 60, // tarayıcı kaynağının kare hızı sınırı
      quality: 1.0, // tarayıcı kaynağı çözünürlük ölçeği
    },

    // ------------------------------------------------------------------
    // Tempo ve otomatik VJ.
    //
    // BPM, spektral akıdan bulunan vuruşların aralık histogramıyla kestirilir
    // (bkz. shared/tempo.js). Otomatik VJ, ölçü ya da saniye başına sahne,
    // görselleştirici veya renk şablonu değiştirir; geçiş vuruşa hizalanır.
    // ------------------------------------------------------------------
    // ------------------------------------------------------------------
    // Katman grupları ve A/B çapraz geçişi.
    //
    // layerGroups: grup adı -> { opacity, muted }. Aynı gruptaki katmanlar
    // tek fader ile birlikte kısılır.
    //
    // "A" ve "B" adlı gruplar özel: crossfade.value ikisi arasında eşit güç
    // eğrisiyle geçiş yapar — doğrusal karışımda ortada toplam parlaklık
    // düşerdi.
    // ------------------------------------------------------------------
    layerGroups: {},
    crossfade: { enabled: true, value: 0 },

    // ------------------------------------------------------------------
    // Metin ve şarkı sözü katmanı.
    //
    // Yazı ölçüsü ekranın KISA kenarına orandır: aynı sahne 1080p monitörde
    // ve 4K projektörde aynı görünsün diye. Piksel vermek çözünürlük
    // değişince yazıyı kaybettirirdi.
    // ------------------------------------------------------------------
    text: {
      enabled: true,
      source: 'static', // 'static' | 'lyrics' | 'now'
      content: 'CAYADEV',
      font: 'system-ui, -apple-system, Segoe UI, Roboto, sans-serif',
      size: 0.09,       // kısa kenara oran
      weight: 700,
      align: 'center',
      x: 0.5,
      y: 0.5,
      opacity: 1,
      outline: 0.2,
      shadow: 0.4,
      useCustomColor: false,
      color: '#ffffff',
      colorHighlight: '#ffd23f',
      animation: 'fade', // 'none' | 'fade' | 'slideUp' | 'slideLeft' | 'scale'
      animDuration: 0.45,
      audioScale: 0.12,
      audioJitter: 0,
      audioLift: 0.25,
      perCharacter: false,
      marquee: false,
      marqueeSpeed: 0.12,
      karaoke: true,
      offset: 0,        // söz senkron düzeltmesi (sn)
      lyricsSource: '', // LRC/SRT dosya içeriği
      lyricsName: '',
      nowPlaying: { title: '', artist: '' },
    },

    // ------------------------------------------------------------------
    // Canlı kayıt.
    //
    // Çevrimdışı dışa aktarıcıdan farklı: sahneyi yeniden çizmez, ekranda
    // görüneni yakalar. O anki canlı ses girdisiyle oluşan bir anı kaydetmenin
    // başka yolu yok.
    // ------------------------------------------------------------------
    recording: {
      format: 'mp4', // 'webm' | 'mp4' | 'gif'
      fps: 60,
      bitrate: 16000000,
      limit: 0, // saniye; 0 = sınırsız
      gifFps: 15,
      gifWidth: 640,
      snapshotScale: 1,
    },

    // ------------------------------------------------------------------
    // MilkDrop motoru.
    //
    // source: preset metni (.milk dosyasının içeriği). Boşsa yerleşik
    // varsayılan preset kullanılır. Denklemler src/shared/milkdrop.js
    // tarafından derlenip çalıştırılır.
    // ------------------------------------------------------------------
    milkdrop: {
      presetId: '',
      name: '',
      source: '',
      autoNext: 0, // 0 = kapalı, >0 = kaç saniyede bir sıradaki presete geç
    },

    // ------------------------------------------------------------------
    // Projeksiyon haritalaması.
    //
    // Görüntüyü düz bir dikdörtgen olmayan yüzeye oturtmak için: köşe
    // düzeltme (homografi), ağ bükme, kırpma, kenar harmanlama, ekran başına
    // renk düzeltme, maske ve hizalama desenleri.
    //
    // outputs: ekran kimliği -> çıkış tanımı (bkz. src/shared/warp.js
    // defaultOutput). Boş bırakılırsa haritalama tamamen atlanır ve
    // ölçülebilir bir maliyeti olmaz.
    // ------------------------------------------------------------------
    mapping: {
      enabled: false,
      outputs: {},
    },

    // ------------------------------------------------------------------
    // Sahne geçişleri.
    //
    // Sahne değiştirmek eskiden sert kesmeydi. Geçiş yalnızca SAHNE
    // değiştiğinde tetiklenir (mod, arkaplan, preset, palet ya da katman
    // yapısı); kaydırıcı oynatmak geçiş başlatmaz — yoksa panel
    // kullanılamaz hale gelirdi.
    // ------------------------------------------------------------------
    transition: {
      enabled: true,
      type: 'crossfade',
      duration: 0.7,
      unit: 'seconds', // 'seconds' | 'beats'
      ease: 'smooth',
      params: {},
    },

    // ------------------------------------------------------------------
    // Modülasyon matrisi.
    //
    // Herhangi bir kaynağı (ses bandı, LFO, zarf, makro, rastgele, tempo)
    // herhangi bir sayısal ayara bağlar. Motor src/shared/modulation.js'te;
    // burada yalnızca kullanıcının kurduğu yönlendirmeler saklanır.
    //
    // Yönlendirme alanları:
    //   source  — kaynak kimliği (SVModulation.catalog())
    //   target  — noktalı yapılandırma yolu, ör. 'postfx.0.params.strength'
    //   min/max — hedefin süpürüleceği aralık
    //   mode    — 'set' | 'add' | 'mul'
    //   curve   — 'linear' | 'exp' | 'exp3' | 'log' | 'scurve' | 'ease' | 'abs'
    //   amount  — etki miktarı (0..1)
    //   smooth  — saniye cinsinden yumuşatma
    //   steps   — 1'den büyükse değeri basamaklandırır
    // ------------------------------------------------------------------
    modulation: {
      enabled: true,
      routes: [],
      bpm: 0, // 0 = tempo motorundan al
      timeRate: 0.1,
      lfos: [
        { shape: 'sine', rate: 0.25, sync: false, division: '1/1', phase: 0, width: 0.25, bipolar: false },
        { shape: 'triangle', rate: 0.5, sync: false, division: '1/2', phase: 0, width: 0.25, bipolar: false },
        { shape: 'sawUp', rate: 1, sync: false, division: '1/4', phase: 0, width: 0.25, bipolar: false },
        { shape: 'smoothRandom', rate: 0.6, sync: false, division: '1/4', phase: 0, width: 0.25, bipolar: false },
      ],
      envelopes: [
        { band: 'bass', attack: 0.02, release: 0.3 },
        { band: 'treble', attack: 0.01, release: 0.15 },
      ],
      /* Adlar boş başlar. Bir ad yapılandırmada saklanan DEĞERdir, arayüz
         metni değil; içine Türkçe yazmak İngilizce arayüzde çevrilemeyen bir
         dize bırakırdı. Panel boş adı çevrilmiş bir yer tutucuyla gösterir. */
      macros: [
        { name: '', value: 0 }, { name: '', value: 0 },
        { name: '', value: 0 }, { name: '', value: 0 },
        { name: '', value: 0 }, { name: '', value: 0 },
        { name: '', value: 0 }, { name: '', value: 0 },
      ],
      random: { rate: 1, sync: false, division: '1/1' },
    },

    autovj: {
      enabled: false,
      source: 'scenes', // 'scenes' | 'visualizers' | 'palettes' | 'all'
      unit: 'bars', // 'bars' | 'seconds'
      interval: 8,
      order: 'sequential', // 'sequential' | 'random'
      bpmLock: 0, // 0 = otomatik kestirim
      beatsPerBar: 4,
    },

    // ------------------------------------------------------------------
    // Art-Net (DMX over Ethernet) çıkışı.
    //
    // Sahne renklerini profesyonel ışık dünyasının standart protokolüyle
    // yayar. Windows Dynamic Lighting'in tamamlayıcısıdır: o tüketici
    // aygıtlarını, bu sahne ışıklarını sürer.
    // ------------------------------------------------------------------
    artnet: {
      enabled: false,
      host: '255.255.255.255', // yayın adresi; tek düğüm için onun IP'si
      port: 6454,
      universe: 0,
      startChannel: 1,
      fixtures: 8,
      channelsPerFixture: 3, // 3 = RGB, 4 = RGBW
      mode: 'palette', // 'palette' | 'bands' | 'spectrum' | 'single'
      color: '#ff2020', // mode === 'single' için
      brightness: 1,
      fps: 30, // DMX zaten 44 Hz üstünü taşımaz
    },

    // ------------------------------------------------------------------
    // Harici kontrol yüzeyleri (MIDI / OSC)
    // Eşleme: { id, source:'midi'|'osc', channel, cc, address, path, min, max, mode }
    // ------------------------------------------------------------------
    control: {
      midi: { enabled: false, deviceId: 'all', mappings: [] },
      osc: { enabled: false, port: 9000, mappings: [] },
    },

    // ------------------------------------------------------------------
    // Medya katmanı: web kamerası veya video dosyası sahneye katman olarak
    // girer; sese göre yakınlaşır, rengi kayar, kaleydoskoba girer.
    // ------------------------------------------------------------------
    media: {
      enabled: false,
      source: 'webcam', // 'webcam' | 'file'
      deviceId: '', // boş = varsayılan kamera
      file: null, // video dosyası (file:// URL)
      fit: 'cover', // 'cover' | 'contain' | 'stretch'
      opacity: 0.85,
      blend: 'normal', // 'normal' | 'screen' | 'add' | 'multiply'
      layer: 'back', // 'back' (görselin arkasında) | 'front'
      loop: true,
      mirror: false,
      kaleido: 0, // 0 = kapalı, 3..12 = dilim sayısı
      hue: 0, // renk kayması (0..1)
      saturate: 1,
      audioZoom: 0.12, // bas -> yakınlaşma
      audioOpacity: 0, // bas -> saydamlık nabzı
    },

    // ------------------------------------------------------------------
    // Studio: kullanıcının kendi yaptığı görselleştirici/arkaplan presetleri.
    // Preset İÇERİĞİ burada DEĞİL, userData/presets/*.json altında durur:
    // ayar dosyası her kaydırıcı hareketinde diske yazılıyor, shader
    // kaynağını oraya koymak dosyayı gereksiz şişirirdi. Burada yalnızca
    // seçim ve kullanıcının o presete verdiği parametre değerleri tutulur.
    // ------------------------------------------------------------------
    custom: {
      visualizerId: null, // visualizer.type === 'custom' iken kullanılan preset
      backgroundId: null, // background.type === 'custom' iken kullanılan preset
      params: {}, // { presetId: { paramAdı: değer } }
    },

    // ------------------------------------------------------------------
    // 3B parametrik geometri motoru (visualizer.type === 'geometry').
    // Formüller shared/formulas.js'te; kapalı formlu olanlar
    // tests/formulas.test.js ile sayısal olarak doğrulanır.
    // ------------------------------------------------------------------
    geometry: {
      family: 'surface', // 'surface' | 'curve3d' | 'curve2d' | 'attractor'
      formula: 'torus',
      params: {}, // formülün kendi parametreleri (boşsa varsayılanlar)
      render: 'wireframe', // 'surface' | 'wireframe' | 'points'
      resolution: 72, // yüzey ızgarası / eğri çözünürlüğü
      deform: 0.28, // sese bağlı bozulma miktarı
      deformMode: 'normal', // 'normal' | 'radial' | 'vertical' | 'collapse'
      spin: 0.18, // kendi ekseninde dönüş hızı
      tilt: 0.32, // kamera eğimi
      zoom: 1,
      cameraAudio: 0.12, // bas -> kamera yakınlaşması
      pointSize: 2.5,
      colorMode: 'palette', // 'palette' | 'depth' | 'normal' | 'spectrum'
      alpha: 1,
      attractorPoints: 20000, // çekici nokta sayısı
      attractorStep: 0.006, // integrasyon adımı
    },

    // MilkDrop ailesi geri besleme (feedback) motoru ayarları
    feedback: {
      zoom: 1.006,
      rotate: 0.0,
      warp: 0.55,
      decay: 0.965,
      dx: 0.0,
      dy: 0.0,
      swirl: 0.35,
      waveMode: 'line', // 'line' | 'circle' | 'dual' | 'spectrum'
      waveAmp: 1.0,
      waveThickness: 1.0,
      echo: 0.0,
      bassZoom: 0.05,
      bassRotate: 0.02,
      sharpen: 0.25,
    },

    // Video dışa aktarma (MP3/ses -> kayıpsız video). Ekran/ses kaydı değil:
    // her kare offline ve birebir render edilir, ses kaynaktan kopyalanır.
    export: {
      resolution: '1080p', // '720p' | '1080p' | '1440p' | '2160p'
      fps: 60, // 30 | 60
      quality: 'visually-lossless', // 'visually-lossless' | 'high' | 'balanced'
      encoder: 'gpu', // 'gpu' (NVIDIA NVENC, hızlı) | 'cpu' (libx264, en uyumlu)
      speed: 'balanced', // 'fast' | 'balanced' | 'quality' — hız/kalite dengesi (preset)
    },
  };

  // Ek görsel nesne (partikül emitör) varsayılanları.
  const IMAGE_DEFAULTS = {
    name: 'Görsel',
    src: null, // dataURL
    count: 14, // kopya / partikül sayısı
    size: 0.07, // kısa kenara oran
    sizeVar: 0.45, // boyut rastgeleliği (0..1)
    opacity: 0.85,
    motion: 'float', // 'static'|'float'|'orbit'|'swirl'|'scatter'|'rise'|'fall'
    speed: 0.5,
    spread: 0.7, // gezinme alanı / yörünge yarıçapı
    spin: 0.15, // kendi ekseninde dönüş
    audioSize: 0.45, // bas -> boyut nabzı
    audioSpeed: 0.35, // seviye -> hareket hızı
    audioOpacity: 0.0, // bas -> saydamlık nabzı
    glow: 0.15,
    blend: 'normal', // 'normal'|'screen'|'add'
    layer: 'front', // 'front' (görselin önünde) | 'back' (arkasında)
    noOverlap: false, // üst üste binmeyi engelle
    minDist: 1.1,    // spriteların merkez mesafesi (boyut çarpanı); 1=kenar kenar, >1=boşluk
  };

  // Yeni bir görsel nesne üret (benzersiz id + deterministik seed ile)
  function imageItem(over) {
    const seed = ((Date.now() & 0xffffff) ^ ((Math.random() * 0xffffff) | 0)) >>> 0 || 1;
    return Object.assign({}, IMAGE_DEFAULTS, { id: 'img_' + seed.toString(36), seed }, over || {});
  }

  // Eksik alanları varsayılanlarla doldur (eski kayıtlar / içe aktarım için)
  function normalizeImageItem(it) {
    const out = Object.assign({}, IMAGE_DEFAULTS, it || {});
    if (out.seed == null) out.seed = ((Math.random() * 0xffffff) | 0) >>> 0 || 1;
    if (out.id == null) out.id = 'img_' + out.seed.toString(36);
    return out;
  }

  /* Hazır renk şablonları (arkaplan gradyanı).

     Kategorilere ayrıldı; her şablon beş renk noktası taşır ve tüm arkaplan
     modlarında, 3B geometride ve Studio shader'larında (sv_col) aynı şekilde
     kullanılır. 'group' alanı yalnızca panelde başlık üretmek içindir. */
  const GRADIENT_PRESETS = [
    // --- Klasikler ---
    { group: 'Klasikler', name: 'Aurora', colors: ['#5b4be0', '#3aa6ff', '#37e0c8', '#7be07b', '#d24bff'] },
    { name: 'Gün Batımı', colors: ['#ff5e62', '#ff9966', '#ffcf6b', '#c94b8e', '#5b2c83'] },
    { name: 'Okyanus', colors: ['#0f2027', '#1c92d2', '#2af5d4', '#136a8a', '#0b486b'] },
    { name: 'Neon', colors: ['#ff00cc', '#3333ff', '#00ffe0', '#9d00ff', '#ff0066'] },
    { name: 'Orman', colors: ['#0b3d2e', '#1e6f5c', '#56c596', '#a3eb9d', '#0f5132'] },
    { name: 'Lav', colors: ['#1a0000', '#7a0000', '#ff2e00', '#ff8a00', '#ffd000'] },
    { name: 'Pastel', colors: ['#a8e6cf', '#dcedc1', '#ffd3b6', '#ffaaa5', '#d7a6ff'] },
    { name: 'Gece', colors: ['#020111', '#191654', '#43377c', '#7b2ff7', '#22264b'] },
    { name: 'Buz', colors: ['#cfefff', '#74c0ff', '#3a7bd5', '#7ee8fa', '#eaf6ff'] },
    { name: 'Tek Renk', colors: ['#3aa6ff', '#3aa6ff', '#1c4fa0', '#3aa6ff', '#1c4fa0'] },

    // --- Sıcak ---
    { group: 'Sıcak', name: 'Çöl', colors: ['#3d1a0e', '#8a4b2a', '#d99058', '#f2c98a', '#fff0d1'] },
    { name: 'Sonbahar', colors: ['#2b1608', '#7a3b12', '#c96a1f', '#e8a33d', '#f5d76e'] },
    { name: 'Şafak', colors: ['#2b1055', '#7597de', '#ff8f70', '#ffc46b', '#fff3b0'] },
    { name: 'Kor', colors: ['#0a0000', '#3d0a00', '#992d00', '#ff6b1a', '#ffb703'] },
    { name: 'Şeftali', colors: ['#5c2a3a', '#a8556b', '#e8899a', '#ffc2b4', '#ffe8d6'] },
    { name: 'Altın Saat', colors: ['#2e1a05', '#8c5a14', '#d9962b', '#f5c95c', '#fdeaa8'] },
    { name: 'Bakır', colors: ['#1f0f08', '#5c2d16', '#a85a2e', '#d98c52', '#f0c39b'] },
    { name: 'Şarap', colors: ['#1a0208', '#4d0a1f', '#8c1839', '#c73659', '#e88b9f'] },
    { name: 'Mercan', colors: ['#3d0f2b', '#8c1f4d', '#e05263', '#ff8a5c', '#ffd6a5'] },
    { name: 'Baharat', colors: ['#2b0f00', '#6b2400', '#b34700', '#e07b1a', '#f2b544'] },

    // --- Soğuk ---
    { group: 'Soğuk', name: 'Kutup', colors: ['#03111f', '#0a3a5c', '#1e7a99', '#5ec4cc', '#c9f2ee'] },
    { name: 'Derin Deniz', colors: ['#00121f', '#012a4a', '#01497c', '#2a6f97', '#61a5c2'] },
    { name: 'Nane', colors: ['#04241c', '#0a4a3a', '#16a085', '#5fdba7', '#c8f7dc'] },
    { name: 'Gökyüzü', colors: ['#0b1d33', '#1c4a80', '#3d84c6', '#7fb3e8', '#cfe4f7'] },
    { name: 'Kış Sabahı', colors: ['#1a2130', '#3b4a63', '#6e88a6', '#a8c0d6', '#e4eef5'] },
    { name: 'Turkuaz', colors: ['#02141a', '#04414d', '#0a7c8c', '#26c6c6', '#a8f0ec'] },
    { name: 'Lavanta', colors: ['#1a1030', '#3d2a63', '#6b52a3', '#a58fd6', '#dfd4f2'] },
    { name: 'Sis', colors: ['#141a1f', '#2e3a45', '#54666e', '#8fa3a8', '#d1dde0'] },
    { name: 'Kuzey Işığı', colors: ['#010b14', '#04304a', '#0e8b7a', '#5ce8a8', '#b6f5d8'] },
    { name: 'Buzul', colors: ['#0a1a26', '#17475c', '#3d87a6', '#82c4d9', '#dff2f7'] },

    // --- Neon ve siber ---
    { group: 'Neon ve Siber', name: 'Siberpunk', colors: ['#05010f', '#2d0a4e', '#c724b1', '#00f0ff', '#f9f871'] },
    { name: 'Synthwave', colors: ['#0d0221', '#3a015c', '#ff1f8f', '#ff8c42', '#00e5ff'] },
    { name: 'Vapor', colors: ['#1a0b2e', '#7b2ff7', '#ff6ec7', '#00e0d3', '#f9f3ff'] },
    { name: 'Asit', colors: ['#04140a', '#0f4d1a', '#4ade2e', '#b6ff3d', '#f0ffb3'] },
    { name: 'Ultraviyole', colors: ['#0a0018', '#2e0066', '#6f00ff', '#b14aff', '#e9c6ff'] },
    { name: 'Matris', colors: ['#000600', '#022c02', '#0a8c14', '#2ee62e', '#b3ffb3'] },
    { name: 'Gece Kulübü', colors: ['#12002b', '#5b00b5', '#ff007a', '#00e5ff', '#2b0050'] },
    { name: 'Lazer', colors: ['#0a0014', '#4d0080', '#ff0066', '#ffcc00', '#00ffcc'] },
    { name: 'Hologram', colors: ['#0f0f2b', '#2e6ee6', '#4ae8d6', '#c78cff', '#ffe0f5'] },
    { name: 'Devre', colors: ['#02100e', '#053d33', '#0f9e7a', '#6be0a8', '#d0f5e4'] },

    // --- Karanlık ---
    { group: 'Karanlık', name: 'Kömür', colors: ['#050507', '#141419', '#2b2b33', '#4d4d59', '#8a8a99'] },
    { name: 'Gotik', colors: ['#08040a', '#210d2b', '#45164d', '#7a2e70', '#b05c96'] },
    { name: 'Uzay Boşluğu', colors: ['#000208', '#050c26', '#0e1d4d', '#1f3b8c', '#4a6bd6'] },
    { name: 'Kan Ayı', colors: ['#0a0202', '#2b0505', '#6b0f0f', '#a82626', '#d95c5c'] },
    { name: 'Zift', colors: ['#020204', '#0a1014', '#14262e', '#26454f', '#3d6b75'] },
    { name: 'Gölge', colors: ['#060409', '#170f1f', '#2e1f3d', '#4d3a63', '#7a648f'] },

    // --- Aydınlık ---
    { group: 'Aydınlık', name: 'Kağıt', colors: ['#f5f0e8', '#e0d6c4', '#c4b49a', '#9e8b70', '#6b5c45'] },
    { name: 'Bahar', colors: ['#eaf7d9', '#b8e6a0', '#7dcf7d', '#4aa89e', '#3d7fb5'] },
    { name: 'Şeker', colors: ['#fff0f7', '#ffc2e0', '#ff8ac4', '#c78cff', '#8ad4ff'] },
    { name: 'Limonata', colors: ['#fffbe0', '#fff0a3', '#ffd45c', '#ffab3d', '#ff7a45'] },
    { name: 'Deniz Köpüğü', colors: ['#f0fffa', '#c2f5e4', '#8adfd0', '#52bfc4', '#2e88a6'] },
    { name: 'Gündüz', colors: ['#e8f4ff', '#b8dcff', '#7ab8f5', '#4a8fd6', '#2b62a3'] },

    // --- Tek renk aileleri ---
    { group: 'Tek Renk Aileleri', name: 'Mono Kırmızı', colors: ['#1a0000', '#4d0000', '#990000', '#e60000', '#ff8080'] },
    { name: 'Mono Mavi', colors: ['#000a1a', '#00234d', '#004799', '#0a7ae6', '#80c4ff'] },
    { name: 'Mono Yeşil', colors: ['#001a08', '#004d19', '#009933', '#1ae65c', '#8fffb8'] },
    { name: 'Mono Mor', colors: ['#0f001a', '#2e004d', '#5c0099', '#9a1ae6', '#d18aff'] },
    { name: 'Mono Turuncu', colors: ['#1a0800', '#4d1c00', '#993800', '#e65c00', '#ffb380'] },
    { name: 'Gri Tonlama', colors: ['#000000', '#3d3d3d', '#7a7a7a', '#b8b8b8', '#ffffff'] },
  ];

  // Derin birleştirme (kaydedilen ayarları varsayılanlarla doldurur)
  function deepMerge(base, override) {
    if (override == null) return clone(base);
    if (Array.isArray(base)) {
      return Array.isArray(override) ? override.slice() : clone(base);
    }
    if (typeof base === 'object' && base !== null) {
      const out = {};
      for (const k of Object.keys(base)) {
        out[k] = deepMerge(base[k], override ? override[k] : undefined);
      }
      // override içindeki ekstra anahtarları da koru
      if (override && typeof override === 'object') {
        for (const k of Object.keys(override)) {
          if (!(k in out)) out[k] = override[k];
        }
      }
      return out;
    }
    return override === undefined ? base : override;
  }

  function clone(v) {
    return JSON.parse(JSON.stringify(v));
  }

  function defaultConfig() {
    return clone(DEFAULT_CONFIG);
  }

  /* Hex -> [r,g,b] 0..1

     Girdi her zaman geçerli olmayabilir: renkler preset dosyalarından,
     şablonlardan ve eski ayar dosyalarından geliyor ve eksik ya da bozuk
     olabiliyor. Böyle bir durumda çökmek yerine beyaz döndürülür — bir
     karenin yanlış renkte çizilmesi, o karenin hiç çizilmemesinden iyidir. */
  function hexToRgb01(hex) {
    const h = String(hex == null ? '' : hex).trim().replace(/^#/, '');
    const full = h.length === 3 ? h.split('').map((c) => c + c).join('') : h;
    if (!/^[0-9a-fA-F]{6}$/.test(full)) return [1, 1, 1];
    const n = parseInt(full, 16);
    return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
  }

  window.SV = {
    DEFAULT_CONFIG,
    GRADIENT_PRESETS,
    IMAGE_DEFAULTS,
    imageItem,
    normalizeImageItem,
    defaultConfig,
    deepMerge,
    clone,
    hexToRgb01,
  };
})();
