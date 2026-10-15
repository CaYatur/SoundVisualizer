/*
 * SoundVisualizer — CaYaDev Ses Görselleştirici
 * Copyright (c) 2026 Çağan Turgut (CaYatur) — CaYaDev, https://cayadev.com
 * https://github.com/CaYatur/SoundVisualizer
 * SPDX-License-Identifier: MIT
 */
// Uygulama başına ses yakalama — macOS yardımcısı (ScreenCaptureKit).
//
// !!! GERÇEK DONANIMDA DOĞRULANMADI !!!
// Bu dosya Windows'ta yazıldı ve yalnızca CI'daki macOS koşucusunda
// derlendiği biliniyor. Hiçbir Mac'te çalıştırılıp ses yakaladığı
// ölçülmedi. Aşağıdaki davranış Apple'ın belgelerine göre beklenen
// davranıştır; ölçülmüş değildir. İlk gerçek denemede bakılacaklar en
// altta (DOĞRULANACAKLAR).
//
// NEDEN AYRI BİR SÜREÇ: ScreenCaptureKit bir Objective-C/Swift çerçevesi ve
// Node'dan çağrılamıyor. Windows yardımcısıyla (native/app-audio-helper) aynı
// desen ve AYNI sözleşme, böylece ana süreç farkı görmüyor:
//
//   app-audio-helper --list
//       Uygulamaları JSON olarak yazar: [{pid, name, label, audible}]
//       name = paket kimliği (com.spotify.client) — kararlı, eşleşme buna göre.
//       İzin yoksa "[]" yazar ve stderr'e PERMISSION-DENIED; izin PENCERESİ AÇMAZ.
//   app-audio-helper --capture <pid> [include|exclude]
//       48 kHz stereo float32 (küçük endian, araya serpiştirilmiş) ham PCM'i
//       stdout'a akıtır. Durum satırları stderr'e.
//   app-audio-helper --check
//       {"permission": true|false} — CGPreflightScreenCaptureAccess, pencere açmaz.
//   app-audio-helper --request
//       İzin penceresini açar (yalnızca ilk seferde görünür) ve sonucu yazar.
//
// İZİN: ScreenCaptureKit yalnızca ses için bile Ekran Kaydı izni istiyor.
// İzin, yardımcıyı başlatan uygulamaya (CAYADEV Visualizer.app — macOS'un
// "sorumlu süreç" kuralı) veriliyor. Uygulama imzasız (ad-hoc) dağıtıldığı
// için her güncellemede imza değişir ve macOS izni yeniden isteyebilir.
//
// Çıkış kodları: 0 normal, 1 hata, 2 hatalı argüman, 3 izin yok, 4 hedef yok.

import Foundation
import ScreenCaptureKit
import CoreMedia
import CoreGraphics
import CoreAudio
import AudioToolbox

let SAMPLE_RATE = 48000
let CHANNELS = 2

// MARK: - çıktı

func err(_ s: String) {
    if let d = (s + "\n").data(using: .utf8) {
        FileHandle.standardError.write(d)
    }
}

/* stdout'a hepsini yaz. Ana süreç boruyu kapatınca write hata verir; o an
   çıkıyoruz, yoksa görselleştirici kapansa da yardımcı ayakta kalırdı.
   SIGPIPE main'de yok sayılıyor ki süreç sinyalle değil burada bitsin. */
func writeAll(_ ptr: UnsafeRawPointer, _ count: Int) {
    var off = 0
    while off < count {
        let n = Darwin.write(1, ptr + off, count - off)
        if n < 0 {
            if errno == EINTR { continue }
            exit(0)
        }
        off += n
    }
}

func jsonEscape(_ s: String) -> String {
    var out = ""
    for u in s.unicodeScalars {
        switch u {
        case "\"": out += "\\\""
        case "\\": out += "\\\\"
        case "\n": out += "\\n"
        case "\r": out += "\\r"
        case "\t": out += "\\t"
        default:
            if u.value < 0x20 || u.value > 0x7e {
                // UTF-16 kod birimleri olarak kaçır (BMP dışı için vekil çift)
                for cu in String(u).utf16 { out += String(format: "\\u%04x", cu) }
            } else {
                out.unicodeScalars.append(u)
            }
        }
    }
    return out
}

