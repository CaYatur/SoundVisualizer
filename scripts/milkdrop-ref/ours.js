/*
 * SoundVisualizer — CaYaDev Ses Görselleştirici
 * Copyright (c) 2026 Çağan Turgut (CaYatur) — CaYaDev, https://cayadev.com
 * https://github.com/CaYatur/SoundVisualizer
 * SPDX-License-Identifier: MIT
 */
'use strict';
/* Bizim motorla, mdref.exe ile AYNI girdilerle çizim (#580).
 *
 * Aynı: preset metni, 960x720 (ya da --w/--h), 30 fps sabit adım, kare
 * başına aynı 576+576 örnek (audio.js), 64x48 ağ, çizgi biçimi MilkDrop,
 * flaş sınırlama kapalı, hareket azaltma kapalı. Her preset TAZE sayfada.
 * Çıktı: <out>/<id>/o<kare>.rgba (W*H*4, üstten)
 *
 * Kullanım: node ours.js --repo=<SoundVisualizer> --list=<json [{id,file}]>
 *           --audio=<.i8> --frames=60 --cap=59 --out=<klasör> [--w=960 --h=720] */
const path = require('path');
const fs = require('fs');
const argv = process.argv.slice(process.versions.electron ? 1 : 2);
const flag = (n, d) => { const h = argv.find((a) => a.startsWith('--' + n + '=')); return h ? h.slice(n.length + 3) : d; };
const REPO = flag('repo', process.env.SV_REPO || path.resolve(__dirname, '..', '..'));
const LIST = flag('list', '');
const AUDIO = flag('audio', '');
const FRAMES = +flag('frames', 60);
const CAP = flag('cap', String(FRAMES - 1)).split(',').map(Number);
const OUT = flag('out', '');
const W = +flag('w', 960), H = +flag('h', 720);
const LINE = flag('line', 'milkdrop');
const MV = process.env.OURS_MV || 'fixed'; // #750 aynalı hareket vektörü seçeneği
const WARM = +flag('warm', 0);
const META = flag('meta', 'ours-meta.json');
// --mdclock: frame/time MilkDrop'un fazına (yalnız ölçüm; motor her presette frame'i sıfırlıyor, MilkDrop programın başından sayıyor)
const MDCLOCK = process.argv.includes('--mdclock');
// --mdlag: MilkDrop yeni preseti kare SONUNDA yüklüyor (LoadPresetTick); ilk karesi hâlâ eski preset. Ölçümde aynı gecikme.
const MDLAG = process.argv.includes('--mdlag');
// Isınma preseti: siyah, çizim yok (mdref de aynı dosyayı yüklüyor)
const BLANK_SRC = 'MILKDROP_PRESET_VERSION=201\n[preset00]\nfDecay=0\nfWaveAlpha=0\nnWaveMode=0\nzoom=1\nob_size=0\nib_size=0\nmv_a=0\n';

if (!process.versions.electron) {
  const { spawn } = require('child_process');
  const electronPath = require(path.join(REPO, 'node_modules', 'electron'));
  const env = Object.assign({}, process.env); delete env.ELECTRON_RUN_AS_NODE;
  const c = spawn(electronPath, [__filename].concat(argv), { stdio: 'inherit', env });
  c.on('close', (code) => process.exit(code));
  return;
}

const { app, BrowserWindow } = require('electron');
app.commandLine.appendSwitch('force-device-scale-factor', '1');
process.stdout.on('error', () => {});
const say = (t) => { try { process.stdout.write(t + '\n'); } catch (e) { /* boru */ } };

const ENGINE = ['src/shared/milkdrop.js', 'src/shared/milkdrop-audio.js', 'src/shared/milkdrop-hlsl.js',
  'src/shared/milkdrop-shader.js', 'src/visualizer/modes/milkdrop.js'];

