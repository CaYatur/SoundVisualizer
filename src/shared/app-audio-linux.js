/*
 * SoundVisualizer — CaYaDev Ses Görselleştirici
 * Copyright (c) 2026 Çağan Turgut (CaYatur) — CaYaDev, https://cayadev.com
 * https://github.com/CaYatur/SoundVisualizer
 * SPDX-License-Identifier: MIT
 */
'use strict';
/* Linux'ta uygulama başına ses yakalama — saf kurallar.
 *
 * PulseAudio (ve PipeWire'ın pulse uyumluluk katmanı pipewire-pulse) her
 * uygulamanın çaldığı akışı ayrı bir "sink input" olarak gösteriyor. Tek bir
 * akışı, karıştırıcıya girmeden önce dinlemek için standart araç var:
 *
 *   parec --monitor-stream=<sink-input dizini>
 *
 * Yeni bir yerel bağımlılık yerine standart komut satırı araçlarını
 * (pactl, parec — pulseaudio-utils paketi) çalıştırıyoruz: Electron'un
 * ABI'sine bağlı bir eklenti her sürüm yükseltmesinde yeniden derlenmek
 * zorunda kalırdı.
 *
 * ÖLÇÜLDÜ (WSLg, PulseAudio 17.0, pactl 16.1): iki ayrı süreç 440 Hz (0,5) ve
 * 1000 Hz (0,2) çalarken birinci akışın izlemesinde 440 Hz genliği 0,500,
 * 1000 Hz genliği 0,0001 çıktı — süzme gerçek. İzleme akışı uygulamanın
 * ses düzeyinden SONRA alınıyor: akış %50'ye (kübik ölçek, 0,125) indirilince
 * genlik 0,0625'e düştü. Akış bitince parec "Entity killed" deyip 1 ile çıkıyor.
 *
 * Burası saf: pactl çıktısını ayrıştırma, hedef seçme, komut satırı kurma ve
 * akışları karıştırma. Kullanılabilirlik kararı üç platformla birlikte
 * src/shared/app-audio.js'te (support), süreç çalıştıran kısım
 * src/main/app-capture-linux.js'te.
 */
