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
 *   node scripts/milkdrop-render-rate.js <klasör> --textures=<doku klasörü>
 *   node scripts/milkdrop-render-rate.js <klasör> --legacy
 *
 * `--textures` verilmezse kullanıcı dokusu isteyen presetler gürültüyle
 * ikame edilir — ölçümün bugüne kadarki hâli. Verilirse doku paketi sayfaya
 * yükleniyor ve o presetler GERÇEK görsellerle render ediliyor; ikisi
 * arasındaki fark doku yükleyicinin korpus ölçeğinde ne kazandırdığıdır.
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
const TEXDIR = flag('textures', '');
/* `--legacy` "MilkDrop uyumu" anahtarini KAPATIYOR. Anahtarin kapali hali
   de olculebilir olmali: kullaniciya sunulan bir yol, olculmemis bir yol
   olmamali. */
const LEGACY = argv.indexOf('--legacy') >= 0;

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

/* ILERLEME CIKTISI OLCUMU DUSUREMEZ.

   Harness ilerlemeyi stdout'a nokta nokta yaziyor. Cagiran taraf boruyu
   kapatirsa (kabuk cikti, log dosyasi kapandi, kullanici pencereyi
   kapatti) bu yazma EPIPE atiyor ve Electron ana surecte yakalanmamis
   istisnayi MODAL BIR HATA KUTUSUYLA gosteriyor — ekranin ortasinda,
   olcum de yarida kaliyor.

   Ilerleme noktasi sustuklu bir sey: yazilamamasi olcumun sonucunu
   degistirmiyor. Bu yuzden hem akisin hata olayi yutuluyor hem de her
   yazma denemesi kendi icinde korunuyor. */
