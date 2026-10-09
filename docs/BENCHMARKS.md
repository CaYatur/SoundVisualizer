# Performance benchmarks

`npm run bench` measures the frame time of every visualizer, every background and every post
effect in the real visualizer page, and can run a long session to show whether anything builds up
over time.

```bash
npm run bench                          # every scene, 1920×1080 canvas
npm run bench -- --native              # also at the screen's full size
npm run bench -- --only=milkdrop       # scenes whose group:id contains the text
npm run bench -- --soak=20             # then 20 minutes of switching, sampled each minute
npm run bench -- --scenes=background:wavefield,background:solid   # these scenes, in this order
npm run bench -- --seconds=5 --warm=2  # longer windows per scene (defaults: 3 s and 1 s)
npm run bench -- --uncapped            # frame-rate limit off: headroom instead of dropped frames
npm run bench -- --sizes=1280x720,1920x1080
npm run bench -- --json=run.json --md=run.md --shots=shots/
```

## What it measures

- **The real rendering path.** The script opens the application's own visualizer page
  (`src/visualizer/index.html`) with its own preload, so layers, compositing, the effect chain and
  the frame-rate logic are the ones users run. The application's main process is not loaded. The
  script answers the page's requests itself, with an empty preset library, no textures and no
  camera. Your settings, lights, MCP and Spout are never touched, and the run uses a temporary user
  data folder.
- **Synthetic audio.** Every scene receives the same deterministic 120 BPM signal at about 70 frames
  a second, the rate of the real capture helper. It is the same signal the panel preview and the
  screenshot tool use. In silence most modes do almost no work, and the figures would understate
  them.
- **What users see.** Vsync stays on, as in the application. A scene that keeps up reads the
  refresh rate; one that cannot drops frames and reads lower. The refresh rate in the report is
  measured, not taken from the display: on Windows, Chromium ties every window to the primary
  display's vsync, so a window on a 165 Hz screen ran at the 75 Hz of the primary one. *fps* is
  frames over measured time, *p95* the 95th-percentile frame time, *> 33 ms* the share of frames
  slower than 30 fps.
- **Headroom, on request.** `--uncapped` turns the frame-rate limit and vsync off, so cheap scenes
  read hundreds of frames a second. Read these figures with care. A scene that saturates the GPU
  leaves queued work behind, and that work lands in the first seconds of the next scene. This was
  measured with transitions off: right after Wavefield, Solid ran at 50 fps with a 142 ms p95
  uncapped, and at the full 75 fps with vsync on.
- **Each scene alone**, with no layers and with scene transitions off: a visualizer over the
  default background, a background under Bars, or one effect at a time over Bars. With
  transitions on, the previous scene keeps drawing during the crossfade and its cost is counted in
  the next scene. `--shots` saves the last frame of each scene, as proof
  that it drew.
- **The long run** (`--soak`) switches to the next visualizer every 2 seconds, the way Auto VJ does,
  and records fps, p95 and the JavaScript heap after a forced garbage collection, once a minute.

MilkDrop has its own, deeper tools: `scripts/milkdrop-render-rate.js` (does every preset draw a
picture), `scripts/milkdrop-compile-rate.js` (does every shader compile) and
`scripts/milkdrop-switch-cost.js` (what a preset change costs).

## Reading the numbers

The figures belong to the machine they were measured on. They are for comparing a change before and
after on the same machine, not for comparing machines. Measure with the machine idle: a game or a
video using the GPU skews every row. The window cannot be larger than the screen, so a size the
screen cannot hold is measured at the largest size it allows, and the report says so.

## Results

Measured on 2026-10-09 with vsync on (75 Hz, measured). The window was on the 2560×1602 screen; the
full-screen pass was cut to 1533 rows by the taskbar. A scene *holds* the refresh rate when it
reaches 95% of it (71.25 fps). Three scenes draw nothing without user content (Now Playing with no
track, and the custom visualizer and background with no shader); they are marked in the tables and
left out of the counts.

- **1920×1080:** 136 of 139 scenes hold 75 Hz. Below it: Wave Field 39 fps, Voronoi 63, Wave
  Interference 71.
- **2562×1533:** 132 of 139 hold it. Below it: Wave Field 23, Wave Interference 45, Plasma 56,
  Liquid Metal 60, Caustics 62, Pulse Rings 65, Halftone 68.
- **Long run**, in the full-screen window: 10 minutes, 299 switches between all 56 cycling
  visualizers. 73.4–74.9 fps each minute, JavaScript heap 6.0–7.7 MB after garbage collection, no
  growth.
- No frame over 200 ms, and no console error in any scene. The error capture was checked by
  injecting a `console.error` and an uncaught exception, and both were caught.

