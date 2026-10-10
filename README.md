<div align="center">

<img src="assets/icon.svg" alt="CAYADEV Visualizer logo" width="120" height="120" />

# CAYADEV Visualizer

### Free, open-source music visualizer and VJ software for every screen you own

Turn whatever your computer is playing — Spotify, YouTube, a DAW, a DJ set, a game — into
audio-reactive visuals on one display or ten. A real **MilkDrop** engine, **59 visualizer modes**,
layers and **40 GPU effects**, an **OBS overlay**, **Spout / Syphon**, **projection mapping**,
**RGB lighting**, a **timeline and clip deck** for live shows, and **AI control over MCP**.

**Windows** · **macOS** · **Linux** — no account, no telemetry, MIT licensed.

[![Latest release](https://img.shields.io/github/v/release/CaYatur/SoundVisualizer?label=release&color=e11d2a)](https://github.com/CaYatur/SoundVisualizer/releases/latest)
[![Downloads](https://img.shields.io/github/downloads/CaYatur/SoundVisualizer/total?label=downloads)](https://github.com/CaYatur/SoundVisualizer/releases)
[![License: MIT](https://img.shields.io/badge/License-MIT-e11d2a.svg)](LICENSE)
[![Platform](https://img.shields.io/badge/platform-Windows%20%7C%20macOS%20%7C%20Linux-111997.svg)](#download)
[![Tests](https://img.shields.io/badge/tests-2925%20passing-2ea043.svg)](#tests)
[![Electron](https://img.shields.io/badge/Electron-43-47848F.svg)](https://www.electronjs.org/)

<a href="https://github.com/CaYatur/SoundVisualizer/releases/latest"><img src="https://img.shields.io/badge/Download-Windows-0a84ff?style=for-the-badge" alt="Download for Windows" /></a>
<a href="https://github.com/CaYatur/SoundVisualizer/releases/latest"><img src="https://img.shields.io/badge/Download-macOS-1f1f1f?style=for-the-badge&logo=apple&logoColor=white" alt="Download for macOS" /></a>
<a href="https://github.com/CaYatur/SoundVisualizer/releases/latest"><img src="https://img.shields.io/badge/Download-Linux-f0b400?style=for-the-badge&logo=linux&logoColor=black" alt="Download for Linux" /></a>

**[Run from source](#run-from-source)** ·
**[Features](#features-in-detail)** ·
**[FAQ](#faq)** ·
**[Türkçe](README.tr.md)**

<img src="docs/screenshots/hero.gif" alt="CAYADEV Visualizer showreel: a MilkDrop preset, a tunnel, a 3D Lorenz attractor, a music video layout, synthwave and a drum &amp; bass honeycomb, all reacting to music" width="800" />

</div>

---

## At a glance

<div align="center">

| **59** visualizer modes | **43** backgrounds | **40** GPU effects | **18** scene transitions |
|:---:|:---:|:---:|:---:|
| **81** ready-made scenes | **98** formulas + **13** 3D solids | **42** built-in GLSL shaders | **58** colour palettes |
| **10,347** MilkDrop presets tested | **96** MCP tools for AI agents | **17** layer blend modes | **2** languages (EN / TR) |

</div>

> **About the version labels.** The current release is **v3.1.4**. Everything on this page is in
> the source on `main`; items marked <kbd>3.1.5</kbd> ship with the next release, v3.1.5, and are
> not in the v3.1.4 download yet. Run from source to use them today.

---

## Why CAYADEV Visualizer

- **No Stereo Mix, no virtual cable on Windows.** System audio is captured straight from your
  speakers or headphones (WASAPI loopback), alongside microphones and line inputs — or from **one
  application only**, so the visuals follow Spotify and ignore the game and the voice chat.
  [→ Audio](#audio-capture-and-analysis)
- **Every screen, one engine.** Full-screen windows on every display you pick, a transparent
  **OBS browser source**, **Spout / Syphon** for Resolume, TouchDesigner and MadMapper, and a
  **phone remote** — all drawing the same picture. [→ Outputs](#outputs-screens-obs-spout-and-syphon)
- **MilkDrop that really runs your presets.** Per-frame and per-pixel equations, the warp mesh,
  HLSL shaders translated to GLSL, measured against **10,347 real presets** and frame by frame
  against a reference MilkDrop 2 renderer. Import whole libraries, browse them as thumbnails, edit presets live,
  or generate new ones <kbd>3.1.5</kbd>. [→ MilkDrop](#milkdrop)
- **A compositor, not a single effect.** Unlimited layers, 17 blend modes, masks, an A/B
  crossfader, 40 GPU effects per layer or on the whole frame, and a modulation matrix that routes
  LFOs, envelopes and live audio analysis to any setting. [→ Layers](#layers-masks-and-effects)
- **Built for live shows.** A **timeline** with automation lanes, a **clip deck** with beat-quantised
  launching, **Auto VJ** that changes scenes on the bar, tap tempo, **MIDI** and **OSC**.
  [→ Show control](#show-control-timeline-clip-deck-auto-vj-midi-and-osc)
- **Ready for the stage.** Projection mapping with corner pin, mesh warp and soft-edge blending
  for multi-projector rigs, plus **aspect correction** for LED walls whose pixels are not square.
  [→ Stage](#stage-projection-mapping-and-aspect-correction)
- **Your lights follow the music.** **Windows Dynamic Lighting**, **OpenRGB** on every platform and
  **Art-Net / DMX**, all fed by one renderer — they can even take their colours from the MilkDrop
  picture <kbd>3.1.5</kbd>. [→ Lighting](#rgb-lighting-dynamic-lighting-openrgb-and-art-net)
- **For creators.** Frame-exact **offline video export** from an audio file, one-key recording,
  music-video layouts, a **Now Playing** overlay with album art, and synced **lyrics** (LRC / SRT).
  [→ Export](#recording-and-video-export)
- **AI-ready.** A local **MCP server** with 96 tools lets Claude, Codex, Cursor and other agents
  read the show, build scenes and run the outputs — behind five permission levels, on `127.0.0.1`
  only <kbd>3.1.5</kbd>. [→ MCP](#mcp--control-from-an-ai-agent)
- **Private and offline.** No account, no telemetry, no cloud. The only call the application
  makes on its own is GitHub's latest-release check, and you can switch it off.
  [→ Privacy](#privacy-and-security)

---

## Gallery

<div align="center">

| | |
|:---:|:---:|
| ![MilkDrop preset Aurora](docs/screenshots/scene-milkdrop.png) | ![Hyper Tunnel](docs/screenshots/scene-tunnel.png) |
| ![Lorenz attractor in 3D](docs/screenshots/scene-lorenz.png) | ![Plasma](docs/screenshots/scene-plasma.png) |
| ![Synthwave](docs/screenshots/scene-synthwave.png) | ![Klein bottle](docs/screenshots/scene-klein.png) |
| ![Music video layout: Label Card](docs/screenshots/scene-broadcast-label.png) | ![Now Playing with album art](docs/screenshots/scene-nowplaying.png) |

| Hyper Tunnel | 3D attractor |
|:---:|:---:|
| ![Tunnel](docs/screenshots/demo-tunnel.gif) | ![Geometry](docs/screenshots/demo-geometry.gif) |
| **Drum & Bass** | **MilkDrop feedback** |
| ![Drum and bass template](docs/screenshots/demo-dnb.gif) | ![MilkDrop](docs/screenshots/demo-milkdrop.gif) |

</div>

### Classic looks

The spectrum bars, waves and rings the application started with — still one click away, on
fluid gradient backgrounds that move with the music.

<div align="center">

| Layered scene | Frequency bars | Circular |
|:---:|:---:|:---:|
| ![Rainbow centre bars around a logo on a cyan and violet gradient](docs/screenshots/demo-visualizer.gif) | ![Rainbow frequency bars on a soft gradient](docs/screenshots/demo-bars.gif) | ![Circular spectrum with a logo](docs/screenshots/demo-circular.gif) |
| **Mirrored bars** | **Wave** | **Sunset wave** |
| ![Mirrored bars on an ocean gradient](docs/screenshots/demo-mirror.gif) | ![Rainbow waveform on a night gradient](docs/screenshots/demo-wave.gif) | ![Warm mirrored waveform on a sunset gradient](docs/screenshots/demo-sunset.gif) |

</div>

> Every scene image and clip on this page is rendered by the application itself with
> `npm start -- --shots`, driven by a synthetic 120 BPM signal. With real audio the visuals follow
> the music instead.

---

## Quick start

### Download

Get the latest build from **[Releases](https://github.com/CaYatur/SoundVisualizer/releases/latest)**.

| Platform | File | Notes |
|---|---|---|
| **Windows 10 / 11** | `…-windows-setup.exe` | Recommended. Registers the Dynamic Lighting identity so lights keep running in the background, and can update itself. |
| Windows, portable | `…-windows-portable.exe` | No installation. Dynamic Lighting works only while the app is focused. |
| **macOS** (Apple Silicon) | `…-macos-arm64.dmg` / `.zip` | Unsigned — see [macOS first launch](#macos-first-launch). System audio needs a virtual device such as BlackHole. |
| **Linux** (x64) | `…-linux-x86_64.AppImage` / `…-linux-amd64.deb` | Needs PulseAudio or PipeWire. The AppImage can update itself <kbd>3.1.5</kbd>. |

Nothing else needs to be installed: the audio helper runs on the application's own binary.

### First run

1. Pick one or **several** displays from the **Displays** menu at the top, then one or more
   **audio sources** under **Audio**.
2. Click **Open Visualizer**. The visual opens full-screen on every selected display.
3. Change anything on the right — it applies immediately and saves itself.
4. Or start from a finished look: **Library → Templates** has 81 of them.
5. For streaming, turn on **Output → Streaming Output** and paste the address into an OBS
   **Browser Source**.
6. Press **ESC** on any visualization window to close them all.

### Run from source

You need **[Node.js](https://nodejs.org/) 20 or newer** (CI tests 20 and 22) and Git.

```bash
git clone https://github.com/CaYatur/SoundVisualizer.git
cd SoundVisualizer
npm install
npm start
```

`npm install` rebuilds the native `audify` audio module for Electron automatically (`postinstall`).
If the audio helper reports `INVALID_HELPER_OUTPUT`, run `npm run rebuild:audio`, then
`npm run check:runtime`. Behind a corporate proxy that breaks certificates, set
`NODE_OPTIONS=--use-system-ca` before `npm install`. Developer mode with DevTools: `npm run dev`.

---

## Who it is for

| You are… | What you get |
|---|---|
| **A streamer** | A transparent overlay for OBS as a browser source, a Now Playing card with album art, lyrics, and a phone remote to change scenes mid-stream. Runs on one PC while OBS runs on another. |
| **A VJ or live performer** | A timeline, a clip deck with beat-quantised launching, Auto VJ on the bar, MIDI and OSC control, blackout, Spout/Syphon into Resolume or TouchDesigner, and full-screen output on every projector. |
| **A music producer or label** | Frame-exact video export from your track, eight restrained music-video layouts with your logo and the track title, and a recorder for the live output. |
| **A venue, event or installation** | Projection mapping, edge blending, aspect correction for LED walls, accidental-close protection, crash recovery, and a display that never goes to sleep mid-show. |
| **An RGB or ambient lighting fan** | Windows Dynamic Lighting, OpenRGB and Art-Net/DMX driven by the music, with a screen-saver-style template group for background visuals. |
| **A MilkDrop fan** | A MilkDrop engine that loads `.milk` and `.milk2`, imports whole libraries, shows thumbnails, keeps favourites, ratings and tags, and lets you edit or generate presets. |
| **A developer or AI tinkerer** | A GLSL editor with Shadertoy and ISF import, an MCP server with 96 tools, a documented config, and 2,700+ tests that check answers rather than lines. |

---

## Features in detail

The sections above are the short version. Everything below is the full list, by category.

- [Audio capture and analysis](#audio-capture-and-analysis)
- [Visualizer modes and backgrounds](#visualizer-modes-and-backgrounds)
- [MilkDrop](#milkdrop)
- [Layers, masks and effects](#layers-masks-and-effects)
- [Modulation](#modulation)
- [3D geometry and formulas](#3d-geometry-and-formulas)
- [Studio — write your own shader](#studio--write-your-own-shader)
- [Scenes, templates, transitions and colour](#scenes-templates-transitions-and-colour)
- [Text, lyrics and Now Playing](#text-lyrics-and-now-playing)
- [Logo, images and the media layer](#logo-images-and-the-media-layer)
- [Show control: timeline, clip deck, Auto VJ, MIDI and OSC](#show-control-timeline-clip-deck-auto-vj-midi-and-osc)
- [Outputs: screens, OBS, Spout and Syphon](#outputs-screens-obs-spout-and-syphon)
- [Stage: projection mapping and aspect correction](#stage-projection-mapping-and-aspect-correction)
- [RGB lighting: Dynamic Lighting, OpenRGB and Art-Net](#rgb-lighting-dynamic-lighting-openrgb-and-art-net)
- [Recording and video export](#recording-and-video-export)
- [MCP — control from an AI agent](#mcp--control-from-an-ai-agent)
- [The control panel](#the-control-panel)
- [Reliability, power and updates](#reliability-power-and-updates)
- [Privacy and security](#privacy-and-security)

---

### Audio capture and analysis

<div align="center">

| Live meters | Chroma wheel |
|:---:|:---:|
| ![Deep analysis panel](docs/screenshots/panel-analysis.png) | ![Chroma wheel](docs/screenshots/scene-chroma.png) |

</div>

**Sources**

- **System output** — speaker or headphone loopback. No "Stereo Mix" needed.
- **Microphones and line inputs**, captured the same way.
- **Single applications** (Windows) — WASAPI process loopback. Capture only the chosen apps, or
  everything *except* one. Targets are stored by executable name, so a restarted app reattaches by
  itself, and an app that is not running yet is picked up when it starts. Needs Windows build
  20348 or newer. macOS and Linux report why it is not available there yet.
- **Several sources at once**, mixed before analysis — "Spotify + microphone" is one selection.
- **Both channels reach the visuals** <kbd>3.1.5</kbd>. Each frame carries the left and right
  channels next to the mono mix, so stereo width, correlation and the Goniometer measure the real
  stereo image. Until v3.1.5 the capture helper averaged the two channels away: width sat at 0,
  correlation at 1, and the Goniometer drew a vertical line for every song.
- **Recovers by itself** <kbd>3.1.5</kbd>. If the capture helper exits or its frames stop (sleep and
  resume, a device unplugged), capture is rebuilt with a growing back-off, and the panel says
  "reconnecting" instead of pretending to capture. A device that drops in and out is not retried in
  a tight loop.
- **Sensitivity, smoothing and bass emphasis**, a mains-hum guard for 50/60 Hz, and live meters for
  overall, bass, mid and treble.

**How capture works.** Capture runs in the **main process**, not in the browser window. A helper
reads the device — WASAPI loopback on Windows, CoreAudio on macOS, PulseAudio or PipeWire on Linux
— computes the FFT, and sends frames to every renderer.

- On **macOS**, system audio needs a virtual device such as **BlackHole**; microphones work
  directly. macOS has no loopback of its own, so there is no way around this.
- On **Linux**, system audio is the PulseAudio or PipeWire **monitor** of your output device. It is
  an *input* device; the application marks it as loopback and prefers it by default.

**Spectrum metering.** Bars are measured, not guessed.

- **Frequency scale** — logarithmic, linear, mel or bark.
- **Amplitude scale** — linear or decibel, with a settable floor from −24 to −96 dB. dB is what
  makes quiet detail visible instead of flattened against the baseline.
- **Ballistics** — separate attack and release, so bars snap up and fall smoothly. Frame-rate
  independent.
- **Neighbour spread** (widens peaks without flattening them) and **profile smoothing** (a symmetric
  neighbour average).
- **Spectral tilt** in dB per octave, neutral at 1 kHz, so the top end is not permanently dead.
- Bands narrower than one FFT bin are interpolated at the band's centre frequency, so neighbouring
  bars read their own values instead of sharing one bin. 27 tests cover the engine, including one
  that asserts the bar profile has no step in it.

**Deep analysis.** Every measurement has a live meter and is available as a modulation source.

- **Musical key and chord** from a constant-Q chroma vector — a Goertzel filterbank rather than FFT
  bins, because at 2048 samples the bass register is not resolvable by bins — with
  Krumhansl-Schmuckler key profiles and chord templates.
- **Pitch tracking** with YIN.
- **Harmonic / percussive separation**, and per-band onset detectors for kick, snare and hat.
- **Spectral descriptors** — centroid, rolloff, flatness, crest.
- **Loudness, dynamics, true peak, stereo width, correlation and mid/side bands.**
- Silence detection, auto-gain, and a rolling spectral history buffer.

**Tempo.** BPM is estimated from a period histogram (tested to ±0.5 BPM against 90, 120, 128, 140
and 174 BPM signals), with tap tempo and a BPM lock shared by Auto VJ, the clip deck and MilkDrop.

---

### Visualizer modes and backgrounds

<div align="center">

**All 59 visualizer modes**

![Every visualizer mode](docs/screenshots/modes-visualizer.jpg)

**All 43 backgrounds**

![Every background](docs/screenshots/modes-background.jpg)

</div>

These two sheets are generated from the mode catalogue itself, so a new mode appears in them the
next time the screenshots are rendered. Any visualizer can sit on any background, and with layers
you can stack as many of each as you like. Modes added since v3.1.4 are part of <kbd>3.1.5</kbd>.

**Visualizer modes — 59**

- **Basic** — Bars · Center · Blocks (LED equaliser) · Dot Matrix · City Skyline (buildings with lit
  windows)
- **Waveform** — Wave (oscilloscope) · Ribbon (waveform history) · 3D Wave (history stacked in
  perspective) · Lissajous (XY oscilloscope) · Strings (each string vibrates with its band) · Terrain
  (perspective wireframe landscape) · Ridgelines · DJ Waveform
- **Radial** — Circle · Radial Wave · Starburst · Arcs (one arc per band) · Pinwheel · Mandala (polar
  rose curve) · Kaleidoscope · Vortex · Helix · Tunnel · Orb · Radar Chart
- **Particles and events** — Particle · Fireworks (bursts on the beat) · Lightning (branching bolts
  on bass) · Bubbles · Liquid Drop (metaballs) · Ripple Grid (rings spreading on the beat) ·
  Spectrogram · Confetti · Beat Pads · Bouncing Balls
- **Generative systems** — Flow Field (particles steered by a noise field) · Flock (boids driven by
  the spectrum) · Voronoi · Truchet · Moiré · Wave Interference · Ropes (verlet physics kicked by
  onsets) · Galaxy · DNA Helix · Isometric City · Attractor Field (discrete maps from the formula
  library with two parameters bound to audio) · Pendulum Wave · Cardioid
- **Text** — Text / Lyrics · Now Playing
- **Metering** — Oscilloscope (XY) · Goniometer (stereo phase scope) · Chroma Wheel (pitch classes in
  circle-of-fifths order, highlighting the detected chord root) · VU Meter · Level Meter (PPM)
- **Advanced engines** — 3D Geometry · MilkDrop · Feedback (the classic infinite-tunnel feedback
  look) · Studio (your own GLSL shader)

Bar count, minimum and maximum frequency, gap, placement (bottom, centre or full), mirror, line
width, amplitude, sensitivity and glow appear whenever they mean something for the selected mode.
Colour comes from the scene palette, a custom colour pair, or **rainbow**.

**Backgrounds — 43**

- **Fluid** — Fluid Gradient (an audio-reactive mesh gradient with flow, wander, orbit, swirl, warp,
  grain and audio hue shift) · Ink (liquid blobs that swirl as they flow) · Nebula (soft gas clouds)
  · Wave Layers (crests that swell with the audio) · Northern Lights (undulating curtains) · Lava
  Lamp · Underwater
- **Geometric** — Retro Grid (a perspective grid to the horizon) · Honeycomb Grid (cells lit by a
  wave from the centre and by the spectrum) · Mosaic (a cell per frequency band) · Corridor (rings
  or polygons coming toward you) · Spiral · Pulse Rings (extra rings on bass hits) · Network
  (drifting linked nodes) · Low Poly · Halftone · Isometric Cubes
- **Atmosphere** — Starfield · Snow / Embers · Light Particles (bokeh) · Digital Rain · City (a
  parallax skyline whose windows light up with the music) · Clouds · Stage Lights · Fireflies ·
  Storm
- **Generative grounds** — Liquid Metal · Plasma · Caustics · Ribbons · Contours · Wave Field ·
  Embers · Sand · Stained Glass · Circuit Board · Prism · Globe Mesh · Wire Tunnel · Hex Pulse ·
  Mirror Pattern
- **Other** — Solid Colour · Studio (a GLSL shader you wrote yourself)

**Transparent background.** Turn on **Background → Transparent Background** and the desktop shows
through the visualizer window: a solid colour is not painted, and a background effect's dark parts
turn transparent below a **Transparency Threshold**. Transparency survives the effect chain, so
bloom and blur glow over empty pixels without turning the window into a black rectangle.

---

### MilkDrop

<div align="center">

| Preset library with thumbnails <kbd>3.1.5</kbd> | Live preset editor <kbd>3.1.5</kbd> |
|:---:|:---:|
| ![MilkDrop panel](docs/screenshots/panel-milkdrop.png) | ![MilkDrop preset editor](docs/screenshots/panel-mdedit.png) |

</div>

A MilkDrop engine written for this application — it does not embed projectM or MilkDrop's code.
The preset language runs for real: a tokeniser, a parser and compilation to JavaScript closures;
`per_frame` and `per_pixel` equations drive a warp mesh with feedback; the HLSL warp and composite
shaders are translated to GLSL and run on the GPU.

- **Measured, not claimed.** Over a 10,347-preset corpus from the projectM original and
  cream-of-the-crop packs, every preset loads and runs, all 16,346 shader stages compile, and about
  98% produce a live image. Fidelity is checked frame by frame against a reference renderer built
  from BeatDrop's MilkDrop 2 sources. Both harnesses are in `scripts/`, so the numbers can be reproduced.
- **A MilkDrop Fidelity switch** follows MilkDrop 2's own rules — its compiler, its audio chain, its
  mesh transform, its default values and its fixed-function pipeline. The details are in
  [MilkDrop engine notes](#milkdrop-engine-notes) at the end of this page.
- **Five presets of our own ship with the app** — *Aurora*, *Molten Gold*, *Still Rings*, *Endless
  Tunnel* and *Pulse Weave* — so the engine shows what it does before you import anything. No
  third-party preset pack is bundled.
- **Import a whole library** <kbd>3.1.5</kbd> — from a ZIP pack, a folder, or by searching this
  computer (Winamp, foobar2000 and projectM folders, Downloads, Desktop, Music, Documents). You see
  what will be added before anything is copied; duplicates are skipped; textures come along; folder
  names can become tags. A 9,795-preset folder imports in about six seconds.
- **`.milk` and `.milk2`** <kbd>3.1.5</kbd> — MilkDrop 3's double presets load as a frozen blend of
  their two presets, and a *Preset Format* setting reads files with MilkDrop 2 or MilkDrop 3 rules
  (16 custom waves and shapes, `q1`–`q64`), or picks automatically.
- **Thumbnails** <kbd>3.1.5</kbd> — a *Grid* layout shows each preset as a small picture, drawn once
  in the background and redrawn only when the preset or a texture it uses changes.
- **Favourites, tags, ratings and search by author** <kbd>3.1.5</kbd> — `author:geiss` finds Geiss's
  presets, `#calm` finds a tag; random order is weighted by rating as MilkDrop weights it; Previous
  and Next walk a 64-step history of what was actually shown.
- **A live editor** <kbd>3.1.5</kbd> — frame and pixel equations, waves, shapes, warp and composite
  shaders each have a tab; a change shows in the running picture a moment after you stop typing;
  errors point at the preset's own line. The original is never changed.
- **A preset generator and mash-ups** <kbd>3.1.5</kbd> — write an original preset from four sliders
  (energy, warmth, density, motion) and a seed that brings the same preset back, or build one from
  parts of the presets you already have. Generated presets never flash.
- **Show control** <kbd>3.1.5</kbd> — auto advance by seconds or **on the bar**, hard cuts on loud
  moments, *next preset on track change*, a lock, and MilkDrop actions on MIDI and OSC. Every screen
  shows the same preset with the same random seed.
- **User textures and sprites** <kbd>3.1.5</kbd> — point at a MilkDrop `textures` folder, and launch
  `milk_img.ini` sprites with MilkDrop's own keys or from a controller.
- **Safe to watch** <kbd>3.1.5</kbd> — flash limiting at WCAG 2.3.1's general-flash value, held per
  second so a 144 Hz screen is as safe as a 30 fps one, and the system's *reduce motion* setting
  is honoured.
- **Survives a GPU reset** <kbd>3.1.5</kbd> — a lost WebGL context is rebuilt on the same canvas,
  and the running preset carries on with the same equation state and clock.

The **Feedback** engine is MilkDrop's family resemblance without presets: zoom, rotate, warp and
decay sliders, four wave styles, and bass-driven zoom and rotation for the classic infinite tunnel.

---

### Layers, masks and effects

<div align="center">

| Layers | Effect chain |
|:---:|:---:|
| ![Layers panel](docs/screenshots/panel-layers.png) | ![Effects panel](docs/screenshots/panel-effects.png) |

</div>

- **Unlimited layers**, each with its own source, blend mode, opacity, transform (scale, rotate,
  X/Y, flip) and audio response (band, opacity, scale, rotate). The layer at the top of the list is
  the topmost one in the output.
- **17 blend modes** — Normal, Add, Screen, Multiply, Overlay, Darken, Lighten, Colour Dodge, Colour
  Burn, Hard Light, Soft Light, Difference, Exclusion, Hue, Saturation, Colour, Luminosity.
- **Masks** — alpha from another layer, plus rectangle, ellipse, linear and radial gradients, with
  position, size, angle, feather and invert.
- **Groups** with a single fader, and an **A/B crossfader** on an equal-power curve.
- **Solo, mute and lock** — solo isolates a layer reversibly, mute hides one without losing its
  settings, lock prevents accidental edits.
- Copy, paste and duplicate layers across scenes. The whole stack can be switched off, returning
  to the plain Background plus Visualizer setup without losing the list.
- **One broken layer no longer takes the frame with it** <kbd>3.1.5</kbd>, and layers hidden under
  an opaque MilkDrop layer are not drawn at all.

**Post-processing — 40 GPU effects**, orderable, each with its own opacity, toggleable, and
available per layer as well as on the composite. An effect on a single layer keeps that layer's
transparency, so the layers below stay visible.

- **Composition** — Bloom · Vignette · Trails / Echo · Edge Highlight · Colour Grade
- **Blur and focus** — Gaussian Blur · Radial Blur · Directional Blur · Zoom Blur · Tilt-Shift ·
  Depth of Field (Bokeh) · Sharpen · Emboss
- **Halftone and pattern** — Dither (Bayer) · Halftone · ASCII Mosaic · Cross-Hatch (Pen) · Oil Paint
  (Kuwahara) · Pixelate · Posterize / Invert · Threshold · Solarize
- **Analogue and damage** — Film Grain · CRT / Scanlines · VHS / Analogue Tape · Glitch (Slice Shift)
  · Datamosh (Block Shift) · Bad Signal · Chromatic Aberration
- **Distortion** — Lens Distortion · Twirl · Polar Transform · Ripple Distortion · Slit-Scan ·
  Kaleidoscope · Mirror
- **Colour and light** — Gradient Map · Levels & Curve · God Rays · Star Filter

Any parameter of any effect can be driven by the modulation matrix.

---

### Modulation

<div align="center">

![Modulation matrix](docs/screenshots/panel-modulation.png)

</div>

- **Any source to any setting** — routes go to any dotted configuration path, chosen from a live
  tree of the current settings.
- **Sources** — bass, mid, treble, level, onset envelope and onset trigger · eight spectrum bands ·
  LFOs · envelope followers · sample-and-hold · random · the beat clock · macro knobs · and every
  deep-analysis measurement (key, chord, pitch, loudness, drum bands…).
- **Eight LFO shapes** — sine, triangle, saw up, saw down, square, pulse, random ramp and noise —
  with rate in Hz or in beat divisions (1/16 up to 8 bars) locked to the detected tempo, plus phase
  offset and pulse width.
- **Per-route shaping** — minimum, maximum, amount, set or add, a curve (linear, exponent, S-curve,
  quantise, invert), smoothing and slew limiting.
- **Eight macro knobs**, exposed to MIDI learn.
- Values are applied copy-on-write, so modulation never alters your saved settings, and LFO phase
  comes from the draw clock, so offline export is frame-exact.

---

### 3D geometry and formulas

<div align="center">

| | |
|:---:|:---:|
| ![Klein bottle](docs/screenshots/scene-klein.png) | ![Trefoil knot tube](docs/screenshots/scene-knot.png) |
| ![Lorenz attractor](docs/screenshots/scene-lorenz.png) | ![Chladni figure](docs/screenshots/scene-chladni.png) |

![3D geometry panel](docs/screenshots/panel-geometry.png)

</div>

- **Plane curves (30)** — rose curves, lemniscates, cardioids, epicycloids, hypocycloids, spirals,
  roulettes, Lissajous figures, butterfly and superformula curves among them.
- **Space curves (12)** — trefoil and torus knots, Viviani's curve, helices, conical spirals and
  similar.
- **Surfaces (29)** — torus, Klein bottle, Möbius strip, Boy's surface, Dini's surface, breather,
  superellipsoid, Gielis supershapes, Chladni figures, trefoil tube and more.
- **Strange attractors (27)** — Lorenz, Rössler, Chen, Halvorsen, Thomas, Aizawa, Chua, Dadras,
  Sprott, Clifford, de Jong, Hénon and others, continuous and discrete.
- **Solids (13)** — tetrahedron, cube, octahedron, dodecahedron, icosahedron, a geodesic sphere with
  subdivision control, four L-systems (tree, fern, dragon curve, 3D Hilbert curve) and three iterated
  function systems (Barnsley fern, Sierpinski tetrahedron, spiral).
- Render as wireframe, points or shaded, with resolution, deformation, spin, colour mode and audio
  binding on every parameter.
- **Own matrix maths** — no third-party 3D library. **Framing is measured, not declared**: the first
  iterations of an attractor are probed for their bounding box, and a test asserts every system
  lands inside the view volume.

---

### Studio — write your own shader

<div align="center">

| Studio | Built-in shaders |
|:---:|:---:|
| ![Studio](docs/screenshots/panel-studio.png) | ![Caustics](docs/screenshots/scene-caustics.png) |

</div>

- **A GLSL editor** with live preview, error line reporting and sliders you declare yourself.
- **Shadertoy and ISF import** through local converters. No service is contacted.
- Shaders receive `sv_resolution`, `sv_time`, `sv_level`, `sv_bass`, `sv_mid`, `sv_treble`,
  `sv_beat`, `sv_spec(x)`, `sv_waveAt(x)`, `sv_col(x)` for the scene palette, and `sv_media` for the
  camera or video layer.
- **42 built-in shaders**, all compiled on a real GPU by the self-test:
  - **Backgrounds (25)** — Cloud Layers · Curl Flow · Lava Lamp · Ink Bleed · Smoke Rings · Hex Flow
    · Warped Grid · Truchet Weave · Moiré Interference · Crystal Cave · Mandelbrot Zoom · Julia Set ·
    Burning Ship · Apollonian Gasket · Kaleidoscopic IFS · Menger Sponge · Mandelbulb · Light Tunnel
    · Star Warp · Aurora Curtain · Liquid Metal · Neon Rain · Reaction Pattern · Water Caustics ·
    Prism Glow
  - **Visualizers (11)** — Glowing Bars · Spectrum Ring · Wave Field · Beat Burst · Glowing
    Oscilloscope · Frequency Mesh · Note Ring · Particle Flow · Kaleidoscope Spectrum · Pulse Grid ·
    Liquid Bars
  - **Six earlier presets** — Plasma Sea, Frequency Rings, Liquid Metal, Star Gate, Wave Curtain,
    Bass Sphere
- **MilkDrop Preset Generator and Editor** live here too — see [MilkDrop](#milkdrop).

---

### Scenes, templates, transitions and colour

<div align="center">

| Templates | Scene transitions |
|:---:|:---:|
| ![Templates](docs/screenshots/panel-templates.png) | ![Transitions](docs/screenshots/panel-transition.png) |

| | |
|:---:|:---:|
| ![Aurora](docs/screenshots/scene-aurora.png) | ![Drum and bass](docs/screenshots/scene-dnb.png) |
| ![Gala](docs/screenshots/scene-gala.png) | ![Stained glass](docs/screenshots/scene-stained.png) |

</div>

**Scenes** store the whole look — background, visualizer, layers, effects, logo, text, modulation,
MilkDrop and visual objects — under a name. Restore with one click, update from the current look,
export and import as JSON.

**81 templates in ten groups.** One click, and your audio device, display selection, streaming
and lighting settings are left alone — trying a template must not damage a working setup, and a
test asserts it.

- *Club (8)* — Strobe Wall, Hyper Tunnel, Laser Grid, Mandala Drop, Strobe Floor, Fireworks,
  MilkDrop Flow, Strange Attractor
- *Ambient (9)* — Aurora, Ink in Water, Topography, Underwater, Embers, Liquid Metal, Night Globe,
  Flow Field, Interference
- *Streaming (6)* — Corner Bars, Clean Wave, Ring Meter, Scope Overlay, Lower Third, Studio Meters
- *Music Video (11)* — Label Card, Artwork Card, Baseline Bars, Amber Room, Minimal White, Quiet
  Frame, Corner Meter, Centre Strip, Wave Card, Cover Ring, Stage Card. The cover, title and artist
  come from one Now Playing layer, so the cover sits beside the text at the same gap in every
  aspect ratio; in the admin preview the card shows placeholder text until a track plays.
- *Music Backdrop (6)* — Aurora Backdrop, Flow Backdrop, Nebula Backdrop, MilkDrop Backdrop, Galaxy
  Backdrop, Soft Glow: a plain, dimmed visualizer behind the track card while music plays
- *Music (6)* — Chroma Wheel, Helix, Silk Ribbons, Strings, Spectrogram, Galaxy
- *Screensaver (6)* — Plasma, Stained Glass, Circuit, Wire Tunnel, Dunes, Prism
- *3D Geometry (8)* — Klein Bottle, Lorenz, Supershape, Trefoil Tube, Chladni, Rose Curve, Chua
  Circuit, Möbius
- *Genre (16)* — Techno, House, Drum & Bass, Hip-Hop, Lo-Fi, Synthwave, Rock, Metal, Jazz,
  Classical, Ambient, Pop, Trance, Dubstep, Chiptune, Experimental
- *Event (5)* — Minimal Line, Corporate, Gala, Festival, Projection Test

**Music video layouts.** Restrained layouts for release videos and official channels, deliberately
separate from the club material: bar placement as a fraction of the frame, a plain ground with no
grain, and the cover, title and artist as one card. The cover sits beside the text at the same gap
in every aspect ratio, and the bars share the card's margin.

<div align="center">

| | |
|:---:|:---:|
| ![Label Card](docs/screenshots/scene-broadcast-label.png) | ![Minimal White](docs/screenshots/scene-broadcast-minimal.png) |
| ![Baseline Bars](docs/screenshots/scene-broadcast-line.png) | ![Amber Room](docs/screenshots/scene-broadcast-amber.png) |
| ![Cover Ring](docs/screenshots/scene-broadcast-ring.png) | ![Stage Card](docs/screenshots/scene-broadcast-stage.png) |

</div>

**Scene Generator.** Builds a scene from a description. It is **not** a neural network and is not
presented as one: it reduces the text to four axes with a weighted keyword dictionary and seeds a
deterministic generator from them. It runs entirely offline.

**18 scene transitions** — Cut · Crossfade · Dissolve · Wipe · Radial · Clock · Barn · Blinds ·
Stripes · Checker · Iris · Luma (keyed on the outgoing frame's own luminance) · Zoom · Push · Slide ·
Flash · Glitch · Blur. Six easing curves, a duration in seconds or in beats, and a switch to turn
them off. They fire on a change of *scene*, never on a slider, so dragging a control never starts
one.

**Colour.** Five colour stops, **58 built-in palettes** in seven groups (Classics, Warm, Cool, Neon &
Cyber, Dark, Light, Monochrome Families) and your own saved palettes apply to every background, to
Studio and to the 3D engine. Every visualizer can follow the palette (*theme* colour mode).

**Dynamic colour theme (Windows).** The palette can follow the playing track: colours extracted
from the album cover, a harmony style (analogous, complementary, triadic, cyberpunk, synthwave,
aurora…), the mood of the title, or a cycle through presets — applied to the background, the
visualizer, or both.

---

### Text, lyrics and Now Playing

<div align="center">

| Now Playing | Text |
|:---:|:---:|
| ![Now Playing with album art](docs/screenshots/scene-nowplaying.png) | ![Audio-reactive text](docs/screenshots/scene-text.png) |

</div>

**Now Playing.** On Windows the application reads the system media session (SMTC), so the track
from Spotify, YouTube Music, a browser or most players appears on screen by itself: title, artist,
album, elapsed and remaining time, a progress bar and the album cover. It can stay on screen or
appear only when the track changes, with seven animations and *Modern* and *OG* styles. On macOS
and Linux the title, artist and cover are entered by hand. Now Playing also shows in the panel
preview and in exported videos <kbd>3.1.5</kbd>.

**Text.** Audio-reactive typography with per-character response (scale, jitter, lift) · font,
weight, size, alignment, position, opacity, outline and shadow · animation presets · marquee and
ticker · karaoke highlighting.

**Lyrics.**

- **LRC and SRT import**, the format detected from the content, enhanced LRC word timings supported.
- **A timing editor** with a sync offset that writes back to LRC.
- **Play, pause and stop** for a loaded lyrics file while the screens are open; all screens and the
  OBS overlay share one clock, corrected to the machine running the app.
- **Lyrics library (Windows)** <kbd>3.1.5</kbd> — keep many LRC or SRT files, each with an artist and
  a title. **Follow the Playing Track** finds the right file for the song from the system media
  session and moves with seek and pause. **Exact Match** or **Partial Match** for small spelling
  differences; timed lyrics from the player are used when the library has no match. Files open in a
  tall editor with colouring for timestamps, word times and tags; removing one asks first. Nothing
  is fetched from the network.

---

### Logo, images and the media layer

- **Logo** — an image placed anywhere in the frame, automatically sized, with size, opacity, glow,
  position and audio pulse; animated GIFs play. The logo can also show the **album cover of the
  playing track**. Applying a template keeps your logo and only changes its placement.
- **Logo and video libraries** <kbd>3.1.5</kbd> — imported files are copied into the app's own
  folder and referenced by id, so the settings file stays small and a moved original does not break
  a scene.
- **Visual objects** — image sprites in front of or behind the visualizer, with count, size, drift,
  rotation and audio response.
- **Media layer** — a webcam or a video file, in front of or behind the visualizer, with fit (cover,
  contain, stretch), mirror, kaleidoscope with 3–12 slices, hue shift, saturation, blend mode,
  opacity, and audio-driven zoom and opacity. The same frame is readable inside Studio shaders as
  `sv_media`.
- **Smooth on every output** <kbd>3.1.5</kbd> — videos are decoded on the CPU by default, so they
  play at full frame rate in full-screen windows and in the Spout/Syphon feed. With hardware
  decoding, Chromium produced almost no frames there (0.3 per second, measured) and the clip froze
  at its loop point. HEVC/H.265 videos need **Settings → Application → Hardware Video Decoding**
  (applies after a restart); the panel says so when such a file will not open.

---

### Show control: timeline, clip deck, Auto VJ, MIDI and OSC

<div align="center">

| Timeline | Clip Deck |
|:---:|:---:|
| ![Timeline editor](docs/screenshots/panel-timeline.png) | ![Clip deck](docs/screenshots/panel-clipdeck.png) |

</div>

**Timeline.** Lay scenes and setting changes out along time, aligned to the bar or to the second;
one playhead drives every screen together, and offline export plays the same show.

- Clip tracks for scenes, templates, palettes, video, images, shaders and actions; **automation
  lanes** for any setting, with curves; markers and a loop.
- **A full editor** <kbd>3.1.5</kbd>, modelled on Ableton's Arrangement View: a toolbar with
  transport, clock (time and bar.beat), tempo, snap, loop, follow and zoom; track headers with
  colour, mute, solo and lock; split at the playhead, duplicate, copy and paste, nudge, 100-step
  undo; multi-select with box selection; a draggable loop brace and marker flags; per-clip
  transition handles; **tempo changes on the ruler**; adjustable lane height and a full-window mode;
  and keyboard shortcuts that only act while the editor has focus.

**Clip Deck.** Place scenes, templates, palettes and media on a grid and fire them on the beat.

- **Beat-quantised launching** with a global quantise setting, **follow actions** (next, random,
  go-to, loop, stop) and durations.
- **Launch modes** <kbd>3.1.5</kbd> — trigger, toggle and **gate** (plays while held).
- **Several decks** with tabs, named rows and columns, colours, progress bars, a blinking countdown
  on queued cells, drag-and-drop to move or copy, and a **Performance View** for a second screen.
- **Keyboard play** <kbd>3.1.5</kbd> — 1-9 or arrows pick the row, A-P fires a slot, Enter launches
  the row.
- **Media and action slots** <kbd>3.1.5</kbd> — video, image and shader slots apply to a chosen layer;
  action slots run the same actions as MIDI and OSC mappings.
- Fired slots can be **recorded to the timeline**, so an improvised set becomes an editable show.

**Tempo and Auto VJ.** The track's tempo is detected and **Auto VJ** changes scenes, visualizer
modes or colours by itself, aligned to the bar. Pick exactly which scenes, modes or palettes cycle
(or leave it empty for all), give each visualizer layer its own mode, and read a status line that
says what changed, what comes next, and why nothing can happen when a source is empty.

**MIDI.** Learn a control, then map any CC or note to any setting or action — including MilkDrop's
next, previous, random, cut, lock and rating.

**OSC.** A UDP listener with a hand-written OSC 1.0 parser, for TouchOSC, Resolume, Ableton or QLab.

<div align="center">

![MIDI, OSC and MCP on the Control page](docs/screenshots/panel-control.png)

</div>

**Phone remote.** A phone-sized page for scenes, colour palettes, Studio presets, visualizer and
background modes, audio sensitivity, blackout and the now-playing card, served by the same server
as the OBS overlay. Values sent from the phone are
range-checked before they are applied <kbd>3.1.5</kbd>.

**Blackout** on <kbd>Space</kbd> or from any controller, with its own transition, leaving the stored
scene untouched.

---

### Outputs: screens, OBS, Spout and Syphon

<div align="center">

![Output page: streaming, Spout and Syphon, displays and the floating window](docs/screenshots/panel-output.png)

</div>

**Multi-monitor.** A separate full-screen window on every display you select. The chosen displays
are remembered by position and size, so a monitor that Windows renumbers after reconnecting is
found again <kbd>3.1.5</kbd>.

**Floating window** <kbd>3.1.5</kbd>. A picture-in-picture window with opacity, a 16:9 aspect lock,
a position lock and **click-through**, for keeping the visuals over your desktop while you work.

**Streaming output — OBS and the browser.** Turn on **Output → Streaming Output** and the
application serves an overlay page.

- Add it to OBS as a **Browser Source**. No plugin, and real transparency.
- The overlay runs the **same engine** as the desktop window, so what you see is what streams —
  MilkDrop presets and their textures included.
- Works across the network, so the visualizer can run on one machine and OBS on another.
- **Transparency is the app's own switch**; add `?transparent=0` or `?transparent=1` to one source's
  address to force it either way.
- **Lyrics follow the app**, and the browser corrects its clock to the machine running the app.
- **A diagnostics card** <kbd>3.1.5</kbd> — add `?debug=1` to the address to see the connection,
  configuration, audio frame rate, canvas size, transparency, app version and last error.
- Access is protected by tokens; the overlay and the phone remote have separate ones.

**GPU output — Spout and Syphon.** The picture can be handed to another application on the same
machine over the GPU: no window capture, no CPU copy.

- **Spout** on Windows, **Syphon** on macOS. Receivers include Resolume, OBS, TouchDesigner and
  MadMapper — anything that speaks either protocol.
- Pick the **source name**, resolution and frame rate.
- It renders in its own hidden window, so the feed keeps running even when no visualization window
  is open.
- Spout and Syphon stay opaque: a shared GPU texture cannot carry alpha without dropping the sender.
- **Not available on Linux**, which has no built-in equivalent. The panel says so and points at the
  OBS browser source, which works everywhere.

---

### Stage: projection mapping and aspect correction

<div align="center">

![Projection mapping](docs/screenshots/panel-mapping.png)

</div>

**Projection mapping**

- **Corner pin** as a true homography, with the denominator written into `gl_Position.w` so the
  texture stays perspective-correct.
- **Mesh warp** on a Catmull-Rom grid that passes through its control points.
- **Soft edge blending** for multi-projector rigs; the curves are tested to sum to exactly 1 across
  the overlap.
- **Per-output crop, colour correction and Bézier polygon masks**, plus alignment grids, crosses,
  colour bars and focus rings, with drag, arrow-key nudge and exact numeric entry.

**Aspect correction.** A display's reported resolution does not always match its physical shape. A
panel driven at 1920×1080 that is really about 3:1 — a stage LED wall, a bar display, an anamorphic
projector, a TV forced into a stretched mode — draws every circle as an ellipse.

- **The frame is never stretched.** The scene is drawn on a square-pixel canvas matching the panel's
  real shape and squeezed linearly into the framebuffer, where the panel's own distortion undoes
  the squeeze. Nothing is cropped and nothing is pushed off the edge.
- **One setting corrects everything** — background, visualizer, logo, text and sprites together.
- **Calibrated by eye** with a circle, square or grid, or from the panel size, the true aspect ratio
  or the dimensions of an already-stretched image.
- **Per screen or all screens**, composes with projection mapping without moving an existing corner
  calibration, and leaves exported video, the stream and the web overlay alone.

---

### RGB lighting: Dynamic Lighting, OpenRGB and Art-Net

**Windows Dynamic Lighting**

- Off by default, and available only when compatible devices are detected.
- Dynamic modes: visualizer colour flow, bar-spectrum mapping, bass/mid/treble zones,
  background-light sync, synchronised beat flashes, frequency ripples, bar and background fusion,
  cross-device colour flow, rainbow flow, and threshold-triggered bursts.
- Manual modes: one colour, per-device colours, and per-LED or per-zone colours where the hardware
  exposes them.
- Brightness, audio reactivity, smoothing, update rate, LED layout, palette source, per-band colours
  and sensitivity, flash threshold, strength and decay, ripple speed, direction and width, and
  colour spread are all configurable.
- The installer registers the Windows background-lighting identity, so lights keep running when the
  app is not focused. Place the app near the top of **Dynamic Lighting → Background light control**.

**OpenRGB — RGB everywhere else.** Talks to a running **OpenRGB** server over its own protocol (TCP,
port 6742 by default) on Windows, macOS and Linux — no vendor software, and the server may sit on
another machine. Every device OpenRGB exposes, per-LED where the hardware allows, with the **same
modes and colour maths** as Dynamic Lighting.

**Art-Net / DMX.** ArtDMX output to fixtures and lighting desks; the packet layout is tested byte by
byte.

**Colour sources.** The lights can follow the background, the theme, or the **live MilkDrop
picture** <kbd>3.1.5</kbd> — sampled about 30 times a second into eight slices from left to right, so
the fixtures on the left take the colours on the left of the screen.

---

### Recording and video export

<div align="center">

![Recording and export](docs/screenshots/panel-record.png)

</div>

- **Offline video export (audio file → MP4).** Renders a track frame by frame — not a screen
  recording — at 720p, 1080p, 1440p or 4K, 30 or 60 fps, with quality, a CPU or GPU encoder, progress,
  cancellation and a GPU-to-CPU fallback. It is deterministic: the same job gives the same video, the
  property the visual regression tests rely on. Title, artist, album and cover are read from the
  file and feed Now Playing and text layers.
- **Live recording** of the output exactly as it appears — with the live audio, modulation,
  transitions and effects — to MP4 or WebM, on one key.
- **GIF export** with two-pass palette generation, because one pass bands visibly.
- **PNG snapshot** at up to 4×, on a shortcut.
- **Export presets** for common aspect ratios.

---

### MCP — control from an AI agent

<kbd>3.1.5</kbd>

An agent drives the running application over the **Model Context Protocol**. The switch is on the
**Control** card and is off by default. The application stays open while the switch is on. The
setup dialog gives a stdio command for Claude Desktop, Codex, Cursor, Grok and Grok Bot. Ollama is
a local model behind an MCP client and uses that same command.

> **Needs Node.js.** The stdio command runs `node`, so the computer needs
> [Node.js](https://nodejs.org/) LTS installed and on `PATH`. The application itself does not need
> it. Without Node.js the MCP client reports that it cannot start `node`.

The server speaks JSON-RPC `initialize`, `ping`, `tools/list` and `tools/call`. It accepts protocol
versions `2024-11-05`, `2025-03-26` and `2025-06-18`, and answers `2024-11-05` for any other
version. The server name is `soundvisualizer`. There are **96 tools**.

The client spawns the stdio bridge. The bridge posts to `http://127.0.0.1:<port>/mcp` with a bearer
token. The socket binds `127.0.0.1` only. The port is **38471** unless you set another. Port
**8722** is refused, because that port belongs to the stream. A busy port stays busy: the server
does not move, and the card reports the failure. Each start writes a new token into
`mcp-endpoint.json` in the application data folder, next to a copy of the bridge. On Linux and
macOS those two files are readable by this user only. A connection from anywhere else is refused,
and so is a missing or wrong token.

`sv_get_config`, the output-status read and `sv_export_json` replace stream tokens with a
redaction. `sv_set_stream` drops `token` and `remoteToken`.

Every tool lists its parameters in `tools/list`, with types, ranges and allowed values. Values the
panel cannot produce are refused or pulled into the panel's range: a layer position outside -1..1,
a colour that is not `#rrggbb`, an unknown effect type, a modulation route to a setting that does
not exist. `sv_patch_config` writes into a list only at an index that exists (`layers.0.opacity`)
and does not create new top-level keys. A value must keep the type of the one it replaces, and a
write under `layers` passes the same checks as `sv_update_layer`. Arguments a tool does not know
are listed back as `ignored` in its reply.

Five modes stack. The switch turns on in **Read**. A higher mode includes the ones below it. The
agent cannot raise its own access: `sv_patch_config` refuses any `mcp.*` path. A blocked call names
the mode it needs and tells the agent to leave the mode alone and leave the panel unclicked.
`sv_list_permissions` and `mcp_permissions` report the active mode and, when you pass a tool name,
the minimum that tool needs.

A change the mode allows is saved and pushed the same way a click is. The admin panel, open
visualizer windows and the stream all receive it. After every call, success or error, the preset
folder is re-read and open windows receive the delta.

#### Read

The master switch is enough. These calls only read.

- `sv_get_state` returns the show: active preset, scenes, layers, effects that are on, displays,
  BPM and levels, now playing, the layer stack, stream status, Spout/Syphon status and the live
  analysis from the panel preview (empty while the preview has no sound).
- `sv_get_visual_state`, `sv_list_layers`, `sv_get_layer` and `sv_get_layer_stack` return layer
  position, settings and per-layer effects.
- `sv_get_preview` adds a JPEG of the picture on screen, at most 480 pixels wide. It uses an open
  visualizer window, then the floating window, then the preview rectangle in the admin panel.
- `sv_get_audio` returns level, bass, mid, treble, BPM and confidence from the same meter the panel
  draws. `sv_get_now_playing` returns the current track. `sv_list_audio_sources` lists the
  configured inputs.
- `sv_list_scenes` and `sv_get_scene` read saved scenes. `sv_list_modes` lists every visualizer and
  background id, layer kind and blend mode; the mode and layer tools reject an id it does not list.
  `sv_list_effects` lists the global chain,
  each layer's chain, and the 40 built-in effect types. `sv_list_presets` lists library presets
  and user colour palettes. `sv_list_displays` lists screens.
- `sv_get_output_status` reads which visualizer windows are open, the stream switch, port and LAN
  flag, and the Spout/Syphon name. `sv_get_timeline`, `sv_get_clipdeck` and `sv_get_autovj` read
  those panels. `sv_get_config` reads the whole configuration or one dotted path.

#### Apply

Uses what is already saved.

- `sv_apply_scene` loads a saved scene by id, or by name when that name is unique. The snapshot
  covers background, visualizer, layers, groups, crossfade, geometry, effects, logo, images, media,
  text, modulation, transition, Studio, MilkDrop and feedback. Window transparency and taskbar
  cover stay as they were.
- `sv_apply_template` applies a built-in template by id or name. `sv_set_visualizer_type` and
  `sv_set_background_type` switch to an existing mode id. A Studio shader is shown with type
  `custom` and its `presetId`. `sv_set_layer_enabled` shows or hides a layer and turns the stack
  on. `sv_set_crossfade` sets the A/B fader from 0 to 1.
- `sv_trigger_clip` fires one clip-deck slot by row and column. `sv_stop_clips` stops every playing
  slot. The grid stays as saved. Both need the admin window open.
- `sv_set_effect_enabled` and `sv_set_effect_param` change a global effect already on the chain.
  The layer pair does the same for one layer. `sv_set_modulation_enabled` turns the modulation
  matrix on or off. `sv_set_macro` sets one existing macro fader.
- `sv_load_preset` copies an existing library preset into the live MilkDrop source.
  `sv_apply_color_preset` paints an existing user or built-in palette onto the background gradient.
  `sv_set_milkdrop_cycle` sets how the library advances: auto next, order, source, tag, unit, bar
  count, track advance and hard cut.

#### Write

Creates and edits.

- Scenes: `sv_create_scene` stores the current look under a new name, `sv_update_scene` overwrites
  one, `sv_rename_scene` gives a scene found by id or current name the `newName`,
  `sv_delete_scene` removes.
- Layers: `sv_add_layer`, `sv_update_layer`, `sv_set_layer_position`, `sv_set_layer_settings`,
  `sv_remove_layer`, `sv_reorder_layers`. A layer carries kind, type, preset, opacity, blend,
  transform (x, y, scale, rotate, flip), audio response, mask, solo, mute, lock and group. Effects
  on a layer go through the effect tools. Adding or showing a layer turns the stack on.
- `sv_set_text` edits the text overlay, including a lyrics or now-playing source. `sv_set_logo`,
  `sv_set_media` and `sv_set_geometry` edit those blocks.
- Effects: `sv_add_effect` and `sv_remove_effect` on the global chain, `sv_add_layer_effect` and
  `sv_remove_layer_effect` on one layer. The built-in types are bloom, chroma, glitch, grain, crt,
  pixelate, kaleido, mirror, grade, vignette, trails, edge, zoomblur, ripple, posterize, blur,
  radialblur, motionblur, tiltshift, dof, sharpen, emboss, dither, halftone, ascii, hatch, paint,
  vhs, datamosh, slitscan, lens, twirl, polar, gradientmap, levels, threshold, solarize, godrays,
  badtv and starfilter. `sv_add_modulation_route` and `sv_remove_modulation_route` edit routes.
- Presets: `sv_save_preset` writes a file in the preset store. Shader text with no kind is saved as
  a Studio visualizer (`kind` `visualizer`, `engine` `shader`). Any other save with no kind is
  MilkDrop. `engine` is `shader` or `variation`; `glsl`, `shadertoy`, `isf` and `frag` are read as
  `shader`. `sv_delete_preset` removes a file and reports an id that does not exist. `sv_set_milkdrop_source` writes MilkDrop source into
  the live show. `sv_create_color_preset` saves a user palette of two to five `#rrggbb` colours.
  Like the panel, it stores five, repeating the last one.
  `sv_delete_color_preset` removes a user palette.
- Auto VJ: `sv_set_autovj` sets enabled, source, interval, unit, order, BPM lock, palette source
  and per-layer visualizer targets.
- Export and recording: `sv_start_export` renders an audio file that exists on disk to a video path
  you name. Resolution, 30 or 60 frames per second, a CPU or GPU encoder, speed and quality are the
  same options as the export panel. `sv_cancel_export` stops a running export. `sv_export_json`
  writes the scene list, or the full settings, to a path, with no dialog. `sv_save_snapshot` writes
  the live picture to a path as a JPEG. These three tools take only an absolute local path with
  the matching extension: `.mp4` for the video, `.json` for the settings, `.jpg` or `.jpeg` for the
  picture. Network paths and addresses such as `tcp://` are refused, and so are the app's own
  folders. An existing file is replaced only with `overwrite: true`. `sv_record_start` and `sv_record_stop` drive the admin recorder.
  Stopping opens the same save dialog as the Record card. The recorder needs the admin window open.

#### Full

Opens the live surfaces.

- `sv_open_output` opens the visualizer on the chosen displays. Passing a display id replaces the
  selected set. `sv_close_output` closes visualizer windows. `sv_set_displays` chooses displays and
  leaves the windows as they are.
- `sv_set_stream` changes the OBS and browser stream. `sv_set_texture_share` changes Spout and
  Syphon. `sv_set_aspect` changes aspect correction. `sv_set_power` changes the frame-rate cap,
  the render scale and `keepAwake`, which keeps the display awake while a visualizer window is open.
- `sv_set_floating` changes floating-window preferences, including opacity and click-through.
  `sv_set_floating_open` opens or closes that same picture-in-picture window.
- `sv_set_window_mode` sets a transparent background, the transparency threshold and taskbar cover.
- `sv_set_lighting` changes Windows Dynamic Lighting. `sv_set_openrgb` changes OpenRGB.
  `sv_set_artnet` changes Art-Net. `sv_set_audio_sources` replaces the input mix.
- `sv_set_mapping` writes one display's projection map: enable, corners, crop, edge blend, masks,
  mesh, colour and test pattern, and turns mapping on. It binds no new network port.
- `sv_timeline_transport` plays, pauses, stops or seeks the timeline through the admin transport.
  The admin window has to be open.
- `sv_set_blackout` takes `on`, `off` or `toggle` and leaves the stored scene in place.
  `sv_set_blackout_transition` sets the blackout transition type and duration.

#### Everything, and the general patch

`sv_patch_config` sets any other dotted path. The mode follows the path: scene content, effects
and presets need **Write**; export paths need **Write**; displays, stream, lighting, mapping,
windows and the timeline need **Full**; `control.*` (MIDI and OSC bindings) needs **Everything**.
A path that holds a stricter one needs that mode too: the whole `stream` object needs
**Everything** because it holds the tokens, and the whole `power`, `audio`, `background` and
`transition` objects need **Full**. A path the table does not know needs **Everything**. The paths
`mcp.*`, `version`, `__proto__`, `prototype` and `constructor` are refused.

`sv_updates_download` and `sv_updates_install` download and install an update the app has found.
`sv_rotate_stream_token` replaces the OBS or remote token. `sv_repair_audio` restarts capture when
the audio component is healthy; when it is missing it says so, because installing it needs the
user's consent. All four need **Everything**. The reads `sv_diagnose_audio` and `sv_get_analysis`
return the capture diagnosis and the live analysis (key, chord, pitch, loudness, drum bands).

---

### The control panel

<div align="center">

![Control panel](docs/screenshots/panel-scene.png)

</div>

- **Eight categories** — Scene, Audio, Lighting, Output, Control, Studio, Library and Settings.
- **Live everywhere** — every change reaches the output windows immediately and saves itself.
- **A live preview** with its own demo signal, audio meters and saved scenes beside every page.
- **Modified badges** on each card and category, with a reset for the section or the whole category.
- **Search** across every setting in every category (<kbd>Ctrl</kbd> + <kbd>K</kbd>).
- **Advanced** toggles hide rarely used controls until you want them; **extended ranges** raise the
  slider limits 5×.
- **Turkish and English**, switchable at runtime; the self-test fails if any interface string is
  left untranslated.

---

### Reliability, power and updates

- **Accidental-close protection** — a visualizer window that closes unexpectedly (a crash, Alt+F4)
  reopens at once; *Prevent accidental quit* asks before the app closes during a show; an optional
  ESC lock, with <kbd>Ctrl</kbd> + <kbd>Shift</kbd> + <kbd>Q</kbd> as the way out.
- **Keeps the display awake** <kbd>3.1.5</kbd> — on by default while a visualizer window is open and
  not minimised, on Windows, macOS and Linux; minimising or closing hands control back to your power
  settings.
- **Every GPU surface recovers from a lost context** <kbd>3.1.5</kbd> — a driver reset no longer
  leaves black layers until a restart.
- **Main-process faults are contained** <kbd>3.1.5</kbd> — an unexpected error is logged and shown in
  the panel instead of freezing the app behind an error dialog.
- **Two copies at once** <kbd>3.1.5</kbd> — a second copy names the one already running and offers to
  switch to it; a copy never silently writes over settings someone else changed.
- **Updates** <kbd>3.1.5</kbd> — *Library → Updates* checks GitHub Releases, shows the notes, and
  lets you skip a version. The Windows installer and the AppImage download and install in place;
  nothing runs unless the size and the SHA-256 match exactly. Off, notify (default) or automatic.
- **Settings backup and restore** — every setting in one JSON file; palettes and scenes have their
  own export and survive an import. Files written by 1.3 and 2.0 load without losing a value.
- **Power and performance** — *Match Display* frame rate or a cap of 120, 60 or 30 FPS, background
  resolution scale, pause on silence, hide cursor, always on top, and cover the taskbar.

---

### Privacy and security

- **No account, no telemetry, no analytics.** Settings live in your user folder.
- **One network call of its own**: GitHub's latest-release API for the update check, with no
  identifiers. Set updates to *Off* and there are none.
- **Everything else is opt-in and local**: the stream server (LAN, token-protected; it refuses
  pages from other origins and host names it does not know <kbd>3.1.5</kbd>), OSC, OpenRGB, Art-Net
  and MCP (bound to `127.0.0.1` only, with a bearer token).
- **Converters and generators run offline** — Shadertoy and ISF import, the scene generator, the
  MilkDrop preset generator, lyrics.
- **The camera is never opened by automation**, and a fuzzing test asserts that no MilkDrop preset can
  smuggle JavaScript into the engine.

---

## FAQ

**Is it free?**
Yes. CAYADEV Visualizer is open source under the MIT licence. There is no paid tier, no account and
no watermark.

**Do I need Stereo Mix or a virtual audio cable?**
Not on Windows: system audio is captured straight from the output device. On macOS, system audio
needs a virtual device such as BlackHole (microphones work directly). On Linux, the PulseAudio or
PipeWire monitor source is used automatically.

**Does it work with Spotify, YouTube, Apple Music or a DAW?**
Yes — it visualizes whatever your computer plays. On Windows you can capture one application only
(say, Spotify) and ignore everything else, and Now Playing reads the track title and cover from the
system media session.

**Can I use it as an OBS overlay?**
Yes. Turn on Streaming Output and add the address as a Browser Source. Transparency works, and OBS
can run on a different computer on the same network. Spout (Windows) and Syphon (macOS) are there for
GPU sharing as well.

**Can it load my MilkDrop presets?**
Yes: single `.milk` files, MilkDrop 3 `.milk2` double presets <kbd>3.1.5</kbd>, ZIP packs, folders, or
a search of your computer. Point the app at a MilkDrop `textures` folder for presets that use images.
No third-party preset pack is bundled; five original presets are.

**Is it a Winamp or projectM plugin?**
No. It is a standalone application with its own MilkDrop-compatible engine in WebGL2. It does not
embed projectM or MilkDrop.

**Does it support several monitors and projectors?**
Yes — a full-screen window on every selected display, plus projection mapping, edge blending and
aspect correction for projectors and LED walls.

**Can I make a music video from a track?**
Yes. Video Export renders an audio file to MP4 frame by frame, up to 4K at 60 fps, using the current
scene. It is not a screen recording, so the result does not depend on how fast your computer is.

**Can AI agents control it?**
Yes <kbd>3.1.5</kbd>. Turn on MCP on the Control page and connect Claude Desktop, Codex, Cursor or any
MCP client with the command the setup dialog gives you. Access starts at read-only. The command needs
[Node.js](https://nodejs.org/) LTS on the computer.

**Will it slow my computer down?**
It needs a GPU with WebGL2. Use the frame-rate cap, the background resolution scale and pause on
silence on laptops; the MilkDrop panel shows mesh density and internal resolution.

**Can it be a screen saver?**
There is a Screensaver template group, and the display is kept awake while the visuals run, but the
application does not register itself as an operating-system screen saver.

**How well are macOS and Linux supported?**
Both are built on CI runners and the audio engine loads there, but neither build has yet been run on
real hardware by the project. Windows is where everything is measured. Reports from Mac and Linux
users are very welcome.

**My video freezes in full screen or in Spout, or an iPhone video will not play.**
Videos are decoded on the CPU by default, which keeps them smooth in full screen and in the
Spout/Syphon feed <kbd>3.1.5</kbd>. HEVC/H.265 files (common from phones) can only be decoded in
hardware: turn on Settings → Application → Hardware Video Decoding and restart the app.

**Is my data sent anywhere?**
No. See [Privacy and security](#privacy-and-security).

---

## MilkDrop engine notes

The engine's fidelity work, measured preset by preset. MilkDrop Fidelity is on by default; switching
it off restores the engine's earlier look.

- **The preset language actually runs** — tokeniser, parser, and compilation to JavaScript
  closures. `per_frame` and `per_pixel` equations drive a real warp mesh with feedback, including
  `megabuf`/`gmegabuf`, `loop`, `while`, `exec2`/`exec3` and compound assignment.
- **Measured against 10,347 real presets** from the projectM original and cream-of-the-crop packs:
  every one loads and runs, 10,344 of them with no skipped statement at all.
- **`.milk` import**, including multi-file packs with per-file compile errors reported.
- **Five presets of our own ship with the application.** *Kutup Işığı* (a flowing nebula),
  *Erimiş Altın* (the loud one), *Dingin Halkalar* (slow and nearly black), *Sonsuz Tünel* (the
  classic tunnel) and *Nabız Örgüsü* (squares on the beat over a motion-vector weave) — written
  here, so the engine shows what it does before you import a pack of your own. They join auto
  advance like any other preset. The two pictures on this page are rendered from them.
- **No preset text is copied into generated code.** There is no `eval` and no generated source:
  each node becomes a closure, identifiers become pool indices, and function names are resolved
  against a fixed table at compile time.
- **The HLSL warp and composite shaders are translated to GLSL and run on the GPU.** Measured in a
  real WebGL2 context over the 10,332-preset corpus: **all 16,346 shader stages compile**, and every
  one of the 8,485 presets that carries a shader has every stage clean. A separate harness renders each preset and reads the pixels back,
  because a shader that compiles can still draw black: **~98% produce a live image.** The seeded slice resolves to about a preset either way: the harness deliberately carries the feedback buffer between presets, so one preset sitting on a class threshold can move the last digit without anything in the engine changing. Both
  harnesses are in `scripts/`, so the numbers can be reproduced rather than believed.
- **The picture uses MilkDrop's own values, not an approximation of them.** Each of these was found
  by diffing the corpus against what the engine actually reads, and each is measured: two header
  settings never reached the equations at all (`fZoomExponent` and `fWaveParam`, one of which
  66.6% of presets rely on); the warp mesh ran in a vertically mirrored space, so `dy`, `cy` and the
  direction of rotation were flipped (48.8% use `dy` or `cy`); the warp ripple used invented
  constants and ignored `fWarpScale` and `fWarpAnimSpeed` (79.9% and 44.0%); the waveform ignored
  `fWaveSmoothing` (79.0%), a custom wave's own `smoothing`, and `bModWaveAlphaByVolume` (38.9%);
  and the outer/inner borders (37.8%) and the centre darkening (6.9%) were never drawn at all.
  A **MilkDrop Fidelity** switch restores the engine's earlier look.
- **The mesh transform is MilkDrop's own, read from MilkDrop 2's source.** `rad` is left
  unnormalised as MilkDrop leaves it, `ang` keeps its `(-π, π]` range with the centre node pinned,
  aspect is applied at the start of the transform and undone at the end so a circle stays a circle
  on a wide screen, and the steps run in MilkDrop's order — zoom about the centre of the screen,
  then stretch, warp, rotate, translate. `aspectx` and `aspecty` were swapped, so a preset
  correcting for a wide screen corrected the wrong axis. The blurred copy is darkened at its edges
  (`b1ed`, 68.6% ask for it), and a custom wave is drawn at MilkDrop's amplitude and reads the
  spectrum when it asks for the spectrum (23.2% do).
- **Presets without a shader of their own look as they do in MilkDrop 2.** MilkDrop picks a preset's
  warp and composite shaders by the file's version, not by whether shader text is present, and
  draws the rest with a fixed pipeline built from blend passes. Checked against MilkDrop 2's source
  and the original D3D9 code: brighten there is `1−(1−c)²` and solarize `2c(1−c)`, not the
  `sqrt(c)` and `4c(1−c)` the engine used (410 and 83 presets of a 10,332-preset corpus turn them
  on); echo orientation is `(int)x % 4`; gamma below 1 is ignored while echo is on; and when two
  presets whose echoes point different ways blend, the echo fades out and back in instead of
  flipping. A preset that leaves out its decay or gamma gets MilkDrop's 0.98 and 2.0 instead of 0,
  and so do the other values it leaves out — down to MilkDrop's quirk of reading a missing wave
  colour as 0; a rotation centre of 0 stays in the corner. The values MilkDrop keeps out of the
  equations (wave scale and smoothing, the volume fade, warp speed and scale) come from the file as
  they do there, so a wave scale of 0 flattens the wave (102 presets of the corpus). Rendered
  through the engine, every case matches MilkDrop's formula within 2/255.
- **Preset files are read the way MilkDrop reads them.** With fidelity on, keys are case-sensitive,
  a key written twice takes the value MilkDrop finds (usually the first), numbered code ends at the
  first missing number, integer settings drop their fractions, and equation lines are glued the way
  MilkDrop glues them, `\\` comments included. 32 presets of the corpus read differently; with
  fidelity off the old parser stays.
- **Equations run by MilkDrop 2's compiler rules.** With fidelity on, truth and equality tests use
  its 0.00001 tolerance, `%` works on whole numbers without sign, `&` and `|` on 64-bit integers,
  `megabuf` and `gmegabuf` indices are rounded and bounded the way it does, `rand(n)` returns a
  real number (5,361 corpus presets call it), and the compiler's internal names such as `_aboeq`
  run. With fidelity off nothing changes.
- **Each block keeps MilkDrop's own variables.** With fidelity on, per-pixel code and a wave's
  per-point code run in their own variable space the way MilkDrop's separate machines do: they see
  only what MilkDrop hands them (time, audio, the mesh size, q1..q32 and for waves t1..t8), keep
  their own variables and `megabuf`, and nothing they write leaks back. `reg00`..`reg99` are
  shared by every block and preset, so shapes now see the random values init leaves there, and
  `loop`/`while` stop at MilkDrop's 1,048,576 turns a call.
- **Composite shaders get the hue colour MilkDrop gives them.** MilkDrop passes every composite
  shader four slowly drifting corner colours as `hue_shader`, whatever the preset's `fShader`
  says; `fShader` only scales them on the fixed pipeline. The engine applied `fShader` to shaders
  too, so about 950 presets of the corpus drew without their colour or with part of it, and the
  corners were mirrored top to bottom. On the fixed pipeline the colour now goes through MilkDrop's
  own draw passes, the wraparound of out-of-range colours included.
- **Textured shapes, motion vectors, rotation matrices, mesh density, internal resolution scale,
  mouse input and preset transitions** are all implemented, and each sampler is read with the
  filtering and wrapping its name asks for (`sampler_pw_main` is point-sampled, `sampler_fc_main` is
  filtered and clamped — 22.7% of presets read one texture through two different prefixes).
- **User textures load from your own texture folder.** 16.9% of presets ask for an image by name —
  `sampler_worms` looks for `worms.jpg`. Preset packs do not ship these files, so point
  MilkDrop › Texture Pack at the `textures` folder of a MilkDrop installation. Without one the
  preset still runs, with noise in place of that texture. The textures load wherever the preset is
  drawn: the visualizer windows, the panel's live preview, the web overlay — which fetches each
  image by name from the stream server, behind its token, and is sent a short digest of the folder
  rather than its path — and video export, which waits for a texture before drawing the next frame,
  so the same job still gives the same video.
- **Flash limiting holds on every screen.** On by default, it limits how fast the picture's mean
  brightness may change, at WCAG 2.3.1's general-flash value: 0.10 of relative luminance per frame
  at 30 fps, the frame step it was measured at. The limit used to be per frame, so a faster display
  let flashes through faster — measured with a preset that flips between black and white three
  times a second, the swing per cycle was 0.714 in the panel's 45 fps preview but 1.000 on a 74 Hz
  display, the flash untouched. It is now held per second: 0.43–0.49 in the preview, in 60 Hz and
  74 Hz windows, in a 35 fps window and on the web overlay alike.
- **MilkDrop follows the system's reduce-motion setting.** When the operating system asks for
  reduced motion (on Windows, *Animation effects* turned off under Accessibility › Visual effects),
  the flash limiter stays on even if it was turned off, loud moments no longer hard-cut, and every
  change blends over 5 seconds. Auto advance plans with that longer blend, so a preset is still
  shown in full for the time you set. A manual *Cut now* still cuts. The MilkDrop panel says
  whether it is on and why, and *Reduce Motion* overrides it either way: *Always*, or *Off* even
  when the system asks. Each screen reads its own system — a web overlay on another machine follows
  that machine — and video export follows only *Always*, so a video never depends on the machine
  that made it. Checked in an isolated copy with the setting emulated in the browser engine; the
  system's own setting was left alone.
- **A lost GPU context comes back.** A driver reset or a GPU process crash takes every WebGL object
  with it, and MilkDrop stayed black until the application was restarted: nothing in the code
  listened for it. The engine now holds the loss, asks the browser for the context back and rebuilds
  its programs, textures and buffers on the same canvas when it arrives; if it does not arrive
  within three seconds — a browser that gave up, or a context lost by hand — it starts again on a
  fresh canvas. The running preset survives either way: the same object, the same equation state and
  the same clock, so it carries on from where it stopped instead of restarting. What cannot come
  back is the feedback buffer's content, which lived in GPU memory, so the picture flows again from
  black. Chromium's habit of blocking 3D for a page whose GPU process crashed is turned off, because
  that block would leave the recovery with nowhere to go. The GPU self-test loses the context on the
  running engine both ways and checks that frames, pixels and the preset's own state come back.
- **So does every other GPU surface.** A real GPU reset takes every context at once, so MilkDrop
  coming back was not enough while the gradient background, the 3D geometry mode, the shader modes,
  the effect chains and projection mapping stayed black. None of them carries feedback or built-up
  state, so each now reports a lost context and its owner builds a fresh one with the same settings:
  a layer is rebuilt in place, in the same position and with the same blend, opacity and z-order;
  the effect chain keeps its effects. A surface is rebuilt at most every two seconds, so a GPU that
  is still restarting does not get a new canvas every frame. The GPU self-test loses the context of
  a gradient background and of the effect chain on the running stage and checks both come back with
  a picture (brightest sample 175 and 206 of 255, the same as before the loss).
- **Preset transitions are MilkDrop's dual pipeline.** The previous preset does not stop when a new
  one loads: it keeps its own object, its own compiled shaders and its own clock, and both presets
  run their frame and vertex equations every frame. The two warp meshes are blended per node along a
  ramp — a directional wipe, a plasma or a radial sweep, picked at random as MilkDrop picks it — so
  one part of the screen turns over before another, and the same ramp is the per-node alpha the two
  presets' shaders are drawn with. There is still **one** feedback buffer and one blur chain, which
  is what MilkDrop has. Values that do not move pixels (decay, wave and border colours, blur ranges,
  gamma) are blended numerically on a cosine curve; the boolean ones snap. *Approximate:* if the two
  presets use different waveform modes, MilkDrop morphs one shape into the other; here the new
  preset's mode is shown for the transition.
- **What a transition costs, measured.** Running two presets is close to exactly twice the work, so
  the default is only defensible with a number behind it. At 1280×720 against a 60 fps budget of
  16.67 ms, the median frame goes 2.70 ms → 5.20 ms at the default mesh of 64 (**31% of the
  budget**), 0.90 → 1.70 ms at mesh 32, and 5.80 → 11.10 ms at the densest mesh of 96 (67%).
  Separately, the first frame of *any* preset change compiles the new preset's shaders — 9.10 ms at
  mesh 64 with a hard cut, 12.10 ms with a transition; at mesh 96 that one frame goes 12.00 → 18.00
  ms and drops a frame. So the default is 1.7s, MilkDrop's own `fBlendTimeUser`, and automatic
  preset advance stays off by default, which means a transition only ever runs when you ask for one.
- **A preset change no longer stalls the frame.** Measured across 900 presets at 1280×720, the
  frame that loaded a preset ran a median 17 ms and at worst ~119 ms over its neighbours, and six
  changes in ten dropped a frame that would otherwise have held — nine tenths of it the GPU compiling
  the new shaders while the frame waited. Where the driver offers `KHR_parallel_shader_compile` the
  compile now runs in the background and the running preset keeps drawing; the change, transition
  included, starts once the new programs are ready, a median two or three frames later. With auto
  advance the next preset is chosen a second early and compiled in advance, so the change still
  lands on time — on the bar in bar mode — and the other screens prepare the same one. At the
  default mesh the changes that drop a frame fell from 61.9% to 4.9% with a hard cut and from 61.7%
  to 8.1% with a transition. Video export still waits for each compile, so the frame a preset
  appears on never depends on the machine.
- **A new track can bring the next preset.** Next to auto advance, *On Track Change* moves to the
  next preset — in the chosen order, random included — when Now Playing sees a new track. It works
  with the timer off, the lock stops it too, and only the leading screen picks, so every screen
  changes together. The track already playing when the app opens does not count, nor does the gap
  between two tracks.
- **Favourites, tags and search by author.** Star presets in the MilkDrop panel's list, or the one
  on screen with *Favourite* (also from a MIDI or OSC mapping), and give them tags of your own.
  Search matches the name, the author and the tags. MilkDrop names are mostly "Author - Title", so
  `author:geiss` (or `yazar:`) finds Geiss's presets but not a title that mentions him, and `#calm`
  finds a tag. *Show* narrows the list to favourites or one tag, *Author* to one author. *Pool*
  limits auto advance — the timer, hard cuts and track changes — to favourites or one tag, while Previous,
  Next, Random and the list still reach every preset. Favourites and tags live in the settings next to
  your ratings, not in the preset files, and a pack carries all three: *Pack What Is Shown* writes
  the presets in view with them, and importing the pack attaches them to the new copies. Checked in
  an isolated copy: with the pool set to three favourites, the visualizer window went round those
  three and nothing else.
- **Large preset libraries stay light.** Every save or delete used to re-read every preset file
  and send the whole list, sources included, to the panel, each window and every web client. With
  the 10,347 presets of a full MilkDrop library (116 MB) one delete held the app for about 2.4
  seconds and the panel used 631 MB. Presets are now read once and kept; a change sends only what
  changed. At the same size a save now takes 91 ms and the panel uses 273 MB. Deleting or adding
  MilkDrop presets no longer restarts the MilkDrop picture on screen. Web clients get MilkDrop
  presets without their sources (271 KB instead of about 30 MB for 2,000 presets), and the web
  overlay fetches the source of a preset only when it is about to draw it.
- **Import a whole MilkDrop library.** *Import from ZIP Pack*, *Import from Folder* and *Search This
  Computer* in the MilkDrop panel bring in a library in one go: nested folders, the pack's
  textures, and — if you want — the pack's category folders as tags. Nothing is copied until you
  have seen what will be added (presets, textures, MB, and what will be skipped: MilkDrop 3's
  `.milk2` double presets, oversized files, encrypted ZIP entries) and confirmed. Presets with the
  same name and content are skipped, so importing a pack twice adds nothing. Textures go into the
  app's own folder and are looked up after the texture folder you chose, so a pack's
  `sampler_worms` works without choosing a folder. The search looks in the usual Winamp,
  foobar2000 and projectM folders and in Downloads, Desktop, Music and Documents, wherever the
  system keeps them, and stops after a few seconds; a library it could not finish counting is
  scanned in full before you are asked. No preset pack ships with the app. Measured with real
  packs: a 9,795-preset folder was scanned in 1.1 s and imported in 6.2 s, and importing it again
  added nothing.
- **Preset thumbnails.** The MilkDrop panel's list has a *Grid* layout: every preset shows a small
  picture of itself, so a preset can be found by its look. Each thumbnail is drawn once in the
  background — the first two seconds of the preset with the demo sound, from a black screen — kept
  in the app's data, and drawn again when the preset or a texture it uses changes. Only the
  presets you scroll to are drawn. A visualizer window drawing MilkDrop at the same time barely
  noticed: none of its frames took longer than 27 ms. Found while building this: when another
  MilkDrop window was drawing and the computer was busy, a MilkDrop picture that had just set up its
  buffers (a new window, a resize, a thumbnail, a video export) could start from the other window's
  picture. Buffers now start from zeros.
- **A preset generator of our own.** *Studio → MilkDrop Preset Generator* writes an original
  MilkDrop preset from four sliders — energy, warmth, density and motion — and a seed. It runs
  offline, and every motion, wave, shape and shader pattern it uses was written for this app: no
  line of it longer than 30 characters appears in a 10,332-preset corpus. The preset loads straight
  away as a preview without being saved; *Save to Library* keeps it. Moving a slider keeps the
  seed, so you get the same preset with more energy or warmer colours rather than a different one,
  and a code such as `72-15-60-88-2n9c` brings the same preset back. Nothing in a generated preset
  flashes: its colours stay in range at any volume, and invert, solarize and brighten are never
  used. Measured on 200 generated presets with silence, the demo sound and a loud bass line: every
  shader compiled, and none went black, washed out to white, flashed more than twice a second or
  froze.
- **Mash-ups from your library.** The same card builds a preset out of pieces of the presets you
  already have: the look (decay, echo, gamma, the main wave), the motion equations, the custom
  waves, the custom shapes, the warp shader and the composite shader — each taken whole from one
  preset and copied line for line. *New Mash-up* draws every part at random from the presets the
  MilkDrop panel's list shows, so its search and filter apply, and only from presets that have that
  part. A single part can be drawn again, or all six can start from the preset on screen; the arrows step
  back through earlier mash-ups, and *Save to Library* keeps one. A mash-up inherits its donors'
  looks, so it can come out brighter or darker than any of them. Checked on a 10,332-preset corpus:
  a mash-up of one preset is that preset again, and in 5,000 random mash-ups every part was
  exactly its donor's. 300 random mash-ups ran in the engine without a single shader failure.
- **An editor for presets.** *Studio → MilkDrop Preset Editor* opens the preset on screen: frame and
  pixel equations, custom waves and shapes, the warp and composite shaders and the main values each
  have a tab, and a change shows in the running picture a moment after you stop typing. Errors point
  at the preset's own line (`per_frame_14`) with its own text, not at generated code; shaders are
  compiled as you type. Sliders for zoom, warp, rotation, decay and echo say when the preset's
  equations rewrite the value every frame. The original is never changed: *Save as a New Preset*
  keeps your version, and only what you changed is written — the rest of the file keeps its bytes.
- **MilkDrop 2 and MilkDrop 3 rules.** A *Preset Format* setting — Automatic, MilkDrop 2 or
  MilkDrop 3 — picks whose file rules a preset is read with: MilkDrop 3's 16 custom waves and shapes
  and q1–q64, or MilkDrop 2's four and q1–q32. Automatic reads a preset with MilkDrop 3 rules when
  it uses those extensions, and the panel names them. MilkDrop 3's hard-cut modes 1–6 are offered
  with its thresholds and delays. Its `.milk2` double presets load as a frozen blend of their two
  presets. Its new waveforms, new transitions and `get_fft` in shaders are not here yet: nothing
  describes how they behave.
- **Sprites from `milk_img.ini`.** MilkDrop 2 draws images of your own over the picture during a
  show: each one is defined in `milk_img.ini` with an image, code that runs once and code that
  runs every frame, and launched by number. Choose the file in the MilkDrop panel and launch from
  its list, from a MIDI or OSC mapping, or with MilkDrop's own keys in the visualizer window — K
  and two digits launch, SHIFT+K and two digits remove that number, DELETE removes the newest. Up
  to 16 run at once; the five blend modes, the colour key, tiling, flipping and `burn` (the sprite
  leaves its image in the feedback and flows with the preset) follow MilkDrop 2's source. Every
  screen shows the same sprite, `rand` included: the launch carries its seed. Measured in an
  isolated copy with three displays, the web output, Spout and the panel preview: all six drew the
  probe image at every sample point, a sprite placed with `rand` sat at the same x/y on all of
  them, and a burnt sprite's image stayed where the sprite was after it died. Sprites are a live
  tool and are not part of video export.
- **Auto advance advances.** The panel's Auto Advance slider had been there since the engine landed
  and nothing ever read it: set to two seconds, the same preset stayed on screen (measured in the
  running app — nine seconds, no change). It now moves on every *n* seconds, in order or at random,
  and random never picks the preset already showing, since a "transition" to the same preset changes
  nothing on screen. The visualizer does the switching on its own frame clock, so it keeps going
  while the panel is closed or covered, and the preset it moves to is not written into the settings
  file, which is rewritten in full on every change. The panel's Loaded Preset row shows what is on
  screen, and the panel preview follows the visualizer instead of running a sequence of its own.
- **Preset timing is MilkDrop 2's.** Three things MilkDrop 2 does around auto advance were missing,
  and now follow its source. The next change comes after the transition time, the interval and a
  random extra of up to *n* seconds, drawn once per preset (MilkDrop's own default is 16 s plus up
  to 10 s; ours adds nothing unless asked). A lock stops auto advance and hard cuts, and releasing
  it carries on with the time that was left. And a hard cut — off by default, as in MilkDrop —
  changes preset with no blend when bass, mid and treble, each against its own long average,
  together pass three times a threshold; the threshold doubles on each cut and then falls back, so
  a run of bursts is not a run of cuts. MilkDrop calls that fall-back a 60-second half-life, but its
  coefficient is 2·ln 2, so the excess actually halves in 30 s; the formula is kept as it is, so a
  preset cuts as often here as it does there. A preset's `progress` now means what it means in
  MilkDrop — how far through its scheduled life the preset is — instead of a ten-second sawtooth.
  10 of the 23 corpus presets that read it use `above(progress, 0.99)` to fade out just before a
  change, and the sawtooth made them fade every ten seconds; with auto advance off there is no
  scheduled change and `progress` stays at 0, as it does in MilkDrop for a locked preset.
- **Ratings and a history, as MilkDrop keeps them.** Every preset carries a rating in its own file
  (`fRating`, 3 when it is missing), and MilkDrop draws its random order from the cumulative
  distribution of those ratings: a preset rated 1 comes up a fifth as often as one rated 5, and one
  rated 0 never comes up on its own. Random order now works the same way — on by default, as in
  MilkDrop, with a switch — and the panel shows the rating you gave the preset on screen as stars you
  can change; a preset you have not rated shows none, while random order keeps weighting it by its
  own file's rating. Your rating goes into the settings rather than into the preset, because saving a preset
  re-sends the whole library, sources included, to every window. Previous and Next now walk the history of
  what was actually shown, including what auto advance and hard cuts picked, instead of stepping
  through the list from the preset you last clicked; the history keeps MilkDrop's 64 steps. One
  difference is deliberate: after going back, a new preset drops the forward part, as a browser
  does, where MilkDrop's auto advance would replay it — the history lives in the panel and the pick
  is made in the visualizer.
- **MilkDrop on MIDI and OSC.** Controllers could drive the rest of the application but nothing in
  MilkDrop. They now have seven MilkDrop actions — next, previous, random, cut now (MilkDrop's H:
  the next preset with no blend), lock, rating up and rating down — which run the panel's own code,
  so the history, the rating weights and the lock behave the same from a controller; and six
  settings: transition time, auto-advance interval, random spread, hard-cut threshold, mesh density
  and internal resolution. The last two only ever take the panel's own values: a knob's travel is
  split into equal steps, because every value in between would rebuild the mesh or the frame
  buffers.
- **Preset changes on the bar.** Auto advance can count bars instead of seconds: every *n* bars, the
  preset changes on the first beat of a bar, and the transition is rounded to whole beats so it
  also ends on a beat (1.7 s at 120 BPM becomes three beats, 1.5 s). The tempo is estimated from
  the visualizer's own audio, not the panel's — the panel's loop stops while the visualizer covers
  it, which is why auto advance runs in the visualizer in the first place — and the BPM lock and
  tap tempo are the ones in Tempo & Auto VJ, so there is one tempo lock in the application, not
  two. With no tempo to be found the change falls back to time the way Auto VJ does, every twice
  as many seconds as bars and at least every 4 s, and the panel says so; otherwise it shows the
  visualizer's BPM and bar count.
- **Every screen shows the same preset.** With auto advance or hard cuts on, each visualizer
  window, the Spout/Syphon output and the web overlay ran a sequence of its own, so random order
  put a different preset on every screen — and even the same preset differed, since its four
  `rand_preset` numbers and the transition's pattern were drawn separately in each. Now one engine
  picks — the first visualizer window, else the Spout/Syphon window, else the panel preview — and
  the others show its pick with the same seed, so the same `rand_preset` and the same transition.
  Measured across three windows, Spout, the web overlay and the preview with random order every
  2 s: all six agreed on the preset in 58 of 60 samples, the other two falling on a switch, and
  presets that draw `rand_preset` as a flat colour matched to the pixel; before, the six showed 5.7
  different pictures per sample on average. MilkDrop › Displays › Each display picks its own brings
  back separate sequences. Randomness drawn every frame (`rand_frame`) still differs from screen to
  screen.
- **The lights can take MilkDrop's colors.** The lights could follow the background or the theme,
  not what MilkDrop draws. A new color source, MilkDrop picture (live) — in Lighting › Color Source
  or straight from the MilkDrop panel — reads the current frame about 30 times a second: shrunk to
  64×16 and cut into eight slices from left to right, each slice's color weighted by brightness so
  a small bright detail on a dark background still counts, its hue kept and its brightness left to
  the lighting mode. Dynamic Lighting, OpenRGB and Art-Net all take it, and OpenRGB now uses the
  sampled palette the same way Dynamic Lighting does, where it used to draw the configured
  gradient. Measured over Art-Net with a picture red on the left and blue on the right: the first
  four of eight fixtures red and the last four blue, where before all eight showed the fallback
  color; the window ran at 75.2 Hz with the sampling and 75.0 Hz without.
- **A MilkDrop layer survives scene transitions.** A scene transition used to build every layer of
  the arriving scene from scratch, which for MilkDrop means the preset restarting, its feedback trail
  vanishing and auto advance falling back to the preset you picked by hand. The dynamic colour theme
  changes the palette on every track and the palette counts as a scene change, so with both switched
  on this happened on every track — for colours MilkDrop never reads. The layer now stays in the
  arriving scene and the leaving one shows the same canvas through a proxy, so MilkDrop keeps
  running while the layers around it cross-fade. Measured in the running app, one run, the same
  palette change: without the fix a new instance appeared on the hand-picked preset, with it the same
  instance kept the preset it was showing.
- **Presets hear the music the way MilkDrop hears it.** MilkDrop computes `bass`, `mid`, `treb` and
  their `_att` versions with a chain of its own, and presets are written against how that chain
  behaves. We were deriving them from the visualizer's bands — smoothed twice and divided by a
  six-second average — and, fed the same synthetic drum track, that put `bass` *lower* just after a
  kick than between kicks (0.93×, where MilkDrop gives 2.45×), while the `_att` values did not rise
  on a hit at all. With MilkDrop Fidelity on, all six now come from MilkDrop's own chain: the newest
  576 samples, a Hann-windowed 1024-point FFT with MilkDrop's equaliser, three bands summed across
  the lower half of the spectrum, a fast asymmetric average for `_att` and a four-second one to
  divide by. It matches an independent reference implementation to within 3.2e-6. Two differences
  are deliberate and measured: the averages start from the first frame that has sound in it rather
  than from zero (MilkDrop's own start throws every value to about 250 for a moment when the layer
  was created in silence), and values are capped at 30 — on the test track the music itself peaks
  at 11.2 and a drop after an eight-second breakdown at 18.6, so the cap only touches the first
  frames back from a long silence, where MilkDrop reaches 234. The Sensitivity slider still scales
  how far the values move away from 1: its default of 0.7 is 30% less than MilkDrop, 1 is MilkDrop.
- **The per-frame variables reset every frame, as MilkDrop resets them.** MilkDrop re-seeds every
  built-in per-frame variable from the preset file before `per_frame` runs and returns `q1..q32` to
  what `per_frame_init` left. Our pool persisted instead, so `q1 = q1 + x` — written by 19.5% of the
  corpus — grew without bound instead of giving the same answer each frame. Preset authors' own
  variables still persist, as they do in MilkDrop.
- **`vol` and `vol_att` are what MilkDrop hands a shader, bug included.** MilkDrop's shader header
  makes them the fourth component of the bass/mid/treb constants, and the line that fills it reads
  `0.3333f * (imm_rel[0], imm_rel[1], imm_rel[2])` — a comma operator, so the value is a third of
  `treb`, not the average of the three bands the engine passed. 96 presets (0.93%) read them in a
  shader and were tuned against MilkDrop's value. In the equations MilkDrop has no `vol` at all, and
  a custom wave or shape sees only the inputs MilkDrop registers for it: the engine also copied
  `vol`, `vol_att`, the mesh size, the aspect pair and the pixel size into every wave and shape. Run
  through the equations with the switch on and off, 19 presets (0.18%) draw a wave or shape
  differently, all for one reason — the per-frame code assigns `vol` as its own variable and a shape
  reads it, where MilkDrop gives that shape its own zero. Both follow the MilkDrop Fidelity switch.
- **A spectrum wave gets MilkDrop's spectrum at MilkDrop's scale.** The `0.15` multiplier in
  MilkDrop was chosen for the magnitude its own FFT produces, so a normalised 0..1 array draws the
  right shape at the wrong size. The chain is rebuilt from the source: ±128 sample units, the
  two-tap damping, a 576-point Hann envelope, an unnormalised 1024-point FFT and the
  `-0.02·ln((512-i)/512)` equaliser, over the newest 576 samples as MilkDrop takes them — it had
  been reading the oldest 576 of the 2048-sample buffer, about 30 ms behind the sound.
  *Approximate:* the bin-to-frequency axis, because our samples arrive at the AudioContext rate
  rather than MilkDrop's.
- **Waves read the newest audio, from both channels, aligned the way MilkDrop aligns them.** The
  default and custom waves were reading the oldest 576 samples of the 2048-sample buffer, about
  30 ms behind the sound, with the same mono buffer 128 samples further on standing in for the
  right channel. With MilkDrop Fidelity on, each channel's newest 576 samples now go through
  MilkDrop's alignment: the window is compared with the previous frame's, coarse to fine over six
  halvings, and shifted by up to 95 samples, so a steady tone stands still on screen instead of
  starting wherever the window happened to fall. The 96 samples past the 480 that are drawn are
  zeroed, as MilkDrop does, and the default wave's vertex counts start from those 480 rather
  than 512. A spectrum wave's two values are now the left and right spectra. A third of the
  corpus (33.1%) has a custom wave with more than 480 samples, which in MilkDrop reads before the
  start of its array; where that read lands on the other channel it is reproduced exactly, and
  beyond both channels it reads zero.

---

## Building and distribution

```bash
npm run icons
```

```bash
npm run dist:win
```

```bash
npm run dist:mac:arm64
```

```bash
npm run dist:linux
```

| Platform | Output | Built on |
|----------|--------|----------|
| Windows | `CAYADEV Visualizer Setup ….exe` (installer), `…-portable.exe` | Windows |
| macOS | `….dmg` and `….zip` (the `.app` inside) — Apple Silicon | macOS |
| Linux | `….AppImage` and `….deb` — x64 | Linux |

**Every platform builds on itself.** `audify` is a native module and **cannot be cross-compiled**: a
macOS package produced on Windows shows the interface but captures no audio. The GitHub Actions
workflow therefore builds macOS on `macos-latest` and Linux on `ubuntu-latest`. Windows is built
locally instead of in CI, because the installer registers the Dynamic Lighting identity and that
needs a certificate the runner does not have — a CI-built installer would be a different product.

### macOS first launch

**macOS packages are unsigned** and not notarised. macOS quarantines unsigned downloads and reports
them as *damaged and can’t be opened*; right-clicking and choosing **Open** does not clear that on
macOS 15 or later. Drag the app to Applications and remove the flag once:

```bash
xattr -dr com.apple.quarantine "/Applications/CAYADEV Visualizer.app"
```

It then opens normally every time. Capturing system audio there also needs a virtual device such as
**BlackHole**.

**Linux** needs PulseAudio or PipeWire. The `.deb` declares `libpulse0` among its dependencies; the
AppImage expects the same library to already be present.

### Publishing the files to a release

The description next to each file in a release's asset list is written with
`gh release upload file#label`. The table lives in a script:

```bash
npm run release:assets -- v3.1.3 --dir=<the folder CI artifacts were downloaded into>
```

It looks for every expected file in `dist/` and in the folders given with `--dir`, refuses to upload
anything unless all of them are present, and re-reads the release afterwards to confirm each label
was written. Add `--dry-run` to see what would be uploaded, `--check` to audit a published release,
and `--partial` when a partial upload really is intended.

### Regenerating the screenshots

```bash
npm start -- --shots
```

Renders every panel, scene, clip and mode sheet on this page into `docs/screenshots/`, in English,
from a synthetic signal. It never captures real audio, never opens the camera, never writes your
settings, and uses typed-in track details rather than whatever is playing. `--only=<name>` limits it
to matching files.

---

## Tests

```bash
npm test
```

```bash
npm start -- --smoke
```

**2925 unit tests, all passing.** They are written to check answers, not to exercise lines:

- **Formulas** are checked against values derived by hand from their definitions — Viviani's curve
  staying on its sphere, the torus tube radius, Chladni's m↔n antisymmetry, every attractor staying
  bounded and landing inside the view volume.
- **Tempo** is measured against synthetic signals of known BPM (90/120/128/140/174 →
  89.8/120.4/127.9/140.0/173.7).
- **Analysis** is tested against signals with known answers: a known chord must come back as that
  chord, a 220 Hz tone as 220 Hz.
- **Art-Net** is verified byte by byte against the ArtDMX header.
- **Config migration** loads 1.3 and 2.0 settings files without losing a value.
- **Fuzzing** the preset and pack loaders asserts no MilkDrop preset can smuggle JavaScript.
- **MCP coverage** fails when a new setting or feature is added without a matching tool or path rule.

**The GPU self-test** runs the real application on a real GPU. It draws every registered visualizer
mode and background and checks that each one builds its canvas and that shader-based modes compiled;
measures that every effect and every 3D formula leaves a non-blank picture; compiles every built-in
Studio shader; loses and restores the WebGL context of MilkDrop, the gradient background and the
effect chain; loads the OBS overlay from the real stream server; switches the interface to English
and scans for untranslated strings; and asserts that automation never opens the camera.

CI runs the unit tests on Windows and Ubuntu with Node 20 and 22 on every pull request.

### Performance benchmark

```bash
npm run bench
```

The benchmark measures the frame time of every visualizer, background and post effect in the real
visualizer page, with vsync on as in the app and the same synthetic audio every time. It never
touches your settings or lights. `--soak=<minutes>` adds a long switching run that samples the frame
rate and the JavaScript heap each minute. On the reference laptop (Ryzen 9 8940HX, RTX 5070 Laptop,
75 Hz), 136 of the 139 scenes that draw without user content hold the refresh rate (95% of 75 Hz)
at 1920×1080; Wave Field (39 fps), Voronoi (63) and Wave Interference (71) do not. A 10-minute
switching run stayed at 73–75 fps with a flat 6–8 MB heap. How it works, its options and the full
tables are in [docs/BENCHMARKS.md](docs/BENCHMARKS.md).

---

## Project structure

```
src/
  main/        Electron main process: windows, audio capture, IPC, stream and MCP servers
  admin/       Control panel
  visualizer/  Output window: layer stack, modes, effects
  exporter/    Offline, deterministic video export
  shared/      Engines with no DOM: spectrum, modulation, analysis, formulas,
               transitions, warp, MilkDrop, templates, lyrics, timeline, clip deck
  web/         OBS overlay and the phone remote
native/        Audio helpers (per-application capture, Dynamic Lighting identity)
scripts/       Build, release, benchmark, MilkDrop corpus and render harnesses
tests/         Unit tests, run by `npm test`
docs/          Screenshots and benchmark results
```

Shared engines are plain arithmetic with no DOM, GPU or audio device, so their tests run in Node.

---

## Shortcuts

| Key | Action |
|-----|--------|
| `ESC` | Close every visualization window |
| `F11` | Toggle full screen |
| `Space` | Blackout |
| `Ctrl` + `S` | PNG snapshot |
| `Ctrl` + `R` | Start / stop recording |
| `Ctrl` + `K` | Search all settings (panel) |
| `Ctrl` + `Shift` + `Q` | Close the visualizer when the ESC lock is on |
| `K` + two digits | Launch a MilkDrop sprite (visualizer window) |

The timeline editor and the clip deck have their own shortcuts, listed in their panels.

---

## Roadmap

[ROADMAP.md](ROADMAP.md) records what has actually shipped and what each planned release is for —
Timeline and Clip Deck in v3.1.0, cross-platform builds with OpenRGB and Spout/Syphon in v3.1.1, the
MilkDrop shader engine in v3.1.2, per-application audio capture and aspect correction in v3.1.3, and
the streaming overlay and transparency fixes with MilkDrop fidelity in v3.1.4. Next are MilkDrop and
streaming refinements in v3.1.5, a far broader and much faster video export in v3.1.6, the broadcast
layout editor in v3.1.7 and redundancy with frame sync in v3.2.0. It also keeps an honest list of
what is *not* done, and why.

---

## License

MIT — see [LICENSE](LICENSE). Copyright (c) 2026 Çağan Turgut ([CaYatur](https://github.com/CaYatur)) — CaYaDev.

<div align="center">

**[cayadev.com](https://cayadev.com)**

<sub>Keywords: music visualizer · audio visualizer · sound visualizer · VJ software · MilkDrop · projectM alternative · OBS overlay · Spotify visualizer · desktop visualizer · multi-monitor · projection mapping · Spout · Syphon · WebGL · Electron · MCP</sub>

</div>
