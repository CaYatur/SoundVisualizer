# CAYADEV Visualizer — Roadmap

This document records, honestly, what has actually shipped and what is planned.
A row is only marked done when the feature works in the application and is
covered by a test or by the GPU self-test.

**Current release: v3.0.0** · **Next release: v3.1.0**

| Release | Theme | State |
|---|---|:--:|
| v2.1.0 | Layers, post-FX, 3D geometry, Art-Net, Auto VJ | Shipped |
| **v3.0.0** | **Modulation, deep analysis, MilkDrop language, mapping, transitions, recording** | **Current** |
| v3.1.0 | Timeline and Clip Deck | Planned |
| v3.1.1 | Spout / Syphon / NDI output | Planned |
| v3.1.2 | Per-application audio capture | Planned |
| v3.1.3 | Comprehensive video export | Planned |
| v3.1.4 | Broadcast layout editor | Planned |
| v3.2.0 | Redundancy, failover and frame sync | Planned |

---

## Status table

| Feature | v1.3.1 | v2.0.0 | v2.1.0 | **v3.0.0** | Note |
|---|:--:|:--:|:--:|:--:|---|
| Multi-monitor | ✅ | ✅✅ | ✅✅ | ✅✅ | A separate window on every selected display |
| System audio | ✅ | ✅ | ✅ | ✅ | WASAPI loopback |
| Multi-source mixing | ✅ | ✅ | ✅ | ✅ | Mixed before the FFT |
| Layer compositing | ❌ | ❌ | ✅✅ | ✅✅ | Unlimited layers, 17 blend modes, groups, solo/mute/lock |
| Layer masks | ❌ | ❌ | ❌ | ✅ | Alpha from another layer, plus shape and gradient masks |
| Post-FX | ❌ | ❌ | ✅ | ✅✅ | 40 GPU effects, orderable, audio-bindable, per-layer chains |
| Visualizer modes | 14 | 31 | 32 | **48** | Includes 14 new generative modes |
| Backgrounds | 10 | 19 | 19 | **31** | All share the palette and template system |
| Colour presets | 10 | 10 | 58 | 58 | Seven groups; apply to Studio and the 3D engine too |
| Formulas | ❌ | ❌ | 35 | **98** | 30 plane curves, 12 space curves, 29 surfaces, 27 attractors |
| 3D solids | ❌ | ❌ | ❌ | **13** | Platonic solids, geodesic spheres, L-systems, IFS clouds |
| True 3D | ❌ | ◐ | ✅ | ✅ | Own matrix maths; no third-party 3D library |
| Modulation engine | ❌ | ❌ | ❌ | ✅✅ | LFOs, envelopes, S&H, random → any config path |
| Deep audio analysis | ❌ | ❌ | ◐ | ✅✅ | Constant-Q chroma, key, chords, HPSS, YIN pitch, loudness |
| Scene transitions | ❌ | ❌ | ❌ | ✅ | 18 transitions, switchable off |
| Projection mapping | ❌ | ❌ | ❌ | ✅ | Corner pin, mesh warp, soft edge, per-output masks |
| MilkDrop | ❌ | ◐ | ◐ | ✅ | Full expression language, warp mesh, `.milk` import |
| Live shader editor | ❌ | ✅ | ✅ | ✅ | GLSL, live preview, error line, custom sliders |
| Built-in shaders | ❌ | 5 | 5 | **42** | All compile on the GPU in the self-test |
| Shadertoy / ISF import | ❌ | ✅ | ✅ | ✅ | Local converters; no service is contacted |
| Scene templates | ❌ | ❌ | ❌ | **64** | Eight groups, each verified not to damage a working setup |
| Text and lyrics | ❌ | ❌ | ❌ | ✅ | Audio-reactive typography, LRC/SRT import, timing editor |
| MIDI | ❌ | ✅ | ✅ | ✅ | Learn; CC/note → any setting or action |
| OSC | ❌ | ✅ | ✅ | ✅ | UDP listener, hand-written OSC 1.0 parser |
| Art-Net / DMX | ❌ | ❌ | ✅ | ✅ | ArtDMX output; packet layout tested byte by byte |
| BPM / tempo | ❌ | ❌ | ✅ | ✅ | Period histogram; tested to ±0.5 BPM |
| Auto VJ | ❌ | ❌ | ✅ | ✅ | Bar-aligned scene, mode and palette changes |
| Recording | ◐ | ✅ | ✅ | ✅✅ | One-key capture, GIF export, 4× PNG snapshot |
| Video / webcam input | ❌ | ✅ | ✅ | ✅ | Also readable as `sv_media` inside shaders |
| OBS integration | ❌ | ✅✅ | ✅✅ | ✅✅ | Browser source — no plugin, real transparency |
| Offline render | ◐ | ✅ | ✅✅ | ✅✅ | Frame-exact and deterministic — the regression net |
| Windows Dynamic Lighting | ✅✅ | ✅✅ | ✅✅ | ✅✅ | Unusual in this class |
| Mobile remote | ❌ | ✅ | ✅ | ✅ | Scenes, templates, Studio presets |
| Automated tests | ❌ | ◐ | ✅ | ✅✅ | **564** unit tests + a GPU self-test over every engine |
| Timeline | ❌ | ❌ | ❌ | ❌ | v3.1.0 |
| Clip deck | ❌ | ❌ | ❌ | ❌ | v3.1.0 |
| Spout / Syphon / NDI | ❌ | ❌ | ❌ | ❌ | v3.1.1 |
| Per-app audio capture | ❌ | ❌ | ❌ | ❌ | v3.1.2 |
| Redundancy / genlock | ❌ | ❌ | ❌ | ❌ | v3.2.0 |