Wave Field's cost was traced by turning parts of its drawing off. Its 26 rows each fill and stroke
a 96-point path over most of the screen. Without the fills it reaches 57 fps, without the strokes
63, and without both 75. The canvas is not read back, so it stays on the GPU. The time goes into
rasterising large anti-aliased paths every frame.

### npm run bench — 2026-10-09

- Script: `scripts/bench.js` as committed with this file (on `157436e`), Electron 43.6.0, Windows_NT 10.0.28020 x64
- CPU: AMD Ryzen 9 8940HX with Radeon Graphics (32 threads), RAM 29 GB
- GPU: ANGLE (NVIDIA, NVIDIA GeForce RTX 5070 Laptop GPU (0x00002D58) Direct3D11 vs_5_0 ps_5_0, D3D11-32.0.16.1686), driver 32.0.16.1686
- Display: 2560×1602 @ 165 Hz, scale 1.5
- Vsync **on**: a scene that keeps up reads the refresh rate (75 Hz); a lower figure means dropped frames
- Each scene: 1 s warm-up, 3 s measured, synthetic 120 BPM audio

#### 1920×1080 (canvas 1923×1085)

**Visualizers (over the default background)**

| Scene | fps | avg ms | p95 ms | max ms | > 33 ms |
|---|---:|---:|---:|---:|---:|
| Voronoi (`voronoi`) | 63.0 | 15.88 | 26.70 | 40.2 | 1.6% |
| Wave Interference (`interference`) | 71.0 | 14.09 | 26.60 | 26.8 | 0.0% |
| Fireworks (`fireworks`) | 75.0 | 13.34 | 13.50 | 13.6 | 0.0% |
| Galaxy (`galaxy`) | 75.0 | 13.34 | 13.50 | 13.5 | 0.0% |
| Helix (`helix`) | 75.0 | 13.34 | 13.50 | 13.7 | 0.0% |
| Liquid Drop (`metaball`) | 75.0 | 13.34 | 13.50 | 13.7 | 0.0% |
| Radial Wave (`radialWave`) | 75.0 | 13.34 | 13.50 | 13.8 | 0.0% |
| Ropes (`ropes`) | 75.0 | 13.34 | 13.50 | 13.9 | 0.0% |
| Arcs (`arcs`) | 75.0 | 13.34 | 13.40 | 13.7 | 0.0% |
| Attractor Field (`attractorfield`) | 75.0 | 13.34 | 13.40 | 13.6 | 0.0% |
| Bars (`bars`) | 75.0 | 13.34 | 13.40 | 13.5 | 0.0% |
| Beat Pads (`beatpads`) | 75.0 | 13.34 | 13.40 | 13.5 | 0.0% |
| Blocks (`blocks`) | 75.0 | 13.34 | 13.40 | 13.5 | 0.0% |
| Bouncing Balls (`bounce`) | 75.0 | 13.34 | 13.40 | 13.6 | 0.0% |
| Bubbles (`bubbles`) | 75.0 | 13.34 | 13.40 | 13.6 | 0.0% |
| Cardioid (`cardioid`) | 75.0 | 13.34 | 13.40 | 13.6 | 0.0% |
| Center (`centerBars`) | 75.0 | 13.34 | 13.40 | 13.6 | 0.0% |
| Chroma Wheel (`chromawheel`) | 75.0 | 13.34 | 13.40 | 13.5 | 0.0% |
| Circle (`circular`) | 75.0 | 13.34 | 13.40 | 13.5 | 0.0% |
| Confetti (`confetti`) | 75.0 | 13.34 | 13.40 | 13.5 | 0.0% |
| Studio (`custom`) — draws nothing without user content | 75.0 | 13.34 | 13.40 | 13.6 | 0.0% |
| DJ Waveform (`djwave`) | 75.0 | 13.34 | 13.40 | 13.5 | 0.0% |
| DNA Helix (`dna`) | 75.0 | 13.34 | 13.40 | 13.5 | 0.0% |
| Dot Matrix (`dots`) | 75.0 | 13.34 | 13.40 | 13.6 | 0.0% |
| Feedback (`feedback`) | 75.0 | 13.34 | 13.40 | 13.6 | 0.0% |
| Flock (`flock`) | 75.0 | 13.34 | 13.40 | 13.6 | 0.0% |
| Flow Field (`flowfield`) | 75.0 | 13.34 | 13.40 | 13.5 | 0.0% |
| 3D Geometry (`geometry`) | 75.0 | 13.34 | 13.40 | 13.5 | 0.0% |
| Goniometer (`goniometer`) | 75.0 | 13.34 | 13.40 | 13.6 | 0.0% |
| Isometric City (`isocity`) | 75.0 | 13.34 | 13.40 | 15.8 | 0.0% |
| Kaleidoscope (`kaleido`) | 75.0 | 13.34 | 13.40 | 13.5 | 0.0% |
| Level Meter (PPM) (`levelmeter`) | 75.0 | 13.34 | 13.40 | 13.5 | 0.0% |
| Lightning (`lightning`) | 75.0 | 13.34 | 13.40 | 13.5 | 0.0% |
| Lissajous (`lissajous`) | 75.0 | 13.34 | 13.40 | 14.5 | 0.0% |
| Mandala (`mandala`) | 75.0 | 13.34 | 13.40 | 13.8 | 0.0% |
| MilkDrop (`milkdrop`) | 75.0 | 13.34 | 13.40 | 13.5 | 0.0% |
| Moiré (`moire`) | 75.0 | 13.34 | 13.40 | 13.5 | 0.0% |
| Now Playing (`nowplaying`) — draws nothing without user content | 75.0 | 13.34 | 13.40 | 15.4 | 0.0% |
| Orb (`orb`) | 75.0 | 13.34 | 13.40 | 13.7 | 0.0% |
| Particle (`particles`) | 75.0 | 13.34 | 13.40 | 13.5 | 0.0% |
| Pendulum Wave (`pendulum`) | 75.0 | 13.34 | 13.40 | 13.6 | 0.0% |
| Pinwheel (`pinwheel`) | 75.0 | 13.34 | 13.40 | 13.9 | 0.0% |
| Radar Chart (`radar`) | 75.0 | 13.34 | 13.40 | 13.5 | 0.0% |
| Ribbon (`ribbon`) | 75.0 | 13.34 | 13.40 | 13.6 | 0.0% |
| Ridgelines (`ridges`) | 75.0 | 13.34 | 13.40 | 13.5 | 0.0% |
| Ripple Grid (`ripplegrid`) | 75.0 | 13.34 | 13.40 | 13.6 | 0.0% |
| Oscilloscope (XY) (`scope`) | 75.0 | 13.34 | 13.40 | 13.6 | 0.0% |
| City Skyline (`skyline`) | 75.0 | 13.34 | 13.40 | 13.6 | 0.0% |
| Spectrogram (`spectrogram`) | 75.0 | 13.34 | 13.40 | 13.6 | 0.0% |
| Starburst (`starburst`) | 74.3 | 13.46 | 13.40 | 26.7 | 0.0% |
| Strings (`strings`) | 75.0 | 13.34 | 13.40 | 13.5 | 0.0% |
| Terrain (`terrain`) | 75.0 | 13.34 | 13.40 | 13.6 | 0.0% |
| Text / Lyrics (`text`) | 75.0 | 13.34 | 13.40 | 13.5 | 0.0% |
| Truchet (`truchet`) | 75.0 | 13.34 | 13.40 | 13.5 | 0.0% |
| Tunnel (`tunnel`) | 75.0 | 13.34 | 13.40 | 13.6 | 0.0% |
| Vortex (`vortex`) | 75.0 | 13.34 | 13.40 | 13.5 | 0.0% |
| VU Meter (`vumeter`) | 75.0 | 13.34 | 13.40 | 13.5 | 0.0% |
| Wave (`wave`) | 75.0 | 13.34 | 13.40 | 13.5 | 0.0% |
| 3D Wave (`wave3d`) | 75.0 | 13.34 | 13.40 | 15.3 | 0.0% |

