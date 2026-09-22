'use strict';
/* MILKDROP KÜTÜPHANESİ İÇE AKTARIMI (#574).

   Preset paketleri ZIP olarak dolaşıyor ve birçok kişinin makinesinde
   Winamp'tan, MilkDrop 3'ten, BeatDrop'tan ya da projectM'den kalma bir
   kütüphane zaten var. Bu modül ikisini de alıyor. Electron'a bağlı değil:
   klasörler ve dosyalar parametre, testler gerçek dosyalarla koşuyor.

   İKİ AŞAMA. Önce TARAMA (`scanFolder`, `scanZip`, `discover`): ne
   eklenecek, kaç MB, neler atlanacak — hiçbir şey kopyalanmıyor. Kullanıcı
   onaylarsa ÇALIŞTIRMA (`runImport`). "Sormadan hiçbir şey kopyalanmıyor."

   NE ALINIYOR
     - `.milk` dosyaları, iç içe klasörler dahil. Ad dosyanın adı.
     - Dokular: `textures` ya da `sprites` adlı klasörlerdeki görseller
       (MilkDrop 3 ikisini aynı sayıyor) ve bir presetin `sampler_<ad>` ile
       istediği, presetlerle aynı klasörde duran görseller — MilkDrop dokuyu
       bulamayınca presetin klasörüne de bakıyor. Ötekiler (önizleme ekran
       görüntüleri gibi) doku sayılmıyor.
   NE ALINMIYOR (sayılıp raporlanıyor)
     - `.milk2` (MilkDrop 3'ün çift preseti): motor bugün okumuyor (#567).
     - Sınırı aşan preset ve doku, şifreli ya da desteklenmeyen ZIP girdisi.
     - Aynı ad ve aynı içerikte zaten var olan preset (tekrar).

   Klasör adları istenirse ETİKET oluyor (#576): paketin kendi kategori
   klasörleri ("Fractal", "Dancer" …) — bütün presetlerin ortak ön eki
   atıldıktan sonraki ilk klasör. */
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const zip = require('./zip-reader');
const tex = require('./milkdrop-textures');

const PRESET_MAX_BYTES = 450 * 1024; // depo sınırı 512 KB JSON; kaçışlara pay
const TEXTURE_MAX_BYTES = 8 * 1024 * 1024; // görselleştiricinin doku sınırıyla aynı
const MAX_FILES = 200000;
const MAX_DEPTH = 12;
const MAX_TOTAL_BYTES = 2 * 1024 * 1024 * 1024;
const TEX_DIRS = ['textures', 'sprites'];
/* Motorun kendi örnekleyicileri: preset bunları istese de dosya değil. */
const BUILTIN_SAMPLERS = /^(main|fw_main|fc_main|pw_main|pc_main|noise_[lmh]q|noisevol_[lh]q|blur[123]|rand\d\d)(_|$)/i;

const lower = (s) => String(s || '').toLowerCase();
const extOf = (n) => path.extname(String(n || '')).toLowerCase();
const stem = (n) => path.basename(String(n || ''), path.extname(String(n || '')));

/* Doku adı güvenli mi: düz bir dosya adı, görsel uzantılı. Paketten gelen
   adlar güvenilmez; yalnız son parça kullanılıyor ve yine de denetleniyor. */
function safeTextureName(n) {
  const b = String(n || '');
  if (!b || b === '.' || b === '..' || /[\\/:]/.test(b) || b.length > 120) return false;
  return tex.isTextureFile(b);
}

/* Alınmayan yollar, iki tarayıcıda da aynı: macOS'un ZIP'e koyduğu
   `__MACOSX/` ve `._ad.milk` (AppleDouble — preset değil, ikili veri;
   alınsaydı bozuk preset olarak listede görünürdü), gizli klasörler ve
   `node_modules`. */
function skipPath(parts) {
  const name = parts[parts.length - 1] || '';
  if (name.indexOf('._') === 0) return true;
  for (let i = 0; i < parts.length - 1; i++) {
    const d = parts[i];
    if (d === '__MACOSX' || d === 'node_modules' || d[0] === '.') return true;
  }
  return false;
}

/* Parça listesi (klasörler + dosya adı) → preset kaydı. `parts` kökten
   göreli yolun parçaları. */