func isPermissionError(_ error: Error) -> Bool {
    let ns = error as NSError
    // SCStreamError.userDeclined = -3801
    return ns.domain == SCStreamErrorDomain && ns.code == SCStreamError.Code.userDeclined.rawValue
}

// MARK: - hangi süreç ses çıkarıyor (macOS 14.2+)

/* ScreenCaptureKit hangi uygulamanın o an ses çıkardığını söylemiyor. macOS
   14.2 ile Core Audio süreç nesneleri geldi; orada "çıkış yapıyor mu" var.
   Daha eski sürümde nil döner ve liste sesli/sessiz ayırmadan gelir.
   Tarayıcılar sesi ayrı bir yardımcı süreçten çalabilir; o zaman uygulamanın
   kendisi sesli görünmez — bu yalnızca sıralama ipucu. */
func audiblePids() -> Set<pid_t>? {
    if #available(macOS 14.2, *) {
        var addr = AudioObjectPropertyAddress(
            mSelector: kAudioHardwarePropertyProcessObjectList,
            mScope: kAudioObjectPropertyScopeGlobal,
            mElement: kAudioObjectPropertyElementMain)
        let system = AudioObjectID(kAudioObjectSystemObject)
        var size: UInt32 = 0
        guard AudioObjectGetPropertyDataSize(system, &addr, 0, nil, &size) == noErr, size > 0 else {
            return nil
        }
        let count = Int(size) / MemoryLayout<AudioObjectID>.size
        var ids = [AudioObjectID](repeating: 0, count: count)
        guard AudioObjectGetPropertyData(system, &addr, 0, nil, &size, &ids) == noErr else { return nil }
        var out = Set<pid_t>()
        for id in ids {
            var pidAddr = AudioObjectPropertyAddress(
                mSelector: kAudioProcessPropertyPID,
                mScope: kAudioObjectPropertyScopeGlobal,
                mElement: kAudioObjectPropertyElementMain)
            var pid: pid_t = -1
            var pidSize = UInt32(MemoryLayout<pid_t>.size)
            guard AudioObjectGetPropertyData(id, &pidAddr, 0, nil, &pidSize, &pid) == noErr else { continue }
            var runAddr = AudioObjectPropertyAddress(
                mSelector: kAudioProcessPropertyIsRunningOutput,
                mScope: kAudioObjectPropertyScopeGlobal,
                mElement: kAudioObjectPropertyElementMain)
            var running: UInt32 = 0
            var runSize = UInt32(MemoryLayout<UInt32>.size)
            if AudioObjectGetPropertyData(id, &runAddr, 0, nil, &runSize, &running) == noErr, running != 0 {
                out.insert(pid)
            }
        }
        return out
    }
    return nil
}

// MARK: - listeleme

func listApps() async -> Int32 {
    /* İzin yokken SCShareableContent'i çağırmıyoruz: çağrı sistemin izin
       penceresini açar ve bu liste her açılışta isteniyor. İzin yalnızca
       kullanıcı düğmeye basınca (--request) sorulmalı. */
    guard CGPreflightScreenCaptureAccess() else {
        err("PERMISSION-DENIED ekran kaydi izni yok")
        print("[]")
        return 0
    }
    let content: SCShareableContent
    do {
        content = try await SCShareableContent.excludingDesktopWindows(false, onScreenWindowsOnly: false)
    } catch {
        err((isPermissionError(error) ? "PERMISSION-DENIED " : "LIST-FAIL ") + error.localizedDescription)
        print("[]")
        return 0
    }
    let audible = audiblePids()
    let me = getpid()
    var seen = Set<pid_t>()
    var rows: [String] = []
    for app in content.applications {
        let pid = app.processID
        if pid <= 0 || pid == me || !seen.insert(pid).inserted { continue }
        let bundle = app.bundleIdentifier
        let label = app.applicationName
        if bundle.isEmpty && label.isEmpty { continue }
        let name = bundle.isEmpty ? label : bundle
        let isAudible = audible?.contains(pid) ?? false
        rows.append("{\"pid\":\(pid),\"name\":\"\(jsonEscape(name))\",\"label\":\"\(jsonEscape(label.isEmpty ? name : label))\",\"audible\":\(isAudible ? "true" : "false")}")
    }
    print("[" + rows.joined(separator: ",") + "]")
    return 0
}

// MARK: - yakalama

