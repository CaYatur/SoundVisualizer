'use strict';
/* Sistemin medya oturumunu okur (Windows SMTC).
 *
 * NEDEN AYRI BİR SÜREÇ: Windows'un oturum yöneticisi WinRT üzerinden geliyor
 * ve Electron'un ana sürecinden doğrudan çağrılamıyor. PowerShell üzerinden
 * erişilebiliyor, ama her yoklamada yeni bir PowerShell başlatmak pahalı:
 * ölçtük, ilk kurulum (derleme yükleme + yönetici isteği) ~244 ms sürüyor.
 * Bu yüzden TEK bir uzun ömürlü süreç açıp içinde döngü kuruyoruz; kurulum
 * bir kez ödeniyor, sonraki yoklamalar 0–1 ms.
 *
 * NEDEN ÇIPA YOLLUYORUZ: kaynak konumu sürekli saymıyor. Ölçüm — altı
 * yoklamada `position` beş kez aynı kaldı, sonra 9.6 sn'lik sıçrama yaptı.
 * O yüzden konumu olduğu gibi değil, yanındaki zaman damgasıyla birlikte
 * yolluyoruz; hesabı görselleştirici yapıyor (bkz. src/shared/nowplaying.js).
 * Böylece IPC trafiği de sönük kalıyor: yalnızca HABER olduğunda mesaj var,
 * her karede değil.
 *
 * GİZLİLİK: okunan bilgi (parça adı, sanatçı, konum) yalnızca bu makinedeki
 * görselleştirici pencerelerine gidiyor. Hiçbir ağ isteğine karışmıyor.
 *
 * Windows dışında sessizce devre dışı kalır; özellik "desteklenmiyor" olarak
 * bildirilir, uygulama çalışmaya devam eder.
 */

const { spawn } = require('child_process');

const POLL_MS = 1000;
// İlk satır bu süre içinde gelmezse ortam desteklemiyor sayılır
const FIRST_LINE_TIMEOUT_MS = 12000;
const BACKOFF_MS = [2000, 4000, 8000, 15000, 30000];
// Bu kadar art arda başarısız denemeden sonra pes edilir (WinRT yoksa dönmesin)
const MAX_FAILURES = 5;

/* Çocuk süreçte dönen betik.
   Tırnak/kaçış derdi olmasın diye kabuğa metin olarak değil,
   -EncodedCommand ile base64 (UTF-16LE) olarak veriliyor. */
const SCRIPT = `
$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = New-Object System.Text.UTF8Encoding($false)
try {
  Add-Type -AssemblyName System.Runtime.WindowsRuntime
  $asTask = ([System.WindowsRuntimeSystemExtensions].GetMethods() | Where-Object {
    $_.Name -eq 'AsTask' -and $_.GetParameters().Count -eq 1 -and
    $_.GetParameters()[0].ParameterType.Name -eq 'IAsyncOperation\`1' })[0]
  if ($null -eq $asTask) { throw 'WinRT AsTask kopruleyicisi yok' }
} catch {
  [Console]::Out.WriteLine((ConvertTo-Json @{ ok = $false; fatal = $true; err = [string]$_.Exception.Message } -Compress))
  [Console]::Out.Flush()
  exit 1
}
function Await($op, $rt) {
  $t = $asTask.MakeGenericMethod($rt).Invoke($null, @($op))
  $null = $t.Wait(3000)
  $t.Result
}
$MGR_T = [Windows.Media.Control.GlobalSystemMediaTransportControlsSessionManager, Windows.Media, ContentType = WindowsRuntime]
$PROP_T = [Windows.Media.Control.GlobalSystemMediaTransportControlsSessionMediaProperties, Windows.Media, ContentType = WindowsRuntime]
try {
  $mgr = Await ($MGR_T::RequestAsync()) ($MGR_T)
} catch {
  [Console]::Out.WriteLine((ConvertTo-Json @{ ok = $false; fatal = $true; err = [string]$_.Exception.Message } -Compress))
  [Console]::Out.Flush()
  exit 1
}
$epoch = [datetime]'1970-01-01T00:00:00Z'
while ($true) {
  try {
    $s = $mgr.GetCurrentSession()
    if ($null -eq $s) { $o = @{ ok = $true; has = $false } }
    else {
      $p = Await ($s.TryGetMediaPropertiesAsync()) ($PROP_T)
      $tl = $s.GetTimelineProperties()
      $pi = $s.GetPlaybackInfo()
      $o = @{
        ok = $true; has = $true
        app = [string]$s.SourceAppUserModelId
        title = [string]$p.Title
        artist = [string]$p.Artist
        album = [string]$p.AlbumTitle
        position = $tl.Position.TotalSeconds
        duration = $tl.EndTime.TotalSeconds
        updated = [math]::Round(($tl.LastUpdatedTime.UtcDateTime - $epoch).TotalMilliseconds)
        status = [string]$pi.PlaybackStatus
      }
    }
  } catch {
    $o = @{ ok = $false; err = [string]$_.Exception.Message }
  }
  [Console]::Out.WriteLine((ConvertTo-Json $o -Compress))
  [Console]::Out.Flush()
  Start-Sleep -Milliseconds ${POLL_MS}
}
`;

const EMPTY = {
  has: false, playing: false, title: '', artist: '', album: '', app: '',
  position: 0, duration: 0, updated: 0, received: 0,
};

/* İki durum arasında BİLDİRMEYE değer bir fark var mı?
   Konum her yoklamada değişmiyor; değiştiğinde `updated` damgası da
   değişiyor. Onu izlemek, hem sıçramaları hem duraklamaları yakalıyor. */
