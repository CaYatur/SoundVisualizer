'use strict';
/* YEDEKLİLİK PANELİ: her rol ve durumda panel çizilebiliyor. "Yeni Parola"
   sonrası birincil, yedek bağlı değilken classList.add('') ile hata
   fırlatıyor ve Çıkış sayfasının o bölümden sonrası hiç çizilmiyordu. */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.join(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(root, p), 'utf8').replace(/\r\n/g, '\n');

// Tarayıcının DOMTokenList'i gibi: boş ya da boşluklu sınıf hata fırlatır
function classList() {
  const set = new Set();
  const check = (t) => {
    if (t === '') throw new Error('SyntaxError: The token provided must not be empty.');
    if (/\s/.test(t)) throw new Error('InvalidCharacterError: The token provided contains HTML space characters.');
  };
  return {
    add: (...t) => t.forEach((x) => { check(x); set.add(x); }),
    remove: (...t) => t.forEach((x) => { check(x); set.delete(x); }),
    toggle: (x, on) => { check(x); const v = on === undefined ? !set.has(x) : !!on; if (v) set.add(x); else set.delete(x); return v; },
    contains: (x) => set.has(x),
  };
}
function el(tag, attrs, kids) {
  const n = { tag, attrs: attrs || {}, children: [], classList: classList(), addEventListener() {} };
  n.appendChild = (c) => { n.children.push(c); return c; };
  String((attrs && attrs.class) || '').split(/\s+/).filter(Boolean).forEach((c) => n.classList.add(c));
  (kids || []).forEach((k) => k && n.appendChild(k));
  return n;
}

function load(cfg, statusNow) {
  let onStatus = null;
  const ctx = {
    console,
    JSON,
    document: { querySelector: () => null },
    window: {
      SVPanel: { el, cfg: () => cfg, row: (label, ctrl) => el('div', { class: 'row' }, [ctrl]), push() {}, rerender() {} },
      api: {
        redundancyStatus: async () => statusNow,
        onRedundancyStatus: (fn) => { onStatus = fn; },
      },
    },
  };
  vm.createContext(ctx);
  vm.runInContext(read('src/admin/redundancy-panel.js'), ctx);
  const P = ctx.window.SVRedundancyPanel;
  return { P, setStatus: (s) => onStatus(s) };
}

const SECRET = 'abcdefghijklmnopqrstuvwx';
const SHOW = { hash: 'a'.repeat(64), differences: 0, pushable: 0, items: [] };
const CASES = [
  ['off', { role: 'off' }],
  ['primary', { role: 'primary', peers: 0, serverRunning: true }],
  ['primary', { role: 'primary', peers: 0, serverRunning: false }],
  ['primary', { role: 'primary', peers: 1, serverRunning: true, show: SHOW }],
  ['primary', { role: 'primary', peers: 1, serverRunning: true, peerState: 'active' }],
  ['primary', { role: 'primary', peers: 1, serverRunning: true, show: { hash: 'b', differences: 2, pushable: 1, items: [{ kind: 'preset', id: 'usr_1', status: 'missing', pushable: true }] } }],
  ['primary', { role: 'primary', problem: 'secret' }],
  ['backup', { role: 'backup', problem: 'host' }],
  ['backup', { role: 'backup', state: 'connecting' }],
  ['backup', { role: 'backup', state: 'following' }],
  ['backup', { role: 'backup', state: 'lost' }],
  ['backup', { role: 'backup', state: 'active', takenBy: 'auto' }],
  ['backup', { role: 'backup', state: 'active', takenBy: 'manual' }],
];

test('panel her rol ve durumda hata fırlatmadan çiziliyor', async () => {
  for (const [role, st] of CASES) {
    const cfg = { redundancy: { role, secret: SECRET, host: '192.168.1.20' } };
    const { P, setStatus } = load(cfg, st);
    await P.init();
    setStatus(st);
    assert.doesNotThrow(() => P.panel(), role + ' ' + JSON.stringify(st));
  }
});