**Backgrounds (with the Bars visualizer)**

| Scene | fps | avg ms | p95 ms | max ms | > 33 ms |
|---|---:|---:|---:|---:|---:|
| Wave Field (`wavefield`) | 39.2 | 25.53 | 40.00 | 40.1 | 10.3% |
| Nebula (`nebula`) | 75.0 | 13.34 | 13.50 | 13.6 | 0.0% |
| Pulse Rings (`rings`) | 73.3 | 13.64 | 13.50 | 26.7 | 0.0% |
| Northern Lights (`aurora`) | 75.0 | 13.34 | 13.40 | 13.5 | 0.0% |
| Light Particles (`bokeh`) | 75.0 | 13.34 | 13.40 | 13.5 | 0.0% |
| Caustics (`caustics`) | 75.0 | 13.34 | 13.40 | 13.5 | 0.0% |
| Circuit Board (`circuit`) | 75.0 | 13.34 | 13.40 | 13.5 | 0.0% |
| City (`city`) | 75.0 | 13.34 | 13.40 | 13.6 | 0.0% |
| Clouds (`clouds`) | 75.0 | 13.34 | 13.40 | 13.5 | 0.0% |
| Contours (`contours`) | 75.0 | 13.34 | 13.40 | 13.5 | 0.0% |
| Corridor (`corridor`) | 75.0 | 13.34 | 13.40 | 13.8 | 0.0% |
| Isometric Cubes (`cubes`) | 75.0 | 13.34 | 13.40 | 16.4 | 0.0% |
| Studio (`custom`) — draws nothing without user content | 75.0 | 13.34 | 13.40 | 13.5 | 0.0% |
| Embers (`embers`) | 75.0 | 13.34 | 13.40 | 13.5 | 0.0% |
| Fireflies (`fireflies`) | 75.0 | 13.34 | 13.40 | 15.6 | 0.0% |
| Globe Mesh (`globe`) | 75.0 | 13.34 | 13.40 | 13.5 | 0.0% |
| Fluid Gradient (`gradient`) | 75.0 | 13.34 | 13.40 | 13.5 | 0.0% |
| Retro Grid (`grid`) | 75.0 | 13.34 | 13.40 | 13.6 | 0.0% |
| Halftone (`halftone`) | 74.6 | 13.40 | 13.40 | 26.7 | 0.0% |
| Honeycomb Grid (`hexgrid`) | 75.0 | 13.34 | 13.40 | 13.5 | 0.0% |
| Hex Pulse (`hexpulse`) | 75.0 | 13.34 | 13.40 | 13.6 | 0.0% |
| Ink (`ink`) | 75.0 | 13.34 | 13.40 | 13.6 | 0.0% |
| Lava Lamp (`lavalamp`) | 75.0 | 13.34 | 13.40 | 16.1 | 0.0% |
| Liquid Metal (`liquid`) | 75.0 | 13.34 | 13.40 | 13.6 | 0.0% |
| Low Poly (`lowpoly`) | 75.0 | 13.34 | 13.40 | 13.5 | 0.0% |
| Mirror Pattern (`mirror`) | 75.0 | 13.34 | 13.40 | 13.5 | 0.0% |
| Mosaic (`mosaic`) | 75.0 | 13.34 | 13.40 | 13.4 | 0.0% |
| Network (`network`) | 74.6 | 13.40 | 13.40 | 26.7 | 0.0% |
| Plasma (`plasma`) | 75.0 | 13.34 | 13.40 | 13.5 | 0.0% |
| Prism (`prism`) | 75.0 | 13.34 | 13.40 | 13.6 | 0.0% |
| Digital Rain (`rain`) | 75.0 | 13.34 | 13.40 | 13.5 | 0.0% |
| Ribbons (`ribbons`) | 75.0 | 13.34 | 13.40 | 13.5 | 0.0% |
| Sand (`sand`) | 75.0 | 13.34 | 13.40 | 13.7 | 0.0% |
| Snow / Embers (`snow`) | 75.0 | 13.34 | 13.40 | 13.5 | 0.0% |
| Solid Color (`solid`) | 75.0 | 13.34 | 13.40 | 13.8 | 0.0% |
| Spiral (`spiral`) | 75.0 | 13.34 | 13.40 | 13.5 | 0.0% |
| Stage Lights (`spotlights`) | 75.0 | 13.34 | 13.40 | 13.5 | 0.0% |
| Stained Glass (`stained`) | 75.0 | 13.34 | 13.40 | 13.5 | 0.0% |
| Starfield (`starfield`) | 75.0 | 13.34 | 13.40 | 13.6 | 0.0% |
| Storm (`storm`) | 75.0 | 13.34 | 13.40 | 13.5 | 0.0% |
| Underwater (`underwater`) | 75.0 | 13.34 | 13.40 | 13.8 | 0.0% |
| Wave Layers (`waves`) | 75.0 | 13.34 | 13.40 | 13.5 | 0.0% |
| Wire Tunnel (`wireframe`) | 75.0 | 13.34 | 13.40 | 13.5 | 0.0% |

