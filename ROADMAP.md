# CAYADEV Visualizer — Roadmap

This document records, honestly, what has actually shipped and what is planned.
A row is only marked done when the feature works in the application and is
covered by a test or by the GPU self-test.

**Current release: v3.1.4** · **Next release: v3.1.5**

| Release | Theme | Released | State |
|---|---|:--:|:--:|
| v1.3.1 | Modes, backgrounds, recording | 2026-08-06 | Shipped |
| v2.0.0 | Shader editor, MIDI, OSC, OBS source, offline render | 2026-08-30 | Shipped |
| v2.1.0 | Layers, post-FX, 3D geometry, Art-Net, Auto VJ | 2026-09-01 | Shipped |
| v3.0.0 | Modulation, deep analysis, MilkDrop language, mapping, transitions | 2026-09-02 | Shipped |
| v3.1.0 | Timeline, Clip Deck, accidental-close protection, Electron 43 | 2026-09-02 | Shipped |
| v3.1.1 | Cross-platform builds, OpenRGB, Spout and Syphon | 2026-09-04 | Shipped |
| v3.1.2 | MilkDrop shader engine, Now Playing overlay, transparent visualizer | 2026-09-05 | Shipped |
| v3.1.3 | Per-application audio capture, aspect correction, Auto VJ rebuild | 2026-09-08 | Shipped |
| **v3.1.4** | **Streaming overlay and transparency fixes, MilkDrop fidelity** | **2026-09-15** | **Current** |
| v3.1.5 | MilkDrop and streaming refinements | — | Planned |
| v3.1.6 | Comprehensive video export | — | Planned |
| v3.1.7 | Broadcast layout editor | — | Planned |
| v3.1.8 | NDI output | — | Deferred |
| v3.2.0 | Redundancy, failover and frame sync | — | Planned |

---

## Status table

