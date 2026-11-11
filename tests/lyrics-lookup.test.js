'use strict';
/* Otomatik söz bulma (#937): yan dosya → gömülü etiket → önbellek →
 * sağlayıcılar. Sağlayıcı yoksa ağa hiç çıkılmaz; hata çalmayı durdurmaz. */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const LL = require('../src/main/lyrics-lookup.js');
const tags = require('../src/shared/audio-tags.js');

function tmp() { return fs.mkdtempSync(path.join(os.tmpdir(), 'svll-')); }
function syncsafe(n) { return Buffer.from([(n >> 21) & 127, (n >> 14) & 127, (n >> 7) & 127, n & 127]); }
function id3(frames) {
  const body = Buffer.concat(frames.map(([id, data]) => {
    const h = Buffer.alloc(10);
    h.write(id, 0, 'latin1');
    h.writeUInt32BE(data.length, 4);
    return Buffer.concat([h, data]);
  }));
  return Buffer.concat([Buffer.from('ID3\x03\x00\x00', 'latin1'), syncsafe(body.length), body, Buffer.alloc(64)]);
}
function uslt(text) { return Buffer.concat([Buffer.from([0]), Buffer.from('eng\0', 'latin1'), Buffer.from(text, 'latin1')]); }
function sylt(items) {
  const parts = [Buffer.from([0]), Buffer.from('eng', 'latin1'), Buffer.from([2, 1]), Buffer.from('\0', 'latin1')];
  for (const [t, ms] of items) {
    const b = Buffer.alloc(4); b.writeUInt32BE(ms, 0);
    parts.push(Buffer.from(t + '\0', 'latin1'), b);
  }
  return Buffer.concat(parts);
}
const ON = (extra) => Object.assign({ enabled: true, providers: [] }, extra || {});

test('varsayılan: kapalı ve sağlayıcı listesi boş', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'src', 'shared', 'defaults.js'), 'utf8');
  assert.match(src, /lyricsLookup: \{[^}]*enabled: false[^}]*providers: \[\]/);
});

test('kapalıyken hiçbir şey okunmaz', async () => {
  let called = 0;
  const r = await LL.lookup({ config: { enabled: false }, meta: { title: 'x' }, fetch: () => { called++; } });
  assert.strictEqual(r, null);
  assert.strictEqual(called, 0);
});

test('yan dosya .lrc ilk sırada', async () => {
  const dir = tmp();
  const a = path.join(dir, 'Şarkı.mp3');
  fs.writeFileSync(a, id3([['USLT', uslt('gomulu')]]));
  fs.writeFileSync(path.join(dir, 'Şarkı.lrc'), '[00:01.00]yan dosya');
  const r = await LL.lookup({ audioPath: a, config: ON(), cacheDir: path.join(dir, 'c') });
  assert.strictEqual(r.source, 'sidecar');
  assert.match(r.text, /yan dosya/);
});

test('ID3 USLT ve SYLT okunur, zamanlı olan tercih edilir', async () => {
  const dir = tmp();
  const a = path.join(dir, 'a.mp3');
  fs.writeFileSync(a, id3([['USLT', uslt('duz satir')], ['SYLT', sylt([['Merhaba', 1500], ['\ndunya', 3000]])]]));
  const p = LL.parseId3Lyrics(fs.readFileSync(a));
  assert.strictEqual(p.unsynced, 'duz satir');
  assert.match(p.synced, /^\[00:01\.50\]Merhaba\n\[00:03\.00\]dunya$/);
  const r = await LL.lookup({ audioPath: a, config: ON({ sidecar: false }), cacheDir: path.join(dir, 'c') });
  assert.strictEqual(r.source, 'embedded');
  assert.match(r.text, /^\[00:01\.50\]/);
});

test('ffmetadata lyrics etiketi (Vorbis LYRICS / MP4) okunur', () => {
  const m = tags.parseFfmetadata([';FFMETADATA1', 'title=A', 'LYRICS=[00:01.00]bir\\', '[00:02.00]iki'].join('\n'));
  assert.match(m.lyrics, /\[00:01\.00\]bir\n\[00:02\.00\]iki/);
});

test('sağlayıcı yoksa sıfır ağ isteği', async () => {
  let called = 0;
  const r = await LL.lookup({ meta: { artist: 'A', title: 'B' }, config: ON(), cacheDir: tmp(), fetch: () => { called++; } });
  assert.strictEqual(r, null);
  assert.strictEqual(called, 0);
});

