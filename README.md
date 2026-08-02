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
to the playing **system audio** (speaker/headphone output). It consists of two panels:

- 🎛️ **Admin Panel** — the control screen where all settings are adjusted live.
- 🖥️ **Visualization Screen** — the audio-reactive visual that opens full-screen on the monitor you select.

Audio capture is performed **only from the output device** using native WASAPI/CoreAudio loopback (`audify`) —
**the microphone is never captured.**

---

## 🎬 Demo

| Audio visualizer (live) | Frequency bars (live) |
|:---:|:---:|
| ![Visualizer demo](docs/screenshots/demo-visualizer.gif) | ![Bars demo](docs/screenshots/demo-bars.gif) |

> The GIFs above were generated with a synthetic audio signal; in real use, they react directly to the music being played.

---

## 🎛️ Interface (Admin Panel)

All settings are adjusted **live** from a single screen and saved automatically — display selection, audio source,
background gradient, visualizer type, colors, logo, and performance.

<div align="center">
  <img src="docs/screenshots/admin-panel.png" alt="Admin Panel" width="820" />
</div>

---

## ✨ Visualization Modes & Styles

Four main modes, numerous color presets, rainbow/single-color options, mirroring, bottom/center/full layouts,
and soft/plasma background gradients provide a wide range of visual styles:

<table>
  <tr>
    <td align="center" width="50%">
      <img src="docs/screenshots/visualizer-bars.png" width="400" /><br/>
      <b>Bars</b> · bottom layout · rainbow · Aurora
    </td>
    <td align="center" width="50%">
      <img src="docs/screenshots/visualizer-center.png" width="400" /><br/>
      <b>Center Bars</b> · logo · Neon plasma
    </td>
  </tr>
  <tr>
    <td align="center">
      <img src="docs/screenshots/visualizer-bars-mirror.png" width="400" /><br/>
      <b>Bars</b> · mirror (bass in the center) · Ocean
    </td>
    <td align="center">
      <img src="docs/screenshots/visualizer-bars-thin.png" width="400" /><br/>
      <b>Bars</b> · centered symmetry · Ice
    </td>
  </tr>
  <tr>
    <td align="center">
      <img src="docs/screenshots/visualizer-wave.png" width="400" /><br/>
      <b>Wave</b> · thick · mirror · Sunset
    </td>
    <td align="center">
      <img src="docs/screenshots/visualizer-wave-line.png" width="400" /><br/>
      <b>Wave</b> · thin line · rainbow · Night
    </td>
  </tr>
  <tr>
    <td align="center">
      <img src="docs/screenshots/visualizer-circular.png" width="400" /><br/>
      <b>Circle</b> · logo · Lava plasma
    </td>
    <td align="center">
      <img src="docs/screenshots/visualizer-circular-rainbow.png" width="400" /><br/>
      <b>Circle</b> · rainbow · logo · Forest
    </td>
  </tr>
  <tr>
    <td align="center" colspan="2">
      <img src="docs/screenshots/visualizer-solid.png" width="500" /><br/>
      <b>Solid-color background</b> · brand-red bars
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
| macOS    | `…-darwin-arm64/`, `…-darwin-x64/` (.app), DMG (on Mac) | ⚠️ See note |

**macOS native audio note:** the native audio module (`audify`) **cannot be cross-compiled**
from Windows to macOS. The interface and visuals work in macOS `.app` packages produced on Windows,
but audio capture does not. For a fully functional macOS build, run `npm install && npm run dist:mac`
on a **Mac**. Capturing **system audio** on macOS requires a virtual audio device such as **BlackHole**
(the microphone works directly).

---

## 🖥️ Usage

1. The Admin Panel opens. Select a **Display** at the top (the second monitor is selected by default).
2. Click **▶ Open Visualizer** to start the full-screen visual on the selected display.
3. Use the cards on the right to change the visualizer type, colors, logo, and performance settings **live** —
   changes are applied immediately and saved automatically.
