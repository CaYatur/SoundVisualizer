'use strict';
/* AYNI AYAR KLASÖRÜNÜ KULLANAN KOPYALAR (#564).

   Geliştirme (`npm start`), kurulu ve portable derlemelerin hepsi aynı kullanıcı
   klasörünü kullanıyor (package.json `name`: soundvisualizer) ve hiçbiri
   diğerinden haberdar değildi. Her kopya settings.json'ı her değişiklikte —
   dinamik renk temasıyla her parçada — baştan yazıyor; iki kopya açıkken son
   yazan kazanıyor ve ikisi de fark etmiyor.

   KAYIT DEFTERİ: her kopya `instances/<pid>.json` yazar, birkaç saniyede bir
   tazeler ve kapanırken siler. Çöken kopyanın kaydı yerinde kalır; bu yüzden
   "çalışıyor" İKİ şarta bağlı:
     - kayıt TAZE: son tazeleme STALE_MS içinde. Çöken kopya en geç bu kadar
       sonra düşer.
     - süreç YAŞIYOR: çöküşü tazelik süresini beklemeden görmek için. Tek
       başına yetmez — işletim sistemi süreç kimliklerini yeniden dağıtıyor ve
       ölü bir kopyanın kimliği başka bir programa geçebiliyor.
   Uyku dönüşünde bütün kayıtlar bir an bayat görünür ve bir sonraki tazelemede
   geri gelir; bunun bedeli uyarının birkaç saniye kaybolması, zararsız.

   Electron'a dokunmuyor: testler pencere açmadan, geçici klasörde koşuyor. */

const fs = require('fs');
const path = require('path');

const HEARTBEAT_MS = 4000;
const STALE_MS = 15000;
/* Bu kadar eski kayıt, kimliği yaşıyor görünse bile silinir: o kimlik artık
   bizim kopyamız değildir. */
const PRUNE_MS = 10 * 60 * 1000;

const ROLES = ['app', 'selftest', 'screenshots'];
const KINDS = ['installed', 'portable', 'dev'];

/* Süreç yaşıyor mu? `kill(pid, 0)` sinyal göndermez, yalnız varlığı sınar.
   EPERM: süreç var ama başka bir kullanıcının — yaşıyor sayılır. */
function isAlive(pid, kill) {
  const k = kill || process.kill.bind(process);
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    k(pid, 0);
    return true;
  } catch (e) {
    return !!(e && e.code === 'EPERM');
  }
}

/* Hangi derleme. electron-builder'ın portable başlatıcısı açtığı uygulamaya
   PORTABLE_EXECUTABLE_FILE/DIR verir; paketlenmemiş olan geliştirmedir. */
function kindOf(env, isPackaged) {
  const e = env || {};
  if (e.PORTABLE_EXECUTABLE_FILE || e.PORTABLE_EXECUTABLE_DIR) return 'portable';
  return isPackaged ? 'installed' : 'dev';
}

/* Kullanıcıya gösterilecek yol. Geliştirmede `electron.exe` hiçbir şey
   söylemez, depo klasörü söyler; portable'da açılan dosya kullanıcının
   indirdiği .exe'dir, geçici klasöre açılmış kopyası değil. */
function exeFor(kind, o) {
  const x = o || {};
  if (kind === 'portable' && x.env && x.env.PORTABLE_EXECUTABLE_FILE) return x.env.PORTABLE_EXECUTABLE_FILE;
  if (kind === 'dev' && x.appPath) return x.appPath;
  return x.execPath || '';
}

/* Diske giden kayıt. Bilinmeyen alanlar taşınmaz: klasör başka sürümlerle
   paylaşılıyor ve okuyan taraf yalnız bunları bekliyor. */
function entry(o) {
  const x = o || {};
  return {
    pid: x.pid,
    version: String(x.version || ''),
    kind: KINDS.indexOf(x.kind) >= 0 ? x.kind : 'dev',
    role: ROLES.indexOf(x.role) >= 0 ? x.role : 'app',
    exe: String(x.exe || ''),
    startedAt: Number(x.startedAt) || 0,
    updatedAt: Number(x.updatedAt) || 0,
    locale: x.locale === 'tr' || x.locale === 'en' ? x.locale : '',
  };
}

function fileFor(dir, pid) {
  return path.join(dir, pid + '.json');
}

/* Önce geçici dosyaya, sonra yeniden adlandırma: okuyan kopya yarım yazılmış
   bir kayıt görmesin. Yeniden adlandırma Windows'ta hedef o an açıksa
   düşebiliyor; o durumda doğrudan yazılır — bir tazeleme kaybolursa bir
   sonraki telafi eder. */
function write(dir, o, fsMod) {
  const f = fsMod || fs;
  const e = entry(o);
  try {
    f.mkdirSync(dir, { recursive: true });
    const target = fileFor(dir, e.pid);
    const tmp = target + '.tmp';
    const text = JSON.stringify(e);
    try {
      f.writeFileSync(tmp, text, 'utf8');
      f.renameSync(tmp, target);
    } catch {
      f.writeFileSync(target, text, 'utf8');
      try { f.unlinkSync(tmp); } catch { /* yoktu */ }
    }
    return true;
  } catch {
    return false;
  }
}

function remove(dir, pid, fsMod) {
  const f = fsMod || fs;
  try {
    f.unlinkSync(fileFor(dir, pid));
    return true;
  } catch {
    return false;
  }
}

/* Şu an çalışan DİĞER kopyalar, en eski önce.
   Yan etki: ölü ve çok eski kayıtları siler. Bozuk dosya (yarım yazılmış ya
   da elle bozulmuş) atlanır ve yalnız çok eskiyse silinir — başka bir
   kopyanın o an yazmakta olduğu dosyayı silmemek için. */
function live(dir, opts) {
  const o = opts || {};
  const f = o.fs || fs;
  const now = typeof o.now === 'number' ? o.now : Date.now();
  const alive = o.isAlive || ((pid) => isAlive(pid));
  const self = o.selfPid;
  let names;
  try {
    names = f.readdirSync(dir);
  } catch {
    return [];
  }
  const out = [];
  for (const name of names) {
    if (!/^\d+\.json$/.test(name)) continue;
    const file = path.join(dir, name);
    let data = null;
    try {
      data = entry(JSON.parse(f.readFileSync(file, 'utf8')));
    } catch {
      data = null;
    }
    if (!data || !Number.isInteger(data.pid)) {
      try {
        const st = f.statSync(file);
        if (now - st.mtimeMs > PRUNE_MS) f.unlinkSync(file);
      } catch { /* başkası sildi */ }
      continue;
    }
    if (data.pid === self) continue;
    const age = now - data.updatedAt;
    const running = alive(data.pid);
    if (!running || age > PRUNE_MS) {
      try { f.unlinkSync(file); } catch { /* başkası sildi */ }
      continue;
    }
    if (age > STALE_MS) continue;
    out.push(data);
  }
  out.sort((a, b) => a.startedAt - b.startedAt || a.pid - b.pid);
  return out;
}

/* Değişti mi? Panele yalnız küme değişince haber verilir; her tazelemede
   değil. Tazeleme zamanı karşılaştırmaya girmez. */
function signature(list) {
  return (list || [])
    .map((e) => [e.pid, e.role, e.kind, e.version, e.exe, e.startedAt].join('|'))
    .sort()
    .join('\n');
}

module.exports = {
  HEARTBEAT_MS,
  STALE_MS,
  PRUNE_MS,
  ROLES,
  KINDS,
  isAlive,
  kindOf,
  exeFor,
  entry,
  fileFor,
  write,
  remove,
  live,
  signature,
};
