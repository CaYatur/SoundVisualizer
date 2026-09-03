> **v3.1.0 shipped.** The timeline and clip deck engines, both panels, the performance view, MIDI/OSC show actions and accidental-close protection are in, on Electron 43.5.1. What was deliberately left out of v3.1.0 is listed under "Not in v3.1.0" in ROADMAP.md rather than dropped quietly. Next: v3.1.1 — macOS and Linux builds, OpenRGB, and Spout/Syphon output.

> **131 / 227** tasks complete. Every unticked box now carries a milestone: the timeline and clip deck work moved to v3.1.0, and the rest to the backlog. The v3.0.0 milestone is closed with 150 issues.

# CAYADEV Visualizer — 3.0 plan

The full backlog for the 3.0 cycle: 18 epics and 227 tasks, derived from a review of projectM, Butterchurn, Resolume Arena, Synesthesia, Magic Music Visuals, VDMX, TouchDesigner, Notch, Plane9, Vizzy, Specterr and vimathic.

Nothing here connects to any of those projects. The comparison is a reading of what a complete tool in this class does, not a dependency on one.

A box is only ticked when the feature works in the application **and** is covered by `npm test` or `npm start -- --smoke`.

| Milestone | Meaning |
|---|---|
| **3.0** | In the current release cycle |
| **3.1** | Scheduled, but after 3.0 ships |
| **Backlog** | Deliberately not done — the reason is written next to it |

---

## Modulation matrix — any source to any parameter

A routing layer that connects **any modulation source** to **any configuration parameter**.

Today a mode reacts to audio only in the ways its author hard-coded. A modulation matrix turns every existing mode, effect, background, palette and formula parameter into something the user can drive from bass, a chroma bin, an LFO, a MIDI knob or the beat clock.

This is the highest-leverage item in 3.0: it multiplies the value of everything already shipped rather than adding another isolated feature.

- [x] **Modulation engine: source registry and evaluation order**
  <br><sub>Create `src/shared/modulation.js`: a registry of named sources, a per-frame `update(audio, dt, frame)` pass, and a resolver that produces a normalised 0..1 (or -1..1) value per source.</sub>
- [x] **Modulation routes: source to any dotted config path**
  <br><sub>A route is `{ source, target, min, max, curve, amount, mode }` where `target` is a dotted path such as `postfx.0.params.strength` or `geometry.spin`.</sub>
- [x] **LFO source: 8 shapes, rate in Hz or beat divisions**
  <br><sub>Sine, triangle, saw up, saw down, square, random step, smooth random, and a shaped pulse with adjustable width.</sub>
- [x] **Envelope follower source with attack/release**
  <br><sub>Independent attack and release times in milliseconds, applied to any audio band. Frame-rate independent (exponential coefficients derived from `dt`).</sub>
- [x] **Sample-and-hold and random sources**
  <br><sub>A stepped random source clocked by beat, by LFO or by a free-running rate, plus a smooth (interpolated) random walk. Seeded so offline export stays deterministic.</sub>
- [x] **Macro knobs: 8 assignable controls**
  <br><sub>Eight user-named macros, each able to drive several routes at once with individual depth. MIDI-learnable and OSC-addressable, and exposed on the mobile remote.</sub>
- [x] **Curve shaping: exponent, S-curve, quantise, invert**
  <br><sub>Per-route response shaping so the same source can feel different on different targets: linear, exponential, logarithmic, S-curve, stepped (n steps), inverted, and absolute.</sub>
- [x] **Per-route smoothing and slew limiting**
  <br><sub>Independent rise/fall smoothing per route so a jittery source can drive a slow parameter without visible stepping.</sub>
- [ ] **Trigger routes: onset to one-shot actions**
  <br><sub>Routes whose source is a trigger rather than a value: fire a scene change, flash a parameter, advance a palette, launch a clip, or bump a counter. Uses the shared onset detector.</sub>
- [x] **Modulation panel UI**
  <br><sub>A panel listing routes with add/remove/reorder, a source picker grouped by family, a target picker that browses the live config tree, and a live meter next to each route showing its current value.</sub>
- [x] **Right-click any slider to assign modulation**
  <br><sub>The fastest possible assignment path: right-click a control anywhere in the app, pick a source, and a route is created for that path with sensible min/max taken from the slider range.</sub>
- [x] **Modulation is deterministic under offline export**
  <br><sub>All time-dependent sources (LFOs, random, envelopes) must advance from the exporter frame index, never from `performance.now()`.</sub>
- [x] **Modulation depth visualisation on controls**
  <br><sub>A modulated slider shows its base value plus a moving band for the modulated range, so the user can see what a route is doing without opening the matrix.</sub>
- [x] **Unit tests for the modulation engine**
  <br><sub>Source values, curve shapes, route application, clamping, macro fan-out, and determinism. No GPU needed — the whole engine is plain arithmetic.</sub>

---

## Deep audio analysis

Extract far more from the signal than four bands and a level meter.

Everything here becomes a modulation source (E1) and is unit-tested against synthetic signals with known answers, the way `tests/tempo.test.js` already works.

- [x] **Chroma vector: 12 pitch classes from the spectrum**
  <br><sub>Map FFT bins onto the 12 pitch classes with a log-frequency weighting, octave-folded and normalised.</sub>
- [x] **Musical key estimation (Krumhansl-Schmuckler profiles)**
  <br><sub>Correlate a time-averaged chroma vector against the 24 major/minor key profiles and report the best match with a confidence value.</sub>
- [x] **Chord estimation from chroma templates**
  <br><sub>Match the chroma vector against major, minor, diminished, augmented, sus2/sus4 and seventh templates for all 12 roots. Report root, quality and confidence.</sub>
- [x] **Harmonic / percussive separation**
  <br><sub>Median filtering across time gives the harmonic part, median filtering across frequency gives the percussive part. Both become separate band sets, so a visual can react to the drums without the pads or the other way around.</sub>
- [x] **Per-band onset detectors: kick, snare, hat**
  <br><sub>Three onset detectors on tuned frequency ranges using the shared detector from `src/shared/onset.js`, each with its own sensitivity, and each exposed as a trigger source.</sub>
- [x] **Spectral descriptors: centroid, rolloff, flatness, crest**
  <br><sub>Cheap, well-defined features that map beautifully onto visual parameters — centroid to brightness, flatness to noisiness, crest to punch. All unit-tested against synthetic signals (white noise flatness near 1, a pure tone near 0).</sub>