test('yeni parola sonrası birincil, yedek bağlı değilken çiziliyor', async () => {
  const cfg = { redundancy: { role: 'primary', secret: '' } };
  const { P, setStatus } = load(cfg, { role: 'primary', problem: 'secret' });
  await P.init();
  P.panel();
  cfg.redundancy.secret = SECRET; // "Yeni Parola"
  setStatus({ role: 'primary', peers: 0, serverRunning: true });
  const panel = P.panel();
  assert.ok(panel.children.length > 2, 'parola satırı ve altı çizildi');
});

test('Gösteri kategorisi: Çıkış ile Kontrol arasında; önce denetim, sonra yedeklilik', () => {
  const admin = read('src/admin/admin.js');
  const ids = [...admin.slice(admin.indexOf('const CATEGORIES = ['), admin.indexOf('];', admin.indexOf('const CATEGORIES = ['))).matchAll(/id: '([a-z]+)'/g)].map((m) => m[1]);
  assert.deepStrictEqual(ids.slice(ids.indexOf('output'), ids.indexOf('output') + 3), ['output', 'show', 'control']);
  const pre = admin.indexOf("id: 'preshow',\n        category: 'show',");
  const red = admin.indexOf("id: 'redundancy',\n        category: 'show',");
  assert.ok(pre > 0 && red > pre, 'iki bölüm Gösteri\'de, denetim önce');
  const i18n = read('src/shared/i18n.js');
  assert.ok(i18n.includes("'Gösteri': 'Show',"));
  assert.ok(i18n.includes("'Gösterinin aksamadan sürmesi için: başlamadan önce denetim ve ikinci makineyle sıcak yedek.':"));
});

