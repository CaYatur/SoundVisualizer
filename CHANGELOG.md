# Changelog

What changed in each release, grouped by area. Numbers in brackets are pull requests or issues on
GitHub. The full reasoning and the measurements behind each change are in [ROADMAP.md](ROADMAP.md).

## v3.1.5 — 2026-10-13

Everything since v3.1.4: 142 pull requests and about 40 direct engine commits. 1402 tests were
added, 2999 in total.

### Highlights

- **MilkDrop library, editor and MilkDrop 3 presets** — import whole libraries, thumbnails,
  favourites and tags, a preset editor, a preset generator, and show control on the bar.
- **AI control over MCP** — 96 tools for Claude Desktop, Codex, Cursor and other agents, local only.
- **OSC in and out** — a fixed address tree with OSCQuery and mDNS, and levels, hits, tempo and show
  state out to desks, Resolume and TouchDesigner.
- **Timeline and Clip Deck rebuilt** for real shows.
- **In-app updates**, with size and SHA-256 checks.
- **60 visualizer modes, 43 backgrounds, 81 templates**, including Music Video cards.

### MilkDrop — show control and library (#583)

- Preset timing from MilkDrop 2: interval spread, a lock and hard cuts on loud beats (#568).
- Ratings, rating-weighted random order and a back/forward history (#569); stars show only the
  ratings you gave (#587).
- Presets and settings on MIDI and OSC (#570); preset changes on the bar from the tempo engine (#571);
  a new track can bring the next preset (#582).
- Every screen shows the same preset, or each picks its own (#585); the lights can take MilkDrop's
  colours (#589).
- Import whole libraries from ZIP packs, folders and libraries already on the machine (#574, #607);
  every preset is listed, not only the first 400 (#635, #639).
- Thumbnails in a grid (#575, #608); favourites, tags and search by author (#576, #605).
- An in-app preset editor (#578, #628).
- A preset generator of our own, and mash-ups from the library (#579, #609, #610); five presets of
  our own ship with the app.
- MilkDrop 3: `.milk2` double presets and an Automatic / MilkDrop 2 / MilkDrop 3 format (#567, #629,
  #656).
- Sprites from `milk_img.ini` (#577, #601); user textures load in the preview, the web overlay and
  export (#586).
- Follows the system's reduce-motion setting (#581, #603); flash limiting holds per second on every
  screen (#588).
- Recovers from a lost WebGL context (#572, #593); a preset change no longer stalls the frame (#573,
  #597).

### MilkDrop — fidelity (#560, #580)

- Waveforms read the newest audio from both channels, aligned as MilkDrop aligns them; the bands
  read the aligned left channel; the default and custom waves follow MilkDrop's geometry, seeds,
  alpha chain and line passes (#664).
- Shader `vol` and `vol_att`, hue corner colours, the fixed composite, borders, blur levels, the
  fixed warp's wrap and the composite stage's `rad`/`ang` computed as MilkDrop computes them (#611,
  #612, #630–#633, #663).
- Shapes take their side count, texturing and blending from their equations; textured shapes sample
  the window MilkDrop samples; motion vectors sit and point where MilkDrop puts them.
- Preset files are read, and equations compiled and run, by MilkDrop 2's own rules; each block keeps
  its own variables (#613, #614, #619, #620, #625).
- Internal buffers in MilkDrop's orientation, settled against a reference renderer (#660).
- The layer releases its WebGL context when it closes; the panel preview's demo signal is broadband
  stereo.

### AI control — MCP (new)

- An MCP control card with five modes on `127.0.0.1`: Read, Apply, Write, Full and Everything (#693).
- 96 tools; a coverage test fails when the app gains something MCP does not know (#705).
- Validation of every write path, locked layers respected, file tools limited to their own file
  type (#722, #724, #725, #726, #730).

### OSC (new: input tree, OSCQuery, output)

- OSC output of levels, the spectrum, analysis, drum hits, the tempo clock and the show state
  (#437, #733).
- OSC input on a fixed address tree, with OSCQuery over HTTP and mDNS; UDP on IPv4 and IPv6 (#734,
  #735, #736); Linux and macOS LAN interfaces and the mDNS port handled (#737); OSCQuery start-up
  serialised (#738).
- The listeners no longer restart on every settings change, the OSCQuery tree lists every address,
  and inherited names answer 404 (#741).
- Master opacity (`/show/opacity`).

### Timeline and Clip Deck (#636, #637)

- Timeline: a DAW-style editor with undo, split, duplicate and solo (#642); multi-select, loop
  brace, marker drag, fade handles and a full-window mode (#648); tempo changes on the ruler and
  lane height (#662); media clips get a target (#659); drags keep their clip and keyboard focus stays
  in the editor (#641, #650).
- Clip Deck: a performance grid with named columns, a beat bar and progress (#643); launch modes,
  grid keyboard, drag and drop and several decks (#649); video, image and shader slots apply to a
  chosen target, and action slots run (#651, #659).

### Modes, backgrounds and templates

- One mode catalogue for every picker and cycle (#644); every background shows its own settings
  (#645).
- Ten new visualizers and ten new backgrounds (#638, #647, #652), and Stereo Trails, which launches
  each band from its place in the stereo image (#732).
- Music Video cards rebuilt — no grain, cover beside the text, from one Now Playing layer — and a
  Music Backdrop group (#728).
- Now Playing as a first-class layer kind (#688), cover fit modes and a separate cover pulse (#677,
  #680), and the mode loads in the panel preview and the exporter (#661).
- Trail modes no longer cover the background (#646).

### Auto VJ

- Backgrounds, your own Studio background presets, and a custom mix of kinds (#731).

### Media, lyrics and libraries

- A floating picture-in-picture window, animated GIF logos and an image library (#598).
- A lyrics library that follows the playing track, a video library, and shared playback clocks
  (#694).
- The dynamic theme keeps a solid visualizer colour you chose (#739, #740).

### Audio

- Both channels travel from capture to the visuals (#566).
- A capture helper that stops sending frames is restarted, with a growing back-off (#711, #714).

### Output and streaming

- A diagnostics card on the overlay with `?debug=1` (#565).
- The stream server refuses other websites; a refused client no longer freezes the app (#709).
- Media-layer video no longer freezes in full screen or Spout (#716); Spout frames keep moving
  (#691).
- The chosen display is found again after Windows renumbers it (#697).
- Covering the taskbar in transparent full screen (#672, #673, #674); the installed taskbar icon has
  no grey plate (#727).

### Updates (new)

- Checks GitHub Releases and says how to update (#653); downloads, verifies and installs on Windows
  and AppImage (#654); AppImage update information and `.zsync` (#655).

### Performance and optimisation

- Large preset libraries stay light (#606); preset ids no longer collide on large imports (#658).
- The visualizer no longer slows down as settings grow (#621, #623).
- MilkDrop equations take a third less time with unchanged results (#627); noise textures are made
  once per page (#634).
- Eight draw loops stop allocating arrays every frame (#657).
- Moving a slider no longer stalls the app (#700); OpenRGB no longer reconnects on every settings
  change (#704).
- `npm run bench`, a reproducible performance benchmark (#719).

### Reliability

- Warns when two copies of the app run at once (#564).
- Every GPU surface recovers from a lost context (#599); one layer that throws no longer drops the
  whole frame (#626); an effect on one layer no longer blacks out the layers below (#590).
- An uncaught main-process error no longer freezes the app in a modal box (#710).
- Closing the app during an export no longer leaves a broken file (#712).
- The display stays awake while a visualizer window is open (#713).
- The stabilisation series before this release (#695): #696–#717 and four rounds of outside review
  (#722–#726).

### Control panel

- A balanced panel: collapsible layers, stable card columns, aligned rows (#622, #624, #699).
- The clicked control stays in place when the panel redraws, and scroll positions are kept (#615,
  #616, #675, #698).
- Its own icon set instead of emoji (#666); Settings in one card with Updates (#683–#686).
- Lighting is off by default and its reset is separate from Dynamic Lighting (#669, #670).
- English text for every error message from the main process (#718).

### Security and privacy

- Stream clients no longer receive the access tokens; app windows stay on the app's own pages and
  links open in the system browser; export paths are checked; MilkDrop function names resolve only
  from the engine's own table (#742).
- The privacy section lists what each switch opens (#745); vulnerabilities can be reported privately
  from the Security tab.

### Documentation

- The README rewritten, with screenshots generated by the app (#715, #729), and a showreel as
  animated WebP (#743, #744).
- A copyright notice in every source file (#702); CONTRIBUTING.md and issue and pull request
  templates (#745).
