using System;
using System.IO;
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
    private static int _artworkAttempts;
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

            // Şarkı çalarken veya kapak resmi beklenirken düzenli kontrol zamanlayıcısı (1sn)
            _periodicTimer = new Timer(_ =>
            {
                try
                {
                    if (_isPlaying || _lastArtwork is null)
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

                _session.MediaPropertiesChanged += OnSessionEvent;
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
            _session.MediaPropertiesChanged -= OnSessionEvent;
            _session.PlaybackInfoChanged -= OnSessionEvent;
            _session.TimelinePropertiesChanged -= OnSessionEvent;
        }
        catch { }
        _session = null;
        _lastTrackKey = null;
        _lastArtwork = null;
        _artworkAttempts = 0;
    }

    private static void OnSessionEvent(object? sender, object? args)
    {
        RequestEmit();
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
            _lastArtwork = null;
            _artworkAttempts = 0;
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
                _lastArtwork = null;
                _artworkAttempts = 0;
            }

            // Kapak görseli okuma ve hızlı şarkı geçişlerinde yeniden deneme
            if (_lastArtwork is null && !string.IsNullOrWhiteSpace(title))
            {
                if (props?.Thumbnail is not null)
                {
                    _lastArtwork = await TryReadThumbnailAsync(props.Thumbnail);
                }

                // Spotify veya oynatıcı başlığı verip kapak akışını birkaç yüz ms sonra açıyorsa:
                if (_lastArtwork is null && _artworkAttempts < 6)
                {
                    _artworkAttempts++;
                    var delayMs = _artworkAttempts switch
                    {
                        1 => 120,
                        2 => 260,
                        3 => 500,
                        4 => 900,
                        _ => 1500
                    };
                    _ = Task.Delay(delayMs).ContinueWith(_ => RequestEmit());
                }
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

    private static async Task<string?> TryReadThumbnailAsync(IRandomAccessStreamReference thumbRef)
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
                return $"data:{ct};base64,{Convert.ToBase64String(bytes)}";
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