test('sağlayıcı: şablon, JSON yolu, önbellek ve sıralı yedek', async () => {
  const dir = tmp();
  const urls = [];
  const fetch = async (url) => {
    urls.push(url);
    if (url.includes('bad.example')) throw new Error('down');
    return { ok: true, text: async () => JSON.stringify({ data: { lyrics: '[00:01.00]bulundu' } }) };
  };
  const cfg = ON({ providers: [
    { url: 'https://bad.example/get?artist={artist}&title={title}', format: 'json', path: 'data.lyrics' },
    { url: 'https://example.com/api/get?artist={artist}&title={title}&d={duration}', format: 'json', path: 'data.lyrics' },
  ] });
  const meta = { artist: 'Ä B', title: 'C&D', duration: 201.4 };
  const r = await LL.lookup({ meta, config: cfg, cacheDir: dir, fetch });
  assert.strictEqual(r.source, 'provider');
  assert.match(r.text, /bulundu/);
  assert.strictEqual(urls.length, 2);
  assert.ok(urls[1].includes('artist=' + encodeURIComponent('Ä B')) && urls[1].includes('title=C%26D') && urls[1].includes('d=201'), urls[1]);
  const again = await LL.lookup({ meta, config: cfg, cacheDir: dir, fetch: () => { throw new Error('ağ yok'); } });
  assert.strictEqual(again.source, 'cache');
});

test('yavaş sağlayıcı zaman aşımında bırakılır, hata fırlatılmaz', async () => {
  const fetch = (url, o) => new Promise((res, rej) => { o.signal && o.signal.addEventListener('abort', () => rej(new Error('abort'))); });
  const t0 = Date.now();
  const r = await LL.lookup({ meta: { title: 'B' }, config: ON({ timeoutMs: 1000, cache: false, providers: [{ url: 'https://example.com/{title}', format: 'lrc' }] }), fetch });
  assert.strictEqual(r, null);
  assert.ok(Date.now() - t0 < 3000);
});

test('yalnız http(s) adresleri kabul edilir', () => {
  const c = LL.sanitizeConfig({ providers: [{ url: 'file:///etc/passwd' }, { url: 'javascript:1' }, { url: 'https://example.com/x' }] });
  assert.strictEqual(c.providers.length, 1);
});

const LP = require('../src/shared/lyrics-providers.js');

test('LRCLIB hazır şablon: adres ve yol doğru; varsayılan listeye yazılmaz', () => {
  assert.strictEqual(LP.LRCLIB_PRESET.name, 'LRCLIB');
  assert.strictEqual(LP.LRCLIB_PRESET.format, 'json');
  assert.strictEqual(LP.LRCLIB_PRESET.path, 'syncedLyrics');
  assert.strictEqual(LP.LRCLIB_PRESET.enabled, true);
  assert.strictEqual(
    LP.LRCLIB_PRESET.url,
    'https://lrclib.net/api/get?artist_name={artist}&track_name={title}&album_name={album}&duration={duration}'
  );
  const src = fs.readFileSync(path.join(__dirname, '..', 'src', 'shared', 'defaults.js'), 'utf8');
  assert.match(src, /lyricsLookup: \{[^}]*providers: \[\]/);
  assert.doesNotMatch(src, /lrclib\.net/);
});

test('LRCLIB şablonu bir kez eklenir; ikinci ekleme çoğaltmaz', () => {
  const list = [];
  const a = LP.addLrclibPreset(list);
  assert.strictEqual(a.added, true);
  assert.strictEqual(list.length, 1);
  assert.strictEqual(list[0].url, LP.LRCLIB_PRESET.url);
  const b = LP.addLrclibPreset(list);
  assert.strictEqual(b.added, false);
  assert.strictEqual(list.length, 1);
  list.push({ enabled: true, name: 'lrclib', url: 'https://other.example/x', format: 'lrc' });
  const c = LP.addLrclibPreset(list);
  assert.strictEqual(c.added, false);
  assert.strictEqual(list.length, 2);
});

test('özel sağlayıcı ekleme LRCLIB şablonundan bağımsız kalır', () => {
  const list = [];
  LP.addLrclibPreset(list);
  list.push({ enabled: true, name: '', url: 'https://example.com/api/get?artist={artist}&title={title}', format: 'json', path: 'syncedLyrics' });
  assert.strictEqual(list.length, 2);
  assert.strictEqual(list[0].name, 'LRCLIB');
  assert.match(list[1].url, /example\.com/);
});
