/*
 * SoundVisualizer — CaYaDev Ses Görselleştirici
 * Copyright (c) 2026 Çağan Turgut (CaYatur) — CaYaDev, https://cayadev.com
 * https://github.com/CaYatur/SoundVisualizer
 * SPDX-License-Identifier: MIT
 */
'use strict';
/* Uygulama başına ses yakalama — kuralları.
 *
 * "Şu uygulamanın sesini dinle" üç platformda üç ayrı şeye dayanıyor ve bu
 * fark, kodun geri kalanının görmemesi gereken bir ayrıntı:
 *
 *   win32   WASAPI süreç loopback'i. ActivateAudioInterfaceAsync'e
 *           VIRTUAL_AUDIO_DEVICE_PROCESS_LOOPBACK yolu ve hedef sürecin
 *           kimliği veriliyor. Windows yapı 20348'den önce bu API yok.
 *   darwin  ScreenCaptureKit. macOS 13'ten önce uygulama başına ses veren
 *           desteklenen bir yol yok; kullanıcının sanal aygıt kurması gerekir.
 *   linux   PipeWire/PulseAudio her uygulama akışını (sink-input) ayrı
 *           gösterir, oradan bağlanılır.
 *
 * Burası saf bir modül: çalıştıramadığımız platformların davranışı ancak
 * böyle sınanabilir. (bkz. src/shared/audio-devices.js — aynı gerekçe.)
 */
