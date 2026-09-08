'use strict';
/* MilkDrop shader derleme oranını ÖLÇER ve başarısızlıkları nedenine göre gruplar.
 *
 * Neden bu betik var: v3.1.2'de "stage'lerin %91,7'si derleniyor" ölçümü
 * yapıldı ama geride tekrar edilebilir hiçbir şey kalmadı — ne korpus, ne
 * betik. Sayı sürüm notunda bir cümleydi. Bu yüzden "yaptığım değişiklik
 * oranı artırdı mı?" sorusu cevaplanamaz durumdaydı. Artık cevaplanabilir.
 *
 * Neden Electron: metrik GERÇEK bir WebGL2 bağlamında ölçülüyor. Çevirinin
 * GLSL üretmesi yetmez — sürücü onu reddedebilir (tip hatası, tanımsız
 * değişken). Yalnız çeviriye bakan bir ölçüm gerçekte olmayan bir başarı
 * gösterir. Betik Node'dan başlatıldığında kendini Electron ile yeniden
 * çalıştırır.
 *
 * Kullanım:
 *   node scripts/milkdrop-compile-rate.js <preset klasörü>
 *   node scripts/milkdrop-compile-rate.js <klasör> --json=rapor.json
 *   node scripts/milkdrop-compile-rate.js <klasör> --limit=200
 *   node scripts/milkdrop-compile-rate.js <klasör> --show=5   (örnek başına kaç preset adı)
 *
 * Çıktı: toplam stage, derlenen stage, tamamı temiz preset yüzdesi ve
 * başarısızlıkların neden bazında sıklık listesi. O liste, iş kuyruğudur.
 */
const path = require('path');
const fs = require('fs');

const argv = process.argv.slice(process.versions.electron ? 1 : 2);
const flag = (name, def) => {
  const hit = argv.find((a) => a.startsWith('--' + name + '='));
  return hit ? hit.slice(name.length + 3) : def;
};
const corpus = argv.find((a) => !a.startsWith('--') && !a.endsWith('.js'));
const LIMIT = Number(flag('limit', 0)) || 0;
const SHOW = Number(flag('show', 3)) || 3;
const JSON_OUT = flag('json', '');

if (!corpus) {
  console.error('Preset klasörü verilmedi.\n' +
    '  node scripts/milkdrop-compile-rate.js <klasör> [--limit=N] [--show=N] [--json=dosya]');
  process.exit(2);
}

// --- Node tarafı: kendini Electron ile yeniden başlat ------------------------

if (!process.versions.electron) {
  const { spawn } = require('child_process');
  const electronPath = require('electron'); // Node'da ikilinin yolu
  const env = Object.assign({}, process.env);
  delete env.ELECTRON_RUN_AS_NODE;
  const child = spawn(electronPath, [__filename].concat(argv), {
    stdio: 'inherit',
    cwd: path.join(__dirname, '..'),
    env,
  });
  child.on('close', (code) => process.exit(code));
  return;
}

// --- Electron tarafı --------------------------------------------------------

const { app, BrowserWindow } = require('electron');
const MD = require(path.join(__dirname, '..', 'src', 'shared', 'milkdrop.js'));
const SH = require(path.join(__dirname, '..', 'src', 'shared', 'milkdrop-shader.js'));

app.disableHardwareAcceleration === undefined; // (dokunma: GPU gerekiyor)

function listPresets(dir) {
  const out = [];
  const walk = (d) => {
    let entries;
    try { entries = fs.readdirSync(d, { withFileTypes: true }); } catch (e) { return; }
    for (const e of entries) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) walk(p);
      else if (e.name.toLowerCase().endsWith('.milk')) out.push(p);
    }
  };
  walk(dir);
  out.sort();
  return LIMIT ? out.slice(0, LIMIT) : out;
}

/* Sürücü hatasını gruplanabilir bir imzaya indirger.
   'ERROR: 0:41: 'foo' : undeclared identifier' -> "undeclared identifier"
   Satır numarası ve değişken adı atılıyor; kalan, HATANIN TÜRÜ. */
function signature(log) {
  const first = String(log || '').split('\n').map((s) => s.trim()).filter(Boolean)[0] || 'bilinmeyen';
  let s = first
    .replace(/^ERROR:\s*\d+:\d+:\s*/i, '')
    .replace(/^WARNING:\s*\d+:\d+:\s*/i, '')
    .replace(/'[^']*'/g, "'X'")
    .replace(/\s+/g, ' ')
    .trim();
  if (s.length > 120) s = s.slice(0, 120) + '…';
  return s;
}

