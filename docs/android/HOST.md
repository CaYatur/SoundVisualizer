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
| `__SV_ANDROID` | `{ debug, page, version, webview }`, set before every script of our pages. `page` comes from the address, since the one WebView can switch to the export page. |
| `SV_FLOATING` | `false`. The floating window on Android is the same page, not a second one (D2/D3). |

## Engine surface (`window.api`)

Status: **Real** (implemented, phase in brackets) · **Local** (answered inside the page, no native call) ·
**Empty** (defined, returns an empty value or never fires; reason given).

| Method | Status | Notes |
|---|---|---|
| `requestConfig` | Real (2) | The saved configuration from the profile folder (see "Profile" below), or `null` on first start. Desktop-only outputs arrive switched off ("Engine view"). |
| `onConfig` | Real (2) | Full configuration after a load or a large change (`SVAndroid.config.set`). |
| `onConfigPatch` | Local (2) | Only the changed top-level keys while a slider moves, as on the desktop (`SVAndroid.config.patch`). |
| `onShowClock` | Local (5) | Timeline show-clock anchor. The shell's timeline sends it with `SVAndroid.showClock(anchor)` (the desktop panel uses `sendShowClock`). |
| `onMomentaryFx` | Empty | Momentary effects are a VJ tool that is not on Android (D6). |
| `onMediaScrub` | Local (5) | Scrubbing a media layer from the timeline. |
| `onTbar` | Empty | No T-bar on Android (D6). |
| `onOutputSafety` | Empty | Output freeze/mute from the desktop preview mode (#1168); desktop only. |
| `onSharedClock` | Empty | Redundancy session clock, desktop only. |
| `getSharedClock` | Empty | Resolves `null`. |
| `onLyricsClock` | Local (4) | Clock of manually loaded lyrics. |
| `onNowPlaying` | Real (2) | The in-app player's track, in the desktop shape (`src/main/media-session.js`: `has`, `playing`, `title`, `artist`, `album`, `artwork` as a data URL, `position`/`duration` in seconds, `updated`). Other apps' tracks would need notification access; not planned. |
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
| `getPresets` | Real (2) | User presets from `files/profile/presets/<id>.json` (the desktop layout). The list is lean as on the desktop (`preset-lean.js`): MilkDrop presets carry `lazy: true` and `fRating` (read from the source with the desktop pattern, `PresetRating.kt`) instead of the source. Order: last changed first, then id. |
| `milkdropPresetSource` | Real (2) | Source text of a MilkDrop preset (`''` when missing; ids are checked, no paths). |
| `getPowerSource` | Real (2) | `{ onBattery }`: the charger is unplugged (`ACTION_BATTERY_CHANGED`, `EXTRA_PLUGGED`), for the low-power mode. Sent to every new page on `hello`. |
| `onPowerSource` | Real (2) | |
| `onPresets` | Real (2) | |
| `onPresetsDelta` | Real (2) | |
| `presetsHead` | Real (2) | `{ gen }`, the list generation. |
| `presetsSince` | Real (2) | `{ gen, upsert: [], remove: [] }`; `reset: true` when the generation changed (the page asks for the whole list). |
| `milkdropTextures` | Real (2) | `{ dir: '', names }` from the app's texture folder (`files/textures/`), sorted and unique ignoring case as on the desktop (`TextureNames.kt`, rules of `milkdrop-textures.js`). |
| `milkdropTexture` | Real (2) | `{ name, dataUrl }`, at most 8 MB, or `null` (names with paths, drive prefixes or non-image extensions are refused). |
| `onMilkdropTexturesChanged` | Real (2) | After an import brought textures. |
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

## Profile (phase 2)

The configuration lives in the app's private folder (`files/profile/`) in the desktop layout
(`src/main/settings-store.js`): `settings.json` holds the settings, `scenes.json` the saved scenes and
`library.json` the MilkDrop library. Files copied from a desktop profile open unchanged, and files written on the phone
open on the desktop.

- **The app is only storage.** `src/mobile/profile-store.js` decides what goes into which file, with the desktop's
  rules: parse (strip a BOM, convert the old single `audio.source`), merge the parts, migrate to v4
  (`src/shared/migrate-v4.js`), drop stray `layers[].settings.postfx`. A test compares every step with its desktop
  counterpart on the same input.
- **Reading** happens once, on the first `requestConfig`, after the page's own scripts have run (the v4 migration needs
  the layer code). Before migrating, `settings.json` is copied once to `settings.v3-backup.json`, as on the desktop.
  A `settings.json` that does not parse is copied to `settings.broken.json` before anything is written over it. If the
  read itself fails, saving stays off: defaults never overwrite the user's files.