function classify(parts, size) {
  const name = parts[parts.length - 1];
  const dirs = parts.slice(0, -1);
  const ext = extOf(name);
  if (ext === '.milk') return { type: 'preset', name: stem(name), dirs, size };
  if (ext === '.milk2') return { type: 'milk2' };
  if (tex.isTextureFile(name)) {
    const inTexDir = dirs.some((d) => TEX_DIRS.indexOf(lower(d)) >= 0);
    return { type: inTexDir ? 'texture' : 'loose', name, dirs, size };
  }
  return { type: 'other' };
}

/* Bütün presetlerin ortak klasör ön eki atıldıktan sonra ilk klasör:
   paketin kategori klasörü. Genel adlar etiket olmuyor. */
const GENERIC = /^(presets?|milkdrop\d?|milkdrop ?presets?|resources|plugins)$/i;
function assignTags(presets) {
  if (!presets.length) return;
  let common = presets[0].dirs.slice();
  for (const p of presets) {
    let i = 0;
    while (i < common.length && i < p.dirs.length && common[i] === p.dirs[i]) i++;
    common = common.slice(0, i);
    if (!common.length) break;
  }
  for (const p of presets) {
    const rest = p.dirs.slice(common.length);
    const t = rest.find((d) => !GENERIC.test(d.trim()));
    p.tag = t ? t.trim().slice(0, 32) : '';
  }
}

/* `bytes` alınacak olanlar (presetler ve doku klasörlerindekiler);
   presetlerin yanındaki görseller `looseBytes`: yalnız bir preset isterse
   kopyalanıyor, hangisinin istendiği presetler okunmadan bilinmiyor. Birçok
   pakette her presetin yanında bir önizleme görüntüsü var; bunlar "doku"
   diye sayılsaydı özet olduğundan kat kat büyük görünürdü. */
function emptyPlan(kind, source, label) {
  return {
    kind, source, label,
    presets: [], textures: [], loose: [],
    bytes: 0, looseBytes: 0, complete: true,
    skipped: { milk2: 0, tooLarge: 0, encrypted: 0, unsupported: 0, textureTooLarge: 0 },
  };
}

function addEntry(plan, parts, size, ref) {
  if (skipPath(parts)) return;
  const c = classify(parts, size);
  if (c.type === 'milk2') { plan.skipped.milk2++; return; }
  if (c.type === 'preset') {
    if (size > PRESET_MAX_BYTES) { plan.skipped.tooLarge++; return; }
    plan.presets.push({ name: c.name, dirs: c.dirs, size, ref, tag: '' });
    plan.bytes += size;
  } else if (c.type === 'texture' || c.type === 'loose') {
    if (!safeTextureName(c.name)) return;
    if (size > TEXTURE_MAX_BYTES) { plan.skipped.textureTooLarge++; return; }
    if (c.type === 'texture') {
      plan.textures.push({ name: c.name, dirs: c.dirs, size, ref });
      plan.bytes += size;
    } else {
      plan.loose.push({ name: c.name, dirs: c.dirs, size, ref });
      plan.looseBytes += size;
    }
  }
}

/* KLASÖR. Eşzamansız ve sınırlı: `budget` { files, deadline }. `shallow`:
   alt klasörlere inilmiyor (makinede aramada İndirilenler'in kendisinde
   duran tek tek presetler — alt klasörler ayrı kütüphane). */
async function scanFolder(dir, opts) {
  const o = opts || {};
  const plan = emptyPlan('folder', dir, o.label || path.basename(dir));
  if (o.shallow) plan.shallow = true;
  const budget = o.budget || { files: MAX_FILES, deadline: Infinity };
  const walk = async (d, parts, depth) => {
    if (depth > MAX_DEPTH) return;
    let items;
    try { items = await fs.promises.readdir(d, { withFileTypes: true }); } catch { return; }
    for (const it of items) {
      if (budget.files <= 0 || Date.now() > budget.deadline) { plan.complete = false; return; }
      budget.files--;
      const full = path.join(d, it.name);
      if (it.isDirectory()) {
        // Alınmayacak klasöre hiç inilmiyor (bkz. `skipPath`)
        if (o.shallow || skipPath(parts.concat(it.name, 'x'))) continue;
        await walk(full, parts.concat(it.name), depth + 1);
      } else if (it.isFile()) {
        const ext = extOf(it.name);
        if (ext !== '.milk' && ext !== '.milk2' && !tex.isTextureFile(it.name)) continue;
        let size = 0;
        try { size = (await fs.promises.stat(full)).size; } catch { continue; }
        addEntry(plan, parts.concat(it.name), size, full);
      }
    }
  };
  await walk(dir, [], 0);
  finish(plan);
  return plan;
}

