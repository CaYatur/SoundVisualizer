/*
 * SoundVisualizer — CaYaDev Ses Görselleştirici
 * Copyright (c) 2026 Çağan Turgut (CaYatur) — CaYaDev, https://cayadev.com
 * https://github.com/CaYatur/SoundVisualizer
 * SPDX-License-Identifier: MIT
 */
'use strict';
/* Lightweight UI localization. English is the fallback; Turkish is used only
   when the operating-system/browser locale starts with "tr". */
(function () {
  const detected = (typeof navigator !== 'undefined' && ((navigator.languages && navigator.languages[0]) || navigator.language)) || 'en';
  /* Dil tercihi. Yayın sunucusu tarafından servis edilen sayfalarda (OBS
     katmanı ve mobil kumanda) uygulamanın dili sayfaya window.__SV_LOCALE ile
     enjekte edilir; telefonun kendi dili değil, uygulamanın dili geçerlidir. */
  const injected = typeof window !== 'undefined' ? window.__SV_LOCALE : null;
  const preference = injected || (typeof localStorage !== 'undefined' ? localStorage.getItem('sv-language') : null) || 'auto';
  const locale = preference === 'tr' || preference === 'en'
    ? preference
    : (/^tr(?:-|$)/i.test(detected) ? 'tr' : 'en');

  const EN = {
    'Ses Görselleştirici — Yönetici Paneli': 'Sound Visualizer — Admin Panel',
    'Ses Görselleştirici · Yönetici Paneli': 'Sound Visualizer · Admin Panel',
    'Ayarlar': 'Settings',
    'Dil': 'Language',
    'Otomatik (Sistem dili)': 'Automatic (System language)',
    'Türkçe': 'Turkish',
    'Dil değişikliği uygulamayı yeniden yükler.': 'Changing the language reloads the application.',
    'Kapat': 'Close',
    'Ses çıkışı yakalanamadı.': 'Audio output could not be captured.',
    "Farklı bir Çıkış Aygıtı seçmeyi deneyin veya Aygıtları Yenile'ye basın. Aygıt başka bir uygulama tarafından özel (exclusive) modda kullanılıyorsa serbest bırakın.": 'Try selecting a different Output Device or press Refresh Devices. If another application is using the device in exclusive mode, release it there first.',
    'Çıkış Aygıtı': 'Output Device',
    'Otomatik Onar': 'Automatic Repair',
    // Aynı ayar klasörünü kullanan başka kopya ve ayar dosyası çakışması (#564)
    'Uygulamanın başka bir kopyası da çalışıyor.': 'Another copy of the application is running.',
    'İki kopya aynı ayar klasörünü kullanır; birinin kaydettiği ayarlar diğerininkini ezebilir.':
      'Both copies use the same settings folder, so settings saved by one can overwrite the other’s.',
    'kurulu': 'installed',
    'taşınabilir': 'portable',
    'geliştirme': 'development',
    'öz test': 'self-test',
    'ekran görüntüsü aracı': 'screenshot tool',
    'açılış': 'started',
    'Ayar dosyası bu kopyanın dışında değişti.': 'The settings file was changed outside this copy.',
    'Üstüne yazmamak için bu kopya ayarları kaydetmeyi durdurdu.': 'This copy has stopped saving settings so that it does not write over that change.',
    'Diskteki ayarları yükleyebilir ya da bu kopyadaki ayarları kaydedip diskteki değişikliğin üstüne yazabilirsiniz.':
      'You can load the settings from disk, or save this copy’s settings over the change on disk.',
    'Ayar dosyası okunamadı ya da bozuk; bu kopyadaki ayarlar yerinde duruyor.':
      'The settings file could not be read or is damaged; this copy’s settings are unchanged.',
    'Diskteki Ayarları Yükle': 'Load Settings from Disk',
    'Bu Kopyadakileri Kaydet': 'Save This Copy’s Settings',
    'Onarılıyor…': 'Repairing…',
    'Ses bekleniyor…': 'Waiting for audio…',
    'Varsayılanlara Sıfırla': 'Reset to Defaults',
    'Görselleştirme ekranında': 'In the visualizer, press',
    'ile çıkış • Ayarlar otomatik kaydedilir': 'to exit • Settings are saved automatically',
    'Görselleştirme ekranında ESC ile çıkış • Ayarlar otomatik kaydedilir': 'Press ESC in the visualizer to exit • Settings are saved automatically',
    'Kendi Şablonlarım': 'My Presets',
    'Henüz şablon yok. Aşağıdaki renkleri ayarlayıp “Mevcut Renkleri Kaydet”e basın.': 'No presets yet. Adjust the colors below and press “Save Current Colors”.',
    'Şablon': 'Preset', 'Uygula': 'Apply', 'Güncelle': 'Update', 'Mevcut renklerle güncelle': 'Update with current colors',
    'Mevcut Renkleri Kaydet': 'Save Current Colors', 'Dışa Aktar': 'Export',
    'Arkaplanı Dışa Aktar': 'Export Background', 'Arkaplanı İçe Aktar': 'Import Background',
    'Arkaplan Ayarları (dosya)': 'Background Settings (file)',
    'Sabit': 'Static', 'Süzülme': 'Float', 'Yörünge': 'Orbit', 'Saçılma (sese)': 'Scatter (audio)', 'Yükselme': 'Rise', 'Düşme': 'Fall',
    'Ekran (parlak)': 'Screen (bright)', 'Toplama (ışıltı)': 'Add (glow)', 'Önde': 'Front', 'Arkada': 'Back',
    'Görsel eklemek için aşağıdaki düğmeyi kullanın. Her görsel için çok sayıda kopya (partikül) sahnede gezinir/saçılır.': 'Use the button below to add an image. Multiple copies (particles) of each image move and scatter across the scene.',
    'Görsel': 'Image', 'Değiştir': 'Replace',
    'Kopya Sayısı': 'Copy Count', 'Boyut Çeşitliliği': 'Size Variation',
    'Yayılma / Alan': 'Spread / Area', 'Ses → Boyut': 'Audio → Size',
    'Ses → Hız': 'Audio → Speed',
    'Üst Üste Binmeyi Engelle': 'Prevent Overlap', 'Minimum Mesafe (boyut çarpanı)': 'Minimum Distance (size multiplier)',
    'Görsel Ekle': 'Add Image', 'Resim / Logo Seç': 'Choose Image / Logo', 'Otomatik Ortala': 'Auto Center',
    'Varsayılan Çıkış (Aktif Hoparlör)': 'Default Output (Active Speaker)', 'Henüz dosya seçilmedi': 'No file selected yet',
    'Ses Dosyası Seç (MP3 / WAV / FLAC)': 'Choose Audio File (MP3 / WAV / FLAC)', 'Videoya Aktar': 'Export Video',
    'Hassasiyet': 'Sensitivity', 'Bas Güçlendirme': 'Bass Boost',
    'Renkler ve Hazır Şablonlar': 'Colors and Built-in Presets',
    'Akışkan gradyan ve palet kullanan arkaplanların renk dizisi ve hazır renk temaları.': 'Color sequence and built-in themes for fluid gradient and palette-driven backgrounds.',
    'Arkaplan (Akışkan Gradyan)': 'Background (Fluid Gradient)', 'Sese tepki veren sisli/akışkan fon. Renkler ve hazır şablonlar.': 'A misty, fluid background that reacts to audio. Includes colors and built-in presets.',
    'Stil': 'Style', 'Yumuşak (Parlamasız)': 'Soft (No Glow)', 'Plazma (Parlamalı)': 'Plasma (Glowing)',
    'Renkler': 'Colors', 'Renkler (5 nokta)': 'Colors (5 points)', 'Akış Hızı': 'Flow Speed', 'Tek Yönlü Kayma': 'Directional Drift', 'Gezinme Alanı': 'Wander Area', 'Dolanma Miktarı': 'Orbit Amount',
    'İç Dönüş (Swirl)': 'Inner Swirl', 'Ölçek (Yoğunluk)': 'Scale (Density)', 'Bozulma (Akışkanlık)': 'Warp (Fluidity)',
    'Ses Tepkisi (Dalgalanma)': 'Audio Reactivity (Waves)', 'Parlaklık (Temel)': 'Base Brightness', 'Ses Patlaması (Parlaklık)': 'Audio Burst (Brightness)',
    'Ses ile Renk Kayması': 'Audio Hue Shift', 'Hat Çizgilerini Gizle': 'Hide Line Artifacts', 'Gren': 'Grain', 'Vinyet': 'Vignette',
    'Sese duyarlı ön efekt. Frekans barları, dalga veya çember.': 'Audio-reactive foreground effect: frequency bars, waveform, or circle.',
    'Merkez Barlar': 'Center Bars', 'Gökkuşağı (Rainbow)': 'Rainbow',
    'Birincil Renk': 'Primary Color', 'İkincil Renk': 'Secondary Color', 'Ayna (Simetri)': 'Mirror (Symmetry)', 'Bar Sayısı': 'Bar Count', 'Tepe Noktaları': 'Peak Caps',
    'Min Frekans (Hz)': 'Min Frequency (Hz)', 'Max Frekans (Hz)': 'Max Frequency (Hz)', 'Parlama (Glow)': 'Glow',
    // Katman paneli
    'Medya Kaynağı': 'Media Source',
    'Web Kamerası': 'Webcam',
    'Videoyu Değiştir': 'Change Video',
    'Kapla': 'Cover',
    'Medya kapalı. Kaynak seçilince açılır.': 'Media is off. Choosing a source turns it on.',
    'Liste çizim sırasının tersinde: en üstteki katman görüntüde de en üstte.': 'The list runs opposite to draw order: the layer at the top is the topmost one in the output.',
    'Katman yığını kapalı. Sahne Arkaplan ve Görselleştirici kartlarından sürülüyor. Katman listeniz duruyor; anahtarı açtığınızda aynı düzenle geri gelir.': 'The layer stack is off. The scene is driven by the Background and Visualizer cards. Your layer list is kept; turning the switch back on restores it unchanged.',
    'Katman yığını kapalı. Sahne Arkaplan ve Görselleştirici kartlarından sürülüyor. Anahtarı açarsanız aynı görünüm katman listesi olarak açılır ve üzerine yenilerini ekleyebilirsiniz.': 'The layer stack is off. The scene is driven by the Background and Visualizer cards. Turning the switch on opens the same look as a layer list you can build on.',
    // Katlanan tür seçici
    'Seçili tür': 'Selected type',
    'Tüm türler': 'All types',
    'Listeyi küçült': 'Collapse the list',
    // Müzik videosu şablonları
    'Müzik Videosu': 'Music Video',
    'Label Card': 'Label Card',
    'Resmî kanal düzeni: bar şeridi, altında logo ve parça bilgisi.': 'Official channel layout: a bar strip with the logo and track details beneath it.',
    'Artwork Card': 'Artwork Card',
    'Kapak görseli solda, parça bilgisi sağında; barlar üstte.': 'Artwork on the left, track details to its right, bars above.',
    'Baseline Bars': 'Baseline Bars',
    'Parlak bir taban çizgisine oturan barlar, altında büyük başlık.': 'Bars sitting on a bright baseline with a large title below.',
    'Amber Room': 'Amber Room',
    'Koyu tepeden sıcak sarıya inen zemin, ortada bar şeridi.': 'A ground falling from dark to warm amber, with a bar strip across the middle.',
    'Minimal White': 'Minimal White',
    'İnce beyaz barlar, dokulu koyu zemin; en sade yayın düzeni.': 'Thin white bars on a textured dark ground -- the most restrained layout.',
    'Quiet Frame': 'Quiet Frame',
    'Neredeyse boş kadraj: köşede küçük barlar, altta parça bilgisi.': 'An almost empty frame: small bars in the corner, track details along the bottom.',
    'Corner Meter': 'Corner Meter',
    'Barlar sağ alt köşede, parça bilgisi sol altta.': 'Bars in the bottom-right corner, track details bottom-left.',
    'Centre Strip': 'Centre Strip',
    'Ortada dar bar şeridi, üstünde başlık; simetrik ve sakin.': 'A narrow bar strip across the centre with the title above it -- symmetrical and calm.',
    'Zemin': 'Ground', 'Parça Adı': 'Track Title',
    // Bar yerleşimi
    'Bar Yerleşimi': 'Bar Placement',
    'Bar Genişliği': 'Bar Width',
    'Bar Yüksekliği': 'Bar Height',
    'Taban Çizgisi': 'Baseline',
    // Tayf ölçümü
    'Tayf Ölçümü': 'Spectrum Metering',
    'Frekans Ölçeği': 'Frequency Scale', 'Logaritmik (müzikal)': 'Logarithmic (musical)',
    'Mel (algısal)': 'Mel (perceptual)', 'Bark (kritik bant)': 'Bark (critical band)',
    'Genlik Ölçeği': 'Amplitude Scale', 'Desibel (sessiz ayrıntıyı görünür kılar)': 'Decibel (makes quiet detail visible)',
    'dB Tabanı': 'dB Floor', 'Atak (sn)': 'Attack (s)', 'Bırakma (sn)': 'Release (s)',
    'Komşu Yayılımı': 'Neighbour Spread', 'Eğim (dB/oktav)': 'Tilt (dB/octave)',
    'Profil Yumuşatma': 'Profile Smoothing',
    'Bar Boşluğu': 'Bar Gap', 'Yerleşim': 'Position', 'Tam': 'Full', 'Genlik / Dolgu': 'Amplitude / Fill',
    'Logo / Merkez Görsel': 'Logo / Center Image', 'Logo / Resim': 'Logo / Image', 'Merkeze resim yerleştir; otomatik boyutlandırılır ve nabız atar.': 'Place an image in the center; it is automatically sized and pulses with audio.',
    'Logo Göster': 'Show Logo', 'Ses Nabzı': 'Audio Pulse', 'Konum': 'Position',
    'Görsel Nesneler / Partiküller': 'Visual Objects / Particles',
    'Bir veya birden fazla resim ekle; sahnede süzülsün, yörünge çizsin, sese göre saçılsın. Boyut, hız, saydamlık, ışıltı ve katman ayarlanır.': 'Add one or more images and let them float, orbit, or scatter with audio. Size, speed, opacity, glow, and layer are adjustable.',
    'Görsel Nesneleri Etkinleştir': 'Enable Visual Objects',
    'Kare hızı, çözünürlük ölçeği ve enerji ayarları.': 'Frame rate, resolution scale, and power settings.',
    'Kare Hızı (FPS)': 'Frame Rate (FPS)', '30 FPS (Düşük güç)': '30 FPS (Low power)', '60 FPS (Dengeli)': '60 FPS (Balanced)', '60 FPS (Akıcı)': '60 FPS (Smooth)', '120 FPS (Akıcı)': '120 FPS (Smooth)', 'Sınırsız': 'Unlimited',
    'Sessizlikte Duraklat': 'Pause on Silence', 'İmleci Gizle': 'Hide Cursor',
    'Bir ses dosyası seç; yukarıdaki görsel ayarlarla kayıpsız videoya dönüştürülür. Ekran/ses kaydı yapılmaz — her kare birebir render edilir, ses kaynaktan kopyalanır.': 'Choose an audio file and render it to a visually lossless video using the settings above. No screen/audio recording is performed—every frame is rendered directly and audio is copied from the source.',
    'Kodlayıcı (Hız)': 'Encoder (Speed)', 'GPU — NVIDIA NVENC (çok hızlı)': 'GPU — NVIDIA NVENC (very fast)',
    'CPU — libx264 (en uyumlu, yavaş)': 'CPU — libx264 (most compatible, slow)', 'CPU — libx264 (GPU bulunamadı)': 'CPU — libx264 (GPU unavailable)',
    'Kalite': 'Quality', 'Görsel Kayıpsız (en yüksek)': 'Visually Lossless (highest)', 'Yüksek': 'High', 'Dengeli (daha küçük dosya)': 'Balanced (smaller file)',
    'Hız / Kalite Dengesi': 'Speed / Quality Balance', 'Hızlı (en hızlı dışa aktarım)': 'Fast (fastest export)', 'Dengeli (önerilen)': 'Balanced (recommended)', 'Kalite (en yavaş, en iyi sıkıştırma)': 'Quality (slowest, best compression)',
    'Bu şablon silinsin mi?': 'Delete this preset?',
    'Renk Şablonlarını İçe Aktar': 'Import Color Presets', 'İçe aktarılamadı:': 'Import failed:', 'Dosyada şablon bulunamadı.': 'No presets were found in the file.',
    'İçe Aktarılan': 'Imported', 'Arkaplan Ayarlarını İçe Aktar': 'Import Background Settings', 'Geçerli bir arkaplan dosyası değil.': 'This is not a valid background file.',
    'Önce bir ses dosyası seçin.': 'Choose an audio file first.', 'Başlatılamadı': 'Could not start', 'Hazırlanıyor…': 'Preparing…',
    'Tüm ayarlar varsayılana dönecek. Emin misiniz?': 'All settings will be reset to defaults. Are you sure?',
    'Kodlanıyor': 'Encoding', 'kareler bitti, video yazılıyor.': 'frames complete, writing video.',
    'bilinmeyen hata': 'unknown error', 'Ses alınamıyor — yönetici panelinden çıkış aygıtı seçin': 'No audio — select an output device in the admin panel',
    'Gün Batımı': 'Sunset', 'Okyanus': 'Ocean', 'Gece': 'Night', 'Buz': 'Ice', 'Lav': 'Lava', 'Orman': 'Forest', 'Aurora': 'Aurora',
    'Windows Dynamic Lighting': 'Windows Dynamic Lighting',
    'Uyumlu RGB aygıtlarını görselleştirici renkleriyle senkronize eder. Varsayılan olarak kapalıdır.': 'Synchronizes compatible RGB devices with the visualizer colors. Disabled by default.',
    'Aydınlatma Aygıtlarını Tara': 'Scan Lighting Devices',
    'Aydınlatma Modu': 'Lighting Mode',
    'Görselleştirici ile Senkron': 'Visualizer Sync',
    'Tüm Aygıtlarda Tek Renk': 'Single Color on All Devices',
    'Aygıt Başına Renk': 'Per-Device Color',
    'LED / Bölge Başına Renk': 'Per-LED / Zone Color',
    'LED / bölge': 'LED / zone',
    'Ses Tepkisi': 'Audio Reactivity',
    'Güncelleme Hızı': 'Update Rate',
    'Arka plan Dynamic Lighting kimliği hazır': 'Background Dynamic Lighting identity is ready',
    'Portable sürüm yalnızca CAYADEV Visualizer odaktayken aydınlatmayı kontrol eder.': 'The portable build controls lighting only while CAYADEV Visualizer is focused.',
    'Ön plan kontrol durumu, Dynamic Lighting etkinleştirildiğinde izlenir.': 'Foreground control status is monitored when Dynamic Lighting is enabled.',
    'Not: Portable sürüm yalnızca uygulama odaktayken aydınlatmayı kontrol eder. Başka uygulamalara geçtiğinizde de kontrolün sürmesi gerekiyorsa installer sürümünü kullanın.': 'Note: The portable build controls lighting only while the application is focused. Use the installer build if control must continue after switching to another application.',
    'Arka plan kimliği bulunamadı; ön plan kontrolü kullanılabilir.': 'Background identity was not found; foreground control is still available.',
    'Geliştirme modunda yalnızca ön plan kontrolü kullanılabilir.': 'Only foreground control is available in development mode.',
    'Arka plan Dynamic Lighting kimliği kurulamadı.': 'Background Dynamic Lighting identity could not be installed.',
    'Not: Arka planda kontrolün sürmesi için Windows Dynamic Lighting > Arka plan ışık denetimi bölümünde CAYADEV Visualizer uygulamasını listenin en üstüne taşıyın. Başka bir uygulama yine kontrolü alıyorsa “Ön plandaki uyumlu uygulamalar her zaman aydınlatmayı denetler” seçeneğini kapatın.': 'Note: To keep control in the background, move CAYADEV Visualizer to the top of Windows Dynamic Lighting > Background light control. If another application still takes control, turn off “Compatible apps in the foreground always control lighting.”',
    'Görselleştirici Renk Akışı': 'Visualizer Color Flow',
    'Görselleştiricinin bar renklerini aygıt ve LED’lere yayar.': 'Spreads the visualizer bar colors across devices and LEDs.',
    'Bar Spektrum Eşleme': 'Bar Spectrum Mapping',
    'Her LED’i karşılık gelen frekans barının rengi ve yüksekliğiyle sürer.': 'Drives each LED with the color and height of its matching frequency bar.',
    'Bas · Mid · Tiz Bölgeleri': 'Bass · Mid · Treble Zones',
    'Bas, orta ve tiz frekanslarını ayrı renk bölgelerine böler.': 'Splits bass, mid, and treble frequencies into separate color zones.',
    'Arka Plan Işık Senkronu': 'Background Light Sync',
    'Arka plan gradyanının renk, akış ve ses tepkisini ışıklara taşır.': 'Transfers background gradient colors, motion, and audio response to the lights.',
    'Eşzamanlı Ritim Patlaması': 'Synchronized Beat Flash',
    'Seçilen frekans vuruşunda tüm aygıtları aynı tonda parlatır.': 'Flashes every device in the same tone on the selected frequency beat.',
    'Frekans Dalga / Ripple': 'Frequency Wave / Ripple',
    'Vuruşları LED dizileri boyunca hareket eden renk dalgalarına dönüştürür.': 'Turns beats into color waves moving across LED arrays.',
    'Bar + Arka Plan Füzyonu': 'Bar + Background Fusion',
    'Bar spektrumu ile arka plan ışıklarını aynı anda karıştırır.': 'Blends the bar spectrum and background lighting at the same time.',
    'Aygıtlar Arası Renk Akışı': 'Cross-Device Color Flow',
    'Renkleri tüm aygıt ve LED’ler boyunca kesintisiz dolaştırır.': 'Moves colors continuously across all devices and LEDs.',
    'Genel Parlaklık': 'Master Brightness',
    'Genel Dinamik Ayarlar': 'General Dynamic Settings',
    'LED Yerleşimi': 'LED Layout',
    'Tüm Aygıtlarda Kesintisiz': 'Continuous Across All Devices',
    'Her Aygıtta Baştan Başla': 'Restart on Each Device',
    'Sessizlikte Işık': 'Idle Light Level',
    'Renk Doygunluğu': 'Color Saturation',
    'Renk Yayılımı': 'Color Spread',
    'Görselleştirici Bar Renkleri': 'Visualizer Bar Colors',
    'Arka Plan Gradyanı': 'Background Gradient',
    'Bas · Mid · Tiz Renkleri': 'Bass · Mid · Treble Colors',
    'Tam Spektrum Gökkuşağı': 'Full-Spectrum Rainbow',
    'Birincil · İkincil Renk': 'Primary · Secondary Colors',
    'MilkDrop Görüntüsü (Canlı)': 'MilkDrop Picture (Live)',
    'Frekans Renkleri ve Hassasiyet': 'Frequency Colors and Sensitivity',
    'Bas Rengi': 'Bass Color', 'Orta Frekans Rengi': 'Mid Color', 'Tiz Rengi': 'Treble Color',
    'Bas Hassasiyeti': 'Bass Sensitivity', 'Orta Frekans Hassasiyeti': 'Mid Sensitivity', 'Tiz Hassasiyeti': 'Treble Sensitivity',
    'Renk Akış Hızı': 'Color Flow Speed', 'Sesle Hızlanma': 'Audio Acceleration',
    'Bar Kontrastı': 'Bar Contrast', 'Bölge Geçiş Yumuşaklığı': 'Zone Blend',
    'Arka Plan Akış Çarpanı': 'Background Flow Multiplier',
    'Vuruş ve Işık Patlaması': 'Beat and Light Flash',
    'Patlamayı Tetikleyen Bant': 'Flash Trigger Band',
    'Orta Frekans': 'Mid', 'Genel Ses Seviyesi': 'Overall Level', 'En Güçlü Frekansı Otomatik Seç': 'Automatically Select Strongest Band',
    'Patlama Eşiği': 'Flash Threshold', 'Patlama Gücü': 'Flash Strength', 'Patlama Sönümleme': 'Flash Decay',
    'Dalga Hareketi': 'Wave Motion', 'Dalga Yönü': 'Wave Direction',
    'İleri': 'Forward', 'Geri': 'Reverse', 'Her Vuruşta Yön Değiştir': 'Alternate Direction on Every Beat',
    'Dalga Hızı': 'Wave Speed', 'Dalga Genişliği': 'Wave Width',
    'Arka Plan Karışım Oranı': 'Background Mix',
    'Aygıtlar Arası Akış Hızı': 'Cross-Device Flow Speed', 'Sesle Akış Hızlanması': 'Audio Flow Acceleration',
    'Rainbow Işık Akışı': 'Rainbow Light Flow',
    'Gökkuşağı renklerini sıralı veya tüm LED’lerde tek ton olarak dolaştırır.': 'Moves rainbow colors sequentially or as one shared tone across all LEDs.',
    'Bant Tepki Profili': 'Band Response Profile',
    'Anlık / Katı': 'Instant / Hard', 'Vuruşlu / Sert': 'Punchy / Hard', 'Yumuşak / Akıcı': 'Smooth / Fluid',
    'Bant Saldırı Hızı': 'Band Attack Speed', 'Bant Bırakma Hızı': 'Band Release Speed',
    'Bant Gürültü Eşiği': 'Band Noise Threshold', 'Bant Sertliği': 'Band Hardness', 'Bant Ayrıştırma': 'Band Separation',
    'Bant LED Deseni': 'Band LED Pattern',
    "LED'lerde Sırayla Bas · Mid · Tiz": 'Alternate Bass · Mid · Treble Across LEDs',
    'Merkezden Aynalı Dağılım': 'Mirrored from the Center',
    "En Güçlü Bant Tüm LED'lerde": 'Strongest Band on All LEDs',
    'Rainbow Ayarları': 'Rainbow Settings', 'Rainbow Dağıtımı': 'Rainbow Distribution',
    "LED'lerde Sıralı Gökkuşağı": 'Sequential Rainbow Across LEDs', "Tüm LED'lerde Aynı Ton": 'Same Tone on All LEDs',
    'Parlaklığa Tepki Veren Ses': 'Audio Source for Brightness', 'En Güçlü Frekans': 'Strongest Frequency',
    'Rainbow Akış Hızı': 'Rainbow Flow Speed', 'Rainbow Renk Yayılımı': 'Rainbow Color Spread',
    'Rainbow Taban Parlaklığı': 'Rainbow Base Brightness', 'Sese Göre Parlaklık Gücü': 'Audio Brightness Strength',
    'Eşik Tetiklemeli Arka Plan Patlaması': 'Threshold-Triggered Background Burst',
    'Yalnızca seçilen ses kaynağı eşiği geçtiğinde arka planın gerçek anlık rengiyle ışık darbesi üretir.': 'Produces a light burst using the real current background color only when the selected audio source crosses the threshold.',
    'Eşik Tetiklemeli Patlama Ayarları': 'Threshold-Triggered Burst Settings',
    'İzlenecek Tek Ses Kaynağı': 'Single Audio Source to Monitor',
    'Eşik Üstü Davranış': 'Above-Threshold Behavior',
    'Yalnızca Darbe / Patlama': 'Pulse / Burst Only',
    'Eşik Üstünde Orantılı Parlama': 'Proportional Glow Above Threshold',
    'Darbe + Orantılı Parlama': 'Pulse + Proportional Glow',
    'Tetikleme Eşiği': 'Trigger Threshold',
    'Eşik Üstü Patlama Gücü': 'Above-Threshold Burst Strength',
    'Eşik Altı Taban Işığı': 'Below-Threshold Base Light',
    'Darbeler Arası Süre (ms)': 'Time Between Bursts (ms)',
    'Arka Plan Renk Eşleme': 'Background Color Mapping',
    'Seçilen Frekans Bölgesinin Rengi': 'Selected Frequency Region Color',
    'Arka Plan Merkez Rengi': 'Background Center Color',
    "Arka Plan Renklerini LED'lere Yay": 'Spread Background Colors Across LEDs',
    'Seçilen kaynak eşik altında kaldığında yalnızca taban ışığı görünür. Eşik aşıldığında, aşma miktarı patlamanın parlaklığını ve beyaz vurgu oranını belirler.': 'Only the base light is shown while the selected source stays below the threshold. Once crossed, the amount above the threshold controls burst brightness and white highlight intensity.',
    'Renk şablonları hariç tüm uygulama ayarlarını tek JSON dosyasında taşıyın.': 'Move all application settings except color presets in a single JSON file.',
    'Ses, görünüm, Dynamic Lighting, performans, logo, görsel nesneler ve video dışa aktarma ayarlarını JSON dosyasına kaydeder. Renk şablonlarınız ve sahneleriniz dosyaya dahil edilmez ve içe aktarma sırasında korunur; onların kendi dışa aktarma düğmeleri vardır.': 'Saves audio, appearance, Dynamic Lighting, performance, logo, visual objects, and video export settings to a JSON file. Your color presets and scenes are excluded and preserved during import; they have their own export buttons.',
    'Mevcut ayarlar yedekteki değerlerle değiştirilecek. Renk şablonlarınız ve sahneleriniz korunacak. Devam edilsin mi?': 'Current settings will be replaced with the values in the backup. Your color presets and scenes will be preserved. Continue?',
    'Ayarlar başarıyla içe aktarıldı. Renk şablonlarınız ve sahneleriniz değiştirilmedi.': 'Settings imported successfully. Your color presets and scenes were left unchanged.',
    'Tüm Ayarları Dışa Aktar': 'Export All Settings', 'Ayarları İçe Aktar': 'Import Settings',
    'Ses, görünüm, Dynamic Lighting, performans, logo, görsel nesneler ve video dışa aktarma ayarlarını JSON dosyasına kaydeder. Kullanıcı renk şablonları dosyaya dahil edilmez ve içe aktarma sırasında korunur.': 'Saves audio, appearance, Dynamic Lighting, performance, logo, visual objects, and video export settings to a JSON file. User color presets are excluded and preserved during import.',
    'Dışa Aktarma Render': 'Export Renderer',

    // ---- Yeni arkaplan modları ----

    // ---- Uygulama içi onay / bildirim ----
    'Emin misiniz?': 'Are you sure?',
    'Vazgeç': 'Cancel',
    'Evet, devam et': 'Yes, continue',
    'Kategoriyi sıfırla': 'Reset category',
    'Hepsini sıfırla': 'Reset everything',
    'İçe aktar': 'Import',
    'Bu kategorideki tüm ayarlar varsayılana dönecek.': 'All settings in this category will return to their defaults.',
    'Tüm ayarlar varsayılana dönecek. Renk şablonlarınız ve sahneleriniz korunur.': 'All settings will return to their defaults. Your color presets and scenes are preserved.',
    'Bu sahne silinecek.': 'This scene will be deleted.',
    'Bu renk şablonu silinecek.': 'This color preset will be deleted.',
    'Mevcut ayarlar yedekteki değerlerle değiştirilecek. Renk şablonlarınız ve sahneleriniz korunacak.': 'Current settings will be replaced with the values in the backup. Your color presets and scenes will be preserved.',
    'Bu ayarı varsayılana döndür': 'Reset this setting to its default',

    // ---- Ayarlar penceresi anahtarları ----
    'Görselleştirmeyi Her Zaman Üstte Tut': 'Keep Visualization Always on Top',
    'Başka bir uygulama öne çıksa bile görselleştirme ekranı üstte kalır.': 'The visualization screen stays on top even when another application comes to the foreground.',
    'Görselleştirme artık her zaman üstte kalacak.': 'The visualization will now stay always on top.',
    'Her zaman üstte kapatıldı.': 'Always on top turned off.',
    'Kaza Koruması': 'Accidental-Close Protection',
    'Görselleştirme penceresi beklenmedik biçimde kapanırsa (çökme, Alt+F4) anında geri açılır. Panelden ya da ESC ile kapatmak her zaman çalışır.': 'If the visualizer window closes unexpectedly (a crash, Alt+F4) it reopens immediately. Closing from the panel or with Esc always works.',
    'ESC ile Kapatmayı Devre Dışı Bırak': 'Disable Closing with Esc',
    'Yalnızca Kaza Koruması açıkken çalışır. Bu haldeyken görselleştirme ancak paneldeki “Kapat” düğmesiyle ya da pencere odaktayken Ctrl+Shift+Q (veya Ctrl+Alt+Shift+Q) ile kapanır.': 'Only applies while Accidental-Close Protection is on. The visualizer then closes only from the panel’s Close button, or with Ctrl+Shift+Q (or Ctrl+Alt+Shift+Q) while the window has focus.',
    'Yalnızca Kaza Koruması açıkken çalışır. Bu haldeyken görselleştirme ancak paneldeki “Kapat” düğmesiyle ya da pencere odaktayken Ctrl+Alt+Shift+Esc ile kapanır.': 'Only applies while Accidental-Close Protection is on. The visualizer then closes only from the panel’s Close button, or with Ctrl+Alt+Shift+Esc while the window has focus.',
    'Kaza koruması açık — kapanan görselleştirme penceresi geri açılır.': 'Accidental-close protection is on — a closed visualizer window will reopen.',
    'Kaza koruması kapatıldı.': 'Accidental-close protection turned off.',
    'ESC artık kapatmıyor. Kapatmak için paneldeki Kapat düğmesini ya da Ctrl+Shift+Q kullanın.': 'Esc no longer closes. Use the panel’s Close button or Ctrl+Shift+Q instead.',
    'ESC artık kapatmıyor. Kapatmak için paneldeki Kapat düğmesini ya da Ctrl+Alt+Shift+Esc kullanın.': 'Esc no longer closes. Use the panel’s Close button or Ctrl+Alt+Shift+Esc instead.',
    'ESC ile kapatma yeniden açık.': 'Closing with Esc is enabled again.',
    'ESC kapatma kapalı. Kapatmak için Kapat düğmesini ya da Ctrl+Shift+Q kullanın.': 'Closing with Esc is off. Use the Close button or Ctrl+Shift+Q.',
    'ESC kapatma kapalı. Kapatmak için Kapat düğmesini ya da Ctrl+Alt+Shift+Esc kullanın.': 'Closing with Esc is off. Use the Close button or Ctrl+Alt+Shift+Esc.',
    'Görselleştirme penceresi beklenmedik biçimde kapandı, kaza koruması geri açtı.': 'The visualizer window closed unexpectedly; accidental-close protection reopened it.',
    'Görselleştirme penceresi sürekli kapanıyor; kaza koruması geri açmayı bıraktı.': 'The visualizer window keeps closing; accidental-close protection has stopped reopening it.',
    'Yanlışlıkla Kapatmayı Önle': 'Prevent Accidental Close',
    'Görselleştirici açıkken uygulamanın yanlışlıkla kapatılmasını engeller; çıkışta onay ister.': 'Prevents the application from accidentally closing while the visualizer is active; asks for confirmation before exiting.',
    'Yanlışlıkla kapatma koruması açık — görselleştirici açıkken onay istenir.': 'Accidental-close protection is on — confirmation will be requested while the visualizer is active.',
    'Yanlışlıkla kapatma koruması kapatıldı.': 'Accidental-close protection turned off.',
    'Görselleştirici açıkken uygulamayı kapatmak istediğinizden emin misiniz?': 'Are you sure you want to close the application while the visualizer is active?',
    'Görselleştirici ekranları ve yönetici paneli sonlandırılacak.': 'Visualizer displays and the admin panel will be closed.',
    'Uygulamayı Kapat': 'Close Application',
    'İptal': 'Cancel',
    'Zaman Çizelgesi': 'Timeline',
    'Sahneleri ve ayar değişimlerini zamana yayın. Ölçüye ya da saniyeye hizalı planlayın; oynatma kafası tüm ekranları birlikte sürer.': 'Lay scenes and setting changes out along time. Plan to the bar or to the second; the playhead drives every screen together.',
    'Klip Destesi': 'Clip Deck',
    'Sahneleri, şablonları ve medyayı bir ızgaraya yerleştirip vuruşa hizalı ateşleyin. Sütun başlatmak satırın tamamını sahne gibi çalıştırır.': 'Place scenes, templates and media on a grid and fire them on the beat. Launching a column runs the whole row as a scene.',
    'Zaman Çizelgesini Etkinleştir': 'Enable Timeline',
    'Zaman çizelgesi kapalı. Açtığınızda oynatma kafası tüm görselleştirici ekranlarını birlikte sürer.': 'The timeline is off. Turn it on and the playhead drives every visualizer screen together.',
    'Klip Destesini Etkinleştir': 'Enable Clip Deck',
    'Klip destesi kapalı. Açtığınızda vuruş ızgarası sürekli akar ve yuvalar ölçüye hizalı ateşlenir.': 'The clip deck is off. Turn it on and the beat grid runs continuously, firing slots aligned to the bar.',
    'Oynat': 'Play',
    'Duraklat': 'Pause',
    'Durdur ve başa dön': 'Stop and return to start',
    'Önceki işaret': 'Previous marker',
    'Sonraki işaret': 'Next marker',
    'Tempo (BPM)': 'Tempo (BPM)',
    'Yakalama': 'Snapping',
    'Cetvel': 'Ruler',
    'Süre ve Ölçü': 'Time and Bars',
    'Yalnızca Süre': 'Time Only',
    'Yalnızca Ölçü': 'Bars Only',
    'Yarım Vuruş': 'Half Beat',
    'Çeyrek Vuruş': 'Quarter Beat',
    'Döngü Bölgesi': 'Loop Region',
    'Döngü Başı / Sonu': 'Loop Start / End',
    'Kafadan Başlat': 'Start at Playhead',
    'Klip': 'Clip',
    'Otomasyon': 'Automation',
    'Kilitle': 'Lock',
    'Parçayı sil': 'Delete track',
    'Bu parça ve içindeki her şey silinecek.': 'This track and everything on it will be deleted.',
    'Klip Parçası': 'Clip Track',
    'Otomasyon Parçası': 'Automation Track',
    'ör. postfx.0.params.strength': 'e.g. postfx.0.params.strength',
    'Parça': 'Track',
    'Bir klip ya da anahtar kare seçin.': 'Select a clip or a keyframe.',
    'Klip Adı': 'Clip Name',
    'Kaynak Kimliği': 'Source Id',
    'Başlangıç (sn)': 'Start (s)',
    'Süre (sn)': 'Duration (s)',
    'Kırpma Başı (sn)': 'Trim In (s)',
    'Klibi Sil': 'Delete Clip',
    'Kafada Yeni Klip': 'New Clip at Playhead',
    'Zaman (sn)': 'Time (s)',
    'Değer (0..1)': 'Value (0..1)',
    'Segment Eğrisi': 'Segment Curve',
    'Anahtarı Sil': 'Delete Keyframe',
    'Üstel (küp)': 'Exponential (cubic)',
    'İşaret adı': 'Marker name',
    'Bu işarete git': 'Jump to this marker',
    'Kafada İşaret': 'Marker at Playhead',
    'Sözlerden İşaret Üret': 'Create Markers from Lyrics',
    'Önce Metin bölümünden bir LRC ya da SRT dosyası yükleyin.': 'Load an LRC or SRT file from the Text section first.',
    'Bu sütunu durdur': 'Stop this column',
    'Satırın tamamını sahne gibi başlat': 'Launch the whole row as a scene',
    'Hepsini Durdur': 'Stop Everything',
    'Izgara Boyutu': 'Grid Size',
    'Deste Etkinliğini Çizelgeye Kaydet': 'Record Deck Activity to the Timeline',
    'Kayıt kapatıldığında ateşlenen yuvalar zaman çizelgesine parça olarak eklenir; doğaçlanan set düzenlenebilir hale gelir.': 'When recording is turned off, the slots that fired are added to the timeline as tracks, turning an improvised set into an editable one.',
    'Niceleme': 'Quantisation',
    'Kapalı (anında)': 'Off (immediate)',
    'Bir Sonraki Kare': 'Next Frame',
    'İki Ölçü': 'Two Bars',
    'Dört Ölçü': 'Four Bars',
    'Tetikleme': 'Trigger',
    'Geçişle': 'Fade',
    'Geçiş Süresi (sn)': 'Fade Time (s)',
    'Geçiş Türü': 'Transition Type',
    'Süre (sn, boş = süresiz)': 'Duration (s, blank = open-ended)',
    'Takip Eylemi': 'Follow Action',
    'Yok (yerinde kal)': 'None (stay put)',
    'Dur': 'Stop',
    'Baştan Çal': 'Loop',
    'Sonraki Yuva': 'Next Slot',
    'Sütunda Rastgele': 'Random in Column',
    'Belirli Yuvaya Git': 'Go to Slot',
    'Yuvayı Boşalt': 'Clear Slot',
    'Satır Adı': 'Row Name',
    // Klip destesi performans yüzeyi (#637)
    'Genel (destenin)': 'Global (the deck’s)',
    'Sütun adı — bir sütunda aynı anda tek yuva çalar': 'Column name — one slot plays per column at a time',
    'tıkla: ateşle · Shift+tıkla: düzenle': 'click: fire · Shift+click: edit',
    'Boş yuva — eklemek için tıklayın': 'Empty slot — click to add',
    'Genel niceleme: "Genel" seçili yuvalar bu ızgaraya hizalı ateşlenir': 'Global quantise: slots set to “Global” fire on this grid',
    'Tam ekran, büyük hedefler, klavyeyle': 'Full screen, large targets, keyboard driven',
    'Ölçü.vuruş': 'Bar.beat',
    'Genel ayar (Geçiş kartı)': 'Global setting (Transition card)',
    'Boş bir yuvaya tıklayıp ekleyin. Dolu yuvaya tıklamak ateşler; düzenlemek için Shift ile ya da sağ tıklayın.': 'Click an empty slot to add one. Clicking a filled slot fires it; Shift-click or right-click to edit.',
    'Boş yuva': 'Empty slot',
    'Bu türde bir yuva oluştur': 'Create a slot of this type',
    'Ateşle': 'Fire',
    'Bu yuvayı nicelemesine göre ateşle': 'Fire this slot on its quantise grid',
    'Sütunu Durdur': 'Stop Column',
    'Bu sütunda çalan yuvayı durdur': 'Stop the slot playing in this column',
    'Yuvayı sil': 'Delete the slot',
    'Rengi türden al': 'Take the colour from the type',
    'Takip eylemi süre dolunca çalışır; bu yuvanın süresi yok. Bir süre girin.': 'Follow actions run when the duration ends, and this slot has none. Enter a duration.',
    'Hedef Yuva': 'Target Slot',
    // Klip destesi CD-2: ateşleme kipleri, klavye, birden çok deste (#637)
    'Klavye: 1-9 satır seçer, A-P o satırın yuvasını ateşler, Enter satırı başlatır': 'Keyboard: 1-9 selects a row, A-P fires that row’s slot, Enter launches the row',
    'Bu destede çalan yuva var': 'A slot is playing in this deck',
    'Desteyi göster': 'Show this deck',
    'Yeni deste': 'New deck',
    'Ateşleme Kipi': 'Launch Mode',
    'Tetik (her basış ateşler)': 'Trigger (every press fires)',
    'Aç / Kapa (ikinci basış durdurur)': 'Toggle (a second press stops)',
    'Kapı (basılı tuttukça çalar)': 'Gate (plays while held)',
    'Deste, ızgara ve kayıt': 'Deck, grid and recording',
    'Deste Adı': 'Deck Name',
    'Desteyi Çoğalt': 'Duplicate Deck',
    'Bu destenin kopyası: aynı yuvalar, yeni bir sekmede': 'A copy of this deck: the same slots, in a new tab',
    'Desteyi Sil': 'Delete Deck',
    'Bu desteyi ve yuvalarını sil': 'Delete this deck and its slots',
    'Deste silinsin mi?': 'Delete the deck?',
    // Güncellemeler kartı (#640)
    'Güncellemeler': 'Updates',
    'Yeni sürümleri denetle ve kurulum türüne göre nasıl güncelleneceğini gör.': 'Check for new releases and see how to update this kind of install.',
    'Güncellemeleri Denetle': 'Check for Updates',
    'Açık — yeni sürümü haber ver': 'On — tell me about a new release',
    'Windows kurulumu': 'Windows installer',
    'Windows taşınabilir': 'Windows portable',
    'Linux AppImage': 'Linux AppImage',
    'Linux .deb paketi': 'Linux .deb package',
    'Geliştirme kopyası': 'Development copy',
    'Kurulum dosyasını indirip çalıştırın; ayarlarınız korunur.': 'Download the installer and run it; your settings are kept.',
    'Taşınabilir kopya kendini güncelleyemez: yeni exe dosyasını indirip eskisinin yerine koyun.': 'A portable copy cannot update itself: download the new exe and put it in place of the old one.',
    'Yeni AppImage dosyasını indirip eskisinin yerine koyun ve çalıştırılabilir yapın.': 'Download the new AppImage, put it in place of the old one and make it executable.',
    'Yeni .deb paketini indirip kurun (ör. sudo apt install ./dosya.deb).': 'Download the new .deb package and install it (e.g. sudo apt install ./file.deb).',
    'Uygulama imzasız olduğu için macOS uygulama içi güncellemeye izin vermiyor; yeni dmg dosyasını indirin.': 'The app is not signed, so macOS does not allow in-app updates; download the new dmg.',
    'Geliştirme kopyası: yalnız denetim yapılır; otomatik denetim kapalı.': 'Development copy: checking only; automatic checks are off.',
    'Henüz denetlenmedi.': 'Not checked yet.',
    'Otomatik denetim bu kopyada kapalı; elle denetleyebilirsiniz.': 'Automatic checks are off in this copy; you can check by hand.',
    'Denetleniyor…': 'Checking…',
    'Güncel: en yeni sürüm kurulu.': 'Up to date: the latest release is installed.',
    'Yeni sürüm var (atlandı).': 'A new release is available (skipped).',
    'Yeni sürüm var.': 'A new release is available.',
    'Denetlenemedi. İnternet bağlantısını kontrol edip yeniden deneyin.': 'Could not check. Check the internet connection and try again.',
    'Yeni sürüm:': 'New release:',
    'Dil, pencere koruması ve genişletilmiş aralıklar.': 'Language, window protection and extended ranges.',
    'Pencere': 'Window',
    'Dil, pencere koruması, genişletilmiş aralıklar ve güncellemeler.': 'Language, window protection, extended ranges and updates.',
    'Dil, görselleştirici penceresi ve panel davranışı.': 'Language, visualizer window and panel behaviour.',
    'Uygulama': 'Application',
    'Kurulu Sürüm': 'Installed Version',
    'Kurulum Türü': 'Install Type',
    'Şimdi Denetle': 'Check Now',
    'GitHub sürümlerine bir kez sorar': 'Asks GitHub Releases once',
    'En Yeni Sürüm': 'Latest Version',
    'İndir': 'Download',
    'Sürüm Sayfası': 'Release Page',
    'Sürüm notları ve tüm dosyalar': 'Release notes and all files',
    'Bu Sürümü Atla': 'Skip This Version',
    'Bu sürüm için bir daha bildirim gösterme': 'Don’t notify me about this version again',
    'Bu sistem için hazır bir dosya bulunamadı; sürüm sayfasından uygun olanı seçin.': 'No ready file was found for this system; pick the right one on the release page.',
    'Sürüm Notları': 'Release Notes',
    'Denetim yalnız GitHub Releases sayfasına tek bir istektir; kimlik ya da kullanım bilgisi gönderilmez.': 'A check is a single request to GitHub Releases; no identifiers or usage data are sent.',
    // Güncelleme: indir, doğrula, kur (#640)
    'İndiriliyor…': 'Downloading…',
    'İndirildi ve doğrulandı. Kurmak için uygulama kapanıp yeniden açılacak.': 'Downloaded and verified. The app will close and reopen to install it.',
    'Yeni sürüm yerine kondu; yeniden başlatınca açılır.': 'The new version is in place; it opens after a restart.',
    'Kur ve Yeniden Başlat': 'Install and Restart',
    'Yeniden Başlat': 'Restart',
    'Uygulama kapanır; yeni sürüm açılır': 'The app closes; the new version opens',
    'Kurulum başlatılamadı; sürüm sayfasından indirin.': 'The installer could not be started; download it from the release page.',
    'İndir ve Kur': 'Download and Install',
    'SHA-256 ile doğrulanır': 'verified with SHA-256',
    'İndirme başarısız:': 'Download failed:',
    'Otomatik — indir ve kapanırken kur': 'Automatic — download, install on exit',
    // Klip destesi CD-3: medya yuvaları (#637)
    'Medya (ana)': 'Media (main)',
    'Görselleştirici (ana)': 'Visualizer (main)',
    'Arkaplan (ana)': 'Background (main)',
    'Nesne': 'Object',
    'Henüz Studio preseti yok. Studio bölümünden bir shader preseti oluşturun.': 'No Studio presets yet. Create a shader preset in the Studio section.',
    'Görsel Seç': 'Choose Image',
    'Tür seçin; sonra kaynağını seçin. Video, görsel ve shader yuvaları bir hedefe uygulanır (ana medya, bir katman ya da bir görsel nesne).': 'Pick a type, then its source. Video, image and shader slots apply to a target (the main media, a layer or an image object).',
    'Eylem, MIDI ve OSC eşlemelerindeki eylemin aynısını çalıştırır. Geçiş ayarları eylemde kullanılmaz.': 'An action runs the same action as a MIDI or OSC mapping. Transition settings do not apply to actions.',
    'Görsel yuvası bir görsel nesnenin resmini değiştirir; henüz nesne yok. Sahne › Görsel Nesneler bölümünden bir nesne ekleyin.': 'An image slot replaces the picture of an image object, and there are none yet. Add one in Scene › Visual Objects.',
    'Bu tür için uygun hedef yok.': 'There is no suitable target for this type.',
    // Arkaplanların kendi ayarları (#638)
    'Damla Sayısı': 'Drop Count',
    'Akışkanlık': 'Fluidity',
    'Bulut Sayısı': 'Cloud Count',
    'Bulut Boyutu': 'Cloud Size',
    'Sürüklenme': 'Drift',
    'Hücre Aralığı': 'Cell Spacing',
    'Merkez Dalgası': 'Centre Wave',
    'Hücre Sayısı': 'Cell Count',
    'Düzensizlik': 'Irregularity',
    'Kenar Kalınlığı': 'Border Width',
    'İlerleme Hızı': 'Travel Speed',
    'Kenar Sayısı (0 = daire)': 'Sides (0 = circle)',
    'Kol Sayısı': 'Arm Count',
    'Tur Sayısı': 'Turns',
    'İncelme': 'Taper',
    'Parçacık Sayısı': 'Particle Count',
    'Bina Sayısı': 'Building Count',
    'Bina Yüksekliği': 'Building Height',
    'Pencere Yoğunluğu': 'Window Density',
    'Gökyüzü Parlaması': 'Sky Glow',
    'Katman Kayması': 'Layer Parallax',
    'Bant Sayısı': 'Band Count',
    'Desen Ölçeği': 'Pattern Scale',
    'Şerit Sayısı': 'Ribbon Count',
    'Şerit Genişliği': 'Ribbon Width',
    'Çizgi Sayısı': 'Line Count',
    'Satır Sayısı': 'Row Count',
    'Yükselme Hızı': 'Rise Speed',
    'Işıma': 'Glow',
    'Tane Boyutu': 'Grain Size',
    'Cam Sayısı': 'Pane Count',
    'Kurşun Çizgi': 'Lead Lines',
    'Hat Sayısı': 'Trace Count',
    'Sinyal Boyutu': 'Signal Size',
    'Hat Kalınlığı': 'Trace Width',
    'Bağlantılar': 'Links',
    'Kenar Sayısı': 'Sides',
    // Yeni modlar ve arkaplanlar, paket 1 (#638)
    'Sırt Çizgileri': 'Ridgelines',
    'Radar Grafiği': 'Radar Chart',
    'Sarkaç Dalgası': 'Pendulum Wave',
    'VU Metre': 'VU Meter',
    'Damla Boyutu': 'Blob Size',
    'Alçak Poligon': 'Low Poly',
    'Kıpırtı': 'Shimmer',
    'Nokta Sıklığı': 'Dot Density',
    'Izgara Açısı': 'Grid Angle',
    'Karşıtlık': 'Contrast',
    'Bulut Örtüsü': 'Cloud Cover',
    'Sahne Işıkları': 'Stage Lights',
    'Hüzme Sayısı': 'Beam Count',
    'Hüzme Genişliği': 'Beam Width',
    'Süpürme': 'Sweep',
    'Konfeti': 'Confetti',
    'Bulutlar': 'Clouds',
    'Yüzey Kabartması': 'Surface Relief',
    // Yeni modlar ve arkaplanlar, paket 2 (#638)
    'DJ Dalga Formu': 'DJ Waveform',
    'Kardioid': 'Cardioid',
    'Vuruş Pedleri': 'Beat Pads',
    'Zıplayan Toplar': 'Bouncing Balls',
    'Seviye Ölçer (PPM)': 'Level Meter (PPM)',
    'Su Altı': 'Underwater',
    'Işık Hüzmesi': 'Light Shafts',
    'Kabarcık Sayısı': 'Bubble Count',
    'İzometrik Küpler': 'Isometric Cubes',
    'Küp Boyutu': 'Cube Size',
    'Ateş Böcekleri': 'Fireflies',
    'Böcek Sayısı': 'Firefly Count',
    'Vuruşla Eşleşme': 'Beat Sync',
    'Fırtına': 'Storm',
    'Şimşek Parlaklığı': 'Lightning Brightness',
    'Ayna Deseni': 'Mirror Pattern',
    'Satır adı': 'Row name',
    'ör. sahne kimliği': 'e.g. scene id',
    'Video': 'Video',
    'Shader': 'Shader',
    'Eylem': 'Action',
    'Takip eylemi zinciri çok hızlı; ateşleme sınırlandı. Klip sürelerini kontrol edin.': 'The follow-action chain is running too fast; firing was capped. Check the clip durations.',
    'Performans Görünümü': 'Performance View',
    'Karart': 'Blackout',
    'Satır seçmek için 1-9, yuva ateşlemek için A-P, satırı başlatmak için Enter, çıkmak için Esc.': '1-9 selects a row, A-P fires a slot, Enter launches the row, Esc leaves.',
    'Renk Şablonu': 'Colour Preset',
    '— seçin —': '— select —',
    'dosya yolu ya da kimlik': 'file path or id',
    'Henüz kayıtlı sahne yok. Sahne bölümünden bir sahne kaydedin.': 'No scenes saved yet. Save one from the Scene section.',
    'Henüz renk şablonu yok.': 'No colour presets yet.',
    'Bu tür için seçilebilir bir kaynak yok.': 'There is nothing to pick for this type.',
    'Otomatik VJ de sahne değiştiriyor. İkisi aynı anda açıkken sahneyi birbirlerinin elinden alır; birini kapatmanız ya da Otomatik VJ kaynağını Renk Şablonları yapmanız daha öngörülebilir olur.': 'Auto VJ changes scenes too. With both running they take the scene from each other; turning one off, or setting Auto VJ\'s source to Colour Presets, is more predictable.',
    'Bu yuvanın kaynağı seçilmemiş. Aşağıdaki Kaynak listesinden bir sahne, şablon ya da renk şablonu seçin.': 'This slot has no source. Pick a scene, template or colour preset from the Source list below.',
    'Kaynağı seçilmemiş — tıklayıp seçin': 'No source — click to pick one',
    'Oynatma Kafasını Takip Et': 'Follow the Playhead',
    'Başı Kafaya Al': 'Set Start to Playhead',
    'Sonu Kafaya Al': 'Set End to Playhead',
    // Zaman çizelgesi TL-2: çoklu seçim, döngü ayracı, geçiş tutamacı, tam pencere (#636)
    'Ctrl/Shift+tık': 'Ctrl/Shift+click',
    'Klibi seçime ekle / çıkar': 'Add the clip to / remove it from the selection',
    'Boş şeritte sürükle': 'Drag on an empty lane',
    'Kutu seçimi': 'Box select',
    'Ctrl+A': 'Ctrl+A',
    'Tüm klipleri seç': 'Select all clips',
    'Shift+cetvelde sürükle': 'Shift+drag on the ruler',
    'Döngü bölgesi çiz; ayracın kenarları ve ortası sürüklenir': 'Draw a loop region; drag the brace’s edges or middle',
    'Klibin sol üst köşesi': 'Top-left corner of a clip',
    'Geçiş süresini sürükle': 'Drag the transition length',
    'F / Esc': 'F / Esc',
    'Tam pencere aç / kapat': 'Open / close full window',
    'Tam pencere (F). Esc ile kapanır': 'Full window (F). Esc closes it',
    'klip seçili': 'clips selected',
    'Renk (hepsi)': 'Colour (all)',
    'Geçiş (sn, hepsi)': 'Transition (s, all)',
    'Grubu hemen ardına çoğalt (Ctrl+D)': 'Duplicate the group right after itself (Ctrl+D)',
    'Grubu panoya al (Ctrl+C); Ctrl+V kafaya yapıştırır': 'Copy the group (Ctrl+C); Ctrl+V pastes it at the playhead',
    'Seçimi Bırak': 'Clear Selection',
    'Tek seçime dön': 'Back to a single selection',
    'Seçili klipleri sil (Del)': 'Delete the selected clips (Del)',
    'Geçiş (sn, 0 = genel)': 'Transition (s, 0 = global)',
    // Zaman çizelgesi düzenleyicisi (#636)
    '1) “Klip Parçası” ekleyin. 2) Şeride çift tıklayın ya da “Kafada Klip” ile oynatma kafasına klip koyun. 3) Klibe tıklayıp hangi sahneyi çalacağını seçin.': '1) Add a “Clip Track”. 2) Double-click its lane, or use “Clip at Playhead”, to place a clip. 3) Click the clip and choose which scene it plays.',
    'Parça boş. Şeride çift tıklayın ya da “Kafada Klip” ile oynatma kafasına klip koyun; sonra klibe tıklayıp sahnesini seçin.': 'This track is empty. Double-click its lane, or use “Clip at Playhead”, then click the clip and choose its scene.',
    'kaynak yok': 'no source',
    'hedef seçilmedi': 'no target',
    'anahtar': 'key',
    'Oynat / duraklat': 'Play / pause',
    'Home / End': 'Home / End',
    'Başa / sona': 'To start / to end',
    'Seçili klibi ya da kafayı bir ızgara adımı kaydır (Alt: bir kare)': 'Move the selected clip, or the playhead, one grid step (Alt: one frame)',
    'Ctrl+Z / Ctrl+Y': 'Ctrl+Z / Ctrl+Y',
    'Geri al / yinele': 'Undo / redo',
    'Ctrl+D': 'Ctrl+D',
    'Çoğalt': 'Duplicate',
    'Oynatma kafasında böl': 'Split at the playhead',
    'Ctrl+C / Ctrl+V': 'Ctrl+C / Ctrl+V',
    'Kopyala / kafaya yapıştır': 'Copy / paste at the playhead',
    'Yakınlaştır / uzaklaştır / hepsini sığdır': 'Zoom in / zoom out / fit all',
    'Kafada işaret': 'Marker at the playhead',
    'Döngü aç / kapat': 'Loop on / off',
    'Zaman çizelgesi düzenleyicisi': 'Timeline editor',
    'Sahne, şablon ya da renk klipleri için bir parça': 'A track for scene, template or colour clips',
    'Bir ayarı zamana yayan eğri': 'A curve that moves a setting over time',
    'Kafada Klip': 'Clip at Playhead',
    'Oynatma kafasının bulunduğu yere, seçili (ya da ilk) klip parçasına': 'At the playhead, on the selected (or first) clip track',
    'Parça kilitli.': 'The track is locked.',
    'Oynatma kafasına adlandırılmış bir işaret (M)': 'A named marker at the playhead (M)',
    'Oynat / duraklat (Boşluk)': 'Play / pause (Space)',
    'Döngü (L). Bölge yoksa seçili klibin aralığı ya da kafadan dört ölçü': 'Loop (L). With no region yet, uses the selected clip’s range or four bars from the playhead',
    'Oynatırken kafayı takip et': 'Follow the playhead while playing',
    'Geri al (Ctrl+Z)': 'Undo (Ctrl+Z)',
    'Yinele (Ctrl+Y)': 'Redo (Ctrl+Y)',
    'Süre · ölçü.vuruş': 'Time · bar.beat',
    'Yakalama. Sürüklerken Alt tuşu yakalamayı geçici olarak kapatır': 'Snap. Hold Alt while dragging to suspend it',
    'Uzaklaştır (−)': 'Zoom out (−)',
    'Yakınlaştır (+)': 'Zoom in (+)',
    'Hepsini sığdır (0)': 'Fit all (0)',
    'Parçalar': 'Tracks',
    'Parça rengi': 'Track colour',
    'Klip parçası': 'Clip track',
    'Otomasyon parçası': 'Automation track',
    'Solo: yalnız solo parçalar çalar': 'Solo: only soloed tracks play',
    'Kilitle: taşınamaz, silinemez': 'Lock: cannot be moved or deleted',
    'Bir klip, anahtar kare ya da parça seçin. Kısayollar için düzenleyiciye tıklayın.': 'Select a clip, keyframe or track. Click the editor to use the shortcuts.',
    'Geçiş (sn)': 'Fade (s)',
    'Rengi parçadan / türden al': 'Take the colour from the track / type',
    'Tempo değişimi': 'Tempo change',
    'Oynatma kafasına tempo değişimi': 'Tempo change at the playhead',
    'Bu andan sonraki ölçüler bu tempoyla sayılır. Etiketi cetvelde sürükleyerek de taşıyabilirsiniz.': 'Bars from here on are counted at this tempo. You can also drag the tag on the ruler.',
    'Git': 'Go',
    'Oynatma kafasını buraya al': 'Move the playhead here',
    'Tempo değişimini sil (Del)': 'Delete the tempo change (Del)',
    'Şeritleri alçalt': 'Shorter lanes',
    'Şeritleri yükselt (tam pencerede yer açar)': 'Taller lanes (uses the room in full window)',
    'Oynatma kafasındaki tempo. Tempo değişimleri cetvelde (♩)': 'Tempo at the playhead. Tempo changes are on the ruler (♩)',
    'Görsel klibi bir görsel nesnenin resmini değiştirir; henüz nesne yok. Sahne › Görsel Nesneler bölümünden bir nesne ekleyin.': 'An Image clip replaces the picture of an image object, and there is none yet. Add one under Scene › Image Objects.',
    'Böl': 'Split',
    'Oynatma kafasında böl (S)': 'Split at the playhead (S)',
    'Oynatma kafası bu klibin içinde değil.': 'The playhead is not inside this clip.',
    'Hemen ardına bir kopya (Ctrl+D)': 'A copy right after it (Ctrl+D)',
    'Kopyala': 'Copy',
    'Panoya (Ctrl+C); Ctrl+V kafaya yapıştırır': 'To the clipboard (Ctrl+C); Ctrl+V pastes at the playhead',
    'Klip kopyalandı. Ctrl+V oynatma kafasına yapıştırır.': 'Clip copied. Ctrl+V pastes it at the playhead.',
    'Sil (Del)': 'Delete (Del)',
    'Parçanın Adı': 'Track Name',
    'Hedef Ayar': 'Target Setting',
    'En Az': 'Minimum',
    'En Çok': 'Maximum',
    'Yukarı': 'Up',
    'Parçayı yukarı taşı': 'Move the track up',
    'Aşağı': 'Down',
    'Parçayı aşağı taşı': 'Move the track down',
    'Bu parçaya, oynatma kafasına': 'On this track, at the playhead',
    'Parçayı Sil': 'Delete Track',
    'Parça ve içindeki her şey': 'The track and everything on it',
    'Klavye kısayolları': 'Keyboard shortcuts',
    'Döngü, işaretler ve cetvel': 'Loop, markers and ruler',
    'İşareti sil': 'Delete marker',
    'Döngü sonu başından büyük olmadığı için döngü çalışmıyor. “Sonu Kafaya Al” ile bir bitiş belirleyin.': 'The loop is not running because its end is not past its start. Use “Set End to Playhead” to give it one.',
    'Windows Dynamic Lighting bu sistemde yok': 'Windows Dynamic Lighting is not available on this system',
    'Ayarlarınızda açık görünüyor ama Windows Dynamic Lighting yalnızca Windows üzerinde çalışır. Bu sistemde RGB aygıtları için OpenRGB veya Art-Net/DMX kullanın.': 'Your settings have it switched on, but Windows Dynamic Lighting only runs on Windows. Use OpenRGB or Art-Net/DMX for RGB devices on this system.',
    'OpenRGB Çıkışı': 'OpenRGB Output',
    'sürülebilir aygıt': 'devices can be driven',
    'yalnız kendi efektini oynatıyor': 'play their own effects only',
    'Bağlanılamadı': 'Could not connect',
    'Bağlanılıyor…': 'Connecting…',
    'OpenRGB çalışmıyor gibi. 1) OpenRGB uygulamasını kurun ve çalıştırın. 2) İçinde Settings > General > Enable SDK Server seçeneğini işaretleyin. 3) Sunucu portu burada yazandan farklıysa aşağıdan düzeltin.': 'OpenRGB does not appear to be running. 1) Install and start the OpenRGB application. 2) Inside it, tick Settings > General > Enable SDK Server. 3) If its port differs from the one below, correct it here.',
    'OpenRGB indirme sayfası': 'OpenRGB download page',
    'Sunucu Adresi': 'Server Address',
    'Aşağıdaki görünüm ayarları Windows Dynamic Lighting ile ortaktır: iki çıkış da aynı rengi üretir.': 'The look settings below are shared with Windows Dynamic Lighting: both outputs produce the same colour.',
    'Işık Modu': 'Lighting Mode',
    'Aygıtlar': 'Devices',
    'Aygıtları Yenile': 'Refresh Devices',
    'Aygıt bulunamadı. OpenRGB içinde aygıtlarınız görünüyor mu?': 'No devices found. Do your devices appear inside OpenRGB itself?',
    'LED': 'LEDs',
    'anlık renk kabul etmiyor': 'does not accept direct colour',
    'Ayrı çalışan OpenRGB sunucusuna bağlanır ve RGB aygıtlarını müzikle sürer. Windows, macOS ve Linux.': 'Connects to a separately running OpenRGB server and drives RGB devices with the music. Windows, macOS and Linux.',
    'Alıcı uygulamada yukarıdaki kaynak adını seçin. Görüntü, ana ekranınızın yapılandırmasıyla üretilir; ekranlarda pencere açık olmasa bile yayın sürer.': 'Pick the source name above inside the receiving application. The picture is produced from the configuration of your primary display, and sending continues even with no window open on any screen.',
    'Açıldığında görüntü, aynı bilgisayardaki alıcı uygulamalara GPU üzerinden verilir: Resolume, OBS, TouchDesigner veya başka bir alıcı. Pencere yakalamaya, eklenti kurmaya ve CPU kopyasına gerek yok.': 'Once on, the picture is handed to receiving applications on this computer over the GPU: Resolume, OBS, TouchDesigner or any other receiver. No window capture, no plugin install and no CPU copy.',
    'Spout bir Windows, Syphon bir macOS teknolojisidir; bu sistemde ikisi de yok ve yerleşik bir eşdeğeri bulunmuyor. Görüntüyü başka bir uygulamaya vermek için Çıkış bölümündeki OBS tarayıcı kaynağını kullanın — o her platformda çalışır.': 'Spout is a Windows technology and Syphon a macOS one; neither exists on this system and there is no built-in equivalent. To send the picture to another application, use the OBS browser source under Output — that works on every platform.',
    'bu uygulama': 'this application',
    'Kaynak Adı': 'Source Name',
    'Hata': 'Error',
    'düşen': 'dropped',
    'hata': 'errors',
    'deyim derlendi': 'statements compiled',
    'kare': 'frames',
    'Syphon Çıkışı': 'Syphon Output',
    'Spout Çıkışı': 'Spout Output',
    'Görüntüyü aynı bilgisayardaki başka bir uygulamaya GPU üzerinden verir: Resolume, OBS, TouchDesigner. Pencere yakalama ve eklenti gerekmez.': 'Sends the picture to another application on the same computer over the GPU: Resolume, OBS, TouchDesigner. No window capture and no plugin needed.',
    'Spout / Syphon Çıkışı': 'Spout / Syphon Output',
    'Genişletilmiş Ayar Aralıkları': 'Extended Setting Ranges',
    'Kaydırıcıların üst sınırını 5 katına çıkarır; normalin çok üstünde değerler girebilirsiniz. Aşırı değerler performansı düşürebilir.': 'Raises the upper limit of the sliders 5×, letting you enter values far above the normal range. Extreme values may reduce performance.',
    'Genişletilmiş aralıklar açık — kaydırıcılar 5 kat daha yükseğe çıkabilir.': 'Extended ranges on — sliders can now go 5× higher.',
    'Genişletilmiş aralıklar kapatıldı. Mevcut yüksek değerler korunur.': 'Extended ranges turned off. Existing high values are kept.',

    // ---- Bildirimler ----
    'Dışa aktarılacak şablon yok.': 'There are no presets to export.',
    'Dışa aktarılacak sahne yok.': 'There are no scenes to export.',
    'Dosyada sahne bulunamadı.': 'No scenes found in the file.',
    'Bu dosya geçerli bir CAYADEV Visualizer ayar yedeği değil.': 'This file is not a valid CAYADEV Visualizer settings backup.',

    // ---- Ek arkaplan modları ----

    // ---- Arkaplan modlarına özel ayarlar ----
    'Mod Ayarları': 'Mode Settings',
    'Yıldız Sayısı': 'Star Count',
    'Yıldız Boyutu': 'Star Size',
    'Hız İzi': 'Motion Trail',
    'Parıldama': 'Twinkle',
    'Bas İtkisi': 'Bass Push',
    'Ufuk Yüksekliği': 'Horizon Height',
    'Yatay Çizgi Sayısı': 'Horizontal Lines',
    'Dikey Çizgi Sayısı': 'Vertical Lines',
    'Ufuk Parlaması': 'Horizon Glow',
    'Gökyüzü Yoğunluğu': 'Sky Intensity',
    'Spektrum Tepkisi': 'Spectrum Response',
    'Tepe Yüksekliği': 'Crest Height',
    'Dalga Sıklığı': 'Wave Frequency',
    'Işık Sayısı': 'Light Count',
    'Bas Nabzı': 'Bass Pulse',
    'Sütun Sayısı': 'Column Count',
    'Düşme Hızı': 'Fall Speed',
    'İz Uzunluğu': 'Trail Length',
    'Perde Sayısı': 'Curtain Count',
    'Dalgalanma': 'Undulation',
    'Perde Kalınlığı': 'Curtain Thickness',
    'Kenar Yumuşaklığı': 'Edge Softness',
    'Düğüm Sayısı': 'Node Count',
    'Bağlantı Mesafesi': 'Link Distance',
    'Düğüm Boyutu': 'Node Size',
    'Hareket Hızı': 'Movement Speed',
    'Halka Sıklığı': 'Ring Rate',
    'Genişleme Hızı': 'Expansion Speed',
    'Darbede Halka': 'Ring on Beat',

    // ---- Yeni görselleştirici modları ----

    // ---- Kare hızı ----
    'Ekranla Eşitle — en akıcı (önerilen)': 'Match Display — smoothest (recommended)',
    'En fazla 120 FPS': 'Up to 120 FPS',
    'En fazla 60 FPS': 'Up to 60 FPS',
    'En fazla 30 FPS (düşük güç)': 'Up to 30 FPS (low power)',
    'Ekranla Eşitle, her ekran yenilemesinde bir kare çizer; en akıcı sonucu verir. Ekranınızın yenileme hızının tam böleni olmayan bir sınır (75 Hz ekranda 60 gibi) kare aralıklarını eşitsiz yapabilir.': 'Match Display draws one frame per screen refresh, which is the smoothest result. A limit that is not an exact divisor of your refresh rate (such as 60 on a 75 Hz screen) can make frame intervals uneven.',

    // ---- Aydınlatma panelinde çevirisi eksik kalan metinler ----
    'Windows arka plan kontrolünü vermedi (0/3). Dynamic Lighting ayarlarında CAYADEV Visualizer uygulamasını listenin en üstüne taşıyın.': 'Windows did not grant background control (0/3). In Dynamic Lighting settings, move the CAYADEV Visualizer app to the top of the list.',
    'Bütün ışıklara tek sabit renk uygular.': 'Applies a single fixed color to all lights.',
    'Her aydınlatma aygıtına ayrı renk atar.': 'Assigns a separate color to each lighting device.',
    'Her LED veya bölgeyi tek tek ayarlamanızı sağlar.': 'Lets you set each LED or zone individually.',

    // ---- Yeni yönetici paneli düzeni: kategoriler ----
    'Ekranda görünen her şey: arkaplan, görselleştirici, logo ve görsel nesneler.': 'Everything you see on screen: background, visualizer, logo, and visual objects.',
    'Hangi sesin yakalanacağı ve görüntüye nasıl çevrileceği.': 'Which audio is captured and how it is turned into visuals.',
    'Işık': 'Lighting',
    'RGB aygıtlarını ve ışıkları müzikle sürün: OpenRGB, Art-Net / DMX ve Windows\'ta Dynamic Lighting.': 'Drive RGB devices and lights with the music: OpenRGB, Art-Net / DMX and, on Windows, Dynamic Lighting.',
    'Çıkış': 'Output',
    'Görüntünün nereye ve nasıl gideceği: ekran, performans ve video dosyası.': 'Where and how the visuals go out: display, performance, and video file.',
    'Kitaplık': 'Library',
    'Kayıtlı sahneler, renk şablonları ve ayar yedekleri.': 'Saved scenes, color presets, and settings backups.',

    // ---- Arama ----
    'Tüm ayarlarda ara…': 'Search all settings…',

    // ---- Gelişmiş / sıfırlama ----
    'Kategoriyi Sıfırla': 'Reset Category',
    'Bu kategoriyi varsayılana döndür': 'Reset this category to defaults',
    'Bu bölümdeki ayarlar varsayılana dönecek. Emin misiniz?': 'The settings in this section will return to their defaults. Are you sure?',
    'Bu kategorideki tüm ayarlar varsayılana dönecek. Emin misiniz?': 'All settings in this category will return to their defaults. Are you sure?',

    // ---- Canlı önizleme ----
    'Canlı Önizleme': 'Live Preview',
    'Canlı': 'Live',
    'Demo': 'Demo',
    'Gerçek ses yakalanıyor — demo sinyaline dönmek için tıklayın': 'Capturing real audio — click to switch back to the demo signal',
    'Örnek sinyalle sürülüyor — gerçek sesi yakalamak için tıklayın': 'Driven by a sample signal — click to capture real audio',
    'Önizlemeyi duraklat/başlat': 'Pause/resume preview',
    'Önizlemeyi duraklat': 'Pause preview',
    'Önizlemeyi başlat': 'Resume preview',
    'Ayarları değiştirdikçe burada anında görürsünüz. Ses yokken örnek bir sinyalle sürülür.': 'See every change here instantly. When there is no audio it is driven by a sample signal.',
    'Ses Seviyesi': 'Audio Level',

    // ---- Sahneler ----
    'Arkaplan + görselleştirici + logo + görsel nesneleri tek isim altında saklayın.': 'Store background + visualizer + logo + visual objects under a single name.',
    'Mevcut görünümü yeni sahne olarak kaydet': 'Save the current look as a new scene',
    'Henüz sahne yok. Beğendiğiniz görünümü ayarlayıp “Mevcut Görünümü Kaydet”e basın; daha sonra tek tıkla geri dönersiniz.': 'No scenes yet. Set up a look you like and press “Save Current Look”; you can return to it with one click later.',
    'Kaydet': 'Save',
    'Sahne adı:': 'Scene name:',
    'Bu sahne silinsin mi?': 'Delete this scene?',
    'Sahneleri İçe Aktar': 'Import Scenes',

    // ---- Bölüm başlıkları / açıklamaları ----
    'Yakalanan sesin görsele ne kadar sert veya yumuşak yansıyacağı.': 'How hard or soft the captured audio hits the visuals.',
    'Sese tepki veren sisli/akışkan fon veya düz renk.': 'A misty, fluid backdrop that reacts to audio, or a solid color.',
    'Renk Şablonlarım': 'My Color Presets',
    'Beğendiğiniz arkaplan renklerini kaydedin; tek tıkla geri yükleyin.': 'Save background colors you like and restore them with one click.',
    'Sese duyarlı ön efekt: frekans barları, dalga veya çember.': 'Audio-reactive foreground effect: frequency bars, wave, or circle.',
    'Sahneye bir resim yerleştirin; sese göre nabız atar.': 'Place an image in the scene; it pulses with the audio.',
    'Resim ekleyin; sahnede süzülsün, yörünge çizsin, sese göre saçılsın.': 'Add images that float, orbit, and scatter across the scene with the audio.',
    'Görselleştirme hangi ekranda tam ekran açılsın? Üst çubuktan da seçebilirsiniz.': 'Which display should the visualization open on, full screen? You can also pick it from the top bar.',
    'Görselleştirme seçili ekranda tam ekran açılır; ESC ile kapanır.': 'The visualization opens full screen on the selected display; press ESC to close it.',
    'Bir ses dosyası seçin; mevcut sahne ayarlarıyla kayıpsız videoya dönüştürülür. Ekran kaydı değildir — her kare birebir render edilir.': 'Choose an audio file; it is turned into a lossless video using the current scene settings. This is not a screen recording — every frame is rendered exactly.',

    // ---- Grup başlıkları ----
    'Hareket': 'Movement',
    'Görünüm': 'Appearance',
    'Bar Biçimi': 'Bar Shape',
    'Frekans Aralığı': 'Frequency Range',
    'Konum ve Işıltı': 'Position & Glow',
    'Davranış': 'Behavior',
    'Kodlama': 'Encoding',

    // ======================= v2.0 — YENİ ARAYÜZLER =======================

    // ---- Kategoriler ----
    'Kontrol': 'Control',
    'Studio': 'Studio',
    'MIDI denetleyicileri ve OSC ile ayarları canlı sürün.': 'Drive settings live from MIDI controllers and OSC.',
    'Kendi görselleştiricini ve arkaplanını yap; içe/dışa aktar.': 'Build your own visualizer and background; import and export them.',
    'Görüntünün nereye ve nasıl gideceği: ekran, yayın, performans ve video dosyası.': 'Where and how the image goes out: display, streaming, performance, and video file.',

    // ---- Üst çubuk / çoklu ekran / karartma ----
    'Ekranlar': 'Displays',
    'Karartmayı Kaldır': 'Undo Blackout',
    'Karartma (Blackout) Geçişi': 'Blackout Transition',
    'Şablonu taşı': 'Reorder preset',
    'Sürükleyerek ya da yukarı/aşağı ok tuşlarıyla taşıyın': 'Drag, or use the up and down arrow keys, to reorder',
    'Taşı': 'Reorder',
    '1920 × 1080 (Full HD)': '1920 × 1080 (Full HD)',
    '1280 × 720 (HD)': '1280 × 720 (HD)',
    '2560 × 1440 (2K)': '2560 × 1440 (2K)',
    '3840 × 2160 (4K)': '3840 × 2160 (4K)',
    '1080 × 1920 (Dikey)': '1080 × 1920 (Portrait)',
    '1080 × 1080 (Kare)': '1080 × 1080 (Square)',
    'Önizleme boyutu': 'Preview size',
    'Kayıt paneldeki canlı önizlemeden alınır ve o anki sesle birlikte ekranda göründüğü gibi kaydedilir — modülasyon, geçişler, efektler dahil. Sahne seçilen çözünürlükte sabit bir tuvale basılır, en-boy oranı korunur. Kaynak önizleme olduğu için büyütmek ayrıntı eklemez; bir ses dosyasının tamamını gerçek yüksek çözünürlükte işlemek için Video Dışa Aktarma kartını kullanın.': 'Recording is taken from the live preview in the panel and captures what is on screen together with the audio of that moment — modulation, transitions and effects included. The scene is drawn onto a fixed canvas at the chosen resolution with its aspect ratio preserved. The source is the preview, so scaling up adds no detail; to render a whole audio file at genuine high resolution, use the Video Export card.',
    'Ekranla Eşitle varsayılandır: kare hızı ekranınızdan otomatik gelir, elle ayarlamak gerekmez. Yenileme hızınızın tam böleni olmayan bir sınır (75 Hz ekranda 60 gibi) kare aralıklarını eşitsiz yapar. Panel önizlemesi ayrıca 45 FPS ile sınırlıdır; akıcılığı görselleştirici penceresinden değerlendirin.': 'Match Display is the default: the frame rate comes from your screen automatically, with nothing to set by hand. A limit that is not an exact divisor of your refresh rate (such as 60 on a 75 Hz screen) makes frame intervals uneven. The panel preview is separately capped at 45 FPS, so judge smoothness from the visualizer window.',
    'Karartma Süresi': 'Blackout Duration',
    'Karartma Animasyonu': 'Blackout Animation',
    'Gökkuşağı': 'Rainbow',
    'Möbius': 'Mobius',
    'Sahneyi karart (tekrar basınca geri gelir)': 'Black out the scene (press again to restore)',
    'Birden fazla ekran seçerseniz görselleştirme hepsinde aynı anda açılır. ESC hepsini kapatır.': 'If you select more than one display, the visualization opens on all of them at once. ESC closes them all.',
    'Seçtiğiniz her ekranda ayrı bir tam ekran görselleştirme açılır. ESC hepsini kapatır.': 'A separate full-screen visualization opens on each display you select. ESC closes them all.',

    // ---- Yeni bölüm başlıkları ----
    'Geri Besleme Motoru': 'Feedback Engine',
    'MilkDrop ailesi: her kare bir öncekini büker, yakınlaştırır ve söndürür. Sonsuz tünel görünümü buradan gelir.': 'The MilkDrop family: each frame warps, zooms, and fades the previous one. This is where the endless-tunnel look comes from.',
    'Web kameranızı veya bir video dosyasını sahneye katman olarak koyun; sese göre nabız atsın.': 'Place your webcam or a video file into the scene as a layer that pulses with the audio.',
    'Yayın Çıkışı (OBS / Web)': 'Streaming Output (OBS / Web)',
    'MIDI Denetleyici': 'MIDI Controller',
    'MIDI kumandanızın düğme ve faderlarını istediğiniz ayara bağlayın. Öğren düğmesine basıp denetleyiciyi oynatmanız yeterli.': 'Map the buttons and faders of your MIDI controller to any setting. Just press Learn and move the control.',
    'OSC': 'OSC',
    'TouchOSC, Resolume, Ableton veya QLab gibi kaynaklardan gelen OSC mesajlarını ayarlara bağlayın.': 'Map OSC messages from sources such as TouchOSC, Resolume, Ableton, or QLab to settings.',
    'Studio — Kendi Görselleştiricin': 'Studio — Your Own Visualizer',
    'Hazır bir modu kendine göre değiştir ya da sıfırdan shader yaz. Shadertoy, ISF ve MilkDrop dosyaları içe aktarılabilir.': 'Tweak a built-in mode to your taste or write a shader from scratch. Shadertoy, ISF, and MilkDrop files can be imported.',
    'Sahne Üretici': 'Scene Generator',
    'Ruh halini yaz, uygulama sana uygun bir sahne kursun. Tamamen çevrimdışı çalışır.': 'Describe a mood and the application builds a matching scene. Runs entirely offline.',
    'Sese duyarlı ön efekt: barlar, dalga, çember, tünel, spektrogram ve daha fazlası.': 'Audio-reactive foreground effect: bars, wave, circle, tunnel, spectrogram, and more.',
    'Sese tepki veren akışkan fon, dalga katmanları, yıldız alanı ve daha fazlası.': 'An audio-reactive fluid backdrop, wave layers, starfield, and more.',

    // ---- Yeni görselleştirici modları ----

    // ---- Yeni arkaplanlar ----

    // ---- Segment grup başlıkları ----
    'Temel': 'Basic', 'Dalga Formu': 'Waveform', 'Dairesel': 'Radial',
    'Parçacık ve Olay': 'Particles & Events', 'Gelişmiş Motorlar': 'Advanced Engines',
    'Akışkan': 'Fluid', 'Geometrik': 'Geometric', 'Atmosfer': 'Atmosphere',

    // ---- Geri besleme ayarları ----
    'Dalga Biçimi': 'Wave Shape', 'Çift': 'Dual',

    // ---- Studio ----
    'yerleşik': 'built-in', 'shader': 'shader', 'varyasyon': 'variation',
    'Ad': 'Name', 'Açıklama': 'Description',
    'Preset adı': 'Preset name',
    'Sahnede Kullan': 'Use In Scene',
    'Henüz Studio preseti yok. Studio sekmesinden bir tane oluşturun.': 'No Studio preset yet. Create one from the Studio tab.',
    'Kodda mainImage(out vec4 fragColor, in vec2 fragCoord) bulunamadı.': 'mainImage(out vec4 fragColor, in vec2 fragCoord) was not found in the code.',
    'ISF gövdesinde void main() bulunamadı.': 'void main() was not found in the ISF body.',
    'Tanınmayan dosya biçimi (svpreset veya svpack bekleniyordu).': 'Unrecognized file format (svpreset or svpack expected).',
    'Dosya okunamadı.': 'The file could not be read.',

    // ---- Yayın çıkışı ----
    'Port': 'Port',
    'dinleniyor': 'listening',
    'Mobil Kumanda': 'Mobile Remote',
    'OBS → Kaynaklar → + → Tarayıcı (Browser).': 'OBS → Sources → + → Browser.',
    'Yayın sayfası yerel ağdaki tüm cihazlara açılacak. Adres, tahmin edilmesi güç bir jeton içerir ve jeton olmadan hiçbir istek kabul edilmez. Genel/paylaşımlı bir ağdaysanız (kafe, otel, konferans) açmayın.': 'The streaming page will be reachable by every device on your local network. The address contains a hard-to-guess token and no request is accepted without it. Do not enable this on a public or shared network (café, hotel, conference).',
    'Erişim Jetonu': 'Access Token',
    'Yeni jeton üretir; eski adresler geçersiz olur': 'Generates a new token; old addresses stop working',

    // ---- Kontrol yüzeyleri ----
    'MIDI Etkin': 'MIDI Enabled', 'OSC Etkin': 'OSC Enabled',
    'Aygıt': 'Device', 'Tüm MIDI aygıtları': 'All MIDI devices',
    'MIDI girişi bulundu': 'MIDI input(s) found', 'MIDI girişi bulunamadı': 'No MIDI input found',
    'Bu ortamda Web MIDI kullanılamıyor.': 'Web MIDI is unavailable in this environment.',
    'sinyal bekleniyor…': 'waiting for a signal…', 'mesaj bekleniyor…': 'waiting for a message…',
    'UDP Portu': 'UDP Port',
    'OSC gönderen uygulamayı bu bilgisayarın IP adresine ve yukarıdaki porta yöneltin. 0..1 arası değerler doğrudan, 0..127 arası değerler otomatik ölçeklenerek kullanılır.': 'Point the OSC sender at this computer\'s IP address and the port above. Values between 0 and 1 are used directly; values up to 127 are scaled automatically.',
    'Henüz eşleme yok. “Eşleme Ekle” ile başlayın.': 'No mappings yet. Start with "Add Mapping".',
    'Eşleme Ekle': 'Add Mapping', 'Eşlemeyi kaldır': 'Remove mapping',
    'Dinleniyor…': 'Listening…',
    'Bas, sonra denetleyicideki düğmeyi oynat': 'Press this, then move the control on your device',
    'Bas, sonra OSC mesajını gönder': 'Press this, then send the OSC message',

    // ---- Medya katmanı ----
    'Kameranızı veya bir video dosyasını sahneye katman olarak koyar. Kaleydoskop, renk kayması ve sese bağlı yakınlaşma uygulanabilir; Studio shader\'larında sv_media (iChannel3) olarak da okunur.': 'Places your camera or a video file into the scene as a layer. Kaleidoscope, hue shift, and audio-driven zoom can be applied; Studio shaders can also read it as sv_media (iChannel3).',
    'Kamera': 'Camera', 'Varsayılan kamera': 'Default camera', 'Kameraları Yenile': 'Refresh Cameras',
    'Bu katmanın kamerasıdır. İkinci bir medya katmanı başka bir kamerayı aynı anda açar. OBS yayın katmanı kamerayı tarayıcıdan açmaz; görüntü bu uygulamadan gider. Adlar, kameraya izin verilince dolar.':
      'This is this layer\'s camera. A second media layer opens another camera at the same time. The OBS web layer does not open a browser camera; the picture comes from this application. Names fill in after permission is granted.',
    'Video Dosyası': 'Video File', 'Video Seç': 'Choose Video',
    'seçildi': 'selected', 'seçilmedi': 'not selected', 'Döngüde Oynat': 'Loop Playback',
    'Sığdırma': 'Fit', 'Doldur': 'Cover', 'Sığdır': 'Contain', 'Ger': 'Stretch',
    'Çarpma': 'Multiply', 'Aynala': 'Mirror',
    'Kaleydoskop Dilimi': 'Kaleidoscope Slices',
    'Bas → Saydamlık': 'Bass → Opacity',
    'Sahneye bir resim veya GIF yerleştirin; sese göre nabız atar. GIF seçilince oynatma ve ses ayarları açılır.': 'Place an image or GIF on the scene; it pulses with the audio. Choosing a GIF unlocks playback and audio controls.',
    'Ara…': 'Search…',
    'Henüz kitaplıkta görsel yok. Aşağıdan birden fazla resim veya GIF ekleyebilirsiniz.': 'The library is empty. Add multiple images or GIFs below.',
    'Henüz kitaplıkta video yok. Aşağıdan birden fazla video ekleyebilirsiniz.': 'The library is empty. Add multiple videos below.',
    'Kitaplığa Ekle': 'Add to Library',
    'Oynatma Hızı': 'Playback Speed',
    'Döngü': 'Loop',
    'Tekrar': 'Repeat',
    'Gidiş-Dönüş': 'Ping-pong',
    'Bir Kez': 'Once',
    'Ters Oynat': 'Play Reverse',
    'Kenar Yumuşatma': 'Edge Smoothing',
    'Ses Bandı': 'Audio Band',
    'Ses → Parlaklık': 'Audio → Brightness',
    'Ritim Parlaması': 'Beat Flash',
    'Ses → Renk': 'Audio → Hue',
    'Boyut ve köşe': 'Size and corner',
    'Yüzen Pencereyi Aç / Kapat': 'Open / Close Floating Window',
    'Yüzen Pencere Saydamlığı': 'Floating Window Opacity',
    'En-Boy Kilidi (16:9)': 'Aspect Lock (16:9)',
    'Konumu Kilitle': 'Lock Position',
    'Tıklamayı Alt Pencereye Geçir': 'Click-through to Apps Below',
    'Yüzen · Küçük': 'Floating · Small',
    'Yüzen · Orta': 'Floating · Medium',
    'Yüzen · Büyük': 'Floating · Large',
    'Köşe · Sağ Alt': 'Corner · Bottom Right',
    'Köşe · Sağ Üst': 'Corner · Top Right',
    'Köşe · Sol Alt': 'Corner · Bottom Left',
    'Köşe · Sol Üst': 'Corner · Top Left',

    // ---- Sahne üretici ----


    // ---- Yerleşik Studio presetleri (ad + açıklama) ----
    'Plazma Deniz': 'Plasma Sea',
    'Klasik plazma: katmanlı sinüsler basla dalgalanır.': 'Classic plasma: layered sines that swell with the bass.',
    'Frekans Halkaları': 'Frequency Rings',
    'Merkezden yayılan halkalar; her halka bir frekans bandı.': 'Rings spreading from the center; each ring is a frequency band.',
    'Alan bükümlü gürültü; ağır, akışkan metalik yüzey.': 'Domain-warped noise; a heavy, flowing metallic surface.',
    'Yıldız Geçidi': 'Star Gate',
    'Hiper uzay: bas vurdukça hızlanan yıldız akışı.': 'Hyperspace: a star stream that accelerates on every bass hit.',
    'Dalga Perdesi': 'Wave Curtain',
    'Dalga formundan üretilen ışık perdesi — saydam üst katman.': 'A curtain of light built from the waveform — a transparent overlay.',
    'Bas Küresi': 'Bass Orb',
    'Ortada nabız atan enerji küresi — saydam üst katman.': 'A pulsing orb of energy in the middle — a transparent overlay.',

    // ---- Yer tutucular ----
    '/adres/yolu': '/address/path',

    // ======================= v2.1 — MOTORLAR =======================

    // ---- Katmanlar ----
    'Sahneyi üst üste binen katmanlardan kurun: her katmanın kendi kaynağı, karışım modu, saydamlığı, dönüşümü ve sese tepkisi olur.': 'Build the scene from stacked layers: each layer gets its own source, blend mode, opacity, transform, and audio response.',
    'Sahne şu anda Arkaplan ve Görselleştirici kartlarından sürülüyor. Katmanlara geçerseniz aynı görünüm katman listesi olarak açılır ve üzerine yenilerini ekleyebilirsiniz.': 'The scene is currently driven by the Background and Visualizer cards. Switching to layers opens that same look as a layer list you can build on.',
    'Katman listesini boşaltır; sahne yeniden Arkaplan/Görselleştirici kartlarından sürülür': 'Empties the layer list; the scene is driven by the Background/Visualizer cards again',
    'Katman listesi boşaltılacak. Sahne yeniden Arkaplan ve Görselleştirici kartlarından sürülecek.': 'The layer list will be emptied. The scene will be driven by the Background and Visualizer cards again.',
    'Katmanı aç/kapat': 'Enable/disable layer',
    'Dönüşüm': 'Transform', 'Sese Tepki': 'Audio Response',
    'Yatay Konum': 'Horizontal Position', 'Dikey Konum': 'Vertical Position',
    'Dikey Hiza': 'Vertical Alignment',
    'Yatay Aynala': 'Mirror Horizontally', 'Dikey Aynala': 'Mirror Vertically',
    'Ses → Saydamlık': 'Audio → Opacity', 'Ses → Ölçek': 'Audio → Scale', 'Ses → Dönüş': 'Audio → Rotation',
    'Henüz Studio preseti yok.': 'No Studio preset yet.',
    'Şarkı Sözü': 'Lyrics',
    'Sanatçı Adı': 'Artist Name',
    'Gösterilen Alan': 'Displayed Field',
    'Parça ve Sanatçı': 'Track and Artist',

    // Karışım modları
    'Toplama': 'Add', 'Kaplama': 'Overlay',
    'Koyulaştır': 'Darken', 'Açıklaştır': 'Lighten',
    'Renk Soldurma': 'Color Dodge', 'Renk Yakma': 'Color Burn',
    'Sert Işık': 'Hard Light', 'Yumuşak Işık': 'Soft Light',
    'Fark': 'Difference', 'Dışlama': 'Exclusion',
    'Renk Tonu': 'Hue',

    // ---- Efekt zinciri ----
    'Efekt Zinciri': 'Effect Chain',
    'Birleştirilmiş sahneye sırayla uygulanan son-işlem efektleri. Sıra görüntüyü değiştirir; zincir dışa aktarımda da aynen çalışır.': 'Post-processing effects applied in order to the composited scene. The order changes the result, and the chain runs the same way on export.',
    'Efekti aç/kapat': 'Enable/disable effect',
    'Sese Bağla': 'Bind To Audio',
    'Yeni Efekt': 'New Effect', 'Efekt ekle…': 'Add effect…',

    // Efekt adları
    'Bloom (Kompozisyon Parlaması)': 'Bloom (Composition Glow)',
    'Renk Sapması (Kromatik)': 'Chromatic Aberration',
    'Glitch (Dilim Kayması)': 'Glitch (Slice Shift)',
    'Film Greni': 'Film Grain',
    'CRT / Tarama Çizgileri': 'CRT / Scanlines',
    'Pikselleştir': 'Pixelate',
    'Ayna': 'Mirror',
    'İz / Yankı': 'Trails / Echo',
    'Kenar Vurgusu': 'Edge Highlight',
    'Merkezden Bulanıklık': 'Zoom Blur',
    'Dalga Bozulması': 'Ripple Distortion',
    'Posterize / Ters Çevir': 'Posterize / Invert',

    // Efekt parametreleri
    'Eşik': 'Threshold',
    'Merkezden Uzaklık': 'Falloff', 'Dilim Sayısı': 'Slice Count',
    'Tanecik Boyutu': 'Grain Size', 'Çizgi Şiddeti': 'Line Strength',
    'Ekran Eğriliği': 'Screen Curvature',
    'Piksel Boyutu': 'Pixel Size',
    'Biçim (0 yatay · 1 dikey · 2 dörtlü)': 'Mode (0 horizontal · 1 vertical · 2 quad)',
    'Pozlama': 'Exposure',
    'Örnek': 'Samples', 'Kademe': 'Levels',

    // ---- 3B geometri ----
    'Matematiksel formüllerden gerçek perspektifte geometri: yüzeyler, uzay eğrileri ve çekici sistemler.': 'Geometry in true perspective from mathematical formulas: surfaces, space curves, and attractor systems.',
    'Aile': 'Family', 'Formül': 'Formula', 'Çizim': 'Draw',
    'Sese Bağlı Bozulma': 'Audio Deformation', 'Bozulma Kipi': 'Deformation Mode',
    'Renklendirme': 'Coloring', 'Kamera ve Görünüm': 'Camera & Appearance',
    'Çekici Ayarları': 'Attractor Settings', 'Nokta Sayısı': 'Point Count',
    'Yüzey': 'Surface', 'Uzay Eğrisi': 'Space Curve', 'Düzlem Eğrisi': 'Plane Curve', 'Çekici': 'Attractor',
    'Tel Kafes': 'Wireframe',
    'Normal Yönünde': 'Along Normal', 'Işınsal': 'Radial', 'Çökme': 'Collapse',
    'Palet': 'Palette', 'Derinlik': 'Depth', 'Normal': 'Normal',
    'Bu ailede formül yok.': 'No formula in this family.',

    // Formül adları
    'Gül Eğrisi (Rhodonea)': 'Rose Curve (Rhodonea)',
    'Episikloid': 'Epicycloid', 'Hipotrokoid (Spirograf)': 'Hypotrochoid (Spirograph)',
    'Süperformül (Gielis)': 'Superformula (Gielis)', 'Kelebek Eğrisi': 'Butterfly Curve',
    'Lemniskat (Bernoulli)': 'Lemniscate (Bernoulli)', 'Astroid': 'Astroid', 'Kardiyoid': 'Cardioid',
    'Filotaksi (Altın Açı)': 'Phyllotaxis (Golden Angle)', 'Logaritmik Sarmal': 'Logarithmic Spiral',
    'Harmonograf': 'Harmonograph', 'Simit Düğümü': 'Torus Knot', 'Sarmal (Helis)': 'Helix',
    'Viviani Eğrisi': 'Viviani Curve', 'Yonca Düğümü': 'Trefoil Knot',
    'Düzlem': 'Plane', 'Simit (Torus)': 'Torus', 'Klein Şişesi': 'Klein Bottle',
    'Möbius Şeridi': 'Mobius Strip', 'Süperşekil (3B Gielis)': 'Supershape (3D Gielis)',
    'Deniz Kabuğu': 'Seashell', 'Boy Yüzeyi': "Boy's Surface", 'Dini Yüzeyi': 'Dini Surface',
    'Küresel Harmonik': 'Spherical Harmonic', 'Chladni Deseni': 'Chladni Pattern',
    'Dalga Yüzeyi': 'Ripple Surface',
    'Lorenz': 'Lorenz', 'Rössler': 'Rössler', 'Thomas': 'Thomas', 'Aizawa': 'Aizawa',
    'Halvorsen': 'Halvorsen', 'Clifford (Ayrık)': 'Clifford (Discrete)', 'de Jong (Ayrık)': 'de Jong (Discrete)',
    'Boru Kalınlığı': 'Tube Thickness', 'Tur': 'Turns', 'Burulma': 'Twist',
    'Açı (derece)': 'Angle (degrees)', 'Yayılma': 'Spread',
    'Üs': 'Exponent',
    'Enneper Yüzeyi': 'Enneper Surface', 'Katenoid': 'Catenoid', 'Helikoid': 'Helicoid',
    'Roma Yüzeyi (Steiner)': 'Roman Surface (Steiner)', 'Çapraz Başlık': 'Cross-Cap',
    'Hiperboloit (tek kanatlı)': 'Hyperboloid (one-sheeted)', 'Eliptik Paraboloit': 'Elliptic Paraboloid',
    'Maymun Eyeri': 'Monkey Saddle', 'Yumurta Kolisi': 'Egg Carton', 'Sinüs Yüzeyi': 'Sine Surface',
    'Sözde Küre': 'Pseudosphere', 'Kuen Yüzeyi': 'Kuen Surface', 'Breather Yüzeyi': 'Breather Surface',
    'Süperelipsoit': 'Superellipsoid', 'Gielis Süperşekli (3B)': 'Gielis Supershape (3D)',
    'Bükülü Simit': 'Twisted Torus', 'Yonca Boru': 'Trefoil Tube', 'Epitrokoid': 'Epitrochoid',
    'Hiposikloid': 'Hypocycloid', 'Deltoit': 'Deltoid', 'Nefroit': 'Nephroid',
    'Limaçon (Pascal Salyangozu)': 'Limaçon (Pascal Snail)', 'Diocles Sissoidi': 'Cissoid of Diocles',
    'Descartes Yaprağı': 'Folium of Descartes', 'Strofoit': 'Strophoid',
    'Konkoit (Nikomedes)': 'Conchoid (Nicomedes)', 'Kokleoit': 'Cochleoid',
    'Fermat Sarmalı': 'Fermat Spiral', 'Hiperbolik Sarmal': 'Hyperbolic Spiral',
    'Arşimet Sarmalı': 'Archimedean Spiral', 'Lituus': 'Lituus', 'Çember Evolventi': 'Circle Involute',
    'Sikloit': 'Cycloid', 'Trokoit': 'Trochoid', 'Maurer Gülü': 'Maurer Rose',
    'Lissajous Düğümü': 'Lissajous Knot', 'Küresel Sarmal': 'Spherical Spiral',
    'Konik Sarmal': 'Conical Spiral', 'Seiffert Sarmalı': 'Seiffert Spiral',
    'Büyükanne Düğümü': 'Granny Knot', 'Sekiz Düğümü': 'Figure-Eight Knot',
    'Solenoit': 'Solenoid', 'Simit Halkası (p,q)': 'Torus Knot (p,q)',
    'Chua Devresi': 'Chua Circuit', 'Dört Kanat': 'Four-Wing',
    'Rikitake Dinamosu': 'Rikitake Dynamo', 'Langford (Aizawa varyantı)': 'Langford (Aizawa variant)',
    'Duffing Salınıcısı': 'Duffing Oscillator', 'Standart Harita (Chirikov)': 'Standard Map (Chirikov)',
    'Hopalong (Barry Martin)': 'Hopalong (Barry Martin)',
    'Boyun': 'Neck', 'Dönüşler': 'Turns',
    'Boru': 'Tube',

    // ---- Tempo ve otomatik VJ ----
    'Tempo ve Otomatik VJ': 'Tempo & Auto VJ',
    'Parçanın temposunu bulur; sahneleri, modları veya renkleri ölçüye hizalı olarak kendiliğinden değiştirir.': 'Finds the track\'s tempo and switches scenes, modes, or colors by itself, aligned to the bar.',
    'Tempoya Vur': 'Tap Tempo',
    'Ritimle birkaç kez basın; tempo elle sabitlenir': 'Tap a few times in time with the music to lock the tempo manually',
    'BPM Kilidi': 'BPM Lock', 'otomatik': 'automatic',
    'Ölçüdeki Vuruş': 'Beats Per Bar',
    'Tempo, spektral akıdan bulunan vuruşların aralık histogramıyla kestirilir ve 60–180 BPM aralığına katlanır; böylece aynı parça bazen 75 bazen 150 görünmez. Dış bir tempo kaynağına bağlanılmaz — elle vurarak sabitleyebilirsiniz.': 'Tempo is estimated from an interval histogram of beats found via spectral flux, then folded into the 60–180 BPM range so the same track never reads as 75 one moment and 150 the next. No external tempo source is used — you can lock it by tapping.',
    'Otomatik VJ': 'Auto VJ',
    'Neyi Değiştirsin': 'What To Switch',
    'Sahneler': 'Scenes', 'Görselleştiriciler': 'Visualizers', 'Hepsi (sırayla)': 'All (in turn)',
    'Aralık Birimi': 'Interval Unit', 'Ölçü': 'Bars',
    'Aralık': 'Interval', 'Sıra': 'Order', 'Sırayla': 'Sequential', 'Rastgele': 'Random',
    'Şimdi Değiştir': 'Switch Now',

    // ---- Art-Net / DMX ----
    'Art-Net / DMX Çıkışı': 'Art-Net / DMX Output',
    'Sahne renklerini standart DMX protokolüyle ışık konsollarına ve arayüzlerine yollar.': 'Sends scene colors to lighting consoles and interfaces over the standard DMX protocol.',
    'Art-Net Çıkışı': 'Art-Net Output',
    'Yayında': 'Broadcasting', 'Evren': 'Universe', 'paket': 'packets',
    'Hedef Adres': 'Target Address',
    'Evren (Universe)': 'Universe',
    'Başlangıç Kanalı': 'Start Channel',
    'Aygıt Sayısı': 'Fixture Count',
    'Aygıt Kanalları': 'Fixture Channels',
    'Renk Kaynağı': 'Color Source',
    'Sahne Paleti': 'Scene Palette', 'Frekans Bantları': 'Frequency Bands',
    'Kayan Spektrum': 'Rolling Spectrum', 'Tek Renk': 'Single Color',

    // ---- Renk şablonu kitaplığı (58 şablon, 7 grup) ----
    'Klasikler': 'Classics', 'Sıcak': 'Warm', 'Soğuk': 'Cool',
    'Neon ve Siber': 'Neon & Cyber', 'Karanlık': 'Dark', 'Aydınlık': 'Light',
    'Tek Renk Aileleri': 'Monochrome Families',

    'Çöl': 'Desert', 'Sonbahar': 'Autumn', 'Şafak': 'Dawn', 'Kor': 'Embers',
    'Şeftali': 'Peach', 'Altın Saat': 'Golden Hour', 'Bakır': 'Copper',
    'Şarap': 'Wine', 'Mercan': 'Coral', 'Baharat': 'Spice',

    'Derin Deniz': 'Deep Sea', 'Nane': 'Mint', 'Gökyüzü': 'Sky',
    'Kış Sabahı': 'Winter Morning', 'Turkuaz': 'Turquoise', 'Lavanta': 'Lavender',
    'Sis': 'Mist', 'Kuzey Işığı': 'Northern Light', 'Buzul': 'Glacier',

    'Siberpunk': 'Cyberpunk', 'Synthwave': 'Synthwave', 'Vapor': 'Vapor',
    'Asit': 'Acid', 'Ultraviyole': 'Ultraviolet', 'Matris': 'Matrix',
    'Gece Kulübü': 'Nightclub', 'Lazer': 'Laser', 'Hologram': 'Hologram', 'Devre': 'Circuit',

    'Kömür': 'Charcoal', 'Gotik': 'Gothic', 'Uzay Boşluğu': 'Deep Space',
    'Kan Ayı': 'Blood Moon', 'Zift': 'Pitch',

    'Kağıt': 'Paper', 'Bahar': 'Spring', 'Şeker': 'Candy', 'Limonata': 'Lemonade',
    'Deniz Köpüğü': 'Sea Foam', 'Gündüz': 'Daylight',

    'Mono Kırmızı': 'Mono Red', 'Mono Mavi': 'Mono Blue', 'Mono Yeşil': 'Mono Green',
    'Mono Mor': 'Mono Purple', 'Mono Turuncu': 'Mono Orange', 'Gri Tonlama': 'Grayscale',
    // ---- Projeksiyon haritalama ----
    'Projeksiyon Haritalama': 'Projection Mapping',
    'Görüntüyü düz olmayan yüzeylere oturtun: köşe düzeltme, bükme ızgarası, kırpma, kenar harmanlama, ekran başına renk düzeltme, maske ve hizalama desenleri.':
      'Fit the image onto surfaces that are not flat: corner pin, warp mesh, crop, edge blending, per-display colour correction, masks and alignment patterns.',
    'Haritalama Etkin': 'Mapping Enabled',
    'Haritalama kapalı: görüntü ekrana olduğu gibi gider ve bu aşamanın ölçülebilir bir maliyeti yoktur.':
      'Mapping is off: the image goes to the screen unchanged, and this stage costs nothing measurable.',
    'Düzenlenen Çıkış': 'Editing Output',
    'Tüm Ekranlar (varsayılan)': 'All Displays (default)',
    'Düzenleme': 'Editing',
    'Köşeler': 'Corners',
    'Bükme Izgarası': 'Warp Mesh',
    'Sol Üst': 'Top Left', 'Sağ Üst': 'Top Right', 'Sağ Alt': 'Bottom Right', 'Sol Alt': 'Bottom Left',
    'Köşeleri Sıfırla': 'Reset Corners',
    'Izgarayı Sıfırla': 'Reset Mesh',
    'Bir noktayı sürükleyin; ok tuşlarıyla ince ayar yapın (Shift ile büyük adım). Eğri kontrol noktalarından geçer, yani nokta nereye giderse görüntü de oraya gider.':
      'Drag a point; fine-tune with the arrow keys (Shift for a larger step). The curve passes through the control points, so the image goes exactly where the point goes.',
    '+ Dörtgen Maske': '+ Rectangle Mask',
    '+ Altıgen Maske': '+ Hexagon Mask',
    'Maskeler görüntünün dışına taşan alanı gizler. Çokgenin içi karartılır.':
      'Masks hide areas the image should not reach. The inside of the polygon is blacked out.',
    'Kenar Harmanlama': 'Edge Blending',
    'Sol': 'Left', 'Sağ': 'Right', 'Üst': 'Top', 'Alt': 'Bottom',
    'Işık Eğrisi (gama)': 'Light Curve (gamma)',
    'İki projektör üst üste bindiğinde her ikisinin de kendi kenarını karartması gerekir. Eğriler toplandığında tam ışık verecek biçimde tasarlandı; gama projektörün ışık eğrisine göre ayarlanır.':
      'Where two projectors overlap, each has to darken its own edge. The curves are designed to sum to full light; the gamma matches the projector\'s own light curve.',
    'Kırpma': 'Crop',
    'Genişlik': 'Width',
    'Kompozisyonun bir bölgesini alıp bu çıkışa yayar. Tek bir sahneyi birden çok yüzeye bölmenin yolu budur.':
      'Takes a region of the composition and fills this output with it. This is how one scene is split across several surfaces.',
    'Renk Düzeltme': 'Color Correction',
    'Kırmızı': 'Red', 'Yeşil': 'Green', 'Mavi': 'Blue',
    'Yan yana duran iki projektörün rengi hiçbir zaman birebir aynı olmaz; bu ayarlar onları eşleştirmek içindir.':
      'Two projectors side by side never match exactly; these controls are for matching them.',
    'Hizalama Deseni': 'Alignment Pattern',
    'Artı ve Çember': 'Cross & Circle',
    'Renk Barları': 'Colour Bars',
    'Odak Çemberleri': 'Focus Rings',
    'Bu Çıkışı Sıfırla': 'Reset This Output',
    'Bu çıkışın tüm haritalama ayarları sıfırlansın mı?': 'Reset every mapping setting for this output?',

    // ---- Sahne geçişleri ----
    'Sahne Geçişi': 'Scene Transition',
    'Sahne değiştirirken sert kesme yerine geçiş: çapraz geçiş, silme, iris, zum, glitch ve daha fazlası. İstenirse tamamen kapatılabilir.':
      'A transition instead of a hard cut when the scene changes: crossfade, wipe, iris, zoom, glitch and more. Can be switched off entirely.',
    'Geçişler Etkin': 'Transitions Enabled',
    'Geçişler kapalı: sahne değişimleri anında olur.': 'Transitions are off: scene changes happen instantly.',
    'Geçiş motoru yüklenemedi.': 'The transition engine could not be loaded.',
    'Geçiş yalnızca sahne değiştiğinde çalışır (mod, arkaplan, preset, palet ya da katman yapısı). Kaydırıcı oynatmak geçiş başlatmaz.':
      'A transition only runs when the scene changes (mode, background, preset, palette or layer structure). Moving a slider does not start one.',
    'Vuruş cinsinden süre tempo motorundan okunur; geçiş müziğe oturur.':
      'A duration in beats is read from the tempo engine, so the transition lands with the music.',
    'Geçişi Dene': 'Preview Transition',
    'Sahneyi kendisiyle değiştirerek geçişi bir kez oynatır': 'Plays the transition once by swapping the scene with itself',
    'Önizleme hazır değil.': 'The preview is not ready.',
    'Süre Birimi': 'Duration Unit',
    'Süre': 'Duration',
    'Hız Eğrisi': 'Easing',
    'Saniye': 'Seconds',
    'Vuruş': 'Beats',
    'Yavaş Başla': 'Ease In',
    'Yavaş Bitir': 'Ease Out',
    'Yavaş Başla ve Bitir': 'Ease In-Out',
    'Ani': 'Snap',

    // Geçiş türleri
    'Kesme': 'Cut',
    'Çapraz Geçiş': 'Crossfade',
    'Erime': 'Dissolve',
    'Silme': 'Wipe',
    'Dairesel Silme': 'Radial Wipe',
    'Saat Silme': 'Clock Wipe',
    'Ahır Kapısı': 'Barn Door',
    'Jaluzi': 'Blinds',
    'Kayan Şeritler': 'Sliding Stripes',
    'Dama': 'Checkerboard',
    'İris': 'Iris',
    'Parlaklık Silme': 'Luma Wipe',
    'Zum Darbesi': 'Zoom Punch',
    'İtme': 'Push',
    'Glitch': 'Glitch',
    'Bulanık Geçiş': 'Blur Transition',
    'Tanecik': 'Grain',
    'Beyazlık': 'Whiteness',
    'Blok': 'Blocks',

    // ---- Üretken arkaplanlar ----
    'Üretken Zeminler': 'Generative Grounds',
    'Plazma': 'Plasma',
    'Su Yüzeyi': 'Caustics',
    'Şeritler': 'Ribbons',
    'Eşyükselti': 'Contours',
    'Kıvılcım': 'Embers',
    'Kum': 'Sand',
    'Vitray': 'Stained Glass',
    'Devre Kartı': 'Circuit Board',
    'Prizma': 'Prism',
    'Küre Ağı': 'Globe Mesh',
    'Tel Tüneli': 'Wire Tunnel',
    'Petek Nabzı': 'Hex Pulse',

    // ---- Son-işlem efektleri (ikinci bölüm) ----
    'Bulanıklık (Gauss)': 'Blur (Gaussian)',
    'Işınsal Bulanıklık': 'Radial Blur',
    'Yönlü Bulanıklık': 'Directional Blur',
    'Tilt-Shift': 'Tilt-Shift',
    'Alan Derinliği (Bokeh)': 'Depth of Field (Bokeh)',
    'Keskinleştirme': 'Sharpen',
    'Kabartma': 'Emboss',
    'Dither (Bayer)': 'Dither (Bayer)',
    'Yarım Ton': 'Halftone',
    'ASCII Mozaik': 'ASCII Mosaic',
    'Tarama Çizgisi (Kalem)': 'Cross-Hatch (Pen)',
    'Yağlı Boya (Kuwahara)': 'Oil Paint (Kuwahara)',
    'VHS / Analog Bant': 'VHS / Analogue Tape',
    'Datamosh (Blok Kayması)': 'Datamosh (Block Shift)',
    'Yarık Tarama': 'Slit-Scan',
    'Lens Bozunumu': 'Lens Distortion',
    'Kutupsal Dönüşüm': 'Polar Transform',
    'Gradyan Eşleme': 'Gradient Map',
    'Seviyeler ve Eğri': 'Levels & Curve',
    'Eşikleme': 'Threshold',
    'Solarizasyon': 'Solarize',
    'Işık Huzmeleri': 'God Rays',
    'Bozuk Sinyal': 'Bad Signal',
    'Yıldız Süzgeci': 'Star Filter',
    'Alt Uç': 'Low End',
    'Üst Uç': 'High End',
    'Ağırlık': 'Weight',
    'Beyaz Noktası': 'White Point',
    'Siyah Noktası': 'Black Point',
    'Blok Boyutu': 'Block Size',
    'Bulanıklık': 'Blur',
    'Dönüm Noktası': 'Turn Point',
    'Eksen': 'Axis',
    'Fıçı / Yastık': 'Barrel / Pincushion',
    'Gama': 'Gamma',
    'Gürültü': 'Noise',
    'Hücre': 'Cell',
    'Işık Açısı': 'Light Angle',
    'Kafa Anahtarı': 'Head Switch',
    'Kaydırma': 'Offset',
    'Kaynak X': 'Source X',
    'Kaynak Y': 'Source Y',
    'Kol': 'Points',
    'Nokta Aralığı': 'Dot Pitch',
    'Odak Aralığı': 'Focus Range',
    'Odak Genişliği': 'Focus Width',
    'Odak Konumu': 'Focus Position',
    'Odak Parlaklığı': 'Focus Brightness',
    'Renk Taşması': 'Colour Bleed',
    'Salınım': 'Wobble',
    'Senk Kaybı': 'Sync Loss',
    'Tarama Açısı': 'Screen Angle',
    'Uzunluk': 'Length',
    'Yenilenme': 'Refresh',
    'Yön': 'Direction',
    'Yırtılma': 'Tearing',
    'Zaman Derinliği': 'Time Depth',

    // ---- Şablon açıklamaları ----
    'Sert barlar, bloom ve vuruşta parlayan bir duvar.': 'Hard bars, bloom, and a wall that flares on every beat.',
    'Basla nefes alan sonsuz tünel.': 'An endless tunnel that breathes with the bass.',
    'Moiré ızgaraları ve lazer rengi.': 'Moiré grids in laser colours.',
    'Simetrik mandala, vuruşta açılıp kapanır.': 'A symmetric mandala that opens and closes on the beat.',
    'İzometrik şehir; her bant bir kule.': 'An isometric city where every band is a tower.',
    'Her vuruşta havai fişek.': 'Fireworks on every beat.',
    'Klasik MilkDrop akışı, geri beslemeli.': 'Classic MilkDrop flow, with feedback.',
    'Kaotik çekiciler, vuruşta değişir.': 'Strange attractors that change on the beat.',
    'Yavaş kutup ışıkları, sakin dalga.': 'Slow northern lights over a calm wave.',
    'Mürekkep bulutları, çok yavaş.': 'Ink clouds, very slow.',
    'Eşyükselti çizgileri, harita sakinliği.': 'Contour lines, the calm of a map.',
    'Su yüzeyinden kırılan ışık.': 'Light refracted through a water surface.',
    'Yükselen kıvılcımlar.': 'Rising embers.',
    'Akışkan metal bantları.': 'Bands of liquid metal.',
    'Dönen küre ağı.': 'A rotating globe mesh.',
    'Gürültü alanında sürüklenen izler.': 'Trails drifting through a noise field.',
    'Dalga girişimi deseni.': 'A wave interference pattern.',
    'Saydam arkaplan, alt köşe barları.': 'Transparent background, bars in the lower corner.',
    'Saydam, ince dalga çizgisi.': 'Transparent, a thin waveform line.',
    'Saydam dairesel spektrum, avatar çevresi için.': 'A transparent circular spectrum, for framing an avatar.',
    'Saydam osiloskop; fosfor izli.': 'A transparent oscilloscope with phosphor persistence.',
    'Alt şeritte nokta matris.': 'A dot matrix along the lower third.',
    'Gonyometre — stereo görüntü denetimi.': 'Goniometer — for checking the stereo image.',
    'Nota sınıfları ve algılanan akor.': 'Pitch classes and the detected chord.',
    'Çift sarmal, spektrumla açılır.': 'A double helix that opens with the spectrum.',
    'Akan şeritler.': 'Flowing ribbons.',
    'Titreşen teller.': 'Vibrating strings.',
    'Kayan zaman-frekans yüzeyi.': 'A scrolling time-frequency surface.',
    'Dönen yıldız diski.': 'A rotating disc of stars.',
    'Klasik plazma, sonsuz akış.': 'Classic plasma, flowing forever.',
    'Vitray hücreleri.': 'Stained glass cells.',
    'Devre kartında dolaşan sinyaller.': 'Signals travelling across a circuit board.',
    'Tel kafes tünel.': 'A wireframe tunnel.',
    'Yatay kum akışı.': 'Sand flowing sideways.',
    'Işınsal prizma dilimleri.': 'Radial prism slices.',
    'Kendine dönen yüzey.': 'A surface that passes through itself.',
    'Kelebek çekicisi.': 'The butterfly attractor.',
    'Gielis süperşekli.': 'The Gielis supershape.',
    'Yonca düğümü boru.': 'A tube swept along a trefoil knot.',
    'Titreşim düğüm desenleri.': 'Vibration node patterns.',
    'Gül eğrisi.': 'The rose curve.',
    'Çift sarmallı elektronik kaos.': 'Double-scroll electronic chaos.',
    'Tek yüzlü şerit.': 'A one-sided strip.',
    'Sert, tek renk, yüksek kontrast.': 'Hard, single colour, high contrast.',
    'Sıcak, yuvarlak, akışkan.': 'Warm, round, fluid.',
    'Hızlı, parçalı, glitchli.': 'Fast, fragmented, glitched.',
    'Kalın barlar, altın tonlar.': 'Thick bars in gold tones.',
    'Yumuşak, taneli, nostaljik.': 'Soft, grainy, nostalgic.',
    'Neon ızgara ve mor gökyüzü.': 'A neon grid under a purple sky.',
    'Sert kenarlar, şimşek.': 'Hard edges and lightning.',
    'Kömür ve kor.': 'Charcoal and embers.',
    'Sıcak, akışkan, akor renkli.': 'Warm, fluid, coloured by the chord.',
    'Ağırbaşlı, altın oran.': 'Restrained, in gold.',
    'Neredeyse hareketsiz.': 'Almost motionless.',
    'Parlak, renkli, hareketli.': 'Bright, colourful, busy.',
    'Uzun yükselişler, geniş alan.': 'Long builds, wide space.',
    'Ağır düşüş, blok kayması.': 'Heavy drops, block displacement.',
    'Piksel ve sınırlı palet.': 'Pixels and a limited palette.',
    'Reaksiyon-difüzyon hissi.': 'The feel of reaction-diffusion.',
    'Tek çizgi, beyaz üstü siyah.': 'A single line, white on black.',
    'Sakin mavi, düzenli.': 'Calm blue, orderly.',
    'Altın ve siyah.': 'Gold and black.',
    'Yüksek doygunluk, geniş hareket.': 'High saturation, broad movement.',
    'Hizalama için ızgara ve kontrast.': 'A grid and contrast for alignment.',

    // ---- Katı geometri ----
    'Katı': 'Solid',
    'Dörtyüzlü': 'Tetrahedron',
    'Küp': 'Cube',
    'Sekizyüzlü': 'Octahedron',
    'Onikiyüzlü': 'Dodecahedron',
    'Yirmiyüzlü': 'Icosahedron',
    'Jeodezik Küre': 'Geodesic Sphere',
    'Alt Bölünme': 'Subdivision',
    'L-Sistem Ağaç': 'L-System Tree',
    'L-Sistem Eğrelti': 'L-System Fern',
    'Ejderha Eğrisi': 'Dragon Curve',
    'Hilbert Eğrisi (3B)': 'Hilbert Curve (3D)',
    'Barnsley Eğreltisi': 'Barnsley Fern',
    'Sierpinski Dörtyüzlü': 'Sierpinski Tetrahedron',
    'Sarmal IFS': 'Spiral IFS',
    'Açı': 'Angle',

    // ---- Yerleşik shader kitaplığı ----

    // ---- Hazır şablonlar ----
    'Hazır Şablonlar': 'Built-in Presets',
    'Kullanıma ve türe göre gruplanmış bitmiş sahneler. Tek tıkla uygulanır; ses, ekran, yayın ve aydınlatma ayarlarınıza dokunmaz.':
      'Finished scenes grouped by use and by genre. One click applies them, and your audio, display, streaming and lighting settings are left alone.',
    'Şablon kitaplığı yüklenemedi.': 'The template library could not be loaded.',
    'Tümü': 'All',
    'şablon adı ya da açıklaması': 'template name or description',
    'Aramaya uyan şablon yok.': 'No template matches the search.',
    'Şablon yalnızca sahneyi değiştirir: arkaplan, görselleştirici, palet, efekt zinciri, modülasyon ve geçiş. Ses aygıtı, ekran seçimi, yayın ve aydınlatma ayarlarınız olduğu gibi kalır.':
      'A template only changes the scene: background, visualizer, palette, effect chain, modulation and transition. Your audio device, display selection, streaming and lighting settings stay exactly as they are.',
    'Kulüp': 'Club',
    'Ambiyans': 'Ambient',
    'Yayın': 'Streaming',
    'Müzik': 'Music',
    'Ekran Koruyucu': 'Screensaver',
    'Tür': 'Type',
    'Etkinlik': 'Event',

    // ---- Kayıt ----
    'Kayıt ve Anlık Görüntü': 'Recording & Snapshot',
    'Ekranda göründüğü gibi kaydedin: canlı sesle, modülasyon, geçiş ve efektler dahil. MP4, WebM, GIF ve PNG.':
      'Record exactly what is on screen, with the live audio, including modulation, transitions and effects. MP4, WebM, GIF and PNG.',
    'Kayda Başla': 'Start Recording',
    'Durdur': 'Stop',
    'Kaydediliyor…': 'Saving…',
    'Dosya yazılıyor…': 'Writing file…',
    'Anlık Görüntü': 'Snapshot',
    'Biçim': 'Format',
    'MP4 (H.264)': 'MP4 (H.264)',
    'WebM': 'WebM',
    'GIF': 'GIF',
    'Kare Hızı': 'Frame Rate',
    'Süre Sınırı': 'Time Limit',
    'sınırsız': 'unlimited',
    'Bit Hızı': 'Bit Rate',
    'GIF Kare Hızı': 'GIF Frame Rate',
    'GIF Genişliği': 'GIF Width',
    'Anlık Görüntü Ölçeği': 'Snapshot Scale',
    'GIF iki geçişte üretilir: önce sahneye özel renk paleti çıkarılır, sonra o paletle kodlanır. Tek geçişte sonuç gözle görülür biçimde bantlanır.':
      'The GIF is made in two passes: a palette is derived from the scene, then the encode uses it. A single pass bands visibly.',
    'Kayıt paneldeki canlı önizlemeden alınır ve o anki sesle birlikte ekranda göründüğü gibi kaydedilir — modülasyon, geçişler, efektler dahil. Bir ses dosyasının tamamını yüksek çözünürlükte işlemek için Video Dışa Aktarma kartını kullanın.':
      'Recording is taken from the live preview in the panel and captures what is on screen with the audio playing at that moment — modulation, transitions and effects included. To render a whole audio file at full resolution, use the Video Export card.',
    'Kayıt motoru yok.': 'No recording engine.',
    'Önizleme yüzeyi hazır değil; bir an sonra yeniden deneyin.': 'The preview surface is not ready; try again in a moment.',
    'Önizleme yüzeyi hazır değil.': 'The preview surface is not ready.',
    'Görüntü alınamadı.': 'The image could not be captured.',
    'Kayıt tamamlandı.': 'Recording complete.',
    'Anlık görüntü kaydedildi.': 'Snapshot saved.',
    'Kaydetme iptal edildi.': 'Saving cancelled.',

    // ---- Katman grupları, maskeler, bayraklar ----
    'A/B Çapraz Geçiş Etkin': 'A/B Crossfade Enabled',
    'Fader': 'Fader',
    'Fader Eğrisi': 'Fader Curve',
    'Grup': 'Group',
    'Grup ve Fader': 'Group & Fader',
    'grup adı (boş = gruplanmamış)': 'group name (empty = ungrouped)',
    'Henüz grup yok. Katman kartındaki Grup ve Fader bölümünden bir grup adı yazın.':
      'No groups yet. Type a group name in the Group & Fader section of a layer card.',
    'Fader "A" ve "B" gruplarına atanmış katmanları karşılıklı kısar. Katman kartındaki Grup ve Fader bölümünden bir katmana A ya da B yazın.':
      'The fader trades off layers assigned to the "A" and "B" groups. Put A or B in the Group & Fader section of a layer card.',
    'Grup faderı katman saydamlığıyla çarpılır; katmanın kendi ayarı korunur.':
      'The group fader multiplies layer opacity; the layer keeps its own setting.',
    'Aynı gruptaki katmanlar Katman Grupları kartındaki tek fader ile birlikte kısılır. Doğrusal bir fader görsel olarak doğrusal davranmaz; üstel eğri gerçek bir kısma hissi verir.':
      'Layers in the same group are driven together by the single fader on the Layer Groups card. A linear fader does not look linear; the exponential curve gives a real sense of fading.',
    'Grubu sustur': 'Mute group',
    'Solo — yalnızca solo katmanlar çizilir': 'Solo — only soloed layers are drawn',
    'Sessiz — katmanı ayarlarını kaybetmeden gizler': 'Mute — hides the layer without losing its settings',
    'Kilit — kazara düzenlemeyi engeller': 'Lock — prevents accidental edits',
    'Maske': 'Mask',
    'Şekil': 'Shape',
    'Dikdörtgen': 'Rectangle',
    'Elips': 'Ellipse',
    'Doğrusal Gradyan': 'Linear Gradient',
    'Işınsal Gradyan': 'Radial Gradient',
    'Maske için başka katman yok.': 'There is no other layer to use as a mask.',
    'Tersine Çevir': 'Invert',
    'Maske katmanın kendi tuvaline uygulanır; dönüşümle birlikte hareket etmez ve karışım modundan bağımsızdır. Shader tabanlı katmanlarda (Studio, gradyan) 2B maske uygulanamaz.':
      'The mask is applied to the canvas of the layer itself, so it does not move with the transform and is independent of the blend mode. A 2D mask cannot be applied to shader-based layers (Studio, gradient).',
    '— efekt ekle —': '— add effect —',
    'Ekle': 'Add',
    'Bu zincir yalnızca bu katmana uygulanır; sahnenin geneline uygulanan Efekt Zinciri kartından bağımsızdır.':
      'This chain applies to this layer only, independently of the scene-wide Effect Chain card.',
    'Yapıştır': 'Paste',
    'Katmanı panoya al; başka bir sahnede yapıştırılabilir': 'Copy the layer to the clipboard; it can be pasted into another scene',

    // ---- Metin ve şarkı sözü ----
    'Metin ve Şarkı Sözü': 'Text & Lyrics',
    'Sabit metin, zamanlanmış şarkı sözü (LRC / SRT, karaoke vurgusuyla) ya da çalan parça bilgisi.':
      'Static text, timed lyrics (LRC / SRT with karaoke highlighting), or the currently playing track.',
    'Metin Etkin': 'Text Enabled',
    'Kayan Yazı': 'Marquee',
    'Kayma Hızı': 'Scroll Speed',
    'Uzun Yazıyı Kaydır': 'Scroll Long Text',
    'Kaydırma Hızı': 'Scroll Speed',
    'Yazı bu genişliğe sığmazsa ileri geri kayar. Kayan yazı açıkken o döngü kullanılır.':
      'Text wider than this box scrolls back and forth. When marquee is on, that loop is used instead.',
    'Yazı ekrana ya da bu genişliğe sığmazsa kutu ekranın içinde kalır ve yazı ileri geri kayar. Kayan yazı açıkken o döngü kullanılır.':
      'If the text does not fit the screen or this width, the box stays on screen and the text scrolls back and forth. When marquee is on, that loop is used instead.',
    'Söylenen kısmı boyar. Sabit yazı ve çalan parça bu rengi kullanmaz.':
      'Colors the part being sung. Static text and now playing do not use this color.',
    'Başlık': 'Title',
    'Sanatçı': 'Artist',
    'Dosya': 'File',
    'yüklü dosya yok': 'no file loaded',
    'Söz Dosyası Yükle': 'Load Lyrics File',
    'Temizle': 'Clear',
    'Çalan Parçayı İzle': 'Follow the Playing Track',
    'Eşleme': 'Matching',
    'Tam Eşleme': 'Exact Match',
    'Kısmen Eşleme': 'Partial Match',
    'Söz Kütüphanesi': 'Lyrics Library',
    'Söz Kütüphanesine Ekle': 'Add Lyrics to Library',
    'Çalan Parçayı Yaz': 'Write the Playing Track',
    'Kütüphanede söz yok. LRC veya SRT ekleyin.': 'No lyrics in the library yet. Add an LRC or SRT file.',
    'Söz kütüphanesindeki dosyayla eşleşir ve çalan parçanın süresiyle gider.': 'Matches a file in the lyrics library and follows the playing track position.',
    'Açık ekranlar bu saatle birlikte gider. Durdur başa alır.': 'Open screens follow this clock. Stop returns to the start.',
    'Düzenle': 'Edit',
    'Sözü Düzenle': 'Edit Lyrics',
    'Düzenlemeye dön': 'Back to editing',
    'Düzenleyici kapatılsın mı?': 'Close the editor?',
    'Kaydedilmemiş değişiklikler silinecek.': 'Unsaved changes will be discarded.',
    'Bu metin kütüphanedeki kopyadır. Kaydetmek bu kopyayı değiştirir; içe aktardığınız özgün dosya olduğu yerde kalır.': 'This is the copy stored in the library. Saving changes that copy. The original file you imported stays where it is.',
    'Söz dosyası okunamadı.': 'The lyrics file could not be read.',
    'Söz kaydedilemedi.': 'The lyrics could not be saved.',
    'Söz boş olamaz.': 'Lyrics cannot be empty.',
    'Söz çok büyük.': 'The lyrics file is too large.',
    'Söz kaydedildi.': 'Lyrics saved.',
    'Düzenleme kullanılamıyor.': 'Editing is unavailable.',
    'Eşleşen söz': 'Matched lyrics',
    'Oynatıcı sözü': 'Player lyrics',
    'Eşleşme yok': 'No match',
    'Parça algılanmadı': 'No track detected',
    'LRC ve SRT desteklenir; biçim dosyanın içeriğinden anlaşılır. Gelişmiş LRC dosyasındaki kelime zamanları varsa karaoke vurgusu kelime kelime ilerler, yoksa satır boyunca düzgün akar.':
      'LRC and SRT are both supported, and the format is detected from the file contents. If enhanced LRC word timings are present the karaoke highlight moves word by word; otherwise it sweeps evenly across the line.',
    'LRC ve SRT desteklenir; biçim dosyanın içeriğinden anlaşılır. Gelişmiş LRC\'deki kelime zamanları varsa karaoke vurgusu kelime kelime ilerler, yoksa satır boyunca düzgün akar.':
      'LRC and SRT are supported; format is detected from file content. If word timings exist in enhanced LRC, karaoke highlighting advances word-by-word, otherwise it flows smoothly across the line.',
    'Sistem': 'System',
    'Serif': 'Serif',
    'Tek Aralıklı': 'Monospace',
    'Ağır Başlık': 'Heavy Display',
    'Yuvarlak': 'Rounded',
    'Kendi Rengim': 'Custom Colour',
    'Metin Rengi': 'Text Colour',
    'Vurgu Rengi': 'Highlight Colour',
    'Renkler sahne paletinden alınır; palet değişince metin de değişir.':
      'Colours come from the scene palette, so changing the palette changes the text too.',
    'Hareket ve Ses': 'Motion & Audio',
    'Giriş': 'Entrance',
    'Giriş Süresi': 'Entrance Duration',
    'Titreşim': 'Jitter',
    'Harf Harf Tepki': 'Per-Character Response',
    'Harf Yükselmesi': 'Character Lift',
    'satır okundu (LRC)': 'lines read (LRC)',


    'Metin': 'Text',
    'Metin / Şarkı Sözü': 'Text / Lyrics',
    'Metin Kaynağı': 'Text Source',
    'Yazı Metni': 'Text Content',
    'Yazı Boyutu': 'Font Size',
    'Örn: Bohemian Rhapsody': 'e.g. Bohemian Rhapsody',
    'Örn: Queen': 'e.g. Queen',
    'Örn: Sanatçı Adı': 'e.g. Artist Name',
    'Örn: Şarkı Başlığı': 'e.g. Song Title',
    'Örn: Şarkı Adı': 'e.g. Song Name',

    // ---- Çalan Parça (Now Playing) ve Şeffaf Arkaplan ----
    'Bilgisayarda çalan parçayı ekrana getirir: ad, sanatçı, geçen ve kalan süre, ilerleme çubuğu. Sürekli görünebilir ya da yalnızca parça değişince canlandırmayla belirir.':
      'Brings the currently playing track to the screen: title, artist, elapsed and remaining time, progress bar. Can stay visible continuously or appear with an animation only on track change.',
    'Şeffaf Arkaplan': 'Transparent Background',
    'Tam Ekran (Görev Çubuğu Dahil)': 'Full Display (Include Taskbar)',
    'Kapalıyken görselleştirici Windows görev çubuğunun dışında kalır (çalışma alanı). Açıkken tüm ekranı — görev çubuğu dahil — kaplar. Yalnızca şeffaf arkaplanda gerekir; opak tam ekran zaten görev çubuğunu örter. Canlı uygulanır; pencere yeniden kurulmaz.':
      'When off, the visualizer stays outside the Windows taskbar (work area). When on, it covers the full display — including the taskbar. Only needed with a transparent background; opaque fullscreen already covers the taskbar. Applies live; windows are not recreated.',
    'Şeffaf arkaplan açık: doku alfa kanalı ile gider. Alıcıda (OBS Spout Kaynağı, Resolume) ön-çarpımlı alfa / şeffaf zemin seçeneğini açın; aksi halde siyah zemin görünür.':
      'Transparent background is on: the texture includes an alpha channel. In the receiver (OBS Spout Source, Resolume) enable premultiplied alpha / transparent background, otherwise you will see a black fill.',
    'Şeffaf arkaplan Spout/Syphon çıkışına uygulanmaz (GPU dokusu alfa taşımıyor). Yerel pencere ve OBS tarayıcı kaynağı şeffaf kalır; bu çıkış sahneyi opak basar.':
      'Transparent background is not applied to Spout/Syphon (the GPU texture cannot carry alpha). The local window and OBS browser source stay transparent; this output paints the scene opaque.',
    'Şeffaf arkaplan açıkken görselleştirici pencerenin arkası görünür: düz renk arkaplan boyanmaz, arkaplan efektlerinin koyu yerleri saydamlaşır. Yayın katmanı (OBS) ve Spout/Syphon aynı ayarı kullanır. Pencere şeffaflığı doğuşta kilitlendiği için açık görselleştirici pencereleri bu anahtarla yeniden kurulur.':
      'When transparent background is on, the desktop behind the visualizer window shows through: a solid colour background is not painted, and the dark parts of background effects turn transparent. The streaming overlay (OBS) and Spout/Syphon use the same setting. Window transparency is locked at creation, so open visualizer windows are recreated when you toggle this.',
    'Şeffaf arkaplan bu katmanın koyu yerlerini saydamlar. Görselleştirici penceresi, yayın ve Spout aynı ayarı paylaşır; açık pencereler bu anahtarla yeniden kurulur.':
      'Transparent background keys out this layer’s dark areas. The visualizer window, streaming overlay and Spout share the same setting; open windows are recreated when you toggle this.',
    'Görselleştirici penceresi, yayın katmanı ve Spout/Syphon aynı anahtarı kullanır. Açık bir görselleştirici varsa pencereler bu ayara göre yeniden kurulur.':
      'The visualizer window, streaming overlay and Spout/Syphon share this switch. If a visualizer is open, its windows are recreated to match.',
    'Şeffaf arkaplan uygulama ayarıyla aynıdır: açıksa düz zemin boyanmaz, efektlerin koyu yerleri saydamlaşır; kapalıysa sahne olduğu gibi yayına girer.':
      'Transparent background is the same app setting: when on, a solid fill is not painted and dark parts of effects turn transparent; when off, the scene streams as you see it.',
    'Tek bir kaynak için adrese ?transparent=0 (opak) veya ?transparent=1 (şeffaf) ekleyebilirsiniz; ?fps=30 veya ?scale=0.75 ile o kaynağın yükünü ayrıca düşürebilirsiniz.':
      'For a single source you can add ?transparent=0 (opaque) or ?transparent=1 (transparent) to the address; use ?fps=30 or ?scale=0.75 to reduce that source’s load.',
    'Saydamlık Eşiği': 'Transparency Threshold',
    'Arkaplan efektinin bu parlaklığın altında kalan yerleri masaüstünü gösterir: siyah tamamen saydam, eşiğin üstü tamamen görünür. Canlı uygulanır.':
      'Parts of the background effect darker than this show the desktop: black is fully transparent, anything above the threshold fully visible. Applies live.',
    'Sistemden Oku': 'Read from System',
    'Elle Yaz': 'Manual Entry',
    'Sürekli Görünsün': 'Always Visible',
    'Parça Değişince': 'On Track Change',
    'Hızlı': 'Fast',
    'Yavaş': 'Slow',
    'Modern': 'Modern',
    'OG (Klasik)': 'OG (Classic)',
    'Daktilo': 'Typewriter',
    'Metin Katmanıyla Aynı': 'Same as Text Layer',
    'Sistemden okunamıyor': 'Cannot read from system',
    'Sistemden okuma yalnızca Windows’ta çalışıyor': 'System reading is only supported on Windows',
    'Şu anda bir şey çalmıyor': 'Nothing is currently playing',
    '(adsız)': '(untitled)',
    'okunuyor…': 'reading…',
    'Bilgi işletim sisteminin medya oturumundan okunur; Spotify, YouTube Music, tarayıcı ve çoğu oynatıcı desteklenir. Okunan bilgi bu bilgisayardan dışarı çıkmaz.':
      'Information is read from the operating system media session; Spotify, YouTube Music, browsers, and most media players are supported. Read data never leaves this machine.',
    'Albüm': 'Album',
    'Görünürlük': 'Visibility',
    'Ne Zaman': 'When',
    'Sabit durmak yerine yalnızca yeni parçaya geçince belirir, bir süre kalır ve söner.':
      'Instead of staying static, appears only when advancing to a new track, stays for a duration, then fades out.',
    'Ekranda Kalma': 'Hold Duration',
    'Gösterilecek Alanlar': 'Fields to Display',
    'Oynatıcı Adı': 'Player App Name',
    'Geçen Süre': 'Elapsed Time',
    'Kalan Süre': 'Remaining Time',
    'Toplam Süre': 'Total Duration',
    'İlerleme Çubuğu': 'Progress Bar',
    'Parça ve Sanatçı Tek Satırda': 'Track and Artist on One Line',
    'Ayırıcı': 'Separator',
    'Süre Ayırıcı': 'Time Separator',
    'Her alan tek tek kapatılabilir: yalnızca parça adı, yalnızca süre ya da yalnızca çubuk gösterilebilir.':
      'Each field can be toggled individually: show only the track name, only the time, or only the progress bar.',
    'Parça adı, sanatçı ve albüm tek tek kapatılabilir.':
      'Track title, artist, and album can each be turned off.',
    'Yazı ve Yerleşim': 'Typography & Layout',
    'Kalıp': 'Preset Style',
    'Büyük Harf': 'Uppercase',
    'Satır Aralığı': 'Line Gap',
    'En Fazla Genişlik': 'Maximum Width',
    'Uzun Adları Kaydır': 'Scroll Long Titles',
    'Bölme Sayısı': 'Segment Count',
    'kesintisiz': 'continuous',
    'Yazıyla Arası': 'Gap from Text',
    'Zemin Koyuluğu': 'Background Darkness',
    'Kendi Renklerim': 'Custom Colours',
    'İkincil Yazı': 'Secondary Text',
    'Çubuk': 'Progress Bar',
    'Etkin': 'Enabled',
    'Canlı Medya': 'Live Media',
    'Yedek Başlık': 'Fallback Title',
    'Yedek Sanatçı': 'Fallback Artist',
    'Yedek Parça Adı': 'Fallback Track Title',
    'Sistemden Otomatik Doldur': 'Auto Fill from System',
    'Yalnızca Windows': 'Windows Only',
    'Bu özellik şu anda yalnızca Windows (SMTC) üzerinde desteklenmektedir.':
      'This feature is currently only supported on Windows (SMTC).',
    'Sistem medya oturumunu (SMTC) otomatik okuma şu anda yalnızca Windows’ta desteklenmektedir. Başlık ve sanatçı bilgilerini aşağıdan elle girebilirsiniz.':
      'Automatic reading of the system media session (SMTC) is currently only supported on Windows. You can manually enter title and artist details below.',
    'Sistem medya oturumundan (Spotify, YouTube vb.) çalan parça otomatik okunur. Çalmadığında aşağıdaki yedek bilgiler gösterilir.':
      'The playing track is automatically read from the system media session (Spotify, YouTube, etc.). When nothing is playing, the fallback details below are shown.',
    'Sistem medya oturumundan (Spotify, YouTube, tarayıcı vb.) çalan parça otomatik okunur. Çalan bir şey olmadığında yukarıdaki yedek bilgiler gösterilir.':
      'The playing track is automatically read from the system media session (Spotify, YouTube, browser, etc.). When nothing is playing, the fallback details above are shown.',
    'Sistemde çalan aktif parça bulunamadı.': 'No active playing track found on the system.',
    'Sistemde şarkı yokken gösterilecek başlık': 'Title to display when no song is playing on the system',
    'Sistemde şarkı yokken gösterilecek sanatçı': 'Artist to display when no song is playing on the system',
    'Şu an sistemde çalan parçanın başlık ve sanatçısını aşağıdaki yedek kutularına yazar.':
      'Writes the title and artist of the currently playing track into the fallback boxes below.',
    'Çalan parçanın adını ve sanatçısını aşağıdaki yedek kutularına aktarır.':
      'Transfers the title and artist of the playing track to the fallback boxes below.',
    'Çalan parça bilgileri yedek alanlara aktarıldı.': 'Playing track details transferred to fallback fields.',
    'Resim Kaynağı': 'Image Source',
    'Yalnızca çalan şarkının albüm kapağı/resmi gösterilir. Şarkı sözü / çalan parça sistemi aktifken şarkı çalınca otomatik devreye girer.':
      'Only the album cover/artwork of the playing track is shown. Automatically activates when a song plays while the lyrics / now-playing system is active.',
    'Yatay Konum (X)': 'Horizontal Position (X)',
    'Dikey Konum (Y)': 'Vertical Position (Y)',
    'Çalan Şarkıyı Alanlara Doldur': 'Fill Fields with Playing Track',
    'Çalan Şarkıyı Doldur (': 'Fill Playing Track (',
    'Çalan Şarkıyı Alanlara Doldur (': 'Fill Fields with Playing Track (',
    'Renkler sahne paletinden alınır; palet değişince yazı da değişir.':
      'Colours come from the scene palette, so changing the palette changes the text too.',
    'Şu anda sistemde çalan parça yok (yedek kullanılır)':
      'No track currently playing on system (using fallback)',
    'Şu anda sistemde çalan parça algılanmadı (yedek kullanılır)':
      'No track currently detected on system (using fallback)',
    'Otomatik (Şarkı resmi varsa göster, yoksa özel)':
      'Auto (Show track artwork if available, otherwise custom)',
    'Özel Resim (Yalnızca seçilen dosya)':
      'Custom Image (Selected file only)',
    'Sadece Çalan Şarkı Resmi':
      'Track Artwork Only',
    'Logo Seç': 'Choose Logo',
    'Logoyu Değiştir': 'Change Logo',
    'Çalan Şarkı Kapağı': 'Playing Track Artwork',
    'Özel resim modu: Şarkı çalsa dahi her zaman bu özel görsel gösterilir.':
      'Custom image mode: This custom image is always shown even if a track is playing.',
    'Yalnızca çalan şarkının albüm kapağı/resmi gösterilir. Şarkı sözü / çalan parça sistemi aktifken parça çalınca otomatik devreye girer.':
      'Only the album cover/artwork of the playing track is shown. Automatically activates when a song plays while the lyrics / now-playing system is active.',
    'Arka plan kontrol durumu, Dynamic Lighting etkinleştirildiğinde izlenir.':
      'Background control status is monitored when Dynamic Lighting is enabled.',
    'Renk Çeşitliliği': 'Color Variety',
    'Sıfırla': 'Reset',
    'Yüklendi.': 'Loaded.',
    'Medya': 'Media',
    'Studio Preset': 'Studio Preset',
    'Çıkışı': 'Output',
    'Ekranla Eşitle': 'Sync to Display',
    'CAYADEV Visualizer Ayarlarını İçe Aktar': 'Import CAYADEV Visualizer Settings',
    'Ayarlar dışa aktarılamadı:': 'Could not export settings:',
    'Ayarlar içe aktarılamadı:': 'Could not import settings:',
    'Panel başlatılamadı': 'Could not initialize panel',
    'Uygulamayı yeniden başlatın. Sorun sürerse aşağıdaki ayrıntıyı bildirin.':
      'Restart the application. If the issue persists, report the details below.',
    'Varsayılandan farklı': 'Modified from default',
    'Ses aygıtları tanılanıyor…': 'Diagnosing audio devices…',
    'Ses aygıtı algılanamadı.': 'Audio device could not be detected.',
    'Ses aygıtı algılama zaman aşımına uğradı. Windows Ses hizmetini ve bağlı aygıtları kontrol edin.':
      'Audio device detection timed out. Check Windows Audio service and connected devices.',
    'Ses aygıtı algılama zaman aşımına uğradı. PulseAudio veya PipeWire servisini ve bağlı aygıtları kontrol edin.':
      'Audio device detection timed out. Check the PulseAudio or PipeWire service and connected devices.',
    'Ses aygıtı algılama zaman aşımına uğradı. macOS Ses ayarlarını ve bağlı aygıtları kontrol edin.':
      'Audio device detection timed out. Check macOS Sound settings and connected devices.',
    'Etkin ses aygıtı bulunamadı. Windows Ses ayarlarını kontrol edin ve aygıtı yeniden bağlayın.':
      'No active audio device found. Check Windows Audio settings and reconnect the device.',
    'Etkin ses aygıtı bulunamadı. PulseAudio veya PipeWire çalışıyor mu ve bir monitor kaynağı görünüyor mu kontrol edin.':
      'No active audio device found. Check that PulseAudio or PipeWire is running and a monitor source is available.',
    'Etkin ses aygıtı bulunamadı. macOS Ses ayarlarını kontrol edin ve aygıtı yeniden bağlayın.':
      'No active audio device found. Check macOS Sound settings and reconnect the device.',
    'Windows ses sistemine erişimi engelledi. Ses gizlilik/güvenlik ayarlarını kontrol edip uygulamayı yeniden başlatın.':
      'Windows blocked access to audio system. Check audio privacy/security settings and restart the application.',
    'Ses alt sistemine erişim engellendi. PulseAudio/PipeWire izinlerini kontrol edip uygulamayı yeniden başlatın.':
      'Access to the audio subsystem was denied. Check PulseAudio/PipeWire permissions and restart the application.',
    'macOS ses alt sistemine erişimi engelledi. Ses ve Gizlilik ayarlarını kontrol edip uygulamayı yeniden başlatın.':
      'macOS blocked access to the audio subsystem. Check Sound and Privacy settings and restart the application.',
    'Ses yardımcı dosyaları kurulumda eksik. Uygulamayı yeniden kurun veya onarın.':
      'Audio helper files missing from installation. Reinstall or repair the application.',
    'Ses yardımcı süreci başlatılamadı.': 'Could not start audio helper process.',
    'Ses yardımcı süreci beklenmedik şekilde kapandı.': 'Audio helper process exited unexpectedly.',
    'Ses yardımcı süreci geçersiz veri döndürdü.': 'Audio helper process returned invalid data.',
    'Native ses modülü eksik. Uygulamayı yeniden kurun veya onarın.':
      'Native audio module missing. Reinstall or repair the application.',
    'Native ses modülü bu Node.js sürümüyle uyumsuz. Node.js LTS ve uygulamayı yeniden kurun.':
      'Native audio module incompatible with this Node.js version. Install Node.js LTS and reinstall the application.',
    'Node.js bulunamadı. Node.js LTS kurun veya PATH ayarını onarın.':
      'Node.js not found. Install Node.js LTS or fix PATH environment variable.',
    'Otomatik onarım başlatılamadı': 'Automatic repair could not start',
    'Otomatik yeniden deneme başarısız oldu.': 'Automatic retry failed.',
    'Bu hata için güvenli otomatik kurulum yok; yukarıdaki öneriyi uygulayın.':
      'No safe automatic installation for this error; apply the suggestion above.',
    'Ses aygıtı tanılaması başarısız': 'Audio device diagnosis failed',
    'Her LED, görselleştiricide aynı konuma denk gelen barın renk ve yüksekliğini kullanır. Bas solda, tiz sağda ilerler.':
      'Each LED uses the color and height of the corresponding bar in the visualizer. Bass on left, treble on right.',
    'LED dizisinin ilk kısmı bas, ortası mid ve son kısmı tiz frekanslarına ayrılır.':
      'The first part of the LED array is assigned to bass, middle to mid, and end to treble frequencies.',
    'Arka planın seçili renk şablonu, akış hızı ve ses tepkisi aynı anda ışıklara taşınır.':
      'The background’s selected color preset, flow speed, and audio response are transferred to lights simultaneously.',
    'Anında Kes (Animasyonsuz)': 'Instant Cut (No Animation)',
    'Sönümleme (Yumuşak Karart)': 'Crossfade (Smooth Blackout)',
    'Görüntü kaydediliyor…': 'Recording video…',
    'Kaydetme API\'si hazır değil.': 'Recording API is not ready.',
    'Kayıt başlatılamadı:': 'Could not start recording:',
    'Yüzey hazırlanıyor…': 'Preparing surface…',
    'arkaplan katmanları': 'background layers',
    'ön katmanlar': 'foreground layers',
    'deste kararsız çalışıyor': 'deck is unstable',
    'parça zaman çizelgesine eklendi.': 'track added to timeline.',
    'yuvanın kaynağı seçilmemiş; onlar atlanacak.': 'slot source not selected; they will be skipped.',
    'dosya atlandı': 'files skipped',
    'tanesinde derleme uyarısı var)': 'have compilation warnings)',
    'aynı vuruşta': 'on the same beat',
    'işaret üretildi.': 'markers generated.',
    'İşaret': 'Marker',
    '· karaoke zamanlı': '· karaoke timed',
    'karaoke zamanlı': 'karaoke timed',
    'Görsel Nesneler (arka)': 'Visual Objects (back)',
    'Görsel Nesneler (ön)': 'Visual Objects (front)',
    'Halka Sayısı': 'Ring Count',
    'Halka Kalınlığı': 'Ring Thickness',
    'Akış': 'Flow',
    '4:5 (Gönderi)': '4:5 (Post)',
    'Sessiz': 'Muted',
    'Sustur': 'Mute',
    'Preset çok büyük (512 KB üstü).': 'Preset is too large (over 512 KB).',
    'Kamera erişimi bu ortamda kullanılamıyor.': 'Camera access is not available in this environment.',
    'Bu kamera başka bir uygulama tarafından kullanılıyor.': 'This camera is in use by another application.',
    'Kamera izni verilmedi. Sistem ayarlarından izin verin.': 'Camera permission was denied. Allow it in system settings.',
    'Seçilen kamera bulunamadı. Listeden başka bir kamera seçin.': 'The selected camera was not found. Choose another camera from the list.',
    'Kamera açılışı yarıda kesildi. Yeniden deneyin.': 'The camera start was interrupted. Try again.',
    'Kamera açılamadı.': 'The camera could not be opened.',
    'Kamera görüntüsü uygulamadan bekleniyor.': 'Waiting for the camera picture from the application.',
    'Kayıtlı kamera': 'Saved camera',
    'Kodlayıcı borusu kapandı. Dışa aktarma durduruldu.': 'The encoder pipe closed. Export was stopped.',
    'WebGL2 kullanılamıyor. Sürücü güncellemesi gerekebilir.': 'WebGL2 unavailable. Driver update may be required.',
    'WebGL2 kullanılamıyor': 'WebGL2 unavailable',
    'WebGL yok / desteklenmiyor: gradyan düz renge düştü':
      'WebGL missing / unsupported: gradient fell back to solid color',
    'bilinmeyen derleme hatası': 'unknown compile error',
    'bağlama hatası': 'link error',
    'Derleme hatası': 'Compilation error',
    'shader hatası': 'shader error',
    'link hatası': 'link error',
    'yazılamadı': 'could not be written',
    'Sürüklerken Alt tuşu yakalamayı geçici olarak kapatır. Tekerlek kaydırır, Ctrl+tekerlek yakınlaştırır.':
      'Holding Alt while dragging temporarily disables snapping. Wheel scrolls, Ctrl+wheel zooms.',

    // ---- MilkDrop motoru ----
    'Yüklü Preset': 'Loaded Preset',
    'Yerleşik varsayılan': 'Built-in default',
    'Adsız': 'Untitled',
    'Derleme': 'Compilation',
    '.milk Dosyaları Ekle': 'Add .milk Files',
    'Okunuyor…': 'Reading…',
    'Varsayılana Dön': 'Back to Default',
    'İçe aktarma kullanılamıyor.': 'Import is not available.',
    'Dosya eklenemedi: biçim desteklenmiyor, dosya boş ya da çok büyük.': 'The file was not added: the format is not supported, or the file is empty or too large.',
    'Seçilen dosya kitaplıkta zaten var; yeniden eklenmedi.': 'The chosen file is already in the library; it was not added again.',
    'Ara': 'Search',
    'preset adı': 'preset name',
    'Aramaya uyan preset yok.': 'No preset matches the search.',
    'Preset listesi yüklenemedi. Bir MilkDrop paketindeki .milk dosyalarını ekleyebilirsiniz; hepsi bir kerede seçilebilir.':
      'The preset list could not be loaded. You can add the .milk files from a MilkDrop pack — they can all be selected at once.',
    /* 'yerleşik' anahtarı Studio bölümünde zaten var (aynı nesne). */
    'CAYADEV presetleri': 'CAYADEV presets',
    /* Yerleşik MilkDrop presetlerinin adları: listede ve "Yüklü Preset"
       satırında görünüyorlar. */
    'Kutup Işığı': 'Aurora',
    'Erimiş Altın': 'Molten Gold',
    'Dingin Halkalar': 'Still Rings',
    'Sonsuz Tünel': 'Endless Tunnel',
    'Nabız Örgüsü': 'Pulse Weave',
    'Önceki': 'Previous',
    'Sonraki': 'Next',
    'Otomatik Geçiş': 'Auto Advance',
    'Geçiş Sırası': 'Advance Order',
    'Otomatik geçiş görselleştiricinin kendi saatiyle çalışır: panel kapalıyken ya da görselleştirici paneli örterken de durmaz. Geçilen preset ayarlara yazılmaz; Yüklü Preset satırı o an ekranda olanı gösterir. Rastgele sırada o an çizilen preset hiç seçilmez. Her geçişin süresi yukarıdaki Preset Geçişi ayarından gelir.':
      'Auto advance runs on the visualizer\'s own clock: it keeps going while the panel is closed or covered by the visualizer. The preset it moves to is not written to the settings; the Loaded Preset row shows what is on screen right now. In random order the preset currently showing is never picked. Each transition takes as long as the Preset Transition setting above.',
    'kapalı': 'off',
    'sn': 's',
    /* MilkDrop 2'nin zamanlaması (#568): kilit, rastgele pay, sert geçiş. */
    'Kilitli': 'Locked',
    'Otomatik geçişi ve sert geçişi durdurur; elle seçim çalışır':
      'Stops auto advance and hard cuts; choosing a preset by hand still works',
    'Rastgele Pay': 'Random Spread',
    'Sert Geçiş': 'Hard Cut',
    'MilkDrop 2 (ses yükselişi)': 'MilkDrop 2 (loudness jump)',
    // MilkDrop 3 biçimi ve sert geçiş kipleri (#567)
    'Preset Biçimi': 'Preset Format',
    'Otomatik': 'Automatic',
    'MilkDrop 3 kuralları 16 özel dalga ve şekil yuvası ve q1–q64 demek; MilkDrop 2 dörder yuva ve q1–q32. Otomatik her preseti yüklenirken inceler: 5. ve sonraki yuvaları, q33–q64\'ü ya da shader\'da get_fft ve mouse kullanıyorsa MilkDrop 3 kurallarıyla okur. MilkDrop 3\'ün .milk2 çift presetleri okunuyor: iki preset dosyanın deseni ve noktasında karışık çizilir (sprite bölümleri henüz yok). 8 yeni basit dalga biçimi, yeni geçişleri ve shader\'daki get_fft henüz yok: hiçbir yerde tarif edilmiyorlar.':
      'MilkDrop 3 rules mean 16 custom wave and shape slots and q1–q64; MilkDrop 2 has four slots each and q1–q32. Automatic inspects each preset as it loads and reads it with MilkDrop 3 rules if it uses the 5th and later slots, q33–q64, or get_fft and mouse in a shader. MilkDrop 3’s .milk2 double presets are read: the two presets are drawn mixed with the file’s pattern and at the file’s point (sprite sections are not yet supported). The 8 new simple waveforms, new transitions and get_fft in shaders are not here yet: nothing describes them.',
    'Seçili preset MilkDrop 3 uzantısı kullanıyor': 'The selected preset uses MilkDrop 3 extensions',
    '5.–16. dalga/şekil yuvası': '5th–16th wave/shape slot',
    '5. yuva (MilkDrop 2 yok sayar)': '5th slot (MilkDrop 2 ignores it)',
    'dalga kipi 8 ve üstü (MilkDrop 2 kalanı alır)': 'wave mode 8 and above (MilkDrop 2 takes the remainder)',
    'shader\'da get_fft': 'get_fft in a shader',
    'shader\'da mouse': 'mouse in a shader',
    'MilkDrop 3 · 1: bas > 1,5, en az 0,2 sn': 'MilkDrop 3 · 1: bass > 1.5, at least 0.2 s',
    'MilkDrop 3 · 2: tiz > 2,9, en az 0,5 sn': 'MilkDrop 3 · 2: treble > 2.9, at least 0.5 s',
    'MilkDrop 3 · 3: tiz > 2,9, en az 1 sn': 'MilkDrop 3 · 3: treble > 2.9, at least 1 s',
    'MilkDrop 3 · 4: tiz > 2,9, en az 3 sn; tiz > 8 hemen': 'MilkDrop 3 · 4: treble > 2.9, at least 3 s; treble > 8 at once',
    'MilkDrop 3 · 5: tiz > 2,9, en az 5 sn': 'MilkDrop 3 · 5: treble > 2.9, at least 5 s',
    'MilkDrop 3 · 6: bas > 1,5': 'MilkDrop 3 · 6: bass > 1.5',
    'MilkDrop 3\'ün kipleri: bas ya da tiz, kendi uzun ortalamasına göre, eşiği aşınca ve son geçişten bu yana en az o kadar süre geçtiyse karışmadan yeni presete geçilir. Eşik ve gecikmeler MilkDrop 3\'ün açıklamasından. 6. kipin çok yüksek basta belirli bir preseti yüklemesi ve 7. kipin efekt eklemesi tarif edilmediği için yok.':
      'MilkDrop 3’s modes: when bass or treble, each against its own long average, crosses the threshold and at least that long has passed since the last change, the next preset loads without a blend. Thresholds and delays come from MilkDrop 3’s own description. Mode 6 loading a particular preset on very loud bass and mode 7 adding an effect are not here, as neither is described.',
    'Sert Geçiş Eşiği': 'Hard Cut Threshold',
    'Eşik Toparlanması': 'Threshold Recovery',
    'Bas, orta ve tiz, her biri kendi uzun ortalamasına göre, birlikte eşiğin üç katını aşınca karışmadan yeni presete geçilir. Eşik her kesimde iki katına çıkar ve sonra tabanına döner: arka arkaya patlamalar arka arkaya kesim yapmaz. Kural ve varsayılanlar MilkDrop 2\'nin (2,5 ve 60 sn); oradaki gibi, toparlanma süresi sonunda eşiğin fazlası dörtte bire iner.':
      'When bass, mid and treble, each against its own long average, together exceed three times the threshold, the preset changes with no blend. The threshold doubles on every cut and then returns to its base, so a run of bursts does not become a run of cuts. The rule and the defaults are MilkDrop 2\'s (2.5 and 60 s); as there, the threshold\'s excess falls to a quarter by the end of the recovery time.',
    'Zamanlama MilkDrop 2\'ninki: aralık, geçiş bittikten sonra sayılmaya başlar ve rastgele pay her presette bir kez çekilir. Kilit otomatik geçişi ve sert geçişi durdurur; açılınca kalan süre kaldığı yerden sayar.':
      'The timing is MilkDrop 2\'s: the interval starts counting once the transition has finished, and the random spread is drawn once per preset. The lock stops auto advance and hard cuts; when released, the remaining time carries on from where it stopped.',
    /* Ölçüye bağlı geçiş (#571) */
    'Ölçü sayacı görselleştirici açıkken burada görünür.': 'The bar counter shows here while the visualizer is open.',
    'Tempo bulunamadı: ölçüler sayılamıyor, geçiş zamana düştü.': 'No tempo found: bars cannot be counted, so changes fall back to time.',
    'Ölçü kipinde tempo görselleştiricinin kendi sesinden kestirilir; BPM kilidi ve tap tempo Tempo ve Otomatik VJ bölümündeki ayardır. Geçiş ölçünün ilk vuruşunda başlar ve süresi en yakın tam vuruşa yuvarlanır, yani bir vuruşun üstünde biter. Tempo bulunamazsa ölçü sayısının iki katı saniyede, en az 4 saniyede bir geçilir.':
      'In bars the tempo is estimated from the visualizer\'s own audio; the BPM lock and tap tempo are the setting in Tempo & Auto VJ. A change starts on the first beat of a bar and its transition is rounded to whole beats, so it ends on a beat. With no tempo found, the preset changes every twice as many seconds as bars, and at least every 4 seconds.',
    /* Puan ve geçmiş (#569) */
    'Puan': 'Rating',
    'Puana Göre': 'By Rating',
    'Açık (MilkDrop gibi)': 'On (as in MilkDrop)',
    'Kapalı (eşit olasılık)': 'Off (equal chance)',
    /* Işık renkleri MilkDrop'tan (#589) */
    'Işık Renkleri': 'Light Colors',
    'Işık ayarındaki kaynak': 'Source set in Lighting',
    'MilkDrop görüntüsü (canlı)': 'MilkDrop picture (live)',
    'MilkDrop görüntüsü seçiliyken ışıklar rengini o anki kareden alır: görüntü soldan sağa sekiz dilime bölünür ve her dilimin parlak bölgelerinin rengi saniyede yaklaşık 30 kez okunur; ışıkların sırası dilimlerin sırasını izler. Işığın parlaklığını yine ışık kipi sesle belirler. Dynamic Lighting, OpenRGB ve Art-Net\'te çalışır; sahnede MilkDrop yoksa arkaplan renklerine döner.':
      'With the MilkDrop picture selected, the lights take their color from the current frame: the picture is cut into eight slices from left to right and the color of each slice\'s bright areas is read about 30 times a second; the order of the lights follows the order of the slices. The lighting mode still sets the brightness from the audio. Works with Dynamic Lighting, OpenRGB and Art-Net; with no MilkDrop in the scene it falls back to the background colors.',
    'Işık çıkışı kapalı: Aydınlatma bölümünden Dynamic Lighting, OpenRGB ya da Art-Net\'i açın.':
      'No light output is on: turn on Dynamic Lighting, OpenRGB or Art-Net in the Lighting section.',
    /* Her ekranda aynı preset (#585) */
    'Hepsinde aynı preset': 'Same preset on all',
    'Her ekran kendi seçer': 'Each display picks its own',
    'Hepsinde aynı presette seçimi ilk görselleştirici penceresi yapar — yoksa Spout/Syphon penceresi, o da yoksa bu önizleme — ve diğer pencereler, Spout/Syphon ve web çıkışı aynı preseti aynı geçişle gösterir. Her ekran kendi seçerse otomatik geçiş ve sert geçiş her ekranda ayrı çalışır; rastgele sırada her ekran başka bir preset gösterir. Önizleme her iki durumda da ilk pencereyi izler.':
      'With the same preset on all, the first visualizer window makes the pick — or the Spout/Syphon window if there is none, or this preview if neither is open — and the other windows, Spout/Syphon and the web output show the same preset with the same transition. If each display picks its own, auto advance and hard cuts run separately on each; in random order every display shows a different preset. Either way the preview follows the first window.',
    'Yıldızlar yalnız sizin verdiğiniz puanı gösterir; puan vermediğiniz preset boş görünür ve rastgele sırada kendi dosyasındaki fRating değeriyle (yoksa 3) seçilir. Rastgele sırada presetler puanlarıyla orantılı olasılıkla gelir ve 0 puanlı preset hiç gelmez — MilkDrop 2\'nin kuralı. Verdiğiniz puan ayarlara yazılır, preset dosyasına dokunulmaz. Önceki ve Sonraki ekranda gösterilenlerin geçmişinde gezer; otomatik geçişin seçtikleri de o geçmişte.':
      'The stars show only the rating you gave; a preset you have not rated looks empty and, in random order, is picked by the fRating value in its own file (or 3). In random order a preset comes up in proportion to its rating, and a preset rated 0 never comes up — MilkDrop 2\'s rule. The rating you give is written to the settings; the preset file is not touched. Previous and Next walk the history of what was shown, including what auto advance picked.',
    'MilkDrop preset dosyalarını (.milk) yükleyin. Denklem blokları gerçekten çalıştırılır: per_frame ve per_pixel hareketi, warp ağı ve geri besleme.':
      'Load MilkDrop preset files (.milk). The equation blocks really run: per_frame and per_pixel motion, the warp mesh and feedback.',
    'Denklem blokları (per_frame, per_pixel) ve MilkDrop 2 presetlerinin HLSL warp/composite shaderları gerçekten çalıştırılır: 10.332 presetlik bir korpustaki 16.346 shader aşamasının hepsi derleniyor. Şekiller, dalgalar, blur zinciri ve hareket vektörleri çizilir; preset dosyalarıyla gelmeyen kullanıcı dokuları, doku paketi seçilmediyse gürültüyle ikame edilir.':
      'The equation blocks (per_frame, per_pixel) and the HLSL warp/composite shaders of MilkDrop 2 presets really run: all 16,346 shader stages in a 10,332-preset corpus compile. Shapes, waves, the blur chain and motion vectors are drawn; user textures, which preset files do not ship, are substituted with noise unless a texture pack is chosen.',
    'Ağ Sıklığı': 'Mesh Density',
    '24x18 (en hızlı)': '24x18 (fastest)',
    '32x24 (MilkDrop varsayılanı)': '32x24 (MilkDrop default)',
    '48x36': '48x36',
    '64x48 (önerilen)': '64x48 (recommended)',
    '96x72': '96x72',
    '128x96 (en pürüzsüz)': '128x96 (smoothest)',
    'İç Çözünürlük': 'Internal Resolution',
    '0,75x (düşük güçlü makine)': '0.75x (low-powered machine)',
    '1x (tuval boyutu)': '1x (canvas size)',
    '1,5x': '1.5x',
    '2x (en keskin)': '2x (sharpest)',
    'İç çözünürlüğün maliyeti çarpanın karesi kadar artar: 2x seçildiğinde dört katı piksel işlenir. Ağ sıklığının maliyeti doğrusaldır ama her düğümde preset denklemleri yeniden koşar.': 'The cost of the internal resolution grows with the square of the factor: at 2x, four times the pixels are processed. The mesh density costs linearly, but the preset equations run again at every node.',
    'Preset Geçişi': 'Preset Transition',
    'Kapalı (sert kesme)': 'Off (hard cut)',
    '0,4 saniye': '0.4 seconds',
    '0,8 saniye': '0.8 seconds',
    '1,5 saniye': '1.5 seconds',
    '3 saniye': '3 seconds',
    '1,7 saniye (MilkDrop)': '1.7 seconds (MilkDrop)',
    '2,7 saniye (MilkDrop otomatik)': '2.7 seconds (MilkDrop automatic)',
    '5 saniye': '5 seconds',
    'Geçişte iki preset de çalışır: kare denklemleri, warp ağları ve shader\'ları aynı anda koşar ve ekranın farklı yerleri farklı zamanda yeni presete döner. Maliyeti neredeyse tam iki katı: 1280×720\'de ve varsayılan 64\'lük ağda kare süresi 2,7 ms\'den 5,2 ms\'ye çıkıyor, yani 60 fps bütçesinin %31\'i. En yoğun ağda (96) bu oran %67 oluyor.': 'Both presets run during a transition: their frame equations, warp meshes and shaders all run at once, and different parts of the screen turn over to the new preset at different times. It costs close to exactly twice as much: at 1280x720 with the default mesh of 64 the frame goes from 2.7 ms to 5.2 ms, which is 31% of a 60 fps budget. At the densest mesh (96) it is 67%.',
    // ---- Çizgi çizimi ----
    'Çizgi Çizimi': 'Line Rendering',
    'Yumuşatılmış (ışık korumalı)': 'Anti-aliased (brightness preserved)',
    'Yumuşatılmış (gerçek kalınlık)': 'Anti-aliased (true width)',
    'MilkDrop (kaydırmalı kalınlaştırma)': 'MilkDrop (fattened by offset redraws)',
    // ---- Flaş sınırlama ----
    'Flaş Sınırlama': 'Flash Limiting',
    'Açık (nöbet riskini kes)': 'On (cut seizure risk)',
    'Kapalı (ham görüntü)': 'Off (raw output)',
    'Ölçüt WCAG 2.3.1\'in genel flaş tanımı: bağıl parlaklıkta 0,10\'dan büyük ve saniyede üçten fazla değişim. Ölçüldü: presetlerin %90\'ı bu eşiğin altında kalıyor ve hiç etkilenmiyor; sınırlama yalnızca kalan %10\'da devreye giriyor ve orada da kesme değil oranlama yapıyor — eşiği on kat aşan bir flaş onda bir geçiyor. Sınır kare başına değil saniye başına tutuluyor: 30 fps\'te kare başına 0,10, 60 Hz\'lik ekranda 0,05 — yenileme hızı yüksek bir ekranda da aynı sıkılıkta.': 'The criterion is WCAG 2.3.1\'s general flash: a change in relative luminance greater than 0.10, more than three times a second. Measured: 90% of presets stay under that threshold and are untouched; the limiting engages only on the remaining 10%, and even there it scales rather than clips — a flash ten times over the threshold gets through at a tenth. The limit is held per second, not per frame: 0.10 per frame at 30 fps, 0.05 on a 60 Hz display — just as strict on a high-refresh screen.',
    // ---- MilkDrop uyumu ----
    'MilkDrop Uyumu': 'MilkDrop Fidelity',
    'Açık (MilkDrop değerleri)': 'On (MilkDrop values)',
    'Kapalı (motorun eski yaklaşımı)': 'Off (the engine’s earlier approximation)',
    'Açıkken motor MilkDrop\'un kendi değerlerini kullanır: gürültü dokularının kafes ölçekleri, gerçekten üç boyutlu hacim gürültüsü, ekran boyunca değişen renk kayması, doğru bulanıklık ölçeği ve kenar karartması, ağın MilkDrop sırasıyla kurulan dönüşümü (dikey yön, en-boy, yarıçap ve açı), warp titreşiminin kendi ölçeği ve hızı, dalga yumuşatma, sese göre dalga saydamlığı, özel dalgaların gerçek genliği ve tayf kaynağı, dış/iç kenarlıklar ve merkez karartma. Kapalı hâl motorun daha önceki yaklaşık değerlerini geri verir; presetler iki durumda da çalışır, yalnız görüntü farklıdır.': 'When on, the engine uses MilkDrop’s own values: the lattice scales of the noise textures, volume noise that really is three-dimensional, the hue shift that varies across the screen, the correct blur scale and edge darkening, the mesh transform built in MilkDrop’s own order (vertical direction, aspect, radius and angle), the warp ripple’s own scale and speed, waveform smoothing, volume-driven waveform alpha, the real amplitude and spectrum source of custom waves, the outer and inner borders, and the centre darkening. Off restores the engine’s earlier approximate values; presets run either way, only the picture differs.',
    // ---- Doku paketi (#560 madde 2) ----
    'Doku Paketi': 'Texture Pack',
    'Doku Klasörü Seç': 'Choose Texture Folder',
    // ('Kaldır' aşağıda zaten var — sözlükte her anahtar bir kez yazılır)
    'Doku klasörü seçimi kullanılamıyor.': 'Choosing a texture folder is not available.',
    'Seçilmedi — presetin kendi dokusu yerine gürültü kullanılıyor':
      'Not chosen — noise is used in place of the preset’s own texture',
    'Bu klasörde görsel dosyası yok': 'There are no image files in this folder',
    'görsel bulundu': 'images found',
    'MilkDrop presetleri dokularını ada göre ister: sampler_worms yazan bir preset klasörde worms.jpg arar. Bu görseller preset paketleriyle gelmez; MilkDrop kurulumunuzdaki textures klasörünü gösterin. Klasör seçilmezse preset yine çalışır, yalnız o dokunun yerine gürültü kullanılır.':
      'MilkDrop presets ask for their textures by name: a preset writing sampler_worms looks for worms.jpg in the folder. Preset packs do not ship these images; point this at the textures folder of your MilkDrop installation. Without a folder the preset still runs, only that texture is replaced with noise.',
    // ---- Sprite'lar (#577) ----
    'Sprite Dosyası': 'Sprite File',
    'milk_img.ini Seç': 'Choose milk_img.ini',
    'Yenile': 'Refresh',
    'Seçilmedi': 'Not chosen',
    'sprite tanımlı': 'sprites defined',
    'Başlat': 'Launch',
    'Bu numaranın hepsini sil': 'Remove every sprite with this number',
    'En Yeniyi Sil': 'Remove Newest',
    'En Eskiyi Sil': 'Remove Oldest',
    'Hepsini Sil': 'Remove All',
    'Sprite dosyası seçimi kullanılamıyor.': 'Choosing a sprite file is not available.',
    'Sprite dosyası seçilmedi': 'No sprite file chosen',
    'milk_img.ini okunamadı': 'milk_img.ini could not be read',
    'Dosya çok büyük': 'The file is too large',
    'Numara 00 ile 99 arasında olmalı': 'The number must be between 00 and 99',
    'Bu numara milk_img.ini içinde tanımlı değil': 'This number is not defined in milk_img.ini',
    'img= satırı boş': 'The img= line is empty',
    'Resim yolu kabul edilmiyor: tam yolda sürücü yazılmalı, ya da yol ini dosyasının klasörüne göre olmalı':
      'Image path not accepted: a full path needs its drive letter, otherwise the path is relative to the ini file’s folder',
    'Desteklenmeyen resim biçimi (JPG, PNG, BMP, GIF, WebP)': 'Unsupported image format (JPG, PNG, BMP, GIF, WebP)',
    'Resim bulunamadı': 'Image not found',
    'Sprite başlatılamadı': 'The sprite could not be launched',
    'Sprite, MilkDrop görüntüsünün üstüne çizilen ve kendi koduyla hareket eden bir resimdir. MilkDrop\'un milk_img.ini dosyasını seçin; resim yolları o dosyanın klasörüne göredir. Görselleştirici penceresinde MilkDrop\'un tuşları da çalışır: K ve iki hane başlatır, SHIFT+K ve iki hane o numaranın hepsini siler, sprite kipinde DELETE en yeniyi, SHIFT+DELETE en eskiyi siler, CTRL+K hepsini siler. Bütün ekranlar aynı sprite\'ı gösterir; video dışa aktarımına girmez.':
      'A sprite is an image drawn over the MilkDrop picture and moved by its own code. Choose MilkDrop’s milk_img.ini file; image paths are relative to that file’s folder. MilkDrop’s keys work in the visualizer window too: K and two digits launch, SHIFT+K and two digits remove every sprite with that number, and in sprite mode DELETE removes the newest, SHIFT+DELETE the oldest, CTRL+K all of them. Every screen shows the same sprite; sprites are not part of video export.',
    'MilkDrop · Sprite: En Yeniyi Sil': 'MilkDrop · Sprite: Remove Newest',
    'MilkDrop · Sprite: En Eskiyi Sil': 'MilkDrop · Sprite: Remove Oldest',
    'MilkDrop · Sprite: Hepsini Sil': 'MilkDrop · Sprite: Remove All',
    // ---- Parça değişince (#582) — "Parça Değişince" yukarıda zaten var ----
    'Bir şey yapma': 'Do nothing',
    'Sıradaki presete geç': 'Go to the next preset',
    // ---- Hareketi azalt (#581) ----
    'Hareketi Azalt': 'Reduce Motion',
    'Sistemi izle': 'Follow the system',
    'Her zaman': 'Always',
    'Kapalı (sistem istese de)': 'Off (even if the system asks)',
    'Açık — bu ayarla': 'On — by this setting',
    'Açık — işletim sistemi hareketin azaltılmasını istiyor': 'On — the operating system asks for reduced motion',
    'Kapalı — sistem istiyor ama geçersiz kılındı': 'Off — the system asks for it, overridden here',
    'Kapalı — işletim sistemi istemiyor': 'Off — the operating system does not ask for it',
    'Flaş sınırlayıcı açık kalıyor, sesin yükselişinde sert geçiş olmuyor ve geçişler 5 saniye sürüyor. Elle "şimdi kes" yine keser. Video dışa aktarımında sistemin ayarı değil yalnız bu ayar ("Her zaman") geçerli.':
      'The flash limiter stays on, there are no hard cuts on a rise in the sound, and transitions last 5 seconds. A manual "cut now" still cuts. Video export follows this setting ("Always") only, not the system’s.',
    // ---- Favoriler, etiketler, yazar, havuz ve paket (#576) ----
    'Favori': 'Favourite',
    'Favorilere Ekle': 'Add to Favourites',
    'Etiketler': 'Tags',
    'virgülle ayırın: sakin, dans': 'comma-separated: calm, dance',
    'Bu presetten çıkar': 'Remove from this preset',
    'Bu presete ekle': 'Add to this preset',
    'ad, yazar ya da #etiket': 'name, author or #tag',
    'Süz': 'Show',
    'Favoriler': 'Favourites',
    'Yazar': 'Author',
    'Tüm yazarlar': 'All authors',
    'Favorilerden çıkar': 'Remove from favourites',
    'Favorilere ekle': 'Add to favourites',
    'Havuz': 'Pool',
    'Tüm presetler': 'All presets',
    'Havuz yalnız otomatik geçişi sınırlar: zamanlayıcı, sert geçiş ve parça değişimi yalnız bunlardan seçer. Önceki, Sonraki, Rastgele ve listeden seçim bütün presetlere gider.':
      'The pool limits auto advance only: the timer, hard cuts and track changes pick from it alone. Previous, Next, Random and picking from the list reach every preset.',
    'Havuzda tek preset var; otomatik geçiş bekliyor. Favori ekleyin ya da etiketleyin.':
      'The pool holds one preset; auto advance is waiting. Add favourites or tag presets.',
    'Havuzda preset yok; otomatik geçiş bekliyor. Favori ekleyin ya da etiketleyin.':
      'The pool is empty; auto advance is waiting. Add favourites or tag presets.',
    'Görünenleri Paketle': 'Pack What Is Shown',
    'Listede görünen kendi presetlerinizi favori, etiket ve puanlarıyla tek dosyaya yazar':
      'Writes your own presets shown in the list to one file, with their favourites, tags and ratings',
    'Paket İçe Aktar': 'Import Pack',
    'Bir .svpack paketini favori, etiket ve puanlarıyla ekler': 'Adds a .svpack pack with its favourites, tags and ratings',
    'Dışa aktarma kullanılamıyor.': 'Export is not available.',
    'Listede dışa aktarılacak kendi presetiniz yok.': 'The list shows none of your own presets to export.',
    'preset pakete yazıldı.': 'presets written to the pack.',
    'Paket okunamadı (.svpack ya da .svpreset bekleniyordu).': 'The pack could not be read (.svpack or .svpreset expected).',
    'preset içe aktarıldı.': 'presets imported.',
    // ---- Kütüphane içe aktarımı: ZIP, klasör, makinede arama (#574) ----
    'ZIP Paketinden İçe Aktar': 'Import from ZIP Pack',
    'Klasörden İçe Aktar': 'Import from Folder',
    'Makinede Ara': 'Search This Computer',
    'Bilinen kurulum klasörlerinde ve Masaüstü, İndirilenler, Belgeler, Müzik klasörlerinde MilkDrop kütüphanesi arar':
      'Looks for MilkDrop libraries in the usual install folders and in Desktop, Downloads, Documents and Music',
    'Klasör Adları': 'Folder Names',
    'Etiket yap': 'Make tags',
    'Etiket yapma': 'Don’t make tags',
    'Bulunan Kütüphaneler': 'Libraries Found',
    'İçe Aktar': 'Import',
    'Taranıyor…': 'Scanning…',
    'Makinede aranıyor…': 'Searching this computer…',
    'İçe aktarılıyor…': 'Importing…',
    'Okunuyor: {a}/{b}': 'Reading: {a}/{b}',
    'Kaydediliyor: {a}/{b}': 'Saving: {a}/{b}',
    'Dokular: {a}/{b}': 'Textures: {a}/{b}',
    '“{label}”: {p} preset, {t} doku, {mb} MB.': '“{label}”: {p} presets, {t} textures, {mb} MB.',
    '{n} .milk2 dosyası (MilkDrop 3 çift preseti) desteklenmiyor, atlanacak.':
      '{n} .milk2 files (MilkDrop 3 double presets) are not supported and will be skipped.',
    '{n} dosya boyut sınırını aşıyor, atlanacak.': '{n} files exceed the size limit and will be skipped.',
    '{n} şifreli ya da desteklenmeyen ZIP girdisi atlanacak.': '{n} encrypted or unsupported ZIP entries will be skipped.',
    'Tarama yarıda kesildi: çok fazla dosya var; bulunanlar alınır.': 'The scan stopped early: too many files; what was found will be imported.',
    '{n} klasör adı etiket olacak.': '{n} folder names will become tags.',
    'Aynı ad ve içerikteki presetler atlanır; dosyalar uygulamanın klasörüne kopyalanır. Devam edilsin mi?':
      'Presets with the same name and content are skipped; files are copied into the app’s own folder. Continue?',
    '{a} preset eklendi, {d} tekrar atlandı.': '{a} presets added, {d} duplicates skipped.',
    '{f} preset okunamadı ya da kaydedilemedi.': '{f} presets could not be read or saved.',
    '{c} doku kopyalandı.': '{c} textures copied.',
    '{s} doku zaten vardı.': '{s} textures were already there.',
    '{k} doku adı var olan başka bir dokuyla çakıştı; var olan kaldı.':
      '{k} texture names clashed with a different existing texture; the existing one was kept.',
    '{n} .milk2 dosyası atlandı (MilkDrop 3 çift preseti).': '{n} .milk2 files were skipped (MilkDrop 3 double presets).',
    'Bu kaynakta MilkDrop preseti yok.': 'There are no MilkDrop presets in this source.',
    'ZIP okunamadı: bozuk ya da ZIP değil.': 'The ZIP could not be read: it is damaged or not a ZIP.',
    'ZIP çok fazla girdi içeriyor.': 'The ZIP has too many entries.',
    'Kaynak çok büyük (2 GB üstü).': 'The source is too large (over 2 GB).',
    'Bu tarama artık geçerli değil; yeniden tarayın.': 'This scan is no longer valid; scan again.',
    'İçe aktarılamadı.': 'Could not import.',
    'Bilinen kurulum klasörlerinde ve Masaüstü, İndirilenler, Belgeler, Müzik klasörlerinde MilkDrop kütüphanesi bulunamadı.':
      'No MilkDrop library was found in the usual install folders or in Desktop, Downloads, Documents and Music.',
    '{p} preset · {t} doku · {mb} MB': '{p} presets · {t} textures · {mb} MB',
    '{p}+ preset · {t}+ doku · {mb}+ MB': '{p}+ presets · {t}+ textures · {mb}+ MB',
    'sayılmadı': 'not counted',
    'Aramanın süresi bazı kütüphaneleri saymaya yetmedi (+ ya da “sayılmadı”); içe aktarmadan önce tamamı taranır.':
      'The search ran out of time before it could count some libraries (+ or “not counted”); they are scanned in full before importing.',
    'Arama süre sınırına ulaştı, bazı klasörlere bakılamadı. Kütüphaneniz listede yoksa “Klasörden İçe Aktar” ile seçin.':
      'The search reached its time limit and some folders were not checked. If your library is not listed, choose it with “Import from Folder”.',
    'Presetlerin yanındaki {n} görselden yalnız presetlerin istediği kopyalanır.': 'Of the {n} images next to the presets, only the ones the presets ask for are copied.',
    // ---- Küçük resimler (#575) ----
    'Düzen': 'Layout',
    'Liste': 'List',
    // 'Izgara' → 'Grid' aşağıda arkaplan adlarıyla zaten var
    'Küçük resim hazırlanıyor…': 'Preparing thumbnail…',
    'Küçük resim çizilemedi': 'The thumbnail could not be drawn',
    'Küçük resim, presetin ilk iki saniyesi: örnek sesle, siyah bir ekrandan başlanarak çiziliyor. Her preset bir kez çiziliyor ve saklanıyor; preset değişince yeniden çiziliyor.':
      'A thumbnail shows the first two seconds of a preset, drawn with the demo sound from a black screen. Each preset is drawn once and kept, and drawn again when it changes.',
    'ZIP paketi, bir klasör ya da makinede bulunan bir kütüphane: önce ne ekleneceği gösterilir, onaylamadan hiçbir şey kopyalanmaz. İç içe klasörler ve dokular dahil; aynı ad ve içerikteki presetler atlanır. Dokular uygulamanın kendi klasörüne gider ve seçtiğiniz doku klasöründen sonra aranır. Uygulamayla hiçbir preset paketi gelmez. .milk2 (MilkDrop 3 çift preseti) dosyaları da eklenir.':
      'A ZIP pack, a folder or a library found on this computer: what will be added is shown first, and nothing is copied until you confirm. Nested folders and textures are included; presets with the same name and content are skipped. Textures go into the app’s own folder and are looked up after the texture folder you chose. No preset pack ships with the app. .milk2 (MilkDrop 3 double preset) files are added too.',
    'Sil': 'Delete',
    
    
    // ---- Yüzen PiP + pencere geometri kilidi ----
    'Yüzen pencere (PiP)': 'Floating window (PiP)',
    'Pencereyi dışarıdan kapatınca bu anahtar anında kapanır.': 'If you close the window elsewhere, this switch turns off right away.',
    'Ekrandan bağımsız küçük görselleştirici. Pencereyi dışarıdan kapatınca bu anahtar anında kapanır.': 'A small visualizer independent of the displays. If you close the window elsewhere, this switch turns off right away.',
    'Konum ve boyutu kilitle': 'Lock position and size',
    'Kilidi aç': 'Unlock',
    // ---- Genel Işık Ayarları (ortak görünüm + backend etiketleri) ----
    'Genel Işık Ayarları': 'General Light Settings',
    'Mod, renk ve ses tepkisi — Windows Dynamic Lighting ve OpenRGB ortak görünümü. Her ayarın hangi çıkışlarda geçerli olduğu yanında yazar. Art-Net kendi kartındaki ayarları kullanır.': 'Mode, colour and audio response — the shared look for Windows Dynamic Lighting and OpenRGB. Each control names the outputs it applies to. Art-Net uses the settings on its own card.',
    'Bu ayarlar Windows Dynamic Lighting ve OpenRGB çıkışlarının ortak görünümüdür. Art-Net kendi kartındaki ayarları kullanır. Bir çıkışı açmadan da burada düzenleyebilirsiniz.': 'These settings are the shared look for Windows Dynamic Lighting and OpenRGB. Art-Net uses the settings on its own card. You can edit them here even before turning an output on.',
    'Mod, renk ve ses tepkisi — OpenRGB çıkışı. Art-Net kendi kartındaki ayarları kullanır.': 'Mode, colour and audio response — the OpenRGB output. Art-Net uses the settings on its own card.',
    'Bu ayarlar OpenRGB çıkışının görünümüdür. Art-Net kendi kartındaki ayarları kullanır. Bir çıkışı açmadan da burada düzenleyebilirsiniz.': 'These settings are the look of the OpenRGB output. Art-Net uses the settings on its own card. You can edit them here even before turning an output on.',
    'Kayıtlı aydınlatma modu bu sistemde yok. Listeden OpenRGB\'nin sürebildiği bir mod seçin.': 'The saved lighting mode is not available on this system. Pick a mode from the list that OpenRGB can drive.',
    'Ortak görünüm ayarları (mod, parlaklık, ses tepkisi, renkler) aşağıda Genel Işık Ayarları kartındadır. Bu kartta yalnız Windows aygıtlarına özel renk boyama vardır.': 'Shared look settings (mode, brightness, audio response, colours) are in the General Light Settings card below. This card only has colour painting that is specific to Windows devices.',
    'Statik modlar (tek renk, aygıt başına, LED başına) yalnız Windows Dynamic Lighting ile çalışır. OpenRGB sesi izleyen dinamik modları sürer. Aygıt/LED renk boyası Windows Dynamic Lighting kartındadır.': 'Static modes (single colour, per device, per LED) work only with Windows Dynamic Lighting. OpenRGB drives the dynamic modes that follow the audio. Device/LED colour painting is on the Windows Dynamic Lighting card.',
    'OpenRGB parlaklığı OpenRGB kartındaki Parlaklık kaydırıcısındadır; buradaki değer Windows Dynamic Lighting içindir.': 'OpenRGB brightness is the Brightness slider on the OpenRGB card; the value here is for Windows Dynamic Lighting.',
    'OpenRGB kare hızı OpenRGB kartındaki Güncelleme Hızı kaydırıcısındadır.': 'OpenRGB frame rate is the Update Rate slider on the OpenRGB card.',
// ---- MilkDrop preset üretici (#579) ----
    // 'Enerji', 'Sıcaklık', 'Yoğunluk', 'Hareket', 'sakin', 'soğuk', 'sıcak', 'Tünel', 'Girdap', 'Yok',
    // 'Durum', 'Shader', '🎲 Karıştır' ve 'Kaydediliyor…' başka yerlerde zaten var
    'MilkDrop Preset Üretici': 'MilkDrop Preset Generator',
    'Enerji, sıcaklık, yoğunluk ve hareketten özgün bir MilkDrop preseti yazar ya da kütüphanenizdeki presetlerin parçalarını karıştırır. Tamamen çevrimdışı; beğendiğinizi kütüphaneye kaydedin.':
      'Writes an original MilkDrop preset from energy, warmth, density and motion, or mixes parts of the presets in your library. Fully offline; save the ones you like to the library.',
    'coşkun': 'energetic',
    'seyrek': 'sparse',
    'yoğun': 'dense',
    'yavaş': 'slow',
    'hızlı': 'fast',
    'Halkalar': 'Rings',
    'Akıntı': 'Current',
    'Çiçek': 'Bloom',
    'Nefes': 'Breath',
    'Birleştirme': 'Composite',
    'Warp ve birleştirme': 'Warp and composite',
    'MilkDrop paneli kullanılamıyor.': 'The MilkDrop panel is not available.',
    'Kod okunamadı. Biçim: enerji-sıcaklık-yoğunluk-hareket-tohum': 'Could not read the code. Format: energy-warmth-density-motion-seed',
    'Kaydetme kullanılamıyor.': 'Saving is not available.',
    'Üretici': 'Generator',
    'Preset kütüphaneye kaydedildi.': 'Preset saved to the library.',
    'Kaydedilemedi.': 'Could not save.',
    'Üretici yüklenemedi.': 'The generator could not be loaded.',
    'ör. 50-50-50-50-k3x9ab': 'e.g. 50-50-50-50-k3x9ab',
    'Kod': 'Code',
    'Preset Üret': 'Generate Preset',
    'Kaydırıcılardaki eksenlerle üretir ve yükler': 'Generates and loads a preset from the slider axes',
    'Aynı eksenler, başka bir tohum': 'Same axes, another seed',
    'Kütüphaneye Kaydet': 'Save to Library',
    'Dalgalar': 'Waves',
    'Şekiller': 'Shapes',
    'Son Üretilen': 'Last Generated',
    'Kütüphanede': 'In the library',
    'Önizleme — kaydedilmedi': 'Preview — not saved',
    // Kütüphaneden karışım (#579); 'Görünüm', 'Yok' ve '◀'/'▶' zaten var
    'Kütüphaneden Karışım': 'Mash-up from Your Library',
    'Yeni Karışım': 'New Mash-up',
    'Her parçayı listede görünen presetlerden rastgele çeker': 'Draws every part at random from the presets shown in the list',
    'Ekrandakinden Başla': 'Use On-Screen Preset',
    'Altı parçanın hepsini ekrandaki presetten alır; sonra tek tek değiştirin': 'Takes all six parts from the preset on screen; then change them one by one',
    'Bu parçayı yeniden çek': 'Draw this part again',
    'Önceki karışım': 'Previous mash-up',
    'Sonraki karışım': 'Next mash-up',
    'Son Karışım': 'Last Mash-up',
    'Listede preset yok.': 'The list has no presets.',
    'Listede bu parçası olan başka preset yok.': 'No other preset in the list has this part.',
    'Önce MilkDrop listesinden bir preset seçin.': 'Choose a preset from the MilkDrop list first.',
    'Parçalar MilkDrop panelinin listesinde görünen presetlerden çekilir; arama ve süzgeç burada da geçerli. Her parça bütünüyle tek bir presetten gelir ve satırları olduğu gibi kopyalanır. Bir presetin shader\'ı başka bir presetin denklemlerine göre yazılmış olabilir, yani sonuç şaşırtabilir. Warp ve birleştirme bazen "yok" çıkar: o zaman görünümün kendi yankısı ve gaması çalışır. Oklar önceki karışımlara döner.':
      'Parts are drawn from the presets shown in the MilkDrop panel’s list; its search and filter apply here too. Each part comes whole from one preset and its lines are copied as they are. A preset’s shader may have been written for another preset’s equations, so the result can surprise you. Warp and composite sometimes come out as “none”: then the look’s own echo and gamma run. The arrows go back to earlier mash-ups.',
    'Tamamen bu bilgisayarda çalışır, hiçbir servise bağlanmaz. Kaydırıcıyı bırakınca aynı tohumla yeniden üretilir; zar düğmesi başka bir tohum dener. Kod eksenleri ve tohumu taşır: aynı kod her zaman aynı preseti verir. Önizleme kütüphaneye yazılmaz; puan, favori ve etiket kaydettikten sonra açılır. Hareket, dalga, şekil ve shader kalıpları bu uygulamada yazıldı, hiçbir preset paketinden alınmadı.':
      'Runs entirely on this computer and connects to no service. Releasing a slider generates again with the same seed; the dice button tries another seed. The code carries the axes and the seed: the same code always gives the same preset. A preview is not written to the library; rating, favorite and tags open once you save it. The motion, wave, shape and shader patterns were written in this app, not taken from any preset pack.',
    // ---- MilkDrop preset düzenleyici (#578) ----
    // 'Dalgalar', 'Şekiller', 'Birleştirme', 'Metin', 'Dalga', 'Şekil', 'Ad', 'Durum', 'Kaydediliyor…',
    // '✓ Kütüphanede', 'Önizleme — kaydedilmedi' ve kaydetme uyarıları yukarıda
    'MilkDrop Preset Düzenleyici': 'MilkDrop Preset Editor',
    'Ekrandaki MilkDrop presetinin denklemlerini, dalgalarını, şekillerini ve shader\'larını düzenleyin; sonuç çalışan görüntüde hemen görünür. Hatalar presetin kendi satırını gösterir. Asıl preset hiç değişmez.':
      'Edit the equations, waves, shapes and shaders of the MilkDrop preset on screen; the result shows at once in the running picture. Errors point at the preset’s own line. The original preset never changes.',
    'Her Kare': 'Per Frame',
    'Piksel': 'Pixel',
    'Değerler': 'Values',
    'Başlangıç (init)': 'Start (init)',
    'Her kare (per_frame)': 'Every frame (per_frame)',
    'Her nokta (per_point)': 'Every point (per_point)',
    'Kare denklemleri': 'Frame equations',
    'Piksel denklemleri': 'Pixel equations',
    'Birleştirme shader': 'Composite shader',
    'Yakınlaşma (zoom)': 'Zoom',
    'Bükülme (warp)': 'Warp',
    'Dönme (rot)': 'Rotation (rot)',
    'Sönüm (decay)': 'Decay',
    'Yankı yakınlaşması': 'Echo zoom',
    'Yankı saydamlığı': 'Echo alpha',
    'düzenlendi': 'edited',
    'Çevrilemedi': 'Could not be translated',
    'Desteklenmiyor': 'Not supported',
    'Shader derlenmedi': 'The shader did not compile',
    'Parantez kapanmamış': 'Unclosed parenthesis',
    'Fazladan kapanan parantez': 'Extra closing parenthesis',
    'Bilinmeyen işlev': 'Unknown function',
    'Bu blokta hata var: MilkDrop bloğu bütünüyle atlar, hiçbir satırı çalışmaz.':
      'This block has an error: MilkDrop skips the whole block, none of its lines run.',
    'Ayrıştırılamadı': 'Could not be parsed',
    'Hata yok': 'No errors',
    'satır': 'line',
    'Hatalar': 'Errors',
    'Bu presetin sürüm satırı bu aşamanın shader\'ını kullanmıyor: MilkDrop metni yok sayıyor ve sabit yolu çiziyor. Kullanmak için dosyanın MILKDROP_PRESET_VERSION ve PSVERSION satırlarını Metin sekmesinden düzeltin.':
      'This preset’s version line does not use this stage’s shader: MilkDrop ignores the text and draws the fixed path. To use it, fix the file’s MILKDROP_PRESET_VERSION and PSVERSION lines in the Text tab.',
    'dosyada yok': 'not in the file',
    'Presetin denklemleri bu değeri her karede kendisinden yeniden hesaplıyor; kaydırıcı hesabın başladığı değeri değiştirir.':
      'The preset’s equations recompute this value from itself every frame; the slider changes the value the calculation starts from.',
    'Presetin denklemleri bu değeri her karede baştan yazıyor; kaydırıcının görüntüye etkisi olmaz.':
      'The preset’s equations overwrite this value every frame; the slider has no effect on the picture.',
    'Presetin metni': 'Preset text',
    'Presetin bütün metni. Burada yapılan değişiklik öteki sekmelere de geçer.':
      'The preset’s whole text. Changes made here carry over to the other tabs.',
    'Dalganın rengi, nokta sayısı ve açık/kapalı hâli dosyadaki wavecode satırlarında; Metin sekmesinden değiştirilebilir.':
      'A wave’s colour, point count and on/off state are in the file’s wavecode lines; change them in the Text tab.',
    'Şeklin kenar sayısı, konumu ve renkleri dosyadaki shapecode satırlarında; Metin sekmesinden değiştirilebilir.':
      'A shape’s side count, position and colours are in the file’s shapecode lines; change them in the Text tab.',
    'Düzenleyici': 'Editor',
    'Preset kütüphaneye kaydedildi. Asıl preset değişmedi.': 'Preset saved to the library. The original preset is unchanged.',
    'Düzenleyici yüklenemedi.': 'The editor could not be loaded.',
    'Ekrandakini Düzenle': 'Edit the Preset on Screen',
    'Ekrandaki MilkDrop presetini açar: denklemler, dalgalar, şekiller ve shader\'lar düzenlenir, sonuç çalışan görüntüde hemen görünür. Asıl preset hiç değişmez; beğendiğinizi yeni bir preset olarak kaydedin.':
      'Opens the MilkDrop preset on screen: edit its equations, waves, shapes and shaders, and the result shows at once in the running picture. The original preset never changes; save what you like as a new preset.',
    'Düzenlenen': 'Editing',
    'Kaydedileni Güncelle': 'Update the Saved Copy',
    'Yeni Preset Olarak Kaydet': 'Save as a New Preset',
    'Yeni Kopya': 'New Copy',
    'Baştan': 'Start Over',
    'Bütün değişiklikleri geri alır': 'Undoes every change',
    'Düzenleyiciyi kapatır; kaydedilmediyse asıl preset geri gelir': 'Closes the editor; if nothing was saved, the original preset comes back',
    'Değişiklik yazmayı bıraktıktan kısa süre sonra çalışan presete uygulanır. Düzenlerken otomatik geçiş duraklar. MilkDrop satırları araya bir şey koymadan birleştirir: deyimleri ; ile bitirin.':
      'A change reaches the running preset shortly after you stop typing. Automatic switching pauses while you edit. MilkDrop joins lines with nothing in between: end each statement with ;.',


    'MilkDrop': 'MilkDrop',
    'MilkDrop Presetleri': 'MilkDrop Presets',
    'MilkDrop motoru başlatılamadı': 'The MilkDrop engine could not start',

    // ---- Üretken görselleştirici modları ----
    'Üretken Sistemler': 'Generative Systems',
    'Ölçüm': 'Metering',
    'Akış Alanı': 'Flow Field',
    'Sürü': 'Flock',
    'Voronoi': 'Voronoi',
    'Truchet': 'Truchet',
    'Moiré': 'Moiré',
    'Dalga Girişimi': 'Wave Interference',
    'İpler': 'Ropes',
    'Galaksi': 'Galaxy',
    'DNA Sarmalı': 'DNA Helix',
    'İzometrik Şehir': 'Isometric City',
    'Çekici Alanı': 'Attractor Field',
    'Osiloskop (XY)': 'Oscilloscope (XY)',
    'Gonyometre': 'Goniometer',
    'Kroma Çemberi': 'Chroma Wheel',

    // ---- Ses çözümlemesi ----
    'Sinyalden çıkarılan canlı ölçümler: tonalite, akor, perde, gürlük, tını, armonik/vurmalı dengesi ve nota sınıfı dağılımı. Hepsi modülasyon matrisinde kaynak olarak kullanılabilir.':
      'Live measurements taken from the signal: key, chord, pitch, loudness, timbre, harmonic/percussive balance and pitch-class distribution. Every one of them is available as a modulation source.',
    'Nota C': 'Note C', 'Nota C#': 'Note C#', 'Nota D': 'Note D', 'Nota D#': 'Note D#',
    'Nota E': 'Note E', 'Nota F': 'Note F', 'Nota F#': 'Note F#', 'Nota G': 'Note G',
    'Nota G#': 'Note G#', 'Nota A': 'Note A', 'Nota A#': 'Note A#', 'Nota B': 'Note B',
    'Akıllı Sessizlik Filtresi': 'Smart Silence Filter',
    '50/60 Hz donanım uğultusu ve boşta dip gürültüsünü filtreler': 'Filters 50/60 Hz hardware hum and idle noise floor',
    'Donanım dip gürültüsü / şebeke uğultusu algılandı (50/60 Hz). Düzeltmeli moda geçmek için Akıllı Sessizlik Filtresini açabilirsiniz.':
      'Hardware noise floor / mains hum detected (50/60 Hz). You can enable the Smart Silence Filter to switch to corrected mode.',
    'Filtreyi Aç': 'Enable Filter',
    'Akıllı Sessizlik Filtresi etkinleştirildi.': 'Smart Silence Filter enabled.',
    'Açıkken 50/60 Hz donanım uğultusu ve boşta dip gürültüsü sessizlik sayılır. Temiz stüdyo donanımında ham analiz için kapatılabilir (müzikte kayıp olmaz; yalnızca çok kısık saf test sinyallerinde etkilidir).':
      'When enabled, 50/60 Hz hardware hum and idle noise floor are treated as silence. Can be disabled for raw analysis on clean studio hardware (no loss in music; only affects ultra-quiet pure test signals).',
    'Buradaki her ölçüm modülasyon matrisinde kaynak olarak kullanılabilir. Sahne sese tepki vermiyorsa önce buraya bakın: sinyal geliyor mu, tek kanal mı, sessizlik eşiğinin altında mı? Akıllı Sessizlik Filtresi müzikte hiçbir kayba yol açmaz (yalnızca 115 Hz altı aşırı kısık saf test sinyalleri hariç). Temiz stüdyo donanımlarında ham analiz için filtre kapatılabilir.':
      'Every measurement here can be used as a source in the modulation matrix. If a scene does not react to audio, check here first: is signal coming through, single channel, or below silence threshold? Smart Silence Filter causes no loss in music (except ultra-quiet pure test signals below 115 Hz). Can be disabled for raw analysis on clean studio hardware.',

    // ---- Modülasyon matrisi ----
    'Modülasyon Matrisi': 'Modulation Matrix',
    'Herhangi bir kaynağı (bas, LFO, zarf, makro, rastgele, tempo) herhangi bir sayısal ayara bağlayın. Kaydedilen ayarlar değişmez; modülasyon yalnızca çizim anında uygulanır ve dışa aktarımda da birebir çalışır.':
      'Connect any source (bass, LFO, envelope, macro, random, tempo) to any numeric setting. Your saved settings are never altered — modulation is applied at draw time only, and works identically on export.',
    'Bölüm': 'Division',
    'Hız (Hz)': 'Rate (Hz)',
    'Faz': 'Phase',

    // Kaynak grupları ve adları
    'Vuruş Zarfı': 'Beat Envelope',
    'Vuruş (tetik)': 'Beat (trigger)',
    'Spektrum': 'Spectrum',
    'Bant 1': 'Band 1', 'Bant 2': 'Band 2', 'Bant 3': 'Band 3', 'Bant 4': 'Band 4',
    'Bant 5': 'Band 5', 'Bant 6': 'Band 6', 'Bant 7': 'Band 7', 'Bant 8': 'Band 8',
    'Zarf 1': 'Envelope 1', 'Zarf 2': 'Envelope 2',
    'Makro 1': 'Macro 1', 'Makro 2': 'Macro 2', 'Makro 3': 'Macro 3', 'Makro 4': 'Macro 4',
    'Makro 5': 'Macro 5', 'Makro 6': 'Macro 6', 'Makro 7': 'Macro 7', 'Makro 8': 'Macro 8',

    // Dalga biçimleri

    // Eğriler ve kipler
    'Yumuşak': 'Eased',

    // Hedef katalogu grupları ve alan adları

    // ---- Mobil uzaktan kumanda (yayın sunucusunun servis ettiği sayfa) ----
    'CAYADEV Visualizer — Uzaktan Kumanda': 'CAYADEV Visualizer — Remote Control',
    'CAYADEV Visualizer — Yayın Katmanı': 'CAYADEV Visualizer — Streaming Overlay',
    'DEV Kumanda': 'DEV Remote',
    'Bağlanıyor…': 'Connecting…',
    'Bağlı': 'Connected',
    'CAYADEV Visualizer ile bağlantı yok — uygulama açık mı?': 'No connection to CAYADEV Visualizer — is the application running?',
    // Yayın katmanı tanı kartı, ?debug=1 (#565) — sayılar ayrı düğümde
    'Yayın katmanı tanılaması': 'Overlay diagnostics',
    'Bağlantı': 'Connection',
    'Yapılandırma': 'Configuration',
    'Sayfa çizimi': 'Page rendering',
    'Sürüm': 'Version',
    'Son hata': 'Last error',
    'bağlı': 'connected',
    'bağlanıyor': 'connecting',
    'bağlantı yok': 'not connected',
    'bağlantı hatası': 'connection error',
    'deneme': 'attempts',
    'geldi': 'received',
    'gelmedi': 'not received',
    'sn önce': 's ago',
    'dk önce': 'min ago',
    'kare/sn': 'frames/s',
    'son kare': 'last frame',
    'ses karesi gelmedi': 'no audio frames yet',
    'uygulama ayarı': 'app setting',
    'karartma': 'blackout',
    'yüklenemedi': 'failed to load',
    'Görselleştirme': 'Visualization',
    'Aç': 'Open',
    'Renk Şablonları': 'Color Presets',
    'Studio Presetleri': 'Studio Presets',
    'Önceki sahne': 'Previous scene', 'Sonraki sahne': 'Next scene',
    'Önceki şablon': 'Previous preset', 'Sonraki şablon': 'Next preset',
    'Önceki preset': 'Previous preset', 'Sonraki preset': 'Next preset',
    'sahne yok': 'no scenes', 'şablon': 'preset', 'preset': 'preset',
    'Kayıtlı sahne yok.': 'No saved scenes.',
    'Kayıtlı sahne yok. Bilgisayardaki panelden sahne kaydedin.': 'No saved scenes. Save one from the panel on your computer.',
    'Özel renkler': 'Custom colors', 'şablona uymuyor': 'no preset match',

    // Kumandadaki kısa mod adları
    'Nokta': 'Dots', 'Silüet': 'Skyline', 'Kutup': 'Polar', 'Helis': 'Helix',
    'Yıldız': 'Starfield', 'Bokeh': 'Bokeh', 'Yağmur': 'Rain',
    'Petek': 'Hex', 'Düz': 'Solid', 'Izgara': 'Grid', 'Gradyan': 'Gradient',
    'Kar': 'Snow',
    'Merkez': 'Center', 'Segment': 'Blocks', 'Nokta Matris': 'Dot Matrix', 'Işın': 'Starburst',
    'Nesneler': 'Objects',

    // ---- Studio Shader Presets & Parameter Labels ----
    'Bulut Katmanları': 'Cloud Layers',
    'Katmanlı fbm gürültüsü; bas alt katmanları şişirir.': 'Layered FBM noise; bass swells lower layers.',
    'Kıvrım Akışı': 'Curl Flow',
    'Curl gürültüsünde sürüklenen çizgiler.': 'Lines drifting through curl noise.',
    'Lav Lambası': 'Lava Lamp',
    'Yavaş yükselen metabol damlalar.': 'Slowly rising metaball blobs.',
    'Mürekkep Yayılması': 'Ink Diffusion',
    'Suya damlayan mürekkep; vuruşta yeni damla.': 'Ink dropping into water; new drop on beat.',
    'Duman Halkaları': 'Smoke Rings',
    'Kameraya doğru akan halkalar.': 'Rings flowing toward the camera.',
    'Petek Akışı': 'Hex Flow',
    'Altıgen ızgara; her hücre bir frekans bandına bağlı.': 'Hexagonal grid; each cell bound to a frequency band.',
    'Bükülmüş Izgara': 'Warped Grid',
    'Perspektif ızgara; bas yüzeyi büker.': 'Perspective grid; bass warps the surface.',
    'Truchet Örgü': 'Truchet Weave',
    'Vuruşta yön değiştiren çeyrek yaylar.': 'Quarter arcs reversing direction on beat.',
    'Moiré Girişimi': 'Moiré Interference',
    'Hafifçe farklı açılarda üst üste binen ızgaralar.': 'Grids overlapping at slightly different angles.',
    'Kristal Mağara': 'Crystal Cave',
    'Voronoi hücreleri, kristal kenarlarıyla.': 'Voronoi cells with crystalline edges.',
    'Mandelbrot Yakınlaşması': 'Mandelbrot Zoom',
    'Sonsuz yakınlaşan kaçış-zamanı fraktalı.': 'Infinitely zooming escape-time fractal.',
    'Julia Kümesi': 'Julia Set',
    'Tiz sesle şekil değiştiren Julia kümesi.': 'Julia set morphing with high frequencies.',
    'Yanan Gemi': 'Burning Ship',
    'Mandelbrot ailesinin mutlak değerli akrabası.': 'Absolute-value relative of the Mandelbrot family.',
    'Apollonius Çemberleri': 'Apollonian Circles',
    'Yinelemeli olarak paketlenmiş çemberler.': 'Recursively packed circles.',
    'Kaleydoskopik IFS': 'Kaleidoscopic IFS',
    'Katlanan uzay; her katlama simetriyi artırır.': 'Folding space; each fold increases symmetry.',
    'Menger Süngeri': 'Menger Sponge',
    'Işın yürüyüşüyle çizilen üç boyutlu fraktal.': '3D fractal rendered with ray marching.',
    'Mandelbulb': 'Mandelbulb',
    'Üç boyutlu fraktal; kuvveti sese bağlı.': '3D fractal; power responds to audio.',
    'Işık Tüneli': 'Light Tunnel',
    'Kutupsal tünel; duvar dokusu spektrumdan.': 'Polar tunnel; wall texture driven by spectrum.',
    'Yıldız Sıçraması': 'Star Warp',
    'Işık hızına geçen yıldız alanı.': 'Starfield jumping to lightspeed.',
    'Kutup Perdesi': 'Aurora Curtain',
    'Dikey perdeler halinde akan ışık.': 'Light flowing in vertical curtains.',
    'Sıvı Metal': 'Liquid Metal',
    'Eşyükselti bantlarıyla metalik yüzey.': 'Metallic surface with contour bands.',
    'Neon Yağmur': 'Neon Rain',
    'Düşen ışık çizgileri.': 'Falling streaks of light.',
    'Reaksiyon Deseni': 'Reaction Pattern',
    'Gray-Scott görünümlü organik desen.': 'Gray-Scott style organic pattern.',
    'Su Kostikleri': 'Water Caustics',
    'Su yüzeyinden kırılan ışık çizgileri.': 'Rays of light refracting through water surface.',
    'Prizma Işıması': 'Prism Radiance',
    'Işınsal prizma dilimleri; her dilim bir bant.': 'Radial prism slices; each slice a frequency band.',
    'Işıyan Barlar': 'Glowing Bars',
    'Spektrum barları, yumuşak parlamayla.': 'Spectrum bars with soft glow.',
    'Spektrum Halkası': 'Spectrum Ring',
    'Dairesel spektrum; yarıçap frekansa göre.': 'Circular spectrum; radius responds to frequency.',
    'Dalga Alanı': 'Wave Field',
    'Dalga formunun kendisinden üretilen yüzey.': 'Surface generated from the waveform itself.',
    'Vuruş Patlaması': 'Beat Burst',
    'Her vuruşta dışa açılan halka.': 'Ring expanding outward on every beat.',
    'Parlayan Osiloskop': 'Glowing Oscilloscope',
    'Dalga formu, fosfor parlamasıyla.': 'Waveform with phosphor glow.',
    'Frekans Ağı': 'Frequency Mesh',
    'Perspektifte kayan spektrum ağı.': 'Spectrum mesh scrolling in perspective.',
    'Nota Çemberi': 'Note Ring',
    'On iki dilim; her dilim bir nota sınıfı bölgesi.': 'Twelve slices; each slice a pitch class zone.',
    'Parçacık Akışı': 'Particle Flow',
    'Gürültü alanında sürüklenen ışık noktaları.': 'Points of light drifting in noise field.',
    'Kaleydoskop Spektrum': 'Kaleidoscope Spectrum',
    'Tek dilime çizilen spektrum, N kez aynalanır.': 'Spectrum drawn on a single slice, mirrored N times.',
    'Nabız Izgarası': 'Pulse Grid',
    'Hücre ızgarası; her hücre bir bant.': 'Cell grid; each cell a frequency band.',
    'Sıvı Barlar': 'Liquid Bars',
    'Barlar arası yumuşak geçişle akışkan tepe çizgisi.': 'Fluid peak line with smooth interpolation between bars.',

    // Parametre etiketleri
    'Yarıçap': 'Radius',
    'İç Yarıçap': 'Inner Radius',
    'Dış Yarıçap': 'Outer Radius',
    'Genlik': 'Amplitude',
    'Keskinlik': 'Sharpness',
    'Çizgi Sıklığı': 'Line Frequency',
    'Damla': 'Drop',
    'Yumuşaklık': 'Softness',
    'Kontrast': 'Contrast',
    'Halka': 'Ring',
    'Hücre Boyutu': 'Cell Size',
    'Çizgi': 'Line',
    'Bükülme': 'Warp',
    'Karo': 'Tile',
    'Değişim': 'Change',
    'Sıklık': 'Frequency',
    'Açı Farkı': 'Angle Offset',
    'Dönme': 'Rotation',
    'Kenar': 'Edge',
    'Yakınlaşma Hızı': 'Zoom Speed',
    'Yineleme': 'Iterations',
    'Merkez X': 'Center X',
    'Merkez Y': 'Center Y',
    'Ses Etkisi': 'Audio Influence',
    'Katlama': 'Folds',
    'Yakınlık': 'Proximity',
    'Kuvvet': 'Power',
    'Burgu': 'Twist',
    'Yoğunluk': 'Density',
    'Uzama': 'Stretch',
    'Yükseklik': 'Height',
    'Bant': 'Band',
    'Sütun': 'Column',
    'Kuyruk': 'Tail',
    'Dilim': 'Slice',
    'Sönüm': 'Damping',
    'Bar': 'Bar',
    'Kayma': 'Shift',
    'Yuvarlaklık': 'Roundness',
    'Zamanlama': 'Timing',
    'Sönme': 'Decay',
    'İç Dönüş': 'Swirl',
    'Yatay Kayma': 'Horizontal Shift',
    'Dikey Kayma': 'Vertical Shift',
    'Dalga Genliği': 'Wave Amplitude',
    'Dalga Kalınlığı': 'Wave Thickness',
    'Bas → Yakınlaşma': 'Bass → Zoom',
    'Bas → Dönüş': 'Bass → Rotate',
    'Kaydırıcı': 'Slider',
    'Anahtar': 'Toggle',
    'Renk': 'Color',
    'adım': 'step',
    'varsayılan': 'default',
    'Etiket': 'Label',
    'uAd': 'uName',
    'Kısa açıklama (isteğe bağlı)': 'Short description (optional)',
    'Soldan bir preset seç ya da yeni bir tane oluştur.': 'Select a preset from the left or create a new one.',
    'Varyasyon: şu anki görünümü isimlendirip saklar, kod gerektirmez. Shader: sıfırdan kendi efektini yazarsın.': 'Variation: names and saves the current look, no code required. Shader: write your own effect from scratch.',

    // Modülasyon Matrisi Kökleri ve Grupları
    'Görselleştirici': 'Visualizer',
    'Arkaplan': 'Background',
    'Arka Plan': 'Background',
    '3B Geometri': '3D Geometry',
    'Görsel Nesneler': 'Visual Objects',
    'Kromatik Sapma': 'Chromatic Aberration',
    'Aydınlatma': 'Lighting',
    'Ses': 'Audio',
    'Logo': 'Logo',
    'Zarf': 'Envelope',
    'Makro': 'Macro',
    'Çözümleme': 'Analysis',
    'Nota Sınıfı': 'Pitch Class',
    'Diğer': 'Other',
    'Tempo': 'Tempo',

    // Modülasyon ve Alan Etiketleri
    'Parlama': 'Glow',
    'Saydamlık': 'Opacity',
    'Kalınlık': 'Thickness',
    'Boşluk': 'Gap',
    'Duyarlılık': 'Sensitivity',
    'Çizgi Kalınlığı': 'Line Width',
    'Yumuşatma': 'Smoothing',
    'Hız': 'Speed',
    'Parlaklık': 'Brightness',
    'Tepki': 'Reaction',
    'Ölçek': 'Scale',
    'Dönüş': 'Rotation',
    'Dönüş Hızı': 'Spin Speed',
    'Eğim': 'Tilt',
    'Yakınlaşma': 'Zoom',
    'Bozulma': 'Deformation',
    'Nokta Boyutu': 'Point Size',
    'Çözünürlük': 'Resolution',
    'Bas → Kamera': 'Bass → Camera',
    'Nabız': 'Pulse',
    'Yatay': 'Horizontal',
    'Dikey': 'Vertical',
    'Bas Vurgusu': 'Bass Boost',
    'Şiddet': 'Intensity',
    'Miktar': 'Amount',
    'Boyut': 'Size',
    'İntegrasyon Adımı': 'Integration Step',
    'Renk Kayması': 'Hue Shift',
    'Doygunluk': 'Saturation',
    'Karışım': 'Blend',

    // Modülasyon Paneli Arayüzü
    '+ Yönlendirme Ekle': '+ Add Route',
    'Hepsini Temizle': 'Clear All',
    'Tüm yönlendirmeler silinsin mi?': 'Delete all routings?',
    'Modülasyon Etkin': 'Modulation Enabled',
    'Makrolar': 'Macros',
    'LFO (4)': 'LFOs (4)',
    'Zarf Takipçileri (2)': 'Envelope Followers (2)',
    'Rastgele Üreteç': 'Random Generator',
    'Kaynak Bant': 'Source Band',
    'Atak': 'Attack',
    'Bırakma': 'Release',
    'Tempoya Kilitle': 'Sync to Tempo',
    'Darbe Genişliği': 'Pulse Width',
    'Çift Kutuplu (-1..1)': 'Bipolar (-1..1)',
    'Bir makroyu birden çok yönlendirmeye bağlayın: tek düğme sahnenin tamamını sürer.': 'Connect a macro to multiple routes: a single knob drives the entire scene.',
    'Henüz yönlendirme yok. "Yönlendirme Ekle" ile bası bir efekt parametresine ya da bir LFO\'yu kameraya bağlayın.': 'No routing yet. Connect bass to an effect parameter or an LFO to camera using "Add Route".',
    'Sinüs': 'Sine',
    'Üçgen': 'Triangle',
    'Testere ↑': 'Saw ↑',
    'Testere ↓': 'Saw ↓',
    'Kare': 'Square',
    'Darbe': 'Pulse',
    'Rastgele (basamaklı)': 'Random (stepped)',
    'Rastgele (yumuşak)': 'Random (smooth)',
    'Doğrusal': 'Linear',
    'Üstel': 'Exponential',
    'Üstel (güçlü)': 'Exponential (strong)',
    'Logaritmik': 'Logarithmic',
    'S Eğrisi': 'S-Curve',
    'Mutlak': 'Absolute',
    'Değeri Belirle': 'Set Value',
    'Üstüne Ekle': 'Add',
    'Çarp': 'Multiply',
    'Genel': 'Overall',
    'Bas': 'Bass',
    'Orta': 'Mid',
    'Tiz': 'Treble',
    'Alt Sınır': 'Min',
    'Üst Sınır': 'Max',
    'Basamak': 'Steps',
    'Ters Çevir': 'Invert',
    'sürekli': 'continuous',
    'yok': 'none',
    'Hedef': 'Target',
    'Kaynak': 'Source',
    'Eğri': 'Curve',
    'Kip': 'Mode',
    'Anlık': 'Live',
    '— hedef seçin —': '— pick a target —',
    'Akor Kökü': 'Chord Root',
    'Tonalite Güveni': 'Key Confidence',
    'Tepe Faktörü': 'Crest Factor',
    'Tayf Yayılımı': 'Spectral Spread',
    'Bas Davul (tetik)': 'Bass Drum (trigger)',
    'Trampet (tetik)': 'Snare (trigger)',
    'Hi-Hat (tetik)': 'Hi-Hat (trigger)',
    'Zaman (testere)': 'Time (saw)',
    'Vuruş Fazı': 'Beat Phase',
    'Ölçü Fazı': 'Bar Phase',
    'Sabit (1.0)': 'Constant (1.0)',

    // Ses Çözümleme Paneli (Audio Analysis)
    'Müzikal': 'Musical',
    'Tonalite': 'Key',
    'Akor': 'Chord',
    'Perde': 'Pitch',
    'Akor Güveni': 'Chord Confidence',
    'Seviye': 'Level',
    'Gürlük': 'Loudness',
    'Tepe': 'Peak',
    'Dinamik': 'Dynamics',
    'Durum': 'Status',
    'sessiz': 'silent',
    'sinyal var': 'signal present',
    'Tını': 'Timbre',
    'Tayf Merkezi': 'Spectral Centroid',
    'Tayf Düzlüğü': 'Spectral Flatness',
    'Yuvarlanma': 'Spectral Rolloff',
    'Tayf Akısı': 'Spectral Flux',
    'Yapı': 'Structure',
    'Armonik Oran': 'Harmonic Ratio',
    'Vurmalı Oran': 'Percussive Ratio',
    'Stereo Genişlik': 'Stereo Width',
    'Stereo Korelasyon': 'Stereo Correlation',
    'Davul': 'Drums',
    'Bas Davul': 'Bass Drum',
    'Trampet': 'Snare',
    'Hi-Hat': 'Hi-Hat',
    'Nota Sınıfları': 'Pitch Classes',
    'Buradaki her ölçüm modülasyon matrisinde kaynak olarak kullanılabilir. Sahne sese tepki vermiyorsa önce buraya bakın: sinyal geliyor mu, tek kanal mı, sessizlik eşiğinin altında mı?': 'Every metric here can be used as a source in the modulation matrix. If the scene does not react to audio, check here first: is signal coming in, single channel, or below silence threshold?',

    // Harici Kontrol (MIDI / OSC)
    'Öğren': 'Learn',
    'Ses · Hassasiyet': 'Audio · Sensitivity',
    'Ses · Yumuşatma': 'Audio · Smoothing',
    'Ses · Bas Vurgusu': 'Audio · Bass Boost',
    'Görselleştirici · Hassasiyet': 'Visualizer · Sensitivity',
    'Görselleştirici · Parlama': 'Visualizer · Glow',
    'Görselleştirici · Bar Sayısı': 'Visualizer · Bar Count',
    'Görselleştirici · Bar Boşluğu': 'Visualizer · Bar Gap',
    'Görselleştirici · Çizgi Kalınlığı': 'Visualizer · Line Width',
    'Görselleştirici · Genlik': 'Visualizer · Amplitude',
    'Arkaplan · Akış Hızı': 'Background · Flow Speed',
    'Arkaplan · Ses Tepkisi': 'Background · Audio Reactivity',
    'Arkaplan · Parlaklık': 'Background · Brightness',
    'Arkaplan · Renk Kayması': 'Background · Hue Shift',
    'Arkaplan · Vinyet': 'Background · Vignette',
    'Logo · Saydamlık': 'Logo · Opacity',
    'Logo · Boyut': 'Logo · Size',
    'Geri Besleme · Yakınlaşma': 'Feedback · Zoom',
    'Geri Besleme · Sönme': 'Feedback · Decay',
    'Geri Besleme · Bükülme': 'Feedback · Warp',
    'Geri Besleme · Dönüş': 'Feedback · Rotation',
    'Medya · Saydamlık': 'Media · Opacity',
    'Medya · Kaleydoskop': 'Media · Kaleidoscope',
    'Eylem · Sonraki Görselleştirici': 'Action · Next Visualizer',
    'Eylem · Önceki Görselleştirici': 'Action · Previous Visualizer',
    'Eylem · Sonraki Arkaplan': 'Action · Next Background',
    'Eylem · Sonraki Sahne': 'Action · Next Scene',
    'Eylem · Sonraki Renk Şablonu': 'Action · Next Color Preset',
    'Eylem · Karart (aç/kapa)': 'Action · Blackout (toggle)',
    'Çizelge · Oynat': 'Timeline · Play',
    'Çizelge · Duraklat': 'Timeline · Pause',
    'Çizelge · Durdur ve Başa Dön': 'Timeline · Stop and Rewind',
    'Çizelge · Sonraki İşaret': 'Timeline · Next Marker',
    'Çizelge · Önceki İşaret': 'Timeline · Previous Marker',
    'Deste · Hepsini Durdur': 'Deck · Stop All',
    /* MilkDrop denetleyici hedefleri (#570) */
    'MilkDrop · Geçiş Süresi': 'MilkDrop · Preset Transition',
    'MilkDrop · Otomatik Geçiş': 'MilkDrop · Auto Advance',
    'MilkDrop · Rastgele Pay': 'MilkDrop · Random Spread',
    'MilkDrop · Sert Geçiş Eşiği': 'MilkDrop · Hard Cut Threshold',
    'MilkDrop · Ağ Sıklığı': 'MilkDrop · Mesh Density',
    'MilkDrop · İç Çözünürlük': 'MilkDrop · Internal Resolution',
    'MilkDrop · Sonraki Preset': 'MilkDrop · Next Preset',
    'MilkDrop · Önceki Preset': 'MilkDrop · Previous Preset',
    'MilkDrop · Rastgele Preset': 'MilkDrop · Random Preset',
    'MilkDrop · Şimdi Kes (geçişsiz)': 'MilkDrop · Cut Now (no blend)',
    'MilkDrop · Kilit (aç/kapa)': 'MilkDrop · Lock (toggle)',
    'MilkDrop · Puanı Artır': 'MilkDrop · Rating Up',
    'MilkDrop · Puanı Azalt': 'MilkDrop · Rating Down',
    'MilkDrop · Favori (aç/kapa)': 'MilkDrop · Favourite (on/off)',

    // Sahne Panelleri, Aydınlatma ve Arayüz
    'Zincir boşken sahne doğrudan kompozit edilir; hiçbir ek maliyet yoktur. Efekt eklediğinizde sahne tek yüzeye birleştirilip GPU\'da işlenir ve efektler dışa aktarımda da aynı sırayla uygulanır.': 'When chain is empty, scene is directly composited with no overhead. When you add effects, scene is rendered to a single surface on the GPU and effects are applied in the same order during export.',
    'Katı geometri ağı bir kez kurulup GPU\'da kalır; sese bağlı bozulma vertex shader\'da yapılır. Nokta bulutu üreten şekillerde (IFS) çizim kipi otomatik olarak nokta olur.': 'Solid geometry mesh is built once and stays on the GPU; audio-driven deformation is computed in the vertex shader. Shapes generating point clouds (IFS) automatically use points drawing mode.',
    'Sahne renklerini standart DMX protokolüyle (Art-Net) ışık konsollarına, DMX arayüzlerine ve QLC+ gibi yazılımlara yollar. Windows Dynamic Lighting\'in yerine geçmez; o tüketici aygıtlarını, bu sahne ışıklarını sürer.': 'Sends scene colors via standard DMX protocol (Art-Net) to lighting consoles, DMX interfaces, and software like QLC+. Does not replace Windows Dynamic Lighting; that drives consumer devices, this drives stage fixtures.',
    'Varsayılan hedef yayın adresidir; ağdaki tüm Art-Net düğümleri paketi alır. Tek bir arayüze göndermek isterseniz onun IP adresini yazın. DMX 44 Hz üstünü zaten taşımaz, bu yüzden gönderim hızı orada sınırlıdır.': 'Default destination is broadcast address; all Art-Net nodes on network receive packet. If you want to send to a single interface, enter its IP address. DMX does not carry above 44 Hz, so transmission rate is limited there.',
    'Yukarı taşı': 'Move up',
    'Aşağı taşı': 'Move down',
    'Kaldır': 'Remove',
    'Gönderim Hızı': 'Send Rate',
    'Kaynakları Listele': 'List Sources',
    'Bu Makinedeki Kaynaklar': 'Sources on This Machine',
    'Gelişmiş ayarlar': 'Advanced settings',
    'Gelişmiş ayarları göster': 'Show advanced settings',
    'Gelişmiş ayarları gizle': 'Hide advanced settings',
    'Birden çok katmanı tek fader ile yönetin; "A" ve "B" grupları arasında eşit güç eğrisiyle çapraz geçiş yapın.': 'Manage multiple layers with a single fader; crossfade between "A" and "B" groups with an equal-power curve.',
    'OBS ve benzeri programlara "Tarayıcı Kaynağı" olarak eklenebilen bir sayfa yayınlar; telefondan uzaktan kumanda da buradan açılır.': 'Serves a page that can be added as a "Browser Source" in OBS and similar programs; smartphone remote control is also launched here.',
    'Henüz görsel nesne eklenmedi. Aşağıdaki düğmeyle bir görsel seçin.': 'No image objects added yet. Select an image using the button below.',
    'Otomatik mod: Çalan şarkının kapağı varsa gösterilir; parça çalmıyorsa veya kapağı yoksa bu özel resim gösterilir.': 'Auto mode: Displayed if playing track has cover art; if nothing is playing or no cover art, this custom image is shown.',
    'Özel Logo Görseli': 'Custom Logo Image',
    'Şarkı Resmini Göster': 'Show Track Artwork',
    'Şarkı bilgileri alanlara yazıldı.': 'Track information filled into fields.',
    'Otomatik Ortala (50%)': 'Auto Center (50%)',
    'Bu Windows sürümünde Dynamic Lighting desteklenmiyor.': 'Dynamic Lighting is not supported on this Windows version.',
    'Uyumlu Dynamic Lighting aygıtı bulunamadı.': 'No compatible Dynamic Lighting devices found.',
    'Windows Dynamic Lighting Etkin': 'Windows Dynamic Lighting Enabled',
    'Windows Dynamic Lighting Ayarları': 'Windows Dynamic Lighting Settings',
    'Ekran seçilmedi': 'No display selected',
    'Önce görselleştirmenin açılacağı ekranı seçin.': 'Choose a display for the visualizer first.',
    'Ekran': 'Display',
    'Açık': 'On',
    'Kapalı': 'Off',
    'Ekranları Uygula': 'Apply Displays',
    'Görselleştirmeyi Aç': 'Open Visualizer',
    'Yakalanıyor: çıkış': 'Capturing: output',
    'Sistem sesi yakalanamıyor': 'System audio cannot be captured',
    'Bu sistemde sistem sesini veren bir aygıt bulunamadı.': 'No audio output device found on this system.',
    'Ses yakalanamadı': 'Could not capture audio',
    'Beklenmedik bir hata oldu; uygulama çalışmaya devam ediyor.': 'An unexpected error occurred; the app keeps running.',
    'Ses yakalama durdu, yeniden bağlanıyor…': 'Audio capture stopped, reconnecting…',
    'Çıkış aygıtı yakalanamadı.': 'Could not capture output device.',
    'Seçili ses aygıtı bulunamadı. Takıldığında yakalama kendiliğinden başlar.': 'The selected audio device was not found. Capture starts by itself when it is plugged in.',
    'İptal edildi.': 'Cancelled.',
    'MilkDrop dokusu 20 saniyede yüklenmedi. Video her çalıştırmada aynı çıkmayacağı için dışa aktarım durduruldu.': 'A MilkDrop texture did not load within 20 seconds. The export was stopped because the video would not come out the same on every run.',
    'Shadertoy kodundan içe aktarıldı.': 'Imported from Shadertoy code.',
    'ISF dosyasından içe aktarıldı.': 'Imported from ISF file.',
    '.milk dosyasından içe aktarılan geri besleme ayarları.': 'Feedback settings imported from .milk file.',

    // Sahne Üretici (SceneGen)
    'Tamamen bu bilgisayarda çalışır — hiçbir servise bağlanmaz. Yazdığınız metin enerji, sıcaklık, aydınlık ve doku eksenlerine çevrilir; sahne bu eksenlerden tohumlanmış deterministik bir üreticiyle kurulur. Beğendiğinizi sağdaki Sahneler bölümünden kaydedin.': 'Runs entirely on this computer — connects to no external service. Your text is translated into energy, temperature, brightness and texture axes; the scene is built with a deterministic generator seeded from these axes. Save the ones you like in the Scenes section on the right.',
    'Enerji': 'Energy',
    'Sıcaklık': 'Temperature',
    'Ton': 'Tone',
    'Doku': 'Texture',
    'dengeli': 'balanced',
    'yüksek': 'high',
    'sakin': 'calm',
    'soğuk': 'cool',
    'sıcak': 'warm',
    'aydınlık': 'bright',
    'karanlık': 'dark',
    'geometrik': 'geometric',
    'organik': 'organic',
    'Akışkan Gradyan': 'Fluid Gradient',
    'Mürekkep': 'Ink',
    'Bulutsu': 'Nebula',
    'Kutup Işıkları': 'Northern Lights',
    'Retro Izgara': 'Retro Grid',
    'Petek Izgara': 'Honeycomb Grid',
    'Mozaik': 'Mosaic',
    'Koridor': 'Corridor',
    'Sarmal': 'Spiral',
    'Nabız Halkaları': 'Pulse Rings',
    'Ağ': 'Network',
    'Yıldız Alanı': 'Starfield',
    'Kar / Kor': 'Snow / Embers',
    'Işık Parçacıkları': 'Light Particles',
    'Dijital Yağmur': 'Digital Rain',
    'Şehir': 'City',
    'Düz Renk': 'Solid Color',
    'Barlar': 'Bars',
    'Dalga': 'Wave',
    'Şerit': 'Ribbon',
    '3B Dalga': '3D Wave',
    'Lissajous': 'Lissajous',
    'Teller': 'Strings',
    'Arazi': 'Terrain',
    'Çember': 'Circle',
    'Dairesel Dalga': 'Radial Wave',
    'Yaylar': 'Arcs',
    'Fırıldak': 'Pinwheel',
    'Mandala': 'Mandala',
    'Kaleydoskop': 'Kaleidoscope',
    'Girdap': 'Vortex',
    'Tünel': 'Tunnel',
    'Küre': 'Orb',
    'Parçacık': 'Particle',
    'Havai Fişek': 'Fireworks',
    'Şimşek': 'Lightning',
    'Baloncuk': 'Bubbles',
    'Sıvı Damla': 'Liquid Drop',
    'Dalgalı Izgara': 'Ripple Grid',
    'Şehir Silüeti': 'City Skyline',
    'Spektrogram': 'Spectrogram',
    'Geri Besleme': 'Feedback',

    // Tipografi & Metin Paneli
    'Yazı': 'Typography',
    'Yazı Tipi': 'Font',
    'Hizalama': 'Alignment',
    'Yazı Saydamlığı': 'Text Opacity',
    'Çubuk Kalınlığı': 'Bar Thickness',
    'Kontur': 'Outline',
    'Gölge': 'Shadow',
    'Senkron Kayması': 'Sync Offset',
    'Karaoke Vurgusu': 'Karaoke Highlight',
    'Sabit Metin': 'Static Text',
    'Şarkı Sözü (LRC / SRT)': 'Lyrics (LRC / SRT)',
    'Çalan Parça': 'Now Playing',
    'Yok': 'None',
    'Belirme': 'Fade',
    'Yukarı Kayma': 'Slide Up',
    'Yana Kayma': 'Slide Left',
    'Büyüme': 'Zoom',
    'Sola': 'Left',
    'Ortaya': 'Center',
    'Sağa': 'Right',

    // Stüdyo İşlemleri ve Varsayılan Adlar
    'Yeni Arkaplan': 'New Background',
    'Yeni Görselleştirici': 'New Visualizer',
    'Arkaplan Varyasyonum': 'My Background Variation',
    'Görselleştiricim': 'My Visualizer',
    'Dışa aktarılacak preset yok.': 'No presets to export.',
    'CAYADEV Preset Paketi': 'CAYADEV Preset Pack',
    'Dosyaya yazıldı.': 'Written to file.',
    'Dosya çok büyük (2 MB üstü).': 'File too large (over 2 MB).',
    'JSON çözümlenemedi.': 'JSON could not be parsed.',
    'İçe aktarıldı.': 'Imported.',
    'WebGL2 kullanılamıyor.': 'WebGL2 unavailable.',
    'Derlendi.': 'Compiled.',
    'Deste': 'Deck',
    'Satır': 'Row',
    'Yuva': 'Slot',

    // Katmanlar & Sahneler
    'Katman': 'Layer',
    'Katmanlar': 'Layers',
    'katman': 'layer',
    'katmanlar': 'layers',
    '1 Katman': '1 Layer',
    '2 Katman': '2 Layers',
    'Katman Sayısı': 'Layer Count',
    'Katman Aralığı': 'Layer Spacing',
    'Katman kopyalandı.': 'Layer copied.',
    'Katman kilitli. Düzenlemek için kilidi açın.': 'Layer locked. Unlock to edit.',
    'Katman Efektleri': 'Layer Effects',
    // Katman satırı (#622)
    'Tümünü Aç': 'Expand All', 'Tümünü Kapat': 'Collapse All',
    'Ayarları göster': 'Show settings', 'Ayarları gizle': 'Hide settings',
    'Katman Yığınını Kullan': 'Use Layer Stack',
    'Kaynak Katman': 'Source Layer',
    'Arka Katman': 'Back Layer',
    'Ön Katman': 'Front Layer',
    'Başka Katman': 'Other Layer',
    'Dalga Katmanları': 'Wave Layers',
    'Katmanlara Geç': 'Switch to Layers',
    'Katmanları Sıfırla': 'Reset Layers',
    'Katman Grupları ve A/B': 'Layer Groups and A/B',
    'Medya Katmanı': 'Media Layer',
    'Kayıtlı sahne yok. “Kaydet” ile mevcut görünümü saklayın.': 'No saved scenes. Save the current view with "Save".',
    'Sahne': 'Scene',
    'Sahne adı': 'Scene name',
    'Sahneyi taşı': 'Move scene',
    'Bu sahneyi uygula': 'Apply this scene',
    'Mevcut görünümle güncelle': 'Update with current view',
    'Mevcut Görünümü Kaydet': 'Save Current View',
    'Kategoriler': 'Categories',
    'çıkış': 'output',
    'Eşleşen ayar bulunamadı.': 'No matching settings found.',

    // Stüdyo Detayları
    'Sıfırdan GLSL shader': 'GLSL shader from scratch',
    'Şu anki görünümü preset olarak sakla': 'Save current view as preset',
    'Shadertoy / ISF / MilkDrop / .svpreset / .svpack': 'Shadertoy / ISF / MilkDrop / .svpreset / .svpack',
    'Tüm kendi presetlerini tek dosyada paylaş': 'Share all your presets in a single file',
    'Preset klasörünü aç': 'Open presets folder',
    'Varyasyon': 'Variation',
    'Paket Dışa Aktar': 'Export Pack',
    'Klasör': 'Folder',
    'Varyasyon güncel görünümle tazelendi.': 'Variation updated with current view.',
    'Bu yerleşik bir preset. Kaydettiğinde kendi kopyan oluşturulur; orijinali korunur.': 'This is a built-in preset. Saving creates your own copy; the original is preserved.',
    'Şu Anki Görünümle Güncelle': 'Update with Current View',
    'Temel Mod': 'Base Mode',
    'Parametreler': 'Parameters',
    'Shader Kodu (GLSL)': 'Shader Code (GLSL)',
    'Parametre Ekle': 'Add Parameter',
    'Parametreyi kaldır': 'Remove parameter',
    'canlı': 'live',
    'Derlendi': 'Compiled',
    'Studio Preseti': 'Studio Preset',
    'Henüz yok.': 'None yet.',
    'Shader içinde uniform olarak tanımladığın kaydırıcıları buraya ekle. Ad (ör. uSpeed) GLSL kodundakiyle tam aynı olmalı.': 'Add sliders here that you define as uniforms in the shader. The name (e.g. uSpeed) must exactly match the GLSL code.',
    'void mainImage(out vec4 fragColor, in vec2 fragCoord) fonksiyonunu yazın. sv_... değişkenleri ses ve zamanı taşır.': 'Write the void mainImage(out vec4 fragColor, in vec2 fragCoord) function. sv_... variables carry audio and time.',

    // Arama & Navigasyon
    'Ses Analizi': 'Audio Analysis',
    'Ses Kaynakları': 'Audio Sources',
    'Ses Çözümlemesi': 'Audio Analysis',
    'Aktif Kaynaklar': 'Active Sources',
    'Art-Net / DMX Output': 'Art-Net / DMX Output',
    'Güç / Performans': 'Power / Performance',
    'Arkaplan Çözünürlüğü': 'Background Resolution',
    'Ayarları Yedekle / Geri Yükle': 'Back Up / Restore Settings',
    'Video Dışa Aktar (MP3 → Video)': 'Video Export (MP3 → Video)',
    'Gelişmiş': 'Advanced',
    'Kırmızı nokta ve rakamlar, varsayılandan farklı ayarları gösterir.': 'Red dots and numbers show settings that differ from defaults.',
    'Varsayılandan farklı ayar sayısı': 'Number of settings differing from defaults',
    'Bu bölümü varsayılana döndür': 'Reset this section to defaults',
    'Bu bölümdeki ayarlar varsayılana dönecek.': 'Settings in this section will return to defaults.',
    'Bölümü sıfırla': 'Reset section',
    'ör. "karanlık sinematik uzay", "enerjik neon techno", "sakin orman sabahı"': 'e.g. "dark cinematic space", "energetic neon techno", "calm forest morning"',
    'Sahne Üret': 'Generate Scene',
    'Karıştır': 'Shuffle',
    'Aynı ruh hali, farklı yorum': 'Same mood, different interpretation',
    'Sahne kuruldu.': 'Scene generated.',

    // Yayın çıkışı paneli (OBS / web overlay / mobil kumanda)
    'Yayın Sunucusunu Aç': 'Enable Stream Server',
    'Ağa açık': 'Open to network',
    'Yalnızca bu bilgisayar': 'This computer only',
    'bağlı istemci': 'connected client',
    'istemci yok': 'no clients',
    'OBS Tarayıcı Kaynağı': 'OBS Browser Source',
    'bu adresi OBS\'e yapıştırın': 'paste this address into OBS',
    'telefondan açın': 'open on your phone',
    'OBS kurulumu': 'OBS setup',
    'URL alanına yukarıdaki adresi yapıştırın.': 'Paste the address above into the URL field.',
    'Genişlik/Yükseklik: sahne çözünürlüğünüzle aynı (ör. 1920 × 1080).': 'Width/Height: match your scene resolution (e.g. 1920 × 1080).',
    '“Kaynak görünür değilken kapat” seçeneğini KAPALI bırakın; yoksa sahne değişince yeniden bağlanır.': 'Leave “Shutdown source when not visible” OFF; otherwise it reconnects when the scene changes.',
    'Saydam arkaplan açıksa görselleştirici doğrudan üst katman olur; kapatırsanız arkaplan da yayına girer.': 'With a transparent background, the visualizer is directly an overlay; turn it off to include the background in the stream.',
    'Adresin sonuna ?transparent=0 eklerseniz o kaynak arkaplanı da gösterir; ?fps=30 veya ?scale=0.75 ile o kaynağın yükünü ayrıca düşürebilirsiniz.': 'Add ?transparent=0 to the address to show the background too; use ?fps=30 or ?scale=0.75 to reduce that source’s load.',
    'Saydam Arkaplan (üst katman)': 'Transparent Background (overlay)',
    'Mobil Uzaktan Kumanda': 'Mobile Remote Control',
    'Yerel Ağa Aç (telefon erişebilsin)': 'Open to Local Network (allow phone access)',
    'Token Koruması': 'Token Protection',
    'Açık: URL\'de ?token= zorunlu.': 'On: ?token= is required in the URL.',
    'Kapalı: adresler token olmadan açılır (yerel kullanım için önerilir).': 'Off: addresses open without a token (recommended for local use).',
    'Görselleştirici Jetonu (OBS / Web)': 'Visualizer Token (OBS / Web)',
    'Yeni Jeton': 'New Token',
    'Görselleştirici için yeni jeton üretir; eski OBS adresi geçersiz olur': 'Generates a new visualizer token; the old OBS address becomes invalid',
    'Mobil Kumanda Jetonu': 'Mobile Remote Token',
    'Mobil kumanda için yeni jeton üretir; eski kumanda adresi geçersiz olur': 'Generates a new mobile remote token; the old remote address becomes invalid',
    'Tarayıcı Kaynağı Kare Hızı': 'Browser Source Frame Rate',
    'Tarayıcı Kaynağı Çözünürlük Ölçeği': 'Browser Source Resolution Scale',
    'Kumanda': 'Remote',
    'Bağlı İstemciler': 'Connected Clients',
    'Yayın sayfası masaüstü penceresiyle aynı motoru çalıştırır; ayrı bir render yoktur, bu yüzden iki görüntü asla birbirinden ayrışmaz. NDI ve Spout çıkışı bu sürümde yok — OBS için tarayıcı kaynağı zaten aynı işi eklenti kurmadan görür.': 'The stream page uses the same engine as the desktop window; there is no separate render, so the two views never diverge. NDI and Spout output are not available in this version — the OBS browser source already provides the same result without a plugin.',
    'Bu port başka bir uygulama tarafından kullanılıyor. Başka bir port deneyin.': 'This port is already in use by another application. Try another port.',
    'Bu portu açma izni yok. 1024 üstü bir port deneyin.': 'Permission to open this port was denied. Try a port above 1024.',
    'Ağ adresi kullanılamıyor.': 'The network address is unavailable.',
    'Kopyalandı.': 'Copied.',
    'Kopyalanamadı.': 'Could not copy.',
    'Yayın sayfası yerel ağdaki tüm cihazlara açılacak. Adresler, tahmin edilmesi güç iki ayrı güvenlik jetonu içerir. Genel/paylaşımlı bir ağdaysanız (kafe, otel, konferans) açmayın.': 'The stream page will be opened to all devices on the local network. The addresses contain two separate, hard-to-guess security tokens. Do not enable this on a public/shared network (café, hotel, conference).',
    'Yayın sayfası yerel ağdaki tüm cihazlara açılacak. Token Koruması kapalı olduğundan URL bilinen herkes erişebilir — güvenilir bir ev/ofis ağı dışında kullanmayın.': 'The stream page will be opened to all devices on the local network. Because Token Protection is off, anyone who knows the URL can access it — use this only on a trusted home/office network.',
    'Ağa aç': 'Open to network',

    // Dinamik Renk Teması (Windows SMTC)
    'Dinamik Renk Teması (Windows)': 'Dynamic Color Theme (Windows)',
    'Çalan şarkının albüm kapağına veya şarkı geçişlerine göre renk temasını otomatik değiştirin.': 'Automatically adapt the color theme based on album artwork or track changes.',
    'Yalnızca Windows Desteklenir': 'Windows Only Supported',
    'Dinamik renk teması modu, Windows Medya Taşıma Denetimleri (SMTC) oturumundan gelen çalan parça ve albüm kapağı verileriyle çalışır. Bu platformda kullanılamaz.': 'Dynamic color theme mode operates with track and album artwork data from the Windows System Media Transport Controls (SMTC) session. It is not available on this platform.',
    'Albüm kapağı algılandı': 'Album artwork detected',
    'Albüm kapağı yok (parça bilgisi mevcut)': 'No album artwork (track info available)',
    'Windows Medya Oturumu Hazır': 'Windows Media Session Ready',
    'Müzik çaldığında (Spotify, Apple Music, YouTube vb.) renkler otomatik güncellenir.': 'Colors update automatically when music plays (Spotify, Apple Music, YouTube, etc.).',
    'Çalan Parça Kapağı': 'Playing Track Artwork',
    'Dinamik Renk Temasını Etkinleştir': 'Enable Dynamic Color Theme',
    'Şarkı değiştiğinde veya yeni kapak geldiğinde renkleri otomatik uyarla.': 'Automatically adapt colors when a track changes or new artwork arrives.',
    'Çalışma Modu': 'Operation Mode',
    'Albüm Kapağı (Yoksa Rastgele)': 'Album Artwork (Random Fallback)',
    'Yalnızca Albüm Kapağı': 'Album Artwork Only',
    'Rastgele Renk Teması (Stüdyo Üreticisi)': 'Random Color Theme (Studio Generator)',
    'Parça Adı & Ruh Hali Analizi': 'Track Title & Mood Analysis',
    'Hazır Şablon Döngüsü': 'Preset Cycle',
    'Hazır Şablon Rastgele': 'Random Preset',
    'Çalan şarkının albüm kapağı varsa renklerini çıkarıp miksler; kapak yoksa stüdyo armonisiyle rastgele bir renk teması üretir.': 'Extracts and mixes colors from the playing track\'s album artwork if available; generates a random harmonic studio theme if no artwork.',
    'Yalnızca çalan şarkının albüm kapağındaki renkleri çıkarır ve miksler. Kapak yoksa mevcut renkleri korur.': 'Extracts and mixes colors strictly from the playing track\'s album artwork. Keeps current colors if no artwork.',
    'Her şarkı değişiminde stüdyo renk teorisi ve armonik yayılımla (analogous, cyberpunk, sunset vb.) sıfırdan yepyeni 5 renkli bir palet üretir.': 'Generates a brand new 5-color palette from scratch on every track change using studio color harmony (analogous, cyberpunk, sunset, etc.).',
    'Şarkı ve sanatçı adındaki anahtar kelimeleri ve duyguyu analiz ederek parçanın hissine özel renk paleti kurar.': 'Analyzes keywords and emotion in track title and artist name to construct a color palette tailored to the track.',
    'Her yeni şarkıda uygulamadaki yerleşik hazır renk şablonlarını sırayla uygular.': 'Sequentially applies built-in color presets with each new song.',
    'Her yeni şarkıda yerleşik hazır renk şablonlarından rastgele birini seçip uygular.': 'Randomly selects and applies one of the built-in color presets with each new song.',
    'Renklerin Uygulanacağı Alanlar': 'Target Color Destinations',
    'Arkaplan 5 Noktalı Gradyan Paletine Uygula': 'Apply to Background 5-Point Gradient Palette',
    'Görselleştirici Ana ve İkincil Renklerine Uygula': 'Apply to Visualizer Primary and Secondary Colors',
    'Aktif Renk Paleti': 'Active Color Palette',
    'Mevcut Aktif Renk Paleti': 'Current Active Color Palette',
    'Şimdi Test Et / Renkleri Uygula': 'Test Now / Apply Colors',
    'Uygulanacak renk teması bulunamadı.': 'No applicable color theme found.',
    /* Anahtar KIRPILMIŞ tutulmalı. Arama normalize() ile yapılıyor, yani
       sondaki boşluk zaten kırpılıyor; ama karşılığın sonundaki boşluk
       korunup çağıranın kendi boşluğuna EKLENİYOR ve çift boşluk çıkıyordu
       ("Dynamic color theme applied:  Album Art"). */
    // ---- Otomatik VJ ----
    'Hazır': 'Built-in',
    'Kendi Yaptıklarım': 'My Own',
    'Tüm Görselleştirici Katmanları': 'All Visualizer Layers',
    'Yalnızca İlki': 'Only the First',
    'Şablon Kaynağı': 'Preset Source',
    'Hangi Katmanlar': 'Which Layers',
    'Otomatik VJ kapalı.': 'Auto VJ is off.',
    'Kayıtlı sahne yok. Önce Kitaplık › Sahneler bölümünden sahne kaydedin ya da başka bir kaynak seçin.':
      'No saved scenes. Save one under Library › Scenes first, or pick a different source.',
    'Seçilen kaynakta renk şablonu yok.': 'The selected source has no color presets.',
    'Bu kaynakta değiştirilecek bir şey yok.': 'There is nothing to switch in this source.',
    'Son değişim': 'Last change',
    'Son deneme başarısız': 'Last attempt failed',
    'sıradaki': 'next',
    'ölçü': 'bars',
    'atlanan': 'skipped',
    'Hangileri': 'Which ones',
    'hepsi': 'all',
    'Hiçbiri seçili değilse hepsi kullanılır.': 'If none are ticked, all of them are used.',
    'Hepsini Seç': 'Select All',
    'Seçimi Temizle': 'Clear Selection',

    // ---- Basıklık (piksel en boy oranı) düzeltme ----
    'Basıklık Düzeltme': 'Aspect Correction',
    'Ekranın bildirdiği çözünürlük fiziksel şekliyle uyuşmuyorsa daireler elips, logo ve yazılar basık çıkar. Tek ayarla arkaplan, görselleştirici, logo ve yazıların hepsi birden düzelir; kırpma ya da siyah bant oluşmaz.':
      'When a display’s reported resolution does not match its physical shape, circles come out as ellipses and logos and text look squashed. One setting corrects the background, visualizer, logo and text together, with no cropping and no black bars.',
    'Basıklık Düzeltme Etkin': 'Aspect Correction On',
    'Düzeltme kapalı: görüntü ekrana olduğu gibi gider ve bu aşamanın ölçülebilir bir maliyeti yoktur.':
      'Correction is off: the image goes to the display untouched and this stage has no measurable cost.',
    'Düzeltilen Çıkış': 'Corrected Output',
    'Önce elle gerdiğiniz görselleri özgün hâlleriyle değiştirin. O dosyalar telafiyi zaten içerdiği için bir kez daha düzeltilir ve ters yöne bozulur.':
      'First replace any images you stretched by hand with their originals. Those files already carry the compensation, so they would be corrected a second time and end up distorted the other way.',
    'Ölçüyü aldıktan sonra o görseli özgün hâliyle değiştirmeyi unutmayın.':
      'Once you have the measurement, remember to swap that image back to its original.',
    'Deseni açın ve düzeltilen ekrana bakın; daire yuvarlak görünene kadar kaydırıcıyı oynatın. Ölçü almanız gerekmez.':
      'Turn on a pattern and look at the corrected display; move the slider until the circle looks round. You do not need to measure anything.',
    'Kalibrasyon Deseni': 'Calibration Pattern',
    'Daire': 'Circle',
    'Izgara ve Daire': 'Grid and Circle',
    'Piksel Oranı': 'Pixel Ratio',
    'düzeltme yok': 'no correction',
    'içerik dikey gerilir': 'content is stretched vertically',
    'içerik yatay gerilir': 'content is stretched horizontally',
    '− İnce': '− Fine',
    '+ İnce': '+ Fine',
    'Çözünürlük Bütçesi': 'Resolution Budget',
    'Kalite — çözünürlük kaybı yok': 'Quality — no resolution lost',
    'Dengeli — piksel sayısı değişmez': 'Balanced — same pixel count',
    'Performans — en az piksel': 'Performance — fewest pixels',
    'Piksel tavanına ulaşıldı: düzeltme doğru kalır ama görüntü bir miktar yumuşar. Çözünürlük bütçesini düşürmek burada kayıp getirmez.':
      'The pixel ceiling was reached: the correction stays accurate but the image softens a little. Lowering the resolution budget costs nothing here.',
    'Ölçüyü biliyorsanız doğrudan girebilirsiniz; kaydırıcıya dokunmanız gerekmez.':
      'If you know the measurement you can enter it directly; you do not have to touch the slider.',
    'Panel Ölçüsü (en × boy)': 'Panel Size (width × height)',
    'Gerçek En Boy Oranı': 'True Aspect Ratio',
    'Elle Gerdiğiniz Görselin Ölçüsü': 'Size of the Image You Stretched by Hand',
    'genişlik': 'width',
    'yükseklik': 'height',
    'Düzeltme yalnızca bu ekrandaki görselleştirici penceresine uygulanır. Dışa aktarılan video, yayın ve web kaplaması düzeltilmez: onlar başka ekranlarda izlenir ve orada düzeltme bozukluk olurdu.':
      'The correction applies only to the visualizer window on this display. Exported video, the stream and the web overlay are left alone: they are watched on other screens, where the correction would itself be the distortion.',

    // ---- Uygulama başına ses yakalama ----
    'Uygulama Sesi': 'Application Audio',
    'Uygulama Kipi': 'Application Mode',
    'Yalnızca Seçilenler': 'Selected Only',
    'Seçilen Hariç': 'Except Selected',
    'çalışmıyor': 'not running',
    'Birden fazla kaynak seçilip karıştırılabilir: sistem sesi, mikrofon ve tek tek uygulamalar.':
      'Several sources can be selected and mixed: system audio, microphone and individual applications.',
    'Şu anda ses çalan bir uygulama yok. Bir şey çaldırıp Aygıtları Yenile’ye basın.':
      'No application is playing audio right now. Start something and press Refresh Devices.',
    'Seçilen uygulama hariç sistemdeki her şey dinlenir. Bu kipte tek uygulama seçilebilir.':
      'Everything on the system is captured except the selected application. Only one application can be selected in this mode.',
    'Uygulama başına ses yakalama kullanılamıyor.': 'Per-application audio capture is unavailable.',
    'Uygulama başına ses yakalama şimdilik yalnızca Windows üzerinde çalışıyor.':
      'Per-application audio capture currently works on Windows only.',
    'Ses yakalama yardımcısı bulunamadı; bu paket .NET olmadan derlenmiş olabilir.':
      'The audio capture helper was not found; this build may have been made without .NET.',
    'Uygulama başına ses yakalama macOS 13 ve üstünü gerektiriyor (ScreenCaptureKit).':
      'Per-application audio capture requires macOS 13 or newer (ScreenCaptureKit).',
    'Uygulama başına ses yakalama için PipeWire ya da PulseAudio gerekiyor.':
      'Per-application audio capture requires PipeWire or PulseAudio.',
    'Bu işletim sisteminde uygulama başına ses yakalama yok.':
      'This operating system has no per-application audio capture.',
    'Dinamik renk teması uygulandı:': 'Dynamic color theme applied:',
    'Albüm Kapağı': 'Album Artwork',
    'Kapağı Göster': 'Show Cover',
    'Albüm Kapağı (Bindirme)': 'Album Cover (Overlay)',
    'Kapak Boyutu': 'Cover Size',
    'Yazı Aralığı': 'Gap from Text',
    'Köşe Yuvarlaklığı': 'Corner Roundness',
    'Kapak Konumu': 'Cover Position',
    'Kapak Sığdırma': 'Cover Fit',
    'Doğal oran': 'Natural aspect',
    'Kareye ger': 'Stretch to square',
    'Kareye kapla': 'Crop to square',
    'Kareye sığdır': 'Fit inside square',
    'Kapak Bas Nabzı': 'Cover Bass Pulse',
    'Köşe / Oval': 'Corner / Oval',
    'Otomatik (Üstte)': 'Auto (Top)',
    'Solda': 'Left',
    'Sağda': 'Right',
    'Çalan parçanın albüm kapağını yazının yanına yerleştirir. Kapak yoksa bindirme çizilmez. Varsayılan kapalıdır.':
      'Places the playing track\'s album cover beside the text. If no cover is available, nothing is drawn. Off by default.',
    'Çalan parçanın albüm kapağını yazının yanına veya üstüne yerleştirir. Boyut ekranın kısa kenarına göredir. Kapak yoksa bindirme çizilmez. Varsayılan kapalıdır.':
      'Places the playing track\'s album cover beside or above the text. Size follows the short side of the screen. If no cover is available, nothing is drawn. Off by default.',
    'Kapak Kaynağı': 'Cover Source',
    'Otomatik (Sistem)': 'Automatic (System)',
    'Elle Yükle': 'Upload Image',
    'Kapak Seç': 'Choose Cover',
    'Kapağı Değiştir': 'Change Cover',
    'Kapağı Kaldır': 'Remove Cover',
    'Windows’ta kapak çalan parçadan otomatik gelir. İsterseniz kendi resminizi de yükleyebilirsiniz; otomatik kapak yoksa o resim kullanılır.':
      'On Windows the cover comes from the playing track. You can also upload your own image; it is used when the track has no artwork.',
    'Bu platformda albüm kapağı otomatik okunamaz. Gösterilecek resmi elle yükleyin.':
      'Album artwork cannot be read automatically on this platform. Upload the image you want to show.',
    'Elle yüklenen resim yazının yanında gösterilir.':
      'The image you upload is shown beside the text.',
    'Elle yazılan parça adı ve sanatçı ekrana gelir. Albüm kapağı elle yüklenir. Süre ve ilerleme çubuğu sistemden okunduğu için bu platformda yoktur.':
      'The title and artist you type are shown. Album artwork is uploaded by hand. Elapsed time and the progress bar are absent here because they are read from the system.',
    'WebGL2 yok. Görüntü kartı sürücüsünü güncelleyin. Sürücü WebGL2 vermezse MilkDrop bu ekranda çalışmaz.':
      'WebGL2 is missing. Update your graphics driver. If the driver does not provide WebGL2, MilkDrop cannot run on this display.',

    'Rastgele Armoni': 'Random Harmony',
    'Ruh Hali': 'Mood',
    'Kapak Görseli': 'Cover Artwork',
    'Başarılı': 'Success',

    // İkon seti (#665): ikonla birlikte gelen yeni yazılar
    'Sol üst köşe': 'Top-left corner',
    'Sağ üst köşe': 'Top-right corner',
    'Sol alt köşe': 'Bottom-left corner',
    'Sağ alt köşe': 'Bottom-right corner',
    'geçiş': 'fade',
    'Yayın katmanı': 'Overlay',

    // Görselleştirici Renk Modları
    'Renk Modu': 'Color Mode',
    'Sabit Renk': 'Fixed Color',
    'Renk Teması': 'Color Theme',
    // MCP control card
    'MCP': 'MCP',
    'Kurulum': 'Setup',
    'Efekt': 'Effect',
    'Var olanı uygula': 'Apply what already exists',
    'Oluştur ve düzenle': 'Create and edit',
    'Dışa aktarma': 'Export',
    'Karartma': 'Blackout',
    'MCP kapalı.': 'MCP is off.',
    'stdio dinleniyor.': 'Listening on stdio.',
    'MCP açılıyor…': 'MCP is starting…',
    'MCP kurulumu': 'MCP setup',
    'Hepsi aynı stdio sunucusuna bağlanır. Ağ portu yalnız 127.0.0.1. Ollama ayrı bir protokol değildir.': 'All of them connect to the same stdio server. The socket is 127.0.0.1 only. Ollama is not a separate protocol.',
    'Ajan sahneleri, katmanları, efektleri, presetleri, çıkışı ve karartmayı bu karttaki izinlerle sürer. Okuma (BPM, durum, önizleme) anahtar açılınca serbesttir. Yazma grupları varsayılan kapalıdır.': 'An agent drives scenes, layers, effects, presets, output, and blackout with the switches on this card. Reads (BPM, state, preview) are available when the master switch is on. Write groups stay off by default.',
    'Ajan bu karttaki kiple sürer. Kapalı başlar; açılınca okuma. Her şey kipi tek tık ve varsayılan değil.': 'An agent drives the app through the mode on this card. It starts off; when on, the mode is read. Everything is one click and is not the default.',
    'MCP açıkken bu uygulamayı açık tutun.': 'Keep this app open while MCP is enabled.',
    'Windows’ta %APPDATA%\\Claude\\claude_desktop_config.json dosyasına mcpServers bloğunu ekleyin.': 'On Windows, add the mcpServers block to %APPDATA%\\Claude\\claude_desktop_config.json.',
    'macOS’ta ~/Library/Application Support/Claude/claude_desktop_config.json dosyasına mcpServers bloğunu ekleyin.': 'On macOS, add the mcpServers block to ~/Library/Application Support/Claude/claude_desktop_config.json.',
    'Linux’ta ~/.config/Claude/claude_desktop_config.json dosyasına mcpServers bloğunu ekleyin.': 'On Linux, add the mcpServers block to ~/.config/Claude/claude_desktop_config.json.',
    'Claude Desktop’u tamamen kapatıp yeniden açın.': 'Quit Claude Desktop completely and open it again.',
    'Tablo %USERPROFILE%\\.codex\\config.toml dosyasına eklenir. codex mcp add de aynı yere yazar.': 'Add the table to %USERPROFILE%\\.codex\\config.toml. codex mcp add writes to that same file.',
    'Tablo ~/.codex/config.toml dosyasına eklenir. codex mcp add de aynı yere yazar.': 'Add the table to ~/.codex/config.toml. codex mcp add writes to that same file.',
    'Yeni bir Codex oturumu açın.': 'Open a new Codex session.',
    'Proje için .cursor/mcp.json, genel için %USERPROFILE%\\.cursor\\mcp.json kullanın.': 'Use .cursor/mcp.json for this project, or %USERPROFILE%\\.cursor\\mcp.json for every project.',
    'Proje için .cursor/mcp.json, genel için ~/.cursor/mcp.json kullanın.': 'Use .cursor/mcp.json for this project, or ~/.cursor/mcp.json for every project.',
    'Cursor MCP listesini yenileyin.': 'Reload the Cursor MCP list.',
    'Grok için yayınlanmış tek bir MCP ayar dosyası yok.': 'Grok does not publish one MCP settings file path.',
    'Stdio kabul eden istemcide aşağıdaki komutu kullanın.': 'If the client accepts stdio MCP, use the command below.',
    'mcpServers JSON’unu o istemcinin MCP listesine yapıştırın.': 'Paste the mcpServers JSON into that client\'s MCP list.',
    'Grok Bot yerel bir mcp.json yolu yayınlamıyor.': 'Grok Bot does not publish a local mcp.json path.',
    'Aynı stdio komutunu MCP sunucusu olarak ekleyin.': 'Add the same stdio command as an MCP server.',
    'Aşağıdaki mcpServers bloğu geçerlidir. Ayrı bir protokol yok.': 'The mcpServers block below is the one to use. There is no separate protocol.',
    'Ollama ayrı bir MCP protokolü değildir. Ücretsiz yerel model, aynı MCP sunucusuna bağlanan bir istemcidir.': 'Ollama is not a separate MCP protocol. The free local-model path is a client that connects to this same MCP server.',
    'Ollama’yı kurun, bir model çekin ve yerelde ollama serve çalışsın.': 'Install Ollama, pull a model, and run ollama serve locally.',
    'MCP konuşan istemcide modeli Ollama’ya yöneltin ve bu stdio sunucusunu ekleyin.': 'In an MCP-capable client, point the model at Ollama and add this stdio server.',
    'Aşağıdaki blok bu sunucudur.': 'The block below is this server.',
  };


  function normalize(value) { return String(value).replace(/\s+/g, ' ').trim(); }
  const EN_NORMALIZED = Object.fromEntries(
    Object.entries(EN).map(([key, translated]) => [normalize(key), translated])
  );

  function translate(value) {
    if (locale === 'tr' || value == null) return String(value == null ? '' : value);
    const raw = String(value);
    const compact = normalize(raw);
    const translated = EN_NORMALIZED[compact];
    if (translated) {
      const leading = raw.match(/^\s*/)?.[0] || '';
      const trailing = raw.match(/\s*$/)?.[0] || '';
      return `${leading}${translated}${trailing}`;
    }

    /* Birleşik etiketler.

       Katman ve efekt başlıkları çalışma anında parçalardan kuruluyor:
       "Görselleştirici · Barlar", "＋ Görsel Nesneler", "1. Eşikleme".
       Bütün birleşimleri sözlüğe yazmak kombinatoryal olurdu; onun yerine
       ayırıcıdan bölünüp parçalar ayrı ayrı çevriliyor. Sözlükte tam
       karşılığı olan bir metin buraya hiç gelmez, yukarıda yakalanır. */
    const seg = raw.match(/^(.+?) · (.+)$/);
    if (seg) return translate(seg[1]) + ' · ' + translate(seg[2]);
    const breadcrumb = raw.match(/^(.+?)\s+›\s+(.+)$/);
    if (breadcrumb) return translate(breadcrumb[1]) + ' › ' + translate(breadcrumb[2]);
    const arrow = raw.match(/^(.+?)\s+→\s+(.+)$/);
    if (arrow) return translate(arrow[1]) + ' → ' + translate(arrow[2]);
    const layersMatch = raw.match(/^(\d+)\s+Katman$/);
    if (layersMatch) return `${layersMatch[1]} ${Number(layersMatch[1]) === 1 ? 'Layer' : 'Layers'}`;
    const layerMatch = raw.match(/^Katman\s+(\d+)$/);
    if (layerMatch) return `Layer ${layerMatch[1]}`;
    const sceneMatch = raw.match(/^Sahne\s+(\d+)$/);
    if (sceneMatch) return `Scene ${sceneMatch[1]}`;
    const plus = raw.match(/^(\+)\s*(.+)$/);
    if (plus) return plus[1] + ' ' + translate(plus[2]);
    const numbered = raw.match(/^(\d+)\.\s+(.+)$/);
    if (numbered) return numbered[1] + '. ' + translate(numbered[2]);
    return raw
      /* Hata: öneki tek başına değişince gövde Türkçe kalıyordu. Gövde
         yeniden çevrilir; kamera ve dışa aktarma cümleleri de burada,
         alttaki genel "çıkış" değişiminden önce yakalanır. */
      .replace(/^Hata:\s*([\s\S]*)$/, (_, err) => (err ? ('Error: ' + translate(err)) : 'Error:'))
      .replace(/^Video açılamadı:\s*([\s\S]*)$/, (_, rest) => 'Could not open the video' + (rest ? ': ' + rest : '.'))
      .replace(/^Kamera açılamadı:\s*([\s\S]*)$/, (_, rest) => 'Could not open the camera' + (rest ? ': ' + rest : '.'))
      .replace(/^ffmpeg çıkış kodu (\d+)([\s\S]*)$/, (_, code, rest) => 'ffmpeg exit code ' + code + rest)
      .replace(/Ekran (\d+)( \(Birincil\))?/g, (_, n, p) => `Display ${n}${p ? ' (Primary)' : ''}`)
      .replace(/^(\d+) süreç$/g, (_, n) => n + (Number(n) === 1 ? ' process' : ' processes'))
      /* Basıklık panelinin maliyet satırı. Satırın TAMAMI için tek kural
         yazılamaz: yukarıdaki ' · ' ayırıcı kuralı metni parçalara bölüp
         her parçayı ayrı ayrı buraya gönderiyor, dolayısıyla bütün satırı
         eşleyen bir desen hiçbir zaman denenmez. Parça başına kural. */
      /* Otomatik VJ aralik kaydiricisinin degeri. Kaydirici yalnizca
         Otomatik VJ ACIKKEN ciziliyor, bu yuzden duman testinin taramasi
         onu hic gormemisti ve kural bugune kadar eksik kalmisti. */
      .replace(/^(\d+) ölçü$/g, (_, n) => n + (Number(n) === 1 ? ' bar' : ' bars'))
      .replace(/^ekran (\d+)×(\d+)$/g, 'screen $1×$2')
      .replace(/^çizim (\d+)×(\d+)$/g, 'drawing $1×$2')
      .replace(/^([\d.]+) kat piksel$/g, '$1× the pixels')
      .replace(/^Uygulama başına ses yakalama Windows yapı (\d+) ve üstünü gerektiriyor; bu bilgisayarda yapı (\d+)\.$/g,
        'Per-application audio capture requires Windows build $1 or newer; this computer has build $2.')
      .replace(/Şablonum (\d+)/g, 'My Preset $1')
      .replace(/Görsel (\d+)/g, 'Image $1')
      .replace(/(\d+) uyumlu aydınlatma aygıtı bulundu/g, '$1 compatible lighting device(s) found')
      .replace(/Portable sürüm yalnızca uygulama odaktayken kontrol eder \((\d+)\/(\d+)\)\./g, 'The portable build controls lighting only while the application is focused ($1/$2).')
      .replace(/LED \/ bölge/g, 'LED / zone')
      .replace(/Yakalanıyor: /g, 'Capturing: ')
      .replace(/çıkış/g, 'output')
      .replace(/^Tamamlandı/g, 'Completed')
      .replace(/WebGL başlatılamadı:/g, 'WebGL could not be initialized:')
      .replace(/Shader hatası:/g, 'Shader error:')
      .replace(/Program hatası:/g, 'Program error:')
      .replace(/İçe aktarılamadı:/g, 'Import failed:')
      .replace(/Kodlanıyor \(([^)]+)\)… kareler bitti, video yazılıyor\./g, 'Encoding ($1)… frames complete, writing video.')
      .replace(/^Ekran (\d+) ekran seçili$/g, '$1 displays selected')
      .replace(/^(\d+) ekran seçili$/g, '$1 displays selected')
      .replace(/^(\d+) ekranda açık$/g, 'Open on $1 displays')
      .replace(/^“(.+)” kaydedildi\.$/g, '"$1" saved.')
      .replace(/^“(.+)” sahneye uygulandı\.$/g, '"$1" applied to the scene.')
      .replace(/^“(.+)” kalıcı olarak silinecek\.$/g, '"$1" will be permanently deleted.')
      .replace(/^(\d+) preset içe aktarıldı\.$/g, (m, n) => n + ' preset' + (Number(n) === 1 ? '' : 's') + ' imported.')
      .replace(/^Kamera (\d+)$/g, 'Camera $1')
      .replace(/^Parametre (\d+)$/g, 'Parameter $1')
      .replace(/^Satır (\d+): /g, 'Line $1: ')
      .replace(/^Satır (\d+)$/g, 'Row $1')
      .replace(/^Deste · Satır (\d+)$/g, 'Deck · Row $1')
      .replace(/^Deste · (.+)$/g, (m, rest) => `Deck · ${translate(rest)}`)
       .replace(/^(.+) kopyalandı\.$/g, (m, label) => `${translate(label)} copied.`)
      .replace(/^Kaydedilemedi: /g, 'Could not save: ')
      .replace(/^MIDI erişimi reddedildi: /g, 'MIDI access denied: ')
      .replace(/^(\d+) FPS$/g, '$1 FPS')
      .replace(/^Bulunan ekran hızı: (.+)$/g, 'Detected screen refresh rate: $1')
      .replace(/^(.*) \(kopya\)$/, (m, base) => (EN_NORMALIZED[normalize(base)] || base) + ' (copy)')
      .replace(/^(\d+) kayıtlı$/g, '$1 saved')
      .replace(/^(\d+) (sahne|şablon|preset|dilim|[Kk]atman)$/g, (m, n, word) => {
        const w = word.toLowerCase();
        const one = { sahne: 'scene', 'şablon': 'preset', preset: 'preset', dilim: 'slice', katman: 'layer' }[w];
        return n + ' ' + (w === 'katman' ? (Number(n) === 1 ? 'Layer' : 'Layers') : (one + (Number(n) === 1 ? '' : 's')));
      })
      .replace(/^Sahne (\d+)$/g, 'Scene $1')
      .replace(/^Katman (\d+)$/g, 'Layer $1')
      .replace(/^Katman (\d+) · (.+)$/g, (m, n, rest) => `Layer ${n} · ${translate(rest)}`)
      .replace(/^(\d+) preset\(s\) imported\.$/g, (m, n) =>
        n + ' preset' + (Number(n) === 1 ? '' : 's') + ' imported.')
      // Dynamic Lighting kontrol durumu (sayı içerdiği için sözlükle eşleşmez)
      .replace(/Windows (\d+)\/(\d+) aygıt için kontrol verdi/g, 'Windows granted control for $1/$2 device(s)')
      .replace(/Windows arka plan kontrolünü vermedi \((\d+)\/(\d+)\)\. Dynamic Lighting ayarlarında CAYADEV Visualizer uygulamasını listenin en üstüne taşıyın\./g, 'Windows did not grant background control ($1/$2). Move CAYADEV Visualizer to the top of the list in Dynamic Lighting settings.')
      .replace(/^CC (\d+)( · k(\d+))?$/g, (m, cc, _s, ch) => 'CC ' + cc + (ch ? ' · ch' + ch : ''))
      .replace(/^Nota (\d+)( · k(\d+))?$/g, (m, n, _s, ch) => 'Note ' + n + (ch ? ' · ch' + ch : ''))
      // Çalan parça dinamik metinleri
      .replace(/^([\d.]+) sn$/g, '$1 s')
      .replace(/^(\d+) bölme$/g, '$1 segments')
      .replace(/^Sistemden okunamıyor — (.+)$/g, 'Cannot read from system — $1')
      .replace(/^Çalan Şarkıyı Alanlara Doldur \((.+)\)$/g, 'Fill Fields with Playing Track ($1)')
      .replace(/^Çalan Şarkıyı Doldur \((.+)\)$/g, 'Fill Playing Track ($1)')
      // MilkDrop list count
      .replace(/^(\d+) presetten ilk (\d+) gösteriliyor; aramayı daraltın\.$/g, 'Showing first $2 of $1 presets; narrow your search.')
      // Metin ve söz satır/format çıktıları
      .replace(/^(\d+) satır$/g, '$1 lines')
      .replace(/^(\d+) satır okundu( \([^)]+\))?$/g, '$1 lines read$2')
      .replace(/^(\d+) satır · (.+)$/g, (m, n, rest) => `${n} lines · ${translate(rest)}`)
      // Vuruş ve tempo
      .replace(/^([\d.]+) vuruş$/g, '$1 beats')
      // Zaman çizelgesi parça ve işaretleri
      .replace(/^Parça (\d+)$/g, 'Track $1')
      .replace(/^İşaret (\d+)$/g, 'Marker $1')
      .replace(/^(\d+) işaret üretildi\.$/g, '$1 markers generated.')
      // Dışa aktarım ve protokol çıkışları
      .replace(/^(.+) Çıkışı$/g, (m, p) => `${translate(p)} Output`)
      .replace(/^[“"](.+)[”"] silinsin mi\?$/g, (_, name) => `Delete "${translate(name)}"?`)
      .replace(/^[“"](.+)[”"] uygulandı\.$/g, (_, name) => `"${translate(name)}" applied.`)
      .replace(/^[“"](.+)[”"] sahneye uygulandı\.$/g, (_, name) => `"${translate(name)}" applied to scene.`)
      .replace(/^[“"](.+)[”"] kalıcı olarak silinecek\.$/g, (_, name) => `"${translate(name)}" will be permanently deleted.`)
      .replace(/^Bu bir varyasyon presetidir: temel mod [“"](.+)[”"] ve o anki tüm ayarları saklanır\. ?$/g,
        (_, base) => `This is a variation preset: base mode "${translate(base)}" and all current settings are saved.`)
      .replace(/^Başlatılamadı: (.+)$/g, (_, err) => `Could not start: ${translate(err)}`)
      .replace(/^Kayıt başlatılamadı: (.+)$/g, (_, err) => `Could not start recording: ${translate(err)}`)
      .replace(/^Kaydedilemedi: (.+)$/g, (_, err) => `Could not save: ${translate(err)}`)
      .replace(/^Ayarlar dışa aktarılamadı: (.+)$/g, (_, err) => `Could not export settings: ${translate(err)}`)
      .replace(/^Ayarlar içe aktarılamadı: (.+)$/g, (_, err) => `Could not import settings: ${translate(err)}`)
      .replace(/^Panel başlatılamadı: (.+)$/g, (_, err) => `Could not initialize panel: ${translate(err)}`)
      .replace(/^Görüntü kaydedildi: (.+)$/g, 'Image saved: $1')
      .replace(/^Kaydedildi: (.+)$/g, 'Saved: $1')
      .replace(/^Kayıt çok kısa: kare yazılamadı \((.+)\)$/g, 'Recording too short: frame could not be written ($1)')
      .replace(/^(\d+) ekran seçili$/g, '$1 displays selected')
      .replace(/^(\d+) ekranda açık$/g, 'Open on $1 displays')
      .replace(/^(\d+) uyumlu aydınlatma aygıtı bulundu$/g, '$1 compatible lighting device(s) found')
      .replace(/^(\d+) ses aygıtı bulundu$/g, '$1 audio device(s) found')
      .replace(/^(\d+) preset içe aktarıldı\.$/g, '$1 presets imported.')
      .replace(/^Yakalanıyor: (.+)$/g, (m, dev) => `Capturing: ${translate(dev)}`)
      .replace(/^Kodlanıyor \((.+)\)… kareler bitti, video yazılıyor\.$/g, 'Encoding ($1)… frames finished, writing video.')
      .replace(/^Render ediliyor \[(.+)\]… %(\d+)  \((\d+) \/ (\d+) kare\)$/g, 'Rendering [$1]… $2% ($3 / $4 frames)')
      .replace(/^Tamamlandı \((.+)\) → (.+)$/g, 'Completed ($1) → $2')
      .replace(/^Tamamlandı \((.+)\)$/g, 'Completed ($1)')
      .replace(/^Şablonum (\d+)$/g, 'My Template $1')
      .replace(/^Portable sürüm yalnızca uygulama odaktayken kontrol eder \((\d+)\/(\d+)\)\.$/g, 'Portable version only controls while app is in focus ($1/$2).')
      ;
  }

  function translateNode(node) {
    if (node.nodeType === Node.TEXT_NODE) {
      const next = translate(node.nodeValue);
      if (next !== node.nodeValue) node.nodeValue = next;
      return;
    }
    if (node.nodeType !== Node.ELEMENT_NODE) return;
    for (const attr of ['title', 'placeholder', 'aria-label', 'label']) {
      if (!node.hasAttribute(attr)) continue;
      const current = node.getAttribute(attr);
      const next = translate(current);
      if (next !== current) node.setAttribute(attr, next);
    }
    for (const child of node.childNodes) translateNode(child);
  }


  const MCP_I18N = {
  "mcp.mode.read.word": {
    "tr": "okuma",
    "en": "read"
  },
  "mcp.mode.apply.word": {
    "tr": "uygula",
    "en": "apply"
  },
  "mcp.mode.write.word": {
    "tr": "yaz",
    "en": "write"
  },
  "mcp.mode.full.word": {
    "tr": "tam",
    "en": "full"
  },
  "mcp.mode.everything.word": {
    "tr": "her şey",
    "en": "everything"
  },
  "mcp.mode.read.label": {
    "tr": "Okuma",
    "en": "Read"
  },
  "mcp.mode.apply.label": {
    "tr": "Uygula",
    "en": "Apply"
  },
  "mcp.mode.write.label": {
    "tr": "Yazma",
    "en": "Write"
  },
  "mcp.mode.full.label": {
    "tr": "Tam",
    "en": "Full"
  },
  "mcp.mode.everything.label": {
    "tr": "Her şey",
    "en": "Everything"
  },
  "mcp.mode.read.hint": {
    "tr": "Her şeyi görür (preset, efekt, ekran, durum) ama hiçbir şeyi değiştirmez.",
    "en": "Sees everything (preset, effects, screens, state) and changes nothing."
  },
  "mcp.mode.apply.hint": {
    "tr": "Var olanı da uygular; oluşturamaz ve düzenleyemez.",
    "en": "Can also apply what already exists, and cannot create or edit."
  },
  "mcp.mode.write.hint": {
    "tr": "Oluşturur ve düzenler (Otomatik VJ dahil); ışık, eşleme, pencere, zaman çizelgesi sarma/durdurma, Spout ve yayın ağı/jetonu kapalı kalır.",
    "en": "Can create and edit, including Auto VJ; lighting, mapping, windows, timeline seek/stop, Spout, and stream LAN/token stay off."
  },
  "mcp.mode.full.hint": {
    "tr": "Işık, eşleme, pencere, zaman çizelgesi, Spout ve yayın dahil normal gösteri kontrolleri; güncelleme kurma ve ses onarımı yok.",
    "en": "Normal show controls, including those live surfaces; no app-update install and no audio repair."
  },
  "mcp.mode.everything.hint": {
    "tr": "Bunların tümü, artı güncelleme, ses onarımı ve jeton döndürme.",
    "en": "All of that, plus updates, audio repair, and token rotation."
  },
  "mcp.mode.read.unlocks": {
    "tr": "Her şeyi görür (preset, efekt, ekran, durum) ama hiçbir şeyi değiştirmez.",
    "en": "Sees everything (preset, effects, screens, state) and changes nothing."
  },
  "mcp.mode.apply.unlocks": {
    "tr": "Var olanı da uygular; oluşturamaz ve düzenleyemez.",
    "en": "Can also apply what already exists, and cannot create or edit."
  },
  "mcp.mode.write.unlocks": {
    "tr": "Oluşturur ve düzenler (Otomatik VJ dahil); ışık, eşleme, pencere, zaman çizelgesi sarma/durdurma, Spout ve yayın ağı/jetonu kapalı kalır.",
    "en": "Can create and edit, including Auto VJ; lighting, mapping, windows, timeline seek/stop, Spout, and stream LAN/token stay off."
  },
  "mcp.mode.full.unlocks": {
    "tr": "Işık, eşleme, pencere, zaman çizelgesi, Spout ve yayın dahil normal gösteri kontrolleri; güncelleme kurma ve ses onarımı yok.",
    "en": "Normal show controls, including those live surfaces; no app-update install and no audio repair."
  },
  "mcp.mode.everything.unlocks": {
    "tr": "Bunların tümü, artı güncelleme, ses onarımı ve jeton döndürme.",
    "en": "All of that, plus updates, audio repair, and token rotation."
  },
  "mcp.err.mode": {
    "tr": "Bu iş için MCP modu «{mode}» gerekir. Modu sen değiştirme. Yönetici panelini tıklama. Kullanıcıya söyle ve dur.",
    "en": "This needs MCP mode «{mode}». Do not change the mode yourself. Do not click the admin UI. Tell the user and stop."
  },
  "mcp.err.disabled": {
    "tr": "MCP kapalı. Bu iş için MCP modu «{mode}» gerekir. Modu sen değiştirme. Yönetici panelini tıklama. Kullanıcıya söyle ve dur.",
    "en": "MCP is off. This needs MCP mode «{mode}». Do not change the mode yourself. Do not click the admin UI. Tell the user and stop."
  },
  "mcp.err.mcp": {
    "tr": "MCP izinlerini sen değiştiremezsin. Modu sen değiştirme. Yönetici panelini tıklama. Kullanıcıya söyle ve dur.",
    "en": "You cannot change MCP permissions. Do not change the mode yourself. Do not click the admin UI. Tell the user and stop."
  },
  "mcp.err.token": {
    "tr": "Jeton döndürmek Her şey kipini ister. sv_rotate_stream_token kullanın.",
    "en": "Rotating a token needs Everything. Use sv_rotate_stream_token."
  },
  "mcp.err.unavailable": {
    "tr": "Bu işlem bu süreçte yok.",
    "en": "This action is not available in this process."
  },
  "mcp.err.repairManual": {
    "tr": "Ses onarımı uygulamada elle bir adım ister. MCP sistem penceresi açmaz.",
    "en": "Audio repair needs a manual step in the app. MCP will not open a system dialog."
  },
  "mcp.perm.read": {
    "tr": "İzin: MCP açıkken okuma.",
    "en": "Permission: read while MCP is on."
  },
  "mcp.perm.routed": {
    "tr": "İzin: yola göre, kip merdivenine bağlı.",
    "en": "Permission: depends on the path and the mode ladder."
  },
  "mcp.perm.needs": {
    "tr": "İzin: {mode} veya üstü.",
    "en": "Permission: {mode} or higher."
  },
  "mcp.perm.handsOff": {
    "tr": "Modu sen değiştirme. Yönetici panelini tıklama. Gerekli kipin adını kullanıcıya söyle ve dur.",
    "en": "Do not change the mode yourself. Do not click the admin UI. Tell the user the minimum mode name and stop."
  },
  "mcp.card.note": {
    "tr": "Beş kip birikir. Anahtar kapalıyken ajan hiçbir şey yapamaz. Açılınca varsayılan kip okumadır. Her şey tek tık ve varsayılan seçili değildir.",
    "en": "Five modes stack. While the master switch is off the agent can do nothing. When it is on, the default mode is read. Everything is one click and is not selected by default."
  },
  "mcp.card.off": {
    "tr": "MCP kapalı.",
    "en": "MCP is off."
  },
  "mcp.card.listening": {
    "tr": "stdio dinleniyor.",
    "en": "Listening on stdio."
  },
  "mcp.card.starting": {
    "tr": "MCP açılıyor…",
    "en": "MCP is starting…"
  },
  "mcp.card.setup": {
    "tr": "Kurulum",
    "en": "Setup"
  },
  "mcp.card.copy": {
    "tr": "Kopyala",
    "en": "Copy"
  },
  "mcp.card.copied": {
    "tr": "Kopyalandı.",
    "en": "Copied."
  },
  "mcp.card.copyFail": {
    "tr": "Kopyalanamadı.",
    "en": "Could not copy."
  },
  "mcp.card.close": {
    "tr": "Kapat",
    "en": "Close"
  },
  "mcp.card.master": {
    "tr": "MCP",
    "en": "MCP"
  },
  "mcp.setup.note": {
    "tr": "Hepsi aynı stdio sunucusuna bağlanır. Ağ portu yalnız 127.0.0.1. Ollama ayrı bir protokol değildir.",
    "en": "They all connect to the same stdio server. The network port is only 127.0.0.1. Ollama is not a separate protocol."
  },
  "mcp.setup.title": {
    "tr": "MCP kurulumu",
    "en": "MCP setup"
  },
  "mcp.setup.keepOpen": {
    "tr": "MCP açıkken bu uygulamayı açık tutun.",
    "en": "Keep this app open while MCP is enabled."
  },
  "mcp.setup.claude.file": {
    "tr": "Windows’ta %APPDATA%\\Claude\\claude_desktop_config.json dosyasına mcpServers bloğunu ekleyin.",
    "en": "Add the mcpServers block to %APPDATA%\\Claude\\claude_desktop_config.json on Windows."
  },
  "mcp.setup.claude.restart": {
    "tr": "Claude Desktop’u tamamen kapatıp yeniden açın.",
    "en": "Quit Claude Desktop completely and open it again."
  },
  "mcp.setup.codex.file": {
    "tr": "Tablo %USERPROFILE%\\.codex\\config.toml dosyasına eklenir. codex mcp add de aynı yere yazar.",
    "en": "The table goes in %USERPROFILE%\\.codex\\config.toml. codex mcp add writes there too."
  },
  "mcp.setup.codex.session": {
    "tr": "Yeni bir Codex oturumu açın.",
    "en": "Open a new Codex session."
  },
  "mcp.setup.cursor.file": {
    "tr": "Proje için .cursor/mcp.json, genel için %USERPROFILE%\\.cursor\\mcp.json kullanın.",
    "en": "Use .cursor/mcp.json for this project, or %USERPROFILE%\\.cursor\\mcp.json for every project."
  },
  "mcp.setup.cursor.reload": {
    "tr": "Cursor MCP listesini yenileyin.",
    "en": "Reload the Cursor MCP list."
  },
  "mcp.setup.grok.none": {
    "tr": "Grok için yayınlanmış tek bir MCP ayar dosyası yok.",
    "en": "Grok does not publish one MCP settings file path."
  },
  "mcp.setup.grok.stdio": {
    "tr": "Stdio kabul eden istemcide aşağıdaki komutu kullanın.",
    "en": "If the client accepts stdio MCP, use the command below."
  },
  "mcp.setup.grok.paste": {
    "tr": "mcpServers JSON’unu o istemcinin MCP listesine yapıştırın.",
    "en": "Paste the mcpServers JSON into that client's MCP list."
  },
  "mcp.setup.grokbot.none": {
    "tr": "Grok Bot yerel bir mcp.json yolu yayınlamıyor.",
    "en": "Grok Bot does not publish a local mcp.json path."
  },
  "mcp.setup.grokbot.add": {
    "tr": "Aynı stdio komutunu MCP sunucusu olarak ekleyin.",
    "en": "Add the same stdio command as an MCP server."
  },
  "mcp.setup.grokbot.block": {
    "tr": "Aşağıdaki mcpServers bloğu geçerlidir. Ayrı bir protokol yok.",
    "en": "The mcpServers block below is the one to use. There is no separate protocol."
  },
  "mcp.setup.ollama.same": {
    "tr": "Ollama ayrı bir MCP protokolü değildir. Ücretsiz yerel model, aynı MCP sunucusuna bağlanan bir istemcidir.",
    "en": "Ollama is not a separate MCP protocol. The free local-model path is a client that connects to this same MCP server."
  },
  "mcp.setup.ollama.install": {
    "tr": "Ollama’yı kurun, bir model çekin ve yerelde ollama serve çalışsın.",
    "en": "Install Ollama, pull a model, and run ollama serve locally."
  },
  "mcp.setup.ollama.point": {
    "tr": "MCP konuşan istemcide modeli Ollama’ya yöneltin ve bu stdio sunucusunu ekleyin.",
    "en": "In an MCP-capable client, point the model at Ollama and add this stdio server."
  },
  "mcp.setup.ollama.block": {
    "tr": "Aşağıdaki blok bu sunucudur.",
    "en": "The block below is this server."
  },
  "mcp.tool.sv_get_state": {
    "tr": "Gösteri durumunu okur: sahne, katmanlar, efektler, karartma, izinler ve ses. Salt okunur.",
    "en": "Read show state: scene, layers, effects, blackout, permissions, and audio. Read-only."
  },
  "mcp.tool.sv_get_visual_state": {
    "tr": "Canlı görsel durumu okur: katman konumları, ayarlar, katman efektleri, genel efektler, etkin sahne. Salt okunur.",
    "en": "Read live visual state: layer positions, settings, per-layer effects, global effects, active scene. Read-only."
  },
  "mcp.tool.sv_get_preview": {
    "tr": "Görsel durumu ve açık bir pencere varsa canlı tuvalin küçük JPEG görüntüsünü okur. Salt okunur. Düzenlemeler arasında kullanın.",
    "en": "Read visual state plus a small JPEG of the live canvas when a window is open. Read-only. Use it between edits."
  },
  "mcp.tool.sv_get_audio": {
    "tr": "BPM ile seviye, bas, orta ve tiz değerlerini okur. Salt okunur.",
    "en": "Read BPM and level/bass/mid/treble. Read-only."
  },
  "mcp.tool.sv_get_now_playing": {
    "tr": "Çalan parçayı okur. Salt okunur.",
    "en": "Read the current track. Read-only."
  },
  "mcp.tool.sv_list_scenes": {
    "tr": "Kayıtlı sahneleri listeler. Salt okunur.",
    "en": "List saved scenes. Read-only."
  },
  "mcp.tool.sv_get_scene": {
    "tr": "Kayıtlı bir sahneyi okur. Salt okunur.",
    "en": "Read one saved scene. Read-only."
  },
  "mcp.tool.sv_list_layers": {
    "tr": "Katmanları konum, ayar ve efektleriyle listeler. Salt okunur.",
    "en": "List layers with position, settings, and effects. Read-only."
  },
  "mcp.tool.sv_get_layer": {
    "tr": "Bir katmanı okur. Salt okunur.",
    "en": "Read one layer. Read-only."
  },
  "mcp.tool.sv_list_effects": {
    "tr": "Genel ve katman efektlerini ve hazır tür kataloğunu listeler. Salt okunur.",
    "en": "List global and per-layer effects plus the built-in type catalog. Read-only."
  },
  "mcp.tool.sv_list_modes": {
    "tr": "Bütün görselleştirici ve arkaplan mod kimliklerini, katman türlerini ve karışım kiplerini listeler. Salt okunur.",
    "en": "List every visualizer and background mode id, the layer kinds and blend modes. Read-only."
  },
  "mcp.tool.sv_list_presets": {
    "tr": "Kitaplık presetlerini ve kullanıcı renk presetlerini listeler. Salt okunur.",
    "en": "List library presets and user color presets. Read-only."
  },
  "mcp.tool.sv_list_displays": {
    "tr": "Ekranları listeler. Salt okunur.",
    "en": "List displays. Read-only."
  },
  "mcp.tool.sv_get_output_status": {
    "tr": "Görselleştirici ve yayın durumunu okur. Salt okunur. Yayın jetonları dahil değildir.",
    "en": "Read visualizer and stream status. Read-only. Stream tokens are not included."
  },
  "mcp.tool.sv_get_config": {
    "tr": "Yapılandırmayı veya noktalı bir yolu okur. Yayın jetonları gizlenir. Salt okunur.",
    "en": "Read config or one dotted path. Stream tokens are redacted. Read-only."
  },
  "mcp.tool.sv_list_permissions": {
    "tr": "Geçerli MCP kipini ve bir aracın en düşük kipini bildirir. Modu sen değiştirme. Yönetici panelini tıklama. Kullanıcıya söyle ve dur.",
    "en": "Report the current MCP mode and the minimum mode a tool needs. Do not change the mode yourself. Do not click the admin UI. Tell the user and stop."
  },
  "mcp.tool.sv_get_timeline": {
    "tr": "Zaman çizelgesi verisini okur. Salt okunur.",
    "en": "Read timeline data. Read-only."
  },
  "mcp.tool.sv_get_clipdeck": {
    "tr": "Klip destesi yuvalarını okur. Salt okunur.",
    "en": "Read clip deck slots. Read-only."
  },
  "mcp.tool.sv_get_autovj": {
    "tr": "Otomatik VJ ayarlarını okur. Salt okunur.",
    "en": "Read Auto VJ settings. Read-only."
  },
  "mcp.tool.sv_apply_scene": {
    "tr": "Var olan bir sahneye kimlik veya adla geçer. Sahne içeriğini oluşturmaz veya düzenlemez.",
    "en": "Switch to an existing scene by id or name. Does not create or edit scene contents."
  },
  "mcp.tool.sv_set_visualizer_type": {
    "tr": "Klasik görselleştiriciyi var olan bir kip kimliğine alır.",
    "en": "Switch the classic visualizer to an existing mode id."
  },
  "mcp.tool.sv_set_background_type": {
    "tr": "Arkaplanı var olan bir kip kimliğine alır.",
    "en": "Switch the background to an existing mode id."
  },
  "mcp.tool.sv_set_layer_enabled": {
    "tr": "Var olan bir katmanı gösterir veya gizler ve katman yığınını açar. Katman içeriğini değiştirmez.",
    "en": "Show or hide an existing layer and turn the layer stack on. Does not change layer contents."
  },
  "mcp.tool.sv_set_crossfade": {
    "tr": "Var olan A/B geçiş sürgüsünü oynatır (0 ile 1 arası).",
    "en": "Move the existing A/B crossfader (0..1)."
  },
  "mcp.tool.sv_apply_template": {
    "tr": "Var olan yerleşik bir şablonu kimliğiyle uygular.",
    "en": "Apply an existing built-in template by id."
  },
  "mcp.tool.sv_timeline_transport": {
    "tr": "Var olan zaman çizelgesini yönetici taşımasıyla oynatır, duraklatır, durdurur veya sarar.",
    "en": "Play, pause, stop, or seek the existing timeline via the admin transport."
  },
  "mcp.tool.sv_trigger_clip": {
    "tr": "Var olan bir klip destesi yuvasını ateşler. Izgarayı düzenlemez.",
    "en": "Fire an existing clip-deck slot. Does not edit the grid."
  },
  "mcp.tool.sv_stop_clips": {
    "tr": "Klip destesindeki bütün çalan yuvaları durdurur. Izgarayı düzenlemez.",
    "en": "Stop every playing clip-deck slot. Does not edit the grid."
  },
  "mcp.tool.sv_set_autovj": {
    "tr": "Otomatik VJ'yi açar veya kapatır ve var olan sahne, kip veya paletlerde nasıl ilerleyeceğini seçer.",
    "en": "Turn Auto VJ on or off and choose how it walks existing scenes, modes, or palettes."
  },
  "mcp.tool.sv_create_scene": {
    "tr": "Geçerli görsellerden bir sahne oluşturur. Yazarlık.",
    "en": "Create a scene from the current visuals. Authoring."
  },
  "mcp.tool.sv_update_scene": {
    "tr": "Var olan bir sahnenin üzerine geçerli görselleri yazar. Yazarlık.",
    "en": "Overwrite an existing scene with the current visuals. Authoring."
  },
  "mcp.tool.sv_rename_scene": {
    "tr": "Bir sahneyi yeniden adlandırır. Yazarlık.",
    "en": "Rename a scene. Authoring."
  },
  "mcp.tool.sv_delete_scene": {
    "tr": "Bir sahneyi siler. Yazarlık.",
    "en": "Delete a scene. Authoring."
  },
  "mcp.tool.sv_add_layer": {
    "tr": "Bir katman ekler ve katman yığınını açar. Yazarlık.",
    "en": "Add a layer and turn the layer stack on. Authoring."
  },
  "mcp.tool.sv_update_layer": {
    "tr": "Katmanın adını, türünü, opaklığını, karışımını, dönüşümünü veya ayarlarını değiştirir. Efekt eklemez. Yazarlık.",
    "en": "Change layer name, type, opacity, blend, transform, or settings. Does not add effects. Authoring."
  },
  "mcp.tool.sv_set_layer_position": {
    "tr": "Katmanın x, y, ölçek ve dönüşünü ayarlar. Yazarlık.",
    "en": "Set layer x, y, scale, and rotate. Authoring."
  },
  "mcp.tool.sv_set_layer_settings": {
    "tr": "Var olan bir katmanın ayarlarını birleştirir. Yazarlık.",
    "en": "Merge settings on an existing layer. Authoring."
  },
  "mcp.tool.sv_remove_layer": {
    "tr": "Bir katmanı kaldırır. Yazarlık.",
    "en": "Remove a layer. Authoring."
  },
  "mcp.tool.sv_reorder_layers": {
    "tr": "Katmanları kimlik listesine göre sıralar. Yazarlık.",
    "en": "Reorder layers by id list. Authoring."
  },
  "mcp.tool.sv_set_text": {
    "tr": "Yazı katmanını düzenler. Söz veya çalan parça kaynağı da buna dahildir. Yazarlık.",
    "en": "Edit the text overlay, including a lyrics or now-playing source. Authoring."
  },
  "mcp.tool.sv_set_logo": {
    "tr": "Logo ayarlarını düzenler. Yazarlık.",
    "en": "Edit logo settings. Authoring."
  },
  "mcp.tool.sv_set_media": {
    "tr": "Medya katmanı ayarlarını düzenler. Yazarlık.",
    "en": "Edit media-layer settings. Authoring."
  },
  "mcp.tool.sv_set_geometry": {
    "tr": "Geometri ayarlarını düzenler. Yazarlık.",
    "en": "Edit geometry settings. Authoring."
  },
  "mcp.tool.sv_set_effect_enabled": {
    "tr": "Genel zincirde zaten duran bir efekti açar veya kapatır.",
    "en": "Enable or disable an effect already on the global chain."
  },
  "mcp.tool.sv_set_effect_param": {
    "tr": "Zaten var olan genel bir efektin parametrelerini değiştirir.",
    "en": "Change parameters of a global effect that already exists."
  },
  "mcp.tool.sv_set_layer_effect_enabled": {
    "tr": "Bir katmanda zaten duran bir efekti açar veya kapatır.",
    "en": "Enable or disable an effect already on a layer."
  },
  "mcp.tool.sv_set_layer_effect_param": {
    "tr": "Bir katmanda zaten duran bir efektin parametrelerini değiştirir.",
    "en": "Change parameters of an effect already on a layer."
  },
  "mcp.tool.sv_set_modulation_enabled": {
    "tr": "Yolları düzenlemeden modülasyon matrisini açar veya kapatır.",
    "en": "Turn the modulation matrix on or off without editing routes."
  },
  "mcp.tool.sv_set_macro": {
    "tr": "Var olan bir makro sürgüsünü ayarlar.",
    "en": "Set an existing macro fader."
  },
  "mcp.tool.sv_add_effect": {
    "tr": "Genel zincire bir efekt ekler. Yazarlık.",
    "en": "Add an effect to the global chain. Authoring."
  },
  "mcp.tool.sv_remove_effect": {
    "tr": "Genel bir efekti kaldırır. Yazarlık.",
    "en": "Remove a global effect. Authoring."
  },
  "mcp.tool.sv_add_layer_effect": {
    "tr": "Belirli bir katmana efekt ekler. Yazarlık. Devam etmek için ardından durumu okuyun.",
    "en": "Add an effect onto a specific layer. Authoring. Read state afterwards to continue."
  },
  "mcp.tool.sv_remove_layer_effect": {
    "tr": "Bir katmandan efekt kaldırır. Yazarlık.",
    "en": "Remove an effect from a layer. Authoring."
  },
  "mcp.tool.sv_add_modulation_route": {
    "tr": "Bir modülasyon yolu ekler. Yazarlık.",
    "en": "Add a modulation route. Authoring."
  },
  "mcp.tool.sv_remove_modulation_route": {
    "tr": "Bir modülasyon yolunu kaldırır. Yazarlık.",
    "en": "Remove a modulation route. Authoring."
  },
  "mcp.tool.sv_load_preset": {
    "tr": "Var olan bir kitaplık presetini MilkDrop içine yükler. Yeni bir preset dosyası yazmaz.",
    "en": "Load an existing library preset into MilkDrop. Does not write a new preset file."
  },
  "mcp.tool.sv_apply_color_preset": {
    "tr": "Var olan bir kullanıcı veya yerleşik renk presetini uygular. Yenisini oluşturmaz.",
    "en": "Apply an existing user or built-in color preset. Does not create one."
  },
  "mcp.tool.sv_set_milkdrop_cycle": {
    "tr": "Var olan MilkDrop kitaplığının nasıl ilerleyeceğini değiştirir. Preset kaynağı yazmaz.",
    "en": "Change how the existing MilkDrop library advances. Does not write preset source."
  },
  "mcp.tool.sv_save_preset": {
    "tr": "Uygulama preset deposuna bir preset dosyası yazar. Yazarlık.",
    "en": "Write a preset file in the app preset store. Authoring."
  },
  "mcp.tool.sv_delete_preset": {
    "tr": "Bir preset dosyasını siler. Yazarlık.",
    "en": "Delete a preset file. Authoring."
  },
  "mcp.tool.sv_set_milkdrop_source": {
    "tr": "MilkDrop kaynağını canlı yapılandırmaya yazar. Yazarlık. Var olan bir kimliği yüklemek sv_load_preset aracıdır.",
    "en": "Write MilkDrop source into the live config. Authoring. Loading an existing id is sv_load_preset."
  },
  "mcp.tool.sv_create_color_preset": {
    "tr": "Bir kullanıcı renk preseti kaydeder. Yazarlık.",
    "en": "Save a user color preset. Authoring."
  },
  "mcp.tool.sv_delete_color_preset": {
    "tr": "Bir kullanıcı renk presetini siler. Yazarlık.",
    "en": "Delete a user color preset. Authoring."
  },
  "mcp.tool.sv_open_output": {
    "tr": "Görselleştiriciyi seçilen ekranlarda açar.",
    "en": "Open the visualizer on the selected displays."
  },
  "mcp.tool.sv_close_output": {
    "tr": "Görselleştirici pencerelerini kapatır.",
    "en": "Close visualizer windows."
  },
  "mcp.tool.sv_set_displays": {
    "tr": "Ekranları açmadan seçer.",
    "en": "Choose displays without opening them."
  },
  "mcp.tool.sv_set_stream": {
    "tr": "OBS ve web yayın ayarlarını değiştirir. Jeton alanları burada yok sayılır.",
    "en": "Change OBS/web stream settings. Token fields are ignored here."
  },
  "mcp.tool.sv_set_texture_share": {
    "tr": "Spout veya Syphon ayarlarını değiştirir.",
    "en": "Change Spout/Syphon settings."
  },
  "mcp.tool.sv_set_aspect": {
    "tr": "En-boy ayarlarını değiştirir.",
    "en": "Change aspect settings."
  },
  "mcp.tool.sv_set_floating": {
    "tr": "Yüzen pencere tercihlerini değiştirir.",
    "en": "Change floating window preferences."
  },
  "mcp.tool.sv_set_floating_open": {
    "tr": "Yüzen pencereyi (PiP) açar veya kapatır. Ekran menüsündeki anahtarla aynı pencere. Saydamlık ve tıklama geçişini değiştirmez.",
    "en": "Open or close the floating PiP window. Same window as the display-menu switch. Does not change opacity or click-through."
  },
  "mcp.tool.sv_set_power": {
    "tr": "Kare hızı sınırı ve çizim ölçeğini değiştirir.",
    "en": "Change fps cap and render scale."
  },
  "mcp.tool.sv_set_lighting": {
    "tr": "Windows Dinamik Aydınlatma ayarlarını değiştirir.",
    "en": "Change Windows Dynamic Lighting settings."
  },
  "mcp.tool.sv_set_openrgb": {
    "tr": "OpenRGB ayarlarını değiştirir.",
    "en": "Change OpenRGB settings."
  },
  "mcp.tool.sv_set_artnet": {
    "tr": "Art-Net ve DMX ayarlarını değiştirir.",
    "en": "Change Art-Net/DMX settings."
  },
  "mcp.tool.sv_set_window_mode": {
    "tr": "Saydam arkaplanı ve görev çubuğunu örtme ayarını değiştirir.",
    "en": "Set transparent background and taskbar cover."
  },
  "mcp.tool.sv_start_export": {
    "tr": "Çevrimdışı video dışa aktarmayı başlatır. audioPath ve outputPath gerekir.",
    "en": "Start an offline video export. Requires audioPath and outputPath."
  },
  "mcp.tool.sv_cancel_export": {
    "tr": "Süren çevrimdışı dışa aktarmayı iptal eder.",
    "en": "Cancel the running offline export."
  },
  "mcp.tool.sv_export_json": {
    "tr": "Sahneleri veya tüm yapılandırma JSON dosyasını verilen yola yazar. Kayıt penceresi açmaz.",
    "en": "Write scenes or full config JSON to an explicit path. No save dialog."
  },
  "mcp.tool.sv_save_snapshot": {
    "tr": "Canlı tuvali bir dosyaya yakalar. Kaydetmeden önizleme için sv_get_preview kullanılır.",
    "en": "Capture the live canvas to a file. Reading a preview without saving is sv_get_preview."
  },
  "mcp.tool.sv_record_start": {
    "tr": "Yönetici panelindeki canlı kaydı başlatır.",
    "en": "Start the admin live recorder."
  },
  "mcp.tool.sv_record_stop": {
    "tr": "Canlı kaydı durdurur. Uygulama ardından Kayıt kartındaki gibi kayıt yerini sorar.",
    "en": "Stop the live recorder. The app then asks where to save, same as the Record card."
  },
  "mcp.tool.sv_set_blackout": {
    "tr": "Gösteriyi karartır veya geri açar. state on, off veya toggle olabilir. Sahne verisi durur.",
    "en": "Black out or restore the show. state is on, off, or toggle. Scene data stays intact."
  },
  "mcp.tool.sv_set_blackout_transition": {
    "tr": "Karartma geçişinin türünü ve süresini ayarlar.",
    "en": "Set the blackout transition type and duration."
  },
  "mcp.tool.sv_patch_config": {
    "tr": "Başka bir yapılandırma yolunu yazar. İzin yola bağlıdır. MCP izinlerini değiştiremez.",
    "en": "Set any other config path. Permission follows the path. Cannot change mcp permissions."
  },
  "mcp.tool.mcp_permissions": {
    "tr": "Geçerli MCP kipini ve bir aracın en düşük kipini bildirir. Modu sen değiştirme. Yönetici panelini tıklama. Kullanıcıya söyle ve dur.",
    "en": "Report the current MCP mode and the minimum mode a tool needs. Do not change the mode yourself. Do not click the admin UI. Tell the user and stop."
  },
  "mcp.tool.sv_get_layer_stack": {
    "tr": "Etkin katman yığınını okur. Salt okunur.",
    "en": "Read the active layer stack. Read-only."
  },
  "mcp.tool.sv_list_audio_sources": {
    "tr": "Ayarlanmış ses girişi kaynaklarını listeler. Salt okunur.",
    "en": "List configured audio input sources. Read-only."
  },
  "mcp.tool.sv_get_analysis": {
    "tr": "Canlı çözümleme ölçümlerini okur: tonalite, akor, gürlük, perde ve bantlar. Vuruş eşiği vermez.",
    "en": "Read live analysis metrics: key, chord, loudness, pitch, bands. Does not expose onset thresholds."
  },
  "mcp.tool.sv_diagnose_audio": {
    "tr": "Ses yakalama tanısını okur. Aygıt onarmaz.",
    "en": "Read the audio capture diagnosis. Does not repair devices."
  },
  "mcp.tool.sv_set_audio_sources": {
    "tr": "Ses girişi karışımını değiştirir. Aygıt onarmaz.",
    "en": "Replace the audio input mix. Does not repair devices."
  },
  "mcp.tool.sv_set_mapping": {
    "tr": "Bir ekran için projeksiyon eşlemesini ayarlar: açma, köşeler, kırpma, kenar karışımı ve maskeler. Yeni bir ağ bağı açmaz.",
    "en": "Set projection mapping for one display: enable, corners, crop, edge blend, masks. Does not open a new network bind."
  },
  "mcp.tool.sv_repair_audio": {
    "tr": "Ses onarımını çalıştırır. Her şey kipini ister. Sistem penceresi açmaz.",
    "en": "Run audio repair. Requires Everything. Does not open a system dialog."
  },
  "mcp.tool.sv_rotate_stream_token": {
    "tr": "OBS veya uzaktan kumanda yayın jetonunu döndürür. Her şey kipini ister. Bağlantı adresini değiştirmez.",
    "en": "Rotate the OBS or remote stream token. Requires Everything. Does not change the bind address."
  },
  "mcp.tool.sv_updates_download": {
    "tr": "Uygulama güncellemesini indirir. Her şey kipini ister.",
    "en": "Download an application update. Requires Everything."
  },
  "mcp.tool.sv_updates_install": {
    "tr": "İndirilen uygulama güncellemesini kurar ve yeniden başlatır. Her şey kipini ister.",
    "en": "Install a downloaded application update and restart. Requires Everything."
  },
  "mcp.setup.prompt": {
    "tr": "SoundVisualizer MCP kurulumunu yap. HTTP http://127.0.0.1:{port}/mcp, yalnız bu bilgisayar. Stdio komutu: {command}. Sunucuyu etkinleştir ve tools/list ile doğrula.",
    "en": "Set up SoundVisualizer MCP. HTTP http://127.0.0.1:{port}/mcp, this computer only. Stdio command: {command}. Enable the server and confirm with tools/list."
  },
  "mcp.setup.path.claude": {
    "tr": "%APPDATA%\\Claude\\claude_desktop_config.json içindeki mcpServers",
    "en": "mcpServers in %APPDATA%\\Claude\\claude_desktop_config.json"
  },
  "mcp.setup.path.codex": {
    "tr": "%USERPROFILE%\\.codex\\config.toml içindeki mcp_servers",
    "en": "mcp_servers in %USERPROFILE%\\.codex\\config.toml"
  },
  "mcp.setup.path.cursor": {
    "tr": ".cursor/mcp.json veya %USERPROFILE%\\.cursor\\mcp.json",
    "en": ".cursor/mcp.json or %USERPROFILE%\\.cursor\\mcp.json"
  },
  "mcp.setup.path.grok": {
    "tr": "yayınlanmış tek dosya yok; istemcinin MCP listesi",
    "en": "no single published file; the client MCP list"
  },
  "mcp.setup.path.grokbot": {
    "tr": "yerel mcp.json yolu yok; istemcinin MCP sunucu listesi",
    "en": "no local mcp.json path; the client MCP server list"
  },
  "mcp.setup.path.ollama": {
    "tr": "modeli Ollama olan MCP istemcisinin aynı stdio sunucusu, ayrı protokol yok",
    "en": "the same stdio server on the MCP client whose model is Ollama, not a separate protocol"
  },
  "mcp.setup.easy": {
    "tr": "En kolay yol: bu istemi ajan sohbetine yapıştırın. Ajan kurulumu kendisi yapar.",
    "en": "Easiest path: paste this prompt into the agent chat. The agent does the setup."
  },
  "mcp.setup.manual": {
    "tr": "Elle kurulum",
    "en": "Manual setup"
  },
  "mcp.setup.http": {
    "tr": "HTTP uç noktası {url}. Yalnız bu bilgisayar. Port meşgulse başka porta kendiliğinden geçilmez.",
    "en": "HTTP endpoint {url}. This computer only. If that port is busy, the app does not switch ports by itself."
  },
  "mcp.card.failed": {
    "tr": "Dinleyici başlamadı.",
    "en": "Listener failed to start."
  },
  "mcp.port.label": {
    "tr": "Port",
    "en": "Port"
  },
  "mcp.port.apply": {
    "tr": "Bu portu onayla",
    "en": "Confirm this port"
  },
  "mcp.port.invalid": {
    "tr": "Port 1 ile 65535 arasında olmalı ve 8722 olamaz.",
    "en": "The port must be from 1 to 65535 and cannot be 8722."
  },
  "mcp.port.busy": {
    "tr": "{port} kullanımda. MCP başka bir porta geçmedi. Farklı bir port yazıp onaylayın.",
    "en": "{port} is in use. MCP did not switch ports. Enter a different port and confirm."
  },
  "mcp.port.confirm": {
    "tr": "MCP 127.0.0.1:{port} adresine bağlansın mı? Başka porta kendiliğinden geçmez.",
    "en": "Bind MCP on 127.0.0.1:{port}? It will not switch to another port by itself."
  },
  "mcp.card.copyPrompt": {
    "tr": "Kurulum istemini kopyala",
    "en": "Copy setup prompt"
  }
};
  function mcpText(key, loc) {
    const row = MCP_I18N[key];
    const use = loc === 'tr' || loc === 'en' ? loc : locale;
    if (!row) return key;
    return use === 'tr' ? row.tr : row.en;
  }
  if (typeof document === 'undefined') {
    if (typeof module !== 'undefined' && module.exports) module.exports = { mcpText: mcpText, MCP_I18N: MCP_I18N };
    return;
  }

  document.documentElement.lang = locale;
  window.SVI18n = { locale, t: translate, mcpText: function (key, loc) { return mcpText(key, loc || locale); } };

  const nativeAlert = window.alert.bind(window);
  const nativeConfirm = window.confirm.bind(window);
  window.alert = (message) => nativeAlert(translate(message));
  window.confirm = (message) => nativeConfirm(translate(message));

  const start = () => {
    document.title = translate(document.title);
    translateNode(document.body);
    new MutationObserver((mutations) => {
      for (const mutation of mutations) {
        if (mutation.type === 'characterData') translateNode(mutation.target);
        else {
          for (const node of mutation.addedNodes) translateNode(node);
          if (mutation.type === 'attributes') translateNode(mutation.target);
        }
      }
    }).observe(document.body, { subtree: true, childList: true, characterData: true, attributes: true, attributeFilter: ['title', 'placeholder', 'aria-label', 'label'] });
  };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start, { once: true });
  else start();
})();
