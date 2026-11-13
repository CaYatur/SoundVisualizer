# Android app — plan

Türkçe: [PLAN.tr.md](PLAN.tr.md)

Status: approved on 2026-11-14. Work happens on the `dev/android` branch. Contracts: [HOST.md](HOST.md) (the
`window.api` surface on Android) and [MESSAGES.md](MESSAGES.md) (the binary channel between Kotlin and the page).

The goal is to bring almost everything the desktop app can do to Android phones: layers, the visual engines,
MilkDrop, the timeline, video export, full screen, a floating window and system-audio capture. The engines are not
rewritten. The phone is a personal device, so most VJ and show-control tools stay on the desktop.

---

## 0. Decision log

| # | Decision | Why |
|---|---|---|
| D1 | **A thin Kotlin shell around Android System WebView and androidx.webkit.** No Capacitor. | The engine runs on Chromium on both desktop (Electron) and Android, so shaders and canvas behave the same. None of the native features we need (playback capture, Visualizer, PiP, MediaCodec/MediaMuxer, background player) has an official Capacitor plugin. Raw audio and encoded video cross the bridge as binary (ArrayBuffer), which the Capacitor bridge does not carry. No third-party framework to keep up with. |
| D2 | **One WebView** for the editor, preview, full screen and PiP, so one engine instance. **Export runs in a separate WebView.** | One engine means half the GPU work and memory. The exporter pins the random generator and the clock (#905), so it cannot share a page with the live view. |
| D3 | **System PiP and a free-size floating window, both in the first release.** The floating window reuses the desktop floating-window settings (`floating.opacity/clickThrough/aspectLock/locked`). | Owner's decision. |
| D4 | **Four audio sources, one analysis.** Android sends raw PCM only; the FFT runs in JavaScript with the same code as the desktop capture helper. | Phone and desktop bands show the same numbers, and there is no second FFT to drift. |
| D5 | **Export:** `exporter.js` runs unchanged. The Android `sendFrame` turns the I420 frame into a WebCodecs `VideoFrame` and encodes it; chunks go to Android's MediaMuxer. The audio track is passed through when it is AAC, otherwise encoded with Android's AAC encoder. | The first path does not touch desktop code. Taking the frame straight from the canvas comes later, if measurements justify it. |
| D6 | **Of the VJ tools, only Auto VJ and BPM.** No Live page/T-bar, Clip Deck, modulation editor or WLED. | Owner's decision. Scenes built on the desktop with modulation still look the same on the phone, because the engine applies modulation. |
| D7 | **Language:** `i18n.js` already picks Turkish on Turkish devices and English otherwise. Mobile strings go into the same file under the same parity tests. | No second translation system. |
| D8 | **Design:** the `ui-themes.js` themes, `icons.js` and `src/admin/fonts`. **Mock-ups first, approval, then code.** | The desktop design language carries over. |
| D9 | **Versioning:** Android has its own line starting at `1.0.0`, tagged `android-v1.0.0`. The APK is a GitHub Release asset with its SHA-256; no binaries in git. | Desktop and Android releases do not wait for each other. |
| D10 | **Android versions:** minimum Android 10 (API 29, the floor for playback capture); target and compile API 36. Android 17 (API 37) is tried on the emulator. | Google Play has required API 36 since 2026-08-31. |
| D11 | **Dependencies:** Kotlin and Google's androidx libraries only (webkit, core, activity, media3-exoplayer, media3-session). Gradle wrapper and versions pinned. CI uses GitHub's own actions and `./gradlew`. | Independence. |
| D12 | **Signing:** debug signing during development. Before the first APK the owner creates the release key (the password stays with the owner, outside the repository, backed up). If the app moves to Play, the same key is uploaded to Play App Signing. | GitHub and Play installs then carry the same signature and update into each other. |
| D13 | **Updates:** a "new version" notice and a link to the release page. The app never installs itself. | Play policy. |
| D14 | **Branch and PRs:** `dev/android` (from `main`) is **additive only**: `android/`, `src/mobile/`, `docs/android/`. One PR per task. Commits and PRs in English, "For #N". The Android CI job is not one of the five required checks. Releases need separate approval. | Existing rules. |
| D14b | **Desktop-touching changes go to `main` first**, each as its own PR through the desktop gates, and `main` is then merged into `dev/android`. | Desktop changes are tested by the desktop test and release flow. Test-count conflicts mostly disappear, and merging Android into `main` later changes nothing for the desktop app. |
| D15 | **No physical phone for now:** work starts on the emulator. Performance decisions and **the 1.0 release depend on measurements on a physical phone.** | The emulator GPU does not represent a phone. |

---

## 1. What the emulator can and cannot answer

Machine: Android Studio, SDK 36, build-tools 36.1, NDK 29, emulator with WHPX.

| Question | Emulator | Physical phone |
|---|---|---|
| Does WebGL2 work, do the shaders compile | ✔ | limits and driver bugs |
| WebGL context limit | ✔ probably the WebView's own rule; measured | confirm |
| fps, heat, battery | ✘ | **required** |
| Playback capture API, consent dialog, foreground service | ✔ | confirm |
| Whether real apps allow capture | ◐ needs a Google Play image and a signed-in account | ✔ |
| Visualizer on the output mix | ◐ unclear on the emulator's software audio | **required** |
| Microphone | ✔ host microphone | ✔ |
| WebCodecs H.264 and MP4 | ✔ function (software encoder) | speed, hardware encoder |
| PiP, floating window, moving the WebView between windows | ✔ function | vendor permissions |
| Vendor (MIUI) permissions and battery savers | ✘ | **required** |
| Android 13–17 behaviour | ✔ | — |

Emulator images: x86_64 "Google APIs" images for API 29, 31, 34, 36 and 37. The "Google Play" images need a separate
Google licence; if the owner accepts it, they are added so the WebView updates from Play and real apps can be tried.

---

## 2. Protecting the desktop app

**Guards found in the existing tests:**
- `copyright-headers` scans `git ls-files src scripts native`, so `src/mobile` is covered. `android/` is not; `.kt/.kts/.xml` get their own test.
- `source-parses` parses every `.js` under `src`, so the mobile JavaScript is covered.
- `ui-themes` lists CSS files **by hand** (`admin.css`, `studio.css`). **The mobile CSS must be added** or the colour rule does not apply to it.
- `external-review` allows no binary files under `src`. Icons and fonts are copied at build time, never committed to `src/mobile`.
- `scripts/test.js` checks the test count in README, README.tr and ROADMAP. A PR on `dev/android` that adds tests also updates those numbers.

**Changes that touch desktop files.** Each is its own PR to `main` through `npm test`, the smoke test and, where relevant, the golden A/B (107 scenes unchanged):
1. Move the FFT and audio-frame builder into one shared module. Today there are two copies, in `loopback-helper.js` and `exporter.js`. Extra gate: frames are byte-identical before and after (test).
2. `package.json`: exclude `!src/mobile/**` from electron-builder and add the `android:*` scripts. The `platform-packaging` test proves that the mobile files stay out of the desktop package.
3. `.gitignore`: `android/**/build`, `.gradle`, `local.properties` and the copied web assets.
4. A new `.github/workflows/android.yml` that runs only when `android/**` or `src/mobile/**` change. Not required; existing workflows untouched.
5. (Optional, after measurement) `exporter.js` takes the frame straight from the canvas as a `VideoFrame`.
6. **Releases page collision.**
   - **The problem:** the desktop updater (`src/main/updater.js`) reads `releases/latest` only. The README download buttons and badge point there too. If an Android release became "Latest", desktop users would land on the APK and the desktop updater would miss real desktop updates.
   - Android releases are **always published with `--latest=false`**; "Latest" always stays on the desktop app.
   - A small guard in the desktop updater ignores tags that do not start with `v`. A test proves it.
   - The Android updater never uses `releases/latest`; it lists releases and keeps the `android-v*` tags.
   - `release-assets.js` never mistakes an Android release for a desktop one (tag pattern check).

---

## 3. Contracts written before code

1. **[HOST.md](HOST.md):** the Android version of `window.api` (engine), `window.exp` (exporter) and the shell API. **Contract test:** every `window.api` method the engine calls is defined by `android-host.js` or listed as not available on Android, with a reason.
2. **[MESSAGES.md](MESSAGES.md):** the binary format between Kotlin and the page. Constants live in one place on each side. Cross test: bytes produced in JavaScript are decoded by a Kotlin unit test.
3. **Storage layout:** `filesDir/settings.json` in the desktop format, checked by the shared `migrate-v4`/`schema` modules. Presets, libraries and textures are laid out as on the desktop. Writes are atomic: temporary file, then rename. Import and export go through the Android file picker.

---

## 4. Work list

Each phase ends with a "done when" line. The owner approves each phase before the next one starts.

### A — Preparation
- A1 `dev/android` branch.
- A2 GitHub: tracking issue and "Android 1.0" milestone.
- A3 Emulator images and virtual devices.
- A4 Drafts of HOST.md and MESSAGES.md.
- **Done when** the emulator boots and the contracts are written down.

### 0E — Feasibility on the emulator (no UI)
- 0E1 `android/` Gradle project: one Activity and a WebView. Pages load from a secure local origin (`https://appassets.androidplatform.net`, WebViewAssetLoader). WebView debugging is on in debug builds.
- 0E2 `scripts/android-assets.js` copies `src/visualizer`, `src/shared` and `assets` into the APK, bundled with `bundle-pages`.
- 0E3 First `android-host.js`: the unchanged visualizer page opens with demo audio.
- 0E4 Automated probing through `adb forward` and the WebView DevTools socket, using the existing CDP tooling. Measures GL capabilities and the context limit.
  - **Golden scenes:** the 107 desktop golden scenes are first sorted into three groups:
    - **should render;**
    - **needs a missing asset:** local media paths, the MilkDrop corpus and textures are not in the repo;
    - **desktop-only source:** screen capture, Spout, web layers and so on.
  - The "opens without errors and is not black" check applies only to the first group. Otherwise scenes that are black for reasons unrelated to Android give false failures.
- 0E5 Audio: playback capture (MediaProjection and a foreground service) → PCM → JavaScript FFT → engine; Visualizer; microphone; in-app player (media3).
- 0E6 WebCodecs support table (H.264/HEVC/AV1, AAC). A 10-second test export produces an MP4 that plays.
- 0E7 PiP and the floating window. Moving the WebView into the floating window without losing the WebGL context.
  - **The real test:** the system destroying the Activity while the floating window is up, which some vendors do often. The WebView is built on a context independent of the Activity (the application context or a `MutableContextWrapper`) so it outlives the Activity.
  - **Pass:** with "Don't keep activities" on in developer options, the floating window keeps drawing, and the same engine carries on when the app is reopened.
- **Done when** `docs/android/PHASE0.md` (the measurement report and its effect on decisions) and the list of checks to repeat on a phone (0P) are written.

### 1 — Infrastructure
- 1.1 FFT moved into a shared module (desktop PR to `main`).
- 1.2 electron-builder exclusion, `.gitignore`, npm scripts, wider guard tests (mobile CSS, Kotlin headers), updater tag guard. Desktop PRs to `main`.
- 1.3 `android.yml`: `assembleDebug`, Kotlin unit tests and lint, path-filtered.
- 1.4 `versionName`/`versionCode`; `release-assets.js` learns about the APK (release phase).
- **Done when** the desktop gates and the Android CI are green and no mobile file is in the desktop package.

### 2 — Android host
- 2.1 The full `android-host.js` and its contract test.
- 2.2 Storage (settings, presets, libraries), atomic writes, importing desktop files.
- 2.3 Audio sources and permission flows. Silence is detected and Visualizer or the microphone is offered. Foreground service types: `mediaProjection`, `mediaPlayback`, `microphone`. Notification.
- 2.4 Lifecycle:
  - Rotation does not rebuild the WebView.
  - Memory pressure (`onTrimMemory`) is handled.
  - **When the WebView renderer dies (`onRenderProcessGone`) the page is rebuilt and the last settings are kept.**
  - A lost WebGL context rebuilds the scene.
- 2.5 Security:
  - The bridge is open only to our own origin; external pages opened by a web layer cannot reach it.
  - File access and mixed content are off.
  - Navigation guard, the Android counterpart of `nav-guard`.
- **Done when** all four audio sources drive the engine on the emulator and the app survives crashes and rotation.

### 3 — Mobile interface
- 3.1 Information architecture and **mock-ups**: themes, light and dark, TR/EN, 360 dp phones and tablets. **Owner approval.**
- 3.2 Shell: bottom navigation, preview area, bottom sheets for settings.
- 3.3 Scene editing:
  - Layer list: reorder, hide, opacity, blend.
  - Adding a layer: a mode picker with thumbnails.
  - Parameters: controls generated from `schema.js`.
  - Effect chain.
- 3.4 Full screen, PiP, floating window:
  - Opacity, touch pass-through (**Android 12+: while pass-through is on, opacity is at most 80%; the value is read from the system**), aspect lock, position lock.
  - A guide to vendor permissions.
- 3.5 Audio source screen; Auto VJ and BPM.
- 3.6 Settings: theme, language, performance (render scale, frame cap, low power), about and licences.
- 3.7 Accessibility: touch targets of at least 48 dp, screen-reader labels.
- **Done when** the screens match the approved mock-ups and the TR/EN parity and theme tests are green.

### 4 — Content
- MilkDrop: browser, search, favourites, `.milk` import, textures.
- Studio shader presets.
- Gallery (photo, video) and camera layers.
- Text and lyrics, logos, templates.

### 5 — Timeline and export
- A touch editor on the shared timeline model (`timeline*.js`).
- Importing songs.
- Export screen: resolution, fps, codec, quality, progress, cancel.
- Saving to the gallery and sharing.

### 6 — Verification on a phone and polish (**physical phone required**)
- The 0P measurements: fps, heat, battery, Visualizer, real apps, vendor behaviour.
- Default performance settings come from these measurements.
- Release key (with the owner), release notes. **The release needs separate approval.**

### 7 — Desktop ↔ Android link
Only when the owner asks.

---

## 5. Risks

| # | Risk | Mitigation |
|---|---|---|
| R1 | The WebGL context limit is tight | Measure first. Then a layer budget; if needed, a shared context for GL layers (desktop engine, golden gate). |
| R2 | Emulator performance says nothing about phones | Phone measurements before 1.0; adaptive render scale on by default. |
| R3 | Apps block playback capture | Silence detection, offer Visualizer or the microphone, in-app player. |
| R4 | Old WebView versions | Minimum version check with a notice; feature checks (`isConfigSupported`, `WEB_MESSAGE_ARRAY_BUFFER`). |
| R5 | The WebView renderer dies | Rebuild through `onRenderProcessGone`. |
| R6 | Export slows down in the background | First release keeps the screen on; background export only after measurement. |
| R7 | Vendor battery and permission rules | Guide screen, phone verification. |
| R8 | `dev/android` drifts from `main` | D14b; merge `main` in regularly. |
| R9 | Play rules (floating window, service declarations) | A compliant manifest from the start, with written reasons. |
| R10 | Full resolution on a 2400×1080 screen is expensive | Render scale, default set by measurement. |
| R11 | An Android release becomes "Latest" on GitHub | `--latest=false` rule, tag guard in the desktop updater and its test (§2.6). |
| R12 | The system destroys the Activity while floating | WebView independent of the Activity; "Don't keep activities" test (0E7). |