Legend: ✅ present · ✅✅ best-in-class · ◐ partial · ❌ absent

---

## Verifiability

Counting features is easy; showing they are correct is not. Every claim above
is backed by something runnable:

```bash
npm test
```

```bash
npm start -- --smoke
```

- **564 unit tests, all passing.** Formulas are checked against values derived
  by hand from their definitions — Viviani's curve staying on its sphere, the
  torus tube radius, Chladni's m↔n antisymmetry, every attractor staying
  bounded and landing inside the view volume.
- **Tempo** is measured against synthetic signals of known BPM
  (90/120/128/140/174 → 89.8/120.4/127.9/140.0/173.7).
- **Analysis** is tested against synthetic signals with known answers: a known
  chord must come back as that chord, a 220 Hz tone as 220 Hz.
- **Art-Net** is verified byte by byte against the ArtDMX header.
- **The GPU self-test** draws every registered mode, background, post-FX
  effect, shader, formula and transition on a real GPU and measures that the
  result is not blank; it then switches the interface to English and scans for
  untranslated strings.

---

## v3.1.0 — Timeline and Clip Deck

The two pieces of a show-oriented workflow. Both are performance surfaces, so
they share one clock and one quantiser.

### Timeline
An editor that lays clips and effects out along time.

- Plan in advance what happens at a given second or a given musical bar.
- Built for shows, synchronised performances and fixed-duration sets.
- Markers, loop regions and snap-to-bar.
- Automation lanes that write into the same modulation targets the live engine
  already exposes, so anything modulatable is also automatable.

### Clip Deck
The grid where a VJ organises clips — video, loops, generative presets, images.

- Multiple decks (A, B, C…), each a grid of rows and columns.
- Clips are triggered beat-aligned (quantised) and moved between with a fade or
  a cut.
- Column launch fires a whole row as a scene.
- Timeline and deck coexist: the timeline can arm deck slots, and deck activity
  can be recorded back onto the timeline.

Also in v3.1.0: per-clip trim and speed, deck-wide follow actions, and a
performance view that hides everything except the deck and the crossfader.

## v3.1.1 — Spout, Syphon and NDI

Live video output to other applications.

- **Spout (Windows) / Syphon (macOS):** very low latency sharing between
  programs on the same machine, straight over the GPU. The visualizer feeds
  Resolume or OBS without window capture.
