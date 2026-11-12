/*
 * SoundVisualizer — CaYaDev Ses Görselleştirici
 * Copyright (c) 2026 Çağan Turgut (CaYatur) — CaYaDev, https://cayadev.com
 * https://github.com/CaYatur/SoundVisualizer
 * SPDX-License-Identifier: MIT
 */
'use strict';
/* ARAMA EŞ ANLAMLILARI. Kullanıcı ayarın adını bilmez; aklındaki sözcüğü yazar: "mikrofon",
   "telefon", "yeşil perde", "export", "shortcut". Ayar adları buna denk gelmediğinde arama
   "bulunamadı" diyordu. Burada her bölüme ve bazı katman ayarlarına, iki dilde, insanların
   yazdığı sözcükler eklenir. Eşleştirme shared/text-fold.js ile: büyük/küçük harf, Türkçe
   I/ı ve aksan farkı yok.

   sections: bölüm kimliği (admin.js sectionSchema) -> sözcükler
   labels:   katman ayarının Türkçe etiketi -> sözcükler
   actions:  ayar olmayan ama aranan şeyler; `run` panelde bir eylem adı */
(function () {
  const sections = {
    sources: ['mikrofon', 'microphone', 'mic', 'hoparlör', 'speaker', 'ses girişi', 'audio input', 'ses aygıtı', 'audio device', 'loopback', 'uygulama sesi', 'app audio', 'kulaklık', 'headphones'],
    analysis: ['hassasiyet', 'sensitivity', 'kazanç', 'gain', 'yumuşatma', 'smoothing', 'fft', 'spektrum', 'spectrum', 'ses seviyesi', 'audio level'],
    mdaudio: ['milkdrop ses', 'milkdrop audio'],
    audiobridge: ['ikinci bilgisayar', 'second pc', 'iki bilgisayar', 'two pc', 'yayın bilgisayarı', 'streaming pc'],
    lighting: ['rgb', 'klavye ışığı', 'keyboard light', 'fare ışığı', 'mouse light', 'led'],
    colorPresets: ['renk', 'color', 'palet', 'palette', 'gradyan', 'gradient'],
    palettes: ['palet', 'palette', 'renk şablonu', 'color swatch'],
    layers: ['katman', 'layer', 'sıra', 'order'],
    templates: ['şablon', 'template', 'hazır sahne', 'ready scene', 'örnek', 'example', 'starter'],
    record: ['ekran görüntüsü', 'screenshot', 'snapshot', 'png', 'webm', 'record', 'kaydet', 'küçük resim', 'thumbnail'],
    aspect: ['anamorfik', 'anamorphic', 'en boy', 'aspect', 'streç', 'stretch', 'basık', 'squashed'],
    mapping: ['mapping', 'projektör', 'projector', 'projeksiyon', 'maske', 'mask', 'kenar birleştirme', 'edge blend', 'warp', 'köşe', 'corner', 'keystone'],
    deepanalysis: ['akor', 'chord', 'ton', 'key', 'bölüm', 'section', 'analiz', 'analysis', 'parça yapısı', 'song structure'],
    dynamicTheme: ['albüm kapağı', 'album art', 'kapak', 'cover', 'kapaktan renk', 'cover colors'],
    milkdrop: ['milk', 'preset'],
    transition: ['geçiş', 'transition', 'crossfade', 'çapraz geçiş', 'karart', 'blackout', 'fade', 'solma'],
    modulation: ['lfo', 'modulation', 'otomasyon', 'automation', 'zarf', 'envelope', 'makro', 'macro'],
    groups: ['grup', 'group', 'a/b', 'crossfader'],
    effects: ['efekt', 'effect', 'filtre', 'filter', 'post', 'shader efekti'],
    geometry: ['3d', '3b', 'küp', 'cube', 'mesh', 'model'],
    feedbackengine: ['feedback', 'geri besleme', 'iz', 'trails'],
    stream: ['obs', 'tarayıcı kaynağı', 'browser source', 'telefon', 'phone', 'uzaktan kumanda', 'remote', 'kumanda', 'qr', 'jeton', 'token', 'şifre', 'password', 'web adresi', 'url', 'overlay', 'bindirme', 'twitch'],
    preshow: ['kontrol listesi', 'checklist', 'gösteri öncesi', 'preflight', 'denetim'],
    redundancy: ['yedek bilgisayar', 'backup pc', 'failover', 'ikinci makine', 'second machine'],
    timeline: ['timeline', 'zaman çizelgesi', 'anahtar kare', 'keyframe', 'otomasyon', 'automation', 'işaret', 'marker'],
    clipdeck: ['klip', 'clip', 'deste', 'deck', 'launcher', 'ızgara', 'grid'],
    tempo: ['bpm', 'tap', 'tempoya vur', 'auto vj', 'otomatik vj', 'vuruş', 'beat'],
    textureShare: ['spout', 'syphon', 'doku paylaşımı', 'texture share', 'resolume', 'touchdesigner', 'vj yazılımı'],
    openrgb: ['rgb', 'led', 'anakart', 'motherboard', 'ram ışığı', 'fan'],
    artnet: ['dmx', 'art-net', 'artnet', 'ışık masası', 'lighting desk', 'led şerit', 'led strip', 'matris', 'matrix', 'piksel', 'pixel'],
    sacn: ['dmx', 'e1.31', 'sacn', 'matris', 'matrix'],
    wled: ['led şerit', 'led strip', 'esp32', 'ddp', 'matris', 'matrix'],
    wledSync: ['led şerit', 'led strip', 'audio sync', 'ses senkronu'],
    lightingGeneral: ['parlaklık', 'brightness', 'ışık', 'light'],
    midi: ['midi', 'kontrolcü', 'controller', 'fader', 'düğme', 'knob', 'pad', 'öğren', 'learn', 'midi map'],
    osc: ['osc', 'touchosc', 'open sound control'],
    oscOut: ['osc', 'osc gönder', 'osc send'],
    mqtt: ['home assistant', 'akıllı ev', 'smart home', 'ev otomasyonu', 'home automation'],
    gamepad: ['joystick', 'gamepad', 'xbox', 'playstation', 'oyun kolu', 'controller'],
    tempoSync: ['link', 'ableton link', 'midi saati', 'midi clock', 'saat', 'clock', 'tempo senkronu', 'tempo sync', 'bpm'],
    artnetIn: ['dmx girişi', 'dmx in', 'ışık masası', 'lighting desk'],
    mtc: ['timecode', 'zaman kodu', 'smpte', 'daw'],
    remotePeers: ['çoklu bilgisayar', 'multi pc', 'birden çok kopya', 'several copies'],
    screensaver: ['ekran koruyucu', 'screensaver', 'boşta', 'idle'],
    recovery: ['çökme', 'crash', 'kurtarma', 'recover', 'geri yükle', 'restore session'],
    lyricsLookup: ['şarkı sözü', 'lyrics', 'söz', 'lrc', 'karaoke'],
    mcp: ['api', 'rest', 'yapay zeka', 'ai', 'asistan', 'assistant', 'otomasyon', 'automation', 'jeton', 'token'],
    studio: ['shader', 'glsl', 'isf', 'shadertoy', 'kod', 'code', 'kendi görselim', 'my own visual'],
    scenegen: ['rastgele sahne', 'random scene', 'üret', 'generate'],
    mdgen: ['rastgele preset', 'random preset', 'üret', 'generate'],
    mdedit: ['preset düzenle', 'edit preset', 'milk düzenle', 'per frame', 'per pixel'],
    display: ['monitör', 'monitor', 'tam ekran', 'fullscreen', 'ikinci ekran', 'second screen', 'pencere', 'window', 'pip', 'yüzen pencere', 'floating window', 'her zaman üstte', 'always on top'],
    power: ['fps', 'performans', 'performance', 'pil', 'battery', 'düşük güç', 'low power', 'kasma', 'lag', 'yavaş', 'slow', 'takılma', 'stutter', 'gpu', 'kare hızı', 'frame rate', 'imleç', 'cursor'],
    scenes: ['sahne', 'scene', 'kayıtlı sahne', 'saved scene'],
    backup: ['yedek', 'backup', 'ayarları dışa aktar', 'export settings', 'ayarları içe aktar', 'import settings', 'taşı', 'move', 'yeni bilgisayar', 'new computer', 'sıfırla', 'reset'],
    'settings-main': ['dil', 'language', 'ingilizce', 'english', 'türkçe', 'turkish', 'tema', 'theme', 'karanlık', 'dark', 'aydınlık', 'light', 'görünüm', 'appearance', 'yazı boyutu', 'font size'],
    'settings-updates': ['sürüm', 'version', 'güncelle', 'update', 'yeni sürüm', 'new version'],
    export: ['export', 'render', 'mp4', 'mov', 'gif', 'webm', 'prores', 'youtube', 'instagram', 'tiktok', 'reels', '4k', '1080p', 'video kaydet', 'save video', 'müzik videosu', 'music video'],
  };

  const labels = {
    'Medya Kaynağı': ['webcam', 'web kamerası', 'kamera', 'camera', 'video', 'ekran yakalama', 'screen capture', 'ekran paylaşımı', 'screen share', 'pencere yakalama', 'window capture'],
    'Ekran Kaynağı': ['ekran yakalama', 'screen capture', 'pencere', 'window', 'monitör', 'monitor'],
    'Renk Anahtarı': ['yeşil perde', 'green screen', 'greenscreen', 'chroma', 'chroma key', 'luma key', 'arka planı sil', 'remove background', 'şeffaf arka plan'],
    'Metin Kaynağı': ['saat', 'clock', 'geri sayım', 'countdown', 'tarih', 'date', 'yazı', 'text'],
    'Resim Kaynağı': ['resim', 'image', 'png', 'gif', 'logo', 'fotoğraf', 'photo'],
  };

  const actions = [
    { label: 'Klavye Kısayolları', section: 'Yardım', category: 'Ayarlar', icon: 'keys', run: 'shortcuts',
      keywords: ['kısayol', 'shortcut', 'shortcuts', 'tuş', 'key', 'keys', 'hotkey', 'klavye', 'keyboard', 'yardım', 'help'] },
    { label: 'Karart', section: 'Üst Çubuk', category: 'Sahne', icon: 'moon', run: 'blackout-button',
      keywords: ['karart', 'blackout', 'siyah ekran', 'black screen', 'kapat', 'boşluk tuşu'] },
    { label: 'Görselleştirmeyi Aç', section: 'Üst Çubuk', category: 'Çıktı', icon: 'play', run: 'open-button',
      keywords: ['başlat', 'start', 'aç', 'open', 'tam ekran', 'fullscreen', 'göster', 'show', 'çıkış', 'output'] },
  ];

  const api = { sections, labels, actions };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (typeof window !== 'undefined') window.SVSearchAliases = api;
})();
