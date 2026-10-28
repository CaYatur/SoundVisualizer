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

## Results on a low-end machine

Measured on 2026-10-28 on a 2015 laptop: a two-thread Celeron N3050, 2 GB of RAM, Intel HD
Graphics and a 1366×768 screen at 60 Hz. Only the 1280×720 canvas was measured, with a 2 s
warm-up and 4 s per scene. The run used the application at `4ec3d59` from a copy without git
history, so the script printed `?` as the commit; the header below says so. These figures show
what the application does on very weak hardware. As above, they are not for ranking machines.

- **No scene reaches 60 Hz.** The fastest scenes run at 37–39 fps, and they are the ones that draw
  nothing: the custom visualizer with no shader takes 25.7 ms a frame, and Solid Color under Bars
  27.1 ms. On this machine most of the frame time is a fixed cost paid before any scene draws.
- **Visualizers:** 42 of 60 run at 30 fps or more. Below 15 fps: Voronoi 5.1, Kaleidoscope 12.4,
  Galaxy 12.6, Attractor Field 14.3.
- **Backgrounds:** 21 of 43 run at 30 fps or more. Below 15 fps: Globe Mesh 10.4, Halftone 13.5.
- **Post effects:** 34 of 40 run at 25–28.5 fps, about 5 ms a frame over Bars alone (30.4 ms).
  The rest: blur 13.8, tiltshift 17.9, starfilter 18.1, paint 20.0, godrays 21.8, bloom 23.3.
- The heavy scenes are not the same as on the fast machine. Voronoi is heavy on both; Wave Field,
  the slowest scene there, is in the middle here at 23.9 fps.

The script takes the fastest scene as the measured refresh rate. That holds when cheap scenes keep
up with vsync, as on the fast machine. Here none does, so the "39 Hz" it printed is the fastest
scene, not the display; the line below is corrected by hand, and read every figure against 60.

### npm run bench — 2026-10-28 (low-end machine)

- Script: `scripts/bench.js` on `4ec3d59` (copy without git history; the script printed `?`), Electron 44.9.0, Windows_NT 10.0.19044 x64
- CPU: Intel(R) Celeron(R) CPU  N3050  @ 1.60GHz (2 threads), RAM 2 GB
- GPU: ANGLE (Intel, Intel(R) HD Graphics (0x000022B1) Direct3D11 vs_5_0 ps_5_0, D3D11-20.19.15.5107), driver 20.19.15.5107
- Display: 1366×768 @ 60 Hz, scale 1
- Vsync **on**, display 60 Hz. No scene reached it; the script printed the fastest scene (39 fps) as the refresh rate
- Each scene: 2 s warm-up, 4 s measured, synthetic 120 BPM audio

#### 1280×720 (canvas 1280×720)

**Visualizers (over the default background)**