- [x] **Loudness, dynamics and true peak**
  <br><sub>Short-term and momentary loudness with a K-ish weighting, a peak-hold meter, and a crest/dynamics figure. Also drives automatic gain so the visuals do not need re-tuning per track.</sub>
- [x] **Stereo width, correlation and mid/side bands**
  <br><sub>Requires the capture path to keep both channels. Gives a width value, a correlation meter (useful as a mono-compatibility warning) and separate mid/side spectra for side-driven visuals.</sub>
- [x] **Fundamental pitch tracking (autocorrelation / YIN)**
  <br><sub>Track the fundamental of a monophonic source and expose frequency, note name and cents deviation. Useful for vocal-driven and instrument-driven scenes.</sub>
- [ ] **Beat grid, downbeat and bar phase**
  <br><sub>Extend `src/shared/tempo.js` with a continuous beat phase (0..1), a bar phase, and a downbeat estimate, so LFOs and clip launching can lock to musical position rather than to a raw trigger.</sub>
- [x] **Silence detection and auto-gain**
  <br><sub>Detect true silence versus a quiet passage, so scenes can fade gracefully instead of freezing, and normalise level so a quiet track still drives the visuals.</sub>
- [ ] **Transient sharpness and attack time**
  <br><sub>How fast the energy rose into the current onset. Separates a soft mallet from a snare hit and lets one visual respond differently to each.</sub>
- [x] **Rolling spectral history buffer for time-based visuals**
  <br><sub>A shared ring buffer of the last N spectra, so spectrograms, waterfalls and 3D terrain modes stop each keeping their own copy.</sub>
- [x] **Audio analysis panel with live meters**
  <br><sub>One place to see everything the analyser produces: bands, chroma wheel, detected key and chord, tempo, loudness, stereo correlation. Also the fastest way to debug a scene that is not reacting.</sub>
- [x] **Unit tests for every analysis feature**
  <br><sub>Synthetic signals with known answers: a sine at a known pitch, a chord with known chroma, white noise with known flatness, a click train with known onsets. Same pattern as the existing tempo tests.</sub>
- [ ] **Move analysis off the render thread** `3.1`
  <br><sub>The added analysis work should not compete with the render loop. Evaluate an AudioWorklet or a worker with a shared buffer, keeping the deterministic path intact for offline export.</sub>

---

## Visualizer mode expansion (33 to 80+)

Directly requested: more variety, and more creative/interactive modes.

Each mode is its own issue so it can be picked up, drawn and verified independently. Every registered mode is automatically covered by `npm start -- --smoke`, which draws it on the real GPU and asserts the frame is not empty.

**Rules for every new mode**
- Same contract as the existing modes: `new Mode(canvas)` / `draw(audio, cfg, t, dt)` / `dispose()`
- Deterministic: any randomness comes from a seeded generator so offline export stays frame-identical
- Uses the shared palette and the standard visualizer settings
- Turkish label plus an English dictionary entry

- [x] **Mode: Flow field — particles steered by a noise field**
  <br><sub>Thousands of particles advected through a curl-noise field whose scale and rotation follow the spectrum. Bass widens the field, treble adds turbulence. Trails are drawn with a fading buffer rather than cleared each frame.</sub>
- [x] **Mode: Reaction-diffusion (Gray-Scott)**
  <br><sub>A Gray-Scott simulation on the GPU where feed and kill rates are modulated by audio bands. Produces coral, fingerprint and mitosis patterns that breathe with the music. Runs at reduced resolution and is upscaled.</sub>
- [ ] **Mode: Cellular automaton — audio-seeded Life variants**
  <br><sub>A generation-coloured cellular automaton where beats seed new cells and the rule set can be switched (Life, HighLife, Day and Night, Seeds). The population count feeds back into brightness.</sub>
- [x] **Mode: Boids — flocking driven by the spectrum**
  <br><sub>Classic separation/alignment/cohesion flocking. Bass increases cohesion, treble increases separation, and onsets scatter the flock. Drawn as oriented triangles with motion trails.</sub>
- [ ] **Mode: L-system tree that grows with the music**
  <br><sub>An L-system rewriting a string each bar, drawn as a branching structure. Branch angle, length ratio and depth are modulated; onsets trigger new growth. Deterministic for a given seed.</sub>
- [ ] **Mode: Diffusion-limited aggregation**
  <br><sub>Particles random-walk until they touch the growing cluster and stick. Beats release new walkers. Produces lightning-like dendritic structures that accumulate over a track.</sub>
- [x] **Mode: Voronoi cells**
  <br><sub>A Voronoi diagram whose seed points move with the spectrum. Cell fill can follow the palette, the band energy of the nearest bar, or distance to the seed. Includes an outline-only variant.</sub>
- [ ] **Mode: Delaunay mesh**
  <br><sub>A triangulated point cloud where vertices are displaced by band energy. Renders as filled facets with per-face shading or as a wireframe. The dual of the Voronoi mode and shares its point generator.</sub>
- [ ] **Mode: Fluid simulation (stable fluids)**
  <br><sub>A GPU advection/diffusion solver with dye injection on beats and velocity impulses from the bands. The single most "expensive-looking" effect in this class and a direct answer to TouchDesigner demos.</sub>
- [x] **Mode: Mandelbrot / Julia zoom**
  <br><sub>A continuously zooming escape-time fractal with smooth iteration colouring from the palette. Bass drives zoom speed, treble drives the Julia constant. Includes a Burning Ship variant.</sub>
- [x] **Mode: Mandelbulb ray-marcher**
  <br><sub>A ray-marched 3D distance-field fractal with audio-driven power and orbit-trap colouring. The showpiece 3D mode; needs a resolution scale control to stay real-time.</sub>
- [x] **Mode: Menger sponge / Sierpinski ray-marcher**
  <br><sub>Folded distance-field fractals (Menger sponge, Sierpinski tetrahedron, Kaleidoscopic IFS) with audio-driven fold parameters and camera flight.</sub>
- [x] **Mode: Apollonian gasket**
  <br><sub>Recursively packed circles where radius levels map to frequency bands, so bass fills the large circles and treble animates the small ones.</sub>
- [x] **Mode: Truchet tiles**
  <br><sub>A tiling of quarter-arc or diagonal tiles whose orientation flips on onsets, producing continuously rewiring maze patterns. Cheap, hypnotic, and very legible on a projector.</sub>
