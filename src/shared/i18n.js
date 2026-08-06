'use strict';
/* Lightweight UI localization. English is the fallback; Turkish is used only
   when the operating-system/browser locale starts with "tr". */
(function () {
  const detected = (navigator.languages && navigator.languages[0]) || navigator.language || 'en';
  const preference = localStorage.getItem('sv-language') || 'auto';
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
    'Dışa aktarılacak sahne yok.': 'There are no scenes to export.',
    'Sahneleri İçe Aktar': 'Import Scenes',
    'Dosyada sahne bulunamadı.': 'No scenes found in the file.',
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
    'Kodlama': 'Encoding'
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
      .replace(/Kodlanıyor \(([^)]+)\)… kareler bitti, video yazılıyor\./g, 'Encoding ($1)… frames complete, writing video.');
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
