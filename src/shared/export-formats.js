/*
 * SoundVisualizer — CaYaDev Ses Görselleştirici
 * Copyright (c) 2026 Çağan Turgut (CaYatur) — CaYaDev, https://cayadev.com
 * https://github.com/CaYatur/SoundVisualizer
 * SPDX-License-Identifier: MIT
 */
'use strict';
/* Dışa aktarma biçimleri ve kodlayıcılar — VERİ (#521).

   Biçim listesi kodda dağınık değil, burada tek tabloda. Panel seçenekleri,
   MCP şeması, yol denetimi ve ffmpeg argümanları buradan türetiliyor; yeni
   bir kodlayıcı eklemek arayüze dokunmayı gerektirmiyor.

   Tablo neyi İSTEDİĞİMİZİ söylüyor, makinenin neyi YAPABİLDİĞİNİ değil.
   ffmpeg-static her işletim sisteminde farklı bir ikili getiriyor ve bir
   donanım kodlayıcısının listede olması çalıştığı anlamına gelmiyor (sürücü,
   GPU). Hangi kodlayıcının çalıştığını ana süreç bu modülün ürettiği
   argümanların AYNISIYLA kısa bir deneme kodlamasıyla ölçüyor (`probeArgs`):
   argümanlarda bir hata varsa o kodlayıcı hiç sunulmuyor.

   Burası saf bir modül: düğüm ya da tarayıcı API'si kullanmıyor ki
   kodlayıcısı bu makinede olmayan biçimler de sınanabilsin. */