- [x] **Mode: Moire interference**
  <br><sub>Two or more line/dot grids overlaid with slightly different rotations and scales, animated by the spectrum. Extremely high visual impact per line of code.</sub>
- [x] **Mode: Wave interference field**
  <br><sub>Point sources emitting circular waves whose frequency and amplitude come from the bands, summed into an interference pattern. Physical, calm, and good as a background-style visualizer.</sub>
- [x] **Mode: Rope / string physics**
  <br><sub>A verlet-integrated string (or several) pinned at both ends, kicked by onsets and shaped by band energy. Includes a cloth variant on a grid of constraints.</sub>
- [x] **Mode: Galaxy spiral**
  <br><sub>A differentially rotating particle disc with density waves, a bright core that pulses with bass, and colour by orbital radius.</sub>
- [x] **Mode: DNA double helix**
  <br><sub>Two intertwined strands with connecting rungs, where rung length and colour follow the spectrum and the whole structure rotates and stretches with the music.</sub>
- [ ] **Mode: Audio terrain (scrolling 3D landscape)**
  <br><sub>The rolling spectral history rendered as a lit height field flying towards the camera. Distinct from the existing terrain mode by being true perspective with shading and fog.</sub>
- [x] **Mode: Oscilloscope XY vector art**
  <br><sub>Genuine Lissajous rendering from the left/right waveform with phosphor persistence and beam intensity proportional to dwell time — the look of a real vector display.</sub>
- [x] **Mode: Goniometer / phase scope**
  <br><sub>A rotated XY plot showing stereo image, with correlation displayed as a meter. Both a visual and a genuinely useful production tool.</sub>
- [ ] **Mode: Spectrogram waterfall (3D)**
  <br><sub>A scrolling time-frequency surface in perspective, with a colour ramp from the palette and adjustable time depth.</sub>
- [x] **Mode: Chromagram wheel**
  <br><sub>The 12 pitch classes arranged in a circle (or in circle-of-fifths order) with energy shown as radius and the detected chord highlighted. Depends on the chroma work in E2.</sub>
- [ ] **Mode: Piano roll**
  <br><sub>Detected pitches drawn as falling bars against a keyboard, coloured by octave. Reads from the pitch and chroma analysis.</sub>
- [ ] **Mode: Neon tube grid**
  <br><sub>A grid of glowing tube segments that light up in patterns driven by the spectrum, with a bloom-friendly emissive look and per-segment decay.</sub>
- [x] **Mode: Isometric block city**
  <br><sub>An isometric grid of extruded blocks whose heights follow the bars, with lighting and shadow. Reads as architecture rather than as a bar chart.</sub>
- [x] **Mode: Particle attractor field**
  <br><sub>Particles orbiting a strange attractor from the formula library, with the attractor parameters modulated by audio. Bridges the 2D particle system and the 3D formula engine.</sub>
- [ ] **Mode: Ferrofluid blob**
  <br><sub>A metaball surface with spiky audio-driven displacement along the surface normal, shaded to look like magnetic fluid. Extends the existing metaball mode into something distinct.</sub>
- [ ] **Mode: Typography burst**
  <br><sub>Words or characters emitted on onsets, flying outward with physics, scaled by beat strength. Ties into the text engine in E11 but works standalone with a fixed string.</sub>

---

## 3D geometry and formula library (35 to 120+)

Grow the 3D engine from a formula viewer into a full generative geometry system.

- [x] **Formulas: 12 more parametric surfaces**
  <br><sub>Enneper, catenoid, helicoid, Roman (Steiner) surface, cross-cap, hyperboloid of one sheet, elliptic paraboloid, monkey saddle, egg-carton, sine surface, pseudosphere and Kuen surface.</sub>
- [x] **Formulas: breather, superellipsoid and Gielis 3D supershape variants**
  <br><sub>The breather surface, the superellipsoid family, and a two-parameter Gielis supershape that sweeps a much wider space than the current single supershape entry.</sub>
- [x] **Formulas: 12 more plane curves**
  <br><sub>Epitrochoid, hypocycloid, deltoid, nephroid, limacon, cissoid of Diocles, folium of Descartes, strophoid, conchoid, cochleoid, Fermat spiral and hyperbolic spiral.</sub>
- [x] **Formulas: 8 more spirals and roulettes**
  <br><sub>Archimedean spiral, lituus, involute of a circle, cycloid, trochoid, Maurer rose, epicycloid star and a clothoid (Euler spiral) approximation.</sub>
- [x] **Formulas: 8 more space curves**
  <br><sub>Lissajous knot, torus link, spherical spiral, conical helix, seiffert spiral, granny knot, figure-eight knot and a solenoid curve.</sub>
- [x] **Formulas: 12 more continuous attractors**
  <br><sub>Chen, Chua, Dadras, four-wing, Rabinovich-Fabrikant, Nose-Hoover, Rikitake, Sprott-Linz A, Sprott-Linz B, Lorenz-84, Duffing and Langford.</sub>
- [x] **Formulas: 8 more discrete maps**
  <br><sub>Henon, Ikeda, Tinkerbell, Gumowski-Mira, Bedhead, Svensson, Hopalong and Standard (Chirikov) map. Discrete maps are closed-form per step and cheap to verify exactly.</sub>
- [x] **Geometry: platonic and Archimedean solids**
  <br><sub>Tetrahedron, cube, octahedron, dodecahedron, icosahedron plus a few Archimedean solids, as a new primitive family with the same rendering options as the parametric surfaces.</sub>
- [x] **Geometry: geodesic sphere with subdivision control**
  <br><sub>An icosphere with adjustable subdivision, so the audio deformation has an even vertex distribution — much better looking than a UV sphere at the poles.</sub>
- [x] **Geometry: 3D L-systems**
  <br><sub>Turtle graphics in three dimensions producing trees, ferns and space-filling curves, with rule sets exposed as parameters and growth driven by the beat.</sub>
- [x] **Geometry: 3D iterated function systems**
  <br><sub>Barnsley fern in 3D, Sierpinski tetrahedron, fractal flame style transforms, rendered as a point cloud with density colouring.</sub>
- [x] **Geometry: tube and ribbon extrusion along any curve**
  <br><sub>Turn any space curve into a swept tube or twisted ribbon with adjustable radius, sides and twist. Instantly multiplies the value of every curve in the library.</sub>