**Post effects (one at a time, over Bars)**

| Scene | fps | avg ms | p95 ms | max ms | > 33 ms |
|---|---:|---:|---:|---:|---:|
| `ascii` | 75.0 | 13.34 | 13.40 | 13.5 | 0.0% |
| `badtv` | 75.0 | 13.34 | 13.40 | 13.5 | 0.0% |
| `bloom` | 75.0 | 13.34 | 13.40 | 13.5 | 0.0% |
| `blur` | 75.0 | 13.34 | 13.40 | 13.5 | 0.0% |
| `chroma` | 75.0 | 13.34 | 13.40 | 13.5 | 0.0% |
| `crt` | 75.0 | 13.34 | 13.40 | 13.4 | 0.0% |
| `datamosh` | 75.0 | 13.34 | 13.40 | 13.5 | 0.0% |
| `dither` | 75.0 | 13.34 | 13.40 | 16.2 | 0.0% |
| `dof` | 75.0 | 13.34 | 13.40 | 13.5 | 0.0% |
| `edge` | 75.0 | 13.34 | 13.40 | 13.5 | 0.0% |
| `emboss` | 75.0 | 13.34 | 13.40 | 13.5 | 0.0% |
| `glitch` | 75.0 | 13.34 | 13.40 | 13.6 | 0.0% |
| `godrays` | 75.0 | 13.34 | 13.40 | 13.5 | 0.0% |
| `grade` | 75.0 | 13.34 | 13.40 | 13.5 | 0.0% |
| `gradientmap` | 75.0 | 13.34 | 13.40 | 13.5 | 0.0% |
| `grain` | 75.0 | 13.34 | 13.40 | 13.5 | 0.0% |
| `halftone` | 75.0 | 13.34 | 13.40 | 13.5 | 0.0% |
| `hatch` | 75.0 | 13.34 | 13.40 | 13.5 | 0.0% |
| `kaleido` | 75.0 | 13.34 | 13.40 | 13.5 | 0.0% |
| `lens` | 75.0 | 13.34 | 13.40 | 13.5 | 0.0% |
| `levels` | 75.0 | 13.34 | 13.40 | 13.7 | 0.0% |
| `mirror` | 75.0 | 13.34 | 13.40 | 13.5 | 0.0% |
| `motionblur` | 75.0 | 13.34 | 13.40 | 13.6 | 0.0% |
| `paint` | 75.0 | 13.34 | 13.40 | 13.5 | 0.0% |
| `pixelate` | 75.0 | 13.34 | 13.40 | 13.5 | 0.0% |
| `polar` | 75.0 | 13.34 | 13.40 | 13.7 | 0.0% |
| `posterize` | 75.0 | 13.34 | 13.40 | 13.5 | 0.0% |
| `radialblur` | 75.0 | 13.34 | 13.40 | 13.6 | 0.0% |
| `ripple` | 75.0 | 13.34 | 13.40 | 13.5 | 0.0% |
| `sharpen` | 75.0 | 13.34 | 13.40 | 13.5 | 0.0% |
| `slitscan` | 75.0 | 13.34 | 13.40 | 13.5 | 0.0% |
| `solarize` | 75.0 | 13.34 | 13.40 | 13.5 | 0.0% |
| `starfilter` | 75.0 | 13.34 | 13.40 | 13.5 | 0.0% |
| `threshold` | 75.0 | 13.34 | 13.40 | 13.5 | 0.0% |
| `tiltshift` | 75.0 | 13.34 | 13.40 | 13.5 | 0.0% |
| `trails` | 75.0 | 13.34 | 13.40 | 13.5 | 0.0% |
| `twirl` | 75.0 | 13.34 | 13.40 | 13.5 | 0.0% |
| `vhs` | 75.0 | 13.34 | 13.40 | 13.5 | 0.0% |
| `vignette` | 75.0 | 13.34 | 13.40 | 13.6 | 0.0% |
| `zoomblur` | 75.0 | 13.34 | 13.40 | 16.5 | 0.0% |