(function () {
  // Süreç loopback API'sinin geldiği Windows yapısı
  const WIN_MIN_BUILD = 20348;
  // ScreenCaptureKit ile uygulama sesi
  const MAC_MIN_MAJOR = 13;

  const MODES = ['include', 'exclude'];
  const DEFAULT_MODE = 'include';

  /* os.release() sürümünden yapı numarası. Windows'ta "10.0.28020",
     macOS'ta Darwin çekirdek sürümü ("22.6.0") gelir. */
  function releaseParts(release) {
    return String(release || '').split('.').map((n) => parseInt(n, 10) || 0);
  }

  /* Darwin çekirdek sürümü macOS sürümü DEĞİL: Darwin 22 = macOS 13.
     Aradaki sabit fark 9. */
  function macMajorFromDarwin(release) {
    const darwin = releaseParts(release)[0] || 0;
    return darwin ? darwin - 9 : 0;
  }

  /* Bu platform uygulama başına ses yakalayabilir mi?
     `code` arayüzün doğru mesajı seçmesi için; `message` son çare. */
  function support(platform, release, opts) {
    const p = platform || process.platform;
    const o = opts || {};
    if (p === 'win32') {
      const build = releaseParts(release)[2] || 0;
      if (build && build < WIN_MIN_BUILD) {
        return {
          supported: false,
          code: 'WIN_TOO_OLD',
          message: 'Uygulama başına ses yakalama Windows yapı ' + WIN_MIN_BUILD
            + ' ve üstünü gerektiriyor; bu bilgisayarda yapı ' + build + '.',
        };
      }
      return { supported: true, code: 'OK', message: '' };
    }
    if (p === 'darwin') {
      const major = macMajorFromDarwin(release);
      if (major && major < MAC_MIN_MAJOR) {
        return {
          supported: false,
          code: 'MAC_TOO_OLD',
          message: 'Uygulama başına ses yakalama macOS ' + MAC_MIN_MAJOR
            + ' ve üstünü gerektiriyor (ScreenCaptureKit).',
        };
      }
      /* Yardımcı (native/app-audio-helper-mac) Swift ile derleniyor; Xcode
         araçları olmadan derlenmiş bir pakette yok. */
      if (o.helper === false) {
        return {
          supported: false,
          code: 'NO_HELPER',
          message: 'Ses yakalama yardımcısı bulunamadı; bu paket Swift yardımcısı olmadan derlenmiş olabilir.',
        };
      }
      /* ScreenCaptureKit, ses için bile Ekran Kaydı iznini istiyor. İzin
         yokken liste boş gelir; kullanıcı "çalan uygulama yok" sanmasın
         diye sebebi ayrı bir kodla söylüyoruz. */
      if (o.permission === false) {
        return {
          supported: false,
          code: 'MAC_NO_PERMISSION',
          canRequest: true,
          message: 'Uygulama sesini dinlemek için Ekran Kaydı izni gerekiyor: Sistem Ayarları › Gizlilik ve Güvenlik › Ekran ve Sistem Sesi Kaydı.',
        };
      }
      return { supported: true, code: 'OK', message: '' };
    }
    if (p === 'linux') {
      /* Uygulama akışlarını PulseAudio ya da pipewire-pulse gösteriyor;
         yakalama pactl ve parec ile yapılıyor (bkz. app-audio-linux.js).
         Çağıran ölçtüğünü veriyor: {pactl, parec, pipewire, server}.
         `server` "pactl info"nun sonucu; ölçülmediyse undefined.

         Yalnızca PipeWire'ın varlığı YETMEZ: pactl/parec yoksa yakalanacak
         bir şey yok, desteklenir demek sessizce çalışmayan bir denetim
         göstermek olurdu. */
      if (!o.pactl && !o.parec && !o.pipewire) {
        return {
          supported: false,
          code: 'NO_SOUND_SERVER',
          message: 'Uygulama başına ses yakalama için PipeWire ya da PulseAudio gerekiyor.',
        };
      }
      if (!o.pactl || !o.parec) {
        const missing = [!o.pactl && 'pactl', !o.parec && 'parec'].filter(Boolean).join(', ');
        return {
          supported: false,
          code: 'LINUX_NO_TOOLS',
          missing,
          message: 'Uygulama başına ses yakalama için ' + missing
            + ' gerekiyor; pulseaudio-utils paketini kurun.',
        };
      }
      if (o.server === false) {
        return {
          supported: false,
          code: 'SOUND_SERVER_DOWN',
          message: 'Ses sunucusuna bağlanılamadı; PulseAudio ya da pipewire-pulse çalışıyor mu?',
        };
      }
      return { supported: true, code: 'OK', message: '' };
    }
    return {
      supported: false,
      code: 'UNSUPPORTED_PLATFORM',
      message: 'Bu işletim sisteminde uygulama başına ses yakalama yok.',
    };
  }

  // ------------------------------------------------------------- kaynak biçimi

  /* Kaynak listesi hem aygıt adı (metin) hem uygulama hedefi (nesne)
     taşıyabiliyor. Eski yapılandırmalar yalnızca metin içerdiği için
     ikisi de kabul ediliyor. */
  function isAppSource(src) {
    return !!src && typeof src === 'object' && src.kind === 'app';
  }

  /* Bir uygulama kaynağını normalleştirir. `match` çalıştırılabilir dosyanın
     adıdır (chrome.exe gibi) — SÜREÇ KİMLİĞİ DEĞİL. Kimlik her açılışta
     değişiyor; kaydedilmiş bir hedefin yeniden bulunabilmesi için ada
     ihtiyaç var. `pid` yalnızca o oturumdaki ipucudur. */
  function normalizeApp(src) {
    if (!isAppSource(src)) return null;
    const mode = MODES.indexOf(src.mode) >= 0 ? src.mode : DEFAULT_MODE;
    const match = String(src.match || '').trim();
    if (!match) return null;
    return {
      kind: 'app',
      match,
      mode,
      label: String(src.label || '').trim() || match,
      pid: Number(src.pid) > 0 ? Number(src.pid) : 0,
    };
  }

  /* HARİÇ TUTMA tek uygulamayla sınırlı.

     İşletim sistemi arayüzü tek bir süreç kimliği alıyor: "şunun dışındaki
     her şey". İki ayrı hariç-tutma akışı açsaydık, her biri ÖTEKİ
     uygulamanın sesini de taşırdı; ikisini karıştırınca o ses iki kez
     sayılır ve seviye şişerdi. Dahil etme kipinde böyle bir sorun yok,
     orada istenildiği kadar uygulama seçilebilir. */
  function limitExclude(apps) {
    const list = Array.isArray(apps) ? apps : [];
    const firstExclude = list.findIndex((a) => a.mode === 'exclude');
    if (firstExclude < 0) return list;
    return [list[firstExclude]];
  }

  /* Karışık listeyi ikiye ayırır: aygıtlar ve uygulamalar. Yakalama
     yardımcısı ikisini ayrı arka uçlarla açıyor ama aynı karışıma yazıyor. */
  function splitSources(sources) {
    const list = Array.isArray(sources) ? sources : [sources];
    const devices = [];
    const apps = [];
    for (const s of list) {
      if (isAppSource(s)) {
        const a = normalizeApp(s);
        if (a) apps.push(a);
      } else if (typeof s === 'string' && s) {
        devices.push(s);
      }
    }
    return { devices, apps: limitExclude(apps) };
  }

  // ------------------------------------------------------------ hedef eşleme

  const baseName = (s) => String(s || '').split(/[\\/]/).pop().toLowerCase();
  /* Linux keys can be "binary|app name" (app-audio-linux.js streamName).
     A plain saved key ("pacat", "chrome") still finds such a process by its
     binary, so targets saved before the split keep working. */
  const sameApp = (name, want) => {
    const n = baseName(name);
    if (n === want) return true;
    return want.indexOf('|') < 0 && n.indexOf('|') > 0 && n.slice(0, n.indexOf('|')) === want;
  };

  /* Kaydedilmiş hedefi çalışan süreçler arasında bulur.
     Sıra önemli: önce kaydedilmiş kimlik HÂLÂ aynı uygulamaya aitse o,
     sonra ada göre en çok ses çıkaran / en eski süreç.

     Kimliği tek başına saklamak yetmezdi: kullanıcı uygulamayı kapatıp
     açtığında kimlik değişir ve kaynak sessizce boşa düşerdi. */
  function resolveTarget(app, processes, platform) {
    const a = normalizeApp(app);
    if (!a) return null;
    const list = Array.isArray(processes) ? processes : [];
    const want = baseName(a.match);
    /* Linux'ta liste yalnız O AN çalan akışlardan oluşuyor; oynatıcı
       durunca uygulama listeden düşüyor (Windows'ta ses oturumu süreç
       yaşadıkça duruyor). Hariç tutmada bu, hariç tutulan uygulama
       susunca HİÇBİR ŞEYİN yakalanmaması demekti. Linux oturumu hedefi
       adla seçtiği için hedefin çalıyor olması gerekmiyor. */
    const fallback = platform === 'linux' && a.mode === 'exclude'
      ? { pid: 0, name: a.match, matched: 'absent' }
      : null;

    if (a.pid) {
      const byPid = list.find((p) => Number(p.pid) === a.pid);
      if (byPid && sameApp(byPid.name, want)) {
        return { pid: Number(byPid.pid), name: byPid.name, matched: 'pid' };
      }
    }

    const byName = list.filter((p) => sameApp(p.name, want));
    if (!byName.length) return fallback;

    /* Aynı addan birden çok süreç olabiliyor (tarayıcılar). Ses çıkaranı
       tercih et; hiçbiri çıkarmıyorsa en eskisini (ana süreç genelde odur). */
    const active = byName.filter((p) => p.audible);
    const pool = active.length ? active : byName;
    const best = pool.slice().sort((x, y) => (Number(x.pid) || 0) - (Number(y.pid) || 0))[0];
    return { pid: Number(best.pid), name: best.name, matched: active.length ? 'audible' : 'name' };
  }

  /* Arayüzde gösterilecek aday listesi. Ses oturumu olan süreçler önce,
     sonra ada göre; aynı uygulamanın onlarca alt süreci tek satıra iner. */
  function candidates(processes) {
    const list = Array.isArray(processes) ? processes : [];
    const byName = new Map();
    for (const p of list) {
      if (!p || !p.name) continue;
      const key = baseName(p.name);
      const prev = byName.get(key);
      if (!prev) {
        byName.set(key, {
          match: p.name,
          label: p.label || p.name,
          pid: Number(p.pid) || 0,
          audible: !!p.audible,
          count: 1,
        });
        continue;
      }
      prev.count++;
      // Ses çıkaran süreç, listeyi temsil etsin
      if (p.audible && !prev.audible) {
        prev.audible = true;
        prev.pid = Number(p.pid) || prev.pid;
        if (p.label) prev.label = p.label;
      }
    }
    return Array.from(byName.values()).sort((a, b) => {
      if (a.audible !== b.audible) return a.audible ? -1 : 1;
      return String(a.label).localeCompare(String(b.label), 'tr');
    });
  }

  // ------------------------------------------------------ canlı seviye (#516)

  /* Yardımcının `--meters` kipi her satıra bir JSON dizi yazıyor:
       [[pid,"ad.exe",tepe],...]
     tepe 0..1 doğrusal genlik (IAudioMeterInformation::GetPeakValue).
     Satırlar borudan parça parça geliyor; bir parça satırın ortasında
     bitebilir. Bu yüzden ayrıştırma ve birleştirme burada, saf: hem
     sınanabilsin hem ana süreçteki akış kodu ince kalsın. */

  // Sonu gelmeyen bir satır sınırsız büyümesin (bozuk ya da yanlış ikili)
  const METER_CARRY_MAX = 64 * 1024;

  /* Boru parçasını satırlara böler. `carry` önceki parçadan kalan yarım
     satır; dönen `carry` bir sonrakine verilir. */
  function splitMeterChunk(carry, chunk) {
    const text = String(carry || '') + String(chunk || '');
    const parts = text.split('\n');
    let rest = parts.pop();
    if (rest.length > METER_CARRY_MAX) rest = '';
    const lines = parts.map((l) => l.trim()).filter(Boolean);
    return { lines, carry: rest };
  }

  const clamp01 = (v) => {
    const n = Number(v);
    if (!Number.isFinite(n) || n <= 0) return 0;
    return n >= 1 ? 1 : n;
  };

  /* Tek satırı ayrıştırır. Bozuk satır null döner (yok sayılır); bozuk
     tek bir giriş satırın geri kalanını düşürmez. */
  function parseMeterLine(line) {
    let data;
    try { data = JSON.parse(String(line || '')); } catch { return null; }
    if (!Array.isArray(data)) return null;
    const out = [];
    for (const row of data) {
      if (!Array.isArray(row) || row.length < 3) continue;
      const pid = Number(row[0]);
      const name = typeof row[1] === 'string' ? row[1] : '';
      if (!(pid > 0) || !name) continue;
      out.push({ pid, name, peak: clamp01(row[2]) });
    }
    return out;
  }

  /* Süreç satırlarını uygulama başına toplar. Anahtar baseName (küçük
     harf), seçicideki satırların anahtarıyla aynı. Bir uygulamanın birden
     çok süreci varsa (tarayıcılar) EN YÜKSEK tepe gösterilir: toplamak
     seviyeyi şişirirdi, ortalamak sessiz alt süreçlerle bastırırdı. */
  /* Uygulamanın KENDİ süreçleri listeden çıkar. Sistem karışımını
     yakalayan alt süreç (loopback-helper) bizim yürütülebilir dosyamızla
     çalışıyor ve kendi ses oturumunu açıyor: seçicide "Ses Görselleştirici"
     diye görünüyor, ölçeri de bütün sistem karışımını izliyordu. Kendimizi
     yakalamanın bir anlamı yok; ad eşleşmesi büyük-küçük harfe duyarsız. */
  function withoutSelf(rows, selfName) {
    const self = baseName(selfName);
    if (!self) return Array.isArray(rows) ? rows : [];
    return (Array.isArray(rows) ? rows : []).filter((r) => !(r && baseName(r.name) === self));
  }

  function meterLevels(rows) {
    const out = {};
    for (const r of Array.isArray(rows) ? rows : []) {
      if (!r || !r.name) continue;
      const key = baseName(r.name);
      const p = clamp01(r.peak);
      if (!(key in out) || p > out[key]) out[key] = p;
    }
    return out;
  }

  /* Ölçer çubuğunun doluluğu. Doğrusal genlik gözle okunmuyor: -20 dB
     (0,1) çubuğun onda birinde kalır ve sessiz sanılır. Bu yüzden dB
     ölçeği: METER_FLOOR_DB altı boş, 0 dB dolu. */
  const METER_FLOOR_DB = -48;
  function meterFraction(peak) {
    const p = clamp01(peak);
    if (p <= 0) return 0;
    const db = 20 * Math.log10(p);
    if (db <= METER_FLOOR_DB) return 0;
    return Math.min(1, (db - METER_FLOOR_DB) / -METER_FLOOR_DB);
  }

  /* Ölçer balistiği: yükseliş anında, düşüş yavaş. Yalnız anlık değer
     gösterilseydi çubuk her pakette titrerdi ve kısa vuruşlar hiç
     görünmezdi. `releasePerSec` dolu çubuğun saniyede ne kadar indiği. */
  const METER_RELEASE_PER_SEC = 1.6;
  function meterBallistics(prev, next, dtMs, releasePerSec) {
    const target = clamp01(next);
    const from = clamp01(prev);
    if (target >= from) return target;
    const dt = Math.max(0, Number(dtMs) || 0) / 1000;
    const rate = releasePerSec > 0 ? releasePerSec : METER_RELEASE_PER_SEC;
    return Math.max(target, from - rate * dt);
  }

  const api = {
    WIN_MIN_BUILD, MAC_MIN_MAJOR, MODES, DEFAULT_MODE,
    support, macMajorFromDarwin,
    isAppSource, normalizeApp, splitSources, limitExclude,
    resolveTarget, candidates, baseName, withoutSelf,
    METER_CARRY_MAX, METER_FLOOR_DB, METER_RELEASE_PER_SEC,
    splitMeterChunk, parseMeterLine, meterLevels, meterFraction, meterBallistics,
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (typeof window !== 'undefined') window.SVAppAudio = api;
})();