- [ ] **Geometry: multiple instances with per-instance offsets**
  <br><sub>Draw N copies of the mesh with position, rotation, scale and colour offsets, each able to take its audio value from a different band — one formula becomes a full composition.</sub>
- [ ] **Geometry: material and shading modes**
  <br><sub>Matte, metallic, glass, toon and emissive shading with adjustable light direction, specular power and rim light, replacing the single flat shading path.</sub>
- [ ] **Geometry: environment reflection from a generated cubemap**
  <br><sub>A cheap procedural environment (gradient sky plus horizon) sampled for reflections, which is what makes metallic materials read as metal.</sub>
- [ ] **Geometry: depth of field and fog**
  <br><sub>Distance-based fog and a cheap depth-of-field blur to give the 3D scenes a sense of scale.</sub>
- [ ] **Geometry: OBJ model import with audio deformation**
  <br><sub>Load a Wavefront OBJ, normalise it into the unit box, compute normals if absent, and run it through the same vertex-shader deformation as the generated meshes. No external parser dependency.</sub>
- [ ] **Geometry: live parameter animation from the modulation matrix**
  <br><sub>Every formula parameter, camera value and material property becomes a modulation target, so a Lorenz attractor can have its rho driven by an LFO and its camera by bass.</sub>

---

## Post-processing chain expansion (15 to 45+)

More GPU effects, better ordering, and effect-level modulation.

Every effect must run identically in the live window and in the offline exporter, and must appear in the `--smoke` effect walk with a measurable difference from the source frame.

- [x] **Effect: Gaussian blur with separable passes**
  <br><sub>A properly separable two-pass Gaussian with an adjustable radius, which the bloom and depth-of-field effects can also reuse.</sub>
- [x] **Effect: Radial and directional motion blur**
  <br><sub>Blur along a direction or radially from a centre point, with audio-bindable angle, length and centre.</sub>
- [x] **Effect: Bokeh depth of field**
  <br><sub>Hexagonal or circular bokeh from a depth or luminance proxy, for the shallow-focus look.</sub>
- [x] **Effect: Tilt-shift**
  <br><sub>A focus band with adjustable position, width and angle, blurring away from it — makes any scene look miniature.</sub>
- [x] **Effect: Sharpen and unsharp mask**
  <br><sub>Edge enhancement with an amount and radius, useful to counteract render-scale downsampling.</sub>
- [x] **Effect: Emboss and relief**
  <br><sub>A directional convolution giving an engraved metal look, with adjustable light angle and depth.</sub>
- [x] **Effect: Ordered dither and halftone**
  <br><sub>Bayer-matrix dithering and CMYK-style halftone dots with adjustable angle and cell size — a strong print aesthetic.</sub>
- [x] **Effect: ASCII / character mosaic**
  <br><sub>Map luminance cells to a character atlas rendered into a texture. Distinctive, and a recognisable "hacker" look for stream overlays.</sub>
- [x] **Effect: Cross-hatch and stipple**
  <br><sub>Line-density shading in several hatch directions, producing a pen-and-ink render of any scene.</sub>
- [x] **Effect: Oil paint / kuwahara filter**
  <br><sub>An anisotropic Kuwahara filter for a painterly look that holds up at projector scale.</sub>
- [x] **Effect: VHS / analogue tape**
  <br><sub>Chroma bleed, head-switching noise at the bottom of the frame, tracking wobble and colour-under artefacts.</sub>
- [x] **Effect: Datamosh / block displacement**
  <br><sub>Macroblock displacement driven by onsets, imitating compression breakdown. Beat-reactive by nature.</sub>
- [x] **Effect: Slit-scan**
  <br><sub>Each output row (or column) reads from a different point in a frame history buffer, smearing time across space.</sub>
- [x] **Effect: Lens distortion family**
  <br><sub>Barrel, pincushion, fisheye and spherize under one effect with a signed strength and adjustable centre.</sub>
- [x] **Effect: Twirl and polar transform**
  <br><sub>Rotate around a centre with radius-dependent angle, plus a rectangular-to-polar and polar-to-rectangular pair.</sub>
- [ ] **Effect: Displacement map from another layer**
  <br><sub>Use a layer's luminance to displace the composite — the most flexible warp effect there is, and the basis for many looks.</sub>
- [x] **Effect: LUT colour grading (.cube import)**
  <br><sub>Load a standard 3D LUT cube file into a texture and apply it. Lets users bring their own film-grade looks without any service.</sub>
- [x] **Effect: Gradient map and duotone**
  <br><sub>Remap luminance through the scene palette or a two-colour ramp. Instant stylistic coherence with the rest of the scene.</sub>
- [x] **Effect: Curves and levels**
  <br><sub>Per-channel curve control with black/white points and gamma, the standard colour-correction toolset.</sub>
- [x] **Effect: Light leaks, film burn and star filter**
  <br><sub>Animated organic overlays plus an anamorphic streak/star filter on highlights, all beat-bindable.</sub>

---

## Layers, masks and scene transitions

The layer stack shipped in 2.1 needs the pieces that make it a compositor rather than a list.

- [x] **Layer groups with a single fader**
  <br><sub>Fold several layers into a group that composites as one surface, with one opacity, one blend mode and one transform. Essential once scenes get past a handful of layers.</sub>
- [x] **Masks: alpha from another layer**
  <br><sub>Use any layer's luminance or alpha as a mask for another. The single most requested compositing feature and the basis for reveals, text knockouts and shaped visuals.</sub>
- [x] **Masks: shapes and gradients**
  <br><sub>Rectangle, ellipse, polygon and linear/radial gradient masks with feathering, position, rotation and invert, applied per layer.</sub>
- [x] **Layer solo, mute and lock**
  <br><sub>Solo isolates one layer, mute silences it without deleting it, lock prevents accidental edits. Basic, and painful to work without.</sub>
- [x] **Scene transitions: crossfade and dissolve**
  <br><sub>Scene changes are currently hard cuts. A timed crossfade between the outgoing and incoming scene, with a curve and a duration in seconds or beats.</sub>
- [x] **Scene transitions: wipes and slides**
  <br><sub>Linear wipe at any angle, radial wipe, clock wipe, barn door, blinds, push and slide, all with adjustable softness.</sub>
- [x] **Scene transitions: luma wipes from a gradient texture**
  <br><sub>Drive the transition threshold from a greyscale image so any pattern becomes a transition shape. Ship a set of generated ramps and allow user images.</sub>