test('sunucu açılınca panel güncel durumu alıyor; sürerken gelen çağrı düşmüyor', () => {
  const main = read('src/main/main.js');
  const fn = main.slice(main.indexOf('function syncStreamServer() {'), main.indexOf('return streamServer\n    .start('));
  assert.match(fn, /if \(streamSyncing\) \{ streamResync = true; return/);
  assert.match(fn, /if \(red\.role === 'primary'\) notifyRedundancy\(\);/);
  assert.match(fn, /if \(streamResync\) \{ streamResync = false; syncStreamServer\(\); \}/);
});

test('bir bölümün hatası sayfanın kalanını düşürmüyor', () => {
  const admin = read('src/admin/admin.js');
  assert.match(admin, /try \{\n        card = buildCard\(sec\);\n      \} catch \(e\) \{\n        console\.error\('Bölüm çizilemedi:', sec\.id, e\);\n        card = brokenCard\(sec\);/);
  assert.ok(read('src/shared/i18n.js').includes("'Bu bölüm çizilemedi. Öteki bölümler çalışıyor; ayrıntı geliştirici konsolunda.':"));
  // Boş sınıf adı eklenen başka yer kalmadı
  for (const f of ['src/admin/redundancy-panel.js', 'src/admin/preshow-panel.js', 'src/admin/admin.js']) {
    assert.doesNotMatch(read(f), /classList\.(add|remove|toggle)\([^)]*\? *'[^']*' *: *''/, f);
  }
});

// Yalıtılmış gösteri ve gösteri paketi (#812): her durumda çiziliyor
const SPACE = { source: 'primary', override: null, takeoverData: 'primary', local: { scenes: 2 }, primary: { scenes: 1 }, primaryScenes: [{ id: 'a', name: 'Sahne A' }] };
const SUMMARY = { presets: { n: 3, bytes: 900 }, logos: { n: 1, bytes: 5000 }, media: { n: 1, bytes: 2e9 } };
const PKG_CASES = [
  { role: 'backup', state: 'following', connected: true, space: SPACE, pkg: { state: 'idle' } },
  { role: 'backup', state: 'following', connected: true, space: SPACE, pkg: { state: 'offered', summary: SUMMARY, files: [{ kind: 'media', name: 'a.mp4', size: 2e9 }] } },
  { role: 'backup', state: 'following', connected: true, space: SPACE, pkg: { state: 'transferring', summary: SUMMARY, files: [], progress: { bytes: 5e8, total: 2e9, files: 3, of: 5 }, speed: 4e7 } },
  { role: 'backup', state: 'following', connected: true, space: SPACE, pkg: { state: 'error', error: 'changed', progress: { bytes: 1, total: 2, files: 0, of: 1 } } },
  { role: 'backup', state: 'active', takenBy: 'auto', space: Object.assign({}, SPACE, { source: 'local' }), pkg: { state: 'done', progress: { bytes: 2, total: 2, files: 1, of: 1 } },
    pkgResult: { added: 2, same: 1, media: 1, conflicts: [{ kind: 'preset', id: 'u1', name: 'Benim' }, { kind: 'logo', id: 'l', name: 'Logo' }],
      isolated: [{ kind: 'preset', id: 'p-only', name: 'Yalnız birincilde' }, { kind: 'logo', id: 'lg', name: 'Afiş' }], isolatedCount: 41 },
    parity: [{ id: 'u9', name: 'X', status: 'missing' }, { id: 'u8', name: 'Y', status: 'different' }] },
  { role: 'backup', state: 'connecting', connected: false, space: null, pkg: null },
];

test('yedek paneli: gösteri verisi, paket ve eşlik her durumda çiziliyor', async () => {
  for (const st of PKG_CASES) {
    const cfg = { redundancy: { role: 'backup', secret: SECRET, host: '192.168.1.20' } };
    const { P, setStatus } = load(cfg, st);
    await P.init();
    setStatus(st);
    let panel;
    assert.doesNotThrow(() => { panel = P.panel(); }, JSON.stringify(st));
    const texts = [];
    (function walk(n) { if (!n) return; if (n.attrs && typeof n.attrs.text === 'string') texts.push(n.attrs.text); (n.children || []).forEach(walk); })(panel);
    assert.ok(texts.includes('Gösteri Verisi') && texts.includes('Gösteri Paketi'), JSON.stringify(st.pkg));
    if (st.pkg && st.pkg.state === 'offered') assert.ok(texts.includes('Video dosyalarını da kopyala'), 'videolar ayrıca onaylanır');
    if (st.parity) assert.ok(texts.includes('Görüntü birincilden farklı olabilir'));
    // Eksikler ayrı alanda; her biri ayrı onayla kütüphaneye (#812)
    if (st.pkgResult && st.pkgResult.isolated) {
      assert.ok(texts.includes('Bu makinede yok; ayrı alanda tutuluyor ve birincilin kopyası çizilirken kullanılıyor:'));
      assert.strictEqual(texts.filter((t) => t === 'Kütüphaneye Ekle').length, 2);
      assert.ok(texts.includes('İlk 40 öğe gösteriliyor.'));
    }
  }
});

test('yedeklilik paneli: her Türkçe metnin İngilizcesi var', () => {
  const src = read('src/admin/redundancy-panel.js');
  const i18n = read('src/shared/i18n.js');
  const missing = [];
  for (const m of src.matchAll(/(?:text: |tr\(|: )'((?:[^'\\]|\\.)*)'/g)) {
    const t = m[1].replace(/\\'/g, "'");
    if (!/[çğıöşüÇĞİÖŞÜ]/.test(t)) continue;
    if (!i18n.includes("'" + t.replace(/'/g, "\\'") + "':")) missing.push(t);
  }
  assert.deepStrictEqual(missing, []);
});

/* GÖSTERİ DÜZENİ (#816). Elle devralma eskiden izleyen yedeğin en göze
   çarpan (mavi birincil, üzerine gelince parlayan) düğmesiydi ve sormadan
   yetkiyi alıyordu. Artık uyarı tonunda ve onay istiyor. */
test('elle devralma: birincil mavi değil, onay istiyor; bırakma da soruyor', () => {
  const src = read('src/admin/redundancy-panel.js');
  assert.match(src, /class: 'btn small warn-btn', type: 'button', icon: 'bolt', text: 'Elle Devral'/);
  assert.doesNotMatch(src, /text: 'Yetkiyi Al'/);
  const act = src.slice(src.indexOf('async function act('), src.indexOf('function authorityBox('));
  assert.match(act, /if \(!\(await P\(\)\.confirm\(msg, \{ okText: tr\('Elle Devral'\) \}\)\)\) return;/);
  assert.match(act, /if \(!\(await P\(\)\.confirm\(msg, \{ okText: tr\('Yetkiyi Bırak'\) \}\)\)\) return;/);
  // Birincil yaşarken ayrıca uyarı
  assert.match(act, /const alive = status\.state === 'following';/);
  assert.match(read('src/admin/admin.css'), /\.btn\.warn-btn \{[^}]*--warn/);
});

test('durum kutucukları: son atış eşiğe göre renkleniyor, değerler sayısal', async () => {
  const cfg = { redundancy: { role: 'backup', secret: SECRET, host: '10.0.0.2' } };
  const st = { role: 'backup', state: 'following', lastBeat: Date.now() - 1200, lossLimitMs: 1500, maxGap: 300, maxPrimaryGap: 280, gapP95Ms: 260, heartbeatMs: 250, jitterMs: 12, missed: 2, beats: 400, offsetMs: -3, offsetSamples: 40, since: Date.now() - 65000 };
  const { P } = load(cfg, st);
  const specs = P._tileSpecs(st);
  const by = Object.fromEntries(specs.map(([k, label, v, o]) => [k, { label, v, o }]));
  assert.strictEqual(by.last.o.tone, 'err', '1200/1500 ms: eşiğe yakın');
  assert.strictEqual(by.miss.v, '2');
  assert.strictEqual(by.miss.o.tone, 'warn');
  assert.strictEqual(by.clk.v, '-3 ms');
  assert.strictEqual(by.since.v, '1:05', 'süre dilden bağımsız');
  assert.strictEqual(by.p95.v, '260 ms');
  // Birincil: yedek bağlı, gönderilen atış
  const ps = { role: 'primary', peers: 1, peerState: 'following', serverRunning: true, heartbeatMs: 250, beatsSent: 12, ownMaxGap: 270, peerSince: Date.now() - 5000, show: { differences: 3 } };
  const pk = Object.fromEntries(P._tileSpecs(ps).map(([k, , v, o]) => [k, { v, o }]));
  assert.strictEqual(pk.peer.o.tone, 'ok');
  assert.strictEqual(pk.show.o.tone, 'warn');
  // Rol kapalı: kutucuk yok
  assert.strictEqual(P._tileSpecs({ role: 'off' }).length, 0);
});

test('takipçi: alınan ve kaybolan atış, aralık p95 ve titreme', () => {
  const R = require('../src/main/redundancy');
  const f = R.createFollower({ role: 'backup', secret: SECRET, host: 'h', heartbeatMs: 100 }, 0);
  let t = 0;
  for (let i = 0; i < 40; i++) { t += i === 20 ? 160 : 100; f.beat({ seq: i < 30 ? i : i + 3, at: t }, t); }
  const s = f.status;
  assert.strictEqual(s.beats, 40);
  assert.strictEqual(s.missed, 3, 'sıra boşluğu');
  assert.strictEqual(s.gapP95Ms, 100);
  assert.ok(s.jitterMs >= 0 && s.jitterMs <= 60);
  assert.strictEqual(s.maxGap, 160);
  assert.strictEqual(s.heartbeatMs, 100);
});

test('gösteri öncesi denetim: durum, sayılar, düğme ve yardım tek satırda', () => {
  const src = read('src/admin/preshow-panel.js');
  assert.match(src, /const nodes = \[header\(\)\];/);
  assert.match(src, /class: 'br-head preshow-head'/);
  assert.doesNotMatch(src, /nodes\.push\(el\('div', \{ class: 'lay-file' \}/, 'düğme artık üst satırda');
  const i18n = read('src/shared/i18n.js');
  for (const k of ['tamam', 'uyarı', 'hata']) assert.ok(i18n.includes("'" + k + "':"), k);
});
