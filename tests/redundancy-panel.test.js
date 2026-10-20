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
    pkgResult: { added: 2, same: 1, media: 1, conflicts: [{ kind: 'preset', id: 'u1', name: 'Benim' }, { kind: 'logo', id: 'l', name: 'Logo' }] },
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
