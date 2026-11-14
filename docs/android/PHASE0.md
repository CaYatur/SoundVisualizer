# Phase 0 report — feasibility on the emulator

Part of the [Android plan](PLAN.md). Phase 0E ran on the emulator only: there was no physical phone. Everything
here answers "does it work", not "how fast is it on a phone". The checks that need a phone are listed at the end
(0P).

How it was measured: `android/tools/probe.js` (one command per question) and `android/tools/suite.js` (all of
them on one virtual device). The unchanged desktop pages run in the app; the probes drive them over the WebView
DevTools socket and read the screen with `adb screencap`.

Emulator: Pixel 7 profile (1080×2400), x86_64, host GPU (RTX 5070 Laptop) through the emulator's GL translator.

## Results (Android 16, API 36, WebView 133)

### Engine and GPU (0E1–0E4)

| Question | Result |
|---|---|
| Does the unchanged visualizer page run? | Yes. `android-host.js` provides all 47 methods of the desktop `window.api` (contract test). |
| WebGL2 | Yes. highp in fragment shaders, float colour buffers (`EXT_color_buffer_float`, half float), `OES_texture_float_linear`, RGB10_A2 framebuffers (MilkDrop's feedback format). No `KHR_parallel_shader_compile`: shaders compile without the background path, as on drivers without it on the desktop. |
| **WebGL context limit** | **8 active contexts per page** (desktop Chrome: 16). The 9th makes the oldest one lost. |
| Contexts per built-in template | At most **2** active. Single templates are far from the limit; the risk is multi-layer user scenes plus transitions (see decisions). |
| 83 built-in templates | **81 pass** (no errors, not black). *Experimental* is black, and it is black on the desktop too: a separate desktop issue, not Android. *Strobe Wall* only tripped over a `/favicon.ico` request, now answered locally. |
| Frame rate on the emulator | Median 61 fps; slowest *Drum & Bass* 24 fps, *Centre Strip* and *Wave Card* 37. The emulator's GPU is the PC's, so these numbers say nothing about phones. |

### Audio (0E5)

Measured against `android/tonegen`, a test-only app that plays 110 Hz (left) and 3500 Hz (right).

| Source | Result |
|---|---|
| Playback capture, app allows capture | 92 frames/s (desktop 93.75), no gaps. Peaks at the right bins: 232 and 223 of 255, background 0. |
| Playback capture, app blocks capture (`ALLOW_CAPTURE_BY_NONE`) | Frames keep coming, but silent (level 0). The app cannot tell "blocked" from "nothing is playing" by itself, so the UI must offer a fallback after silence. |
| Visualizer (output mix) while the app blocks capture | **The tone is heard.** 19 frames/s (the API's ceiling is 20). Quality is low: 8-bit snapshots spread the energy (mid-band 101 while the tone plays). Silence reads 0. |
| Microphone | 93 frames/s, no gaps. Content not verifiable: the emulator's microphone gets no sound. |

### Export (0E6)

| Question | Result |
|---|---|
| WebCodecs encoders in the WebView | **No H.264 at all** (hardware or software); only VP9 in software. AAC and Opus audio encoders exist. |
| Chosen path | The export page's I420 frames cross the binary channel to the app; **MediaCodec** encodes H.264 and **MediaMuxer** writes the MP4. AAC songs are copied without re-encoding. |
| Fireworks, 1280×720, 30 fps, 10 s | 300 frames sent, acknowledged and decoded by ffmpeg. H.264 + AAC 48 kHz stereo. 0.9× real time. 415 MB crossed the channel (about 37 MB/s); encoding took 1.2 s in total, so rendering and the read-back are the cost, not the encoder. |
| MilkDrop Flow, 5 s | 150 frames, 1.12× real time, not black. |

### Floating window and PiP (0E7)

| Question | Result |
|---|---|
| Moving the one engine into a floating window | Same engine, keeps drawing at 61 fps and receiving audio; **0 WebGL contexts lost**. |
| The Activity destroyed while floating | The engine survives and keeps drawing. Reopening the app shows the same engine without rebuilding the scene. |
| Touch pass-through opacity cap (Android 12+) | 0.8, read from the system. |
| System PiP | Enters, pinned, 61 fps, 0 contexts lost. |

## Other Android versions

The Google APIs emulator images ship the WebView of their release date and cannot update it without Google Play. The
app checks three WebView features (`WEB_MESSAGE_LISTENER`, `WEB_MESSAGE_ARRAY_BUFFER`, `DOCUMENT_START_SCRIPT`)
and shows an update screen instead of starting when one is missing; this path worked on every old image.

| Android | API | Image WebView | Result |
|---|---|---|---|
| 10 | 29 | 74 | All three features missing: update screen. |
| 12 (the test phone's version) | 31 | 91 | `WEB_MESSAGE_ARRAY_BUFFER` and `DOCUMENT_START_SCRIPT` missing: update screen. |
| 14 | 34 | 113 | `WEB_MESSAGE_ARRAY_BUFFER` missing: update screen. |
| 16 | 36 | 133 | All results in this report. |
| 17 | 37 | 145 | Not measured: the image never left the "device is still booting" state for the package manager (installs and activity starts were refused). An emulator image problem, not the app; to retry with the 16 KB page-size image. |

So the app needs a WebView newer than 113 (`WEB_MESSAGE_ARRAY_BUFFER` is absent in 113 and present in 133). On phones with
Google Play the WebView updates itself, so this mostly affects devices without Play services. Android 12 and 14
behaviour (consent dialogs, foreground-service rules, touch occlusion) still needs a modern WebView to test: the
Google Play images update it after a Google sign-in on the emulator, or the physical phone.

## What this changes in the plan

| Plan item | Change |
|---|---|
| D5 (export) | WebCodecs is not the encoder. The app encodes with MediaCodec; the page only renders and reads back. WebCodecs H.264 can be revisited on phones as an optimisation (it would save the read-back), not as a requirement. |
| R1 (WebGL context limit) | Measured: 8 per page. Templates use at most 2. Phase 2 adds a context budget: the host counts active contexts, and the editor warns before a scene would exceed the limit (transitions briefly hold two scenes). A shared context for GL layers stays a later option. |
| R3 (apps block capture) | Confirmed: blocked audio arrives as digital silence. The Visualizer fallback hears it on the emulator. Phase 2: after ~3 s of silence while capturing, offer "this app does not share its audio: switch to Visualizer or the microphone?". |
| R4 (old WebView) | Confirmed on three images (WebView 74, 91, 113). Minimum: a WebView with `WEB_MESSAGE_ARRAY_BUFFER` (after 113). No slower fallback for now; if phone data shows many such devices, a string fallback for audio only is the cheap option (export frames are too large for it). The update screen gets the design language in phase 3. |
| D2/D3 (one engine, floating window) | Confirmed. The engine belongs to the app (`EngineHost`), not to the Activity. |

## Still open: needs a physical phone (0P)

1. Frame rate, heat and battery on the phone's GPU (Redmi Note 9 Pro: likely Adreno 618) for the 83 templates and for MilkDrop presets; default render scale for 2400×1080.
2. The WebGL context limit and extension list on the phone's driver.
3. MediaCodec speed with the hardware encoder, and the channel's throughput on phone memory (37 MB/s on the emulator).
4. Visualizer on a real device: does it still hear apps that block capture, and how does it sound?
5. Real apps' capture policy (Spotify, YouTube Music, YouTube, browsers).
6. Microphone content.
7. Vendor (MIUI) behaviour: the extra "display pop-up windows" permission, battery saver killing the audio service, Activity destruction in the background.
8. WebCodecs H.264 availability on the phone (optional optimisation for export).
