using System;
using System.Text.Json;
using System.Text.Json.Serialization;
using System.Threading;
using System.Threading.Tasks;
using Windows.Media.Control;

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
    private static readonly object _gate = new();
    private static readonly DateTime _epoch = new(1970, 1, 1, 0, 0, 0, DateTimeKind.Utc);
    private static Timer? _periodicTimer;
    private static bool _isPlaying;

    public static async Task Main(string[] args)
    {
        Console.OutputEncoding = System.Text.Encoding.UTF8;

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

            // İlk durumu anında yay
            await EmitStateAsync();

            // Şarkı çalarken anchor damgasını taze tutmak için hafif 2sn zamanlayıcı
            _periodicTimer = new Timer(async _ =>
            {
                if (_isPlaying)
                {
                    await EmitStateAsync();
                }
            }, null, 2000, 2000);

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
        AttachCurrentSession();
        _ = EmitStateAsync();
    }

    private static void AttachCurrentSession()
    {
        lock (_gate)
        {
            DetachSession();
            _session = _manager?.GetCurrentSession();
            if (_session is null) return;

            try
            {
                _session.MediaPropertiesChanged += OnSessionEvent;
                _session.PlaybackInfoChanged += OnSessionEvent;
                _session.TimelinePropertiesChanged += OnSessionEvent;
            }
            catch
            {
                // Oturum bu sırada kapanmış olabilir
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
    }

    private static void OnSessionEvent(object? sender, object? args)
    {
        _ = EmitStateAsync();
    }

    private static async Task EmitStateAsync()
    {
        GlobalSystemMediaTransportControlsSession? session;
        lock (_gate) { session = _session; }

        if (session is null)
        {
            _isPlaying = false;
            EmitJson(new SmtcPayload { ok = true, has = false });
            return;
        }

        try
        {
            var playback = session.GetPlaybackInfo();
            var timeline = session.GetTimelineProperties();
            var props = await session.TryGetMediaPropertiesAsync();

            var status = playback?.PlaybackStatus.ToString() ?? "Closed";
            _isPlaying = status == "Playing";

            var updatedMs = timeline is not null
                ? (long)Math.Round((timeline.LastUpdatedTime.UtcDateTime - _epoch).TotalMilliseconds)
                : (long)Math.Round((DateTime.UtcNow - _epoch).TotalMilliseconds);

            var payload = new SmtcPayload
            {
                ok = true,
                has = true,
                app = session.SourceAppUserModelId ?? string.Empty,
                title = props?.Title ?? string.Empty,
                artist = props?.Artist ?? string.Empty,
                album = props?.AlbumTitle ?? string.Empty,
                position = timeline?.Position.TotalSeconds ?? 0.0,
                duration = timeline?.EndTime.TotalSeconds ?? 0.0,
                updated = updatedMs,
                status = status
            };

            EmitJson(payload);
        }
        catch
        {
            // Oturum okuma anında kapanmış olabilir; has=false yay
            _isPlaying = false;
            EmitJson(new SmtcPayload { ok = true, has = false });
        }
    }

    private static void EmitJson(SmtcPayload payload)
    {
        try
        {
            var json = JsonSerializer.Serialize(payload, SmtcJsonContext.Default.SmtcPayload);
            Console.WriteLine(json);
        }
        catch { }
    }

    private static void EmitFatal(string message)
    {
        var payload = new SmtcPayload { ok = false, fatal = true, err = message };
        EmitJson(payload);
    }
}
