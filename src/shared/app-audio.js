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
      return { supported: true, code: 'OK', message: '' };
    }
    if (p === 'linux') {
      /* PipeWire ya da PulseAudio olmadan uygulama akışları görünmez.
         Hangisinin var olduğunu çağıran söyler; burada karar kuralı durur. */
      if (o.pipewire || o.pulse) return { supported: true, code: 'OK', message: '' };
      return {
        supported: false,
        code: 'NO_SOUND_SERVER',
        message: 'Uygulama başına ses yakalama için PipeWire ya da PulseAudio gerekiyor.',
      };
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

  /* Kaydedilmiş hedefi çalışan süreçler arasında bulur.
     Sıra önemli: önce kaydedilmiş kimlik HÂLÂ aynı uygulamaya aitse o,
     sonra ada göre en çok ses çıkaran / en eski süreç.

     Kimliği tek başına saklamak yetmezdi: kullanıcı uygulamayı kapatıp
     açtığında kimlik değişir ve kaynak sessizce boşa düşerdi. */
  function resolveTarget(app, processes) {
    const a = normalizeApp(app);
    if (!a) return null;
    const list = Array.isArray(processes) ? processes : [];
    const want = baseName(a.match);

    if (a.pid) {
      const byPid = list.find((p) => Number(p.pid) === a.pid);
      if (byPid && baseName(byPid.name) === want) {
        return { pid: Number(byPid.pid), name: byPid.name, matched: 'pid' };
      }
    }

    const byName = list.filter((p) => baseName(p.name) === want);
    if (!byName.length) return null;

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

  const api = {
    WIN_MIN_BUILD, MAC_MIN_MAJOR, MODES, DEFAULT_MODE,
    support, macMajorFromDarwin,
    isAppSource, normalizeApp, splitSources, limitExclude,
    resolveTarget, candidates, baseName,
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (typeof window !== 'undefined') window.SVAppAudio = api;
})();