- **NDI:** the same thing across a network. One machine runs the visualizer,
  another running Resolume or a mixing console receives the image over the
  network. This is the standard in professional live and stage setups.

Each requires a native library, so this ships as an optional companion package
rather than something bundled into the base install.

## v3.1.2 — Per-application audio capture

Pick which application's audio is analysed. Separate a game or a voice chat
from the music, so the visualizer follows only Spotify or the DAW instead of
whatever the system is mixing.

## v3.1.3 — Comprehensive video export

Faster export, more formats, and enough presets that a content creator never
has to think about encoder settings. Cutting export time is a first-class goal
of this release, not a side effect.

| Feature | What it gives you |
|---|---|
| Multiple formats | MP4 (H.264/H.265), ProRes/DNx for editing, WebM, GIF/APNG for short loops |
| Preset profiles | "YouTube 1080p60", "Reels 1080×1920", "Twitch overlay", "Master 4K" — one click |
| Duration sources | Fixed seconds · timeline length · audio file length · N bars from the BPM |
| Audio muxing | Muxed from the chosen wav/mp3/flac rather than from the system mix, so the master is in sync and clean |
| Alpha / transparency | ProRes 4444 or WebM VP9 with alpha, for overlay stock |
| Batch | Queue one scene across ten songs, or three resolutions |
| Chapters | Split a long show at markers |
| Metadata | Title, BPM and scene name written into the file name and ffmetadata |
| Frame sequence | PNG/EXR sequences for post — slow but lossless |
| Two render modes | (1) realtime encode that follows the playhead, (2) offline maximum-speed render. They stay separate modes |

## v3.1.4 — Broadcast layout editor

v3.0.0 already ships the broadcast template group: a restrained bar
visualizer, corner or centre placement, a logo beside the bars rather than
behind them, track and artist text, and a still or calm video background.
v3.1.4 turns that from a set of templates into an editor.

- Free placement of the logo, text and bar block, with snapping and safe areas.
- Logo swapping driven by time, beat, bass or a random interval — the same
  video can show the label mark in one section and the release artwork in
  another.
- Text styling presets, automatic track metadata, and per-element reveal
  animations.
- Everything usable live and as an export preset.

## v3.2.0 — Redundancy, failover and frame sync

The release aimed at staged, professional shows. This category is large and
will be built carefully rather than quickly.

- A backup machine takes over automatically, or very quickly, if the main one
  fails.
- The same show file runs synchronised on two machines.
- Genlock / frame-sync so multiple outputs advance on the same frame boundary.
- Health monitoring and a pre-show check that reports what is not ready.

This is close to mandatory at large festivals and corporate events, and is
standard in media servers of that class.

---

## Not done, and why

These are deliberate omissions, not oversights.

### Native senders (NDI, Spout, Syphon)
Both need a third-party native library: the NDI SDK carries its own licence
acceptance and platform-specific DLLs, and Spout needs a compiled native
addon. Adding them halfway would produce a menu item that does not work.

**What exists instead:** the **browser source** for OBS does the same job with
no plugin install and real transparency. The architecture is ready for the
native path — `src/main/stream-server.js` already abstracts the output — and
it is scheduled for v3.1.1.

### WebGPU
The Studio engine is built on WebGL2. WebGPU (WGSL) is more modern, but today
the entire Shadertoy and ISF ecosystem is GLSL. Compatibility was chosen
deliberately.

### Ableton Link
Sharing tempo over a network needs a separate protocol stack and a discovery
service. **What exists instead:** own BPM estimation (tested), tap tempo and a
BPM lock.

### A central preset store
Deliberate: the application contacts no server, asks for no account and sends
no telemetry. Sharing happens through files (`.svpreset`, `.svpack`).

### "AI" scene generation
The Scene Generator is **not** a neural network and is not presented as one.
It reduces text to four axes with a weighted keyword dictionary and builds the
scene with a deterministic generator seeded from those axes. It runs entirely
offline.