- [x] **Scene transitions: effect-based (glitch, zoom, blur, flash)**
  <br><sub>Transitions that route through the post-processing chain: a glitch tear, a zoom punch, a defocus, a white flash on the beat.</sub>
- [x] **A/B deck crossfader**
  <br><sub>Two scene slots and a fader between them, MIDI-mappable, with selectable blend curve. The standard VJ performance control.</sub>
- [x] **Per-layer effect chain**
  <br><sub>Effects currently apply to the whole composite. Allow a chain on an individual layer so one element can be blurred or graded without touching the rest.</sub>
- [x] **Layer copy, paste and duplicate across scenes**
  <br><sub>Move a configured layer between scenes without rebuilding it. Includes a clipboard that survives a scene switch.</sub>
- [x] **Blend mode expansion and per-layer opacity curve**
  <br><sub>Add the remaining separable and non-separable blend modes for parity with the compositing standard, and give opacity a response curve so a fader feels right.</sub>

---

## Clip decks, timeline and setlist

Trigger scenes like an instrument instead of editing them one at a time.

- [ ] **Clip grid: decks, columns and rows**
  <br><sub>A grid where each cell holds a scene, a Studio preset, a media file or a parameter snapshot. Columns fire together, rows are layers. The Resolume/Ableton interaction model, which is what performers already know.</sub>
- [ ] **Beat-quantised clip launching**
  <br><sub>Launch on the next beat, bar, or 2/4/8 bars rather than instantly, using the tempo engine's beat phase. Makes hand-triggered changes land musically.</sub>
- [ ] **Keyboard and MIDI clip triggering**
  <br><sub>Map the grid onto a computer keyboard layout and onto MIDI notes, with a learn mode. Includes momentary versus latching behaviour.</sub>
- [ ] **Clip thumbnails generated in the background**
  <br><sub>Render a small preview of each clip so the grid is readable at a glance. Generated off the render path and cached to disk.</sub>
- [ ] **Setlist and cue list**
  <br><sub>An ordered list of cues with names and notes, advanced by a single key or footswitch. What you actually use during a show.</sub>
- [ ] **Keyframe timeline** `3.1`
  <br><sub>A time-based editor where any modulation target can be keyframed with easing, for scripted pieces rather than live performance.</sub>
- [ ] **Timeline: audio waveform ruler** `3.1`
  <br><sub>Draw the loaded track's waveform and detected beat grid behind the timeline so keyframes can be placed against the music.</sub>
- [ ] **Clip transport: play, loop, speed and reverse**
  <br><sub>For clips backed by media, expose transport controls including reverse playback and speed, with beat-synced speed options.</sub>
- [ ] **Snapshot clips: capture the current scene state**
  <br><sub>One button that stores the entire current configuration into an empty grid cell, so a good moment during a rehearsal is never lost.</sub>
- [ ] **Follow actions: chain clips automatically** `3.1`
  <br><sub>After N bars, go to the next clip, a random clip, or a specific one. Turns the grid into an arrangement without a timeline.</sub>

---

## Projection mapping and output warping

Send the output onto surfaces that are not flat rectangles — the feature that separates Resolume Arena from Avenue.

- [x] **Corner pin (quad warp) per output window**
  <br><sub>Drag the four corners of an output to fit a surface, implemented as a homography in the shader so straight lines stay straight. Per display, saved with the settings.</sub>
- [x] **Bezier mesh warp**
  <br><sub>A grid of control points with bezier interpolation for curved surfaces (cylinders, arches, domes). Adjustable grid density and per-point nudging with the arrow keys.</sub>
- [x] **Slices: crop a region and place it on an output**
  <br><sub>Take any rectangle of the composition and map it to any quad on any output. This is what lets one composition feed many differently shaped surfaces.</sub>
- [x] **Soft edge blending for multi-projector rigs**
  <br><sub>Per-edge blend width with an adjustable gamma curve, so two projectors overlap into one seamless image. Arena-exclusive in the reference product.</sub>
- [x] **Bezier polygon masks per output**
  <br><sub>Draw arbitrary masks to hide spill outside a mapped surface, with feathering and invert.</sub>
- [x] **Alignment grids and test patterns**
  <br><sub>Grid, crosshair, colour bars, focus chart and a per-output identification number, shown on demand while aligning projectors.</sub>
- [x] **Per-output colour correction**
  <br><sub>Brightness, contrast, gamma and RGB gain per output, so mismatched projectors can be matched.</sub>
- [ ] **Mapping presets: save, load and switch**
  <br><sub>A venue is a mapping. Store the whole output configuration under a name and recall it, independently of the scene.</sub>
- [x] **Mapping editor UI with numeric entry**
  <br><sub>A dedicated editing surface with zoom, snapping, keyboard nudging and exact numeric coordinates, because dragging alone is not precise enough on site.</sub>
- [ ] **Mapping applies to the offline exporter as well**
  <br><sub>Warping must be part of the render pipeline, not a window trick, so an exported video matches what the projector shows. Verified by comparing an exported frame against the live output.</sub>

---

## MilkDrop preset engine

A real interpreter for the MilkDrop preset language, not a parameter importer.

2.1 shipped a feedback engine that produces the same visual family and imports constants from `.milk` files, and said so honestly. This epic replaces that with an actual evaluator.

- [x] **MilkDrop: expression tokeniser**
  <br><sub>Lex the preset expression language: numbers, identifiers, operators, parentheses, commas, assignment and statement separators. Handles the language's quirks (case insensitivity, `//` comments, implicit statement termination).</sub>
- [x] **MilkDrop: expression parser to an AST**
  <br><sub>Precedence-correct parsing of assignment, comparison, additive, multiplicative and unary operators, plus function calls. Reports the line and column of a syntax error.</sub>
- [x] **MilkDrop: built-in function library**
  <br><sub>The full set the language provides: `sin cos tan asin acos atan atan2 abs sqr sqrt pow exp log log10 int floor ceil frac min max sign rand bnot bor band equal above below if sigmoid`.</sub>
- [x] **MilkDrop: compile the AST to JavaScript closures**
  <br><sub>Walking an AST per pixel is far too slow. Compile each equation block once into a closure over a flat variable array, so the per-pixel loop is plain arithmetic.</sub>
