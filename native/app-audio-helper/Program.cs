// Uygulama başına ses yakalama — Windows yardımcısı.
//
// NEDEN AYRI BİR SÜREÇ: WASAPI'nin süreç loopback'i (ActivateAudioInterfaceAsync
// + VIRTUAL_AUDIO_DEVICE_PROCESS_LOOPBACK) COM üzerinden geliyor ve Node'dan
// çağrılamıyor. SMTC yardımcısıyla aynı desen: kendi kendine yeten tek dosyalık
// bir .NET ikilisi, borudan konuşuyor. Yerel node eklentisi yerine bunu seçtik
// çünkü eklenti Electron'un ABI'sine bağlanır ve her sürüm yükseltmesinde
// yeniden derlenmesi gerekir.
//
// ÖLÇÜLDÜ: hedef süreç ağacını dahil ederek 3 saniyede 299 paket / 143.520 kare
// (≈48 kHz) geldi, tepe genlik 0,21. Hariç tutma kipinde ve ses çıkarmayan bir
// hedefte tepe 0,0000 — yani süzme gerçekten çalışıyor.
//
// Kullanım:
//   app-audio-helper --list
//       Ses oturumu olan uygulamaları JSON olarak yazar, çıkar.
//   app-audio-helper --capture <pid> [include|exclude]
//       48 kHz stereo float32 ham PCM'i stdout'a akıtır. Durum satırları
//       stderr'e gider.
using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Runtime.InteropServices;
using System.Text;
using System.Threading;

internal static class Program
{
    const string VAD_PROCESS_LOOPBACK = "VAD\\Process_Loopback";

    const int AUDCLNT_SHAREMODE_SHARED = 0;
    const uint AUDCLNT_STREAMFLAGS_LOOPBACK = 0x00020000;
    const uint AUDCLNT_STREAMFLAGS_EVENTCALLBACK = 0x00040000;
    const uint AUDCLNT_BUFFERFLAGS_SILENT = 0x2;
    const int VT_BLOB = 65;

    const int ACTIVATION_TYPE_PROCESS_LOOPBACK = 1;
    const int INCLUDE_TARGET_PROCESS_TREE = 0;
    const int EXCLUDE_TARGET_PROCESS_TREE = 1;

    // Yakalama biçimi. Süreç loopback istemcisinde GetMixFormat YOK; biçimi
    // biz veriyoruz ve karıştırıcı bize bu biçimde çeviriyor.
    const int SAMPLE_RATE = 48000;
    const int CHANNELS = 2;

    // ------------------------------------------------------------- COM yapıları

    [StructLayout(LayoutKind.Sequential)]
    struct ProcessLoopbackParams
    {
        public uint TargetProcessId;
        public int ProcessLoopbackMode;
    }

    [StructLayout(LayoutKind.Sequential)]
    struct ActivationParams
    {
        public int ActivationType;
        public ProcessLoopbackParams Loopback;
    }

    // PROPVARIANT'ın VT_BLOB dalı (x64 yerleşimi)
    [StructLayout(LayoutKind.Sequential)]
    struct PropVariantBlob
    {
        public ushort vt;
        public ushort r1, r2, r3;
        public uint cbSize;
        public uint pad;
        public IntPtr pBlobData;
    }

    [StructLayout(LayoutKind.Sequential, Pack = 1)]
    struct WaveFormatEx
    {
        public ushort wFormatTag;
        public ushort nChannels;
        public uint nSamplesPerSec;
        public uint nAvgBytesPerSec;
        public ushort nBlockAlign;
        public ushort wBitsPerSample;
        public ushort cbSize;
    }

