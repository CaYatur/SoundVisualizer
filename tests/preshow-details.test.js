'use strict';
/* GÖSTERİ ÖNCESİ DENETİM ayrıntıları: eksik dosyanın yeri, nedeni ve
   düzeltmesi; çıkışların ekran ekran kare hızı; açılış ölçümü; Windows'un
   birincil ekran sınırı. Kullanıcı raporu: 60 Hz ekranda "0 / 60 fps",
   165 Hz ekranda 75 fps, "usr_vis_test2_cizgi eksik" ama nerede olduğu yok
   (dosya diskte BOM'la duruyordu). */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const Module = require('module');
const Refs = require('../src/shared/preshow-refs.js');
const S = require('../src/main/preshow.js');

const root = path.join(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(root, p), 'utf8').replace(/\r\n/g, '\n');
const by = (r, id) => r.checks.find((c) => c.id === id);

test('BOM ile kaydedilmiş preset dosyası okunuyor (PowerShell/Notepad)', async () => {
  const origLoad = Module._load;
  Module._load = function (request) {
    if (request === 'electron') return { app: { getPath: () => os.tmpdir() } };
    return origLoad.apply(this, arguments);
  };
  let STORE;
  try { STORE = require('../src/main/presets-store.js'); } finally { Module._load = origLoad; }
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sv-bom-'));
  try {
    const body = JSON.stringify({ id: 'usr_vis_bom', name: 'BOM', kind: 'visualizer', source: 'void mainImage(out vec4 c, in vec2 p){c=vec4(1.0);}' }, null, 4);
    fs.writeFileSync(path.join(dir, 'usr_vis_bom.json'), '\uFEFF' + body, 'utf8');
    STORE.setDir(dir);
    assert.ok(STORE.get('usr_vis_bom'), 'eşzamanlı okuma');
    STORE.setDir(dir);
    await STORE.warm();
    assert.ok(STORE.list().some((p) => p.id === 'usr_vis_bom'), 'arka plan okuması');
  } finally {
    STORE.setDir(null);
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

function sample() {
  return {
    layerStack: { enabled: true },
    custom: { visualizerId: 'usr_live', backgroundId: 'builtin_x' },
    logo: { libraryId: 'img_a', swap: { items: ['img_b', 'img_c'] } },
    media: { source: 'file', file: 'sv-media://C:/v/base.mp4' },
    layers: [
      { kind: 'visualizer', name: 'Çizgi', presetId: 'usr_live' },
      { kind: 'media', name: 'Video', enabled: true, settings: { media: { source: 'file', file: 'sv-media://C:/v/own.mp4', fileName: 'own.mp4', libraryId: 'm1' } } },
      { kind: 'media', name: 'Kapalı', enabled: false, settings: { media: { source: 'file', file: 'sv-media://C:/v/off.mp4' } } },
      { kind: 'logo', name: 'Amblem', settings: { logo: { libraryId: 'img_b' } } },
    ],
    scenes: [
      { name: 'Test 2', data: { custom: { visualizerId: 'usr_old' }, layers: [{ kind: 'background' }, { kind: 'visualizer', name: 'Bakir Halkalar', presetId: 'usr_old' }] } },
    ],
  };
}

test('başvurular yerleriyle: canlı/kayıtlı sahne, katman, alan; kapalı video ve yerleşik preset yok', () => {
  const all = Refs.collect(sample());
  const get = (kind, id) => all.find((r) => r.kind === kind && r.id === id);
  assert.deepStrictEqual(get('preset', 'usr_live').where.map((w) => [w.scene, w.layer && w.layer.index, w.field]),
    [[null, null, 'custom.visualizerId'], [null, 0, 'presetId']]);
  const old = get('preset', 'usr_old');
  assert.strictEqual(old.where.length, 2);
  assert.ok(old.where.every((w) => w.scene && w.scene.name === 'Test 2'));
  assert.strictEqual(old.where[1].layer.name, 'Bakir Halkalar');
  assert.strictEqual(Refs.live(old), false);
  assert.strictEqual(Refs.live(get('preset', 'usr_live')), true);
  assert.ok(!get('preset', 'builtin_x'), 'yerleşik preset denetlenmez');
  assert.deepStrictEqual(get('logo', 'img_b').where.map((w) => w.field), ['logo.swap', 'settings.logo.libraryId']);
  assert.ok(get('media', 'sv-media://C:/v/own.mp4'));
  assert.ok(!get('media', 'sv-media://C:/v/off.mp4'), 'kapalı katmanın videosu dışa aktarımdaki gibi sayılmaz');
  assert.ok(!get('media', 'sv-media://C:/v/base.mp4'), 'yığın açıkken üst düzey video çizilmiyor');
  // Eski references() aynı kimlikleri veriyor
  const r = S.references(sample());
  assert.deepStrictEqual(r.presets.sort(), ['usr_live', 'usr_old']);
  assert.deepStrictEqual(r.logos.sort(), ['img_a', 'img_b', 'img_c']);
});

test('düzeltme: başvuru her sahnede değişir ya da kalkar', () => {
  const cfg = sample();
  assert.strictEqual(Refs.replace(cfg, 'preset', 'usr_old', null), 2);
  assert.strictEqual(cfg.scenes[0].data.custom.visualizerId, null);
  assert.strictEqual(cfg.scenes[0].data.layers[1].presetId, null);
  assert.strictEqual(cfg.custom.visualizerId, 'usr_live', 'başka başvuruya dokunulmaz');

  assert.strictEqual(Refs.replace(cfg, 'media', 'sv-media://C:/v/own.mp4', 'sv-media://D:/yeni/b%C3%BCy%C3%BCk.mp4'), 1);
  const m = cfg.layers[1].settings.media;
  assert.deepStrictEqual([m.file, m.fileName, m.libraryId], ['sv-media://D:/yeni/b%C3%BCy%C3%BCk.mp4', 'büyük.mp4', ''], 'medya paneli gibi yazıldı');

  assert.strictEqual(Refs.replace(cfg, 'logo', 'img_b', null), 2);
  assert.deepStrictEqual(cfg.logo.swap.items, ['img_c'], 'değişim listesinde boşluk kalmadı');
  assert.strictEqual(cfg.layers[3].settings.logo.libraryId, null);
  assert.strictEqual(Refs.collect(cfg).filter((r) => r.id === 'img_b').length, 0);
});

test('eksik dosya: canlı sahnede hazır değil, yalnız kayıtlı sahnede uyarı; ayrıntı satırda', () => {
  const at = (scene) => [{ scene, layer: { index: 1, name: 'Bakir Halkalar', kind: 'visualizer' }, field: 'presetId' }];
  const saved = S.evaluate({ missing: [{ kind: 'preset', id: 'usr_old', name: 'usr_old', reason: 'unreadable', path: 'C:/p/usr_old.json', where: at({ index: 18, name: 'Test 2' }) }] });
  const f = by(saved, 'files');
  assert.strictEqual(f.state, 'warn');
  assert.strictEqual(f.text, 'Kayıtlı sahnelerde eksik dosya var');
  assert.deepStrictEqual(f.parts, ['1', 'usr_old']);
  assert.strictEqual(f.items[0].reason, 'unreadable');
  assert.strictEqual(f.items[0].where[0].scene.name, 'Test 2');
  const live = by(S.evaluate({ missing: [{ kind: 'media', id: 'x', name: 'a.mp4', reason: 'absent', where: at(null) }] }), 'files');
  assert.strictEqual(live.state, 'fail');
  assert.strictEqual(live.text, 'Canlı sahnenin başvurduğu dosyalar eksik');
  // Eski biçim canlı sayılır
  assert.strictEqual(by(S.evaluate({ missing: { media: ['b.mp4'], logos: [], presets: [] } }), 'files').state, 'fail');
});

test('çıkışlar: açılışta ölçülüyor (0 fps uyarısı yok), çizmeyen pencere ayrı, ekran ekran ayrıntı', () => {
  const base = { label: 'Ekran 2', displayId: 2, target: 60, hz: 60, primaryHz: 75 };
  const measuring = by(S.evaluate({ outputs: [Object.assign({}, base, { fps: 0, measuring: true })] }), 'outputs');
  assert.strictEqual(measuring.state, 'info');
  assert.strictEqual(measuring.text, 'Çıkışların kare hızı ölçülüyor');
  const stale = by(S.evaluate({ outputs: [Object.assign({}, base, { fps: 0, stale: true })] }), 'outputs');
  assert.strictEqual(stale.state, 'fail');
  assert.deepStrictEqual(stale.parts, ['Ekran 2']);
  const two = by(S.evaluate({ outputs: [Object.assign({}, base, { fps: 60 }), { label: 'Ekran 3', displayId: 3, fps: 0, measuring: true, target: 75, hz: 165, primaryHz: 75 }] }), 'outputs');
  assert.strictEqual(two.state, 'ok', 'ölçülmekte olan pencere sonucu bozmuyor');
  assert.deepStrictEqual(two.items.map((i) => [i.label, i.state, i.hz]), [['Ekran 2', 'ok', 60], ['Ekran 3', 'info', 165]]);
});

test('ekran ortak hızdan hızlıysa neden, sınırlayan ekran ve öneri; yavaş ekranda satır yok', () => {
  // Ölçüldü: 75 Hz birincil + 165 Hz → ikisi 75; 60 Hz + 165 Hz → ikisi 60
  const r = S.evaluate({
    sharedRate: { hz: 75, label: 'Ekran 1 (Birincil)', primary: true },
    outputs: [{ label: 'Ekran 3', displayId: 3, fps: 75, target: 75, hz: 165 }],
  });
  const lim = by(r, 'refresh');
  assert.strictEqual(lim.state, 'info');
  assert.strictEqual(lim.text, 'Windows bütün çıkış pencerelerini tek hızda çiziyor: birincil ekranın ve açık çıkışların en yavaşı');
  assert.deepStrictEqual(lim.parts, ['Ekran 3: 165 Hz → 75 fps']);
  assert.deepStrictEqual(lim.limiter, { label: 'Ekran 1 (Birincil)', hz: 75, primary: true });
  assert.match(lim.hint, /ana ekran yapmayı deneyin/);
  assert.strictEqual(r.overall, 'ok');
  const slow = S.evaluate({
    sharedRate: { hz: 60, label: 'Ekran 2', primary: false },
    outputs: [{ label: 'Ekran 2', fps: 60, target: 60, hz: 60 }, { label: 'Ekran 3', fps: 60, target: 60, hz: 165 }],
  });
  assert.strictEqual(by(slow, 'outputs').state, 'ok', '165 Hz ekranın 60 çizmesi kart yetersizliği değil');
  assert.deepStrictEqual(by(slow, 'refresh').parts, ['Ekran 3: 165 Hz → 60 fps'], 'yalnız hızlı ekran');
  assert.match(by(slow, 'refresh').hint, /o ekrandaki çıkışı kapatın/);
  assert.ok(!by(S.evaluate({ outputs: [{ label: 'Ekran 2', fps: 60, target: 60, hz: 60, primaryHz: 75 }] }), 'refresh'));
  assert.ok(!by(S.evaluate({ outputs: [{ label: 'Ekran 3', fps: 75, target: 75, hz: 165, primaryHz: 0 }] }), 'refresh'), 'Windows dışı: birincil sınırı yok');
  assert.ok(!by(S.evaluate({ outputs: [{ label: 'Ekran 3', fps: 60, target: 60, cap: 60, hz: 165, primaryHz: 75 }] }), 'refresh'), 'sınır kullanıcının kendi kare sınırı');
  assert.ok(by(S.evaluate({ outputs: [{ label: 'Ekran 3', fps: 75, target: 75, cap: 120, hz: 165, primaryHz: 75 }] }), 'refresh'), 'birincilden yüksek sınır yine Windows sınırına takılır');
});

test('bağlantılar: ölçüm null, açılış payı, güvenli klasör açma, betik sırası, çeviriler', () => {
  const vis = read('src/visualizer/visualizer.js');
  assert.match(vis, /fps: fpsMeasured \? drawFps : null,/);
  assert.match(vis, /fpsT = now; fpsMeasured = true; \}/);
  const main = read('src/main/main.js');
  assert.match(main, /measuring: data\.fps === null/);
  assert.match(main, /outputOpenedAt\.set\(win, Date\.now\(\)\);/);
  assert.match(main, /const young = now - \(outputOpenedAt\.get\(win\) \|\| 0\) < 3000;/);
  assert.match(main, /if \(typeof p !== 'string' \|\| !preshowPaths\.has\(p\)\) return false;/, 'yalnız denetimin verdiği yol');
  // Ortak hız: birincil + açık çıkışların en yavaşı; hedef ve satır ona göre
  assert.match(main, /if \(d && d\.refreshRate && \(!best \|\| d\.refreshRate < best\.hz\)\) best = /);
  assert.match(main, /target: outputTarget\(displayId, fresh \? m\.cap : 0, shared\),/);
  assert.match(main, /sharedRate: shared,/);
  for (const k of ['Hızı en yavaş çıkış belirliyor.', 'Hızı birincil ekran belirliyor.']) assert.ok(read('src/main/preshow.js').includes(k));
  assert.match(main, /preshowPaths = new Set\(missing\.map\(\(x\) => x\.reveal\)\.filter\(Boolean\)\);/);
  // Açılacak yol yalnız VAR OLAN dosya/klasör: kayıp videonun klasörü yoksa düğme yok
  assert.match(main, /reveal: dir && fs\.existsSync\(dir\) \? dir : '', revealFile: false,/);
  assert.match(main, /kind === 'logo'\) \{\n      if \(libIds\.has\(r\.id\)\) continue;\n      out\.push\(Object\.assign\(\{\}, r, \{ name: r\.id, reason: 'absent', path: '', reveal: '', revealFile: false \}\)\);/);
  assert.match(read('src/admin/preshow-panel.js'), /if \(item\.reveal && window\.api\.preshowReveal\) \{/);
  // Aynı sayfada yazan kişinin imleci 3 sn'lik sonuçla gitmesin (ölçüldü)
  const pp = read('src/admin/preshow-panel.js');
  assert.match(pp, /return !!\(a && \/\^\(INPUT\|TEXTAREA\|SELECT\)\$\/\.test\(a\.tagName\) && !a\.closest\('\.preshow-panel'\)\);/);
  assert.match(pp, /document\.addEventListener\('focusout', \(\) => \{ deferred = false; setTimeout\(redraw, 0\); \}, \{ once: true \}\);/);
  assert.match(pp, /if \(changed\) redraw\(\);/);
  assert.match(read('src/main/preload-admin.js'), /preshowReveal: \(p\) => ipcRenderer\.invoke\('preshow:reveal', p\)/);
  const html = read('src/admin/index.html');
  assert.ok(html.indexOf('../shared/preshow-refs.js') > 0 && html.indexOf('../shared/preshow-refs.js') < html.indexOf('preshow-panel.js'));
  assert.match(read('src/main/presets-store.js'), /JSON\.parse\(String\(raw\)\.replace\(\/\^\\uFEFF\/, ''\)\)/);

  const i18n = read('src/shared/i18n.js');
  const panel = read('src/admin/preshow-panel.js');
  const pre = read('src/main/preshow.js');
  const strs = new Set();
  // Paneldeki sabit eşlemelerin değerleri, düğme ve onay metinleri
  const lit = "'((?:[^'\\\\]|\\\\.)*)'";
  const unq = (s) => s.replace(/\\'/g, "'");
  // Sabit eşlemelerin (KIND, FIELD, REASON, FIX, STATE, OVERALL) değerleri
  for (const blk of panel.matchAll(/const ([A-Z]+) = \{([\s\S]*?)\};/g)) {
    if (blk[1] === 'ICON') continue; // simge adları
    for (const m of blk[2].matchAll(new RegExp(':\\s*' + lit, 'g'))) strs.add(unq(m[1]));
  }
  // Öğe metinleri: text: '…' (kod değeri — sınıf/simge — değil, cümle ya da Türkçe kelime)
  for (const m of panel.matchAll(new RegExp('text: ' + lit, 'g'))) {
    const s = unq(m[1]);
    if (/[A-ZÇĞİÖŞÜçğıöşü]/.test(s) || / /.test(s.trim())) strs.add(s);
  }
  for (const m of panel.matchAll(new RegExp('text: \\w+ \\? ' + lit + ' : ' + lit, 'g'))) { strs.add(unq(m[1])); strs.add(unq(m[2])); }
  for (const m of panel.matchAll(/tr\('([^']+)'\)/g)) strs.add(m[1]);
  for (const m of pre.matchAll(/add\('[a-z]+', '[a-z]+', '([^']+)'/g)) strs.add(m[1]);
  for (const m of pre.matchAll(/hint: '([^']+)'/g)) strs.add(m[1]);
  // Ayrıntı başlıkları (group() bağımsız değişkeni) ve sayı etiketi
  ['Canlı sahnede', 'Yalnız kayıtlı sahnelerde', 'Geçtiği yer sayısı:'].forEach((s) => { assert.ok(panel.includes("'" + s + "'"), s); strs.add(s); });
  assert.ok(!panel.includes("tr('yer')"), 'İngilizcede "1 places" çıkıyordu');
  assert.ok(strs.size >= 40, String(strs.size));
  const quoted = (s) => "'" + s.replace(/'/g, "\\'") + "':";
  for (const s of strs) assert.ok(i18n.includes(quoted(s)), 'çeviri yok: ' + s);
});