- [x] **MilkDrop: variable pool (q1-q32, t1-t8, regNN)**
  <br><sub>The variable chain that carries values from init to per-frame to per-vertex to the shaders. Registers persist across frames; q variables are copied at the right points in the chain.</sub>
- [x] **MilkDrop: per-frame equation execution**
  <br><sub>Run the preset's `per_frame` block once per frame with the documented inputs (`time`, `fps`, `bass`, `mid`, `treb`, their attenuated variants, `frame`, `progress`) and apply the resulting motion parameters.</sub>
- [x] **MilkDrop: per-pixel equations on the warp mesh**
  <br><sub>Evaluate the `per_pixel` block over the warp mesh grid, producing per-vertex offsets for zoom, rotation, warp, dx/dy, sx/sy. This is where the characteristic motion comes from.</sub>
- [x] **MilkDrop: warp mesh renderer with feedback**
  <br><sub>Render the previous frame through the displaced mesh with the preset's decay, echo and gamma settings. The visual heart of the format.</sub>
- [ ] **MilkDrop: waveforms and the built-in wave modes**
  <br><sub>The numbered wave modes drawn from the audio buffer, with the documented thickness, additive and dot options.</sub>
- [ ] **MilkDrop: custom waves and custom shapes**
  <br><sub>Up to four custom waves and four custom shapes, each with their own init, per-frame and per-point equations.</sub>
- [x] **MilkDrop: .milk file parser**
  <br><sub>Parse the INI-style preset file into parameters plus the equation blocks, tolerating the format's inconsistencies (line-numbered equation keys, wrapped lines, mixed case).</sub>
- [ ] **MilkDrop: best-effort warp and composite shader translation** `3.1`
  <br><sub>MilkDrop 2 presets carry HLSL warp and composite shaders. Translate the common subset to GLSL ES 3.00 and fall back to the equation-only path when translation fails, telling the user which happened.</sub>
- [x] **MilkDrop: preset pack import and browsing**
  <br><sub>Import a folder of presets, list them with names and a generated thumbnail, and allow shuffling through them with the existing auto-VJ machinery.</sub>

---

## Studio shader editor — multi-pass and a real library

Take the shader editor from single-pass GLSL to the full ISF feature set.

- [ ] **Studio: multi-pass rendering (ISF PASSES)**
  <br><sub>Support several render passes at independent sizes with named targets, as the ISF specification defines. Unlocks blur chains, simulations and most of the interesting shader work.</sub>
- [ ] **Studio: persistent buffers between frames**
  <br><sub>Passes marked persistent keep their contents across frames, which is what feedback, trails and simulations need. Ping-pong handling must be automatic.</sub>
- [ ] **Studio: vertex shader editing**
  <br><sub>Expose the vertex stage so geometry can be displaced, not just pixels. Includes a default pass-through the user can start from.</sub>
- [x] **Studio: built-in shader library expanded to 40+**
  <br><sub>The editor ships with six examples. Write a proper library covering the common families: plasma, tunnels, raymarched primitives, kaleidoscopes, fluid-like flows, voronoi, noise fields, feedback, truchet, moire, warped grids, particles in a fragment shader.</sub>
- [ ] **Studio: full ISF input type coverage**
  <br><sub>float, bool, long (enumerated), point2D, color, image and audio/audioFFT inputs, each generating the right control automatically.</sub>
- [ ] **Studio: Shadertoy multi-buffer import**
  <br><sub>Shadertoy shaders with Buffer A-D map naturally onto multi-pass. Import them into the corresponding passes with the channel bindings preserved.</sub>
- [ ] **Studio: uniform auto-detection and slider generation**
  <br><sub>Parse the shader for custom uniforms and generate labelled controls with sensible ranges, so a user can expose a parameter by declaring it.</sub>
- [ ] **Studio: snippet and include library**
  <br><sub>A set of reusable GLSL functions (noise, hashes, rotations, SDF primitives, colour spaces, easing) insertable from the editor, so people are not retyping simplex noise.</sub>
- [ ] **Studio: shader hot-reload from a watched file** `3.1`
  <br><sub>Point the editor at a file on disk and recompile whenever it changes, so users can work in their own editor.</sub>

---

## Text, typography and lyrics

Named as a gap against Vizzy and Specterr: animated text objects and synchronised lyrics.

- [x] **Text layer with font, weight and layout controls**
  <br><sub>A first-class text layer: content, font family, weight, size, letter and line spacing, alignment, colour or palette, outline and shadow.</sub>
- [ ] **Custom font loading**
  <br><sub>Load a TTF/OTF/WOFF from disk into the renderer and into the offline exporter, so the exported video matches the live output.</sub>
- [x] **Text animation presets**
  <br><sub>Typewriter, fade in, slide, scale bounce, wave, jitter, per-character stagger, all with beat-synced timing options.</sub>
- [x] **Audio-reactive typography**
  <br><sub>Per-character scale, weight, offset and colour driven by the spectrum, so the word itself is the visualizer.</sub>
- [x] **Lyrics: LRC and SRT import**
  <br><sub>Parse both formats including enhanced LRC word timings, and show the current line with the elapsed part highlighted.</sub>
- [x] **Lyrics: timing editor and nudge**
  <br><sub>Tap along to set line timings, nudge the whole file by an offset, and save the corrected file back out.</sub>
- [ ] **Text on a path, marquee and ticker**
  <br><sub>Lay text along any curve from the formula library, plus a scrolling ticker mode for stream overlays.</sub>
- [x] **Now-playing metadata from the audio file**
  <br><sub>Read title, artist and album art from a loaded file and expose them as text and image sources for overlays.</sub>

---

## Media and input sources

More ways to get pixels and sound into the composition.

- [ ] **Video layer with loop, speed, scrub and reverse**
  <br><sub>A proper video source rather than a background image: transport controls, in/out points, playback rate, reverse and beat-synced looping.</sub>
- [ ] **Image sequence source**
  <br><sub>Load a numbered folder of frames as a clip, with frame rate control — the reliable way to use alpha-channel content.</sub>
- [ ] **Camera effects: chroma key**
  <br><sub>Key out a background colour with tolerance, softness, spill suppression and edge feather, so a webcam can be composited into the scene.</sub>
- [ ] **Camera effects: mirror, delay and trails**
  <br><sub>Kaleidoscopic mirroring, a frame-delay buffer and motion trails applied to any camera source.</sub>