process.stdout.on('error', (e) => { if (!e || e.code !== 'EPIPE') throw e; });
process.stderr.on('error', (e) => { if (!e || e.code !== 'EPIPE') throw e; });
const emit = (t) => { try { process.stdout.write(t); } catch (e) { /* boru kapali */ } };
const say = (t) => emit(t + '\n');

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
      var TEXDIR = ${JSON.stringify(TEXDIR)};
      var ACCURATE = ${LEGACY ? 'false' : 'true'};

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
        /* Sentetik TAYF. 'spectrum = 1' yazan ozel dalgalar frekans
           verisi okuyor; vermezsek o yol olcumde hic calismaz ve
           degisikligi gorunmez olur. Bas agirlikli, vurusla oynayan
           ve kare indisine bagli — sesin kendisi gibi deterministik. */
        var freq = new Float32Array(512);
        for (var q = 0; q < 512; q++) {
          var fu = q / 512;
          freq[q] = Math.max(0, Math.min(1,
            (1 - fu) * (0.35 + 0.5 * beat) +
            0.15 * Math.abs(Math.sin(fu * 22 + t * 2.1))));
        }
        return {
          bass: 0.45 + 0.45 * beat,
          mid: 0.35 + 0.25 * Math.abs(Math.sin(t * 0.7)),
          treble: 0.25 + 0.2 * Math.abs(Math.sin(t * 1.3)),
          timeBytes: time,
          freq: freq,
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

      /* Doku paketini ÖLÇÜM BAŞLAMADAN önce sıcak hâle getirir.

         Neden ölçüm döngüsünden önce: doku yükleme asenkron, çizim döngüsü
         bekleyemiyor. Ölçüm sırasında ısıtsaydık ilk kareler gürültüyle,
         sonrakiler görselle çizilirdi — kareler arası fark yapay olarak
         büyür ve "donmuş" sınıfı olduğundan az görünürdü.

         Neden ısıtma karesi ÇİZMİYORUZ: çizmek geri besleme tamponunu
         doldurur ve ölçülen ilk karenin başlangıç durumunu değiştirirdi;
         o zaman '--textures' olan ve olmayan koşular karşılaştırılamazdı.
         Bunun yerine motorun GERÇEK yükleme yolu '_userTexture' doğrudan
         çağrılıyor, tamponlara dokunulmadan. */
      window.__warmTextures = function () {
        var m = window.__mode;
        if (!TEXDIR) return Promise.resolve({ names: 0, ready: 0 });
        // GL bağlamı olmadan doku yüklenemez; ölçümdeki ilk çizim de aynı
        // boyutla açacaktı, dolayısıyla erken açmak durumu değiştirmiyor.
        if (!m._initGL(W, H)) return Promise.resolve({ names: 0, ready: 0 });
        m._ensureTextureLib({ milkdrop: { textureDir: TEXDIR } });
        var wait = function (ms) {
          return new Promise(function (r) { setTimeout(r, ms); });
        };
        return wait(0).then(function () {
          var names = m._texNames || [];
          for (var i = 0; i < names.length; i++) {
            var f = names[i], dot = f.lastIndexOf('.');
            m._userTexture('sampler_' + (dot < 0 ? f : f.slice(0, dot)));
          }
          return new Promise(function (done) {
            var tries = 0;
            (function tick() {
              var ready = 0;
              for (var k in m.userTex) if (m.userTex[k]) ready++;
              // 100 deneme = ~2 sn. Çözülemeyen dosya sonsuza kadar null
              // kalır, bu yüzden bekleme sınırlı.
              if (ready >= names.length || ++tries > 100) {
                return done({ names: names.length, ready: ready });
              }
              setTimeout(tick, 20);
            })();
          });
        });
      };

      /* NEDEN geri besleme tamponlari presetler ARASINDA temizlenmiyor.

         Denendi ve OLCULDU: her presetten once tamponlari siyaha
         temizlemek 900 preseti %93,1'den %85,8'e dusurdu ve "siyah"
         sinifini 14'ten 81'e cikardi. Cunku bircok preset yalniz VAR OLAN
         goruntuyu bozup akitiyor; bos bir tampondan 20 karede gorunur
         piksel uretemiyor.

         Tasima gercege de uygun: uygulamada da, MilkDrop'ta da yeni preset
         onceki goruntuyu devralir. Bedeli, bir presetin sinifinin bir
         oncekinin son karesine bagli olmasi — kod degisince bu bag kucuk
         farklari sinif atlamasina cevirebiliyor. Olculdu: buyuk bir motor
         degisiminde 900 presette 4 atlama (%0,4). Sonraki bir uyum turunda
         daha yakindan olculdu: bes adimda sinif degistiren 17 presetin
         13'u TEK BASINA render edildiginde anahtarin iki durumunda da ayni
         cikti — yani atlamanin sebebi degisiklik degil, devralinan
         goruntuydu. O yuzden iki kosu
         karsilastirilirken yuzdeye degil, preset preset FARKA bakiliyor.
      */
      window.__run = function (source, id) {
        var cfg = {
          milkdrop: {
            presetId: id, source: source, maxSize: 1920, textureDir: TEXDIR,
            accurate: ACCURATE,
          },
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
        /* Bu preset kaç kullanıcı dokusu İSTEDİ ve kaçını GERÇEKTEN aldı.
           Çevirinin "doku yerine gürültü" notu istemi bildiriyor ama dosya
           bulunup bulunmadığını bilmiyor; karşılanma oranı ancak burada,
           çizimden sonra motorun önbelleğine bakarak ölçülebiliyor. */
        var want = {}, texWant = 0, texHit = 0;
        var plans = [];
        var wp = window.__mode.warpPreset, cp = window.__mode.compPreset;
        if (wp && wp.locs && wp.locs._plan) plans.push(wp.locs._plan);
        if (cp && cp.locs && cp.locs._plan) plans.push(cp.locs._plan);
        for (var pi = 0; pi < plans.length; pi++) {
          for (var ei = 0; ei < plans[pi].length; ei++) {
            var pe = plans[pi][ei];
            if (pe.p && pe.p.user) want[pe.p.canon] = 1;
          }
        }
        for (var cn in want) {
          texWant++;
          var b = cn.slice('sampler_'.length);
          if (window.__mode.userTex && window.__mode.userTex[b]) texHit++;
        }
        return {
          texWant: texWant, texHit: texHit,
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

  /* Doku paketi sayfaya taşınıyor. Ölçüm sayfasının preload'ı yok, yani
     `window.api` yok; motorun çağırdığı iki köprü burada gerçek dosyalarla
     taklit ediliyor. Taklit edilen yalnız KÖPRÜ: dosya seçimi, rastgele
     yuva, kod çözme ve GPU'ya yükleme motorun kendi kodunda kalıyor. */
  if (TEXDIR) {
    const mdTex = require(path.join(root, 'src/main/milkdrop-textures.js'));
    let names;
    try {
      names = fs.readdirSync(TEXDIR).filter((f) => mdTex.isTextureFile(f)).sort();
    } catch (e) {
      console.error('Doku klasörü okunamadı: ' + TEXDIR);
      app.exit(2);
      return;
    }
    await win.webContents.executeJavaScript('window.__texlib = {};0;');
    let bytes = 0;
    for (const n of names) {
      const file = mdTex.resolveTexture(TEXDIR, n);
      if (!file) continue;
      const buf = fs.readFileSync(file);
      bytes += buf.length;
      const url = 'data:' + mdTex.mimeFor(n) + ';base64,' + buf.toString('base64');
      await win.webContents.executeJavaScript(
        'window.__texlib[' + JSON.stringify(n) + ']=' + JSON.stringify(url) + ';0;');
    }
    await win.webContents.executeJavaScript(`
      window.api = {
        milkdropTextures: function () {
          return Promise.resolve({ names: Object.keys(window.__texlib) });
        },
        milkdropTexture: function (f) {
          return Promise.resolve({ dataUrl: window.__texlib[f] || '' });
        },
      };0;`);
    const warm = await win.webContents.executeJavaScript('window.__warmTextures()');
    say('doku paketi     : ' + TEXDIR);
    say('  yüklenen      : ' + warm.ready + ' / ' + names.length +
      '  (' + (bytes / 1048576).toFixed(1) + ' MB)');
  }

  const results = [];
  let done = 0;
  emit('render ediliyor: ' + files.length + ' preset');
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
      texWant: r.texWant || 0, texHit: r.texHit || 0,
    });
    if (++done % 20 === 0) emit('.');
  }
  emit('\n');

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

  say('');
  say('korpus          : ' + corpus);
  say('preset          : ' + results.length + '   kare/preset: ' + FRAMES +
    '   çözünürlük: ' + WIDTH + 'x' + HEIGHT +
    '   MilkDrop uyumu: ' + (LEGACY ? 'KAPALI' : 'açık'));
  say('');
  say('GÖRÜNTÜ ÜRETEN  : ' + clean + ' / ' + results.length + '  -> ' + pct(clean, results.length) + '%');
  say('sabit yola düşen: ' + fixedPath + '  (shader derlenmedi, motorun genel yolu çizdi)');
  say('doku yaklaşık   : ' + soft + '  (preset dokusu yok, gürültüyle ikame edildi)');
  /* `soft` ÇEVİRİ zamanında sayılıyor: preset doku istedi mi, evet. Aşağısı
     ÇİZİM zamanında sayılıyor: istenen doku gerçekten bulundu mu. İkisi
     ayrı sayılar ve `--textures` yalnız ikincisini değiştirir. */
  const texAsk = results.filter((r) => r.texWant > 0);
  if (texAsk.length) {
    const full = texAsk.filter((r) => r.texHit >= r.texWant).length;
    const some = texAsk.filter((r) => r.texHit > 0 && r.texHit < r.texWant).length;
    say('doku isteyen    : ' + texAsk.length +
      '   tamamı karşılanan: ' + full + ' (' + pct(full, texAsk.length) + '%)' +
      '   kısmen: ' + some);
  }
  say('');
  say('SINIFLARA GÖRE');
  for (const [cls, e] of Array.from(byCls.entries()).sort((a, b) => b[1].n - a[1].n)) {
    say('  ' + String(e.n).padStart(5) + '  ' + cls);
    for (const x of e.ex) say('           · ' + x);
  }

  if (JSON_OUT) {
    fs.writeFileSync(JSON_OUT, JSON.stringify({
      corpus, presets: results.length, frames: FRAMES,
      clean, cleanPct: Number(pct(clean, results.length)),
      fixedPath, soft,
      classes: Array.from(byCls.entries()).map(([cls, e]) => ({ cls, count: e.n })),
      results,
    }, null, 1), 'utf-8');
    say('\nJSON: ' + JSON_OUT);
  }

  app.exit(0);
}

app.whenReady().then(() => {
  main().catch((e) => {
    console.error('ölçüm çöktü: ' + (e && e.stack || e));
    app.exit(1);
  });
});