final class Capture: NSObject, SCStreamOutput, SCStreamDelegate {
    let audioQueue = DispatchQueue(label: "com.cayadev.appaudio.audio")
    let videoQueue = DispatchQueue(label: "com.cayadev.appaudio.video")
    private var interleaved = [Float]()
    private var lastWrite = DispatchTime.now()
    private var timer: DispatchSourceTimer?
    private var formatWarned = false
    var onStop: ((String) -> Void)?
    var watch: DispatchSourceTimer?

    /* Ses gelmezken sıfır yaz. ScreenCaptureKit'in sessizlikte tampon
       gönderip göndermediği doğrulanmadı; göndermiyorsa görselleştiricinin
       halkası son pencerede donar ve tayf hareketsiz kalırdı. Yazmalar ses
       kuyruğunda — aynı seri kuyruk, tamponlarla karışmasın. */
    func startSilenceClock() {
        let t = DispatchSource.makeTimerSource(queue: audioQueue)
        t.schedule(deadline: .now() + .milliseconds(50), repeating: .milliseconds(50))
        t.setEventHandler { [weak self] in
            guard let self = self else { return }
            let idleNs = DispatchTime.now().uptimeNanoseconds - self.lastWrite.uptimeNanoseconds
            if idleNs > 100_000_000 {
                let frames = SAMPLE_RATE / 20 // 50 ms
                let zeros = [Float](repeating: 0, count: frames * CHANNELS)
                zeros.withUnsafeBytes { writeAll($0.baseAddress!, $0.count) }
                self.lastWrite = DispatchTime.now()
            }
        }
        t.resume()
        timer = t
    }

    func stream(_ stream: SCStream, didOutputSampleBuffer sampleBuffer: CMSampleBuffer, of type: SCStreamOutputType) {
        // Görüntü yalnızca ScreenCaptureKit bir görüntü filtresi istediği için var; atılıyor
        guard type == .audio, CMSampleBufferIsValid(sampleBuffer) else { return }
        writePCM(sampleBuffer)
    }

    func stream(_ stream: SCStream, didStopWithError error: Error) {
        onStop?((isPermissionError(error) ? "PERMISSION-DENIED " : "STREAM-STOPPED ") + error.localizedDescription)
    }

    /* Ses tamponu genelde "planar" float32 geliyor (her kanal ayrı tampon).
       Biçim varsayılmıyor: tarif (ASBD) okunup ona göre L/R araya
       serpiştiriliyor. Beklenmeyen bir biçimde bir kez uyarıp atlıyoruz. */
    private func writePCM(_ sb: CMSampleBuffer) {
        guard let fmt = CMSampleBufferGetFormatDescription(sb),
              let asbdPtr = CMAudioFormatDescriptionGetStreamBasicDescription(fmt) else { return }
        let asbd = asbdPtr.pointee
        let isFloat = (asbd.mFormatFlags & kAudioFormatFlagIsFloat) != 0
        guard asbd.mFormatID == kAudioFormatLinearPCM, isFloat, asbd.mBitsPerChannel == 32 else {
            if !formatWarned {
                formatWarned = true
                err("FORMAT-UNSUPPORTED id=\(asbd.mFormatID) flags=\(asbd.mFormatFlags) bits=\(asbd.mBitsPerChannel)")
            }
            return
        }
        if Int(asbd.mSampleRate) != SAMPLE_RATE && !formatWarned {
            formatWarned = true
            err("RATE-MISMATCH sr=\(asbd.mSampleRate)")
        }
        let frames = CMSampleBufferGetNumSamples(sb)
        if frames <= 0 { return }

        var needed = 0
        var st = CMSampleBufferGetAudioBufferListWithRetainedBlockBuffer(
            sb, bufferListSizeNeededOut: &needed, bufferListOut: nil, bufferListSize: 0,
            blockBufferAllocator: nil, blockBufferMemoryAllocator: nil, flags: 0, blockBufferOut: nil)
        guard needed > 0 else { return }
        let ablMem = UnsafeMutableRawPointer.allocate(byteCount: needed, alignment: 16)
        defer { ablMem.deallocate() }
        let abl = ablMem.bindMemory(to: AudioBufferList.self, capacity: 1)
        var block: CMBlockBuffer?
        st = CMSampleBufferGetAudioBufferListWithRetainedBlockBuffer(
            sb, bufferListSizeNeededOut: nil, bufferListOut: abl, bufferListSize: needed,
            blockBufferAllocator: nil, blockBufferMemoryAllocator: nil,
            flags: kCMSampleBufferFlag_AudioBufferList_Assure16ByteAlignment, blockBufferOut: &block)
        guard st == noErr else { return }

        let buffers = UnsafeMutableAudioBufferListPointer(abl)
        if buffers.count == 0 { return }
        let nonInterleaved = (asbd.mFormatFlags & kAudioFormatFlagIsNonInterleaved) != 0
        let total = frames * CHANNELS
        if interleaved.count < total { interleaved = [Float](repeating: 0, count: total) }

        var n = frames
        if nonInterleaved {
            guard let lData = buffers[0].mData else { return }
            let l = lData.assumingMemoryBound(to: Float.self)
            n = min(n, Int(buffers[0].mDataByteSize) / 4)
            var r = l
            if buffers.count > 1, let rData = buffers[1].mData {
                r = rData.assumingMemoryBound(to: Float.self)
                n = min(n, Int(buffers[1].mDataByteSize) / 4)
            }
            for i in 0..<n {
                interleaved[i * 2] = l[i]
                interleaved[i * 2 + 1] = r[i]
            }
        } else {
            guard let data = buffers[0].mData else { return }
            let ch = max(1, Int(asbd.mChannelsPerFrame))
            let p = data.assumingMemoryBound(to: Float.self)
            n = min(n, Int(buffers[0].mDataByteSize) / 4 / ch)
            for i in 0..<n {
                interleaved[i * 2] = p[i * ch]
                interleaved[i * 2 + 1] = ch > 1 ? p[i * ch + 1] : p[i * ch]
            }
        }
        if n <= 0 { return }
        interleaved.withUnsafeBytes { writeAll($0.baseAddress!, n * CHANNELS * 4) }
        lastWrite = DispatchTime.now()
    }
}

