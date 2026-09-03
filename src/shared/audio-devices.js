'use strict';
/* Sistem sesini hangi aygıtın verdiğini bulur.
 *
 * "Bilgisayarda çalanı duy" üç platformda üç farklı şekilde görünür ve bu
 * fark, kodun geri kalanının hiç görmemesi gereken bir ayrıntı:
 *
 *   win32   Çıkış aygıtı doğrudan yakalamaya açılır (WASAPI loopback).
 *   linux   PulseAudio/PipeWire her çıkışa otomatik bir "monitor" kaynağı
 *           verir; bu bir GİRİŞ aygıtıdır. Çıkış arayan kod Linux'ta
 *           hoparlörü seçip onu girişmiş gibi açmaya çalışır ve başarısız olur.
 *   darwin  CoreAudio loopback VERMEZ. Sistem sesi ancak kullanıcının kurduğu
 *           sanal bir aygıtla (BlackHole gibi) duyulur; o da bir giriştir.
 *
 * Burası saf bir modül: çalıştıramadığımız platformların davranışı ancak
 * böyle sınanabilir. Yardımcı süreç de, testler de aynı kuralı kullanır.
 */

/* "Monitor of Built-in Audio" / "alsa_output...analog-stereo.monitor" gibi
   adlar. Kelime sınırıyla eşleşir ki "Monitörlü Mikrofon" gibi bir ada
   yanlışlıkla takılmasın. */
const MONITOR_RE = /(^|[^a-z])monitor([^a-z]|$)/i;

/* macOS'ta yaygın sanal ses aygıtları. Kullanıcı bunlardan birini kurmadan
   sistem sesi yakalanamaz. */
const VIRTUAL_RE = /blackhole|soundflower|loopback audio|vb-?cable|virtual (audio|cable)/i;

/* Bu aygıt "bilgisayarda çalanı" verir mi? */
function isLoopbackDevice(device, platform) {
  if (!device || !device.name) return false;
  const p = platform || process.platform;
  if (p === 'linux') return device.kind === 'input' && MONITOR_RE.test(device.name);
  if (p === 'darwin') return device.kind === 'input' && VIRTUAL_RE.test(device.name);
  return device.kind === 'output';
}

/* Listeye loopback işaretini basar. Arayüz bunu kullanarak kullanıcıya
   hangi aygıtın sistem sesini verdiğini gösterir — Linux'ta bir düzine
   monitor adı arasından seçim yapmak aksi halde tahmin işidir. */
function markLoopback(devices, platform) {
  return (devices || []).map((d) =>
    Object.assign({}, d, { loopback: isLoopbackDevice(d, platform) })
  );
}

/* Varsayılan istendiğinde hangi aygıt seçilmeli.
   Sıra önemli: önce bu platformda sistem sesini GERÇEKTEN veren aygıt,
   sonra varsayılan çıkış, sonra eldeki ilk şey. */
function pickDefault(devices, platform) {
  const all = markLoopback(devices, platform);
  return (
    all.find((d) => d.loopback && d.isDefault) ||
    all.find((d) => d.loopback) ||
    all.find((d) => d.kind === 'output' && d.isDefault) ||
    all.find((d) => d.kind === 'output') ||
    all[0] ||
    null
  );
}

/* Bu platformda sistem sesi hiç yakalanamıyorsa nedenini söyle.
   Sessizce mikrofona düşmek, kullanıcının saatlerce yanlış kaynağı
   dinlemesine yol açar. */
function loopbackAdvice(devices, platform) {
  const p = platform || process.platform;
  if (markLoopback(devices, p).some((d) => d.loopback)) return null;
  if (p === 'darwin') {
    return {
      code: 'NO_LOOPBACK_DARWIN',
      message:
        'macOS cannot capture system audio on its own. Install a virtual audio device such as BlackHole (free), route your output through it, and select it here.',
    };
  }
  if (p === 'linux') {
    return {
      code: 'NO_LOOPBACK_LINUX',
      message:
        'No monitor source was found. PulseAudio or PipeWire normally exposes one per output — check that the audio server is running.',
    };
  }
  return {
    code: 'NO_LOOPBACK_WIN32',
    message: 'No playback device was found to capture. Check Windows Sound settings.',
  };
}

const api = { isLoopbackDevice, markLoopback, pickDefault, loopbackAdvice, MONITOR_RE, VIRTUAL_RE };
if (typeof module !== 'undefined' && module.exports) module.exports = api;
if (typeof window !== 'undefined') window.SVAudioDevices = api;
