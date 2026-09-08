'use strict';
/* MilkDrop RENDER kalitesini ÖLÇER — derleme oranının göremediği katman.
 *
 * Neden ayrı bir betik: scripts/milkdrop-compile-rate.js shader'ların
 * DERLENDİĞİNİ ölçüyor ve o sayı %100. Ama derlenen bir shader siyah
 * ekran da verebilir, bembeyaz patlayabilir, ya da ilk kareden sonra
 * donabilir. Derleme ölçümü üçünü de "başarılı" sayar. Presetin gerçekten
 * GÖRÜNTÜ ürettiğini yalnız pikselleri okuyarak bilebiliriz.
 *
 * Neden Electron: motor gerçek bir WebGL2 bağlamında, gerçek FBO'larla ve
 * gerçek geri besleme döngüsüyle koşuyor. Geri besleme kareler arasında
 * biriktiği için TEK kare ölçmek yetmez — donma ve patlama ancak kare
 * dizisine bakınca görünür.
 *
 * Ölçülen sınıflar:
 *   siyah   : hiçbir karede görünür piksel yok (derleniyor, çizmiyor)
 *   donmuş  : 4. kareden sonra kareler arası fark ~0 (geri besleme akmıyor)
 *   patlamış: son karelerde ortalama parlaklık ~1 (geri besleme kaçmış)
 *   hata    : draw() istisna attı
 *   temiz   : yukarıdakilerin hiçbiri
 *
 * Ölçüm YENİDEN ÜRETİLEBİLİR: Math.random tohumlanıyor, ses sentetik ve
 * kare başına deterministik. Aynı korpus + aynı kod = aynı sayı.
 *
 * Kullanım:
 *   node scripts/milkdrop-render-rate.js <preset klasörü>
 *   node scripts/milkdrop-render-rate.js <klasör> --frames=24 --json=rapor.json
 *   node scripts/milkdrop-render-rate.js <klasör> --limit=50 --show=5
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
const SAMPLE = Number(flag('sample', 0)) || 0;
const SHOW = Number(flag('show', 4)) || 4;
const FRAMES = Number(flag('frames', 20)) || 20;
const JSON_OUT = flag('json', '');
const WIDTH = Number(flag('width', 240)) || 240;
const HEIGHT = Number(flag('height', 180)) || 180;

if (!corpus) {
  console.error('Preset klasörü verilmedi.\n' +
    '  node scripts/milkdrop-render-rate.js <klasör> [--frames=N] [--limit=N] [--json=dosya]');
  process.exit(2);
}

// --- Node tarafı: kendini Electron ile yeniden başlat ------------------------

if (!process.versions.electron) {
  const { spawn } = require('child_process');
  const electronPath = require('electron');
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
const crypto = require('crypto');

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
  // Aynı preset iki kez ölçülmesin (paketlerde iç içe kopya klasörler var).
  const seen = new Set();
  const uniq = [];
  for (const p of out) {
    let h;
    try { h = crypto.createHash('sha1').update(fs.readFileSync(p)).digest('hex'); }
    catch (e) { continue; }
    if (seen.has(h)) continue;
    seen.add(h);
    uniq.push(p);
  }
  if (LIMIT) return uniq.slice(0, LIMIT);
  /* Tohumlu örnekleme. `--limit` alfabetik ilk N'i alıyor ve bu YANLI: aynı
     yazarın peş peşe duran presetleri seçiliyor. 10.000 presetin tamamını
     render etmek saatler sürdüğü için temsili bir kesit gerekiyor; tohum
     sabit olduğu için kesit koşudan koşuya AYNI kalıyor ve iki ölçüm
     karşılaştırılabilir oluyor. */
  if (SAMPLE && SAMPLE < uniq.length) {
    let s = 20260908;
    const rnd = () => { s = (s * 1103515245 + 12345) % 2147483648; return s / 2147483648; };
    const a = uniq.slice();
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(rnd() * (i + 1));
      const t = a[i]; a[i] = a[j]; a[j] = t;
    }
    return a.slice(0, SAMPLE).sort();
  }
  return uniq;
}

/* Sayfaya yüklenecek motor dosyaları. Görselleştirici HTML'inin yüklediği
   listenin MilkDrop'a ait alt kümesi — sırası önemli, sonrakiler
   öncekilerin window global'lerine bakıyor. */
const ENGINE = [
  'src/shared/milkdrop.js',
  'src/shared/milkdrop-audio.js',
  'src/shared/milkdrop-hlsl.js',
  'src/shared/milkdrop-shader.js',
  'src/visualizer/modes/milkdrop.js',
];

