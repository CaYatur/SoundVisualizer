'use strict';
/* PRESET DEĞİŞİMİNİN KARE MALİYETİNİ ÖLÇER (#573).
 *
 * Preset yüklemek, yeni presetin warp ve comp shader'larını çizim
 * iş parçacığında derliyor. O kare bir kez, tek presette ve tek makinede
 * ölçülmüştü (README, "What a transition costs, measured"): 1280x720'de
 * ağ 64'te sert geçişle 9,10 ms. Korpusa nasıl yayıldığı ölçülmedi — bu
 * betik onu ölçüyor: değişim karesi ve hemen ardından gelen kareler, her
 * preset için, birden fazla ağ sıklığında, sert geçişle ve harmanla.
 *
 * NEDEN HER KAREDE GERİ OKUMA: `draw()` GPU'ya iş GÖNDERİYOR, bitmesini
 * beklemiyor. Yalnız çağrının süresi ölçülse derleme görünür ama çizimin
 * kendisi sonraki karenin hesabına yazılırdı. Her karenin sonunda GL
 * bağlamından tek piksel okunuyor: bu, o karenin bütün GPU işinin
 * bitmesini bekletiyor. Aynı okuma her karede var, yani değişim karesi ile
 * durağan kare aynı ölçüyle karşılaştırılıyor.
 *
 * NEDEN ARDINDAN GELEN KARELER DE: ANGLE (Windows'ta WebGL'in altındaki
 * katman) bazı shader türevlerini bağlama anında değil İLK ÇİZİMDE
 * derleyebiliyor. Maliyet değişim karesinden bir sonrakine kayabilir;
 * "değişimin en kötü karesi" ilk dört karenin en büyüğü.
 *
 * ÖNBELLEK: Chromium derlenmiş programları hem bellekte hem diskte
 * (userData/GPUCache) saklıyor; bir kez görülmüş bir preset ikinci
 * yüklemesinde çok daha ucuz. Ölçüldü: disk önbelleği ve program önbelleği
 * anahtarla kapatılsa bile AYNI süreçte ikinci geçişte GL derlemesinin
 * medyanı 18,3 ms'den 5,8 ms'ye iniyor — süreç içinde başka bir önbellek
 * daha var. Bu yüzden her geçiş KENDİ Electron sürecinde koşuyor: her biri
 * bir presetin oturumda İLK kez yüklendiği anı ölçüyor. Ekran kartı
 * sürücüsünün kendi disk önbelleği bu betiğin elinde değil; daha önce
 * derlenmiş presetleri o hızlandırabilir, yani "hiç görülmemiş" bir preset
 * bundan da yavaş olabilir. `--warm` önbelleği açık bırakıyor ve aynı
 * süreçte kesiti iki kez geçip ikinci geçişi raporluyor: oturumda daha önce
 * gösterilmiş bir preset. Her süreç kendi geçici userData klasörünü
 * kullanıyor; uygulamanın ya da önceki koşuların önbelleğine dokunmuyor.
 *
 * Kullanım:
 *   node scripts/milkdrop-switch-cost.js <korpus> --sample=900
 *   node scripts/milkdrop-switch-cost.js <korpus> --sample=900 --meshes=32,64,128
 *   node scripts/milkdrop-switch-cost.js <korpus> --sample=900 --warm --json=rapor.json
 *
 * Kesit milkdrop-render-rate.js ile AYNI (milkdrop-corpus.js): --sample=900
 * yayınlanmış bütün oranların ölçüldüğü 900 preset.
 *
 * ARKA PLANDA DERLEME (#573): motor yeni presetin shader'larını
 * `KHR_parallel_shader_compile` ile arka planda derliyor ve hazır olunca
 * geçiyor. Ölçüm bu yüzden değişim İSTENDİĞİ kareden, gerçekten
 * GERÇEKLEŞTİĞİ kareden üç kare sonrasına kadar süren pencerenin en kötü
 * karesine bakıyor ve bekleyişin kaç kare sürdüğünü de sayıyor.
 * `--sync` eski yolu (derlemeyi beklemek) ölçüyor.
 */
const path = require('path');
const fs = require('fs');
const os = require('os');