- [ ] **Screen and window capture as a source**
  <br><sub>Use Electron's desktop capturer to bring a display or a single window into the composition, with a picker and a refresh rate control.</sub>
- [ ] **Audio file player with waveform scrubbing**
  <br><sub>Play a file through the analyser with a visible waveform, seek by clicking, and loop a region — needed to design a scene against a specific track.</sub>
- [ ] **Motion detection from camera as a modulation source**
  <br><sub>Frame differencing giving overall motion, motion centroid and a coarse motion grid, all exposed to the modulation matrix. Interactive installations in one feature.</sub>
- [ ] **Media pool: manage loaded files in one place**
  <br><sub>A list of all media used by the current setup with thumbnails, missing-file reporting and relink.</sub>

---

## Output, recording and streaming

Everything that leaves the application.

- [x] **One-key recording of the live output**
  <br><sub>Start and stop a recording of exactly what is on screen with a shortcut, writing WebM or MP4 without going through the offline exporter.</sub>
- [x] **Animated GIF and short-loop export**
  <br><sub>A length-limited, palette-optimised GIF or looping MP4 for sharing a moment. Requested in the 2.1 roadmap.</sub>
- [x] **PNG snapshot with a shortcut**
  <br><sub>Capture the current frame at full or multiplied resolution to a file, with an optional transparent background.</sub>
- [x] **Export presets for common aspect ratios**
  <br><sub>16:9, 9:16, 1:1, 4:5 and 21:9 with matching resolutions, plus a safe-area overlay while composing.</sub>
- [ ] **Per-output resolution and frame rate**
  <br><sub>Each visualizer window renders at its own resolution and frame rate, so a 4K projector and a 1080p confidence monitor can coexist.</sub>
- [ ] **Stream server: per-client scene selection**
  <br><sub>A browser source can request a specific scene or layer subset by URL, so one instance can feed several distinct overlays.</sub>
- [ ] **Stream server: adjustable quality and frame rate**
  <br><sub>Limit the overlay frame rate and resolution independently of the local windows, for machines where OBS and the visualizer share a GPU.</sub>
- [ ] **Hardware encoder selection for export**
  <br><sub>Detect NVENC, AMF and QSV availability and let the user choose, falling back to software with a clear message.</sub>
- [ ] **Audio-reactive offline render from a file, start to finish**
  <br><sub>Point at an audio file, pick a scene, and render the whole track deterministically, including modulation, transitions and effects.</sub>

---

## Control surfaces and integration

Play the application from hardware and from other software.

- [ ] **MIDI clock input and output**
  <br><sub>Follow an external MIDI clock for tempo instead of estimating it, and send clock so other gear can follow the visualizer.</sub>
- [ ] **MIDI feedback to controller LEDs**
  <br><sub>Send note and CC values back so a grid controller lights up to match clip states and toggles. What makes hardware feel connected.</sub>
- [ ] **MIDI note triggering for actions**
  <br><sub>Notes trigger clips, scene changes, blackout, freeze and macro snapshots, with velocity available as a value.</sub>
- [ ] **OSC output**
  <br><sub>Send analysis values, tempo, and state changes out over OSC so the visualizer can drive other software.</sub>
- [ ] **Art-Net input**
  <br><sub>Receive DMX so a lighting console can drive the visuals, with a channel-to-parameter mapping table.</sub>
- [ ] **DMX fixture profiles**
  <br><sub>Named fixture definitions with channel layouts (RGB, RGBW, RGBA, dimmer, strobe) instead of raw channel arithmetic.</sub>
- [ ] **Editable keyboard shortcuts**
  <br><sub>A table of every action with rebindable keys, conflict detection and a printable reference.</sub>
- [ ] **Gamepad support**
  <br><sub>Map sticks to continuous parameters and buttons to actions through the Gamepad API — a cheap and surprisingly good control surface.</sub>
- [ ] **Documented local WebSocket API**
  <br><sub>A stable command and telemetry protocol on the existing server so scripts and other applications can drive the visualizer. Local only, with the same allowlist as the remote.</sub>
- [ ] **Mobile remote: full parameter control and layout editing**
  <br><sub>Grow the remote from a scene switcher into a real control surface: macro knobs, clip grid, blackout, tempo tap, and a user-arrangeable layout.</sub>
- [ ] **NDI output** `3.1.5`
  <br><sub>Technically the easiest of the three senders — NDI takes a CPU buffer, so no shared texture is needed. Deferred purely for licensing: the application EULA must cover the NDI SDK terms, `ndi.video` links are required in the app, on the site and in the docs, and an EULA-bound binary inside an MIT project ships as a separate optional package.</sub>
- [ ] **Spout / Syphon output** `3.1.1`
  <br><sub>Moved out of the backlog. Electron’s `webPreferences.offscreen.useSharedTexture` exposes the GPU texture on the `paint` event, and `@napolab/texture-bridge` (MIT, N-API prebuilds) covers Spout and Syphon in one dependency. Spout is BSD 2-Clause and Syphon is Simplified BSD, so neither carries a licence burden. Requires Electron 40+, hence the upgrade to 43.5.1.</sub>
- [ ] **Ableton Link** `backlog`
  <br><sub>Tempo sharing over the network needs a separate protocol stack and discovery service.</sub>

---

## Library, templates and sharing

Make the shipped content discoverable and the user's own content manageable.

- [x] **60+ ready-made scene templates**
  <br><sub>Curated starting points grouped by use (club, ambient, podcast overlay, stream corner, lyric video, screensaver) and by genre. This is what makes the app usable in the first five minutes.</sub>
- [ ] **Preset browser with search, tags and favourites**
  <br><sub>Filter by tag, search by name, mark favourites, sort by recently used. Currently the library is a flat list.</sub>
- [ ] **Automatic preset thumbnails**
  <br><sub>Render a thumbnail when a preset is saved and cache it, so the browser is visual rather than textual.</sub>
- [ ] **Preset randomiser and mutation**
  <br><sub>Generate a new scene by randomising within musically sensible bounds, or mutate the current one by a controllable amount. The fastest route to a look nobody would have designed.</sub>
- [ ] **Scene morphing: interpolate between two presets**
  <br><sub>A single slider that interpolates every numeric parameter between two scenes, with non-numeric fields switching at the midpoint.</sub>
- [ ] **Pack format v2 with dependencies and versioning**
  <br><sub>Packs should carry their media, fonts and shaders, declare the app version they need, and migrate cleanly when loaded into a newer build.</sub>
