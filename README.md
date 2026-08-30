<div align="center">

<img src="assets/icon.svg" alt="CaYaDev Visualizer" width="128" height="128" />

# CaYaDev Visualizer

### 🎵 Audio-reactive visualization application with multi-monitor and multi-audio-source support

**Windows** & **macOS** · Electron + WebGL · Native WASAPI/CoreAudio loopback

[![License: MIT](https://img.shields.io/badge/License-MIT-e11d2a.svg)](LICENSE)
[![Platform](https://img.shields.io/badge/platform-Windows%20%7C%20macOS-111827.svg)](#-build--distribution)
[![Electron](https://img.shields.io/badge/Electron-33-47848F.svg)](https://www.electronjs.org/)
[![cayadev.com](https://img.shields.io/badge/cayadev.com-e11d2a.svg)](https://cayadev.com)

</div>

---

CaYaDev Visualizer is a desktop application that generates full-screen visual effects that react in real time
to **system audio, microphones, and other selected audio inputs**. It has three output paths:

- 🎛️ **Admin Panel** — the control screen where all settings are adjusted live.
- 🖥️ **Visualization Screen** — the audio-reactive visual that opens full-screen on **every** monitor you select.
- 📡 **Streaming Page** — a transparent overlay you add to OBS as a "Browser Source", running the same
  engine (plus a remote-control page for your phone).

Audio can be captured from **system output devices** (speaker/headphone loopback), **microphones/input devices**, or multiple selected sources at the same time.
Selected sources are mixed before FFT analysis using the native `audify` module.

---

## 🎬 Demo

| Audio visualizer (live) | Frequency bars (live) |
|:---:|:---:|
| ![Visualizer demo](docs/screenshots/demo-visualizer.gif) | ![Bars demo](docs/screenshots/demo-bars.gif) |

> The GIFs above were generated with a synthetic audio signal; in real use, they react directly to the music being played.

---

## 🎛️ Interface (Admin Panel)

The panel has three columns: a **category rail** on the left, the selected category's setting cards
in the middle, and a **live preview**, audio meters and scenes on the right.

- **5 categories** — Scene, Audio, Lighting, Output, Library. Every setting belongs to one, and both
  the card headers and the category rail badge how many settings differ from the defaults.
- **Basic / Advanced split** — each card shows only a handful of essential settings by default and
  groups the rest under *Advanced settings*, so the panel does not get crowded as the app grows.
- **Live preview** — the visualizer's real rendering engine runs inside the panel. With no audio it
  is driven by a music-like sample signal; click the **Demo** badge to capture real system audio
  without opening the visualizer at all.
- **Search (Ctrl+K)** — find any setting across every category from one box; picking a result opens
  its category and highlights the control.
- **Scenes** — store background + visualizer + logo + visual objects under a name, restore with one
  click, export and import.
- **Section and category resets**, a JSON backup of every setting, and automatic saving.

<div align="center">
  <img src="docs/screenshots/admin-panel.png" alt="Admin Panel" width="900" />
</div>

---

## 📡 Streaming Output — OBS and the browser

The application can open a **local HTTP + WebSocket server**. The page you give
OBS as a "Browser Source" runs **exactly the same engine** as the desktop
window: there is no second renderer, so the stream never drifts away from what
is on screen.

- **No plugin to install.** OBS → Sources → ＋ → Browser → paste the address.
- **Real transparency.** The visualizer becomes a direct overlay; append
  `?transparent=0` to the address if you want the background on stream too.
- **Per-source tuning.** `?fps=30` or `?scale=0.75` lowers the load of that
  one source without touching the rest.
- **No window capture needed.** The OBS overlay works even if you never open
  the visualization window; audio capture starts when the browser source connects.
- The server listens on **127.0.0.1 only** by default. "Open To Local Network"
  is required for phone access, and in that mode every request must carry a
  hard-to-guess **token**.

### 📱 Mobile remote control

The same server serves a phone-friendly remote at `/remote`.

- Scenes, color presets, and Studio presets are listed **by name**; the active
  one is highlighted and every list can be **stepped through in order with ◀ ▶**.
- Open/close the visualization, switch mode and background, adjust
  sensitivity/glow, and **black out** with one button.
- The page follows the application's language, not the phone's.

---

## 🧪 Studio — build your own visualizer

A two-tier editor: design without writing code, or start from a blank shader.

**Variation (no code).** Names and stores the look you like on screen. The base
mode and all of its current settings go into the preset; one click brings it back.

**Shader (GLSL).** The entry point is the same as Shadertoy — `mainImage(out
vec4 fragColor, in vec2 fragCoord)` — with audio data and your own sliders on top:

| Variable | Meaning |
|---|---|
| `sv_time`, `sv_resolution` | time and resolution |
| `sv_level`, `sv_bass`, `sv_mid`, `sv_treble` | audio bands (0..1) |
| `sv_beat` | beat energy (0..1), jumps on every hit |
| `sv_spec(x)` | logarithmic spectrum value at position 0..1 |
| `sv_waveAt(x)` | waveform (-1..1) |
| `sv_col(x)` | a color from your own 5-stop palette |
| `sv_prev` | the previous frame (feedback effects) |
| `sv_media` | webcam / video layer |

The editor has line numbers, syntax highlighting, a **live preview**, and a
marker showing **which line** the compiler error is on. Define your own
parameters (slider / switch / color) and the panel generates the controls for you.

**Import:** Shadertoy code, ISF files (`INPUTS` become controls), MilkDrop
`.milk` parameters, and our own `.svpreset` / `.svpack` files. Every converter
is this application's own code — **no service is contacted**, and no account or
API key is required.

**Sharing:** Export a single preset as `.svpreset` or all of yours as a
`.svpack`. Presets live in `%APPDATA%/soundvisualizer/presets/` as separate
files, not in the settings file (which is rewritten on every slider drag —
putting shader source there would mean pointless disk traffic).

> ♾ A **feedback engine** ships as its own mode: each frame draws the previous
> one zoomed, rotated, and faded, with the waveform layered on top. That classic
> MilkDrop "endless tunnel" family comes from here.

---

## 🎛️ Control surfaces — MIDI and OSC

- **MIDI:** Your controller's CC and note messages map to any setting or action.
  Press **Learn** and move the control; channel and number are filled in for you.
- **OSC:** TouchOSC, Resolume, Ableton, QLab… a UDP port is listened on and
  addresses are mapped to settings. The 0..1 range is used directly; 0..127 is
  scaled automatically.
- Actions: next/previous visualizer, next background, next scene, next color
  preset, **blackout**.

---

## 🎥 Media layer

Places your webcam or a video file into the scene as a layer.

- Front or back, cover/contain/stretch, blend mode, opacity
- Kaleidoscope (3–12 slices), hue shift, saturation, mirroring
- Bass → zoom and bass → opacity pulses
- Studio shaders can read the same image as `sv_media` (iChannel3)

---

## ✨ Scene Generator

Describe a mood and the application builds a scene: *"dark cinematic space"*,
*"energetic neon techno"*, *"calm forest morning"*…

**It runs entirely offline and is not a neural network.** Your text is reduced
to four axes (energy, warmth, brightness, texture) through a weighted keyword
lexicon; the background, visualizer, and 5-stop palette are then chosen by a
deterministic generator seeded from those axes. The same text plus the same
seed always produces the same scene; 🎲 gives you a different reading of the
same mood. Turkish and English keywords are both recognized.

---

## ✨ Visualization Modes & Styles

**31 visualizer modes** and **19 background types** — all of them share the same color palette,
built-in presets and your own saved presets, so switching modes never disturbs your colors.
That count includes the shaders you write yourself in Studio.

### Visualizer (foreground effect)

<div align="center">
  <img src="docs/screenshots/modes-visualizer.png" alt="Visualizer modes" width="900" />
</div>

### Background

Every background type has **its own detailed settings** (star count, horizon height, curtain
thickness, link distance, ring rate …), collected under *Mode Settings* in the panel.

<div align="center">
  <img src="docs/screenshots/modes-background.png" alt="Background modes" width="900" />
</div>

### Examples of the classic looks

<table>
  <tr>
    <td align="center" width="50%">
      <img src="docs/screenshots/visualizer-bars.png" width="400" /><br/>
      <b>Bars</b> · bottom · rainbow · Aurora
    </td>
    <td align="center" width="50%">
      <img src="docs/screenshots/visualizer-center.png" width="400" /><br/>
      <b>Center Bars</b> · logo · Neon plasma
    </td>
  </tr>
  <tr>
    <td align="center">
      <img src="docs/screenshots/visualizer-bars-mirror.png" width="400" /><br/>
      <b>Bars</b> · mirrored (bass centered) · Ocean
    </td>
    <td align="center">
      <img src="docs/screenshots/visualizer-wave.png" width="400" /><br/>
      <b>Wave</b> · thick · mirrored · Sunset
    </td>
  </tr>
  <tr>
    <td align="center">
      <img src="docs/screenshots/visualizer-circular.png" width="400" /><br/>
      <b>Circle</b> · logo · Lava plasma
    </td>
    <td align="center">
      <img src="docs/screenshots/visualizer-solid.png" width="400" /><br/>
      <b>Solid background</b> · brand red bars
    </td>
  </tr>
</table>

---

## 🚀 Running in Development

```bash
npm install      # installs dependencies
npm start        # starts the application
```

> If `npm install` returns a certificate error because of a corporate network/proxy,
> try again in PowerShell with `$env:NODE_OPTIONS="--use-system-ca"`.

Developer mode (DevTools open): `npm run dev`

> **Development requirement:** **Node.js** must be installed to run the project from source.
> Windows release packages include a bundled Node runtime for the audio capture helper.

---

## 📦 Build / Distribution

```bash
npm run icons      # generates icons from the SVG (build/icon.ico, .icns, .png)
npm run dist:win   # Windows: NSIS installer + portable build (in the dist/ directory)
npm run dist:mac   # macOS: DMG + zip (runs ONLY on a Mac)
```

| Platform | Output | Status |
|----------|--------|--------|
| Windows  | `CaYaDev Visualizer Setup …exe` (installer), `…-portable.exe` | ✅ Fully functional |
| macOS    | `…-darwin-arm64/`, `…-darwin-x64/` (.app), DMG (on Mac) | ⚠️ Build on macOS |

> The current GitHub release provides Windows installer and portable packages. macOS packages must be built on a Mac.

**macOS native audio note:** the native audio module (`audify`) **cannot be cross-compiled**
from Windows to macOS. The interface and visuals work in macOS `.app` packages produced on Windows,
but audio capture does not. For a fully functional macOS build, run `npm install && npm run dist:mac`
on a **Mac**. Capturing **system audio** on macOS requires a virtual audio device such as **BlackHole**
(the microphone works directly).

---

## 🖥️ Usage

1. Pick one or **several** displays from the **Displays** menu in the top bar, then one or more
   **audio sources** (system output, microphone, or other input devices).
2. Click **▶ Open Visualizer** to start the full-screen visual on **every** selected display.
3. Use the cards on the right to change the visualizer type, colors, logo, and performance settings **live** —
   changes are applied immediately and saved automatically.
4. If you are streaming, turn on **Output → Streaming Output** and paste the address it gives you
   into an OBS **Browser Source**.
5. Go to **Studio** to build your own effect, or **Studio → Scene Generator** to have one built for you.
6. Use **Video Export** to render a selected audio file as an MP4 with configurable resolution, frame rate, quality, and encoder.
7. Press **ESC** on any Visualization Screen to close them all.

---

## 🎨 Features

### Background (19 types)
- **Fluid Gradient** — an audio-reactive mesh-gradient backdrop (WebGL shader). Two styles: *Soft
  (No Glow)* and *Plasma (Glowing)*. Flow speed, wander, orbit, swirl, warp, scale, grain, vignette,
  **Audio Burst (Brightness)** and **Audio Hue Shift**.
- **Wave Layers** — crests that swell with the audio (layer count, crest height, wave frequency,
  layer spacing, opacity, bass push).
- **Aurora** — undulating light curtains (curtain count/thickness, undulation, edge softness,
  vertical position).
- **Starfield** — stars streaming out from the center (star count/size, motion trail, depth, twinkle).
- **Retro Grid** — a perspective grid receding to the horizon (horizon height, row/column counts,
  line width, horizon glow, sky intensity, spectrum response).
- **Bokeh Lights** — soft out-of-focus orbs (count, size, size variation, drift, bass pulse).
- **Digital Rain** — falling luminous streaks (column count, fall speed, trail length, density,
  thickness).
- **Network** — drifting nodes with links between the close ones (node count/size, link distance,
  line width, movement speed).
- **Pulse Rings** — rings expanding from the center, with extra rings spawned on bass hits (ring
  rate, expansion speed, thickness, fade).
- **Ink** — liquid ink blobs that swirl as they flow (blob count, viscosity, swirl, spread).
- **Nebula** — overlapping soft gas clouds (layer count, size, softness, density).
- **Hex Grid** — hexagonal cells lit by a wave spreading from the center and by the spectrum.
- **Mosaic** — a jittered cell grid where each cell follows a frequency band.
- **Corridor** — rings or polygons coming toward the viewer (ring count, speed, sides, twist).
- **Spiral** — a rotating multi-armed spiral (arms, turns, taper).
- **Snow / Embers** — swaying particles falling with depth.
- **City** — a two-layer parallax skyline whose windows light up with the music.
- **🧪 Studio** — uses a GLSL shader you wrote yourself as the background.
- **Solid Color** — a single flat color.

Five color stops, **10 built-in presets** (Aurora, Sunset, Neon, Lava, Ocean, Forest, Pastel, Night,
Ice, Single Color) and your own saved presets apply to every background type.

### Visualizer (31 modes)

**Basic** — **Bars** · **Center** · **Segments** (LED equalizer) · **Dot Matrix** ·
**Skyline** (buildings with lit windows)

**Waveform** — **Wave** (oscilloscope) · **Ribbon** (waveform history) ·
**3D Wave** (waveform history stacked in perspective) · **Lissajous** (XY oscilloscope) ·
**Strings** (each string vibrates with its band) · **Terrain** (perspective wireframe landscape)

**Radial** — **Circle** · **Radial Wave** · **Rays** · **Arcs** (one arc per band) ·
**Pinwheel** · **Mandala** (polar rose curve) · **Kaleidoscope** · **Vortex** ·
**Helix** (DNA) · **Tunnel** · **Orb**

**Particles & events** — **Particles** · **Fireworks** (bursts on the beat) ·
**Lightning** (branching bolts on bass) · **Bubbles** · **Liquid Blobs** (metaballs) ·
**Ripple Grid** (rings spreading on the beat) · **Spectrogram**

**Advanced engines** — **♾ Feedback** (the MilkDrop family) · **🧪 Studio** (your own shader)
- Bar count, min/max frequency, gap, position, mirror, line width, amplitude, sensitivity and glow
  are shown whenever they are meaningful for the selected mode.
- **Rainbow** can be toggled off to pick a single or dual color.

### Scenes
- Store the whole look — background + visualizer + logo + visual objects — under a name.
- Restore with one click, update with the current look, export/import as JSON.
- Scenes and color presets are **excluded** from the general settings backup and are preserved when
  a backup is imported.

### Logo / Image
- Places an image/logo in the center; it is **automatically sized and positioned**.
- Size, opacity, glow, position (X/Y), and **audio pulse** controls.

### Audio
- Capture **system output audio**, **microphones/input devices**, or multiple selected sources simultaneously.
- Output devices use WASAPI loopback; input devices use direct capture through the native `audify` module.
- Sensitivity, smoothing, bass emphasis, and live level meters (overall / bass / mid / treble).

### Video Export
- Render a selected audio file as an **MP4 video** using the current visualizer settings.
- Configure resolution, frame rate, quality, encoder, and rendering speed.
- Includes progress tracking, cancellation, and GPU-to-CPU fallback when needed.

### Windows Dynamic Lighting
- Disabled by default and available only when compatible Windows Dynamic Lighting devices are detected.
- Dynamic modes include visualizer color flow, bar-spectrum mapping, advanced bass/mid/treble zones, background-light sync, synchronized beat flashes, frequency ripples, bar + background fusion, cross-device color flow, Rainbow light flow, and threshold-triggered background bursts.
- Threshold-triggered bursts monitor exactly one selected source (bass, mid, treble, overall level, or the strongest band) and react only after its configured threshold is crossed. Burst brightness scales with the amount above the threshold, while color comes from the real current background pixels.
- Bass/mid/treble response can use instant/hard, punchy/hard, or smooth/fluid profiles with configurable threshold, hardness, attack/release, and band separation. Rainbow can run sequentially across LEDs or as one shared tone and react in brightness to a selected audio band.
- Manual modes include one color across all devices, per-device colors, and per-LED/zone colors when exposed by the hardware.
- Brightness, audio reactivity, smoothing, update rate, LED layout, palette source, per-band colors/sensitivity, flash threshold/strength/decay, ripple speed/direction/width, and color spread are independently configurable.
- The installer registers the Windows background-lighting identity automatically. The portable build does not install an identity or request UAC; it controls lighting only while CAYADEV Visualizer is focused. Use the installer build when lighting must continue in the background.
- For background control while another application is focused, place CAYADEV Visualizer near the top of Windows **Dynamic Lighting > Background light control**.

### Settings Backup / Restore
- Export all application settings to a single JSON file, including audio, visuals, Dynamic Lighting, performance, logo, visual objects, display selection, and video export settings.
- User-created **color presets and scenes** are intentionally excluded from the backup and are preserved when a settings file is imported; each has its own export/import buttons.
- Imported settings are merged with current defaults so newer fields remain valid.

### Power / Performance
- **Frame rate:** *Match Display* (one frame per screen refresh — the smoothest) or up to
  120 / 60 / 30 FPS. When a limit is not an exact divisor of your refresh rate (such as 60 on a
  75 Hz screen) the long-run average stays correct but frame intervals become uneven, so
  *Match Display* is recommended for the smoothest result.
- Background resolution scale, pause on silence, hide cursor.

### Application Settings (⚙ menu)
- **Language** — Automatic (system language), Turkish, or English.
- **Keep Visualization Always on Top** *(off by default)* — when enabled, the visualization screen
  stays above other windows even if another application comes to the foreground; it re-raises
  itself whenever it loses focus.
- **Extended Setting Ranges** *(off by default)* — raises the upper limit of the sliders 5×, so you
  can enter values far above the normal range. A few settings that are genuinely bounded by the
  algorithm (smoothing, background resolution) are excluded. Turning it back off keeps any high
  values you already entered.

## 🔊 How Audio Capture Works (Important)

System audio is captured using the **output device's WASAPI loopback**, while microphones and other input devices are captured directly.
Multiple selected sources can be mixed before FFT analysis.

This is handled by a native module called `audify`. Because the native module is not distributed for Electron's ABI,
capture runs in a **separate Node child process** (`src/main/loopback-helper.js`). This process captures the audio,
calculates the FFT analysis, and sends the result to the main process.

> Windows release packages include a bundled Node runtime, so end users do not need to install Node.js separately.

**Device selection:** In the Admin Panel, select one or more output and input devices.
"Default Output" uses the output currently active in Windows. If the list is out of date, press
**🔄 Refresh Devices**. Capture may fail if another application is holding a device in **exclusive mode**;
select another device or close that application.

**Troubleshooting:** Audio diagnostics run automatically, device discovery is retried when needed, and clear error codes are shown. If a required runtime component is missing, **Automatic Repair** can install it after user approval.

---

## 📁 Project Structure

```
src/
  main/                # Electron main process
    main.js            # windows (one per display), IPC, capture lifecycle
    native-audio.js    # manages the loopback-helper child process and forwards frames
    loopback-helper.js # runs with the bundled/system Node runtime: audify capture + FFT
    stream-server.js   # OBS browser source + mobile remote (HTTP + WebSocket)
    osc-server.js      # OSC (UDP) receiver — hand-written OSC 1.0 parser
    presets-store.js   # Studio presets (userData/presets/*.json)
    preload-admin.js / preload-visualizer.js / preload-exporter.js
  shared/
    defaults.js        # default configuration + color presets
    presets.js         # preset format, built-in shaders, Shadertoy/ISF/MilkDrop import
    i18n.js            # English/Turkish translations and language detection
  admin/               # Admin Panel (control interface)
    index.html / admin.css / admin.js / settings.js
    studio.js / studio.css  # Studio editor (code editor, live preview, parameters)
    stream.js          # streaming output panel (addresses, token, clients)
    control.js         # MIDI + OSC mapping engine and panel
    media-panel.js     # webcam / video layer panel
    scenegen.js        # offline scene generator
    preview.js         # in-panel live preview (same engine as the visualizer)
  web/                 # Pages served by the streaming server
    overlay.html       # OBS browser source — same engine as the desktop
    remote.html / remote.js  # mobile remote control
    web-shim.js        # window.api bridge (WebSocket instead of IPC)
  exporter/            # Offline window that renders an audio file to MP4
  visualizer/          # Visualization screen
    index.html / visualizer.css / audio.js / visualizer.js
    modes/
      gradient.js      # WebGL fluid gradient background
      backgrounds.js   # 2D background modes (waves, aurora, starfield, grid,
                       #   bokeh, digital rain, network, pulse rings)
      backgrounds-extra.js # nebula, hex grid, ink, snow, city, corridor, spiral, mosaic
      shaderhost.js    # WebGL2 Studio engine + feedback (MilkDrop family)
      media.js         # webcam / video layer
      glow.js          # single-pass bloom helper
      extras.js        # kaleidoscope, helix, blobs, fireworks, vortex, mandala,
                       #   skyline, lightning, ripple grid, lissajous, strings,
                       #   bubbles, 3D wave, arcs, pinwheel
      bars.js centerbars.js blocks.js dots.js wave.js ribbon.js terrain.js
      circular.js radialwave.js starburst.js tunnel.js orb.js particles.js
      spectrogram.js sprites.js
scripts/
  start.js             # GUI launcher (clears ELECTRON_RUN_AS_NODE)
  gen-icons.js         # SVG -> icons
  prepare-runtime.js   # copies Node into Windows release resources
docs/screenshots/      # README images
```

Settings are saved automatically to `%APPDATA%/soundvisualizer/settings.json` on Windows;
Studio presets go to `%APPDATA%/soundvisualizer/presets/` as separate files.

### Self-test

```bash
npm start -- --smoke
```

Opens **every** registered visualizer mode and **every** background in turn, compiles all built-in
shaders on the real GPU, renders every panel category, exercises multi-display and blackout, and
finally switches the interface to English and looks for **untranslated text**. Because modes are
loaded with manual `<script>` tags (there is no bundler), forgetting to add a new mode to one of
the HTML files would be a silent failure — this test makes it loud.

---

## ⌨️ Shortcuts

| Key | Action |
|-----|--------|
| `Ctrl` + `K` | Search settings in the panel |
| `ESC` | Close the visualization on **all displays** / clear the search |
| `Tab` | Indent inside the Studio code editor |
| Click the screen | Retry if audio failed to start |

> The 🌑 **Blackout** button in the panel's top bar darkens the scene without closing it; press it
> again and the previous look (background, visualizer, logo, media) comes back exactly as it was.
> The same button exists on the mobile remote and as a MIDI/OSC action.


---

## 🗺️ Roadmap

Where the project stands against comparable applications, what has actually
**shipped**, and what was **deliberately left out** (NDI/Spout, the full MilkDrop
engine, WebGPU…) is written out plainly in [ROADMAP.md](ROADMAP.md).

---

## 📄 License

This project is licensed under the **MIT License** — see [LICENSE](LICENSE) for details.

```
Copyright (c) 2026 CaYaDev — https://cayadev.com
```

<div align="center">

---

Developed with ❤️ by **[cayadev.com](https://cayadev.com)**.

</div>