const argv = process.argv.slice(process.versions.electron ? 1 : 2);
const flag = (name, def) => {
  const hit = argv.find((a) => a.startsWith('--' + name + '='));
  return hit ? hit.slice(name.length + 3) : def;
};
const corpus = argv.find((a) => !a.startsWith('--') && !a.endsWith('.js'));
const LIMIT = Number(flag('limit', 0)) || 0;
const SAMPLE = Number(flag('sample', 0)) || 0;
const WIDTH = Number(flag('width', 1280)) || 1280;
const HEIGHT = Number(flag('height', 720)) || 720;
const MESHES = String(flag('meshes', '32,64,128')).split(',').map(Number).filter((n) => n > 0);
/* Harmanın süresi değişim karesinin maliyetini DEĞİŞTİRMİYOR (derleme ve
   iki presetin ilk karesi aynı); yalnız kaç kare çift çizileceğini. Kısa
   tutulması koşuyu kısaltıyor; harmanın durağan maliyeti README'de ayrıca
   ölçülü. */
const BLEND = Number(flag('blend', 0.2)) || 0.2;
const WARM = argv.indexOf('--warm') >= 0;
const SYNC = argv.indexOf('--sync') >= 0;
const SHOW = Number(flag('show', 8)) || 8;

if (!corpus) {
  console.error('Preset klasörü verilmedi.\n' +
    '  node scripts/milkdrop-switch-cost.js <klasör> [--sample=900] [--meshes=32,64,128] [--warm] [--json=dosya]');
  process.exit(2);
}

// --- Node tarafı: kendini Electron ile yeniden başlat ------------------------

const PASS = flag('pass', '');
const PART = flag('part', '');

if (!process.versions.electron) {
  const { spawnSync } = require('child_process');
  const electronPath = require('electron');
  const env = Object.assign({}, process.env);
  delete env.ELECTRON_RUN_AS_NODE;
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'md-switch-parts-'));
  const parts = [];
  for (const mesh of MESHES) {
    for (const blend of [0, BLEND]) {
      const part = path.join(tmp, mesh + '-' + blend + '.json');
      const rest = argv.filter((a) => !a.startsWith('--json=') && !a.startsWith('--pass=') && !a.startsWith('--part='));
      const r = spawnSync(electronPath, [__filename].concat(rest, ['--pass=' + mesh + ':' + blend, '--part=' + part]), {
        stdio: 'inherit', cwd: path.join(__dirname, '..'), env,
      });
      if (r.status !== 0 || !fs.existsSync(part)) {
        console.error('geçiş başarısız: ağ ' + mesh + ', harman ' + blend);
        process.exit(1);
      }
      parts.push(JSON.parse(fs.readFileSync(part, 'utf-8')));
    }
  }
  console.log('\nÖZET (' + (WARM ? 'önbellek açık, ikinci geçiş' : 'her geçiş kendi sürecinde, ilk yükleme') + ')');
  console.log('  ağ   geçiş    komşu  en kötü p50   p95    maks   bütçe aşımı   değişimin düşürdüğü   bekleme p50/maks');
  for (const p of parts) {
    const s = p.summary;
    const pc = (a) => (s.n ? (a * 100 / s.n).toFixed(1) : '0.0') + '%';
    console.log('  ' + String(p.mesh).padStart(3) + '  ' + (p.blend ? 'harman' : 'sert  ') + ' ' +
      s.base.p50.toFixed(2).padStart(7) + ' ' + s.worstFrame.p50.toFixed(2).padStart(11) + ' ' +
      s.worstFrame.p95.toFixed(2).padStart(6) + ' ' + s.worstFrame.max.toFixed(1).padStart(7) + ' ' +
      pc(s.overBudget).padStart(12) + ' ' + pc(s.causedDrop).padStart(20) + '   ' +
      (s.delay ? s.delay.p50 + '/' + s.delay.max : '-'));
  }
  const JSON_ALL = flag('json', '');
  if (JSON_ALL) {
    fs.writeFileSync(JSON_ALL, JSON.stringify({ warm: WARM, runs: parts }), 'utf-8');
    console.log('\nJSON: ' + JSON_ALL);
  }
  try { fs.rmSync(tmp, { recursive: true, force: true }); } catch (e) { /* geçici */ }
  process.exit(0);
}

// --- Electron tarafı --------------------------------------------------------

const { app, BrowserWindow } = require('electron');
const { listPresets } = require('./milkdrop-corpus.js');

