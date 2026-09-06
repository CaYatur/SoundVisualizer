using System;
using System.IO;
using System.Security.Cryptography;
using System.Text.Json;
using System.Text.Json.Serialization;
using System.Threading;
using System.Threading.Tasks;
using Windows.Media.Control;
using Windows.Storage.Streams;

namespace SmtcHelper;

public sealed class SmtcPayload
{
    public bool ok { get; set; }
    public bool has { get; set; }
    public bool fatal { get; set; }
    public string? err { get; set; }
    public string? app { get; set; }
    public string? title { get; set; }
    public string? artist { get; set; }
    public string? album { get; set; }
    public string? artwork { get; set; }
    public double position { get; set; }
    public double duration { get; set; }
    public long updated { get; set; }
    public string? status { get; set; }
}

[JsonSourceGenerationOptions(WriteIndented = false, DefaultIgnoreCondition = JsonIgnoreCondition.WhenWritingNull)]
[JsonSerializable(typeof(SmtcPayload))]
internal partial class SmtcJsonContext : JsonSerializerContext
{
}

public static class Program
{
    private static GlobalSystemMediaTransportControlsSessionManager? _manager;
    private static GlobalSystemMediaTransportControlsSession? _session;
    private static readonly object _sessionLock = new();
    private static readonly object _outLock = new();
    private static readonly SemaphoreSlim _emitGate = new(1, 1);
    private static readonly DateTime _epoch = new(1970, 1, 1, 0, 0, 0, DateTimeKind.Utc);
    private static Timer? _periodicTimer;
    private static bool _isPlaying;
    private static string? _lastTrackKey;
    private static string? _lastArtwork;
    private static string? _lastArtworkHash;
    private static string? _prevTrackArtworkHash;
    private static string? _artworkTrackKey;
    private static bool _artworkConfirmed;
    private static int _artworkSchedules;
    private static int _artworkFetchBusy;
    private static volatile int _artworkRecheckPending;
    private static volatile int _artworkPendingVersion;
    private static volatile int _pendingEmits;

    public static async Task Main(string[] args)
    {
        Console.OutputEncoding = System.Text.Encoding.UTF8;

        AppDomain.CurrentDomain.UnhandledException += (_, _) => { };
        TaskScheduler.UnobservedTaskException += (_, e) => { e.SetObserved(); };

        // stdin kapandığında (ana süreç öldüğünde veya kapandığında) temiz çıkış
        _ = Task.Run(() =>
        {
            try
            {
                while (Console.ReadLine() is not null) { }
            }
            catch { }
            Environment.Exit(0);
        });

        try
        {
            _manager = await GlobalSystemMediaTransportControlsSessionManager.RequestAsync();
            if (_manager is null)
            {
                EmitFatal("GlobalSystemMediaTransportControlsSessionManager not available");
                return;
            }

            _manager.CurrentSessionChanged += OnCurrentSessionChanged;
            AttachCurrentSession();

            // İlk durumu hemen yay
            RequestEmit();

            // Şarkı çalarken veya kapak henüz doğrulanmamışken düzenli kontrol (1sn)
            _periodicTimer = new Timer(_ =>
            {
                try
                {
                    if (_isPlaying || _lastArtwork is null || !_artworkConfirmed)
                    {
                        RequestEmit();
                    }
                }
                catch { }
            }, null, 1000, 1000);

            // Süreci canlı tut
            await Task.Delay(Timeout.Infinite);
        }
        catch (Exception ex)
        {
            EmitFatal(ex.Message);
        }
    }

    private static void OnCurrentSessionChanged(
        GlobalSystemMediaTransportControlsSessionManager sender,
        CurrentSessionChangedEventArgs args)
    {
        try
        {
            AttachCurrentSession();
            RequestEmit();
        }
        catch { }
    }

    private static void AttachCurrentSession()
    {
        lock (_sessionLock)
        {
            DetachSession();
            try
            {
                _session = _manager?.GetCurrentSession();
                if (_session is null) return;

                _session.MediaPropertiesChanged += OnMediaPropertiesChanged;
                _session.PlaybackInfoChanged += OnSessionEvent;
                _session.TimelinePropertiesChanged += OnSessionEvent;
            }
            catch
            {
                // Oturum açılış anında kapanmış olabilir
            }
        }
    }

    private static void DetachSession()
    {
        if (_session is null) return;
        try
        {
            _session.MediaPropertiesChanged -= OnMediaPropertiesChanged;
            _session.PlaybackInfoChanged -= OnSessionEvent;
            _session.TimelinePropertiesChanged -= OnSessionEvent;
        }
        catch { }
        _session = null;
        _lastTrackKey = null;
        ResetArtworkState(clearPrevious: true);
        Interlocked.Increment(ref _artworkPendingVersion);
    }

    private static void OnSessionEvent(object? sender, object? args)
    {
        RequestEmit();
    }

    /* SMTC kapak akışını başlık/sanatçıdan sonra günceller. İlk okuma çoğu
       zaman önceki parçanın görseli olduğu için, özellik olayı gelince
       kapağı yeniden oku; kilitli “aynı albüm” kabulünü boz. */
    private static void OnMediaPropertiesChanged(object? sender, object? args)
    {
        RequestEmit();
        RequestArtworkRecheck();
    }

