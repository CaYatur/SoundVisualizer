# Android host contract

Status: draft (phase A). Part of the [Android plan](PLAN.md).

The engine (`src/visualizer`, `src/shared`) talks to the outside world through a few globals. On the desktop the
preload scripts provide them; in a browser (`src/web/web-shim.js`) a WebSocket does. On Android, `src/mobile/android-host.js`
provides them, backed by the Kotlin shell over the channel described in [MESSAGES.md](MESSAGES.md).

The page that hosts the engine on Android is also the editor (see D2 in the plan). Calls that cross windows on the
desktop (panel → main process → output window) become local calls inside one page.

## Rules

- **The desktop preload is the reference.** The engine surface is exactly the `api` object in
  `src/main/preload-visualizer.js`; the export surface is the `exp` object in `src/main/preload-exporter.js`.
- **Every method exists.** A method that has no meaning on Android is still defined and behaves as described below
  (returns an empty value, never fires). The engine never has to test `typeof api.x === 'function'` because of
  Android.
- **Contract test:** every key of the desktop `api` and `exp` objects must be defined in `android-host.js` with the
  status this page gives it. A new key on the desktop fails the test until this page and the host are updated.
- `on*` methods register a listener and never throw. Methods that return data return a Promise.

## Globals

| Global | Android value |
|---|---|
| `SV_PLATFORM` | `{ os: 'android', isWindows: false, isMac: false, isLinux: false, isAndroid: true }` |
| `SV_DISPLAY_ID` | `null`. Projection mapping is per display and not part of the Android app. |
| `SV_SHARED_EPOCH` | `null`. The shared session clock belongs to redundancy (desktop only). |
| `SV_FLOATING` | `false`. The floating window on Android is the same page, not a second one (D2/D3). |

## Engine surface (`window.api`)

Status: **Real** (implemented, phase in brackets) · **Local** (answered inside the page, no native call) ·
**Empty** (defined, returns an empty value or never fires; reason given).

