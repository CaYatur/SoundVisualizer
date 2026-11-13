# Android ↔ page messages

Status: draft (phase A). Fields marked *0E* are settled by the phase 0E measurements. Part of the [Android plan](PLAN.md);
the methods that use this channel are listed in [HOST.md](HOST.md).

## Transport

- Kotlin registers one listener with `WebViewCompat.addWebMessageListener` under the name `SVNative`, allowed only for
  the app's own origin `https://appassets.androidplatform.net`. Pages from any other origin (for example a web layer)
  never see `SVNative`.
- The app requires the WebView features `WEB_MESSAGE_LISTENER` and `WEB_MESSAGE_ARRAY_BUFFER`. Without them it shows
  "Update Android System WebView" instead of starting; there is no slower fallback path to maintain.
- Page → Kotlin: `SVNative.postMessage(string | ArrayBuffer)`.
- Kotlin → page: the reply proxy of the page's first message. Every page therefore starts with `hello`. The page
  receives with `SVNative.onmessage` (`event.data` is a string or an `ArrayBuffer`).
- Text messages are JSON and carry control. Binary messages carry bulk data (audio, encoded video).

## Reading files

The page reads app files over HTTP from the same origin, not over the channel: the shell adds a WebViewAssetLoader
path handler at `/files/` that serves the app's own storage read-only. Paths outside it are refused (no `..`, no
symbolic links). `fetch`, `<img>` and `<video>` stream these files directly.

## Text messages

```
hello     page → app   {"t":"hello","v":1,"page":"main"|"export"}
          app → page   {"t":"hello","v":1,"app":"1.0.0","sdk":36,"webview":"<version>"}
request   page → app   {"t":"req","id":7,"op":"presetsSave","a":{...}}
response  app → page   {"t":"res","id":7,"ok":true,"v":...}
                       {"t":"res","id":7,"ok":false,"err":"<code>","msg":"<text>"}
event     app → page   {"t":"evt","ev":"powerSource","v":{"onBattery":true}}
```

- `id` is chosen by the page and unique among its open requests.
- `op` and `ev` names follow [HOST.md](HOST.md).
- Unknown `op`: response with `err: "unknown-op"`. Unknown `ev`: ignored.

## Binary messages

Little-endian. Every binary message starts with a 16-byte header:

| Offset | Size | Field |
|---|---|---|
| 0 | 2 | Magic `0x53 0x56` ("SV") |
| 2 | 1 | Format version, `1` |
| 3 | 1 | Type |
| 4 | 4 | Sequence number, `uint32`, counted per type; wraps. A gap means lost data. |
| 8 | 8 | Timestamp, `float64` milliseconds on the sender's monotonic clock |

A message with a wrong magic, an unknown version or a length shorter than its type needs is dropped and counted.

### `0x01` PCM (app → page)

| Offset | Size | Field |
|---|---|---|
| 16 | 4 | Sample rate, `uint32` |
| 20 | 1 | Channels: `1` or `2` |
| 21 | 1 | Sample format: `1` = int16, `2` = float32 |
| 22 | 1 | Source: `1` in-app player, `2` playback capture, `3` microphone |
| 23 | 1 | Reserved, `0` |
| 24 | … | Interleaved samples |

The page keeps the same 2048-sample rings as the desktop helper and builds the desktop audio frame
(`src/main/audio-frame.js`) with the shared FFT. Block size *0E* (the desktop helper uses 512 frames).

### `0x02` WAVE (app → page)

The Visualizer fallback delivers short 8-bit waveform snapshots, not continuous audio.

| Offset | Size | Field |
|---|---|---|
| 16 | 4 | Sample rate in Hz, `uint32` |
| 20 | 2 | Snapshot length, `uint16` |
| 22 | 2 | Reserved, `0` |
| 24 | … | Waveform bytes, 128-centred: the same encoding as the desktop frame's time bytes |

### `0x10` VIDEO-CHUNK (page → app)

| Offset | Size | Field |
|---|---|---|
| 16 | 4 | Export job id, `uint32` |
| 20 | 1 | Flags: bit 0 = key frame |
| 21 | 3 | Reserved, `0` |
| 24 | 8 | Presentation time in microseconds, `int64` |
| 32 | 4 | Duration in microseconds, `uint32` |
| 36 | … | Encoded bytes (bit-stream format *0E*: Annex B or length-prefixed) |

### `0x11` VIDEO-CONFIG (page → app)

| Offset | Size | Field |
|---|---|---|
| 16 | 4 | Export job id, `uint32` |
| 20 | 2 | Codec string length in bytes, `uint16` |
| 22 | n | Codec string, UTF-8 (for example `avc1.640028`) |
| 22+n | … | Decoder configuration (`description`), may be empty |

Sent once before the first chunk and again if the encoder reports a new configuration.

## Where the constants live

- Page: `src/mobile/messages.js`.
- App: `android/app/src/main/java/com/cayadev/visualizer/bridge/Messages.kt`.

**Cross test:** the committed sample `android/js-tests/fixtures/pcm-s16.bin` must match what JavaScript writes (`android/js-tests/audio-input.test.js`), and a Kotlin unit test (`MessagesTest.fixtureFromJs`)
decodes the same files. A change on only one side fails one of the two tests.