    private static void RequestArtworkRecheck()
    {
        GlobalSystemMediaTransportControlsSession? session;
        string? key;
        lock (_sessionLock) { session = _session; key = _lastTrackKey; }
        if (session is null || string.IsNullOrWhiteSpace(key) || key == "||") return;
        StartArtworkFetch(session, key, isRecheck: true);
    }

    /* Olayları birleştirerek (coalesce) çalıştırır.
       Birden fazla olay peş peşe geldiğinde yarış durumu (race condition)
       ve eşzamanlı COM/akış çatışması oluşmasını engeller. */
    private static void RequestEmit()
    {
        Interlocked.Exchange(ref _pendingEmits, 1);
        _ = Task.Run(async () =>
        {
            if (!await _emitGate.WaitAsync(0)) return;
            try
            {
                while (Interlocked.Exchange(ref _pendingEmits, 0) == 1)
                {
                    await EmitStateInternalAsync();
                }
            }
            catch { }
            finally
            {
                _emitGate.Release();
            }
        });
    }

    private static async Task EmitStateInternalAsync()
    {
        GlobalSystemMediaTransportControlsSession? session;
        lock (_sessionLock) { session = _session; }

        if (session is null)
        {
            _isPlaying = false;
            _lastTrackKey = null;
            ResetArtworkState(clearPrevious: true);
            Interlocked.Increment(ref _artworkPendingVersion);
            EmitJson(new SmtcPayload { ok = true, has = false });
            return;
        }

        try
        {
            GlobalSystemMediaTransportControlsSessionPlaybackInfo? playback = null;
            GlobalSystemMediaTransportControlsSessionTimelineProperties? timeline = null;
            GlobalSystemMediaTransportControlsSessionMediaProperties? props = null;

            try { playback = session.GetPlaybackInfo(); } catch { }
            try { timeline = session.GetTimelineProperties(); } catch { }
            try { props = await session.TryGetMediaPropertiesAsync(); } catch { }

            var status = playback?.PlaybackStatus.ToString() ?? "Closed";
            _isPlaying = status == "Playing";

            var updatedMs = timeline is not null
                ? (long)Math.Round((timeline.LastUpdatedTime.UtcDateTime - _epoch).TotalMilliseconds)
                : (long)Math.Round((DateTime.UtcNow - _epoch).TotalMilliseconds);

            var title = props?.Title ?? string.Empty;
            var artist = props?.Artist ?? string.Empty;
            var album = props?.AlbumTitle ?? string.Empty;
            var trackKey = $"{title}|{artist}|{album}";

            if (trackKey != _lastTrackKey)
            {
                _lastTrackKey = trackKey;
                _prevTrackArtworkHash = _lastArtworkHash;
                _lastArtwork = null;
                _lastArtworkHash = null;
                _artworkTrackKey = null;
                _artworkConfirmed = false;
                _artworkSchedules = 0;
                // Şarkı değiştiğinde eski yükleyiciyi iptal et; ilk okuma çoğu zaman ESKİ kapağı verir
                StartArtworkFetch(session, trackKey);
            }
            else if (!_artworkConfirmed && !string.IsNullOrWhiteSpace(title) && Volatile.Read(ref _artworkFetchBusy) == 0)
            {
                // Pencere bitti ama kapak hâlâ yok / doğrulanmadıysa kısa aralıklarla yeniden dene
                StartArtworkFetch(session, trackKey);
            }

            var payload = new SmtcPayload
            {
                ok = true,
                has = true,
                app = session.SourceAppUserModelId ?? string.Empty,
                title = title,
                artist = artist,
                album = album,
                artwork = _lastArtwork,
                position = timeline?.Position.TotalSeconds ?? 0.0,
                duration = timeline?.EndTime.TotalSeconds ?? 0.0,
                updated = updatedMs,
                status = status
            };

            EmitJson(payload);
        }
        catch
        {
            _isPlaying = false;
            EmitJson(new SmtcPayload { ok = true, has = false });
        }
    }