| Method | Status | Notes |
|---|---|---|
| `requestConfig` | Real (0E) | Current configuration. In 0E a fixed test configuration. |
| `onConfig` | Real (0E) | Full configuration after a load or a large change. |
| `onConfigPatch` | Local (3) | The editor sends only the changed top-level keys while a slider moves, as on the desktop. |
| `onShowClock` | Local (5) | Timeline show-clock anchor. |
| `onMomentaryFx` | Empty | Momentary effects are a VJ tool that is not on Android (D6). |
| `onMediaScrub` | Local (5) | Scrubbing a media layer from the timeline. |
| `onTbar` | Empty | No T-bar on Android (D6). |
| `onSharedClock` | Empty | Redundancy session clock, desktop only. |
| `getSharedClock` | Empty | Resolves `null`. |
| `onLyricsClock` | Local (4) | Clock of manually loaded lyrics. |
| `onNowPlaying` | Real (2) | The in-app player's track. Other apps' tracks would need notification access; not planned. |
| `nowPlayingCurrent` | Real (2) | Same source as `onNowPlaying`. |
| `onNativeAudio` | Real (0E) | Audio frames in the desktop layout (`src/main/audio-frame.js`), built in the page from PCM. |
| `sendAudioMeter` | Local (2) | Level meter for the audio-source screen. |
| `sendOscHit` | Empty | No OSC on Android. |
| `sendMessage` | Local (2) | Engine → editor messages. |
| `claimCamRelay` | Empty | Relays camera frames to stream clients on the desktop. Resolves `false`; the camera layer still works locally. |
| `releaseCamRelay` | Empty | |
| `sendCamFrame` | Empty | |
| `sendCamStatus` | Empty | |
| `screenSources` | Empty | Resolves `[]`. Screen capture as a layer is not planned. |
| `getPresets` | Real (2) | Studio presets from app storage. |
| `milkdropPresetSource` | Real (2) | Source text of a MilkDrop preset. |
| `getPowerSource` | Real (2) | `{ onBattery }` from Android's battery state, for the low-power mode. |
| `onPowerSource` | Real (2) | |
| `onPresets` | Real (2) | |
| `onPresetsDelta` | Real (2) | |
| `presetsHead` | Real (2) | |
| `presetsSince` | Real (2) | |
| `milkdropTextures` | Real (4) | Texture pack listing. |
| `milkdropTexture` | Real (4) | One texture, by name. |
| `onMilkdropTexturesChanged` | Real (4) | |
| `logoLibRead` | Real (4) | |
| `lyricsLibSnapshot` | Real (4) | |
| `lyricsLibRead` | Real (4) | |
| `onLyricsLib` | Real (4) | |
| `floatingClose` | Real (3) | Closes the floating window or leaves PiP. |
| `floatingSnap` | Real (3) | Snaps the floating window to an edge or corner. |
| `floatingSize` | Real (3) | Size presets of the floating window. |
| `onWindowChrome` | Real (3) | Full-screen and floating state for the page chrome. |
| `onExitHint` | Local (3) | "Tap to return" hint after entering full screen. |
| `setGeometryLock` | Real (3) | Locks the floating window's position. |
| `getGeometryLock` | Real (3) | |
| `onMdFollow` | Empty | MilkDrop follow mode belongs to redundancy (#585). |
| `onMdSprite` | Real (4) | MilkDrop sprite commands. |
| `milkdropSpriteImage` | Real (4) | |
| `milkdropSprite` | Real (4) | |

## Export surface (`window.exp` in the export WebView)

The export page is `src/exporter/index.html`, unchanged. The host takes the place of the main process and ffmpeg.

| Method | Notes |
|---|---|
| `onJob` | The job: scene, length, resolution, fps, codec, audio file. |
| `ready` | Total frame count; the host opens the encoder and the muxer. |
| `sendFrame(data, index)` | An I420 frame (the exporter's GPU read-out). The host wraps it in a WebCodecs `VideoFrame`, encodes it and sends the chunk to MediaMuxer. Resolves when the encoder accepts more input (back-pressure). |
| `progress` | Progress for the export screen and its notification. |
| `finish` | Flushes the encoder, adds the audio track, closes the MP4 and saves it to the gallery. |
| `cancelled` / `error` | Deletes the partial file and reports. |
| `analysis` | Offline analysis results, used as on the desktop. |
| `cancelRequested` | Resolves `true` after the user taps Cancel. |

The export page also uses `window.api.milkdropTextures` and `window.api.milkdropTexture` (same as above).

## Shell surface

Available since phase 0E (requests over the channel in [MESSAGES.md](MESSAGES.md)):

| Request / event | Notes |
|---|---|
| `audioStart { source }` | `capture` (other apps' audio, Android 10+; system consent dialog every session), `mic` or `visualizer` (the output-mix fallback). Asks for the microphone permission first; resolves `{ source }` or fails with `permission-denied`, `consent-denied` or `bad-source`. |
| `audioStop` | Stops the audio service. |
| `audioStats` | `{ delivered, dropped }` binary messages on the app side. |
| event `audioStatus` | `{ source, state }` with `running`, `stopped` or `error:<reason>`. |
| `exportBegin { width, height, fps, bitrate?, audio?, name? }` | Opens the H.264 encoder and the MP4 file; `audio` is a file in the app's media folder (AAC is copied without re-encoding). Resolves `{ job, codec, path }`. |
| `exportEnd` | Flushes, adds the audio track, closes the MP4. Resolves `{ path, bytes, frames, encodeMs, totalMs }`. |
| `exportCancel` | Drops the job and deletes the partial file. |
| events `exportAck` / `exportError` | `{ job, index }` per frame; see VIDEO-FRAME in MESSAGES.md. |
| `floatingOpen { width?, height?, opacity?, clickThrough? }` | Moves the one engine into a free-size floating window over other apps and sends the app to the back. Needs "display over other apps"; without it, opens that setting and fails with `overlay-permission`. |
| `floatingSet { opacity?, clickThrough?, locked? }` | Same settings as the desktop floating window. With pass-through on, opacity is capped at the system limit (`maxPassThroughOpacity`, 0.8 on Android 12+). |
| `floatingClose` | Closes the window and brings the app back; the same engine returns to full screen. |
| `floatingState` | `{ showing, opacity, clickThrough, locked, maxPassThroughOpacity, bounds, activity }`. |
| `pipEnter { w, h }` | System picture-in-picture with aspect `w:h`, clamped to 1:2.39…2.39:1. |
| event `windowChrome` | `{ pip }` when picture-in-picture starts or ends. |

The engine (the one WebView) belongs to the app, not to the screen (`EngineHost`): it is built on the application
context and moved between the full-screen Activity and the floating window. If the system destroys the Activity while
the floating window is up, the engine keeps drawing; reopening the app shows the same engine without rebuilding the scene.


The editor's calls (settings, presets, import, export queue, audio source, floating window…) are defined in phases
2 and 3. They follow the same rules. Where a desktop IPC channel exists, the method keeps its name (`presets:save` →
`presetsSave`), so the two hosts stay easy to compare.