function page(audioB64) {
  return `(function () {
    var W = ${W}, H = ${H}, N = ${FRAMES}, CAP = ${JSON.stringify(CAP)};
    window.SVMilkdropSync = true;
    var _seed = 1;
    Math.random = function () { _seed = (_seed * 1103515245 + 12345) % 2147483648; return _seed / 2147483648; };
    var raw = atob(${JSON.stringify(audioB64)});
    var AU = new Int8Array(raw.length);
    for (var q = 0; q < raw.length; q++) AU[q] = (raw.charCodeAt(q) << 24) >> 24;
    var canvas = document.createElement('canvas'); canvas.width = W; canvas.height = H;
    document.body.style.margin = '0';
    document.body.appendChild(canvas);
    var mode = new window.SVModes.milkdrop(canvas);
    var ctx = canvas.getContext('2d');
    var freq = new Float32Array(512);
    function audio(i) {
      var L = new Uint8Array(2048), R = new Uint8Array(2048);
      for (var k = 0; k < 2048; k++) { L[k] = 128; R[k] = 128; }
      var off = i * 1152;
      if (off + 1152 <= AU.length) {
        for (var s = 0; s < 576; s++) {
          L[2048 - 576 + s] = AU[off + s] + 128;
          R[2048 - 576 + s] = AU[off + 576 + s] + 128;
        }
      }
      return { bass: 1, mid: 1, treble: 1, timeBytes: L, timeL: L, timeR: R, stereo: true, freq: freq };
    }
    window.__run = function (source, id) {
      var mk = function (pid, src) {
        return { milkdrop: { presetId: pid, source: src, maxSize: 4096, textureDir: '', accurate: true, blendTime: 0,
          lineStyle: ${JSON.stringify(LINE)}, motionVectors: ${JSON.stringify(MV)}, flashLimit: false, mesh: 64, renderScale: 1 },
          milkdropControl: { reduceMotion: 'off' }, visualizer: { sensitivity: 1 } };
      };
      var cfg = mk(id, source);
      var out = {}, err = '', bands = [], cb = null;
      // Isınma: mdref ile aynı siyah preset, aynı ses (bant ortalamaları otursun)
      var WARM = ${WARM};
      if (WARM > 0) {
        cb = mk('__blank', ${JSON.stringify(BLANK_SRC)});
        for (var w = 0; w < WARM; w++) {
          try { mode.draw(audio(w), cb, (w + 1) / 30, 1 / 30); } catch (e) { err = 'ısınma: ' + String(e && e.message || e); break; }
        }
      }
      for (var i = 0; i < N; i++) {
        try { mode.draw(audio(i + WARM), (${MDLAG} && i === 0 && WARM > 0) ? cb : cfg, (i + WARM + 1) / 30, 1 / 30); } catch (e) { err = String(e && e.message || e); break; }
        if (${MDCLOCK} && i === (${MDLAG} ? 1 : 0)) { mode.frameNo += ${MDLAG} ? WARM - 1 : WARM - 3; mode.time -= 2 / 30; }
        var P = mode.preset;
        if (P && P.get) bands.push([i, P.get('bass'), P.get('mid'), P.get('treb'), P.get('bass_att'), P.get('mid_att'), P.get('treb_att')].join(' '));
        if (CAP.indexOf(i) >= 0) {
          var d = ctx.getImageData(0, 0, W, H).data, s2 = '';
          for (var k2 = 0; k2 < d.length; k2 += 8192) s2 += String.fromCharCode.apply(null, d.subarray(k2, k2 + 8192));
          out[i] = btoa(s2);
        }
      }
      return { err: err, modeError: mode.error || '', note: mode.shaderNote || '', frames: out, bands: bands.join('\\n') };
    };
    return true;
  })();`;
}

app.whenReady().then(async () => {
  const list = JSON.parse(fs.readFileSync(LIST, 'utf-8'));
  const audioB64 = AUDIO ? fs.readFileSync(AUDIO).toString('base64') : '';
  const win = new BrowserWindow({ show: false, width: W, height: H, webPreferences: { backgroundThrottling: false } });
  const engine = ENGINE.map((rel) => fs.readFileSync(path.join(REPO, rel), 'utf-8'));
  const meta = {};
  for (const it of list) {
    const dir = path.join(OUT, it.id);
    fs.mkdirSync(dir, { recursive: true });
    let r;
    try {
      await win.loadURL('about:blank');
      for (const code of engine) await win.webContents.executeJavaScript(code + '\n;0;');
      await win.webContents.executeJavaScript(page(audioB64));
      const text = fs.readFileSync(it.file, 'latin1');
      r = await win.webContents.executeJavaScript('window.__run(' + JSON.stringify(text) + ',' + JSON.stringify(it.id) + ')');
    } catch (e) { meta[it.id] = { err: String(e.message || e) }; process.stdout.write('!'); continue; }
    for (const k of Object.keys(r.frames)) fs.writeFileSync(path.join(dir, 'o' + k + '.rgba'), Buffer.from(r.frames[k], 'base64'));
    if (r.bands) fs.writeFileSync(path.join(dir, 'obands.txt'), r.bands + '\n');
    meta[it.id] = { err: r.err, modeError: r.modeError, note: r.note };
    process.stdout.write('.');
  }
  fs.writeFileSync(path.join(OUT, META), JSON.stringify(meta, null, 1));
  say('');
  app.exit(0);
});