/* ZIP. Yalnız merkezi dizin okunuyor; içerik çalıştırmada. */
function scanZip(file, opts) {
  const o = opts || {};
  const plan = emptyPlan('zip', file, o.label || stem(file));
  const z = zip.open(file);
  try {
    for (const e of z.entries) {
      if (e.dir) continue;
      const parts = e.name.split(/[\\/]+/).filter((s) => s && s !== '.' && s !== '..');
      if (!parts.length || skipPath(parts)) continue;
      const c = classify(parts, e.size);
      if (c.type === 'other') continue;
      if (e.encrypted) { plan.skipped.encrypted++; continue; }
      if (e.method !== 0 && e.method !== 8) { plan.skipped.unsupported++; continue; }
      addEntry(plan, parts, e.size, e.index);
    }
  } finally {
    z.close();
  }
  finish(plan);
  return plan;
}

function finish(plan) {
  assignTags(plan.presets);
  if (plan.bytes > MAX_TOTAL_BYTES) plan.tooBig = true;
}

/* Özet: sayfaya giden; dosya listeleri ana süreçte kalıyor.
   `textures` kesin alınacaklar, `loose` presetlerin yanındaki görseller
   (yalnız istenenleri). `searchCut`: makinede aramanın süresi yetmedi,
   sayılar eksik — içe aktarmadan önce `rescan`. */
function summary(plan) {
  return {
    kind: plan.kind,
    label: plan.label,
    presets: plan.presets.length,
    textures: plan.textures.length,
    loose: plan.loose.length,
    bytes: plan.bytes,
    complete: plan.complete,
    searchCut: !!plan.searchCut,
    tooBig: !!plan.tooBig,
    skipped: Object.assign({}, plan.skipped),
    tags: Array.from(new Set(plan.presets.map((p) => p.tag).filter(Boolean))).length,
  };
}

/* Aynı kaynağın baştan sona taraması: aramada süresi yetmeyen kütüphane
   onaydan önce bununla sayılıyor. Aramanın bütçesi yok; yalnız her taramanın
   kendi sınırları (MAX_FILES). */
async function rescan(plan) {
  if (plan.kind === 'zip') return scanZip(plan.source, { label: plan.label });
  return scanFolder(plan.source, { label: plan.label, shallow: !!plan.shallow });
}

/* Preset metni: önce katı UTF-8, olmazsa Latin-1 (MilkDrop dosyaları
   çoğunlukla ANSI). Kod ASCII; yalnız yorumlar ve adlar etkileniyor. */
const UTF8 = new TextDecoder('utf-8', { fatal: true });
function decodeText(buf) {
  try { return UTF8.decode(buf); } catch { return buf.toString('latin1'); }
}

// Ad ile içerik özeti arasında dosya adında olamayacak bir ayırıcı
const SEP = String.fromCharCode(0);
const keyOf = (name, source) => name + SEP + crypto.createHash('sha1').update(source).digest('hex');

/* Presetin istediği dosya dokuları: `sampler_worms` → "worms". */
function samplerNames(source) {
  const out = new Set();
  const re = /\bsampler_([A-Za-z0-9_]+)/g;
  let m;
  while ((m = re.exec(source))) {
    const n = m[1];
    if (!BUILTIN_SAMPLERS.test(n)) out.add(lower(n));
  }
  return out;
}

/* ÇALIŞTIRMA. `deps`:
     existing()          — depodaki presetler (tekrar denetimi için)
     saveManyAsync(list, onProgress) — depoya parça parça kayıt
     textureDir          — dokuların kopyalanacağı klasör (yönetilen)
     onProgress(phase, done, total)
     newId()             — preset kimliği
   Dönüş: eklenen, atlanan ve başarısız sayıları; kaydedilenlerin kimliği ve
   etiketi (etiketleri ayara panel yazıyor). */