func capture(pid: pid_t, exclude: Bool) async -> Int32 {
    guard CGPreflightScreenCaptureAccess() else {
        err("PERMISSION-DENIED ekran kaydi izni yok")
        return 3
    }
    let content: SCShareableContent
    do {
        content = try await SCShareableContent.excludingDesktopWindows(false, onScreenWindowsOnly: false)
    } catch {
        if isPermissionError(error) { err("PERMISSION-DENIED " + error.localizedDescription); return 3 }
        err("CONTENT-FAIL " + error.localizedDescription)
        return 1
    }
    /* ScreenCaptureKit'te ses filtresi tek başına yok; uygulama süzgeci bir
       ekran filtresine bağlanıyor. Hangi ekran olduğu ses için önemsiz. */
    guard let display = content.displays.first else { err("NO-DISPLAY"); return 1 }
    guard let target = content.applications.first(where: { $0.processID == pid }) else {
        err("NO-TARGET pid=\(pid)")
        return 4
    }

    let filter: SCContentFilter
    if exclude {
        /* Hariç tutmada görselleştiricinin kendi sesi de dışarıda kalsın,
           yoksa çaldığı medya geri beslenirdi. excludesCurrentProcessAudio
           yalnız BU yardımcıyı kapsıyor (ayrı süreç), uygulamayı değil;
           uygulama paket kimliğinden (package.json build.appId) bulunuyor. */
        var excluded = [target]
        let myBundle = Bundle.main.bundleIdentifier ?? ""
        for app in content.applications where app.processID != pid {
            if app.processID == getppid() || (!myBundle.isEmpty && app.bundleIdentifier == myBundle)
                || app.bundleIdentifier == "com.cayadev.visualizer" {
                excluded.append(app)
            }
        }
        filter = SCContentFilter(display: display, excludingApplications: excluded, exceptingWindows: [])
    } else {
        filter = SCContentFilter(display: display, including: [target], exceptingWindows: [])
    }

    let cfg = SCStreamConfiguration()
    // Görüntü istenmiyor ama akış bir görüntü boyutu şart koşuyor: en küçüğü
    cfg.width = 2
    cfg.height = 2
    cfg.minimumFrameInterval = CMTime(value: 1, timescale: 1) // 1 kare/sn
    cfg.queueDepth = 3
    cfg.showsCursor = false
    cfg.capturesAudio = true
    cfg.sampleRate = SAMPLE_RATE
    cfg.channelCount = CHANNELS
    cfg.excludesCurrentProcessAudio = true

    let cap = Capture()
    let stream = SCStream(filter: filter, configuration: cfg, delegate: cap)
    do {
        // Görüntü çıkışı da ekleniyor: eklenmezse çerçeve her kareyi "çıkış yok" diye günlüğe yazıyor
        try stream.addStreamOutput(cap, type: .screen, sampleHandlerQueue: cap.videoQueue)
        try stream.addStreamOutput(cap, type: .audio, sampleHandlerQueue: cap.audioQueue)
        try await stream.startCapture()
    } catch {
        if isPermissionError(error) { err("PERMISSION-DENIED " + error.localizedDescription); return 3 }
        err("START-FAIL " + error.localizedDescription)
        return 1
    }
    err("APP-CAPTURE-START pid=\(pid) mode=\(exclude ? "exclude" : "include") sr=\(SAMPLE_RATE) ch=\(CHANNELS) backend=screencapturekit")
    cap.startSilenceClock()

    /* Hedef uygulama kapanınca çık: ana süreç bunu görüp uygulama yeniden
       açıldığında ada göre yeniden bağlanıyor (Windows yardımcısıyla aynı). */
    let reason: String = await withCheckedContinuation { (cont: CheckedContinuation<String, Never>) in
        var done = false
        let lock = NSLock()
        let finish: (String) -> Void = { why in
            lock.lock(); defer { lock.unlock() }
            if done { return }
            done = true
            cont.resume(returning: why)
        }
        cap.onStop = finish
        let watch = DispatchSource.makeTimerSource(queue: DispatchQueue.global())
        watch.schedule(deadline: .now() + 1, repeating: 1)
        watch.setEventHandler {
            if kill(pid, 0) != 0 && errno == ESRCH { finish("TARGET-EXITED pid=\(pid)") }
        }
        watch.resume()
        cap.watch = watch // kapanana dek saat yaşasın
    }
    err(reason)
    try? await stream.stopCapture()
    return reason.hasPrefix("PERMISSION-DENIED") ? 3 : 0
}