/* Sayfa içinde koşan ölçüm harness'ı. Ayrı bir metin olarak duruyor ki
   şablon değişkeni yalnız üç sayı olsun ve gerisi olduğu gibi okunsun. */
function pageHarness() {
  return `
    (function () {
      var W = ${WIDTH}, H = ${HEIGHT}, N = ${FRAMES};

      /* Tohumlu rastgelelik: rand_preset ve preset içi rastgele değerler her
         koşuda AYNI olsun, yoksa ölçüm koşudan koşuya oynar ve "değişiklik
         işe yaradı mı?" sorusu cevaplanamaz. */
      var _seed = 1;
      Math.random = function () {
        _seed = (_seed * 1103515245 + 12345) % 2147483648;
        return _seed / 2147483648;
      };

      var canvas = document.createElement('canvas');
      canvas.width = W; canvas.height = H;
      document.body.appendChild(canvas);
      window.__mode = new window.SVModes.milkdrop(canvas);
      window.__ctx = canvas.getContext('2d');

      /* Sentetik ses — 120 BPM'lik vuruş, kare indisine bağlı, deterministik.
         Sessiz girdi çoğu preseti hareketsiz bırakıp "donmuş" gösterirdi. */
      window.__audio = function (i) {
        var t = i / 30;
        var beat = Math.pow(Math.max(0, 1 - ((t * 2) % 1) * 2.2), 2);
        var time = new Uint8Array(2048);
        for (var k = 0; k < 2048; k++) {
          var u = k / 2048;
          var s = Math.sin(u * Math.PI * 2 * 4 + t * 5.2) * 0.40 * (0.4 + beat) +
                  Math.sin(u * Math.PI * 2 * 6.03 + t * 3.1) * 0.22;
          time[k] = Math.max(0, Math.min(255, 128 + s * 118));
        }
        return {
          bass: 0.45 + 0.45 * beat,
          mid: 0.35 + 0.25 * Math.abs(Math.sin(t * 0.7)),
          treble: 0.25 + 0.2 * Math.abs(Math.sin(t * 1.3)),
          timeBytes: time,
        };
      };

      /* Bir karenin özeti. Pikseller 8'er atlanarak taranıyor: ölçüm için
         yeterli, tam tarama ölçümün kendisini dakikalarca sürdürüyor. */
      window.__stat = function () {
        var d = window.__ctx.getImageData(0, 0, W, H).data;
        var n = 0, sum = 0, mx = 0, nonblack = 0, sig = 0;
        for (var p = 0; p < d.length; p += 32) {
          var l = (d[p] * 0.299 + d[p + 1] * 0.587 + d[p + 2] * 0.114) / 255;
          sum += l; if (l > mx) mx = l; if (l > 0.02) nonblack++;
          sig += l * ((p % 7) + 1);
          n++;
        }
        return { mean: sum / n, max: mx, nonblack: nonblack / n, sig: sig / n };
      };

      window.__run = function (source, id) {
        var cfg = {
          milkdrop: { presetId: id, source: source, maxSize: 1920 },
          visualizer: { sensitivity: 1 },
        };
        var frames = [], err = '';
        for (var i = 0; i < N; i++) {
          try {
            window.__mode.draw(window.__audio(i), cfg, i / 30, 1 / 30);
          } catch (e) {
            err = 'draw: ' + (e && e.message ? e.message : String(e));
            break;
          }
          frames.push(window.__stat());
        }
        return {
          err: err,
          modeError: window.__mode.error || '',
          note: window.__mode.shaderNote || '',
          warpProg: !!window.__mode.warpPreset,
          compProg: !!window.__mode.compPreset,
          frames: frames,
        };
      };
      return true;
    })();
  `;
}

/* Sınıflandırma. Eşikler bilinçli olarak GEVŞEK: amaç "biraz sönük"
   presetleri yakalamak değil, TAMAMEN bozuk olanları ayırmak. Dar bir eşik
   ölçümü gürültüye boğar ve hiçbir değişikliğin etkisi görünmez. */