async function runImport(plan, deps) {
  const d = deps || {};
  const prog = typeof d.onProgress === 'function' ? d.onProgress : () => {};
  const result = {
    ok: true, added: 0, duplicates: 0, failed: 0,
    textures: { copied: 0, same: 0, conflicts: 0, failed: 0 },
    skipped: Object.assign({}, plan.skipped), saved: [],
  };
  const seen = new Set();
  for (const p of (typeof d.existing === 'function' ? d.existing() : []) || []) {
    if (p && p.kind === 'milkdrop' && typeof p.source === 'string') seen.add(keyOf(p.name || '', p.source));
  }
  let z = null;
  const readRef = (ref, max) => {
    if (plan.kind === 'zip') {
      if (!z) z = zip.open(plan.source);
      return z.read(z.entries[ref], max);
    }
    const st = fs.statSync(ref);
    if (st.size > max) throw new Error('TOO_LARGE');
    return fs.readFileSync(ref);
  };
  try {
    // 1) Presetler: oku, tekrarı ayıkla, parça parça kaydet
    const items = [];
    const tagOf = new Map();
    const wanted = new Set();
    const total = plan.presets.length;
    for (let i = 0; i < total; i++) {
      const it = plan.presets[i];
      let source;
      try { source = decodeText(readRef(it.ref, PRESET_MAX_BYTES)); } catch { result.failed++; continue; }
      /* İstenen dokular TEKRAR olan presetlerden de: kullanıcı dokuyu
         silmişse aynı paketi yeniden almak onu geri getirmeli. */
      for (const s of samplerNames(source)) wanted.add(s);
      const k = keyOf(it.name, source);
      if (seen.has(k)) { result.duplicates++; continue; }
      seen.add(k);
      const id = typeof d.newId === 'function' ? d.newId() : 'md_' + crypto.randomBytes(6).toString('hex');
      items.push({ id, kind: 'milkdrop', name: it.name, source });
      if (it.tag) tagOf.set(id, it.tag);
      if (i % 200 === 199) { prog('read', i + 1, total); await new Promise((r) => setImmediate(r)); }
    }
    prog('read', total, total);
    const saved = typeof d.saveManyAsync === 'function'
      ? await d.saveManyAsync(items, (done, all) => prog('save', done, all))
      : [];
    result.added = saved.length;
    result.failed += items.length - saved.length;
    result.saved = saved.map((p) => ({ id: p.id, tag: tagOf.get(p.id) || '' }));
    // Ana süreç yayın için alıyor; sayfaya dönmeden siliniyor (kaynaklar ağır)
    result.presets = saved;
    // 2) Dokular: klasördekiler hep, presetin yanındakiler yalnız istenirse
    const texList = plan.textures.concat(plan.loose.filter((t) => wanted.has(lower(stem(t.name)))));
    if (texList.length && d.textureDir) {
      fs.mkdirSync(d.textureDir, { recursive: true });
      for (let i = 0; i < texList.length; i++) {
        const t = texList[i];
        const dest = path.join(d.textureDir, t.name);
        try {
          const buf = readRef(t.ref, TEXTURE_MAX_BYTES);
          if (fs.existsSync(dest)) {
            const cur = fs.readFileSync(dest);
            if (cur.equals(buf)) result.textures.same++;
            else result.textures.conflicts++; // var olan kalıyor
          } else {
            await fs.promises.writeFile(dest, buf);
            result.textures.copied++;
          }
        } catch { result.textures.failed++; }
        if (i % 50 === 49) { prog('textures', i + 1, texList.length); await new Promise((r) => setImmediate(r)); }
      }
      prog('textures', texList.length, texList.length);
    }
  } finally {
    if (z) z.close();
  }
  return result;
}