(function () {
  // Windows yardımcısıyla AYNI biçim: 48 kHz, stereo, float32, küçük endian
  const SAMPLE_RATE = 48000;
  const CHANNELS = 2;
  const BYTES_PER_FRAME = CHANNELS * 4;

  /* pactl ve parec metin çıktısı yerelleştiriliyor ("Sink Input #3" Türkçe
     sistemde başka bir şey oluyor). Ayrıştırıcı yalnızca C yerelini tanıyor;
     bu yüzden HER çağrı bu ortamla yapılmalı. */
  const C_LOCALE_ENV = { LC_ALL: 'C', LANG: 'C', LANGUAGE: '' };

  // ------------------------------------------------------------ ayrıştırma

  const baseName = (s) => String(s || '').split(/[\\/]/).pop().toLowerCase();

  /* pactl'nin özellik değeri kaçışları: \" ve \\ */
  function unescapeValue(v) {
    return String(v).replace(/\\(["\\])/g, '$1');
  }

  /* Ham kayıttan (JSON ya da metin) ortak akış nesnesi. */
  function toStream(index, props, corked, mute, sink, driver) {
    const p = props || {};
    const pid = parseInt(p['application.process.id'], 10) || 0;
    const binary = String(p['application.process.binary'] || '').trim();
    const appName = String(p['application.name'] || '').trim();
    return {
      index: Number(index),
      pid,
      binary,
      appName,
      mediaName: String(p['media.name'] || '').trim(),
      corked: !!corked,
      mute: !!mute,
      sink: Number(sink) >= 0 ? Number(sink) : -1,
      driver: String(driver || ''),
    };
  }

  /* `pactl -f json list sink-inputs` (pactl 16 ve üstü). Biçim yoksa ya da
     bozuksa null döner ki çağıran metin ayrıştırıcıya düşsün. */
  function parseSinkInputsJson(text) {
    let arr;
    try { arr = JSON.parse(String(text || '').trim() || 'null'); } catch { return null; }
    if (!Array.isArray(arr)) return null;
    const out = [];
    for (const r of arr) {
      if (!r || typeof r !== 'object' || !(Number(r.index) >= 0)) continue;
      out.push(toStream(r.index, r.properties, r.corked === true, r.mute === true, r.sink, r.driver));
    }
    return out;
  }

  /* `LC_ALL=C pactl list sink-inputs` — JSON'u olmayan eski pactl için
     (Ubuntu 22.04'te 15.99, Debian 11'de 14.2). */
  function parseSinkInputsText(text) {
    const out = [];
    let cur = null;
    let inProps = false;
    const flush = () => {
      if (cur) out.push(toStream(cur.index, cur.props, cur.corked, cur.mute, cur.sink, cur.driver));
      cur = null;
      inProps = false;
    };
    for (const raw of String(text || '').split(/\r?\n/)) {
      const head = /^Sink Input #(\d+)\s*$/.exec(raw);
      if (head) {
        flush();
        cur = { index: Number(head[1]), props: {}, corked: false, mute: false, sink: -1, driver: '' };
        continue;
      }
      if (!cur) continue;
      const line = raw.trim();
      if (!line) continue;
      if (/^Properties:$/.test(line)) { inProps = true; continue; }
      if (inProps && /^\t\t/.test(raw)) {
        const m = /^([^=\s]+)\s*=\s*"(.*)"$/.exec(line);
        if (m) cur.props[m[1]] = unescapeValue(m[2]);
        continue;
      }
      inProps = false;
      let m;
      if ((m = /^Corked:\s*(\S+)/.exec(line))) cur.corked = m[1] === 'yes';
      else if ((m = /^Mute:\s*(\S+)/.exec(line))) cur.mute = m[1] === 'yes';
      else if ((m = /^Sink:\s*(\d+)/.exec(line))) cur.sink = Number(m[1]);
      else if ((m = /^Driver:\s*(.+)$/.exec(line))) cur.driver = m[1];
    }
    flush();
    return out;
  }

  /* Önce JSON, olmazsa metin. Hangisinin geldiğini çağıran bilmek zorunda
     değil: JSON köşeli parantezle başlar, metin "Sink Input" ile. */
  function parseSinkInputs(text) {
    const t = String(text || '').trim();
    if (!t) return [];
    if (t[0] === '[') {
      const j = parseSinkInputsJson(t);
      if (j) return j;
    }
    return parseSinkInputsText(t);
  }

  /* Akışın kararlı adı: çalıştırılabilir dosyanın adı. Kimlik her açılışta
     değişiyor ve Flatpak içinde ad alanına göre veriliyor; kaydedilmiş bir
     hedef ancak adla yeniden bulunur. İkili adı bildirmeyen istemcilerde
     uygulamanın kendi verdiği ad kullanılıyor. */
  function streamName(s) {
    return (s && (s.binary || s.appName)) || '';
  }

  /* Ortak süreç biçimi — Windows yardımcısının --list çıktısıyla aynı:
     {pid, name, label, audible}. Bir süreç birden çok akış açabiliyor (iki
     sekmede çalan tarayıcı); listede SÜREÇ başına tek satır olmalı, yoksa
     arayüzdeki "N süreç" sayısı akış sayısını gösterirdi. Ses çalan tek bir
     akış süreci sesli sayar.

     Adı olmayan akış (ör. bir modülün açtığı döngü) hedeflenemez, listeye
     girmez; hariç tutma kipinde yine de karışıma girer. */
  function toProcesses(streams) {
    const byKey = new Map();
    for (const s of Array.isArray(streams) ? streams : []) {
      const name = streamName(s);
      if (!name) continue;
      const audible = !s.corked && !s.mute;
      const key = name + '\u0000' + (s.pid || ('#' + s.index));
      const prev = byKey.get(key);
      if (prev) {
        prev.audible = prev.audible || audible;
        continue;
      }
      byKey.set(key, { pid: s.pid || 0, name, label: s.appName || name, audible });
    }
    return Array.from(byKey.values());
  }

  // ------------------------------------------------------------ hedef seçme

  /* Akış hedef uygulamaya mı ait? Önce ad: tarayıcılar sesi ana süreçten
     değil bir alt süreçten çalıyor, ve Flatpak süreç kimliğini kum havuzu
     içinden bildiriyor. Ad verilmemişse kimlik. */
  function belongsTo(stream, target) {
    if (!stream || !target) return false;
    const want = baseName(target.match || target.name);
    if (want) {
      return baseName(stream.binary) === want || (!stream.binary && baseName(stream.appName) === want);
    }
    return Number(target.pid) > 0 && stream.pid === Number(target.pid);
  }

  /* Yakalanacak akış dizinleri.
       include: hedefin bütün akışları (bir uygulama birden çok açabilir)
       exclude: hedefinkiler DIŞINDAKİ bütün akışlar.
     Hariç tutma burada gerçekten uygulanıyor: sistemin karışımından bir
     şey çıkarmak yerine (zamanlaması tutmaz) geri kalan akışlar tek tek
     dinlenip toplanıyor. */
  function selectStreams(streams, target, mode) {
    const list = Array.isArray(streams) ? streams : [];
    const ex = mode === 'exclude';
    return list.filter((s) => belongsTo(s, target) !== ex).map((s) => s.index);
  }

  /* parec komut satırı. --raw: başlıksız ham PCM. Biçim, örnekleme hızı ve
     kanal sayısı AÇIKÇA veriliyor; sunucu dönüştürüyor (WSLg'de akış s16le
     44,1 kHz idi, bize float32 48 kHz geldi). */
  function parecArgs(index) {
    return [
      '--monitor-stream=' + Number(index),
      '--format=float32le',
      '--rate=' + SAMPLE_RATE,
      '--channels=' + CHANNELS,
      '--raw',
      '--latency-msec=20',
      '--client-name=CAYADEV Visualizer',
      '--stream-name=app-capture-' + Number(index),
    ];
  }

  /* `pactl subscribe` satırı: "Event 'new' on sink-input #12" */
  function parseSubscribeLine(line) {
    const m = /^Event '(\w+)' on ([\w-]+) #(\d+)/.exec(String(line || '').trim());
    if (!m) return null;
    return { event: m[1], facility: m[2], index: Number(m[3]) };
  }

  // -------------------------------------------------------------- karıştırma

  /* Birden çok akışı tek bir 48 kHz stereo float32 akışa toplar.

     Neden saat güdümlü: her parec kendi parçasını kendi zamanında veriyor
     (WSLg'de ~33 ms'lik parçalar). Gelen baytları sırayla yazmak akışları
     TOPLAMAZ, ard arda dizerdi. Bunun yerine her akışın kuyruğu tutuluyor
     ve saatin istediği kadar kare hepsinden aynı anda çekiliyor.

     Ön tampon: bir akış kuyruğu `prebuffer` kareye ulaşmadan karışıma
     girmiyor. Girmeseydi her parçadan hemen önce kuyruk boşalır, araya sıfır
     girer ve tayfta olmayan bir çatırtı görünürdü. Kuyruk boşalırsa yeniden
     doluncaya kadar bekliyor.

     Hiç akış yokken de sıfır çıkıyor: görselleştiricinin halkası son
     pencerede donup kalmasın, sessizliğe insin. */
  class PcmMixer {
    constructor(opts) {
      const o = opts || {};
      this.prebuffer = o.prebuffer > 0 ? o.prebuffer : 1920;   // 40 ms
      this.maxQueue = o.maxQueue > 0 ? o.maxQueue : 9600;      // 200 ms
      this.streams = new Map();
    }

    add(id) {
      if (!this.streams.has(id)) {
        this.streams.set(id, { chunks: [], frames: 0, primed: false, carry: null });
      }
    }

    remove(id) { this.streams.delete(id); }

    has(id) { return this.streams.has(id); }

    /* Ham bayt parçası. Parça kare sınırına düşmek zorunda değil; artan
       baytlar bir sonraki parçaya taşınıyor (bkz. loopback-helper'daki aynı
       gerekçe). */
    push(id, buf) {
      const s = this.streams.get(id);
      if (!s || !buf || !buf.length) return;
      let b = s.carry ? Buffer.concat([s.carry, buf]) : buf;
      const whole = Math.floor(b.length / BYTES_PER_FRAME) * BYTES_PER_FRAME;
      s.carry = whole < b.length ? Buffer.from(b.subarray(whole)) : null;
      if (!whole) return;
      b = b.subarray(0, whole);
      const n = whole / BYTES_PER_FRAME;
      const f = new Float32Array(n * CHANNELS);
      for (let i = 0; i < f.length; i++) f[i] = b.readFloatLE(i * 4);
      s.chunks.push(f);
      s.frames += n;
      // Kuyruk şişerse en eskiyi at: gecikme sınırlı kalsın
      while (s.frames > this.maxQueue && s.chunks.length > 1) {
        s.frames -= s.chunks.shift().length / CHANNELS;
      }
      if (s.frames >= this.prebuffer) s.primed = true;
    }

    /* `frames` kare karıştırır ve ham bayt olarak döndürür. */
    pull(frames) {
      const n = Math.max(0, frames | 0);
      const out = new Float32Array(n * CHANNELS);
      for (const s of this.streams.values()) {
        if (!s.primed) continue;
        let w = 0;
        const want = n * CHANNELS;
        while (w < want && s.chunks.length) {
          const c = s.chunks[0];
          const take = Math.min(c.length, want - w);
          for (let i = 0; i < take; i++) out[w + i] += c[i];
          w += take;
          if (take === c.length) s.chunks.shift();
          else s.chunks[0] = c.subarray(take);
        }
        s.frames -= w / CHANNELS;
        if (s.frames <= 0) { s.frames = 0; s.primed = false; }
      }
      const buf = Buffer.alloc(n * BYTES_PER_FRAME);
      for (let i = 0; i < out.length; i++) buf.writeFloatLE(out[i], i * 4);
      return buf;
    }
  }

  const api = {
    SAMPLE_RATE, CHANNELS, BYTES_PER_FRAME, C_LOCALE_ENV,
    parseSinkInputsJson, parseSinkInputsText, parseSinkInputs,
    streamName, toProcesses, belongsTo, selectStreams, parecArgs,
    parseSubscribeLine, PcmMixer,
  };

  // Yalnızca Node'da kullanılıyor (karıştırıcı Buffer istiyor)
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})();