    [ComImport, Guid("72A22D78-CDE4-431D-B8CC-843A71199B6D"),
     InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    interface IActivateAudioInterfaceAsyncOperation
    {
        void GetActivateResult(out int activateResult,
            [MarshalAs(UnmanagedType.IUnknown)] out object activatedInterface);
    }

    [ComImport, Guid("41D949AB-9862-444A-80F6-C261334DA5EB"),
     InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    interface IActivateAudioInterfaceCompletionHandler
    {
        void ActivateCompleted(IActivateAudioInterfaceAsyncOperation operation);
    }

    [ComImport, Guid("1CB9AD4C-DBFA-4c32-B178-C2F568A703B2"),
     InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    interface IAudioClient
    {
        [PreserveSig] int Initialize(int shareMode, uint streamFlags, long hnsBufferDuration,
            long hnsPeriodicity, IntPtr format, IntPtr audioSessionGuid);
        [PreserveSig] int GetBufferSize(out uint bufferFrameCount);
        [PreserveSig] int GetStreamLatency(out long latency);
        [PreserveSig] int GetCurrentPadding(out uint padding);
        [PreserveSig] int IsFormatSupported(int shareMode, IntPtr format, out IntPtr closestMatch);
        [PreserveSig] int GetMixFormat(out IntPtr format);
        [PreserveSig] int GetDevicePeriod(out long defaultPeriod, out long minimumPeriod);
        [PreserveSig] int Start();
        [PreserveSig] int Stop();
        [PreserveSig] int Reset();
        [PreserveSig] int SetEventHandle(IntPtr handle);
        [PreserveSig] int GetService(ref Guid riid,
            [MarshalAs(UnmanagedType.IUnknown)] out object service);
    }

    [ComImport, Guid("C8ADBD64-E71E-48a0-A4DE-185C395CD317"),
     InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    interface IAudioCaptureClient
    {
        [PreserveSig] int GetBuffer(out IntPtr data, out uint numFramesToRead,
            out uint flags, out ulong devicePosition, out ulong qpcPosition);
        [PreserveSig] int ReleaseBuffer(uint numFramesRead);
        [PreserveSig] int GetNextPacketSize(out uint numFramesInNextPacket);
    }

    // --- oturum listeleme için

    [ComImport, Guid("BCDE0395-E52F-467C-8E3D-C4579291692E")]
    class MMDeviceEnumerator { }

    [ComImport, Guid("A95664D2-9614-4F35-A746-DE8DB63617E6"),
     InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    interface IMMDeviceEnumerator
    {
        [PreserveSig] int EnumAudioEndpoints(int dataFlow, int stateMask, out IntPtr devices);
        [PreserveSig] int GetDefaultAudioEndpoint(int dataFlow, int role, out IMMDevice endpoint);
    }

    [ComImport, Guid("D666063F-1587-4E43-81F1-B948E807363F"),
     InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    interface IMMDevice
    {
        [PreserveSig] int Activate(ref Guid iid, int clsCtx, IntPtr activationParams,
            [MarshalAs(UnmanagedType.IUnknown)] out object iface);
    }

    [ComImport, Guid("77AA99A0-1BD6-484F-8BC7-2C654C9A9B6F"),
     InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    interface IAudioSessionManager2
    {
        [PreserveSig] int NotUsed1();
        [PreserveSig] int NotUsed2();
        [PreserveSig] int GetSessionEnumerator(out IAudioSessionEnumerator sessionEnum);
    }

    [ComImport, Guid("E2F5BB11-0570-40CA-ACDD-3AA01277DEE8"),
     InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    interface IAudioSessionEnumerator
    {
        [PreserveSig] int GetCount(out int count);
        [PreserveSig] int GetSession(int index, out IAudioSessionControl session);
    }

    [ComImport, Guid("F4B1A599-7266-4319-A8CA-E70ACB11E8CD"),
     InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    interface IAudioSessionControl
    {
        [PreserveSig] int GetState(out int state);
    }

    [ComImport, Guid("BFB7FF88-7239-4FC9-8FA2-07C950BE9C6D"),
     InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    interface IAudioSessionControl2
    {
        [PreserveSig] int GetState(out int state);
        [PreserveSig] int GetDisplayName([MarshalAs(UnmanagedType.LPWStr)] out string name);
        [PreserveSig] int SetDisplayName([MarshalAs(UnmanagedType.LPWStr)] string value, ref Guid ctx);
        [PreserveSig] int GetIconPath([MarshalAs(UnmanagedType.LPWStr)] out string path);
        [PreserveSig] int SetIconPath([MarshalAs(UnmanagedType.LPWStr)] string value, ref Guid ctx);
        [PreserveSig] int GetGroupingParam(out Guid group);
        [PreserveSig] int SetGroupingParam(ref Guid group, ref Guid ctx);
        [PreserveSig] int RegisterAudioSessionNotification(IntPtr n);
        [PreserveSig] int UnregisterAudioSessionNotification(IntPtr n);
        [PreserveSig] int GetSessionIdentifier([MarshalAs(UnmanagedType.LPWStr)] out string id);
        [PreserveSig] int GetSessionInstanceIdentifier([MarshalAs(UnmanagedType.LPWStr)] out string id);
        [PreserveSig] int GetProcessId(out uint pid);
        [PreserveSig] int IsSystemSoundsSession();
        [PreserveSig] int SetDuckingPreference(bool optOut);
    }

    sealed class Handler : IActivateAudioInterfaceCompletionHandler
    {
        public readonly ManualResetEventSlim Done = new(false);
        public IActivateAudioInterfaceAsyncOperation Op;
        public void ActivateCompleted(IActivateAudioInterfaceAsyncOperation operation)
        {
            Op = operation;
            Done.Set();
        }
    }

    [DllImport("Mmdevapi.dll", ExactSpelling = true, PreserveSig = false)]
    static extern void ActivateAudioInterfaceAsync(
        [MarshalAs(UnmanagedType.LPWStr)] string deviceInterfacePath,
        ref Guid riid, IntPtr activationParams,
        IActivateAudioInterfaceCompletionHandler completionHandler,
        out IActivateAudioInterfaceAsyncOperation operation);

    [DllImport("kernel32.dll", SetLastError = true)]
    static extern IntPtr CreateEventW(IntPtr attrs, bool manualReset, bool initialState, IntPtr name);
    [DllImport("kernel32.dll", SetLastError = true)]
    static extern uint WaitForSingleObject(IntPtr handle, uint ms);

    // ------------------------------------------------------------------ giriş

    [MTAThread]
    static int Main(string[] args)
    {
        try
        {
            if (args.Length > 0 && args[0] == "--list") return ListSessions();
            if (args.Length > 1 && args[0] == "--capture")
            {
                uint pid = uint.TryParse(args[1], out var p) ? p : 0;
                int mode = args.Length > 2 && args[2] == "exclude"
                    ? EXCLUDE_TARGET_PROCESS_TREE : INCLUDE_TARGET_PROCESS_TREE;
                if (pid == 0) { Err("BAD-ARGS gecersiz surec kimligi"); return 2; }
                return Capture(pid, mode);
            }
            Err("BAD-ARGS kullanim: --list | --capture <pid> [include|exclude]");
            return 2;
        }
        catch (Exception e)
        {
            Err("FATAL " + e.Message);
            return 1;
        }
    }

    static void Err(string s)
    {
        Console.Error.WriteLine(s);
        Console.Error.Flush();
    }

    // ------------------------------------------------------------- listeleme

    static string JsonEscape(string s)
    {
        var sb = new StringBuilder();
        foreach (var c in s ?? "")
        {
            if (c == '"' || c == '\\') sb.Append('\\').Append(c);
            else if (c == '\n') sb.Append("\\n");
            else if (c == '\r') sb.Append("\\r");
            else if (c == '\t') sb.Append("\\t");
            else if (c < 0x20 || c > 0x7e) sb.Append("\\u").Append(((int)c).ToString("x4"));
            else sb.Append(c);
        }
        return sb.ToString();
    }

    /* Varsayılan çıkış aygıtındaki ses oturumları. Ham süreç listesi yerine
       bunu veriyoruz: kullanıcı "şu an ses çıkaran uygulamalar" görmeli,
       yüzlerce arka plan süreci değil. */
    static int ListSessions()
    {
        var rows = new List<string>();
        var seen = new HashSet<uint>();
        try
        {
            var enumerator = (IMMDeviceEnumerator)new MMDeviceEnumerator();
            // eRender = 0, eConsole = 0
            if (enumerator.GetDefaultAudioEndpoint(0, 0, out IMMDevice dev) != 0 || dev == null)
            {
                Console.Out.WriteLine("[]");
                return 0;
            }
            var iid = typeof(IAudioSessionManager2).GUID;
            if (dev.Activate(ref iid, 1 /* CLSCTX_INPROC_SERVER */, IntPtr.Zero, out object mgrObj) != 0)
            {
                Console.Out.WriteLine("[]");
                return 0;
            }
            var mgr = (IAudioSessionManager2)mgrObj;
            if (mgr.GetSessionEnumerator(out IAudioSessionEnumerator sessions) != 0)
            {
                Console.Out.WriteLine("[]");
                return 0;
            }
            sessions.GetCount(out int count);
            for (int i = 0; i < count; i++)
            {
                if (sessions.GetSession(i, out IAudioSessionControl ctrl) != 0 || ctrl == null) continue;
                if (ctrl is not IAudioSessionControl2 c2) continue;
                if (c2.GetProcessId(out uint pid) != 0 || pid == 0) continue;
                if (c2.IsSystemSoundsSession() == 0) continue; // S_OK => sistem sesleri, atla
                if (!seen.Add(pid)) continue;

                // AudioSessionStateActive = 1
                int state = 0;
                c2.GetState(out state);
                string exe = "";
                string label = "";
                string procName = "";
                try
                {
                    using var proc = Process.GetProcessById((int)pid);
                    procName = proc.ProcessName;
                    exe = procName + ".exe";
                    label = proc.MainWindowTitle;
                }
                catch { /* süreç kapanmış olabilir */ }
                if (string.IsNullOrEmpty(exe)) continue;

                /* Sesi çıkaran süreç genelde pencereSİZ bir alt süreç oluyor
                   (tarayıcılarda ses hizmeti gibi), o yüzden başlığı boş
                   geliyor. Aynı addan pencereli bir kardeş varsa onun
                   başlığını kullan — kullanıcı listede "msedge.exe" değil
                   çalan sekmenin adını görmeli. */
                if (string.IsNullOrEmpty(label) && !string.IsNullOrEmpty(procName))
                {
                    try
                    {
                        foreach (var sib in Process.GetProcessesByName(procName))
                        {
                            using (sib)
                            {
                                if (!string.IsNullOrEmpty(sib.MainWindowTitle))
                                {
                                    label = sib.MainWindowTitle;
                                    break;
                                }
                            }
                        }
                    }
                    catch { }
                }
                if (string.IsNullOrEmpty(label))
                {
                    try { c2.GetDisplayName(out label); } catch { label = ""; }
                }
                if (string.IsNullOrEmpty(label)) label = exe;

                rows.Add("{\"pid\":" + pid
                    + ",\"name\":\"" + JsonEscape(exe) + "\""
                    + ",\"label\":\"" + JsonEscape(label) + "\""
                    + ",\"audible\":" + (state == 1 ? "true" : "false") + "}");
            }
        }
        catch (Exception e)
        {
            Err("LIST-FAIL " + e.Message);
            Console.Out.WriteLine("[]");
            return 0;
        }
        Console.Out.WriteLine("[" + string.Join(",", rows) + "]");
        Console.Out.Flush();
        return 0;
    }

    // --------------------------------------------------------------- yakalama

    static int Capture(uint pid, int mode)
    {
        var ap = new ActivationParams
        {
            ActivationType = ACTIVATION_TYPE_PROCESS_LOOPBACK,
            Loopback = new ProcessLoopbackParams { TargetProcessId = pid, ProcessLoopbackMode = mode },
        };
        IntPtr apPtr = Marshal.AllocHGlobal(Marshal.SizeOf<ActivationParams>());
        Marshal.StructureToPtr(ap, apPtr, false);

        var pv = new PropVariantBlob
        {
            vt = VT_BLOB,
            cbSize = (uint)Marshal.SizeOf<ActivationParams>(),
            pBlobData = apPtr,
        };
        IntPtr pvPtr = Marshal.AllocHGlobal(Marshal.SizeOf<PropVariantBlob>());
        Marshal.StructureToPtr(pv, pvPtr, false);

        var iidAudioClient = typeof(IAudioClient).GUID;
        var handler = new Handler();
        IAudioClient client;
        try
        {
            ActivateAudioInterfaceAsync(VAD_PROCESS_LOOPBACK, ref iidAudioClient, pvPtr, handler, out _);
            if (!handler.Done.Wait(5000)) { Err("ACTIVATE-FAIL zaman asimi"); return 1; }
            handler.Op.GetActivateResult(out int hr, out object obj);
            if (hr != 0 || obj == null)
            {
                Err("ACTIVATE-FAIL hr=0x" + hr.ToString("X8"));
                return 1;
            }
            client = (IAudioClient)obj;
        }
        catch (Exception e) { Err("ACTIVATE-FAIL " + e.Message); return 1; }

        var fmt = new WaveFormatEx
        {
            wFormatTag = 3, // WAVE_FORMAT_IEEE_FLOAT
            nChannels = CHANNELS,
            nSamplesPerSec = SAMPLE_RATE,
            wBitsPerSample = 32,
        };
        fmt.nBlockAlign = (ushort)(fmt.nChannels * fmt.wBitsPerSample / 8);
        fmt.nAvgBytesPerSec = fmt.nSamplesPerSec * fmt.nBlockAlign;
        fmt.cbSize = 0;
        IntPtr fmtPtr = Marshal.AllocHGlobal(Marshal.SizeOf<WaveFormatEx>());
        Marshal.StructureToPtr(fmt, fmtPtr, false);

        int hrInit = client.Initialize(AUDCLNT_SHAREMODE_SHARED,
            AUDCLNT_STREAMFLAGS_LOOPBACK | AUDCLNT_STREAMFLAGS_EVENTCALLBACK,
            2000000 /* 200 ms */, 0, fmtPtr, IntPtr.Zero);
        if (hrInit != 0) { Err("INIT-FAIL hr=0x" + hrInit.ToString("X8")); return 1; }

        IntPtr evt = CreateEventW(IntPtr.Zero, false, false, IntPtr.Zero);
        if (client.SetEventHandle(evt) != 0) { Err("EVENT-FAIL"); return 1; }

        var iidCapture = typeof(IAudioCaptureClient).GUID;
        if (client.GetService(ref iidCapture, out object capObj) != 0) { Err("SERVICE-FAIL"); return 1; }
        var capture = (IAudioCaptureClient)capObj;

        if (client.Start() != 0) { Err("START-FAIL"); return 1; }
        Err("APP-CAPTURE-START pid=" + pid + " mode=" + (mode == 0 ? "include" : "exclude")
            + " sr=" + SAMPLE_RATE + " ch=" + CHANNELS);

        var stdout = Console.OpenStandardOutput();
        int blockAlign = fmt.nBlockAlign;
        var silence = new byte[4096 * blockAlign];
        var buffer = new byte[0];

        /* Ana süreç boruyu kapattığında yazma hata verir; o an çıkıyoruz.
           Aksi halde görselleştirici kapansa da yardımcı ayakta kalırdı. */
        try
        {
            while (true)
            {
                WaitForSingleObject(evt, 200);
                while (true)
                {
                    if (capture.GetNextPacketSize(out uint next) != 0 || next == 0) break;
                    if (capture.GetBuffer(out IntPtr data, out uint frames, out uint flags, out _, out _) != 0) break;
                    int bytes = checked((int)(frames * (uint)blockAlign));
                    if (bytes > 0)
                    {
                        if ((flags & AUDCLNT_BUFFERFLAGS_SILENT) != 0 || data == IntPtr.Zero)
                        {
                            // Sessiz paket: sıfır yaz ki akış sürekli kalsın
                            if (silence.Length < bytes) silence = new byte[bytes];
                            stdout.Write(silence, 0, bytes);
                        }
                        else
                        {
                            if (buffer.Length < bytes) buffer = new byte[bytes];
                            Marshal.Copy(data, buffer, 0, bytes);
                            stdout.Write(buffer, 0, bytes);
                        }
                    }
                    capture.ReleaseBuffer(frames);
                }
                stdout.Flush();
            }
        }
        catch (Exception)
        {
            // Boru kapandı ya da yazma başarısız — normal kapanış
        }
        finally
        {
            try { client.Stop(); } catch { }
        }
        return 0;
    }
}