process.stdout.on('error', (e) => { if (!e || e.code !== 'EPIPE') throw e; });
process.stderr.on('error', (e) => { if (!e || e.code !== 'EPIPE') throw e; });
const emit = (t) => { try { process.stdout.write(t); } catch (e) { /* boru kapali */ } };
const say = (t) => emit(t + '\n');

/* Önbellek kararı `ready`den ÖNCE verilmeli: GPU süreci bu anahtarlarla
   başlıyor. Geçici userData hem soğuk koşuyu gerçekten soğuk tutuyor hem
   de sıcak koşunun önbelleğini başka koşulardan ayırıyor. */
const USERDATA = fs.mkdtempSync(path.join(os.tmpdir(), 'md-switch-'));
app.setPath('userData', USERDATA);
if (!WARM) {
  app.commandLine.appendSwitch('disable-gpu-program-cache');
  app.commandLine.appendSwitch('disable-gpu-shader-disk-cache');
}

const ENGINE = [
  'src/shared/milkdrop.js',
  'src/shared/milkdrop-audio.js',
  'src/shared/milkdrop-hlsl.js',
  'src/shared/milkdrop-shader.js',
  'src/visualizer/modes/milkdrop.js',
];
const SIGNAL = 'src/shared/demo-audio.js';

function pageHarness() {
  return `
    (function () {
      var W = ${WIDTH}, H = ${HEIGHT};
      var DT = 1 / 60;
      if (${SYNC ? 'true' : 'false'}) window.SVMilkdropSync = true;

      var _seed = 1;
      Math.random = function () {
        _seed = (_seed * 1103515245 + 12345) % 2147483648;
        return _seed / 2147483648;
      };

      var canvas = document.createElement('canvas');
      canvas.width = W; canvas.height = H;
      document.body.appendChild(canvas);
      var mode = new window.SVModes.milkdrop(canvas);
      var ctx = canvas.getContext('2d');
      window.__mode = mode;

      /* Ses render oranı ölçümündekiyle aynı tarif (demo-audio.js). */
      var DEMO = window.SVDemoAudio;
      function audio(i) {
        var t = i / 60;
        var beat = Math.pow(Math.max(0, 1 - ((t * 2) % 1) * 2.2), 2);
        var end = Math.floor((1 + t) * DEMO.SR);
        var time = new Uint8Array(2048), timeL = new Uint8Array(2048), timeR = new Uint8Array(2048);
        DEMO.fill(end, time, timeL, timeR);
        var freq = new Float32Array(512);
        for (var q = 0; q < 512; q++) {
          var fu = q / 512;
          freq[q] = Math.max(0, Math.min(1, (1 - fu) * (0.35 + 0.5 * beat) +
            0.15 * Math.abs(Math.sin(fu * 22 + t * 2.1))));
        }
        return { bass: 0.45 + 0.45 * beat, mid: 0.35 + 0.25 * Math.abs(Math.sin(t * 0.7)),
          treble: 0.25 + 0.2 * Math.abs(Math.sin(t * 1.3)),
          timeBytes: time, timeL: timeL, timeR: timeR, stereo: true, freq: freq };
      }

      /* AŞAMALAR. Değişim karesinin nereye gittiğini ayırmak için motorun
         dört adımı sarılıyor: denklemlerin derlenmesi (Preset kurucusu),
         dosyanın ayrıştırılması, HLSL'den GLSL'e çeviri ve GL derleme +
         bağlama. Sarmalayıcılar yalnız süre topluyor; davranış aynı. */
      var PH = { preset: 0, parse: 0, translate: 0, link: 0 };
      var M = window.SVMilkdrop, T = window.SVMilkdropShader;
      var timed = function (fn, key) {
        return function () {
          var t0 = performance.now();
          try { return fn.apply(this, arguments); } finally { PH[key] += performance.now() - t0; }
        };
      };
      var BasePreset = M.Preset;
      M.Preset = class extends BasePreset {
        constructor(a, b) {
          var t0 = performance.now();
          super(a, b);
          PH.preset += performance.now() - t0;
        }
      };
      M.parseMilk = timed(M.parseMilk, 'parse');
      T.translate = timed(T.translate, 'translate');
      mode._link = timed(mode._link, 'link');
      mode._linkBegin = timed(mode._linkBegin, 'link');
      mode._linkEnd = timed(mode._linkEnd, 'link');

      var gi = 0;
      var PX = new Uint8Array(4);
      function frame(cfg) {
        PH.preset = 0; PH.parse = 0; PH.translate = 0; PH.link = 0;
        var t0 = performance.now();
        mode.draw(audio(gi), cfg, gi * DT, DT);
        gi++;
        /* Karenin bütün GPU işi bitsin: GL bağlamından TEK piksel. Görünür
           2D tuvalden okumak DEĞİL — Chromium sık okunan bir 2D tuvali
           yazılıma taşıyor ve ondan sonra her karenin WebGL görüntüsü
           işlemciye kopyalanıyor; o kopya ölçülen her kareye ~8 ms
           ekliyordu. */
        if (mode.gl) mode.gl.readPixels(0, 0, 1, 1, mode.gl.RGBA, mode.gl.UNSIGNED_BYTE, PX);
        var ms = performance.now() - t0;
        return { ms: ms, preset: PH.preset, parse: PH.parse, translate: PH.translate, link: PH.link };
      }

      window.__caps = function () {
        mode._initGL(W, H);
        var gl = mode.gl;
        return {
          parallel: !!(gl && gl.getExtension('KHR_parallel_shader_compile')),
          renderer: gl ? String(gl.getParameter(gl.RENDERER)) : '',
        };
      };

      /* Bir preset değişimi: değişim karesi + ardından gelen kareler.
         Harman varsa o süre boyunca da çiziliyor, sonra dört durağan kare. */
      window.__switch = function (source, id, mesh, blend) {
        var cfg = {
          milkdrop: { presetId: id, source: source, mesh: mesh, blendTime: blend, maxSize: 1920, accurate: true },
          visualizer: { sensitivity: 1 },
        };
        var out = { frames: [], err: '', swapAt: 0 };
        var after = (blend > 0 ? Math.ceil(blend / DT) : 0) + 6;
        try {
          out.frames.push(frame(cfg));
          /* Arka planda derlenirken eski preset çiziliyor: değişimin
             gerçekleştiği kareyi bul (en çok 120 kare). */
          var guard = 0;
          while ((mode._pending || mode._presetSrc !== source) && guard++ < 120) out.frames.push(frame(cfg));
          out.swapAt = out.frames.length - 1;
          for (var i = 0; i < after; i++) out.frames.push(frame(cfg));
        } catch (e) {
          out.err = String(e && e.message || e);
        }
        out.note = mode.shaderNote || '';
        out.warpProg = !!mode.warpPreset;
        out.compProg = !!mode.compPreset;
        return out;
      };
      return true;
    })();
  `;
}

