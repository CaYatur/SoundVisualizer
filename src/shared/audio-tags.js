'use strict';
/* Seçilen ses dosyasının etiketleri ve gömülü kapağı.
   ffmpeg her platformda aynı işi yapar; Windows oturumu gerekmez.
   Ayrıştırıcı saf metindir, dışa aktarma onu ana süreçte çalıştırır. */

const { spawn } = require('child_process');

function unescapeMeta(value) {
  return String(value || '').replace(/\\n/g, '\n').replace(/\\(.)/g, '$1').trim();
}

function parseFfmetadata(text) {
  const bag = {};
  const lines = String(text || '').split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (!line || line.charAt(0) === ';' || line.charAt(0) === '#') continue;
    const eq = line.indexOf('=');
    if (eq <= 0) continue;
    const key = line.slice(0, eq).trim().toLowerCase();
    const val = unescapeMeta(line.slice(eq + 1));
    if (key && val && bag[key] == null) bag[key] = val;
  }
  return {
    title: bag.title || '',
    artist: bag.artist || bag.album_artist || '',
    album: bag.album || '',
  };
}

function run(ff, args, onStdout, timeoutMs) {
  return new Promise((resolve) => {
    let proc = null;
    let settled = false;
    const finish = (value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(value);
    };
    const timer = setTimeout(() => {
      try { if (proc) proc.kill(); } catch { /* yok */ }
      finish(null);
    }, timeoutMs || 8000);
    try {
      proc = spawn(ff, args, { windowsHide: true, stdio: ['ignore', 'pipe', 'ignore'] });
    } catch {
      finish(null);
      return;
    }
    proc.on('error', () => finish(null));
    if (onStdout && proc.stdout) proc.stdout.on('data', onStdout);
    proc.on('close', () => finish(true));
  });
}

async function readAudioTags(ff, file, fallbackTitle) {
  let metaText = '';
  await run(ff, ['-hide_banner', '-i', file, '-f', 'ffmetadata', '-'], (d) => {
    metaText += d.toString();
    if (metaText.length > 200000) metaText = metaText.slice(0, 200000);
  }, 8000);
  const meta = parseFfmetadata(metaText);
  const chunks = [];
  let size = 0;
  let tooBig = false;
  await run(ff, [
    '-hide_banner', '-loglevel', 'error', '-i', file,
    '-map', '0:v:0', '-frames:v', '1',
    '-f', 'image2pipe', '-c:v', 'png', 'pipe:1',
  ], (d) => {
    size += d.length;
    if (size > 8 * 1024 * 1024) { tooBig = true; return; }
    chunks.push(Buffer.from(d));
  }, 8000);
  let artwork = '';
  if (!tooBig && chunks.length) {
    const buf = Buffer.concat(chunks);
    if (buf.length > 32) artwork = 'data:image/png;base64,' + buf.toString('base64');
  }
  return {
    title: meta.title || fallbackTitle || '',
    artist: meta.artist || '',
    album: meta.album || '',
    artwork,
  };
}

module.exports = { parseFfmetadata, readAudioTags };