    private static void ResetArtworkState(bool clearPrevious)
    {
        _lastArtwork = null;
        _lastArtworkHash = null;
        _artworkTrackKey = null;
        _artworkConfirmed = false;
        _artworkSchedules = 0;
        Interlocked.Exchange(ref _artworkFetchBusy, 0);
        if (clearPrevious) _prevTrackArtworkHash = null;
    }Interlocked.Exchange(ref _artworkRecheckPending, 0);
        if (clearPrevious) _prevTrackArtworkHash = null;
    }

    private static void StartArtworkFetch(GlobalSystemMediaTransportControlsSession session, string expectedTrackKey, bool isRecheck = false)
    {
        if (string.IsNullOrWhiteSpace(expectedTrackKey) || expectedTrackKey == "||") return;
        if (!isRecheck && _artworkConfirmed) return;
        if (!isRecheck && _artworkSchedules >= 8)
        {
            // Uzun süre yalnızca önceki kapak geldiyse aynı albüm olabilir; yine de
            // MediaPropertiesChanged ile yeniden kontrol açık kalır (isRecheck).
            _artworkConfirmed = _lastArtwork is not null;
            return;
        }

        var myVersion = Interlocked.Increment(ref _artworkPendingVersion);
        _artworkTrackKey = expectedTrackKey;
        if (!isRecheck) _artworkSchedules++;
        Interlocked.Exchange(ref _artworkFetchBusy, 1);

        _ = Task.Run(async () =>
        {
            try
            {
                // Hızlı atlamada SMTC ilk OpenRead'de çoğu zaman ÖNCEKİ kapağı verir.
                // Farklı hash = gerçek kapak, hemen yayınla. Aynı hash = şüpheli gecikme;
                // geçici göster, kilitleme. Gecikmeli gerçek kapak gelince üzerine yaz.
                int[] delays = isRecheck
                    ? [0, 80, 200, 450]
                    : _artworkSchedules switch
                    {
                        1 => [0, 40, 80, 140, 220, 350, 500, 800, 1200],
                        2 => [250, 600, 1100],
                        3 => [400, 900, 1500],
                        _ => [800, 1600],
                    };
                string? candidateArt = null;
                string? candidateHash = null;

                foreach (var delay in delays)
                {
                    if (delay > 0) await Task.Delay(delay);
                    if (_artworkPendingVersion != myVersion || _lastTrackKey != expectedTrackKey) return;

                    try
                    {
                        var p = await session.TryGetMediaPropertiesAsync();
                        if (_artworkPendingVersion != myVersion || _lastTrackKey != expectedTrackKey) return;
                        if (p?.Thumbnail is null) continue;

                        var read = await TryReadThumbnailAsync(p.Thumbnail);
                        if (read is null) continue;
                        if (_artworkPendingVersion != myVersion || _lastTrackKey != expectedTrackKey) return;

                        var hash = HashBytes(read.Value.Bytes);
                        var art = ToDataUrl(read.Value.Bytes, read.Value.ContentType);
                        var sameAsPrev = _prevTrackArtworkHash is not null && hash == _prevTrackArtworkHash;

                        if (sameAsPrev)
                        {
                            candidateArt = art;
                            candidateHash = hash;
                            continue;
                        }

                        if (_lastArtworkHash != hash)
                        {
                            _lastArtwork = art;
                            _lastArtworkHash = hash;
                            RequestEmit();
                        }
                        _artworkConfirmed = true;
                        return;
                    }
                    catch
                    {
                        // COM veya akış meşgul, sonraki gecikmede tekrar dene
                    }
                }

                if (_artworkPendingVersion != myVersion || _lastTrackKey != expectedTrackKey) return;

                // Önceki kapağın aynısı: ekranı boş bırakmamak için geçici yayınla, kilitleme.
                if (candidateArt is not null && candidateHash is not null && _lastArtworkHash is null)
                {
                    _lastArtwork = candidateArt;
                    _lastArtworkHash = candidateHash;
                    RequestEmit();
                }
            }
            finally
            {
                if (_artworkPendingVersion == myVersion)
                {
                    Interlocked.Exchange(ref _artworkFetchBusy, 0);
                    if (Interlocked.Exchange(ref _artworkRecheckPending, 0) == 1
                        && _lastTrackKey == expectedTrackKey)
                    {
                        StartArtworkFetch(session, expectedTrackKey, isRecheck: true);
                    }
                }
                else
                {
                    Interlocked.Exchange(ref _artworkRecheckPending, 1
            }
        });
    }

    private static string HashBytes(byte[] bytes) => Convert.ToHexString(SHA256.HashData(bytes));

    private static string ToDataUrl(byte[] bytes, string contentType)
        => $"data:{contentType};base64,{Convert.ToBase64String(bytes)}";

    private static async Task<(byte[] Bytes, string ContentType)?> TryReadThumbnailAsync(IRandomAccessStreamReference thumbRef)
    {
        try
        {
            using var cts = new CancellationTokenSource(TimeSpan.FromSeconds(2));
            var stream = await thumbRef.OpenReadAsync().AsTask(cts.Token);
            if (stream is null || stream.Size == 0) return null;

            using (stream)
            {
                using var netStream = System.IO.WindowsRuntimeStreamExtensions.AsStreamForRead(stream);
                using var ms = new MemoryStream();
                await netStream.CopyToAsync(ms, cts.Token);
                var bytes = ms.ToArray();
                if (bytes.Length == 0) return null;

                var ct = string.IsNullOrEmpty(stream.ContentType) ? "image/jpeg" : stream.ContentType;
                return (bytes, ct);
            }
        }
        catch
        {
            return null;
        }
    }

    private static void EmitJson(SmtcPayload payload)
    {
        lock (_outLock)
        {
            try
            {
                var json = JsonSerializer.Serialize(payload, SmtcJsonContext.Default.SmtcPayload);
                Console.WriteLine(json);
                Console.Out.Flush();
            }
            catch { }
        }
    }

    private static void EmitFatal(string message)
    {
        var payload = new SmtcPayload { ok = false, fatal = true, err = message };
        EmitJson(payload);
    }
}