/* MAKİNEDE ARAMA. Her aday bir kütüphane adayı: bilinen kurulum klasörleri
   (Winamp, foobar2000, projectM) ve taşınabilir kurulumların açıldığı
   kullanıcı klasörlerinin (İndirilenler, Masaüstü, Müzik, Belgeler) her alt
   klasörü ve yanlarındaki her ZIP. Kullanıcı klasörünün kendisinde tek tek
   duran presetler de bir aday; onun alt klasörlerine inilmiyor (onlar zaten
   ayrı aday).

   İKİ ADIM, ikisi de süre bütçesiyle (`budgetMs`; bulma en çok %60'ını
   kullanıyor, kalanı saymaya):
   1) BULMA (`findLibraries`) — genişlik öncelikli: bütün adayların ilk
      düzeyi, sonra ikincisi… Derinlik öncelikli tarama bütçeyi ilk dev
      klasöre (oyun, proje, fotoğraf arşivi) harcıyor ve yanındaki küçük
      pakete hiç varamıyordu; şimdi sığ duran bir kütüphane, komşusunun
      dibine inilmeden bulunuyor. İçinde bir `.milk` görülen aday kütüphane,
      altına artık inilmiyor. ZIP'in yalnız merkezi dizini okunuyor, sayımı da
      o veriyor; ZIP'ler arasında süre denetleniyor ve olay döngüsüne yol
      veriliyor (ana süreç yayını ve ışıkları da sürüyor).
   2) SAYMA (`countLibraries`) — bulunan klasörler baştan sona taranıyor,
      kalan süre aralarında paylaşılıyor; erken biten payını sonrakine
      bırakıyor. Süresi yetmeyen `searchCut`: sayılar eksik, panel içe
      aktarmadan önce `rescan` istiyor. Hiç süre kalmadıysa sayılmadan
      listeleniyor: bulunan kütüphane listeden düşmüyor, süre de aşılmıyor.
   Sıra: açıkça verilen kökler (`opts.roots`), bilinen kurulum klasörleri,
   sonra İndirilenler, Masaüstü, Müzik, Belgeler — paketin en çok indiği
   yerden en kalabalık olana. Kullanıcı klasörlerinin gerçek yeri `env`'den:
   Windows'ta OneDrive onları taşıyabiliyor, Linux'ta adları yerel dilde
   (~/İndirilenler); verilmezse ev klasörü + İngilizce ad.
   Sonuç `{ libraries, complete }`: bulma adımı bütçeye takılıp bütün
   adaylara bakamadıysa `complete: false`.
   `env`: { platform, home, appData, programFiles, programFilesX86,
            downloads, desktop, music, documents }. */
function candidates(env) {
  const e = env || {};
  const out = [];
  const add = (label, dir) => { if (dir) out.push({ label, dir }); };
  if (e.platform === 'win32') {
    for (const pf of [e.programFiles, e.programFilesX86]) {
      if (!pf) continue;
      add('Winamp (MilkDrop 2)', path.join(pf, 'Winamp', 'Plugins', 'Milkdrop2'));
      add('projectM', path.join(pf, 'projectM', 'presets'));
    }
    if (e.appData) {
      add('foobar2000 (MilkDrop 2)', path.join(e.appData, 'foobar2000-v2', 'milkdrop2'));
      add('foobar2000 (MilkDrop 2)', path.join(e.appData, 'foobar2000', 'milkdrop2'));
    }
  } else if (e.platform === 'darwin') {
    add('projectM', '/Applications/projectM.app/Contents/Resources/presets');
    if (e.home) add('projectM', path.join(e.home, 'Library', 'Application Support', 'projectM', 'presets'));
  } else {
    add('projectM', '/usr/share/projectM/presets');
    add('projectM', '/usr/local/share/projectM/presets');
    if (e.home) {
      add('projectM', path.join(e.home, '.projectM', 'presets'));
      add('projectM', path.join(e.home, '.local', 'share', 'projectM', 'presets'));
    }
  }
  return out;
}

// Kullanıcı klasörleri, paketin en çok indiği yerden en kalabalık olana
const HOME_ROOTS = [['downloads', 'Downloads'], ['desktop', 'Desktop'], ['music', 'Music'], ['documents', 'Documents']];
function homeRoots(env) {
  const e = env || {};
  const out = [];
  for (const [key, name] of HOME_ROOTS) {
    const dir = e[key] || (e.home ? path.join(e.home, name) : '');
    if (dir) out.push(dir);
  }
  return out;
}

const FIND_SHARE = 0.6;
/* Adayın İÇİNDE inilmeyen klasörler, yalnız ada bakılarak; adayın kendi
   yolu denetlenmiyor (~/.projectM/presets gizli bir klasörün altında). */
const skipDirName = (n) => n === '__MACOSX' || n === 'node_modules' || n[0] === '.';
const isPresetFile = (n) => extOf(n) === '.milk' && n.indexOf('._') !== 0;
const tick = () => new Promise((r) => setImmediate(r));

async function isDir(p) {
  try { return (await fs.promises.stat(p)).isDirectory(); } catch { return false; }
}

/* 1) BULMA. Dönüş `{ found, complete }`; `found` sırayla { label, dir,
   shallow?, plan? } — ZIP'lerin planı bulunurken hazır. `maxFiles` bakılan
   girdi sayısını sınırlıyor (testler süreye değil buna dayanıyor). */