4. Press **ESC** on the Visualization Screen to exit.

---

## 🎨 Features

### Background — Fluid Gradient (Fog Effect)
- Audio-reactive mesh-gradient background flowing from every point (WebGL shader).
- **Two styles:** *Soft (No Glow)* — smooth, pastel mesh gradient; *Plasma (Glowing)* —
  more vivid and bright, bursting in response to audio.
- Five color points can be selected individually; **10 built-in presets** (Aurora, Sunset, Neon, Lava, Ocean,
  Forest, Pastel, Night, Ice, Single Color).
- Flow speed, scale, warp (fluidity), **audio reactivity**, base brightness, grain, and vignette.
- **Audio Burst (Brightness)** and **Audio Hue Shift** can be adjusted independently.
- A **solid-color** background is also available.

### Visualizer (Foreground Effect)
- **Bars** — each bar represents a logarithmic frequency band. Bar count, min/max frequency, gap,
  position (bottom/center/full), mirror, and peak caps.
- **Center Bars** — bars expand symmetrically upward and downward from the center of the screen. Works especially well with a logo.
- **Wave** — oscilloscope/waveform; line width, amplitude, and mirror controls.
- **Circle** — radial spectrum designed for use with a centered logo; bass pulses the center ring.
- **Rainbow** can be enabled or disabled; when disabled, a single color is used. Sensitivity and glow controls are included.

### Logo / Image
- Places an image/logo in the center; it is **automatically sized and positioned**.
- Size, opacity, glow, position (X/Y), and **audio pulse** controls.

### Audio
- **Only output audio (speaker/headphones) is captured — the microphone is NOT INCLUDED.**
- The selected **output device** is captured directly using WASAPI loopback (native `audify` module).
- Sensitivity, smoothing, bass emphasis, and live level meters (overall / bass / mid / treble).

### Power / Performance
- Frame rate (30/60/120/unlimited), background resolution scale, pause on silence, and cursor hiding.

---

## 🔊 How Audio Capture Works (Important)

Audio is captured using the **output device's WASAPI loopback** — in other words, the signal sent to the
speakers/headphones is captured directly. **The microphone is never captured.**

This is handled by a native module called `audify`. Because the native module is not distributed for Electron's ABI,
capture runs in a **separate Node child process** (`src/main/loopback-helper.js`). This process captures the audio,
calculates the FFT analysis, and sends the result to the main process.

> Windows release packages include a bundled Node runtime, so end users do not need to install Node.js separately.

**Device selection:** In the Admin Panel, select your speakers/headphones from the **Output Device** list.
"Default Output" uses the output currently active in Windows. If the list is out of date, press
**🔄 Refresh Devices**. Capture may fail if another application is holding a device in **exclusive mode**;
select another device or close that application.

---

## 📁 Project Structure

```
src/
  main/                # Electron main process
    main.js            # windows, display selection, IPC, capture lifecycle
    native-audio.js    # manages the loopback-helper child process and forwards frames
    loopback-helper.js # runs in the SYSTEM node process: audify WASAPI loopback + FFT
    preload-admin.js / preload-visualizer.js
  shared/
    defaults.js        # default configuration + color presets
  admin/               # Admin Panel (control interface)
    index.html / admin.css / admin.js
  visualizer/          # Visualization Screen
    index.html / visualizer.css / audio.js / visualizer.js
    modes/             # gradient.js, bars.js, centerbars.js, wave.js, circular.js
scripts/
  start.js             # GUI launcher (clears ELECTRON_RUN_AS_NODE)
  gen-icons.js         # SVG -> icons
docs/screenshots/      # README images
```

Settings are saved automatically to `%APPDATA%/soundvisualizer/settings.json` on Windows.

---

## ⌨️ Shortcuts

| Key | Action |
|-----|--------|
| `ESC` | Close the Visualization Screen |
| Click the screen | Retry if audio could not be started |

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
