# CAYADEV Visualizer — Roadmap

This document records, honestly, what has actually shipped and what is planned.
A row is only marked done when the feature works in the application and is
covered by a test or by the GPU self-test.

**Current release: v3.1.1** · **Next release: v3.1.2**

| Release | Theme | Released | State |
|---|---|:--:|:--:|
| v1.3.1 | Modes, backgrounds, recording | 2026-08-06 | Shipped |
| v2.0.0 | Shader editor, MIDI, OSC, OBS source, offline render | 2026-08-30 | Shipped |
| v2.1.0 | Layers, post-FX, 3D geometry, Art-Net, Auto VJ | 2026-09-01 | Shipped |
| v3.0.0 | Modulation, deep analysis, MilkDrop language, mapping, transitions | 2026-09-02 | Shipped |
| v3.1.0 | Timeline, Clip Deck, accidental-close protection, Electron 43 | 2026-09-02 | Shipped |
| **v3.1.1** | **Cross-platform builds, OpenRGB, Spout and Syphon** | **2026-09-04** | **Current** |
| v3.1.2 | Per-application audio capture | — | Next |
| v3.1.3 | Comprehensive video export | — | Planned |
| v3.1.4 | Broadcast layout editor | — | Planned |
| v3.1.5 | NDI output | — | Deferred |
| v3.2.0 | Redundancy, failover and frame sync | — | Planned |

---

## Status table