const q = (arr, p) => {
  if (!arr.length) return 0;
  const a = arr.slice().sort((x, y) => x - y);
  return a[Math.min(a.length - 1, Math.floor(p * (a.length - 1) + 0.5))];
};
const f2 = (x) => x.toFixed(2).padStart(7);
const BUDGET = 1000 / 60;

/* KOMŞU KARE. Değişimin kendi maliyeti ancak çevresindeki karelerle
   kıyaslanınca görünür: harmanda İKİ preset birden çiziliyor ve harmanın
   her karesi zaten iki kat — o bir takılma değil, harmanın bedeli. Sert
   geçişte komşu, yeni presetin durağan kareleri (son üç); harmanda ise
   harmanın kendi kareleri (ilk dördünden sonrakiler: ANGLE'ın ilk çizimde
   derlediği türevler ilk karelere düşebiliyor).

   "Değişimin düşürdüğü": ilk dört karenin en kötüsü 60 Hz bütçesini aşıyor
   AMA komşu kareler aşmıyor — yani o kare yalnız değişim yüzünden kaçtı. */
function baseOf(r, blendFrames) {
  const f = r.frames.map((x) => x.ms);
  const s0 = r.swapAt || 0;
  if (blendFrames > 4) return q(f.slice(s0 + 4, s0 + 1 + blendFrames), 0.5);
  return q(f.slice(-3), 0.5);
}

/* Değişim penceresi: istenen kareden gerçekleştiği karenin üç sonrasına. */
function windowOf(r) {
  return r.frames.slice(0, (r.swapAt || 0) + 4);
}