| Scene | fps | avg ms | p95 ms | max ms | > 33 ms |
|---|---:|---:|---:|---:|---:|
| Voronoi (`voronoi`) | 5.1 | 197.64 | 233.40 | 250.0 | 100.0% |
| Attractor Field (`attractorfield`) | 14.3 | 69.89 | 127.30 | 201.9 | 89.7% |
| Galaxy (`galaxy`) | 12.6 | 79.09 | 112.60 | 116.7 | 100.0% |
| Kaleidoscope (`kaleido`) | 12.4 | 80.57 | 104.20 | 165.7 | 98.0% |
| Truchet (`truchet`) | 16.9 | 58.99 | 87.10 | 116.7 | 91.0% |
| Moiré (`moire`) | 16.6 | 60.15 | 72.00 | 88.8 | 98.5% |
| Blocks (`blocks`) | 18.2 | 55.03 | 66.70 | 100.1 | 94.5% |
| Wave Interference (`interference`) | 19.7 | 50.83 | 66.70 | 66.8 | 95.0% |
| Ripple Grid (`ripplegrid`) | 20.6 | 48.42 | 66.70 | 100.1 | 81.0% |
| Dot Matrix (`dots`) | 21.3 | 46.90 | 66.60 | 92.6 | 88.4% |
| Flow Field (`flowfield`) | 21.7 | 46.17 | 66.60 | 99.9 | 71.3% |
| 3D Wave (`wave3d`) | 28.5 | 35.13 | 56.50 | 83.6 | 45.6% |
| Confetti (`confetti`) | 25.8 | 38.84 | 56.00 | 66.7 | 50.5% |
| Ropes (`ropes`) | 20.6 | 48.61 | 54.60 | 72.1 | 91.4% |
| Terrain (`terrain`) | 29.1 | 34.34 | 54.60 | 78.2 | 47.4% |
| Ridgelines (`ridges`) | 28.1 | 35.57 | 54.40 | 84.1 | 42.9% |
| Now Playing (`nowplaying`) — draws nothing without user content | 38.8 | 25.78 | 52.40 | 54.8 | 16.2% |
| Isometric City (`isocity`) | 33.5 | 29.85 | 51.60 | 67.5 | 33.6% |
| Bars (`bars`) | 32.9 | 30.40 | 50.10 | 66.9 | 37.1% |
| Studio (`custom`) — draws nothing without user content | 38.9 | 25.68 | 50.10 | 54.6 | 16.1% |
| MilkDrop (`milkdrop`) | 29.1 | 34.34 | 50.00 | 51.6 | 38.5% |
| 3D Geometry (`geometry`) | 30.0 | 33.30 | 49.40 | 88.9 | 43.7% |
| Ribbon (`ribbon`) | 33.6 | 29.71 | 48.60 | 54.3 | 34.3% |
| Center (`centerBars`) | 33.0 | 30.30 | 47.20 | 68.8 | 33.3% |
| City Skyline (`skyline`) | 32.5 | 30.77 | 45.80 | 84.7 | 39.2% |
| Mandala (`mandala`) | 33.8 | 29.63 | 43.80 | 53.8 | 25.9% |
| Vortex (`vortex`) | 34.2 | 29.23 | 43.40 | 61.2 | 27.7% |
| VU Meter (`vumeter`) | 37.3 | 26.83 | 41.10 | 56.1 | 22.4% |
| Circle (`circular`) | 34.5 | 28.99 | 39.70 | 64.0 | 27.5% |
| Level Meter (PPM) (`levelmeter`) | 38.4 | 26.02 | 39.70 | 62.8 | 20.3% |
| Starburst (`starburst`) | 29.9 | 33.44 | 39.20 | 52.6 | 40.3% |
| Oscilloscope (XY) (`scope`) | 36.3 | 27.59 | 39.10 | 70.7 | 24.8% |
| Feedback (`feedback`) | 33.8 | 29.61 | 38.70 | 70.3 | 25.2% |
| Stereo Trails (`stereotrails`) | 32.2 | 31.03 | 38.70 | 49.9 | 28.9% |
| Beat Pads (`beatpads`) | 33.1 | 30.18 | 38.50 | 67.4 | 27.3% |
| Helix (`helix`) | 34.3 | 29.18 | 38.40 | 47.1 | 18.4% |
| Lightning (`lightning`) | 36.0 | 27.80 | 38.40 | 66.8 | 18.8% |
| Radar Chart (`radar`) | 35.4 | 28.23 | 38.40 | 55.5 | 20.6% |
| Arcs (`arcs`) | 33.6 | 29.79 | 38.20 | 55.2 | 27.1% |
| DNA Helix (`dna`) | 35.4 | 28.22 | 38.20 | 66.8 | 20.7% |
| Flock (`flock`) | 34.5 | 28.99 | 38.20 | 50.0 | 23.2% |
| Fireworks (`fireworks`) | 36.1 | 27.66 | 38.10 | 50.3 | 21.0% |
| Pendulum Wave (`pendulum`) | 35.8 | 27.94 | 38.10 | 55.4 | 21.1% |
| Goniometer (`goniometer`) | 36.6 | 27.29 | 38.00 | 49.5 | 23.3% |
| Radial Wave (`radialWave`) | 35.6 | 28.09 | 38.00 | 47.9 | 24.5% |
| Bouncing Balls (`bounce`) | 35.2 | 28.43 | 37.90 | 49.6 | 26.4% |
| Bubbles (`bubbles`) | 35.5 | 28.19 | 37.90 | 54.2 | 18.6% |
| Text / Lyrics (`text`) | 38.5 | 25.96 | 37.90 | 56.9 | 19.5% |
| Pinwheel (`pinwheel`) | 35.8 | 27.96 | 37.80 | 46.6 | 21.1% |
| Lissajous (`lissajous`) | 36.4 | 27.46 | 37.50 | 47.0 | 25.5% |
| Cardioid (`cardioid`) | 33.9 | 29.54 | 37.40 | 47.3 | 26.5% |
| Strings (`strings`) | 33.2 | 30.15 | 37.40 | 54.4 | 30.3% |
| Particle (`particles`) | 35.9 | 27.83 | 37.30 | 47.7 | 18.9% |
| Chroma Wheel (`chromawheel`) | 36.0 | 27.82 | 37.20 | 54.9 | 22.4% |
| DJ Waveform (`djwave`) | 34.9 | 28.67 | 37.10 | 53.6 | 18.0% |
| Orb (`orb`) | 35.0 | 28.59 | 37.10 | 55.2 | 19.4% |
| Spectrogram (`spectrogram`) | 37.0 | 27.01 | 36.90 | 54.6 | 18.2% |
| Liquid Drop (`metaball`) | 35.6 | 28.07 | 36.80 | 63.3 | 18.3% |
| Tunnel (`tunnel`) | 35.9 | 27.86 | 36.80 | 55.2 | 24.5% |
| Wave (`wave`) | 35.8 | 27.97 | 34.60 | 39.8 | 20.3% |