| Feature | v1.3.1 | v2.0.0 | v2.1.0 | v3.0.0 | v3.1.0 | **v3.1.1** | Note |
|---|:--:|:--:|:--:|:--:|:--:|:--:|---|
| Multi-monitor | ✅ | ✅✅ | ✅✅ | ✅✅ | ✅✅ | ✅✅ | A separate window on every selected display |
| System audio | ✅ | ✅ | ✅ | ✅ | ✅ | ✅✅ | WASAPI loopback on Windows, CoreAudio on macOS, PulseAudio/PipeWire monitor on Linux |
| Multi-source mixing | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | Mixed before the FFT |
| Layer compositing | ❌ | ❌ | ✅✅ | ✅✅ | ✅✅ | ✅✅ | Unlimited layers, 17 blend modes, groups, solo/mute/lock |
| Layer masks | ❌ | ❌ | ❌ | ✅ | ✅ | ✅ | Alpha from another layer, plus shape and gradient masks |
| Post-FX | ❌ | ❌ | ✅ | ✅✅ | ✅✅ | ✅✅ | 40 GPU effects, orderable, audio-bindable, per-layer chains |
| Visualizer modes | 14 | 31 | 32 | **48** | **48** | **48** | Includes 14 new generative modes |
| Spectrum metering | ❌ | ❌ | ◐ | ✅ | ✅ | ✅ | Four frequency scales, dB amplitude, attack/release ballistics, spread and smoothing |
| Broadcast layouts | ❌ | ❌ | ❌ | ✅ | ✅ | ✅ | Bar placement, logo beside the bars, track and artist text |
| Backgrounds | 10 | 19 | 19 | **31** | **31** | **31** | All share the palette and template system |
| Colour presets | 10 | 10 | 58 | 58 | 58 | 58 | Seven groups; apply to Studio and the 3D engine too |
| Formulas | ❌ | ❌ | 35 | **98** | **98** | **98** | 30 plane curves, 12 space curves, 29 surfaces, 27 attractors |
| 3D solids | ❌ | ❌ | ❌ | **13** | **13** | **13** | Platonic solids, geodesic spheres, L-systems, IFS clouds |
| True 3D | ❌ | ◐ | ✅ | ✅ | ✅ | ✅ | Own matrix maths; no third-party 3D library |
| Modulation engine | ❌ | ❌ | ❌ | ✅✅ | ✅✅ | ✅✅ | LFOs, envelopes, S&H, random → any config path |
| Deep audio analysis | ❌ | ❌ | ◐ | ✅✅ | ✅✅ | ✅✅ | Constant-Q chroma, key, chords, HPSS, YIN pitch, loudness |
| Scene transitions | ❌ | ❌ | ❌ | ✅ | ✅ | ✅ | 18 transitions, switchable off |
| Projection mapping | ❌ | ❌ | ❌ | ✅ | ✅ | ✅ | Corner pin, mesh warp, soft edge, per-output masks |
| MilkDrop | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | The ticks here were never true. The expression compiler used `new Function`, which every window's CSP blocked, so **no preset has ever run in a packaged build** (#559). Fixed after v3.1.1; see below |
| Live shader editor | ❌ | ✅ | ✅ | ✅ | ✅ | ✅ | GLSL, live preview, error line, custom sliders |
| Built-in shaders | ❌ | 5 | 5 | **42** | **42** | **42** | All compile on the GPU in the self-test |
| Shadertoy / ISF import | ❌ | ✅ | ✅ | ✅ | ✅ | ✅ | Local converters; no service is contacted |
| Scene templates | ❌ | ❌ | ❌ | **72** | **72** | **72** | Nine groups, each verified not to damage a working setup |
| Text and lyrics | ❌ | ❌ | ❌ | ✅ | ✅ | ✅ | Audio-reactive typography, LRC/SRT import, timing editor |
| MIDI | ❌ | ✅ | ✅ | ✅ | ✅ | ✅ | Learn; CC/note → any setting or action |
| OSC | ❌ | ✅ | ✅ | ✅ | ✅ | ✅ | UDP listener, hand-written OSC 1.0 parser |
| Art-Net / DMX | ❌ | ❌ | ✅ | ✅ | ✅ | ✅ | ArtDMX output; packet layout tested byte by byte |
| BPM / tempo | ❌ | ❌ | ✅ | ✅ | ✅ | ✅ | Period histogram; tested to ±0.5 BPM |
| Auto VJ | ❌ | ❌ | ✅ | ✅ | ✅ | ✅ | Bar-aligned scene, mode and palette changes |
| Recording | ◐ | ✅ | ✅ | ✅✅ | ✅✅ | ✅✅ | One-key capture, GIF export, 4× PNG snapshot |
| Video / webcam input | ❌ | ✅ | ✅ | ✅ | ✅ | ✅ | Also readable as `sv_media` inside shaders |
| OBS integration | ❌ | ✅✅ | ✅✅ | ✅✅ | ✅✅ | ✅✅ | Browser source — no plugin, real transparency |
| Offline render | ◐ | ✅ | ✅✅ | ✅✅ | ✅✅ | ✅✅ | Frame-exact and deterministic — the regression net |
| Windows Dynamic Lighting | ✅✅ | ✅✅ | ✅✅ | ✅✅ | ✅✅ | ✅✅ | Unusual in this class. Windows only — elsewhere the card explains why and OpenRGB takes over |
| Mobile remote | ❌ | ✅ | ✅ | ✅ | ✅ | ✅ | Scenes, templates, Studio presets |
| Automated tests | ❌ | ◐ | ✅ | ✅✅ | ✅✅ | ✅✅ | **808** unit tests + a GPU self-test over every engine (703 at v3.1.0) |
| Timeline | ❌ | ❌ | ❌ | ❌ | ◐ | ◐ | Shipped in v3.1.0. Tracks, clips, automation lanes, markers, one shared transport. Partial: no multi-select on the canvas, no tempo map editing |
| Clip deck | ❌ | ❌ | ❌ | ❌ | ◐ | ◐ | Shipped in v3.1.0. Sparse grid, beat-quantised launch, follow actions, performance view. Partial: one deck, and only scene/template slots apply |
| Accidental-close protection | ❌ | ❌ | ❌ | ❌ | ✅ | ✅ | Shipped in v3.1.0. Recovery and an Esc lock, both off by default |
| Windows build | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | NSIS installer and a portable build |
| macOS build | ❌ | ❌ | ❌ | ❌ | ❌ | ◐ | Shipped in v3.1.1. `.dmg` and `.zip`, Apple Silicon, built on a macOS runner. Unsigned, and system audio needs BlackHole. Never launched on a real Mac |
| Linux build | ❌ | ❌ | ❌ | ❌ | ❌ | ◐ | Shipped in v3.1.1. AppImage and `.deb`, x64, built on a Linux runner. The audio engine loads; never launched on a real desktop |
| Runs without a Node install | ✅ | ✅ | ✅ | ✅ | ✅ | ✅✅ | Windows never needed one: every build since v1.3.1 carried its own 93 MB `node.exe`. v3.1.1 drops that payload and covers all three platforms — the helper runs on the app’s own binary (`ELECTRON_RUN_AS_NODE`) |
| OpenRGB | ❌ | ❌ | ❌ | ❌ | ❌ | ◐ | Shipped in v3.1.1. All three platforms, per-LED, sharing one renderer with Dynamic Lighting. Tested against a protocol-level server, not real devices |
| Spout / Syphon | ❌ | ❌ | ❌ | ❌ | ❌ | ◐ | Shipped in v3.1.1. GPU handoff, measured end to end on Windows at 30 fps with none dropped. Syphon shares the code path but has never run on a Mac. Absent on Linux |
| Electron | 33 | 33 | 33 | 33 | **43** | **43** | 33.4.11 reached end of life in April 2025 |
Legend: ✅ present · ✅✅ best-in-class · ◐ partial · ❌ absent