async function findLibraries(env, opts) {
  const e = env || {};
  const o = opts || {};
  const until = Date.now() + Math.round((o.budgetMs || 8000) * FIND_SHARE);
  let files = o.maxFiles || MAX_FILES;
  let complete = true;
  const over = () => {
    if (files > 0 && Date.now() <= until) return false;
    complete = false;
    return true;
  };
  const tops = [];
  const seen = new Set();
  const add = (t) => {
    const key = lower(path.resolve(t.dir)) + (t.shallow ? '|kendisi' : '');
    if (seen.has(key)) return;
    seen.add(key);
    tops.push(t);
  };
  // Kök: alt klasörleri ve ZIP'leri aday; kendisinde preset varsa o da
  const expand = async (root) => {
    let items;
    try { items = await fs.promises.readdir(root, { withFileTypes: true }); } catch { return; }
    files -= items.length;
    let loose = false;
    for (const it of items) {
      if (it.isDirectory()) {
        if (!skipDirName(it.name)) add({ label: it.name, dir: path.join(root, it.name) });
      } else if (it.isFile()) {
        if (extOf(it.name) === '.zip') add({ label: it.name, dir: path.join(root, it.name), zip: true });
        else if (isPresetFile(it.name)) loose = true;
      }
    }
    if (loose) add({ label: path.basename(root), dir: root, shallow: true, found: true });
  };
  for (const r of o.roots || []) { if (over()) break; await expand(r); }
  for (const c of candidates(e)) if (await isDir(c.dir)) add({ label: c.label, dir: c.dir });
  for (const r of homeRoots(e)) { if (over()) break; await expand(r); }

  // Genişlik öncelikli: `level` bu derinlikte bakılacak klasörler, aday sırasıyla
  let level = tops.filter((t) => !t.found).map((t) => ({ top: t, dir: t.dir }));
  for (let depth = 0; level.length && complete; depth++) {
    const next = [];
    for (const q of level) {
      if (q.top.found) continue;
      if (over()) break;
      if (q.top.zip) {
        try {
          const plan = scanZip(q.dir, { label: q.top.label });
          if (plan.presets.length) { q.top.found = true; q.top.plan = plan; }
        } catch { /* ZIP değil ya da bozuk: listelenmiyor */ }
        files--;
        await tick();
        continue;
      }
      let items;
      try { items = await fs.promises.readdir(q.dir, { withFileTypes: true }); } catch { continue; }
      files -= items.length;
      for (const it of items) {
        if (it.isFile() && isPresetFile(it.name)) { q.top.found = true; break; }
        if (it.isDirectory() && depth < MAX_DEPTH && !skipDirName(it.name)) next.push({ top: q.top, dir: path.join(q.dir, it.name) });
      }
    }
    level = next;
  }
  return { found: tops.filter((t) => t.found), complete };
}

/* 2) SAYMA. Bulunan klasörler `deadline`a kadar, kalan süre aralarında
   paylaşılarak; ZIP'ler zaten sayılı. Süresi yetmeyen ya da hiç süre
   kalmayan `searchCut` diyor ve yine listeleniyor. */
async function countLibraries(found, deadline) {
  const out = [];
  let left = found.filter((t) => !t.plan).length;
  for (const t of found) {
    let plan = t.plan;
    if (!plan) {
      const ms = deadline - Date.now();
      if (ms > 0) {
        const budget = { files: MAX_FILES, deadline: Date.now() + Math.max(1, Math.floor(ms / left)) };
        plan = await scanFolder(t.dir, { label: t.label, shallow: t.shallow, budget });
      } else {
        plan = emptyPlan('folder', t.dir, t.label);
        if (t.shallow) plan.shallow = true;
        plan.complete = false;
      }
      left--;
      if (!plan.complete) plan.searchCut = true;
    }
    if (plan.presets.length || plan.searchCut) out.push(plan);
  }
  return out;
}

async function discover(env, opts) {
  const o = opts || {};
  const deadline = Date.now() + (o.budgetMs || 8000);
  const r = await findLibraries(env, o);
  return { libraries: await countLibraries(r.found, deadline), complete: r.complete };
}

module.exports = {
  PRESET_MAX_BYTES, TEXTURE_MAX_BYTES, MAX_FILES, MAX_TOTAL_BYTES,
  scanFolder, scanZip, rescan, runImport, summary, discover, findLibraries, countLibraries,
  candidates, homeRoots, samplerNames, decodeText, assignTags,
};