**Backgrounds (with the Bars visualizer)**

| Scene | fps | avg ms | p95 ms | max ms | > 33 ms |
|---|---:|---:|---:|---:|---:|
| Globe Mesh (`globe`) | 10.4 | 96.34 | 149.30 | 166.6 | 100.0% |
| Halftone (`halftone`) | 13.5 | 73.98 | 146.90 | 149.9 | 83.3% |
| City (`city`) | 19.4 | 51.45 | 100.00 | 113.2 | 89.7% |
| Isometric Cubes (`cubes`) | 17.4 | 57.63 | 83.40 | 116.8 | 94.3% |
| Low Poly (`lowpoly`) | 15.4 | 65.04 | 83.40 | 116.6 | 96.7% |
| Plasma (`plasma`) | 16.2 | 61.80 | 83.40 | 116.6 | 100.0% |
| Spiral (`spiral`) | 21.1 | 47.42 | 83.20 | 117.2 | 83.3% |
| Embers (`embers`) | 18.3 | 54.57 | 71.50 | 116.7 | 98.6% |
| Starfield (`starfield`) | 22.1 | 45.19 | 70.00 | 100.1 | 73.0% |
| Pulse Rings (`rings`) | 25.1 | 39.77 | 67.20 | 83.4 | 53.5% |
| Wave Field (`wavefield`) | 23.9 | 41.93 | 67.20 | 116.6 | 67.4% |
| Caustics (`caustics`) | 20.1 | 49.80 | 66.80 | 83.8 | 85.2% |
| Circuit Board (`circuit`) | 23.5 | 42.56 | 66.80 | 85.0 | 73.4% |
| Hex Pulse (`hexpulse`) | 22.7 | 44.14 | 66.80 | 83.3 | 76.7% |
| Stained Glass (`stained`) | 26.4 | 37.93 | 66.80 | 83.4 | 57.1% |
| Liquid Metal (`liquid`) | 19.6 | 51.06 | 66.70 | 84.8 | 93.7% |
| Sand (`sand`) | 22.6 | 44.14 | 66.30 | 103.2 | 70.3% |
| Snow / Embers (`snow`) | 29.9 | 33.49 | 65.60 | 83.2 | 45.8% |
| Honeycomb Grid (`hexgrid`) | 24.6 | 40.74 | 53.70 | 66.7 | 65.7% |
| Mosaic (`mosaic`) | 25.4 | 39.35 | 50.50 | 66.7 | 61.2% |
| Fireflies (`fireflies`) | 33.6 | 29.74 | 50.30 | 67.1 | 31.1% |
| Lava Lamp (`lavalamp`) | 26.6 | 37.54 | 50.30 | 66.5 | 49.5% |
| Storm (`storm`) | 31.1 | 32.10 | 50.20 | 83.3 | 40.0% |
| Clouds (`clouds`) | 28.8 | 34.77 | 50.10 | 66.7 | 49.1% |
| Retro Grid (`grid`) | 34.6 | 28.90 | 50.00 | 66.9 | 25.9% |
| Ink (`ink`) | 35.0 | 28.58 | 50.00 | 78.9 | 27.9% |
| Network (`network`) | 32.3 | 30.93 | 50.00 | 100.0 | 41.5% |
| Contours (`contours`) | 32.3 | 30.92 | 49.90 | 76.9 | 40.8% |
| Northern Lights (`aurora`) | 30.8 | 32.43 | 49.80 | 75.7 | 40.3% |
| Corridor (`corridor`) | 35.5 | 28.21 | 49.50 | 66.7 | 26.6% |
| Prism (`prism`) | 34.9 | 28.69 | 49.20 | 69.0 | 21.6% |
| Wave Layers (`waves`) | 33.9 | 29.54 | 49.20 | 83.2 | 31.6% |
| Wire Tunnel (`wireframe`) | 35.7 | 27.98 | 48.80 | 97.7 | 26.6% |
| Nebula (`nebula`) | 35.6 | 28.09 | 47.50 | 63.1 | 25.2% |
| Fluid Gradient (`gradient`) | 32.3 | 30.98 | 47.20 | 61.4 | 40.3% |
| Digital Rain (`rain`) | 31.0 | 32.22 | 47.00 | 66.6 | 41.1% |
| Solid Color (`solid`) | 36.8 | 27.14 | 46.70 | 64.1 | 23.6% |
| Studio (`custom`) — draws nothing without user content | 37.5 | 26.69 | 45.70 | 52.3 | 25.2% |
| Ribbons (`ribbons`) | 33.9 | 29.48 | 45.60 | 83.5 | 27.7% |
| Underwater (`underwater`) | 32.5 | 30.79 | 45.40 | 66.8 | 31.5% |
| Stage Lights (`spotlights`) | 36.0 | 27.81 | 44.10 | 64.2 | 23.6% |
| Mirror Pattern (`mirror`) | 34.1 | 29.33 | 38.10 | 66.5 | 36.5% |
| Light Particles (`bokeh`) | 35.5 | 28.16 | 37.50 | 64.5 | 23.6% |