### Not shipped yet

Kept separate from the table above on purpose: that one records what has
actually been released, this one records intent. Nothing here is in a user’s
hands, and a row only moves up once it ships.

| Feature | Target | State today |
|---|:--:|---|
| Per-app audio capture | v3.1.2 | Not started. Needs a native module on both Windows and macOS; the same API family gives macOS its missing system-audio loopback |
| Comprehensive video export | v3.1.3 | Not started |
| Broadcast layout editor | v3.1.4 | Not started |
| NDI | v3.1.5 | Deferred for licence reasons, not difficulty — see "Not done, and why" |
| Redundancy / genlock | v3.2.0 | Not started |

### Shipped, but never run on real hardware

Four things went out in v3.1.1 that this machine cannot verify. They pass
their tests and they are in users’ hands, so they belong in the table above
rather than in "not shipped" — but calling them proven would be a lie.

| What | Verified | Not verified |
|---|---|---|
| macOS build | Builds on a macOS runner; arm64 Mach-O binaries confirmed inside the `.dmg`, and `NSMicrophoneUsageDescription` is present | Never launched on a Mac. Gatekeeper behaviour, BlackHole capture and CoreAudio enumeration are all unobserved |
| Linux build | Builds on a Linux runner; `audify` loads there in CI, and the `.deb` declares `libpulse0` | Never launched on a desktop. Monitor-source enumeration is untested against a real PulseAudio or PipeWire server |
| OpenRGB | Protocol encoded and decoded against a server implementing the wire format, 38 tests | Never driven a physical LED. Vendor quirks and per-device direct-mode support are unknown |
| Syphon | Shares the whole code path with Spout, which was measured end to end on Windows. The macOS handle conversion is unit-tested | Never run on a Mac. The IOSurface path has never touched a real GPU |

This table shrinks as the hardware becomes available; nothing is moved out of
it on the strength of an argument.

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

- **908 unit tests, all passing** on `main`. 703 of those shipped in v3.1.0;
  the rest came with v3.1.1. Formulas are checked against values derived
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
  untranslated strings. It also asserts that automation never opens the
  camera, after the screenshot generator was caught doing exactly that.

---

## v3.1.0 — Timeline and Clip Deck · shipped

Two performance surfaces that share one clock and one quantiser. A deck with
its own clock would drift from the timeline, and things meant to fire on the
same beat would visibly separate.

### Timeline

- Tracks holding clips, and automation lanes writing into the same targets the
  modulation engine exposes — anything modulatable is automatable.
- Transport with play, pause, stop, a loop region and scrubbing that updates
  the scene immediately, including while paused.
- A zoomable canvas ruler reading in seconds and in bars, with grid density
  chosen from the zoom so it never turns into noise.
- Clip placement by dragging, edge-trimming and snapping to bar, beat, half,
  quarter or frame, with Alt suspending the snap mid-drag.
- A keyframe editor reusing the modulation engine’s curve set, so a curve
  named the same behaves the same in both places.
