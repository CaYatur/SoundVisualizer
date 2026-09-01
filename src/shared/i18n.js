'use strict';
/* Lightweight UI localization. English is the fallback; Turkish is used only
   when the operating-system/browser locale starts with "tr". */
(function () {
  const detected = (navigator.languages && navigator.languages[0]) || navigator.language || 'en';
  /* Dil tercihi. Yayın sunucusu tarafından servis edilen sayfalarda (OBS
     katmanı ve mobil kumanda) uygulamanın dili sayfaya window.__SV_LOCALE ile
     enjekte edilir; telefonun kendi dili değil, uygulamanın dili geçerlidir. */
  const injected = typeof window !== 'undefined' ? window.__SV_LOCALE : null;
  const preference = injected || localStorage.getItem('sv-language') || 'auto';
  const locale = preference === 'tr' || preference === 'en'
    ? preference
    : (/^tr(?:-|$)/i.test(detected) ? 'tr' : 'en');

  const EN = {
    'Ses Görselleştirici — Yönetici Paneli': 'Sound Visualizer — Admin Panel',
    'Ses Görselleştirici · Yönetici Paneli': 'Sound Visualizer · Admin Panel',
    'Ekran': 'Display',
    'Ayarlar': 'Settings',
    'Dil': 'Language',
    'Otomatik (Sistem dili)': 'Automatic (System language)',
    'Türkçe': 'Turkish',
    'Dil değişikliği uygulamayı yeniden yükler.': 'Changing the language reloads the application.',
    '▶ Görselleştirmeyi Aç': '▶ Open Visualizer',
    '▶ Açık': '▶ Open',
    '■ Kapat': '■ Close',
    'Kapat': 'Close',
    'Kapalı': 'Closed',
    'Açık': 'Open',
    'Ses çıkışı yakalanamadı.': 'Audio output could not be captured.',
    'Çıkış aygıtı yakalanamadı.': 'The output device could not be captured.',
    "Farklı bir Çıkış Aygıtı seçmeyi deneyin veya 🔄 Aygıtları Yenile'ye basın. Aygıt başka bir uygulama tarafından özel (exclusive) modda kullanılıyorsa serbest bırakın.": 'Try selecting a different Output Device or press 🔄 Refresh Devices. If another application is using the device in exclusive mode, release it there first.',
    'Çıkış Aygıtı': 'Output Device',
    '🔄 Aygıtları Yenile': '🔄 Refresh Devices',
    'Otomatik Onar': 'Automatic Repair',
    'Onarılıyor…': 'Repairing…',
    'Genel': 'Overall', 'Bas': 'Bass', 'Orta': 'Mid', 'Tiz': 'Treble',
    'Ses bekleniyor…': 'Waiting for audio…',
    '↺ Varsayılanlara Sıfırla': '↺ Reset to Defaults',
    'Görselleştirme ekranında': 'In the visualizer, press',
    'ile çıkış • Ayarlar otomatik kaydedilir': 'to exit • Settings are saved automatically',
    'Görselleştirme ekranında ESC ile çıkış • Ayarlar otomatik kaydedilir': 'Press ESC in the visualizer to exit • Settings are saved automatically',
    'Hazır Şablonlar': 'Built-in Presets', 'Kendi Şablonlarım': 'My Presets',
    'Henüz şablon yok. Aşağıdaki renkleri ayarlayıp “Mevcut Renkleri Kaydet”e basın.': 'No presets yet. Adjust the colors below and press “Save Current Colors”.',
    'Şablon': 'Preset', 'Uygula': 'Apply', '⟳ Güncelle': '⟳ Update', 'Mevcut renklerle güncelle': 'Update with current colors',
    'Sil': 'Delete', '💾 Mevcut Renkleri Kaydet': '💾 Save Current Colors', '📤 Dışa Aktar': '📤 Export', '📥 İçe Aktar': '📥 Import',
    '📤 Arkaplanı Dışa Aktar': '📤 Export Background', '📥 Arkaplanı İçe Aktar': '📥 Import Background',
    'Arkaplan Ayarları (dosya)': 'Background Settings (file)',
    'Sabit': 'Static', 'Süzülme': 'Float', 'Yörünge': 'Orbit', 'Girdap': 'Swirl', 'Saçılma (sese)': 'Scatter (audio)', 'Yükselme': 'Rise', 'Düşme': 'Fall',
    'Ekran (parlak)': 'Screen (bright)', 'Toplama (ışıltı)': 'Add (glow)', 'Önde': 'Front', 'Arkada': 'Back',
    'Görsel eklemek için aşağıdaki düğmeyi kullanın. Her görsel için çok sayıda kopya (partikül) sahnede gezinir/saçılır.': 'Use the button below to add an image. Multiple copies (particles) of each image move and scatter across the scene.',
    'Görsel': 'Image', '🗑 Kaldır': '🗑 Remove', '🖼 Değiştir': '🖼 Replace', 'Kaldır': 'Remove',
    'Kopya Sayısı': 'Copy Count', 'Boyut': 'Size', 'Boyut Çeşitliliği': 'Size Variation', 'Saydamlık': 'Opacity',
    'Yayılma / Alan': 'Spread / Area', 'Hız': 'Speed', 'Dönüş': 'Rotation', 'Ses → Boyut': 'Audio → Size',
    'Ses → Hız': 'Audio → Speed', 'Ses → Saydamlık': 'Audio → Opacity', 'Hareket': 'Motion', 'Karışım': 'Blend', 'Katman': 'Layer',
    'Üst Üste Binmeyi Engelle': 'Prevent Overlap', 'Minimum Mesafe (boyut çarpanı)': 'Minimum Distance (size multiplier)',
    '➕ Görsel Ekle': '➕ Add Image', '🖼  Resim / Logo Seç': '🖼  Choose Image / Logo', '⌖ Otomatik Ortala': '⌖ Auto Center',
    'Yatay Konum': 'Horizontal Position', 'Dikey Konum': 'Vertical Position', 'Parlama': 'Glow',
    'Varsayılan Çıkış (Aktif Hoparlör)': 'Default Output (Active Speaker)', 'Aktif Kaynaklar': 'Active Sources', 'Henüz dosya seçilmedi': 'No file selected yet',
    '🎵  Ses Dosyası Seç (MP3 / WAV / FLAC)': '🎵  Choose Audio File (MP3 / WAV / FLAC)', '🎬 Videoya Aktar': '🎬 Export Video', '■ İptal': '■ Cancel',
    'Ses Kaynakları': 'Audio Sources',
    'Birden fazla kaynak seçilebilir ve karıştırılır. 🔊 Loopback (sistem sesi), 🎤 Mikrofon (giriş aygıtı).': 'Multiple sources can be selected and mixed. 🔊 Loopback (system audio), 🎤 Microphone (input device).',
    'Hassasiyet': 'Sensitivity', 'Yumuşatma': 'Smoothing', 'Bas Güçlendirme': 'Bass Boost', 'Bas Vurgusu': 'Bass Emphasis',
    'Arkaplan (Akışkan Gradyan)': 'Background (Fluid Gradient)', 'Sese tepki veren sisli/akışkan fon. Renkler ve hazır şablonlar.': 'A misty, fluid background that reacts to audio. Includes colors and built-in presets.',
    'Tür': 'Type', 'Stil': 'Style', 'Akışkan Gradyan': 'Fluid Gradient', 'Düz Renk': 'Solid Color', 'Yumuşak (Parlamasız)': 'Soft (No Glow)', 'Plazma (Parlamalı)': 'Plasma (Glowing)',
    'Renkler': 'Colors', 'Renkler (5 nokta)': 'Colors (5 points)', 'Akış Hızı': 'Flow Speed', 'Tek Yönlü Kayma': 'Directional Drift', 'Gezinme Alanı': 'Wander Area', 'Dolanma Miktarı': 'Orbit Amount',
    'İç Dönüş (Swirl)': 'Inner Swirl', 'Ölçek (Yoğunluk)': 'Scale (Density)', 'Bozulma (Akışkanlık)': 'Warp (Fluidity)',
    'Ses Tepkisi (Dalgalanma)': 'Audio Reactivity (Waves)', 'Parlaklık (Temel)': 'Base Brightness', 'Ses Patlaması (Parlaklık)': 'Audio Burst (Brightness)',
    'Ses ile Renk Kayması': 'Audio Hue Shift', 'Hat Çizgilerini Gizle': 'Hide Line Artifacts', 'Gren': 'Grain', 'Vinyet': 'Vignette',
    'Görselleştirici': 'Visualizer', 'Sese duyarlı ön efekt. Frekans barları, dalga veya çember.': 'Audio-reactive foreground effect: frequency bars, waveform, or circle.',
    'Kapalı': 'Off', 'Barlar': 'Bars', 'Merkez Barlar': 'Center Bars', 'Dalga': 'Wave', 'Çember': 'Circle', 'Gökkuşağı (Rainbow)': 'Rainbow',
    'Renk': 'Color', 'Birincil Renk': 'Primary Color', 'İkincil Renk': 'Secondary Color', 'Ayna': 'Mirror', 'Ayna (Simetri)': 'Mirror (Symmetry)', 'Bar Sayısı': 'Bar Count', 'Tepe Noktaları': 'Peak Caps',
    'Min Frekans (Hz)': 'Min Frequency (Hz)', 'Max Frekans (Hz)': 'Max Frequency (Hz)', 'Parlama (Glow)': 'Glow',
    'Bar Boşluğu': 'Bar Gap', 'Yerleşim': 'Position', 'Alt': 'Bottom', 'Merkez': 'Center', 'Tam': 'Full', 'Çizgi Kalınlığı': 'Line Width', 'Genlik / Dolgu': 'Amplitude / Fill',
    'Logo / Merkez Görsel': 'Logo / Center Image', 'Logo / Resim': 'Logo / Image', 'Merkeze resim yerleştir; otomatik boyutlandırılır ve nabız atar.': 'Place an image in the center; it is automatically sized and pulses with audio.',
    'Logo Göster': 'Show Logo', 'Ses Nabzı': 'Audio Pulse', 'Konum': 'Position',
    'Görsel Nesneler / Partiküller': 'Visual Objects / Particles',
    'Bir veya birden fazla resim ekle; sahnede süzülsün, yörünge çizsin, sese göre saçılsın. Boyut, hız, saydamlık, ışıltı ve katman ayarlanır.': 'Add one or more images and let them float, orbit, or scatter with audio. Size, speed, opacity, glow, and layer are adjustable.',
    'Görsel Nesneleri Etkinleştir': 'Enable Visual Objects',
    'Güç / Performans': 'Power / Performance', 'Kare hızı, çözünürlük ölçeği ve enerji ayarları.': 'Frame rate, resolution scale, and power settings.',
    'Kare Hızı (FPS)': 'Frame Rate (FPS)', '30 FPS (Düşük güç)': '30 FPS (Low power)', '60 FPS (Dengeli)': '60 FPS (Balanced)', '60 FPS (Akıcı)': '60 FPS (Smooth)', '120 FPS (Akıcı)': '120 FPS (Smooth)', 'Sınırsız': 'Unlimited',
    'Arkaplan Çözünürlüğü': 'Background Resolution', 'Sessizlikte Duraklat': 'Pause on Silence', 'İmleci Gizle': 'Hide Cursor',
    'Video Dışa Aktar (MP3 → Video)': 'Export Video (MP3 → Video)',
    'Bir ses dosyası seç; yukarıdaki görsel ayarlarla kayıpsız videoya dönüştürülür. Ekran/ses kaydı yapılmaz — her kare birebir render edilir, ses kaynaktan kopyalanır.': 'Choose an audio file and render it to a visually lossless video using the settings above. No screen/audio recording is performed—every frame is rendered directly and audio is copied from the source.',
    'Çözünürlük': 'Resolution', 'Kodlayıcı (Hız)': 'Encoder (Speed)', '⚡ GPU — NVIDIA NVENC (çok hızlı)': '⚡ GPU — NVIDIA NVENC (very fast)',
    'CPU — libx264 (en uyumlu, yavaş)': 'CPU — libx264 (most compatible, slow)', 'CPU — libx264 (GPU bulunamadı)': 'CPU — libx264 (GPU unavailable)',
    'Kalite': 'Quality', 'Görsel Kayıpsız (en yüksek)': 'Visually Lossless (highest)', 'Yüksek': 'High', 'Dengeli (daha küçük dosya)': 'Balanced (smaller file)',
    'Hız / Kalite Dengesi': 'Speed / Quality Balance', '⚡ Hızlı (en hızlı dışa aktarım)': '⚡ Fast (fastest export)', 'Dengeli (önerilen)': 'Balanced (recommended)', 'Kalite (en yavaş, en iyi sıkıştırma)': 'Quality (slowest, best compression)',
    'Bu şablon silinsin mi?': 'Delete this preset?', 'Dışa aktarılacak şablon yok.': 'There are no presets to export.',
    'Renk Şablonlarını İçe Aktar': 'Import Color Presets', 'İçe aktarılamadı:': 'Import failed:', 'Dosyada şablon bulunamadı.': 'No presets were found in the file.',
    'İçe Aktarılan': 'Imported', 'Arkaplan Ayarlarını İçe Aktar': 'Import Background Settings', 'Geçerli bir arkaplan dosyası değil.': 'This is not a valid background file.',
    'Önce bir ses dosyası seçin.': 'Choose an audio file first.', 'Başlatılamadı': 'Could not start', 'Hazırlanıyor…': 'Preparing…',
    'Tüm ayarlar varsayılana dönecek. Emin misiniz?': 'All settings will be reset to defaults. Are you sure?',
    '⚠ Ses yakalanamadı': '⚠ Audio capture failed', 'Kodlanıyor': 'Encoding', 'kareler bitti, video yazılıyor.': 'frames complete, writing video.',
    'İptal edildi.': 'Cancelled.', 'bilinmeyen hata': 'unknown error', 'Ses alınamıyor — yönetici panelinden çıkış aygıtı seçin': 'No audio — select an output device in the admin panel',
    'Gün Batımı': 'Sunset', 'Okyanus': 'Ocean', 'Gece': 'Night', 'Buz': 'Ice', 'Lav': 'Lava', 'Orman': 'Forest', 'Tek Renk': 'Single Color', 'Aurora': 'Aurora',
    'Windows Dynamic Lighting': 'Windows Dynamic Lighting',
    'Uyumlu RGB aygıtlarını görselleştirici renkleriyle senkronize eder. Varsayılan olarak kapalıdır.': 'Synchronizes compatible RGB devices with the visualizer colors. Disabled by default.',
    'Windows Dynamic Lighting Etkin': 'Enable Windows Dynamic Lighting',
    'Bu Windows sürümünde Dynamic Lighting desteklenmiyor.': 'Dynamic Lighting is not supported on this Windows version.',
    'Uyumlu Dynamic Lighting aygıtı bulunamadı.': 'No compatible Dynamic Lighting device was found.',
    '🔄 Aydınlatma Aygıtlarını Tara': '🔄 Scan Lighting Devices',
    'Aydınlatma Modu': 'Lighting Mode',
    'Görselleştirici ile Senkron': 'Visualizer Sync',
    'Tüm Aygıtlarda Tek Renk': 'Single Color on All Devices',
    'Aygıt Başına Renk': 'Per-Device Color',
    'LED / Bölge Başına Renk': 'Per-LED / Zone Color',
    'LED / bölge': 'LED / zone',
    'Parlaklık': 'Brightness',
    'Ses Tepkisi': 'Audio Reactivity',
    'Güncelleme Hızı': 'Update Rate',
    '✓ Arka plan Dynamic Lighting kimliği hazır': '✓ Background Dynamic Lighting identity is ready',
    'Portable sürüm yalnızca CAYADEV Visualizer odaktayken aydınlatmayı kontrol eder.': 'The portable build controls lighting only while CAYADEV Visualizer is focused.',
    'Ön plan kontrol durumu, Dynamic Lighting etkinleştirildiğinde izlenir.': 'Foreground control status is monitored when Dynamic Lighting is enabled.',
    'Not: Portable sürüm yalnızca uygulama odaktayken aydınlatmayı kontrol eder. Başka uygulamalara geçtiğinizde de kontrolün sürmesi gerekiyorsa installer sürümünü kullanın.': 'Note: The portable build controls lighting only while the application is focused. Use the installer build if control must continue after switching to another application.',
    'Arka plan kimliği bulunamadı; ön plan kontrolü kullanılabilir.': 'Background identity was not found; foreground control is still available.',
    'Geliştirme modunda yalnızca ön plan kontrolü kullanılabilir.': 'Only foreground control is available in development mode.',
    '⚙ Windows Dynamic Lighting Ayarları': '⚙ Windows Dynamic Lighting Settings',
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
    'Tüm LED’lerde Aynı Ton': 'Same Tone on All LEDs',
    'Sessizlikte Işık': 'Idle Light Level',
    'Renk Doygunluğu': 'Color Saturation',
    'Renk Yayılımı': 'Color Spread',
    'Renk Kaynağı': 'Color Source',
    'Görselleştirici Bar Renkleri': 'Visualizer Bar Colors',
    'Arka Plan Gradyanı': 'Background Gradient',
    'Bas · Mid · Tiz Renkleri': 'Bass · Mid · Treble Colors',
    'Tam Spektrum Gökkuşağı': 'Full-Spectrum Rainbow',
    'Birincil · İkincil Renk': 'Primary · Secondary Colors',
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
    'LED’lerde Sırayla Bas · Mid · Tiz': 'Alternate Bass · Mid · Treble Across LEDs',
    'Merkezden Aynalı Dağılım': 'Mirrored from the Center',
    'En Güçlü Bant Tüm LED’lerde': 'Strongest Band on All LEDs',
    'Rainbow Ayarları': 'Rainbow Settings', 'Rainbow Dağıtımı': 'Rainbow Distribution',
    'LED’lerde Sıralı Gökkuşağı': 'Sequential Rainbow Across LEDs', 'Tüm LED’lerde Aynı Ton': 'Same Tone on All LEDs',
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
    'Arka Plan Renklerini LED’lere Yay': 'Spread Background Colors Across LEDs',
    'Seçilen kaynak eşik altında kaldığında yalnızca taban ışığı görünür. Eşik aşıldığında, aşma miktarı patlamanın parlaklığını ve beyaz vurgu oranını belirler.': 'Only the base light is shown while the selected source stays below the threshold. Once crossed, the amount above the threshold controls burst brightness and white highlight intensity.',
    'Ayarları Yedekle / Geri Yükle': 'Back Up / Restore Settings',
    'Renk şablonları hariç tüm uygulama ayarlarını tek JSON dosyasında taşıyın.': 'Move all application settings except color presets in a single JSON file.',
    'Ses, görünüm, Dynamic Lighting, performans, logo, görsel nesneler ve video dışa aktarma ayarlarını JSON dosyasına kaydeder. Renk şablonlarınız ve sahneleriniz dosyaya dahil edilmez ve içe aktarma sırasında korunur; onların kendi dışa aktarma düğmeleri vardır.': 'Saves audio, appearance, Dynamic Lighting, performance, logo, visual objects, and video export settings to a JSON file. Your color presets and scenes are excluded and preserved during import; they have their own export buttons.',
    'Mevcut ayarlar yedekteki değerlerle değiştirilecek. Renk şablonlarınız ve sahneleriniz korunacak. Devam edilsin mi?': 'Current settings will be replaced with the values in the backup. Your color presets and scenes will be preserved. Continue?',
    'Ayarlar başarıyla içe aktarıldı. Renk şablonlarınız ve sahneleriniz değiştirilmedi.': 'Settings imported successfully. Your color presets and scenes were left unchanged.',
    'Tüm Ayarları Dışa Aktar': 'Export All Settings', 'Ayarları İçe Aktar': 'Import Settings',
    'Ses, görünüm, Dynamic Lighting, performans, logo, görsel nesneler ve video dışa aktarma ayarlarını JSON dosyasına kaydeder. Kullanıcı renk şablonları dosyaya dahil edilmez ve içe aktarma sırasında korunur.': 'Saves audio, appearance, Dynamic Lighting, performance, logo, visual objects, and video export settings to a JSON file. User color presets are excluded and preserved during import.',
    'Görselleştirme': 'Visualization', 'Dışa Aktarma Render': 'Export Renderer',

    // ---- Yeni arkaplan modları ----
    'Dalga Katmanları': 'Wave Layers',
    'Yıldız Alanı': 'Starfield',
    'Retro Izgara': 'Retro Grid',
    'Işık Parçacıkları': 'Bokeh Lights',
    'Sese tepki veren akışkan fon, dalga katmanları, yıldız alanı ve daha fazlası.': 'A fluid audio-reactive backdrop, wave layers, a starfield, and more.',

    // ---- Uygulama içi onay / bildirim ----
    'Emin misiniz?': 'Are you sure?',
    'Vazgeç': 'Cancel',
    'Evet, devam et': 'Yes, continue',
    'Bölümü sıfırla': 'Reset section',
    'Kategoriyi sıfırla': 'Reset category',
    'Hepsini sıfırla': 'Reset everything',
    'İçe aktar': 'Import',
    'Bu bölümdeki ayarlar varsayılana dönecek.': 'The settings in this section will return to their defaults.',
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
    'Kutup Işıkları': 'Aurora',
    'Dijital Yağmur': 'Digital Rain',
    'Ağ': 'Network',
    'Nabız Halkaları': 'Pulse Rings',

    // ---- Arkaplan modlarına özel ayarlar ----
    'Mod Ayarları': 'Mode Settings',
    'Yıldız Sayısı': 'Star Count',
    'Yıldız Boyutu': 'Star Size',
    'Hız İzi': 'Motion Trail',
    'Derinlik': 'Depth',
    'Parıldama': 'Twinkle',
    'Bas İtkisi': 'Bass Push',
    'Ufuk Yüksekliği': 'Horizon Height',
    'Yatay Çizgi Sayısı': 'Horizontal Lines',
    'Dikey Çizgi Sayısı': 'Vertical Lines',
    'Ufuk Parlaması': 'Horizon Glow',
    'Gökyüzü Yoğunluğu': 'Sky Intensity',
    'Spektrum Tepkisi': 'Spectrum Response',
    'Katman Sayısı': 'Layer Count',
    'Tepe Yüksekliği': 'Crest Height',
    'Dalga Sıklığı': 'Wave Frequency',
    'Katman Aralığı': 'Layer Spacing',
    'Işık Sayısı': 'Light Count',
    'Bas Nabzı': 'Bass Pulse',
    'Sütun Sayısı': 'Column Count',
    'Düşme Hızı': 'Fall Speed',
    'İz Uzunluğu': 'Trail Length',
    'Yoğunluk': 'Density',
    'Kalınlık': 'Thickness',
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
    'Sönme': 'Fade',

    // ---- Yeni görselleştirici modları ----
    'Nokta Matris': 'Dot Matrix',
    'Dairesel Dalga': 'Radial Wave',
    'Parçacık': 'Particles',
    'Arazi': 'Terrain',
    'Segment': 'Segments',
    'Şerit': 'Ribbon',
    'Işın': 'Rays',
    'Tünel': 'Tunnel',
    'Küre': 'Orb',
    'Spektrogram': 'Spectrogram',
    'Sese duyarlı ön efekt: barlar, dalga, çember, tünel, spektrogram ve daha fazlası.': 'Audio-reactive foreground effect: bars, wave, circle, tunnel, spectrogram, and more.',

    // ---- Kare hızı ----
    'Ekranla Eşitle — en akıcı (önerilen)': 'Match Display — smoothest (recommended)',
    'En fazla 120 FPS': 'Up to 120 FPS',
    'En fazla 60 FPS': 'Up to 60 FPS',
    'En fazla 30 FPS (düşük güç)': 'Up to 30 FPS (low power)',
    'Ekranla Eşitle, her ekran yenilemesinde bir kare çizer; en akıcı sonucu verir. Ekranınızın yenileme hızının tam böleni olmayan bir sınır (75 Hz ekranda 60 gibi) kare aralıklarını eşitsiz yapabilir.': 'Match Display draws one frame per screen refresh, which is the smoothest result. A limit that is not an exact divisor of your refresh rate (such as 60 on a 75 Hz screen) can make frame intervals uneven.',

    // ---- Aydınlatma panelinde çevirisi eksik kalan metinler ----
    '⚠ Windows arka plan kontrolünü vermedi (0/3). Dynamic Lighting ayarlarında CAYADEV Visualizer uygulamasını listenin en üstüne taşıyın.': '⚠ Windows did not grant background control (0/3). In Dynamic Lighting settings, move the CAYADEV Visualizer app to the top of the list.',
    'Bütün ışıklara tek sabit renk uygular.': 'Applies a single fixed color to all lights.',
    'Her aydınlatma aygıtına ayrı renk atar.': 'Assigns a separate color to each lighting device.',
    'Her LED veya bölgeyi tek tek ayarlamanızı sağlar.': 'Lets you set each LED or zone individually.',

    // ---- Yeni yönetici paneli düzeni: kategoriler ----
    'Kategoriler': 'Categories',
    'Sahne': 'Scene',
    'Ekranda görünen her şey: arkaplan, görselleştirici, logo ve görsel nesneler.': 'Everything you see on screen: background, visualizer, logo, and visual objects.',
    'Ses': 'Audio',
    'Hangi sesin yakalanacağı ve görüntüye nasıl çevrileceği.': 'Which audio is captured and how it is turned into visuals.',
    'Işık': 'Lighting',
    'Windows Dynamic Lighting ile uyumlu RGB aygıtlarını müzikle senkronize edin.': 'Sync compatible RGB devices with the music through Windows Dynamic Lighting.',
    'Çıkış': 'Output',
    'Görüntünün nereye ve nasıl gideceği: ekran, performans ve video dosyası.': 'Where and how the visuals go out: display, performance, and video file.',
    'Kitaplık': 'Library',
    'Kayıtlı sahneler, renk şablonları ve ayar yedekleri.': 'Saved scenes, color presets, and settings backups.',
    'Kırmızı nokta ve rakamlar, varsayılandan farklı ayarları gösterir.': 'Red dots and numbers mark settings that differ from the defaults.',
    'Varsayılandan farklı ayar sayısı': 'Number of settings changed from defaults',

    // ---- Arama ----
    'Tüm ayarlarda ara…': 'Search all settings…',
    'Eşleşen ayar bulunamadı.': 'No matching setting found.',

    // ---- Gelişmiş / sıfırlama ----
    'Gelişmiş': 'Advanced',
    'Gelişmiş ayarlar': 'Advanced settings',
    'Gelişmiş ayarları göster': 'Show advanced settings',
    'Kategoriyi Sıfırla': 'Reset Category',
    '↺ Kategoriyi Sıfırla': '↺ Reset Category',
    '📤 Tüm Ayarları Dışa Aktar': '📤 Export All Settings',
    '📥 Ayarları İçe Aktar': '📥 Import Settings',
    'Bu kategoriyi varsayılana döndür': 'Reset this category to defaults',
    'Bu bölümü varsayılana döndür': 'Reset this section to defaults',
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
    'Sahneler': 'Scenes',
    'Arkaplan + görselleştirici + logo + görsel nesneleri tek isim altında saklayın.': 'Store background + visualizer + logo + visual objects under a single name.',
    'Mevcut görünümü yeni sahne olarak kaydet': 'Save the current look as a new scene',
    'Kayıtlı sahne yok. “＋ Kaydet” ile mevcut görünümü saklayın.': 'No saved scenes. Use “＋ Save” to store the current look.',
    'Henüz sahne yok. Beğendiğiniz görünümü ayarlayıp “Mevcut Görünümü Kaydet”e basın; daha sonra tek tıkla geri dönersiniz.': 'No scenes yet. Set up a look you like and press “Save Current Look”; you can return to it with one click later.',
    '＋ Kaydet': '＋ Save',
    '💾 Mevcut Görünümü Kaydet': '💾 Save Current Look',
    'Bu sahneyi uygula': 'Apply this scene',
    'Mevcut görünümle güncelle': 'Update with the current look',
    'Sahne adı': 'Scene name',
    'Sahne adı:': 'Scene name:',
    'Bu sahne silinsin mi?': 'Delete this scene?',
    'Sahneleri İçe Aktar': 'Import Scenes',
    'Nesneler': 'Objects',

    // ---- Bölüm başlıkları / açıklamaları ----
    'Birden fazla kaynak seçilip karıştırılabilir. 🔊 Loopback (sistem sesi), 🎤 Mikrofon.': 'Multiple sources can be selected and mixed. 🔊 Loopback (system audio), 🎤 Microphone.',
    'Ses Analizi': 'Audio Analysis',
    'Yakalanan sesin görsele ne kadar sert veya yumuşak yansıyacağı.': 'How hard or soft the captured audio hits the visuals.',
    'Arkaplan': 'Background',
    'Sese tepki veren sisli/akışkan fon veya düz renk.': 'A misty, fluid backdrop that reacts to audio, or a solid color.',
    'Renk Şablonlarım': 'My Color Presets',
    'Beğendiğiniz arkaplan renklerini kaydedin; tek tıkla geri yükleyin.': 'Save background colors you like and restore them with one click.',
    'Sese duyarlı ön efekt: frekans barları, dalga veya çember.': 'Audio-reactive foreground effect: frequency bars, wave, or circle.',
    'Sahneye bir resim yerleştirin; sese göre nabız atar.': 'Place an image in the scene; it pulses with the audio.',
    'Görsel Nesneler': 'Visual Objects',
    'Resim ekleyin; sahnede süzülsün, yörünge çizsin, sese göre saçılsın.': 'Add images that float, orbit, and scatter across the scene with the audio.',
    'Görselleştirme hangi ekranda tam ekran açılsın? Üst çubuktan da seçebilirsiniz.': 'Which display should the visualization open on, full screen? You can also pick it from the top bar.',
    'Görselleştirme seçili ekranda tam ekran açılır; ESC ile kapanır.': 'The visualization opens full screen on the selected display; press ESC to close it.',
    'Bir ses dosyası seçin; mevcut sahne ayarlarıyla kayıpsız videoya dönüştürülür. Ekran kaydı değildir — her kare birebir render edilir.': 'Choose an audio file; it is turned into a lossless video using the current scene settings. This is not a screen recording — every frame is rendered exactly.',

    // ---- Grup başlıkları ----
    'Hareket': 'Movement',
    'Görünüm': 'Appearance',
    'Sese Tepki': 'Audio Response',
    'Bar Biçimi': 'Bar Shape',
    'Dalga Biçimi': 'Wave Shape',
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
    'Ekran seçilmedi': 'No display selected',
    '▶ Ekranları Uygula': '▶ Apply Displays',
    '🌑 Karart': '🌑 Blackout',
    '☀ Karartmayı Kaldır': '☀ Undo Blackout',
    'Sahneyi karart (tekrar basınca geri gelir)': 'Black out the scene (press again to restore)',
    'Birden fazla ekran seçerseniz görselleştirme hepsinde aynı anda açılır. ESC hepsini kapatır.': 'If you select more than one display, the visualization opens on all of them at once. ESC closes them all.',
    'Seçtiğiniz her ekranda ayrı bir tam ekran görselleştirme açılır. ESC hepsini kapatır.': 'A separate full-screen visualization opens on each display you select. ESC closes them all.',

    // ---- Yeni bölüm başlıkları ----
    'Geri Besleme Motoru': 'Feedback Engine',
    'MilkDrop ailesi: her kare bir öncekini büker, yakınlaştırır ve söndürür. Sonsuz tünel görünümü buradan gelir.': 'The MilkDrop family: each frame warps, zooms, and fades the previous one. This is where the endless-tunnel look comes from.',
    'Medya Katmanı': 'Media Layer',
    'Web kameranızı veya bir video dosyasını sahneye katman olarak koyun; sese göre nabız atsın.': 'Place your webcam or a video file into the scene as a layer that pulses with the audio.',
    'Yayın Çıkışı (OBS / Web)': 'Streaming Output (OBS / Web)',
    'OBS ve benzeri programlara "Tarayıcı Kaynağı" olarak eklenebilen bir sayfa yayınlar; telefondan uzaktan kumanda da buradan açılır.': 'Publishes a page you can add to OBS and similar apps as a "Browser Source"; the phone remote is opened from here too.',
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
    'Şehir Silüeti': 'Skyline', '3B Dalga': '3D Wave', 'Lissajous': 'Lissajous', 'Teller': 'Strings',
    'Yaylar': 'Arcs', 'Fırıldak': 'Pinwheel', 'Mandala': 'Mandala', 'Kaleydoskop': 'Kaleidoscope',
    'Girdap': 'Vortex', 'Sarmal': 'Helix', 'Havai Fişek': 'Fireworks', 'Şimşek': 'Lightning',
    'Baloncuk': 'Bubbles', 'Sıvı Damla': 'Liquid Blobs', 'Dalgalı Izgara': 'Ripple Grid',
    '♾ Geri Besleme': '♾ Feedback', '🧪 Studio': '🧪 Studio',

    // ---- Yeni arkaplanlar ----
    'Mürekkep': 'Ink', 'Bulutsu': 'Nebula', 'Petek Izgara': 'Hex Grid', 'Mozaik': 'Mosaic',
    'Koridor': 'Corridor', 'Kar / Kor': 'Snow / Embers', 'Şehir': 'City',

    // ---- Segment grup başlıkları ----
    'Temel': 'Basic', 'Dalga Formu': 'Waveform', 'Dairesel': 'Radial',
    'Parçacık ve Olay': 'Particles & Events', 'Gelişmiş Motorlar': 'Advanced Engines',
    'Akışkan': 'Fluid', 'Geometrik': 'Geometric', 'Atmosfer': 'Atmosphere', 'Diğer': 'Other',

    // ---- Geri besleme ayarları ----
    'Dalga Biçimi': 'Wave Shape', 'Çizgi': 'Line', 'Çift': 'Dual', 'Çember': 'Circle', 'Spektrum': 'Spectrum',
    'Yakınlaşma': 'Zoom', 'Sönme': 'Decay', 'Bükülme': 'Warp', 'İç Dönüş': 'Swirl',
    'Yatay Kayma': 'Horizontal Drift', 'Dikey Kayma': 'Vertical Drift',
    'Dalga Genliği': 'Wave Amplitude', 'Dalga Kalınlığı': 'Wave Thickness', 'Keskinlik': 'Sharpen',
    'Bas → Yakınlaşma': 'Bass → Zoom', 'Bas → Dönüş': 'Bass → Rotation', 'Dalga': 'Wave',

    // ---- Studio ----
    '＋ Shader': '＋ Shader', '＋ Varyasyon': '＋ Variation', '📦 Paket Dışa Aktar': '📦 Export Pack',
    '📁 Klasör': '📁 Folder', 'Sıfırdan GLSL shader': 'A GLSL shader from scratch',
    'Şu anki görünümü preset olarak sakla': 'Save the current look as a preset',
    'Shadertoy / ISF / MilkDrop / .svpreset / .svpack': 'Shadertoy / ISF / MilkDrop / .svpreset / .svpack',
    'Tüm kendi presetlerini tek dosyada paylaş': 'Share all of your own presets in a single file',
    'Preset klasörünü aç': 'Open the presets folder',
    'Görselleştirici': 'Visualizer', 'Arkaplan': 'Background',
    'Henüz yok.': 'None yet.', 'yerleşik': 'built-in', 'shader': 'shader', 'varyasyon': 'variation',
    'Soldan bir preset seç ya da yeni bir tane oluştur.': 'Pick a preset on the left or create a new one.',
    'Varyasyon: şu anki görünümü isimlendirip saklar, kod gerektirmez. Shader: sıfırdan kendi efektini yazarsın.': 'Variation: names and stores the current look, no code required. Shader: you write your own effect from scratch.',
    'Ad': 'Name', 'Tür': 'Type', 'Açıklama': 'Description',
    'Preset adı': 'Preset name', 'Kısa açıklama (isteğe bağlı)': 'Short description (optional)',
    'Bu yerleşik bir preset. Kaydettiğinde kendi kopyan oluşturulur; orijinali korunur.': 'This is a built-in preset. Saving creates your own copy; the original is preserved.',
    '⟳ Şu Anki Görünümle Güncelle': '⟳ Update With Current Look',
    'Varyasyon güncel görünümle tazelendi.': 'The variation was refreshed with the current look.',
    '✓ Derlendi': '✓ Compiled', 'Derlendi.': 'Compiled.',
    'Parametreler': 'Parameters', '＋ Parametre Ekle': '＋ Add Parameter',
    'Parametreyi kaldır': 'Remove parameter', 'Etiket': 'Label',
    'Kaydırıcı': 'Slider', 'Anahtar': 'Switch', 'Renk': 'Color',
    'adım': 'step', 'varsayılan': 'default', 'Miktar': 'Amount',
    '💾 Kaydet': '💾 Save', '▶ Sahnede Kullan': '▶ Use In Scene', '⧉ Çoğalt': '⧉ Duplicate',
    '🗑 Sil': '🗑 Delete', 'canlı': 'live',
    'Yeni Görselleştirici': 'New Visualizer', 'Yeni Arkaplan': 'New Background',
    'Görselleştiricim': 'My Visualizer', 'Arkaplan Varyasyonum': 'My Background Variation',
    'Studio Preseti': 'Studio Preset',
    'Henüz Studio preseti yok. Studio sekmesinden bir tane oluşturun.': 'No Studio preset yet. Create one from the Studio tab.',
    'Preset çok büyük (512 KB üstü).': 'The preset is too large (over 512 KB).',
    'Dışa aktarılacak preset yok.': 'There is no preset to export.',
    'Dosyaya yazıldı.': 'Written to file.',
    'Dosya çok büyük (2 MB üstü).': 'The file is too large (over 2 MB).',
    'JSON çözümlenemedi.': 'The JSON could not be parsed.',
    'İçe aktarıldı.': 'Imported.',
    'WebGL2 kullanılamıyor.': 'WebGL2 is unavailable.',
    'CAYADEV Preset Paketi': 'CAYADEV Preset Pack',
    'Kodda mainImage(out vec4 fragColor, in vec2 fragCoord) bulunamadı.': 'mainImage(out vec4 fragColor, in vec2 fragCoord) was not found in the code.',
    'ISF gövdesinde void main() bulunamadı.': 'void main() was not found in the ISF body.',
    'Tanınmayan dosya biçimi (svpreset veya svpack bekleniyordu).': 'Unrecognized file format (svpreset or svpack expected).',
    'Dosya okunamadı.': 'The file could not be read.',

    // ---- Yayın çıkışı ----
    'Yayın Sunucusunu Aç': 'Start Streaming Server',
    'Ağa açık': 'Open to network', 'Yalnızca bu bilgisayar': 'This computer only',
    'Port': 'Port', 'bağlı istemci': 'connected client(s)', 'istemci yok': 'no clients',
    'dinleniyor': 'listening',
    'OBS Tarayıcı Kaynağı': 'OBS Browser Source', 'Mobil Kumanda': 'Mobile Remote',
    'bu adresi OBS\'e yapıştırın': 'paste this address into OBS',
    'telefondan açın': 'open it on your phone',
    '⧉ Kopyala': '⧉ Copy', 'Kopyalanamadı.': 'Could not copy.',
    'OBS kurulumu': 'OBS setup',
    'OBS → Kaynaklar → ＋ → Tarayıcı (Browser).': 'OBS → Sources → ＋ → Browser.',
    'URL alanına yukarıdaki adresi yapıştırın.': 'Paste the address above into the URL field.',
    'Genişlik/Yükseklik: sahne çözünürlüğünüzle aynı (ör. 1920 × 1080).': 'Width/Height: the same as your scene resolution (e.g. 1920 × 1080).',
    '“Kaynak görünür değilken kapat” seçeneğini KAPALI bırakın; yoksa sahne değişince yeniden bağlanır.': 'Leave "Shutdown source when not visible" OFF; otherwise it reconnects every time you switch scenes.',
    'Saydam arkaplan açıksa görselleştirici doğrudan üst katman olur; kapatırsanız arkaplan da yayına girer.': 'With a transparent background the visualizer becomes a direct overlay; turn it off and the background goes on stream too.',
    'Adresin sonuna ?transparent=0 eklerseniz o kaynak arkaplanı da gösterir; ?fps=30 veya ?scale=0.75 ile o kaynağın yükünü ayrıca düşürebilirsiniz.': 'Append ?transparent=0 to the address and that source shows the background as well; ?fps=30 or ?scale=0.75 lowers the load of that source specifically.',
    'Saydam Arkaplan (üst katman)': 'Transparent Background (overlay)',
    'Mobil Uzaktan Kumanda': 'Mobile Remote Control',
    'Yerel Ağa Aç (telefon erişebilsin)': 'Open To Local Network (so your phone can reach it)',
    'Yayın sayfası yerel ağdaki tüm cihazlara açılacak. Adres, tahmin edilmesi güç bir jeton içerir ve jeton olmadan hiçbir istek kabul edilmez. Genel/paylaşımlı bir ağdaysanız (kafe, otel, konferans) açmayın.': 'The streaming page will be reachable by every device on your local network. The address contains a hard-to-guess token and no request is accepted without it. Do not enable this on a public or shared network (café, hotel, conference).',
    'Ağa aç': 'Open to network',
    'Erişim Jetonu': 'Access Token', '⟳ Yenile': '⟳ Regenerate',
    'Yeni jeton üretir; eski adresler geçersiz olur': 'Generates a new token; old addresses stop working',
    'Tarayıcı Kaynağı Kare Hızı': 'Browser Source Frame Rate',
    'Tarayıcı Kaynağı Çözünürlük Ölçeği': 'Browser Source Resolution Scale',
    'Bağlı İstemciler': 'Connected Clients',
    '📱 Kumanda': '📱 Remote', '📺 Katman': '📺 Overlay',
    'Yayın sayfası masaüstü penceresiyle aynı motoru çalıştırır; ayrı bir render yoktur, bu yüzden iki görüntü asla birbirinden ayrışmaz. NDI ve Spout çıkışı bu sürümde yok — OBS için tarayıcı kaynağı zaten aynı işi eklenti kurmadan görür.': 'The streaming page runs the same engine as the desktop window; there is no separate renderer, so the two outputs never drift apart. NDI and Spout output are not in this release — for OBS, the browser source already does the same job without installing a plugin.',
    'Bu port başka bir uygulama tarafından kullanılıyor. Başka bir port deneyin.': 'This port is in use by another application. Try a different port.',
    'Bu portu açma izni yok. 1024 üstü bir port deneyin.': 'No permission to open this port. Try a port above 1024.',
    'Ağ adresi kullanılamıyor.': 'The network address is unavailable.',

    // ---- Kontrol yüzeyleri ----
    'MIDI Etkin': 'MIDI Enabled', 'OSC Etkin': 'OSC Enabled',
    'Aygıt': 'Device', 'Tüm MIDI aygıtları': 'All MIDI devices',
    'MIDI girişi bulundu': 'MIDI input(s) found', 'MIDI girişi bulunamadı': 'No MIDI input found',
    'Bu ortamda Web MIDI kullanılamıyor.': 'Web MIDI is unavailable in this environment.',
    'sinyal bekleniyor…': 'waiting for a signal…', 'mesaj bekleniyor…': 'waiting for a message…',
    'UDP Portu': 'UDP Port',
    'OSC gönderen uygulamayı bu bilgisayarın IP adresine ve yukarıdaki porta yöneltin. 0..1 arası değerler doğrudan, 0..127 arası değerler otomatik ölçeklenerek kullanılır.': 'Point the OSC sender at this computer\'s IP address and the port above. Values between 0 and 1 are used directly; values up to 127 are scaled automatically.',
    'Henüz eşleme yok. “＋ Eşleme Ekle” ile başlayın.': 'No mappings yet. Start with "＋ Add Mapping".',
    '＋ Eşleme Ekle': '＋ Add Mapping', 'Eşlemeyi kaldır': 'Remove mapping',
    '🎯 Öğren': '🎯 Learn', '● Dinleniyor…': '● Listening…',
    'Bas, sonra denetleyicideki düğmeyi oynat': 'Press this, then move the control on your device',
    'Bas, sonra OSC mesajını gönder': 'Press this, then send the OSC message',
    'Ses · Hassasiyet': 'Audio · Sensitivity', 'Ses · Yumuşatma': 'Audio · Smoothing',
    'Ses · Bas Vurgusu': 'Audio · Bass Emphasis',
    'Görselleştirici · Hassasiyet': 'Visualizer · Sensitivity',
    'Görselleştirici · Parlama': 'Visualizer · Glow',
    'Görselleştirici · Bar Sayısı': 'Visualizer · Bar Count',
    'Görselleştirici · Bar Boşluğu': 'Visualizer · Bar Gap',
    'Görselleştirici · Çizgi Kalınlığı': 'Visualizer · Line Width',
    'Görselleştirici · Genlik': 'Visualizer · Amplitude',
    'Arkaplan · Akış Hızı': 'Background · Flow Speed',
    'Arkaplan · Ses Tepkisi': 'Background · Audio Response',
    'Arkaplan · Parlaklık': 'Background · Brightness',
    'Arkaplan · Renk Kayması': 'Background · Hue Shift',
    'Arkaplan · Vinyet': 'Background · Vignette',
    'Logo · Saydamlık': 'Logo · Opacity', 'Logo · Boyut': 'Logo · Size',
    'Geri Besleme · Yakınlaşma': 'Feedback · Zoom', 'Geri Besleme · Sönme': 'Feedback · Decay',
    'Geri Besleme · Bükülme': 'Feedback · Warp', 'Geri Besleme · Dönüş': 'Feedback · Rotation',
    'Medya · Saydamlık': 'Media · Opacity', 'Medya · Kaleydoskop': 'Media · Kaleidoscope',
    '⏭ Eylem · Sonraki Görselleştirici': '⏭ Action · Next Visualizer',
    '⏮ Eylem · Önceki Görselleştirici': '⏮ Action · Previous Visualizer',
    '⏭ Eylem · Sonraki Arkaplan': '⏭ Action · Next Background',
    '⏭ Eylem · Sonraki Sahne': '⏭ Action · Next Scene',
    '⏭ Eylem · Sonraki Renk Şablonu': '⏭ Action · Next Color Preset',
    '🌑 Eylem · Karart (aç/kapa)': '🌑 Action · Blackout (toggle)',

    // ---- Medya katmanı ----
    'Kameranızı veya bir video dosyasını sahneye katman olarak koyar. Kaleydoskop, renk kayması ve sese bağlı yakınlaşma uygulanabilir; Studio shader\'larında sv_media (iChannel3) olarak da okunur.': 'Places your camera or a video file into the scene as a layer. Kaleidoscope, hue shift, and audio-driven zoom can be applied; Studio shaders can also read it as sv_media (iChannel3).',
    'Kaynak': 'Source', '📷 Kamera': '📷 Camera', '🎞 Video Dosyası': '🎞 Video File',
    'Kamera': 'Camera', 'Varsayılan kamera': 'Default camera', '🔄 Kameraları Yenile': '🔄 Refresh Cameras',
    'Video Dosyası': 'Video File', '🎞 Video Seç': '🎞 Choose Video',
    'seçildi': 'selected', 'seçilmedi': 'not selected', 'Döngüde Oynat': 'Loop Playback',
    'Sığdırma': 'Fit', 'Doldur': 'Cover', 'Sığdır': 'Contain', 'Ger': 'Stretch',
    'Çarpma': 'Multiply', 'Aynala': 'Mirror',
    'Kaleydoskop Dilimi': 'Kaleidoscope Slices', 'Renk Kayması': 'Hue Shift', 'Doygunluk': 'Saturation',
    'Bas → Saydamlık': 'Bass → Opacity',

    // ---- Sahne üretici ----
    'Ruh Hali': 'Mood',
    '✨ Sahne Üret': '✨ Generate Scene', '🎲 Karıştır': '🎲 Shuffle',
    'Aynı ruh hali, farklı yorum': 'Same mood, a different reading',
    'Sahne kuruldu.': 'Scene created.',
    'Enerji': 'Energy', 'Sıcaklık': 'Warmth', 'Ton': 'Tone', 'Doku': 'Texture',
    'sakin': 'calm', 'yüksek': 'high', 'soğuk': 'cold', 'sıcak': 'warm',
    'aydınlık': 'bright', 'karanlık': 'dark', 'geometrik': 'geometric', 'organik': 'organic',
    'dengeli': 'balanced',
    'Tamamen bu bilgisayarda çalışır — hiçbir servise bağlanmaz. Yazdığınız metin enerji, sıcaklık, aydınlık ve doku eksenlerine çevrilir; sahne bu eksenlerden tohumlanmış deterministik bir üreticiyle kurulur. Beğendiğinizi sağdaki Sahneler bölümünden kaydedin.': 'Runs entirely on this computer — it connects to no service. Your text is mapped onto energy, warmth, brightness, and texture axes; the scene is then built by a deterministic generator seeded from those axes. Save the ones you like from the Scenes section on the right.',


    // ---- Yerleşik Studio presetleri (ad + açıklama) ----
    'Plazma Deniz': 'Plasma Sea',
    'Klasik plazma: katmanlı sinüsler basla dalgalanır.': 'Classic plasma: layered sines that swell with the bass.',
    'Frekans Halkaları': 'Frequency Rings',
    'Merkezden yayılan halkalar; her halka bir frekans bandı.': 'Rings spreading from the center; each ring is a frequency band.',
    'Sıvı Metal': 'Liquid Metal',
    'Alan bükümlü gürültü; ağır, akışkan metalik yüzey.': 'Domain-warped noise; a heavy, flowing metallic surface.',
    'Yıldız Geçidi': 'Star Gate',
    'Hiper uzay: bas vurdukça hızlanan yıldız akışı.': 'Hyperspace: a star stream that accelerates on every bass hit.',
    'Dalga Perdesi': 'Wave Curtain',
    'Dalga formundan üretilen ışık perdesi — saydam üst katman.': 'A curtain of light built from the waveform — a transparent overlay.',
    'Bas Küresi': 'Bass Orb',
    'Ortada nabız atan enerji küresi — saydam üst katman.': 'A pulsing orb of energy in the middle — a transparent overlay.',

    // ---- Yer tutucular ----
    'ör. "karanlık sinematik uzay", "enerjik neon techno", "sakin orman sabahı"': 'e.g. "dark cinematic space", "energetic neon techno", "calm forest morning"',
    'uAd': 'uName',
    '/adres/yolu': '/address/path',

    // ======================= v2.1 — MOTORLAR =======================

    // ---- Katmanlar ----
    'Katmanlar': 'Layers',
    'Sahneyi üst üste binen katmanlardan kurun: her katmanın kendi kaynağı, karışım modu, saydamlığı, dönüşümü ve sese tepkisi olur.': 'Build the scene from stacked layers: each layer gets its own source, blend mode, opacity, transform, and audio response.',
    'Sahne şu anda Arkaplan ve Görselleştirici kartlarından sürülüyor. Katmanlara geçerseniz aynı görünüm katman listesi olarak açılır ve üzerine yenilerini ekleyebilirsiniz.': 'The scene is currently driven by the Background and Visualizer cards. Switching to layers opens that same look as a layer list you can build on.',
    '⬗ Katmanlara Geç': '⬗ Switch To Layers',
    '↺ Katmanları Sıfırla': '↺ Reset Layers',
    'Katman listesini boşaltır; sahne yeniden Arkaplan/Görselleştirici kartlarından sürülür': 'Empties the layer list; the scene is driven by the Background/Visualizer cards again',
    'Katman listesi boşaltılacak. Sahne yeniden Arkaplan ve Görselleştirici kartlarından sürülecek.': 'The layer list will be emptied. The scene will be driven by the Background and Visualizer cards again.',
    'Katmanı aç/kapat': 'Enable/disable layer',
    'Yukarı taşı': 'Move up', 'Aşağı taşı': 'Move down', 'Kaldır': 'Remove',
    'Kaynak': 'Source', 'Karışım': 'Blend', 'Dönüşüm': 'Transform', 'Sese Tepki': 'Audio Response',
    'Ölçek': 'Scale', 'Dönüş': 'Rotation', 'Yatay Konum': 'Horizontal Position', 'Dikey Konum': 'Vertical Position',
    'Yatay Aynala': 'Mirror Horizontally', 'Dikey Aynala': 'Mirror Vertically',
    'Bant': 'Band', 'Ses → Saydamlık': 'Audio → Opacity', 'Ses → Ölçek': 'Audio → Scale', 'Ses → Dönüş': 'Audio → Rotation',
    'Görsel Nesneler': 'Visual Objects', 'Arka Katman': 'Back Layer', 'Ön Katman': 'Front Layer',
    'Henüz Studio preseti yok.': 'No Studio preset yet.',

    // Karışım modları
    'Toplama': 'Add', 'Ekran': 'Screen', 'Kaplama': 'Overlay',
    'Koyulaştır': 'Darken', 'Açıklaştır': 'Lighten',
    'Renk Soldurma': 'Color Dodge', 'Renk Yakma': 'Color Burn',
    'Sert Işık': 'Hard Light', 'Yumuşak Işık': 'Soft Light',
    'Fark': 'Difference', 'Dışlama': 'Exclusion',
    'Renk Tonu': 'Hue', 'Parlaklık': 'Luminosity',

    // ---- Efekt zinciri ----
    'Efekt Zinciri': 'Effect Chain',
    'Birleştirilmiş sahneye sırayla uygulanan son-işlem efektleri. Sıra görüntüyü değiştirir; zincir dışa aktarımda da aynen çalışır.': 'Post-processing effects applied in order to the composited scene. The order changes the result, and the chain runs the same way on export.',
    'Zincir boşken sahne doğrudan kompozit edilir; hiçbir ek maliyet yoktur. Efekt eklediğinizde sahne tek yüzeye birleştirilip GPU\'da işlenir ve efektler dışa aktarımda da aynı sırayla uygulanır.': 'With an empty chain the scene is composited directly at no extra cost. Adding an effect merges the scene onto a single surface processed on the GPU, and the effects are applied in the same order on export.',
    'Efekti aç/kapat': 'Enable/disable effect',
    'Sese Bağla': 'Bind To Audio',
    'Yeni Efekt': 'New Effect', '＋ Efekt ekle…': '＋ Add effect…',

    // Efekt adları
    'Bloom (Kompozisyon Parlaması)': 'Bloom (Composition Glow)',
    'Renk Sapması (Kromatik)': 'Chromatic Aberration',
    'Glitch (Dilim Kayması)': 'Glitch (Slice Shift)',
    'Film Greni': 'Film Grain',
    'CRT / Tarama Çizgileri': 'CRT / Scanlines',
    'Pikselleştir': 'Pixelate',
    'Ayna': 'Mirror',
    'Renk Düzeltme': 'Color Grade',
    'İz / Yankı': 'Trails / Echo',
    'Kenar Vurgusu': 'Edge Highlight',
    'Merkezden Bulanıklık': 'Zoom Blur',
    'Dalga Bozulması': 'Ripple Distortion',
    'Posterize / Ters Çevir': 'Posterize / Invert',

    // Efekt parametreleri
    'Eşik': 'Threshold', 'Şiddet': 'Intensity', 'Yarıçap': 'Radius',
    'Merkezden Uzaklık': 'Falloff', 'Dilim Sayısı': 'Slice Count',
    'Tanecik Boyutu': 'Grain Size', 'Çizgi Şiddeti': 'Line Strength',
    'Ekran Eğriliği': 'Screen Curvature', 'Çizgi Sıklığı': 'Line Frequency',
    'Piksel Boyutu': 'Pixel Size', 'Dilim': 'Slices',
    'Biçim (0 yatay · 1 dikey · 2 dörtlü)': 'Mode (0 horizontal · 1 vertical · 2 quad)',
    'Pozlama': 'Exposure', 'Kontrast': 'Contrast', 'Sıcaklık': 'Temperature',
    'Sönme': 'Decay', 'Yakınlaşma': 'Zoom',
    'Örnek': 'Samples', 'Sıklık': 'Frequency', 'Kademe': 'Levels', 'Ters Çevir': 'Invert',
    'Miktar': 'Amount', 'Yumuşaklık': 'Softness',

    // ---- 3B geometri ----
    '3B Geometri': '3D Geometry',
    '◈ 3B Geometri': '◈ 3D Geometry',
    'Matematiksel formüllerden gerçek perspektifte geometri: yüzeyler, uzay eğrileri ve çekici sistemler.': 'Geometry in true perspective from mathematical formulas: surfaces, space curves, and attractor systems.',
    'Aile': 'Family', 'Formül': 'Formula', 'Çizim': 'Draw', 'Çözünürlük': 'Resolution',
    'Sese Bağlı Bozulma': 'Audio Deformation', 'Bozulma Kipi': 'Deformation Mode',
    'Renklendirme': 'Coloring', 'Kamera ve Görünüm': 'Camera & Appearance',
    'Dönüş Hızı': 'Spin Speed', 'Eğim': 'Tilt', 'Bas → Kamera': 'Bass → Camera',
    'Nokta Boyutu': 'Point Size',
    'Çekici Ayarları': 'Attractor Settings', 'Nokta Sayısı': 'Point Count',
    'İntegrasyon Adımı': 'Integration Step',
    'Doğruluk': 'Accuracy',
    'kapalı form · test edilmiş': 'closed form · tested',
    'sayısal yaklaşım': 'numerical approximation',
    'görsel amaçlı': 'visualization-grade',
    'Formüller kanonik matematiktir; kapalı formlu olanların bilinen noktalardaki değerleri "npm test" ile sayısal olarak doğrulanır. Ağ bir kez kurulup GPU\'da kalır, sese bağlı bozulma vertex shader\'da yapılır.': 'The formulas are canonical mathematics; the closed-form ones are numerically verified at known points by "npm test". The mesh is built once and stays on the GPU, and audio deformation happens in the vertex shader.',
    'Yüzey': 'Surface', 'Uzay Eğrisi': 'Space Curve', 'Düzlem Eğrisi': 'Plane Curve', 'Çekici': 'Attractor',
    'Tel Kafes': 'Wireframe', 'Nokta': 'Points',
    'Normal Yönünde': 'Along Normal', 'Işınsal': 'Radial', 'Dikey': 'Vertical', 'Çökme': 'Collapse',
    'Palet': 'Palette', 'Derinlik': 'Depth', 'Normal': 'Normal', 'Spektrum': 'Spectrum',
    'Bu ailede formül yok.': 'No formula in this family.',

    // Formül adları
    'Lissajous': 'Lissajous', 'Gül Eğrisi (Rhodonea)': 'Rose Curve (Rhodonea)',
    'Episikloid': 'Epicycloid', 'Hipotrokoid (Spirograf)': 'Hypotrochoid (Spirograph)',
    'Süperformül (Gielis)': 'Superformula (Gielis)', 'Kelebek Eğrisi': 'Butterfly Curve',
    'Lemniskat (Bernoulli)': 'Lemniscate (Bernoulli)', 'Astroid': 'Astroid', 'Kardiyoid': 'Cardioid',
    'Filotaksi (Altın Açı)': 'Phyllotaxis (Golden Angle)', 'Logaritmik Sarmal': 'Logarithmic Spiral',
    'Harmonograf': 'Harmonograph', 'Simit Düğümü': 'Torus Knot', 'Sarmal (Helis)': 'Helix',
    'Viviani Eğrisi': 'Viviani Curve', 'Yonca Düğümü': 'Trefoil Knot',
    'Düzlem': 'Plane', 'Küre': 'Sphere', 'Simit (Torus)': 'Torus', 'Klein Şişesi': 'Klein Bottle',
    'Möbius Şeridi': 'Möbius Strip', 'Süperşekil (3B Gielis)': 'Supershape (3D Gielis)',
    'Deniz Kabuğu': 'Seashell', 'Boy Yüzeyi': "Boy's Surface", 'Dini Yüzeyi': 'Dini Surface',
    'Küresel Harmonik': 'Spherical Harmonic', 'Chladni Deseni': 'Chladni Pattern',
    'Dalga Yüzeyi': 'Ripple Surface',
    'Lorenz': 'Lorenz', 'Rössler': 'Rössler', 'Thomas': 'Thomas', 'Aizawa': 'Aizawa',
    'Halvorsen': 'Halvorsen', 'Clifford (Ayrık)': 'Clifford (Discrete)', 'de Jong (Ayrık)': 'de Jong (Discrete)',
    'Boru Kalınlığı': 'Tube Thickness', 'Genişlik': 'Width', 'Tur': 'Turns', 'Burulma': 'Twist',
    'Faz': 'Phase', 'Açı (derece)': 'Angle (degrees)', 'Yayılma': 'Spread', 'Sönüm': 'Damping',
    'Üs': 'Exponent', 'Yükseklik': 'Height',

    // ---- Tempo ve otomatik VJ ----
    'Tempo ve Otomatik VJ': 'Tempo & Auto VJ',
    'Parçanın temposunu bulur; sahneleri, modları veya renkleri ölçüye hizalı olarak kendiliğinden değiştirir.': 'Finds the track\'s tempo and switches scenes, modes, or colors by itself, aligned to the bar.',
    '👆 Tempoya Vur': '👆 Tap Tempo',
    'Ritimle birkaç kez basın; tempo elle sabitlenir': 'Tap a few times in time with the music to lock the tempo manually',
    'BPM Kilidi': 'BPM Lock', 'otomatik': 'automatic',
    'Ölçüdeki Vuruş': 'Beats Per Bar',
    'Tempo, spektral akıdan bulunan vuruşların aralık histogramıyla kestirilir ve 60–180 BPM aralığına katlanır; böylece aynı parça bazen 75 bazen 150 görünmez. Dış bir tempo kaynağına bağlanılmaz — elle vurarak sabitleyebilirsiniz.': 'Tempo is estimated from an interval histogram of beats found via spectral flux, then folded into the 60–180 BPM range so the same track never reads as 75 one moment and 150 the next. No external tempo source is used — you can lock it by tapping.',
    'Otomatik VJ': 'Auto VJ',
    'Neyi Değiştirsin': 'What To Switch',
    'Sahneler': 'Scenes', 'Görselleştiriciler': 'Visualizers', 'Hepsi (sırayla)': 'All (in turn)',
    'Aralık Birimi': 'Interval Unit', 'Ölçü': 'Bars', 'Saniye': 'Seconds',
    'Aralık': 'Interval', 'Sıra': 'Order', 'Sırayla': 'Sequential', 'Rastgele': 'Random',
    '⏭ Şimdi Değiştir': '⏭ Switch Now',

    // ---- Art-Net / DMX ----
    'Art-Net / DMX Çıkışı': 'Art-Net / DMX Output',
    'Sahne renklerini standart DMX protokolüyle ışık konsollarına ve arayüzlerine yollar.': 'Sends scene colors to lighting consoles and interfaces over the standard DMX protocol.',
    'Art-Net Çıkışı': 'Art-Net Output',
    'Sahne renklerini standart DMX protokolüyle (Art-Net) ışık konsollarına, DMX arayüzlerine ve QLC+ gibi yazılımlara yollar. Windows Dynamic Lighting\'in yerine geçmez; o tüketici aygıtlarını, bu sahne ışıklarını sürer.': 'Sends scene colors over the standard DMX protocol (Art-Net) to lighting consoles, DMX interfaces, and software such as QLC+. It does not replace Windows Dynamic Lighting: that drives consumer devices, this drives stage lights.',
    'Yayında': 'Broadcasting', 'Evren': 'Universe', 'paket': 'packets',
    'Hedef Adres': 'Target Address',
    'Evren (Universe)': 'Universe',
    'Başlangıç Kanalı': 'Start Channel',
    'Aygıt Sayısı': 'Fixture Count',
    'Aygıt Kanalları': 'Fixture Channels',
    'Renk Kaynağı': 'Color Source',
    'Sahne Paleti': 'Scene Palette', 'Frekans Bantları': 'Frequency Bands',
    'Kayan Spektrum': 'Rolling Spectrum', 'Tek Renk': 'Single Color',
    'Gönderim Hızı': 'Send Rate',
    'Varsayılan hedef yayın adresidir; ağdaki tüm Art-Net düğümleri paketi alır. Tek bir arayüze göndermek isterseniz onun IP adresini yazın. DMX 44 Hz üstünü zaten taşımaz, bu yüzden gönderim hızı orada sınırlıdır.': 'The default target is the broadcast address, so every Art-Net node on the network receives the packet. Enter a specific IP to target a single interface. DMX cannot carry more than 44 Hz, which is why the send rate is capped there.',

    // ---- Renk şablonu kitaplığı (58 şablon, 7 grup) ----
    'Klasikler': 'Classics', 'Sıcak': 'Warm', 'Soğuk': 'Cool',
    'Neon ve Siber': 'Neon & Cyber', 'Karanlık': 'Dark', 'Aydınlık': 'Light',
    'Tek Renk Aileleri': 'Monochrome Families',

    'Çöl': 'Desert', 'Sonbahar': 'Autumn', 'Şafak': 'Dawn', 'Kor': 'Embers',
    'Şeftali': 'Peach', 'Altın Saat': 'Golden Hour', 'Bakır': 'Copper',
    'Şarap': 'Wine', 'Mercan': 'Coral', 'Baharat': 'Spice',

    'Kutup': 'Polar', 'Derin Deniz': 'Deep Sea', 'Nane': 'Mint', 'Gökyüzü': 'Sky',
    'Kış Sabahı': 'Winter Morning', 'Turkuaz': 'Turquoise', 'Lavanta': 'Lavender',
    'Sis': 'Mist', 'Kuzey Işığı': 'Northern Light', 'Buzul': 'Glacier',

    'Siberpunk': 'Cyberpunk', 'Synthwave': 'Synthwave', 'Vapor': 'Vapor',
    'Asit': 'Acid', 'Ultraviyole': 'Ultraviolet', 'Matris': 'Matrix',
    'Gece Kulübü': 'Nightclub', 'Lazer': 'Laser', 'Hologram': 'Hologram', 'Devre': 'Circuit',

    'Kömür': 'Charcoal', 'Gotik': 'Gothic', 'Uzay Boşluğu': 'Deep Space',
    'Kan Ayı': 'Blood Moon', 'Zift': 'Pitch', 'Gölge': 'Shadow',

    'Kağıt': 'Paper', 'Bahar': 'Spring', 'Şeker': 'Candy', 'Limonata': 'Lemonade',
    'Deniz Köpüğü': 'Sea Foam', 'Gündüz': 'Daylight',

    'Mono Kırmızı': 'Mono Red', 'Mono Mavi': 'Mono Blue', 'Mono Yeşil': 'Mono Green',
    'Mono Mor': 'Mono Purple', 'Mono Turuncu': 'Mono Orange', 'Gri Tonlama': 'Grayscale',
    // ---- Mobil uzaktan kumanda (yayın sunucusunun servis ettiği sayfa) ----
    'CAYADEV Visualizer — Uzaktan Kumanda': 'CAYADEV Visualizer — Remote Control',
    'CAYADEV Visualizer — Yayın Katmanı': 'CAYADEV Visualizer — Streaming Overlay',
    'DEV Kumanda': 'DEV Remote',
    'Bağlanıyor…': 'Connecting…',
    'Bağlı': 'Connected',
    'CAYADEV Visualizer ile bağlantı yok — uygulama açık mı?': 'No connection to CAYADEV Visualizer — is the application running?',
    'Görselleştirme': 'Visualization',
    '▶ Aç': '▶ Open',
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
    'Nokta': 'Dots', 'Damla': 'Blobs', 'Silüet': 'Skyline', 'Kutup': 'Aurora',
    'Yıldız': 'Starfield', 'Bokeh': 'Bokeh', 'Yağmur': 'Rain', 'Halka': 'Rings',
    'Petek': 'Hex', 'Düz': 'Solid', 'Izgara': 'Grid', 'Gradyan': 'Gradient',
    'Kar': 'Snow', 'Geri Besleme': 'Feedback',

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
    return raw
      .replace(/Ekran (\d+)( \(Birincil\))?/g, (_, n, p) => `Display ${n}${p ? ' (Primary)' : ''}`)
      .replace(/Şablonum (\d+)/g, 'My Preset $1')
      .replace(/Görsel (\d+)/g, 'Image $1')
      .replace(/✓ (\d+) uyumlu aydınlatma aygıtı bulundu/g, '✓ $1 compatible lighting device(s) found')
      .replace(/⚠ Portable sürüm yalnızca uygulama odaktayken kontrol eder \((\d+)\/(\d+)\)\./g, '⚠ The portable build controls lighting only while the application is focused ($1/$2).')
      .replace(/LED \/ bölge/g, 'LED / zone')
      .replace(/● Yakalanıyor: /g, '● Capturing: ')
      .replace(/çıkış/g, 'output')
      .replace(/✅ Tamamlandı/g, '✅ Completed')
      .replace(/⚠ Hata:/g, '⚠ Error:')
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
      .replace(/^(.+) kopyalandı\.$/g, '$1 copied.')
      .replace(/^Kaydedilemedi: /g, 'Could not save: ')
      .replace(/^MIDI erişimi reddedildi: /g, 'MIDI access denied: ')
      .replace(/^(\d+) FPS$/g, '$1 FPS')
      .replace(/^(.*) \(kopya\)$/, (m, base) => (EN_NORMALIZED[normalize(base)] || base) + ' (copy)')
      .replace(/^(\d+) kayıtlı$/g, '$1 saved')
      .replace(/^(\d+) (sahne|şablon|preset|dilim)$/g, (m, n, word) => {
        const one = { sahne: 'scene', 'şablon': 'preset', preset: 'preset', dilim: 'slice' }[word];
        return n + ' ' + one + (Number(n) === 1 ? '' : 's');
      })
      .replace(/^(\d+) preset\(s\) imported\.$/g, (m, n) =>
        n + ' preset' + (Number(n) === 1 ? '' : 's') + ' imported.')
      // Dynamic Lighting kontrol durumu (sayı içerdiği için sözlükle eşleşmez)
      .replace(/✓ Windows (\d+)\/(\d+) aygıt için kontrol verdi/g, '✓ Windows granted control for $1/$2 device(s)')
      .replace(/⚠ Windows arka plan kontrolünü vermedi \((\d+)\/(\d+)\)\. Dynamic Lighting ayarlarında CAYADEV Visualizer uygulamasını listenin en üstüne taşıyın\./g, '⚠ Windows did not grant background control ($1/$2). Move CAYADEV Visualizer to the top of the list in Dynamic Lighting settings.')
      .replace(/^CC (\d+)( · k(\d+))?$/g, (m, cc, _s, ch) => 'CC ' + cc + (ch ? ' · ch' + ch : ''))
      .replace(/^Nota (\d+)( · k(\d+))?$/g, (m, n, _s, ch) => 'Note ' + n + (ch ? ' · ch' + ch : ''))
      ;
  }

  function translateNode(node) {
    if (node.nodeType === Node.TEXT_NODE) {
      const next = translate(node.nodeValue);
      if (next !== node.nodeValue) node.nodeValue = next;
      return;
    }
    if (node.nodeType !== Node.ELEMENT_NODE) return;
    for (const attr of ['title', 'placeholder', 'aria-label']) {
      if (!node.hasAttribute(attr)) continue;
      const current = node.getAttribute(attr);
      const next = translate(current);
      if (next !== current) node.setAttribute(attr, next);
    }
    for (const child of node.childNodes) translateNode(child);
  }

  document.documentElement.lang = locale;
  window.SVI18n = { locale, t: translate };

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
    }).observe(document.body, { subtree: true, childList: true, characterData: true, attributes: true, attributeFilter: ['title', 'placeholder', 'aria-label'] });
  };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start, { once: true });
  else start();
})();