| Feature | v1.3.1 | v2.0.0 | v2.1.0 | v3.0.0 | v3.1.0 | v3.1.1 | v3.1.2 | v3.1.3 | **v3.1.4** | Note |
|---|:--:|:--:|:--:|:--:|:--:|:--:|:--:|:--:|:--:|---|
| Multi-monitor | ✅ | ✅✅ | ✅✅ | ✅✅ | ✅✅ | ✅✅ | ✅✅ | ✅✅ | ✅✅ | A separate window on every selected display |
| System audio | ✅ | ✅ | ✅ | ✅ | ✅ | ✅✅ | ✅✅ | ✅✅ | ✅✅ | WASAPI loopback on Windows, CoreAudio on macOS, PulseAudio/PipeWire monitor on Linux |
| Multi-source mixing | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | Mixed before the FFT |
| Per-application audio | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ◐ | ◐ | Shipped in v3.1.3 on Windows: WASAPI process loopback, include or exclude, several applications at once, targets stored by name and re-attached. macOS and Linux report why they cannot |
| Layer compositing | ❌ | ❌ | ✅✅ | ✅✅ | ✅✅ | ✅✅ | ✅✅ | ✅✅ | ✅✅ | Unlimited layers, 17 blend modes, groups, solo/mute/lock |
| Layer masks | ❌ | ❌ | ❌ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | Alpha from another layer, plus shape and gradient masks |
| Post-FX | ❌ | ❌ | ✅ | ✅✅ | ✅✅ | ✅✅ | ✅✅ | ✅✅ | ✅✅ | 40 GPU effects, orderable, audio-bindable, per-layer chains |
| Visualizer modes | 14 | 31 | 32 | **48** | **48** | **48** | **50** | **50** | **50** | Includes 14 generative modes, nowplaying and geometry |
| Spectrum metering | ❌ | ❌ | ◐ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | Four frequency scales, dB amplitude, attack/release ballistics, spread and smoothing |
| Broadcast layouts | ❌ | ❌ | ❌ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | Bar placement, logo beside the bars, track and artist text |
| Backgrounds | 10 | 19 | 19 | **31** | **31** | **31** | **31** | **31** | **31** | All share the palette and template system |
| Colour presets | 10 | 10 | 58 | 58 | 58 | 58 | 58 | 58 | 58 | Seven groups; apply to Studio and the 3D engine too |
| Formulas | ❌ | ❌ | 35 | **98** | **98** | **98** | **98** | **98** | **98** | 30 plane curves, 12 space curves, 29 surfaces, 27 attractors |
| 3D solids | ❌ | ❌ | ❌ | **13** | **13** | **13** | **13** | **13** | **13** | Platonic solids, geodesic spheres, L-systems, IFS clouds |
| True 3D | ❌ | ◐ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | Own matrix maths; no third-party 3D library |
| Modulation engine | ❌ | ❌ | ❌ | ✅✅ | ✅✅ | ✅✅ | ✅✅ | ✅✅ | ✅✅ | LFOs, envelopes, S&H, random → any config path |
| Deep audio analysis | ❌ | ❌ | ◐ | ✅✅ | ✅✅ | ✅✅ | ✅✅ | ✅✅ | ✅✅ | Constant-Q chroma, key, chords, HPSS, YIN pitch, loudness |
| Scene transitions | ❌ | ❌ | ❌ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | 18 transitions, switchable off |
| Projection mapping | ❌ | ❌ | ❌ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | Corner pin, mesh warp, soft edge, per-output masks |
| Aspect correction | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ✅ | ✅ | Shipped in v3.1.3. Corrects panels whose pixels are not square: the scene is drawn on a canvas matching the display's real shape and squeezed into the framebuffer, so nothing is cropped and every layer is corrected together. Calibrated by eye. Works on all three platforms |
| MilkDrop | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ◐ | ◐ | ✅ | Baseline in v3.1.2 (#559): a CSP-safe expression compiler, the HLSL warp and composite shaders translated to GLSL, 8 wave modes. Phase 2 and the fidelity work shipped in v3.1.4 (#560), behind a MilkDrop Fidelity switch: 16,346 of 16,346 shader stages compile and ~98% of presets render a live image. Detail in the v3.1.4 section; refinements under v3.1.5 |
| Live shader editor | ❌ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | GLSL, live preview, error line, custom sliders |
| Built-in shaders | ❌ | 5 | 5 | **42** | **42** | **42** | **42** | **42** | **42** | All compile on the GPU in the self-test |
| Shadertoy / ISF import | ❌ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | Local converters; no service is contacted |
| Scene templates | ❌ | ❌ | ❌ | **72** | **72** | **72** | **72** | **72** | **72** | Nine groups, each verified not to damage a working setup |
| Text and lyrics | ❌ | ❌ | ❌ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | Audio-reactive typography, LRC/SRT import, timing editor |
| MIDI | ❌ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | Learn; CC/note → any setting or action |
| OSC | ❌ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | UDP listener, hand-written OSC 1.0 parser |
| Art-Net / DMX | ❌ | ❌ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ArtDMX output; packet layout tested byte by byte |
| BPM / tempo | ❌ | ❌ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | Period histogram; tested to ±0.5 BPM |
| Auto VJ | ❌ | ❌ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅✅ | ✅✅ | Rebuilt in v3.1.3: pick exactly which scenes, visualizers or presets cycle, all 46 visualizer modes, per-layer variety, and a status line saying what changed and why nothing can |
| Recording | ◐ | ✅ | ✅ | ✅✅ | ✅✅ | ✅✅ | ✅✅ | ✅✅ | ✅✅ | One-key capture, GIF export, 4× PNG snapshot |
| Video / webcam input | ❌ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | Also readable as `sv_media` inside shaders |
| OBS integration | ❌ | ✅✅ | ✅✅ | ✅✅ | ✅✅ | ✅✅ | ✅✅ | ◐ | ✅✅ | Browser source — no plugin, real transparency. v3.1.3's overlay crashed on load and showed an empty page (#563); the self-test now opens it from the stream server on every run |
| Offline render | ◐ | ✅ | ✅✅ | ✅✅ | ✅✅ | ✅✅ | ✅✅ | ✅✅ | ✅✅ | Frame-exact and deterministic — the regression net |
| Windows Dynamic Lighting | ✅✅ | ✅✅ | ✅✅ | ✅✅ | ✅✅ | ✅✅ | ✅✅ | ✅✅ | ✅✅ | Unusual in this class. Windows only — elsewhere the card explains why and OpenRGB takes over |
| Mobile remote | ❌ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | Scenes, templates, Studio presets |
| Automated tests | ❌ | ◐ | ✅ | ✅✅ | ✅✅ | ✅✅ | **✅✅** | **✅✅** | **✅✅** | **1597** unit tests at v3.1.4 + a GPU self-test over every engine (1128 at v3.1.3, 971 at v3.1.2, 808 at v3.1.1, 703 at v3.1.0) |
| Timeline | ❌ | ❌ | ❌ | ❌ | ◐ | ◐ | ◐ | ◐ | ◐ | Shipped in v3.1.0. Tracks, clips, automation lanes, markers, one shared transport. Partial: no multi-select on the canvas, no tempo map editing |
| Clip deck | ❌ | ❌ | ❌ | ❌ | ◐ | ◐ | ◐ | ◐ | ◐ | Shipped in v3.1.0. Sparse grid, beat-quantised launch, follow actions, performance view. Partial: one deck, and only scene/template slots apply |
| Accidental-close protection | ❌ | ❌ | ❌ | ❌ | ✅ | ✅ | ✅ | ✅ | ✅ | Shipped in v3.1.0. Recovery and an Esc lock, both off by default |
| Windows build | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | NSIS installer and a portable build |
| macOS build | ❌ | ❌ | ❌ | ❌ | ❌ | ◐ | ◐ | ◐ | ◐ | Shipped in v3.1.1. `.dmg` and `.zip`, Apple Silicon, built on a macOS runner. Unsigned, and system audio needs BlackHole. Never launched on a real Mac |
| Linux build | ❌ | ❌ | ❌ | ❌ | ❌ | ◐ | ◐ | ◐ | ◐ | Shipped in v3.1.1. AppImage and `.deb`, x64, built on a Linux runner. The audio engine loads; never launched on a real desktop |
| Runs without a Node install | ✅ | ✅ | ✅ | ✅ | ✅ | ✅✅ | ✅✅ | ✅✅ | ✅✅ | Windows never needed one: every build since v1.3.1 carried its own 93 MB `node.exe`. v3.1.1 drops that payload and covers all three platforms — the helper runs on the app’s own binary (`ELECTRON_RUN_AS_NODE`) |
| OpenRGB | ❌ | ❌ | ❌ | ❌ | ❌ | ◐ | ◐ | ◐ | ◐ | Shipped in v3.1.1. All three platforms, per-LED, sharing one renderer with Dynamic Lighting. Tested against a protocol-level server, not real devices |
| Spout / Syphon | ❌ | ❌ | ❌ | ❌ | ❌ | ◐ | ◐ | ◐ | ◐ | Shipped in v3.1.1. GPU handoff, measured end to end on Windows at 30 fps with none dropped. Syphon shares the code path but has never run on a Mac. Absent on Linux |
| Now Playing / SMTC | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ✅ | ✅ | ✅ | Shipped in v3.1.2. Windows SMTC session reader via persistent PowerShell loop, anchor interpolation, 7 animations, OG & Modern styles |
| Transparent window | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ◐ | ◐ | ✅ | Shipped in v3.1.2 but first worked in v3.1.4: the page painted an inline background colour over the transparent window, and every post-FX pass wrote opaque alpha. The page now stays clear, alpha survives post-FX and projection mapping, and a background effect keys out its dark areas below a threshold |
| Electron | 33 | 33 | 33 | 33 | **43** | **43** | **43** | **43** | **43** | 33.4.11 reached end of life in April 2025 |
Legend: ✅ present · ✅✅ best-in-class · ◐ partial · ❌ absent

### Not shipped yet

Kept separate from the table above on purpose: that one records what has
actually been released, this one records intent. Nothing here is in a user’s
hands, and a row only moves up once it ships.

| Feature | Target | State today |
|---|:--:|---|
| Per-app audio capture on macOS and Linux | v3.1.6 | Rules implemented and tested, no capture backend. macOS needs ScreenCaptureKit on 13+, Linux PipeWire or PulseAudio. Windows shipped in v3.1.3 |
| Live level meter per application | v3.1.6 | The picker lists and remembers applications but shows an audible/silent icon, not a moving level |
| MilkDrop and streaming refinements | v3.1.5 | Items found during v3.1.4 and while working on them, listed under v3.1.5 below |
| Comprehensive video export | v3.1.6 | Not started |
| Broadcast layout editor | v3.1.7 | Not started |
| NDI | v3.1.8 | Deferred for licence reasons, not difficulty — see "Not done, and why" |
| Redundancy / genlock | v3.2.0 | Not started |

### Shipped, but never run on real hardware

Some things pass their tests and are in users’ hands, but this machine
cannot verify them. They belong in the table above rather than in "not
shipped" — but calling them proven would be a lie.

| What | Verified | Not verified |
|---|---|---|
| macOS build | Builds on a macOS runner; arm64 Mach-O binaries confirmed inside the `.dmg`, and `NSMicrophoneUsageDescription` is present | Never launched on a Mac. Gatekeeper behaviour, BlackHole capture and CoreAudio enumeration are all unobserved |
| Linux build | Builds on a Linux runner; `audify` loads there in CI, and the `.deb` declares `libpulse0` | Never launched on a desktop. Monitor-source enumeration is untested against a real PulseAudio or PipeWire server |
| OpenRGB | Protocol encoded and decoded against a server implementing the wire format, 38 tests | Never driven a physical LED. Vendor quirks and per-device direct-mode support are unknown |
| Syphon | Shares the whole code path with Spout, which was measured end to end on Windows. The macOS handle conversion is unit-tested | Never run on a Mac. The IOSurface path has never touched a real GPU |
| Per-app audio capture on macOS and Linux | The platform rules are a pure module with 36 tests: Windows build 20348, macOS 13 via ScreenCaptureKit, Linux via PipeWire or PulseAudio, and each unsupported case reports its own reason | Neither has a capture backend at all. Nothing has been run on a Mac or a Linux desktop |

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

- **2184 unit tests, all passing** on `main`. 703 of those shipped in v3.1.0;
  105 came with v3.1.1; 163 came with v3.1.2; 157 came with v3.1.3 — 1128 at
  that tag — 469 more with v3.1.4, most of them from the MilkDrop work, and 587
  on `main` since.
  Formulas are checked against values derived
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

NDI was originally part of this release. It moved to v3.1.8 — not because it
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

## v3.1.2 — MilkDrop shader engine, Now Playing overlay, and transparent visualizer · shipped

- **MilkDrop shader engine and bugfixes (#559)**:
  - Rewrote the expression compiler from `new Function` JavaScript generation to an AST closure tree, solving the Content Security Policy eval block without `unsafe-eval`.
  - Translated MilkDrop HLSL warp and composite pixel shaders into WebGL2 GLSL with multi-pass type inference. **91.7% of all shader stages compile** across 10,347 official and community presets; **85.0% of presets have completely clean shader pipelines**.
  - Fixed warp texture wrapping: MilkDrop defaults to `REPEAT`, whereas the engine previously clamped edges, causing effects to collapse and empty (e.g. Agitator brightness dropping from 16.7 to 0.7).
  - Restored 8-bit saturation clamping on feedback buffers, preventing runaway white/yellow blowouts on float buffers.
  - Implemented all 8 MilkDrop waveform modes, custom shapes, and custom wave geometries matching BeatDrop / MilkDrop reference implementations.
  - Aligned audio scale and decay mappings (`bass/mid/treb` normalized to long-term average, `fDecay` header mapped to per-frame decay).
  - *Deferred to Phase 2 (quality pass)*: User sprite textures (`img.ini`), motion vectors, preset crossfade blending, and mouse interaction.
- **Now Playing overlay**:
  - Live system media integration via Windows SMTC (GlobalSystemMediaTransportControlsSessionManager) through an event-driven native C# helper, with a persistent PowerShell 5.1 helper as fallback (0–1 ms steady-state overhead).
  - Anchor-based time extrapolation (`positionAt` / `anchorMs`) to provide smooth elapsed/remaining progress between sparse OS timeline updates.
  - 7 entrance animations (`fade`, `slideUp`, `slideLeft`, `scale`, `typewriter`, `wipe`), marquee scrolling for long titles, and audio-reactive bass pulse.
  - Modern and Classic OG Winamp styles with continuous or 40-segment progress bars.
  - Full admin configuration panel with live playback status indicator (green/dim/red).
- **Transparent visualizer window (Addendum 4.0)**:
  - Support for `background.transparent` toggle, creating an Electron window with `transparent: true` and `#00000000` background, clearing canvases with `clearRect`, and removing body background to run overlays directly above the desktop or game capture.
- **Verification**: 971 unit tests passed at release. Automated GPU smoke test verifies all 50 modes, 31 backgrounds, 40 post-fx, and zero untranslated UI strings.

## v3.1.3 — Per-application audio capture and aspect correction · shipped

Pick which application's audio is analysed. Separate a game or a voice chat
from the music, so the visualizer follows only Spotify or the DAW instead of
whatever the system is mixing.

### Per-application audio capture

- **Windows**: WASAPI process loopback — `ActivateAudioInterfaceAsync` with
  `VIRTUAL_AUDIO_DEVICE_PROCESS_LOOPBACK`, in a self-contained .NET helper
  (`native/app-audio-helper`) because the API is COM-only and cannot be
  reached from Node. Chosen over a native node addon so it does not have to
  be rebuilt against every Electron ABI bump. Requires Windows build 20348.
- **A source kind, not a mode.** An application target sits in the same
  `audio.sources` list as devices and mixes into the same buffer before the
  FFT, so "Spotify + microphone" is one selection rather than a special case.
  Several applications can be captured at once.
- **Include or exclude.** Capture only the chosen applications, or everything
  *except* one. Exclude is limited to a single application: the OS interface
  takes one process id, and two exclusion streams would each carry the other
  application's audio and double-count it when mixed.
- **Targets are stored by executable name, not process id.** A pid changes
  every time the user restarts the application; a source bound to one would
  silently fall to silence. The saved target is re-resolved on each start,
  preferring a process that is actually producing audio.
- **Reattaches on its own.** Choosing an application that is not running yet
  is normal — the capture stays alive, silent, and attaches when the
  application appears. It also survives that application being restarted.
- **macOS and Linux**: the platform rules are implemented and tested
  (`src/shared/app-audio.js`), but no capture backend exists yet. Both report
  clearly why rather than failing silently. macOS needs ScreenCaptureKit on
  13+, Linux needs PipeWire or PulseAudio. **Neither has been verified on
  real hardware.**

Measured on Windows 11 build 28020, against the packaged build — the helper
resolved from `resources/bin`, the path that only exists on a user machine:
a browser playing music gave 299 packets / 143,520 frames in 3 s at 48 kHz,
peak amplitude 0.21. End to end through the analysis pipeline, one
application gave a peak bin of 236/255, and mixing two applications with the
default output device gave 255.

Exclude took two measurements rather than one, because a single one cannot
tell filtering apart from a dead stream. Excluding the browser that was
playing gave peak 0; excluding a *different*, silent application gave peak
247. The second is what carries the claim: the stream is alive and passes
everything else through, and it is the named application that disappears
from it.

Only applications with a live audio session can be picked from the list —
that is where the list comes from. A saved target outlives the session: it
is stored by name, so closing and reopening the application re-attaches it.

### Aspect correction

A display's reported resolution does not always match its physical shape. A
panel driven at 1920x1080 that is really about 3:1 — a stage LED wall, a bar
display, an anamorphic projector, a TV forced into a stretched mode — draws
every circle as an ellipse. Logos come out squashed, and so does everything
else: text, effects, the background. The operating system does not know, and
the application cannot see it: the window is 1920x1080 and the rest is behind
the glass.

- **The frame is not stretched.** Scaling a finished frame up crops it and
  scaling it down leaves bars; both lose picture. Instead the scene is drawn
  onto a square-pixel canvas whose proportions match the panel's real shape,
  and that canvas is squeezed linearly into the framebuffer. The panel's own
  distortion undoes the squeeze. No cropping, no bars, nothing pushed off the
  edge.
- **One setting corrects everything.** Background, visualizer, logo, text and
  sprites all share the same logical space, so they are corrected together —
  which is the point, since the usual workaround (pre-stretching an image in
  another program) fixes the logo and nothing else. The panel says to swap
  such images back to their originals, because they already carry the
  compensation and would otherwise be corrected twice.
- **Calibration is by eye.** Nobody can measure the LED wall behind the stage,
  but anyone can see whether a circle is round. Turn on a circle, square or
  grid pattern and move a logarithmic slider until it looks right. Entering
  the panel size, its true aspect ratio, or the dimensions of an image already
  stretched by hand are secondary paths to the same number.
- **Per screen or all screens**, keyed the same way as projection mapping.
- **Full resolution by default.** Splitting the difference between the axes
  keeps the pixel count identical but, at a real pixel ratio of 1.68, renders
  833 rows and stretches them over the panel's 1080 — throwing away
  resolution the display can actually show. The default keeps every axis at or
  above the framebuffer instead; the cost is stated in the panel and capped so
  an extreme ratio on a 4K panel cannot stall the render.
- **Cross-platform.** This is canvas geometry, not native code: it works on
  Windows, macOS and Linux alike.
- **A property of a physical output, not of the scene.** It applies only to
  the visualizer window on that display. Exported video, the stream and the
  web overlay are left alone — they are watched on other screens, where the
  correction would itself be the distortion.
- **Composes with projection mapping**, which stays a separate stage for a
  different problem: mapping fits the image to an uneven surface, this repairs
  the panel's pixel geometry. Mapping coordinates are normalized and the
  squeeze is linear, so an existing corner calibration does not move.

Measured on Windows 11 build 28020: on a 1920x1080 window with a pixel ratio
of 1.681 the logical canvas becomes 3228x1080, and a shape drawn 1:1 comes out
at 0.9999 — round. With the correction switched off the same measurement
reports 1.68, so it distinguishes the two cases rather than always agreeing.
With projection mapping enabled at the same time, the mapper canvas follows
the corrected source exactly.

### Tempo and Auto VJ

Auto VJ was reported as not working. It had been working the whole time; it
had no way to say so, and four other faults were silent.

- **The silent failure.** The default source was Scenes, and with no saved
  scenes — every new install — the switch failed and returned false. Nothing
  changed, nothing was printed, and the feature was indistinguishable from a
  broken one. The default is now Visualizers, which is never empty, and a
  status line reports what changed, what is next, and why nothing can happen
  when a source is empty.
- **Clicks were being dropped.** The panel rebuilt itself on every switch, so
  a click landing during the rebuild hit a node that was being replaced. This
  is why the source buttons appeared dead. The status line now updates in
  place and the panel is not rebuilt while running.
- **Text layers were destroyed.** A text layer carries `kind: 'visualizer'`
  with `type: 'text'`. Auto VJ took the first match and overwrote its type,
  turning a configured text layer into a spectrum analyzer with no undo.
- **Two visualizers collapsed into one.** Every targeted layer was given the
  same type. Each layer now draws its own, distinct within a switch.
- **One cursor drove two rotations** — which item comes next, and in All mode
  which kind comes next — so they interfered. Cursors are now per source.
- **Colour presets did nothing visible** unless the background happened to be
  in gradient mode; they now drive the visualizer colours as well.
- **Scenes bled into each other**, and the copy of the scene loader that Auto
  VJ carried was missing blackout protection, image normalization and layer
  stack sync. With the output blacked out, switching a scene would have lifted
  the blackout on stage. There is now one loader.
- **Comprehensiveness.** Each source takes an optional list of exactly which
  scenes, visualizers or presets to cycle, empty meaning all; colour presets
  can be limited to built-in or user-made; the rotation covers all 46
  visualizers the type picker offers rather than the 30 that were hard-coded —
  spectrogram, flowfield, galaxy, dna and milkdrop among those it had never
  once reached. A test compares the two lists so they cannot drift apart.
- Random no longer repeats the item it just showed, which read as the feature
  having stopped.

Rules live in `src/shared/autovj.js` with 23 tests. Measured in the packaged
build: with two visualizer layers and one text layer, three switches in 2.6 s
produced different types per layer, left the text layer untouched, and
rebuilt the panel zero times.

### Also landed in this release

- **Adaptive colour theme engine** (`src/shared/adaptive-theme.js`):
  - Derives the 5-point background gradient and the visualizer primary and
    secondary colours from the playing track. Six modes: `artwork`,
    `artworkOrRandom`, `random`, `energyMood`, `presetRandom`, `presetCycle`.
  - Album-cover extraction bins pixels into 16 hue buckets plus three neutral
    buckets, weights saturated mid-tones higher, and rejects candidates closer
    than 36 in luminance-weighted colour distance so the gradient stays legible.
  - `random` draws from eight harmony styles (analogous, complementary, triadic,
    cyberpunk, warm sunset, deep ocean, synthwave, aurora); `energyMood` maps
    the track title and artist through a six-family lexicon, falling back to a
    deterministic hash of the text so the same track always gets the same palette.
  - Off by default (`dynamicTheme.enabled: false`), with separate
    `applyToBackground` and `applyToVisualizer` switches.
- **`theme` colour mode across every visualizer mode**: `visualizer.colorMode`
  is now `'custom' | 'theme' | 'rainbow'`, and `theme` samples the 5-point
  gradient by position, so a mode's colours follow the scene palette instead of
  a fixed hue ramp. Old configurations that only carried `rainbow` are migrated.
- **Windows SMTC hardening (#561)**: replaced the blocking artwork retry loop
  with a cancellable staged fetch, and added SHA-256 hash tracking of previous
  covers so a late-arriving thumbnail from the previous track cannot overwrite
  the current one on rapid skips.
- **Album artwork as a logo source**: `logo.source` gained `'track'`, so the
  logo layer can display the cover of the playing track.
- **Stream server**: overlay and mobile-remote tokens are now separate, with
  cookie-backed sessions, an explicit token-enforcement switch, and a hardened
  shutdown path. A native clipboard bridge replaces the browser copy fallback.
- **Web surfaces**: the mobile remote gained a live now-playing card; the OBS
  overlay is wired to the show clock and the colour theme.
- **Spout / Syphon output** (`texture-share`): dynamic resizing, paint-loop
  triggers and an `onReady` lifecycle hook. Verified working on Windows.
- **Transitions**: dissolve now composites with `destination-out` on blackout
  and detects transparent backgrounds, so a transition over the transparent
  visualizer window no longer flashes a black rectangle.
- **Layer fixes (#561)**: stale layers no longer persist across template
  switches, and layer synthesis, logo coordinates and preview synchronisation
  were corrected.
- **Audio**: the smart silence filter gained a dual mode with 50/60 Hz mains-hum
  detection (`audio.humGuard`), so a quiet room is not mistaken for signal.
- **Power**: a silent accidental-close confirmation (`power.confirmClose`), a
  crash-recovery status watchdog, and a Ctrl+Shift+Q rescue shortcut for when
  the visualizer window cannot be reached.
- **Shutdown**: closing the panel now really ends the process. Electron counts
  hidden windows in `window-all-closed`, so the offscreen Spout/Syphon window —
  created at startup whenever the setting is saved — kept the event from ever
  firing: `app.quit()` was never called, the `before-quit` cleanup never ran,
  and the application stayed alive in the background with no visible window.
  Helper windows are now torn down with the panel, the export render window
  included, and the cleanup list lives in one place because the two branches of
  `before-quit` had drifted apart, both missing `textureShare` and `openrgb` —
  which left the Spout sender registered after the application closed.

### Verification

1128 unit tests pass at v3.1.3 (157 added during this release). The GPU smoke
test passes, and the packaged build passes its own self-test; `dist/` holds
v3.1.3 artifacts.

## v3.1.4 — Streaming overlay, transparency and MilkDrop fidelity · shipped

An interim release. v3.1.3's streaming overlay was blank for everyone who used
it, and the transparent background had never worked; both are fixed, and the
MilkDrop work that had been on `main` since v3.1.3 ships with them. The
refinements this work turned up are planned for v3.1.5 rather than rushed in.

- **Streaming overlay (#563).** The overlay page crashed on load in v3.1.3:
  aspect correction made the visualizer call `SVAspect`, and `overlay.html`
  never loaded `aspect.js`. The error sat in a hidden box, so OBS and the
  browser showed an empty page with nothing in the console. The page now shows
  the error and logs it, and the self-test opens the overlay from the real
  stream server on every run, the packaged build's self-test included —
  verified by removing the script tag and watching it fail with v3.1.3's exact
  error.
- **Transparent background.** The desktop window was created transparent, but
  the page painted an inline background colour over it, and every post-FX pass
  wrote opaque alpha, so neither the window nor the overlay was ever
  see-through. The page now stays clear, alpha survives post-FX and projection
  mapping, and a background effect keys out its dark areas below a threshold.
  The overlay follows the same switch as the app (it no longer forces a
  transparent type that dropped effects and broke text); post-FX keeps source
  coverage so dark glyphs and outlines stay intact; Windows no longer uses
  exclusive fullscreen when transparent; the layer stack exposes the switch
  at the top of the list. Spout/Syphon stays opaque — the GPU texture cannot
  carry alpha without dropping the sender.
- **MilkDrop (#560).** v3.1.2 left a working baseline; this is the release
  where it became faithful. Phase 2 shipped first — textured shapes, motion
  vectors, rotation matrices, mesh density and internal resolution settings,
  mouse input, preset transitions, per-sampler filtering and wrapping, and
  user textures loaded from your own texture folder, which 16.9% of the corpus
  asks for by name. Everything below it sits behind the **MilkDrop Fidelity**
  switch, and every figure comes from the 10,332-preset corpus, measured by
  `scripts/milkdrop-compile-rate.js` for what compiles and
  `scripts/milkdrop-render-rate.js` for what draws a live image.

  - *Two fidelity passes.* The first closed what a corpus diff turned up: two
    header settings that never reached the equations (`fZoomExponent`,
    `fWaveParam`), a vertically mirrored warp mesh, the warp ripple's real
    coefficients with `fWarpScale`/`fWarpAnimSpeed`, waveform smoothing,
    volume-driven wave alpha, and the outer and inner borders with centre
    darkening. The second was worked from Nullsoft's own MilkDrop 2 C++ source
    rather than from a port, and corrected the mesh transform's order and
    spaces, the swapped `aspectx`/`aspecty`, the shader clock,
    `bMotionVectorsOn`'s real meaning, the blurred copy's edge darkening and
    the custom-wave amplitude.
  - *Per-frame state resets where MilkDrop resets it.* The built-in per-frame
    variables reload from the preset file every frame and `q1..q32` return to
    their post-init values, which 19.5% of the corpus depends on — it writes an
    accumulation that grew without bound here. The same reset reaches one level
    down: a wave or shape block's `t1..t8` return to their post-init values
    before every per_frame run, per instance for shapes as MilkDrop reloads
    them, and a custom wave's sample count is reset to the file value and read
    back after per_frame, so a preset that drives its point count from audio is
    heard. 1,805 presets write `t` in a wave block, 1,139 in a shape block, 196
    write `samples`.
  - *Preset transitions are the dual pipeline.* Both presets keep running, the
    two warp meshes blend per node along a random ramp, and that same ramp is
    the alpha their shaders draw with, over one shared feedback buffer.
  - *The blur chain reads what MilkDrop reads* — the warp pass' input buffer,
    which is the previous frame complete with the shapes, waves and borders
    drawn onto it, rather than the warp's output: the same content one warp
    step too far along, which dragged the bloom through the motion field and
    dimmed it by the decay. 71.3% of the corpus reads `GetBlur`. The chain also
    builds only the levels a preset actually reads, the way MilkDrop counts
    them — 28.7% of the corpus reads no blur at all and was paying for six
    passes a frame, and across the corpus 47.0% of the passes were unread. The
    frame-time effect measured below this harness' noise floor at both 1024x768
    and 1920x1080, so this is faithfulness and removed work rather than a
    demonstrated speedup.
  - *Waveform smoothing as MilkDrop smooths it:* a four-tap kernel inserts a
    point between every pair, doubling the vertex count, with the negative
    outer weights that keep a curve from flattening as it smooths —
    unconditionally on the default waveform, and on every custom wave not drawn
    as dots, 7,798 of the corpus' 11,884 live wave blocks.
  - *Colour wraps where it used to clamp.* Vertex colours go through MilkDrop's
    `COLOR_NORM`, which does not clamp out-of-range values but wraps them
    modulo 256: a preset whose equation yields 1.5 draws at 0.494 there, not at
    1.0, and we were drawing it white. 36.9% of the corpus produces at least one colour or
    alpha where the two differ materially, and 19.9% goes past 1.4, where the
    wrap is a different colour entirely.
  - *The feedback buffer is a normalised RGB10_A2 target rather than
    half-float.* MilkDrop's buffer is 8-bit integer, so every write clamps and
    the whole engine assumes it — a half-float target let additively drawn
    shapes accumulate without bound, measured reaching 65504 within forty
    frames. Ten bits a channel keeps four times MilkDrop's precision while
    restoring its clamping, which is what projectM #895 asks for.
  - *The `monitor` variable is finally read.* It is the preset author's own
    debug probe, written by 43.4% of the corpus and never surfaced anywhere, so
    those lines were dead. It now shows live in the MilkDrop panel; projectM
    has the same request open as #664.
  - *A decay of exactly zero is honoured* rather than read as "not set" and
    replaced with 0.98. 225 presets (2.17%) end up asking for no trail at all
    and were getting a heavy one, while exactly one preset in the corpus omits
    decay and actually wants the default.
  - *Flash limiting* caps how far the picture's mean luminance may move between
    frames, at WCAG 2.3.1's general-flash value. Measured, 90% of presets never
    reach it and pass through untouched, while a synthetic strobe drops from
    0.996 to 0.098. projectM has this open as #947 and #742.
  - *Every shader stage in the corpus compiles.* Each of the last 134 that did
    not was traced from the compiler's own line number back to a cause, which
    is not the same as grouping them by error text: one message ("wrong operand
    types") was hiding five separate causes, and one cause — HLSL's `bool` used
    as a number, which presets treat as a float holding 0 or 1 — accounted for
    46 stages across four different messages. The rest were a `#define` gluing
    itself to the declaration below it and so defeating global-initialiser
    hoisting (19), a wrapped declarator list losing its tail so `Kugel1..3`
    stayed untyped and a vec2+vec3 went out unnarrowed (20), the same name
    declared with three different types in three different functions (16),
    `int(x)` rewritten as a type rather than kept as a conversion (10), a
    preset that `#define`s `main` over ours (9), and eight smaller ones down to
    a single preset each. The corpus now compiles 16,346 of 16,346 stages with
    all 8,485 shader-carrying presets clean. Every step was checked with a diff
    keyed on file+stage rather than on the aggregate percentage, which cannot
    tell "fixed 45" from "fixed 45, broke 33" — it caught exactly that twice,
    and the final state is 134 fixed and none broken.
  - *Shape outlines and motion vectors got the treatment the waveform had
    already had*, and two separate things were missing at once. `thick` never
    reached the renderer: the parser read `thickOutline` and the draw code
    never looked at it, so a shape's border was always a single draw where
    MilkDrop draws it four times, offset around a one-texel square
    (milkdropfs.cpp:2247-2259) — and MilkDrop registers `thick` as an
    input/output variable (state.cpp:496), so the shape's own per_frame code
    can set it, which 15 presets do. Neither the border nor the motion vectors
    were resolution-compensated either, so at 1920 they stayed one pixel wide
    while every waveform in the same frame was already scaled; MilkDrop's own
    line is one texel in a 512-wide buffer, close to four pixels in ours. 2,961
    of the corpus' 15,989 live shape blocks draw a border (1,821 presets,
    17.6%), 425 of those ask for `thickOutline` as well (309 presets, 3.0%),
    and 884 presets (8.6%) draw motion vectors. Measured with the feedback loop
    removed — decay=0, no shaders, the fill fully transparent so only the
    border is on screen, at 512x384 — the border's deposit was 380 whether
    `thick` was set or not and whether it came from the file or from the
    equations: the identical number in all four cases is the gap itself. It is
    920 without `thick` and 1,300 with it now, and motion vectors went from
    9,140 to 23,444.
  - *Lines are anti-aliased ribbons* rather than one-texel GL lines fattened by
    offset redraws — a deliberate divergence from MilkDrop, and the one place
    we set out to be better than it rather than equal to it; projectM has the
    same request open as #682. The default conserves the light the old path
    deposited so no preset changes brightness, measured within about 12% per
    frame with the feedback loop removed, and a setting offers the physically
    true width instead, or MilkDrop's own fattening. One setting drives all
    three line kinds rather than leaving a smooth waveform beside a jagged
    outline in the same frame: the border as a closed strip, the motion vectors
    as independent segments batched into a single triangle strip with
    degenerate joins, because a 64x48 grid is 3,072 vectors and one draw call
    each would eat the frame. Calibrating it turned up a defect in the shipped
    waveform path: the gain that conserves the old path's light divides by the
    number of draws that path made, and draw count stops predicting light once
    the offset copies overlap. With `bWaveThick` set — the saturated case,
    seven draws — waveforms were depositing +16.0 / +33.7 / -9.6 / +19.0 /
    +17.1 percent against the path they were supposed to match. Measured, going
    from weight 2 to weight 4 multiplies draws by 1.75 but light by 1.58 on
    average, so the proxy carries a 0.90 overlap factor now, applied only where
    the offset list saturates — the weight-2 case AA_TRIM was calibrated
    against is bit-for-bit unchanged. That brings the same five to +4.8 / +24.6
    / -18.9 / +7.3 / +5.4, the outline to +15.0 and motion vectors to -6.6. The
    spread does not close and cannot: it tracks segment count, which no single
    multiplier can cancel.
  - *Presets hear the music the way MilkDrop hears it.* `bass`, `mid`, `treb`
    and their `_att` values come from MilkDrop's own chain — the newest 576
    samples, a Hann-windowed 1024-point FFT with its equaliser, three bands
    summed over the lower half of the spectrum, a fast asymmetric average for
    `_att` and a four-second one to divide by — instead of the visualizer's
    bands smoothed twice and divided by a six-second average, which on a
    synthetic drum track put bass lower just after a kick than between kicks
    (0.93x against MilkDrop's 2.45x) and never raised `_att` on a hit. The
    averages start from the first frame with sound rather than from zero, and
    values are capped at 30, where the track's own music peaks at 18.6 and
    MilkDrop reaches 234 coming back from a long silence. Spectrum waves read
    the newest 576 samples too, where they had been reading the oldest 576 of
    the 2048-sample buffer, about 30 ms behind the sound.
  - *A MilkDrop scene exports to video.* It produced a 0-byte file: the
    exporter's page never loaded the engine's audio, HLSL and shader parts —
    the same gap the web overlay had already been fixed for — so the mode threw
    on every frame. In the same self-test run the other two scenes exported
    1,607 KB and 125 KB; MilkDrop now exports 1,394 KB with no black frames,
    and the self-test exports a MilkDrop scene every run.
  - *Auto advance advances.* The panel's slider had been writing
    `milkdrop.autoNext` since the engine landed and nothing read it — set to
    two seconds, the preset on screen was unchanged nine seconds later in the
    running app. The visualizer now switches on its own frame clock, in order
    or at random without repeating the preset on screen, and never writes the
    pick into `settings.json`, which is rewritten in full on every change; the
    panel shows the live preset and its preview follows the visualizer.
  - *A MilkDrop layer survives scene transitions.* A transition rebuilt every
    layer of the arriving scene, so MilkDrop restarted its preset, lost its
    feedback trail and fell back from auto advance to the hand-picked preset —
    on every track for anyone running the dynamic colour theme with scene
    transitions, since the palette is part of the scene signature. The instance
    now stays and the leaving scene composites its canvas through a proxy;
    measured in one run with the fix switched off and on, off gave a new
    instance on the hand-picked preset, on kept the same instance and preset.

### Verification

1597 unit tests pass at v3.1.4 (469 added since v3.1.3). The GPU smoke test
passes, and the packaged build passes its own self-test. 881 of 900 sampled
presets render a live image.

## v3.1.5 — MilkDrop and streaming refinements

What the v3.1.4 work turned up, done carefully rather than rushed into an
interim release — and what that work turned up in turn.

MilkDrop (#560):
- **Waveforms read the newest audio** · done on `main`. The default and custom
  waves read the oldest 576 samples of the 2048-sample buffer, ~30 ms behind
  the sound, with the mono buffer 128 samples further on standing in for the
  right channel, and MilkDrop's wave alignment did not exist. With the switch
  on, each channel's newest 576 samples now go through that alignment
  (pluginshell.cpp:1526-1667): compared with the previous frame coarse to fine
  over six halvings and shifted by up to 95 samples, the other 96 zeroed, so a
  steady tone stands still on screen. The default wave's vertex counts start
  from the 480 valid samples instead of 512, and a spectrum wave's two values
  are the left and right spectra. A custom wave with more than 480 samples
  reads before the start of its array in MilkDrop — 33.1% of the corpus has
  one: the part of that read that lands on the other channel is reproduced
  exactly and the rest reads zero, a stated choice for what C leaves undefined.
  On the 900-preset sample no preset changes class in either mode and the
  switch-off results are identical; that measurement checks whether a preset
  renders a live image, which the ends of a wave do not decide, so the checks
  that matter are 20 unit tests running the alignment, including 120 frames
  of mixed signals whose offsets match a separately written implementation of
  the source algorithm. Twelve presets rendered alone — six default-wave modes,
  custom waves and spectrum waves — were identical pixel for pixel with the
  switch off; with it on, the wave arrays
  the engine drew matched the alignment fed the same audio on every frame, and
  a custom wave's two values differed on every frame where they had been
  equal.
- **The bands read the aligned left channel** · done on `main`. Found with the
  item above: MilkDrop computes `bass`, `mid` and `treb` from `fWaveform[0]`
  (plugin.cpp:6875-6884) - the left channel - and it does so after aligning,
  not before (pluginshell.cpp:833-835 then plugin.cpp:3401). Ours read the
  mono mix, unaligned. Every preset reads the bands, so this was measured on
  its own: on the 900-preset sample 10 presets (1.1%) changed any recorded
  value and 5 changed class - two live images now read as blown out, two
  frozen ones as live and one live one as frozen - so 880 render a live image
  where 881 did. The legacy path is untouched and its run is identical byte
  for byte. Re-rendered alone in both trees, 9 of those 10 keep their class,
  and the one that moves goes from blown out to clean (mean brightness 0.974
  to 0.889). The analysed window is MilkDrop's own as well: when the aligner
  shifts, the last 96 samples are zeroed and enter the FFT as zeros, and on
  the measurement's own signal the shift is zero on 23% of frames, so that
  window alternates between 576 real samples and 480 plus 96 zeros - as it
  does in MilkDrop.
- **The default wave's modes draw as MilkDrop draws them** · done on `main`,
  in three measured steps (milkdropfs.cpp:2666-3035). 96.7% of the corpus
  draws the default wave.
  **Channels:** mode 0's circle reads the right channel and mode 4's Y the
  left, where we averaged both - averaging keeps what the channels share and
  cancels what differs - and mode 6 is a single line where we drew mode 7's
  pair, so 753 presets (7.3%) got a second line from the right channel and a
  gap MilkDrop never draws.
  **Geometry:** modes 4, 6 and 7 cap their points at a third of the render
  width, read from the middle of the valid window, and clip their line to the
  screen at 1.1 before spreading the points over what is left. We spread every
  point over the unclipped line from -3 to 3, so two thirds fell off screen
  and the visible part was drawn with a third of the points MilkDrop uses.
  **Alpha:** the mode's own factor applies before the volume modulation and
  the clamp, not after - `wave_a` = 2 in mode 2 is 0.18 there and was 0.09
  here, and 19.9% of the corpus sets `wave_a` above 1 - mode 3 assigns its
  alpha rather than scaling `wave_a` and multiplies by the square of the raw
  treble band, mode 5's faintness multiplier was missing altogether, and the
  mode number is truncated rather than rounded, with a negative one drawing
  nothing.
  Measured on the 900-preset sample with textures, accurate mode, at 960x720,
  because these modes read the render width and the old 240x180 runs do not
  describe them: the three steps changed 0, 1 and 0 presets, the one being a
  frozen picture that came alive. At 240x180 they changed 1, 0 and 2. The
  legacy path is untouched and its run is identical byte for byte at every
  step. Classes cannot see a picture that changes without crossing a
  threshold, so presets were rendered alone in both trees and compared pixel
  for pixel: all four mode-6 presets moved with the channel step (means of
  15.9 to 47.0 of 255), the mode-4 preset and three mode-6 presets with the
  geometry step (7.1, 9.4, 10.6, 1.9), and with the alpha step every one of
  ten mode-2/3/5 presets drew its wave at a different alpha (0.09 to 0.45,
  0.60 to 0.98, 1.00 to 0.45) with four pictures moving by 4.1 to 15.4.
  One deliberate divergence, and it is in the alpha: MilkDrop picks those
  values with a switch that matches only texture sizes 256, 512, 1024 and
  2048, while its own default makes that texture the window's width, so at
  any real size no case matches and the mode its source calls "constant and
  faint" draws fully opaque. The switch is widened to ranges here, which is
  what projectM does with the same code.
- **A custom wave's points start from MilkDrop's own seeds** · done on `main`.
  Found while reading the per-point loop for the item above
  (milkdropfs.cpp:2470-2478): MilkDrop seeds every point with `x` = 0.5 plus
  the wave's own sample, `y` = 0.5 plus the second sample, and the colour from
  what the wave's per-frame code left, then runs the point code. Ours seeded
  `x` with the sample's position, `y` with 0.5, and never re-seeded the
  colour, so a block that reads a channel before writing it carried the
  previous point's value: `a = a * 0.9` faded along the wave instead of
  applying once per point. Run through the engine's own equations across the
  corpus - twelve frames, six points a wave, both switch positions - 319
  presets (3.1%, and 5.0% of those that write per-point code) produce
  different points, and with the switch off none do. Of eight such presets
  rendered alone, four move visibly (means of 1.3, 10.0, 20.4 and 21.4 of
  255, up to 58% of pixels past 8) and all eight are pixel-identical with the
  switch off. On the 900-preset sample no preset changes class at 960x720.
- **The mesh's `q` writes stay in the mesh** · done on `main`. MilkDrop copies
  `q1`..`q32` into a second set of slots when the per-frame code finishes
  (milkdropfs.cpp:649-650); the per-vertex code writes that copy, while the
  waves and shapes drawn in the same frame read what per_frame left. We kept
  one pool, so a preset whose per_pixel writes `q` - 155 of them, 1.5% -
  handed the mesh's last value to its own waves and shapes. Run through the
  engine's equations across the corpus, with the mesh nodes evaluated between
  the frame code and the wave and shape code, 5 presets produce different
  output and none do with the switch off; four of the five differ on screen
  when rendered alone, one of them over 75% of its pixels. No preset changes
  class on the 900-preset sample.
- **A shape's side count, texturing and blending come from its equations** ·
  done on `main`. MilkDrop registers `sides`, `textured` and `additive` as
  input/output variables of a shape's per-frame code (state.cpp:491-495) and
  reads all three after running it (milkdropfs.cpp:2171-2176, 2205); the file
  value is only where they start. We read the file and never looked again, so
  53 presets that switch additive blending per frame, 8 that switch texturing
  and 4 that drive the side count were frozen at their first value - the same
  gap `thick` had. The side count is truncated and clamped to 3..100 after the
  equations, as the source does. On the 900-preset sample at 960x720 one
  preset changes class, and rendered alone in both trees it is identical -
  that flip is the picture it inherits from the preset before it in the run,
  not this change. The legacy run is identical byte for byte.
- **`hue_shader` only colours what the preset asked to colour** · done on
  `main`. MilkDrop mixes the four corner colours towards white by the
  preset's `fShader` amount, and skips them entirely below 0.001, leaving
  white (milkdropfs.cpp:3857-3876); the default is zero (state.cpp:548). We
  handed every preset the full colour. Of the 1,239 presets (12.0%) whose
  composite shader reads `hue_shader`, 914 leave `fShader` at zero - their
  picture was being tinted by a colour MilkDrop never sends - and 36 ask for
  a partial amount. Six of those presets rendered alone in both trees all
  differ, five of them by a lot (means of 3.6 to 26.9 of 255, up to 89% of
  pixels past 8), and all six are identical with the fidelity switch off; on
  the 900-preset sample no preset changes class. The same four colours then
  reached the other half of the picture: MilkDrop draws its fixed composite
  quad with them as vertex colours (milkdropfs.cpp:3940-3946) and we applied
  none, so the 631 presets that have no composite shader and ask for a
  non-zero `fShader` were missing the tint entirely. Six of them rendered
  alone all differ (means of 0.3 to 13.0 of 255, up to 60% of pixels past 8)
  and stay identical with the switch off.
- **Motion vectors sit where MilkDrop puts them and point where it points** ·
  done on `main`. Four differences in one field (milkdropfs.cpp:1172-1320):
  the count is truncated with its fraction widening the grid spacing, and the
  caps are 64 across but 48 down, where we rounded and capped both at 64; the
  grid runs from one edge of the screen to the other at `(i + 0.25) / (n +
  fraction + 0.25 - 1)`, where we centred it in half-cells; a trail shorter
  than one texel is stretched to one texel, where ours could vanish; and the
  segment runs from the point to where that point's content came from, where
  ours drew the mirror image of that - the whole field pointed the wrong way.
  884 presets (8.6%) draw them. Measured at 960x720, two presets changed a
  recorded value and one crossed into frozen at 8.1e-5 movement; of six
  presets that really draw vectors, five differ when rendered alone - means of
  3.4, 38.1, 49.7, 51.2 and 158.2 of 255, the last one over 95% of its pixels
  - and all six are identical with the fidelity switch off, whose run is also
  identical byte for byte.
- **A textured shape samples the window MilkDrop samples** · done on `main`.
  MilkDrop places a shape's corners at its own angle but does not turn the
  window it reads from the previous frame with them (milkdropfs.cpp:2198-2200):
  the texture angle is `tex_ang` alone, and the horizontal coordinate carries
  the aspect correction the vertical one does not. We added the shape's `ang`
  to the texture angle, so a turning shape dragged its image around with it,
  and we left the aspect factor out, so at 16:9 the window was 1.8 times too
  wide. 64.1% of the corpus draws a textured shape and 3,388 presets (32.8%)
  turn one. Measured on the 900-preset sample at 960x720, three presets
  changed a recorded value and one went from frozen to live; six textured
  presets rendered alone in both trees show five moving (means of 0.1 to 21.1
  of 255, up to 67% of pixels past 8), and all six are pixel-identical with
  the fidelity switch off.
- **The layer releases its WebGL context when it closes** · done on `main`.
  It deleted its GL objects one by one but left the context to garbage
  collection, and until then Chromium counts it as active; past the limit it
  drops the oldest context, which belongs to a layer or effect chain still on
  screen. Measured in an Electron page with one live WebGL2 context open while
  the layer was created, drew two frames and was disposed 40 times: before,
  the warning "Too many active WebGL contexts" came on the 16th and the live
  context was lost; now there is no warning, the live context survives, and
  all 40 disposed contexts are released at once. A disposed layer no longer
  draws, and three GL objects missing from its clean-up list — the textured
  shape buffers and the flash-limit program — are deleted too. Checking the
  other WebGL layers turned up the same gap in the Studio shader background,
  which had no `dispose` at all: the same measurement lost the live context on
  the 16th cycle, and now it releases its context like the rest.
- **The panel preview's demo signal gets broadband audio** · done on `main`.
  With MilkDrop's own band chain the demo's three low sines moved little more
  than `bass`. Measured at 45 FPS through the panel's own frames, `mid` stayed
  between 0.64 and 1.38 and `treb` between 0.66 and 1.30 - those are the
  8-bit quantisation noise against its own long average, not the music -
  while `bass` swung from 0.52 to 2.24. The panel now plays the waveform the
  900-preset render measurement plays: kick, snare, hi-hat, a bass line and a
  pad, from one shared file both read, so what the preview shows comes from
  the sound that was measured. On the same window `mid` runs 0.38 to 10.5,
  `treb` 0.25 to 11.4 and `bass` 0.44 to 4.11. The frame carries the two
  channels as well, so the Goniometer draws an area in the demo instead of a
  line, and the spectrum curve is untouched - it already shared the beat grid.
  The signal is defined before zero too: the panel asks for its first frame at
  time zero, where the recipe used to index past the start of its note table
  and hand back silence. Moving the recipe out of the measurement script
  changed nothing there - 2,459,200 samples identical byte for byte, and the
  900-preset run identical in both modes. The `--shots` screenshot generator
  still builds its own frame from three low sines; the README's two MilkDrop
  images no longer come from it — they are rendered with this signal by the
  item below.
- **Five MilkDrop presets of our own, in the application** · done on `main`.
  The engine has been here since v3.1.2 and the application shipped with one
  fallback preset: until you found a `.milk` pack and imported it, nothing on
  screen showed what any of this work does. Five presets now ship in the
  build, written in this repository, each a different kind — *Kutup Işığı*, a
  flowing nebula whose warp field opens and closes on the bass; *Erimiş
  Altın*, the loud one, with fast warp, thick polygons, a 48×36 motion-vector
  grid and cold lightning over a hot field; *Dingin Halkalar*, slow and
  nearly black, a few rings breathing with one dotted wave; *Sonsuz Tünel*,
  the classic flow with a radially exponentiated zoom and a core burning at
  the end of it; and *Nabız Örgüsü*, the graphic one, squares jumping on the
  beat between two spectrum waves over the weave the motion vectors leave.
  They live in code (`src/shared/presets-milkdrop.js`), not in the preset
  store: copied into `userData` they could be deleted by accident and an
  upgrade could leave a second copy of each. They register through the same
  built-in pool the 42 shaders use, so the panel, the layer picker and auto
  advance all see them without knowing they are different — auto advance
  reads `byKind('milkdrop')`, and that is now non-empty on a fresh install.
  The panel shows them with a *yerleşik* badge instead of a delete button,
  because a built-in has no file for `deletePreset` to remove and the row
  would come back on the next refresh. With no preset chosen the engine now
  draws the first of them rather than the minimal fallback, which stays as
  the last resort for a page that does not load the module.
  9 tests: every preset compiles with no errors, writes both `per_frame` and
  `per_pixel`, draws at least one shape or wave, and keeps its decay under
  0.99 — the first drafts saturated to white within a second at 0.982, which
  is the failure this bound is drawn around. The ids are `md_caya_*` so they
  cannot collide with the store's `md_<random>`, and they survive
  `safeName`'s character filter. Loading the module twice does not throw, the
  way `registerBuiltin` does on a duplicate id.
  The README's two MilkDrop images are regenerated from these presets: the
  still from *Kutup Işığı* at 1600×900, the animation from *Sonsuz Tünel* at
  760×428 and 11 fps, both rendered by the real engine on a real GPU with the
  shared demo signal, and the animation given the two-pass palette because a
  single pass bands visibly. The pictures they replace were rendered from
  corpus presets — other people's work, displayed in our README, which was
  the one place a third-party preset was actually being published.
- **Shader `vol` and `vol_att` as MilkDrop computes them** · done on `main`.
  The shader header maps them to the fourth component of the bass/mid/treb
  constants (include.fx:62, :66), and the line that fills it is a comma
  operator (milkdropfs.cpp:3732-3733): a shader's `vol` is a third of `treb`
  and `vol_att` a third of `treb_att`, not the three-band average the engine
  passed. 96 presets (0.93%) read them in a shader. Three of them rendered alone
  changed picture with the switch on while the value reaching the shader matched
  MilkDrop's formula on every frame, and stayed identical pixel for pixel with
  it off. The same change stopped copying `vol`, `vol_att`, the mesh size, the
  aspect pair and the pixel size into custom waves and shapes, where MilkDrop
  does not register them: run through the equations with the switch on and off,
  19 presets (0.18%) draw a wave or shape differently, every one because a shape
  reads a `vol` the per-frame code assigned for itself. On the 900-preset sample
  no preset changes class in either mode — 881 render a live image with the
  switch on, 862 with it off, as before.
- **The default wave's green and blue stay in order** · checked on `main`, no
  change on screen. The pinned source writes the default wave's green from
  `cb` and its blue from `cg` (milkdropfs.cpp:3101-3102), and this was put off
  three times because the vertex struct was not at hand. It is plain floats in
  RGBA order (support.h:71-75), so that fork does draw the two swapped — but
  the fork is a D3D11 port, and the D3D9 code it was ported from sets the
  colour in one call, `D3DCOLOR_RGBA_01(cr, cg, cb, alpha1)` (mvsoft74/BeatDrop
  53d83ee, milkdropfs.cpp:3225), a line the fork still carries as a comment in
  every wave mode. The swap came in with the port. The engine already draws in
  order; a test now pins it in all eight modes.
- **Layers hidden under MilkDrop are no longer drawn** · done on `main`. The
  rest of item 8. With the layer stack off, the scene still builds the
  background, and every frame drew it under a MilkDrop layer that covers the
  canvas with an opaque picture — the engine copies from a context created
  with `alpha: false`. Nothing showed, so this was a cost, not a glitch:
  measured in an isolated copy at 1920×1080 with the frame-rate cap off, a 2D
  aurora background took ~0.47 ms a frame and the WebGL gradient ~0.17 ms.
  A layer now covers what is under it only when its engine says its last
  frame covered the canvas (`covers()`, MilkDrop for now; a resized canvas or
  the engine's fallback text does not count), its blend is normal, its
  opacity full, it has no transform, mask or per-layer effect, and the audio
  is ready — without audio a visualizer layer clears its canvas that frame.
  Covered layers are skipped on both drawing paths, their canvases are hidden
  so the compositor skips them as well, and a layer is drawn again in the
  same frame it is uncovered. When the lights sample the background's
  colours, the background keeps drawing, or they would read a frozen frame.
  The same measurement afterwards, alternating new and old: 253.6/260.7 fps
  against 246.2/246.6 over the gradient, 264.8/266.9 against 234.8/238.5 over
  aurora. Export composes through the same path and is unchanged: MilkDrop
  over aurora exported on the commit before and after matches frame for
  frame, 60 of 60, each tree twice. One thing does change: a background that
  builds state frame by frame stops while covered and resumes from there when
  uncovered, rather than from where it would have been. The item's other
  point, the MilkDrop section hiding itself, was
  already gone: it has had no visibility condition since b6ef117. 6 tests;
  9 of 9 mutations caught.
- **The README's pictures hear the same sound as the preview** · done on
  `main`. The last place with its own signal was the `--shots` generator: its
  time data was three low sines, 4, 6 and 12 cycles per 2048 samples, the
  same narrow band the panel's demo lost in the item above, and the level
  every mode reads is that data's RMS. It now takes the time data and both
  channels from `src/shared/demo-audio.js`; its spectrum curve stays, with
  the hi-hat moved to the signal's eighth notes. Regenerating the pictures
  turned up three faults in the generator, all fixed: the four broadcast
  scenes came out without their logo, because the logo was written over the
  finished scene and never reached the template's logo layer — it now goes
  in through the base, the way a user's own logo does; the text scene carried
  a faded title from the scene before, captured 2 s into a 2.5 s transition —
  scene transitions are off while shooting; and a full run would have
  overwritten the two MilkDrop pictures, which were made separately from our
  own presets, so it now skips them unless `--only` names MilkDrop. 21
  pictures are regenerated from a fresh profile. Two are not: the shared
  signal is quieter (RMS −16.4 dBFS against the old −12.8), the tunnel's
  brightness follows loudness, and its still and animation came out 58% and
  42% as bright. They keep the previous render until the demo's loudness is
  settled; changing that would move the MilkDrop measurement's baseline.
  5 tests; 9 of 9 mutations caught.
- **Sprites from `milk_img.ini` (#577)** · done on `main`. The last item of
  this issue. MilkDrop 2 overlays images during a show, each defined in
  `milk_img.ini` with an image, init and per-frame code and a colour key, and
  launched by number (plugin.cpp:6695-6868, texmgr.cpp, milkdropfs.cpp:3286).
  The behaviour was written down from the source and the sample ini's own
  documentation first, and the code built from that description.
  - **What it does.** Up to 16 at once; a full set drops the oldest. The
    outputs start from MilkDrop's defaults, init runs once before the frame
    inputs exist, and every value persists from frame to frame. The five
    blend modes are 0 blend (the image's alpha ignored), 1 decal,
    2 additive, 3 srccolor and 4 colour key; the key makes exactly matching
    pixels transparent black at load. Tiling repeats from the centre, flips
    swap the corners, and `done` draws a last frame before the sprite goes.
    With `burn`, on by default, the sprite is also drawn into the feedback
    buffer, so it leaves its image and flows with the preset. Sprites are
    drawn over the composited picture and before the flash limiter, so a
    flashing sprite is limited too (#588). An image shared by several
    sprites is one texture, freed when its last sprite goes.
  - **Where the source overrides its documentation.**
    - `progress` is the preset transition's progress, not the preset's.
    - Positive `rot` turns clockwise on screen.
    - The width normalisation comes after the translation, so on a wide
      screen the y position scales with it too: the visible range is
      y = 0.5 ± 0.5·H/W, 0.22..0.78 at 16:9.

    The D3D11 port the rest of #560 was checked against comments out the
    kill on `done`; the D3D9 code kills.
  - **One deliberate divergence.** MilkDrop corrects for a 4:3 feedback
    texture and undoes that correction, but it undoes it every frame and
    applies it only on the last. On a wide screen the sprite is stretched
    vertically by (W/H)/(4/3), while its imprint is not. The feedback buffer
    here has the window's aspect, so neither step is applied.
  - **Launching.**
    - Choose the file in the MilkDrop panel (it lives outside scenes) and
      launch from its list, from MIDI and OSC mappings (every defined sprite
      is a target), or with MilkDrop's own keys in the visualizer window.
    - Main re-reads the ini on every launch, as MilkDrop does, and sends
      the command with a seed to every engine: visualizer windows,
      Spout/Syphon, the web output and the panel preview.
    - The page asks for the image by an opaque key. Its path never leaves
      the main process, and the web route is behind the token.
    - MilkDrop loads the image before the sprite starts. Here the load is
      asynchronous, so the launch waits for it, up to 5 s, keeping the
      order of later commands. Measured: without that, a sprite that died
      after eight frames never showed.
    - TGA, DDS, PPM and DIB, which MilkDrop also read, are reported as
      unsupported.
  - **Measured.** In the GPU self-test, a red decal sprite fills the centre
    ([255,0,0]) and is gone after remove-all. In an isolated copy with three
    displays, the web output, Spout and the panel preview:
    - all six drew the probe image at 5 of 5 sample points;
    - a sprite placed with `rand` sat at the same x/y on every engine;
    - remove-all cleared them all;
    - an unknown key got 404, and a request without the token got 401;
    - a burnt sprite's image stayed exactly where it was after the sprite
      died, and not mirrored.
  - **Tests.** 37 tests; 16 of 16 mutations that change behaviour are
    caught. Two more mutations did not change behaviour:
    - one showed a network-path check that the driveless-root rule
      already covers, and the check was removed;
    - the other, DELETE outside sprite mode, is already stopped by a later
      check.

Audio:
- **Both channels reach the visuals (#566)** · done on `main`. Found while
  planning the waveform item above: the capture helper averaged left and right
  into one channel before anything else saw them. Stereo width sat at 0 and
  correlation at 1 for every song — both are modulation sources — and the
  Goniometer, which the README calls a stereo phase scope, drew a vertical line.
  Each frame now carries the left and right channels next to the mono mix,
  which is computed exactly as before, so the spectrum, the bands and MilkDrop
  see the same numbers; the analyser gets both channels, the Goniometer
  draws left against right, and MilkDrop's waveforms read them with the switch
  on (the waveform item above). The web overlay receives them appended after its
  existing payload, so a page from an older build still reads its frame; the
  exporter decodes both channels of the file; screenshot mode and the MilkDrop
  render harness send a stereo signal whose mid channel is the old mono one.
  The self-test fails if a frame from the helper arrives without both channels;
  it passed with 4,637 frames and none missing them, and the export self-test,
  whose tone is now stereo with different channels, exported all three scenes
  with no black frames. With the harness sending stereo and the engine
  unchanged, all 900 sampled results are identical to the previous run, with
  MilkDrop Fidelity on and off.

Streaming and transparency:
- *Shipped early, in v3.1.4:* the overlay keeps a background effect and keys
  out its dark areas, following the app's Transparent Background switch, and
  switching it re-creates open visualizer windows.
- **Two copies at once (#564)** · done on `main`. Development, installed and
  portable builds share one settings folder with no lock, and two copies
  overwrote each other's settings. A second copy now asks at start-up and names
  the copy already running; while more than one runs, every copy's panel says
  so; and a copy that finds `settings.json` changed by someone else stops
  writing over it and asks whether to load that file or keep its own — which
  also covers older versions and hand edits. Verified with three copies on one
  isolated profile: 30 of 30 checks, from the start-up question to the load and
  keep choices and the warning clearing when a copy closes.
- **An overlay diagnostics card (#565)** · done on `main`. `?debug=1` on the
  overlay address shows the connection and its attempts, whether and when the
  configuration arrived, audio frames per second and the age of the last one,
  the page's frame rate and canvas size, the transparency in use, the version
  that served the page and the last error, a script that failed to load
  included. The self-test opens the overlay with the card on every run and
  checks what it reports; checked by hand connected, with a script removed, in
  English, and with the application closed.

## Next, not yet numbered — MilkDrop show control, library and MilkDrop 3 compatibility

Tracked in #583. Order: show control, then robustness, then the library; the
rest after. No version number yet.

- **Preset timing from MilkDrop 2 (#568)** · done. Auto advance had one rule,
  "every *n* seconds"; MilkDrop 2 has three more and all three now follow its
  source. The next change comes after the transition time, the interval and a
  random extra drawn once per preset (milkdropfs.cpp:765-769). A lock stops
  auto advance and hard cuts, and releasing it resumes the time that was left
  (771-778). A hard cut, off by default as in MilkDrop, changes preset with no
  blend when bass, mid and treble — each against its long average — together
  pass three times a threshold, which doubles on each cut and then falls back
  (882-906). MilkDrop calls the fall-back a 60 s half-life, but its coefficient
  is 2·ln 2: the excess halves in 30 s. The formula is kept as written. The
  hard cut reads the bands before the sensitivity setting, as MilkDrop reads
  `imm_rel`, so the sensitivity slider does not move the threshold.
  `progress` was a ten-second sawtooth; it is now the share of the preset's
  scheduled life that has passed (476), frozen by the lock and 0 when nothing
  is scheduled. 23 corpus presets read it and 10 of those fade out on
  `above(progress, 0.99)`, which the sawtooth triggered every ten seconds.
  24 tests, including the same demo audio cutting on the same frames twice.
  MilkDrop 3's hard-cut modes follow once the compatibility mode exists (#567).
- **Ratings, rating-weighted random order and a back/forward history (#569)** ·
  done. MilkDrop reads each preset's rating from its own file — `fRating`, 3
  when missing, clamped to 0..5 (plugin.cpp:5795-5796) — and with ratings on,
  its default (509), draws random order from their cumulative distribution,
  falling back to uniform when they sum under 0.1 (5160-5199). Random order
  now does the same, still excluding the preset on screen; a rating of 0
  never comes up. The panel shows the on-screen preset's rating as stars; a
  rating you give is kept in the settings, not the preset, because every
  preset save re-broadcasts the whole library with its sources. ◀/▶ walk a
  64-step history (plugin.h:57) of what was shown — auto advance and hard
  cuts included, recorded from the visualizer's meter message — and the list
  step itself now starts from the preset on screen. Deliberate difference:
  after going back, a new preset drops the forward part; MilkDrop's auto
  advance would replay it, but here the history is in the panel and the pick
  in the visualizer. The file rating is read without a cache: 0.16 ms for a
  695-preset library, and a cache keyed on id and length would miss an
  `fRating` edit that keeps the length. 19 tests; the panel was also driven
  end to end in an isolated copy — ◀/▶, the stars, the lock, and auto-advance
  picks entering the history with the visualizer open.
- **Stars show only the ratings you gave (#587)** · done. Found in use: the
  stars showed a preset's own `fRating`, so a preset nobody had rated came up
  with five stars — 95% of the corpus writes 5 — and moving on from a preset
  you had just rated looked broken. A preset you have not rated now shows
  empty, dimmed stars. Random order is deliberately unchanged: an unrated
  preset is still weighted by its file's rating, MilkDrop's rule, and rating
  up or down steps from that effective rating so "up" never makes a preset
  rarer. 6 tests pin both halves.
- **Textures on every output (#586)** · done. Found in use: user textures
  seemed to load in the main visualizer window only. Measured in an isolated
  copy with a preset that draws a solid probe texture full screen: before the
  fix the panel's live preview, the web overlay and video export drew noise,
  while the visualizer windows on all three displays and the Spout window
  drew the texture — secondary windows were not affected. The preview's
  bridge could list the folder but not fetch an image, the overlay had no way
  to reach the folder, and the exporter had no bridge at all. The stream
  server now serves the list and single images by name, behind its token and
  through the same path check as the application, and pages are sent a short
  digest of the folder instead of its path. Export waits for textures in
  flight before drawing the next frame, so two exports of the same job still
  match frame for frame (measured), and it stops with an error rather than
  write a different video if a texture takes more than 20 s. A texture
  requested before the folder listing arrives is now fetched as soon as it
  does: export went from two frames of noise at the start to one. Images
  still load asynchronously, so that first frame stays, and a preset whose
  texture is not cached yet shows noise until it arrives — one frame in
  export, a few on the live outputs. 15 tests,
  the endpoints among them over real HTTP and WebSocket, path traversal
  included.
- **Flash limiting holds on every screen (#588)** · done. Found in use: the
  limiter seemed to work in the panel preview only. Measured in an isolated
  copy with a preset that flips between black and white three times a
  second, one window at a time: the limiter ran on every surface — no frame
  moved more than 0.102 — but its limit was per frame, 0.10 of mean relative
  luminance, so what it let through per second grew with the frame rate. The
  swing per cycle was 0.714 in the 45 fps preview, 0.918 on the web overlay,
  0.980 on a 60 Hz display and 1.000 on a 74 Hz one, where the flash passed
  as if the limiter were off. The threshold now scales with the frame's
  duration from the step it was measured at — the corpus tool draws at
  1/30 s — so 3.0 per second: 0.10 per frame at 30 fps, 0.04 at 74 Hz, and
  never above 0.10 on a slower screen. After the change the swing is
  0.43–0.49 on all five surfaces and the largest change within 100 ms
  0.28–0.32, against 0.30 expected. The limiter is still a limit on the rate
  of change, not a count of flashes: a strobe faster than three a second
  still gets through, at reduced amplitude. 3 tests read the threshold
  `_flashPass` actually loads, through a fake GL.
- **Every screen shows the same preset (#585)** · done. Found in use: with
  random order every screen showed something different. Each visualizer
  window, the Spout/Syphon window and the web overlay ran its own auto
  advance, and even on the same preset two things were drawn per window:
  the four `rand_preset` numbers and the transition's pattern. One engine
  now picks — the window whose meter message main already forwards (the
  first visualizer window, else the Spout/Syphon window), or the panel
  preview when neither exists — and main passes its pick on, at once when it
  changes and every 250 ms otherwise, to the other windows, Spout/Syphon and
  the web overlay. The pick carries a seed; `rand_preset` and the transition
  pattern come from it, and a manual pick seeds from the pick itself. A
  follower that hears nothing for 1.5 s runs its own cycle from where it
  was, so when the leader closes, the next window carries on from the same
  preset — measured by closing the leading window mid-run: for the next
  second the other five surfaces kept the same preset and seed, and they
  stayed together in 50 of 50 samples after it, through four changes under
  the new leader. Measured in an isolated copy — three windows, Spout, the web
  overlay and the preview, random order every 2 s: before, the six showed
  5.7 different pictures per sample and never one; after, all six agreed
  on the preset in 58 of 60 samples (the other two at a switch) and presets
  drawing `rand_preset` as a flat colour matched to the pixel. The new
  MilkDrop › Displays option, off by default, lets each display pick its own
  again — 5.3 pictures per sample with it on. It lives in `milkdropControl`,
  outside scenes. Per-frame randomness (`rand_frame`, `rot_rand`) still
  differs between screens. 12 tests, two engines side by side among them.
- **The lights can take MilkDrop's colors (#589)** · done. Asked for in
  use: the lights followed the background or the theme, and the sampled
  palette came from background layers only. A new color source, `milkdrop`,
  fills that palette from MilkDrop's current frame instead — shrunk to 64×16
  and cut into eight slices from left to right, each slice's color averaged
  with weights of brightness squared so a small bright detail on a dark
  background still counts, its hue kept and its brightest channel brought
  to full, since the lighting mode sets the brightness. Because it fills the
  same palette, the modes tied to the background follow MilkDrop too, and
  with no MilkDrop in the stack it falls back to the background. It is
  read for any light output that is on — Dynamic Lighting, OpenRGB or
  Art-Net — and the MilkDrop panel has a shortcut that keeps the previous
  source and restores it. OpenRGB now takes the sampled palette the way
  Dynamic Lighting does, through one shared helper; it used to draw the
  configured gradient. Measured in an isolated copy over Art-Net sent to
  localhost, with a picture red on the left and blue on the right: the
  first four of eight fixtures red and the last four blue; before, all
  eight showed the fallback color and the panel received no palette. The
  window ran at 75.2 Hz with the sampling and 75.0 Hz without. 12 tests,
  the sampler through a fake canvas and Art-Net's channels through its own
  code.
- **An effect on one layer no longer blacks out the layers below (#590)** ·
  done. Found in use: an effect given to a single layer hid everything under
  it, while the same effect on the global chain did not. The layer's chain
  ran in the effect chain's opaque mode whenever the scene was not
  transparent, and that mode writes alpha 1 on every pixel, so the layer's
  empty areas became a black cover. A layer's chain now always runs in the
  see-through mode, which takes coverage from the layer's own alpha and
  counts a spreading effect's glow into empty space; the global chain still
  asks whether the scene is transparent, since it draws the final picture.
  Measured in an isolated copy with a red background under a bar layer
  carrying a bloom: the top corner was red without the effect and with it on
  the global chain, black with it on the layer — the bar layer's canvas
  opaque there, alpha 255. After the change it is red in all three and the
  canvas is transparent there. Export composes through the same path and
  had the same fault: the corner of the 30th frame was black before and is
  red now, and two exports of the job still match frame for frame. 4 tests.
- **Every other GPU surface recovers from a lost context too (#594)** ·
  done. A real GPU reset takes every context at once; with only MilkDrop
  recovering (#572), the gradient background, the 3D geometry mode, the
  shader modes, the effect chains and projection mapping still stayed black.
  None of them carries feedback or built-up state, so each now answers
  `contextLost()` and its owner builds a fresh instance with the same
  settings: the layer stack rebuilds a layer in place — same DOM position,
  same inline style, so z-order, blend and opacity carry over, same entry
  object for transitions and proxies — the global and per-layer effect
  chains keep their effects, and the visualizer replaces the mapper. A lost
  context never comes back on its own for these surfaces, so each is rebuilt
  at most every two seconds rather than every frame while the GPU restarts.
  MilkDrop is deliberately not asked: rebuilding the layer would throw away
  its preset and equation state, which #572 keeps. Measured in the GPU
  self-test on the running stage: the gradient background's and the effect
  chain's contexts are lost, both are rebuilt (0 → 2) and both come back
  with a picture — brightest sample 175 and 206 of 255, as before the loss;
  the sample is taken right after the next frame, since these surfaces do
  not preserve their drawing buffer. 6 tests.
- **A preset change no longer stalls the frame (#573)** · done. Measured
  first, as the issue asked, with `scripts/milkdrop-switch-cost.js`: 900
  presets at 1280×720, every mesh and mode in its own process, the switch
  frame compared with its neighbours. The switch frame ran a median 17 ms and
  at worst ~119 ms over them at every mesh density, and about six changes in
  ten dropped a frame that would otherwise have held; the GL compile and link
  were 14–15 ms of it, because the engine asked for the result at once.
  Where `KHR_parallel_shader_compile` exists the compile now runs in the
  background: the running preset keeps drawing and the change — transition
  included — starts when both new programs are ready, a median 2–3 frames
  later; a selection changed or taken back meanwhile drops the half-built
  job. With auto advance the cycle picks the next preset a second early
  (`upcoming`) and the engine compiles it in advance, so the change still
  lands on time, on the bar in bar mode; followers get the leader's `next`
  and prepare the same one, and a hard cut takes the prepared preset. Early
  picking uses the same draw from the same generator, so the order and the
  random distribution are unchanged — a seeded test checks both sequences
  are identical. Export, the render-rate harness and the first load keep the
  waiting path, so the frame a preset appears on never depends on compile
  speed. Across the 900: changes that drop a frame fell from 58.7% to 6.5%
  (mesh 32), 61.9% to 4.9% (64) and 60.6% to 19.0% (128) with a hard cut,
  and from 61.7% to 8.1% at mesh 64 with a transition; the worst frame's
  median went 21.7 → 7.6 ms at mesh 64. Not done: a program cache of our
  own keyed by source — Chromium already keeps one in the process (a second
  load of the same preset compiled in 5.8 ms instead of 18.3 ms), and with
  the compile off the frame a cache would only shorten the 2–3 frame wait.
  19 tests.
- **MilkDrop recovers from a lost WebGL context (#572)** · done. A driver
  reset or a GPU process crash takes every WebGL object with it, and nothing
  in `src` listened for `webglcontextlost`: the layer stayed black until the
  application was restarted. The engine now holds the loss on the canvas
  that owns the context, asks for it back (`preventDefault`, without which
  the browser never restores it) and rebuilds its programs, buffers,
  textures and the running preset's shaders when it arrives; if it does not
  arrive within three seconds it starts again on a fresh canvas, and an
  abandoned canvas whose context is restored later is released at once so it
  does not hold a slot. The preset object, its equation pool and its clock
  are kept, so the preset carries on rather than restarting; the feedback
  buffer's content cannot come back, so the picture flows again from black,
  and a half-finished transition counts as finished. Chromium's per-domain
  3D block after a GPU crash is disabled in the main process, since a
  blocked page cannot get a new context at all. Measured in the GPU
  self-test on the running engine, both ways: with a restore, frames go 12 →
  101 and the brightest sample stays 246 of 255; without one, 99 → 242 at
  244, and both keep the same preset object and clock (0.25 s → 1.42 s). 13
  unit tests drive the engine with a fake GL: the event is refused, the
  listener sits on the offscreen canvas, our own `dispose` loss is ignored,
  every GL name the engine creates is forgotten, and the inventory is read
  from the source so a new buffer cannot be left behind.
- **Preset changes on the bar, from the tempo engine (#571)** · done. Auto
  advance can count bars (`autoNextUnit`, `autoNextBars`) instead of
  seconds: every n bars the preset changes on the first beat of a bar, and
  the transition is rounded to whole beats so it ends on one (1.7 s at 120
  BPM → 1.5 s). The tempo is estimated in the visualizer from its own audio,
  since the panel's loop stops while the visualizer covers it; `tempo.js` now
  loads in the visualizer, exporter and overlay pages, and the clock is the
  engine's step, so an export counts bars in video time. The BPM lock and
  beats per bar are Auto VJ's (`autovj.bpmLock`, `beatsPerBar`) — the one
  tempo lock, which tap tempo writes. With no tempo, the change falls back to
  Auto VJ's rule, 2n seconds and at least 4, and reports NOTEMPO; the panel's
  bar readout comes from the visualizer, not a second estimate. Measured in
  the engine with a 120 BPM signal: changes every 4.00 s for 2 bars, each
  blending 1.495 s (44 frames at 30 fps). 14 tests, including the real tempo
  estimator giving the same switch frames twice.
- **MilkDrop on MIDI and OSC (#570)** · done. Seven actions — next, previous,
  random, cut now, lock, rating up and down — run the panel's own functions,
  so a controller walks the same history and uses the same rating weights
  and lock. Cut now is MilkDrop's H key, the next preset with no blend: the
  panel writes the new preset's id to `milkdropControl.cutTo`, the engine
  loads that one switch unblended, and the next manual pick clears it.
  Measured in the engine: the same switch took 0 blend frames with it and
  50 (1.7 s at 30 fps) without. Six settings: transition time, auto-advance
  interval, random spread and hard-cut threshold map over the panel's
  slider ranges; mesh density and internal resolution take only the panel's
  own values, a knob's travel split into equal steps, since every value in
  between would rebuild the mesh or the frame buffers. 12 tests; the
  actions were also driven end to end in an isolated copy through the
  controller's own entry point.
- **Ratings and the lock stay out of scenes** · done. #569 kept the ratings,
  and #568 the lock, inside the `milkdrop` block, which a scene saves and
  restores whole and a template resets. Going back to an older scene, Auto
  VJ pulling one or trying a template would have wiped every rating given,
  and a scene would have carried the lock with it. Both now live in blocks
  of their own that no scene or template list includes (`milkdropLibrary`,
  `milkdropControl`). 4 tests, including a template applied over ratings and
  a lock that come through untouched. Found before either reached `main`.
- **The MilkDrop panel shows its presets on first open** · done. The list was
  requested once at start-up with no callback; a panel drawn while that
  request was in flight made no request of its own, so the list, ◀/▶ and the
  lock stayed missing until some other setting redrew the panel. Reproduced
  in an isolated copy by opening the Scene tab straight after start-up. A
  test drives the race on a fresh module and fails without the fix.
- **A new track can bring the next preset (#582)** · done. Now Playing
  already knew when the track changed. Next to auto advance, *On Track
  Change* now moves to the next preset when a new track starts.
  - **Rules.** The pick goes through the cycle's own rule: the chosen order,
    the rating weight in random order, and a pick the timer had already made
    (#573). It is independent of the timer, so it works with the timer off.
    The lock stops it too. The preset's scheduled life restarts, as if the
    timer had fired, and the change blends with the configured time.
  - **What counts as a new track.** A track is its title, artist and album.
    The track already playing when the app opens does not count, and neither
    does the gap between two tracks: the same track after a gap is no change.
  - **Only the leading screen picks**, and the others follow it as for any
    other pick (#585). Every engine updates the track it has seen even while
    following, so an engine that becomes leader later does not fire a change
    that happened before.
  - **Measured** in an isolated copy with one window leading and the panel
    preview following. The first track left the preset alone. The next two
    each moved to the next preset in order, and the window and the preview
    showed the same one every time. With the lock on, a fourth track changed
    nothing.
  - **Tests.** 7 tests run the engine's own `_autoCycle` in a fake
    environment, as leader and as follower. 7 of 7 mutations are caught,
    among them asking about the track only on the leader's path.
- **MilkDrop follows the system's reduce-motion setting (#581)** · done. When
  the operating system asks for reduced motion (`prefers-reduced-motion:
  reduce`; on Windows, *Animation effects* off), the flash limiter stays on,
  hard cuts are off and blends are long. The panel says why, and *Reduce
  Motion* overrides it either way.
  - **What changes.** The flash limiter cannot be turned off while motion is
    reduced. Loud moments no longer cut: the cycle sees the hard cut as off
    while the setting itself stays as it was, so the user's hard cut comes
    back when reduced motion ends. Every blend runs the engine's full 5
    seconds, a 0-second setting included. A manual *Cut now* is an explicit
    command and still cuts.
  - **The plan follows the blend.** MilkDrop starts a preset's life with its
    blend, so the timer counts blend plus interval. Planning with the
    configured blend while the engine blended for 5 seconds would have cut
    the time a preset is shown in full short, and with a short interval kept
    the screen blending from one preset straight into the next. The cycle,
    the look-ahead compile (#573) and `progress` all use the same plan.
    Found while writing the tests.
  - **Whose system.** Each screen asks its own: a follower (a web overlay on
    another machine) blends a leader's hard cut when its own system asks for
    reduced motion. Video export and the measurement scripts do not read the
    system at all (`SVMilkdropSync`), only *Always*: the same job must give
    the same video on every machine.
  - **Setting.** `milkdropControl.reduceMotion`: *Follow the system*
    (default), *Always*, *Off (even if the system asks)*. It belongs to the
    show, not the scene, like the lock.
  - **Measured** in an isolated copy with one window leading and the panel
    preview following, the setting emulated in the browser engine (CDP
    `Emulation.setEmulatedMedia`) and the system left alone. Not asked: the
    limiter off as set, the hard cut armed, a 1 s blend. Asked: the limiter
    on with its targets allocated, the hard cut off, a 5 s blend, and *Cut
    now* still a cut. *Off* while asked: 1 s again; *Always* while not asked:
    5 s. A change to the system setting while the app ran was picked up
    without a restart, and the panel named the reason every time.
  - **Tests.** 18 tests run the engine's own `_reducedMotion`, `_autoCycle`
    and `_ensurePreset` in a fake window with a fake `matchMedia`, draw the
    panel with a fake DOM, and follow *Always* from the export job to the
    layer the engine draws. 29 of 29 mutations are caught.
- **Favourites, tags and search by author (#576)** · done. Search matched
  the name only.
  - **Where they live.** Favourites and free-form tags are the user's, not
    the preset's: in the settings next to the ratings (#569), keyed by
    preset id (`milkdropLibrary.favorites`, `milkdropLibrary.tags`), outside
    every scene. The preset files are untouched.
  - **In a pack.** Ids differ on the other side — an import gives every
    preset a new one — so a pack carries each preset's own `library` record
    (favourite, tags, rating), and the import folds it onto the new id. The
    record never reaches the preset file, and only presets that were really
    saved get one. Both the MilkDrop panel (*Pack What Is Shown*, *Import
    Pack*) and the Studio's pack export do this. Built-in presets stay out of
    packs: every install has them.
  - **Author.** MilkDrop files have no author field; names are mostly
    "Author - Title" ("Flexi, martin + geiss - …"). The author comes from
    the name at search time, so nothing on disk needs migrating. `+`, `&`
    and commas separate authors; the first " - " ends them; a part without a
    letter is no author.
  - **Search.** Words match the name (also the translated name of a
    built-in), the authors and the tags, and all must match. `#tag` or
    `tag:`/`etiket:` search tags only, `author:`/`yazar:` authors only.
    Comparison ignores case and the Turkish I/ı, İ/i difference. *Show*
    narrows to favourites or one tag, *Author* to one author; these are
    view settings and send no config.
  - **Pool.** Auto advance — the timer, hard cuts, track changes and the
    look-ahead compile (#573) — can pick from favourites or one tag only
    (`milkdrop.autoFrom`/`autoTag`, saved with the scene). The filter sits
    where the cycle's list is built; an empty or one-preset pool says so
    through the cycle's own reasons (EMPTY, ALONE) and in the panel. A
    follower does not filter: the leader's pick already came from the pool.
    ◀, ▶, Random and the list reach every preset.
  - **Also:** *Favourite* for the preset on screen, as a button and a MIDI/
    OSC action; deleting a preset clears its rating, favourite and tags; a
    search or filter hidden because six or fewer presets remain no longer
    keeps narrowing the list.
  - **Measured** in an isolated copy with eight presets of our own. Stars in
    the list and the on-screen *Favourite* wrote the settings;
    `author:martin` found the three Martin presets and not a title naming
    him; with the pool on three favourites the visualizer window went round
    those three for nine seconds and nothing else. A pack of the eight
    carried two records; imported through the real save path, the favourites
    and tags landed on the new ids and in `settings.json`, and no preset
    file held a `library` field. The file dialog itself was not driven: the
    bridge object cannot be stubbed from the page.
  - **Tests.** 29 tests cover authors, folding, tags, search, the pool, the
    pack round trip, the engine's own `_autoCycle` with a pool (timer, hard
    cut, track change, follower), a pick made in advance that the pool no
    longer holds, and the panel drawn with a fake DOM — its own pack buttons
    included, with only the file dialogs stubbed, and ◀/▶/🎲 still reaching
    presets outside the pool. 49 of 49 mutations are caught.
- **Large preset libraries (#574, part 1 of 2: scale)** · done. Importing a
  ZIP or a library found on the machine means thousands of presets; the
  store could not carry them. Measured in an isolated copy with the corpus
  (10,347 presets, 116 MB): `presets:list` took 3.8 s, one save held the main
  process for about 2.4 s, the panel used 631 MB, and every web client got
  116 MB on every change. The user chose to scale the store before adding
  the importer.
  - **Store.** Files are read once — in the background at start-up — and
    kept; saves and deletes update the cache. `list()` still looks at the
    folder's file names on every call, so a file added or removed by hand
    shows up; a file edited by hand shows up after a restart. Bulk saves are
    written in batches with pauses so the main process keeps serving audio,
    lights and IPC, report progress, and keep the pack's own order.
  - **Change broadcast.** A save or delete sends only what changed
    (`presets-delta`); the whole list is sent only when a page opens. Pages
    apply it in the store's order — newest first, ties broken by id, so
    presets saved in the same millisecond no longer land in a different
    order on each machine.
  - **Web clients** get MilkDrop presets without their sources. The overlay
    engine asks for a source by id (`/milkdrop/preset`, behind the token)
    only when it is about to draw that preset, keeps the current one on
    screen until it arrives, and drops the pick if it cannot be fetched
    rather than falling back to the default preset.
  - **Found on the way:** every preset change rebuilt the visualizer
    window's whole layer stack, so importing or deleting a MilkDrop preset
    restarted the MilkDrop picture on screen. The stack is now rebuilt only
    when a Studio preset changes. The MilkDrop panel no longer keeps a
    second copy of the list.
  - **Measured** after the change, same corpus: `presets:list` 0.3 s, a
    save 29 ms (91 ms with a window open), the panel 273 MB. With 2,000
    presets and a web overlay open in a real browser: the connect message
    was 271 KB instead of about 30 MB; the overlay followed the window's
    auto advance preset for preset and fetched the sources of the seven it
    showed; a delete took 68 ms while the window's MilkDrop kept drawing
    (same preset, 97 frames in 1.2 s), and the window, overlay and panel
    lists all dropped to 1,999.
  - **Not done here:** visualizer windows still hold every source (141 MB
    with 10,347 presets), since they draw from them directly; the importer
    itself is part 2.
  - **Tests.** 20 tests: the store against a temporary folder (one read,
    cache updates, hand-made files, background load with a save and a
    delete in between — the delete made deterministic, since a load that
    had already read the file brought it back — and batched saves in the
    pack's order), the change broadcast on the page, the stream server
    stripping sources and serving them behind the token, the web bridge,
    the visualizer's rebuild rule and the engine waiting for a source (and
    saying so once if a page ever gets a sourceless preset with no way to
    fetch it). 26 of 26 mutations are caught.
- **Large preset libraries (#574, part 2 of 2: the importer)** · done. The
  MilkDrop panel imports a whole library from a ZIP pack, from a folder, or
  from one found on the machine. Two steps: a scan shows what will be added —
  presets, textures, MB, and what will be skipped — and nothing is copied
  until the user confirms. The plan stays in the main process; the page only
  gets its summary and a token.
  - **What is taken.** `.milk` files in nested folders; images in `textures`
    or `sprites` folders; images lying next to the presets only when a
    preset asks for them by `sampler_<name>` (MilkDrop looks in the preset's
    folder too) — a preview picture beside each preset is not a texture, and
    the summary lists those images apart instead of counting them into the
    size. Skipped and reported: `.milk2` (#567), presets over 450 KB,
    textures over 8 MB, encrypted or unsupported ZIP entries; macOS
    `__MACOSX` and AppleDouble leftovers, hidden folders and `node_modules`
    are not looked at. A preset with the same name and the same content is a
    duplicate and skipped; the same name with other content is imported.
  - **ZIP reading** is our own: only the central directory for the scan,
    ZIP64, stored and deflate entries, the CRC checked, each entry inflated
    with a hard output cap, a suspicious compression ratio refused, at most
    200,000 entries, CP437 and UTF-8 names. Only an entry's file name is
    used, so `../../x.milk` cannot write outside (zip-slip).
  - **Textures** are copied into the app's own folder (`milkdrop-textures`
    in the user data), which is looked up after the texture folder the user
    chose: when a name is in both, the user's wins, and a texture already in
    the app's folder with other content is kept and reported. A counter in
    the settings makes every engine — windows, Spout/Syphon, the preview,
    the web overlay — reload its texture list after an import.
  - **Tags.** The first folder below the pack's common prefix becomes a tag
    (#576) unless it is a generic name (presets, milkdrop …); it can be
    turned off.
  - **Search.** Known install folders (Winamp's `Plugins\Milkdrop2`,
    foobar2000's `milkdrop2`, projectM's preset folders) and the user
    folders where portable installs get unpacked, in the order Downloads,
    Desktop, Music, Documents, as the system reports them (OneDrive can move
    them on Windows; the names are localized on Linux). Every subfolder and
    ZIP there is a candidate, and presets lying in one of those folders
    itself are one too. Candidates are searched breadth first — the first
    level of each, then the second — because a depth-first walk spent the
    budget inside the first huge folder and never reached a small pack next
    to it; the first end-to-end run showed exactly that. Finding uses at
    most 60% of an 8-second budget and counting the rest, shared between
    the libraries found. One whose count did not finish is listed with "+"
    (or "not counted") and scanned in full before the confirmation, so the
    confirmation shows the real numbers and nothing is imported from a
    partial scan. If finding ran out of time, the panel says so and points
    to *Import from Folder*.
  - **Measured** in an isolated store with real packs: the Cream of the Crop
    folder was scanned in 1.1 s (9,795 presets, 11 category tags), imported
    in 6.2 s, and imported again in 1.2 s with every preset skipped as a
    duplicate; the original pack's ZIP was scanned in 6 ms and imported in
    287 ms, 14 of its presets already there from Cream. In an isolated copy
    with the panel driven: the search listed a test pack and the libraries
    in the user's own Downloads in 5–7 s; importing the test pack added 79
    presets tagged Dancer (74) and Fractal (5) and copied `worms.jpg` into
    the app's folder, and the visualizer window loaded it with no texture
    folder chosen. A web overlay opened in a real browser before the import
    asked for its texture list again after it and loaded `worms.jpg` from
    the server when a preset needing it was chosen. An 80,000-preset folder
    the search could count only to 10,013 was listed as "10,013+"; *Import*
    scanned it again (10.8 s), the confirmation showed 80,000 presets and 80
    folder tags, and cancelling imported nothing. The English UI was checked
    the same way.
  - **Not done:** `.milk2` (#567); RAR and 7z packs; a ZIP inside a ZIP or
    inside a chosen folder is not opened; the search does not look at other
    drives or anywhere outside the places above — *Import from Folder*
    reaches those.
  - **Tests.** 29 tests: 7 for the ZIP reader (with a hand-written ZIP
    writer, ZIP64 included) and 22 for the importer — real temporary
    folders and archives, zip-slip, duplicates, textures, tags, the search
    order and breadth-first finding (made deterministic with a file budget
    instead of time), a library found but not counted, the rescan, the
    main-process handlers, the engine's texture counter, and the panel
    drawn with a fake DOM, confirmation and rescan included. 57 of 57
    mutations are caught.
- **Preset thumbnails (#575)** · done. The MilkDrop panel's list gets a
  *Layout* choice, *List* or *Grid*. In the grid every preset shows a
  thumbnail, drawn once in a hidden window and kept in the user data
  (`milkdrop-thumbs/`).
  - **Recipe, measured** on a seeded 200-preset sample of the corpus: a
    black start; 60 frames of the demo sound at 1/30 s; drawn at 640x360
    and scaled to a 256x144 WebP (~3.6 KB). A fixed seed image (a builtin
    preset for 45 frames, then a hard cut) lowered the black thumbnails only
    from 20 to 18 — fixing four and breaking two — made each job 45% longer
    and painted its own colours into the thumbnails of presets that draw
    nothing like it. 90 and 150 frames gave 20 and 22 black thumbnails (some
    presets fade out), at a median of 350 and 538 ms against 259 ms. Drawing
    at 640x360 instead of 320x180 barely moved the time (250 against 259 ms
    median): the work is the per-frame code, not the pixels.
  - **The same every time.** Each thumbnail is drawn by a new engine
    instance, whose context `dispose` releases, from black buffers.
    `Math.random` and the preset's seed come from the key. A texture the
    preset asks for is waited for right after the frame that asks, and a
    thumbnail whose texture does not arrive within 8 s is not written;
    neither is one whose frames were not all drawn on a live context (with
    no context the engine draws a placeholder, after a loss it keeps the
    last frame — either would be kept for good under a content key). A
    crashed drawing process is replaced instead of making every later cell
    wait for the 30 s limit. Checked in the real page: seven presets, each
    drawn after two different busy presets, gave the same bytes both times
    — the five busiest of 40 (6.8–13 KB), a textured one and one using
    `sampler_randNN`. Also checked under load (below): one preset drawn 48
    times with a visualizer window drawing MilkDrop and the CPU busy gave
    the same bytes every time.
  - **Key** = a hash of the recipe (the bytes of every file the thumbnail
    page loads, plus the sizes and the frame count) + the preset's source +
    a signature of the textures it asks for (name, size, modification time;
    the whole list for `sampler_randNN`). An engine change (#580, #567)
    therefore retires every thumbnail by itself, an edited preset or a
    changed texture gets a new one, and two presets with the same content
    share one. Once per session, files no current preset produces are
    deleted.
  - **Panel.** The visible cells are asked for; cached thumbnails come back
    at once, the rest as they are drawn, newest request first, one at a
    time. A waiting cell is striped and a failed one has a dashed frame, so
    neither looks like a thumbnail that is really black (about 9% are). The
    layout is the viewer's own choice, kept in browser storage rather than
    in the settings. Images come through an `sv-thumb:` protocol that
    accepts only a key and reads only the thumbnail folder. The hidden
    window closes after 20 s idle and when the panel closes — otherwise it
    would keep the app from quitting.
  - **Found on the way — a picture from another window in a new buffer.**
    The engine allocated its render targets empty and cleared them with
    `gl.clear`. With another MilkDrop context drawing on the same GPU and
    the CPU busy, a freshly allocated feedback buffer could still hold that
    context's picture, and the feedback loop grew it: a preset whose
    thumbnail is black came out as the starburst the visualizer window was
    showing at the time, in 13 of 24 draws with the flash limiter off and 3
    of 16 with it on. Neither condition alone did it (18 of 18 clean with
    the window drawing bars under load, and with the window drawing MilkDrop
    and the CPU idle). The same GPU, context attributes and formats were
    reported every time. Targets are now allocated from zeros — a shared
    zero buffer that is never written (8 MB at 1080p) — and the clear
    stays; the same conditions gave 0 of 48. This is not only about
    thumbnails: any window whose buffers are allocated again (a second
    window opening, a resize, a restored context) and the video export
    could start from another window's picture. Drawing alone is unchanged:
    200 presets gave identical results before and after. The price is paid
    only when buffers are allocated: a full rebuild of the targets at
    1920x1080 (feedback, blur and flash limiter) takes 8.6 ms instead of
    3.3 ms, less than one frame.
  - **Found on the way, smaller:** `sampler_randNN` picked from the texture
    list in the order the file system returned — alphabetical on Windows,
    arbitrary on Linux — so the same preset could get another texture on
    another machine; the list is now sorted the way the measurement script
    sorts it. The importer (#574) did not strip the filter/wrap prefix from
    sampler names, so a preset asking for `sampler_fw_worms` did not bring
    the `worms.jpg` beside it; now it does. The builtin presets module gave
    Node nothing; the main process now reads their sources from it. The
    light colour sampler (#589) read its 64x16 canvas with `getImageData`
    about 30 times a second and Chromium warned about it — the smoke test
    caught the warning once lights were set to take MilkDrop's colours; the
    downscale stays on the GPU and only the 4 KB result is read back from a
    canvas made for reading.
  - **Found on the way — the smoke test could drive real lights.** The smoke
    test and the screenshot tool run on the user's own profile. With
    Dynamic Lighting on in the settings, the app drove the lights at
    start-up in those runs too, and the smoke test itself turns OpenRGB on
    in the panel. As with the camera, which automation never opens, the
    physical outputs are now off in these runs: every Dynamic Lighting
    setting goes through one function that sends it switched off, the
    device scan is skipped, and OpenRGB and Art-Net are never started.
    Diagnostics (`--diag`) still drives the lights, since that is what it
    is for.
  - **Measured** in an isolated copy with 120 corpus presets and the panel
    driven: the first thumbnail after 1.0 s, the 20 visible cells full in
    10–17 s. With a visualizer window drawing MilkDrop at 75 Hz, 20 s idle
    against 20 s while 31 thumbnails were drawn: frame time p99 13.5 against
    13.6 ms, longest frame 17.2 against 26.7 ms, none over 33 ms either way
    — so no pause between jobs was added. Asking for 40 cached thumbnails
    took 2.9 ms (median round trip from the panel) with no texture folder
    and 4.2 ms with the corpus texture pack chosen, so the texture listing
    is not cached. The English UI was checked.
  - **Not done:** thumbnails in the web remote and in the list view;
    drawing every thumbnail ahead of time (only what is looked at is drawn;
    10,000 presets would take over an hour); a thumbnail shows the first two
    seconds, not a preset's later look. Thumbnails always use the engine's
    defaults (MilkDrop fidelity on, mesh 64, smooth lines, flash limiter
    on): with other settings the live picture differs a little.
  - **Tests.** 22 tests: recipe and page files, key and texture signature,
    the queue (cache, one job per key, newest first, failure, staleness,
    cap, clear), cleanup, the protocol, the page driver with a fake engine
    (new instance per job, seeding, texture wait and timeout, no or lost
    context, a frame not drawn), the builtins
    in Node, the main-process pins, and the panel's grid with a fake DOM.
    The smoke test draws a builtin preset's thumbnail through the whole
    chain — the recipe files read from the package, the hidden window, the
    protocol and the panel's CSP — into a temporary folder, not the user's
    data. One engine test drives `_makeTarget` against a fake GL: a zero
    array of the right type and length for both formats, the unpack
    alignment set first, the clear kept, the buffer shared and grown. One
    checks that the light sampler reads only the small canvas made for
    reading, and three check that every path to the lights passes the
    automation flag. 57 of 58 mutations are caught; the survivor removes
    the "no context" check, which the frame counter already makes (without
    a context no frame is drawn).
- **A preset generator of our own, and mash-ups (#579)** · done. The
  generator came first; the mash-ups are described after it.
  - **What it does.** *Studio → MilkDrop Preset Generator* writes an
    original `.milk` from four sliders and a seed. Energy sets how strongly
    zoom, rotation, warp and the size and brightness of shapes and waves
    follow bass, mids and treble; warmth picks the palette (icy blue,
    violet, pink, orange); density adds custom waves, shapes, shape
    instances and per-pixel terms; motion scales every time coefficient.
    Six motion patterns (tunnel, vortex, rings, current, bloom, breath), six
    wave patterns, four shape patterns (a breathing core, orbiting
    instances, a rotating frame, and a textured shape that draws the
    previous frame into itself), four composite and two warp shaders — all
    written for this app, in MilkDrop 2's file format. The version lines are
    written only when there is a shader, so a shaderless preset is a
    MilkDrop 1 file.
  - **Preview, then save.** *Generate* loads the preset through the
    MilkDrop panel's own selection path — the layer stack switches to
    MilkDrop, the history records it, every window shows it — without
    saving it. Rating, favorite and tags stay off for an unsaved preset, ◀
    skips it and *Next* goes on from the top of the list. *Save to Library*
    saves the generator's last result, not whatever is on screen:
    auto-advance may have moved on. The id comes from the code
    (`md_gen1_72-15-60-88-2n9c`), so saving the same preset twice leaves one
    file. The author is *Generator* — *Üretici* in the Turkish interface:
    like the name, it is written in the interface's language when the
    preset is saved — so the author filter lists the generated presets
    together as long as the language stays the same.
  - **A code brings it back.** `energy-warmth-density-motion-seed`. Spaces,
    capitals and leading zeros read as the same code; an axis above 100
    makes the code invalid instead of clamping it to another preset. A
    slider keeps the seed: each part draws from its own random stream and
    the number of draws does not depend on the axes, so warmth changes only
    colours and density adds elements without re-rolling the palette. The
    same code writes the same file on Windows and Linux under Node 20 and
    22: every number written goes through arithmetic and rounding only;
    sin, pow and exp run in the preset, not in the generator. Seven golden
    hashes pin it, and a change to the patterns must bump the version in
    the id so earlier saves are not overwritten.
  - **Safe by construction.** Invert, solarize, brighten and darken stay
    off; no step functions (`above`, `below`, `if`) and no `rand`. Colour
    and alpha expressions are built from the numbers they print, so they
    stay in [0, 1] at any volume — MilkDrop wraps a colour above 1 instead
    of clamping it, and a wrap flickers with the beat. Bass, mids and treble
    are capped at 2.5 inside the preset. A warp shader dims the picture
    itself, independent of the frame rate (`q8 = pow(decay, 30/fps)`).
  - **Measured.** 200 generated presets — every 0/100 corner of the four
    axes twice, and 168 random points — each drawn for 5 s at 320×180 with
    silence, the demo sound and a loud bass line, flash limiter and reduced
    motion off. No shader stage fell back to the fixed pipeline, and all
    200 were clean with all three sounds: never black (at least 4% of the
    screen lit in silence, 9% with sound), never washed out (at most 33%
    near white), at most 2 flashes a second in any sixteenth of the screen
    (in 2 of the 600 runs; 587 had none), and never frozen (at least 4.7%
    of the pixels visibly changing within a second). A frame took 3.0 to
    3.4 ms (median). 40 of them at 960×720: all clean, at most 15% near
    white, at most 2 flashes a second (in 1 of the 120 runs). All of these
    figures come from the committed generator, measured again after the
    last change. Every line and statement longer than
    30 characters in 2,000 generated presets (73,405 fragments) was looked
    up in the 10,332-preset corpus (30,563 distinct long lines): none is
    there. In an isolated copy the card generated a preset and the
    visualizer window drew it, a slider kept the seed, a typed code brought
    its preset back, saving twice left one file, the favorite worked after
    saving, and the English UI had no Turkish left.
  - **Found by the measurement.** A sparse preset with only the main wave
    came out nearly black: the wave is a thin line, and modes 1, 2, 3 and 5
    draw the left channel against the right, which collapses to a point in
    silence. A sparse preset now always gets one custom wave, those modes
    and a dotted main wave need at least two elements, and the centre is
    darkened only when density leaves something elsewhere. A decay of 0.99
    let a thick additive line drawn in the same place every frame fill 61%
    of the screen with white, even in silence: decay stops at 0.98 and the
    main wave's alpha follows it. A ring or a round core that only rotates
    looked frozen in silence: both now change over time. An edge-sharpening
    composite made a fast Lissajous figure flash three times a second in
    one part of the screen: its gains are lower.
  - **Not done:** a MIDI/OSC action and a web-remote button that generate
    or mix.
  - **Mash-ups.** The same card builds a preset out of six parts of the
    presets in the library: the look (decay, gamma, echo, the four flags,
    the main wave, borders, motion vectors, the rating), the motion
    (`per_frame_init`, `per_frame`, `per_pixel` and zoom, rot, cx, cy, dx,
    dy, warp, sx, sy, `fWarpAnimSpeed`, `fWarpScale`, `fZoomExponent`), the
    custom waves, the custom shapes, the warp shader, and the composite
    shader with the blur ranges (`b1n`…`b3x`, `b1ed`) — `GetBlur`'s scale
    comes from them and the composite shader reads the blur most. Every
    key belongs to exactly one part; the list was counted from the corpus
    (86 header keys), and an unknown key goes to the look. A part comes
    whole from one preset and its lines are copied as they are, numbers
    included. The version lines are written anew from the presets that give
    the shaders, since MilkDrop 2 reads a shader only when its version is
    above zero. Written from a description of the behaviour in our own
    words; MilkDrop 2's mash-up code was not opened.
    - *New Mash-up* draws each part from the presets the MilkDrop panel's
      list shows — its search and filter apply — and only from presets that
      have the part. Warp and composite come out "none" 12% of the time:
      in a library of mostly MilkDrop 2 presets every mash-up would
      otherwise get both shaders, and the look's fixed pipeline (echo,
      gamma, flags) would never run. A single part can be drawn again, or
      all six can start from the preset on screen; an unsaved preview (a
      generated preset or a mash-up) is never in the list, so it never
      gives a part. ◀ ▶ step through a history of recipes (part → preset);
      a recipe whose preset was deleted is skipped. The id comes from the
      recipe (`md_mix`, the rule version and two 32-bit hashes; the
      version is 2 since #580), so the same mash-up saved twice leaves one
      file, and the version in it keeps later rule changes from
      overwriting earlier saves.
    - *Part tests* decide which presets can give a part without parsing
      them (13.5 µs a test): a non-comment equation line, an enabled wave
      or shape block, a non-empty shader line (since #580, one whose stage
      version MilkDrop reads as above 0).
  - **Mash-ups measured** on the whole 10,332-preset corpus. The part tests
    agree with the parser for every preset and part. A mash-up whose six
    parts come from one preset is that preset again for all 10,332 —
    equations, waves, shapes, shaders and every parameter; only 5 files
    get different version lines, all malformed or old headers (three with
    `MILKDROP_PRESET_VERSION` but no `PSVERSION`, one declaring a composite
    shader that is empty, one version-200 file). In 5,000 random mash-ups
    (warp and composite "none" one time in ten) every part equals its
    donor's, parameters split by part, and the version lines match the
    shaders. 300 random mash-ups ran in the engine (214 with a warp shader,
    221 with a composite one): no shader stage or equation failed that did
    not fail in its own preset, and there were none of those either. In an
    isolated copy with 40 corpus presets: a search in the MilkDrop panel
    left 20 in the list and six mash-ups drew 14 different presets, all
    from those 20; the visualizer window drew the mash-up; drawing one part
    again changed only that part; ◀ went back; saving twice left one file;
    the English UI had no Turkish left.
  - **Found by the mash-up measurement.** The composite part's blur ranges
    were first taken for a shader, and 308 MilkDrop 1 presets that have
    them got version lines for a composite shader they do not have; only
    `comp_N` lines count now. One corpus file writes the same key twice
    (`shapecode_2_enabled=1`, later `=0`): our parser keeps the last value
    and the part test follows it. Which one MilkDrop 2 keeps was not
    checked here (#580). A check of the English interface found two names
    that did not stay names: the interface splits text at " · " and
    translates the pieces, so a mash-up saved as "Karışım · …" read
    "Blend · …", and one generated word pair, "Dingin Halkalar" ("Still
    Rings"), is a builtin preset's name. Mash-up names now use ": ", the
    ring nouns are "Çemberler" and "Circles", and a test runs every
    generated word pair and a mash-up name through the English
    translation.
  - **Tests.** 37 tests. 24 for the generator: the code and id (round trip,
    one spelling, invalid codes, one file in the real store), determinism
    and golden hashes, 512 presets on an axis grid compiled block by block
    with every function known, shaders translated without hard or
    approximate notes, number formatting, nothing that flashes, colours in
    range at five volumes and five times, decay, gamma and the main wave's
    alpha, the rules the measurement found, the four axes' effects averaged
    over 60 seeds, the independent streams, and the three range helpers
    directly. 13 for the panel with a fake DOM: an unsaved preview leaves
    rating, favorite and tags alone, ◀ skips it, saving writes the last
    result under the same id and the list takes it at once, the code field,
    the sliders, 🎲 and the wiring. 26 of 26 mutations are caught. The
    mash-ups add 19: 10 for the module — every key's part, one-preset round
    trip, mixed presets part by part, lines copied as they are, version
    lines (MilkDrop 1 look with MilkDrop 2 shaders, none, composite only,
    version 3 kept, a shaderless MilkDrop 2 file kept), "none" taking the
    blur ranges with it, the part tests against the parser on edge cases
    from the corpus, id and name, and candidate picking — and 9 for the
    panel with a fake DOM, the search typed into the MilkDrop panel's real
    search box: parts only from the visible list and only from presets
    with the part, the mash-up's text from its donors, one part drawn again
    leaving the others, starting from the preset on screen (and never from
    an unsaved preview), a "none" part drawn again always giving a preset,
    the history skipping a deleted preset, saving the mash-up and not the
    generated preset, and the rows. One more checks the names against the
    English translation, and the card's wiring test now also requires the
    mash-up module before the panel. 23 of 23 mutations are caught; a 24th
    was equivalent, and the branch it changed was removed. Putting back
    the old ring nouns, the " · " in mash-up names or removing the
    module's script tag each fails a test.
- **Fidelity follow-ups (#580)** · the fixed composite, the stage rule and
  MilkDrop's defaults are done; the other audits and the file-reading
  differences are next.
  - **Checked against the source.** Nullsoft's own code
    (jecassis/foo_vis_milk2 5b44cea) and, for the fixed pipeline's blend
    passes, the D3D9 code the D3D11 fork was ported from (BeatDrop
    53d83ee). Both agree on everything below.
  - **Which stage draws.** MilkDrop picks a preset's warp and composite
    shaders by version, not by whether shader text exists. A file with no
    `MILKDROP_PRESET_VERSION`, or one below 200, is a MilkDrop 1 preset and
    any shader text in it is ignored; 200 uses `PSVERSION`, 201 and above
    `PSVERSION_WARP` and `PSVERSION_COMP`, each 2 when missing. A stage with
    a version but no text gets a shader MilkDrop writes at load time with
    the file's decay, gamma, echo, hue and flags baked in, so per-frame
    changes to them are ignored there. With fidelity on the engine follows
    this, and switching fidelity rebuilds the running preset's stages. In
    the corpus it changes one preset: a composite with a version and no
    text, whose per-frame code writes gamma and echo that MilkDrop ignores.
    The corpus has no MilkDrop 1 file carrying shader text.
  - **The fixed composite** — every preset without a composite shader,
    2,128 in the corpus. MilkDrop draws its flags with blend passes of a
    white quad: brighten inverts, squares and inverts again, so it is
    `1−(1−c)²`, and solarize multiplies by the inverse and then adds the
    result to itself, so it is `2c(1−c)`. The engine used `sqrt(c)` and
    `4c(1−c)`, which are what MilkDrop writes into a shader it generates,
    not what it draws for these presets. 410 presets turn brighten on and 83
    solarize. Echo orientation is `(int)x % 4` with C's sign rule, where the
    engine rounded (38 presets write `echo_orient` per frame). Gamma draws
    the picture again additively, so below 1 it is not applied while echo is
    on (2 presets). When two presets whose echoes point different ways
    blend, the echo now fades out before the snap point and back in after
    it, instead of flipping.
  - **MilkDrop's defaults for keys a file does not write**: decay 0.98,
    gamma 2.0, echo zoom 2.0, wave alpha 0.8, motion-vector length 0.9 and
    grid 12×9, border size 0.01, inner border colour 0.25. The per-frame
    reset wrote the pool's 0 back every frame, so a preset without `fDecay`
    left no trail and one without `fGammaAdj` rendered at half brightness,
    and the engine's own "decay missing → 0.98" check never fired because
    the reset made the name exist. Init code sees the defaults too, as in
    MilkDrop.
  - **A centre of 0 is a centre.** `cx` and `cy` of 0 put rotation and
    stretch in the corner; the engine turned an explicit 0 into 0.5 (84
    presets write it in the header). A zoom or stretch of 0 still falls
    back, since it divides by zero in MilkDrop too.
  - **Our own presets write MilkDrop's key.** The five builtin MilkDrop
    presets and the generator wrote the main wave's alpha as `wave_a`, the
    name per-frame code uses. MilkDrop reads `fWaveAlpha` from the file —
    every corpus preset writes that and none writes `wave_a` there — so in
    MilkDrop these presets drew the wave at its default 0.8. They now write
    `fWaveAlpha`. The engine reads both, so nothing changes on screen here:
    the same generator code gives the same picture, and its golden hashes
    were renewed without a new generator version.
  - **Measured.** Rendered through the engine on the GPU: a warp shader
    writes a known flat colour — or a UV gradient for the echo — into the
    buffer, the composite takes the fixed path, and every flag, gamma and
    orientation case read back within 2/255 of MilkDrop's formula, with
    fidelity on and with it off (66 of 66). The 900-preset sample with the
    texture pack sorts into the same classes before and after (882 clean,
    12 blown, 4 frozen, 2 black). The last ten of 60 frames compared between
    `main` and this change: among 120 brighten presets, 99 changed by more
    than 1% (median 3.8%, darks darker: median brightness 0.181 → 0.152);
    among the 83 solarize presets, 63 changed and the median brightness
    roughly halved (0.291 → 0.112), with four more near black; 23 of 49
    presets with a centre of 0 and 7 of 38 that write `echo_orient` changed.
  - **Mash-ups follow the same rule.** A preset whose shader MilkDrop
    ignores cannot give that part, and the version written for a shader is
    the one its preset has for that stage. A recipe from the history can
    therefore give different version lines than before — a warp from a
    preset with `PSVERSION_WARP=0` was written as version 2 and drawn — so
    the mash-up rule version went from 1 to 2: a mash-up saved under the
    old rule keeps its file, and saving the recipe again writes a new one.
  - **Found while finishing this, fixed next.** MilkDrop hands every
    composite shader the full hue colour ("since we don't know if shader
    uses it or not", in both the D3D11 and the D3D9 code); `fShader` scales
    it only on the fixed path and in the shader MilkDrop writes for a
    preset without one. The engine has applied `fShader` to preset shaders
    too since the `hue_shader` change of 16 September, so with fidelity on
    the 914 corpus presets that read `hue_shader` and leave `fShader` at 0
    lost their colour, and 36 got part of it. In the shader written for a
    composite stage with a version and no text, a partial `fShader` now
    lands twice, in the text and in the colour; the one corpus preset with
    such a stage has `fShader` at 0. The engine also takes the
    amount from per-frame values: 16 presets write `fshader` in code,
    which MilkDrop never sees, all of them with a composite shader. Some
    keys fall back to something else when a file leaves them out. MilkDrop
    reads a missing `wave_r`, `wave_g`, `wave_b`, `wave_x` or `wave_y` as
    `rot`'s value at that point, which is 0, where the engine has 1, 1, 1,
    0.5 and 0.5. Missing wave smoothing is 0.75, and the volume fade runs
    from 0.75 to 0.95. Custom shapes default to red inside and green
    outside. No corpus preset leaves any of these out, and neither do ours.
  - **Not done yet:** the fixed warp path, the blur chain, borders and
    centre darkening, and the rest of the blend snap points; the
    file-reading differences found while building the mash-ups (a
    duplicated key, where MilkDrop reads the first occurrence and we keep
    the last; numbered code that MilkDrop stops reading at the first
    missing number; `\\` comments; integer keys holding fractions; text
    after a number; key case; indented lines — about 40 corpus presets in
    all); the reference comparison with an external renderer, which needs
    one installed and waits for the user's approval.
  - **Tests.** 14 new: the version rule and the stage choice, the two
    generated shaders (float rounding, samplers, echo, hue, flag order,
    and that they translate), echo orientation and gamma cases, the
    defaults with fidelity on and off, init seeing them, a header value
    winning over them, the centre of 0, the engine choosing stages by
    version and by text, the echo fade during a blend, the shader's
    formulas behind the switch, and our own presets — the builtins, 64
    generated ones and 30 mash-ups of them — writing only keys MilkDrop
    reads, each once, unindented, with code lines numbered from 1 without
    a gap. Eight older test files were updated: two used presets with
    `PSVERSION` lines but no `MILKDROP_PRESET_VERSION`, which MilkDrop
    reads as MilkDrop 1; the generator's golden hashes and wave-alpha
    check follow the new key; the mash-up tests check the part test
    against the engine's stage choice and expect `md_mix2_` ids. 36 of 36
    mutations are caught, one of them putting the mash-up rule version
    back to 1.

## v3.1.6 — Comprehensive video export

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

## v3.1.7 — Broadcast layout editor

v3.0.0 already ships the broadcast template group: a restrained bar
visualizer, corner or centre placement, a logo beside the bars rather than
behind them, track and artist text, and a still or calm video background.
v3.1.7 turns that from a set of templates into an editor.

- Free placement of the logo, text and bar block, with snapping and safe areas.
- Logo swapping driven by time, beat, bass or a random interval — the same
  video can show the label mark in one section and the release artwork in
  another.
- Text styling presets, automatic track metadata, and per-element reveal
  animations.
- Everything usable live and as an export preset.

## v3.1.8 — NDI output

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
engineering one, so NDI ships as a separate optional package in v3.1.8.

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