- [x] **Settings backup and restore**
  <br><sub>Export everything — settings, scenes, presets, mappings, control assignments — to one file and restore it on another machine.</sub>
- [x] **Configuration migration between versions**
  <br><sub>A versioned migration chain so a 1.3 or 2.0 settings file opens correctly in 3.0, with tests for each step.</sub>
- [ ] **Recently used and session history**
  <br><sub>Track what was opened and allow returning to a previous session state, including an undo history for scene edits.</sub>
- [ ] **Central preset store or marketplace** `backlog`
  <br><sub>A deliberate omission. The application connects to no server, requires no account and sends no telemetry. Sharing happens through files (`.svpreset`, `.svpack`), which also means presets keep working if this project ever stops being maintained.</sub>

---

## Performance and rendering quality

Keep frame time flat as the feature surface grows.

- [ ] **Adaptive render scale**
  <br><sub>Measure frame time and drop internal resolution before dropping frames, recovering when there is headroom. Configurable floor and target frame rate.</sub>
- [ ] **Performance HUD with GPU timing**
  <br><sub>Frame time graph, per-stage breakdown (analysis, layers, effects, present), draw call and particle counts, toggled with a shortcut.</sub>
- [ ] **Effect chain cost budgeting**
  <br><sub>Show the measured cost of each effect in the chain so a user can see which one is expensive, and warn before the chain exceeds the frame budget.</sub>
- [ ] **Multi-window rendering cost measurement**
  <br><sub>Quantify what each additional visualizer window costs and share work between windows where the scene is identical.</sub>
- [ ] **Texture and buffer pooling**
  <br><sub>Reuse framebuffers and textures across effects and passes rather than allocating per chain change, to stop churn when a user drags the effect list.</sub>
- [ ] **Low-power mode**
  <br><sub>A mode that caps frame rate and disables the most expensive passes, for laptops on battery and for long unattended runs.</sub>
- [ ] **Startup time and lazy engine loading**
  <br><sub>Load the heavy engines on first use rather than at boot, keeping the app open fast as the feature count grows.</sub>
- [ ] **Memory leak watch in the self-test**
  <br><sub>Cycle every mode, effect and formula repeatedly in `--smoke` and assert that heap and GPU resource counts return to baseline.</sub>
- [ ] **WebGPU rendering backend** `backlog`
  <br><sub>The Studio engine is built on WebGL2. WebGPU is more modern, but the entire Shadertoy and ISF ecosystem is GLSL today, and compatibility with that ecosystem is worth more than the API upgrade.</sub>

---

## Test coverage and quality gates

The release claim is "everything works" — that has to be demonstrable, not asserted.

- [ ] **Golden-frame regression tests**
  <br><sub>Use the deterministic offline exporter to render a fixed set of reference scenes and compare against stored frames, so a refactor cannot silently change output. Includes a documented way to review and accept an intended change.</sub>
- [x] **Self-test covers every new engine**
  <br><sub>Extend `--smoke` to walk modulation routes, transitions, mapping warps, text layers, MilkDrop presets and multi-pass shaders, not just modes and effects.</sub>
- [x] **Config schema validation test**
  <br><sub>Assert that every default has the right type and range, that every panel path exists in the defaults, and that no panel references a removed field.</sub>
- [x] **i18n coverage gate for every new string**
  <br><sub>The English scan already walks the interface. Extend it to the new panels, the web pages and every dynamically generated label, and fail the build on a gap.</sub>
- [x] **GitHub Actions workflow: tests on every push**
  <br><sub>Run the unit suite on Windows and Linux for every push and pull request. The GPU self-test stays local, but everything that can run headless should run in CI.</sub>
- [ ] **Packaged build verification**
  <br><sub>Automate what was done by hand for 2.1: launch the packaged binary with a temporary profile, confirm every engine file is served from inside the archive, and check the console is clean.</sub>
- [ ] **Determinism test for the whole render path**
  <br><sub>Render the same scene twice with modulation, transitions and effects active and assert the outputs are byte-identical.</sub>
- [x] **Fuzz the preset and pack loaders**
  <br><sub>Feed truncated, malformed and hostile preset files to the importers and assert they fail with a message rather than crashing or executing anything.</sub>
- [ ] **Performance regression check in the self-test**
  <br><sub>Record frame time for a fixed reference scene and fail if it regresses beyond a threshold, so features cannot quietly make the app slower.</sub>
- [x] **Test the modulation and analysis engines against reference signals**
  <br><sub>A shared synthetic signal generator (tones, chords, click trains, noise, sweeps) reused across the analysis tests, so every feature is measured against a signal with a known answer.</sub>

---

## Documentation, screenshots and demos

Requested directly: the README should show the new features, not just list them.

- [x] **README: screenshots of every major feature**
  <br><sub>Requested directly. Capture the scene panel, layer stack, effect chain, 3D geometry, modulation matrix, Studio editor, clip grid, mapping editor, audio analysis panel and the mobile remote, in both languages where the interface differs.</sub>
- [x] **README: animated demos of the headline engines**
  <br><sub>Short looping captures showing modulation, transitions, the MilkDrop engine and the 3D geometry actually moving. Generated with the new recording feature, which also proves that feature works.</sub>
- [x] **Feature comparison matrix update**
  <br><sub>Rebuild the ROADMAP status table for 3.0 across every researched competitor, keeping the rule that a row is only marked done when the feature works and is tested.</sub>
- [ ] **User guide: from install to first show**
  <br><sub>A walkthrough covering audio setup, scenes, layers, effects, control mapping and output, in Turkish and English.</sub>
- [ ] **Shader authoring guide**
  <br><sub>Document the uniforms, the multi-pass model, the ISF subset supported and the import paths, with worked examples.</sub>
- [ ] **Modulation cookbook**
  <br><sub>Recipes people can copy: kick-driven zoom punch, chord-driven palette, LFO camera drift, macro-controlled intensity.</sub>
- [x] **Keyboard shortcut reference**
  <br><sub>A generated reference of every binding, in the app and in the docs, kept in sync with the shortcut table.</sub>
- [x] **Honest "not done" section for 3.0**
  <br><sub>Keep the practice from 2.0 and 2.1: state plainly what was not built, why, and what was done instead. Currently expected to cover NDI, Spout/Syphon, Ableton Link and WebGPU.</sub>