function summarize(rows, blend) {
  const blendFrames = blend > 0 ? Math.ceil(blend * 60) : 0;
  /* İlk satır bir DEĞİŞİM değil, ilk YÜKLEME: gösterilecek önceki preset
     yok, motor onu her yolda bekleyerek derliyor. Sayılmıyor. */
  const ok = rows.slice(1).filter((r) => !r.err && r.frames.length >= 5);
  const sw = ok.map((r) => r.frames[0].ms);
  const worst = ok.map((r) => Math.max(...windowOf(r).map((f) => f.ms)));
  const delay = ok.map((r) => r.swapAt || 0);
  const base = ok.map((r) => baseOf(r, blendFrames));
  const spike = ok.map((r, i) => worst[i] - base[i]);
  // Aşamalar pencere boyunca toplanıyor: arka planda derlemede iş kareler arasına dağılıyor.
  const ph = (k) => q(ok.map((r) => windowOf(r).reduce((a, f) => a + f[k], 0)), 0.5);
  const over = (arr, lim) => arr.filter((x) => x > lim).length;
  const dist = (a) => ({ p50: q(a, 0.5), p90: q(a, 0.9), p95: q(a, 0.95), p99: q(a, 0.99), max: q(a, 1) });
  return {
    n: ok.length,
    errors: rows.length - ok.length,
    base: dist(base),
    switchFrame: dist(sw),
    worstFrame: dist(worst),
    spike: dist(spike),
    delay: dist(delay),
    overBudget: over(worst, BUDGET),
    overTwoFrames: over(worst, 2 * BUDGET),
    causedDrop: ok.filter((r, i) => worst[i] > BUDGET && base[i] <= BUDGET).length,
    phases: { preset: ph('preset'), parse: ph('parse'), translate: ph('translate'), link: ph('link') },
  };
}

function report(label, s) {
  const pct = (a) => (s.n ? (a * 100 / s.n).toFixed(1) : '0.0');
  say('');
  say(label + '   (' + s.n + ' değişim' + (s.errors ? ', ' + s.errors + ' hata' : '') + ')');
  say('  komşu kare (medyan)       : ' + f2(s.base.p50) + ' ms' +
    '   (sert geçişte yeni presetin durağan karesi, harmanda harmanın karesi)');
  say('  değişim karesi  p50/p90/p95/p99/maks: ' +
    [s.switchFrame.p50, s.switchFrame.p90, s.switchFrame.p95, s.switchFrame.p99, s.switchFrame.max].map(f2).join(' ') + ' ms');
  say('  en kötü kare    p50/p90/p95/p99/maks: ' +
    [s.worstFrame.p50, s.worstFrame.p90, s.worstFrame.p95, s.worstFrame.p99, s.worstFrame.max].map(f2).join(' ') + ' ms');
  say('  komşuya göre sıçrama p50/p90/p95/p99/maks: ' +
    [s.spike.p50, s.spike.p90, s.spike.p95, s.spike.p99, s.spike.max].map(f2).join(' ') + ' ms');
  say('  60 Hz bütçesini aşan      : ' + s.overBudget + ' (' + pct(s.overBudget) + '%)   iki kareyi aşan: ' +
    s.overTwoFrames + ' (' + pct(s.overTwoFrames) + '%)');
  say('  değişimin düşürdüğü kare  : ' + s.causedDrop + ' (' + pct(s.causedDrop) + '%)' +
    '   (komşuları bütçede, yalnız değişim karesi kaçıyor)');
  say('  değişimin beklediği kare  p50/p90/p95/p99/maks: ' +
    [s.delay.p50, s.delay.p90, s.delay.p95, s.delay.p99, s.delay.max].join(' / '));
  say('  değişim karesinin aşamaları (medyan): denklemler ' + s.phases.preset.toFixed(2) +
    ' · ayrıştırma ' + s.phases.parse.toFixed(2) + ' · çeviri ' + s.phases.translate.toFixed(2) +
    ' · GL derleme ' + s.phases.link.toFixed(2) + ' ms');
}