- **Saving** is coalesced as on the desktop: 300 ms after the last change, at most 2 s after the first pending one. A
  part whose object did not change is neither serialised nor sent; only changed files cross the channel. Writes are
  atomic (`AtomicFile`: the new file is written and synced, then renamed).
- **Flush:** a pending save is written at once when the page is hidden, on `pagehide`, and on the app's `flush`
  event (sent from `Activity.onPause`): the system may stop a background app without notice.
- **Renderer crash:** the rebuilt page reads the same files, so it comes back with the last saved configuration
  (measured: `node android/tools/probe.js profile`).

| Request | Notes |
|---|---|
| `storeRead { names }` | `{ name: text or null }`. Only the names in `ProfileNames.kt` are accepted; a path is refused. |
| `storeWrite { files }` | `{ name: text }`, written atomically; `settings.json` last, so an interrupted save leaves the old settings pointing at the old parts. |
| `storeCopy { from, to, overwrite }` | Backup copies (`settings.v3-backup.json` once, `settings.broken.json` every time). |
| event `flush` | Write the pending save now. |
| `presetsList`, `presetsSource { id }`, `presetsHead`, `presetsSince { gen }` | User presets (see the engine table). |
| `importPick`, `importOpen { media }` | Reads a desktop full backup (`.svbackup`) or a `settings.json` from the document picker or the app's media folder. A backup is read once as a stream (the phone's storage is not used for a copy); presets go to a staging folder because the desktop writes `backup.json` last. Resolves `{ kind: 'svbackup', meta, staged, skipped, later }` or `{ kind: 'settings', settings }`. |
| `importCommit { ids }` | Moves the listed staged presets into the store (content must be an object whose `id` matches; a true `builtin` is dropped, as on the desktop). Same id: the backup wins; other presets stay. |
| `importDiscard` | Drops the staging folder. |
| `milkImport` | Android's document picker, several files (`*/*`: `.milk` has no registered type). `.milk` and `.milk2` files are added as user presets with the desktop's rules (`store/MilkImport.kt`): at most 450 KB each, 600 files and 24 MB a time; strict UTF-8 else Latin-1; at least one `name=value` line; the same name and content is a duplicate. Resolves `{ added, duplicates, invalid, skipped, gen, upsert }`; `upsert` holds the lean items for the engine. Rejects `cancelled`. |
| `nowPlayingStatus` | `{ enabled, state }`: whether notification access is granted, and the last media-session state (`media/NowPlaying.kt`). |
| `nowPlayingAccess` | Opens Android's notification access screen for this app (needs the Activity). The app only reads media sessions (track, cover, position), never notifications. |
| `lyricsLibList` / `lyricsLibSnapshot` / `lyricsLibRead` / `lyricsLibUpdate` / `lyricsLibRemove` / `lyricsLibAdd` | Lyrics library (`store/LyricsLibrary.kt`) with the desktop's rules (`src/main/lyrics-library.js`): `lyrics-library/manifest.json` + one file per lyric, `.lrc` / `.srt` / `.txt`, 1 MB, UTF-8 (BOM dropped, NUL rejected), same text is a duplicate; artist and title guessed from LRC tags or "Artist - Title" file names. `lyricsLibAdd` takes `{ name, artist, title, text }` (written by hand). Changes push the event `lyricsLib` `{ items }` (with text) to the engine. |
| `lyricsLibImport` | Android's document picker, several files; resolves `{ added, duplicates, failed }`. Rejects `cancelled`. |
| `updateState` / `updateCheck { manual }` / `updateMode { mode }` / `updateSkip` / `updateTold { version }` / `updateOpen` | New version notice (`update/AppUpdate.kt`, D13). One fixed request to GitHub's release list (`releases?per_page=40`): only `android-v1.2.3` tags count, drafts and prereleases do not, and desktop releases (`v4.0.0`) are ignored. No personal data, cookies or tokens; generic User-Agent. `updateCheck` without `manual` runs only when due (mode `notify`, 24 h after the last good check, 6 h after a failed one); a manual check runs at most every 20 s. State `{ status: idle\|available\|latest\|none\|error, current, latest?, name?, notes? (plain text, ≤1500 chars), url?, apkBytes?, skipped?, error? (offline, timeout, rate, server, too-large, bad-response), mode, checkedAt, checking, told? }` (`told`: the version whose toast was shown, kept by `updateTold` so the toast appears once per version even if the app is killed right after); a failed check keeps the last good result and adds `error`. `updateOpen` opens the release page from the last check in the browser, only when it is on `https://github.com/CaYatur/SoundVisualizer/`; the page never passes an address. The app never installs itself. Event `updateState` when a check ends. |
| `lyricsLookup` / `lyricsCacheClear` | Automatic lyrics (`store/LyricsLookup.kt`, desktop `src/main/lyrics-lookup.js`): cache first, then the user's providers in order with a timeout; no providers means no network request. `{ config, meta }` → `{ text, source, provider? }` or `{}`. |
| `logoLibRead` / `libraryList` | Logo and video libraries from a desktop backup (`store/LibraryRestore.kt`). `logoLibRead { id }` → `{ id, name, kind, mime, b64 }` (the engine's logo layer, as desktop `logo-lib:read`); `libraryList { key: 'logos' \| 'media' }` → manifest items. |
| `texturesList`, `textureRead { name }` | MilkDrop textures (see the engine table). |

**Engine view.** The editor and the files keep the user's values. The engine receives a view in which the outputs the
phone does not have are off: `lighting`, `openrgb`, `artnet`, `sacn`, `wled`, `oscOut`. Measured on a copy of a desktop
profile: with the light palette taken from MilkDrop, the engine read pixels back from the GPU about 30 times a second
for lights that do not exist, and the emulator dropped from 60 to about 4 frames per second. Taking the profile back
to the desktop turns the lights on again.

**Import** (`SVAndroid.importProfile({ media? })`) gives the same result as the desktop's full-backup restore:

- `backup.json` is checked with the desktop rules (`type`, `format`, a settings object). The error codes are the
  desktop's: `NOT_BACKUP`, `FORMAT`; `NOT_SETTINGS` for a plain file that is not a settings object.
- The settings and scenes are replaced with the backup's; the previous files stay as `*.before-import.json`. Presets
  are added. The imported settings go through the same load path (migration, cleanup), are completed with the
  defaults and get a layer stack, as in the panel's `adoptImportedSettings`.
- MilkDrop textures are imported as on the desktop: the original name must be portable (`portableName`) with an
  image extension, the archive entry must have the desktop's `textures/<n>-<slug>` form, and the same name is replaced.
  The other machine's texture folder is cleared and `milkdropLibrary.textureRev` goes up, so the engine lists them
  again (the panel does the same).
- Library files (logos, videos, lyrics) are not opened yet; their counts come back in `later` (phase 4). Scenes that
  use them miss those files until then.
- **Scale** (measured with a real desktop library, 10,392 presets, 147 MB; backup 33 MB): import 22 s on the emulator
  (reading 7.5 s, committing 11.7 s); the list after a cold start 212 ms (1.8 MB). The lean list is kept in
  `presets-index.json` next to the presets folder, so a start does not read 147 MB. Staged presets live in the profile
  folder and are moved, not rewritten: a preset is rewritten only when its `builtin` is true (10,390 of these presets
  carried `builtin: false`, and rewriting each with a forced sync took 58 s).

**Editor API** (`window.SVAndroid`, used by the mobile UI in phase 3):

| Member | Notes |
|---|---|
| `config.get()`, `config.set(cfg)`, `config.patch(keys)`, `config.flush()`, `config.ready()` | Configuration, as above. |
| `audio.start(source)`, `audio.stop()`, `audio.status()`, `audio.onStatus(cb)` | Audio source (`capture`, `mic`, `visualizer`). |
| `player.pick()`, `player.open(media, play)`, `player.reopen(uri, play)`, `player.play()`, `player.pause()`, `player.seek(ms)`, `player.stop()`, `player.state()`, `player.refresh()`, `player.onState(cb)` | The in-app player (below). `state()` is the cached state from the last event; `refresh()` asks the player for its fresh position and play state (no event arrives while it simply keeps playing). |
| `audio.silent()`, `audio.onSilence(cb)` | About 3 s of digital silence while an app source runs: the playing app may not share its audio (PHASE0 R3). Fires once when silence starts and once when sound returns; a source change resets it. The UI offers the output mix or the microphone. |
| `gl()` | WebGL context budget: `{ live, attached, limit: 8, created, lost }`. `live` counts every context that is not lost, also canvases outside the document (timeline layers), because those count toward the limit too. On in release builds. |
| `importProfile({ media? })` | Import from the desktop (above). Resolves `{ kind, summary, scenes, presets, skipped, later, migrated }`. |
| `onMemoryPressure(cb)` | The system asked for memory (`onTrimMemory`, level ≥ `RUNNING_LOW`, which includes going to the background). The pending save is written first. |
| `insets()`, `onInsets(cb)` | Space taken by the status and navigation bars and the display cutout, `{ top, right, bottom, left }` in CSS pixels (dp). Measured even while the bars are hidden, so the layout does not jump. |
| `onBack(cb)` | The system Back gesture. With a listener, the page decides; without one, the app goes to the back. |
| `updates.state()`, `last()`, `auto()`, `check()`, `setMode(mode)`, `skip()`, `told(version)`, `open()`, `onChange(cb)` | New version notice (the `update*` requests above). Settings → Updates (`src/mobile/shell-updates.js`): status, last check, release notes, Check Now, Open the Release Page, Skip This Version and the "Tell me about new versions" switch. While a version is pending, a banner at the top of Settings, a dot on the Settings button and one toast per version. While linked to a PC, the PC's own version through `updates.state` / `updates.check` (read only; installing stays on the PC). |
| `app.toBackground()` | Sends the app to the back (`moveTaskToBack`). The Activity is not closed: the engine and the audio keep running. |
| `onChrome(cb)` | `{ pip }` or `{ floating }` when picture-in-picture or the floating window starts or ends. The interface hides itself in both. |
| `onMeter(cb)` | The engine's level message (`level`, `bass`, `mid`, `treble`, `fps`…), about 30 times a second. |
| `onLowPower(cb)` | `true` while low power is on (`SVLowPower.active`: set to on, or set to battery while on battery). The interface drops the glass blur. |
| `floating.open(o)`, `floating.close()`, `floating.set(o)`, `floating.state()` | The floating window requests below. |
| `pip(w, h)` | System picture-in-picture with aspect `w:h` (`pipEnter`). |
| `exportOpen(job)` | Export (phase 5): `{ cfg, width, height, fps, durationSec (0 = whole song, clamped to the song), audioUri, outputName }`. The app copies the song into the media folder for the muxer and switches the one WebView to the export page; the page takes the job (`exportJob`), renders, and the result is copied to the gallery (`exportSave`: MediaStore, `Movies/SoundVisualizer`); `exportShare` opens Android's share sheet, `exportClose` returns to the scene page and deletes the copied song. |
| `media.pick(kind)` | Android's document picker (`mediaPick`). `'video'` resolves `{ url, name, mime }`: the file is not copied, the app keeps a persistent read grant and serves it at `https://appassets.androidplatform.net/content/<base64url of the content URI>`; only URIs with a persisted grant are served (others 404). `'audio'` resolves `{ uri, name }` (for export). `'image'` resolves `{ dataUrl, name, width, height }`, the long side at most 1024 px (PNG with alpha, else JPEG), as the desktop stores images in the settings. |
| `presets.importMilk()` | `.milk` / `.milk2` files from the phone (`milkImport`). Resolves `{ added, duplicates, invalid, skipped, ids }`; the added presets reach the engine as a delta (`onPresetsDelta`, with the new generation), so the scene is not rebuilt. |
| `nowPlaying.current()` / `system()` / `status()` / `openAccess()` / `onChange(cb)` | Now playing as the desktop's shape (`has, playing, title, artist, album, artwork, app, position, duration, updated`). The in-app player wins while it plays; otherwise another app's media session (event `mediaSession`, needs notification access). The text, now-playing and lyrics layers read it through `window.api.onNowPlaying`. |
| `lyrics.list()` / `read(id)` / `import()` / `add(item)` / `update(id, patch)` / `remove(id)` / `clearCache()` / `auto()` / `follows()` | Library → Lyrics. The engine gets the library through `window.api.lyricsLibSnapshot` / `onLyricsLib`; a lyric found automatically is appended last (the user's own match wins) while that track plays. Lookup only runs when `lyricsLookup.enabled` and the scene has a lyrics layer that follows the track (desktop `configFollowsLyrics`). |

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
| `floatingSet { opacity?, clickThrough?, locked?, keepAspect?, width?, height? }` | Same settings as the desktop floating window. With pass-through on, opacity is capped at the system limit (`maxPassThroughOpacity`, 0.8 on Android 12+). `keepAspect` (default on): pinch keeps the ratio; off, the two axes follow the fingers separately. `width` and `height` (px, both) resize the open window. |
| `floatingClose` | Closes the window and brings the app back; the same engine returns to full screen. |
| `floatingState` | `{ showing, opacity, clickThrough, locked, maxPassThroughOpacity, bounds, activity }`. |
| `playerPick` | Opens Android's document picker for an audio file, keeps a persistent read grant and opens it in the player. Resolves the player state plus `uri`, or fails with `cancelled`. Needs the Activity. |
| `playerOpen { media? , uri?, play? }` | Opens a file from the app's media folder (`media`, must resolve inside `files/media/`) or a document picked earlier (`uri`, only with a persistent grant). |
| `playerPlay`, `playerPause`, `playerStop`, `playerSeek { ms }`, `playerState` | Resolve the player state: `{ has, playing, state, position, at, duration, title, artist, album, artwork, name, error }` (times in ms; `at` is the wall-clock time `position` was read, so a late event can be corrected). |
| `playerPosition` | Only `{ has, playing, state, position, at }`: asked often while playing (`player.refresh()`), so it leaves out the cover and the other large fields. |
| event `playerState` | The same object, on every change (play/pause, track, metadata, seek, end, error). |
| `pipEnter { w, h }` | System picture-in-picture with aspect `w:h`, clamped to 1:2.39…2.39:1. |
| event `windowChrome` | `{ pip }` when picture-in-picture starts or ends, `{ floating }` when the floating window opens or closes. Only the interface gets it; the engine's `onWindowChrome` is the desktop window bar's (`{ show }`). |
| `appToBack` | `moveTaskToBack`; the Activity stays. |
| `keepAwake { on }` | Keeps the screen on while the engine is shown (the page sends the desktop's `power.keepAwake`, default on; always on on the export page). Set on the engine's container view, so it follows the engine into the floating window and survives an Activity rebuild; not on the WebView itself, because Chromium manages that one for media. |
| event `insets` | `{ top, right, bottom, left }` in dp; sent on every change and again on `hello`. |
| event `uiMode` | `{ dark }`: the device's light or dark setting; sent on `hello` and on every change. WebView's `prefers-color-scheme` does not follow it. Read through `systemDark()` / `onSystemDark(cb)`. |
| event `backupProgress` | `{ done, total }` in bytes while a phone backup is written. |
| event `back` | The Back gesture while the page is connected. |
| event `powerSource` | `{ onBattery }`, on `hello` and when the charger is plugged or unplugged. |
| event `memoryPressure` | `{ level }` (`onTrimMemory`, registered on the application, so it also arrives while only the floating window is up). |
| `linkStatus` | PC link ([PHONE-LINK.md](../PHONE-LINK.md)): `{ state, pc, level, digits, error, saved, discovered }`. `state` is `idle`, `connecting`, `approve` (QR: approve on the computer), `sas` (code: compare the six digits), `connected`, `reconnecting` or `error`. `saved` has no keys. |
| `linkPairQr { qr }`, `linkPairCode { host, port, code }` | Start pairing; progress arrives as `linkState`. Fail at once with `bad-qr` or `bad-input`. |
| `linkConnect { pc }`, `linkDisconnect`, `linkForget { pc }`, `linkAuto { pc, on }` | Saved computers. The last one with `auto` is reconnected when the app starts and after a lost connection (1, 2, 4, 8, 15 s). A computer that answers `unknown-device` is removed. |
| `linkRequest { op, args }` | Encrypted request to the computer; resolves `{ ok, result }` or `{ ok:false, error }` (`not-connected`, `not-allowed`, `unsupported`, `timeout`). |
| `linkDiscover { on }` | Listens for the computers' UDP announcements (port 47821, multicast lock held only while on). |
| `linkQrFrame { w, h, data }` | Decodes a QR code from a grey camera frame (base64, one byte per pixel) with the bundled ZXing core; resolves the text or `null`. |
| events `linkState` / `linkEvent` | The link status on every change; events the computer pushes (`{ ev, … }`). |
| `linkAudioSend { on }` | Phone audio → computer (B4): every PCM block the capture, microphone or in-app player produces is also sent, encrypted, in the link's audio packet (`link/LinkAudio.kt`). Runs in the app, so it continues in the background. A queue of more than 24 packets drops new ones. Resolves `{ send, sent, dropped }`. |
| `linkAudioWatch { on }` | While on, the page receives only the computer's audio (PCM source `pc`, code 4) and not the phone's own: the two must not mix in one ring buffer. |
| `linkPick { kind }` | Document picker for a file to send to the computer (`video`, `logo`, `lyrics`, `milk`, `audio`); resolves `{ uri, name, size }`. The file stays on the phone. |
| `linkUpload { uri, kind, name }`, `linkUploadCancel { key }` | Sends the picked file to the computer in parts from the app (`link/LinkUpload.kt`: `file.begin` → `file.chunk` in order → `file.end` with SHA-256), so it continues in the background. Resolves `{ key }`; progress arrives as event `linkUpload { key, kind, name, size, sent, state, error?, result? }`, `state` `begin`, `sending`, `done`, `error` or `cancelled`. A `rate` answer retries the same part. |
| `linkMediaFetch { id, file }` | Copies a video from the computer's settings to the phone with `media.fetch` (`link/LinkDownload.kt`, parts in order, a `rate` answer retries the same part). With a PC library `id` the file is saved as `media/lib-media/pc-<id>.<ext>` and added to the phone's video library; without one it is saved under `media/link-cache/` with a hash of the address as its name. A file of the same size is not downloaded again. Resolves `{ id, url }` when the file is complete. Progress arrives as event `linkDownload { key, name, size, got, state, error? }`, `state` `begin`, `sending`, `done` or `error` (at most four a second); a file already on the phone sends only `done`. The page shows a notice when a download starts and ends, and a progress bar in PC Settings. While the target is the PC, the page asks for each video the drawn settings use (not the scene list) and draws the phone's copy; the settings sent to the PC keep the PC's address. |
| `linkHeld { list }` | Momentary effects held on the Live tab. The app sends the list and renews it every 0.5 s on the link thread, independent of the page (measured on the emulator: a page round trip of 0.2–0.5 s, seconds under load, ran past the computer's 1.5 s lease). The page repeats the call every second while held; after 4 s without it the app releases the list. |

The page side of the link is `SVAndroid.target` (`get`, `set('phone' | 'pc')`, `onChange`) and `SVAndroid.pc`
(`request`, `live`, `meter`, `onLive`, `onMeter`, `onError`, `hold`, `audioSend`, `preview('smooth' | 'image' | 'off')`,
`onShot`). With the target on the computer, `config.get/set/patch` read the computer's settings mirror and write the
changed top-level keys to it (`src/mobile/pc-remote.js`); `config.local()` is the phone's own settings. The interface
theme stays the phone's, and the phone's engine draws the computer's settings with the phone's own power and audio
settings. Phone-side automation (Auto VJ, dynamic theme, timeline action clips) does not write to the computer: the
computer runs its own.

The engine (the one WebView) belongs to the app, not to the screen (`EngineHost`): it is built on the application
context and moved between the full-screen Activity and the floating window. If the system destroys the Activity while
the floating window is up, the engine keeps drawing; reopening the app shows the same engine without rebuilding the scene.


## In-app player (phase 2.3)

The fourth audio source and the one with the best quality: no permission, no consent dialog, and the app's own
decoded samples, not a recording (`player/PlayerService.kt`, media3).

- **In time with the speaker.** Decoded audio reaches the audio output well before it is heard; on the emulator about
  0.6 s was queued in the output. A copy of each buffer (`TeeAudioProcessor`) waits in `PcmClock` until the player's
  playback position reaches it, in 512-sample blocks like the desktop helper. Measured: blocks are released 2 to 4 ms
  after the playhead reaches them (`probe.js player`).
- **One source at a time.** Starting playback stops system-audio, microphone and Visualizer capture; starting one of
  those pauses the player.
- **Media session** (media3-session): notification, lock screen and headset buttons; the service is in the foreground
  (`mediaPlayback`) while playing. Only controllers the system trusts may connect (system UI, holders of
  `MEDIA_CONTENT_CONTROL`, the app itself). The session is added to the service explicitly, because the app drives the
  player directly; without that, no notification appeared and the service never went to the foreground (measured).
- Swiping the app away stops playback unless the floating window is showing.

## Security (phase 2.5)

Measured or enforced in code; nothing here depends on the page behaving well.

- **Channel:** `SVNative` is registered only for `https://appassets.androidplatform.net` and answers only the main
  frame. The document-start scripts (`window.api`) run only on that origin. A foreign page never sees either.
- **Navigation guard:** the WebView may only navigate inside our origin; anything else is refused and logged.
  Multiple windows are not enabled, so `window.open` goes through the same guard. A request to our own host that
  no handler answers gets 404 (204 for `/favicon.ico`) and never reaches the network.
- **WebView settings:** file and content access off, mixed content never, zoom off.
- **Web permissions:** the `WebChromeClient` (`WebShell.create`) grants only the camera, only to our origin, and only
  with the app's own `CAMERA` permission. When the app has no permission yet, Android asks (`MainActivity.requestCamera`)
  and the pending request is granted or denied by the answer; in the floating window there is no activity to ask, so the
  request is denied. Every other request (microphone, several resources at once) is refused: audio comes from the app,
  not from the page. The engine opens the camera itself on Android (`media.js` `_webPage()` is false there; the https
  origin is not a stream client).
- **Files:** the profile store accepts only the names in `ProfileNames.kt`. A song for export must resolve inside
  `files/media/` (canonical path). The export file name comes from the page and is cleaned by `ExportNames.kt`:
  no path parts, no leading dots, `.mp4` (unit test).
- **Debug only:** WebView DevTools, `window.__svHost`, the `page` intent extra and `debugFinishActivity` exist only
  in debug builds (`BuildConfig.DEBUG`).

The editor's calls (settings, presets, import, export queue, audio source, floating window…) are defined in phases
2 and 3. They follow the same rules. Where a desktop IPC channel exists, the method keeps its name (`presets:save` →
`presetsSave`), so the two hosts stay easy to compare.
