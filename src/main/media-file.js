'use strict';
/* Video dosyalarını Range destekleyerek servis eden yardımcı.

   Ana süreçten ayrı bir dosyada, çünkü aralık hesabı testin gerçekten
   çalıştırabildiği tek yer burası; main.js Electron olmadan yüklenemez. */
const fs = require('fs');
const path = require('path');
const { Readable } = require('stream');
const MEDIA_MIME = {
  '.mp4': 'video/mp4', '.m4v': 'video/mp4', '.mov': 'video/quicktime',
  '.webm': 'video/webm', '.mkv': 'video/x-matroska', '.avi': 'video/x-msvideo',
};

/* Video dosyasını Range destekleyerek servis eder.

   Range şart: <video> öğesi konum değiştirmek için parça isteği yapar ve
   dizini (moov atomu) sonda olan MP4'ler için ilk oynatma bile buna bağlıdır.
   Aralıksız 200 dönen bir kaynakta böyle dosyalar hiç başlamaz. */
function serveMediaFile(file, rangeHeader) {
  let stat;
  try {
    stat = fs.statSync(file);
  } catch {
    return new Response('not found', { status: 404 });
  }
  const type = MEDIA_MIME[path.extname(file).toLowerCase()] || 'application/octet-stream';
  const size = stat.size;
  const toWeb = (s) => Readable.toWeb(s);

  const m = rangeHeader ? /bytes=(\d*)-(\d*)/.exec(String(rangeHeader)) : null;
  if (m) {
    let start = m[1] === '' ? NaN : parseInt(m[1], 10);
    let end = m[2] === '' ? NaN : parseInt(m[2], 10);
    // "bytes=-500" sondan 500 bayt demektir; "bytes=500-" sona kadar
    if (Number.isNaN(start)) {
      const len = Number.isNaN(end) ? 0 : end;
      start = Math.max(0, size - len);
      end = size - 1;
    } else if (Number.isNaN(end)) {
      end = size - 1;
    }
    if (start >= size || start > end) {
      return new Response('range not satisfiable', {
        status: 416,
        headers: { 'Content-Range': 'bytes */' + size },
      });
    }
    end = Math.min(end, size - 1);
    return new Response(toWeb(fs.createReadStream(file, { start, end })), {
      status: 206,
      headers: {
        'Content-Type': type,
        'Content-Length': String(end - start + 1),
        'Content-Range': 'bytes ' + start + '-' + end + '/' + size,
        'Accept-Ranges': 'bytes',
      },
    });
  }

  return new Response(toWeb(fs.createReadStream(file)), {
    status: 200,
    headers: { 'Content-Type': type, 'Content-Length': String(size), 'Accept-Ranges': 'bytes' },
  });
}

module.exports = { serveMediaFile, MEDIA_MIME };
