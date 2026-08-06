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
to **system audio, microphones, and other selected audio inputs**. It consists of two panels:

- 🎛️ **Admin Panel** — the control screen where all settings are adjusted live.
- 🖥️ **Visualization Screen** — the audio-reactive visual that opens full-screen on the monitor you select.

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

## ✨ Visualization Modes & Styles

**14 visualizer modes** and **10 background types** — all of them share the same color palette,
built-in presets and your own saved presets, so switching modes never disturbs your colors.

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

1. Select a **Display** and one or more **audio sources** (system output, microphone, or other input devices).
2. Click **▶ Open Visualizer** to start the full-screen visual on the selected display.
3. Use the cards on the right to change the visualizer type, colors, logo, and performance settings **live** —
   changes are applied immediately and saved automatically.
4. Use **Video Export** to render a selected audio file as an MP4 with configurable resolution, frame rate, quality, and encoder.
5. Press **ESC** on the Visualization Screen to exit.

---

## 🎨 Features

### Background (10 types)
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
- **Solid Color** — a single flat color.

Five color stops, **10 built-in presets** (Aurora, Sunset, Neon, Lava, Ocean, Forest, Pastel, Night,
Ice, Single Color) and your own saved presets apply to every background type.

### Visualizer (14 modes)
- **Bars** · **Center** · **Segments** (LED equalizer) · **Dot Matrix**
- **Wave** (oscilloscope) · **Ribbon** (waveform history) · **Terrain** (perspective wireframe landscape)
- **Circle** · **Radial Wave** · **Rays** · **Tunnel** · **Orb**
- **Particles** (bursts on bass hits) · **Spectrogram** (scrolling heat map)
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
    main.js            # windows, display selection, IPC, capture lifecycle
    native-audio.js    # manages the loopback-helper child process and forwards frames
    loopback-helper.js # runs with the bundled/system Node runtime: audify capture + FFT
    preload-admin.js / preload-visualizer.js / preload-exporter.js
  shared/
    defaults.js        # default configuration + color presets
    i18n.js            # English/Turkish translations and language detection
  admin/               # Admin Panel (control interface)
    index.html / admin.css / admin.js / settings.js
    preview.js         # in-panel live preview (same engine as the visualizer)
  exporter/            # Offline window that renders an audio file to MP4
  visualizer/          # Visualization screen
    index.html / visualizer.css / audio.js / visualizer.js
    modes/
      gradient.js      # WebGL fluid gradient background
      backgrounds.js   # 2D background modes (waves, aurora, starfield, grid,
                       #   bokeh, digital rain, network, pulse rings)
      glow.js          # single-pass bloom helper
      bars.js centerbars.js blocks.js dots.js wave.js ribbon.js terrain.js
      circular.js radialwave.js starburst.js tunnel.js orb.js particles.js
      spectrogram.js sprites.js
scripts/
  start.js             # GUI launcher (clears ELECTRON_RUN_AS_NODE)
  gen-icons.js         # SVG -> icons
  prepare-runtime.js   # copies Node into Windows release resources
docs/screenshots/      # README images
```

Settings are saved automatically to `%APPDATA%/soundvisualizer/settings.json` on Windows.

---

## ⌨️ Shortcuts

| Key | Action |
|-----|--------|
| `Ctrl` + `K` | Search settings in the panel |
| `ESC` | Close the visualization screen / clear the search |
| Click the screen | Retry if audio failed to start |


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