async function main() {
  const files = listPresets(corpus);
  if (!files.length) {
    console.error('Klasörde .milk bulunamadı: ' + corpus);
    app.exit(2);
    return;
  }

  const win = new BrowserWindow({
    show: false,
    width: 64,
    height: 64,
    webPreferences: { offscreen: false, backgroundThrottling: false },
  });
  await win.loadURL('about:blank');

  await win.webContents.executeJavaScript(`
    window.__c = document.createElement('canvas');
    window.__gl = window.__c.getContext('webgl2');
    window.__compile = function (list) {
      var gl = window.__gl, out = [];
      for (var i = 0; i < list.length; i++) {
        var sh = gl.createShader(gl.FRAGMENT_SHADER);
        gl.shaderSource(sh, list[i]);
        gl.compileShader(sh);
        var ok = gl.getShaderParameter(sh, gl.COMPILE_STATUS);
        out.push(ok ? '' : (gl.getShaderInfoLog(sh) || 'bilinmeyen'));
        gl.deleteShader(sh);
      }
      return out;
    };
    !!window.__gl;
  `);

  const hasGL = await win.webContents.executeJavaScript('!!window.__gl');
  if (!hasGL) {
    console.error('WebGL2 bağlamı alınamadı — ölçüm yapılamaz.');
    app.exit(1);
    return;
  }

  /* Her stage'i tek tek değil, toplu gönderiyoruz: 2000+ ayrı
     executeJavaScript çağrısı ölçümün kendisini dakikalarca sürdürüyordu. */
  const BATCH = 60;
  const stages = [];   // {file, stage, glsl} — yalnız derlenmeye ADAY olanlar
  const failures = []; // {file, stage, reason}
  let total = 0;       // boş olmayan tüm stage'ler
  const perPreset = new Map(); // dosya -> {total, bad}

  const bump = (file, bad) => {
    const e = perPreset.get(file) || { total: 0, bad: 0 };
    e.total++;
    if (bad) e.bad++;
    perPreset.set(file, e);
  };

  let unreadable = 0;
  for (const file of files) {
    let text;
    try { text = fs.readFileSync(file, 'latin1'); } catch (e) { unreadable++; continue; }

    let preset;
    try { preset = MD.parseMilk(text); } catch (e) {
      // Ayrıştırma çöktüyse iki stage'i de başarısız say: preset çalışmaz.
      total += 2;
      bump(file, true); bump(file, true);
      failures.push({ file, stage: 'parse', reason: 'parseMilk hata: ' + (e && e.message) });
      failures.push({ file, stage: 'parse', reason: 'parseMilk hata: ' + (e && e.message) });
      continue;
    }

    for (const stage of ['warp', 'comp']) {
      const src = stage === 'warp' ? preset.warpShader : preset.compShader;
      let r;
      try { r = SH.translate(src, { stage }); } catch (e) {
        total++; bump(file, true);
        failures.push({ file, stage, reason: 'çeviri çöktü: ' + (e && e.message) });
        continue;
      }
      if (r.empty) continue;         // shader'ı olmayan preset: stage yok
      total++;
      if (r.hard.length) {           // çeviri baştan "koşturma" dedi
        bump(file, true);
        failures.push({ file, stage, reason: 'çevrilemez: ' + r.hard.join(', ') });
        continue;
      }
      stages.push({ file, stage, glsl: r.glsl });
    }
  }

  process.stdout.write('derleniyor: ' + stages.length + ' stage');
  let compiled = 0;
  for (let i = 0; i < stages.length; i += BATCH) {
    const chunk = stages.slice(i, i + BATCH);
    const logs = await win.webContents.executeJavaScript(
      'window.__compile(' + JSON.stringify(chunk.map((s) => s.glsl)) + ')');
    for (let k = 0; k < chunk.length; k++) {
      const bad = !!logs[k];
      bump(chunk[k].file, bad);
      /* Ham günlük de saklanıyor: imza gruplamak için, ham metin ise
         hatayı GERÇEKTEN düzeltmek için gerekiyor — imzada değişken adı
         atılmış oluyor ve düzeltilecek şeyin ne olduğu kayboluyor. */
      if (bad) failures.push({ file: chunk[k].file, stage: chunk[k].stage, reason: signature(logs[k]), raw: String(logs[k]).trim().slice(0, 400), glsl: chunk[k].glsl });
      else compiled++;
    }
    process.stdout.write('.');
  }
  process.stdout.write('\n');

  let cleanPresets = 0;
  for (const [, e] of perPreset) if (e.bad === 0) cleanPresets++;
  const presetsWithStages = perPreset.size;

  const pct = (a, b) => (b ? (a * 100 / b).toFixed(1) : '0.0');

  console.log('');
  console.log('korpus            : ' + corpus);
  console.log('preset dosyası    : ' + files.length + (unreadable ? ' (' + unreadable + ' okunamadı)' : ''));
  console.log('shader\'ı olan     : ' + presetsWithStages);
  console.log('');
  console.log('STAGE  toplam ' + total + '  derlenen ' + compiled + '  -> ' + pct(compiled, total) + '%');
  console.log('PRESET tamamı temiz ' + cleanPresets + ' / ' + presetsWithStages + '  -> ' + pct(cleanPresets, presetsWithStages) + '%');

  const byReason = new Map();
  for (const f of failures) {
    const e = byReason.get(f.reason) || { n: 0, files: [] };
    e.n++;
    if (e.files.length < SHOW) e.files.push(path.basename(f.file) + ' [' + f.stage + ']');
    byReason.set(f.reason, e);
  }
  const sorted = Array.from(byReason.entries()).sort((a, b) => b[1].n - a[1].n);

  console.log('');
  console.log('BAŞARISIZ STAGE\'LER, NEDENE GÖRE (' + failures.length + ' toplam, ' + sorted.length + ' ayrı neden)');
  for (const [reason, e] of sorted) {
    console.log('  ' + String(e.n).padStart(5) + '  ' + reason);
    for (const f of e.files) console.log('           · ' + f);
  }

  if (JSON_OUT) {
    fs.writeFileSync(JSON_OUT, JSON.stringify({
      corpus, presets: files.length, presetsWithStages,
      stagesTotal: total, stagesCompiled: compiled,
      stagePct: Number(pct(compiled, total)),
      cleanPresets, cleanPct: Number(pct(cleanPresets, presetsWithStages)),
      reasons: sorted.map(([reason, e]) => ({ reason, count: e.n, examples: e.files })),
      failures,
    }, null, 1), 'utf-8');
    console.log('\nJSON: ' + JSON_OUT);
  }

  app.exit(0);
}

app.whenReady().then(() => {
  main().catch((e) => {
    console.error('ölçüm çöktü: ' + (e && e.stack || e));
    app.exit(1);
  });
});