// MARK: - giriş

@main
enum AppAudioHelper {
    static func main() async {
        signal(SIGPIPE, SIG_IGN)
        let args = CommandLine.arguments
        var code: Int32 = 2
        if args.count > 1 && args[1] == "--list" {
            code = await listApps()
        } else if args.count > 1 && args[1] == "--check" {
            print("{\"permission\":\(CGPreflightScreenCaptureAccess() ? "true" : "false")}")
            code = 0
        } else if args.count > 1 && args[1] == "--request" {
            // İlk seferde sistem penceresini açar; sonuç hemen döner (kullanıcı henüz yanıtlamamış olabilir)
            let ok = CGPreflightScreenCaptureAccess() || CGRequestScreenCaptureAccess()
            print("{\"permission\":\(ok ? "true" : "false")}")
            code = 0
        } else if args.count > 2 && args[1] == "--capture" {
            let pid = pid_t(args[2]) ?? 0
            if pid <= 0 {
                err("BAD-ARGS gecersiz surec kimligi")
            } else {
                code = await capture(pid: pid, exclude: args.count > 3 && args[3] == "exclude")
            }
        } else {
            err("BAD-ARGS kullanim: --list | --check | --request | --capture <pid> [include|exclude]")
        }
        exit(code)
    }
}

// DOĞRULANACAKLAR (ilk gerçek Mac denemesinde):
//  1. --check izin yokken false, verildikten sonra true dönüyor mu; izin
//     Electron uygulamasına mı (sorumlu süreç) yoksa yardımcıya mı yazılıyor?
//  2. include: yalnız hedefin sesi geliyor mu (iki ayrı uygulamada iki ton).
//     Tarayıcının ayrı ses süreci hedef uygulamaya sayılıyor mu?
//  3. exclude: hedef dışındaki her şey geliyor, hedef gelmiyor mu?
//  4. Ses tamponu biçimi gerçekten 48 kHz planar float32 mi?
//  5. Sessizlikte ScreenCaptureKit tampon gönderiyor mu (sessizlik saati
//     gereksiz mi)?
//  6. Penceresi olmayan (yalnız menü çubuğunda duran) bir oynatıcı
//     SCShareableContent.applications içinde görünüyor mu?
