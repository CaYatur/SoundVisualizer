'use strict';
/* Linux QA findings (export after cancel, follow recording, EN strings,
   app-audio grouping, export argument validation, quit on SIGTERM). */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const mcp = require('../src/shared/mcp');
const F = require('../src/shared/export-formats.js');
const L = require('../src/shared/app-audio-linux.js');
const A = require('../src/shared/app-audio.js');

const ROOT = path.join(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');
const MAIN = read('src/main/main.js');
const jobSrc = () => {
  const a = MAIN.indexOf('async function startExportJob(');
  const b = MAIN.indexOf("ipcMain.handle('export:start'", a);
  assert.ok(a > 0 && b > a);
  return MAIN.slice(a, b);
};

test('export: ffmpeg/window handlers are bound to their own job', () => {
  const s = jobSrc();
  assert.match(s, /const job = exportState;/);
  assert.match(s, /const isMine = \(\) => exportState === job;/);
  assert.match(s, /if \(!isMine\(\) \|\| code == null\) return;/);
  assert.match(s, /proc\.on\('exit', onFfClosed\);/);
  assert.match(s, /proc\.on\('close', onFfClosed\);/);
  assert.doesNotMatch(s, /ffmpegProc\.on\('(exit|close|error)'/);
  // The old window's late 'closed' must not clear the new job's window
  assert.match(s, /if \(exportWin === win\) exportWin = null;/);
});

test('export: a late close from a cancelled job does not finalize the next one', () => {
  const { EventEmitter } = require('events');
  let exportState = null;
  const finalized = [];
  const finalizeExport = (st) => { finalized.push(st); exportState = null; };
  // Same guard as startExportJob
  const start = () => {
    const proc = new EventEmitter();
    exportState = { cancel: false };
    const job = exportState;
    const isMine = () => exportState === job;
    const onFfClosed = (code) => {
      if (!isMine() || code == null) return;
      if (code === 0) finalizeExport('done');
      else if (exportState.cancel) finalizeExport('cancelled');
      else finalizeExport('error');
    };
    proc.on('exit', onFfClosed);
    proc.on('close', onFfClosed);
    return proc;
  };
  const old = start();
  exportState.cancel = true;
  finalizeExport('cancelled'); // renderer reports the cancel
  start();
  const second = exportState;
  old.emit('exit', 255);
  old.emit('close', 255);
  assert.strictEqual(exportState, second, 'new export survived');
  assert.deepStrictEqual(finalized, ['cancelled']);
});

test('export: main-process errors are localized with trUi', () => {
  const s = jobSrc();
  for (const tr of ['Zaten bir dışa aktarma sürüyor.', 'Ses dosyası bulunamadı.', 'Render penceresi yüklenemedi.']) {
    assert.ok(s.includes("trUi('" + tr + "'"), tr);
  }
});

test('MCP sv_start_export rejects invalid resolution/fps instead of rendering 1080p60', async () => {
  const started = [];
  const c = {
    locale: () => 'en',
    getConfig: () => ({ mcp: { enabled: true, mode: 'write' }, scenes: [] }),
    setConfig: () => {},
    startExport: (o) => { started.push(o); return { ok: true }; },
  };
  const abs = (n) => (process.platform === 'win32' ? 'C:\\Users\\me\\' : '/home/me/') + n;
  const r1 = await mcp.callTool('sv_start_export', { audioPath: abs('a.mp3'), outputPath: abs('o.mp4'), resolution: '8k' }, c);
  assert.strictEqual(r1.ok, false);
  assert.match(r1.error, /resolution.*8k.*1080p/);
  const r2 = await mcp.callTool('sv_start_export', { audioPath: abs('a.mp3'), outputPath: abs('o.mp4'), fps: 144 }, c);
  assert.strictEqual(r2.ok, false);
  assert.match(r2.error, /fps.*144/);
  const r3 = await mcp.callTool('sv_start_export', { audioPath: abs('a.mp3'), outputPath: abs('o.mp4'), resolution: '2160p', fps: 30 }, c);
  assert.strictEqual(r3.ok, true);
  assert.strictEqual(started.length, 1);
});

test('validateOptions: omitted values pass, unknown ones are reported', () => {
  assert.strictEqual(F.validateOptions({}), null);
  assert.strictEqual(F.validateOptions({ resolution: '1080p', fps: '60', quality: 'high', speed: 'fast', encoder: 'gpu' }), null);
  assert.strictEqual(F.validateOptions({ quality: 'ultra' }).field, 'quality');
  assert.strictEqual(F.validateOptions({ speed: 'slow' }).field, 'speed');
  assert.strictEqual(F.validateOptions({ encoder: 'nvenc' }).field, 'encoder');
});

test('timeline-follow recording reacts to external config changes', () => {
  const admin = read('src/admin/admin.js');
  const a = admin.indexOf('window.api.onExternalConfig(');
  const body = admin.slice(a, admin.indexOf('\n    });', a));
  assert.match(body, /SVRecordPanel\.ensureFollow\(!!\(cfg\.recording && cfg\.recording\.followTimeline\)\)/);
});

function loadEnglish() {
  const doc = { documentElement: { lang: '' }, readyState: 'complete', title: '', body: {}, addEventListener: () => {} };
  const win = {
    navigator: { languages: ['en-US'], language: 'en-US' },
    localStorage: { getItem: () => 'en', setItem: () => {} },
    alert: () => {}, confirm: () => {}, document: doc,
    MutationObserver: function () { this.observe = () => {}; },
    Node: { TEXT_NODE: 3, ELEMENT_NODE: 1 },
  };
  win.window = win;
  vm.runInContext(read('src/shared/i18n.js'), vm.createContext(win), { filename: 'i18n.js' });
  return win.SVI18n;
}

test('EN UI: export queue heading reads "Export Queue", toasts are translated', () => {
  const i18n = loadEnglish();
  assert.ok(read('src/admin/admin.js').includes("text: 'Dışa Aktarma Kuyruğu'"));
  assert.strictEqual(i18n.t('Dışa Aktarma Kuyruğu'), 'Export Queue');
  assert.strictEqual(i18n.t('Kaydedilemedi: x'), 'Could not save: x');
  assert.match(read('src/admin/admin.js'), /host\.textContent = window\.SVI18n && window\.SVI18n\.t \? window\.SVI18n\.t\(String\(message\)\) : message;/);
});

test('Linux app audio: one binary hosting two apps gives two selectable rows', () => {
  const streams = [
    { index: 1, pid: 10, binary: 'pacat', appName: 'ToneA' },
    { index: 2, pid: 11, binary: 'pacat', appName: 'ToneB' },
    { index: 3, pid: 12, binary: 'firefox', appName: 'Firefox' },
  ];
  const procs = L.toProcesses(streams);
  const rows = A.candidates(procs);
  assert.deepStrictEqual(rows.map((r) => [r.label, r.count]).sort(), [['Firefox', 1], ['ToneA', 1], ['ToneB', 1]]);
  const a = rows.find((r) => r.label === 'ToneA');
  assert.deepStrictEqual(L.selectStreams(streams, { match: a.match }, 'include'), [1]);
  assert.deepStrictEqual(L.selectStreams(streams, { match: a.match }, 'exclude'), [2, 3]);
  // Binary equal to app name keeps the plain key; old saved plain keys still match
  assert.strictEqual(procs.find((p) => p.pid === 12).name, 'firefox');
  assert.deepStrictEqual(L.selectStreams(streams, { match: 'pacat' }, 'include'), [1, 2]);
  assert.strictEqual(A.resolveTarget({ kind: 'app', match: 'pacat' }, procs, 'linux').pid, 10);
  assert.strictEqual(A.resolveTarget({ kind: 'app', match: 'pacat|ToneB' }, procs, 'linux').pid, 11);
});

test('SIGTERM/SIGINT quit skips the confirm dialog and has a forced exit', () => {
  const a = MAIN.indexOf('function quitOnSignal(');
  assert.ok(a > 0);
  const s = MAIN.slice(a, MAIN.indexOf('\n}', a));
  assert.match(s, /forceQuitApp = true;/);
  assert.match(s, /exportState\.cancel = true/);
  assert.match(s, /setTimeout\(\(\) => app\.exit\(0\), 5000\)\.unref\(\)/);
  assert.match(MAIN, /for \(const sig of \['SIGTERM', 'SIGINT'\]\) process\.on\(sig/);
});