(function () {
  /* Çözünürlükler. Dikey ve kare, kısa video platformları için. */
  const RESOLUTIONS = {
    '720p': [1280, 720],
    '1080p': [1920, 1080],
    '1440p': [2560, 1440],
    '2160p': [3840, 2160],
    '1080x1920': [1080, 1920],
    '1080x1080': [1080, 1080],
  };
  const FPS = [24, 25, 30, 50, 60];
  const QUALITIES = ['visually-lossless', 'high', 'balanced'];
  const SPEEDS = ['fast', 'balanced', 'quality'];

  /* Kodlayıcı aileleri. `gpu` olanlar yalnız deneme kodlaması geçerse
     sunulur; sıra, aynı kodek için GPU tercih sırasıdır. */
  const ENCODERS = {
    libx264: { codec: 'h264', gpu: false, label: 'CPU — x264' },
    h264_nvenc: { codec: 'h264', gpu: true, label: 'NVIDIA NVENC' },
    /* AMF zorunlu anahtar kareyi yok sayıyor (ölçüldü: işaretçilerde
       kesilmedi, tek dosya çıktı); bölümlemede seçilmiyor (#527). */
    h264_amf: { codec: 'h264', gpu: true, label: 'AMD AMF', noForcedKeys: true },
    h264_qsv: { codec: 'h264', gpu: true, label: 'Intel Quick Sync' },
    libx265: { codec: 'hevc', gpu: false, label: 'CPU — x265' },
    hevc_nvenc: { codec: 'hevc', gpu: true, label: 'NVIDIA NVENC' },
    hevc_amf: { codec: 'hevc', gpu: true, label: 'AMD AMF', noForcedKeys: true },
    hevc_qsv: { codec: 'hevc', gpu: true, label: 'Intel Quick Sync' },
    prores_ks: { codec: 'prores', gpu: false, label: 'ProRes' },
    dnxhd: { codec: 'dnxhr', gpu: false, label: 'DNxHR' },
    'libvpx-vp9': { codec: 'vp9', gpu: false, label: 'VP9' },
    gif: { codec: 'gif', gpu: false, label: 'GIF' },
    apng: { codec: 'apng', gpu: false, label: 'APNG' },
    png: { codec: 'png', gpu: false, label: 'PNG' },
    exr: { codec: 'exr', gpu: false, label: 'OpenEXR' },
  };

  /* Biçimler.
       ext      dosya uzantısı (kare dizisinde her karenin uzantısı)
       kind     'video' | 'anim' (sesiz kısa döngü) | 'sequence' (kare dizisi)
       codec    ENCODERS içindeki aile
       alpha    saydamlık taşıyor mu (#525)
       audio    ses kuralı: 'mp4' | 'pcm' | 'opus' | null (sessiz)
       fpsMax   bu biçimde anlamlı en yüksek kare hızı
       label    [tr, en] */
  const FORMATS = [
    { id: 'mp4-h264', ext: 'mp4', kind: 'video', codec: 'h264', alpha: false, audio: 'mp4',
      label: ['MP4 — H.264 (her yerde oynar)', 'MP4 — H.264 (plays everywhere)'] },
    { id: 'mp4-hevc', ext: 'mp4', kind: 'video', codec: 'hevc', alpha: false, audio: 'mp4',
      label: ['MP4 — H.265/HEVC (yarı boyut)', 'MP4 — H.265/HEVC (half the size)'] },
    { id: 'mov-prores', ext: 'mov', kind: 'video', codec: 'prores', alpha: false, audio: 'pcm',
      label: ['MOV — ProRes 422 HQ (kurgu için)', 'MOV — ProRes 422 HQ (for editing)'] },
    { id: 'mov-prores4444', ext: 'mov', kind: 'video', codec: 'prores', alpha: true, audio: 'pcm',
      label: ['MOV — ProRes 4444 + alfa (bindirme)', 'MOV — ProRes 4444 + alpha (overlay)'] },
    { id: 'mov-dnxhr', ext: 'mov', kind: 'video', codec: 'dnxhr', alpha: false, audio: 'pcm',
      label: ['MOV — DNxHR HQ (kurgu için)', 'MOV — DNxHR HQ (for editing)'] },
    { id: 'webm-vp9', ext: 'webm', kind: 'video', codec: 'vp9', alpha: false, audio: 'opus',
      label: ['WebM — VP9', 'WebM — VP9'] },
    { id: 'webm-vp9-alpha', ext: 'webm', kind: 'video', codec: 'vp9', alpha: true, audio: 'opus',
      label: ['WebM — VP9 + alfa (bindirme)', 'WebM — VP9 + alpha (overlay)'] },
    { id: 'gif', ext: 'gif', kind: 'anim', codec: 'gif', alpha: false, audio: null, fpsMax: 30,
      label: ['GIF — kısa döngü', 'GIF — short loop'] },
    { id: 'apng', ext: 'png', kind: 'anim', codec: 'apng', alpha: true, audio: null, fpsMax: 30,
      label: ['APNG — kısa döngü, alfa', 'APNG — short loop, alpha'] },
    { id: 'png-seq', ext: 'png', kind: 'sequence', codec: 'png', alpha: true, audio: null,
      label: ['PNG kare dizisi (kayıpsız, alfa)', 'PNG frame sequence (lossless, alpha)'] },
    { id: 'exr-seq', ext: 'exr', kind: 'sequence', codec: 'exr', alpha: true, audio: null,
      label: ['OpenEXR kare dizisi (doğrusal, alfa)', 'OpenEXR frame sequence (linear, alpha)'] },
  ];
  const DEFAULT_FORMAT = 'mp4-h264';

  function format(id) {
    for (let i = 0; i < FORMATS.length; i++) if (FORMATS[i].id === id) return FORMATS[i];
    return null;
  }

  /* Dosya yolu denetimi için her biçimin uzantısı; tekrarsız. */
  function extensions() {
    const out = [];
    for (let i = 0; i < FORMATS.length; i++) if (out.indexOf(FORMATS[i].ext) < 0) out.push(FORMATS[i].ext);
    return out;
  }

  /* Kalite kademeleri, aileye göre. Sayılar sabit niceleyici/CRF; küçük
     sayı daha yüksek kalite. H.264 değerleri eski tablodan aynen. */
  const QUANT = {
    libx264: { 'visually-lossless': 14, high: 18, balanced: 22 },
    h264_nvenc: { 'visually-lossless': 16, high: 20, balanced: 25 },
    h264_amf: { 'visually-lossless': 16, high: 20, balanced: 25 },
    h264_qsv: { 'visually-lossless': 16, high: 20, balanced: 25 },
    libx265: { 'visually-lossless': 16, high: 20, balanced: 24 },
    hevc_nvenc: { 'visually-lossless': 18, high: 22, balanced: 27 },
    hevc_amf: { 'visually-lossless': 18, high: 22, balanced: 27 },
    hevc_qsv: { 'visually-lossless': 18, high: 22, balanced: 27 },
    'libvpx-vp9': { 'visually-lossless': 15, high: 24, balanced: 32 },
  };
  function quant(enc, quality) {
    const t = QUANT[enc];
    if (!t) return null;
    return t[quality] != null ? t[quality] : t['visually-lossless'];
  }

  // NVENC: p1 en hızlı … p7 en yavaş (eski tablodan aynen)
  const NVENC_SPEED = {
    fast: ['-preset', 'p2', '-tune', 'ull', '-rc-lookahead', '0', '-bf', '0'],
    balanced: ['-preset', 'p4', '-tune', 'hq', '-rc-lookahead', '8', '-bf', '2'],
    quality: ['-preset', 'p6', '-tune', 'hq', '-rc-lookahead', '20', '-bf', '3', '-multipass', 'qres'],
  };
  const X26X_SPEED = { fast: 'veryfast', balanced: 'medium', quality: 'slow' };
  const AMF_SPEED = { fast: 'speed', balanced: 'balanced', quality: 'quality' };
  const QSV_SPEED = { fast: 'veryfast', balanced: 'medium', quality: 'veryslow' };
  // VP9: cpu-used büyüdükçe hızlı
  const VP9_SPEED = { fast: '5', balanced: '3', quality: '1' };

  /* Renk. Tarayıcı sRGB çiziyor; YUV'a BT.709 matrisi ve sınırlı aralıkla
     çevrilip dosyaya da öyle yazılıyor. Etiket olmayınca ffmpeg HD görüntüyü
     BT.601'le çeviriyor, oynatıcılar ise HD'yi BT.709 sayıyor: renkler
     kayıyordu (kırmızı turuncuya, yeşil sarıya). */
  const BT709_TAGS = ['-colorspace', 'bt709', '-color_primaries', 'bt709', '-color_trc', 'bt709', '-color_range', 'tv'];
  function yuvFilter(pix) {
    return 'scale=out_color_matrix=bt709:out_range=tv,format=' + pix;
  }

  /* Bir kodlayıcının video argümanları ve süzgeci.
     Dönen: { args: [...], vf: 'süzgeç' | null, tags: bool } */
  function videoArgs(fmt, enc, quality, speed) {
    const q = quant(enc, quality);
    const sp = SPEEDS.indexOf(speed) >= 0 ? speed : 'balanced';
    switch (enc) {
      case 'libx264':
        return { args: ['-c:v', 'libx264', '-preset', X26X_SPEED[sp], '-crf', String(q), '-threads', '0'],
          vf: yuvFilter('yuv420p'), tags: true };
      case 'libx265':
        // -tag:v hvc1: Apple oynatıcıları hev1 etiketli HEVC'yi açmıyor
        return { args: ['-c:v', 'libx265', '-preset', X26X_SPEED[sp], '-crf', String(q), '-tag:v', 'hvc1',
          '-x265-params', 'log-level=error'], vf: yuvFilter('yuv420p'), tags: true };
      case 'h264_nvenc':
      case 'hevc_nvenc':
        return { args: ['-c:v', enc].concat(NVENC_SPEED[sp], ['-rc', 'vbr', '-cq', String(q), '-b:v', '0'],
          enc === 'h264_nvenc' ? ['-profile:v', 'high'] : ['-tag:v', 'hvc1']),
        vf: yuvFilter('yuv420p'), tags: true };
      case 'h264_amf':
      case 'hevc_amf':
        return { args: ['-c:v', enc, '-usage', 'transcoding', '-quality', AMF_SPEED[sp], '-rc', 'cqp',
          '-qp_i', String(q), '-qp_p', String(q)].concat(enc === 'h264_amf' ? ['-qp_b', String(q)] : ['-tag:v', 'hvc1']),
        vf: yuvFilter('yuv420p'), tags: true };
      case 'h264_qsv':
      case 'hevc_qsv':
        // QSV yalnız nv12 alıyor
        return { args: ['-c:v', enc, '-preset', QSV_SPEED[sp], '-global_quality', String(q)]
          .concat(enc === 'hevc_qsv' ? ['-tag:v', 'hvc1'] : []), vf: yuvFilter('nv12'), tags: true };
      case 'prores_ks':
        if (fmt.alpha) {
          return { args: ['-c:v', 'prores_ks', '-profile:v', '4', '-vendor', 'apl0', '-alpha_bits', '16'],
            vf: yuvFilter('yuva444p10le'), tags: true };
        }
        // 3 = 422 HQ, 2 = 422; kalite "dengeli" ise küçük olanı
        return { args: ['-c:v', 'prores_ks', '-profile:v', quality === 'balanced' ? '2' : '3', '-vendor', 'apl0'],
          vf: yuvFilter('yuv422p10le'), tags: true };
      case 'dnxhd':
        return { args: ['-c:v', 'dnxhd', '-profile:v', quality === 'balanced' ? 'dnxhr_sq' : 'dnxhr_hq'],
          vf: yuvFilter('yuv422p'), tags: true };
      case 'libvpx-vp9':
        /* Alfa: yuva420p. auto-alt-ref alfa ile birlikte çalışmıyor; tek
           geçişte zaten kapalı ama açıkça yazılıyor. */
        return { args: ['-c:v', 'libvpx-vp9', '-crf', String(q), '-b:v', '0', '-deadline', 'good',
          '-cpu-used', VP9_SPEED[sp], '-row-mt', '1', '-tile-columns', '2', '-auto-alt-ref', '0'],
        vf: yuvFilter(fmt.alpha ? 'yuva420p' : 'yuv420p'), tags: true };
      case 'gif':
        /* İki aşamalı palet: önce sahneye özel palet, sonra o paletle
           kodlama. Tek geçişte sonuç gözle görülür biçimde bantlanıyor.
           Süzgeç grafiği karmaşık olduğu için ayrı alanda dönüyor. */
        return { args: ['-loop', '0'], vf: null, complex:
          'split[a][b];[a]palettegen=stats_mode=diff[p];[b][p]paletteuse=dither=' +
          (quality === 'balanced' ? 'bayer:bayer_scale=3' : 'sierra2_4a') + ':diff_mode=rectangle', tags: false };
      case 'apng':
        return { args: ['-c:v', 'apng', '-plays', '0', '-pred', sp === 'fast' ? 'none' : 'mixed'],
          vf: 'format=rgba', tags: false };
      case 'png':
        return { args: ['-c:v', 'png', '-pred', sp === 'fast' ? 'none' : 'mixed'], vf: 'format=rgba', tags: false };
      case 'exr':
        /* EXR doğrusal ışık bekliyor: sRGB eğrisi açılıyor, yarım duyarlı
           kayan nokta, ZIP1 sıkıştırma (kayıpsız).

           Renk ve alfa AYRI yoldan geçiyor. Ölçüldü (320x240, her piksel,
           sRGB formülüne göre):
             zscale tek başına          renk 0,00013   alfa 0,091 (sınırlı aralık sanıyor)
             swscale ile kayan noktaya  renk 0,0042    alfa 0,0005
             ayrı yollar (bu)           renk 0,00013   alfa 0 */
        return { args: ['-c:v', 'exr', '-format', 'half', '-compression', 'zip1'], vf: null, complex:
          'split[c][a];[c]zscale=tin=iec61966-2-1:t=linear,format=gbrpf32le[l];' +
          '[a]alphaextract,format=grayf32le[al];[l][al]mergeplanes=0x00010210:gbrapf32le', tags: false };
      default:
        return null;
    }
  }

  /* Kare GPU'da I420'ye çevrilip gönderilebilir mi (#531)? Yalnız 8 bit
     4:2:0 hedefler: H.264, H.265, alfasız VP9. ffmpeg'in BT.709 dönüşümünü
     GPU yapıyor; QSV'ye yine nv12 sırası gerekiyor (kayıpsız yer değiştirme).
     Alfa, 4:2:2/4:4:4, paletli GIF ve kare dizileri RGBA kalıyor. */
  function takesYuv420(fmt, enc) {
    const v = videoArgs(fmt, enc, 'high', 'balanced');
    return !!v && (v.vf === yuvFilter('yuv420p') || v.vf === yuvFilter('nv12'));
  }

  /* Ses kuralı, kaba göre. Kaynak dosya mp4'e uygunsa kopyalanıyor; ama
     video sesten uzunsa ses sessizlikle doldurulacak (apad) ve kopyalanan
     akışa süzgeç uygulanamıyor, o zaman yeniden kodlanıyor. */
  function audioArgs(fmt, audioExt, pad) {
    if (!fmt.audio) return null;
    const ext = String(audioExt || '').toLowerCase().replace(/^\./, '');
    if (fmt.audio === 'mp4') {
      return !pad && ['mp3', 'm4a', 'aac'].indexOf(ext) >= 0 ? ['-c:a', 'copy'] : ['-c:a', 'aac', '-b:a', '320k'];
    }
    if (fmt.audio === 'pcm') return ['-c:a', 'pcm_s24le'];
    if (fmt.audio === 'opus') return ['-c:a', 'libopus', '-b:a', '256k'];
    return null;
  }

  /* Bir biçim için uygun kodlayıcılar, tercih sırasıyla. `want` 'gpu' ya
     da 'cpu'; `ok(enc)` bu makinede çalışıyor mu. GPU istendi ama hiçbiri
     çalışmıyorsa CPU kodlayıcısı dönüyor. */
  const ORDER = ['h264_nvenc', 'h264_amf', 'h264_qsv', 'libx264', 'hevc_nvenc', 'hevc_amf', 'hevc_qsv', 'libx265',
    'prores_ks', 'dnxhd', 'libvpx-vp9', 'gif', 'apng', 'png', 'exr'];
  function encodersFor(fmt) {
    return ORDER.filter(function (e) { return ENCODERS[e].codec === fmt.codec; });
  }
  function pickEncoder(fmt, want, ok, needs) {
    const list = encodersFor(fmt);
    const okFn = typeof ok === 'function' ? ok : function () { return true; };
    const forced = !!(needs && needs.forcedKeys);
    const can = function (e) { return okFn(e) && !(forced && ENCODERS[e].noForcedKeys); };
    if (want === 'gpu') {
      for (let i = 0; i < list.length; i++) if (ENCODERS[list[i]].gpu && can(list[i])) return list[i];
    }
    for (let i = 0; i < list.length; i++) if (!ENCODERS[list[i]].gpu && can(list[i])) return list[i];
    return null;
  }

  /* Biçim bu makinede kullanılabilir mi: en az bir CPU kodlayıcısı çalışmalı. */
  function available(fmt, ok) {
    return !!pickEncoder(fmt, 'cpu', ok);
  }

  /* Kare dizisinin çıktı deseni. ffmpeg'in image2 yazıcısı %d'yi kare
     numarası sayıyor; yoldaki gerçek % işaretleri ikilenmeli. */
  function sequencePattern(dir, stem, ext) {
    const safe = (String(dir) + '/' + String(stem)).replace(/%/g, '%%');
    return safe + '_%06d.' + ext;
  }

  /* Tam ffmpeg komut satırı. Girdi her zaman stdin'den ham RGBA.
     o: { fmt, encoder, w, h, fps, quality, speed, audioPath, audioExt,
          output, meta: {title, ...} } */
  function buildArgs(o) {
    const fmt = o.fmt;
    const v = videoArgs(fmt, o.encoder, o.quality, o.speed);
    if (!v) return null;
    const args = ['-y'];
    /* Süzgeç iş parçacıkları: renk dönüşümü dilimlere bölünüyor. Ölçüldü
       (#531): 1080p'de dönüşüm yaklaşık iki kat hızlı, kareler birebir
       aynı (framemd5; yuv420p, yuv422p10le, yuva444p10le). */
    if (o.threads > 1) args.push('-filter_threads', String(o.threads));
    // Girdi: ham RGBA ya da GPU'nun çevirdiği I420 (o.inputPix)
    const yuvIn = o.inputPix === 'yuv420p' && takesYuv420(fmt, o.encoder);
    if (yuvIn) v.vf = v.vf === yuvFilter('nv12') ? 'format=nv12' : null;
    args.push(
      '-f', 'rawvideo',
      '-pixel_format', yuvIn ? 'yuv420p' : 'rgba',
      '-video_size', o.w + 'x' + o.h,
      '-framerate', String(o.fps),
      '-thread_queue_size', '1024', // ham kare girişi için geniş kuyruk
      '-i', 'pipe:0',
    );
    /* Süre (#523): verilmişse video ve ses tam o kadar. Ses kısaysa
       sessizlikle dolar, uzunsa kesilir; verilmemişse eski kural (-shortest,
       sesin süresi). */
    const dur = Number(o.durationSec) > 0 ? Number(o.durationSec) : 0;
    const pad = dur > 0 && Number(o.audioSec) > 0 && dur > Number(o.audioSec) + 0.001;
    const aArgs = o.audioPath ? audioArgs(fmt, o.audioExt, pad) : null;
    if (aArgs) args.push('-i', o.audioPath);
    if (v.complex) {
      args.push('-filter_complex', '[0:v]' + v.complex + '[v]', '-map', '[v]');
    } else {
      if (v.vf) args.push('-vf', v.vf);
      args.push('-map', '0:v:0');
    }
    if (aArgs) args.push('-map', '1:a:0');
    args.push.apply(args, v.args);
    /* Bölümler (#527): kesim anlarında zorunlu anahtar kare. NVENC ve QSV
       bunu IDR yapmazsa bölüm bir önceki dosyaya bağımlı başlar. */
    const cuts = Array.isArray(o.chapters) && o.chapters.length && fmt.kind === 'video' ? o.chapters : null;
    const cutList = cuts ? cuts.map((t) => Number(t).toFixed(6)).join(',') : '';
    /* Yazıcının kesim zamanı YARIM KARE ÖNCE: kesim, o andan sonraki ilk
       anahtar karede yapılıyor ve tam zamanda verilince paket zamanı bir
       tık altında kalan kare atlanıyordu (x264, 3 yerine 2 bölüm).
       Ölçüldü: x264, NVENC, x265, VP9, ProRes'te bölümler 60/45/45 kare. */
    const half = 0.5 / (Number(o.fps) > 0 ? Number(o.fps) : 30);
    const segList = cuts ? cuts.map((t) => Math.max(0, Number(t) - half).toFixed(6)).join(',') : '';
    if (cuts) {
      args.push('-force_key_frames', cutList);
      if (/_nvenc$/.test(o.encoder)) args.push('-forced-idr', '1');
      if (/_qsv$/.test(o.encoder)) args.push('-forced_idr', '1');
    }
    if (v.tags) args.push.apply(args, BT709_TAGS);
    if (aArgs) {
      if (pad) args.push('-af', 'apad');
      args.push.apply(args, aArgs);
    } else {
      args.push('-an');
    }
    const meta = o.meta || {};
    if (fmt.kind !== 'sequence') {
      /* Sahne adı ve BPM açıklama alanına (#528): mp4 ve mov yazıcısı özel
         anahtar yazmıyor, `comment` her kapta okunuyor. */
      const extra = [];
      if (meta.scene) extra.push('Scene: ' + meta.scene);
      if (Number(meta.bpm) > 0) extra.push('BPM: ' + Math.round(Number(meta.bpm) * 100) / 100);
      const fields = Object.assign({}, meta, { comment: [meta.comment].concat(extra).filter(Boolean).join(' · ') });
      for (const k of ['title', 'artist', 'album', 'comment']) {
        if (fields[k]) args.push('-metadata', k + '=' + String(fields[k]).replace(/[\r\n]+/g, ' ').slice(0, 512));
      }
    }
    if (!cuts && (fmt.ext === 'mp4' || fmt.ext === 'mov')) args.push('-movflags', '+faststart');
    if (dur > 0) args.push('-t', dur.toFixed(6));
    else if (aArgs) args.push('-shortest');
    if (fmt.kind === 'sequence') args.push('-f', 'image2', '-start_number', '1');
    if (cuts) {
      args.push('-f', 'segment', '-segment_times', segList, '-reset_timestamps', '1',
        '-segment_format', fmt.ext, '-segment_start_number', '1');
      if (fmt.ext === 'mp4' || fmt.ext === 'mov') args.push('-segment_format_options', 'movflags=+faststart');
    }
    if (fmt.id === 'apng') args.push('-f', 'apng');
    args.push(o.output);
    return args;
  }

  /* Bir kodlayıcının bu makinede çalıştığını ölçen kısa deneme. Gerçek
     işin argümanlarının AYNISI kullanılıyor; yalnız girdi bir test deseni ve
     çıktı boş. */
  function probeArgs(enc) {
    const fmt = FORMATS.filter(function (f) { return f.codec === ENCODERS[enc].codec; })[0];
    if (!fmt) return null;
    const v = videoArgs(fmt, enc, 'balanced', 'fast');
    if (!v) return null;
    const args = ['-hide_banner', '-loglevel', 'error',
      '-f', 'lavfi', '-i', 'testsrc2=size=256x256:rate=30:duration=0.5,format=rgba'];
    if (v.complex) args.push('-filter_complex', '[0:v]' + v.complex + '[v]', '-map', '[v]');
    else if (v.vf) args.push('-vf', v.vf);
    args.push.apply(args, v.args);
    args.push('-f', fmt.kind === 'sequence' ? 'image2pipe' : (fmt.id === 'apng' ? 'apng' : 'null'), '-');
    return args;
  }

  // ---------------------------------------------------------- profiller (#522)

  /* Tek tıkla ayar. Her profil biçimi, çözünürlüğü, kare hızını ve kaliteyi
     sabitliyor; renk her biçimde zaten BT.709. Kodlayıcı (GPU/CPU) ve hız
     dengesi kullanıcının tercihi olarak kalıyor. Ayrıntılı ayarlar profilin
     altında duruyor: bir alan değişince seçim kendiliğinden "Özel" oluyor. */
  const PROFILES = [
    { id: 'youtube-1080p60', label: ['YouTube 1080p60', 'YouTube 1080p60'],
      set: { format: 'mp4-h264', resolution: '1080p', fps: 60, quality: 'high' } },
    { id: 'youtube-4k60', label: ['YouTube 4K60 (H.265)', 'YouTube 4K60 (H.265)'],
      set: { format: 'mp4-hevc', resolution: '2160p', fps: 60, quality: 'high' } },
    { id: 'reels-shorts', label: ['Reels / Shorts / TikTok — 1080×1920', 'Reels / Shorts / TikTok — 1080×1920'],
      set: { format: 'mp4-h264', resolution: '1080x1920', fps: 30, quality: 'high' } },
    { id: 'instagram-square', label: ['Instagram kare — 1080×1080', 'Instagram square — 1080×1080'],
      set: { format: 'mp4-h264', resolution: '1080x1080', fps: 30, quality: 'high' } },
    { id: 'twitch-overlay', label: ['Twitch / OBS bindirme — WebM alfa', 'Twitch / OBS overlay — WebM alpha'],
      set: { format: 'webm-vp9-alpha', resolution: '1080p', fps: 60, quality: 'high' } },
    { id: 'master-4k', label: ['Ana kopya 4K — ProRes 422 HQ', 'Master 4K — ProRes 422 HQ'],
      set: { format: 'mov-prores', resolution: '2160p', fps: 60, quality: 'visually-lossless' } },
    { id: 'gif-loop', label: ['GIF döngü — 720p', 'GIF loop — 720p'],
      set: { format: 'gif', resolution: '720p', fps: 24, quality: 'high' } },
  ];

  function profile(id) {
    for (let i = 0; i < PROFILES.length; i++) if (PROFILES[i].id === id) return PROFILES[i];
    return null;
  }

  /* Şu anki ayarlara birebir uyan profil, yoksa 'custom'. */
  function matchProfile(exp) {
    const e = exp || {};
    for (const p of PROFILES) {
      if (Object.keys(p.set).every((k) => String(e[k]) === String(p.set[k]))) return p.id;
    }
    return 'custom';
  }

  /* Profili ayarlara uygular (yeni nesne); bilinmeyen profilde aynı ayar. */
  function applyProfile(exp, id) {
    const p = profile(id);
    return Object.assign({}, exp || {}, p ? p.set : {});
  }

  // ----------------------------------------------------------- bölümler (#527)

  /* Zaman çizelgesi işaretçilerinden bölüm planı. Kesimler kare sınırına
     yuvarlanıyor; 0'daki ya da son karedeki işaretçi kesim değil (ilk
     işaretçi 0'daysa ilk bölüm onun adını alıyor), aynı kareye düşenler
     tekleniyor. Bölüm k, k'inci kesimden bir sonrakine kadar sürüyor.
     markers: [{ t, name }]. Dönen: { cuts: [s…], names: [ad…] } —
     names.length === cuts.length + 1. */
  function chapterPlan(markers, durationSec, fps, firstName) {
    const f = Number(fps) > 0 ? Number(fps) : 30;
    const end = Math.round((Number(durationSec) || 0) * f);
    const list = (Array.isArray(markers) ? markers : [])
      .map((m) => ({ frame: Math.round((Number(m && m.t) || 0) * f), name: String((m && m.name) || '').trim() }))
      .filter((m) => m.frame >= 0 && m.frame < end)
      .sort((a, b) => a.frame - b.frame);
    const cuts = [];
    const names = [];
    const atZero = list.find((m) => m.frame === 0);
    names.push(atZero && atZero.name ? atZero.name : String(firstName || ''));
    for (const m of list) {
      if (m.frame === 0) continue;
      if (cuts.length && Math.round(cuts[cuts.length - 1] * f) === m.frame) {
        if (m.name && !names[names.length - 1]) names[names.length - 1] = m.name;
        continue;
      }
      cuts.push(m.frame / f);
      names.push(m.name);
    }
    return { cuts, names };
  }

  /* Bölüm dosyasının adı: "01 - Nakarat.mp4". Adsız işaretçi "Bölüm N". */
  function chapterFileName(index, name, ext, fallbackWord) {
    const n = String(index + 1).padStart(2, '0');
    const label = sanitizeFileName(name, (fallbackWord || 'Chapter') + ' ' + (index + 1));
    return n + ' - ' + label + '.' + ext;
  }

  // ------------------------------------------- YouTube bölüm listesi (#837)

  /* "1:23", saat varsa "1:02:03". YouTube tam saniye okuyor: aşağı yuvarla. */
  function chapterStamp(sec, long) {
    const s = Math.max(0, Math.floor(Number(sec) || 0));
    const pad = (n) => String(n).padStart(2, '0');
    const h = Math.floor(s / 3600);
    const m = Math.floor((s % 3600) / 60);
    return long ? h + ':' + pad(m) + ':' + pad(s % 60) : (h * 60 + m) + ':' + pad(s % 60);
  }

  /* Zaman çizelgesi işaretçilerinden video açıklamasına yapıştırılacak bölüm
     listesi: "0:00 Başlangıç", "1:23 Drop". YouTube listeyi yalnız ilk satır
     0:00 olduğunda, en az üç bölüm varsa ve her bölüm en az 10 saniye
     sürdüğünde bölüm olarak tanıyor. Liste yine üretiliyor; tutmayan kural
     `problems` içinde koduyla dönüyor ki panel nedenini söyleyebilsin:
     'FEW' (üçten az bölüm), 'SHORT' (10 saniyeden kısa bölüm; `short` hangi
     sıradakiler olduğunu veriyor). 0'da işaretçi yoksa ilk satır
     `words.first` adıyla ekleniyor; adsız işaretçi "<words.chapter> N".
     Süre verilirse ondan sonraki işaretçiler atlanıyor ve son bölüm de
     ölçülüyor. Dönen: { text, rows: [{ t, name }], problems, short }. */
  function youtubeChapters(markers, durationSec, words) {
    const w = words || {};
    const dur = Math.max(0, Number(durationSec) || 0);
    const list = (Array.isArray(markers) ? markers : [])
      .map((m) => ({ t: Math.floor(Number(m && m.t) || 0), name: String((m && m.name) || '').trim() }))
      .filter((m) => m.t >= 0 && (!(dur > 0) || m.t < Math.floor(dur)))
      .sort((a, b) => a.t - b.t);
    const rows = [];
    for (const m of list) {
      const last = rows[rows.length - 1];
      if (last && last.t === m.t) {
        if (!last.name && m.name) last.name = m.name;
        continue;
      }
      rows.push({ t: m.t, name: m.name });
    }
    if (!rows.length || rows[0].t !== 0) rows.unshift({ t: 0, name: String(w.first || '') });
    rows.forEach((r, i) => { if (!r.name) r.name = i === 0 && w.first ? String(w.first) : (w.chapter || 'Chapter') + ' ' + (i + 1); });
    const short = [];
    rows.forEach((r, i) => {
      const end = i + 1 < rows.length ? rows[i + 1].t : (dur > 0 ? Math.floor(dur) : Infinity);
      if (end - r.t < 10) short.push(i);
    });
    const problems = [];
    if (rows.length < 3) problems.push('FEW');
    if (short.length) problems.push('SHORT');
    const long = Math.max(dur, rows[rows.length - 1].t) >= 3600;
    const text = rows.map((r) => chapterStamp(r.t, long) + ' ' + r.name).join('\n');
    return { text, rows, problems, short };
  }

  // ------------------------------------------------------------ süre (#523)

  const DURATION_MODES = ['audio', 'seconds', 'timeline', 'bars'];
  const MAX_SECONDS = 4 * 3600;

  /* Dışa aktarımın süresi, saniye. spec: { mode, seconds, bars, bpm }.
     ctx: { audioSec, timelineSec, barsToSeconds(n) } — çağıran ölçer.
     Dönen: { ok, mode, seconds } ya da { ok: false, code }. */
  function resolveDuration(spec, ctx) {
    const sp = spec || {};
    const c = ctx || {};
    const mode = DURATION_MODES.indexOf(sp.mode) >= 0 ? sp.mode : 'audio';
    let sec = 0;
    if (mode === 'audio') sec = Number(c.audioSec) || 0;
    else if (mode === 'seconds') sec = Number(sp.seconds) || 0;
    else if (mode === 'timeline') {
      sec = Number(c.timelineSec) || 0;
      if (!(sec > 0)) return { ok: false, code: 'TIMELINE_EMPTY' };
    } else if (mode === 'bars') {
      const n = Math.round(Number(sp.bars) || 0);
      if (!(n > 0) || typeof c.barsToSeconds !== 'function') return { ok: false, code: 'BAD_BARS' };
      sec = Number(c.barsToSeconds(n)) || 0;
    }
    if (!(sec > 0)) return { ok: false, code: 'NO_DURATION' };
    return { ok: true, mode, seconds: Math.min(sec, MAX_SECONDS) };
  }

  // -------------------------------------------------- dosya adı (#528)

  /* Windows'un ve öteki sistemlerin yasak karakterleri, ayrılmış adlar
     (CON, NUL, COM1…) ve sondaki nokta/boşluk. Boş kalırsa yedek ad. */
  const RESERVED = /^(con|prn|aux|nul|com[0-9]|lpt[0-9])$/i;
  function sanitizeFileName(name, fallback) {
    let s = String(name == null ? '' : name)
      .replace(/[\u0000-\u001f<>:"/\\|?*]+/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
      .replace(/[. ]+$/, '');
    if (s.length > 150) s = s.slice(0, 150).trim();
    if (!s || RESERVED.test(s)) s = fallback || 'export';
    return s;
  }

  /* Varsayılan dosya adı: "Parça - Sahne - 128 BPM". Boş parçalar atlanır. */
  function outputName(meta, ext) {
    const m = meta || {};
    const parts = [m.title, m.scene, Number(m.bpm) > 0 ? Math.round(Number(m.bpm)) + ' BPM' : '']
      .map((x) => String(x || '').trim()).filter(Boolean);
    return sanitizeFileName(parts.join(' - '), 'export') + (ext ? '.' + ext : '');
  }

  // -------------------------------------------- yarım dosya yok (#532)

  /* Dosya önce bu adla yazılıyor, iş başarıyla bitince asıl adına
     taşınıyor: iptal, hata ya da kapanışta asıl yolda yarım bir dosya
     hiç olmuyor. Uzantı sonda kalıyor, ffmpeg kabı ondan seçiyor. */
  function partialPath(file) {
    const s = String(file);
    const dot = s.lastIndexOf('.');
    const sep = Math.max(s.lastIndexOf('/'), s.lastIndexOf('\\'));
    return dot > sep ? s.slice(0, dot) + '.partial' + s.slice(dot) : s + '.partial';
  }

  /* Kalan süre: bitmiş kare oranından. İlk saniyede tahmin yok. */
  function progressStats(done, total, elapsedMs) {
    const d = Math.max(0, Number(done) || 0);
    const t = Math.max(1, Number(total) || 1);
    const ms = Math.max(0, Number(elapsedMs) || 0);
    const fps = ms > 0 ? d / (ms / 1000) : 0;
    const eta = ms >= 1000 && fps > 0 ? Math.max(0, (t - d) / fps) : null;
    return { pct: Math.min(100, (d / t) * 100), fps, eta };
  }

  /* Rejects explicit but unknown export options instead of silently
     replacing them with defaults. Omitted (undefined/null/'') values are
     fine: the job falls back to its defaults. Returns null when valid,
     otherwise { field, value, allowed }. */
  function validateOptions(opts) {
    const o = opts || {};
    const given = (v) => v !== undefined && v !== null && v !== '';
    const checks = [
      ['resolution', Object.keys(RESOLUTIONS), (v) => Object.prototype.hasOwnProperty.call(RESOLUTIONS, v)],
      ['fps', FPS, (v) => FPS.includes(Number(v))],
      ['quality', QUALITIES, (v) => QUALITIES.includes(v)],
      ['speed', SPEEDS, (v) => SPEEDS.includes(v)],
      ['encoder', ['cpu', 'gpu'], (v) => v === 'cpu' || v === 'gpu'],
    ];
    for (const [field, allowed, ok] of checks) {
      if (given(o[field]) && !ok(o[field])) return { field, value: o[field], allowed: allowed.slice() };
    }
    return null;
  }

  const api = {
    RESOLUTIONS, FPS, QUALITIES, SPEEDS, ENCODERS, FORMATS, DEFAULT_FORMAT,
    format, extensions, encodersFor, pickEncoder, available,
    videoArgs, audioArgs, buildArgs, probeArgs, sequencePattern, takesYuv420,
    PROFILES, profile, matchProfile, applyProfile, chapterPlan, chapterFileName, chapterStamp, youtubeChapters,
    DURATION_MODES, MAX_SECONDS, resolveDuration, sanitizeFileName, outputName, partialPath, progressStats,
    validateOptions,
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (typeof window !== 'undefined') window.SVExportFormats = api;
})();