#### full screen 2561×1602 (canvas 2562×1533)

_requested 2561×1602; the window could not be that large on this screen._

**Visualizers (over the default background)**

| Scene | fps | avg ms | p95 ms | max ms | > 33 ms |
|---|---:|---:|---:|---:|---:|
| Wave Interference (`interference`) | 44.8 | 22.33 | 26.80 | 26.8 | 0.0% |
| Cardioid (`cardioid`) | 72.3 | 13.83 | 13.50 | 26.7 | 0.0% |
| Studio (`custom`) — draws nothing without user content | 75.0 | 13.34 | 13.50 | 13.5 | 0.0% |
| MilkDrop (`milkdrop`) | 75.0 | 13.34 | 13.50 | 13.5 | 0.0% |
| Pendulum Wave (`pendulum`) | 75.0 | 13.34 | 13.50 | 13.7 | 0.0% |
| 3D Wave (`wave3d`) | 75.0 | 13.34 | 13.50 | 13.6 | 0.0% |
| Arcs (`arcs`) | 75.0 | 13.34 | 13.40 | 13.5 | 0.0% |
| Attractor Field (`attractorfield`) | 75.0 | 13.34 | 13.40 | 13.5 | 0.0% |
| Bars (`bars`) | 75.0 | 13.34 | 13.40 | 17.1 | 0.0% |
| Beat Pads (`beatpads`) | 75.0 | 13.34 | 13.40 | 13.7 | 0.0% |
| Blocks (`blocks`) | 75.0 | 13.34 | 13.40 | 13.5 | 0.0% |
| Bouncing Balls (`bounce`) | 75.0 | 13.34 | 13.40 | 13.6 | 0.0% |
| Bubbles (`bubbles`) | 75.0 | 13.34 | 13.40 | 13.5 | 0.0% |
| Center (`centerBars`) | 75.0 | 13.34 | 13.40 | 13.6 | 0.0% |
| Chroma Wheel (`chromawheel`) | 75.0 | 13.34 | 13.40 | 13.5 | 0.0% |
| Circle (`circular`) | 75.0 | 13.34 | 13.40 | 13.7 | 0.0% |
| Confetti (`confetti`) | 75.0 | 13.34 | 13.40 | 13.5 | 0.0% |
| DJ Waveform (`djwave`) | 75.0 | 13.34 | 13.40 | 13.5 | 0.0% |
| DNA Helix (`dna`) | 75.0 | 13.34 | 13.40 | 13.5 | 0.0% |
| Dot Matrix (`dots`) | 75.0 | 13.34 | 13.40 | 13.5 | 0.0% |
| Feedback (`feedback`) | 75.0 | 13.34 | 13.40 | 13.5 | 0.0% |
| Fireworks (`fireworks`) | 75.0 | 13.34 | 13.40 | 13.6 | 0.0% |
| Flock (`flock`) | 75.0 | 13.34 | 13.40 | 13.5 | 0.0% |
| Flow Field (`flowfield`) | 75.0 | 13.34 | 13.40 | 13.6 | 0.0% |
| Galaxy (`galaxy`) | 75.0 | 13.34 | 13.40 | 13.5 | 0.0% |
| 3D Geometry (`geometry`) | 75.0 | 13.34 | 13.40 | 13.5 | 0.0% |
| Goniometer (`goniometer`) | 75.0 | 13.34 | 13.40 | 13.6 | 0.0% |
| Helix (`helix`) | 75.0 | 13.34 | 13.40 | 13.6 | 0.0% |
| Isometric City (`isocity`) | 75.0 | 13.34 | 13.40 | 13.6 | 0.0% |
| Kaleidoscope (`kaleido`) | 75.0 | 13.34 | 13.40 | 13.5 | 0.0% |
| Level Meter (PPM) (`levelmeter`) | 75.0 | 13.34 | 13.40 | 13.6 | 0.0% |
| Lightning (`lightning`) | 75.0 | 13.34 | 13.40 | 13.5 | 0.0% |
| Lissajous (`lissajous`) | 75.0 | 13.34 | 13.40 | 13.6 | 0.0% |
| Mandala (`mandala`) | 75.0 | 13.34 | 13.40 | 13.5 | 0.0% |
| Liquid Drop (`metaball`) | 75.0 | 13.34 | 13.40 | 13.6 | 0.0% |
| Moiré (`moire`) | 75.0 | 13.34 | 13.40 | 13.5 | 0.0% |
| Now Playing (`nowplaying`) — draws nothing without user content | 75.0 | 13.34 | 13.40 | 13.5 | 0.0% |
| Orb (`orb`) | 75.0 | 13.34 | 13.40 | 13.6 | 0.0% |
| Particle (`particles`) | 75.0 | 13.34 | 13.40 | 13.5 | 0.0% |
| Pinwheel (`pinwheel`) | 75.0 | 13.34 | 13.40 | 18.2 | 0.0% |
| Radar Chart (`radar`) | 75.0 | 13.34 | 13.40 | 13.5 | 0.0% |
| Radial Wave (`radialWave`) | 75.0 | 13.34 | 13.40 | 13.6 | 0.0% |
| Ribbon (`ribbon`) | 75.0 | 13.34 | 13.40 | 13.5 | 0.0% |
| Ridgelines (`ridges`) | 75.0 | 13.34 | 13.40 | 13.6 | 0.0% |
| Ripple Grid (`ripplegrid`) | 75.0 | 13.34 | 13.40 | 16.7 | 0.0% |
| Ropes (`ropes`) | 75.0 | 13.34 | 13.40 | 13.5 | 0.0% |
| Oscilloscope (XY) (`scope`) | 75.0 | 13.34 | 13.40 | 13.5 | 0.0% |
| City Skyline (`skyline`) | 75.0 | 13.34 | 13.40 | 13.6 | 0.0% |
| Spectrogram (`spectrogram`) | 75.0 | 13.34 | 13.40 | 13.5 | 0.0% |
| Starburst (`starburst`) | 74.3 | 13.46 | 13.40 | 26.7 | 0.0% |
| Strings (`strings`) | 75.0 | 13.34 | 13.40 | 13.7 | 0.0% |
| Terrain (`terrain`) | 75.0 | 13.34 | 13.40 | 13.8 | 0.0% |
| Text / Lyrics (`text`) | 75.0 | 13.34 | 13.40 | 13.5 | 0.0% |
| Truchet (`truchet`) | 75.0 | 13.34 | 13.40 | 13.5 | 0.0% |
| Tunnel (`tunnel`) | 75.0 | 13.34 | 13.40 | 13.6 | 0.0% |
| Voronoi (`voronoi`) | 73.0 | 13.70 | 13.40 | 40.0 | 0.5% |
| Vortex (`vortex`) | 75.0 | 13.34 | 13.40 | 13.5 | 0.0% |
| VU Meter (`vumeter`) | 75.0 | 13.34 | 13.40 | 18.5 | 0.0% |
| Wave (`wave`) | 75.0 | 13.34 | 13.40 | 17.2 | 0.0% |

