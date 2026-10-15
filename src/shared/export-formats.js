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
    h264_amf: { codec: 'h264', gpu: true, label: 'AMD AMF' },
    h264_qsv: { codec: 'h264', gpu: true, label: 'Intel Quick Sync' },
    libx265: { codec: 'hevc', gpu: false, label: 'CPU — x265' },
    hevc_nvenc: { codec: 'hevc', gpu: true, label: 'NVIDIA NVENC' },
    hevc_amf: { codec: 'hevc', gpu: true, label: 'AMD AMF' },
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

  /* Ses kuralı, kaba göre. Kaynak dosya mp4'e uygunsa kopyalanıyor. */
  function audioArgs(fmt, audioExt) {
    if (!fmt.audio) return null;
    const ext = String(audioExt || '').toLowerCase().replace(/^\./, '');
    if (fmt.audio === 'mp4') {
      return ['mp3', 'm4a', 'aac'].indexOf(ext) >= 0 ? ['-c:a', 'copy'] : ['-c:a', 'aac', '-b:a', '320k'];
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
  function pickEncoder(fmt, want, ok) {
    const list = encodersFor(fmt);
    const can = typeof ok === 'function' ? ok : function () { return true; };
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
    const args = [
      '-y',
      '-f', 'rawvideo',
      '-pixel_format', 'rgba',
      '-video_size', o.w + 'x' + o.h,
      '-framerate', String(o.fps),
      '-thread_queue_size', '1024', // ham kare girişi için geniş kuyruk
      '-i', 'pipe:0',
    ];
    const aArgs = o.audioPath ? audioArgs(fmt, o.audioExt) : null;
    if (aArgs) args.push('-i', o.audioPath);
    if (v.complex) {
      args.push('-filter_complex', '[0:v]' + v.complex + '[v]', '-map', '[v]');
    } else {
      if (v.vf) args.push('-vf', v.vf);
      args.push('-map', '0:v:0');
    }
    if (aArgs) args.push('-map', '1:a:0');
    args.push.apply(args, v.args);
    if (v.tags) args.push.apply(args, BT709_TAGS);
    if (aArgs) args.push.apply(args, aArgs);
    else args.push('-an');
    const meta = o.meta || {};
    if (fmt.kind !== 'sequence') {
      for (const k of ['title', 'artist', 'album', 'comment']) {
        if (meta[k]) args.push('-metadata', k + '=' + String(meta[k]).replace(/[\r\n]+/g, ' ').slice(0, 512));
      }
    }
    if (fmt.ext === 'mp4' || fmt.ext === 'mov') args.push('-movflags', '+faststart');
    if (aArgs) args.push('-shortest');
    if (fmt.kind === 'sequence') args.push('-f', 'image2', '-start_number', '1');
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

  const api = {
    RESOLUTIONS, FPS, QUALITIES, SPEEDS, ENCODERS, FORMATS, DEFAULT_FORMAT,
    format, extensions, encodersFor, pickEncoder, available,
    videoArgs, audioArgs, buildArgs, probeArgs, sequencePattern,
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (typeof window !== 'undefined') window.SVExportFormats = api;
})();