**Post effects (one at a time, over Bars)**

| Scene | fps | avg ms | p95 ms | max ms | > 33 ms |
|---|---:|---:|---:|---:|---:|
| `blur` | 13.8 | 72.51 | 86.80 | 92.7 | 100.0% |
| `starfilter` | 18.1 | 55.30 | 71.20 | 91.1 | 97.2% |
| `tiltshift` | 17.9 | 55.87 | 70.90 | 77.9 | 100.0% |
| `paint` | 20.0 | 49.94 | 66.80 | 72.0 | 94.9% |
| `vhs` | 28.1 | 35.53 | 66.60 | 83.5 | 50.0% |
| `trails` | 26.7 | 37.39 | 63.00 | 68.3 | 55.1% |
| `dof` | 25.1 | 39.84 | 62.10 | 68.2 | 67.0% |
| `sharpen` | 27.8 | 35.94 | 61.30 | 71.0 | 47.8% |
| `slitscan` | 27.0 | 37.09 | 58.30 | 68.4 | 56.1% |
| `vignette` | 28.2 | 35.41 | 56.80 | 83.4 | 48.7% |
| `glitch` | 28.5 | 35.11 | 56.70 | 69.0 | 45.6% |
| `radialblur` | 26.0 | 38.50 | 56.20 | 66.0 | 60.6% |
| `zoomblur` | 26.0 | 38.47 | 56.20 | 67.6 | 63.5% |
| `ascii` | 27.9 | 35.77 | 56.10 | 74.4 | 53.6% |
| `chroma` | 28.2 | 35.47 | 56.10 | 68.9 | 50.9% |
| `twirl` | 28.1 | 35.63 | 55.60 | 62.0 | 46.4% |
| `godrays` | 21.8 | 45.79 | 55.50 | 75.6 | 82.8% |
| `bloom` | 23.3 | 43.02 | 55.40 | 72.4 | 65.6% |
| `crt` | 27.9 | 35.81 | 55.40 | 62.7 | 53.1% |
| `dither` | 28.1 | 35.58 | 55.40 | 70.5 | 48.2% |
| `motionblur` | 26.1 | 38.30 | 55.30 | 76.1 | 61.2% |
| `ripple` | 28.0 | 35.75 | 55.30 | 68.4 | 50.9% |
| `hatch` | 28.1 | 35.55 | 55.10 | 67.4 | 46.4% |
| `edge` | 27.3 | 36.68 | 55.00 | 65.6 | 55.6% |
| `levels` | 28.2 | 35.42 | 54.90 | 66.6 | 51.8% |
| `badtv` | 28.1 | 35.58 | 54.70 | 79.4 | 54.0% |
| `halftone` | 28.3 | 35.36 | 54.70 | 66.5 | 48.7% |
| `grain` | 28.2 | 35.41 | 54.50 | 79.1 | 53.6% |
| `lens` | 28.3 | 35.40 | 54.30 | 67.9 | 48.6% |
| `emboss` | 28.2 | 35.42 | 54.20 | 66.1 | 52.7% |
| `grade` | 28.0 | 35.73 | 54.20 | 60.9 | 57.7% |
| `pixelate` | 28.1 | 35.57 | 53.60 | 62.7 | 53.6% |
| `polar` | 28.1 | 35.57 | 53.60 | 56.3 | 53.6% |
| `posterize` | 28.3 | 35.30 | 53.40 | 61.7 | 53.1% |
| `threshold` | 28.1 | 35.62 | 52.30 | 68.7 | 50.0% |
| `gradientmap` | 28.3 | 35.38 | 51.40 | 60.1 | 56.1% |
| `datamosh` | 28.0 | 35.68 | 51.30 | 67.4 | 49.1% |
| `mirror` | 28.4 | 35.25 | 50.40 | 66.8 | 49.6% |
| `solarize` | 28.2 | 35.44 | 50.40 | 55.4 | 49.1% |
| `kaleido` | 28.1 | 35.55 | 50.10 | 62.3 | 54.9% |