function classify(r) {
  if (r.err) return { cls: 'hata', why: r.err };
  if (!r.frames.length) return { cls: 'hata', why: 'hiç kare yok' };
  const last = r.frames.slice(Math.max(0, r.frames.length - 8));
  const maxOfMax = r.frames.reduce((a, f) => Math.max(a, f.max), 0);
  const meanLast = last.reduce((a, f) => a + f.mean, 0) / last.length;
  /* Kareler arası hareket 4. kareden sonra ölçülüyor: ilk kareler geri
     besleme daha dolmadan zaten farklı çıkar ve donmuş bir preseti bile
     hareketli gösterir. */
  let move = 0, cnt = 0;
  for (let i = 4; i < r.frames.length; i++) {
    move += Math.abs(r.frames[i].sig - r.frames[i - 1].sig);
    cnt++;
  }
  move = cnt ? move / cnt : 0;

  if (maxOfMax < 0.02) return { cls: 'siyah', why: 'hiçbir karede görünür piksel yok' };
  if (meanLast > 0.97) return { cls: 'patlamış', why: 'son karelerde ortalama parlaklık ' + meanLast.toFixed(3) };
  if (move < 1e-4) return { cls: 'donmuş', why: 'kareler arası hareket ' + move.toExponential(1) };
  return { cls: 'temiz', why: '' };
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
    width: 320,
    height: 240,
    webPreferences: { offscreen: false, backgroundThrottling: false },
  });
  await win.loadURL('about:blank');

  const root = path.join(__dirname, '..');
  for (const rel of ENGINE) {
    const code = fs.readFileSync(path.join(root, rel), 'utf-8');
    await win.webContents.executeJavaScript(code + '\n;0;');
  }

  const ready = await win.webContents.executeJavaScript(
    '!!(window.SVMilkdrop && window.SVMilkdropShader && window.SVMilkdropAudio ' +
    '&& window.SVModes && window.SVModes.milkdrop)');
  if (!ready) {
    console.error('Motor yüklenemedi — window.SVModes.milkdrop yok.');
    app.exit(1);
    return;
  }
  await win.webContents.executeJavaScript(pageHarness());

  const results = [];
  let done = 0;
  process.stdout.write('render ediliyor: ' + files.length + ' preset');
  for (const file of files) {
    let text;
    try { text = fs.readFileSync(file, 'latin1'); } catch (e) {
      results.push({ file, cls: 'hata', why: 'dosya okunamadı', note: '', fixed: false });
      continue;
    }
    let r;
    try {
      r = await win.webContents.executeJavaScript(
        'window.__run(' + JSON.stringify(text) + ',' + JSON.stringify(file) + ')');
    } catch (e) {
      results.push({ file, cls: 'hata', why: 'harness: ' + (e && e.message), note: '', fixed: false });
      continue;
    }
    const c = classify(r);
    /* Sabit yola düşmek AYRI bir eksiklik: görüntü çıkıyor ama presetin
       kendi shader'ı değil, motorun genel yolu çiziyor. */
    const fixed = /derlenmedi|çeviri hatası|çevrilemez/.test(r.note || '');
    results.push({
      file, cls: c.cls, why: c.why, note: r.note || '',
      modeError: r.modeError || '', fixed,
      warpProg: r.warpProg, compProg: r.compProg,
    });
    if (++done % 20 === 0) process.stdout.write('.');
  }
  process.stdout.write('\n');

  const byCls = new Map();
  for (const r of results) {
    const e = byCls.get(r.cls) || { n: 0, ex: [] };
    e.n++;
    if (e.ex.length < SHOW) e.ex.push(path.basename(r.file) + (r.why ? '  — ' + r.why : ''));
    byCls.set(r.cls, e);
  }
  const clean = (byCls.get('temiz') || { n: 0 }).n;
  const fixedPath = results.filter((r) => r.fixed).length;
  const soft = results.filter((r) => /yaklaşık/.test(r.note)).length;
  const pct = (a, b) => (b ? (a * 100 / b).toFixed(1) : '0.0');

  console.log('');
  console.log('korpus          : ' + corpus);
  console.log('preset          : ' + results.length + '   kare/preset: ' + FRAMES +
    '   çözünürlük: ' + WIDTH + 'x' + HEIGHT);
  console.log('');
  console.log('GÖRÜNTÜ ÜRETEN  : ' + clean + ' / ' + results.length + '  -> ' + pct(clean, results.length) + '%');
  console.log('sabit yola düşen: ' + fixedPath + '  (shader derlenmedi, motorun genel yolu çizdi)');
  console.log('doku yaklaşık   : ' + soft + '  (preset dokusu yok, gürültüyle ikame edildi)');
  console.log('');
  console.log('SINIFLARA GÖRE');
  for (const [cls, e] of Array.from(byCls.entries()).sort((a, b) => b[1].n - a[1].n)) {
    console.log('  ' + String(e.n).padStart(5) + '  ' + cls);
    for (const x of e.ex) console.log('           · ' + x);
  }

  if (JSON_OUT) {
    fs.writeFileSync(JSON_OUT, JSON.stringify({
      corpus, presets: results.length, frames: FRAMES,
      clean, cleanPct: Number(pct(clean, results.length)),
      fixedPath, soft,
      classes: Array.from(byCls.entries()).map(([cls, e]) => ({ cls, count: e.n })),
      results,
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