function differs(a, b) {
  if (!a || !b) return true;
  return a.has !== b.has
    || a.playing !== b.playing
    || a.title !== b.title
    || a.artist !== b.artist
    || a.album !== b.album
    || a.app !== b.app
    || a.updated !== b.updated
    || Math.abs(a.duration - b.duration) > 0.5;
}

class MediaSession {
  constructor() {
    this.onState = null;
    this.proc = null;
    this.want = false;
    this.state = Object.assign({}, EMPTY);
    this.supported = process.platform === 'win32';
    this.failures = 0;
    this.timer = null;
    this.firstLineTimer = null;
    this.buf = '';
    this.lastError = '';
  }

  /* Durum değiştikçe çağrılacak geri çağırım. */
  subscribe(cb) { this.onState = cb; }

  current() { return this.state; }

  status() {
    return {
      supported: this.supported,
      running: !!this.proc,
      error: this.lastError,
      platform: process.platform,
    };
  }

  start() {
    if (!this.supported) return false;
    this.want = true;
    if (this.proc || this.timer) return true;
    this._spawn();
    return true;
  }

  stop() {
    this.want = false;
    this.failures = 0;
    this._clearTimers();
    this._kill();
    if (this.state.has) {
      this.state = Object.assign({}, EMPTY);
      this._emit();
    }
  }

  _clearTimers() {
    if (this.timer) { clearTimeout(this.timer); this.timer = null; }
    if (this.firstLineTimer) { clearTimeout(this.firstLineTimer); this.firstLineTimer = null; }
  }

  _kill() {
    const p = this.proc;
    this.proc = null;
    if (!p) return;
    try { p.stdout.removeAllListeners(); } catch (_) { /* zaten kapalı */ }
    try { p.kill(); } catch (_) { /* zaten öldü */ }
  }

  _emit() {
    if (this.onState) {
      try { this.onState(this.state); } catch (_) { /* dinleyici hatası bizi durdurmasın */ }
    }
  }

  _spawn() {
    this._clearTimers();
    this.buf = '';
    let proc;
    try {
      const b64 = Buffer.from(SCRIPT, 'utf16le').toString('base64');
      proc = spawn('powershell.exe',
        ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-EncodedCommand', b64],
        { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
    } catch (e) {
      this.lastError = e && e.message ? e.message : String(e);
      this._fail();
      return;
    }
    this.proc = proc;

    /* Betik hiç konuşmazsa (WinRT yok, ilke engelliyor) burada anlaşılır.
       Yoksa süreç sessizce ayakta kalır ve özellik hiç çalışmaz. */
    this.firstLineTimer = setTimeout(() => {
      this.lastError = 'medya oturumu yanıt vermedi';
      this._kill();
      this._fail();
    }, FIRST_LINE_TIMEOUT_MS);

    proc.stdout.setEncoding('utf8');
    proc.stdout.on('data', (chunk) => this._onData(chunk));
    proc.stderr.on('data', (d) => { this.lastError = String(d).trim().slice(0, 300); });
    proc.on('error', (e) => {
      this.lastError = e && e.message ? e.message : String(e);
      this._kill();
      this._fail();
    });
    proc.on('exit', () => {
      if (this.proc !== proc) return; // biz öldürdük
      this.proc = null;
      this._fail();
    });
  }

  _onData(chunk) {
    this.buf += chunk;
    let i;
    while ((i = this.buf.indexOf('\n')) >= 0) {
      const line = this.buf.slice(0, i).trim();
      this.buf = this.buf.slice(i + 1);
      if (line) this._onLine(line);
    }
    // Bir satır anormal uzunsa tamponu boşalt (bozuk çıktıda şişmesin)
    if (this.buf.length > 65536) this.buf = '';
  }

  _onLine(line) {
    let o;
    try { o = JSON.parse(line); } catch (_) { return; }

    if (this.firstLineTimer) { clearTimeout(this.firstLineTimer); this.firstLineTimer = null; }

    if (!o || o.ok !== true) {
      if (o && o.err) this.lastError = String(o.err).slice(0, 300);
      // `fatal`: ortam desteklemiyor, yeniden denemenin anlamı yok
      if (o && o.fatal) { this.supported = false; this.want = false; this._kill(); }
      return;
    }

    // Buraya geldiysek betik çalışıyor; önceki başarısızlıklar geçersiz
    this.failures = 0;
    this.lastError = '';

    const now = Date.now();
    const next = o.has
      ? {
        has: true,
        playing: o.status === 'Playing',
        title: String(o.title || ''),
        artist: String(o.artist || ''),
        album: String(o.album || ''),
        app: String(o.app || ''),
        position: Number(o.position) || 0,
        duration: Number(o.duration) || 0,
        updated: Number(o.updated) || 0,
        received: now,
      }
      : Object.assign({}, EMPTY, { received: now });

    if (!differs(next, this.state)) return;
    this.state = next;
    this._emit();
  }

  /* Yeniden deneme. Geri çekilerek; sürekli başarısız olursa pes eder ki
     kullanıcının makinesinde saniyede bir süreç doğmasın. */
  _fail() {
    if (!this.want) return;
    this.failures++;
    if (this.failures >= MAX_FAILURES) {
      this.supported = false;
      this.want = false;
      if (!this.lastError) this.lastError = 'medya oturumu açılamadı';
      if (this.state.has) { this.state = Object.assign({}, EMPTY); this._emit(); }
      return;
    }
    const wait = BACKOFF_MS[Math.min(this.failures - 1, BACKOFF_MS.length - 1)];
    this._clearTimers();
    this.timer = setTimeout(() => { this.timer = null; if (this.want) this._spawn(); }, wait);
  }
}

module.exports = { MediaSession, EMPTY, differs, SCRIPT };