**Backgrounds (with the Bars visualizer)**

| Scene | fps | avg ms | p95 ms | max ms | > 33 ms |
|---|---:|---:|---:|---:|---:|
| Wave Field (`wavefield`) | 22.8 | 43.80 | 53.40 | 66.6 | 98.5% |
| Caustics (`caustics`) | 62.0 | 16.12 | 26.70 | 26.8 | 0.0% |
| Halftone (`halftone`) | 68.3 | 14.65 | 26.70 | 26.8 | 0.0% |
| Liquid Metal (`liquid`) | 60.0 | 16.65 | 26.70 | 26.8 | 0.0% |
| Plasma (`plasma`) | 56.4 | 17.73 | 26.70 | 26.9 | 0.0% |
| Pulse Rings (`rings`) | 65.2 | 15.33 | 26.70 | 40.0 | 0.5% |
| Light Particles (`bokeh`) | 75.0 | 13.34 | 13.50 | 13.5 | 0.0% |
| Circuit Board (`circuit`) | 75.0 | 13.34 | 13.50 | 13.7 | 0.0% |
| Corridor (`corridor`) | 75.0 | 13.34 | 13.50 | 13.5 | 0.0% |
| Embers (`embers`) | 75.0 | 13.34 | 13.50 | 13.5 | 0.0% |
| Fluid Gradient (`gradient`) | 75.0 | 13.34 | 13.50 | 13.6 | 0.0% |
| Ink (`ink`) | 75.0 | 13.34 | 13.50 | 13.6 | 0.0% |
| Lava Lamp (`lavalamp`) | 75.0 | 13.34 | 13.50 | 13.6 | 0.0% |
| Prism (`prism`) | 75.0 | 13.34 | 13.50 | 13.5 | 0.0% |
| Spiral (`spiral`) | 75.0 | 13.34 | 13.50 | 17.1 | 0.0% |
| Storm (`storm`) | 75.0 | 13.34 | 13.50 | 13.5 | 0.0% |
| Wave Layers (`waves`) | 75.0 | 13.34 | 13.50 | 13.5 | 0.0% |
| Northern Lights (`aurora`) | 75.0 | 13.34 | 13.40 | 14.5 | 0.0% |
| City (`city`) | 75.0 | 13.34 | 13.40 | 13.6 | 0.0% |
| Clouds (`clouds`) | 75.0 | 13.34 | 13.40 | 13.5 | 0.0% |
| Contours (`contours`) | 75.0 | 13.34 | 13.40 | 13.5 | 0.0% |
| Isometric Cubes (`cubes`) | 75.0 | 13.34 | 13.40 | 13.5 | 0.0% |
| Studio (`custom`) — draws nothing without user content | 75.0 | 13.34 | 13.40 | 13.5 | 0.0% |
| Fireflies (`fireflies`) | 75.0 | 13.34 | 13.40 | 18.3 | 0.0% |
| Globe Mesh (`globe`) | 75.0 | 13.34 | 13.40 | 13.5 | 0.0% |
| Retro Grid (`grid`) | 75.0 | 13.34 | 13.40 | 13.8 | 0.0% |
| Honeycomb Grid (`hexgrid`) | 75.0 | 13.34 | 13.40 | 13.5 | 0.0% |
| Hex Pulse (`hexpulse`) | 75.0 | 13.34 | 13.40 | 13.5 | 0.0% |
| Low Poly (`lowpoly`) | 75.0 | 13.34 | 13.40 | 13.5 | 0.0% |
| Mirror Pattern (`mirror`) | 75.0 | 13.34 | 13.40 | 13.5 | 0.0% |
| Mosaic (`mosaic`) | 75.0 | 13.34 | 13.40 | 13.5 | 0.0% |
| Nebula (`nebula`) | 75.0 | 13.34 | 13.40 | 13.5 | 0.0% |
| Network (`network`) | 75.0 | 13.34 | 13.40 | 13.5 | 0.0% |
| Digital Rain (`rain`) | 75.0 | 13.34 | 13.40 | 13.5 | 0.0% |
| Ribbons (`ribbons`) | 75.0 | 13.34 | 13.40 | 13.5 | 0.0% |
| Sand (`sand`) | 75.0 | 13.34 | 13.40 | 13.5 | 0.0% |
| Snow / Embers (`snow`) | 75.0 | 13.34 | 13.40 | 13.5 | 0.0% |
| Solid Color (`solid`) | 75.0 | 13.34 | 13.40 | 13.6 | 0.0% |
| Stage Lights (`spotlights`) | 75.0 | 13.34 | 13.40 | 13.5 | 0.0% |
| Stained Glass (`stained`) | 75.0 | 13.34 | 13.40 | 13.5 | 0.0% |
| Starfield (`starfield`) | 75.0 | 13.34 | 13.40 | 13.9 | 0.0% |
| Underwater (`underwater`) | 75.0 | 13.34 | 13.40 | 13.5 | 0.0% |
| Wire Tunnel (`wireframe`) | 75.0 | 13.34 | 13.40 | 13.5 | 0.0% |