async function main() {
  const files = listPresets(corpus, { limit: LIMIT, sample: SAMPLE });
  if (!files.length) {
    console.error('Klasörde .milk bulunamadı: ' + corpus);
    app.exit(2);
    return;
  }
  const win = new BrowserWindow({
    show: false, width: 320, height: 240,
    webPreferences: { offscreen: false, backgroundThrottling: false },
  });
  await win.loadURL('about:blank');
  const root = path.join(__dirname, '..');
  for (const rel of ENGINE.concat(SIGNAL)) {
    await win.webContents.executeJavaScript(fs.readFileSync(path.join(root, rel), 'utf-8') + '\n;0;');
  }
  await win.webContents.executeJavaScript(pageHarness());
  const caps = await win.webContents.executeJavaScript('window.__caps()');
  let gpu = '';
  try {
    const info = await app.getGPUInfo('basic');
    const d = info && info.gpuDevice && info.gpuDevice.find((x) => x.active) || (info.gpuDevice || [])[0];
    gpu = d ? (d.deviceString || (d.vendorId + ':' + d.deviceId)) : '';
  } catch (e) { /* bilgi yoksa ölçüm yine geçerli */ }

  const sources = files.map((f) => {
    try { return fs.readFileSync(f, 'latin1'); } catch (e) { return null; }
  });

  if (!PASS || !PART) {
    console.error('Electron tarafı --pass=<ağ>:<harman> ve --part=<dosya> ister (node ile başlatın).');
    app.exit(2);
    return;
  }
  say('');
  say('korpus        : ' + corpus + '   preset: ' + files.length);
  say('çözünürlük    : ' + WIDTH + 'x' + HEIGHT + '   geçiş: ' + PASS);
  say('önbellek      : ' + (WARM ? 'AÇIK (aynı süreçte ikinci geçiş)' : 'KAPALI (kendi sürecinde ilk yükleme)'));
  say('derleme       : ' + (SYNC ? 'BEKLEYEREK (--sync, eski yol)' : 'arka planda, hazır olunca geçiş'));
  say('GPU           : ' + (gpu || '?') + '   ' + caps.renderer);
  say('paralel derleme (KHR_parallel_shader_compile): ' + (caps.parallel ? 'var' : 'yok'));

  const [mesh, blend] = PASS.split(':').map(Number);
  const passes = WARM ? 2 : 1;
  {
    {
      let rows = [];
      for (let pass = 0; pass < passes; pass++) {
        rows = [];
        emit((blend ? 'harman' : 'sert  ') + ' ağ ' + mesh + (passes > 1 ? ' geçiş ' + (pass + 1) : '') + ' ');
        for (let i = 0; i < files.length; i++) {
          if (sources[i] == null) continue;
          let r;
          try {
            r = await win.webContents.executeJavaScript('window.__switch(' + JSON.stringify(sources[i]) + ',' +
              JSON.stringify(files[i]) + ',' + mesh + ',' + blend + ')');
          } catch (e) {
            r = { frames: [], err: 'harness: ' + (e && e.message) };
          }
          r.file = files[i];
          rows.push(r);
          if (i % 50 === 0) emit('.');
        }
        emit('\n');
      }
      const s = summarize(rows, blend);
      report((blend ? 'HARMAN ' + BLEND + ' s' : 'SERT GEÇİŞ') + ', ağ ' + mesh, s);
      const worst = rows.filter((r) => !r.err && r.frames.length)
        .map((r) => ({ file: path.basename(r.file), ms: Math.max(...windowOf(r).map((f) => f.ms)),
          link: r.frames[0].link, preset: r.frames[0].preset }))
        .sort((a, b) => b.ms - a.ms).slice(0, SHOW);
      for (const w of worst) {
        say('    · ' + w.ms.toFixed(1).padStart(6) + ' ms  (GL ' + w.link.toFixed(1) + ', denklem ' +
          w.preset.toFixed(1) + ')  ' + w.file);
      }
      fs.writeFileSync(PART, JSON.stringify({ corpus, presets: files.length, width: WIDTH, height: HEIGHT,
        warm: WARM, gpu, renderer: caps.renderer, parallel: caps.parallel, mesh, blend, summary: s,
        sync: SYNC,
        rows: rows.map((r) => ({ file: r.file, err: r.err || '', swapAt: r.swapAt || 0, note: r.note, warpProg: r.warpProg,
          compProg: r.compProg, frames: r.frames.map((f) => [+f.ms.toFixed(3), +f.preset.toFixed(3),
            +f.parse.toFixed(3), +f.translate.toFixed(3), +f.link.toFixed(3)]) })) }), 'utf-8');
    }
  }
  try { fs.rmSync(USERDATA, { recursive: true, force: true }); } catch (e) { /* geçici */ }
  app.exit(0);
}

app.whenReady().then(() => {
  main().catch((e) => {
    console.error('ölçüm çöktü: ' + (e && e.stack || e));
    app.exit(1);
  });
});