- Named markers, jumpable, importable from an LRC or SRT file through the
  existing lyrics parser.

Seconds are the single source of truth; bars and beats are derived from a
tempo map. Storing both would let them disagree with no way to tell which was
right. Conversion accumulates across tempo changes, because multiplying by one
constant BPM shifts everything after the first change and the error only shows
during a show. `retimeToTempo()` preserves musical positions across a tempo
change as an explicit action rather than a silent side effect.

### Clip Deck

- A sparse grid: empty slots are not stored, so an 8x8 deck holding one clip
  writes one record rather than sixty-four.
- Beat-quantised launching from one frame up to four bars, with a countdown on
  the armed slot. Launching exactly on a grid line waits for the next one —
  otherwise hitting the beat squarely makes quantisation look random.
- A cut is a true cut, with the fade forced to zero rather than left to the
  drawing side; a fade reuses the existing 18 transitions.
- Column launch fires a whole row on one frame, aligned to the longest
  quantisation in that row so nothing staggers.
- Follow actions: stop, loop, next, random in column, or go to a named slot.
  They chain, with a per-frame fire cap so a chain of near-zero-duration clips
  reports an overrun instead of pinning the machine.
- A performance view with nothing but the deck, transport and blackout: large
  targets, high contrast, every slot reachable from the keyboard.
- Deck activity records back onto the timeline as tracks, turning an improvised
  set into an editable one.

### Determinism

Offline export is the project’s visual regression net, and it only works
because every time-dependent source derives from the draw clock. The timeline
obeys the same rule: automation evaluated at a time is the same value however
the playhead reached it, and the exporter derives time from the frame index
alone. The live path uses a separate wall-clock anchor so that several
visualizer windows compute the same playhead in closed form, without a message
per frame and without drift between them.

### Also in v3.1.0

**Accidental-close protection.** Two switches in Settings, both off by
default. With protection on, a visualizer window that closes unexpectedly
reopens at once; recovery keys off intent, so closing from the panel, from the
remote or with Esc is never undone. A second switch locks Esc, leaving the
panel’s Close button and Ctrl+Alt+Shift+Esc as the ways out — a visualizer
that cannot be closed would be worse than one that closes by accident.

**Electron 43.5.1.** 33.4.11 reached end of life in April 2025 and shipped
Chromium 130. The upgrade is also the floor for the Spout and Syphon senders
in v3.1.1, which need Electron 40 or newer.

### Not in v3.1.0

Written down rather than quietly dropped:

- **Multiple decks (A, B, C…).** The data model carries a deck list and every
  engine call is addressed by deck id, so the work is a deck selector rather
  than an engine change. One deck is what ships.
- **Timeline arming deck slots.** The other half of the bridge — recording deck
  activity onto the timeline — is done; driving the deck from the timeline is
  not.
- **Multi-select and numeric nudge on the timeline canvas.** Clips move and trim
  one at a time; exact positions are typed in the inspector.
- **Tempo changes mid-show through the interface.** The engine and the tests
  support a full tempo map; the panel edits a single tempo.
- **Rendered clip thumbnails.** Slots show the referenced scene’s colours.
  Capturing a real frame would mean switching the visualizer to that scene —
  changing the show to draw a preview of it.

## v3.1.1 — Cross-platform builds, OpenRGB, Spout and Syphon · shipped

Live video output to other applications on the same machine, straight over
the GPU. The visualizer feeds Resolume, OBS or any Spout/Syphon receiver
without window capture and without a plugin install.

The release grew beyond that, and not by accident: **Syphon needs a macOS
build**, and there has never been one. Nine releases have claimed Windows and
macOS support while shipping only `.exe` files. So the platform work is not
scope creep around Spout and Syphon — it is their precondition, and Linux comes
along with the same CI job.

### Running on three platforms

The application assumed Windows in four places that would each have broken a
macOS or Linux build on its own.