**Post effects (one at a time, over Bars)**

| Scene | fps | avg ms | p95 ms | max ms | > 33 ms |
|---|---:|---:|---:|---:|---:|
| `ascii` | 75.0 | 13.34 | 13.50 | 13.5 | 0.0% |
| `crt` | 75.0 | 13.34 | 13.50 | 13.5 | 0.0% |
| `dof` | 75.0 | 13.34 | 13.50 | 13.5 | 0.0% |
| `edge` | 75.0 | 13.34 | 13.50 | 13.5 | 0.0% |
| `emboss` | 75.0 | 13.34 | 13.50 | 13.5 | 0.0% |
| `grain` | 75.0 | 13.34 | 13.50 | 13.5 | 0.0% |
| `hatch` | 75.0 | 13.34 | 13.50 | 14.4 | 0.0% |
| `kaleido` | 75.0 | 13.34 | 13.50 | 13.5 | 0.0% |
| `motionblur` | 75.0 | 13.34 | 13.50 | 13.5 | 0.0% |
| `sharpen` | 75.0 | 13.34 | 13.50 | 13.6 | 0.0% |
| `slitscan` | 75.0 | 13.34 | 13.50 | 13.5 | 0.0% |
| `solarize` | 75.0 | 13.34 | 13.50 | 18.2 | 0.0% |
| `twirl` | 75.0 | 13.34 | 13.50 | 13.5 | 0.0% |
| `vhs` | 75.0 | 13.34 | 13.50 | 13.7 | 0.0% |
| `vignette` | 75.0 | 13.34 | 13.50 | 13.5 | 0.0% |
| `zoomblur` | 75.0 | 13.34 | 13.50 | 13.5 | 0.0% |
| `badtv` | 75.0 | 13.34 | 13.40 | 13.5 | 0.0% |
| `bloom` | 75.0 | 13.34 | 13.40 | 13.6 | 0.0% |
| `blur` | 75.0 | 13.34 | 13.40 | 13.5 | 0.0% |
| `chroma` | 75.0 | 13.34 | 13.40 | 13.5 | 0.0% |
| `datamosh` | 75.0 | 13.34 | 13.40 | 13.5 | 0.0% |
| `dither` | 75.0 | 13.34 | 13.40 | 13.5 | 0.0% |
| `glitch` | 75.0 | 13.34 | 13.40 | 13.5 | 0.0% |
| `godrays` | 75.0 | 13.34 | 13.40 | 13.5 | 0.0% |
| `grade` | 75.0 | 13.34 | 13.40 | 13.5 | 0.0% |
| `gradientmap` | 75.0 | 13.34 | 13.40 | 13.5 | 0.0% |
| `halftone` | 75.0 | 13.34 | 13.40 | 13.5 | 0.0% |
| `lens` | 75.0 | 13.34 | 13.40 | 13.5 | 0.0% |
| `levels` | 75.0 | 13.34 | 13.40 | 13.5 | 0.0% |
| `mirror` | 75.0 | 13.34 | 13.40 | 13.5 | 0.0% |
| `paint` | 75.0 | 13.34 | 13.40 | 13.5 | 0.0% |
| `pixelate` | 75.0 | 13.34 | 13.40 | 13.5 | 0.0% |
| `polar` | 75.0 | 13.34 | 13.40 | 13.5 | 0.0% |
| `posterize` | 75.0 | 13.34 | 13.40 | 13.5 | 0.0% |
| `radialblur` | 75.0 | 13.34 | 13.40 | 13.5 | 0.0% |
| `ripple` | 75.0 | 13.34 | 13.40 | 13.6 | 0.0% |
| `starfilter` | 75.0 | 13.34 | 13.40 | 13.5 | 0.0% |
| `threshold` | 75.0 | 13.34 | 13.40 | 13.6 | 0.0% |
| `tiltshift` | 75.0 | 13.34 | 13.40 | 13.5 | 0.0% |
| `trails` | 75.0 | 13.34 | 13.40 | 13.5 | 0.0% |

#### Long run: 10 min, a new visualizer every 2 s, cycling through all 56 (the way Auto VJ switches)

| Minute | fps | p95 ms | JS heap after GC (MB) |
|---:|---:|---:|---:|
| 1 | 74.9 | 13.40 | 6 |
| 2 | 73.4 | 13.50 | 8 |
| 3 | 74.9 | 13.50 | 6 |
| 4 | 73.7 | 13.50 | 6 |
| 5 | 74.9 | 13.40 | 7 |
| 6 | 73.8 | 13.50 | 7 |
| 7 | 73.9 | 13.50 | 7 |
| 8 | 74.7 | 13.50 | 6 |
| 9 | 73.9 | 13.50 | 6 |
| 10 | 74.8 | 13.40 | 7 |
