'use strict';
/* DIŞA AKTARMA KUYRUĞU (#526).
 *
 * Uçtan uca ölçüldü (uygulamada, --bench-export kuyruk kipi ve panelin
 * kendi düğmeleriyle):
 *   - aynı adlı iki iş: ikincisi "q1 (2).mp4"
 *   - ses dosyası olmayan iş "Ses dosyası bulunamadı." ile hata, kuyruk sürdü
 *   - işler eklendikten SONRA sahne değişti: ilk iki işin kareleri birebir
 *     aynı (framemd5) — her iş eklendiği anın sahnesini taşıyor
 *   - Durdur: koşan iş iptal, kalanlar bekliyor, klasörde yarım dosya yok
 *   - panel: satırlar Bekliyor → Çalışıyor → Bitti; kuyruk bitince
 *     "Videoya Aktar" yeniden açılıyor
 */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const read = (p) => fs.readFileSync(path.join(__dirname, '..', p), 'utf8');
const M = read('src/main/main.js');
const fn = (name) => {
  const i = M.indexOf('function ' + name + '(');
  assert.ok(i > 0, name);
  const end = /\r?\n\}\r?\n/.exec(M.slice(i));
  return M.slice(i, i + (end ? end.index : 4000));
};

test('iş eklendiği anın sahnesini taşıyor', () => {
  const add = fn('queueAdd');
  assert.match(add, /cfg: JSON\.parse\(JSON\.stringify\(currentConfig \|\| \{\}\)\),/);
  assert.match(add, /outputPath: queueUniquePath\(r\.outputPath\),/);
  assert.match(add, /badOutPath\(r\.outputPath, \[fmt\.ext\]\)/, 'yol kuralı tek işle aynı');
  assert.match(add, /if \(exportQueue\.items\.length >= QUEUE_MAX\) break;/);
  assert.match(M, /startExportJob\(Object\.assign\(\{\}, item\.opts, \{ audioPath: item\.audioPath, outputPath: item\.outputPath \}\), null, \{ cfg: item\.cfg \}\)/);
  // İş, verilen kopyayı kullanıyor; canlı yapılandırmayı değil
  const job = M.slice(M.indexOf('async function startExportJob('), M.indexOf("ipcMain.handle('export:start'"));
  assert.match(job, /const jobCfg = \(extra && extra\.cfg\) \|\| currentConfig;/);
  assert.ok(!/currentConfig\./.test(job.slice(job.indexOf('const jobCfg'))), 'işin içinde currentConfig okunmuyor');
});

test('hata kuyruğu durdurmuyor; başlamayan iş bekleyiciyi geri alıyor', () => {
  const run = fn('queueRun');
  assert.match(run, /if \(!res \|\| !res\.ok\) \{[\s\S]*?exportDoneWaiters\.indexOf\(resolveDone\)[\s\S]*?item\.status = 'error';[\s\S]*?continue;/);
  assert.match(run, /while \(exportState\) await/, 'elle başlatılmış iş bitene kadar bekliyor');
  assert.match(run, /finally \{\s*exportQueue\.running = false;/);
});

test('durdurma, kapanış ve tek iş', () => {
  assert.match(fn('queueStop'), /exportQueue\.stopping = true;\s*if \(exportState\) exportState\.cancel = true;/);
  assert.match(M, /function shutdownCleanup\(\) \{[\s\S]{0,600}exportQueue\.stopping = true;\s*if \(exportState\) finalizeExport\('cancelled'\);/);
  const h = M.slice(M.indexOf("ipcMain.handle('export:start'"), M.indexOf("ipcMain.handle('export:start'") + 300);
  assert.match(h, /if \(exportQueue\.running\) return \{ ok: false/);
  assert.match(fn('queueRemove'), /it\.status !== 'running'/, 'koşan iş kaldırılamaz');
});

test('aynı ad diskte ya da kuyrukta varsa numaralanıyor', () => {
  const u = fn('queueUniquePath');
  assert.match(u, /fs\.existsSync\(q\) \|\| exportQueue\.items\.some\(\(it\) => it\.status !== 'done' && it\.outputPath === q\)/);
  assert.match(u, /stem \+ ' \(' \+ n \+ '\)' \+ ext/);
});

test('finalizeExport bekleyenlere sonucu veriyor', () => {
  const fin = M.slice(M.indexOf('function finalizeExport('), M.indexOf("notifyAdmin('export-done'", M.indexOf('function finalizeExport(')));
  assert.match(fin, /const waiters = exportDoneWaiters\.splice\(0\);/);
  assert.match(fin, /w\(\{ status, message: message \|\| '', output: finalOut \}\)/);
});

test('panel: düğmeler, satırlar, kuyruğun açtığı durum kapanıyor, çeviriler', () => {
  const A = read('src/admin/admin.js');
  assert.match(A, /\{ type: 'exportqueue', tail: true \},/);
  assert.match(A, /case 'exportqueue':\s*return exportQueueCtrl\(def\);/);
  assert.match(A, /else if \(!exportQueueSt\.running && exportByQueue\) \{ exporting = false; exportByQueue = false; setExportUI\(false\); \}/);
  for (const k of ['Kuyruğa Ekle', 'Birden Çok Ses Ekle', 'Kuyruğu Başlat', 'Kuyruğu Durdur', 'Bitenleri Temizle',
    'Bekliyor', 'Çalışıyor', 'Bitti', 'İptal edildi', 'Yeniden Dene', 'Kuyruk boş.']) {
    assert.ok(read('src/shared/i18n.js').includes("'" + k + "':"), k);
  }
  const P = read('src/main/preload-admin.js');
  for (const k of ['exportQueueAdd', 'exportQueueStart', 'exportQueueStop', 'exportQueueRemove', 'exportQueueRetry', 'exportQueueClear', 'onExportQueue', 'pickExportAudioMulti', 'pickExportFolder']) {
    assert.ok(P.includes(k + ':'), k);
  }
});