**The audio helper had no runtime.** It ran on a system Node, and the Windows
build carried a 93 MB `node.exe` so that users would not have to install one.
The other two platforms got neither. Electron is itself a Node runtime:
`ELECTRON_RUN_AS_NODE=1` makes the application's own binary behave as one, and
`audify` loads under it because it is N-API. That removes the bundled `node.exe`
entirely, and the download shrinks with it.

**Packaging demanded Windows files unconditionally.** `extraResources` listed
`node.exe` and the Dynamic Lighting native module with no platform condition, so
a macOS or Linux build failed before it started.

**Capturing system audio works differently on each platform**, and only the
Windows case existed:

| | How the system's own audio is captured |
|---|---|
| Windows | An output device is opened for capture — WASAPI loopback |
| Linux | The PulseAudio/PipeWire **monitor**, which is an *input* device |
| macOS | Not possible. CoreAudio has no loopback at all |

The old code looked for an output device on every platform. On Linux that picks
the speakers and tries to capture them, which PulseAudio will not do. On macOS
nothing would have worked at all. That rule now lives in a pure module, so the
two platforms that cannot be run here are still covered by tests.

macOS therefore needs a virtual audio device — BlackHole is free — and when
there is none the application says so and names it, rather than falling back to
the microphone and letting someone visualise the wrong source without noticing.
The real fix is CoreAudio's process taps (`AudioHardwareCreateProcessTap`,
macOS 14.2+), which is the same API family as Windows' process loopback, so it
belongs with v3.1.2 rather than here.

**Windows Dynamic Lighting is a Windows API.** Its card is now hidden off
Windows instead of being shown saying only that it is unsupported. A settings
file carried over from Windows explains why the setting is inactive.

### What macOS users have to accept in this release

Written plainly rather than discovered after downloading:

- **The build is unsigned.** No Apple Developer Program membership was bought,
  so macOS reports the app as damaged and it has to be cleared by hand. This is
  a cost decision and can be reversed at any time.
- **System audio needs BlackHole** or another virtual device, per the table
  above.
- **Windows Dynamic Lighting is absent.** OpenRGB and Art-Net/DMX are the RGB
  paths on macOS.
- **Apple Silicon only.** Apple finished the Intel transition: the last Intel
  Macs left sale in mid-2023, and macOS Tahoe 26 was announced as the final
  release supporting them. An arm64 .dmg will not launch on an Intel Mac at
  all, so this is a real if shrinking exclusion rather than a degraded
  experience. A universal binary would cover both, at the cost of carrying two
  sets of native binaries in one package, and it is not worth that here. The
  GitHub Intel runners also sat queued for over fifteen minutes without ever
  starting, on two separate attempts.

### OpenRGB — RGB on all three platforms

Dynamic Lighting leaving with Windows would have left macOS and Linux with no
consumer RGB support at all. OpenRGB is cross-platform, supports far more
devices than Windows' LampArray, and speaks a documented TCP protocol — the same
shape as the Art-Net/DMX output that already exists, so it slots in beside it
rather than replacing anything.

On Windows it is an **addition, not a replacement**: Dynamic Lighting stays, and
the two can be used separately or together.

NDI was originally part of this release. It moved to v3.1.5 — not because it
is harder to build, but because it is the only one of the three with a licence
burden. Spout is BSD 2-Clause and Syphon is Simplified BSD: both need nothing
more than a copyright notice. The reasoning is under "Not done, and why".

### How it works

Chromium keeps the WebGL2 output inside its GPU process, and the D3D11 texture
handle is not normally reachable from the application. Reading pixels back to
the CPU would cost roughly 475 MB/s at 1080p60 and would defeat the point of a
low-latency sender.

Electron exposes the GPU path directly. With
`webPreferences.offscreen.useSharedTexture`, the `paint` event carries the
texture itself — a shared `ID3D11Texture2D` handle on Windows, an `IOSurface`
on macOS — with no CPU copy at any point.

The architecture this slots into already exists. A hidden offscreen window
loads the same page `src/main/stream-server.js` already serves to OBS as a
browser source, so audio frames arrive over the WebSocket that is already
there and the rendering engine needs no changes at all. Spout and Syphon
become output targets beside "OBS browser source" rather than a parallel
pipeline.

### Linux gets no texture sharing, and there is no way around it

Spout is a Windows technology and Syphon is a macOS one. `texture-bridge` ships
prebuilt binaries for `win32-x64-msvc`, `darwin-x64` and `darwin-arm64` and none
for Linux, and Linux has no established equivalent to port to. The option is not
offered there at all rather than shown as a switch that does nothing; Linux
keeps the OBS browser source, which already works.

### Dependencies, and the question that is now answered

`@napolab/texture-bridge` covers both platforms in a single MIT dependency:
Spout over DXGI shared handles on Windows, Syphon over IOSurface and Metal on
macOS, with prebuilt N-API binaries for `win32-x64-msvc`, `darwin-x64` and
`darwin-arm64`.

It also ships a **receiver**, which the roadmap had not previously accounted
for: Resolume or any other Spout/Syphon sender can be read *into* the
visualizer as an input layer. That arrives free with the same dependency and
is worth a layer source of its own.

One thing was assumed rather than proven, and it was checked before anything
was built on top of it: `audify` runs in a separate Node subprocess precisely
because its prebuilds target the Node ABI rather than Electron.
`texture-bridge` has to load **inside the main process**, since that is where
`paint` events are raised. Node-API is ABI-stable across both runtimes, so it
should load without `electron-rebuild` — but that is exactly the kind of
assumption `audify` punished.

It held. A bare `require` in the main process succeeded, and so did the second
assumption underneath it: that Electron’s offscreen renderer really hands over
a GPU texture rather than falling back to a CPU copy. Measured at 60 fps with a
texture on every frame. Both were proven before the sender was written, which
is why the sender itself worked the first time it ran.

### Electron upgrade — a prerequisite, not a side quest

`texture-bridge` requires **Electron 40 or newer**. This shipped in v3.1.0:
the application now runs Electron 43.5.1, so the floor is already met.

The target is **43.5.1**. Electron 33.4.11 reached end of life on 29 April
2025 and carries Chromium 130 against 152 in the current line, which is the
real security argument on its own. Two smaller reasons pick 43 over 44: 43 has
had five patch cycles to settle where 44 is days old, and 43 carries
electron/electron#51287, which removed the white borders frameless fullscreen
windows had on Windows — this application creates exactly that kind of window.
Version 44 would cost no extra migration work and buys a longer support
runway, so it is a reasonable alternative rather than a wrong answer.
`electron-builder` moves from 26.8.1 to 26.15.x in the same change.

What the upgrade does **not** fix: electron/electron#45774, the white flash on
the first `show()` of a hidden window, is closed as not planned and untouched
since August 2025. The workaround — creating the window already visible and
already fullscreen, never calling `show()` — has to survive the upgrade intact,
and verifying that it still does is part of the work.

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

## v3.1.5 — NDI output

The same picture across a network: one machine runs the visualizer, another
running Resolume or a mixing console receives it over IP. This is the standard
in professional live and stage setups.

NDI inverts the difficulty of Spout and Syphon. It is **technically easier** —
the send side takes a CPU buffer, so the shared-texture path is not needed and
the `image` bitmap from the same `paint` event is enough. It is **legally
harder**: the application EULA has to cover the NDI SDK terms, a link to
`ndi.video` is required in the application, on the website and in the
documentation, and the NDI tools may not be redistributed. Placing an
EULA-bound binary inside an MIT-licensed project is the actual obstacle, which
is why it ships as a separate optional package. `grandiose` provides the
bindings.

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

### NDI
Free to use in commercial products, and no fee is involved — but the licence
is the whole difficulty. The application EULA must cover the NDI SDK terms, a
`ndi.video` link is required in the application, on the website and in the
documentation, and the NDI tools may not be redistributed. An EULA-bound
binary inside an MIT-licensed project is a packaging problem rather than an
engineering one, so NDI ships as a separate optional package in v3.1.5.

Spout (BSD 2-Clause) and Syphon (Simplified BSD) carry none of this, which is
why they go first in v3.1.1.

**What exists instead:** the **browser source** for OBS does the same job with
no plugin install and real transparency, and `src/main/stream-server.js`
already abstracts the output.

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
